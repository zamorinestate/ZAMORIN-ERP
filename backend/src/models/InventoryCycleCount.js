'use strict';

const mongoose = require('mongoose');

const countItemSchema = new mongoose.Schema(
  {
    itemId: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
    },
    systemQty: {
      type: Number,
      required: true,
    },
    countedQty: {
      type: Number,
      required: true,
    },
    varianceQty: {
      type: Number,
      required: true,
    },
    lotId: {
      type: String,
      trim: true,
      default: null,
    },
    reason: {
      type: String,
      trim: true,
      default: '',
    },
  },
  { _id: false }
);

const inventoryCycleCountSchema = new mongoose.Schema(
  {
    organisationId: {
      type: String,
      required: true,
      immutable: true,
      trim: true,
      uppercase: true,
      index: true,
    },
    countId: {
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
    businessDate: {
      type: String,
      trim: true,
      default: null,
    },
    countType: {
      type: String,
      enum: ['CYCLE_COUNT', 'PHYSICAL_INVENTORY', 'PAR_COUNT'],
      default: 'CYCLE_COUNT',
      index: true,
    },
    storageLocation: {
      type: String,
      trim: true,
      default: 'Main Store',
    },
    items: {
      type: [countItemSchema],
      default: [],
    },
    status: {
      type: String,
      enum: [
        'DRAFT',
        'IN_PROGRESS',
        'SUBMITTED',
        'RECOUNT_REQUIRED',
        'APPROVED',
        'POSTED',
      ],
      default: 'SUBMITTED',
      index: true,
    },
    isBlindCount: {
      type: Boolean,
      default: false,
    },
    cutoffAt: {
      type: Date,
      default: Date.now,
    },
    sessionSnapshot: {
      type: Array,
      default: [],
    },
    countedByUserId: {
      type: String,
      required: true,
      trim: true,
    },
    approvedByUserId: {
      type: String,
      trim: true,
      default: null,
    },
    postedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

inventoryCycleCountSchema.index(
  { organisationId: 1, countId: 1 },
  { unique: true }
);

const InventoryCycleCount =
  mongoose.models.InventoryCycleCount ||
  mongoose.model('InventoryCycleCount', inventoryCycleCountSchema);

module.exports = {
  InventoryCycleCount,
};
