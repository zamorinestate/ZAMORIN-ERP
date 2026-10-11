'use strict';

/**
 * CHANNEL ORDER — MONGOOSE MODEL (P15 CHANNELS & ONLINE ORDERING)
 *
 * Implements the authoritative lifecycle for channel-sourced orders:
 *   - Direct Website Ordering (Takeaway & Delivery)
 *   - Customer-facing QR Table Orders
 *   - Captain Tableside Orders
 *   - Aggregator Webhook Intake (Zomato / Swiggy)
 *
 * Enforces server-side validated state machine transitions, actor attribution,
 * immutable pricing snapshots, and linkage to canonical P09 POS Bills.
 */

const mongoose = require('mongoose');

const ORDER_CHANNELS = [
  'POS',
  'TABLE_SERVICE',
  'QR_ORDER',
  'DIRECT_WEB',
  'AGGREGATOR',
];

const FULFILMENT_MODES = [
  'DINE_IN',
  'TAKEAWAY',
  'DELIVERY',
  'SCHEDULED_PICKUP',
];

const ORDER_STATUSES = [
  'RECEIVED',
  'ACCEPTED',
  'PREPARING',
  'READY_FOR_PICKUP',
  'DISPATCHED',
  'COMPLETED',
  'REJECTED',
  'CANCELLED',
];

const PAYMENT_STATES = [
  'UNPAID',
  'PENDING',
  'PAID',
  'REFUNDED',
  'FAILED',
];

const channelOrderLineItemSchema = new mongoose.Schema(
  {
    menuItemId: { type: String, required: true, trim: true, uppercase: true },
    itemNameSnapshot: { type: String, required: true, trim: true },
    quantity: { type: Number, required: true, min: 1 },
    unitPricePaisa: { type: Number, required: true, min: 0 },
    lineSubtotalPaisa: { type: Number, required: true, min: 0 },
    taxRatePercent: { type: Number, default: 5, min: 0 },
    cgstPaisa: { type: Number, default: 0, min: 0 },
    sgstPaisa: { type: Number, default: 0, min: 0 },
    lineTotalPaisa: { type: Number, required: true, min: 0 },
    modifiers: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
    variantSnapshot: { type: mongoose.Schema.Types.Mixed, default: null },
    comboSnapshot: { type: mongoose.Schema.Types.Mixed, default: null },
    itemNotes: { type: String, trim: true, default: '' },
  },
  { _id: true }
);

const orderLifecycleHistorySchema = new mongoose.Schema(
  {
    status: { type: String, required: true },
    actorUserId: { type: String, required: true },
    timestamp: { type: Date, default: Date.now },
    notes: { type: String, default: '' },
  },
  { _id: false }
);

const channelOrderSchema = new mongoose.Schema(
  {
    orderId: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      uppercase: true,
      index: true,
    },
    orderNumber: {
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
    channel: {
      type: String,
      enum: ORDER_CHANNELS,
      required: true,
      index: true,
    },
    provider: {
      type: String,
      trim: true,
      default: null, // 'ZOMATO', 'SWIGGY', or null for direct
      index: true,
    },
    externalOrderId: {
      type: String,
      trim: true,
      default: null,
      index: true,
    },
    fulfilmentMode: {
      type: String,
      enum: FULFILMENT_MODES,
      default: 'TAKEAWAY',
      index: true,
    },
    tableNumber: {
      type: String,
      trim: true,
      default: null,
    },
    tableSessionId: {
      type: String,
      trim: true,
      default: null,
    },
    customer: {
      name: { type: String, trim: true, default: 'Guest' },
      phone: { type: String, trim: true, default: '' },
      email: { type: String, trim: true, default: '' },
      deliveryAddress: { type: String, trim: true, default: '' },
    },
    lineItems: {
      type: [channelOrderLineItemSchema],
      required: true,
      validate: {
        validator: (v) => Array.isArray(v) && v.length > 0,
        message: 'Order must contain at least one line item.',
      },
    },
    pricing: {
      subtotalPaisa: { type: Number, required: true, min: 0 },
      discountPaisa: { type: Number, default: 0, min: 0 },
      deliveryFeePaisa: { type: Number, default: 0, min: 0 },
      packagingFeePaisa: { type: Number, default: 0, min: 0 },
      taxPaisa: { type: Number, default: 0, min: 0 },
      roundOffPaisa: { type: Number, default: 0 },
      totalPaisa: { type: Number, required: true, min: 0 },
    },
    paymentState: {
      type: String,
      enum: PAYMENT_STATES,
      default: 'PENDING',
      index: true,
    },
    paymentMethod: {
      type: String,
      default: 'CASH',
    },
    paymentReference: {
      type: String,
      trim: true,
      default: '',
    },
    status: {
      type: String,
      enum: ORDER_STATUSES,
      default: 'RECEIVED',
      index: true,
    },
    pickupTokenNumber: {
      type: String,
      trim: true,
      default: null,
    },
    pickupTokenId: {
      type: String,
      trim: true,
      default: null,
    },
    rejectionReason: {
      type: String,
      default: null,
    },
    cancellationReason: {
      type: String,
      default: null,
    },
    lifecycleHistory: {
      type: [orderLifecycleHistorySchema],
      default: [],
    },
    canonicalBillId: {
      type: String,
      trim: true,
      default: null,
      index: true,
    },
    idempotencyKey: {
      type: String,
      trim: true,
      default: null,
      index: true,
    },
    receivedAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
    acceptedAt: {
      type: Date,
      default: null,
    },
    readyAt: {
      type: Date,
      default: null,
    },
    dispatchedAt: {
      type: Date,
      default: null,
    },
    completedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
    collection: 'channel_orders',
  }
);

channelOrderSchema.index({ organisationId: 1, orderId: 1 }, { unique: true });
channelOrderSchema.index({ organisationId: 1, cafeId: 1, status: 1, receivedAt: -1 });
channelOrderSchema.index({ organisationId: 1, cafeId: 1, channel: 1, status: 1 });
channelOrderSchema.index(
  { organisationId: 1, cafeId: 1, idempotencyKey: 1 },
  { unique: true, sparse: true }
);

const ChannelOrder =
  mongoose.models.ChannelOrder ||
  mongoose.model('ChannelOrder', channelOrderSchema);

module.exports = {
  ChannelOrder,
  ORDER_CHANNELS,
  FULFILMENT_MODES,
  ORDER_STATUSES,
  PAYMENT_STATES,
};
