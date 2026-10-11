'use strict';

/**
 * ============================================================================
 * ZAMORIN CAFÉ ERP — FORECAST EVALUATION MODEL (PACKAGE P17)
 * ============================================================================
 * Persisted model for historical holdout evaluations and rolling-origin accuracy
 * checks. Compares forecasted demand/revenue against observed actuals.
 *
 * CRITICAL GOVERNANCE INVARIANTS:
 * 1. Zero data leakage: Evaluation training inputs are strictly bounded by the
 *    historical cutoff date; future holdout observations are never seen.
 * 2. Zero-division safety: When actual denominator is zero, WAPE and percentage
 *    errors are handled explicitly and safely.
 * 3. Accuracy is never claimed without comparison against simple naive baseline.
 */

const mongoose = require('mongoose');

const EVALUATION_STATUSES = [
  'VALID',
  'SPARSE_DATA',
  'ZERO_OBSERVATIONS',
  'INSUFFICIENT_HOLDOUT',
];

const actualVsPredictedSchema = new mongoose.Schema(
  {
    date: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    dayOfWeek: { type: String, default: '' },
    actualValue: { type: Number, required: true, min: 0 },
    predictedValue: { type: Number, required: true, min: 0 },
    error: { type: Number, required: true }, // actual - predicted
    absoluteError: { type: Number, required: true, min: 0 },
    percentageError: { type: Number, default: null }, // null if actual is 0
  },
  { _id: false }
);

const forecastEvaluationSchema = new mongoose.Schema(
  {
    evaluationId: {
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
      default: null,
      index: true,
    },

    forecastId: {
      type: String,
      trim: true,
      uppercase: true,
      default: null,
      index: true,
    },

    targetMetric: {
      type: String,
      enum: ['SALES_REVENUE', 'ITEM_DEMAND'],
      required: true,
      default: 'SALES_REVENUE',
    },

    methodEvaluated: {
      type: String,
      required: true,
      trim: true,
      default: 'DAY_OF_WEEK_SEASONAL',
    },

    baselineMethod: {
      type: String,
      required: true,
      default: 'NAIVE_PREVIOUS_PERIOD',
    },

    holdoutWindow: {
      startDate: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
      endDate: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
      days: { type: Number, required: true, min: 1 },
    },

    trainingCutoffDate: {
      type: String,
      required: true,
      match: /^\d{4}-\d{2}-\d{2}$/,
    },

    observationsCount: {
      type: Number,
      required: true,
      min: 0,
    },

    mae: {
      type: Number,
      required: true,
      min: 0,
      default: 0,
      description: 'Mean Absolute Error in paisa or units',
    },

    wapePercent: {
      type: Number,
      required: true,
      min: 0,
      default: 0,
      description: 'Weighted Absolute Percentage Error: (Sum(|Actual - Pred|) / Sum(Actual)) * 100',
    },

    baselineMae: {
      type: Number,
      required: true,
      min: 0,
      default: 0,
      description: 'Naive baseline MAE',
    },

    maeImprovementPercent: {
      type: Number,
      default: 0,
      description: '((baselineMae - mae) / baselineMae) * 100, positive means model is better',
    },

    status: {
      type: String,
      enum: EVALUATION_STATUSES,
      required: true,
      default: 'VALID',
      index: true,
    },

    actualVsPredicted: {
      type: [actualVsPredictedSchema],
      default: [],
    },

    notes: {
      type: String,
      trim: true,
      default: '',
    },

    evaluatedByUserId: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
    },

    evaluatedAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
  },
  {
    timestamps: true,
    collection: 'forecast_evaluations',
  }
);

forecastEvaluationSchema.index(
  { organisationId: 1, cafeId: 1, evaluatedAt: -1 },
  { name: 'idx_eval_org_cafe_date' }
);

forecastEvaluationSchema.pre('validate', function normaliseFields() {
  if (this.organisationId) this.organisationId = this.organisationId.trim().toUpperCase();
  if (this.cafeId) this.cafeId = this.cafeId.trim().toUpperCase();
  if (this.evaluationId) this.evaluationId = this.evaluationId.trim().toUpperCase();
  if (this.forecastId) this.forecastId = this.forecastId.trim().toUpperCase();
  if (this.evaluatedByUserId) this.evaluatedByUserId = this.evaluatedByUserId.trim().toUpperCase();
});

const ForecastEvaluation =
  mongoose.models.ForecastEvaluation ||
  mongoose.model('ForecastEvaluation', forecastEvaluationSchema);

module.exports = {
  ForecastEvaluation,
  EVALUATION_STATUSES,
};
