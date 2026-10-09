'use strict';

/**
 * RECEIVABLE — MONGOOSE MODEL (P10 ACCOUNTS RECEIVABLE LEDGER)
 *
 * Authoritative record of customer and institutional debt:
 *  - Distinct from sale value (Bill represents commercial supply; Receivable represents unpaid claim)
 *  - Atomic with InstitutionalAccount credit exposure
 *  - Maintains immutable collection history and derived ageing
 *  - Supports partial collections, dispute status, and strictly controlled write-offs
 */

const mongoose = require('mongoose');

const RECEIVABLE_STATUSES = [
  'OUTSTANDING',
  'PARTIALLY_COLLECTED',
  'COLLECTED',
  'DISPUTED',
  'WRITTEN_OFF',
  'CANCELLED',
];

const COLLECTION_METHODS = [
  'CASH',
  'UPI',
  'CARD',
  'BANK_TRANSFER',
  'CHEQUE',
  'CREDIT_NOTE',
  'ADVANCE_APPLIED',
];

const receivableCollectionSchema = new mongoose.Schema(
  {
    collectionId: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
    },
    amountPaisa: {
      type: Number,
      required: true,
      min: 1,
    },
    paymentMethod: {
      type: String,
      enum: COLLECTION_METHODS,
      required: true,
      default: 'CASH',
    },
    provider: {
      type: String,
      trim: true,
      default: '',
    },
    paymentReference: {
      type: String,
      trim: true,
      default: '',
    },
    receiptNumber: {
      type: String,
      trim: true,
      default: '',
    },
    registerSessionId: {
      type: String,
      trim: true,
      default: null,
    },
    collectedByUserId: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
    },
    collectedAt: {
      type: Date,
      default: Date.now,
    },
    idempotencyKey: {
      type: String,
      trim: true,
      default: null,
    },
    notes: {
      type: String,
      trim: true,
      default: '',
    },
  },
  { _id: true }
);

const receivableSchema = new mongoose.Schema(
  {
    receivableId: {
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

    accountId: {
      type: String,
      required: true,
      immutable: true,
      trim: true,
      uppercase: true,
      index: true,
    },

    customerName: {
      type: String,
      required: true,
      trim: true,
    },

    billId: {
      type: String,
      trim: true,
      uppercase: true,
      default: null,
      index: true,
    },

    invoiceNumber: {
      type: String,
      trim: true,
      default: null,
    },

    orderId: {
      type: String,
      trim: true,
      uppercase: true,
      default: null,
      index: true,
    },

    customerPoNumber: {
      type: String,
      trim: true,
      default: '',
    },

    departmentName: {
      type: String,
      trim: true,
      default: '',
    },

    costCentre: {
      type: String,
      trim: true,
      default: '',
    },

    originalAmountPaisa: {
      type: Number,
      required: true,
      min: 1,
    },

    collectedAmountPaisa: {
      type: Number,
      default: 0,
      min: 0,
    },

    outstandingAmountPaisa: {
      type: Number,
      required: true,
      min: 0,
    },

    currency: {
      type: String,
      default: 'INR',
    },

    issueDate: {
      type: String,
      required: true,
      match: /^\d{4}-\d{2}-\d{2}$/,
    },

    dueDate: {
      type: String,
      required: true,
      match: /^\d{4}-\d{2}-\d{2}$/,
      index: true,
    },

    paymentTermsDays: {
      type: Number,
      default: 30,
    },

    status: {
      type: String,
      enum: RECEIVABLE_STATUSES,
      default: 'OUTSTANDING',
      index: true,
    },

    collections: {
      type: [receivableCollectionSchema],
      default: [],
    },

    disputeDetails: {
      reason: { type: String, trim: true, default: '' },
      disputedAt: { type: Date, default: null },
      disputedByUserId: { type: String, trim: true, default: null },
    },

    writeOffDetails: {
      reason: { type: String, trim: true, default: '' },
      writtenOffAt: { type: Date, default: null },
      approvedByUserId: { type: String, trim: true, default: null },
      amountPaisa: { type: Number, default: 0 },
    },
  },
  {
    timestamps: true,
    versionKey: 'version',
    collection: 'receivables',
  }
);

receivableSchema.index({ organisationId: 1, accountId: 1, status: 1 });
receivableSchema.index({ organisationId: 1, cafeId: 1, status: 1 });
receivableSchema.index({ organisationId: 1, dueDate: 1, status: 1 });

const Receivable =
  mongoose.models.Receivable || mongoose.model('Receivable', receivableSchema);

module.exports = {
  Receivable,
  RECEIVABLE_STATUSES,
  COLLECTION_METHODS,
};
