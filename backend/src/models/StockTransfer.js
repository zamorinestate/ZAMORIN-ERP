'use strict';

const mongoose = require('mongoose');

const stockTransferSchema = new mongoose.Schema(
  {
    organisationId: {
      type: String,
      required: true,
      immutable: true,
      trim: true,
      uppercase: true,
      index: true,
    },
    transferId: {
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
    destCafeId: {
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
    requestedQty: {
      type: Number,
      required: true,
      min: 0.001,
    },
    dispatchedQty: {
      type: Number,
      default: 0,
      min: 0,
    },
    receivedQty: {
      type: Number,
      default: 0,
      min: 0,
    },
    varianceQty: {
      type: Number,
      default: 0,
    },
    rejectedQty: {
      type: Number,
      default: 0,
      min: 0,
    },
    rejectionReason: {
      type: String,
      trim: true,
      default: '',
    },
    reason: {
      type: String,
      trim: true,
      default: '',
    },
    status: {
      type: String,
      enum: [
        'REQUESTED',
        'APPROVED',
        'DISPATCHED',
        'IN_TRANSIT',
        'RECEIVED',
        'COMPLETED',
        'CANCELLED',
      ],
      default: 'REQUESTED',
      index: true,
    },
    requestedBy: {
      type: String,
      required: true,
      trim: true,
    },
    dispatchedBy: {
      type: String,
      trim: true,
      default: null,
    },
    dispatchedAt: {
      type: Date,
      default: null,
    },
    receivedBy: {
      type: String,
      trim: true,
      default: null,
    },
    receivedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

stockTransferSchema.index(
  { organisationId: 1, transferId: 1 },
  { unique: true }
);

const StockTransfer =
  mongoose.models.StockTransfer ||
  mongoose.model('StockTransfer', stockTransferSchema);

module.exports = {
  StockTransfer,
};
