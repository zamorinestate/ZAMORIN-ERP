'use strict';

/**
 * POS CONTROLLER (SCREEN 005 / PRIMARY MASTER PROGRAMME STAGE 06)
 *
 * Exposes authoritative POS API endpoints:
 *  - POST /api/v1/pos/orders/commit (Save, Print, Save & Print with idempotency)
 *  - POST /api/v1/pos/orders/preview (Real-time calculations & receipt preview)
 *  - POST /api/v1/pos/orders/:billId/print (Print existing committed bill)
 *  - POST /api/v1/pos/orders/:billId/reprint (Reprint with copy counter & watermark)
 *  - GET  /api/v1/pos/orders/active/:cafeId (Fetch active open tickets)
 */

const { PosOrderService } = require('../services/posOrderService');
const { PosReconciliationService } = require('../services/posReconciliationService');
const { Bill } = require('../models/Bill');
const { IdempotencyRecord } = require('../models/IdempotencyRecord');
const { asyncHandler } = require('../utils/asyncHandler');
const { ApiError } = require('../utils/ApiError');
const { assertResourceCafeOwnership, resolveEffectiveCafeScope } = require('../utils/cafeScope');

function normalizeId(value) {
  return typeof value === 'string' ? value.trim().toUpperCase() : '';
}

function assertCafeAccess(request, cafeId) {
  if (request.auth?.role === 'STAFF') {
    throw new ApiError(
      403,
      'PERMISSION_DENIED',
      'Staff role is restricted to self-service only and does not have POS & Billing operational authority.'
    );
  }
  if (request.auth?.role === 'OWNER') {
    throw new ApiError(
      403,
      'PERMISSION_DENIED',
      'Owner persona is restricted to executive oversight and governance and does not have direct POS terminal operational authority.'
    );
  }
  const normCafeId = normalizeId(cafeId);
  const effectiveCafe = resolveEffectiveCafeScope(request);
  if (effectiveCafe && normCafeId && normCafeId !== effectiveCafe) {
    throw new ApiError(
      403,
      'CROSS_CAFE_RESOURCE_DENIED',
      'Cross-café access is denied. You are not authorized for the requested café.'
    );
  }
  if (request.auth.role === 'MASTER') return;
  if (!request.auth.assignedCafeIds || !request.auth.assignedCafeIds.map(normalizeId).includes(normCafeId)) {
    throw new ApiError(
      403,
      'CAFE_ACCESS_DENIED',
      'You do not have access to this café.'
    );
  }
}

/**
 * POST /api/v1/pos/orders/commit
 * Executes Save, Print, or Save & Print pipeline.
 */
const commitOrder = asyncHandler(async (request, response) => {
  const { action = 'SAVE_AND_PRINT', ...orderPayload } = request.body || {};
  const cafeId = normalizeId(orderPayload.cafeId || request.auth.primaryCafeId || request.auth.assignedCafeIds?.[0]);

  if (!cafeId) {
    throw new ApiError(400, 'CAFE_ID_REQUIRED', 'cafeId is required to process POS transactions.');
  }

  assertCafeAccess(request, cafeId);

  const idempotencyKey = request.body.idempotencyKey || request.headers['x-idempotency-key'] || null;

  const result = await PosOrderService.processOrder(
    { ...orderPayload, cafeId, idempotencyKey },
    request.auth,
    action,
    {
      idempotencyKey,
      simulatePrinterFailure: Boolean(request.body.simulatePrinterFailure),
    }
  );

  return response.status(200).json(result);
});

/**
 * POST /api/v1/pos/orders/preview
 * Returns computed taxes, totals, and receipt HTML markup without persisting to DB.
 */
const previewOrder = asyncHandler(async (request, response) => {
  const orderPayload = request.body || {};
  const cafeId = normalizeId(orderPayload.cafeId || request.auth.primaryCafeId || request.auth.assignedCafeIds?.[0]);

  if (cafeId) {
    assertCafeAccess(request, cafeId);
  }

  const result = await PosOrderService.previewReceipt(orderPayload, request.auth);
  return response.status(200).json(result);
});

/**
 * POST /api/v1/pos/orders/:billId/print
 * Generates thermal print buffer for an existing committed bill.
 */
const printOrder = asyncHandler(async (request, response) => {
  const billId = normalizeId(request.params.billId);
  const result = await PosOrderService.printCommittedBill(billId, request.auth);
  return response.status(200).json(result);
});

/**
 * POST /api/v1/pos/orders/:billId/reprint
 * Generates an authorized reprint with copy counter and watermark.
 */
const reprintOrder = asyncHandler(async (request, response) => {
  const billId = normalizeId(request.params.billId);
  const { reason = 'Customer Request' } = request.body || {};
  const result = await PosOrderService.reprintBill(billId, request.auth, reason);
  return response.status(200).json(result);
});

/**
 * GET /api/v1/pos/orders/active/:cafeId
 * Retrieves active/open bills/tickets for a café.
 */
const getActiveOrders = asyncHandler(async (request, response) => {
  const cafeId = normalizeId(request.params.cafeId);
  assertCafeAccess(request, cafeId);

  const bills = await Bill.find({
    organisationId: request.auth.organisationId,
    cafeId,
    status: { $in: ['OPEN', 'HELD'] },
  }).sort({ createdAt: -1 });

  return response.status(200).json({
    success: true,
    count: bills.length,
    data: bills,
  });
});

/**
 * GET /api/v1/pos/orders/last/:cafeId
 * Retrieves the most recent finalized bill for a café, enabling browser-refresh resilient reprint (CTL-05).
 */
const getLastCommittedBill = asyncHandler(async (request, response) => {
  const cafeId = normalizeId(request.params.cafeId || request.query.cafeId || request.auth.primaryCafeId || request.auth.assignedCafeIds?.[0]);
  if (!cafeId) {
    throw new ApiError(400, 'CAFE_ID_REQUIRED', 'cafeId is required to retrieve the last receipt.');
  }

  assertCafeAccess(request, cafeId);

  const bill = await Bill.findOne({
    organisationId: request.auth.organisationId,
    cafeId,
    status: { $in: ['COMPLETED', 'PARTIALLY_REFUNDED'] },
  }).sort({ createdAt: -1 });

  if (!bill) {
    throw new ApiError(404, 'NO_RECENT_BILLS', 'No recent finalized bill found for this café.');
  }

  const billData = typeof bill.toObject === 'function' ? bill.toObject() : bill;
  return response.status(200).json({
    success: true,
    data: billData,
    bill: billData,
  });
});

/**
 * GET /api/v1/pos/orders/status/:transactionId
 * REC-04B: Resolves transaction status by exact transaction identity (idempotencyKey or saleAttemptId).
 * Safe recovery after unknown network outcomes without relying on "Reprint Last".
 */
const getOrderStatusByIdempotency = asyncHandler(async (request, response) => {
  const transactionId = String(request.params.transactionId || '').trim();
  if (!transactionId) {
    throw new ApiError(400, 'TRANSACTION_ID_REQUIRED', 'transactionId (idempotencyKey or saleAttemptId) is required.');
  }

  const orgId = request.auth?.organisationId || 'ORG-ZAMORIN';
  const cafeId = request.query.cafeId ? normalizeId(request.query.cafeId) : null;

  const billQuery = {
    organisationId: orgId,
    $or: [{ correlationId: transactionId }, { saleAttemptId: transactionId }],
  };
  if (cafeId) billQuery.cafeId = cafeId;

  const bill = await Bill.findOne(billQuery);
  if (bill) {
    const billData = typeof bill.toObject === 'function' ? bill.toObject() : bill;
    return response.status(200).json({
      success: true,
      status: 'COMPLETED',
      saleFinalized: true,
      transactionId,
      billId: billData.billId,
      invoiceNumber: billData.invoiceNumber,
      bill: billData,
      data: billData,
      message: 'Transaction completed successfully.',
    });
  }

  const recordQuery = {
    organisationId: orgId,
    $or: [{ idempotencyKey: transactionId }, { saleAttemptId: transactionId }],
  };
  if (cafeId) recordQuery.cafeId = cafeId;

  const record = await IdempotencyRecord.findOne(recordQuery);
  if (record) {
    if (record.status === 'COMPLETED') {
      return response.status(200).json({
        success: true,
        status: 'COMPLETED',
        saleFinalized: true,
        transactionId,
        billId: record.billId,
        invoiceNumber: record.invoiceNumber,
        bill: record.responseSnapshot?.bill || record.responseSnapshot?.data || null,
        data: record.responseSnapshot,
        message: 'Transaction completed successfully (from IdempotencyRecord).',
      });
    }

    if (record.status === 'PROCESSING') {
      return response.status(200).json({
        success: true,
        status: 'PROCESSING',
        saleFinalized: false,
        transactionId,
        message: 'Transaction is currently processing.',
      });
    }

    return response.status(200).json({
      success: false,
      status: 'FAILED',
      saleFinalized: false,
      transactionId,
      error: record.errorDetails,
      message: 'Transaction failed prior to finalization.',
    });
  }

  return response.status(200).json({
    success: true,
    status: 'NOT_RECEIVED',
    saleFinalized: false,
    transactionId,
    message: 'No transaction found for this identity. Safe to retry with same transaction identity.',
  });
});

/**
 * GET /api/v1/pos/reconciliation/pending
 * REC-04B: Lists pending and manual-review reconciliation jobs for operational visibility.
 */
const getPendingReconciliations = asyncHandler(async (request, response) => {
  const role = (request.auth?.role || '').toUpperCase();
  if (role === 'STAFF') {
    throw new ApiError(403, 'AUTHORIZATION_DENIED', 'Staff users are not authorized to view reconciliation queues.');
  }
  const { cafeId, status } = request.query;
  const result = await PosReconciliationService.getPendingReconciliations({
    organisationId: request.auth.organisationId,
    cafeId,
    status,
  });
  return response.status(200).json(result);
});

/**
 * POST /api/v1/pos/reconciliation/:jobId/retry
 * REC-04B: Explicitly retries a reconciliation job with exactly-once safety.
 */
const retryReconciliation = asyncHandler(async (request, response) => {
  const role = (request.auth?.role || '').toUpperCase();
  if (role === 'STAFF') {
    throw new ApiError(403, 'AUTHORIZATION_DENIED', 'Staff users are not authorized to retry reconciliation jobs.');
  }
  const jobId = normalizeId(request.params.jobId);
  const result = await PosReconciliationService.retryJob(jobId, request.auth);
  return response.status(200).json(result);
});

/**
 * POST /api/v1/pos/offline-sync
 * REC-13: Replays queued offline POS transactions through the canonical PosOrderService pipeline.
 */
const syncOfflineOrders = asyncHandler(async (request, response) => {
  const { organisationId, userId } = request.auth;
  const cafeId = normalizeId(request.body?.cafeId || request.query?.cafeId || request.auth?.primaryCafeId || '');
  const { transactions, deviceId, operatorSessionId } = request.body || {};

  if (!Array.isArray(transactions) || transactions.length === 0) {
    throw new ApiError(400, 'VALIDATION_FAILED', 'Transactions array is required for offline sync.');
  }

  const OfflineSyncService = require('../services/offlineSyncService');
  const syncResult = await OfflineSyncService.syncBatch({
    organisationId,
    cafeId,
    deviceId: deviceId || request.deviceContext?.deviceId || '',
    userId,
    operatorSessionId,
    transactions,
  });

  return response.status(200).json({
    success: true,
    message: `Processed ${transactions.length} offline transactions.`,
    data: syncResult,
    correlationId: request.correlationId || null,
  });
});

/**
 * GET /api/v1/pos/offline-reviews/pending
 * REC-13A / REC-13B: Lists pending offline review items scoped by cafe and authorization.
 * Role-enforced: Only Assigned CAFE_ADMIN and MASTER are permitted.
 * OWNER and STAFF are strictly barred (Segregation of Duties).
 */
const getPendingOfflineReviews = asyncHandler(async (request, response) => {
  const role = (request.auth?.role || '').toUpperCase();
  if (role === 'OWNER') {
    throw new ApiError(
      403,
      'AUTHORIZATION_DENIED',
      'Owner does not possess offline POS review authorization (Segregation of Duties).'
    );
  }
  if (role === 'STAFF') {
    throw new ApiError(
      403,
      'AUTHORIZATION_DENIED',
      'Staff users are not authorized to view or manage offline queue reviews.'
    );
  }
  if (!['CAFE_ADMIN', 'MASTER'].includes(role)) {
    throw new ApiError(
      403,
      'AUTHORIZATION_DENIED',
      `Role ${role} is not authorized for offline queue review.`
    );
  }

  const { organisationId } = request.auth;
  const cafeId = normalizeId(request.query?.cafeId || request.params?.cafeId || '');

  const OfflineSyncService = require('../services/offlineSyncService');
  const items = await OfflineSyncService.getPendingReviews({
    organisationId,
    cafeId: cafeId || null,
    authUser: request.auth,
  });

  return response.status(200).json({
    success: true,
    count: items.length,
    data: items,
  });
});

/**
 * POST /api/v1/pos/offline-reviews/:reviewId/review
 * REC-13A / REC-13B: Executes authorized review decision (APPROVE_AND_FINALIZE, REJECT, ESCALATE).
 * Role-enforced: Only Assigned CAFE_ADMIN and MASTER are permitted.
 * OWNER and STAFF are strictly barred (Segregation of Duties).
 */
const reviewOfflineOrder = asyncHandler(async (request, response) => {
  const role = (request.auth?.role || '').toUpperCase();
  if (role === 'OWNER') {
    throw new ApiError(
      403,
      'AUTHORIZATION_DENIED',
      'Owner does not possess offline POS review authorization (Segregation of Duties).'
    );
  }
  if (role === 'STAFF') {
    throw new ApiError(
      403,
      'AUTHORIZATION_DENIED',
      'Staff users are not authorized to perform offline queue governance review.'
    );
  }
  if (!['CAFE_ADMIN', 'MASTER'].includes(role)) {
    throw new ApiError(
      403,
      'AUTHORIZATION_DENIED',
      `Role ${role} is not authorized for offline queue review.`
    );
  }

  const { reviewId } = request.params;
  const { action, reason } = request.body || {};

  const OfflineSyncService = require('../services/offlineSyncService');
  const result = await OfflineSyncService.reviewItem({
    reviewId,
    action,
    reason,
    authContext: request.auth,
  });

  return response.status(200).json({
    success: true,
    data: result,
  });
});

const { PaymentProviderService } = require('../services/paymentProviderService');

/**
 * POST /api/v1/pos/payments/callback
 * Handles digital payment gateway webhooks/callbacks idempotently.
 */
const handlePaymentCallback = asyncHandler(async (request, response) => {
  const payload = request.body || {};
  const signature = request.headers['x-provider-signature'] || request.headers['x-razorpay-signature'] || '';
  const provider = request.params.provider || payload.provider || 'TEST_GATEWAY';

  const result = await PaymentProviderService.processPaymentCallback({
    provider,
    payload,
    signature,
    authContext: request.auth,
  });

  return response.status(200).json(result);
});

/**
 * POST /api/v1/pos/orders/:billId/tender-correction
 * Auditable post-settlement tender correction workflow without altering revenue.
 */
const correctTender = asyncHandler(async (request, response) => {
  const role = (request.auth?.role || '').toUpperCase();
  if (role === 'STAFF') {
    throw new ApiError(403, 'PERMISSION_DENIED', 'Staff role does not have tender correction authority.');
  }
  if (role === 'OWNER') {
    throw new ApiError(403, 'PERMISSION_DENIED', 'Owner persona is barred from POS operational mutations.');
  }

  const billId = normalizeId(request.params.billId);
  const { oldPaymentMethod, newPaymentMethod, amountPaisa, reason, paymentReference } = request.body || {};

  if (!oldPaymentMethod || !newPaymentMethod) {
    throw new ApiError(400, 'PAYMENT_METHODS_REQUIRED', 'oldPaymentMethod and newPaymentMethod are required.');
  }

  const reasonText = String(reason || '').trim();
  if (reasonText.length < 5) {
    throw new ApiError(400, 'REASON_REQUIRED', 'A reason of at least 5 characters is required for tender correction.');
  }

  const bill = await Bill.findOne({
    $or: [{ billId }, { invoiceNumber: billId }],
    organisationId: request.auth.organisationId,
  });

  if (!bill) {
    throw new ApiError(404, 'NOT_FOUND', 'Bill not found.');
  }

  assertCafeAccess(request, bill.cafeId);

  if (bill.status === 'VOIDED') {
    throw new ApiError(400, 'CANNOT_CORRECT_VOIDED', 'Cannot correct tender on a voided bill.');
  }

  const normNewMethod = normalizeId(newPaymentMethod);
  const normOldMethod = normalizeId(oldPaymentMethod);
  const { PAYMENT_METHODS } = require('../models/Bill');
  if (!normNewMethod || !PAYMENT_METHODS.includes(normNewMethod)) {
    throw new ApiError(400, 'INVALID_TENDER_METHOD', `New payment method '${newPaymentMethod}' is not an authorized tender (A134).`);
  }

  const targetAmountPaisa = Math.round(Number(amountPaisa) || bill.totalPaisa);
  const correctionId = `TC-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;

  // Snapshot previous state for atomic rollback guardrail (Benchmark A134)
  const previousTendersSnapshot = JSON.parse(JSON.stringify(bill.tenders || []));
  const previousPaymentMethod = bill.paymentMethod;

  // Find matching tender or update tenders array
  let foundTender = false;
  if (Array.isArray(bill.tenders)) {
    for (const t of bill.tenders) {
      if (normalizeId(t.paymentMethod) === normOldMethod && t.status === 'COMPLETED') {
        t.paymentMethod = normNewMethod;
        if (paymentReference) t.paymentReference = paymentReference;
        foundTender = true;
        break;
      }
    }
  }

  if (!foundTender) {
    throw new ApiError(400, 'TENDER_NOT_FOUND', `No completed tender with method ${oldPaymentMethod} found on this bill.`);
  }

  const correctionEntry = {
    correctionId,
    oldPaymentMethod: normOldMethod,
    newPaymentMethod: normNewMethod,
    amountPaisa: targetAmountPaisa,
    reason: reasonText,
    correctedByUserId: request.auth.userId || 'OPERATOR',
    correctedAt: new Date(),
    paymentReference: paymentReference || '',
    financialEffect: `Reclassified ₹${(targetAmountPaisa / 100).toFixed(2)} from ${oldPaymentMethod} to ${newPaymentMethod}`,
  };

  bill.tenderCorrections = bill.tenderCorrections || [];
  bill.tenderCorrections.push(correctionEntry);
  if (bill.tenders.length === 1) {
    bill.paymentMethod = normNewMethod;
  }

  try {
    await bill.save();
  } catch (saveErr) {
    // Atomic rollback guardrail (A134)
    bill.tenders = previousTendersSnapshot;
    bill.paymentMethod = previousPaymentMethod;
    bill.tenderCorrections.pop();
    throw new ApiError(500, 'TENDER_CORRECTION_FAILED', `Tender modification rolled back to prevent corruption: ${saveErr.message}`);
  }

  return response.status(200).json({
    success: true,
    data: {
      billId: bill.billId,
      correction: correctionEntry,
      bill: bill.toObject ? bill.toObject() : bill,
    },
  });
});

const voidOtpStore = new Map();

const requestVoidOtpController = asyncHandler(async (request, response) => {
  const { billId, managerEmail: customManagerEmail } = request.body;
  if (!billId) {
    throw new ApiError(400, 'BILL_ID_REQUIRED', 'billId is required.');
  }
  const otp = String(Math.floor(100000 + Math.random() * 900000));
  const expiresAt = Date.now() + 5 * 60 * 1000;
  voidOtpStore.set(normalizeId(billId), { otp, expiresAt });

  // Benchmark A008 / F207: Email-Delivered Manager Cancellation OTP
  let emailDispatched = false;
  const targetEmail = customManagerEmail || process.env.STORE_MANAGER_EMAIL || 'manager@zamorincafe.com';
  try {
    const { NotificationService } = require('../services/NotificationService');
    if (NotificationService.activeProvider && typeof NotificationService.activeProvider.sendEmail === 'function') {
      await NotificationService.activeProvider.sendEmail({
        to: targetEmail,
        subject: `[SECURITY ALERT] Emergency Bill Cancellation OTP: ${otp} (Bill ${billId})`,
        text: `Emergency Void Request for Bill ${billId}.\nCashier: ${request.auth?.userId || 'OPERATOR'}\nOTP: ${otp}\nValid for 5 minutes.`,
        html: `<h3>Zamorin Café ERP — Bill Cancellation Authorization</h3><p>An emergency bill cancellation was initiated for bill <strong>${billId}</strong> by <strong>${request.auth?.userId || 'OPERATOR'}</strong>.</p><p style="font-size:24px;font-weight:bold;color:#b17d38;">OTP: ${otp}</p><p>This OTP expires in 5 minutes.</p>`,
      });
      emailDispatched = true;
    }
  } catch (err) {
    console.warn('[POS] Failed to dispatch cancellation email OTP:', err.message);
  }

  return response.status(200).json({
    success: true,
    data: {
      billId,
      message: 'Cancellation authorization OTP dispatched to registered store manager email.',
      emailDispatched,
      recipientEmail: targetEmail,
      expiresInSeconds: 300,
      testOtp: process.env.NODE_ENV !== 'production' ? otp : undefined,
    },
  });
});

const splitBillByItemsController = asyncHandler(async (request, response) => {
  const { originalBillId, splitGroups } = request.body;
  const result = await PosOrderService.splitBillByItems({
    originalBillId,
    splitGroups,
    authContext: request.auth,
  });
  return response.status(200).json({
    success: true,
    data: result,
  });
});

const splitBillEvenlyController = asyncHandler(async (request, response) => {
  const { originalBillId, splitCount } = request.body;
  const result = await PosOrderService.splitBillEvenly({
    originalBillId,
    splitCount,
    authContext: request.auth,
  });
  return response.status(200).json({
    success: true,
    data: result,
  });
});

const splitBillFoodBeverageController = asyncHandler(async (request, response) => {
  const { originalBillId } = request.body;
  const result = await PosOrderService.splitBillByFoodBeverage({
    originalBillId,
    authContext: request.auth,
  });
  return response.status(200).json({
    success: true,
    data: result,
  });
});

const lookupBarcodeOrderController = asyncHandler(async (request, response) => {
  const barcode = request.params.barcode || request.query.code || '';
  const cafeId = request.query.cafeId || request.auth?.primaryCafeId;
  const result = await PosOrderService.lookupOrderByBarcode(barcode, cafeId);
  return response.status(200).json({
    success: true,
    data: result,
  });
});

const mergeTablesPosController = asyncHandler(async (request, response) => {
  const { targetTableId, sourceTableIds, cafeId } = request.body || {};
  const targetCafeId = cafeId || request.auth?.primaryCafeId || 'ZC-0001';
  const { TableService } = require('../services/tableService');
  const result = await TableService.mergeTables({
    targetTableId,
    sourceTableIds,
    cafeId: targetCafeId,
    organisationId: request.auth?.organisationId || 'ORG-DEFAULT',
    authContext: request.auth,
  });
  return response.status(200).json({
    success: true,
    data: result,
  });
});

const shiftTablePosController = asyncHandler(async (request, response) => {
  const { fromTableId, toTableId, reason, cafeId } = request.body || {};
  const targetCafeId = cafeId || request.auth?.primaryCafeId || 'ZC-0001';
  const { TableService } = require('../services/tableService');
  const result = await TableService.shiftTable({
    fromTableId,
    toTableId,
    reason,
    cafeId: targetCafeId,
    organisationId: request.auth?.organisationId || 'ORG-DEFAULT',
    authContext: request.auth,
  });
  return response.status(200).json({
    success: true,
    data: result,
  });
});

module.exports = {
  commitOrder,
  previewOrder,
  printOrder,
  reprintOrder,
  getActiveOrders,
  getLastCommittedBill,
  getOrderStatusByIdempotency,
  getPendingReconciliations,
  retryReconciliation,
  syncOfflineOrders,
  getPendingOfflineReviews,
  reviewOfflineOrder,
  handlePaymentCallback,
  correctTender,
  splitBillByItemsController,
  splitBillEvenlyController,
  splitBillFoodBeverageController,
  requestVoidOtpController,
  lookupBarcodeOrderController,
  mergeTablesPosController,
  shiftTablePosController,
  voidOtpStore,
};

const { SmartCardService } = require('../services/smartCardService');
const { DailyProductionService } = require('../services/dailyProductionService');

const splitBillFoodBarController = asyncHandler(async (request, response) => {
  const { originalBillId } = request.body;
  const result = await PosOrderService.splitBillByFoodBar({
    originalBillId,
    authContext: request.auth,
  });
  return response.status(200).json({
    success: true,
    data: result,
  });
});

const lookupItemByShortcodeController = asyncHandler(async (request, response) => {
  const shortcode = request.params.shortcode || request.query.code || '';
  const cafeId = request.query.cafeId || request.auth?.primaryCafeId;
  const organisationId = request.auth?.organisationId || 'ZAMORIN';
  const item = await PosOrderService.lookupMenuItemByShortcode(shortcode, cafeId, organisationId);
  return response.status(200).json({
    success: true,
    data: item,
  });
});

const issueSmartCardController = asyncHandler(async (request, response) => {
  const { cardUid, initialTopupPaisa, securityDepositPaisa, customerName, customerPhone, customerId, paymentMethod, cafeId } = request.body || {};
  const targetCafeId = cafeId || request.auth?.primaryCafeId;
  const result = await SmartCardService.issueCard({
    cardUid,
    cafeId: targetCafeId,
    organisationId: request.auth?.organisationId || 'ZAMORIN',
    customerId,
    customerName,
    customerPhone,
    initialTopupPaisa,
    securityDepositPaisa,
    paymentMethod,
    authContext: request.auth,
  });
  return response.status(201).json(result);
});

const topupSmartCardController = asyncHandler(async (request, response) => {
  const { cardUid, amountPaisa, paymentMethod, cafeId } = request.body || {};
  const targetCafeId = cafeId || request.auth?.primaryCafeId;
  const result = await SmartCardService.topupCard({
    cardUid,
    amountPaisa,
    paymentMethod,
    cafeId: targetCafeId,
    organisationId: request.auth?.organisationId || 'ZAMORIN',
    authContext: request.auth,
  });
  return response.status(200).json(result);
});

const debitSmartCardController = asyncHandler(async (request, response) => {
  const { cardUid, amountPaisa, referenceBillId, cafeId } = request.body || {};
  const targetCafeId = cafeId || request.auth?.primaryCafeId;
  const result = await SmartCardService.debitCard({
    cardUid,
    amountPaisa,
    referenceBillId,
    cafeId: targetCafeId,
    authContext: request.auth,
  });
  return response.status(200).json(result);
});

const refundSmartCardController = asyncHandler(async (request, response) => {
  const { cardUid, refundDeposit } = request.body || {};
  const result = await SmartCardService.refundAndCloseCard({
    cardUid,
    refundDeposit: refundDeposit !== false,
    authContext: request.auth,
  });
  return response.status(200).json(result);
});

const getSmartCardBalanceController = asyncHandler(async (request, response) => {
  const cardUid = request.params.cardUid || request.query.cardUid;
  const result = await SmartCardService.getCardBalance(cardUid);
  return response.status(200).json({
    success: true,
    data: result,
  });
});

const getSmartCardLiabilityReportController = asyncHandler(async (request, response) => {
  const cafeId = request.query.cafeId || request.auth?.primaryCafeId;
  const result = await SmartCardService.getUnspentLiabilityReport({
    cafeId,
    organisationId: request.auth?.organisationId || 'ZAMORIN',
  });
  return response.status(200).json({
    success: true,
    data: result,
  });
});

const registerDailyProductionBatchController = asyncHandler(async (request, response) => {
  const { menuItemId, initialYieldQty, batchNumber, date, cafeId } = request.body || {};
  const targetCafeId = cafeId || request.auth?.primaryCafeId;
  const result = await DailyProductionService.registerDailyBatch({
    organisationId: request.auth?.organisationId || 'ZAMORIN',
    cafeId: targetCafeId,
    date,
    menuItemId,
    initialYieldQty,
    batchNumber,
    authContext: request.auth,
  });
  return response.status(201).json(result);
});

const getDailyProductionRegisterController = asyncHandler(async (request, response) => {
  const cafeId = request.query.cafeId || request.auth?.primaryCafeId;
  const date = request.query.date;
  const result = await DailyProductionService.getDailyRegister({
    organisationId: request.auth?.organisationId || 'ZAMORIN',
    cafeId,
    date,
  });
  return response.status(200).json({
    success: true,
    data: result,
  });
});

Object.assign(module.exports, {
  splitBillFoodBarController,
  lookupItemByShortcodeController,
  issueSmartCardController,
  topupSmartCardController,
  debitSmartCardController,
  refundSmartCardController,
  getSmartCardBalanceController,
  getSmartCardLiabilityReportController,
  registerDailyProductionBatchController,
  getDailyProductionRegisterController,
});


