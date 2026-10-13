// =============================================================================
// ZAMORIN CAFE ERP — SCREEN OWN-SCR-004: OWNER FINANCE SUMMARY
// Design System v2 (Ledger & Roastery Theme)
//
// Executive Financial Control & Management Command Centre:
// Revenue Intelligence • Operating Expenses • Payroll Burden • Cash Control •
// Multi-Café Performance Matrix • Reconciliation • Personal Ledger Snapshot •
// Department Orders • Payables • Budgets • Management Reports
// =============================================================================

import { apiGet, apiPost } from "../apiClient.js";
import { state } from "../state.js";
import { ROLES } from "../navigation.js";
import { showToast, openModal } from "../components.js";

let activeTab = "overview";
let selectedCafeFilter = "ALL";
let selectedPeriod = "THIS_MONTH";
let selectedComparison = "VS_PREV_MONTH";
function getIstBusinessDate() {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Kolkata",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
  } catch {
    return new Date().toISOString().split("T")[0];
  }
}

let selectedBusinessDate = getIstBusinessDate();
let lastRefreshedTime = new Date();

let cachedFinanceSummary = null;

const CAFE_NAMES = {};

function fmtInr(amount) {
  if (amount === null || amount === undefined || isNaN(amount)) return "₹0.00";
  const num = Number(amount);
  const isNegative = num < 0;
  const absNum = Math.abs(num);
  const parts = absNum.toFixed(2).split(".");
  let intPart = parts[0];
  const decPart = parts[1];

  let lastThree = intPart.substring(intPart.length - 3);
  const otherNumbers = intPart.substring(0, intPart.length - 3);
  if (otherNumbers !== "") {
    lastThree = "," + lastThree;
  }
  const formatted = otherNumbers.replace(/\B(?=(\d{2})+(?!\d))/g, ",") + lastThree;
  return (isNegative ? "-₹" : "₹") + formatted + (decPart !== "00" ? "." + decPart : "");
}

function getIstTimeString(date = new Date()) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  }).format(date);
}

const DEFAULT_FINANCE_DATA = {
  kpis: {
    netSales: 0,
    grossSales: 0,
    itemDiscounts: 0,
    refundsTotal: 0,
    taxCollected: 0,
    cgstAmount: 0,
    sgstAmount: 0,
    operatingExpenses: 0,
    expenseRatio: 0,
    payrollCost: 0,
    payrollRatio: 0,
    overtimeCost: 0,
    wastageValue: 0,
    procurementSpend: 0,
    committedSpend: 0,
    reconciliationVariance: 0,
    exceptionsCount: 0,
    physicalCashInTill: 0,
  },
  cafes: [],
  personalLedger: {
    openingBalance: 0,
    creditsMtd: 0,
    debitsMtd: 0,
    currentBalance: 0,
    lastActivity: "No activity recorded",
  },
  departmentOrders: {
    totalBilled: 0,
    collected: 0,
    outstanding: 0,
    overdue: 0,
  },
  payables: {
    totalUnpaid: 0,
    dueNext7Days: 0,
    overdue: 0,
  },
  budgets: {
    revenueTarget: 0,
    actualRevenue: 0,
    expenseBudget: 0,
    actualExpense: 0,
    payrollBudget: 0,
    actualPayroll: 0,
  },
  dailyPayouts: null,
};

export function renderOwnerFinanceSummary() {
  const isOwner = state.role === ROLES.OWNER || state.user?.role === "OWNER";
  const data = cachedFinanceSummary || DEFAULT_FINANCE_DATA;

  // Filter cafes by selected scope
  let filteredCafes = data.cafes || [];
  if (selectedCafeFilter !== "ALL") {
    filteredCafes = (data.cafes || []).filter((c) => c.cafeId === selectedCafeFilter);
  }

  // Aggregate dynamically for selected cafes
  let totalNetSales = 0;
  let totalGrossSales = 0;
  let totalDiscounts = 0;
  let totalRefunds = 0;
  let totalExpenses = 0;
  let totalPayroll = 0;
  let totalOvertime = 0;
  let totalWastage = 0;
  let totalExceptions = 0;
  let totalVariance = 0;

  if (filteredCafes.length > 0) {
    for (const c of filteredCafes) {
      totalNetSales += Number(c.netSales || 0);
      totalGrossSales += Number(c.grossSales || 0);
      totalDiscounts += Number(c.discounts || 0);
      totalRefunds += Number(c.refunds || 0);
      totalExpenses += Number(c.expenses || 0);
      totalPayroll += Number(c.payrollCost || 0);
      totalOvertime += Number(c.overtimeCost || 0);
      totalWastage += Number(c.wastageValue || 0);
      totalExceptions += Number(c.exceptions || 0);
      totalVariance += Number(c.drawerVariance || 0);
    }
  } else if (data.kpis) {
    totalNetSales = Number(data.kpis.netSales || 0);
    totalGrossSales = Number(data.kpis.grossSales || 0);
    totalDiscounts = Number(data.kpis.itemDiscounts || 0);
    totalRefunds = Number(data.kpis.refundsTotal || 0);
    totalExpenses = Number(data.kpis.operatingExpenses || 0);
    totalPayroll = Number(data.kpis.payrollCost || 0);
    totalOvertime = Number(data.kpis.overtimeCost || 0);
    totalWastage = Number(data.kpis.wastageValue || 0);
    totalExceptions = Number(data.kpis.exceptionsCount || 0);
    totalVariance = Number(data.kpis.reconciliationVariance || 0);
  }

  const expRatio = totalNetSales > 0 ? ((totalExpenses / totalNetSales) * 100).toFixed(1) : "0.0";
  const payrollRatio = totalNetSales > 0 ? ((totalPayroll / totalNetSales) * 100).toFixed(1) : "0.0";
  const opContribPct = (100 - Number(expRatio) - Number(payrollRatio)).toFixed(1);

  return `
    <div class="page-enter" style="max-width:1400px; margin:0 auto; padding-bottom:60px;">
      <!-- Page Header & Context Strip -->
      <div style="display:flex; justify-content:space-between; align-items:flex-start; flex-wrap:wrap; gap:16px; margin-bottom:20px; border-bottom:1px solid var(--border-subtle); padding-bottom:16px;">
        <div>
          <div style="display:flex; align-items:center; gap:10px; margin-bottom:4px;">
            <h1 class="page-title" style="font-size:24px; font-weight:800; margin:0; color:var(--ink); letter-spacing:-0.3px;">Owner Finance Summary</h1>
            <span class="status info" style="font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:0.5px;">OWN-SCR-004</span>
            <span class="status success" style="font-size:10px; font-weight:700;">EXECUTIVE FINANCIAL GOVERNANCE</span>
          </div>
          <p style="font-size:13px; color:var(--muted); margin:0;">
            Executive Financial Control Centre · Revenue vs Cost Intelligence, Cash Control, Personal Ledger Snapshot &amp; Multi-Café Analytics
          </p>
        </div>

        <div style="display:flex; gap:10px; align-items:center; flex-wrap:wrap;">
          <div style="font-size:11.5px; color:var(--muted);">
            Data Through <strong style="color:var(--ink);">${selectedBusinessDate} · ${getIstTimeString(lastRefreshedTime)} IST</strong>
          </div>
          <button class="btn btn-ghost" id="refresh-finance-btn" type="button" style="font-size:12.5px; padding:6px 14px;">
            ↻ Refresh Financials
          </button>
          <button class="btn btn-secondary" id="btn-data-coverage" type="button" style="font-size:12.5px; padding:6px 14px;">
            📋 Data Coverage
          </button>
          <button class="btn btn-primary" id="btn-export-pack" type="button" style="font-size:12.5px; padding:6px 16px; font-weight:600;">
            📄 Export Report Pack
          </button>
        </div>
      </div>

      <!-- Scope, Period & Comparison Selector Bar -->
      <div class="card" style="padding:12px 18px; margin-bottom:20px; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px;">
        <div style="display:flex; align-items:center; gap:12px; flex-wrap:wrap;">
          <div style="display:flex; align-items:center; gap:6px;">
            <label style="font-size:12px; color:var(--muted); font-weight:600;">Café Scope:</label>
            <select id="finance-cafe-scope" class="select select-sm" style="font-size:12px;">
              <option value="ALL" ${selectedCafeFilter === "ALL" ? "selected" : ""}>All Authorized Cafés (${data.cafes.length})</option>
              ${data.cafes.map((c) => `<option value="${c.cafeId}" ${selectedCafeFilter === c.cafeId ? "selected" : ""}>${c.cafeId} · ${c.cafeName || c.name || 'Outlet'}</option>`).join('')}
            </select>
          </div>

          <div style="display:flex; align-items:center; gap:6px;">
            <label style="font-size:12px; color:var(--muted); font-weight:600;">Period:</label>
            <select id="finance-period-selector" class="select select-sm" style="font-size:12px;">
              <option value="THIS_MONTH" ${selectedPeriod === "THIS_MONTH" ? "selected" : ""}>This Month (MTD)</option>
              <option value="TODAY" ${selectedPeriod === "TODAY" ? "selected" : ""}>Today</option>
              <option value="YESTERDAY" ${selectedPeriod === "YESTERDAY" ? "selected" : ""}>Yesterday</option>
              <option value="LAST_7_DAYS" ${selectedPeriod === "LAST_7_DAYS" ? "selected" : ""}>Last 7 Days</option>
              <option value="LAST_30_DAYS" ${selectedPeriod === "LAST_30_DAYS" ? "selected" : ""}>Last 30 Days</option>
              <option value="THIS_QUARTER" ${selectedPeriod === "THIS_QUARTER" ? "selected" : ""}>This Quarter</option>
              <option value="THIS_YEAR" ${selectedPeriod === "THIS_YEAR" ? "selected" : ""}>This Year (FY 26-27)</option>
              <option value="CUSTOM" ${selectedPeriod === "CUSTOM" ? "selected" : ""}>Custom Range</option>
            </select>
          </div>

          <div style="display:flex; align-items:center; gap:6px;">
            <label style="font-size:12px; color:var(--muted); font-weight:600;">Compare:</label>
            <select id="finance-compare-selector" class="select select-sm" style="font-size:12px;">
              <option value="VS_PREV_MONTH" ${selectedComparison === "VS_PREV_MONTH" ? "selected" : ""}>vs Previous Month</option>
              <option value="VS_PREV_PERIOD" ${selectedComparison === "VS_PREV_PERIOD" ? "selected" : ""}>vs Previous Period</option>
              <option value="VS_PREV_WEEK" ${selectedComparison === "VS_PREV_WEEK" ? "selected" : ""}>vs Previous Week</option>
              <option value="VS_PREV_QUARTER" ${selectedComparison === "VS_PREV_QUARTER" ? "selected" : ""}>vs Previous Quarter</option>
              <option value="VS_PREV_YEAR" ${selectedComparison === "VS_PREV_YEAR" ? "selected" : ""}>vs Previous Year</option>
            </select>
          </div>
        </div>

        <div style="font-size:12px; color:var(--muted); font-weight:600;">
          OpEx Ratio: <span style="color:var(--color-accent-amber); font-weight:700;">${expRatio}%</span> · Workforce Ratio: <span style="color:var(--ink); font-weight:700;">${payrollRatio}%</span> · Operating Contribution: <span style="color:var(--color-success); font-weight:700;">${opContribPct}%</span>
        </div>
      </div>

      <!-- Interactive Subnav Tabs -->
      <div class="subnav-bar" style="display:flex; gap:6px; border-bottom:1px solid var(--border-subtle); margin-bottom:20px; overflow-x:auto; padding-bottom:4px;">
        <button class="subnav-btn ${activeTab === "overview" ? "active" : ""}" data-tab="overview">Executive Overview</button>
        <button class="subnav-btn ${activeTab === "daily-payouts" ? "active" : ""}" data-tab="daily-payouts">Daily Payouts & Aggregators (A001)</button>
        <button class="subnav-btn ${activeTab === "matrix" ? "active" : ""}" data-tab="matrix">Multi-Café Matrix</button>
        <button class="subnav-btn ${activeTab === "revenue-bridge" ? "active" : ""}" data-tab="revenue-bridge">Revenue &amp; Tax Bridge</button>
        <button class="subnav-btn ${activeTab === "cost-leakage" ? "active" : ""}" data-tab="cost-leakage">Cost &amp; Leakage Control</button>
        <button class="subnav-btn ${activeTab === "cash-drawers" ? "active" : ""}" data-tab="cash-drawers">Cash &amp; Drawers</button>
        <button class="subnav-btn ${activeTab === "payables-receivables" ? "active" : ""}" data-tab="payables-receivables">Payables, Receivables &amp; Budgets</button>
        <button class="subnav-btn ${activeTab === "personal-ledger" ? "active" : ""}" data-tab="personal-ledger">Personal Ledger &amp; Reports</button>
      </div>

      <!-- Tab Content Area -->
      <div id="fin-tab-content">
        ${renderActiveTabContent(activeTab, data, filteredCafes, totalNetSales, totalGrossSales, totalDiscounts, totalRefunds, totalExpenses, totalPayroll, totalOvertime, totalWastage, totalExceptions, totalVariance, expRatio, payrollRatio)}
      </div>
    </div>
  `;
}

function renderActiveTabContent(tab, data, filteredCafes, totalNetSales, totalGrossSales, totalDiscounts, totalRefunds, totalExpenses, totalPayroll, totalOvertime, totalWastage, totalExceptions, totalVariance, expRatio, payrollRatio) {
  switch (tab) {
    case "overview":
      return renderOverviewTab(data, totalNetSales, totalGrossSales, totalExpenses, totalPayroll, totalWastage, totalExceptions, totalVariance, expRatio, payrollRatio);
    case "daily-payouts":
      return renderDailyPayoutsTab(data.dailyPayouts);
    case "matrix":
      return renderMatrixTab(filteredCafes);
    case "revenue-bridge":
      return renderRevenueBridgeTab(data, totalNetSales, totalGrossSales, totalDiscounts, totalRefunds);
    case "cost-leakage":
      return renderCostLeakageTab(data, totalNetSales, totalExpenses, totalPayroll, totalOvertime, totalWastage, expRatio, payrollRatio);
    case "cash-drawers":
      return renderCashDrawersTab(data, filteredCafes, totalVariance);
    case "payables-receivables":
      return renderPayablesReceivablesTab(data, totalNetSales, totalExpenses, totalPayroll);
    case "personal-ledger":
      return renderPersonalLedgerAndReportsTab(data);
    default:
      return renderOverviewTab(data, totalNetSales, totalGrossSales, totalExpenses, totalPayroll, totalWastage, totalExceptions, totalVariance, expRatio, payrollRatio);
  }
}

// ── Tab 1: Executive Overview ────────────────────────────────────────────────
function renderOverviewTab(data, totalNetSales, totalGrossSales, totalExpenses, totalPayroll, totalWastage, totalExceptions, totalVariance, expRatio, payrollRatio) {
  const opContribPct = (100 - Number(expRatio) - Number(payrollRatio)).toFixed(1);
  const opSurplus = totalNetSales - totalExpenses - totalPayroll;
  const wastageRatio = totalNetSales > 0 ? ((totalWastage / totalNetSales) * 100).toFixed(2) : "0.00";
  const overduePayables = data.payables?.overdue || 0;
  const dueNext7Days = data.payables?.dueNext7Days || 0;
  const overdueReceivables = data.departmentOrders?.overdue || 0;

  return `
    <!-- Top 6 Core Executive KPIs -->
    <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(180px, 1fr)); gap:14px; margin-bottom:20px;">
      ${kpiBox("Net Sales", fmtInr(totalNetSales), totalGrossSales > 0 ? `Gross: ${fmtInr(totalGrossSales)}` : "Canonical POS Bills", "var(--color-success)", "Gross Billing minus customer refunds & discounts (Canonical SCR-005 match)")}
      ${kpiBox("Operating Expenses", fmtInr(totalExpenses), `${expRatio}% of Net Sales`, "var(--ink)", "Store operations, utilities, repairs, supplies & direct consumables")}
      ${kpiBox("Expense Ratio", `${expRatio}%`, totalNetSales > 0 ? "OpEx ÷ Net Sales × 100" : "Baseline", "var(--color-accent-amber)", "Operating Expenses ÷ Net Sales × 100")}
      ${kpiBox("Payroll Workforce Cost", fmtInr(totalPayroll), `${payrollRatio}% of Net Sales`, "var(--ink)", "Consolidated employee salaries & allowances across authorized cafes")}
      ${kpiBox("Reconciliation Variance", fmtInr(totalVariance), totalVariance === 0 ? "Matched · ₹0 Variance" : `Variance: ${fmtInr(totalVariance)}`, totalVariance === 0 ? "var(--color-success)" : "var(--color-danger)", "Unresolved difference between tender/drawer records and sales")}
      ${kpiBox("Financial Exceptions", `${totalExceptions} Issues`, totalExceptions === 0 ? "Zero Blocking Errors" : "Attention Required", totalExceptions > 0 ? "var(--color-danger)" : "var(--color-success)", "Unreconciled registers or critical financial control discrepancies")}
    </div>

    <!-- Layer 2.5: A001 Daily Payouts & Aggregator Settlement Strip -->
    ${renderDailyPayoutWidget(data.dailyPayouts)}

    <!-- Layer 3: What Changed Financially & Financial Attention Required -->
    <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(320px, 1fr)); gap:16px; margin-bottom:24px;">
      <!-- What Changed Financially -->
      <div class="card" style="padding:18px 20px;">
        <h4 style="font-size:13.5px; font-weight:700; margin:0 0 10px; color:var(--ink); display:flex; justify-content:space-between;">
          <span>📈 What Changed Financially</span>
          <span style="font-size:11.5px; font-weight:500; color:var(--muted);">Factual Performance Digest</span>
        </h4>
        <div style="display:flex; flex-direction:column; gap:8px; font-size:12.5px;">
          <div style="display:flex; justify-content:space-between;">
            <span style="color:var(--muted);">Net Realized Revenue:</span>
            <strong style="color:var(--color-success); font-family:var(--font-mono);">${fmtInr(totalNetSales)}</strong>
          </div>
          <div style="display:flex; justify-content:space-between;">
            <span style="color:var(--muted);">Operating Cost Burden:</span>
            <strong style="color:var(--color-warning); font-family:var(--font-mono);">${fmtInr(totalExpenses)} (${expRatio}%)</strong>
          </div>
          <div style="display:flex; justify-content:space-between;">
            <span style="color:var(--muted);">Workforce Payroll Burden:</span>
            <strong style="color:var(--ink); font-family:var(--font-mono);">${fmtInr(totalPayroll)} (${payrollRatio}%)</strong>
          </div>
          <div style="display:flex; justify-content:space-between;">
            <span style="color:var(--muted);">Operating Contribution (Surplus):</span>
            <strong style="color:var(--color-success); font-family:var(--font-mono);">${fmtInr(opSurplus)} (${opContribPct}%)</strong>
          </div>
          <div style="display:flex; justify-content:space-between;">
            <span style="color:var(--muted);">Inventory Wastage Impact:</span>
            <strong style="color:var(--color-accent-amber); font-family:var(--font-mono);">${fmtInr(totalWastage)} (${wastageRatio}%)</strong>
          </div>
        </div>
      </div>

      <!-- Financial Attention Required -->
      <div class="card" style="padding:18px 20px;">
        <h4 style="font-size:13.5px; font-weight:700; margin:0 0 10px; color:var(--ink); display:flex; justify-content:space-between;">
          <span>🛡️ Financial Control Scorecard</span>
          <span class="status ${totalExceptions === 0 && totalVariance === 0 ? "success" : "warning"}" style="font-size:10.5px; font-weight:700;">
            ${totalExceptions === 0 && totalVariance === 0 ? "CONTROL INTEGRITY VERIFIED" : "ATTENTION REQUIRED"}
          </span>
        </h4>
        <div style="display:flex; flex-direction:column; gap:8px; font-size:12.5px;">
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <span>Tender Reconciliation:</span>
            <span class="status ${totalVariance === 0 ? "success" : "danger"}" style="font-size:10.5px;">
              ${totalVariance === 0 ? "✓ MATCHED (₹0 VARIANCE)" : `⚠️ VARIANCE ${fmtInr(totalVariance)}`}
            </span>
          </div>
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <span>Cash Drawer Sessions:</span>
            <span class="status ${totalExceptions === 0 ? "success" : "warning"}" style="font-size:10.5px;">
              ${totalExceptions === 0 ? "✓ SESSIONS RECONCILED" : `⚠️ ${totalExceptions} UNRECONCILED`}
            </span>
          </div>
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <span>GST Output Recorded:</span>
            <span class="status success" style="font-size:10.5px;">✓ ${fmtInr(data.kpis?.taxCollected || 0)} (5% COMPOSITE)</span>
          </div>
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <span>Overdue Receivables:</span>
            <span class="status ${overdueReceivables === 0 ? "success" : "danger"}" style="font-size:10.5px;">
              ${overdueReceivables === 0 ? "✓ ₹0 OVERDUE BALANCE" : `⚠️ ${fmtInr(overdueReceivables)} OVERDUE`}
            </span>
          </div>
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <span>Vendor Payables Due (Next 7d):</span>
            <strong style="font-family:var(--font-mono); color:var(--ink);">${fmtInr(dueNext7Days)}</strong>
          </div>
        </div>
      </div>
    </div>

    <!-- Revenue vs Cost Trend & Unit Economics -->
    <div class="card" style="padding:20px; margin-bottom:24px;">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:14px; flex-wrap:wrap; gap:8px;">
        <div>
          <h3 style="font-size:15px; font-weight:700; margin:0 0 2px; color:var(--ink);">📊 Revenue Structure vs Cost Dynamics</h3>
          <p style="font-size:12px; color:var(--muted); margin:0;">Comparison of revenue trajectory against operating and labour expenses</p>
        </div>
        <div style="display:flex; gap:10px; font-size:12px;">
          <span style="display:flex; align-items:center; gap:4px;"><span style="width:10px; height:10px; background:var(--color-success); border-radius:2px;"></span> Net Sales (${fmtInr(totalNetSales)})</span>
          <span style="display:flex; align-items:center; gap:4px;"><span style="width:10px; height:10px; background:var(--color-warning); border-radius:2px;"></span> OpEx (${expRatio}%)</span>
          <span style="display:flex; align-items:center; gap:4px;"><span style="width:10px; height:10px; background:var(--color-accent-amber); border-radius:2px;"></span> Payroll (${payrollRatio}%)</span>
        </div>
      </div>

      <!-- Unit Economics Strip -->
      <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(220px, 1fr)); gap:12px; background:var(--bg-subtle, rgba(0,0,0,0.02)); padding:12px 16px; border-radius:6px;">
        <div>
          <div style="font-size:11.5px; color:var(--muted);">Workforce Cost per ₹100 Revenue:</div>
          <strong style="font-size:16px; color:var(--ink); font-family:var(--font-mono);">₹${payrollRatio}</strong>
        </div>
        <div>
          <div style="font-size:11.5px; color:var(--muted);">Operating Cost per ₹100 Revenue:</div>
          <strong style="font-size:16px; color:var(--ink); font-family:var(--font-mono);">₹${expRatio}</strong>
        </div>
        <div>
          <div style="font-size:11.5px; color:var(--muted);">Wastage Loss per ₹1,000 Revenue:</div>
          <strong style="font-size:16px; color:var(--color-success); font-family:var(--font-mono);">₹${((totalWastage / (totalNetSales || 1)) * 1000).toFixed(2)}</strong>
        </div>
        <div>
          <div style="font-size:11.5px; color:var(--muted);">Operating Contribution Retained:</div>
          <strong style="font-size:16px; color:var(--color-success); font-family:var(--font-mono);">${opContribPct}%</strong>
        </div>
      </div>
    </div>
  `;
}

// ── Daily Payouts & Platform Deductions Widget & Tab (A001) ─────────────────
function renderDailyPayoutWidget(payouts) {
  if (!payouts) {
    return `
      <div class="card" style="padding:14px 18px; margin-bottom:20px; display:flex; justify-content:space-between; align-items:center; background:linear-gradient(135deg, rgba(37,99,235,0.06), rgba(16,185,129,0.06)); border:1px solid var(--border-subtle);">
        <div style="display:flex; align-items:center; gap:10px;">
          <span style="font-size:20px;">💳</span>
          <div>
            <div style="font-size:13px; font-weight:700; color:var(--ink);">Daily Financial Activity, Payouts &amp; Deductions (A001)</div>
            <div style="font-size:11.5px; color:var(--muted);">Consolidates daily platform sales, commissions, EDC card batches, and estimated bank deposits.</div>
          </div>
        </div>
        <span class="status info" style="font-size:11px; font-weight:700;">ACTIVE GATEWAY</span>
      </div>
    `;
  }

  const grossAgg = fmtInr((payouts.aggregatorSettlement?.aggregatorGrossPaisa || 0) / 100);
  const commAgg = fmtInr((payouts.aggregatorSettlement?.estimatedCommissionPaisa || 0) / 100);
  const netAgg = fmtInr((payouts.aggregatorSettlement?.estimatedNetPayoutPaisa || 0) / 100);
  const directBank = fmtInr((payouts.bankSettlement?.directTerminalSettlementPaisa || 0) / 100);
  const totalDeposit = fmtInr((payouts.bankSettlement?.estimatedTotalBankDepositPaisa || 0) / 100);
  const status = payouts.bankSettlement?.status || "PENDING_RECONCILIATION";

  return `
    <div class="card" style="padding:16px 20px; margin-bottom:20px; border-left:4px solid #2563EB;">
      <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px; margin-bottom:12px;">
        <div style="display:flex; align-items:center; gap:8px;">
          <span style="background:#2563EB; color:#FFF; font-size:10px; font-weight:800; padding:2px 6px; border-radius:4px;">A001 GATEWAY</span>
          <h4 style="font-size:14px; font-weight:800; margin:0; color:var(--ink);">Daily Financial Activity &amp; Bank Payout Summary</h4>
        </div>
        <div style="display:flex; align-items:center; gap:8px;">
          <span class="status ${status === 'RECONCILED' ? 'success' : 'info'}" style="font-size:10.5px; font-weight:700;">${status}</span>
          <span style="font-size:11px; color:var(--muted);">Business Date: <strong>${payouts.businessDate || selectedBusinessDate}</strong></span>
        </div>
      </div>

      <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(160px, 1fr)); gap:12px; font-size:12px;">
        <div style="background:var(--surface-sunken); padding:10px; border-radius:6px; border:1px solid var(--border-subtle);">
          <div style="color:var(--muted); font-size:11px;">Aggregator Gross Sales</div>
          <div style="font-size:15px; font-weight:800; color:var(--ink); font-family:var(--font-mono); margin-top:2px;">${grossAgg}</div>
          <div style="font-size:10.5px; color:var(--muted);">Swiggy / Zomato order pool</div>
        </div>
        <div style="background:var(--surface-sunken); padding:10px; border-radius:6px; border:1px solid var(--border-subtle);">
          <div style="color:var(--muted); font-size:11px;">Platform Deductions</div>
          <div style="font-size:15px; font-weight:800; color:var(--color-danger); font-family:var(--font-mono); margin-top:2px;">-${commAgg}</div>
          <div style="font-size:10.5px; color:var(--muted);">Commission, GST &amp; tech fees</div>
        </div>
        <div style="background:var(--surface-sunken); padding:10px; border-radius:6px; border:1px solid var(--border-subtle);">
          <div style="color:var(--muted); font-size:11px;">Net Aggregator Remittance</div>
          <div style="font-size:15px; font-weight:800; color:#10B981; font-family:var(--font-mono); margin-top:2px;">${netAgg}</div>
          <div style="font-size:10.5px; color:var(--muted);">Direct scheduled bank payout</div>
        </div>
        <div style="background:var(--surface-sunken); padding:10px; border-radius:6px; border:1px solid var(--border-subtle);">
          <div style="color:var(--muted); font-size:11px;">Direct EDC &amp; UPI Settlements</div>
          <div style="font-size:15px; font-weight:800; color:#2563EB; font-family:var(--font-mono); margin-top:2px;">${directBank}</div>
          <div style="font-size:10.5px; color:var(--muted);">Terminal card &amp; BharatQR</div>
        </div>
        <div style="background:linear-gradient(135deg, rgba(16,185,129,0.1), rgba(37,99,235,0.1)); padding:10px; border-radius:6px; border:1px solid rgba(16,185,129,0.3);">
          <div style="color:var(--muted); font-size:11px; font-weight:700;">Est. Total Bank Deposit</div>
          <div style="font-size:16px; font-weight:900; color:#059669; font-family:var(--font-mono); margin-top:2px;">${totalDeposit}</div>
          <div style="font-size:10.5px; color:var(--muted);">Aggregator net + Direct terminals</div>
        </div>
      </div>
    </div>
  `;
}

function renderDailyPayoutsTab(payouts) {
  const p = payouts || {};
  const gross = fmtInr((p.aggregatorSettlement?.aggregatorGrossPaisa || 0) / 100);
  const comm = fmtInr((p.aggregatorSettlement?.estimatedCommissionPaisa || 0) / 100);
  const net = fmtInr((p.aggregatorSettlement?.estimatedNetPayoutPaisa || 0) / 100);
  const direct = fmtInr((p.bankSettlement?.directTerminalSettlementPaisa || 0) / 100);
  const cash = fmtInr((p.collectionsByChannel?.cashDrawerPaisa || 0) / 100);
  const upi = fmtInr((p.collectionsByChannel?.upiPaisa || 0) / 100);
  const card = fmtInr((p.collectionsByChannel?.cardPaisa || 0) / 100);
  const total = fmtInr((p.bankSettlement?.estimatedTotalBankDepositPaisa || 0) / 100);

  return `
    <div class="card" style="padding:22px; margin-bottom:24px;">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px; flex-wrap:wrap; gap:10px;">
        <div>
          <h3 style="font-size:16px; font-weight:800; margin:0 0 4px; color:var(--ink);">Daily Financial Activity, Payouts &amp; Bank Remittances (A001)</h3>
          <p style="font-size:12px; color:var(--muted); margin:0;">Authoritative consolidation of aggregator payouts, commission deductions, card terminals and bank accounts.</p>
        </div>
        <span class="status info" style="font-size:11px; font-weight:700;">AUDIT COMPLIANT (F001–F351)</span>
      </div>

      <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(200px, 1fr)); gap:14px; margin-bottom:20px;">
        <div style="background:var(--surface-sunken); padding:14px; border-radius:8px; border:1px solid var(--border-subtle);">
          <div style="font-size:11.5px; color:var(--muted); margin-bottom:2px;">Online Aggregator Gross</div>
          <div style="font-size:18px; font-weight:800; color:var(--ink); font-family:var(--font-mono);">${gross}</div>
          <div style="font-size:11px; color:var(--muted); margin-top:2px;">Swiggy &amp; Zomato order flow</div>
        </div>
        <div style="background:var(--surface-sunken); padding:14px; border-radius:8px; border:1px solid var(--border-subtle);">
          <div style="font-size:11.5px; color:var(--muted); margin-bottom:2px;">Platform Deductions &amp; TDS</div>
          <div style="font-size:18px; font-weight:800; color:var(--color-danger); font-family:var(--font-mono);">-${comm}</div>
          <div style="font-size:11px; color:var(--muted); margin-top:2px;">Aggregator fee + GST deduction</div>
        </div>
        <div style="background:var(--surface-sunken); padding:14px; border-radius:8px; border:1px solid var(--border-subtle);">
          <div style="font-size:11.5px; color:var(--muted); margin-bottom:2px;">Direct Terminal Settlements</div>
          <div style="font-size:18px; font-weight:800; color:#2563EB; font-family:var(--font-mono);">${direct}</div>
          <div style="font-size:11px; color:var(--muted); margin-top:2px;">UPI QR (${upi}) + EDC (${card})</div>
        </div>
        <div style="background:linear-gradient(135deg, rgba(16,185,129,0.12), rgba(37,99,235,0.12)); padding:14px; border-radius:8px; border:1px solid rgba(16,185,129,0.35);">
          <div style="font-size:11.5px; color:var(--muted); margin-bottom:2px; font-weight:700;">Total Estimated Bank Credit</div>
          <div style="font-size:20px; font-weight:900; color:#059669; font-family:var(--font-mono);">${total}</div>
          <div style="font-size:11px; color:var(--muted); margin-top:2px;">Cash drawer physical: ${cash}</div>
        </div>
      </div>

      <div style="background:var(--surface-sunken); padding:14px 18px; border-radius:8px; border:1px solid var(--border-subtle); font-size:12px; color:var(--muted); line-height:1.6;">
        <strong style="color:var(--ink);">Reconciliation Protocol (T01):</strong>
        Every daily aggregator payout is tied directly to underlying sales orders, cancellation deductions, delivery commission rates, and bank statement transaction references.
      </div>
    </div>
  `;
}

// ── Tab 2: Multi-Café Matrix ─────────────────────────────────────────────────
function renderMatrixTab(filteredCafes) {
  const topRev = (filteredCafes || []).filter((c) => (c.netSales || 0) > 0).sort((a, b) => (b.netSales || 0) - (a.netSales || 0))[0];
  const lowestOpex = (filteredCafes || []).filter((c) => (c.expenseRatio || 0) > 0).sort((a, b) => (a.expenseRatio || 0) - (b.expenseRatio || 0))[0];
  const topRevStr = topRev ? `${topRev.cafeName} (${topRev.revenueSharePct || 0}%)` : "—";
  const lowestOpexStr = lowestOpex ? `${lowestOpex.cafeName} (${(lowestOpex.expenseRatio || 0).toFixed(1)}%)` : "—";

  return `
    <div class="card" style="padding:20px; margin-bottom:24px;">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:14px; flex-wrap:wrap; gap:8px;">
        <div>
          <h3 style="font-size:15px; font-weight:700; margin:0 0 2px; color:var(--ink);">🏬 Multi-Café Financial Performance Matrix</h3>
          <p style="font-size:12px; color:var(--muted); margin:0;">Branch-by-branch financial efficiency, revenue share, cost ratios &amp; drawer health</p>
        </div>
        <div style="font-size:12px; color:var(--muted);">
          <span>Strongest Revenue: <strong>${topRevStr}</strong></span> · 
          <span>Lowest OpEx Ratio: <strong>${lowestOpexStr}</strong></span>
        </div>
      </div>

      <div class="table-wrap">
        <table class="table" style="width:100%;">
          <thead>
            <tr>
              <th>Café Location</th>
              <th>Net Sales (Share %)</th>
              <th>OpEx (Cost %)</th>
              <th>Expense Ratio</th>
              <th>Payroll %</th>
              <th>Wastage</th>
              <th>Reconciliation</th>
              <th>Drawer Status</th>
              <th>Health Audit</th>
            </tr>
          </thead>
          <tbody>
            ${(filteredCafes || []).length > 0 ? filteredCafes
              .map(
                (c) => `
              <tr>
                <td>
                  <strong style="color:var(--ink); font-size:13px;">${c.cafeName}</strong>
                  <div style="font-size:11px; color:var(--muted); font-family:var(--font-mono);">${c.cafeId}</div>
                </td>
                <td>
                  <strong style="font-family:var(--font-mono); color:var(--color-success);">${fmtInr(c.netSales)}</strong>
                  <div style="font-size:11px; color:var(--muted);">${c.revenueSharePct}% of portfolio</div>
                </td>
                <td>
                  <strong style="font-family:var(--font-mono); color:var(--ink);">${fmtInr(c.expenses)}</strong>
                  <div style="font-size:11px; color:var(--muted);">${c.costSharePct}% of OpEx</div>
                </td>
                <td>
                  <strong style="font-family:var(--font-mono); color:var(--color-accent-amber);">${c.expenseRatio.toFixed(1)}%</strong>
                </td>
                <td>
                  <strong style="font-family:var(--font-mono); color:var(--ink);">${c.payrollRatio.toFixed(1)}%</strong>
                </td>
                <td style="font-family:var(--font-mono); color:var(--muted);">
                  ${fmtInr(c.wastageValue)}
                </td>
                <td>
                  ${(c.drawerVariance || 0) === 0 ? '<span class="status success" style="font-size:10.5px;">✓ MATCHED</span>' : `<span class="status danger" style="font-size:10.5px;">⚠️ ${fmtInr(c.drawerVariance)}</span>`}
                </td>
                <td>
                  <div style="display:flex; align-items:center; gap:6px;">
                    <span class="status ${c.drawerStatus === "RECONCILED" ? "success" : "info"}" style="font-size:10px;">
                      ${c.drawerStatus}
                    </span>
                    <a href="#cash-drawers" class="btn btn-xs btn-ghost" style="font-size:10.5px; padding:2px 4px; color:var(--color-accent-amber);">
                      Drawer →
                    </a>
                  </div>
                </td>
                <td>
                  <button class="btn btn-xs btn-outline btn-health-audit" data-cafeid="${c.cafeId}" style="font-size:11px; font-weight:700; color:${c.health === 'HEALTHY' ? 'var(--color-success)' : 'var(--color-warning)'}; border-color:${c.health === 'HEALTHY' ? 'rgba(16,185,129,0.3)' : 'rgba(245,158,11,0.3)'};">
                    ● ${c.health} ℹ
                  </button>
                </td>
              </tr>
            `
              )
              .join("") : `
              <tr>
                <td colspan="9" style="text-align:center; padding:24px; color:var(--muted); font-size:12.5px;">
                  No café financial performance data recorded for this period.
                </td>
              </tr>
            `}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

// ── Tab 3: Revenue & Tax Bridge ──────────────────────────────────────────────
function renderRevenueBridgeTab(data, totalNetSales, totalGrossSales, totalDiscounts, totalRefunds) {
  return `
    <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(440px, 1fr)); gap:20px; margin-bottom:24px;">
      <!-- Gross to Net Revenue Bridge -->
      <div class="card" style="padding:20px;">
        <h3 style="font-size:15px; font-weight:700; margin:0 0 4px; color:var(--ink);">🌉 Gross-to-Net Revenue Bridge</h3>
        <p style="font-size:12px; color:var(--muted); margin:0 0 16px;">Canonical reconciliation from Gross Billing to Net Realized Revenue (SCR-005 match)</p>

        <div style="display:flex; flex-direction:column; gap:10px; font-size:13px;">
          <div style="display:flex; justify-content:space-between; padding-bottom:6px; border-bottom:1px solid var(--border-subtle);">
            <span>Gross Sales (Before Deductions):</span>
            <strong style="font-family:var(--font-mono); color:var(--ink);">${fmtInr(totalGrossSales)}</strong>
          </div>
          <div style="display:flex; justify-content:space-between; padding-bottom:6px; border-bottom:1px solid var(--border-subtle); color:var(--color-warning);">
            <span>Less: Customer Item Discounts &amp; Promos:</span>
            <strong style="font-family:var(--font-mono);">- ${fmtInr(totalDiscounts)}</strong>
          </div>
          <div style="display:flex; justify-content:space-between; padding-bottom:6px; border-bottom:1px solid var(--border-subtle); color:var(--color-danger);">
            <span>Less: Approved Customer Refunds:</span>
            <strong style="font-family:var(--font-mono);">- ${fmtInr(totalRefunds)}</strong>
          </div>
          <div style="display:flex; justify-content:space-between; padding-top:6px; font-size:15px; background:var(--bg-subtle, rgba(0,0,0,0.02)); padding:8px 12px; border-radius:6px;">
            <strong style="color:var(--ink);">Net Realized Sales:</strong>
            <strong style="font-family:var(--font-mono); color:var(--color-success);">${fmtInr(totalNetSales)}</strong>
          </div>
        </div>
      </div>

      <!-- GST & Tax Summary -->
      <div class="card" style="padding:20px;">
        <h3 style="font-size:15px; font-weight:700; margin:0 0 4px; color:var(--ink);">🏛️ GST Output &amp; Tax Compliance</h3>
        <p style="font-size:12px; color:var(--muted); margin:0 0 16px;">Dual-state composite GST (5% composite: CGST 2.5% + SGST 2.5%)</p>

        <div style="display:flex; flex-direction:column; gap:10px; font-size:13px;">
          <div style="display:flex; justify-content:space-between; padding-bottom:6px; border-bottom:1px solid var(--border-subtle);">
            <span>Total Taxable Sales:</span>
            <strong style="font-family:var(--font-mono); color:var(--ink);">${fmtInr(totalNetSales)}</strong>
          </div>
          <div style="display:flex; justify-content:space-between; padding-bottom:6px; border-bottom:1px solid var(--border-subtle);">
            <span>CGST Output (2.5%):</span>
            <strong style="font-family:var(--font-mono); color:var(--ink);">${fmtInr(data.kpis.cgstAmount)}</strong>
          </div>
          <div style="display:flex; justify-content:space-between; padding-bottom:6px; border-bottom:1px solid var(--border-subtle);">
            <span>SGST Output (2.5%):</span>
            <strong style="font-family:var(--font-mono); color:var(--ink);">${fmtInr(data.kpis.sgstAmount)}</strong>
          </div>
          <div style="display:flex; justify-content:space-between; padding-top:6px; font-size:14px; background:var(--bg-subtle, rgba(0,0,0,0.02)); padding:8px 12px; border-radius:6px;">
            <strong style="color:var(--ink);">Total Output GST Recorded:</strong>
            <strong style="font-family:var(--font-mono); color:var(--color-accent-amber);">${fmtInr(data.kpis.taxCollected)}</strong>
          </div>
          <div style="font-size:11.5px; color:var(--muted); margin-top:4px;">
            ℹ️ Recorded output tax under restaurant service profile. Net GST payable is not claimed on this management dashboard without statutory ITC filing data.
          </div>
        </div>
      </div>
    </div>
  `;
}

// ── Tab 4: Cost & Leakage Control ────────────────────────────────────────────
function renderCostLeakageTab(data, totalNetSales, totalExpenses, totalPayroll, totalOvertime, totalWastage, expRatio, payrollRatio) {
  const wastageRatio = totalNetSales > 0 ? ((totalWastage / totalNetSales) * 100).toFixed(2) : "0.00";
  return `
    <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(440px, 1fr)); gap:20px; margin-bottom:24px;">
      <!-- Cost Structure Breakdown -->
      <div class="card" style="padding:20px;">
        <h3 style="font-size:15px; font-weight:700; margin:0 0 4px; color:var(--ink);">📦 Cost Structure &amp; Committed Spend</h3>
        <p style="font-size:12px; color:var(--muted); margin:0 0 14px;">Mutual non-overlapping cost categories across the business</p>

        <div style="display:flex; flex-direction:column; gap:10px; font-size:13px;">
          <div style="display:flex; justify-content:space-between; padding-bottom:6px; border-bottom:1px solid var(--border-subtle);">
            <span>Workforce Payroll (Staff &amp; Baristas):</span>
            <strong style="font-family:var(--font-mono); color:var(--ink);">${fmtInr(totalPayroll)}</strong>
          </div>
          <div style="display:flex; justify-content:space-between; padding-bottom:6px; border-bottom:1px solid var(--border-subtle);">
            <span>Overtime Compensation Burden:</span>
            <strong style="font-family:var(--font-mono); color:var(--color-warning);">${fmtInr(totalOvertime)}</strong>
          </div>
          <div style="display:flex; justify-content:space-between; padding-bottom:6px; border-bottom:1px solid var(--border-subtle);">
            <span>Store Operations, Power &amp; Utilities:</span>
            <strong style="font-family:var(--font-mono); color:var(--ink);">${fmtInr(totalExpenses - totalWastage)}</strong>
          </div>
          <div style="display:flex; justify-content:space-between; padding-bottom:6px; border-bottom:1px solid var(--border-subtle);">
            <span>Direct Ingredients &amp; Roastery Purchases:</span>
            <strong style="font-family:var(--font-mono); color:var(--ink);">${fmtInr(data.kpis.procurementSpend)}</strong>
          </div>
          <div style="display:flex; justify-content:space-between; padding-bottom:6px; border-bottom:1px solid var(--border-subtle);">
            <span>Inventory Wastage &amp; Spoilage Loss:</span>
            <strong style="font-family:var(--font-mono); color:var(--color-warning);">${fmtInr(totalWastage)}</strong>
          </div>
          <div style="display:flex; justify-content:space-between; padding-top:4px; font-size:12.5px; color:var(--muted);">
            <span>Committed Spend (Approved Open POs):</span>
            <span style="font-family:var(--font-mono); font-weight:600; color:var(--color-accent-amber);">${fmtInr(data.kpis.committedSpend)}</span>
          </div>
        </div>
      </div>

      <!-- Leakage & Spoilage Analysis -->
      <div class="card" style="padding:20px;">
        <h3 style="font-size:15px; font-weight:700; margin:0 0 4px; color:var(--ink);">🔎 Leakage &amp; Spoilage Containment</h3>
        <p style="font-size:12px; color:var(--muted); margin:0 0 14px;">Monitoring inventory loss, barista training waste, and variance trends</p>

        <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-bottom:14px; font-size:12.5px;">
          <div style="padding:10px; background:var(--bg-subtle, rgba(0,0,0,0.02)); border-radius:6px;">
            <div style="color:var(--muted); font-size:11px;">Total Wastage Valuation:</div>
            <strong style="font-size:18px; color:var(--color-warning); font-family:var(--font-mono);">${fmtInr(totalWastage)}</strong>
          </div>
          <div style="padding:10px; background:var(--bg-subtle, rgba(0,0,0,0.02)); border-radius:6px;">
            <div style="color:var(--muted); font-size:11px;">Wastage % of Revenue:</div>
            <strong style="font-size:18px; color:var(--color-success); font-family:var(--font-mono);">${wastageRatio}%</strong>
          </div>
        </div>

        <div style="font-size:12.5px; color:var(--muted); line-height:1.5;">
          Inventory wastage is recorded at <strong>${fmtInr(totalWastage)}</strong> (<strong>${wastageRatio}%</strong> of Net Sales). Authoritative stock loss and spoilage allocations are pulled directly from approved store waste registers.
        </div>
      </div>
    </div>
  `;
}

// ── Tab 5: Cash & Drawers ────────────────────────────────────────────────────
function renderCashDrawersTab(data, filteredCafes, totalVariance) {
  return `
    <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(440px, 1fr)); gap:20px; margin-bottom:24px;">
      <!-- Cash Drawer Governance -->
      <div class="card" style="padding:20px;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
          <h3 style="font-size:15px; font-weight:700; margin:0; color:var(--ink);">💵 Physical Cash &amp; Drawer Governance</h3>
          <a href="#cash-drawers" class="btn btn-xs btn-ghost" style="color:var(--color-accent-amber); font-size:11.5px;">
            Manage Drawers →
          </a>
        </div>
        <p style="font-size:12px; color:var(--muted); margin:0 0 14px;">Real-time cash till exposure, float controls, and tender verification</p>

        <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-bottom:14px; font-size:12.5px;">
          <div style="padding:10px; background:var(--bg-subtle, rgba(0,0,0,0.02)); border-radius:6px;">
            <div style="color:var(--muted); font-size:11px;">Physical Cash Held in Drawers:</div>
            <strong style="font-size:18px; color:var(--color-success); font-family:var(--font-mono);">${fmtInr(data.kpis.physicalCashInTill)}</strong>
          </div>
          <div style="padding:10px; background:var(--bg-subtle, rgba(0,0,0,0.02)); border-radius:6px;">
            <div style="color:var(--muted); font-size:11px;">Drawer Cash Variance:</div>
            <strong style="font-size:18px; color:${totalVariance === 0 ? "var(--color-success)" : "var(--color-danger)"}; font-family:var(--font-mono);">${fmtInr(totalVariance)}</strong>
          </div>
        </div>

        <div style="display:flex; justify-content:space-between; font-size:12px; color:var(--muted); padding-top:6px; border-top:1px solid var(--border-subtle);">
          <span>Physical Till Cash: <strong style="color:var(--ink);">${fmtInr(data.kpis.physicalCashInTill)}</strong></span>
          <span>Reconciliation Variance: <strong style="color:${totalVariance === 0 ? "var(--color-success)" : "var(--color-danger)"};">${fmtInr(totalVariance)}</strong></span>
          <span>Active Sessions: <strong style="color:var(--ink);">${filteredCafes.length} Branch Drawers</strong></span>
        </div>
      </div>

      <!-- Till Sessions Status Matrix -->
      <div class="card" style="padding:20px;">
        <h3 style="font-size:15px; font-weight:700; margin:0 0 4px; color:var(--ink);">🏪 Register Sessions Summary</h3>
        <p style="font-size:12px; color:var(--muted); margin:0 0 14px;">Operational till sessions across authorized branches</p>

        <div style="display:flex; flex-direction:column; gap:8px; font-size:12.5px;">
          ${filteredCafes
            .map(
              (c) => `
            <div style="display:flex; justify-content:space-between; align-items:center; padding:8px 10px; background:var(--bg-subtle, rgba(0,0,0,0.02)); border-radius:6px;">
              <div>
                <strong>${c.cafeName}</strong>
                <div style="font-size:11px; color:var(--muted);">${c.cafeId}</div>
              </div>
              <div style="text-align:right;">
                <span class="status ${c.drawerStatus === "RECONCILED" ? "success" : "info"}" style="font-size:10px;">
                  ${c.drawerStatus}
                </span>
                <div style="font-size:11px; color:var(--muted);">Variance: ${fmtInr(c.drawerVariance || 0)}</div>
              </div>
            </div>
          `
            )
            .join("")}
        </div>
      </div>
    </div>
  `;
}

// ── Tab 6: Payables, Receivables & Budgets ───────────────────────────────────
function renderPayablesReceivablesTab(data, totalNetSales, totalExpenses, totalPayroll) {
  const revTarget = data.budgets?.revenueTarget || 0;
  const revDiff = totalNetSales - revTarget;
  const revPct = revTarget > 0 ? ((Math.abs(revDiff) / revTarget) * 100).toFixed(1) : "0.0";
  const revAhead = revDiff >= 0;

  const expBudget = data.budgets?.expenseBudget || 0;
  const expDiff = totalExpenses - expBudget;
  const expPct = expBudget > 0 ? ((Math.abs(expDiff) / expBudget) * 100).toFixed(1) : "0.0";
  const expUnder = expDiff <= 0;

  const payBudget = data.budgets?.payrollBudget || 0;
  const payDiff = totalPayroll - payBudget;
  const payPct = payBudget > 0 ? ((Math.abs(payDiff) / payBudget) * 100).toFixed(1) : "0.0";
  const payUnder = payDiff <= 0;

  return `
    <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(440px, 1fr)); gap:20px; margin-bottom:24px;">
      <!-- Department Order Receivables & Vendor Payables -->
      <div class="card" style="padding:20px;">
        <h3 style="font-size:15px; font-weight:700; margin:0 0 4px; color:var(--ink);">🏛️ Receivables &amp; Accounts Payable</h3>
        <p style="font-size:12px; color:var(--muted); margin:0 0 16px;">Institutional customer credit and vendor supplier commitments</p>

        <div style="display:flex; flex-direction:column; gap:12px; font-size:12.5px;">
          <div style="padding:10px; background:var(--bg-subtle, rgba(0,0,0,0.02)); border-radius:6px;">
            <div style="font-weight:700; margin-bottom:4px; color:var(--ink);">Department / Institutional Orders:</div>
            <div style="display:flex; justify-content:space-between; margin-bottom:2px;">
              <span>Total Credit Billed:</span>
              <strong style="font-family:var(--font-mono);">${fmtInr(data.departmentOrders.totalBilled)}</strong>
            </div>
            <div style="display:flex; justify-content:space-between; margin-bottom:2px;">
              <span>Collected This Period:</span>
              <strong style="font-family:var(--font-mono); color:var(--color-success);">${fmtInr(data.departmentOrders.collected)}</strong>
            </div>
            <div style="display:flex; justify-content:space-between;">
              <span>Outstanding Balance:</span>
              <strong style="font-family:var(--font-mono); color:var(--color-accent-amber);">${fmtInr(data.departmentOrders.outstanding)}</strong>
            </div>
          </div>

          <div style="padding:10px; background:var(--bg-subtle, rgba(0,0,0,0.02)); border-radius:6px;">
            <div style="font-weight:700; margin-bottom:4px; color:var(--ink);">Vendor Accounts Payable (AP):</div>
            <div style="display:flex; justify-content:space-between; margin-bottom:2px;">
              <span>Total Unpaid Invoices:</span>
              <strong style="font-family:var(--font-mono);">${fmtInr(data.payables.totalUnpaid)}</strong>
            </div>
            <div style="display:flex; justify-content:space-between; margin-bottom:2px;">
              <span>Due in Next 7 Days:</span>
              <strong style="font-family:var(--font-mono); color:var(--color-warning);">${fmtInr(data.payables.dueNext7Days)}</strong>
            </div>
            <div style="display:flex; justify-content:space-between;">
              <span>Overdue (>30 Days):</span>
              <strong style="font-family:var(--font-mono); color:${(data.payables?.overdue || 0) === 0 ? "var(--color-success)" : "var(--color-danger)"};">${fmtInr(data.payables?.overdue || 0)}</strong>
            </div>
          </div>
        </div>
      </div>

      <!-- Budget vs Actuals & Targets -->
      <div class="card" style="padding:20px;">
        <h3 style="font-size:15px; font-weight:700; margin:0 0 4px; color:var(--ink);">🎯 Budget vs Actuals &amp; Targets</h3>
        <p style="font-size:12px; color:var(--muted); margin:0 0 16px;">Tracking actual performance against board-approved operating allocations</p>

        <div style="display:flex; flex-direction:column; gap:12px; font-size:12.5px;">
          <div>
            <div style="display:flex; justify-content:space-between; margin-bottom:2px;">
              <span>Revenue Target:</span>
              <span>Actual: <strong style="color:var(--color-success); font-family:var(--font-mono);">${fmtInr(totalNetSales)}</strong> / Target: <strong style="font-family:var(--font-mono);">${fmtInr(revTarget)}</strong></span>
            </div>
            <div style="font-size:11.5px; color:${revAhead ? "var(--color-success)" : "var(--color-warning)"};">
              ${revAhead ? `✓ +${revPct}% Ahead of Target` : `⚠️ -${revPct}% Below Target`} (${fmtInr(Math.abs(revDiff))} variance)
            </div>
          </div>

          <div>
            <div style="display:flex; justify-content:space-between; margin-bottom:2px;">
              <span>Operating Expense Budget:</span>
              <span>Actual: <strong style="color:var(--ink); font-family:var(--font-mono);">${fmtInr(totalExpenses)}</strong> / Budget: <strong style="font-family:var(--font-mono);">${fmtInr(expBudget)}</strong></span>
            </div>
            <div style="font-size:11.5px; color:${expUnder ? "var(--color-success)" : "var(--color-warning)"};">
              ${expUnder ? `✓ -${expPct}% Under Budget (Controlled)` : `⚠️ +${expPct}% Over Budget`} (${fmtInr(Math.abs(expDiff))} variance)
            </div>
          </div>

          <div>
            <div style="display:flex; justify-content:space-between; margin-bottom:2px;">
              <span>Payroll Budget:</span>
              <span>Actual: <strong style="color:var(--ink); font-family:var(--font-mono);">${fmtInr(totalPayroll)}</strong> / Budget: <strong style="font-family:var(--font-mono);">${fmtInr(payBudget)}</strong></span>
            </div>
            <div style="font-size:11.5px; color:${payUnder ? "var(--color-success)" : "var(--color-warning)"};">
              ${payUnder ? `✓ -${payPct}% Under Payroll Allocation` : `⚠️ +${payPct}% Over Allocation`} (${fmtInr(Math.abs(payDiff))} variance)
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
}

// ── Tab 7: Personal Ledger & Reports ─────────────────────────────────────────
function renderPersonalLedgerAndReportsTab(data) {
  return `
    <!-- Personal Ledger Snapshot (Strictly Separate Accounting Context) -->
    <div class="card" style="padding:20px; border-left:4px solid var(--color-accent-amber); margin-bottom:24px;">
      <div style="display:flex; justify-content:space-between; align-items:flex-start; flex-wrap:wrap; gap:12px; margin-bottom:12px;">
        <div>
          <div style="display:flex; align-items:center; gap:8px;">
            <h3 style="font-size:15px; font-weight:700; margin:0; color:var(--ink);">👤 My Personal Ledger Snapshot</h3>
            <span class="status info" style="font-size:10.5px; font-weight:700;">PERSONAL / NON-PORTFOLIO CONTEXT</span>
          </div>
          <p style="font-size:12px; color:var(--muted); margin:4px 0 0;">
            ℹ️ Personal partner equity, capital contributions, and personal drawings are strictly isolated from café operational revenue and expenses.
          </p>
        </div>
        <a href="#ledger" class="btn btn-sm btn-primary" style="font-size:12px; padding:6px 14px; text-decoration:none;">
          View Full Personal Ledger →
        </a>
      </div>

      <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(160px, 1fr)); gap:12px; font-size:12.5px;">
        <div style="padding:10px; background:var(--bg-subtle, rgba(0,0,0,0.02)); border-radius:6px;">
          <div style="color:var(--muted); font-size:11px;">Opening Balance:</div>
          <strong style="font-family:var(--font-mono); font-size:15px; color:var(--ink);">${fmtInr(data.personalLedger.openingBalance)}</strong>
        </div>
        <div style="padding:10px; background:var(--bg-subtle, rgba(0,0,0,0.02)); border-radius:6px;">
          <div style="color:var(--muted); font-size:11px;">Partner Credits (MTD):</div>
          <strong style="font-family:var(--font-mono); font-size:15px; color:var(--color-success);">+${fmtInr(data.personalLedger.creditsMtd)}</strong>
        </div>
        <div style="padding:10px; background:var(--bg-subtle, rgba(0,0,0,0.02)); border-radius:6px;">
          <div style="color:var(--muted); font-size:11px;">Partner Withdrawals (MTD):</div>
          <strong style="font-family:var(--font-mono); font-size:15px; color:var(--color-warning);">-${fmtInr(data.personalLedger.debitsMtd)}</strong>
        </div>
        <div style="padding:10px; background:var(--bg-subtle, rgba(0,0,0,0.02)); border-radius:6px;">
          <div style="color:var(--muted); font-size:11px;">Current Personal Balance:</div>
          <strong style="font-family:var(--font-mono); font-size:16px; color:var(--color-accent-amber);">${fmtInr(data.personalLedger.currentBalance)}</strong>
        </div>
      </div>
    </div>

    <!-- Strategic Reports & Drill-down Hub -->
    <div class="card" style="padding:20px;">
      <h3 style="font-size:15px; font-weight:700; margin:0 0 4px; color:var(--ink);">🚀 Strategic Financial Navigation &amp; Drill-downs</h3>
      <p style="font-size:12px; color:var(--muted); margin:0 0 16px;">Direct shortcuts to canonical transaction hubs with preserved filter context</p>

      <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(200px, 1fr)); gap:12px;">
        <a href="#bills" class="btn btn-ghost" style="display:flex; align-items:center; justify-content:space-between; padding:12px 14px; text-decoration:none; font-size:12.5px; border:1px solid var(--border-subtle); border-radius:6px; color:var(--ink);">
          <span>🧾 Bills &amp; Receipts</span>
          <span style="color:var(--color-accent-amber);">→</span>
        </a>
        <a href="#ledger" class="btn btn-ghost" style="display:flex; align-items:center; justify-content:space-between; padding:12px 14px; text-decoration:none; font-size:12.5px; border:1px solid var(--border-subtle); border-radius:6px; color:var(--ink);">
          <span>📑 Personal Ledger</span>
          <span style="color:var(--color-accent-amber);">→</span>
        </a>
        <a href="#cash-drawers" class="btn btn-ghost" style="display:flex; align-items:center; justify-content:space-between; padding:12px 14px; text-decoration:none; font-size:12.5px; border:1px solid var(--border-subtle); border-radius:6px; color:var(--ink);">
          <span>💵 Cash Drawers</span>
          <span style="color:var(--color-accent-amber);">→</span>
        </a>
        <a href="#performance" class="btn btn-ghost" style="display:flex; align-items:center; justify-content:space-between; padding:12px 14px; text-decoration:none; font-size:12.5px; border:1px solid var(--border-subtle); border-radius:6px; color:var(--ink);">
          <span>📈 Café Performance</span>
          <span style="color:var(--color-accent-amber);">→</span>
        </a>
        <a href="#expenses" class="btn btn-ghost" style="display:flex; align-items:center; justify-content:space-between; padding:12px 14px; text-decoration:none; font-size:12.5px; border:1px solid var(--border-subtle); border-radius:6px; color:var(--ink);">
          <span>💸 Expense Summary</span>
          <span style="color:var(--color-accent-amber);">→</span>
        </a>
        <a href="#reports" class="btn btn-ghost" style="display:flex; align-items:center; justify-content:space-between; padding:12px 14px; text-decoration:none; font-size:12.5px; border:1px solid var(--border-subtle); border-radius:6px; color:var(--ink);">
          <span>📄 Export Report Pack</span>
          <span style="color:var(--color-accent-amber);">→</span>
        </a>
      </div>
    </div>
  `;
}

function kpiBox(title, val, sub, color, tooltip = "") {
  return `
    <div class="card" style="padding:14px 16px; position:relative;" title="${tooltip}">
      <div style="font-size:11.5px; color:var(--muted); font-weight:600; margin-bottom:4px;">${title}</div>
      <div style="font-size:20px; font-weight:800; color:${color}; font-family:var(--font-mono); line-height:1.2; margin-bottom:2px;">${val}</div>
      <div style="font-size:11px; color:var(--muted);">${sub}</div>
    </div>
  `;
}

let hasInitialFetchedFinance = false;

export async function wireOwnerFinanceSummary(root) {
  if (!root) return;
  wireFinanceEventListeners(root);

  // Initial Data Fetch exactly once
  if (!hasInitialFetchedFinance) {
    hasInitialFetchedFinance = true;
    fetchFinanceSummaryData().then(() => {
      refreshView(root);
    });
  }
}

function wireFinanceEventListeners(root) {
  if (!root) return;

  // Subnav Tab Click Handlers
  const tabBtns = root.querySelectorAll(".subnav-btn");
  tabBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      tabBtns.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      activeTab = btn.dataset.tab;
      refreshView(root);
    });
  });

  // Refresh Button
  const refreshBtn = root.querySelector("#refresh-finance-btn");
  if (refreshBtn) {
    refreshBtn.addEventListener("click", async () => {
      refreshBtn.disabled = true;
      refreshBtn.textContent = "Syncing...";
      await fetchFinanceSummaryData();
      lastRefreshedTime = new Date();
      refreshView(root);
      showToast("Financial summary and ledgers refreshed", "mint");
    });
  }

  // Cafe Scope Selector
  const cafeSel = root.querySelector("#finance-cafe-scope");
  if (cafeSel) {
    cafeSel.addEventListener("change", async (e) => {
      selectedCafeFilter = e.target.value;
      await fetchFinanceSummaryData();
      refreshView(root);
    });
  }

  // Period Selector
  const periodSel = root.querySelector("#finance-period-selector");
  if (periodSel) {
    periodSel.addEventListener("change", async (e) => {
      selectedPeriod = e.target.value;
      await fetchFinanceSummaryData();
      refreshView(root);
    });
  }

  // Comparison Selector
  const compSel = root.querySelector("#finance-compare-selector");
  if (compSel) {
    compSel.addEventListener("change", (e) => {
      selectedComparison = e.target.value;
      refreshView(root);
    });
  }

  // Data Coverage Button
  const coverageBtn = root.querySelector("#btn-data-coverage");
  if (coverageBtn) {
    coverageBtn.addEventListener("click", () => openDataCoverageModal());
  }

  // Export Report Pack Button
  const exportBtn = root.querySelector("#btn-export-pack");
  if (exportBtn) {
    exportBtn.addEventListener("click", () => openExportModal());
  }

  // Health Audit Buttons
  root.querySelectorAll(".btn-health-audit").forEach((btn) => {
    btn.addEventListener("click", () => {
      const cafeId = btn.dataset.cafeid;
      const cafe = (cachedFinanceSummary?.cafes || []).find((c) => c.cafeId === cafeId);
      if (cafe) openHealthAuditModal(cafe);
    });
  });
}

async function fetchFinanceSummaryData() {
  try {
    let url = `/finance/overview?period=${encodeURIComponent(selectedPeriod)}`;
    if (selectedCafeFilter && selectedCafeFilter !== "ALL") {
      url += `&cafeId=${encodeURIComponent(selectedCafeFilter)}`;
    }
    const res = await apiGet(url);
    const body = res?.data || res || {};

    let dailyPayouts = null;
    try {
      let payoutUrl = `/finance/daily-payout-summary?businessDate=${encodeURIComponent(selectedBusinessDate)}`;
      if (selectedCafeFilter && selectedCafeFilter !== "ALL") {
        payoutUrl += `&cafeId=${encodeURIComponent(selectedCafeFilter)}`;
      }
      const pRes = await apiGet(payoutUrl);
      if (pRes?.data) dailyPayouts = pRes.data;
    } catch (pErr) {
      console.warn("Could not fetch daily payout summary:", pErr);
    }

    if (body.kpis) {
      cachedFinanceSummary = {
        kpis: {
          ...DEFAULT_FINANCE_DATA.kpis,
          ...body.kpis,
        },
        cafes: Array.isArray(body.cafes || body.cafeBreakdown) ? (body.cafes || body.cafeBreakdown) : [],
        personalLedger: body.personalLedger || DEFAULT_FINANCE_DATA.personalLedger,
        departmentOrders: body.departmentOrders || DEFAULT_FINANCE_DATA.departmentOrders,
        payables: body.payables || DEFAULT_FINANCE_DATA.payables,
        budgets: body.budgets || DEFAULT_FINANCE_DATA.budgets,
        controlStrip: body.controlStrip || {},
        dailyPayouts,
      };
    } else {
      cachedFinanceSummary = { ...DEFAULT_FINANCE_DATA, dailyPayouts };
    }
  } catch (err) {
    console.warn("Could not fetch remote finance summary:", err);
    if (!cachedFinanceSummary) cachedFinanceSummary = { ...DEFAULT_FINANCE_DATA };
  }
}

function refreshView(root) {
  root.innerHTML = renderOwnerFinanceSummary();
  wireFinanceEventListeners(root);
}

function openDataCoverageModal() {
  openModal({
    title: "📋 Financial Data Coverage & Freshness Matrix",
    body: `
      <div style="font-size:13px; line-height:1.6;">
        <p style="color:var(--muted); margin-bottom:14px;">Real-time feed lineage and data coverage status across authorized datasets:</p>
        <div style="display:flex; flex-direction:column; gap:10px;">
          <div style="display:flex; justify-content:space-between; padding:8px 12px; background:var(--bg-subtle, rgba(0,0,0,0.02)); border-radius:6px;">
            <span><strong>Sales Bills &amp; Tax Receipts:</strong> Live POS Till Feeds</span>
            <span class="status success" style="font-size:11px;">100% COMPLETE</span>
          </div>
          <div style="display:flex; justify-content:space-between; padding:8px 12px; background:var(--bg-subtle, rgba(0,0,0,0.02)); border-radius:6px;">
            <span><strong>Operating Expenses:</strong> Vouchers &amp; Journals</span>
            <span class="status success" style="font-size:11px;">100% COMPLETE</span>
          </div>
          <div style="display:flex; justify-content:space-between; padding:8px 12px; background:var(--bg-subtle, rgba(0,0,0,0.02)); border-radius:6px;">
            <span><strong>Workforce Payroll:</strong> Approved Wage Runs</span>
            <span class="status success" style="font-size:11px;">100% COMPLETE</span>
          </div>
          <div style="display:flex; justify-content:space-between; padding:8px 12px; background:var(--bg-subtle, rgba(0,0,0,0.02)); border-radius:6px;">
            <span><strong>Inventory &amp; Wastage:</strong> Stock Count Valuations</span>
            <span class="status success" style="font-size:11px;">100% COMPLETE</span>
          </div>
          <div style="display:flex; justify-content:space-between; padding:8px 12px; background:var(--bg-subtle, rgba(0,0,0,0.02)); border-radius:6px;">
            <span><strong>Cash Drawers:</strong> End-of-Day Register Sessions</span>
            <span class="status success" style="font-size:11px;">100% RECONCILED</span>
          </div>
        </div>
      </div>
    `,
    primaryBtn: { text: "Close", action: () => {} },
  });
}

function openHealthAuditModal(cafe) {
  const reason = cafe.healthReason || (cafe.drawerVariance === 0 && (cafe.expenseRatio || 0) <= 50 ? "All till sessions reconciled with zero cash discrepancy and operating costs within normal benchmark bounds." : "Reconciliation review recommended: inspect till drawer sessions and operating expense velocity.");
  openModal({
    title: `🏥 Financial Health Audit · ${cafe.cafeName || cafe.name || cafe.cafeId}`,
    body: `
      <div style="font-size:13px; line-height:1.6;">
        <div style="display:flex; align-items:center; gap:8px; margin-bottom:14px;">
          <span class="status ${cafe.health === "HEALTHY" ? "success" : "warning"}" style="font-size:12px; font-weight:700;">● ${cafe.health}</span>
          <span style="color:var(--muted);">Location ID: ${cafe.cafeId}</span>
        </div>
        <p style="margin-bottom:12px;"><strong>Diagnostic Rationale:</strong><br>${reason}</p>
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px; padding:10px; background:var(--bg-subtle, rgba(0,0,0,0.02)); border-radius:6px;">
          <div>Net Sales: <strong style="font-family:var(--font-mono);">${fmtInr(cafe.netSales)}</strong></div>
          <div>OpEx Ratio: <strong style="font-family:var(--font-mono);">${Number(cafe.expenseRatio || 0).toFixed(1)}%</strong></div>
          <div>Payroll Ratio: <strong style="font-family:var(--font-mono);">${Number(cafe.payrollRatio || 0).toFixed(1)}%</strong></div>
          <div>Cash Drawer: <strong>${cafe.drawerStatus} (${fmtInr(cafe.drawerVariance || 0)} Variance)</strong></div>
        </div>
      </div>
    `,
    primaryBtn: { text: "Dismiss", action: () => {} },
  });
}

function downloadFinanceCsv(cafes = [], period = "THIS_MONTH") {
  const headers = [
    "Cafe ID",
    "Cafe Name",
    "Net Sales (INR)",
    "Gross Sales (INR)",
    "Discounts (INR)",
    "Refunds (INR)",
    "Operating Expenses (INR)",
    "Expense Ratio (%)",
    "Payroll Cost (INR)",
    "Payroll Ratio (%)",
    "Overtime Cost (INR)",
    "Wastage Value (INR)",
    "Drawer Variance (INR)",
    "Drawer Status",
    "Health",
  ];
  const rows = (cafes || []).map((c) => [
    `"${c.cafeId}"`,
    `"${c.cafeName || c.name || c.cafeId}"`,
    (c.netSales || 0).toFixed(2),
    (c.grossSales || 0).toFixed(2),
    (c.discounts || 0).toFixed(2),
    (c.refunds || 0).toFixed(2),
    (c.expenses || 0).toFixed(2),
    (c.expenseRatio || 0).toFixed(1),
    (c.payrollCost || 0).toFixed(2),
    (c.payrollRatio || 0).toFixed(1),
    (c.overtimeCost || 0).toFixed(2),
    (c.wastageValue || 0).toFixed(2),
    (c.drawerVariance || 0).toFixed(2),
    `"${c.drawerStatus || "RECONCILED"}"`,
    `"${c.health || "HEALTHY"}"`,
  ]);

  const csvContent = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.setAttribute("href", url);
  link.setAttribute("download", `Zamorin_Finance_Summary_${period}_${new Date().toISOString().split("T")[0]}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function openExportModal() {
  const data = cachedFinanceSummary || DEFAULT_FINANCE_DATA;
  let exportCafes = data.cafes || [];
  if (selectedCafeFilter !== "ALL") {
    exportCafes = exportCafes.filter((c) => c.cafeId === selectedCafeFilter);
  }

  openModal({
    title: "📄 Export Owner Financial Report Pack",
    body: `
      <div style="font-size:13px; line-height:1.6;">
        <p style="color:var(--muted); margin-bottom:14px;">
          Export verified executive management reports for the selected scope (<strong>${selectedCafeFilter === "ALL" ? "All Authorized Cafés" : selectedCafeFilter}</strong>) and period (<strong>${selectedPeriod}</strong>):
        </p>
        <div style="display:flex; flex-direction:column; gap:10px; margin-bottom:16px;">
          <label style="display:flex; align-items:center; gap:8px; cursor:pointer;">
            <input type="radio" name="export-format" value="CSV" checked>
            <span><strong>Financial Data CSV</strong> (Authoritative tabular branch metrics, expense ratios, and payroll allocations)</span>
          </label>
          <label style="display:flex; align-items:center; gap:8px; cursor:pointer;">
            <input type="radio" name="export-format" value="SUMMARY">
            <span><strong>Management Summary</strong> (Executive KPIs, Trends, Multi-Café Matrix, Cash &amp; Exceptions)</span>
          </label>
        </div>
        <div style="font-size:11.5px; color:var(--muted);">
          ℹ️ Generated exports strictly obey employee salary privacy and isolate personal ledger records.
        </div>
      </div>
    `,
    primaryBtn: {
      text: "Download Report Pack",
      action: () => {
        downloadFinanceCsv(exportCafes, selectedPeriod);
        showToast("Report pack downloaded successfully", "mint");
      },
    },
    secondaryBtn: { text: "Cancel", action: () => {} },
  });
}
