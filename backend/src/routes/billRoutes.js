'use strict';

/**
 * BILL ROUTES (SCREEN 005)
 * Mounted at: /api/v1/bills (registered in routes/index.js)
 */

const express = require('express');
const { authenticate } = require('../middleware/authenticate');
const { authorize } = require('../middleware/authorize');
const { attachDeviceContext } = require('../middleware/deviceContext');
const {
  getBillsOverview,
  listBills,
  getBill,
  getBillPdf,
  createBill,
  syncOfflineBills,
  reprintBill,
  voidBill,
  refundBill,
  getGstRegister,
  getReconciliationStatus,
  closeBusinessDayBilling,
  getPastOrdersSummary,
  getSalesCalendar,
  holdBill,
  listOpenTickets,
  openRegisterSession,
  recordCashEvent,
  closeRegisterSession,
  getRegisterSession,
  splitBill,
} = require('../controllers/billController');

const router = express.Router();

router.use(authenticate);
router.use(attachDeviceContext);

// Strict Four-Persona Topology Enforcement: Staff and Owner denied POS operational mutations
router.use((request, response, next) => {
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method)) {
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
  }
  return next();
});

// Overview & Registers
router.get('/overview', getBillsOverview);
router.get('/tax/gst-register', getGstRegister);
router.get('/reconciliation/status', getReconciliationStatus);
router.post('/eod/close', closeBusinessDayBilling);

// History, Stats & Calendar
router.get('/history/stats', getPastOrdersSummary);
router.get('/history/calendar', getSalesCalendar);

// Open Tickets & Holds
router.get('/tickets/open', listOpenTickets);
router.post('/tickets/hold', holdBill);

// Register Session & Cash Drawer
router.get('/register/session/current', getRegisterSession);
router.post('/register/session/open', openRegisterSession);
router.post('/register/session/event', recordCashEvent);
router.post('/register/session/close', closeRegisterSession);

// Barcode Lookup (A034)
router.get('/lookup/:barcode', require('../controllers/posController').lookupBarcodeOrderController);

// Bill Listing & Detail
router.get('/', listBills);
router.get('/:billId/pdf', getBillPdf);
router.get('/:billId', getBill);

// POS Sale Creation & Settlement
router.post('/', createBill);
router.post('/commit', require('../controllers/posController').commitOrder);
router.post('/preview', require('../controllers/posController').previewOrder);
router.post('/offline-sync', syncOfflineBills);
router.post('/:billId/split', splitBill);

// Post-Sale Adjustments
router.get('/by-barcode/:barcode', require('../controllers/posController').lookupBarcodeOrderController);
router.post(
  '/:billId/request-cancel-otp',
  authorize('POS_VOID', { allowedRoles: ['MASTER', 'CAFE_ADMIN'] }),
  (req, res, next) => {
    req.body = req.body || {};
    req.body.billId = req.params.billId;
    return require('../controllers/posController').requestVoidOtpController(req, res, next);
  }
);
router.post(
  '/:billId/confirm-cancel',
  authorize('POS_VOID', { allowedRoles: ['MASTER', 'CAFE_ADMIN'] }),
  voidBill
);
router.post('/:billId/reprint', reprintBill);
router.post('/:billId/void', authorize('POS_VOID', { allowedRoles: ['MASTER', 'CAFE_ADMIN'] }), voidBill);
router.post('/:billId/refund', refundBill);

module.exports = router;
