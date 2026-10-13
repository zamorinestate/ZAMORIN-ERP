'use strict';

/**
 * STOCK MOVEMENT — MONGOOSE MODEL
 *
 * Immutable append-only inventory transaction ledger.
 */

const mongoose = require('mongoose');

const MOVEMENT_TYPES = [
  'OPENING_BALANCE',
  'PROCUREMENT_RECEIPT',
  'MANUAL_RECEIPT',
  'CONSUMPTION',
  'INTERNAL_TRANSFER',
  'CAFE_TRANSFER_OUT',
  'CAFE_TRANSFER_IN',
  'WASTAGE',
  'DAMAGE',
  'EXPIRY_DISPOSAL',
  'RETURN_TO_VENDOR',
  'COUNT_ADJUSTMENT',
  'CORRECTION',
  'REVERSAL',
  'RECEIPT',
  'ADJUSTMENT_ADD',
  'ADJUSTMENT_SUBTRACT',
  'TRANSFER_IN',
  'TRANSFER_OUT',
  'PRODUCTION_CONSUMPTION',
  'PRODUCTION_OUTPUT',
  'PRODUCTION_BATCH',
];

const stockMovementSchema = new mongoose.Schema(
  {
    organisationId: {
      type: String,
      required: true,
      immutable: true,
      trim: true,
      uppercase: true,
      index: true,
    },
    movementId: {
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
    itemId: {
      type: String,
      required: true,
      immutable: true,
      trim: true,
      uppercase: true,
      index: true,
    },
    movementType: {
      type: String,
      required: true,
      enum: MOVEMENT_TYPES,
      index: true,
    },
    quantityBase: {
      type: Number,
      required: true,
    },
    balanceBeforeBase: {
      type: Number,
      required: true,
      min: 0,
    },
    balanceAfterBase: {
      type: Number,
      required: true,
      min: 0,
    },
    lotId: {
      type: String,
      trim: true,
      default: null,
      index: true,
    },
    batchId: {
      type: String,
      trim: true,
      default: null,
      index: true,
    },
    supplierBatchNumber: {
      type: String,
      trim: true,
      default: null,
    },
    expiryDate: {
      type: Date,
      default: null,
    },
    manufacturingDate: {
      type: Date,
      default: null,
    },
    storageLocation: {
      type: String,
      trim: true,
      default: 'Main Store',
    },
    reason: {
      type: String,
      trim: true,
      maxlength: 250,
      default: '',
    },
    description: {
      type: String,
      trim: true,
      default: '',
    },
    referenceType: {
      type: String,
      trim: true,
      default: null,
    },
    referenceId: {
      type: String,
      trim: true,
      default: null,
      index: true,
    },
    performedByUserId: {
      type: String,
      required: true,
      immutable: true,
      trim: true,
    },
    isQuarantined: {
      type: Boolean,
      default: false,
    },
    quarantinedAt: {
      type: Date,
      default: null,
    },
    quarantineReason: {
      type: String,
      trim: true,
      default: null,
    },
    quarantinedByUserId: {
      type: String,
      trim: true,
      default: null,
    },
    recallNoticeId: {
      type: String,
      trim: true,
      default: null,
    },
    releasedFromQuarantineAt: {
      type: Date,
      default: null,
    },
    releasedByUserId: {
      type: String,
      trim: true,
      default: null,
    },
    performedAt: {
      type: Date,
      required: true,
      default: Date.now,
      immutable: true,
      index: true,
    },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
  }
);

stockMovementSchema.index(
  { organisationId: 1, movementId: 1 },
  { unique: true }
);

stockMovementSchema.index(
  { organisationId: 1, cafeId: 1, itemId: 1, performedAt: -1 }
);

const StockMovement =
  mongoose.models.StockMovement ||
  mongoose.model('StockMovement', stockMovementSchema);

module.exports = {
  StockMovement,
  MOVEMENT_TYPES,
};
