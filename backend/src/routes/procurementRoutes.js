'use strict';

/**
 * PROCUREMENT ROUTES
 * Mounted at: /api/v1/procurement (registered in routes/index.js)
 */

const express = require('express');
const multer = require('multer');
const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');
const { authenticate } = require('../middleware/authenticate');
const { authorize } = require('../middleware/authorize');
const { attachDeviceContext } = require('../middleware/deviceContext');
const { DEFAULT_DOCUMENT_MAX_BYTES } = require('../services/documentAttachmentService');
const {
  listOrders,
  getOrder,
  createOrder,
  editOrder,
  verifyDeliveryAndSubmitBill,
  masterApproveOrderAndBill,
  downloadOrderReceiptBill,
  submitOrder,
  approveOrder,
  orderSent,
  receiveOrder,
  cancelOrder,
  getProcurementOverview,
  getCatalogue,
  listPurchaseRequisitions,
  createPurchaseRequisition,
  convertRequisitionToPo,
  listRfqs,
  createRfq,
  listAsns,
  getAsn,
  createAsn,
  updateAsnStatus,
  cancelAsn,
  listGoodsReceipts,
  createGoodsReceipt,
  getMatchingSummary,
  getProcurementIntegrity,
  getOrderDocuments,
  attachOrderDocument,
  previewOrderDocument,
  downloadOrderDocument,
  replaceOrderDocumentVersion,
  archiveOrderDocument,
  getPoDocumentMatchingStatus,
  getSupplierContextualIntelligence,
  vendorConfirmOrder,
  backorderLine,
  vendorUnavailableLine,
  closeShortLine,
  cancelLine,
  proposeSubstitution,
  decideSubstitution,
  sourceElsewhere,
  getVendorFulfillmentAnalytics,
  sendToAccounts,
} = require('../controllers/procurementController');

const UPLOAD_STAGING_DIR = path.join(os.tmpdir(), 'zamorin_procurement_staging');

const diskStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    try {
      fs.mkdirSync(UPLOAD_STAGING_DIR, { recursive: true });
      cb(null, UPLOAD_STAGING_DIR);
    } catch (err) {
      cb(err);
    }
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = `stg-${Date.now()}-${crypto.randomBytes(8).toString('hex')}.tmp`;
    cb(null, uniqueSuffix);
  },
});

const upload = multer({
  storage: diskStorage,
  limits: {
    fileSize: DEFAULT_DOCUMENT_MAX_BYTES,
    files: 1,
  },
});

const router = express.Router();

router.use(authenticate);
router.use(attachDeviceContext);

// Overview & Integrity
router.get(
  '/overview',
  authorize('PROCUREMENT_READ', { allowedRoles: ['MASTER', 'OWNER', 'CAFE_ADMIN'] }),
  getProcurementOverview
);

router.get(
  '/integrity',
  authorize('PROCUREMENT_READ', { allowedRoles: ['MASTER', 'OWNER'] }),
  getProcurementIntegrity
);

// Stage 05 Contextual: Supplier Intelligence in Procurement Workspace
router.get(
  '/suppliers/:vendorId/intelligence',
  authorize('PROCUREMENT_READ', { allowedRoles: ['MASTER', 'OWNER', 'CAFE_ADMIN'] }),
  getSupplierContextualIntelligence
);

// Catalogue / Guided Buying
router.get(
  '/catalogue',
  authorize('PROCUREMENT_READ', { allowedRoles: ['MASTER', 'OWNER', 'CAFE_ADMIN'] }),
  getCatalogue
);

// Requisitions / PRQs
router.get(
  '/requisitions',
  authorize('PROCUREMENT_READ', { allowedRoles: ['MASTER', 'OWNER', 'CAFE_ADMIN'] }),
  listPurchaseRequisitions
);

router.post(
  '/requisitions',
  authorize('PROCUREMENT_WRITE', { allowedRoles: ['MASTER', 'CAFE_ADMIN'] }),
  createPurchaseRequisition
);

router.post(
  '/requisitions/:requisitionId/convert-to-po',
  authorize('PROCUREMENT_WRITE', { allowedRoles: ['MASTER', 'CAFE_ADMIN'] }),
  convertRequisitionToPo
);

// Advance Shipping Notices (ASN)
router.get(
  '/asns',
  authorize('PROCUREMENT_READ', { allowedRoles: ['MASTER', 'OWNER', 'CAFE_ADMIN'] }),
  listAsns
);

router.get(
  '/asns/:asnNumber',
  authorize('PROCUREMENT_READ', { allowedRoles: ['MASTER', 'OWNER', 'CAFE_ADMIN'] }),
  getAsn
);

router.post(
  '/asns',
  authorize('PROCUREMENT_WRITE', { allowedRoles: ['MASTER', 'CAFE_ADMIN'] }),
  createAsn
);

router.post(
  '/asns/:asnNumber/status',
  authorize('PROCUREMENT_WRITE', { allowedRoles: ['MASTER', 'CAFE_ADMIN'] }),
  updateAsnStatus
);

router.post(
  '/asns/:asnNumber/cancel',
  authorize('PROCUREMENT_WRITE', { allowedRoles: ['MASTER', 'OWNER', 'CAFE_ADMIN'] }),
  cancelAsn
);

// Sourcing & RFQs
router.get(
  '/rfqs',
  authorize('PROCUREMENT_READ', { allowedRoles: ['MASTER', 'OWNER', 'CAFE_ADMIN'] }),
  listRfqs
);

router.post(
  '/rfqs',
  authorize('PROCUREMENT_WRITE', { allowedRoles: ['MASTER', 'CAFE_ADMIN'] }),
  createRfq
);

// Goods Receipts & GRNs
router.get(
  '/grns',
  authorize('PROCUREMENT_READ', { allowedRoles: ['MASTER', 'OWNER', 'CAFE_ADMIN'] }),
  listGoodsReceipts
);

router.post(
  '/grns',
  authorize('PROCUREMENT_RECEIVE', { allowedRoles: ['MASTER', 'CAFE_ADMIN'] }),
  createGoodsReceipt
);

// Invoices & 3-Way Matching
router.get(
  '/matching',
  authorize('PROCUREMENT_READ', { allowedRoles: ['MASTER', 'OWNER', 'CAFE_ADMIN'] }),
  getMatchingSummary
);

// Orders Reads: MASTER, OWNER, CAFE_ADMIN, STAFF
router.get(
  '/orders',
  authorize('PROCUREMENT_READ', { allowedRoles: ['MASTER', 'OWNER', 'CAFE_ADMIN', 'STAFF'] }),
  listOrders
);

router.get(
  '/orders/:purchaseOrderId',
  authorize('PROCUREMENT_READ', { allowedRoles: ['MASTER', 'OWNER', 'CAFE_ADMIN', 'STAFF'] }),
  getOrder
);

// PO Document Attachments Pipeline
router.get(
  '/orders/:purchaseOrderId/documents',
  authorize('PROCUREMENT_READ', { allowedRoles: ['MASTER', 'OWNER', 'CAFE_ADMIN'] }),
  getOrderDocuments
);

router.post(
  '/orders/:purchaseOrderId/documents',
  authorize('PROCUREMENT_WRITE', { allowedRoles: ['MASTER', 'CAFE_ADMIN'] }),
  upload.single('file'),
  attachOrderDocument
);

router.get(
  '/orders/:purchaseOrderId/documents/:documentId/preview',
  authorize('PROCUREMENT_READ', { allowedRoles: ['MASTER', 'OWNER', 'CAFE_ADMIN'] }),
  previewOrderDocument
);

router.get(
  '/orders/:purchaseOrderId/documents/:documentId/download',
  authorize('PROCUREMENT_READ', { allowedRoles: ['MASTER', 'OWNER', 'CAFE_ADMIN'] }),
  downloadOrderDocument
);

router.post(
  '/orders/:purchaseOrderId/documents/:documentId/replace-version',
  authorize('PROCUREMENT_WRITE', { allowedRoles: ['MASTER', 'CAFE_ADMIN'] }),
  upload.single('file'),
  replaceOrderDocumentVersion
);

router.delete(
  '/orders/:purchaseOrderId/documents/:documentId',
  authorize('PROCUREMENT_WRITE', { allowedRoles: ['MASTER', 'CAFE_ADMIN'] }),
  archiveOrderDocument
);

router.get(
  '/orders/:purchaseOrderId/matching-status',
  authorize('PROCUREMENT_READ', { allowedRoles: ['MASTER', 'OWNER', 'CAFE_ADMIN'] }),
  getPoDocumentMatchingStatus
);

// Writes: MASTER, CAFE_ADMIN
router.post(
  '/orders',
  authorize('PROCUREMENT_WRITE', { allowedRoles: ['MASTER', 'CAFE_ADMIN'] }),
  createOrder
);

router.put(
  '/orders/:purchaseOrderId/edit',
  authorize('PROCUREMENT_WRITE', { allowedRoles: ['MASTER', 'CAFE_ADMIN'] }),
  editOrder
);

router.post(
  '/orders/:purchaseOrderId/edit',
  authorize('PROCUREMENT_WRITE', { allowedRoles: ['MASTER', 'CAFE_ADMIN'] }),
  editOrder
);

router.post(
  '/orders/:purchaseOrderId/submit',
  authorize('PROCUREMENT_WRITE', { allowedRoles: ['MASTER', 'CAFE_ADMIN'] }),
  submitOrder
);

router.post(
  '/orders/:purchaseOrderId/approve',
  authorize('PROCUREMENT_APPROVE', { allowedRoles: ['MASTER'] }),
  approveOrder
);

router.post(
  '/orders/:purchaseOrderId/master-approve',
  authorize('PROCUREMENT_APPROVE', { allowedRoles: ['MASTER', 'OWNER'] }),
  masterApproveOrderAndBill
);

router.post(
  '/orders/:purchaseOrderId/order',
  authorize('PROCUREMENT_WRITE', { allowedRoles: ['MASTER', 'CAFE_ADMIN'] }),
  orderSent
);

router.post(
  '/orders/:purchaseOrderId/receive',
  authorize('PROCUREMENT_RECEIVE', { allowedRoles: ['MASTER', 'CAFE_ADMIN'] }),
  receiveOrder
);

router.post(
  '/orders/:purchaseOrderId/verify-delivery',
  authorize('PROCUREMENT_RECEIVE', { allowedRoles: ['MASTER', 'CAFE_ADMIN'] }),
  upload.single('file'),
  verifyDeliveryAndSubmitBill
);

router.get(
  '/orders/:purchaseOrderId/receipt-bill',
  authorize('PROCUREMENT_READ', { allowedRoles: ['MASTER', 'OWNER', 'CAFE_ADMIN'] }),
  downloadOrderReceiptBill
);

router.get(
  '/orders/:purchaseOrderId/receipt-bill/:attachmentId',
  authorize('PROCUREMENT_READ', { allowedRoles: ['MASTER', 'OWNER', 'CAFE_ADMIN'] }),
  downloadOrderReceiptBill
);

router.post(
  '/orders/:purchaseOrderId/cancel',
  authorize('PROCUREMENT_WRITE', { allowedRoles: ['MASTER', 'OWNER', 'CAFE_ADMIN'] }),
  cancelOrder
);

// ── REC-17 Vendor Shortage, Backorder, Substitution & Sourcing Endpoints ──
router.post(
  '/orders/:purchaseOrderId/vendor-confirm',
  authorize('PROCUREMENT_WRITE', { allowedRoles: ['MASTER', 'CAFE_ADMIN'] }),
  vendorConfirmOrder
);

router.post(
  '/orders/:purchaseOrderId/lines/:lineId/backorder',
  authorize('PROCUREMENT_WRITE', { allowedRoles: ['MASTER', 'CAFE_ADMIN'] }),
  backorderLine
);

router.post(
  '/orders/:purchaseOrderId/lines/:lineId/vendor-unavailable',
  authorize('PROCUREMENT_WRITE', { allowedRoles: ['MASTER', 'CAFE_ADMIN'] }),
  vendorUnavailableLine
);

router.post(
  '/orders/:purchaseOrderId/lines/:lineId/close-short',
  authorize('PROCUREMENT_WRITE', { allowedRoles: ['MASTER', 'CAFE_ADMIN'] }),
  closeShortLine
);

router.post(
  '/orders/:purchaseOrderId/lines/:lineId/cancel-line',
  authorize('PROCUREMENT_WRITE', { allowedRoles: ['MASTER', 'CAFE_ADMIN'] }),
  cancelLine
);

router.post(
  '/orders/:purchaseOrderId/lines/:lineId/substitute/propose',
  authorize('PROCUREMENT_WRITE', { allowedRoles: ['MASTER', 'CAFE_ADMIN'] }),
  proposeSubstitution
);

router.post(
  '/orders/:purchaseOrderId/lines/:lineId/substitute/decide',
  authorize('PROCUREMENT_APPROVE', { allowedRoles: ['MASTER', 'CAFE_ADMIN'] }),
  decideSubstitution
);

router.post(
  '/orders/:purchaseOrderId/lines/:lineId/source-elsewhere',
  authorize('PROCUREMENT_WRITE', { allowedRoles: ['MASTER', 'CAFE_ADMIN'] }),
  sourceElsewhere
);

router.get(
  '/suppliers/:vendorId/fulfillment-metrics',
  authorize('PROCUREMENT_READ', { allowedRoles: ['MASTER', 'OWNER', 'CAFE_ADMIN'] }),
  getVendorFulfillmentAnalytics
);

router.post(
  '/orders/:purchaseOrderId/send-to-accounts',
  authorize('PROCUREMENT_WRITE', { allowedRoles: ['MASTER', 'CAFE_ADMIN'] }),
  sendToAccounts
);

// ── ZAMORIN AI INVOICE INTELLIGENCE (PHASE 26) ───────────────────────────────
const invoiceIntelligenceRoutes = require('./invoiceIntelligenceRoutes');
router.use('/', invoiceIntelligenceRoutes);

module.exports = router;

