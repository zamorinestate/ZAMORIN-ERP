'use strict';

const mongoose = require('mongoose');

const customerSegmentSchema = new mongoose.Schema(
  {
    segmentId: {
      type: String,
      required: true,
      unique: true,
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
      trim: true,
      uppercase: true,
      default: null,
      index: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 120,
    },
    description: {
      type: String,
      trim: true,
      maxlength: 500,
      default: '',
    },
    rules: {
      minVisitsPerMonth: { type: Number, min: 0, default: 0 },
      minSpendPaisa: { type: Number, min: 0, default: 0 },
      maxDaysSinceLastVisit: { type: Number, min: 0, default: 0 },
    },
    createdBy: {
      type: String,
      trim: true,
      default: null,
    },
    status: {
      type: String,
      enum: ['ACTIVE', 'ARCHIVED'],
      default: 'ACTIVE',
    },
  },
  {
    timestamps: true,
    collection: 'customer_segments',
  }
);

customerSegmentSchema.index({ organisationId: 1, cafeId: 1, name: 1 }, { unique: true });

const CustomerSegment =
  mongoose.models.CustomerSegment ||
  mongoose.model('CustomerSegment', customerSegmentSchema);

module.exports = { CustomerSegment };