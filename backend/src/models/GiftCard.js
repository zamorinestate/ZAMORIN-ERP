'use strict';

/**
 * GIFT CARD — MONGOOSE MODEL (P14 CUSTOMER WALLETS & GIFT CARDS)
 *
 * Implements paid & issued gift cards:
 *   - Balances stored strictly in integer paise.
 *   - Complete secrets are never stored in plaintext (cardCodeHash stores SHA-256).
 *   - Public cardNumber is masked (e.g. GC-****-5678) in listings, logs, and exports.
 *   - Org-scoped with cafe attribution.
 */

const mongoose = require('mongoose');

const GIFT_CARD_STATUSES = [
  'ACTIVE',
  'REDEEMED',
  'EXPIRED',
  'CANCELLED',
  'SUSPENDED',
];

const giftCardSchema = new mongoose.Schema(
  {
    giftCardId: {
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
      default: 'ZC-0001',
      index: true,
    },

    cardNumber: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
      index: true,
    },

    cardCodeHash: {
      type: String,
      required: true,
      trim: true,
    },

    initialBalancePaise: {
      type: Number,
      required: true,
      validate: {
        validator: (v) => Number.isInteger(v) && v > 0,
        message: 'initialBalancePaise must be a positive integer in paise.',
      },
    },

    currentBalancePaise: {
      type: Number,
      required: true,
      validate: {
        validator: (v) => Number.isInteger(v) && v >= 0,
        message: 'currentBalancePaise must be a non-negative integer in paise.',
      },
    },

    status: {
      type: String,
      enum: GIFT_CARD_STATUSES,
      default: 'ACTIVE',
      index: true,
    },

    expiresAt: {
      type: Date,
      required: true,
      index: true,
    },

    purchasedByCustomerId: {
      type: String,
      trim: true,
      uppercase: true,
      default: null,
    },

    issuedByUserId: {
      type: String,
      required: true,
      immutable: true,
      trim: true,
      uppercase: true,
    },

    redemptionHistory: [
      {
        redemptionId: { type: String, required: true },
        billId: { type: String, default: null },
        amountPaise: { type: Number, required: true },
        balanceAfterPaise: { type: Number, required: true },
        redeemedAt: { type: Date, default: Date.now },
        cafeId: { type: String, default: 'ZC-0001' },
        performedByUserId: { type: String, required: true },
      },
    ],
  },
  {
    timestamps: true,
    versionKey: 'version',
    collection: 'gift_cards',
    strict: false,
  }
);

giftCardSchema.index(
  { organisationId: 1, cardNumber: 1 },
  { unique: true, name: 'org_gift_card_number_idx' }
);

const GiftCard =
  mongoose.models.GiftCard ||
  mongoose.model('GiftCard', giftCardSchema);

module.exports = {
  GiftCard,
  GIFT_CARD_STATUSES,
};
