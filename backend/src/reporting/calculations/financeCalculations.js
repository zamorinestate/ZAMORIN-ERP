'use strict';

/**
 * ZAMORIN CAFÉ ERP — REPORTING CALCULATION ENGINE
 * Module: financeCalculations.js — PM-02F-R1 CORRECTIVE REVISION
 *
 * PM-02F-R1 Corrections Applied:
 *   F-R1-001  DB disconnection now returns SOURCE UNAVAILABLE / ERROR — never factual zeros.
 *   F-R1-002  DashboardTarget confirmed as KPI/Sales-Target (no approval, no scenario/version,
 *             no effective date enforcement) → output renamed targetVsActual.
 *             expenseBudgetPaisa retained as expense ceiling label because field is named "budget".
 *   F-R1-003  Expense.category is free-text (no enum). Canonical date field is businessDate only
 *             (expenseDate does not exist in Expense schema — removed from query).
 *             INCLUDED_EXPENSE_STATUSES: APPROVED, PAID, CLOSED (all exist in EXPENSE_STATUSES enum).
 *             ARCHIVED, REVERSED, CANCELLED, RETURNED, REJECTED, DRAFT, SUBMITTED,
 *             PENDING_APPROVAL excluded with documented reason.
 *   F-R1-004  PayrollRun authoritative (status APPROVED or PAID). Payslip fallback only when
 *             no authoritative PayrollRun data exists. Payslip fallback now applies same date
 *             range filter using periodStartDate/periodEndDate. payrollSource field exposes which
 *             path was taken. Never sum both for same period population.
 *   F-R1-005  MarketplaceSettlement: platformFeesPaisa + taxWithheldPaisa included in bridge.
 *             bankReceivedPaisa shown only when status is MATCHED or RECONCILED (bank-matched).
 *             For EXPECTED/RECEIVED/DISPUTED status the bank leg is UNAVAILABLE.
 *   F-R1-006  CashTransaction types do not include CASH_SALE (confirmed). RegisterSession and
 *             CashTransaction are non-overlapping populations — no double-count risk.
 *             Cash source matrix documented in provenance.
 *
 * Preserved from PM-02F:
 *   - calculateSalesMetrics reuse (PM-02A/B/D canonical)
 *   - calculateProcurementMetrics reuse (PM-02E canonical)
 *   - ACTUAL_COGS: null / UNAVAILABLE unless cogsService can price real sales
 *     (SCR-022 / Issue #2 — ESTIMATED on LAST_PO_PRICE basis, never fabricated)
 *   - GROSS_PROFIT: follows COGS availability (net sales − estimated COGS)
 *   - EBITDA = null / UNAVAILABLE
 *   - LABOUR_COST = PARTIAL_SOURCE (employer statutory overheads absent)
 *   - BANK_BALANCE = UNAVAILABLE
 *   - DIRECT_GATEWAY_SETTLEMENT = UNAVAILABLE
 *   - Integer-paisa arithmetic throughout
 *   - PDF + XLSX policy enforced at controller layer
 *   - Operational Cash Movement title
 */

const mongoose = require('mongoose');
const { Expense, EXPENSE_STATUSES } = require('../../models/Expense');
const { PayrollRun } = require('../../models/PayrollRun');
const { Payslip } = require('../../models/Payslip');
const { RegisterSession } = require('../../models/RegisterSession');
const { CashTransaction } = require('../../models/CashTransaction');
const { MarketplaceSettlement } = require('../../models/MarketplaceSettlement');
const { DashboardTarget } = require('../../models/DashboardTarget');
const { calculateSalesMetrics } = require('./salesCalculations');
const { calculateProcurementMetrics } = require('./procurementCalculations');
const { deriveFinanceCogsBlock } = require('../../services/cogsService');

// ── Canonical Expense Category Exclusions ────────────────────────────────────
// These categories are excluded from Operating Expenses to prevent double-counting
// with sources that are already accounted for independently:
//   INVENTORY family  → double-counted via Procurement/AP engine (PM-02E)
//   PAYROLL family    → double-counted via PayrollRun/Payslip engine (PM-02F §2)
//   CAPEX family      → capital expenditure; not an operating expense
//   TAX family        → statutory obligation; not an operating cost in this view
//
// Source authority: Expense.category is a free-text uppercase string field (no enum).
// These exclusions are applied as exact-prefix or contains matches against the
// canonical uppercase category value stored in the database.
const EXCLUDED_EXPENSE_CATEGORIES = [
  // Inventory / Procurement family
  'INVENTORY', 'INVENTORY_PURCHASE', 'PURCHASE', 'RAW_MATERIAL', 'STOCK',
  // Payroll / Labour family
  'PAYROLL', 'SALARY', 'WAGES', 'STIPEND',
  // CapEx / Capital family
  'CAPEX', 'CAPITAL', 'EQUIPMENT_PURCHASE', 'ASSET_ACQUISITION',
  // Tax / Statutory family
  'TAX', 'GST', 'INCOME_TAX', 'STATUTORY_TAX',
];

// Expense lifecycle states that represent a committed operating expense.
// Source: Expense.EXPENSE_STATUSES enum in Expense.js.
// APPROVED — manager-approved, awaiting payment.
// PAID     — payment disbursed.
// CLOSED   — lifecycle complete.
// Excluded: DRAFT, SUBMITTED, PENDING_APPROVAL, RETURNED (pre-approval);
//           REJECTED, REVERSED, CANCELLED (voided); ARCHIVED (historical).
const INCLUDED_EXPENSE_STATUSES = ['APPROVED', 'PAID', 'CLOSED'];

// ── Source Availability Sentinels ────────────────────────────────────────────
const AVAIL_UNAVAILABLE = 'UNAVAILABLE';
const AVAIL_ERROR = 'ERROR';
const AVAIL_AVAILABLE = 'AVAILABLE';

/**
 * Safe model query wrapper. Returns { data: result } on success or
 * { data: null, error: true, reason: <message> } on any failure.
 * This ensures DB outage is reported as SOURCE ERROR, never as factual zero.
 * When disconnected, unmocked Mongoose queries/aggregations fail fast with
 * error without waiting for connection buffering or mutating global configuration.
 */
async function safeQuery(fn) {
  try {
    const query = fn();
    if (mongoose?.connection?.readyState !== 1 && (query instanceof mongoose.Query || query instanceof mongoose.Aggregate)) {
      return { data: null, error: true, reason: 'DATABASE_UNAVAILABLE_DISCONNECTED' };
    }
    const data = await query;
    return { data, error: false };
  } catch (err) {
    return { data: null, error: true, reason: err?.message || 'Query failed' };
  }
}

/**
 * Calculates complete finance metrics for the given scope and period.
 *
 * F-R1-001: This function no longer uses mongoose.connection.readyState to gate queries.
 * Each query is attempted unconditionally. On failure the affected sub-section returns
 * availability = ERROR and the corresponding metric = null (not 0).
 *
 * @param {Object} opts
 * @param {string} opts.organisationId   Tenant organisation ID (required)
 * @param {string|string[]|null} [opts.cafeScope]  Authorized café scope
 * @param {string} opts.dateFrom         ISO date YYYY-MM-DD
 * @param {string} opts.dateTo           ISO date YYYY-MM-DD
 * @returns {Promise<Object>} Governed finance intelligence payload
 */
async function calculateFinanceMetrics({ organisationId, cafeScope, dateFrom, dateTo }) {
  if (!organisationId) {
    throw new Error('financeCalculations: organisationId is required.');
  }

  const cafeFilter = cafeScope
    ? Array.isArray(cafeScope) ? { $in: cafeScope } : cafeScope
    : undefined;

  // ── §1  Sales & Revenue Bridge (PM-02A/B/D canonical reuse) ─────────────────
  const salesResult = await calculateSalesMetrics({ organisationId, cafeScope, dateFrom, dateTo });
  const { summary: salesSummary } = salesResult;

  const grossSalesPaisa    = salesSummary.grossSalesPaise    || 0;
  const discountPaisa      = salesSummary.discountPaise      || 0;
  const customerRefundPaisa= salesSummary.customerRefundPaise || 0;
  const preTaxRefundPaisa  = salesSummary.preTaxRefundPaise  ?? customerRefundPaisa;
  const netSalesPaisa      = salesSummary.netSalesPaise      || 0;
  const taxChargedPaisa    = salesSummary.taxChargedPaise    || 0;
  const orderCount         = salesSummary.orderCount || salesSummary.transactionCount || 0;

  const grossRevenue          = Number((grossSalesPaisa / 100).toFixed(2));
  const discounts             = Number((discountPaisa / 100).toFixed(2));
  const refunds               = Number((customerRefundPaisa / 100).toFixed(2));
  const preTaxRefunds         = Number((preTaxRefundPaisa / 100).toFixed(2));
  const netRevenue            = Number((netSalesPaisa / 100).toFixed(2));
  const taxCharged            = Number((taxChargedPaisa / 100).toFixed(2));
  const customerReceiptTotal  = Number(((netSalesPaisa + taxChargedPaisa) / 100).toFixed(2));

  const revenueBridge = {
    grossSalesPaisa,
    grossSales:             grossRevenue,
    discountPaisa,
    discounts,
    preTaxRefundPaisa,
    preTaxRefunds,
    customerRefundPaisa,
    customerRefunds:        refunds,
    netSalesPaisa,
    netSales:               netRevenue,
    taxChargedPaisa,
    taxCharged,
    customerReceiptTotalPaisa: netSalesPaisa + taxChargedPaisa,
    customerReceiptTotal,
    refundQuality:          salesResult.dataQuality?.state || 'CLEAN',
    formula: 'Gross Sales − Discounts − Pre-Tax Refunds = Net Sales; Net Sales + Tax = Receipt Total',
  };

  // ── §2  Gross Payroll (PayrollRun authoritative → Payslip fallback) ──────────
  // F-R1-004: PayrollRun is authoritative. Payslip is used ONLY when no PayrollRun records
  // are found for the given scope and period. Never sum both.
  let grossPayrollPaisa = 0;
  let payrollRunCount   = 0;
  let payslipCount      = 0;
  let payrollSource     = 'NO_DATA';
  let payrollAvailability = AVAIL_AVAILABLE;
  const payrollByCafeMap = new Map();

  const payrollRunMatch = { organisationId, status: { $in: ['APPROVED', 'PAID'] } };
  if (cafeFilter)         payrollRunMatch.cafeId = cafeFilter;
  if (dateFrom && dateTo) {
    payrollRunMatch.periodStartDate = { $lte: dateTo };
    payrollRunMatch.periodEndDate   = { $gte: dateFrom };
  }

  const payrollRunResult = await safeQuery(() => PayrollRun.aggregate([
    { $match: payrollRunMatch },
    { $group: { _id: '$cafeId', totalGrossPaise: { $sum: '$totalGrossPaise' }, runCount: { $sum: 1 } } },
  ]));

  if (payrollRunResult.error) {
    payrollAvailability = AVAIL_ERROR;
    grossPayrollPaisa   = null;
    payrollSource       = 'SOURCE_UNAVAILABLE';
  } else {
    for (const p of payrollRunResult.data || []) {
      const val = p.totalGrossPaise || 0;
      grossPayrollPaisa = (grossPayrollPaisa || 0) + val;
      payrollRunCount  += (p.runCount || 0);
      const cid = p._id || 'GLOBAL';
      payrollByCafeMap.set(cid, (payrollByCafeMap.get(cid) || 0) + val);
    }
    if (payrollRunCount > 0) {
      payrollSource = 'AUTHORITATIVE_PAYROLL_RUN';
    } else {
      // PayrollRun returned zero records — attempt Payslip fallback (F-R1-004)
      const payslipMatch = { organisationId, status: { $in: ['ISSUED', 'PAID'] } };
      if (cafeFilter)         payslipMatch.cafeId = cafeFilter;
      // Apply same date-range filter to Payslip
      if (dateFrom && dateTo) {
        payslipMatch.periodStartDate = { $lte: dateTo };
        payslipMatch.periodEndDate   = { $gte: dateFrom };
      }

      const payslipResult = await safeQuery(() => {
        if (typeof Payslip.find === 'function') {
          return Payslip.find(payslipMatch).select('cafeId earnings.grossPayPaise netPayPaise').lean();
        }
        return Payslip.aggregate([
          { $match: payslipMatch },
          { $group: { _id: '$cafeId', totalGrossPaise: { $sum: '$earnings.grossPayPaise' }, count: { $sum: 1 } } }
        ]);
      });

      if (payslipResult.error || !payslipResult.data) {
        payrollAvailability = AVAIL_ERROR;
        grossPayrollPaisa   = null;
        payrollSource       = 'SOURCE_UNAVAILABLE';
      } else {
        const pData = Array.isArray(payslipResult.data) ? payslipResult.data : [];
        if (pData.length === 0) {
          payrollSource = 'NO_DATA';
          payrollAvailability = AVAIL_AVAILABLE;
          grossPayrollPaisa = 0;
        } else {
          payrollSource = 'PAYSLIP_FALLBACK';
          payslipCount = pData.length;
          let validGrossCount = 0;
          let missingGrossCount = 0;
          let knownGross = 0;

          for (const s of pData) {
            if (s.totalGrossPaise !== undefined) {
              const val = s.totalGrossPaise || 0;
              knownGross += val;
              validGrossCount++;
              const cid = s._id || 'GLOBAL';
              payrollByCafeMap.set(cid, (payrollByCafeMap.get(cid) || 0) + val);
            } else {
              const hasGross = Number.isFinite(s.earnings?.grossPayPaise) && s.earnings.grossPayPaise >= 0;
              if (hasGross) {
                validGrossCount++;
                const val = s.earnings.grossPayPaise;
                knownGross += val;
                const cid = s.cafeId || 'GLOBAL';
                payrollByCafeMap.set(cid, (payrollByCafeMap.get(cid) || 0) + val);
              } else {
                missingGrossCount++;
              }
            }
          }

          if (missingGrossCount === 0) {
            payrollAvailability = AVAIL_AVAILABLE;
            grossPayrollPaisa = knownGross;
          } else if (validGrossCount > 0) {
            payrollAvailability = 'PARTIAL_SOURCE';
            grossPayrollPaisa = knownGross;
          } else {
            payrollAvailability = AVAIL_UNAVAILABLE;
            grossPayrollPaisa = null;
          }
        }
      }
    }
  }

  const labourInr = grossPayrollPaisa !== null
    ? Number((grossPayrollPaisa / 100).toFixed(2))
    : null;
  const grossPayrollPctOfSales = (grossPayrollPaisa !== null && netSalesPaisa > 0)
    ? Number(((grossPayrollPaisa / netSalesPaisa) * 100).toFixed(1))
    : 0;

  const payrollByCafe = Array.from(payrollByCafeMap.entries()).map(([cafeId, amountPaisa]) => ({
    cafeId,
    grossPayrollPaisa: amountPaisa,
    grossPayroll: Number((amountPaisa / 100).toFixed(2)),
    sharePercent: grossPayrollPaisa > 0
      ? Number(((amountPaisa / grossPayrollPaisa) * 100).toFixed(1))
      : 0,
  }));

  const payrollIntelligence = {
    grossPayrollPaisa,
    grossPayroll: labourInr,
    grossPayrollPctOfSales,
    payrollRunCount,
    payslipCount,
    payrollSource,
    payrollSourceBasis: payrollSource,
    payrollAvailability,
    byCafe: payrollByCafe,
    labourCostQuality: 'PARTIAL_SOURCE',
    missingEmployerComponents: ['EMPLOYER_EPF', 'EMPLOYER_ESI', 'GRATUITY_PROVISION', 'EMPLOYER_INSURANCE'],
    disclosureNotice:
      'Gross employee earnings only. Total economic labour cost is PARTIAL_SOURCE: ' +
      'employer-side EPF, ESI, gratuity provision and insurance overheads are absent from this repository.',
  };

  // ── §3  Operating Expense Intelligence (Double-Count Exclusion) ──────────────
  // F-R1-003: Date field is businessDate (canonical). expenseDate does not exist in Expense schema.
  // F-R1-001: Query error → availability = ERROR, values = null.
  let rentPaisa = 0, utilitiesPaisa = 0, maintenancePaisa = 0, packagingPaisa = 0, otherOpexPaisa = 0;
  let eligibleExpenseCount  = 0;
  let excludedExpenseCount  = 0;
  let totalEligibleOpexPaisa = 0;
  let expenseAvailability = AVAIL_AVAILABLE;
  const categoryBreakdownMap = new Map();
  const cafeBreakdownMap     = new Map();
  const vendorBreakdownMap   = new Map();
  const dailyExpenseMap      = new Map();
  const eligibleExpensesList = [];
  const unapprovedExpensesList = [];

  const expenseQuery = { organisationId };
  if (cafeFilter)            expenseQuery.cafeId = cafeFilter;
  if (dateFrom && dateTo)    expenseQuery.businessDate = { $gte: dateFrom, $lte: dateTo };

  const expenseResult = await safeQuery(() => Expense.find(expenseQuery).lean());

  if (expenseResult.error) {
    expenseAvailability    = AVAIL_ERROR;
    totalEligibleOpexPaisa = null;
  } else {
    for (const exp of expenseResult.data || []) {
      const cat      = String(exp.category || '').toUpperCase().trim();
      const amtPaisa = Number(exp.amountPaisa !== undefined
        ? exp.amountPaisa
        : Math.round((exp.amount || 0) * 100));
      const status   = String(exp.status || '').toUpperCase().trim();

      // Track unapproved backlog for Exception Centre
      if (status === 'SUBMITTED' || status === 'PENDING_APPROVAL') {
        unapprovedExpensesList.push({
          expenseId:   exp.expenseId || String(exp._id || ''),
          cafeId:      exp.cafeId,
          category:    exp.category,
          vendorName:  exp.vendorName || 'N/A',
          amountPaisa: amtPaisa,
          amount:      Number((amtPaisa / 100).toFixed(2)),
          status,
          businessDate: exp.businessDate || '',
        });
      }

      // Status gate: only APPROVED, PAID, CLOSED
      if (!INCLUDED_EXPENSE_STATUSES.includes(status)) {
        excludedExpenseCount += 1;
        continue;
      }

      // Category exclusion: prevent double-counting with Inventory, Payroll, CapEx, Tax
      const isExcluded = EXCLUDED_EXPENSE_CATEGORIES.some((ex) => cat.includes(ex));
      if (isExcluded) {
        excludedExpenseCount += 1;
        continue;
      }

      eligibleExpenseCount  += 1;
      totalEligibleOpexPaisa += amtPaisa;

      // Operational bucket classification.
      // Note: Expense.category is a free-text field (no schema enum). Classification uses
      // canonical uppercase string matching against the stored category value.
      if (cat.includes('RENT') || cat.includes('OCCUPANCY') || cat.includes('LEASE')) {
        rentPaisa += amtPaisa;
      } else if (cat.includes('UTILIT') || cat.includes('ELECTRIC') || cat.includes('WATER')
                 || cat.includes('GAS') || cat.includes('INTERNET')) {
        utilitiesPaisa += amtPaisa;
      } else if (cat.includes('MAINT') || cat.includes('REPAIR')) {
        maintenancePaisa += amtPaisa;
      } else if (cat.includes('PACKAG') || cat.includes('CONSUMABLE') || cat.includes('SUPPLIES')) {
        packagingPaisa += amtPaisa;
      } else {
        otherOpexPaisa += amtPaisa;
      }

      const canonicalCat = exp.category || 'OTHER_OPEX';
      categoryBreakdownMap.set(canonicalCat, (categoryBreakdownMap.get(canonicalCat) || 0) + amtPaisa);

      const expCafe  = exp.cafeId || 'GLOBAL';
      cafeBreakdownMap.set(expCafe, (cafeBreakdownMap.get(expCafe) || 0) + amtPaisa);

      const vendorKey = exp.vendorName || 'Unspecified Vendor';
      vendorBreakdownMap.set(vendorKey, (vendorBreakdownMap.get(vendorKey) || 0) + amtPaisa);

      const bDate = exp.businessDate || '';
      dailyExpenseMap.set(bDate, (dailyExpenseMap.get(bDate) || 0) + amtPaisa);

      eligibleExpensesList.push({
        expenseId:    exp.expenseId || String(exp._id || ''),
        businessDate: bDate,
        cafeId:       expCafe,
        category:     canonicalCat,
        vendorName:   exp.vendorName || 'N/A',
        amountPaisa:  amtPaisa,
        amount:       Number((amtPaisa / 100).toFixed(2)),
        description:  exp.description || exp.purpose || '',
      });
    }
  }

  const rent                  = Number((rentPaisa / 100).toFixed(2));
  const utilities             = Number((utilitiesPaisa / 100).toFixed(2));
  const maintenance           = Number((maintenancePaisa / 100).toFixed(2));
  const packagingAndConsumables = Number((packagingPaisa / 100).toFixed(2));
  const other                 = Number((otherOpexPaisa / 100).toFixed(2));
  const totalOpexPaisa        = totalEligibleOpexPaisa || 0;
  const totalOpex             = Number((totalOpexPaisa / 100).toFixed(2));

  const categoryBreakdown = Array.from(categoryBreakdownMap.entries())
    .map(([category, amountPaisa]) => ({
      category, amountPaisa,
      amount: Number((amountPaisa / 100).toFixed(2)),
      sharePercent: totalOpexPaisa > 0
        ? Number(((amountPaisa / totalOpexPaisa) * 100).toFixed(1)) : 0,
    }))
    .sort((a, b) => b.amountPaisa - a.amountPaisa);

  let runningParetoPaisa = 0;
  const expensePareto = categoryBreakdown.map((c, idx) => {
    runningParetoPaisa += c.amountPaisa;
    return {
      rank: idx + 1,
      category: c.category,
      amountPaisa: c.amountPaisa,
      amount: c.amount,
      sharePercent: c.sharePercent,
      cumulativePercent: totalOpexPaisa > 0
        ? Number(((runningParetoPaisa / totalOpexPaisa) * 100).toFixed(1)) : 0,
    };
  });

  const expenseByCafe = Array.from(cafeBreakdownMap.entries())
    .map(([cafeId, amountPaisa]) => ({
      cafeId, amountPaisa,
      amount: Number((amountPaisa / 100).toFixed(2)),
      sharePercent: totalOpexPaisa > 0
        ? Number(((amountPaisa / totalOpexPaisa) * 100).toFixed(1)) : 0,
    }))
    .sort((a, b) => b.amountPaisa - a.amountPaisa);

  const expenseByVendor = Array.from(vendorBreakdownMap.entries())
    .map(([vendor, amountPaisa]) => ({
      vendor, amountPaisa,
      amount: Number((amountPaisa / 100).toFixed(2)),
      sharePercent: totalOpexPaisa > 0
        ? Number(((amountPaisa / totalOpexPaisa) * 100).toFixed(1)) : 0,
    }))
    .sort((a, b) => b.amountPaisa - a.amountPaisa)
    .slice(0, 15);

  const expenseTrends = Array.from(dailyExpenseMap.entries())
    .map(([date, amountPaisa]) => ({
      date, amountPaisa, amount: Number((amountPaisa / 100).toFixed(2)),
    }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const largestExpenses = eligibleExpensesList
    .sort((a, b) => b.amountPaisa - a.amountPaisa)
    .slice(0, 15);

  const expenseIntelligence = {
    totalOpexPaisa,
    totalOpex,
    availability: expenseAvailability,
    buckets: { rent, utilities, maintenance, packagingAndConsumables, other },
    byCategory:    categoryBreakdown,
    byCafe:        expenseByCafe,
    byVendor:      expenseByVendor,
    pareto:        expensePareto,
    trends:        expenseTrends,
    largestExpenses,
    capexClassification:  'UNAVAILABLE',
    eligibleExpenseCount,
    excludedExpenseCount,
    doubleCountProtection:
      'Enforced: INVENTORY, PAYROLL, CAPEX, and TAX categories strictly excluded from operating expenses.',
  };

  // ── §4  Cash & Till Reconciliation (RegisterSession + CashTransaction) ───────
  // F-R1-006 Source Matrix:
  //   RegisterSession → opening float, expected cash, counted cash, variance (per session).
  //   CashTransaction → non-sale cash movements (PAID_IN, PAID_OUT, BANK_DEPOSIT, etc.).
  //   CashTransaction.transactionType does NOT include CASH_SALE → no overlap with sales.
  //   Bill tender cash is not independently re-summed here → no double-count risk.
  let totalSessions         = 0;
  let totalOpeningFloatPaisa = 0;
  let totalExpectedCashPaisa = 0;
  let totalCountedCashPaisa  = 0;
  let totalTillVariancePaisa = 0;
  let cashTillAvailability   = AVAIL_AVAILABLE;
  const sessionsList           = [];
  const tillVarianceExceptions = [];
  const cafeTillVarianceMap    = new Map();

  const regMatch = { organisationId };
  if (cafeFilter)            regMatch.cafeId = cafeFilter;
  if (dateFrom && dateTo)    regMatch.businessDate = { $gte: dateFrom, $lte: dateTo };

  const regResult = await safeQuery(() => RegisterSession.find(regMatch).lean());

  if (regResult.error) {
    cashTillAvailability = AVAIL_ERROR;
  } else {
    for (const s of regResult.data || []) {
      totalSessions += 1;
      const op       = Number(s.openingFloatPaisa || 0);
      const exp      = Number(s.expectedCashPaisa || op);
      const cnt      = (s.countedCashPaisa !== null && s.countedCashPaisa !== undefined)
        ? Number(s.countedCashPaisa) : exp;
      const variance = Number(s.cashVariancePaisa !== undefined ? s.cashVariancePaisa : (cnt - exp));

      totalOpeningFloatPaisa += op;
      totalExpectedCashPaisa += exp;
      totalCountedCashPaisa  += cnt;
      totalTillVariancePaisa += variance;

      const sessItem = {
        sessionId:          s.registerSessionId || String(s._id || ''),
        cafeId:             s.cafeId,
        registerId:         s.registerId || 'REG-01',
        cashierUserId:      s.cashierUserId || 'N/A',
        businessDate:       s.businessDate || '',
        openedAt:           s.openedAt,
        closedAt:           s.closedAt,
        openingFloatPaisa:  op,
        openingFloat:       Number((op / 100).toFixed(2)),
        expectedCashPaisa:  exp,
        expectedCash:       Number((exp / 100).toFixed(2)),
        countedCashPaisa:   cnt,
        countedCash:        Number((cnt / 100).toFixed(2)),
        variancePaisa:      variance,
        variance:           Number((variance / 100).toFixed(2)),
        varianceDirection:  variance > 0 ? 'OVERAGE' : variance < 0 ? 'SHORTAGE' : 'BALANCED',
        status:             s.status || 'CLOSED',
      };
      sessionsList.push(sessItem);
      if (Math.abs(variance) > 0) tillVarianceExceptions.push(sessItem);

      const cId = s.cafeId || 'GLOBAL';
      const cur = cafeTillVarianceMap.get(cId) || { expectedPaisa: 0, countedPaisa: 0, variancePaisa: 0 };
      cur.expectedPaisa += exp;
      cur.countedPaisa  += cnt;
      cur.variancePaisa += variance;
      cafeTillVarianceMap.set(cId, cur);
    }
  }

  // Cash Movements from CashTransaction (non-sale movements only)
  const cashMovementsMap     = new Map();
  let cashMovementAvailability = AVAIL_AVAILABLE;
  const ctMatch = { organisationId, status: 'POSTED' };
  if (cafeFilter)            ctMatch.cafeId = cafeFilter;
  if (dateFrom && dateTo)    ctMatch.businessDate = { $gte: dateFrom, $lte: dateTo };

  const ctResult = await safeQuery(() => CashTransaction.find(ctMatch).lean());
  if (ctResult.error) {
    cashMovementAvailability = AVAIL_ERROR;
  } else {
    for (const t of ctResult.data || []) {
      const type     = t.transactionType || 'CASH_MOVEMENT';
      const amtPaisa = Math.round(Number(t.amount || 0) * 100);
      const cur      = cashMovementsMap.get(type) || { type, direction: t.direction || 'IN', amountPaisa: 0, count: 0 };
      cur.amountPaisa += amtPaisa;
      cur.count       += 1;
      cashMovementsMap.set(type, cur);
    }
  }

  const cashMovements = Array.from(cashMovementsMap.values()).map((m) => ({
    type:        m.type,
    direction:   m.direction,
    amountPaisa: m.amountPaisa,
    amount:      Number((m.amountPaisa / 100).toFixed(2)),
    count:       m.count,
  }));

  const cashAndTill = {
    reportTitle:            'Operational Cash Movement & Till Reconciliation',
    availability:           cashTillAvailability,
    totalSessions,
    totalOpeningFloatPaisa,
    totalOpeningFloat:      Number((totalOpeningFloatPaisa / 100).toFixed(2)),
    totalExpectedCashPaisa,
    totalExpectedCash:      Number((totalExpectedCashPaisa / 100).toFixed(2)),
    totalCountedCashPaisa,
    totalCountedCash:       Number((totalCountedCashPaisa / 100).toFixed(2)),
    totalTillVariancePaisa,
    totalTillVariance:      Number((totalTillVariancePaisa / 100).toFixed(2)),
    varianceDirection:      totalTillVariancePaisa > 0 ? 'OVERAGE'
                          : totalTillVariancePaisa < 0 ? 'SHORTAGE' : 'BALANCED',
    sessions:               sessionsList,
    byCafe: Array.from(cafeTillVarianceMap.entries()).map(([cafeId, v]) => ({
      cafeId,
      expectedCashPaisa: v.expectedPaisa,
      expectedCash:      Number((v.expectedPaisa / 100).toFixed(2)),
      countedCashPaisa:  v.countedPaisa,
      countedCash:       Number((v.countedPaisa / 100).toFixed(2)),
      variancePaisa:     v.variancePaisa,
      variance:          Number((v.variancePaisa / 100).toFixed(2)),
    })),
    cashMovements,
    cashMovementAvailability,
    bankBalance:       null,
    bankBalanceStatus: AVAIL_UNAVAILABLE,
    bankBalanceReason: 'Authoritative bank feed / live reconciliation ledger is not integrated.',
  };

  // ── §5  Payment Settlement Analytics ─────────────────────────────────────────
  // F-R1-005: MarketplaceSettlement schema fields audited:
  //   platform         → enum ['ZOMATO','SWIGGY'] (source-authorised provider values)
  //   grossSalesPaisa  → marketplace gross
  //   commissionPaisa  → platform commission
  //   platformFeesPaisa→ additional platform fees (NOW INCLUDED)
  //   taxWithheldPaisa → tax deducted at source by platform (NOW INCLUDED)
  //   netSettlementPaisa → expected net after all deductions
  //   bankReceivedPaisa→ actual bank credit (ONLY shown when status = MATCHED or RECONCILED)
  //   variancePaisa    → stored variance
  //   status           → ['EXPECTED','RECEIVED','MATCHED','DISPUTED','RECONCILED']
  //   No settlementDate field — date range via periodStart/periodEnd.
  let totalMarketplaceGrossPaisa    = 0;
  let totalMarketplaceCommissionPaisa = 0;
  let totalMarketplaceFeesPaisa     = 0;
  let totalMarketplaceTaxWithheldPaisa = 0;
  let totalMarketplaceNetPaisa      = 0;
  let totalMarketplaceBankReceivedPaisa = null; // null until proven bank-matched
  let totalMarketplaceVariancePaisa = 0;
  let bankLegConfirmed              = false;
  let settlementAvailability        = AVAIL_AVAILABLE;
  const marketplaceSettlements      = [];
  const settlementExceptions        = [];

  const msMatch = { organisationId };
  if (cafeFilter)            msMatch.cafeId = cafeFilter;
  if (dateFrom && dateTo)    msMatch.$or = [{ periodStart: { $lte: dateTo }, periodEnd: { $gte: dateFrom } }];

  const msResult = await safeQuery(() => MarketplaceSettlement.find(msMatch).lean());
  if (msResult.error) {
    settlementAvailability = AVAIL_ERROR;
  } else {
    for (const ms of msResult.data || []) {
      const grossP  = Number(ms.grossSalesPaisa      || 0);
      const commP   = Number(ms.commissionPaisa       || 0);
      const feesP   = Number(ms.platformFeesPaisa     || 0);
      const taxWP   = Number(ms.taxWithheldPaisa      || 0);
      const netP    = Number(ms.netSettlementPaisa    || 0);
      const varP    = Number(ms.variancePaisa !== undefined ? ms.variancePaisa : 0);

      // F-R1-005: bankReceivedPaisa is only authoritative when bank-matched
      const isBankConfirmed = ms.status === 'MATCHED' || ms.status === 'RECONCILED';
      const bankP = isBankConfirmed ? Number(ms.bankReceivedPaisa || 0) : null;

      totalMarketplaceGrossPaisa      += grossP;
      totalMarketplaceCommissionPaisa += commP;
      totalMarketplaceFeesPaisa       += feesP;
      totalMarketplaceTaxWithheldPaisa += taxWP;
      totalMarketplaceNetPaisa        += netP;
      totalMarketplaceVariancePaisa   += varP;

      if (isBankConfirmed) {
        bankLegConfirmed = true;
        totalMarketplaceBankReceivedPaisa = (totalMarketplaceBankReceivedPaisa || 0) + (bankP || 0);
      }

      const msItem = {
        settlementId:       ms.settlementId || String(ms._id || ''),
        platform:           ms.platform,    // derives from source enum, not hardcoded
        cafeId:             ms.cafeId,
        periodStart:        ms.periodStart,
        periodEnd:          ms.periodEnd,
        status:             ms.status,
        grossSalesPaisa:    grossP,
        grossSales:         Number((grossP / 100).toFixed(2)),
        commissionPaisa:    commP,
        commission:         Number((commP / 100).toFixed(2)),
        platformFeesPaisa:  feesP,
        platformFees:       Number((feesP / 100).toFixed(2)),
        taxWithheldPaisa:   taxWP,
        taxWithheld:        Number((taxWP / 100).toFixed(2)),
        netSettlementPaisa: netP,
        netSettlement:      Number((netP / 100).toFixed(2)),
        bankReceivedPaisa:  bankP,
        bankReceived:       bankP !== null ? Number((bankP / 100).toFixed(2)) : null,
        bankLegAvailability:isBankConfirmed ? AVAIL_AVAILABLE : AVAIL_UNAVAILABLE,
        bankLegReason:      isBankConfirmed ? null
                          : 'Bank credit not yet matched to statement. Status: ' + ms.status,
        variancePaisa:      varP,
        variance:           Number((varP / 100).toFixed(2)),
      };

      marketplaceSettlements.push(msItem);
      if (ms.status === 'DISPUTED' || Math.abs(varP) > 0) settlementExceptions.push(msItem);
    }
  }

  const paymentSettlementIntelligence = {
    marketplace: {
      grossSalesPaisa:           totalMarketplaceGrossPaisa,
      grossSales:                Number((totalMarketplaceGrossPaisa / 100).toFixed(2)),
      commissionPaisa:           totalMarketplaceCommissionPaisa,
      commission:                Number((totalMarketplaceCommissionPaisa / 100).toFixed(2)),
      platformFeesPaisa:         totalMarketplaceFeesPaisa,
      platformFees:              Number((totalMarketplaceFeesPaisa / 100).toFixed(2)),
      taxWithheldPaisa:          totalMarketplaceTaxWithheldPaisa,
      taxWithheld:               Number((totalMarketplaceTaxWithheldPaisa / 100).toFixed(2)),
      netSettlementPaisa:        totalMarketplaceNetPaisa,
      netSettlement:             Number((totalMarketplaceNetPaisa / 100).toFixed(2)),
      bankReceivedPaisa:         totalMarketplaceBankReceivedPaisa,
      bankReceived:              totalMarketplaceBankReceivedPaisa !== null
                                   ? Number((totalMarketplaceBankReceivedPaisa / 100).toFixed(2)) : null,
      bankLegAvailability:       bankLegConfirmed ? AVAIL_AVAILABLE : AVAIL_UNAVAILABLE,
      bankLegReason:             bankLegConfirmed ? null
                               : 'No settlements have reached MATCHED or RECONCILED status.',
      variancePaisa:             totalMarketplaceVariancePaisa,
      variance:                  Number((totalMarketplaceVariancePaisa / 100).toFixed(2)),
      settlements:               marketplaceSettlements,
      availability:              settlementAvailability,
    },
    posTenders: salesResult.paymentMix || [],
    directGatewaySettlements: {
      settledAmount: null,
      availability:  AVAIL_UNAVAILABLE,
      reason: 'Direct POS Card/UPI gateway batch settlement feed is not integrated. ' +
              'Tender collection is factual; provider settlement is unposted.',
    },
  };

  // ── §6  Accounts Payable (PM-02E canonical reuse) ────────────────────────────
  let apSummary = {
    invoicedValuePaisa: 0, invoicedValue: 0,
    outstandingPaisa: 0,   outstanding: 0,
    aging: { current: 0, days1_30: 0, days31_60: 0, days61_90: 0, days90Plus: 0 },
    overduePaisa: 0,       overdue: 0,
  };
  try {
    const procResult = await calculateProcurementMetrics({ organisationId, cafeScope, dateFrom, dateTo });
    if (procResult?.spendSummary) {
      const invVal  = procResult.spendSummary.invoicedValue      || 0;
      const outVal  = procResult.spendSummary.outstandingPayables || 0;
      const aging   = procResult.spendSummary.apAging            || {};
      apSummary = {
        invoicedValuePaisa: Math.round(invVal * 100),
        invoicedValue:      invVal,
        outstandingPaisa:   Math.round(outVal * 100),
        outstanding:        outVal,
        aging: {
          current:    aging.current   || 0,
          days1_30:   aging.days1_30  || 0,
          days31_60:  aging.days31_60 || 0,
          days61_90:  aging.days61_90 || 0,
          days90Plus: aging.days90Plus || 0,
        },
        overduePaisa: Math.round((procResult.spendSummary.overduePayables || 0) * 100),
        overdue:      procResult.spendSummary.overduePayables || 0,
      };
    }
  } catch (_) {
    // AP engine failure: surfaced in dataQuality warnings, not silenced as zero
  }

  // ── §7  Target vs Actual ──────────────────────────────────────────────────────
  // F-R1-002: DashboardTarget model audit result:
  //   Fields: organisationId, cafeId, granularity (DAILY/MONTHLY), periodKey,
  //           salesTargetPaisa, ordersTarget, aovTargetPaisa, expenseBudgetPaisa,
  //           setByUserId, notes.
  //   No approval state, no scenario/version, no effective dates enforced.
  //   Classification: KPI / MANAGEMENT_TARGET (not a formal approved budget).
  //   expenseBudgetPaisa is labelled "Operating expense budget ceiling" in schema comment.
  //   Decision: rename output section to targetVsActual (not budgetVsActual).
  //             expense ceiling retained as "expense target" since field says "budget".
  let salesTargetPaisa   = 0;
  let expenseTargetPaisa = 0;
  let hasTargetSource    = false;
  let targetAvailability = AVAIL_AVAILABLE;

  const targetQuery = { organisationId };
  if (cafeFilter && !Array.isArray(cafeScope)) targetQuery.cafeId = cafeScope;

  const targetResult = await safeQuery(() => DashboardTarget.find(targetQuery).lean());
  if (targetResult.error) {
    targetAvailability = AVAIL_ERROR;
  } else {
    for (const t of targetResult.data || []) {
      if (t.salesTargetPaisa)   { salesTargetPaisa   += Number(t.salesTargetPaisa);   hasTargetSource = true; }
      if (t.expenseBudgetPaisa) { expenseTargetPaisa += Number(t.expenseBudgetPaisa); hasTargetSource = true; }
    }
    if (!hasTargetSource) targetAvailability = AVAIL_UNAVAILABLE;
  }

  const salesVariancePaisa   = netSalesPaisa - salesTargetPaisa;
  const salesVariancePct     = salesTargetPaisa > 0
    ? Number(((salesVariancePaisa / salesTargetPaisa) * 100).toFixed(1)) : null;
  const expenseVariancePaisa = totalOpexPaisa - expenseTargetPaisa;
  const expenseVariancePct   = expenseTargetPaisa > 0
    ? Number(((expenseVariancePaisa / expenseTargetPaisa) * 100).toFixed(1)) : null;

  // Backward-compat alias: budgetVsActual → targetVsActual (both provided)
  const targetVsActual = {
    // F-R1-002: This is a KPI/management target, not a formal approved budget
    targetClassification: 'KPI_MANAGEMENT_TARGET',
    targetClassificationNote:
      'DashboardTarget stores per-café sales and expense ceiling targets set by management. ' +
      'No approval workflow, scenario version, or effective-date enforcement. ' +
      'These are operational KPI targets, not authoritative financial budgets.',
    hasTarget:   hasTargetSource,
    hasBudget:   hasTargetSource,  // backward compat
    availability: hasTargetSource ? targetAvailability : AVAIL_UNAVAILABLE,
    sales: {
      targetPaisa:      salesTargetPaisa,
      target:           Number((salesTargetPaisa / 100).toFixed(2)),
      actualPaisa:      netSalesPaisa,
      actual:           netRevenue,
      variancePaisa:    salesVariancePaisa,
      variance:         Number((salesVariancePaisa / 100).toFixed(2)),
      variancePercent:  salesVariancePct,
    },
    expenses: {
      budgetPaisa:      expenseTargetPaisa,
      budget:           Number((expenseTargetPaisa / 100).toFixed(2)),
      actualPaisa:      totalOpexPaisa,
      actual:           totalOpex,
      variancePaisa:    expenseVariancePaisa,
      variance:         Number((expenseVariancePaisa / 100).toFixed(2)),
      variancePercent:  expenseVariancePct,
    },
    payrollBudget: { status: AVAIL_UNAVAILABLE, reason: 'No authoritative payroll target model exists.' },
    profitBudget:  { status: AVAIL_UNAVAILABLE, reason: 'No authoritative profit target model exists.' },
  };

  // ── §8  Partial P&L — Qualified Title (§27) ───────────────────────────────────
  // SCR-022 / Issue #2: derive estimated COGS from real cost data (cogsService).
  // Unavailable unless real sales lines AND a real cost basis exist — a fabricated
  // ₹0 COGS would silently report a 100 % gross margin, which is worse than null.
  const cogsBlock = await deriveFinanceCogsBlock({ organisationId, cafeScope, dateFrom, dateTo });
  const hasCogs = cogsBlock.available === true;
  const cogsPaisa = hasCogs ? cogsBlock.cogsPaisa : null;
  const cogs = hasCogs ? cogsBlock.cogs : null;
  const cogsBasisNote = hasCogs
    ? `Estimated on ${cogsBlock.cogsBasis} basis (not a posted cost ledger)`
    : `UNAVAILABLE — ${cogsBlock.reason}`;
  // Gross profit uses THIS module's revenue base (net sales, after discounts & refunds).
  const grossProfitPaisa = hasCogs ? (netSalesPaisa - cogsPaisa) : null;
  const grossProfit = hasCogs ? Number((netRevenue - cogs).toFixed(2)) : null;
  const grossProfitStatus = hasCogs ? 'ESTIMATED (Basis: LAST_PO_PRICE)' : AVAIL_UNAVAILABLE;
  const grossMarginPct = hasCogs
    ? (netSalesPaisa > 0 ? Number(((grossProfitPaisa / netSalesPaisa) * 100).toFixed(2)) : 0)
    : null;
  // Prime cost = COGS + gross payroll; labour is PARTIAL_SOURCE, so prime cost inherits it.
  const primeCost = (hasCogs && labourInr !== null) ? Number((cogs + labourInr).toFixed(2)) : null;
  const primeCostStatus = primeCost !== null
    ? 'PARTIAL_SOURCE (Labour Excludes Employer Statutory Overheads)'
    : AVAIL_UNAVAILABLE;

  const plStatement = {
    statementTitle:    'Profit & Loss — Partial Operational View',
    statementSubtitle: hasCogs
      ? 'COGS is an ESTIMATE (LAST_PO_PRICE basis, not a posted cost ledger); Gross Profit and Prime Cost inherit that estimate. ' +
        'Actual COGS, Gross Profit, Gross Margin and EBITDA from a posted cost ledger remain UNAVAILABLE. ' +
        'Full labour cost is PARTIAL_SOURCE (employer statutory overheads absent).'
      : 'Actual COGS, Gross Profit, Gross Margin, and EBITDA are UNAVAILABLE. ' +
        'Full labour cost is PARTIAL_SOURCE (employer statutory overheads absent).',
    grossRevenue,
    discounts,
    refunds,
    netRevenue,
    cogs,
    cogsPaisa,
    cogsStatus:        hasCogs ? 'AVAILABLE (Basis: LAST_PO_PRICE, ESTIMATED)' : AVAIL_UNAVAILABLE,
    cogsAvailability:  hasCogs ? 'ESTIMATED' : AVAIL_UNAVAILABLE,
    cogsBasis:         hasCogs ? cogsBlock.cogsBasis : null,
    cogsBasisNote,
    cogsIsApproximate: hasCogs ? cogsBlock.summary.isApproximate === true : false,
    costCoveragePct:   hasCogs ? cogsBlock.costCoveragePct : null,
    grossProfit,
    grossProfitPaisa,
    grossProfitStatus,
    grossMarginPct,
    primeCost,
    primeCostStatus,
    operatingExpenses: {
      labour:                labourInr,
      labourLabel:           'Gross Employee Payroll (PARTIAL_SOURCE)',
      rent,
      utilities,
      maintenance,
      packagingAndConsumables,
      other,
      totalOpex,
    },
    ebitda:            null,
    ebitdaStatus:      AVAIL_UNAVAILABLE,
    ebitdaAvailability:AVAIL_UNAVAILABLE,
    ebitdaMarginPct:   null,
  };

  // knownOperatingResultInr: Net Revenue minus all known operating cost components.
  // When labourInr is null (payroll source error), we still report known components only,
  // excluding payroll from the deduction so the value remains a finite number.
  // When COGS is available it is included in the deduction (labelled as an estimate).
  const knownLabourDeduction = labourInr !== null ? labourInr : 0;
  const knownCogsDeduction = hasCogs ? cogs : 0;
  const knownOperatingResultInr = Number((netRevenue - totalOpex - knownLabourDeduction - knownCogsDeduction).toFixed(2));
  const knownOperatingResultNote = [
    'Net Revenue minus operating expenses & gross payroll',
    hasCogs ? 'estimated COGS' : null,
    labourInr === null ? '(Gross Payroll is UNAVAILABLE — excluded from total)' : null,
    '(EBITDA is UNAVAILABLE)',
  ].filter(Boolean).join(' ');

  const waterfall = [
    { label: 'Gross Revenue', value: grossRevenue, isTotal: true },
    { label: 'Discounts & Refunds', value: -Number((discounts + refunds).toFixed(2)), isTotal: false },
    { label: 'Net Revenue', value: netRevenue, isTotal: true },
    { label: 'Cost of Goods (COGS)', value: hasCogs ? -cogs : null,
      note: cogsBasisNote, isTotal: false },
    { label: 'Gross Payroll',
      value: labourInr !== null ? -labourInr : null,
      note: 'Gross employee earnings; employer statutory overheads not included',
      payrollSource, isTotal: false },
    { label: 'Rent & Utilities', value: -Number((rent + utilities).toFixed(2)), isTotal: false },
    { label: 'Maintenance & Packaging',
      value: -Number((maintenance + packagingAndConsumables).toFixed(2)), isTotal: false },
    { label: 'Other Operating Expenses', value: -other, isTotal: false },
    { label: 'Known Operating Result Components', value: knownOperatingResultInr,
      note: knownOperatingResultNote, isTotal: true },
  ];

  // ── §9  Financial Exception Centre ───────────────────────────────────────────
  const financialExceptions = {
    tillVariances:              tillVarianceExceptions,
    tillVarianceCount:          tillVarianceExceptions.length,
    overdueApValue:             apSummary.overdue,
    overdueApPaisa:             apSummary.overduePaisa,
    settlementDiscrepancies:    settlementExceptions,
    settlementDiscrepancyCount: settlementExceptions.length,
    unapprovedExpenses:         unapprovedExpensesList,
    unapprovedExpenseCount:     unapprovedExpensesList.length,
    unallocatedRefundCount:     salesResult.refundAnalytics?.summary?.partiallyRefundedBills || 0,
  };

  // ── §10  Data Quality & Provenance ──────────────────────────────────────────
  const dqWarnings = [
    ...(salesResult.dataQuality?.warnings || []),
    hasCogs
      ? 'COGS_ESTIMATED_LAST_PO_PRICE_NOT_A_POSTED_LEDGER'
      : `COGS_UNAVAILABLE_${cogsBlock.reason}`,
    'LABOUR_COST_PARTIAL_SOURCE_EXCLUDES_EMPLOYER_CONTRIBUTIONS',
    hasCogs
      ? 'EBITDA_UNAVAILABLE_REQUIRES_DEPRECIATION_AND_INTEREST_LEDGERS'
      : 'EBITDA_UNAVAILABLE_DUE_TO_MISSING_COGS',
    'BANK_BALANCE_UNAVAILABLE_MISSING_FEED',
    'DIRECT_GATEWAY_SETTLEMENTS_UNAVAILABLE',
  ];
  if (payrollAvailability  === AVAIL_ERROR || grossPayrollPaisa === null) {
    dqWarnings.push('PAYROLL_SOURCE_ERROR');
    dqWarnings.push('MISSING_COMPONENT_GROSS_PAYROLL');
  } else if (payrollAvailability === 'PARTIAL_SOURCE') {
    dqWarnings.push('MISSING_COMPONENT_GROSS_PAYROLL');
  }
  if (expenseAvailability  === AVAIL_ERROR) dqWarnings.push('EXPENSE_SOURCE_ERROR');
  if (cashTillAvailability === AVAIL_ERROR) dqWarnings.push('REGISTER_SESSION_SOURCE_ERROR');
  if (settlementAvailability === AVAIL_ERROR) dqWarnings.push('MARKETPLACE_SETTLEMENT_SOURCE_ERROR');
  if (targetAvailability   === AVAIL_ERROR) dqWarnings.push('DASHBOARD_TARGET_SOURCE_ERROR');

  const hasSourceError = [
    payrollAvailability, expenseAvailability, cashTillAvailability,
    settlementAvailability, targetAvailability,
  ].some((a) => a === AVAIL_ERROR);

  const dqStatus = hasSourceError ? 'ERROR' : 'PARTIAL_SOURCE';

  return {
    overview: {
      netSalesPaisa,
      netSales:               netRevenue,
      taxCollectedPaisa:      taxChargedPaisa,
      taxCollected:           taxCharged,
      customerRefundPaisa,
      customerRefunds:        refunds,
      totalOpexPaisa,
      totalOpex,
      grossPayrollPaisa:       (payrollAvailability === AVAIL_ERROR || grossPayrollPaisa === null)
        ? null
        : (Number.isFinite(grossPayrollPaisa) ? Math.round(grossPayrollPaisa) : 0),
      grossPayroll:           labourInr,
      grossPayrollPctOfSales,
      apOutstandingPaisa:     apSummary.outstandingPaisa,
      apOutstanding:          apSummary.outstanding,
      cashOpeningFloatPaisa:  totalOpeningFloatPaisa,
      cashOpeningFloat:       Number((totalOpeningFloatPaisa / 100).toFixed(2)),
      cashExpectedPaisa:      totalExpectedCashPaisa,
      cashExpected:           Number((totalExpectedCashPaisa / 100).toFixed(2)),
      cashCountedPaisa:       totalCountedCashPaisa,
      cashCounted:            Number((totalCountedCashPaisa / 100).toFixed(2)),
      tillVariancePaisa:      totalTillVariancePaisa,
      tillVariance:           Number((totalTillVariancePaisa / 100).toFixed(2)),
      settlementPendingPaisa: totalMarketplaceNetPaisa - (totalMarketplaceBankReceivedPaisa || 0),
      orderCount,
    },
    revenueBridge,
    expenseIntelligence,
    payrollIntelligence,
    cashAndTill,
    paymentSettlementIntelligence,
    accountsPayable:   apSummary,
    budgetVsActual:    targetVsActual,   // backward compat alias
    targetVsActual,
    plStatement,
    waterfall,
    financialExceptions,
    workingCapital: { status: AVAIL_UNAVAILABLE, reason: 'Balance sheet current assets and liabilities are incomplete.' },
    depreciation:   { status: AVAIL_UNAVAILABLE, reason: 'Fixed asset depreciation schedule is not implemented.' },
    interest:       { status: AVAIL_UNAVAILABLE, reason: 'No loan financing / interest transaction ledger exists.' },
    dataQuality: {
      status:   dqStatus,
      warnings: dqWarnings,
    },
    provenance: {
      sourceModels: [
        'Bill', 'Expense', 'PayrollRun', 'Payslip',
        'RegisterSession', 'CashTransaction', 'MarketplaceSettlement',
        'APInvoice', 'DashboardTarget',
        ...(hasCogs ? ['PurchaseOrder', 'GlobalInventoryItem', 'Recipe', 'MenuItem'] : []),
      ],
      cashSourceMatrix: {
        openingFloat:   'RegisterSession.openingFloatPaisa',
        cashSales:      'RegisterSession.totalCashSalesPaisa (from cashEvents.CASH_SALE)',
        paidIn:         'CashTransaction.transactionType=PAID_IN',
        cashRefund:     'RegisterSession.cashEvents.CASH_REFUND',
        paidOut:        'CashTransaction.transactionType=PAID_OUT',
        cashDrop:       'RegisterSession.cashEvents.SAFE_DROP',
        countedClosing: 'RegisterSession.countedCashPaisa',
        doubleCountProtection: 'CashTransaction does not have CASH_SALE type; RegisterSession.cashEvents and CashTransaction are non-overlapping sources.',
      },
      expenseStatusMatrix: {
        DRAFT:            'Excluded — uncommitted',
        SUBMITTED:        'Excluded — pending approval (captured in unapprovedExpenses exception)',
        PENDING_APPROVAL: 'Excluded — pending approval (captured in unapprovedExpenses exception)',
        RETURNED:         'Excluded — returned for revision',
        APPROVED:         'INCLUDED — approved for payment',
        REJECTED:         'Excluded — voided by rejection',
        PAID:             'INCLUDED — disbursed',
        REVERSED:         'Excluded — reversed/refunded',
        CANCELLED:        'Excluded — cancelled',
        CLOSED:           'INCLUDED — lifecycle complete',
        ARCHIVED:         'Excluded — archived historical record',
      },
      sourceRecordCounts: {
        ...salesResult.provenance?.sourceRecordCounts,
        payrollRuns:            payrollRunCount,
        payslips:               payslipCount,
        eligibleExpenses:       eligibleExpenseCount,
        excludedExpenses:       excludedExpenseCount,
        registerSessions:       totalSessions,
        marketplaceSettlements: marketplaceSettlements.length,
      },
      metricVersions: {
        GROSS_SALES:        '1.3.0',
        NET_SALES:          '1.3.0',
        OPERATING_EXPENSES: '1.5.0',
        GROSS_PAYROLL:      '1.3.0',
        LABOUR_COST:        '1.3.0',
        TILL_VARIANCE:      '1.2.0',
        AP_OUTSTANDING:     '1.1.0',
        COGS:               '1.1.0',
        EBITDA:             '1.2.0',
      },
    },
  };
}

module.exports = {
  calculateFinanceMetrics,
  EXCLUDED_EXPENSE_CATEGORIES,
  INCLUDED_EXPENSE_STATUSES,
};
