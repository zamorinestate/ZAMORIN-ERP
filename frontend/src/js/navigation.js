// =============================================================================
// ZAMORIN CAFE ERP — NAVIGATION CONFIGURATION
//
// Per the Global Implementation Governance Layer:
//   - Each role's navigation is built from its OWN configuration.
//   - Items not listed for a role here are unreachable by that role anywhere.
//   - Navigation is structured in logical groups (COMMAND, OPERATIONS, PEOPLE,
//     FINANCE, COMMERCIAL, INSIGHTS, ADMINISTRATION, SYSTEM).
//   - Four-Persona Topology is enforced here and in
//     router.js — exactly 4 active personas (Primary Master, Owner, Cafe Operations, Staff).
//   - User-facing CAFE_ADMIN terminology is "Cafe Operations" / "Operator".
//   - My Profile, My Payslip → Avatar menu / Settings (not main sidebar).
//   - My Payslips, My Loans & Advances → Settings → My Employment (not STAFF sidebar).
//   - Trash Bin → Settings → Data & Recovery (not main sidebar).
//   - Department Orders = University/Department/C/o business orders (NOT kitchen).
//
// route:  the hash route this item renders
// group:  logical section label for the sidebar heading
// =============================================================================

export const ROLES = {
  MASTER: 'master',
  OWNER: 'owner',
  CAFE_ADMIN: 'cafe_admin',
  STAFF: 'staff',
  VENDOR: 'vendor',
};

// ─── Primary Master Navigation ────────────────────────────────────────────────
// Full access — every café, every module, every sensitive finance area.
const PRIMARY_MASTER_ITEMS = [
  // ── COMMAND ─────────────────────────────────────────────────────────────────
  { id: 'dashboard',     label: 'Command Centre',         icon: 'home',         route: 'dashboard',         group: 'COMMAND' },

  // ── OPERATIONS ──────────────────────────────────────────────────────────────
  { id: 'pos',           label: 'POS & Billing',          icon: 'pos',          route: 'pos',               group: 'OPERATIONS' },
  { id: 'channels',      label: 'Channels & Front Service', icon: 'pos',        route: 'channels',          group: 'OPERATIONS' },
  { id: 'approvals',     label: 'Tasks & Oversight',      icon: 'tasks',        route: 'approvals',         group: 'OPERATIONS' },
  { id: 'attendance',    label: 'Attendance & Shifts',    icon: 'attendance',   route: 'attendance',        group: 'OPERATIONS' },
  { id: 'dept-orders',   label: 'Department Orders',      icon: 'deptOrders',   route: 'dept-orders',       group: 'OPERATIONS' },
  { id: 'inventory',     label: 'Inventory',              icon: 'inventory',    route: 'inventory',         group: 'OPERATIONS' },
  { id: 'procurement',   label: 'Procurement',            icon: 'procurement',  route: 'procurement',       group: 'OPERATIONS' },
  { id: 'assets',        label: 'Assets & Maintenance',   icon: 'assets',       route: 'assets',            group: 'OPERATIONS' },
  { id: 'quality',       label: 'Quality & Compliance',   icon: 'quality',      route: 'quality',           group: 'OPERATIONS' },
  { id: 'mailops',       label: 'MailOps Communications', icon: 'announce',     route: 'mailops',           group: 'OPERATIONS', primaryMasterOnly: true },

  // ── PEOPLE ───────────────────────────────────────────────────────────────────
  { id: 'employees',     label: 'Employees',              icon: 'employees',    route: 'employees',         group: 'PEOPLE' },
  { id: 'staff-home',    label: 'Staff Self-Service',     icon: 'user',         route: 'staff-home',        group: 'PEOPLE' },
  { id: 'payroll',       label: 'Payroll & Payslips',     icon: 'payslip',      route: 'payroll',           group: 'PEOPLE', primaryMasterOnly: true },

  // ── FINANCE ──────────────────────────────────────────────────────────────────
  { id: 'bills',         label: 'Bills & Receipts',       icon: 'bills',        route: 'bills',             group: 'FINANCE' },
  { id: 'expenses',      label: 'Expenses',               icon: 'expenses',     route: 'expenses',          group: 'FINANCE' },
  { id: 'sales-cash',    label: 'Sales & Cash Book',      icon: 'finance',      route: 'sales-cash',        group: 'FINANCE' },
  { id: 'finance',       label: 'Finance & Accounts',     icon: 'finance',      route: 'finance',           group: 'FINANCE' },
  { id: 'passbook',      label: 'Passbook & Treasury',    icon: 'passbook',     route: 'passbook',          group: 'FINANCE', primaryMasterOnly: true },
  { id: 'ledger',        label: 'Personal Ledger & Owner Account', icon: 'ledger', route: 'ledger', group: 'FINANCE', primaryMasterOnly: true },

  // ── COMMERCIAL ───────────────────────────────────────────────────────────────
  { id: 'customers',     label: 'Customers & Loyalty',    icon: 'customers',    route: 'customers',         group: 'COMMERCIAL' },
  { id: 'menu',          label: 'Menu Management',        icon: 'menuItem',     route: 'menu',              group: 'COMMERCIAL' },
  { id: 'vendors',       label: 'Vendors',                icon: 'vendors',      route: 'vendors',           group: 'COMMERCIAL' },
  { id: 'revenue-share', label: 'Revenue Share & Outlets', icon: 'revenueShare', route: 'revenue-share',   group: 'COMMERCIAL', primaryMasterOnly: true },

  // ── INSIGHTS ─────────────────────────────────────────────────────────────────
  { id: 'reports',       label: 'Reports & Analytics',    icon: 'reports',      route: 'reports',           group: 'INSIGHTS' },
  { id: 'forecasts-insights', label: 'Forecasts & Insights', icon: 'reports', route: 'forecasts-insights', group: 'INSIGHTS' },
  { id: 'portfolio-governance', label: 'Portfolio Governance', icon: 'reports', route: 'portfolio-governance', group: 'INSIGHTS' },

  // ── ADMINISTRATION ───────────────────────────────────────────────────────────
  { id: 'admin',         label: 'Administration',         icon: 'admin',        route: 'admin',             group: 'ADMINISTRATION' },
  { id: 'onboarding-migration', label: 'Onboarding & Migration', icon: 'admin', route: 'onboarding-migration', group: 'ADMINISTRATION' },

  // ── SYSTEM ───────────────────────────────────────────────────────────────────
  { id: 'cafe-ops-devices', label: 'Devices & Sessions',  icon: 'devices',      route: 'cafe-ops-devices',  group: 'SYSTEM' },
  { id: 'system-health', label: 'System Health & Ops',    icon: 'settings',     route: 'system-health',     group: 'SYSTEM' },
  { id: 'settings',      label: 'Settings',               icon: 'settings',     route: 'settings',          group: 'SYSTEM' },
];

export const NAVIGATION = {
  // ── MASTER ───────────────────────────────────────────────────────────────────
  [ROLES.MASTER]: {
    scopeLabel: 'Primary Master',
    items: PRIMARY_MASTER_ITEMS,
    primaryItems: PRIMARY_MASTER_ITEMS,
    footnote: 'Primary Master — Full enterprise governance and operational control across all cafés.',
  },

  // ── OWNER ────────────────────────────────────────────────────────────────────
  [ROLES.OWNER]: {
    scopeLabel: 'Owner Portal',
    items: [
      { id: 'dashboard',    label: 'Overview',                icon: 'home',         route: 'dashboard',       group: 'COMMAND' },
      { id: 'approvals',    label: 'Tasks & Oversight',       icon: 'tasks',        route: 'approvals',       group: 'OPERATIONS' },
      { id: 'owner-food-safety', label: 'Food Safety & Recall', icon: 'quality',     route: 'owner-food-safety', group: 'OPERATIONS' },
      { id: 'owner-risk-audit',  label: 'Risk, Audit & Fraud Control', icon: 'shield', route: 'owner-risk-audit', group: 'GOVERNANCE' },
      { id: 'owner-planning',    label: 'Planning, Budget & CAPEX', icon: 'finance', route: 'owner-planning', group: 'GOVERNANCE' },
      { id: 'owner-compliance',  label: 'Compliance, Licence & Insurance', icon: 'tasks', route: 'owner-compliance', group: 'GOVERNANCE' },
      { id: 'owner-supplier-intelligence', label: 'Supplier & Procurement Intelligence', icon: 'procurement', route: 'owner-supplier-intelligence', group: 'GOVERNANCE' },
      { id: 'owner-academy',     label: 'SOP, Training & Academy',  icon: 'quality',     route: 'owner-academy',   group: 'GOVERNANCE' },
      { id: 'owner-asset-reliability', label: 'Asset Reliability & Maintenance', icon: 'assets', route: 'owner-asset-reliability', group: 'GOVERNANCE' },
      { id: 'owner-privacy-cyber', label: 'Privacy & Cybersecurity', icon: 'shield', route: 'owner-privacy-cyber', group: 'GOVERNANCE' },
      { id: 'owner-bcdr',        label: 'Continuity & Disaster Recovery', icon: 'refresh',   route: 'owner-bcdr', group: 'GOVERNANCE' },
      { id: 'owner-master-data', label: 'Master Data Governance',  icon: 'admin',     route: 'owner-master-data', group: 'GOVERNANCE' },
      { id: 'owner-complaints',  label: 'Complaints & Recovery',   icon: 'tasks',     route: 'owner-complaints',  group: 'OPERATIONS' },
      { id: 'owner-menu-pricing', label: 'Menu Engineering & Pricing', icon: 'finance', route: 'owner-menu-pricing', group: 'COMMERCIAL' },
      { id: 'owner-customer-loyalty', label: 'Customer & Loyalty Intelligence', icon: 'users', route: 'owner-customer-loyalty', group: 'COMMERCIAL' },
      { id: 'owner-utilities-waste', label: 'Utilities, Waste & Energy', icon: 'quality', route: 'owner-utilities-waste', group: 'OPERATIONS' },
      { id: 'owner-governance-delegation', label: 'Corporate Governance & Delegation', icon: 'shield', route: 'owner-governance-delegation', group: 'GOVERNANCE' },
      { id: 'owner-drilldown-dept-orders', label: 'Department Orders (Read-Only)', icon: 'deptOrders', route: 'dept-orders', group: 'OPERATIONS (READ-ONLY)' },
      { id: 'owner-drilldown-inventory',   label: 'Inventory (Read-Only)',         icon: 'inventory',  route: 'inventory',   group: 'OPERATIONS (READ-ONLY)' },
      { id: 'owner-drilldown-procurement', label: 'Procurement (Read-Only)',       icon: 'procurement',route: 'procurement', group: 'OPERATIONS (READ-ONLY)' },
      { id: 'owner-drilldown-expenses',    label: 'Expenses (Read-Only)',          icon: 'expenses',   route: 'expenses',    group: 'OPERATIONS (READ-ONLY)' },
      { id: 'owner-drilldown-customers',   label: 'Customers (Read-Only)',         icon: 'customers',  route: 'customers',   group: 'OPERATIONS (READ-ONLY)' },
      { id: 'owner-channels',              label: 'Channels & Tables (Read-Only)', icon: 'pos',        route: 'channels',    group: 'COMMERCIAL' },
      { id: 'bills',        label: 'Bills & Receipts',        icon: 'bills',        route: 'bills',           group: 'FINANCE' },
      { id: 'sales-cash',   label: 'Sales & Cash Book',       icon: 'finance',      route: 'sales-cash',      group: 'FINANCE' },
      { id: 'performance',  label: 'Café Performance',        icon: 'performance',  route: 'performance',     group: 'INSIGHTS' },
      { id: 'employees',    label: 'Employees',               icon: 'employees',    route: 'employees',       group: 'PEOPLE' },
      { id: 'attendance',   label: 'Attendance & Shifts',     icon: 'attendance',   route: 'attendance',      group: 'PEOPLE' },
      { id: 'finance',      label: 'Finance Summary',         icon: 'finance',      route: 'finance',         group: 'FINANCE' },
      { id: 'passbook',     label: 'Passbook & Treasury',     icon: 'passbook',     route: 'passbook',        group: 'FINANCE' },
      { id: 'ledger',       label: 'Personal Ledger & Owner Account', icon: 'ledger', route: 'ledger',       group: 'FINANCE' },
      { id: 'payroll',      label: 'Payroll & Payslips',      icon: 'payslip',      route: 'payroll',         group: 'PEOPLE' },
      { id: 'revenue-share',label: 'Revenue Share & Outlets', icon: 'revenueShare', route: 'revenue-share', group: 'COMMERCIAL' },
      { id: 'reports',      label: 'Reports',                 icon: 'reports',      route: 'reports',         group: 'INSIGHTS' },
      { id: 'forecasts-insights', label: 'Forecasts & Insights', icon: 'reports', route: 'forecasts-insights', group: 'INSIGHTS' },
      { id: 'portfolio-governance', label: 'Portfolio Governance', icon: 'reports', route: 'portfolio-governance', group: 'INSIGHTS' },
      { id: 'onboarding-migration', label: 'Onboarding & Migration', icon: 'reports', route: 'onboarding-migration', group: 'INSIGHTS' },
      { id: 'system-health',label: 'System Health & Ops',     icon: 'settings',     route: 'system-health',   group: 'SYSTEM' },
      { id: 'settings',     label: 'Settings',                icon: 'settings',     route: 'settings',        group: 'SYSTEM' },
    ],
    footnote: 'Owner Portal — strategic governance, executive metrics, and café oversight.',
  },

  // ── CAFE ADMIN (CAFE OPERATIONS) ─────────────────────────────────────────────
  [ROLES.CAFE_ADMIN]: {
    scopeLabel: 'Cafe Operations',
    items: [
      { id: 'dashboard',    label: 'Cafe Operations Dashboard', icon: 'home',       route: 'dashboard',       group: 'COMMAND' },
      { id: 'pos',          label: 'POS & Billing',           icon: 'pos',          route: 'pos',             group: 'OPERATIONS' },
      { id: 'channels',     label: 'Channels & Front Service', icon: 'pos',         route: 'channels',        group: 'OPERATIONS' },
      { id: 'attendance',   label: 'Attendance & Shifts',     icon: 'attendance',   route: 'attendance',      group: 'OPERATIONS' },
      { id: 'dept-orders',  label: 'Department Orders',       icon: 'deptOrders',   route: 'dept-orders',     group: 'OPERATIONS' },
      { id: 'inventory',    label: 'Inventory',               icon: 'inventory',    route: 'inventory',       group: 'OPERATIONS' },
      { id: 'procurement',  label: 'Procurement',             icon: 'procurement',  route: 'procurement',     group: 'OPERATIONS' },
      { id: 'assets',       label: 'Assets & Maintenance',    icon: 'assets',       route: 'assets',          group: 'OPERATIONS' },
      { id: 'quality',      label: 'Quality & Compliance',    icon: 'quality',      route: 'quality',         group: 'OPERATIONS' },
      { id: 'employees',    label: 'Café Staff Team',         icon: 'employees',    route: 'employees',       group: 'PEOPLE' },
      { id: 'expenses',     label: 'Expenses',                icon: 'expenses',     route: 'expenses',        group: 'FINANCE' },
      { id: 'sales-cash',   label: 'Sales & Cash',            icon: 'finance',      route: 'sales-cash',      group: 'FINANCE' },
      { id: 'customers',    label: 'Customers & Loyalty',     icon: 'customers',    route: 'customers',       group: 'COMMERCIAL' },
      { id: 'menu',         label: 'Menu & Availability',     icon: 'menuItem',     route: 'menu',            group: 'COMMERCIAL' },
      { id: 'vendors',      label: 'Vendors & Catalogue',     icon: 'vendors',      route: 'vendors',         group: 'COMMERCIAL' },
      { id: 'reports',      label: 'Reports (this café)',      icon: 'reports',      route: 'reports',         group: 'INSIGHTS' },
      { id: 'forecasts-insights', label: 'Forecasts & Insights', icon: 'reports', route: 'forecasts-insights', group: 'INSIGHTS' },
      { id: 'tasks',        label: 'Action Centre',           icon: 'tasks',        route: 'tasks',           group: 'INSIGHTS' },
      { id: 'cafe-ops-devices', label: 'Devices & Sessions',  icon: 'devices',      route: 'cafe-ops-devices',group: 'SYSTEM' },
      { id: 'settings',     label: 'Settings',                icon: 'settings',     route: 'settings',        group: 'SYSTEM' },
    ],
    footnote: 'Cafe-owned trusted device operational workspace. Operator sessions & device context.',
  },

  // ── STAFF ────────────────────────────────────────────────────────────────────
  [ROLES.STAFF]: {
    scopeLabel: null,
    items: [
      { id: 'home',          label: 'Home',                icon: 'home',       route: 'staff-home',           group: 'COMMAND' },
      { id: 'announcements', label: 'Announcements',       icon: 'announce',   route: 'announcements',        group: 'COMMAND' },
      { id: 'attendance',    label: 'My Attendance',       icon: 'attendance', route: 'staff-attendance',     group: 'SELF' },
      { id: 'leave',         label: 'My Leave',            icon: 'calendar',   route: 'staff-leave',          group: 'SELF' },
      { id: 'payslips',      label: 'My Payslips',         icon: 'payslip',    route: 'staff-payslips',       group: 'SELF' },
      { id: 'loans',         label: 'My Loans & Advances', icon: 'finance',    route: 'staff-loans-advances', group: 'SELF' },
      { id: 'documents',     label: 'My Documents',        icon: 'quality',    route: 'staff-documents',      group: 'SELF' },
      { id: 'settings',      label: 'Settings',            icon: 'settings',   route: 'staff-settings',       group: 'SYSTEM' },
    ],
    footnote: 'Staff Self-Service Portal — Governed personal attendance, leave, payslips, and advances.',
  },

  // ── VENDOR (SUPPLIER PARTNER) ────────────────────────────────────────────────
  [ROLES.VENDOR]: {
    scopeLabel: 'Vendor Portal',
    items: [
      { id: 'vendor-dashboard',  label: 'Supplier Overview',  icon: 'home',        route: 'vendor-dashboard',  group: 'PORTAL' },
      { id: 'vendor-orders',     label: 'Issued Orders',      icon: 'procurement', route: 'vendor-orders',     group: 'PURCHASING' },
      { id: 'vendor-deliveries', label: 'Delivery Receipts',  icon: 'inventory',   route: 'vendor-deliveries', group: 'PURCHASING' },
      { id: 'vendor-statements', label: 'Account Statements', icon: 'finance',     route: 'vendor-statements', group: 'FINANCE' },
      { id: 'vendor-profile',    label: 'Business Profile',   icon: 'user',        route: 'vendor-profile',    group: 'PORTAL' },
    ],
    footnote: 'Vendor Portal — Strictly read-only enterprise purchasing and delivery records.',
  },
};

// ── Routes exclusively accessible only to Primary Master (for MASTER role) ───
export const PRIMARY_MASTER_ONLY_ROUTES = new Set([
  'passbook',
  'ledger',
  'payroll',
  'revenue-share',
  'org-identity',
  'organisation-identity',
  'mailops',
]);

// ─── Implicit routes — not in sidebar but accessible to all authenticated users ─
// These are auth-context / device-state screens that any authenticated role may
// reach (e.g. kiosk mode, operator sign-in, device blocked screens).
const IMPLICIT_ROUTES_ALL = new Set([
  'notifications',
  'kiosk-attendance',
  'staff-attendance',
  'staff-leave',
  'staff-payslips',
  'staff-loans-advances',
  'staff-documents',
  'staff-settings',
  'staff-home',
  'announcements',
  'employee-profile',
  'emergency-terminal',
  'waiter',
  'captain',
  'qr',
  'qr-order',
  'token-display',
  'pickup-display',
  'dual-screen',
  'customer-screen',
  'menu-board',
  'digital-signage',
  'call-center',
  'phone-orders',
  'retail-cpg',
  'cpg-invoice',
]);

// Implicit routes specific to CAFE_ADMIN — auth-context pages (not sidebar items)
const IMPLICIT_ROUTES_CAFE_ADMIN = new Set([
  'cafe-operator-signin',
  'cafe-device-state',
  // Stage-2 Login Integration: additive terminal auth screens
  'cafe-master-signin',
  'cafe-device-enroll',
  'cafe-terminal-welcome',
]);

// ─── Route allowlist check ─────────────────────────────────────────────────────
export function isRouteAllowed(role, rawRoute, isPrimaryMaster = false) {
  const cleanRoute = (rawRoute || '').replace(/^#/, '');
  const route = cleanRoute.split('?')[0];

  // Vendor Persona Strict Isolation Guard:
  // Vendor is restricted purely to vendor portal routes and personal profile/settings.
  if (role === ROLES.VENDOR || role === 'vendor') {
    const VENDOR_ALLOWED_ROUTES = new Set([
      'vendor-dashboard',
      'vendor-orders',
      'vendor-deliveries',
      'vendor-statements',
      'vendor-profile',
      'vendor-portal',
    ]);
    const pathOnly = route ? route.split('?')[0] : '';
    const baseRoute = pathOnly ? pathOnly.split('/')[0] : '';
    if (VENDOR_ALLOWED_ROUTES.has(pathOnly) || VENDOR_ALLOWED_ROUTES.has(route) || VENDOR_ALLOWED_ROUTES.has(baseRoute)) {
      return true;
    }
    if (route === 'profile' || route === 'my-profile') return true;
    if (route.startsWith('settings/')) {
      const sub = route.slice('settings/'.length).toLowerCase();
      return ['profile', 'notifications', 'appearance', 'security', 'help', 'accessibility', 'privacy'].includes(sub);
    }
    return false;
  }

  // Implicit routes allowed for all authenticated non-vendor roles
  if (IMPLICIT_ROUTES_ALL.has(route)) return true;

  // Primary Master has 100% universal unrestricted access to every route and module
  if ((role === ROLES.MASTER || role === 'master') && isPrimaryMaster) {
    return true;
  }

  // Implicit CAFE_ADMIN auth-context routes
  if (role === ROLES.CAFE_ADMIN && IMPLICIT_ROUTES_CAFE_ADMIN.has(route)) return true;

  // Settings subroutes and universal profile/employment aliases
  if (
    route === "employee-profile" ||
    route === "profile" ||
    route === "my-profile" ||
    route === "employment" ||
    route === "my-employment"
  ) {
    return true;
  }

  if (route.startsWith("settings/")) {
    const sub = route.slice("settings/".length).toLowerCase();
    if (role === ROLES.STAFF || role === 'staff') {
      const STAFF_ALLOWED_SETTINGS = new Set([
        'profile',
        'security',
        'devices',
        'notifications',
        'appearance',
        'accessibility',
        'language',
        'help',
        'privacy',
      ]);
      return STAFF_ALLOWED_SETTINGS.has(sub);
    }
    // Organisation governance / trash subroutes are restricted to MASTER
    if (sub === "trash" || sub === "data-recovery" || sub === "admin" || sub === "system-administration" || sub === "templates") {
      return role === ROLES.MASTER;
    }
    // All personal preference and identity subroutes are accessible to all authenticated profiles
    return true;
  }

  // OF03: Allow OWNER read-only drill-down access into operational modules for assigned cafés
  if (role === ROLES.OWNER || role === 'owner') {
    const OWNER_OPERATIONAL_DRILLDOWN_ROUTES = new Set([
      'dept-orders',
      'inventory',
      'procurement',
      'expenses',
      'customers',
    ]);
    if (OWNER_OPERATIONAL_DRILLDOWN_ROUTES.has(route)) return true;
  }

  // Normal Master Decommission Invariant:
  // If role is MASTER, isPrimaryMaster MUST be true. Non-primary Master is denied all routes.
  if (role === ROLES.MASTER && !isPrimaryMaster) {
    return false;
  }

  const navConfig = NAVIGATION[role];
  if (!navConfig) return false;

  const items = navConfig.items || navConfig.primaryItems || [];

  const pathOnly = route ? route.split("?")[0] : "";
  const baseRoute = pathOnly ? pathOnly.split("/")[0] : "";
  const routeAliases = {
    'devices': 'cafe-ops-devices',
    'cafe-ops-devices': 'devices',
    'tasks': 'approvals',
    'approvals': 'tasks',
    'personal-ledger': 'ledger',
    'ledger': 'personal-ledger',
    'org-identity': 'admin',
    'organisation-identity': 'admin',
    'settings': 'staff-settings',
    'staff-settings': 'settings',
  };

  const allowed = items.map((i) => i.route);

  // Check direct route match or base module match or alias match
  return Boolean(
    allowed.includes(pathOnly) ||
    allowed.includes(route) ||
    (baseRoute && allowed.includes(baseRoute)) ||
    (routeAliases[pathOnly] && allowed.includes(routeAliases[pathOnly])) ||
    (routeAliases[route] && allowed.includes(routeAliases[route])) ||
    (routeAliases[baseRoute] && allowed.includes(routeAliases[baseRoute]))
  );
}

// ─── Grouped navigation for sidebar rendering ─────────────────────────────────
export function getGroupedNavItems(role, isPrimaryMaster = false) {
  // Normal Master Decommission Invariant:
  if (role === ROLES.MASTER && !isPrimaryMaster) {
    return {};
  }

  const navConfig = NAVIGATION[role];
  if (!navConfig) return {};

  const items = navConfig.items || navConfig.primaryItems || [];

  const groups = {};
  for (const item of items) {
    const groupKey = item.group || 'OTHER';
    if (!groups[groupKey]) groups[groupKey] = [];
    groups[groupKey].push(item);
  }
  return groups;
}
