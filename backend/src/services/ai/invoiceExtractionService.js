'use strict';

/**
 * ZAMORIN AI INVOICE INTELLIGENCE — MAIN EXTRACTION SERVICE (PHASES 5, 6, 7, 16, 22)
 *
 * Core orchestrator for the AI Invoice Intelligence lifecycle:
 *   1. Idempotent check (SHA-256 & documentId fencing)
 *   2. State Machine transitions (UPLOADED -> PROCESSING -> EXTRACTED -> VALIDATED -> MATCHED -> REVIEW_REQUIRED / READY_FOR_APPROVAL)
 *   3. Provider extraction (Document AI / Gemini / Deterministic Mock)
 *   4. Mathematical & GST recalculation (paise-precision)
 *   5. Vendor Master matching (exact GSTIN priority)
 *   6. Deterministic duplicate detection
 *   7. Three-Way Reconciliation (PO ↔ Physical GRN ↔ Extracted Invoice)
 *   8. Multi-factor composite confidence scoring
 *   9. Deterministic exception compilation
 *   10. Auditable attempt tracking and failure resilience
 *
 * NON-NEGOTIABLE SAFETY PRINCIPLES:
 *   - AI extraction NEVER posts General Ledger entries.
 *   - AI extraction NEVER creates vendor liabilities or triggers bank payouts.
 *   - AI extraction NEVER updates inventory or changes physical GRN quantities.
 *   - Provider outages NEVER break standard procurement workflows.
 */

const crypto = require('crypto');
const { InvoiceExtraction } = require('../../models/InvoiceExtraction');
const { BusinessDocument } = require('../../models/BusinessDocument');
const { providerFactory } = require('./providers/providerFactory');
const { InvoiceValidationService } = require('./invoiceValidationService');
const { InvoiceVendorMatchingService } = require('./invoiceVendorMatchingService');
const { InvoiceDuplicateDetectionService } = require('./invoiceDuplicateDetectionService');
const { InvoiceThreeWayMatchIntegrationService } = require('./invoiceThreeWayMatchIntegrationService');
const { InvoiceConfidenceService } = require('./invoiceConfidenceService');

class InvoiceExtractionService {
  /**
   * Checks if AI Invoice Intelligence feature is globally enabled.
   */
  static isFeatureEnabled() {
    return process.env.AI_INVOICE_INTELLIGENCE_ENABLED !== 'false';
  }

  /**
   * Computes SHA-256 hash of a buffer.
   */
  static computeSha256(buffer) {
    if (!buffer) return null;
    return crypto.createHash('sha256').update(buffer).digest('hex');
  }

  /**
   * Deterministic, auditable canary traffic allocator.
   * Uses SHA-256 of documentId mod 100 to allocate traffic without cherry-picking.
   */
  static getCanaryAllocation(documentId) {
    const rawPercentage = process.env.AI_INVOICE_CANARY_PERCENTAGE;
    const canaryPercentage = rawPercentage !== undefined ? parseInt(rawPercentage, 10) : 100;

    if (isNaN(canaryPercentage) || canaryPercentage >= 100) {
      return { isSelectedForAi: true, canaryCohort: 'AI_FULL', bucket: 0, canaryPercentage: 100 };
    }
    if (canaryPercentage <= 0) {
      return { isSelectedForAi: false, canaryCohort: 'MANUAL_CONTROL', bucket: 0, canaryPercentage: 0 };
    }

    const hash = crypto.createHash('sha256').update(String(documentId)).digest('hex');
    const bucket = parseInt(hash.substring(0, 8), 16) % 100;
    const isSelected = bucket < canaryPercentage;

    return {
      isSelectedForAi: isSelected,
      canaryCohort: isSelected ? 'AI_CANARY' : 'MANUAL_CONTROL',
      bucket,
      canaryPercentage,
    };
  }

  /**
   * Processes a vendor bill document through the full intelligence pipeline.
   *
   * @param {Object} params
   * @param {string} params.documentId - Authoritative BusinessDocument ID
   * @param {Buffer} [params.fileBuffer] - Document binary content
   * @param {string} [params.mimeType] - e.g. application/pdf, image/jpeg, image/png
   * @param {string} [params.filename]
   * @param {string} params.organisationId
   * @param {string} [params.cafeId]
   * @param {string} [params.purchaseOrderId]
   * @param {string} [params.grnId]
   * @param {string} params.uploadedByUserId
   * @param {string} [params.storageReference]
   * @param {boolean} [params.isReprocess=false]
   * @returns {Promise<Object>} Completed InvoiceExtraction document
   */
  static async processInvoice({
    documentId,
    fileBuffer = null,
    mimeType = 'application/pdf',
    filename = 'invoice.pdf',
    organisationId,
    cafeId = null,
    purchaseOrderId = null,
    grnId = null,
    uploadedByUserId,
    storageReference = null,
    isReprocess = false,
  }) {
    if (!documentId) throw new Error('documentId is required');
    if (!organisationId) throw new Error('organisationId is required');

    const orgId = String(organisationId).trim().toUpperCase();
    const docId = String(documentId).trim();
    const documentHash = fileBuffer ? this.computeSha256(fileBuffer) : null;

    // ── Phase 7: Extraction Idempotency & Fencing ──────────────────────────────
    let record = await InvoiceExtraction.findOne({
      organisationId: orgId,
      documentId: docId,
    });

    if (record && !isReprocess) {
      // If already processing in another concurrent worker within the last 90 seconds, guard collision
      if (
        record.status === 'PROCESSING' &&
        record.processingStartedAt &&
        Date.now() - new Date(record.processingStartedAt).getTime() < 90000
      ) {
        return record;
      }

      // If already completed and not requested to reprocess, return existing extraction
      if (['VALIDATED', 'MATCHED', 'REVIEW_REQUIRED', 'READY_FOR_APPROVAL'].includes(record.status)) {
        return record;
      }
    }

    // Initialize or re-open record
    const attemptStartTime = new Date();
    if (!record) {
      record = new InvoiceExtraction({
        documentId: docId,
        organisationId: orgId,
        cafeId: cafeId ? String(cafeId).trim().toUpperCase() : null,
        purchaseOrderId: purchaseOrderId ? String(purchaseOrderId).trim().toUpperCase() : null,
        grnId: grnId ? String(grnId).trim().toUpperCase() : null,
        storageReference: storageReference || `documents/${docId}`,
        documentHash: documentHash || 'UNKNOWN_HASH',
        status: 'PROCESSING',
        uploadedBy: uploadedByUserId || 'SYSTEM',
        uploadedAt: attemptStartTime,
        processingStartedAt: attemptStartTime,
        attemptCount: 1,
        attempts: [
          {
            attemptNumber: 1,
            startedAt: attemptStartTime,
            status: 'PROCESSING',
          },
        ],
      });
    } else {
      record.status = 'PROCESSING';
      record.processingStartedAt = attemptStartTime;
      record.attemptCount = (record.attemptCount || 0) + 1;
      if (documentHash) record.documentHash = documentHash;
      if (purchaseOrderId) record.purchaseOrderId = purchaseOrderId;
      if (grnId) record.grnId = grnId;

      record.attempts.push({
        attemptNumber: record.attemptCount,
        startedAt: attemptStartTime,
        status: 'PROCESSING',
      });
    }

    try {
      await record.save();
    } catch (saveErr) {
      if (saveErr.code === 11000 || (saveErr.message && saveErr.message.includes('E11000'))) {
        const winner = await InvoiceExtraction.findOne({ organisationId: orgId, documentId: docId });
        if (winner) return winner;
      }
      throw saveErr;
    }

    // ── Check Feature Flag ────────────────────────────────────────────────────
    if (!this.isFeatureEnabled()) {
      record.status = 'FAILED';
      record.lastErrorCode = 'AI_FEATURE_DISABLED';
      const currentAttempt = record.attempts[record.attempts.length - 1];
      currentAttempt.status = 'FAILED';
      currentAttempt.completedAt = new Date();
      currentAttempt.errorMessage = 'AI Invoice Intelligence is currently disabled by system configuration.';
      await record.save();
      return record;
    }

    // ── Traffic Allocation: Check Canary Split ────────────────────────────────
    const canary = InvoiceExtractionService.getCanaryAllocation(docId);
    record.canaryAllocation = {
      cohort: canary.canaryCohort,
      bucket: canary.bucket,
      canaryPercentage: canary.canaryPercentage,
    };

    if (!canary.isSelectedForAi) {
      const completedTime = new Date();
      record.status = 'REVIEW_REQUIRED';
      record.processingCompletedAt = completedTime;
      const currentAttempt = record.attempts[record.attempts.length - 1];
      currentAttempt.status = 'REVIEW_REQUIRED';
      currentAttempt.completedAt = completedTime;
      currentAttempt.errorMessage = `Document routed to manual control queue (${canary.canaryPercentage}% AI canary active; document bucket: ${canary.bucket}).`;
      record.exceptions = [
        {
          code: 'CANARY_MANUAL_CONTROL',
          message: `Document routed to manual control queue (${canary.canaryPercentage}% AI canary active; document bucket: ${canary.bucket}).`,
          severity: 'WARNING',
          isResolved: false,
        },
      ];
      await record.save();
      return record;
    }

    // ── Phase 2 & 23: Provider Execution & Failure Handling ───────────────────
    let provider;
    try {
      provider = providerFactory.getProvider();
    } catch (configErr) {
      const completedTime = new Date();
      record.status = 'FAILED';
      record.lastErrorCode = configErr.code || 'AI_PROVIDER_UNCONFIGURED';
      record.processingCompletedAt = completedTime;
      const currentAttempt = record.attempts[record.attempts.length - 1];
      currentAttempt.status = 'FAILED';
      currentAttempt.completedAt = completedTime;
      currentAttempt.errorMessage = configErr.message;
      record.exceptions = [
        {
          code: 'AI_PROVIDER_UNCONFIGURED',
          message: configErr.message,
          severity: 'BLOCKING',
          isResolved: false,
        },
      ];
      await record.save();
      return record;
    }
    let extractionResult = null;

    try {
      extractionResult = await provider.extractInvoice({
        documentBuffer: fileBuffer,
        mimeType,
        filename,
        options: { organisationId: orgId, cafeId },
      });
    } catch (providerErr) {
      // Safe degradation — never crash caller or break procurement
      const completedTime = new Date();
      const isSchemaValidationFailure = providerErr.code === 'AI_SCHEMA_VALIDATION_FAILED';
      // Phase 0: Schema-invalid response transitions safely to REVIEW_REQUIRED
      record.status = isSchemaValidationFailure ? 'REVIEW_REQUIRED' : 'FAILED';
      record.lastErrorCode = providerErr.code || 'AI_PROVIDER_FAILURE';
      record.processingCompletedAt = completedTime;

      const currentAttempt = record.attempts[record.attempts.length - 1];
      currentAttempt.status = record.status;
      currentAttempt.completedAt = completedTime;
      currentAttempt.errorMessage = providerErr.message || 'Provider extraction failed';
      currentAttempt.provider = provider.getProviderName();
      currentAttempt.modelVersion = provider.getModelVersion();

      record.exceptions = [
        {
          code: isSchemaValidationFailure ? 'AI_SCHEMA_VALIDATION_FAILED' : 'AI_PROVIDER_FAILURE',
          message: `AI Provider (${provider.getProviderName()}) failed: ${providerErr.message}`,
          severity: 'BLOCKING',
          isResolved: false,
        },
      ];

      await record.save();
      return record;
    }

    const {
      schemaVersion,
      documentType,
      supplier,
      invoice,
      lineItems,
      totals,
      bankDetails,
      provenance = {},
      extractionMetadata,
    } = extractionResult;

    record.schemaVersion = schemaVersion || '2026.1';
    record.documentType = documentType || 'TAX_INVOICE';
    record.supplier = supplier || {};
    record.invoice = invoice || {};
    record.lineItems = lineItems || [];
    record.totals = totals || {};
    record.bankDetails = bankDetails || {};
    record.provenance = provenance || {};
    record.providerMetadata = {
      provider: extractionMetadata?.provider || provider.getProviderName(),
      modelVersion: extractionMetadata?.modelVersion || provider.getModelVersion(),
      processorId: extractionMetadata?.processorId || null,
      processorVersion: extractionMetadata?.processorVersion || null,
      providerRequestId: extractionMetadata?.providerRequestId || null,
      pageCount: extractionMetadata?.pageCount || 1,
      processingDurationMs: extractionMetadata?.durationMs || extractionMetadata?.processingDurationMs || (Date.now() - attemptStartTime.getTime()),
    };

    const currentAttempt = record.attempts[record.attempts.length - 1];
    currentAttempt.provider = record.providerMetadata.provider;
    currentAttempt.modelVersion = record.providerMetadata.modelVersion;
    currentAttempt.processorId = record.providerMetadata.processorId;
    currentAttempt.processorVersion = record.providerMetadata.processorVersion;
    currentAttempt.schemaVersion = record.schemaVersion;

    // Update PO / GRN references if extracted from document and not previously passed
    if (!record.purchaseOrderId && invoice?.purchaseOrderNumber) {
      record.purchaseOrderId = String(invoice.purchaseOrderNumber).trim().toUpperCase();
    }
    if (!record.grnId && invoice?.deliveryReference) {
      record.grnId = String(invoice.deliveryReference).trim().toUpperCase();
    }

    // ── Phase 10 & 11: Deterministic Mathematical & GST Validation ────────────
    const validationResult = InvoiceValidationService.validate({
      lineItems: record.lineItems,
      totals: record.totals,
      supplier: record.supplier,
      invoice: record.invoice,
    });
    record.mathematicalValidation = validationResult;

    // ── Phase 8: Vendor Master Matching ───────────────────────────────────────
    const vendorMatchResult = await InvoiceVendorMatchingService.matchSupplier({
      extractedSupplier: record.supplier,
      organisationId: orgId,
      cafeId,
    });
    record.vendorMatch = vendorMatchResult;
    if (vendorMatchResult.matchedVendorId) {
      record.vendorId = vendorMatchResult.matchedVendorId;
    }

    // ── Phase 9: Duplicate Invoice Detection ──────────────────────────────────
    const duplicateResult = await InvoiceDuplicateDetectionService.checkDuplicate({
      documentId: docId,
      documentHash: record.documentHash,
      extracted: {
        supplier: record.supplier,
        invoice: record.invoice,
        totals: record.totals,
      },
      vendorMatch: vendorMatchResult,
      organisationId: orgId,
      cafeId,
    });
    record.duplicateCheck = duplicateResult;

    // ── Phases 12, 13, 14: Three-Way Match Engine (PO ↔ GRN ↔ INVOICE) ────────
    const threeWayMatchResult = await InvoiceThreeWayMatchIntegrationService.reconcile({
      extracted: {
        lineItems: record.lineItems,
        totals: record.totals,
        invoice: record.invoice,
      },
      matchedVendorId: vendorMatchResult.matchedVendorId,
      purchaseOrderId: record.purchaseOrderId,
      grnId: record.grnId,
      organisationId: orgId,
      cafeId,
    });
    record.threeWayMatch = threeWayMatchResult;

    // ── Phase 15: Multi-Factor Composite Confidence Score ─────────────────────
    const confidenceResult = InvoiceConfidenceService.calculateCompositeScore({
      extracted: {
        supplier: record.supplier,
        invoice: record.invoice,
        lineItems: record.lineItems,
        totals: record.totals,
      },
      provenance: record.provenance,
      validation: validationResult,
      vendorMatch: vendorMatchResult,
      duplicateResult,
      threeWayMatch: threeWayMatchResult,
    });
    record.compositeConfidence = confidenceResult;

    // ── Phase 16: Deterministic Exception Compilation ─────────────────────────
    const exceptions = [];

    // Missing header data
    if (!record.invoice?.invoiceNumber) {
      exceptions.push({
        code: 'INVOICE_NUMBER_MISSING',
        message: 'Invoice number could not be extracted from the document.',
        field: 'invoice.invoiceNumber',
        severity: 'BLOCKING',
      });
    }
    if (!record.invoice?.invoiceDate) {
      exceptions.push({
        code: 'INVOICE_DATE_MISSING',
        message: 'Invoice date could not be extracted from the document.',
        field: 'invoice.invoiceDate',
        severity: 'BLOCKING',
      });
    }

    // Vendor exceptions
    if (vendorMatchResult.status === 'NOT_FOUND') {
      exceptions.push({
        code: 'VENDOR_NOT_FOUND',
        message: `Supplier "${record.supplier?.name || 'Unknown'}" (GSTIN: ${record.supplier?.gstin || 'None'}) not found in Vendor Master.`,
        field: 'supplier.gstin',
        severity: 'BLOCKING',
      });
    } else if (vendorMatchResult.status === 'AMBIGUOUS') {
      exceptions.push({
        code: 'VENDOR_AMBIGUOUS',
        message: 'Multiple supplier candidates found in Vendor Master. Manual assignment required.',
        field: 'supplier.name',
        severity: 'BLOCKING',
      });
    }

    // Duplicate exceptions
    if (duplicateResult.status === 'EXACT_DUPLICATE') {
      exceptions.push({
        code: 'EXACT_DUPLICATE',
        message: duplicateResult.reason,
        field: 'invoice.invoiceNumber',
        severity: 'BLOCKING',
      });
    } else if (duplicateResult.status === 'POSSIBLE_DUPLICATE') {
      exceptions.push({
        code: 'POSSIBLE_DUPLICATE',
        message: duplicateResult.reason,
        field: 'invoice.invoiceNumber',
        severity: 'WARNING',
      });
    }

    // Mathematical & GST validation discrepancies
    for (const disc of validationResult.discrepancies || []) {
      exceptions.push({
        code: disc.code,
        message: disc.message,
        field: disc.field,
        severity: disc.severity || 'BLOCKING',
      });
    }

    // Three-Way Match discrepancies
    for (const disc of threeWayMatchResult.overallDiscrepancies || []) {
      exceptions.push({
        code: disc.code,
        message: disc.message,
        severity: disc.severity || 'BLOCKING',
      });
    }

    // Line item variances
    for (const lm of threeWayMatchResult.lineMatches || []) {
      if (lm.matchResult !== 'MATCH') {
        exceptions.push({
          code: lm.matchResult === 'QUANTITY_VARIANCE' ? 'INVOICE_GRN_QUANTITY_MISMATCH' : (lm.matchResult === 'PRICE_VARIANCE' ? 'PO_PRICE_MISMATCH' : lm.matchResult),
          message: lm.discrepancyReason || `Variance on line ${lm.lineNumber}: ${lm.matchResult}`,
          field: `lineItems[${lm.lineNumber - 1}]`,
          severity: lm.matchResult === 'TAX_MISMATCH' ? 'WARNING' : 'BLOCKING',
        });
      }
    }

    // Low confidence warning
    if (confidenceResult.level === 'LOW') {
      exceptions.push({
        code: 'LOW_EXTRACTION_CONFIDENCE',
        message: `Composite extraction confidence is low (${(confidenceResult.overallScore * 100).toFixed(1)}%). Mandatory review required.`,
        severity: 'WARNING',
      });
    }

    record.exceptions = exceptions;

    // ── Phase 6: State Machine Transition ─────────────────────────────────────
    const hasBlockingExceptions = exceptions.some((e) => e.severity === 'BLOCKING');
    const isCleanMatch =
      !hasBlockingExceptions &&
      ['MATCHED', 'MATCHED_WITH_TOLERANCE'].includes(threeWayMatchResult.status) &&
      confidenceResult.level === 'HIGH' &&
      duplicateResult.status === 'NOT_DUPLICATE' &&
      validationResult.isValid;

    if (isCleanMatch) {
      record.status = 'READY_FOR_APPROVAL';
    } else {
      record.status = 'REVIEW_REQUIRED';
    }

    const completedAt = new Date();
    record.processingCompletedAt = completedAt;
    currentAttempt.status = 'COMPLETED';
    currentAttempt.completedAt = completedAt;
    currentAttempt.extractedAt = completedAt;

    await record.save();
    return record;
  }

  /**
   * Applies auditable human corrections to extracted fields (Phase 20).
   *
   * @param {Object} params
   * @param {string} params.documentId
   * @param {string} params.organisationId
   * @param {Array<Object>} params.corrections - [{ fieldPath, originalValue, correctedValue, reason }]
   * @param {Object} params.user - { userId, role }
   * @returns {Promise<Object>} Updated InvoiceExtraction
   */
  static async applyHumanCorrection({
    documentId,
    organisationId,
    corrections = [],
    user,
  }) {
    const orgId = String(organisationId).trim().toUpperCase();
    const docId = String(documentId).trim();

    const record = await InvoiceExtraction.findOne({
      organisationId: orgId,
      documentId: docId,
    });

    if (!record) {
      throw new Error(`Invoice extraction record not found for document ${docId}`);
    }

    for (const corr of corrections) {
      const { fieldPath, originalValue, correctedValue, reason } = corr;
      if (!fieldPath) continue;

      // Log correction history
      record.corrections.push({
        fieldPath,
        originalValue,
        correctedValue,
        reason: reason || 'Manual reviewer correction',
        correctedByUserId: user.userId,
        correctedByRole: user.role,
        correctedAt: new Date(),
      });

      // Apply value to path safely
      const parts = fieldPath.split('.');
      let target = record;
      for (let i = 0; i < parts.length - 1; i++) {
        if (!target[parts[i]]) target[parts[i]] = {};
        target = target[parts[i]];
      }
      target[parts[parts.length - 1]] = correctedValue;
    }

    // Re-run mathematical validation with corrected values
    const validationResult = InvoiceValidationService.validate({
      lineItems: record.lineItems,
      totals: record.totals,
      supplier: record.supplier,
      invoice: record.invoice,
    });
    record.mathematicalValidation = validationResult;

    // Resolve any mathematical exceptions if now valid
    if (validationResult.isValid) {
      for (const exc of record.exceptions) {
        if (['TOTAL_MISMATCH', 'LINE_CALCULATION_MISMATCH', 'GST_CALCULATION_MISMATCH'].includes(exc.code)) {
          exc.isResolved = true;
          exc.resolvedByUserId = user.userId;
          exc.resolvedAt = new Date();
          exc.resolutionNotes = 'Resolved via human correction';
        }
      }
    }

    // Re-evaluate state
    const remainingBlocking = record.exceptions.filter((e) => e.severity === 'BLOCKING' && !e.isResolved);
    if (remainingBlocking.length === 0) {
      record.status = 'READY_FOR_APPROVAL';
    } else {
      record.status = 'REVIEW_REQUIRED';
    }

    await record.save();
    return record;
  }

  /**
   * Approves the extraction proposal (Phase 17, 18, 20).
   *
   * NON-NEGOTIABLE SAFETY PRINCIPLE:
   * Approving an extraction DOES NOT post General Ledger entries or disburse funds.
   * It moves the verified proposal to the authoritative Procurement/AP approval queue.
   */
  static async approveExtraction({
    documentId,
    organisationId,
    user,
    approvalNotes = '',
  }) {
    const orgId = String(organisationId).trim().toUpperCase();
    const docId = String(documentId).trim();

    const record = await InvoiceExtraction.findOne({
      organisationId: orgId,
      documentId: docId,
    });

    if (!record) {
      throw new Error(`Invoice extraction record not found for document ${docId}`);
    }

    const unResolvedBlocking = (record.exceptions || []).filter((e) => e.severity === 'BLOCKING' && !e.isResolved);
    if (unResolvedBlocking.length > 0) {
      throw new Error(`Cannot approve extraction with unresolved blocking exceptions: ${unResolvedBlocking.map((e) => e.code).join(', ')}`);
    }

    record.reviewDecision = {
      decision: 'APPROVED',
      decidedByUserId: user.userId,
      decidedByRole: user.role,
      decidedAt: new Date(),
      decisionNotes: approvalNotes,
    };
    record.status = 'READY_FOR_APPROVAL';

    await record.save();
    return record;
  }
}

module.exports = {
  InvoiceExtractionService,
};
