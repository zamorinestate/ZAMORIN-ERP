'use strict';

/**
 * SAFE CUSTODY — MONGOOSE MODEL (P10 PHYSICAL CASH CUSTODY)
 *
 * Tracks physical cash held in the physical safe custody of each café.
 * Strictly segregates:
 *  - REGISTER / TILL cash
 *  - SAFE / CASH_CUSTODY cash
 *  - BANK_DEPOSIT / IN_TRANSIT cash
 *  - BANK / RECONCILED cash
 *
 * Supports atomic conditional decrement to prevent negative safe balances
 * under concurrent transfers to bank.
 */

const mongoose = require('mongoose');

const safeCustodySchema = new mongoose.Schema(
  {
    organisationId: {
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

    currentBalancePaisa: {
      type: Number,
      required: true,
      default: 0,
      min: [0, 'Safe balance cannot be negative.'],
    },

    lastUpdated: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
    versionKey: 'version',
    collection: 'safe_custody',
  }
);

safeCustodySchema.index(
  { organisationId: 1, cafeId: 1 },
  { unique: true }
);

const SafeCustody =
  mongoose.models.SafeCustody || mongoose.model('SafeCustody', safeCustodySchema);

module.exports = {
  SafeCustody,
};
