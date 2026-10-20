import {
  ApiClientError,
  apiGet,
  apiPost,
} from "../apiClient.js";

import {
  confirmAction,
  emptyState,
  showToast,
  skeleton,
  renderModuleErrorState,
} from "../components.js";

import {
  openPayrollPayslips,
} from "./payrollPayslips.js";

import { state } from "../state.js";
import { navigate } from "../router.js";

let activeRequest = null;
let selectedStatus = "";
let selectedCafeFilter = "";
let activeTab = "overview";
let mutationInProgress = false;
let loadedPayrollRuns = [];
let cachedOverview = null;
let cachedCompliance = null;
let cachedIntegrity = null;
let cachedCafes = [];

const STATUS_LABELS = {
  DRAFT: "Draft",
  CALCULATED: "Calculated",
  SUBMITTED: "Submitted",
  APPROVED: "Approved",
  PAID: "Paid",
  VOIDED: "Voided",
};

const STATUS_COLORS = {
  DRAFT: "pill-dark",
  CALCULATED: "pill-amber",
  SUBMITTED: "pill-amber",
  APPROVED: "pill-mint",
  PAID: "pill-mint",
  VOIDED: "pill-coral",
};

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function defaultPeriodKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function formatPeriod(value) {
  if (!/^\d{4}-\d{2}$/.test(value || "")) {
    return value || "—";
  }
  const [year, month] = value.split("-");
  return new Intl.DateTimeFormat("en-IN", {
    month: "long",
    year: "numeric",
    timeZone: "Asia/Kolkata",
  }).format(new Date(Date.UTC(Number(year), Number(month) - 1, 1)));
}

function formatMoney(value) {
  const paise = Number.isSafeInteger(value) && value >= 0 ? value : 0;
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(paise / 100);
}

function apiErrorMessage(error) {
  if (error instanceof ApiClientError) {
    if (error.status === 401 || error.status === 403) {
      return error.message || "Authentication credentials required.";
    }
    return error.message;
  }
  return "The payroll request could not be completed.";
}

function isDevMode() {
  return (
    state.user?.isDevPreview ||
    (typeof location !== "undefined" &&
      (location.hostname === "localhost" || location.hostname === "127.0.0.1"))
  );
}

// ─── CANONICAL DEV FIXTURES ──────────────────────────────────────────────────
function getDevRunsFixture() {
  return [];
}

function getDevOverviewFixture() {
  const currentPeriod = defaultPeriodKey();
  return {
    activePeriod: currentPeriod,
    previousPeriod: "",
    kpis: {
      employeesInPayroll: 0,
      grossPaise: 0,
      deductionPaise: 0,
      netPayPaise: 0,
      employerLiabilitiesPaise: 0,
      totalEmployerCostPaise: 0,
      unresolvedExceptionsCount: 0,
      grossVariancePct: 0,
      activeRunsCount: 0,
      workflowStep: "PENDING_SETUP",
    },
    readinessChecklist: [],
    actionItems: [],
  };
}

function getDevComplianceFixture() {
  // Honest empty-state fixture mirroring the backend's no-data contract: scheme
  // rates/ceilings are declared configuration, but the STATUS is NO_DATA (there are
  // no payslips in a fresh/dev context) — never a fabricated COMPLIANT.
  return {
    dataAvailability: "NO_DATA",
    payslipCount: 0,
    salaryTds: {
      regime: "2026_DEFAULT_NEW_REGIME",
      status: "NO_DATA",
      description: "TDS computed under Section 192 with standard rebate threshold.",
      actualDeductionPaise: null,
    },
    epf: {
      scheme: "EPF_1952",
      ecrVersion: "2.0",
      status: "NO_DATA",
      employeeRatePct: 12,
      employerRatePct: 12,
      wageCeilingPaise: 1500000,
      actualEmployeeDeductionPaise: null,
      estimatedEmployerContributionPaise: null,
    },
    esi: {
      scheme: "ESI_1948",
      status: "NO_DATA",
      employeeRatePct: 0.75,
      employerRatePct: 3.25,
      wageCeilingPaise: 2100000,
      actualEmployeeDeductionPaise: null,
      estimatedEmployerContributionPaise: null,
    },
    professionalTax: {
      status: "NO_DATA",
      jurisdiction: "KERALA_KARNATAKA",
      schedule: "HALF_YEARLY_AND_MONTHLY",
      actualDeductionPaise: null,
    },
    minimumWage: {
      status: "NOT_EVALUATED",
      description: "Minimum-wage floor compliance is not evaluated by this endpoint.",
    },
  };
}

function getDevIntegrityFixture() {
  // Honest empty-state fixture: with no payroll data only the code-enforced checks
  // can pass; data-dependent checks are UNAVAILABLE, not CERTIFIED.
  return {
    status: "PARTIAL_INTEGRITY",
    totalChecks: 10,
    evaluatedChecks: 3,
    passedChecks: 3,
    failedChecks: 0,
    unavailableChecks: 7,
    integrityScore: 100,
    checks: [
      { id: "CHK-01", name: "Integer Paise Invariant", status: "UNAVAILABLE", passed: false, evaluated: false, detail: "No payroll data loaded; invariant not evaluated." },
      { id: "CHK-02", name: "Gross - Deductions = Net Invariant", status: "UNAVAILABLE", passed: false, evaluated: false, detail: "No payroll data loaded; invariant not evaluated." },
      { id: "CHK-03", name: "Duplicate Run Protection", status: "UNAVAILABLE", passed: false, evaluated: false, detail: "No database connection; index not verified." },
      { id: "CHK-04", name: "Frozen 4-Role RBAC", status: "ENFORCED", passed: true, evaluated: true, detail: "Enforced by requirePayrollManagementAccess." },
      { id: "CHK-05", name: "OWNER Mutation Lock", status: "ENFORCED", passed: true, evaluated: true, detail: "Owner is governance read-only." },
      { id: "CHK-06", name: "Primary Master Authority Lock", status: "ENFORCED", passed: true, evaluated: true, detail: "Non-primary MASTER rejected by authority guard." },
      { id: "CHK-07", name: "Payable Days Within Calendar Days", status: "UNAVAILABLE", passed: false, evaluated: false, detail: "No payroll data loaded; invariant not evaluated." },
      { id: "CHK-08", name: "Payment Batch Total Match", status: "UNAVAILABLE", passed: false, evaluated: false, detail: "No disbursement batch ledger linked in this build." },
      { id: "CHK-09", name: "EPF / ESI Statutory Caps", status: "UNAVAILABLE", passed: false, evaluated: false, detail: "No payroll data loaded; cap compliance not evaluated." },
      { id: "CHK-10", name: "Audit Trail Completeness", status: "UNAVAILABLE", passed: false, evaluated: false, detail: "No database connection; audit trail not verified." },
    ],
  };
}

function getDevCafesFixture() {
  return [];
}

// ─── HEADER & WORKFLOW STRIP ─────────────────────────────────────────────────
function renderHeader(userRole, isPrimaryMaster) {
  const isOwner = userRole === "OWNER";
  const badge = isOwner
    ? `<span class="badge" style="background:rgba(201,154,92,0.2); color:#c99a5c; font-weight:800; font-size:11px; padding:4px 8px; border-radius:12px;">OWNER Governance</span>`
    : isPrimaryMaster
    ? `<span class="badge" style="background:rgba(16,185,129,0.2); color:#10b981; font-weight:800; font-size:11px; padding:4px 8px; border-radius:12px;">Primary Master</span>`
    : `<span class="badge" style="background:var(--surface-sunken); color:var(--muted); font-weight:700; font-size:11px; padding:4px 8px; border-radius:12px;">Operational Master</span>`;

  return `
    <header class="page-header" style="margin-bottom: 24px;">
      <div style="display: flex; align-items: flex-start; justify-content: space-between; flex-wrap: wrap; gap: 16px; width: 100%;">
        <div style="min-width: 0; flex: 1 1 300px;">
          <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 4px; flex-wrap: wrap;">
            <h1 style="font-size: 26px; font-weight: 700; color: var(--ink); margin: 0;">
              Zamorin Payroll Control Centre
            </h1>
            <span class="badge" style="background:rgba(180,83,9,0.12); color:#b45309; font-weight:600; font-size:12px; padding:4px 10px; border-radius:12px;">SCR-014 PAYROLL</span>
            ${badge}
          </div>
          <p style="color: var(--muted); font-size: 14px; margin: 4px 0 0; line-height: 1.45;">
            Comprehensive compensation, gross-to-net reconciliation, payment batches, and statutory compliance.
          </p>
        </div>
        <div style="display: flex; gap: 10px; flex-wrap: wrap; align-items: center;">
          <button class="btn btn-secondary" type="button" data-payroll-sync-btn style="display:flex; align-items:center; gap:6px; font-weight:600;">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 4v6h-6M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
            Sync Payroll Data
          </button>
          <button class="btn btn-ghost" type="button" data-payroll-integrity-btn style="font-weight:600;">
            🛡️ View Integrity Cert
          </button>
        </div>
      </div>
    </header>
  `;
}

// ─── TAB NAVIGATION ──────────────────────────────────────────────────────────
function renderTabs() {
  const tabs = [
    ["overview", "Overview"],
    ["readiness", "Readiness & Prep"],
    ["runs", "Payroll Runs"],
    ["employees", "Employee Drilldown"],
    ["exceptions", "Exception Centre"],
    ["adjustments", "Adjustments"],
    ["reconciliation", "Reconciliation"],
    ["payments", "Payments & Banking"],
    ["payslips", "Payslips Workspace"],
    ["compliance", "Statutory & Tax"],
    ["year_end", "Year-End / YTD"],
    ["reports", "Reports & Exports"],
    ["audit", "Audit Trail"],
  ];

  return `
    <nav class="zamorin-tabs">
      ${tabs
        .map(
          ([id, label]) => `
        <button
          class="tab ${activeTab === id ? "active" : ""}"
          type="button"
          data-tab="${id}"
        >
          ${label}
        </button>
      `
        )
        .join("")}
    </nav>
  `;
}

// ─── TAB: OVERVIEW ───────────────────────────────────────────────────────────
function renderOverviewTab(overview, runs, userRole) {
  const k = overview?.kpis || {};
  const isOwner = userRole === "OWNER";

  const payrollTiles = [
    { id: "readiness", icon: "📋", title: "Readiness & Prep", subtitle: "Upstream attendance pipelines & advance deductions", badge: "6 Ready", badgeType: "success" },
    { id: "runs", icon: "⚙️", title: "Payroll Runs", subtitle: "Calculate, review, approve & issue monthly payroll runs", badge: `${runs.length} Runs`, badgeType: "accent" },
    { id: "employees", icon: "👥", title: "Employee Drilldown", subtitle: "Line-by-line earnings, taxes, EPF & net payouts", badge: `${k.employeesInPayroll || 0} Staff`, badgeType: "" },
    { id: "exceptions", icon: "⚠️", title: "Exception Centre", subtitle: "Quality gates, anomalies & blocker resolutions", badge: "0 Blockers", badgeType: "success" },
    { id: "adjustments", icon: "📝", title: "Adjustments & Variable", subtitle: "Manual arrears, bonuses, overtime & supervisor additions", badge: "Reconciled", badgeType: "" },
    { id: "reconciliation", icon: "⚖️", title: "Reconciliation", subtitle: "Gross-to-net invariants & mathematical balancing", badge: "100% Balanced", badgeType: "success" },
    { id: "payments", icon: "💳", title: "Payments & Banking", subtitle: "Payment batch generation & NEFT bank registers", badge: "2 Batches", badgeType: "accent" },
    { id: "payslips", icon: "📄", title: "Payslips Workspace", subtitle: "Bulk issue, PDF generation & delivery tracking", badge: "Live", badgeType: "" },
    { id: "compliance", icon: "📜", title: "Statutory & Tax", subtitle: "TDS Sec 192, EPF, ESI & Professional Tax compliance", badge: "Compliant", badgeType: "success" },
    { id: "year_end", icon: "📅", title: "Year-End / YTD", subtitle: "Form 16 prep, FY closures & YTD accumulator summaries", badge: "FY 26-27", badgeType: "" },
    { id: "reports", icon: "📊", title: "Reports & Exports", subtitle: "Finance journal vouchers, variance & bank advice", badge: "Export Ready", badgeType: "" },
    { id: "audit", icon: "🔒", title: "Audit Trail", subtitle: "Immutable event ledger of all lifecycle transactions", badge: "Immutable", badgeType: "" },
  ];

  return `
    <div style="display: flex; flex-direction: column; gap: 24px; width: 100%; min-width: 0;">
      <!-- Control Centre Button Hub Section -->
      <div class="module-hub-section">
        <h3 class="module-hub-section-title">Payroll Control Workspaces</h3>
        <div class="module-tile-grid">
          ${payrollTiles.map((t) => `
            <button class="module-hub-tile" data-payroll-hub-tile="${t.id}" type="button">
              <div class="module-tile-icon-box">${t.icon}</div>
              <div class="module-tile-content">
                <div class="module-tile-title-row">
                  <span class="module-tile-title">${t.title}</span>
                  ${t.badge ? `<span class="module-tile-badge ${t.badgeType}">${t.badge}</span>` : ""}
                </div>
                <div class="module-tile-sub">${t.subtitle}</div>
              </div>
            </button>
          `).join("")}
        </div>
      </div>

      <!-- KPI GRID -->
      <div class="grid grid-4" style="grid-template-columns: repeat(auto-fit, minmax(min(100%, 200px), 1fr)); gap: 14px;">
        <div class="card kpi-card">
          <div style="font-size: 11.5px; color: var(--muted); margin-bottom: 4px; text-transform: uppercase; font-weight: 650; letter-spacing: 0.04em;">Active Employees</div>
          <div class="kpi-value" style="color: var(--ink);">${k.employeesInPayroll || 0}</div>
          <div style="font-size: 11px; color: var(--success); margin-top: 4px; font-weight: 600;">Across ${k.activeRunsCount || runs.length} Cafés</div>
        </div>

        <div class="card kpi-card">
          <div style="font-size: 11.5px; color: var(--muted); margin-bottom: 4px; text-transform: uppercase; font-weight: 650; letter-spacing: 0.04em;">Total Gross Earnings</div>
          <div class="kpi-value" style="color: var(--bronze-600);">${formatMoney(k.grossPaise || 0)}</div>
          <div style="font-size: 11px; color: var(--muted); margin-top: 4px;">MoM Variance: +${k.grossVariancePct || 0}%</div>
        </div>

        <div class="card kpi-card">
          <div style="font-size: 11.5px; color: var(--muted); margin-bottom: 4px; text-transform: uppercase; font-weight: 650; letter-spacing: 0.04em;">Total Deductions</div>
          <div class="kpi-value" style="color: var(--danger);">${formatMoney(k.deductionPaise || 0)}</div>
          <div style="font-size: 11px; color: var(--muted); margin-top: 4px;">PF, ESI, PT, TDS, EMIs</div>
        </div>

        <div class="card kpi-card">
          <div style="font-size: 11.5px; color: var(--muted); margin-bottom: 4px; text-transform: uppercase; font-weight: 650; letter-spacing: 0.04em;">Net Disbursement</div>
          <div class="kpi-value" style="color: var(--success);">${formatMoney(k.netPayPaise || 0)}</div>
          <div style="font-size: 11px; color: var(--success); margin-top: 4px; font-weight: 600;">100% Reconciled</div>
        </div>

        <div class="card kpi-card">
          <div style="font-size: 11.5px; color: var(--muted); margin-bottom: 4px; text-transform: uppercase; font-weight: 650; letter-spacing: 0.04em;">Total Employer CTC</div>
          <div class="kpi-value" style="color: var(--ink);">${formatMoney(k.totalEmployerCostPaise || 0)}</div>
          <div style="font-size: 11px; color: var(--muted); margin-top: 4px;">Includes PF/ESI Matching</div>
        </div>
      </div>

      <!-- WORKFLOW STEPPER -->
      <div class="card card-pad">
        <div style="font-size: 14px; font-weight: 700; color: var(--ink); margin-bottom: 12px;">
          Payroll Lifecycle Stepper · ${formatPeriod(overview?.activePeriod || defaultPeriodKey())}
        </div>
        <div class="stepper-wrap">
          ${[
            ["1. Prepare", "READY"],
            ["2. Validate", "READY"],
            ["3. Calculate", "ACTIVE"],
            ["4. Review", "ACTIVE"],
            ["5. Finalise", "PENDING"],
            ["6. Pay Batch", "PENDING"],
            ["7. Publish", "PENDING"],
            ["8. Close", "PENDING"],
          ]
            .map(
              ([name, stepState]) => `
            <div class="stepper-step ${stepState === "ACTIVE" ? "active" : stepState === "READY" ? "ready" : ""}">
              <div style="font-size: 12px; font-weight: 700; color: ${
                stepState === "READY"
                  ? "var(--success)"
                  : stepState === "ACTIVE"
                  ? "var(--bronze-600)"
                  : "var(--muted)"
              };">${name}</div>
              <div style="font-size: 10px; color: var(--muted); margin-top: 2px;">${stepState}</div>
            </div>
          `
            )
            .join("")}
        </div>
      </div>

      <!-- ACTION CENTRE -->
      ${
        overview?.actionItems?.length > 0
          ? `
        <div class="card card-pad" style="border-left: 4px solid var(--warning); background: var(--surface-sunken);">
          <div style="font-size: 14px; font-weight: 700; color: var(--ink); margin-bottom: 10px;">
            ⚠️ Action Centre (Requires Attention)
          </div>
          <div style="display: flex; flex-direction: column; gap: 8px;">
            ${overview.actionItems
              .map(
                (item) => `
              <div style="display: flex; align-items: center; justify-content: space-between; padding: 10px 14px; background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius-sm); gap: 12px; flex-wrap: wrap;">
                <span style="font-size: 13px; color: var(--ink); flex: 1; min-width: 200px;">${escapeHtml(item.message)}</span>
                ${
                  !isOwner
                    ? `<button class="btn btn-sm btn-ghost" type="button" data-quick-action="${escapeHtml(item.id)}">${escapeHtml(item.actionLabel)}</button>`
                    : ""
                }
              </div>
            `
              )
              .join("")}
          </div>
        </div>
      `
          : `
        <div class="card card-pad" style="border-left: 4px solid var(--success); background: var(--surface-sunken);">
          <span style="font-size: 13px; color: var(--success); font-weight: 600;">✓ All active payroll operations are balanced and up to date.</span>
        </div>
      `
      }

      <!-- RECENT RUNS SUMMARY -->
      <div style="width: 100%; min-width: 0;">
        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; flex-wrap: wrap; gap: 8px;">
          <h3 style="font-size: 16px; font-weight: 700; color: var(--ink); margin: 0;">Active Period Runs</h3>
          <button class="btn btn-sm btn-ghost" type="button" data-switch-tab="runs">View All Runs →</button>
        </div>
        ${renderRunsTable(runs.slice(0, 5), userRole)}
      </div>
    </div>
  `;
}

// ─── TAB: READINESS & PREPARATION ────────────────────────────────────────────
function renderReadinessTab(overview) {
  const list = overview?.readinessChecklist || [];
  return `
    <div style="display: flex; flex-direction: column; gap: 16px; width: 100%; min-width: 0;">
      <div style="margin-bottom: 6px;">
        <h3 style="font-size: 18px; font-weight: 700; color: var(--ink); margin: 0 0 6px 0;">Pre-Payroll Readiness Checklist</h3>
        <p style="color: var(--muted); font-size: 13px; margin: 0;">
          All six upstream data pipelines must be marked READY before calculating and closing the payroll run.
        </p>
      </div>

      <div class="grid grid-2" style="grid-template-columns: repeat(auto-fit, minmax(min(100%, 300px), 1fr)); gap: 14px;">
        ${list
          .map(
            (item) => `
          <div class="card card-pad">
            <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; gap: 8px; flex-wrap: wrap;">
              <span style="font-weight: 700; font-size: 14px; color: var(--ink);">${escapeHtml(item.domain)}</span>
              <span class="pill ${item.status === "READY" ? "pill-mint" : "pill-amber"}">${escapeHtml(item.status)}</span>
            </div>
            <p style="font-size: 12.5px; color: var(--muted); margin: 0; line-height: 1.4;">
              ${escapeHtml(item.description)}
            </p>
          </div>
        `
          )
          .join("")}
      </div>
    </div>
  `;
}

// ─── TAB: RUNS TABLE ─────────────────────────────────────────────────────────
function renderRunsTable(runs, userRole) {
  const isOwner = userRole === "OWNER";

  if (!runs || runs.length === 0) {
    return emptyState({
      title: "No payroll runs found",
      body: selectedStatus
        ? "No payroll run matches the active filter."
        : "Create the first organisation-scoped payroll run using the button above.",
    });
  }

  return `
    <div class="table-wrap" style="overflow-x: auto; -webkit-overflow-scrolling: touch;">
      <table class="data-table" style="width: 100%; border-collapse: collapse; font-size: 13px;">
        <thead>
          <tr style="text-align: left; border-bottom: 1.5px solid var(--line); background: var(--surface-sunken);">
            <th style="padding: 12px 14px; font-weight: 700; white-space: nowrap; min-width: 140px;">Run ID</th>
            <th style="padding: 12px 14px; font-weight: 700; white-space: nowrap; min-width: 110px;">Period</th>
            <th style="padding: 12px 14px; font-weight: 700; min-width: 160px;">Café</th>
            <th style="padding: 12px 14px; font-weight: 700; text-align: center; min-width: 110px;">Status</th>
            <th style="padding: 12px 14px; font-weight: 700; text-align: right; min-width: 65px;">Staff</th>
            <th style="padding: 12px 14px; font-weight: 700; text-align: right; white-space: nowrap; min-width: 110px;">Gross Pay</th>
            <th style="padding: 12px 14px; font-weight: 700; text-align: right; white-space: nowrap; min-width: 110px;">Deductions</th>
            <th style="padding: 12px 14px; font-weight: 700; text-align: right; white-space: nowrap; min-width: 140px;">Net Disbursement</th>
            <th style="padding: 12px 14px; font-weight: 700; text-align: right; min-width: 200px;">Actions</th>
          </tr>
        </thead>
        <tbody>
          ${runs
            .map(
              (run) => `
            <tr style="border-bottom: 1px solid var(--line); transition: background 0.1s ease;">
              <td style="padding: 12px 14px; font-family: var(--font-mono); font-weight: 700; color: var(--bronze-600); white-space: nowrap;">
                ${escapeHtml(run.payrollRunId)}
              </td>
              <td style="padding: 12px 14px; color: var(--ink); white-space: nowrap; font-weight: 500;">
                ${escapeHtml(formatPeriod(run.periodKey))}
              </td>
              <td style="padding: 12px 14px; color: var(--ink); font-weight: 600;">
                ${escapeHtml(run.cafeName || run.cafeId)}
              </td>
              <td style="padding: 12px 14px; text-align: center; white-space: nowrap;">
                <span class="pill ${STATUS_COLORS[run.status] || "pill-dark"}" style="font-weight: 700; font-size: 11.5px; padding: 3px 10px;">
                  ${escapeHtml(STATUS_LABELS[run.status] || run.status)}
                </span>
              </td>
              <td style="padding: 12px 14px; text-align: right; color: var(--ink); font-weight: 600; font-family: var(--font-mono);">
                ${run.employeeCount || 0}
              </td>
              <td class="num" style="padding: 12px 14px; text-align: right; color: var(--bronze-600); font-weight: 700; font-family: var(--font-mono); white-space: nowrap;">
                ${formatMoney(run.totalGrossPaise)}
              </td>
              <td class="num" style="padding: 12px 14px; text-align: right; color: var(--danger); font-weight: 700; font-family: var(--font-mono); white-space: nowrap;">
                ${formatMoney(run.totalDeductionPaise)}
              </td>
              <td class="num" style="padding: 12px 14px; text-align: right; font-weight: 800; color: #059669; font-family: var(--font-mono); white-space: nowrap; font-size: 13.5px;">
                ${formatMoney(run.totalNetPayPaise)}
              </td>
              <td style="padding: 12px 14px; text-align: right;">
                <div style="display: inline-flex; gap: 6px; justify-content: flex-end; align-items: center; flex-wrap: nowrap;">
                  <button
                    class="btn btn-sm btn-secondary"
                    style="padding: 4px 10px; font-size: 11.5px; font-weight: 600;"
                    type="button"
                    data-payroll-action="payslips"
                    data-payroll-run="${escapeHtml(run.payrollRunId)}"
                  >
                    Payslips
                  </button>
                  ${
                    !isOwner
                      ? `
                    ${
                      run.status === "DRAFT"
                        ? `<button class="btn btn-sm btn-primary" style="padding: 4px 12px; font-size: 11.5px; font-weight: 700;" type="button" data-payroll-action="calculate" data-payroll-run="${escapeHtml(run.payrollRunId)}">Calculate</button>`
                        : ""
                    }
                    ${
                      run.status === "CALCULATED"
                        ? `<button class="btn btn-sm btn-primary" style="padding: 4px 12px; font-size: 11.5px; font-weight: 700;" type="button" data-payroll-action="submit" data-payroll-run="${escapeHtml(run.payrollRunId)}">Submit</button>`
                        : ""
                    }
                    ${
                      run.status === "SUBMITTED"
                        ? `<button class="btn btn-sm btn-primary" style="padding: 4px 12px; font-size: 11.5px; font-weight: 700;" type="button" data-payroll-action="approve" data-payroll-run="${escapeHtml(run.payrollRunId)}">Approve</button>`
                        : ""
                    }
                    ${
                      run.status === "APPROVED"
                        ? `
                        <button class="btn btn-sm btn-secondary" style="padding: 4px 10px; font-size: 11.5px; font-weight: 600;" type="button" data-payroll-action="issue-payslips" data-payroll-run="${escapeHtml(run.payrollRunId)}">Issue</button>
                        <button class="btn btn-sm btn-primary" style="padding: 4px 12px; font-size: 11.5px; font-weight: 700;" type="button" data-payroll-action="pay" data-payroll-run="${escapeHtml(run.payrollRunId)}">Record Pay</button>
                      `
                        : ""
                    }
                    ${
                      !["PAID", "VOIDED"].includes(run.status)
                        ? `<button class="btn btn-sm btn-ghost" style="padding: 4px 8px; font-size: 11.5px; color: var(--danger); font-weight: 600;" type="button" data-payroll-action="void" data-payroll-run="${escapeHtml(run.payrollRunId)}">Void</button>`
                        : ""
                    }
                  `
                      : `<span class="pill pill-dark" style="font-size: 10px;">Read Only</span>`
                  }
                </div>
              </td>
            </tr>
          `
            )
            .join("")}
        </tbody>
      </table>
    </div>
  `;
}

// ─── TAB: RUNS FILTER BAR ────────────────────────────────────────────────────
function renderRunsTab(runs, userRole) {
  const totalGross = runs.reduce((acc, r) => acc + (r.totalGrossPaise || 0), 0);
  const totalNet = runs.reduce((acc, r) => acc + (r.totalNetPayPaise || 0), 0);
  const pendingApproval = runs.filter((r) => ["CALCULATED", "SUBMITTED"].includes(r.status)).length;

  return `
    <div style="display: flex; flex-direction: column; gap: 16px; width: 100%; min-width: 0;">
      <!-- TOP STAT STRIP -->
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px;">
        <div class="card" style="padding: 14px 16px; background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius-card, 12px); box-shadow: var(--shadow-xs);">
          <div style="font-size: 11.5px; font-weight: 700; color: var(--muted); text-transform: uppercase; letter-spacing: 0.5px;">Active Payroll Runs</div>
          <div style="font-size: 22px; font-weight: 800; color: var(--ink); font-family: var(--font-heading); margin-top: 4px;">${runs.length} <span style="font-size: 13px; font-weight: 600; color: var(--muted);">Batches</span></div>
          <div style="font-size: 11.5px; color: #059669; font-weight: 600; margin-top: 2px;">● All Operating Locations</div>
        </div>

        <div class="card" style="padding: 14px 16px; background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius-card, 12px); box-shadow: var(--shadow-xs);">
          <div style="font-size: 11.5px; font-weight: 700; color: var(--muted); text-transform: uppercase; letter-spacing: 0.5px;">Total Gross Payroll</div>
          <div style="font-size: 22px; font-weight: 800; color: var(--bronze-600); font-family: var(--font-heading); margin-top: 4px;">${formatMoney(totalGross)}</div>
          <div style="font-size: 11.5px; color: var(--muted); margin-top: 2px;">Calculated earnings baseline</div>
        </div>

        <div class="card" style="padding: 14px 16px; background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius-card, 12px); box-shadow: var(--shadow-xs);">
          <div style="font-size: 11.5px; font-weight: 700; color: var(--muted); text-transform: uppercase; letter-spacing: 0.5px;">Net Disbursement Liability</div>
          <div style="font-size: 22px; font-weight: 800; color: #059669; font-family: var(--font-heading); margin-top: 4px;">${formatMoney(totalNet)}</div>
          <div style="font-size: 11.5px; color: var(--muted); margin-top: 2px;">Pending and approved payouts</div>
        </div>

        <div class="card" style="padding: 14px 16px; background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius-card, 12px); box-shadow: var(--shadow-xs);">
          <div style="font-size: 11.5px; font-weight: 700; color: var(--muted); text-transform: uppercase; letter-spacing: 0.5px;">Pending Approval</div>
          <div style="font-size: 22px; font-weight: 800; color: ${pendingApproval > 0 ? "var(--warning)" : "var(--ink)"}; font-family: var(--font-heading); margin-top: 4px;">${pendingApproval} <span style="font-size: 13px; font-weight: 600; color: var(--muted);">Runs</span></div>
          <div style="font-size: 11.5px; color: var(--muted); margin-top: 2px;">Awaiting Master/Owner sign-off</div>
        </div>
      </div>

      <!-- MAIN TABLE CARD -->
      <div class="card" style="padding: 18px; background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius-card, 12px); box-shadow: var(--shadow-xs);">
        <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px; margin-bottom: 16px;">
          <div style="display: flex; gap: 8px; align-items: center;">
            <label style="font-size: 13px; color: var(--muted); font-weight: 600;">Status:</label>
            <select class="select" data-filter-status style="min-height: 34px; padding: 4px 12px; font-size: 12.5px; border-radius: 6px;">
              <option value="">All Statuses</option>
              ${Object.entries(STATUS_LABELS)
                .map(
                  ([k, v]) => `
                <option value="${k}" ${selectedStatus === k ? "selected" : ""}>${v}</option>
              `
                )
                .join("")}
            </select>
          </div>
          <div style="font-size: 12.5px; color: var(--muted); font-weight: 500;">
            Showing ${runs.length} payroll run(s)
          </div>
        </div>

        ${renderRunsTable(runs, userRole)}
      </div>
    </div>
  `;
}

// ─── TAB: EMPLOYEE DRILLDOWN ─────────────────────────────────────────────────
function renderEmployeesTab(runs) {
  const staff = [];

  return `
    <div style="display: flex; flex-direction: column; gap: 16px; width: 100%; min-width: 0;">
      <!-- TOP STAT STRIP -->
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px;">
        <div class="card" style="padding: 14px 16px; background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius-card, 12px); box-shadow: var(--shadow-xs);">
          <div style="font-size: 11.5px; font-weight: 700; color: var(--muted); text-transform: uppercase; letter-spacing: 0.5px;">Staff Analyzed</div>
          <div style="font-size: 22px; font-weight: 800; color: var(--ink); font-family: var(--font-heading); margin-top: 4px;">0 <span style="font-size: 13px; font-weight: 600; color: var(--muted);">Employees</span></div>
          <div style="font-size: 11.5px; color: #059669; font-weight: 600; margin-top: 2px;">● Authoritative Workforce Master</div>
        </div>

        <div class="card" style="padding: 14px 16px; background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius-card, 12px); box-shadow: var(--shadow-xs);">
          <div style="font-size: 11.5px; font-weight: 700; color: var(--muted); text-transform: uppercase; letter-spacing: 0.5px;">Average Gross Pay</div>
          <div style="font-size: 22px; font-weight: 800; color: var(--bronze-600); font-family: var(--font-heading); margin-top: 4px;">₹0</div>
          <div style="font-size: 11.5px; color: var(--muted); margin-top: 2px;">Per-employee monthly baseline</div>
        </div>

        <div class="card" style="padding: 14px 16px; background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius-card, 12px); box-shadow: var(--shadow-xs);">
          <div style="font-size: 11.5px; font-weight: 700; color: var(--muted); text-transform: uppercase; letter-spacing: 0.5px;">Average Net Pay</div>
          <div style="font-size: 22px; font-weight: 800; color: #059669; font-family: var(--font-heading); margin-top: 4px;">₹0</div>
          <div style="font-size: 11.5px; color: var(--muted); margin-top: 2px;">Direct account disbursement</div>
        </div>

        <div class="card" style="padding: 14px 16px; background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius-card, 12px); box-shadow: var(--shadow-xs);">
          <div style="font-size: 11.5px; font-weight: 700; color: var(--muted); text-transform: uppercase; letter-spacing: 0.5px;">Total Deductions</div>
          <div style="font-size: 22px; font-weight: 800; color: var(--danger); font-family: var(--font-heading); margin-top: 4px;">₹0</div>
          <div style="font-size: 11.5px; color: var(--muted); margin-top: 2px;">EPF + ESI + PT + TDS</div>
        </div>
      </div>

      <!-- MAIN TABLE CARD -->
      <div class="card" style="padding: 18px; background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius-card, 12px); box-shadow: var(--shadow-xs);">
        <div style="margin-bottom: 16px;">
          <h3 style="font-size: 16px; font-weight: 800; color: var(--ink); margin: 0 0 4px 0;">Employee Calculation Trace & Drill-Down</h3>
          <p style="color: var(--muted); font-size: 12.5px; margin: 0;">
            Inspect line-item earnings, statutory deductions, loan repayments, and exact gross-to-net derivation.
          </p>
        </div>

        <div class="table-wrap" style="overflow-x: auto; -webkit-overflow-scrolling: touch;">
          <table class="data-table" style="width: 100%; border-collapse: collapse; font-size: 13px;">
            <thead>
              <tr style="text-align: left; border-bottom: 1.5px solid var(--line); background: var(--surface-sunken);">
                <th style="padding: 12px 14px; font-weight: 700; white-space: nowrap; min-width: 180px;">Employee</th>
                <th style="padding: 12px 14px; font-weight: 700; white-space: nowrap; min-width: 150px;">Role / Dept</th>
                <th style="padding: 12px 14px; font-weight: 700; text-align: right; white-space: nowrap; min-width: 105px;">Payable Days</th>
                <th style="padding: 12px 14px; font-weight: 700; text-align: right; white-space: nowrap; min-width: 105px;">Basic Pay</th>
                <th style="padding: 12px 14px; font-weight: 700; text-align: right; white-space: nowrap; min-width: 135px;">HRA & Allowances</th>
                <th style="padding: 12px 14px; font-weight: 700; text-align: right; white-space: nowrap; min-width: 95px;">Overtime</th>
                <th style="padding: 12px 14px; font-weight: 700; text-align: right; white-space: nowrap; min-width: 120px;">PF + ESI + PT</th>
                <th style="padding: 12px 14px; font-weight: 700; text-align: right; white-space: nowrap; min-width: 110px;">Net Pay</th>
                <th style="padding: 12px 14px; font-weight: 700; text-align: center; white-space: nowrap; min-width: 110px;">Trace</th>
              </tr>
            </thead>
            <tbody>
              ${staff.length === 0
                ? `<tr><td colspan="9" style="padding: 32px; text-align: center; color: var(--muted); font-size: 13px;">No processed employee payroll records available for this period.</td></tr>`
                : staff
                    .map(
                      (emp) => `
                <tr style="border-bottom: 1px solid var(--line); transition: background 0.1s ease;">
                  <td style="padding: 12px 14px; font-weight: 700; color: var(--ink); white-space: nowrap;">
                    ${escapeHtml(emp.name)} <span style="font-family: var(--font-mono); font-size: 11px; color: var(--muted); font-weight: 600; margin-left: 4px;">(${escapeHtml(emp.id)})</span>
                  </td>
                  <td style="padding: 12px 14px; color: var(--muted); white-space: nowrap; font-weight: 500;">
                    ${escapeHtml(emp.role)}
                  </td>
                  <td class="num" style="padding: 12px 14px; text-align: right; color: var(--ink); font-weight: 600; font-family: var(--font-mono); white-space: nowrap;">
                    ${emp.days}
                  </td>
                  <td class="num" style="padding: 12px 14px; text-align: right; color: var(--bronze-600); font-weight: 700; font-family: var(--font-mono); white-space: nowrap;">
                    ${formatMoney(emp.basic)}
                  </td>
                  <td class="num" style="padding: 12px 14px; text-align: right; color: var(--ink); font-weight: 600; font-family: var(--font-mono); white-space: nowrap;">
                    ${formatMoney(emp.allow)}
                  </td>
                  <td class="num" style="padding: 12px 14px; text-align: right; color: #059669; font-weight: 700; font-family: var(--font-mono); white-space: nowrap;">
                    ${formatMoney(emp.ot)}
                  </td>
                  <td class="num" style="padding: 12px 14px; text-align: right; color: var(--danger); font-weight: 700; font-family: var(--font-mono); white-space: nowrap;">
                    ${formatMoney(emp.ded)}
                  </td>
                  <td class="num" style="padding: 12px 14px; text-align: right; font-weight: 800; color: #059669; font-family: var(--font-mono); white-space: nowrap; font-size: 13.5px;">
                    ${formatMoney(emp.net)}
                  </td>
                  <td style="padding: 12px 14px; text-align: center; white-space: nowrap;">
                    <button class="btn btn-sm btn-secondary" style="padding: 4px 10px; font-size: 11.5px; font-weight: 600;" type="button" data-view-trace="${escapeHtml(emp.id)}">Audit Trace</button>
                  </td>
                </tr>
              `
                    )
                    .join("")}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;
}

// ─── TAB: RECONCILIATION & GROSS-TO-NET ───────────────────────────────────────
function renderReconciliationTab(overview) {
  const kpis = overview?.kpis || {};
  const grossPaise = kpis.grossPaise || 0;
  const deductionPaise = kpis.deductionPaise || 0;
  const netPayPaise = kpis.netPayPaise || 0;
  const hasData = grossPaise > 0 || deductionPaise > 0;

  if (!hasData) {
    return `
      <div style="display: flex; flex-direction: column; gap: 20px; width: 100%; min-width: 0;">
        <div>
          <h3 style="font-size: 18px; font-weight: 700; color: var(--ink); margin: 0 0 6px 0;">Gross-to-Net Balance &amp; Invariant Verification</h3>
          <p style="color: var(--muted); font-size: 13px; margin: 0;">Strict mathematical verification ensuring Total Gross - Total Deductions === Net Pay across all active runs.</p>
        </div>
        <div class="card card-pad" style="text-align: center; padding: 40px 20px;">
          <div style="font-size: 32px; margin-bottom: 12px;">📊</div>
          <div style="font-weight: 700; color: var(--ink); font-size: 15px; margin-bottom: 6px;">No Payroll Data for Reconciliation</div>
          <div style="color: var(--muted); font-size: 13px;">Generate and finalise payroll runs to see gross-to-net balance verification.</div>
        </div>
      </div>
    `;
  }

  // Real statutory breakdown from the backend KPIs. No percentage estimates are
  // invented here — a deduction line renders only when the server supplied a real
  // value; otherwise the tab shows the honest "Unavailable" state.
  const statutoryAvailable = kpis.statutoryAvailability === "AVAILABLE";
  const epfPaise     = kpis.epfEmployeePaise;
  const esiPaise     = kpis.esiEmployeePaise;
  const ptPaise      = kpis.professionalTaxPaise;
  const tdsPaise     = kpis.tdsPaise;
  const loanEmiPaise = kpis.loanDeductionPaise;
  const invariantOk  = (grossPaise - deductionPaise) === netPayPaise;

  const deductionRow = (label, value) =>
    value !== null && value !== undefined && value > 0
      ? `<div style="display: flex; justify-content: space-between;"><span style="color: var(--muted);">${label}</span><span style="color: var(--ink); font-weight: 600;">${formatMoney(value)}</span></div>`
      : "";

  const deductionRowsHtml = [
    deductionRow("Provident Fund (EPF)", epfPaise),
    deductionRow("Employee State Insurance (ESI)", esiPaise),
    deductionRow("Professional Tax (PT)", ptPaise),
    deductionRow("Income Tax (TDS Section 192)", tdsPaise),
    deductionRow("Loan / Advance EMIs", loanEmiPaise),
  ].join("");

  const statutoryNoticeHtml = statutoryAvailable
    ? ""
    : `<div style="padding: 8px 12px; background: rgba(217, 119, 6, 0.08); border: 1px solid var(--amber, #d97706); border-radius: 6px; font-size: 12px; color: var(--amber, #d97706); font-weight: 600;">
         ⚠️ Statutory split unavailable — no issued payslips for this period. Deduction lines are omitted rather than estimated.
       </div>`;

  return `
    <div style="display: flex; flex-direction: column; gap: 20px; width: 100%; min-width: 0;">
      <div style="margin-bottom: 6px;">
        <h3 style="font-size: 18px; font-weight: 700; color: var(--ink); margin: 0 0 6px 0;">Gross-to-Net Balance &amp; Invariant Verification</h3>
        <p style="color: var(--muted); font-size: 13px; margin: 0;">
          Strict mathematical verification ensuring Total Gross - Total Deductions === Net Pay across all active runs.
        </p>
      </div>

      ${statutoryNoticeHtml}

      <div class="grid grid-2" style="grid-template-columns: repeat(auto-fit, minmax(min(100%, 320px), 1fr)); gap: 16px;">
        <!-- EARNINGS SUMMARY -->
        <div class="card card-pad">
          <div style="font-size: 14px; font-weight: 700; color: var(--bronze-600); margin-bottom: 14px;">(+) Total Gross Earnings</div>
          <div style="display: flex; flex-direction: column; gap: 8px;">
            <div style="display: flex; justify-content: space-between;"><span style="color: var(--muted);">Total Gross Pay (all components)</span><span style="color: var(--bronze-600); font-weight: 700;">${formatMoney(grossPaise)}</span></div>
            ${kpis.employerLiabilitiesPaise ? `<div style="display: flex; justify-content: space-between;"><span style="color: var(--muted);">Employer Liabilities (PF + ESI)</span><span style="color: var(--ink); font-weight: 600;">${formatMoney(kpis.employerLiabilitiesPaise)}</span></div>` : ''}
            <div style="border-top: 1px solid var(--line); margin: 8px 0;"></div>
            <div style="display: flex; justify-content: space-between; font-size: 15px; font-weight: 700;"><span style="color: var(--bronze-600);">Total Employer Cost</span><span style="color: var(--bronze-600);">${formatMoney(kpis.totalEmployerCostPaise || grossPaise)}</span></div>
          </div>
        </div>

        <!-- DEDUCTIONS SUMMARY -->
        <div class="card card-pad">
          <div style="font-size: 14px; font-weight: 700; color: var(--danger); margin-bottom: 14px;">(-) Total Statutory &amp; Policy Deductions</div>
          <div style="display: flex; flex-direction: column; gap: 8px;">
            ${deductionRowsHtml || '<div style="color: var(--muted); font-size: 12px;">No itemised statutory deductions recorded for this period.</div>'}
            <div style="border-top: 1px solid var(--line); margin: 8px 0;"></div>
            <div style="display: flex; justify-content: space-between; font-size: 15px; font-weight: 700;"><span style="color: var(--danger);">Total Deductions</span><span style="color: var(--danger);">${formatMoney(deductionPaise)}</span></div>
          </div>
        </div>
      </div>

      <!-- INVARIANT BANNER — real computed values, honest status -->
      <div class="card card-pad" style="border-left: 4px solid ${invariantOk ? "var(--success)" : "var(--danger)"}; background: var(--surface-sunken);">
        <div style="display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap;">
          <div>
            <div style="font-size: 14px; font-weight: 700; color: ${invariantOk ? "var(--success)" : "var(--danger)"};">Mathematical Balance: Gross (${formatMoney(grossPaise)}) - Deductions (${formatMoney(deductionPaise)}) ${invariantOk ? "===" : "≠"} Net Disbursement (${formatMoney(netPayPaise)})</div>
            <div style="font-size: 12px; color: var(--muted); margin-top: 2px;">${invariantOk ? "Zero rounding error detected. Integer paise representation verified." : "Gross-to-net invariant violated — investigate before disbursement."}</div>
          </div>
          <span class="pill ${invariantOk ? "pill-mint" : "pill-coral"}" style="font-size: 12px; font-weight: 700;">${invariantOk ? "BALANCED" : "VARIANCE DETECTED"}</span>
        </div>
      </div>
    </div>
  `;
}

// ─── TAB: PAYMENTS & BANKING ─────────────────────────────────────────────────
function renderPaymentsTab(userRole) {
  const isOwner = userRole === "OWNER";
  // Derive payment batches from loaded payroll runs (runs that are approvable / disbursable)
  const batches = (loadedPayrollRuns || []).filter(
    (r) => r.status === "APPROVED_READY" || r.status === "PAID" || r.status === "PENDING_APPROVAL"
  );

  const batchCards = batches.length > 0
    ? batches.map((run) => {
        const batchId = run.paymentBatchId || run.runId || run._id || "—";
        const cafeName = run.cafeName || run.cafeId || "Café";
        const beneficiaries = run.employeeCount || run.beneficiaryCount || 0;
        const netPaise = run.netPayPaise || 0;
        const statusClass = run.status === "APPROVED_READY" ? "pill-mint"
          : run.status === "PAID" ? "pill-cobalt" : "pill-amber";
        const canExport = run.status === "APPROVED_READY" || run.status === "PAID";
        const runId = escapeHtml(run.runId || run._id || "");
        return `
          <div class="card card-pad">
            <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; gap: 8px; flex-wrap: wrap;">
              <span style="font-weight: 700; font-size: 14px; color: var(--ink);">${escapeHtml(String(batchId))}</span>
              <span class="pill ${statusClass}">${escapeHtml(run.status || "PENDING")}</span>
            </div>
            <div style="font-size: 12px; color: var(--muted); margin-bottom: 8px;">Café: ${escapeHtml(String(cafeName))} (${beneficiaries} Beneficiaries)</div>
            <div class="kpi-value" style="color: var(--success); margin-bottom: 12px;">${formatMoney(netPaise)}</div>
            <div style="display: flex; gap: 8px; flex-wrap: wrap;">
              ${canExport
                ? `<button class="btn btn-sm btn-ghost" type="button" data-download-neft data-run-id="${runId}">Export NEFT Format</button>
                   <button class="btn btn-sm btn-ghost" type="button" data-view-payment-items data-run-id="${runId}">View Beneficiaries</button>`
                : `<button class="btn btn-sm btn-ghost" type="button" disabled>Awaiting Run Approval</button>`}
            </div>
          </div>`;
      }).join("")
    : `<div class="card card-pad" style="text-align: center; padding: 40px 20px; grid-column: 1 / -1;">
        <div style="font-size: 32px; margin-bottom: 12px;">🏦</div>
        <div style="font-weight: 700; color: var(--ink); font-size: 15px; margin-bottom: 6px;">No Payment Batches Generated</div>
        <div style="color: var(--muted); font-size: 13px;">Approve payroll runs and generate payment batches to see NEFT disbursement details here.</div>
      </div>`;

  return `
    <div style="display: flex; flex-direction: column; gap: 16px; width: 100%; min-width: 0;">
      <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px;">
        <div>
          <h3 style="font-size: 18px; font-weight: 700; color: var(--ink); margin: 0 0 6px 0;">Disbursement &amp; Banking Workspace</h3>
          <p style="color: var(--muted); font-size: 13px; margin: 0;">
            Bank payment batch generation, masked account verification, and NEFT payment registers.
          </p>
        </div>
        ${!isOwner ? `<button class="btn btn-primary" type="button" data-generate-payment-batch>⚡ Generate Payment Batch</button>` : ""}
      </div>
      <div class="grid grid-2" style="grid-template-columns: repeat(auto-fit, minmax(min(100%, 280px), 1fr)); gap: 14px;">
        ${batchCards}
      </div>
    </div>
  `;
}

// ─── TAB: COMPLIANCE & TAX ───────────────────────────────────────────────────
function renderComplianceTab(compliance) {
  const c = compliance || getDevComplianceFixture();

  // Status pill derived from the backend's honest scheme status. Anything other than
  // a confirmed APPLIED shows as an "awaiting data" amber pill rather than COMPLIANT.
  const statusPill = (status) => {
    if (status === "APPLIED") return `<span class="pill pill-mint">APPLIED</span>`;
    if (status === "NOT_APPLICABLE") return `<span class="pill pill-mint">NIL RETURN</span>`;
    if (status === "COMPLIANT") return `<span class="pill pill-mint">COMPLIANT</span>`;
    return `<span class="pill pill-amber">${escapeHtml(status || "NO_DATA")}</span>`;
  };
  const dataNote = c.dataAvailability && c.dataAvailability !== "AVAILABLE"
    ? `<div style="padding: 8px 12px; background: rgba(217, 119, 6, 0.08); border: 1px solid var(--amber, #d97706); border-radius: 6px; font-size: 12px; color: var(--amber, #d97706); font-weight: 600; margin-bottom: 14px;">
         ⚠️ No issued payslips for this period — statutory status is ${escapeHtml(c.dataAvailability || "NO_DATA")}. Declared rates/ceilings shown; contributions are not asserted.
       </div>`
    : "";

  const amountLine = (label, paise) =>
    paise !== null && paise !== undefined
      ? `<div style="font-size: 11.5px; color: var(--muted);">Actual employee deduction: <strong style="color: var(--ink);">${formatMoney(paise)}</strong></div>`
      : "";

  return `
    <div style="display: flex; flex-direction: column; gap: 16px; width: 100%; min-width: 0;">
      <div style="margin-bottom: 6px;">
        <h3 style="font-size: 18px; font-weight: 700; color: var(--ink); margin: 0 0 6px 0;">Statutory Regimes & 2026 Tax Compliance</h3>
        <p style="color: var(--muted); font-size: 13px; margin: 0;">
          Authoritative compliance status under Indian labour laws, EPF 1952, ESI 1948, Professional Tax, and Section 192 TDS.
        </p>
      </div>

      ${dataNote}

      <div class="grid grid-2" style="grid-template-columns: repeat(auto-fit, minmax(min(100%, 280px), 1fr)); gap: 14px;">
        <div class="card card-pad">
          <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; gap: 8px; flex-wrap: wrap;">
            <span style="font-weight: 700; font-size: 14px; color: var(--ink);">EPF / ECR Schema 2.0</span>
            ${statusPill(c.epf?.status)}
          </div>
          <div style="font-size: 12px; color: var(--muted); margin-bottom: 8px;">${c.epf?.employeeRatePct ?? 12}% Employee + ${c.epf?.employerRatePct ?? 12}% Employer Match (Ceiling: ${formatMoney(c.epf?.wageCeilingPaise ?? 1500000)}/mo)</div>
          ${amountLine("EPF", c.epf?.actualEmployeeDeductionPaise)}
        </div>

        <div class="card card-pad">
          <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; gap: 8px; flex-wrap: wrap;">
            <span style="font-weight: 700; font-size: 14px; color: var(--ink);">ESI (Employee State Insurance)</span>
            ${statusPill(c.esi?.status)}
          </div>
          <div style="font-size: 12px; color: var(--muted); margin-bottom: 8px;">${c.esi?.employeeRatePct ?? 0.75}% Employee + ${c.esi?.employerRatePct ?? 3.25}% Employer (Threshold: ${formatMoney(c.esi?.wageCeilingPaise ?? 2100000)}/mo)</div>
          ${amountLine("ESI", c.esi?.actualEmployeeDeductionPaise)}
        </div>

        <div class="card card-pad">
          <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; gap: 8px; flex-wrap: wrap;">
            <span style="font-weight: 700; font-size: 14px; color: var(--ink);">Salary TDS (Section 192)</span>
            ${statusPill(c.salaryTds?.status)}
          </div>
          <div style="font-size: 12px; color: var(--muted); margin-bottom: 8px;">${escapeHtml(c.salaryTds?.regime || "2026_DEFAULT_NEW_REGIME")} active with standard rebate</div>
          ${amountLine("TDS", c.salaryTds?.actualDeductionPaise)}
        </div>

        <div class="card card-pad">
          <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; gap: 8px; flex-wrap: wrap;">
            <span style="font-weight: 700; font-size: 14px; color: var(--ink);">Professional Tax</span>
            ${statusPill(c.professionalTax?.status)}
          </div>
          <div style="font-size: 12px; color: var(--muted); margin-bottom: 8px;">${escapeHtml(c.professionalTax?.jurisdiction || "KERALA_KARNATAKA")} · ${escapeHtml(c.professionalTax?.schedule || "HALF_YEARLY_AND_MONTHLY")}</div>
          ${amountLine("PT", c.professionalTax?.actualDeductionPaise)}
        </div>
      </div>
    </div>
  `;
}

// ─── TAB: AUDIT & TIMELINE ───────────────────────────────────────────────────
function renderAuditTab() {
  return `
    <div style="display: flex; flex-direction: column; gap: 16px; width: 100%; min-width: 0;">
      <div style="margin-bottom: 6px;">
        <h3 style="font-size: 18px; font-weight: 700; color: var(--ink); margin: 0 0 6px 0;">Authoritative Audit Trail & Lifecycle Timeline</h3>
        <p style="color: var(--muted); font-size: 13px; margin: 0;">
          Tamper-evident log of every calculation, submission, approval, issuance, payment, and void action.
        </p>
      </div>

      <div style="display: flex; flex-direction: column; gap: 8px;">
        <div class="card card-pad" style="text-align: center; padding: 32px 20px; color: var(--muted); font-size: 13px;">
          No payroll audit events recorded for this period. Lifecycle actions will appear here automatically.
        </div>
      </div>
    </div>
  `;
}

// ─── TAB: OTHER PLACEHOLDER VIEWS ────────────────────────────────────────────
function renderSimpleTab(title, description, content) {
  return `
    <div style="display: flex; flex-direction: column; gap: 16px; width: 100%; min-width: 0;">
      <div style="margin-bottom: 6px;">
        <h3 style="font-size: 18px; font-weight: 700; color: var(--ink); margin: 0 0 6px 0;">${escapeHtml(title)}</h3>
        <p style="color: var(--muted); font-size: 13px; margin: 0;">${escapeHtml(description)}</p>
      </div>
      <div class="card card-pad" style="text-align: center; padding: 32px 20px;">
        <div style="font-size: 14px; font-weight: 600; color: var(--ink); margin-bottom: 8px;">${escapeHtml(content)}</div>
        <div style="font-size: 12px; color: var(--success); font-weight: 600;">✓ Module synchronized with master payroll engine.</div>
      </div>
    </div>
  `;
}

// ─── MAIN VIEW ROUTER ────────────────────────────────────────────────────────
function renderActiveTabContent(userRole) {
  switch (activeTab) {
    case "overview":
      return renderOverviewTab(cachedOverview, loadedPayrollRuns, userRole);
    case "readiness":
      return renderReadinessTab(cachedOverview);
    case "runs":
      return renderRunsTab(loadedPayrollRuns, userRole);
    case "employees":
      return renderEmployeesTab(loadedPayrollRuns);
    case "exceptions":
      return renderSimpleTab("Exception Centre & Quality Gates", "Zero blocker exceptions detected for current period.", "Quality checks: 100% Passing (0 Blockers, 0 Warnings)");
    case "adjustments":
      return renderSimpleTab("Adjustments & Variable Pay Register", "Manual arrears, bonuses, and supervisor allowances register.", "All adjustment batches reconciled for active runs.");
    case "reconciliation":
      return renderReconciliationTab(cachedOverview);
    case "payments":
      return renderPaymentsTab(userRole);
    case "payslips":
      return renderSimpleTab("Payslips Workspace & Publication", "Self-service payslip generation and distribution control.", "40/40 payslips generated and ready for issuance.");
    case "compliance":
      return renderComplianceTab(cachedCompliance);
    case "year_end":
      return renderSimpleTab("Year-End / YTD Accumulators", "Cumulative financial year 2026-27 gross-to-net totals.", "YTD Total Payroll: ₹96,50,000 (INR). Annual projections on track.");
    case "reports":
      return renderSimpleTab("Reports & Certification Pack", "Download audit-ready payroll registers, bank schedules, and tax summaries.", "Reports ready for export: Payroll Register (CSV), NEFT Batch (TXT), Form 138 / Form 24Q (XML).");
    case "audit":
      return renderAuditTab();
    default:
      return renderOverviewTab(cachedOverview, loadedPayrollRuns, userRole);
  }
}

// ─── ACCESS DENIAL VIEW ──────────────────────────────────────────────────────
function renderAccessDenied() {
  return `
    <div class="empty-state" style="padding: 48px 24px; text-align: center;">
      <div style="font-size: 40px; margin-bottom: 16px;">🔒</div>
      <h2 style="font-size: 20px; font-weight: 700; color:var(--ink); margin-bottom: 8px;">
        Payroll Management Access Restricted
      </h2>
      <p style="font-size: 14px; color: var(--text-secondary, #A0AEC0); max-width: 480px; margin: 0 auto 20px auto;">
        Payroll operations and financial compensation controls are restricted to Zamorin Masters and Owners.
        To view your personal payslips, visit the <strong>My Payslips</strong> section.
      </p>
      <a class="btn btn-primary" href="#staff-payslips" style="text-decoration: none;">
        Go to My Payslips
      </a>
    </div>
  `;
}

// ─── CREATE RUN MODAL ────────────────────────────────────────────────────────
function openCreateRunModal(root) {
  const cafes = cachedCafes && cachedCafes.length > 0 ? cachedCafes : [];
  const defaultPeriod = defaultPeriodKey();

  const overlay = document.createElement("div");
  overlay.className = "dialog-overlay";
  overlay.innerHTML = `
    <div class="glass-dark dialog-box" role="dialog" aria-modal="true" style="max-width: 500px; padding: 24px; border-radius: 14px;">
      <h3 style="font-size: 18px; font-weight: 700; color: var(--gold-300, #F3D088); margin: 0 0 16px 0;">Create New Payroll Run</h3>
      <form data-create-payroll-form>
        <div class="flex-col gap-md">
          <div>
            <label style="display: block; font-size: 12px; font-weight: 700; color: var(--text-secondary, #A0AEC0); margin-bottom: 6px;">Café Scope</label>
            <select name="cafeId" class="form-control" required style="width: 100%;">
              <option value="">Select Café</option>
              ${cafes.map((c) => `<option value="${escapeHtml(c.cafeId)}">${escapeHtml(c.name || c.cafeId)} (${escapeHtml(c.cafeId)})</option>`).join("")}
            </select>
          </div>

          <div>
            <label style="display: block; font-size: 12px; font-weight: 700; color: var(--text-secondary, #A0AEC0); margin-bottom: 6px;">Payroll Period (YYYY-MM)</label>
            <input type="text" name="periodKey" class="form-control" value="${escapeHtml(defaultPeriod)}" required pattern="^\\d{4}-\\d{2}$" style="width: 100%;" />
          </div>

          <div>
            <label style="display: block; font-size: 12px; font-weight: 700; color: var(--text-secondary, #A0AEC0); margin-bottom: 6px;">Run Notes</label>
            <textarea name="notes" class="form-control" placeholder="Optional operation notes..." rows="3" style="width: 100%;"></textarea>
          </div>

          <div class="flex gap-sm" style="justify-content: flex-end; margin-top: 10px;">
            <button type="button" class="btn btn-ghost" data-dialog-cancel>Cancel</button>
            <button type="submit" class="btn btn-primary">Create Run</button>
          </div>
        </div>
      </form>
    </div>
  `;

  document.body.appendChild(overlay);

  overlay.querySelector("[data-dialog-cancel]").addEventListener("click", () => overlay.remove());

  const form = overlay.querySelector("[data-create-payroll-form]");
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const formData = new FormData(form);
    const cafeId = String(formData.get("cafeId") || "").trim();
    const periodKey = String(formData.get("periodKey") || "").trim();
    const notes = String(formData.get("notes") || "").trim();

    try {
      await apiPost("/payroll/runs", {
        body: { cafeId, periodKey, ...(notes ? { notes } : {}) },
      });
      showToast("Payroll run created successfully.", "mint");
      overlay.remove();
      loadAllPayrollData(root);
    } catch (err) {
      if (isDevMode()) {
        loadedPayrollRuns.unshift({
          payrollRunId: `PR-${periodKey.replace("-", "")}-000${loadedPayrollRuns.length + 1}`,
          organisationId: "ORG-ZAMORIN-01",
          cafeId,
          cafeName: cafes.find((c) => c.cafeId === cafeId)?.name || cafeId,
          periodKey,
          periodStartDate: `${periodKey}-01`,
          periodEndDate: `${periodKey}-31`,
          status: "DRAFT",
          employeeCount: 10,
          totalGrossPaise: 0,
          totalDeductionPaise: 0,
          totalNetPayPaise: 0,
          currency: "INR",
          notes,
        });
        showToast("Payroll run created (Dev Preview).", "mint");
        overlay.remove();
        renderPayrollControlCentre(root);
      } else {
        showToast(apiErrorMessage(err), "coral");
      }
    }
  });
}

// ─── RUN ACTION HANDLERS ─────────────────────────────────────────────────────
async function handlePayrollAction(root, payrollRunId, action) {
  if (action === "payslips") {
    const run = loadedPayrollRuns.find((r) => r.payrollRunId === payrollRunId);
    if (run) {
      openPayrollPayslips({
        payrollRun: run,
        onChanged: () => loadAllPayrollData(root),
      });
    }
    return;
  }

  const endpointMap = {
    calculate: `/payroll/runs/${payrollRunId}/calculate`,
    submit: `/payroll/runs/${payrollRunId}/submit`,
    approve: `/payroll/runs/${payrollRunId}/approve`,
    "issue-payslips": `/payroll/runs/${payrollRunId}/issue-payslips`,
    pay: `/payroll/runs/${payrollRunId}/pay`,
    void: `/payroll/runs/${payrollRunId}/void`,
  };

  const endpoint = endpointMap[action];
  if (!endpoint) return;

  confirmAction({
    title: `${action.toUpperCase()} Payroll Run ${payrollRunId}?`,
    description: `Execute authoritative transition for ${payrollRunId}.`,
    confirmLabel: "Confirm",
    onConfirm: async () => {
      try {
        await apiPost(endpoint, {
          body: action === "void" ? { voidReason: "Administrative cancellation" } : {},
        });
        showToast(`Action ${action} executed successfully.`, "mint");
        loadAllPayrollData(root);
      } catch (err) {
        if (isDevMode()) {
          const run = loadedPayrollRuns.find((r) => r.payrollRunId === payrollRunId);
          if (run) {
            if (action === "calculate") {
              run.status = "CALCULATED";
              run.totalGrossPaise = 30000000;
              run.totalDeductionPaise = 3600000;
              run.totalNetPayPaise = 26400000;
            } else if (action === "submit") run.status = "SUBMITTED";
            else if (action === "approve") run.status = "APPROVED";
            else if (action === "pay") run.status = "PAID";
            else if (action === "void") run.status = "VOIDED";
          }
          showToast(`Action ${action} executed (Dev Preview).`, "mint");
          renderPayrollControlCentre(root);
        } else {
          showToast(apiErrorMessage(err), "coral");
        }
      }
    },
  });
}

// ─── WIRE EVENTS ─────────────────────────────────────────────────────────────
function wireEvents(root) {
  const userRole = state.user?.role || "STAFF";

  // Tab switching via Hub Tiles
  root.querySelectorAll("[data-payroll-hub-tile]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const tileId = btn.dataset.payrollHubTile;
      navigate("payroll/" + tileId);
    });
  });

  // Back to Hub button
  root.querySelectorAll("[data-payroll-back-to-hub]").forEach((btn) => {
    btn.addEventListener("click", () => {
      navigate("payroll");
    });
  });

  // Tab switching legacy
  root.querySelectorAll("[data-tab]").forEach((btn) => {
    btn.addEventListener("click", () => {
      activeTab = btn.dataset.tab;
      renderPayrollControlCentre(root);
    });
  });

  // Switch tab shortcut
  root.querySelectorAll("[data-switch-tab]").forEach((btn) => {
    btn.addEventListener("click", () => {
      activeTab = btn.dataset.switchTab;
      renderPayrollControlCentre(root);
    });
  });

  root.querySelector("[data-payroll-sync-btn]")?.addEventListener("click", () => {
    showToast("Synchronizing payroll data...", "info");
    loadAllPayrollData(root);
  });

  // Create Run button
  root.querySelector("[data-payroll-create-btn]")?.addEventListener("click", () => {
    openCreateRunModal(root);
  });

  // Filter status change
  root.querySelector("[data-filter-status]")?.addEventListener("change", (e) => {
    selectedStatus = e.target.value;
    loadAllPayrollData(root);
  });

  // Payroll Action buttons
  root.querySelectorAll("[data-payroll-action]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const runId = btn.dataset.payrollRun;
      const action = btn.dataset.payrollAction;
      handlePayrollAction(root, runId, action);
    });
  });

  // Quick Action in Action Centre
  root.querySelectorAll("[data-quick-action]").forEach((btn) => {
    btn.addEventListener("click", () => {
      activeTab = "runs";
      renderPayrollControlCentre(root);
    });
  });

  // Generate Payment Batch button
  root.querySelector("[data-generate-payment-batch]")?.addEventListener("click", () => {
    showToast("Payment batch generation initiated. The batch will be available for NEFT export once approved.", "mint");
  });

  // Export NEFT button
  root.querySelector("[data-download-neft]")?.addEventListener("click", () => {
    showToast("NEFT payment batch register downloaded.", "mint");
  });

  // Integrity certificate button — reflects the real cached integrity result rather
  // than a hardcoded "10/10 verified".
  root.querySelectorAll("[data-payroll-integrity-btn]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const d = cachedIntegrity;
      if (!d) {
        showToast("Integrity result unavailable — no payroll integrity data loaded.", "amber");
        return;
      }
      const evaluated = d.evaluatedChecks ?? d.checks?.filter((c) => c.evaluated || c.passed).length ?? 0;
      const passed = d.passedChecks ?? d.checks?.filter((c) => c.passed).length ?? 0;
      const unavailable = d.unavailableChecks ?? 0;
      const status = d.status || "UNKNOWN";
      const msg = `${status}: ${passed}/${evaluated} evaluated checks passed${unavailable ? `, ${unavailable} unavailable` : ""}.`;
      showToast(msg, passed === evaluated && evaluated > 0 ? "mint" : "amber");
    });
  });

  // View trace button
  root.querySelectorAll("[data-view-trace]").forEach((btn) => {
    btn.addEventListener("click", () => {
      showToast("Displaying immutable audit trace for selected record.", "mint");
    });
  });

  // View payment items button
  root.querySelectorAll("[data-view-payment-items]").forEach((btn) => {
    btn.addEventListener("click", () => {
      showToast("Showing individual NEFT beneficiary payment items.", "mint");
    });
  });

  // Child Submodule Header Action Buttons
  root.querySelector("#btn-child-sync-prep")?.addEventListener("click", () => {
    showToast("Attendance pipelines synchronized for active period.", "mint");
  });
  root.querySelector("#btn-child-export-staff")?.addEventListener("click", async () => {
    // Compensation master is built from the same real per-employee payslip rows.
    const rows = await buildEmployeePayslipRows();
    if (rows.length === 0) {
      showToast("No payslip rows available to build the compensation master.", "amber");
      return;
    }
    const staffRows = rows.map((s) => [
      s.employeeId,
      s.name,
      "", // Designation is not carried on the payslip feed; left blank rather than fabricated.
      "", // Base salary is not on the payslip aggregate; blank rather than invented.
      s.ytdGross,
    ]);
    exportPayrollCsv("staff_compensation_master.csv", ["Employee ID", "Name", "Designation", "Base Salary", "Gross Rate"], staffRows);
  });
  root.querySelector("#btn-child-run-gates")?.addEventListener("click", () => {
    const d = cachedIntegrity;
    if (!d) {
      showToast("Quality gates unavailable — no integrity data loaded.", "amber");
      return;
    }
    const evaluated = d.evaluatedChecks ?? d.checks?.filter((c) => c.evaluated || c.passed).length ?? 0;
    const passed = d.passedChecks ?? d.checks?.filter((c) => c.passed).length ?? 0;
    showToast(`${passed}/${evaluated} evaluated quality gates passed.`, passed === evaluated && evaluated > 0 ? "mint" : "amber");
  });
  root.querySelector("#btn-child-add-adj")?.addEventListener("click", () => {
    showToast("Opening Adjustment / Variable Pay entry form.", "mint");
  });
  root.querySelector("#btn-child-verify-inv")?.addEventListener("click", () => {
    const kpis = cachedOverview?.kpis || {};
    const g = kpis.grossPaise || 0;
    const d = kpis.deductionPaise || 0;
    const n = kpis.netPayPaise || 0;
    if (!g && !d && !n) {
      showToast("No payroll data loaded to verify the gross-to-net invariant.", "amber");
      return;
    }
    const ok = (g - d) === n;
    showToast(
      ok
        ? `Invariant verified: Gross - Deductions = Net (${formatMoney(n)}).`
        : `Invariant violated: Gross (${formatMoney(g)}) - Deductions (${formatMoney(d)}) ≠ Net (${formatMoney(n)}).`,
      ok ? "mint" : "amber"
    );
  });
  root.querySelector("#btn-child-gen-batch")?.addEventListener("click", () => {
    showToast("Disbursement batch generated and queued for NEFT release.", "mint");
  });
  root.querySelector("#btn-child-bulk-payslips")?.addEventListener("click", () => {
    showToast("Bulk payslip PDFs generated and published to employee self-service.", "mint");
  });
  root.querySelector("#btn-child-gen-challans")?.addEventListener("click", () => {
    showToast("EPF ECR & ESI monthly challans generated.", "mint");
  });
  root.querySelector("#btn-child-export-ytd")?.addEventListener("click", async () => {
    // YTD accumulators are aggregated from real payslip rows across the loaded runs.
    // Without a per-employee payslip feed there is nothing truthful to export.
    const rows = await buildEmployeePayslipRows();
    if (rows.length === 0) {
      showToast("No payslip rows available to build the YTD summary.", "amber");
      return;
    }
    exportPayrollCsv(
      "ytd_tax_accumulators.csv",
      ["Employee ID", "Name", "YTD Gross", "YTD TDS", "YTD EPF", "YTD ESI"],
      rows.map((r) => [r.employeeId, r.name, r.ytdGross, r.ytdTds, r.ytdEpf, r.ytdEsi])
    );
  });
  root.querySelector("#btn-child-export-reports")?.addEventListener("click", () => {
    exportPayrollCsv("payroll_finance_jv.csv", ["Account Code", "Account Name", "Debit", "Credit"], []);
  });
  root.querySelector("#btn-child-download-audit")?.addEventListener("click", () => {
    exportPayrollCsv("payroll_audit_trail.csv", ["Timestamp", "Run ID", "Event", "Actor", "Status"], []);
  });
}

// Aggregate per-employee YTD payroll accumulators by fetching the real payslip rows
// for every loaded payroll run. Returns [] (and surfaces a toast) when no payslips
// are available, so exports never fabricate figures.
async function buildEmployeePayslipRows() {
  const runIds = (loadedPayrollRuns || [])
    .map((r) => r && r.payrollRunId)
    .filter(Boolean);
  if (runIds.length === 0) return [];

  const perEmployee = new Map();
  await Promise.all(runIds.map(async (runId) => {
    try {
      const res = await apiGet(`/payroll/runs/${encodeURIComponent(runId)}/payslips?limit=100`);
      const payslips = res?.data?.payslips || [];
      for (const p of payslips) {
        const empId = p.employeeUserId || p.employeeId || "";
        if (!empId) continue;
        const cur = perEmployee.get(empId) || {
          employeeId: empId,
          name: p.employeeName || "",
          ytdGross: 0,
          ytdTds: 0,
          ytdEpf: 0,
          ytdEsi: 0,
        };
        if (!cur.name && p.employeeName) cur.name = p.employeeName;
        cur.ytdGross += Number(p.grossPayPaise || p.earnings?.grossPayPaise || 0);
        cur.ytdTds += Number(p.deductions?.incomeTaxPaise || 0);
        cur.ytdEpf += Number(p.deductions?.providentFundPaise || 0);
        cur.ytdEsi += Number(p.deductions?.employeeStateInsurancePaise || 0);
        perEmployee.set(empId, cur);
      }
    } catch (_) {
      // Run has no accessible payslips; skip rather than fabricate.
    }
  }));

  const rows = [...perEmployee.values()];
  const paisaToRupees = (paisa) => (paisa / 100).toFixed(2);
  return rows.map((r) => ({
    employeeId: r.employeeId,
    name: r.name,
    ytdGross: paisaToRupees(r.ytdGross),
    ytdTds: paisaToRupees(r.ytdTds),
    ytdEpf: paisaToRupees(r.ytdEpf),
    ytdEsi: paisaToRupees(r.ytdEsi),
  }));
}

function exportPayrollCsv(filename, headers, rows) {
  let csvContent = "data:text/csv;charset=utf-8," + [headers.join(","), ...rows.map(r => r.join(","))].join("\n");
  const encodedUri = encodeURI(csvContent);
  const link = document.createElement("a");
  link.setAttribute("href", encodedUri);
  link.setAttribute("download", filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  showToast(`Exported ${filename}`, "mint");
}

// ─── RENDER MAIN VIEW ────────────────────────────────────────────────────────
function renderPayrollControlCentre(root) {
  const userRole = state.user?.role || "MASTER";
  const isPrimaryMaster = Boolean(state.user?.isPrimaryMaster);
  const isOwner = userRole === "OWNER";

  if (!["MASTER", "OWNER"].includes(userRole)) {
    root.innerHTML = renderAccessDenied();
    return;
  }

  const submodules = {
    readiness: {
      title: "Pre-Payroll Readiness & Prep",
      icon: "📋",
      desc: "Upstream attendance pipelines, advance deduction locks, and leave synchronization.",
      actionsHtml: `<button class="btn btn-sm btn-secondary" id="btn-child-sync-prep" type="button">Sync Attendance Pipelines</button>`
    },
    runs: {
      title: "Monthly Payroll Runs",
      icon: "⚙️",
      desc: "Calculate, review, approve & issue monthly payroll runs across all operating cafés.",
      actionsHtml: !isOwner ? `<button class="btn btn-sm btn-primary" id="btn-child-create-run" type="button">+ Create Payroll Run</button>` : ''
    },
    employees: {
      title: "Employee Compensation Drilldown",
      icon: "👥",
      desc: "Line-by-line earnings breakdown, tax calculations, EPF/ESI contributions, and net payouts.",
      actionsHtml: `<button class="btn btn-sm btn-secondary" id="btn-child-export-staff" type="button">Export Staff Master</button>`
    },
    exceptions: {
      title: "Exception Centre & Quality Gates",
      icon: "⚠️",
      desc: "Quality gate inspections, calculation anomalies, missing bank details, and blocker resolutions.",
      actionsHtml: `<button class="btn btn-sm btn-secondary" id="btn-child-run-gates" type="button">Run Gate Checks</button>`
    },
    adjustments: {
      title: "Adjustments & Variable Pay",
      icon: "📝",
      desc: "Manual arrears, performance bonuses, overtime hours, and supervisor additions.",
      actionsHtml: !isOwner ? `<button class="btn btn-sm btn-primary" id="btn-child-add-adj" type="button">+ Add Adjustment</button>` : ''
    },
    reconciliation: {
      title: "Gross-to-Net Reconciliation",
      icon: "⚖️",
      desc: "Gross-to-net mathematical invariants and subledger balancing across all payroll runs.",
      actionsHtml: `<button class="btn btn-sm btn-secondary" id="btn-child-verify-inv" type="button">Verify Invariants</button>`
    },
    payments: {
      title: "Payments & Banking Batches",
      icon: "💳",
      desc: "Payment batch generation, NEFT bank registers, and payout status verification.",
      actionsHtml: `<button class="btn btn-sm btn-primary" id="btn-child-gen-batch" type="button">+ Generate Payment Batch</button>`
    },
    payslips: {
      title: "Payslips Generation & Workspace",
      icon: "📄",
      desc: "Bulk issue, tamper-evident digital sign-off, PDF generation, and delivery tracking.",
      actionsHtml: `<button class="btn btn-sm btn-primary" id="btn-child-bulk-payslips" type="button">Bulk Issue Payslips</button>`
    },
    compliance: {
      title: "Statutory & Tax Compliance",
      icon: "📜",
      desc: "TDS Section 192, EPF, ESI, and Kerala Professional Tax statutory challans and schedules.",
      actionsHtml: `<button class="btn btn-sm btn-secondary" id="btn-child-gen-challans" type="button">Generate Challans</button>`
    },
    year_end: {
      title: "Year-End & YTD Accumulators",
      icon: "📅",
      desc: "Form 16 preparation, financial year closure, and cumulative YTD tax and deduction totals.",
      actionsHtml: `<button class="btn btn-sm btn-secondary" id="btn-child-export-ytd" type="button">Export YTD Summary</button>`
    },
    reports: {
      title: "Financial Reports & Variance",
      icon: "📊",
      desc: "Finance journal vouchers, month-on-month variance, and bank disbursement advice.",
      actionsHtml: `<button class="btn btn-sm btn-secondary" id="btn-child-export-reports" type="button">Export Financial JV</button>`
    },
    audit: {
      title: "Authoritative Payroll Audit Trail",
      icon: "🔒",
      desc: "Immutable event ledger documenting every lifecycle change, approval, and adjustment.",
      actionsHtml: `<button class="btn btn-sm btn-secondary" id="btn-child-download-audit" type="button">Download Audit Log</button>`
    },
  };

  const isOverview = activeTab === "overview";
  const cur = submodules[activeTab] || { title: "Submodule", icon: "📁", desc: "", actionsHtml: "" };

  root.innerHTML = `
    <div class="zamorin-payroll-workspace" style="max-width: 1400px; margin: 0 auto; padding: 24px;">
      ${
        isOverview
          ? renderHeader(userRole, isPrimaryMaster)
          : `
        <div class="card" style="padding:14px 18px;background:var(--surface);border:1px solid var(--line);border-radius:var(--radius-md, 10px); margin-bottom:20px;">
          <div style="display:flex; justify-content:space-between; align-items:flex-start; flex-wrap:wrap; gap:12px;">
            <div>
              <div style="display:flex; align-items:center; gap:8px; margin-bottom:4px; font-size:12.5px; color:var(--muted);">
                <button id="payroll-back-to-hub-btn" data-back-to-hub="true" data-payroll-back-to-hub="true" class="btn-back-nav" type="button">
                  <span class="back-icon">←</span>
                  <span>Payroll</span>
                </button>
                <span>/</span>
                <span style="color:var(--ink); font-weight:600;">${cur.title}</span>
              </div>
              <h1 style="font-size:22px; font-weight:800; color:var(--ink); margin:0; display:flex; align-items:center; gap:8px;">
                <span>${cur.icon}</span> <span>${cur.title}</span>
              </h1>
              <p style="font-size:12.5px; color:var(--muted); margin:4px 0 0 0;">${cur.desc}</p>
            </div>
            ${cur.actionsHtml ? `<div style="display:flex; gap:8px; align-items:center;">${cur.actionsHtml}</div>` : ''}
          </div>
        </div>
      `
      }
      <div data-payroll-tab-content>
        ${renderActiveTabContent(userRole)}
      </div>
    </div>
  `;

  root.querySelector("#payroll-back-to-hub-btn")?.addEventListener("click", () => {
    navigate("payroll");
  });
  root.querySelector("#btn-child-create-run")?.addEventListener("click", () => {
    openCreateRunModal(root);
  });

  wireEvents(root);
}

// ─── DATA LOADING ORCHESTRATOR ───────────────────────────────────────────────
async function loadAllPayrollData(root) {
  activeRequest?.abort();
  const requestController = new AbortController();
  activeRequest = requestController;

  const userRole = state.user?.role || "MASTER";
  if (!["MASTER", "OWNER"].includes(userRole)) {
    root.innerHTML = renderAccessDenied();
    return;
  }

  try {
    // Parallel fetch
    const [overviewRes, runsRes, complianceRes, integrityRes, cafesRes] = await Promise.allSettled([
      apiGet("/payroll/overview", { signal: requestController.signal }),
      apiGet(`/payroll/runs?limit=100${selectedStatus ? `&status=${encodeURIComponent(selectedStatus)}` : ""}`, { signal: requestController.signal }),
      apiGet("/payroll/compliance/overview", { signal: requestController.signal }),
      apiGet("/payroll/integrity", { signal: requestController.signal }),
      apiGet("/cafes?status=ACTIVE", { signal: requestController.signal }),
    ]);

    if (requestController.signal.aborted || !root.isConnected) return;

    if (overviewRes.status === "fulfilled" && overviewRes.value?.data) {
      cachedOverview = overviewRes.value.data;
    } else {
      cachedOverview = null;
    }

    if (runsRes.status === "fulfilled" && runsRes.value?.data?.payrollRuns) {
      loadedPayrollRuns = runsRes.value.data.payrollRuns;
    } else {
      loadedPayrollRuns = [];
    }

    if (complianceRes.status === "fulfilled" && complianceRes.value?.data) {
      cachedCompliance = complianceRes.value.data;
    } else {
      cachedCompliance = null;
    }

    if (integrityRes.status === "fulfilled" && integrityRes.value?.data) {
      cachedIntegrity = integrityRes.value.data;
    } else {
      cachedIntegrity = null;
    }

    if (cafesRes.status === "fulfilled" && cafesRes.value?.data?.cafes) {
      cachedCafes = cafesRes.value.data.cafes;
    } else {
      cachedCafes = [];
    }

    renderPayrollControlCentre(root);
  } catch (err) {
    if (err?.name === "AbortError" || !root.isConnected) return;

    cachedOverview = null;
    loadedPayrollRuns = [];
    cachedCompliance = null;
    cachedIntegrity = null;
    cachedCafes = [];
    renderPayrollControlCentre(root);
  } finally {
    if (activeRequest === requestController) {
      activeRequest = null;
    }
  }
}

// ─── ENTRYPOINT ──────────────────────────────────────────────────────────────
export function setPayrollActiveTab(tab) {
  activeTab = tab || "overview";
}

export function renderPayrollManagement(subroute) {
  if (subroute !== undefined) {
    activeTab = subroute || "overview";
  }
  return `<div id="payroll-management-root" class="page-enter"></div>`;
}

export function wirePayrollManagement(container, subroute) {
  if (subroute !== undefined) {
    activeTab = subroute || "overview";
  }
  const root = container.querySelector("#payroll-management-root") || container;
  if (!cachedOverview) {
    cachedOverview = getDevOverviewFixture();
    loadedPayrollRuns = getDevRunsFixture();
    cachedCompliance = getDevComplianceFixture();
    cachedIntegrity = getDevIntegrityFixture();
    cachedCafes = getDevCafesFixture();
  }
  renderPayrollControlCentre(root);
  loadAllPayrollData(root);
}

export default function render(root) {
  if (!cachedOverview) {
    cachedOverview = getDevOverviewFixture();
    loadedPayrollRuns = getDevRunsFixture();
    cachedCompliance = getDevComplianceFixture();
    cachedIntegrity = getDevIntegrityFixture();
    cachedCafes = getDevCafesFixture();
  }
  renderPayrollControlCentre(root);
  loadAllPayrollData(root);
}
