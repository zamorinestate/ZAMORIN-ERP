// =============================================================================
// ZAMORIN CAFE ERP — SCREEN 003: EQUIPMENT & ASSET MANAGEMENT
// Design System v2 (Ledger & Roastery Dark / Porcelain Light Theme)
//
// Asset Lifecycle + Maintenance + Work Orders + Inspections + Warranty + Reliability
// Primary Master Authority Model
// =============================================================================

import { apiGet, apiPost, apiPatch } from "../apiClient.js";
import { showToast, openModal, confirmAction, renderCafeContextStrip, renderModuleErrorState } from "../components.js";
import { state } from "../state.js";
import { navigate } from "../router.js";

let activeSubTab = "overview"; // 'overview' | 'assets' | 'maintenance' | 'work_orders' | 'inspections' | 'analytics'
let cachedOverview = null;
let cachedAssets = [];
let cachedWorkOrders = [];
let cachedCafes = [];
let cachedPlans = [];
let cachedBacklog = [];

function renderCafeOptions(selectedCafeId) {
  if (!cachedCafes || cachedCafes.length === 0) {
    return `<option value="" disabled ${!selectedCafeId ? 'selected' : ''}>No registered cafés found</option>`;
  }
  return cachedCafes.map((c) => {
    const id = c.cafeId || c.id || c._id;
    const name = c.name || c.cafeName || id;
    return `<option value="${id}" ${selectedCafeId === id ? "selected" : ""}>${name} (${id})</option>`;
  }).join("");
}

const ASSET_CATEGORIES = [
  { id: "BREWING_EQUIPMENT", name: "Brewing Equipment" },
  { id: "GRINDERS_MILLS", name: "Grinders & Mills" },
  { id: "REFRIGERATION", name: "Refrigeration" },
  { id: "BAKERY_OVEN", name: "Bakery & Ovens" },
  { id: "WATER_FILTRATION", name: "Water Filtration" },
  { id: "POS_HARDWARE", name: "POS & IT Hardware" },
  { id: "HVAC", name: "HVAC & Electrical" },
  { id: "FURNITURE_FIXTURES", name: "Furniture & Fixtures" },
];

export function setAssetsActiveTab(tab) {
  const norm = (tab || "overview").toLowerCase().replace(/-/g, "_");
  const aliasMap = {
    "register": "assets",
    "asset": "assets",
    "equipment": "assets",
    "workorders": "work_orders",
    "breakdowns": "work_orders",
  };
  activeSubTab = aliasMap[norm] || norm || "overview";
}

export function renderAssets(subroute) {
  if (subroute !== undefined) {
    setAssetsActiveTab(subroute);
  }
  const isPrimary = state.user?.isPrimaryMaster === true;

  // If on child subroute, render dedicated child shell directly
  if (activeSubTab && activeSubTab !== "overview") {
    return `
      <div class="page-enter" style="max-width:1400px; margin:0 auto; padding-bottom:60px;">
        <div id="assets-subpanel-root">
          ${renderActiveSubpanel()}
        </div>
      </div>
    `;
  }

  return `
    <div class="page-enter" style="padding-bottom: 60px;">
      <!-- Page Header -->
      <div class="page-header" style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom: 24px; flex-wrap:wrap; gap:16px;">
        <div>
          <div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap;">
            <h1 class="page-title" style="font-size:26px; font-weight:700; margin:0; color:var(--ink);">Equipment &amp; Asset Management</h1>
            <span class="badge" style="background:rgba(180,83,9,0.12); color:#b45309; font-weight:600; font-size:12px; padding:4px 10px; border-radius:12px;">SCR-003 ASSETS</span>
            ${
              isPrimary
                ? `<span class="badge" style="background:rgba(201,154,92,0.2); color:#c99a5c; font-weight:800; font-size:11px; padding:4px 8px; border-radius:12px;">PRIMARY MASTER</span>`
                : `<span class="badge" style="background:var(--surface-sunken); color:var(--muted); font-weight:700; font-size:11px; padding:4px 8px; border-radius:12px;">OPERATIONAL MASTER</span>`
            }
          </div>
          <p class="page-subtitle" style="font-size:14px; color:var(--muted); margin:4px 0 0;">
            Multi-Café Equipment Lifecycle, Preventative Maintenance, Work Orders, Calibration &amp; Warranty Registry
          </p>
        </div>
        <div style="display:flex; gap:10px; align-items:center; flex-wrap:wrap;">
          <button class="btn btn-secondary" id="refresh-assets-btn" type="button" style="display:flex; align-items:center; gap:6px; font-weight:600;">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 4v6h-6M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
            Refresh Assets
          </button>
        </div>
      </div>

      <!-- Scope Context Banner -->
      ${renderCafeContextStrip()}

      <!-- Subpanel Content Container -->
      <div id="assets-subpanel-root">
        ${renderActiveSubpanel()}
      </div>
    </div>
  `;
}

function renderActiveSubpanel() {
  if (activeSubTab === "overview") {
    return renderOverviewSubpanel();
  }

  const submodules = {
    assets: {
      title: "Asset & Equipment Register",
      icon: "📋",
      desc: "Multi-café machinery, bar equipment, serial tracking and status.",
      actionsHtml: `<button class="btn btn-sm btn-primary" id="btn-child-reg-asset" type="button">+ Register New Asset</button>`
    },
    maintenance: {
      title: "Preventive Maintenance Schedules",
      icon: "🛠️",
      desc: "Recurring maintenance plans, SOPs and preventive schedules.",
      actionsHtml: `<button class="btn btn-sm btn-primary" id="btn-child-new-maint" type="button">+ New Maintenance Plan</button>`
    },
    work_orders: {
      title: "Work Orders & Breakdown Repairs",
      icon: "🔧",
      desc: "Breakdown tickets, technician dispatch, part replacements and costs.",
      actionsHtml: `<button class="btn btn-sm btn-primary" id="btn-child-new-wo" type="button">+ Create Work Order</button>`
    },
    inspections: {
      title: "Inspections, Calibration & Warranty",
      icon: "📜",
      desc: "Calibration certificates, warranty tracking and AMC contracts.",
      actionsHtml: `<button class="btn btn-sm btn-secondary" id="btn-child-new-insp" type="button">+ Record Inspection</button>`
    },
    analytics: {
      title: "Reliability & Maintenance Analytics",
      icon: "📈",
      desc: "Mean Time Between Failures (MTBF), downtime and cost analytics.",
      actionsHtml: `<button class="btn btn-sm btn-secondary" id="btn-child-export-rel" type="button">Export Reliability Report</button>`
    },
  };

  const cur = submodules[activeSubTab] || { title: "Submodule", icon: "📁", desc: "", actionsHtml: "" };

  let bodyHtml = "";
  switch (activeSubTab) {
    case "assets":
      bodyHtml = renderAssetsSubpanel();
      break;
    case "maintenance":
      bodyHtml = renderMaintenanceSubpanel();
      break;
    case "work_orders":
      bodyHtml = renderWorkOrdersSubpanel();
      break;
    case "inspections":
      bodyHtml = renderInspectionsSubpanel();
      break;
    case "analytics":
      bodyHtml = renderAnalyticsSubpanel();
      break;
    default:
      bodyHtml = renderOverviewSubpanel();
  }

  return `
    <div style="display:flex; flex-direction:column; gap:16px;">
      <div class="card" style="padding:14px 18px;background:var(--surface);border:1px solid var(--line);border-radius:var(--radius-md, 10px);">
        <div style="display:flex; justify-content:space-between; align-items:flex-start; flex-wrap:wrap; gap:12px;">
          <div>
            <div style="display:flex; align-items:center; gap:8px; margin-bottom:4px; font-size:12.5px; color:var(--muted);">
              <button id="assets-back-to-hub-btn" data-back-to-hub="true" data-assets-back-to-hub="true" class="btn-link" style="color:var(--accent); text-decoration:none; display:inline-flex; align-items:center; gap:4px; font-weight:600; cursor:pointer; background:none; border:none; padding:0;">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
                Equipment &amp; Assets
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
      <div>
        ${bodyHtml}
      </div>
    </div>
  `;
}

// 1. OVERVIEW SUBPANEL
function renderOverviewSubpanel() {
  const ov = cachedOverview || {
    kpis: {
      totalAssets: cachedAssets.length,
      inService: cachedAssets.filter((a) => a.operationalStatus === "IN_SERVICE").length,
      underMaintenance: cachedAssets.filter((a) => a.operationalStatus === "UNDER_MAINTENANCE").length,
      outOfService: cachedAssets.filter((a) => a.operationalStatus === "OUT_OF_SERVICE").length,
      dueSoon: 0,
      overdue: 0,
      criticalIssues: 0,
      activeWorkOrders: cachedWorkOrders.filter((w) => w.status !== "COMPLETED" && w.status !== "RESOLVED").length
    },
    needsAttention: []
  };

  const assetTiles = [
    { id: "assets", icon: "📋", title: "Asset & Equipment Register", subtitle: "Multi-café machinery, bar equipment & serial tracking", badge: cachedAssets.length > 0 ? `${cachedAssets.length} Assets` : "", badgeType: "accent" },
    { id: "maintenance", icon: "🛠️", title: "Preventive Maintenance", subtitle: "Recurring schedules, PM checklists & service plans", badge: ov.kpis?.dueSoon > 0 ? `${ov.kpis.dueSoon} Due Soon` : "", badgeType: "accent" },
    { id: "work_orders", icon: "🔧", title: "Work Orders & Repairs", subtitle: "Breakdown tickets, technician dispatch & parts replaced", badge: cachedWorkOrders.length > 0 ? `${cachedWorkOrders.length} Active` : "", badgeType: "" },
    { id: "inspections", icon: "📜", title: "Inspections & Warranty", subtitle: "AMC contracts, warranty coverage & calibration certs", badge: "", badgeType: "success" },
    { id: "analytics", icon: "📈", title: "Reliability & Costs", subtitle: "MTBF, MTTR, maintenance spend & lifecycle analytics", badge: "", badgeType: "success" },
  ];

  return `
    <div style="display:flex; flex-direction:column; gap:24px;">
      <!-- Control Centre Button Hub Section -->
      <div class="module-hub-section">
        <h3 class="module-hub-section-title">Equipment &amp; Asset Workspaces</h3>
        <div class="module-tile-grid">
          ${assetTiles.map((t) => `
            <button class="module-hub-tile" data-assets-hub-tile="${t.id}" type="button">
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

      <!-- Top KPI Cards -->
      <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(150px, 1fr)); gap:14px;">
        ${kpiCard("Total Assets", ov.kpis.totalAssets, "Portfolio Total", "var(--ink)")}
        ${kpiCard("In Service", ov.kpis.inService, "Operating Normal", "var(--color-success, #2E7D32)")}
        ${kpiCard("Under Maintenance", ov.kpis.underMaintenance, "Active Service", "var(--color-warning, #ED6C02)")}
        ${kpiCard("Out of Service", ov.kpis.outOfService, "Safety Hold / Down", "var(--color-danger, #D32F2F)")}
        ${kpiCard("Service Due Soon", ov.kpis.dueSoon, "Next 30 Days", "var(--ink)")}
        ${kpiCard("Maintenance Overdue", ov.kpis.overdue, "Immediate Attention", ov.kpis.overdue > 0 ? "var(--color-danger)" : "var(--muted)")}
        ${kpiCard("Critical Issues", ov.kpis.criticalIssues, "Safety Risks", ov.kpis.criticalIssues > 0 ? "var(--color-danger)" : "var(--muted)")}
        ${kpiCard("Active Work Orders", ov.kpis.activeWorkOrders, "Open Tickets", "var(--color-accent-amber, #C89D5C)")}
      </div>

    <!-- 2-Column Split: Needs Attention & Upcoming Forecast -->
    <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(400px, 1fr)); gap:20px; margin-bottom:24px;">
      <!-- Needs Attention Queue -->
      <div class="card" style="padding:20px;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:14px;">
          <div>
            <h3 style="font-size:15px; font-weight:700; margin:0 0 2px; color:var(--ink);">Needs Maintenance Attention</h3>
            <p style="font-size:12px; color:var(--muted); margin:0;">Prioritised equipment risks and overdue services</p>
          </div>
          <span class="status ${(ov.needsAttention || []).length > 0 ? "warning" : "success"}" style="font-size:11px;">
            ${(ov.needsAttention || []).length} Items
          </span>
        </div>

        ${
          !ov.needsAttention || ov.needsAttention.length === 0
            ? `<div style="text-align:center; padding:32px 16px; color:var(--muted); font-size:13px;">
                ✓ All equipment operating normally. Zero critical alerts.
               </div>`
            : `<div style="display:flex; flex-direction:column; gap:10px;">
                ${ov.needsAttention
                  .map(
                    (item) => `
                  <div style="display:flex; justify-content:space-between; align-items:center; padding:12px 14px; background:var(--bg-subtle, rgba(0,0,0,0.02)); border-radius:8px; border-left:3px solid var(--color-${item.severity === "CRITICAL" ? "danger" : "warning"});">
                    <div>
                      <div style="font-size:13px; font-weight:700; color:var(--ink);">${item.name} <span style="font-family:var(--font-mono); font-size:11px; color:var(--muted);">(${item.assetId})</span></div>
                      <div style="font-size:12px; color:var(--muted);">${item.message} · <strong style="color:var(--ink);">${item.cafeId}</strong></div>
                    </div>
                    <button class="btn btn-ghost open-asset-wo-btn" data-asset="${item.assetId}" type="button" style="font-size:11.5px; padding:4px 10px;">
                      Take Action
                    </button>
                  </div>
                `
                  )
                  .join("")}
               </div>`
        }
      </div>

      <!-- Upcoming Maintenance Timeline -->
      <div class="card" style="padding:20px;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:14px;">
          <div>
            <h3 style="font-size:15px; font-weight:700; margin:0 0 2px; color:var(--ink);">Upcoming Maintenance Forecast</h3>
            <p style="font-size:12px; color:var(--muted); margin:0;">Preventive service schedule (Next 90 Days)</p>
          </div>
        </div>

        <div style="display:flex; flex-direction:column; gap:10px;">
          ${ov.forecast && ov.forecast.length > 0
            ? ov.forecast.map((f) => `
              <div style="display:flex; align-items:center; justify-content:space-between; padding:10px 14px; background:var(--bg-subtle, rgba(0,0,0,0.02)); border-radius:6px;">
                <div style="display:flex; align-items:center; gap:10px;">
                  <span class="status info" style="font-size:11px; font-weight:700;">${f.window || "UPCOMING"}</span>
                  <span style="font-size:13px; font-weight:600; color:var(--ink);">${f.title}</span>
                </div>
                <span style="font-size:12px; color:var(--muted); font-family:var(--font-mono);">${f.cafeId || ""}</span>
              </div>
            `).join("")
            : `<div style="text-align:center; padding:32px 16px; color:var(--muted); font-size:13px;">No upcoming maintenance tasks scheduled for the next 90 days.</div>`
          }
        </div>
      </div>
    </div>
  `;
}

// 2. ASSETS REGISTER SUBPANEL
function renderAssetsSubpanel() {
  const assets = cachedAssets || [];

  return `
    <div class="card" style="padding:24px;">
      <!-- Search & Filters -->
      <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px; margin-bottom:18px;">
        <div style="display:flex; gap:10px; flex:1; min-width:280px; max-width:460px;">
          <input type="text" id="asset-search-input" class="input" placeholder="Search by asset name, ID, serial or model..." style="font-size:13px;">
        </div>
        <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
          <select id="asset-filter-category" class="input" style="font-size:12.5px; width:auto;">
            <option value="">All Categories</option>
            ${ASSET_CATEGORIES.map((c) => `<option value="${c.id}">${c.name}</option>`).join("")}
          </select>
          <select id="asset-filter-status" class="input" style="font-size:12.5px; width:auto;">
            <option value="">All Statuses</option>
            <option value="IN_SERVICE">In Service</option>
            <option value="UNDER_MAINTENANCE">Under Maintenance</option>
            <option value="OUT_OF_SERVICE">Out of Service</option>
            <option value="SETUP">Setup</option>
            <option value="RETIRED">Retired</option>
          </select>
          <select id="asset-filter-condition" class="input" style="font-size:12.5px; width:auto;">
            <option value="">All Conditions</option>
            <option value="EXCELLENT">Excellent</option>
            <option value="GOOD">Good</option>
            <option value="FAIR">Fair</option>
            <option value="POOR">Poor</option>
            <option value="CRITICAL">Critical</option>
          </select>
        </div>
      </div>

      <!-- Asset Register Table -->
      <div class="table-wrap">
        <table class="table" style="width:100%;">
          <thead>
            <tr>
              <th>Asset</th>
              <th>Category</th>
              <th>Location</th>
              <th>Status</th>
              <th>Condition</th>
              <th>Criticality</th>
              <th>Next Maintenance</th>
              <th style="text-align:right;">Actions</th>
            </tr>
          </thead>
          <tbody>
            ${assets.length === 0 ? `
              <tr>
                <td colspan="8" style="text-align:center; padding:32px; color:var(--muted); font-size:13px;">
                  No equipment or assets registered. Click "+ Register New Asset" above to add your first machinery item.
                </td>
              </tr>
            ` : assets
              .map((a) => {
                const condClass = a.condition === "EXCELLENT" || a.condition === "GOOD" ? "success" : a.condition === "FAIR" ? "warning" : "danger";
                const statusClass = a.operationalStatus === "IN_SERVICE" ? "success" : a.operationalStatus === "UNDER_MAINTENANCE" ? "warning" : "danger";
                return `
              <tr>
                <td>
                  <strong style="color:var(--ink); font-size:13.5px;">${a.name}</strong>
                  <div style="font-size:11.5px; color:var(--muted); font-family:var(--font-mono); margin-top:2px;">
                    <span style="color:var(--color-accent-amber); font-weight:700;">${a.assetId}</span> · SN: ${a.serialNumber || "—"}
                  </div>
                </td>
                <td><span class="status info" style="font-size:11px;">${formatCategory(a.category)}</span></td>
                <td>
                  <div style="font-size:13px; font-weight:600; color:var(--ink); font-family:var(--font-mono);">${a.cafeId}</div>
                  <div style="font-size:11px; color:var(--muted);">${a.placementArea || "Main Floor"}</div>
                </td>
                <td><span class="status ${statusClass}" style="font-size:11px; font-weight:700;">${formatStatus(a.operationalStatus)}</span></td>
                <td><span class="status ${condClass}" style="font-size:11px;">${a.condition}</span></td>
                <td>
                  <span style="font-size:11.5px; font-weight:700; color:${a.criticality === "CRITICAL" ? "var(--color-danger)" : a.criticality === "HIGH" ? "var(--color-warning)" : "var(--muted)"};">
                    ${a.criticality || "MEDIUM"}
                  </span>
                </td>
                <td style="font-family:var(--font-mono); font-size:12.5px; color:var(--muted);">
                  ${a.nextMaintenanceDue || "Quarterly"}
                </td>
                <td style="text-align:right;">
                  <div style="display:inline-flex; gap:6px;">
                    <button class="btn btn-ghost view-asset-detail-btn" data-id="${a.assetId}" type="button" style="font-size:12px; padding:4px 10px;">
                      View
                    </button>
                    <button class="btn btn-ghost create-wo-for-asset-btn" data-id="${a.assetId}" type="button" style="font-size:12px; padding:4px 10px;">
                      Work Order
                    </button>
                  </div>
                </td>
              </tr>
            `;
              })
              .join("")}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

// 3. MAINTENANCE SUBPANEL
function renderMaintenanceSubpanel() {
  const plans = cachedPlans || [];
  const backlog = cachedBacklog || [];

  const overdueCount = backlog.filter((b) => b.dueStatus === "OVERDUE").length;
  const dueTodayCount = backlog.filter((b) => b.dueStatus === "DUE_TODAY").length;
  const dueSoonCount = backlog.filter((b) => b.dueStatus === "DUE_SOON").length;
  const activePlansCount = plans.filter((p) => p.isActive !== false).length;

  return `
    <!-- Top Stats Row -->
    <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(200px, 1fr)); gap:14px; margin-bottom:20px;">
      <div class="card" style="padding:16px;">
        <div style="font-size:11.5px; color:var(--muted); text-transform:uppercase; font-weight:700;">Overdue Maintenance</div>
        <div style="font-size:24px; font-weight:800; color:var(--color-danger); margin-top:4px;">${overdueCount}</div>
      </div>
      <div class="card" style="padding:16px;">
        <div style="font-size:11.5px; color:var(--muted); text-transform:uppercase; font-weight:700;">Due Today</div>
        <div style="font-size:24px; font-weight:800; color:#b45309; margin-top:4px;">${dueTodayCount}</div>
      </div>
      <div class="card" style="padding:16px;">
        <div style="font-size:11.5px; color:var(--muted); text-transform:uppercase; font-weight:700;">Due Soon (7 Days)</div>
        <div style="font-size:24px; font-weight:800; color:var(--color-accent-amber); margin-top:4px;">${dueSoonCount}</div>
      </div>
      <div class="card" style="padding:16px;">
        <div style="font-size:11.5px; color:var(--muted); text-transform:uppercase; font-weight:700;">Active PM Plans</div>
        <div style="font-size:24px; font-weight:800; color:var(--ink); margin-top:4px;">${activePlansCount}</div>
      </div>
    </div>

    <!-- Maintenance Backlog & Due Queue -->
    <div class="card" style="padding:24px; margin-bottom:24px;">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:18px; flex-wrap:wrap; gap:10px;">
        <div>
          <h3 style="font-size:16px; font-weight:700; margin:0 0 2px; color:var(--ink);">Maintenance Backlog &amp; Due Queue (${backlog.length})</h3>
          <p style="font-size:12.5px; color:var(--muted); margin:0;">Preventive services requiring execution, scheduled inspections, and overdue alerts</p>
        </div>
        <div style="display:flex; gap:8px;">
          <button class="btn btn-secondary btn-sm" id="evaluate-alerts-btn" type="button">Evaluate Alerts</button>
        </div>
      </div>

      <div class="table-wrap">
        <table class="table" style="width:100%;">
          <thead>
            <tr>
              <th>Asset &amp; Location</th>
              <th>Task / Plan</th>
              <th>Scheduled Date</th>
              <th>Due Status</th>
              <th style="text-align:right;">Actions</th>
            </tr>
          </thead>
          <tbody>
            ${
              backlog.length === 0
                ? `<tr><td colspan="5" style="text-align:center; padding:32px; color:var(--muted); font-size:13px;">No maintenance tasks currently queued. All equipment is on schedule.</td></tr>`
                : backlog
                    .map((item) => {
                      const badgeClass =
                        item.dueStatus === "OVERDUE"
                          ? "status danger"
                          : item.dueStatus === "DUE_TODAY"
                          ? "status warning"
                          : item.dueStatus === "DUE_SOON"
                          ? "status warning"
                          : "status info";

                      return `
                        <tr>
                          <td>
                            <strong style="color:var(--ink); font-size:13px;">${item.assetName || item.assetId}</strong>
                            <div style="font-size:11.5px; color:var(--color-accent-amber); font-family:var(--font-mono); font-weight:700;">${item.assetId}</div>
                            <div style="font-size:11px; color:var(--muted); font-family:var(--font-mono);">${item.cafeId || "—"}</div>
                          </td>
                          <td>
                            <div style="font-size:13px; font-weight:600; color:var(--ink);">${item.planName || "Periodic Service"}</div>
                            <div style="font-size:11px; color:var(--muted);">${item.frequencyType || "QUARTERLY"}</div>
                          </td>
                          <td style="font-family:var(--font-mono); font-size:12.5px;">${item.dueDate || "—"}</td>
                          <td>
                            <span class="${badgeClass}" style="font-size:11px; font-weight:700;">${item.dueStatus}</span>
                          </td>
                          <td style="text-align:right;">
                            <div style="display:flex; justify-content:flex-end; gap:6px;">
                              <button class="btn btn-sm btn-primary complete-maint-btn" data-asset-id="${item.assetId}" data-plan-id="${item.scheduleId || ""}" type="button">Complete</button>
                              <button class="btn btn-sm btn-secondary reschedule-maint-btn" data-asset-id="${item.assetId}" data-plan-id="${item.scheduleId || ""}" data-due="${item.dueDate || ""}" type="button">Reschedule</button>
                            </div>
                          </td>
                        </tr>
                      `;
                    })
                    .join("")
            }
          </tbody>
        </table>
      </div>
    </div>

    <!-- Active Preventive Maintenance Plans -->
    <div class="card" style="padding:24px;">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:18px; flex-wrap:wrap; gap:10px;">
        <div>
          <h3 style="font-size:16px; font-weight:700; margin:0 0 2px; color:var(--ink);">Preventive Maintenance Plans (${plans.length})</h3>
          <p style="font-size:12.5px; color:var(--muted); margin:0;">Standard Operating Procedures, service intervals, and recurring schedules</p>
        </div>
        <button class="btn btn-primary btn-sm" id="create-pm-plan-btn" type="button">+ New Plan</button>
      </div>

      <div class="table-wrap">
        <table class="table" style="width:100%;">
          <thead>
            <tr>
              <th>Plan ID &amp; Name</th>
              <th>Target Asset / Category</th>
              <th>Frequency</th>
              <th>Next Due Date</th>
              <th>Status</th>
              <th style="text-align:right;">Actions</th>
            </tr>
          </thead>
          <tbody>
            ${
              plans.length === 0
                ? `<tr><td colspan="6" style="text-align:center; padding:32px; color:var(--muted); font-size:13px;">No preventive maintenance plans configured. Click "+ New Plan" to configure recurring SOP schedules.</td></tr>`
                : plans
                    .map((plan) => `
                      <tr>
                        <td>
                          <strong style="color:var(--ink); font-size:13px;">${plan.name}</strong>
                          <div style="font-size:11.5px; color:var(--color-accent-amber); font-family:var(--font-mono); font-weight:700;">${plan.planId}</div>
                        </td>
                        <td>
                          <div style="font-size:13px; font-weight:600; color:var(--ink);">${plan.assetId || plan.category || "All Assets"}</div>
                          <div style="font-size:11px; color:var(--muted); font-family:var(--font-mono);">${plan.cafeId || "All Cafés"}</div>
                        </td>
                        <td>
                          <span class="status info" style="font-size:11px;">${plan.frequencyType}</span>
                          <span style="font-size:11px; color:var(--muted);">(${plan.intervalDays}d)</span>
                        </td>
                        <td style="font-family:var(--font-mono); font-size:12.5px;">${plan.nextDueDate || "—"}</td>
                        <td>
                          <span class="status ${plan.isActive !== false ? "success" : "info"}" style="font-size:11px;">
                            ${plan.isActive !== false ? "ACTIVE" : "INACTIVE"}
                          </span>
                        </td>
                        <td style="text-align:right;">
                          ${
                            plan.isActive !== false
                              ? `<button class="btn btn-sm btn-ghost cancel-pm-plan-btn" data-plan-id="${plan.planId}" type="button" style="color:var(--color-danger);">Deactivate</button>`
                              : `<span style="font-size:11px; color:var(--muted);">Deactivated</span>`
                          }
                        </td>
                      </tr>
                    `)
                    .join("")
            }
          </tbody>
        </table>
      </div>
    </div>
  `;
}

// 4. WORK ORDERS SUBPANEL
function renderWorkOrdersSubpanel() {
  const workOrders = cachedWorkOrders || [];

  return `
    <div class="card" style="padding:24px;">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:18px;">
        <div>
          <h3 style="font-size:16px; font-weight:700; margin:0 0 2px; color:var(--ink);">Maintenance Work Orders (${workOrders.length})</h3>
          <p style="font-size:12.5px; color:var(--muted); margin:0;">Corrective repairs, inspections, and preventative overhaul tickets</p>
        </div>
        <button class="btn btn-primary" id="open-create-wo-btn" type="button" style="font-size:12.5px; padding:6px 14px;">
          + Create Work Order
        </button>
      </div>

      <div class="table-wrap">
        <table class="table" style="width:100%;">
          <thead>
            <tr>
              <th>Work Order</th>
              <th>Asset &amp; Location</th>
              <th>Type</th>
              <th>Priority</th>
              <th>Status</th>
              <th>Blocker</th>
              <th style="text-align:right;">Actions</th>
            </tr>
          </thead>
          <tbody>
            ${workOrders.length === 0 ? `
              <tr>
                <td colspan="7" style="text-align:center; padding:32px; color:var(--muted); font-size:13px;">
                  No maintenance work orders or repair tickets recorded.
                </td>
              </tr>
            ` : workOrders
              .map((wo) => `
              <tr>
                <td>
                  <strong style="color:var(--ink);">${wo.title}</strong>
                  <div style="font-size:11.5px; color:var(--color-accent-amber); font-family:var(--font-mono); font-weight:700;">${wo.workOrderId}</div>
                </td>
                <td>
                  <div style="font-size:13px; font-weight:600; color:var(--ink);">${wo.assetId}</div>
                  <div style="font-size:11px; color:var(--muted); font-family:var(--font-mono);">${wo.cafeId}</div>
                </td>
                <td><span class="status info" style="font-size:11px;">${wo.workType}</span></td>
                <td>
                  <span class="status ${wo.priority === "CRITICAL" ? "danger" : wo.priority === "URGENT" ? "warning" : "info"}" style="font-size:11px; font-weight:700;">
                    ${wo.priority}
                  </span>
                </td>
                <td><span class="status ${wo.status === "COMPLETED" ? "success" : "warning"}" style="font-size:11px;">${wo.status}</span></td>
                <td>
                  ${
                    wo.blocker && wo.blocker !== "NONE"
                      ? `<span class="status warning" style="font-size:10px;">${wo.blocker}</span>`
                      : `<span style="color:var(--muted); font-size:12px;">—</span>`
                  }
                </td>
                <td style="text-align:right;">
                  <button class="btn btn-ghost update-wo-btn" data-id="${wo.workOrderId}" type="button" style="font-size:12px; padding:4px 10px;">
                    Update / Resolve
                  </button>
                </td>
              </tr>
            `)
              .join("")}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

// 5. INSPECTIONS & WARRANTY SUBPANEL
function renderInspectionsSubpanel() {
  return `
    <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(400px, 1fr)); gap:20px;">
      <!-- Daily Inspections Checklist -->
      <div class="card" style="padding:20px;">
        <h3 style="font-size:15px; font-weight:700; margin:0 0 4px; color:var(--ink);">Daily Equipment Condition Checklists</h3>
        <p style="font-size:12px; color:var(--muted); margin:0 0 14px;">Frontline opening and closing verification checks</p>

        <div style="padding:32px 16px; text-align:center; color:var(--muted); font-size:13px;">
          No equipment checklists submitted for today.
        </div>
      </div>

      <!-- Warranty & AMC Contracts -->
      <div class="card" style="padding:20px;">
        <h3 style="font-size:15px; font-weight:700; margin:0 0 4px; color:var(--ink);">Warranty &amp; Service Contracts (AMC)</h3>
        <p style="font-size:12px; color:var(--muted); margin:0 0 14px;">Active manufacturer warranties and service SLAs</p>

        <div style="padding:32px 16px; text-align:center; color:var(--muted); font-size:13px;">
          No active AMC contracts or manufacturer warranties registered.
        </div>
      </div>
    </div>
  `;
}

// 6. ANALYTICS SUBPANEL
function renderAnalyticsSubpanel() {
  return `
    <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(320px, 1fr)); gap:20px;">
      <div class="card" style="padding:20px;">
        <h3 style="font-size:15px; font-weight:700; margin:0 0 4px; color:var(--ink);">Preventative Maintenance Compliance</h3>
        <p style="font-size:12px; color:var(--muted); margin:0 0 16px;">Completed on-schedule vs due (Last 90 Days)</p>
        <div style="font-size:32px; font-weight:800; color:var(--muted); font-family:var(--font-mono);">— %</div>
        <div style="font-size:12px; color:var(--muted); margin-top:6px;">Formula: (Completed On-Time ÷ Items Due)</div>
      </div>

      <div class="card" style="padding:20px;">
        <h3 style="font-size:15px; font-weight:700; margin:0 0 4px; color:var(--ink);">Planned vs Unplanned Maintenance</h3>
        <p style="font-size:12px; color:var(--muted); margin:0 0 16px;">Ratio of proactive PM to breakdown repairs</p>
        <div style="font-size:32px; font-weight:800; color:var(--ink); font-family:var(--font-mono);">0 : 0</div>
        <div style="font-size:12px; color:var(--muted); margin-top:6px;">Target: &gt; 80% Planned proactive maintenance</div>
      </div>

      <div class="card" style="padding:20px;">
        <h3 style="font-size:15px; font-weight:700; margin:0 0 4px; color:var(--ink);">Recorded Maintenance Spend</h3>
        <p style="font-size:12px; color:var(--muted); margin:0 0 16px;">Parts &amp; external OEM service fees (YTD)</p>
        <div style="font-size:32px; font-weight:800; color:var(--ink); font-family:var(--font-mono);">₹ 0</div>
        <div style="font-size:12px; color:var(--muted); margin-top:6px;">Authoritative financial accounting remains in Finance &amp; Bills</div>
      </div>
    </div>
  `;
}

// Helper: KPI Card
function kpiCard(title, value, subtitle, valColor) {
  return `
    <div class="card" style="padding:14px 16px;">
      <div style="font-size:11.5px; font-weight:700; color:var(--muted); text-transform:uppercase; letter-spacing:0.4px; margin-bottom:4px;">${title}</div>
      <div style="font-size:24px; font-weight:800; color:${valColor}; font-family:var(--font-mono); line-height:1.1;">${value}</div>
      <div style="font-size:11px; color:var(--muted); margin-top:4px;">${subtitle}</div>
    </div>
  `;
}

function formatCategory(cat) {
  return cat ? cat.replace(/_/g, " ") : "Equipment";
}

function formatStatus(status) {
  return status ? status.replace(/_/g, " ") : "In Service";
}

export function wireAssets(root, subroute) {
  if (subroute !== undefined) {
    setAssetsActiveTab(subroute);
  }

  // Navigation button hub tiles
  root.querySelectorAll("[data-assets-hub-tile]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const tileId = e.currentTarget.dataset.assetsHubTile;
      navigate("assets/" + tileId);
    });
  });

  // Back to Hub button
  root.querySelector("#assets-back-to-hub-btn")?.addEventListener("click", () => {
    navigate("assets");
  });

  // Refresh
  const refreshBtn = root.querySelector("#refresh-assets-btn");
  if (refreshBtn) {
    refreshBtn.addEventListener("click", async () => {
      await loadLiveAssetData();
      rerender(root);
      showToast("Equipment & Asset register refreshed.", "info");
    });
  }

  // Child action buttons
  root.querySelectorAll("#btn-child-reg-asset").forEach((btn) => {
    btn.addEventListener("click", () => openRegisterAssetWizard(root));
  });
  root.querySelectorAll("#btn-child-new-wo, #open-create-wo-btn").forEach((btn) => {
    btn.addEventListener("click", () => openCreateWorkOrderModal(root));
  });
  root.querySelectorAll("#btn-child-new-maint, #create-pm-plan-btn").forEach((btn) => {
    btn.addEventListener("click", () => openNewMaintenancePlanModal(root));
  });
  root.querySelectorAll("#btn-child-new-insp").forEach((btn) => {
    btn.addEventListener("click", () => openRecordInspectionModal(root));
  });
  root.querySelectorAll("#btn-child-export-rel").forEach((btn) => {
    btn.addEventListener("click", () => exportAssetReliabilityCsv());
  });

  root.querySelectorAll(".update-wo-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const woId = e.currentTarget.dataset.id;
      openUpdateWorkOrderModal(root, woId);
    });
  });

  // View Detail Buttons
  root.querySelectorAll(".view-asset-detail-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const assetId = e.currentTarget.dataset.id;
      openAssetDetailModal(root, assetId);
    });
  });

  // Create WO for specific asset
  root.querySelectorAll(".create-wo-for-asset-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const assetId = e.currentTarget.dataset.id;
      openCreateWorkOrderModal(root, assetId);
    });
  });

  // Initial fetch — exactly once
  if (!hasInitialFetchedAssets) {
    hasInitialFetchedAssets = true;
    loadLiveAssetData().then(() => {
      if (state.route?.startsWith("assets")) {
        rerender(root);
      }
    });
  }
}

let hasInitialFetchedAssets = false;

async function loadLiveAssetData() {
  try {
    const [ovRes, assetRes, woRes, cafesRes, plansRes, backlogRes] = await Promise.all([
      apiGet("/assets/overview").catch(() => null),
      apiGet("/assets").catch(() => null),
      apiGet("/assets/work-orders").catch(() => null),
      apiGet("/cafes").catch(() => null),
      apiGet("/assets/plans").catch(() => null),
      apiGet("/assets/maintenance/backlog").catch(() => null),
    ]);

    if (ovRes?.data) cachedOverview = ovRes.data;
    if (assetRes?.data?.assets) {
      cachedAssets = assetRes.data.assets;
    }
    if (woRes?.data?.workOrders) {
      cachedWorkOrders = woRes.data.workOrders;
    }
    if (cafesRes?.data?.cafes) {
      cachedCafes = cafesRes.data.cafes;
    }
    if (plansRes?.data?.plans) {
      cachedPlans = plansRes.data.plans;
    }
    if (backlogRes?.data?.backlog) {
      cachedBacklog = backlogRes.data.backlog;
    }
  } catch (err) {
    console.warn("Asset data load notice:", err);
  }
}

function rerender(root) {
  if (!state.route?.startsWith("assets")) return;
  const subpanelRoot = root?.querySelector ? root.querySelector("#assets-subpanel-root") : null;
  if (subpanelRoot) {
    subpanelRoot.innerHTML = renderActiveSubpanel();
    root.querySelectorAll("[data-assets-hub-tile]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        const tileId = e.currentTarget.dataset.assetsHubTile;
        navigate("assets/" + tileId);
      });
    });
    root.querySelector("#assets-back-to-hub-btn")?.addEventListener("click", () => {
      navigate("assets");
    });
    root.querySelectorAll("#btn-child-reg-asset").forEach((btn) => {
      btn.addEventListener("click", () => openRegisterAssetWizard(root));
    });
    root.querySelectorAll("#btn-child-new-wo, #open-create-wo-btn").forEach((btn) => {
      btn.addEventListener("click", () => openCreateWorkOrderModal(root));
    });
    root.querySelectorAll("#btn-child-new-maint, #create-pm-plan-btn").forEach((btn) => {
      btn.addEventListener("click", () => openNewMaintenancePlanModal(root));
    });
    root.querySelectorAll("#btn-child-new-insp").forEach((btn) => {
      btn.addEventListener("click", () => openRecordInspectionModal(root));
    });
    root.querySelectorAll("#btn-child-export-rel").forEach((btn) => {
      btn.addEventListener("click", () => exportAssetReliabilityCsv());
    });
    root.querySelectorAll(".update-wo-btn").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        const woId = e.currentTarget.dataset.id;
        openUpdateWorkOrderModal(root, woId);
      });
    });
    root.querySelectorAll(".view-asset-detail-btn").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        const assetId = e.currentTarget.dataset.id;
        openAssetDetailModal(root, assetId);
      });
    });
    root.querySelectorAll(".create-wo-for-asset-btn").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        const assetId = e.currentTarget.dataset.id;
        openCreateWorkOrderModal(root, assetId);
      });
    });
    root.querySelectorAll(".complete-maint-btn").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        const assetId = e.currentTarget.dataset.assetId;
        const planId = e.currentTarget.dataset.planId;
        openCompleteMaintenanceModal(root, assetId, planId);
      });
    });
    root.querySelectorAll(".reschedule-maint-btn").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        const assetId = e.currentTarget.dataset.assetId;
        const planId = e.currentTarget.dataset.planId;
        const due = e.currentTarget.dataset.due;
        openRescheduleMaintenanceModal(root, assetId, planId, due);
      });
    });
    root.querySelectorAll(".cancel-pm-plan-btn").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        const planId = e.currentTarget.dataset.planId;
        confirmAction(`Are you sure you want to deactivate maintenance plan ${planId}?`, async () => {
          try {
            await apiPost(`/assets/plans/${planId}/cancel`, { reason: "Deactivated by Master/Admin" });
            showToast(`Plan ${planId} deactivated.`, "success");
            await loadLiveAssetData();
            rerender(root);
          } catch (err) {
            showToast(err?.message || "Failed to deactivate plan", "coral");
          }
        });
      });
    });
    root.querySelector("#evaluate-alerts-btn")?.addEventListener("click", async () => {
      try {
        showToast("Evaluating asset maintenance alerts...", "info");
        const res = await apiPost("/assets/maintenance/evaluate-alerts", {});
        showToast(`Evaluated ${res?.data?.evaluatedCount || 0} assets, ${res?.data?.alertsRaised || 0} alerts updated.`, "success");
        await loadLiveAssetData();
        rerender(root);
      } catch (err) {
        showToast(err?.message || "Alert evaluation failed", "coral");
      }
    });
  } else {
    root.innerHTML = renderAssets();
    wireAssetsEventListeners(root);
  }
}

function exportAssetReliabilityCsv() {
  const headers = ["Asset ID", "Asset Name", "Category", "Café ID", "Operational Status", "Condition", "Criticality"];
  const rows = (cachedAssets || []).map((a) => [
    a.assetId || "",
    `"${(a.name || "").replace(/"/g, '""')}"`,
    a.category || "",
    a.cafeId || "",
    a.operationalStatus || "",
    a.condition || "",
    a.criticality || ""
  ]);
  let csvContent = "data:text/csv;charset=utf-8," + [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
  const encodedUri = encodeURI(csvContent);
  const link = document.createElement("a");
  link.setAttribute("href", encodedUri);
  link.setAttribute("download", `asset_reliability_report_${new Date().toISOString().split("T")[0]}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  showToast("Asset reliability report exported to CSV.", "info");
}

function wireAssetsEventListeners(root) {
  root.querySelectorAll("[data-assets-hub-tile]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const tileId = e.currentTarget.dataset.assetsHubTile;
      navigate("assets/" + tileId);
    });
  });
  root.querySelector("#assets-back-to-hub-btn")?.addEventListener("click", () => navigate("assets"));
  root.querySelectorAll("#btn-child-reg-asset").forEach((btn) => {
    btn.addEventListener("click", () => openRegisterAssetWizard(root));
  });
  root.querySelectorAll("#btn-child-new-wo, #open-create-wo-btn").forEach((btn) => {
    btn.addEventListener("click", () => openCreateWorkOrderModal(root));
  });
  root.querySelectorAll("#btn-child-new-maint, #create-pm-plan-btn").forEach((btn) => {
    btn.addEventListener("click", () => openNewMaintenancePlanModal(root));
  });
  root.querySelectorAll("#btn-child-new-insp").forEach((btn) => {
    btn.addEventListener("click", () => openRecordInspectionModal(root));
  });
  root.querySelectorAll("#btn-child-export-rel").forEach((btn) => {
    btn.addEventListener("click", () => exportAssetReliabilityCsv());
  });
  root.querySelectorAll(".update-wo-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const woId = e.currentTarget.dataset.id;
      openUpdateWorkOrderModal(root, woId);
    });
  });
  root.querySelectorAll(".view-asset-detail-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const assetId = e.currentTarget.dataset.id;
      openAssetDetailModal(root, assetId);
    });
  });
  root.querySelectorAll(".create-wo-for-asset-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const assetId = e.currentTarget.dataset.id;
      openCreateWorkOrderModal(root, assetId);
    });
  });
  root.querySelectorAll(".complete-maint-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const assetId = e.currentTarget.dataset.assetId;
      const planId = e.currentTarget.dataset.planId;
      openCompleteMaintenanceModal(root, assetId, planId);
    });
  });
  root.querySelectorAll(".reschedule-maint-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const assetId = e.currentTarget.dataset.assetId;
      const planId = e.currentTarget.dataset.planId;
      const due = e.currentTarget.dataset.due;
      openRescheduleMaintenanceModal(root, assetId, planId, due);
    });
  });
  root.querySelectorAll(".cancel-pm-plan-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const planId = e.currentTarget.dataset.planId;
      confirmAction(`Are you sure you want to deactivate maintenance plan ${planId}?`, async () => {
        try {
          await apiPost(`/assets/plans/${planId}/cancel`, { reason: "Deactivated by Master/Admin" });
          showToast(`Plan ${planId} deactivated.`, "success");
          await loadLiveAssetData();
          rerender(root);
        } catch (err) {
          showToast(err?.message || "Failed to deactivate plan", "coral");
        }
      });
    });
  });
  root.querySelector("#evaluate-alerts-btn")?.addEventListener("click", async () => {
    try {
      showToast("Evaluating asset maintenance alerts...", "info");
      const res = await apiPost("/assets/maintenance/evaluate-alerts", {});
      showToast(`Evaluated ${res?.data?.evaluatedCount || 0} assets, ${res?.data?.alertsRaised || 0} alerts updated.`, "success");
      await loadLiveAssetData();
      rerender(root);
    } catch (err) {
      showToast(err?.message || "Alert evaluation failed", "coral");
    }
  });
}

// Centred Register Asset Wizard (5-step)
function openRegisterAssetWizard(root) {
  let step = 1;
  const formData = {
    name: "",
    category: "BREWING_EQUIPMENT",
    manufacturer: "",
    model: "",
    serialNumber: "",
    cafeId: state.selectedCafeId || cachedCafes[0]?.cafeId || cachedCafes[0]?.id || "",
    placementArea: "Main Counter",
    acquisitionType: "PURCHASED",
    condition: "GOOD",
    criticality: "MEDIUM",
    operationalStatus: "IN_SERVICE",
    maintenanceStrategy: "PREVENTIVE_TIME_BASED",
  };

  function renderWizardStep() {
    return `
      <div style="max-width:760px; margin:0 auto; padding:10px 0;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:18px; border-bottom:1px solid var(--border-subtle); padding-bottom:12px;">
          <div>
            <h2 style="font-size:18px; font-weight:800; margin:0; color:var(--ink);">Register New Asset</h2>
            <p style="font-size:12.5px; color:var(--muted); margin:0;">Step ${step} of 5 — Multi-Café Asset Lifecycle Registration</p>
          </div>
          <span class="status info" style="font-size:11px; font-weight:700;">STEP ${step}/5</span>
        </div>

        ${
          step === 1
            ? `
          <div style="display:flex; flex-direction:column; gap:14px;">
            <h4 style="font-size:14px; font-weight:700; color:var(--ink); margin:0;">1. Equipment Identity</h4>
            <div class="form-group">
              <label class="label">Asset Name*</label>
              <input type="text" id="wiz-asset-name" class="input" value="${formData.name}" placeholder="e.g. La Marzocco Linea PB 2-Group Espresso Machine" required>
            </div>
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px;">
              <div class="form-group">
                <label class="label">Category*</label>
                <select id="wiz-asset-category" class="input">
                  ${ASSET_CATEGORIES.map((c) => `<option value="${c.id}" ${formData.category === c.id ? "selected" : ""}>${c.name}</option>`).join("")}
                </select>
              </div>
              <div class="form-group">
                <label class="label">Serial Number</label>
                <input type="text" id="wiz-asset-serial" class="input" value="${formData.serialNumber}" placeholder="e.g. LM-PB-99412">
              </div>
            </div>
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px;">
              <div class="form-group">
                <label class="label">Manufacturer</label>
                <input type="text" id="wiz-asset-mfr" class="input" value="${formData.manufacturer}" placeholder="e.g. La Marzocco">
              </div>
              <div class="form-group">
                <label class="label">Model</label>
                <input type="text" id="wiz-asset-model" class="input" value="${formData.model}" placeholder="e.g. Linea PB AV">
              </div>
            </div>
          </div>
        `
            : step === 2
            ? `
          <div style="display:flex; flex-direction:column; gap:14px;">
            <h4 style="font-size:14px; font-weight:700; color:var(--ink); margin:0;">2. Deployment Location</h4>
            <div class="form-group">
              <label class="label">Assigned Café*</label>
              <select id="wiz-asset-cafe" class="input">
                ${renderCafeOptions(formData.cafeId)}
              </select>
            </div>
            <div class="form-group">
              <label class="label">Placement Area</label>
              <input type="text" id="wiz-asset-area" class="input" value="${formData.placementArea}" placeholder="e.g. Main Bar / Filter Station / Kitchen">
            </div>
          </div>
        `
            : step === 3
            ? `
          <div style="display:flex; flex-direction:column; gap:14px;">
            <h4 style="font-size:14px; font-weight:700; color:var(--ink); margin:0;">3. Operational State &amp; Criticality</h4>
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px;">
              <div class="form-group">
                <label class="label">Initial Condition</label>
                <select id="wiz-asset-condition" class="input">
                  <option value="EXCELLENT" ${formData.condition === "EXCELLENT" ? "selected" : ""}>Excellent (Brand New / Factory Calibrated)</option>
                  <option value="GOOD" ${formData.condition === "GOOD" ? "selected" : ""}>Good (Normal Operating State)</option>
                  <option value="FAIR" ${formData.condition === "FAIR" ? "selected" : ""}>Fair (Operational with Minor Wear)</option>
                  <option value="POOR" ${formData.condition === "POOR" ? "selected" : ""}>Poor (Needs Immediate Service)</option>
                </select>
              </div>
              <div class="form-group">
                <label class="label">Criticality Rating</label>
                <select id="wiz-asset-criticality" class="input">
                  <option value="CRITICAL" ${formData.criticality === "CRITICAL" ? "selected" : ""}>Critical (Café Cannot Operate Without It)</option>
                  <option value="HIGH" ${formData.criticality === "HIGH" ? "selected" : ""}>High (Major Service Disruption)</option>
                  <option value="MEDIUM" ${formData.criticality === "MEDIUM" ? "selected" : ""}>Medium (Moderate Operational Impact)</option>
                  <option value="LOW" ${formData.criticality === "LOW" ? "selected" : ""}>Low (Minimal Impact)</option>
                </select>
              </div>
            </div>
            <div class="form-group">
              <label class="label">Initial Operational Status</label>
              <select id="wiz-asset-opstatus" class="input">
                <option value="IN_SERVICE" ${formData.operationalStatus === "IN_SERVICE" ? "selected" : ""}>In Service (Ready for Operations)</option>
                <option value="SETUP" ${formData.operationalStatus === "SETUP" ? "selected" : ""}>Setup / Awaiting Commissioning</option>
              </select>
            </div>
          </div>
        `
            : step === 4
            ? `
          <div style="display:flex; flex-direction:column; gap:14px;">
            <h4 style="font-size:14px; font-weight:700; color:var(--ink); margin:0;">4. Maintenance Strategy &amp; Warranty</h4>
            <div class="form-group">
              <label class="label">Maintenance Strategy</label>
              <select id="wiz-asset-strategy" class="input">
                <option value="PREVENTIVE_TIME_BASED">Preventative — Time Based (Quarterly / Monthly)</option>
                <option value="INSPECTION_BASED">Inspection Based (Daily / Weekly Verification)</option>
                <option value="REACTIVE_ONLY">Reactive Only (Run to Maintenance)</option>
              </select>
            </div>
            <div class="form-group">
              <label class="label">Warranty Provider / Contact</label>
              <input type="text" id="wiz-asset-warranty" class="input" placeholder="e.g. La Marzocco India OEM Support">
            </div>
          </div>
        `
            : `
          <div style="display:flex; flex-direction:column; gap:14px;">
            <h4 style="font-size:14px; font-weight:700; color:var(--ink); margin:0;">5. Review &amp; Register</h4>
            <div style="background:var(--bg-subtle, rgba(0,0,0,0.02)); padding:16px; border-radius:8px; display:grid; grid-template-columns:1fr 1fr; gap:10px; font-size:13px;">
              <div><strong>Name:</strong> ${formData.name || "—"}</div>
              <div><strong>Category:</strong> ${formatCategory(formData.category)}</div>
              <div><strong>Café:</strong> ${formData.cafeId}</div>
              <div><strong>Placement:</strong> ${formData.placementArea}</div>
              <div><strong>Criticality:</strong> ${formData.criticality}</div>
              <div><strong>Condition:</strong> ${formData.condition}</div>
            </div>
          </div>
        `
        }

        <div style="display:flex; justify-content:space-between; margin-top:24px; border-top:1px solid var(--border-subtle); padding-top:14px;">
          <button class="btn btn-ghost" id="wiz-back-btn" type="button" ${step === 1 ? "disabled" : ""}>Back</button>
          <div style="display:flex; gap:10px;">
            ${
              step < 5
                ? `<button class="btn btn-primary" id="wiz-next-btn" type="button">Continue</button>`
                : `<button class="btn btn-primary" id="wiz-submit-btn" type="button">Register Asset</button>`
            }
          </div>
        </div>
      </div>
    `;
  }

  const modal = openModal(renderWizardStep());

  function wireWizardEvents() {
    const nextBtn = modal.querySelector("#wiz-next-btn");
    if (nextBtn) {
      nextBtn.addEventListener("click", () => {
        if (step === 1) {
          formData.name = modal.querySelector("#wiz-asset-name")?.value || "";
          formData.category = modal.querySelector("#wiz-asset-category")?.value || "BREWING_EQUIPMENT";
          formData.serialNumber = modal.querySelector("#wiz-asset-serial")?.value || "";
          formData.manufacturer = modal.querySelector("#wiz-asset-mfr")?.value || "";
          formData.model = modal.querySelector("#wiz-asset-model")?.value || "";
          if (!formData.name.trim()) {
            showToast("Asset Name is required.", "error");
            return;
          }
        } else if (step === 2) {
          formData.cafeId = modal.querySelector("#wiz-asset-cafe")?.value || state.selectedCafeId || "";
          formData.placementArea = modal.querySelector("#wiz-asset-area")?.value || "Main Counter";
        } else if (step === 3) {
          formData.condition = modal.querySelector("#wiz-asset-condition")?.value || "GOOD";
          formData.criticality = modal.querySelector("#wiz-asset-criticality")?.value || "MEDIUM";
          formData.operationalStatus = modal.querySelector("#wiz-asset-opstatus")?.value || "IN_SERVICE";
        } else if (step === 4) {
          formData.maintenanceStrategy = modal.querySelector("#wiz-asset-strategy")?.value || "PREVENTIVE_TIME_BASED";
        }
        step++;
        modal.innerHTML = renderWizardStep();
        wireWizardEvents();
      });
    }

    const backBtn = modal.querySelector("#wiz-back-btn");
    if (backBtn) {
      backBtn.addEventListener("click", () => {
        step--;
        modal.innerHTML = renderWizardStep();
        wireWizardEvents();
      });
    }

    const submitBtn = modal.querySelector("#wiz-submit-btn");
    if (submitBtn) {
      submitBtn.addEventListener("click", async () => {
        const newAssetId = `AST-00${cachedAssets.length + 1}`;
        const newAsset = {
          assetId: newAssetId,
          name: formData.name || "Commercial Equipment",
          category: formData.category || "BREWING_EQUIPMENT",
          serialNumber: formData.serialNumber || `SN-${Math.floor(10000 + Math.random() * 90000)}`,
          cafeId: formData.cafeId || state.selectedCafeId || "",
          placementArea: formData.placementArea || "Main Counter",
          operationalStatus: formData.operationalStatus || "IN_SERVICE",
          condition: formData.condition || "GOOD",
          criticality: formData.criticality || "MEDIUM",
          nextMaintenanceDue: "2026-11-15",
          warrantyExpiryDate: "2027-08-31",
        };

        try {
          submitBtn.disabled = true;
          submitBtn.textContent = "Registering...";
          await apiPost("/assets", formData);
        } catch (err) {
          // ignore offline
        }

        cachedAssets.unshift(newAsset);
        showToast(`Asset "${newAsset.name}" (${newAssetId}) registered successfully.`, "success");
        modal.close();
        rerender(root);
      });
    }
  }

  wireWizardEvents();
}

// Modal: Asset 360 Detail
function openAssetDetailModal(root, assetId) {
  const asset = cachedAssets.find((a) => a.assetId === assetId);
  if (!asset) {
    showToast(`Asset "${assetId}" not found.`, "error");
    return;
  }

  const isPrimary = state.user?.isPrimaryMaster === true;

  const content = `
    <div style="max-width:700px; margin:0 auto; padding:10px 0;">
      <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:18px; border-bottom:1px solid var(--border-subtle); padding-bottom:12px;">
        <div>
          <h2 style="font-size:18px; font-weight:800; margin:0; color:var(--ink);">${asset.name}</h2>
          <div style="font-size:12.5px; color:var(--muted); font-family:var(--font-mono); margin-top:2px;">
            <span style="color:var(--color-accent-amber); font-weight:700;">${asset.assetId}</span> · SN: ${asset.serialNumber || "—"} · Location: <strong>${asset.cafeId}</strong>
          </div>
        </div>
        <span class="status success" style="font-size:11px; font-weight:700;">${asset.operationalStatus || "IN_SERVICE"}</span>
      </div>

      <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px; font-size:13px; margin-bottom:20px;">
        <div style="padding:10px; background:var(--bg-subtle, rgba(0,0,0,0.02)); border-radius:6px;">
          <div style="font-size:11px; color:var(--muted); text-transform:uppercase;">Category</div>
          <strong>${formatCategory(asset.category)}</strong>
        </div>
        <div style="padding:10px; background:var(--bg-subtle, rgba(0,0,0,0.02)); border-radius:6px;">
          <div style="font-size:11px; color:var(--muted); text-transform:uppercase;">Condition</div>
          <strong>${asset.condition || "GOOD"}</strong>
        </div>
        <div style="padding:10px; background:var(--bg-subtle, rgba(0,0,0,0.02)); border-radius:6px;">
          <div style="font-size:11px; color:var(--muted); text-transform:uppercase;">Criticality</div>
          <strong>${asset.criticality || "MEDIUM"}</strong>
        </div>
        <div style="padding:10px; background:var(--bg-subtle, rgba(0,0,0,0.02)); border-radius:6px;">
          <div style="font-size:11px; color:var(--muted); text-transform:uppercase;">Next Service Due</div>
          <strong style="font-family:var(--font-mono);">${asset.nextMaintenanceDue || "Quarterly"}</strong>
        </div>
      </div>

      <div style="border-top:1px solid var(--border-subtle); padding-top:16px; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px;">
        <div style="display:flex; gap:8px;">
          <button class="btn btn-ghost" id="transfer-asset-btn" type="button" style="font-size:12px;">Transfer Location</button>
          <button class="btn btn-ghost" id="safety-hold-btn" type="button" style="font-size:12px; color:var(--color-danger);">Safety Hold</button>
        </div>
        ${
          isPrimary
            ? `<button class="btn btn-ghost" id="retire-asset-btn" type="button" style="font-size:12px; color:var(--color-danger);">Retire Asset</button>`
            : `<span style="font-size:11px; color:var(--muted);">Capital write-off: Primary Master only</span>`
        }
      </div>
    </div>
  `;

  const modal = openModal(content);

  modal.querySelector("#transfer-asset-btn")?.addEventListener("click", () => {
    modal.close();
    openTransferAssetModal(root, asset.assetId);
  });

  modal.querySelector("#safety-hold-btn")?.addEventListener("click", async () => {
    modal.close();
    confirmAction(
      `Apply Safety Hold on ${asset.name}? This will immediately mark the equipment Out of Service.`,
      async () => {
        await apiPost(`/assets/${asset.assetId}/safety-hold`, { isHoldActive: true, reason: "Safety hold applied by Master" });
        await loadLiveAssetData();
        rerender(root);
      }
    );
  });

  modal.querySelector("#retire-asset-btn")?.addEventListener("click", async () => {
    modal.close();
    confirmAction(
      `Permanently Retire ${asset.name}? This action is restricted to Primary Master authority.`,
      async () => {
        await apiPost(`/assets/${asset.assetId}/retire`, { reason: "End of Life capital retirement" });
        await loadLiveAssetData();
        rerender(root);
      }
    );
  });
}

// Modal: Transfer Asset
function openTransferAssetModal(root, assetId) {
  const content = `
    <div style="max-width:500px; margin:0 auto; padding:10px 0;">
      <h3 style="font-size:16px; font-weight:800; margin:0 0 6px; color:var(--ink);">Inter-Café Asset Transfer</h3>
      <p style="font-size:12.5px; color:var(--muted); margin:0 0 16px;">Transfer equipment ${assetId} to another operational café location</p>

      <div class="form-group">
        <label class="label">Destination Café*</label>
        <select id="transfer-dest-cafe" class="input">
          ${renderCafeOptions()}
        </select>
      </div>

      <div class="form-group">
        <label class="label">Reason for Transfer</label>
        <input type="text" id="transfer-reason" class="input" placeholder="e.g. Equipment rebalancing / Seasonal capacity">
      </div>

      <div style="display:flex; justify-content:flex-end; gap:10px; margin-top:20px;">
        <button class="btn btn-ghost" id="transfer-cancel-btn" type="button">Cancel</button>
        <button class="btn btn-primary" id="transfer-submit-btn" type="button">Confirm Transfer</button>
      </div>
    </div>
  `;

  const modal = openModal(content);
  modal.querySelector("#transfer-cancel-btn")?.addEventListener("click", () => modal.close());
  modal.querySelector("#transfer-submit-btn")?.addEventListener("click", async () => {
    const toCafeId = modal.querySelector("#transfer-dest-cafe")?.value;
    const reason = modal.querySelector("#transfer-reason")?.value;
    try {
      await apiPost(`/assets/${assetId}/transfer`, { toCafeId, reason });
      showToast(`Asset successfully transferred to ${toCafeId}.`, "success");
      modal.close();
      await loadLiveAssetData();
      rerender(root);
    } catch (err) {
      showToast(err.message || "Failed to transfer asset.", "error");
    }
  });
}

// Modal: Create Work Order
function openCreateWorkOrderModal(root, defaultAssetId = "") {
  const content = `
    <div style="max-width:560px; margin:0 auto; padding:10px 0;">
      <h3 style="font-size:16px; font-weight:800; margin:0 0 4px; color:var(--ink);">Create Maintenance Work Order</h3>
      <p style="font-size:12.5px; color:var(--muted); margin:0 0 16px;">Log corrective repair, emergency service, or preventive overhaul</p>

      <div class="form-group">
        <label class="label">Target Asset ID*</label>
        <input type="text" id="wo-asset-id" class="input" value="${defaultAssetId}" placeholder="e.g. AST-001" required>
      </div>

      <div class="form-group">
        <label class="label">Work Order Title*</label>
        <input type="text" id="wo-title" class="input" placeholder="e.g. Boiler Pressure Gauge Calibration" required>
      </div>

      <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px;">
        <div class="form-group">
          <label class="label">Work Type</label>
          <select id="wo-type" class="input">
            <option value="CORRECTIVE_REPAIR">Corrective Repair</option>
            <option value="PREVENTIVE_MAINTENANCE">Preventive Maintenance</option>
            <option value="INSPECTION">Inspection</option>
            <option value="CALIBRATION">Calibration</option>
          </select>
        </div>
        <div class="form-group">
          <label class="label">Priority</label>
          <select id="wo-priority" class="input">
            <option value="NORMAL">Normal</option>
            <option value="URGENT">Urgent</option>
            <option value="CRITICAL">Critical (Equipment Down)</option>
          </select>
        </div>
      </div>

      <div class="form-group">
        <label class="label">Description / Problem Symptoms*</label>
        <textarea id="wo-description" class="input" rows="3" placeholder="Describe symptoms, error codes, leaks, or required maintenance..." required></textarea>
      </div>

      <div style="display:flex; justify-content:flex-end; gap:10px; margin-top:20px;">
        <button class="btn btn-ghost" id="wo-cancel-btn" type="button">Cancel</button>
        <button class="btn btn-primary" id="wo-submit-btn" type="button">Create Work Order</button>
      </div>
    </div>
  `;

  const modal = openModal(content);
  modal.querySelector("#wo-cancel-btn")?.addEventListener("click", () => modal.close());
  modal.querySelector("#wo-submit-btn")?.addEventListener("click", async () => {
    const assetId = modal.querySelector("#wo-asset-id")?.value;
    const title = modal.querySelector("#wo-title")?.value;
    const workType = modal.querySelector("#wo-type")?.value;
    const priority = modal.querySelector("#wo-priority")?.value;
    const description = modal.querySelector("#wo-description")?.value;

    if (!assetId || !title || !description) {
      showToast("Please fill all required fields.", "error");
      return;
    }

    const newWoId = `WO-000${cachedWorkOrders.length + 1}`;
    const newWo = {
      workOrderId: newWoId,
      assetId,
      title,
      workType,
      priority,
      status: "OPEN",
      blocker: "NONE",
      cafeId: state.selectedCafeId || cachedCafes[0]?.cafeId || cachedCafes[0]?.id || "",
      reportedByUserId: state.user?.userId || "SYSTEM",
      createdAt: new Date().toISOString().split("T")[0],
    };

    try {
      await apiPost("/assets/work-orders", { assetId, title, workType, priority, description });
    } catch (err) {}

    cachedWorkOrders.unshift(newWo);
    showToast(`Work order ${newWoId} ("${title}") created successfully.`, "success");
    modal.close();
    rerender(root);
  });
}

// Modal: Update / Resolve Work Order
function openUpdateWorkOrderModal(root, woId) {
  const wo = cachedWorkOrders.find((w) => w.workOrderId === woId);
  if (!wo) {
    showToast(`Work order "${woId}" not found.`, "error");
    return;
  }

  const content = `
    <div style="max-width:580px; margin:0 auto; padding:10px 0;">
      <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:16px; border-bottom:1px solid var(--border-subtle); padding-bottom:12px;">
        <div>
          <h3 style="font-size:17px; font-weight:800; margin:0; color:var(--ink);">Update &amp; Resolve Work Order</h3>
          <p style="font-size:12px; color:var(--muted); margin:2px 0 0 0;">
            <strong style="font-family:var(--font-mono); color:var(--color-accent-amber);">${wo.workOrderId}</strong> · Asset: <strong>${wo.assetId}</strong> (${wo.cafeId})
          </p>
        </div>
        <span class="status ${wo.priority === 'CRITICAL' ? 'danger' : 'warning'}" style="font-size:11px; font-weight:700;">${wo.priority}</span>
      </div>

      <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-bottom:14px;">
        <div class="form-group" style="margin:0;">
          <label class="label">Work Order Status*</label>
          <select id="uwo-status" class="input" style="font-size:12.5px;">
            <option value="IN_PROGRESS" ${wo.status === 'IN_PROGRESS' ? 'selected' : ''}>In Progress (Under Repair)</option>
            <option value="WAITING_FOR_PART" ${wo.status === 'WAITING_FOR_PART' ? 'selected' : ''}>Waiting for Part Delivery</option>
            <option value="RESOLVED" ${wo.status === 'RESOLVED' ? 'selected' : ''}>Resolved (Testing Passed)</option>
            <option value="COMPLETED" ${wo.status === 'COMPLETED' ? 'selected' : ''}>Completed &amp; Signed Off</option>
          </select>
        </div>
        <div class="form-group" style="margin:0;">
          <label class="label">Current Operational Blocker</label>
          <select id="uwo-blocker" class="input" style="font-size:12.5px;">
            <option value="NONE" ${(!wo.blocker || wo.blocker === 'NONE') ? 'selected' : ''}>None (No Blocker)</option>
            <option value="WAITING_FOR_PART" ${wo.blocker === 'WAITING_FOR_PART' ? 'selected' : ''}>Waiting for Replacement Part</option>
            <option value="EXTERNAL_TECHNICIAN" ${wo.blocker === 'EXTERNAL_TECHNICIAN' ? 'selected' : ''}>Waiting for OEM Technician</option>
            <option value="SAFETY_HOLD" ${wo.blocker === 'SAFETY_HOLD' ? 'selected' : ''}>Safety Lockdown Active</option>
          </select>
        </div>
      </div>

      <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-bottom:14px;">
        <div class="form-group" style="margin:0;">
          <label class="label">Technician Labor (Hours)</label>
          <input type="number" id="uwo-hours" class="input" value="2.5" step="0.5" min="0" style="font-size:12.5px;">
        </div>
        <div class="form-group" style="margin:0;">
          <label class="label">Spare Parts Cost (₹)</label>
          <input type="number" id="uwo-cost" class="input" value="4500" step="100" min="0" style="font-size:12.5px;">
        </div>
      </div>

      <div class="form-group" style="margin-bottom:16px;">
        <label class="label">Technician Resolution / Sign-off Notes*</label>
        <textarea id="uwo-notes" class="input" rows="2" placeholder="e.g. Replaced compressor relay capacitor, recalibrated PID temp sensor to 3.2°C, leak test passed." style="font-size:12px;" required></textarea>
      </div>

      <div style="display:flex; justify-content:flex-end; gap:10px; border-top:1px solid var(--border-subtle); padding-top:14px;">
        <button class="btn btn-ghost" id="uwo-cancel-btn" type="button">Cancel</button>
        <button class="btn btn-primary" id="uwo-submit-btn" type="button">Authorize &amp; Update</button>
      </div>
    </div>
  `;

  const modal = openModal(content);
  modal.querySelector("#uwo-cancel-btn")?.addEventListener("click", () => modal.close());
  modal.querySelector("#uwo-submit-btn")?.addEventListener("click", async () => {
    const status = modal.querySelector("#uwo-status")?.value;
    const blocker = modal.querySelector("#uwo-blocker")?.value;
    const notes = modal.querySelector("#uwo-notes")?.value;

    try {
      await apiPost(`/assets/work-orders/${woId}/resolve`, { status, blocker, notes });
      showToast(`Work order ${woId} updated successfully to ${status}.`, "success");
      const targetWo = cachedWorkOrders.find((w) => w.workOrderId === woId);
      if (targetWo) {
        targetWo.status = status;
        targetWo.blocker = blocker;
      }
      modal.close();
      rerender(root);
    } catch (err) {
      showToast(err?.message || `Failed to update work order ${woId}`, "coral");
    }
  });
}

// Modal: Record Inspection & Calibration
function openRecordInspectionModal(root) {
  const content = `
    <div style="max-width:560px; margin:0 auto; padding:10px 0;">
      <h3 style="font-size:17px; font-weight:800; margin:0 0 4px; color:var(--ink);">Record Equipment Inspection &amp; Calibration</h3>
      <p style="font-size:12.5px; color:var(--muted); margin:0 0 16px;">Daily frontline verification checklist, boiler pressure telemetry, and calibration certificate log</p>

      <div class="form-group" style="margin-bottom:12px;">
        <label class="label">Target Asset*</label>
        <select id="insp-asset-id" class="input" style="font-size:12.5px;">
          ${cachedAssets && cachedAssets.length > 0
            ? cachedAssets.map(a => {
                const id = a.assetId || a._id;
                const name = a.name || a.assetName || id;
                const cafe = a.cafeId || a.cafe || '';
                return `<option value="${id}">${name} (${id}${cafe ? ' — ' + cafe : ''})</option>`;
              }).join('')
            : '<option value="" disabled selected>No registered assets found — add assets first</option>'
          }
        </select>
      </div>

      <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-bottom:12px;">
        <div class="form-group" style="margin:0;">
          <label class="label">Inspection Type</label>
          <select id="insp-type" class="input" style="font-size:12.5px;">
            <option value="DAILY_OPENING">Morning Opening Verification</option>
            <option value="PRESSURE_CALIBRATION">Boiler &amp; Pressure Calibration</option>
            <option value="HYGIENE_CLEAN">Chemical Backflush &amp; Deep Clean</option>
            <option value="WARRANTY_CHECK">Quarterly OEM Warranty Audit</option>
          </select>
        </div>
        <div class="form-group" style="margin:0;">
          <label class="label">Condition Verdict</label>
          <select id="insp-verdict" class="input" style="font-size:12.5px;">
            <option value="PASS">✅ 100% Pass (Optimal Calibration)</option>
            <option value="WARNING">⚠️ Warning (Minor Variance / Wear)</option>
            <option value="FAIL">❌ Fail (Immediate Service Needed)</option>
          </select>
        </div>
      </div>

      <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-bottom:12px;">
        <div class="form-group" style="margin:0;">
          <label class="label">Boiler Pressure Reading (bar)</label>
          <input type="number" id="insp-pressure" class="input" value="9.1" step="0.1" style="font-size:12.5px;">
        </div>
        <div class="form-group" style="margin:0;">
          <label class="label">Refrigeration Temp (°C)</label>
          <input type="number" id="insp-temp" class="input" value="3.2" step="0.1" style="font-size:12.5px;">
        </div>
      </div>

      <div class="form-group" style="margin-bottom:16px;">
        <label class="label">Inspector Signature &amp; Remarks</label>
        <textarea id="insp-notes" class="input" rows="2" placeholder="e.g. Pump pressure stable at 9.1 bar, group head gaskets clean, steam wands purged." style="font-size:12px;"></textarea>
      </div>

      <div style="display:flex; justify-content:flex-end; gap:10px; border-top:1px solid var(--border-subtle); padding-top:14px;">
        <button class="btn btn-ghost" id="insp-cancel-btn" type="button">Cancel</button>
        <button class="btn btn-primary" id="insp-submit-btn" type="button">Save Inspection Record</button>
      </div>
    </div>
  `;

  const modal = openModal(content);
  modal.querySelector("#insp-cancel-btn")?.addEventListener("click", () => modal.close());
  modal.querySelector("#insp-submit-btn")?.addEventListener("click", async () => {
    const assetId = modal.querySelector("#insp-asset-id")?.value;
    const verdict = modal.querySelector("#insp-verdict")?.value;
    const notes = modal.querySelector("#insp-notes")?.value;
    try {
      await apiPost("/assets/inspections", { assetId, verdict, notes });
      showToast(`Inspection logged for ${assetId}: ${verdict}.`, "success");
      modal.close();
      await loadLiveAssetData();
      rerender(root);
    } catch (err) {
      showToast(err?.message || `Failed to log inspection for ${assetId}`, "coral");
    }
  });
}

// Modal: Create New Preventive Maintenance Plan
function openNewMaintenancePlanModal(root) {
  const content = `
    <div style="max-width:560px; margin:0 auto; padding:10px 0;">
      <h3 style="font-size:17px; font-weight:800; margin:0 0 4px; color:var(--ink);">New Preventive Maintenance Schedule</h3>
      <p style="font-size:12.5px; color:var(--muted); margin:0 0 16px;">Define recurring servicing intervals, descaling cycles, and replacement part kits</p>

      <div class="form-group" style="margin-bottom:12px;">
        <label class="label">Schedule Title*</label>
        <input type="text" id="pm-title" class="input" placeholder="e.g. Quarterly Grouphead Overhaul & Descaling" style="font-size:12.5px;" required>
      </div>

      <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-bottom:12px;">
        <div class="form-group" style="margin:0;">
          <label class="label">Target Category</label>
          <select id="pm-cat" class="input" style="font-size:12.5px;">
            <option value="BREWING_EQUIPMENT">Espresso &amp; Brewing Machines</option>
            <option value="GRINDERS_MILLS">Grinders &amp; Portioning</option>
            <option value="REFRIGERATION">Refrigeration &amp; Chilling</option>
            <option value="WATER_TREATMENT">Reverse Osmosis Water Systems</option>
          </select>
        </div>
        <div class="form-group" style="margin:0;">
          <label class="label">Recurrence Frequency</label>
          <select id="pm-freq" class="input" style="font-size:12.5px;">
            <option value="MONTHLY">Monthly Service</option>
            <option value="QUARTERLY" selected>Quarterly Overhaul</option>
            <option value="BIANNUAL">Bi-Annual Calibration</option>
            <option value="ANNUAL">Annual AMC Factory Service</option>
          </select>
        </div>
      </div>

      <div class="form-group" style="margin-bottom:16px;">
        <label class="label">Standard Operating Procedure Checklist</label>
        <textarea id="pm-sop" class="input" rows="3" placeholder="1. Isolate boiler power&#10;2. Replace 8.5mm group head gaskets&#10;3. Ultrasonic soak shower screens&#10;4. Recalibrate flow meters" style="font-size:12px;"></textarea>
      </div>

      <div style="display:flex; justify-content:flex-end; gap:10px; border-top:1px solid var(--border-subtle); padding-top:14px;">
        <button class="btn btn-ghost" id="pm-cancel-btn" type="button">Cancel</button>
        <button class="btn btn-primary" id="pm-submit-btn" type="button">Create Maintenance Schedule</button>
      </div>
    </div>
  `;

  const modal = openModal(content);
  modal.querySelector("#pm-cancel-btn")?.addEventListener("click", () => modal.close());
  modal.querySelector("#pm-submit-btn")?.addEventListener("click", async () => {
    const title = modal.querySelector("#pm-title")?.value?.trim();
    if (!title) {
      showToast("Schedule title is required.", "error");
      return;
    }
    const category = modal.querySelector("#pm-cat")?.value;
    const frequencyType = modal.querySelector("#pm-freq")?.value;
    const sop = modal.querySelector("#pm-sop")?.value;
    const submitBtn = modal.querySelector("#pm-submit-btn");

    try {
      submitBtn.disabled = true;
      submitBtn.textContent = "Creating...";
      await apiPost("/assets/plans", {
        name: title,
        category,
        frequencyType,
        jobPlan: { title, tasks: [{ order: 1, taskDescription: sop || title, isMandatory: true }] },
      });
      showToast(`Maintenance plan "${title}" created and scheduled.`, "success");
      modal.close();
      await loadLiveAssetData();
      rerender(root);
    } catch (err) {
      showToast(err?.message || "Failed to create maintenance plan", "coral");
      submitBtn.disabled = false;
      submitBtn.textContent = "Create Maintenance Schedule";
    }
  });
}

// Modal: Complete Scheduled Maintenance
function openCompleteMaintenanceModal(root, assetId, planId) {
  const asset = (cachedAssets || []).find((a) => a.assetId === assetId) || { name: assetId, assetId };
  const todayStr = new Date().toISOString().split("T")[0];

  const content = `
    <div style="max-width:560px; margin:0 auto; padding:10px 0;">
      <h3 style="font-size:17px; font-weight:800; margin:0 0 4px; color:var(--ink);">Record Maintenance Completion</h3>
      <p style="font-size:12.5px; color:var(--muted); margin:0 0 16px;">
        Complete scheduled servicing for <strong>${asset.name}</strong> (${asset.assetId})
      </p>

      <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-bottom:12px;">
        <div class="form-group" style="margin:0;">
          <label class="label">Completion Date*</label>
          <input type="date" id="comp-date" class="input" value="${todayStr}" style="font-size:12.5px;" required>
        </div>
        <div class="form-group" style="margin:0;">
          <label class="label">Result Verdict*</label>
          <select id="comp-result" class="input" style="font-size:12.5px;">
            <option value="COMPLETED" selected>COMPLETED (Satisfactory)</option>
            <option value="PASS">PASS (Inspection / Calibration)</option>
            <option value="REQUIRES_FOLLOWUP">REQUIRES FOLLOW-UP</option>
            <option value="FAILED">FAILED</option>
          </select>
        </div>
      </div>

      <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-bottom:12px;">
        <div class="form-group" style="margin:0;">
          <label class="label">Technician / Performer*</label>
          <input type="text" id="comp-performer" class="input" placeholder="e.g. Ramesh Kumar" value="${state.user?.name || ''}" style="font-size:12.5px;" required>
        </div>
        <div class="form-group" style="margin:0;">
          <label class="label">Cost (₹)</label>
          <input type="number" id="comp-cost" class="input" placeholder="0" min="0" step="0.01" style="font-size:12.5px;">
        </div>
      </div>

      <div class="form-group" style="margin-bottom:12px;">
        <label class="label">Work Summary*</label>
        <input type="text" id="comp-summary" class="input" placeholder="e.g. Replaced grouphead gaskets, descaled heat exchanger" style="font-size:12.5px;" required>
      </div>

      <div class="form-group" style="margin-bottom:12px;">
        <label class="label">Evidence Document ID (REC-06)</label>
        <input type="text" id="comp-doc-id" class="input" placeholder="e.g. DOC-2026-0001 (optional)" style="font-size:12.5px;">
      </div>

      <div class="form-group" style="margin-bottom:16px;">
        <label class="label">Resolution / Service Notes</label>
        <textarea id="comp-notes" class="input" rows="2" placeholder="Notes on equipment tolerances, parts used, etc." style="font-size:12px;"></textarea>
      </div>

      <div style="display:flex; justify-content:flex-end; gap:10px; border-top:1px solid var(--border-subtle); padding-top:14px;">
        <button class="btn btn-ghost" id="comp-cancel-btn" type="button">Cancel</button>
        <button class="btn btn-primary" id="comp-submit-btn" type="button">Submit Completion</button>
      </div>
    </div>
  `;

  const modal = openModal(content);
  modal.querySelector("#comp-cancel-btn")?.addEventListener("click", () => modal.close());
  modal.querySelector("#comp-submit-btn")?.addEventListener("click", async () => {
    const completedAt = modal.querySelector("#comp-date")?.value;
    const result = modal.querySelector("#comp-result")?.value;
    const performedBy = modal.querySelector("#comp-performer")?.value?.trim();
    const costRupees = Number(modal.querySelector("#comp-cost")?.value) || 0;
    const workSummary = modal.querySelector("#comp-summary")?.value?.trim();
    const docId = modal.querySelector("#comp-doc-id")?.value?.trim();
    const resolutionNotes = modal.querySelector("#comp-notes")?.value?.trim();

    if (!workSummary) {
      showToast("Work summary is required.", "error");
      return;
    }
    if (!performedBy) {
      showToast("Technician/Performer name is required.", "error");
      return;
    }

    const submitBtn = modal.querySelector("#comp-submit-btn");
    try {
      submitBtn.disabled = true;
      submitBtn.textContent = "Saving...";

      const evidenceDocumentIds = docId ? [docId.toUpperCase()] : [];
      await apiPost("/assets/maintenance/complete", {
        assetId,
        planId: planId || null,
        completedAt,
        result,
        performedBy,
        technicianName: performedBy,
        costPaisa: Math.round(costRupees * 100),
        workSummary,
        resolutionNotes,
        evidenceDocumentIds,
      });

      showToast(`Maintenance for ${asset.name} (${assetId}) recorded and resolved.`, "success");
      modal.close();
      await loadLiveAssetData();
      rerender(root);
    } catch (err) {
      showToast(err?.message || "Failed to record maintenance completion", "coral");
      submitBtn.disabled = false;
      submitBtn.textContent = "Submit Completion";
    }
  });
}

// Modal: Reschedule Maintenance Due Date
function openRescheduleMaintenanceModal(root, assetId, planId, currentDue) {
  const asset = (cachedAssets || []).find((a) => a.assetId === assetId) || { name: assetId, assetId };
  const content = `
    <div style="max-width:480px; margin:0 auto; padding:10px 0;">
      <h3 style="font-size:17px; font-weight:800; margin:0 0 4px; color:var(--ink);">Reschedule Maintenance</h3>
      <p style="font-size:12.5px; color:var(--muted); margin:0 0 16px;">
        Adjust service due date for <strong>${asset.name}</strong> (${asset.assetId})
      </p>

      <div class="form-group" style="margin-bottom:12px;">
        <label class="label">Current Scheduled Date</label>
        <input type="text" class="input" value="${currentDue || '—'}" disabled style="font-size:12.5px; font-family:var(--font-mono);">
      </div>

      <div class="form-group" style="margin-bottom:12px;">
        <label class="label">New Due Date*</label>
        <input type="date" id="resched-date" class="input" style="font-size:12.5px;" required>
      </div>

      <div class="form-group" style="margin-bottom:16px;">
        <label class="label">Mandatory Reason for Rescheduling*</label>
        <textarea id="resched-reason" class="input" rows="3" placeholder="Explain operational, parts or technician constraints" style="font-size:12px;" required></textarea>
      </div>

      <div style="display:flex; justify-content:flex-end; gap:10px; border-top:1px solid var(--border-subtle); padding-top:14px;">
        <button class="btn btn-ghost" id="resched-cancel-btn" type="button">Cancel</button>
        <button class="btn btn-primary" id="resched-submit-btn" type="button">Confirm Reschedule</button>
      </div>
    </div>
  `;

  const modal = openModal(content);
  modal.querySelector("#resched-cancel-btn")?.addEventListener("click", () => modal.close());
  modal.querySelector("#resched-submit-btn")?.addEventListener("click", async () => {
    const newDueDate = modal.querySelector("#resched-date")?.value;
    const reason = modal.querySelector("#resched-reason")?.value?.trim();

    if (!newDueDate) {
      showToast("New due date is required.", "error");
      return;
    }
    if (!reason) {
      showToast("Mandatory rescheduling reason is required.", "error");
      return;
    }

    const submitBtn = modal.querySelector("#resched-submit-btn");
    try {
      submitBtn.disabled = true;
      submitBtn.textContent = "Updating...";

      await apiPost("/assets/maintenance/reschedule", {
        assetId,
        planId: planId || null,
        newDueDate,
        reason,
      });

      showToast(`Maintenance for ${asset.name} rescheduled to ${newDueDate}.`, "success");
      modal.close();
      await loadLiveAssetData();
      rerender(root);
    } catch (err) {
      showToast(err?.message || "Failed to reschedule maintenance", "coral");
      submitBtn.disabled = false;
      submitBtn.textContent = "Confirm Reschedule";
    }
  });
}
