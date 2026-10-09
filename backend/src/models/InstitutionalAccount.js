'use strict';

/**
 * INSTITUTIONAL ACCOUNT — MONGOOSE MODEL (SCREEN 007)
 */

const mongoose = require('mongoose');

const CREDIT_ACCOUNT_STATUSES = ['ACTIVE', 'NEAR_LIMIT', 'ON_HOLD', 'SUSPENDED'];

const departmentConfigSchema = new mongoose.Schema(
  {
    departmentName: { type: String, required: true, trim: true },
    costCentre: { type: String, trim: true, default: '' },
    primaryContactName: { type: String, trim: true, default: '' },
    primaryContactPhone: { type: String, trim: true, default: '' },
    spendingLimitPaisa: { type: Number, default: 0 },
  },
  { _id: true }
);

const institutionalAccountSchema = new mongoose.Schema(
  {
    accountId: {
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

    institutionName: {
      type: String,
      trim: true,
      default: '',
      index: true,
    },

    accountName: {
      type: String,
      trim: true,
      default: '',
      index: true,
    },

    preferredCafeId: {
      type: String,
      trim: true,
      uppercase: true,
      default: 'ZC-0001',
    },

    creditLimitPaisa: {
      type: Number,
      required: true,
      min: 0,
      default: 10000000, // ₹1,00,000 default
    },

    currentExposurePaisa: {
      type: Number,
      min: 0,
      default: 0,
    },

    reservedExposurePaisa: {
      type: Number,
      min: 0,
      default: 0,
    },

    paymentTermsDays: {
      type: Number,
      default: 30,
      min: 0,
    },

    billingAddress: {
      type: String,
      trim: true,
      default: '',
    },

    gstin: {
      type: String,
      trim: true,
      uppercase: true,
      default: '',
    },

    billingContact: {
      name: { type: String, trim: true, default: '' },
      email: { type: String, trim: true, lowercase: true, default: '' },
      phone: { type: String, trim: true, default: '' },
    },

    permittedCafeIds: {
      type: [String],
      default: [],
    },

    creditStatus: {
      type: String,
      enum: CREDIT_ACCOUNT_STATUSES,
      default: 'ACTIVE',
      index: true,
    },

    poRequired: {
      type: Boolean,
      default: true,
    },

    defaultBillingCycle: {
      type: String,
      enum: ['PER_ORDER', 'WEEKLY', 'MONTHLY'],
      default: 'MONTHLY',
    },

    departments: {
      type: [departmentConfigSchema],
      default: [],
    },
  },
  {
    timestamps: true,
    versionKey: 'version',
    collection: 'institutional_accounts',
  }
);

institutionalAccountSchema.index({ organisationId: 1, accountId: 1 }, { unique: true });
institutionalAccountSchema.index({ organisationId: 1, creditStatus: 1 });

const InstitutionalAccount =
  mongoose.models.InstitutionalAccount ||
  mongoose.model('InstitutionalAccount', institutionalAccountSchema);

module.exports = {
  InstitutionalAccount,
  CREDIT_ACCOUNT_STATUSES,
};
