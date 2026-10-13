// =============================================================================
// ZAMORIN CAFE ERP — OWN-SCR-001: OWNER DASHBOARD / ZAMORIN COMMAND CENTRE
// Design System v2 (Ledger & Roastery Dark / Porcelain Light Theme)
//
// Complete 10-Layer Executive Business Intelligence, Financial Control & Portfolio Oversight:
//   - Layer 1: Portfolio Context & Freshness (IST Timezone, All Period & Comparison Filters, Save Views, Live Refresh)
//   - Health Strip: Cafés Operating, Staff on Duty, Exceptions, Stock Risks, POS Online, Data Freshness
//   - Strategic Shortcuts Row: Personal Ledger, Cash Drawers, Finance Summary, Café Performance, Reports, Attention Centre
//   - Layer 2: Executive KPI Summary (Sales, Sales Movement ₹/%, Expense Ratio +pp, Payroll % +pp, Variance, Exceptions)
//   - Layer 3: What Changed Executive Digest (Deterministic Factual Statements)
//   - Layer 4: Attention Required Queue (Categorized, Severity Badges, Aging, Direct Actions, All-Clear State)
//   - Layer 5: Revenue & Commercial Trend [ Interactive SVG Chart | Data Table ]
//   - Layer 6: Multi-Location Health Breakdown with Explainable Badges (Reasons Tooltip/Modal)
//   - Layer 7: Financial Control (Interactive Cash Drawer Management Modal, Personal Ledger Overview, Payment Mix, Reconciliation Watch)
//   - Layer 8: Operational & Workforce Pulse (Attendance Rate, Overtime, Stockout Risks, Wastage Economics)
//   - Layer 9: Commercial Velocity (Top 5 Menu Items, Category Mix, AOV)
//   - Layer 10: System & Operational Risk Posture (P0/P1 Incidents, POS Terminal Uptime, Device Security)
// =============================================================================

import { skeleton, showToast, confirmAction } from "../components.js";
import { apiGet, apiPost } from "../apiClient.js";
import { navigate } from "../router.js";
import { state } from "../state.js";
import { icon } from "../icons.js";
import { openCafeCreateModal } from "./cafeCreateModal.js";
import { openCafeAccessManagementModal } from "./cafeAccessManagementModal.js";

// ─── Format Helpers ──────────────────────────────────────────────────────────

function fmtInr(paisa) {
  if (paisa === null || paisa === undefined) return "—";
  const rupees = Math.round(Number(paisa) / 100);
  if (Math.abs(rupees) >= 10000000) return "₹" + (rupees / 10000000).toFixed(2) + "Cr";
  if (Math.abs(rupees) >= 100000) return "₹" + (rupees / 100000).toFixed(2) + "L";
  if (Math.abs(rupees) >= 1000) return "₹" + (rupees / 1000).toFixed(1) + "K";
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

// ─── Component State ──────────────────────────────────────────────────────────

let ownerDashboardState = {
  period: "today", // "today" | "yesterday" | "7d" | "30d" | "this_month" | "this_quarter" | "this_year" | "custom"
  comparison: "previous_period", // "previous_period" | "previous_week" | "previous_month" | "previous_quarter" | "previous_year" | "none"
  customFrom: null,
  customTo: null,
  selectedCafeId: "", // "" for All Authorized Cafes
  trendViewMode: "chart", // "chart" | "data"
  data: null,
  savedViews: [],
  activeSavedViewId: null,
  loading: false,
  clockTimer: null,
  refreshTimer: null,
  liveRefreshEnabled: true,
};

// ─── HTML Template ────────────────────────────────────────────────────────────

export function renderOwnerDashboard() {
  return `
    <div class="owner-command-centre" id="owner-command-centre">
      <!-- Layer 1: Portfolio Context & Header -->
      <div class="occ-header">
        <div class="occ-title-block">
          <div class="occ-badge">
            <span class="pulse-dot"></span>
            OWNER PORTAL · EXECUTIVE COMMAND CENTRE
          </div>
          <h1 class="occ-title">Zamorin Command Centre</h1>
          <div class="occ-subtitle">
            <span id="occ-ist-clock">${getIstClockString()}</span>
            <span class="occ-dot">·</span>
            <span id="occ-freshness">Live IST Sync</span>
          </div>
        </div>

        <div class="occ-controls">
          <!-- Authorized Cafe Selector -->
          <div class="occ-cafe-select-wrapper">
            <label for="occ-cafe-filter" class="sr-only">Café Scope</label>
            <select id="occ-cafe-filter" class="occ-select">
              <option value="">All Cafés (Authorized Portfolio)</option>
              ${(state.assignedCafes || []).map(c => `
                <option value="${c.cafeId || c}" ${ownerDashboardState.selectedCafeId === (c.cafeId || c) ? 'selected' : ''}>
                  ${c.name ? `${c.name} (${c.cafeId})` : c}
                </option>
              `).join('')}
            </select>
          </div>

          <!-- All Approved Period Filter Options -->
          <div class="occ-period-selector">
            <button class="occ-period-btn ${ownerDashboardState.period === 'today' ? 'active' : ''}" data-period="today">Today</button>
            <button class="occ-period-btn ${ownerDashboardState.period === 'yesterday' ? 'active' : ''}" data-period="yesterday">Yesterday</button>
            <button class="occ-period-btn ${ownerDashboardState.period === '7d' ? 'active' : ''}" data-period="7d">7D</button>
            <button class="occ-period-btn ${ownerDashboardState.period === '30d' ? 'active' : ''}" data-period="30d">30D</button>
            <button class="occ-period-btn ${ownerDashboardState.period === 'this_month' ? 'active' : ''}" data-period="this_month">Month</button>
            <button class="occ-period-btn ${ownerDashboardState.period === 'this_quarter' ? 'active' : ''}" data-period="this_quarter">Quarter</button>
            <button class="occ-period-btn ${ownerDashboardState.period === 'this_year' ? 'active' : ''}" data-period="this_year">Year</button>
            <button class="occ-period-btn ${ownerDashboardState.period === 'custom' ? 'active' : ''}" data-period="custom" id="occ-custom-date-btn">Custom</button>
          </div>

          <!-- All Approved Comparison Modes -->
          <div class="occ-comparison-wrapper">
            <label for="occ-comparison-select" class="sr-only">Comparison Basis</label>
            <select id="occ-comparison-select" class="occ-select">
              <option value="previous_period" ${ownerDashboardState.comparison === 'previous_period' ? 'selected' : ''}>vs Prior Period</option>
              <option value="previous_week" ${ownerDashboardState.comparison === 'previous_week' ? 'selected' : ''}>vs Prior Week</option>
              <option value="previous_month" ${ownerDashboardState.comparison === 'previous_month' ? 'selected' : ''}>vs Prior Month</option>
              <option value="previous_quarter" ${ownerDashboardState.comparison === 'previous_quarter' ? 'selected' : ''}>vs Prior Quarter</option>
              <option value="previous_year" ${ownerDashboardState.comparison === 'previous_year' ? 'selected' : ''}>vs Prior Year</option>
              <option value="none" ${ownerDashboardState.comparison === 'none' ? 'selected' : ''}>No Comparison</option>
            </select>
          </div>

          <!-- Saved Views Actions -->
          <div class="occ-saved-views-group">
            <select id="occ-saved-views-select" class="occ-select" title="Load Saved View">
              <option value="">Views...</option>
              ${ownerDashboardState.savedViews.map(v => `
                <option value="${v.savedViewId}" ${ownerDashboardState.activeSavedViewId === v.savedViewId ? 'selected' : ''}>
                  ${v.name} ${v.isDefault ? '(Default)' : ''}
                </option>
              `).join('')}
            </select>
            <button id="occ-save-view-btn" class="btn btn-secondary btn-sm" title="Save current filter set">
              Save View
            </button>
          </div>

          <!-- Live Refresh & Manual Trigger -->
          <button id="occ-live-toggle-btn" class="btn btn-sm ${ownerDashboardState.liveRefreshEnabled ? 'btn-primary' : 'btn-secondary'}" title="Toggle 30s Live Portfolio Refresh">
            <span class="live-indicator ${ownerDashboardState.liveRefreshEnabled ? 'active' : ''}"></span>
            ${ownerDashboardState.liveRefreshEnabled ? 'LIVE' : 'PAUSED'}
          </button>

          <button id="occ-refresh-btn" class="btn btn-secondary btn-sm" title="Refresh Live Portfolio Data">
            ${icon("reports", 14)} Refresh
          </button>
        </div>
      </div>

      <!-- Custom Date Picker Modal / Container (Hidden by default) -->
      <div id="occ-custom-date-modal" class="occ-modal-backdrop" style="display: none;">
        <div class="occ-modal-card">
          <div class="occ-modal-header">
            <h3>Select Custom Date Range</h3>
            <button id="occ-close-date-modal" class="btn btn-ghost btn-sm">✕</button>
          </div>
          <div class="occ-modal-body">
            <div class="form-group mb-3">
              <label class="form-label">From Date (YYYY-MM-DD)</label>
              <input type="date" id="occ-custom-from" class="form-input" value="${ownerDashboardState.customFrom || ''}" />
            </div>
            <div class="form-group mb-4">
              <label class="form-label">To Date (YYYY-MM-DD)</label>
              <input type="date" id="occ-custom-to" class="form-input" value="${ownerDashboardState.customTo || ''}" />
            </div>
            <div class="flex justify-end gap-2">
              <button id="occ-cancel-custom-date" class="btn btn-secondary btn-sm">Cancel</button>
              <button id="occ-apply-custom-date" class="btn btn-primary btn-sm">Apply Range</button>
            </div>
          </div>
        </div>
      </div>

      <!-- Save View Modal (Hidden by default) -->
      <div id="occ-save-view-modal" class="occ-modal-backdrop" style="display: none;">
        <div class="occ-modal-card">
          <div class="occ-modal-header">
            <h3>Save Executive Dashboard View</h3>
            <button id="occ-close-save-modal" class="btn btn-ghost btn-sm">✕</button>
          </div>
          <div class="occ-modal-body">
            <div class="form-group mb-3">
              <label class="form-label">View Name</label>
              <input type="text" id="occ-new-view-name" class="form-input" placeholder="e.g. Monthly Executive Summary" />
            </div>
            <div class="form-check mb-4">
              <input type="checkbox" id="occ-new-view-default" class="form-check-input" />
              <label for="occ-new-view-default" class="form-check-label text-sm text-slate-300">Set as my default view</label>
            </div>
            <div class="flex justify-end gap-2">
              <button id="occ-cancel-save-view" class="btn btn-secondary btn-sm">Cancel</button>
              <button id="occ-confirm-save-view" class="btn btn-primary btn-sm">Save View</button>
            </div>
          </div>
        </div>
      </div>

      <!-- Cash Drawer Management Interactive Modal (Hidden by default) -->
      <div id="occ-drawer-modal" class="occ-modal-backdrop" style="display: none;">
        <div class="occ-modal-card occ-modal-lg">
          <div class="occ-modal-header">
            <div class="flex items-center gap-2">
              ${icon("pos", 20)}
              <h3>Cash Drawer Management & Reconciliation</h3>
            </div>
            <button id="occ-close-drawer-modal" class="btn btn-ghost btn-sm">✕</button>
          </div>
          <div class="occ-modal-body" id="occ-drawer-modal-content">
            <!-- Loaded dynamically via openCashDrawerManagement() -->
          </div>
        </div>
      </div>

      <!-- Daily Close Packs Management Modal (Hidden by default) -->
      <div id="occ-daily-close-modal" class="occ-modal-backdrop" style="display: none;">
        <div class="occ-modal-card occ-modal-lg">
          <div class="occ-modal-header">
            <div class="flex items-center gap-2">
              ${icon("tasks", 20)}
              <h3>Daily Café Close Packs & Variance Reviews</h3>
            </div>
            <button id="occ-close-daily-close-modal" class="btn btn-ghost btn-sm">✕</button>
          </div>
          <div class="occ-modal-body" id="occ-daily-close-modal-content">
            <!-- Loaded dynamically via openDailyClosePacksModal() -->
          </div>
        </div>
      </div>

      <!-- Health Strip (Section 15 Operational Context) -->
      <div class="occ-health-strip" id="occ-health-strip">
        <div class="occ-hs-item">
          <span class="occ-hs-dot online"></span>
          <span class="occ-hs-label">Cafés Operating:</span>
          <span class="occ-hs-val" id="occ-hs-cafes">Active</span>
        </div>
        <div class="occ-hs-item">
          <span class="occ-hs-dot online"></span>
          <span class="occ-hs-label">Staff on Duty:</span>
          <span class="occ-hs-val" id="occ-hs-staff">Rostered</span>
        </div>
        <div class="occ-hs-item">
          <span class="occ-hs-dot" id="occ-hs-dot-exceptions"></span>
          <span class="occ-hs-label">Management Exceptions:</span>
          <span class="occ-hs-val" id="occ-hs-exceptions">0</span>
        </div>
        <div class="occ-hs-item">
          <span class="occ-hs-dot" id="occ-hs-dot-stock"></span>
          <span class="occ-hs-label">Stock Risks:</span>
          <span class="occ-hs-val" id="occ-hs-stock">0 Critical</span>
        </div>
        <div class="occ-hs-item">
          <span class="occ-hs-dot online"></span>
          <span class="occ-hs-label">POS Availability:</span>
          <span class="occ-hs-val" id="occ-hs-pos">100% Online</span>
        </div>
        <div class="occ-hs-item">
          <span class="occ-hs-label">Data Freshness:</span>
          <span class="occ-hs-val text-amber-400" id="occ-hs-freshness">Live IST</span>
        </div>
      </div>

      <!-- Strategic Shortcuts Row (Replaced Operational Action Row) -->
      <div class="occ-shortcuts-bar">
        <button class="occ-shortcut-btn" data-route="ledger" title="Open Owner Personal Ledger & Financing Account">
          ${icon("ledger", 18)}
          <div>
            <div class="occ-sc-title">Personal Ledger</div>
            <div class="occ-sc-sub">Owner Account & Reimbursements</div>
          </div>
        </button>
        <button class="occ-shortcut-btn" id="occ-btn-manage-drawers-shortcut" title="Open Cash Drawer Management Cockpit">
          ${icon("pos", 18)}
          <div>
            <div class="occ-sc-title">Cash Drawers</div>
            <div class="occ-sc-sub">Float, Safe Drops & Variances</div>
          </div>
        </button>
        <button class="occ-shortcut-btn" id="occ-btn-daily-close-shortcut" title="Review Daily Café Close Packs & Variance">
          ${icon("tasks", 18)}
          <div>
            <div class="occ-sc-title">Daily Close Packs</div>
            <div class="occ-sc-sub">Manager Shift Review & Acknowledgment</div>
          </div>
        </button>
        <button class="occ-shortcut-btn" data-route="finance" title="Open Corporate Finance & Accounts">
          ${icon("finance", 18)}
          <div>
            <div class="occ-sc-title">Finance Summary</div>
            <div class="occ-sc-sub">P&L, Journal & Banking</div>
          </div>
        </button>
        <button class="occ-shortcut-btn" data-route="performance" title="Open Multi-Café Benchmark Matrix">
          ${icon("reports", 18)}
          <div>
            <div class="occ-sc-title">Café Performance</div>
            <div class="occ-sc-sub">Location Targets & Velocity</div>
          </div>
        </button>
        <button class="occ-shortcut-btn" data-route="reports" title="Open Executive Reports & Analytics">
          ${icon("reports", 18)}
          <div>
            <div class="occ-sc-title">Executive Reports</div>
            <div class="occ-sc-sub">Commercial & P&L Statements</div>
          </div>
        </button>
        <button class="occ-shortcut-btn" data-anchor="attention-section" title="Scroll to Attention Centre">
          ${icon("tasks", 18)}
          <div>
            <div class="occ-sc-title">Attention Centre</div>
            <div class="occ-sc-sub">Management Queue</div>
          </div>
        </button>
      </div>

      <!-- Main Dashboard Content Container -->
      <div id="occ-content" class="occ-content-grid">
        ${renderDashboardBodyHtml(DEFAULT_OWNER_DASHBOARD_DATA)}
      </div>
    </div>
  `;
}

// ─── Loading Skeleton ─────────────────────────────────────────────────────────

function renderLoadingSkeleton() {
  return `
    <div class="occ-kpi-grid">
      ${skeleton("h-28 rounded-lg")}
      ${skeleton("h-28 rounded-lg")}
      ${skeleton("h-28 rounded-lg")}
      ${skeleton("h-28 rounded-lg")}
      ${skeleton("h-28 rounded-lg")}
      ${skeleton("h-28 rounded-lg")}
    </div>
    <div class="occ-section-card mt-6">
      ${skeleton("h-64 rounded-lg")}
    </div>
  `;
}

// ─── Hydration & Logic ────────────────────────────────────────────────────────

export function hydrateOwnerDashboard(container) {
  if (!container) return;

  // 1. Clock Timer
  if (ownerDashboardState.clockTimer) clearInterval(ownerDashboardState.clockTimer);
  ownerDashboardState.clockTimer = setInterval(() => {
    const el = document.getElementById("occ-ist-clock");
    if (el) el.textContent = getIstClockString();
  }, 1000);

  // 2. Cafe Scope Filter
  const cafeFilter = container.querySelector("#occ-cafe-filter");
  if (cafeFilter) {
    cafeFilter.addEventListener("change", (e) => {
      ownerDashboardState.selectedCafeId = e.target.value;
      loadDashboardData();
    });
  }

  // 3. Period Switchers
  container.querySelectorAll(".occ-period-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const p = btn.dataset.period;
      if (p === "custom") {
        const modal = document.getElementById("occ-custom-date-modal");
        if (modal) modal.style.display = "flex";
        return;
      }
      container.querySelectorAll(".occ-period-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      ownerDashboardState.period = p;
      loadDashboardData();
    });
  });

  // Custom Date Modal Actions
  const customModal = container.querySelector("#occ-custom-date-modal");
  const closeDateModal = container.querySelector("#occ-close-date-modal");
  const cancelDateModal = container.querySelector("#occ-cancel-custom-date");
  const applyDateModal = container.querySelector("#occ-apply-custom-date");

  const hideCustomModal = () => {
    if (customModal) customModal.style.display = "none";
  };

  if (closeDateModal) closeDateModal.addEventListener("click", hideCustomModal);
  if (cancelDateModal) cancelDateModal.addEventListener("click", hideCustomModal);
  if (applyDateModal) {
    applyDateModal.addEventListener("click", () => {
      const from = document.getElementById("occ-custom-from")?.value;
      const to = document.getElementById("occ-custom-to")?.value;
      if (!from || !to) {
        showToast("Please specify both From and To dates.", "error");
        return;
      }
      if (new Date(from) > new Date(to)) {
        showToast("From Date cannot be later than To Date.", "error");
        return;
      }
      ownerDashboardState.customFrom = from;
      ownerDashboardState.customTo = to;
      ownerDashboardState.period = "custom";
      container.querySelectorAll(".occ-period-btn").forEach((b) => b.classList.remove("active"));
      container.querySelector("#occ-custom-date-btn")?.classList.add("active");
      hideCustomModal();
      loadDashboardData();
    });
  }

  // 4. Comparison Selector
  const compSelect = container.querySelector("#occ-comparison-select");
  if (compSelect) {
    compSelect.addEventListener("change", (e) => {
      ownerDashboardState.comparison = e.target.value;
      loadDashboardData();
    });
  }

  // 5. Saved Views
  loadSavedViews();
  const saveViewBtn = container.querySelector("#occ-save-view-btn");
  const saveModal = container.querySelector("#occ-save-view-modal");
  const closeSaveModal = container.querySelector("#occ-close-save-modal");
  const cancelSaveModal = container.querySelector("#occ-cancel-save-view");
  const confirmSaveModal = container.querySelector("#occ-confirm-save-view");
  const savedViewsSelect = container.querySelector("#occ-saved-views-select");

  if (saveViewBtn) {
    saveViewBtn.addEventListener("click", () => {
      if (saveModal) saveModal.style.display = "flex";
    });
  }
  const hideSaveModal = () => {
    if (saveModal) saveModal.style.display = "none";
  };
  if (closeSaveModal) closeSaveModal.addEventListener("click", hideSaveModal);
  if (cancelSaveModal) cancelSaveModal.addEventListener("click", hideSaveModal);
  if (confirmSaveModal) {
    confirmSaveModal.addEventListener("click", async () => {
      const name = document.getElementById("occ-new-view-name")?.value;
      const isDefault = document.getElementById("occ-new-view-default")?.checked;
      if (!name || !name.trim()) {
        showToast("Please enter a name for the saved view.", "error");
        return;
      }
      try {
        const res = await apiPost("/dashboard/saved-views", {
          name: name.trim(),
          isDefault: Boolean(isDefault),
          filters: {
            cafeIds: ownerDashboardState.selectedCafeId ? [ownerDashboardState.selectedCafeId] : [],
            period: ownerDashboardState.period,
            customFrom: ownerDashboardState.customFrom,
            customTo: ownerDashboardState.customTo,
            comparison: ownerDashboardState.comparison,
          },
        });
        if (res && res.success) {
          showToast(`View "${name}" saved successfully!`, "success");
          hideSaveModal();
          loadSavedViews();
        } else {
          showToast(res?.message || "Failed to save view.", "error");
        }
      } catch (err) {
        showToast(err.message || "Failed to save view.", "error");
      }
    });
  }

  if (savedViewsSelect) {
    savedViewsSelect.addEventListener("change", (e) => {
      const viewId = e.target.value;
      if (!viewId) return;
      const view = ownerDashboardState.savedViews.find(v => v.savedViewId === viewId);
      if (view && view.filters) {
        ownerDashboardState.activeSavedViewId = viewId;
        ownerDashboardState.period = view.filters.period || "today";
        ownerDashboardState.comparison = view.filters.comparison || "previous_period";
        ownerDashboardState.customFrom = view.filters.customFrom || null;
        ownerDashboardState.customTo = view.filters.customTo || null;
        ownerDashboardState.selectedCafeId = Array.isArray(view.filters.cafeIds) && view.filters.cafeIds.length > 0 ? view.filters.cafeIds[0] : "";
        
        // Update UI controls
        container.querySelectorAll(".occ-period-btn").forEach(b => {
          b.classList.toggle("active", b.dataset.period === ownerDashboardState.period);
        });
        if (compSelect) compSelect.value = ownerDashboardState.comparison;
        if (cafeFilter) cafeFilter.value = ownerDashboardState.selectedCafeId;
        
        loadDashboardData();
        showToast(`Loaded saved view: ${view.name}`, "info");
      }
    });
  }

  // 6. Live Refresh Toggle
  const liveToggleBtn = container.querySelector("#occ-live-toggle-btn");
  if (liveToggleBtn) {
    liveToggleBtn.addEventListener("click", () => {
      ownerDashboardState.liveRefreshEnabled = !ownerDashboardState.liveRefreshEnabled;
      liveToggleBtn.className = `btn btn-sm ${ownerDashboardState.liveRefreshEnabled ? 'btn-primary' : 'btn-secondary'}`;
      liveToggleBtn.innerHTML = `
        <span class="live-indicator ${ownerDashboardState.liveRefreshEnabled ? 'active' : ''}"></span>
        ${ownerDashboardState.liveRefreshEnabled ? 'LIVE' : 'PAUSED'}
      `;
      showToast(ownerDashboardState.liveRefreshEnabled ? "Live 30s refresh enabled." : "Live refresh paused.", "info");
    });
  }

  // 7. Manual Refresh Button
  const refreshBtn = container.querySelector("#occ-refresh-btn");
  if (refreshBtn) {
    refreshBtn.addEventListener("click", () => {
      loadDashboardData();
      showToast("Refreshing Owner Command Centre...", "info");
    });
  }

  // 8. Strategic Shortcut Buttons
  container.querySelectorAll(".occ-shortcut-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const route = btn.dataset.route;
      const anchor = btn.dataset.anchor;
      if (btn.id === "occ-btn-manage-drawers-shortcut") {
        openCashDrawerManagement();
      } else if (btn.id === "occ-btn-daily-close-shortcut") {
        openDailyClosePacksModal();
      } else if (route) {
        navigate(route);
      } else if (anchor) {
        const el = document.getElementById(anchor);
        if (el) el.scrollIntoView({ behavior: "smooth" });
      }
    });
  });

  // 9. Initial Data Load & Wiring
  wireDashboardBodyActions(container, DEFAULT_OWNER_DASHBOARD_DATA);
  loadDashboardData();

  // 10. Live Refresh Interval (30s)
  if (ownerDashboardState.refreshTimer) clearInterval(ownerDashboardState.refreshTimer);
  ownerDashboardState.refreshTimer = setInterval(() => {
    if (ownerDashboardState.liveRefreshEnabled && document.getElementById("owner-command-centre")) {
      loadDashboardData(true);
    }
  }, 30000);
}

// ─── Data Fetching ────────────────────────────────────────────────────────────

async function loadSavedViews() {
  try {
    const res = await apiGet("/dashboard/saved-views");
    if (res && res.success && res.data && res.data.views) {
      ownerDashboardState.savedViews = res.data.views;
      const sel = document.getElementById("occ-saved-views-select");
      if (sel) {
        sel.innerHTML = `
          <option value="">Views...</option>
          ${ownerDashboardState.savedViews.map(v => `
            <option value="${v.savedViewId}" ${ownerDashboardState.activeSavedViewId === v.savedViewId ? 'selected' : ''}>
              ${v.name} ${v.isDefault ? '(Default)' : ''}
            </option>
          `).join('')}
        `;
      }
    }
  } catch (err) {
    console.warn("Could not load saved views:", err);
  }
}

export const DEFAULT_OWNER_DASHBOARD_DATA = {
  meta: {
    activeCafes: 0,
    totalEmployees: 0,
    generatedAt: new Date().toISOString()
  },
  portfolioKpis: {
    salesTotal: { valuePaisa: 0, deltaPercent: 0, comparisonPaisa: 0 },
    totalOrders: { value: 0, deltaPercent: 0 },
    aov: { valuePaisa: 0, deltaPercent: 0 },
    expenses: { valuePaisa: 0, deltaPercent: 0 },
    staffPresent: { value: 0, scheduled: 0 },
    stockRisk: { critical: 0, belowPar: 0 },
    openActions: { value: 0 }
  },
  whatChanged: [],
  attentionQueue: [],
  revenueTrend: [],
  cafePerformanceCards: [],
  financialControl: {
    cashDrawer: {
      openDrawers: 0,
      unreconciledDrawers: 0,
      totalVariancePaisa: 0
    },
    personalLedger: {
      pendingReimbursementsPaisa: 0,
      netPersonalBalancePaisa: 0
    },
    paymentMix: {
      upi: 0,
      card: 0,
      cash: 0
    },
    reconciliationWatch: {
      bankStatus: "MATCHED",
      eodStatus: "BALANCED"
    }
  },
  operationalSnapshot: {
    attendance: {
      staffPresent: 0,
      staffAbsent: 0,
      attendanceExceptions: 0
    },
    inventory: {
      critical: 0,
      belowPar: 0,
      wastageCostPaisa: 0
    },
    facilities: {
      maintenanceOpen: 0
    }
  },
  commercialMix: {
    topMenuItems: [],
    categoryMix: []
  },
  systemRisk: {
    incidentsP0: 0,
    posUptimePct: 100.0,
    deviceTrust: "ALL_SECURE"
  }
};

function hydrateCafeFilterOptions(cafes) {
  const sel = document.getElementById("occ-cafe-filter");
  if (!sel || !Array.isArray(cafes) || cafes.length === 0) return;
  const existingOptions = Array.from(sel.options).map((o) => o.value);
  const existingSet = new Set(existingOptions);
  let needsRebuild = false;
  for (const c of cafes) {
    if (!existingSet.has(c.cafeId)) {
      needsRebuild = true;
      break;
    }
  }
  if (needsRebuild) {
    let html = '<option value="">All Cafés (Authorized Portfolio)</option>';
    for (const c of cafes) {
      const isSel = ownerDashboardState.selectedCafeId === c.cafeId ? 'selected' : '';
      html += `<option value="${c.cafeId}" ${isSel}>${c.name} (${c.cafeId})</option>`;
    }
    sel.innerHTML = html;
  }
  sel.value = ownerDashboardState.selectedCafeId || '';
}

async function loadDashboardData(isBackground = false) {
  const contentEl = document.getElementById("occ-content");
  if (!contentEl) return;

  if (!isBackground && !ownerDashboardState.data) {
    // Immediately render baseline state on initial mount
    const initialFallback = JSON.parse(JSON.stringify(DEFAULT_OWNER_DASHBOARD_DATA));
    ownerDashboardState.data = initialFallback;
    updateHealthStrip(initialFallback);
    renderDashboardBody(contentEl, initialFallback);
  }

  try {
    const params = new URLSearchParams();
    params.set("period", ownerDashboardState.period);
    params.set("comparison", ownerDashboardState.comparison);
    if (ownerDashboardState.selectedCafeId) params.set("cafeId", ownerDashboardState.selectedCafeId);
    if (ownerDashboardState.customFrom) params.set("customFrom", ownerDashboardState.customFrom);
    if (ownerDashboardState.customTo) params.set("customTo", ownerDashboardState.customTo);

    const res = await apiGet(`/dashboard?${params.toString()}`);
    if (res && res.success && res.data) {
      ownerDashboardState.data = res.data;
      if (res.data.cafePerformanceCards && res.data.cafePerformanceCards.length > 0) {
        state.assignedCafes = res.data.cafePerformanceCards;
        hydrateCafeFilterOptions(res.data.cafePerformanceCards);
      }
      updateHealthStrip(res.data);
      renderDashboardBody(contentEl, res.data);
      const freshness = document.getElementById("occ-freshness");
      if (freshness) freshness.textContent = `Updated: ${new Date().toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", second: "2-digit" })} IST`;

      // A090: Load Action-Needed Compliance & Section 194-O TDS Summary
      try {
        const actRes = await apiGet('/analytics/action-needed');
        const actData = actRes?.data || actRes;
        if (actData) {
          const hsnEl = container.querySelector('#occ-compliance-missing-hsn-count');
          const ecomEl = container.querySelector('#occ-compliance-gross-ecom-sales');
          const tdsEl = container.querySelector('#occ-compliance-tds-liability');
          if (hsnEl) {
            const count = actData.missingTaxOrHsnCount || 0;
            hsnEl.textContent = `${count} Items`;
            hsnEl.style.color = count > 0 ? 'var(--danger)' : 'var(--success)';
          }
          if (ecomEl && actData.ecomTdsSummary) {
            ecomEl.textContent = `₹${(Number(actData.ecomTdsSummary.grossSalesPaisa || 0) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
          }
          if (tdsEl && actData.ecomTdsSummary) {
            tdsEl.textContent = `₹${(Number(actData.ecomTdsSummary.tdsAmountPaisa || 0) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
          }
        }
      } catch (_) {}
    } else {
      const fallback = JSON.parse(JSON.stringify(DEFAULT_OWNER_DASHBOARD_DATA));
      ownerDashboardState.data = fallback;
      updateHealthStrip(fallback);
      renderDashboardBody(contentEl, fallback);
    }
  } catch (err) {
    console.warn("Owner Dashboard live fetch unavailable, using baseline:", err.message);
    const fallback = JSON.parse(JSON.stringify(DEFAULT_OWNER_DASHBOARD_DATA));
    ownerDashboardState.data = fallback;
    updateHealthStrip(fallback);
    renderDashboardBody(contentEl, fallback);
  }
}

// ─── Health Strip Updater ─────────────────────────────────────────────────────

function updateHealthStrip(data) {
  const kpis = data.portfolioKpis || {};
  const attention = data.attentionQueue || [];
  const meta = data.meta || {};

  const elCafes = document.getElementById("occ-hs-cafes");
  const elStaff = document.getElementById("occ-hs-staff");
  const elExceptions = document.getElementById("occ-hs-exceptions");
  const elStock = document.getElementById("occ-hs-stock");
  const elPos = document.getElementById("occ-hs-pos");

  if (elCafes) elCafes.textContent = `${meta.activeCafes || (state.assignedCafes || []).length || 1} Operating`;
  if (elStaff) elStaff.textContent = `${kpis.staffPresent?.value || 0} / ${kpis.staffPresent?.scheduled || 0} Present`;
  if (elExceptions) {
    elExceptions.textContent = `${attention.length} Item(s)`;
    const dot = document.getElementById("occ-hs-dot-exceptions");
    if (dot) dot.className = `occ-hs-dot ${attention.length > 0 ? 'warning' : 'online'}`;
  }
  if (elStock) {
    const crit = kpis.stockRisk?.critical || 0;
    elStock.textContent = `${crit} Critical`;
    const dot = document.getElementById("occ-hs-dot-stock");
    if (dot) dot.className = `occ-hs-dot ${crit > 0 ? 'critical' : 'online'}`;
  }
  if (elPos) elPos.textContent = "100% Online";
}

// ─── Body Rendering ───────────────────────────────────────────────────────────

export function renderDashboardBodyHtml(data) {
  const kpis = data.portfolioKpis || {};
  const cafes = data.cafePerformanceCards || [];
  const whatChanged = data.whatChanged || [];
  const attention = data.attentionQueue || [];
  const trend = data.revenueTrend || [];
  const financial = data.financialControl || {};
  const ops = data.operationalSnapshot || {};
  const commercial = data.commercialMix || {};
  const systemRisk = data.systemRisk || {};

  // Compute key ratios safely
  const grossSalesPaisa = kpis.salesTotal?.valuePaisa || 0;
  const compSalesPaisa = kpis.salesTotal?.comparisonPaisa || 0;
  const expensePaisa = kpis.expenses?.valuePaisa || 0;
  const expenseRatioPct = grossSalesPaisa > 0 && expensePaisa > 0 ? Math.round((expensePaisa / grossSalesPaisa) * 100) : 0;
  const salesDeltaPct = kpis.salesTotal?.deltaPercent;

  // Cash Drawer & Variance
  const cashSummary = financial.cashDrawer || {};
  const totalVariancePaisa = cashSummary.totalVariancePaisa || 0;
  const unreconciledDrawers = cashSummary.unreconciledDrawers || 0;

  // Personal Ledger
  const ledgerSummary = financial.personalLedger || {};

  return `
    <!-- Layer 2: Executive Business Summary (KPIs) -->
    <div class="occ-kpi-grid">
      <!-- 1. Net Completed Sales -->
      <div class="occ-kpi-card occ-kpi-clickable" tabindex="0" role="button" aria-label="View Bills and Sales Overview" data-drill-down="bills">
        <div class="occ-kpi-header">
          <span class="occ-kpi-label">Gross Portfolio Sales</span>
          <span class="occ-kpi-icon">${icon("pos", 18)}</span>
        </div>
        <div class="occ-kpi-value">${fmtInr(grossSalesPaisa)}</div>
        <div class="occ-kpi-footer">
          ${salesDeltaPct !== null && salesDeltaPct !== undefined ? `
            <span class="occ-trend ${salesDeltaPct >= 0 ? 'positive' : 'negative'}">
              ${salesDeltaPct >= 0 ? '↑ +' : '↓ '}${salesDeltaPct}%
            </span> vs prior
          ` : '<span class="occ-muted">Current period</span>'}
          <span class="occ-dot">·</span>
          <span>${fmtNum(kpis.totalOrders?.value || 0)} orders</span>
        </div>
      </div>

      <!-- 2. Operating Expense Ratio -->
      <div class="occ-kpi-card occ-kpi-clickable" tabindex="0" role="button" aria-label="View Finance Summary and Operating Expenses" data-drill-down="finance">
        <div class="occ-kpi-header">
          <span class="occ-kpi-label">Operating Expense Ratio</span>
          <span class="occ-kpi-icon">${icon("finance", 18)}</span>
        </div>
        <div class="occ-kpi-value">${expenseRatioPct}%</div>
        <div class="occ-kpi-footer">
          <span>${fmtInr(expensePaisa)} total spend</span>
          <span class="occ-dot">·</span>
          <span class="${expenseRatioPct > 35 ? 'text-amber-500' : 'text-emerald-500'}">
            ${expenseRatioPct > 35 ? 'Moderate cost' : 'Controlled'}
          </span>
        </div>
      </div>

      <!-- 3. Cash Drawer Variance -->
      <div class="occ-kpi-card occ-kpi-clickable" tabindex="0" role="button" aria-label="Open Cash Drawer Management" data-drill-down="drawer-modal">
        <div class="occ-kpi-header">
          <span class="occ-kpi-label">Cash Variance & Drawers</span>
          <span class="occ-kpi-icon">${icon("pos", 18)}</span>
        </div>
        <div class="occ-kpi-value ${totalVariancePaisa !== 0 ? 'text-amber-500' : 'text-emerald-500'}">
          ${fmtInr(totalVariancePaisa)}
        </div>
        <div class="occ-kpi-footer">
          <span>${cashSummary.openDrawers || 0} active</span>
          <span class="occ-dot">·</span>
          <span class="${unreconciledDrawers > 0 ? 'text-amber-500' : 'occ-muted'}">
            ${unreconciledDrawers} unreconciled
          </span>
        </div>
      </div>

      <!-- 4. Workforce Presence & Attendance -->
      <div class="occ-kpi-card occ-kpi-clickable" tabindex="0" role="button" aria-label="View Workforce Attendance" data-drill-down="attendance">
        <div class="occ-kpi-header">
          <span class="occ-kpi-label">Workforce on Duty</span>
          <span class="occ-kpi-icon">${icon("employees", 18)}</span>
        </div>
        <div class="occ-kpi-value">
          ${kpis.staffPresent?.value || 0} <span class="occ-val-sub">/ ${kpis.staffPresent?.scheduled || 0}</span>
        </div>
        <div class="occ-kpi-footer">
          <span>${ops.attendance?.attendanceExceptions || 0} exceptions</span>
          <span class="occ-dot">·</span>
          <span class="text-emerald-500">Live rostered</span>
        </div>
      </div>

      <!-- 5. Inventory Stock Risk -->
      <div class="occ-kpi-card occ-kpi-clickable" tabindex="0" role="button" aria-label="View Inventory Reports" data-drill-down="reports">
        <div class="occ-kpi-header">
          <span class="occ-kpi-label">Stockout / Risk SKUs</span>
          <span class="occ-kpi-icon">${icon("inventory", 18)}</span>
        </div>
        <div class="occ-kpi-value ${kpis.stockRisk?.critical > 0 ? 'text-rose-500' : 'text-emerald-500'}">
          ${kpis.stockRisk?.critical || 0} <span class="occ-val-sub">critical</span>
        </div>
        <div class="occ-kpi-footer">
          <span>${kpis.stockRisk?.belowPar || 0} below par</span>
          <span class="occ-dot">·</span>
          <span>${kpis.stockRisk?.critical === 0 ? 'Stable coverage' : 'Attention required'}</span>
        </div>
      </div>

      <!-- 6. Critical Business Exceptions -->
      <div class="occ-kpi-card occ-kpi-clickable" tabindex="0" role="button" aria-label="Scroll to Management Exceptions Queue" data-drill-down="attention-section">
        <div class="occ-kpi-header">
          <span class="occ-kpi-label">Management Exceptions</span>
          <span class="occ-kpi-icon">${icon("tasks", 18)}</span>
        </div>
        <div class="occ-kpi-value ${attention.length > 0 ? 'text-amber-500' : 'text-emerald-500'}">
          ${attention.length}
        </div>
        <div class="occ-kpi-footer">
          <span>${attention.filter(a => a.severity === 'CRITICAL').length} critical</span>
          <span class="occ-dot">·</span>
          <span class="occ-link">View Queue</span>
        </div>
      </div>
    </div>

    <!-- Layer 3: What Changed Executive Digest -->
    <div class="occ-section-card mt-6">
      <div class="occ-card-header">
        <div class="occ-card-title">
          ${icon("reports", 18)}
          <span>What Changed — Executive Digest</span>
        </div>
        <span class="occ-tag">Deterministic Comparison</span>
      </div>
      <div class="occ-digest-grid">
        ${whatChanged.map(item => `
          <div class="occ-digest-item ${item.type.toLowerCase()}">
            <span class="occ-digest-icon">${item.type === 'POSITIVE' ? '✓' : item.type === 'CRITICAL' ? '!' : '•'}</span>
            <span class="occ-digest-text">${item.text}</span>
          </div>
        `).join('')}
      </div>
    </div>

    <!-- Layer 4: Attention Required Queue -->
    <div id="attention-section" class="occ-section-card mt-6">
      <div class="occ-card-header">
        <div class="occ-card-title">
          ${icon("tasks", 18)}
          <span>Attention Required</span>
        </div>
        <span class="occ-tag">${attention.length} Item(s)</span>
      </div>
      <div class="occ-attention-list">
        ${attention.length === 0 ? `
          <div class="occ-empty-state">
            <span class="occ-empty-icon">✓</span>
            <div class="occ-empty-title">All Clear</div>
            <p class="occ-empty-desc">No material business exceptions require your attention for the selected period.</p>
          </div>
        ` : attention.map(item => `
          <div class="occ-attention-row ${item.severity.toLowerCase()}">
            <div class="occ-attention-badge ${item.severity.toLowerCase()}">${item.severity}</div>
            <div class="occ-attention-main">
              <div class="occ-attention-title">${item.title}</div>
              <div class="occ-attention-desc">${item.description}</div>
            </div>
            <button class="btn btn-secondary btn-xs occ-nav-btn" data-route="${item.route || 'dashboard'}">
              View Details →
            </button>
          </div>
        `).join('')}
      </div>
    </div>

    <!-- Layer 5: Revenue & Commercial Trend [ Chart | Data ] -->
    <div class="occ-section-card mt-6">
      <div class="occ-card-header">
        <div class="occ-card-title">
          ${icon("pos", 18)}
          <span>Portfolio Revenue Trajectory</span>
        </div>
        <div class="occ-view-switch">
          <button class="occ-switch-btn ${ownerDashboardState.trendViewMode === 'chart' ? 'active' : ''}" id="occ-btn-chart">Chart</button>
          <button class="occ-switch-btn ${ownerDashboardState.trendViewMode === 'data' ? 'active' : ''}" id="occ-btn-data">Data Table</button>
        </div>
      </div>
      <div id="occ-trend-container" class="occ-trend-content">
        ${ownerDashboardState.trendViewMode === 'chart' ? renderTrendChart(trend) : renderTrendTable(trend)}
      </div>
    </div>

    <!-- Statutory Compliance & Section 194-O TDS Action Card (A090) -->
    <div class="card occ-section-card mt-6" id="occ-compliance-action-mount" style="padding:18px 22px;border:1px solid #e2e8f0;background:linear-gradient(135deg, rgba(212,175,55,0.04) 0%, rgba(255,255,255,1) 100%);">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;flex-wrap:wrap;gap:10px;">
        <div style="display:flex;align-items:center;gap:8px;">
          <span style="font-size:18px;">⚖️</span>
          <div>
            <h2 style="font-size:15px;font-weight:700;margin:0;color:var(--ink);">
              Statutory Compliance &amp; Section 194-O TDS Oversight (A090)
            </h2>
            <p style="font-size:11.5px;color:var(--muted);margin:0;">
              E-Commerce Operator TDS liability (1.0%) across aggregators and menu catalogue GST HSN classification.
            </p>
          </div>
        </div>
      </div>
      <div id="occ-compliance-action-content" style="display:grid;grid-template-columns:repeat(auto-fit, minmax(240px, 1fr));gap:12px;">
        <div style="padding:12px;background:var(--surface);border-radius:8px;border:1px solid var(--line);">
          <div style="font-size:11px;color:var(--muted);font-weight:700;text-transform:uppercase;">Missing HSN / Tax Items</div>
          <div style="font-size:20px;font-weight:800;color:var(--danger);font-family:var(--font-mono);margin:4px 0;" id="occ-compliance-missing-hsn-count">0 Items</div>
          <div style="font-size:11px;color:var(--muted);">All active menu items verified.</div>
        </div>
        <div style="padding:12px;background:var(--surface);border-radius:8px;border:1px solid var(--line);">
          <div style="font-size:11px;color:var(--muted);font-weight:700;text-transform:uppercase;">Aggregator Gross E-Com Sales</div>
          <div style="font-size:20px;font-weight:800;color:var(--ink);font-family:var(--font-mono);margin:4px 0;" id="occ-compliance-gross-ecom-sales">₹0.00</div>
          <div style="font-size:11px;color:var(--muted);">Turnover via Zomato, Swiggy &amp; Toing.</div>
        </div>
        <div style="padding:12px;background:rgba(212,175,55,0.08);border-radius:8px;border:1px solid rgba(212,175,55,0.3);">
          <div style="font-size:11px;color:#8C6D1F;font-weight:700;text-transform:uppercase;">Section 194-O TDS Liability (1.0%)</div>
          <div style="font-size:20px;font-weight:800;color:#8C6D1F;font-family:var(--font-mono);margin:4px 0;" id="occ-compliance-tds-liability">₹0.00</div>
          <div style="font-size:11px;color:var(--muted);">E-commerce operator statutory deduction pool.</div>
        </div>
      </div>
    </div>

    <!-- Layer 6: Multi-Café Business Health Breakdown Cards & Table -->
    <div class="occ-section-card mt-6">
      <div class="occ-card-header" style="margin-bottom:16px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;">
        <div class="occ-card-title">
          ${icon("reports", 18)}
          <span>Multi-Location Performance &amp; Health Breakdown</span>
        </div>
        <div style="display:flex;gap:10px;align-items:center;">
          <span class="occ-tag">${cafes.length} Authorized Locations</span>
          <button class="btn btn-sm btn-primary" id="occ-btn-add-cafe" type="button" style="font-weight:700;">
            + Add New Café
          </button>
        </div>
      </div>

      <!-- Location Cards Grid matching Reference HRIS standard -->
      <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap:16px; margin-bottom:20px;">
        ${cafes.map(cafe => {
          const targetPct = cafe.targetAchievementPct !== null && cafe.targetAchievementPct !== undefined ? cafe.targetAchievementPct : 0;
          const targetBarColor = targetPct >= 90 ? "var(--bronze-500)" : targetPct >= 70 ? "var(--bronze-400)" : "var(--danger)";
          return `
            <div style="background:var(--surface); border:1px solid var(--line); border-radius:12px; padding:18px; box-shadow:var(--shadow-xs); display:flex; flex-direction:column; justify-content:space-between;">
              <div>
                <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:12px;">
                  <div>
                    <h3 style="font-size:15.5px; font-weight:700; margin:0; color:var(--ink);">${cafe.name}</h3>
                    <span style="font-size:11.5px; color:var(--muted);">${cafe.cafeId} · ${cafe.city || 'Kerala'}</span>
                  </div>
                  <span class="occ-health-pill ${cafe.health?.toLowerCase()}" style="font-size:10.5px; font-weight:700;">
                    ${cafe.health}
                  </span>
                </div>

                <!-- 6 Metric Blocks matching reference HRIS -->
                <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px; font-size:13px; margin-bottom:12px;">
                  <div style="background:var(--surface-sunken); padding:10px 12px; border-radius:8px; border:1px solid var(--line);">
                    <div style="color:var(--muted); font-size:11px; text-transform:uppercase; font-weight:700;">Gross Sales</div>
                    <div style="font-weight:700; font-size:15px; color:var(--ink); margin-top:2px;">${fmtInr(cafe.totalSalesPaisa)}</div>
                  </div>
                  <div style="background:var(--surface-sunken); padding:10px 12px; border-radius:8px; border:1px solid var(--line);">
                    <div style="color:var(--muted); font-size:11px; text-transform:uppercase; font-weight:700;">Completed Orders</div>
                    <div style="font-weight:700; font-size:15px; color:var(--ink); margin-top:2px;">${fmtNum(cafe.totalOrders)}</div>
                  </div>
                  <div style="background:var(--surface-sunken); padding:10px 12px; border-radius:8px; border:1px solid var(--line);">
                    <div style="color:var(--muted); font-size:11px; text-transform:uppercase; font-weight:700;">Average Bill</div>
                    <div style="font-weight:700; font-size:15px; color:var(--bronze-600); margin-top:2px;">${fmtInr(cafe.aovPaisa)}</div>
                  </div>
                  <div style="background:var(--surface-sunken); padding:10px 12px; border-radius:8px; border:1px solid var(--line);">
                    <div style="color:var(--muted); font-size:11px; text-transform:uppercase; font-weight:700;">Stock Risks</div>
                    <div style="font-weight:700; font-size:15px; color:${cafe.inventoryCritical > 0 ? 'var(--danger)' : 'var(--ink)'}; margin-top:2px;">
                      ${cafe.inventoryCritical > 0 ? `${cafe.inventoryCritical} Critical` : 'Stable'}
                    </div>
                  </div>
                  <div style="background:var(--surface-sunken); padding:10px 12px; border-radius:8px; border:1px solid var(--line);">
                    <div style="color:var(--muted); font-size:11px; text-transform:uppercase; font-weight:700;">Target Pace</div>
                    <div style="font-weight:700; font-size:15px; color:var(--ink); margin-top:2px;">${targetPct}%</div>
                  </div>
                  <div style="background:var(--surface-sunken); padding:10px 12px; border-radius:8px; border:1px solid var(--line);">
                    <div style="color:var(--muted); font-size:11px; text-transform:uppercase; font-weight:700;">Maintenance</div>
                    <div style="font-weight:700; font-size:15px; color:${cafe.maintenanceOpen > 0 ? '#f59e0b' : 'var(--ink)'}; margin-top:2px;">
                      ${cafe.maintenanceOpen || 0} Open
                    </div>
                  </div>
                </div>

                <!-- Target Progress Bar -->
                <div style="background:var(--surface-sunken); padding:10px 12px; border-radius:8px; border:1px solid var(--line); margin-bottom:12px;">
                  <div style="display:flex; justify-content:space-between; font-size:11.5px; margin-bottom:4px;">
                    <span style="color:var(--muted); font-weight:600;">Performance Target</span>
                    <strong style="color:var(--ink);">${targetPct}% Complete</strong>
                  </div>
                  <div style="width:100%; height:6px; background:var(--line); border-radius:3px; overflow:hidden;">
                    <div style="width:${Math.min(targetPct, 100)}%; height:100%; background:${targetBarColor}; border-radius:3px;"></div>
                  </div>
                </div>
              </div>

              <div style="margin-top:6px; padding-top:10px; border-top:1px solid var(--line); display:flex; gap:8px;">
                <button class="btn btn-ghost occ-filter-cafe-btn" data-cafe-id="${cafe.cafeId}" style="flex:1; font-size:12px; font-weight:600; justify-content:center;" type="button">
                  Focus Portfolio →
                </button>
                <button class="btn btn-secondary occ-access-cafe-btn" data-access-cafe="${cafe.cafeId}" style="font-size:12px; font-weight:700; color:var(--bronze-500);" type="button" title="Manage Café Operations Access">
                  Access
                </button>
              </div>
            </div>
          `;
        }).join('')}
      </div>

      <!-- Detail Table Accordion -->
      <div class="occ-table-responsive">
        <table class="occ-table">
          <thead>
            <tr>
              <th>Café Location</th>
              <th>Health State</th>
              <th>Sales Total</th>
              <th>Orders</th>
              <th>AOV</th>
              <th>Target Pace</th>
              <th>Stock Risks</th>
              <th>Maintenance</th>
            </tr>
          </thead>
          <tbody>
            ${cafes.length === 0 ? `
              <tr><td colspan="8" class="text-center py-6 text-slate-400">No café locations found in current scope.</td></tr>
            ` : cafes.map(cafe => `
              <tr>
                <td>
                  <div class="font-semibold text-slate-100">${cafe.name}</div>
                  <div class="text-xs text-slate-400">${cafe.city || 'Kerala'} · ${cafe.cafeId}</div>
                </td>
                <td>
                  <span class="occ-health-pill ${cafe.health?.toLowerCase()}" title="${getHealthExplanation(cafe)}">
                    ${cafe.health}
                  </span>
                </td>
                <td class="font-medium text-slate-100">${fmtInr(cafe.totalSalesPaisa)}</td>
                <td>${fmtNum(cafe.totalOrders)}</td>
                <td>${fmtInr(cafe.aovPaisa)}</td>
                <td>
                  ${cafe.targetAchievementPct !== null ? `
                    <div class="occ-target-pace">
                      <span>${cafe.targetAchievementPct}%</span>
                      <div class="occ-pace-bar"><div class="occ-pace-fill" style="width: ${Math.min(100, cafe.targetAchievementPct)}%"></div></div>
                    </div>
                  ` : '<span class="text-slate-500">—</span>'}
                </td>
                <td>
                  ${cafe.inventoryCritical > 0 ? `
                    <span class="text-rose-400 font-semibold">${cafe.inventoryCritical} Critical</span>
                  ` : '<span class="text-emerald-400">Stable</span>'}
                </td>
                <td>
                  ${cafe.maintenanceOpen > 0 ? `
                    <span class="text-amber-400">${cafe.maintenanceOpen} Open</span>
                  ` : '<span class="text-slate-500">0</span>'}
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>

    <!-- Layer 7: Financial Control & Strategic Signals -->
    <div class="grid grid-cols-1 md:grid-cols-2 gap-6 mt-6">
      <!-- Cash Drawer Management Card -->
      <div class="occ-section-card">
        <div class="occ-card-header">
          <div class="occ-card-title">
            ${icon("pos", 18)}
            <span>Cash & Drawer Control</span>
          </div>
          <button class="btn btn-outline btn-xs" id="occ-btn-open-drawer-modal">Manage Drawers →</button>
        </div>
        <div class="occ-control-metrics">
          <div class="occ-control-metric">
            <span class="occ-cm-label">Active Drawers</span>
            <span class="occ-cm-val">${cashSummary.openDrawers || 0}</span>
          </div>
          <div class="occ-control-metric">
            <span class="occ-cm-label">Unreconciled</span>
            <span class="occ-cm-val ${unreconciledDrawers > 0 ? 'text-amber-500' : 'text-emerald-500'}">${unreconciledDrawers}</span>
          </div>
          <div class="occ-control-metric">
            <span class="occ-cm-label">Expected Cash</span>
            <span class="occ-cm-val">${fmtInr(cashSummary.totalExpectedCashPaisa)}</span>
          </div>
          <div class="occ-control-metric">
            <span class="occ-cm-label">Total Variance</span>
            <span class="occ-cm-val ${totalVariancePaisa !== 0 ? 'text-amber-500' : 'text-emerald-500'}">${fmtInr(totalVariancePaisa)}</span>
          </div>
        </div>
      </div>

      <!-- Personal Ledger Card -->
      <div class="occ-section-card">
        <div class="occ-card-header">
          <div class="occ-card-title">
            ${icon("ledger", 18)}
            <span>Personal Ledger & Owner Account</span>
          </div>
          <button class="btn btn-outline btn-xs occ-nav-btn" data-route="ledger">View Ledger →</button>
        </div>
        <div class="occ-control-metrics">
          <div class="occ-control-metric">
            <span class="occ-cm-label">Current Balance</span>
            <span class="occ-cm-val text-emerald-400 font-bold">${fmtInr(ledgerSummary.currentBalancePaisa || 0)}</span>
          </div>
          <div class="occ-control-metric">
            <span class="occ-cm-label">Credits Recorded</span>
            <span class="occ-cm-val">${fmtInr(ledgerSummary.totalCreditPaisa || 0)}</span>
          </div>
          <div class="occ-control-metric">
            <span class="occ-cm-label">Debits Recorded</span>
            <span class="occ-cm-val">${fmtInr(ledgerSummary.totalDebitPaisa || 0)}</span>
          </div>
          <div class="occ-control-metric">
            <span class="occ-cm-label">Total Ledger Entries</span>
            <span class="occ-cm-val">${ledgerSummary.totalEntries || 0}</span>
          </div>
        </div>
      </div>
    </div>

    <!-- Payment Mix & Reconciliation Watch -->
    <div class="grid grid-cols-1 md:grid-cols-2 gap-6 mt-6">
      <!-- Payment Method Mix -->
      <div class="occ-section-card">
        <div class="occ-card-header">
          <div class="occ-card-title">
            ${icon("pos", 18)}
            <span>Collection & Payment Mix</span>
          </div>
          <span class="occ-tag">${fmtInr(financial.paymentMix?.totalPaisa || grossSalesPaisa)} Total</span>
        </div>
        <div class="occ-payment-mix-list">
          ${(financial.paymentMix?.methods && financial.paymentMix.methods.length > 0) ? financial.paymentMix.methods.map(m => `
            <div class="occ-pm-row">
              <div class="occ-pm-header">
                <span class="font-semibold text-slate-200">${m.method}</span>
                <span class="text-amber-400 font-medium">${fmtInr(m.totalPaisa)} (${m.sharePct}%)</span>
              </div>
              <div class="occ-pace-bar mt-1"><div class="occ-pace-fill" style="width: ${m.sharePct}%"></div></div>
            </div>
          `).join('') : `
            <div class="p-4 text-center text-slate-400 text-sm">
              <span>No payment transactions recorded for selected scope.</span>
            </div>
          `}
        </div>
      </div>

      <!-- Reconciliation Watch -->
      <div class="occ-section-card">
        <div class="occ-card-header">
          <div class="occ-card-title">
            ${icon("finance", 18)}
            <span>Reconciliation & Financial Integrity</span>
          </div>
          <span class="occ-tag ${unreconciledDrawers > 0 ? 'text-amber-400' : 'text-emerald-400'}">
            ${unreconciledDrawers > 0 ? 'Watch Required' : 'Reconciled'}
          </span>
        </div>
        <div class="occ-control-metrics">
          <div class="occ-control-metric">
            <span class="occ-cm-label">Reconciled Drawers</span>
            <span class="occ-cm-val text-emerald-400">${(cashSummary.totalSessions || 0) - unreconciledDrawers}</span>
          </div>
          <div class="occ-control-metric">
            <span class="occ-cm-label">Unresolved Discrepancies</span>
            <span class="occ-cm-val ${unreconciledDrawers > 0 ? 'text-amber-500' : 'text-emerald-500'}">${unreconciledDrawers}</span>
          </div>
          <div class="occ-control-metric">
            <span class="occ-cm-label">Oldest Variance</span>
            <span class="occ-cm-val">${unreconciledDrawers > 0 ? 'Today' : 'None'}</span>
          </div>
          <div class="occ-control-metric">
            <span class="occ-cm-label">Largest Variance</span>
            <span class="occ-cm-val ${cashSummary.largestVariancePaisa ? 'text-amber-500' : 'text-emerald-500'}">${fmtInr(cashSummary.largestVariancePaisa || 0)}</span>
          </div>
        </div>
      </div>
    </div>

    <!-- Layer 8 & 9: Commercial Velocity & Operational Pulse -->
    <div class="grid grid-cols-1 md:grid-cols-2 gap-6 mt-6">
      <!-- Commercial Velocity: Top 5 Items -->
      <div class="occ-section-card">
        <div class="occ-card-header">
          <div class="occ-card-title">
            ${icon("menuItem", 18)}
            <span>Commercial Velocity — Top Menu Items</span>
          </div>
          <button class="btn btn-outline btn-xs occ-nav-btn" data-route="reports">Sales Mix →</button>
        </div>
        <div class="occ-menu-list">
          ${(commercial.topMenuItems || []).length === 0 ? `
            <div class="occ-empty-state-sm">No transaction items recorded in selected period.</div>
          ` : (commercial.topMenuItems || []).map((item, idx) => `
            <div class="occ-menu-row">
              <div class="occ-menu-rank">#${idx + 1}</div>
              <div class="occ-menu-info">
                <div class="occ-menu-name">${item.itemName || item.name || item.title || item.menuItemId || 'Menu Item'}</div>
                <div class="occ-menu-cat">${item.category || item.categoryName || 'Beverages & Dining'}</div>
              </div>
              <div class="occ-menu-stats">
                <div class="occ-menu-rev">${fmtInr(item.totalRevenuePaisa || 0)}</div>
                <div class="occ-menu-qty">${item.totalQty || 0} sold</div>
              </div>
            </div>
          `).join('')}
        </div>
      </div>

      <!-- Operational Pulse & System Risk -->
      <div class="occ-section-card">
        <div class="occ-card-header">
          <div class="occ-card-title">
            ${icon("settings", 18)}
            <span>System Posture & Operational Risk</span>
          </div>
          <span class="occ-tag text-emerald-400">SECURE</span>
        </div>
        <div class="occ-risk-grid">
          <div class="occ-risk-item">
            <span class="occ-risk-label">P0 / P1 Critical Incidents</span>
            <span class="occ-risk-val text-emerald-400">${systemRisk.p0Incidents || 0}</span>
          </div>
          <div class="occ-risk-item">
            <span class="occ-risk-label">POS Terminal Uptime</span>
            <span class="occ-risk-val text-emerald-400">${systemRisk.posAvailabilityPct || 100}%</span>
          </div>
          <div class="occ-risk-item">
            <span class="occ-risk-label">Pending Dept Orders</span>
            <span class="occ-risk-val">${ops.departmentOrdersPending || 0}</span>
          </div>
          <div class="occ-risk-item">
            <span class="occ-risk-label">Open Facility Jobs</span>
            <span class="occ-risk-val">${ops.maintenanceOpen || 0}</span>
          </div>
        </div>
    </div>
  `;
}

function resolveOwnerNavRoute(route) {
  if (!route) return "dashboard";
  const r = String(route).trim().toLowerCase();
  if (r === "maintenance") return "performance";
  if (r === "quality" || r === "department-orders") return "approvals";
  return r;
}

function wireDashboardBodyActions(container, data) {
  if (!container) return;
  const trend = data?.revenueTrend || [];

  // Wire clickable KPI cards with pointer and keyboard navigation
  container.querySelectorAll(".occ-kpi-clickable").forEach((card) => {
    const handleAction = () => {
      const target = card.dataset.drillDown;
      if (target === "drawer-modal") {
        openCashDrawerManagement();
      } else if (target === "attention-section") {
        const el = document.getElementById("attention-section");
        if (el) el.scrollIntoView({ behavior: "smooth" });
      } else if (target) {
        navigate(resolveOwnerNavRoute(target));
      }
    };
    card.addEventListener("click", handleAction);
    card.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        handleAction();
      }
    });
  });

  // Wire interactive buttons inside body
  container.querySelectorAll(".occ-nav-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const route = resolveOwnerNavRoute(btn.dataset.route);
      if (route) navigate(route);
    });
  });

  const btnManageDrawers = container.querySelector("#occ-btn-open-drawer-modal");
  if (btnManageDrawers) {
    btnManageDrawers.addEventListener("click", () => openCashDrawerManagement());
  }

  const btnChart = container.querySelector("#occ-btn-chart");
  const btnData = container.querySelector("#occ-btn-data");
  if (btnChart && btnData) {
    btnChart.addEventListener("click", () => {
      ownerDashboardState.trendViewMode = "chart";
      btnChart.classList.add("active");
      btnData.classList.remove("active");
      const c = document.getElementById("occ-trend-container");
      if (c) c.innerHTML = renderTrendChart(trend);
    });
    btnData.addEventListener("click", () => {
      ownerDashboardState.trendViewMode = "data";
      btnData.classList.add("active");
      btnChart.classList.remove("active");
      const c = document.getElementById("occ-trend-container");
      if (c) c.innerHTML = renderTrendTable(trend);
    });
  }

  container.querySelectorAll(".occ-filter-cafe-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const cafeId = btn.dataset.cafeId;
      if (cafeId) {
        ownerDashboardState.selectedCafeId = cafeId;
        const sel = document.getElementById("occ-cafe-filter");
        if (sel) sel.value = cafeId;
        loadDashboardData();
        showToast(`Filtered Command Centre to ${cafeId}`, "info");
      }
    });
  });

  const btnAddCafe = container.querySelector("#occ-btn-add-cafe");
  if (btnAddCafe) {
    btnAddCafe.addEventListener("click", () => {
      openCafeCreateModal(container, {
        onSuccess: () => {
          loadDashboardData();
        }
      });
    });
  }

  container.querySelectorAll(".occ-access-cafe-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const cafeId = btn.dataset.accessCafe;
      if (cafeId) {
        openCafeAccessManagementModal(container, cafeId);
      }
    });
  });
}

function renderDashboardBody(container, data) {
  if (!container) return;
  container.innerHTML = renderDashboardBodyHtml(data);
  wireDashboardBodyActions(container, data);
}

// ─── Health State Explanation Helper ──────────────────────────────────────────

function getHealthExplanation(cafe) {
  const reasons = [];
  if (cafe.inventoryCritical > 0) reasons.push(`${cafe.inventoryCritical} critical stockout(s)`);
  if (cafe.maintenanceOpen > 0) reasons.push(`${cafe.maintenanceOpen} open maintenance job(s)`);
  if (cafe.inventoryBelowPar > 0) reasons.push(`${cafe.inventoryBelowPar} item(s) below par`);
  if (cafe.targetAchievementPct !== null && cafe.targetAchievementPct < 70) reasons.push(`Target pace at ${cafe.targetAchievementPct}%`);
  if (reasons.length === 0) return "All operational indicators within normal ranges.";
  return reasons.join(" · ");
}

// ─── Daily Close Packs Management Modal Logic ─────────────────────────────────

async function openDailyClosePacksModal() {
  const modal = document.getElementById("occ-daily-close-modal");
  const content = document.getElementById("occ-daily-close-modal-content");
  if (!modal || !content) return;

  modal.style.display = "flex";
  content.innerHTML = `
    <div class="text-center py-8">
      <div class="spinner mb-2"></div>
      <p class="text-slate-400">Loading Daily Café Close Packs...</p>
    </div>
  `;

  const closeBtn = document.getElementById("occ-close-daily-close-modal");
  if (closeBtn) {
    closeBtn.onclick = () => { modal.style.display = "none"; };
  }

  try {
    const targetCafe = ownerDashboardState.selectedCafeId || '';
    const queryStr = targetCafe ? `?cafeId=${encodeURIComponent(targetCafe)}` : '';
    const res = await apiGet(`/daily-close${queryStr}`);
    const packs = (res && res.data) ? res.data : [];

    if (!packs.length) {
      content.innerHTML = `
        <div class="occ-dm-card text-center py-8">
          <p class="text-slate-300 font-semibold mb-1">No Daily Close Packs Submitted</p>
          <p class="text-slate-500 text-xs">Managers submit daily close packs upon shift close and bank deposit.</p>
        </div>
      `;
      return;
    }

    const pendingCount = packs.filter(p => p.status === 'PENDING_REVIEW').length;

    content.innerHTML = `
      <div class="occ-drawer-mgmt-layout">
        <div class="flex justify-between items-center mb-3">
          <div class="text-xs text-slate-400">
            Total Packs: <strong class="text-slate-200">${packs.length}</strong> · 
            Pending Owner Review: <strong class="text-amber-400">${pendingCount}</strong>
          </div>
          <button id="occ-refresh-close-packs" class="btn btn-secondary btn-sm">Refresh List</button>
        </div>

        <div class="space-y-3" style="max-height: 550px; overflow-y: auto;">
          ${packs.map(p => {
            const hasVariance = p.variancePaisa !== 0;
            const statusColor = p.status === 'ACKNOWLEDGED' ? 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10' :
              p.status === 'RETURNED' ? 'text-rose-400 border-rose-500/30 bg-rose-500/10' :
              'text-amber-400 border-amber-500/30 bg-amber-500/10';

            return `
              <div class="occ-dm-card" style="border: 1px solid rgba(255,255,255,0.08); padding: 14px; border-radius: 8px; margin-bottom: 12px;">
                <div class="flex justify-between items-start mb-2">
                  <div>
                    <span class="font-mono text-xs text-amber-400 font-bold">${p.packId}</span>
                    <span class="text-slate-300 font-semibold ml-2">Café ${p.cafeId}</span>
                    <span class="text-slate-400 text-xs ml-2">· Date: <strong class="text-slate-200">${p.businessDate}</strong></span>
                  </div>
                  <span class="text-xs font-semibold px-2 py-0.5 rounded border ${statusColor}">
                    ${p.status}
                  </span>
                </div>

                <div class="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs mb-2 py-2 bg-slate-900/40 rounded px-2">
                  <div><span class="text-slate-500">Gross Sales:</span> <strong class="text-slate-200">${fmtInr(p.grossSalesPaisa)}</strong></div>
                  <div><span class="text-slate-500">Cash Counted:</span> <strong class="text-slate-200">${fmtInr(p.cashCountedPaisa)}</strong></div>
                  <div><span class="text-slate-500">Cash Expected:</span> <strong class="text-slate-200">${fmtInr(p.cashCollectedPaisa)}</strong></div>
                  <div>
                    <span class="text-slate-500">Variance:</span> 
                    <strong class="${hasVariance ? 'text-rose-400' : 'text-emerald-400'}">${hasVariance ? (p.variancePaisa > 0 ? '+' : '') + fmtInr(p.variancePaisa) : '₹0 (Balanced)'}</strong>
                  </div>
                </div>

                ${p.varianceExplanation ? `
                  <div class="text-xs text-rose-300 mb-2 p-1.5 bg-rose-500/10 rounded border border-rose-500/20">
                    <strong>Variance Explanation:</strong> ${p.varianceExplanation}
                  </div>
                ` : ''}

                <div class="flex flex-wrap items-center gap-3 text-xs text-slate-400 mb-3">
                  ${p.depositChallanNumber ? `<span>Challan: <strong class="text-slate-300">${p.depositChallanNumber}</strong></span>` : ''}
                  ${p.bankName ? `<span>Bank: <strong class="text-slate-300">${p.bankName}</strong></span>` : ''}
                  ${p.depositAmountPaisa ? `<span>Deposit: <strong class="text-slate-300">${fmtInr(p.depositAmountPaisa)}</strong></span>` : ''}
                  <span>Slip: <strong class="${p.depositSlipAttached ? 'text-emerald-400' : 'text-slate-500'}">${p.depositSlipAttached ? '📎 Attached' : 'Not attached'}</strong></span>
                </div>

                ${p.reviewNotes ? `
                  <div class="text-xs text-slate-300 mb-2 p-1.5 bg-slate-800/60 rounded">
                    <span class="text-slate-500">Review Note (${p.reviewedByUserId || 'Owner'}):</span> ${p.reviewNotes}
                  </div>
                ` : ''}

                <div class="flex justify-end gap-2 pt-2 border-t border-slate-800">
                  <button class="btn btn-secondary btn-sm occ-btn-return-pack" data-pack-id="${p.packId}">
                    Return with Notes
                  </button>
                  <button class="btn btn-primary btn-sm occ-btn-ack-pack" data-pack-id="${p.packId}" ${p.status === 'ACKNOWLEDGED' ? 'disabled' : ''}>
                    ${p.status === 'ACKNOWLEDGED' ? '✓ Acknowledged' : 'Acknowledge Close'}
                  </button>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    `;

    document.getElementById("occ-refresh-close-packs")?.addEventListener("click", () => {
      openDailyClosePacksModal();
    });

    // Wire Acknowledge Buttons
    content.querySelectorAll(".occ-btn-ack-pack").forEach(btn => {
      btn.addEventListener("click", async () => {
        const packId = btn.dataset.packId;
        if (!packId) return;
        btn.disabled = true;
        try {
          const r = await apiPost(`/daily-close/${encodeURIComponent(packId)}/review`, {
            action: 'ACKNOWLEDGE',
            reviewNotes: 'Daily close reviewed and acknowledged by Owner.'
          });
          if (r && r.success) {
            showToast(`Daily Close Pack ${packId} acknowledged.`, "success");
            openDailyClosePacksModal();
            loadDashboardData(true);
          } else {
            showToast(r?.message || "Failed to acknowledge pack.", "error");
            btn.disabled = false;
          }
        } catch (e) {
          showToast(e.message || "Failed to acknowledge pack.", "error");
          btn.disabled = false;
        }
      });
    });

    // Wire Return Buttons
    content.querySelectorAll(".occ-btn-return-pack").forEach(btn => {
      btn.addEventListener("click", () => {
        const packId = btn.dataset.packId;
        if (!packId) return;
        const notes = prompt(`Please enter notes explaining why Pack ${packId} is being returned:`, "Please re-verify cash count and attach deposit challan.");
        if (notes === null) return;
        if (!notes.trim()) {
          showToast("Notes are required to return a close pack.", "error");
          return;
        }
        btn.disabled = true;
        apiPost(`/daily-close/${encodeURIComponent(packId)}/review`, {
          action: 'RETURN',
          reviewNotes: notes.trim()
        }).then(r => {
          if (r && r.success) {
            showToast(`Daily Close Pack ${packId} returned with notes.`, "info");
            openDailyClosePacksModal();
            loadDashboardData(true);
          } else {
            showToast(r?.message || "Failed to return pack.", "error");
            btn.disabled = false;
          }
        }).catch(e => {
          showToast(e.message || "Failed to return pack.", "error");
          btn.disabled = false;
        });
      });
    });

  } catch (err) {
    content.innerHTML = `
      <div class="text-center py-6 text-rose-400">
        <p>Failed to load daily close packs: ${err.message}</p>
      </div>
    `;
  }
}

// ─── Cash Drawer Management Modal Logic ───────────────────────────────────────

async function openCashDrawerManagement() {
  const modal = document.getElementById("occ-drawer-modal");
  const content = document.getElementById("occ-drawer-modal-content");
  if (!modal || !content) return;

  modal.style.display = "flex";
  content.innerHTML = `
    <div class="text-center py-8">
      <div class="spinner mb-2"></div>
      <p class="text-slate-400">Loading Cash Drawer Sessions & Records...</p>
    </div>
  `;

  const closeBtn = document.getElementById("occ-close-drawer-modal");
  if (closeBtn) {
    closeBtn.onclick = () => { modal.style.display = "none"; };
  }

  try {
    const targetCafe = ownerDashboardState.selectedCafeId || (state.assignedCafes?.[0]?.cafeId || state.user?.primaryCafeId || '');
    const queryStr = targetCafe ? `?cafeId=${encodeURIComponent(targetCafe)}` : '';
    const res = await apiGet(`/bills/register/session/current${queryStr}`);
    const currentSession = res?.data || null;

    content.innerHTML = `
      <div class="occ-drawer-mgmt-layout">
        <!-- Active Drawer Session Summary -->
        <div class="occ-dm-card mb-4">
          <div class="flex justify-between items-center mb-2">
            <h4 class="font-bold text-slate-100">Current Register Session</h4>
            <span class="occ-health-pill ${currentSession?.status === 'OPEN' ? 'healthy' : 'attention'}">
              ${currentSession?.status || 'NO ACTIVE SESSION'}
            </span>
          </div>
          ${currentSession ? `
            <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs mb-3">
              <div><span class="text-slate-400">Session ID:</span> <span class="text-slate-100 font-mono">${currentSession.registerSessionId}</span></div>
              <div><span class="text-slate-400">Register:</span> <span class="text-slate-100">${currentSession.registerId}</span></div>
              <div><span class="text-slate-400">Opening Float:</span> <span class="text-amber-400 font-bold">${fmtInr(currentSession.openingFloatPaisa)}</span></div>
              <div><span class="text-slate-400">Expected Cash:</span> <span class="text-emerald-400 font-bold">${fmtInr(currentSession.expectedCashPaisa)}</span></div>
            </div>
          ` : `
            <p class="text-sm text-slate-400 mb-3">No active cash drawer session found for current register. You can open a new drawer session below.</p>
          `}
        </div>

        <!-- Cash Event Mutations -->
        <div class="occ-dm-card mb-4">
          <h4 class="font-bold text-slate-100 mb-2">Record Cash Drawer Event</h4>
          <div class="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-3">
            <div>
              <label class="form-label text-xs">Event Type</label>
              <select id="occ-de-type" class="occ-select w-full">
                <option value="CASH_IN">Cash In (Float Addition)</option>
                <option value="CASH_OUT">Cash Out (Expense/Payout)</option>
                <option value="SAFE_DROP">Safe Drop</option>
                <option value="NO_SALE_OPEN">No Sale (Audit Open)</option>
              </select>
            </div>
            <div>
              <label class="form-label text-xs">Amount (₹)</label>
              <input type="number" id="occ-de-amount" class="form-input text-xs" placeholder="e.g. 500" min="1" />
            </div>
            <div>
              <label class="form-label text-xs">Reason Category (Mandatory)</label>
              <select id="occ-de-reason-cat" class="occ-select w-full">
                <option value="Authorized cash addition">Authorized cash addition</option>
                <option value="Authorized cash removal">Authorized cash removal</option>
                <option value="Midday safe drop">Midday safe drop</option>
                <option value="Opening float correction">Opening float correction</option>
                <option value="Cash count correction">Cash count correction</option>
                <option value="Other">Other (Require Remarks)</option>
              </select>
            </div>
          </div>
          <div class="mb-3">
            <input type="text" id="occ-de-remarks" class="form-input text-xs" placeholder="Optional notes / remarks..." />
          </div>
          <div class="flex justify-end">
            <button id="occ-btn-submit-cash-event" class="btn btn-primary btn-sm" ${!currentSession ? 'disabled' : ''}>
              Submit Cash Event
            </button>
          </div>
        </div>

        <!-- Close Drawer Action -->
        ${currentSession && currentSession.status === 'OPEN' ? `
          <div class="occ-dm-card">
            <h4 class="font-bold text-slate-100 mb-2">Close Drawer Session & Blind Count</h4>
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
              <div>
                <label class="form-label text-xs">Counted Cash in Drawer (₹)</label>
                <input type="number" id="occ-close-counted" class="form-input text-xs" placeholder="e.g. 42350" />
              </div>
              <div>
                <label class="form-label text-xs">Closing Declaration Note</label>
                <input type="text" id="occ-close-note" class="form-input text-xs" placeholder="End of shift remarks..." />
              </div>
            </div>
            <div class="flex justify-end">
              <button id="occ-btn-close-drawer-session" class="btn btn-danger btn-sm">
                Close Drawer & Reconcile
              </button>
            </div>
          </div>
        ` : ''}
      </div>
    `;

    // Wire Cash Event Submission
    const btnSubmitEvent = document.getElementById("occ-btn-submit-cash-event");
    if (btnSubmitEvent && currentSession) {
      btnSubmitEvent.addEventListener("click", async () => {
        const eventType = document.getElementById("occ-de-type")?.value;
        const amountRupees = Number(document.getElementById("occ-de-amount")?.value) || 0;
        const reasonCat = document.getElementById("occ-de-reason-cat")?.value;
        const remarks = document.getElementById("occ-de-remarks")?.value || "";
        
        if (eventType !== "NO_SALE_OPEN" && amountRupees <= 0) {
          showToast("Please enter a valid amount greater than 0.", "error");
          return;
        }

        const reason = reasonCat === "Other" && remarks ? `Other: ${remarks}` : `${reasonCat} ${remarks}`.trim();
        
        btnSubmitEvent.disabled = true;
        try {
          const postRes = await apiPost("/bills/register/session/event", {
            registerSessionId: currentSession.registerSessionId,
            eventType,
            amountPaisa: Math.round(amountRupees * 100),
            reason,
          });
          if (postRes && postRes.success) {
            showToast(`Recorded ${eventType} for ₹${amountRupees.toFixed(2)} successfully!`, "success");
            openCashDrawerManagement(); // Refresh modal
            loadDashboardData(true); // Refresh background dashboard
          } else {
            showToast(postRes?.message || "Failed to record cash event.", "error");
          }
        } catch (err) {
          showToast(err.message || "Failed to record cash event.", "error");
        } finally {
          btnSubmitEvent.disabled = false;
        }
      });
    }

    // Wire Close Drawer Session
    const btnCloseSession = document.getElementById("occ-btn-close-drawer-session");
    if (btnCloseSession && currentSession) {
      btnCloseSession.addEventListener("click", async () => {
        const countedRupees = Number(document.getElementById("occ-close-counted")?.value);
        const note = document.getElementById("occ-close-note")?.value || "";
        
        if (isNaN(countedRupees) || countedRupees < 0) {
          showToast("Please enter a valid counted cash amount.", "error");
          return;
        }

        const countedPaisa = Math.round(countedRupees * 100);
        const expectedPaisa = currentSession.expectedCashPaisa || 0;
        const variancePaisa = countedPaisa - expectedPaisa;
        const varianceRupees = (variancePaisa / 100).toFixed(2);

        confirmAction({
          title: "Close Cash Drawer Session",
          description: `Expected Cash: ₹${(expectedPaisa / 100).toFixed(2)}<br>Counted Cash: ₹${countedRupees.toFixed(2)}<br><strong>Calculated Variance: ₹${varianceRupees}</strong><br><br>Are you sure you want to close this drawer session?`,
          confirmLabel: "Close Session",
          danger: variancePaisa !== 0,
          onConfirm: async () => {
            btnCloseSession.disabled = true;
            try {
              const closeRes = await apiPost("/bills/register/session/close", {
                registerSessionId: currentSession.registerSessionId,
                countedCashPaisa: countedPaisa,
                closingDeclarationNote: note,
              });
              if (closeRes && closeRes.success) {
                showToast(`Drawer session closed. Variance: ₹${varianceRupees}`, "mint");
                modal.style.display = "none";
                loadDashboardData(true);
              } else {
                showToast(closeRes?.message || "Failed to close drawer session.", "coral");
              }
            } catch (err) {
              showToast(err.userMessage || err.message || "Failed to close drawer session.", "coral");
            } finally {
              btnCloseSession.disabled = false;
            }
          }
        });
      });
    }

  } catch (err) {
    content.innerHTML = `
      <div class="text-center py-6 text-rose-400">
        <p>Failed to load register sessions: ${err.message}</p>
      </div>
    `;
  }
}

// ─── Trend Visualizer Renderers ───────────────────────────────────────────────

function renderTrendChart(trendData) {
  if (!trendData || trendData.length === 0) {
    return `<div class="occ-empty-state"><p class="text-slate-400">No revenue data available for the selected period.</p></div>`;
  }

  const maxVal = Math.max(...trendData.map(d => d.revenuePaisa || 0), 10000);
  const chartHeight = 180;

  return `
    <div class="occ-chart-wrapper">
      <div class="occ-chart-svg-container">
        <svg class="occ-svg-chart" viewBox="0 0 ${trendData.length * 60} ${chartHeight}">
          ${trendData.map((d, i) => {
            const h = Math.max(4, Math.round(((d.revenuePaisa || 0) / maxVal) * (chartHeight - 40)));
            const x = i * 60 + 15;
            const y = chartHeight - h - 20;
            return `
              <rect x="${x}" y="${y}" width="30" height="${h}" rx="4" class="occ-bar" fill="#D4AF37">
                <title>${d.date}: ${fmtInr(d.revenuePaisa)} (${d.orders || 0} orders)</title>
              </rect>
              <text x="${x + 15}" y="${chartHeight - 4}" text-anchor="middle" class="occ-axis-label" fill="#94A3B8" font-size="10">
                ${d.date ? d.date.slice(5) : ''}
              </text>
            `;
          }).join('')}
        </svg>
      </div>
      <div class="occ-chart-legend">
        <span class="occ-legend-item"><span class="occ-legend-box" style="background: #D4AF37"></span> Actual Gross Revenue (INR)</span>
      </div>
    </div>
  `;
}

function renderTrendTable(trendData) {
  if (!trendData || trendData.length === 0) {
    return `<div class="occ-empty-state"><p class="text-slate-400">No revenue data available.</p></div>`;
  }

  return `
    <div class="occ-table-responsive">
      <table class="occ-table">
        <thead>
          <tr>
            <th>Business Date</th>
            <th>Gross Revenue (INR)</th>
            <th>Completed Orders</th>
            <th>Average Order Value</th>
          </tr>
        </thead>
        <tbody>
          ${trendData.map(d => {
            const aov = d.orders > 0 ? Math.round(d.revenuePaisa / d.orders) : 0;
            return `
              <tr>
                <td class="font-medium text-slate-100">${d.date}</td>
                <td class="font-semibold text-amber-400">${fmtInr(d.revenuePaisa)}</td>
                <td>${fmtNum(d.orders)}</td>
                <td>${fmtInr(aov)}</td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    </div>
  `;
}
