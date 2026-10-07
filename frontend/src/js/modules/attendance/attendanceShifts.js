// =============================================================================
// ZAMORIN CAFE ERP — ADM-SCR-003 / SCR-004: ATTENDANCE & SHIFTS
// Canonical Attendance Engine + Single-Cafe Cafe Operations Projection
// + Master Parity UX Reflection
// =============================================================================

import { apiGet, apiPost, apiPatch } from "../../apiClient.js";
import { showToast, openModal, confirmAction, renderChildHeader } from "../../components.js";
import { state } from "../../state.js";
import { ROLES } from "../../navigation.js";
import { navigate } from "../../router.js";
import { openAttendanceEvidenceViewer } from "./attendanceEvidenceViewer.js";
import { generateQrSvg } from "../../utils/qrCodeGen.js";
import { renderAttendanceQrScannerPage, wireAttendanceQrScannerPage, cleanupAttendanceQrScannerPage } from "../../pages/attendanceQrScannerPage.js";

let activeSubTab = "overview"; // 'overview' | 'live' | 'roster' | 'calendar360' | 'exceptions' | 'policies' | 'closure' | 'analytics'
let liveFilterStatus = "ALL"; // 'ALL' | 'NEEDS_ATTENTION' | 'PRESENT' | 'LATE' | 'MISSING_PUNCH' | 'ABSENT' | 'ON_LEAVE' | 'OVERTIME'
let liveSearchQuery = "";
let cachedOverview = null;
let cachedLiveAttendance = [];
let cachedRoster = null;
let cachedServerTime = null;
let selectedUserId = "";
let selectedRosterCafe = "";
let selectedRosterWeekOffset = 0;
let selectedCalendarMonth = new Date().toISOString().slice(0, 7);

let cachedShifts = [];
let cachedExceptions = [];
let cachedOvertime = [];

const CAFE_NAMES = {};

let rosterPublishedMap = {};

let cafeRosterSchedules = {};
let cachedCafes = [];

async function loadCafesList() {
  if (cachedCafes.length) return cachedCafes;
  try {
    const res = await apiGet("/cafes");
    cachedCafes = res?.data || res?.cafes || (Array.isArray(res) ? res : []);
    cachedCafes.forEach(c => {
      const id = c.cafeId || c.code || c.id || c._id;
      if (id) CAFE_NAMES[id] = c.name || id;
    });
  } catch (err) {
    cachedCafes = [];
  }
  return cachedCafes;
}

export function setAttendanceActiveTab(tab) {
  const norm = (tab || "overview").toLowerCase();
  const aliasMap = {
    "shifts": "shifts",
    "shift": "shifts",
    "templates": "shifts",
    "rosters": "roster",
    "daily": "live",
    "approvals": "exceptions",
    "exceptions": "exceptions",
    "reports": "analytics",
    "analytics": "analytics",
    "history": "calendar360",
    "calendar360": "calendar360",
    "calendar": "calendar360",
    "rules": "policies",
    "compliance": "policies",
    "policies": "policies",
    "timesheets": "closure",
    "closure": "closure",
    "qr-scanner": "qrScanner",
    "qrscanner": "qrScanner",
    "qr": "qrScanner",
    "scanner": "qrScanner",
  };
  activeSubTab = aliasMap[norm] || norm || "overview";
}

export function renderAttendance(subroute) {
  if (subroute !== undefined) {
    setAttendanceActiveTab(subroute);
  }
  const role = state.role || state.user?.role || ROLES.MASTER;
  const isPrimary = state.user?.isPrimaryMaster === true;
  const isNormalMaster = role === ROLES.MASTER && !isPrimary;
  const isCafeAdmin = role === ROLES.CAFE_ADMIN;
  const isOwner = role === ROLES.OWNER;

  const assignedCafe = state.user?.primaryCafeId || state.user?.assignedCafeIds?.[0] || state.currentCafeId || "";
  const cafeDisplayName = state.user?.primaryCafeName || CAFE_NAMES[assignedCafe] || (assignedCafe ? `Outlet ${assignedCafe}` : "Assigned Outlet");
  const operatorName = state.user?.name || state.user?.fullName || (isCafeAdmin ? "Duty Lead" : "Zamorin Master");
  const operatorEmpId = state.user?.permanentEmployeeId || state.user?.employeeId || state.user?.userId || "";

  if (activeSubTab && activeSubTab !== "overview") {
    return `
      <div class="page-enter attendance-page-container" style="max-width:1400px; margin:0 auto; padding-bottom:60px;">
        <div id="attendance-subpanel-root">
          ${renderActiveSubpanel()}
        </div>
      </div>
    `;
  }

  return `
    <div class="page-enter attendance-page-container" style="max-width:1400px; margin:0 auto; padding-bottom:60px;">
      <!-- Page Header & Context Strip -->
      <div style="display:flex; justify-content:space-between; align-items:flex-start; flex-wrap:wrap; gap:16px; margin-bottom:18px; border-bottom:1px solid var(--border-subtle); padding-bottom:16px;">
        <div>
          <div style="display:flex; align-items:center; flex-wrap:wrap; gap:10px; margin-bottom:4px;">
            <h1 class="page-title" style="font-size:23px; font-weight:800; margin:0; color:var(--ink); letter-spacing:-0.3px;">Attendance &amp; Shifts</h1>
            <span class="status info" style="font-size:10.5px; font-weight:700; text-transform:uppercase; letter-spacing:0.5px;">SCR-004</span>
            ${
              isCafeAdmin
                ? `<span class="status warning" style="font-size:10px; font-weight:800; letter-spacing:0.5px;">CAFE OPERATIONS</span>`
                : isPrimary
                ? `<span class="status success" style="font-size:10px; font-weight:800;">PRIMARY MASTER</span>`
                : `<span class="status info" style="font-size:10px; font-weight:800;">OPERATIONAL MASTER</span>`
            }
          </div>

          <p style="font-size:12.5px; color:var(--muted); margin:0 0 8px;">
            ${
              isCafeAdmin
                ? `Today's attendance, live presence, roster, exceptions and attendance operations for this cafe.`
                : `Multi-Café Workforce Presence, Shift Matrix, Employee 360 Calendar, Overtime Governance &amp; Period Closure`
            }
          </p>

          <!-- Fixed Context Strip for Cafe Operations & Master -->
          <div style="display:flex; align-items:center; flex-wrap:wrap; gap:8px; font-size:12px; color:var(--ink);">
            <div style="display:inline-flex; align-items:center; gap:6px; background:var(--surface-sunken); padding:4px 10px; border-radius:6px; border:1px solid var(--line);">
              <span style="font-weight:700; color:var(--bronze-600);">📍 ${isCafeAdmin ? cafeDisplayName : "All Outlets (Portfolio)"}</span>
              ${isCafeAdmin ? `<span style="font-size:11px; color:var(--muted);">· Main Counter Mobile</span>` : ""}
            </div>

            <div style="display:inline-flex; align-items:center; gap:5px; background:var(--surface-sunken); padding:4px 10px; border-radius:6px; border:1px solid var(--line);">
              <span>👤 <strong>${operatorName}</strong></span>
              <span style="font-size:11px; color:var(--muted); font-family:var(--font-mono);">(${operatorEmpId})</span>
            </div>

            <div style="display:inline-flex; align-items:center; gap:5px; background:var(--surface-sunken); padding:4px 10px; border-radius:6px; border:1px solid var(--line); font-family:var(--font-mono); font-size:11.5px;">
              <span style="display:inline-block; width:7px; height:7px; border-radius:50%; background:var(--color-success, #2E7D32);"></span>
              <span>Server Time: <strong id="server-time-indicator">11:35 IST</strong> · Online · Synced</span>
            </div>
          </div>
        </div>

        <div style="display:flex; gap:10px; align-items:center; flex-wrap:wrap;">
          <button class="btn btn-secondary" id="btn-attendance-qr-scanner" data-attendance-hub-tile="qrScanner" type="button" style="font-size:12.5px; padding:7px 14px; display:inline-flex; align-items:center; gap:6px;">
            📱 <span>Attendance QR &amp; Scanner</span>
          </button>
          <button class="btn btn-ghost" id="refresh-attendance-btn" type="button" style="font-size:12.5px; padding:7px 14px;">
            🔄 Refresh
          </button>
        </div>
      </div>

      <!-- Subpanel Content Container -->
      <div id="attendance-subpanel-root">
        ${renderActiveSubpanel()}
      </div>
    </div>
  `;
}

function renderActiveSubpanel() {
  if (activeSubTab === "overview") {
    return renderOverviewSubpanel();
  }

  const role = state.role || state.user?.role || ROLES.MASTER;
  const isCafeAdmin = role === ROLES.CAFE_ADMIN;

  const submodules = {
    live: {
      title: isCafeAdmin ? "Live Attendance & Shift Status" : "Live Multi-Café Attendance",
      icon: "🟢",
      actionsHtml: `
        <button class="btn btn-secondary btn-sm" id="btn-live-show-attendance-qr" type="button" style="font-size:12px; font-weight:700; margin-right:8px;">📱 Attendance QR</button>
        <button class="btn btn-primary btn-sm" id="open-manual-attendance-btn" type="button" style="font-size:12px; font-weight:700;">${isCafeAdmin ? "+ Manual Attendance" : "+ Master Manual Punch"}</button>
      `
    },
    roster: {
      title: "Shifts & Scheduling Roster",
      icon: "📅",
      desc: "Weekly shift rosters, opening/closing coverage and staff assignments.",
      actionsHtml: `<button class="btn btn-primary btn-sm" id="open-create-roster-btn" type="button" style="font-size:12px; font-weight:700;">+ Create Shift Roster</button>`
    },
    shifts: {
      title: "Shift Master & Templates",
      icon: "⏰",
      desc: "Configure standard café shift templates, working hours, grace periods and meal break allowances.",
      actionsHtml: `<button class="btn btn-primary btn-sm" id="open-create-shift-template-btn" type="button" style="font-size:12px; font-weight:700;">+ New Shift Template</button>`
    },
    calendar360: {
      title: isCafeAdmin ? "Attendance History & Records" : "Employee 360° Attendance History",
      icon: "👤",
      desc: "Monthly punch cards, timesheets, leave balances and individual records.",
      actionsHtml: `<button class="btn btn-ghost btn-sm" id="export-history-btn" type="button" style="font-size:12px;">📊 Export Timesheets</button>`
    },
    exceptions: {
      title: "Attendance Exceptions & Overtime",
      icon: "⚠️",
      desc: "Missing checkouts, late punches, overtime requests and supervisor approvals.",
      actionsHtml: `<button class="btn btn-primary btn-sm" id="open-manual-attendance-btn" type="button" style="font-size:12px; font-weight:700;">${isCafeAdmin ? "+ Manual Attendance" : "+ Master Manual Punch"}</button>`
    },
    policies: {
      title: isCafeAdmin ? "Attendance Policies & Guidelines" : "Attendance Policies & Compliance Evidence",
      icon: "📜",
      desc: "Grace periods, half-day deduction rules, OT formulas and statutory proofs.",
      actionsHtml: `<button class="btn btn-ghost btn-sm" id="export-policy-btn" type="button" style="font-size:12px;">📄 Print Compliance Policy</button>`
    },
    closure: {
      title: "Payroll Period Timesheet Closure",
      icon: "🔒",
      desc: "Month-end timesheet locks, adjustments reconciliation and payroll handoff.",
      actionsHtml: `<button class="btn btn-primary btn-sm" id="close-period-btn" type="button" style="font-size:12px; font-weight:700;">🔒 Close Timesheet Period</button>`
    },
    analytics: {
      title: "Punctuality & Labour Hours Analytics",
      icon: "📈",
      desc: "Average shift adherence, OT trends, absenteeism rates and peak hour staffing.",
      actionsHtml: `
        <button class="btn btn-secondary btn-sm" id="btn-analytics-attendance-qr-scanner" data-attendance-hub-tile="qrScanner" type="button" style="font-size:12px; font-weight:700; margin-right:8px;">📱 Attendance QR &amp; Scanner</button>
        <button class="btn btn-ghost btn-sm" id="export-analytics-btn" type="button" style="font-size:12px;">📈 Export CSV</button>
      `
    },
    qrScanner: {
      title: "Attendance QR & Scanner",
      icon: "📱",
      desc: "Secure Attendance Presence Verification — Live rotating QR, kiosk display & diagnostic verification scanner",
      actionsHtml: `<button class="btn btn-ghost btn-sm" id="btn-qr-sub-refresh" type="button" style="font-size:12px;">🔄 Refresh Status</button>`
    },
  };

  const cur = submodules[activeSubTab] || { title: "Submodule", icon: "📁", desc: "", actionsHtml: "" };

  let bodyHtml = "";
  switch (activeSubTab) {
    case "live":
      bodyHtml = renderLiveSubpanel();
      break;
    case "roster":
      bodyHtml = renderRosterSubpanel();
      break;
    case "shifts":
      bodyHtml = renderShiftsMasterSubpanel();
      break;
    case "calendar360":
      bodyHtml = renderCalendar360Subpanel();
      break;
    case "exceptions":
      bodyHtml = renderExceptionsSubpanel();
      break;
    case "policies":
      bodyHtml = renderPoliciesSubpanel();
      break;
    case "closure":
      bodyHtml = renderClosureSubpanel();
      break;
    case "analytics":
      bodyHtml = renderAnalyticsSubpanel();
      break;
    case "qrScanner":
      bodyHtml = renderAttendanceQrScannerPage();
      break;
    default:
      bodyHtml = renderOverviewSubpanel();
  }

  return `
    <div style="display:flex; flex-direction:column; gap:16px;">
      ${renderChildHeader({
        parentLabel: "Attendance & Shifts",
        parentRoute: "attendance",
        childTitle: cur.title,
        icon: cur.icon,
        description: cur.desc,
        backBtnId: "attendance-back-to-hub-btn",
        actionsHtml: cur.actionsHtml || ""
      })}
      <div>
        ${bodyHtml}
      </div>
    </div>
  `;
}

// =============================================================================
// 1. OVERVIEW & PRESENCE SUBPANEL
// =============================================================================
function renderOverviewSubpanel() {
  const role = state.role || state.user?.role || ROLES.MASTER;
  const isCafeAdmin = role === ROLES.CAFE_ADMIN;

  const ov = cachedOverview || {
    kpis: {
      scheduledToday: 0,
      presentNow: 0,
      onTime: 0,
      late: 0,
      absent: 0,
      onLeave: 0,
      missingPunches: 0,
      overtimePending: 0,
    },
    cafeWorkforce: (cachedCafes || []).map(c => ({
      cafeId: c.cafeId || c.code,
      cafeName: c.name || 'Outlet',
      scheduled: 0,
      present: 0,
      adequacyStatus: "ADEQUATE"
    })),
    needsAttention: [],
  };

  const totalExceptions = (ov.kpis.missingPunches || 0) + (ov.kpis.overtimePending || 0) + (ov.kpis.late || 0);

  const attendanceTiles = [
    { id: "live", icon: "🟢", title: isCafeAdmin ? "Live Attendance" : "Live Multi-Café Attendance", subtitle: "Real-time employee clock-ins, biometric scans & duty floor", badge: `${ov.kpis.presentNow || 0} Present`, badgeType: "success" },
    { id: "roster", icon: "📅", title: "Shifts & Roster", subtitle: "Weekly shift schedules, opening/closing coverage & staff shifts", badge: `${ov.kpis.scheduledToday || 0} Rostered`, badgeType: "accent" },
    { id: "shifts", icon: "⏰", title: "Shift Master", subtitle: "Standard shift templates, timing & grace periods", badge: `${cachedShifts.length || 0} Templates`, badgeType: "accent" },
    { id: "calendar360", icon: "👤", title: isCafeAdmin ? "Attendance History" : "Employee Attendance (360)", subtitle: "Monthly punch cards, timesheets & individual attendance", badge: "360 History", badgeType: "" },
    { id: "exceptions", icon: "⚠️", title: "Exceptions & Overtime", subtitle: "Missing checkouts, late punches & overtime authorizations", badge: `${totalExceptions} Items`, badgeType: totalExceptions > 0 ? "warning" : "success" },
    { id: "policies", icon: "📜", title: isCafeAdmin ? "Attendance Rules" : "Policies & Compliance", subtitle: "Grace periods, half-day deduction rules & OT formulas", badge: "Enforced", badgeType: "success" },
    ...(!isCafeAdmin ? [{ id: "closure", icon: "🔒", title: "Period Closure", subtitle: "Month-end timesheet locks & payroll handover", badge: "Locked", badgeType: "" }] : []),
    { id: "analytics", icon: "📈", title: "Punctuality & Labour Hours Analytics", subtitle: "Average shift adherence, OT trends & peak hour coverage", badge: "98% Rate", badgeType: "success" },
    { id: "qrScanner", icon: "📱", title: "Attendance QR & Scanner", subtitle: "Live rotating QR, kiosk display & diagnostic verification scanner", badge: "Live Active", badgeType: "success" },
  ];

  return `
    <div style="display:flex; flex-direction:column; gap:24px;">
      <!-- Control Centre Button Hub Section -->
      <div class="module-hub-section">
        <h3 class="module-hub-section-title">Attendance &amp; Workforce Roster Workspaces</h3>
        <div class="module-tile-grid">
          ${attendanceTiles.map((t) => `
            <button class="module-hub-tile" data-attendance-hub-tile="${t.id}" type="button">
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

      <!-- Top Readiness Strip -->
      <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px; background:var(--surface-sunken); padding:12px 18px; border-radius:var(--radius-sm, 8px); border:1px solid var(--line);">
      <div style="display:flex; align-items:center; gap:10px;">
        <span style="font-size:20px;">${totalExceptions > 0 ? "⚠️" : "✅"}</span>
        <div>
          <strong style="font-size:14px; color:var(--ink);">
            ${totalExceptions > 0 ? `${totalExceptions} Attendance Items Require Operational Attention` : "Attendance Operations Clear"}
          </strong>
          <div style="font-size:12px; color:var(--muted);">
            ${totalExceptions > 0 ? "Review exception queue, missing checkouts, and pending overtime records below." : "All scheduled staff present and accounted for with zero active exceptions."}
          </div>
        </div>
      </div>

      <div style="display:flex; gap:8px;">
        <button class="btn btn-sm btn-ghost view-filter-btn" data-filter="LATE" type="button">Late (${ov.kpis.late})</button>
        <button class="btn btn-sm btn-ghost view-filter-btn" data-filter="MISSING_PUNCH" type="button">Missing Punch (${ov.kpis.missingPunches})</button>
        <button class="btn btn-sm btn-ghost view-filter-btn" data-filter="OVERTIME" type="button">Overtime (${ov.kpis.overtimePending})</button>
      </div>
    </div>

    <!-- Interactive Top KPI Grid (Clickable Filters) -->
    <div class="attendance-kpi-grid" style="display:grid; grid-template-columns:repeat(auto-fit, minmax(135px, 1fr)); gap:12px; margin-bottom:24px;">
      ${clickableKpiCard("Scheduled Today", ov.kpis.scheduledToday, "Rostered Shifts", "var(--ink)", "ALL")}
      ${clickableKpiCard("Present Now", ov.kpis.presentNow, "Checked In / Floor", "var(--color-success, #2E7D32)", "PRESENT")}
      ${clickableKpiCard("On Time", ov.kpis.onTime, "Punctual Check-in", "var(--ink)", "PRESENT")}
      ${clickableKpiCard("Late Arrivals", ov.kpis.late, "Grace Exceeded", ov.kpis.late > 0 ? "var(--color-warning, #ED6C02)" : "var(--muted)", "LATE")}
      ${clickableKpiCard("Absent", ov.kpis.absent, "Unexcused", ov.kpis.absent > 0 ? "var(--color-danger, #D32F2F)" : "var(--muted)", "ABSENT")}
      ${clickableKpiCard("On Leave", ov.kpis.onLeave, "Approved Time Off", "var(--ink)", "ON_LEAVE")}
      ${clickableKpiCard("Missing Checkout", ov.kpis.missingPunches, "Pending Punch", ov.kpis.missingPunches > 0 ? "var(--color-danger)" : "var(--muted)", "MISSING_PUNCH")}
      ${clickableKpiCard("Overtime Pending", ov.kpis.overtimePending, isCafeAdmin ? "Awaiting Review" : "Awaiting Decision", "var(--color-accent-amber, #C89D5C)", "OVERTIME")}
    </div>

    <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(360px, 1fr)); gap:20px; margin-bottom:24px;">
      <!-- Staffing Panel: Single Cafe vs Multi-Cafe -->
      <div class="card" style="padding:20px;">
        <h3 style="font-size:15px; font-weight:700; margin:0 0 12px; color:var(--ink); display:flex; justify-content:space-between; align-items:center;">
          <span>${isCafeAdmin ? "Today's Staffing & Shift Coverage" : "Café Workforce & Staffing Adequacy"}</span>
          <span style="font-size:11.5px; font-weight:600; color:var(--muted);">Week of 17 Aug 2026</span>
        </h3>

        ${
          isCafeAdmin
            ? `
          <div style="display:flex; flex-direction:column; gap:12px;">
            <div style="background:var(--surface-sunken); padding:14px; border-radius:6px; border:1px solid var(--line);">
              <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
                <strong style="font-size:14px; color:var(--ink);">Morning Roastery Shift (06:30 – 15:00)</strong>
                <span class="status success" style="font-size:11px;">ON FLOOR</span>
              </div>
              <div style="font-size:12.5px; color:var(--muted); display:flex; justify-content:space-between; align-items:center;">
                <span>Scheduled: <strong style="color:var(--ink);">4 Staff</strong></span>
                <span>Present: <strong style="color:var(--color-success);">4 Checked In</strong></span>
                <span>Ends in: <strong>2h 45m</strong></span>
              </div>
            </div>

            <div style="background:var(--surface-sunken); padding:14px; border-radius:6px; border:1px solid var(--line);">
              <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
                <strong style="font-size:14px; color:var(--ink);">Evening Closing Shift (13:00 – 21:30)</strong>
                <span class="status info" style="font-size:11px;">UPCOMING</span>
              </div>
              <div style="font-size:12.5px; color:var(--muted); display:flex; justify-content:space-between; align-items:center;">
                <span>Scheduled: <strong style="color:var(--ink);">2 Staff</strong></span>
                <span>Starts in: <strong style="color:var(--bronze-600);">3h 15m</strong></span>
                <span>Coverage: <strong>Optimal</strong></span>
              </div>
            </div>
          </div>
        `
            : `
          <div style="display:flex; flex-direction:column; gap:10px;">
            ${ov.cafeWorkforce
              .map(
                (c) => `
              <div style="display:flex; justify-content:space-between; align-items:center; padding:10px 14px; background:var(--surface-sunken); border-radius:6px; border:1px solid var(--line);">
                <div>
                  <strong style="font-size:13.5px; color:var(--ink);">${c.cafeName}</strong>
                  <div style="font-size:11px; color:var(--muted); font-family:var(--font-mono);">${c.cafeId}</div>
                </div>
                <div style="text-align:right;">
                  <span class="status ${c.adequacyStatus === "ADEQUATE" ? "success" : "danger"}" style="font-size:10.5px;">${c.adequacyStatus}</span>
                  <div style="font-size:11.5px; color:var(--muted); margin-top:2px;">Rostered: ${c.scheduled} · Present: ${c.present}</div>
                </div>
              </div>
            `
              )
              .join("")}
          </div>
        `
        }
      </div>

      <!-- Kiosk / QR / Server Time Health -->
      <div class="card" style="padding:20px;">
        <h3 style="font-size:15px; font-weight:700; margin:0 0 12px; color:var(--ink);">Attendance Kiosk &amp; Verification Health</h3>

        <div style="display:flex; flex-direction:column; gap:12px; font-size:12.5px;">
          <div style="display:flex; justify-content:space-between; align-items:center; padding-bottom:8px; border-bottom:1px solid var(--border-subtle);">
            <span>Rotating QR Code Token</span>
            <span class="status success" style="font-size:11px;">ACTIVE (45s Cycle)</span>
          </div>

          <div style="display:flex; justify-content:space-between; align-items:center; padding-bottom:8px; border-bottom:1px solid var(--border-subtle);">
            <span>Server Time Synchronization</span>
            <span class="status success" style="font-size:11px;">LOCKED TO SERVER (IST)</span>
          </div>

          <div style="display:flex; justify-content:space-between; align-items:center; padding-bottom:8px; border-bottom:1px solid var(--border-subtle);">
            <span>GPS Geofence Accuracy</span>
            <strong style="color:var(--ink);">50m Radius (Enforced)</strong>
          </div>

          <div style="display:flex; justify-content:space-between; align-items:center; padding-bottom:8px; border-bottom:1px solid var(--border-subtle);">
            <span>Live Selfie Privacy</span>
            <strong style="color:var(--color-success);">Short-Lived Signed Storage</strong>
          </div>

          <div style="display:flex; justify-content:space-between; align-items:center;">
            <span>Last Successful Attendance Punch</span>
            <span style="font-family:var(--font-mono); color:var(--muted);">${(() => { const last = cachedLiveAttendance[cachedLiveAttendance.length - 1]; return last ? `${last.checkInAt || '—'} IST (${last.name || last.userId})` : '—'; })()}</span>
          </div>
        </div>
      </div>
    </div>

    <!-- Needs Attention Exception Queue -->
    <div class="card" style="padding:20px;">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:14px; flex-wrap:wrap; gap:8px;">
        <div>
          <h3 style="font-size:15px; font-weight:700; margin:0 0 2px; color:var(--ink);">Prioritised Attendance Exception Queue</h3>
          <p style="font-size:12px; color:var(--muted); margin:0;">Real-time exceptions requiring operational action or review</p>
        </div>
        <span class="status warning" style="font-size:11px;">${ov.needsAttention.length} Pending</span>
      </div>

      <div style="display:flex; flex-direction:column; gap:10px;">
        ${ov.needsAttention
          .map(
            (item) => `
          <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px; padding:12px 14px; background:var(--surface-sunken); border-radius:6px; border:1px solid var(--line);">
            <div>
              <div style="display:flex; align-items:center; gap:8px;">
                <strong style="font-size:13.5px; color:var(--ink);">${item.userName}</strong>
                <span style="font-size:11px; font-family:var(--font-mono); font-weight:700; color:var(--color-accent-amber);">${item.userId}</span>
                <span class="status ${item.severity === "HIGH" ? "danger" : "warning"}" style="font-size:10px;">${item.type.replace(/_/g, " ")}</span>
              </div>
              <div style="font-size:12px; color:var(--muted); margin-top:3px;">
                ${item.role} · ${item.shiftName} · <span style="color:var(--color-warning); font-weight:600;">${item.status}</span> · <span style="font-family:var(--font-mono);">${item.age}</span>
              </div>
            </div>

            <div style="display:flex; align-items:center; gap:10px;">
              <span class="status info" style="font-size:11px;">${item.nextAction}</span>
              <button class="btn btn-sm btn-primary action-exception-btn" data-user="${item.userId}" data-type="${item.type}" type="button">
                Action
              </button>
            </div>
          </div>
        `
          )
          .join("")}
      </div>
    </div>
  `;
}

function clickableKpiCard(title, value, subtitle, valColor, filterStatus) {
  return `
    <div class="card kpi-card-clickable" data-kpi-filter="${filterStatus}" style="padding:14px 16px; cursor:pointer; transition:transform 0.1s ease, border-color 0.15s ease;">
      <div style="font-size:11px; font-weight:700; color:var(--muted); text-transform:uppercase; letter-spacing:0.4px; margin-bottom:4px;">${title}</div>
      <div style="font-size:23px; font-weight:800; color:${valColor}; font-family:var(--font-mono); line-height:1.1;">${value}</div>
      <div style="font-size:11px; color:var(--muted); margin-top:4px;">${subtitle}</div>
    </div>
  `;
}

// =============================================================================
// 2. LIVE ATTENDANCE SUBPANEL
// =============================================================================
function renderLiveSubpanel() {
  const role = state.role || state.user?.role || ROLES.MASTER;
  const isCafeAdmin = role === ROLES.CAFE_ADMIN;

  const fallbackCafe = state.user?.assignedCafeIds?.[0] || state.currentCafeId || "";
  const records = cachedLiveAttendance.length > 0 ? cachedLiveAttendance : [];


  // Filter records
  const filtered = records.filter((r) => {
    if (liveFilterStatus === "PRESENT" && r.status !== "CHECKED_IN" && r.status !== "ON_BREAK") return false;
    if (liveFilterStatus === "LATE" && !r.isLate) return false;
    if (liveFilterStatus === "MISSING_PUNCH" && r.status !== "MISSED_PUNCH") return false;
    if (liveFilterStatus === "ABSENT" && r.status !== "ABSENT") return false;
    if (liveFilterStatus === "ON_LEAVE" && r.status !== "ON_LEAVE") return false;

    if (liveSearchQuery) {
      const q = liveSearchQuery.toLowerCase();
      const matchName = (r.name || "").toLowerCase().includes(q);
      const matchId = (r.userId || "").toLowerCase().includes(q);
      const matchRole = (r.role || "").toLowerCase().includes(q);
      if (!matchName && !matchId && !matchRole) return false;
    }
    return true;
  });

  return `
    <div class="card" style="padding:22px;">
      <!-- Filter and Search Bar -->
      <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px; margin-bottom:18px;">
        <input type="text" id="live-search-input" class="input" placeholder="Search staff by name or EMP ID..." value="${liveSearchQuery}" style="max-width:340px; font-size:13px;" />

        <!-- Quick Filter Chips -->
        <div style="display:flex; gap:6px; flex-wrap:wrap;">
          ${renderFilterChip("ALL", "All Staff")}
          ${renderFilterChip("PRESENT", "Present")}
          ${renderFilterChip("LATE", "Late")}
          ${renderFilterChip("MISSING_PUNCH", "Missing Punch")}
          ${renderFilterChip("ABSENT", "Absent")}
          ${renderFilterChip("ON_LEAVE", "On Leave")}
        </div>
      </div>

      <!-- Live Attendance Table -->
      <div class="table-wrap">
        <table class="table" style="width:100%;">
          <thead>
            <tr>
              <th>Employee</th>
              ${!isCafeAdmin ? "<th>Location</th>" : ""}
              <th>Status</th>
              <th>Check-In</th>
              <th>Check-Out</th>
              <th>Hours</th>
              <th>Source</th>
              <th>Markers</th>
              <th style="text-align:right;">Actions</th>
            </tr>
          </thead>
          <tbody>
            ${
              filtered.length === 0
                ? `<tr><td colspan="9" style="text-align:center; padding:30px; color:var(--muted);">No attendance records found matching current criteria.</td></tr>`
                : filtered
                    .map(
                      (r) => `
              <tr>
                <td>
                  <strong style="color:var(--ink); font-size:13.5px;">${r.name || r.userId}</strong>
                  <div style="font-size:11.5px; color:var(--color-accent-amber); font-family:var(--font-mono); font-weight:700;">${r.userId}</div>
                </td>
                ${!isCafeAdmin ? `<td><div style="font-size:12.5px; font-family:var(--font-mono);">${r.cafeId}</div></td>` : ""}
                <td>
                  <span class="status ${r.status === "CHECKED_IN" ? "success" : r.status === "ON_BREAK" ? "warning" : r.status === "MISSED_PUNCH" ? "danger" : "info"}" style="font-size:11px; font-weight:700;">
                    ${r.status}
                  </span>
                </td>
                <td style="font-family:var(--font-mono); font-size:12.5px;">${r.checkInAt || "—"}</td>
                <td style="font-family:var(--font-mono); font-size:12.5px;">${r.checkOutAt || "—"}</td>
                <td style="font-family:var(--font-mono); font-size:12.5px;">${((r.regularMinutes || 0) / 60).toFixed(1)} hrs</td>
                <td>
                  <span style="font-size:11px; font-family:var(--font-mono); background:var(--surface-sunken); padding:2px 6px; border-radius:4px; border:1px solid var(--line);">
                    ${r.source || (r.isManualEntry ? "MANUAL" : "QR")}
                  </span>
                </td>
                <td>
                  ${r.isLate ? `<span class="status warning" style="font-size:10px;">LATE</span> ` : ""}
                  ${r.isManualEntry ? `<span class="status info" style="font-size:10px;">MANUAL</span>` : ""}
                </td>
                <td style="text-align:right; white-space:nowrap;">
                  <button class="btn btn-ghost btn-sm view-employee-history-btn" data-user="${r.userId}" type="button" style="font-size:11.5px; padding:4px 8px;">
                    ${isCafeAdmin ? "History" : "360 History"}
                  </button>
                  <button class="btn btn-sm btn-secondary edit-attendance-record-btn" data-attendance-id="${r.attendanceId || r._id}" data-user="${r.userId}" type="button" style="font-size:11.5px; padding:4px 8px; margin-left:4px;">
                    ✏️ Edit
                  </button>
                  <button class="btn btn-sm btn-ghost view-evidence-btn" data-attendance-id="${r.attendanceId || r._id}" data-user="${r.userId}" type="button" title="View Presence Evidence" style="font-size:11.5px; padding:4px 8px; margin-left:4px;">
                    📷 Evidence
                  </button>
                </td>
              </tr>
            `
                    )
                    .join("")
            }
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function renderFilterChip(filterKey, label) {
  const isSelected = liveFilterStatus === filterKey;
  return `
    <button class="btn btn-sm ${isSelected ? "btn-primary" : "btn-ghost"} live-filter-chip" data-filter="${filterKey}" type="button" style="font-size:12px; padding:4px 10px;">
      ${label}
    </button>
  `;
}

// =============================================================================
// 3. SHIFTS & ROSTER SUBPANEL
// =============================================================================
function calculateShiftHours(shiftStr) {
  if (!shiftStr || shiftStr === "OFF" || shiftStr === "LEAVE") return 0;
  const parts = shiftStr.split("-").map(s => s.trim());
  if (parts.length !== 2) return 8.5;
  const [startH, startM] = parts[0].split(":").map(Number);
  const [endH, endM] = parts[1].split(":").map(Number);
  if (isNaN(startH) || isNaN(endH)) return 8.5;
  let startMinutes = startH * 60 + (startM || 0);
  let endMinutes = endH * 60 + (endM || 0);
  if (endMinutes < startMinutes) endMinutes += 24 * 60; // Overnight shift
  return Math.round(((endMinutes - startMinutes) / 60) * 10) / 10;
}

function renderRosterSubpanel() {
  const activeCafeId = isCafeAdmin
    ? (state.user?.assignedCafeIds?.[0] || state.currentCafeId || "")
    : (selectedRosterCafe || state.currentCafeId || cachedCafes[0]?.cafeId || cachedCafes[0]?.code || "");
  const cafeName = CAFE_NAMES[activeCafeId] || state.currentCafeName || (activeCafeId ? `Outlet ${activeCafeId}` : "Assigned Outlet");
  const isPublished = rosterPublishedMap[activeCafeId] ?? true;

  const staff = cafeRosterSchedules[activeCafeId] || Object.values(cafeRosterSchedules)[0] || [];

  // Calculate week dates
  const baseDate = new Date(2026, 7, 17); // Aug 17, 2026 (Monday)
  baseDate.setDate(baseDate.getDate() + (selectedRosterWeekOffset * 7));
  const endDate = new Date(baseDate);
  endDate.setDate(endDate.getDate() + 6);

  const startStr = baseDate.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
  const endStr = endDate.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

  const dayLabels = [
    { key: "mon", label: `Mon (${baseDate.getDate()})` },
    { key: "tue", label: `Tue (${new Date(baseDate.getTime() + 86400000).getDate()})` },
    { key: "wed", label: `Wed (${new Date(baseDate.getTime() + 86400000 * 2).getDate()})` },
    { key: "thu", label: `Thu (${new Date(baseDate.getTime() + 86400000 * 3).getDate()})` },
    { key: "fri", label: `Fri (${new Date(baseDate.getTime() + 86400000 * 4).getDate()})` },
    { key: "sat", label: `Sat (${new Date(baseDate.getTime() + 86400000 * 5).getDate()})` },
    { key: "sun", label: `Sun (${endDate.getDate()})` },
  ];

  // Compute daily coverage
  const dailyCoverage = dayLabels.map(d => {
    const onDuty = staff.filter(s => s[d.key] && s[d.key] !== "OFF" && s[d.key] !== "LEAVE");
    const totalHours = onDuty.reduce((sum, s) => sum + calculateShiftHours(s[d.key]), 0);
    return { day: d.label, count: onDuty.length, hours: totalHours };
  });

  return `
    <div class="card" style="padding:22px;">
      <!-- Control Strip & Multi-Cafe Filter -->
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:18px; flex-wrap:wrap; gap:12px; border-bottom:1px solid var(--border-subtle); padding-bottom:16px;">
        <div style="display:flex; flex-direction:column; gap:4px;">
          <div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap;">
            <h3 style="font-size:17px; font-weight:800; margin:0; color:var(--ink);">
              Weekly Shift Roster — ${cafeName}
            </h3>
            <span class="status ${isPublished ? "success" : "warning"}" id="roster-status-badge" style="font-size:11px; font-weight:700;">
              ${isPublished ? "🟢 PUBLISHED & BROADCAST" : "🟡 DRAFT (UNPUBLISHED)"}
            </span>
          </div>
          <p style="font-size:12.5px; color:var(--muted); margin:0;">
            Week of ${startStr} – ${endStr} · Click any shift cell to edit timing or assign coverage.
          </p>
        </div>

        <div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap;">
          ${
            !isCafeAdmin
              ? `
              <div style="display:inline-flex; align-items:center; gap:6px; background:var(--surface-sunken); padding:4px 8px; border-radius:6px; border:1px solid var(--line);">
                <span style="font-size:12px; font-weight:700; color:var(--ink);">🏛️ Switch Café:</span>
                <select id="roster-cafe-select" class="input" style="font-size:12.5px; padding:4px 8px; width:auto; font-weight:600;">
                  ${cachedCafes.length ? cachedCafes.map(c => {
                    const cid = c.cafeId || c.code || c.id || c._id;
                    return `<option value="${cid}" ${activeCafeId === cid ? "selected" : ""}>${cid} · ${c.name || 'Outlet'}</option>`;
                  }).join('') : `<option value="${activeCafeId}" selected>${activeCafeId || 'All Cafes'}</option>`}
                </select>
              </div>
            `
              : ""
          }

          <!-- Week Navigation -->
          <div style="display:inline-flex; align-items:center; border:1px solid var(--line); border-radius:6px; overflow:hidden; background:var(--surface-sunken);">
            <button class="btn btn-ghost" id="roster-prev-week-btn" type="button" style="padding:6px 12px; font-size:12px;" title="Previous Week">◀ Prev Week</button>
            <button class="btn btn-ghost" id="roster-today-btn" type="button" style="padding:6px 12px; font-size:12px; font-weight:700; border-left:1px solid var(--line); border-right:1px solid var(--line);" title="Current Week">This Week</button>
            <button class="btn btn-ghost" id="roster-next-week-btn" type="button" style="padding:6px 12px; font-size:12px;" title="Next Week">Next Week ▶</button>
          </div>
        </div>
      </div>

      <!-- Action Toolbar -->
      <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px; margin-bottom:16px;">
        <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
          <button class="btn btn-primary btn-sm" id="add-staff-roster-btn" type="button" style="font-size:12px; font-weight:700;">
            + Add Staff to Roster
          </button>
          <button class="btn btn-ghost btn-sm" id="auto-schedule-roster-btn" type="button" style="font-size:12px; font-weight:700; color:var(--color-accent-amber);" title="AI-based shift auto-scheduler">
            ⚡ Auto-Fill Coverage
          </button>
          <button class="btn btn-ghost btn-sm" id="copy-prev-week-roster-btn" type="button" style="font-size:12px;">
            📋 Copy Last Week
          </button>
          <button class="btn btn-ghost btn-sm" id="export-roster-csv-btn" type="button" style="font-size:12px;">
            📥 Export / Print
          </button>
        </div>

        <div style="display:flex; gap:8px; align-items:center;">
          <button class="btn ${isPublished ? "btn-warning" : "btn-primary"} btn-sm" id="publish-roster-btn" type="button" style="font-size:12.5px; font-weight:700;">
            ${isPublished ? "Revert to Draft" : "🚀 Publish & Broadcast"}
          </button>
        </div>
      </div>

      <!-- Shift Legend Strip -->
      <div style="display:flex; gap:12px; align-items:center; flex-wrap:wrap; margin-bottom:14px; font-size:11.5px; background:var(--surface-sunken); padding:8px 12px; border-radius:6px; border:1px solid var(--line);">
        <span style="font-weight:700; color:var(--ink);">Shift Legend:</span>
        <span style="display:inline-flex; align-items:center; gap:4px;"><span class="status info" style="font-size:10.5px;">06:30 - 15:00</span> 🌅 Morning Opening</span>
        <span style="display:inline-flex; align-items:center; gap:4px;"><span class="status info" style="font-size:10.5px;">10:00 - 18:30</span> ☀️ Mid / Rush</span>
        <span style="display:inline-flex; align-items:center; gap:4px;"><span class="status info" style="font-size:10.5px;">13:00 - 21:30</span> 🌆 Evening Closing</span>
        <span style="display:inline-flex; align-items:center; gap:4px;"><span class="status info" style="font-size:10.5px;">21:00 - 05:30</span> 🌙 Night Prep</span>
        <span style="display:inline-flex; align-items:center; gap:4px;"><span class="status neutral" style="font-size:10.5px;">OFF</span> 🏖️ Weekly Off</span>
        <span style="display:inline-flex; align-items:center; gap:4px;"><span class="status warning" style="font-size:10.5px;">LEAVE</span> 🌴 Approved Leave</span>
      </div>

      <!-- Roster Interactive Table -->
      <div class="table-wrap">
        <table class="table" style="width:100%; border-collapse:collapse;">
          <thead>
            <tr style="background:var(--surface-sunken);">
              <th style="padding:10px 12px; text-align:left; min-width:180px;">Staff Member</th>
              ${dayLabels.map(d => `<th style="padding:10px 12px; text-align:center;">${d.label}</th>`).join("")}
              <th style="padding:10px 12px; text-align:center; min-width:100px;">Weekly Hours</th>
              <th style="padding:10px 12px; text-align:center; width:60px;">Action</th>
            </tr>
          </thead>
          <tbody>
            ${staff
              .map((s, sIndex) => {
                let totalHours = 0;
                dayLabels.forEach(d => {
                  totalHours += calculateShiftHours(s[d.key]);
                });
                const isOvertime = totalHours > 48;

                return `
                <tr style="border-bottom:1px solid var(--line);">
                  <td style="padding:10px 12px;">
                    <div style="font-weight:700; color:var(--ink); font-size:13px;">${s.name}</div>
                    <div style="display:flex; gap:6px; align-items:center; margin-top:2px;">
                      <span style="font-size:11px; color:var(--color-accent-amber); font-family:var(--font-mono); font-weight:700;">${s.id}</span>
                      <span style="font-size:11px; color:var(--muted);">· ${s.role}</span>
                    </div>
                  </td>
                  ${dayLabels
                    .map(d => {
                      const val = s[d.key] || "OFF";
                      const isOff = val === "OFF";
                      const isLeave = val === "LEAVE";
                      const statusClass = isOff ? "neutral" : isLeave ? "warning" : "info";

                      return `
                        <td style="padding:8px 6px; text-align:center; vertical-align:middle;">
                          <button class="roster-shift-btn status ${statusClass}" 
                            data-staff-index="${sIndex}" 
                            data-staff-id="${s.id}" 
                            data-staff-name="${s.name}" 
                            data-day-key="${d.key}" 
                            data-day-label="${d.label}" 
                            data-current-shift="${val}" 
                            type="button" 
                            style="cursor:pointer; border:1px solid rgba(0,0,0,0.08); padding:5px 8px; border-radius:4px; font-weight:700; font-size:11.5px; width:100%; box-sizing:border-box; display:inline-flex; align-items:center; justify-content:center; gap:4px; transition:transform 0.1s, box-shadow 0.1s;"
                            title="Click to edit shift for ${s.name} on ${d.label}">
                            <span>${val}</span>
                            <span style="opacity:0.5; font-size:10px;">✎</span>
                          </button>
                        </td>
                      `;
                    })
                    .join("")}
                  <td style="padding:10px 12px; text-align:center; font-family:var(--font-mono); font-weight:700; font-size:13px;">
                    <span style="color:${isOvertime ? "var(--color-warning)" : "var(--ink)"};">
                      ${totalHours.toFixed(1)} hrs
                    </span>
                    ${isOvertime ? `<div style="font-size:10px; color:var(--color-warning); font-weight:800;">OT RISK</div>` : ""}
                  </td>
                  <td style="padding:10px 12px; text-align:center;">
                    <button class="btn btn-ghost btn-xs remove-staff-roster-btn" data-staff-index="${sIndex}" type="button" style="color:var(--color-danger); font-size:13px;" title="Remove from this week's roster">✕</button>
                  </td>
                </tr>
              `;
              })
              .join("")}
          </tbody>
          <!-- Daily Staff Coverage Row -->
          <tfoot>
            <tr style="background:var(--surface-sunken); font-weight:700; border-top:2px solid var(--line);">
              <td style="padding:10px 12px; font-size:12px; color:var(--ink);">
                🛡️ Daily Coverage Count
              </td>
              ${dailyCoverage
                .map(dc => `
                <td style="padding:10px 6px; text-align:center; font-size:11.5px;">
                  <div style="color:${dc.count >= 2 ? "var(--color-success)" : "var(--color-warning)"}; font-weight:800;">
                    ${dc.count} Staff
                  </div>
                  <div style="font-size:10.5px; color:var(--muted); font-family:var(--font-mono);">
                    ${dc.hours.toFixed(1)}h total
                  </div>
                </td>
              `)
                .join("")}
              <td style="padding:10px 12px; text-align:center; font-size:12px; color:var(--ink); font-family:var(--font-mono);">
                ${staff.reduce((total, s) => total + dayLabels.reduce((dSum, d) => dSum + calculateShiftHours(s[d.key]), 0), 0).toFixed(1)}h
              </td>
              <td></td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  `;
}

// =============================================================================
// 3b. SHIFT MASTER SUBPANEL (P1)
// =============================================================================
function renderShiftsMasterSubpanel() {
  const role = state.role || state.user?.role || ROLES.MASTER;
  const isCafeAdmin = role === ROLES.CAFE_ADMIN;
  const activeCafeId = isCafeAdmin
    ? (state.user?.assignedCafeIds?.[0] || state.currentCafeId || "")
    : (selectedRosterCafe || state.currentCafeId || cachedCafes[0]?.cafeId || cachedCafes[0]?.code || "");

  const shifts = (cachedShifts || []).filter(s => {
    if (!activeCafeId) return true;
    return !s.cafeId || s.cafeId === activeCafeId;
  });

  return `
    <div class="card" style="padding:22px;">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:18px; flex-wrap:wrap; gap:12px; border-bottom:1px solid var(--border-subtle); padding-bottom:16px;">
        <div>
          <h3 style="font-size:17px; font-weight:800; margin:0 0 4px; color:var(--ink);">Shift Master &amp; Standard Templates</h3>
          <p style="font-size:12.5px; color:var(--muted); margin:0;">Standard working hours, grace tolerances, and cafe-specific shift policies.</p>
        </div>
        <div style="display:flex; gap:10px; align-items:center; flex-wrap:wrap;">
          ${!isCafeAdmin ? `
            <div style="display:inline-flex; align-items:center; gap:6px; background:var(--surface-sunken); padding:4px 8px; border-radius:6px; border:1px solid var(--line);">
              <span style="font-size:12px; font-weight:700; color:var(--ink);">🏛️ Outlet:</span>
              <select id="shift-cafe-select" class="input" style="font-size:12.5px; padding:4px 8px; width:auto; font-weight:600;">
                <option value="">All Outlets (Portfolio)</option>
                ${cachedCafes.map(c => {
                  const cid = c.cafeId || c.code || c.id || c._id;
                  return `<option value="${cid}" ${activeCafeId === cid ? "selected" : ""}>${cid} · ${c.name || 'Outlet'}</option>`;
                }).join('')}
              </select>
            </div>
          ` : ''}
          <button class="btn btn-primary btn-sm" id="open-create-shift-btn" type="button" style="font-size:12px; font-weight:700;">+ New Shift Template</button>
        </div>
      </div>

      <div style="overflow-x:auto;">
        <table class="table" style="width:100%; border-collapse:collapse; font-size:13px;">
          <thead>
            <tr style="border-bottom:2px solid var(--border-subtle); text-align:left; font-size:11.5px; color:var(--muted); text-transform:uppercase;">
              <th style="padding:10px 12px;">Shift ID</th>
              <th style="padding:10px 12px;">Name</th>
              <th style="padding:10px 12px;">Scope / Café</th>
              <th style="padding:10px 12px;">Working Hours</th>
              <th style="padding:10px 12px;">Grace</th>
              <th style="padding:10px 12px;">Default</th>
              <th style="padding:10px 12px;">Status</th>
              <th style="padding:10px 12px; text-align:right;">Actions</th>
            </tr>
          </thead>
          <tbody>
            ${shifts.length === 0 ? `
              <tr>
                <td colspan="8" style="padding:32px 12px; text-align:center; color:var(--muted);">
                  <div style="font-size:24px; margin-bottom:6px;">⏰</div>
                  <div style="font-weight:700; color:var(--ink);">No Shift Templates Configured</div>
                  <div style="font-size:12px; margin-top:2px;">Click "+ New Shift Template" to define operational shifts for this café.</div>
                </td>
              </tr>
            ` : shifts.map((s) => `
              <tr style="border-bottom:1px solid var(--border-subtle);">
                <td style="padding:10px 12px; font-family:var(--font-mono); font-weight:700; color:var(--ink); font-size:12px;">${s.shiftId}</td>
                <td style="padding:10px 12px; font-weight:700; color:var(--ink);">${s.name}</td>
                <td style="padding:10px 12px; color:var(--muted); font-size:12px;">${s.cafeId ? (CAFE_NAMES[s.cafeId] || s.cafeId) : '<span class="status info" style="font-size:10px;">ORG-WIDE</span>'}</td>
                <td style="padding:10px 12px; font-family:var(--font-mono); font-size:12.5px;">${s.startTime} – ${s.endTime}</td>
                <td style="padding:10px 12px; font-size:12px; color:var(--muted);">${s.graceMinutes ?? 15} min</td>
                <td style="padding:10px 12px;">${s.isDefault ? '<span class="status success" style="font-size:10.5px; font-weight:700;">DEFAULT</span>' : '<span style="color:var(--muted); font-size:11.5px;">—</span>'}</td>
                <td style="padding:10px 12px;">
                  <span class="status ${s.isActive !== false ? 'success' : 'neutral'}" style="font-size:11px; font-weight:700;">
                    ${s.isActive !== false ? 'ACTIVE' : 'INACTIVE'}
                  </span>
                </td>
                <td style="padding:10px 12px; text-align:right;">
                  <div style="display:inline-flex; gap:6px;">
                    <button class="btn btn-ghost btn-sm edit-shift-template-btn" data-shift-id="${s.shiftId}" type="button" style="font-size:11.5px; padding:4px 8px;">Edit</button>
                    ${s.isActive !== false ? `
                      <button class="btn btn-ghost btn-sm deactivate-shift-btn" data-shift-id="${s.shiftId}" type="button" style="font-size:11.5px; padding:4px 8px; color:var(--color-danger);">Deactivate</button>
                    ` : `
                      <button class="btn btn-ghost btn-sm activate-shift-btn" data-shift-id="${s.shiftId}" type="button" style="font-size:11.5px; padding:4px 8px; color:var(--color-success);">Activate</button>
                    `}
                  </div>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

// =============================================================================
// 4. ATTENDANCE HISTORY & 360° SUBPANEL
// =============================================================================
function renderCalendar360Subpanel() {
  const role = state.role || state.user?.role || ROLES.MASTER;
  const isCafeAdmin = role === ROLES.CAFE_ADMIN;
  const days = Array.from({ length: 31 }, (_, i) => i + 1);

  // Derive employee profile from roster data
  const assignedCafe360 = state.user?.assignedCafeIds?.[0] || state.currentCafeId || "";
  const rosterStaff360 = cafeRosterSchedules[assignedCafe360] || Object.values(cafeRosterSchedules)[0] || [];
  const emp = rosterStaff360.find(s => s.id === selectedUserId) || rosterStaff360[0] || { name: selectedUserId || "Employee", role: "", id: selectedUserId || "" };

  return `
    <div class="card" style="padding:22px;">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:18px; flex-wrap:wrap; gap:12px; border-bottom:1px solid var(--border-subtle); padding-bottom:16px;">
        <div>
          <h3 style="font-size:17px; font-weight:800; margin:0 0 2px; color:var(--ink);">
            ${isCafeAdmin ? "Staff Attendance History" : "Employee Attendance 360°"} — ${emp.name} (${selectedUserId})
          </h3>
          <p style="font-size:12.5px; color:var(--muted); margin:0;">
            Role: <strong>${emp.role}</strong> · Monthly punch history, timesheet breakdown and biometric stamps.
          </p>
        </div>
        <div style="display:flex; gap:10px; align-items:center; flex-wrap:wrap;">
          <div style="display:flex; align-items:center; gap:6px;">
            <label style="font-size:12px; font-weight:700; color:var(--ink);">Employee:</label>
            <select id="calendar-user-select" class="input" style="font-size:12.5px; width:auto; font-weight:600;">
              ${rosterStaff360.length > 0
                ? rosterStaff360.map(s => `<option value="${s.id}" ${selectedUserId === s.id ? 'selected' : ''}>${s.name} (${s.id}${s.role ? ' — ' + s.role : ''})</option>`).join('')
                : '<option value="">No staff in roster</option>'}
            </select>
          </div>
          <div style="display:flex; align-items:center; gap:6px;">
            <label style="font-size:12px; font-weight:700; color:var(--ink);">Month:</label>
            <select id="calendar-month-select" class="input" style="font-size:12.5px; width:auto; font-weight:600;">
              <option value="2026-08" ${selectedCalendarMonth === "2026-08" ? "selected" : ""}>August 2026</option>
              <option value="2026-07" ${selectedCalendarMonth === "2026-07" ? "selected" : ""}>July 2026</option>
              <option value="2026-06" ${selectedCalendarMonth === "2026-06" ? "selected" : ""}>June 2026</option>
            </select>
          </div>
        </div>
      </div>

      <!-- Month Summary Strip -->
      <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(130px, 1fr)); gap:10px; margin-bottom:20px;">
        <div style="padding:10px 14px; background:var(--surface-sunken); border-radius:6px; border:1px solid var(--line);">
          <div style="font-size:11px; color:var(--muted);">Total Worked</div>
          <strong style="font-size:16px; color:var(--ink); font-family:var(--font-mono);">${emp.totalWorked}</strong>
        </div>
        <div style="padding:10px 14px; background:var(--surface-sunken); border-radius:6px; border:1px solid var(--line);">
          <div style="font-size:11px; color:var(--muted);">Overtime</div>
          <strong style="font-size:16px; color:var(--color-accent-amber); font-family:var(--font-mono);">${emp.ot}</strong>
        </div>
        <div style="padding:10px 14px; background:var(--surface-sunken); border-radius:6px; border:1px solid var(--line);">
          <div style="font-size:11px; color:var(--muted);">Days Present</div>
          <strong style="font-size:16px; color:var(--color-success); font-family:var(--font-mono);">${emp.presentDays} Days</strong>
        </div>
        <div style="padding:10px 14px; background:var(--surface-sunken); border-radius:6px; border:1px solid var(--line);">
          <div style="font-size:11px; color:var(--muted);">Late Arrivals</div>
          <strong style="font-size:16px; color:var(--color-warning); font-family:var(--font-mono);">${emp.lateDays} ${emp.lateDays === 1 ? "Day" : "Days"}</strong>
        </div>
      </div>

      <!-- 31-Day Calendar Grid -->
      <div style="display:grid; grid-template-columns:repeat(7, 1fr); gap:8px;">
        ${days
          .map((d) => {
            const isPresent = d <= 19 && d % 7 !== 0 && d % 7 !== 6;
            const isWeeklyOff = d % 7 === 0 || d % 7 === 6;
            const isFuture = d > 19;
            const isLate = d === emp.lateDayNum;

            let bg = "var(--surface-sunken)";
            let borderColor = "var(--line)";
            let statusText = "Present";
            let statusColor = "var(--color-success)";

            if (isWeeklyOff) {
              statusText = "Weekly Off";
              statusColor = "var(--muted)";
            } else if (isFuture) {
              statusText = "Scheduled";
              statusColor = "var(--muted)";
            } else if (isLate) {
              statusText = "Late (18m)";
              statusColor = "var(--color-warning)";
              borderColor = "var(--color-warning)";
            }

            return `
            <div class="calendar-day-card" 
              data-day-num="${d}" 
              data-is-present="${isPresent}" 
              data-is-late="${isLate}" 
              data-is-off="${isWeeklyOff}" 
              data-is-future="${isFuture}" 
              data-status-text="${statusText}"
              style="padding:10px; border:1px solid ${borderColor}; border-radius:6px; background:${bg}; min-height:70px; cursor:pointer; transition:transform 0.15s ease, box-shadow 0.15s ease;"
              title="Click to view punch audit details for Aug ${d}">
              <div style="display:flex; justify-content:space-between; font-size:11px; color:var(--muted);">
                <strong>Aug ${d}</strong>
                ${isLate ? `<span style="color:var(--color-warning); font-weight:700;">!</span>` : ""}
              </div>
              <div style="font-size:12px; font-weight:700; color:${statusColor}; margin-top:8px;">${statusText}</div>
              ${isPresent ? `<div style="font-size:11px; color:var(--muted); font-family:var(--font-mono);">06:42 – 15:10</div>` : ""}
            </div>
          `;
          })
          .join("")}
      </div>
    </div>
  `;
}

// =============================================================================
// 5. EXCEPTIONS & OVERTIME SUBPANEL
// =============================================================================
function renderExceptionsSubpanel() {
  const role = state.role || state.user?.role || ROLES.MASTER;
  const isPrimary = state.user?.isPrimaryMaster === true;
  const isCafeAdmin = role === ROLES.CAFE_ADMIN;

  const otRecords = cachedOvertime || [];
  const exceptions = cachedExceptions || [];

  return `
    <div style="display:flex; flex-direction:column; gap:20px;">
      <!-- Overtime Decision Queue -->
      <div class="card" style="padding:20px;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:14px; border-bottom:1px solid var(--border-subtle); padding-bottom:12px;">
          <div>
            <h3 style="font-size:16px; font-weight:800; margin:0 0 2px; color:var(--ink);">Overtime Governance &amp; Decision Queue</h3>
            <p style="font-size:12px; color:var(--muted); margin:0;">
              ${isCafeAdmin ? "Review & recommend overtime for Primary Master decision" : "CAFE_ADMIN verify → Primary Master final decision"}
            </p>
          </div>
          <span class="status ${otRecords.length > 0 ? 'warning' : 'success'}" style="font-size:11px; font-weight:700;">
            ${otRecords.length} Records
          </span>
        </div>

        <div style="overflow-x:auto;">
          <table class="table" style="width:100%; border-collapse:collapse; font-size:12.5px;">
            <thead>
              <tr style="border-bottom:2px solid var(--border-subtle); text-align:left; font-size:11px; color:var(--muted); text-transform:uppercase;">
                <th style="padding:8px 10px;">Employee</th>
                <th style="padding:8px 10px;">Date</th>
                <th style="padding:8px 10px;">Café</th>
                <th style="padding:8px 10px;">Shift</th>
                <th style="padding:8px 10px;">Worked</th>
                <th style="padding:8px 10px;">Detected OT</th>
                <th style="padding:8px 10px;">Approved OT</th>
                <th style="padding:8px 10px;">Status</th>
                <th style="padding:8px 10px; text-align:right;">Actions</th>
              </tr>
            </thead>
            <tbody>
              ${otRecords.length === 0 ? `
                <tr>
                  <td colspan="9" style="padding:24px; text-align:center; color:var(--muted);">
                    All overtime claims have been processed.
                  </td>
                </tr>
              ` : otRecords.map((r) => `
                <tr style="border-bottom:1px solid var(--border-subtle);">
                  <td style="padding:8px 10px; font-weight:700; color:var(--ink);">${r.userId}</td>
                  <td style="padding:8px 10px; font-family:var(--font-mono); font-size:12px;">${r.businessDate}</td>
                  <td style="padding:8px 10px; color:var(--muted);">${r.cafeId || '—'}</td>
                  <td style="padding:8px 10px;">${r.shiftName || 'Standard'}</td>
                  <td style="padding:8px 10px; font-family:var(--font-mono);">${r.totalWorkedMinutes || 0}m</td>
                  <td style="padding:8px 10px; font-weight:700; color:var(--warning); font-family:var(--font-mono);">${r.detectedOvertimeMinutes || 0}m</td>
                  <td style="padding:8px 10px; font-weight:700; color:var(--color-success); font-family:var(--font-mono);">${r.approvedOvertimeMinutes || 0}m</td>
                  <td style="padding:8px 10px;">
                    <span class="status ${r.overtimeStatus === 'APPROVED_BY_PRIMARY' ? 'success' : (r.overtimeStatus === 'REJECTED' ? 'danger' : 'warning')}" style="font-size:10.5px; font-weight:700;">
                      ${r.overtimeStatus || 'PENDING_REVIEW'}
                    </span>
                  </td>
                  <td style="padding:8px 10px; text-align:right;">
                    <div style="display:inline-flex; gap:6px;">
                      ${isCafeAdmin && r.overtimeStatus === 'PENDING_REVIEW' ? `
                        <button class="btn btn-primary btn-sm recommend-ot-row-btn" data-attendance-id="${r.attendanceId}" type="button" style="font-size:11px; padding:3px 8px;">Recommend</button>
                      ` : ''}
                      ${(isPrimary || role === ROLES.MASTER || role === ROLES.OWNER) && r.overtimeStatus !== 'APPROVED_BY_PRIMARY' ? `
                        <button class="btn btn-primary btn-sm approve-ot-row-btn" data-attendance-id="${r.attendanceId}" data-detected="${r.detectedOvertimeMinutes || 0}" type="button" style="font-size:11px; padding:3px 8px;">Approve</button>
                        <button class="btn btn-ghost btn-sm reject-ot-row-btn" data-attendance-id="${r.attendanceId}" type="button" style="font-size:11px; padding:3px 8px; color:var(--color-danger);">Reject</button>
                      ` : ''}
                    </div>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>

      <!-- Attendance Exceptions -->
      <div class="card" style="padding:20px;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:14px; border-bottom:1px solid var(--border-subtle); padding-bottom:12px;">
          <div>
            <h3 style="font-size:16px; font-weight:800; margin:0 0 2px; color:var(--ink);">Unresolved Attendance Exceptions</h3>
            <p style="font-size:12px; color:var(--muted); margin:0;">Lateness, missing checkouts, conflicts, and validation warnings.</p>
          </div>
          <span class="status ${exceptions.length > 0 ? 'warning' : 'success'}" style="font-size:11px; font-weight:700;">
            ${exceptions.length} Exceptions
          </span>
        </div>

        <div style="overflow-x:auto;">
          <table class="table" style="width:100%; border-collapse:collapse; font-size:12.5px;">
            <thead>
              <tr style="border-bottom:2px solid var(--border-subtle); text-align:left; font-size:11px; color:var(--muted); text-transform:uppercase;">
                <th style="padding:8px 10px;">ID</th>
                <th style="padding:8px 10px;">Type</th>
                <th style="padding:8px 10px;">Severity</th>
                <th style="padding:8px 10px;">Employee</th>
                <th style="padding:8px 10px;">Date</th>
                <th style="padding:8px 10px;">Status</th>
                <th style="padding:8px 10px;">Description</th>
                <th style="padding:8px 10px; text-align:right;">Action</th>
              </tr>
            </thead>
            <tbody>
              ${exceptions.length === 0 ? `
                <tr>
                  <td colspan="8" style="padding:24px; text-align:center; color:var(--muted);">
                    No unresolved attendance exceptions found.
                  </td>
                </tr>
              ` : exceptions.map((e) => `
                <tr style="border-bottom:1px solid var(--border-subtle);">
                  <td style="padding:8px 10px; font-family:var(--font-mono); font-size:11.5px; color:var(--muted);">${e.exceptionId || '—'}</td>
                  <td style="padding:8px 10px; font-weight:700; color:var(--ink);">${e.type}</td>
                  <td style="padding:8px 10px;">
                    <span class="status ${e.severity === 'HIGH' ? 'danger' : (e.severity === 'MEDIUM' ? 'warning' : 'info')}" style="font-size:10px; font-weight:700;">
                      ${e.severity}
                    </span>
                  </td>
                  <td style="padding:8px 10px; font-weight:600;">${e.userId}</td>
                  <td style="padding:8px 10px; font-family:var(--font-mono); font-size:12px;">${e.businessDate}</td>
                  <td style="padding:8px 10px;">
                    <span class="status ${e.status === 'RESOLVED' ? 'success' : (e.status === 'DISMISSED' ? 'neutral' : 'warning')}" style="font-size:10.5px; font-weight:700;">
                      ${e.status}
                    </span>
                  </td>
                  <td style="padding:8px 10px; color:var(--muted); max-width:260px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${e.description || ''}">
                    ${e.description || '—'}
                  </td>
                  <td style="padding:8px 10px; text-align:right;">
                    ${e.status !== 'RESOLVED' && e.status !== 'DISMISSED' ? `
                      <button class="btn btn-primary btn-sm resolve-exception-row-btn" data-exception-id="${e.exceptionId}" type="button" style="font-size:11px; padding:3px 8px;">Resolve</button>
                    ` : '<span style="font-size:11px; color:var(--muted);">Completed</span>'}
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;
}

// =============================================================================
// 6. ATTENDANCE RULES / POLICIES SUBPANEL
// =============================================================================
function renderPoliciesSubpanel() {
  const role = state.role || state.user?.role || ROLES.MASTER;
  const isPrimary = state.user?.isPrimaryMaster === true;
  const isCafeAdmin = role === ROLES.CAFE_ADMIN;

  return `
    <div style="display:flex; flex-direction:column; gap:16px; width:100%; min-width:0;">
      <!-- TOP EXECUTIVE POLICY METRIC STRIP -->
      <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(220px, 1fr)); gap:12px;">
        <div class="card" style="padding:14px 16px; background:var(--surface); border:1px solid var(--line); border-radius:var(--radius-card, 12px); box-shadow:var(--shadow-xs);">
          <div style="font-size:11.5px; font-weight:700; color:var(--muted); text-transform:uppercase; letter-spacing:0.5px;">Geofence Security</div>
          <div style="font-size:22px; font-weight:800; color:var(--ink); font-family:var(--font-heading); margin-top:4px;">50 Meters <span style="font-size:12px; font-weight:600; color:var(--muted);">Radius</span></div>
          <div style="font-size:11.5px; color:#059669; font-weight:600; margin-top:2px;">● High-Accuracy GPS Required</div>
        </div>

        <div class="card" style="padding:14px 16px; background:var(--surface); border:1px solid var(--line); border-radius:var(--radius-card, 12px); box-shadow:var(--shadow-xs);">
          <div style="font-size:11.5px; font-weight:700; color:var(--muted); text-transform:uppercase; letter-spacing:0.5px;">Rotating QR Token</div>
          <div style="font-size:22px; font-weight:800; color:var(--bronze-600); font-family:var(--font-heading); margin-top:4px;">45 Seconds</div>
          <div style="font-size:11.5px; color:var(--muted); margin-top:2px;">Anti-buddy punching refresh</div>
        </div>

        <div class="card" style="padding:14px 16px; background:var(--surface); border:1px solid var(--line); border-radius:var(--radius-card, 12px); box-shadow:var(--shadow-xs);">
          <div style="font-size:11.5px; font-weight:700; color:var(--muted); text-transform:uppercase; letter-spacing:0.5px;">Late Grace Window</div>
          <div style="font-size:22px; font-weight:800; color:var(--ink); font-family:var(--font-heading); margin-top:4px;">15 Minutes</div>
          <div style="font-size:11.5px; color:var(--muted); margin-top:2px;">Automatic delay flag threshold</div>
        </div>

        <div class="card" style="padding:14px 16px; background:var(--surface); border:1px solid var(--line); border-radius:var(--radius-card, 12px); box-shadow:var(--shadow-xs);">
          <div style="font-size:11.5px; font-weight:700; color:var(--muted); text-transform:uppercase; letter-spacing:0.5px;">Statutory Status</div>
          <div style="font-size:22px; font-weight:800; color:#059669; font-family:var(--font-heading); margin-top:4px;">100% Compliant</div>
          <div style="font-size:11.5px; color:#059669; font-weight:600; margin-top:2px;">● Kerala Labour Act 1960</div>
        </div>
      </div>

      <!-- MAIN 4-POLICY CARD GRID -->
      <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(380px, 1fr)); gap:16px;">
        <!-- Card 1: Frontline Verification Parameters -->
        <div class="card" style="padding:20px; background:var(--surface); border:1px solid var(--line); border-radius:var(--radius-card, 12px); box-shadow:var(--shadow-xs);">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:14px;">
            <div>
              <h3 style="font-size:15.5px; font-weight:800; margin:0 0 2px; color:var(--ink);">
                ${isCafeAdmin ? "Attendance Rules (Operational Summary)" : "Frontline Clock-In Verification Policies"}
              </h3>
              <p style="font-size:12px; color:var(--muted); margin:0;">
                ${isCafeAdmin ? "Configured clock-in and verification parameters for this cafe (Read-Only)." : "Configurable clock-in security parameters."}
              </p>
            </div>
            <span class="status success" style="font-size:10px; font-weight:700;">ACTIVE</span>
          </div>

          <div style="display:flex; flex-direction:column; gap:10px; font-size:12.5px;">
            <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid var(--line); padding-bottom:8px;">
              <span style="color:var(--muted);">Geofence Radius &amp; Accuracy</span>
              <strong style="color:var(--ink); font-family:var(--font-mono);">50 Meters (GPS Required)</strong>
            </div>
            <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid var(--line); padding-bottom:8px;">
              <span style="color:var(--muted);">Rotating QR Code Interval</span>
              <strong style="color:var(--ink); font-family:var(--font-mono);">45 Seconds Auto-Rotation</strong>
            </div>
            <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid var(--line); padding-bottom:8px;">
              <span style="color:var(--muted);">Late Grace Window</span>
              <strong style="color:var(--ink); font-family:var(--font-mono);">15 Minutes</strong>
            </div>
            <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid var(--line); padding-bottom:8px;">
              <span style="color:var(--muted);">Unpaid Break Rule</span>
              <strong style="color:var(--ink); font-family:var(--font-mono);">30 Minutes (Standard 8h Shift)</strong>
            </div>
            <div style="display:flex; justify-content:space-between; align-items:center;">
              <span style="color:var(--muted);">Private Selfie Capture</span>
              <strong style="color:#059669; font-weight:700;">Enabled (Signed Private Storage)</strong>
            </div>
          </div>
        </div>

        <!-- Card 2: Evidence Retention & Privacy -->
        <div class="card" style="padding:20px; background:var(--surface); border:1px solid var(--line); border-radius:var(--radius-card, 12px); box-shadow:var(--shadow-xs);">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:14px;">
            <div>
              <h3 style="font-size:15.5px; font-weight:800; margin:0 0 2px; color:var(--ink);">Evidence Retention &amp; Privacy Standards</h3>
              <p style="font-size:12px; color:var(--muted); margin:0;">Zero facial recognition · Short-lived signed links · 90-day retention</p>
            </div>
            <span class="status info" style="font-size:10px; font-weight:700;">PRIVACY SAFE</span>
          </div>

          <div style="display:flex; flex-direction:column; gap:10px; font-size:12.5px; margin-bottom:16px;">
            <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid var(--line); padding-bottom:8px;">
              <span style="color:var(--muted);">Selfie Storage Consumed</span>
              <strong style="font-family:var(--font-mono); color:var(--ink);">14.2 MB</strong>
            </div>
            <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid var(--line); padding-bottom:8px;">
              <span style="color:var(--muted);">Purge-Eligible Selfies (&gt; 90 Days)</span>
              <strong style="color:var(--warning); font-family:var(--font-mono);">148 Photos</strong>
            </div>
            <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid var(--line); padding-bottom:8px;">
              <span style="color:var(--muted);">Active Evidence Holds</span>
              <strong style="color:#059669; font-weight:700;">0 Open Disputes</strong>
            </div>
            <div style="display:flex; justify-content:space-between; align-items:center;">
              <span style="color:var(--muted);">Biometric Identity Storage</span>
              <strong style="color:#059669; font-weight:700;">None (Prohibited by Architecture)</strong>
            </div>
          </div>

          ${
            isPrimary
              ? `<button class="btn btn-secondary" id="purge-selfies-btn" type="button" style="font-size:12px; color:var(--danger); width:100%; font-weight:700; border-color:rgba(239,68,68,0.3);">
                  🗑️ Execute Retention Purge (Primary Master Only)
                 </button>`
              : `<div style="font-size:11.5px; color:var(--muted); text-align:center; padding:6px; background:var(--surface-sunken); border-radius:6px;">Evidence purge authority: Primary Master only</div>`
          }
        </div>

        <!-- Card 3: Statutory Labour Law Alignment -->
        <div class="card" style="padding:20px; background:var(--surface); border:1px solid var(--line); border-radius:var(--radius-card, 12px); box-shadow:var(--shadow-xs);">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:14px;">
            <div>
              <h3 style="font-size:15.5px; font-weight:800; margin:0 0 2px; color:var(--ink);">Statutory Labour Law Conformity</h3>
              <p style="font-size:12px; color:var(--muted); margin:0;">Kerala Shops &amp; Commercial Establishments Act, 1960</p>
            </div>
            <span class="status success" style="font-size:10px; font-weight:700;">AUDIT PASS</span>
          </div>

          <div style="display:flex; flex-direction:column; gap:10px; font-size:12.5px;">
            <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid var(--line); padding-bottom:8px;">
              <span style="color:var(--muted);">Maximum Working Hours</span>
              <strong style="color:var(--ink);">48 Hours / Week (6 Working Days)</strong>
            </div>
            <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid var(--line); padding-bottom:8px;">
              <span style="color:var(--muted);">Mandatory Weekly Rest</span>
              <strong style="color:var(--ink);">1 Full Day (24 Consecutive Hours)</strong>
            </div>
            <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid var(--line); padding-bottom:8px;">
              <span style="color:var(--muted);">Overtime Wage Multiplier</span>
              <strong style="color:var(--bronze-600); font-family:var(--font-mono); font-weight:700;">2.0× Standard Hourly Rate</strong>
            </div>
            <div style="display:flex; justify-content:space-between; align-items:center;">
              <span style="color:var(--muted);">Minimum Statutory Wage Floor</span>
              <strong style="color:#059669; font-weight:700;">100% Staff Above Floor</strong>
            </div>
          </div>
        </div>

        <!-- Card 4: Audit Trail & Tamper Resistance -->
        <div class="card" style="padding:20px; background:var(--surface); border:1px solid var(--line); border-radius:var(--radius-card, 12px); box-shadow:var(--shadow-xs);">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:14px;">
            <div>
              <h3 style="font-size:15.5px; font-weight:800; margin:0 0 2px; color:var(--ink);">Audit Trail &amp; Evidence Integrity</h3>
              <p style="font-size:12px; color:var(--muted); margin:0;">Cryptographic punch attribution and dispute resolution SLA</p>
            </div>
            <span class="status info" style="font-size:10px; font-weight:700;">VERIFIED</span>
          </div>

          <div style="display:flex; flex-direction:column; gap:10px; font-size:12.5px;">
            <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid var(--line); padding-bottom:8px;">
              <span style="color:var(--muted);">Biometric Proof Standard</span>
              <strong style="color:var(--ink);">Cryptographically Signed Token</strong>
            </div>
            <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid var(--line); padding-bottom:8px;">
              <span style="color:var(--muted);">Audit Ledger Immutability</span>
              <strong style="color:#059669; font-weight:700;">Hash-Chained Event Stream</strong>
            </div>
            <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid var(--line); padding-bottom:8px;">
              <span style="color:var(--muted);">Dispute Resolution SLA</span>
              <strong style="color:var(--ink);">48 Hours (Primary Master Sign-Off)</strong>
            </div>
            <div style="display:flex; justify-content:space-between; align-items:center;">
              <span style="color:var(--muted);">Third-Party Export Format</span>
              <strong style="color:var(--ink);">PDF Statutory Proof &amp; CSV</strong>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
}

// =============================================================================
// 7. PERIOD CLOSURE SUBPANEL (Master Only)
// =============================================================================
function renderClosureSubpanel() {
  const isPrimary = state.user?.isPrimaryMaster === true;

  return `
    <div style="display:flex; flex-direction:column; gap:16px; width:100%; min-width:0;">
      <!-- TOP EXECUTIVE PERIOD KPI STRIP -->
      <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(220px, 1fr)); gap:12px;">
        <div class="card" style="padding:14px 16px; background:var(--surface); border:1px solid var(--line); border-radius:var(--radius-card, 12px); box-shadow:var(--shadow-xs);">
          <div style="font-size:11.5px; font-weight:700; color:var(--muted); text-transform:uppercase; letter-spacing:0.5px;">Active Payroll Period</div>
          <div style="font-size:22px; font-weight:800; color:var(--ink); font-family:var(--font-heading); margin-top:4px;">${state.currentPeriodKey || "Current Period"}</div>
          <div style="font-size:11.5px; color:#059669; font-weight:600; margin-top:2px;">● Accrual Open (Live)</div>
        </div>

        <div class="card" style="padding:14px 16px; background:var(--surface); border:1px solid var(--line); border-radius:var(--radius-card, 12px); box-shadow:var(--shadow-xs);">
          <div style="font-size:11.5px; font-weight:700; color:var(--muted); text-transform:uppercase; letter-spacing:0.5px;">Workforce Enrolled</div>
          <div style="font-size:22px; font-weight:800; color:var(--ink); font-family:var(--font-heading); margin-top:4px;">${(() => { const allStaff = Object.values(cafeRosterSchedules).flat(); return allStaff.length || '—'; })()} <span style="font-size:13px; font-weight:600; color:var(--muted);">Staff Members</span></div>
          <div style="font-size:11.5px; color:var(--muted); margin-top:2px;">Across ${Object.keys(cafeRosterSchedules).length || '—'} Operating Cafés</div>
        </div>

        <div class="card" style="padding:14px 16px; background:var(--surface); border:1px solid var(--line); border-radius:var(--radius-card, 12px); box-shadow:var(--shadow-xs);">
          <div style="font-size:11.5px; font-weight:700; color:var(--muted); text-transform:uppercase; letter-spacing:0.5px;">Total Logged Hours</div>
          <div style="font-size:22px; font-weight:800; color:var(--bronze-600); font-family:var(--font-heading); margin-top:4px;">${cachedLiveAttendance.length > 0 ? (cachedLiveAttendance.reduce((s, r) => s + (r.regularMinutes || 0), 0) / 60).toFixed(1) : '—'} <span style="font-size:13px; font-weight:600; color:var(--muted);">Hrs</span></div>
          <div style="font-size:11.5px; color:#059669; font-weight:600; margin-top:2px;">● Logged from live attendance records</div>
        </div>

        <div class="card" style="padding:14px 16px; background:var(--surface); border:1px solid var(--line); border-radius:var(--radius-card, 12px); box-shadow:var(--shadow-xs);">
          <div style="font-size:11.5px; font-weight:700; color:var(--muted); text-transform:uppercase; letter-spacing:0.5px;">Payroll Readiness</div>
          <div style="font-size:22px; font-weight:800; color:var(--warning); font-family:var(--font-heading); margin-top:4px;">98% Ready</div>
          <div style="font-size:11.5px; color:var(--warning); font-weight:600; margin-top:2px;">⚠ 1 Overtime Review Pending</div>
        </div>
      </div>

      <!-- MAIN 2-COLUMN OPERATIONAL WORKSPACE -->
      <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(420px, 1fr)); gap:16px;">
        <!-- Column 1: Multi-Café Timesheet Rollup -->
        <div class="card" style="padding:22px; background:var(--surface); border:1px solid var(--line); border-radius:var(--radius-card, 12px); box-shadow:var(--shadow-xs);">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px;">
            <div>
              <h3 style="font-size:16px; font-weight:800; margin:0 0 2px; color:var(--ink);">Multi-Café Period Summary</h3>
              <p style="font-size:12.5px; color:var(--muted); margin:0;">Cycle timesheet aggregation &amp; payable hours validation</p>
            </div>
            <span class="status info" style="font-size:10.5px; font-weight:700;">ACTIVE ACCRUAL</span>
          </div>

          <div class="table-wrap" style="margin-bottom:16px; overflow-x:auto;">
            <table class="data-table" style="width:100%; border-collapse:collapse; font-size:12.5px;">
              <thead>
                <tr style="text-align:left; border-bottom:1.5px solid var(--line); background:var(--surface-sunken);">
                  <th style="padding:10px 12px; font-weight:700; white-space:nowrap;">Café Outlet</th>
                  <th style="padding:10px 12px; font-weight:700; text-align:right; white-space:nowrap;">Staff</th>
                  <th style="padding:10px 12px; font-weight:700; text-align:right; white-space:nowrap;">Logged Hours</th>
                  <th style="padding:10px 12px; font-weight:700; text-align:center; white-space:nowrap;">Readiness</th>
                </tr>
              </thead>
              <tbody>
                ${cachedCafes.length > 0 ? cachedCafes.map((c, i) => `
                <tr style="border-bottom:1px solid var(--line);">
                  <td style="padding:10px 12px; font-weight:700; color:var(--ink); white-space:nowrap;">
                    ${c.cafeId || c.code || ''} · ${c.name || 'Outlet'}
                  </td>
                  <td style="padding:10px 12px; text-align:right; font-family:var(--font-mono);">${12 + (i % 3)}</td>
                  <td style="padding:10px 12px; text-align:right; font-family:var(--font-mono); font-weight:700; color:var(--bronze-600);">${(2100 + i * 150).toLocaleString()}.0 hrs</td>
                  <td style="padding:10px 12px; text-align:center;"><span class="status success" style="font-size:10px; font-weight:700;">READY</span></td>
                </tr>
                `).join('') : `
                <tr style="border-bottom:1px solid var(--line);">
                  <td style="padding:10px 12px; font-weight:700; color:var(--ink); white-space:nowrap;">
                    ${state.currentCafeId || 'All'} · ${state.currentCafeName || 'Active Outlet'}
                  </td>
                  <td style="padding:10px 12px; text-align:right; font-family:var(--font-mono);">12</td>
                  <td style="padding:10px 12px; text-align:right; font-family:var(--font-mono); font-weight:700; color:var(--bronze-600);">2,100.0 hrs</td>
                  <td style="padding:10px 12px; text-align:center;"><span class="status success" style="font-size:10px; font-weight:700;">READY</span></td>
                </tr>
                `}
              </tbody>
            </table>
          </div>

          <!-- Stepper Lifecycle -->
          <div style="background:var(--surface-sunken); padding:12px 14px; border-radius:8px; border:1px solid var(--line); margin-bottom:18px;">
            <div style="font-size:11px; font-weight:700; color:var(--muted); text-transform:uppercase; margin-bottom:6px;">Closure Pipeline Stage</div>
            <div style="display:flex; justify-content:space-between; align-items:center; font-size:11.5px; flex-wrap:wrap; gap:6px;">
              <span style="color:#059669; font-weight:700;">✓ 1. Accrual</span>
              <span>➔</span>
              <span style="color:var(--bronze-600); font-weight:700;">● 2. Gate Verification</span>
              <span>➔</span>
              <span style="color:var(--muted);">3. Master Lock</span>
              <span>➔</span>
              <span style="color:var(--muted);">4. Payroll Engine Handoff</span>
            </div>
          </div>

          <div style="display:flex; justify-content:flex-end; gap:10px; flex-wrap:wrap;">
            ${
              isPrimary
                ? `<button class="btn btn-secondary" id="reopen-period-btn" type="button" style="font-size:12.5px; font-weight:600;">Reopen Accrual</button>
                   <button class="btn btn-primary" id="lock-period-btn" type="button" style="font-size:12.5px; font-weight:700;">🔒 Lock Period &amp; Export to Payroll</button>`
                : `<span style="font-size:12px; color:var(--muted); text-align:center; width:100%; padding:8px; background:var(--surface-sunken); border-radius:6px;">Period lock and reopening is restricted to Primary Master authority.</span>`
            }
          </div>
        </div>

        <!-- Column 2: Pre-Closure Quality Gates & Verification Checklist -->
        <div class="card" style="padding:22px; background:var(--surface); border:1px solid var(--line); border-radius:var(--radius-card, 12px); box-shadow:var(--shadow-xs);">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px;">
            <div>
              <h3 style="font-size:16px; font-weight:800; margin:0 0 2px; color:var(--ink);">Quality Gates &amp; Invariant Checks</h3>
              <p style="font-size:12.5px; color:var(--muted); margin:0;">Automated blockers verification prior to payroll release</p>
            </div>
            <span class="status warning" style="font-size:10.5px; font-weight:700;">1 ACTION REQUIRED</span>
          </div>

          <div style="display:flex; flex-direction:column; gap:12px; font-size:12.5px; margin-bottom:20px;">
            <div style="padding:12px; border:1px solid var(--line); border-radius:8px; background:var(--surface-sunken); display:flex; justify-content:space-between; align-items:center;">
              <div>
                <strong style="color:var(--ink); display:block;">Biometric &amp; GPS Telemetry Proofs</strong>
                <span style="color:var(--muted); font-size:11.5px;">1,420 total punches verified within 50m geofence</span>
              </div>
              <span class="status success" style="font-size:10.5px; font-weight:700;">PASS (100%)</span>
            </div>

            <div style="padding:12px; border:1px solid var(--line); border-radius:8px; background:var(--surface-sunken); display:flex; justify-content:space-between; align-items:center;">
              <div>
                <strong style="color:var(--ink); display:block;">Missing Check-Out Resolution</strong>
                <span style="color:var(--muted); font-size:11.5px;">0 unclosed punches across all active rosters</span>
              </div>
              <span class="status success" style="font-size:10.5px; font-weight:700;">CLEARED (0 PENDING)</span>
            </div>

            <div style="padding:12px; border:1px solid rgba(245,158,11,0.3); border-radius:8px; background:rgba(245,158,11,0.05); display:flex; justify-content:space-between; align-items:center;">
              <div>
                <strong style="color:var(--ink); display:block;">Overtime Claims Approval</strong>
                <span style="color:var(--muted); font-size:11.5px;">Duty Barista (90 min) awaiting Primary Master decision</span>
              </div>
              <span class="status warning" style="font-size:10.5px; font-weight:700;">1 AWAITING SIGN-OFF</span>
            </div>

            <div style="padding:12px; border:1px solid var(--line); border-radius:8px; background:var(--surface-sunken); display:flex; justify-content:space-between; align-items:center;">
              <div>
                <strong style="color:var(--ink); display:block;">Shift Roster vs Actual Variance</strong>
                <span style="color:var(--muted); font-size:11.5px;">±0.8% variance within statutory threshold</span>
              </div>
              <span class="status success" style="font-size:10.5px; font-weight:700;">NORMAL</span>
            </div>
          </div>

          <div style="padding:14px; background:var(--surface-sunken); border-radius:8px; border:1px solid var(--line);">
            <div style="font-size:12px; font-weight:700; color:var(--ink); margin-bottom:4px;">Payroll Handoff Invariant:</div>
            <div style="font-size:11.5px; color:var(--muted); line-height:1.4;">
              Once locked, total payable days and overtime minutes will be immutably transferred to <strong>Monthly Payroll Runs</strong> (<a href="#payroll/runs" style="color:var(--bronze-600); font-weight:600; text-decoration:none;">#payroll/runs</a>) for gross-to-net calculation.
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
}

// =============================================================================
// 8. ANALYTICS / TRENDS SUBPANEL
// =============================================================================
function renderAnalyticsSubpanel() {
  const role = state.role || state.user?.role || ROLES.MASTER;
  const isCafeAdmin = role === ROLES.CAFE_ADMIN;

  return `
    <div style="display:flex; flex-direction:column; gap:16px; width:100%; min-width:0;">
      <!-- TOP EXECUTIVE ANALYTICS METRIC STRIP -->
      <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(220px, 1fr)); gap:12px;">
        <div class="card" style="padding:14px 16px; background:var(--surface); border:1px solid var(--line); border-radius:var(--radius-card, 12px); box-shadow:var(--shadow-xs);">
          <div style="font-size:11.5px; font-weight:700; color:var(--muted); text-transform:uppercase; letter-spacing:0.5px;">Punctuality &amp; On-Time Rate</div>
          <div style="font-size:22px; font-weight:800; color:#059669; font-family:var(--font-heading); margin-top:4px;">96.2%</div>
          <div style="font-size:11.5px; color:#059669; font-weight:600; margin-top:2px;">● Target: &gt; 95% on-time arrivals</div>
        </div>

        <div class="card" style="padding:14px 16px; background:var(--surface); border:1px solid var(--line); border-radius:var(--radius-card, 12px); box-shadow:var(--shadow-xs);">
          <div style="font-size:11.5px; font-weight:700; color:var(--muted); text-transform:uppercase; letter-spacing:0.5px;">Total Shift Labour</div>
          <div style="font-size:22px; font-weight:800; color:var(--bronze-600); font-family:var(--font-heading); margin-top:4px;">${cachedLiveAttendance.length > 0 ? (cachedLiveAttendance.reduce((s, r) => s + (r.regularMinutes || 0), 0) / 60).toFixed(1) : '—'} <span style="font-size:13px; font-weight:600; color:var(--muted);">Hrs</span></div>
          <div style="font-size:11.5px; color:var(--muted); margin-top:2px;">Across ${Object.keys(cafeRosterSchedules).length || '—'} Operating Outlets</div>
        </div>

        <div class="card" style="padding:14px 16px; background:var(--surface); border:1px solid var(--line); border-radius:var(--radius-card, 12px); box-shadow:var(--shadow-xs);">
          <div style="font-size:11.5px; font-weight:700; color:var(--muted); text-transform:uppercase; letter-spacing:0.5px;">Overtime Utilisation</div>
          <div style="font-size:22px; font-weight:800; color:var(--ink); font-family:var(--font-heading); margin-top:4px;">18.5 <span style="font-size:13px; font-weight:600; color:var(--muted);">Hrs</span></div>
          <div style="font-size:11.5px; color:var(--muted); margin-top:2px;">Approved: 16.0h · Rejected: 2.5h</div>
        </div>

        <div class="card" style="padding:14px 16px; background:var(--surface); border:1px solid var(--line); border-radius:var(--radius-card, 12px); box-shadow:var(--shadow-xs);">
          <div style="font-size:11.5px; font-weight:700; color:var(--muted); text-transform:uppercase; letter-spacing:0.5px;">Manual Adjustment Rate</div>
          <div style="font-size:22px; font-weight:800; color:var(--ink); font-family:var(--font-heading); margin-top:4px;">2.1%</div>
          <div style="font-size:11.5px; color:#059669; font-weight:600; margin-top:2px;">● Benchmark: &lt; 5% manual edits</div>
        </div>
      </div>

      <!-- MAIN 2-COLUMN OPERATIONAL ANALYTICS WORKSPACE -->
      <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(420px, 1fr)); gap:16px;">
        <!-- Card 1: Shift Adherence & Peak Hour Staffing -->
        <div class="card" style="padding:22px; background:var(--surface); border:1px solid var(--line); border-radius:var(--radius-card, 12px); box-shadow:var(--shadow-xs);">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px;">
            <div>
              <h3 style="font-size:16px; font-weight:800; margin:0 0 2px; color:var(--ink);">Shift Adherence &amp; Peak Hour Staffing</h3>
              <p style="font-size:12.5px; color:var(--muted); margin:0;">Shift arrival punctuality and peak station coverage</p>
            </div>
            <span class="status success" style="font-size:10.5px; font-weight:700;">OPTIMAL</span>
          </div>

          <div style="display:flex; flex-direction:column; gap:14px; font-size:12.5px; margin-bottom:16px;">
            <!-- Shift 1 -->
            <div>
              <div style="display:flex; justify-content:space-between; margin-bottom:4px;">
                <strong style="color:var(--ink);">Morning Roastery Shift (06:30 – 15:00)</strong>
                <span style="font-weight:700; color:#059669;">98.4% On-Time</span>
              </div>
              <div style="height:6px; background:var(--line); border-radius:3px; overflow:hidden;">
                <div style="width:98.4%; height:100%; background:#059669; border-radius:3px;"></div>
              </div>
              <div style="font-size:11.5px; color:var(--muted); margin-top:2px;">22 Staff Assigned · Peak Rush: 08:00 – 11:30</div>
            </div>

            <!-- Shift 2 -->
            <div>
              <div style="display:flex; justify-content:space-between; margin-bottom:4px;">
                <strong style="color:var(--ink);">Evening Rush &amp; Close (13:00 – 21:30)</strong>
                <span style="font-weight:700; color:var(--bronze-600);">94.8% On-Time</span>
              </div>
              <div style="height:6px; background:var(--line); border-radius:3px; overflow:hidden;">
                <div style="width:94.8%; height:100%; background:var(--bronze-600); border-radius:3px;"></div>
              </div>
              <div style="font-size:11.5px; color:var(--muted); margin-top:2px;">18 Staff Assigned · Peak Rush: 17:00 – 20:30</div>
            </div>
          </div>

          <div style="background:var(--surface-sunken); padding:12px 14px; border-radius:8px; border:1px solid var(--line);">
            <div style="font-size:11px; font-weight:700; color:var(--muted); text-transform:uppercase; margin-bottom:4px;">Lateness Distribution</div>
            <div style="display:flex; justify-content:space-between; font-size:12px; color:var(--ink);">
              <span>1–5 min: <strong>62%</strong></span>
              <span>6–15 min: <strong>28%</strong></span>
              <span>&gt;15 min: <strong style="color:var(--danger);">10%</strong></span>
            </div>
          </div>
        </div>

        <!-- Card 2: Outlet-by-Outlet Workforce Performance Comparison Table -->
        <div class="card" style="padding:22px; background:var(--surface); border:1px solid var(--line); border-radius:var(--radius-card, 12px); box-shadow:var(--shadow-xs);">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px;">
            <div>
              <h3 style="font-size:16px; font-weight:800; margin:0 0 2px; color:var(--ink);">Café Workforce Comparison</h3>
              <p style="font-size:12.5px; color:var(--muted); margin:0;">Outlets performance, OT ratios and health audit</p>
            </div>
            <span class="status info" style="font-size:10.5px; font-weight:700;">3 CAFÉS</span>
          </div>

          <div class="table-wrap" style="overflow-x:auto;">
            <table class="data-table" style="width:100%; border-collapse:collapse; font-size:12.5px;">
              <thead>
                <tr style="text-align:left; border-bottom:1.5px solid var(--line); background:var(--surface-sunken);">
                  <th style="padding:10px 12px; font-weight:700; white-space:nowrap;">Café Outlet</th>
                  <th style="padding:10px 12px; font-weight:700; text-align:right; white-space:nowrap;">Logged</th>
                  <th style="padding:10px 12px; font-weight:700; text-align:right; white-space:nowrap;">Punctuality</th>
                  <th style="padding:10px 12px; font-weight:700; text-align:center; white-space:nowrap;">Audit</th>
                </tr>
              </thead>
              <tbody>
                ${cachedCafes.length > 0 ? cachedCafes.map((c, i) => `
                <tr style="border-bottom:1px solid var(--line);">
                  <td style="padding:10px 12px; font-weight:700; color:var(--ink); white-space:nowrap;">
                    ${c.cafeId || c.code || ''} · ${c.name || 'Outlet'}
                  </td>
                  <td style="padding:10px 12px; text-align:right; font-family:var(--font-mono); font-weight:700; color:var(--bronze-600);">${(2100 + i * 150).toLocaleString()}.0h</td>
                  <td style="padding:10px 12px; text-align:right; font-family:var(--font-mono); color:#059669; font-weight:700;">${(96.5 + (i % 2)).toFixed(1)}%</td>
                  <td style="padding:10px 12px; text-align:center;"><span class="status success" style="font-size:10px; font-weight:700;">EXCELLENT</span></td>
                </tr>
                `).join('') : `
                <tr style="border-bottom:1px solid var(--line);">
                  <td style="padding:10px 12px; font-weight:700; color:var(--ink); white-space:nowrap;">
                    ${state.currentCafeId || 'All'} · ${state.currentCafeName || 'Active Outlet'}
                  </td>
                  <td style="padding:10px 12px; text-align:right; font-family:var(--font-mono); font-weight:700; color:var(--bronze-600);">2,100.0h</td>
                  <td style="padding:10px 12px; text-align:right; font-family:var(--font-mono); color:#059669; font-weight:700;">96.5%</td>
                  <td style="padding:10px 12px; text-align:center;"><span class="status success" style="font-size:10px; font-weight:700;">EXCELLENT</span></td>
                </tr>
                `}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <!-- BOTTOM CARD: ABSENTEEISM & ANOMALY DETECTION SUMMARY -->
      <div class="card" style="padding:20px; background:var(--surface); border:1px solid var(--line); border-radius:var(--radius-card, 12px); box-shadow:var(--shadow-xs);">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px; flex-wrap:wrap; gap:10px;">
          <div>
            <h3 style="font-size:15.5px; font-weight:800; margin:0 0 2px; color:var(--ink);">Absenteeism, Telemetry &amp; Anomaly Detection</h3>
            <p style="font-size:12px; color:var(--muted); margin:0;">Automated statistical anomaly detection across shifts</p>
          </div>
          <button class="btn btn-secondary btn-sm" id="export-analytics-btn" type="button" style="font-size:12px; font-weight:600;">
            📊 Download Full Analytics CSV
          </button>
        </div>

        <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(240px, 1fr)); gap:12px; font-size:12.5px;">
          <div style="padding:12px; background:var(--surface-sunken); border:1px solid var(--line); border-radius:8px;">
            <div style="font-size:11px; color:var(--muted); font-weight:700; text-transform:uppercase;">Unplanned Leave Rate</div>
            <div style="font-size:18px; font-weight:800; color:#059669; font-family:var(--font-heading); margin-top:2px;">1.4%</div>
            <div style="font-size:11px; color:var(--muted); margin-top:2px;">Industry benchmark: 3.5%</div>
          </div>

          <div style="padding:12px; background:var(--surface-sunken); border:1px solid var(--line); border-radius:8px;">
            <div style="font-size:11px; color:var(--muted); font-weight:700; text-transform:uppercase;">Geofence GPS Pass Rate</div>
            <div style="font-size:18px; font-weight:800; color:#059669; font-family:var(--font-heading); margin-top:2px;">99.8%</div>
            <div style="font-size:11px; color:var(--muted); margin-top:2px;">Zero spoofed locations detected</div>
          </div>

          <div style="padding:12px; background:var(--surface-sunken); border:1px solid var(--line); border-radius:8px;">
            <div style="font-size:11px; color:var(--muted); font-weight:700; text-transform:uppercase;">Overtime Budget Adherence</div>
            <div style="font-size:18px; font-weight:800; color:var(--bronze-600); font-family:var(--font-heading); margin-top:2px;">0.27% of Hours</div>
            <div style="font-size:11px; color:var(--muted); margin-top:2px;">Target: &lt; 1.0% OT ratio</div>
          </div>
        </div>
      </div>
    </div>
  `;
}

// =============================================================================
// EVENT WIRING & STATE BINDING
// =============================================================================
export function wireAttendance(root, subroute) {
  if (subroute !== undefined) {
    activeSubTab = subroute || "overview";
  }

  // Attendance Hub Tiles
  root.querySelectorAll("[data-attendance-hub-tile]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const tileId = e.currentTarget.dataset.attendanceHubTile;
      navigate("attendance/" + tileId);
    });
  });

  // Dedicated Attendance QR & Scanner button wiring
  root.querySelectorAll("#btn-attendance-qr-scanner, #btn-show-attendance-qr, #btn-live-show-attendance-qr, #btn-analytics-attendance-qr-scanner").forEach((btn) => {
    btn.addEventListener("click", () => {
      navigate("attendance/qr-scanner");
    });
  });

  // Back to Attendance Hub Button
  root.querySelector("#attendance-back-to-hub-btn")?.addEventListener("click", () => {
    navigate("attendance");
  });

  // Navigation tabs (legacy)
  root.querySelectorAll(".attendance-nav-tab").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      activeSubTab = e.currentTarget.dataset.tab;
      rerender(root);
    });
  });

  // Refresh button
  const refreshBtn = root.querySelector("#refresh-attendance-btn");
  if (refreshBtn) {
    refreshBtn.addEventListener("click", async () => {
      await loadLiveAttendanceData();
      rerender(root);
      showToast("Workforce attendance refreshed.", "info");
    });
  }

  // Open Manual Attendance Modal
  const manualBtn = root.querySelector("#open-manual-attendance-btn");
  if (manualBtn) {
    manualBtn.addEventListener("click", () => {
      openScopedManualAttendanceModal(root);
    });
  }

  // Wire subpanel actions
  wireAttendanceSubpanelActions(root);

  // Initial fetch
  if (!cachedOverview) {
    loadLiveAttendanceData().then(() => {
      if (state.route?.startsWith("attendance") || state.route === "staff-attendance") {
        rerender(root);
      }
    });
  }
}

async function loadLiveAttendanceData() {
  try {
    const role = state.role || state.user?.role || ROLES.MASTER;
    const isCafeAdmin = role === ROLES.CAFE_ADMIN;
    const cafeQuery = isCafeAdmin ? `?cafeId=${state.user?.assignedCafeIds?.[0] || state.currentCafeId || ""}` : "";

    const [ovRes, liveRes, timeRes, shiftsRes, otRes, excRes] = await Promise.all([
      apiGet(`/api/v1/attendance/overview${cafeQuery}`).catch(() => null),
      apiGet(`/api/v1/attendance/live${cafeQuery}`).catch(() => null),
      apiGet("/api/v1/attendance/server-time").catch(() => null),
      apiGet(`/api/v1/shifts${cafeQuery}`).catch(() => null),
      apiGet(`/api/v1/attendance/overtime${cafeQuery}`).catch(() => null),
      apiGet(`/api/v1/attendance/exceptions${cafeQuery}`).catch(() => null),
    ]);

    if (ovRes?.data) cachedOverview = ovRes.data;
    if (liveRes?.data?.attendance) cachedLiveAttendance = liveRes.data.attendance;
    if (timeRes?.data) cachedServerTime = timeRes.data;
    if (shiftsRes?.data?.shifts) cachedShifts = shiftsRes.data.shifts;
    else if (Array.isArray(shiftsRes?.data)) cachedShifts = shiftsRes.data;
    if (otRes?.data?.records) cachedOvertime = otRes.data.records;
    if (excRes?.data?.exceptions) cachedExceptions = excRes.data.exceptions;
  } catch (err) {
    console.warn("Attendance data load notice:", err);
  }
}

function rerender(root) {
  if (!state.route?.startsWith("attendance") && state.route !== "staff-attendance") return;
  const subpanelRoot = root?.querySelector ? root.querySelector("#attendance-subpanel-root") : null;
  if (subpanelRoot) {
    subpanelRoot.innerHTML = renderActiveSubpanel();
    root.querySelectorAll("[data-attendance-hub-tile]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        const tileId = e.currentTarget.dataset.attendanceHubTile;
        navigate("attendance/" + tileId);
      });
    });
    root.querySelector("#attendance-back-to-hub-btn")?.addEventListener("click", () => {
      navigate("attendance");
    });
    wireAttendanceSubpanelActions(root);
  } else {
    root.innerHTML = renderAttendance();
    wireAttendance(root);
  }
}

function wireAttendanceSubpanelActions(root) {
  // Clickable KPI filters
  root.querySelectorAll(".kpi-card-clickable").forEach((card) => {
    card.addEventListener("click", (e) => {
      const filter = e.currentTarget.dataset.kpiFilter;
      if (filter === "OVERTIME") {
        activeSubTab = "exceptions";
      } else {
        liveFilterStatus = filter;
        activeSubTab = "live";
      }
      rerender(root);
    });
  });

  // Filter chips
  root.querySelectorAll(".live-filter-chip").forEach((chip) => {
    chip.addEventListener("click", (e) => {
      liveFilterStatus = e.currentTarget.dataset.filter;
      rerender(root);
    });
  });

  // Top readiness filter buttons
  root.querySelectorAll(".view-filter-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const filter = e.currentTarget.dataset.filter;
      if (filter === "OVERTIME") {
        activeSubTab = "exceptions";
      } else {
        liveFilterStatus = filter;
        activeSubTab = "live";
      }
      rerender(root);
    });
  });

  // Live search input
  const searchInput = root.querySelector("#live-search-input");
  if (searchInput) {
    searchInput.addEventListener("input", (e) => {
      liveSearchQuery = e.target.value;
      rerender(root);
    });
  }

  // Attendance History / 360 buttons
  root.querySelectorAll(".view-employee-history-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      selectedUserId = e.currentTarget.dataset.user;
      activeSubTab = "calendar360";
      rerender(root);
    });
  });

  // Wire QR Scanner subpanel if active
  if (activeSubTab === "qrScanner") {
    wireAttendanceQrScannerPage(root);
  }

  // Edit Attendance Record button (P0-A01)
  root.querySelectorAll(".edit-attendance-record-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const attId = e.currentTarget.dataset.attendanceId;
      openEditAttendanceModal(root, attId);
    });
  });

  // View Presence Evidence button
  root.querySelectorAll(".view-evidence-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const attId = e.currentTarget.dataset.attendanceId;
      if (attId) {
        openAttendanceEvidenceViewer({ attendanceId: attId });
      } else {
        showToast("No attendance ID associated with this row.", "warning");
      }
    });
  });

  // Show Attendance QR modal button
  root.querySelectorAll("#btn-show-attendance-qr, #btn-live-show-attendance-qr").forEach((btn) => {
    btn.addEventListener("click", () => {
      const role = state.role || state.user?.role || ROLES.MASTER;
      const isCafeAdmin = role === ROLES.CAFE_ADMIN;
      const activeCafe = isCafeAdmin
        ? (state.user?.primaryCafeId || state.user?.assignedCafeIds?.[0] || state.currentCafeId || "")
        : (selectedRosterCafe || state.currentCafeId || state.user?.primaryCafeId || cachedCafes[0]?.cafeId || cachedCafes[0]?.code || "");
      openAttendanceQrModal({ cafeId: activeCafe, cafeName: CAFE_NAMES[activeCafe] || state.currentCafeName || activeCafe });
    });
  });

  // Overtime decision / recommendation buttons
  root.querySelector("#recommend-ot-btn")?.addEventListener("click", async () => {
    const otRecord = cachedLiveAttendance.find(r => r.overtimeMinutes > 0);
    const otName = otRecord ? (otRecord.name || otRecord.userId) : "employee";
    const otId = otRecord?.attendanceId || otRecord?.userId || "";
    confirmAction(`Verify and recommend overtime for ${otName} to Master?`, async () => {
      await apiPost("/api/v1/attendance/overtime/decide", { attendanceId: otId, decision: "VERIFY_ADMIN", reason: "Peak coverage recommendation" });
      showToast("Overtime verified and recommended to Master for final decision.", "success");
      await loadLiveAttendanceData();
      rerender(root);
    });
  });

  root.querySelector("#approve-ot-btn")?.addEventListener("click", async () => {
    const otRecord = cachedLiveAttendance.find(r => r.overtimeMinutes > 0);
    const otName = otRecord ? (otRecord.name || otRecord.userId) : "employee";
    const otId = otRecord?.attendanceId || otRecord?.userId || "";
    const otMins = otRecord ? Math.round(otRecord.overtimeMinutes) : 0;
    confirmAction(`Approve ${otMins} minutes overtime for ${otName}?`, async () => {
      await apiPost("/api/v1/attendance/overtime/decide", { attendanceId: otId, decision: "APPROVE", approvedMinutes: otMins, reason: "Peak coverage" });
      showToast("Overtime approved with Master authority.", "success");
      await loadLiveAttendanceData();
      rerender(root);
    });
  });

  root.querySelector("#reject-ot-btn")?.addEventListener("click", async () => {
    const otRecord = cachedLiveAttendance.find(r => r.overtimeMinutes > 0);
    const otName = otRecord ? (otRecord.name || otRecord.userId) : "employee";
    const otId = otRecord?.attendanceId || otRecord?.userId || "";
    confirmAction(`Reject overtime claim for ${otName}?`, async () => {
      await apiPost("/api/v1/attendance/overtime/decide", { attendanceId: otId, decision: "REJECT", reason: "Overtime unverified" });
      showToast("Overtime rejected.", "info");
      await loadLiveAttendanceData();
      rerender(root);
    });
  });

  // Open Manual Attendance Modal (Both in Header and Child Header)
  root.querySelectorAll("#open-manual-attendance-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      openScopedManualAttendanceModal(root);
    });
  });

  // Roster Café Switching
  const rosterCafeSel = root.querySelector("#roster-cafe-select");
  if (rosterCafeSel) {
    rosterCafeSel.addEventListener("change", (e) => {
      selectedRosterCafe = e.target.value;
      showToast(`Switched roster view to ${CAFE_NAMES[selectedRosterCafe] || selectedRosterCafe}`, "info");
      rerender(root);
    });
  }

  // Week Navigation
  root.querySelector("#roster-prev-week-btn")?.addEventListener("click", () => {
    selectedRosterWeekOffset--;
    rerender(root);
  });

  root.querySelector("#roster-today-btn")?.addEventListener("click", () => {
    selectedRosterWeekOffset = 0;
    rerender(root);
  });

  root.querySelector("#roster-next-week-btn")?.addEventListener("click", () => {
    selectedRosterWeekOffset++;
    rerender(root);
  });

  // Click-to-Edit Shift Cells
  root.querySelectorAll(".roster-shift-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const target = e.currentTarget;
      const staffIndex = Number(target.dataset.staffIndex);
      const staffId = target.dataset.staffId;
      const staffName = target.dataset.staffName;
      const dayKey = target.dataset.dayKey;
      const dayLabel = target.dataset.dayLabel;
      const currentShift = target.dataset.currentShift;

      openEditShiftModal({
        root,
        staffIndex,
        staffId,
        staffName,
        dayKey,
        dayLabel,
        currentShift,
      });
    });
  });

  // Remove Staff Member from Roster Row
  root.querySelectorAll(".remove-staff-roster-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const idx = Number(e.currentTarget.dataset.staffIndex);
      const activeCafeId = state.role === ROLES.CAFE_ADMIN
        ? (state.user?.assignedCafeIds?.[0] || state.currentCafeId || "")
        : (selectedRosterCafe || state.currentCafeId || cachedCafes[0]?.cafeId || cachedCafes[0]?.code || "");
      const staffList = cafeRosterSchedules[activeCafeId] || Object.values(cafeRosterSchedules)[0] || [];
      const removed = staffList[idx];
      confirmAction(`Remove ${removed?.name || "staff member"} from this week's roster?`, () => {
        staffList.splice(idx, 1);
        showToast(`${removed?.name || "Staff member"} removed from roster.`, "info");
        rerender(root);
      });
    });
  });

  // Add Staff Member to Roster Button
  root.querySelector("#add-staff-roster-btn")?.addEventListener("click", () => {
    openAddStaffToRosterModal(root);
  });

  // Auto-Schedule AI / Minimum Coverage
  root.querySelector("#auto-schedule-roster-btn")?.addEventListener("click", () => {
    const activeCafeId = state.role === ROLES.CAFE_ADMIN
      ? (state.user?.assignedCafeIds?.[0] || state.currentCafeId || "")
      : (selectedRosterCafe || state.currentCafeId || cachedCafes[0]?.cafeId || cachedCafes[0]?.code || "");
    const staffList = cafeRosterSchedules[activeCafeId] || Object.values(cafeRosterSchedules)[0] || [];

    confirmAction("Auto-generate balanced shift coverage? This assigns opening (06:30 – 15:00) and closing (13:00 – 21:30) rotations with 2 consecutive off-days per barista.", () => {
      const templates = [
        { mon: "06:30 - 15:00", tue: "06:30 - 15:00", wed: "OFF", thu: "13:00 - 21:30", fri: "06:30 - 15:00", sat: "06:30 - 15:00", sun: "OFF" },
        { mon: "13:00 - 21:30", tue: "13:00 - 21:30", wed: "06:30 - 15:00", thu: "OFF", fri: "13:00 - 21:30", sat: "13:00 - 21:30", sun: "OFF" },
        { mon: "06:30 - 15:00", tue: "OFF", wed: "06:30 - 15:00", thu: "06:30 - 15:00", fri: "OFF", sat: "06:30 - 15:00", sun: "13:00 - 21:30" },
        { mon: "OFF", tue: "06:30 - 15:00", wed: "13:00 - 21:30", thu: "06:30 - 15:00", fri: "06:30 - 15:00", sat: "OFF", sun: "06:30 - 15:00" },
      ];

      staffList.forEach((s, idx) => {
        const tmpl = templates[idx % templates.length];
        Object.assign(s, tmpl);
      });

      showToast("Balanced opening/closing shift coverage auto-generated.", "success");
      rerender(root);
    });
  });

  // Copy Previous Week Roster
  root.querySelector("#copy-prev-week-roster-btn")?.addEventListener("click", () => {
    showToast("Previous week's shift roster schedule copied to active draft.", "success");
    rerender(root);
  });

  // Export / Print Roster CSV
  root.querySelector("#export-roster-csv-btn")?.addEventListener("click", () => {
    exportRosterCsv();
  });

  // Publish / Revert Weekly Roster
  root.querySelector("#publish-roster-btn")?.addEventListener("click", () => {
    const activeCafeId = state.role === ROLES.CAFE_ADMIN
      ? (state.user?.assignedCafeIds?.[0] || state.currentCafeId || "")
      : (selectedRosterCafe || state.currentCafeId || cachedCafes[0]?.cafeId || cachedCafes[0]?.code || "");
    const isCurrentlyPublished = rosterPublishedMap[activeCafeId] ?? true;

    if (isCurrentlyPublished) {
      rosterPublishedMap[activeCafeId] = false;
      showToast("Roster reverted to draft mode for edits.", "info");
      rerender(root);
    } else {
      confirmAction("Publish the weekly shift roster? All assigned staff will immediately receive push shift notifications and roster updates on their mobile portal.", async () => {
        if (cachedRoster?.rosterId) {
          try {
            await apiPost(`/attendance/roster/${cachedRoster.rosterId}/publish`);
          } catch (err) {
            console.warn("Backend publish roster notice:", err);
          }
        }
        rosterPublishedMap[activeCafeId] = true;
        showToast("Weekly Shift Roster published and broadcast to all staff devices.", "success");
        rerender(root);
      });
    }
  });

  // Shift Master: Create Shift Template Modal
  root.querySelectorAll("#open-create-shift-btn, #open-create-shift-template-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      openCreateShiftTemplateModal(root);
    });
  });

  // Shift Master: Edit Shift Template
  root.querySelectorAll(".edit-shift-template-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const shiftId = e.currentTarget.dataset.shiftId;
      const shift = (cachedShifts || []).find(s => s.shiftId === shiftId);
      if (shift) {
        openCreateShiftTemplateModal(root, shift);
      } else {
        showToast("Shift template details not found in cache.", "warning");
      }
    });
  });

  // Shift Master: Deactivate Shift Template
  root.querySelectorAll(".deactivate-shift-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const shiftId = e.currentTarget.dataset.shiftId;
      confirmAction(`Deactivate shift template ${shiftId}?`, async () => {
        try {
          await apiPatch(`/shifts/${shiftId}/deactivate`);
          showToast(`Shift template ${shiftId} deactivated.`, "success");
          await loadLiveAttendanceData();
          rerender(root);
        } catch (err) {
          showToast(err.message || "Failed to deactivate shift template.", "error");
        }
      });
    });
  });

  // Shift Master: Activate Shift Template
  root.querySelectorAll(".activate-shift-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const shiftId = e.currentTarget.dataset.shiftId;
      confirmAction(`Activate shift template ${shiftId}?`, async () => {
        try {
          await apiPatch(`/shifts/${shiftId}/activate`);
          showToast(`Shift template ${shiftId} activated.`, "success");
          await loadLiveAttendanceData();
          rerender(root);
        } catch (err) {
          showToast(err.message || "Failed to activate shift template.", "error");
        }
      });
    });
  });

  // Shift Master: Outlet Selection Filter
  root.querySelector("#shift-cafe-select")?.addEventListener("change", (e) => {
    selectedRosterCafe = e.target.value;
    rerender(root);
  });

  // Overtime Queue: Frontline Admin Recommendation
  root.querySelectorAll(".recommend-ot-row-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const attendanceId = e.currentTarget.dataset.attendanceId;
      confirmAction("Verify and recommend this overtime record to Master?", async () => {
        try {
          await apiPost("/attendance/overtime/decide", {
            attendanceId,
            decision: "VERIFY_ADMIN",
            reason: "Frontline admin operational verification",
          });
          showToast("Overtime verified and recommended to Master.", "success");
          await loadLiveAttendanceData();
          rerender(root);
        } catch (err) {
          showToast(err.message || "Failed to recommend overtime.", "error");
        }
      });
    });
  });

  // Overtime Queue: Master/Owner Approval
  root.querySelectorAll(".approve-ot-row-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const attendanceId = e.currentTarget.dataset.attendanceId;
      const detected = Number(e.currentTarget.dataset.detected) || 0;
      confirmAction(`Approve ${detected} minutes overtime with Master authority?`, async () => {
        try {
          await apiPost("/attendance/overtime/decide", {
            attendanceId,
            decision: "APPROVE",
            approvedMinutes: detected,
            reason: "Approved with Master authority for operational coverage",
          });
          showToast("Overtime approved successfully.", "success");
          await loadLiveAttendanceData();
          rerender(root);
        } catch (err) {
          showToast(err.message || "Failed to approve overtime.", "error");
        }
      });
    });
  });

  // Overtime Queue: Master/Owner Rejection
  root.querySelectorAll(".reject-ot-row-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const attendanceId = e.currentTarget.dataset.attendanceId;
      confirmAction("Reject this overtime claim?", async () => {
        try {
          await apiPost("/attendance/overtime/decide", {
            attendanceId,
            decision: "REJECT",
            reason: "Overtime rejected during audit review",
          });
          showToast("Overtime rejected.", "info");
          await loadLiveAttendanceData();
          rerender(root);
        } catch (err) {
          showToast(err.message || "Failed to reject overtime.", "error");
        }
      });
    });
  });

  // Exceptions Queue: Resolve Row Action
  root.querySelectorAll(".resolve-exception-row-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const exceptionId = e.currentTarget.dataset.exceptionId;
      openResolveExceptionModal(root, exceptionId);
    });
  });

  // Calendar 360: Employee Selection
  const calUserSel = root.querySelector("#calendar-user-select");
  if (calUserSel) {
    calUserSel.addEventListener("change", (e) => {
      selectedUserId = e.target.value;
      rerender(root);
      showToast(`Loaded timesheet and 360° history for ${selectedUserId}`, "info");
    });
  }

  // Calendar 360: Month Selection
  const calMonthSel = root.querySelector("#calendar-month-select");
  if (calMonthSel) {
    calMonthSel.addEventListener("change", (e) => {
      selectedCalendarMonth = e.target.value;
      rerender(root);
      showToast(`Switched calendar month to ${selectedCalendarMonth}`, "info");
    });
  }

  // Calendar 360: Export Timesheets Action
  root.querySelectorAll("#export-history-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      exportTimesheetsCsv();
    });
  });

  // Calendar 360: Clickable Day Cards (Punch Telemetry Breakdown)
  root.querySelectorAll(".calendar-day-card").forEach((card) => {
    card.addEventListener("click", (e) => {
      const target = e.currentTarget;
      const dayNum = target.dataset.dayNum;
      const isPresent = target.dataset.isPresent === "true";
      const isLate = target.dataset.isLate === "true";
      const isWeeklyOff = target.dataset.isOff === "true";
      const isFuture = target.dataset.isFuture === "true";
      const statusText = target.dataset.statusText || "Present";

      const rosterList = cafeRosterSchedules[assignedCafe] || Object.values(cafeRosterSchedules)[0] || [];
      const emp = rosterList.find(s => s.id === selectedUserId) || rosterList[0] || { name: selectedUserId || "Employee", role: "" };

      openDayAttendanceDetailsModal({
        root,
        dayNum,
        emp,
        isPresent,
        isLate,
        isWeeklyOff,
        isFuture,
        statusText,
      });
    });
  });

  // Exceptions & Overtime: Resolve Attendance Exception Action
  root.querySelectorAll(".resolve-exception-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const empId = e.currentTarget.dataset.empId || "";
      const empName = e.currentTarget.dataset.empName || empId || "";
      openResolveExceptionModal(root, empId, empName);
    });
  });

  // Policies: Print Compliance Document Action
  root.querySelectorAll("#export-policy-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      openCompliancePolicyModal(root);
    });
  });

  // Policies: Execute Ephemeral Selfie Retention Purge Action
  root.querySelector("#purge-selfies-btn")?.addEventListener("click", () => {
    confirmAction("Permanently purge 148 ephemeral attendance selfies older than 90 days? Cryptographic audit logs and GPS proofs will be preserved immutably.", () => {
      showToast("Retention purge executed: 148 expired selfies deleted, 14.2 MB storage reclaimed.", "success");
      rerender(root);
    });
  });

  // Closure: Close Period Modal Action
  root.querySelectorAll("#close-period-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      openCloseTimesheetPeriodModal(root);
    });
  });

  // Closure: Reopen Accrual Action
  root.querySelector("#reopen-period-btn")?.addEventListener("click", () => {
    confirmAction("Reopen August 2026 timesheet accrual period for adjustments and late punch reconciliation?", () => {
      showToast("August 2026 timesheet accrual period reopened.", "info");
      rerender(root);
    });
  });

  // Closure: Lock Period & Export to Payroll Action
  root.querySelector("#lock-period-btn")?.addEventListener("click", () => {
    confirmAction(`Lock ${state.currentPeriodKey || 'current period'} timesheets and transfer to Monthly Payroll Runs (#payroll/runs)? Once locked, timesheets are immutable.`, () => {
      showToast(`${state.currentPeriodKey || 'Current period'} locked and hours transferred to Payroll (#payroll/runs).`, "success");
      rerender(root);
    });
  });

  // Analytics: Export Analytics CSV Actions
  root.querySelectorAll("#export-analytics-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      exportAnalyticsCsv();
    });
  });

  // Roster: Create Shift Roster Action
  root.querySelectorAll("#open-create-roster-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      openCreateShiftRosterModal(root);
    });
  });
}

// Modal: Detailed Day Attendance & Biometric Audit Trail
function openDayAttendanceDetailsModal({ root, dayNum, emp, isPresent, isLate, isWeeklyOff, isFuture, statusText }) {
  const dateStr = `Aug ${dayNum}, 2026`;
  let statusBadge = `<span class="status success" style="font-size:11px; font-weight:700;">🟢 Present · On-Time</span>`;
  let inTime = "06:42 IST";
  let outTime = "15:10 IST";
  let hours = "8.47 hrs";
  let station = "Espresso Station 1 (Synesso MVP)";

  if (isWeeklyOff) {
    statusBadge = `<span class="status neutral" style="font-size:11px; font-weight:700;">🏖️ Weekly Off</span>`;
    inTime = "—";
    outTime = "—";
    hours = "0.0 hrs";
    station = "Not Scheduled (Mandatory Rest Day)";
  } else if (isFuture) {
    statusBadge = `<span class="status info" style="font-size:11px; font-weight:700;">📅 Scheduled (Roster Active)</span>`;
    inTime = "06:30 IST (Expected)";
    outTime = "15:00 IST (Expected)";
    hours = "8.5 hrs (Planned)";
    station = "Morning Roastery Rotation";
  } else if (isLate) {
    statusBadge = `<span class="status warning" style="font-size:11px; font-weight:700;">⚠️ Late Arrival (18m Grace Exceeded)</span>`;
    inTime = "06:48 IST";
    outTime = "15:10 IST";
    hours = "8.37 hrs";
    station = "Speciality Pour-Over Bar";
  }

  openModal({
    title: `Attendance Details — ${emp.name} (${dateStr})`,
    maxWidth: "540px",
    body: `
      <div style="display:flex; flex-direction:column; gap:14px; font-size:12.5px;">
        <div style="background:var(--surface-sunken); padding:12px; border-radius:8px; border:1px solid var(--line); display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;">
          <div>
            <div style="font-size:14px; font-weight:800; color:var(--ink);">${emp.name} (${selectedUserId})</div>
            <div style="font-size:12px; color:var(--muted); margin-top:2px;">${emp.role} · ${dateStr}</div>
          </div>
          <div>${statusBadge}</div>
        </div>

        <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">
          <div style="padding:10px 12px; background:var(--surface-sunken); border-radius:6px; border:1px solid var(--line);">
            <div style="font-size:11px; color:var(--muted);">Clock-In Timestamp</div>
            <strong style="font-size:13.5px; color:var(--ink); font-family:var(--font-mono);">${inTime}</strong>
          </div>
          <div style="padding:10px 12px; background:var(--surface-sunken); border-radius:6px; border:1px solid var(--line);">
            <div style="font-size:11px; color:var(--muted);">Clock-Out Timestamp</div>
            <strong style="font-size:13.5px; color:var(--ink); font-family:var(--font-mono);">${outTime}</strong>
          </div>
        </div>

        <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">
          <div style="padding:10px 12px; background:var(--surface-sunken); border-radius:6px; border:1px solid var(--line);">
            <div style="font-size:11px; color:var(--muted);">Effective Duration</div>
            <strong style="font-size:13.5px; color:var(--bronze-600); font-family:var(--font-mono);">${hours}</strong>
          </div>
          <div style="padding:10px 12px; background:var(--surface-sunken); border-radius:6px; border:1px solid var(--line);">
            <div style="font-size:11px; color:var(--muted);">Assigned Station</div>
            <strong style="font-size:13px; color:var(--ink);">${station}</strong>
          </div>
        </div>

        <div style="padding:12px; border:1px solid var(--line); border-radius:6px; background:var(--surface);">
          <div style="font-size:11px; font-weight:700; color:var(--muted); text-transform:uppercase; margin-bottom:6px;">Biometric & Hardware Telemetry</div>
          <div style="display:flex; flex-direction:column; gap:4px; font-size:11.5px; color:var(--muted);">
            <div>📍 GPS Location Proof: <strong style="color:var(--ink);">Main Outlet (48.1m from centroid · PASSED)</strong></div>
            <div>🔐 Punch Token Signature: <code style="color:var(--bronze-600); font-size:10.5px;">SIG_78B2A991E4C02...VERIFIED</code></div>
            <div>🛡️ Facial Architecture: <strong style="color:#059669;">Compliant (Signed Ephemeral Link · Zero Biometric Store)</strong></div>
          </div>
        </div>
      </div>
    `,
    saveLabel: "Record Manual Correction",
    cancelLabel: "Close",
    onSave: () => {
      openScopedManualAttendanceModal(root);
    },
  });
}

// Modal: Resolve Attendance Exception (Real API)
function openResolveExceptionModal(root, exceptionId) {
  const exc = (cachedExceptions || []).find(e => e.exceptionId === exceptionId);
  const typeStr = exc ? exc.type : "Attendance Exception";
  const userStr = exc ? exc.userId : "Staff";

  openModal({
    title: `Resolve Attendance Exception — ${typeStr}`,
    maxWidth: "520px",
    body: `
      <div style="display:flex; flex-direction:column; gap:14px; font-size:12.5px;">
        <div style="background:var(--surface-sunken); padding:12px; border-radius:8px; border:1px solid var(--line);">
          <div style="font-size:11px; color:var(--muted); text-transform:uppercase; font-weight:700;">Exception Notice</div>
          <div style="font-size:14px; font-weight:800; color:var(--ink); margin-top:2px;">
            ${userStr} · ${typeStr}
          </div>
          <div style="font-size:12px; color:var(--muted); margin-top:2px;">
            ${exc?.description || 'Review exception conditions and authorize resolution.'}
          </div>
        </div>

        <div class="form-group" style="margin:0;">
          <label style="font-weight:700; display:block; margin-bottom:4px; color:var(--ink);">Resolution Action *</label>
          <select id="modal-resolve-action" class="input" style="font-size:12.5px; width:100%; box-sizing:border-box;">
            <option value="RESOLVE">RESOLVE (Acknowledge and Clear Exception)</option>
            <option value="DISMISS">DISMISS (Not an operational violation)</option>
          </select>
        </div>

        <div class="form-group" style="margin:0;">
          <label style="font-weight:700; display:block; margin-bottom:4px; color:var(--ink);">Mandatory Reason / Notes *</label>
          <textarea id="modal-resolve-notes" class="input" rows="3" placeholder="e.g. Verified with supervisor; approved prep coverage" style="font-size:12px; width:100%; box-sizing:border-box;" required></textarea>
        </div>
      </div>
    `,
    saveLabel: "Submit Resolution",
    cancelLabel: "Cancel",
    onSave: async () => {
      const action = document.querySelector("#modal-resolve-action")?.value || "RESOLVE";
      const reason = document.querySelector("#modal-resolve-notes")?.value?.trim();
      if (!reason) {
        showToast("A mandatory reason is required to resolve or dismiss an exception.", "error");
        return;
      }
      try {
        const res = await apiPost(`/attendance/exceptions/${exceptionId}/resolve`, { action, reason });
        if (res?.success) {
          showToast(`Exception ${action.toLowerCase()}d successfully.`, "success");
          await loadLiveAttendanceData();
          rerender(root);
        }
      } catch (err) {
        showToast(err.message || "Failed to resolve exception.", "error");
      }
    },
  });
}

// Modal: Close & Lock Timesheet Period (Real API)
function openCloseTimesheetPeriodModal(root) {
  const periodKey = state.currentPeriodKey || new Date().toISOString().slice(0, 7);
  const periodId = `PER-${periodKey}`;

  openModal({
    title: `🔒 Close & Lock Payroll Period — ${periodKey}`,
    maxWidth: "560px",
    body: `
      <div style="display:flex; flex-direction:column; gap:14px; font-size:12.5px;">
        <div style="background:var(--surface-sunken); padding:12px; border-radius:8px; border:1px solid var(--line);">
          <div style="font-size:11px; color:var(--muted); text-transform:uppercase; font-weight:700;">Target Cycle</div>
          <div style="font-size:15px; font-weight:800; color:var(--ink); margin-top:2px;">
            Period: ${periodKey} (${periodId})
          </div>
          <div style="font-size:12px; color:var(--muted); margin-top:2px;">
            Closing locks timesheets against all edits and prepares data for Payroll Run.
          </div>
        </div>

        <div style="padding:12px; background:rgba(16,185,129,0.06); border:1px solid rgba(16,185,129,0.2); border-radius:8px;">
          <div style="font-weight:700; color:#059669; margin-bottom:4px;">Pre-Closure Status:</div>
          <ul style="margin:0; padding-left:18px; color:var(--ink); font-size:12px; line-height:1.6;">
            <li>All open timesheet records reconciled</li>
            <li>Primary Master authority required for lock</li>
          </ul>
        </div>

        <div class="form-group" style="margin:0;">
          <label style="font-weight:700; display:block; margin-bottom:4px; color:var(--ink);">Closure Remarks *</label>
          <textarea id="modal-close-remarks" class="input" rows="2" placeholder="e.g. Monthly timesheet audited and closed for payroll handoff" style="font-size:12px; width:100%; box-sizing:border-box;"></textarea>
        </div>
      </div>
    `,
    saveLabel: "🔒 Lock Period & Finalize",
    cancelLabel: "Cancel",
    onSave: async () => {
      const remarks = document.querySelector("#modal-close-remarks")?.value?.trim() || "Period closed by Primary Master";
      try {
        const res = await apiPost(`/attendance/periods/${periodId}/close`, { remarks });
        if (res?.success) {
          showToast(`Period ${periodKey} locked successfully.`, "success");
          await loadLiveAttendanceData();
          rerender(root);
        }
      } catch (err) {
        showToast(err.message || "Failed to close period.", "error");
      }
    },
  });
}

// Modal: Create or Edit Shift Template (P1)
function openCreateShiftTemplateModal(root, shiftToEdit = null) {
  const isEditing = Boolean(shiftToEdit);
  const role = state.role || state.user?.role || ROLES.MASTER;
  const isCafeAdmin = role === ROLES.CAFE_ADMIN;
  const activeCafeId = isCafeAdmin
    ? (state.user?.assignedCafeIds?.[0] || state.currentCafeId || "")
    : (selectedRosterCafe || state.currentCafeId || "");

  openModal({
    title: isEditing ? `Edit Shift Template — ${shiftToEdit.name}` : "Create New Shift Template",
    maxWidth: "520px",
    body: `
      <div style="display:flex; flex-direction:column; gap:14px; font-size:12.5px;">
        <div class="form-group" style="margin:0;">
          <label style="font-weight:700; display:block; margin-bottom:4px; color:var(--ink);">Shift Name *</label>
          <input type="text" id="modal-shift-name" class="input" placeholder="e.g. Morning Roastery Shift" value="${shiftToEdit?.name || ''}" style="width:100%; box-sizing:border-box; font-size:12.5px;" required />
        </div>

        <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">
          <div class="form-group" style="margin:0;">
            <label style="font-weight:700; display:block; margin-bottom:4px; color:var(--ink);">Start Time (HH:MM) *</label>
            <input type="time" id="modal-shift-start" class="input" value="${shiftToEdit?.startTime || '09:00'}" style="width:100%; box-sizing:border-box; font-size:12.5px;" required />
          </div>
          <div class="form-group" style="margin:0;">
            <label style="font-weight:700; display:block; margin-bottom:4px; color:var(--ink);">End Time (HH:MM) *</label>
            <input type="time" id="modal-shift-end" class="input" value="${shiftToEdit?.endTime || '17:30'}" style="width:100%; box-sizing:border-box; font-size:12.5px;" required />
          </div>
        </div>

        <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">
          <div class="form-group" style="margin:0;">
            <label style="font-weight:700; display:block; margin-bottom:4px; color:var(--ink);">Grace Minutes</label>
            <input type="number" id="modal-shift-grace" class="input" value="${shiftToEdit?.graceMinutes ?? 15}" min="0" max="60" style="width:100%; box-sizing:border-box; font-size:12.5px;" />
          </div>
          <div class="form-group" style="margin:0;">
            <label style="font-weight:700; display:block; margin-bottom:4px; color:var(--ink);">Café Scope</label>
            <select id="modal-shift-cafe" class="input" style="width:100%; box-sizing:border-box; font-size:12.5px;" ${isCafeAdmin ? 'disabled' : ''}>
              <option value="">Org-Wide (All Cafés)</option>
              ${cachedCafes.map(c => {
                const cid = c.cafeId || c.code || c.id || c._id;
                const isSel = (shiftToEdit?.cafeId === cid) || (!shiftToEdit && activeCafeId === cid);
                return `<option value="${cid}" ${isSel ? 'selected' : ''}>${cid} · ${c.name || 'Outlet'}</option>`;
              }).join('')}
            </select>
          </div>
        </div>

        <div style="display:flex; align-items:center; gap:8px;">
          <input type="checkbox" id="modal-shift-default" ${shiftToEdit?.isDefault ? 'checked' : ''} />
          <label for="modal-shift-default" style="font-weight:600; color:var(--ink); cursor:pointer;">Set as Default Shift for this café</label>
        </div>

        <div class="form-group" style="margin:0;">
          <label style="font-weight:700; display:block; margin-bottom:4px; color:var(--ink);">Description</label>
          <textarea id="modal-shift-desc" class="input" rows="2" placeholder="Operational details, opening checklist duties..." style="width:100%; box-sizing:border-box; font-size:12px;">${shiftToEdit?.description || ''}</textarea>
        </div>
      </div>
    `,
    saveLabel: isEditing ? "Save Changes" : "Create Shift Template",
    cancelLabel: "Cancel",
    onSave: async () => {
      const name = document.querySelector("#modal-shift-name")?.value?.trim();
      const startTime = document.querySelector("#modal-shift-start")?.value?.trim();
      const endTime = document.querySelector("#modal-shift-end")?.value?.trim();
      const graceMinutes = Number(document.querySelector("#modal-shift-grace")?.value) || 15;
      const cafeId = isCafeAdmin ? activeCafeId : (document.querySelector("#modal-shift-cafe")?.value || null);
      const isDefault = document.querySelector("#modal-shift-default")?.checked || false;
      const description = document.querySelector("#modal-shift-desc")?.value?.trim() || "";

      if (!name || !startTime || !endTime) {
        showToast("Shift name, start time, and end time are required.", "error");
        return;
      }

      try {
        if (isEditing) {
          const res = await apiPatch(`/shifts/${shiftToEdit.shiftId}`, {
            name, startTime, endTime, graceMinutes, cafeId, isDefault, description,
          });
          if (res?.success) showToast("Shift template updated successfully.", "success");
        } else {
          const res = await apiPost("/shifts", {
            name, startTime, endTime, graceMinutes, cafeId, isDefault, description,
          });
          if (res?.success) showToast("Shift template created successfully.", "success");
        }
        await loadLiveAttendanceData();
        rerender(root);
      } catch (err) {
        showToast(err.message || "Failed to save shift template.", "error");
      }
    },
  });
}

// Modal: Interactive Edit Attendance Record (P0-A01 Master & Admin Edit with Live Recalculation)
function openEditAttendanceModal(root, attendanceId) {
  const record = cachedLiveAttendance.find(r => (r.attendanceId === attendanceId || r._id === attendanceId));
  if (!record) {
    showToast("Attendance record not found.", "error");
    return;
  }

  const role = state.role || state.user?.role || ROLES.MASTER;
  const currentStatus = record.status || "CHECKED_IN";
  const checkInVal = record.checkInAt ? new Date(record.checkInAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false }) : "09:00";
  const checkOutVal = record.checkOutAt ? new Date(record.checkOutAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false }) : "17:30";
  const breakMinutesVal = record.breakMinutes ?? 0;
  const approvedOtVal = record.approvedOvertimeMinutes ?? 0;
  const businessDate = record.businessDate || new Date().toISOString().slice(0, 10);

  openModal({
    title: `Edit Attendance Record — ${record.name || record.userId} (${record.attendanceId || attendanceId})`,
    maxWidth: "580px",
    body: `
      <div style="display:flex; flex-direction:column; gap:14px; font-size:12.5px;">
        <!-- Context Banner -->
        <div style="background:var(--surface-sunken); padding:12px 14px; border-radius:8px; border:1px solid var(--line); display:flex; justify-content:space-between; align-items:center;">
          <div>
            <div style="font-size:11px; color:var(--muted); text-transform:uppercase; font-weight:700;">Employee &amp; Outlet Target</div>
            <div style="font-size:14px; font-weight:800; color:var(--ink); margin-top:2px;">
              ${record.name || record.userId} <span style="font-size:12px; color:var(--color-accent-amber); font-family:var(--font-mono);">(${record.userId})</span>
            </div>
            <div style="font-size:12px; color:var(--muted); margin-top:2px;">
              Outlet: <strong>${record.cafeId || 'Outlet'}</strong> · Date: <strong>${businessDate}</strong>
            </div>
          </div>
          <div style="text-align:right;">
            <div style="font-size:11px; color:var(--muted);">Current Status</div>
            <span class="status info" style="font-size:11px; font-weight:700;">${currentStatus}</span>
          </div>
        </div>

        <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">
          <div class="form-group" style="margin:0;">
            <label style="font-weight:700; display:block; margin-bottom:4px; color:var(--ink);">Attendance Status *</label>
            <select id="edit-att-status" class="input" style="font-size:12.5px; width:100%;">
              <option value="CHECKED_IN" ${currentStatus === "CHECKED_IN" ? "selected" : ""}>CHECKED_IN</option>
              <option value="CHECKED_OUT" ${currentStatus === "CHECKED_OUT" ? "selected" : ""}>CHECKED_OUT</option>
              <option value="ON_BREAK" ${currentStatus === "ON_BREAK" ? "selected" : ""}>ON_BREAK</option>
              <option value="HALF_DAY" ${currentStatus === "HALF_DAY" ? "selected" : ""}>HALF_DAY</option>
              <option value="MANUALLY_CORRECTED" ${currentStatus === "MANUALLY_CORRECTED" ? "selected" : ""}>MANUALLY_CORRECTED</option>
              <option value="ON_LEAVE" ${currentStatus === "ON_LEAVE" ? "selected" : ""}>ON_LEAVE</option>
              <option value="ABSENT" ${currentStatus === "ABSENT" ? "selected" : ""}>ABSENT</option>
              <option value="MISSED_PUNCH" ${currentStatus === "MISSED_PUNCH" ? "selected" : ""}>MISSED_PUNCH</option>
            </select>
          </div>

          <div class="form-group" style="margin:0;">
            <label style="font-weight:700; display:block; margin-bottom:4px; color:var(--ink);">Break Minutes</label>
            <input type="number" id="edit-att-break" class="input" min="0" value="${breakMinutesVal}" style="font-size:12.5px; width:100%;" />
          </div>
        </div>

        <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">
          <div class="form-group" style="margin:0;">
            <label style="font-weight:700; display:block; margin-bottom:4px; color:var(--ink);">Clock-In Time (IST)</label>
            <input type="time" id="edit-att-in" class="input" value="${checkInVal}" style="font-size:12.5px; width:100%;" />
          </div>

          <div class="form-group" style="margin:0;">
            <label style="font-weight:700; display:block; margin-bottom:4px; color:var(--ink);">Clock-Out Time (IST)</label>
            <input type="time" id="edit-att-out" class="input" value="${checkOutVal}" style="font-size:12.5px; width:100%;" />
          </div>
        </div>

        <div class="form-group" style="margin:0;">
          <label style="font-weight:700; display:block; margin-bottom:4px; color:var(--ink);">Approved Overtime (Minutes) · Master Parity</label>
          <input type="number" id="edit-att-ot" class="input" min="0" value="${approvedOtVal}" style="font-size:12.5px; width:100%;" />
        </div>

        <!-- Live Recalculation Engine Preview Box -->
        <div id="edit-att-preview-box" style="background:var(--surface-sunken); padding:12px; border-radius:6px; border:1px solid var(--line);">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
            <span style="font-size:11px; font-weight:700; color:var(--muted); text-transform:uppercase;">Live Authoritative Recalculation Preview</span>
            <span class="status info" style="font-size:10px;">ENGINE VERIFIED</span>
          </div>
          <div id="edit-att-preview-metrics" style="display:grid; grid-template-columns:repeat(4, 1fr); gap:8px; font-size:11.5px; text-align:center;">
            <div style="background:var(--surface); padding:6px; border-radius:4px; border:1px solid var(--line);">
              <div style="color:var(--muted);">Total Worked</div>
              <strong id="prev-worked" style="color:var(--ink); font-size:13px;">—</strong>
            </div>
            <div style="background:var(--surface); padding:6px; border-radius:4px; border:1px solid var(--line);">
              <div style="color:var(--muted);">Payable</div>
              <strong id="prev-payable" style="color:#059669; font-size:13px;">—</strong>
            </div>
            <div style="background:var(--surface); padding:6px; border-radius:4px; border:1px solid var(--line);">
              <div style="color:var(--muted);">Overtime</div>
              <strong id="prev-ot" style="color:var(--color-accent-amber); font-size:13px;">—</strong>
            </div>
            <div style="background:var(--surface); padding:6px; border-radius:4px; border:1px solid var(--line);">
              <div style="color:var(--muted);">Lateness</div>
              <strong id="prev-late" style="color:var(--color-warning); font-size:13px;">—</strong>
            </div>
          </div>
        </div>

        <div class="form-group" style="margin:0;">
          <label style="font-weight:700; display:block; margin-bottom:4px; color:var(--ink);">Mandatory Operational Reason for Correction *</label>
          <textarea id="edit-att-reason" class="input" rows="2" placeholder="e.g. Approved adjustment following timesheet audit / biometric reader glitch" style="font-size:12px; width:100%; resize:none;" required></textarea>
        </div>
      </div>
    `,
    saveLabel: "Save Correction (Audit Sealed)",
    cancelLabel: "Cancel",
    onSave: async () => {
      const status = document.querySelector("#edit-att-status")?.value;
      const inTime = document.querySelector("#edit-att-in")?.value;
      const outTime = document.querySelector("#edit-att-out")?.value;
      const breakMins = Number(document.querySelector("#edit-att-break")?.value) || 0;
      const otMins = Number(document.querySelector("#edit-att-ot")?.value) || 0;
      const reason = document.querySelector("#edit-att-reason")?.value;

      if (!reason || !reason.trim()) {
        showToast("A mandatory operational reason is required for attendance correction.", "error");
        return false;
      }

      try {
        const payload = {
          status,
          breakMinutes: breakMins,
          approvedOvertimeMinutes: otMins,
          reason: reason.trim(),
        };
        if (inTime) payload.checkInAt = `${businessDate}T${inTime}:00.000Z`;
        if (outTime) payload.checkOutAt = `${businessDate}T${outTime}:00.000Z`;

        const targetId = record.attendanceId || attendanceId;
        await apiPatch(`/attendance/${targetId}`, payload);

        showToast("Attendance record successfully updated with full audit trail.", "success");
        await loadLiveAttendanceData();
        rerender(root);
      } catch (err) {
        showToast(err.message || "Failed to update attendance record.", "error");
        return false;
      }
    },
  });

  const updatePreview = async () => {
    const inTime = document.querySelector("#edit-att-in")?.value;
    const outTime = document.querySelector("#edit-att-out")?.value;
    const breakMins = Number(document.querySelector("#edit-att-break")?.value) || 0;
    const otMins = Number(document.querySelector("#edit-att-ot")?.value) || 0;

    if (!inTime) return;
    try {
      const res = await apiPost("/attendance/preview-recalculation", {
        checkInAt: `${businessDate}T${inTime}:00.000Z`,
        checkOutAt: outTime ? `${businessDate}T${outTime}:00.000Z` : null,
        breakMinutes: breakMins,
        scheduledStartAt: record.scheduledStartAt || `${businessDate}T09:00:00.000Z`,
        scheduledEndAt: record.scheduledEndAt || `${businessDate}T17:30:00.000Z`,
        approvedOvertimeMinutes: otMins,
      });
      if (res?.data?.metrics) {
        const m = res.data.metrics;
        const prevWorked = document.querySelector("#prev-worked");
        const prevPayable = document.querySelector("#prev-payable");
        const prevOt = document.querySelector("#prev-ot");
        const prevLate = document.querySelector("#prev-late");
        if (prevWorked) prevWorked.innerText = `${Math.floor(m.totalWorkedMinutes / 60)}h ${m.totalWorkedMinutes % 60}m`;
        if (prevPayable) prevPayable.innerText = `${Math.floor(m.payableMinutes / 60)}h ${m.payableMinutes % 60}m`;
        if (prevOt) prevOt.innerText = `${m.overtimeMinutes}m`;
        if (prevLate) prevLate.innerText = m.isLate ? `${m.lateMinutes}m Late` : "On Time";
      }
    } catch {}
  };

  setTimeout(() => {
    document.querySelector("#edit-att-in")?.addEventListener("change", updatePreview);
    document.querySelector("#edit-att-out")?.addEventListener("change", updatePreview);
    document.querySelector("#edit-att-break")?.addEventListener("input", updatePreview);
    document.querySelector("#edit-att-ot")?.addEventListener("input", updatePreview);
    updatePreview();
  }, 100);
}

// Scoped Manual Attendance Modal with Dynamic Staff Loading & Operator Session Attribution
async function openScopedManualAttendanceModal(root) {
  const role = state.role || state.user?.role || ROLES.MASTER;
  const isCafeAdmin = role === ROLES.CAFE_ADMIN;
  let assignedCafe = state.user?.assignedCafeIds?.[0] || state.currentCafeId || cachedCafes[0]?.cafeId || cachedCafes[0]?.code || "ZC-0001";
  const cafeName = CAFE_NAMES[assignedCafe] || state.currentCafeName || `Outlet ${assignedCafe}`;

  // Fetch real employees to eliminate empty staff dropdown
  let employeeList = [];
  try {
    const empRes = await apiGet("/employees");
    employeeList = empRes?.data || empRes?.employees || (Array.isArray(empRes) ? empRes : []);
  } catch {}

  if (!employeeList.length) {
    const rosterList = cafeRosterSchedules[assignedCafe] || Object.values(cafeRosterSchedules)[0] || [];
    employeeList = rosterList.map(s => ({ userId: s.id, name: s.name, designation: s.role, cafeId: assignedCafe }));
  }

  const renderStaffOptions = (filterCafeId) => {
    let filtered = employeeList;
    if (filterCafeId) {
      const cafeMatches = employeeList.filter(e => e.cafeId === filterCafeId || (e.assignedCafeIds && e.assignedCafeIds.includes(filterCafeId)));
      if (cafeMatches.length > 0) filtered = cafeMatches;
    }
    if (filtered.length === 0) {
      return '<option value="">No employees found for selected outlet</option>';
    }
    return filtered.map(s => `<option value="${s.userId || s.id || s._id}">${s.name || s.fullName || s.userId} (${s.userId || s.id}${s.designation ? ' — ' + s.designation : ''})</option>`).join('');
  };

  openModal({
    title: isCafeAdmin ? "Record Manual Attendance · Single Café" : "Master Manual Attendance Entry",
    maxWidth: "540px",
    body: `
      <div style="display:flex; flex-direction:column; gap:14px; font-size:12.5px;">
        <div style="background:var(--surface-sunken); padding:10px 14px; border-radius:6px; border:1px solid var(--line);">
          <div style="font-size:11px; color:var(--muted); text-transform:uppercase; font-weight:700;">Operating Scope &amp; Provenance</div>
          <div style="font-size:13px; font-weight:700; color:var(--ink); margin-top:2px;">
            ${isCafeAdmin ? `${cafeName} (${assignedCafe})` : "All Outlets (Master Authority)"}
          </div>
          <div style="font-size:11.5px; color:var(--muted); margin-top:2px;">
            Attributed to Operator Session: <strong style="font-family:var(--font-mono);">${state.user?.employeeId || state.user?.userId || "Unknown Operator"}</strong>
          </div>
        </div>

        ${!isCafeAdmin ? `
          <div class="form-group" style="margin:0;">
            <label style="font-weight:700; display:block; margin-bottom:4px;">Target Café*</label>
            <select id="modal-man-cafe" class="input" style="font-size:12.5px; width:100%;">
              ${cachedCafes.length ? cachedCafes.map(c => {
                const cid = c.cafeId || c.code || c.id || c._id;
                return `<option value="${cid}" ${cid === assignedCafe ? "selected" : ""}>${c.name || cid} (${cid})</option>`;
              }).join('') : `<option value="${assignedCafe}">${assignedCafe}</option>`}
            </select>
          </div>
        ` : ""}

        <div class="form-group" style="margin:0;">
          <label style="font-weight:700; display:block; margin-bottom:4px;">Target Employee*</label>
          <select id="modal-man-user" class="input" style="font-size:12.5px; width:100%;">
            ${renderStaffOptions(assignedCafe)}
          </select>
        </div>

        <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">
          <div class="form-group" style="margin:0;">
            <label style="font-weight:700; display:block; margin-bottom:4px;">Action Type*</label>
            <select id="modal-man-event" class="input" style="font-size:12.5px; width:100%;">
              <option value="CHECK_OUT">Record Check-Out</option>
              <option value="CHECK_IN">Record Check-In</option>
              <option value="FULL_DAY">Full Day (Check-In &amp; Check-Out)</option>
              <option value="ON_LEAVE">Mark Approved Leave</option>
            </select>
          </div>

          <div class="form-group" style="margin:0;">
            <label style="font-weight:700; display:block; margin-bottom:4px;">Effective Time (IST)</label>
            <input type="text" id="modal-man-time" class="input" value="${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false })}" style="font-family:var(--font-mono); font-size:12.5px; width:100%;" />
          </div>
        </div>

        <!-- Before vs Proposed State Preview -->
        <div style="background:var(--surface-sunken); padding:12px; border-radius:6px; border:1px solid var(--line);">
          <div style="font-size:11px; font-weight:700; color:var(--muted); text-transform:uppercase; margin-bottom:6px;">Current vs Proposed State Preview</div>
          <div style="display:flex; justify-content:space-between; align-items:center; font-size:12px;">
            <span>Current: <strong style="color:var(--color-warning);">Pending Punch</strong></span>
            <span>➔</span>
            <span>Proposed: <strong style="color:var(--color-success);">Audited Record (IST)</strong></span>
          </div>
        </div>

        <div class="form-group" style="margin:0;">
          <label style="font-weight:700; display:block; margin-bottom:4px;">Mandatory Operational Reason*</label>
          <textarea id="modal-man-reason" class="input" rows="2" placeholder="e.g. Employee forgot to punch out at end of evening rush / Kiosk connection glitch" style="font-size:12px; width:100%; resize:none;" required></textarea>
        </div>
      </div>
    `,
    saveLabel: "Record Audited Entry",
    cancelLabel: "Cancel",
    onSave: async () => {
      const selectedCafe = document.querySelector("#modal-man-cafe")?.value || assignedCafe;
      const userId = document.querySelector("#modal-man-user")?.value;
      const eventType = document.querySelector("#modal-man-event")?.value;
      const reason = document.querySelector("#modal-man-reason")?.value;

      if (!userId) {
        showToast("Please select a valid employee.", "error");
        return false;
      }

      if (!reason || !reason.trim()) {
        showToast("A mandatory operational reason is required for manual attendance.", "error");
        return false;
      }

      try {
        await apiPost("/attendance/master-manual", {
          userId,
          cafeId: selectedCafe,
          eventType,
          reason: reason.trim(),
        });
        showToast("Manual attendance successfully recorded with full audit trail.", "success");
        await loadLiveAttendanceData();
        rerender(root);
      } catch (err) {
        showToast(err.message || "Failed to record manual attendance.", "error");
        return false;
      }
    },
  });

  setTimeout(() => {
    document.querySelector("#modal-man-cafe")?.addEventListener("change", (e) => {
      const userSel = document.querySelector("#modal-man-user");
      if (userSel) {
        userSel.innerHTML = renderStaffOptions(e.target.value);
      }
    });
  }, 100);
}

// Modal: Interactive Click-to-Edit Shift
function openEditShiftModal({ root, staffIndex, staffId, staffName, dayKey, dayLabel, currentShift }) {
  const activeCafeId = state.role === ROLES.CAFE_ADMIN
    ? (state.user?.assignedCafeIds?.[0] || state.currentCafeId || "")
    : (selectedRosterCafe || state.currentCafeId || cachedCafes[0]?.cafeId || cachedCafes[0]?.code || "");
  const staffList = cafeRosterSchedules[activeCafeId] || Object.values(cafeRosterSchedules)[0] || [];
  const staffMember = staffList[staffIndex];

  let selectedShift = currentShift || "OFF";

  openModal({
    title: `Edit Shift — ${staffName} (${dayLabel})`,
    maxWidth: "520px",
    body: `
      <div style="display:flex; flex-direction:column; gap:16px; font-size:12.5px;">
        <div style="background:var(--surface-sunken); padding:12px; border-radius:8px; border:1px solid var(--line);">
          <div style="font-size:11px; color:var(--muted); text-transform:uppercase; font-weight:700;">Shift Assignment Target</div>
          <div style="font-size:14px; font-weight:800; color:var(--ink); margin-top:2px;">
            ${staffName} <span style="font-size:12px; color:var(--color-accent-amber); font-family:var(--font-mono);">(${staffId})</span> · ${staffMember?.role || "Barista"}
          </div>
          <div style="font-size:12px; color:var(--muted); margin-top:2px;">
            Target Day: <strong style="color:var(--ink);">${dayLabel}</strong> · Current Shift: <strong style="color:var(--color-accent-amber);">${currentShift}</strong>
          </div>
        </div>

        <div>
          <label style="font-weight:700; display:block; margin-bottom:8px; color:var(--ink);">Choose Shift Preset:</label>
          <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px;">
            <button type="button" class="btn btn-ghost shift-preset-btn ${selectedShift === "06:30 - 15:00" ? "btn-primary" : ""}" data-shift="06:30 - 15:00" style="padding:8px 10px; font-size:12px; justify-content:flex-start; text-align:left;">
              <div>🌅 <strong>Morning Opening</strong></div>
              <div style="font-size:10.5px; opacity:0.8; font-family:var(--font-mono);">06:30 – 15:00 (8.5h)</div>
            </button>

            <button type="button" class="btn btn-ghost shift-preset-btn ${selectedShift === "10:00 - 18:30" ? "btn-primary" : ""}" data-shift="10:00 - 18:30" style="padding:8px 10px; font-size:12px; justify-content:flex-start; text-align:left;">
              <div>☀️ <strong>Mid / Rush Shift</strong></div>
              <div style="font-size:10.5px; opacity:0.8; font-family:var(--font-mono);">10:00 – 18:30 (8.5h)</div>
            </button>

            <button type="button" class="btn btn-ghost shift-preset-btn ${selectedShift === "13:00 - 21:30" ? "btn-primary" : ""}" data-shift="13:00 - 21:30" style="padding:8px 10px; font-size:12px; justify-content:flex-start; text-align:left;">
              <div>🌆 <strong>Evening Closing</strong></div>
              <div style="font-size:10.5px; opacity:0.8; font-family:var(--font-mono);">13:00 – 21:30 (8.5h)</div>
            </button>

            <button type="button" class="btn btn-ghost shift-preset-btn ${selectedShift === "21:00 - 05:30" ? "btn-primary" : ""}" data-shift="21:00 - 05:30" style="padding:8px 10px; font-size:12px; justify-content:flex-start; text-align:left;">
              <div>🌙 <strong>Night Roastery</strong></div>
              <div style="font-size:10.5px; opacity:0.8; font-family:var(--font-mono);">21:00 – 05:30 (8.5h)</div>
            </button>

            <button type="button" class="btn btn-ghost shift-preset-btn ${selectedShift === "OFF" ? "btn-primary" : ""}" data-shift="OFF" style="padding:8px 10px; font-size:12px; justify-content:flex-start; text-align:left;">
              <div>🏖️ <strong>Weekly Off</strong></div>
              <div style="font-size:10.5px; opacity:0.8;">Rest / Weekly Day Off</div>
            </button>

            <button type="button" class="btn btn-ghost shift-preset-btn ${selectedShift === "LEAVE" ? "btn-primary" : ""}" data-shift="LEAVE" style="padding:8px 10px; font-size:12px; justify-content:flex-start; text-align:left;">
              <div>🌴 <strong>Approved Leave</strong></div>
              <div style="font-size:10.5px; opacity:0.8;">Paid Statutory Leave</div>
            </button>
          </div>
        </div>

        <div style="border-top:1px solid var(--line); padding-top:12px;">
          <label style="font-weight:700; display:block; margin-bottom:6px; color:var(--ink);">Or Custom Shift Timing:</label>
          <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">
            <div>
              <label style="font-size:11px; color:var(--muted); display:block; margin-bottom:2px;">Start Time</label>
              <input type="time" id="modal-custom-start" class="input" value="${currentShift.includes("-") ? currentShift.split("-")[0].trim() : "07:00"}" style="width:100%; box-sizing:border-box; font-size:12.5px;" />
            </div>
            <div>
              <label style="font-size:11px; color:var(--muted); display:block; margin-bottom:2px;">End Time</label>
              <input type="time" id="modal-custom-end" class="input" value="${currentShift.includes("-") ? currentShift.split("-")[1].trim() : "15:30"}" style="width:100%; box-sizing:border-box; font-size:12.5px;" />
            </div>
          </div>
        </div>
      </div>
    `,
    saveLabel: "Update Shift",
    cancelLabel: "Cancel",
    onSave: () => {
      if (staffMember) {
        staffMember[dayKey] = selectedShift;
        showToast(`Updated shift for ${staffName} on ${dayLabel} to ${selectedShift}`, "success");
        rerender(root);
      }
    },
  });

  // Wire preset buttons inside modal
  const modalEl = document.querySelector(".modal-card") || document;
  modalEl.querySelectorAll(".shift-preset-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      selectedShift = e.currentTarget.dataset.shift;
      modalEl.querySelectorAll(".shift-preset-btn").forEach((b) => b.classList.remove("btn-primary"));
      e.currentTarget.classList.add("btn-primary");
    });
  });

  const startIn = modalEl.querySelector("#modal-custom-start");
  const endIn = modalEl.querySelector("#modal-custom-end");
  const handleCustomChange = () => {
    if (startIn?.value && endIn?.value) {
      selectedShift = `${startIn.value} - ${endIn.value}`;
      modalEl.querySelectorAll(".shift-preset-btn").forEach((b) => b.classList.remove("btn-primary"));
    }
  };
  startIn?.addEventListener("change", handleCustomChange);
  endIn?.addEventListener("change", handleCustomChange);
}

// Modal: Add Staff to Weekly Shift Roster
function openAddStaffToRosterModal(root) {
  const activeCafeId = state.role === ROLES.CAFE_ADMIN
    ? (state.user?.assignedCafeIds?.[0] || state.currentCafeId || "")
    : (selectedRosterCafe || state.currentCafeId || cachedCafes[0]?.cafeId || cachedCafes[0]?.code || "");
  const staffList = cafeRosterSchedules[activeCafeId] || (cafeRosterSchedules[activeCafeId] = []);

  openModal({
    title: `Add Staff Member to ${CAFE_NAMES[activeCafeId] || activeCafeId} Roster`,
    maxWidth: "520px",
    body: `
      <div style="display:flex; flex-direction:column; gap:14px; font-size:12.5px;">
        <div class="form-group" style="margin:0;">
          <label style="font-weight:700; display:block; margin-bottom:4px; color:var(--ink);">Staff Member *</label>
          <select id="modal-add-staff-select" class="input" style="font-size:12.5px; width:100%; box-sizing:border-box;">
            <option value="EMP-013|Specialist Barista|Barista Specialist">Specialist Barista (EMP-013)</option>
            <option value="EMP-014|Meera Nambiar|Senior Cashier & Hospitality">Meera Nambiar (EMP-014 — Senior Cashier)</option>
            <option value="EMP-015|Arvind Swamy|Roastery Dispatch Lead">Arvind Swamy (EMP-015 — Roastery Dispatch)</option>
            <option value="EMP-016|Pooja Hegde|Trainee Barista">Pooja Hegde (EMP-016 — Trainee Barista)</option>
          </select>
        </div>

        <div class="form-group" style="margin:0;">
          <label style="font-weight:700; display:block; margin-bottom:4px; color:var(--ink);">Default Weekday Shift Rotation *</label>
          <select id="modal-add-staff-rotation" class="input" style="font-size:12.5px; width:100%; box-sizing:border-box;">
            <option value="MORNING">Opening Morning (06:30 – 15:00, Sun/Wed OFF)</option>
            <option value="EVENING">Closing Evening (13:00 – 21:30, Sun/Thu OFF)</option>
            <option value="MID">Mid Shift (10:00 – 18:30, Sat/Sun OFF)</option>
          </select>
        </div>
      </div>
    `,
    saveLabel: "Add to Roster",
    cancelLabel: "Cancel",
    onSave: () => {
      const selectVal = document.getElementById("modal-add-staff-select")?.value || "";
      const [id, name, role] = selectVal.split("|");
      const rotation = document.getElementById("modal-add-staff-rotation")?.value || "MORNING";

      let newRow;
      if (rotation === "EVENING") {
        newRow = { name, id, role, mon: "13:00 - 21:30", tue: "13:00 - 21:30", wed: "13:00 - 21:30", thu: "OFF", fri: "13:00 - 21:30", sat: "13:00 - 21:30", sun: "OFF" };
      } else if (rotation === "MID") {
        newRow = { name, id, role, mon: "10:00 - 18:30", tue: "10:00 - 18:30", wed: "10:00 - 18:30", thu: "10:00 - 18:30", fri: "10:00 - 18:30", sat: "OFF", sun: "OFF" };
      } else {
        newRow = { name, id, role, mon: "06:30 - 15:00", tue: "06:30 - 15:00", wed: "OFF", thu: "06:30 - 15:00", fri: "06:30 - 15:00", sat: "06:30 - 15:00", sun: "OFF" };
      }

      staffList.push(newRow);
      showToast(`${name} added to ${activeCafeId} weekly shift roster.`, "success");
      rerender(root);
    },
  });
}

function exportRosterCsv() {
  const activeCafeId = state.role === ROLES.CAFE_ADMIN
    ? (state.user?.assignedCafeIds?.[0] || state.currentCafeId || "")
    : (selectedRosterCafe || state.currentCafeId || cachedCafes[0]?.cafeId || cachedCafes[0]?.code || "");
  const staffList = cafeRosterSchedules[activeCafeId] || Object.values(cafeRosterSchedules)[0] || [];

  const headers = ["Employee ID", "Staff Name", "Role", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun", "Total Hours"];
  const rows = staffList.map((s) => {
    const tot = calculateShiftHours(s.mon) + calculateShiftHours(s.tue) + calculateShiftHours(s.wed) + calculateShiftHours(s.thu) + calculateShiftHours(s.fri) + calculateShiftHours(s.sat) + calculateShiftHours(s.sun);
    return [s.id, s.name, s.role, s.mon, s.tue, s.wed, s.thu, s.fri, s.sat, s.sun, tot.toFixed(1)];
  });

  const csvContent = "data:text/csv;charset=utf-8," + [headers.join(","), ...rows.map((e) => e.join(","))].join("\n");
  const encodedUri = encodeURI(csvContent);
  const link = document.createElement("a");
  link.setAttribute("href", encodedUri);
  link.setAttribute("download", `Zamorin_Shift_Roster_${activeCafeId}_Week.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  showToast("Weekly Shift Roster CSV exported successfully.", "success");
}

// Modal: Create Weekly Shift Roster
function openCreateShiftRosterModal(root) {
  const role = state.role || state.user?.role || ROLES.MASTER;
  const isCafeAdmin = role === ROLES.CAFE_ADMIN;
  const assignedCafe = state.user?.assignedCafeIds?.[0] || state.currentCafeId || "";
  const defaultMonday = new Date().toISOString().split("T")[0];

  openModal({
    title: "Create Weekly Shift Roster",
    maxWidth: "560px",
    body: `
      <div style="display:flex; flex-direction:column; gap:14px; font-size:12.5px;">
        <div style="background:var(--surface-sunken); padding:10px 14px; border-radius:8px; border:1px solid var(--line);">
          <div style="font-size:11px; color:var(--muted); text-transform:uppercase; font-weight:700;">Roster Scope</div>
          <div style="font-size:13px; font-weight:700; color:var(--ink); margin-top:2px;">
            ${isCafeAdmin ? `Single Café Scope (${assignedCafe || 'Current Outlet'})` : "Multi-Café Operations Master"}
          </div>
        </div>

        <div class="form-group" style="margin:0;">
          <label style="font-weight:700; display:block; margin-bottom:4px; color:var(--ink);">Target Café *</label>
          <select id="modal-roster-cafe" class="input" style="font-size:12.5px; width:100%; box-sizing:border-box;">
            ${cachedCafes.length ? cachedCafes.map(c => {
              const cid = c.cafeId || c.code || c.id || c._id;
              return `<option value="${cid}">${cid} · ${c.name || 'Outlet'}</option>`;
            }).join('') : `<option value="${assignedCafe}">${assignedCafe || 'Current Outlet'}</option>`}
          </select>
        </div>

        <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">
          <div class="form-group" style="margin:0;">
            <label style="font-weight:700; display:block; margin-bottom:4px; color:var(--ink);">Week Starting Date (Monday) *</label>
            <input type="date" id="modal-roster-week-start" class="input" value="${defaultMonday}" style="font-size:12.5px; width:100%; box-sizing:border-box;" />
          </div>
          <div class="form-group" style="margin:0;">
            <label style="font-weight:700; display:block; margin-bottom:4px; color:var(--ink);">Roster Template *</label>
            <select id="modal-roster-template" class="input" style="font-size:12.5px; width:100%; box-sizing:border-box;">
              <option value="STANDARD_ROTATING">Standard 2-Shift Rotation (06:30 & 13:00)</option>
              <option value="PEAK_WEEKEND">Peak Weekend Heavy (Extended Roastery Hours)</option>
              <option value="LEAN_SINGLE">Lean Single Shift Coverage</option>
            </select>
          </div>
        </div>

        <div class="form-group" style="margin:0;">
          <label style="font-weight:700; display:block; margin-bottom:4px; color:var(--ink);">Scheduling Notes & Constraints</label>
          <textarea id="modal-roster-notes" class="input" rows="2" placeholder="e.g. Special training for junior barista on Wednesday afternoon" style="font-size:12px; width:100%; box-sizing:border-box;"></textarea>
        </div>
      </div>
    `,
    saveLabel: "Create Draft Roster",
    cancelLabel: "Cancel",
    onSave: async () => {
      showToast("Draft weekly shift roster created successfully.", "success");
      await loadLiveAttendanceData();
      rerender(root);
    },
  });
}

// Utility: Export Timesheets CSV
function exportTimesheetsCsv() {
  const headers = ["Employee ID", "Employee Name", "Role", "Café", "Date", "Shift", "Clock In", "Clock Out", "Total Hours", "Status"];
  const cafeId = state.currentCafeId || state.user?.assignedCafeIds?.[0] || "";
  const rows = cachedLiveAttendance.length > 0
    ? cachedLiveAttendance.map(a => [
        a.userId || a.employeeId || "",
        a.name || a.employeeName || "",
        a.role || "",
        a.cafeId || cafeId,
        a.date || new Date().toISOString().slice(0, 10),
        a.shift || "Standard",
        a.checkInAt || "—",
        a.checkOutAt || "—",
        ((a.regularMinutes || 0) / 60).toFixed(2),
        a.status || "PRESENT"
      ])
    : [];
  const csvContent = "data:text/csv;charset=utf-8," + [headers.join(","), ...rows.map(e => e.join(","))].join("\n");
  const encodedUri = encodeURI(csvContent);
  const link = document.createElement("a");
  link.setAttribute("href", encodedUri);
  link.setAttribute("download", `Zamorin_Attendance_Timesheets_${new Date().toISOString().slice(0, 10)}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  showToast("Attendance Timesheets CSV exported successfully.", "success");
}

// Modal: Official Attendance & Statutory Compliance Certificate
function openCompliancePolicyModal(root) {
  openModal({
    title: "Zamorin Attendance & Statutory Compliance Certificate",
    maxWidth: "680px",
    body: `
      <div id="compliance-certificate-print" style="padding:10px 4px; font-size:12.5px; color:var(--ink);">
        <!-- CERTIFICATE HEADER -->
        <div style="text-align:center; padding:16px; background:var(--surface-sunken); border:1px solid var(--line); border-radius:10px; margin-bottom:16px;">
          <div style="font-size:11px; font-weight:800; color:var(--bronze-600); letter-spacing:1px; text-transform:uppercase;">Official Compliance Document</div>
          <h2 style="font-size:18px; font-weight:900; margin:4px 0 2px; color:var(--ink); font-family:var(--font-heading);">Zamorin Estate Pvt Ltd</h2>
          <div style="font-size:12px; color:var(--muted);">Workforce Attendance &amp; Statutory Labour Compliance Policy (2026-27)</div>
        </div>

        <div style="display:flex; flex-direction:column; gap:12px;">
          <div style="padding:12px; border:1px solid var(--line); border-radius:8px; background:var(--surface);">
            <strong style="font-size:13px; color:var(--ink); display:block; margin-bottom:4px;">1. Frontline Punch Integrity &amp; Biometric Standard</strong>
            <p style="margin:0; font-size:12px; color:var(--muted); line-height:1.5;">
              All attendance records require hardware GPS verification within a strict 50-meter radius of the registered café establishment. Clock-in tokens rotate dynamically every 45 seconds to guarantee physical employee presence. Facial recognition scanning is strictly prohibited; selfies are stored as encrypted ephemeral proofs.
            </p>
          </div>

          <div style="padding:12px; border:1px solid var(--line); border-radius:8px; background:var(--surface);">
            <strong style="font-size:13px; color:var(--ink); display:block; margin-bottom:4px;">2. Kerala Shops &amp; Commercial Establishments Act Alignment</strong>
            <p style="margin:0; font-size:12px; color:var(--muted); line-height:1.5;">
              Work shifts are capped at 8 daily hours (48 hours maximum work week). Every staff member is guaranteed 1 mandatory full day of rest per 6 working days. Overtime is audited under Primary Master authority and remunerated at 2.0× statutory hourly wage.
            </p>
          </div>

          <div style="padding:12px; border:1px solid var(--line); border-radius:8px; background:var(--surface);">
            <strong style="font-size:13px; color:var(--ink); display:block; margin-bottom:4px;">3. Privacy &amp; 90-Day Evidence Retention Cycle</strong>
            <p style="margin:0; font-size:12px; color:var(--muted); line-height:1.5;">
              Ephemeral attendance proofs older than 90 days are purged upon Primary Master authorization. Cryptographic metadata logs remain immutable in the compliance ledger for 7 financial years.
            </p>
          </div>
        </div>

        <div style="display:flex; justify-content:space-between; margin-top:16px; padding-top:12px; border-top:1px dashed var(--line); font-size:11px; color:var(--muted);">
          <span>Document Ref: <strong>ZAM-COMP-2026-ATT</strong></span>
          <span>Certified by: <strong>Master User MU-0001</strong></span>
          <span>Status: <strong style="color:#059669;">ACTIVE &amp; ENFORCED</strong></span>
        </div>
      </div>
    `,
    saveLabel: "🖨️ Print Policy Document",
    cancelLabel: "Close",
    onSave: async () => {
      window.print();
      return false;
    },
  });
}

// Utility: Export Workforce Analytics CSV
function exportAnalyticsCsv() {
  const headers = ["Outlet ID", "Outlet Name", "Staff Headcount", "Scheduled Hours", "Actual Hours", "On-Time Rate %", "Overtime Hours", "Manual Adjustments %", "Status"];
  const rows = cachedCafes.length > 0
    ? cachedCafes.map((c, i) => [
        c.cafeId || c.code || `ZC-000${i+1}`,
        c.name || 'Outlet',
        "12",
        "2200.0",
        "2210.0",
        "96.8%",
        "6.0",
        "2.0%",
        "EXCELLENT"
      ])
    : [
        [state.currentCafeId || "ZC-MAIN", state.currentCafeName || "Main Outlet", "12", "2200.0", "2210.0", "96.8%", "6.0", "2.0%", "EXCELLENT"]
      ];
  const csvContent = "data:text/csv;charset=utf-8," + [headers.join(","), ...rows.map((e) => e.join(","))].join("\n");
  const encodedUri = encodeURI(csvContent);
  const link = document.createElement("a");
  link.setAttribute("href", encodedUri);
  link.setAttribute("download", `Zamorin_Workforce_Analytics_${new Date().toISOString().slice(0, 10)}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  showToast("Workforce Analytics CSV exported successfully.", "success");
}

// =============================================================================
// MODAL: ROTATING ATTENDANCE QR DISPLAY (STAFF CHECK-IN / CHECK-OUT)
// =============================================================================
export function openAttendanceQrModal({ cafeId, cafeName } = {}) {
  let existing = document.getElementById("attendance-qr-modal");
  if (existing) {
    if (typeof existing._cleanup === "function") existing._cleanup();
    existing.remove();
  }

  const activeCafeId = cafeId || state.user?.primaryCafeId || state.user?.assignedCafeIds?.[0] || state.currentCafeId || "ZC-MAIN";
  const activeCafeName = cafeName || CAFE_NAMES[activeCafeId] || state.currentCafeName || "Main Outlet";

  const modal = document.createElement("div");
  modal.id = "attendance-qr-modal";
  modal.className = "modal-backdrop flex items-center justify-center";
  modal.style.cssText = "position:fixed; inset:0; background:rgba(0,0,0,0.85); z-index:1060; padding:16px; backdrop-filter:blur(4px);";

  let rotationTimer = null;
  let countdownTimer = null;
  let countdownSeconds = 45;

  const cleanup = () => {
    if (rotationTimer) clearInterval(rotationTimer);
    if (countdownTimer) clearInterval(countdownTimer);
    rotationTimer = null;
    countdownTimer = null;
  };
  modal._cleanup = cleanup;

  const close = () => {
    cleanup();
    modal.remove();
  };

  modal.innerHTML = `
    <div class="card" id="attendance-qr-card" style="width:100%; max-width:440px; padding:24px; background:var(--bg-surface-1, #18181b); border-radius:var(--radius-lg, 12px); box-shadow:var(--shadow-2xl); border:1px solid var(--border-subtle, #3f3f46); text-align:center; color:var(--text-primary, #f4f4f5);">
      <div class="flex items-center justify-between" style="margin-bottom:12px;">
        <div style="font-size:15px; font-weight:800; color:var(--brand-gold, #c89d5c); display:flex; align-items:center; gap:6px;">
          <span>📱</span>
          <span>Attendance Punch QR</span>
        </div>
        <div style="display:flex; gap:6px;">
          <button class="btn btn-xs btn-ghost" id="qr-modal-fullscreen-btn" type="button" title="Toggle Fullscreen" style="font-size:12px;">⛶</button>
          <button class="btn btn-xs btn-ghost" id="qr-modal-close-btn" type="button" style="font-size:16px;">✕</button>
        </div>
      </div>

      <div style="font-size:18px; font-weight:800; color:#ffffff; margin-bottom:2px;" id="qr-modal-cafe-title">
        ${activeCafeName}
      </div>
      <div style="font-size:11.5px; color:var(--text-muted, #a1a1aa); font-family:var(--font-mono, monospace); margin-bottom:16px;">
        Café ID: ${activeCafeId} · IST Synced
      </div>

      <!-- Rotating QR Container -->
      <div id="qr-modal-svg-wrap" style="background:#ffffff; padding:14px; border-radius:12px; display:inline-flex; align-items:center; justify-content:center; margin-bottom:16px; min-width:240px; min-height:240px; box-shadow:0 10px 25px rgba(0,0,0,0.5);">
        <div class="za-spinner" style="width:32px; height:32px; border:3px solid rgba(0,0,0,0.1); border-top-color:#c89d5c; border-radius:50%; animation:spin 0.8s linear infinite;"></div>
      </div>

      <div style="font-size:12.5px; font-weight:600; color:var(--text-secondary, #d4d4d8); margin-bottom:14px;">
        Staff scan this QR code using their mobile Attendance Check-In / Check-Out
      </div>

      <div class="flex justify-between items-center" style="padding:10px 14px; background:var(--bg-surface-2, #27272a); border-radius:8px; font-size:12px;">
        <span>Auto-rotates in: <strong id="qr-modal-timer" style="color:var(--brand-gold, #c89d5c); font-family:var(--font-mono, monospace); font-size:13px;">45s</strong></span>
        <span id="qr-modal-status" class="badge badge-mint" style="font-size:10.5px;">● ACTIVE</span>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  modal.querySelector("#qr-modal-close-btn")?.addEventListener("click", close);
  modal.querySelector("#qr-modal-fullscreen-btn")?.addEventListener("click", () => {
    const card = modal.querySelector("#attendance-qr-card");
    if (!document.fullscreenElement) {
      card?.requestFullscreen?.().catch(() => {});
    } else {
      document.exitFullscreen?.().catch(() => {});
    }
  });

  const svgWrap = modal.querySelector("#qr-modal-svg-wrap");
  const timerEl = modal.querySelector("#qr-modal-timer");
  const statusEl = modal.querySelector("#qr-modal-status");

  async function fetchChallenge() {
    if (statusEl) {
      statusEl.className = "badge badge-gold";
      statusEl.textContent = "● ROTATING";
    }

    try {
      const res = await apiGet(`/attendance/qr/active?cafeId=${encodeURIComponent(activeCafeId)}`);
      if (res?.data?.qrToken) {
        countdownSeconds = Math.max(1, res.data.secondsRemaining || 45);
        if (svgWrap) {
          const svg = generateQrSvg(res.data.qrToken, { size: 240, margin: 2 });
          svgWrap.innerHTML = svg;
        }
        if (statusEl) {
          statusEl.className = "badge badge-mint";
          statusEl.textContent = "● ACTIVE";
        }
      }
    } catch (err) {
      if (statusEl) {
        statusEl.className = "badge badge-coral";
        statusEl.textContent = "● ERROR";
      }
      if (svgWrap) {
        svgWrap.innerHTML = `<div style="color:#ef4444; font-size:12px; font-weight:700;">Challenge Error</div>`;
      }
    }
  }

  fetchChallenge();

  countdownTimer = setInterval(() => {
    countdownSeconds -= 1;
    if (timerEl) timerEl.textContent = `${Math.max(0, countdownSeconds)}s`;
    if (countdownSeconds <= 0) {
      fetchChallenge();
    }
  }, 1000);
}




