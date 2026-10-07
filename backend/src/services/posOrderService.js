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

    // 2. Resolve line item prices if not supplied in payload
    const itemIds = (orderPayload.lineItems || []).map((li) => normalizeId(li.menuItemId)).filter(Boolean);
    let itemMap = {};
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
      } catch {
        // Fallback to payload prices
      }
    }

    // Enrich line items with catalog metadata if available
    // REC-13: Server Catalog Pricing Authority — client IndexedDB prices cannot override catalog
    const enrichedItems = orderPayload.lineItems.map((li) => {
      const catalogItem = itemMap[normalizeId(li.menuItemId)];
      const authoritativeUnitPrice = (catalogItem && catalogItem.currentPricePaisa != null)
        ? catalogItem.currentPricePaisa
        : (li.unitPricePaisa ?? li.pricePaisa ?? (li.price != null ? li.price * 100 : 0));

      return {
        ...li,
        itemNameSnapshot: li.itemNameSnapshot || li.name || catalogItem?.name || 'Item',
        unitPricePaisa: authoritativeUnitPrice,
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

    // 4. Generate Official Receipt and Statutory GST Invoice Number (Rule 46(b) <= 16 chars)
    // IMPORTANT: billId and invoiceNumber are allocated OUTSIDE the transaction using the
    // block-pool path (no session) for high throughput. This avoids the lock-contention hotspot
    // where 20+ concurrent transactions all lock the same sequence_counter document, causing
    // nearly all of them to get WriteConflict → TransientTransactionError → exhausted retries.
    // Correctness is enforced by the unique index on Bill.billId — not by the counter.
    // Gaps in sequence (from aborted transactions) are acceptable per business rules.
    let billId = null;
    let invoiceNumber = null;

    try {
      billId = await SequenceCounter.generateId({
        organisationId: orgId,
        sequenceKey: `BILL_${datePart}`,
        prefix: `BILL-${datePart}`,
        minimumDigits: 4,
        // NO session: use the fast block-pool path
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

    // 5. Build Tenders & Payment Status
    const paymentMethod = normalizeId(orderPayload.paymentMethod || 'CASH') || 'CASH';
    const isImmediateCompletion = orderPayload.isImmediateCompletion !== false;
    const initialStatus = isImmediateCompletion ? 'COMPLETED' : 'OPEN';
    const paymentStatus = isImmediateCompletion ? 'PAID' : 'UNPAID';

    const tenders = Array.isArray(orderPayload.tenders) && orderPayload.tenders.length > 0
      ? orderPayload.tenders.map((t) => ({
          paymentMethod: normalizeId(t.paymentMethod || paymentMethod),
          amountPaisa: Math.max(0, Math.round(Number(t.amountPaisa || 0))),
          status: 'COMPLETED',
          provider: t.provider || '',
          paymentReference: t.paymentReference || '',
          upiReference: t.upiReference || '',
          maskedCard: t.maskedCard || '',
          transactionTimestamp: new Date(),
        }))
      : isImmediateCompletion
        ? [
            {
              paymentMethod,
              amountPaisa: totals.totalPaisa,
              status: 'COMPLETED',
              provider: orderPayload.provider || '',
              paymentReference: orderPayload.paymentReference || '',
              upiReference: orderPayload.upiReference || '',
              transactionTimestamp: new Date(),
            },
          ]
        : [];

    // Pre-allocate cash transaction ID (outside transaction for the same hotspot reason as billId)
    let preallocatedCashTxId = null;
    if (isImmediateCompletion && paymentMethod === 'CASH') {
      try {
        preallocatedCashTxId = await SequenceCounter.generateId({
          organisationId: orgId,
          sequenceKey: `CASH_TX_${datePart}`,
          prefix: `CT-${datePart}`,
          minimumDigits: 4,
          // NO session: use the fast block-pool path
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
        orderType: orderPayload.orderType || 'QUICK_SALE',
        serviceMode: orderPayload.serviceMode || orderPayload.orderType || 'QUICK_SALE',
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
        paymentMethod,
        paymentStatus,
        status: initialStatus,
        tenders,
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
          // Set the status on the in-memory doc and save it within the still-live session.
          console.warn('[POS] BOM depletion non-transient failure for bill', billId, invErr?.message);
          billDoc.bomDepletionStatus = 'FAILED';
          billDoc.bomDepletionError = String(invErr?.message || 'UNKNOWN').slice(0, 250);
          try {
            await billDoc.save(session ? { session } : {});
          } catch (statusSaveErr) {
            // If this save also fails transiently, escalate so the retry loop handles it
            const isStatusSaveTransient =
              (typeof statusSaveErr.hasErrorLabel === 'function' && statusSaveErr.hasErrorLabel('TransientTransactionError')) ||
              statusSaveErr.code === 112 || statusSaveErr.code === 251;
            if (isStatusSaveTransient) throw statusSaveErr;
            // Otherwise accept the status won't be set in this commit; reconciliation handles it
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
          if (paymentMethod === 'CASH') {
            regSession.totalCashSalesPaisa = (regSession.totalCashSalesPaisa || 0) + totals.totalPaisa;
            regSession.cashEvents = regSession.cashEvents || [];
            regSession.cashEvents.push({
              eventType: 'CASH_SALE',
              amountPaisa: totals.totalPaisa,
              reason: `Bill ${billId}`,
              actorId: authContext.userId,
              reference: billId,
              timestamp: new Date(),
            });
          } else if (paymentMethod === 'UPI') {
            regSession.totalUpiSalesPaisa = (regSession.totalUpiSalesPaisa || 0) + totals.totalPaisa;
          } else if (paymentMethod === 'CARD') {
            regSession.totalCardSalesPaisa = (regSession.totalCardSalesPaisa || 0) + totals.totalPaisa;
          }
          await regSession.save(session ? { session } : {});
        }
      }

      if (isImmediateCompletion && paymentMethod === 'CASH') {
        try {
          // Use the pre-allocated cash transaction ID (no-session block-pool, hotspot-free)
          const ctSeqId = preallocatedCashTxId;

          const cashTx = new CashTransaction({
            cashTransactionId: ctSeqId,
            organisationId: orgId,
            cafeId,
            businessDate,
            transactionType: 'CASH_IN',
            direction: 'IN',
            category: 'POS_SALE',
            amount: Math.max(0.01, totals.totalPaisa / 100),
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
          // Re-throw transient errors so the retry loop handles them cleanly
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

