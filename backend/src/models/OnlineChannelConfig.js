'use strict';

/**
 * ONLINE CHANNEL CONFIG — MONGOOSE MODEL (P15 CHANNELS & DIRECT ORDERING)
 *
 * Implements outlet-specific channel configuration, operating hours,
 * minimum order amounts, packaging fees, and aggregator integration parameters.
 */

const mongoose = require('mongoose');

const onlineChannelConfigSchema = new mongoose.Schema(
  {
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
    qrOrdering: {
      isEnabled: { type: Boolean, default: true },
      allowMultipleRounds: { type: Boolean, default: true },
      requireCustomerVerification: { type: Boolean, default: false },
    },
    directWeb: {
      isEnabled: { type: Boolean, default: true },
      minimumOrderPaisa: { type: Number, default: 0, min: 0 },
      packagingFeePaisa: { type: Number, default: 1500, min: 0 }, // 15.00 INR default
      deliveryFeePaisa: { type: Number, default: 4000, min: 0 },  // 40.00 INR default
      operatingHoursStart: { type: String, default: '07:00' },
      operatingHoursEnd: { type: String, default: '23:00' },
      localityDistanceTiers: {
        type: [
          {
            zoneName: { type: String, required: true },
            maxDistanceKm: { type: Number, required: true },
            feePaisa: { type: Number, required: true },
          },
        ],
        default: [
          { zoneName: 'Zone 1 (Cyberpark)', maxDistanceKm: 3, feePaisa: 3000 },
          { zoneName: 'Zone 2 (Hi-Lite)', maxDistanceKm: 7, feePaisa: 5000 },
          { zoneName: 'Zone 3 (Outskirts)', maxDistanceKm: 15, feePaisa: 8000 },
        ],
      },
    },
    brandRankings: {
      type: [
        {
          brandId: { type: String, required: true },
          brandName: { type: String, required: true },
          priorityRank: { type: Number, default: 0 },
        },
      ],
      default: [],
    },
    unassignedCourierTimeoutMinutes: {
      type: Number,
      default: 12,
    },
    // Payment-Gated Kitchen Dispatch (F036)
    paymentGatedKitchenDispatch: {
      type: Boolean,
      default: false,
    },
    // Mandatory Tender Selection Mode (F011)
    mandatoryTenderSelection: {
      type: Boolean,
      default: false,
    },
    // Tip Calculation Base (F074, F075)
    tipCalculationBase: {
      type: String,
      enum: ['PRE_TAX_SUBTOTAL', 'POST_TAX_GRAND_TOTAL'],
      default: 'PRE_TAX_SUBTOTAL',
    },
    // Irreversible Historical Stock Freeze Date (F188–F191)
    historicalStockFreezeDate: {
      type: Date,
      default: null,
    },
    aggregators: {
      zomato: {
        isEnabled: { type: Boolean, default: true },
        autoAccept: { type: Boolean, default: false },
        storeStatus: { type: String, enum: ['ONLINE', 'OFFLINE', 'PAUSED'], default: 'ONLINE' },
        pausedUntil: { type: Date, default: null },
        pauseReason: { type: String, default: null },
        autoResume: { type: Boolean, default: true },
        webhookSecret: { type: String, default: null },
      },
      swiggy: {
        isEnabled: { type: Boolean, default: true },
        autoAccept: { type: Boolean, default: false },
        storeStatus: { type: String, enum: ['ONLINE', 'OFFLINE', 'PAUSED'], default: 'ONLINE' },
        pausedUntil: { type: Date, default: null },
        pauseReason: { type: String, default: null },
        autoResume: { type: Boolean, default: true },
        webhookSecret: { type: String, default: null },
      },
    },
  },
  {
    timestamps: true,
    collection: 'online_channel_configs',
  }
);

onlineChannelConfigSchema.index({ organisationId: 1, cafeId: 1 }, { unique: true });

const OnlineChannelConfig =
  mongoose.models.OnlineChannelConfig ||
  mongoose.model('OnlineChannelConfig', onlineChannelConfigSchema);

module.exports = {
  OnlineChannelConfig,
};
