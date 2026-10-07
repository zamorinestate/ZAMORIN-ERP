// =============================================================================
// ZAMORIN CAFE ERP — SHARED COMPONENTS (Design System v2: Ledger & Roastery)
// =============================================================================

import { NAVIGATION, ROLES, getGroupedNavItems } from "./navigation.js";
import { icon } from "./icons.js";
import { state, setState } from "./state.js";
import { navigate } from "./router.js";
import { forRole, unreadCount, markRead, markAllRead } from "./notifications.js";
import { apiGet, apiPost, clearAllAuthTokens, clearApiCacheAndInFlight } from "./apiClient.js";
import { setSettingsActiveSection } from "./pages/settingsShared.js";

const ROLE_LABELS = {
  [ROLES.MASTER]: "Master User",
  [ROLES.OWNER]: "Cafe Owner",
  [ROLES.CAFE_ADMIN]: "Cafe Operations",
  [ROLES.STAFF]: "Staff",
};

const ROLE_INITIALS = {
  [ROLES.MASTER]: "MU",
  [ROLES.OWNER]: "BO",
  [ROLES.CAFE_ADMIN]: "OP",
  [ROLES.STAFF]: "SA",
};

const SIDEBAR_COLLAPSED_KEY = "zamorin-sidebar-collapsed";

export function isSidebarCollapsed() {
  try {
    return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "true";
  } catch {
    return false;
  }
}

export function setSidebarCollapsed(collapsed) {
  try {
    localStorage.setItem(SIDEBAR_COLLAPSED_KEY, collapsed ? "true" : "false");
  } catch {}

  const shell = document.querySelector(".app-shell");
  const sidebar = document.getElementById("sidebar");
  if (shell) shell.classList.toggle("sidebar-collapsed", collapsed);
  if (sidebar) sidebar.classList.toggle("collapsed", collapsed);

  const toggleBtn = document.getElementById("sidebar-collapse-btn");
  if (toggleBtn) {
    toggleBtn.innerHTML = collapsed ? icon("chevronRight") : icon("chevronLeft");
    toggleBtn.title = collapsed ? "Expand Sidebar (Ctrl+[)" : "Collapse Sidebar (Ctrl+[)";
  }
}

/* -------------------------------------------------------------------------
   Sidebar — Design System v2 Navigation (Grouped, Retractable & Accessible)
   ------------------------------------------------------------------------- */
export function renderSidebar() {
  const isPrimary = Boolean(
    state.auth?.user?.isPrimaryMaster ||
    state.user?.isPrimaryMaster
  );
  const currentRole = state.role || ROLES.MASTER;
  const grouped = getGroupedNavItems(currentRole, isPrimary);
  const user = state.auth?.user || state.user || {};
  const collapsed = isSidebarCollapsed();

  let rolePillLabel = ROLE_LABELS[currentRole] || "Workspace";
  if (currentRole === ROLES.MASTER) {
    rolePillLabel = isPrimary ? "Primary Master" : "Master (Operational)";
  }

  const sectionsHtml = Object.entries(grouped)
    .map(([groupName, items]) => {
      const itemsHtml = items
        .map((item) => {
          const active = state.route === item.route ? "active" : "";
          return `
            <button class="nav-link ${active}" data-route="${item.route}" data-navid="${item.id}" title="${item.label}" type="button">
              <span class="nav-icon">${icon(item.icon)}</span>
              <span class="nav-label">${item.label}</span>
            </button>`;
        })
        .join("");

      return `
        <div class="nav-group-section" style="margin-bottom:12px;">
          ${
            !collapsed && groupName !== "COMMAND"
              ? `<div class="nav-group-heading" style="font-size:10.5px;font-weight:700;letter-spacing:0.08em;color:var(--muted);text-transform:uppercase;padding:6px 12px 2px;opacity:0.75;">${groupName}</div>`
              : ""
          }
          <div class="nav-list">${itemsHtml}</div>
        </div>
      `;
    })
    .join("");

  return `
    <div class="sidebar-brand">
      <div class="brand-logo-wrap">
        <div class="brand-badge">Z</div>
        <div class="brand-text">
          <span class="brand-title">Zamorin</span>
          <span class="brand-subtitle">Estate Pvt. Ltd.</span>
        </div>
      </div>
      <button class="sidebar-toggle-btn" id="sidebar-collapse-btn" type="button" title="${collapsed ? "Expand Sidebar" : "Collapse Sidebar"}" aria-label="Toggle Sidebar">
        ${collapsed ? icon("chevronRight") : icon("chevronLeft")}
      </button>
    </div>

    <div class="sidebar-scope">
      <span class="scope-pill" style="font-size:11px;font-weight:700;letter-spacing:0.04em;">${rolePillLabel}</span>
    </div>

    <nav class="sidebar-nav" aria-label="Main Navigation" style="overflow-y:auto;">
      ${sectionsHtml}
    </nav>

    <div class="sidebar-footer">
      <div class="footer-user">
        <div class="user-avatar" title="${user.name || "Master"} (${rolePillLabel})">${ROLE_INITIALS[currentRole] || "ZU"}</div>
        <div class="user-info">
          <div class="user-name">${user.name || "Master Administrator"}</div>
          <div class="user-role">${user.email || "master@zamorin.cafe"}</div>
        </div>
      </div>
    </div>
  `;
}

export function updateSidebarActive(currentRoute) {
  const sb = document.getElementById("sidebar");
  if (!sb) return;
  const baseRoute = currentRoute ? currentRoute.split("/")[0] : "";
  sb.querySelectorAll(".nav-link").forEach((btn) => {
    const route = btn.dataset.route;
    const isActive =
      route === currentRoute ||
      (route === "settings" && (baseRoute === "settings" || currentRoute === "profile" || currentRoute === "employment" || currentRoute === "my-profile" || currentRoute === "my-employment")) ||
      (route === "cafe-ops-devices" && (baseRoute === "cafe-ops-devices" || baseRoute === "devices")) ||
      (route === "devices" && (baseRoute === "cafe-ops-devices" || baseRoute === "devices")) ||
      (route === "approvals" && (baseRoute === "approvals" || baseRoute === "tasks")) ||
      (route === "tasks" && (baseRoute === "approvals" || baseRoute === "tasks")) ||
      (route === "ledger" && (baseRoute === "ledger" || baseRoute === "personal-ledger")) ||
      (route === baseRoute && baseRoute !== "dashboard" && baseRoute !== "");
    btn.classList.toggle("active", Boolean(isActive));
  });
}

export function wireSidebar(root) {
  root.querySelectorAll(".nav-link").forEach((el) => {
    el.addEventListener("click", () => {
      navigate(el.dataset.route);
      closeMobileDrawer();
    });
  });

  const collapseBtn = root.querySelector("#sidebar-collapse-btn");
  if (collapseBtn) {
    collapseBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      setSidebarCollapsed(!isSidebarCollapsed());
    });
  }
}

/* -------------------------------------------------------------------------
   Topbar — Design System v2 Header with Persistent Cafe Context Bar
   ------------------------------------------------------------------------- */
export function renderTopbar({ scopeChip } = {}) {
  const currentTheme = document.documentElement.dataset.theme || "paper";
  const user = state.auth?.user || state.user || {};
  const role = state.role || ROLES.MASTER;
  const initials = user.name
    ? user.name.split(' ').filter(Boolean).map(n => n[0]).join('').slice(0, 2).toUpperCase()
    : (ROLE_INITIALS[role] || "ZU");
  const isStaff = role === ROLES.STAFF;
  const isCafeOps = role === ROLES.CAFE_ADMIN;

  // Dynamic online/offline badge for Cafe Operations Context Bar
  function getConnectivityBadge() {
    if (!navigator.onLine) {
      return `<span id="cafe-ops-connectivity-badge" class="status error" style="font-size:10px; padding:2px 6px; font-weight:700;">🔴 Offline</span>`;
    }
    return `<span id="cafe-ops-connectivity-badge" class="status success" style="font-size:10px; padding:2px 6px; font-weight:700;">🟢 Live</span>`;
  }

  let cafeScopeHtml = '';
  const isPrimaryMasterUser = Boolean(
    (state.auth?.user?.role === 'master' || state.user?.role === 'master' || state.role === 'master' || state.originalRole === 'master') &&
    (state.auth?.user?.isPrimaryMaster !== false && state.user?.isPrimaryMaster !== false && state.isPrimaryMaster !== false)
  );

  if (isPrimaryMasterUser) {
    const currentWs = state.activeWorkspace || (state.role === 'master' ? (state.isPrimaryMaster === false ? 'master-normal' : 'master-primary') : state.role);
    const cafeOptions = (state.cafes || []).map(c => `<option value="${c.cafeId || c.id || c.code}" ${(state.selectedCafeId === (c.cafeId || c.id || c.code)) ? 'selected' : ''}>☕ ${c.cafeId || c.id || c.code} · ${c.name || 'Outlet'}</option>`).join('');
    const empOptions = (state.employees || []).map(emp => `<option value="${emp.id || emp.employeeId || emp.userId}" ${(state.supervisedEmployeeId === (emp.id || emp.employeeId || emp.userId)) ? 'selected' : ''}>👤 ${emp.name || emp.fullName || emp.userId} (${emp.employeeId || emp.id || ''})</option>`).join('');

    cafeScopeHtml = `
      <div class="primary-master-topbar-controls" style="display:inline-flex; align-items:center; gap:6px; flex-wrap:wrap;">
        <div class="workspace-scope-dropdown">
          <select id="global-workspace-selector" class="select-scope" aria-label="Selected Workspace Window" style="font-weight:700;">
            <option value="master-primary" ${currentWs === 'master-primary' ? 'selected' : ''}>🛡️ Primary Master</option>
            <option value="owner" ${currentWs === 'owner' ? 'selected' : ''}>👑 Owner Portal</option>
            <option value="cafe_admin" ${currentWs === 'cafe_admin' ? 'selected' : ''}>☕ Café Operations</option>
            <option value="staff" ${currentWs === 'staff' ? 'selected' : ''}>👤 Staff Preview</option>
          </select>
        </div>
        <div class="cafe-scope-dropdown">
          <select id="global-cafe-selector" class="select-scope" aria-label="Selected Cafe Scope">
            <option value="ALL">🏠 All Cafés (Global Portfolio)</option>
            ${cafeOptions}
          </select>
        </div>
        <div class="supervised-employee-dropdown">
          <select id="global-supervised-employee-selector" class="select-scope" aria-label="Supervised Employee Scope">
            <option value="NONE" ${!state.supervisedEmployeeId ? 'selected' : ''}>👥 Supervise: None (Self)</option>
            ${empOptions}
          </select>
        </div>
      </div>
    `;
  } else if (isCafeOps) {
    const operatorName = user.name || "Operations Lead";
    const operatorId = user.userId || "";
    const cafeName = user.primaryCafeName || (state.currentCafeId ? `Outlet ${state.currentCafeId}` : "Assigned Outlet");
    const cafeId = user.primaryCafeId || state.currentCafeId || "";
    const todayStr = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });

    cafeScopeHtml = `
      <div class="cafe-ops-context-bar" style="display:inline-flex; align-items:center; flex-wrap:wrap; gap:8px; padding:4px 10px; border-radius:var(--radius-md); background:var(--bg-surface-2); border:1px solid var(--border-subtle); font-size:12px; color:var(--ink);">
        <span style="font-weight:700; display:inline-flex; align-items:center; gap:4px;"><span style="color:var(--color-accent-amber);">📍</span> ${cafeName}${cafeId ? ` (${cafeId})` : ''}</span>
        <span style="color:var(--muted); opacity:0.6;">·</span>
        <span style="color:var(--muted);">${todayStr}</span>
        <span style="color:var(--muted); opacity:0.6;">·</span>
        <span style="font-weight:600; color:var(--ink);">${operatorName}${operatorId ? ` <span style="font-size:10.5px; color:var(--muted); font-family:var(--font-mono);">(${operatorId})</span>` : ''}</span>
        <span style="color:var(--muted); opacity:0.6;">·</span>
        ${getConnectivityBadge()}
        <button class="btn btn-ghost" id="cafe-ops-switch-btn" type="button" style="font-size:11px; padding:2px 8px; margin-left:4px; font-weight:600; color:var(--color-accent-amber);" title="Switch to another authorized operator">Switch</button>
        <button class="btn btn-ghost" id="cafe-ops-lock-btn" type="button" style="font-size:11px; padding:2px 8px; font-weight:600; color:var(--muted);" title="Temporarily lock terminal">Lock</button>
      </div>
    `;
  } else if (isStaff) {
    cafeScopeHtml = `<div class="cafe-scope-context" style="display:inline-flex; align-items:center; gap:6px; padding:6px 12px; border-radius:var(--radius-md); background:var(--bg-surface-2); border:1px solid var(--border-subtle); font-size:12px; font-weight:600; color:var(--text-primary);">
        <span style="font-size:13px;">📍</span>
        <span>${user.primaryCafeName || (user.primaryCafeId ? `Outlet ${user.primaryCafeId}` : "Assigned Outlet")}</span>
      </div>`;
  } else {
    const cafeOptions = (state.cafes || []).map(c => `<option value="${c.cafeId || c.id || c.code}" ${(state.selectedCafeId === (c.cafeId || c.id || c.code)) ? 'selected' : ''}>☕ ${c.cafeId || c.id || c.code} · ${c.name || 'Outlet'}</option>`).join('');
    cafeScopeHtml = `<div class="cafe-scope-dropdown">
        <select id="global-cafe-selector" class="select-scope" aria-label="Selected Cafe Scope">
          <option value="ALL">🏠 All Cafés (Global Portfolio)</option>
          ${cafeOptions}
        </select>
      </div>`;
  }

  const searchPlaceholder = isStaff
    ? "Search attendance, payslips, requests..."
    : isCafeOps
    ? "Search this café…"
    : "Search modules, records, employees...";

  return `
    <div class="topbar-inner">
      <div class="topbar-left">
        <button class="topbar-action-btn sidebar-topbar-toggle" id="sidebar-toggle-btn" title="Toggle Navigation Sidebar (Ctrl+[)" aria-label="Toggle Sidebar" type="button">
          ${icon("menu")}
        </button>
        ${cafeScopeHtml}
      </div>

      <div class="topbar-centre">
        <div class="global-search-wrap">
          <span class="search-icon">${icon("search")}</span>
          <input type="text" id="topbar-search-input" placeholder="${searchPlaceholder}" autocomplete="off" />
          <kbd class="search-kbd">Ctrl+K</kbd>
          <div id="topbar-search-results" class="search-results-dropdown" style="display:none;"></div>
        </div>
      </div>

      <div class="topbar-right">
        ${state.isTrainingMode ? `
          <div class="training-mode-badge" style="display:inline-flex; align-items:center; gap:4px; padding:3px 8px; border-radius:var(--radius-sm); background:#fef3c7; border:1px solid #f59e0b; color:#92400e; font-size:11px; font-weight:700;">
            <span>🎓 Training Mode</span>
          </div>
        ` : ''}
        ${state.supervisedEmployeeId ? `
          <div class="supervised-preview-badge" style="display:inline-flex; align-items:center; gap:6px; padding:3px 10px; border-radius:var(--radius-sm); background:rgba(59,130,246,0.12); border:1px solid #3b82f6; color:#1d4ed8; font-size:11.5px; font-weight:700;">
            <span>👁️ Viewing employee record: <strong style="font-family:var(--font-mono);">${state.supervisedEmployeeId}</strong></span>
            <button id="exit-supervised-employee-btn" class="btn btn-ghost" type="button" style="padding:1px 6px; font-size:10.5px; height:auto; color:#1d4ed8; text-decoration:underline; font-weight:700; cursor:pointer;" title="Exit Employee Preview">Exit</button>
          </div>
        ` : ''}

        <!-- Live System Status Indicator -->
        <div class="system-status-indicator online" id="topbar-system-status" title="System Connected & Synced">
          <span style="font-size:10px;">●</span> Online
        </div>

        <!-- Theme Switcher Button -->
        <button class="topbar-action-btn" id="theme-btn" title="Change Appearance & Theme" type="button">
          ${icon("sun")}
        </button>

        <!-- Notification Bell Button -->
        <div class="notif-wrap">
          <button class="topbar-action-btn" id="notif-bell-btn" title="Notifications" type="button">
            ${icon("bell")}
            <span id="notif-bell-badge" class="badge-dot" style="display:none;"></span>
          </button>
        </div>

        <!-- User Profile Avatar Button -->
        <button class="profile-avatar-btn" id="profile-avatar-btn" type="button">
          <span class="avatar-text">${initials}</span>
        </button>
      </div>
    </div>

    <!-- Popovers Mount -->
    <div id="themePopover" class="popover theme-popover" style="display:none;">
      <div class="popover-head">
        <h4>Appearance &amp; Themes</h4>
      </div>
      <div class="theme-options">
        <button class="theme-opt-btn ${currentTheme === "paper" ? "selected" : ""}" data-theme-choice="paper">
          <span class="theme-color-dot" style="background:#faf9f5;border:1px solid #d7d0bd;"></span>
          <span class="theme-text">
            <strong>Paper (Default)</strong>
            <span>Warm porcelain light theme</span>
          </span>
        </button>
        <button class="theme-opt-btn ${currentTheme === "pearl" ? "selected" : ""}" data-theme-choice="pearl">
          <span class="theme-color-dot" style="background:#f7f0e2;border:1px solid #c99a5c;"></span>
          <span class="theme-text">
            <strong>Pearl</strong>
            <span>Warm parchment roastery light</span>
          </span>
        </button>
        <button class="theme-opt-btn ${currentTheme === "midnight" ? "selected" : ""}" data-theme-choice="midnight">
          <span class="theme-color-dot" style="background:#0e1729;border:1px solid #b17d38;"></span>
          <span class="theme-text">
            <strong>Midnight</strong>
            <span>Zamorin Navy brand dark mode</span>
          </span>
        </button>
        <button class="theme-opt-btn ${currentTheme === "noir" ? "selected" : ""}" data-theme-choice="noir">
          <span class="theme-color-dot" style="background:#0a0c10;border:1px solid #445064;"></span>
          <span class="theme-text">
            <strong>Noir</strong>
            <span>Charcoal high-contrast dark</span>
          </span>
        </button>
      </div>
    </div>

    <div id="notifPopover" class="popover notif-popover" style="display:none;">
      <div class="notif-popover-head">
        <div style="display:flex; justify-content:space-between; align-items:center; width:100%;">
          <div style="display:flex; align-items:center; gap:6px;">
            <span style="font-size:14px;">🔔</span>
            <h4 style="margin:0; font-size:14px; font-weight:700; color:var(--ink);">Notifications</h4>
          </div>
          <button class="btn btn-ghost btn-xs" id="popover-mark-all" style="font-size:11.5px; font-weight:600; padding:2px 8px;" type="button">Mark all read</button>
        </div>
        <div class="notif-tabs">
          <button class="notif-tab-btn active" data-notif-tab="all" type="button">All</button>
          <button class="notif-tab-btn" data-notif-tab="unread" type="button">Unread</button>
          <button class="notif-tab-btn" data-notif-tab="action" type="button">Action Required</button>
        </div>
      </div>
      <div id="notif-popover-list" class="notif-list"></div>
      <div class="popover-foot" style="padding:10px 14px; border-top:1px solid var(--line); background:var(--surface-sunken);">
        <button class="btn btn-sm btn-ghost btn-block" id="popover-view-all" style="font-size:12px; font-weight:600; justify-content:center;" type="button">Open Notification Centre →</button>
      </div>
    </div>

    <div id="profilePopover" class="popover profile-popover" style="display:none;">
      <div class="profile-card-top">
        <div class="user-avatar lg">${initials}</div>
        <div class="profile-details">
          <div class="user-name">${user.name || user.fullName || (isStaff ? "Staff Member" : isCafeOps ? "Café Administrator" : "Master Administrator")}</div>
          <div class="user-sub">${ROLE_LABELS[role] || (isStaff ? "Staff Member" : "Master Account")}${user.userId ? ` · ${user.userId}` : ""}</div>
          <div class="user-email">${user.email || ""}</div>
        </div>
      </div>
      <div class="popover-menu">
        <button class="popover-menu-item" data-profile-action="my-profile">
          ${icon("user")} My Profile
        </button>
        <button class="popover-menu-item" data-profile-action="my-employment">
          ${icon("payslip")} My Employment
        </button>
        <button class="popover-menu-item" data-profile-action="settings">
          ${icon("settings")} Preferences &amp; Settings
        </button>
        <button class="popover-menu-item" data-profile-action="security">
          ${icon("shield")} Security &amp; MFA
        </button>
        <button class="popover-menu-item" data-profile-action="lock-screen">
          ${icon("lock")} Lock Application
        </button>
        <div class="popover-divider"></div>
        <button class="popover-menu-item logout" data-profile-action="logout">
          ${icon("logout")} Sign Out
        </button>
      </div>
    </div>
  `;
}

export function updateBellBadge() {
  const badge = document.getElementById("notif-bell-badge");
  if (!badge) return;
  const count = unreadCount(state.role);
  if (count > 0) {
    badge.style.display = "block";
  } else {
    badge.style.display = "none";
  }
}

export function wireBell(root) {
  // Topbar sidebar collapse toggle & mobile drawer
  const sidebarToggleBtn = root.querySelector("#sidebar-toggle-btn");
  if (sidebarToggleBtn) {
    sidebarToggleBtn.addEventListener("click", () => {
      if (window.innerWidth <= 1024) {
        toggleMobileDrawer();
      } else {
        setSidebarCollapsed(!isSidebarCollapsed());
      }
    });
  }

  const menuBtn = root.querySelector("#mobile-menu-btn");
  if (menuBtn) {
    menuBtn.addEventListener("click", () => {
      toggleMobileDrawer();
    });
  }

  const overlay = document.getElementById("sidebar-overlay");
  if (overlay) {
    overlay.addEventListener("click", () => {
      closeMobileDrawer();
    });
  }

  // Cafe Operations Context Bar actions
  const switchBtn = root.querySelector("#cafe-ops-switch-btn");
  if (switchBtn) {
    switchBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      openSwitchOperatorModal();
    });
  }

  const lockBtn = root.querySelector("#cafe-ops-lock-btn");
  if (lockBtn) {
    lockBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      openOperatorLockModal();
    });
  }

  // Live online/offline badge update for CAFE_ADMIN Context Bar
  if (state.role === ROLES.CAFE_ADMIN) {
    const updateConnectivityBadge = () => {
      const badge = document.getElementById('cafe-ops-connectivity-badge');
      if (!badge) return;
      if (navigator.onLine) {
        badge.className = 'status success';
        badge.style.cssText = 'font-size:10px; padding:2px 6px; font-weight:700;';
        badge.textContent = '🟢 Live';
      } else {
        badge.className = 'status error';
        badge.style.cssText = 'font-size:10px; padding:2px 6px; font-weight:700;';
        badge.textContent = '🔴 Offline';
      }
    };
    window.addEventListener('online', updateConnectivityBadge);
    window.addEventListener('offline', updateConnectivityBadge);
  }

  // Global Workspace Window Selector (Primary Master 3-Way Topbar Shell)
  const globalWsSel = root.querySelector("#global-workspace-selector");
  if (globalWsSel) {
    globalWsSel.addEventListener("change", (e) => {
      const targetWs = e.target.value;
      if (!state.originalRole) {
        state.originalRole = state.role || ROLES.MASTER;
      }
      if (targetWs === "master-primary") {
        state.role = ROLES.MASTER;
        state.isPrimaryMaster = true;
        state.activeWorkspace = "master-primary";
        showToast("Switched workspace to Primary Master", "info");
        navigate("dashboard");
      } else if (targetWs === "owner") {
        state.role = ROLES.OWNER;
        state.activeWorkspace = "owner";
        showToast("Switched workspace to Owner Portal", "info");
        navigate("dashboard");
      } else if (targetWs === "cafe_admin") {
        state.role = ROLES.CAFE_ADMIN;
        state.activeWorkspace = "cafe_admin";
        showToast("Switched workspace to Café Operations", "info");
        navigate("pos");
      } else if (targetWs === "staff") {
        state.role = ROLES.STAFF;
        state.activeWorkspace = "staff";
        showToast("Switched workspace to Staff Self-Service Preview", "info");
        navigate("staff-home");
      }
    });
  }

  // Global Supervised Employee Selector
  const globalSupervisedSel = root.querySelector("#global-supervised-employee-selector");
  if (globalSupervisedSel) {
    if (state.supervisedEmployeeId) {
      globalSupervisedSel.value = state.supervisedEmployeeId;
    }
    // Asynchronously populate employees if empty
    if (!state.employees || !state.employees.length) {
      apiGet("/employees").then((res) => {
        const empList = res?.data?.employees || res?.data || [];
        if (Array.isArray(empList) && empList.length) {
          state.employees = empList;
          const currentVal = globalSupervisedSel.value;
          globalSupervisedSel.innerHTML = `
            <option value="NONE" ${!state.supervisedEmployeeId ? 'selected' : ''}>👥 Supervise: None (Self)</option>
            ${empList.map(emp => `<option value="${emp.id || emp.employeeId || emp.userId}" ${(state.supervisedEmployeeId === (emp.id || emp.employeeId || emp.userId)) ? 'selected' : ''}>👤 ${emp.name || emp.fullName || emp.userId} (${emp.employeeId || emp.id || ''})</option>`).join('')}
          `;
          if (currentVal && currentVal !== "NONE") {
            globalSupervisedSel.value = currentVal;
          }
        }
      }).catch(() => {});
    }

    globalSupervisedSel.addEventListener("change", (e) => {
      const empId = e.target.value;
      state.supervisedEmployeeId = empId === "NONE" ? null : empId;
      const optText = globalSupervisedSel.options[globalSupervisedSel.selectedIndex]?.textContent || empId;
      if (state.supervisedEmployeeId) {
        showToast(`Supervising employee: ${optText} (Session identity preserved)`, "info");
      } else {
        showToast("Supervised employee cleared (Personal/Self mode)", "info");
      }
      if (state.route) {
        navigate(state.route);
      }
    });

    const exitSupervisedBtn = root.querySelector("#exit-supervised-employee-btn");
    if (exitSupervisedBtn) {
      exitSupervisedBtn.addEventListener("click", () => {
        state.supervisedEmployeeId = null;
        globalSupervisedSel.value = "NONE";
        showToast("Exited employee supervision mode (Self)", "info");
        if (state.route) {
          navigate(state.route);
        }
      });
    }
  }

  // Global Café Scope Dropdown Selector
  const globalCafeSel = root.querySelector("#global-cafe-selector");
  if (globalCafeSel) {
    if (state.selectedCafeId) {
      globalCafeSel.value = state.selectedCafeId;
    }
    globalCafeSel.addEventListener("change", (e) => {
      const newCafeId = e.target.value;
      state.selectedCafeId = newCafeId;
      state.currentCafeId = (newCafeId && newCafeId !== "ALL") ? newCafeId : "";
      if (state.user) {
        state.user.primaryCafeId = (newCafeId && newCafeId !== "ALL") ? newCafeId : "";
        const selOpt = globalCafeSel.options[globalCafeSel.selectedIndex];
        const optText = selOpt ? selOpt.textContent.trim() : "";
        const cleanName = optText.includes("·") ? optText.split("·").slice(1).join("·").trim() : optText;
        state.user.primaryCafeName = cleanName || state.cafes?.find((c) => c.cafeId === newCafeId)?.name || newCafeId;
      }
      showToast(`Global café scope switched to ${newCafeId === "ALL" ? "All Cafés (Portfolio)" : newCafeId}`, "info");
      // Trigger navigation refresh to update the active page data under new cafe context
      if (state.route) {
        navigate(state.route);
      }
    });
  }

  // Theme switcher
  const themeBtn = root.querySelector("#theme-btn");
  const themePop = root.querySelector("#themePopover");
  if (themeBtn && themePop) {
    themeBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const isVisible = themePop.classList.contains("open") || themePop.style.display === "block";
      closeAllPopovers();
      if (!isVisible) {
        themePop.style.display = "block";
        themePop.classList.add("open");
      }
    });

    themePop.querySelectorAll("[data-theme-choice]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const theme = btn.dataset.themeChoice;
        document.documentElement.dataset.theme = theme;
        localStorage.setItem("zamorin-theme", theme);
        themePop.querySelectorAll("[data-theme-choice]").forEach((b) => b.classList.remove("selected"));
        btn.classList.add("selected");
        themePop.style.display = "none";
        themePop.classList.remove("open");
        showToast(`Theme updated to ${theme.toUpperCase()}`);
      });
    });
  }

  // Notification Bell
  const notifBtn = root.querySelector("#notif-bell-btn");
  const notifPop = root.querySelector("#notifPopover");
  let activeNotifTab = "all";

  if (notifBtn && notifPop) {
    notifBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const isVisible = notifPop.classList.contains("open") || notifPop.style.display === "block";
      closeAllPopovers();
      if (!isVisible) {
        renderNotifList(notifPop, activeNotifTab);
        notifPop.style.display = "block";
        notifPop.classList.add("open");
      }
    });

    notifPop.querySelectorAll(".notif-tab-btn").forEach((tabBtn) => {
      tabBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        notifPop.querySelectorAll(".notif-tab-btn").forEach((b) => b.classList.remove("active"));
        tabBtn.classList.add("active");
        activeNotifTab = tabBtn.dataset.notifTab || "all";
        renderNotifList(notifPop, activeNotifTab);
      });
    });

    const markAllBtn = notifPop.querySelector("#popover-mark-all");
    if (markAllBtn) {
      markAllBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        markAllRead(state.role);
        updateBellBadge();
        renderNotifList(notifPop, activeNotifTab);
        showToast("All notifications marked as read");
      });
    }

    const viewAllBtn = notifPop.querySelector("#popover-view-all");
    if (viewAllBtn) {
      viewAllBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        notifPop.style.display = "none";
        notifPop.classList.remove("open");
        navigate("notifications");
      });
    }
  }

  // Profile Menu
  const profileBtn = root.querySelector("#profile-avatar-btn");
  const profilePop = root.querySelector("#profilePopover");
  if (profileBtn && profilePop) {
    profileBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const isVisible = profilePop.classList.contains("open") || profilePop.style.display === "block";
      closeAllPopovers();
      if (!isVisible) {
        profilePop.style.display = "block";
        profilePop.classList.add("open");
      }
    });

    profilePop.querySelectorAll("[data-profile-action]").forEach((btn) => {
      btn.addEventListener("click", async (e) => {
        e.stopPropagation();
        const action = btn.dataset.profileAction;
        profilePop.style.display = "none";
        profilePop.classList.remove("open");
        if (action === "logout") {
          try {
            await apiPost("/auth/logout");
          } catch {}
          clearAllAuthTokens();
          clearApiCacheAndInFlight();
          window.location.hash = "#login";
          window.location.reload();
        } else if (action === "my-profile") {
          setSettingsActiveSection("profile");
          navigate(state.role === ROLES.STAFF ? "staff-settings" : "settings");
        } else if (action === "my-employment") {
          setSettingsActiveSection("employment");
          navigate(state.role === ROLES.STAFF ? "staff-settings" : "settings");
        } else if (action === "security") {
          setSettingsActiveSection("security");
          navigate(state.role === ROLES.STAFF ? "staff-settings" : "settings");
        } else if (action === "settings") {
          setSettingsActiveSection("overview");
          navigate(state.role === ROLES.STAFF ? "staff-settings" : "settings");
        } else if (action === "lock-screen") {
          openApplicationLockModal();
        }
      });
    });
  }

  // Global Smart Search with Grouped Recommendations & Keyboard Navigation
  const searchInput = root.querySelector("#topbar-search-input");
  const searchResults = root.querySelector("#topbar-search-results");
  let highlightedSearchIndex = -1;

  function renderDefaultSearchSuggestions() {
    if (!searchResults) return;
    const isStaff = state.role === ROLES.STAFF;
    const isOwner = state.role === ROLES.OWNER;
    const isCafeOps = state.role === ROLES.CAFE_ADMIN;

    const frequentModules = isStaff
      ? [
          { title: "My Attendance & Shifts", subtitle: "Clock in/out & history", route: "staff-attendance" },
          { title: "Leave & Time Off", subtitle: "Submit leave request", route: "staff-leave" },
        ]
      : isOwner
      ? [
          { title: "Tasks & Oversight", subtitle: "High-priority approvals", route: "tasks" },
          { title: "Bills & Receipts", subtitle: "Financial document register", route: "bills" },
          { title: "Multi-Cafe Summary", subtitle: "Aggregated financial overview", route: "finance-summary" },
        ]
      : isCafeOps
      ? [
          { title: "POS & Billing", subtitle: "Active till & order capture", route: "pos" },
          { title: "Shift Attendance", subtitle: "Team shift clock-in", route: "attendance" },
          { title: "Daily Cash Book", subtitle: "Cash movements & reconciliations", route: "cashbook" },
        ]
      : [
          { title: "POS & Billing", subtitle: "Terminal operations", route: "pos" },
          { title: "Inventory Master", subtitle: "Stock levels & transfers", route: "inventory" },
          { title: "Procurement Orders", subtitle: "Purchase orders & approvals", route: "procurement" },
          { title: "Finance & Accounts", subtitle: "General ledger & vouchers", route: "finance" },
        ];

    let html = `<div class="search-group-title">Frequently Accessed</div>`;
    frequentModules.forEach((m) => {
      html += `
        <div class="search-item" data-search-route="${m.route}">
          <div class="search-item-title">${m.title}</div>
          <div class="search-item-sub">${m.subtitle}</div>
        </div>`;
    });

    searchResults.innerHTML = html;
    searchResults.style.display = "block";
    highlightedSearchIndex = -1;

    searchResults.querySelectorAll("[data-search-route]").forEach((el) => {
      el.addEventListener("click", () => {
        searchResults.style.display = "none";
        if (searchInput) searchInput.value = "";
        navigate(el.dataset.searchRoute);
      });
    });
  }

  if (searchInput && searchResults) {
    window.addEventListener("keydown", (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        searchInput.focus();
        searchInput.select();
        renderDefaultSearchSuggestions();
      }
    });

    searchInput.addEventListener("focus", () => {
      if (!searchInput.value.trim()) {
        renderDefaultSearchSuggestions();
      }
    });

    searchInput.addEventListener("keydown", (e) => {
      const items = searchResults.querySelectorAll(".search-item");
      if (!items.length || searchResults.style.display === "none") return;

      if (e.key === "ArrowDown") {
        e.preventDefault();
        highlightedSearchIndex = (highlightedSearchIndex + 1) % items.length;
        items.forEach((it, idx) => it.classList.toggle("highlighted", idx === highlightedSearchIndex));
        items[highlightedSearchIndex]?.scrollIntoView({ block: "nearest" });
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        highlightedSearchIndex = (highlightedSearchIndex - 1 + items.length) % items.length;
        items.forEach((it, idx) => it.classList.toggle("highlighted", idx === highlightedSearchIndex));
        items[highlightedSearchIndex]?.scrollIntoView({ block: "nearest" });
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (highlightedSearchIndex >= 0 && items[highlightedSearchIndex]) {
          items[highlightedSearchIndex].click();
        } else if (items[0]) {
          items[0].click();
        }
      } else if (e.key === "Escape") {
        searchResults.style.display = "none";
        highlightedSearchIndex = -1;
      }
    });

    let searchDebounce = null;
    searchInput.addEventListener("input", () => {
      clearTimeout(searchDebounce);
      const q = searchInput.value.trim();
      if (q.length < 1) {
        renderDefaultSearchSuggestions();
        return;
      }
      searchDebounce = setTimeout(async () => {
        try {
          const res = await apiGet(`/search?q=${encodeURIComponent(q)}`);
          const results = res?.data?.results || {};
          let html = "";
          for (const [group, list] of Object.entries(results)) {
            if (!list?.length) continue;
            html += `<div class="search-group-title">${group.replace(/_/g, " ")}</div>`;
            list.forEach((item) => {
              html += `
                <div class="search-item" data-search-route="${item.route}">
                  <div class="search-item-title">${item.title}</div>
                  <div class="search-item-sub">${item.subtitle || ""}</div>
                </div>`;
            });
          }
          if (!html) html = `<div class="search-empty">No matching records found</div>`;
          searchResults.innerHTML = html;
          searchResults.style.display = "block";
          highlightedSearchIndex = -1;

          searchResults.querySelectorAll("[data-search-route]").forEach((el) => {
            el.addEventListener("click", () => {
              searchResults.style.display = "none";
              searchInput.value = "";
              navigate(el.dataset.searchRoute);
            });
          });
        } catch {
          searchResults.style.display = "none";
        }
      }, 200);
    });
  }

  // System Status Live Connectivity Monitor
  const statusBadge = root.querySelector("#topbar-system-status");
  if (statusBadge) {
    const syncStatus = () => {
      if (navigator.onLine) {
        statusBadge.className = "system-status-indicator online";
        statusBadge.innerHTML = `<span style="font-size:10px;">●</span> Online`;
        statusBadge.title = "Backend API & Active Session Connected";
      } else {
        statusBadge.className = "system-status-indicator offline";
        statusBadge.innerHTML = `<span style="font-size:10px;">●</span> Offline`;
        statusBadge.title = "Network Disconnected — Retrying Connection";
      }
    };
    window.addEventListener("online", syncStatus);
    window.addEventListener("offline", syncStatus);
  }

  document.addEventListener("click", (e) => {
    if (!e.target.closest(".popover") && !e.target.closest(".topbar-action-btn") && !e.target.closest(".profile-avatar-btn")) {
      closeAllPopovers();
    }
    if (!e.target.closest(".global-search-wrap")) {
      if (searchResults) searchResults.style.display = "none";
    }
  });
}

function renderNotifList(popoverEl, filter = "all") {
  const host = popoverEl.querySelector("#notif-popover-list");
  if (!host) return;

  let items = forRole(state.role).sort((a, b) => b.createdAt - a.createdAt);

  if (filter === "unread") {
    items = items.filter((n) => !n.read);
  } else if (filter === "action") {
    items = items.filter((n) => n.priority === "CRITICAL" || n.priority === "HIGH" || n.category === "APPROVAL");
  }

  items = items.slice(0, 6);

  if (!items.length) {
    host.innerHTML = `<div class="notif-empty">${filter === "unread" ? "No unread notifications" : filter === "action" ? "No pending actions required" : "No notifications yet"}</div>`;
    return;
  }

  host.innerHTML = items
    .map(
      (n) => `
      <div class="notif-row ${n.read ? "read" : "unread"}" data-notif-id="${n.id}" data-deeplink="${n.deepLink || ""}">
        <div class="notif-row-header">
          <span class="notif-title">${n.title}</span>
          <span class="notif-time">${n.createdAt ? new Date(n.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : "Just now"}</span>
        </div>
        <div class="notif-desc">${n.message}</div>
      </div>`
    )
    .join("");

  host.querySelectorAll(".notif-row").forEach((row) => {
    row.addEventListener("click", () => {
      markRead(row.dataset.notifId);
      updateBellBadge();
      popoverEl.style.display = "none";
      if (row.dataset.deeplink) navigate(row.dataset.deeplink);
    });
  });
}

function closeAllPopovers(exceptEl = null) {
  document.querySelectorAll(".popover").forEach((p) => {
    if (p !== exceptEl) {
      p.style.display = "none";
      p.classList.remove("open");
    }
  });
}

export function openMobileDrawer() {
  document.getElementById("sidebar")?.classList.add("open");
  document.getElementById("sidebar-overlay")?.classList.add("open");
}

export function closeMobileDrawer() {
  document.getElementById("sidebar")?.classList.remove("open");
  document.getElementById("sidebar-overlay")?.classList.remove("open");
}

export function toggleMobileDrawer() {
  const sb = document.getElementById("sidebar");
  if (sb?.classList.contains("open")) {
    closeMobileDrawer();
  } else {
    openMobileDrawer();
  }
}

/* -------------------------------------------------------------------------
   Universal Modal Manager (Design System v2) — Accessible & Focus-Trapped
   ------------------------------------------------------------------------- */
let currentModalResolve = null;
let lastFocusedElementBeforeModal = null;
let activeModalKeydownHandler = null;

export function openModal(options = {}) {
  // Capture the element that triggered the modal for WCAG focus restoration
  lastFocusedElementBeforeModal = document.activeElement;
  closeModal();

  let root = document.getElementById("modal-root");
  if (!root) {
    root = document.createElement("div");
    root.id = "modal-root";
    document.body.appendChild(root);
  }

  const modalEl = document.createElement("div");
  modalEl.className = "modal-backdrop open";
  modalEl.id = "zamorin-global-modal";
  modalEl.setAttribute("role", "dialog");
  modalEl.setAttribute("aria-modal", "true");

  if (typeof options === "string") {
    modalEl.innerHTML = `
      <div class="modal-window" role="document" style="max-width:760px; max-height:85vh; overflow-y:auto; padding:24px; position:relative;">
        <button class="modal-close-btn" data-modal-cancel type="button" aria-label="Close"
          style="position:absolute; top:16px; right:16px; background:none; border:none; color:var(--muted); cursor:pointer; font-size:18px;">
          ${icon("x")}
        </button>
        ${options}
      </div>
    `;
  } else {
    const {
      title = "Action",
      body = options.body || options.content || "",
      saveLabel = "Save Changes",
      cancelLabel = "Cancel",
      onSave = null,
      onCancel = null,
      maxWidth = "560px",
    } = options;

    const titleId = "zamorin-modal-title-" + Math.random().toString(36).slice(2, 8);
    modalEl.setAttribute("aria-labelledby", titleId);

    modalEl.innerHTML = `
      <div class="modal-window" role="document" style="max-width:${maxWidth}">
        <div class="modal-header">
          <h3 class="modal-title" id="${titleId}">${title}</h3>
          <button class="modal-close-btn" data-modal-cancel type="button" aria-label="Close">
            ${icon("x")}
          </button>
        </div>
        <div class="modal-content">
          ${body}
        </div>
        <div class="modal-footer">
          <button class="btn btn-ghost" data-modal-cancel type="button">${cancelLabel}</button>
          <button class="btn btn-primary" data-modal-save type="button">${saveLabel}</button>
        </div>
      </div>
    `;

    const saveBtn = modalEl.querySelector("[data-modal-save]");
    if (saveBtn) {
      saveBtn.addEventListener("click", async () => {
        saveBtn.disabled = true;
        saveBtn.textContent = "Saving...";
        try {
          if (typeof onSave === "function") {
            const result = await onSave(modalEl);
            if (result !== false) closeModal();
          } else {
            closeModal();
          }
        } catch (err) {
          showToast(err?.message || "Operation failed", "coral");
        } finally {
          saveBtn.disabled = false;
          saveBtn.textContent = saveLabel;
        }
      });
    }
  }

  root.appendChild(modalEl);

  const cancelBtns = modalEl.querySelectorAll("[data-modal-cancel]");
  cancelBtns.forEach((b) =>
    b.addEventListener("click", () => {
      closeModal();
      if (typeof options.onCancel === "function") options.onCancel();
    })
  );

  modalEl.addEventListener("click", (e) => {
    if (e.target === modalEl) {
      closeModal();
      if (typeof options.onCancel === "function") options.onCancel();
    }
  });

  // WCAG 2.2 Focus Trap and Escape Key Handler
  activeModalKeydownHandler = (e) => {
    if (e.key === "Escape") {
      closeModal();
      if (typeof options.onCancel === "function") options.onCancel();
      return;
    }

    if (e.key === "Tab") {
      const focusableElements = Array.from(
        modalEl.querySelectorAll(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
      ).filter((el) => el.offsetParent !== null || el.offsetWidth > 0 || el.offsetHeight > 0);

      if (focusableElements.length === 0) {
        e.preventDefault();
        return;
      }

      const firstElement = focusableElements[0];
      const lastElement = focusableElements[focusableElements.length - 1];

      if (e.shiftKey) {
        if (document.activeElement === firstElement || !modalEl.contains(document.activeElement)) {
          lastElement.focus();
          e.preventDefault();
        }
      } else {
        if (document.activeElement === lastElement || !modalEl.contains(document.activeElement)) {
          firstElement.focus();
          e.preventDefault();
        }
      }
    }
  };
  document.addEventListener("keydown", activeModalKeydownHandler);

  modalEl.close = closeModal;

  // Focus entry into modal (first editable field or primary action)
  setTimeout(() => {
    const initialTarget = modalEl.querySelector("input, select, textarea, button.btn-primary, button[data-modal-save], button.modal-close-btn");
    initialTarget?.focus();
  }, 60);

  return modalEl;
}

export function closeModal() {
  if (activeModalKeydownHandler) {
    document.removeEventListener("keydown", activeModalKeydownHandler);
    activeModalKeydownHandler = null;
  }
  const existing = document.getElementById("zamorin-global-modal");
  if (existing) existing.remove();

  // Restore focus to opener element
  if (lastFocusedElementBeforeModal && typeof lastFocusedElementBeforeModal.focus === "function") {
    try {
      lastFocusedElementBeforeModal.focus();
    } catch (_) {}
    lastFocusedElementBeforeModal = null;
  }
}

/* -------------------------------------------------------------------------
   Confirmation Dialog
   ------------------------------------------------------------------------- */
export function confirmAction({
  title = "Confirm Action",
  description = "Are you sure you want to proceed with this operation?",
  confirmLabel = "Confirm",
  danger = false,
  onConfirm,
}) {
  openModal({
    title,
    body: `<p style="font-size:14px;line-height:1.6;color:var(--muted);margin:0;">${description}</p>`,
    saveLabel: confirmLabel,
    cancelLabel: "Cancel",
    maxWidth: "440px",
    onSave: async () => {
      if (typeof onConfirm === "function") await onConfirm();
    },
  });
}

/* -------------------------------------------------------------------------
   Toast Notifications (Bottom Right Stack) — Premium Micro-Interactions
   ------------------------------------------------------------------------- */
let lastToastMessage = "";
let lastToastTimestamp = 0;

export function showToast(message, type = "mint", title = "") {
  if (!message) return;
  const now = Date.now();
  // Duplicate suppression within 1200ms
  if (message === lastToastMessage && now - lastToastTimestamp < 1200) {
    return;
  }
  lastToastMessage = message;
  lastToastTimestamp = now;

  let stack = document.getElementById("toast-root");
  if (!stack) {
    stack = document.createElement("div");
    stack.id = "toast-root";
    stack.className = "toast-stack";
    stack.setAttribute("aria-live", "polite");
    // Guard against document.body being null (e.g., during early module imports in test contexts)
    const mountTarget = document.body || document.documentElement;
    if (!mountTarget) return;
    mountTarget.appendChild(stack);
  }

  const toast = document.createElement("div");
  const normalizedType = type === "success" ? "mint" : type === "error" || type === "danger" ? "coral" : type === "warning" ? "amber" : type === "info" ? "cobalt" : type;
  toast.className = `toast-card toast-${normalizedType}`;

  // High-severity errors use role="alert", non-urgent messages use role="status"
  if (normalizedType === "coral") {
    toast.setAttribute("role", "alert");
  } else {
    toast.setAttribute("role", "status");
  }

  const iconMap = {
    mint: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="color:var(--accent-mint, #10b981); flex-shrink:0;"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>`,
    coral: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="color:var(--accent-coral, #ef4444); flex-shrink:0;"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>`,
    amber: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="color:var(--accent-amber, #f59e0b); flex-shrink:0;"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
    cobalt: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="color:var(--accent-cobalt, #3b82f6); flex-shrink:0;"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>`,
  };

  function escapeHtml(str) {
    if (typeof str !== 'string') return '';
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  const defaultTitles = {
    mint: "Success",
    coral: "Error",
    amber: "Attention",
    cobalt: "Information",
  };

  const displayTitle = title || defaultTitles[normalizedType] || "Notification";
  const iconSvg = iconMap[normalizedType] || iconMap.cobalt;

  toast.innerHTML = `
    <div class="toast-icon-wrap">${iconSvg}</div>
    <div class="toast-content-wrap">
      <div class="toast-header-row">
        <span class="toast-title-text">${displayTitle}</span>
        <span class="toast-time-text">Just now</span>
      </div>
      <div class="toast-body-text">${escapeHtml(message)}</div>
    </div>
    <button class="toast-close-btn" type="button" aria-label="Close notification">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
    </button>
  `;

  stack.appendChild(toast);
  const closeBtn = toast.querySelector(".toast-close-btn");
  const dismiss = () => {
    toast.classList.add("toast-leaving");
    setTimeout(() => toast.remove(), 280);
  };
  if (closeBtn) closeBtn.addEventListener("click", dismiss);

  setTimeout(dismiss, normalizedType === "coral" ? 6000 : 4200);
}

/* -------------------------------------------------------------------------
   Helper Components (KPI card, Empty state, Skeleton, Button State)
   ------------------------------------------------------------------------- */
export function kpiCard({ label, value, trend = "", trendType = "up", onClick }) {
  const trendClass = trendType === "up" ? "" : trendType === "down" ? " down" : "";
  return `
    <article class="card kpi-card ${onClick ? "interactive" : ""}" ${onClick ? `data-action="${onClick}"` : ""}>
      <div class="kpi-label">${label}</div>
      <div class="kpi-value">${value}</div>
      ${trend ? `<div class="trend${trendClass}"><small>${trend}</small></div>` : ""}
    </article>
  `;
}

export function emptyState({ title = "No records found", body = "", iconName = "box", actionLabel = null, actionId = null }) {
  return `
    <div class="empty-state-card" style="text-align:center; padding:36px 20px;">
      <div class="empty-icon" style="margin-bottom:12px; opacity:0.6;">${icon(iconName || "box")}</div>
      <h3 class="empty-title" style="font-size:16px; font-weight:700; color:var(--ink); margin:0 0 6px;">${title}</h3>
      ${body ? `<p class="empty-body" style="font-size:13.5px; color:var(--muted); margin:0 0 ${actionLabel ? "16px" : "0"}; line-height:1.5;">${body}</p>` : ""}
      ${actionLabel ? `<button class="btn btn-secondary btn-sm" id="${actionId || "btn-empty-state-action"}" type="button">${actionLabel}</button>` : ""}
    </div>
  `;
}

export function skeleton(height = "80px") {
  return `<div class="skeleton" style="height:${height};border-radius:var(--radius-md);" aria-busy="true"></div>`;
}

export function renderTableLoadingSkeleton(rows = 5, cols = 4) {
  return `
    <div class="table-skeleton-wrap" aria-busy="true" style="padding:16px; display:flex; flex-direction:column; gap:12px;">
      ${Array.from({ length: rows }).map(() => `
        <div style="display:grid; grid-template-columns:repeat(${cols}, 1fr); gap:16px;">
          ${Array.from({ length: cols }).map(() => `<div class="skeleton" style="height:28px; border-radius:var(--radius-xs);"></div>`).join("")}
        </div>
      `).join("")}
    </div>
  `;
}

export function setButtonBusy(btn, isBusy = true, busyText = "Processing...") {
  if (!btn) return;
  if (isBusy) {
    if (!btn.dataset.originalText) {
      btn.dataset.originalText = btn.innerHTML;
    }
    btn.disabled = true;
    btn.setAttribute("aria-busy", "true");
    btn.innerHTML = `<span class="spinner-sm" style="display:inline-block; width:14px; height:14px; border:2px solid currentColor; border-top-color:transparent; border-radius:50%; animation:spin 0.6s linear infinite; vertical-align:middle; margin-right:6px;"></span>${busyText}`;
  } else {
    btn.disabled = false;
    btn.removeAttribute("aria-busy");
    if (btn.dataset.originalText) {
      btn.innerHTML = btn.dataset.originalText;
      delete btn.dataset.originalText;
    }
  }
}

/* -------------------------------------------------------------------------
   Cafe Operations Modal Handlers (Lock & Switch Operator)
   ------------------------------------------------------------------------- */
export function openOperatorLockModal() {
  const user = state.auth?.user || state.user || {};
  const operatorName = user.name || "Operations Lead";
  const operatorId = user.userId || "";
  const cafeName = user.primaryCafeName || (state.currentCafeId ? `Outlet ${state.currentCafeId}` : "Assigned Outlet");
  const cafeId = user.primaryCafeId || state.currentCafeId || "";

  const content = `
    <div style="max-width:440px; margin:0 auto; padding:10px 0; text-align:center;">
      <div style="width:56px; height:56px; border-radius:50%; background:var(--bg-surface-2); display:flex; align-items:center; justify-content:center; margin:0 auto 16px; font-size:24px; border:1px solid var(--border-subtle);">
        🔒
      </div>
      <h3 style="font-size:18px; font-weight:800; color:var(--ink); margin:0 0 6px;">Terminal Locked</h3>
      <p style="font-size:12.5px; color:var(--muted); margin:0 0 20px;">
        Zamorin Cafe Operations · <strong>${cafeName} (${cafeId})</strong>
      </p>

      <div style="background:var(--bg-subtle, #faf8f5); border:1px solid var(--border-subtle); border-radius:var(--radius-md); padding:14px; margin-bottom:20px; display:flex; align-items:center; justify-content:space-between; text-align:left;">
        <div>
          <div style="font-size:11px; font-weight:700; color:var(--muted); text-transform:uppercase;">Active Operator</div>
          <div style="font-size:14px; font-weight:700; color:var(--ink);">${operatorName}</div>
        </div>
        <span class="status info" style="font-family:var(--font-mono); font-size:11px; font-weight:700;">${operatorId}</span>
      </div>

      <div class="form-group" style="text-align:left; margin-bottom:20px;">
        <label class="label" style="font-weight:700;">Enter 6-Digit Operator PIN*</label>
        <div style="position:relative; display:flex; align-items:center;">
          <input type="password" id="lock-pin-input" class="input" placeholder="••••••" maxlength="6" inputmode="numeric" style="width:100%; font-size:22px; letter-spacing:8px; text-align:center; font-family:var(--font-mono); height:48px; padding-right:42px; box-sizing:border-box;" autofocus required />
          <button type="button" class="pin-visibility-toggle" data-toggle-visibility="lock-pin-input" title="Show PIN" aria-label="Show PIN">
            ${icon("eye", 16)}
          </button>
        </div>
      </div>

      <div style="display:flex; flex-direction:column; gap:10px;">
        <button class="btn btn-primary" id="lock-unlock-btn" type="button" style="height:44px; font-weight:700; font-size:14px;">Unlock Terminal</button>
        <button class="btn btn-ghost" id="lock-switch-btn" type="button" style="font-size:12.5px; color:var(--muted);">Switch to Different Operator</button>
      </div>
    </div>
  `;

  openModal(content);
  const modalEl = document.getElementById("zamorin-global-modal");
  const pinInput = modalEl?.querySelector("#lock-pin-input");

  modalEl?.querySelector("[data-toggle-visibility=\"lock-pin-input\"]")?.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    const btn = e.currentTarget;
    if (!pinInput) return;
    const isPwd = pinInput.type === "password";
    pinInput.type = isPwd ? "text" : "password";
    btn.innerHTML = isPwd ? icon("eyeOff", 16) : icon("eye", 16);
    btn.setAttribute("title", isPwd ? "Hide PIN" : "Show PIN");
    btn.style.color = isPwd ? "var(--primary, #c9933b)" : "var(--muted)";
  });

  modalEl?.querySelector("#lock-unlock-btn")?.addEventListener("click", async () => {
    const pin = pinInput?.value?.trim();
    if (!pin || pin.length !== 6) {
      showToast("Please enter your 6-digit Operator PIN.", "error");
      return;
    }
    try {
      await apiPost("/cafe-operations/operator/unlock", { pin });
      showToast("Terminal unlocked.", "success");
      closeModal();
    } catch (err) {
      showToast(err.message || "Operator code not recognised.", "error");
      if (pinInput) pinInput.value = "";
    }
  });

  modalEl?.querySelector("#lock-switch-btn")?.addEventListener("click", () => {
    closeModal();
    openSwitchOperatorModal();
  });
}

/**
 * ACP-05E-02: Workstation App Lock & Personal Six-Digit Application PIN Unlock
 */
export function openApplicationLockModal() {
  const user = state.auth?.user || state.user || {};
  const userName = user.name || user.fullName || "User";
  const userEmail = user.email || "";

  const content = `
    <div style="max-width:440px; margin:0 auto; padding:10px 0; text-align:center;">
      <div style="width:56px; height:56px; border-radius:50%; background:var(--surface-sunken); display:flex; align-items:center; justify-content:center; margin:0 auto 16px; font-size:24px; border:1px solid var(--border-subtle);">
        🔒
      </div>
      <h3 style="font-size:18px; font-weight:800; color:var(--ink); margin:0 0 6px;">Application Locked</h3>
      <p style="font-size:12.5px; color:var(--muted); margin:0 0 16px;">
        Active Session: <strong>${userName}</strong> ${userEmail ? `(${userEmail})` : ""}
      </p>

      <div style="background:var(--surface-sunken); border:1px solid var(--line); border-radius:var(--radius-md, 8px); padding:12px 14px; margin-bottom:16px; text-align:left;">
        <div style="font-size:11px; font-weight:700; color:var(--muted); text-transform:uppercase;">Security Notice</div>
        <div style="font-size:12px; color:var(--ink); margin-top:2px;">
          Enter your personal 6-digit Application PIN to unlock this session.
        </div>
      </div>

      <div class="form-group" style="text-align:left; margin-bottom:16px;">
        <label class="label" style="font-weight:700; font-size:12px;">Six-Digit App PIN*</label>
        <div style="position:relative; display:flex; align-items:center;">
          <input type="password" id="app-lock-pin-input" class="input" placeholder="••••••" maxlength="6" inputmode="numeric" style="width:100%; font-size:22px; letter-spacing:8px; text-align:center; font-family:var(--font-mono); height:46px; padding-right:42px; box-sizing:border-box;" autofocus required />
          <button type="button" class="pin-visibility-toggle" data-toggle-visibility="app-lock-pin-input" title="Show PIN" aria-label="Show PIN">
            ${icon("eye", 16)}
          </button>
        </div>
        <div id="app-lock-error" style="color:var(--danger, #b23b35); font-size:12px; margin-top:6px; display:none;"></div>
      </div>

      <div style="display:flex; flex-direction:column; gap:8px;">
        <button class="btn btn-primary" id="app-lock-unlock-btn" type="button" style="height:42px; font-weight:700; font-size:13.5px;">Unlock Session</button>
        <button class="btn btn-ghost" id="app-lock-signout-btn" type="button" style="font-size:12px; color:var(--muted);">Sign in with Password</button>
      </div>
    </div>
  `;

  openModal(content);
  const modalEl = document.getElementById("zamorin-global-modal");
  const pinInput = modalEl?.querySelector("#app-lock-pin-input");
  const errEl = modalEl?.querySelector("#app-lock-error");

  modalEl?.querySelector("[data-toggle-visibility=\"app-lock-pin-input\"]")?.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    const btn = e.currentTarget;
    if (!pinInput) return;
    const isPwd = pinInput.type === "password";
    pinInput.type = isPwd ? "text" : "password";
    btn.innerHTML = isPwd ? icon("eyeOff", 16) : icon("eye", 16);
    btn.setAttribute("title", isPwd ? "Hide PIN" : "Show PIN");
    btn.style.color = isPwd ? "var(--primary, #c9933b)" : "var(--muted)";
  });

  const submitUnlock = async () => {
    const pin = pinInput?.value?.trim();
    if (!pin || pin.length !== 6) {
      if (errEl) { errEl.textContent = "Please enter your 6-digit Application PIN."; errEl.style.display = "block"; }
      return;
    }

    try {
      const unlockBtn = modalEl?.querySelector("#app-lock-unlock-btn");
      if (unlockBtn) { unlockBtn.disabled = true; unlockBtn.textContent = "Verifying..."; }
      await apiPost("/auth/app-pin/unlock", { pin });
      showToast("Application unlocked.", "mint");
      closeModal();
    } catch (err) {
      if (errEl) {
        errEl.textContent = err?.message || "Incorrect PIN.";
        errEl.style.display = "block";
      }
      if (pinInput) pinInput.value = "";
      const unlockBtn = modalEl?.querySelector("#app-lock-unlock-btn");
      if (unlockBtn) { unlockBtn.disabled = false; unlockBtn.textContent = "Unlock Session"; }
    }
  };

  modalEl?.querySelector("#app-lock-unlock-btn")?.addEventListener("click", submitUnlock);
  pinInput?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") submitUnlock();
  });

  modalEl?.querySelector("#app-lock-signout-btn")?.addEventListener("click", async () => {
    closeModal();
    try { await apiPost("/auth/logout"); } catch {}
    clearAllAuthTokens();
    clearApiCacheAndInFlight();
    window.location.hash = "#login";
    window.location.reload();
  });
}

export function openSwitchOperatorModal() {
  const user = state.auth?.user || state.user || {};
  const currentOperatorName = user.name || "Operations Lead";
  const cafeName = user.primaryCafeName || (state.currentCafeId ? `Outlet ${state.currentCafeId}` : "Assigned Outlet");
  const cafeId = user.primaryCafeId || state.currentCafeId || "";

  const content = `
    <div style="max-width:500px; margin:0 auto; padding:10px 0;">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px; border-bottom:1px solid var(--border-subtle); padding-bottom:12px;">
        <div>
          <h3 style="font-size:17px; font-weight:800; margin:0; color:var(--ink);">Switch Cafe Operator</h3>
          <p style="font-size:12px; color:var(--muted); margin:0;">Zamorin Cafe Operations · ${cafeName} (${cafeId})</p>
        </div>
        <span class="status warning" style="font-size:10.5px; font-weight:700;">HANDOVER</span>
      </div>

      <div style="background:var(--bg-subtle, #faf8f5); border:1px solid var(--border-subtle); border-radius:var(--radius-md); padding:12px; margin-bottom:16px; font-size:12.5px; color:var(--ink);">
        Outgoing Operator: <strong>${currentOperatorName}</strong>. Please ensure all active transactions or till floats are acknowledged before switching.
      </div>

      <div class="form-group">
        <label class="label">Incoming Operator User ID*</label>
        <input type="text" id="sw-operator-id" class="input" placeholder="e.g. AD-0002" required />
      </div>

      <div class="form-group">
        <label class="label">Incoming Operator 6-Digit PIN*</label>
        <div style="position:relative; display:flex; align-items:center;">
          <input type="password" id="sw-pin" class="input" placeholder="••••••" maxlength="6" inputmode="numeric" style="width:100%; font-size:18px; letter-spacing:6px; font-family:var(--font-mono); padding-right:42px; box-sizing:border-box;" required />
          <button type="button" class="pin-visibility-toggle" data-toggle-visibility="sw-pin" title="Show PIN" aria-label="Show PIN">
            ${icon("eye", 16)}
          </button>
        </div>
      </div>

      <div class="form-group">
        <label class="label">Shift / Handover Note (Optional)</label>
        <textarea id="sw-handover-note" class="input" rows="2" placeholder="e.g. Milk delivery received 12 cartons, till cash float counted ₹3,500"></textarea>
      </div>

      <div style="display:flex; justify-content:flex-end; gap:10px; margin-top:20px; border-top:1px solid var(--border-subtle); padding-top:14px;">
        <button class="btn btn-ghost" id="sw-cancel-btn" type="button">Cancel</button>
        <button class="btn btn-primary" id="sw-submit-btn" type="button">Authenticate &amp; Switch</button>
      </div>
    </div>
  `;

  openModal(content);
  const modalEl = document.getElementById("zamorin-global-modal");

  const swPinInput = modalEl?.querySelector("#sw-pin");
  modalEl?.querySelector("[data-toggle-visibility=\"sw-pin\"]")?.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    const btn = e.currentTarget;
    if (!swPinInput) return;
    const isPwd = swPinInput.type === "password";
    swPinInput.type = isPwd ? "text" : "password";
    btn.innerHTML = isPwd ? icon("eyeOff", 16) : icon("eye", 16);
    btn.setAttribute("title", isPwd ? "Hide PIN" : "Show PIN");
    btn.style.color = isPwd ? "var(--primary, #c9933b)" : "var(--muted)";
  });

  modalEl?.querySelector("#sw-cancel-btn")?.addEventListener("click", () => closeModal());
  modalEl?.querySelector("#sw-submit-btn")?.addEventListener("click", async () => {
    const newOperatorUserId = modalEl.querySelector("#sw-operator-id")?.value?.trim();
    const newPin = modalEl.querySelector("#sw-pin")?.value?.trim();
    const handoverNote = modalEl.querySelector("#sw-handover-note")?.value?.trim();

    if (!newOperatorUserId || !newPin || newPin.length !== 6) {
      showToast("Please enter valid operator ID and 6-digit PIN.", "error");
      return;
    }

    try {
      const res = await apiPost("/cafe-operations/operator/switch", {
        newOperatorUserId,
        newPin,
        handoverNote,
        deviceId: localStorage.getItem("zamorin_device_id") || state.user?.deviceId || "DEV-POS-01",
      });

      showToast(`Switched operator to ${res?.operatorSession?.operatorName || newOperatorUserId}`, "success");
      closeModal();

      // Update local state and refresh shell
      if (res?.operatorSession) {
        state.user = {
          ...state.user,
          userId: res.operatorSession.operatorUserId,
          name: res.operatorSession.operatorName,
        };
        const tb = document.getElementById("topbar");
        if (tb) {
          tb.innerHTML = renderTopbar();
          wireBell(tb);
        }
      }
    } catch (err) {
      showToast(err.message || "Operator code not recognised.", "error");
    }
  });
}

/* -------------------------------------------------------------------------
   Standardized Single-Café & Multi-Café Context Strip (Design System v2)
   ------------------------------------------------------------------------- */
export function renderCafeContextStrip({
  title = "",
  badge = "",
  selectedCafe = "ALL",
  onCafeChange = null,
  actionsHtml = "",
} = {}) {
  const isCafeOps = state.role === ROLES.CAFE_ADMIN;
  const user = state.auth?.user || state.user || {};
  const cafeName = user.primaryCafeName || (state.currentCafeId ? `Outlet ${state.currentCafeId}` : "Assigned Outlet");
  const cafeId = user.primaryCafeId || state.currentCafeId || "";
  const terminalId = user.terminalId || "TERM-01";
  const operatorName = user.name || "Duty Operator";
  const operatorId = user.userId || user.employeeId || "";

  if (isCafeOps) {
    return `
      <div class="glass-card" style="padding:12px 16px; margin-bottom:16px; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px; border-left:4px solid var(--gold-accent, #c9933e);">
        <div style="display:flex; align-items:center; gap:16px; flex-wrap:wrap;">
          <div style="display:flex; align-items:center; gap:8px;">
            <span style="font-size:16px;">📍</span>
            <div>
              <div style="font-size:13.5px; font-weight:800; color:var(--ink);">${cafeName}</div>
              <div style="font-size:11px; color:var(--muted); font-family:var(--font-mono);">${cafeId} · Single-Café Terminal Scope</div>
            </div>
          </div>
          <div style="height:24px; width:1px; background:var(--border-subtle);"></div>
          <div style="display:flex; align-items:center; gap:6px; font-size:12px; color:var(--ink);">
            <span style="color:var(--muted);">Terminal:</span>
            <strong style="font-family:var(--font-mono);">${terminalId}</strong>
          </div>
          <div style="height:24px; width:1px; background:var(--border-subtle);"></div>
          <div style="display:flex; align-items:center; gap:6px; font-size:12px; color:var(--ink);">
            <span style="color:var(--muted);">Operator:</span>
            <strong>${operatorName}</strong>
            <span class="status info" style="font-size:10px; font-weight:700; padding:1px 6px;">${operatorId}</span>
          </div>
        </div>
        <div style="display:flex; align-items:center; gap:10px;">
          <span class="status success" style="font-size:11px; font-weight:700; display:flex; align-items:center; gap:4px;">
            <span style="width:6px; height:6px; border-radius:50%; background:#10b981; display:inline-block;"></span>
            Device Bound &amp; Synced
          </span>
          ${actionsHtml}
        </div>
      </div>
    `;
  }

  // Master / Owner Multi-Café Switcher Header
  const effectiveCafe = selectedCafe || state.selectedCafeId || state.activeCafe || "ALL";
  const cafeOptions = (state.cafes || []).map(c => `<option value="${c.cafeId || c.id || c.code}" ${effectiveCafe === (c.cafeId || c.id || c.code) ? "selected" : ""}>📍 ${c.name || 'Outlet'} (${c.cafeId || c.id || c.code})</option>`).join('');

  return `
    <div class="glass-card" style="padding:12px 16px; margin-bottom:16px; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px;">
      <div style="display:flex; align-items:center; gap:12px;">
        <span style="font-size:16px;">🏢</span>
        <div>
          <div style="font-size:13.5px; font-weight:800; color:var(--ink);">Global Portfolio Control</div>
          <div style="font-size:11px; color:var(--muted);">Master Governance Across All Outlets</div>
        </div>
      </div>
      <div style="display:flex; align-items:center; gap:12px;">
        <select id="ctx-cafe-selector" class="input" style="height:36px; font-size:12.5px; padding:4px 10px; min-width:220px; font-weight:600;">
          <option value="ALL" ${effectiveCafe === "ALL" ? "selected" : ""}>🌐 All Cafés (Global Portfolio)</option>
          ${cafeOptions}
        </select>
        ${actionsHtml}
      </div>
    </div>
  `;
}

export function wireCafeContextStrip(root = document, onCafeChange = null) {
  const ctxCafeSel = root.querySelector ? root.querySelector("#ctx-cafe-selector") : null;
  if (!ctxCafeSel) return;

  const currentVal = state.selectedCafeId || state.activeCafe || "ALL";
  if (currentVal && ctxCafeSel.value !== currentVal) {
    ctxCafeSel.value = currentVal;
  }

  if (ctxCafeSel.dataset.wired === "true") return;
  ctxCafeSel.dataset.wired = "true";

  ctxCafeSel.addEventListener("change", (e) => {
    const newCafeId = e.target.value;
    state.selectedCafeId = newCafeId;
    state.currentCafeId = (newCafeId && newCafeId !== "ALL") ? newCafeId : "";
    state.activeCafe = newCafeId;

    if (state.user) {
      state.user.primaryCafeId = newCafeId === "ALL" ? "" : newCafeId;
      const foundCafe = (state.cafes || []).find(c => (c.cafeId || c.id || c.code) === newCafeId);
      state.user.primaryCafeName = newCafeId === "ALL" ? "All Cafés (Global Portfolio)" : (foundCafe?.name || `Outlet ${newCafeId}`);
    }

    // Sync with Topbar selector if present
    const topbarSel = document.getElementById("global-cafe-selector");
    if (topbarSel && topbarSel.value !== newCafeId) {
      topbarSel.value = newCafeId;
    }

    const foundCafe = (state.cafes || []).find(c => (c.cafeId || c.id || c.code) === newCafeId);
    const cafeLabel =
      newCafeId === "ALL"
        ? "All Cafés (Global Portfolio)"
        : (foundCafe ? `${foundCafe.name} (${foundCafe.cafeId || newCafeId})` : newCafeId);

    showToast(`Global Portfolio context switched to ${cafeLabel}.`, "info");

    if (typeof onCafeChange === "function") {
      onCafeChange(newCafeId);
    } else {
      // Re-trigger current page navigation to reload views under selected cafe
      const currentRoute = state.route || window.location.hash.replace("#", "") || "dashboard";
      window.dispatchEvent(new CustomEvent("zamorin:cafeChanged", { detail: { cafeId: newCafeId } }));
      // Rerender active page if router is loaded
      import("./router.js").then((m) => {
        if (m.navigate) m.navigate(currentRoute);
      }).catch(() => {});
    }
  });
}

/* -------------------------------------------------------------------------
   Universal Select / Dropdown Component Primitive (ZamorinSelect)
   ------------------------------------------------------------------------- */
export function createSelect(container, {
  options = [],
  value = "",
  placeholder = "Select an option...",
  searchable = false,
  onChange = null,
} = {}) {
  const host = typeof container === "string" ? document.querySelector(container) : container;
  if (!host) return null;

  let currentValue = value;
  let highlightedIndex = -1;
  let isOpen = false;

  const wrap = document.createElement("div");
  wrap.className = "zamorin-select-wrap";

  const selectedOpt = options.find((o) => o.value === currentValue) || null;
  const initialLabel = selectedOpt ? selectedOpt.label : placeholder;

  wrap.innerHTML = `
    <button class="zamorin-select-trigger" type="button" aria-haspopup="listbox" aria-expanded="false">
      <span class="zamorin-select-label">${initialLabel}</span>
      <span class="zamorin-select-chevron" style="font-size:10px; color:var(--muted); transition:transform 0.15s ease;">▼</span>
    </button>
    <div class="zamorin-select-menu" role="listbox">
      ${searchable ? `<div style="padding:4px;"><input type="text" class="form-input form-control-sm zamorin-select-search" placeholder="Search..." style="width:100%; font-size:12px; margin-bottom:4px;" /></div>` : ""}
      <div class="zamorin-select-options-list"></div>
    </div>
  `;

  const trigger = wrap.querySelector(".zamorin-select-trigger");
  const labelEl = wrap.querySelector(".zamorin-select-label");
  const chevron = wrap.querySelector(".zamorin-select-chevron");
  const menu = wrap.querySelector(".zamorin-select-menu");
  const optionsList = wrap.querySelector(".zamorin-select-options-list");
  const searchInput = wrap.querySelector(".zamorin-select-search");

  function renderOptions(filterText = "") {
    const filtered = options.filter((opt) => {
      if (!filterText) return true;
      return opt.label.toLowerCase().includes(filterText.toLowerCase()) ||
        (opt.subtitle && opt.subtitle.toLowerCase().includes(filterText.toLowerCase()));
    });

    if (!filtered.length) {
      optionsList.innerHTML = `<div style="padding:8px 12px; font-size:12px; color:var(--muted); text-align:center;">No options found</div>`;
      return;
    }

    optionsList.innerHTML = filtered
      .map(
        (opt, idx) => `
        <div class="zamorin-select-option ${opt.value === currentValue ? "selected" : ""} ${opt.disabled ? "disabled" : ""}"
             data-select-value="${opt.value}"
             data-select-index="${idx}"
             role="option"
             aria-selected="${opt.value === currentValue}">
          <span>${opt.label}</span>
          ${opt.subtitle ? `<span style="font-size:11px; color:var(--muted);">${opt.subtitle}</span>` : ""}
        </div>`
      )
      .join("");

    optionsList.querySelectorAll(".zamorin-select-option:not(.disabled)").forEach((optEl) => {
      optEl.addEventListener("click", (e) => {
        e.stopPropagation();
        setValue(optEl.dataset.selectValue);
        close();
      });
    });
  }

  function setValue(val) {
    currentValue = val;
    const opt = options.find((o) => o.value === val);
    if (opt) {
      labelEl.textContent = opt.label;
    } else {
      labelEl.textContent = placeholder;
    }
    renderOptions();
    if (typeof onChange === "function") {
      onChange(val);
    }
  }

  function open() {
    closeAllSelects();
    isOpen = true;
    wrap.classList.add("open");
    trigger.setAttribute("aria-expanded", "true");
    chevron.style.transform = "rotate(180deg)";

    // Viewport bounds check — open upward if near bottom
    const rect = wrap.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    if (spaceBelow < 280 && rect.top > 280) {
      wrap.classList.add("open-up");
    } else {
      wrap.classList.remove("open-up");
    }

    renderOptions();
    if (searchInput) {
      searchInput.value = "";
      setTimeout(() => searchInput.focus(), 50);
    }
  }

  function close() {
    isOpen = false;
    wrap.classList.remove("open");
    wrap.classList.remove("open-up");
    trigger.setAttribute("aria-expanded", "false");
    chevron.style.transform = "rotate(0deg)";
    highlightedIndex = -1;
  }

  trigger.addEventListener("click", (e) => {
    e.stopPropagation();
    if (isOpen) close();
    else open();
  });

  if (searchInput) {
    searchInput.addEventListener("input", () => {
      renderOptions(searchInput.value.trim());
    });
    searchInput.addEventListener("click", (e) => e.stopPropagation());
  }

  wrap.addEventListener("keydown", (e) => {
    const optEls = optionsList.querySelectorAll(".zamorin-select-option:not(.disabled)");
    if (!optEls.length) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!isOpen) {
        open();
        return;
      }
      highlightedIndex = (highlightedIndex + 1) % optEls.length;
      optEls.forEach((el, idx) => el.classList.toggle("highlighted", idx === highlightedIndex));
      optEls[highlightedIndex]?.scrollIntoView({ block: "nearest" });
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (!isOpen) {
        open();
        return;
      }
      highlightedIndex = (highlightedIndex - 1 + optEls.length) % optEls.length;
      optEls.forEach((el, idx) => el.classList.toggle("highlighted", idx === highlightedIndex));
      optEls[highlightedIndex]?.scrollIntoView({ block: "nearest" });
    } else if (e.key === "Enter") {
      if (isOpen && highlightedIndex >= 0 && optEls[highlightedIndex]) {
        e.preventDefault();
        optEls[highlightedIndex].click();
      }
    } else if (e.key === "Escape") {
      if (isOpen) {
        e.preventDefault();
        close();
        trigger.focus();
      }
    }
  });

  document.addEventListener("click", (e) => {
    if (!wrap.contains(e.target) && isOpen) {
      close();
    }
  });

  host.innerHTML = "";
  host.appendChild(wrap);

  return {
    getValue: () => currentValue,
    setValue,
    open,
    close,
  };
}

function closeAllSelects() {
  document.querySelectorAll(".zamorin-select-wrap.open").forEach((w) => {
    w.classList.remove("open", "open-up");
  });
}

/* -------------------------------------------------------------------------
   Universal Date Picker Component Primitive (ZamorinDatePicker)
   ------------------------------------------------------------------------- */
export function createDatePicker(container, {
  value = new Date().toISOString().slice(0, 10),
  placeholder = "YYYY-MM-DD",
  onChange = null,
  min = null,
  max = null,
} = {}) {
  const host = typeof container === "string" ? document.querySelector(container) : container;
  if (!host) return null;

  let currentDateStr = value;
  let viewDate = value ? new Date(value + "T00:00:00") : new Date();
  if (isNaN(viewDate.getTime())) viewDate = new Date();

  let isOpen = false;

  const wrap = document.createElement("div");
  wrap.className = "zamorin-datepicker-wrap";

  wrap.innerHTML = `
    <div style="position:relative; display:flex; align-items:center;">
      <input type="text" class="form-input zamorin-date-input" value="${currentDateStr || ""}" placeholder="${placeholder}" style="padding-right:32px; width:100%;" />
      <span class="zamorin-date-icon" style="position:absolute; right:10px; cursor:pointer; font-size:14px; color:var(--muted); user-select:none;">📅</span>
    </div>
    <div class="zamorin-calendar-popup">
      <div class="zamorin-cal-header">
        <button class="zamorin-cal-nav-btn" data-cal-nav="prev" type="button" title="Previous Month">◀</button>
        <div class="zamorin-cal-month-title"></div>
        <button class="zamorin-cal-nav-btn" data-cal-nav="next" type="button" title="Next Month">▶</button>
      </div>
      <div class="zamorin-cal-grid zamorin-cal-days-header">
        <span class="zamorin-cal-day-label">Su</span>
        <span class="zamorin-cal-day-label">Mo</span>
        <span class="zamorin-cal-day-label">Tu</span>
        <span class="zamorin-cal-day-label">We</span>
        <span class="zamorin-cal-day-label">Th</span>
        <span class="zamorin-cal-day-label">Fr</span>
        <span class="zamorin-cal-day-label">Sa</span>
      </div>
      <div class="zamorin-cal-grid zamorin-cal-dates-body"></div>
      <div class="zamorin-cal-footer">
        <button class="btn btn-sm btn-ghost" data-cal-action="today" type="button" style="font-size:11px; padding:2px 8px;">Today</button>
        <button class="btn btn-sm btn-ghost" data-cal-action="clear" type="button" style="font-size:11px; padding:2px 8px;">Clear</button>
      </div>
    </div>
  `;

  const input = wrap.querySelector(".zamorin-date-input");
  const iconEl = wrap.querySelector(".zamorin-date-icon");
  const monthTitle = wrap.querySelector(".zamorin-cal-month-title");
  const datesBody = wrap.querySelector(".zamorin-cal-dates-body");
  const prevBtn = wrap.querySelector('[data-cal-nav="prev"]');
  const nextBtn = wrap.querySelector('[data-cal-nav="next"]');
  const todayBtn = wrap.querySelector('[data-cal-action="today"]');
  const clearBtn = wrap.querySelector('[data-cal-action="clear"]');

  function renderCalendar() {
    const year = viewDate.getFullYear();
    const month = viewDate.getMonth();

    const monthNames = [
      "January", "February", "March", "April", "May", "June",
      "July", "August", "September", "October", "November", "December"
    ];

    monthTitle.textContent = `${monthNames[month]} ${year}`;

    const firstDayIndex = new Date(year, month, 1).getDay();
    const lastDate = new Date(year, month + 1, 0).getDate();
    const prevLastDate = new Date(year, month, 0).getDate();

    const todayStr = new Date().toISOString().slice(0, 10);

    let daysHtml = "";

    // Previous month filler days
    for (let x = firstDayIndex; x > 0; x--) {
      daysHtml += `<div class="zamorin-cal-day-cell other-month">${prevLastDate - x + 1}</div>`;
    }

    // Current month days
    for (let i = 1; i <= lastDate; i++) {
      const dayStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(i).padStart(2, "0")}`;
      const isSelected = dayStr === currentDateStr;
      const isToday = dayStr === todayStr;

      daysHtml += `
        <div class="zamorin-cal-day-cell ${isSelected ? "selected" : ""} ${isToday ? "today" : ""}" data-date="${dayStr}">
          ${i}
        </div>`;
    }

    // Next month filler days to complete 35/42 grid
    const totalCells = firstDayIndex + lastDate;
    const nextDays = totalCells <= 35 ? 35 - totalCells : 42 - totalCells;
    for (let j = 1; j <= nextDays; j++) {
      daysHtml += `<div class="zamorin-cal-day-cell other-month">${j}</div>`;
    }

    datesBody.innerHTML = daysHtml;

    datesBody.querySelectorAll(".zamorin-cal-day-cell[data-date]").forEach((cell) => {
      cell.addEventListener("click", (e) => {
        e.stopPropagation();
        setDate(cell.dataset.date);
        close();
      });
    });
  }

  function setDate(dateStr) {
    currentDateStr = dateStr;
    input.value = dateStr || "";
    if (dateStr) {
      viewDate = new Date(dateStr + "T00:00:00");
    }
    renderCalendar();
    if (typeof onChange === "function") {
      onChange(dateStr);
    }
  }

  function open() {
    closeAllDatePickers();
    isOpen = true;
    wrap.classList.add("open");

    // Viewport bounds check — open upward if near bottom
    const rect = wrap.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    if (spaceBelow < 320 && rect.top > 320) {
      wrap.classList.add("open-up");
    } else {
      wrap.classList.remove("open-up");
    }

    renderCalendar();
  }

  function close() {
    isOpen = false;
    wrap.classList.remove("open", "open-up");
  }

  input.addEventListener("focus", open);
  input.addEventListener("change", () => {
    setDate(input.value.trim());
  });

  iconEl.addEventListener("click", (e) => {
    e.stopPropagation();
    if (isOpen) close();
    else open();
  });

  prevBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    viewDate.setMonth(viewDate.getMonth() - 1);
    renderCalendar();
  });

  nextBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    viewDate.setMonth(viewDate.getMonth() + 1);
    renderCalendar();
  });

  todayBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    const today = new Date().toISOString().slice(0, 10);
    setDate(today);
    close();
  });

  clearBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    setDate("");
    close();
  });

  document.addEventListener("click", (e) => {
    if (!wrap.contains(e.target) && isOpen) {
      close();
    }
  });

  host.innerHTML = "";
  host.appendChild(wrap);

  return {
    getDate: () => currentDateStr,
    setDate,
    open,
    close,
  };
}

function closeAllDatePickers() {
  document.querySelectorAll(".zamorin-datepicker-wrap.open").forEach((w) => {
    w.classList.remove("open", "open-up");
  });
}

/* -------------------------------------------------------------------------
   Global Standard Page Header (Stage 3)
   ------------------------------------------------------------------------- */
export function renderPageHeader({
  title = "",
  subtitle = "",
  icon = "",
  badge = "",
  actionsHtml = "",
  metaHtml = "",
} = {}) {
  return `
    <header class="page-header-standard">
      <div class="page-title-group">
        <h1 class="page-title">
          ${icon ? `<span style="font-size:22px; display:inline-flex; align-items:center;">${icon}</span>` : ""}
          <span>${title}</span>
          ${badge ? `<span class="status info" style="font-size:11px; padding:2px 8px; border-radius:999px;">${badge}</span>` : ""}
        </h1>
        ${subtitle ? `<p class="page-subtitle">${subtitle}</p>` : ""}
        ${metaHtml ? `<div style="margin-top:4px;">${metaHtml}</div>` : ""}
      </div>
      ${actionsHtml ? `<div class="page-actions-cluster">${actionsHtml}</div>` : ""}
    </header>
  `;
}

/* -------------------------------------------------------------------------
   Universal Control-Centre Module Hub Component (Stage 3)
   ------------------------------------------------------------------------- */
export function renderModuleHub({
  title = "",
  subtitle = "",
  icon = "",
  scopeHtml = "",
  actionsHtml = "",
  sections = [], // array of { title, tiles: [{ id, route, title, subtitle, icon, badge, badgeType, onClick }] }
  kpis = [], // array of { label, value, delta, status }
  attentionHtml = "",
  contentHtml = "",
} = {}) {
  const headerHtml = renderPageHeader({
    title,
    subtitle,
    icon,
    actionsHtml,
  });

  const kpiGridHtml = kpis && kpis.length > 0 ? `
    <div class="kpi-metric-grid" style="margin-bottom:20px;">
      ${kpis.map((k) => `
        <div class="kpi-metric-card">
          <div class="kpi-label">${k.label}</div>
          <div class="kpi-value">${k.value}</div>
          ${k.delta || k.status ? `<div class="kpi-footer"><span>${k.delta || ""}</span> ${k.status ? `<strong>${k.status}</strong>` : ""}</div>` : ""}
        </div>
      `).join("")}
    </div>
  ` : "";

  const sectionsHtml = sections && sections.length > 0 ? sections.map((sec) => `
    <div class="module-hub-section">
      ${sec.title ? `<h3 class="module-hub-section-title">${sec.title}</h3>` : ""}
      <div class="module-tile-grid">
        ${sec.tiles.map((t) => `
          <a class="module-hub-tile" href="#${t.route || t.id}" data-hub-route="${t.route || t.id}" role="button" tabindex="0">
            <div class="module-tile-icon-box">
              ${t.icon || "📁"}
            </div>
            <div class="module-tile-content">
              <div class="module-tile-title-row">
                <span class="module-tile-title">${t.title}</span>
                ${t.badge ? `<span class="module-tile-badge ${t.badgeType || ""}">${t.badge}</span>` : ""}
              </div>
              ${t.subtitle ? `<span class="module-tile-sub">${t.subtitle}</span>` : ""}
            </div>
          </a>
        `).join("")}
      </div>
    </div>
  `).join("") : "";

  return `
    <div class="module-hub-container">
      ${scopeHtml ? `<div style="margin-bottom:4px;">${scopeHtml}</div>` : ""}
      ${headerHtml}
      ${kpiGridHtml}
      ${attentionHtml ? `<div style="margin-bottom:20px;">${attentionHtml}</div>` : ""}
      ${sectionsHtml}
      ${contentHtml ? `<div style="margin-top:16px;">${contentHtml}</div>` : ""}
    </div>
  `;
}

/* -------------------------------------------------------------------------
   Universal Dedicated Child Page Header (Visual Corrective Standard)
   ------------------------------------------------------------------------- */
export function renderChildHeader({
  parentTitle = "Module Overview",
  parentRoute = "",
  childTitle = "",
  childSubtitle = "",
  icon = "",
  badge = "",
  badgeType = "info",
  actionsHtml = "",
  backBtnId = "",
} = {}) {
  const cleanRoute = parentRoute.replace(/^#/, "");
  const defaultId = cleanRoute === "inventory" ? "inv-back-to-hub-btn" : `${cleanRoute}-back-to-hub-btn`;
  const primaryId = backBtnId || defaultId;
  return `
    <div class="child-page-header" style="margin-bottom: 20px;">
      <div class="child-breadcrumb" style="display:flex; align-items:center; gap:8px; font-size:12.5px; margin-bottom:12px; flex-wrap:wrap;">
        <a href="#${cleanRoute}" class="breadcrumb-parent-link" id="${primaryId}" data-${cleanRoute}-back-to-hub="true" data-inv-back-to-hub="true" data-back-to-hub="true">
          <span class="back-icon">←</span>
          <span>${parentTitle}</span>
        </a>
        <span style="color:var(--muted); font-size:13px; opacity:0.6;">/</span>
        <span style="color:var(--ink); font-weight:700; font-size:12px; background:var(--surface-sunken, rgba(0,0,0,0.03)); padding:4px 10px; border-radius:4px; border:1px solid var(--line);">${childTitle}</span>
      </div>
      <div style="display:flex; justify-content:space-between; align-items:flex-start; flex-wrap:wrap; gap:16px;">
        <div>
          <div style="display:flex; align-items:center; gap:10px;">
            <h1 class="page-title child-h1" style="font-size:24px; font-weight:800; color:var(--ink); margin:0;">
              ${icon ? `<span style="font-size:22px; margin-right:6px;">${icon}</span>` : ""}
              ${childTitle}
            </h1>
            ${badge ? `<span class="badge ${badgeType ? `badge-${badgeType}` : "badge-accent"}" style="font-size:11px; padding:2px 8px; font-weight:700;">${badge}</span>` : ""}
          </div>
          ${childSubtitle ? `<p class="page-subtitle child-sub" style="font-size:13.5px; color:var(--muted); margin:4px 0 0;">${childSubtitle}</p>` : ""}
        </div>
        ${actionsHtml ? `<div class="child-header-actions" style="display:flex; gap:10px; align-items:center; flex-wrap:wrap;">${actionsHtml}</div>` : ""}
      </div>
    </div>
  `;
}

/* -------------------------------------------------------------------------
   Universal Error & Recovery State Component
   ------------------------------------------------------------------------- */
export function renderModuleErrorState({
  title = "Unable to Load Data",
  message = "An error occurred while communicating with the service.",
  error = null,
  retryActionId = "btn-retry-module-action",
  retryLabel = "Retry",
  type = "generic",
} = {}) {
  let iconEmoji = "⚠️";
  let resolvedTitle = title;
  let resolvedMsg = message;
  let showSignIn = false;
  let showRetry = true;

  const errMsg = (error?.message || "").toLowerCase();
  const errCode = (error?.code || "").toLowerCase();
  const isSessionError =
    type === "session" ||
    errCode.includes("auth") ||
    errCode.includes("session") ||
    errMsg.includes("session") ||
    errMsg.includes("expired") ||
    errMsg.includes("unauthenticated") ||
    error?.status === 401;

  const isPermError =
    type === "permission" ||
    errCode.includes("forbidden") ||
    errCode.includes("permission") ||
    errMsg.includes("permission") ||
    error?.status === 403;

  const isNetworkError =
    type === "network" ||
    errCode.includes("network") ||
    errMsg.includes("network") ||
    errMsg.includes("fetch") ||
    errMsg.includes("connect");

  if (isSessionError) {
    iconEmoji = "🔒";
    resolvedTitle = "Session Expired";
    resolvedMsg = "Your sign-in session needs to be refreshed before data can be loaded.";
    showSignIn = true;
    showRetry = true;
  } else if (isPermError) {
    iconEmoji = "🚫";
    resolvedTitle = "Access Restricted";
    resolvedMsg = "You do not have the required permissions to view or manage this workspace.";
    showSignIn = false;
    showRetry = false;
  } else if (isNetworkError) {
    iconEmoji = "📡";
    resolvedTitle = "Network Unavailable";
    resolvedMsg = "Could not reach the Zamorin ERP service. Please check your connection.";
    showSignIn = false;
    showRetry = true;
  } else if (type === "server" || error?.status >= 500) {
    iconEmoji = "⚙️";
    resolvedTitle = "Service Temporarily Unavailable";
    resolvedMsg = "The ERP service encountered an unexpected error. Please try again.";
    showSignIn = false;
    showRetry = true;
  }

  return `
    <div class="card card-pad module-error-state" style="padding: 36px 24px; text-align: center; max-width: 560px; margin: 24px auto; background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius-md, 12px);">
      <div style="font-size: 36px; margin-bottom: 12px; line-height: 1;">${iconEmoji}</div>
      <h3 style="font-size: 18px; font-weight: 700; color: var(--ink); margin: 0 0 8px 0;">${resolvedTitle}</h3>
      <p style="font-size: 13.5px; color: var(--muted); margin: 0 0 20px 0; line-height: 1.5;">${resolvedMsg}</p>
      <div style="display: flex; gap: 10px; justify-content: center; align-items: center; flex-wrap: wrap;">
        ${showSignIn ? `
          <button class="btn btn-primary" data-error-signin type="button" style="font-weight: 700;">
            Sign In Again
          </button>
        ` : ""}
        ${showRetry ? `
          <button class="btn ${showSignIn ? "btn-secondary" : "btn-primary"}" ${retryActionId ? `id="${retryActionId}"` : ""} data-error-retry type="button" style="font-weight: 700;">
            ${retryLabel}
          </button>
        ` : ""}
      </div>
    </div>
  `;
}

/* -------------------------------------------------------------------------
   Universal Document & File Uploader Component (Design System v2)
   ------------------------------------------------------------------------- */
export function renderFileUploadZone({
  id = "document-file-upload",
  label = "Upload Document, Invoice or Receipt",
  acceptedTypes = ".pdf,.png,.jpg,.jpeg,.xlsx,.csv",
  maxSizeBytes = 15728640, // 15MB
  helpText = "Supported: PDF, PNG, JPG, XLSX (Max 15MB)",
  required = false,
  compact = false,
} = {}) {
  const zoneHeight = compact ? "100px" : "140px";
  return `
    <div class="file-upload-wrapper" id="${id}-wrapper" style="width:100%;">
      ${label ? `<label class="form-label" style="font-size:12px; font-weight:700; color:var(--ink); margin-bottom:6px; display:block;">${label} ${required ? '<span style="color:var(--color-accent-coral, #e05252)">*</span>' : ""}</label>` : ""}
      <div class="file-dropzone" id="${id}-dropzone" tabindex="0" role="button" aria-label="${label}"
        style="border:2px dashed var(--line-strong, rgba(200,157,92,0.35)); border-radius:var(--radius-md, 10px); padding:16px 14px; text-align:center; background:var(--surface-sunken, rgba(0,0,0,0.02)); cursor:pointer; transition:border-color 0.2s ease, background 0.2s ease; display:flex; flex-direction:column; align-items:center; justify-content:center; min-height:${zoneHeight}; position:relative;">
        <input type="file" id="${id}-input" accept="${acceptedTypes}" style="display:none;" />
        <div class="dropzone-empty-state" id="${id}-empty-state">
          <div style="font-size:26px; line-height:1; margin-bottom:6px; opacity:0.9;">📤</div>
          <div style="font-size:13px; font-weight:700; color:var(--ink); margin-bottom:4px;">
            Drag &amp; drop file here, or <span style="color:var(--brand-gold, #c89d5c); text-decoration:underline;">browse files</span>
          </div>
          <div style="font-size:11px; color:var(--muted);">${helpText}</div>
        </div>
        <div class="dropzone-file-preview" id="${id}-preview-state" style="display:none; width:100%; align-items:center; justify-content:space-between; gap:12px; padding:8px 12px; background:var(--surface); border:1px solid var(--line); border-radius:8px;">
          <div style="display:flex; align-items:center; gap:10px; overflow:hidden; text-align:left;">
            <div id="${id}-file-icon" style="font-size:22px; flex-shrink:0;">📄</div>
            <div style="overflow:hidden;">
              <div id="${id}-file-name" style="font-size:12.5px; font-weight:700; color:var(--ink); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:280px;">filename.pdf</div>
              <div id="${id}-file-size" style="font-size:11px; color:var(--muted);">0 KB · Ready to submit</div>
            </div>
          </div>
          <button type="button" id="${id}-remove-btn" class="btn btn-xs btn-ghost" style="color:var(--color-accent-coral, #e05252); font-weight:700; padding:4px 8px;" title="Remove file">
            ✕ Remove
          </button>
        </div>
      </div>
    </div>
  `;
}

export function wireFileUploadZone(rootEl, {
  id = "document-file-upload",
  maxSizeBytes = 15728640,
  onFileSelected = null,
  onFileRemoved = null,
} = {}) {
  const root = rootEl || document;
  const dropzone = root.querySelector(`#${id}-dropzone`);
  const fileInput = root.querySelector(`#${id}-input`);
  const emptyState = root.querySelector(`#${id}-empty-state`);
  const previewState = root.querySelector(`#${id}-preview-state`);
  const fileNameEl = root.querySelector(`#${id}-file-name`);
  const fileSizeEl = root.querySelector(`#${id}-file-size`);
  const fileIconEl = root.querySelector(`#${id}-file-icon`);
  const removeBtn = root.querySelector(`#${id}-remove-btn`);

  if (!dropzone || !fileInput) return;

  function handleFile(file) {
    if (!file) return;
    if (file.size > maxSizeBytes) {
      showToast(`File is too large (${(file.size / (1024 * 1024)).toFixed(1)} MB). Max limit is ${(maxSizeBytes / (1024 * 1024)).toFixed(0)} MB.`, "coral");
      return;
    }

    let iconEmoji = "📄";
    const ext = (file.name.split('.').pop() || "").toLowerCase();
    if (["png", "jpg", "jpeg", "webp", "gif"].includes(ext)) iconEmoji = "🖼️";
    else if (["pdf"].includes(ext)) iconEmoji = "📑";
    else if (["xlsx", "xls", "csv"].includes(ext)) iconEmoji = "📊";
    else if (["zip", "tar", "gz"].includes(ext)) iconEmoji = "🗜️";

    if (fileIconEl) fileIconEl.textContent = iconEmoji;
    if (fileNameEl) fileNameEl.textContent = file.name;
    if (fileSizeEl) fileSizeEl.textContent = `${(file.size / 1024).toFixed(1)} KB · Ready to submit`;

    if (emptyState) emptyState.style.display = "none";
    if (previewState) previewState.style.display = "flex";

    dropzone.dataset.hasFile = "true";
    dropzone.selectedFile = file;

    if (typeof onFileSelected === "function") {
      onFileSelected(file);
    }
  }

  function clearFile() {
    fileInput.value = "";
    if (emptyState) emptyState.style.display = "block";
    if (previewState) previewState.style.display = "none";
    dropzone.dataset.hasFile = "false";
    delete dropzone.selectedFile;

    if (typeof onFileRemoved === "function") {
      onFileRemoved();
    }
  }

  dropzone.addEventListener("click", (e) => {
    if (e.target === removeBtn || removeBtn?.contains(e.target)) {
      e.stopPropagation();
      clearFile();
      return;
    }
    fileInput.click();
  });

  dropzone.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      fileInput.click();
    }
  });

  fileInput.addEventListener("change", () => {
    if (fileInput.files && fileInput.files[0]) {
      handleFile(fileInput.files[0]);
    }
  });

  ["dragenter", "dragover"].forEach((eventName) => {
    dropzone.addEventListener(eventName, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropzone.style.borderColor = "var(--brand-gold, #c89d5c)";
      dropzone.style.background = "var(--surface-raised, rgba(200,157,92,0.08))";
    });
  });

  ["dragleave", "drop"].forEach((eventName) => {
    dropzone.addEventListener(eventName, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropzone.style.borderColor = "";
      dropzone.style.background = "";
    });
  });

  dropzone.addEventListener("drop", (e) => {
    if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFile(e.dataTransfer.files[0]);
    }
  });
}

export function openUniversalDocumentModal({
  title = "Upload Document / Receipt",
  subtitle = "Attach digital proofs, invoices, receipts or compliance certificates.",
  documentType = "INVOICE", // 'INVOICE' | 'RECEIPT' | 'CHALLAN' | 'CERTIFICATE' | 'KYC'
  allowedCategories = [
    { value: "INVOICE", label: "Vendor Tax Invoice" },
    { value: "RECEIPT", label: "Payment / Expense Receipt" },
    { value: "CHALLAN", label: "Delivery Challan / GRN Proof" },
    { value: "CERTIFICATE", label: "Compliance / FSSAI / Lab Certificate" },
    { value: "UTILITY_BILL", label: "Electricity / Water / Rent Bill" },
  ],
  onUploadSuccess = null,
} = {}) {
  const categoryOptions = allowedCategories
    .map((c) => `<option value="${c.value}" ${c.value === documentType ? "selected" : ""}>${c.label}</option>`)
    .join("");

  const modalContent = `
    <div style="display:flex; flex-direction:column; gap:16px;">
      <div style="font-size:12.5px; color:var(--muted); line-height:1.5;">${subtitle}</div>

      <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px;">
        <div>
          <label style="font-size:12px; font-weight:700; color:var(--ink); display:block; margin-bottom:4px;">Document Category *</label>
          <select id="u-doc-category" class="select" style="width:100%; font-size:12.5px;">
            ${categoryOptions}
          </select>
        </div>
        <div>
          <label style="font-size:12px; font-weight:700; color:var(--ink); display:block; margin-bottom:4px;">Document / Invoice #</label>
          <input type="text" id="u-doc-ref" class="input" placeholder="e.g. INV-2026-8841" style="width:100%; font-size:12.5px;" />
        </div>
      </div>

      <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px;">
        <div>
          <label style="font-size:12px; font-weight:700; color:var(--ink); display:block; margin-bottom:4px;">Vendor / Payee Name</label>
          <input type="text" id="u-doc-vendor" class="input" placeholder="e.g. Registered Vendor" style="width:100%; font-size:12.5px;" />
        </div>
        <div>
          <label style="font-size:12px; font-weight:700; color:var(--ink); display:block; margin-bottom:4px;">Total Amount (₹)</label>
          <input type="number" id="u-doc-amount" class="input" placeholder="0.00" step="0.01" style="width:100%; font-size:12.5px;" />
        </div>
      </div>

      <div>
        ${renderFileUploadZone({
          id: "u-doc-file",
          label: "Select Document File *",
          required: true,
          helpText: "PDF, PNG, JPG, JPEG, XLSX (Max 15MB)",
        })}
      </div>

      <div>
        <label style="font-size:12px; font-weight:700; color:var(--ink); display:block; margin-bottom:4px;">Notes / Description</label>
        <textarea id="u-doc-notes" class="input" rows="2" placeholder="Optional reference notes or line item details..." style="width:100%; font-size:12.5px; resize:none;"></textarea>
      </div>
    </div>
  `;

  const modal = openModal({
    title: `📤 ${title}`,
    body: modalContent,
    saveLabel: "Upload & Register Document",
    cancelLabel: "Cancel",
    maxWidth: "540px",
    onSave: async (modalEl) => {
      const dropzone = modalEl.querySelector("#u-doc-file-dropzone");
      const file = dropzone?.selectedFile;
      const ref = modalEl.querySelector("#u-doc-ref")?.value?.trim();
      const vendor = modalEl.querySelector("#u-doc-vendor")?.value?.trim();
      const amount = modalEl.querySelector("#u-doc-amount")?.value;
      const category = modalEl.querySelector("#u-doc-category")?.value;
      const notes = modalEl.querySelector("#u-doc-notes")?.value?.trim();

      if (!file) {
        showToast("Please choose or drag a document file to upload.", "coral");
        return false;
      }

      // Authoritative multipart/form-data transmission
      let serverDoc = null;
      try {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('relatedModule', options.relatedModule || 'PROCUREMENT');
        formData.append('relatedRecordId', options.relatedRecordId || ref || `DOC-${Date.now()}`);
        formData.append('documentType', category || documentType);
        formData.append('documentNumber', ref || '');
        formData.append('entityName', vendor || '');
        formData.append('amountPaisa', Math.round((parseFloat(amount) || 0) * 100));
        formData.append('notes', notes || '');
        if (options.cafeId) formData.append('cafeId', options.cafeId);

        const token = localStorage.getItem('zamorin_auth_token') || sessionStorage.getItem('zamorin_auth_token');
        const headers = {};
        if (token) headers['Authorization'] = `Bearer ${token}`;

        const uploadRes = await fetch('/api/v1/files/documents/attach', {
          method: 'POST',
          headers,
          body: formData,
        });
        const json = await uploadRes.json();
        if (!uploadRes.ok) {
          throw new Error(json?.message || json?.error?.message || 'File upload failed.');
        }
        serverDoc = json?.data;
      } catch (srvErr) {
        console.warn('Backend document registration notice:', srvErr?.message);
        showToast(srvErr?.message || 'Failed to upload document.', 'coral');
        return false;
      }

      showToast("Document recorded and secured in Document Hub!", "success");
      if (typeof onUploadSuccess === "function") {
        onUploadSuccess({
          file,
          fileName: file.name,
          fileSize: file.size,
          category,
          refNumber: ref || serverDoc?.documentNumber || `DOC-${Date.now().toString().slice(-6)}`,
          vendor: vendor || serverDoc?.entityName || "Direct Upload",
          amount: parseFloat(amount) || 0,
          notes,
          documentId: serverDoc?.documentId || null,
          uploadedAt: new Date().toISOString(),
        });
      }
      return true;
    },
  });

  wireFileUploadZone(modal, {
    id: "u-doc-file",
    onFileSelected: (file) => {
      // Auto-extract ref from filename if ref is empty
      const refInput = modal.querySelector("#u-doc-ref");
      if (refInput && !refInput.value) {
        const baseName = file.name.replace(/\.[^/.]+$/, "");
        if (baseName.length >= 3) {
          refInput.value = baseName.toUpperCase().slice(0, 20);
        }
      }
    },
  });

  return modal;
}

