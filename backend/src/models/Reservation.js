'use strict';

/**
 * RESERVATION — MONGOOSE MODEL (P15 CHANNELS & FRONT SERVICE)
 *
 * Implements guest reservations, booking validation, conflict prevention,
 * party seating, cancellation, and no-show handling.
 *
 * GOVERNANCE NOTE:
 * Reservations and waitlist entries MUST NOT create sales revenue, paid bills,
 * or inventory movements merely because a booking was made.
 */

const mongoose = require('mongoose');

const RESERVATION_STATUSES = [
  'CONFIRMED',
  'CHECKED_IN',
  'SEATED',
  'COMPLETED',
  'CANCELLED',
  'NO_SHOW',
];

const BOOKING_CHANNELS = ['PHONE', 'WALK_IN', 'DIRECT_WEB', 'AGGREGATOR'];

const reservationAuditEntrySchema = new mongoose.Schema(
  {
    action: { type: String, required: true },
    actorUserId: { type: String, required: true },
    timestamp: { type: Date, default: Date.now },
    notes: { type: String, default: '' },
  },
  { _id: false }
);

const reservationSchema = new mongoose.Schema(
  {
    reservationId: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      uppercase: true,
      index: true,
    },
    bookingReference: {
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
    },
    cafeId: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
      index: true,
    },
    guestName: {
      type: String,
      required: true,
      trim: true,
    },
    guestPhone: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    guestEmail: {
      type: String,
      trim: true,
      default: '',
    },
    partySize: {
      type: Number,
      required: true,
      min: 1,
    },
    bookingTime: {
      type: Date,
      required: true,
      index: true,
    },
    durationMinutes: {
      type: Number,
      default: 90,
      min: 15,
    },
    sectionPreference: {
      type: String,
      trim: true,
      default: 'ANY',
    },
    specialRequests: {
      type: String,
      trim: true,
      default: '',
    },
    sourceChannel: {
      type: String,
      enum: BOOKING_CHANNELS,
      default: 'PHONE',
    },
    status: {
      type: String,
      enum: RESERVATION_STATUSES,
      default: 'CONFIRMED',
      index: true,
    },
    assignedTableId: {
      type: String,
      trim: true,
      default: null,
    },
    assignedTableNumber: {
      type: String,
      trim: true,
      default: null,
    },
    checkedInAt: {
      type: Date,
      default: null,
    },
    seatedAt: {
      type: Date,
      default: null,
    },
    completedAt: {
      type: Date,
      default: null,
    },
    cancelledAt: {
      type: Date,
      default: null,
    },
    cancellationReason: {
      type: String,
      default: null,
    },
    depositAmountPaisa: {
      type: Number,
      default: 0,
      min: 0,
    },
    advanceDepositId: {
      type: String,
      trim: true,
      default: null,
    },
    history: {
      type: [reservationAuditEntrySchema],
      default: [],
    },
  },
  {
    timestamps: true,
    collection: 'reservations',
  }
);

reservationSchema.index({ organisationId: 1, reservationId: 1 }, { unique: true });
reservationSchema.index({ organisationId: 1, bookingReference: 1 }, { unique: true });
reservationSchema.index({ organisationId: 1, cafeId: 1, bookingTime: 1, status: 1 });

const Reservation =
  mongoose.models.Reservation ||
  mongoose.model('Reservation', reservationSchema);

module.exports = {
  Reservation,
  RESERVATION_STATUSES,
  BOOKING_CHANNELS,
};
