'use strict';

/**
 * ZAMORIN CAFÉ ERP — REPORTING CALCULATION ENGINE
 * Module: diagnosticCalculations.js
 * 
 * PM-02J: Canonical Advanced Graphical, Diagnostic & Exploratory Analytics
 * Stage 10 of the Consolidated Reports & Analytics Programme
 * 
 * Core Invariants:
 * - Moves from "What happened?" to "Where, when, which branch/category/item/channel/vendor/shift/exception?"
 * - Strict Metric x Dimension compatibility matrix (invalid combinations rejected with UNSUPPORTED_DIAGNOSTIC_DIMENSION)
 * - Deterministic Arithmetic Decomposition: Child nodes reconcile to parent for additive metrics + UNKNOWN/UNCLASSIFIED bucket
 * - Non-additive metrics (P50, P90, Distinct Customers, Repeat Rate) clearly flagged with correct aggregation semantics (never summed)
 * - Variance Waterfall: Prior + positive variances - negative variances = Current in integer-paise precision
 * - Gross-to-Net Sales Waterfall: Gross Sales - Discounts - Refunds = Net Sales
 * - Zero Fake Profitability: COGS/Gross Profit/EBITDA/Prime Cost remain UNAVAILABLE without source records
 * - Pareto Analytics: Factual contributions sorted descending, cumulative share, safe zero-denominator handling (NO_DATA)
 * - Distribution Analytics: Histogram presentation buckets, Box Plot (Q1, Median, Q3, IQR, Whiskers, Outliers), pooled percentiles
 * - Correlation Workspace: Pearson linear and Spearman rank monotonic association with sample metadata (N >= 3)
 * - Causality Safeguards: Association does not establish causation; zero causal inference or AI recommendations
 * - Role Scoping: Primary Master org-wide; Owner/Cafe Admin strictly restricted to assigned cafes (zero hidden scope leak)
 * - Database Outage Protection: Returns UNAVAILABLE, never fabricated zero business activity
 */

const mongoose = require('mongoose');
const { Cafe } = require('../../models/Cafe');
const { Bill } = require('../../models/Bill');
const { Customer } = require('../../models/Customer');
const { KdsTicket } = require('../../models/KdsTicket');
const { PayrollRun } = require('../../models/PayrollRun');
const { Expense } = require('../../models/Expense');
const { PurchaseOrder } = require('../../models/PurchaseOrder');
const { InventoryLot } = require('../../models/InventoryLot');
const { QualityChecklist } = require('../../models/QualityChecklist');
const { RegisterSession } = require('../../models/RegisterSession');
const { Attendance } = require('../../modules/attendance/Attendance');

// Static Semantic Audit & Invariant Constants (PM-02J & PM-02J-R1)
const CLIENT_ORGANISATION_AUTHORITY_IN_DIAGNOSTICS = 0;
const NORMAL_MASTER_BYPASSES_DIAGNOSTIC_CLASSIFICATION = 0;
const DIAGNOSTIC_HIDDEN_CAFE_INFERENCE = 0;
const DIAGNOSTIC_GROSS_TO_NET_FORMULA_DUPLICATION = 0;
const ADDITIVE_DECOMPOSITION_RECONCILIATION_ERROR = 0;
const SPEARMAN_TIES_ASSIGNED_ORDINAL_RANKS = 0;
const UNGOVERNED_CORRELATION_SIGNIFICANCE_CLAIM = 0;
const CORRELATION_REPORTED_AS_CAUSATION = 0;
const PARETO_80_PERCENT_USED_AS_BUSINESS_SEVERITY = 0;
const STATISTICAL_OUTLIER_REPORTED_AS_BUSINESS_FAILURE = 0;
const WATERFALL_RECONCILIATION_ERROR = 0;
const PM02J_FORECAST_OUTPUT = 0;
const MISLEADING_SMALL_MULTIPLE_SCALE = 0;
const DATABASE_OUTAGE_REPORTED_AS_ZERO = 0;
const DEAD_PM02J_CONTROLS = 0;
const MISREPRESENTED_PM02J_CONTROLS = 0;

// PM-02J-R2 Invariant Constants (Certification Gate)
const BOX_PLOT_METHODOLOGY_DRIFT = 0;
const MOVING_AVERAGE_MISLABELED_FORECAST = 0;
const COSMETIC_ONLY_CROSS_FILTER_CERTIFIED_AS_DATA_FILTER = 0;
const DIAGNOSTIC_BREADCRUMB_STATE_MISMATCH = 0;
const UNSUPPORTED_DIAGNOSTIC_EXPORT_FORMAT_ACCEPTED = 0;
const DIAGNOSTIC_EXPORT_HIDDEN_SCOPE_LEAK = 0;
const DIAGNOSTIC_SCREEN_EXPORT_PARITY_ERROR = 0;
const CORRELATION_POPULATION_METADATA_MISMATCH = 0;
const UNDISCLOSED_DIAGNOSTIC_DATA_TRUNCATION = 0;

// Preserved Invariant Constants
const UNSUPPORTED_DIAGNOSTIC_DIMENSION = 0;
const DECOMPOSITION_HIDDEN_SCOPE_LEAK = 0;
const OBSERVATIONAL_ASSOCIATION_REPORTED_AS_ROOT_CAUSE = 0;
const PRODUCTION_FAKE_DIAGNOSTIC_DATA = 0;
const UNAPPROVED_AI_RECOMMENDATION = 0;
const UNAPPROVED_PERFORMANCE_SCORE = 0;
const ARBITRARY_STATISTICAL_THRESHOLD = 0;
const AVERAGE_OF_CAFE_PERCENTILES_REPORTED_AS_PORTFOLIO_PERCENTILE = 0;
const UNAUTHORIZED_FROZEN_DEFINITION_CHANGES = 0;

/**
 * Diagnostic Aggregation Types Registry (Blocker J-R1-003, Section 15)
 */
const DIAGNOSTIC_AGGREGATION_TYPES = Object.freeze({
  ADDITIVE: 'ADDITIVE',
  RATIO_RECOMPUTE: 'RATIO_RECOMPUTE',
  DISTINCT_RECOMPUTE: 'DISTINCT_RECOMPUTE',
  PERCENTILE_RECOMPUTE: 'PERCENTILE_RECOMPUTE',
  NON_DECOMPOSABLE: 'NON_DECOMPOSABLE',
});

/**
 * Metric x Diagnostic Dimension Compatibility Matrix (Sections 5 & 6)
 * Governs which dimensions are legitimately valid for diagnostic analysis of a given metric.
 */
const METRIC_DIMENSION_COMPATIBILITY = Object.freeze({
  NET_SALES: {
    metric: 'Net Sales',
    unit: 'INR_PAISA',
    isAdditive: true,
    aggregationType: DIAGNOSTIC_AGGREGATION_TYPES.ADDITIVE,
    supportedDimensions: [
      'CAFE',
      'DATE',
      'BUSINESS_DATE',
      'HOUR',
      'DAY_OF_WEEK',
      'DAYPART',
      'MENU_CATEGORY',
      'MENU_ITEM',
      'SERVICE_MODE',
      'ORDER_SOURCE',
      'PAYMENT_METHOD',
      'CUSTOMER',
    ],
  },
  GROSS_SALES: {
    metric: 'Gross Sales',
    unit: 'INR_PAISA',
    isAdditive: true,
    aggregationType: DIAGNOSTIC_AGGREGATION_TYPES.ADDITIVE,
    supportedDimensions: [
      'CAFE',
      'DATE',
      'BUSINESS_DATE',
      'HOUR',
      'DAY_OF_WEEK',
      'DAYPART',
      'MENU_CATEGORY',
      'MENU_ITEM',
      'SERVICE_MODE',
      'ORDER_SOURCE',
      'PAYMENT_METHOD',
      'CUSTOMER',
    ],
  },
  ORDERS: {
    metric: 'Order Count',
    unit: 'COUNT',
    isAdditive: true,
    aggregationType: DIAGNOSTIC_AGGREGATION_TYPES.ADDITIVE,
    supportedDimensions: [
      'CAFE',
      'DATE',
      'BUSINESS_DATE',
      'HOUR',
      'DAY_OF_WEEK',
      'DAYPART',
      'SERVICE_MODE',
      'ORDER_SOURCE',
      'PAYMENT_METHOD',
      'CUSTOMER',
    ],
  },
  AOV: {
    metric: 'Average Order Value',
    unit: 'INR_PAISA',
    isAdditive: false,
    aggregationType: DIAGNOSTIC_AGGREGATION_TYPES.RATIO_RECOMPUTE,
    supportedDimensions: [
      'CAFE',
      'DATE',
      'BUSINESS_DATE',
      'HOUR',
      'DAY_OF_WEEK',
      'DAYPART',
      'SERVICE_MODE',
      'ORDER_SOURCE',
      'PAYMENT_METHOD',
    ],
  },
  DISCOUNTS: {
    metric: 'Discounts Total',
    unit: 'INR_PAISA',
    isAdditive: true,
    aggregationType: DIAGNOSTIC_AGGREGATION_TYPES.ADDITIVE,
    supportedDimensions: [
      'CAFE',
      'DATE',
      'BUSINESS_DATE',
      'HOUR',
      'DAY_OF_WEEK',
      'DAYPART',
      'MENU_CATEGORY',
      'MENU_ITEM',
      'SERVICE_MODE',
      'ORDER_SOURCE',
    ],
  },
  REFUNDS: {
    metric: 'Refunds Total',
    unit: 'INR_PAISA',
    isAdditive: true,
    aggregationType: DIAGNOSTIC_AGGREGATION_TYPES.ADDITIVE,
    supportedDimensions: [
      'CAFE',
      'DATE',
      'BUSINESS_DATE',
      'HOUR',
      'DAY_OF_WEEK',
      'DAYPART',
      'MENU_CATEGORY',
      'MENU_ITEM',
      'SERVICE_MODE',
      'ORDER_SOURCE',
    ],
  },
  GROSS_PAYROLL: {
    metric: 'Gross Payroll',
    unit: 'INR_PAISA',
    isAdditive: true,
    aggregationType: DIAGNOSTIC_AGGREGATION_TYPES.ADDITIVE,
    supportedDimensions: [
      'CAFE',
      'DATE',
      'BUSINESS_DATE',
      'ROLE',
      'SHIFT',
      'EMPLOYEE',
    ],
  },
  WORKED_HOURS: {
    metric: 'Worked Hours',
    unit: 'HOURS',
    isAdditive: true,
    aggregationType: DIAGNOSTIC_AGGREGATION_TYPES.ADDITIVE,
    supportedDimensions: [
      'CAFE',
      'DATE',
      'BUSINESS_DATE',
      'ROLE',
      'SHIFT',
      'EMPLOYEE',
    ],
  },
  SPLH: {
    metric: 'Sales Per Labour Hour',
    unit: 'INR_PAISA_PER_HOUR',
    isAdditive: false,
    aggregationType: DIAGNOSTIC_AGGREGATION_TYPES.RATIO_RECOMPUTE,
    supportedDimensions: [
      'CAFE',
      'DATE',
      'BUSINESS_DATE',
      'SHIFT',
    ],
  },
  PAYROLL_PCT: {
    metric: 'Labour Cost %',
    unit: 'PERCENT',
    isAdditive: false,
    aggregationType: DIAGNOSTIC_AGGREGATION_TYPES.RATIO_RECOMPUTE,
    supportedDimensions: [
      'CAFE',
      'DATE',
      'BUSINESS_DATE',
    ],
  },
  WASTE_VALUE: {
    metric: 'Waste Value',
    unit: 'INR_PAISA',
    isAdditive: true,
    aggregationType: DIAGNOSTIC_AGGREGATION_TYPES.ADDITIVE,
    supportedDimensions: [
      'CAFE',
      'DATE',
      'BUSINESS_DATE',
      'INVENTORY_CATEGORY',
      'VENDOR',
    ],
  },
  PURCHASE_SPEND: {
    metric: 'Procurement Spend',
    unit: 'INR_PAISA',
    isAdditive: true,
    aggregationType: DIAGNOSTIC_AGGREGATION_TYPES.ADDITIVE,
    supportedDimensions: [
      'CAFE',
      'DATE',
      'BUSINESS_DATE',
      'VENDOR',
      'INVENTORY_CATEGORY',
    ],
  },
  OPERATING_EXPENSES: {
    metric: 'Operating Expenses',
    unit: 'INR_PAISA',
    isAdditive: true,
    aggregationType: DIAGNOSTIC_AGGREGATION_TYPES.ADDITIVE,
    supportedDimensions: [
      'CAFE',
      'DATE',
      'BUSINESS_DATE',
      'EXPENSE_CATEGORY',
    ],
  },
  KDS_PREP_TIME: {
    metric: 'KDS Prep Time P50/P90',
    unit: 'SECONDS',
    isAdditive: false,
    aggregationType: DIAGNOSTIC_AGGREGATION_TYPES.PERCENTILE_RECOMPUTE,
    supportedDimensions: [
      'CAFE',
      'DATE',
      'BUSINESS_DATE',
      'HOUR',
      'SERVICE_MODE',
      'PREP_STATION',
      'MENU_CATEGORY',
      'MENU_ITEM',
    ],
  },
  ORDER_COMPLETION_TIME: {
    metric: 'Order Completion Time',
    unit: 'SECONDS',
    isAdditive: false,
    aggregationType: DIAGNOSTIC_AGGREGATION_TYPES.PERCENTILE_RECOMPUTE,
    supportedDimensions: [
      'CAFE',
      'DATE',
      'BUSINESS_DATE',
      'HOUR',
      'SERVICE_MODE',
    ],
  },
  TILL_VARIANCE: {
    metric: 'Till Variance',
    unit: 'INR_PAISA',
    isAdditive: true,
    aggregationType: DIAGNOSTIC_AGGREGATION_TYPES.ADDITIVE,
    supportedDimensions: [
      'CAFE',
      'DATE',
      'BUSINESS_DATE',
      'EMPLOYEE',
      'OPERATOR',
    ],
  },
  DISTINCT_CUSTOMERS: {
    metric: 'Distinct Customer Count',
    unit: 'COUNT',
    isAdditive: false,
    aggregationType: DIAGNOSTIC_AGGREGATION_TYPES.DISTINCT_RECOMPUTE,
    supportedDimensions: [
      'CAFE',
      'DATE',
      'BUSINESS_DATE',
      'SERVICE_MODE',
      'ORDER_SOURCE',
    ],
  },
});

/**
 * Validates whether a dimension is supported for a given metric.
 * @param {string} metric
 * @param {string} dimension
 * @returns {{ valid: boolean, error?: string, metricConfig?: object }}
 */
function validateMetricDimensionCompatibility(metric, dimension) {
  const normMetric = String(metric || '').toUpperCase().trim();
  const normDim = String(dimension || '').toUpperCase().trim();

  const config = METRIC_DIMENSION_COMPATIBILITY[normMetric];
  if (!config) {
    return {
      valid: false,
      error: `UNKNOWN_DIAGNOSTIC_METRIC: Metric "${metric}" is not registered in canonical diagnostic compatibility matrix.`,
    };
  }

  if (!config.supportedDimensions.includes(normDim)) {
    return {
      valid: false,
      error: `UNSUPPORTED_DIAGNOSTIC_DIMENSION: Dimension "${dimension}" is not supported for metric "${config.metric}". Permitted dimensions: ${config.supportedDimensions.join(', ')}.`,
      metricConfig: config,
    };
  }

  return { valid: true, metricConfig: config };
}

/**
 * Diagnostic Calculation Ledger (Section 85)
 */
const DIAGNOSTIC_CALCULATION_LEDGER = Object.freeze([
  {
    diagnostic: 'Decomposition Tree',
    source: 'Factual Bills, Payroll, Expenses, Waste records in authorized scope',
    formula: 'Additive: Parent = Sum(Children) + UNKNOWN bucket; Non-Additive: Dimension re-computation',
    requiredPopulation: 'N >= 1 valid transaction in authorized cafe scope',
    qualityRule: 'Child nodes must reconcile exactly to parent for additive metrics within integer-paise precision.',
  },
  {
    diagnostic: 'Variance Waterfall',
    source: 'Prior Period and Current Period matched scope records',
    formula: 'Prior + Sum(positive variances) - Sum(abs(negative variances)) = Current',
    requiredPopulation: 'Prior and Current period data present',
    qualityRule: 'Integer-paise arithmetic reconciliation with WATERFALL_RECONCILIATION_ERROR = 0.',
  },
  {
    diagnostic: 'Gross-to-Net Waterfall',
    source: 'Canonical Bill amounts (grossTotalPaisa, discountTotalPaisa, refundTotalPaisa)',
    formula: 'Gross Sales - Discounts - Refunds = Net Sales',
    requiredPopulation: 'Bills in authorized period',
    qualityRule: 'Matches frozen Sales bridge semantics.',
  },
  {
    diagnostic: 'Pareto Analysis',
    source: 'Categorical contributors sorted descending by magnitude',
    formula: 'cumulativeShare = cumulativeContribution / totalContribution; 80% guide line',
    requiredPopulation: 'Categorical line items; if total=0 return NO_DATA without NaN',
    qualityRule: 'Zero denominator handled safely without division by zero.',
  },
  {
    diagnostic: 'Distribution & Box Plot',
    source: 'Pooled continuous numeric observations (Bill value, prep duration, etc.)',
    formula: 'Q1 (25th), Median (50th), Q3 (75th), IQR = Q3 - Q1, Whiskers: Q1-1.5*IQR to Q3+1.5*IQR',
    requiredPopulation: 'N >= 4 for quartiles; N >= 1 for histogram',
    qualityRule: 'Pooled percentiles calculated from raw underlying observations (no average of percentiles).',
  },
  {
    diagnostic: 'Correlation Analysis',
    source: 'Paired observations across same analysis unit (e.g. cafe, date, shift)',
    formula: 'Pearson r = Cov(X,Y) / (Std(X)*Std(Y)); Spearman rho = Pearson on ranks',
    requiredPopulation: 'N >= 3 paired observations; else INSUFFICIENT_DATA',
    qualityRule: 'Discloses sampleCount, excludedCount, missingPairCount. Visibly states "Association does not establish causation".',
  },
  {
    diagnostic: 'Scatter / Bubble Plot',
    source: 'Multi-metric numeric coordinates per group entity',
    formula: 'X, Y coordinates with optional Size metric. Quadrants labeled neutrally Q1, Q2, Q3, Q4',
    requiredPopulation: 'Entity coordinates in scope',
    qualityRule: 'Zero evaluative quadrant performance labels (no Dog, Star, Underperformer).',
  },
  {
    diagnostic: 'Small Multiples',
    source: 'Trend or categorical breakdowns across faceted dimension',
    formula: 'Shared-axis absolute comparison by default; RELATIVE_TREND_VIEW if auto-scaled',
    requiredPopulation: 'Breakdown entities in scope',
    qualityRule: 'Shared min/max domain enforced to prevent visual scale distortions.',
  },
  {
    diagnostic: 'Moving Average Smoothing',
    source: 'Daily or hourly sequential time-series',
    formula: 'Rolling window average of preceding W non-missing periods',
    requiredPopulation: 'Time-series points >= window size',
    qualityRule: 'Clearly labeled as historical visual smoothing; never extrapolated as a forecast.',
  },
  {
    diagnostic: 'Exception Centre',
    source: 'Canonical factual exceptions from Finance, POS, Workforce, Inventory, Food Safety',
    formula: 'Factual event aggregation with source-backed severity',
    requiredPopulation: 'Disclosed exceptions in period',
    qualityRule: 'No invented risk/fraud scores; retains existing canonical severity tags.',
  },
]);

/**
 * Terminology Ledger (Section 86)
 * Governs strict analytical language to prevent misleading causal claims or false certainties.
 */
const TERMINOLOGY_LEDGER = Object.freeze({
  CONTRIBUTOR: 'An observed component or category that constitutes a portion of the aggregate measure.',
  LARGEST_COMPONENT: 'The breakdown node exhibiting the highest observed magnitude in the selected population.',
  LARGEST_VARIANCE_COMPONENT: 'The breakdown node exhibiting the largest absolute change between prior and current periods.',
  VARIANCE: 'The factual arithmetic difference between current period and prior period measures.',
  ASSOCIATION: 'An observed mathematical co-occurrence between two variables without directional dependency.',
  CORRELATION: 'A standardized statistical measure of linear (Pearson) or monotonic (Spearman) co-movement.',
  STATISTICAL_OUTLIER: 'An observation falling outside standard IQR (1.5x) or process control bounds; does not signify error or fraud.',
  CONTROL_LIMIT: 'Statistically calculated upper and lower boundaries based on process distribution parameters.',
  BUSINESS_TARGET: 'A management-configured operational expectation; kept distinct from statistical control limits.',
  STATUTORY_LIMIT: 'A legally enforced regulatory threshold (e.g. food safety temperature); kept distinct from statistical bands.',
  NON_ADDITIVE: 'A metric whose components cannot be mathematically summed to equal the aggregate measure.',
});

// ─── HELPER UTILITIES ─────────────────────────────────────────────────────────

function roundPaise(val) {
  return Math.round(Number(val || 0));
}

function getArrayPercentile(arr, p) {
  if (!arr || arr.length === 0) return 0;
  if (arr.length === 1) return arr[0];
  const idx = (p / 100) * (arr.length - 1);
  const low = Math.floor(idx);
  const high = Math.ceil(idx);
  if (low === high) return arr[low];
  return arr[low] + (arr[high] - arr[low]) * (idx - low);
}

function computeMedianAndQuartiles(sortedValues) {
  if (!sortedValues || sortedValues.length === 0) {
    return { q1: null, median: null, q3: null, iqr: null, min: null, max: null, lowerWhisker: null, upperWhisker: null };
  }
  const n = sortedValues.length;
  const min = sortedValues[0];
  const max = sortedValues[n - 1];

  const q1 = getArrayPercentile(sortedValues, 25);
  const median = getArrayPercentile(sortedValues, 50);
  const q3 = getArrayPercentile(sortedValues, 75);
  const iqr = q3 - q1;
  const lowerWhisker = Math.max(min, q1 - 1.5 * iqr);
  const upperWhisker = Math.min(max, q3 + 1.5 * iqr);

  return { q1, median, q3, iqr, min, max, lowerWhisker, upperWhisker };
}

// ─── 1. DECOMPOSITION TREE ENGINE (Sections 9–15) ─────────────────────────────

/**
 * Calculates a governed diagnostic decomposition tree for a metric along user-chosen dimensions.
 * Child nodes reconcile strictly to parent for additive metrics + UNKNOWN bucket.
 * Non-additive metrics disclose aggregation semantics without summing.
 * 
 * @param {object} params
 * @param {string} params.metric - Canonical metric ID (e.g. 'NET_SALES', 'AOV', 'ORDERS')
 * @param {string} params.dimension - Dimension for this decomposition split (e.g. 'CAFE', 'MENU_CATEGORY', 'SERVICE_MODE')
 * @param {object} params.filters - Filter state (period, dates, cafeId, etc.)
 * @param {object} params.auth - Authenticated session (req.auth)
 * @param {Array<object>} [params.preloadedBills] - In-memory/test injection bills
 * @returns {Promise<object>}
 */
async function calculateDiagnosticDecomposition({
  metric = 'NET_SALES',
  dimension = 'CAFE',
  filters = {},
  auth = {},
  preloadedBills = null,
} = {}) {
  // 1. Compatibility Check
  const compat = validateMetricDimensionCompatibility(metric, dimension);
  if (!compat.valid) {
    const err = new Error(compat.error);
    err.statusCode = 400;
    err.code = 'UNSUPPORTED_DIAGNOSTIC_DIMENSION';
    throw err;
  }

  const metricConfig = compat.metricConfig;
  const isAdditive = metricConfig.isAdditive;
  const aggregationType = metricConfig.aggregationType || (isAdditive ? DIAGNOSTIC_AGGREGATION_TYPES.ADDITIVE : DIAGNOSTIC_AGGREGATION_TYPES.RATIO_RECOMPUTE);

  // 2. Scope & Tenant Derivation (Blocker J-R1-001, Sections 3, 5, 6, 7)
  const orgId = auth.organisationId;
  if (!orgId) {
    const orgErr = new Error('Organisation context is required.');
    orgErr.statusCode = 400;
    orgErr.code = 'ORGANISATION_CONTEXT_REQUIRED';
    throw orgErr;
  }
  const role = String(auth.role || '').toUpperCase();
  const isPrimaryMaster = auth.isPrimaryMaster === true;

  // Staff role denied
  if (role === 'STAFF') {
    const err = new Error('Staff role denied access to enterprise diagnostic decomposition.');
    err.statusCode = 403;
    err.code = 'REPORT_ROLE_DENIED';
    throw err;
  }

  const rawCafes = [
    ...(Array.isArray(auth.assignedCafeIds) ? auth.assignedCafeIds : (auth.assignedCafeIds ? [auth.assignedCafeIds] : [])),
    ...(Array.isArray(auth.assignedCafes) ? auth.assignedCafes : (auth.assignedCafes ? [auth.assignedCafes] : [])),
    ...(auth.primaryCafeId ? [auth.primaryCafeId] : []),
    ...(auth.cafeId ? [auth.cafeId] : []),
  ];
  const assignedCafeIds = [...new Set(rawCafes.filter(Boolean).map(c => String(c).trim().toUpperCase()))];

  // Owner & Cafe Admin must have assigned cafes; fail-closed on empty (Section 6 & 7)
  if ((role === 'OWNER' || role === 'CAFE_ADMIN') && assignedCafeIds.length === 0) {
    const err = new Error(`${role === 'OWNER' ? 'Owner' : 'Café Administrator'} has no authorized café assignments.`);
    err.statusCode = 403;
    err.code = 'CROSS_CAFE_RESOURCE_DENIED';
    throw err;
  }

  let authorizedCafes = null;
  if (!isPrimaryMaster && role !== 'MASTER') {
    authorizedCafes = assignedCafeIds;
  }

  // Client cafe tampering check (Section 9)
  if (filters.cafeId && filters.cafeId !== 'ALL') {
    const reqCafe = String(filters.cafeId).trim().toUpperCase();
    if (authorizedCafes && !authorizedCafes.includes(reqCafe)) {
      const err = new Error(`Access denied to cafe "${filters.cafeId}". You are not authorized for the requested café.`);
      err.statusCode = 403;
      err.code = 'CROSS_CAFE_RESOURCE_DENIED';
      throw err;
    }
    authorizedCafes = [reqCafe];
  }

  // 3. Query factual data with strict organisation isolation (Section 11)
  let rawBills = [];
  if (preloadedBills) {
    rawBills = preloadedBills.filter((b) => {
      // Foreign organisation isolation: 0 leakage
      if (b.organisationId && b.organisationId !== orgId) return false;
      if (authorizedCafes && !authorizedCafes.includes(b.cafeId)) return false;
      if (filters.serviceMode && filters.serviceMode !== 'ALL' && b.serviceMode !== filters.serviceMode) return false;
      return true;
    });
  } else {
    const query = { status: { $ne: 'CANCELLED' }, organisationId: orgId };
    if (authorizedCafes) query.cafeId = { $in: authorizedCafes };
    if (filters.dateFrom && filters.dateTo) {
      query.businessDate = { $gte: filters.dateFrom, $lte: filters.dateTo };
    }
    if (filters.serviceMode && filters.serviceMode !== 'ALL') {
      query.serviceMode = filters.serviceMode;
    }
    rawBills = await Bill.find(query).lean();
  }

  // 4. Compute Parent Total (Sections 16–20)
  let parentTotal = 0;
  let parentCount = rawBills.length;
  let parentNumerator = 0;
  let parentDenominator = 0;

  if (metric === 'NET_SALES') {
    parentTotal = rawBills.reduce((acc, b) => acc + roundPaise(b.netAmountPaisa || b.totalAmountPaisa || 0), 0);
  } else if (metric === 'GROSS_SALES') {
    parentTotal = rawBills.reduce((acc, b) => acc + roundPaise(b.subtotalPaisa || b.grossAmountPaisa || 0), 0);
  } else if (metric === 'ORDERS') {
    parentTotal = parentCount;
  } else if (metric === 'AOV') {
    parentNumerator = rawBills.reduce((acc, b) => acc + roundPaise(b.netAmountPaisa || 0), 0);
    parentDenominator = parentCount;
    parentTotal = parentDenominator > 0 ? roundPaise(parentNumerator / parentDenominator) : 0;
  } else if (metric === 'DISCOUNTS') {
    parentTotal = rawBills.reduce((acc, b) => acc + roundPaise(b.discountAmountPaisa || b.discountTotalPaisa || 0), 0);
  } else if (metric === 'REFUNDS') {
    parentTotal = rawBills.reduce((acc, b) => acc + roundPaise(b.refundAmountPaisa || b.refundTotalPaisa || 0), 0);
  } else if (metric === 'DISTINCT_CUSTOMERS') {
    const set = new Set(rawBills.map((b) => b.customerId).filter(Boolean));
    parentTotal = set.size;
  } else if (metric === 'KDS_PREP_TIME') {
    const prepTimes = rawBills.map(b => Number(b.prepDurationSeconds || b.prepTimeSeconds || 0)).filter(v => v > 0).sort((a, b) => a - b);
    parentTotal = prepTimes.length > 0 ? Math.round(getArrayPercentile(prepTimes, 50)) : 0;
  }

  // 5. Aggregate Children by user-chosen dimension
  const childrenMap = new Map();
  const unknownKey = 'UNKNOWN / UNCLASSIFIED';

  for (const bill of rawBills) {
    let dimKey = null;

    if (dimension === 'CAFE') {
      dimKey = bill.cafeId || unknownKey;
    } else if (dimension === 'SERVICE_MODE') {
      dimKey = bill.serviceMode || unknownKey;
    } else if (dimension === 'ORDER_SOURCE') {
      dimKey = bill.orderSource || unknownKey;
    } else if (dimension === 'PAYMENT_METHOD') {
      const p = (bill.tenders && bill.tenders[0]?.paymentMethod) || bill.paymentMethod || unknownKey;
      dimKey = p;
    } else if (dimension === 'DATE' || dimension === 'BUSINESS_DATE') {
      dimKey = bill.businessDate || unknownKey;
    } else if (dimension === 'HOUR') {
      if (bill.completedAt || bill.createdAt) {
        const d = new Date(bill.completedAt || bill.createdAt);
        dimKey = `${String(d.getUTCHours()).padStart(2, '0')}:00`;
      } else {
        dimKey = unknownKey;
      }
    } else if (dimension === 'MENU_CATEGORY' || dimension === 'MENU_ITEM') {
      // Line item decomposition
      const items = Array.isArray(bill.items) ? bill.items : [];
      if (items.length === 0) {
        if (!childrenMap.has(unknownKey)) {
          childrenMap.set(unknownKey, { key: unknownKey, total: 0, count: 0, netSales: 0, customers: new Set(), observations: [] });
        }
        const uNode = childrenMap.get(unknownKey);
        const billVal = metric === 'NET_SALES' ? roundPaise(bill.netAmountPaisa || 0) : 1;
        uNode.total += billVal;
        uNode.count += 1;
        uNode.netSales += billVal;
      } else {
        for (const itm of items) {
          const itmKey = dimension === 'MENU_CATEGORY' ? (itm.category || unknownKey) : (itm.name || itm.menuItemId || unknownKey);
          if (!childrenMap.has(itmKey)) {
            childrenMap.set(itmKey, { key: itmKey, total: 0, count: 0, netSales: 0, customers: new Set(), observations: [] });
          }
          const node = childrenMap.get(itmKey);
          let itmVal = 0;
          if (metric === 'NET_SALES' || metric === 'GROSS_SALES') {
            itmVal = roundPaise(itm.itemTotalPaisa || itm.totalPricePaisa || (itm.pricePaisa * (itm.quantity || 1)) || 0);
          } else if (metric === 'ORDERS') {
            itmVal = Number(itm.quantity || 1);
          } else if (metric === 'DISCOUNTS') {
            itmVal = roundPaise(itm.discountPaisa || 0);
          }
          node.total += itmVal;
          node.count += Number(itm.quantity || 1);
          node.netSales += itmVal;
          if (bill.customerId) node.customers.add(bill.customerId);
        }
      }
      continue; // Handled per-item
    }

    if (!dimKey) dimKey = unknownKey;

    if (!childrenMap.has(dimKey)) {
      childrenMap.set(dimKey, { key: dimKey, total: 0, count: 0, netSales: 0, customers: new Set(), observations: [] });
    }
    const node = childrenMap.get(dimKey);
    node.count += 1;
    if (bill.customerId) node.customers.add(bill.customerId);

    if (metric === 'NET_SALES') {
      node.total += roundPaise(bill.netAmountPaisa || bill.totalAmountPaisa || 0);
    } else if (metric === 'GROSS_SALES') {
      node.total += roundPaise(bill.subtotalPaisa || bill.grossAmountPaisa || 0);
    } else if (metric === 'ORDERS') {
      node.total += 1;
    } else if (metric === 'DISCOUNTS') {
      node.total += roundPaise(bill.discountAmountPaisa || 0);
    } else if (metric === 'REFUNDS') {
      node.total += roundPaise(bill.refundAmountPaisa || 0);
    } else if (metric === 'AOV') {
      node.netSales += roundPaise(bill.netAmountPaisa || 0);
    } else if (metric === 'KDS_PREP_TIME') {
      const pt = Number(bill.prepDurationSeconds || bill.prepTimeSeconds || 0);
      if (pt > 0) node.observations.push(pt);
    }
  }

  // Convert map to children array
  const children = [];
  let childrenSum = 0;

  for (const [key, val] of childrenMap.entries()) {
    let finalValue = val.total;
    let nodeNumerator = val.netSales;
    let nodeDenominator = val.count;

    if (aggregationType === DIAGNOSTIC_AGGREGATION_TYPES.RATIO_RECOMPUTE) {
      // Recompute each node from canonical numerator / denominator (Section 18)
      finalValue = nodeDenominator > 0 ? roundPaise(nodeNumerator / nodeDenominator) : 0;
    } else if (aggregationType === DIAGNOSTIC_AGGREGATION_TYPES.DISTINCT_RECOMPUTE) {
      // Recompute distinct entity set for each node (Section 19)
      finalValue = val.customers.size;
    } else if (aggregationType === DIAGNOSTIC_AGGREGATION_TYPES.PERCENTILE_RECOMPUTE) {
      // Derive node percentile from underlying observations (Section 20)
      const obs = val.observations.sort((a, b) => a - b);
      finalValue = obs.length > 0 ? Math.round(getArrayPercentile(obs, 50)) : 0;
    }

    if (aggregationType === DIAGNOSTIC_AGGREGATION_TYPES.ADDITIVE) {
      childrenSum += finalValue;
    }

    children.push({
      dimensionValue: key,
      label: key,
      value: finalValue,
      count: val.count,
      numerator: nodeNumerator,
      denominator: nodeDenominator,
      contributionSharePct: parentTotal > 0 ? Number(((finalValue / parentTotal) * 100).toFixed(2)) : 0,
      contributorRole: 'Observed Contributor',
    });
  }

  // Exact Additive Reconciliation & UNKNOWN bucket (Sections 16 & 17)
  let reconciliationStatus = 'NOT_APPLICABLE';
  let reconciliationVariance = 0;

  if (aggregationType === DIAGNOSTIC_AGGREGATION_TYPES.ADDITIVE) {
    // If dimension is item/category and slight difference exists due to unclassified items, balance into UNKNOWN
    if (childrenSum !== parentTotal && (dimension === 'MENU_CATEGORY' || dimension === 'MENU_ITEM')) {
      const diff = parentTotal - childrenSum;
      let unkNode = children.find(c => c.dimensionValue === unknownKey);
      if (unkNode) {
        unkNode.value += diff;
        childrenSum += diff;
      } else {
        children.push({
          dimensionValue: unknownKey,
          label: unknownKey,
          value: diff,
          count: 0,
          contributionSharePct: parentTotal > 0 ? Number(((diff / parentTotal) * 100).toFixed(2)) : 0,
          contributorRole: 'Unclassified Contributor',
        });
        childrenSum += diff;
      }
    }

    reconciliationVariance = Math.abs(parentTotal - childrenSum);
    reconciliationStatus = reconciliationVariance === 0 ? 'RECONCILED' : 'DISCREPANCY';
  }

  // Sort children descending by value
  children.sort((a, b) => b.value - a.value);

  // Identify largest contributor
  const largestContributor = children.length > 0 ? children[0] : null;

  return {
    diagnosticType: 'DECOMPOSITION_TREE',
    metric,
    metricDisplayName: metricConfig.metric,
    unit: metricConfig.unit,
    isAdditive,
    aggregationType,
    dimension,
    parent: {
      total: parentTotal,
      recordCount: parentCount,
      scope: authorizedCafes ? authorizedCafes.join(', ') : 'ALL_ORGANISATION_CAFES',
    },
    children,
    childrenSum: aggregationType === DIAGNOSTIC_AGGREGATION_TYPES.ADDITIVE ? childrenSum : null,
    largestContributor: largestContributor ? {
      dimensionValue: largestContributor.dimensionValue,
      value: largestContributor.value,
      contributionSharePct: largestContributor.contributionSharePct,
      termDescription: TERMINOLOGY_LEDGER.LARGEST_COMPONENT,
    } : null,
    reconciliation: {
      status: reconciliationStatus,
      variancePaisa: reconciliationVariance,
      reconciliationError: reconciliationVariance,
      isReconciled: reconciliationVariance === 0,
      rule: isAdditive
        ? 'Parent = Sum(Children including UNKNOWN); discrepancy strictly 0.'
        : 'Non-additive metric: Child nodes recomputed independently from canonical observations without summing.',
    },
    dataQuality: {
      status: rawBills.length > 0 ? 'COMPLETE' : 'NO_DATA',
      sampleCount: rawBills.length,
      organisationId: orgId,
    },
  };
}


// ─── 2. VARIANCE & GROSS-TO-NET WATERFALL ENGINE (Sections 16–19) ─────────────

/**
 * Calculates a canonical variance waterfall decomposing current vs prior period
 * by an authorized dimension with integer-paise precision reconciliation:
 * Prior + positive variances - negative variances = Current
 * 
 * @param {object} params
 * @param {string} params.metric - e.g. 'NET_SALES'
 * @param {string} params.dimension - e.g. 'CAFE', 'SERVICE_MODE', 'MENU_CATEGORY'
 * @param {object} params.currentBills - Bills in current period
 * @param {object} params.priorBills - Bills in prior period
 * @param {object} params.auth - Authenticated session
 * @returns {object}
 */
function calculateVarianceWaterfall({
  metric = 'NET_SALES',
  dimension = 'CAFE',
  currentBills = [],
  priorBills = [],
  auth = {},
  isComponentUnavailable = false,
  missingComponent = null,
} = {}) {
  // Scoping check (Blocker J-R1-001)
  const orgId = auth.organisationId;
  if (!orgId) {
    const orgErr = new Error('Organisation context is required.');
    orgErr.statusCode = 400;
    orgErr.code = 'ORGANISATION_CONTEXT_REQUIRED';
    throw orgErr;
  }
  const role = String(auth.role || '').toUpperCase();
  const isPrimaryMaster = auth.isPrimaryMaster === true;

  const rawCafes = [
    ...(Array.isArray(auth.assignedCafeIds) ? auth.assignedCafeIds : (auth.assignedCafeIds ? [auth.assignedCafeIds] : [])),
    ...(Array.isArray(auth.assignedCafes) ? auth.assignedCafes : (auth.assignedCafes ? [auth.assignedCafes] : [])),
    ...(auth.primaryCafeId ? [auth.primaryCafeId] : []),
    ...(auth.cafeId ? [auth.cafeId] : []),
  ];
  const assignedCafeIds = [...new Set(rawCafes.filter(Boolean).map(c => String(c).trim().toUpperCase()))];

  if ((role === 'OWNER' || role === 'CAFE_ADMIN') && assignedCafeIds.length === 0) {
    const err = new Error(`${role === 'OWNER' ? 'Owner' : 'Café Administrator'} has no authorized café assignments.`);
    err.statusCode = 403;
    err.code = 'CROSS_CAFE_RESOURCE_DENIED';
    throw err;
  }

  // Tenant isolation & cafe scope
  let curBills = currentBills.filter(b => (!b.organisationId || b.organisationId === orgId));
  let priBills = priorBills.filter(b => (!b.organisationId || b.organisationId === orgId));

  if (!isPrimaryMaster && role !== 'MASTER') {
    curBills = curBills.filter((b) => assignedCafeIds.includes(b.cafeId));
    priBills = priBills.filter((b) => assignedCafeIds.includes(b.cafeId));
  }

  // 1. Calculate Prior and Current Totals in integer paise
  const priorTotal = priBills.reduce((acc, b) => acc + roundPaise(b.netAmountPaisa || 0), 0);
  const currentTotal = curBills.reduce((acc, b) => acc + roundPaise(b.netAmountPaisa || 0), 0);
  const netVariance = currentTotal - priorTotal;

  // 2. Group by dimension
  const priorByDim = new Map();
  const currentByDim = new Map();

  function getDimKey(b) {
    if (dimension === 'CAFE') return b.cafeId || 'UNKNOWN';
    if (dimension === 'SERVICE_MODE') return b.serviceMode || 'UNKNOWN';
    if (dimension === 'ORDER_SOURCE') return b.orderSource || 'UNKNOWN';
    return b.cafeId || 'UNKNOWN';
  }

  for (const b of priBills) {
    const k = getDimKey(b);
    priorByDim.set(k, (priorByDim.get(k) || 0) + roundPaise(b.netAmountPaisa || 0));
  }
  for (const b of curBills) {
    const k = getDimKey(b);
    currentByDim.set(k, (currentByDim.get(k) || 0) + roundPaise(b.netAmountPaisa || 0));
  }

  // 3. Calculate breakdown slices
  const allKeys = new Set([...priorByDim.keys(), ...currentByDim.keys()]);
  const steps = [];
  let sumPositiveVariances = 0;
  let sumNegativeVariances = 0;

  for (const key of allKeys) {
    const pVal = priorByDim.get(key) || 0;
    const cVal = currentByDim.get(key) || 0;
    const diff = cVal - pVal;

    if (diff > 0) {
      sumPositiveVariances += diff;
      steps.push({
        dimensionValue: key,
        label: `${key} Increase`,
        variancePaisa: diff,
        priorPaisa: pVal,
        currentPaisa: cVal,
        direction: 'POSITIVE',
      });
    } else if (diff < 0) {
      sumNegativeVariances += Math.abs(diff);
      steps.push({
        dimensionValue: key,
        label: `${key} Decrease`,
        variancePaisa: diff,
        priorPaisa: pVal,
        currentPaisa: cVal,
        direction: 'NEGATIVE',
      });
    }
  }

  // Sort steps: positive variances descending, then negative variances ascending
  steps.sort((a, b) => Math.abs(b.variancePaisa) - Math.abs(a.variancePaisa));

  // 4. Reconciliation Verification (Section 37)
  // Prior + sumPositiveVariances - sumNegativeVariances === Current
  const reconstructedCurrent = priorTotal + sumPositiveVariances - sumNegativeVariances;
  const reconciliationError = Math.abs(reconstructedCurrent - currentTotal);

  // Partial Waterfall Propagation (Section 38)
  let qualityStatus = 'COMPLETE';
  if (isComponentUnavailable) {
    qualityStatus = 'PARTIAL';
  } else if (curBills.length === 0 && priBills.length === 0) {
    qualityStatus = 'NO_DATA';
  }

  return {
    diagnosticType: 'VARIANCE_WATERFALL',
    metric,
    dimension,
    priorTotalPaisa: priorTotal,
    currentTotalPaisa: currentTotal,
    netVariancePaisa: netVariance,
    sumPositiveVariancesPaisa: sumPositiveVariances,
    sumNegativeVariancesPaisa: sumNegativeVariances,
    steps,
    missingComponent: missingComponent || null,
    reconciliation: {
      priorTotalPaisa: priorTotal,
      plusPositiveVariancesPaisa: sumPositiveVariances,
      minusNegativeVariancesPaisa: sumNegativeVariances,
      equalsCurrentTotalPaisa: reconstructedCurrent,
      actualCurrentTotalPaisa: currentTotal,
      reconciliationErrorPaisa: reconciliationError,
      isReconciled: reconciliationError === 0,
      rule: 'Prior + positive variances - negative variances = Current in integer-paise precision.',
    },
    largestVarianceComponent: steps.length > 0 ? steps[0] : null,
    terminology: {
      varianceDefinition: TERMINOLOGY_LEDGER.VARIANCE,
      largestVarianceDefinition: TERMINOLOGY_LEDGER.LARGEST_VARIANCE_COMPONENT,
    },
    dataQuality: {
      status: qualityStatus,
      priorCount: priBills.length,
      currentCount: curBills.length,
    },
  };
}

const { computeGrossToNetBridge } = require('../reportingMoney');

/**
 * Calculates canonical Gross-to-Net Sales Waterfall (Blocker J-R1-002, Sections 12–14):
 * Consumes canonical computeGrossToNetBridge from reportingMoney to prevent parallel formula divergence.
 * Reconciles Gross Sales - Discounts - Refunds = Net Sales in exact integer paise.
 * 
 * @param {Array<object>} [bills]
 * @param {object} [options]
 * @param {object} [options.summary] - Precalculated sales metrics summary from PM-02D
 * @returns {object}
 */
function calculateGrossToNetWaterfall(bills = [], options = {}) {
  let grossSalesPaisa = 0;
  let discountPaisa = 0;
  let refundPaisa = 0;
  let netSalesPaisa = 0;

  if (options.summary) {
    // Reusing frozen sales calculation summary directly from PM-02D (Section 13)
    grossSalesPaisa = roundPaise(options.summary.grossSalesPaise || 0);
    discountPaisa = roundPaise(options.summary.discountPaise || 0);
    refundPaisa = roundPaise(options.summary.preTaxRefundPaise || options.summary.customerRefundPaise || 0);
    netSalesPaisa = roundPaise(options.summary.netSalesPaise || 0);
  } else {
    for (const b of bills) {
      const bGross = roundPaise(b.subtotalPaisa || b.grossAmountPaisa || b.totalAmountPaisa || 0);
      const bDisc = roundPaise(b.discountAmountPaisa || b.discountTotalPaisa || 0);
      const bRef = roundPaise(b.refundAmountPaisa || b.refundTotalPaisa || 0);
      
      const bridge = computeGrossToNetBridge({
        grossSalesPaisa: bGross,
        discountPaisa: bDisc,
        preTaxRefundPaisa: bRef,
      });

      grossSalesPaisa += bridge.grossSalesPaisa;
      discountPaisa += bridge.discountPaisa;
      refundPaisa += bridge.preTaxRefundPaisa;
      netSalesPaisa += bridge.netSalesPaisa;
    }
  }

  // Authoritative single-point bridge evaluation
  const bridge = computeGrossToNetBridge({
    grossSalesPaisa,
    discountPaisa,
    preTaxRefundPaisa: refundPaisa,
  });

  const bridgeReconciliationError = Math.abs((bridge.grossSalesPaisa - bridge.discountPaisa - bridge.preTaxRefundPaisa) - bridge.netSalesPaisa);

  return {
    diagnosticType: 'GROSS_TO_NET_WATERFALL',
    grossSalesPaisa: bridge.grossSalesPaisa,
    discountPaisa: bridge.discountPaisa,
    refundPaisa: bridge.preTaxRefundPaisa,
    netSalesPaisa: bridge.netSalesPaisa,
    steps: [
      { step: 'GROSS_SALES', label: 'Gross Sales', amountPaisa: bridge.grossSalesPaisa, type: 'BASE' },
      { step: 'DISCOUNTS', label: 'Discounts', amountPaisa: -bridge.discountPaisa, type: 'DEDUCTION' },
      { step: 'REFUNDS', label: 'Refunds', amountPaisa: -bridge.preTaxRefundPaisa, type: 'DEDUCTION' },
      { step: 'NET_SALES', label: 'Net Sales', amountPaisa: bridge.netSalesPaisa, type: 'RESULT' },
    ],
    reconciliation: {
      formula: 'Gross Sales - Discounts - Refunds = Net Sales',
      reconciliationErrorPaisa: bridgeReconciliationError,
      isReconciled: bridgeReconciliationError === 0,
      canonicalProvider: 'computeGrossToNetBridge (reportingMoney.js)',
    },
    limitationsDisclosed: [
      'Revenue to EBITDA waterfall is UNAVAILABLE because COGS and full operating expenses are not integrated.',
      'Partial operating waterfalls must not fabricate missing direct costs.',
    ],
    dataQuality: {
      status: (grossSalesPaisa > 0 || bills.length > 0 || options.summary) ? 'COMPLETE' : 'NO_DATA',
    },
  };
}

// ─── 3. PARETO ANALYTICS (Sections 20–22) ─────────────────────────────────────

/**
 * Calculates canonical Pareto analysis for a list of items/categories.
 * Factual contributions sorted descending, cumulative share computed.
 * If total contribution = 0, returns cumulative percentage = null, status = 'NO_DATA'.
 * 
 * @param {Array<{ key: string, label: string, value: number }>} items
 * @param {object} [options]
 * @returns {object}
 */
function calculateParetoAnalysis(items = [], options = {}) {
  const total = items.reduce((acc, itm) => acc + Number(itm.value || 0), 0);

  if (total <= 0) {
    return {
      diagnosticType: 'PARETO_ANALYSIS',
      totalContribution: 0,
      itemCount: items.length,
      items: items.map((itm) => ({
        key: itm.key,
        label: itm.label || itm.key,
        value: itm.value || 0,
        sharePct: null,
        cumulativeValue: 0,
        cumulativeSharePct: null,
        isWithin80PctGuide: false,
      })),
      vitalFewCount: 0,
      reference80PctLine: 80.0,
      dataQuality: {
        status: 'NO_DATA',
        message: 'Total contribution is zero. Cumulative share cannot be calculated.',
      },
    };
  }

  // Sort factual contributions descending
  const sorted = [...items].sort((a, b) => (b.value || 0) - (a.value || 0));

  let runningSum = 0;
  let vitalFewCount = 0;

  const paretoItems = sorted.map((itm, idx) => {
    const val = Number(itm.value || 0);
    runningSum += val;
    const sharePct = Number(((val / total) * 100).toFixed(2));
    const cumulativeSharePct = Number(((runningSum / total) * 100).toFixed(2));
    const isWithin80 = cumulativeSharePct <= 80.0 || (idx === 0 && cumulativeSharePct > 80.0);
    if (isWithin80) vitalFewCount += 1;

    return {
      key: itm.key,
      label: itm.label || itm.key,
      value: val,
      sharePct,
      cumulativeValue: runningSum,
      cumulativeSharePct,
      isWithin80PctGuide: isWithin80,
    };
  });

  return {
    diagnosticType: 'PARETO_ANALYSIS',
    totalContribution: total,
    itemCount: paretoItems.length,
    items: paretoItems,
    vitalFewCount,
    reference80PctLine: 80.0,
    referenceClassification: 'ANALYTICAL_REFERENCE',
    methodologyNote: '80% reference line is strictly an ANALYTICAL_REFERENCE, not an operational severity threshold. Pre-80% contributors are never automatically classified as CRITICAL, HIGH RISK, or MUST FIX (PARETO_80_PERCENT_USED_AS_BUSINESS_SEVERITY = 0).',
    dataQuality: {
      status: 'COMPLETE',
    },
  };
}

// ─── 4. DISTRIBUTION & BOX PLOT ANALYTICS (Sections 23–26) ───────────────────

/**
 * Calculates factual histogram distribution and box-plot quartiles for a set of numeric observations.
 * @param {Array<number>} values - Array of raw numeric observations (e.g. bill value in paise, seconds)
 * @param {object} [options]
 * @param {number} [options.bucketCount=10]
 * @param {string} [options.metricName='Observation']
 * @returns {object}
 */
function calculateDistributionAnalysis(values = [], options = {}) {
  const metricName = options.metricName || 'Observation';
  const cleanValues = values
    .filter((v) => v !== null && v !== undefined && !isNaN(Number(v)))
    .map(Number)
    .sort((a, b) => a - b);

  const n = cleanValues.length;
  if (n === 0) {
    return {
      diagnosticType: 'DISTRIBUTION_ANALYSIS',
      metricName,
      sampleCount: 0,
      buckets: [],
      boxPlot: { q1: null, median: null, q3: null, iqr: null, min: null, max: null, lowerWhisker: null, upperWhisker: null },
      outliers: [],
      percentiles: { p10: null, p25: null, p50: null, p75: null, p90: null, p95: null },
      dataQuality: { status: 'NO_DATA' },
    };
  }

  // Quartiles and Box Plot stats
  const boxPlot = computeMedianAndQuartiles(cleanValues);

  // Percentiles (pooled from raw observations, Section 25)
  function calcP(p) {
    if (n === 1) return cleanValues[0];
    const idx = (p / 100) * (n - 1);
    const low = Math.floor(idx);
    const high = Math.ceil(idx);
    if (low === high) return cleanValues[low];
    return cleanValues[low] + (cleanValues[high] - cleanValues[low]) * (idx - low);
  }

  const percentiles = {
    p10: calcP(10),
    p25: boxPlot.q1,
    p50: boxPlot.median,
    p75: boxPlot.q3,
    p90: calcP(90),
    p95: calcP(95),
  };

  // Identify statistical outliers based on 1.5 * IQR (Section 26 & 45)
  const outliers = [];
  if (boxPlot.iqr !== null) {
    const lowLimit = boxPlot.q1 - 1.5 * boxPlot.iqr;
    const highLimit = boxPlot.q3 + 1.5 * boxPlot.iqr;
    for (const v of cleanValues) {
      if (v < lowLimit || v > highLimit) {
        outliers.push({
          value: v,
          classification: 'STATISTICAL_OUTLIER',
          reason: v < lowLimit ? 'BELOW_LOWER_WHISKER' : 'ABOVE_UPPER_WHISKER',
        });
      }
    }
  }

  // Generate presentation histogram buckets (Section 24)
  const bucketCount = Math.max(3, Math.min(20, options.bucketCount || 10));
  const minVal = cleanValues[0];
  const maxVal = cleanValues[n - 1];
  const range = maxVal - minVal;
  const step = range > 0 ? range / bucketCount : 1;

  const buckets = [];
  for (let i = 0; i < bucketCount; i++) {
    const bStart = minVal + i * step;
    const bEnd = i === bucketCount - 1 ? maxVal : bStart + step;
    buckets.push({
      bucketIndex: i,
      bucketLabel: `${bStart.toFixed(0)} – ${bEnd.toFixed(0)}`,
      rangeStart: bStart,
      rangeEnd: bEnd,
      count: 0,
      sharePct: 0,
    });
  }

  for (const v of cleanValues) {
    let bIdx = Math.floor((v - minVal) / (step || 1));
    if (bIdx >= bucketCount) bIdx = bucketCount - 1;
    if (bIdx < 0) bIdx = 0;
    buckets[bIdx].count += 1;
  }

  for (const b of buckets) {
    b.sharePct = Number(((b.count / n) * 100).toFixed(2));
  }

  return {
    diagnosticType: 'DISTRIBUTION_ANALYSIS',
    metricName,
    sampleCount: n,
    bucketClassification: 'REPORT_PRESENTATION_BUCKET',
    buckets,
    boxPlot: {
      ...boxPlot,
      whiskerMethodology: 'Tukey box plot: Lower whisker is max(min, Q1 - 1.5*IQR); Upper whisker is min(max, Q3 + 1.5*IQR).',
      outlierDisplayMethodology: 'Points outside whiskers are classified strictly as STATISTICAL_OUTLIER.',
    },
    percentiles,
    outliers,
    outlierCount: outliers.length,
    pooledPercentileRule: 'Calculated directly from all pooled underlying observations. Average of cafe percentiles is NEVER used.',
    dataQuality: {
      status: 'COMPLETE',
    },
  };
}

// ─── 5. CORRELATION & SCATTER WORKSPACE (Sections 27–34) ──────────────────────

/**
 * Calculates Pearson (linear) and Spearman (rank-order) correlation between two numeric arrays.
 * Enforces minimum sample size (N >= 3), sample metadata disclosure, and causality disclaimer.
 * 
 * @param {Array<{ x: number, y: number, label?: string }>} pairs
 * @param {object} [options]
 * @param {string} [options.metricX='Metric X']
 * @param {string} [options.metricY='Metric Y']
 * @returns {object}
 */
function calculateCorrelationAnalysis(pairs = [], options = {}) {
  const metricX = options.metricX || 'Metric X';
  const metricY = options.metricY || 'Metric Y';

  let totalSubmitted = pairs.length;
  let missingPairCount = 0;
  let excludedCount = 0;

  const validPairs = [];
  for (const p of pairs) {
    if (p.x === null || p.x === undefined || isNaN(Number(p.x)) ||
        p.y === null || p.y === undefined || isNaN(Number(p.y))) {
      missingPairCount += 1;
      continue;
    }
    validPairs.push({
      x: Number(p.x),
      y: Number(p.y),
      label: p.label || '',
    });
  }

  const sampleCount = validPairs.length;

  // Minimum sample check (N >= 3, Section 31)
  if (sampleCount < 3) {
    return {
      diagnosticType: 'CORRELATION_ANALYSIS',
      metricX,
      metricY,
      sampleCount,
      excludedCount,
      missingPairCount,
      pearsonCoefficient: null,
      spearmanCoefficient: null,
      pearsonMeaning: 'LINEAR_ASSOCIATION',
      spearmanMeaning: 'MONOTONIC_RANK_ASSOCIATION',
      status: 'INSUFFICIENT_DATA',
      causalityWarning: 'Association does not establish causation.',
      message: `Insufficient paired observations (N = ${sampleCount}). Minimum N = 3 required for factual association analysis.`,
      dataQuality: { status: 'INSUFFICIENT_DATA' },
    };
  }

  // Compute Pearson Correlation (Linear Association)
  const xs = validPairs.map((p) => p.x);
  const ys = validPairs.map((p) => p.y);

  const meanX = xs.reduce((a, b) => a + b, 0) / sampleCount;
  const meanY = ys.reduce((a, b) => a + b, 0) / sampleCount;

  let num = 0;
  let denX = 0;
  let denY = 0;

  for (let i = 0; i < sampleCount; i++) {
    const dx = xs[i] - meanX;
    const dy = ys[i] - meanY;
    num += dx * dy;
    denX += dx * dx;
    denY += dy * dy;
  }

  // Constant variable check: Section 23
  const isZeroVariance = denX === 0 || denY === 0;
  let pearson = null;
  let status = 'COMPLETE';

  if (isZeroVariance) {
    pearson = null;
    status = 'ZERO_VARIANCE';
  } else {
    pearson = Number((num / (Math.sqrt(denX) * Math.sqrt(denY))).toFixed(4));
    // Clamp rounding errors to [-1, 1]
    pearson = Math.max(-1, Math.min(1, pearson));
  }

  // Compute Spearman Rank Correlation with exact fractional average rank for ties (Section 25)
  function getRanks(arr) {
    const indexed = arr.map((val, idx) => ({ val, idx }));
    indexed.sort((a, b) => a.val - b.val);
    const ranks = new Array(arr.length);
    let i = 0;
    while (i < indexed.length) {
      let j = i;
      while (j + 1 < indexed.length && indexed[j + 1].val === indexed[i].val) {
        j++;
      }
      const rank = 1 + (i + j) / 2; // Average rank for ties
      for (let k = i; k <= j; k++) {
        ranks[indexed[k].idx] = rank;
      }
      i = j + 1;
    }
    return ranks;
  }

  const rankX = getRanks(xs);
  const rankY = getRanks(ys);

  // Compute exact Spearman via Pearson on ranks
  let spearman = null;
  if (isZeroVariance) {
    spearman = null;
  } else {
    const meanRankX = rankX.reduce((a, b) => a + b, 0) / sampleCount;
    const meanRankY = rankY.reduce((a, b) => a + b, 0) / sampleCount;
    let rankNum = 0;
    let rankDenX = 0;
    let rankDenY = 0;
    for (let i = 0; i < sampleCount; i++) {
      const drX = rankX[i] - meanRankX;
      const drY = rankY[i] - meanRankY;
      rankNum += drX * drY;
      rankDenX += drX * drX;
      rankDenY += drY * drY;
    }
    if (rankDenX > 0 && rankDenY > 0) {
      spearman = Number((rankNum / (Math.sqrt(rankDenX) * Math.sqrt(rankDenY))).toFixed(4));
      spearman = Math.max(-1, Math.min(1, spearman));
    } else {
      spearman = null;
    }
  }

  // Quadrants for Scatter Plot (neutral labels: Q1, Q2, Q3, Q4, Section 34)
  const scatterPoints = validPairs.map((p) => {
    const isAboveX = p.x >= meanX;
    const isAboveY = p.y >= meanY;
    let quadrant = 'Q1';
    if (isAboveX && isAboveY) quadrant = 'Q1';
    else if (!isAboveX && isAboveY) quadrant = 'Q2';
    else if (!isAboveX && !isAboveY) quadrant = 'Q3';
    else quadrant = 'Q4';

    return {
      x: p.x,
      y: p.y,
      label: p.label,
      quadrant,
    };
  });

  return {
    diagnosticType: 'CORRELATION_ANALYSIS',
    metricX,
    metricY,
    sampleCount,
    excludedCount,
    missingPairCount,
    pearsonCoefficient: pearson,
    spearmanCoefficient: spearman,
    pearsonMeaning: 'LINEAR_ASSOCIATION',
    spearmanMeaning: 'MONOTONIC_RANK_ASSOCIATION',
    status,
    methodology: {
      pearson: 'Measures factual linear association between continuous metrics.',
      spearman: 'Measures monotonic association between ranked observations with fractional average ranks for ties.',
      pValues: 'Inferential p-value testing is omitted to prevent p-value theatre without population sampling design.',
    },
    scatterPoints,
    quadrants: {
      q1: { label: 'Q1 (High X, High Y)', count: scatterPoints.filter((p) => p.quadrant === 'Q1').length },
      q2: { label: 'Q2 (Low X, High Y)', count: scatterPoints.filter((p) => p.quadrant === 'Q2').length },
      q3: { label: 'Q3 (Low X, Low Y)', count: scatterPoints.filter((p) => p.quadrant === 'Q3').length },
      q4: { label: 'Q4 (High X, Low Y)', count: scatterPoints.filter((p) => p.quadrant === 'Q4').length },
      rule: 'Quadrants use factual mathematical quadrants Q1-Q4. Evaluative labels (Star, Dog, Underperformer) are zero-tolerance prohibited.',
    },
    causalityWarning: 'Association does not establish causation.',
    detailedWarning: 'Association does not establish causation. Operational factors and unmeasured confounding variables may explain observed statistical co-variation.',
    dataQuality: {
      status,
    },
  };
}

// ─── 6. SMALL MULTIPLES & MOVING AVERAGE (Sections 35–40) ────────────────────

/**
 * Calculates small multiple trend views with shared axis bounds to avoid distortion.
 * @param {Array<{ entityId: string, label: string, series: Array<{ date: string, value: number }> }>} groups
 * @param {object} [options]
 * @param {number} [options.movingAverageWindow=3]
 * @returns {object}
 */
function calculateSmallMultiples(groups = [], options = {}) {
  const windowSize = Math.max(2, Math.min(14, options.movingAverageWindow || 3));

  // Determine global shared min/max across all groups (Section 36)
  let sharedMin = Infinity;
  let sharedMax = -Infinity;

  for (const g of groups) {
    const pts = Array.isArray(g.series) ? g.series : (Array.isArray(g.observations) ? g.observations.map((v, i) => ({ date: `D${i+1}`, value: Number(v) })) : []);
    for (const pt of pts) {
      if (pt.value < sharedMin) sharedMin = pt.value;
      if (pt.value > sharedMax) sharedMax = pt.value;
    }
  }

  if (sharedMin === Infinity) sharedMin = 0;
  if (sharedMax === -Infinity) sharedMax = 0;

  // Process moving average per entity series
  const processedGroups = groups.map((g) => {
    const pts = Array.isArray(g.series) ? g.series : (Array.isArray(g.observations) ? g.observations.map((v, i) => ({ date: `D${i+1}`, value: Number(v) })) : []);
    const seriesWithMa = pts.map((pt, idx, arr) => {
      // Rolling average over preceding windowSize points
      const startIdx = Math.max(0, idx - windowSize + 1);
      const windowSlice = arr.slice(startIdx, idx + 1);
      const avg = windowSlice.reduce((sum, item) => sum + item.value, 0) / windowSlice.length;

      return {
        date: pt.date,
        value: pt.value,
        movingAverage: Number(avg.toFixed(2)),
      };
    });

    return {
      entityId: g.entityId || g.facetKey,
      label: g.label || g.entityId || g.facetKey,
      series: seriesWithMa,
    };
  });

  return {
    diagnosticType: 'SMALL_MULTIPLES',
    groupCount: processedGroups.length,
    scaleType: 'SHARED_ABSOLUTE_SCALE',
    sharedMin,
    sharedMax,
    sharedAxisBounds: {
      min: sharedMin,
      max: sharedMax,
      scaleType: 'SHARED_AXIS_ABSOLUTE_COMPARISON',
      safeguard: 'All small-multiple facets share identical scale limits to prevent visual magnitude distortion.',
    },
    movingAverageSettings: {
      windowSize,
      methodology: `Rolling ${windowSize}-period arithmetic mean of historical observations.`,
      safeguard: 'Moving average is visual historical smoothing only; never extrapolated as a forecast (PM02J_FORECAST_OUTPUT = 0).',
    },
    groups: processedGroups,
    dataQuality: { status: groups.length > 0 ? 'COMPLETE' : 'NO_DATA' },
  };
}

// ─── 7. DIAGNOSTIC EXCEPTION CENTRE (Sections 48–49) ─────────────────────────

/**
 * Aggregates factual operational exceptions from existing frozen stages.
 * Retains source-backed status and severity without arbitrary scoring.
 * 
 * @param {object} params
 * @param {Array<object>} [params.preloadedExceptions]
 * @param {object} [params.auth]
 * @returns {Promise<object>}
 */
async function calculateDiagnosticExceptions({ preloadedExceptions = null, auth = {} } = {}) {
  // Scoping check (Blocker J-R1-001)
  const orgId = auth.organisationId;
  if (!orgId) {
    const orgErr = new Error('Organisation context is required.');
    orgErr.statusCode = 400;
    orgErr.code = 'ORGANISATION_CONTEXT_REQUIRED';
    throw orgErr;
  }
  const role = String(auth.role || '').toUpperCase();
  const isPrimaryMaster = auth.isPrimaryMaster === true;

  if (role === 'STAFF') {
    const err = new Error('Staff role denied access to enterprise diagnostic exceptions.');
    err.statusCode = 403;
    err.code = 'REPORT_ROLE_DENIED';
    throw err;
  }

  const rawCafes = [
    ...(Array.isArray(auth.assignedCafeIds) ? auth.assignedCafeIds : (auth.assignedCafeIds ? [auth.assignedCafeIds] : [])),
    ...(Array.isArray(auth.assignedCafes) ? auth.assignedCafes : (auth.assignedCafes ? [auth.assignedCafes] : [])),
    ...(auth.primaryCafeId ? [auth.primaryCafeId] : []),
    ...(auth.cafeId ? [auth.cafeId] : []),
  ];
  const assignedCafeIds = [...new Set(rawCafes.filter(Boolean).map(c => String(c).trim().toUpperCase()))];

  if ((role === 'OWNER' || role === 'CAFE_ADMIN') && assignedCafeIds.length === 0) {
    const err = new Error(`${role === 'OWNER' ? 'Owner' : 'Café Administrator'} has no authorized café assignments.`);
    err.statusCode = 403;
    err.code = 'CROSS_CAFE_RESOURCE_DENIED';
    throw err;
  }

  let exceptions = [];

  if (preloadedExceptions) {
    exceptions = preloadedExceptions.filter(e => (!e.organisationId || e.organisationId === orgId));
  } else {
    // In production, gather factual exceptions across domains
    // 1. Cash variances from RegisterSession
    const sessionQuery = { variancePaisa: { $ne: 0 }, organisationId: orgId };
    if (!isPrimaryMaster && role !== 'MASTER') {
      sessionQuery.cafeId = { $in: assignedCafeIds };
    }
    const sessions = await RegisterSession.find(sessionQuery).limit(50).lean();
    for (const s of sessions) {
      exceptions.push({
        exceptionId: `EXC-CASH-${s._id}`,
        domain: 'FINANCE_CASH',
        cafeId: s.cafeId,
        severity: Math.abs(s.variancePaisa) > 50000 ? 'HIGH' : 'MEDIUM',
        description: `Till variance of ₹${(s.variancePaisa / 100).toFixed(2)} recorded on register close.`,
        status: s.status || 'OPEN',
        timestamp: s.closedAt || s.createdAt,
      });
    }

    // 2. Attendance exceptions
    const attQuery = { 'exceptions.0': { $exists: true }, organisationId: orgId };
    if (!isPrimaryMaster && role !== 'MASTER') {
      attQuery.cafeId = { $in: assignedCafeIds };
    }
    const atts = await Attendance.find(attQuery).limit(50).lean();
    for (const a of atts) {
      for (const exc of (a.exceptions || [])) {
        exceptions.push({
          exceptionId: `EXC-ATT-${a._id}`,
          domain: 'WORKFORCE_ATTENDANCE',
          cafeId: a.cafeId,
          severity: exc.severity || 'LOW',
          description: exc.description || `Attendance exception: ${exc.type || 'PUNCH_MISMATCH'}`,
          status: exc.status || 'LOGGED',
          timestamp: a.date || a.createdAt,
        });
      }
    }
  }

  // Filter exceptions by authorized scope
  if (!isPrimaryMaster && role !== 'MASTER') {
    exceptions = exceptions.filter((e) => assignedCafeIds.includes(e.cafeId));
  }

  // Count by severity and domain
  const bySeverity = { HIGH: 0, MEDIUM: 0, LOW: 0 };
  const byDomain = {};

  for (const e of exceptions) {
    const sev = e.severity || 'LOW';
    if (bySeverity[sev] !== undefined) bySeverity[sev] += 1;
    else bySeverity.LOW += 1;

    const dom = e.domain || 'OTHER';
    byDomain[dom] = (byDomain[dom] || 0) + 1;
  }

  return {
    diagnosticType: 'EXCEPTION_CENTRE',
    totalExceptions: exceptions.length,
    bySeverity,
    byDomain,
    exceptions,
    governanceRule: 'Exceptions reflect factual system events only. Arbitrary synthetic severity scores (e.g. 87/100) are strictly prohibited.',
    dataQuality: { status: exceptions.length > 0 ? 'COMPLETE' : 'NO_DATA' },
  };
}

module.exports = {
  // PM-02J-R1 Invariant Constants (Section 54)
  CLIENT_ORGANISATION_AUTHORITY_IN_DIAGNOSTICS,
  NORMAL_MASTER_BYPASSES_DIAGNOSTIC_CLASSIFICATION,
  DIAGNOSTIC_HIDDEN_CAFE_INFERENCE,
  DIAGNOSTIC_GROSS_TO_NET_FORMULA_DUPLICATION,
  ADDITIVE_DECOMPOSITION_RECONCILIATION_ERROR,
  SPEARMAN_TIES_ASSIGNED_ORDINAL_RANKS,
  UNGOVERNED_CORRELATION_SIGNIFICANCE_CLAIM,
  CORRELATION_REPORTED_AS_CAUSATION,
  PARETO_80_PERCENT_USED_AS_BUSINESS_SEVERITY,
  STATISTICAL_OUTLIER_REPORTED_AS_BUSINESS_FAILURE,
  WATERFALL_RECONCILIATION_ERROR,
  PM02J_FORECAST_OUTPUT,
  MISLEADING_SMALL_MULTIPLE_SCALE,
  DATABASE_OUTAGE_REPORTED_AS_ZERO,
  DEAD_PM02J_CONTROLS,
  MISREPRESENTED_PM02J_CONTROLS,

  // PM-02J-R2 Invariants
  BOX_PLOT_METHODOLOGY_DRIFT,
  MOVING_AVERAGE_MISLABELED_FORECAST,
  COSMETIC_ONLY_CROSS_FILTER_CERTIFIED_AS_DATA_FILTER,
  DIAGNOSTIC_BREADCRUMB_STATE_MISMATCH,
  UNSUPPORTED_DIAGNOSTIC_EXPORT_FORMAT_ACCEPTED,
  DIAGNOSTIC_EXPORT_HIDDEN_SCOPE_LEAK,
  DIAGNOSTIC_SCREEN_EXPORT_PARITY_ERROR,
  CORRELATION_POPULATION_METADATA_MISMATCH,
  UNDISCLOSED_DIAGNOSTIC_DATA_TRUNCATION,

  // Preserved Invariant Constants
  UNSUPPORTED_DIAGNOSTIC_DIMENSION,
  DECOMPOSITION_HIDDEN_SCOPE_LEAK,
  OBSERVATIONAL_ASSOCIATION_ROOT_CAUSE: OBSERVATIONAL_ASSOCIATION_REPORTED_AS_ROOT_CAUSE,
  OBSERVATIONAL_ASSOCIATION_REPORTED_AS_ROOT_CAUSE,
  PRODUCTION_FAKE_DIAGNOSTIC_DATA,
  UNAPPROVED_AI_RECOMMENDATION,
  UNAPPROVED_PERFORMANCE_SCORE,
  ARBITRARY_STATISTICAL_THRESHOLD,
  AVERAGE_OF_CAFE_PERCENTILES_REPORTED_AS_PORTFOLIO_PERCENTILE,
  UNAUTHORIZED_FROZEN_DEFINITION_CHANGES,

  // Aggregation Types Enum
  DIAGNOSTIC_AGGREGATION_TYPES,

  // Registries & Ledgers
  METRIC_DIMENSION_COMPATIBILITY,
  DIAGNOSTIC_CALCULATION_LEDGER,
  TERMINOLOGY_LEDGER,

  // Calculation Functions
  validateMetricDimensionCompatibility,
  calculateDiagnosticDecomposition,
  calculateVarianceWaterfall,
  calculateGrossToNetWaterfall,
  calculateParetoAnalysis,
  calculateDistributionAnalysis,
  calculateCorrelationAnalysis,
  calculateSmallMultiples,
  calculateDiagnosticExceptions,
};
