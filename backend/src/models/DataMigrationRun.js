'use strict';

const mongoose = require('mongoose');

const MIGRATION_DOMAINS = [
  'SUPPLIER_MAPPING',
  'OPENING_STOCK_BATCH',
  'CUSTOMER_CRM',
  'RECIPE_WORKBOOK',
  'STARTER_INGREDIENTS',
];

const MIGRATION_STATUSES = [
  'DRAFT',
  'VALIDATING',
  'PREVIEW_READY',
  'CONFIRMED',
  'EXECUTING',
  'COMPLETED',
  'PARTIALLY_FAILED',
  'FAILED',
  'CANCELLED',
];

const dataMigrationRunSchema = new mongoose.Schema(
  {
    migrationRunId: {
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
    cafeId: {
      type: String,
      trim: true,
      uppercase: true,
      default: '',
      index: true,
    },
    domain: {
      type: String,
      enum: MIGRATION_DOMAINS,
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: MIGRATION_STATUSES,
      default: 'DRAFT',
      index: true,
    },
    sourceFileName: {
      type: String,
      trim: true,
      default: '',
    },
    sourceFormat: {
      type: String,
      enum: ['CSV', 'JSON'],
      default: 'JSON',
    },
    contentHash: {
      type: String,
      trim: true,
      default: '',
      index: true,
    },
    idempotencyKey: {
      type: String,
      trim: true,
      default: '',
      index: true,
    },
    dryRun: {
      type: Boolean,
      default: false,
    },
    totalRows: {
      type: Number,
      default: 0,
    },
    validRows: {
      type: Number,
      default: 0,
    },
    invalidRows: {
      type: Number,
      default: 0,
    },
    committedRows: {
      type: Number,
      default: 0,
    },
    sourceTotals: {
      type: mongoose.Schema.Types.Mixed,
      default: () => ({}),
    },
    reconciledTotals: {
      type: mongoose.Schema.Types.Mixed,
      default: () => ({}),
    },
    errors: [
      {
        rowNumber: { type: Number, required: true },
        field: { type: String, default: '' },
        message: { type: String, required: true },
        rawData: { type: mongoose.Schema.Types.Mixed },
      },
    ],
    previewSample: [
      {
        type: mongoose.Schema.Types.Mixed,
      },
    ],
    executionCheckpoints: [
      {
        checkpointName: { type: String, required: true },
        timestamp: { type: Date, default: Date.now },
        recordsProcessed: { type: Number, default: 0 },
        status: { type: String, default: 'IN_PROGRESS' },
        notes: { type: String, default: '' },
      },
    ],
    initiatedByUserId: {
      type: String,
      trim: true,
      default: '',
    },
    confirmedByUserId: {
      type: String,
      trim: true,
      default: '',
    },
    executedAt: {
      type: Date,
      default: null,
    },
    completedAt: {
      type: Date,
      default: null,
    },
    auditTrail: [
      {
        action: { type: String, required: true },
        fromStatus: { type: String, default: null },
        toStatus: { type: String, required: true },
        performedBy: { type: String, required: true },
        timestamp: { type: Date, default: Date.now },
        reason: { type: String, default: '' },
      },
    ],
  },
  {
    timestamps: true,
    collection: 'data_migration_runs',
    suppressReservedKeysWarning: true,
  }
);

dataMigrationRunSchema.index({ organisationId: 1, domain: 1, createdAt: -1 });
dataMigrationRunSchema.index({ organisationId: 1, cafeId: 1, status: 1 });

const DataMigrationRun = mongoose.model('DataMigrationRun', dataMigrationRunSchema);

module.exports = {
  DataMigrationRun,
  MIGRATION_DOMAINS,
  MIGRATION_STATUSES,
};
