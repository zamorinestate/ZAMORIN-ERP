'use strict';

/**
 * STATUTORY RULE — MONGOOSE MODEL (P1-B)
 *
 * Implements effective-dated statutory compliance configurations:
 * - EPF (Employees' Provident Fund Act 1952)
 * - ESI (Employees' State Insurance Act 1948)
 * - Professional Tax (State-specific slabs: Kerala, Karnataka, etc.)
 * - Income Tax TDS (Section 192)
 *
 * Rules resolve according to the payroll period / effective date.
 * A historical payroll run (e.g., March 2026) always resolves the rule
 * that was effective in March 2026, even if a higher ceiling becomes
 * active at a later date.
 */

const crypto = require('crypto');
const mongoose = require('mongoose');

const STATUTORY_RULE_TYPES = [
  'EPF',
  'ESI',
  'PROFESSIONAL_TAX',
  'TDS',
  'GRATUITY',
  'BONUS',
];

const statutoryRuleSchema = new mongoose.Schema(
  {
    ruleId: {
      type: String,
      unique: true,
      trim: true,
      uppercase: true,
      index: true,
      default: () => 'RULE-' + crypto.randomUUID().toUpperCase(),
    },
    organisationId: {
      type: String,
      default: 'GLOBAL',
      trim: true,
      uppercase: true,
      index: true,
    },
    ruleType: {
      type: String,
      required: true,
      enum: STATUTORY_RULE_TYPES,
      index: true,
    },
    jurisdiction: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
      default: 'ALL_INDIA',
      index: true,
    },
    effectiveFrom: {
      type: Date,
      required: true,
      index: true,
    },
    effectiveTo: {
      type: Date,
      default: null,
      index: true,
    },
    employeeRate: {
      type: Number,
      default: 0,
      min: 0,
    },
    employerRate: {
      type: Number,
      default: 0,
      min: 0,
    },
    wageCeilingPaise: {
      type: Number,
      default: 0,
      min: 0,
    },
    eligibilityThresholdPaise: {
      type: Number,
      default: 0,
      min: 0,
    },
    configuration: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    version: {
      type: Number,
      default: 1,
      min: 1,
    },
    sourceReference: {
      type: String,
      trim: true,
      default: '',
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
    createdBy: {
      type: String,
      trim: true,
      default: 'SYSTEM',
    },
    approvedBy: {
      type: String,
      trim: true,
      default: 'SYSTEM',
    },
    auditMetadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  {
    timestamps: true,
    collection: 'statutory_rules',
  }
);

statutoryRuleSchema.index(
  { ruleType: 1, jurisdiction: 1, effectiveFrom: 1, effectiveTo: 1, isActive: 1 },
  { name: 'idx_statutory_rule_resolution' }
);

/**
 * Resolves the statutory rule applicable on a specific date for a jurisdiction.
 */
statutoryRuleSchema.statics.findEffectiveRule = async function ({
  ruleType,
  jurisdiction = 'ALL_INDIA',
  effectiveDate = new Date(),
  organisationId = 'GLOBAL',
}) {
  const targetDate = effectiveDate instanceof Date ? effectiveDate : new Date(effectiveDate);
  const normJurisdiction = String(jurisdiction || 'ALL_INDIA').trim().toUpperCase();

  const query = {
    ruleType,
    organisationId: { $in: [organisationId, 'GLOBAL'] },
    jurisdiction: { $in: [normJurisdiction, 'ALL_INDIA'] },
    isActive: true,
    effectiveFrom: { $lte: targetDate },
    $or: [{ effectiveTo: null }, { effectiveTo: { $gte: targetDate } }],
  };

  const rules = await this.find(query)
    .sort({ jurisdiction: normJurisdiction === 'ALL_INDIA' ? 1 : -1, effectiveFrom: -1 })
    .lean();

  if (!rules || rules.length === 0) return null;

  // Prefer exact jurisdiction match over ALL_INDIA fallback
  const exact = rules.find((r) => r.jurisdiction === normJurisdiction);
  return exact || rules[0];
};

/**
 * Baseline Seed Helper: seeds default statutory rules reproducing existing frozen behavior.
 */
statutoryRuleSchema.statics.seedBaselineRules = async function (actor = 'SYSTEM') {
  const baselineRules = [
    {
      ruleId: 'RULE-EPF-BASELINE-2020',
      organisationId: 'GLOBAL',
      ruleType: 'EPF',
      jurisdiction: 'ALL_INDIA',
      effectiveFrom: new Date('2020-01-01T00:00:00.000Z'),
      effectiveTo: null,
      employeeRate: 0.12,
      employerRate: 0.12,
      wageCeilingPaise: 1500000,
      eligibilityThresholdPaise: 1500000,
      configuration: {
        employerPfRate: 0.0367,
        employerEpsRate: 0.0833,
        epsMaxContributionPaise: 125000,
        epsMaxAge: 58,
      },
      version: 1,
      sourceReference: 'Employees Provident Funds and Miscellaneous Provisions Act, 1952 Para 29',
      isActive: true,
      createdBy: actor,
      approvedBy: actor,
    },
    {
      ruleId: 'RULE-ESI-BASELINE-2020',
      organisationId: 'GLOBAL',
      ruleType: 'ESI',
      jurisdiction: 'ALL_INDIA',
      effectiveFrom: new Date('2020-01-01T00:00:00.000Z'),
      effectiveTo: null,
      employeeRate: 0.0075,
      employerRate: 0.0325,
      wageCeilingPaise: 2100000,
      eligibilityThresholdPaise: 2100000,
      configuration: {
        standardWageCeilingPaise: 2100000,
        disabledWageCeilingPaise: 2500000,
      },
      version: 1,
      sourceReference: 'Employees State Insurance Act, 1948 Rule 50 & Notification S.O. 1024(E)',
      isActive: true,
      createdBy: actor,
      approvedBy: actor,
    },
    {
      ruleId: 'RULE-PT-KERALA-BASELINE-2020',
      organisationId: 'GLOBAL',
      ruleType: 'PROFESSIONAL_TAX',
      jurisdiction: 'KERALA',
      effectiveFrom: new Date('2020-01-01T00:00:00.000Z'),
      effectiveTo: null,
      employeeRate: 0,
      employerRate: 0,
      wageCeilingPaise: 0,
      eligibilityThresholdPaise: 1200000,
      configuration: {
        slabs: [
          { minGrossPaise: 0, maxGrossPaise: 1199999, taxPaise: 0 },
          { minGrossPaise: 1200000, maxGrossPaise: 1799999, taxPaise: 12000 },
          { minGrossPaise: 1800000, maxGrossPaise: 2999999, taxPaise: 18000 },
          { minGrossPaise: 3000000, maxGrossPaise: 4499999, taxPaise: 25000 },
          { minGrossPaise: 4500000, maxGrossPaise: null, taxPaise: 30000 },
        ],
      },
      version: 1,
      sourceReference: 'Kerala Municipality Act 1994 (Section 245) & Kerala Panchayat Raj Act 1994',
      isActive: true,
      createdBy: actor,
      approvedBy: actor,
    },
    {
      ruleId: 'RULE-PT-KARNATAKA-BASELINE-2020',
      organisationId: 'GLOBAL',
      ruleType: 'PROFESSIONAL_TAX',
      jurisdiction: 'KARNATAKA',
      effectiveFrom: new Date('2020-01-01T00:00:00.000Z'),
      effectiveTo: null,
      employeeRate: 0,
      employerRate: 0,
      wageCeilingPaise: 0,
      eligibilityThresholdPaise: 1500000,
      configuration: {
        slabs: [
          { minGrossPaise: 0, maxGrossPaise: 1499999, taxPaise: 0 },
          { minGrossPaise: 1500000, maxGrossPaise: null, taxPaise: 20000 },
        ],
      },
      version: 1,
      sourceReference: 'Karnataka Tax on Professions, Trades, Callings and Employments Act, 1976',
      isActive: true,
      createdBy: actor,
      approvedBy: actor,
    },
  ];

  const inserted = [];
  for (const rule of baselineRules) {
    const doc = await this.findOneAndUpdate(
      { ruleId: rule.ruleId },
      { $setOnInsert: rule },
      { upsert: true, returnDocument: 'after' }
    );
    inserted.push(doc);
  }

  return inserted;
};

const StatutoryRule =
  mongoose.models.StatutoryRule ||
  mongoose.model('StatutoryRule', statutoryRuleSchema);

module.exports = {
  StatutoryRule,
  STATUTORY_RULE_TYPES,
};
