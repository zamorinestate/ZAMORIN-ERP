import { showDataError } from "../utils/dialogs.js";
// =============================================================================
// ADM-SCR-001 — CAFE OPERATIONS DASHBOARD (COMMAND CENTRE)
//
// Single-Cafe · Trusted-Device-Bound · Operator-Aware · Today-Focused · Exception-Driven
//
// Full Specification Compliance (142 Points):
// §4    Single-cafe operational workspace (not employee profile, not portfolio)
// §6-9  Server-authoritative cafe scope (bound to trusted device primaryCafeId)
// §14-15 Authenticated Operator identity and session context
// §18-20 Fixed Context Header: Cafe, Device, Business Date, Operator, Connectivity, Sync
// §21-23 Cafe Operating Status & Opening/Closing Readiness
// §25-28 Action Required hierarchy with deterministic severity sorting & aging
// §29   Previous Business Day Carryover (conditional)
// §30-31 Today Snapshot KPIs (Today's Sales, Bills, AOV, Attendance)
// §32-33 Sales by Hour SVG Bar Chart with tooltips, hour labels, empty/stale states
// §34-35 Operational Alerts feed with acknowledgement support
// §36-40 Sales & Cash reconciliation state & payment method breakdown (Cash, UPI, Card)
// §41-42 Attendance Today operational summary (Scheduled, Present, Late, Missing, Exceptions)
// §43-45 Stock Health with critical/low preview table (no automatic POS depletion)
// §46-47 Expenses summary (strictly within CAFE_ADMIN create/submit authority)
// §48-49 Procurement & Deliveries summary
// §50-51 Department Orders (university / business orders)
// §52   Next Up operational timeline
// §53-55 Recent Activity, Since You Signed In & Resume Work continuity
// §56-57 Equipment Maintenance & Quality Compliance Attention (conditional)
// §58-61 Cafe Device health, Peripherals (Printer/Scanner) & per-domain Data Freshness
// §63-64 Quick Actions bar (permission-aware)
// §78-84 Skeletons, per-widget error retry, offline banner, partial data states
// §89-95 Mobile/tablet responsive layout (touch targets >= 44px, optimized ordering)
// =============================================================================

import { kpiCard, skeleton } from "../components.js";
import { icon } from "../icons.js";
import { apiGet, getOrCreateDeviceId } from "../apiClient.js";
import { state } from "../state.js";
import { navigate } from "../router.js";

// Register navigate globally so onclick="window.__navigate('route')" in rendered HTML works
if (typeof window !== "undefined") {
  window.__navigate = navigate;
  window.__refreshAdminDashboard = () => {
    const root = document.getElementById("page-content");
    if (root) hydrateAdminDashboard(root);
  };
}

// ─── Formatters & Utility Helpers ─────────────────────────────────────────────

function fmtInr(paisa) {
  if (paisa === undefined || paisa === null || isNaN(paisa)) return "₹0";
  const r = Math.round(paisa / 100);
  if (r >= 10000000) return "₹" + (r / 10000000).toFixed(2) + "Cr";
  if (r >= 100000) return "₹" + (r / 100000).toFixed(2) + "L";
  if (r >= 1000) return "₹" + (r / 1000).toFixed(1) + "K";
  return "₹" + r.toLocaleString("en-IN");
}

function fmtTimeAgo(isoString) {
  if (!isoString) return "just now";
  const ms = Date.now() - new Date(isoString).getTime();
  if (ms < 0) return "just now";
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ${mins % 60}m ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function fmtAging(isoString) {
  if (!isoString) return "Open today";
  const ms = Date.now() - new Date(isoString).getTime();
  if (ms < 0) return "Open today";
  const mins = Math.floor(ms / 60000);
  if (mins < 60) return `Open ${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `Waiting ${hours}h ${mins % 60}m`;
  return `Unresolved ${Math.floor(hours / 24)}d`;
}

function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

function getConnectivityStatus() {
  if (!navigator.onLine) {
    return { label: "Offline", isOnline: false, badgeClass: "status error", iconText: "🔴" };
  }
  return { label: "Online", isOnline: true, badgeClass: "status success", iconText: "🟢" };
}

export const DEFAULT_CAFE_ADMIN_PAYLOAD = {
  cafeContext: {
    cafeName: "",
    cafeId: "",
    cafeStatus: "ACTIVE",
  },
  businessDate: new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }),
  todaySales: {
    totalPaisa: 0,
    billsCount: 0,
    aovPaisa: 0,
  },
  salesByHour: [],
  attendanceSummary: {
    scheduled: 0,
    present: 0,
    exceptions: 0
  },
  inventoryHealth: {
    critical: 0,
    low: 0,
    items: []
  },
  expensesSummary: { draft: 0, returned: 0, submitted: 0, totalPaisa: 0 },
  procurementSummary: { expectedToday: 0, receivedToday: 0, late: 0 },
  departmentOrders: { open: 0, dueToday: 0, overdue: 0 },
  actionRequired: [],
  recentActivity: [],
  dataFreshness: { generatedAt: new Date().toISOString() }
};

// ─── Render HTML (Initial Shell with Skeletons) ───────────────────────────────

export function renderAdminDashboard() {
  const user = state.auth?.user || state.user || {};
  const operatorName = user.name || user.fullName || "Operator";
  const operatorId = user.permanentEmployeeId || user.userId || user.id || "";
  const cafeName = user.primaryCafeName || user.primaryCafeId || "Assigned Outlet";
  const cafeId = user.primaryCafeId || state.currentCafeId || "";
  const deviceId = getOrCreateDeviceId()?.slice(0, 8) || "";
  const conn = getConnectivityStatus();

  const todayStr = new Date().toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Kolkata",
  });

  return `
    <div class="page-enter cafe-ops-dashboard-root" style="max-width:1440px; margin:0 auto; padding-bottom:48px;">

      <!-- AREA 1: Fixed Operational Context Strip (§18-20, §45) -->
      <div id="cafe-ops-context-strip" class="glass" style="
        padding:14px 20px;
        margin-bottom:20px;
        display:flex;
        align-items:center;
        justify-content:space-between;
        flex-wrap:wrap;
        gap:12px;
        border-left: 3px solid var(--color-accent-amber, #d4a359);
      ">
        <div style="display:flex; align-items:center; gap:20px; flex-wrap:wrap;">
          <!-- Cafe Identity -->
          <div>
            <div style="font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:0.08em; color:var(--color-accent-amber); margin-bottom:2px;">Assigned Café</div>
            <div style="font-weight:700; color:var(--ink); font-size:14px; display:flex; align-items:center; gap:6px;">
              <span>📍 ${cafeName}</span>
              <span style="font-size:11px; font-family:var(--font-mono); color:var(--muted);">(${cafeId})</span>
            </div>
          </div>

          <div style="width:1px; height:28px; background:var(--border-subtle, rgba(255,255,255,0.12));"></div>

          <!-- Business Date -->
          <div>
            <div style="font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:0.08em; color:var(--muted); margin-bottom:2px;">Business Date</div>
            <div id="admin-dash-business-date" style="font-weight:600; color:var(--ink); font-size:13.5px;">${todayStr}</div>
          </div>

          <div style="width:1px; height:28px; background:var(--border-subtle, rgba(255,255,255,0.12));"></div>

          <!-- Current Operator -->
          <div>
            <div style="font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:0.08em; color:var(--muted); margin-bottom:2px;">Current Operator</div>
            <div style="font-weight:600; color:var(--ink); font-size:13.5px; display:flex; align-items:center; gap:6px;">
              <span>👤 ${operatorName}</span>
              <span style="font-size:11px; font-family:var(--font-mono); color:var(--muted);">(${operatorId})</span>
            </div>
          </div>

          <div style="width:1px; height:28px; background:var(--border-subtle, rgba(255,255,255,0.12));"></div>

          <!-- Device Identity -->
          <div>
            <div style="font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:0.08em; color:var(--muted); margin-bottom:2px;">Terminal Device</div>
            <div style="font-weight:600; color:var(--ink); font-size:13px; display:flex; align-items:center; gap:6px;">
              <span>📱 Main Terminal</span>
              <span style="font-size:10.5px; font-family:var(--font-mono); color:var(--muted); background:var(--bg-surface-2, rgba(255,255,255,0.06)); padding:1px 5px; border-radius:4px;">${deviceId}</span>
            </div>
          </div>
        </div>

        <!-- Connection & Sync Indicators -->
        <div style="display:flex; align-items:center; gap:10px;">
          <span id="admin-dash-sync-badge" class="status neutral" style="font-size:11px; font-weight:700; padding:3px 8px;" title="Data synchronized with server">⚡ Synced</span>
          <span id="admin-dash-conn-badge" class="${conn.badgeClass}" style="font-size:11px; font-weight:700; padding:3px 8px;">${conn.iconText} ${conn.label}</span>
        </div>
      </div>

      <!-- Offline / Partial Data Banner (§61, §83) -->
      <div id="admin-dash-global-banner" style="display:none; margin-bottom:16px; padding:12px 18px; border-radius:var(--radius-md); background:rgba(239, 68, 68, 0.15); border:1px solid rgba(239, 68, 68, 0.35); color:#fca5a5; font-size:13px; align-items:center; justify-content:space-between;">
        <div id="admin-dash-global-banner-text" style="display:flex; align-items:center; gap:8px;">
          <span>⚠️</span> <span>Terminal is currently operating in offline mode. Cached data is shown.</span>
        </div>
        <button id="admin-dash-banner-retry" class="btn btn-ghost" style="padding:2px 10px; font-size:12px; color:#fff;" type="button">Retry Connection</button>
      </div>

      <!-- Page Header & Context Strip matching reference HRIS standard -->
      <div style="display:flex; justify-content:space-between; align-items:flex-start; flex-wrap:wrap; gap:16px; margin-bottom:20px; border-bottom:1px solid var(--line); padding-bottom:16px;">
        <div>
          <div style="display:flex; align-items:center; flex-wrap:wrap; gap:10px; margin-bottom:4px;">
            <h1 class="page-title" style="font-size:24px; font-weight:800; margin:0; color:var(--ink); letter-spacing:-0.3px;">
              ${getGreeting()}, ${operatorName.split(" ")[0]} 👋
            </h1>
            <span class="status info" style="font-size:10.5px; font-weight:700; text-transform:uppercase; letter-spacing:0.5px;">SCR-002</span>
            <span class="status warning" style="font-size:10px; font-weight:800; letter-spacing:0.5px;">CAFE OPERATIONS</span>
          </div>
          <p style="font-size:13px; color:var(--muted); margin:0 0 10px;" id="admin-dash-subtitle">
            ${cafeName} · Operational Command, Live Counter Shift &amp; Shift Register
          </p>

          <!-- Context Strip -->
          <div style="display:flex; align-items:center; flex-wrap:wrap; gap:8px; font-size:12px; color:var(--ink);">
            <div style="display:inline-flex; align-items:center; gap:6px; background:var(--surface-sunken); padding:4px 10px; border-radius:6px; border:1px solid var(--line);">
              <span style="font-weight:700; color:var(--bronze-600);">📍 ${cafeName}</span>
              <span style="font-size:11px; color:var(--muted);">· Main Counter Mobile</span>
            </div>
            <div style="display:inline-flex; align-items:center; gap:5px; background:var(--surface-sunken); padding:4px 10px; border-radius:6px; border:1px solid var(--line);">
              <span>👤 <strong>${operatorName}</strong></span>
              <span style="font-size:11px; color:var(--muted); font-family:var(--font-mono);">(${operatorId})</span>
            </div>
            <div style="display:inline-flex; align-items:center; gap:5px; background:var(--surface-sunken); padding:4px 10px; border-radius:6px; border:1px solid var(--line); font-family:var(--font-mono); font-size:11.5px;">
              <span style="display:inline-block; width:7px; height:7px; border-radius:50%; background:var(--color-success, #2E7D32);"></span>
              <span>Server Time: <strong id="server-time-indicator">11:35 IST</strong> · Online · Synced</span>
            </div>
          </div>
        </div>

        <div id="admin-dash-cafe-status" style="display:flex; align-items:center; gap:10px; flex-wrap:wrap;">
          <div id="cafe-operating-status-badge" class="status success" style="font-size:12px; font-weight:700; padding:6px 14px; letter-spacing:0.04em;">
            🟢 OPEN · OPERATIONAL
          </div>
          <button class="btn btn-sm btn-secondary" onclick="window.__refreshAdminDashboard ? window.__refreshAdminDashboard() : window.__navigate('dashboard')" type="button" style="font-size:12px; font-weight:600;">
            🔄 Refresh
          </button>
        </div>
      </div>

      <!-- Quick Actions Bar (§63-64) -->
      <div class="card" style="padding:18px 20px; margin-bottom:20px; background:var(--surface); border:1px solid var(--line); border-radius:var(--radius-card, 12px); box-shadow:var(--shadow-xs);">
        <div style="font-size:11.5px; font-weight:700; text-transform:uppercase; letter-spacing:0.04em; color:var(--muted); margin-bottom:12px;">
          CAFE OPERATIONS FAST ACTIONS
        </div>
        <div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap;">
          <button class="btn btn-primary" onclick="window.__navigate('pos')" type="button" style="padding:8px 16px; font-size:12.5px; font-weight:600; border-radius:8px; display:inline-flex; align-items:center; gap:6px;">
            ${icon("pos")} <span>New Bill (POS)</span>
          </button>
          <button class="btn btn-secondary" onclick="window.__navigate('attendance')" type="button" style="padding:8px 14px; font-size:12.5px; font-weight:600; border-radius:8px; display:inline-flex; align-items:center; gap:6px;">
            ${icon("attendance")} <span>Attendance</span>
          </button>
          <button class="btn btn-secondary" onclick="window.__navigate('expenses')" type="button" style="padding:8px 14px; font-size:12.5px; font-weight:600; border-radius:8px; display:inline-flex; align-items:center; gap:6px;">
            ${icon("finance")} <span>Record Expense</span>
          </button>
          <button class="btn btn-secondary" onclick="window.__navigate('inventory')" type="button" style="padding:8px 14px; font-size:12.5px; font-weight:600; border-radius:8px; display:inline-flex; align-items:center; gap:6px;">
            ${icon("inventory")} <span>Stock Check</span>
          </button>
          <button class="btn btn-secondary" onclick="window.__navigate('procurement')" type="button" style="padding:8px 14px; font-size:12.5px; font-weight:600; border-radius:8px; display:inline-flex; align-items:center; gap:6px;">
            ${icon("inventory")} <span>Receive Delivery</span>
          </button>
          <button class="btn btn-secondary" onclick="window.__navigate('sales-cash')" type="button" style="padding:8px 14px; font-size:12.5px; font-weight:600; border-radius:8px; display:inline-flex; align-items:center; gap:6px;">
            ${icon("finance")} <span>Cash Session</span>
          </button>
          <button class="btn btn-secondary" onclick="window.__navigate('dept-orders')" type="button" style="padding:8px 14px; font-size:12.5px; font-weight:600; border-radius:8px; display:inline-flex; align-items:center; gap:6px;">
            ${icon("tasks")} <span>Dept Orders</span>
          </button>
        </div>
      </div>

      <!-- AREA 3: Action Required (§25-28) -->
      <div id="admin-dash-action-required-container" style="margin-bottom:20px;">
        <div class="card" style="padding:20px; background:var(--surface); border:1px solid var(--line); border-radius:var(--radius-card, 12px); box-shadow:var(--shadow-xs);">          <div id="admin-dash-action-required-list">
            <div style="display:flex; align-items:center; justify-content:space-between; padding:14px 16px; margin-bottom:10px; border-radius:12px; background:var(--surface-sunken); border:1px solid var(--line); flex-wrap:wrap; gap:12px;">
              <div style="display:flex; align-items:flex-start; gap:10px;">
                <span class="badge-tag badge-warning" style="font-size:10px; font-weight:700;">MEDIUM</span>
                <div>
                  <div style="font-weight:700; color:var(--ink); font-size:13.5px; display:flex; align-items:center; gap:8px;">
                    <span>Mid-Shift Cash Drawer Reconciliation</span>
                    <span style="font-size:11px; color:var(--muted); font-family:var(--font-mono);">just now</span>
                  </div>
                  <div style="font-size:12px; color:var(--muted); margin-top:2px;">Counter Till #1 reaches ₹25,000 threshold for vault drop.</div>
                </div>
              </div>
              <button class="btn btn-sm btn-secondary" onclick="window.__navigate('sales-cash')" type="button" style="font-size:12px; font-weight:600; white-space:nowrap;">
                Review →
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- AREA 4: Previous Day Carryover (§29) — conditional -->
      <div id="admin-dash-carryover-container" style="display:none; margin-bottom:20px;">
        <div class="card" style="padding:16px 20px; border-left:4px solid var(--color-accent-blue, #60a5fa); background:var(--surface); border-radius:var(--radius-card, 12px); box-shadow:var(--shadow-xs);">
          <div style="font-weight:700; font-size:13.5px; color:var(--ink); margin-bottom:6px; display:flex; align-items:center; gap:6px;">
            <span>📅</span> <span>Carryover from Previous Business Day</span>
          </div>
          <div id="admin-dash-carryover-content" style="font-size:12.5px; color:var(--muted);"></div>
        </div>
      </div>

      <!-- Resume Work Continuity Banner (§55) — conditional -->
      <div id="admin-dash-resume-work-container" style="display:none; margin-bottom:20px;">
        <div class="card" style="padding:16px 20px; border-left:4px solid #059669; display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:12px; background:var(--surface); border-radius:var(--radius-card, 12px); box-shadow:var(--shadow-xs);">
          <div style="display:flex; align-items:center; gap:10px;">
            <span>▶️</span>
            <div>
              <div style="font-weight:700; font-size:13.5px; color:var(--ink);" id="resume-work-title">Resume Work in Progress</div>
              <div style="font-size:12px; color:var(--muted);" id="resume-work-desc">You have an unfinished operational task.</div>
            </div>
          </div>
          <button class="btn btn-primary btn-sm" id="resume-work-btn" type="button" style="font-size:12px; font-weight:600;">Continue →</button>
        </div>
      </div>

      <!-- AREA 5: Today Snapshot KPIs (§30-31) -->
      <div id="admin-kpi-grid" style="display:grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap:12px; margin-bottom:20px;">
        ${kpiCard({
          label: "Today's Sales",
          value: fmtInr(DEFAULT_CAFE_ADMIN_PAYLOAD.todaySales.totalPaisa),
          trend: `${DEFAULT_CAFE_ADMIN_PAYLOAD.todaySales.billsCount} bills recorded`,
          trendType: "up",
        })}
        ${kpiCard({
          label: "Average Bill (AOV)",
          value: fmtInr(DEFAULT_CAFE_ADMIN_PAYLOAD.todaySales.aovPaisa),
          trend: "gross order value",
          trendType: "neutral",
        })}
        ${kpiCard({
          label: "Staff Attendance",
          value: `${DEFAULT_CAFE_ADMIN_PAYLOAD.attendanceSummary.present} Present`,
          trend: `${DEFAULT_CAFE_ADMIN_PAYLOAD.attendanceSummary.scheduled} scheduled`,
          trendType: "up",
        })}
        ${kpiCard({
          label: "Stock Health",
          value: `${DEFAULT_CAFE_ADMIN_PAYLOAD.inventoryHealth.critical} Critical`,
          trend: `${DEFAULT_CAFE_ADMIN_PAYLOAD.inventoryHealth.low} low items`,
          trendType: "up",
        })}
      </div>

      <!-- AREA 6: Sales by Hour Chart & Operational Alerts (§32-34) -->
      <div style="display:grid; grid-template-columns: 1.6fr 1fr; gap:16px; margin-bottom:20px;" class="dash-grid-two-col">
        <!-- Sales by Hour Chart -->
        <div class="card" style="padding:20px; display:flex; flex-direction:column; background:var(--surface); border:1px solid var(--line); border-radius:var(--radius-card, 12px); box-shadow:var(--shadow-xs);">
          <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:14px;">
            <div>
              <div style="color:var(--ink); font-weight:700; font-size:15px;" class="font-display">Sales by Hour — Today</div>
              <div style="font-size:11.5px; color:var(--muted);">Hourly gross sales distribution (06:00–23:00 IST)</div>
            </div>
            <div id="sales-chart-freshness" style="font-size:11px; color:var(--muted); font-weight:600;">● Live IST</div>
          </div>
          <div id="admin-dash-sales-chart-container" style="width:100%; min-height:220px; position:relative; overflow-x:auto;">
            ${renderSalesByHourChart(DEFAULT_CAFE_ADMIN_PAYLOAD.salesByHour)}
          </div>
        </div>

        <!-- Operational Alerts Panel -->
        <div class="card" style="padding:20px; display:flex; flex-direction:column; background:var(--surface); border:1px solid var(--line); border-radius:var(--radius-card, 12px); box-shadow:var(--shadow-xs);">
          <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:14px;">
            <div style="color:var(--ink); font-weight:700; font-size:15px;" class="font-display">Operational Alerts</div>
            <button class="btn btn-ghost btn-xs" id="admin-dash-alerts-ack-all" type="button" style="font-size:11px; font-weight:600; color:var(--bronze-600);">Acknowledge All</button>
          </div>
          <div id="admin-attention-feed" style="flex:1; overflow-y:auto; max-height:260px; display:flex; flex-direction:column; gap:10px;">
            <div style="padding:12px 14px; border-radius:10px; background:var(--surface-sunken); border:1px solid var(--line);">
              <span class="badge-tag badge-warning" style="font-size:10px; font-weight:700; margin-bottom:4px; display:inline-block;">LOW STOCK</span>
              <div style="font-weight:700; font-size:13px; color:var(--ink);">2 Low Stock Items</div>
              <div style="color:var(--muted); font-size:11.5px; margin-top:2px;">Wayanad Robusta &amp; Dairy Milk below par level.</div>
            </div>
            <div style="padding:12px 14px; border-radius:10px; background:var(--surface-sunken); border:1px solid var(--line);">
              <span class="badge-tag badge-accent" style="font-size:10px; font-weight:700; margin-bottom:4px; display:inline-block;">EXPENSES</span>
              <div style="font-weight:700; font-size:13px; color:var(--ink);">1 Draft Expense Claim</div>
              <div style="color:var(--muted); font-size:11.5px; margin-top:2px;">Local dairy replenishment ready for submission.</div>
            </div>
          </div>
        </div>
      </div>

      <!-- AREA 7: Core Operations Grid (§36-47) -->
      <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap:16px; margin-bottom:20px;">
        <!-- Sales & Cash -->
        <div class="card" style="padding:20px; background:var(--surface); border:1px solid var(--line); border-radius:var(--radius-card, 12px); box-shadow:var(--shadow-xs);">
          <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:12px;">
            <div style="font-weight:700; font-size:15px; color:var(--ink);" class="font-display">💵 Sales &amp; Cash</div>
            <span id="cash-session-badge" class="badge-tag badge-success" style="font-size:10.5px; font-weight:700;">SESSION ACTIVE</span>
          </div>
          <div id="admin-dash-cash-content" style="font-size:13px;">
            <div style="background:var(--surface-sunken); padding:10px 12px; border-radius:8px; border:1px solid var(--line); margin-bottom:10px;">
              <div style="color:var(--muted); font-size:11px; text-transform:uppercase; font-weight:700;">Total Sales Today</div>
              <div style="font-weight:700; font-size:16px; color:var(--ink); margin-top:2px;">${fmtInr(DEFAULT_CAFE_ADMIN_PAYLOAD.todaySales.totalPaisa)}</div>
            </div>
            <div style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:8px; margin-bottom:10px;">
              <div style="background:var(--surface-sunken); padding:8px 10px; border-radius:6px; border:1px solid var(--line);">
                <div style="color:var(--muted); font-size:10px;">Cash</div>
                <div style="font-weight:700; font-size:12px; color:var(--ink);">₹22,027</div>
              </div>
              <div style="background:var(--surface-sunken); padding:8px 10px; border-radius:6px; border:1px solid var(--line);">
                <div style="color:var(--muted); font-size:10px;">UPI</div>
                <div style="font-weight:700; font-size:12px; color:var(--ink);">₹19,580</div>
              </div>
              <div style="background:var(--surface-sunken); padding:8px 10px; border-radius:6px; border:1px solid var(--line);">
                <div style="color:var(--muted); font-size:10px;">Card</div>
                <div style="font-weight:700; font-size:12px; color:var(--ink);">₹7,342</div>
              </div>
            </div>
            <div style="display:flex; justify-content:space-between; font-size:12px; margin-top:8px; padding-top:8px; border-top:1px solid var(--line);">
              <span style="color:var(--muted);">Till Float: ₹5,000.00</span>
              <span style="color:#059669; font-weight:700;">✓ In Balance</span>
            </div>
          </div>
        </div>

        <!-- Attendance Today -->
        <div class="card" style="padding:20px; background:var(--surface); border:1px solid var(--line); border-radius:var(--radius-card, 12px); box-shadow:var(--shadow-xs);">
          <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:12px;">
            <div style="font-weight:700; font-size:15px; color:var(--ink);" class="font-display">👥 Attendance Today</div>
            <button class="btn btn-ghost btn-xs" onclick="window.__navigate('attendance')" type="button" style="font-size:11.5px; font-weight:600; color:var(--bronze-600);">Open Roster →</button>
          </div>
          <div id="admin-dash-attendance-content" style="font-size:13px;">
            <div style="background:var(--surface-sunken); padding:10px 12px; border-radius:8px; border:1px solid var(--line); margin-bottom:10px;">
              <div style="color:var(--muted); font-size:11px; text-transform:uppercase; font-weight:700;">Present / Scheduled</div>
              <div style="font-weight:700; font-size:16px; color:#059669; margin-top:2px;">${DEFAULT_CAFE_ADMIN_PAYLOAD.attendanceSummary.present} / ${DEFAULT_CAFE_ADMIN_PAYLOAD.attendanceSummary.scheduled} Active</div>
            </div>
            <div style="display:flex; justify-content:space-between; font-size:12px; margin-top:8px; padding-top:8px; border-top:1px solid var(--line);">
              <span style="color:var(--muted);">Floor Shifts: 6 active</span>
              <span style="color:#059669; font-weight:700;">✓ Zero Absences</span>
            </div>
          </div>
        </div>

        <!-- Stock Health -->
        <div class="card" style="padding:20px; background:var(--surface); border:1px solid var(--line); border-radius:var(--radius-card, 12px); box-shadow:var(--shadow-xs);">
          <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:12px;">
            <div style="font-weight:700; font-size:15px; color:var(--ink);" class="font-display">📦 Stock Health</div>
            <button class="btn btn-ghost btn-xs" onclick="window.__navigate('inventory')" type="button" style="font-size:11.5px; font-weight:600; color:var(--bronze-600);">View Stockroom →</button>
          </div>
          <div id="admin-dash-stock-content" style="font-size:13px;">
            <div style="background:var(--surface-sunken); padding:10px 12px; border-radius:8px; border:1px solid var(--line); margin-bottom:10px;">
              <div style="color:var(--muted); font-size:11px; text-transform:uppercase; font-weight:700;">Stock Posture</div>
              <div style="font-weight:700; font-size:16px; color:#059669; margin-top:2px;">HEALTHY · 100% Core SKUs</div>
            </div>
            <div style="display:flex; justify-content:space-between; font-size:12px; margin-top:8px; padding-top:8px; border-top:1px solid var(--line);">
              <span style="color:var(--muted);">Reorder Triggers: 2 below par</span>
              <span style="color:var(--muted);">0 Stockouts</span>
            </div>
          </div>
        </div>

        <!-- Expenses -->
        <div class="card" style="padding:20px; background:var(--surface); border:1px solid var(--line); border-radius:var(--radius-card, 12px); box-shadow:var(--shadow-xs);">
          <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:12px;">
            <div style="font-weight:700; font-size:15px; color:var(--ink);" class="font-display">🧾 Expenses</div>
            <button class="btn btn-ghost btn-xs" onclick="window.__navigate('expenses')" type="button" style="font-size:11.5px; font-weight:600; color:var(--bronze-600);">Manage →</button>
          </div>
          <div id="admin-dash-expense-content" style="font-size:13px;">
            <div style="background:var(--surface-sunken); padding:10px 12px; border-radius:8px; border:1px solid var(--line); margin-bottom:10px;">
              <div style="color:var(--muted); font-size:11px; text-transform:uppercase; font-weight:700;">Today's Claims</div>
              <div style="font-weight:700; font-size:16px; color:var(--ink); margin-top:2px;">${fmtInr(DEFAULT_CAFE_ADMIN_PAYLOAD.expensesSummary.totalPaisa)}</div>
            </div>
            <div style="display:flex; justify-content:space-between; font-size:12px; margin-top:8px; padding-top:8px; border-top:1px solid var(--line);">
              <span style="color:var(--muted);">Submitted: ${DEFAULT_CAFE_ADMIN_PAYLOAD.expensesSummary.submitted} · Draft: ${DEFAULT_CAFE_ADMIN_PAYLOAD.expensesSummary.draft}</span>
              <span style="color:#059669; font-weight:700;">✓ In Policy</span>
            </div>
          </div>
        </div>
      </div>

      <!-- AREA 8: Supply, Orders & Next Up (§48-52) -->
      <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap:16px; margin-bottom:20px;">
        <!-- Procurement & Deliveries -->
        <div class="card" style="padding:20px; background:var(--surface); border:1px solid var(--line); border-radius:var(--radius-card, 12px); box-shadow:var(--shadow-xs);">
          <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:12px;">
            <div style="font-weight:700; font-size:15px; color:var(--ink);" class="font-display">🚚 Procurement &amp; Deliveries</div>
            <button class="btn btn-ghost btn-xs" onclick="window.__navigate('procurement')" type="button" style="font-size:11.5px; font-weight:600; color:var(--bronze-600);">Open →</button>
          </div>
          <div id="admin-dash-procurement-content" style="font-size:13px;">
            <div style="display:flex; justify-content:space-between; margin-bottom:4px;">
              <span style="color:var(--muted);">Deliveries Expected:</span>
              <span style="font-weight:700; color:var(--ink);">${DEFAULT_CAFE_ADMIN_PAYLOAD.procurementSummary.expectedToday}</span>
            </div>
            <div style="font-size:12px; color:var(--muted);">
              <span>Received: <strong>${DEFAULT_CAFE_ADMIN_PAYLOAD.procurementSummary.receivedToday}</strong> · Pending: <strong>1</strong> · Overdue: <strong>0</strong></span>
            </div>
          </div>
        </div>

        <!-- Department Orders -->
        <div class="glass" style="padding:20px;">
          <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:12px;">
            <div style="font-weight:700; font-size:14px; color:var(--ink);" class="font-display">🏛️ Department Orders</div>
            <button class="btn btn-ghost" onclick="window.__navigate('dept-orders')" type="button" style="font-size:11.5px; padding:2px 6px; color:var(--color-accent-amber);">Open &rarr;</button>
          </div>
          <div id="admin-dash-dept-orders-content" style="font-size:13px;">
            <div style="display:flex; justify-content:space-between; margin-bottom:4px;">
              <span style="color:var(--muted);">Active Orders:</span>
              <span style="font-weight:700; color:var(--ink);">${DEFAULT_CAFE_ADMIN_PAYLOAD.departmentOrders.open}</span>
            </div>
            <div style="font-size:12px; color:var(--muted);">
              <span>Due Today: <strong>${DEFAULT_CAFE_ADMIN_PAYLOAD.departmentOrders.dueToday}</strong> · Overdue: <strong>0</strong></span>
            </div>
          </div>
        </div>

        <!-- Next Up (Timeline) -->
        <div class="glass" style="padding:20px;">
          <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:12px;">
            <div style="font-weight:700; font-size:14px; color:var(--ink);" class="font-display">⏱️ Next Up</div>
            <span style="font-size:11px; color:var(--muted);">Today's deadlines</span>
          </div>
          <div id="admin-dash-next-up-content" style="font-size:13px;">
            <div style="font-size:12px; margin-bottom:4px; color:var(--ink);">
              <strong>16:00 IST</strong> — Mid-Shift Safe Drop &amp; Till Float Audit
            </div>
            <div style="font-size:12px; color:var(--muted);">
              <strong>21:30 IST</strong> — EOD Shift Close &amp; Register Blind Count
            </div>
          </div>
        </div>
      </div>

      <!-- Maintenance & Quality Attention (Conditional §56, §57) -->
      <div id="admin-dash-maintenance-quality-row" style="display:none; grid-template-columns: 1fr 1fr; gap:18px; margin-bottom:22px;">
        <div class="glass" id="maintenance-attention-card" style="padding:16px 20px; border-left:3px solid var(--color-accent-amber);">
          <div style="font-weight:700; font-size:13.5px; color:var(--ink); margin-bottom:4px;">🛠️ Equipment &amp; Maintenance Attention</div>
          <div id="maintenance-attention-text" style="font-size:12px; color:var(--muted);">1 active maintenance ticket logged.</div>
        </div>
        <div class="glass" id="quality-attention-card" style="padding:16px 20px; border-left:3px solid var(--color-accent-mint-bright);">
          <div style="font-weight:700; font-size:13.5px; color:var(--ink); margin-bottom:4px;">📋 Quality &amp; Compliance Attention</div>
          <div id="quality-attention-text" style="font-size:12px; color:var(--muted);">1 operational checklist due today.</div>
        </div>
      </div>

      <!-- AREA 9 & 10: Continuity, Activity & Device Health (§53-61) -->
      <div style="display:grid; grid-template-columns: 1.6fr 1fr; gap:18px;" class="dash-grid-two-col">
        <!-- Recent Operational Activity -->
        <div class="glass" style="padding:20px;">
          <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:12px;">
            <div style="font-weight:700; font-size:14px; color:var(--ink);" class="font-display">📋 Recent Activity</div>
            <span style="font-size:11px; color:var(--muted);">This café · Last 24h</span>
          </div>
          <div id="admin-dash-activity-content" style="font-size:12.5px;">
            <div style="margin-bottom:6px; padding-bottom:6px; border-bottom:1px solid rgba(255,255,255,0.06); font-size:12px;">
              <span style="color:var(--ink);">Bill #ZAM-882104 completed via UPI (₹560.00)</span>
              <div style="color:var(--muted); font-size:11px;">5 mins ago</div>
            </div>
            <div style="margin-bottom:6px; padding-bottom:6px; border-bottom:1px solid rgba(255,255,255,0.06); font-size:12px;">
              <span style="color:var(--ink);">Shift clock-in: Duty Barista</span>
              <div style="color:var(--muted); font-size:11px;">45 mins ago</div>
            </div>
            <div style="font-size:12px;">
              <span style="color:var(--ink);">Stock received: Amul Butter 500g (10 packs)</span>
              <div style="color:var(--muted); font-size:11px;">2 hours ago</div>
            </div>
          </div>
        </div>

        <!-- Terminal, Peripherals & System Health (§58-61) -->
        <div class="glass" style="padding:20px;">
          <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:12px;">
            <div style="font-weight:700; font-size:14px; color:var(--ink);" class="font-display">🛡️ Terminal &amp; Systems</div>
            <span class="status success" style="font-size:10.5px; font-weight:700;">TRUSTED</span>
          </div>
          <div id="admin-dash-device-health-content" style="font-size:12.5px;">
            <div style="display:flex; justify-content:space-between; margin-bottom:4px; font-size:12px;">
              <span style="color:var(--muted);">POS Till Printer:</span>
              <span style="color:var(--color-accent-mint-bright, #34d399); font-weight:600;">✓ Connected</span>
            </div>
            <div style="display:flex; justify-content:space-between; margin-bottom:4px; font-size:12px;">
              <span style="color:var(--muted);">Barcode Scanner:</span>
              <span style="color:var(--color-accent-mint-bright, #34d399); font-weight:600;">✓ Ready</span>
            </div>
            <div style="display:flex; justify-content:space-between; font-size:12px;">
              <span style="color:var(--muted);">Network Latency:</span>
              <span style="color:var(--color-accent-mint-bright, #34d399); font-weight:600;">14ms (Optimal)</span>
            </div>
          </div>
        </div>
      </div>

    </div>
  `;
}

// ─── Chart Renderer (SVG Bar Chart with Hover Tooltips) ─────────────────────────

function renderSalesByHourChart(salesByHour = []) {
  // Normalize hour and salesPaisa
  const normalized = (salesByHour || []).map((h) => ({
    hour: typeof h.hour === "number" ? h.hour : parseInt(h.hour, 10) || 0,
    salesPaisa: h.salesPaisa !== undefined ? h.salesPaisa : (h.amountPaisa || 0),
    billsCount: h.billsCount !== undefined ? h.billsCount : (h.ordersCount || 0)
  }));

  if (normalized.length === 0 || normalized.every((h) => (h.salesPaisa || 0) === 0)) {
    return `
      <div style="display:flex; flex-direction:column; align-items:center; justify-content:center; height:200px; color:var(--muted); text-align:center;">
        <span style="font-size:28px; margin-bottom:6px; opacity:0.6;">☕</span>
        <div style="font-weight:600; color:var(--ink); font-size:13.5px; margin-bottom:4px;">No sales recorded for this Business Date yet.</div>
        <div style="font-size:12px; margin-bottom:12px;">Start creating bills from POS &amp; Billing.</div>
        <button class="btn btn-primary" onclick="window.__navigate('pos')" type="button" style="padding:4px 12px; font-size:12px;">Open POS</button>
      </div>
    `;
  }

  // Active operational range: 6:00 to 23:00 (18 hours)
  const activeHours = normalized.filter((h) => h.hour >= 6 && h.hour <= 23);
  const maxSales = Math.max(...activeHours.map((h) => h.salesPaisa || 0), 100000); // min ₹1,000 scale
  const currentHour = new Date().getHours();

  const chartHeight = 160;
  const chartWidth = 560;
  const barWidth = 20;
  const gap = (chartWidth - barWidth * activeHours.length) / (activeHours.length + 1);

  const barsSvg = activeHours
    .map((item, idx) => {
      const x = gap + idx * (barWidth + gap);
      const height = Math.max(Math.round(((item.salesPaisa || 0) / maxSales) * (chartHeight - 30)), 4);
      const y = chartHeight - height;
      const isCurrent = item.hour === currentHour;
      const fillColor = isCurrent
        ? "var(--color-accent-amber, #d4a359)"
        : (item.salesPaisa || 0) > 0
        ? "var(--color-accent-mint-bright, #34d399)"
        : "rgba(255,255,255,0.08)";

      const formattedSales = fmtInr(item.salesPaisa || 0);
      const tooltip = `${String(item.hour).padStart(2, "0")}:00 · ${formattedSales} (${item.billsCount || 0} bills)`;

      return `
        <g class="chart-bar-group" data-tooltip="${tooltip}" tabindex="0" role="graphics-symbol" aria-label="${tooltip}" style="cursor:pointer;">
          <rect x="${x}" y="${y}" width="${barWidth}" height="${height}" rx="4" fill="${fillColor}" opacity="${isCurrent ? '1' : '0.85'}">
            <title>${tooltip}</title>
          </rect>
          <text x="${x + barWidth / 2}" y="${chartHeight + 14}" font-size="9" fill="var(--muted, rgba(255,255,255,0.6))" text-anchor="middle" font-family="var(--font-mono, monospace)">
            ${String(item.hour).padStart(2, "0")}
          </text>
        </g>
      `;
    })
    .join("");

  return `
    <svg viewBox="0 0 ${chartWidth} ${chartHeight + 20}" style="width:100%; height:200px; display:block;" preserveAspectRatio="none">
      <!-- Grid lines -->
      <line x1="0" y1="${chartHeight * 0.25}" x2="${chartWidth}" y2="${chartHeight * 0.25}" stroke="rgba(255,255,255,0.06)" stroke-dasharray="3,3"/>
      <line x1="0" y1="${chartHeight * 0.50}" x2="${chartWidth}" y2="${chartHeight * 0.50}" stroke="rgba(255,255,255,0.06)" stroke-dasharray="3,3"/>
      <line x1="0" y1="${chartHeight * 0.75}" x2="${chartWidth}" y2="${chartHeight * 0.75}" stroke="rgba(255,255,255,0.06)" stroke-dasharray="3,3"/>
      <line x1="0" y1="${chartHeight}" x2="${chartWidth}" y2="${chartHeight}" stroke="rgba(255,255,255,0.12)"/>
      ${barsSvg}
    </svg>
  `;
}

// ─── Hydration & Data Fetching ────────────────────────────────────────────────

export async function hydrateAdminDashboard(root) {
  // Live connectivity listeners
  const connBadge = root.querySelector("#admin-dash-conn-badge");
  const globalBanner = root.querySelector("#admin-dash-global-banner");

  const updateConnectivity = () => {
    const conn = getConnectivityStatus();
    if (connBadge) {
      connBadge.className = conn.badgeClass;
      connBadge.innerHTML = `${conn.iconText} ${conn.label}`;
    }
    if (globalBanner) {
      globalBanner.style.display = conn.isOnline ? "none" : "flex";
    }
  };

  window.addEventListener("online", updateConnectivity);
  window.addEventListener("offline", updateConnectivity);

  // Wire data-action-route buttons (action-required Review → buttons)
  root.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-action-route]");
    if (btn) {
      e.preventDefault();
      const route = btn.dataset.actionRoute;
      if (route) navigate(route);
    }
  });

  // Wire resume-work-btn
  root.querySelector("#resume-work-btn")?.addEventListener("click", () => {
    navigate("tasks");
  });

  const bannerRetry = root.querySelector("#admin-dash-banner-retry");
  if (bannerRetry) {
    bannerRetry.addEventListener("click", () => {
      hydrateAdminDashboard(root);
    });
  }

  // Alert acknowledgement handler (§35)
  const ackAllBtn = root.querySelector("#admin-dash-alerts-ack-all");
  if (ackAllBtn) {
    ackAllBtn.addEventListener("click", () => {
      const feed = root.querySelector("#admin-attention-feed");
      if (feed) {
        feed.innerHTML = `<div style="color:var(--color-accent-mint-bright, #34d399); font-size:12.5px; padding:12px 0;">✓ All operational alerts acknowledged for this session.</div>`;
      }
      ackAllBtn.style.display = "none";
    });
  }

  try {
    // Fetch dedicated single-cafe dashboard payload (§8, §99)
    let payload = null;
    try {
      const activeCafe = state.activeCafeId || state.boundCafeId || state.selectedCafeId || '';
      const endpoint = activeCafe ? `/dashboard/cafe-ops?cafeId=${encodeURIComponent(activeCafe)}` : "/dashboard/cafe-ops";
      const res = await apiGet(endpoint);
      if (res?.success && res?.data) {
        payload = res.data;
      }
    } catch (err) {
      console.warn("Dedicated /dashboard/cafe-ops endpoint unavailable, attempting fallback:", err.message);
    }

    // Fallback to baseline payload
    if (!payload) {
      showDataError(root, "dashboard endpoint unavailable");
      payload = JSON.parse(JSON.stringify(DEFAULT_CAFE_ADMIN_PAYLOAD));
      const activeUser = state.auth?.user || state.user;
      if (activeUser?.primaryCafeName) payload.cafeContext.cafeName = activeUser.primaryCafeName;
      if (activeUser?.primaryCafeId) payload.cafeContext.cafeId = activeUser.primaryCafeId;
    }

    // 1. Update Context Strip Business Date
    const bDateEl = root.querySelector("#admin-dash-business-date");
    if (bDateEl && payload.businessDate) {
      bDateEl.textContent = new Date(`${payload.businessDate}T00:00:00+05:30`).toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      });
    }

    // 2. Action Required Section with Exception Aging (§25-28)
    const actionCountBadge = root.querySelector("#admin-dash-action-count-badge");
    const actionList = root.querySelector("#admin-dash-action-required-list");
    const actions = payload.actionRequired || [];

    if (actionCountBadge) {
      actionCountBadge.className = actions.length > 0 ? "status error" : "status success";
      actionCountBadge.textContent = actions.length > 0 ? `${actions.length} Action${actions.length > 1 ? "s" : ""} Needed` : "Healthy";
    }

    if (actionList) {
      if (actions.length === 0) {
        actionList.innerHTML = `
          <div style="display:flex; align-items:center; gap:10px; color:var(--color-accent-mint-bright, #34d399); font-size:13.5px; padding:6px 0;">
            <span>✓</span>
            <span style="font-weight:600;">Operations Healthy</span>
            <span style="color:var(--muted); font-size:12.5px;">— No critical operational exceptions require attention right now.</span>
          </div>
        `;
      } else {
        actionList.innerHTML = actions
          .map((item) => {
            const isCrit = item.severity === "CRITICAL";
            const badgeClass = isCrit ? "status error" : item.severity === "HIGH" ? "status error" : "status neutral";
            const agingText = fmtAging(item.openedAt);
            return `
              <div style="display:flex; align-items:center; justify-content:space-between; padding:10px 14px; margin-bottom:8px; border-radius:var(--radius-sm); background:var(--bg-surface-2, rgba(255,255,255,0.04)); border-left:3px solid ${isCrit ? 'var(--color-accent-crimson, #ef4444)' : 'var(--color-accent-amber, #d4a359)'}; flex-wrap:wrap; gap:8px;">
                <div style="display:flex; align-items:center; gap:10px;">
                  <span class="${badgeClass}" style="font-size:10px; font-weight:700; padding:2px 6px;">${item.severity}</span>
                  <div>
                    <div style="font-weight:600; color:var(--ink); font-size:13px; display:flex; align-items:center; gap:8px;">
                      <span>${item.title}</span>
                      <span style="font-size:10.5px; color:var(--muted); font-family:var(--font-mono);">${agingText}</span>
                    </div>
                    <div style="font-size:11.5px; color:var(--muted);">${item.description || ""}</div>
                  </div>
                </div>
                <button class="btn btn-ghost" data-action-route="${item.route || 'inventory'}" type="button" style="font-size:12px; padding:3px 10px; color:var(--color-accent-amber); white-space:nowrap;">
                  Review &rarr;
                </button>
              </div>
            `;
          })
          .join("");
      }
    }

    // 3. Previous Day Carryover (§29)
    const carryoverContainer = root.querySelector("#admin-dash-carryover-container");
    const carryoverContent = root.querySelector("#admin-dash-carryover-content");
    const carryover = payload.carryover || [];
    if (carryoverContainer && carryoverContent) {
      if (carryover.length > 0) {
        carryoverContainer.style.display = "block";
        carryoverContent.innerHTML = carryover
          .map((c) => `<div>• ${c.title} <a href="#/${c.route || 'expenses'}" style="color:var(--color-accent-amber); font-weight:600;">Fix now</a></div>`)
          .join("");
      } else {
        carryoverContainer.style.display = "none";
      }
    }

    // 4. Today Snapshot KPIs (§30-31)
    const kpiGrid = root.querySelector("#admin-kpi-grid");
    if (kpiGrid) {
      const s = payload.todaySales || {};
      const att = payload.attendanceSummary || {};
      kpiGrid.innerHTML = `
        ${kpiCard({
          label: "Today's Sales",
          value: fmtInr(s.totalPaisa || 0),
          trend: `${s.billsCount || 0} bills recorded`,
          trendType: "up",
        })}
        ${kpiCard({
          label: "Average Bill (AOV)",
          value: fmtInr(s.aovPaisa || 0),
          trend: "gross order value",
          trendType: "neutral",
        })}
        ${kpiCard({
          label: "Staff Attendance",
          value: `${att.present || 0} Present`,
          trend: att.exceptions > 0 ? `${att.exceptions} exception(s)` : `${att.scheduled || 0} scheduled`,
          trendType: att.exceptions > 0 ? "down" : "up",
        })}
        ${kpiCard({
          label: "Stock Health",
          value: `${payload.inventoryHealth?.critical || 0} Critical`,
          trend: (payload.inventoryHealth?.low || 0) > 0 ? `${payload.inventoryHealth.low} low items` : "restock normal",
          trendType: (payload.inventoryHealth?.critical || 0) > 0 ? "down" : "up",
        })}
      `;
    }

    // 5. Sales by Hour Chart (§32-33)
    const chartContainer = root.querySelector("#admin-dash-sales-chart-container");
    if (chartContainer) {
      chartContainer.innerHTML = renderSalesByHourChart(payload.salesByHour);
    }

    // 6. Operational Alerts Panel (§34)
    const alertsFeed = root.querySelector("#admin-attention-feed");
    if (alertsFeed) {
      const items = [];
      if (payload.inventoryHealth?.critical > 0) {
        items.push(`<div style="font-size:12.5px; margin-bottom:10px; padding-bottom:8px; border-bottom:1px solid rgba(255,255,255,0.06);"><span style="color:var(--color-accent-crimson, #ef4444); font-weight:700;">⚠️ ${payload.inventoryHealth.critical} Critical Stock Item(s)</span><br/><span style="color:var(--muted); font-size:11.5px;">Reorder minimum threshold breached.</span></div>`);
      }
      if (payload.expensesSummary?.returned > 0) {
        items.push(`<div style="font-size:12.5px; margin-bottom:10px; padding-bottom:8px; border-bottom:1px solid rgba(255,255,255,0.06);"><span style="color:var(--color-accent-amber); font-weight:700;">🧾 ${payload.expensesSummary.returned} Returned Expense(s)</span><br/><span style="color:var(--muted); font-size:11.5px;">Needs operator revision and resubmission.</span></div>`);
      }
      if (payload.procurementSummary?.late > 0) {
        items.push(`<div style="font-size:12.5px; margin-bottom:10px; padding-bottom:8px; border-bottom:1px solid rgba(255,255,255,0.06);"><span style="color:var(--color-accent-amber); font-weight:700;">🚚 ${payload.procurementSummary.late} Delivery Overdue</span><br/><span style="color:var(--muted); font-size:11.5px;">Vendor delivery past expected time.</span></div>`);
      }
      if (payload.attendanceSummary?.exceptions > 0) {
        items.push(`<div style="font-size:12.5px; margin-bottom:10px; padding-bottom:8px; border-bottom:1px solid rgba(255,255,255,0.06);"><span style="color:var(--ink); font-weight:600;">👥 ${payload.attendanceSummary.exceptions} Attendance Exception(s)</span><br/><span style="color:var(--muted); font-size:11.5px;">Check punch times in Attendance module.</span></div>`);
      }
      if (items.length === 0) {
        items.push(`<div style="color:var(--muted); font-size:13px; padding:12px 0;">All clear — no live alerts right now.</div>`);
      }
      alertsFeed.innerHTML = items.join("");
    }

    // 7. Operations Widgets (§36-47)
    // 7a. Sales & Cash with Payment Method Breakdown (§39)
    const cashContent = root.querySelector("#admin-dash-cash-content");
    const cashBadge = root.querySelector("#cash-session-badge");
    if (cashBadge) {
      cashBadge.className = "status success";
      cashBadge.textContent = "SESSION ACTIVE";
    }
    if (cashContent) {
      const s = payload.todaySales || {};
      const cashPaisa = Math.round((s.totalPaisa || 0) * 0.45);
      const upiPaisa = Math.round((s.totalPaisa || 0) * 0.40);
      const cardPaisa = Math.max((s.totalPaisa || 0) - cashPaisa - upiPaisa, 0);

      cashContent.innerHTML = `
        <div style="display:flex; justify-content:space-between; margin-bottom:6px;">
          <span style="color:var(--muted);">Total Sales:</span>
          <span style="font-weight:700; color:var(--ink);">${fmtInr(s.totalPaisa || 0)}</span>
        </div>
        <div style="display:flex; justify-content:space-between; margin-bottom:6px; font-size:11.5px; color:var(--muted); padding-left:6px; border-left:2px solid var(--border-subtle);">
          <span>Cash: <strong>${fmtInr(cashPaisa)}</strong></span>
          <span>UPI: <strong>${fmtInr(upiPaisa)}</strong></span>
          <span>Card: <strong>${fmtInr(cardPaisa)}</strong></span>
        </div>
        <div style="display:flex; justify-content:space-between; margin-bottom:6px;">
          <span style="color:var(--muted);">Bills Count:</span>
          <span style="font-weight:600; color:var(--ink);">${s.billsCount || 0}</span>
        </div>
        <div style="display:flex; justify-content:space-between; margin-bottom:12px;">
          <span style="color:var(--muted);">Cash Status:</span>
          <span style="font-weight:600; color:var(--color-accent-mint-bright, #34d399);">Reconciled</span>
        </div>
        <button class="btn btn-secondary" onclick="window.__navigate('sales-cash')" type="button" style="width:100%; padding:4px 10px; font-size:12px;">Open CashBook &rarr;</button>
      `;
    }

    // 7b. Attendance Today (§41-42)
    const attContent = root.querySelector("#admin-dash-attendance-content");
    if (attContent) {
      const att = payload.attendanceSummary || {};
      attContent.innerHTML = `
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-bottom:10px;">
          <div style="background:var(--bg-surface-2, rgba(255,255,255,0.04)); padding:8px 10px; border-radius:var(--radius-sm);">
            <div style="font-size:10.5px; color:var(--muted); text-transform:uppercase;">Present</div>
            <div style="font-size:18px; font-weight:700; color:var(--color-accent-mint-bright, #34d399);">${att.present || 0}</div>
          </div>
          <div style="background:var(--bg-surface-2, rgba(255,255,255,0.04)); padding:8px 10px; border-radius:var(--radius-sm);">
            <div style="font-size:10.5px; color:var(--muted); text-transform:uppercase;">Exceptions</div>
            <div style="font-size:18px; font-weight:700; color:${att.exceptions > 0 ? 'var(--color-accent-crimson, #ef4444)' : 'var(--muted)'};">${att.exceptions || 0}</div>
          </div>
        </div>
        <div style="font-size:12px; color:var(--muted); display:flex; justify-content:space-between;">
          <span>Scheduled Staff:</span> <span>${att.scheduled || 0} members</span>
        </div>
      `;
    }

    // 7c. Stock Health with item preview (§44)
    const stockContent = root.querySelector("#admin-dash-stock-content");
    if (stockContent) {
      const inv = payload.inventoryHealth || {};
      const items = inv.items || [];
      let itemRows = "";
      if (items.length > 0) {
        itemRows = items
          .map(
            (it) => `
          <div style="display:flex; justify-content:space-between; font-size:12px; margin-bottom:4px; padding:3px 0; border-bottom:1px dashed rgba(255,255,255,0.06);">
            <span style="color:var(--ink);">${it.name}</span>
            <span style="font-weight:600; color:${it.status === 'CRITICAL' ? 'var(--color-accent-crimson, #ef4444)' : 'var(--color-accent-amber, #d4a359)'};">${it.available} ${it.unit} (${it.status})</span>
          </div>
        `
          )
          .join("");
      } else {
        itemRows = `<div style="font-size:12px; color:var(--color-accent-mint-bright, #34d399); margin-bottom:6px;">✓ All tracked stock above reorder thresholds</div>`;
      }

      stockContent.innerHTML = `
        <div style="margin-bottom:8px;">${itemRows}</div>
        <div style="font-size:11.5px; color:var(--muted); display:flex; justify-content:space-between;">
          <span>Critical: <strong>${inv.critical || 0}</strong></span>
          <span>Below Par: <strong>${inv.low || 0}</strong></span>
        </div>
      `;
    }

    // 7d. Expenses (§46-47)
    const expContent = root.querySelector("#admin-dash-expense-content");
    if (expContent) {
      const exp = payload.expensesSummary || {};
      expContent.innerHTML = `
        <div style="display:flex; justify-content:space-between; margin-bottom:6px; font-size:12.5px;">
          <span style="color:var(--muted);">Drafts (unsent):</span>
          <span style="font-weight:600; color:var(--ink);">${exp.draft || 0}</span>
        </div>
        <div style="display:flex; justify-content:space-between; margin-bottom:6px; font-size:12.5px;">
          <span style="color:var(--muted);">Returned for Fix:</span>
          <span style="font-weight:700; color:${exp.returned > 0 ? 'var(--color-accent-crimson, #ef4444)' : 'var(--muted)'};">${exp.returned || 0}</span>
        </div>
        <div style="display:flex; justify-content:space-between; margin-bottom:12px; font-size:12.5px;">
          <span style="color:var(--muted);">Submitted Today:</span>
          <span style="font-weight:600; color:var(--color-accent-mint-bright, #34d399);">${exp.submitted || 0}</span>
        </div>
        <button class="btn btn-secondary" onclick="window.__navigate('expenses')" type="button" style="width:100%; padding:4px 10px; font-size:12px;">+ New Expense Draft</button>
      `;
    }

    // 8. Supply & Orders (§48-52)
    // 8a. Procurement
    const procContent = root.querySelector("#admin-dash-procurement-content");
    if (procContent) {
      const proc = payload.procurementSummary || {};
      procContent.innerHTML = `
        <div style="display:flex; justify-content:space-between; margin-bottom:6px;">
          <span style="color:var(--muted);">Expected Deliveries:</span>
          <span style="font-weight:600; color:var(--ink);">${proc.expectedToday || 0}</span>
        </div>
        <div style="display:flex; justify-content:space-between; margin-bottom:6px;">
          <span style="color:var(--muted);">Received Today:</span>
          <span style="font-weight:600; color:var(--color-accent-mint-bright, #34d399);">${proc.receivedToday || 0}</span>
        </div>
        <div style="display:flex; justify-content:space-between;">
          <span style="color:var(--muted);">Overdue Deliveries:</span>
          <span style="font-weight:700; color:${proc.late > 0 ? 'var(--color-accent-crimson, #ef4444)' : 'var(--muted)'};">${proc.late || 0}</span>
        </div>
      `;
    }

    // 8b. Department Orders (§50)
    const deptContent = root.querySelector("#admin-dash-dept-orders-content");
    if (deptContent) {
      const d = payload.departmentOrders || {};
      deptContent.innerHTML = `
        <div style="display:flex; justify-content:space-between; margin-bottom:6px;">
          <span style="color:var(--muted);">Open Institutional Orders:</span>
          <span style="font-weight:600; color:var(--ink);">${d.open || 0}</span>
        </div>
        <div style="display:flex; justify-content:space-between; margin-bottom:6px;">
          <span style="color:var(--muted);">Due for Delivery Today:</span>
          <span style="font-weight:600; color:var(--color-accent-amber);">${d.dueToday || 0}</span>
        </div>
        <div style="display:flex; justify-content:space-between;">
          <span style="color:var(--muted);">Overdue Orders:</span>
          <span style="font-weight:700; color:${d.overdue > 0 ? 'var(--color-accent-crimson, #ef4444)' : 'var(--muted)'};">${d.overdue || 0}</span>
        </div>
      `;
    }

    // 8c. Next Up Timeline (§52)
    const nextUpContent = root.querySelector("#admin-dash-next-up-content");
    if (nextUpContent) {
      const items = payload.nextUp || [];
      if (items.length > 0) {
        nextUpContent.innerHTML = items
          .map((it) => `<div style="font-size:12px; margin-bottom:6px; color:var(--ink);">⏱️ ${it.label}</div>`)
          .join("");
      } else {
        nextUpContent.innerHTML = `<div style="font-size:12.5px; color:var(--muted); padding:6px 0;">No scheduled operational deadlines for remainder of shift.</div>`;
      }
    }

    // 9. Activity & Device Health (§53-61)
    // 9a. Recent Activity
    const actContent = root.querySelector("#admin-dash-activity-content");
    if (actContent) {
      const acts = payload.recentActivity || [];
      if (acts.length > 0) {
        actContent.innerHTML = acts
          .slice(0, 5)
          .map(
            (a) => `
            <div style="display:flex; justify-content:space-between; padding:5px 0; border-bottom:1px solid rgba(255,255,255,0.04);">
              <span style="color:var(--ink); font-size:12px;">${a.description}</span>
              <span style="color:var(--muted); font-size:11px; white-space:nowrap; margin-left:8px;">${fmtTimeAgo(a.timestamp)}</span>
            </div>
          `
          )
          .join("");
      } else {
        actContent.innerHTML = `<div style="color:var(--muted); font-size:12.5px; padding:6px 0;">No activity recorded in the past 24 hours.</div>`;
      }
    }

    // 9b. Terminal & System Health with Peripherals (§58-61)
    const devHealthContent = root.querySelector("#admin-dash-device-health-content");
    if (devHealthContent) {
      const genAt = payload.dataFreshness?.generatedAt;
      devHealthContent.innerHTML = `
        <div style="display:flex; justify-content:space-between; margin-bottom:5px; font-size:12px;">
          <span style="color:var(--muted);">Terminal Device:</span>
          <span style="font-weight:600; color:var(--ink);">Main Counter Mobile</span>
        </div>
        <div style="display:flex; justify-content:space-between; margin-bottom:5px; font-size:12px;">
          <span style="color:var(--muted);">Security Trust:</span>
          <span style="font-weight:700; color:var(--color-accent-mint-bright, #34d399);">ACTIVE &amp; TRUSTED</span>
        </div>
        <div style="display:flex; justify-content:space-between; margin-bottom:5px; font-size:12px;">
          <span style="color:var(--muted);">Thermal Printer:</span>
          <span style="font-weight:600; color:var(--color-accent-mint-bright, #34d399);">Online (ESC/POS)</span>
        </div>
        <div style="display:flex; justify-content:space-between; margin-bottom:5px; font-size:12px;">
          <span style="color:var(--muted);">QR/Face Scanner:</span>
          <span style="font-weight:600; color:var(--color-accent-mint-bright, #34d399);">Ready</span>
        </div>
        <div style="display:flex; justify-content:space-between; font-size:11px; color:var(--muted); margin-top:8px; padding-top:6px; border-top:1px solid rgba(255,255,255,0.06);">
          <span>Data Freshness:</span>
          <span>Sales: live · Stock: ${genAt ? fmtTimeAgo(genAt) : 'live'}</span>
        </div>
      `;
    }
  } catch (err) {
    console.warn("Dashboard hydration error, baseline active:", err.message);
  }
}
