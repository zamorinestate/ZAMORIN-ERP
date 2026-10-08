'use strict';

/**
 * ============================================================================
 * ZAMORIN CAFÉ ERP — PROCUREMENT DISPATCH JOB MONGOOSE MODEL (P07)
 * ============================================================================
 *
 * Durable outbox job for transmitting approved Purchase Orders to vendors.
 *
 * CRITICAL INVARIANTS:
 * 1. An order can be an approved purchasing commitment while its transport is QUEUED.
 * 2. Transport status (QUEUED, CLAIMED, SENDING, ACCEPTED_BY_PROVIDER, DELIVERED,
 *    FAILED, UNKNOWN) is STRICTLY DISTINCT from Vendor business response
 *    (AWAITING_RESPONSE, ACKNOWLEDGED, PARTIALLY_CONFIRMED, REJECTED).
 * 3. Never mark a PO as Vendor acknowledged because a provider returned HTTP 200.
 * 4. Never mark goods received because a vendor acknowledged or email delivered.
 * 5. Exactly-once dispatch attempt protection with atomic MongoDB lease claiming
 *    and fencing token support.
 */

const mongoose = require('mongoose');

const DISPATCH_JOB_STATUSES = [
  'QUEUED',
  'CLAIMED',
  'SENDING',
  'ACCEPTED_BY_PROVIDER',
  'DELIVERED',
  'FAILED',
  'UNKNOWN',
  'CHANNEL_SETUP_REQUIRED',
  'CANCELLED',
];

const dispatchAttemptSchema = new mongoose.Schema(
  {
    attemptNumber: { type: Number, required: true },
    attemptedAt: { type: Date, default: Date.now },
    workerId: { type: String, trim: true, default: 'WORKER' },
    provider: { type: String, trim: true, default: 'EMAIL' },
    outcome: { type: String, trim: true, required: true }, // e.g. ACCEPTED, FAILED, TIMEOUT, UNKNOWN
    providerReferenceId: { type: String, trim: true, default: null },
    errorMessage: { type: String, trim: true, default: null },
    durationMs: { type: Number, min: 0, default: 0 },
  },
  { _id: false }
);

const procurementDispatchJobSchema = new mongoose.Schema(
  {
    dispatchJobId: {
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
      required: true,
      immutable: true,
      trim: true,
      uppercase: true,
      index: true,
    },

    purchaseOrderId: {
      type: String,
      required: true,
      immutable: true,
      trim: true,
      uppercase: true,
      index: true,
    },

    revisionNumber: {
      type: Number,
      required: true,
      min: 1,
      index: true,
    },

    vendorId: {
      type: String,
      required: true,
      immutable: true,
      trim: true,
      uppercase: true,
      index: true,
    },

    recipientEmail: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
    },

    recipientName: {
      type: String,
      trim: true,
      default: '',
    },

    status: {
      type: String,
      required: true,
      enum: DISPATCH_JOB_STATUSES,
      default: 'QUEUED',
      index: true,
    },

    claimedByWorkerId: {
      type: String,
      trim: true,
      default: null,
    },

    claimedAt: {
      type: Date,
      default: null,
    },

    lockExpiresAt: {
      type: Date,
      default: null,
      index: true,
    },

    fencingToken: {
      type: Number,
      default: null,
    },

    idempotencyKey: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      index: true,
    },

    provider: {
      type: String,
      trim: true,
      uppercase: true,
      default: 'EMAIL',
    },

    providerMessageId: {
      type: String,
      trim: true,
      default: null,
    },

    attempts: [dispatchAttemptSchema],

    payloadSnapshot: {
      type: mongoose.Schema.Types.Mixed,
      required: true,
    },

    documentHash: {
      type: String,
      trim: true,
      default: null,
    },

    reconciliationNotes: {
      type: String,
      trim: true,
      default: '',
    },

    reconciledAt: {
      type: Date,
      default: null,
    },

    reconciledByUserId: {
      type: String,
      trim: true,
      uppercase: true,
      default: null,
    },
  },
  {
    timestamps: true,
    collection: 'procurement_dispatch_jobs',
  }
);

procurementDispatchJobSchema.index(
  { organisationId: 1, cafeId: 1, status: 1 },
  { name: 'org_cafe_dispatch_status' }
);

procurementDispatchJobSchema.index(
  { purchaseOrderId: 1, revisionNumber: 1 },
  { name: 'po_revision_dispatch' }
);

const ProcurementDispatchJob =
  mongoose.models.ProcurementDispatchJob ||
  mongoose.model('ProcurementDispatchJob', procurementDispatchJobSchema);

module.exports = {
  ProcurementDispatchJob,
  DISPATCH_JOB_STATUSES,
};
