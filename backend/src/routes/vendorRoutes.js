'use strict';

/**
 * VENDOR / SUPPLIER ROUTES (SCR-025)
 * Mounted at: /api/v1/vendors (registered in routes/index.js)
 */

const express = require('express');
const { authenticate } = require('../middleware/authenticate');
const { authorize } = require('../middleware/authorize');
const {
  listVendors,
  getVendor,
  getVendor360,
  createVendor,
  updateVendor,
  changeVendorStatus,
  placeVendorOrder,
  acknowledgeVendorOrder,
  recordGoodsReceipt,
  captureSupplierInvoice,
  computeThreeWayMatch,
  masterApproveInvoiceAndPostInventory,
  retryFailedInventoryPosting,
  submitBankChangeRequest,
  approveBankChangeRequest,
  rejectBankChangeRequest,
  placeVendorHold,
  releaseVendorHold,
  getSupplierPerformance,
  getSupplyContinuity,
  getVendorZurfPdf,
  importSupplierMaterialsHandler,
} = require('../controllers/vendorController');

const router = express.Router();

router.use(authenticate);

// ── Analytics & Sourcing (Static paths before /:vendorId) ───────────────────
router.get(
  '/performance',
  authorize('VENDORS_READ', { allowedRoles: ['MASTER', 'OWNER', 'CAFE_ADMIN'] }),
  getSupplierPerformance
);

router.get(
  '/continuity',
  authorize('VENDORS_READ', { allowedRoles: ['MASTER', 'OWNER', 'CAFE_ADMIN'] }),
  getSupplyContinuity
);

router.get(
  '/reports/zurf-pdf',
  authorize('VENDORS_READ', { allowedRoles: ['MASTER', 'OWNER', 'CAFE_ADMIN'] }),
  getVendorZurfPdf
);

// ── Order Lifecycle, Receiving, Invoicing & MASTER Stock Posting ───────────
router.post(
  '/orders/:poId/place',
  authorize('PROCUREMENT_WRITE', { allowedRoles: ['MASTER', 'OWNER', 'CAFE_ADMIN'] }),
  placeVendorOrder
);

router.post(
  '/orders/:poId/acknowledge',
  authorize('PROCUREMENT_WRITE', { allowedRoles: ['MASTER', 'OWNER', 'CAFE_ADMIN'] }),
  acknowledgeVendorOrder
);

router.post(
  '/orders/:poId/receipts',
  authorize('PROCUREMENT_RECEIVE', { allowedRoles: ['MASTER', 'OWNER', 'CAFE_ADMIN'] }),
  recordGoodsReceipt
);

router.post(
  '/orders/:poId/invoices',
  authorize('PROCUREMENT_WRITE', { allowedRoles: ['MASTER', 'OWNER', 'CAFE_ADMIN'] }),
  captureSupplierInvoice
);

router.get(
  '/orders/:poId/match',
  authorize('PROCUREMENT_READ', { allowedRoles: ['MASTER', 'OWNER', 'CAFE_ADMIN'] }),
  computeThreeWayMatch
);

// MASTER-ONLY: Invoice approval that authorizes atomic exactly-once inventory posting
router.post(
  '/orders/:poId/master-approve',
  authorize('PROCUREMENT_APPROVE', { allowedRoles: ['MASTER'] }),
  masterApproveInvoiceAndPostInventory
);

router.post(
  '/orders/:poId/retry-posting',
  authorize('PROCUREMENT_APPROVE', { allowedRoles: ['MASTER'] }),
  retryFailedInventoryPosting
);

// ── Supplier Directory & 360 ───────────────────────────────────────────────
router.get(
  '/',
  authorize('VENDORS_READ', { allowedRoles: ['MASTER', 'OWNER', 'CAFE_ADMIN'] }),
  listVendors
);

router.get(
  '/:vendorId',
  authorize('VENDORS_READ', { allowedRoles: ['MASTER', 'OWNER', 'CAFE_ADMIN'] }),
  getVendor
);

router.get(
  '/:vendorId/360',
  authorize('VENDORS_READ', { allowedRoles: ['MASTER', 'OWNER', 'CAFE_ADMIN'] }),
  getVendor360
);

// ── Supplier Onboarding & Master Data Modifications ────────────────────────
router.post(
  '/',
  authorize('VENDORS_WRITE', { allowedRoles: ['MASTER', 'OWNER'] }),
  createVendor
);

router.patch(
  '/:vendorId',
  authorize('VENDORS_WRITE', { allowedRoles: ['MASTER'] }),
  updateVendor
);

router.post(
  '/:vendorId/status',
  authorize('VENDORS_WRITE', { allowedRoles: ['MASTER'] }),
  changeVendorStatus
);

router.patch(
  '/:vendorId/status',
  authorize('VENDORS_WRITE', { allowedRoles: ['MASTER'] }),
  changeVendorStatus
);

// ── High-Risk Bank Changes & Holds ─────────────────────────────────────────
router.post(
  '/:vendorId/bank-change-request',
  authorize('VENDORS_WRITE', { allowedRoles: ['MASTER', 'OWNER'] }),
  submitBankChangeRequest
);

router.post(
  '/:vendorId/bank-change-approve',
  authorize('VENDORS_WRITE', { allowedRoles: ['MASTER'] }),
  approveBankChangeRequest
);

router.post(
  '/:vendorId/bank-change-reject',
  authorize('VENDORS_WRITE', { allowedRoles: ['MASTER'] }),
  rejectBankChangeRequest
);

router.post(
  '/:vendorId/holds',
  authorize('VENDORS_WRITE', { allowedRoles: ['MASTER'] }),
  placeVendorHold
);

router.delete(
  '/:vendorId/holds/:holdId',
  authorize('VENDORS_WRITE', { allowedRoles: ['MASTER'] }),
  releaseVendorHold
);

router.post(
  '/:vendorId/supplier-materials/import',
  authorize('VENDORS_WRITE', { allowedRoles: ['MASTER', 'OWNER', 'CAFE_ADMIN'] }),
  importSupplierMaterialsHandler
);

module.exports = router;
