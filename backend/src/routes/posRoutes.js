'use strict';

/**
 * POS ROUTES (SCREEN 005 / PRIMARY MASTER PROGRAMME STAGE 06)
 * Mounted at: /api/v1/pos
 */

const express = require('express');
const { authenticate } = require('../middleware/authenticate');
const { attachDeviceContext } = require('../middleware/deviceContext');
const {
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
  requestVoidOtpController,
  lookupBarcodeOrderController,
  mergeTablesPosController,
  shiftTablePosController,
} = require('../controllers/posController');

const router = express.Router();

router.use(authenticate);
router.use(attachDeviceContext);

// Strict Four-Persona Topology Enforcement: Staff and Owner denied POS operational execution
router.use((request, response, next) => {
  if (request.auth?.role === 'STAFF') {
    return response.status(403).json({
      success: false,
      error: {
        code: 'PERMISSION_DENIED',
        message: 'Staff role is restricted to self-service only and does not have POS & Billing operational authority.',
      },
    });
  }
  if (request.auth?.role === 'OWNER') {
    return response.status(403).json({
      success: false,
      error: {
        code: 'PERMISSION_DENIED',
        message: 'Owner persona is restricted to executive oversight and governance and does not have direct POS terminal operational authority.',
      },
    });
  }
  return next();
});

// POS Order pipeline actions
router.post('/orders/commit', commitOrder);
router.post('/offline-sync', syncOfflineOrders);
router.post('/orders/preview', previewOrder);
router.post('/orders/:billId/print', printOrder);
router.post('/orders/:billId/reprint', reprintOrder);
router.get('/orders/active/:cafeId', getActiveOrders);
router.get('/orders/last/:cafeId', getLastCommittedBill);

// Payment Gateway Callback & Tender Correction
router.post('/payments/callback', handlePaymentCallback);
router.post('/payments/callback/:provider', handlePaymentCallback);
router.post('/orders/:billId/tender-correction', correctTender);

// P22: FOH Split Bills & Void Challenges
router.post('/orders/split-by-items', splitBillByItemsController);
router.post('/orders/split-items', splitBillByItemsController);
router.post('/orders/split-evenly', splitBillEvenlyController);
router.post('/orders/split-food-beverage', splitBillFoodBeverageController);
router.post('/orders/split-food-bar', splitBillFoodBarController);
router.post('/orders/request-void-otp', requestVoidOtpController);

// P23: Table Merging (F027), Shifted KOTs (A022), Barcode Lookup (A034), Shortcode (F044)
router.post('/tables/merge', mergeTablesPosController);
router.post('/tables/shift', shiftTablePosController);
router.get('/orders/lookup-barcode/:barcode', lookupBarcodeOrderController);
router.get('/orders/lookup-barcode', lookupBarcodeOrderController);
router.get('/advance-orders/by-slip/:slipNumber', (req, res, next) => {
  const { getAdvanceDepositBySlip } = require('../controllers/financeController');
  return getAdvanceDepositBySlip(req, res, next);
});
router.get('/items/shortcode/:shortcode', lookupItemByShortcodeController);
router.get('/items/shortcode', lookupItemByShortcodeController);

// F085: Food Court Prepaid Smart Card Engine
router.post('/smart-card/issue', issueSmartCardController);
router.post('/smart-card/topup', topupSmartCardController);
router.post('/smart-card/debit', debitSmartCardController);
router.post('/smart-card/refund', refundSmartCardController);
router.get('/smart-card/liability-report', getSmartCardLiabilityReportController);
router.get('/smart-card/:cardUid/balance', getSmartCardBalanceController);
router.get('/smart-card/balance', getSmartCardBalanceController);

// F137–F140: Daily Finished-Item Batch Register
router.post('/production/daily-register', registerDailyProductionBatchController);
router.get('/production/daily-register', getDailyProductionRegisterController);

// REC-04B: Transaction status & unknown-outcome recovery
router.get('/orders/status/:transactionId', getOrderStatusByIdempotency);

// REC-04B: Durable side-effect reconciliation management
router.get('/reconciliation/pending', getPendingReconciliations);
router.post('/reconciliation/:jobId/retry', retryReconciliation);

// REC-13A: Disabled operator & offline review management
router.get('/offline-reviews/pending', getPendingOfflineReviews);
router.post('/offline-reviews/:reviewId/review', reviewOfflineOrder);

module.exports = router;


