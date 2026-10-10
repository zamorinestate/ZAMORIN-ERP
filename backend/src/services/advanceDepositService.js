'use strict';

/**
 * ADVANCE DEPOSIT SERVICE (P10 STATUTORY ADVANCE LIABILITIES & EVENT BOOKINGS)
 *
 * Implements Statutory Advance Accounting per CBIC GST Rules:
 *  - Advances paid prior to supply issue formal Receipt Voucher (RV-...)
 *  - Advance deposit is an unapplied liability, NOT completed sale revenue
 *  - Core Invariant:
 *    Deposit Monday ₹20,000 -> Sale = ₹0, Cash = ₹20,000, Unapplied = ₹20,000
 *    Final Bill Saturday ₹60,000 -> Apply advance ₹20,000, Collect ₹40,000:
 *    Final Sale = ₹60,000, New money received Saturday = ₹40,000, Advance applied = ₹20,000
 *    (Total revenue recognized = ₹60,000, NOT ₹80,000; Total cash received = ₹60,000, NOT ₹80,000)
 *  - Issues formal Refund Voucher (RFV-...) on unsupplied cancellation
 *  - Concurrency-safe atomic advance application and idempotency
 */

const mongoose = require('mongoose');
const { AdvanceDeposit } = require('../models/AdvanceDeposit');
const { RegisterSession } = require('../models/RegisterSession');
const { CashTransaction } = require('../models/CashTransaction');
const { SequenceCounter } = require('../models/SequenceCounter');
const { executeTransactionWithRetry } = require('../utils/transactionHelper');
const { ApiError } = require('../utils/ApiError');
const { roundToPaisa, TAX_RULE_VERSION } = require('./gstTaxService');
const auditService = require('./auditService');

function getIstBusinessDate(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function normalizeId(val) {
  return typeof val === 'string' ? val.trim().toUpperCase() : '';
}

/**
 * Authoritative Server-Side Supply Classification & Advance Tax Timing Resolution
 *
 * Statutory Invariants per CBIC GST Law:
 * 1. Schedule II Para 6(b) of CGST Act: Supply of food or drinks for consumption
 *    (Restaurant, Dine-in, Takeaway, Catering, Banquet events) is legally a SERVICE (SAC 996331/996332).
 *    These transactions MUST NOT enter the goods branch merely because physical food is supplied!
 * 2. Notification No. 66/2017-Central Tax: Registered persons under REGULAR regime
 *    supplying eligible pure GOODS (e.g. packaged coffee beans HSN 0901, retail merchandise)
 *    have tax liability deferred to invoice issue date (0 tax due at advance receipt timing).
 * 3. An eligible goods advance with zero tax due at receipt NEVER overwrites the supply's applicable GST rate!
 */
function resolveAdvanceTaxTreatment({
  category = null,
  serviceType = null,
  orderType = null,
  supplyType = null,
  taxpayerRegime = 'REGULAR',
  configuredGstRate = null,
  isInterState = false,
  amountPaisa = 0,
}) {
  const normCategory = category ? String(category).toUpperCase().trim() : null;
  const normSupplyType = supplyType ? String(supplyType).toUpperCase().trim() : null;
  const normServiceType = serviceType ? String(serviceType).toUpperCase().trim() : null;
  const normOrderType = orderType ? String(orderType).toUpperCase().trim() : null;
  const normRegime = String(taxpayerRegime || 'REGULAR').toUpperCase().trim();

  // Food & drink service categories: legally classified as SERVICES per CGST Act Schedule II Para 6(b)
  // Restaurant, takeaway and catering transactions must not enter the goods branch merely because they involve physical food.
  const serviceCategories = [
    'RESTAURANT',
    'RESTAURANT_DINE_IN',
    'DINE_IN',
    'TAKEAWAY',
    'OUTDOOR_CATERING',
    'EVENT_BANQUET',
    'BANQUET',
    'CATERING',
    'FOOD_BEVERAGE',
    'QUICK_SALE',
    'SERVICES',
  ];

  // Pure retail goods categories (merchandise, packaged bean retail packs HSN 0901)
  const goodsCategories = [
    'RETAIL_PACKAGED_GOODS',
    'MERCHANDISE',
    'PACKAGED_COFFEE_BEANS',
    'PACKAGED_GOODS',
    'GOODS',
  ];

  // Derive authoritative statutory classification
  const isFoodService =
    (normCategory && serviceCategories.includes(normCategory)) ||
    (normServiceType && serviceCategories.includes(normServiceType)) ||
    (normOrderType && serviceCategories.includes(normOrderType));

  const isRetailGoods =
    (normCategory && goodsCategories.includes(normCategory)) ||
    (!isFoodService && normSupplyType === 'GOODS');

  let supplyClassification = 'SERVICES';
  let statutorySupplyCategory = 'EVENT_BANQUET';

  if (isFoodService) {
    // Restaurant / takeaway / catering are statutory SERVICES regardless of physical food involvement
    supplyClassification = 'SERVICES';
    statutorySupplyCategory = normCategory || 'EVENT_BANQUET';
  } else if (isRetailGoods) {
    supplyClassification = 'GOODS';
    statutorySupplyCategory = normCategory || 'RETAIL_PACKAGED_GOODS';
  } else if (normCategory) {
    supplyClassification = goodsCategories.includes(normCategory) ? 'GOODS' : 'SERVICES';
    statutorySupplyCategory = normCategory;
  } else if (normSupplyType === 'GOODS') {
    supplyClassification = 'GOODS';
    statutorySupplyCategory = 'RETAIL_PACKAGED_GOODS';
  } else {
    supplyClassification = 'SERVICES';
    statutorySupplyCategory = 'EVENT_BANQUET';
  }

  // Determine underlying supply's applicable statutory GST rate
  let applicableSupplyGstRatePercent = 5; // Default restaurant/catering & coffee slab = 5%
  if (configuredGstRate !== null && configuredGstRate !== undefined) {
    applicableSupplyGstRatePercent = Number(configuredGstRate);
  } else if (statutorySupplyCategory === 'MERCHANDISE') {
    applicableSupplyGstRatePercent = 18;
  }

  let taxRatePercentAtAdvance = 0;
  let taxDueAtAdvancePaisa = 0;
  let taxableAmountPaisa = amountPaisa;
  let cgstPaisa = 0;
  let sgstPaisa = 0;
  let igstPaisa = 0;

  if (supplyClassification === 'GOODS') {
    // Under Notification No. 66/2017-CT, REGULAR taxpayers pay 0 tax on advance receipt for goods
    if (normRegime === 'REGULAR') {
      taxRatePercentAtAdvance = 0;
      taxDueAtAdvancePaisa = 0;
      taxableAmountPaisa = amountPaisa;
      cgstPaisa = 0;
      sgstPaisa = 0;
      igstPaisa = 0;
    } else {
      taxRatePercentAtAdvance = 0;
      taxDueAtAdvancePaisa = 0;
      taxableAmountPaisa = amountPaisa;
    }
  } else {
    // SERVICES: Section 13(2) mandates tax on advance receipt
    taxRatePercentAtAdvance = applicableSupplyGstRatePercent;
    if (taxRatePercentAtAdvance > 0) {
      taxableAmountPaisa = roundToPaisa((amountPaisa * 100) / (100 + taxRatePercentAtAdvance));
      taxDueAtAdvancePaisa = amountPaisa - taxableAmountPaisa;
      if (isInterState) {
        igstPaisa = taxDueAtAdvancePaisa;
        cgstPaisa = 0;
        sgstPaisa = 0;
      } else {
        cgstPaisa = roundToPaisa(taxDueAtAdvancePaisa / 2);
        sgstPaisa = taxDueAtAdvancePaisa - cgstPaisa;
        igstPaisa = 0;
      }
    }
  }

  return {
    supplyClassification,
    statutorySupplyCategory,
    taxpayerRegime: normRegime,
    applicableSupplyGstRatePercent,
    taxRatePercentAtAdvance,
    taxDueAtAdvancePaisa,
    taxableAmountPaisa,
    cgstPaisa,
    sgstPaisa,
    igstPaisa,
    taxAccountedOnAdvancePaisa: taxDueAtAdvancePaisa,
  };
}

/**
 * Demonstrate & Calculate Statutory Advance Tax Adjustment on Final Tax Invoice
 *
 * Rules:
 *  - Eligible Goods Advance: Tax on advance was 0, so NO advance tax adjustment is deducted.
 *    The final invoice maintains its full statutory tax rate and tax liability on line items.
 *  - Taxable Services Advance: Tax was already accounted for on the Receipt Voucher.
 *    The tax accounted for on the advance is credited against the final gross tax liability.
 *  - Advance payment applied reduces total invoice payable paisa by the advance amount.
 */
function calculateAdvanceTaxAdjustmentOnFinalInvoice({
  invoiceTotalTaxablePaisa,
  invoiceTaxSummary,
  appliedAdvanceDeposits = [],
}) {
  let advanceAppliedTotalPaisa = 0;
  let advanceTaxAccountedTotalPaisa = 0;
  let advanceCgstAdjustedPaisa = 0;
  let advanceSgstAdjustedPaisa = 0;
  let advanceIgstAdjustedPaisa = 0;

  const advanceDetails = [];

  for (const item of appliedAdvanceDeposits) {
    const deposit = item.deposit || item;
    const amountApplied = item.amountAppliedPaisa || deposit.amountAppliedPaisa || deposit.depositAmountPaisa || 0;
    advanceAppliedTotalPaisa += amountApplied;

    const depositTotal = deposit.depositAmountPaisa || amountApplied;
    const ratio = depositTotal > 0 ? Math.min(1, amountApplied / depositTotal) : 1;

    const depositTaxAccounted = deposit.taxAccountedOnAdvancePaisa ?? deposit.taxDueAtAdvancePaisa ?? ((deposit.cgstPaisa || 0) + (deposit.sgstPaisa || 0) + (deposit.igstPaisa || 0));
    const proportionalTax = roundToPaisa(depositTaxAccounted * ratio);
    const proportionalCgst = roundToPaisa((deposit.cgstPaisa || 0) * ratio);
    const proportionalSgst = roundToPaisa((deposit.sgstPaisa || 0) * ratio);
    const proportionalIgst = roundToPaisa((deposit.igstPaisa || 0) * ratio);

    advanceTaxAccountedTotalPaisa += proportionalTax;
    advanceCgstAdjustedPaisa += proportionalCgst;
    advanceSgstAdjustedPaisa += proportionalSgst;
    advanceIgstAdjustedPaisa += proportionalIgst;

    advanceDetails.push({
      depositId: deposit.depositId,
      receiptVoucherNumber: deposit.receiptVoucherNumber,
      supplyClassification: deposit.supplyClassification || deposit.supplyType || 'SERVICES',
      amountAppliedPaisa: amountApplied,
      taxAccountedOnAdvancePaisa: proportionalTax,
      cgstAdjustedPaisa: proportionalCgst,
      sgstAdjustedPaisa: proportionalSgst,
      igstAdjustedPaisa: proportionalIgst,
    });
  }

  const grossTaxPaisa = invoiceTaxSummary?.totalTaxPaisa || 0;
  const grossGrandTotalPaisa = invoiceTaxSummary?.grandTotalPaisa || 0;

  // Net tax remaining to be collected on final invoice after advance credit
  const netCgstPayablePaisa = Math.max(0, (invoiceTaxSummary?.totalCgstPaisa || 0) - advanceCgstAdjustedPaisa);
  const netSgstPayablePaisa = Math.max(0, (invoiceTaxSummary?.totalSgstPaisa || 0) - advanceSgstAdjustedPaisa);
  const netIgstPayablePaisa = Math.max(0, (invoiceTaxSummary?.totalIgstPaisa || 0) - advanceIgstAdjustedPaisa);
  const netTaxPayablePaisa = netCgstPayablePaisa + netSgstPayablePaisa + netIgstPayablePaisa;

  // Net payable amount remaining from customer
  const netCustomerPayablePaisa = Math.max(0, grossGrandTotalPaisa - advanceAppliedTotalPaisa);

  return {
    grossGrandTotalPaisa,
    grossTaxPaisa,
    advanceAppliedTotalPaisa,
    advanceTaxAccountedTotalPaisa,
    advanceCgstAdjustedPaisa,
    advanceSgstAdjustedPaisa,
    advanceIgstAdjustedPaisa,
    netCgstPayablePaisa,
    netSgstPayablePaisa,
    netIgstPayablePaisa,
    netTaxPayablePaisa,
    netCustomerPayablePaisa,
    appliedAdvances: advanceDetails,
  };
}

/**
 * Record an advance deposit for an event / catering / institutional order.
 * Issues a formal statutory Receipt Voucher (RV-...).
 */
async function recordAdvanceDeposit({
  organisationId,
  cafeId,
  customerId = '',
  customerName,
  customerPhone = '',
  customerGstin = '',
  eventReference = '',
  eventDate = null,
  amountPaisa,
  category = null,
  serviceType = null,
  orderType = null,
  supplyType = null,
  taxpayerRegime = 'REGULAR',
  taxRatePercent: requestedTaxRate = null,
  isInterState = false,
  paymentMethod = 'CASH',
  provider = '',
  paymentReference = '',
  registerSessionId = null,
  notes = '',
  idempotencyKey = null,
  authContext = {},
}) {
  const orgId = normalizeId(organisationId);
  const cleanCafe = normalizeId(cafeId);
  const amount = Math.max(0, Math.round(Number(amountPaisa) || 0));

  if (!orgId || !cleanCafe) {
    throw new ApiError(400, 'VALIDATION_FAILED', 'organisationId and cafeId are required.');
  }
  if (!customerName || !customerName.trim()) {
    throw new ApiError(400, 'VALIDATION_FAILED', 'customerName is required.');
  }
  if (amount <= 0) {
    throw new ApiError(400, 'INVALID_AMOUNT', 'Advance deposit amount must be greater than zero.');
  }

  // Idempotency check
  if (idempotencyKey) {
    const existing = await AdvanceDeposit.findOne({ organisationId: orgId, idempotencyKey });
    if (existing) {
      return {
        idempotentReplay: true,
        deposit: existing,
        receiptVoucherNumber: existing.receiptVoucherNumber,
      };
    }
  }

  const businessDate = getIstBusinessDate();
  const dateCompact = businessDate.replace(/-/g, '');

  let depositSeq;
  let receiptVoucherSeq;
  try {
    depositSeq = await SequenceCounter.generateId({
      organisationId: orgId,
      sequenceKey: `DEP_${dateCompact}`,
      prefix: `DEP-${dateCompact}`,
      minimumDigits: 4,
    });
    receiptVoucherSeq = await SequenceCounter.generateId({
      organisationId: orgId,
      sequenceKey: `RV_${dateCompact}`,
      prefix: `RV-${dateCompact}`,
      minimumDigits: 4,
    });
  } catch {
    const rand = Date.now().toString(36).toUpperCase();
    depositSeq = `DEP-${dateCompact}-${rand}`;
    receiptVoucherSeq = `RV-${dateCompact}-${rand}`;
  }

  // Authoritative server-side supply classification and advance tax timing resolution
  const taxTreatment = resolveAdvanceTaxTreatment({
    category,
    serviceType,
    orderType,
    supplyType,
    taxpayerRegime,
    configuredGstRate: requestedTaxRate,
    isInterState,
    amountPaisa: amount,
  });

  return await executeTransactionWithRetry(async (session) => {
    const deposit = new AdvanceDeposit({
      depositId: depositSeq,
      receiptVoucherNumber: receiptVoucherSeq,
      organisationId: orgId,
      cafeId: cleanCafe,
      customerId: normalizeId(customerId),
      customerName: customerName.trim(),
      customerPhone: customerPhone ? String(customerPhone).trim() : '',
      customerGstin: customerGstin ? normalizeId(customerGstin) : '',
      eventReference: eventReference ? String(eventReference).trim() : '',
      eventDate: eventDate || null,
      depositAmountPaisa: amount,
      unappliedAmountPaisa: amount,
      appliedAmountPaisa: 0,
      refundedAmountPaisa: 0,
      paymentMethod,
      provider: provider || '',
      paymentReference: paymentReference || '',
      registerSessionId: registerSessionId || null,
      supplyType: taxTreatment.supplyClassification,
      supplyClassification: taxTreatment.supplyClassification,
      statutorySupplyCategory: taxTreatment.statutorySupplyCategory,
      taxpayerRegime: taxTreatment.taxpayerRegime,
      applicableSupplyGstRatePercent: taxTreatment.applicableSupplyGstRatePercent,
      taxRatePercentAtAdvance: taxTreatment.taxRatePercentAtAdvance,
      taxDueAtAdvancePaisa: taxTreatment.taxDueAtAdvancePaisa,
      taxAccountedOnAdvancePaisa: taxTreatment.taxAccountedOnAdvancePaisa,
      taxableAmountPaisa: taxTreatment.taxableAmountPaisa,
      taxRatePercent: taxTreatment.taxRatePercentAtAdvance,
      taxRuleVersion: TAX_RULE_VERSION,
      cgstPaisa: taxTreatment.cgstPaisa,
      sgstPaisa: taxTreatment.sgstPaisa,
      igstPaisa: taxTreatment.igstPaisa,
      status: 'HELD_UNAPPLIED',
      applications: [],
      refunds: [],
      idempotencyKey: idempotencyKey || null,
      receivedAt: new Date(),
      receivedByUserId: authContext.userId || 'SYSTEM',
      notes: notes || '',
    });

    await deposit.save(session ? { session } : {});

    // If paid in CASH at the café, register in current RegisterSession expectedCash
    if (paymentMethod === 'CASH') {
      let regSession = null;
      if (registerSessionId) {
        regSession = await (session
          ? RegisterSession.findOne({ registerSessionId, status: 'OPEN' }).session(session)
          : RegisterSession.findOne({ registerSessionId, status: 'OPEN' }));
      } else {
        regSession = await (session
          ? RegisterSession.findOne({ organisationId: orgId, cafeId: cleanCafe, status: 'OPEN' }).session(session)
          : RegisterSession.findOne({ organisationId: orgId, cafeId: cleanCafe, status: 'OPEN' }));
      }

      if (regSession) {
        regSession.expectedCashPaisa = (regSession.expectedCashPaisa || 0) + amount;
        regSession.cashEvents = regSession.cashEvents || [];
        regSession.cashEvents.push({
          eventType: 'ADVANCE_DEPOSIT',
          amountPaisa: amount,
          reason: `Advance Deposit ${depositSeq} (${receiptVoucherSeq})`,
          actorId: authContext.userId || 'SYSTEM',
          reference: depositSeq,
          timestamp: new Date(),
        });
        await regSession.save(session ? { session } : {});
      }

      // Record in CashTransaction ledger
      try {
        const ctSeqId = `CT-${businessDate.replace(/-/g, '')}-${Math.floor(1000 + Math.random() * 9000)}`;
        const cashTx = new CashTransaction({
          cashTransactionId: ctSeqId,
          organisationId: orgId,
          cafeId: cleanCafe,
          businessDate,
          transactionType: 'CASH_IN',
          direction: 'IN',
          category: 'ADVANCE_DEPOSIT',
          amount: amount / 100,
          paymentMethod: 'CASH',
          status: 'POSTED',
          description: `Customer Advance Deposit: ${customerName} (${receiptVoucherSeq})`,
          referenceType: 'ADVANCE_DEPOSIT',
          referenceId: depositSeq,
          recordedBy: authContext.userId || 'SYSTEM',
          createdBy: authContext.userId || 'SYSTEM',
        });
        await cashTx.save(session ? { session } : {});
      } catch (ctErr) {
        console.warn('[ADVANCE] Could not post CashTransaction:', ctErr?.message);
      }
    }

    if (authContext && authContext.userId) {
      await auditService.recordAuditEvent({
        organisationId: orgId,
        cafeId: cleanCafe,
        userId: authContext.userId,
        eventCategory: 'FINANCE',
        eventType: 'ADVANCE_DEPOSIT_RECORDED',
        resourceType: 'AdvanceDeposit',
        resourceId: depositSeq,
        details: {
          receiptVoucherNumber: receiptVoucherSeq,
          depositAmountPaisa: amount,
          customerName,
          paymentMethod,
        },
      }).catch(() => {});
    }

    return {
      success: true,
      deposit,
      receiptVoucherNumber: receiptVoucherSeq,
      unappliedAmountPaisa: amount,
    };
  });
}

/**
 * Apply an advance deposit to a final commercial Bill.
 * Core Invariant:
 *  - Reduces unappliedAmountPaisa on AdvanceDeposit
 *  - Increases settled amount on Bill
 *  - Does NOT create another cash/bank receipt (money was received earlier!)
 *  - Concurrency-safe: cannot apply more than unappliedAmountPaisa
 */
async function applyAdvanceToBillAtomic({
  organisationId,
  depositId,
  billId,
  invoiceNumber = '',
  amountToApplyPaisa,
  authContext = {},
  session = null,
}) {
  const orgId = normalizeId(organisationId);
  const depId = normalizeId(depositId);
  const cleanBillId = normalizeId(billId);
  const amount = Math.max(0, Math.round(Number(amountToApplyPaisa) || 0));

  if (!orgId || !depId || !cleanBillId) {
    throw new ApiError(400, 'VALIDATION_FAILED', 'organisationId, depositId and billId are required.');
  }
  if (amount <= 0) {
    throw new ApiError(400, 'INVALID_AMOUNT', 'Amount to apply must be greater than zero.');
  }

  // Find deposit
  const query = { organisationId: orgId, depositId: depId };
  const deposit = await (session ? AdvanceDeposit.findOne(query).session(session) : AdvanceDeposit.findOne(query));

  if (!deposit) {
    throw new ApiError(404, 'DEPOSIT_NOT_FOUND', `Advance deposit ${depId} not found.`);
  }

  if (deposit.unappliedAmountPaisa < amount) {
    throw new ApiError(
      409,
      'INSUFFICIENT_UNAPPLIED_DEPOSIT',
      `Requested application of ₹${(amount / 100).toFixed(2)} exceeds unapplied advance deposit balance of ₹${(
        deposit.unappliedAmountPaisa / 100
      ).toFixed(2)}.`
    );
  }

  const applicationId = `APP-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;
  const applicationEntry = {
    applicationId,
    billId: cleanBillId,
    invoiceNumber: String(invoiceNumber || '').trim(),
    amountAppliedPaisa: amount,
    appliedAt: new Date(),
    appliedByUserId: authContext.userId || 'SYSTEM',
    notes: `Applied to Bill ${cleanBillId}`,
  };

  const updatedDeposit = await AdvanceDeposit.findOneAndUpdate(
    {
      _id: deposit._id,
      unappliedAmountPaisa: { $gte: amount },
    },
    {
      $inc: {
        unappliedAmountPaisa: -amount,
        appliedAmountPaisa: amount,
      },
      $push: {
        applications: applicationEntry,
      },
    },
    {
      new: true,
      session: session || undefined,
    }
  );

  if (!updatedDeposit) {
    throw new ApiError(
      409,
      'CONCURRENT_DEPOSIT_APPLICATION_FAILED',
      'Failed to apply advance deposit due to concurrent modification.'
    );
  }

  if (updatedDeposit.unappliedAmountPaisa === 0) {
    updatedDeposit.status = 'FULLY_APPLIED';
  } else {
    updatedDeposit.status = 'PARTIALLY_APPLIED';
  }
  await updatedDeposit.save(session ? { session } : {});

  if (authContext && authContext.userId) {
    await auditService.recordAuditEvent({
      organisationId: orgId,
      cafeId: deposit.cafeId,
      userId: authContext.userId,
      eventCategory: 'FINANCE',
      eventType: 'ADVANCE_DEPOSIT_APPLIED',
      resourceType: 'AdvanceDeposit',
      resourceId: depId,
      details: {
        applicationId,
        billId: cleanBillId,
        amountAppliedPaisa: amount,
        remainingUnappliedPaisa: updatedDeposit.unappliedAmountPaisa,
      },
    }).catch(() => {});
  }

  return {
    success: true,
    application: applicationEntry,
    unappliedRemainingPaisa: updatedDeposit.unappliedAmountPaisa,
    deposit: updatedDeposit,
  };
}

/**
 * Refund an unused advance deposit when contemplated event/supply does not occur.
 * Issues statutory Refund Voucher (RFV-...).
 * Inventory is NOT restored (no inventory moved).
 */
async function refundAdvanceAtomic({
  organisationId,
  depositId,
  amountToRefundPaisa = null,
  reason,
  paymentMethod = 'CASH',
  paymentReference = '',
  registerSessionId = null,
  authContext = {},
}) {
  const orgId = normalizeId(organisationId);
  const depId = normalizeId(depositId);

  if (!orgId || !depId) {
    throw new ApiError(400, 'VALIDATION_FAILED', 'organisationId and depositId are required.');
  }
  if (!reason || !reason.trim()) {
    throw new ApiError(400, 'REASON_REQUIRED', 'A mandatory reason is required to refund an advance.');
  }

  return await executeTransactionWithRetry(async (session) => {
    const deposit = await (session
      ? AdvanceDeposit.findOne({ organisationId: orgId, depositId: depId }).session(session)
      : AdvanceDeposit.findOne({ organisationId: orgId, depositId: depId }));

    if (!deposit) {
      throw new ApiError(404, 'DEPOSIT_NOT_FOUND', `Advance deposit ${depId} not found.`);
    }

    if (deposit.unappliedAmountPaisa <= 0) {
      throw new ApiError(
        409,
        'NO_REFUNDABLE_BALANCE',
        `Advance deposit ${depId} has ₹0 unapplied balance available for refund.`
      );
    }

    const refundAmount = amountToRefundPaisa
      ? Math.min(deposit.unappliedAmountPaisa, Math.max(0, Math.round(Number(amountToRefundPaisa))))
      : deposit.unappliedAmountPaisa;

    if (refundAmount <= 0) {
      throw new ApiError(400, 'INVALID_AMOUNT', 'Refund amount must be greater than zero.');
    }

    const businessDate = getIstBusinessDate();
    const dateCompact = businessDate.replace(/-/g, '');

    let refundVoucherSeq;
    try {
      refundVoucherSeq = await SequenceCounter.generateId({
        organisationId: orgId,
        sequenceKey: `RFV_${dateCompact}`,
        prefix: `RFV-${dateCompact}`,
        minimumDigits: 4,
      });
    } catch {
      refundVoucherSeq = `RFV-${dateCompact}-${Date.now().toString(36).toUpperCase()}`;
    }

    const refundId = `REF-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;
    const refundEntry = {
      refundId,
      refundVoucherNumber: refundVoucherSeq,
      amountRefundedPaisa: refundAmount,
      reason: reason.trim(),
      refundedAt: new Date(),
      refundedByUserId: authContext.userId || 'SYSTEM',
      paymentMethod,
      paymentReference: paymentReference || '',
    };

    const updatedDeposit = await AdvanceDeposit.findOneAndUpdate(
      {
        _id: deposit._id,
        unappliedAmountPaisa: { $gte: refundAmount },
      },
      {
        $inc: {
          unappliedAmountPaisa: -refundAmount,
          refundedAmountPaisa: refundAmount,
        },
        $push: {
          refunds: refundEntry,
        },
      },
      {
        new: true,
        session: session || undefined,
      }
    );

    if (!updatedDeposit) {
      throw new ApiError(409, 'CONCURRENT_REFUND_FAILED', 'Could not refund advance due to concurrent update.');
    }

    if (updatedDeposit.unappliedAmountPaisa === 0) {
      updatedDeposit.status = updatedDeposit.appliedAmountPaisa > 0 ? 'PARTIALLY_REFUNDED' : 'FULLY_REFUNDED';
    } else {
      updatedDeposit.status = 'PARTIALLY_REFUNDED';
    }
    await updatedDeposit.save(session ? { session } : {});

    // If refunded in CASH, decrease expectedCashPaisa in active session
    if (paymentMethod === 'CASH') {
      let regSession = null;
      if (registerSessionId) {
        regSession = await (session
          ? RegisterSession.findOne({ registerSessionId, status: 'OPEN' }).session(session)
          : RegisterSession.findOne({ registerSessionId, status: 'OPEN' }));
      } else {
        regSession = await (session
          ? RegisterSession.findOne({ organisationId: orgId, cafeId: deposit.cafeId, status: 'OPEN' }).session(session)
          : RegisterSession.findOne({ organisationId: orgId, cafeId: deposit.cafeId, status: 'OPEN' }));
      }

      if (regSession) {
        regSession.expectedCashPaisa = Math.max(0, (regSession.expectedCashPaisa || 0) - refundAmount);
        regSession.cashEvents = regSession.cashEvents || [];
        regSession.cashEvents.push({
          eventType: 'ADVANCE_REFUND',
          amountPaisa: refundAmount,
          reason: `Advance Refund ${depId} (${refundVoucherSeq})`,
          actorId: authContext.userId || 'SYSTEM',
          reference: depId,
          timestamp: new Date(),
        });
        await regSession.save(session ? { session } : {});
      }
    }

    if (authContext && authContext.userId) {
      await auditService.recordAuditEvent({
        organisationId: orgId,
        cafeId: deposit.cafeId,
        userId: authContext.userId,
        eventCategory: 'FINANCE',
        eventType: 'ADVANCE_DEPOSIT_REFUNDED',
        resourceType: 'AdvanceDeposit',
        resourceId: depId,
        details: {
          refundVoucherNumber: refundVoucherSeq,
          amountRefundedPaisa: refundAmount,
          reason,
        },
      }).catch(() => {});
    }

    return {
      success: true,
      deposit: updatedDeposit,
      refundVoucherNumber: refundVoucherSeq,
      refundedAmountPaisa: refundAmount,
      remainingUnappliedPaisa: updatedDeposit.unappliedAmountPaisa,
    };
  });
}

/**
 * List deposits with filters
 */
async function listAdvanceDeposits({
  organisationId,
  cafeId = null,
  customerId = null,
  status = null,
}) {
  const filter = { organisationId: normalizeId(organisationId) };
  if (cafeId && cafeId !== 'ALL') filter.cafeId = normalizeId(cafeId);
  if (customerId) filter.customerId = normalizeId(customerId);
  if (status) filter.status = status;

  return await AdvanceDeposit.find(filter).sort({ receivedAt: -1 }).lean();
}

module.exports = {
  recordAdvanceDeposit,
  applyAdvanceToBillAtomic,
  refundAdvanceAtomic,
  listAdvanceDeposits,
  resolveAdvanceTaxTreatment,
  calculateAdvanceTaxAdjustmentOnFinalInvoice,
};
