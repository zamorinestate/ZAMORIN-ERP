'use strict';

/**
 * ZAMORIN AI INVOICE INTELLIGENCE — CONTROLLER (PHASES 18, 26, 27)
 *
 * REST API Controller for AI Invoice Intelligence:
 *   - POST /api/v1/procurement/vendor-bill/:documentId/extract
 *   - GET  /api/v1/procurement/vendor-bill/:documentId/extraction
 *   - POST /api/v1/procurement/vendor-bill/:documentId/reprocess
 *   - POST /api/v1/procurement/vendor-bill/:documentId/correct
 *   - POST /api/v1/procurement/vendor-bill/:documentId/approve-extraction
 *   - GET  /api/v1/procurement/ai-invoices/exceptions
 *   - GET  /api/v1/procurement/ai-invoices/analytics
 *
 * RBAC TOPOLOGY ENFORCEMENT:
 *   - PRIMARY MASTER: Full enterprise visibility and approval authority.
 *   - OWNER: Visibility & read-only reporting access.
 *   - CAFE OPERATIONS (CAFE_ADMIN): Strictly scoped to assigned cafés.
 *   - STAFF: Explicitly DENIED (403 PERMISSION_DENIED) — Self-service only.
 */

const fs = require('fs');
const { InvoiceExtraction } = require('../models/InvoiceExtraction');
const { BusinessDocument } = require('../models/BusinessDocument');
const { InvoiceExtractionService } = require('../services/ai/invoiceExtractionService');
const { recordRequestAudit } = require('../services/auditService');

function assertCafeAccess(auth, targetCafeId) {
  if (!auth) return false;
  if (auth.role === 'MASTER' || auth.role === 'OWNER') return true;
  if (auth.role === 'CAFE_ADMIN') {
    if (!targetCafeId) return true;
    const userCafes = Array.isArray(auth.accessibleCafes)
      ? auth.accessibleCafes.map((c) => String(c).toUpperCase())
      : [String(auth.cafeId || '').toUpperCase()];
    return userCafes.includes(String(targetCafeId).toUpperCase());
  }
  return false;
}

class InvoiceIntelligenceController {
  /**
   * Triggers or retrieves invoice extraction for a vendor bill document.
   */
  static async extractVendorBill(req, res) {
    try {
      const { documentId } = req.params;
      const { purchaseOrderId, grnId, cafeId } = req.body;
      const orgId = req.auth.organisationId;

      if (req.auth.role === 'STAFF') {
        return res.status(403).json({
          error: { code: 'PERMISSION_DENIED', message: 'Staff persona is restricted to self-service.' },
        });
      }

      let fileBuffer = null;
      let mimeType = 'application/pdf';
      let filename = 'vendor-bill.pdf';

      if (req.file) {
        fileBuffer = fs.readFileSync(req.file.path);
        mimeType = req.file.mimetype || 'application/pdf';
        filename = req.file.originalname || 'vendor-bill.pdf';
        try { fs.unlinkSync(req.file.path); } catch (_) {}
      } else {
        // Look up registered BusinessDocument if file not provided directly
        const doc = await BusinessDocument.findOne({
          organisationId: orgId,
          documentId,
          isDeleted: false,
        }).lean();

        if (doc) {
          mimeType = doc.mimeType || 'application/pdf';
          filename = doc.originalFilename || `${documentId}.pdf`;
        }
      }

      const effectiveCafeId = cafeId || req.auth.cafeId;
      if (!assertCafeAccess(req.auth, effectiveCafeId)) {
        return res.status(403).json({
          error: { code: 'CROSS_CAFE_ACCESS_DENIED', message: 'User lacks authority for target café.' },
        });
      }

      const extraction = await InvoiceExtractionService.processInvoice({
        documentId,
        fileBuffer,
        mimeType,
        filename,
        organisationId: orgId,
        cafeId: effectiveCafeId,
        purchaseOrderId,
        grnId,
        uploadedByUserId: req.auth.userId,
        isReprocess: false,
      });

      await recordRequestAudit({
        request: req,
        module: 'PROCUREMENT',
        action: 'AI_INVOICE_EXTRACT',
        entityType: 'INVOICE_EXTRACTION',
        entityId: documentId,
        cafeId: effectiveCafeId,
        afterState: { status: extraction.status, confidence: extraction.compositeConfidence?.overallScore },
      });

      return res.status(200).json({
        success: true,
        data: extraction,
      });
    } catch (err) {
      return res.status(500).json({
        error: { code: 'EXTRACTION_PROCESSING_ERROR', message: err.message },
      });
    }
  }

  /**
   * Retrieves extracted data, validation status, and exceptions for a document.
   */
  static async getExtraction(req, res) {
    try {
      const { documentId } = req.params;
      const orgId = req.auth.organisationId;

      if (req.auth.role === 'STAFF') {
        return res.status(403).json({
          error: { code: 'PERMISSION_DENIED', message: 'Staff persona is restricted to self-service.' },
        });
      }

      const extraction = await InvoiceExtraction.findOne({
        organisationId: orgId,
        documentId,
      }).lean();

      if (!extraction) {
        return res.status(404).json({
          error: { code: 'EXTRACTION_NOT_FOUND', message: `No extraction found for document ${documentId}` },
        });
      }

      if (!assertCafeAccess(req.auth, extraction.cafeId)) {
        return res.status(403).json({
          error: { code: 'CROSS_CAFE_ACCESS_DENIED', message: 'User lacks authority for target café.' },
        });
      }

      return res.status(200).json({
        success: true,
        data: extraction,
      });
    } catch (err) {
      return res.status(500).json({
        error: { code: 'INTERNAL_ERROR', message: err.message },
      });
    }
  }

  /**
   * Reprocesses an existing invoice extraction.
   */
  static async reprocessVendorBill(req, res) {
    try {
      const { documentId } = req.params;
      const orgId = req.auth.organisationId;

      if (req.auth.role === 'STAFF') {
        return res.status(403).json({
          error: { code: 'PERMISSION_DENIED', message: 'Staff persona is restricted to self-service.' },
        });
      }

      let existing = await InvoiceExtraction.findOne({ organisationId: orgId, documentId });
      if (!existing) {
        return res.status(404).json({
          error: { code: 'EXTRACTION_NOT_FOUND', message: `Extraction record not found for document ${documentId}` },
        });
      }

      if (!assertCafeAccess(req.auth, existing.cafeId)) {
        return res.status(403).json({
          error: { code: 'CROSS_CAFE_ACCESS_DENIED', message: 'User lacks authority for target café.' },
        });
      }

      let fileBuffer = null;
      let mimeType = 'application/pdf';
      let filename = 'reprocess.pdf';

      if (req.file) {
        fileBuffer = fs.readFileSync(req.file.path);
        mimeType = req.file.mimetype || 'application/pdf';
        filename = req.file.originalname || 'reprocess.pdf';
        try { fs.unlinkSync(req.file.path); } catch (_) {}
      }

      const reprocessed = await InvoiceExtractionService.processInvoice({
        documentId,
        fileBuffer,
        mimeType,
        filename,
        organisationId: orgId,
        cafeId: existing.cafeId,
        purchaseOrderId: existing.purchaseOrderId,
        grnId: existing.grnId,
        uploadedByUserId: req.auth.userId,
        isReprocess: true,
      });

      await recordRequestAudit({
        request: req,
        module: 'PROCUREMENT',
        action: 'AI_INVOICE_REPROCESS',
        entityType: 'INVOICE_EXTRACTION',
        entityId: documentId,
        cafeId: existing.cafeId,
        afterState: { status: reprocessed.status, attemptCount: reprocessed.attemptCount },
      });

      return res.status(200).json({
        success: true,
        data: reprocessed,
      });
    } catch (err) {
      return res.status(500).json({
        error: { code: 'REPROCESS_FAILED', message: err.message },
      });
    }
  }

  /**
   * Applies auditable human corrections to extracted fields.
   */
  static async correctExtraction(req, res) {
    try {
      const { documentId } = req.params;
      const { corrections } = req.body;
      const orgId = req.auth.organisationId;

      if (req.auth.role === 'STAFF') {
        return res.status(403).json({
          error: { code: 'PERMISSION_DENIED', message: 'Staff persona is restricted to self-service.' },
        });
      }

      if (!Array.isArray(corrections) || corrections.length === 0) {
        return res.status(400).json({
          error: { code: 'INVALID_CORRECTIONS', message: 'Corrections array is required.' },
        });
      }

      const existing = await InvoiceExtraction.findOne({ organisationId: orgId, documentId });
      if (!existing) {
        return res.status(404).json({
          error: { code: 'EXTRACTION_NOT_FOUND', message: `Extraction record not found for document ${documentId}` },
        });
      }

      if (!assertCafeAccess(req.auth, existing.cafeId)) {
        return res.status(403).json({
          error: { code: 'CROSS_CAFE_ACCESS_DENIED', message: 'User lacks authority for target café.' },
        });
      }

      const updated = await InvoiceExtractionService.applyHumanCorrection({
        documentId,
        organisationId: orgId,
        corrections,
        user: { userId: req.auth.userId, role: req.auth.role },
      });

      await recordRequestAudit({
        request: req,
        module: 'PROCUREMENT',
        action: 'AI_INVOICE_CORRECTION',
        entityType: 'INVOICE_EXTRACTION',
        entityId: documentId,
        cafeId: existing.cafeId,
        afterState: { correctionCount: updated.corrections.length, status: updated.status },
      });

      return res.status(200).json({
        success: true,
        data: updated,
      });
    } catch (err) {
      return res.status(500).json({
        error: { code: 'CORRECTION_FAILED', message: err.message },
      });
    }
  }

  /**
   * Approves the extraction proposal, moving it to standard AP approval queue.
   */
  static async approveExtraction(req, res) {
    try {
      const { documentId } = req.params;
      const { approvalNotes } = req.body;
      const orgId = req.auth.organisationId;

      if (req.auth.role === 'STAFF') {
        return res.status(403).json({
          error: { code: 'PERMISSION_DENIED', message: 'Staff persona is restricted to self-service.' },
        });
      }

      const existing = await InvoiceExtraction.findOne({ organisationId: orgId, documentId });
      if (!existing) {
        return res.status(404).json({
          error: { code: 'EXTRACTION_NOT_FOUND', message: `Extraction record not found for document ${documentId}` },
        });
      }

      if (!assertCafeAccess(req.auth, existing.cafeId)) {
        return res.status(403).json({
          error: { code: 'CROSS_CAFE_ACCESS_DENIED', message: 'User lacks authority for target café.' },
        });
      }

      const approved = await InvoiceExtractionService.approveExtraction({
        documentId,
        organisationId: orgId,
        user: { userId: req.auth.userId, role: req.auth.role },
        approvalNotes: approvalNotes || 'Extraction approved for AP workflow',
      });

      await recordRequestAudit({
        request: req,
        module: 'PROCUREMENT',
        action: 'AI_INVOICE_APPROVE_EXTRACTION',
        entityType: 'INVOICE_EXTRACTION',
        entityId: documentId,
        cafeId: existing.cafeId,
        afterState: { status: approved.status, decision: approved.reviewDecision },
      });

      return res.status(200).json({
        success: true,
        data: approved,
      });
    } catch (err) {
      return res.status(400).json({
        error: { code: 'APPROVAL_FAILED', message: err.message },
      });
    }
  }

  /**
   * Lists unresolved extraction exceptions across invoices.
   */
  static async listExceptions(req, res) {
    try {
      const orgId = req.auth.organisationId;
      const { severity, code, cafeId, page = 1, limit = 20 } = req.query;

      if (req.auth.role === 'STAFF') {
        return res.status(403).json({
          error: { code: 'PERMISSION_DENIED', message: 'Staff persona is restricted to self-service.' },
        });
      }

      const filter = {
        organisationId: orgId,
        'exceptions.0': { $exists: true },
      };

      if (req.auth.role === 'CAFE_ADMIN') {
        filter.cafeId = req.auth.cafeId;
      } else if (cafeId && cafeId !== 'ALL') {
        filter.cafeId = String(cafeId).toUpperCase();
      }

      const pageNum = Math.max(1, parseInt(page, 10) || 1);
      const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));

      const extractions = await InvoiceExtraction.find(filter)
        .select('documentId invoice.invoiceNumber supplier.name cafeId exceptions status createdAt')
        .sort({ createdAt: -1 })
        .skip((pageNum - 1) * limitNum)
        .limit(limitNum)
        .lean();

      const total = await InvoiceExtraction.countDocuments(filter);

      return res.status(200).json({
        success: true,
        data: {
          items: extractions,
          pagination: {
            page: pageNum,
            limit: limitNum,
            total,
            totalPages: Math.ceil(total / limitNum),
          },
        },
      });
    } catch (err) {
      return res.status(500).json({
        error: { code: 'INTERNAL_ERROR', message: err.message },
      });
    }
  }

  /**
   * Returns observability analytics (Phase 27).
   */
  static async getAnalytics(req, res) {
    try {
      const orgId = req.auth.organisationId;

      if (req.auth.role === 'STAFF') {
        return res.status(403).json({
          error: { code: 'PERMISSION_DENIED', message: 'Staff persona is restricted to self-service.' },
        });
      }

      const filter = { organisationId: orgId };
      if (req.auth.role === 'CAFE_ADMIN') {
        filter.cafeId = req.auth.cafeId;
      }

      const all = await InvoiceExtraction.find(filter)
        .select('status compositeConfidence duplicateCheck threeWayMatch vendorMatch corrections providerMetadata')
        .lean();

      const totalCount = all.length;
      const successCount = all.filter((r) => r.status !== 'FAILED').length;
      const failureCount = all.filter((r) => r.status === 'FAILED').length;
      const cleanMatchCount = all.filter((r) => r.status === 'READY_FOR_APPROVAL').length;
      const reviewRequiredCount = all.filter((r) => r.status === 'REVIEW_REQUIRED').length;
      const duplicateCount = all.filter((r) => r.duplicateCheck?.status === 'EXACT_DUPLICATE').length;
      const vendorMatchedCount = all.filter((r) => r.vendorMatch?.status === 'MATCHED').length;
      const correctedCount = all.filter((r) => (r.corrections || []).length > 0).length;

      const totalConfidence = all.reduce((acc, r) => acc + (r.compositeConfidence?.overallScore || 0), 0);
      const avgConfidence = totalCount > 0 ? Number((totalConfidence / totalCount).toFixed(3)) : 0;

      return res.status(200).json({
        success: true,
        data: {
          totalCount,
          successCount,
          failureCount,
          cleanMatchCount,
          reviewRequiredCount,
          duplicateCount,
          vendorMatchedCount,
          correctedCount,
          avgConfidence,
          cleanMatchPercentage: totalCount > 0 ? Number(((cleanMatchCount / totalCount) * 100).toFixed(1)) : 0,
          vendorMatchPercentage: totalCount > 0 ? Number(((vendorMatchedCount / totalCount) * 100).toFixed(1)) : 0,
        },
      });
    } catch (err) {
      return res.status(500).json({
        error: { code: 'INTERNAL_ERROR', message: err.message },
      });
    }
  }
}

module.exports = {
  InvoiceIntelligenceController,
};
