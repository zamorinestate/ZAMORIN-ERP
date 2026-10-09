'use strict';

/**
 * PAYMENT ATTEMPT & REFERENCE RECORD — MONGOOSE MODEL (P09 GATE)
 *
 * Dedicated collection guaranteeing authoritative database-level uniqueness
 * for external payment provider references across providers and organizations.
 *
 * Natural Business Key: { organisationId, provider, paymentReference }
 * Unique Compound Index guarantees no concurrent race condition can ever
 * attribute the same provider transaction to multiple bills or duplicate payments.
 */

const mongoose = require('mongoose');

const paymentAttemptRecordSchema = new mongoose.Schema(
  {
    organisationId: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
      index: true,
    },

    provider: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
      index: true,
    },

    paymentReference: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },

    billId: {
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

    amountPaisa: {
      type: Number,
      required: true,
      min: 0,
    },

    currency: {
      type: String,
      trim: true,
      default: 'INR',
    },

    paymentMethod: {
      type: String,
      trim: true,
      uppercase: true,
      default: 'UPI',
    },

    status: {
      type: String,
      enum: ['PENDING', 'COMPLETED', 'FAILED', 'REVERSED', 'EXPIRED', 'CANCELLED', 'UNKNOWN_RECONCILIATION_REQUIRED'],
      default: 'COMPLETED',
      index: true,
    },

    maskedCard: {
      type: String,
      trim: true,
      default: '',
    },

    rawCallbackPayload: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },

    verifiedAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
    collection: 'payment_attempt_records',
  }
);

// Database-enforced Uniqueness on Organisation + Provider + PaymentReference
paymentAttemptRecordSchema.index(
  { organisationId: 1, provider: 1, paymentReference: 1 },
  { unique: true, name: 'org_provider_payment_reference_unique' }
);

const PaymentAttemptRecord =
  mongoose.models.PaymentAttemptRecord ||
  mongoose.model('PaymentAttemptRecord', paymentAttemptRecordSchema);

module.exports = {
  PaymentAttemptRecord,
};
