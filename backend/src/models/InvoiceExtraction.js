'use strict';

/**
 * ZAMORIN AI INVOICE INTELLIGENCE — INVOICE EXTRACTION MODEL (PHASE 24)
 *
 * Authoritative record of AI document extraction, validation, vendor matching,
 * three-way matching, composite confidence, and human review decisions.
 */

const mongoose = require('mongoose');
const crypto = require('crypto');

const EXTRACTION_STATUSES = [
  'UPLOADED',
  'QUEUED',
  'PROCESSING',
  'EXTRACTED',
  'VALIDATING',
  'VALIDATED',
  'MATCHED',
  'REVIEW_REQUIRED',
  'READY_FOR_APPROVAL',
  'FAILED',
  'REJECTED',
];

const EXCEPTION_SEVERITIES = ['BLOCKING', 'WARNING'];

const fieldProvenanceSubSchema = new mongoose.Schema(
  {
    value: { type: mongoose.Schema.Types.Mixed, default: null },
    confidence: { type: Number, default: 0, min: 0, max: 1 },
    page: { type: Number, default: 1, min: 1 },
    sourceText: { type: String, trim: true, default: '' },
    boundingRegion: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  { _id: false }
);

const extractionLineItemSchema = new mongoose.Schema(
  {
    lineNumber: { type: Number, required: true },
    description: { type: String, required: true, trim: true },
    sku: { type: String, trim: true, uppercase: true, default: null },
    supplierSku: { type: String, trim: true, default: null },
    hsnSac: { type: String, trim: true, default: null },
    quantity: { type: Number, required: true, default: 0 },
    unit: { type: String, trim: true, uppercase: true, default: 'UNIT' },
    unitPrice: { type: Number, required: true, default: 0 },
    discountAmount: { type: Number, default: 0 },
    taxableValue: { type: Number, required: true, default: 0 },
    gstRate: { type: Number, default: 0 },
    cgstRate: { type: Number, default: 0 },
    cgstAmount: { type: Number, default: 0 },
    sgstRate: { type: Number, default: 0 },
    sgstAmount: { type: Number, default: 0 },
    igstRate: { type: Number, default: 0 },
    igstAmount: { type: Number, default: 0 },
    cessAmount: { type: Number, default: 0 },
    lineTotal: { type: Number, required: true, default: 0 },
  },
  { _id: false }
);

const extractionExceptionSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, trim: true, uppercase: true },
    message: { type: String, required: true, trim: true },
    severity: { type: String, enum: EXCEPTION_SEVERITIES, default: 'BLOCKING' },
    field: { type: String, trim: true, default: null },
    isResolved: { type: Boolean, default: false },
    resolvedByUserId: { type: String, trim: true, uppercase: true, default: null },
    resolvedAt: { type: Date, default: null },
    resolutionNotes: { type: String, trim: true, default: '' },
  },
  { _id: true }
);

const humanCorrectionSchema = new mongoose.Schema(
  {
    fieldPath: { type: String, required: true, trim: true },
    originalValue: { type: mongoose.Schema.Types.Mixed, default: null },
    correctedValue: { type: mongoose.Schema.Types.Mixed, default: null },
    correctedByUserId: { type: String, required: true, trim: true, uppercase: true },
    correctedByRole: { type: String, trim: true, uppercase: true, default: 'STAFF' },
    correctedAt: { type: Date, default: Date.now },
    reason: { type: String, trim: true, default: '' },
  },
  { _id: true }
);

const extractionAttemptSchema = new mongoose.Schema(
  {
    attemptNumber: { type: Number, required: true },
    startedAt: { type: Date, default: Date.now },
    completedAt: { type: Date, default: null },
    status: { type: String, default: 'PROCESSING' },
    errorMessage: { type: String, default: null },
    provider: { type: String, default: null },
    modelVersion: { type: String, default: null },
    processorId: { type: String, default: null },
    processorVersion: { type: String, default: null },
    schemaVersion: { type: String, default: '2026.1' },
  },
  { _id: false }
);

const invoiceExtractionSchema = new mongoose.Schema(
  {
    extractionId: {
      type: String,
      required: true,
      unique: true,
      immutable: true,
      trim: true,
      uppercase: true,
      index: true,
      default: () => `EXT-${Date.now()}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`,
    },

    organisationId: {
      type: String,
      required: true,
      immutable: true,
      trim: true,
      uppercase: true,
      index: true,
    },

    cafeId: {
      type: String,
      trim: true,
      uppercase: true,
      default: 'ALL',
      index: true,
    },

    documentId: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
      index: true,
    },

    documentHash: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },

    storageReference: {
      type: String,
      trim: true,
      default: null,
    },

    purchaseOrderId: {
      type: String,
      trim: true,
      uppercase: true,
      default: null,
      index: true,
    },

    grnId: {
      type: String,
      trim: true,
      uppercase: true,
      default: null,
      index: true,
    },

    vendorId: {
      type: String,
      trim: true,
      uppercase: true,
      default: null,
      index: true,
    },

    status: {
      type: String,
      enum: EXTRACTION_STATUSES,
      default: 'UPLOADED',
      index: true,
    },

    schemaVersion: {
      type: String,
      trim: true,
      default: '2026.1',
    },

    documentType: {
      type: String,
      default: 'TAX_INVOICE',
    },

    attemptCount: {
      type: Number,
      default: 1,
      min: 1,
    },

    attempts: [extractionAttemptSchema],

    processingStartedAt: {
      type: Date,
      default: null,
    },

    processingCompletedAt: {
      type: Date,
      default: null,
    },

    canaryAllocation: {
      cohort: {
        type: String,
        enum: ['AI_CANARY', 'MANUAL_CONTROL', 'AI_FULL'],
        default: 'AI_FULL',
      },
      bucket: {
        type: Number,
        default: 0,
      },
      canaryPercentage: {
        type: Number,
        default: 100,
      },
    },

    // ── Canonical Extracted Data (Top-Level) ──────────────────────────────────
    supplier: {
      name: { type: String, trim: true, default: null },
      gstin: { type: String, trim: true, uppercase: true, default: null },
      pan: { type: String, trim: true, uppercase: true, default: null },
      address: { type: String, trim: true, default: null },
      state: { type: String, trim: true, default: null },
      stateCode: { type: String, trim: true, default: null },
      phone: { type: String, trim: true, default: null },
      email: { type: String, trim: true, default: null },
    },

    invoice: {
      invoiceNumber: { type: String, trim: true, default: null },
      invoiceDate: { type: String, trim: true, default: null },
      dueDate: { type: String, trim: true, default: null },
      purchaseOrderNumber: { type: String, trim: true, uppercase: true, default: null },
      deliveryReference: { type: String, trim: true, uppercase: true, default: null },
      currency: { type: String, trim: true, default: 'INR' },
      placeOfSupply: { type: String, trim: true, default: null },
      reverseCharge: { type: Boolean, default: false },
      irn: { type: String, trim: true, default: null },
      eInvoiceNumber: { type: String, trim: true, default: null },
      eWayBillNumber: { type: String, trim: true, default: null },
    },

    lineItems: [extractionLineItemSchema],

    totals: {
      subtotal: { type: Number, default: 0 },
      discount: { type: Number, default: 0 },
      taxableValue: { type: Number, default: 0 },
      cgst: { type: Number, default: 0 },
      sgst: { type: Number, default: 0 },
      igst: { type: Number, default: 0 },
      cess: { type: Number, default: 0 },
      freight: { type: Number, default: 0 },
      otherCharges: { type: Number, default: 0 },
      roundOff: { type: Number, default: 0 },
      grandTotal: { type: Number, default: 0 },
    },

    bankDetails: {
      accountName: { type: String, trim: true, default: null },
      maskedAccountNumber: { type: String, trim: true, default: null },
      ifsc: { type: String, trim: true, uppercase: true, default: null },
    },

    provenance: {
      type: mongoose.Schema.Types.Mixed,
      default: () => ({}),
    },

    providerMetadata: {
      provider: { type: String, trim: true, default: 'MOCK_INVOICE_INTELLIGENCE' },
      modelVersion: { type: String, trim: true, default: '' },
      providerRequestId: { type: String, trim: true, default: null },
      pageCount: { type: Number, default: 1 },
      processingDurationMs: { type: Number, default: 0 },
    },

    // ── Intelligence Verification Results ─────────────────────────────────────
    vendorMatch: {
      status: { type: String, enum: ['MATCHED', 'AMBIGUOUS', 'NOT_FOUND', 'SKIPPED'], default: 'SKIPPED' },
      matchedVendorId: { type: String, trim: true, uppercase: true, default: null },
      matchedVendorName: { type: String, trim: true, default: null },
      matchStrategy: { type: String, default: 'NONE' },
      matchConfidence: { type: Number, default: 0 },
      candidateVendors: [{ type: mongoose.Schema.Types.Mixed }],
    },

    duplicateCheck: {
      status: { type: String, enum: ['NOT_DUPLICATE', 'POSSIBLE_DUPLICATE', 'EXACT_DUPLICATE'], default: 'NOT_DUPLICATE' },
      reason: { type: String, default: null },
      duplicateRecordId: { type: String, default: null },
      matchedFields: [{ type: String }],
    },

    mathematicalValidation: {
      type: mongoose.Schema.Types.Mixed,
      default: () => ({ isValid: false, discrepancies: [] }),
    },

    threeWayMatch: {
      status: {
        type: String,
        enum: ['MATCHED', 'MATCHED_WITH_TOLERANCE', 'EXCEPTION', 'BLOCKED', 'NOT_EVALUATED'],
        default: 'NOT_EVALUATED',
      },
      purchaseOrderId: { type: String, default: null },
      grnId: { type: String, default: null },
      lineMatches: [{ type: mongoose.Schema.Types.Mixed }],
      overallDiscrepancies: [{ type: mongoose.Schema.Types.Mixed }],
      toleranceApplied: { type: Boolean, default: false },
      toleranceDetails: { type: mongoose.Schema.Types.Mixed, default: null },
    },

    compositeConfidence: {
      overallScore: { type: Number, default: 0, min: 0, max: 1 },
      level: { type: String, enum: ['HIGH', 'MEDIUM', 'LOW'], default: 'LOW' },
      breakdown: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
    },

    exceptions: [extractionExceptionSchema],

    corrections: [humanCorrectionSchema],

    reviewDecision: {
      decision: { type: String, enum: ['PENDING', 'APPROVED', 'REJECTED'], default: 'PENDING' },
      decidedByUserId: { type: String, trim: true, uppercase: true, default: null },
      decidedByRole: { type: String, trim: true, uppercase: true, default: null },
      decidedAt: { type: Date, default: null },
      decisionNotes: { type: String, trim: true, default: '' },
    },

    lastErrorCode: { type: String, trim: true, default: null },

    providerMetadata: {
      provider: { type: String, default: null },
      modelVersion: { type: String, default: null },
      processorId: { type: String, default: null },
      processorVersion: { type: String, default: null },
      providerRequestId: { type: String, default: null },
      pageCount: { type: Number, default: 1 },
      processingDurationMs: { type: Number, default: 0 },
    },

    uploadedBy: {
      type: String,
      trim: true,
      default: 'SYSTEM',
    },

    uploadedAt: {
      type: Date,
      default: Date.now,
    },

    createdByUserId: {
      type: String,
      trim: true,
      default: 'SYSTEM',
    },
  },
  {
    timestamps: true,
    collection: 'invoiceextractions',
  }
);

// Indexes
invoiceExtractionSchema.index({ organisationId: 1, documentHash: 1 });
invoiceExtractionSchema.index({ organisationId: 1, cafeId: 1, status: 1 });
invoiceExtractionSchema.index({ organisationId: 1, purchaseOrderId: 1 });
invoiceExtractionSchema.index({ organisationId: 1, documentId: 1 }, { unique: true, name: 'org_documentId_unique' });
invoiceExtractionSchema.index({ organisationId: 1, 'invoice.invoiceNumber': 1, 'supplier.gstin': 1 });

const InvoiceExtraction = mongoose.models.InvoiceExtraction || mongoose.model('InvoiceExtraction', invoiceExtractionSchema);

module.exports = {
  InvoiceExtraction,
  EXTRACTION_STATUSES,
  EXCEPTION_SEVERITIES,
};
