'use strict';

/**
 * GOOGLE BUSINESS PROFILE MODEL (BENCHMARK A005 & A006)
 *
 * Implements Google Business Profile integration:
 *   - Outlet GBP location connection & profile sync
 *   - Performance insights & metrics (Search views, Maps views, calls, directions)
 *   - Google customer review sync and governed owner/manager replies
 */

const mongoose = require('mongoose');

const reviewReplySchema = new mongoose.Schema(
  {
    comment: { type: String, required: true, trim: true, maxlength: 4096 },
    repliedAt: { type: Date, default: Date.now },
    repliedByUserId: { type: String, required: true, trim: true, uppercase: true },
  },
  { _id: false }
);

const googleReviewSchema = new mongoose.Schema(
  {
    reviewId: { type: String, required: true, trim: true },
    reviewerName: { type: String, required: true, trim: true },
    starRating: { type: Number, required: true, min: 1, max: 5 },
    comment: { type: String, trim: true, default: '' },
    reviewDate: { type: Date, default: Date.now },
    reply: { type: reviewReplySchema, default: null },
  },
  { _id: false }
);

const googleBusinessProfileSchema = new mongoose.Schema(
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
    locationId: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    accountName: {
      type: String,
      trim: true,
      default: '',
    },
    displayName: {
      type: String,
      required: true,
      trim: true,
    },
    primaryPhone: {
      type: String,
      trim: true,
      default: '',
    },
    addressLine: {
      type: String,
      trim: true,
      default: '',
    },
    syncStatus: {
      type: String,
      enum: ['CONNECTED', 'DISCONNECTED', 'SYNCING', 'ERROR'],
      default: 'CONNECTED',
      index: true,
    },
    lastSyncedAt: {
      type: Date,
      default: Date.now,
    },
    metrics: {
      viewsSearch: { type: Number, default: 0, min: 0 },
      viewsMaps: { type: Number, default: 0, min: 0 },
      actionsWebsite: { type: Number, default: 0, min: 0 },
      actionsCalls: { type: Number, default: 0, min: 0 },
      actionsDrivingDirections: { type: Number, default: 0, min: 0 },
    },
    reviews: {
      type: [googleReviewSchema],
      default: [],
    },
  },
  {
    timestamps: true,
  }
);

googleBusinessProfileSchema.index({ organisationId: 1, cafeId: 1 }, { unique: true });

const GoogleBusinessProfile =
  mongoose.models.GoogleBusinessProfile ||
  mongoose.model('GoogleBusinessProfile', googleBusinessProfileSchema);

module.exports = {
  GoogleBusinessProfile,
  googleBusinessProfileSchema,
};
