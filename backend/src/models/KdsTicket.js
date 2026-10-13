'use strict';

/**
 * ============================================================================
 * ZAMORIN CAFÉ ERP — KITCHEN DISPLAY SYSTEM (KDS) TICKET MODEL
 * ============================================================================
 * Tracks orders from POS order placement through line cook prep stations,
 * assembly, expediter aggregation, and final guest dispatch/collection.
 *
 * Scoped by organisationId and cafeId to eliminate cross-café leakage.
 */

const mongoose = require('mongoose');

const KDS_STATUSES = [
  'RECEIVED',
  'PREPARING',
  'READY',
  'COLLECTED',
  'CANCELLED',
  'VOIDED',
  'HELD_AWAITING_PAYMENT',
];

const PREP_STATIONS = [
  'HOT_KITCHEN',
  'BEVERAGE_BAR',
  'BAKERY_COLD',
  'DESSERT',
  'EXPEDITER',
  'ALL',
];

const DINING_OPTIONS = [
  'DINE_IN',
  'TAKEAWAY',
  'DELIVERY',
  'COUNTER',
  'ROOM_SERVICE',
];

const PRIORITY_LEVELS = [
  'NORMAL',
  'HIGH',
  'RUSH',
  'VIP',
];

const kdsItemSchema = new mongoose.Schema(
  {
    itemId: {
      type: String,
      required: true,
      trim: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    quantity: {
      type: Number,
      required: true,
      min: 1,
    },
    prepStation: {
      type: String,
      default: 'HOT_KITCHEN',
      trim: true,
      uppercase: true,
    },
    variant: {
      type: String,
      default: '',
      trim: true,
    },
    customizations: [
      {
        type: String,
        trim: true,
      },
    ],
    itemNotes: {
      type: String,
      default: '',
      trim: true,
    },
    allergens: [
      {
        type: String,
        trim: true,
      },
    ],
    isVoided: {
      type: Boolean,
      default: false,
    },
    voidReason: {
      type: String,
      default: '',
      trim: true,
    },
    status: {
      type: String,
      enum: ['PENDING', 'PREPARING', 'COMPLETED', 'CANCELLED', 'VOIDED'],
      default: 'PENDING',
    },
    completedAt: {
      type: Date,
      default: null,
    },
  },
  { _id: true }
);

const kdsTicketSchema = new mongoose.Schema(
  {
    ticketId: {
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

    billId: {
      type: String,
      trim: true,
      index: true,
      default: '',
    },

    posOrderId: {
      type: String,
      trim: true,
      index: true,
      default: '',
    },

    orderNumber: {
      type: String,
      trim: true,
      default: '',
    },

    tableNumber: {
      type: String,
      trim: true,
      default: '',
    },

    diningOption: {
      type: String,
      enum: DINING_OPTIONS,
      default: 'DINE_IN',
    },

    prepStation: {
      type: String,
      default: 'HOT_KITCHEN',
      trim: true,
      uppercase: true,
      index: true,
    },

    status: {
      type: String,
      enum: KDS_STATUSES,
      default: 'RECEIVED',
      index: true,
    },

    priority: {
      type: String,
      enum: PRIORITY_LEVELS,
      default: 'NORMAL',
    },

    targetPrepTimeMinutes: {
      type: Number,
      default: 15,
      min: 1,
    },

    items: [kdsItemSchema],

    specialInstructions: {
      type: String,
      default: '',
      trim: true,
    },

    // A019: KOT ticket number for direct lookup
    kotNumber: {
      type: String,
      trim: true,
      default: null,
      index: true,
    },

    // A032 / F271-F275: Windows KDS Virtual Brand Metadata & Partner Checklist
    virtualBrandName: {
      type: String,
      trim: true,
      default: '',
    },
    isAllVeg: {
      type: Boolean,
      default: false,
    },
    partnerChecklist: [
      {
        item: { type: String, trim: true },
        checked: { type: Boolean, default: false },
      },
    ],

    tags: [
      {
        type: String,
        trim: true,
      },
    ],

    receivedAt: {
      type: Date,
      default: Date.now,
      index: true,
    },

    startedAt: {
      type: Date,
      default: null,
    },

    completedAt: {
      type: Date,
      default: null,
    },

    collectedAt: {
      type: Date,
      default: null,
    },

    cancelledAt: {
      type: Date,
      default: null,
    },

    voidedAt: {
      type: Date,
      default: null,
    },

    bumpedByUserId: {
      type: String,
      trim: true,
      default: '',
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Virtual for calculating ticket age in seconds
kdsTicketSchema.virtual('ticketAgeSeconds').get(function () {
  const end = this.completedAt || new Date();
  const start = this.receivedAt || this.createdAt;
  if (!start) return 0;
  return Math.max(0, Math.floor((new Date(end).getTime() - new Date(start).getTime()) / 1000));
});

// Composite indexes for efficient real-time polling and station filtering
kdsTicketSchema.index(
  { organisationId: 1, cafeId: 1, status: 1, prepStation: 1, createdAt: -1 },
  { name: 'idx_kds_org_cafe_status_station' }
);
kdsTicketSchema.index(
  { organisationId: 1, cafeId: 1, billId: 1 },
  { name: 'idx_kds_org_cafe_bill' }
);
kdsTicketSchema.index(
  { organisationId: 1, cafeId: 1, receivedAt: -1 },
  { name: 'idx_kds_org_cafe_received' }
);

const KdsTicket = mongoose.model('KdsTicket', kdsTicketSchema);

module.exports = {
  KdsTicket,
  KDS_STATUSES,
  PREP_STATIONS,
  DINING_OPTIONS,
  PRIORITY_LEVELS,
};
