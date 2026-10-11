'use strict';

const mongoose = require('mongoose');

const COPYABLE_SECTIONS = [
  'OPERATING_HOURS',
  'RECEIPT_CONFIG',
  'APPROVAL_LIMITS',
  'PACKAGING_RULES',
  'INVENTORY_POLICIES',
  'SERVICE_MODES',
  'DISCOUNT_RULES',
];

// F193: Mandatory excluded settings that must NEVER copy between outlets to preserve unique outlet identities
const MANDATORY_EXCLUDED_SETTINGS = [
  'paymentGatewayCredentials',
  'merchantKeys',
  'razorpayKeySecret',
  'settlementBankAccount',
  'gstin',
  'pan',
  'cin',
  'fssaiNumber',
  'legalName',
  'premisesAddress',
  'pincode',
  'latitude',
  'longitude',
  'primaryPhone',
  'emergencyPhone',
  'managerName',
  'posTerminalConfigs',
  'sequenceCounters',
  'billPrefix',
  'orderPrefix',
  'batchPrefix',
  'lotNumberCounters',
  'localUnitConversionOverrides',
];

const outletCopyLogSchema = new mongoose.Schema(
  {
    copyLogId: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      uppercase: true,
      index: true,
    },
    organisationId: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
      index: true,
    },
    sourceCafeId: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
      index: true,
    },
    destinationCafeId: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
      index: true,
    },
    sourceCafeType: {
      type: String,
      trim: true,
      default: '',
    },
    destinationCafeType: {
      type: String,
      trim: true,
      default: '',
    },
    sectionsRequested: [
      {
        type: String,
        enum: COPYABLE_SECTIONS,
      },
    ],
    sectionsApplied: [
      {
        type: String,
        enum: COPYABLE_SECTIONS,
      },
    ],
    excludedSettingsProtected: [
      {
        type: String,
      },
    ],
    beforeSnapshot: {
      type: mongoose.Schema.Types.Mixed,
      default: () => ({}),
    },
    afterSnapshot: {
      type: mongoose.Schema.Types.Mixed,
      default: () => ({}),
    },
    diffSummary: [
      {
        section: String,
        field: String,
        oldValue: mongoose.Schema.Types.Mixed,
        newValue: mongoose.Schema.Types.Mixed,
      },
    ],
    copiedByUserId: {
      type: String,
      required: true,
      trim: true,
    },
    reason: {
      type: String,
      default: '',
      trim: true,
    },
  },
  {
    timestamps: true,
    collection: 'outlet_copy_logs',
  }
);

outletCopyLogSchema.index({ organisationId: 1, destinationCafeId: 1, createdAt: -1 });
outletCopyLogSchema.index({ organisationId: 1, sourceCafeId: 1, createdAt: -1 });

const OutletCopyLog = mongoose.model('OutletCopyLog', outletCopyLogSchema);

module.exports = {
  OutletCopyLog,
  COPYABLE_SECTIONS,
  MANDATORY_EXCLUDED_SETTINGS,
};
