'use strict';

/**
 * DINING TABLE — MONGOOSE MODEL (P15 CHANNELS & FRONT SERVICE)
 *
 * Implements authoritative dining table identity, floor sectioning,
 * seating capacity, real-time table occupancy status, and universal QR token binding.
 */

const mongoose = require('mongoose');

const TABLE_STATUSES = ['AVAILABLE', 'OCCUPIED', 'RESERVED', 'BLOCKED'];

const diningTableSchema = new mongoose.Schema(
  {
    tableId: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
      index: true,
    },
    tableNumber: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
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
      required: true,
      trim: true,
      uppercase: true,
      index: true,
    },
    section: {
      type: String,
      trim: true,
      default: 'Main Dining',
    },
    seatingCapacity: {
      type: Number,
      required: true,
      min: 1,
      default: 4,
    },
    status: {
      type: String,
      enum: TABLE_STATUSES,
      default: 'AVAILABLE',
      index: true,
    },
    activeSessionId: {
      type: String,
      trim: true,
      default: null,
    },
    activeQrRecordId: {
      type: String,
      trim: true,
      default: null,
    },
    activeQrToken: {
      type: String,
      trim: true,
      default: null,
    },
    isServiceBlocked: {
      type: Boolean,
      default: false,
    },
    sortOrder: {
      type: Number,
      default: 0,
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: () => ({}),
    },
  },
  {
    timestamps: true,
    collection: 'dining_tables',
  }
);

diningTableSchema.index({ organisationId: 1, cafeId: 1, tableNumber: 1 }, { unique: true });
diningTableSchema.index({ organisationId: 1, cafeId: 1, tableId: 1 }, { unique: true });
diningTableSchema.index({ organisationId: 1, cafeId: 1, status: 1 });

const DiningTable =
  mongoose.models.DiningTable ||
  mongoose.model('DiningTable', diningTableSchema);

module.exports = {
  DiningTable,
  TABLE_STATUSES,
};
