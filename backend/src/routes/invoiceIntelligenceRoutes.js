'use strict';

/**
 * ZAMORIN AI INVOICE INTELLIGENCE — ROUTE DEFINITIONS (PHASES 18, 26)
 *
 * Mounted under /api/v1/procurement:
 *   POST /api/v1/procurement/vendor-bill/:documentId/extract
 *   GET  /api/v1/procurement/vendor-bill/:documentId/extraction
 *   POST /api/v1/procurement/vendor-bill/:documentId/reprocess
 *   POST /api/v1/procurement/vendor-bill/:documentId/correct
 *   POST /api/v1/procurement/vendor-bill/:documentId/approve-extraction
 *   GET  /api/v1/procurement/ai-invoices/exceptions
 *   GET  /api/v1/procurement/ai-invoices/analytics
 *
 * RBAC TOPOLOGY:
 *   - PRIMARY MASTER: Full enterprise extraction, correction, and approval authority
 *   - OWNER: Read-only extraction & exception reporting visibility
 *   - CAFE OPERATIONS (CAFE_ADMIN): Upload/extract/view/correct scoped to assigned café
 *   - STAFF: Strictly DENIED (HTTP 403) — Self-service only
 */

const express = require('express');
const multer = require('multer');
const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');
const { authenticate } = require('../middleware/authenticate');
const { authorize } = require('../middleware/authorize');
const { DEFAULT_DOCUMENT_MAX_BYTES } = require('../services/documentAttachmentService');
const { InvoiceIntelligenceController } = require('../controllers/invoiceIntelligenceController');

const router = express.Router();

const UPLOAD_STAGING_DIR = path.join(os.tmpdir(), 'zamorin_ai_invoice_staging');
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
    const uniqueSuffix = `ai-inv-${Date.now()}-${crypto.randomBytes(6).toString('hex')}${path.extname(file.originalname || '.pdf')}`;
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

// All invoice intelligence routes require active authentication
router.use(authenticate);

// ── Vendor Bill Extraction & Reprocessing ────────────────────────────────────
router.post(
  '/vendor-bill/:documentId/extract',
  authorize('PROCUREMENT_WRITE', { allowedRoles: ['MASTER', 'CAFE_ADMIN'] }),
  upload.single('file'),
  InvoiceIntelligenceController.extractVendorBill
);

router.get(
  '/vendor-bill/:documentId/extraction',
  authorize('PROCUREMENT_READ', { allowedRoles: ['MASTER', 'OWNER', 'CAFE_ADMIN'] }),
  InvoiceIntelligenceController.getExtraction
);

router.post(
  '/vendor-bill/:documentId/reprocess',
  authorize('PROCUREMENT_WRITE', { allowedRoles: ['MASTER', 'CAFE_ADMIN'] }),
  upload.single('file'),
  InvoiceIntelligenceController.reprocessVendorBill
);

// ── Human Review, Corrections & AP Handoff Approval ──────────────────────────
router.post(
  '/vendor-bill/:documentId/correct',
  authorize('PROCUREMENT_WRITE', { allowedRoles: ['MASTER', 'CAFE_ADMIN'] }),
  InvoiceIntelligenceController.correctExtraction
);

router.post(
  '/vendor-bill/:documentId/approve-extraction',
  authorize('PROCUREMENT_APPROVE', { allowedRoles: ['MASTER', 'CAFE_ADMIN'] }),
  InvoiceIntelligenceController.approveExtraction
);

// ── Exceptions & Observability Analytics ─────────────────────────────────────
router.get(
  '/ai-invoices/exceptions',
  authorize('PROCUREMENT_READ', { allowedRoles: ['MASTER', 'OWNER', 'CAFE_ADMIN'] }),
  InvoiceIntelligenceController.listExceptions
);

router.get(
  '/ai-invoices/analytics',
  authorize('PROCUREMENT_READ', { allowedRoles: ['MASTER', 'OWNER', 'CAFE_ADMIN'] }),
  InvoiceIntelligenceController.getAnalytics
);

module.exports = router;
