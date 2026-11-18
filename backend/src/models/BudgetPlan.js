'use strict';

/**
 * ============================================================================
 * ZAMORIN CAFÉ ERP — BUDGET PLAN MODEL (STAGE 03)
 * ============================================================================
 * Immutable versioned budgets distinguishing Budget targets from Actuals,
 * Forecasts, and Scenarios.
 */

const mongoose = require('mongoose');

const BUDGET_STATUSES = [
  'DRAFT',
  'UNDER_REVIEW',
  'APPROVED',
  'SUPERSEDED',
  'LOCKED',
];

const BUDGET_CATEGORIES = [
  'SALES',
  'PAYROLL',
  'OPERATING_EXPENSES',
  'UTILITIES',
  'MAINTENANCE',
  'PROCUREMENT',
  'CAPEX',
  'CASH_REQUIREMENTS',
];

const budgetLineSchema = new mongoose.Schema(
  {
    category: {
      type: String,
      required: true,
      trim: true,
    },
    plannedAmountPaisa: {
      type: Number,
      required: true,
      min: 0,
      default: 0,
    },
    notes: {
      type: String,
      trim: true,
      default: '',
    },
  },
  { _id: false }
);

const budgetPlanSchema = new mongoose.Schema(
  {
    budgetId: {
      type: String,
      required: true,
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
      trim: true,
      uppercase: true,
      default: null, // null indicates enterprise/portfolio-wide budget
      index: true,
    },
    fiscalYear: {
      type: String,
      required: true,
      trim: true, // e.g. 'FY2026-27'
      index: true,
    },
    periodType: {
      type: String,
      enum: ['ANNUAL', 'MONTHLY'],
      default: 'ANNUAL',
    },
    month: {
      type: Number, // 1 to 12 if periodType === 'MONTHLY'
      min: 1,
      max: 12,
      default: null,
    },
    version: {
      type: Number,
      required: true,
      default: 1,
      min: 1,
    },
    status: {
      type: String,
      enum: BUDGET_STATUSES,
      default: 'DRAFT',
      index: true,
    },
    lines: {
      type: [budgetLineSchema],
      default: [],
    },
    totalPlannedPaisa: {
      type: Number,
      default: 0,
    },
    approvedByUserId: {
      type: String,
      trim: true,
      default: null,
    },
    approvedAt: {
      type: Date,
      default: null,
    },
    isLocked: {
      type: Boolean,
      default: false,
      index: true,
    },
    auditHistory: [
      {
        action: { type: String, required: true },
        performedBy: { type: String, required: true },
        performedAt: { type: Date, default: Date.now },
        notes: { type: String, default: '' },
      },
    ],
  },
  {
    timestamps: true,
    toObject: { virtuals: true },
    toJSON: { virtuals: true },
  }
);

budgetPlanSchema.index(
  { organisationId: 1, fiscalYear: 1, cafeId: 1, version: 1 },
  { unique: true }
);

const BudgetPlan =
  mongoose.models.BudgetPlan ||
  mongoose.model('BudgetPlan', budgetPlanSchema);

module.exports = {
  BudgetPlan,
  BUDGET_STATUSES,
  BUDGET_CATEGORIES,
};
