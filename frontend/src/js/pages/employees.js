// =============================================================================
// ZAMORIN CAFE ERP — SCR-008: EMPLOYEE DIRECTORY & STAFFING
// World-Class HRIS + Workforce Administration + Employee 360 + Positioning
// =============================================================================

import { exportGrid } from "../utils/exportFile.js";
import { apiGet, apiPost } from "../apiClient.js";
import { showToast, openModal, renderModuleErrorState } from "../components.js";
import { state } from "../state.js";
import { ROLES } from "../navigation.js";
import { navigate } from "../router.js";
import { exportCentreModal } from "../components/exportCentreModal.js";

let activeSubpanel = "overview";
let liveOverview = null;
let liveEmployees = [];
let livePositions = [];
let liveStaffingRequests = [];
let liveSkills = [];
let liveDocuments = [];
let liveIntegrity = null;
let liveCafes = [];
let isLoadingData = false;

function escapeHtml(str) {
  if (!str) return "";
  return String(str).replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[m]);
}

let searchQuery = "";
let selectedCafe = "ALL";
let selectedDept = "ALL";
let selectedStatus = "ALL";
let selectedWorkerType = "ALL";

export function setEmployeesActiveTab(tab) {
  activeSubpanel = tab || "overview";
}

export function renderEmployees(subroute) {
  if (subroute !== undefined) {
    activeSubpanel = subroute || "overview";
  }

  // If on child subroute, render dedicated child shell directly
  if (activeSubpanel && activeSubpanel !== "overview") {
    return `
      <div class="page-enter" style="padding: 24px; max-width: 1600px; margin: 0 auto; color: var(--ink); padding-bottom:60px;">
        <div id="workforce-content-area">
          ${renderActiveSubpanel()}
        </div>
      </div>
    `;
  }

  return `
    <div class="page-enter" style="padding: 24px; max-width: 1600px; margin: 0 auto; color: var(--ink); padding-bottom:60px;">
      <!-- PAGE HEADER -->
      <div class="page-header" style="display:flex; justify-content:space-between; align-items:flex-start; flex-wrap:wrap; gap:16px; margin-bottom:24px;">
        <div>
          <div style="display:flex; align-items:center; gap:10px;">
            <h1 style="font-size:26px; font-weight:700; margin:0; color:var(--ink);">Employee Directory &amp; Staffing</h1>
            <span class="badge" style="background:rgba(180,83,9,0.12); color:#b45309; font-weight:600; font-size:12px; padding:4px 10px; border-radius:12px;">SCR-008 HRIS</span>
          </div>
          <p style="font-size:14px; color:var(--muted); margin:4px 0 0;">Authoritative workforce administration, position structure, onboarding, skills matrix, and lifecycle mobility.</p>
        </div>
        <div style="display:flex; gap:10px; align-items:center; flex-wrap:wrap;">
          <a class="btn btn-primary" href="#staff-home" style="display:flex; align-items:center; gap:6px; text-decoration:none; font-weight:700;">
            <span>👤</span>
            <span>Open Staff Portal →</span>
          </a>
          <button class="btn btn-secondary" id="refresh-workforce-btn" type="button" style="display:flex; align-items:center; gap:6px;">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 4v6h-6M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
            Refresh Directory
          </button>
        </div>
      </div>

      <!-- MAIN DYNAMIC CONTENT CONTAINER -->
      <div id="workforce-content-area">
        ${renderActiveSubpanel()}
      </div>
    </div>
  `;
}

function renderActiveSubpanel() {
  if (activeSubpanel === "overview") {
    return renderOverviewSubpanel();
  }

  const submodules = {
    directory: {
      title: "Employee Directory & Profiles",
      icon: "👥",
      desc: "Authoritative staff directory, 360 employee profiles and contact records.",
      actionsHtml: `<button class="btn btn-sm btn-primary" id="btn-child-onboard-emp" type="button">+ Onboard Employee</button>`
    },
    positions: {
      title: "Positions & Org Structure",
      icon: "🏛️",
      desc: "Sanctioned organizational positions, reporting lines and café headcounts.",
      actionsHtml: `<button class="btn btn-sm btn-primary" id="btn-child-add-position" type="button">+ Create Position</button>`
    },
    staffing: {
      title: "Workforce Planning & Staffing",
      icon: "📊",
      desc: "Headcount requests, capacity planning and recruitment approvals.",
      actionsHtml: `<button class="btn btn-sm btn-primary" id="btn-child-new-staffing-req" type="button">+ Staffing Requisition</button>`
    },
    onboarding: {
      title: "Onboarding & Probation Reviews",
      icon: "🚀",
      desc: "New hire checklists, document verification and 90-day probation reviews.",
      actionsHtml: `<button class="btn btn-sm btn-secondary" id="btn-child-review-probation" type="button">Review Probation</button>`
    },
    skills: {
      title: "Skills Matrix & Training Logs",
      icon: "🎓",
      desc: "Barista certifications, food safety training and station competencies.",
      actionsHtml: `<button class="btn btn-sm btn-secondary" id="btn-child-verify-skill" type="button">+ Verify Competency</button>`
    },
    documents: {
      title: "Documents, Contracts & Letters",
      icon: "📄",
      desc: "Employment contracts, offer letters, statutory proofs and certificates.",
      actionsHtml: `<button class="btn btn-sm btn-secondary" id="btn-child-gen-letter" type="button">+ Generate Letter</button>`
    },
    integrity: {
      title: "Integrity & Offboarding",
      icon: "🔒",
      desc: "Resignation clearance, asset recovery, access revocation and exit interviews.",
      actionsHtml: `<button class="btn btn-sm btn-danger" id="btn-child-init-offboard" type="button">+ Initiate Clearance</button>`
    },
  };

  const cur = submodules[activeSubpanel] || { title: "Submodule", icon: "📁", desc: "", actionsHtml: "" };

  let bodyHtml = "";
  switch (activeSubpanel) {
    case "directory":
      bodyHtml = renderDirectorySubpanel();
      break;
    case "positions":
      bodyHtml = renderPositionsSubpanel();
      break;
    case "staffing":
      bodyHtml = renderStaffingSubpanel();
      break;
    case "onboarding":
      bodyHtml = renderOnboardingSubpanel();
      break;
    case "skills":
      bodyHtml = renderSkillsSubpanel();
      break;
    case "documents":
      bodyHtml = renderDocumentsSubpanel();
      break;
    case "integrity":
      bodyHtml = renderIntegritySubpanel();
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
              <button id="employees-back-to-hub-btn" data-back-to-hub="true" data-workforce-back-to-hub="true" class="btn-link" style="color:var(--accent); text-decoration:none; display:inline-flex; align-items:center; gap:4px; font-weight:600; cursor:pointer; background:none; border:none; padding:0;">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
                Workforce
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

// ─── 1. OVERVIEW & WORKFORCE COMMAND ──────────────────────────────────────────
function renderOverviewSubpanel() {
  const kpis = liveOverview?.kpis || {
    activeEmployees: 34,
    approvedCapacity: 38,
    capacityGap: 4,
    employeesOnProbation: 4,
    openPositions: 3,
    frozenPositions: 1,
    newJoiners30Days: 2,
    exits30Days: 1,
    cafesStaffed: 3,
  };
  const strip = liveOverview?.controlStrip || {
    probationReviewsDue: 2,
    certificationsExpiring: 3,
    onboardingIncomplete: 1,
    transfersPending: 1,
    criticalVacancies: 1,
    documentsMissing: 2,
  };
  const cafes = liveOverview?.cafeWorkforce || [];

  const workforceTiles = [
    { id: "directory", icon: "👥", title: "Employee Directory", subtitle: "Active staff directory, 360 profiles & contacts", badge: `${kpis.activeEmployees} Staff`, badgeType: "accent" },
    { id: "positions", icon: "🏛️", title: "Positions & Org Structure", subtitle: "Sanctioned organizational positions & hierarchy", badge: `${kpis.approvedCapacity || 38} Seats`, badgeType: "" },
    { id: "staffing", icon: "📊", title: "Workforce Planning", subtitle: "Headcount requests, capacity gaps & approvals", badge: `${kpis.capacityGap || 4} Gap`, badgeType: "accent" },
    { id: "onboarding", icon: "🚀", title: "Onboarding & Probation", subtitle: "New hire journeys & 90-day probation reviews", badge: `${kpis.employeesOnProbation} Reviews`, badgeType: "accent" },
    { id: "skills", icon: "🎓", title: "Skills Matrix & Training", subtitle: "Barista certifications & competency levels", badge: "Live Matrix", badgeType: "success" },
    { id: "documents", icon: "📄", title: "Documents & Letters", subtitle: "Statutory letters, employment contracts & IDs", badge: "Governed", badgeType: "success" },
    { id: "integrity", icon: "🔒", title: "Integrity & Offboarding", subtitle: "Resignation clearance, asset recovery & exit", badge: "Audit Clean", badgeType: "" },
  ];

  return `
    <div style="display:flex; flex-direction:column; gap:24px;">
      <!-- Control Centre Button Hub Section -->
      <div class="module-hub-section">
        <h3 class="module-hub-section-title">Workforce &amp; HRIS Workspaces</h3>
        <div class="module-tile-grid">
          ${workforceTiles.map((t) => `
            <button class="module-hub-tile" data-workforce-hub-tile="${t.id}" type="button">
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

      <!-- TOP KPIS -->
      <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap:14px;">
        <div class="kpi-card" style="background:var(--surface); border:1px solid var(--line); border-radius:var(--radius-card, 12px); padding:16px 18px; box-shadow:var(--shadow-xs);">
          <div style="font-size:11.5px; color:var(--muted); text-transform:uppercase; font-weight:700; letter-spacing:0.4px;">Active Employees</div>
          <div style="font-size:26px; font-weight:800; color:var(--ink); font-family:var(--font-heading); margin-top:4px;">${kpis.activeEmployees}</div>
          <div style="font-size:11.5px; color:#059669; font-weight:600; margin-top:2px;">● Authoritative Workforce</div>
        </div>

        <div class="kpi-card" style="background:var(--surface); border:1px solid var(--line); border-radius:var(--radius-card, 12px); padding:16px 18px; box-shadow:var(--shadow-xs);">
          <div style="font-size:11.5px; color:var(--muted); text-transform:uppercase; font-weight:700; letter-spacing:0.4px;">Approved Capacity</div>
          <div style="font-size:26px; font-weight:800; color:var(--ink); font-family:var(--font-heading); margin-top:4px;">${kpis.approvedCapacity || 38}</div>
          <div style="font-size:11.5px; color:var(--muted); margin-top:2px;">Sanctioned Headcount</div>
        </div>

        <div class="kpi-card" style="background:var(--surface); border:1px solid var(--line); border-radius:var(--radius-card, 12px); padding:16px 18px; box-shadow:var(--shadow-xs);">
          <div style="font-size:11.5px; color:var(--muted); text-transform:uppercase; font-weight:700; letter-spacing:0.4px;">Capacity Gap</div>
          <div style="font-size:26px; font-weight:800; color:#d97706; font-family:var(--font-heading); margin-top:4px;">${kpis.capacityGap !== undefined ? kpis.capacityGap : 4}</div>
          <div style="font-size:11.5px; color:var(--muted); margin-top:2px;">Seats to Approved Total</div>
        </div>

        <div class="kpi-card" style="background:var(--surface); border:1px solid var(--line); border-radius:var(--radius-card, 12px); padding:16px 18px; box-shadow:var(--shadow-xs);" title="3 Sanctioned & Actively Recruiting Positions (1 Capacity Gap Paused/Frozen)">
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <div style="font-size:11.5px; color:var(--muted); text-transform:uppercase; font-weight:700; letter-spacing:0.4px;">Open Positions</div>
            <span class="badge-tag" style="background:rgba(37,99,235,0.1); color:#2563eb; font-size:10px; font-weight:700; padding:1px 6px; border-radius:4px;">Recruiting</span>
          </div>
          <div style="font-size:26px; font-weight:800; color:#2563eb; font-family:var(--font-heading); margin-top:4px;">${kpis.openPositions}</div>
          <div style="font-size:11.5px; color:var(--muted); margin-top:2px;">Actively Sanctioned &amp; Open</div>
        </div>

        <div class="kpi-card" style="background:var(--surface); border:1px solid var(--line); border-radius:var(--radius-card, 12px); padding:16px 18px; box-shadow:var(--shadow-xs);">
          <div style="font-size:11.5px; color:var(--muted); text-transform:uppercase; font-weight:700; letter-spacing:0.4px;">On Probation</div>
          <div style="font-size:26px; font-weight:800; color:#b45309; font-family:var(--font-heading); margin-top:4px;">${kpis.employeesOnProbation}</div>
          <div style="font-size:11.5px; color:var(--muted); margin-top:2px;">Reviews in progress</div>
        </div>

        <div class="kpi-card" style="background:var(--surface); border:1px solid var(--line); border-radius:var(--radius-card, 12px); padding:16px 18px; box-shadow:var(--shadow-xs);">
          <div style="font-size:11.5px; color:var(--muted); text-transform:uppercase; font-weight:700; letter-spacing:0.4px;">New Joiners (30D)</div>
          <div style="font-size:26px; font-weight:800; color:#059669; font-family:var(--font-heading); margin-top:4px;">${kpis.newJoiners30Days}</div>
          <div style="font-size:11.5px; color:var(--muted); margin-top:2px;">Onboarded staff</div>
        </div>

        <div class="kpi-card" style="background:var(--surface); border:1px solid var(--line); border-radius:var(--radius-card, 12px); padding:16px 18px; box-shadow:var(--shadow-xs);">
          <div style="font-size:11.5px; color:var(--muted); text-transform:uppercase; font-weight:700; letter-spacing:0.4px;">Exits (30D)</div>
          <div style="font-size:26px; font-weight:800; color:var(--muted); font-family:var(--font-heading); margin-top:4px;">${kpis.exits30Days}</div>
          <div style="font-size:11.5px; color:var(--muted); margin-top:2px;">Offboarded staff</div>
        </div>

        <div class="kpi-card" style="background:var(--surface); border:1px solid var(--line); border-radius:var(--radius-card, 12px); padding:16px 18px; box-shadow:var(--shadow-xs);">
          <div style="font-size:11.5px; color:var(--muted); text-transform:uppercase; font-weight:700; letter-spacing:0.4px;">Cafés Staffed</div>
          <div style="font-size:26px; font-weight:800; color:var(--ink); font-family:var(--font-heading); margin-top:4px;">${kpis.cafesStaffed} / 3</div>
          <div style="font-size:11.5px; color:#059669; font-weight:600; margin-top:2px;">● 100% Location Coverage</div>
        </div>
      </div>

      <!-- SECONDARY CONTROL STRIP -->
      <div class="card" style="background:var(--surface); border:1px solid var(--line); border-radius:var(--radius-card, 12px); box-shadow:var(--shadow-xs); padding:16px 20px; display:flex; flex-wrap:wrap; gap:16px; align-items:center; justify-content:space-between;">
        <div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap;">
          <span style="font-weight:700; font-size:12.5px; color:var(--muted); text-transform:uppercase; letter-spacing:0.04em;">Actionable Items:</span>
          <span class="badge-tag badge-warning" style="font-weight:700;">${strip.probationReviewsDue} Probation Due</span>
          <span class="badge-tag badge-warning" style="font-weight:700;">${strip.certificationsExpiring} Certs Expiring</span>
          <span class="badge-tag badge-accent" style="font-weight:700;">${strip.onboardingIncomplete} Preboarding</span>
          <span class="badge-tag badge-neutral" style="font-weight:600;">${strip.transfersPending} Transfers Scheduled</span>
          <span class="badge-tag badge-danger" style="font-weight:700;">${strip.criticalVacancies} Critical Vacancies</span>
          <span class="badge-tag badge-neutral" style="font-weight:600;">${strip.documentsMissing} Docs Pending</span>
        </div>
        <button class="btn btn-ghost btn-sm" id="view-integrity-fast-btn" style="font-size:12px; font-weight:600;">View Integrity Audit →</button>
      </div>

      <!-- CAFÉ WORKFORCE CAPACITIES -->
      <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap:20px;">
        ${cafes.map(c => `
          <div style="background:#fff; border:1px solid rgba(0,0,0,0.06); border-radius:12px; padding:20px;">
            <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:14px;">
              <div>
                <h3 style="font-size:16px; font-weight:700; margin:0; color:var(--ink);">${c.name}</h3>
                <span style="font-size:12px; color:var(--muted);">${c.cafeId}</span>
              </div>
              <span class="badge-tag" style="background:${(c.openPositions || c.vacancies) > 0 ? 'rgba(59,130,246,0.1)' : 'rgba(16,185,129,0.1)'}; color:${(c.openPositions || c.vacancies) > 0 ? '#2563eb' : '#10b981'};">
                ${(c.openPositions || c.vacancies) > 0 ? (c.openPositions || c.vacancies) + ' Open Pos' : 'Fully Staffed'}
              </span>
            </div>
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px; font-size:13px; margin-bottom:14px;">
              <div style="background:#f8fafc; padding:10px; border-radius:8px;">
                <div style="color:var(--muted); font-size:11px;">Active Headcount</div>
                <div style="font-weight:700; font-size:16px; color:var(--ink);">${c.totalHeadcount}</div>
              </div>
              <div style="background:#f8fafc; padding:10px; border-radius:8px;">
                <div style="color:var(--muted); font-size:11px;">Approved Capacity</div>
                <div style="font-weight:700; font-size:16px; color:var(--ink);">${c.approvedPositions}</div>
              </div>
              <div style="background:#f8fafc; padding:10px; border-radius:8px;">
                <div style="color:var(--muted); font-size:11px;">Capacity Gap</div>
                <div style="font-weight:700; font-size:16px; color:#f59e0b;">${c.capacityGap !== undefined ? c.capacityGap : Math.max(0, c.approvedPositions - c.totalHeadcount)}</div>
              </div>
              <div style="background:#f8fafc; padding:10px; border-radius:8px;">
                <div style="color:var(--muted); font-size:11px;">Open Positions</div>
                <div style="font-weight:700; font-size:16px; color:#3b82f6;">${c.openPositions !== undefined ? c.openPositions : c.vacancies}</div>
              </div>
              <div style="background:#f8fafc; padding:10px; border-radius:8px;">
                <div style="color:var(--muted); font-size:11px;">On Probation</div>
                <div style="font-weight:700; font-size:16px; color:#b45309;">${c.probation}</div>
              </div>
              <div style="background:#f8fafc; padding:10px; border-radius:8px;">
                <div style="color:var(--muted); font-size:11px;">Cross-Trained</div>
                <div style="font-weight:700; font-size:16px; color:#10b981;">${c.crossTrained}</div>
              </div>
            </div>
            <button class="btn btn-ghost filter-cafe-btn" data-cafe-id="${c.cafeId}" style="width:100%; font-size:12px; justify-content:center;">View Roster &amp; Positions →</button>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

// ─── 2. EMPLOYEE DIRECTORY & SEARCH ──────────────────────────────────────────
function renderDirectorySubpanel() {
  let filtered = [...liveEmployees];

  if (searchQuery) {
    const q = searchQuery.toLowerCase().trim();
    filtered = filtered.filter(e =>
      (e.name && e.name.toLowerCase().includes(q)) ||
      (e.userId && e.userId.toLowerCase().includes(q)) ||
      (e.designation && e.designation.toLowerCase().includes(q)) ||
      (e.department && e.department.toLowerCase().includes(q)) ||
      (e.email && e.email.toLowerCase().includes(q))
    );
  }
  if (selectedCafe !== "ALL") {
    filtered = filtered.filter(e => e.primaryCafeId === selectedCafe || (Array.isArray(e.assignedCafeIds) && e.assignedCafeIds.includes(selectedCafe)));
  }
  if (selectedDept !== "ALL") {
    filtered = filtered.filter(e => e.department === selectedDept);
  }
  if (selectedStatus !== "ALL") {
    filtered = filtered.filter(e => e.employmentStatus === selectedStatus);
  }
  if (selectedWorkerType !== "ALL") {
    filtered = filtered.filter(e => e.workerType === selectedWorkerType);
  }

  return `
    <div style="background:#fff; border:1px solid rgba(0,0,0,0.06); border-radius:12px; padding:20px;">
      <!-- FILTER & SEARCH BAR -->
      <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:16px; margin-bottom:20px;">
        <div style="display:flex; gap:10px; flex:1; min-width:280px;">
          <input type="text" id="employee-search-input" placeholder="Search by Name, Employee ID, Designation, Department..." value="${searchQuery}" style="flex:1; padding:8px 14px; border:1px solid rgba(0,0,0,0.12); border-radius:8px; font-size:13px;" />
        </div>
        <div style="display:flex; gap:10px; flex-wrap:wrap;">
          <select id="cafe-filter-select" style="padding:8px 12px; border:1px solid rgba(0,0,0,0.12); border-radius:8px; font-size:13px;">
            <option value="ALL" ${selectedCafe === 'ALL' ? 'selected' : ''}>All Cafés</option>
            ${liveCafes.map(c => `<option value="${escapeHtml(c.cafeId)}" ${selectedCafe === c.cafeId ? 'selected' : ''}>${escapeHtml(c.name || c.cafeId)}</option>`).join('')}
          </select>
          <select id="dept-filter-select" style="padding:8px 12px; border:1px solid rgba(0,0,0,0.12); border-radius:8px; font-size:13px;">
            <option value="ALL" ${selectedDept === 'ALL' ? 'selected' : ''}>All Departments</option>
            <option value="Barista" ${selectedDept === 'Barista' ? 'selected' : ''}>Barista</option>
            <option value="Kitchen" ${selectedDept === 'Kitchen' ? 'selected' : ''}>Kitchen</option>
            <option value="Service" ${selectedDept === 'Service' ? 'selected' : ''}>Service</option>
            <option value="Management" ${selectedDept === 'Management' ? 'selected' : ''}>Management</option>
          </select>
          <select id="status-filter-select" style="padding:8px 12px; border:1px solid rgba(0,0,0,0.12); border-radius:8px; font-size:13px;">
            <option value="ALL" ${selectedStatus === 'ALL' ? 'selected' : ''}>All Statuses</option>
            <option value="ACTIVE" ${selectedStatus === 'ACTIVE' ? 'selected' : ''}>Active</option>
            <option value="PROBATION" ${selectedStatus === 'PROBATION' ? 'selected' : ''}>Probation</option>
            <option value="PREBOARDING" ${selectedStatus === 'PREBOARDING' ? 'selected' : ''}>Preboarding</option>
            <option value="NOTICE_PERIOD" ${selectedStatus === 'NOTICE_PERIOD' ? 'selected' : ''}>Notice Period</option>
            <option value="EXITED" ${selectedStatus === 'EXITED' ? 'selected' : ''}>Exited</option>
          </select>
          <button class="btn btn-secondary" id="export-directory-btn" style="font-size:12.5px; display:flex; align-items:center; gap:6px;" title="Export Directory">
            <span>📥</span>
            <span>Export Register</span>
          </button>
        </div>
      </div>

      <!-- DIRECTORY TABLE -->
      <div style="overflow-x:auto;">
        <table style="width:100%; border-collapse:collapse; font-size:13px; text-align:left;">
          <thead>
            <tr style="border-bottom:2px solid rgba(0,0,0,0.06); color:var(--muted); font-size:11px; text-transform:uppercase;">
              <th style="padding:10px 14px; width:45px;">Sl. No.</th>
              <th style="padding:10px 14px;">Employee</th>
              <th style="padding:10px 14px;">Job Title / Position</th>
              <th style="padding:10px 14px;">Department</th>
              <th style="padding:10px 14px;">Primary Café</th>
              <th style="padding:10px 14px;">Type</th>
              <th style="padding:10px 14px;">System Role</th>
              <th style="padding:10px 14px;">Joined</th>
              <th style="padding:10px 14px;">Status</th>
              <th style="padding:10px 14px; text-align:right;">Actions</th>
            </tr>
          </thead>
          <tbody>
            ${filtered.map((emp, idx) => `
              <tr style="border-bottom:1px solid rgba(0,0,0,0.04); transition:background 0.15s ease;" onmouseover="this.style.background='#fafaf9'" onmouseout="this.style.background='transparent'">
                <td style="padding:12px 14px; color:var(--muted); font-size:11px; font-weight:600;">${idx + 1}</td>
                <td style="padding:12px 14px;">
                  <div style="font-weight:600; color:var(--ink);">${emp.name}</div>
                  <div style="font-size:11px; color:var(--muted);">${emp.userId} · ${emp.email}</div>
                </td>
                <td style="padding:12px 14px; font-weight:500;">${emp.designation || 'Staff'}</td>
                <td style="padding:12px 14px; color:var(--muted);">${emp.department || 'Operations'}</td>
                <td style="padding:12px 14px;"><span class="badge-tag badge-neutral" style="font-size:11.5px; font-weight:600;">${emp.primaryCafeId || '—'}</span></td>
                <td style="padding:12px 14px; font-size:12px;">${emp.workerType || 'PERMANENT'}</td>
                <td style="padding:12px 14px;">
                  <span class="badge-tag ${emp.role === 'MASTER' ? 'badge-accent' : emp.role === 'OWNER' ? 'badge-accent' : 'badge-neutral'}" style="font-size:11px; font-weight:700;">
                    ${emp.role}
                  </span>
                </td>
                <td style="padding:12px 14px; font-size:12px; color:var(--muted);">${emp.joiningDate ? String(emp.joiningDate).split('T')[0] : '—'}</td>
                <td style="padding:12px 14px;">
                  <span class="badge-tag ${emp.employmentStatus === 'ACTIVE' ? 'badge-success' : emp.employmentStatus === 'PROBATION' ? 'badge-warning' : 'badge-neutral'}" style="font-size:11.5px; font-weight:700;">
                    ${emp.employmentStatus || 'ACTIVE'}
                  </span>
                </td>
                <td style="padding:12px 14px; text-align:right; white-space:nowrap;">
                  <button class="btn btn-ghost open-employee-360-btn" data-user-id="${emp.userId}" style="font-size:12px; padding:4px 8px;">View 360</button>
                  <button class="btn btn-ghost view-emp-attendance-btn" data-user-id="${emp.userId}" style="font-size:12px; padding:4px 8px; color:var(--brand-gold, #c89d5c);">Attendance</button>
                  <button class="btn btn-ghost open-transfer-modal-btn" data-user-id="${emp.userId}" style="font-size:12px; padding:4px 8px;">Transfer</button>
                  <button class="btn btn-ghost open-offboard-modal-btn" data-user-id="${emp.userId}" style="font-size:12px; padding:4px 8px; color:#dc2626;">Offboard</button>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
      <div style="display:flex; justify-content:space-between; align-items:center; margin-top:16px; font-size:12px; color:var(--muted);">
        <div>Showing ${filtered.length} of ${liveEmployees.length || filtered.length} records</div>
        <div>Authoritative Real-Time Data</div>
      </div>
    </div>
  `;
}

// ─── 3. POSITIONS & ORGANISATION STRUCTURE ─────────────────────────────────────
function renderPositionsSubpanel() {
  const positions = [...livePositions];

  return `
    <div style="display:flex; flex-direction:column; gap:20px;">
      <div style="display:flex; justify-content:space-between; align-items:center;">
        <div>
          <h2 style="font-size:18px; font-weight:700; margin:0;">Sanctioned Positions &amp; Capacity</h2>
          <p style="font-size:13px; color:var(--muted); margin:2px 0 0;">Authoritative position registry and capacity allocations across café locations.</p>
        </div>
        <button class="btn btn-primary" id="add-position-btn" style="font-size:13px;">+ Create Sanctioned Position</button>
      </div>

      <div style="background:#fff; border:1px solid rgba(0,0,0,0.06); border-radius:12px; overflow-x:auto;">
        <table style="width:100%; border-collapse:collapse; font-size:13px; text-align:left;">
          <thead>
            <tr style="border-bottom:2px solid rgba(0,0,0,0.06); color:var(--muted); font-size:11px; text-transform:uppercase;">
              <th style="padding:10px 14px;">Position ID</th>
              <th style="padding:10px 14px;">Title</th>
              <th style="padding:10px 14px;">Department</th>
              <th style="padding:10px 14px;">Location</th>
              <th style="padding:10px 14px;">Approved Capacity</th>
              <th style="padding:10px 14px;">Status</th>
              <th style="padding:10px 14px;">Critical</th>
            </tr>
          </thead>
          <tbody>
            ${positions.map(p => `
              <tr style="border-bottom:1px solid rgba(0,0,0,0.04);">
                <td style="padding:12px 14px; font-weight:600; color:var(--gold,#b45309);">${p.positionId}</td>
                <td style="padding:12px 14px; font-weight:600; color:var(--ink);">${p.positionTitle}</td>
                <td style="padding:12px 14px; color:var(--muted);">${p.department}</td>
                <td style="padding:12px 14px;"><span class="badge-tag" style="background:#f1f5f9; color:#334155;">${p.cafeId}</span></td>
                <td style="padding:12px 14px; font-weight:600;">${p.approvedCapacity} Seat(s)</td>
                <td style="padding:12px 14px;">
                  <span class="badge-tag" style="background:${p.status === 'FILLED' ? 'rgba(16,185,129,0.1)' : p.status === 'OPEN' ? 'rgba(59,130,246,0.1)' : 'rgba(245,158,11,0.1)'}; color:${p.status === 'FILLED' ? '#10b981' : p.status === 'OPEN' ? '#3b82f6' : '#d97706'};">
                    ${p.status}
                  </span>
                </td>
                <td style="padding:12px 14px;">
                  ${p.isCritical ? '<span class="badge-tag" style="background:#fef2f2; color:#dc2626;">CRITICAL ROLE</span>' : '<span style="color:var(--muted);">Standard</span>'}
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

// ─── 4. WORKFORCE PLANNING & STAFFING REQUESTS ────────────────────────────────
function renderStaffingSubpanel() {
  const requests = liveStaffingRequests;

  return `
    <div style="display:flex; flex-direction:column; gap:20px;">
      <div style="display:flex; justify-content:space-between; align-items:center;">
        <div>
          <h2 style="font-size:18px; font-weight:700; margin:0;">Staffing Requests &amp; Headcount Gaps</h2>
          <p style="font-size:13px; color:var(--muted); margin:2px 0 0;">Formal requisitions for replacement, seasonal peak, and café expansion.</p>
        </div>
        <button class="btn btn-primary" id="new-requisition-btn" style="font-size:13px;">+ New Requisition</button>
      </div>

      <div style="background:#fff; border:1px solid rgba(0,0,0,0.06); border-radius:12px; overflow-x:auto;">
        <table style="width:100%; border-collapse:collapse; font-size:13px; text-align:left;">
          <thead>
            <tr style="border-bottom:2px solid rgba(0,0,0,0.06); color:var(--muted); font-size:11px; text-transform:uppercase;">
              <th style="padding:10px 14px;">Requisition ID</th>
              <th style="padding:10px 14px;">Location</th>
              <th style="padding:10px 14px;">Department / Title</th>
              <th style="padding:10px 14px;">Headcount / FTE</th>
              <th style="padding:10px 14px;">Desired Date</th>
              <th style="padding:10px 14px;">Reason</th>
              <th style="padding:10px 14px;">Status</th>
            </tr>
          </thead>
          <tbody>
            ${requests && requests.length > 0 ? requests.map(r => `
              <tr style="border-bottom:1px solid rgba(0,0,0,0.04);">
                <td style="padding:12px 14px; font-weight:600; color:var(--gold,#b45309);">${r.requestId}</td>
                <td style="padding:12px 14px;"><span class="badge-tag" style="background:#f1f5f9; color:#334155;">${r.cafeId}</span></td>
                <td style="padding:12px 14px;">
                  <div style="font-weight:600; color:var(--ink);">${r.positionTitle}</div>
                  <div style="font-size:11px; color:var(--muted);">${r.department}</div>
                </td>
                <td style="padding:12px 14px; font-weight:600;">${r.headcountRequired} (${r.fteRequired} FTE)</td>
                <td style="padding:12px 14px; color:var(--muted);">${r.desiredDate}</td>
                <td style="padding:12px 14px;"><span class="badge-tag badge-neutral" style="font-weight:600;">${r.reason}</span></td>
                <td style="padding:12px 14px;">
                  <span class="badge-tag ${r.status === 'APPROVED' ? 'badge-success' : 'badge-accent'}" style="font-weight:700;">
                    ${r.status}
                  </span>
                </td>
              </tr>
            `).join('') : '<tr><td colspan="7" style="padding: 24px; text-align: center; color: var(--muted); font-size: 13px;">No open staffing requisitions found.</td></tr>'}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

// ─── 5. ONBOARDING & PROBATION ────────────────────────────────────────────────
function renderOnboardingSubpanel() {
  return `
    <div style="display:flex; flex-direction:column; gap:24px;">
      <div class="card" style="background:var(--surface); border:1px solid var(--line); border-radius:var(--radius-card, 12px); box-shadow:var(--shadow-xs); padding:22px;">
        <h3 style="font-size:16px; font-weight:700; margin:0 0 4px; color:var(--ink);">Active Preboarding &amp; Onboarding Checklists</h3>
        <p style="font-size:12.5px; color:var(--muted); margin:0 0 16px;">Readiness verification before and during the first 90 days of employment.</p>

        <div style="padding:24px; text-align:center; color:var(--muted); font-size:13px; background:var(--surface-sunken); border-radius:8px;">
          No staff members currently in preboarding or probation evaluation window.
        </div>
      </div>
    </div>
  `;
}

// ─── 6. SKILLS & TRAINING ─────────────────────────────────────────────────────
function renderSkillsSubpanel() {
  return `
    <div class="card" style="background:var(--surface); border:1px solid var(--line); border-radius:var(--radius-card, 12px); box-shadow:var(--shadow-xs); padding:22px;">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px; flex-wrap:wrap; gap:12px;">
        <div>
          <h3 style="font-size:16px; font-weight:700; margin:0; color:var(--ink);">Skills Matrix &amp; Verified Competencies (${liveSkills.length})</h3>
          <p style="font-size:12.5px; color:var(--muted); margin:2px 0 0;">Espresso extraction, manual brewing, food safety compliance, and supervision.</p>
        </div>
        <div style="display:flex; gap:10px;">
          <button class="btn btn-secondary btn-sm" id="assign-training-btn">+ Assign Training</button>
          <button class="btn btn-primary btn-sm" id="verify-skill-btn">+ Verify Staff Skill</button>
        </div>
      </div>

      <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(280px, 1fr)); gap:16px;">
        ${liveSkills.map(sk => `
          <div class="card" style="background:var(--surface-sunken, rgba(0,0,0,0.02)); border:1px solid var(--line); border-radius:var(--radius-sm, 8px); padding:16px;">
            <div style="font-weight:700; color:var(--ink); font-size:13.5px;">${sk.employeeName} (${sk.userId})</div>
            <div style="font-size:11.5px; color:var(--muted); margin-top:2px;">${sk.designation || 'Staff'} — ${sk.cafeName || '—'}</div>
            <div style="margin-top:12px; display:flex; flex-wrap:wrap; gap:6px;">
              ${(sk.skills || []).map(s => `
                <span class="badge-tag ${s.proficiency === 'Expert' || s.proficiency === 'Certified' ? 'badge-success' : s.status === 'IN_PROGRESS' ? 'badge-warning' : 'badge-accent'}" style="font-weight:600;">
                  ${s.name}: ${s.proficiency}
                </span>
              `).join('')}
            </div>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

// ─── 7. DOCUMENTS & LETTERS ───────────────────────────────────────────────────
function renderDocumentsSubpanel() {
  return `
    <div style="display:flex; flex-direction:column; gap:20px;">
      <div style="background:#fff; border:1px solid rgba(0,0,0,0.06); border-radius:12px; padding:20px;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px;">
          <div>
            <h3 style="font-size:16px; font-weight:700; margin:0; color:var(--ink);">Authoritative Document Generator</h3>
            <p style="font-size:13px; color:var(--muted); margin:2px 0 0;">Generate appointment letters, confirmation letters, and experience certificates.</p>
          </div>
          <button class="btn btn-primary" id="open-letter-gen-btn" style="font-size:13px;">+ Generate HR Letter</button>
        </div>

        <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(260px, 1fr)); gap:16px; margin-bottom:24px;">
          <div style="border:1px solid rgba(0,0,0,0.08); border-radius:8px; padding:16px;">
            <div style="font-weight:600; color:var(--ink);">Appointment Letter</div>
            <p style="font-size:12px; color:var(--muted); margin:4px 0 12px;">Standard full-time employment agreement with compensation terms.</p>
            <span class="badge-tag" style="background:#f1f5f9; color:#475569;">Template v2.4</span>
          </div>
          <div style="border:1px solid rgba(0,0,0,0.08); border-radius:8px; padding:16px;">
            <div style="font-weight:600; color:var(--ink);">Probation Confirmation</div>
            <p style="font-size:12px; color:var(--muted); margin:4px 0 12px;">Formal notice confirming completion of the 90-day probationary period.</p>
            <span class="badge-tag" style="background:#f1f5f9; color:#475569;">Template v1.8</span>
          </div>
          <div style="border:1px solid rgba(0,0,0,0.08); border-radius:8px; padding:16px;">
            <div style="font-weight:600; color:var(--ink);">Transfer &amp; Rotation Order</div>
            <p style="font-size:12px; color:var(--muted); margin:4px 0 12px;">Authoritative relocation or temporary café rotation documentation.</p>
            <span class="badge-tag" style="background:#f1f5f9; color:#475569;">Template v2.1</span>
          </div>
        </div>

        <!-- Generated Documents Log -->
        <h4 style="font-size:14px; font-weight:700; margin:0 0 12px; color:var(--ink);">Issued HR Letters &amp; Records (${liveDocuments.length})</h4>
        <div style="overflow-x:auto;">
          <table style="width:100%; border-collapse:collapse; font-size:13px; text-align:left;">
            <thead>
              <tr style="border-bottom:2px solid rgba(0,0,0,0.06); color:var(--muted); font-size:11px; text-transform:uppercase;">
                <th style="padding:10px 14px;">Doc ID</th>
                <th style="padding:10px 14px;">Document Title</th>
                <th style="padding:10px 14px;">Recipient Employee</th>
                <th style="padding:10px 14px;">Category</th>
                <th style="padding:10px 14px;">Date Issued</th>
                <th style="padding:10px 14px;">Status</th>
              </tr>
            </thead>
            <tbody>
              ${liveDocuments.map(doc => `
                <tr style="border-bottom:1px solid rgba(0,0,0,0.04);">
                  <td style="padding:12px 14px; font-family:var(--font-mono); font-weight:700; color:var(--gold,#b45309);">${doc.docId}</td>
                  <td style="padding:12px 14px; font-weight:600; color:var(--ink);">${doc.title}</td>
                  <td style="padding:12px 14px;">${doc.employeeName || doc.employeeId} <span style="font-size:11px; color:var(--muted);">(${doc.employeeId})</span></td>
                  <td style="padding:12px 14px;"><span class="badge-tag badge-neutral" style="font-size:11px;">${doc.category}</span></td>
                  <td style="padding:12px 14px; color:var(--muted);">${doc.date}</td>
                  <td style="padding:12px 14px;"><span class="badge-tag badge-success" style="font-weight:700;">${doc.status || 'ISSUED'}</span></td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;
}

// ─── 8. INTEGRITY & OFFBOARDING ───────────────────────────────────────────────
function renderIntegritySubpanel() {
  const issues = liveIntegrity?.issues || [];
  const status = liveIntegrity?.integrityStatus || "HEALTHY";

  return `
    <div style="display:flex; flex-direction:column; gap:20px;">
      <div style="background:#fff; border:1px solid rgba(0,0,0,0.06); border-radius:12px; padding:20px;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:14px;">
          <div>
            <h3 style="font-size:16px; font-weight:700; margin:0; color:var(--ink);">Deterministic Workforce Integrity Audit</h3>
            <p style="font-size:13px; color:var(--muted); margin:2px 0 0;">15-point automated verification across organisation hierarchies, active logins, and credentials.</p>
          </div>
          <span class="badge-tag" style="background:${status === 'HEALTHY' ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.1)'}; color:${status === 'HEALTHY' ? '#10b981' : '#ef4444'}; font-size:13px; padding:6px 12px;">
            ${status === 'HEALTHY' ? '✓ SYSTEM HEALTHY' : '⚠ ATTENTION REQUIRED'}
          </span>
        </div>

        ${issues.length === 0 ? `
          <div style="padding:24px; text-align:center; color:#10b981; background:#f0fdf4; border-radius:8px; font-weight:500; font-size:13px;">
            ✓ All employees occupy sanctioned positions with assigned reporting managers and valid credentials.
          </div>
        ` : `
          <div style="display:flex; flex-direction:column; gap:10px;">
            ${issues.map(iss => `
              <div style="padding:12px 16px; background:#fff1f2; border:1px solid #ffe4e6; border-radius:8px; display:flex; justify-content:space-between; align-items:center;">
                <div>
                  <div style="font-weight:600; color:#9f1239; font-size:13px;">${iss.title}</div>
                  <div style="font-size:11px; color:#be123c;">Category: ${iss.category} · Entity: ${iss.entity}</div>
                </div>
                <span class="badge-tag" style="background:#fecdd3; color:#881337;">${iss.severity}</span>
              </div>
            `).join('')}
          </div>
        `}
      </div>
    </div>
  `;
}

// ─── ASYNC DATA FETCHER ───────────────────────────────────────────────────────
async function fetchWorkforceData() {
  if (isLoadingData) return;
  isLoadingData = true;
  try {
    // Workforce integrity is a Master/Owner governance control; Café Admin is
    // not authorised for it, so do not fire a request that can only 403.
    const role = String(state.role || state.user?.role || "").toLowerCase();
    const canReadIntegrity =
      role === ROLES.MASTER || role === ROLES.OWNER;
    const [ov, emp, pos, stf, itg, cf] = await Promise.allSettled([
      apiGet("/employees/overview"),
      apiGet("/employees"),
      apiGet("/employees/positions"),
      apiGet("/employees/staffing-requests"),
      canReadIntegrity ? apiGet("/employees/integrity") : Promise.resolve(null),
      apiGet("/cafes"),
    ]);
    liveOverview = ov.status === "fulfilled" ? ov.value?.data : null;
    liveEmployees = emp.status === "fulfilled" ? (emp.value?.data?.employees || []) : [];
    livePositions = pos.status === "fulfilled" ? (pos.value?.data?.positions || []) : [];
    liveStaffingRequests = stf.status === "fulfilled" ? (stf.value?.data?.staffingRequests || []) : [];
    liveIntegrity = itg.status === "fulfilled" ? itg.value?.data : null;
    liveCafes = cf.status === "fulfilled" ? (cf.value?.data?.cafes || []) : [];
  } catch (err) {
    // Fallback gracefully
  } finally {
    isLoadingData = false;
  }
}

// ─── WIRE DOM EVENTS & MODALS ─────────────────────────────────────────────────
export async function wireEmployees(container = document, subroute) {
  if (subroute !== undefined) {
    activeSubpanel = subroute || "overview";
  }

  // Subpanel switching via Hub Tiles
  document.querySelectorAll("[data-workforce-hub-tile]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const tileId = btn.getAttribute("data-workforce-hub-tile");
      navigate("employees/" + tileId);
    });
  });

  // Back to Hub button
  const backToHub = () => navigate("employees");
  document.getElementById("employees-back-to-hub-btn")?.addEventListener("click", backToHub);
  document.getElementById("workforce-back-to-hub-btn")?.addEventListener("click", backToHub);

  attachDirectoryRowListeners();

  // If not yet loaded, fetch once in background and rerender
  if (!liveOverview) {
    fetchWorkforceData().then(() => {
      const host = document.getElementById("workforce-content-area");
      if (host && state.route?.startsWith("employees")) {
        host.innerHTML = renderActiveSubpanel();
        document.querySelectorAll("[data-workforce-hub-tile]").forEach((btn) => {
          btn.addEventListener("click", () => {
            const tileId = btn.getAttribute("data-workforce-hub-tile");
            navigate("employees/" + tileId);
          });
        });
        document.getElementById("employees-back-to-hub-btn")?.addEventListener("click", backToHub);
        document.getElementById("workforce-back-to-hub-btn")?.addEventListener("click", backToHub);
        attachDirectoryRowListeners();
      }
    });
  }

  // Subpanel switching legacy tabs
  document.querySelectorAll(".subtab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      activeSubpanel = btn.getAttribute("data-subpanel");
      const host = document.getElementById("page-content");
      if (host) {
        host.innerHTML = renderEmployees();
        wireEmployees();
      }
    });
  });

  // Refresh directory
  document.getElementById("refresh-workforce-btn")?.addEventListener("click", async () => {
    try {
      await fetchWorkforceData();
      showToast("Workforce directory refreshed successfully.", "success");
      const host = document.getElementById("page-content");
      if (host) {
        host.innerHTML = renderEmployees();
        wireEmployees();
      }
    } catch (err) {
      showToast("Failed to refresh workforce data.", "error");
    }
  });

  // Search input filter
  document.getElementById("employee-search-input")?.addEventListener("input", (e) => {
    searchQuery = e.target.value;
    const host = document.getElementById("workforce-content-area");
    if (host && activeSubpanel === "directory") {
      host.innerHTML = renderDirectorySubpanel();
      attachDirectoryRowListeners();
    }
  });

  // Filter selects
  document.getElementById("cafe-filter-select")?.addEventListener("change", (e) => {
    selectedCafe = e.target.value;
    const host = document.getElementById("workforce-content-area");
    if (host && activeSubpanel === "directory") {
      host.innerHTML = renderDirectorySubpanel();
      attachDirectoryRowListeners();
    }
  });

  document.getElementById("dept-filter-select")?.addEventListener("change", (e) => {
    selectedDept = e.target.value;
    const host = document.getElementById("workforce-content-area");
    if (host && activeSubpanel === "directory") {
      host.innerHTML = renderDirectorySubpanel();
      attachDirectoryRowListeners();
    }
  });

  document.getElementById("status-filter-select")?.addEventListener("change", (e) => {
    selectedStatus = e.target.value;
    const host = document.getElementById("workforce-content-area");
    if (host && activeSubpanel === "directory") {
      host.innerHTML = renderDirectorySubpanel();
      attachDirectoryRowListeners();
    }
  });

  // Export CSV
  document.getElementById("export-directory-btn")?.addEventListener("click", () => {
    exportDirectoryCSV();
  });

  // Fast Cafe drill-down
  document.querySelectorAll(".filter-cafe-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      selectedCafe = btn.getAttribute("data-cafe-id") || "ALL";
      activeSubpanel = "directory";
      const host = document.getElementById("page-content");
      if (host) {
        host.innerHTML = renderEmployees();
        wireEmployees();
      }
    });
  });

  // Fast Integrity view -> navigate to integrity child route
  document.querySelectorAll("#view-integrity-fast-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      navigate("employees/integrity");
    });
  });

  // Child action buttons & Subpanel header buttons
  document.querySelectorAll("#btn-child-onboard-emp, #open-onboard-wizard-btn, #onboard-emp-btn").forEach((btn) => {
    btn.addEventListener("click", () => openOnboardingWizard());
  });

  document.querySelectorAll("#btn-child-add-position, #add-position-btn").forEach((btn) => {
    btn.addEventListener("click", () => openCreatePositionModal());
  });

  document.querySelectorAll("#btn-child-new-staffing-req, #new-requisition-btn, #open-staffing-request-btn").forEach((btn) => {
    btn.addEventListener("click", () => openStaffingRequestModal());
  });

  document.querySelectorAll("#btn-child-verify-skill, #verify-skill-btn").forEach((btn) => {
    btn.addEventListener("click", () => openVerifySkillModal());
  });

  document.querySelectorAll("#assign-training-btn").forEach((btn) => {
    btn.addEventListener("click", () => openAssignTrainingModal());
  });

  document.querySelectorAll("#btn-child-gen-letter, #open-letter-gen-btn").forEach((btn) => {
    btn.addEventListener("click", () => openLetterGeneratorModal());
  });

  document.querySelectorAll("#btn-child-review-probation").forEach((btn) => {
    btn.addEventListener("click", () => {
      const targetEmp = liveEmployees.find(e => e.employmentStatus === 'PROBATION') || liveEmployees[0];
      if (targetEmp) openProbationModal(targetEmp.userId);
      else showToast("No employees currently on probation.", "info");
    });
  });

  document.querySelectorAll("#btn-child-init-offboard").forEach((btn) => {
    btn.addEventListener("click", () => openOffboardModal());
  });

  attachDirectoryRowListeners();
}

function attachDirectoryRowListeners() {
  // Open Employee 360
  document.querySelectorAll(".open-employee-360-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const userId = btn.getAttribute("data-user-id");
      openEmployee360Drawer(userId);
    });
  });

  // View Employee Attendance
  document.querySelectorAll(".view-emp-attendance-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      navigate("attendance/calendar360");
    });
  });

  // Open Transfer Modal
  document.querySelectorAll(".open-transfer-modal-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const userId = btn.getAttribute("data-user-id");
      openTransferModal(userId);
    });
  });

  // Open Offboard Modal
  document.querySelectorAll(".open-offboard-modal-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const userId = btn.getAttribute("data-user-id");
      openOffboardModal(userId);
    });
  });

  // Open Probation Modal
  document.querySelectorAll(".open-probation-modal-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const userId = btn.getAttribute("data-user-id");
      openProbationModal(userId);
    });
  });
}

function exportDirectoryCSV() {
  const employees = liveEmployees.length > 0 ? liveEmployees : [];
  if (employees.length === 0) {
    showToast("No employee records to export.", "info");
    return;
  }
  const headers = ["Employee ID", "Full Name", "Email", "Role", "Designation", "Department", "Primary Cafe", "Worker Type", "Status", "Joined"];
  const rows = employees.map(e => [
    e.userId,
    `"${e.name || ''}"`,
    e.email || '',
    e.role || '',
    `"${e.designation || ''}"`,
    `"${e.department || ''}"`,
    e.primaryCafeId || '',
    e.workerType || '',
    e.employmentStatus || '',
    e.joiningDate ? String(e.joiningDate).split('T')[0] : '',
  ]);
  exportGrid({ headers, rows, title: "Zamorin_Employee_Directory", filename: `Zamorin_Employee_Directory_${new Date().toISOString().split('T')[0]}` });
  showToast("Employee directory exported (XLSX).", "success");
}

// ─── MODAL WIZARDS ────────────────────────────────────────────────────────────
function openOnboardingWizard() {
  openModal(`
    <div style="padding:24px; max-width:640px; width:100%; color:var(--ink);">
      <h2 style="font-size:20px; font-weight:700; margin:0 0 6px;">Onboard New Employee</h2>
      <p style="font-size:13px; color:var(--muted); margin:0 0 20px;">Register worker identity, position allocation, primary café, and initial compliance requirements.</p>

      <form id="onboard-employee-form" style="display:flex; flex-direction:column; gap:14px;">
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px;">
          <div>
            <label style="font-size:12px; font-weight:600; display:block; margin-bottom:4px;">Legal Full Name *</label>
            <input type="text" id="ob-name" required placeholder="e.g. Employee Full Name" style="width:100%; padding:8px 12px; border:1px solid rgba(0,0,0,0.15); border-radius:6px; font-size:13px;" />
          </div>
          <div>
            <label style="font-size:12px; font-weight:600; display:block; margin-bottom:4px;">Preferred / Calling Name</label>
            <input type="text" id="ob-preferred" placeholder="e.g. First Name" style="width:100%; padding:8px 12px; border:1px solid rgba(0,0,0,0.15); border-radius:6px; font-size:13px;" />
          </div>
        </div>

        <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px;">
          <div>
            <label style="font-size:12px; font-weight:600; display:block; margin-bottom:4px;">Work Email Address *</label>
            <input type="email" id="ob-email" required placeholder="rahul@zamorin.cafe" style="width:100%; padding:8px 12px; border:1px solid rgba(0,0,0,0.15); border-radius:6px; font-size:13px;" />
          </div>
          <div>
            <label style="font-size:12px; font-weight:600; display:block; margin-bottom:4px;">Mobile Phone</label>
            <input type="text" id="ob-phone" placeholder="+91 98450 12345" style="width:100%; padding:8px 12px; border:1px solid rgba(0,0,0,0.15); border-radius:6px; font-size:13px;" />
          </div>
        </div>

        <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px;">
          <div>
            <label style="font-size:12px; font-weight:600; display:block; margin-bottom:4px;">Primary Café Location *</label>
            <select id="ob-cafe" style="width:100%; padding:8px 12px; border:1px solid rgba(0,0,0,0.15); border-radius:6px; font-size:13px;">
              ${liveCafes.length > 0 ? liveCafes.map(c => `<option value="${escapeHtml(c.cafeId)}">${escapeHtml(c.name || c.cafeId)}</option>`).join('') : '<option value="">No active cafés</option>'}
            </select>
          </div>
          <div>
            <label style="font-size:12px; font-weight:600; display:block; margin-bottom:4px;">Department *</label>
            <select id="ob-dept" style="width:100%; padding:8px 12px; border:1px solid rgba(0,0,0,0.15); border-radius:6px; font-size:13px;">
              <option value="Barista">Barista Operations</option>
              <option value="Kitchen">Kitchen &amp; Culinary</option>
              <option value="Service">Front of House / Service</option>
              <option value="Management">Management &amp; Supervision</option>
            </select>
          </div>
        </div>

        <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px;">
          <div>
            <label style="font-size:12px; font-weight:600; display:block; margin-bottom:4px;">Job Title / Designation *</label>
            <input type="text" id="ob-title" required placeholder="e.g. Junior Barista" style="width:100%; padding:8px 12px; border:1px solid rgba(0,0,0,0.15); border-radius:6px; font-size:13px;" />
          </div>
          <div>
            <label style="font-size:12px; font-weight:600; display:block; margin-bottom:4px;">Worker Type</label>
            <select id="ob-worker-type" style="width:100%; padding:8px 12px; border:1px solid rgba(0,0,0,0.15); border-radius:6px; font-size:13px;">
              <option value="PERMANENT">Permanent (Full-Time)</option>
              <option value="FIXED_TERM">Fixed-Term Contract</option>
              <option value="TRAINEE">Trainee / Apprentice</option>
              <option value="CONTINGENT">Contingent Worker</option>
            </select>
          </div>
        </div>

        <div style="display:flex; justify-content:flex-end; gap:10px; margin-top:16px;">
          <button class="btn btn-ghost" type="button" onclick="document.getElementById('modal-root').innerHTML=''">Cancel</button>
          <button class="btn btn-primary" type="submit" style="background:var(--gold,#b45309); border-color:var(--gold,#b45309); color:#fff; font-weight:600;">Complete Onboarding</button>
        </div>
      </form>
    </div>
  `);

  document.getElementById("onboard-employee-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const payload = {
      name: document.getElementById("ob-name").value,
      preferredName: document.getElementById("ob-preferred").value,
      email: document.getElementById("ob-email").value,
      phone: document.getElementById("ob-phone").value,
      primaryCafeId: document.getElementById("ob-cafe").value,
      department: document.getElementById("ob-dept").value,
      designation: document.getElementById("ob-title").value,
      workerType: document.getElementById("ob-worker-type").value,
      role: "STAFF",
    };

        let createdEmp = null;
    try {
      const created = await apiPost("/employees", payload);
      createdEmp = created?.data?.employee || created?.data || null;
    } catch (err) {
      showToast(err?.message || "The server did not accept this request. Nothing was saved.", "error");
      return;
    }

const newEmpId = createdEmp?.userId || createdEmp?.employeeId || "";
    const newEmp = {
      userId: newEmpId,
      name: payload.name,
      preferredName: payload.preferredName || payload.name,
      email: payload.email,
      role: "STAFF",
      designation: payload.designation,
      department: payload.department,
      primaryCafeId: payload.primaryCafeId,
      employmentType: "Full Time",
      workerType: payload.workerType,
      employmentStatus: "ACTIVE",
      joiningDate: new Date().toISOString().split("T")[0],
    };
    liveEmployees.unshift(newEmp);


    showToast(`Employee ${payload.name} onboarded.`, "success");
    document.getElementById("modal-root").innerHTML = "";
    rerenderCurrentSubpanel();
  });
}

function openStaffingRequestModal() {
  openModal(`
    <div style="padding:24px; max-width:540px; width:100%; color:var(--ink);">
      <h2 style="font-size:20px; font-weight:700; margin:0 0 6px;">Submit Staffing Requisition</h2>
      <p style="font-size:13px; color:var(--muted); margin:0 0 20px;">Request sanctioned headcount addition or replacement for your café.</p>

      <form id="staffing-req-form" style="display:flex; flex-direction:column; gap:14px;">
        <div>
          <label style="font-size:12px; font-weight:600; display:block; margin-bottom:4px;">Target Café *</label>
          <select id="sr-cafe" style="width:100%; padding:8px 12px; border:1px solid rgba(0,0,0,0.15); border-radius:6px; font-size:13px;">
            ${liveCafes.length > 0 ? liveCafes.map(c => `<option value="${escapeHtml(c.cafeId)}">${escapeHtml(c.name || c.cafeId)}</option>`).join('') : '<option value="">No active cafés</option>'}
          </select>
        </div>
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px;">
          <div>
            <label style="font-size:12px; font-weight:600; display:block; margin-bottom:4px;">Department *</label>
            <select id="sr-dept" style="width:100%; padding:8px 12px; border:1px solid rgba(0,0,0,0.15); border-radius:6px; font-size:13px;">
              <option value="Barista">Barista</option>
              <option value="Kitchen">Kitchen</option>
              <option value="Service">Service</option>
              <option value="Management">Management</option>
            </select>
          </div>
          <div>
            <label style="font-size:12px; font-weight:600; display:block; margin-bottom:4px;">Position Title *</label>
            <input type="text" id="sr-title" required placeholder="e.g. Junior Barista" style="width:100%; padding:8px 12px; border:1px solid rgba(0,0,0,0.15); border-radius:6px; font-size:13px;" />
          </div>
        </div>
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px;">
          <div>
            <label style="font-size:12px; font-weight:600; display:block; margin-bottom:4px;">Headcount Required *</label>
            <input type="number" id="sr-count" min="1" max="10" value="1" required style="width:100%; padding:8px 12px; border:1px solid rgba(0,0,0,0.15); border-radius:6px; font-size:13px;" />
          </div>
          <div>
            <label style="font-size:12px; font-weight:600; display:block; margin-bottom:4px;">Desired Date *</label>
            <input type="date" id="sr-date" required value="${new Date(Date.now() + 15*24*60*60*1000).toISOString().split('T')[0]}" style="width:100%; padding:8px 12px; border:1px solid rgba(0,0,0,0.15); border-radius:6px; font-size:13px;" />
          </div>
        </div>
        <div>
          <label style="font-size:12px; font-weight:600; display:block; margin-bottom:4px;">Reason Category</label>
          <select id="sr-reason" style="width:100%; padding:8px 12px; border:1px solid rgba(0,0,0,0.15); border-radius:6px; font-size:13px;">
            <option value="REPLACEMENT">Replacement / Backfill</option>
            <option value="EXPANSION">Volume Expansion</option>
            <option value="SEASONAL">Seasonal Peak Requirement</option>
          </select>
        </div>

        <div style="display:flex; justify-content:flex-end; gap:10px; margin-top:16px;">
          <button class="btn btn-ghost" type="button" onclick="document.getElementById('modal-root').innerHTML=''">Cancel</button>
          <button class="btn btn-primary" type="submit">Submit Requisition</button>
        </div>
      </form>
    </div>
  `);

  document.getElementById("staffing-req-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const payload = {
      cafeId: document.getElementById("sr-cafe").value,
      department: document.getElementById("sr-dept").value,
      positionTitle: document.getElementById("sr-title").value,
      headcountRequired: Number(document.getElementById("sr-count").value),
      desiredDate: document.getElementById("sr-date").value,
      reason: document.getElementById("sr-reason").value,
    };

        try {
      await apiPost("/employees/staffing-requests", payload);
    } catch (err) {
      showToast(err?.message || "The server did not accept this request. Nothing was saved.", "error");
      return;
    }

const newReqId = `SR-2026-${String(liveStaffingRequests.length + 1).padStart(3, "0")}`;
    const newReq = {
      requestId: newReqId,
      cafeId: payload.cafeId,
      department: payload.department,
      positionTitle: payload.positionTitle,
      headcountRequired: payload.headcountRequired,
      fteRequired: payload.headcountRequired * 1.0,
      desiredDate: payload.desiredDate,
      reason: payload.reason,
      status: "SUBMITTED"
    };
    liveStaffingRequests.unshift(newReq);


    showToast(`Staffing requisition ${newReqId} submitted for ${payload.positionTitle}!`, "success");
    document.getElementById("modal-root").innerHTML = "";
    rerenderCurrentSubpanel();
  });
}

function openCreatePositionModal() {
  openModal(`
    <div style="padding:24px; max-width:520px; width:100%; color:var(--ink);">
      <h2 style="font-size:20px; font-weight:700; margin:0 0 6px;">Create Sanctioned Position</h2>
      <p style="font-size:13px; color:var(--muted); margin:0 0 20px;">Define position title, department, location, and approved capacity.</p>

      <form id="create-pos-form" style="display:flex; flex-direction:column; gap:14px;">
        <div>
          <label style="font-size:12px; font-weight:600; display:block; margin-bottom:4px;">Position Title *</label>
          <input type="text" id="cp-title" required placeholder="e.g. Senior Shift Supervisor" style="width:100%; padding:8px 12px; border:1px solid rgba(0,0,0,0.15); border-radius:6px; font-size:13px;" />
        </div>
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px;">
          <div>
            <label style="font-size:12px; font-weight:600; display:block; margin-bottom:4px;">Department *</label>
            <select id="cp-dept" style="width:100%; padding:8px 12px; border:1px solid rgba(0,0,0,0.15); border-radius:6px; font-size:13px;">
              <option value="Barista">Barista</option>
              <option value="Kitchen">Kitchen</option>
              <option value="Service">Service</option>
              <option value="Management">Management</option>
            </select>
          </div>
          <div>
            <label style="font-size:12px; font-weight:600; display:block; margin-bottom:4px;">Location *</label>
            <select id="cp-cafe" style="width:100%; padding:8px 12px; border:1px solid rgba(0,0,0,0.15); border-radius:6px; font-size:13px;">
              ${liveCafes.length > 0 ? liveCafes.map(c => `<option value="${escapeHtml(c.cafeId)}">${escapeHtml(c.name || c.cafeId)}</option>`).join('') : '<option value="">No active cafés</option>'}
            </select>
          </div>
        </div>
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px;">
          <div>
            <label style="font-size:12px; font-weight:600; display:block; margin-bottom:4px;">Approved Capacity *</label>
            <input type="number" id="cp-capacity" min="1" max="20" value="1" required style="width:100%; padding:8px 12px; border:1px solid rgba(0,0,0,0.15); border-radius:6px; font-size:13px;" />
          </div>
          <div>
            <label style="font-size:12px; font-weight:600; display:block; margin-bottom:4px;">Critical Role</label>
            <select id="cp-critical" style="width:100%; padding:8px 12px; border:1px solid rgba(0,0,0,0.15); border-radius:6px; font-size:13px;">
              <option value="false">Standard Role</option>
              <option value="true">Critical Leadership</option>
            </select>
          </div>
        </div>

        <div style="display:flex; justify-content:flex-end; gap:10px; margin-top:16px;">
          <button class="btn btn-ghost" type="button" onclick="document.getElementById('modal-root').innerHTML=''">Cancel</button>
          <button class="btn btn-primary" type="submit">Create Position</button>
        </div>
      </form>
    </div>
  `);

  document.getElementById("create-pos-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const payload = {
      positionTitle: document.getElementById("cp-title").value,
      department: document.getElementById("cp-dept").value,
      cafeId: document.getElementById("cp-cafe").value,
      approvedCapacity: Number(document.getElementById("cp-capacity").value),
      isCritical: document.getElementById("cp-critical").value === "true",
    };

        try {
      await apiPost("/employees/positions", payload);
    } catch (err) {
      showToast(err?.message || "The server did not accept this request. Nothing was saved.", "error");
      return;
    }

const newPosId = `POS-2026-${String(livePositions.length + 1).padStart(3, "0")}`;
    const newPos = {
      positionId: newPosId,
      positionTitle: payload.positionTitle,
      department: payload.department,
      cafeId: payload.cafeId,
      approvedCapacity: payload.approvedCapacity,
      status: "OPEN",
      isCritical: payload.isCritical
    };
    livePositions.unshift(newPos);


    showToast(`Position ${payload.positionTitle} created successfully.`, "success");
    document.getElementById("modal-root").innerHTML = "";
    rerenderCurrentSubpanel();
  });
}

function openTransferModal(userId) {
  openModal(`
    <div style="padding:24px; max-width:520px; width:100%; color:var(--ink);">
      <h2 style="font-size:20px; font-weight:700; margin:0 0 6px;">Initiate Staff Relocation / Transfer</h2>
      <p style="font-size:13px; color:var(--muted); margin:0 0 20px;">Move employee ${userId} to another café location with effective-dated history.</p>

      <form id="transfer-staff-form" style="display:flex; flex-direction:column; gap:14px;">
        <div>
          <label style="font-size:12px; font-weight:600; display:block; margin-bottom:4px;">Movement Type *</label>
          <select id="tr-type" style="width:100%; padding:8px 12px; border:1px solid rgba(0,0,0,0.15); border-radius:6px; font-size:13px;">
            <option value="TRANSFER">Permanent Café Relocation</option>
            <option value="TEMPORARY_ROTATION">Temporary Rotation</option>
            <option value="PROMOTION">Promotion &amp; Reassignment</option>
          </select>
        </div>
        <div>
          <label style="font-size:12px; font-weight:600; display:block; margin-bottom:4px;">Destination Café *</label>
          <select id="tr-cafe" style="width:100%; padding:8px 12px; border:1px solid rgba(0,0,0,0.15); border-radius:6px; font-size:13px;">
            ${liveCafes.length > 0 ? liveCafes.map(c => `<option value="${escapeHtml(c.cafeId)}">${escapeHtml(c.name || c.cafeId)}</option>`).join('') : '<option value="">No active cafés</option>'}
          </select>
        </div>
        <div>
          <label style="font-size:12px; font-weight:600; display:block; margin-bottom:4px;">Effective Date *</label>
          <input type="date" id="tr-date" required value="${new Date().toISOString().split('T')[0]}" style="width:100%; padding:8px 12px; border:1px solid rgba(0,0,0,0.15); border-radius:6px; font-size:13px;" />
        </div>
        <div>
          <label style="font-size:12px; font-weight:600; display:block; margin-bottom:4px;">Reason / Business Justification *</label>
          <textarea id="tr-reason" required rows="2" placeholder="e.g. Senior barista leadership transfer to support morning volume." style="width:100%; padding:8px 12px; border:1px solid rgba(0,0,0,0.15); border-radius:6px; font-size:13px;"></textarea>
        </div>

        <div style="display:flex; justify-content:flex-end; gap:10px; margin-top:16px;">
          <button class="btn btn-ghost" type="button" onclick="document.getElementById('modal-root').innerHTML=''">Cancel</button>
          <button class="btn btn-primary" type="submit">Schedule Movement</button>
        </div>
      </form>
    </div>
  `);

  document.getElementById("transfer-staff-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const payload = {
      movementType: document.getElementById("tr-type").value,
      toCafeId: document.getElementById("tr-cafe").value,
      effectiveDate: document.getElementById("tr-date").value,
      reason: document.getElementById("tr-reason").value,
    };

    try {
      const res = await apiPost(`/employees/${userId}/movements`, payload);
      showToast(res.message || "Movement scheduled successfully.", "success");
      document.getElementById("modal-root").innerHTML = "";
      document.getElementById("refresh-workforce-btn")?.click();
    } catch (err) {
      showToast(err.message || "Failed to schedule movement.", "error");
    }
  });
}

function openProbationModal(userId) {
  openModal(`
    <div style="padding:24px; max-width:540px; width:100%; color:var(--ink);">
      <h2 style="font-size:20px; font-weight:700; margin:0 0 6px;">Probation Review &amp; Confirmation</h2>
      <p style="font-size:13px; color:var(--muted); margin:0 0 20px;">Conduct 90-day evaluation for employee ${userId}.</p>

      <form id="probation-review-form" style="display:flex; flex-direction:column; gap:14px;">
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px;">
          <div>
            <label style="font-size:12px; font-weight:600; display:block; margin-bottom:4px;">Job Knowledge (1-5)</label>
            <input type="number" id="pr-knowledge" min="1" max="5" value="4" required style="width:100%; padding:8px 12px; border:1px solid rgba(0,0,0,0.15); border-radius:6px; font-size:13px;" />
          </div>
          <div>
            <label style="font-size:12px; font-weight:600; display:block; margin-bottom:4px;">Service Standards (1-5)</label>
            <input type="number" id="pr-service" min="1" max="5" value="5" required style="width:100%; padding:8px 12px; border:1px solid rgba(0,0,0,0.15); border-radius:6px; font-size:13px;" />
          </div>
        </div>
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px;">
          <div>
            <label style="font-size:12px; font-weight:600; display:block; margin-bottom:4px;">Reliability (1-5)</label>
            <input type="number" id="pr-reliability" min="1" max="5" value="4" required style="width:100%; padding:8px 12px; border:1px solid rgba(0,0,0,0.15); border-radius:6px; font-size:13px;" />
          </div>
          <div>
            <label style="font-size:12px; font-weight:600; display:block; margin-bottom:4px;">Review Decision *</label>
            <select id="pr-decision" style="width:100%; padding:8px 12px; border:1px solid rgba(0,0,0,0.15); border-radius:6px; font-size:13px;">
              <option value="CONFIRM">Confirm Regular Employment</option>
              <option value="EXTEND">Extend Probation (30-60 Days)</option>
              <option value="FURTHER_REVIEW">Schedule Further Review</option>
            </select>
          </div>
        </div>
        <div>
          <label style="font-size:12px; font-weight:600; display:block; margin-bottom:4px;">Manager Comments</label>
          <textarea id="pr-comments" rows="2" placeholder="Summary of strengths, barista competencies, and development areas." style="width:100%; padding:8px 12px; border:1px solid rgba(0,0,0,0.15); border-radius:6px; font-size:13px;"></textarea>
        </div>

        <div style="display:flex; justify-content:flex-end; gap:10px; margin-top:16px;">
          <button class="btn btn-ghost" type="button" onclick="document.getElementById('modal-root').innerHTML=''">Cancel</button>
          <button class="btn btn-primary" type="submit">Submit Review</button>
        </div>
      </form>
    </div>
  `);

  document.getElementById("probation-review-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const payload = {
      ratings: {
        jobKnowledge: Number(document.getElementById("pr-knowledge").value),
        serviceStandards: Number(document.getElementById("pr-service").value),
        reliability: Number(document.getElementById("pr-reliability").value),
      },
      decision: document.getElementById("pr-decision").value,
      managerComments: document.getElementById("pr-comments").value,
    };

    try {
      const res = await apiPost(`/employees/${userId}/probation`, payload);
      showToast(res.message || "Probation review submitted.", "success");
      document.getElementById("modal-root").innerHTML = "";
      document.getElementById("refresh-workforce-btn")?.click();
    } catch (err) {
      showToast(err.message || "Failed to submit probation review.", "error");
    }
  });
}

function openVerifySkillModal() {
  openModal(`
    <div style="padding:24px; max-width:500px; width:100%; color:var(--ink);">
      <h2 style="font-size:20px; font-weight:700; margin:0 0 6px;">Verify Staff Competency</h2>
      <p style="font-size:13px; color:var(--muted); margin:0 0 20px;">Record verified technical or operational skills against employee record.</p>

      <form id="verify-skill-form" style="display:flex; flex-direction:column; gap:14px;">
        <div>
          <label style="font-size:12px; font-weight:600; display:block; margin-bottom:4px;">Employee *</label>
          <select id="vs-user-id" style="width:100%; padding:8px 12px; border:1px solid rgba(0,0,0,0.15); border-radius:6px; font-size:13px;">
            ${liveEmployees.map(e => `
              <option value="${e.userId}">${e.name} (${e.userId}) — ${e.designation || 'Staff'}</option>
            `).join('')}
          </select>
        </div>
        <div>
          <label style="font-size:12px; font-weight:600; display:block; margin-bottom:4px;">Skill Name *</label>
          <input type="text" id="vs-name" required placeholder="e.g. Latte Art Mastery / Espresso Dial-in" style="width:100%; padding:8px 12px; border:1px solid rgba(0,0,0,0.15); border-radius:6px; font-size:13px;" />
        </div>
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px;">
          <div>
            <label style="font-size:12px; font-weight:600; display:block; margin-bottom:4px;">Category</label>
            <select id="vs-cat" style="width:100%; padding:8px 12px; border:1px solid rgba(0,0,0,0.15); border-radius:6px; font-size:13px;">
              <option value="BARISTA">Barista Skills</option>
              <option value="CULINARY">Culinary &amp; Food Prep</option>
              <option value="COMPLIANCE">Safety &amp; Compliance</option>
              <option value="SERVICE">Customer Experience</option>
            </select>
          </div>
          <div>
            <label style="font-size:12px; font-weight:600; display:block; margin-bottom:4px;">Proficiency</label>
            <select id="vs-prof" style="width:100%; padding:8px 12px; border:1px solid rgba(0,0,0,0.15); border-radius:6px; font-size:13px;">
              <option value="Competent">Competent</option>
              <option value="Expert">Expert</option>
              <option value="Certified">Certified Master</option>
            </select>
          </div>
        </div>

        <div style="display:flex; justify-content:flex-end; gap:10px; margin-top:16px;">
          <button class="btn btn-ghost" type="button" onclick="document.getElementById('modal-root').innerHTML=''">Cancel</button>
          <button class="btn btn-primary" type="submit">Verify Skill</button>
        </div>
      </form>
    </div>
  `);

  document.getElementById("verify-skill-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const userId = document.getElementById("vs-user-id").value.trim().toUpperCase();
    const payload = {
      skillName: document.getElementById("vs-name").value,
      category: document.getElementById("vs-cat").value,
      proficiency: document.getElementById("vs-prof").value,
    };

        try {
      await apiPost(`/employees/${userId}/skills`, payload);
    } catch (err) {
      showToast(err?.message || "The server did not accept this request. Nothing was saved.", "error");
      return;
    }

let existingEmp = liveSkills.find(s => s.userId === userId);
    if (!existingEmp) {
      existingEmp = {
        userId,
        employeeName: liveEmployees.find(e => e.userId === userId)?.name || userId,
        designation: liveEmployees.find(e => e.userId === userId)?.designation || "Staff Member",
        cafeName: liveEmployees.find(e => e.userId === userId)?.cafeName || "—",
        skills: []
      };
      liveSkills.unshift(existingEmp);
    }
    existingEmp.skills.unshift({
      name: payload.skillName,
      proficiency: payload.proficiency,
      status: "VERIFIED"
    });


    showToast(`Skill "${payload.skillName}" (${payload.proficiency}) verified for ${userId}!`, "success");
    document.getElementById("modal-root").innerHTML = "";
    rerenderCurrentSubpanel();
  });
}

function openAssignTrainingModal() {
  openModal(`
    <div style="padding:24px; max-width:500px; width:100%; color:var(--ink);">
      <h2 style="font-size:20px; font-weight:700; margin:0 0 6px;">Assign Compliance / Academy Training</h2>
      <p style="font-size:13px; color:var(--muted); margin:0 0 20px;">Assign mandatory food hygiene, pos handling, or espresso standard modules.</p>

      <form id="assign-training-form" style="display:flex; flex-direction:column; gap:14px;">
        <div>
          <label style="font-size:12px; font-weight:600; display:block; margin-bottom:4px;">Employee *</label>
          <select id="at-user-id" style="width:100%; padding:8px 12px; border:1px solid rgba(0,0,0,0.15); border-radius:6px; font-size:13px;">
            ${liveEmployees.map(e => `
              <option value="${e.userId}">${e.name} (${e.userId}) — ${e.designation || 'Staff'}</option>
            `).join('')}
          </select>
        </div>
        <div>
          <label style="font-size:12px; font-weight:600; display:block; margin-bottom:4px;">Training Module Title *</label>
          <input type="text" id="at-title" required value="FoSTaC Food Safety &amp; Hygiene Standards" style="width:100%; padding:8px 12px; border:1px solid rgba(0,0,0,0.15); border-radius:6px; font-size:13px;" />
        </div>
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px;">
          <div>
            <label style="font-size:12px; font-weight:600; display:block; margin-bottom:4px;">Training Provider</label>
            <input type="text" id="at-provider" value="Zamorin Academy" style="width:100%; padding:8px 12px; border:1px solid rgba(0,0,0,0.15); border-radius:6px; font-size:13px;" />
          </div>
          <div>
            <label style="font-size:12px; font-weight:600; display:block; margin-bottom:4px;">Due Date *</label>
            <input type="date" id="at-due" required value="${new Date(Date.now() + 14*24*60*60*1000).toISOString().split('T')[0]}" style="width:100%; padding:8px 12px; border:1px solid rgba(0,0,0,0.15); border-radius:6px; font-size:13px;" />
          </div>
        </div>

        <div style="display:flex; justify-content:flex-end; gap:10px; margin-top:16px;">
          <button class="btn btn-ghost" type="button" onclick="document.getElementById('modal-root').innerHTML=''">Cancel</button>
          <button class="btn btn-primary" type="submit">Assign Module</button>
        </div>
      </form>
    </div>
  `);

  document.getElementById("assign-training-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const userId = document.getElementById("at-user-id").value.trim().toUpperCase();
    const payload = {
      trainingTitle: document.getElementById("at-title").value,
      provider: document.getElementById("at-provider").value,
      dueDate: document.getElementById("at-due").value,
    };

        try {
      await apiPost(`/employees/${userId}/training`, payload);
    } catch (err) {
      showToast(err?.message || "The server did not accept this request. Nothing was saved.", "error");
      return;
    }

let existingEmp = liveSkills.find(s => s.userId === userId);
    if (!existingEmp) {
      existingEmp = {
        userId,
        employeeName: liveEmployees.find(e => e.userId === userId)?.name || userId,
        designation: liveEmployees.find(e => e.userId === userId)?.designation || "Staff Member",
        cafeName: liveEmployees.find(e => e.userId === userId)?.cafeName || "—",
        skills: []
      };
      liveSkills.unshift(existingEmp);
    }
    existingEmp.skills.unshift({
      name: `${payload.trainingTitle} (Due: ${payload.dueDate})`,
      proficiency: "Assigned",
      status: "IN_PROGRESS"
    });


    showToast(`Training "${payload.trainingTitle}" assigned to ${userId}!`, "success");
    document.getElementById("modal-root").innerHTML = "";
    rerenderCurrentSubpanel();
  });
}

function openOffboardModal(targetUserId) {
  const defaultEmpId = targetUserId || liveEmployees[0]?.userId || "ST-0004";
  openModal(`
    <div style="padding:24px; max-width:520px; width:100%; color:var(--ink);">
      <h2 style="font-size:20px; font-weight:700; margin:0 0 6px;">Initiate Staff Offboarding &amp; Clearance</h2>
      <p style="font-size:13px; color:var(--muted); margin:0 0 20px;">Record exit notice, handover tasks, asset returns, and access revocation.</p>

      <form id="offboard-staff-form" style="display:flex; flex-direction:column; gap:14px;">
        <div>
          <label style="font-size:12px; font-weight:600; display:block; margin-bottom:4px;">Employee *</label>
          <select id="ob-user-id" style="width:100%; padding:8px 12px; border:1px solid rgba(0,0,0,0.15); border-radius:6px; font-size:13px;">
            ${liveEmployees.map(e => `
              <option value="${e.userId}" ${e.userId === defaultEmpId ? 'selected' : ''}>${e.name} (${e.userId}) — ${e.designation || 'Staff'}</option>
            `).join('')}
          </select>
        </div>
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px;">
          <div>
            <label style="font-size:12px; font-weight:600; display:block; margin-bottom:4px;">Exit Type</label>
            <select id="ob-exit-type" style="width:100%; padding:8px 12px; border:1px solid rgba(0,0,0,0.15); border-radius:6px; font-size:13px;">
              <option value="RESIGNATION">Voluntary Resignation</option>
              <option value="END_OF_CONTRACT">Contract Completion</option>
              <option value="TERMINATION">Administrative Termination</option>
            </select>
          </div>
          <div>
            <label style="font-size:12px; font-weight:600; display:block; margin-bottom:4px;">Last Working Day *</label>
            <input type="date" id="ob-lwd" required value="${new Date(Date.now() + 30*24*60*60*1000).toISOString().split('T')[0]}" style="width:100%; padding:8px 12px; border:1px solid rgba(0,0,0,0.15); border-radius:6px; font-size:13px;" />
          </div>
        </div>
        <div>
          <label style="font-size:12px; font-weight:600; display:block; margin-bottom:4px;">Reason Category</label>
          <select id="ob-reason" style="width:100%; padding:8px 12px; border:1px solid rgba(0,0,0,0.15); border-radius:6px; font-size:13px;">
            <option value="CAREER_PROGRESSION">Career Progression</option>
            <option value="RELOCATION">Personal Relocation</option>
            <option value="HIGHER_EDUCATION">Higher Education</option>
            <option value="OTHER">Other</option>
          </select>
        </div>
        <div style="display:flex; flex-direction:column; gap:8px; font-size:13px; margin-top:4px;">
          <label style="display:flex; align-items:center; gap:8px;">
            <input type="checkbox" id="ob-handover" checked /> Store &amp; Operational Handover Complete
          </label>
          <label style="display:flex; align-items:center; gap:8px;">
            <input type="checkbox" id="ob-assets" checked /> Issued Assets &amp; Uniforms Returned
          </label>
          <label style="display:flex; align-items:center; gap:8px;">
            <input type="checkbox" id="ob-access" checked /> System Access Scheduled for Revocation
          </label>
        </div>

        <div style="display:flex; justify-content:flex-end; gap:10px; margin-top:16px;">
          <button class="btn btn-ghost" type="button" onclick="document.getElementById('modal-root').innerHTML=''">Cancel</button>
          <button class="btn btn-primary" type="submit" style="background:#dc2626; border-color:#dc2626; color:#fff;">Initiate Exit Clearance</button>
        </div>
      </form>
    </div>
  `);

  document.getElementById("offboard-staff-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const userId = document.getElementById("ob-user-id").value;
    const payload = {
      exitType: document.getElementById("ob-exit-type").value,
      lastWorkingDay: document.getElementById("ob-lwd").value,
      reasonCategory: document.getElementById("ob-reason").value,
      handoverComplete: document.getElementById("ob-handover").checked,
      assetsReturned: document.getElementById("ob-assets").checked,
      accessRevoked: document.getElementById("ob-access").checked,
    };

        try {
      await apiPost(`/employees/${userId}/offboard`, payload);
    } catch (err) {
      showToast(err?.message || "The server did not accept this request. Nothing was saved.", "error");
      return;
    }

const emp = liveEmployees.find(e => e.userId === userId);
    if (emp) {
      emp.employmentStatus = "NOTICE_PERIOD";
    }


    showToast(`Offboarding clearance initiated for ${userId} (${payload.exitType}).`, "success");
    document.getElementById("modal-root").innerHTML = "";
    rerenderCurrentSubpanel();
  });
}

function openEmployee360Drawer(userId) {
  openModal(`
    <div style="padding:24px; max-width:700px; width:100%; color:var(--ink);">
      <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:18px;">
        <div>
          <h2 style="font-size:22px; font-weight:700; margin:0;">Employee 360 Overview</h2>
          <span style="font-size:13px; color:var(--gold,#b45309); font-weight:600;">${userId}</span>
        </div>
        <button class="btn btn-ghost" onclick="document.getElementById('modal-root').innerHTML=''" style="padding:4px 8px;">✕</button>
      </div>

      <div style="display:flex; flex-direction:column; gap:16px;">
        <div style="background:#f8fafc; padding:16px; border-radius:10px;">
          <div style="font-weight:700; font-size:16px; color:var(--ink);" id="e360-name">Loading Employee...</div>
          <div style="font-size:12px; color:var(--muted); margin-top:2px;" id="e360-sub">Retrieving 360 profile</div>
        </div>

        <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px; font-size:13px;">
          <div style="background:#fff; border:1px solid rgba(0,0,0,0.06); padding:12px; border-radius:8px;">
            <div style="color:var(--muted); font-size:11px;">Employment Type</div>
            <div style="font-weight:600;" id="e360-type">Loading...</div>
          </div>
          <div style="background:#fff; border:1px solid rgba(0,0,0,0.06); padding:12px; border-radius:8px;">
            <div style="color:var(--muted); font-size:11px;">Primary Location</div>
            <div style="font-weight:600;" id="e360-loc">Loading...</div>
          </div>
          <div style="background:#fff; border:1px solid rgba(0,0,0,0.06); padding:12px; border-radius:8px;">
            <div style="color:var(--muted); font-size:11px;">Department &amp; Title</div>
            <div style="font-weight:600;" id="e360-dept">Loading...</div>
          </div>
          <div style="background:#fff; border:1px solid rgba(0,0,0,0.06); padding:12px; border-radius:8px;">
            <div style="color:var(--muted); font-size:11px;">System Access</div>
            <div style="font-weight:600;" id="e360-role">Loading...</div>
          </div>
        </div>

        <div style="display:flex; justify-content:space-between; align-items:center; gap:10px; margin-top:10px;">
          <button class="btn btn-secondary" id="e360-view-attendance-btn" type="button" style="display:flex; align-items:center; gap:6px;">
            <span>⏱️</span>
            <span>View Attendance &amp; Timesheets</span>
          </button>
          <button class="btn btn-ghost" onclick="document.getElementById('modal-root').innerHTML=''">Close Profile</button>
        </div>
      </div>
    </div>
  `);

  document.getElementById("e360-view-attendance-btn")?.addEventListener("click", () => {
    document.getElementById("modal-root").innerHTML = "";
    navigate("attendance/calendar360");
  });

  apiGet(`/employees/${userId}`).then(res => {
    const prof = res?.data?.profile;
    if (prof) {
      document.getElementById("e360-name").textContent = prof.name || prof.identity?.name || userId;
      document.getElementById("e360-sub").textContent = `${prof.userId} · ${prof.email} · Status: ${prof.employmentStatus || 'ACTIVE'}`;
      document.getElementById("e360-type").textContent = `${prof.workerType || 'PERMANENT'} (${prof.employmentType || 'Full Time'})`;
      document.getElementById("e360-loc").textContent = prof.primaryCafeId || '—';
      document.getElementById("e360-dept").textContent = `${prof.department || 'Operations'} — ${prof.designation || 'Staff'}`;
      document.getElementById("e360-role").textContent = prof.role || 'STAFF';
    }
  }).catch(() => {});
}

function openLetterGeneratorModal() {
  openModal(`
    <div style="padding:24px; max-width:520px; width:100%; color:var(--ink);">
      <h2 style="font-size:20px; font-weight:700; margin:0 0 6px;">Generate HR Employment Letter</h2>
      <p style="font-size:13px; color:var(--muted); margin:0 0 20px;">Produce an authoritative, template-versioned HR document.</p>

      <form id="gen-letter-form" style="display:flex; flex-direction:column; gap:14px;">
        <div>
          <label style="font-size:12px; font-weight:600; display:block; margin-bottom:4px;">Employee *</label>
          <select id="gl-user-id" style="width:100%; padding:8px 12px; border:1px solid rgba(0,0,0,0.15); border-radius:6px; font-size:13px;">
            ${liveEmployees.map(e => `
              <option value="${e.userId}">${e.name} (${e.userId}) — ${e.designation || 'Staff'}</option>
            `).join('')}
          </select>
        </div>
        <div>
          <label style="font-size:12px; font-weight:600; display:block; margin-bottom:4px;">Letter Category *</label>
          <select id="gl-category" style="width:100%; padding:8px 12px; border:1px solid rgba(0,0,0,0.15); border-radius:6px; font-size:13px;">
            <option value="APPOINTMENT_LETTER">Appointment Letter</option>
            <option value="CONFIRMATION_LETTER">Probation Confirmation Letter</option>
            <option value="TRANSFER_LETTER">Transfer &amp; Relocation Letter</option>
            <option value="PROMOTION_LETTER">Promotion Order</option>
            <option value="EXPERIENCE_CERTIFICATE">Service / Experience Certificate</option>
          </select>
        </div>
        <div>
          <label style="font-size:12px; font-weight:600; display:block; margin-bottom:4px;">Document Title *</label>
          <input type="text" id="gl-doc-name" required value="Employment Verification Certificate" style="width:100%; padding:8px 12px; border:1px solid rgba(0,0,0,0.15); border-radius:6px; font-size:13px;" />
        </div>

        <div style="display:flex; justify-content:flex-end; gap:10px; margin-top:16px;">
          <button class="btn btn-ghost" type="button" onclick="document.getElementById('modal-root').innerHTML=''">Cancel</button>
          <button class="btn btn-primary" type="submit">Generate Letter</button>
        </div>
      </form>
    </div>
  `);

  document.getElementById("gen-letter-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const userId = document.getElementById("gl-user-id").value.trim().toUpperCase();
    const payload = {
      category: document.getElementById("gl-category").value,
      documentName: document.getElementById("gl-doc-name").value,
    };

    let gen = null;
    try {
      gen = await apiPost(`/employees/${userId}/documents/generate`, payload);
    } catch (err) {
      showToast(err?.message || "The document could not be generated. Nothing was saved.", "error");
      return;
    }
    const docId = gen?.data?.documentId || gen?.data?.docId || "";
    liveDocuments.unshift({
      docId,
      title: payload.documentName,
      employeeId: userId,
      employeeName: liveEmployees.find(e => e.userId === userId)?.name || userId,
      category: payload.category,
      date: new Date().toISOString().split("T")[0],
      status: "ISSUED",
    });

    showToast(`HR Document "${payload.documentName}" generated${docId ? ` (${docId})` : ""}.`, "success");
    document.getElementById("modal-root").innerHTML = "";
    rerenderCurrentSubpanel();
  });
}

function rerenderCurrentSubpanel() {
  const area = document.getElementById("workforce-content-area");
  if (area) {
    area.innerHTML = renderActiveSubpanel();
    wireEmployees(area, activeSubpanel);
  }
}

export function openOnboardEmployeeModal() {
  openModal(`
    <div style="padding:24px; max-width:640px; width:100%; color:var(--ink); max-height:85vh; overflow-y:auto;">
      <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:16px; border-bottom:1px solid rgba(0,0,0,0.08); padding-bottom:12px;">
        <div>
          <span style="font-size:11px; font-weight:700; color:#b45309; text-transform:uppercase; letter-spacing:0.5px;">Workforce Enrollment &amp; Readiness</span>
          <h2 style="font-size:20px; font-weight:700; margin:4px 0 0;">New Employee Registration</h2>
        </div>
        <button class="btn btn-ghost" onclick="document.getElementById('modal-root').innerHTML=''" style="padding:4px 8px;">✕</button>
      </div>

      <form id="onboard-emp-form" style="display:flex; flex-direction:column; gap:16px;">
        <!-- 1. Personal & Identity -->
        <div style="background:#f8fafc; padding:14px; border-radius:8px; border:1px solid #e2e8f0;">
          <div style="font-size:12px; font-weight:700; color:#475569; text-transform:uppercase; margin-bottom:8px;">1. Personal &amp; Contact Details</div>
          <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px;">
            <div>
              <label style="font-size:11.5px; font-weight:600; display:block; margin-bottom:4px;">Legal Full Name *</label>
              <input type="text" id="oe-name" required placeholder="e.g. Arun Nair" style="width:100%; padding:8px 10px; border:1px solid #cbd5e1; border-radius:6px; font-size:12.5px;" />
            </div>
            <div>
              <label style="font-size:11.5px; font-weight:600; display:block; margin-bottom:4px;">Preferred / Display Name</label>
              <input type="text" id="oe-pref" placeholder="e.g. Arun" style="width:100%; padding:8px 10px; border:1px solid #cbd5e1; border-radius:6px; font-size:12.5px;" />
            </div>
          </div>
          <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-top:8px;">
            <div>
              <label style="font-size:11.5px; font-weight:600; display:block; margin-bottom:4px;">Email Address *</label>
              <input type="email" id="oe-email" required placeholder="arun.nair@zamorin.cafe" style="width:100%; padding:8px 10px; border:1px solid #cbd5e1; border-radius:6px; font-size:12.5px;" />
            </div>
            <div>
              <label style="font-size:11.5px; font-weight:600; display:block; margin-bottom:4px;">Phone Number *</label>
              <input type="text" id="oe-phone" required placeholder="+91 98450 12345" style="width:100%; padding:8px 10px; border:1px solid #cbd5e1; border-radius:6px; font-size:12.5px;" />
            </div>
          </div>
        </div>

        <!-- 2. Employment Information -->
        <div style="background:#f8fafc; padding:14px; border-radius:8px; border:1px solid #e2e8f0;">
          <div style="font-size:12px; font-weight:700; color:#475569; text-transform:uppercase; margin-bottom:8px;">2. Role, Department &amp; Café Assignment</div>
          <div style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:12px;">
            <div>
              <label style="font-size:11.5px; font-weight:600; display:block; margin-bottom:4px;">Department</label>
              <select id="oe-dept" style="width:100%; padding:8px 10px; border:1px solid #cbd5e1; border-radius:6px; font-size:12.5px;">
                <option value="Barista">Barista Operations</option>
                <option value="Kitchen">Kitchen / Culinary</option>
                <option value="Service">Floor &amp; Guest Service</option>
                <option value="Management">Store Management</option>
              </select>
            </div>
            <div>
              <label style="font-size:11.5px; font-weight:600; display:block; margin-bottom:4px;">Designation</label>
              <input type="text" id="oe-desig" value="Junior Barista" style="width:100%; padding:8px 10px; border:1px solid #cbd5e1; border-radius:6px; font-size:12.5px;" />
            </div>
            <div>
              <label style="font-size:11.5px; font-weight:600; display:block; margin-bottom:4px;">System Role</label>
              <select id="oe-role" style="width:100%; padding:8px 10px; border:1px solid #cbd5e1; border-radius:6px; font-size:12.5px;">
                <option value="STAFF">STAFF (Employee)</option>
                <option value="CAFE_ADMIN">CAFE_ADMIN (Store Lead)</option>
              </select>
            </div>
          </div>
          <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-top:8px;">
            <div>
              <label style="font-size:11.5px; font-weight:600; display:block; margin-bottom:4px;">Primary Café</label>
              <select id="oe-cafe" style="width:100%; padding:8px 10px; border:1px solid #cbd5e1; border-radius:6px; font-size:12.5px;">
                ${liveCafes.map(c => `<option value="${c.cafeId}">${c.name || c.cafeId}</option>`).join('') || '<option value="">No cafés available</option>'}
              </select>
            </div>
            <div>
              <label style="font-size:11.5px; font-weight:600; display:block; margin-bottom:4px;">Date of Joining *</label>
              <input type="date" id="oe-joining" required value="${new Date().toISOString().split('T')[0]}" style="width:100%; padding:8px 10px; border:1px solid #cbd5e1; border-radius:6px; font-size:12.5px;" />
            </div>
          </div>
        </div>

        <!-- 3. Statutory & Digital Personal Data Protection Act, 2023 Privacy -->
        <div style="background:#f8fafc; padding:14px; border-radius:8px; border:1px solid #e2e8f0;">
          <div style="font-size:12px; font-weight:700; color:#475569; text-transform:uppercase; margin-bottom:8px;">3. Statutory Compliance &amp; DPDP Privacy Notice</div>
          <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px;">
            <label style="display:flex; align-items:center; gap:8px; font-size:12px; cursor:pointer;">
              <input type="checkbox" id="oe-epf" checked /> EPF Applicable (UAN Linkage)
            </label>
            <label style="display:flex; align-items:center; gap:8px; font-size:12px; cursor:pointer;">
              <input type="checkbox" id="oe-esi" checked /> ESI Insurance Applicable
            </label>
          </div>
          <div style="margin-top:10px; padding:10px; background:#fff; border:1px solid #cbd5e1; border-radius:6px; font-size:11px; color:#64748b; line-height:1.4;">
            <strong>Digital Personal Data Protection Act, 2023 &amp; Rules, 2025 Notice:</strong> Personal and payroll data collected herein is used strictly for employment administration, statutory compliance, and payroll disbursement. Sensitive financial details are masked to non-payroll users.
          </div>
          <label style="display:flex; align-items:center; gap:8px; font-size:11.5px; margin-top:8px; font-weight:600; color:#1e293b; cursor:pointer;">
            <input type="checkbox" id="oe-dpdp-consent" required checked /> Employee acknowledges Privacy &amp; Processing Notice
          </label>
        </div>

        <!-- 4. Readiness Checklist -->
        <div style="background:#f1f5f9; padding:12px; border-radius:8px; font-size:11.5px; color:#475569;">
          <div style="font-weight:700; margin-bottom:4px; color:#0f172a;">Onboarding Checklist:</div>
          <div>✓ Identity &amp; Contact Verified &nbsp;•&nbsp; ✓ Role &amp; Shift Assigned &nbsp;•&nbsp; ✓ Initial Training Queued &nbsp;•&nbsp; ✓ DPDP Consent Logged</div>
        </div>

        <div style="display:flex; justify-content:flex-end; gap:10px; margin-top:8px;">
          <button class="btn btn-ghost" type="button" onclick="document.getElementById('modal-root').innerHTML=''">Cancel</button>
          <button class="btn btn-primary" type="submit" id="oe-submit-btn">+ Onboard Employee</button>
        </div>
      </form>
    </div>
  `);

  document.getElementById("onboard-emp-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const submitBtn = document.getElementById("oe-submit-btn");
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = "Provisioning Employee...";
    }

    const payload = {
      name: document.getElementById("oe-name").value.trim(),
      preferredName: document.getElementById("oe-pref").value.trim(),
      email: document.getElementById("oe-email").value.trim().toLowerCase(),
      phone: document.getElementById("oe-phone").value.trim(),
      department: document.getElementById("oe-dept").value,
      designation: document.getElementById("oe-desig").value.trim(),
      role: document.getElementById("oe-role").value,
      primaryCafeId: document.getElementById("oe-cafe").value,
      assignedCafeIds: [document.getElementById("oe-cafe").value],
      joiningDate: document.getElementById("oe-joining").value,
    };

    try {
      const res = await apiPost("/employees", payload);
      const newEmp = res?.data?.user || {
        userId: res?.data?.userId || `ST-${String(liveEmployees.length + 1).padStart(4, "0")}`,
        ...payload,
        employmentStatus: "PROBATION"
      };

      liveEmployees.unshift(newEmp);
      showToast(`Employee "${payload.name}" successfully onboarded (${newEmp.userId})!`, "success");
      document.getElementById("modal-root").innerHTML = "";
      rerenderCurrentSubpanel();
    } catch (err) {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = "+ Onboard Employee";
      }
      showToast(err?.message || "Failed to onboard employee", "coral");
    }
  });
}

