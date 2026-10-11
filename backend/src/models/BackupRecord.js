'use strict';

const mongoose = require('mongoose');

const BACKUP_SCOPES = [
  'FULL_ENTERPRISE',
  'CAFE_SCOPED',
  'METADATA_AND_CONFIG',
];

const BACKUP_STATUSES = [
  'PENDING',
  'COMPLETED',
  'FAILED',
  'VERIFIED',
];

const collectionBackupSummarySchema = new mongoose.Schema(
  {
    collectionName: { type: String, required: true, trim: true },
    documentCount: { type: Number, required: true, default: 0 },
    sha256: { type: String, trim: true, default: null },
  },
  { _id: false }
);

const restoreRehearsalLogSchema = new mongoose.Schema(
  {
    rehearsalId: { type: String, required: true, trim: true },
    targetDbName: { type: String, required: true, trim: true },
    status: { type: String, enum: ['SUCCESS', 'FAILED', 'VERIFIED'], required: true },
    durationMs: { type: Number, default: 0 },
    verifiedAt: { type: Date, default: Date.now },
    actorUserId: { type: String, required: true, trim: true },
    verifiedCollections: { type: [String], default: [] },
    notes: { type: String, trim: true, default: null },
  },
  { _id: false }
);

const backupRecordSchema = new mongoose.Schema(
  {
    backupId: {
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
    scope: {
      type: String,
      enum: BACKUP_SCOPES,
      default: 'FULL_ENTERPRISE',
      index: true,
    },
    cafeId: {
      type: String,
      trim: true,
      uppercase: true,
      default: null,
    },
    status: {
      type: String,
      enum: BACKUP_STATUSES,
      default: 'PENDING',
      index: true,
    },
    fileName: {
      type: String,
      required: true,
      trim: true,
    },
    filePath: {
      type: String,
      required: true,
      trim: true,
    },
    sizeBytes: {
      type: Number,
      default: 0,
    },
    sha256Checksum: {
      type: String,
      trim: true,
      default: null,
    },
    collectionsCount: {
      type: Number,
      default: 0,
    },
    totalDocuments: {
      type: Number,
      default: 0,
    },
    collectionsSummary: {
      type: [collectionBackupSummarySchema],
      default: [],
    },
    retentionDays: {
      type: Number,
      default: 30,
    },
    triggeredBy: {
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
    verifiedAt: {
      type: Date,
      default: null,
    },
    rehearsalHistory: {
      type: [restoreRehearsalLogSchema],
      default: [],
    },
  },
  {
    timestamps: true,
    collection: 'backup_records',
  }
);

backupRecordSchema.index({ organisationId: 1, createdAt: -1 });
backupRecordSchema.index({ organisationId: 1, status: 1 });

const BackupRecord =
  mongoose.models.BackupRecord || mongoose.model('BackupRecord', backupRecordSchema);

module.exports = {
  BackupRecord,
  BACKUP_SCOPES,
  BACKUP_STATUSES,
};
