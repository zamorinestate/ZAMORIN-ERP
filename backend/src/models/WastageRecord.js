'use strict';

const mongoose = require('mongoose');

const wastageRecordSchema = new mongoose.Schema(
  {
    organisationId: {
      type: String,
      required: true,
      immutable: true,
      trim: true,
      uppercase: true,
      index: true,
    },
    wastageId: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
      index: true,
    },
    cafeId: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
      index: true,
    },
    itemId: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
      index: true,
    },
    lotId: {
      type: String,
      trim: true,
      default: null,
    },
    quantityBase: {
      type: Number,
      required: true,
      min: 0.001,
    },
    reasonCode: {
      type: String,
      required: true,
      enum: [
        'EXPIRED',
        'SPILLED',
        'SPILLAGE',
        'BURNT_BATCH',
        'QUALITY_REJECT',
        'QUALITY_REJECTION',
        'DAMAGED_PACKAGING',
        'PREPARATION_LOSS',
        'CONTAMINATION',
        'STORAGE_FAILURE',
        'OTHER',
      ],
      index: true,
    },
    estimatedValuePaisa: {
      type: Number,
      default: 0,
      min: 0,
    },
    notes: {
      type: String,
      trim: true,
      default: '',
    },
    recorderUserId: {
      type: String,
      required: true,
      trim: true,
    },
    approvedByUserId: {
      type: String,
      trim: true,
      default: null,
    },
    evidenceFileId: {
      type: String,
      trim: true,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

wastageRecordSchema.index(
  { organisationId: 1, wastageId: 1 },
  { unique: true }
);

const WastageRecord =
  mongoose.models.WastageRecord ||
  mongoose.model('WastageRecord', wastageRecordSchema);

module.exports = {
  WastageRecord,
};
