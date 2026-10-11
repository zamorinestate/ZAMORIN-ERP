'use strict';

/**
 * ============================================================================
 * ZAMORIN CAFÉ ERP — CAPEX REQUEST MODEL (STAGE 03)
 * ============================================================================
 * Governed capital expenditure request workflow from business case and quotations
 * through dual approval, procurement PO linkage, asset creation, and post-review.
 */

const mongoose = require('mongoose');

const CAPEX_STATUSES = [
  'REQUESTED',
  'BUSINESS_CASE_SUBMITTED',
  'QUOTATIONS_RECEIVED',
  'UNDER_REVIEW',
  'APPROVED',
  'REJECTED',
  'PO_ISSUED',
  'CAPITALIZED_ASSET',
  'POST_REVIEW_COMPLETED',
];

const CAPEX_CATEGORIES = [
  'KITCHEN_EQUIPMENT',
  'HVAC_REFRIGERATION',
  'IT_POS_HARDWARE',
  'FURNITURE_FITOUT',
  'FACILITY_IMPROVEMENT',
  'VEHICLE',
  'OTHER',
];

const quotationSchema = new mongoose.Schema(
  {
    quotationId: { type: String, required: true, trim: true },
    vendorId: { type: String, required: true, trim: true },
    vendorName: { type: String, required: true, trim: true },
    quoteAmountPaisa: { type: Number, required: true, min: 0 },
    taxAmountPaisa: { type: Number, default: 0 },
    warrantyMonths: { type: Number, default: 12 },
    leadTimeDays: { type: Number, default: 14 },
    attachmentId: { type: String, trim: true, default: null },
    isRecommended: { type: Boolean, default: false },
    notes: { type: String, trim: true, default: '' },
  },
  { _id: false }
);

const capexRequestSchema = new mongoose.Schema(
  {
    requestId: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
      index: true,
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
      required: true,
      index: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    category: {
      type: String,
      enum: CAPEX_CATEGORIES,
      required: true,
    },
    purpose: {
      type: String,
      required: true,
      trim: true,
    },
    estimatedCostPaisa: {
      type: Number,
      required: true,
      min: 0,
    },
    businessCase: {
      purpose: { type: String, default: '' },
      expectedBenefits: { type: String, required: true },
      operationalRisks: { type: String, default: '' },
      alternativesConsidered: { type: String, default: '' },
      assumptions: { type: String, default: '' },
      financialImpact: { type: String, default: '' },
      supportingEvidenceAttachmentId: { type: String, default: null },
    },
    quotations: {
      type: [quotationSchema],
      default: [],
    },
    selectedQuotationId: {
      type: String,
      trim: true,
      default: null,
    },
    reviewDetails: {
      reviewedByUserId: { type: String, default: null },
      reviewedAt: { type: Date, default: null },
      reviewNotes: { type: String, default: '' },
      technicalFeasibility: { type: String, enum: ['FEASIBLE', 'MODIFICATION_REQUIRED', 'INCOMPATIBLE', null], default: null },
      budgetAvailabilityVerified: { type: Boolean, default: false },
    },
    status: {
      type: String,
      enum: CAPEX_STATUSES,
      default: 'REQUESTED',
      index: true,
    },
    approvedByUserId: {
      type: String,
      trim: true,
      default: null,
    },
    approvedAt: {
      type: Date,
      default: null,
    },
    approvalNotes: {
      type: String,
      trim: true,
      default: '',
    },
    requestedByUserId: {
      type: String,
      trim: true,
      default: null,
    },
    linkedPurchaseOrderId: {
      type: String,
      trim: true,
      default: null,
    },
    linkedAssetId: {
      type: String,
      trim: true,
      default: null,
    },
    postImplementationReview: {
      reviewDate: { type: Date, default: null },
      actualCostPaisa: { type: Number, default: null },
      variancePaisa: { type: Number, default: null },
      benefitsRealized: { type: String, default: '' },
      lessonsLearned: { type: String, default: '' },
      reviewedByUserId: { type: String, default: null },
    },
    auditHistory: [
      {
        action: { type: String, required: true },
        performedBy: { type: String, required: true },
        performedAt: { type: Date, default: Date.now },
        notes: { type: String, default: '' },
      },
    ],
  },
  {
    timestamps: true,
    toObject: { virtuals: true },
    toJSON: { virtuals: true },
  }
);

capexRequestSchema.index(
  { organisationId: 1, requestId: 1 },
  { unique: true }
);

const CapexRequest =
  mongoose.models.CapexRequest ||
  mongoose.model('CapexRequest', capexRequestSchema);

module.exports = {
  CapexRequest,
  CAPEX_STATUSES,
  CAPEX_CATEGORIES,
};
