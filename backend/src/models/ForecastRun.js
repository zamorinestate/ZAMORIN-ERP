'use strict';

/**
 * ============================================================================
 * ZAMORIN CAFÉ ERP — FORECAST RUN MODEL (PACKAGE P17)
 * ============================================================================
 * Authoritative persisted model for sales and item-demand forecasting runs.
 * Supports configurable horizons, statistical methods (Day-of-Week Seasonality,
 * Moving Averages), confidence bands, and explicit data quality/sparsity statuses.
 *
 * CRITICAL GOVERNANCE INVARIANTS:
 * 1. Forecasts are strictly ADVISORY.
 *    Forecast runs NEVER mutate sales bills, menu prices, inventory ledgers,
 *    or create purchase orders.
 * 2. Unsubstantiated precision is forbidden. Sparse or incomplete history
 *    produces explicit statuses (INSUFFICIENT_HISTORY, DATA_QUALITY_WARNING).
 */

const mongoose = require('mongoose');

const FORECAST_STATUSES = [
  'READY',
  'INSUFFICIENT_HISTORY',
  'DATA_QUALITY_WARNING',
  'FAILED',
];

const FORECAST_METHODS = [
  'DAY_OF_WEEK_SEASONAL',
  'MOVING_AVERAGE',
  'TREND_ADJUSTED',
];

const FORECAST_TYPES = [
  'SALES_REVENUE',
  'ITEM_DEMAND',
  'COMBINED',
];

const channelPredictionSchema = new mongoose.Schema(
  {
    channel: { type: String, required: true, trim: true, uppercase: true },
    predictedRevenuePaisa: { type: Number, required: true, min: 0, default: 0 },
    percentageOfTotal: { type: Number, default: 0 },
  },
  { _id: false }
);

const dailyRevenuePredictionSchema = new mongoose.Schema(
  {
    date: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    dayOfWeek: { type: String, required: true, uppercase: true },
    predictedRevenuePaisa: { type: Number, required: true, min: 0, default: 0 },
    confidenceLowPaisa: { type: Number, required: true, min: 0, default: 0 },
    confidenceHighPaisa: { type: Number, required: true, min: 0, default: 0 },
    channelBreakdown: { type: [channelPredictionSchema], default: [] },
  },
  { _id: false }
);

const itemDemandPredictionSchema = new mongoose.Schema(
  {
    menuItemId: { type: String, required: true, trim: true, uppercase: true },
    itemName: { type: String, required: true, trim: true },
    category: { type: String, required: true, trim: true, uppercase: true },
    date: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    predictedQuantity: { type: Number, required: true, min: 0, default: 0 },
    confidenceLowQty: { type: Number, required: true, min: 0, default: 0 },
    confidenceHighQty: { type: Number, required: true, min: 0, default: 0 },
  },
  { _id: false }
);

const forecastRunSchema = new mongoose.Schema(
  {
    forecastId: {
      type: String,
      required: true,
      unique: true,
      immutable: true,
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
      default: 'ZAMORIN',
    },

    cafeId: {
      type: String,
      trim: true,
      uppercase: true,
      default: null, // null indicates enterprise consolidated
      index: true,
    },

    forecastType: {
      type: String,
      enum: FORECAST_TYPES,
      default: 'COMBINED',
      index: true,
    },

    method: {
      type: String,
      enum: FORECAST_METHODS,
      required: true,
      default: 'DAY_OF_WEEK_SEASONAL',
    },

    methodRationale: {
      type: String,
      trim: true,
      default: '',
    },

    horizonDays: {
      type: Number,
      required: true,
      min: 1,
      max: 90,
      default: 7,
    },

    cutoffDate: {
      type: String,
      required: true,
      match: /^\d{4}-\d{2}-\d{2}$/,
    },

    observationWindowDays: {
      type: Number,
      required: true,
      min: 1,
      default: 28,
    },

    eligibleObservationsCount: {
      type: Number,
      default: 0,
      min: 0,
    },

    status: {
      type: String,
      enum: FORECAST_STATUSES,
      required: true,
      default: 'READY',
      index: true,
    },

    warningDetails: {
      type: [String],
      default: [],
    },

    revenuePredictions: {
      type: [dailyRevenuePredictionSchema],
      default: [],
    },

    itemDemandPredictions: {
      type: [itemDemandPredictionSchema],
      default: [],
    },

    summary: {
      totalPredictedRevenuePaisa: { type: Number, default: 0 },
      avgDailyRevenuePaisa: { type: Number, default: 0 },
      totalPredictedItemsCount: { type: Number, default: 0 },
      topDemandItems: [
        {
          menuItemId: { type: String, trim: true, uppercase: true },
          itemName: { type: String, trim: true },
          category: { type: String, trim: true },
          totalPredictedQuantity: { type: Number, default: 0 },
        },
      ],
    },

    metadata: {
      calculationVersion: { type: String, default: 'P17-V1.0' },
      isAdvisoryOnly: { type: Boolean, default: true },
      confidenceLevelPercent: { type: Number, default: 80 },
    },

    generatedByUserId: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
    },

    generatedAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
  },
  {
    timestamps: true,
    collection: 'forecast_runs',
  }
);

forecastRunSchema.index(
  { organisationId: 1, cafeId: 1, generatedAt: -1 },
  { name: 'idx_forecast_org_cafe_date' }
);

forecastRunSchema.index(
  { organisationId: 1, status: 1 },
  { name: 'idx_forecast_org_status' }
);

forecastRunSchema.pre('validate', function normaliseFields() {
  if (this.organisationId) this.organisationId = this.organisationId.trim().toUpperCase();
  if (this.cafeId) this.cafeId = this.cafeId.trim().toUpperCase();
  if (this.forecastId) this.forecastId = this.forecastId.trim().toUpperCase();
  if (this.generatedByUserId) this.generatedByUserId = this.generatedByUserId.trim().toUpperCase();
});

const ForecastRun =
  mongoose.models.ForecastRun ||
  mongoose.model('ForecastRun', forecastRunSchema);

module.exports = {
  ForecastRun,
  FORECAST_STATUSES,
  FORECAST_METHODS,
  FORECAST_TYPES,
};
