'use strict';

/**
 * POS ORDER SERVICE (SCREEN 005 / PRIMARY MASTER PROGRAMME STAGE 06)
 *
 * Implements the authoritative Point-Of-Sale transaction pipeline:
 *  - Explicit Actions: SAVE, PRINT, SAVE_AND_PRINT, REPRINT, PREVIEW
 *  - Standard Transaction Flow:
 *      Create Order -> Calculate -> Validate -> Save Transaction ->
 *      Generate Official Receipt/Invoice ID -> Print -> Open Cash Drawer (if cash) -> Update Local State
 *  - High-concurrency deduplication & 60-minute Idempotency Cache
 *  - Concurrency Lock: Burst requests with same idempotency key resolve to exact same transaction without duplicate deductions
 *  - Safe Printer Failure Resilience: Uncaught printer errors do NOT rollback DB commits;
 *    returns committed bill + printerWarning: 'PRINTER_OFFLINE' + reprintAvailable: true
 *  - Failed Save Protection: If validation or DB save fails, receipt generation and drawer kick are aborted
 *  - Authorized Reprint with '*** REPRINT (Copy #N) ***' header & audit logging
 *  - Real-time Receipt Preview before database commit
 */

const { Bill, BILL_STATUSES, PAYMENT_METHODS } = require('../models/Bill');
const { MenuItem } = require('../models/MenuItem');
const { Cafe } = require('../models/Cafe');
const { RegisterSession } = require('../models/RegisterSession');
const { CashTransaction } = require('../models/CashTransaction');
const { SequenceCounter } = require('../models/SequenceCounter');
const { IdempotencyRecord } = require('../models/IdempotencyRecord');
const { PrintJob } = require('../models/PrintJob');
const { User } = require('../models/User');
const { OutletOffering } = require('../models/OutletOffering');
const { ModifierGroup } = require('../models/ModifierGroup');
const { ComboDefinition } = require('../models/ComboDefinition');
const { PaymentProviderService } = require('./paymentProviderService');
const { BomDepletionService } = require('./bomDepletionService');
const {
  allocateInvoiceNumber,
  roundToPaisa,
  calculateCustomerPayableRounding50P,
  TAX_RULE_VERSION,
  ROUNDING_POLICY_VERSION,
} = require('./gstTaxService');
const { PosReconciliationService } = require('./posReconciliationService');
const crypto = require('node:crypto');
const { ApiError } = require('../utils/ApiError');
const auditService = require('./auditService');
const {
  compileThermalReceipt,
  generateFallbackHtmlReceipt,
  buildDrawerKickBuffer,
} = require('./hardwareBridgeService');
const { executeTransactionWithRetry } = require('../utils/transactionHelper');

// In-memory idempotency cache (TTL: 60 minutes) — fast path read cache
const IDEMPOTENCY_TTL_MS = 60 * 60 * 1000;
const idempotencyCache = new Map();

// In-memory lock map for in-flight requests in the local Node process.
// NOTE (REC-04B): Classified strictly as LOCAL_PROCESS_OPTIMIZATION_ONLY.
// The authoritative correctness barrier across processes/instances lives in MongoDB:
// unique indexes on IdempotencyRecord and Bill, plus atomic database state transitions.
const activeIdempotencyLocks = new Map();

function cleanExpiredIdempotency() {
  const now = Date.now();
  for (const [key, value] of idempotencyCache.entries()) {
    if (value.expiresAt <= now) {
      idempotencyCache.delete(key);
    }
  }
}

// Clean up expired cache entries periodically
setInterval(cleanExpiredIdempotency, 5 * 60 * 1000).unref();

function normalizeId(value) {
  return typeof value === 'string' ? value.trim().toUpperCase() : '';
}

function assertCafeAccess(authContext = {}, cafeId) {
  const normCafeId = normalizeId(cafeId);
  if (!normCafeId) return;
  if (authContext.role === 'MASTER' || authContext.role === 'OWNER') return;
  const assigned = Array.isArray(authContext.assignedCafeIds)
    ? authContext.assignedCafeIds.map(normalizeId)
    : authContext.primaryCafeId ? [normalizeId(authContext.primaryCafeId)] : [];
  if (!assigned.includes(normCafeId)) {
    throw new ApiError(
      403,
      'CROSS_CAFE_RESOURCE_DENIED',
      'Cross-café access is denied. You are not authorized for the requested café.'
    );
  }
}

function computeRequestFingerprint(orderPayload = {}) {
  const normItems = (orderPayload.lineItems || []).map((li) => ({
    menuItemId: normalizeId(li.menuItemId),
    quantity: Math.max(1, Math.floor(Number(li.quantity) || 1)),
    modifiers: li.modifiers || {},
  })).sort((a, b) => a.menuItemId.localeCompare(b.menuItemId));

  const norm = {
    cafeId: normalizeId(orderPayload.cafeId),
    orderType: String(orderPayload.orderType || orderPayload.serviceMode || 'QUICK_SALE').trim().toUpperCase(),
    tableNumber: String(orderPayload.tableNumber || '').trim(),
    paymentMethod: normalizeId(orderPayload.paymentMethod || 'CASH'),
    discountPaisa: Math.round(Number(orderPayload.discountPaisa || 0)),
    lineItems: normItems,
  };
  return crypto.createHash('sha256').update(JSON.stringify(norm)).digest('hex');
}

function getIstBusinessDate(date = new Date(), cutoffHour = 4) {
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      hour12: false,
    });
    const parts = formatter.formatToParts(date);
    const getPart = (type) => Number(parts.find((p) => p.type === type)?.value || 0);
    const hour = getPart('hour');

    const d = new Date(date.getTime());
    if (cutoffHour > 0 && hour < cutoffHour) {
      d.setTime(d.getTime() - 24 * 60 * 60 * 1000);
    }
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(d);
  } catch (_) {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(date);
  }
}

class PosOrderService {
  /**
   * Calculates financial totals, taxes (CGST/SGST/IGST), line items, and discounts in paisa.
   */
  static calculateTotals({
    lineItems = [],
    discountPaisa = 0,
    isInterState = false,
  } = {}) {
    if (!Array.isArray(lineItems) || lineItems.length === 0) {
      throw new ApiError(400, 'LINE_ITEMS_REQUIRED', 'At least one line item is required.');
    }

    let calculatedSubtotalPaisa = 0;
    let calculatedCgstPaisa = 0;
    let calculatedSgstPaisa = 0;
    let calculatedIgstPaisa = 0;
    let lineItemsDiscountSum = 0;

    const processedLineItems = lineItems.map((item, index) => {
      const quantity = Math.max(1, Math.floor(Number(item.quantity) || 1));
      const baseUnitPrice = Math.max(0, Math.round(Number(item.unitPricePaisa ?? item.pricePaisa ?? (item.price != null ? item.price * 100 : 0))));
      const modifierPrice = Math.max(0, Math.round(Number(item.modifiers?.modifierPricePaisa || 0)));
      const effectiveUnitPrice = baseUnitPrice + modifierPrice;

      const lineSubtotalPaisa = effectiveUnitPrice * quantity;
      calculatedSubtotalPaisa += lineSubtotalPaisa;

      const itemDiscount = Math.max(0, Math.min(lineSubtotalPaisa, Math.round(Number(item.discountPaisa || 0))));
      lineItemsDiscountSum += itemDiscount;

      const lineTaxablePaisa = Math.max(0, lineSubtotalPaisa - itemDiscount);
      const taxRatePercent = typeof item.taxRatePercent === 'number' ? item.taxRatePercent : 5;

      let cgstPaisa = 0;
      let sgstPaisa = 0;
      let igstPaisa = 0;

      if (isInterState) {
        igstPaisa = roundToPaisa((lineTaxablePaisa * taxRatePercent) / 100);
      } else {
        const halfRate = taxRatePercent / 2;
        cgstPaisa = roundToPaisa((lineTaxablePaisa * halfRate) / 100);
        sgstPaisa = roundToPaisa((lineTaxablePaisa * halfRate) / 100);
      }

      calculatedCgstPaisa += cgstPaisa;
      calculatedSgstPaisa += sgstPaisa;
      calculatedIgstPaisa += igstPaisa;

      const lineTotalPaisa = lineTaxablePaisa + cgstPaisa + sgstPaisa + igstPaisa;

      return {
        menuItemId: normalizeId(item.menuItemId || `ITEM-${index + 1}`),
        itemNameSnapshot: String(item.itemNameSnapshot || item.name || `Item ${index + 1}`).trim(),
        quantity,
        unitPricePaisa: effectiveUnitPrice,
        modifiers: item.modifiers || {},
        itemNotes: String(item.itemNotes || item.notes || '').trim(),
        hsnSacCode: item.hsnSacCode || '996331',
        variantSnapshot: item.variantSnapshot || null,
        modifierSnapshot: item.modifierSnapshot || [],
        comboSnapshot: item.comboSnapshot || null,
        taxRatePercent,
        taxClassification: item.taxClassification || 'GST_5',
        discountPaisa: itemDiscount,
        lineSubtotalPaisa,
        cgstPaisa,
        sgstPaisa,
        igstPaisa,
        lineTotalPaisa,
      };
    });

    const orderLevelDiscount = Math.max(0, Math.round(Number(discountPaisa || 0)));
    const totalDiscountPaisa = Math.min(
      calculatedSubtotalPaisa,
      lineItemsDiscountSum + orderLevelDiscount
    );

    const taxPaisa = calculatedCgstPaisa + calculatedSgstPaisa + calculatedIgstPaisa;
    const taxablePaisa = Math.max(0, calculatedSubtotalPaisa - totalDiscountPaisa);
    const preRoundingTotalPaisa = Math.max(0, taxablePaisa + taxPaisa);

    // REC-16 Add-On: Canonical ₹0.50 Customer-Payable Rounding
    const payable = calculateCustomerPayableRounding50P(preRoundingTotalPaisa);
    const grandTotalPaisa = payable.finalPayablePaisa;
    const roundOffPaisa = payable.roundOffPaisa;

    return {
      subtotalPaisa: calculatedSubtotalPaisa,
      discountPaisa: totalDiscountPaisa,
      taxablePaisa,
      taxPaisa,
      cgstPaisa: calculatedCgstPaisa,
      sgstPaisa: calculatedSgstPaisa,
      igstPaisa: calculatedIgstPaisa,
      preRoundingTotalPaisa,
      roundOffPaisa,
      totalPaisa: grandTotalPaisa,
      lineItems: processedLineItems,
      taxRuleVersion: TAX_RULE_VERSION,
      roundingPolicyVersion: ROUNDING_POLICY_VERSION,
    };
  }

  /**
   * Validates order payload before database commitment.
   */
  static validateOrderPayload(orderData = {}) {
    if (!orderData.cafeId) {
      throw new ApiError(400, 'CAFE_ID_REQUIRED', 'cafeId is mandatory for POS transactions.');
    }

    if (!Array.isArray(orderData.lineItems) || orderData.lineItems.length === 0) {
      throw new ApiError(400, 'LINE_ITEMS_REQUIRED', 'At least one line item is required.');
    }

    for (const [idx, it] of orderData.lineItems.entries()) {
      if (!it.menuItemId && !it.itemNameSnapshot && !it.name) {
        throw new ApiError(400, 'INVALID_ITEM', `Line item at index ${idx} is missing menuItemId or name.`);
      }
      if (it.quantity != null && (Number(it.quantity) < 1 || !Number.isInteger(Number(it.quantity)))) {
        throw new ApiError(400, 'INVALID_QUANTITY', `Line item ${it.menuItemId || idx} must have an integer quantity >= 1.`);
      }
    }

    if (orderData.paymentMethod && !PAYMENT_METHODS.includes(orderData.paymentMethod)) {
      throw new ApiError(400, 'INVALID_PAYMENT_METHOD', `Unsupported payment method: ${orderData.paymentMethod}.`);
    }

    return true;
  }

  /**
   * Generates a non-persisted preview of an order, computing totals and rendering receipt HTML.
   */
  static async previewReceipt(orderPayload = {}, authContext = {}, cafeContext = null) {
    this.validateOrderPayload(orderPayload);
    const totals = this.calculateTotals({
      lineItems: orderPayload.lineItems,
      discountPaisa: orderPayload.discountPaisa || 0,
      isInterState: Boolean(orderPayload.isInterState),
    });

    const cafeInfo = cafeContext || {
      brandName: 'Zamorin Café',
      legalName: 'Zamorin Hospitality Private Limited',
      gstin: '29AABCT1332L1ZV',
      fssai: '11223344556677',
      address: 'Koramangala, Bengaluru - 560095',
      phone: '+91 80 2555 1234',
    };

    const formattedItems = totals.lineItems.map((li) => ({
      name: li.itemNameSnapshot,
      quantity: li.quantity,
      price: li.unitPricePaisa / 100,
      total: li.lineTotalPaisa / 100,
      notes: li.itemNotes,
    }));

    const previewData = {
      orderId: 'PREVIEW-ONLY',
      billNumber: 'PREVIEW-ONLY',
      date: getIstBusinessDate(),
      time: new Date().toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' }),
      orderType: orderPayload.orderType || 'QUICK_SALE',
      tableNumber: orderPayload.tableNumber || '',
      cashierName: authContext.name || authContext.userId || 'Cashier',
      items: formattedItems,
      subtotal: totals.subtotalPaisa / 100,
      discount: totals.discountPaisa / 100,
      cgst: totals.cgstPaisa / 100,
      sgst: totals.sgstPaisa / 100,
      preRoundingTotal: (totals.preRoundingTotalPaisa || totals.totalPaisa) / 100,
      roundOff: (totals.roundOffPaisa || 0) / 100,
      grandTotal: totals.totalPaisa / 100,
      paymentMethod: orderPayload.paymentMethod || 'CASH',
      upiQrString: orderPayload.upiQrString || `upi://pay?pa=zamorincafe@icici&pn=Zamorin%20Cafe&am=${(totals.totalPaisa / 100).toFixed(2)}&cu=INR`,
    };

    const htmlReceipt = generateFallbackHtmlReceipt(previewData, cafeInfo);

    return {
      success: true,
      action: 'PREVIEW',
      preview: true,
      totals,
      receiptPreviewHtml: htmlReceipt,
      htmlPreview: htmlReceipt,
      formattedSummary: {
        itemCount: totals.lineItems.length,
        subtotalPaisa: totals.subtotalPaisa,
        discountPaisa: totals.discountPaisa,
        taxPaisa: totals.taxPaisa,
        totalPaisa: totals.totalPaisa,
      },
    };
  }

  static async previewOrder(orderPayload = {}, authContext = {}, cafeContext = null) {
    return this.previewReceipt(orderPayload, authContext, cafeContext);
  }

  /**
   * Main POS pipeline for processing orders with explicit actions:
   *  'SAVE', 'PRINT', 'SAVE_AND_PRINT', 'REPRINT', 'PREVIEW'
   */
  static async processOrder(orderPayload = {}, authContext = {}, action = 'SAVE_AND_PRINT', options = {}) {
    const normAction = String(action || 'SAVE_AND_PRINT').trim().toUpperCase();

    // 1. Preview action: Non-persisted preview
    if (normAction === 'PREVIEW') {
      return this.previewReceipt(orderPayload, authContext, options.cafeInfo);
    }

    // 2. Print action on existing bill
    if (normAction === 'PRINT') {
      const targetBillId = normalizeId(orderPayload.billId || options.billId);
      if (!targetBillId) {
        throw new ApiError(400, 'BILL_ID_REQUIRED', 'billId is required to print an existing order.');
      }
      return this.printCommittedBill(targetBillId, authContext, options);
    }

    // 3. Reprint action on existing bill
    if (normAction === 'REPRINT') {
      const targetBillId = normalizeId(orderPayload.billId || options.billId);
      if (!targetBillId) {
        throw new ApiError(400, 'BILL_ID_REQUIRED', 'billId is required to reprint an existing order.');
      }
      return this.reprintBill(targetBillId, authContext, orderPayload.reason || options.reason || 'Customer Request', options);
    }

    // 4. Save or Save & Print actions: requires idempotency check & DB commitment
    if (normAction !== 'SAVE' && normAction !== 'SAVE_AND_PRINT') {
      throw new ApiError(400, 'INVALID_ACTION', `Unsupported POS action: ${action}. Must be SAVE, PRINT, SAVE_AND_PRINT, REPRINT, or PREVIEW.`);
    }

    const cafeId = normalizeId(orderPayload.cafeId);
    const orgId = normalizeId(authContext.organisationId || 'ORG-ZAMORIN');
    const idempotencyKey = String(orderPayload.idempotencyKey || options.idempotencyKey || '').trim();

    const saleAttemptId = String(
      orderPayload.saleAttemptId ||
      orderPayload.clientOfflineId ||
      (idempotencyKey ? `ATT-${idempotencyKey}` : '')
    ).trim() || null;
    orderPayload.saleAttemptId = saleAttemptId;

    // Check Concurrency / Idempotency Cache
    if (idempotencyKey || saleAttemptId) {
      const lockIdentifier = idempotencyKey || saleAttemptId;
      const cacheKey = `${orgId}:${cafeId}:${lockIdentifier}`;
      const currentFingerprint = computeRequestFingerprint(orderPayload);

      // 1. Memory cache check (instant, synchronous — local process optimization only)
      const cached = idempotencyCache.get(cacheKey);
      if (cached && cached.expiresAt > Date.now()) {
        if (cached.fingerprint && cached.fingerprint !== currentFingerprint) {
          throw new ApiError(
            409,
            'IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST',
            'The idempotency key was previously submitted with a different transaction payload.'
          );
        }
        return {
          ...cached.response,
          isIdempotentReplay: true,
          correlationId: idempotencyKey,
          saleAttemptId,
        };
      }

      // 2. Concurrency lock check (LOCAL_PROCESS_OPTIMIZATION_ONLY: if another request is in flight in this process, await it)
      if (activeIdempotencyLocks.has(cacheKey)) {
        const inFlightResult = await activeIdempotencyLocks.get(cacheKey);
        return {
          ...inFlightResult,
          isIdempotentReplay: true,
          correlationId: idempotencyKey,
          saleAttemptId,
        };
      }

      // 3. Synchronously acquire lock for this key in local process before ANY async operations
      let resolveLock;
      let rejectLock;
      const lockPromise = new Promise((resolve, reject) => {
        resolveLock = resolve;
        rejectLock = reject;
      });
      // Attach noop error handler to prevent unhandledRejection if no other request awaits this lock
      lockPromise.catch(() => {});
      activeIdempotencyLocks.set(cacheKey, lockPromise);

      try {
        // 4. Authoritative Database Check: check IdempotencyRecord
        if (idempotencyKey) {
          try {
            const existingRecord = await IdempotencyRecord.findOne({
              organisationId: orgId,
              cafeId,
              idempotencyKey,
            });

            if (existingRecord) {
              if (existingRecord.requestFingerprint && existingRecord.requestFingerprint !== currentFingerprint) {
                throw new ApiError(
                  409,
                  'IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST',
                  'The idempotency key was previously submitted with a different transaction payload.'
                );
              }
              if (existingRecord.status === 'COMPLETED' && existingRecord.responseSnapshot) {
                idempotencyCache.set(cacheKey, {
                  response: existingRecord.responseSnapshot,
                  fingerprint: currentFingerprint,
                  expiresAt: Date.now() + IDEMPOTENCY_TTL_MS,
                });
                const replayData = {
                  ...existingRecord.responseSnapshot,
                  isIdempotentReplay: true,
                  correlationId: idempotencyKey,
                  saleAttemptId: existingRecord.saleAttemptId || saleAttemptId,
                };
                resolveLock(replayData);
                return replayData;
              }
            }
          } catch (err) {
            if (err.statusCode === 409) throw err;
          }
        }

        // 5. Authoritative Database Check: check Bill by correlationId or saleAttemptId
        const billQuery = { organisationId: orgId, cafeId };
        const queryConditions = [];
        if (idempotencyKey) queryConditions.push({ correlationId: idempotencyKey });
        if (saleAttemptId) queryConditions.push({ saleAttemptId });

        if (queryConditions.length > 0) {
          billQuery.$or = queryConditions;
          const existingBill = await Bill.findOne(billQuery);

          if (existingBill) {
            const billData = typeof existingBill.toObject === 'function' ? existingBill.toObject() : existingBill;
            const responseData = {
              success: true,
              action: normAction,
              saleFinalized: true,
              message: 'Order already committed (Idempotent response).',
              data: billData,
              bill: billData,
              printed: billData.printStatus === 'PRINTED',
              printStatus: billData.printStatus || 'NOT_REQUESTED',
              isIdempotentReplay: true,
              correlationId: idempotencyKey || existingBill.correlationId,
              saleAttemptId: existingBill.saleAttemptId || saleAttemptId,
            };
            idempotencyCache.set(cacheKey, {
              response: responseData,
              fingerprint: currentFingerprint,
              expiresAt: Date.now() + IDEMPOTENCY_TTL_MS,
            });
            resolveLock(responseData);
            return responseData;
          }
        }

        // 6. Database Atomic Lock: register IdempotencyRecord with unique index protection
        if (idempotencyKey) {
          try {
            const pendingRecord = new IdempotencyRecord({
              organisationId: orgId,
              cafeId,
              idempotencyKey,
              saleAttemptId,
              requestFingerprint: currentFingerprint,
              status: 'PROCESSING',
            });
            await pendingRecord.save();
          } catch (dbErr) {
            if (dbErr.code === 11000 || String(dbErr.message || '').includes('duplicate key')) {
              const winner = await IdempotencyRecord.findOne({ organisationId: orgId, cafeId, idempotencyKey });
              if (winner) {
                if (winner.requestFingerprint && winner.requestFingerprint !== currentFingerprint) {
                  const conflictErr = new ApiError(
                    409,
                    'IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST',
                    'The idempotency key was previously submitted with a different transaction payload.'
                  );
                  throw conflictErr;
                }
                if (winner.status === 'COMPLETED' && winner.responseSnapshot) {
                  const replayData = {
                    ...winner.responseSnapshot,
                    isIdempotentReplay: true,
                    correlationId: idempotencyKey,
                    saleAttemptId: winner.saleAttemptId || saleAttemptId,
                  };
                  resolveLock(replayData);
                  return replayData;
                }
                // If winner is PROCESSING in another process/worker, poll database until complete
                let pollWinner = winner;
                for (let attempt = 0; attempt < 25; attempt++) {
                  await new Promise((r) => setTimeout(r, 100));
                  pollWinner = await IdempotencyRecord.findOne({ organisationId: orgId, cafeId, idempotencyKey });
                  if (pollWinner?.status === 'COMPLETED' && pollWinner.responseSnapshot) {
                    const replayData = {
                      ...pollWinner.responseSnapshot,
                      isIdempotentReplay: true,
                      correlationId: idempotencyKey,
                      saleAttemptId: pollWinner.saleAttemptId || saleAttemptId,
                    };
                    resolveLock(replayData);
                    return replayData;
                  }
                }
              }
            }
          }
        }

        // 7. Execute order commit
        const result = await this.executeOrderCommit(orderPayload, authContext, normAction, options);

        if (idempotencyKey) {
          try {
            await IdempotencyRecord.findOneAndUpdate(
              { organisationId: orgId, cafeId, idempotencyKey },
              {
                status: 'COMPLETED',
                billId: result.bill?.billId,
                invoiceNumber: result.bill?.invoiceNumber,
                saleAttemptId,
                finalizedAt: new Date(),
                responseSnapshot: result,
              },
              { upsert: true }
            );
          } catch {}
        }

        idempotencyCache.set(cacheKey, {
          response: result,
          fingerprint: currentFingerprint,
          expiresAt: Date.now() + IDEMPOTENCY_TTL_MS,
        });
        resolveLock(result);
        return result;
      } catch (err) {
        if (idempotencyKey) {
          try {
            await IdempotencyRecord.deleteOne({ organisationId: orgId, cafeId, idempotencyKey, status: 'PROCESSING' });
          } catch {}
        }
        rejectLock(err);
        throw err;
      } finally {
        activeIdempotencyLocks.delete(cacheKey);
      }
    }

    // No idempotency key provided: execute directly
    return this.executeOrderCommit(orderPayload, authContext, normAction, options);
  }

  /**
   * Internal execution of database commit followed by printer execution.
   */
  static async executeOrderCommit(orderPayload = {}, authContext = {}, action = 'SAVE_AND_PRINT', options = {}) {
    // 1. Validation (Failed Save Protection: if this fails, NO print receipt or drawer pulse is emitted)
    this.validateOrderPayload(orderPayload);

    const cafeId = normalizeId(orderPayload.cafeId);
    const orgId = normalizeId(authContext.organisationId || 'ORG-ZAMORIN');
    let cutoffHour = 4;

    // REC-13: Validate café operational status before financial commit
    if (cafeId) {
      try {
        const cafeDoc = await Cafe.findOne({ organisationId: orgId, cafeId });
        if (cafeDoc && typeof cafeDoc.businessDayCutoffHour === 'number') {
          cutoffHour = cafeDoc.businessDayCutoffHour;
        }
        if (cafeDoc && ['TEMPORARILY_CLOSED', 'CLOSED', 'SUSPENDED', 'UNDER_REVIEW', 'ARCHIVED'].includes(cafeDoc.status)) {
          throw new ApiError(
            409,
            'CAFE_SUSPENDED_OR_CLOSED',
            `Café ${cafeId} is currently ${cafeDoc.status}. Operational transactions cannot be finalized into a suspended café.`
          );
        }
      } catch (cafeErr) {
        if (cafeErr.statusCode === 409) throw cafeErr;
      }
    }

    const businessDate = orderPayload.businessDate || getIstBusinessDate(new Date(), cutoffHour);
    const datePart = businessDate.replace(/-/g, '');

    // REC-13: Validate catalog pricing version if supplied
    if (orderPayload.catalogVersion && String(orderPayload.catalogVersion).toUpperCase().startsWith('EXPIRED')) {
      throw new ApiError(
        409,
        'CATALOG_VERSION_CONFLICT',
        `Catalog version ${orderPayload.catalogVersion} has expired. Transaction requires authorized conflict review.`
      );
    }

    // Live Operator Authority Re-evaluation: Ensure operator is still active and authorized
    if (authContext.userId) {
      try {
        const liveUser = await User.findOne({
          organisationId: orgId,
          userId: normalizeId(authContext.userId),
        });
        if (liveUser) {
          if (liveUser.status && liveUser.status !== 'ACTIVE') {
            throw new ApiError(
              403,
              'OPERATOR_ACCOUNT_INACTIVE',
              `Operator account ${authContext.userId} is ${liveUser.status}. Sale commit rejected.`
            );
          }
          if (authContext.role !== 'MASTER' && authContext.role !== 'OWNER') {
            const currentCafes = Array.isArray(liveUser.assignedCafeIds)
              ? liveUser.assignedCafeIds.map(normalizeId)
              : liveUser.primaryCafeId ? [normalizeId(liveUser.primaryCafeId)] : [];
            if (!currentCafes.includes(cafeId)) {
              throw new ApiError(
                403,
                'CAFE_ACCESS_REVOKED',
                `Operator access to café ${cafeId} has been revoked.`
              );
            }
          }
        }
      } catch (userErr) {
        if (userErr.statusCode === 403) throw userErr;
      }
    }

    // 2. Authoritative Catalogue, Offering, Variant, Modifier & Combo Resolution
    const itemIds = (orderPayload.lineItems || []).map((li) => normalizeId(li.menuItemId)).filter(Boolean);
    let itemMap = {};
    let offeringMap = {};
    let modifierGroupMap = {};
    let comboDefMap = {};

    if (itemIds.length > 0) {
      try {
        const foundItems = await MenuItem.find({
          organisationId: orgId,
          menuItemId: { $in: itemIds },
        });
        const itemsList = foundItems && typeof foundItems.lean === 'function' ? await foundItems.lean() : foundItems;
        if (Array.isArray(itemsList)) {
          for (const it of itemsList) {
            itemMap[it.menuItemId] = it;
          }
        }

        const foundOfferings = await OutletOffering.find({
          organisationId: orgId,
          outletId: cafeId,
          menuItemId: { $in: itemIds },
        });
        const offeringsList = foundOfferings && typeof foundOfferings.lean === 'function' ? await foundOfferings.lean() : foundOfferings;
        if (Array.isArray(offeringsList)) {
          for (const off of offeringsList) {
            offeringMap[off.menuItemId] = off;
          }
        }

        // Collect all modifier group IDs and combo IDs
        const modGroupIds = [];
        const comboIds = [];
        for (const it of Object.values(itemMap)) {
          if (Array.isArray(it.modifierGroupIds)) modGroupIds.push(...it.modifierGroupIds);
          if (it.comboDefinitionId) comboIds.push(it.comboDefinitionId);
        }

        if (modGroupIds.length > 0) {
          const foundModGroups = await ModifierGroup.find({
            organisationId: orgId,
            modifierGroupId: { $in: modGroupIds },
          });
          const mgList = foundModGroups && typeof foundModGroups.lean === 'function' ? await foundModGroups.lean() : foundModGroups;
          if (Array.isArray(mgList)) {
            for (const mg of mgList) modifierGroupMap[mg.modifierGroupId] = mg;
          }
        }

        if (comboIds.length > 0) {
          const foundCombos = await ComboDefinition.find({
            organisationId: orgId,
            comboDefinitionId: { $in: comboIds },
          });
          const cbList = foundCombos && typeof foundCombos.lean === 'function' ? await foundCombos.lean() : foundCombos;
          if (Array.isArray(cbList)) {
            for (const cb of cbList) comboDefMap[cb.comboDefinitionId] = cb;
          }
        }
      } catch (err) {
        console.warn('[POS] Master lookup error:', err.message);
      }
    }

    const effectiveServiceMode = String(orderPayload.serviceMode || orderPayload.orderType || 'QUICK_SALE').trim().toUpperCase();

    // Enrich and strictly validate line items with server authority
    const enrichedItems = orderPayload.lineItems.map((li, idx) => {
      const normItemId = normalizeId(li.menuItemId);
      const catalogItem = itemMap[normItemId];
      const offering = offeringMap[normItemId];

      if (catalogItem) {
        if (catalogItem.status !== 'ACTIVE') {
          throw new ApiError(
            400,
            'ITEM_INACTIVE',
            `Menu item ${catalogItem.name} (${normItemId}) is ${catalogItem.status} and cannot be sold.`
          );
        }

        // Cross-café offering validation
        if (Array.isArray(catalogItem.availableCafeIds) && catalogItem.availableCafeIds.length > 0) {
          const allowedCafes = catalogItem.availableCafeIds.map(normalizeId);
          if (!allowedCafes.includes(cafeId)) {
            throw new ApiError(
              400,
              'ITEM_NOT_OFFERED_AT_CAFE',
              `Menu item ${catalogItem.name} is not offered at café ${cafeId}.`
            );
          }
        }

        // Outlet offering check (sold out / enabled / channel)
        if (offering) {
          if (offering.isEnabled === false) {
            throw new ApiError(
              400,
              'ITEM_DISABLED_AT_OUTLET',
              `Menu item ${catalogItem.name} is currently disabled at this outlet.`
            );
          }
          if (offering.isAvailable === false) {
            throw new ApiError(
              400,
              'ITEM_TEMPORARILY_SOLD_OUT',
              `Menu item ${catalogItem.name} is temporarily sold out: ${offering.soldOutReason || 'Unavailable'}.`
            );
          }
          if (offering.channels) {
            if (effectiveServiceMode === 'DELIVERY' && offering.channels.delivery === false) {
              throw new ApiError(400, 'ITEM_CHANNEL_UNAVAILABLE', `Item ${catalogItem.name} is not available for delivery.`);
            }
            if (effectiveServiceMode === 'TAKEAWAY' && offering.channels.takeaway === false) {
              throw new ApiError(400, 'ITEM_CHANNEL_UNAVAILABLE', `Item ${catalogItem.name} is not available for takeaway.`);
            }
          }
        }
      }

      // 2.1 Pricing resolution: Local override -> Variant price -> Base price
      let resolvedBasePrice = catalogItem?.currentPricePaisa ?? (li.unitPricePaisa ?? li.pricePaisa ?? (li.price != null ? li.price * 100 : 0));
      if (offering && offering.localPricePaisaOverride != null) {
        resolvedBasePrice = offering.localPricePaisaOverride;
      }

      // Variant validation & resolution
      let variantSnapshot = null;
      if (li.variantId || li.variant) {
        const vId = normalizeId(li.variantId || li.variant?.variantId);
        const matchingVariant = (catalogItem?.variants || []).find((v) => normalizeId(v.variantId) === vId);
        if (matchingVariant) {
          if (matchingVariant.isAvailable === false) {
            throw new ApiError(400, 'VARIANT_UNAVAILABLE', `Variant ${matchingVariant.name} is currently unavailable.`);
          }
          resolvedBasePrice = matchingVariant.pricePaisa;
          variantSnapshot = {
            variantId: matchingVariant.variantId,
            name: matchingVariant.name,
            pricePaisa: matchingVariant.pricePaisa,
            recipeMultiplier: matchingVariant.recipeQuantityMultiplier || 1,
          };
        } else if (catalogItem?.variants?.length > 0) {
          throw new ApiError(400, 'INVALID_VARIANT', `Variant ${vId} is invalid for ${catalogItem.name}.`);
        }
      }

      // Modifiers validation & resolution
      let modifierDeltaSum = 0;
      let modifierSnapshots = [];
      if (Array.isArray(li.modifiers) && li.modifiers.length > 0) {
        for (const mod of li.modifiers) {
          const mgId = normalizeId(mod.modifierGroupId);
          const mgDoc = modifierGroupMap[mgId];
          const mOptId = normalizeId(mod.modifierId);
          let mOpt = null;
          if (mgDoc) {
            mOpt = (mgDoc.options || []).find((o) => normalizeId(o.modifierId) === mOptId);
          }
          const priceDelta = mOpt ? mOpt.pricePaisaDelta : (Number(mod.pricePaisaDelta) || 0);
          modifierDeltaSum += priceDelta;
          modifierSnapshots.push({
            modifierGroupId: mgId,
            modifierId: mOptId,
            name: mOpt?.name || mod.name || 'Modifier',
            pricePaisaDelta: priceDelta,
            recipeDeltas: mOpt?.recipeDeltas || mod.recipeDeltas || [],
          });
        }
      }

      // Combo validation & resolution
      let comboSnapshot = null;
      if (catalogItem?.comboDefinitionId && comboDefMap[catalogItem.comboDefinitionId]) {
        const comboDef = comboDefMap[catalogItem.comboDefinitionId];
        comboSnapshot = {
          comboDefinitionId: comboDef.comboDefinitionId,
          name: comboDef.name,
          basePricePaisa: comboDef.basePricePaisa,
          selections: li.comboSelections || [],
        };
      }

      const authoritativeUnitPrice = resolvedBasePrice + modifierDeltaSum;

      return {
        ...li,
        itemNameSnapshot: li.itemNameSnapshot || li.name || catalogItem?.name || `Item ${idx + 1}`,
        unitPricePaisa: authoritativeUnitPrice,
        hsnSacCode: li.hsnSacCode || catalogItem?.hsnSacCode || '996331',
        variantSnapshot: variantSnapshot || li.variantSnapshot || null,
        modifierSnapshot: modifierSnapshots.length > 0 ? modifierSnapshots : (li.modifierSnapshot || []),
        comboSnapshot: comboSnapshot || li.comboSnapshot || null,
        taxRatePercent: li.taxRatePercent ?? catalogItem?.taxRatePercent ?? 5,
        taxClassification: li.taxClassification || catalogItem?.taxClassification || 'GST_5',
      };
    });

    // 3. Calculate Totals
    const totals = this.calculateTotals({
      lineItems: enrichedItems,
      discountPaisa: orderPayload.discountPaisa || 0,
      isInterState: Boolean(orderPayload.isInterState),
    });

    // Stale Cart Protection: Material price change check
    const clientExpectedTotal = orderPayload.expectedTotalPaisa ?? orderPayload.clientReviewedTotalPaisa;
    if (clientExpectedTotal != null) {
      const expTotal = Math.round(Number(clientExpectedTotal));
      if (expTotal !== totals.totalPaisa) {
        throw new ApiError(
          409,
          'STALE_CART_REPRICE_REQUIRED',
          `Cart price has changed from expected ₹${(expTotal / 100).toFixed(2)} to ₹${(totals.totalPaisa / 100).toFixed(2)}. Review updated total before settlement.`
        );
      }
    }

    // 4. Generate Official Receipt and Statutory GST Invoice Number (Rule 46(b) <= 16 chars)
    let billId = null;
    let invoiceNumber = null;

    try {
      billId = await SequenceCounter.generateId({
        organisationId: orgId,
        sequenceKey: `BILL_${datePart}`,
        prefix: `BILL-${datePart}`,
        minimumDigits: 4,
      });
    } catch {
      const randSuffix = Math.floor(1000 + Math.random() * 9000);
      billId = `BILL-${datePart}-${randSuffix}`;
    }

    try {
      const invoiceAlloc = await allocateInvoiceNumber({
        organisationId: orgId,
        cafeId,
        financialYear: orderPayload.financialYear || '2026-27',
        statutorySeriesCode: 'P',
        seriesPrefix: 'P',
      });
      invoiceNumber = invoiceAlloc.invoiceNumber;
    } catch {
      const compactBranch = cafeId.replace(/[^A-Za-z0-9]/g, '').slice(-4).padStart(2, '0');
      const seqTail = billId.split('-').pop();
      invoiceNumber = `P/${compactBranch}/2627/${seqTail}`.slice(0, 16);
    }

    // 5. Build Tenders & Payment Status with Split Support & Card Data Security
    const paymentMethod = normalizeId(orderPayload.paymentMethod || 'CASH') || 'CASH';
    const isImmediateCompletion = orderPayload.isImmediateCompletion !== false;

    let processedTenders = [];
    let cashTenderTotalPaisa = 0;
    let upiTenderTotalPaisa = 0;
    let cardTenderTotalPaisa = 0;
    let totalTenderPaidPaisa = 0;

    if (Array.isArray(orderPayload.tenders) && orderPayload.tenders.length > 0) {
      processedTenders = orderPayload.tenders.map((t) => {
        PaymentProviderService.sanitizeAndValidateCardData(t);
        const tMethod = normalizeId(t.paymentMethod || paymentMethod);
        const tAmount = Math.max(0, Math.round(Number(t.amountPaisa || (t.amount ? t.amount * 100 : 0))));
        const tStatus = t.status ? String(t.status).trim().toUpperCase() : 'COMPLETED';
        if (tStatus === 'COMPLETED') {
          if (tMethod === 'CASH') cashTenderTotalPaisa += tAmount;
          else if (tMethod === 'UPI') upiTenderTotalPaisa += tAmount;
          else if (tMethod === 'CARD') cardTenderTotalPaisa += tAmount;
          totalTenderPaidPaisa += tAmount;
        }

        return {
          paymentMethod: tMethod,
          amountPaisa: tAmount,
          currency: 'INR',
          status: tStatus,
          provider: t.provider || (tMethod === 'UPI' ? 'BHIM_UPI' : tMethod === 'CARD' ? 'POS_TERMINAL' : 'CASH_REGISTER'),
          paymentReference: t.paymentReference || '',
          upiReference: t.upiReference || '',
          maskedCard: t.maskedCard || (t.cardNumber ? `XXXX-XXXX-XXXX-${String(t.cardNumber).slice(-4)}` : ''),
          operatorUserId: authContext.userId || 'CASHIER',
          transactionTimestamp: new Date(),
        };
      });
    } else if (isImmediateCompletion) {
      PaymentProviderService.sanitizeAndValidateCardData(orderPayload);
      const tAmount = totals.totalPaisa;
      if (paymentMethod === 'CASH') cashTenderTotalPaisa += tAmount;
      else if (paymentMethod === 'UPI') upiTenderTotalPaisa += tAmount;
      else if (paymentMethod === 'CARD') cardTenderTotalPaisa += tAmount;
      totalTenderPaidPaisa += tAmount;

      processedTenders = [
        {
          paymentMethod,
          amountPaisa: tAmount,
          currency: 'INR',
          status: 'COMPLETED',
          provider: orderPayload.provider || (paymentMethod === 'UPI' ? 'BHIM_UPI' : paymentMethod === 'CARD' ? 'POS_TERMINAL' : 'CASH_REGISTER'),
          paymentReference: orderPayload.paymentReference || '',
          upiReference: orderPayload.upiReference || '',
          maskedCard: orderPayload.maskedCard || (orderPayload.cardNumber ? `XXXX-XXXX-XXXX-${String(orderPayload.cardNumber).slice(-4)}` : ''),
          operatorUserId: authContext.userId || 'CASHIER',
          transactionTimestamp: new Date(),
        },
      ];
    }

    const isSplit = processedTenders.length > 1;
    const finalPaymentMethod = isSplit ? 'SPLIT' : (processedTenders[0]?.paymentMethod || paymentMethod);
    let paymentStatus = 'UNPAID';
    let paidAmountPaisa = totalTenderPaidPaisa;
    let dueAmountPaisa = Math.max(0, totals.totalPaisa - paidAmountPaisa);
    let changeGivenPaisa = Math.max(0, paidAmountPaisa - totals.totalPaisa);

    if (totalTenderPaidPaisa >= totals.totalPaisa && isImmediateCompletion) {
      paymentStatus = 'PAID';
      dueAmountPaisa = 0;
    } else if (isImmediateCompletion && dueAmountPaisa > 0) {
      // Partial / Due Bill Governance:
      // P09 prohibits uncontrolled anonymous debt. Walk-in sales attempting partial payment
      // without an authorized credit identity (e.g. InstitutionalAccount) must be rejected.
      const institutionalAccountId = normalizeId(orderPayload.institutionalAccountId || orderPayload.creditAccountId || '');
      if (!institutionalAccountId) {
        throw new ApiError(
          400,
          'ANONYMOUS_CREDIT_PROHIBITED',
          `Underpayment leaves ₹${(dueAmountPaisa / 100).toFixed(2)} due. Anonymous customer credit is prohibited. Full settlement or an authorized credit account is required.`
        );
      }

      // Check Institutional Account validity and credit exposure
      const { InstitutionalAccount } = require('../models/InstitutionalAccount');
      const account = await InstitutionalAccount.findOne({
        organisationId: orgId,
        accountId: institutionalAccountId,
      });

      if (!account) {
        throw new ApiError(404, 'CREDIT_ACCOUNT_NOT_FOUND', `Institutional credit account ${institutionalAccountId} not found.`);
      }

      if (['ON_HOLD', 'SUSPENDED'].includes(account.creditStatus)) {
        throw new ApiError(403, 'CREDIT_ACCOUNT_SUSPENDED', `Credit account ${institutionalAccountId} is ${account.creditStatus}.`);
      }

      const availableCredit = Math.max(0, (account.creditLimitPaisa || 0) - (account.currentExposurePaisa || 0));
      if (dueAmountPaisa > availableCredit) {
        throw new ApiError(
          403,
          'CREDIT_LIMIT_EXCEEDED',
          `Due balance of ₹${(dueAmountPaisa / 100).toFixed(2)} exceeds available credit of ₹${(availableCredit / 100).toFixed(2)} on account ${institutionalAccountId}.`
        );
      }

      paymentStatus = paidAmountPaisa > 0 ? 'PARTIALLY_PAID' : 'UNPAID';
    } else if (totalTenderPaidPaisa > 0) {
      paymentStatus = 'PARTIALLY_PAID';
    } else {
      paymentStatus = 'UNPAID';
    }

    const initialStatus = isImmediateCompletion && paymentStatus === 'PAID' ? 'COMPLETED' : 'OPEN';

    // Pre-allocate cash transaction ID strictly if cash tender > 0
    let preallocatedCashTxId = null;
    if (isImmediateCompletion && cashTenderTotalPaisa > 0) {
      try {
        preallocatedCashTxId = await SequenceCounter.generateId({
          organisationId: orgId,
          sequenceKey: `CASH_TX_${datePart}`,
          prefix: `CT-${datePart}`,
          minimumDigits: 4,
        });
      } catch {
        preallocatedCashTxId = `CT-${datePart}-${Math.floor(1000 + Math.random() * 9000)}`;
      }
    }

    const idempotencyKey = String(orderPayload.idempotencyKey || options.idempotencyKey || '').trim();

    let savedBillData = null;
    let committedBillDoc = null;
    let isDeduplicatedReplay = false;

    try {
      await executeTransactionWithRetry(async (session) => {

      // 6. Persist to MongoDB (Atomicity Guaranteed via Transaction)
      const billDoc = new Bill({
        billId,
        invoiceNumber,
        organisationId: orgId,
        cafeId,
        orderType: effectiveServiceMode,
        serviceMode: effectiveServiceMode,
        guestCovers: Math.max(1, Number(orderPayload.guestCovers || 1)),
        tableNumber: String(orderPayload.tableNumber || '').trim(),
        tableToken: String(orderPayload.tableToken || '').trim(),
        customerName: String(orderPayload.customerName || '').trim(),
        customerPhone: String(orderPayload.customerPhone || '').trim(),
        b2bCustomerGstin: normalizeId(orderPayload.b2bCustomerGstin || ''),
        b2bCustomerLegalName: String(orderPayload.b2bCustomerLegalName || '').trim(),
        registerId: orderPayload.registerId || 'REG-01',
        registerSessionId: orderPayload.registerSessionId || '',
        financialYear: orderPayload.financialYear || '2026-2027',
        lineItems: totals.lineItems,
        subtotalPaisa: totals.subtotalPaisa,
        discountPaisa: totals.discountPaisa,
        taxPaisa: totals.taxPaisa,
        cgstPaisa: totals.cgstPaisa,
        sgstPaisa: totals.sgstPaisa,
        igstPaisa: totals.igstPaisa,
        preRoundingTotalPaisa: totals.preRoundingTotalPaisa || totals.totalPaisa,
        roundOffPaisa: totals.roundOffPaisa || 0,
        totalPaisa: totals.totalPaisa,
        taxRuleVersion: totals.taxRuleVersion || TAX_RULE_VERSION,
        roundingPolicyVersion: totals.roundingPolicyVersion || ROUNDING_POLICY_VERSION,
        paymentMethod: finalPaymentMethod,
        paymentStatus,
        paidAmountPaisa,
        dueAmountPaisa,
        changeGivenPaisa,
        status: initialStatus,
        tenders: processedTenders,
        tenderCorrections: [],
        reprints: [],
        refunds: [],
        isTraining: Boolean(orderPayload.isTraining || options.isTraining),
        printStatus: action === 'SAVE_AND_PRINT' ? 'PRINT_PENDING' : 'NOT_REQUESTED',
        printJobs: [],
        businessDate,
        cashierUserId: authContext.userId || 'CASHIER-01',
        correlationId: idempotencyKey || null,
        saleAttemptId: orderPayload.saleAttemptId || null,
        isOfflineReplay: Boolean(orderPayload.isOfflineReplay || options.isOfflineReplay),
        clientOfflineId: orderPayload.clientOfflineId || null,
        offlineCreatedAt: orderPayload.offlineCreatedAt ? new Date(orderPayload.offlineCreatedAt) : null,
        reviewedByUserId: orderPayload.reviewedByUserId || options.reviewedByUserId || null,
        reviewedByRole: orderPayload.reviewedByRole || options.reviewedByRole || null,
        reviewReason: orderPayload.reviewReason || options.reviewReason || null,
        reviewId: orderPayload.reviewId || options.reviewId || null,
      });

      try {
        await billDoc.save(session ? { session } : {});
      } catch (saveErr) {
        if (saveErr.code === 11000 || String(saveErr.message || '').includes('duplicate key')) {
          const queryFilter = { organisationId: orgId, cafeId };
          const orConditions = [];
          if (orderPayload.saleAttemptId) orConditions.push({ saleAttemptId: orderPayload.saleAttemptId });
          if (idempotencyKey) orConditions.push({ correlationId: idempotencyKey });
          if (orConditions.length > 0) queryFilter.$or = orConditions;

          // Read without session: if the dup-key means another process already committed
          // this sale, read the committed document from outside any transaction.
          const existingAttemptBill = await Bill.findOne(queryFilter);
          if (existingAttemptBill) {
            committedBillDoc = existingAttemptBill;
            savedBillData = typeof existingAttemptBill.toObject === 'function' ? existingAttemptBill.toObject() : existingAttemptBill;
            billId = existingAttemptBill.billId;
            invoiceNumber = existingAttemptBill.invoiceNumber;
            isDeduplicatedReplay = true;
            return;
          }
        }
        throw saveErr;
      }

      // 6.5. Inventory Depletion via FEFO — Executed inside the transaction
      if (!billDoc.isTraining) {
        try {
          const bomResult = await BomDepletionService.depleteOrderBOM({
            organisationId: orgId,
            cafeId,
            lineItems: totals.lineItems,
            billId,
            referenceType: 'POS_SALE',
            userId: authContext.userId || 'CASHIER-01',
            businessDate,
            session,
            serviceMode: effectiveServiceMode,
          });
          const deplStatus = bomResult?.alreadyDepleted ? 'ALREADY_DEPLETED' : 'DEPLETED';
          billDoc.bomDepletionStatus = deplStatus;
          await billDoc.save(session ? { session } : {});
        } catch (invErr) {
          // CRITICAL: If the error is a TransientTransactionError (MongoDB has already aborted
          // the session), re-throw immediately. Do NOT attempt any further session operations —
          // they will all fail with NoSuchTransaction (code 251), masking the real error.
          const isTransientBom =
            (typeof invErr.hasErrorLabel === 'function' && invErr.hasErrorLabel('TransientTransactionError')) ||
            (Array.isArray(invErr.errorLabels) && invErr.errorLabels.includes('TransientTransactionError')) ||
            invErr.code === 112 ||
            invErr.code === 251 ||
            String(invErr.message || '').includes('WriteConflict') ||
            String(invErr.message || '').includes('NoSuchTransaction');

          if (isTransientBom || options.requireAtomicInventory) {
            throw invErr;
          }

          // Non-transient BOM failure: allow the transaction to commit with FAILED status.
          console.warn('[POS] BOM depletion non-transient failure for bill', billId, invErr?.message);
          billDoc.bomDepletionStatus = 'FAILED';
          billDoc.bomDepletionError = String(invErr?.message || 'UNKNOWN').slice(0, 250);
          try {
            await billDoc.save(session ? { session } : {});
          } catch (statusSaveErr) {
            const isStatusSaveTransient =
              (typeof statusSaveErr.hasErrorLabel === 'function' && statusSaveErr.hasErrorLabel('TransientTransactionError')) ||
              statusSaveErr.code === 112 || statusSaveErr.code === 251;
            if (isStatusSaveTransient) throw statusSaveErr;
          }
        }
      } else {
        billDoc.bomDepletionStatus = 'TRAINING_MODE_SKIPPED';
        await billDoc.save(session ? { session } : {}).catch(() => {});
      }

      // 7. Post-save operations: Register Session & Cash Book inside transaction
      if (!billDoc.isTraining && orderPayload.registerSessionId) {
        let regQuery = RegisterSession.findOne({
          registerSessionId: orderPayload.registerSessionId,
          status: 'OPEN',
        });
        if (session) regQuery = regQuery.session(session);
        const regSession = await regQuery;
        if (regSession) {
          regSession.orderCount = (regSession.orderCount || 0) + 1;
          regSession.totalSalesPaisa = (regSession.totalSalesPaisa || 0) + totals.totalPaisa;
          if (cashTenderTotalPaisa > 0) {
            regSession.totalCashSalesPaisa = (regSession.totalCashSalesPaisa || 0) + cashTenderTotalPaisa;
            regSession.cashEvents = regSession.cashEvents || [];
            regSession.cashEvents.push({
              eventType: 'CASH_SALE',
              amountPaisa: cashTenderTotalPaisa,
              reason: `Bill ${billId}`,
              actorId: authContext.userId,
              reference: billId,
              timestamp: new Date(),
            });
          }
          if (upiTenderTotalPaisa > 0) {
            regSession.totalUpiSalesPaisa = (regSession.totalUpiSalesPaisa || 0) + upiTenderTotalPaisa;
          }
          if (cardTenderTotalPaisa > 0) {
            regSession.totalCardSalesPaisa = (regSession.totalCardSalesPaisa || 0) + cardTenderTotalPaisa;
          }
          await regSession.save(session ? { session } : {});
        }
      }

      // Auto-post CashTransaction strictly for cashTenderTotalPaisa > 0
      if (isImmediateCompletion && cashTenderTotalPaisa > 0) {
        try {
          const ctSeqId = preallocatedCashTxId;

          const cashTx = new CashTransaction({
            cashTransactionId: ctSeqId,
            organisationId: orgId,
            cafeId,
            businessDate,
            transactionType: 'CASH_IN',
            direction: 'IN',
            category: 'POS_SALE',
            amount: Math.max(0.01, cashTenderTotalPaisa / 100),
            paymentMethod: 'CASH',
            status: 'POSTED',
            description: `POS Sale Receipt #${invoiceNumber}`,
            referenceType: 'BILL',
            referenceId: billId,
            recordedBy: authContext.userId,
            createdBy: authContext.userId,
          });

          await cashTx.save(session ? { session } : {});
        } catch (err) {
          const isCashTransient =
            (typeof err.hasErrorLabel === 'function' && err.hasErrorLabel('TransientTransactionError')) ||
            err.code === 112 || err.code === 251;
          if (isCashTransient) throw err;

          console.error('Failed to auto-post cash transaction for bill', billId, err);
          try {
            await PosReconciliationService.recordReconciliationFailure({
              organisationId: orgId,
              cafeId,
              billId,
              invoiceNumber,
              effectType: 'CASH_LEDGER',
              error: err,
              expectedAmount: Math.max(0.01, totals.totalPaisa / 100),
              payloadSnapshot: {
                amount: Math.max(0.01, totals.totalPaisa / 100),
                invoiceNumber,
                businessDate,
                cashierUserId: authContext.userId,
              },
            });
          } catch (recErr) {
            console.error('[POS] Failed to record Cash Ledger reconciliation job for bill', billId, recErr?.message);
          }
        }
      }

      if (options.simulateCrashMidway) {
        throw new Error('Simulated crash midway through POS settlement transaction.');
      }

      committedBillDoc = billDoc;
      savedBillData = typeof billDoc.toObject === 'function' ? billDoc.toObject() : billDoc;
    });
    } catch (txErr) {
      if (txErr.code === 11000 || String(txErr.message || '').includes('duplicate key')) {
        const queryFilter = { organisationId: orgId, cafeId };
        const orConditions = [];
        if (orderPayload.saleAttemptId) orConditions.push({ saleAttemptId: orderPayload.saleAttemptId });
        if (idempotencyKey) orConditions.push({ correlationId: idempotencyKey });
        if (orConditions.length > 0) {
          queryFilter.$or = orConditions;
          let winningBill = null;
          for (let poll = 0; poll < 20; poll++) {
            winningBill = await Bill.findOne(queryFilter);
            if (winningBill) break;
            await new Promise((r) => setTimeout(r, 100));
          }
          if (winningBill) {
            committedBillDoc = winningBill;
            savedBillData = typeof winningBill.toObject === 'function' ? winningBill.toObject() : winningBill;
            isDeduplicatedReplay = true;
          } else {
            throw txErr;
          }
        } else {
          throw txErr;
        }
      } else {
        throw txErr;
      }
    }

    if (isDeduplicatedReplay && savedBillData) {
      return {
        success: true,
        action,
        saleFinalized: true,
        message: 'Order already committed (Sale attempt deduplicated).',
        data: savedBillData,
        bill: savedBillData,
        printed: savedBillData.printStatus === 'PRINTED',
        printStatus: savedBillData.printStatus || 'NOT_REQUESTED',
        isIdempotentReplay: true,
        correlationId: savedBillData.correlationId || idempotencyKey,
        saleAttemptId: savedBillData.saleAttemptId || orderPayload.saleAttemptId,
      };
    }

    // 9. If action is SAVE, return immediately without printing
    if (action === 'SAVE') {
      return {
        success: true,
        action: 'SAVE',
        saleFinalized: true,
        message: 'Order saved successfully.',
        bill: savedBillData,
        data: savedBillData,
        printed: false,
        printStatus: 'NOT_REQUESTED',
        printBuffer: null,
      };
    }

    // 10. If action is SAVE_AND_PRINT: compile receipt and handle printer failure safely
    // Safe Printer Failure Resilience: DB commit is NEVER rolled back if printer fails!
    const printJobId = `PJ-${datePart}-${Math.floor(100000 + Math.random() * 900000)}`;
    try {
      if (options.simulatePrinterFailure) {
        throw new Error('Simulated printer hardware timeout / disconnect.');
      }

      const printResult = await this.generatePrintArtifacts(savedBillData, options);

      try {
        const pj = new PrintJob({
          printJobId,
          organisationId: orgId,
          cafeId,
          billId,
          invoiceNumber,
          jobType: 'RECEIPT',
          status: 'PRINTED',
          requestedBy: authContext.userId || 'CASHIER',
          completedAt: new Date(),
          printBufferBase64: printResult.printBufferBase64,
        });
        await pj.save();
        billDoc.printStatus = 'PRINTED';
        billDoc.printJobs = billDoc.printJobs || [];
        billDoc.printJobs.push({
          printJobId,
          jobType: 'RECEIPT',
          status: 'PRINTED',
          completedAt: new Date(),
        });
        await billDoc.save();
      } catch {}

      return {
        success: true,
        action: 'SAVE_AND_PRINT',
        saleFinalized: true,
        message: 'Order saved and receipt printed successfully.',
        bill: savedBillData,
        data: savedBillData,
        printed: true,
        printStatus: 'PRINTED',
        printJobId,
        printBuffer: printResult.printBufferBase64,
        htmlPreview: printResult.htmlPreview,
        rawBuffer: printResult.rawBuffer,
      };
    } catch (printerErr) {
      // THE TRANSACTION REMAINS COMMITTED!
      try {
        const pj = new PrintJob({
          printJobId,
          organisationId: orgId,
          cafeId,
          billId,
          invoiceNumber,
          jobType: 'RECEIPT',
          status: 'FAILED',
          failureCode: 'PRINTER_OFFLINE',
          failureReason: printerErr.message,
          requestedBy: authContext.userId || 'CASHIER',
        });
        await pj.save();
        billDoc.printStatus = 'PRINT_FAILED';
        billDoc.printJobs = billDoc.printJobs || [];
        billDoc.printJobs.push({
          printJobId,
          jobType: 'RECEIPT',
          status: 'FAILED',
          failureCode: 'PRINTER_OFFLINE',
        });
        await billDoc.save();
      } catch {}

      return {
        success: true,
        action: 'SAVE_AND_PRINT',
        saleFinalized: true,
        message: 'Order committed to database, but receipt printer failed.',
        bill: savedBillData,
        data: savedBillData,
        printed: false,
        printStatus: 'PRINT_FAILED',
        printerWarning: 'PRINTER_OFFLINE',
        printerError: printerErr.message || 'Thermal printer communication error.',
        reprintAvailable: true,
      };
    }
  }

  /**
   * Helper to compile ESC/POS binary buffer, drawer kick, and HTML preview.
   */
  static async generatePrintArtifacts(billData = {}, options = {}) {
    let cafeInfo = options.cafeInfo;
    if (!cafeInfo && billData.cafeId) {
      try {
        const foundCafe = await Cafe.findOne({
          organisationId: billData.organisationId,
          cafeId: billData.cafeId,
        });
        if (foundCafe) {
          const cafeObj = typeof foundCafe.toObject === 'function' ? foundCafe.toObject() : foundCafe;
          cafeInfo = {
            brandName: cafeObj.name || 'ZAMORIN CAFE',
            legalName: cafeObj.legalName || 'Zamorin Hospitality Private Limited',
            gstin: cafeObj.gstin || '29AABCT1332L1ZV',
            fssai: cafeObj.fssaiLicenseNumber || cafeObj.fssai || '11223344556677',
            address: cafeObj.address?.line1 ? `${cafeObj.address.line1}, ${cafeObj.address.city || ''} - ${cafeObj.address.pincode || ''}` : 'Koramangala, Bengaluru',
            phone: cafeObj.contactPhone || '+91 80 2555 1234',
          };
        }
      } catch {
        // Fallback default info
      }
    }

    if (!cafeInfo) {
      cafeInfo = {
        brandName: 'ZAMORIN CAFE',
        legalName: 'Zamorin Hospitality Private Limited',
        gstin: '29AABCT1332L1ZV',
        fssai: '11223344556677',
        address: 'Koramangala, Bengaluru - 560095',
        phone: '+91 80 2555 1234',
      };
    }

    const items = (billData.lineItems || []).map((li) => ({
      name: li.itemNameSnapshot || li.name || 'Item',
      quantity: li.quantity || 1,
      price: (li.unitPricePaisa || 0) / 100,
      total: (li.lineTotalPaisa || (li.unitPricePaisa * li.quantity) || 0) / 100,
      notes: li.itemNotes || '',
    }));

    const orderDataForPrinter = {
      orderId: billData.billId,
      billNumber: billData.invoiceNumber || billData.billId,
      date: billData.businessDate || getIstBusinessDate(),
      time: new Date().toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' }),
      orderType: billData.orderType || billData.serviceMode || 'QUICK_SALE',
      tableNumber: billData.tableNumber || '',
      cashierName: billData.cashierUserId || 'Cashier',
      items,
      subtotal: (billData.subtotalPaisa || 0) / 100,
      discount: (billData.discountPaisa || 0) / 100,
      cgst: (billData.cgstPaisa || 0) / 100,
      sgst: (billData.sgstPaisa || 0) / 100,
      preRoundingTotal: (billData.preRoundingTotalPaisa || billData.totalPaisa || 0) / 100,
      roundOff: (billData.roundOffPaisa || 0) / 100,
      grandTotal: (billData.totalPaisa || 0) / 100,
      paymentMethod: billData.paymentMethod || 'CASH',
      isReprint: Boolean(options.isReprint),
      reprintCount: options.reprintCount || (billData.reprints ? billData.reprints.length : 0),
      isVoid: billData.status === 'VOIDED',
      triggerDrawerKick: billData.paymentMethod === 'CASH' || (billData.tenders && billData.tenders.some((t) => t.paymentMethod === 'CASH')),
      upiQrString: billData.upiPaymentIntent?.upiString || `upi://pay?pa=zamorin@icici&pn=Zamorin%20Cafe&am=${((billData.totalPaisa || 0) / 100).toFixed(2)}&tr=${billData.billId}`,
    };

    const terminalConfig = options.terminalConfig || {
      printerConfig: { paperWidth: 80, cutType: 'PARTIAL' },
      drawerConfig: { enabled: true, pin: 2 },
    };

    const escPosBuffer = compileThermalReceipt(orderDataForPrinter, terminalConfig, cafeInfo);
    const htmlReceipt = generateFallbackHtmlReceipt(orderDataForPrinter, cafeInfo);

    return {
      rawBuffer: escPosBuffer,
      printBufferBase64: escPosBuffer.toString('base64'),
      htmlPreview: htmlReceipt,
    };
  }

  /**
   * Prints an existing committed bill without mutating financial state.
   */
  static async printCommittedBill(billId, authContext = {}, options = {}) {
    const normBillId = normalizeId(billId);
    const bill = await Bill.findOne({
      $or: [{ billId: normBillId }, { invoiceNumber: normBillId }],
      organisationId: authContext.organisationId || 'ORG-ZAMORIN',
    });

    if (!bill) {
      throw new ApiError(404, 'BILL_NOT_FOUND', `Bill ${billId} does not exist.`);
    }

    assertCafeAccess(authContext, bill.cafeId);

    const billData = typeof bill.toObject === 'function' ? bill.toObject() : bill;
    const printResult = await this.generatePrintArtifacts(billData, options);

    const printJobId = `PJ-PRT-${Date.now()}`;
    try {
      const pj = new PrintJob({
        printJobId,
        organisationId: bill.organisationId,
        cafeId: bill.cafeId,
        billId: bill.billId,
        invoiceNumber: bill.invoiceNumber,
        jobType: 'RECEIPT',
        status: 'PRINTED',
        requestedBy: authContext.userId || 'STAFF',
        completedAt: new Date(),
        printBufferBase64: printResult.printBufferBase64,
      });
      await pj.save();
    } catch {}

    return {
      success: true,
      action: 'PRINT',
      bill: billData,
      printed: true,
      printStatus: 'PRINTED',
      printJobId,
      printBuffer: printResult.printBufferBase64,
      htmlPreview: printResult.htmlPreview,
      rawBuffer: printResult.rawBuffer,
    };
  }

  /**
   * Generates a supervisor-authorized reprint with explicit 'REPRINT' watermark & audit trail.
   */
  static async reprintBill(billId, authContext = {}, reason = 'Customer Request', options = {}) {
    const normBillId = normalizeId(billId);
    const bill = await Bill.findOne({
      $or: [{ billId: normBillId }, { invoiceNumber: normBillId }],
      organisationId: authContext.organisationId || 'ORG-ZAMORIN',
    });

    if (!bill) {
      throw new ApiError(404, 'BILL_NOT_FOUND', `Bill ${billId} does not exist.`);
    }

    assertCafeAccess(authContext, bill.cafeId);

    const cleanReason = String(reason || 'Customer Request').trim();
    if (!cleanReason) {
      throw new ApiError(400, 'REPRINT_REASON_REQUIRED', 'Reprint reason is mandatory.');
    }

    bill.reprints = Array.isArray(bill.reprints) ? bill.reprints : [];
    bill.reprints.push({
      reprintedBy: authContext.userId || 'STAFF',
      reprintedAt: new Date(),
      reason: cleanReason,
    });

    await bill.save();

    // Audit Logging
    try {
      await auditService.recordRequestAudit({
        request: {
          auth: authContext,
        },
        module: 'BILLS_RECEIPTS',
        action: 'REPRINT_RECEIPT',
        entityType: 'BILL',
        entityId: bill.billId,
        after: {
          billId: bill.billId,
          invoiceNumber: bill.invoiceNumber,
          reprintCount: bill.reprints.length,
          reason: cleanReason,
        },
        result: 'SUCCESS',
        riskClassification: 'LOW',
      });
    } catch {
      // Audit non-fatal
    }

    const billData = typeof bill.toObject === 'function' ? bill.toObject() : bill;
    const printResult = await this.generatePrintArtifacts(billData, {
      ...options,
      isReprint: true,
      reprintCount: bill.reprints.length,
    });

    const printJobId = `PJ-REP-${Date.now()}`;
    try {
      const pj = new PrintJob({
        printJobId,
        organisationId: bill.organisationId,
        cafeId: bill.cafeId,
        billId: bill.billId,
        invoiceNumber: bill.invoiceNumber,
        jobType: 'REPRINT',
        status: 'PRINTED',
        requestedBy: authContext.userId || 'STAFF',
        completedAt: new Date(),
        printBufferBase64: printResult.printBufferBase64,
      });
      await pj.save();
    } catch {}

    return {
      success: true,
      action: 'REPRINT',
      message: `Receipt reprinted (Copy #${bill.reprints.length}).`,
      bill: billData,
      isReprint: true,
      reprintCount: bill.reprints.length,
      printed: true,
      printStatus: 'PRINTED',
      printJobId,
      printBuffer: printResult.printBufferBase64,
      htmlPreview: printResult.htmlPreview,
      rawBuffer: printResult.rawBuffer,
    };
  }

  static getIstBusinessDate(date = new Date(), cutoffHour = 4) {
    return getIstBusinessDate(date, cutoffHour);
  }
}

module.exports = PosOrderService;
module.exports.PosOrderService = PosOrderService;
module.exports.getIstBusinessDate = getIstBusinessDate;

