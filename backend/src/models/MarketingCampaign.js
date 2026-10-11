'use strict';

/**
 * MARKETING CAMPAIGN — MONGOOSE MODEL (P14 CAMPAIGN MANAGEMENT)
 *
 * Implements:
 *   - Marketing campaign drafts, scheduling, audience segmentation, and cancellation.
 *   - Preview calculation (eligible vs opted-out recipient counts).
 *   - Strict separation between marketing communications and transactional notices.
 *   - Provider state tracking (BLOCKED when unconfigured, never false delivery success).
 */

const mongoose = require('mongoose');

const CAMPAIGN_TYPES = [
  'PROMOTIONAL',
  'LOYALTY_OFFER',
  'FESTIVAL_SPECIAL',
  'WINBACK',
  'TRANSACTIONAL_NOTICE',
];

const CAMPAIGN_CHANNELS = [
  'SMS',
  'EMAIL',
  'WHATSAPP',
];

const CAMPAIGN_STATUSES = [
  'DRAFT',
  'SCHEDULED',
  'DISPATCHED',
  'CANCELLED',
  'BLOCKED',
];

const marketingCampaignSchema = new mongoose.Schema(
  {
    campaignId: {
      type: String,
      required: true,
      unique: true,
      immutable: true,
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
      default: null,
      index: true,
    },

    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200,
    },

    type: {
      type: String,
      required: true,
      enum: CAMPAIGN_TYPES,
      default: 'PROMOTIONAL',
    },

    channel: {
      type: String,
      required: true,
      enum: CAMPAIGN_CHANNELS,
      default: 'SMS',
    },

    status: {
      type: String,
      enum: CAMPAIGN_STATUSES,
      default: 'DRAFT',
      index: true,
    },

    targetCriteria: {
      tiers: { type: [String], default: [] },
      groups: { type: [String], default: [] },
      minVisits: { type: Number, default: 0 },
      preferredCafeId: { type: String, default: null },
      includeAllActive: { type: Boolean, default: false },
    },

    messageTemplate: {
      subject: { type: String, trim: true, default: '' },
      body: { type: String, required: true, trim: true },
    },

    scheduledAt: {
      type: Date,
      default: null,
    },

    previewStats: {
      eligibleCount: { type: Number, default: 0 },
      excludedOptOutCount: { type: Number, default: 0 },
      totalAudienceCount: { type: Number, default: 0 },
      calculatedAt: { type: Date, default: null },
    },

    executionResult: {
      dispatchedCount: { type: Number, default: 0 },
      blockedCount: { type: Number, default: 0 },
      failureReason: { type: String, default: null },
      dispatchedAt: { type: Date, default: null },
      providerStatus: { type: String, default: null },
    },

    createdByUserId: {
      type: String,
      required: true,
      immutable: true,
      trim: true,
      uppercase: true,
    },

    approvedByUserId: {
      type: String,
      trim: true,
      uppercase: true,
      default: null,
    },

    cancelledByUserId: {
      type: String,
      trim: true,
      uppercase: true,
      default: null,
    },

    cancellationReason: {
      type: String,
      trim: true,
      default: null,
    },
  },
  {
    timestamps: true,
    versionKey: 'version',
    collection: 'marketing_campaigns',
    strict: false,
  }
);

marketingCampaignSchema.index(
  { organisationId: 1, status: 1, createdAt: -1 },
  { name: 'org_status_campaign_idx' }
);

const MarketingCampaign =
  mongoose.models.MarketingCampaign ||
  mongoose.model('MarketingCampaign', marketingCampaignSchema);

module.exports = {
  MarketingCampaign,
  CAMPAIGN_TYPES,
  CAMPAIGN_CHANNELS,
  CAMPAIGN_STATUSES,
};
