'use strict';

/**
 * GUEST VERIFICATION CHALLENGE — MONGOOSE MODEL (P15 QR ORDERING)
 *
 * Implements OTP verification challenges for guest QR ordering with:
 *   - Cryptographic challenge hashes.
 *   - 5-minute strict expiry.
 *   - Replay protection & one-time-use validation.
 *   - Max attempt limits (3 attempts before lock).
 *   - Provider delivery status tracking ('DELIVERED_TEST', 'PENDING_PROVIDER', 'BLOCKED_EXTERNAL_DEPENDENCY').
 */

const mongoose = require('mongoose');

const guestVerificationChallengeSchema = new mongoose.Schema(
  {
    challengeId: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      index: true,
    },
    organisationId: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    cafeId: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    phone: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    codeHash: {
      type: String,
      required: true,
    },
    attempts: {
      type: Number,
      default: 0,
    },
    maxAttempts: {
      type: Number,
      default: 3,
    },
    isVerified: {
      type: Boolean,
      default: false,
    },
    verifiedAt: {
      type: Date,
      default: null,
    },
    isUsed: {
      type: Boolean,
      default: false,
    },
    usedAt: {
      type: Date,
      default: null,
    },
    expiresAt: {
      type: Date,
      required: true,
      index: true,
    },
    deliveryStatus: {
      type: String,
      enum: ['DELIVERED_TEST', 'QUEUED_OUTBOX', 'BLOCKED_EXTERNAL_DEPENDENCY', 'FAILED'],
      default: 'DELIVERED_TEST',
    },
    providerError: {
      type: String,
      default: null,
    },
  },
  {
    timestamps: true,
    collection: 'guest_verification_challenges',
  }
);

guestVerificationChallengeSchema.index({ phone: 1, expiresAt: 1 });

const GuestVerificationChallenge =
  mongoose.models.GuestVerificationChallenge ||
  mongoose.model('GuestVerificationChallenge', guestVerificationChallengeSchema);

module.exports = {
  GuestVerificationChallenge,
};
