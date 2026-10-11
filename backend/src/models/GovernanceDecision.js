'use strict';

const mongoose = require('mongoose');

/**
 * ============================================================================
 * ZAMORIN CAFÉ ERP — STAGE 15: GOVERNANCE DECISION MODEL
 * ============================================================================
 * Tracks major strategic management decisions (distinct from formal Board resolutions),
 * rationales, alternatives, financial impacts, and post-decision review outcomes.
 */

const GovernanceDecisionSchema = new mongoose.Schema(
  {
    decisionId: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    organisationId: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    decisionDate: {
      type: Date,
      default: Date.now,
      index: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    issueDescription: {
      type: String,
      required: true,
    },
    rationale: {
      type: String,
      required: true,
    },
    alternativesConsidered: [
      {
        description: String,
        rejectionReason: String,
      },
    ],
    affectedCafes: [
      {
        type: String,
      },
    ],
    financialImpactEstimateRupees: {
      type: Number,
      default: 0,
    },
    riskAssessmentNotes: {
      type: String,
      default: '',
    },
    responsiblePersonUserId: {
      type: String,
      required: true,
    },
    plannedReviewDate: {
      type: Date,
      required: true,
    },
    actualOutcomeNotes: {
      type: String,
      default: '',
    },
    outcomeReviewedAt: {
      type: Date,
      default: null,
    },
    status: {
      type: String,
      enum: [
        'PROPOSED',
        'SUBMITTED',
        'APPROVED',
        'IMPLEMENTING',
        'ACTION_IN_PROGRESS',
        'REVIEW_DUE',
        'REVIEW_COMPLETED',
        'VERIFIED_COMPLETED',
        'SUPERSEDED',
      ],
      default: 'PROPOSED',
      index: true,
    },
    supportingAttachmentIds: [
      {
        type: String,
      },
    ],
    createdByUserId: {
      type: String,
      default: 'SYSTEM',
    },
    linkedTaskId: {
      type: String,
      default: null,
      index: true,
    },
    linkedCapexId: {
      type: String,
      default: null,
    },
    proposerUserId: {
      type: String,
      default: null,
    },
    approvedByUserId: {
      type: String,
      default: null,
    },
    approvedAt: {
      type: Date,
      default: null,
    },
    verifiedByUserId: {
      type: String,
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
    strict: false,
  }
);

GovernanceDecisionSchema.index({ organisationId: 1, decisionId: 1 }, { unique: true });
GovernanceDecisionSchema.index({ organisationId: 1, status: 1 });

const GovernanceDecision = mongoose.models.GovernanceDecision || mongoose.model(
  'GovernanceDecision',
  GovernanceDecisionSchema
);
GovernanceDecision.GovernanceDecision = GovernanceDecision;
GovernanceDecision.GovernanceDecisionSchema = GovernanceDecisionSchema;

module.exports = GovernanceDecision;
