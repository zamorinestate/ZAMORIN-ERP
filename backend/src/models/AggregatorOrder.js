'use strict';

/**
 * AGGREGATOR ORDER — MONGOOSE MODEL (P15 CHANNELS & AGGREGATOR RECONCILIATION)
 *
 * Implements authoritative intake and reconciliation for third-party aggregator orders (Zomato, Swiggy):
 *   - Database-level uniqueness on organisationId + provider + externalOrderId.
 *   - Normalised order intake contract (items, pricing snapshots, commissions, platform fees, taxes).
 *   - Replay protection & idempotency for webhook callbacks.
 *   - Payout matching against canonical MarketplaceSettlement (P12).
 */

const mongoose = require('mongoose');

const AGGREGATOR_PROVIDERS = ['ZOMATO', 'SWIGGY'];

const AGGREGATOR_ORDER_STATUSES = [
  'RECEIVED',
  'ACCEPTED',
  'PREPARING',
  'FOOD_READY',
  'DISPATCHED',
  'COMPLETED',
  'REJECTED',
  'CANCELLED',
  'DISPUTED',
];

const RECONCILIATION_STATUSES = [
  'PENDING',
  'MATCHED',
  'DISCREPANCY',
  'RECONCILED',
  'MANUALLY_REVIEWED',
];

const aggregatorItemSchema = new mongoose.Schema(
  {
    externalItemId: { type: String, trim: true },
    menuItemId: { type: String, trim: true, uppercase: true },
    itemName: { type: String, required: true, trim: true },
    quantity: { type: Number, required: true, min: 1 },
    unitPricePaisa: { type: Number, required: true, min: 0 },
    lineTotalPaisa: { type: Number, required: true, min: 0 },
    modifiers: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
    instructions: { type: String, default: '' },
  },
  { _id: false }
);

const aggregatorOrderSchema = new mongoose.Schema(
  {
    aggregatorOrderId: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      uppercase: true,
      index: true,
    },
    organisationId: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
      index: true,
    },
    cafeId: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
      index: true,
    },
    provider: {
      type: String,
      enum: AGGREGATOR_PROVIDERS,
      required: true,
      index: true,
    },
    externalOrderId: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    displayOrderId: {
      type: String,
      trim: true,
      default: '',
    },
    channel: {
      type: String,
      default: 'AGGREGATOR',
      index: true,
    },
    customerName: {
      type: String,
      trim: true,
      default: 'Guest',
    },
    customerPhoneMasked: {
      type: String,
      trim: true,
      default: '',
    },
    deliveryAddressSummary: {
      type: String,
      trim: true,
      default: '',
    },
    items: {
      type: [aggregatorItemSchema],
      required: true,
    },
    pricing: {
      grossAmountPaisa: { type: Number, required: true, min: 0 },
      discountPaisa: { type: Number, default: 0, min: 0 },
      deliveryFeePaisa: { type: Number, default: 0, min: 0 },
      packagingFeePaisa: { type: Number, default: 0, min: 0 },
      taxPaisa: { type: Number, default: 0, min: 0 },
      netPayablePaisa: { type: Number, required: true, min: 0 },
    },
    payoutExpected: {
      commissionPaisa: { type: Number, default: 0, min: 0 },
      platformFeesPaisa: { type: Number, default: 0, min: 0 },
      taxWithheldPaisa: { type: Number, default: 0, min: 0 },
      netPayoutPaisa: { type: Number, default: 0, min: 0 },
    },
    status: {
      type: String,
      enum: AGGREGATOR_ORDER_STATUSES,
      default: 'RECEIVED',
      index: true,
    },
    reconciliationStatus: {
      type: String,
      enum: RECONCILIATION_STATUSES,
      default: 'PENDING',
      index: true,
    },
    settlementId: {
      type: String,
      trim: true,
      default: null,
      index: true,
    },
    rejectionReason: {
      type: String,
      default: null,
    },
    cancellationReason: {
      type: String,
      default: null,
    },
    canonicalBillId: {
      type: String,
      trim: true,
      default: null,
    },
    rawPayloadHash: {
      type: String,
      trim: true,
      default: null,
    },
    idempotencyKey: {
      type: String,
      trim: true,
      default: null,
    },
    receivedAt: {
      type: Date,
      default: Date.now,
    },
    acceptedAt: {
      type: Date,
      default: null,
    },
    completedAt: {
      type: Date,
      default: null,
    },
    lastUpdatedByUserId: {
      type: String,
      default: 'WEBHOOK',
    },
  },
  {
    timestamps: true,
    collection: 'aggregator_orders',
  }
);

// Strict database-level uniqueness to prevent duplicate ingestion under concurrent race conditions
aggregatorOrderSchema.index(
  { organisationId: 1, provider: 1, externalOrderId: 1 },
  { unique: true, name: 'org_provider_external_unique' }
);
aggregatorOrderSchema.index({ organisationId: 1, cafeId: 1, status: 1 });
aggregatorOrderSchema.index({ organisationId: 1, settlementId: 1 });

const AggregatorOrder =
  mongoose.models.AggregatorOrder ||
  mongoose.model('AggregatorOrder', aggregatorOrderSchema);

module.exports = {
  AggregatorOrder,
  AGGREGATOR_PROVIDERS,
  AGGREGATOR_ORDER_STATUSES,
  RECONCILIATION_STATUSES,
};
