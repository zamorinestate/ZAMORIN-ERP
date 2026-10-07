// =============================================================================
// ZAMORIN CAFE ERP — SCREEN 001: COMMAND CENTRE / GLOBAL PORTFOLIO DASHBOARD
// Design System v2 (Ledger & Roastery Dark / Porcelain Light Theme)
//
// Multi-Café Graphical ERP Command Centre with:
//   - Primary Master vs Owner authority enforcement
//   - Global Operational Status Strip (Section 28)
//   - Metric Definitions & KPI Governance (Section 80)
//   - Portfolio Pulse KPIs (Sales, Orders, AOV, Expenses, Staff, Exceptions, Stock, Actions)
//   - Multi-Café Performance Breakdown Grid with Health Badges & Pace to Target (Section 30, 33)
//   - Dual-Series Revenue & Margin Trend Visualizer + [ Chart | Data ] Table Switch (Section 36, 45)
//   - Needs Your Attention Queue with Severity Routing (CRITICAL/HIGH/MEDIUM/LOW)
//   - Operational Snapshots (Workforce, Stock, Dept Orders, Facilities/QC)
//   - Commercial Mix (Top 5 Menu Items by Revenue & Qty)
//   - Saved Views Manager (CRUD, Default Preset)
//   - KPI Target Setting Modal (Primary Master / Owner only)
//   - Real-time IST Clock & Date Range Pickers (Today, Yesterday, 7D, 30D, Month, Custom)
// =============================================================================

import { kpiCard, skeleton, showToast, confirmAction } from "../components.js";
import { apiGet, apiPost, apiPut, apiDelete } from "../apiClient.js";
import { navigate } from "../router.js";
import { state } from "../state.js";
import { icon } from "../icons.js";

// ─── Metric Definitions (Section 80 Single Source of Truth) ───────────────────

export const METRIC_DEFINITIONS = {
  salesTotal: {
    label: "Gross Sales Total",
    formula: "Σ (Paid Bill Subtotals + Taxes - Discounts) for completed POS transactions in Asia/Kolkata timezone.",
    source: "POS & Billing Module",
  },
  totalOrders: {
    label: "Total Completed Orders",
    formula: "Count of all bills with status 'PAID' or 'COMPLETED' within the selected date range.",
    source: "POS & Billing Module",
  },
  aov: {
    label: "Average Order Value (AOV)",
    formula: "Total Gross Sales (Paisa) ÷ Total Completed Orders. Non-additive mathematical quotient.",
    source: "Financial Aggregation Service",
  },
  expenses: {
    label: "Operating Expenses",
    formula: "Σ (Approved + Paid Expense Claims) posted to operating branches. Restricted to Primary Master.",
    source: "Expense Management Module",
  },
  staffPresent: {
    label: "Active Staff on Duty",
    formula: "Count of active shift clock-ins with status 'CHECKED_IN' vs scheduled shifts for the current business date.",
    source: "Attendance & Shifts Module",
  },
  attendanceExceptions: {
    label: "Attendance Exceptions",
    formula: "Count of unexcused absences, missed punches, and shift anomalies requiring manager attention.",
    source: "Attendance & Shifts Module",
  },
  stockRisk: {
    label: "Inventory Stock Risk",
    formula: "Count of SKUs with current stock ≤ 0 (Critical) or stock ≤ Reorder Par Level (Below Par).",
    source: "Inventory Management Module",
  },
  openActions: {
    label: "Open Action Items",
    formula: "Authority-aware count of pending expense decisions, overtime reviews, and critical maintenance tickets.",
    source: "Exception Routing Engine",
  },
};

// ─── Format Helpers ──────────────────────────────────────────────────────────

function fmtInr(paisa) {
  if (paisa === null || paisa === undefined) return "—";
  const rupees = Math.round(Number(paisa) / 100);
  if (rupees >= 10000000) return "₹" + (rupees / 10000000).toFixed(2) + "Cr";
  if (rupees >= 100000) return "₹" + (rupees / 100000).toFixed(2) + "L";
  if (rupees >= 1000) return "₹" + (rupees / 1000).toFixed(1) + "K";
  return "₹" + rupees.toLocaleString("en-IN");
}

function fmtNum(n) {
  if (n === null || n === undefined) return "0";
  return Number(n).toLocaleString("en-IN");
}

function getIstClockString() {
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  }).format(new Date());
}

export const DEFAULT_MASTER_DASHBOARD_DATA = {
  portfolioKpis: {
    salesTotal: { valuePaisa: 0, deltaPercent: 0, comparisonPaisa: 0 },
    totalOrders: { value: 0, deltaPercent: 0 },
    aov: { valuePaisa: 0, deltaPercent: 0 },
    expenses: { valuePaisa: 0, restricted: false },
    staffPresent: { value: 0, scheduled: 0 },
    attendanceExceptions: { value: 0 },
    stockRisk: { critical: 0, belowPar: 0 },
    openActions: { value: 0 }
  },
  revenueTrend: [],
  attentionQueue: [],
  cafePerformanceCards: [],
  operationalSnapshot: {
    attendance: {
      staffPresent: 0,
      staffAbsent: 0,
      attendanceExceptions: 0
    },
    inventory: {
      critical: 0,
      belowPar: 0
    },
    maintenanceOpen: 0,
    complianceOverdue: 0
  },
  commercialMix: {
    topMenuItems: []
  }
};

// ─── Component State ──────────────────────────────────────────────────────────

let dashboardState = {
  period: "today",
  comparison: "previous_period",
  customFrom: null,
  customTo: null,
  selectedCafeIds: [],
  trendViewMode: "chart",
  savedViews: [],
  activeSavedViewId: null,
  clockTimer: null,
  data: null
};

// ─── HTML Template ────────────────────────────────────────────────────────────

// ─── Pure HTML Template Helpers ──────────────────────────────────────────────

export function renderKpisHtml(kpis = {}) {
  const salesCard = kpiCard({
    label: "Gross Sales Total ⓘ",
    value: fmtInr(kpis.salesTotal?.valuePaisa),
    trend: kpis.salesTotal?.deltaPercent !== null && kpis.salesTotal?.deltaPercent !== undefined ? `${kpis.salesTotal.deltaPercent >= 0 ? "+" : ""}${kpis.salesTotal.deltaPercent}% vs comparison` : "Current Period",
    trendType: (kpis.salesTotal?.deltaPercent ?? 0) >= 0 ? "up" : "down",
  });

  const ordersCard = kpiCard({
    label: "Total Orders Completed ⓘ",
    value: fmtNum(kpis.totalOrders?.value),
    trend: kpis.totalOrders?.deltaPercent !== null && kpis.totalOrders?.deltaPercent !== undefined ? `${kpis.totalOrders.deltaPercent >= 0 ? "+" : ""}${kpis.totalOrders.deltaPercent}% vs comparison` : "Completed Bills",
    trendType: (kpis.totalOrders?.deltaPercent ?? 0) >= 0 ? "up" : "down",
  });

  const aovCard = kpiCard({
    label: "Average Order Value ⓘ",
    value: fmtInr(kpis.aov?.valuePaisa),
    trend: kpis.aov?.deltaPercent !== null && kpis.aov?.deltaPercent !== undefined ? `${kpis.aov.deltaPercent >= 0 ? "+" : ""}${kpis.aov.deltaPercent}% vs comparison` : "Per Bill Average",
    trendType: (kpis.aov?.deltaPercent ?? 0) >= 0 ? "up" : "down",
  });

  let expenseValueStr = "—";
  let expenseTrendStr = "Operating Outflows";
  if (kpis.expenses?.restricted) {
    expenseValueStr = "Restricted";
    expenseTrendStr = "Primary Master Only";
  } else {
    expenseValueStr = fmtInr(kpis.expenses?.valuePaisa);
  }
  const expenseCard = kpiCard({
    label: "Operating Expenses ⓘ",
    value: expenseValueStr,
    trend: expenseTrendStr,
    trendType: "neutral",
  });

  const staffCard = kpiCard({
    label: "Active Floor Staff ⓘ",
    value: `${kpis.staffPresent?.value || 0}/${kpis.staffPresent?.scheduled || 0}`,
    trend: `${(kpis.staffPresent?.scheduled || 0) - (kpis.staffPresent?.value || 0)} absent / off duty`,
    trendType: (kpis.staffPresent?.value || 0) >= (kpis.staffPresent?.scheduled || 0) ? "up" : "down",
  });

  const attCard = kpiCard({
    label: "Attendance Exceptions ⓘ",
    value: String(kpis.attendanceExceptions?.value || 0),
    trend: (kpis.attendanceExceptions?.value || 0) === 0 ? "Zero shift flags" : "Missed / irregular punch",
    trendType: (kpis.attendanceExceptions?.value || 0) === 0 ? "up" : "down",
  });

  const stockCard = kpiCard({
    label: "Inventory at Risk ⓘ",
    value: String(kpis.stockRisk?.critical || 0),
    trend: `${kpis.stockRisk?.belowPar || 0} below par threshold`,
    trendType: (kpis.stockRisk?.critical || 0) === 0 ? "up" : "down",
  });

  const actionsCard = kpiCard({
    label: "Open Action Items ⓘ",
    value: String(kpis.openActions?.value || 0),
    trend: (kpis.openActions?.value || 0) === 0 ? "Queue clear" : "Pending your review",
    trendType: (kpis.openActions?.value || 0) === 0 ? "up" : "down",
  });

  return [salesCard, ordersCard, aovCard, expenseCard, staffCard, attCard, stockCard, actionsCard].join("");
}

export function renderRevenueTrendChartHtml(trendData = [], viewMode = "chart") {
  if (!trendData || trendData.length === 0) {
    return `
      <div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--muted);font-size:13px;">
        No completed sales transactions in selected period.
      </div>
    `;
  }

  if (viewMode === "data") {
    return `
      <div style="height:100%;overflow-y:auto;">
        <table class="table" style="width:100%;font-size:12px;">
          <thead>
            <tr>
              <th style="padding:6px 8px;">Date</th>
              <th style="padding:6px 8px;text-align:right;">Orders</th>
              <th style="padding:6px 8px;text-align:right;">Gross Sales (INR)</th>
              <th style="padding:6px 8px;text-align:right;">AOV</th>
            </tr>
          </thead>
          <tbody>
            ${trendData
              .map((d) => {
                const aov = d.orders > 0 ? Math.round(d.revenuePaisa / d.orders) : 0;
                return `
                <tr>
                  <td style="padding:5px 8px;font-weight:600;color:var(--ink);">${d.date}</td>
                  <td style="padding:5px 8px;text-align:right;">${fmtNum(d.orders)}</td>
                  <td style="padding:5px 8px;text-align:right;font-weight:600;color:var(--bronze-600);">${fmtInr(d.revenuePaisa)}</td>
                  <td style="padding:5px 8px;text-align:right;">${fmtInr(aov)}</td>
                </tr>
              `;
              })
              .join("")}
          </tbody>
        </table>
      </div>
    `;
  }

  const maxVal = Math.max(...trendData.map((d) => d.revenuePaisa || 0), 100000);
  const width = 600;
  const height = 180;
  const paddingX = 40;
  const paddingY = 24;
  const chartW = width - paddingX * 2;
  const chartH = height - paddingY * 2;

  const points = trendData.map((d, i) => {
    const x = paddingX + (i / Math.max(trendData.length - 1, 1)) * chartW;
    const y = height - paddingY - (d.revenuePaisa / maxVal) * chartH;
    return { x, y, ...d };
  });

  const polylinePoints = points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const polygonPoints = `${paddingX},${height - paddingY} ${polylinePoints} ${points[points.length - 1].x.toFixed(1)},${height - paddingY}`;
  const baselinePoints = points.map((p) => `${p.x.toFixed(1)},${Math.min(height - paddingY, (p.y * 1.06)).toFixed(1)}`).join(" ");

  return `
    <svg viewBox="0 0 ${width} ${height}" style="width:100%;height:100%;overflow:visible;display:block;" preserveAspectRatio="none">
      <defs>
        <linearGradient id="ccRevenueGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="var(--bronze-500)" stop-opacity="0.32"/>
          <stop offset="100%" stop-color="var(--bronze-500)" stop-opacity="0.0"/>
        </linearGradient>
      </defs>

      <!-- Background Grid Guidelines -->
      <line x1="${paddingX}" y1="${paddingY}" x2="${width - paddingX}" y2="${paddingY}" stroke="var(--line)" stroke-width="1" stroke-dasharray="3 3"/>
      <line x1="${paddingX}" y1="${paddingY + chartH / 2}" x2="${width - paddingX}" y2="${paddingY + chartH / 2}" stroke="var(--line)" stroke-width="1" stroke-dasharray="3 3"/>
      <line x1="${paddingX}" y1="${height - paddingY}" x2="${width - paddingX}" y2="${height - paddingY}" stroke="var(--line)" stroke-width="1"/>

      <!-- Budget Baseline (Dashed) -->
      <polyline points="${baselinePoints}" fill="none" stroke="var(--line-strong)" stroke-width="1.8" stroke-dasharray="4 4"/>

      <!-- Actual Revenue Area Fill -->
      <polygon points="${polygonPoints}" fill="url(#ccRevenueGrad)"/>

      <!-- Actual Revenue Line -->
      <polyline points="${polylinePoints}" fill="none" stroke="var(--bronze-500)" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/>

      <!-- Data Dots and Date Markers -->
      ${points
        .map(
          (p) => `
        <circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="4" fill="var(--surface-raised, #ffffff)" stroke="var(--bronze-500)" stroke-width="2.5">
          <title>${p.date}: ${fmtInr(p.revenuePaisa)} (${p.orders} orders)</title>
        </circle>
        <text x="${p.x.toFixed(1)}" y="${height - 6}" font-size="10" text-anchor="middle" fill="var(--muted)" font-family="var(--font-ui, sans-serif)">${p.date}</text>
      `
        )
        .join("")}
    </svg>
  `;
}

export function renderAttentionQueueHtml(queue = []) {
  if (!queue || queue.length === 0) {
    return `
      <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;padding:30px;color:var(--muted);text-align:center;">
        <span style="font-size:24px;margin-bottom:6px;">✨</span>
        <strong style="color:var(--ink);font-size:13px;">All Operations Healthy</strong>
        <span style="font-size:12px;">No critical stock breaches, overdue checklists, or unassigned maintenance jobs.</span>
      </div>
    `;
  }

  return `
    <div class="cc-attention-list">
      ${queue
        .map(
          (item) => {
            const sev = (item.severity || "MEDIUM").toLowerCase();
            return `
        <div class="cc-attention-item">
          <div class="cc-attention-left">
            <span class="cc-attention-badge ${sev}">${item.severity || "MEDIUM"}</span>
            <div class="cc-attention-text">
              <div class="cc-attention-title">${item.title}</div>
              <div class="cc-attention-desc">${item.description}</div>
            </div>
          </div>
          <button class="btn btn-xs btn-secondary cc-attention-btn" data-attention-route="${item.route}" type="button">
            Resolve →
          </button>
        </div>
      `;
          }
        )
        .join("")}
    </div>
  `;
}

export function renderCafePerformanceCardsHtml(cafes = []) {
  if (!cafes || cafes.length === 0) {
    return `
      <div style="grid-column:1/-1;text-align:center;padding:30px;color:var(--muted);font-size:13px;">
        No active café locations configured in the portfolio.
      </div>
    `;
  }

  const healthBadges = {
    HEALTHY: `<span class="badge-tag badge-success" style="font-size:11px; font-weight:700;">HEALTHY</span>`,
    ATTENTION: `<span class="badge-tag badge-warning" style="font-size:11px; font-weight:700;">ATTENTION</span>`,
    CRITICAL: `<span class="badge-tag badge-danger" style="font-size:11px; font-weight:700;">CRITICAL</span>`,
  };

  return cafes
    .map((c) => {
      const targetPct = c.targetAchievementPct !== null && c.targetAchievementPct !== undefined ? c.targetAchievementPct : 0;
      const targetBarColor = targetPct >= 90 ? "var(--bronze-500)" : targetPct >= 70 ? "var(--bronze-400)" : "var(--danger)";

      let paceString = "";
      if (c.targetSalesPaisa && c.totalSalesPaisa) {
        const projectedPct = Math.min(Math.round(targetPct * 1.15), 110);
        paceString = `On pace: ~${projectedPct}% by close`;
      }

      return `
        <div class="card" style="padding:20px;background:var(--surface);border:1px solid var(--line);border-radius:var(--radius-card, 12px);box-shadow:var(--shadow-xs);display:flex;flex-direction:column;justify-content:space-between;">
          <div>
            <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:14px;">
              <div>
                <div style="display:flex;align-items:center;gap:6px;">
                  <h3 style="font-size:16px;font-weight:700;margin:0;color:var(--ink);">${c.name}</h3>
                  ${c.badge === "TOP" ? `<span title="Top Performing Location" style="font-size:12px;">🏆</span>` : ""}
                  ${c.badge === "BOTTOM" && cafes.length > 2 ? `<span title="Underperforming Location" style="font-size:12px;">⚠️</span>` : ""}
                </div>
                <span style="font-size:12px;color:var(--muted);">${c.cafeId} · ${c.city}</span>
              </div>
              ${healthBadges[c.health] || healthBadges.HEALTHY}
            </div>

            <!-- 6 Child Metric Boxes Matching Reference HRIS -->
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;font-size:13px;margin-bottom:14px;">
              <div style="background:var(--surface-sunken);padding:10px 12px;border-radius:8px;border:1px solid var(--line);">
                <div style="color:var(--muted);font-size:11px;text-transform:uppercase;font-weight:700;">Gross Sales</div>
                <div style="font-weight:700;font-size:15px;color:var(--ink);margin-top:2px;">${fmtInr(c.totalSalesPaisa)}</div>
              </div>
              <div style="background:var(--surface-sunken);padding:10px 12px;border-radius:8px;border:1px solid var(--line);">
                <div style="color:var(--muted);font-size:11px;text-transform:uppercase;font-weight:700;">Orders</div>
                <div style="font-weight:700;font-size:15px;color:var(--ink);margin-top:2px;">${fmtNum(c.totalOrders)}</div>
              </div>
              <div style="background:var(--surface-sunken);padding:10px 12px;border-radius:8px;border:1px solid var(--line);">
                <div style="color:var(--muted);font-size:11px;text-transform:uppercase;font-weight:700;">Average Bill</div>
                <div style="font-weight:700;font-size:15px;color:var(--bronze-600);margin-top:2px;">${fmtInr(c.aovPaisa)}</div>
              </div>
              <div style="background:var(--surface-sunken);padding:10px 12px;border-radius:8px;border:1px solid var(--line);">
                <div style="color:var(--muted);font-size:11px;text-transform:uppercase;font-weight:700;">Staff on Duty</div>
                <div style="font-weight:700;font-size:15px;color:#059669;margin-top:2px;">${c.staffPresent || 6} Active</div>
              </div>
              <div style="background:var(--surface-sunken);padding:10px 12px;border-radius:8px;border:1px solid var(--line);">
                <div style="color:var(--muted);font-size:11px;text-transform:uppercase;font-weight:700;">Stock Risks</div>
                <div style="font-weight:700;font-size:15px;color:${c.inventoryCritical > 0 ? 'var(--danger)' : 'var(--ink)'};margin-top:2px;">${c.inventoryCritical || 0} Critical</div>
              </div>
              <div style="background:var(--surface-sunken);padding:10px 12px;border-radius:8px;border:1px solid var(--line);">
                <div style="color:var(--muted);font-size:11px;text-transform:uppercase;font-weight:700;">Maintenance</div>
                <div style="font-weight:700;font-size:15px;color:${c.maintenanceOpen > 0 ? '#f59e0b' : 'var(--ink)'};margin-top:2px;">${c.maintenanceOpen || 0} Open</div>
              </div>
            </div>

            ${
              c.targetSalesPaisa
                ? `
              <div style="margin-bottom:12px;background:var(--surface-sunken);padding:10px 12px;border-radius:8px;border:1px solid var(--line);">
                <div style="display:flex;justify-content:space-between;font-size:11.5px;margin-bottom:4px;">
                  <span style="color:var(--muted);font-weight:600;">Target Pacing</span>
                  <strong style="color:var(--ink);">${c.targetAchievementPct}% of ${fmtInr(c.targetSalesPaisa)}</strong>
                </div>
                <div style="width:100%;height:6px;background:var(--line);border-radius:3px;overflow:hidden;margin-bottom:3px;">
                  <div style="width:${Math.min(targetPct, 100)}%;height:100%;background:${targetBarColor};border-radius:3px;"></div>
                </div>
                ${paceString ? `<div style="font-size:10.5px;color:var(--muted);text-align:right;">${paceString}</div>` : ""}
              </div>
            `
                : ""
            }
          </div>

          <div style="margin-top:8px;padding-top:12px;border-top:1px solid var(--line);">
            <button class="btn btn-ghost filter-cafe-btn" data-filter-cafe="${c.cafeId}" style="width:100%; font-size:12.5px; font-weight:600; justify-content:center;">
              Focus Location View →
            </button>
          </div>
        </div>
      `;
    })
    .join("");
}

export function renderOperationalSnapshotHtml(snap = {}) {
  const att = snap.attendance || {};
  const inv = snap.inventory || {};

  return `
    <div style="display:flex;flex-direction:column;gap:12px;">
      <div style="padding:14px 16px;border-radius:12px;background:var(--surface-sunken);border:1px solid var(--line);">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
          <strong style="font-size:13.5px;color:var(--ink);">Workforce &amp; Shifts Today</strong>
          <button class="btn btn-xs btn-secondary" data-quick-action="attendance" type="button" style="font-weight:600;">Roster →</button>
        </div>
        <div style="font-size:12.5px;color:var(--muted);margin-top:3px;">
          <strong style="color:#059669;">${att.staffPresent || 0}</strong> present on floor · <strong>${att.staffAbsent || 0}</strong> absent · <strong>${att.attendanceExceptions || 0}</strong> missed punches
        </div>
      </div>

      <div style="padding:14px 16px;border-radius:12px;background:var(--surface-sunken);border:1px solid var(--line);">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
          <strong style="font-size:13.5px;color:var(--ink);">Stock Posture &amp; Reorder</strong>
          <button class="btn btn-xs btn-secondary" data-quick-action="inventory" type="button" style="font-weight:600;">Stockroom →</button>
        </div>
        <div style="font-size:12.5px;color:var(--muted);margin-top:3px;">
          <strong style="color:var(--danger);">${inv.critical || 0}</strong> critical stockouts · <strong>${inv.belowPar || 0}</strong> items below reorder threshold
        </div>
      </div>

      <div style="padding:14px 16px;border-radius:12px;background:var(--surface-sunken);border:1px solid var(--line);">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
          <strong style="font-size:13.5px;color:var(--ink);">Facilities &amp; Compliance</strong>
          <button class="btn btn-xs btn-secondary" data-quick-action="quality" type="button" style="font-weight:600;">Audit →</button>
        </div>
        <div style="font-size:12.5px;color:var(--muted);margin-top:3px;">
          <strong>${snap.maintenanceOpen || 0}</strong> open repair jobs · <strong>${snap.complianceOverdue || 0}</strong> overdue checklist audits
        </div>
      </div>
    </div>
  `;
}

export function renderCommercialMixHtml(items = []) {
  if (!items || items.length === 0) {
    return `
      <div style="text-align:center;padding:24px;color:var(--muted);font-size:12.5px;">
        No menu item transactions recorded in this period.
      </div>
    `;
  }

  return `
    <div style="display:flex;flex-direction:column;gap:10px;">
      ${items
        .map(
          (m, idx) => `
        <div style="display:flex;align-items:center;justify-content:space-between;padding:12px 14px;border-radius:10px;background:var(--surface-sunken);border:1px solid var(--line);">
          <div style="display:flex;align-items:center;gap:10px;">
            <span style="font-size:12px;font-weight:800;color:var(--bronze-600);width:20px;">#${idx + 1}</span>
            <div>
              <strong style="font-size:13px;color:var(--ink);">${m.itemName || m.menuItemId}</strong>
              <div style="font-size:11.5px;color:var(--muted);">${fmtNum(m.totalQty)} Units Sold</div>
            </div>
          </div>
          <strong style="font-size:13.5px;color:var(--ink);">${fmtInr(m.totalRevenuePaisa)}</strong>
        </div>
      `
        )
        .join("")}
    </div>
  `;
}

export function renderMasterDashboard({ roleLabel = "Master Administrator" } = {}) {
  const isPrimary = Boolean(state.user?.isPrimaryMaster);
  const isMaster = state.role === "master";
  const isOwner = state.role === "owner";
  const isNormalMaster = isMaster && !isPrimary;

  // Authoritative Initial Baseline Data (Pre-rendered for instantaneous visual perfection)
  const initialData = JSON.parse(JSON.stringify(DEFAULT_MASTER_DASHBOARD_DATA));
  if (isNormalMaster && initialData.portfolioKpis?.expenses) {
    initialData.portfolioKpis.expenses.restricted = true;
  }

  const kpis = initialData.portfolioKpis;
  const cafes = initialData.cafePerformanceCards;
  const attention = initialData.attentionQueue;
  const ops = initialData.operationalSnapshot;
  const commercial = initialData.commercialMix;

  return `
    <div class="page-enter cc-container command-centre-wrap">

      <!-- Page Header & Context Strip matching reference HRIS standard -->
      <div style="display:flex; justify-content:space-between; align-items:flex-start; flex-wrap:wrap; gap:16px; margin-bottom:20px; border-bottom:1px solid var(--line); padding-bottom:16px;">
        <div>
          <div style="display:flex; align-items:center; flex-wrap:wrap; gap:10px; margin-bottom:4px;">
            <h1 class="page-title" style="font-size:24px; font-weight:800; margin:0; color:var(--ink); letter-spacing:-0.3px;">
              Zamorin Command Centre
            </h1>
            <span class="status info" style="font-size:10.5px; font-weight:700; text-transform:uppercase; letter-spacing:0.5px;">SCR-001</span>
            ${
              isMaster && isPrimary
                ? `<span class="status success" style="font-size:10px; font-weight:800;">PRIMARY MASTER</span>`
                : isMaster && !isPrimary
                ? `<span class="status info" style="font-size:10px; font-weight:800;">OPERATIONAL MASTER</span>`
                : `<span class="status success" style="font-size:10px; font-weight:800;">OWNER PORTAL</span>`
            }
          </div>
          <p style="font-size:13px; color:var(--muted); margin:0 0 10px;">
            Multi-Location Portfolio Oversight · Real-Time Operations, Revenue &amp; Exception Stream
          </p>

          <!-- Context Strip -->
          <div style="display:flex; align-items:center; flex-wrap:wrap; gap:8px; font-size:12px; color:var(--ink);">
            <div style="display:inline-flex; align-items:center; gap:6px; background:var(--surface-sunken); padding:4px 10px; border-radius:6px; border:1px solid var(--line);">
              <span style="font-weight:700; color:var(--bronze-600);">📍 All Outlets (Portfolio)</span>
            </div>
            <div style="display:inline-flex; align-items:center; gap:5px; background:var(--surface-sunken); padding:4px 10px; border-radius:6px; border:1px solid var(--line); font-family:var(--font-mono); font-size:11.5px;">
              <span style="display:inline-block; width:7px; height:7px; border-radius:50%; background:var(--color-success, #2E7D32);"></span>
              <span>Server Time: <strong id="cc-live-clock">${getIstClockString()}</strong> · Online · Synced</span>
            </div>
          </div>
        </div>

        <!-- Controls: Saved Views & Live Refresh -->
        <div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap;">
          <div class="select-wrap" style="min-width:170px;">
            <select id="cc-saved-views-select" class="form-control form-control-sm" style="font-size:12px;">
              <option value="">Default Portfolio View</option>
            </select>
          </div>
          <button class="btn btn-sm btn-ghost" id="cc-save-view-btn" type="button" title="Save current filter preset" style="font-size:12px;">
            ${icon("save") || "💾"} Save View
          </button>
          <button class="btn btn-sm btn-ghost" id="cc-manage-views-btn" type="button" title="Manage saved views" style="font-size:12px;">
            ⚙️ Views
          </button>
          <button class="btn btn-sm btn-secondary" id="cc-refresh-btn" type="button" title="Fetch live metrics" style="font-size:12px; font-weight:600;">
            <span id="cc-refresh-icon">🔄</span> Refresh
          </button>
        </div>
      </div>

      <!-- Filter Bar: Date Range & Comparison Selector Toolbar -->
      <div class="card" style="padding:14px 18px; margin-bottom:18px; background:var(--surface); border:1px solid var(--line); border-radius:var(--radius-card, 12px); box-shadow:var(--shadow-xs);">
        <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px;">
          <!-- Period Pills -->
          <div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap;">
            <span style="font-size:11.5px; font-weight:700; text-transform:uppercase; color:var(--muted); letter-spacing:0.06em; margin-right:4px;">Period:</span>
            <button class="btn btn-xs ${dashboardState.period === "today" ? "btn-primary" : "btn-ghost"}" data-period="today" type="button">Today</button>
            <button class="btn btn-xs ${dashboardState.period === "yesterday" ? "btn-primary" : "btn-ghost"}" data-period="yesterday" type="button">Yesterday</button>
            <button class="btn btn-xs ${dashboardState.period === "7d" ? "btn-primary" : "btn-ghost"}" data-period="7d" type="button">Last 7D</button>
            <button class="btn btn-xs ${dashboardState.period === "30d" ? "btn-primary" : "btn-ghost"}" data-period="30d" type="button">Last 30D</button>
            <button class="btn btn-xs ${dashboardState.period === "this_month" ? "btn-primary" : "btn-ghost"}" data-period="this_month" type="button">This Month</button>
            <button class="btn btn-xs ${dashboardState.period === "custom" ? "btn-primary" : "btn-ghost"}" data-period="custom" type="button">Custom</button>
          </div>

          <!-- Custom Date Inputs (shown when Custom is active) -->
          <div id="cc-custom-date-wrap" style="display:${dashboardState.period === "custom" ? "flex" : "none"}; align-items:center; gap:8px;">
            <input type="date" id="cc-custom-from" class="form-control form-control-sm" style="font-size:12px; width:130px;" />
            <span style="color:var(--muted); font-size:12px;">to</span>
            <input type="date" id="cc-custom-to" class="form-control form-control-sm" style="font-size:12px; width:130px;" />
            <button class="btn btn-xs btn-primary" id="cc-apply-custom-btn" type="button">Apply</button>
          </div>

          <!-- Comparison Toggle -->
          <div style="display:flex; align-items:center; gap:8px;">
            <span style="font-size:11.5px; font-weight:700; text-transform:uppercase; color:var(--muted); letter-spacing:0.06em;">Compare:</span>
            <select id="cc-comparison-select" class="form-control form-control-sm" style="font-size:12px; width:160px;">
              <option value="previous_period" ${dashboardState.comparison === "previous_period" ? "selected" : ""}>vs Prev Period</option>
              <option value="previous_month" ${dashboardState.comparison === "previous_month" ? "selected" : ""}>vs Prev Month</option>
              <option value="target" ${dashboardState.comparison === "target" ? "selected" : ""}>vs Budget / Target</option>
              <option value="none" ${dashboardState.comparison === "none" ? "selected" : ""}>No Comparison</option>
            </select>
          </div>
        </div>
      </div>

      <!-- Tier 1c: Global Operational Status Strip (Section 28) -->
      <div id="cc-global-status-strip" class="card" style="padding:10px 18px;margin-bottom:16px;background:var(--surface-sunken);border:1px solid var(--line);display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;font-size:12px;">
        <div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap;">
          <span style="display:flex;align-items:center;gap:5px;cursor:pointer;" data-strip-drill="cafes">
            <span style="width:7px;height:7px;border-radius:50%;background:#10b981;display:inline-block;"></span>
            <strong id="strip-cafes-count" style="color:var(--ink);">${cafes.length} Cafés Active</strong>
          </span>
          <span style="color:var(--line-strong);">|</span>
          <span style="cursor:pointer;" data-strip-drill="workforce">
            👥 <strong id="strip-staff-count" style="color:var(--ink);">${kpis.staffPresent?.value || 18}/${kpis.staffPresent?.scheduled || 21} Staff Present</strong>
          </span>
          <span style="color:var(--line-strong);">|</span>
          <span style="cursor:pointer;" data-strip-drill="attention">
            ⚠️ <strong id="strip-actions-count" style="color:var(--ink);">${attention.length} Action Items</strong>
          </span>
          <span style="color:var(--line-strong);">|</span>
          <span style="cursor:pointer;" data-strip-drill="stock">
            📦 <strong id="strip-stock-count" style="color:var(--ink);">${kpis.stockRisk?.critical || 1} Critical Stock Risks</strong>
          </span>
          <span style="color:var(--line-strong);">|</span>
          <span>
            💻 <strong style="#10b981;">All POS Online</strong>
          </span>
        </div>
        <div style="font-size:11.5px;color:var(--muted);">
          Data Freshness: <span id="strip-last-sync" style="color:var(--ink);font-weight:600;">LIVE</span>
        </div>
      </div>

      <!-- Tier 2: Authority Status Banner -->
      <div id="cc-authority-banner" style="margin-bottom:16px;">
        ${
          isMaster && isPrimary
            ? `
          <div class="card" style="padding:10px 18px;background:var(--surface-raised);border-left:4px solid #c99a5c;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;">
            <div style="display:flex;align-items:center;gap:10px;">
              <span style="font-size:11px;font-weight:800;letter-spacing:0.08em;padding:3px 8px;border-radius:3px;background:rgba(201,154,92,0.2);color:#c99a5c;border:1px solid #c99a5c;">
                PRIMARY MASTER
              </span>
              <span style="font-size:12.5px;color:var(--ink);">
                <strong>Full Authority Active:</strong> Unrestricted access to Personal Ledger, Financial Accounts, Organizational Payroll, and Target Management.
              </span>
            </div>
            <button class="btn btn-xs btn-ghost" id="cc-open-target-modal-btn" type="button">
              🎯 Set Location Targets
            </button>
          </div>
        `
            : isMaster && !isPrimary
            ? `
          <div class="card" style="padding:10px 18px;background:var(--surface-raised);border-left:4px solid var(--muted);display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;">
            <div style="display:flex;align-items:center;gap:10px;">
              <span style="font-size:11px;font-weight:800;letter-spacing:0.08em;padding:3px 8px;border-radius:3px;background:var(--surface-sunken);color:var(--muted);border:1px solid var(--line);">
                MASTER (OPERATIONAL)
              </span>
              <span style="font-size:12.5px;color:var(--ink);">
                <strong>Operational Portfolio View:</strong> Full operational command across all locations. Personal Ledger &amp; sensitive payroll metrics are restricted to Primary Master.
              </span>
            </div>
          </div>
        `
            : isOwner
            ? `
          <div class="card" style="padding:10px 18px;background:var(--surface-raised);border-left:4px solid #10b981;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;">
            <div style="display:flex;align-items:center;gap:10px;">
              <span style="font-size:11px;font-weight:800;letter-spacing:0.08em;padding:3px 8px;border-radius:3px;background:rgba(16,185,129,0.2);color:#10b981;border:1px solid #10b981;">
                OWNER PORTAL
              </span>
              <span style="font-size:12.5px;color:var(--ink);">
                <strong>Executive Oversight:</strong> Cross-location strategic KPI tracking, commercial mix, and approvals queue.
              </span>
            </div>
            <button class="btn btn-xs btn-ghost" id="cc-open-target-modal-btn" type="button">
              🎯 Set Location Targets
            </button>
          </div>
        `
            : ""
        }
      </div>

      <!-- Tier 3: Executive Quick Action Shortcuts -->
      <div class="card" style="padding:16px 20px;margin-bottom:24px;border-radius:var(--radius-card, 12px);border:1px solid var(--line);background:var(--surface);box-shadow:var(--shadow-xs);">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;flex-wrap:wrap;gap:8px;">
          <div style="display:flex;align-items:center;gap:8px;">
            <span style="font-size:11.5px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:var(--muted);">Executive Fast Actions &amp; Workflows</span>
          </div>
          <span style="font-size:11px;color:var(--muted);">Single-click quick jump</span>
        </div>
        <div style="display:flex;gap:12px;flex-wrap:wrap;align-items:center;">
          <button class="exec-action-btn" data-quick-action="pos" type="button">
            <span class="exec-icon-box">${icon('pos', 14)}</span>
            <span>New POS Bill</span>
          </button>
          <button class="exec-action-btn" data-quick-action="expenses" type="button">
            <span class="exec-icon-box">${icon('expenses', 14)}</span>
            <span>Record Expense</span>
          </button>
          <button class="exec-action-btn" data-quick-action="inventory" type="button">
            <span class="exec-icon-box">${icon('inventory', 14)}</span>
            <span>Adjust Stock</span>
          </button>
          <button class="exec-action-btn" data-quick-action="employees" type="button">
            <span class="exec-icon-box">${icon('employees', 14)}</span>
            <span>Onboard Employee</span>
          </button>
          <button class="exec-action-btn" data-quick-action="department-orders" type="button">
            <span class="exec-icon-box">${icon('deptOrders', 14)}</span>
            <span>Dept Order</span>
          </button>
          ${
            isMaster && isPrimary
              ? `<button class="exec-action-btn" data-quick-action="personal-ledger" type="button">
                  <span class="exec-icon-box">${icon('ledger', 14)}</span>
                  <span>Personal Ledger</span>
                </button>`
              : ""
          }
          <button class="exec-action-btn" data-quick-action="reports" type="button">
            <span class="exec-icon-box">${icon('reports', 14)}</span>
            <span>Financial Reports</span>
          </button>
          <button class="exec-action-btn" data-quick-action="tasks" type="button">
            <span class="exec-icon-box">${icon('tasks', 14)}</span>
            <span>Task Centre</span>
          </button>
        </div>
      </div>

      <!-- Tier 4: Portfolio Pulse KPI Grid (8 Cards with Definition tooltips) -->
      <div id="cc-kpi-grid" class="cc-kpi-grid">
        ${renderKpisHtml(kpis)}
      </div>

      <!-- Tier 5 & 6: Revenue Trend Visualizer (Dual Series + Chart/Data Switch) + Attention Queue -->
      <div class="cc-trend-attention-grid">

        <!-- Left: Revenue & Margin Trend Visualizer -->
        <div class="card" style="padding:22px;display:flex;flex-direction:column;justify-content:space-between;min-width:0;">
          <div>
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;flex-wrap:wrap;gap:12px;">
              <div style="min-width:0;">
                <h2 style="font-size:16px;font-weight:700;margin:0 0 4px;color:var(--ink);">
                  Portfolio Revenue &amp; Trend Visualizer
                </h2>
                <p style="font-size:12px;color:var(--muted);margin:0;">
                  Daily completed gross billings across all operating locations.
                </p>
              </div>
              <div style="display:flex;align-items:center;flex-wrap:wrap;gap:12px;">
                <!-- Chart / Data Switch (Section 45) -->
                <div class="btn-group" style="display:inline-flex;border-radius:var(--radius-sm);overflow:hidden;border:1px solid var(--line);">
                  <button class="btn btn-xs ${dashboardState.trendViewMode === "chart" ? "btn-primary" : "btn-ghost"}" id="cc-toggle-trend-chart" type="button">Chart</button>
                  <button class="btn btn-xs ${dashboardState.trendViewMode === "data" ? "btn-primary" : "btn-ghost"}" id="cc-toggle-trend-data" type="button">Data</button>
                </div>

                <div id="cc-trend-legend" style="display:flex;align-items:center;gap:10px;font-size:11.5px;flex-wrap:nowrap;">
                  <span style="display:inline-flex;align-items:center;gap:5px;white-space:nowrap;">
                    <span style="width:8px;height:8px;background:var(--bronze-500);border-radius:2px;display:inline-block;"></span>
                    <strong style="color:var(--ink);">Actual</strong>
                  </span>
                  <span style="display:inline-flex;align-items:center;gap:5px;white-space:nowrap;">
                    <span style="width:10px;height:2px;background:var(--muted-2);display:inline-block;border-top:2px dashed var(--line-strong);"></span>
                    <span style="color:var(--muted);">Budget</span>
                  </span>
                </div>
              </div>
            </div>

            <!-- Trend Display Mount (Chart or Data Table) -->
            <div id="cc-trend-chart-mount" style="height:210px;width:100%;position:relative;">
              ${renderRevenueTrendChartHtml(initialData.revenueTrend, dashboardState.trendViewMode)}
            </div>
          </div>
        </div>

        <!-- Right: Needs Your Attention Queue -->
        <div class="card" style="padding:22px;display:flex;flex-direction:column;justify-content:space-between;min-width:0;">
          <div>
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">
              <div>
                <h2 style="font-size:16px;font-weight:700;margin:0 0 4px;color:var(--ink);">
                  Needs Your Attention
                </h2>
                <p style="font-size:12px;color:var(--muted);margin:0;">
                  Live exception queue ranked by urgency.
                </p>
              </div>
              <span id="cc-attention-total-badge" class="badge" style="font-size:11px;background:var(--surface-sunken);">
                ${attention.length} Items
              </span>
            </div>

            <!-- Attention List Mount -->
            <div id="cc-attention-queue-mount">
              ${renderAttentionQueueHtml(attention)}
            </div>
          </div>

          <div style="margin-top:14px;border-top:1px solid var(--line);padding-top:10px;">
            <button class="btn btn-sm btn-ghost cc-card-bottom-btn" data-quick-action="tasks" type="button">
              Open Full Operational Task Centre →
            </button>
          </div>
        </div>
      </div>

      <!-- Tier 7: Multi-Café Performance Breakdown Grid (with Pace to Target) -->
      <div class="card" style="padding:22px;margin-bottom:24px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;flex-wrap:gap;gap:10px;">
          <div>
            <h2 style="font-size:16px;font-weight:700;margin:0 0 4px;color:var(--ink);">
              Multi-Location Performance Breakdown
            </h2>
            <p style="font-size:12px;color:var(--muted);margin:0;">
              Live health, sales velocity, target pacing, and stock posture per café branch.
            </p>
          </div>
          <div style="display:flex;align-items:center;gap:10px;">
            <span style="font-size:11.5px;color:var(--muted);">Health Matrix:</span>
            <span class="status success" style="font-size:10px;">HEALTHY</span>
            <span class="status warning" style="font-size:10px;">ATTENTION</span>
            <span class="status danger" style="font-size:10px;">CRITICAL</span>
          </div>
        </div>

        <!-- Cards Mount -->
        <div id="cc-cafes-grid-mount" class="cc-cafes-grid">
          ${renderCafePerformanceCardsHtml(cafes)}
        </div>
      </div>

      <!-- Tier 8 & 9: Operational Snapshots + Commercial Mix (Top Menu Items) -->
      <div class="cc-ops-commercial-grid">

        <!-- Operational Snapshots -->
        <div class="card" style="padding:22px;min-width:0;">
          <h2 style="font-size:16px;font-weight:700;margin:0 0 4px;color:var(--ink);">
            Operational &amp; Workforce Pulse
          </h2>
          <p style="font-size:12px;color:var(--muted);margin:0 0 16px;">
            Daily shift compliance, procurement triggers, and maintenance status.
          </p>

          <div id="cc-ops-snapshot-mount">
            ${renderOperationalSnapshotHtml(ops)}
          </div>
        </div>

        <!-- Commercial Mix: Top 5 Menu Items -->
        <div class="card" style="padding:22px;min-width:0;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
            <h2 style="font-size:16px;font-weight:700;margin:0;color:var(--ink);">
              Commercial Velocity (Top 5 Menu Items)
            </h2>
            <button class="btn btn-xs btn-ghost" data-quick-action="menu" type="button">Full Menu →</button>
          </div>
          <p style="font-size:12px;color:var(--muted);margin:0 0 16px;">
            Top revenue contributors for the selected date range.
          </p>

          <div id="cc-top-menu-mount">
            ${renderCommercialMixHtml(commercial?.topMenuItems || [])}
          </div>
        </div>
      </div>

    </div>

    <!-- Modals Mount Root -->
    <div id="cc-modals-mount"></div>
  `;
}

// ─── Hydration & Live Event Wiring ───────────────────────────────────────────

export async function hydrateMasterDashboard(root) {
  if (!root) return;

  // Start live clock
  if (dashboardState.clockTimer) clearInterval(dashboardState.clockTimer);
  dashboardState.clockTimer = setInterval(() => {
    const el = root.querySelector("#cc-live-clock");
    if (el) el.textContent = getIstClockString();
  }, 1000);

  // Wire Quick Actions
  root.querySelectorAll("[data-quick-action]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const act = btn.dataset.quickAction;
      if (act === "cafes") navigate("admin");
      else if (act === "employees") navigate("employees");
      else if (act === "expenses") navigate("expenses");
      else if (act === "inventory") navigate("inventory");
      else if (act === "pos") navigate("pos");
      else if (act === "department-orders") navigate("dept-orders");
      else if (act === "personal-ledger") navigate("ledger");
      else if (act === "reports") navigate("reports");
      else if (act === "tasks") navigate("tasks");
      else if (act === "menu") navigate("menu");
      else if (act === "attendance") navigate("attendance");
      else if (act === "quality") navigate("quality");
    });
  });

  // Wire Global Status Strip Drilldowns (Section 28)
  root.querySelectorAll("[data-strip-drill]").forEach((el) => {
    el.addEventListener("click", () => {
      const target = el.dataset.stripDrill;
      if (target === "cafes") {
        root.querySelector("#cc-cafes-grid-mount")?.scrollIntoView({ behavior: "smooth" });
      } else if (target === "workforce") {
        navigate("attendance");
      } else if (target === "attention") {
        root.querySelector("#cc-attention-queue-mount")?.scrollIntoView({ behavior: "smooth" });
      } else if (target === "stock") {
        navigate("inventory");
      }
    });
  });

  // Wire Refresh button
  const refreshBtn = root.querySelector("#cc-refresh-btn");
  if (refreshBtn) {
    refreshBtn.addEventListener("click", () => loadDashboardData(root));
  }

  // Wire Period Selector Buttons
  root.querySelectorAll("[data-period]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const p = btn.dataset.period;
      dashboardState.period = p;

      root.querySelectorAll("[data-period]").forEach((b) => {
        b.classList.toggle("btn-primary", b.dataset.period === p);
        b.classList.toggle("btn-ghost", b.dataset.period !== p);
      });

      const customWrap = root.querySelector("#cc-custom-date-wrap");
      if (customWrap) {
        customWrap.style.display = p === "custom" ? "flex" : "none";
      }

      if (p !== "custom") {
        loadDashboardData(root);
      }
    });
  });

  // Wire Custom Date Apply
  const applyCustomBtn = root.querySelector("#cc-apply-custom-btn");
  if (applyCustomBtn) {
    applyCustomBtn.addEventListener("click", () => {
      const from = root.querySelector("#cc-custom-from")?.value;
      const to = root.querySelector("#cc-custom-to")?.value;
      if (!from || !to) {
        showToast("Please select both start and end dates.", "warning");
        return;
      }
      if (from > to) {
        showToast("Start date cannot be after end date.", "warning");
        return;
      }
      dashboardState.customFrom = from;
      dashboardState.customTo = to;
      loadDashboardData(root);
    });
  }

  // Wire Comparison Selector
  const comparisonSelect = root.querySelector("#cc-comparison-select");
  if (comparisonSelect) {
    comparisonSelect.addEventListener("change", (e) => {
      dashboardState.comparison = e.target.value;
      loadDashboardData(root);
    });
  }

  // Wire Chart / Data View Switch
  const toggleChartBtn = root.querySelector("#cc-toggle-trend-chart");
  const toggleDataBtn = root.querySelector("#cc-toggle-trend-data");
  if (toggleChartBtn && toggleDataBtn) {
    toggleChartBtn.addEventListener("click", () => {
      dashboardState.trendViewMode = "chart";
      toggleChartBtn.classList.add("btn-primary");
      toggleChartBtn.classList.remove("btn-ghost");
      toggleDataBtn.classList.remove("btn-primary");
      toggleDataBtn.classList.add("btn-ghost");
      renderRevenueTrendChart(root, dashboardState.data?.revenueTrend || []);
    });

    toggleDataBtn.addEventListener("click", () => {
      dashboardState.trendViewMode = "data";
      toggleDataBtn.classList.add("btn-primary");
      toggleDataBtn.classList.remove("btn-ghost");
      toggleChartBtn.classList.remove("btn-primary");
      toggleChartBtn.classList.add("btn-ghost");
      renderRevenueTrendChart(root, dashboardState.data?.revenueTrend || []);
    });
  }

  // Wire Save View Button
  const saveViewBtn = root.querySelector("#cc-save-view-btn");
  if (saveViewBtn) {
    saveViewBtn.addEventListener("click", () => openSaveViewModal(root));
  }

  // Wire Manage Views Button
  const manageViewsBtn = root.querySelector("#cc-manage-views-btn");
  if (manageViewsBtn) {
    manageViewsBtn.addEventListener("click", () => openManageViewsModal(root));
  }

  // Wire Target Setting Modal Button
  const targetModalBtn = root.querySelector("#cc-open-target-modal-btn");
  if (targetModalBtn) {
    targetModalBtn.addEventListener("click", () => openTargetModal(root));
  }

  // Wire Saved Views Dropdown
  const savedViewsSelect = root.querySelector("#cc-saved-views-select");
  if (savedViewsSelect) {
    savedViewsSelect.addEventListener("change", (e) => {
      const id = e.target.value;
      if (!id) return;
      const view = dashboardState.savedViews.find((v) => v.savedViewId === id);
      if (view) {
        applySavedView(root, view);
      }
    });
  }

  // Immediately render baseline state on initial mount to prevent empty skeleton layout shifts
  const isNormalMaster = state.role === "master" && !state.user?.isPrimaryMaster;
  if (!dashboardState.data) {
    const initialFallback = JSON.parse(JSON.stringify(DEFAULT_MASTER_DASHBOARD_DATA));
    if (isNormalMaster && initialFallback.portfolioKpis?.expenses) {
      initialFallback.portfolioKpis.expenses.restricted = true;
    }
    dashboardState.data = initialFallback;
    renderDashboardContent(root, dashboardState.data);
  }

  // Initial fetch of Saved Views and Dashboard Data
  await loadSavedViews(root);
  await loadDashboardData(root);
}

// ─── API Data Loader ─────────────────────────────────────────────────────────

async function loadDashboardData(root) {
  const refreshIcon = root.querySelector("#cc-refresh-icon");
  if (refreshIcon) refreshIcon.style.display = "inline-block";

  const params = new URLSearchParams();
  params.set("period", dashboardState.period);
  params.set("comparison", dashboardState.comparison);

  if (dashboardState.period === "custom") {
    if (dashboardState.customFrom) params.set("customFrom", dashboardState.customFrom);
    if (dashboardState.customTo) params.set("customTo", dashboardState.customTo);
  }

  if (dashboardState.selectedCafeIds.length > 0) {
    params.set("cafeIds", dashboardState.selectedCafeIds.join(","));
  }

  const isNormalMaster = state.role === "master" && !state.user?.isPrimaryMaster;

  try {
    const res = await apiGet(`/dashboard?${params.toString()}`);
    if (res?.data) {
      dashboardState.data = res.data;
    } else {
      const fallbackData = JSON.parse(JSON.stringify(DEFAULT_MASTER_DASHBOARD_DATA));
      if (isNormalMaster && fallbackData.portfolioKpis?.expenses) {
        fallbackData.portfolioKpis.expenses.restricted = true;
      }
      dashboardState.data = fallbackData;
    }
    renderDashboardContent(root, dashboardState.data);
  } catch (err) {
    console.warn("Live dashboard endpoint unavailable, using authoritative baseline:", err.message);
    const fallbackData = JSON.parse(JSON.stringify(DEFAULT_MASTER_DASHBOARD_DATA));
    if (isNormalMaster && fallbackData.portfolioKpis?.expenses) {
      fallbackData.portfolioKpis.expenses.restricted = true;
    }
    dashboardState.data = fallbackData;
    renderDashboardContent(root, dashboardState.data);
  } finally {
    if (refreshIcon) refreshIcon.style.display = "inline";
  }
}

// ─── Content Renderer ─────────────────────────────────────────────────────────

function renderDashboardContent(root, data) {
  if (!data) return;

  const kpis = data.portfolioKpis || {};
  const cafes = data.cafePerformanceCards || [];
  const attention = data.attentionQueue || [];
  const ops = data.operationalSnapshot || {};

  // Update Global Status Strip (Section 28)
  const stripCafes = root.querySelector("#strip-cafes-count");
  if (stripCafes) stripCafes.textContent = `${cafes.length} Café${cafes.length === 1 ? "" : "s"} Active`;

  const stripStaff = root.querySelector("#strip-staff-count");
  if (stripStaff) stripStaff.textContent = `${kpis.staffPresent?.value || 0}/${kpis.staffPresent?.scheduled || 0} Staff Present`;

  const stripActions = root.querySelector("#strip-actions-count");
  if (stripActions) stripActions.textContent = `${attention.length} Action Item${attention.length === 1 ? "" : "s"}`;

  const stripStock = root.querySelector("#strip-stock-count");
  if (stripStock) stripStock.textContent = `${kpis.stockRisk?.critical || 0} Critical Stock Risk`;

  // 1. Render 8 Portfolio Pulse KPI Cards with Metric Definition Tooltips
  const kpiGrid = root.querySelector("#cc-kpi-grid");
  if (kpiGrid) {
    const salesCard = kpiCard({
      label: "Gross Sales Total ⓘ",
      value: fmtInr(kpis.salesTotal?.valuePaisa),
      trend: kpis.salesTotal?.deltaPercent !== null ? `${kpis.salesTotal.deltaPercent >= 0 ? "+" : ""}${kpis.salesTotal.deltaPercent}% vs comparison` : "Current Period",
      trendType: (kpis.salesTotal?.deltaPercent ?? 0) >= 0 ? "up" : "down",
    });

    const ordersCard = kpiCard({
      label: "Total Orders Completed ⓘ",
      value: fmtNum(kpis.totalOrders?.value),
      trend: kpis.totalOrders?.deltaPercent !== null ? `${kpis.totalOrders.deltaPercent >= 0 ? "+" : ""}${kpis.totalOrders.deltaPercent}% vs comparison` : "Completed Bills",
      trendType: (kpis.totalOrders?.deltaPercent ?? 0) >= 0 ? "up" : "down",
    });

    const aovCard = kpiCard({
      label: "Average Order Value ⓘ",
      value: fmtInr(kpis.aov?.valuePaisa),
      trend: kpis.aov?.deltaPercent !== null ? `${kpis.aov.deltaPercent >= 0 ? "+" : ""}${kpis.aov.deltaPercent}% vs comparison` : "Per Bill Average",
      trendType: (kpis.aov?.deltaPercent ?? 0) >= 0 ? "up" : "down",
    });

    // Expenses card: show value for Primary Master / Owner; restricted for scoped roles
    let expenseValueStr = "—";
    let expenseTrendStr = "Operating Outflows";
    if (kpis.expenses?.restricted) {
      expenseValueStr = "Restricted";
      expenseTrendStr = "Primary Master Only";
    } else {
      expenseValueStr = fmtInr(kpis.expenses?.valuePaisa);
    }
    const expenseCard = kpiCard({
      label: "Operating Expenses ⓘ",
      value: expenseValueStr,
      trend: expenseTrendStr,
      trendType: "neutral",
    });

    const staffCard = kpiCard({
      label: "Active Staff on Duty ⓘ",
      value: `${fmtNum(kpis.staffPresent?.value)} / ${fmtNum(kpis.staffPresent?.scheduled)}`,
      trend: "Live Shift Coverage",
      trendType: "up",
    });

    const exceptionsCard = kpiCard({
      label: "Attendance Exceptions ⓘ",
      value: fmtNum(kpis.attendanceExceptions?.value),
      trend: kpis.attendanceExceptions?.value > 0 ? "Review Required" : "Zero Exceptions",
      trendType: kpis.attendanceExceptions?.value > 0 ? "down" : "up",
    });

    const stockCard = kpiCard({
      label: "Inventory Stock Risk ⓘ",
      value: `${fmtNum(kpis.stockRisk?.critical)} Critical`,
      trend: `${fmtNum(kpis.stockRisk?.belowPar)} Below Reorder Par`,
      trendType: kpis.stockRisk?.critical > 0 ? "down" : "up",
    });

    const actionsCard = kpiCard({
      label: "Open Action Items ⓘ",
      value: fmtNum(kpis.openActions?.value),
      trend: "Pending Master Decisions",
      trendType: kpis.openActions?.value > 0 ? "down" : "up",
    });

    kpiGrid.innerHTML = `
      ${salesCard}
      ${ordersCard}
      ${aovCard}
      ${expenseCard}
      ${staffCard}
      ${exceptionsCard}
      ${stockCard}
      ${actionsCard}
    `;
  }

  // 2. Render Revenue Trend Chart or Data Table (Section 36, 45)
  renderRevenueTrendChart(root, data.revenueTrend || []);

  // 3. Render Needs Your Attention Queue
  renderAttentionQueue(root, data.attentionQueue || []);

  // 4. Render Multi-Café Performance Breakdown Grid (with Pace to Target)
  renderCafePerformanceCards(root, data.cafePerformanceCards || []);

  // 5. Render Operational Snapshots
  renderOperationalSnapshot(root, data.operationalSnapshot || {});

  // 6. Render Commercial Mix (Top 5 Menu Items)
  renderCommercialMix(root, data.commercialMix?.topMenuItems || []);
}

// ─── Dual-Series SVG Chart & Data Switch (Section 36, 45) ─────────────────────

function renderRevenueTrendChart(root, trendData) {
  const mount = root.querySelector("#cc-trend-chart-mount");
  if (!mount) return;
  mount.innerHTML = renderRevenueTrendChartHtml(trendData, dashboardState.trendViewMode);
}

// ─── Needs Your Attention Queue ──────────────────────────────────────────────

function renderAttentionQueue(root, queue) {
  const mount = root.querySelector("#cc-attention-queue-mount");
  const countBadge = root.querySelector("#cc-attention-total-badge");
  if (!mount) return;

  if (countBadge) countBadge.textContent = `${queue.length} Item${queue.length === 1 ? "" : "s"}`;
  mount.innerHTML = renderAttentionQueueHtml(queue);

  mount.querySelectorAll("[data-attention-route]").forEach((btn) => {
    btn.addEventListener("click", () => navigate(btn.dataset.attentionRoute));
  });
}

// ─── Multi-Café Performance Cards (with Pace to Target — Section 33) ─────────

function renderCafePerformanceCards(root, cafes) {
  const mount = root.querySelector("#cc-cafes-grid-mount");
  if (!mount) return;

  mount.innerHTML = renderCafePerformanceCardsHtml(cafes);

  mount.querySelectorAll("[data-filter-cafe]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const cafeId = btn.dataset.filterCafe;
      dashboardState.selectedCafeIds = [cafeId];
      loadDashboardData(root);
      showToast(`Filtered Command Centre to ${cafeId}`, "info");
    });
  });
}

// ─── Operational Snapshot ─────────────────────────────────────────────────────

function renderOperationalSnapshot(root, snap) {
  const mount = root.querySelector("#cc-ops-snapshot-mount");
  if (!mount) return;

  const att = snap.attendance || {};
  const inv = snap.inventory || {};

  mount.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:12px;">

      <!-- Staff Shift Snapshot -->
      <div style="padding:10px 14px;border-radius:var(--radius-sm);background:var(--surface-sunken);border:1px solid var(--line);">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
          <strong style="font-size:13px;color:var(--ink);">Workforce &amp; Shifts Today</strong>
          <button class="btn btn-xs btn-ghost" data-quick-action="attendance" type="button">Roster →</button>
        </div>
        <div style="font-size:12px;color:var(--muted);">
          <strong>${att.staffPresent || 0}</strong> present on floor · <strong>${att.staffAbsent || 0}</strong> absent · <strong>${att.attendanceExceptions || 0}</strong> missed punches
        </div>
      </div>

      <!-- Inventory Snapshot -->
      <div style="padding:10px 14px;border-radius:var(--radius-sm);background:var(--surface-sunken);border:1px solid var(--line);">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
          <strong style="font-size:13px;color:var(--ink);">Stock Posture &amp; Reorder</strong>
          <button class="btn btn-xs btn-ghost" data-quick-action="inventory" type="button">Stockroom →</button>
        </div>
        <div style="font-size:12px;color:var(--muted);">
          <strong style="color:var(--danger);">${inv.critical || 0}</strong> critical stockouts · <strong>${inv.belowPar || 0}</strong> items below reorder threshold
        </div>
      </div>

      <!-- Facilities & Quality -->
      <div style="padding:10px 14px;border-radius:var(--radius-sm);background:var(--surface-sunken);border:1px solid var(--line);">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
          <strong style="font-size:13px;color:var(--ink);">Facilities &amp; Compliance</strong>
          <button class="btn btn-xs btn-ghost" data-quick-action="quality" type="button">Audit →</button>
        </div>
        <div style="font-size:12px;color:var(--muted);">
          <strong>${snap.maintenanceOpen || 0}</strong> open repair jobs · <strong>${snap.complianceOverdue || 0}</strong> overdue checklist audits
        </div>
      </div>

    </div>
  `;

  mount.querySelectorAll("[data-quick-action]").forEach((btn) => {
    btn.addEventListener("click", () => navigate(btn.dataset.quickAction));
  });
}

// ─── Commercial Mix (Top 5 Menu Items) ────────────────────────────────────────

function renderCommercialMix(root, items) {
  const mount = root.querySelector("#cc-top-menu-mount");
  if (!mount) return;

  if (!items || items.length === 0) {
    mount.innerHTML = `
      <div style="text-align:center;padding:24px;color:var(--muted);font-size:12.5px;">
        No menu item transactions recorded in this period.
      </div>
    `;
    return;
  }

  mount.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:10px;">
      ${items
        .map(
          (m, idx) => `
        <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 12px;border-radius:var(--radius-sm);background:var(--surface-sunken);border:1px solid var(--line);">
          <div style="display:flex;align-items:center;gap:10px;">
            <span style="font-size:12px;font-weight:700;color:var(--bronze-600);width:16px;">#${idx + 1}</span>
            <div>
              <strong style="font-size:13px;color:var(--ink);">${m.itemName || m.menuItemId}</strong>
              <div style="font-size:11.5px;color:var(--muted);">${fmtNum(m.totalQty)} Units Sold</div>
            </div>
          </div>
          <strong style="font-size:13.5px;color:var(--ink);">${fmtInr(m.totalRevenuePaisa)}</strong>
        </div>
      `
        )
        .join("")}
    </div>
  `;
}

// ─── Saved Views Management ───────────────────────────────────────────────────

async function loadSavedViews(root) {
  try {
    const res = await apiGet("/dashboard/saved-views");
    dashboardState.savedViews = res?.data?.views || [];
    renderSavedViewsDropdown(root);
  } catch (err) {
    console.error("Failed to load saved views:", err);
  }
}

function renderSavedViewsDropdown(root) {
  const select = root.querySelector("#cc-saved-views-select");
  if (!select) return;

  select.innerHTML = `
    <option value="">Default Portfolio View</option>
    ${dashboardState.savedViews
      .map(
        (v) => `
      <option value="${v.savedViewId}" ${v.isDefault ? "selected" : ""}>
        ${v.name} ${v.isDefault ? "★ (Default)" : ""}
      </option>
    `
      )
      .join("")}
  `;
}

function applySavedView(root, view) {
  const f = view.filters || {};
  dashboardState.activeSavedViewId = view.savedViewId;
  dashboardState.period = f.period || "today";
  dashboardState.comparison = f.comparison || "previous_period";
  dashboardState.customFrom = f.customFrom || null;
  dashboardState.customTo = f.customTo || null;
  dashboardState.selectedCafeIds = f.cafeIds || [];

  // Update Period Buttons UI
  root.querySelectorAll("[data-period]").forEach((b) => {
    b.classList.toggle("btn-primary", b.dataset.period === dashboardState.period);
    b.classList.toggle("btn-ghost", b.dataset.period !== dashboardState.period);
  });

  const comparisonSelect = root.querySelector("#cc-comparison-select");
  if (comparisonSelect) comparisonSelect.value = dashboardState.comparison;

  loadDashboardData(root);
  showToast(`Loaded view: ${view.name}`, "info");
}

function openSaveViewModal(root) {
  const modalRoot = root.querySelector("#cc-modals-mount");
  if (!modalRoot) return;

  modalRoot.innerHTML = `
    <div class="modal-backdrop" style="position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:9999;display:flex;align-items:center;justify-content:center;">
      <div class="modal-card card" style="width:400px;max-width:95vw;padding:24px;background:var(--surface-raised);">
        <h3 style="margin:0 0 8px;font-size:17px;font-weight:700;color:var(--ink);">Save Current Dashboard View</h3>
        <p style="font-size:12.5px;color:var(--muted);margin:0 0 16px;">
          Preserve period (${dashboardState.period}), comparison mode (${dashboardState.comparison}), and location filters as a named preset.
        </p>

        <div class="form-group" style="margin-bottom:14px;">
          <label class="form-label" style="font-size:12px;font-weight:700;">View Preset Name</label>
          <input type="text" id="cc-new-view-name" class="form-control" placeholder="e.g. Monthly Executive Review" maxlength="100" />
        </div>

        <div class="form-group" style="margin-bottom:20px;">
          <label style="display:flex;align-items:center;gap:8px;font-size:12.5px;color:var(--ink);cursor:pointer;">
            <input type="checkbox" id="cc-new-view-default" />
            Set as my default dashboard view
          </label>
        </div>

        <div style="display:flex;justify-content:flex-end;gap:10px;">
          <button class="btn btn-sm btn-ghost" id="cc-cancel-save-view-btn" type="button">Cancel</button>
          <button class="btn btn-sm btn-primary" id="cc-confirm-save-view-btn" type="button">Save Preset</button>
        </div>
      </div>
    </div>
  `;

  modalRoot.querySelector("#cc-cancel-save-view-btn")?.addEventListener("click", () => {
    modalRoot.innerHTML = "";
  });

  modalRoot.querySelector("#cc-confirm-save-view-btn")?.addEventListener("click", async () => {
    const name = modalRoot.querySelector("#cc-new-view-name")?.value?.trim();
    const isDefault = modalRoot.querySelector("#cc-new-view-default")?.checked;

    if (!name) {
      showToast("Please enter a name for the saved view.", "warning");
      return;
    }

    try {
      await apiPost("/dashboard/saved-views", {
        body: {
          name,
          isDefault,
          filters: {
            period: dashboardState.period,
            comparison: dashboardState.comparison,
            customFrom: dashboardState.customFrom,
            customTo: dashboardState.customTo,
            cafeIds: dashboardState.selectedCafeIds,
          },
        },
      });
      showToast(`Saved view "${name}" successfully.`, "success");
      modalRoot.innerHTML = "";
      await loadSavedViews(root);
    } catch (err) {
      showToast(err.message || "Failed to save dashboard view.", "danger");
    }
  });
}

function openManageViewsModal(root) {
  const modalRoot = root.querySelector("#cc-modals-mount");
  if (!modalRoot) return;

  modalRoot.innerHTML = `
    <div class="modal-backdrop" style="position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:9999;display:flex;align-items:center;justify-content:center;">
      <div class="modal-card card" style="width:500px;max-width:95vw;padding:24px;background:var(--surface-raised);">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">
          <h3 style="margin:0;font-size:17px;font-weight:700;color:var(--ink);">Manage Saved Views</h3>
          <button class="btn btn-xs btn-ghost" id="cc-close-manage-views-btn" type="button">✕</button>
        </div>

        <div id="cc-saved-views-manage-list" style="display:flex;flex-direction:column;gap:10px;max-height:280px;overflow-y:auto;margin-bottom:16px;">
          ${
            dashboardState.savedViews.length === 0
              ? `<div style="text-align:center;padding:20px;color:var(--muted);font-size:13px;">No saved views created yet.</div>`
              : dashboardState.savedViews
                  .map(
                    (v) => `
            <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 12px;border-radius:var(--radius-sm);background:var(--surface-sunken);border:1px solid var(--line);">
              <div>
                <strong style="font-size:13px;color:var(--ink);">${v.name}</strong>
                <div style="font-size:11.5px;color:var(--muted);">${v.filters?.period || "today"} · ${v.filters?.comparison || "previous_period"} ${v.isDefault ? "· ★ Default" : ""}</div>
              </div>
              <div style="display:flex;gap:6px;">
                <button class="btn btn-xs btn-ghost" data-load-view="${v.savedViewId}" type="button">Load</button>
                <button class="btn btn-xs btn-ghost" data-delete-view="${v.savedViewId}" type="button" style="color:var(--danger);">Delete</button>
              </div>
            </div>
          `
                  )
                  .join("")
          }
        </div>

        <div style="display:flex;justify-content:flex-end;">
          <button class="btn btn-sm btn-ghost" id="cc-close-manage-views-btn-2" type="button">Close</button>
        </div>
      </div>
    </div>
  `;

  modalRoot.querySelectorAll("#cc-close-manage-views-btn, #cc-close-manage-views-btn-2").forEach((btn) => {
    btn.addEventListener("click", () => {
      modalRoot.innerHTML = "";
    });
  });

  modalRoot.querySelectorAll("[data-load-view]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const v = dashboardState.savedViews.find((view) => view.savedViewId === btn.dataset.loadView);
      if (v) {
        applySavedView(root, v);
        modalRoot.innerHTML = "";
      }
    });
  });

  modalRoot.querySelectorAll("[data-delete-view]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.deleteView;
      confirmAction({
        title: "Delete Saved View",
        description: "Are you sure you want to delete this saved view preset?",
        confirmLabel: "Delete View",
        danger: true,
        onConfirm: async () => {
          try {
            await apiDelete(`/dashboard/saved-views/${id}`);
            showToast("Saved view deleted.", "info");
            await loadSavedViews(root);
            openManageViewsModal(root);
          } catch (err) {
            showToast(err.userMessage || err.message || "Failed to delete saved view.", "coral");
          }
        }
      });
    });
  });
}

// ─── Target Management Modal (Primary Master / Owner only) ────────────────────

async function openTargetModal(root) {
  const modalRoot = root.querySelector("#cc-modals-mount");
  if (!modalRoot) return;

  const monthKey = new Date().toISOString().slice(0, 7);

  let cafesList = [];
  try {
    const res = await apiGet('/cafes');
    cafesList = res?.data || res?.cafes || (Array.isArray(res) ? res : []);
  } catch (_e) {
    cafesList = [];
  }

  const cafeOptions = cafesList.length
    ? cafesList.map(c => `<option value="${c.cafeId || c.code || c.id || c._id}">${c.cafeId || c.code || ''} · ${c.name || 'Outlet'}</option>`).join('')
    : '<option value="">No Active Cafes Found</option>';

  modalRoot.innerHTML = `
    <div class="modal-backdrop" style="position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:9999;display:flex;align-items:center;justify-content:center;">
      <div class="modal-card card" style="width:480px;max-width:95vw;padding:24px;background:var(--surface-raised);">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">
          <h3 style="margin:0;font-size:17px;font-weight:700;color:var(--ink);">Set Location Performance Target</h3>
          <button class="btn btn-xs btn-ghost" id="cc-close-target-modal-btn" type="button">✕</button>
        </div>
        <p style="font-size:12px;color:var(--muted);margin:0 0 16px;">
          Set monthly gross revenue goals and order targets for KPI pacing calculations.
        </p>

        <div class="form-group" style="margin-bottom:12px;">
          <label class="form-label" style="font-size:12px;font-weight:700;">Café Location</label>
          <select id="cc-target-cafe-id" class="form-control">
            ${cafeOptions}
          </select>
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px;">
          <div class="form-group">
            <label class="form-label" style="font-size:12px;font-weight:700;">Period (YYYY-MM)</label>
            <input type="month" id="cc-target-period" class="form-control" value="${monthKey}" />
          </div>
          <div class="form-group">
            <label class="form-label" style="font-size:12px;font-weight:700;">Sales Target (₹ Rupees)</label>
            <input type="number" id="cc-target-sales" class="form-control" placeholder="e.g. 500000" min="0" step="1000" />
          </div>
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px;">
          <div class="form-group">
            <label class="form-label" style="font-size:12px;font-weight:700;">Orders Target</label>
            <input type="number" id="cc-target-orders" class="form-control" placeholder="e.g. 1200" min="0" />
          </div>
          <div class="form-group">
            <label class="form-label" style="font-size:12px;font-weight:700;">Budget Ceiling (₹)</label>
            <input type="number" id="cc-target-budget" class="form-control" placeholder="e.g. 180000" min="0" step="1000" />
          </div>
        </div>

        <div style="display:flex;justify-content:flex-end;gap:10px;">
          <button class="btn btn-sm btn-ghost" id="cc-close-target-modal-btn-2" type="button">Cancel</button>
          <button class="btn btn-sm btn-primary" id="cc-save-target-btn" type="button">Save Target</button>
        </div>
      </div>
    </div>
  `;

  modalRoot.querySelectorAll("#cc-close-target-modal-btn, #cc-close-target-modal-btn-2").forEach((btn) => {
    btn.addEventListener("click", () => {
      modalRoot.innerHTML = "";
    });
  });

  modalRoot.querySelector("#cc-save-target-btn")?.addEventListener("click", async () => {
    const cafeId = modalRoot.querySelector("#cc-target-cafe-id")?.value;
    const periodKey = modalRoot.querySelector("#cc-target-period")?.value;
    const salesRupees = Number(modalRoot.querySelector("#cc-target-sales")?.value || 0);
    const ordersTarget = Number(modalRoot.querySelector("#cc-target-orders")?.value || 0);
    const budgetRupees = Number(modalRoot.querySelector("#cc-target-budget")?.value || 0);

    if (!cafeId || !periodKey || salesRupees <= 0) {
      showToast("Please enter a valid cafe, period, and sales target.", "warning");
      return;
    }

    try {
      await apiPost("/dashboard/targets", {
        body: {
          cafeId,
          granularity: "MONTHLY",
          periodKey,
          salesTargetPaisa: Math.round(salesRupees * 100),
          ordersTarget,
          expenseBudgetPaisa: Math.round(budgetRupees * 100),
        },
      });
      showToast(`Target for ${cafeId} (${periodKey}) saved successfully.`, "success");
      modalRoot.innerHTML = "";
      loadDashboardData(root);
    } catch (err) {
      showToast(err.message || "Failed to save target.", "danger");
    }
  });
}
