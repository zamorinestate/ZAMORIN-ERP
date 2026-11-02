// Sidebar grouping for every window, taken from the "Navigation by window" board of the UI kit reference.
// Presentation only: routes, labels' permissions and route guards still come from navigation.js and the server.
// Each group shows its pinned pages directly and the rest under a "More (n)" list. Any item a window has in
// navigation.js that this layout does not mention is appended to the last group's More list, so nothing is lost.
import { NAVIGATION, ROLES } from "./navigation.js";

const G = {
  command: '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>',
  operations: '<circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/>',
  people: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  finance: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>',
  commercial: '<path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/>',
  insights: '<line x1="12" y1="20" x2="12" y2="10"/><line x1="18" y1="20" x2="18" y2="4"/><line x1="6" y1="20" x2="6" y2="16"/>',
  admin: '<line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/>',
  governance: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
  portal: '<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>',
};

// [group title, icon, pinned routes, more routes]. A route may be given as "route|Label override".
const LAYOUT = {
  [ROLES.MASTER]: [
    ["Command", "command", ["dashboard|Command Centre"], []],
    ["Operations", "operations", ["pos", "channels", "attendance", "inventory", "procurement"], ["approvals", "dept-orders", "assets", "quality", "mailops|MailOps"]],
    ["People", "people", ["employees", "payroll"], ["staff-home"]],
    ["Finance", "finance", ["sales-cash", "bills", "expenses", "finance"], ["passbook", "ledger|Personal Ledger"]],
    ["Commercial", "commercial", ["customers", "menu", "vendors"], ["revenue-share"]],
    ["Insights", "insights", ["reports"], ["forecasts-insights", "portfolio-governance"]],
    ["Administration & System", "admin", ["settings"], ["admin", "onboarding-migration", "cafe-ops-devices", "system-health"]],
  ],
  [ROLES.OWNER]: [
    ["Command & Oversight", "command", ["dashboard", "approvals"], ["owner-food-safety", "owner-complaints", "owner-utilities-waste"]],
    ["Governance modules", "governance", ["owner-risk-audit", "owner-planning"], ["owner-compliance", "owner-supplier-intelligence", "owner-academy", "owner-asset-reliability", "owner-privacy-cyber", "owner-bcdr", "owner-master-data", "owner-menu-pricing", "owner-customer-loyalty", "owner-governance-delegation"]],
    ["Operations (read-only)", "operations", ["inventory", "expenses"], ["dept-orders", "procurement", "customers", "channels"]],
    ["Finance & Commercial", "finance", ["sales-cash", "bills", "finance"], ["passbook", "ledger", "payroll", "revenue-share"]],
    ["People & Insights", "people", ["employees", "attendance", "reports"], ["performance", "forecasts-insights", "portfolio-governance"]],
    ["System", "admin", ["settings"], ["system-health"]],
  ],
  [ROLES.CAFE_ADMIN]: [
    ["Command", "command", ["dashboard"], []],
    ["Operations", "operations", ["pos", "channels", "attendance", "inventory", "tasks"], ["dept-orders", "procurement", "assets", "quality", "menu"]],
    ["People", "people", ["employees"], []],
    ["Finance", "finance", ["expenses", "sales-cash"], []],
    ["Commercial & Insights", "commercial", ["customers"], ["vendors", "reports", "forecasts-insights"]],
    ["System", "admin", ["settings"], ["cafe-ops-devices"]],
  ],
  [ROLES.STAFF]: [
    ["Self-service", "portal", ["staff-home", "announcements", "staff-attendance", "staff-leave", "staff-settings"], ["staff-payslips", "staff-loans-advances", "staff-documents"]],
  ],
  [ROLES.VENDOR]: [
    ["Portal", "portal", ["vendor-dashboard", "vendor-orders", "vendor-deliveries", "vendor-statements", "vendor-profile"], []],
  ],
};

export function groupIconSvg(key, size = 18) {
  const body = G[key] || G.command;
  return `<svg aria-hidden="true" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
}

/** @returns {Array<{title:string,icon:string,pinned:Array,more:Array}>} items are navigation.js items with an optional label override */
export function getSidebarModel(role, isPrimaryMaster = false) {
  if (role === ROLES.MASTER && !isPrimaryMaster) return [];
  const nav = NAVIGATION[role];
  if (!nav) return [];
  const all = nav.items || nav.primaryItems || [];
  const byRoute = new Map();
  for (const it of all) if (!byRoute.has(it.route)) byRoute.set(it.route, it);
  const used = new Set();
  const take = (spec) => {
    const [route, label] = spec.split("|");
    const it = byRoute.get(route);
    if (!it) return null;
    used.add(route);
    return label ? { ...it, label } : it;
  };
  const layout = LAYOUT[role] || [];
  const model = layout.map(([title, icon, pinned, more]) => ({
    title,
    icon,
    pinned: pinned.map(take).filter(Boolean),
    more: more.map(take).filter(Boolean),
  }));
  const leftovers = all.filter((it) => !used.has(it.route) && !used.has(it.route + "!"));
  const seen = new Set();
  const extra = leftovers.filter((it) => (seen.has(it.route) ? false : (seen.add(it.route), true)));
  if (extra.length) {
    if (!model.length) model.push({ title: "Menu", icon: "command", pinned: [], more: [] });
    model[model.length - 1].more.push(...extra);
  }
  return model.filter((g) => g.pinned.length || g.more.length);
}
