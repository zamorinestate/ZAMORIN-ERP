'use strict';

/**
 * WAITLIST ENTRY — MONGOOSE MODEL (P15 CHANNELS & FRONT SERVICE)
 *
 * Implements persisted host desk waitlist queue, party seating,
 * safe concurrent transitions, and duplicate seating protection.
 */

const mongoose = require('mongoose');

const WAITLIST_STATUSES = ['WAITING', 'NOTIFIED', 'SEATED', 'CANCELLED', 'NO_SHOW'];

const waitlistEntrySchema = new mongoose.Schema(
  {
    waitlistId: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      uppercase: true,
      index: true,
    },
    queueNumber: {
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
    guestName: {
      type: String,
      required: true,
      trim: true,
    },
    guestPhone: {
      type: String,
      required: true,
      trim: true,
    },
    partySize: {
      type: Number,
      required: true,
      min: 1,
    },
    sectionPreference: {
      type: String,
      trim: true,
      default: 'ANY',
    },
    arrivalTime: {
      type: Date,
      default: Date.now,
      index: true,
    },
    estimatedWaitMinutes: {
      type: Number,
      default: 15,
      min: 0,
    },
    status: {
      type: String,
      enum: WAITLIST_STATUSES,
      default: 'WAITING',
      index: true,
    },
    seatedTableId: {
      type: String,
      trim: true,
      default: null,
    },
    seatedTableNumber: {
      type: String,
      trim: true,
      default: null,
    },
    notifiedAt: {
      type: Date,
      default: null,
    },
    seatedAt: {
      type: Date,
      default: null,
    },
    cancelledAt: {
      type: Date,
      default: null,
    },
    notes: {
      type: String,
      trim: true,
      default: '',
    },
    preOrderItems: {
      type: Array,
      default: [],
    },
    createdByUserId: {
      type: String,
      trim: true,
      default: 'HOST',
    },
  },
  {
    timestamps: true,
    collection: 'waitlist_entries',
  }
);

waitlistEntrySchema.index({ organisationId: 1, waitlistId: 1 }, { unique: true });
waitlistEntrySchema.index({ organisationId: 1, cafeId: 1, status: 1, arrivalTime: 1 });

const WaitlistEntry =
  mongoose.models.WaitlistEntry ||
  mongoose.model('WaitlistEntry', waitlistEntrySchema);

module.exports = {
  WaitlistEntry,
  WAITLIST_STATUSES,
};
