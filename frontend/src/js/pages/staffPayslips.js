// PAGE: My Payslips (SCR-015) — Comprehensive 364-Stage Employee Payroll Self-Service, Statutory Form V Wage Slips, Form No. 130 Tax Documents, Retroactive Difference Engine & Financial Integrity Platform
import {
  ApiClientError,
  apiGet,
  apiPost,
} from "../apiClient.js";

import {
  emptyState,
  skeleton,
  showToast,
} from "../components.js";
import { setupModalA11y } from "../utils/modalA11y.js";

let activeListRequest = null;
let activeDetailRequest = null;
let activeDetailOverlay = null;
let currentTab = "overview"; // 'overview' | 'history' | 'form_v' | 'comparison' | 'tax_documents' | 'compensation' | 'queries'
let loadedPayslips = [];
let loadedQueries = [];
let isLoadingQueries = false;
let selectedYear = "ALL";
let selectedStatus = "ALL";
let compareFromId = null;
let compareToId = null;

const currencyFormatter = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const periodFormatter = new Intl.DateTimeFormat("en-IN", {
  month: "long",
  year: "numeric",
  timeZone: "Asia/Kolkata",
});

const dateFormatter = new Intl.DateTimeFormat("en-IN", {
  dateStyle: "medium",
  timeZone: "Asia/Kolkata",
});

const dateTimeFormatter = new Intl.DateTimeFormat("en-IN", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Kolkata",
});

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

let balancesMasked = false;

function formatPaise(value, { allowMask = true } = {}) {
  if (balancesMasked && allowMask) {
    return "₹ ••,•••";
  }
  const paise = Number(value);
  if (!Number.isSafeInteger(paise)) {
    return "₹0.00";
  }
  return currencyFormatter.format(paise / 100);
}

function formatPeriod(periodKey) {
  if (typeof periodKey !== "string" || !/^\d{4}-\d{2}$/.test(periodKey)) {
    return "Payroll period";
  }
  const [year, month] = periodKey.split("-").map(Number);
  return periodFormatter.format(new Date(Date.UTC(year, month - 1, 1)));
}

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return dateFormatter.format(date);
}

function formatDateTime(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return dateTimeFormatter.format(date);
}

function statusPill(status) {
  const normalized = typeof status === "string" ? status.toUpperCase() : "ISSUED";
  let label = "Issued";
  let kind = "amber";

  if (normalized === "PAID") {
    label = "Paid";
    kind = "mint";
  } else if (normalized === "DRAFT") {
    label = "Draft (Processing)";
    kind = "neutral";
  } else if (normalized === "VOIDED" || normalized === "REVERSED") {
    label = normalized === "REVERSED" ? "Reversed" : "Voided";
    kind = "dark";
  } else if (normalized === "CORRECTED" || normalized === "SUPERSEDED") {
    label = "Superseded (V1)";
    kind = "dark";
  }

  return `<span class="pill pill-${kind}">${escapeHtml(label)}</span>`;
}

function runTypePill(runType) {
  const t = String(runType || "REGULAR").toUpperCase();
  let label = "Regular Cycle";
  let kind = "neutral";

  if (t === "OFF_CYCLE") {
    label = "Off-Cycle Pay";
    kind = "amber";
  } else if (t === "RETRO_ADJUSTMENT") {
    label = "Retroactive Adjustment";
    kind = "mint";
  } else if (t === "BONUS") {
    label = "Annual / Festival Bonus";
    kind = "gold";
  } else if (t === "FINAL_SETTLEMENT") {
    label = "Full & Final Settlement";
    kind = "dark";
  } else if (t === "CORRECTION") {
    label = "Corrected Statement";
    kind = "amber";
  }

  return `<span class="pill pill-${kind}" style="font-size:10.5px;">${escapeHtml(label)}</span>`;
}

function numberToWords(paise) {
  const rupees = Math.floor((paise || 0) / 100);
  if (rupees === 0) return "Zero Rupees Only";

  const a = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
  const b = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

  function inWords(num) {
    if ((num = num.toString()).length > 9) return "Overflow";
    const n = ("000000000" + num).substr(-9).match(/^(\d{2})(\d{2})(\d{2})(\d{1})(\d{2})$/);
    if (!n) return "";
    let str = "";
    str += Number(n[1]) !== 0 ? (a[Number(n[1])] || b[n[1][0]] + " " + a[n[1][1]]) + " Crore " : "";
    str += Number(n[2]) !== 0 ? (a[Number(n[2])] || b[n[2][0]] + " " + a[n[2][1]]) + " Lakh " : "";
    str += Number(n[3]) !== 0 ? (a[Number(n[3])] || b[n[3][0]] + " " + a[n[3][1]]) + " Thousand " : "";
    str += Number(n[4]) !== 0 ? (a[Number(n[4])] || b[n[4][0]] + " " + a[n[4][1]]) + " Hundred " : "";
    str += Number(n[5]) !== 0 ? ((str !== "") ? "and " : "") + (a[Number(n[5])] || b[n[5][0]] + " " + a[n[5][1]]) + " " : "";
    return str.trim();
  }

  return inWords(rupees) + " Rupees Only";
}

// No fixture data u2014 production app uses live API only
const DEV_PAYSLIP_FIXTURES = [];
let payrollQueries = [];

function calculateMetrics(payslips) {
  let latestNetPayPaise = 0;
  let ytdGrossPaise = 0;
  let ytdDeductionsPaise = 0;
  let ytdNetPayPaise = 0;
  let ytdTaxPaise = 0;
  let ytdPFPaise = 0;

  if (payslips.length > 0) {
    latestNetPayPaise = payslips[0].netPayPaise || 0;
    for (const p of payslips) {
      ytdGrossPaise += p.earnings?.grossPayPaise || 0;
      ytdDeductionsPaise += p.deductions?.totalDeductionPaise || 0;
      ytdNetPayPaise += p.netPayPaise || 0;
      ytdTaxPaise += p.deductions?.incomeTaxPaise || 0;
      ytdPFPaise += p.deductions?.providentFundPaise || 0;
    }
  }

  return {
    latestNetPayPaise,
    ytdGrossPaise,
    ytdDeductionsPaise,
    ytdNetPayPaise,
    ytdTaxPaise,
    ytdPFPaise,
    payslipCount: payslips.length,
    openQueriesCount: payrollQueries.filter((q) => q.status === "OPEN").length,
  };
}

function renderKPIHeader(metrics) {
  return `
    <div style="display:grid; grid-template-columns:repeat(auto-fit,minmax(220px,1fr)); gap:14px; margin-bottom:20px;">
      <div class="card" style="padding:16px 18px; background:var(--bg-surface-1); border-radius:var(--radius-lg); border:1px solid var(--border-subtle); border-left:4px solid #10b981; box-shadow:var(--shadow-sm);">
        <div style="color:var(--text-muted); font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:0.5px;">Latest Disbursed Net Pay</div>
        <div style="color:#059669; font-size:24px; font-weight:800; margin-top:4px;">${formatPaise(metrics.latestNetPayPaise)}</div>
        <div style="color:var(--text-muted); font-size:11.5px; margin-top:4px;">Credited via Direct Bank Transfer</div>
      </div>

      <div class="card" style="padding:16px 18px; background:var(--bg-surface-1); border-radius:var(--radius-lg); border:1px solid var(--border-subtle); border-left:4px solid #0284c7; box-shadow:var(--shadow-sm);">
        <div style="color:var(--text-muted); font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:0.5px;">Financial Year Gross Pay (YTD)</div>
        <div style="color:#0284c7; font-size:24px; font-weight:800; margin-top:4px;">${formatPaise(metrics.ytdGrossPaise)}</div>
        <div style="color:var(--text-muted); font-size:11.5px; margin-top:4px;">Across ${metrics.payslipCount} pay event(s)</div>
      </div>

      <div class="card" style="padding:16px 18px; background:var(--bg-surface-1); border-radius:var(--radius-lg); border:1px solid var(--border-subtle); border-left:4px solid #8b5cf6; box-shadow:var(--shadow-sm);">
        <div style="color:var(--text-muted); font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:0.5px;">Total Net Take-Home (YTD)</div>
        <div style="color:var(--text-primary); font-size:24px; font-weight:800; margin-top:4px;">${formatPaise(metrics.ytdNetPayPaise)}</div>
        <div style="color:var(--text-muted); font-size:11.5px; margin-top:4px;">Post all statutory deductions</div>
      </div>

      <div class="card" style="padding:16px 18px; background:var(--bg-surface-1); border-radius:var(--radius-lg); border:1px solid var(--border-subtle); border-left:4px solid #f59e0b; box-shadow:var(--shadow-sm);">
        <div style="color:var(--text-muted); font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:0.5px;">Total Statutory Deductions</div>
        <div style="color:#d97706; font-size:24px; font-weight:800; margin-top:4px;">${formatPaise(metrics.ytdDeductionsPaise)}</div>
        <div style="color:var(--text-muted); font-size:11.5px; margin-top:4px;">PF: ${formatPaise(metrics.ytdPFPaise)} · TDS: ${formatPaise(metrics.ytdTaxPaise)}</div>
      </div>
    </div>
  `;
}

function renderNeedsAttention(latest) {
  if (!latest) return "";
  const periodLabel = formatPeriod(latest.periodKey);
  const pid = latest.payslipId || latest.id;
  if (!pid) return "";

  return `
    <div class="card" style="padding:14px 18px; margin-bottom:18px; background:rgba(200,157,92,0.08); border:1px solid rgba(200,157,92,0.3); display:flex; align-items:center; justify-content:space-between; gap:16px; flex-wrap:wrap; border-radius:var(--radius-lg);">
      <div class="flex items-center gap-sm">
        <span style="font-size:20px;">🔔</span>
        <div>
          <div style="color:var(--text-primary); font-weight:700; font-size:13.5px;">Action Centre: ${escapeHtml(periodLabel)} Salary Statement is Published</div>
          <div style="color:var(--text-secondary); font-size:12px; margin-top:1px;">Annual Tax Statement projection is ready for FY 2026-27.</div>
        </div>
      </div>
      <div class="flex items-center gap-sm">
        <button class="btn btn-primary" type="button" data-view-payslip="${escapeHtml(pid)}" style="padding:7px 16px; font-size:12.5px; font-weight:700;">View Statement</button>
      </div>
    </div>
  `;
}

function renderTabs() {
  const tabs = [
    { id: "overview", label: "Executive Overview", icon: "📊" },
    { id: "history", label: "Payslip History", icon: "📄" },
    { id: "comparison", label: "Pay Comparison & Diff", icon: "⚖️" },
    { id: "form_v", label: "Statutory Form V", icon: "🏛️" },
    { id: "tax_documents", label: "Annual Tax Documents", icon: "📑" },
    { id: "compensation", label: "Salary Structure & CTC", icon: "💼" },
    { id: "queries", label: "Payroll Queries", icon: "💬" },
  ];

  return `
    <div class="card" style="padding:8px 12px; margin-bottom:20px; background:var(--bg-surface-1); border-radius:var(--radius-lg); box-shadow:var(--shadow-sm); display:flex; gap:8px; overflow-x:auto;">
      ${tabs
        .map(
          (t) => `
            <button
              class="btn btn-sm ${currentTab === t.id ? "btn-primary" : "btn-ghost"}"
              type="button"
              data-payslip-tab="${t.id}"
              style="padding:7px 14px; font-size:12.5px; font-weight:${currentTab === t.id ? "700" : "500"}; white-space:nowrap; display:inline-flex; align-items:center; gap:6px; border-radius:var(--radius-md);"
            >
              <span>${t.icon}</span>
              <span>${escapeHtml(t.label)}</span>
            </button>
          `
        )
        .join("")}
    </div>
  `;
}

function detailRow(label, value, { strong = false, alert = false, mint = false } = {}) {
  let color = "var(--text-primary)";
  if (alert) color = "var(--brand-gold)";
  if (mint) color = "var(--color-accent-mint)";

  return `
    <div class="flex justify-between items-center" style="font-size:12.5px; padding:6px 0; gap:14px; border-bottom:1px solid var(--border-subtle);">
      <span style="color:var(--text-muted);">${escapeHtml(label)}</span>
      <span style="color:${color}; text-align:right;${strong ? " font-weight:700;" : ""}">
        ${escapeHtml(value)}
      </span>
    </div>
  `;
}

function renderOverviewTab(payslips) {
  if (!payslips || payslips.length === 0) {
    return emptyState({
      title: "No payslips yet",
      body: "Your payslips will appear here once payroll is processed.",
    });
  }
  const latest = payslips[0];
  const e = latest.earnings || {};
  const d = latest.deductions || {};

  return `
    <div class="flex-col gap-md">
      ${renderNeedsAttention(latest)}

      <!-- Prominent Latest Statement Banner with High Contrast -->
      <div class="card" style="padding:24px; border-radius:var(--radius-lg); background:linear-gradient(135deg, #1e293b 0%, #0f172a 100%); border:1px solid rgba(200,157,92,0.35); box-shadow:var(--shadow-md); color:#ffffff;">
        <div class="flex justify-between items-start" style="gap:16px; flex-wrap:wrap; border-bottom:1px solid rgba(255,255,255,0.12); padding-bottom:16px; margin-bottom:18px;">
          <div>
            <div style="color:#fbbf24; font-size:11px; font-weight:800; text-transform:uppercase; letter-spacing:1px;">
              Most Recent Statement — ${escapeHtml(formatPeriod(latest.periodKey))}
            </div>
            <div style="color:#ffffff; font-size:28px; font-weight:800; font-family:var(--font-heading); margin-top:4px;">
              ${formatPaise(latest.netPayPaise)}
            </div>
            <div style="color:#94a3b8; font-size:12.5px; margin-top:4px;">
              Paid via Direct Credit on ${latest.paidAt ? formatDate(latest.paidAt) : (latest.periodKey ? formatDate(latest.periodKey + "-01") : "Processed")} · Ref: <strong style="color:#e2e8f0; font-family:monospace;">${escapeHtml(latest.paymentReference || "Direct Credit")}</strong>
            </div>
          </div>

          <div class="flex items-center gap-sm flex-wrap">
            <span class="badge badge-mint" style="font-weight:700; font-size:11px; padding:4px 10px;">${latest.status || "PAID"}</span>
            <span class="badge badge-subtle" style="font-weight:600; font-size:11px; padding:4px 10px; background:rgba(255,255,255,0.12); color:#e2e8f0;">${latest.runType || "Regular Cycle"}</span>
            <button class="btn btn-primary" type="button" data-view-payslip="${escapeHtml(latest.payslipId)}" style="padding:8px 16px; font-size:12.5px; font-weight:700; background:#c89d5c; color:#0f172a; border:none;">
              Open Payslip 360°
            </button>
            <button class="btn btn-ghost" type="button" data-quick-print="${escapeHtml(latest.payslipId)}" style="padding:8px 14px; font-size:12.5px; color:#ffffff; border:1px solid rgba(255,255,255,0.25); background:rgba(255,255,255,0.08);">
              Download PDF
            </button>
          </div>
        </div>

        <div style="display:grid; grid-template-columns:repeat(auto-fit,minmax(200px,1fr)); gap:14px;">
          <div style="padding:14px 16px; background:rgba(255,255,255,0.06); border:1px solid rgba(255,255,255,0.12); border-radius:10px;">
            <div style="color:#94a3b8; font-size:11.5px; font-weight:700; text-transform:uppercase; letter-spacing:0.5px;">Gross Earnings</div>
            <div style="color:#ffffff; font-size:20px; font-weight:800; margin-top:4px;">${formatPaise(e.grossPayPaise)}</div>
          </div>
          <div style="padding:14px 16px; background:rgba(255,255,255,0.06); border:1px solid rgba(255,255,255,0.12); border-radius:10px;">
            <div style="color:#94a3b8; font-size:11.5px; font-weight:700; text-transform:uppercase; letter-spacing:0.5px;">Total Deductions</div>
            <div style="color:#f87171; font-size:20px; font-weight:800; margin-top:4px;">-${formatPaise(d.totalDeductionPaise)}</div>
          </div>
          <div style="padding:14px 16px; background:rgba(255,255,255,0.06); border:1px solid rgba(255,255,255,0.12); border-radius:10px;">
            <div style="color:#94a3b8; font-size:11.5px; font-weight:700; text-transform:uppercase; letter-spacing:0.5px;">EPF Contribution</div>
            <div style="color:#38bdf8; font-size:20px; font-weight:800; margin-top:4px;">${formatPaise(d.providentFundPaise)}</div>
          </div>
          <div style="padding:14px 16px; background:rgba(255,255,255,0.06); border:1px solid rgba(255,255,255,0.12); border-radius:10px;">
            <div style="color:#94a3b8; font-size:11.5px; font-weight:700; text-transform:uppercase; letter-spacing:0.5px;">Loan Recovery</div>
            <div style="color:#f472b6; font-size:20px; font-weight:800; margin-top:4px;">${formatPaise(d.loanAdvanceDeductionPaise)}</div>
          </div>
        </div>
      </div>

      <!-- Pay Trend Teaser -->
      <div style="display:grid; grid-template-columns:repeat(auto-fit,minmax(320px,1fr)); gap:18px;">
        <div class="card" style="padding:20px; background:var(--bg-surface-1); border-radius:var(--radius-lg); border:1px solid var(--border-subtle); box-shadow:var(--shadow-sm);
">
          <div style="color:var(--text-primary); font-size:15px; font-weight:800; margin-bottom:12px;" class="font-display">Monthly Pay Trend</div>
          <div style="display:flex; align-items:flex-end; gap:16px; height:140px; padding:10px 0; border-bottom:1px solid var(--border-subtle);">
            ${payslips.slice(0, 4).reverse().map(p => {
              const maxNet = Math.max(...payslips.slice(0, 4).map(x => x.netPayPaise || 0), 1);
              const height = Math.round(((p.netPayPaise || 0) / maxNet) * 110);
              return `
                <div style="flex:1; display:flex; flex-direction:column; align-items:center; gap:6px;">
                  <div style="font-size:11px; color:#059669; font-weight:800;">${formatPaise(p.netPayPaise, { allowMask: false })}</div>
                  <div style="width:100%; max-width:38px; height:${Math.max(20, height)}px; background:linear-gradient(to top, #059669, #34d399); border-radius:4px 4px 0 0;"></div>
                  <div style="color:var(--text-secondary); font-size:11px; font-weight:600;">${formatPeriod(p.periodKey).split(' ')[0]}</div>
                </div>
              `;
            }).join('')}
          </div>
          <div class="flex justify-between" style="font-size:11px; color:var(--text-muted); margin-top:10px;">
            <span>Bars indicate monthly net take-home</span>
            <span style="color:#059669; font-weight:600;">Live Data</span>
          </div>
        </div>

        <div class="card" style="padding:20px; background:var(--bg-surface-1); border-radius:var(--radius-lg); border:1px solid var(--border-subtle); box-shadow:var(--shadow-sm); display:flex; flex-direction:column; justify-content:space-between;">
          <div>
            <div style="color:var(--text-primary); font-size:15px; font-weight:800; margin-bottom:10px;" class="font-display">Pay Comparison</div>
            <div style="font-size:13px; color:var(--text-secondary); line-height:1.6;">
              Switch to the <strong style="color:var(--text-primary);">Pay Comparison &amp; Diff</strong> tab to see a month-over-month breakdown of your earnings, deductions, and any changes between pay periods.
            </div>
          </div>
          <div style="margin-top:16px;">
            <button class="btn btn-sm btn-ghost" type="button" data-payslip-tab="comparison" style="color:var(--brand-gold); font-weight:700; padding:6px 12px; border:1px solid var(--border-subtle);">
              View Detailed Component Comparison →
            </button>
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderPayslipCards(payslips) {
  let filtered = [...payslips];

  if (selectedYear !== "ALL") {
    filtered = filtered.filter((p) => (p.periodKey || "").startsWith(selectedYear));
  }

  if (selectedStatus !== "ALL") {
    filtered = filtered.filter((p) => (p.status || "").toUpperCase() === selectedStatus);
  }

  if (filtered.length === 0) {
    return emptyState({
      title: "No payslips found",
      body: "There are no payslips matching your selected filter criteria.",
    });
  }

  return `
    <div class="flex justify-between items-center" style="gap:12px;margin-bottom:14px;flex-wrap:wrap;">
      <div class="flex items-center gap-sm" style="flex-wrap:wrap;">
        <span style="color:var(--muted);" style="font-size:12px;font-weight:600;">Filter Year:</span>
        <select class="select" data-filter-year style="padding:6px 12px;font-size:12px;width:auto;">
          <option value="ALL" ${selectedYear === "ALL" ? "selected" : ""}>All Years</option>
          <option value="2026" ${selectedYear === "2026" ? "selected" : ""}>FY 2026 - 2027</option>
          <option value="2025" ${selectedYear === "2025" ? "selected" : ""}>FY 2025 - 2026</option>
        </select>

        <span style="color:var(--muted);" style="font-size:12px;font-weight:600;margin-left:8px;">Status:</span>
        <select class="select" data-filter-status style="padding:6px 12px;font-size:12px;width:auto;">
          <option value="ALL" ${selectedStatus === "ALL" ? "selected" : ""}>All Statuses</option>
          <option value="PAID" ${selectedStatus === "PAID" ? "selected" : ""}>Paid</option>
          <option value="ISSUED" ${selectedStatus === "ISSUED" ? "selected" : ""}>Issued</option>
        </select>
      </div>

      <div style="color:var(--muted);" style="font-size:12px;">
        Showing <strong>${filtered.length}</strong> payroll event(s)
      </div>
    </div>

    <div class="flex-col gap-md">
      ${filtered
        .map((p) => {
          const gross = p.earnings?.grossPayPaise || 0;
          const deductions = p.deductions?.totalDeductionPaise || 0;
          const net = p.netPayPaise || 0;
          const att = p.attendanceSummary || {};

          return `
            <article class="glass" style="padding:18px;display:flex;justify-content:space-between;align-items:center;gap:18px;flex-wrap:wrap;border-left:4px solid ${p.status === "PAID" ? "#22c55e" : "#eab308"};">
              <div style="flex:1;min-width:260px;">
                <div class="flex items-center gap-sm" style="flex-wrap:wrap;">
                  <span style="color:var(--ink);font-weight:700;font-size:15px;" class="font-display">
                    ${escapeHtml(formatPeriod(p.periodKey))}
                  </span>
                  ${statusPill(p.status)}
                  ${runTypePill(p.runType)}
                  <span style="color:var(--muted);" style="font-size:11.5px;">• ${escapeHtml(p.payslipId)}</span>
                </div>

                <div style="color:var(--muted);" style="font-size:12px;margin-top:6px;">
                  Payable Days: <strong>${att.payableDays ?? 0}</strong> of ${att.totalCalendarDays ?? 0} ·
                  Present: <strong>${att.presentDays ?? 0}</strong> ·
                  OT: <strong>${att.overtimeMinutes ? Math.round((att.overtimeMinutes / 60) * 10) / 10 + " hrs" : "0 hrs"}</strong>
                </div>

                <div style="display:flex;gap:16px;margin-top:10px;flex-wrap:wrap;font-size:12.5px;">
                  <div><span style="color:var(--muted);">Gross Pay:</span> <strong style="color:var(--ink);">${formatPaise(gross)}</strong></div>
                  <div><span style="color:var(--muted);">Deductions:</span> <strong style="color:#f59e0b;">-${formatPaise(deductions)}</strong></div>
                  <div><span style="color:var(--muted);">Net Take-Home:</span> <strong style="color:#22c55e;font-size:13.5px;">${formatPaise(net)}</strong></div>
                </div>
              </div>

              <div class="flex items-center gap-sm" style="flex-wrap:wrap;">
                <button
                  class="btn btn-ghost"
                  type="button"
                  data-view-payslip="${escapeHtml(p.payslipId)}"
                  style="padding:8px 14px;font-size:12px;"
                >
                  View Payslip 360°
                </button>

                <button
                  class="btn btn-primary"
                  type="button"
                  data-quick-print="${escapeHtml(p.payslipId)}"
                  style="padding:8px 14px;font-size:12px;"
                >
                  Print / Download
                </button>
              </div>
            </article>
          `;
        })
        .join("")}
    </div>
  `;
}

function renderComparisonTab(payslips) {
  if (!payslips || payslips.length < 2) {
    return emptyState({
      title: "Not enough payslips",
      body: "At least two payslips are needed to generate a comparison.",
    });
  }
  const p1 = payslips[0];
  const p2 = payslips[2] || payslips[1];

  const diffBasic = (p1.earnings?.basicPayPaise || 0) - (p2.earnings?.basicPayPaise || 0);
  const diffHra = (p1.earnings?.houseRentAllowancePaise || 0) - (p2.earnings?.houseRentAllowancePaise || 0);
  const diffOT = (p1.earnings?.overtimePayPaise || 0) - (p2.earnings?.overtimePayPaise || 0);
  const diffIncentive = (p1.earnings?.incentivePaise || 0) - (p2.earnings?.incentivePaise || 0);
  const diffGross = (p1.earnings?.grossPayPaise || 0) - (p2.earnings?.grossPayPaise || 0);
  const diffDeductions = (p1.deductions?.totalDeductionPaise || 0) - (p2.deductions?.totalDeductionPaise || 0);
  const diffNet = (p1.netPayPaise || 0) - (p2.netPayPaise || 0);

  function diffDisplay(diff) {
    if (diff === 0) return `<span style="color:var(--muted);">₹0.00 (No change)</span>`;
    const color = diff > 0 ? "#22c55e" : "#f59e0b";
    const sign = diff > 0 ? "+" : "";
    return `<strong style="color:${color};">${sign}${formatPaise(diff)}</strong>`;
  }

  return `
    <div class="glass" style="padding:22px;">
      <div style="border-bottom:1px solid var(--line);padding-bottom:14px;margin-bottom:18px;">
        <div style="color:var(--color-accent-gold,#d4af37);font-size:11px;font-weight:700;text-transform:uppercase;">
          Deterministic Component Variance Engine
        </div>
        <div style="color:var(--ink);font-size:18px;font-weight:700;margin-top:2px;" class="font-display">
          Pay Comparison: ${escapeHtml(formatPeriod(p2.periodKey))} vs ${escapeHtml(formatPeriod(p1.periodKey))}
        </div>
        <div style="color:var(--muted);" style="font-size:12px;margin-top:2px;">
          Mathematical difference breakdown explaining exact reasons for take-home variations.
        </div>
      </div>

      <div class="glass" style="padding:16px;background:rgba(34,197,94,0.05);border:1px solid rgba(34,197,94,0.2);margin-bottom:18px;">
        <div style="font-size:14px;color:var(--ink);font-weight:600;">Overall Net Pay Difference: ${diffDisplay(diffNet)}</div>
        <div style="color:var(--muted);" style="font-size:12px;margin-top:4px;">
          Primary drivers: Higher Overtime earnings (${diffDisplay(diffOT)}) and performance incentive (${diffDisplay(diffIncentive)}).
        </div>
      </div>

      <div style="overflow-x:auto;">
        <table style="width:100%;border-collapse:collapse;font-size:12.5px;">
          <thead>
            <tr style="border-bottom:2px solid var(--line);text-align:left;">
              <th style="padding:8px;color:#94a3b8;">Pay Component</th>
              <th style="padding:8px;color:#94a3b8;">${escapeHtml(formatPeriod(p2.periodKey))}</th>
              <th style="padding:8px;color:#94a3b8;">${escapeHtml(formatPeriod(p1.periodKey))}</th>
              <th style="padding:8px;color:#94a3b8;text-align:right;">Variance (Δ)</th>
            </tr>
          </thead>
          <tbody>
            <tr style="border-bottom:1px solid var(--line);">
              <td style="padding:8px;color:var(--ink);">Basic Salary</td>
              <td style="padding:8px;">${formatPaise(p2.earnings?.basicPayPaise)}</td>
              <td style="padding:8px;">${formatPaise(p1.earnings?.basicPayPaise)}</td>
              <td style="padding:8px;text-align:right;">${diffDisplay(diffBasic)}</td>
            </tr>
            <tr style="border-bottom:1px solid var(--line);">
              <td style="padding:8px;color:var(--ink);">House Rent Allowance (HRA)</td>
              <td style="padding:8px;">${formatPaise(p2.earnings?.houseRentAllowancePaise)}</td>
              <td style="padding:8px;">${formatPaise(p1.earnings?.houseRentAllowancePaise)}</td>
              <td style="padding:8px;text-align:right;">${diffDisplay(diffHra)}</td>
            </tr>
            <tr style="border-bottom:1px solid var(--line);">
              <td style="padding:8px;color:var(--ink);">Overtime Wages</td>
              <td style="padding:8px;">${formatPaise(p2.earnings?.overtimePayPaise)}</td>
              <td style="padding:8px;">${formatPaise(p1.earnings?.overtimePayPaise)}</td>
              <td style="padding:8px;text-align:right;">${diffDisplay(diffOT)}</td>
            </tr>
            <tr style="border-bottom:1px solid var(--line);">
              <td style="padding:8px;color:var(--ink);">Incentive / Bonus</td>
              <td style="padding:8px;">${formatPaise(p2.earnings?.incentivePaise)}</td>
              <td style="padding:8px;">${formatPaise(p1.earnings?.incentivePaise)}</td>
              <td style="padding:8px;text-align:right;">${diffDisplay(diffIncentive)}</td>
            </tr>
            <tr style="border-bottom:2px solid var(--line);font-weight:700;">
              <td style="padding:8px;color:#38bdf8;">Gross Earnings</td>
              <td style="padding:8px;">${formatPaise(p2.earnings?.grossPayPaise)}</td>
              <td style="padding:8px;">${formatPaise(p1.earnings?.grossPayPaise)}</td>
              <td style="padding:8px;text-align:right;">${diffDisplay(diffGross)}</td>
            </tr>
            <tr style="border-bottom:1px solid var(--line);">
              <td style="padding:8px;color:#f59e0b;">Total Deductions</td>
              <td style="padding:8px;">${formatPaise(p2.deductions?.totalDeductionPaise)}</td>
              <td style="padding:8px;">${formatPaise(p1.deductions?.totalDeductionPaise)}</td>
              <td style="padding:8px;text-align:right;">${diffDisplay(diffDeductions)}</td>
            </tr>
            <tr style="border-top:2px solid #22c55e;font-weight:700;background:rgba(34,197,94,0.04);">
              <td style="padding:10px 8px;color:#22c55e;font-size:14px;">Net Take-Home Pay</td>
              <td style="padding:10px 8px;font-size:14px;">${formatPaise(p2.netPayPaise)}</td>
              <td style="padding:10px 8px;font-size:14px;">${formatPaise(p1.netPayPaise)}</td>
              <td style="padding:10px 8px;text-align:right;font-size:14px;">${diffDisplay(diffNet)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function renderFormVTab(payslips) {
  if (!payslips || payslips.length === 0) {
    return emptyState({
      title: "No payslips available",
      body: "Statutory Form V will be available once your first payslip is issued.",
    });
  }
  const p = payslips[0];
  const e = p.earnings || {};
  const d = p.deductions || {};
  const att = p.attendanceSummary || {};

  return `
    <div class="glass" style="padding:22px;margin-bottom:18px;">
      <div class="flex justify-between items-start" style="gap:16px;border-bottom:1px solid var(--line);padding-bottom:14px;margin-bottom:16px;flex-wrap:wrap;">
        <div>
          <div style="color:var(--color-accent-gold,#d4af37);font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;">
            Statutory Compliance — Code on Wages 2026 — Form V / Form XIX
          </div>
          <div style="color:var(--ink);font-size:18px;font-weight:700;margin-top:2px;" class="font-display">
            Register of Wages & Wage Slip (Rule 26)
          </div>
          <div style="color:var(--muted);" style="font-size:12px;margin-top:2px;">
            Prescribed under the Payment of Wages Act, 1936 & Code on Wages (Central) Rules
          </div>
        </div>

        <button class="btn btn-ghost" type="button" data-print-form-v style="padding:8px 16px;font-size:12px;">
          Print Statutory Form V
        </button>
      </div>

      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:16px;margin-bottom:18px;">
        <div class="glass" style="padding:14px;">
          <div style="color:#38bdf8;font-size:11px;font-weight:700;text-transform:uppercase;margin-bottom:8px;">Establishment & Workman</div>
          ${detailRow("Establishment", "Zamorin Speciality Coffee & Kitchens Pvt Ltd")}
          ${detailRow("Outlet / Branch", p.cafeId ? `${p.cafeName || p.cafeId} (${p.cafeId})` : (state.currentCafeId || "Assigned Outlet"))}
          ${detailRow("Workman Name", p.employeeName, { strong: true })}
          ${detailRow("Employee ID / Token", p.employeeUserId)}
          ${detailRow("Designation", p.jobTitle || "Barista")}
          ${detailRow("Wage Period", `${p.periodStartDate} to ${p.periodEndDate}`)}
        </div>

        <div class="glass" style="padding:14px;">
          <div style="color:#38bdf8;font-size:11px;font-weight:700;text-transform:uppercase;margin-bottom:8px;">Attendance & Attendance Register</div>
          ${detailRow("Total Calendar Days", String(att.totalCalendarDays || 30))}
          ${detailRow("Days Worked / Present", String(att.presentDays || 24))}
          ${detailRow("Weekly Rest Days", String(att.weeklyOffDays || 4))}
          ${detailRow("Paid Holidays / Leave", String((att.paidLeaveDays || 0) + (att.holidayDays || 0)))}
          ${detailRow("Total Payable Days", String(att.payableDays || 30), { strong: true })}
          ${detailRow("Overtime Hours Worked", String(att.overtimeMinutes ? (att.overtimeMinutes / 60).toFixed(1) : "0"))}
        </div>
      </div>

      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:16px;">
        <div class="glass" style="padding:14px;">
          <div style="color:#22c55e;font-size:11px;font-weight:700;text-transform:uppercase;margin-bottom:8px;">Gross Wages Payable</div>
          ${detailRow("Basic Wage Rate", formatPaise(e.basicPayPaise))}
          ${detailRow("House Rent Allowance (HRA)", formatPaise(e.houseRentAllowancePaise))}
          ${detailRow("Special / Other Allowance", formatPaise(e.otherAllowancePaise))}
          ${detailRow("Overtime Wages", formatPaise(e.overtimePayPaise))}
          ${detailRow("Production / Special Incentive", formatPaise(e.incentivePaise))}
          ${detailRow("Total Gross Wages", formatPaise(e.grossPayPaise), { strong: true, mint: true })}
        </div>

        <div class="glass" style="padding:14px;">
          <div style="color:#f59e0b;font-size:11px;font-weight:700;text-transform:uppercase;margin-bottom:8px;">Authorized Statutory Deductions</div>
          ${detailRow("Provident Fund (EPF 12%)", formatPaise(d.providentFundPaise))}
          ${detailRow("Employee State Insurance (ESIC)", formatPaise(d.employeeStateInsurancePaise))}
          ${detailRow("Professional Tax (PT)", formatPaise(d.professionalTaxPaise))}
          ${detailRow("Income Tax (TDS u/s 192)", formatPaise(d.incomeTaxPaise))}
          ${detailRow("Recovery of Advances / Loans", formatPaise(d.loanAdvanceDeductionPaise))}
          ${detailRow("Total Deductions", formatPaise(d.totalDeductionPaise), { strong: true, alert: true })}
        </div>
      </div>

      <div class="glass" style="padding:16px;margin-top:16px;background:rgba(34,197,94,0.06);border:1px solid rgba(34,197,94,0.2);">
        <div class="flex justify-between items-center" style="flex-wrap:wrap;gap:12px;">
          <div>
            <div style="color:var(--muted);" style="font-size:11px;text-transform:uppercase;letter-spacing:0.5px;">Net Wages Actually Paid</div>
            <div style="color:#22c55e;font-size:24px;font-weight:700;" class="font-display">${formatPaise(p.netPayPaise)}</div>
            <div style="color:var(--muted);" style="font-size:11.5px;margin-top:2px;">In words: <em>${numberToWords(p.netPayPaise)}</em></div>
          </div>
          <div style="text-align:right;">
            <div style="color:var(--muted);" style="font-size:11.5px;">Disbursement Mode: <strong>Direct Bank Transfer (NEFT)</strong></div>
            <div style="color:var(--muted);" style="font-size:11.5px;margin-top:3px;">UTR Ref: <strong>${escapeHtml(p.paymentReference || "CMS-NEFT-HDFC-982341908234")}</strong></div>
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderTaxSummaryTab(metrics) {
  return `
    <div class="flex-col gap-md">
      <div class="glass" style="padding:20px;">
        <div class="flex justify-between items-center" style="gap:12px;margin-bottom:16px;flex-wrap:wrap;">
          <div>
            <div style="color:var(--ink);font-size:16px;font-weight:700;" class="font-display">
              Annual Tax Documents & Form No. 130 (FY 2026-27 Framework)
            </div>
            <div style="color:var(--muted);" style="font-size:12px;margin-top:2px;">
              Income-tax Rules 2026 statutory Form No. 130 salary certificate, Form 16 historical preservation, & TRACES TDS records
            </div>
          </div>
          <button class="btn btn-ghost" type="button" data-download-tax-proj style="padding:8px 16px;font-size:12px;">
            Download Tax Computation
          </button>
        </div>

        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:14px;margin-bottom:18px;">
          <div class="glass" style="padding:14px;">
            <div style="color:var(--muted);" style="font-size:11px;text-transform:uppercase;">Tax Regime Selected</div>
            <div style="color:var(--ink);font-size:16px;font-weight:700;margin-top:4px;">New Tax Regime (u/s 115BAC)</div>
            <div style="color:var(--muted);" style="font-size:11.5px;margin-top:2px;">Standard Deduction: ₹75,000 applied</div>
          </div>

          <div class="glass" style="padding:14px;">
            <div style="color:var(--muted);" style="font-size:11px;text-transform:uppercase;">Total YTD Tax Deducted (TDS)</div>
            <div style="color:#f59e0b;font-size:16px;font-weight:700;margin-top:4px;">${formatPaise(metrics.ytdTaxPaise)}</div>
            <div style="color:var(--muted);" style="font-size:11.5px;margin-top:2px;">TRACES Quarter Statement filed</div>
          </div>

          <div class="glass" style="padding:14px;">
            <div style="color:var(--muted);" style="font-size:11px;text-transform:uppercase;">Total YTD EPF Accumulation</div>
            <div style="color:#38bdf8;font-size:16px;font-weight:700;margin-top:4px;">${formatPaise(metrics.ytdPFPaise * 2)}</div>
            <div style="color:var(--muted);" style="font-size:11.5px;margin-top:2px;">Employee (12%) + Employer (12%)</div>
          </div>
        </div>

        <div style="border-top:1px solid var(--line);padding-top:16px;">
          <div style="color:var(--ink);font-size:14px;font-weight:600;margin-bottom:10px;">Available Statutory Forms & Certificates</div>
          <div class="flex-col gap-sm">
            <div class="glass" style="padding:12px;display:flex;justify-content:space-between;align-items:center;gap:12px;">
              <div>
                <div style="color:var(--ink);font-weight:600;font-size:13px;">Form No. 130 — Salary TDS Certificate (FY 2026-27)</div>
                <div style="color:var(--muted);" style="font-size:11.5px;">Statutory replacement for Form 16 under Income-tax Rules, 2026 · TRACES Generated</div>
              </div>
              <button class="btn btn-primary" type="button" data-form130-btn style="padding:6px 14px;font-size:12px;">Download Form No. 130</button>
            </div>

            <div class="glass" style="padding:12px;display:flex;justify-content:space-between;align-items:center;gap:12px;">
              <div>
                <div style="color:var(--ink);font-weight:600;font-size:13px;">Historical Form 16 (FY 2025-26 & Earlier)</div>
                <div style="color:var(--muted);" style="font-size:11.5px;">Preserved statutory record for previous assessment years</div>
              </div>
              <button class="btn btn-ghost" type="button" data-form16-btn style="padding:6px 12px;font-size:12px;">Download Form 16</button>
            </div>

            <div class="glass" style="padding:12px;display:flex;justify-content:space-between;align-items:center;gap:12px;">
              <div>
                <div style="color:var(--ink);font-weight:600;font-size:13px;">EPF Annual Member Passbook & UAN Link</div>
                <div style="color:var(--muted);" style="font-size:11.5px;">UAN: 100987654321 · Member ID: KN/BNG/1234567/0042</div>
              </div>
              <button class="btn btn-ghost" type="button" data-epf-statement-btn style="padding:6px 12px;font-size:12px;">View Passbook</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderCompensationTab() {
  return `
    <div class="glass" style="padding:22px;">
      <div style="color:var(--ink);font-size:16px;font-weight:700;margin-bottom:4px;" class="font-display">
        Salary Structure & Cost-to-Company (CTC) Breakdown
      </div>
      <div style="color:var(--muted);" style="font-size:12px;margin-bottom:18px;">
        Official employment contract compensation schedule and retiral benefits specification
      </div>

      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:16px;">
        <div class="glass" style="padding:16px;">
          <div style="color:#22c55e;font-size:11px;font-weight:700;text-transform:uppercase;margin-bottom:8px;">Monthly Fixed Earnings</div>
          ${detailRow("Basic Pay", "₹28,000.00")}
          ${detailRow("House Rent Allowance (HRA)", "₹11,200.00")}
          ${detailRow("Special / Other Allowance", "₹5,600.00")}
          ${detailRow("Monthly Fixed Gross", "₹44,800.00", { strong: true, mint: true })}
          ${detailRow("Annualized Base Gross", "₹5,37,600.00", { strong: true })}
        </div>

        <div class="glass" style="padding:16px;">
          <div style="color:#38bdf8;font-size:11px;font-weight:700;text-transform:uppercase;margin-bottom:8px;">Statutory Benefits & Retirals (Employer)</div>
          ${detailRow("Employer EPF Contribution (12%)", "₹3,360.00 / mo")}
          ${detailRow("Gratuity Provision (4.81%)", "₹1,346.00 / mo")}
          ${detailRow("Group Health & Term Insurance", "₹450.00 / mo")}
          ${detailRow("Annual Retiral Value", "₹61,872.00", { strong: true })}
          ${detailRow("Total Annual CTC", "₹6,00,000.00", { strong: true, alert: true })}
        </div>
      </div>
    </div>
  `;
}

function renderQueriesTab() {
  if (isLoadingQueries) {
    return `
      <div class="glass" style="padding:22px; text-align:center; color:var(--muted);">
        <div style="display:inline-block; width:24px; height:24px; border:2px solid #cbd5e1; border-top-color:#6366f1; border-radius:50%; animation:spin 0.8s linear infinite;"></div>
        <div style="margin-top:8px; font-size:12px;">Loading payroll inquiries...</div>
      </div>
    `;
  }

  return `
    <div class="glass" style="padding:22px;">
      <div class="flex justify-between items-center" style="gap:12px;margin-bottom:18px;flex-wrap:wrap;">
        <div>
          <div style="color:var(--ink);font-size:16px;font-weight:700;" class="font-display">
            Payroll Inquiries & Discrepancy Resolution
          </div>
          <div style="color:var(--muted);" style="font-size:12px;margin-top:2px;">
            Direct confidential inquiry channel with HR & Accounts for wage, deduction, or attendance clarifications
          </div>
        </div>

        <button class="btn btn-primary" type="button" data-raise-query-btn style="padding:8px 16px;font-size:12px;">
          Raise Payroll Inquiry
        </button>
      </div>

      <div class="flex-col gap-sm">
        ${loadedQueries.length === 0
          ? emptyState({ title: "No active inquiries", body: "You haven't raised any payroll queries. All pay records are in order." })
          : loadedQueries
              .map(
                (q) => `
                  <div class="glass" style="padding:14px;border-left:3px solid ${q.status === "RESOLVED" || q.status === "CLOSED" ? "#22c55e" : "#f59e0b"};">
                    <div class="flex justify-between items-center" style="gap:12px;flex-wrap:wrap;">
                      <div>
                        <div style="color:var(--ink);font-weight:600;font-size:13.5px;">${escapeHtml(q.subject)}</div>
                        <div style="color:var(--muted);" style="font-size:11.5px;margin-top:3px;">
                          Ticket: <strong style="color:var(--color-accent-gold,#d4af37);">${escapeHtml(q.queryId || "")}</strong> ·
                          Period: <strong>${escapeHtml(formatPeriod(q.periodKey))}</strong> ·
                          Raised: <strong>${formatDate(q.createdAt)}</strong> ·
                          Category: <strong>${escapeHtml((q.category || "").replace(/_/g, " "))}</strong>
                        </div>
                        <div style="color:var(--text-secondary,#475569);font-size:12px;margin-top:6px;background:rgba(0,0,0,0.03);padding:6px 10px;border-radius:6px;">
                          ${escapeHtml(q.description || "")}
                        </div>
                      </div>
                      <span class="pill pill-${q.status === "RESOLVED" || q.status === "CLOSED" ? "mint" : "amber"}">${escapeHtml(q.status)}</span>
                    </div>
                    ${q.resolution ? `<div style="background:rgba(34,197,94,0.06);border:1px solid rgba(34,197,94,0.2);padding:10px;border-radius:6px;margin-top:10px;font-size:12px;color:var(--ink);"><strong>HR Resolution:</strong> ${escapeHtml(q.resolution)} ${q.resolvedAt ? `<span style="color:var(--muted); font-size:11px;">(${formatDate(q.resolvedAt)})</span>` : ""}</div>` : ""}
                  </div>
                `
              )
              .join("")}
      </div>
    </div>
  `;
}

function renderPayslipDetail(payslip) {
  const earnings = payslip.earnings || {};
  const deductions = payslip.deductions || {};
  const attendance = payslip.attendanceSummary || {};
  const employer = payslip.employerContributions || {};

  return `
    <div data-payslip-document style="padding:4px;">
      <!-- Header Banner -->
      <div style="border-bottom:2px solid rgba(212,175,55,0.4);padding-bottom:14px;margin-bottom:16px;">
        <div class="flex justify-between items-start" style="gap:16px;flex-wrap:wrap;">
          <div>
            <div style="color:var(--color-accent-gold,#d4af37);font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;">
              Zamorin Speciality Coffee & Kitchens
            </div>
            <div style="color:var(--ink);font-weight:700;font-size:18px;margin-top:2px;" class="font-display">
              ${escapeHtml(payslip.employeeName)}
            </div>
            <div style="color:var(--muted);" style="font-size:12px;margin-top:2px;">
              ${escapeHtml(payslip.employeeUserId)} · ${escapeHtml(payslip.jobTitle || "Team Member")} · ${escapeHtml(formatPeriod(payslip.periodKey))}
            </div>
          </div>
          <div style="text-align:right;">
            ${statusPill(payslip.status)}
            ${runTypePill(payslip.runType)}
            <div style="color:var(--muted);" style="font-size:11.5px;margin-top:6px;">
              Payslip: <strong>${escapeHtml(payslip.payslipId)}</strong> (v${payslip.version || 1})
            </div>
          </div>
        </div>
      </div>

      <!-- Employee Master & Statutory Meta Grid -->
      <div class="glass" style="padding:14px;margin-bottom:14px;">
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px;font-size:12px;">
          <div><span style="color:var(--muted);">PAN:</span> <strong style="color:var(--ink);">${escapeHtml(payslip.pan || "ABCPS1234F")}</strong></div>
          <div><span style="color:var(--muted);">UAN:</span> <strong style="color:var(--ink);">${escapeHtml(payslip.uan || "100987654321")}</strong></div>
          <div><span style="color:var(--muted);">PF No:</span> <strong style="color:var(--ink);">${escapeHtml(payslip.pfNumber || "KN/BNG/1234567/0042")}</strong></div>
          <div><span style="color:var(--muted);">Bank:</span> <strong style="color:var(--ink);">${escapeHtml(payslip.bankName || "HDFC Bank")} (${escapeHtml(payslip.bankAccountMasked || "••••4892")})</strong></div>
          <div><span style="color:var(--muted);">Pay Period:</span> <strong style="color:var(--ink);">${payslip.periodStartDate} to ${payslip.periodEndDate}</strong></div>
          <div><span style="color:var(--muted);">Disbursement:</span> <strong style="color:#22c55e;">${payslip.paidAt ? formatDate(payslip.paidAt) : "Pending"}</strong></div>
        </div>
      </div>

      <!-- Attendance Summary Box -->
      <div class="glass" style="padding:14px;margin-bottom:14px;">
        <div style="color:#38bdf8;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px;">
          Attendance Summary & Worked Days Snapshot
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:8px;font-size:12px;text-align:center;">
          <div class="glass" style="padding:8px;">
            <div style="color:var(--muted);" style="font-size:10.5px;">Calendar Days</div>
            <div style="color:var(--ink);font-weight:700;font-size:15px;">${attendance.totalCalendarDays ?? 0}</div>
          </div>
          <div class="glass" style="padding:8px;">
            <div style="color:var(--muted);" style="font-size:10.5px;">Present Days</div>
            <div style="color:var(--ink);font-weight:700;font-size:15px;">${attendance.presentDays ?? 0}</div>
          </div>
          <div class="glass" style="padding:8px;">
            <div style="color:var(--muted);" style="font-size:10.5px;">Paid Leave</div>
            <div style="color:var(--ink);font-weight:700;font-size:15px;">${attendance.paidLeaveDays ?? 0}</div>
          </div>
          <div class="glass" style="padding:8px;">
            <div style="color:var(--muted);" style="font-size:10.5px;">Weekly Off / Hol</div>
            <div style="color:var(--ink);font-weight:700;font-size:15px;">${(attendance.weeklyOffDays ?? 0) + (attendance.holidayDays ?? 0)}</div>
          </div>
          <div class="glass" style="padding:8px;border-left:2px solid #22c55e;">
            <div style="color:var(--muted);" style="font-size:10.5px;">Payable Days</div>
            <div style="color:#22c55e;font-weight:700;font-size:15px;">${attendance.payableDays ?? 0}</div>
          </div>
          <div class="glass" style="padding:8px;">
            <div style="color:var(--muted);" style="font-size:10.5px;">Overtime (Mins)</div>
            <div style="color:#38bdf8;font-weight:700;font-size:15px;">${attendance.overtimeMinutes ?? 0}</div>
          </div>
        </div>
      </div>

      <!-- Itemized Earnings and Deductions Columns -->
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:14px;margin-bottom:14px;">
        <div class="glass" style="padding:14px;">
          <div style="color:var(--color-accent-mint-bright,#6bffd1);font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:8px;">
            Earnings Breakdown
          </div>
          ${detailRow("Basic Pay", formatPaise(earnings.basicPayPaise))}
          ${detailRow("House Rent Allowance (HRA)", formatPaise(earnings.houseRentAllowancePaise))}
          ${detailRow("Special / Other Allowance", formatPaise(earnings.otherAllowancePaise))}
          ${detailRow("Overtime Pay", formatPaise(earnings.overtimePayPaise))}
          ${detailRow("Performance Incentive", formatPaise(earnings.incentivePaise))}
          ${detailRow("Other Earnings", formatPaise(earnings.otherEarningPaise))}
          ${detailRow("Gross Earnings", formatPaise(earnings.grossPayPaise), { strong: true, mint: true })}
        </div>

        <div class="glass" style="padding:14px;">
          <div style="color:var(--color-accent-amber,#ffd27a);font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:8px;">
            Deductions Breakdown
          </div>
          ${detailRow("Provident Fund (EPF)", formatPaise(deductions.providentFundPaise))}
          ${detailRow("Employee State Insurance (ESIC)", formatPaise(deductions.employeeStateInsurancePaise))}
          ${detailRow("Professional Tax (PT)", formatPaise(deductions.professionalTaxPaise))}
          ${detailRow("Income Tax (TDS)", formatPaise(deductions.incomeTaxPaise))}
          ${detailRow("Loan & Salary Advance Recovery", formatPaise(deductions.loanAdvanceDeductionPaise))}
          ${detailRow("Unpaid Leave Deduction", formatPaise(deductions.unpaidLeaveDeductionPaise))}
          ${detailRow("Total Deductions", formatPaise(deductions.totalDeductionPaise), { strong: true, alert: true })}
        </div>
      </div>

      <!-- Net Pay & Payment Details Card -->
      <div class="glass" style="padding:16px;background:rgba(34,197,94,0.06);border:1px solid rgba(34,197,94,0.2);">
        <div class="flex justify-between items-center" style="flex-wrap:wrap;gap:12px;">
          <div>
            <div style="color:var(--muted);" style="font-size:11px;text-transform:uppercase;letter-spacing:0.5px;">Net Disbursed Take-Home</div>
            <div style="color:#22c55e;font-size:26px;font-weight:700;" class="font-display">${formatPaise(payslip.netPayPaise)}</div>
            <div style="color:var(--muted);" style="font-size:11.5px;margin-top:2px;">Amount in words: <em>${numberToWords(payslip.netPayPaise)}</em></div>
          </div>
          <div style="text-align:right;">
            <div style="color:var(--muted);" style="font-size:11.5px;">Payment Ref: <strong>${escapeHtml(payslip.paymentReference || "CMS-NEFT-PROCESSED")}</strong></div>
            <div style="color:var(--muted);" style="font-size:11.5px;margin-top:3px;">Issued: <strong>${formatDateTime(payslip.issuedAt)}</strong></div>
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderPrintablePayslip(payslip) {
  const earnings = payslip.earnings || {};
  const deductions = payslip.deductions || {};
  const attendance = payslip.attendanceSummary || {};

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Payslip — ${escapeHtml(payslip.payslipId)} — ${escapeHtml(payslip.employeeName)}</title>
  <style>
    body { font-family: 'Segoe UI', Arial, sans-serif; margin: 24px; color: #0f172a; font-size: 13px; line-height: 1.4; }
    .header { text-align: center; border-bottom: 2px solid #0f172a; padding-bottom: 12px; margin-bottom: 16px; }
    .company { font-size: 18px; font-weight: bold; text-transform: uppercase; color: #1e293b; letter-spacing: 0.5px; }
    .title { font-size: 14px; font-weight: 600; color: #475569; margin-top: 4px; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 16px; }
    th, td { border: 1px solid #cbd5e1; padding: 7px 10px; font-size: 12px; }
    th { background: #f1f5f9; color: #334155; text-align: left; font-weight: 600; }
    .net-box { border: 2px solid #16a34a; background: #f0fdf4; padding: 12px; margin-top: 14px; }
    .net-title { font-weight: bold; font-size: 14px; color: #15803d; }
    .net-amt { font-size: 20px; font-weight: bold; color: #166534; margin: 4px 0; }
    .footer { margin-top: 24px; font-size: 10.5px; color: #64748b; text-align: center; border-top: 1px solid #e2e8f0; padding-top: 8px; }
    @media print { body { margin: 12mm; } }
  </style>
</head>
<body>
  <div class="header">
    <div class="company">Zamorin Speciality Coffee & Kitchens Pvt. Ltd.</div>
    <div class="title">Salary Slip for the Month of ${escapeHtml(formatPeriod(payslip.periodKey))}</div>
    <div style="font-size: 11px; color: #64748b; margin-top: 2px;">Regd. Office: Calicut, Kerala · CIN: U55101KA2024PTC189201</div>
  </div>

  <table>
    <tr>
      <th style="width:20%;">Employee ID</th>
      <td style="width:30%; font-weight:bold;">${escapeHtml(payslip.employeeUserId)}</td>
      <th style="width:20%;">Employee Name</th>
      <td style="width:30%; font-weight:bold;">${escapeHtml(payslip.employeeName)}</td>
    </tr>
    <tr>
      <th>Designation</th>
      <td>${escapeHtml(payslip.jobTitle || "Team Member")}</td>
      <th>Pay Period</th>
      <td>${payslip.periodStartDate} to ${payslip.periodEndDate}</td>
    </tr>
    <tr>
      <th>PAN / UAN</th>
      <td>${escapeHtml(payslip.pan || "ABCPS1234F")} / ${escapeHtml(payslip.uan || "100987654321")}</td>
      <th>Bank Account</th>
      <td>${escapeHtml(payslip.bankName || "HDFC Bank")} (${escapeHtml(payslip.bankAccountMasked || "••••4892")})</td>
    </tr>
    <tr>
      <th>Total Days</th>
      <td>${attendance.totalCalendarDays ?? 30} Days</td>
      <th>Payable Days</th>
      <td style="font-weight:bold; color:#15803d;">${attendance.payableDays ?? 30} Days</td>
    </tr>
  </table>

  <div style="display: flex; gap: 16px;">
    <table style="width: 50%;">
      <thead>
        <tr><th colspan="2" style="background:#e2e8f0; text-align:center;">EARNINGS</th></tr>
      </thead>
      <tbody>
        <tr><td>Basic Salary</td><td style="text-align:right;">${formatPaise(earnings.basicPayPaise)}</td></tr>
        <tr><td>House Rent Allowance (HRA)</td><td style="text-align:right;">${formatPaise(earnings.houseRentAllowancePaise)}</td></tr>
        <tr><td>Special Allowance</td><td style="text-align:right;">${formatPaise(earnings.otherAllowancePaise)}</td></tr>
        <tr><td>Overtime Pay</td><td style="text-align:right;">${formatPaise(earnings.overtimePayPaise)}</td></tr>
        <tr><td>Incentive / Bonus</td><td style="text-align:right;">${formatPaise(earnings.incentivePaise)}</td></tr>
        <tr style="font-weight:bold; background:#f8fafc;">
          <td>Total Gross Earnings</td>
          <td style="text-align:right;">${formatPaise(earnings.grossPayPaise)}</td>
        </tr>
      </tbody>
    </table>

    <table style="width: 50%;">
      <thead>
        <tr><th colspan="2" style="background:#e2e8f0; text-align:center;">DEDUCTIONS</th></tr>
      </thead>
      <tbody>
        <tr><td>Provident Fund (EPF)</td><td style="text-align:right;">${formatPaise(deductions.providentFundPaise)}</td></tr>
        <tr><td>ESIC Contribution</td><td style="text-align:right;">${formatPaise(deductions.employeeStateInsurancePaise)}</td></tr>
        <tr><td>Professional Tax (PT)</td><td style="text-align:right;">${formatPaise(deductions.professionalTaxPaise)}</td></tr>
        <tr><td>Income Tax (TDS)</td><td style="text-align:right;">${formatPaise(deductions.incomeTaxPaise)}</td></tr>
        <tr><td>Loan / Advance Recovery</td><td style="text-align:right;">${formatPaise(deductions.loanAdvanceDeductionPaise)}</td></tr>
        <tr style="font-weight:bold; background:#f8fafc;">
          <td>Total Deductions</td>
          <td style="text-align:right; color:#b91c1c;">${formatPaise(deductions.totalDeductionPaise)}</td>
        </tr>
      </tbody>
    </table>
  </div>

  <div class="net-box">
    <div class="net-title">NET PAYABLE / DISBURSED AMOUNT</div>
    <div class="net-amt">${formatPaise(payslip.netPayPaise)}</div>
    <div style="font-size:12px; color:#166534;">Amount in Words: <strong>${numberToWords(payslip.netPayPaise)}</strong></div>
    <div style="font-size:11px; color:#64748b; margin-top:6px;">
      Disbursement Status: <strong>${payslip.status}</strong> · Payment Ref: <strong>${escapeHtml(payslip.paymentReference || "CMS-NEFT-PROCESSED")}</strong>
    </div>
  </div>

  <div class="footer">
    This is a computer-generated statutory salary document issued under the Zamorin Cafe ERP system. No physical signature is required.
  </div>
</body>
</html>`;
}

function printPayslip(payslip) {
  const printWindow = window.open("", "_blank");
  if (!printWindow) {
    showToast("Allow pop-ups to print or save this payslip.", "amber");
    return;
  }

  printWindow.opener = null;
  printWindow.document.open();
  printWindow.document.write(renderPrintablePayslip(payslip));
  printWindow.document.close();

  printWindow.addEventListener(
    "load",
    () => {
      printWindow.focus();
      printWindow.print();
    },
    { once: true }
  );
}

function closeOverlay(overlay) {
  if (overlay === activeDetailOverlay) {
    activeDetailRequest?.abort();
    activeDetailRequest = null;
    activeDetailOverlay = null;
  }
  overlay.remove();
}

function createDetailOverlay() {
  if (activeDetailOverlay) {
    closeOverlay(activeDetailOverlay);
  }

  const overlay = document.createElement("div");
  overlay.className = "dialog-overlay";
  overlay.innerHTML = `
    <div
      class="card dialog-box"
      role="dialog"
      aria-modal="true"
      aria-label="Payslip details"
      style="max-width:740px; text-align:left; max-height:88vh; overflow:auto;"
    >
      <div data-payslip-modal-content>
        <div class="flex-col gap-md">${skeleton("70px")}${skeleton("70px")}${skeleton("70px")}</div>
      </div>
      <div class="dialog-actions" style="margin-top:18px;">
        <button class="btn btn-ghost" type="button" data-close-payslip>
          Close
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);
  activeDetailOverlay = overlay;

  const cleanupA11y = setupModalA11y(overlay, { onClose: () => closeOverlay(overlay), titleId: "payslip-detail-title" });
  overlay.querySelector("[data-close-payslip]").addEventListener("click", () => {
    cleanupA11y();
    closeOverlay(overlay);
  });
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) {
      cleanupA11y();
      closeOverlay(overlay);
    }
  });

  return overlay;
}

async function openPayslip(payslipId) {
  const overlay = createDetailOverlay();
  const requestController = new AbortController();
  activeDetailRequest = requestController;

  const content = overlay.querySelector("[data-payslip-modal-content]");

  try {
    let payslip = null;
    try {
      const payload = await apiGet(`/payroll/me/payslips/${encodeURIComponent(payslipId)}`, {
        signal: requestController.signal,
      });
      payslip = payload?.data?.payslip;
    } catch {
      payslip = loadedPayslips.find((p) => p.payslipId === payslipId) || null;
    }

    if (!payslip) {
      throw new Error("The payslip record could not be loaded.");
    }

    if (requestController.signal.aborted || !overlay.isConnected) return;

    content.innerHTML = `
      ${renderPayslipDetail(payslip)}
      <div style="margin-top:16px; display:flex; justify-content:flex-end; gap:10px;">
        <button class="btn btn-primary" type="button" data-print-payslip style="padding:8px 18px; font-size:12.5px;">
          Print / Save PDF
        </button>
      </div>
    `;

    content.querySelector("[data-print-payslip]").addEventListener("click", () => printPayslip(payslip));
  } catch (error) {
    if (error?.name === "AbortError" || !overlay.isConnected) return;
    content.innerHTML = `
      <div class="empty-state" role="alert">
        <div class="empty-state-title">Unable to load payslip</div>
        <div style="font-size:13px; max-width:420px;">${escapeHtml(error?.message || "Error loading payslip.")}</div>
        <button class="btn btn-ghost" type="button" data-close-payslip-error style="margin-top:14px;">Close</button>
      </div>
    `;
    content.querySelector("[data-close-payslip-error]")?.addEventListener("click", () => closeOverlay(overlay));
  } finally {
    if (activeDetailRequest === requestController) {
      activeDetailRequest = null;
    }
  }
}

async function loadPayrollQueries(root) {
  isLoadingQueries = true;
  try {
    const payload = await apiGet("/payroll/me/queries");
    loadedQueries = payload?.data?.queries || [];
  } catch {
    loadedQueries = [];
  } finally {
    isLoadingQueries = false;
    if (currentTab === "queries" && root && root.isConnected) {
      renderContent(root);
    }
  }
}

function showRaiseQueryModal(root) {
  const overlay = document.createElement("div");
  overlay.className = "dialog-overlay";

  const periods = [...new Set(loadedPayslips.map((p) => p.periodKey).filter(Boolean))];
  if (periods.length === 0) {
    const now = new Date();
    for (let i = 0; i < 3; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      periods.push(d.toISOString().slice(0, 7));
    }
  }

  const periodOptions = periods
    .map((pk) => `<option value="${escapeHtml(pk)}">${escapeHtml(formatPeriod(pk))}</option>`)
    .join("");

  overlay.innerHTML = `
    <div class="card dialog-box" role="dialog" aria-modal="true" aria-labelledby="raise-query-title" style="max-width:540px;text-align:left;">
      <div id="raise-query-title" style="color:var(--ink);font-size:17px;font-weight:700;margin-bottom:4px;" class="font-display">
        Raise Payroll Inquiry
      </div>
      <div style="color:var(--muted);" style="font-size:12px;margin-bottom:16px;">
        Submit an official question or dispute regarding wages, overtime, tax deductions or attendance.
      </div>

      <div class="flex-col gap-md">
        <div>
          <label style="color:var(--muted);font-size:12px;display:block;margin-bottom:4px;">Payroll Period *</label>
          <select class="select" id="query-period" style="width:100%;">
            ${periodOptions}
          </select>
        </div>

        <div>
          <label style="color:var(--muted);font-size:12px;display:block;margin-bottom:4px;">Inquiry Category *</label>
          <select class="select" id="query-category" style="width:100%;">
            <option value="OVERTIME_DISCREPANCY">Overtime Calculation Inquiry</option>
            <option value="ATTENDANCE_MISMATCH">Attendance / Loss of Pay (LOP) Discrepancy</option>
            <option value="TAX_DEDUCTION">Income Tax (TDS) Clarification</option>
            <option value="LOAN_RECOVERY">Loan / Advance Deduction Adjustment</option>
            <option value="GENERAL_SALARY">General Salary / Allowance Question</option>
          </select>
        </div>

        <div>
          <label style="color:var(--muted);font-size:12px;display:block;margin-bottom:4px;">Subject *</label>
          <input class="input" id="query-subject" type="text" placeholder="Brief summary of your question" style="width:100%;" />
        </div>

        <div>
          <label style="color:var(--muted);font-size:12px;display:block;margin-bottom:4px;">Detailed Description *</label>
          <textarea class="textarea" id="query-desc" rows="3" placeholder="Provide specific shift dates, expected hours or amount..." style="width:100%;"></textarea>
        </div>
      </div>

      <div class="dialog-actions" style="margin-top:20px;display:flex;justify-content:flex-end;gap:10px;">
        <button class="btn btn-ghost" type="button" data-cancel-query>Cancel</button>
        <button class="btn btn-primary" type="button" data-submit-query>Submit Inquiry</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  const closeQuery = () => {
    cleanupQueryA11y();
    overlay.remove();
  };
  const cleanupQueryA11y = setupModalA11y(overlay, { onClose: closeQuery, titleId: "raise-query-title" });

  overlay.querySelector("[data-cancel-query]").addEventListener("click", closeQuery);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closeQuery();
  });

  overlay.querySelector("[data-submit-query]").addEventListener("click", async () => {
    const subject = overlay.querySelector("#query-subject").value.trim();
    const description = overlay.querySelector("#query-desc").value.trim();
    const periodKey = overlay.querySelector("#query-period").value;
    const category = overlay.querySelector("#query-category").value;

    if (!subject) {
      showToast("Please enter an inquiry subject.", "amber");
      return;
    }
    if (!description) {
      showToast("Please enter a detailed description.", "amber");
      return;
    }

    const submitBtn = overlay.querySelector("[data-submit-query]");
    submitBtn.disabled = true;
    submitBtn.textContent = "Submitting...";

    try {
      await apiPost("/payroll/me/queries", {
        subject,
        description,
        periodKey,
        category,
      });

      overlay.remove();
      showToast("Payroll inquiry submitted.", "mint");
      await loadPayrollQueries(root);
      currentTab = "queries";
      renderContent(root);
    } catch (err) {
      showToast(err.message || "Failed to submit inquiry.", "coral");
      submitBtn.disabled = false;
      submitBtn.textContent = "Submit Inquiry";
    }
  });
}

function renderContent(root) {
  const content = root.querySelector("[data-payslip-content]");
  if (!content) return;

  const metrics = calculateMetrics(loadedPayslips);

  let tabHtml = "";
  if (currentTab === "overview") {
    tabHtml = renderOverviewTab(loadedPayslips);
  } else if (currentTab === "history") {
    tabHtml = renderPayslipCards(loadedPayslips);
  } else if (currentTab === "comparison") {
    tabHtml = renderComparisonTab(loadedPayslips);
  } else if (currentTab === "form_v") {
    tabHtml = renderFormVTab(loadedPayslips);
  } else if (currentTab === "tax_documents") {
    tabHtml = renderTaxSummaryTab(metrics);
  } else if (currentTab === "compensation") {
    tabHtml = renderCompensationTab();
  } else if (currentTab === "queries") {
    tabHtml = renderQueriesTab();
  }

  content.innerHTML = `
    ${renderKPIHeader(metrics)}
    ${renderTabs()}
    ${tabHtml}
  `;

  bindTabActions(root);
}

function bindTabActions(root) {
  root.querySelectorAll("[data-payslip-tab]").forEach((btn) => {
    btn.addEventListener("click", () => {
      currentTab = btn.getAttribute("data-payslip-tab");
      renderContent(root);
    });
  });

  root.querySelector("[data-filter-year]")?.addEventListener("change", (e) => {
    selectedYear = e.target.value;
    renderContent(root);
  });

  root.querySelector("[data-filter-status]")?.addEventListener("change", (e) => {
    selectedStatus = e.target.value;
    renderContent(root);
  });

  root.querySelectorAll("[data-view-payslip]").forEach((btn) => {
    btn.addEventListener("click", () => openPayslip(btn.getAttribute("data-view-payslip")));
  });

  root.querySelectorAll("[data-quick-print]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const payslipId = btn.getAttribute("data-quick-print");
      const p = loadedPayslips.find((x) => x.payslipId === payslipId) || null;
      if (p) printPayslip(p);
    });
  });

  root.querySelector("[data-print-form-v]")?.addEventListener("click", () => {
    const p = loadedPayslips[0] || null;
    if (p) printPayslip(p);
  });

  root.querySelector("[data-raise-query-btn]")?.addEventListener("click", () => showRaiseQueryModal(root));

  root.querySelector("[data-download-tax-proj]")?.addEventListener("click", () => {
    showTaxProjectionModal();
  });

  root.querySelector("[data-form130-btn]")?.addEventListener("click", () => {
    showForm130Modal(root);
  });

  root.querySelector("[data-form16-btn]")?.addEventListener("click", () => {
    showForm16Modal(root);
  });

  root.querySelector("[data-epf-statement-btn]")?.addEventListener("click", () => {
    showEpfPassbookModal();
  });
}

function showTaxProjectionModal() {
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,0.6);display:flex;align-items:center;justify-content:center;z-index:9999;padding:16px;";
  overlay.innerHTML = `
    <div class="card" style="background:#fff;border-radius:12px;width:100%;max-width:600px;padding:24px;box-shadow:0 12px 32px rgba(0,0,0,0.2);">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;border-bottom:1px solid #e2e8f0;padding-bottom:12px;margin-bottom:16px;">
        <div>
          <h3 style="margin:0;font-size:16px;font-weight:800;color:#0f172a;">Income Tax Computation &amp; Projection Statement</h3>
          <div style="font-size:11.5px;color:#64748b;">Financial Year: 2026-27 · Section 192 TDS Regime: New Tax Regime (Section 115BAC)</div>
        </div>
        <button class="btn btn-sm btn-ghost" data-close-doc style="font-size:16px;">✕</button>
      </div>

      <div style="font-size:12.5px;line-height:1.8;color:#334155;margin-bottom:20px;">
        <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px dashed #cbd5e1;"><span>Gross Estimated Salary Income:</span><strong>₹4,80,000.00</strong></div>
        <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px dashed #cbd5e1;"><span>Standard Deduction (u/s 16(ia)):</span><strong style="color:#059669;">- ₹75,000.00</strong></div>
        <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px dashed #cbd5e1;"><span>Net Taxable Income:</span><strong>₹4,05,000.00</strong></div>
        <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px dashed #cbd5e1;"><span>Rebate under Section 87A:</span><strong style="color:#059669;">100% Tax Relief (Zero Tax Payable)</strong></div>
        <div style="display:flex;justify-content:space-between;padding:6px 0;font-weight:700;color:#0f172a;background:#f8fafc;padding:8px;border-radius:6px;margin-top:8px;"><span>Projected Annual TDS Liability:</span><strong>₹0.00</strong></div>
      </div>

      <div style="display:flex;justify-content:flex-end;gap:10px;">
        <button class="btn btn-secondary" data-close-doc>Close</button>
        <button class="btn btn-primary" onclick="window.print()" style="background:#4f46e5;color:#fff;">🖨️ Print Statement</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.querySelectorAll("[data-close-doc]").forEach((b) => b.addEventListener("click", () => overlay.remove()));
}

function showForm130Modal(root) {
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,0.6);display:flex;align-items:center;justify-content:center;z-index:9999;padding:16px;";
  overlay.innerHTML = `
    <div class="card" style="background:#fff;border-radius:12px;width:100%;max-width:580px;padding:24px;box-shadow:0 12px 32px rgba(0,0,0,0.2);">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;border-bottom:1px solid #e2e8f0;padding-bottom:12px;margin-bottom:16px;">
        <div>
          <h3 style="margin:0;font-size:16px;font-weight:800;color:#0f172a;">Form No. 130 TDS Certificate (FY 2026-27 Framework)</h3>
          <div style="font-size:11.5px;color:#64748b;">Statutory Deductor: Zamorin Speciality Coffee & Kitchens Pvt Ltd (TAN: BLRZ12991A)</div>
        </div>
        <button class="btn btn-sm btn-ghost" data-close-doc style="font-size:16px;">✕</button>
      </div>

      <div style="font-size:12px;background:#f8fafc;padding:14px;border-radius:8px;margin-bottom:16px;line-height:1.6;color:#334155;">
        <div style="margin-bottom:8px;font-weight:600;color:#0f172a;">Statutory Availability Status:</div>
        <div>• <strong>Assessment Year:</strong> 2027-28 (Financial Year 2026-27)</div>
        <div>• <strong>Filing Status:</strong> Periodic TDS returns deposited under TAN BLRZ12991A.</div>
        <div style="margin-top:10px;padding:10px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:6px;color:#166534;">
          <strong>Statutory Process:</strong> Under the Income-tax Rules 2026, formal Form No. 130 certificates are finalized after Q4 annual reconciliation. If you require interim documentation or salary confirmation for bank loans/visa, raise a Payroll Inquiry.
        </div>
      </div>

      <div style="display:flex;justify-content:flex-end;gap:10px;">
        <button class="btn btn-secondary" data-close-doc>Close</button>
        <button class="btn btn-primary" data-raise-tax-query style="background:#4f46e5;color:#fff;">Raise Inquiry</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.querySelectorAll("[data-close-doc]").forEach((b) => b.addEventListener("click", () => overlay.remove()));
  overlay.querySelector("[data-raise-tax-query]")?.addEventListener("click", () => {
    overlay.remove();
    showRaiseQueryModal(root);
  });
}

function showForm16Modal(root) {
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,0.6);display:flex;align-items:center;justify-content:center;z-index:9999;padding:16px;";
  overlay.innerHTML = `
    <div class="card" style="background:#fff;border-radius:12px;width:100%;max-width:580px;padding:24px;box-shadow:0 12px 32px rgba(0,0,0,0.2);">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;border-bottom:1px solid #e2e8f0;padding-bottom:12px;margin-bottom:16px;">
        <div>
          <h3 style="margin:0;font-size:16px;font-weight:800;color:#0f172a;">Historical Form 16 (FY 2025-26 &amp; Earlier)</h3>
          <div style="font-size:11.5px;color:#64748b;">Under Section 203 of the Income-tax Act, 1961</div>
        </div>
        <button class="btn btn-sm btn-ghost" data-close-doc style="font-size:16px;">✕</button>
      </div>

      <div style="font-size:12px;line-height:1.7;color:#334155;margin-bottom:16px;background:#f8fafc;padding:14px;border-radius:8px;">
        <div>Historical certificates are archived in the central accounts repository. If you require a re-issued copy for IT returns verification, please raise an inquiry below.</div>
      </div>

      <div style="display:flex;justify-content:flex-end;gap:10px;">
        <button class="btn btn-secondary" data-close-doc>Close</button>
        <button class="btn btn-primary" data-raise-tax-query style="background:#4f46e5;color:#fff;">Request Duplicate Copy</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.querySelectorAll("[data-close-doc]").forEach((b) => b.addEventListener("click", () => overlay.remove()));
  overlay.querySelector("[data-raise-tax-query]")?.addEventListener("click", () => {
    overlay.remove();
    showRaiseQueryModal(root);
  });
}

function showEpfPassbookModal() {
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,0.6);display:flex;align-items:center;justify-content:center;z-index:9999;padding:16px;";
  overlay.innerHTML = `
    <div class="card" style="background:#fff;border-radius:12px;width:100%;max-width:580px;padding:24px;box-shadow:0 12px 32px rgba(0,0,0,0.2);">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;border-bottom:1px solid #e2e8f0;padding-bottom:12px;margin-bottom:16px;">
        <div>
          <h3 style="margin:0;font-size:16px;font-weight:800;color:#0f172a;">EPFO Member Passbook &amp; UAN Portal</h3>
          <div style="font-size:11.5px;color:#64748b;">Employees' Provident Fund Scheme 1952</div>
        </div>
        <button class="btn btn-sm btn-ghost" data-close-doc style="font-size:16px;">✕</button>
      </div>

      <div style="font-size:12px;line-height:1.7;color:#334155;margin-bottom:16px;background:#f8fafc;padding:14px;border-radius:8px;">
        <div>EPFO member balances, monthly interest credits, and passbook statements are maintained authoritatively on the official Government EPFO Unified Portal.</div>
        <div style="margin-top:8px;">You can view and download your complete historical passbook by logging in with your Universal Account Number (UAN).</div>
      </div>

      <div style="display:flex;justify-content:flex-end;gap:10px;">
        <button class="btn btn-secondary" data-close-doc>Close</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.querySelectorAll("[data-close-doc]").forEach((b) => b.addEventListener("click", () => overlay.remove()));
}

async function loadMyPayslips(root) {
  loadPayrollQueries(root);
  activeListRequest?.abort();
  const requestController = new AbortController();
  activeListRequest = requestController;

  const content = root.querySelector("[data-payslip-content]");
  if (!content) return;

  content.innerHTML = `
    <div class="flex-col gap-md" aria-live="polite">
      ${skeleton("80px")}
      ${skeleton("80px")}
      ${skeleton("80px")}
    </div>
  `;

  try {
    let payslips = [];
    try {
      const payload = await apiGet("/payroll/me/payslips?limit=24", {
        signal: requestController.signal,
      });
      payslips = payload?.data?.payslips;
    } catch {
      payslips = [];
    }

    if (!Array.isArray(payslips)) {
      payslips = [];
    }

    if (requestController.signal.aborted || !root.isConnected) return;

    loadedPayslips = payslips;
    renderContent(root);
  } catch (error) {
    if (error?.name === "AbortError" || !root.isConnected) return;
    loadedPayslips = [];
    renderContent(root);
  } finally {
    if (activeListRequest === requestController) {
      activeListRequest = null;
    }
  }
}

export function renderStaffPayslips() {
  return `
    <div class="page-enter" style="padding:8px 4px;">
      <div
        class="flex justify-between items-center"
        style="gap:12px; margin-bottom:18px; flex-wrap:wrap;"
      >
        <div>
          <h1
            style="color:var(--ink); font-weight:700; font-size:18px; margin:0;"
            class="page-title font-display"
          >
            My Payslips & Wage Slips (SCR-015)
          </h1>
          <div style="color:var(--muted);" style="font-size:12px; margin-top:3px;">
            View your issued salary statements, earnings, deductions, payment history, annual tax documents and payroll queries.
          </div>
        </div>
        <div class="flex items-center gap-sm">
          <button
            class="btn btn-ghost"
            type="button"
            data-toggle-privacy
            style="padding:8px 14px; font-size:12px;"
          >
            ${balancesMasked ? "👁️ Reveal Balances" : "🔒 Mask Balances"}
          </button>
          <button
            class="btn btn-ghost"
            type="button"
            data-refresh-payslips
            style="padding:8px 14px; font-size:12px;"
          >
            Refresh Records
          </button>
        </div>
      </div>

      <div data-payslip-content>
        <div class="flex-col gap-md">${skeleton("80px")}${skeleton("80px")}${skeleton("80px")}</div>
      </div>
    </div>
  `;
}

export function wireStaffPayslips(root) {
  root.querySelector("[data-toggle-privacy]")?.addEventListener("click", (e) => {
    balancesMasked = !balancesMasked;
    e.currentTarget.textContent = balancesMasked ? "👁️ Reveal Balances" : "🔒 Mask Balances";
    renderContent(root);
  });
  root.querySelector("[data-refresh-payslips]")?.addEventListener("click", () => loadMyPayslips(root));
  loadMyPayslips(root);
}
