'use strict';

const mongoose = require('mongoose');

const bankAccountSchema = new mongoose.Schema(
  {
    organisationId: {
      type: String,
      required: true,
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
    accountAlias: {
      type: String,
      required: true,
      trim: true,
    },
    bankName: {
      type: String,
      required: true,
      trim: true,
    },
    maskedAccountNumber: {
      type: String,
      required: true,
      trim: true,
    },
    ifscCode: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
    },
    accountType: {
      type: String,
      enum: ['CURRENT', 'PETTY_CASH', 'ESCROW'],
      default: 'CURRENT',
    },
    glAccountCode: {
      type: String,
      required: true,
      trim: true,
    },
    bookBalancePaisa: {
      type: Number,
      default: 0,
    },
    reconciledBalancePaisa: {
      type: Number,
      default: 0,
    },
    lastReconciledDate: {
      type: String,
      default: null,
    },
    status: {
      type: String,
      enum: ['ACTIVE', 'INACTIVE'],
      default: 'ACTIVE',
      index: true,
    },
  },
  {
    timestamps: true,
  }
);

bankAccountSchema.index(
  { organisationId: 1, bankAccountId: 1 },
  { unique: true }
);

const BankAccount =
  mongoose.models.BankAccount ||
  mongoose.model('BankAccount', bankAccountSchema);

module.exports = {
  BankAccount,
};
