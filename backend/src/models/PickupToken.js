'use strict';

/**
 * PICKUP TOKEN — MONGOOSE MODEL (P15 CHANNELS & FRONT SERVICE)
 *
 * Implements token allocation for customer pickup & takeaway fulfillment.
 *
 * PRIVACY & PUBLIC DISPLAY GUARANTEE:
 * Customer-facing displays consume ONLY minimal safe projection:
 * (tokenNumber, status, pickupCounter). No customer PII, phone numbers,
 * payment references, or financial amounts are ever exposed.
 *
 * NOTE: Customer status display is strictly NOT a Kitchen Display System (KDS).
 */

const mongoose = require('mongoose');

const TOKEN_CHANNELS = ['TAKEAWAY', 'DIRECT_WEB', 'AGGREGATOR', 'QR_ORDER'];

const TOKEN_STATUSES = [
  'QUEUED',
  'PREPARING',
  'READY_FOR_PICKUP',
  'COLLECTED',
  'CANCELLED',
];

const pickupTokenSchema = new mongoose.Schema(
  {
    tokenId: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      uppercase: true,
      index: true,
    },
    tokenNumber: {
      type: String,
      required: true,
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
      required: true,
      trim: true,
      uppercase: true,
      index: true,
    },
    orderReference: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    channel: {
      type: String,
      enum: TOKEN_CHANNELS,
      default: 'TAKEAWAY',
    },
    status: {
      type: String,
      enum: TOKEN_STATUSES,
      default: 'QUEUED',
      index: true,
    },
    pickupCounter: {
      type: String,
      trim: true,
      default: 'Counter A',
    },
    assignedAt: {
      type: Date,
      default: Date.now,
    },
    readyAt: {
      type: Date,
      default: null,
    },
    collectedAt: {
      type: Date,
      default: null,
    },
    expiresAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
    collection: 'pickup_tokens',
  }
);

pickupTokenSchema.index({ organisationId: 1, tokenId: 1 }, { unique: true });
pickupTokenSchema.index({ organisationId: 1, cafeId: 1, status: 1 });
pickupTokenSchema.index({ organisationId: 1, cafeId: 1, tokenNumber: 1, status: 1 });

const PickupToken =
  mongoose.models.PickupToken ||
  mongoose.model('PickupToken', pickupTokenSchema);

module.exports = {
  PickupToken,
  TOKEN_CHANNELS,
  TOKEN_STATUSES,
};
