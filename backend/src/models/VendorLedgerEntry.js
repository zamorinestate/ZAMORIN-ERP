'use strict';

/**
 * VENDOR LEDGER ENTRY — MONGOOSE MODEL
 *
 * Permanent, append-only financial subledger for suppliers.
 * Tracks all commercial liabilities, payments, advances, credit notes, holds, and adjustments.
 */

const mongoose = require('mongoose');

const VENDOR_LEDGER_TRANSACTION_TYPES = [
  'OPENING_BALANCE',
  'VENDOR_BILL',
  'PAYMENT',
  'PARTIAL_PAYMENT',
  'ADVANCE_PAYMENT',
  'ADVANCE_APPLIED',
  'CREDIT_NOTE',
  'DEBIT_ADJUSTMENT',
  'PAYMENT_REVERSAL',
  'REFUND_RECEIVED',
  'SHORT_SUPPLY_HOLD',
  'PAYMENT_HOLD',
  'HOLD_RELEASE',
  'WRITE_OFF',
  'AUTHORISED_ADJUSTMENT',
];

const vendorLedgerEntrySchema = new mongoose.Schema(
  {
    organisationId: {
      type: String,
      required: true,
      immutable: true,
      trim: true,
      uppercase: true,
      index: true,
    },
    ledgerEntryId: {
      type: String,
      required: true,
      unique: true,
      immutable: true,
      trim: true,
      uppercase: true,
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
    vendorNameSnapshot: {
      type: String,
      trim: true,
      default: '',
    },
    cafeId: {
      type: String,
      trim: true,
      uppercase: true,
      default: 'ORGANISATION_WIDE',
      index: true,
    },
    entryDate: {
      type: String,
      required: true,
      match: /^\d{4}-\d{2}-\d{2}$/,
      index: true,
    },
    entryTimestamp: {
      type: Date,
      default: Date.now,
      immutable: true,
      index: true,
    },
    entryType: {
      type: String,
      required: true,
      enum: VENDOR_LEDGER_TRANSACTION_TYPES,
      index: true,
    },
    referenceType: {
      type: String,
      enum: ['PURCHASE_ORDER', 'GRN', 'AP_INVOICE', 'PAYMENT', 'CREDIT_NOTE', 'ADVANCE', 'MANUAL'],
      default: 'MANUAL',
    },
    referenceId: {
      type: String,
      trim: true,
      default: null,
      index: true,
    },
    purchaseOrderId: {
      type: String,
      trim: true,
      uppercase: true,
      default: null,
      index: true,
    },
    grnId: {
      type: String,
      trim: true,
      uppercase: true,
      default: null,
    },
    supplierInvoiceNumber: {
      type: String,
      trim: true,
      uppercase: true,
      default: null,
    },
    paymentId: {
      type: String,
      trim: true,
      uppercase: true,
      default: null,
      index: true,
    },
    referenceNumber: {
      type: String,
      trim: true,
      default: null,
      index: true,
    },
    cashTransactionId: {
      type: String,
      trim: true,
      uppercase: true,
      default: null,
      index: true,
    },
    entryNumber: {
      type: Number,
      default: null,
    },
    // Standard accounting direction:
    // Debit = reduces vendor payable (Payment, Advance, Credit Note)
    // Credit = increases vendor payable (Vendor Bill / Liability)
    debitPaisa: {
      type: Number,
      required: true,
      min: 0,
      default: 0,
    },
    creditPaisa: {
      type: Number,
      required: true,
      min: 0,
      default: 0,
    },
    heldPaisa: {
      type: Number,
      min: 0,
      default: 0,
    },
    paidPaisa: {
      type: Number,
      min: 0,
      default: 0,
    },
    runningBalancePaisa: {
      type: Number,
      required: true,
    },
    notes: {
      type: String,
      trim: true,
      maxlength: 1000,
      default: '',
    },
    createdByUserId: {
      type: String,
      required: true,
      immutable: true,
      trim: true,
      uppercase: true,
    },
    isReversed: {
      type: Boolean,
      default: false,
      index: true,
    },
    reversalEntryId: {
      type: String,
      trim: true,
      default: null,
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: () => ({}),
    },
  },
  {
    timestamps: true,
    collection: 'vendor_ledger_entries',
  }
);

// Immutability pre-hook: Prevent update and delete
vendorLedgerEntrySchema.pre('updateOne', function () {
  throw new Error('Direct update on immutable VendorLedgerEntry is strictly prohibited.');
});
vendorLedgerEntrySchema.pre('updateMany', function () {
  throw new Error('Direct update on immutable VendorLedgerEntry is strictly prohibited.');
});
vendorLedgerEntrySchema.pre('findOneAndUpdate', function () {
  throw new Error('Direct update on immutable VendorLedgerEntry is strictly prohibited.');
});
vendorLedgerEntrySchema.pre('deleteOne', function () {
  throw new Error('Direct deletion of VendorLedgerEntry is strictly prohibited.');
});
vendorLedgerEntrySchema.pre('deleteMany', function (next) {
  // Allow test database cleans if explicitly in test mode with empty query
  if (process.env.NODE_ENV === 'test' && Object.keys(this.getQuery() || {}).length === 0) {
    if (typeof next === 'function') return next();
    return;
  }
  throw new Error('Direct deletion of VendorLedgerEntry is strictly prohibited.');
});

vendorLedgerEntrySchema.index(
  { organisationId: 1, vendorId: 1, entryTimestamp: 1 },
  { name: 'org_vendor_entry_time' }
);

vendorLedgerEntrySchema.index(
  { organisationId: 1, cafeId: 1, entryDate: -1 },
  { name: 'org_cafe_entry_date' }
);

const VendorLedgerEntry =
  mongoose.models.VendorLedgerEntry ||
  mongoose.model('VendorLedgerEntry', vendorLedgerEntrySchema);

module.exports = {
  VendorLedgerEntry,
  VENDOR_LEDGER_TRANSACTION_TYPES,
};
