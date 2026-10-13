'use strict';

/**
 * PREPAID SMART CARD — MONGOOSE MODEL (F085 FOOD COURT SMART CARD ENGINE)
 *
 * Implements food court RFID / NFC / QR tap-card prepaid wallet lifecycle:
 *   - Issue card with cardUid and optional refundable security deposit
 *   - Fast top-up with multiple tenders (Cash, Card, UPI)
 *   - POS tap-debit with atomicity and overdraft prevention
 *   - Card refund and surrender with unspent float settlement
 *   - Store-level unspent liability accounting
 *
 * All financial amounts strictly stored in Integer Paise.
 */

const mongoose = require('mongoose');

const SMART_CARD_STATUSES = ['ACTIVE', 'BLOCKED', 'REFUNDED', 'EXPIRED'];
const SMART_CARD_TXN_TYPES = ['ISSUE', 'TOPUP', 'DEBIT', 'REFUND', 'ADJUSTMENT'];

const smartCardTransactionSchema = new mongoose.Schema(
  {
    transactionId: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
    },
    type: {
      type: String,
      enum: SMART_CARD_TXN_TYPES,
      required: true,
    },
    amountPaisa: {
      type: Number,
      required: true,
      validate: {
        validator: Number.isInteger,
        message: 'amountPaisa must be an integer.',
      },
    },
    balanceBeforePaisa: {
      type: Number,
      required: true,
      min: 0,
      validate: {
        validator: Number.isInteger,
        message: 'balanceBeforePaisa must be an integer.',
      },
    },
    balanceAfterPaisa: {
      type: Number,
      required: true,
      min: 0,
      validate: {
        validator: Number.isInteger,
        message: 'balanceAfterPaisa must be an integer.',
      },
    },
    referenceBillId: {
      type: String,
      trim: true,
      default: null,
    },
    paymentMethod: {
      type: String,
      trim: true,
      default: null,
    },
    notes: {
      type: String,
      trim: true,
      default: '',
    },
    performedByUserId: {
      type: String,
      trim: true,
      default: null,
    },
    timestamp: {
      type: Date,
      default: Date.now,
    },
  },
  { _id: true }
);

const prepaidSmartCardSchema = new mongoose.Schema(
  {
    cardUid: {
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
      default: 'ZAMORIN',
    },
    cafeId: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
      index: true,
    },
    customerId: {
      type: String,
      trim: true,
      default: null,
    },
    customerName: {
      type: String,
      trim: true,
      default: 'Guest',
    },
    customerPhone: {
      type: String,
      trim: true,
      default: '',
    },
    balancePaisa: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
      validate: {
        validator: Number.isInteger,
        message: 'balancePaisa must be an integer.',
      },
    },
    securityDepositPaisa: {
      type: Number,
      default: 0,
      min: 0,
      validate: {
        validator: Number.isInteger,
        message: 'securityDepositPaisa must be an integer.',
      },
    },
    status: {
      type: String,
      enum: SMART_CARD_STATUSES,
      default: 'ACTIVE',
      index: true,
    },
    issuedAt: {
      type: Date,
      default: Date.now,
    },
    refundedAt: {
      type: Date,
      default: null,
    },
    transactions: {
      type: [smartCardTransactionSchema],
      default: [],
    },
  },
  {
    timestamps: true,
    collection: 'prepaid_smart_cards',
  }
);

prepaidSmartCardSchema.index({ organisationId: 1, cafeId: 1, status: 1 });

const PrepaidSmartCard =
  mongoose.models.PrepaidSmartCard ||
  mongoose.model('PrepaidSmartCard', prepaidSmartCardSchema);

module.exports = {
  PrepaidSmartCard,
  SMART_CARD_STATUSES,
  SMART_CARD_TXN_TYPES,
};
