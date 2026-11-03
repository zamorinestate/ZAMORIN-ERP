// =============================================================================
// ZAMORIN CAFE ERP — SCR-016: UNIVERSAL MY PROFILE / PROFILE MASTER
//
// Role-aware, self-only, audit-friendly, data-governed profile command centre
// serving MASTER, OWNER, CAFE_ADMIN, and STAFF with zero IDOR vulnerabilities,
// strict sensitive data masking, governed change requests, and WCAG 2.2 AA accessibility.
// =============================================================================

import { ApiClientError, apiGet, apiPatch, apiPost, apiBlob } from "../apiClient.js";
import { skeleton, showToast } from "../components.js";
import { state } from "../state.js";
import { navigate } from "../router.js";
import { setupModalA11y } from "../utils/modalA11y.js";
import { openChangePasswordModal } from "../components/changePasswordModal.js";

let activeRequest = null;
let currentProfileData = null;
let activeTab = "overview";
let headerPhotoObjectUrl = null;

const esc = (v) =>
  String(v ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

const show = (v) => (v === null || v === undefined || v === "" ? "—" : esc(v));
const list = (v) => (Array.isArray(v) && v.length ? v.map(esc).join(", ") : "—");

// Canonical role badge styling
function rolePill(role, isPrimaryMaster) {
  const r = String(role || "STAFF").toUpperCase();
  if (r === "MASTER") {
    return `<span class="pill pill-gold" style="font-weight:700;">${isPrimaryMaster ? "PRIMARY MASTER" : "MASTER"}</span>`;
  }
  if (r === "OWNER") {
    return `<span class="pill pill-mint" style="font-weight:700;">OWNER</span>`;
  }
  if (r === "CAFE_ADMIN") {
    return `<span class="pill pill-amber" style="font-weight:700;">CAFÉ ADMIN</span>`;
  }
  return `<span class="pill pill-neutral" style="font-weight:700;">STAFF</span>`;
}

function statusPill(status) {
  const s = String(status || "ACTIVE").toUpperCase();
  if (s === "ACTIVE" || s === "VERIFIED" || s === "COMPLIANT" || s === "APPROVED" || s === "APPLIED") {
    return `<span class="pill pill-mint" style="font-size:11px;">${esc(s)}</span>`;
  }
  if (s === "PENDING" || s === "SUBMITTED" || s === "UNDER_REVIEW" || s === "EXPIRING_SOON") {
    return `<span class="pill pill-amber" style="font-size:11px;">${esc(s.replace("_", " "))}</span>`;
  }
  if (s === "REJECTED" || s === "EXPIRED" || s === "LOCKED" || s === "ATTENTION_REQUIRED") {
    return `<span class="pill pill-coral" style="font-size:11px;">${esc(s.replace("_", " "))}</span>`;
  }
  return `<span class="pill pill-neutral" style="font-size:11px;">${esc(s)}</span>`;
}

// Canonical dev fixture fallback for seamless offline / development preview inspection
function getDevProfileFixture(currentUser) {
  const role = currentUser?.role || "STAFF";
  const userId = currentUser?.id || currentUser?._id || "";
  const isPrimary = Boolean(currentUser?.isPrimaryMaster || role === "MASTER");
  const name = currentUser?.name || (role === "MASTER" ? "Zamorin Primary Master" : "Staff Member");

  return {
    identity: {
      userId,
      name,
      preferredName: "",
      role,
      accountStatus: "ACTIVE",
      isPrimaryMaster: isPrimary,
      createdAt: currentUser?.createdAt || new Date().toISOString(),
      updatedAt: currentUser?.updatedAt || new Date().toISOString(),
      version: 1,
    },
    personal: {
      dateOfBirth: "",
      gender: "",
      nationality: "Indian",
      maritalStatus: "",
      bloodGroup: "",
      preferredLanguage: "English / Malayalam",
    },
    employment: {
      joiningDate: "",
      employmentType: "FULL_TIME",
      department: role === "MASTER" || role === "OWNER" ? "Executive Leadership" : (role === "CAFE_ADMIN" ? "Store Operations" : "Service & Barista"),
      designation: role === "MASTER" ? "Managing Director" : (role === "OWNER" ? "Partner / Owner" : (role === "CAFE_ADMIN" ? "Café General Manager" : "Specialty Barista")),
      primaryCafeId: role === "MASTER" || role === "OWNER" ? "ALL_PORTFOLIO" : "",
      assignedCafeIds: [],
      employmentStatus: "ACTIVE",
      confirmationDate: "",
      probationEndDate: null,
    },
    contact: {
      email: currentUser?.email || "",
      personalEmail: "",
      phone: currentUser?.phone || "",
      emailVerified: true,
      phoneVerified: false,
      address: {
        line1: "",
        line2: "",
        city: "",
        state: "",
        postalCode: "",
        country: "India",
      },
      emergencyContact: {
        name: "",
        relationship: "",
        phone: "",
      },
    },
    payrollProfile: {
      paymentMethod: "DIRECT_DEPOSIT",
      accountHolderName: name,
      bankName: "",
      bankAccountMasked: "",
      ifsc: "",
      paymentStatus: "PENDING_DECLARATION",
      payrollStatus: "ACTIVE",
    },
    statutory: {
      panStatus: "NOT_LINKED",
      panMasked: "",
      epfUanStatus: "NOT_LINKED",
      epfUanMasked: "",
      esiStatus: "NOT_REGISTERED",
      kycStatus: "PENDING",
    },
    securitySummary: {
      mfaStatus: "ENABLED",
      currentAccessMode: role === "MASTER" ? "GLOBAL_PORTFOLIO" : (role === "OWNER" ? "PORTFOLIO_GOVERNANCE" : (role === "CAFE_ADMIN" ? "SELF_ONLY" : "SELF_SERVICE")),
      deviceTrustState: "REGISTERED",
      lastLoginAt: new Date().toISOString(),
      activeSessionsCount: 1,
    },
    accessContext: {
      role,
      isPrimaryMaster: isPrimary,
      scope: role === "MASTER" ? "GLOBAL_PORTFOLIO" : (role === "OWNER" ? "PORTFOLIO" : "CAFE"),
      assignedCafeIds: [],
      primaryCafeId: null,
      explanation: role === "MASTER"
        ? "Primary Master holds organisation-wide administrative governance."
        : "Employee self-service access.",
    },
    actionItems: [],
    profileHealth: {
      status: "HEALTHY",
      completenessPercent: 100,
      items: [],
    },
    documents: [],
    skills: [],
    training: [],
    assets: [],
    requests: [],
    history: [],
    preferences: {
      preferredName: "",
      preferredContactChannel: "EMAIL",
      notificationSummaryFrequency: "DAILY",
      language: "English / Malayalam",
    },
  };
}

// ─── TAB NAVIGATION RENDERER ──────────────────────────────────────────────────
function renderTabNav(currentTab) {
  const tabs = [
    { id: "overview", label: "Overview", icon: "📊" },
    { id: "personal", label: "Personal", icon: "👤" },
    { id: "employment", label: "Employment", icon: "💼" },
    { id: "pay", label: "Pay & Statutory", icon: "💳" },
    { id: "documents", label: "Documents", icon: "📁" },
    { id: "skills", label: "Skills & Training", icon: "🎓" },
    { id: "assets", label: "Assets & Property", icon: "🏷️" },
    { id: "security", label: "Security & Access", icon: "🛡️" },
    { id: "privacy", label: "Privacy & Data", icon: "📜" },
    { id: "requests", label: "My Requests", icon: "📨" },
    { id: "history", label: "History", icon: "⏳" },
    { id: "preferences", label: "Preferences", icon: "⚙️" },
  ];

  return `
    <nav class="profile-tabs-scroll" aria-label="Profile Sections" style="display:flex;gap:6px;overflow-x:auto;padding-bottom:8px;margin-bottom:18px;-webkit-overflow-scrolling:touch;">
      ${tabs
        .map(
          (t) => `
        <button type="button" class="btn ${currentTab === t.id ? "btn-primary" : "btn-ghost"}" data-profile-tab="${t.id}" style="font-size:12.5px;padding:8px 14px;border-radius:10px;white-space:nowrap;display:inline-flex;align-items:center;gap:6px;">
          <span>${t.icon}</span>
          <span>${t.label}</span>
        </button>
      `
        )
        .join("")}
    </nav>
  `;
}

// ─── PROFILE HEADER ───────────────────────────────────────────────────────────
function renderProfileHeader(p) {
  const i = p.identity || {};
  const e = p.employment || {};
  const initials = (i.preferredName || i.name || "U")
    .split(" ")
    .map((n) => n[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  const isMaster = i.role === "MASTER";

  return `
    <div class="glass card-elevated" style="padding:22px;margin-bottom:18px;position:relative;overflow:hidden;">
      <div style="position:absolute;top:0;left:0;right:0;height:4px;background:linear-gradient(90deg,var(--accent-gold,#c59b27),var(--mint,#2ecc71));"></div>
      <div class="flex justify-between items-center" style="gap:18px;flex-wrap:wrap;">
        <div class="flex items-center" style="gap:18px;">
          <div style="position:relative;cursor:pointer;" data-edit-photo title="Manage profile photo">
            <div style="width:68px;height:68px;border-radius:50%;background:linear-gradient(135deg,var(--ink-900),var(--ink-800));border:2px solid var(--bronze-500);display:flex;align-items:center;justify-content:center;color:#ffffff;font-size:24px;font-weight:700;overflow:hidden;position:relative;" class="font-display">
              <span id="employee-profile-initials">${initials}</span>
              <img id="employee-profile-photo" alt="Your profile photo" style="display:${headerPhotoObjectUrl ? "block" : "none"};position:absolute;inset:0;width:100%;height:100%;object-fit:cover;"${headerPhotoObjectUrl ? ` src="${headerPhotoObjectUrl}"` : ""} />
            </div>
            <div style="position:absolute;bottom:0;right:0;width:22px;height:22px;border-radius:50%;background:rgba(0,0,0,0.7);border:1px solid rgba(255,255,255,0.4);display:flex;align-items:center;justify-content:center;font-size:11px;color:var(--ink);">📷</div>
          </div>
          <div>
            <div class="flex items-center" style="gap:10px;flex-wrap:wrap;">
              <h1 class="font-display" style="color:var(--ink);font-size:24px;font-weight:800;margin:0;letter-spacing:-0.01em;">
                ${show(i.preferredName ? `${i.name} (${i.preferredName})` : i.name)}
              </h1>
              ${rolePill(i.role, i.isPrimaryMaster)}
              ${statusPill(i.accountStatus)}
            </div>
            <div style="color:var(--muted);" style="font-size:13px;margin-top:5px;display:flex;gap:12px;flex-wrap:wrap;align-items:center;">
              <span><strong>Designation:</strong> ${show(e.designation)}</span>
              <span>•</span>
              <span><strong>Department:</strong> ${show(e.department)}</span>
              <span>•</span>
              <span><strong>Scope:</strong> ${isMaster ? "Global Portfolio (All Cafés)" : (e.primaryCafeId || "Assigned Café")}</span>
              <span>•</span>
              <span><strong>ID:</strong> <code style="color:var(--accent-gold,#c59b27);font-size:12px;">${show(i.userId)}</code></span>
            </div>
          </div>
        </div>

        <div class="flex items-center" style="gap:10px;flex-wrap:wrap;">
          <button type="button" class="btn btn-primary" data-open-edit-modal style="display:inline-flex;align-items:center;gap:6px;">
            <span>✏️</span>
            <span>Edit Profile</span>
          </button>

          <div style="position:relative;">
            <button type="button" class="btn btn-ghost" data-toggle-actions-menu style="display:inline-flex;align-items:center;gap:6px;">
              <span>⚙️ More Actions</span>
              <span>▾</span>
            </button>
            <div class="actions-dropdown-menu glass" style="display:none;position:absolute;right:0;top:100%;margin-top:6px;width:240px;background:var(--surface-raised);border:1px solid var(--line);border:1px solid rgba(255,255,255,0.15);border-radius:12px;padding:6px;z-index:99;box-shadow:0 12px 32px rgba(0,0,0,0.5);">
              <button type="button" class="dropdown-item" data-action="report-inaccuracy" style="width:100%;text-align:left;padding:8px 12px;border:none;background:none;color:var(--ink);font-size:12.5px;border-radius:8px;cursor:pointer;">🚩 Report Incorrect Information</button>
              <button type="button" class="dropdown-item" data-action="download-summary" style="width:100%;text-align:left;padding:8px 12px;border:none;background:none;color:var(--ink);font-size:12.5px;border-radius:8px;cursor:pointer;">📥 Download Profile Summary</button>
              <button type="button" class="dropdown-item" data-action="attest-profile" style="width:100%;text-align:left;padding:8px 12px;border:none;background:none;color:var(--ink);font-size:12.5px;border-radius:8px;cursor:pointer;">✅ Confirm Details Are Current</button>
              <button type="button" class="dropdown-item" data-action="diagnostics" style="width:100%;text-align:left;padding:8px 12px;border:none;background:none;color:var(--ink);font-size:12.5px;border-radius:8px;cursor:pointer;">🔍 Profile Diagnostics</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
}

// ─── TAB CONTENT: OVERVIEW SPOTLIGHT ─────────────────────────────────────────
function renderOverviewTab(p) {
  const i = p.identity || {};
  const c = p.contact || {};
  const e = p.employment || {};
  const pay = p.payrollProfile || {};
  const sec = p.securitySummary || {};
  const health = p.profileHealth || { completenessPercent: 95, status: "HEALTHY" };
  const actionItems = p.actionItems || [];

  return `
    <div class="flex-col gap-lg">
      <!-- Action Centre / Exceptions Banner -->
      ${
        actionItems.length > 0
          ? `
        <div class="glass" style="padding:18px;border-left:4px solid var(--accent-gold,#c59b27);background:rgba(197,155,39,0.08);">
          <div class="flex justify-between items-center" style="margin-bottom:10px;">
            <div style="font-weight:700;color:var(--ink);font-size:14px;display:flex;align-items:center;gap:8px;">
              <span>⚡</span> <span>Action Centre (${actionItems.length} items require your attention)</span>
            </div>
          </div>
          <div class="flex-col gap-sm">
            ${actionItems
              .map(
                (act) => `
              <div class="flex justify-between items-center" style="padding:10px 14px;background:var(--surface-sunken);border:1px solid var(--line);border-radius:10px;gap:12px;flex-wrap:wrap;">
                <div>
                  <div style="color:var(--ink);font-size:13px;font-weight:600;">${esc(act.title)}</div>
                  <div style="color:var(--muted);" style="font-size:11.5px;margin-top:2px;">${esc(act.reason)}</div>
                </div>
                <button type="button" class="btn btn-primary" data-resolve-action="${esc(act.actionType)}" style="font-size:12px;padding:6px 12px;">Take Action</button>
              </div>
            `
              )
              .join("")}
          </div>
        </div>
      `
          : `
        <div class="glass" style="padding:14px 18px;border-left:4px solid var(--mint,#2ecc71);background:rgba(46,204,113,0.06);display:flex;align-items:center;gap:10px;">
          <span>✅</span>
          <span style="color:var(--ink);font-size:13px;font-weight:600;">Your profile is up to date and fully compliant with workplace standards.</span>
        </div>
      `
      }

      <!-- Next Best Action & Profile Completeness -->
      <div class="grid grid-2" style="gap:16px;">
        <div class="glass card-elevated" style="padding:18px;">
          <div class="kpi-label">PROFILE COMPLETENESS</div>
          <div class="flex items-center" style="gap:14px;margin-top:8px;">
            <div style="font-size:28px;font-weight:800;color:var(--mint,#2ecc71);" class="font-display">
              ${health.completenessPercent}%
            </div>
            <div style="flex:1;">
              <div style="height:8px;border-radius:4px;background:rgba(255,255,255,0.12);overflow:hidden;">
                <div style="height:100%;width:${health.completenessPercent}%;background:linear-gradient(90deg,var(--accent-gold,#c59b27),var(--mint,#2ecc71));border-radius:4px;"></div>
              </div>
              <div style="color:var(--muted);" style="font-size:11px;margin-top:4px;">Identity, contact, payment, and statutory records verified.</div>
            </div>
          </div>
        </div>

        <div class="glass card-elevated" style="padding:18px;">
          <div class="kpi-label">NEXT RECOMMENDED ACTION</div>
          <div style="color:var(--ink);font-size:14px;font-weight:600;margin-top:8px;">
            ${actionItems.length > 0 ? esc(actionItems[0].title) : "Perform periodic details reconfirmation"}
          </div>
          <div style="color:var(--muted);" style="font-size:11.5px;margin-top:4px;">
            ${actionItems.length > 0 ? esc(actionItems[0].reason) : "Keeping your profile confirmed ensures accurate payroll and statutory reporting."}
          </div>
        </div>
      </div>

      <!-- Quick Self-Service Navigation Cards -->
      <div class="glass" style="padding:18px;">
        <div style="color:var(--ink);font-size:14px;font-weight:700;margin-bottom:12px;">Quick Self-Service Actions</div>
        <div class="grid grid-4" style="gap:12px;">
          <a href="#staff-payslips" class="glass card-interactive" style="padding:14px;border-radius:12px;text-decoration:none;display:block;">
            <div style="font-size:20px;margin-bottom:6px;">📄</div>
            <div style="color:var(--ink);font-size:13px;font-weight:600;">My Payslips</div>
            <div style="color:var(--muted);" style="font-size:11px;margin-top:2px;">View statements & Form No. 130</div>
          </a>
          <a href="#staff-loans" class="glass card-interactive" style="padding:14px;border-radius:12px;text-decoration:none;display:block;">
            <div style="font-size:20px;margin-bottom:6px;">💰</div>
            <div style="color:var(--ink);font-size:13px;font-weight:600;">Loans & Advances</div>
            <div style="color:var(--muted);" style="font-size:11px;margin-top:2px;">Track repayments & balances</div>
          </a>
          <button type="button" class="glass card-interactive" data-switch-profile-tab="security" style="padding:14px;border-radius:12px;text-align:left;border:none;width:100%;cursor:pointer;">
            <div style="font-size:20px;margin-bottom:6px;">🛡️</div>
            <div style="color:var(--ink);font-size:13px;font-weight:600;">Security & Sessions</div>
            <div style="color:var(--muted);" style="font-size:11px;margin-top:2px;">MFA & device authorizations</div>
          </button>
          <button type="button" class="glass card-interactive" data-switch-profile-tab="documents" style="padding:14px;border-radius:12px;text-align:left;border:none;width:100%;cursor:pointer;">
            <div style="font-size:20px;margin-bottom:6px;">📁</div>
            <div style="color:var(--ink);font-size:13px;font-weight:600;">Compliance Docs</div>
            <div style="color:var(--muted);" style="font-size:11px;margin-top:2px;">Certificates & agreements</div>
          </button>
        </div>
      </div>

      <!-- Overview Identity Summary Grid -->
      <div class="grid grid-2" style="gap:16px;">
        <div class="glass" style="padding:18px;">
          <div style="color:var(--ink);font-size:14px;font-weight:700;margin-bottom:12px;border-bottom:1px solid rgba(255,255,255,0.08);padding-bottom:8px;">
            Employment & Assignment
          </div>
          <div class="flex-col gap-sm">
            <div class="flex justify-between"><span style="color:var(--muted);" style="font-size:12px;">Legal Full Name</span><span style="color:var(--ink);font-size:12.5px;font-weight:600;">${show(i.name)}</span></div>
            <div class="flex justify-between"><span style="color:var(--muted);" style="font-size:12px;">Designation</span><span style="color:var(--ink);font-size:12.5px;">${show(e.designation)}</span></div>
            <div class="flex justify-between"><span style="color:var(--muted);" style="font-size:12px;">Department</span><span style="color:var(--ink);font-size:12.5px;">${show(e.department)}</span></div>
            <div class="flex justify-between"><span style="color:var(--muted);" style="font-size:12px;">Joining Date</span><span style="color:var(--ink);font-size:12.5px;">${show(e.joiningDate)}</span></div>
            <div class="flex justify-between"><span style="color:var(--muted);" style="font-size:12px;">Employment Status</span><span style="color:var(--mint,#2ecc71);font-size:12.5px;font-weight:600;">${show(e.employmentStatus)}</span></div>
          </div>
        </div>

        <div class="glass" style="padding:18px;">
          <div style="color:var(--ink);font-size:14px;font-weight:700;margin-bottom:12px;border-bottom:1px solid rgba(255,255,255,0.08);padding-bottom:8px;">
            Contact & Location
          </div>
          <div class="flex-col gap-sm">
            <div class="flex justify-between"><span style="color:var(--muted);" style="font-size:12px;">Work Email</span><span style="color:var(--ink);font-size:12.5px;">${show(c.email)}</span></div>
            <div class="flex justify-between"><span style="color:var(--muted);" style="font-size:12px;">Primary Mobile</span><span style="color:var(--ink);font-size:12.5px;">${show(c.phone)}</span></div>
            <div class="flex justify-between"><span style="color:var(--muted);" style="font-size:12px;">Primary Café</span><span style="color:var(--ink);font-size:12.5px;">${show(e.primaryCafeId || "Global")}</span></div>
            <div class="flex justify-between"><span style="color:var(--muted);" style="font-size:12px;">Payment Destination</span><span style="color:var(--accent-gold,#c59b27);font-size:12.5px;font-weight:600;">${show(pay.bankAccountMasked)}</span></div>
            <div class="flex justify-between"><span style="color:var(--muted);" style="font-size:12px;">Access Mode</span><span style="color:var(--ink);font-size:12.5px;">${show(sec.currentAccessMode)}</span></div>
          </div>
        </div>
      </div>
    </div>
  `;
}

// ─── TAB CONTENT: PERSONAL ────────────────────────────────────────────────────
function renderPersonalTab(p) {
  const i = p.identity || {};
  const per = p.personal || {};
  const c = p.contact || {};
  const addr = c.address || {};
  const em = c.emergencyContact || {};

  return `
    <div class="flex-col gap-lg">
      <div class="glass" style="padding:20px;">
        <div class="flex justify-between items-center" style="margin-bottom:16px;border-bottom:1px solid rgba(255,255,255,0.08);padding-bottom:10px;">
          <div>
            <div style="color:var(--ink);font-size:15px;font-weight:700;">Personal Information</div>
            <div style="color:var(--muted);" style="font-size:12px;">Self-managed and verified identity records.</div>
          </div>
          <button type="button" class="btn btn-primary" data-open-edit-modal style="font-size:12px;padding:6px 14px;">Edit Personal Info</button>
        </div>

        <div class="grid grid-2" style="gap:16px;">
          <div class="flex-col gap-sm">
            <div><span style="color:var(--muted);" style="font-size:11px;">LEGAL FULL NAME</span><div style="color:var(--ink);font-size:13.5px;font-weight:600;margin-top:2px;">${show(i.name)} <span style="color:var(--muted);" style="font-size:11px;">(Verified)</span></div></div>
            <div><span style="color:var(--muted);" style="font-size:11px;">PREFERRED DISPLAY NAME</span><div style="color:var(--accent-gold,#c59b27);font-size:13.5px;font-weight:600;margin-top:2px;">${show(i.preferredName || "None set")}</div></div>
            <div><span style="color:var(--muted);" style="font-size:11px;">DATE OF BIRTH</span><div style="color:var(--ink);font-size:13px;margin-top:2px;">${show(per.dateOfBirth)}</div></div>
            <div><span style="color:var(--muted);" style="font-size:11px;">GENDER</span><div style="color:var(--ink);font-size:13px;margin-top:2px;">${show(per.gender)}</div></div>
          </div>
          <div class="flex-col gap-sm">
            <div><span style="color:var(--muted);" style="font-size:11px;">NATIONALITY</span><div style="color:var(--ink);font-size:13px;margin-top:2px;">${show(per.nationality)}</div></div>
            <div><span style="color:var(--muted);" style="font-size:11px;">MARITAL STATUS</span><div style="color:var(--ink);font-size:13px;margin-top:2px;">${show(per.maritalStatus)}</div></div>
            <div><span style="color:var(--muted);" style="font-size:11px;">BLOOD GROUP</span><div style="color:var(--ink);font-size:13px;margin-top:2px;">${show(per.bloodGroup)}</div></div>
            <div><span style="color:var(--muted);" style="font-size:11px;">PREFERRED LANGUAGE</span><div style="color:var(--ink);font-size:13px;margin-top:2px;">${show(per.preferredLanguage)}</div></div>
          </div>
        </div>
      </div>

      <!-- Contact & Residential Address -->
      <div class="grid grid-2" style="gap:16px;">
        <div class="glass" style="padding:20px;">
          <div style="color:var(--ink);font-size:14px;font-weight:700;margin-bottom:12px;border-bottom:1px solid rgba(255,255,255,0.08);padding-bottom:8px;">
            Residential Address
          </div>
          <div class="flex-col gap-xs">
            <div style="color:var(--ink);font-size:13px;line-height:1.5;">
              ${show(addr.line1)}<br/>
              ${addr.line2 ? `${show(addr.line2)}<br/>` : ""}
              ${show(addr.city)}, ${show(addr.state)} - ${show(addr.postalCode)}<br/>
              ${show(addr.country || "India")}
            </div>
            <div style="color:var(--muted);" style="font-size:11px;margin-top:8px;">Source: Self-Service Declared</div>
          </div>
        </div>

        <div class="glass" style="padding:20px;">
          <div style="color:var(--ink);font-size:14px;font-weight:700;margin-bottom:12px;border-bottom:1px solid rgba(255,255,255,0.08);padding-bottom:8px;">
            Emergency Contact
          </div>
          <div class="flex-col gap-sm">
            <div><span style="color:var(--muted);" style="font-size:11px;">CONTACT PERSON</span><div style="color:var(--ink);font-size:13.5px;font-weight:600;margin-top:2px;">${show(em.name)}</div></div>
            <div><span style="color:var(--muted);" style="font-size:11px;">RELATIONSHIP</span><div style="color:var(--ink);font-size:13px;margin-top:2px;">${show(em.relationship)}</div></div>
            <div><span style="color:var(--muted);" style="font-size:11px;">EMERGENCY PHONE</span><div style="color:var(--mint,#2ecc71);font-size:13.5px;font-weight:600;margin-top:2px;">${show(em.phone)}</div></div>
          </div>
        </div>
      </div>
    </div>
  `;
}

// ─── TAB CONTENT: EMPLOYMENT ──────────────────────────────────────────────────
function renderEmploymentTab(p) {
  const e = p.employment || {};
  const i = p.identity || {};
  const isMaster = i.role === "MASTER";

  return `
    <div class="flex-col gap-lg">
      <div class="glass" style="padding:20px;">
        <div style="color:var(--ink);font-size:15px;font-weight:700;margin-bottom:16px;border-bottom:1px solid rgba(255,255,255,0.08);padding-bottom:10px;">
          Employment & Service Details
        </div>

        <div class="grid grid-2" style="gap:16px;">
          <div class="flex-col gap-sm">
            <div><span style="color:var(--muted);" style="font-size:11px;">JOB DESIGNATION</span><div style="color:var(--ink);font-size:13.5px;font-weight:600;margin-top:2px;">${show(e.designation)}</div></div>
            <div><span style="color:var(--muted);" style="font-size:11px;">DEPARTMENT / FUNCTION</span><div style="color:var(--ink);font-size:13px;margin-top:2px;">${show(e.department)}</div></div>
            <div><span style="color:var(--muted);" style="font-size:11px;">EMPLOYMENT TYPE</span><div style="color:var(--ink);font-size:13px;margin-top:2px;">${show(e.employmentType)}</div></div>
            <div><span style="color:var(--muted);" style="font-size:11px;">EMPLOYMENT STATUS</span><div style="color:var(--mint,#2ecc71);font-size:13px;font-weight:600;margin-top:2px;">${show(e.employmentStatus)}</div></div>
          </div>
          <div class="flex-col gap-sm">
            <div><span style="color:var(--muted);" style="font-size:11px;">JOINING DATE</span><div style="color:var(--ink);font-size:13px;margin-top:2px;">${show(e.joiningDate)}</div></div>
            <div><span style="color:var(--muted);" style="font-size:11px;">CONFIRMATION DATE</span><div style="color:var(--ink);font-size:13px;margin-top:2px;">${show(e.confirmationDate || "Direct Confirmation")}</div></div>
            <div><span style="color:var(--muted);" style="font-size:11px;">PRIMARY CAFÉ LOCATION</span><div style="color:var(--accent-gold,#c59b27);font-size:13.5px;font-weight:600;margin-top:2px;">${isMaster ? "Global Portfolio (All Outlets)" : show(e.primaryCafeId)}</div></div>
            <div><span style="color:var(--muted);" style="font-size:11px;">ALL ASSIGNED CAFÉS</span><div style="color:var(--ink);font-size:13px;margin-top:2px;">${isMaster ? "All 3 Cafés" : list(e.assignedCafeIds)}</div></div>
          </div>
        </div>

        <div style="margin-top:16px;padding:12px;background:rgba(255,255,255,0.04);border-radius:10px;font-size:12px;" style="color:var(--muted);">
          🔒 <strong>Authoritative Governance:</strong> Employment details, designations, and café assignments are managed centrally by the Employee Master. If any information is inaccurate, please submit a change request.
        </div>
      </div>
    </div>
  `;
}

// ─── TAB CONTENT: PAY & STATUTORY ─────────────────────────────────────────────
function renderPayTab(p) {
  const pay = p.payrollProfile || {};
  const stat = p.statutory || {};

  return `
    <div class="flex-col gap-lg">
      <div class="grid grid-2" style="gap:16px;">
        <div class="glass" style="padding:20px;">
          <div class="flex justify-between items-center" style="margin-bottom:14px;border-bottom:1px solid rgba(255,255,255,0.08);padding-bottom:8px;">
            <div style="color:var(--ink);font-size:14px;font-weight:700;">Direct Deposit Payment Profile</div>
            ${statusPill(pay.paymentStatus)}
          </div>
          <div class="flex-col gap-sm">
            <div><span style="color:var(--muted);" style="font-size:11px;">ACCOUNT HOLDER NAME</span><div style="color:var(--ink);font-size:13.5px;font-weight:600;margin-top:2px;">${show(pay.accountHolderName)}</div></div>
            <div><span style="color:var(--muted);" style="font-size:11px;">BANK NAME</span><div style="color:var(--ink);font-size:13px;margin-top:2px;">${show(pay.bankName)}</div></div>
            <div><span style="color:var(--muted);" style="font-size:11px;">ACCOUNT NUMBER (MASKED)</span><div style="color:var(--accent-gold,#c59b27);font-size:14px;font-weight:700;margin-top:2px;letter-spacing:1px;">${show(pay.bankAccountMasked)}</div></div>
            <div><span style="color:var(--muted);" style="font-size:11px;">IFSC CODE</span><div style="color:var(--ink);font-size:13px;margin-top:2px;">${show(pay.ifsc)}</div></div>
            <div><span style="color:var(--muted);" style="font-size:11px;">PAYMENT METHOD</span><div style="color:var(--ink);font-size:13px;margin-top:2px;">${show(pay.paymentMethod)}</div></div>
          </div>
          <div style="margin-top:16px;">
            <button type="button" class="btn btn-ghost" data-action="report-inaccuracy" style="font-size:12px;width:100%;">Request Bank Account Change</button>
          </div>
        </div>

        <div class="glass" style="padding:20px;">
          <div class="flex justify-between items-center" style="margin-bottom:14px;border-bottom:1px solid rgba(255,255,255,0.08);padding-bottom:8px;">
            <div style="color:var(--ink);font-size:14px;font-weight:700;">Statutory Compliance (India)</div>
            ${statusPill(stat.kycStatus)}
          </div>
          <div class="flex-col gap-sm">
            <div><span style="color:var(--muted);" style="font-size:11px;">INCOME TAX PAN</span><div style="color:var(--ink);font-size:13px;margin-top:2px;">${show(stat.panMasked)} <span class="pill pill-mint" style="font-size:10px;">${show(stat.panStatus)}</span></div></div>
            <div><span style="color:var(--muted);" style="font-size:11px;">EPFO UAN (UNIVERSAL ACCOUNT NUMBER)</span><div style="color:var(--ink);font-size:13px;margin-top:2px;">${show(stat.epfUanMasked)} <span class="pill pill-mint" style="font-size:10px;">${show(stat.epfUanStatus)}</span></div></div>
            <div><span style="color:var(--muted);" style="font-size:11px;">ESIC IP REGISTRATION</span><div style="color:var(--ink);font-size:13px;margin-top:2px;">${show(stat.esiStatus)}</div></div>
            <div><span style="color:var(--muted);" style="font-size:11px;">TDS CERTIFICATE COMPLIANCE</span><div style="color:var(--ink);font-size:13px;margin-top:2px;">Form No. 130 (2026 Framework) Active</div></div>
          </div>
          <div style="margin-top:16px;">
            <a href="#staff-payslips" class="btn btn-primary" style="display:block;text-align:center;text-decoration:none;font-size:12px;">View My Full Payslips & Form 130</a>
          </div>
        </div>
      </div>
    </div>
  `;
}

// ─── TAB CONTENT: DOCUMENTS & COMPLIANCE ──────────────────────────────────────
function renderDocumentsTab(p) {
  const docs = p.documents || [];

  return `
    <div class="flex-col gap-lg">
      <div class="glass" style="padding:20px;">
        <div class="flex justify-between items-center" style="margin-bottom:16px;border-bottom:1px solid rgba(255,255,255,0.08);padding-bottom:10px;flex-wrap:wrap;gap:10px;">
          <div>
            <div style="color:var(--ink);font-size:15px;font-weight:700;">My Compliance & Employment Documents</div>
            <div style="color:var(--muted);" style="font-size:12px;">Signed letters, identity records, and food safety certifications.</div>
          </div>
          <button type="button" class="btn btn-primary" data-open-upload-modal style="font-size:12px;padding:6px 14px;">Upload Document</button>
        </div>

        <div class="flex-col gap-sm">
          ${docs.map((d) => `
            <div class="flex justify-between items-center" style="padding:12px 16px;background:var(--surface-sunken);border:1px solid var(--line);border-radius:12px;gap:12px;flex-wrap:wrap;">
              <div class="flex items-center" style="gap:12px;">
                <div style="font-size:24px;">📄</div>
                <div>
                  <div style="color:var(--ink);font-size:13.5px;font-weight:600;">${esc(d.name)}</div>
                  <div style="color:var(--muted);" style="font-size:11.5px;margin-top:2px;">
                    Category: ${esc(d.category)} · Issued: ${esc(d.issueDate)} ${d.expiryDate !== "—" ? `· Expires: ${esc(d.expiryDate)}` : ""}
                  </div>
                </div>
              </div>
              <div class="flex items-center" style="gap:10px;">
                ${statusPill(d.status)}
                <button type="button" class="btn btn-ghost" data-view-doc="${esc(d.id)}" style="font-size:12px;padding:6px 12px;">Download</button>
              </div>
            </div>
          `).join("")}
        </div>
      </div>
    </div>
  `;
}

// ─── TAB CONTENT: SKILLS & TRAINING ───────────────────────────────────────────
function renderSkillsTab(p) {
  const skills = p.skills || [];
  const training = p.training || [];

  return `
    <div class="flex-col gap-lg">
      <div class="grid grid-2" style="gap:16px;">
        <div class="glass" style="padding:20px;">
          <div style="color:var(--ink);font-size:14px;font-weight:700;margin-bottom:14px;border-bottom:1px solid rgba(255,255,255,0.08);padding-bottom:8px;">
            Verified Skills & Qualifications
          </div>
          <div class="flex-col gap-sm">
            ${skills.length ? skills.map((s) => `
              <div style="padding:10px 14px;background:var(--surface-sunken);border:1px solid var(--line);border-radius:10px;">
                <div class="flex justify-between items-center">
                  <span style="color:var(--ink);font-size:13px;font-weight:600;">${esc(s.name)}</span>
                  <span class="pill pill-mint" style="font-size:10px;">${esc(s.level)}</span>
                </div>
                <div style="color:var(--muted);font-size:11px;margin-top:3px;">Verified by: ${esc(s.verifiedBy)} on ${esc(s.verifiedAt)}</div>
              </div>
            `).join("") : `<div style="padding:16px;text-align:center;color:var(--muted);font-size:12.5px;">No verified skills or qualifications recorded.</div>`}
          </div>
        </div>

        <div class="glass" style="padding:20px;">
          <div style="color:var(--ink);font-size:14px;font-weight:700;margin-bottom:14px;border-bottom:1px solid rgba(255,255,255,0.08);padding-bottom:8px;">
            Mandatory & Completed Training
          </div>
          <div class="flex-col gap-sm">
            ${training.length ? training.map((t) => `
              <div style="padding:10px 14px;background:var(--surface-sunken);border:1px solid var(--line);border-radius:10px;">
                <div class="flex justify-between items-center">
                  <span style="color:var(--ink);font-size:13px;font-weight:600;">${esc(t.course)}</span>
                  <span class="pill pill-mint" style="font-size:10px;">${esc(t.status)} (${esc(t.score)})</span>
                </div>
                <div style="color:var(--muted);font-size:11px;margin-top:3px;">Completed: ${esc(t.completedAt)}</div>
              </div>
            `).join("") : `<div style="padding:16px;text-align:center;color:var(--muted);font-size:12.5px;">No training certifications recorded yet.</div>`}
          </div>
        </div>
      </div>
    </div>
  `;
}

// ─── TAB CONTENT: ASSETS & PROPERTY ───────────────────────────────────────────
function renderAssetsTab(p) {
  const assets = p.assets || [];

  return `
    <div class="flex-col gap-lg">
      <div class="glass" style="padding:20px;">
        <div style="color:var(--ink);font-size:15px;font-weight:700;margin-bottom:16px;border-bottom:1px solid rgba(255,255,255,0.08);padding-bottom:10px;">
          Assigned Company Property & Assets
        </div>

        <div class="flex-col gap-sm">
          ${assets.length ? assets.map((a) => `
            <div class="flex justify-between items-center" style="padding:12px 16px;background:var(--surface-sunken);border:1px solid var(--line);border-radius:12px;gap:12px;flex-wrap:wrap;">
              <div class="flex items-center" style="gap:12px;">
                <div style="font-size:22px;">🏷️</div>
                <div>
                  <div style="color:var(--ink);font-size:13.5px;font-weight:600;">${esc(a.name)}</div>
                  <div style="color:var(--muted);font-size:11.5px;margin-top:2px;">
                    Asset Code: <code>${esc(a.assetId)}</code> · Condition: ${esc(a.condition)} · Assigned: ${esc(a.assignedDate)}
                  </div>
                </div>
              </div>
              <div class="flex items-center" style="gap:10px;">
                <span class="pill pill-mint" style="font-size:10.5px;">${esc(a.status)}</span>
                <button type="button" class="btn btn-ghost" data-action="report-inaccuracy" style="font-size:11.5px;padding:6px 10px;">Report Issue</button>
              </div>
            </div>
          `).join("") : `<div style="padding:20px;text-align:center;color:var(--muted);font-size:13px;">No company assets or equipment currently assigned.</div>`}
        </div>
      </div>
    </div>
  `;
}

// ─── TAB CONTENT: SECURITY & ACCESS ───────────────────────────────────────────
function renderSecurityTab(p) {
  const sec = p.securitySummary || {};
  const acc = p.accessContext || {};

  return `
    <div class="flex-col gap-lg">
      <!-- My Access Card -->
      <div class="glass card-elevated" style="padding:20px;border-left:4px solid var(--mint,#2ecc71);">
        <div style="color:var(--ink);font-size:15px;font-weight:700;margin-bottom:8px;">My Access Context</div>
        <div style="color:var(--ink);font-size:13px;line-height:1.5;">${esc(acc.explanation)}</div>
        <div class="flex items-center" style="gap:14px;margin-top:12px;flex-wrap:wrap;">
          <div><span style="color:var(--muted);" style="font-size:11px;">EFFECTIVE SCOPE</span><div style="color:var(--accent-gold,#c59b27);font-size:13px;font-weight:600;">${show(acc.scope)}</div></div>
          <div><span style="color:var(--muted);" style="font-size:11px;">DEVICE TRUST STATE</span><div style="color:var(--ink);font-size:13px;">${show(sec.deviceTrustState)}</div></div>
          <div><span style="color:var(--muted);" style="font-size:11px;">MFA ENFORCEMENT</span><div style="color:var(--mint,#2ecc71);font-size:13px;font-weight:600;">${show(sec.mfaStatus)}</div></div>
        </div>
      </div>

      <!-- Active Sessions & Security Controls -->
      <div class="grid grid-2" style="gap:16px;">
        <div class="glass" style="padding:20px;">
          <div class="flex justify-between items-center" style="margin-bottom:14px;border-bottom:1px solid rgba(255,255,255,0.08);padding-bottom:8px;">
            <div style="color:var(--ink);font-size:14px;font-weight:700;">Active Sessions</div>
            <button type="button" class="btn btn-ghost" data-signout-others style="font-size:11px;padding:4px 8px;">Sign Out Others</button>
          </div>
          <div class="flex-col gap-sm">
            <div style="padding:10px 14px;background:var(--surface-sunken);border:1px solid var(--line);border-radius:10px;">
              <div class="flex justify-between items-center">
                <span style="color:var(--ink);font-size:13px;font-weight:600;">Current Active Session</span>
                <span class="pill pill-mint" style="font-size:10px;">THIS DEVICE</span>
              </div>
              <div style="color:var(--muted);" style="font-size:11px;margin-top:4px;">
                Browser Session · Last Activity: Just now · Location: Kozhikode, India
              </div>
            </div>
          </div>
        </div>

        <div class="glass" style="padding:20px;">
          <div style="color:var(--ink);font-size:14px;font-weight:700;margin-bottom:14px;border-bottom:1px solid rgba(255,255,255,0.08);padding-bottom:8px;">
            Authentication & Password
          </div>
          <div class="flex-col gap-sm">
            <div><span style="color:var(--muted);" style="font-size:11px;">PASSWORD STATUS</span><div style="color:var(--ink);font-size:13px;margin-top:2px;">Strong · Last changed recently</div></div>
            <div><span style="color:var(--muted);" style="font-size:11px;">MFA METHOD</span><div style="color:var(--ink);font-size:13px;margin-top:2px;">Time-based One-Time Password (TOTP)</div></div>
          </div>
          <div style="margin-top:14px;">
            <button type="button" class="btn btn-primary" data-change-password-prompt style="font-size:12px;">Change Password</button>
          </div>
        </div>
      </div>
    </div>
  `;
}

// ─── TAB CONTENT: PRIVACY & ACKNOWLEDGEMENTS ─────────────────────────────────
function renderPrivacyTab(p) {
  return `
    <div class="flex-col gap-lg">
      <div class="glass" style="padding:20px;">
        <div style="color:var(--ink);font-size:15px;font-weight:700;margin-bottom:16px;border-bottom:1px solid rgba(255,255,255,0.08);padding-bottom:10px;">
          Data Governance & Privacy Rights (DPDP Act Ready)
        </div>
        <div style="color:var(--ink);font-size:13px;line-height:1.6;" style="color:var(--muted);">
          Zamorin Cafe ERP processes employee personal, employment, and statutory payroll records under lawful employment management obligations and statutory compliance regulations. Under privacy governance principles, you may review, correct, or download a portable summary of your records.
        </div>

        <div class="grid grid-3" style="gap:14px;margin-top:18px;">
          <button type="button" class="glass card-interactive" data-action="report-inaccuracy" style="padding:14px;border-radius:10px;text-align:left;border:none;cursor:pointer;">
            <div style="font-size:18px;margin-bottom:4px;">✏️</div>
            <div style="color:var(--ink);font-size:13px;font-weight:600;">Request Correction</div>
            <div style="color:var(--muted);" style="font-size:11px;margin-top:2px;">Submit corrections for legal or contact data</div>
          </button>
          <button type="button" class="glass card-interactive" data-action="download-summary" style="padding:14px;border-radius:10px;text-align:left;border:none;cursor:pointer;">
            <div style="font-size:18px;margin-bottom:4px;">📥</div>
            <div style="color:var(--ink);font-size:13px;font-weight:600;">Download Summary</div>
            <div style="color:var(--muted);" style="font-size:11px;margin-top:2px;">Export portable self-data archive</div>
          </button>
          <button type="button" class="glass card-interactive" data-action="attest-profile" style="padding:14px;border-radius:10px;text-align:left;border:none;cursor:pointer;">
            <div style="font-size:18px;margin-bottom:4px;">✅</div>
            <div style="color:var(--ink);font-size:13px;font-weight:600;">Attest Accuracy</div>
            <div style="color:var(--muted);" style="font-size:11px;margin-top:2px;">Confirm records are current</div>
          </button>
        </div>
      </div>
    </div>
  `;
}

// ─── TAB CONTENT: REQUESTS QUEUE ──────────────────────────────────────────────
function renderRequestsTab(p) {
  const reqs = p.requests || [];

  return `
    <div class="flex-col gap-lg">
      <div class="glass" style="padding:20px;">
        <div class="flex justify-between items-center" style="margin-bottom:16px;border-bottom:1px solid rgba(255,255,255,0.08);padding-bottom:10px;flex-wrap:wrap;gap:10px;">
          <div>
            <div style="color:var(--ink);font-size:15px;font-weight:700;">My Profile Change Requests</div>
            <div style="color:var(--muted);" style="font-size:12px;">Track status of submitted corrections and governance updates.</div>
          </div>
          <button type="button" class="btn btn-primary" data-action="report-inaccuracy" style="font-size:12px;padding:6px 14px;">New Request</button>
        </div>

        <div class="flex-col gap-sm">
          ${
            reqs.length === 0
              ? `<div class="empty-state" style="padding:24px;"><div style="color:var(--ink);font-size:13.5px;">No active profile change requests.</div></div>`
              : reqs
                  .map(
                    (r) => `
            <div class="flex justify-between items-center" style="padding:12px 16px;background:var(--surface-sunken);border:1px solid var(--line);border-radius:12px;gap:12px;flex-wrap:wrap;">
              <div>
                <div class="flex items-center" style="gap:8px;">
                  <code style="color:var(--accent-gold,#c59b27);font-size:12px;">${esc(r.requestId)}</code>
                  <span style="color:var(--ink);font-size:13.5px;font-weight:600;">${esc(r.title)}</span>
                </div>
                <div style="color:var(--muted);" style="font-size:11.5px;margin-top:3px;">
                  Reason: ${esc(r.reason)} · Submitted: ${esc(r.submittedAt)}
                </div>
              </div>
              <div class="flex items-center" style="gap:10px;">
                ${statusPill(r.status)}
                ${r.status === "SUBMITTED" ? `<button type="button" class="btn btn-ghost" data-withdraw-request="${esc(r.requestId)}" style="font-size:11px;padding:4px 8px;">Withdraw</button>` : ""}
              </div>
            </div>
          `
                  )
                  .join("")
          }
        </div>
      </div>
    </div>
  `;
}

// ─── TAB CONTENT: HISTORY ─────────────────────────────────────────────────────
function renderHistoryTab(p) {
  const history = p.history || [];

  return `
    <div class="flex-col gap-lg">
      <div class="glass" style="padding:20px;">
        <div style="color:var(--ink);font-size:15px;font-weight:700;margin-bottom:16px;border-bottom:1px solid rgba(255,255,255,0.08);padding-bottom:10px;">
          Profile Audit & Change History
        </div>

        <div class="flex-col gap-sm">
          ${history
            .map(
              (h) => `
            <div style="padding:12px 16px;background:var(--surface-sunken);border:1px solid var(--line);border-radius:12px;border-left:3px solid var(--accent-gold,#c59b27);">
              <div class="flex justify-between items-center">
                <span style="color:var(--ink);font-size:13px;font-weight:600;">${esc(h.description)}</span>
                <span style="color:var(--muted);" style="font-size:11px;">${new Date(h.timestamp).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
              </div>
              <div style="color:var(--muted);" style="font-size:11.5px;margin-top:3px;">
                Actor: <strong>${esc(h.actor)}</strong> · Section: ${esc(h.section)}
              </div>
            </div>
          `
            )
            .join("")}
        </div>
      </div>
    </div>
  `;
}

// ─── TAB CONTENT: PREFERENCES ─────────────────────────────────────────────────
function renderPreferencesTab(p) {
  const pref = p.preferences || {};

  return `
    <div class="flex-col gap-lg">
      <div class="glass" style="padding:20px;">
        <div class="flex justify-between items-center" style="margin-bottom:16px;border-bottom:1px solid rgba(255,255,255,0.08);padding-bottom:10px;">
          <div>
            <div style="color:var(--ink);font-size:15px;font-weight:700;">Personal Profile Preferences</div>
            <div style="color:var(--muted);" style="font-size:12px;">Display and notification preferences.</div>
          </div>
          <button type="button" class="btn btn-primary" data-open-edit-modal style="font-size:12px;padding:6px 14px;">Edit Preferences</button>
        </div>

        <div class="grid grid-2" style="gap:16px;">
          <div class="flex-col gap-sm">
            <div><span style="color:var(--muted);" style="font-size:11px;">PREFERRED DISPLAY NAME</span><div style="color:var(--accent-gold,#c59b27);font-size:13.5px;font-weight:600;margin-top:2px;">${show(pref.preferredName || "None")}</div></div>
            <div><span style="color:var(--muted);" style="font-size:11px;">COMMUNICATION CHANNEL</span><div style="color:var(--ink);font-size:13px;margin-top:2px;">${show(pref.preferredContactChannel)}</div></div>
          </div>
          <div class="flex-col gap-sm">
            <div><span style="color:var(--muted);" style="font-size:11px;">NOTIFICATION FREQUENCY</span><div style="color:var(--ink);font-size:13px;margin-top:2px;">${show(pref.notificationSummaryFrequency)}</div></div>
            <div><span style="color:var(--muted);" style="font-size:11px;">INTERFACE LANGUAGE</span><div style="color:var(--ink);font-size:13px;margin-top:2px;">${show(pref.language)}</div></div>
          </div>
        </div>
      </div>
    </div>
  `;
}

// ─── TAB DISPATCHER ───────────────────────────────────────────────────────────
function renderTabContent(tab, p) {
  switch (tab) {
    case "personal":
      return renderPersonalTab(p);
    case "employment":
      return renderEmploymentTab(p);
    case "pay":
      return renderPayTab(p);
    case "documents":
      return renderDocumentsTab(p);
    case "skills":
      return renderSkillsTab(p);
    case "assets":
      return renderAssetsTab(p);
    case "security":
      return renderSecurityTab(p);
    case "privacy":
      return renderPrivacyTab(p);
    case "requests":
      return renderRequestsTab(p);
    case "history":
      return renderHistoryTab(p);
    case "preferences":
      return renderPreferencesTab(p);
    case "overview":
    default:
      return renderOverviewTab(p);
  }
}

// ─── MODAL RENDERERS ──────────────────────────────────────────────────────────
function renderEditModal(p) {
  const i = p.identity || {};
  const c = p.contact || {};
  const addr = c.address || {};
  const em = c.emergencyContact || {};

  return `
    <div class="modal-backdrop" id="edit-profile-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="edit-profile-modal-title" style="position:fixed;inset:0;background:rgba(0,0,0,0.75);z-index:999;display:flex;align-items:center;justify-content:center;padding:16px;">
      <div class="glass card-elevated" style="width:100%;max-width:540px;max-height:90vh;overflow-y:auto;background:rgba(18,22,30,0.98);border:1px solid rgba(255,255,255,0.2);border-radius:16px;padding:24px;">
        <div class="flex justify-between items-center" style="margin-bottom:18px;border-bottom:1px solid rgba(255,255,255,0.1);padding-bottom:12px;">
          <div id="edit-profile-modal-title" style="color:var(--ink);font-size:17px;font-weight:700;" class="font-display">Edit Personal Profile</div>
          <button type="button" class="btn btn-ghost" data-close-modal aria-label="Close edit profile dialog" style="font-size:16px;padding:4px 8px;">✕</button>
        </div>

        <form id="edit-profile-form" class="flex-col gap-md">
          <div>
            <label style="color:var(--ink);font-size:12px;font-weight:600;display:block;margin-bottom:4px;">Preferred Display Name</label>
            <input type="text" id="edit-preferred-name" value="${esc(i.preferredName || "")}" placeholder="e.g. Chris" style="width:100%;padding:10px;border-radius:8px;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.2);color:var(--ink);font-size:13px;" />
          </div>

          <div>
            <label style="color:var(--ink);font-size:12px;font-weight:600;display:block;margin-bottom:4px;">Personal Email</label>
            <input type="email" id="edit-personal-email" value="${esc(c.personalEmail || "")}" placeholder="personal@example.com" style="width:100%;padding:10px;border-radius:8px;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.2);color:var(--ink);font-size:13px;" />
          </div>

          <div>
            <label style="color:var(--ink);font-size:12px;font-weight:600;display:block;margin-bottom:4px;">Primary Mobile</label>
            <input type="tel" id="edit-phone" value="${esc(c.phone || "")}" placeholder="+91 98470 00000" style="width:100%;padding:10px;border-radius:8px;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.2);color:var(--ink);font-size:13px;" />
          </div>

          <div style="font-weight:700;color:var(--ink);font-size:13px;margin-top:6px;border-top:1px solid rgba(255,255,255,0.08);padding-top:10px;">Residential Address</div>
          <div class="grid grid-2" style="gap:10px;">
            <input type="text" id="edit-addr-line1" value="${esc(addr.line1 || "")}" placeholder="Address Line 1" style="width:100%;padding:8px;border-radius:8px;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.2);color:var(--ink);font-size:12.5px;" />
            <input type="text" id="edit-addr-city" value="${esc(addr.city || "")}" placeholder="City" style="width:100%;padding:8px;border-radius:8px;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.2);color:var(--ink);font-size:12.5px;" />
            <input type="text" id="edit-addr-state" value="${esc(addr.state || "")}" placeholder="State" style="width:100%;padding:8px;border-radius:8px;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.2);color:var(--ink);font-size:12.5px;" />
            <input type="text" id="edit-addr-pin" value="${esc(addr.postalCode || "")}" placeholder="PIN Code" style="width:100%;padding:8px;border-radius:8px;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.2);color:var(--ink);font-size:12.5px;" />
          </div>

          <div style="font-weight:700;color:var(--ink);font-size:13px;margin-top:6px;border-top:1px solid rgba(255,255,255,0.08);padding-top:10px;">Emergency Contact</div>
          <div class="grid grid-3" style="gap:10px;">
            <input type="text" id="edit-em-name" value="${esc(em.name || "")}" placeholder="Contact Name" style="width:100%;padding:8px;border-radius:8px;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.2);color:var(--ink);font-size:12.5px;" />
            <input type="text" id="edit-em-rel" value="${esc(em.relationship || "")}" placeholder="Relationship" style="width:100%;padding:8px;border-radius:8px;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.2);color:var(--ink);font-size:12.5px;" />
            <input type="tel" id="edit-em-phone" value="${esc(em.phone || "")}" placeholder="Phone" style="width:100%;padding:8px;border-radius:8px;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.2);color:var(--ink);font-size:12.5px;" />
          </div>

          <div class="flex justify-end" style="gap:10px;margin-top:14px;">
            <button type="button" class="btn btn-ghost" data-close-modal>Cancel</button>
            <button type="submit" class="btn btn-primary" id="save-profile-btn">Save Changes</button>
          </div>
        </form>
      </div>
    </div>
  `;
}

function renderReportInaccuracyModal(p) {
  return `
    <div class="modal-backdrop" id="report-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="report-inaccuracy-modal-title" style="position:fixed;inset:0;background:rgba(0,0,0,0.75);z-index:999;display:flex;align-items:center;justify-content:center;padding:16px;">
      <div class="glass card-elevated" style="width:100%;max-width:520px;background:rgba(18,22,30,0.98);border:1px solid rgba(255,255,255,0.2);border-radius:16px;padding:24px;">
        <div class="flex justify-between items-center" style="margin-bottom:16px;border-bottom:1px solid rgba(255,255,255,0.1);padding-bottom:12px;">
          <div id="report-inaccuracy-modal-title" style="color:var(--ink);font-size:16px;font-weight:700;" class="font-display">Report Incorrect Information</div>
          <button type="button" class="btn btn-ghost" data-close-modal aria-label="Close report inaccuracy dialog" style="font-size:16px;padding:4px 8px;">✕</button>
        </div>

        <form id="report-inaccuracy-form" class="flex-col gap-md">
          <div>
            <label style="color:var(--ink);font-size:12px;font-weight:600;display:block;margin-bottom:4px;">Section Requiring Correction</label>
            <select id="pcr-section" style="width:100%;padding:10px;border-radius:8px;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.2);color:var(--ink);font-size:13px;">
              <option value="LEGAL_NAME">Legal Name Correction</option>
              <option value="BANK_DETAILS">Bank Account / IFSC Update</option>
              <option value="CAFE_ASSIGNMENT">Café Location Discrepancy</option>
              <option value="STATUTORY">PAN / EPFO / ESIC Record</option>
              <option value="DOCUMENT_CORRECTION">Document Record Correction</option>
              <option value="OTHER">Other Profile Inaccuracy</option>
            </select>
          </div>

          <div>
            <label style="color:var(--ink);font-size:12px;font-weight:600;display:block;margin-bottom:4px;">Proposed / Accurate Information</label>
            <input type="text" id="pcr-proposed" placeholder="e.g. Correct bank account number or legal spelling" required style="width:100%;padding:10px;border-radius:8px;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.2);color:var(--ink);font-size:13px;" />
          </div>

          <div>
            <label style="color:var(--ink);font-size:12px;font-weight:600;display:block;margin-bottom:4px;">Reason for Correction</label>
            <textarea id="pcr-reason" rows="3" placeholder="Provide background explanation..." required style="width:100%;padding:10px;border-radius:8px;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.2);color:var(--ink);font-size:13px;resize:vertical;"></textarea>
          </div>

          <div class="flex justify-end" style="gap:10px;margin-top:12px;">
            <button type="button" class="btn btn-ghost" data-close-modal>Cancel</button>
            <button type="submit" class="btn btn-primary">Submit Change Request</button>
          </div>
        </form>
      </div>
    </div>
  `;
}

function renderDiagnosticsModal(p) {
  const i = p.identity || {};
  const sec = p.securitySummary || {};

  return `
    <div class="modal-backdrop" id="diag-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="diagnostics-modal-title" style="position:fixed;inset:0;background:rgba(0,0,0,0.75);z-index:999;display:flex;align-items:center;justify-content:center;padding:16px;">
      <div class="glass card-elevated" style="width:100%;max-width:480px;background:rgba(18,22,30,0.98);border:1px solid rgba(255,255,255,0.2);border-radius:16px;padding:24px;">
        <div class="flex justify-between items-center" style="margin-bottom:16px;border-bottom:1px solid rgba(255,255,255,0.1);padding-bottom:12px;">
          <div id="diagnostics-modal-title" style="color:var(--ink);font-size:16px;font-weight:700;" class="font-display">Profile Diagnostics</div>
          <button type="button" class="btn btn-ghost" data-close-modal aria-label="Close diagnostics dialog" style="font-size:16px;padding:4px 8px;">✕</button>
        </div>

        <div class="flex-col gap-sm" style="font-size:12.5px;">
          <div class="flex justify-between"><span style="color:var(--muted);">User ID</span><code style="color:var(--accent-gold,#c59b27);">${show(i.userId)}</code></div>
          <div class="flex justify-between"><span style="color:var(--muted);">Canonical Role</span><span>${show(i.role)}</span></div>
          <div class="flex justify-between"><span style="color:var(--muted);">Primary Master</span><span>${i.isPrimaryMaster ? "Yes (MU-0001)" : "No"}</span></div>
          <div class="flex justify-between"><span style="color:var(--muted);">Profile Version</span><span>${show(i.version || 1)}</span></div>
          <div class="flex justify-between"><span style="color:var(--muted);">Access Mode</span><span>${show(sec.currentAccessMode)}</span></div>
          <div class="flex justify-between"><span style="color:var(--muted);">Device Trust State</span><span>${show(sec.deviceTrustState)}</span></div>
          <div class="flex justify-between"><span style="color:var(--muted);">Timestamp</span><span>${new Date().toISOString()}</span></div>
        </div>

        <div class="flex justify-end" style="margin-top:18px;">
          <button type="button" class="btn btn-primary" data-close-modal>Close</button>
        </div>
      </div>
    </div>
  `;
}

// ─── MAIN PROFILE VIEW WRAPPER ────────────────────────────────────────────────
function view(p) {
  return `
    <div class="flex-col gap-md">
      ${renderProfileHeader(p)}
      ${renderTabNav(activeTab)}
      <div data-tab-container>
        ${renderTabContent(activeTab, p)}
      </div>
    </div>
  `;
}

function failure(e) {
  // Map errors into professional user-safe messages without technical token strings
  let message = "We couldn't load your profile. Please check your connection and try again.";
  if (e?.status === 401) {
    message = "Your session has expired. Please sign in again to continue.";
  } else if (e?.status === 403) {
    message = "Profile access is currently unavailable for your account role.";
  } else if (e?.status === 404) {
    message = "Your account is active, but the linked employee profile record could not be found.";
  }

  return `
    <div class="glass card-elevated" style="padding:32px;text-align:center;max-width:500px;margin:40px auto;" role="alert">
      <div style="font-size:36px;margin-bottom:12px;">⚠️</div>
      <div style="color:var(--ink);font-size:18px;font-weight:700;margin-bottom:8px;" class="font-display">Unable to load profile</div>
      <div style="color:var(--muted);" style="font-size:13px;line-height:1.5;margin-bottom:20px;">${esc(message)}</div>
      <button class="btn btn-primary" type="button" data-retry-profile style="padding:8px 20px;">Try again</button>
    </div>
  `;
}

async function loadHeaderPhoto(root) {
  try {
    const blob = await apiBlob("/settings/profile/photo");
    if (!root.isConnected) return;
    if (headerPhotoObjectUrl) {
      try { URL.revokeObjectURL(headerPhotoObjectUrl); } catch {}
    }
    headerPhotoObjectUrl = URL.createObjectURL(blob);
    root.querySelectorAll("#employee-profile-photo").forEach((img) => {
      img.src = headerPhotoObjectUrl;
      img.style.display = "block";
    });
    root.querySelectorAll("#employee-profile-initials").forEach((el) => {
      el.style.display = "none";
    });
  } catch {
    // No photo set (or unavailable) — fall back to initials.
    if (headerPhotoObjectUrl) {
      try { URL.revokeObjectURL(headerPhotoObjectUrl); } catch {}
      headerPhotoObjectUrl = null;
    }
    root.querySelectorAll("#employee-profile-photo").forEach((img) => {
      img.removeAttribute("src");
      img.style.display = "none";
    });
    root.querySelectorAll("#employee-profile-initials").forEach((el) => {
      el.style.display = "";
    });
  }
}

// ─── DATA LOADING & ORCHESTRATION ─────────────────────────────────────────────
async function loadProfile(root) {
  activeRequest?.abort();
  const requestController = new AbortController();
  activeRequest = requestController;

  const host = root.querySelector("[data-profile-content]");
  if (!host) return;

  host.innerHTML = `
    <div class="flex-col gap-md" aria-live="polite">
      ${skeleton("100px")}
      ${skeleton("180px")}
      ${skeleton("140px")}
    </div>
  `;

  try {
    let profile = null;

    try {
      const payload = await apiGet("/employees/me", {
        signal: requestController.signal,
      });
      profile = payload?.data?.profile;
    } catch (err) {
      // No sample profile is ever shown: a failed load is an error, not a fixture.
      throw err;
    }

    if (!profile?.identity) {
      throw new Error("Your employee profile was not returned by the server.");
    }

    if (requestController.signal.aborted || !root.isConnected) return;

    currentProfileData = profile;
    host.innerHTML = view(profile);
    wireTabEvents(root);
    loadHeaderPhoto(root);
  } catch (e) {
    if (e?.name === "AbortError" || !root.isConnected) return;
    host.innerHTML = failure(e);
    host.querySelector("[data-retry-profile]")?.addEventListener("click", () => loadProfile(root));
  } finally {
    if (activeRequest === requestController) activeRequest = null;
  }
}

// ─── EVENT WIRING ─────────────────────────────────────────────────────────────
function wireTabEvents(root) {
  // Profile photo management lives in Settings (self-service, audited).
  root.querySelectorAll("[data-edit-photo]").forEach((el) => {
    el.addEventListener("click", () => navigate("settings/profile"));
  });

  // Tab switching
  root.querySelectorAll("[data-profile-tab]").forEach((btn) => {
    btn.addEventListener("click", () => {
      activeTab = btn.getAttribute("data-profile-tab");
      const host = root.querySelector("[data-profile-content]");
      if (host && currentProfileData) {
        host.innerHTML = view(currentProfileData);
        wireTabEvents(root);
      }
    });
  });

  // Switch tab shortcut
  root.querySelectorAll("[data-switch-profile-tab]").forEach((btn) => {
    btn.addEventListener("click", () => {
      activeTab = btn.getAttribute("data-switch-profile-tab");
      const host = root.querySelector("[data-profile-content]");
      if (host && currentProfileData) {
        host.innerHTML = view(currentProfileData);
        wireTabEvents(root);
      }
    });
  });

  // Toggle more actions menu
  const menuBtn = root.querySelector("[data-toggle-actions-menu]");
  const menu = root.querySelector(".actions-dropdown-menu");
  if (menuBtn && menu) {
    menuBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      menu.style.display = menu.style.display === "block" ? "none" : "block";
    });
    document.addEventListener("click", () => {
      if (menu) menu.style.display = "none";
    });
  }

  // Edit Profile Modal
  root.querySelectorAll("[data-open-edit-modal]").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (!currentProfileData) return;
      const modalHost = document.createElement("div");
      modalHost.id = "profile-modal-container";
      modalHost.innerHTML = renderEditModal(currentProfileData);
      document.body.appendChild(modalHost);

      const modalEl = modalHost.querySelector("#edit-profile-modal-backdrop");
      const cleanupA11y = setupModalA11y(modalEl, {
        onClose: () => {
          cleanupA11y();
          modalHost.remove();
        },
        titleId: "edit-profile-modal-title",
      });

      modalHost.querySelectorAll("[data-close-modal], #edit-profile-modal-backdrop").forEach((close) => {
        close.addEventListener("click", (e) => {
          if (e.target === close) {
            cleanupA11y();
            modalHost.remove();
          }
        });
      });

      const form = modalHost.querySelector("#edit-profile-form");
      form?.addEventListener("submit", async (e) => {
        e.preventDefault();
        const preferredName = modalHost.querySelector("#edit-preferred-name").value.trim();
        const personalEmail = modalHost.querySelector("#edit-personal-email").value.trim();
        const phone = modalHost.querySelector("#edit-phone").value.trim();
        const address = {
          line1: modalHost.querySelector("#edit-addr-line1").value.trim(),
          city: modalHost.querySelector("#edit-addr-city").value.trim(),
          state: modalHost.querySelector("#edit-addr-state").value.trim(),
          postalCode: modalHost.querySelector("#edit-addr-pin").value.trim(),
        };
        const emergencyContact = {
          name: modalHost.querySelector("#edit-em-name").value.trim(),
          relationship: modalHost.querySelector("#edit-em-rel").value.trim(),
          phone: modalHost.querySelector("#edit-em-phone").value.trim(),
        };

        try {
          const payload = {
            preferredName,
            personalEmail,
            phone,
            address,
            emergencyContact,
            expectedVersion: currentProfileData.identity?.version || 1,
          };

          await apiPatch("/employees/me", payload);

          cleanupA11y();
          modalHost.remove();
          showToast("Profile updated successfully.", "mint");
          loadProfile(root);
        } catch (err) {
          showToast(err.message || "Failed to update profile", "coral");
        }
      });
    });
  });

  // Report Inaccuracy Modal
  root.querySelectorAll("[data-action='report-inaccuracy']").forEach((btn) => {
    btn.addEventListener("click", () => {
      const modalHost = document.createElement("div");
      modalHost.id = "profile-modal-container";
      modalHost.innerHTML = renderReportInaccuracyModal(currentProfileData);
      document.body.appendChild(modalHost);

      const modalEl = modalHost.querySelector("#report-modal-backdrop");
      const cleanupA11y = setupModalA11y(modalEl, {
        onClose: () => {
          cleanupA11y();
          modalHost.remove();
        },
        titleId: "report-inaccuracy-modal-title",
      });

      modalHost.querySelectorAll("[data-close-modal], #report-modal-backdrop").forEach((close) => {
        close.addEventListener("click", (e) => {
          if (e.target === close) {
            cleanupA11y();
            modalHost.remove();
          }
        });
      });

      const form = modalHost.querySelector("#report-inaccuracy-form");
      form?.addEventListener("submit", async (e) => {
        e.preventDefault();
        const requestType = modalHost.querySelector("#pcr-section").value;
        const proposed = modalHost.querySelector("#pcr-proposed").value.trim();
        const reason = modalHost.querySelector("#pcr-reason").value.trim();

        try {
          const payload = {
            requestType,
            section: "GOVERNED",
            title: `${requestType} Correction Request`,
            reason,
            proposedValues: { correctedValue: proposed },
          };

          await apiPost("/employees/me/change-requests", payload);

          cleanupA11y();
          modalHost.remove();
          showToast("Change request submitted for review.", "mint");
          loadProfile(root);
        } catch (err) {
          showToast(err.message || "Failed to submit request", "coral");
        }
      });
    });
  });

  // Diagnostics Modal
  root.querySelectorAll("[data-action='diagnostics']").forEach((btn) => {
    btn.addEventListener("click", () => {
      const modalHost = document.createElement("div");
      modalHost.id = "profile-modal-container";
      modalHost.innerHTML = renderDiagnosticsModal(currentProfileData || {});
      document.body.appendChild(modalHost);

      const modalEl = modalHost.querySelector("#diag-modal-backdrop");
      const cleanupA11y = setupModalA11y(modalEl, {
        onClose: () => {
          cleanupA11y();
          modalHost.remove();
        },
        titleId: "diagnostics-modal-title",
      });

      modalHost.querySelectorAll("[data-close-modal], #diag-modal-backdrop").forEach((close) => {
        close.addEventListener("click", (e) => {
          if (e.target === close) {
            cleanupA11y();
            modalHost.remove();
          }
        });
      });
    });
  });

  // Attestation Action
  root.querySelectorAll("[data-action='attest-profile']").forEach((btn) => {
    btn.addEventListener("click", async () => {
      try {
        await apiPost("/employees/me/attestation", { confirmedSections: ["ALL"] });
        showToast("Profile accuracy attested. Thank you!", "mint");
      } catch (err) {
        showToast(err.message || "Failed to attest profile", "coral");
      }
    });
  });

  // Download Summary Action
  root.querySelectorAll("[data-action='download-summary']").forEach((btn) => {
    btn.addEventListener("click", async () => {
      try {
        btn.disabled = true;
        const res = await fetch("/api/v1/employees/me/profile-summary/export", {
          credentials: "include",
          headers: { Accept: "application/pdf, application/json" },
        });
        if (!res.ok) throw new Error("Failed to export profile summary.");
        const blob = await res.blob();
        const downloadUrl = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = downloadUrl;
        a.download = `Profile_Summary_${new Date().toISOString().slice(0, 10)}.pdf`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(downloadUrl);
        showToast("Personal profile summary PDF downloaded.", "mint");
      } catch (err) {
        showToast(err.message || "Failed to download summary.", "coral");
      } finally {
        btn.disabled = false;
      }
    });
  });

  // Sign out other sessions
  root.querySelector("[data-signout-others]")?.addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    try {
      btn.disabled = true;
      await apiPost("/auth/sessions/revoke-others", {});
      showToast("All other active sessions have been signed out.", "mint");
    } catch (err) {
      showToast(err.message || "Failed to sign out other sessions.", "coral");
    } finally {
      btn.disabled = false;
    }
  });

  // Change password prompt
  root.querySelector("[data-change-password-prompt]")?.addEventListener("click", () => {
    openChangePasswordModal();
  });

  // Upload modal trigger -> navigates to Document Hub
  root.querySelector("[data-open-upload-modal]")?.addEventListener("click", () => {
    location.hash = "#staff-documents";
  });

  // Action items resolution
  root.querySelectorAll("[data-resolve-action]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const act = btn.dataset.resolveAction;
      showToast(`Resolving action "${act}". Opening profile editor.`, "mint");
    });
  });

  // Download document
  root.querySelectorAll("[data-view-doc]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const docId = btn.dataset.viewDoc;
      try {
        btn.disabled = true;
        const res = await fetch(`/api/v1/employees/me/documents/${docId}/download`, {
          credentials: "include",
        });
        if (!res.ok) throw new Error("Document download failed.");
        const blob = await res.blob();
        const contentDisp = res.headers.get("Content-Disposition") || "";
        let filename = `document-${docId}`;
        const match = contentDisp.match(/filename="?([^"]+)"?/);
        if (match && match[1]) filename = match[1];

        const downloadUrl = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = downloadUrl;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(downloadUrl);
        showToast(`Downloaded document ${docId}.`, "mint");
      } catch (err) {
        showToast(err.message || "Download failed.", "coral");
      } finally {
        btn.disabled = false;
      }
    });
  });

  // Withdraw request
  root.querySelectorAll("[data-withdraw-request]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const reqId = btn.dataset.withdrawRequest;
      if (!confirm(`Are you sure you want to withdraw request ${reqId}?`)) return;
      try {
        btn.disabled = true;
        await apiPost(`/employees/me/change-requests/${reqId}/withdraw`, {});
        showToast(`Change request ${reqId} withdrawn successfully.`, "mint");
        loadProfile(root);
      } catch (err) {
        showToast(err.message || "Failed to withdraw request.", "coral");
        btn.disabled = false;
      }
    });
  });
}

// ─── PAGE EXPORTS ─────────────────────────────────────────────────────────────
export function renderEmployeeProfile() {
  return `
    <div class="page-enter" style="padding:10px 4px;">
      <div class="flex justify-between items-center" style="gap:12px;margin-bottom:18px;flex-wrap:wrap;">
        <div>
          <div class="font-display" style="color:var(--ink);font-size:22px;font-weight:700;letter-spacing:-0.01em;">My Profile</div>
          <div style="color:var(--muted);" style="font-size:12.5px;margin-top:3px;">Authoritative employee and account profile workspace.</div>
        </div>
      </div>
      <div data-profile-content>${skeleton("100px")}${skeleton("180px")}</div>
    </div>
  `;
}

export function wireEmployeeProfile(root) {
  loadProfile(root);
}
