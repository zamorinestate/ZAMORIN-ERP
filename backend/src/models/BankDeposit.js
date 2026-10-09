'use strict';

/**
 * BANK DEPOSIT — MONGOOSE MODEL (P10 PHYSICAL CASH CUSTODY)
 *
 * Records cash deposits into bank accounts from physical custody locations:
 *  - Sourced from SAFE (default: safe drops accumulated in physical safe custody)
 *  - Sourced from REGISTER (direct register deposit into bank)
 *
 * Enforces database-level idempotency to guarantee exactly-once execution
 * when 50 concurrent requests share the same idempotencyKey.
 */

const mongoose = require('mongoose');

const bankDepositSchema = new mongoose.Schema(
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

    bankAccountId: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
      index: true,
    },

    bankName: {
      type: String,
      trim: true,
      default: '',
    },

    sourceCustody: {
      type: String,
      enum: ['SAFE', 'REGISTER'],
      default: 'SAFE',
      required: true,
      index: true,
    },

    registerSessionId: {
      type: String,
      trim: true,
      default: null,
    },

    amountPaisa: {
      type: Number,
      required: true,
      min: [1, 'Deposit amount must be at least 1 paisa.'],
    },

    referenceNumber: {
      type: String,
      trim: true,
      default: '',
    },

    supportingDocumentUrl: {
      type: String,
      trim: true,
      default: '',
    },

    idempotencyKey: {
      type: String,
      trim: true,
      default: null,
    },

    status: {
      type: String,
      enum: ['SUBMITTED', 'IN_TRANSIT', 'RECONCILED', 'CANCELLED'],
      default: 'SUBMITTED',
      index: true,
    },

    depositedAt: {
      type: Date,
      default: Date.now,
    },

    depositedByUserId: {
      type: String,
      trim: true,
      default: 'SYSTEM',
    },
  },
  {
    timestamps: true,
    versionKey: 'version',
    collection: 'bank_deposits',
  }
);

bankDepositSchema.index(
  { organisationId: 1, idempotencyKey: 1 },
  {
    unique: true,
    partialFilterExpression: { idempotencyKey: { $type: 'string', $gt: '' } },
  }
);

const BankDeposit =
  mongoose.models.BankDeposit || mongoose.model('BankDeposit', bankDepositSchema);

module.exports = {
  BankDeposit,
};
