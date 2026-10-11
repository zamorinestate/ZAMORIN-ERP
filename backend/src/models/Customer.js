'use strict';

/**
 * CUSTOMER — MONGOOSE MODEL (SCREEN 006)
 *
 * Implements Customer Master, 360 Profile & Loyalty:
 *   - Basic identity (name, phone, email, membershipId).
 *   - Customer types (INDIVIDUAL, BUSINESS) with B2B GSTIN support.
 *   - Loyalty tiering (BRONZE, SILVER, GOLD, PLATINUM) and points ledger balance.
 *   - Atomic reserved vs available points.
 *   - Lifetime visit count, spend metrics, and preferred café.
 *   - Consent & privacy tracking (transactional, loyalty, marketing email/sms).
 *   - Account merging support.
 */

const mongoose = require('mongoose');

const LOYALTY_TIERS = [
  'BRONZE',
  'SILVER',
  'GOLD',
  'PLATINUM',
];

const CUSTOMER_TYPES = [
  'INDIVIDUAL',
  'BUSINESS',
];

const CUSTOMER_STATUSES = [
  'ACTIVE',
  'INACTIVE',
  'LAPSED',
  'CLOSED',
  'MERGED',
  'ARCHIVED',
];

const LOYALTY_STATUSES = [
  'ACTIVE',
  'HELD',
  'SUSPENDED',
  'CLOSED',
];

const customerNoteSchema = new mongoose.Schema(
  {
    noteId: { type: String, required: true, trim: true },
    authorUserId: { type: String, required: true, trim: true, uppercase: true },
    content: { type: String, required: true, trim: true, maxlength: 2000 },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: true }
);

const customerSchema = new mongoose.Schema(
  {
    customerId: {
      type: String,
      required: true,
      unique: true,
      immutable: true,
      trim: true,
      uppercase: true,
      match: /^CUST-\d{4,}$/,
      index: true,
    },

    membershipId: {
      type: String,
      trim: true,
      uppercase: true,
      index: true,
      default: '',
    },

    organisationId: {
      type: String,
      required: true,
      immutable: true,
      trim: true,
      uppercase: true,
      index: true,
    },

    name: {
      type: String,
      required: true,
      trim: true,
      minlength: 1,
      maxlength: 200,
    },

    phone: {
      type: String,
      required: true,
      trim: true,
      maxlength: 20,
      index: true,
    },

    email: {
      type: String,
      trim: true,
      lowercase: true,
      maxlength: 200,
      default: '',
    },

    isPhoneVerified: {
      type: Boolean,
      default: false,
    },

    isEmailVerified: {
      type: Boolean,
      default: false,
    },

    customerType: {
      type: String,
      enum: CUSTOMER_TYPES,
      default: 'INDIVIDUAL',
    },

    b2bLegalName: {
      type: String,
      trim: true,
      default: '',
    },

    b2bGstin: {
      type: String,
      trim: true,
      uppercase: true,
      default: '',
    },

    preferredCafeId: {
      type: String,
      trim: true,
      uppercase: true,
      default: 'ZC-0001',
    },

    preferredLanguage: {
      type: String,
      trim: true,
      default: 'English',
    },

    totalSpendPaisa: {
      type: Number,
      min: 0,
      default: 0,
    },

    totalVisits: {
      type: Number,
      min: 0,
      default: 0,
    },

    firstVisitAt: {
      type: Date,
      default: null,
    },

    lastVisitAt: {
      type: Date,
      default: null,
    },

    pointsBalance: {
      type: Number,
      min: 0,
      default: 0,
    },

    reservedPoints: {
      type: Number,
      min: 0,
      default: 0,
    },

    tier: {
      type: String,
      enum: LOYALTY_TIERS,
      default: 'BRONZE',
    },

    tierQualifiedAt: {
      type: Date,
      default: Date.now,
    },

    status: {
      type: String,
      enum: CUSTOMER_STATUSES,
      default: 'ACTIVE',
      index: true,
    },

    loyaltyStatus: {
      type: String,
      enum: LOYALTY_STATUSES,
      default: 'ACTIVE',
    },

    walletBalancePaise: {
      type: Number,
      min: 0,
      default: 0,
      validate: {
        validator: (v) => Number.isInteger(v) && v >= 0,
        message: 'walletBalancePaise must be a non-negative integer in paise.',
      },
    },

    groups: {
      type: [String],
      default: [],
    },

    dateOfBirth: {
      type: Date,
      default: null,
    },

    anniversary: {
      type: Date,
      default: null,
    },

    tags: {
      type: [String],
      default: [],
    },

    consent: {
      transactionalReceipt: { type: Boolean, default: true },
      loyaltyCommunications: { type: Boolean, default: true },
      marketingEmail: { type: Boolean, default: false },
      marketingSms: { type: Boolean, default: false },
      marketingWhatsApp: { type: Boolean, default: false },
      updatedAt: { type: Date, default: Date.now },
      source: { type: String, default: 'PORTAL_ENROLMENT' },
    },

    consentHistory: [
      {
        purpose: { type: String, required: true },
        channel: { type: String, required: true },
        status: { type: String, required: true },
        source: { type: String, default: 'DIRECT_REQUEST' },
        timestamp: { type: Date, default: Date.now },
        noticeVersion: { type: String, default: 'V1.0' },
        actorUserId: { type: String, default: 'CUSTOMER' },
        evidenceRef: { type: String, default: null },
      },
    ],

    notes: {
      type: [customerNoteSchema],
      default: [],
    },

    mergedIntoCustomerId: {
      type: String,
      trim: true,
      uppercase: true,
      default: null,
    },

    createdByUserId: {
      type: String,
      required: true,
      immutable: true,
      trim: true,
      uppercase: true,
    },
  },
  {
    timestamps: true,
    versionKey: 'version',
    optimisticConcurrency: true,
    collection: 'customers',
    strict: false,
  }
);

customerSchema.virtual('availablePoints').get(function () {
  return Math.max(0, (this.pointsBalance || 0) - (this.reservedPoints || 0));
});

customerSchema.index(
  { organisationId: 1, phone: 1 },
  { name: 'org_phone_idx' }
);

customerSchema.index(
  { organisationId: 1, email: 1 },
  { name: 'org_email_idx' }
);

customerSchema.index(
  { organisationId: 1, tier: 1, status: 1 },
  { name: 'org_tier_status_idx' }
);

const Customer =
  mongoose.models.Customer ||
  mongoose.model('Customer', customerSchema);

module.exports = {
  Customer,
  LOYALTY_TIERS,
  CUSTOMER_TYPES,
  CUSTOMER_STATUSES,
  LOYALTY_STATUSES,
};
