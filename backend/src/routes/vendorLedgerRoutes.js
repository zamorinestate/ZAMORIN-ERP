'use strict';

const express = require('express');
const { authenticate } = require('../middleware/authenticate');
const { authorize } = require('../middleware/authorize');

const {
  getVendorLedger,
  getVendorStatement,
  setOpeningBalance,
  postBillFromPo,
  getApQueue,
  recordPayment,
  reversePayment,
  recordAdvance,
  applyAdvance,
  applyCreditNote,
  placePaymentHold,
  releasePaymentHold,
  getApAgingReport,
  getGstMonitoringReport,
  rebuildVendorSummary,
} = require('../controllers/vendorLedgerController');

const router = express.Router();

router.use(authenticate);

// 1. Vendor Ledger Queries & Statements
router.get(
  '/vendors/:vendorId',
  authorize('FINANCE:READ', {
    allowedRoles: ['MASTER', 'OWNER', 'CAFE_ADMIN'],
    allowedCapabilities: ['VENDOR_LEDGER_VIEW', 'VENDOR_AP_VIEW', 'FINANCE:READ'],
  }),
  getVendorLedger
);

router.get(
  '/vendors/:vendorId/statement',
  authorize('FINANCE:READ', {
    allowedRoles: ['MASTER', 'OWNER', 'CAFE_ADMIN'],
    allowedCapabilities: ['VENDOR_LEDGER_VIEW', 'VENDOR_AP_VIEW', 'FINANCE:READ'],
  }),
  getVendorStatement
);

router.post(
  '/vendors/:vendorId/opening-balance',
  authorize('FINANCE:ADMIN', { allowedRoles: ['MASTER'] }),
  setOpeningBalance
);

router.post(
  '/vendors/:vendorId/rebuild-summary',
  authorize('FINANCE:WRITE', { allowedRoles: ['MASTER'] }),
  rebuildVendorSummary
);

// 2. AP Handoff from PO / GRN
router.post(
  '/bills/from-po/:purchaseOrderId',
  authorize('FINANCE:WRITE', {
    allowedRoles: ['MASTER', 'CAFE_ADMIN'],
    allowedCapabilities: ['VENDOR_AP_MATCH', 'FINANCE:WRITE'],
  }),
  postBillFromPo
);

// 3. AP Work Queue
router.get(
  '/ap/queue',
  authorize('FINANCE:READ', {
    allowedRoles: ['MASTER', 'OWNER', 'CAFE_ADMIN'],
    allowedCapabilities: ['VENDOR_AP_VIEW', 'VENDOR_AP_MATCH', 'VENDOR_AP_PREPARE_PAYMENT', 'FINANCE:READ'],
  }),
  getApQueue
);

// 4. Payments, Partial Payments & Reversals
router.post(
  '/payments',
  authorize('FINANCE:POST', { allowedRoles: ['MASTER'] }),
  recordPayment
);

router.post(
  '/payments/:paymentId/reverse',
  authorize('FINANCE:POST', { allowedRoles: ['MASTER'] }),
  reversePayment
);

// 5. Advances & Credit Notes
router.post(
  '/advances',
  authorize('FINANCE:POST', { allowedRoles: ['MASTER'] }),
  recordAdvance
);

router.post(
  '/advances/apply',
  authorize('FINANCE:POST', { allowedRoles: ['MASTER'] }),
  applyAdvance
);

router.post(
  '/credits/apply',
  authorize('FINANCE:WRITE', {
    allowedRoles: ['MASTER', 'CAFE_ADMIN'],
    allowedCapabilities: ['VENDOR_AP_MATCH', 'FINANCE:WRITE'],
  }),
  applyCreditNote
);

// 6. Payment Holds
router.post(
  '/bills/:invoiceId/holds',
  authorize('FINANCE:POST', { allowedRoles: ['MASTER'] }),
  placePaymentHold
);

router.post(
  '/bills/:invoiceId/holds/release',
  authorize('FINANCE:POST', { allowedRoles: ['MASTER'] }),
  releasePaymentHold
);

// 7. AP Aging & GST 180-Day Monitoring
router.get(
  '/reports/aging',
  authorize('FINANCE:READ', {
    allowedRoles: ['MASTER', 'OWNER', 'CAFE_ADMIN'],
    allowedCapabilities: ['VENDOR_AP_AGING_VIEW', 'VENDOR_AP_VIEW', 'VENDOR_LEDGER_VIEW', 'FINANCE:READ'],
  }),
  getApAgingReport
);

router.get(
  '/reports/gst-180-days',
  authorize('FINANCE:READ', { allowedRoles: ['MASTER', 'OWNER'] }),
  getGstMonitoringReport
);

module.exports = router;
