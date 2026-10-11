'use strict';

/**
 * WALLET LEDGER — MONGOOSE MODEL (P14 CUSTOMER WALLET & STORED VALUE)
 *
 * Implements immutable ledger of customer stored-value balances:
 *   - Monetary values stored strictly in integer paise.
 *   - Transaction types: TOPUP, REDEMPTION, REFUND, ADJUSTMENT, GIFT_CARD_REDEEM.
 *   - Idempotency key protection preventing duplicate top-ups or redemptions.
 *   - Reference to confirmed payment / bill.
 */

const mongoose = require('mongoose');

const WALLET_TX_TYPES = [
  'TOPUP',
  'REDEMPTION',
  'REFUND',
  'ADJUSTMENT',
  'GIFT_CARD_REDEEM',
];

const WALLET_PAYMENT_STATUSES = [
  'CONFIRMED',
  'PENDING',
  'FAILED',
  'REVERSED',
];

const walletLedgerSchema = new mongoose.Schema(
  {
    walletLedgerId: {
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
      enum: WALLET_TX_TYPES,
      index: true,
    },

    amountPaise: {
      type: Number,
      required: true,
      validate: {
        validator: (v) => Number.isInteger(v) && v !== 0,
        message: 'amountPaise must be a non-zero integer in paise.',
      },
    },

    balanceBeforePaise: {
      type: Number,
      required: true,
      validate: {
        validator: (v) => Number.isInteger(v) && v >= 0,
        message: 'balanceBeforePaise must be a non-negative integer.',
      },
    },

    balanceAfterPaise: {
      type: Number,
      required: true,
      validate: {
        validator: (v) => Number.isInteger(v) && v >= 0,
        message: 'balanceAfterPaise must be a non-negative integer.',
      },
    },

    sourcePaymentId: {
      type: String,
      trim: true,
      uppercase: true,
      default: null,
    },

    sourcePaymentMethod: {
      type: String,
      trim: true,
      uppercase: true,
      default: 'CASH',
    },

    paymentStatus: {
      type: String,
      enum: WALLET_PAYMENT_STATUSES,
      default: 'CONFIRMED',
    },

    referenceBillId: {
      type: String,
      trim: true,
      uppercase: true,
      default: null,
    },

    idempotencyKey: {
      type: String,
      trim: true,
      default: null,
      index: true,
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
    collection: 'wallet_ledgers',
    strict: false,
  }
);

walletLedgerSchema.index(
  { organisationId: 1, customerId: 1, createdAt: -1 },
  { name: 'org_customer_wallet_idx' }
);

walletLedgerSchema.index(
  { organisationId: 1, idempotencyKey: 1 },
  { unique: true, sparse: true, name: 'org_idempotency_idx' }
);

const WalletLedger =
  mongoose.models.WalletLedger ||
  mongoose.model('WalletLedger', walletLedgerSchema);

module.exports = {
  WalletLedger,
  WALLET_TX_TYPES,
  WALLET_PAYMENT_STATUSES,
};
