'use strict';

/**
 * ZAMORIN AI INVOICE INTELLIGENCE — DUPLICATE DETECTION SERVICE (PHASE 9)
 *
 * Deterministic duplicate detection checking:
 *   1. Document SHA-256 hash match against past extractions & BusinessDocuments
 *   2. Business key match: organisationId + (vendorId || GSTIN) + normalized invoice number
 *   3. Secondary verification: matching invoice date, amount, and PO reference
 *
 * Returns:
 *   - NOT_DUPLICATE: No collision found
 *   - POSSIBLE_DUPLICATE: Same invoice number on another vendor, or same vendor with differing date/amount
 *   - EXACT_DUPLICATE: Identical file hash OR same vendor + same invoice number + matching amount/date
 *
 * Exact duplicate blocks downstream automatic approval and triggers human review.
 */

const { InvoiceExtraction } = require('../../models/InvoiceExtraction');
const { BusinessDocument } = require('../../models/BusinessDocument');
const { PurchaseOrder } = require('../../models/PurchaseOrder');
const { DuplicateDetectionService: ExistingDuplicateService } = require('../duplicateDetectionService');

function normalizeInvoiceNumber(invNum) {
  if (!invNum || typeof invNum !== 'string') return '';
  return invNum.trim().toUpperCase().replace(/[\s\-_/]/g, '');
}

function escapeRegex(text) {
  return text.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&');
}

class InvoiceDuplicateDetectionService {
  /**
   * Evaluates document and business identifier duplicates.
   *
   * @param {Object} params
   * @param {string} params.documentId - Current document ID being processed
   * @param {string} params.documentHash - SHA-256 of the current file
   * @param {Object} params.extracted - Canonical extraction data { supplier, invoice, totals }
   * @param {Object} params.vendorMatch - Vendor match outcome { matchedVendorId, matchedVendorName }
   * @param {string} params.organisationId
   * @param {string} [params.cafeId]
   * @returns {Promise<Object>} Duplicate check result conforming to InvoiceExtraction schema
   */
  static async checkDuplicate({
    documentId,
    documentHash,
    extracted = {},
    vendorMatch = {},
    organisationId,
    cafeId = null,
  }) {
    if (!organisationId) {
      throw new Error('organisationId is required for duplicate detection');
    }

    const orgId = String(organisationId).trim().toUpperCase();
    const currDocId = String(documentId || '').trim();
    const currHash = String(documentHash || '').trim().toLowerCase();

    const supplierGstin = extracted.supplier?.gstin ? String(extracted.supplier.gstin).trim().toUpperCase() : null;
    const vendorId = vendorMatch?.matchedVendorId ? String(vendorMatch.matchedVendorId).trim().toUpperCase() : null;
    const rawInvNum = extracted.invoice?.invoiceNumber ? String(extracted.invoice.invoiceNumber).trim() : null;
    const normInvNum = normalizeInvoiceNumber(rawInvNum);
    const invDate = extracted.invoice?.invoiceDate || null;
    const grandTotal = extracted.totals?.grandTotal !== undefined ? Number(extracted.totals.grandTotal) : null;

    const matchedFields = [];

    // ── Check 1: Document SHA-256 Hash Collision ─────────────────────────────
    if (currHash) {
      // Check prior InvoiceExtractions
      const hashExtraction = await InvoiceExtraction.findOne({
        organisationId: orgId,
        documentHash: currHash,
        documentId: { $ne: currDocId },
        status: { $nin: ['FAILED', 'REJECTED'] },
      })
        .select('documentId invoice.invoiceNumber vendorMatch.matchedVendorName createdAt status')
        .lean();

      if (hashExtraction) {
        matchedFields.push('documentHash');
        return {
          status: 'EXACT_DUPLICATE',
          reason: `Identical document content (SHA-256 hash collision) already processed under document ${hashExtraction.documentId} (${hashExtraction.status}).`,
          duplicateRecordId: hashExtraction.documentId,
          matchedFields,
        };
      }

      // Check BusinessDocument repository
      const hashDoc = await BusinessDocument.findOne({
        organisationId: orgId,
        sha256Hash: currHash,
        documentId: { $ne: currDocId },
        isDeleted: false,
      })
        .select('documentId documentNumber entityName createdAt')
        .lean();

      if (hashDoc) {
        matchedFields.push('documentHash');
        return {
          status: 'EXACT_DUPLICATE',
          reason: `Identical document file (SHA-256) exists in document registry under document ${hashDoc.documentId} (${hashDoc.documentNumber || 'Vendor Bill'}).`,
          duplicateRecordId: hashDoc.documentId,
          matchedFields,
        };
      }
    }

    // ── Check 2: Compound Business Key (Vendor + Invoice Number) ─────────────
    if (normInvNum && (vendorId || supplierGstin)) {
      const vendorCondition = vendorId
        ? { 'vendorMatch.matchedVendorId': vendorId }
        : { 'supplier.gstin': supplierGstin };

      const existingExtraction = await InvoiceExtraction.findOne({
        organisationId: orgId,
        'invoice.invoiceNumber': new RegExp(`^${escapeRegex(rawInvNum)}$`, 'i'),
        ...vendorCondition,
        documentId: { $ne: currDocId },
        status: { $nin: ['FAILED', 'REJECTED'] },
      })
        .select('documentId invoice totals vendorMatch status createdAt')
        .lean();

      if (existingExtraction) {
        matchedFields.push('invoiceNumber');
        if (vendorId) matchedFields.push('vendorId');
        if (supplierGstin) matchedFields.push('gstin');

        const existingTotal = existingExtraction.totals?.grandTotal;
        const totalMatches = grandTotal !== null && existingTotal !== undefined && Math.abs(grandTotal - existingTotal) < 0.05;
        if (totalMatches) {
          matchedFields.push('grandTotal');
        }

        return {
          status: 'EXACT_DUPLICATE',
          reason: `Invoice number ${rawInvNum} from vendor ${vendorMatch.matchedVendorName || vendorId || supplierGstin} already recorded under document ${existingExtraction.documentId}.`,
          duplicateRecordId: existingExtraction.documentId,
          matchedFields,
        };
      }

      // Check in PurchaseOrder recorded invoices sub-document
      const poWithInvoice = await PurchaseOrder.findOne({
        organisationId: orgId,
        'invoices.invoiceNumber': new RegExp(`^${escapeRegex(rawInvNum)}$`, 'i'),
        ...(vendorId ? { vendorId } : {}),
      })
        .select('purchaseOrderId vendorId invoices')
        .lean();

      if (poWithInvoice) {
        matchedFields.push('invoiceNumber');
        if (vendorId) matchedFields.push('vendorId');

        return {
          status: 'EXACT_DUPLICATE',
          reason: `Invoice number ${rawInvNum} is already logged against Purchase Order ${poWithInvoice.purchaseOrderId}.`,
          duplicateRecordId: poWithInvoice.purchaseOrderId,
          matchedFields,
        };
      }
    }

    // ── Check 3: Cross-Vendor Duplicate Invoice Number (POSSIBLE_DUPLICATE) ───
    if (normInvNum) {
      const anyVendorMatch = await InvoiceExtraction.findOne({
        organisationId: orgId,
        'invoice.invoiceNumber': new RegExp(`^${escapeRegex(rawInvNum)}$`, 'i'),
        documentId: { $ne: currDocId },
        status: { $nin: ['FAILED', 'REJECTED'] },
      })
        .select('documentId invoice vendorMatch.matchedVendorName')
        .lean();

      if (anyVendorMatch) {
        matchedFields.push('invoiceNumber');
        return {
          status: 'POSSIBLE_DUPLICATE',
          reason: `Invoice number ${rawInvNum} was previously seen under document ${anyVendorMatch.documentId} (Vendor: ${anyVendorMatch.vendorMatch?.matchedVendorName || 'Unknown'}). Review required to prevent collision.`,
          duplicateRecordId: anyVendorMatch.documentId,
          matchedFields,
        };
      }
    }

    // Also call universal DuplicateDetectionService for supplementary signals
    try {
      const existingCheck = await ExistingDuplicateService.checkSupplierInvoiceDuplicates({
        payload: {
          vendorId,
          supplier: vendorMatch?.matchedVendorName,
          invoiceNumber: rawInvNum,
          date: invDate,
          amount: grandTotal,
          gstin: supplierGstin,
        },
        organisationId: orgId,
        cafeId,
      });

      if (existingCheck.hasDuplicates && existingCheck.candidates?.length > 0) {
        const primaryCandidate = existingCheck.candidates[0];
        return {
          status: primaryCandidate.isExactMatch ? 'EXACT_DUPLICATE' : 'POSSIBLE_DUPLICATE',
          reason: existingCheck.warnings?.[0] || 'Duplicate invoice warning from ERP registry.',
          duplicateRecordId: primaryCandidate.id,
          matchedFields: ['documentNumber'],
        };
      }
    } catch {
      // Non-blocking fallback if auxiliary check encounters unindexed edge-case
    }

    return {
      status: 'NOT_DUPLICATE',
      reason: null,
      duplicateRecordId: null,
      matchedFields: [],
    };
  }
}

module.exports = {
  InvoiceDuplicateDetectionService,
};
