// =============================================================================
// PAGE: Tasks & Approvals — Operational Task Oversight (OWN-SCR-002)
// Governance, Exception Management, Multi-Café Scoping & Verification
// =============================================================================

import { showToast, openModal } from "../components.js";
import { apiGet, apiPost } from "../apiClient.js";
import { state } from "../state.js";
import { ROLES } from "../navigation.js";

let liveTasks = null;
let summaryMetrics = null;
let activeTaskTab = state.role === ROLES.OWNER ? "EXCEPTIONS" : "ALL";
let selectedCafeFilter = "ALL";
let selectedStatusFilter = "ALL";
let selectedCategoryFilter = "ALL";
let selectedPriorityFilter = "ALL";
let selectedSortBy = "CRITICAL_OVERDUE";
let criticalOnlyFilter = false;
let blockedOnlyFilter = false;
let recurringOnlyFilter = false;
let searchQuery = "";
let lastRefreshedTime = new Date();
let currentPage = 1;
const PAGE_SIZE = 15;

let availableCafes = [];

function getCafeName(cafeId) {
  if (!cafeId) return "General";
  const found = availableCafes.find((c) => c.code === cafeId || c.id === cafeId || c._id === cafeId || c.cafeId === cafeId);
  return found ? found.name : cafeId;
}

const SAMPLE_TASKS = [];

function getIstDateString(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
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

function formatDueDate(dueDate, dueTime) {
  if (!dueDate) return "No Due Date";
  const today = getIstDateString();
  const tomorrow = getIstDateString(new Date(Date.now() + 86400000));
  const timeStr = dueTime ? ` · ${dueTime}` : "";

  if (dueDate === today) return `<span style="color:#f8fafc;font-weight:600;">Today${timeStr}</span>`;
  if (dueDate === tomorrow) return `<span>Tomorrow${timeStr}</span>`;
  return `<span>${dueDate}${timeStr}</span>`;
}

function isTaskOverdue(task) {
  if (!task.dueDate) return false;
  const today = getIstDateString();
  return task.dueDate < today && ["PENDING", "IN_PROGRESS", "AWAITING_VERIFICATION", "RETURNED_FOR_CORRECTION", "BLOCKED"].includes(task.status);
}

function computeCategoryCompliance(tasks) {
  const categories = [
    { key: "SAFETY_COMPLIANCE", label: "Safety & Compliance" },
    { key: "EQUIPMENT_MAINTENANCE", label: "Equipment Care & Calibration" },
    { key: "CASH_CONTROL_AUDIT", label: "Cash Drawer & Safe Reconciliations" },
    { key: "HYGIENE_INSPECTION", label: "Hygiene & Sanitization Signoffs" },
  ];

  return categories.map((cat) => {
    const catTasks = (tasks || []).filter((t) => t.category === cat.key);
    const total = catTasks.length;
    const completed = catTasks.filter((t) => t.status === "COMPLETED");
    const blocked = catTasks.filter((t) => t.status === "BLOCKED").length;

    let onTime = 0;
    for (const t of completed) {
      if (!t.dueDate || (t.completedAt && getIstDateString(new Date(t.completedAt)) <= t.dueDate)) {
        onTime++;
      }
    }

    const pct = completed.length > 0 ? Math.round((onTime / completed.length) * 100) : (total === 0 ? 100 : 0);
    return { ...cat, total, completed: completed.length, blocked, pct };
  });
}

function getUpcomingCriticalObligations(tasks) {
  const today = getIstDateString();
  const next7 = getIstDateString(new Date(Date.now() + 7 * 86400000));

  return (tasks || []).filter((t) => {
    if (t.status === "COMPLETED" || t.status === "CANCELLED") return false;
    const isCrit = t.isCriticalControl || t.risk === "CRITICAL" || t.priority === "URGENT" || t.priority === "HIGH";
    return isCrit && t.dueDate && t.dueDate >= today && t.dueDate <= next7;
  }).slice(0, 5);
}

export function renderTasks({ title } = {}) {
  const pageTitle = title || "Operational Task Oversight";
  const isOwner = state.role === ROLES.OWNER;
  const today = getIstDateString();

  const allTasks = liveTasks || SAMPLE_TASKS;

  // Compute Summary Metrics (Authoritative server fallback to in-memory)
  let rawOpen = 0;
  let rawOverdue = 0;
  let rawDueToday = 0;
  let rawCritical = 0;
  let rawVerificationPending = 0;
  let rawCompleted = 0;
  let rawOnTimeCompleted = 0;

  for (const t of allTasks) {
    const isOpen = ["PENDING", "IN_PROGRESS", "AWAITING_VERIFICATION", "RETURNED_FOR_CORRECTION", "BLOCKED"].includes(t.status);
    if (isOpen) {
      rawOpen++;
      if (isTaskOverdue(t)) rawOverdue++;
      if (t.dueDate === today) rawDueToday++;
      if (t.risk === "CRITICAL" || t.priority === "URGENT" || t.isCriticalControl) rawCritical++;
      if (t.status === "AWAITING_VERIFICATION" || t.verificationStatus === "PENDING_VERIFICATION") rawVerificationPending++;
    } else if (t.status === "COMPLETED") {
      rawCompleted++;
      if (!t.dueDate || (t.completedAt && getIstDateString(new Date(t.completedAt)) <= t.dueDate)) {
        rawOnTimeCompleted++;
      }
    }
  }

  const rawOnTimeRate = rawCompleted > 0 ? Math.round((rawOnTimeCompleted / rawCompleted) * 100) : 100;

  // Reconcile with authoritative backend summary if available
  const overdueCount = summaryMetrics?.overdueCount ?? rawOverdue;
  const criticalCount = summaryMetrics?.criticalCount ?? rawCritical;
  const dueTodayCount = summaryMetrics?.dueTodayCount ?? rawDueToday;
  const verificationPendingCount = summaryMetrics?.verificationPendingCount ?? rawVerificationPending;
  const onTimeRate = summaryMetrics?.onTimeRate ?? rawOnTimeRate;

  // Filter tasks based on activeTab, cafe, category, priority, status, and checkboxes
  let filteredTasks = allTasks.filter((t) => {
    // Tab filtering
    if (activeTaskTab === "EXCEPTIONS") {
      const isException =
        isTaskOverdue(t) ||
        t.status === "RETURNED_FOR_CORRECTION" ||
        t.status === "BLOCKED" ||
        t.status === "AWAITING_VERIFICATION" ||
        t.verificationStatus === "PENDING_VERIFICATION" ||
        ((t.risk === "CRITICAL" || t.isCriticalControl) && t.status !== "COMPLETED" && t.status !== "CANCELLED");
      if (!isException) return false;
    } else if (activeTaskTab === "PENDING") {
      if (!["PENDING", "IN_PROGRESS"].includes(t.status)) return false;
    } else if (activeTaskTab === "VERIFICATION") {
      if (t.status !== "AWAITING_VERIFICATION" && t.verificationStatus !== "PENDING_VERIFICATION") return false;
    } else if (activeTaskTab === "COMPLETED") {
      if (t.status !== "COMPLETED") return false;
    }

    // Cafe filtering
    if (selectedCafeFilter !== "ALL" && t.cafeId !== selectedCafeFilter) return false;

    // Status filtering
    if (selectedStatusFilter !== "ALL" && t.status !== selectedStatusFilter) return false;

    // Category filtering
    if (selectedCategoryFilter !== "ALL" && t.category !== selectedCategoryFilter) return false;

    // Priority filtering
    if (selectedPriorityFilter !== "ALL" && t.priority !== selectedPriorityFilter && t.risk !== selectedPriorityFilter) return false;

    // Critical Control Only
    if (criticalOnlyFilter && !t.isCriticalControl && t.risk !== "CRITICAL") return false;

    // Blocked Only
    if (blockedOnlyFilter && t.status !== "BLOCKED") return false;

    // Recurring Only
    if (recurringOnlyFilter && (!t.recurrence || !t.recurrence.isRecurring)) return false;

    // Search query
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      const match =
        (t.taskId && t.taskId.toLowerCase().includes(q)) ||
        (t.title && t.title.toLowerCase().includes(q)) ||
        (t.assignedUserId && t.assignedUserId.toLowerCase().includes(q)) ||
        (t.responsibleUserId && t.responsibleUserId.toLowerCase().includes(q)) ||
        (t.description && t.description.toLowerCase().includes(q));
      if (!match) return false;
    }

    return true;
  });

  // Sorting
  filteredTasks.sort((a, b) => {
    if (selectedSortBy === "CRITICAL_OVERDUE") {
      const aScore = (isTaskOverdue(a) ? 100 : 0) + (a.isCriticalControl || a.risk === "CRITICAL" ? 50 : 0) + (a.status === "AWAITING_VERIFICATION" ? 25 : 0);
      const bScore = (isTaskOverdue(b) ? 100 : 0) + (b.isCriticalControl || b.risk === "CRITICAL" ? 50 : 0) + (b.status === "AWAITING_VERIFICATION" ? 25 : 0);
      return bScore - aScore;
    }
    if (selectedSortBy === "DUE_DATE") {
      return (a.dueDate || "9999-99-99").localeCompare(b.dueDate || "9999-99-99");
    }
    if (selectedSortBy === "PRIORITY") {
      const prioOrder = { URGENT: 4, HIGH: 3, NORMAL: 2, LOW: 1 };
      return (prioOrder[b.priority] || 0) - (prioOrder[a.priority] || 0);
    }
    if (selectedSortBy === "CREATED_AT") {
      return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
    }
    if (selectedSortBy === "CAFE") {
      return (a.cafeId || "").localeCompare(b.cafeId || "");
    }
    return 0;
  });

  // Pagination slicing
  const totalPages = Math.max(1, Math.ceil(filteredTasks.length / PAGE_SIZE));
  if (currentPage > totalPages) currentPage = totalPages;
  if (currentPage < 1) currentPage = 1;
  const startIndex = (currentPage - 1) * PAGE_SIZE;
  const endIndex = Math.min(startIndex + PAGE_SIZE, filteredTasks.length);
  const pagedTasks = filteredTasks.slice(startIndex, endIndex);

  // Dynamic Category Compliance Data
  const categoryComplianceList = computeCategoryCompliance(allTasks);

  // Dynamic Upcoming Critical Obligations
  const criticalUpcoming = getUpcomingCriticalObligations(allTasks);

  return `
    <div class="page-enter tasks-page" style="padding-bottom: 60px;">
      <!-- Screen Header -->
      <div class="page-header" style="display:flex; justify-content:space-between; align-items:flex-start; flex-wrap:wrap; gap:16px; margin-bottom:24px;">
        <div>
          <div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap;">
            <h1 class="page-title" style="font-size:26px; font-weight:700; margin:0; color:var(--ink);">${escapeHtml(pageTitle)}</h1>
            <span class="badge" style="background:rgba(180,83,9,0.12); color:#b45309; font-weight:600; font-size:12px; padding:4px 10px; border-radius:12px;">SCR-002 TASKS</span>
          </div>
          <p class="page-subtitle" style="font-size:14px; color:var(--muted); margin:4px 0 0;">
            Cross-café oversight of operational tasks, compliance obligations, recurring controls, verification and escalations.
          </p>
        </div>
        <div style="display:flex; gap:10px; align-items:center; flex-wrap:wrap;">
          <button class="btn btn-primary" id="add-task-btn" type="button" style="font-weight:700;" aria-label="Assign New Management Task">
            + Assign Management Task
          </button>
          <button class="btn btn-secondary" id="run-scheduler-btn" type="button" style="font-weight:600; display:flex; align-items:center; gap:6px;">
            ⚡ Run Recurring Tasks
          </button>
          <button class="btn btn-secondary" id="compliance-report-btn" type="button" style="font-weight:600; display:flex; align-items:center; gap:6px;">
            📊 Compliance Report
          </button>
          <button class="btn btn-secondary" id="refresh-tasks-btn" type="button" title="Refresh task queue" aria-label="Refresh Tasks" style="font-weight:600; display:flex; align-items:center; gap:6px;">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M23 4v6h-6M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
            Refresh Tasks
          </button>
        </div>
      </div>

      <!-- Executive Summary Strip -->
      <div class="oto-summary-strip" role="region" aria-label="Executive Task Metrics">
        <div class="oto-metric-card ${overdueCount > 0 ? "overdue" : ""}">
          <span class="oto-metric-val" style="${overdueCount > 0 ? "color:#fbbf24;" : ""}">${overdueCount}</span>
          <span class="oto-metric-label">Overdue Obligations</span>
        </div>
        <div class="oto-metric-card ${criticalCount > 0 ? "critical" : ""}">
          <span class="oto-metric-val" style="${criticalCount > 0 ? "color:#fb7185;" : ""}">${criticalCount}</span>
          <span class="oto-metric-label">Critical Controls</span>
        </div>
        <div class="oto-metric-card">
          <span class="oto-metric-val">${dueTodayCount}</span>
          <span class="oto-metric-label">Due Today</span>
        </div>
        <div class="oto-metric-card ${verificationPendingCount > 0 ? "verification" : ""}">
          <span class="oto-metric-val" style="${verificationPendingCount > 0 ? "color:#38bdf8;" : ""}">${verificationPendingCount}</span>
          <span class="oto-metric-label">Verification Pending</span>
        </div>
        <div class="oto-metric-card ontime">
          <span class="oto-metric-val" style="color:#34d399;">${onTimeRate}%</span>
          <span class="oto-metric-label">On-Time Completion</span>
        </div>
      </div>

      <!-- Filter Bar & Tabs -->
      <div class="card" style="padding:14px 18px;margin-bottom:20px;background:var(--surface);border:1px solid var(--line);">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px;">
          <!-- Primary Tabs Strip -->
          <div class="oto-tabs-strip" role="tablist" aria-label="Task Queues">
            <button class="oto-tab-btn ${activeTaskTab === "EXCEPTIONS" ? "active" : ""}" data-task-tab="EXCEPTIONS" type="button" role="tab" aria-selected="${activeTaskTab === "EXCEPTIONS"}">
              <span>⚠️</span> Needs Attention (${overdueCount + verificationPendingCount + (allTasks.filter(t => t.status === "RETURNED_FOR_CORRECTION" || t.status === "BLOCKED").length)})
            </button>
            <button class="oto-tab-btn ${activeTaskTab === "ALL" ? "active" : ""}" data-task-tab="ALL" type="button" role="tab" aria-selected="${activeTaskTab === "ALL"}">
              All Tasks (${allTasks.length})
            </button>
            <button class="oto-tab-btn ${activeTaskTab === "PENDING" ? "active" : ""}" data-task-tab="PENDING" type="button" role="tab" aria-selected="${activeTaskTab === "PENDING"}">
              In Progress
            </button>
            <button class="oto-tab-btn ${activeTaskTab === "VERIFICATION" ? "active" : ""}" data-task-tab="VERIFICATION" type="button" role="tab" aria-selected="${activeTaskTab === "VERIFICATION"}">
              Verification (${verificationPendingCount})
            </button>
            <button class="oto-tab-btn ${activeTaskTab === "COMPLETED" ? "active" : ""}" data-task-tab="COMPLETED" type="button" role="tab" aria-selected="${activeTaskTab === "COMPLETED"}">
              Completed
            </button>
          </div>

          <!-- Secondary Filters Dropdowns & Search -->
          <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
            <select id="filter-task-cafe" class="select select-sm" aria-label="Filter by Café Location" style="background:var(--surface);color:var(--ink);border:1px solid var(--line);font-size:12px;">
              <option value="ALL" ${selectedCafeFilter === "ALL" ? "selected" : ""}>All Authorized Cafés</option>
              ${availableCafes.map(c => `
                <option value="${c.code || c.id || c._id || c.cafeId}" ${selectedCafeFilter === (c.code || c.id || c._id || c.cafeId) ? "selected" : ""}>
                  ${c.code || c.cafeId ? (c.code || c.cafeId) + " · " : ""}${c.name}
                </option>
              `).join('')}
            </select>

            <select id="filter-task-category" class="select select-sm" aria-label="Filter by Category" style="background:var(--surface);color:var(--ink);border:1px solid var(--line);font-size:12px;">
              <option value="ALL" ${selectedCategoryFilter === "ALL" ? "selected" : ""}>All Categories</option>
              <option value="EQUIPMENT_MAINTENANCE" ${selectedCategoryFilter === "EQUIPMENT_MAINTENANCE" ? "selected" : ""}>Equipment Care</option>
              <option value="SAFETY_COMPLIANCE" ${selectedCategoryFilter === "SAFETY_COMPLIANCE" ? "selected" : ""}>Safety & Compliance</option>
              <option value="INVENTORY_RECEIVING" ${selectedCategoryFilter === "INVENTORY_RECEIVING" ? "selected" : ""}>Inventory Receiving</option>
              <option value="CASH_CONTROL_AUDIT" ${selectedCategoryFilter === "CASH_CONTROL_AUDIT" ? "selected" : ""}>Cash Drawer & Float</option>
              <option value="HYGIENE_INSPECTION" ${selectedCategoryFilter === "HYGIENE_INSPECTION" ? "selected" : ""}>Hygiene Inspection</option>
              <option value="MANAGEMENT_DELEGATION" ${selectedCategoryFilter === "MANAGEMENT_DELEGATION" ? "selected" : ""}>Management Delegation</option>
              <option value="GENERAL_OPERATIONS" ${selectedCategoryFilter === "GENERAL_OPERATIONS" ? "selected" : ""}>General Operations</option>
            </select>

            <select id="filter-task-sort" class="select select-sm" aria-label="Sort Task Queue" style="background:var(--surface);color:var(--ink);border:1px solid var(--line);font-size:12px;">
              <option value="CRITICAL_OVERDUE" ${selectedSortBy === "CRITICAL_OVERDUE" ? "selected" : ""}>Sort: Critical & Overdue First</option>
              <option value="DUE_DATE" ${selectedSortBy === "DUE_DATE" ? "selected" : ""}>Sort: Due Date (Earliest)</option>
              <option value="PRIORITY" ${selectedSortBy === "PRIORITY" ? "selected" : ""}>Sort: Priority (Highest)</option>
              <option value="CREATED_AT" ${selectedSortBy === "CREATED_AT" ? "selected" : ""}>Sort: Newest Created</option>
              <option value="CAFE" ${selectedSortBy === "CAFE" ? "selected" : ""}>Sort: Café Location</option>
            </select>

            <div style="position:relative;">
              <input type="text" id="task-search-input" class="input input-sm" placeholder="Search tasks, ID, staff..." value="${escapeHtml(searchQuery)}" aria-label="Search Tasks" style="background:var(--surface);color:var(--ink);border:1px solid var(--line);font-size:12px;width:170px;padding-left:26px;" />
              <span style="position:absolute;left:8px;top:50%;transform:translateY(-50%);font-size:11px;color:var(--muted);" aria-hidden="true">🔍</span>
            </div>
          </div>
        </div>

        <!-- Checkbox Filter Toggles -->
        <div style="display:flex;gap:18px;align-items:center;margin-top:12px;padding-top:10px;border-top:1px solid var(--line);font-size:12px;flex-wrap:wrap;">
          <label style="display:flex;align-items:center;gap:6px;color:var(--ink);cursor:pointer;">
            <input type="checkbox" id="chk-filter-critical" ${criticalOnlyFilter ? "checked" : ""} />
            <span>Critical Controls Only</span>
          </label>
          <label style="display:flex;align-items:center;gap:6px;color:var(--ink);cursor:pointer;">
            <input type="checkbox" id="chk-filter-blocked" ${blockedOnlyFilter ? "checked" : ""} />
            <span>Blocked Tasks Only</span>
          </label>
          <label style="display:flex;align-items:center;gap:6px;color:var(--ink);cursor:pointer;">
            <input type="checkbox" id="chk-filter-recurring" ${recurringOnlyFilter ? "checked" : ""} />
            <span>Recurring Obligations Only</span>
          </label>
        </div>
      </div>

      <!-- Main Governed Task Queue Table -->
      <div class="card" style="padding:20px;background:var(--surface);border:1px solid var(--line);margin-bottom:20px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;flex-wrap:wrap;gap:10px;">
          <div>
            <h2 style="font-size:16px;font-weight:700;margin:0 0 2px;color:var(--ink);">
              ${activeTaskTab === "EXCEPTIONS" ? "Operational Exceptions & Governance Queue" : "Operational Task Queue"} (${filteredTasks.length})
            </h2>
            <p style="font-size:12.5px;color:var(--muted);margin:0;">
              ${activeTaskTab === "EXCEPTIONS" ? "Tasks requiring owner oversight, corrective action, or authorized verification." : "Governed operational tasks across authorized locations."}
            </p>
          </div>
          ${(filteredTasks.length !== allTasks.length || searchQuery || criticalOnlyFilter || blockedOnlyFilter || recurringOnlyFilter || selectedCafeFilter !== "ALL" || selectedCategoryFilter !== "ALL") ? `
            <button class="btn btn-xs btn-ghost" id="clear-filters-btn" type="button" style="color:var(--bronze-600);font-weight:600;">Clear Filters</button>
          ` : ""}
        </div>

        <div class="table-wrap" style="overflow-x:auto;">
          <table class="table" style="width:100%;border-collapse:collapse;">
            <thead>
              <tr style="border-bottom:1px solid var(--line);text-align:left;font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:0.5px;background:var(--surface-sunken);">
                <th style="padding:10px 12px;">Task Details</th>
                <th style="padding:10px 12px;">Café Location</th>
                <th style="padding:10px 12px;">Assignee / Responsible</th>
                <th style="padding:10px 12px;">Category &amp; Risk</th>
                <th style="padding:10px 12px;">Due Target</th>
                <th style="padding:10px 12px;">Lifecycle Status</th>
                <th style="padding:10px 12px;text-align:right;">Actions</th>
              </tr>
            </thead>
            <tbody>
              ${
                pagedTasks.length === 0
                  ? `
                  <tr>
                    <td colspan="7" style="text-align:center;padding:48px 16px;">
                      <div style="color:var(--success);font-size:32px;margin-bottom:8px;">✓</div>
                      <div style="font-size:15px;font-weight:700;color:var(--ink);">
                        ${activeTaskTab === "EXCEPTIONS" ? "All Clear — No Operational Exceptions" : "No tasks found"}
                      </div>
                      <div style="font-size:12.5px;color:var(--muted);margin-top:4px;">
                        ${activeTaskTab === "EXCEPTIONS" ? "All operational tasks and compliance obligations are on track or verified." : "No tasks match the active filter criteria."}
                      </div>
                    </td>
                  </tr>
                `
                  : pagedTasks
                      .map((t) => {
                        const overdue = isTaskOverdue(t);
                        const cafeName = getCafeName(t.cafeId);
                        const riskBadge =
                          t.risk === "CRITICAL" || t.isCriticalControl
                            ? `<span class="oto-badge badge-critical">CRITICAL CONTROL</span>`
                            : t.priority === "HIGH" || t.priority === "URGENT"
                            ? `<span class="oto-badge badge-overdue">HIGH PRIORITY</span>`
                            : `<span class="oto-badge" style="background:var(--surface-sunken);color:var(--muted);border:1px solid var(--line);">NORMAL</span>`;

                        let statusBadge = `<span class="oto-badge" style="background:var(--surface-sunken);color:var(--muted);border:1px solid var(--line);">${t.status}</span>`;
                        if (t.status === "COMPLETED") {
                          statusBadge = `<span class="oto-badge badge-completed">✓ VERIFIED</span>`;
                        } else if (t.status === "AWAITING_VERIFICATION") {
                          statusBadge = `<span class="oto-badge badge-verification">⏳ VERIFY PENDING</span>`;
                        } else if (t.status === "RETURNED_FOR_CORRECTION") {
                          statusBadge = `<span class="oto-badge badge-returned">↩ RETURNED</span>`;
                        } else if (t.status === "BLOCKED") {
                          statusBadge = `<span class="oto-badge badge-blocked">⛔ BLOCKED</span>`;
                        } else if (overdue) {
                          statusBadge = `<span class="oto-badge badge-overdue">⚠️ OVERDUE</span>`;
                        }

                        return `
                          <tr style="border-bottom:1px solid var(--line);font-size:13px;" data-task-row="${t.taskId}">
                            <td style="padding:12px;">
                              <div class="oto-task-title">${escapeHtml(t.title)}</div>
                              <div class="oto-task-id">${t.taskId} ${t.recurrence?.isRecurring ? `· ${t.recurrence.frequency}` : ""}</div>
                            </td>
                            <td style="padding:12px;">
                              <div style="font-weight:600;color:var(--ink);">${cafeName}</div>
                              <div style="font-size:11px;color:var(--muted);">${t.cafeId || "General"}</div>
                            </td>
                            <td style="padding:12px;">
                              <div style="font-weight:600;color:var(--ink);">${escapeHtml(t.assignedUserId || "Unassigned")}</div>
                              ${t.responsibleUserId && t.responsibleUserId !== t.assignedUserId ? `<div style="font-size:11px;color:var(--muted);">Resp: ${escapeHtml(t.responsibleUserId)}</div>` : ""}
                            </td>
                            <td style="padding:12px;">
                              <div style="margin-bottom:4px;">${riskBadge}</div>
                              <div style="font-size:11px;color:var(--muted);">${formatCategory(t.category)}</div>
                            </td>
                            <td style="padding:12px;">
                              <div>${formatDueDate(t.dueDate, t.dueTime)}</div>
                              ${overdue ? `<span style="font-size:10.5px;color:var(--warning);font-weight:600;">Overdue</span>` : ""}
                            </td>
                            <td style="padding:12px;">
                              ${statusBadge}
                            </td>
                            <td style="padding:12px;text-align:right;">
                              <div style="display:flex;gap:6px;justify-content:flex-end;">
                                <button class="btn btn-xs btn-ghost" data-view-task="${t.taskId}" type="button" style="color:var(--info);">
                                  View Details
                                </button>
                                ${
                                  t.status === "AWAITING_VERIFICATION" && (isOwner || state.role === ROLES.MASTER)
                                    ? `
                                    <button class="btn btn-xs btn-primary" data-verify-task="${t.taskId}" type="button">
                                      Verify
                                    </button>
                                  `
                                    : ""
                                }
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

        <!-- Pagination Controls -->
        ${
          filteredTasks.length > 0
            ? `
          <div style="display:flex;justify-content:space-between;align-items:center;margin-top:16px;padding-top:12px;border-top:1px solid var(--line);flex-wrap:wrap;gap:12px;font-size:12.5px;color:var(--muted);">
            <div>
              Showing <strong style="color:var(--ink);">${startIndex + 1}</strong>–<strong style="color:var(--ink);">${endIndex}</strong> of <strong style="color:var(--ink);">${filteredTasks.length}</strong> tasks
            </div>
            <div style="display:flex;gap:8px;align-items:center;">
              <button class="btn btn-xs btn-secondary" id="task-prev-page-btn" type="button" ${currentPage <= 1 ? "disabled" : ""}>
                ← Previous
              </button>
              <span style="font-weight:600;color:var(--ink);padding:0 4px;">Page ${currentPage} of ${totalPages}</span>
              <button class="btn btn-xs btn-secondary" id="task-next-page-btn" type="button" ${currentPage >= totalPages ? "disabled" : ""}>
                Next →
              </button>
            </div>
          </div>
        `
            : ""
        }
      </div>

      <!-- Portfolio Category Compliance & Upcoming Critical Obligations -->
      <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(320px, 1fr));gap:20px;">
        <!-- Category Compliance Card (Authoritative Live Data) -->
        <div class="card" style="padding:18px;background:var(--surface);border:1px solid var(--line);">
          <h3 style="font-size:14px;font-weight:700;margin:0 0 12px;color:var(--ink);display:flex;align-items:center;gap:6px;">
            <span>🛡️</span> Operating Control Category Compliance
          </h3>
          <div style="display:flex;flex-direction:column;gap:10px;font-size:12.5px;">
            ${categoryComplianceList.map(cat => {
              const barColor = cat.pct >= 90 ? "var(--success)" : cat.pct >= 75 ? "var(--warning)" : "var(--danger)";
              const statusText = cat.total === 0 ? "No active obligations" : `${cat.pct}% On-Time ${cat.blocked > 0 ? `(${cat.blocked} Blocked)` : ""}`;
              return `
                <div>
                  <div style="display:flex;justify-content:space-between;margin-bottom:3px;">
                    <span style="color:var(--muted);">${cat.label}</span>
                    <span style="font-weight:700;color:${barColor};">${statusText}</span>
                  </div>
                  <div style="height:6px;background:var(--surface-sunken);border-radius:3px;overflow:hidden;border:1px solid var(--line);">
                    <div style="width:${cat.pct}%;height:100%;background:${barColor};transition:width 0.3s ease;"></div>
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        </div>

        <!-- Upcoming Critical Obligations Card (Authoritative 7-Day Lookout) -->
        <div class="card" style="padding:18px;background:var(--surface);border:1px solid var(--line);">
          <h3 style="font-size:14px;font-weight:700;margin:0 0 12px;color:var(--ink);display:flex;align-items:center;gap:6px;">
            <span>📅</span> Upcoming Critical Obligations (7-Day Lookout)
          </h3>
          <div style="display:flex;flex-direction:column;gap:8px;font-size:12.5px;">
            ${
              criticalUpcoming.length === 0
                ? `
                <div style="padding:24px 16px;text-align:center;color:var(--muted);font-size:12.5px;background:var(--surface-sunken);border-radius:6px;border:1px dashed var(--line);">
                  <span style="color:var(--success);font-size:18px;display:block;margin-bottom:4px;">✓</span>
                  No critical statutory or high-risk obligations due in the next 7 days.
                </div>
              `
                : criticalUpcoming.map((t) => `
                <div style="padding:8px 10px;background:var(--surface-sunken);border:1px solid var(--line);border-radius:6px;display:flex;justify-content:space-between;align-items:center;gap:8px;">
                  <div style="min-width:0;flex:1;">
                    <div style="font-weight:600;color:var(--ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(t.title)}</div>
                    <div style="font-size:11px;color:var(--muted);">${getCafeName(t.cafeId)} · ${escapeHtml(t.assignedUserId || t.assignedRole || "Staff")}</div>
                  </div>
                  <span class="badge" style="background:rgba(245,158,11,0.15);color:#d97706;font-size:11px;font-weight:700;flex-shrink:0;">
                    ${t.dueDate || "Upcoming"}
                  </span>
                </div>
              `).join("")
            }
          </div>
        </div>
      </div>
    </div>
  `;
}

function formatCategory(cat) {
  if (!cat) return "General Operations";
  return cat.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, l => l.toUpperCase());
}

function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

let hasInitialFetchedTasks = false;

function wireTaskEventListeners(root) {
  if (!root) return;

  // Refresh Button
  const refreshBtn = root.querySelector("#refresh-tasks-btn");
  if (refreshBtn) {
    refreshBtn.addEventListener("click", async () => {
      refreshBtn.disabled = true;
      refreshBtn.textContent = "Refreshing...";
      try {
        await fetchTasksFromServer();
        lastRefreshedTime = new Date();
        refreshTasksView(root);
        showToast("Operational tasks refreshed", "mint");
      } catch (err) {
        showToast("Failed to refresh tasks", "coral");
      } finally {
        refreshBtn.disabled = false;
        refreshBtn.innerHTML = `
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M23 4v6h-6M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
          Refresh Tasks
        `;
      }
    });
  }

  // Filter Tabs
  root.querySelectorAll("[data-task-tab]").forEach((btn) => {
    btn.addEventListener("click", () => {
      activeTaskTab = btn.dataset.taskTab;
      currentPage = 1;
      refreshTasksView(root);
    });
  });

  // Cafe Filter
  const cafeSelect = root.querySelector("#filter-task-cafe");
  if (cafeSelect) {
    cafeSelect.addEventListener("change", (e) => {
      selectedCafeFilter = e.target.value;
      currentPage = 1;
      refreshTasksView(root);
    });
  }

  // Category Filter
  const catSelect = root.querySelector("#filter-task-category");
  if (catSelect) {
    catSelect.addEventListener("change", (e) => {
      selectedCategoryFilter = e.target.value;
      currentPage = 1;
      refreshTasksView(root);
    });
  }

  // Sort Filter
  const sortSelect = root.querySelector("#filter-task-sort");
  if (sortSelect) {
    sortSelect.addEventListener("change", (e) => {
      selectedSortBy = e.target.value;
      refreshTasksView(root);
    });
  }

  // Checkbox Filters
  const chkCritical = root.querySelector("#chk-filter-critical");
  if (chkCritical) {
    chkCritical.addEventListener("change", (e) => {
      criticalOnlyFilter = e.target.checked;
      currentPage = 1;
      refreshTasksView(root);
    });
  }

  const chkBlocked = root.querySelector("#chk-filter-blocked");
  if (chkBlocked) {
    chkBlocked.addEventListener("change", (e) => {
      blockedOnlyFilter = e.target.checked;
      currentPage = 1;
      refreshTasksView(root);
    });
  }

  const chkRecurring = root.querySelector("#chk-filter-recurring");
  if (chkRecurring) {
    chkRecurring.addEventListener("change", (e) => {
      recurringOnlyFilter = e.target.checked;
      currentPage = 1;
      refreshTasksView(root);
    });
  }

  // Search Input
  const searchInput = root.querySelector("#task-search-input");
  if (searchInput) {
    searchInput.addEventListener("input", (e) => {
      searchQuery = e.target.value.trim();
      currentPage = 1;
      refreshTasksView(root);
    });
  }

  // Clear Filters
  const clearBtn = root.querySelector("#clear-filters-btn");
  if (clearBtn) {
    clearBtn.addEventListener("click", () => {
      selectedCafeFilter = "ALL";
      selectedStatusFilter = "ALL";
      selectedCategoryFilter = "ALL";
      selectedPriorityFilter = "ALL";
      selectedSortBy = "CRITICAL_OVERDUE";
      criticalOnlyFilter = false;
      blockedOnlyFilter = false;
      recurringOnlyFilter = false;
      searchQuery = "";
      currentPage = 1;
      refreshTasksView(root);
    });
  }

  // Pagination Buttons
  const prevBtn = root.querySelector("#task-prev-page-btn");
  if (prevBtn) {
    prevBtn.addEventListener("click", () => {
      if (currentPage > 1) {
        currentPage--;
        refreshTasksView(root);
      }
    });
  }

  const nextBtn = root.querySelector("#task-next-page-btn");
  if (nextBtn) {
    nextBtn.addEventListener("click", () => {
      currentPage++;
      refreshTasksView(root);
    });
  }

  // View Task Modal
  root.querySelectorAll("[data-view-task]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const taskId = btn.dataset.viewTask;
      openTaskDetailModal(taskId, root);
    });
  });

  // Verify Button Direct
  root.querySelectorAll("[data-verify-task]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const taskId = btn.dataset.verifyTask;
      btn.disabled = true;
      await handleVerifyTask(taskId, root);
    });
  });

  // Assign New Task Modal
  const addBtn = root.querySelector("#add-task-btn");
  if (addBtn) {
    addBtn.addEventListener("click", () => {
      openAssignTaskModal(root);
    });
  }

  // Recurring Scheduler Trigger (F326)
  const schedBtn = root.querySelector("#run-scheduler-btn");
  if (schedBtn) {
    schedBtn.addEventListener("click", async () => {
      schedBtn.disabled = true;
      try {
        const res = await apiPost("/tasks/scheduler/run", {});
        showToast(`Recurring tasks run: ${res.data?.generatedCount || 0} generated, ${res.data?.skippedCount || 0} skipped.`, "mint");
        await fetchTasksFromServer();
        refreshTasksView(root);
      } catch (err) {
        showToast(err.message || "Failed to trigger recurring scheduler", "coral");
      } finally {
        schedBtn.disabled = false;
      }
    });
  }

  // Multi-Outlet Compliance Report (F331, F333)
  const compBtn = root.querySelector("#compliance-report-btn");
  if (compBtn) {
    compBtn.addEventListener("click", () => {
      openComplianceReportModal(root);
    });
  }
}

export function wireTasks(root) {
  if (!root) return;

  // Check route context (approvals route prioritizes verification tab)
  if (state.route === "approvals" && activeTaskTab === "ALL") {
    activeTaskTab = "EXCEPTIONS";
  }

  wireTaskEventListeners(root);

  // Fetch live tasks on mount
  if (!hasInitialFetchedTasks) {
    hasInitialFetchedTasks = true;
    fetchTasksFromServer().then(() => {
      if (state.route === "approvals" || state.route === "tasks") {
        refreshTasksView(root);
      }
    });
  }
}

async function fetchTasksFromServer() {
  try {
    const [res, cafeRes] = await Promise.allSettled([
      apiGet("/tasks?limit=100"),
      apiGet("/cafes"),
    ]);
    if (res.status === "fulfilled" && res.value?.data?.tasks && Array.isArray(res.value.data.tasks)) {
      liveTasks = res.value.data.tasks;
      if (res.value.data.summary) summaryMetrics = res.value.data.summary;
    } else {
      liveTasks = [...SAMPLE_TASKS];
    }
    if (cafeRes.status === "fulfilled" && cafeRes.value?.data?.cafes) {
      availableCafes = cafeRes.value.data.cafes;
    }
  } catch (err) {
    console.warn("Could not fetch tasks from server:", err);
    if (!liveTasks) liveTasks = [...SAMPLE_TASKS];
  }
}

function refreshTasksView(root) {
  const activeId = document.activeElement?.id || null;
  const cursorStart = document.activeElement?.selectionStart;
  const cursorEnd = document.activeElement?.selectionEnd;
  const container = root.querySelector(".tasks-page") || root.querySelector(".page-enter") || root;
  if (!container) return;
  container.innerHTML = renderTasks();
  wireTaskEventListeners(root);
  if (activeId) {
    const el = root.querySelector("#" + activeId);
    if (el) {
      el.focus();
      if (typeof cursorStart === "number" && typeof cursorEnd === "number" && el.setSelectionRange) {
        el.setSelectionRange(cursorStart, cursorEnd);
      }
    }
  }
}

async function openTaskDetailModal(taskId, root) {
  const allTasks = liveTasks || SAMPLE_TASKS;
  let task = allTasks.find((t) => t.taskId === taskId);
  let auditTrail = [];

  // Try to fetch fresh detail and full audit trail from server
  try {
    const res = await apiGet(`/tasks/${taskId}`);
    if (res?.data?.task) {
      task = res.data.task;
      if (Array.isArray(res.data.auditTrail)) {
        auditTrail = res.data.auditTrail;
      }
    }
  } catch (err) {
    // Use in-memory task
  }

  if (!task) {
    showToast(`Task ${taskId} not found.`, "coral");
    return;
  }

  const isOwner = state.role === ROLES.OWNER || state.role === ROLES.MASTER;
  const cafeName = getCafeName(task.cafeId);

  // Check segregation of duties: can current user verify?
  const currentUserId = state.userId ? String(state.userId).toUpperCase() : "";
  const isPerformer =
    (task.completedByUserId && String(task.completedByUserId).toUpperCase() === currentUserId) ||
    (task.assignedUserId && String(task.assignedUserId).toUpperCase() === currentUserId);
  const selfVerificationBlocked = task.verificationRequired && isPerformer;

  openModal({
    title: `Task Details · ${task.taskId}`,
    maxWidth: "700px",
    body: `
      <div style="color:var(--ink);">
        <!-- Header info -->
        <div class="oto-drawer-section">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:8px;flex-wrap:wrap;">
            <div>
              <h3 style="font-size:18px;font-weight:700;margin:0 0 4px;color:var(--ink);">${escapeHtml(task.title)}</h3>
              <div style="font-size:12px;color:var(--muted);">
                ${formatCategory(task.category)} · Café: <strong style="color:var(--ink);">${escapeHtml(cafeName)}</strong>
              </div>
            </div>
            <div style="display:flex;gap:6px;flex-wrap:wrap;">
              ${task.isCriticalControl ? `<span class="oto-badge badge-critical">CRITICAL CONTROL</span>` : ""}
              <span class="oto-badge" style="background:var(--surface-sunken);border:1px solid var(--line);">${task.status}</span>
            </div>
          </div>
          <p style="font-size:13.5px;color:var(--ink);line-height:1.5;margin:8px 0 0;">
            ${escapeHtml(task.description || "No detailed description provided.")}
          </p>
        </div>

        <!-- Scope & Assignments -->
        <div class="oto-drawer-section">
          <div class="oto-sec-title">Scope &amp; Governance</div>
          <div class="oto-grid-2col" style="font-size:13px;">
            <div>
              <span style="color:var(--muted);">Assigned To:</span>
              <strong style="color:var(--ink);display:block;">${escapeHtml(task.assignedUserId || "Unassigned")} (${escapeHtml(task.assignedRole || "STAFF")})</strong>
            </div>
            <div>
              <span style="color:var(--muted);">Accountable Manager:</span>
              <strong style="color:var(--ink);display:block;">${escapeHtml(task.responsibleUserId || "Café Admin")}</strong>
            </div>
            <div>
              <span style="color:var(--muted);">Target Due:</span>
              <strong style="color:var(--ink);display:block;">${formatDueDate(task.dueDate, task.dueTime)}</strong>
            </div>
            <div>
              <span style="color:var(--muted);">Independent Verification:</span>
              <strong style="color:var(--ink);display:block;">${task.verificationRequired ? "YES (Authorized Verifier Signoff Required)" : "NO"}</strong>
            </div>
          </div>
        </div>

        <!-- SOP Reference -->
        ${
          task.sopReference && task.sopReference.title
            ? `
            <div class="oto-drawer-section" style="background:var(--info-soft);padding:10px 12px;border-radius:6px;border:1px solid var(--info);">
              <div style="font-size:11px;color:var(--info);font-weight:700;text-transform:uppercase;margin-bottom:2px;">Standard Operating Procedure</div>
              <div style="font-size:12.5px;color:var(--ink);font-weight:600;">${escapeHtml(task.sopReference.title)} (${escapeHtml(task.sopReference.version || "v1.0")})</div>
            </div>
          `
            : ""
        }

        <!-- Checklist -->
        ${
          Array.isArray(task.checklist) && task.checklist.length > 0
            ? `
            <div class="oto-drawer-section">
              <div class="oto-sec-title">Structured Execution Checklist (${task.checklist.length})</div>
              <div>
                ${task.checklist
                  .map(
                    (c) => `
                  <div class="oto-checklist-item">
                    <span>${escapeHtml(c.item)}</span>
                    <span class="oto-badge ${c.status === "PASS" ? "badge-completed" : c.status === "FAIL" ? "badge-returned" : "badge-blocked"}">
                      ${c.status || "PENDING"}
                    </span>
                  </div>
                `
                  )
                  .join("")}
              </div>
            </div>
          `
            : ""
        }

        <!-- Blocked details -->
        ${
          task.status === "BLOCKED" && task.blockedReason
            ? `
            <div class="oto-drawer-section" style="background:var(--warning-soft);padding:12px;border-radius:6px;border:1px solid var(--warning);">
              <div class="oto-sec-title" style="color:var(--warning);">⛔ Task Blocked Impasse</div>
              <div style="font-size:13px;color:var(--ink);">${escapeHtml(task.blockedReason)}</div>
            </div>
          `
            : ""
        }

        <!-- Return History -->
        ${
          Array.isArray(task.returnHistory) && task.returnHistory.length > 0
            ? `
            <div class="oto-drawer-section" style="background:var(--danger-soft);padding:12px;border-radius:6px;border:1px solid var(--danger);">
              <div class="oto-sec-title" style="color:var(--danger);">Return &amp; Correction Trail</div>
              ${task.returnHistory
                .map(
                  (r) => `
                <div style="font-size:12.5px;margin-bottom:6px;">
                  <span style="color:var(--warning);font-weight:600;">↩ ${new Date(r.returnedAt).toLocaleDateString()} (${escapeHtml(r.returnedByUserId || "Manager")})</span>:
                  <span style="color:var(--ink);">${escapeHtml(r.reason)}</span>
                  ${r.remarks ? `<div style="font-size:11px;color:var(--muted);margin-left:14px;">Remarks: ${escapeHtml(r.remarks)}</div>` : ""}
                </div>
              `
                )
                .join("")}
            </div>
          `
            : ""
        }

        <!-- Verification Record -->
        ${
          task.verificationStatus === "VERIFIED"
            ? `
            <div class="oto-drawer-section" style="background:var(--success-soft);padding:12px;border-radius:6px;border:1px solid var(--success);">
              <div class="oto-sec-title" style="color:var(--success);">✓ Authorized Signoff Record</div>
              <div style="font-size:12.5px;color:var(--ink);">
                Verified by <strong style="color:var(--success);">${escapeHtml(task.verifiedByUserId || "Authorized Verifier")}</strong> on ${task.verifiedAt ? new Date(task.verifiedAt).toLocaleString() : "Recently"}.
              </div>
              ${task.verificationRemarks ? `<div style="font-size:12px;color:var(--muted);margin-top:4px;">Remarks: ${escapeHtml(task.verificationRemarks)}</div>` : ""}
            </div>
          `
            : ""
        }

        <!-- Audit Trail Timeline -->
        ${
          Array.isArray(auditTrail) && auditTrail.length > 0
            ? `
            <div class="oto-drawer-section">
              <div class="oto-sec-title">Governance Audit Trail (${auditTrail.length})</div>
              <div style="display:flex;flex-direction:column;gap:6px;max-height:160px;overflow-y:auto;">
                ${auditTrail.map(ev => `
                  <div style="font-size:11.5px;display:flex;justify-content:space-between;padding:4px 8px;background:var(--surface-sunken);border-radius:4px;border:1px solid var(--line);">
                    <div>
                      <strong style="color:var(--ink);">${escapeHtml(ev.action)}</strong>
                      <span style="color:var(--muted);">by ${escapeHtml(ev.actor?.userId || "System")} (${escapeHtml(ev.actor?.role || "")})</span>
                    </div>
                    <span style="color:var(--muted);font-family:var(--font-mono);">${new Date(ev.createdAt).toLocaleDateString()}</span>
                  </div>
                `).join('')}
              </div>
            </div>
          `
            : ""
        }

        <!-- Self-Verification Notice if blocked -->
        ${
          selfVerificationBlocked && task.status === "AWAITING_VERIFICATION"
            ? `
            <div style="padding:10px 14px;background:rgba(245,158,11,0.12);border:1px solid var(--warning);border-radius:6px;margin-top:14px;font-size:12.5px;color:#d97706;display:flex;align-items:center;gap:8px;">
              <span>🔒</span>
              <div>
                <strong>Independent Verification Enforced</strong>: As the performer who completed this task, you cannot verify your own work. Another authorized manager must sign off.
              </div>
            </div>
          `
            : ""
        }

        <!-- Evidence & AI Review Card -->
        ${
          task.submittedLocation || task.aiReview || (task.evidence && task.evidence.length > 0)
            ? `
            <div class="oto-drawer-section" style="background:var(--surface-sunken);padding:10px 12px;border-radius:6px;border:1px solid var(--line);">
              <div class="oto-sec-title">Completion Proof &amp; Automated Verification</div>
              ${
                task.submittedLocation
                  ? `
                  <div style="font-size:12.5px;margin-bottom:6px;">
                    <span style="color:var(--muted);">Location Proof:</span>
                    <strong style="color:${task.submittedLocation.isVerified ? 'var(--success)' : 'var(--danger)'};">
                      ${task.submittedLocation.isVerified ? '✓ Within Permitted Geofence' : '⚠ Out of Range'} (${task.submittedLocation.distanceMeters ?? 0}m)
                    </strong>
                  </div>
                `
                  : ''
              }
              ${
                task.aiReview && task.aiReview.providerStatus !== 'NONE'
                  ? `
                  <div style="font-size:12.5px;margin-bottom:6px;">
                    <span style="color:var(--muted);">AI Proof Review:</span>
                    <strong style="color:${task.aiReview.providerStatus === 'VERIFIED' ? 'var(--success)' : '#f59e0b'};">
                      ${task.aiReview.providerStatus} (${task.aiReview.confidenceScore != null ? Math.round(task.aiReview.confidenceScore * 100) + '%' : 'Pending Review'})
                    </strong>
                    <div style="font-size:11.5px;color:var(--muted);">${escapeHtml(task.aiReview.evaluationNotes || '')}</div>
                  </div>
                `
                  : ''
              }
              ${
                Array.isArray(task.evidence) && task.evidence.length > 0
                  ? `
                  <div style="font-size:12px;color:var(--muted);margin-top:4px;">
                    Attachments: ${task.evidence.map(e => `<span style="display:inline-block;padding:2px 6px;background:var(--surface);border-radius:4px;border:1px solid var(--line);margin-right:4px;">📷 ${escapeHtml(e.fileName)}</span>`).join('')}
                  </div>
                `
                  : ''
              }
            </div>
          `
            : ''
        }

        <!-- Verification / Actions Controls -->
        <div style="margin-top:20px;padding-top:16px;border-top:1px solid var(--line);display:flex;gap:10px;justify-content:flex-end;flex-wrap:wrap;">
          ${
            ["PENDING", "IN_PROGRESS", "RETURNED_FOR_CORRECTION"].includes(task.status)
              ? `
              <button class="btn btn-sm btn-primary" id="modal-submit-evidence-btn" type="button">
                📸 Submit Checklist &amp; GPS Proof
              </button>
            `
              : ""
          }
          ${
            task.status === "AWAITING_VERIFICATION" && isOwner
              ? `
              <button class="btn btn-sm btn-ghost" id="modal-return-task-btn" type="button" style="color:var(--danger);border:1px solid var(--danger);">
                ↩ Return for Correction
              </button>
              ${
                !selfVerificationBlocked
                  ? `
                  <button class="btn btn-sm btn-primary" id="modal-verify-task-btn" type="button">
                    ✓ Verify &amp; Sign Off
                  </button>
                `
                  : ""
              }
            `
              : ""
          }
          ${
            task.status === "COMPLETED" && isOwner
              ? `
              <button class="btn btn-sm btn-ghost" id="modal-reopen-task-btn" type="button" style="color:var(--warning);border:1px solid var(--warning);">
                ↻ Reopen Task
              </button>
            `
              : ""
          }
          ${
            task.status !== "COMPLETED" && task.status !== "CANCELLED" && isOwner
              ? `
              <button class="btn btn-sm btn-secondary" id="modal-reassign-task-btn" type="button">
                👥 Reassign Task
              </button>
              <button class="btn btn-sm btn-ghost" id="modal-block-task-btn" type="button" style="color:#fbbf24;border:1px solid rgba(245,158,11,0.3);">
                ⛔ Block Task
              </button>
              <button class="btn btn-sm btn-ghost" id="modal-cancel-task-btn" type="button" style="color:#94a3b8;">
                Cancel Task
              </button>
            `
              : ""
          }
        </div>
      </div>
    `,
    showSave: false,
    cancelLabel: "Close",
  });

  // Modal Action Listeners
  setTimeout(() => {
    const verifyBtn = document.querySelector("#modal-verify-task-btn");
    if (verifyBtn) {
      verifyBtn.addEventListener("click", async () => {
        verifyBtn.disabled = true;
        document.querySelector(".modal-backdrop")?.remove();
        await handleVerifyTask(task.taskId, root);
      });
    }

    const returnBtn = document.querySelector("#modal-return-task-btn");
    if (returnBtn) {
      returnBtn.addEventListener("click", () => {
        document.querySelector(".modal-backdrop")?.remove();
        openReturnTaskModal(task.taskId, root);
      });
    }

    const reopenBtn = document.querySelector("#modal-reopen-task-btn");
    if (reopenBtn) {
      reopenBtn.addEventListener("click", () => {
        document.querySelector(".modal-backdrop")?.remove();
        openReopenTaskModal(task.taskId, root);
      });
    }

    const reassignBtn = document.querySelector("#modal-reassign-task-btn");
    if (reassignBtn) {
      reassignBtn.addEventListener("click", () => {
        document.querySelector(".modal-backdrop")?.remove();
        openReassignTaskModal(task, root);
      });
    }

    const blockBtn = document.querySelector("#modal-block-task-btn");
    if (blockBtn) {
      blockBtn.addEventListener("click", () => {
        document.querySelector(".modal-backdrop")?.remove();
        openBlockTaskModal(task.taskId, root);
      });
    }

    const cancelBtn = document.querySelector("#modal-cancel-task-btn");
    if (cancelBtn) {
      cancelBtn.addEventListener("click", () => {
        document.querySelector(".modal-backdrop")?.remove();
        openCancelTaskModal(task.taskId, root);
      });
    }

    const submitEvBtn = document.querySelector("#modal-submit-evidence-btn");
    if (submitEvBtn) {
      submitEvBtn.addEventListener("click", () => {
        document.querySelector(".modal-backdrop")?.remove();
        openSubmitEvidenceModal(task, root);
      });
    }
  }, 50);
}

async function handleVerifyTask(taskId, root) {
  try {
    await apiPost(`/tasks/${taskId}/verify`, { remarks: "Verified by Authorized Owner." });
    showToast(`Task ${taskId} verified successfully!`, "mint");
    await fetchTasksFromServer();
    refreshTasksView(root);
  } catch (err) {
    showToast(err.message || `Failed to verify task ${taskId}`, "coral");
  }
}

function openReturnTaskModal(taskId, root) {
  openModal({
    title: `Return Task ${taskId} for Correction`,
    maxWidth: "480px",
    body: `
      <div>
        <label class="label" style="color:var(--ink, #18181b);font-weight:700;font-size:12px;margin-bottom:6px;display:block;">Mandatory Return Reason *</label>
        <textarea id="return-task-reason" class="input" rows="3" placeholder="Specify why the submission was rejected (e.g. missing pressure calibration sticker, incomplete backflush)..." required style="width:100%;box-sizing:border-box;"></textarea>
      </div>
    `,
    saveLabel: "Return for Correction",
    onSave: async (modalEl) => {
      const reason = modalEl.querySelector("#return-task-reason")?.value?.trim();
      if (!reason) {
        showToast("Mandatory return reason is required.", "coral");
        return false;
      }
      try {
        await apiPost(`/tasks/${taskId}/return`, { reason });
        showToast(`Task ${taskId} returned for correction.`, "amber");
        await fetchTasksFromServer();
        refreshTasksView(root);
        return true;
      } catch (err) {
        showToast(err.message || `Failed to return task ${taskId}`, "coral");
        return false;
      }
    },
  });
}

function openReopenTaskModal(taskId, root) {
  openModal({
    title: `Reopen Task ${taskId}`,
    maxWidth: "480px",
    body: `
      <div>
        <label class="label" style="color:var(--ink, #18181b);font-weight:700;font-size:12px;margin-bottom:6px;display:block;">Reopen Justification *</label>
        <textarea id="reopen-task-reason" class="input" rows="3" placeholder="State reason for reopening completed task..." required style="width:100%;box-sizing:border-box;"></textarea>
      </div>
    `,
    saveLabel: "Reopen Task",
    onSave: async (modalEl) => {
      const reason = modalEl.querySelector("#reopen-task-reason")?.value?.trim();
      if (!reason) {
        showToast("Reason is required to reopen task.", "coral");
        return false;
      }
      try {
        await apiPost(`/tasks/${taskId}/reopen`, { reason });
        showToast(`Task ${taskId} reopened successfully.`, "mint");
        await fetchTasksFromServer();
        refreshTasksView(root);
        return true;
      } catch (err) {
        showToast(err.message || `Failed to reopen task ${taskId}`, "coral");
        return false;
      }
    },
  });
}

function openBlockTaskModal(taskId, root) {
  openModal({
    title: `Block Task ${taskId}`,
    maxWidth: "480px",
    body: `
      <div>
        <label class="label" style="color:var(--ink, #18181b);font-weight:700;font-size:12px;margin-bottom:6px;display:block;">Block Reason &amp; Root Cause Category *</label>
        <select id="block-task-category" class="select" style="margin-bottom:10px;width:100%;box-sizing:border-box;">
          <option value="EQUIPMENT_UNAVAILABLE">Equipment / Asset Unavailable</option>
          <option value="SPARE_PART_UNAVAILABLE">Spare Part / Material Missing</option>
          <option value="VENDOR_DEPENDENCY">Vendor / Contractor Dependency</option>
          <option value="STAFFING_SHORTAGE">Staffing Shortage</option>
          <option value="ACCESS_RESTRICTION">Facility Access Restriction</option>
          <option value="OTHER">Other Operational Impasse</option>
        </select>
        <textarea id="block-task-reason" class="input" rows="3" placeholder="State specific impediment..." required style="width:100%;box-sizing:border-box;"></textarea>
      </div>
    `,
    saveLabel: "Mark as Blocked",
    onSave: async (modalEl) => {
      const cat = modalEl.querySelector("#block-task-category")?.value;
      const text = modalEl.querySelector("#block-task-reason")?.value?.trim();
      if (!text) {
        showToast("Specific impediment reason is required.", "coral");
        return false;
      }
      const reason = `[${cat}] ${text}`;
      try {
        await apiPost(`/tasks/${taskId}/block`, { reason });
        showToast(`Task ${taskId} marked as blocked.`, "amber");
        await fetchTasksFromServer();
        refreshTasksView(root);
        return true;
      } catch (err) {
        showToast(err.message || `Failed to block task ${taskId}`, "coral");
        return false;
      }
    },
  });
}

function openCancelTaskModal(taskId, root) {
  openModal({
    title: `Cancel Task ${taskId}`,
    maxWidth: "480px",
    body: `
      <div>
        <label class="label" style="color:var(--ink, #18181b);font-weight:700;font-size:12px;margin-bottom:6px;display:block;">Mandatory Cancellation Reason *</label>
        <textarea id="cancel-task-reason" class="input" rows="3" placeholder="Specify why this task is being cancelled..." required style="width:100%;box-sizing:border-box;"></textarea>
      </div>
    `,
    saveLabel: "Cancel Task",
    onSave: async (modalEl) => {
      const reason = modalEl.querySelector("#cancel-task-reason")?.value?.trim();
      if (!reason) {
        showToast("Cancellation reason is required.", "coral");
        return false;
      }
      try {
        await apiPost(`/tasks/${taskId}/cancel`, { reason });
        showToast(`Task ${taskId} cancelled.`, "mint");
        await fetchTasksFromServer();
        refreshTasksView(root);
        return true;
      } catch (err) {
        showToast(err.message || `Failed to cancel task ${taskId}`, "coral");
        return false;
      }
    },
  });
}

function openReassignTaskModal(task, root) {
  openModal({
    title: `Reassign Task ${task.taskId}`,
    maxWidth: "500px",
    body: `
      <div style="display:flex;flex-direction:column;gap:12px;">
        <div>
          <label class="label" style="color:var(--ink, #18181b);font-weight:700;font-size:12px;margin-bottom:4px;display:block;">Assignee User ID *</label>
          <input type="text" id="reassign-user" class="input" value="${escapeHtml(task.assignedUserId || '')}" placeholder="e.g. USR-BARISTA-02" required style="width:100%;box-sizing:border-box;" />
        </div>
        <div>
          <label class="label" style="color:var(--ink, #18181b);font-weight:700;font-size:12px;margin-bottom:4px;display:block;">Accountable Supervisor / Manager</label>
          <input type="text" id="reassign-responsible" class="input" value="${escapeHtml(task.responsibleUserId || '')}" placeholder="e.g. USR-ADMIN-01" style="width:100%;box-sizing:border-box;" />
        </div>
        <div>
          <label class="label" style="color:var(--ink, #18181b);font-weight:700;font-size:12px;margin-bottom:4px;display:block;">Target Role</label>
          <select id="reassign-role" class="select" style="width:100%;box-sizing:border-box;">
            <option value="STAFF" ${task.assignedRole === "STAFF" ? "selected" : ""}>Staff Performer</option>
            <option value="CAFE_ADMIN" ${task.assignedRole === "CAFE_ADMIN" ? "selected" : ""}>Café Admin / Supervisor</option>
            <option value="OWNER" ${task.assignedRole === "OWNER" ? "selected" : ""}>Owner</option>
            <option value="MASTER" ${task.assignedRole === "MASTER" ? "selected" : ""}>Master</option>
          </select>
        </div>
      </div>
    `,
    saveLabel: "Reassign Task",
    onSave: async (modalEl) => {
      const assignedUserId = modalEl.querySelector("#reassign-user")?.value?.trim();
      const responsibleUserId = modalEl.querySelector("#reassign-responsible")?.value?.trim();
      const assignedRole = modalEl.querySelector("#reassign-role")?.value;

      if (!assignedUserId) {
        showToast("Assignee User ID is required.", "coral");
        return false;
      }

      try {
        await apiPost(`/tasks/${task.taskId}/assign`, {
          assignedUserId,
          responsibleUserId: responsibleUserId || assignedUserId,
          assignedRole,
        });
        showToast(`Task ${task.taskId} reassigned to ${assignedUserId}.`, "mint");
        await fetchTasksFromServer();
        refreshTasksView(root);
        return true;
      } catch (err) {
        showToast(err.message || `Failed to reassign task ${task.taskId}`, "coral");
        return false;
      }
    },
  });
}

function openAssignTaskModal(root) {
  openModal({
    title: "Assign Operational / Compliance Task",
    maxWidth: "640px",
    body: `
      <form id="new-task-form" style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px;width:100%;box-sizing:border-box;">
        <div style="grid-column:1/-1;">
          <label class="label" style="color:var(--ink, #18181b);font-weight:700;font-size:12px;margin-bottom:4px;display:block;">Task Title *</label>
          <input type="text" id="assign-title" class="input" placeholder="e.g. Espresso Machine Chemical Backflush & Pressure Tag" required style="width:100%;box-sizing:border-box;" />
        </div>

        <div style="grid-column:1/-1;">
          <label class="label" style="color:var(--ink, #18181b);font-weight:700;font-size:12px;margin-bottom:4px;display:block;">Description / SOP Details</label>
          <textarea id="assign-desc" class="input" rows="2" placeholder="Specify step-by-step procedure or expectations..." style="width:100%;box-sizing:border-box;"></textarea>
        </div>

        <div>
          <label class="label" style="color:var(--ink, #18181b);font-weight:700;font-size:12px;margin-bottom:4px;display:block;">Authorized Café *</label>
          <select id="assign-cafe" class="select" required style="width:100%;box-sizing:border-box;">
            ${availableCafes.map(c => `
              <option value="${c.code || c.id || c._id || c.cafeId}">
                ${c.code || c.cafeId ? (c.code || c.cafeId) + " · " : ""}${c.name}
              </option>
            `).join('')}
          </select>
        </div>

        <div>
          <label class="label" style="color:var(--ink, #18181b);font-weight:700;font-size:12px;margin-bottom:4px;display:block;">Category *</label>
          <select id="assign-category" class="select" style="width:100%;box-sizing:border-box;">
            <option value="EQUIPMENT_MAINTENANCE">Equipment Maintenance</option>
            <option value="SAFETY_COMPLIANCE">Safety & Compliance</option>
            <option value="INVENTORY_RECEIVING">Inventory Receiving</option>
            <option value="CASH_CONTROL_AUDIT">Cash Control Audit</option>
            <option value="HYGIENE_INSPECTION">Hygiene Inspection</option>
            <option value="MANAGEMENT_DELEGATION">Management Delegation</option>
            <option value="GENERAL_OPERATIONS">General Operations</option>
          </select>
        </div>

        <div>
          <label class="label" style="color:var(--ink, #18181b);font-weight:700;font-size:12px;margin-bottom:4px;display:block;">Assignee (Performer) *</label>
          <input type="text" id="assign-user" class="input" placeholder="e.g. USR-BARISTA-01" required style="width:100%;box-sizing:border-box;" />
        </div>

        <div>
          <label class="label" style="color:var(--ink, #18181b);font-weight:700;font-size:12px;margin-bottom:4px;display:block;">Accountable Manager</label>
          <input type="text" id="assign-responsible" class="input" placeholder="e.g. USR-ADMIN-01" style="width:100%;box-sizing:border-box;" />
        </div>

        <div>
          <label class="label" style="color:var(--ink, #18181b);font-weight:700;font-size:12px;margin-bottom:4px;display:block;">Priority</label>
          <select id="assign-priority" class="select" style="width:100%;box-sizing:border-box;">
            <option value="NORMAL">Normal Priority</option>
            <option value="HIGH">High Priority</option>
            <option value="URGENT">Urgent (Immediate Attention)</option>
            <option value="LOW">Low Priority</option>
          </select>
        </div>

        <div>
          <label class="label" style="color:var(--ink, #18181b);font-weight:700;font-size:12px;margin-bottom:4px;display:block;">Risk Level</label>
          <select id="assign-risk" class="select" style="width:100%;box-sizing:border-box;">
            <option value="LOW">Low Exposure</option>
            <option value="MEDIUM">Medium Exposure</option>
            <option value="HIGH">High Risk</option>
            <option value="CRITICAL">Critical Statutory/Safety</option>
          </select>
        </div>

        <div>
          <label class="label" style="color:var(--ink, #18181b);font-weight:700;font-size:12px;margin-bottom:4px;display:block;">Due Date *</label>
          <input type="date" id="assign-duedate" class="input" value="${getIstDateString()}" required style="width:100%;box-sizing:border-box;" />
        </div>

        <div>
          <label class="label" style="color:var(--ink, #18181b);font-weight:700;font-size:12px;margin-bottom:4px;display:block;">Due Time</label>
          <input type="time" id="assign-duetime" class="input" value="22:00" style="width:100%;box-sizing:border-box;" />
        </div>

        <div>
          <label class="label" style="color:var(--ink, #18181b);font-weight:700;font-size:12px;margin-bottom:4px;display:block;">Recurrence</label>
          <select id="assign-recurrence" class="select" style="width:100%;box-sizing:border-box;">
            <option value="NONE">One-Time Task</option>
            <option value="DAILY">Daily Recurring</option>
            <option value="WEEKLY">Weekly Recurring</option>
            <option value="MONTHLY">Monthly Recurring</option>
          </select>
        </div>

        <div>
          <label class="label" style="color:var(--ink, #18181b);font-weight:700;font-size:12px;margin-bottom:4px;display:block;">SOP Code / Procedure</label>
          <input type="text" id="assign-sop" class="input" placeholder="e.g. SOP-EQ-004 v2.1" style="width:100%;box-sizing:border-box;" />
        </div>

        <div style="grid-column:1/-1;display:flex;gap:20px;margin-top:4px;flex-wrap:wrap;">
          <label style="display:flex;align-items:center;gap:6px;font-size:13px;color:var(--ink,#18181b);cursor:pointer;font-weight:600;">
            <input type="checkbox" id="assign-critical-control" />
            <span>Flag as <strong>Critical Control</strong></span>
          </label>
          <label style="display:flex;align-items:center;gap:6px;font-size:13px;color:var(--ink,#18181b);cursor:pointer;font-weight:600;">
            <input type="checkbox" id="assign-verify-req" checked />
            <span>Require <strong>Authorized Verification</strong></span>
          </label>
        </div>
      </form>
    `,
    saveLabel: "Assign Task",
    onSave: async (modalEl) => {
      const title = modalEl.querySelector("#assign-title")?.value?.trim();
      const description = modalEl.querySelector("#assign-desc")?.value?.trim();
      const cafeId = modalEl.querySelector("#assign-cafe")?.value;
      const category = modalEl.querySelector("#assign-category")?.value;
      const assignedUserId = modalEl.querySelector("#assign-user")?.value?.trim();
      const responsibleUserId = modalEl.querySelector("#assign-responsible")?.value?.trim();
      const priority = modalEl.querySelector("#assign-priority")?.value;
      const risk = modalEl.querySelector("#assign-risk")?.value;
      const dueDate = modalEl.querySelector("#assign-duedate")?.value;
      const dueTime = modalEl.querySelector("#assign-duetime")?.value;
      const recurrenceFreq = modalEl.querySelector("#assign-recurrence")?.value;
      const sopCode = modalEl.querySelector("#assign-sop")?.value?.trim();
      const isCriticalControl = modalEl.querySelector("#assign-critical-control")?.checked;
      const verificationRequired = modalEl.querySelector("#assign-verify-req")?.checked;

      if (!title || !assignedUserId || !dueDate) {
        showToast("Title, Assignee, and Due Date are required.", "coral");
        return false;
      }

      const payload = {
        title,
        description,
        cafeId,
        category,
        assignedUserId,
        responsibleUserId: responsibleUserId || assignedUserId,
        priority,
        risk,
        dueDate,
        dueTime,
        isCriticalControl,
        verificationRequired,
        sopReference: sopCode ? { title: sopCode, version: "v1.0", docUrl: "#" } : undefined,
        recurrence: recurrenceFreq !== "NONE" ? { isRecurring: true, frequency: recurrenceFreq, occurrenceIndex: 1 } : { isRecurring: false },
      };

      try {
        await apiPost("/tasks", payload);
        showToast("Task assigned successfully!", "mint");
        await fetchTasksFromServer();
        refreshTasksView(root);
        return true;
      } catch (err) {
        showToast(err.message || "Failed to assign task", "coral");
        return false;
      }
    },
  });
}

function openComplianceReportModal(root) {
  openModal({
    title: "Multi-Outlet Task Compliance & Oversight (F331, F333)",
    maxWidth: "750px",
    body: `
      <div id="compliance-modal-body" style="color:var(--ink);padding:4px 0;">
        <div style="display:flex;justify-content:center;padding:20px;color:var(--muted);">
          <span>Loading compliance metrics across outlets...</span>
        </div>
      </div>
    `,
    showSave: false,
    cancelLabel: "Close",
  });

  setTimeout(async () => {
    try {
      const res = await apiGet("/tasks/reports/compliance");
      const rep = res?.data?.report;
      const bodyEl = document.querySelector("#compliance-modal-body");
      if (!bodyEl || !rep) return;

      const outlets = Object.entries(rep.byOutlet || {});

      bodyEl.innerHTML = `
        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:16px;">
          <div style="background:var(--surface-sunken);padding:10px;border-radius:6px;border:1px solid var(--line);text-align:center;">
            <div style="font-size:11px;color:var(--muted);text-transform:uppercase;font-weight:700;">Completion Rate</div>
            <div style="font-size:22px;font-weight:800;color:var(--success);margin-top:2px;">${rep.completionRate}%</div>
          </div>
          <div style="background:var(--surface-sunken);padding:10px;border-radius:6px;border:1px solid var(--line);text-align:center;">
            <div style="font-size:11px;color:var(--muted);text-transform:uppercase;font-weight:700;">On-Time Rate</div>
            <div style="font-size:22px;font-weight:800;color:#38bdf8;margin-top:2px;">${rep.onTimeRate}%</div>
          </div>
          <div style="background:var(--surface-sunken);padding:10px;border-radius:6px;border:1px solid var(--line);text-align:center;">
            <div style="font-size:11px;color:var(--muted);text-transform:uppercase;font-weight:700;">Geofence Compliance</div>
            <div style="font-size:22px;font-weight:800;color:#a855f7;margin-top:2px;">${rep.geofenceComplianceRate}%</div>
          </div>
          <div style="background:var(--surface-sunken);padding:10px;border-radius:6px;border:1px solid var(--line);text-align:center;">
            <div style="font-size:11px;color:var(--muted);text-transform:uppercase;font-weight:700;">Photo Proofs</div>
            <div style="font-size:22px;font-weight:800;color:#f59e0b;margin-top:2px;">${rep.photoEvidenceCount}</div>
          </div>
        </div>

        <div style="font-size:13px;font-weight:700;margin-bottom:6px;color:var(--ink);">Outlet Oversight Breakdown</div>
        <table style="width:100%;font-size:12.5px;border-collapse:collapse;margin-bottom:16px;border:1px solid var(--line);">
          <thead>
            <tr style="background:var(--surface-sunken);border-bottom:1px solid var(--line);text-align:left;">
              <th style="padding:6px 10px;">Café / Outlet</th>
              <th style="padding:6px 10px;text-align:right;">Total Tasks</th>
              <th style="padding:6px 10px;text-align:right;">Completed</th>
              <th style="padding:6px 10px;text-align:right;">Overdue</th>
            </tr>
          </thead>
          <tbody>
            ${outlets.map(([cafeId, st]) => `
              <tr style="border-bottom:1px solid var(--line);">
                <td style="padding:6px 10px;font-weight:600;">${escapeHtml(getCafeName(cafeId))}</td>
                <td style="padding:6px 10px;text-align:right;">${st.total}</td>
                <td style="padding:6px 10px;text-align:right;color:var(--success);font-weight:600;">${st.completed}</td>
                <td style="padding:6px 10px;text-align:right;color:${st.overdue > 0 ? 'var(--danger)' : 'var(--muted)'};font-weight:600;">${st.overdue}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `;
    } catch (err) {
      const bodyEl = document.querySelector("#compliance-modal-body");
      if (bodyEl) {
        bodyEl.innerHTML = `<div style="color:var(--danger);padding:10px;">Failed to load compliance report: ${escapeHtml(err.message)}</div>`;
      }
    }
  }, 50);
}

function openSubmitEvidenceModal(task, root) {
  const checklist = Array.isArray(task.checklist) ? task.checklist : [];

  openModal({
    title: `Submit Evidence & Complete · ${task.taskId}`,
    maxWidth: "600px",
    body: `
      <form id="evidence-form" style="display:flex;flex-direction:column;gap:14px;color:var(--ink);">
        <div>
          <div style="font-weight:700;font-size:14px;margin-bottom:2px;">${escapeHtml(task.title)}</div>
          <div style="font-size:12px;color:var(--muted);">${formatCategory(task.category)} · Target: ${formatDueDate(task.dueDate, task.dueTime)}</div>
        </div>

        ${checklist.length > 0 ? `
          <div style="background:var(--surface-sunken);padding:10px 12px;border-radius:6px;border:1px solid var(--line);">
            <div style="font-size:12px;font-weight:700;margin-bottom:6px;text-transform:uppercase;color:var(--ink);">Checklist Sign-off (${checklist.length})</div>
            ${checklist.map((c, i) => `
              <div style="display:flex;align-items:center;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--line);font-size:12.5px;">
                <span>${escapeHtml(c.item)}</span>
                <label style="display:flex;align-items:center;gap:6px;cursor:pointer;">
                  <input type="checkbox" class="ev-check-item" data-index="${i}" checked />
                  <span style="font-size:11px;font-weight:600;color:var(--success);">PASS</span>
                </label>
              </div>
            `).join('')}
          </div>
        ` : ''}

        <div>
          <label class="label" style="font-weight:700;font-size:12px;margin-bottom:4px;display:block;">Photo Proof (Filename / URL)</label>
          <input type="text" id="ev-photo-url" class="input" placeholder="e.g. https://storage.local/evidence/opening-sanitisation.jpg" value="evidence-photo-${task.taskId}.jpg" style="width:100%;box-sizing:border-box;" />
        </div>

        <div style="background:var(--surface-sunken);padding:10px 12px;border-radius:6px;border:1px solid var(--line);">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
            <span style="font-size:12px;font-weight:700;color:var(--ink);">GPS Geofence Location Proof</span>
            <button class="btn btn-sm btn-secondary" type="button" id="ev-capture-gps-btn" style="font-size:11px;">📍 Capture GPS Location</button>
          </div>
          <div style="grid-template-columns:1fr 1fr;gap:8px;display:grid;">
            <div>
              <label style="font-size:11px;color:var(--muted);display:block;">Latitude</label>
              <input type="number" step="any" id="ev-lat" class="input input-sm" placeholder="11.2588" value="11.2588" style="width:100%;box-sizing:border-box;" />
            </div>
            <div>
              <label style="font-size:11px;color:var(--muted);display:block;">Longitude</label>
              <input type="number" step="any" id="ev-lng" class="input input-sm" placeholder="75.7804" value="75.7804" style="width:100%;box-sizing:border-box;" />
            </div>
          </div>
          <div id="ev-gps-status" style="font-size:11px;color:var(--muted);margin-top:4px;">Coordinates captured for site geofence validation.</div>
        </div>

        <div>
          <label class="label" style="font-weight:700;font-size:12px;margin-bottom:4px;display:block;">Completion Notes &amp; Observations</label>
          <textarea id="ev-notes" class="input" rows="2" placeholder="Describe any observations or anomalies noticed during checklist execution..." style="width:100%;box-sizing:border-box;"></textarea>
        </div>
      </form>
    `,
    saveLabel: "Submit Evidence & Complete",
    onSave: async (modalEl) => {
      const photoUrl = modalEl.querySelector("#ev-photo-url")?.value?.trim();
      const latVal = Number.parseFloat(modalEl.querySelector("#ev-lat")?.value);
      const lngVal = Number.parseFloat(modalEl.querySelector("#ev-lng")?.value);
      const notes = modalEl.querySelector("#ev-notes")?.value?.trim();

      const updatedChecklist = checklist.map((c, i) => {
        const checkbox = modalEl.querySelector(`.ev-check-item[data-index="${i}"]`);
        return {
          item: c.item,
          status: checkbox && checkbox.checked ? "PASS" : "FAIL",
          failureReason: checkbox && !checkbox.checked ? "Reported as failed during execution" : "",
        };
      });

      const payload = {
        checklist: updatedChecklist,
        evidence: photoUrl ? [{ fileId: `FILE-${Date.now()}`, fileName: photoUrl, fileUrl: photoUrl }] : [],
        location: !Number.isNaN(latVal) && !Number.isNaN(lngVal) ? { latitude: latVal, longitude: lngVal, accuracyMeters: 5 } : undefined,
        notes: notes || "Completed via Stepwise checklist execution",
      };

      try {
        const res = await apiPost(`/tasks/${task.taskId}/submit-evidence`, payload);
        const aiStatus = res.data?.aiEvaluation?.providerStatus || "PENDING";
        showToast(`Task ${task.taskId} submitted! AI Review: ${aiStatus}`, "mint");
        await fetchTasksFromServer();
        refreshTasksView(root);
        return true;
      } catch (err) {
        showToast(err.message || "Failed to submit task evidence", "coral");
        return false;
      }
    },
  });

  setTimeout(() => {
    const gpsBtn = document.querySelector("#ev-capture-gps-btn");
    if (gpsBtn && navigator.geolocation) {
      gpsBtn.addEventListener("click", () => {
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            const latInput = document.querySelector("#ev-lat");
            const lngInput = document.querySelector("#ev-lng");
            const statusEl = document.querySelector("#ev-gps-status");
            if (latInput) latInput.value = pos.coords.latitude.toFixed(6);
            if (lngInput) lngInput.value = pos.coords.longitude.toFixed(6);
            if (statusEl) statusEl.textContent = `📍 Captured live coordinates (±${Math.round(pos.coords.accuracy)}m)`;
          },
          (err) => {
            showToast("GPS permission denied or unavailable: using manual site coordinates", "amber");
          }
        );
      });
    }
  }, 50);
}

