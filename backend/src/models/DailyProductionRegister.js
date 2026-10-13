'use strict';

/**
 * DAILY PRODUCTION REGISTER — MONGOOSE MODEL (F137–F140)
 *
 * Implements daily morning finished-item yield batch registers (e.g. bakery daily croissant yields):
 *   - Morning production batch registration with initial yield count
 *   - Real-time sale decrementing during billing
 *   - Automatic auto-lock & 86 marking when batch is exhausted (remainingQty = 0)
 *   - Wastage and unsold logging at shift end
 */

const mongoose = require('mongoose');

const DAILY_REGISTER_STATUSES = ['ACTIVE', 'DEPLETED', 'CLOSED'];

const dailyProductionRegisterSchema = new mongoose.Schema(
  {
    registerId: {
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
      default: 'ZAMORIN',
    },
    cafeId: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
      index: true,
    },
    date: {
      type: String,
      required: true,
      trim: true,
      index: true, // 'YYYY-MM-DD'
    },
    menuItemId: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
      index: true,
    },
    itemName: {
      type: String,
      required: true,
      trim: true,
    },
    initialYieldQty: {
      type: Number,
      required: true,
      min: 0,
    },
    soldQty: {
      type: Number,
      default: 0,
      min: 0,
    },
    wastedQty: {
      type: Number,
      default: 0,
      min: 0,
    },
    remainingQty: {
      type: Number,
      required: true,
      min: 0,
    },
    batchNumber: {
      type: String,
      trim: true,
      default: '',
    },
    isLocked: {
      type: Boolean,
      default: false,
      index: true,
    },
    status: {
      type: String,
      enum: DAILY_REGISTER_STATUSES,
      default: 'ACTIVE',
      index: true,
    },
    registeredByUserId: {
      type: String,
      trim: true,
      default: null,
    },
  },
  {
    timestamps: true,
    collection: 'daily_production_registers',
  }
);

dailyProductionRegisterSchema.index(
  { organisationId: 1, cafeId: 1, date: 1, menuItemId: 1 },
  { unique: true }
);

const DailyProductionRegister =
  mongoose.models.DailyProductionRegister ||
  mongoose.model('DailyProductionRegister', dailyProductionRegisterSchema);

module.exports = {
  DailyProductionRegister,
  DAILY_REGISTER_STATUSES,
};
