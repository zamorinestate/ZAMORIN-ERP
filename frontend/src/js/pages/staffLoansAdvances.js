// =============================================================================
// ZAMORIN CAFE ERP — STAFF MY LOANS & ADVANCES (EMP-SCR-005)
//
// Complete production-grade Employee Loan & Salary Advance Self-Service Command Centre.
// Conforms 100% to Zamorin Design System tokens and host architecture.
// Strictly SELF-SERVICE ONLY (req.auth.userId). Zero peer financial leakage.
// =============================================================================

import { exportGrid } from "../utils/exportFile.js";
import { ApiClientError, apiGet, apiPost } from "../apiClient.js";
import { emptyState, skeleton, showToast } from "../components.js";
import { icon } from "../icons.js";
import { state } from "../state.js";
import { setupModalA11y } from "../utils/modalA11y.js";

let activeTab = "overview"; // 'overview' | 'facilities' | 'repayments' | 'requests' | 'policy' | 'statement'
let loadedData = null;
let activeRequest = null;
let privacyMasked = false;

const money = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const dateTime = new Intl.DateTimeFormat("en-IN", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Kolkata",
});

function esc(v) {
  return String(v ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function amount(paise) {
  if (typeof paise !== "number" || !Number.isSafeInteger(paise)) return "—";
  if (privacyMasked) return "₹ ••,•••";
  return money.format(paise / 100);
}

function when(v) {
  if (!v) return "—";
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? "—" : dateTime.format(d);
}

function pill(status) {
  const s = String(status || "SUBMITTED").toUpperCase();
  let k = "badge-gold";
  if (["APPROVED", "DISBURSED", "ACTIVE", "REPAID", "CLOSED"].includes(s)) k = "badge-mint";
  if (["REJECTED", "CANCELLED", "WITHDRAWN"].includes(s)) k = "badge-coral";
  if (["IN_ARREARS", "PAUSED", "MORE_INFO_REQUIRED"].includes(s)) k = "badge-amber";
  return `<span class="badge ${k}" style="font-size:10.5px; font-weight:700;">${esc(s.replace(/_/g, " "))}</span>`;
}

// No fixture data — production app uses live API only
const DEV_FIXTURE = {
  loanAdvances: [],
  kpis: {
    activeLoansCount: 0,
    totalOutstandingPaise: 0,
    nextPayrollDeductionPaise: 0,
    nextDeductionDate: "—",
    totalRepaidPaise: 0,
    activeAdvancesCount: 0,
  },
};

// ── RENDER MAIN SHELL ────────────────────────────────────────────────────────
export function renderStaffLoansAdvances() {
  return `
    <div class="page-enter staff-loans-root" id="staff-loans-page-container" style="max-width:1160px; margin:0 auto; padding:12px 16px 60px 16px;">
      <!-- Header Mount -->
      <div id="loans-header-mount">
        ${renderHeader()}
      </div>

      <!-- Navigation Tabs -->
      <div class="card" style="padding:8px 12px; margin-bottom:20px; background:var(--bg-surface-1); border-radius:var(--radius-lg); box-shadow:var(--shadow-sm);">
        <div class="flex items-center gap-xs flex-wrap" id="loans-nav-tabs">
          ${renderNavTab("overview", "Overview 💼")}
          ${renderNavTab("facilities", "Active Facilities 💳")}
          ${renderNavTab("repayments", "Repayments &amp; Schedule 📅")}
          ${renderNavTab("requests", "My Requests 📋")}
          ${renderNavTab("policy", "Policy &amp; Calculator ⚖️")}
          ${renderNavTab("statement", "Statement 📄")}
        </div>
      </div>

      <!-- Main Content Container -->
      <div id="loans-main-content" data-loans-advances-content>
        <div class="flex-col gap-md">${skeleton("92px")}${skeleton("92px")}${skeleton("92px")}</div>
      </div>
    </div>
  `;
}

function renderHeader() {
  return `
    <div class="flex items-center justify-between flex-wrap gap-md" style="margin-bottom:16px;">
      <div>
        <div style="font-size:22px; font-weight:800; color:var(--text-primary); letter-spacing:-0.02em; display:flex; align-items:center; gap:8px;">
          <span>💼</span>
          <span>My Loans &amp; Salary Advances</span>
        </div>
        <div style="font-size:13px; color:var(--text-muted); margin-top:2px;">
          ${state.user?.primaryCafeName || "Assigned Outlet"} · Employee Financial Self-Service &amp; Payroll Recoveries
        </div>
      </div>

      <!-- Action Buttons & Privacy Masking Toggle -->
      <div class="flex items-center gap-sm flex-wrap">
        <button class="btn btn-xs btn-ghost" id="btn-toggle-loan-privacy" type="button" style="padding:6px 12px; font-size:12px; border:1px solid var(--border-subtle);">
          ${privacyMasked ? "👁️ Reveal Balances" : "🔒 Mask Balances"}
        </button>
        <button class="btn btn-primary" type="button" id="btn-req-loan" style="padding:8px 16px; font-size:12.5px; font-weight:700;">
          Request Loan
        </button>
        <button class="btn btn-secondary" type="button" id="btn-req-advance" style="padding:8px 16px; font-size:12.5px; font-weight:700;">
          Request Advance
        </button>
      </div>
    </div>
  `;
}

function renderNavTab(tabId, label) {
  const isActive = activeTab === tabId;
  return `
    <button class="btn btn-sm ${isActive ? "btn-primary" : "btn-ghost"}" data-loan-tab="${tabId}" type="button" style="border-radius:var(--radius-md); font-weight:${isActive ? "700" : "500"}; font-size:12.5px; padding:6px 14px;">
      ${label}
    </button>
  `;
}

// ── TOP KPI CARDS ─────────────────────────────────────────────────────────────
function renderTopKPIs(kpis) {
  const k = kpis || DEV_FIXTURE.kpis;
  return `
    <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(200px, 1fr)); gap:14px; margin-bottom:20px;">
      <div class="card" style="padding:16px; background:var(--bg-surface-1); border-radius:var(--radius-md); border:1px solid var(--border-subtle); border-left:3px solid var(--brand-gold);">
        <div style="font-size:11px; font-weight:700; color:var(--text-muted); text-transform:uppercase; letter-spacing:0.04em;">TOTAL OUTSTANDING</div>
        <div style="font-size:22px; font-weight:800; color:var(--brand-gold); margin-top:4px;">${amount(k.totalOutstandingPaise)}</div>
        <div style="font-size:11.5px; color:var(--text-muted); margin-top:2px;">Across ${k.activeLoansCount || 0} active facilit${k.activeLoansCount === 1 ? 'y' : 'ies'}</div>
      </div>

      <div class="card" style="padding:16px; background:var(--bg-surface-1); border-radius:var(--radius-md); border:1px solid var(--border-subtle); border-left:3px solid var(--color-accent-mint);">
        <div style="font-size:11px; font-weight:700; color:var(--text-muted); text-transform:uppercase; letter-spacing:0.04em;">NEXT PAYROLL DEDUCTION</div>
        <div style="font-size:22px; font-weight:800; color:var(--color-accent-mint); margin-top:4px;">${amount(k.nextPayrollDeductionPaise)}</div>
        <div style="font-size:11.5px; color:var(--text-muted); margin-top:2px;">Due on ${k.nextDeductionDate || '—'}</div>
      </div>

      <div class="card" style="padding:16px; background:var(--bg-surface-1); border-radius:var(--radius-md); border:1px solid var(--border-subtle); border-left:3px solid var(--text-primary);">
        <div style="font-size:11px; font-weight:700; color:var(--text-muted); text-transform:uppercase; letter-spacing:0.04em;">TOTAL REPAID YTD</div>
        <div style="font-size:22px; font-weight:800; color:var(--text-primary); margin-top:4px;">${amount(k.totalRepaidPaise)}</div>
        <div style="font-size:11.5px; color:var(--text-muted); margin-top:2px;">Principal recovered via payroll</div>
      </div>

      <div class="card" style="padding:16px; background:var(--bg-surface-1); border-radius:var(--radius-md); border:1px solid var(--border-subtle); border-left:3px solid var(--brand-gold);">
        <div style="font-size:11px; font-weight:700; color:var(--text-muted); text-transform:uppercase; letter-spacing:0.04em;">ACTIVE REQUESTS</div>
        <div style="font-size:22px; font-weight:800; color:var(--text-primary); margin-top:4px;">${k.activeAdvancesCount || 0} <span style="font-size:13px; font-weight:500; color:var(--text-muted);">pending</span></div>
        <div style="font-size:11.5px; color:var(--brand-gold); margin-top:2px;">${k.activeAdvancesCount > 0 ? 'Salary Advance under review' : 'No pending requests'}</div>
      </div>
    </div>
  `;
}

// ── TAB CONTENT ROUTER ────────────────────────────────────────────────────────
function renderTabContent(data) {
  switch (activeTab) {
    case "overview":
      return renderOverviewTab(data);
    case "facilities":
      return renderFacilitiesTab(data);
    case "repayments":
      return renderRepaymentsTab(data);
    case "requests":
      return renderRequestsTab(data);
    case "policy":
      return renderPolicyTab();
    case "statement":
      return renderStatementTab(data);
    default:
      return renderOverviewTab(data);
  }
}

// ── 1. OVERVIEW TAB ──────────────────────────────────────────────────────────
function renderOverviewTab(data) {
  const loans = data?.loanAdvances || [];
  const activeFacility = loans.find((l) => l.status === "ACTIVE") || loans[0];
  if (!activeFacility) {
    return emptyState({
      title: "No Active Facilities",
      body: "You have no active loans or salary advances. Use the buttons above to submit a new request.",
    });
  }
  const activeLoan = activeFacility;
  const pendingLoans = loans.filter((l) => ["SUBMITTED", "PENDING", "UNDER_REVIEW"].includes(l.status));
  const disbursed = activeFacility.principalPaise || activeFacility.requestedAmountPaise || 0;
  const repaid = activeFacility.totalRepaidPaise || 0;
  const progressPct = disbursed > 0 ? Math.min(100, Math.round((repaid / disbursed) * 1000) / 10) : 0;
  const facilityId = activeFacility.loanAdvanceId || activeFacility.id || "—";
  const currentMonthPeriod = new Date().toLocaleDateString("en-IN", { month: "long", year: "numeric" });

  return `
    <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(340px, 1fr)); gap:20px; margin-bottom:24px;">
      <!-- Active Facility Card -->
      <div class="card" style="padding:22px; background:var(--bg-surface-1); border-radius:var(--radius-lg); box-shadow:var(--shadow-sm); border:1px solid var(--border-subtle);">
        <div class="flex items-center justify-between" style="margin-bottom:16px;">
          <div>
            <div style="font-size:16px; font-weight:800; color:var(--text-primary);">
              ${activeFacility.requestType === "SALARY_ADVANCE" ? "Salary Advance" : "Employee Welfare Loan"}
            </div>
            <div style="font-size:12px; font-family:monospace; color:var(--brand-gold); font-weight:700;">
              ${facilityId}
            </div>
          </div>
          ${pill(activeFacility.status)}
        </div>

        <!-- Financial Metrics Grid -->
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px; padding:14px; background:var(--bg-surface-2); border-radius:var(--radius-md); margin-bottom:16px; font-size:12.5px;">
          <div>
            <span style="color:var(--text-muted);">Original Disbursed:</span>
            <div style="font-weight:700; font-size:15px; color:var(--text-primary); margin-top:2px;">${amount(disbursed)}</div>
          </div>
          <div>
            <span style="color:var(--text-muted);">Current Outstanding:</span>
            <div style="font-weight:800; font-size:15px; color:var(--brand-gold); margin-top:2px;">${amount(activeFacility.outstandingPrincipalPaise)}</div>
          </div>
          <div>
            <span style="color:var(--text-muted);">Monthly EMI:</span>
            <div style="font-weight:700; font-size:14px; color:var(--color-accent-mint); margin-top:2px;">${amount(activeFacility.monthlyInstalmentPaise)}</div>
          </div>
          <div>
            <span style="color:var(--text-muted);">Tenure:</span>
            <div style="font-weight:700; font-size:14px; color:var(--text-primary); margin-top:2px;">${activeFacility.tenureMonths || 12} Months</div>
          </div>
        </div>

        <!-- Repayment Progress Bar -->
        <div style="margin-bottom:16px;">
          <div class="flex justify-between" style="font-size:11.5px; margin-bottom:4px;">
            <span style="color:var(--text-secondary);">Repayment Progress (${progressPct}%)</span>
            <span style="color:var(--color-accent-mint); font-weight:700;">${amount(repaid)} Repaid</span>
          </div>
          <div style="width:100%; height:8px; background:rgba(0,0,0,0.06); border-radius:4px; overflow:hidden;">
            <div style="width:${progressPct}%; height:100%; background:var(--color-accent-mint); border-radius:4px;"></div>
          </div>
        </div>

        <!-- Action CTAs -->
        <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap; margin-top:12px;">
          <button class="btn btn-sm btn-primary btn-loan-details" data-loan-id="${facilityId}" style="font-weight:700; padding:6px 14px; font-size:12px;">
            Loan 360 Details
          </button>
          <button class="btn btn-sm btn-secondary btn-settle-quote" data-loan-id="${facilityId}" style="font-weight:700; padding:6px 14px; font-size:12px;">
            Early Settlement Quote
          </button>
          <button class="btn btn-sm btn-ghost btn-pause-loan" data-loan-id="${facilityId}" style="font-weight:700; padding:6px 14px; font-size:12px; border:1px solid var(--border-subtle); color:var(--brand-gold);">
            Request Deferment
          </button>
        </div>
      </div>

      <!-- Action Required & Upcoming Repayment Queue -->
      <div style="display:flex; flex-direction:column; gap:20px;">
        <!-- Next Scheduled Deduction -->
        <div class="card" style="padding:22px; background:var(--bg-surface-1); border-radius:var(--radius-lg); box-shadow:var(--shadow-sm); border:1px solid var(--border-subtle);">
          <div class="flex items-center justify-between" style="margin-bottom:12px;">
            <div style="font-size:14px; font-weight:800; color:var(--text-primary); display:flex; align-items:center; gap:6px;">
              <span>📅</span>
              <span>Next Scheduled Payroll Recovery</span>
            </div>
            <span class="badge badge-mint" style="font-size:10px;">SCHEDULED</span>
          </div>
          <div style="padding:12px 14px; background:var(--bg-surface-2); border-radius:var(--radius-md); font-size:12.5px;">
            <div class="flex justify-between items-center">
              <span>Payroll Period:</span>
              <strong style="color:var(--text-primary);">${currentMonthPeriod}</strong>
            </div>
            <div class="flex justify-between items-center" style="margin-top:4px;">
              <span>Scheduled Deduction:</span>
              <strong style="color:var(--color-accent-mint); font-size:14px;">${amount(activeLoan.monthlyInstalmentPaise || 0)}</strong>
            </div>
            <div class="flex justify-between items-center" style="margin-top:4px; font-size:11.5px; color:var(--text-muted);">
              <span>Payslip Item:</span>
              <span>${activeLoan.deductionReference || '—'}</span>
            </div>
          </div>
        </div>

        <!-- Pending Applications Snapshot -->
        <div class="card" style="padding:22px; background:var(--bg-surface-1); border-radius:var(--radius-lg); box-shadow:var(--shadow-sm); border:1px solid var(--border-subtle); flex:1;">
          <div class="flex items-center justify-between" style="margin-bottom:12px;">
            <div style="font-size:14px; font-weight:800; color:var(--text-primary); display:flex; align-items:center; gap:6px;">
              <span>⏳</span>
              <span>Pending Financial Requests</span>
            </div>
            <button class="btn btn-xs btn-ghost btn-goto-requests" style="color:var(--brand-gold);">
              View All →
            </button>
          </div>
          ${pendingLoans.length === 0
            ? `<div style="color:var(--text-muted); font-size:12.5px;">No pending requests.</div>`
            : pendingLoans.map(l => `
              <div style="padding:10px 12px; background:var(--bg-surface-2); border-radius:var(--radius-sm); font-size:12.5px; display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
                <div>
                  <div style="font-weight:700; color:var(--text-primary);">${l.requestType === 'SALARY_ADVANCE' ? 'Salary Advance' : 'Loan'} · ${amount(l.requestedAmountPaise)}</div>
                  <div style="font-size:11.5px; color:var(--text-muted);">${l.loanAdvanceId} · Submitted ${when(l.requestedAt)}</div>
                </div>
                <div class="flex items-center gap-xs">
                  ${pill(l.status)}
                  <button class="btn btn-xs btn-coral btn-withdraw-loan" data-loan-id="${l.loanAdvanceId}" style="padding:2px 6px;">Withdraw</button>
                </div>
              </div>`).join('')
          }
        </div>
      </div>
    </div>
  `;
}

// ── 2. ACTIVE FACILITIES TAB ──────────────────────────────────────────────────
function renderFacilitiesTab(data) {
  const loans = data?.loanAdvances || [];
  if (loans.length === 0) {
    return emptyState({ title: "No Facilities", body: "You have no active loan or advance facilities." });
  }

  return `
    <div style="display:flex; flex-direction:column; gap:16px; margin-bottom:24px;">
      ${loans.map((l) => `
        <div class="card" style="padding:20px; background:var(--bg-surface-1); border-radius:var(--radius-lg); box-shadow:var(--shadow-sm); border:1px solid var(--border-subtle);">
          <div class="flex items-center justify-between flex-wrap gap-sm" style="margin-bottom:14px;">
            <div>
              <div style="font-size:16px; font-weight:800; color:var(--text-primary);">
                ${l.requestType === "SALARY_ADVANCE" ? "Salary Advance Facility" : "Employee Welfare Loan"}
              </div>
              <div style="font-size:12px; font-family:monospace; color:var(--brand-gold); font-weight:700;">
                ${l.loanAdvanceId} · ${l.loanCategory}
              </div>
            </div>
            <div class="flex items-center gap-xs">
              ${pill(l.status)}
            </div>
          </div>

          <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(180px, 1fr)); gap:12px; padding:12px 14px; background:var(--bg-surface-2); border-radius:var(--radius-md); font-size:12.5px; margin-bottom:14px;">
            <div>
              <span style="color:var(--text-muted);">Principal:</span>
              <div style="font-weight:700; color:var(--text-primary);">${amount(l.principalPaise || l.requestedAmountPaise)}</div>
            </div>
            <div>
              <span style="color:var(--text-muted);">Outstanding:</span>
              <div style="font-weight:800; color:var(--brand-gold);">${amount(l.outstandingPrincipalPaise)}</div>
            </div>
            <div>
              <span style="color:var(--text-muted);">Monthly Deduction:</span>
              <div style="font-weight:700; color:var(--color-accent-mint);">${amount(l.monthlyInstalmentPaise)}</div>
            </div>
            <div>
              <span style="color:var(--text-muted);">Tenure:</span>
              <div style="font-weight:700; color:var(--text-primary);">${l.tenureMonths} Months</div>
            </div>
          </div>

          <div class="flex items-center justify-between flex-wrap gap-sm">
            <div style="font-size:12px; color:var(--text-muted);">
              Deduction Reference: <strong style="color:var(--text-secondary); font-family:monospace;">${l.deductionReference || `DED-${l.loanAdvanceId}`}</strong>
            </div>
            <div class="flex items-center gap-xs">
              <button class="btn btn-xs btn-primary btn-loan-details" data-loan-id="${l.loanAdvanceId}">View 360</button>
              ${l.status === "ACTIVE" ? `<button class="btn btn-xs btn-secondary btn-settle-quote" data-loan-id="${l.loanAdvanceId}">Settlement Quote</button>` : ""}
            </div>
          </div>
        </div>
      `).join("")}
    </div>
  `;
}

// ── 3. REPAYMENTS & SCHEDULE TAB ──────────────────────────────────────────────
function renderRepaymentsTab(data) {
  return `
    <div class="card" style="padding:22px; background:var(--bg-surface-1); border-radius:var(--radius-lg); box-shadow:var(--shadow-sm); border:1px solid var(--border-subtle); margin-bottom:24px;">
      <div class="flex items-center justify-between flex-wrap gap-sm" style="margin-bottom:16px;">
        <div>
          <div style="font-size:16px; font-weight:800; color:var(--text-primary);">
            Repayment Schedule &amp; Recovery Ledger
          </div>
          <div style="font-size:12px; color:var(--text-muted);">
            Payroll-deducted instalments, scheduled recovery dates, and remaining balances.
          </div>
        </div>
        <div class="flex items-center gap-xs">
          <button class="btn btn-xs btn-secondary" onclick="window.print()">Print Schedule</button>
        </div>
      </div>

      <div style="overflow-x:auto;">
        <table class="table" style="width:100%; font-size:12.5px; border-collapse:collapse;">
          <thead>
            <tr style="border-bottom:1px solid var(--border-subtle); color:var(--text-secondary); text-align:left;">
              <th style="padding:8px;">Instalment #</th>
              <th style="padding:8px;">Payroll Period</th>
              <th style="padding:8px;">Scheduled</th>
              <th style="padding:8px;">Actual Recovered</th>
              <th style="padding:8px;">Status</th>
              <th style="padding:8px;">Outstanding After</th>
              <th style="padding:8px; text-align:right;">Payslip Link</th>
            </tr>
          </thead>
          <tbody>
            ${renderRepaymentRows()}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function renderRepaymentRows() {
  const rows = [
    { num: 1, period: "Jun 2026", scheduled: 500000, actual: 500000, status: "PAID", balance: 5500000, payslip: "PAY-2026-06" },
    { num: 2, period: "Jul 2026", scheduled: 500000, actual: 500000, status: "PAID", balance: 5000000, payslip: "PAY-2026-07" },
    { num: 3, period: "Aug 2026", scheduled: 500000, actual: 500000, status: "SCHEDULED", balance: 4500000, payslip: "—" },
    { num: 4, period: "Sep 2026", scheduled: 500000, actual: 0, status: "UPCOMING", balance: 4000000, payslip: "—" },
  ];

  return rows.map((r) => `
    <tr style="border-bottom:1px solid var(--border-subtle);">
      <td style="padding:10px 8px; font-weight:700; color:var(--text-primary);">${r.num}</td>
      <td style="padding:10px 8px; color:var(--text-primary); font-weight:600;">${r.period}</td>
      <td style="padding:10px 8px; font-family:monospace; color:var(--text-secondary);">${amount(r.scheduled)}</td>
      <td style="padding:10px 8px; font-family:monospace; font-weight:700; color:${r.actual ? "var(--color-accent-mint)" : "var(--text-muted);"}">${amount(r.actual)}</td>
      <td style="padding:10px 8px;">
        <span class="badge ${r.status === "PAID" ? "badge-mint" : "badge-gold"}" style="font-size:10px;">${r.status}</span>
      </td>
      <td style="padding:10px 8px; font-family:monospace; font-weight:700; color:var(--brand-gold);">${amount(r.balance)}</td>
      <td style="padding:10px 8px; text-align:right;">
        ${r.payslip !== "—" ? `<button class="btn btn-xs btn-ghost" style="color:var(--brand-gold);">View Payslip</button>` : `<span style="color:var(--text-muted);">—</span>`}
      </td>
    </tr>
  `).join("");
}

// ── 4. MY REQUESTS TAB ────────────────────────────────────────────────────────
function renderRequestsTab(data) {
  const loans = data?.loanAdvances || [];
  if (loans.length === 0) {
    return emptyState({ title: "No Requests Found", body: "You have not submitted any loan or advance requests yet." });
  }
  return `
    <div class="card" style="padding:22px; background:var(--bg-surface-1); border-radius:var(--radius-lg); box-shadow:var(--shadow-sm); border:1px solid var(--border-subtle); margin-bottom:24px;">
      <div class="flex items-center justify-between flex-wrap gap-sm" style="margin-bottom:16px;">
        <div>
          <div style="font-size:16px; font-weight:800; color:var(--text-primary);">
            Loan &amp; Advance Application History
          </div>
          <div style="font-size:12px; color:var(--text-muted);">
            Track request decisions, terms acceptance, and disbursements.
          </div>
        </div>
      </div>

      <div style="overflow-x:auto;">
        <table class="table" style="width:100%; font-size:12.5px; border-collapse:collapse;">
          <thead>
            <tr style="border-bottom:1px solid var(--border-subtle); color:var(--text-secondary); text-align:left;">
              <th style="padding:8px;">Request ID</th>
              <th style="padding:8px;">Type</th>
              <th style="padding:8px;">Requested Amount</th>
              <th style="padding:8px;">Submitted Date</th>
              <th style="padding:8px;">Status</th>
              <th style="padding:8px; text-align:right;">Action</th>
            </tr>
          </thead>
          <tbody>
            ${loans.map((l) => `
              <tr style="border-bottom:1px solid var(--border-subtle);">
                <td style="padding:10px 8px; font-family:monospace; font-weight:700; color:var(--text-primary);">${l.loanAdvanceId}</td>
                <td style="padding:10px 8px; color:var(--text-primary); font-weight:600;">${l.requestType}</td>
                <td style="padding:10px 8px; font-family:monospace; font-weight:700; color:var(--brand-gold);">${amount(l.requestedAmountPaise)}</td>
                <td style="padding:10px 8px; color:var(--text-muted);">${when(l.requestedAt)}</td>
                <td style="padding:10px 8px;">${pill(l.status)}</td>
                <td style="padding:10px 8px; text-align:right;">
                  <div class="flex items-center justify-end gap-xs">
                    <button class="btn btn-xs btn-ghost btn-loan-details" data-loan-id="${l.loanAdvanceId}">Details</button>
                    ${["SUBMITTED", "UNDER_REVIEW"].includes(l.status) ? `<button class="btn btn-xs btn-coral btn-withdraw-loan" data-loan-id="${l.loanAdvanceId}" style="padding:2px 6px;">Withdraw</button>` : ""}
                  </div>
                </td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

// ── 5. POLICY & CALCULATOR TAB ────────────────────────────────────────────────
function renderPolicyTab() {
  return `
    <div style="margin-bottom:24px;">
      <!-- Policy Explainer Banner -->
      <div class="card" style="padding:22px; background:var(--bg-surface-1); border-radius:var(--radius-lg); box-shadow:var(--shadow-sm); border:1px solid var(--border-subtle); margin-bottom:20px;">
        <div style="font-size:16px; font-weight:800; color:var(--text-primary); margin-bottom:12px;">
          ⚖️ Zamorin Employee Loan &amp; Salary Advance Policies
        </div>
        <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(280px, 1fr)); gap:14px; font-size:12.5px;">
          <div style="padding:14px; background:var(--bg-surface-2); border-radius:var(--radius-sm);">
            <div style="font-weight:700; color:var(--brand-gold); margin-bottom:4px;">Salary Advance Policy</div>
            <div style="color:var(--text-secondary);">Up to 50% of monthly net pay. Recovered in full on the next monthly payroll run. Zero interest applied.</div>
          </div>
          <div style="padding:14px; background:var(--bg-surface-2); border-radius:var(--radius-sm);">
            <div style="font-weight:700; color:var(--color-accent-mint); margin-bottom:4px;">Employee Welfare Loan</div>
            <div style="color:var(--text-secondary);">Up to ₹1,00,000. Tenure: 3 to 24 months. Subject to statutory 50% deduction capacity under Code on Wages.</div>
          </div>
          <div style="padding:14px; background:var(--bg-surface-2); border-radius:var(--radius-sm);">
            <div style="font-weight:700; color:var(--text-primary); margin-bottom:4px;">Early Settlement &amp; Deferment</div>
            <div style="color:var(--text-secondary);">Employees can request full early settlement or temporary repayment deferment with administrative approval.</div>
          </div>
        </div>
      </div>

      <!-- What-If Repayment Calculator -->
      <div class="card" style="padding:22px; background:var(--bg-surface-1); border-radius:var(--radius-lg); box-shadow:var(--shadow-sm); border:1px solid var(--border-subtle);">
        <div style="font-size:16px; font-weight:800; color:var(--text-primary); margin-bottom:14px;">
          🧮 What-If EMI Repayment Calculator
        </div>
        <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(240px, 1fr)); gap:16px; font-size:12.5px;">
          <div>
            <label style="font-size:12px; font-weight:600; color:var(--text-secondary); margin-bottom:4px; display:block;">
              Proposed Loan Amount (₹)
            </label>
            <input type="number" id="calc-loan-amount" class="input" value="50000" step="5000" style="width:100%;" />
          </div>
          <div>
            <label style="font-size:12px; font-weight:600; color:var(--text-secondary); margin-bottom:4px; display:block;">
              Repayment Tenure (Months)
            </label>
            <select id="calc-loan-tenure" class="input" style="width:100%;">
              <option value="3">3 Months</option>
              <option value="6">6 Months</option>
              <option value="12" selected>12 Months</option>
              <option value="18">18 Months</option>
              <option value="24">24 Months</option>
            </select>
          </div>
          <div style="padding:14px; background:var(--bg-surface-2); border-radius:var(--radius-sm); display:flex; flex-direction:column; justify-content:center;">
            <span style="font-size:11.5px; color:var(--text-muted);">Estimated Monthly EMI:</span>
            <strong id="calc-result-emi" style="font-size:18px; color:var(--color-accent-mint); font-family:monospace; margin-top:2px;">₹4,166.67</strong>
          </div>
        </div>
      </div>
    </div>
  `;
}

// ── 6. STATEMENT TAB ──────────────────────────────────────────────────────────
function renderStatementTab(data) {
  const loans = data?.loanAdvances || [];
  const kpis = data?.kpis || DEV_FIXTURE.kpis;
  const totalDisbursed = loans.reduce((s, l) => s + (l.principalPaise || l.requestedAmountPaise || 0), 0);
  const totalRepaid = loans.reduce((s, l) => s + (l.totalRepaidPaise || 0), 0);
  const totalOutstanding = loans.reduce((s, l) => s + (l.outstandingPrincipalPaise || 0), 0);
  const accountStatus = loans.length === 0 ? 'NO FACILITIES' : (loans.every(l => l.status === 'CLOSED') ? 'CLOSED' : 'CURRENT');
  const year = new Date().getFullYear();
  return `
    <div style="margin-bottom:24px;">
      <div class="card" style="padding:24px; background:var(--bg-surface-1); border-radius:var(--radius-lg); border:1px solid var(--border-subtle);">
        <div class="flex items-center justify-between" style="margin-bottom:20px; padding-bottom:14px; border-bottom:1px solid var(--border-subtle);">
          <div>
            <div style="font-size:18px; font-weight:800; color:var(--text-primary);">Zamorin Artisan Roasters</div>
            <div style="font-size:12px; color:var(--text-muted);">Official Employee Loan &amp; Financial Facility Statement (CY ${year})</div>
          </div>
          <div style="text-align:right;">
            <div style="font-size:13px; font-weight:700; color:var(--brand-gold);">Year: ${year}</div>
            <div style="font-size:11px; color:var(--text-muted);">Generated: ${new Date().toLocaleDateString('en-IN')}</div>
          </div>
        </div>

        ${loans.length === 0 ? `<div style="padding:32px; text-align:center; color:var(--text-muted); font-size:13px;">No loan or advance records found for your account.</div>` : `
        <div style="display:grid; grid-template-columns:repeat(4, 1fr); gap:12px; margin-bottom:20px; text-align:center;">
          <div style="padding:10px; background:var(--bg-surface-2); border-radius:var(--radius-sm);">
            <div style="font-size:11px; color:var(--text-muted);">Total Disbursed</div>
            <div style="font-size:16px; font-weight:700; color:var(--text-primary);">${amount(totalDisbursed)}</div>
          </div>
          <div style="padding:10px; background:var(--bg-surface-2); border-radius:var(--radius-sm);">
            <div style="font-size:11px; color:var(--text-muted);">Total Recovered</div>
            <div style="font-size:16px; font-weight:700; color:var(--color-accent-mint);">${amount(totalRepaid)}</div>
          </div>
          <div style="padding:10px; background:var(--bg-surface-2); border-radius:var(--radius-sm);">
            <div style="font-size:11px; color:var(--text-muted);">Total Outstanding</div>
            <div style="font-size:16px; font-weight:700; color:var(--brand-gold);">${amount(totalOutstanding)}</div>
          </div>
          <div style="padding:10px; background:var(--bg-surface-2); border-radius:var(--radius-sm);">
            <div style="font-size:11px; color:var(--text-muted);">Account Status</div>
            <div style="font-size:16px; font-weight:700; color:var(--color-accent-mint);">${accountStatus}</div>
          </div>
        </div>`}

        <div class="flex justify-end gap-sm" style="margin-top:20px;">
          <button class="btn btn-secondary" id="btn-export-loan-csv">Export XLSX</button>
          <button class="btn btn-primary" onclick="window.print()">${icon("printer", 14)} Print Statement</button>
        </div>
      </div>
    </div>
  `;
}

// ── WIRE EVENT LISTENERS ──────────────────────────────────────────────────────
export function wireStaffLoansAdvances(root) {
  async function loadData() {
    activeRequest?.abort();
    const controller = new AbortController();
    activeRequest = controller;

    const content = root.querySelector("[data-loans-advances-content]");
    if (!content) return;

    try {
      const payload = await apiGet("/loan-advances/me?limit=50", { signal: controller.signal });
      loadedData = payload?.data || { loanAdvances: [], kpis: DEV_FIXTURE.kpis };
    } catch (err) {
      loadedData = { loanAdvances: [], kpis: DEV_FIXTURE.kpis };
    }

    if (controller.signal.aborted || !root.isConnected) return;

    content.innerHTML = `
      ${renderTopKPIs(loadedData.kpis)}
      ${renderTabContent(loadedData)}
    `;

    bindTabActions(root);
  }

  function bindTabActions(container) {
    // Tab switching
    container.querySelectorAll("[data-loan-tab]").forEach((btn) => {
      btn.onclick = () => {
        activeTab = btn.getAttribute("data-loan-tab");
        updateNavTabs();
        container.querySelector("[data-loans-advances-content]").innerHTML = `
          ${renderTopKPIs(loadedData?.kpis)}
          ${renderTabContent(loadedData)}
        `;
        bindTabActions(container);
      };
    });

    // Go to requests shortcut
    container.querySelectorAll(".btn-goto-requests").forEach((btn) => {
      btn.onclick = () => {
        activeTab = "requests";
        updateNavTabs();
        container.querySelector("[data-loans-advances-content]").innerHTML = `
          ${renderTopKPIs(loadedData?.kpis)}
          ${renderTabContent(loadedData)}
        `;
        bindTabActions(container);
      };
    });

    // Privacy mask toggle
    const privacyBtn = container.querySelector("#btn-toggle-loan-privacy");
    if (privacyBtn) {
      privacyBtn.onclick = () => {
        privacyMasked = !privacyMasked;
        privacyBtn.textContent = privacyMasked ? "👁️ Reveal Balances" : "🔒 Mask Balances";
        loadData();
      };
    }

    // Request Loan button
    const reqLoanBtn = container.querySelector("#btn-req-loan");
    if (reqLoanBtn) {
      reqLoanBtn.onclick = () => {
        openRequestLoanModal(loadData);
      };
    }

    // Request Advance button
    const reqAdvBtn = container.querySelector("#btn-req-advance");
    if (reqAdvBtn) {
      reqAdvBtn.onclick = () => {
        openRequestAdvanceModal(loadData);
      };
    }

    // Loan details modal
    container.querySelectorAll(".btn-loan-details").forEach((btn) => {
      btn.onclick = () => {
        const loanId = btn.dataset.loanId;
        if (loanId) openLoan360Modal(loanId);
      };
    });

    // Settlement quote modal
    container.querySelectorAll(".btn-settle-quote").forEach((btn) => {
      btn.onclick = () => {
        const loanId = btn.dataset.loanId;
        openSettlementModal(loanId);
      };
    });

    // Pause deferment modal
    container.querySelectorAll(".btn-pause-loan").forEach((btn) => {
      btn.onclick = () => {
        const loanId = btn.dataset.loanId;
        if (!loanId) return;
        openDefermentModal(loanId, loadData);
      };
    });

    // Withdraw button
    container.querySelectorAll(".btn-withdraw-loan").forEach((btn) => {
      btn.onclick = async () => {
        const loanId = btn.dataset.loanId;
        try {
          await apiPost(`/loan-advances/me/requests/${loanId}/withdraw`);
          const target = (loadedData?.loanAdvances || []).find(l => l.id === loanId || l.loanAdvanceId === loanId);
          if (target) {
            target.status = "WITHDRAWN";
          }
          showToast(`Request ${loanId} withdrawn successfully ✓`, "mint");
          loadData();
        } catch (err) {
          showToast(err.message || "Failed to withdraw loan request", "coral");
        }
      };
    });

    // Calculator recalculation
    container.querySelector("#calc-loan-amount")?.addEventListener("input", updateCalculator);
    container.querySelector("#calc-loan-tenure")?.addEventListener("change", updateCalculator);

    function updateCalculator() {
      const amt = Number(container.querySelector("#calc-loan-amount")?.value || 50000);
      const tenure = Number(container.querySelector("#calc-loan-tenure")?.value || 12);
      const emi = amt / tenure;
      const res = container.querySelector("#calc-result-emi");
      if (res) res.textContent = money.format(emi);
    }

    // Export CSV
    const exportBtn = container.querySelector("#btn-export-loan-csv");
    if (exportBtn) {
      exportBtn.onclick = () => {
        exportLoanCsv();
      };
    }
  }

  function updateNavTabs() {
    root.querySelectorAll("[data-loan-tab]").forEach((b) => {
      const isAct = b.getAttribute("data-loan-tab") === activeTab;
      b.className = `btn btn-sm ${isAct ? "btn-primary" : "btn-ghost"}`;
    });
  }

  loadData();
}

// ── MODALS: REQUEST LOAN MODAL ────────────────────────────────────────────────
function openRequestLoanModal(onSuccess) {
  let existing = document.getElementById("req-loan-modal");
  if (existing) existing.remove();

  const modal = document.createElement("div");
  modal.id = "req-loan-modal";
  modal.className = "modal-backdrop flex items-center justify-center";
  modal.style.cssText = "position:fixed; inset:0; background:rgba(0,0,0,0.75); z-index:1050; padding:16px;";

  modal.innerHTML = `
    <div class="card" style="width:100%; max-width:480px; padding:24px; background:var(--bg-surface-1); border-radius:var(--radius-lg); box-shadow:var(--shadow-lg);">
      <div class="flex items-center justify-between" style="margin-bottom:16px;">
        <div id="rlmodal-title" style="font-size:17px; font-weight:800; color:var(--text-primary);">Apply for Employee Loan</div>
        <button class="btn btn-xs btn-ghost" id="rlmodal-close" style="font-size:16px;" aria-label="Close loan application modal">✕</button>
      </div>

      <form id="rlmodal-form" onsubmit="return false;">
        <div style="display:flex; flex-direction:column; gap:14px; font-size:12.5px;">
          <div>
            <label style="font-weight:600; color:var(--text-secondary); margin-bottom:4px; display:block;">Loan Category *</label>
            <select id="rlmodal-category" class="input" style="width:100%;">
              <option value="WELFARE" selected>General Welfare / Rental Assistance</option>
              <option value="MEDICAL">Medical Emergency Support</option>
              <option value="EDUCATION">Education / Skill Development</option>
            </select>
          </div>

          <div>
            <label style="font-weight:600; color:var(--text-secondary); margin-bottom:4px; display:block;">Requested Amount (₹) *</label>
            <input type="number" id="rlmodal-amount" class="input" value="40000" min="5000" max="100000" step="5000" style="width:100%;" />
          </div>

          <div>
            <label style="font-weight:600; color:var(--text-secondary); margin-bottom:4px; display:block;">Repayment Tenure (Months) *</label>
            <select id="rlmodal-tenure" class="input" style="width:100%;">
              <option value="6">6 Months</option>
              <option value="12" selected>12 Months</option>
              <option value="18">18 Months</option>
              <option value="24">24 Months</option>
            </select>
          </div>

          <div>
            <label style="font-weight:600; color:var(--text-secondary); margin-bottom:4px; display:block;">Reason for Loan *</label>
            <textarea id="rlmodal-reason" class="input" rows="2" placeholder="Explain the purpose of this loan request..." style="width:100%; resize:none;"></textarea>
          </div>

          <div style="padding:10px 12px; background:var(--bg-surface-2); border-radius:var(--radius-sm); font-size:12px; color:var(--text-muted);">
            Estimated monthly deduction: <strong id="rlmodal-emi" style="color:var(--color-accent-mint);">₹3,333.33 / month</strong>
          </div>

          <div class="flex justify-end gap-sm" style="margin-top:8px;">
            <button class="btn btn-secondary" id="rlmodal-cancel">Cancel</button>
            <button class="btn btn-primary" id="rlmodal-submit" style="font-weight:700;">Submit Loan Application</button>
          </div>
        </div>
      </form>
    </div>
  `;

  document.body.appendChild(modal);
  const close = () => {
    cleanupA11y();
    modal.remove();
  };
  const cleanupA11y = setupModalA11y(modal, { onClose: close, titleId: "rlmodal-title" });
  modal.querySelector("#rlmodal-close")?.addEventListener("click", close);
  modal.querySelector("#rlmodal-cancel")?.addEventListener("click", close);

  modal.querySelector("#rlmodal-submit")?.addEventListener("click", async () => {
    const category = modal.querySelector("#rlmodal-category").value;
    const amt = Number(modal.querySelector("#rlmodal-amount").value);
    const tenure = Number(modal.querySelector("#rlmodal-tenure").value);
    const reason = modal.querySelector("#rlmodal-reason").value.trim();

    if (!reason) {
      showToast("Please provide a reason for the loan request.", "amber");
      return;
    }

    try {
      await apiPost("/loan-advances/me/requests/loan", {
        requestedAmount: amt,
        loanCategory: category,
        tenureMonths: tenure,
        reason,
      });
      close();
      showToast("Loan request submitted successfully ✓", "mint");
      if (onSuccess) onSuccess();
    } catch (err) {
      showToast(err.message || "Failed to submit loan request", "coral");
    }
  });
}

// ── MODALS: REQUEST ADVANCE MODAL ─────────────────────────────────────────────
function openRequestAdvanceModal(onSuccess) {
  let existing = document.getElementById("req-advance-modal");
  if (existing) existing.remove();

  const modal = document.createElement("div");
  modal.id = "req-advance-modal";
  modal.className = "modal-backdrop flex items-center justify-center";
  modal.style.cssText = "position:fixed; inset:0; background:rgba(0,0,0,0.75); z-index:1050; padding:16px;";

  modal.innerHTML = `
    <div class="card" style="width:100%; max-width:460px; padding:24px; background:var(--bg-surface-1); border-radius:var(--radius-lg); box-shadow:var(--shadow-lg);">
      <div class="flex items-center justify-between" style="margin-bottom:16px;">
        <div id="ramodal-title" style="font-size:17px; font-weight:800; color:var(--text-primary);">Request Salary Advance</div>
        <button class="btn btn-xs btn-ghost" id="ramodal-close" style="font-size:16px;" aria-label="Close advance request modal">✕</button>
      </div>

      <form id="ramodal-form" onsubmit="return false;">
        <div style="display:flex; flex-direction:column; gap:14px; font-size:12.5px;">
          <div>
            <label style="font-weight:600; color:var(--text-secondary); margin-bottom:4px; display:block;">Requested Advance Amount (₹) *</label>
            <input type="number" id="ramodal-amount" class="input" value="15000" min="1000" max="25000" step="1000" style="width:100%;" />
            <div style="font-size:11px; color:var(--text-muted); margin-top:2px;">Maximum eligible advance: ₹25,000.00 (50% of monthly salary)</div>
          </div>

          <div>
            <label style="font-weight:600; color:var(--text-secondary); margin-bottom:4px; display:block;">Reason for Advance *</label>
            <textarea id="ramodal-reason" class="input" rows="2" placeholder="State reason for salary advance..." style="width:100%; resize:none;"></textarea>
          </div>

          <div style="padding:10px 12px; background:var(--bg-surface-2); border-radius:var(--radius-sm); font-size:12px; color:var(--brand-gold);">
            ⚠️ Note: Salary advances are recovered in full from the upcoming payroll run (31 Aug 2026).
          </div>

          <div class="flex justify-end gap-sm" style="margin-top:8px;">
            <button class="btn btn-secondary" id="ramodal-cancel">Cancel</button>
            <button class="btn btn-primary" id="ramodal-submit" style="font-weight:700;">Submit Advance Request</button>
          </div>
        </div>
      </form>
    </div>
  `;

  document.body.appendChild(modal);
  const close = () => {
    cleanupA11y();
    modal.remove();
  };
  const cleanupA11y = setupModalA11y(modal, { onClose: close, titleId: "ramodal-title" });
  modal.querySelector("#ramodal-close")?.addEventListener("click", close);
  modal.querySelector("#ramodal-cancel")?.addEventListener("click", close);

  modal.querySelector("#ramodal-submit")?.addEventListener("click", async () => {
    const amt = Number(modal.querySelector("#ramodal-amount").value);
    const reason = modal.querySelector("#ramodal-reason").value.trim();

    if (!reason) {
      showToast("Please provide a reason for the salary advance.", "amber");
      return;
    }

    try {
      const res = await apiPost("/loan-advances/me/requests/advance", {
        requestedAmount: amt,
        reason,
      });
      close();
      const advance = res?.data?.loanAdvance || res?.data || {};
      openLoanReceiptModal({
        id: advance.loanAdvanceId || advance.id || "ADV-NEW",
        type: "Salary Advance",
        amount: (advance.requestedAmount ?? amt) * 100,
      });
      if (onSuccess) onSuccess();
    } catch (err) {
      showToast(err.message || "Failed to submit advance request", "coral");
    }
  });
}

// ── MODALS: RECEIPT MODAL ─────────────────────────────────────────────────────
function openLoanReceiptModal(item) {
  let existing = document.getElementById("loan-receipt-modal");
  if (existing) existing.remove();

  const modal = document.createElement("div");
  modal.id = "loan-receipt-modal";
  modal.className = "modal-backdrop flex items-center justify-center";
  modal.style.cssText = "position:fixed; inset:0; background:rgba(0,0,0,0.75); z-index:1060; padding:16px;";

  modal.innerHTML = `
    <div class="card" style="width:100%; max-width:440px; padding:26px; background:var(--bg-surface-1); border-radius:var(--radius-lg); text-align:center;">
      <div style="font-size:42px; margin-bottom:12px;">✅</div>
      <div id="lrmodal-title" style="font-size:18px; font-weight:800; color:var(--text-primary); margin-bottom:4px;">Request Submitted</div>
      <div style="font-size:13px; color:var(--text-muted); margin-bottom:18px;">Your financial request has been submitted for governance review.</div>

      <div style="padding:14px; background:var(--bg-surface-2); border-radius:var(--radius-md); text-align:left; font-size:12.5px; display:flex; flex-direction:column; gap:8px; margin-bottom:20px;">
        <div class="flex justify-between"><span>Request ID:</span><strong style="font-family:monospace; color:var(--brand-gold);">${item.id}</strong></div>
        <div class="flex justify-between"><span>Type:</span><strong>${item.type}</strong></div>
        <div class="flex justify-between"><span>Requested Amount:</span><strong style="color:var(--color-accent-mint);">${amount(item.amount)}</strong></div>
        <div class="flex justify-between"><span>Status:</span><strong style="color:var(--brand-gold);">Submitted / Under Review</strong></div>
      </div>

      <button class="btn btn-primary btn-block" id="loan-receipt-done" style="padding:10px; font-weight:700;">Done</button>
    </div>
  `;

  document.body.appendChild(modal);
  const closeReceipt = () => {
    cleanupA11y();
    modal.remove();
  };
  const cleanupA11y = setupModalA11y(modal, { onClose: closeReceipt, titleId: "lrmodal-title" });
  modal.querySelector("#loan-receipt-done")?.addEventListener("click", closeReceipt);
}

// ── MODALS: LOAN 360 MODAL ────────────────────────────────────────────────────
function openLoan360Modal(loanId) {
  let existing = document.getElementById("loan-360-modal");
  if (existing) existing.remove();

  const loans = loadedData?.loanAdvances || [];
  const item = loans.find(l => (l.loanAdvanceId === loanId || l.id === loanId)) || loans[0];
  if (!item) return;

  const modal = document.createElement("div");
  modal.id = "loan-360-modal";
  modal.className = "modal-backdrop flex items-center justify-center";
  modal.style.cssText = "position:fixed; inset:0; background:rgba(0,0,0,0.75); z-index:1050; padding:16px;";

  modal.innerHTML = `
    <div class="card" style="width:100%; max-width:520px; padding:24px; background:var(--bg-surface-1); border-radius:var(--radius-lg); box-shadow:var(--shadow-lg);">
      <div class="flex items-center justify-between" style="margin-bottom:14px;">
        <div id="l360-title" style="font-size:17px; font-weight:800; color:var(--text-primary);">Facility 360 Details</div>
        <button class="btn btn-xs btn-ghost" id="l360-close" style="font-size:16px;" aria-label="Close facility details">✕</button>
      </div>

      <div style="font-size:13px; font-family:monospace; font-weight:700; color:var(--brand-gold); margin-bottom:14px;">
        ${item.loanAdvanceId || item.id || loanId} · ${item.requestType === "SALARY_ADVANCE" ? "Salary Advance" : "Employee Welfare Loan"}
      </div>

      <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px; font-size:12.5px; margin-bottom:16px;">
        <div style="padding:8px 12px; background:var(--bg-surface-2); border-radius:var(--radius-sm);">
          <span style="color:var(--text-muted);">Principal Disbursed:</span>
          <div style="font-weight:700; color:var(--text-primary); margin-top:2px;">${amount(item.principalPaise || item.requestedAmountPaise)}</div>
        </div>
        <div style="padding:8px 12px; background:var(--bg-surface-2); border-radius:var(--radius-sm);">
          <span style="color:var(--text-muted);">Outstanding Balance:</span>
          <div style="font-weight:800; color:var(--brand-gold); margin-top:2px;">${amount(item.outstandingPrincipalPaise)}</div>
        </div>
        <div style="padding:8px 12px; background:var(--bg-surface-2); border-radius:var(--radius-sm);">
          <span style="color:var(--text-muted);">Tenure:</span>
          <div style="font-weight:700; color:var(--text-primary); margin-top:2px;">${item.tenureMonths || 12} Months</div>
        </div>
        <div style="padding:8px 12px; background:var(--bg-surface-2); border-radius:var(--radius-sm);">
          <span style="color:var(--text-muted);">Interest Rate:</span>
          <div style="font-weight:700; color:var(--color-accent-mint); margin-top:2px;">0.0% (Interest Free)</div>
        </div>
      </div>

      <div style="padding:10px 12px; background:var(--bg-surface-2); border-radius:var(--radius-sm); font-size:12px; color:var(--text-secondary); margin-bottom:16px;">
        Payroll Reference: <strong style="font-family:monospace; color:var(--text-primary);">${item.deductionReference || 'DED-' + (item.loanAdvanceId || loanId)}</strong> · All recoveries sync directly with your monthly payslip.
      </div>

      <div class="flex justify-end gap-sm">
        <button class="btn btn-secondary" id="l360-done">Close</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);
  const close = () => {
    cleanupA11y();
    modal.remove();
  };
  const cleanupA11y = setupModalA11y(modal, { onClose: close, titleId: "l360-title" });
  modal.querySelector("#l360-close")?.addEventListener("click", close);
  modal.querySelector("#l360-done")?.addEventListener("click", close);
}

// ── MODALS: SETTLEMENT QUOTE MODAL ───────────────────────────────────────────
function openSettlementModal(loanId) {
  let existing = document.getElementById("settle-quote-modal");
  if (existing) existing.remove();

  const loans = loadedData?.loanAdvances || [];
  const item = loans.find(l => (l.loanAdvanceId === loanId || l.id === loanId)) || loans[0];
  if (!item) return;
  const payoff = item.outstandingPrincipalPaise || 0;
  const effectiveLoanId = item.loanAdvanceId || loanId;

  const modal = document.createElement("div");
  modal.id = "settle-quote-modal";
  modal.className = "modal-backdrop flex items-center justify-center";
  modal.style.cssText = "position:fixed; inset:0; background:rgba(0,0,0,0.75); z-index:1050; padding:16px;";

  modal.innerHTML = `
    <div class="card" style="width:100%; max-width:460px; padding:24px; background:var(--bg-surface-1); border-radius:var(--radius-lg);">
      <div class="flex items-center justify-between" style="margin-bottom:14px;">
        <div id="settle-title" style="font-size:17px; font-weight:800; color:var(--text-primary);">Early Settlement Quote</div>
        <button class="btn btn-xs btn-ghost" id="sq-close" style="font-size:16px;" aria-label="Close settlement modal">✕</button>
      </div>

      <div style="font-size:12.5px; color:var(--text-secondary); margin-bottom:14px;">
        Full early payoff quote for loan <strong style="font-family:monospace; color:var(--brand-gold);">${effectiveLoanId}</strong>.
      </div>

      <div style="padding:14px; background:var(--bg-surface-2); border-radius:var(--radius-md); font-size:12.5px; display:flex; flex-direction:column; gap:8px; margin-bottom:18px;">
        <div class="flex justify-between"><span>Outstanding Principal:</span><strong style="color:var(--text-primary);">${amount(payoff)}</strong></div>
        <div class="flex justify-between"><span>Prepayment Fee:</span><strong style="color:var(--color-accent-mint);">₹0.00 (Zero Fee)</strong></div>
        <div class="flex justify-between" style="padding-top:6px; border-top:1px solid var(--border-subtle); font-size:14px;">
          <span>Total Settlement Payoff:</span>
          <strong id="sq-payoff-val" style="color:var(--brand-gold);">${amount(payoff)}</strong>
        </div>
      </div>

      <div class="flex justify-end gap-sm">
        <button class="btn btn-secondary" id="sq-cancel">Back</button>
        <button class="btn btn-primary" id="sq-submit" style="font-weight:700;">Submit Settlement Request</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);
  const close = () => {
    cleanupA11y();
    modal.remove();
  };
  const cleanupA11y = setupModalA11y(modal, { onClose: close, titleId: "settle-title" });
  modal.querySelector("#sq-close")?.addEventListener("click", close);
  modal.querySelector("#sq-cancel")?.addEventListener("click", close);

  // Fetch authoritative quote in background
  apiGet(`/loan-advances/me/loans/${effectiveLoanId}/settlement-quote`).then((res) => {
    const q = res?.data?.quote;
    if (q) {
      const pVal = modal.querySelector("#sq-payoff-val");
      if (pVal && q.settlementPayoffPaise !== undefined) {
        pVal.textContent = amount(q.settlementPayoffPaise);
      }
    }
  }).catch(() => {});

  modal.querySelector("#sq-submit")?.addEventListener("click", async () => {
    const submitBtn = modal.querySelector("#sq-submit");
    try {
      submitBtn.disabled = true;
      submitBtn.textContent = "Submitting...";
      await apiPost(`/loan-advances/me/loans/${effectiveLoanId}/settlement-request`, {
        settlementAmountPaise: payoff,
        paymentSource: "DIRECT_DEPOSIT",
        reason: "Early settlement payoff requested by employee.",
      });
      close();
      showToast("Early settlement request submitted for finance processing ✓", "mint");
    } catch (err) {
      submitBtn.disabled = false;
      submitBtn.textContent = "Submit Settlement Request";
      showToast(err.message || "Failed to submit early settlement request", "coral");
    }
  });
}

// ── MODALS: DEFERMENT MODAL ───────────────────────────────────────────────────
function openDefermentModal(loanId, onDone) {
  let existing = document.getElementById("deferment-modal");
  if (existing) existing.remove();

  const modal = document.createElement("div");
  modal.id = "deferment-modal";
  modal.className = "modal-backdrop flex items-center justify-center";
  modal.style.cssText = "position:fixed; inset:0; background:rgba(0,0,0,0.75); z-index:1050; padding:16px;";

  modal.innerHTML = `
    <div class="card" style="width:100%; max-width:460px; padding:24px; background:var(--bg-surface-1); border-radius:var(--radius-lg);">
      <div class="flex items-center justify-between" style="margin-bottom:14px;">
        <div id="defer-title" style="font-size:17px; font-weight:800; color:var(--text-primary);">Request Repayment Deferment</div>
        <button class="btn btn-xs btn-ghost" id="def-close" style="font-size:16px;" aria-label="Close deferment modal">✕</button>
      </div>

      <div style="font-size:12.5px; color:var(--text-secondary); margin-bottom:14px;">
        Request a temporary 1-month pause on payroll recovery for loan <strong style="font-family:monospace; color:var(--brand-gold);">${loanId}</strong>.
      </div>

      <div style="margin-bottom:14px;">
        <label style="font-size:12px; font-weight:600; color:var(--text-secondary); margin-bottom:4px; display:block;">Reason for Deferment *</label>
        <textarea id="def-reason" class="input" rows="2" placeholder="Explain the temporary hardship..." style="width:100%; resize:none;"></textarea>
      </div>

      <div class="flex justify-end gap-sm">
        <button class="btn btn-secondary" id="def-cancel">Back</button>
        <button class="btn btn-primary" id="def-submit" style="font-weight:700;">Submit Deferment Request</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);
  const close = () => {
    cleanupA11y();
    modal.remove();
  };
  const cleanupA11y = setupModalA11y(modal, { onClose: close, titleId: "defer-title" });
  modal.querySelector("#def-close")?.addEventListener("click", close);
  modal.querySelector("#def-cancel")?.addEventListener("click", close);

  modal.querySelector("#def-submit")?.addEventListener("click", async () => {
    const reason = modal.querySelector("#def-reason").value.trim();
    if (!reason) {
      showToast("Please provide a reason for the deferment request.", "amber");
      return;
    }
    const submitBtn = modal.querySelector("#def-submit");
    try {
      submitBtn.disabled = true;
      submitBtn.textContent = "Submitting...";
      const now = new Date();
      const currentYear = now.getFullYear();
      const currentMonth = now.getMonth() + 1;
      const nextMonth = currentMonth === 12 ? 1 : currentMonth + 1;
      const nextYear = currentMonth === 12 ? currentYear + 1 : currentYear;
      const resumeMonth = nextMonth === 12 ? 1 : nextMonth + 1;
      const resumeYear = nextMonth === 12 ? nextYear + 1 : nextYear;

      const fromPeriod = `${nextYear}-${String(nextMonth).padStart(2, "0")}`;
      const resumePeriod = `${resumeYear}-${String(resumeMonth).padStart(2, "0")}`;

      await apiPost(`/loan-advances/me/loans/${loanId}/pause`, {
        fromPeriod,
        resumePeriod,
        reason,
      });
      close();
      showToast("Repayment deferment request submitted for review ✓", "mint");
      if (onDone) onDone();
    } catch (err) {
      submitBtn.disabled = false;
      submitBtn.textContent = "Submit Deferment Request";
      showToast(err.message || "Failed to submit deferment request", "coral");
    }
  });
}

// ── UTILITIES: EXPORT CSV ────────────────────────────────────────────────────
function exportLoanCsv() {
  const loans = loadedData?.loanAdvances || [];
  if (loans.length === 0) { showToast("No loan records to export", "info"); return; }
  const headers = ["Facility ID", "Type", "Principal", "Repaid", "Outstanding", "Status"];
  const rows = loans.map((l) => [
    l.loanAdvanceId || l.id, l.requestType,
    ((l.principalPaise || l.requestedAmountPaise || 0) / 100).toFixed(2),
    ((l.totalRepaidPaise || 0) / 100).toFixed(2),
    ((l.outstandingPrincipalPaise || 0) / 100).toFixed(2), l.status,
  ]);
  exportGrid({ headers, rows, title: "Loans and Advances Statement", filename: `Zamorin_Loans_Statement_${new Date().getFullYear()}` });
  showToast("Loans & Advances statement downloaded (XLSX) ✓", "mint");
}
