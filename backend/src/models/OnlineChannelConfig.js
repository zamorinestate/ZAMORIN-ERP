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
    },
    aggregators: {
      zomato: {
        isEnabled: { type: Boolean, default: true },
        autoAccept: { type: Boolean, default: false },
        storeStatus: { type: String, enum: ['ONLINE', 'OFFLINE', 'PAUSED'], default: 'ONLINE' },
        webhookSecret: { type: String, default: null },
      },
      swiggy: {
        isEnabled: { type: Boolean, default: true },
        autoAccept: { type: Boolean, default: false },
        storeStatus: { type: String, enum: ['ONLINE', 'OFFLINE', 'PAUSED'], default: 'ONLINE' },
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
