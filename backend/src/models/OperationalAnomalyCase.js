'use strict';

/**
 * ============================================================================
 * ZAMORIN CAFÉ ERP — OPERATIONAL ANOMALY & REVIEW CASE MODEL (STAGE 02)
 * ============================================================================
 * Enforces the ABSOLUTE FRAUD-SAFETY INVARIANT:
 * The system MUST NOT automatically accuse any person of fraud, nor execute
 * automated terminations, salary deductions, disciplinary actions, or vendor bans.
 * Non-accusatory terminology is enforced across all records and review statuses.
 */

const mongoose = require('mongoose');

const ANOMALY_RULE_TYPES = [
  'EXCESSIVE_REFUNDS',
  'REPEATED_VOIDS',
  'UNUSUAL_DISCOUNTS',
  'POTENTIAL_DUPLICATE_EXPENSE',
  'POTENTIAL_DUPLICATE_SUPPLIER_INVOICE',
  'POTENTIAL_DUPLICATE_PAYMENT',
  'UNEXPLAINED_CASH_DRAWER_VARIANCE',
  'VENDOR_BANK_MODIFICATION_REVIEW',
  'PAYROLL_VARIANCE_REVIEW',
  'ATTENDANCE_PATTERN_EXCEPTION',
  'HIGH_VOLUME_DATA_EXPORT',
  'ELEVATED_PRIVILEGE_EVENT',
  'EXCESSIVE_REPRINTS',
  'ZERO_SALE_DRAWER_KICK',
];

const ANOMALY_REVIEW_STATUSES = [
  'DETECTED',
  'UNDER_REVIEW',
  'REQUIRES_EVIDENCE',
  'REVIEW_CONCLUDED',
];

const REVIEW_DISPOSITIONS = [
  'EXPLAINED_LEGITIMATE_OPERATION',
  'EXPECTED_BUSINESS_EXCEPTION',
  'FALSE_POSITIVE_DUPLICATE',
  'DATA_QUALITY_ANOMALY',
  'CONFIRMED_CONTROL_DEFICIENCY',
  'POLICY_NON_COMPLIANCE',
  'PENDING_MANAGEMENT_ACTION',
];

const operationalAnomalyCaseSchema = new mongoose.Schema(
  {
    caseId: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
      index: true,
    },
    ruleType: {
      type: String,
      enum: ANOMALY_RULE_TYPES,
      required: true,
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
      default: null,
      index: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      required: true,
      trim: true,
    },
    patternSummary: {
      type: String,
      required: true,
      trim: true,
    },
    detectedValuePaisa: {
      type: Number,
      default: 0,
    },
    relatedTransactionIds: {
      type: [String],
      default: [],
    },
    evidenceAttachmentIds: {
      type: [String],
      default: [],
    },
    severity: {
      type: String,
      enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'],
      default: 'MEDIUM',
    },
    status: {
      type: String,
      enum: ANOMALY_REVIEW_STATUSES,
      default: 'DETECTED',
      index: true,
    },
    disposition: {
      type: String,
      enum: REVIEW_DISPOSITIONS,
      default: null,
    },
    reviewOwnerUserId: {
      type: String,
      trim: true,
      default: null,
    },
    reviewNotes: {
      type: String,
      trim: true,
      default: '',
    },
    reviewedAt: {
      type: Date,
      default: null,
    },
    linkedRiskId: {
      type: String,
      trim: true,
      default: null,
    },
    linkedControlId: {
      type: String,
      trim: true,
      default: null,
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

operationalAnomalyCaseSchema.virtual('reviewStatus').get(function () {
  if (this.disposition === 'FALSE_POSITIVE_DUPLICATE') return 'DUPLICATE_FALSE_POSITIVE';
  if (this.disposition === 'EXPLAINED_LEGITIMATE_OPERATION') return 'EXPLAINED_BENIGN';
  if (this.disposition === 'DATA_QUALITY_ANOMALY') return 'DATA_QUALITY_ISSUE';
  if (this.disposition === 'CONFIRMED_CONTROL_DEFICIENCY') return 'CONFIRMED_ISSUE';
  return 'INVESTIGATING';
});

operationalAnomalyCaseSchema.virtual('reviewedBy').get(function () {
  return this.reviewOwnerUserId || undefined;
});

operationalAnomalyCaseSchema.index(
  { organisationId: 1, caseId: 1 },
  { unique: true }
);

operationalAnomalyCaseSchema.index(
  { organisationId: 1, cafeId: 1, status: 1 }
);

const OperationalAnomalyCase =
  mongoose.models.OperationalAnomalyCase ||
  mongoose.model('OperationalAnomalyCase', operationalAnomalyCaseSchema);

module.exports = {
  OperationalAnomalyCase,
  ANOMALY_RULE_TYPES,
  ANOMALY_REVIEW_STATUSES,
  REVIEW_DISPOSITIONS,
};
