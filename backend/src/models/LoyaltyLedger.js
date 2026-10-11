'use strict';

/**
 * LOYALTY LEDGER — MONGOOSE MODEL (SCREEN 006)
 *
 * Immutable ledger of points earned, redeemed, reserved, adjusted, or expired.
 */

const mongoose = require('mongoose');

const LOYALTY_TX_TYPES = [
  'MEMBER_ENROLLED',
  'PURCHASE_ACCRUAL',
  'MANUAL_ADJUSTMENT',
  'REWARD_RESERVED',
  'REWARD_RELEASED',
  'REWARD_REDEEMED',
  'REFUND_REVERSAL',
  'VOID_REVERSAL',
  'POINTS_EXPIRED',
  'TIER_CHANGED',
  'PROMOTION_BONUS',
  'ACCOUNT_MERGED',
  'MIGRATION_ADJUSTMENT',
];

const loyaltyLedgerSchema = new mongoose.Schema(
  {
    loyaltyLedgerId: {
      type: String,
      required: true,
      unique: true,
      immutable: true,
      trim: true,
      uppercase: true,
      match: /^LOY(-\d{8})?-\d{4,}$/,
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

    customerId: {
      type: String,
      required: true,
      immutable: true,
      trim: true,
      uppercase: true,
      index: true,
    },

    transactionType: {
      type: String,
      required: true,
      enum: LOYALTY_TX_TYPES,
      index: true,
    },

    pointsDelta: {
      type: Number,
      required: true,
      validate: {
        validator: (v) => Number.isInteger(v) && v !== 0,
        message: 'pointsDelta must be a non-zero integer.',
      },
    },

    balanceBefore: {
      type: Number,
      required: true,
    },

    balanceAfter: {
      type: Number,
      required: true,
    },

    referenceBillId: {
      type: String,
      trim: true,
      uppercase: true,
      default: null,
    },

    referenceRewardId: {
      type: String,
      trim: true,
      default: null,
    },

    referenceRefundId: {
      type: String,
      trim: true,
      default: null,
    },

    reasonCode: {
      type: String,
      trim: true,
      default: '',
    },

    description: {
      type: String,
      trim: true,
      maxlength: 1000,
      default: '',
    },

    idempotencyKey: {
      type: String,
      trim: true,
      default: null,
      index: true,
    },

    performedByUserId: {
      type: String,
      required: true,
      immutable: true,
      trim: true,
      uppercase: true,
    },

    serverTimestamp: {
      type: Date,
      default: Date.now,
      immutable: true,
    },
  },
  {
    timestamps: true,
    versionKey: 'version',
    collection: 'loyalty_ledger',
    strict: false,
  }
);

loyaltyLedgerSchema.index(
  { organisationId: 1, customerId: 1, createdAt: -1 },
  { name: 'org_customer_ledger_idx' }
);

const LoyaltyLedger =
  mongoose.models.LoyaltyLedger ||
  mongoose.model('LoyaltyLedger', loyaltyLedgerSchema);

module.exports = {
  LoyaltyLedger,
  LOYALTY_TX_TYPES,
};
