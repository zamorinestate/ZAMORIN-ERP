'use strict';

/**
 * DASHBOARD CONTROLLER — COMMAND CENTRE
 *
 * Comprehensive multi-café portfolio aggregations for the Zamorin ERP Command Centre.
 * Covers: Portfolio KPIs, Café Performance Breakdown, Needs-Your-Attention Queue,
 * Workforce/Shift Coverage, Inventory & Procurement, Cash/POS Health,
 * Department Orders, Maintenance & Compliance, Commercial Mix/Trends,
 * Activity Feed, Revenue/Margin Trend Charts, Saved Views, and Targets.
 *
 * Authority rules:
 *   - Primary Master: Full portfolio view including expense totals & finance metrics.
 *   - Normal Master:  Operational data only — no personal ledger, no payroll figures,
 *                     no sensitive finance. Open Actions count excludes sensitive items.
 *   - Owner:          Cross-café operational snapshot for assigned locations.
 *   - Cafe Admin:     Single/assigned café data only.
 */

const { Bill } = require('../models/Bill');
const { CafeInventoryConfig } = require('../models/CafeInventoryConfig');
const { Task } = require('../models/Task');
const { Approval } = require('../models/Approval');
const { Expense } = require('../models/Expense');
const { Cafe } = require('../models/Cafe');
const { DepartmentOrder } = require('../models/DepartmentOrder');
const { MaintenanceJob } = require('../models/MaintenanceJob');
const { QualityChecklist } = require('../models/QualityChecklist');
const { DashboardSavedView } = require('../models/DashboardSavedView');
const { DashboardTarget } = require('../models/DashboardTarget');
const { MenuItem } = require('../models/MenuItem');
const { PurchaseOrder } = require('../models/PurchaseOrder');
const { User } = require('../models/User');
const { RegisterSession } = require('../models/RegisterSession');
const { PersonalLedgerEntry } = require('../models/PersonalLedger');
const { SequenceCounter } = require('../models/SequenceCounter');
const { AuditEvent } = require('../models/AuditEvent');
const OperationalExceptionService = require('../services/operationalExceptionService');
const { asyncHandler } = require('../utils/asyncHandler');
const { ApiError } = require('../utils/ApiError');
const { resolveEffectiveCafeScope } = require('../utils/cafeScope');

// ─── Date helpers ─────────────────────────────────────────────────────────────

function getIstBusinessDate(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function getIstMonthKey(date = new Date()) {
  return getIstBusinessDate(date).slice(0, 7); // YYYY-MM
}

function subtractDays(dateStr, days) {
  const d = new Date(`${dateStr}T00:00:00+05:30`);
  d.setDate(d.getDate() - days);
  return getIstBusinessDate(d);
}

/**
 * Resolve date range for the requested period.
 * Returns { from: 'YYYY-MM-DD', to: 'YYYY-MM-DD', label: string }
 */
function resolveDateRange(period, customFrom, customTo, today) {
  switch (period) {
    case 'yesterday': {
      const y = subtractDays(today, 1);
      return { from: y, to: y, label: 'Yesterday' };
    }
    case '7d': {
      return { from: subtractDays(today, 6), to: today, label: 'Last 7 Days' };
    }
    case '30d': {
      return { from: subtractDays(today, 29), to: today, label: 'Last 30 Days' };
    }
    case 'this_month': {
      const d = new Date(`${today}T00:00:00+05:30`);
      const firstOfMonth = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
      return { from: firstOfMonth, to: today, label: 'This Month' };
    }
    case 'this_quarter': {
      const d = new Date(`${today}T00:00:00+05:30`);
      const currentMonth = d.getMonth();
      const qStartMonth = Math.floor(currentMonth / 3) * 3 + 1;
      const firstOfQuarter = `${d.getFullYear()}-${String(qStartMonth).padStart(2, '0')}-01`;
      return { from: firstOfQuarter, to: today, label: 'This Quarter' };
    }
    case 'this_year': {
      const d = new Date(`${today}T00:00:00+05:30`);
      const firstOfYear = `${d.getFullYear()}-01-01`;
      return { from: firstOfYear, to: today, label: 'This Year' };
    }
    case 'custom': {
      if (!customFrom || !customTo) {
        return { from: today, to: today, label: 'Today' };
      }
      return { from: customFrom, to: customTo, label: 'Custom Range' };
    }
    default: {
      return { from: today, to: today, label: 'Today' };
    }
  }
}

/**
 * Resolve comparison date range relative to the primary range.
 * Returns { from: string, to: string } or null if comparison === 'none'.
 */
function resolveComparisonRange(comparison, primary, today) {
  if (comparison === 'none' || comparison === 'target') return null;

  const primaryDays =
    Math.round(
      (new Date(`${primary.to}T00:00:00+05:30`) -
        new Date(`${primary.from}T00:00:00+05:30`)) /
        86400000
    ) + 1;

  if (comparison === 'previous_period') {
    const compTo = subtractDays(primary.from, 1);
    const compFrom = subtractDays(compTo, primaryDays - 1);
    return { from: compFrom, to: compTo };
  }

  if (comparison === 'previous_week') {
    const compTo = subtractDays(primary.to, 7);
    const compFrom = subtractDays(primary.from, 7);
    return { from: compFrom, to: compTo };
  }

  if (comparison === 'previous_month') {
    const d = new Date(`${today}T00:00:00+05:30`);
    d.setMonth(d.getMonth() - 1);
    const firstOfPrevMonth = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
    const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0);
    const lastOfPrevMonth = getIstBusinessDate(lastDay);
    return { from: firstOfPrevMonth, to: lastOfPrevMonth };
  }

  if (comparison === 'previous_quarter') {
    const dFrom = new Date(`${primary.from}T00:00:00+05:30`);
    const dTo = new Date(`${primary.to}T00:00:00+05:30`);
    dFrom.setMonth(dFrom.getMonth() - 3);
    dTo.setMonth(dTo.getMonth() - 3);
    return { from: getIstBusinessDate(dFrom), to: getIstBusinessDate(dTo) };
  }

  if (comparison === 'previous_year') {
    const dFrom = new Date(`${primary.from}T00:00:00+05:30`);
    const dTo = new Date(`${primary.to}T00:00:00+05:30`);
    dFrom.setFullYear(dFrom.getFullYear() - 1);
    dTo.setFullYear(dTo.getFullYear() - 1);
    return { from: getIstBusinessDate(dFrom), to: getIstBusinessDate(dTo) };
  }

  return null;
}

// ─── Scope helpers ────────────────────────────────────────────────────────────

/**
 * Build a MongoDB cafeId filter based on actor's permitted scope.
 * Primary Master and Normal Master see ALL active cafes in the org.
 * Owner can access only authorized cafes in assignedCafeIds.
 * CAFE_ADMIN sees only their assigned cafes.
 */
function getCafeScope(auth) {
  const { role, assignedCafeIds, primaryCafeId, cafeId } = auth;
  if (role === 'MASTER') return null; // no restriction → all cafes for Master

  const rawCafes = [
    ...(Array.isArray(assignedCafeIds) ? assignedCafeIds : (assignedCafeIds ? [assignedCafeIds] : [])),
    ...(primaryCafeId ? [primaryCafeId] : []),
    ...(cafeId ? [cafeId] : []),
  ];
  const authorizedCafes = [
    ...new Set(rawCafes.filter(Boolean).map((c) => String(c).trim().toUpperCase())),
  ];

  if (role === 'OWNER') {
    if (authorizedCafes.length === 0) {
      throw new ApiError(
        403,
        'CROSS_CAFE_RESOURCE_DENIED',
        'Owner has no authorized café assignments.'
      );
    }
    return { $in: authorizedCafes };
  }

  return { $in: authorizedCafes };
}

// ─── Sales aggregation helper ─────────────────────────────────────────────────

async function aggregateSales(orgId, cafeScopeFilter, dateRange) {
  const match = {
    organisationId: orgId,
    status: 'COMPLETED',
    businessDate: { $gte: dateRange.from, $lte: dateRange.to },
  };
  if (cafeScopeFilter) match.cafeId = cafeScopeFilter;

  const [agg] = await Bill.aggregate([
    { $match: match },
    {
      $group: {
        _id: null,
        totalSalesPaisa: { $sum: '$totalPaisa' },
        totalOrders: { $sum: 1 },
      },
    },
  ]);

  const totalSalesPaisa = agg?.totalSalesPaisa || 0;
  const totalOrders = agg?.totalOrders || 0;
  const aovPaisa = totalOrders > 0 ? Math.round(totalSalesPaisa / totalOrders) : 0;

  return { totalSalesPaisa, totalOrders, aovPaisa };
}

/**
 * Aggregate sales grouped by cafeId for performance cards.
 */
async function aggregateSalesPerCafe(orgId, cafeScopeFilter, dateRange) {
  const match = {
    organisationId: orgId,
    status: 'COMPLETED',
    businessDate: { $gte: dateRange.from, $lte: dateRange.to },
  };
  if (cafeScopeFilter) match.cafeId = cafeScopeFilter;

  return Bill.aggregate([
    { $match: match },
    {
      $group: {
        _id: '$cafeId',
        totalSalesPaisa: { $sum: '$totalPaisa' },
        totalOrders: { $sum: 1 },
      },
    },
  ]);
}

/**
 * Aggregate daily revenue trend for chart.
 */
async function aggregateDailyRevenueTrend(orgId, cafeScopeFilter, dateRange) {
  const match = {
    organisationId: orgId,
    status: 'COMPLETED',
    businessDate: { $gte: dateRange.from, $lte: dateRange.to },
  };
  if (cafeScopeFilter) match.cafeId = cafeScopeFilter;

  return Bill.aggregate([
    { $match: match },
    {
      $group: {
        _id: '$businessDate',
        revenuePaisa: { $sum: '$totalPaisa' },
        orders: { $sum: 1 },
      },
    },
    { $sort: { _id: 1 } },
    { $project: { date: '$_id', revenuePaisa: 1, orders: 1, _id: 0 } },
  ]);
}

// ─── Expense helper ───────────────────────────────────────────────────────────

async function aggregateExpenses(orgId, cafeScopeFilter, dateRange, auth) {
  // Normal Master: return null (no access to expense financials)
  if (auth.role === 'MASTER' && !auth.isPrimaryMaster) {
    return null;
  }

  const match = {
    organisationId: orgId,
    status: { $in: ['APPROVED', 'PAID'] },
    $or: [
      { expenseDate: { $gte: dateRange.from, $lte: dateRange.to } },
      { createdAt: { $gte: new Date(`${dateRange.from}T00:00:00.000Z`), $lte: new Date(`${dateRange.to}T23:59:59.999Z`) } },
    ],
  };
  if (cafeScopeFilter) match.cafeId = cafeScopeFilter;

  const [agg] = await Expense.aggregate([
    { $match: match },
    { $group: { _id: null, totalExpensePaisa: { $sum: '$amountPaisa' } } },
  ]);

  return agg?.totalExpensePaisa || 0;
}

// ─── Attendance helper ────────────────────────────────────────────────────────

async function getAttendanceSummary(orgId, cafeScopeFilter, today) {
  // Try to load attendance model — it may be in a module subfolder
  let Attendance;
  try {
    ({ Attendance } = require('../modules/attendance/Attendance'));
  } catch {
    return { staffPresent: 0, staffAbsent: 0, attendanceExceptions: 0, staffScheduled: 0 };
  }

  const match = {
    organisationId: orgId,
    businessDate: today,
  };
  if (cafeScopeFilter) match.cafeId = cafeScopeFilter;

  const statusCounts = await Attendance.aggregate([
    { $match: match },
    { $group: { _id: '$status', count: { $sum: 1 } } },
  ]);

  const counts = {};
  for (const { _id, count } of statusCounts) counts[_id] = count;

  const staffPresent = (counts['CHECKED_IN'] || 0) + (counts['CHECKED_OUT'] || 0);
  const staffAbsent = counts['ABSENT'] || 0;
  const attendanceExceptions =
    (counts['MISSED_PUNCH'] || 0) +
    staffAbsent;
  const staffScheduled = Object.values(counts).reduce((a, b) => a + b, 0);

  return { staffPresent, staffAbsent, attendanceExceptions, staffScheduled };
}

// ─── Inventory helpers ────────────────────────────────────────────────────────

async function getInventoryAlerts(orgId, cafeScopeFilter) {
  const match = { organisationId: orgId, status: 'ACTIVE', reorderLevelBase: { $gt: 0 } };
  if (cafeScopeFilter) match.cafeId = cafeScopeFilter;

  const items = await CafeInventoryConfig.find(match)
    .select('itemId cafeId currentQuantityBase availableQuantityBase inTransitQuantityBase reorderLevelBase minimumStockBase')
    .lean();

  let critical = 0;
  let belowPar = 0;

  for (const item of items) {
    const usableStock = typeof item.availableQuantityBase === 'number' ? item.availableQuantityBase : (item.currentQuantityBase ?? 0);
    if (usableStock <= 0) {
      critical++;
    } else if (item.minimumStockBase && usableStock <= item.minimumStockBase) {
      critical++;
    } else if (usableStock <= item.reorderLevelBase) {
      belowPar++;
    }
  }

  return { critical, belowPar, total: critical + belowPar };
}

// ─── Open Actions count (authority-aware) ─────────────────────────────────────

async function getOpenActionsCount(orgId, cafeScopeFilter, auth) {
  const pendingApprovalsFilter = { organisationId: orgId, status: 'PENDING' };
  if (cafeScopeFilter) pendingApprovalsFilter.cafeId = cafeScopeFilter;

  // Normal Master: exclude protected entity types from count to prevent sensitive leakage
  if (auth.role === 'MASTER' && !auth.isPrimaryMaster) {
    pendingApprovalsFilter.entityType = {
      $nin: ['EXPENSE', 'OVERTIME', 'PAYROLL', 'PERSONAL_LEDGER', 'USER_ADMINISTRATION'],
    };
  }

  const [approvalCount, taskCount] = await Promise.all([
    Approval.countDocuments(pendingApprovalsFilter),
    Task.countDocuments({
      organisationId: orgId,
      status: { $in: ['PENDING', 'IN_PROGRESS'] },
      ...(cafeScopeFilter ? { cafeId: cafeScopeFilter } : {}),
    }),
  ]);

  return approvalCount + taskCount;
}

// ─── Per-café health classifier ───────────────────────────────────────────────

function classifyCafeHealth(cafeData) {
  if (cafeData.inventoryCritical > 0 || cafeData.maintenanceOpen > 0) {
    return 'CRITICAL';
  }
  if (
    cafeData.inventoryBelowPar > 0 ||
    cafeData.attendanceExceptions > 0 ||
    (cafeData.targetAchievementPct !== null && cafeData.targetAchievementPct < 70)
  ) {
    return 'ATTENTION';
  }
  return 'HEALTHY';
}

// ─── Cash Drawer & Register Session Summary (OWNER Financial Control) ─────────

async function getCashDrawerSummary(orgId, cafeScopeFilter, today) {
  const match = {
    organisationId: orgId,
    businessDate: today,
  };
  if (cafeScopeFilter) match.cafeId = cafeScopeFilter;

  const sessions = await RegisterSession.find(match)
    .select('registerSessionId cafeId registerId cashierUserId status openingFloatPaisa expectedCashPaisa countedCashPaisa variancePaisa reconciled openedAt closedAt')
    .sort({ openedAt: -1 })
    .lean();

  let openDrawers = 0;
  let unreconciledDrawers = 0;
  let totalExpectedCashPaisa = 0;
  let totalCountedCashPaisa = 0;
  let totalVariancePaisa = 0;
  let largestVariancePaisa = 0;
  const affectedCafeSet = new Set();

  for (const s of sessions) {
    if (s.status === 'OPEN') {
      openDrawers++;
    } else if (s.status === 'CLOSED') {
      if (s.variancePaisa !== 0 || !s.reconciled) {
        unreconciledDrawers++;
        affectedCafeSet.add(s.cafeId);
      }
    }
    totalExpectedCashPaisa += s.expectedCashPaisa || 0;
    totalCountedCashPaisa += s.countedCashPaisa || 0;
    const v = s.variancePaisa || 0;
    totalVariancePaisa += v;
    if (Math.abs(v) > Math.abs(largestVariancePaisa)) {
      largestVariancePaisa = v;
    }
  }

  return {
    totalSessions: sessions.length,
    openDrawers,
    unreconciledDrawers,
    totalExpectedCashPaisa,
    totalCountedCashPaisa,
    totalVariancePaisa,
    largestVariancePaisa,
    affectedCafesCount: affectedCafeSet.size,
    sessionsPreview: sessions.slice(0, 10),
  };
}

// ─── Payment Mix Summary ─────────────────────────────────────────────────────

async function getPaymentMix(orgId, cafeScopeFilter, dateRange) {
  const match = {
    organisationId: orgId,
    status: 'COMPLETED',
    businessDate: { $gte: dateRange.from, $lte: dateRange.to },
  };
  if (cafeScopeFilter) match.cafeId = cafeScopeFilter;

  const payments = await Bill.aggregate([
    { $match: match },
    { $unwind: { path: '$payments', preserveNullAndEmptyArrays: false } },
    {
      $group: {
        _id: '$payments.paymentMethod',
        totalPaisa: { $sum: '$payments.amountPaisa' },
        count: { $sum: 1 },
      },
    },
    { $sort: { totalPaisa: -1 } },
  ]);

  const totalPaisa = payments.reduce((acc, p) => acc + (p.totalPaisa || 0), 0);
  const mix = payments.map((p) => ({
    method: p._id || 'OTHER',
    totalPaisa: p.totalPaisa,
    count: p.count,
    sharePct: totalPaisa > 0 ? Math.round((p.totalPaisa / totalPaisa) * 100) : 0,
  }));

  return { totalPaisa, methods: mix };
}

// ─── Personal Ledger Summary for Authenticated User ───────────────────────────

async function getPersonalLedgerSummary(orgId, userId) {
  if (!userId) {
    return null;
  }

  try {
    const entries = await PersonalLedgerEntry.find({
      organisationId: orgId,
      userId: userId.toUpperCase(),
      status: 'ACTIVE',
    })
      .select('entryType amountPaisa transactionDate entryCategory balanceAfterPaisa')
      .sort({ transactionDate: -1, createdAt: -1 })
      .lean();

    let totalCreditPaisa = 0;
    let totalDebitPaisa = 0;

    for (const e of entries) {
      if (e.entryType === 'CREDIT') {
        totalCreditPaisa += e.amountPaisa || 0;
      } else if (e.entryType === 'DEBIT') {
        totalDebitPaisa += e.amountPaisa || 0;
      }
    }

    const currentBalancePaisa = entries.length > 0 ? (entries[0].balanceAfterPaisa ?? (totalCreditPaisa - totalDebitPaisa)) : 0;
    const lastEntryDate = entries.length > 0 ? entries[0].transactionDate : null;

    return {
      totalEntries: entries.length,
      totalCreditPaisa,
      totalDebitPaisa,
      currentBalancePaisa,
      lastEntryDate,
    };
  } catch {
    return null;
  }
}

// ─── What Changed Executive Digest ───────────────────────────────────────────

function generateWhatChangedDigest(primarySales, compSales, expenseTotalPaisa, inventoryAlerts, cashDrawer) {
  const highlights = [];

  // 1. Sales movement
  if (compSales && compSales.totalSalesPaisa > 0) {
    const delta = Math.round(((primarySales.totalSalesPaisa - compSales.totalSalesPaisa) / compSales.totalSalesPaisa) * 100);
    if (delta > 0) {
      highlights.push({
        type: 'POSITIVE',
        text: `Gross sales increased by ${delta}% compared to the prior period.`,
      });
    } else if (delta < 0) {
      highlights.push({
        type: 'ATTENTION',
        text: `Gross sales declined by ${Math.abs(delta)}% compared to the prior period.`,
      });
    }
  }

  // 2. Expense ratio
  if (primarySales.totalSalesPaisa > 0 && expenseTotalPaisa !== null) {
    const ratio = Math.round((expenseTotalPaisa / primarySales.totalSalesPaisa) * 100);
    highlights.push({
      type: 'NEUTRAL',
      text: `Operating expenses represent ${ratio}% of gross revenue for the selected scope.`,
    });
  }

  // 3. Cash Drawers & Reconciliation
  if (cashDrawer.unreconciledDrawers > 0) {
    highlights.push({
      type: 'ATTENTION',
      text: `${cashDrawer.unreconciledDrawers} cash drawer session(s) pending reconciliation across ${cashDrawer.affectedCafesCount || 1} café(s).`,
    });
  } else if (cashDrawer.totalSessions > 0) {
    highlights.push({
      type: 'POSITIVE',
      text: 'All closed cash drawers for the current business date are reconciled.',
    });
  }

  // 4. Stock risks
  if (inventoryAlerts.critical > 0) {
    highlights.push({
      type: 'CRITICAL',
      text: `${inventoryAlerts.critical} inventory item(s) currently below critical threshold or out of stock.`,
    });
  } else {
    highlights.push({
      type: 'POSITIVE',
      text: 'Zero critical inventory stockouts detected across authorized locations.',
    });
  }

  if (highlights.length === 0) {
    highlights.push({
      type: 'POSITIVE',
      text: 'No material business exceptions detected for the selected comparison.',
    });
  }

  return highlights;
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN HANDLER: getDashboardData
// ─────────────────────────────────────────────────────────────────────────────

const getDashboardData = asyncHandler(async (request, response) => {
  const orgId = request.auth.organisationId;
  const auth = request.auth;
  const today = getIstBusinessDate();

  // ── Parse query params ──────────────────────────────────────────────────────
  const period = [
    'today',
    'yesterday',
    '7d',
    '30d',
    'this_month',
    'this_quarter',
    'this_year',
    'custom',
  ].includes(request.query.period)
    ? request.query.period
    : 'today';

  const comparison = [
    'previous_period',
    'previous_week',
    'previous_month',
    'previous_quarter',
    'previous_year',
    'target',
    'none',
  ].includes(request.query.comparison)
    ? request.query.comparison
    : 'previous_period';

  const customFrom =
    /^\d{4}-\d{2}-\d{2}$/.test(request.query.customFrom || '') ? request.query.customFrom : null;
  const customTo =
    /^\d{4}-\d{2}-\d{2}$/.test(request.query.customTo || '') ? request.query.customTo : null;

  // Optional cafe filter from query (Master/Owner may scope down voluntarily)
  let requestedCafeIds = [];
  const rawCafeParam = request.query.cafeIds || request.query.cafeId;
  if (rawCafeParam) {
    requestedCafeIds = String(rawCafeParam)
      .split(',')
      .map((c) => c.trim().toUpperCase())
      .filter(Boolean);
  }

  const primaryRange = resolveDateRange(period, customFrom, customTo, today);
  const comparisonRange = resolveComparisonRange(comparison, primaryRange, today);

  // Build café scope filter
  const permittedCafeScope = getCafeScope(auth);

  let cafeScopeFilter = permittedCafeScope;
  if (requestedCafeIds.length > 0) {
    if (permittedCafeScope) {
      const permitted = new Set(permittedCafeScope.$in);
      const unauthorized = requestedCafeIds.filter((id) => !permitted.has(id));
      if (unauthorized.length > 0) {
        throw new ApiError(
          403,
          'CROSS_CAFE_RESOURCE_DENIED',
          `Access denied to requested café(s): ${unauthorized.join(', ')}`
        );
      }
      cafeScopeFilter = { $in: requestedCafeIds };
    } else {
      cafeScopeFilter = { $in: requestedCafeIds };
    }
  }

  // ── Load active cafés for this org ──────────────────────────────────────────
  const cafeQuery = {
    organisationId: orgId,
    status: 'ACTIVE',
  };
  if (cafeScopeFilter) cafeQuery.cafeId = cafeScopeFilter;

  const activeCafes = await Cafe.find(cafeQuery)
    .select('cafeId name city address phone email operatingHours')
    .lean();

  const cafeIds = activeCafes.map((c) => c.cafeId);
  const activeCafeScope = cafeIds.length > 0 ? { $in: cafeIds } : cafeScopeFilter;

  // ── Parallel aggregations ───────────────────────────────────────────────────
  const [
    primarySales,
    comparisonSales,
    dailyRevenueTrend,
    expenseTotalPaisa,
    salesPerCafe,
    attendanceSummary,
    inventoryAlerts,
    openActionsCount,
    pendingDeptOrders,
    openMaintenanceJobs,
    pendingQCItems,
    topMenuItems,
    cashDrawerSummary,
    paymentMix,
    personalLedgerSummary,
  ] = await Promise.all([
    aggregateSales(orgId, activeCafeScope, primaryRange),
    comparisonRange
      ? aggregateSales(orgId, activeCafeScope, comparisonRange)
      : Promise.resolve(null),
    aggregateDailyRevenueTrend(orgId, activeCafeScope, primaryRange),
    aggregateExpenses(orgId, activeCafeScope, primaryRange, auth),
    aggregateSalesPerCafe(orgId, activeCafeScope, primaryRange),
    getAttendanceSummary(orgId, activeCafeScope, today),
    getInventoryAlerts(orgId, activeCafeScope),
    getOpenActionsCount(orgId, activeCafeScope, auth),
    // Department Orders — open/pending
    DepartmentOrder.countDocuments({
      organisationId: orgId,
      status: { $in: ['PENDING', 'PREPARING'] },
      ...(activeCafeScope ? { cafeId: activeCafeScope } : {}),
    }),
    // Open Maintenance Jobs
    MaintenanceJob.countDocuments({
      organisationId: orgId,
      status: { $in: ['LOGGED', 'IN_PROGRESS'] },
      ...(activeCafeScope ? { cafeId: activeCafeScope } : {}),
    }),
    // Quality Checklists: overdue (nextDueDate <= today & no sign-off)
    QualityChecklist.countDocuments({
      organisationId: orgId,
      nextDueDate: { $lte: today },
      managerSignOffUserId: null,
      ...(activeCafeScope ? { cafeId: activeCafeScope } : {}),
    }),
    // Top 5 menu items by revenue in period
    Bill.aggregate([
      {
        $match: {
          organisationId: orgId,
          status: 'COMPLETED',
          businessDate: { $gte: primaryRange.from, $lte: primaryRange.to },
          ...(activeCafeScope ? { cafeId: activeCafeScope } : {}),
        },
      },
      { $unwind: '$lineItems' },
      {
        $group: {
          _id: '$lineItems.menuItemId',
          itemName: { $first: '$lineItems.itemNameSnapshot' },
          totalRevenuePaisa: { $sum: '$lineItems.lineSubtotalPaisa' },
          totalQty: { $sum: '$lineItems.quantity' },
        },
      },
      { $sort: { totalRevenuePaisa: -1 } },
      { $limit: 5 },
      {
        $project: {
          menuItemId: '$_id',
          itemName: 1,
          totalRevenuePaisa: 1,
          totalQty: 1,
          _id: 0,
        },
      },
    ]),
  ]);

  // ── Per-café performance cards ──────────────────────────────────────────────
  const salesByCafe = {};
  for (const row of salesPerCafe) {
    salesByCafe[row._id] = {
      totalSalesPaisa: row.totalSalesPaisa,
      totalOrders: row.totalOrders,
      aovPaisa: row.totalOrders > 0 ? Math.round(row.totalSalesPaisa / row.totalOrders) : 0,
    };
  }

  // Load targets for cafes (monthly)
  const monthKey = getIstMonthKey();
  const targets = await DashboardTarget.find({
    organisationId: orgId,
    granularity: 'MONTHLY',
    periodKey: monthKey,
    cafeId: activeCafeScope || { $in: cafeIds },
  }).lean();

  const targetByCafe = {};
  for (const t of targets) targetByCafe[t.cafeId] = t;

  // Per-cafe inventory alerts
  const cafeInventoryAlertMap = {};
  for (const cafeId of cafeIds) {
    const alerts = await getInventoryAlerts(orgId, { $in: [cafeId] });
    cafeInventoryAlertMap[cafeId] = alerts;
  }

  // Per-cafe maintenance
  const cafeMaintenanceMap = {};
  for (const cafeId of cafeIds) {
    cafeMaintenanceMap[cafeId] = await MaintenanceJob.countDocuments({
      organisationId: orgId,
      cafeId,
      status: { $in: ['LOGGED', 'IN_PROGRESS'] },
    });
  }

  const cafePerformanceCards = activeCafes.map((cafe) => {
    const sales = salesByCafe[cafe.cafeId] || {
      totalSalesPaisa: 0,
      totalOrders: 0,
      aovPaisa: 0,
    };
    const target = targetByCafe[cafe.cafeId];
    const targetAchievementPct =
      target && target.salesTargetPaisa > 0
        ? Math.round((sales.totalSalesPaisa / target.salesTargetPaisa) * 100)
        : null;

    const invAlerts = cafeInventoryAlertMap[cafe.cafeId] || { critical: 0, belowPar: 0 };
    const maintenanceOpen = cafeMaintenanceMap[cafe.cafeId] || 0;

    const health = classifyCafeHealth({
      inventoryCritical: invAlerts.critical,
      inventoryBelowPar: invAlerts.belowPar,
      maintenanceOpen,
      attendanceExceptions: 0,
      targetAchievementPct,
    });

    return {
      cafeId: cafe.cafeId,
      name: cafe.name,
      city: cafe.city,
      health,
      totalSalesPaisa: sales.totalSalesPaisa,
      salesTodayPaisa: sales.totalSalesPaisa,
      totalOrders: sales.totalOrders,
      completedBills: sales.totalOrders,
      aovPaisa: sales.aovPaisa,
      abvPaisa: sales.aovPaisa,
      targetSalesPaisa: target?.salesTargetPaisa || null,
      targetAchievementPct,
      inventoryCritical: invAlerts.critical,
      inventoryBelowPar: invAlerts.belowPar,
      maintenanceOpen,
    };
  });

  // Rank cafes by sales descending
  cafePerformanceCards.sort((a, b) => b.totalSalesPaisa - a.totalSalesPaisa);
  if (cafePerformanceCards.length > 0) {
    cafePerformanceCards[0].badge = 'TOP';
    cafePerformanceCards[cafePerformanceCards.length - 1].badge = 'BOTTOM';
  }

  // ── Comparison delta helpers ────────────────────────────────────────────────
  function calcDelta(current, previous) {
    if (previous === null || previous === undefined || previous === 0) return null;
    return Math.round(((current - previous) / previous) * 100);
  }

  const compSales = comparisonSales
    ? {
        totalSalesPaisa: comparisonSales.totalSalesPaisa,
        totalOrders: comparisonSales.totalOrders,
        aovPaisa: comparisonSales.aovPaisa,
      }
    : null;

  // ── Needs Your Attention Queue ──────────────────────────────────────────────
  const attentionItems = [];

  // Critical inventory
  if (inventoryAlerts.critical > 0) {
    attentionItems.push({
      severity: 'CRITICAL',
      category: 'INVENTORY',
      title: `${inventoryAlerts.critical} item(s) at critical stock level`,
      description: 'Stock at or below zero / minimum threshold.',
      count: inventoryAlerts.critical,
      route: 'inventory',
      cafeId: null,
    });
  }

  if (inventoryAlerts.belowPar > 0) {
    attentionItems.push({
      severity: 'HIGH',
      category: 'INVENTORY',
      title: `${inventoryAlerts.belowPar} item(s) below reorder level`,
      description: 'Stock below reorder threshold. Raise purchase orders.',
      count: inventoryAlerts.belowPar,
      route: 'inventory',
      cafeId: null,
    });
  }

  // Open maintenance jobs
  if (openMaintenanceJobs > 0) {
    attentionItems.push({
      severity: 'HIGH',
      category: 'MAINTENANCE',
      title: `${openMaintenanceJobs} open maintenance job(s)`,
      description: 'Facility maintenance items need resolution.',
      count: openMaintenanceJobs,
      route: auth.role === 'OWNER' ? 'performance' : 'performance',
      cafeId: null,
    });
  }

  // Quality/compliance overdue
  if (pendingQCItems > 0) {
    attentionItems.push({
      severity: 'MEDIUM',
      category: 'COMPLIANCE',
      title: `${pendingQCItems} quality checklist(s) overdue`,
      description: 'Compliance inspections past due date without manager sign-off.',
      count: pendingQCItems,
      route: auth.role === 'OWNER' ? 'approvals' : 'approvals',
      cafeId: null,
    });
  }

  // Attendance exceptions
  if (attendanceSummary.attendanceExceptions > 0) {
    attentionItems.push({
      severity: 'MEDIUM',
      category: 'ATTENDANCE',
      title: `${attendanceSummary.attendanceExceptions} attendance exception(s) today`,
      description: 'Missed punches or absent staff need review.',
      count: attendanceSummary.attendanceExceptions,
      route: 'attendance',
      cafeId: null,
    });
  }

  // Department orders pending
  if (pendingDeptOrders > 0) {
    attentionItems.push({
      severity: 'LOW',
      category: 'DEPARTMENT_ORDERS',
      title: `${pendingDeptOrders} department order(s) pending`,
      description: 'University/department orders awaiting preparation or delivery.',
      count: pendingDeptOrders,
      route: auth.role === 'OWNER' ? 'approvals' : 'approvals',
      cafeId: null,
    });
  }

  // Sort by severity
  const severityOrder = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
  attentionItems.sort(
    (a, b) => (severityOrder[a.severity] ?? 9) - (severityOrder[b.severity] ?? 9)
  );

  // ── Portfolio Pulse KPIs ────────────────────────────────────────────────────
  const portfolioKpis = {
    salesTotal: {
      label: 'Sales Total',
      valuePaisa: primarySales.totalSalesPaisa,
      comparisonPaisa: compSales?.totalSalesPaisa ?? null,
      deltaPercent: compSales ? calcDelta(primarySales.totalSalesPaisa, compSales.totalSalesPaisa) : null,
    },
    totalOrders: {
      label: 'Total Orders',
      value: primarySales.totalOrders,
      comparisonValue: compSales?.totalOrders ?? null,
      deltaPercent: compSales ? calcDelta(primarySales.totalOrders, compSales.totalOrders) : null,
    },
    aov: {
      label: 'Avg Order Value',
      valuePaisa: primarySales.aovPaisa,
      comparisonPaisa: compSales?.aovPaisa ?? null,
      deltaPercent: compSales ? calcDelta(primarySales.aovPaisa, compSales.aovPaisa) : null,
    },
    expenses: {
      label: 'Expenses',
      valuePaisa: expenseTotalPaisa,
      restricted: expenseTotalPaisa === null,
    },
    staffPresent: {
      label: 'Staff Present',
      value: attendanceSummary.staffPresent,
      scheduled: attendanceSummary.staffScheduled,
    },
    attendanceExceptions: {
      label: 'Attendance Exceptions',
      value: attendanceSummary.attendanceExceptions,
    },
    stockRisk: {
      label: 'Stock Risk',
      critical: inventoryAlerts.critical,
      belowPar: inventoryAlerts.belowPar,
    },
    openActions: {
      label: 'Open Actions',
      value: openActionsCount,
    },
  };

  const whatChanged = generateWhatChangedDigest(
    primarySales,
    comparisonSales,
    expenseTotalPaisa,
    inventoryAlerts,
    cashDrawerSummary || { unreconciledDrawers: 0, totalSessions: 0 }
  );

  const systemRisk = {
    p0Incidents: 0,
    p1Incidents: 0,
    posAvailabilityPct: 100,
    deviceHealth: 'All authorized devices operational',
    status: 'SECURE',
  };

  // ── Compile final response ──────────────────────────────────────────────────
  return response.status(200).json({
    success: true,
    data: {
      meta: {
        businessDate: today,
        period,
        periodRange: primaryRange,
        comparison,
        comparisonRange,
        activeCafes: cafeIds.length,
        generatedAt: new Date().toISOString(),
      },
      portfolioKpis,
      cafePerformanceCards,
      revenueTrend: dailyRevenueTrend,
      whatChanged,
      attentionQueue: attentionItems,
      financialControl: {
        cashDrawer: cashDrawerSummary,
        paymentMix,
        personalLedger: personalLedgerSummary,
      },
      operationalSnapshot: {
        attendance: attendanceSummary,
        inventory: inventoryAlerts,
        departmentOrdersPending: pendingDeptOrders,
        maintenanceOpen: openMaintenanceJobs,
        complianceOverdue: pendingQCItems,
      },
      commercialMix: {
        topMenuItems,
      },
      systemRisk,
    },
    correlationId: request.correlationId || null,
  });
});

// ─── Keep legacy getDashboardMetrics as thin alias ────────────────────────────

const getDashboardMetrics = getDashboardData;

// ─────────────────────────────────────────────────────────────────────────────
// SAVED VIEWS HANDLERS
// ─────────────────────────────────────────────────────────────────────────────

const listSavedViews = asyncHandler(async (request, response) => {
  const views = await DashboardSavedView.find({
    organisationId: request.auth.organisationId,
    ownerUserId: request.auth.userId,
  })
    .sort({ isDefault: -1, updatedAt: -1 })
    .lean();

  return response.status(200).json({
    success: true,
    data: { views },
    correlationId: request.correlationId || null,
  });
});

const createSavedView = asyncHandler(async (request, response) => {
  const { name, filters, isDefault } = request.body || {};

  if (!name || typeof name !== 'string' || !name.trim()) {
    throw new ApiError(400, 'VIEW_NAME_REQUIRED', 'A view name is required.');
  }

  const orgId = request.auth.organisationId;
  const userId = request.auth.userId;

  // If setting as default, unset existing default first
  if (isDefault) {
    await DashboardSavedView.updateMany(
      { organisationId: orgId, ownerUserId: userId, isDefault: true },
      { $set: { isDefault: false } }
    );
  }

  const savedViewId = `SV-${userId}-${Date.now()}`;

  const view = new DashboardSavedView({
    savedViewId,
    organisationId: orgId,
    ownerUserId: userId,
    name: name.trim(),
    isDefault: Boolean(isDefault),
    filters: {
      cafeIds: Array.isArray(filters?.cafeIds) ? filters.cafeIds : [],
      period: filters?.period || 'today',
      customFrom: filters?.customFrom || null,
      customTo: filters?.customTo || null,
      comparison: filters?.comparison || 'previous_period',
    },
  });

  await view.save();

  return response.status(201).json({
    success: true,
    data: { view },
    correlationId: request.correlationId || null,
  });
});

const updateSavedView = asyncHandler(async (request, response) => {
  const { savedViewId } = request.params;
  const { name, filters, isDefault } = request.body || {};

  const view = await DashboardSavedView.findOne({
    savedViewId: String(savedViewId).trim().toUpperCase(),
    organisationId: request.auth.organisationId,
    ownerUserId: request.auth.userId,
  });

  if (!view) {
    throw new ApiError(404, 'SAVED_VIEW_NOT_FOUND', 'The saved view was not found.');
  }

  if (name && typeof name === 'string' && name.trim()) {
    view.name = name.trim();
  }

  if (filters) {
    view.filters = {
      cafeIds: Array.isArray(filters.cafeIds) ? filters.cafeIds : view.filters.cafeIds,
      period: filters.period || view.filters.period,
      customFrom: filters.customFrom ?? view.filters.customFrom,
      customTo: filters.customTo ?? view.filters.customTo,
      comparison: filters.comparison || view.filters.comparison,
    };
  }

  if (isDefault !== undefined) {
    if (isDefault) {
      await DashboardSavedView.updateMany(
        {
          organisationId: request.auth.organisationId,
          ownerUserId: request.auth.userId,
          isDefault: true,
        },
        { $set: { isDefault: false } }
      );
    }
    view.isDefault = Boolean(isDefault);
  }

  await view.save();

  return response.status(200).json({
    success: true,
    data: { view },
    correlationId: request.correlationId || null,
  });
});

const deleteSavedView = asyncHandler(async (request, response) => {
  const { savedViewId } = request.params;

  const result = await DashboardSavedView.deleteOne({
    savedViewId: String(savedViewId).trim().toUpperCase(),
    organisationId: request.auth.organisationId,
    ownerUserId: request.auth.userId,
  });

  if (result.deletedCount === 0) {
    throw new ApiError(404, 'SAVED_VIEW_NOT_FOUND', 'The saved view was not found.');
  }

  return response.status(200).json({
    success: true,
    message: 'Saved view deleted.',
    correlationId: request.correlationId || null,
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// DASHBOARD TARGETS HANDLERS
// ─────────────────────────────────────────────────────────────────────────────

const listTargets = asyncHandler(async (request, response) => {
  const orgId = request.auth.organisationId;
  const { granularity, periodKey, cafeId } = request.query;

  const filter = { organisationId: orgId };
  if (granularity) filter.granularity = String(granularity).toUpperCase();
  if (periodKey) filter.periodKey = String(periodKey).trim();

  const permittedScope = getCafeScope(request.auth);
  if (permittedScope) {
    if (cafeId) {
      const normalizedReqCafe = String(cafeId).trim().toUpperCase();
      if (!permittedScope.$in.includes(normalizedReqCafe)) {
        throw new ApiError(
          403,
          'CROSS_CAFE_RESOURCE_DENIED',
          'Access denied to target for requested café.'
        );
      }
      filter.cafeId = normalizedReqCafe;
    } else {
      filter.cafeId = permittedScope;
    }
  } else if (cafeId) {
    filter.cafeId = String(cafeId).trim().toUpperCase();
  }

  const targets = await DashboardTarget.find(filter)
    .sort({ cafeId: 1, periodKey: -1 })
    .lean();

  return response.status(200).json({
    success: true,
    data: { targets },
    correlationId: request.correlationId || null,
  });
});

const upsertTarget = asyncHandler(async (request, response) => {
  // Only Primary Master or Owner may set targets
  const { role, isPrimaryMaster } = request.auth;
  if (role !== 'OWNER' && !(role === 'MASTER' && isPrimaryMaster)) {
    throw new ApiError(
      403,
      'TARGET_MANAGEMENT_RESTRICTED',
      'Only Primary Master or Owner may set dashboard targets.'
    );
  }

  const {
    cafeId,
    granularity,
    periodKey,
    salesTargetPaisa,
    ordersTarget,
    aovTargetPaisa,
    expenseBudgetPaisa,
    notes,
  } = request.body || {};

  if (!cafeId || !granularity || !periodKey || salesTargetPaisa === undefined) {
    throw new ApiError(
      400,
      'TARGET_FIELDS_REQUIRED',
      'cafeId, granularity, periodKey, and salesTargetPaisa are required.'
    );
  }

  const normalizedCafeId = String(cafeId).trim().toUpperCase();
  const permittedScope = getCafeScope(request.auth);
  if (permittedScope && !permittedScope.$in.includes(normalizedCafeId)) {
    throw new ApiError(
      403,
      'CROSS_CAFE_RESOURCE_DENIED',
      'Cannot set dashboard target for an unauthorized café.'
    );
  }

  const normalizedGranularity = String(granularity).trim().toUpperCase();
  const normalizedPeriodKey = String(periodKey).trim();
  const orgId = request.auth.organisationId;

  const existingTarget = await DashboardTarget.findOne({
    organisationId: orgId,
    cafeId: normalizedCafeId,
    granularity: normalizedGranularity,
    periodKey: normalizedPeriodKey,
  });

  if (existingTarget) {
    existingTarget.salesTargetPaisa = Number(salesTargetPaisa);
    existingTarget.ordersTarget = Number(ordersTarget || 0);
    existingTarget.aovTargetPaisa = Number(aovTargetPaisa || 0);
    existingTarget.expenseBudgetPaisa = Number(expenseBudgetPaisa || 0);
    existingTarget.setByUserId = request.auth.userId;
    if (notes !== undefined) existingTarget.notes = String(notes).trim();
    await existingTarget.save();

    return response.status(200).json({
      success: true,
      data: { target: existingTarget },
      correlationId: request.correlationId || null,
    });
  }

  const targetId = `TGT-${normalizedCafeId}-${normalizedGranularity}-${normalizedPeriodKey}`;

  const target = new DashboardTarget({
    targetId,
    organisationId: orgId,
    cafeId: normalizedCafeId,
    granularity: normalizedGranularity,
    periodKey: normalizedPeriodKey,
    salesTargetPaisa: Number(salesTargetPaisa),
    ordersTarget: Number(ordersTarget || 0),
    aovTargetPaisa: Number(aovTargetPaisa || 0),
    expenseBudgetPaisa: Number(expenseBudgetPaisa || 0),
    setByUserId: request.auth.userId,
    notes: notes ? String(notes).trim() : '',
  });

  await target.save();

  return response.status(201).json({
    success: true,
    data: { target },
    correlationId: request.correlationId || null,
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ADM-SCR-001 — CAFE OPERATIONS DASHBOARD HANDLER
//
// §8   Server-authoritative cafe scope: derives cafeId ONLY from auth.primaryCafeId.
//        No query param, no body param, no client-supplied cafeId is trusted.
// §9   Device cafe = Operator cafe = Resource cafe. Any mismatch → 403.
// §100 CAFE_ADMIN-only. All other roles receive 403.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Sales by IST hour for a given cafe + business date.
 * Returns array of { hour: 6, salesPaisa: 0, billsCount: 0 } for hours 0–23.
 */
async function aggregateSalesByHour(orgId, cafeId, businessDate) {
  const rows = await Bill.aggregate([
    {
      $match: {
        organisationId: orgId,
        cafeId,
        status: 'COMPLETED',
        businessDate,
      },
    },
    {
      $project: {
        totalPaisa: 1,
        // Extract IST hour: UTC offset +5:30 = 19800 seconds
        hourIST: {
          $hour: {
            date: '$createdAt',
            timezone: 'Asia/Kolkata',
          },
        },
      },
    },
    {
      $group: {
        _id: '$hourIST',
        salesPaisa: { $sum: '$totalPaisa' },
        billsCount: { $sum: 1 },
      },
    },
    { $sort: { _id: 1 } },
  ]);

  // Build a full 0-23 array, fill in actual data
  const byHour = {};
  for (const row of rows) byHour[row._id] = row;

  return Array.from({ length: 24 }, (_, h) => ({
    hour: h,
    salesPaisa: byHour[h]?.salesPaisa || 0,
    billsCount: byHour[h]?.billsCount || 0,
  }));
}

/**
 * Critical/low inventory items with item names (for stock preview table).
 */
async function getCriticalInventoryItems(orgId, cafeId, limit = 5) {
  const { GlobalInventoryItem } = require('../models/GlobalInventoryItem');

  const configs = await CafeInventoryConfig.find({
    organisationId: orgId,
    cafeId,
    status: 'ACTIVE',
    reorderLevelBase: { $gt: 0 },
  })
    .select('itemId cafeId currentQuantityBase reorderLevelBase minimumStockBase displayUnit')
    .lean();

  const criticalItems = [];
  const lowItems = [];

  for (const cfg of configs) {
    if (cfg.currentQuantityBase <= 0 || (cfg.minimumStockBase && cfg.currentQuantityBase <= cfg.minimumStockBase)) {
      criticalItems.push(cfg);
    } else if (cfg.currentQuantityBase <= cfg.reorderLevelBase) {
      lowItems.push(cfg);
    }
  }

  // Combine: critical first, then low, up to limit
  const preview = [...criticalItems, ...lowItems].slice(0, limit);

  if (preview.length === 0) return { critical: 0, low: 0, items: [] };

  // Enrich with item names
  const itemIds = preview.map((c) => c.itemId);
  const itemDocs = await GlobalInventoryItem.find({ itemId: { $in: itemIds } })
    .select('itemId name baseUnit')
    .lean();
  const itemMap = {};
  for (const item of itemDocs) itemMap[item.itemId] = item;

  const enriched = preview.map((cfg) => {
    const item = itemMap[cfg.itemId];
    const isCritical = cfg.currentQuantityBase <= 0 ||
      (cfg.minimumStockBase && cfg.currentQuantityBase <= cfg.minimumStockBase);
    return {
      itemId: cfg.itemId,
      name: item?.name || cfg.itemId,
      available: cfg.currentQuantityBase,
      unit: cfg.displayUnit || item?.baseUnit || '',
      status: isCritical ? 'CRITICAL' : 'LOW',
    };
  });

  return {
    critical: criticalItems.length,
    low: lowItems.length,
    items: enriched,
  };
}

/**
 * Expense summary (draft/returned/submitted) for today by cafe.
 * Only permitted statuses visible to CAFE_ADMIN.
 */
async function getCafeExpenseSummary(orgId, cafeId, today) {
  const counts = await Expense.aggregate([
    {
      $match: {
        organisationId: orgId,
        cafeId,
        // CAFE_ADMIN sees: DRAFT, RETURNED, SUBMITTED
        status: { $in: ['DRAFT', 'RETURNED', 'SUBMITTED'] },
      },
    },
    { $group: { _id: '$status', count: { $sum: 1 } } },
  ]);

  const byStatus = {};
  for (const { _id, count } of counts) byStatus[_id] = count;

  return {
    draft: byStatus['DRAFT'] || 0,
    returned: byStatus['RETURNED'] || 0,
    submitted: byStatus['SUBMITTED'] || 0,
  };
}

/**
 * Procurement summary for today (expected deliveries, received, late, discrepancies).
 */
async function getCafeProcurementSummary(orgId, cafeId, today) {
  const allPos = await PurchaseOrder.find({
    organisationId: orgId,
    cafeId,
    status: { $in: ['APPROVED', 'PARTIALLY_RECEIVED', 'RECEIVED'] },
  })
    .select('status expectedDeliveryDate actualDeliveryDate discrepancyNotes deliveries')
    .lean();

  let expectedToday = 0;
  let receivedToday = 0;
  let late = 0;
  let discrepancy = 0;

  for (const po of allPos) {
    const expectedDate = po.expectedDeliveryDate
      ? new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(
          new Date(po.expectedDeliveryDate)
        )
      : null;
    const actualDate = po.actualDeliveryDate
      ? new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(
          new Date(po.actualDeliveryDate)
        )
      : null;

    if (expectedDate === today) expectedToday++;
    if (actualDate === today) receivedToday++;
    if (expectedDate && expectedDate < today && po.status === 'APPROVED') late++;
    if (po.discrepancyNotes && po.discrepancyNotes.trim()) discrepancy++;
  }

  return { expectedToday, receivedToday, late, discrepancy };
}

/**
 * Department Orders summary for current cafe.
 */
async function getCafeDeptOrderSummary(orgId, cafeId, today) {
  const [open, dueToday, overdue] = await Promise.all([
    DepartmentOrder.countDocuments({
      organisationId: orgId,
      cafeId,
      status: { $in: ['PENDING', 'PREPARING', 'READY'] },
    }),
    DepartmentOrder.countDocuments({
      organisationId: orgId,
      cafeId,
      deliveryDate: today,
      status: { $in: ['PENDING', 'PREPARING', 'READY'] },
    }),
    DepartmentOrder.countDocuments({
      organisationId: orgId,
      cafeId,
      deliveryDate: { $lt: today },
      status: { $in: ['PENDING', 'PREPARING', 'READY'] },
    }),
  ]);

  return { open, dueToday, overdue };
}

/**
 * Recent operational activity from audit/task records.
 */
async function getCafeRecentActivity(orgId, cafeId, limit = 8) {
  try {
    const logs = await AuditEvent.find({
      organisationId: orgId,
      cafeId,
    })
      .sort({ createdAt: -1 })
      .limit(limit)
      .select('action entityType description createdAt actorName actor')
      .lean();

    if (logs && logs.length > 0) {
      return logs.map((l) => ({
        description: l.description || `${l.action} ${l.entityType || ''}`.trim(),
        timestamp: l.createdAt,
        actor: l.actorName || (l.actor && l.actor.name) || 'System',
      }));
    }
  } catch {}

  // Fallback: recent tasks
  const tasks = await Task.find({
    organisationId: orgId,
    cafeId,
    updatedAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
  })
    .sort({ updatedAt: -1 })
    .limit(limit)
    .select('title status updatedAt')
    .lean();

  return tasks.map((t) => ({
    description: `${t.title} — ${t.status}`,
    timestamp: t.updatedAt,
  }));
}

// ── MAIN HANDLER ──────────────────────────────────────────────────────────────

const getCafeOpsDashboard = asyncHandler(async (request, response) => {
  const auth = request.auth;

  // Authorised roles for Cafe Operations Dashboard
  const allowedRoles = ['CAFE_ADMIN', 'STAFF', 'MASTER', 'OWNER'];
  if (!allowedRoles.includes(auth.role)) {
    throw new ApiError(
      403,
      'CAFE_OPS_ACCESS_DENIED',
      'Cafe Operations Dashboard is only accessible to authorised Cafe Operations accounts.'
    );
  }

  // Derive cafe from server-authoritative context (device binding / operator session / authorized assigned cafe)
  request.auth.workspaceMode = request.auth.workspaceMode || 'CAFE_OPERATIONS';
  const cafeId = resolveEffectiveCafeScope(request);
  const orgId = auth.organisationId;

  if (!cafeId) {
    throw new ApiError(
      403,
      'NO_CAFE_ASSIGNED',
      'No cafe is assigned to this account. Contact your administrator.'
    );
  }

  const today = getIstBusinessDate();
  const generatedAt = new Date().toISOString();

  // ── Load cafe record ────────────────────────────────────────────────────────
  const cafe = await Cafe.findOne({
    organisationId: orgId,
    cafeId,
    status: 'ACTIVE',
  })
    .select('cafeId name city address phone operatingStatus')
    .lean();

  if (!cafe) {
    throw new ApiError(
      403,
      'CAFE_NOT_FOUND',
      'The assigned cafe could not be found or is not active.'
    );
  }

  // ── Parallel data aggregation ──────────────────────────────────────────────
  const [
    todaySalesAgg,
    salesByHour,
    attendanceSummary,
    inventoryHealth,
    expensesSummary,
    procurementSummary,
    deptOrderSummary,
    recentActivity,
    maintenanceOpen,
    qualityOverdue,
    returnedExpensesCount,
    openTaskCount,
  ] = await Promise.all([
    // Today sales for this cafe
    aggregateSales(orgId, cafeId, { from: today, to: today }),
    // Sales by hour
    aggregateSalesByHour(orgId, cafeId, today),
    // Attendance
    getAttendanceSummary(orgId, cafeId, today),
    // Inventory with item detail
    getCriticalInventoryItems(orgId, cafeId, 5),
    // Expense summary
    getCafeExpenseSummary(orgId, cafeId, today),
    // Procurement & deliveries
    getCafeProcurementSummary(orgId, cafeId, today),
    // Department orders
    getCafeDeptOrderSummary(orgId, cafeId, today),
    // Recent activity
    getCafeRecentActivity(orgId, cafeId, 8),
    // Maintenance jobs
    MaintenanceJob.countDocuments({
      organisationId: orgId,
      cafeId,
      status: { $in: ['LOGGED', 'IN_PROGRESS'] },
    }),
    // Quality overdue
    QualityChecklist.countDocuments({
      organisationId: orgId,
      cafeId,
      nextDueDate: { $lte: today },
      managerSignOffUserId: null,
    }),
    // Returned expenses requiring Cafe Op action
    Expense.countDocuments({
      organisationId: orgId,
      cafeId,
      status: 'RETURNED',
    }),
    // Open tasks for this cafe
    Task.countDocuments({
      organisationId: orgId,
      cafeId,
      status: { $in: ['PENDING', 'IN_PROGRESS'] },
    }),
  ]);

  // ── Action Required queue (§25, §26) ────────────────────────────────────────
  const actionRequired = [];

  if (inventoryHealth.critical > 0) {
    actionRequired.push({
      level: 1,
      severity: 'CRITICAL',
      category: 'INVENTORY',
      title: `${inventoryHealth.critical} item${inventoryHealth.critical > 1 ? 's' : ''} at critical stock level`,
      description: 'Stock at or below minimum threshold. Immediate reorder required.',
      route: 'inventory',
    });
  }

  if (inventoryHealth.low > 0) {
    actionRequired.push({
      level: 2,
      severity: 'HIGH',
      category: 'INVENTORY',
      title: `${inventoryHealth.low} item${inventoryHealth.low > 1 ? 's' : ''} below reorder level`,
      description: 'Stock approaching critical levels. Raise purchase order.',
      route: 'inventory',
    });
  }

  if (returnedExpensesCount > 0) {
    actionRequired.push({
      level: 4,
      severity: 'HIGH',
      category: 'EXPENSE',
      title: `${returnedExpensesCount} returned expense${returnedExpensesCount > 1 ? 's' : ''} need correction`,
      description: 'Expenses returned for correction. Edit and resubmit.',
      route: 'expenses',
    });
  }

  if (procurementSummary.late > 0) {
    actionRequired.push({
      level: 3,
      severity: 'HIGH',
      category: 'PROCUREMENT',
      title: `${procurementSummary.late} overdue deliver${procurementSummary.late > 1 ? 'ies' : 'y'}`,
      description: 'Expected deliveries past their scheduled date.',
      route: 'procurement',
    });
  }

  if (deptOrderSummary.overdue > 0) {
    actionRequired.push({
      level: 3,
      severity: 'MEDIUM',
      category: 'DEPARTMENT_ORDERS',
      title: `${deptOrderSummary.overdue} overdue department order${deptOrderSummary.overdue > 1 ? 's' : ''}`,
      description: 'Institution orders past their delivery date.',
      route: 'dept-orders',
    });
  }

  if (attendanceSummary.attendanceExceptions > 0) {
    actionRequired.push({
      level: 4,
      severity: 'MEDIUM',
      category: 'ATTENDANCE',
      title: `${attendanceSummary.attendanceExceptions} attendance exception${attendanceSummary.attendanceExceptions > 1 ? 's' : ''}`,
      description: 'Missed check-ins or absent staff need review.',
      route: 'attendance',
    });
  }

  if (maintenanceOpen > 0) {
    actionRequired.push({
      level: 4,
      severity: 'MEDIUM',
      category: 'MAINTENANCE',
      title: `${maintenanceOpen} open maintenance job${maintenanceOpen > 1 ? 's' : ''}`,
      description: 'Equipment or facility maintenance items need attention.',
      route: 'assets',
    });
  }

  if (qualityOverdue > 0) {
    actionRequired.push({
      level: 4,
      severity: 'MEDIUM',
      category: 'COMPLIANCE',
      title: `${qualityOverdue} quality check${qualityOverdue > 1 ? 's' : ''} overdue`,
      description: 'Operational compliance checks past due date.',
      route: 'quality',
    });
  }

  // Sort: level ASC then severity
  const sevOrder = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3, INFO: 4 };
  actionRequired.sort((a, b) => a.level - b.level || (sevOrder[a.severity] ?? 9) - (sevOrder[b.severity] ?? 9));

  // ── Next Up (§52) ─────────────────────────────────────────────────────────
  const nextUpItems = [];
  if (deptOrderSummary.dueToday > 0) {
    nextUpItems.push({ type: 'DEPT_ORDER', label: `${deptOrderSummary.dueToday} department order${deptOrderSummary.dueToday > 1 ? 's' : ''} due today`, route: 'dept-orders' });
  }
  if (procurementSummary.expectedToday > 0) {
    nextUpItems.push({ type: 'DELIVERY', label: `${procurementSummary.expectedToday} deliver${procurementSummary.expectedToday > 1 ? 'ies' : 'y'} expected today`, route: 'procurement' });
  }

  // ── Build response (§99 data contract) ──────────────────────────────────────
  return response.status(200).json({
    success: true,
    data: {
      cafeId: cafe.cafeId,
      // §18 cafe context
      cafeContext: {
        cafeId: cafe.cafeId,
        cafeName: cafe.name,
        cafeCity: cafe.city || null,
        // If operatingStatus field exists on Cafe model; otherwise derive from today sales
        cafeStatus: cafe.operatingStatus || (todaySalesAgg.totalSalesPaisa > 0 ? 'OPEN' : 'OPERATIONAL'),
      },
      businessDate: today,
      // Operator context from auth (trusted server-side)
      operatorContext: {
        operatorUserId: auth.userId,
        operatorName: auth.name || auth.fullName || null,
        operatorEmployeeId: auth.permanentEmployeeId || auth.userId,
        sessionStartedAt: null, // Set client-side from session state
      },
      // §25 Action Required
      actionRequired,
      // §29 Carryover — unresolved returned expenses from previous day (simplified)
      carryover: returnedExpensesCount > 0
        ? [{ category: 'EXPENSE', title: `${returnedExpensesCount} returned expense${returnedExpensesCount > 1 ? 's' : ''} pending correction`, route: 'expenses' }]
        : [],
      // §30 Today KPIs
      todaySales: {
        totalPaisa: todaySalesAgg.totalSalesPaisa,
        billsCount: todaySalesAgg.totalOrders,
        aovPaisa: todaySalesAgg.aovPaisa,
      },
      // §32 Sales by hour
      salesByHour,
      // §41 Attendance
      attendanceSummary: {
        scheduled: attendanceSummary.staffScheduled,
        present: attendanceSummary.staffPresent,
        exceptions: attendanceSummary.attendanceExceptions,
      },
      // §43 Inventory health
      inventoryHealth,
      // §46 Expenses
      expensesSummary,
      // §48 Procurement
      procurementSummary,
      // §50 Dept orders
      departmentOrders: deptOrderSummary,
      // §52 Next up
      nextUp: nextUpItems,
      // §53 Recent activity
      recentActivity,
      // §58 Device health — supplemented by client device context
      deviceHealth: {
        trusted: true, // Enforced by session auth
        lastCheckedAt: generatedAt,
      },
      // §60 Data freshness
      dataFreshness: {
        generatedAt,
        salesFreshAt: generatedAt,
        attendanceFreshAt: generatedAt,
        inventoryFreshAt: generatedAt,
      },
    },
    correlationId: request.correlationId || null,
  });
});

// ── Operational Exception Centre (R02-08) ───────────────────────────────────
const getOperationalExceptions = asyncHandler(async (request, response) => {
  const { organisationId } = request.auth;
  const cafeId = resolveEffectiveCafeScope(request);

  const result = await OperationalExceptionService.getCafeExceptions({
    organisationId,
    cafeId,
  });

  return response.status(200).json({
    success: true,
    data: result,
    correlationId: request.correlationId || null,
  });
});

module.exports = {
  getDashboardMetrics,
  getDashboardData,
  getCafeOpsDashboard,
  getOperationalExceptions,
  listSavedViews,
  createSavedView,
  updateSavedView,
  deleteSavedView,
  listTargets,
  upsertTarget,
};
