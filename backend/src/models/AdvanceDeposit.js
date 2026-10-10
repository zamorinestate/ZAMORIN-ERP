'use strict';

/**
 * ADVANCE DEPOSIT — MONGOOSE MODEL (P10 ADVANCE LIABILITIES & EVENT BOOKINGS)
 *
 * Implements Statutory Advance Accounting per CBIC GST Invoice Rules:
 *  - Issues formal Receipt Voucher upon receipt of customer advance payment
 *  - Advance deposit is an unapplied liability, NOT completed sale revenue
 *  - Supports atomic application to final commercial Bills
 *  - Issues formal Refund Voucher if contemplated event/supply is cancelled
 *  - Strictly segregates advance custody from day-of-event commercial sale totals
 */

const mongoose = require('mongoose');

const DEPOSIT_STATUSES = [
  'HELD_UNAPPLIED',
  'PARTIALLY_APPLIED',
  'FULLY_APPLIED',
  'PARTIALLY_REFUNDED',
  'FULLY_REFUNDED',
  'CANCELLED',
];

const depositApplicationSchema = new mongoose.Schema(
  {
    applicationId: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
    },
    billId: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
    },
    invoiceNumber: {
      type: String,
      trim: true,
      default: '',
    },
    amountAppliedPaisa: {
      type: Number,
      required: true,
      min: 1,
    },
    appliedAt: {
      type: Date,
      default: Date.now,
    },
    appliedByUserId: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
    },
    notes: {
      type: String,
      trim: true,
      default: '',
    },
  },
  { _id: true }
);

const depositRefundSchema = new mongoose.Schema(
  {
    refundId: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
    },
    refundVoucherNumber: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
    },
    amountRefundedPaisa: {
      type: Number,
      required: true,
      min: 1,
    },
    reason: {
      type: String,
      required: true,
      trim: true,
    },
    refundedAt: {
      type: Date,
      default: Date.now,
    },
    refundedByUserId: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
    },
    paymentMethod: {
      type: String,
      enum: ['CASH', 'UPI', 'CARD', 'BANK_TRANSFER'],
      default: 'CASH',
    },
    paymentReference: {
      type: String,
      trim: true,
      default: '',
    },
  },
  { _id: true }
);

const advanceDepositSchema = new mongoose.Schema(
  {
    depositId: {
      type: String,
      required: true,
      unique: true,
      immutable: true,
      trim: true,
      uppercase: true,
      index: true,
    },

    receiptVoucherNumber: {
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

    customerId: {
      type: String,
      trim: true,
      uppercase: true,
      default: '',
      index: true,
    },

    customerName: {
      type: String,
      required: true,
      trim: true,
    },

    customerPhone: {
      type: String,
      trim: true,
      default: '',
    },

    customerGstin: {
      type: String,
      trim: true,
      uppercase: true,
      default: '',
    },

    eventReference: {
      type: String,
      trim: true,
      default: '',
      index: true,
    },

    eventDate: {
      type: String,
      match: /^\d{4}-\d{2}-\d{2}$/,
      default: null,
    },

    depositAmountPaisa: {
      type: Number,
      required: true,
      min: 1,
    },

    unappliedAmountPaisa: {
      type: Number,
      required: true,
      min: 0,
    },

    appliedAmountPaisa: {
      type: Number,
      default: 0,
      min: 0,
    },

    refundedAmountPaisa: {
      type: Number,
      default: 0,
      min: 0,
    },

    paymentMethod: {
      type: String,
      enum: ['CASH', 'UPI', 'CARD', 'BANK_TRANSFER', 'CHEQUE'],
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

    registerSessionId: {
      type: String,
      trim: true,
      default: null,
    },

    supplyType: {
      type: String,
      enum: ['SERVICES', 'GOODS'],
      default: 'SERVICES',
    },

    supplyClassification: {
      type: String,
      enum: ['SERVICES', 'GOODS'],
      default: 'SERVICES',
    },

    statutorySupplyCategory: {
      type: String,
      trim: true,
      default: 'EVENT_BANQUET',
    },

    taxpayerRegime: {
      type: String,
      enum: ['REGULAR', 'COMPOSITION'],
      default: 'REGULAR',
    },

    applicableSupplyGstRatePercent: {
      type: Number,
      default: 5,
    },

    taxRatePercentAtAdvance: {
      type: Number,
      default: 5,
    },

    taxDueAtAdvancePaisa: {
      type: Number,
      default: 0,
    },

    taxAccountedOnAdvancePaisa: {
      type: Number,
      default: 0,
    },

    taxableAmountPaisa: {
      type: Number,
      default: 0,
    },

    taxRatePercent: {
      type: Number,
      default: 5,
    },

    taxRuleVersion: {
      type: String,
      default: 'GST_ROUNDING_V1_2026',
    },

    cgstPaisa: {
      type: Number,
      default: 0,
    },

    sgstPaisa: {
      type: Number,
      default: 0,
    },

    igstPaisa: {
      type: Number,
      default: 0,
    },

    status: {
      type: String,
      enum: DEPOSIT_STATUSES,
      default: 'HELD_UNAPPLIED',
      index: true,
    },

    applications: {
      type: [depositApplicationSchema],
      default: [],
    },

    refunds: {
      type: [depositRefundSchema],
      default: [],
    },

    idempotencyKey: {
      type: String,
      trim: true,
      default: null,
      index: true,
    },

    receivedAt: {
      type: Date,
      default: Date.now,
    },

    receivedByUserId: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
    },

    notes: {
      type: String,
      trim: true,
      default: '',
    },
  },
  {
    timestamps: true,
    versionKey: 'version',
    collection: 'advance_deposits',
  }
);

advanceDepositSchema.index({ organisationId: 1, cafeId: 1, status: 1 });
advanceDepositSchema.index({ organisationId: 1, customerId: 1, status: 1 });

const AdvanceDeposit =
  mongoose.models.AdvanceDeposit || mongoose.model('AdvanceDeposit', advanceDepositSchema);

module.exports = {
  AdvanceDeposit,
  DEPOSIT_STATUSES,
};
