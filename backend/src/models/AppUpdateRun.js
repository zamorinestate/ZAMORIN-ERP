'use strict';

const mongoose = require('mongoose');

const UPDATE_RUN_STATUSES = [
  'IDLE',
  'CHECKING',
  'PLANNING',
  'PREREQUISITES_VERIFIED',
  'APPLYING',
  'VERIFYING',
  'COMPLETED',
  'FAILED',
  'ROLLED_BACK',
];

const updateStepLogSchema = new mongoose.Schema(
  {
    step: { type: String, required: true, trim: true },
    status: { type: String, enum: ['PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'SKIPPED'], default: 'PENDING' },
    timestamp: { type: Date, default: Date.now },
    details: { type: String, trim: true, default: null },
  },
  { _id: false }
);

const prerequisiteCheckSchema = new mongoose.Schema(
  {
    check: { type: String, required: true, trim: true },
    status: { type: String, enum: ['PASS', 'FAIL', 'WARN'], required: true },
    details: { type: String, trim: true, default: '' },
  },
  { _id: false }
);

const appUpdateRunSchema = new mongoose.Schema(
  {
    updateRunId: {
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
    currentVersion: {
      type: String,
      required: true,
      trim: true,
    },
    targetVersion: {
      type: String,
      required: true,
      trim: true,
    },
    status: {
      type: String,
      enum: UPDATE_RUN_STATUSES,
      default: 'PLANNING',
      index: true,
    },
    dryRun: {
      type: Boolean,
      default: false,
    },
    manifest: {
      releaseId: { type: String, trim: true, default: null },
      sha256Checksum: { type: String, trim: true, default: null },
      minRequiredVersion: { type: String, trim: true, default: 'v1.0.0' },
      schemaMigrationRequired: { type: Boolean, default: false },
      breakingChanges: { type: Boolean, default: false },
      packageSizeKb: { type: Number, default: 0 },
    },
    preUpdateBackupId: {
      type: String,
      trim: true,
      default: null,
    },
    prerequisiteChecks: {
      type: [prerequisiteCheckSchema],
      default: [],
    },
    stepLog: {
      type: [updateStepLogSchema],
      default: [],
    },
    actorUserId: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
    },
    error: {
      code: { type: String, trim: true, default: null },
      message: { type: String, trim: true, default: null },
      timestamp: { type: Date, default: null },
    },
    rollbackPlan: {
      targetVersion: { type: String, trim: true, default: null },
      recoveryNotes: { type: String, trim: true, default: null },
      executed: { type: Boolean, default: false },
    },
    startedAt: {
      type: Date,
      default: Date.now,
    },
    completedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
    collection: 'app_update_runs',
  }
);

appUpdateRunSchema.index({ organisationId: 1, status: 1 });
appUpdateRunSchema.index({ organisationId: 1, createdAt: -1 });

const AppUpdateRun =
  mongoose.models.AppUpdateRun || mongoose.model('AppUpdateRun', appUpdateRunSchema);

module.exports = {
  AppUpdateRun,
  UPDATE_RUN_STATUSES,
};
