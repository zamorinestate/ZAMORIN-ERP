'use strict';

const mongoose = require('mongoose');

const CASH_EVENT_TYPES = [
  'OPENING_FLOAT',
  'CASH_SALE',
  'CASH_REFUND',
  'CASH_IN',
  'CASH_OUT',
  'SAFE_DROP',
  'NO_SALE_OPEN',
  'RECEIVABLE_COLLECTION',
  'ADVANCE_DEPOSIT',
  'ADVANCE_REFUND',
  'BANK_DEPOSIT',
];

const cashEventSchema = new mongoose.Schema(
  {
    eventType: {
      type: String,
      enum: CASH_EVENT_TYPES,
      required: true,
    },
    amountPaisa: {
      type: Number,
      required: true,
      validate: { validator: Number.isInteger, message: 'amountPaisa must be an integer.' },
    },
    reason: {
      type: String,
      trim: true,
      default: '',
    },
    actorId: {
      type: String,
      required: true,
      trim: true,
    },
    timestamp: {
      type: Date,
      default: Date.now,
    },
    reference: {
      type: String,
      trim: true,
      default: '',
    },
    sourceCustody: {
      type: String,
      enum: ['REGISTER', 'SAFE'],
      default: 'REGISTER',
    },
  },
  { _id: true }
);

const registerSessionSchema = new mongoose.Schema(
  {
    registerSessionId: {
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
    registerId: {
      type: String,
      required: true,
      trim: true,
      default: 'REG-01',
      index: true,
    },
    cashierUserId: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    businessDate: {
      type: String,
      required: true,
      index: true,
    },
    openedAt: {
      type: Date,
      default: Date.now,
    },
    closedAt: {
      type: Date,
      default: null,
    },
    status: {
      type: String,
      enum: ['OPEN', 'CLOSED'],
      default: 'OPEN',
      index: true,
    },
    openingFloatPaisa: {
      type: Number,
      required: true,
      min: 0,
      default: 0,
    },
    expectedCashPaisa: {
      type: Number,
      default: 0,
    },
    countedCashPaisa: {
      type: Number,
      default: null,
    },
    cashVariancePaisa: {
      type: Number,
      default: 0,
    },
    totalSalesPaisa: {
      type: Number,
      default: 0,
    },
    totalCashSalesPaisa: {
      type: Number,
      default: 0,
    },
    totalUpiSalesPaisa: {
      type: Number,
      default: 0,
    },
    totalCardSalesPaisa: {
      type: Number,
      default: 0,
    },
    orderCount: {
      type: Number,
      default: 0,
    },
    cashEvents: {
      type: [cashEventSchema],
      default: [],
    },
    closingDeclarationNote: {
      type: String,
      trim: true,
      default: '',
    },
  },
  {
    timestamps: true,
  }
);

const RegisterSession = mongoose.model('RegisterSession', registerSessionSchema);

module.exports = {
  RegisterSession,
  CASH_EVENT_TYPES,
};
