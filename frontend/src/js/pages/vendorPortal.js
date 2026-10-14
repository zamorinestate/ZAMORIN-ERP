// =============================================================================
// ZAMORIN CAFÉ ERP — VENDOR PORTAL PAGE (FIFTH WINDOW)
//
// External supplier / vendor workspace. Strictly read-only.
// Design principles:
//   - Clean, professional, enterprise aesthetic with supplier branding.
//   - Prominent "READ-ONLY" status badges to prevent confusion.
//   - Keyboard navigable order list with full modal detail view.
//   - Responsive layout; works from mobile to desktop.
//   - API base: /api/v1/vendor-portal/*
// =============================================================================

import { apiGet } from "../apiClient.js";
import { state } from "../state.js";
import { debounce } from "../utils/debounce.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────
function formatRupees(paisa) {
  if (typeof paisa !== "number") return "—";
  return "₹" + (paisa / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatDate(val) {
  if (!val) return "—";
  try {
    return new Date(val).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
  } catch {
    return String(val);
  }
}

function statusBadge(status) {
  const map = {
    APPROVED: ["#0ea5e9", "Approved"],
    ORDER_PLACED: ["#7c3aed", "Placed"],
    ORDERED: ["#6d28d9", "Ordered"],
    ACKNOWLEDGED: ["#0891b2", "Acknowledged"],
    DISPATCHED: ["#d97706", "Dispatched"],
    PARTIALLY_RECEIVED: ["#d97706", "Partly Received"],
    VERIFIED_PENDING_MASTER_APPROVAL: ["#b45309", "Pending Approval"],
    RECEIVED_PENDING_FINAL_POSTING: ["#065f46", "Pending Post"],
    RECEIVED: ["#059669", "Received"],
    CLOSED: ["#475569", "Closed"],
  };
  const [color, label] = map[status] || ["#94a3b8", status];
  return `<span style="display:inline-block;padding:2px 9px;border-radius:99px;background:${color}22;color:${color};font-size:11px;font-weight:700;letter-spacing:.5px;border:1px solid ${color}44;">${label}</span>`;
}

function readOnlyBadge() {
  return `<span style="display:inline-flex;align-items:center;gap:5px;padding:3px 10px;border-radius:99px;background:#dc262622;color:#dc2626;font-size:11px;font-weight:700;border:1px solid #dc262644;">
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
    READ-ONLY
  </span>`;
}

// ─── Sidebar active link helper ───────────────────────────────────────────────
function vendorSidebarActive(route) {
  const routes = ["vendor-dashboard", "vendor-orders", "vendor-deliveries", "vendor-statements", "vendor-profile"];
  return routes.map(r => {
    const isActive = r === route;
    const labels = {
      "vendor-dashboard": "Overview",
      "vendor-orders": "Issued Orders",
      "vendor-deliveries": "Deliveries",
      "vendor-statements": "Statements",
      "vendor-profile": "Business Profile",
    };
    const icons = {
      "vendor-dashboard": `<path d="M3 11.5 12 4l9 7.5"/><path d="M5 10v9a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1v-9"/>`,
      "vendor-orders": `<path d="M6 6h15l-1.5 9h-12Z"/><circle cx="9" cy="19" r="1.4"/><circle cx="17" cy="19" r="1.4"/><path d="M3 3h2l1 3"/>`,
      "vendor-deliveries": `<path d="M20 7 12 3 4 7v10l8 4 8-4Z"/><path d="M4 7l8 4 8-4M12 11v10"/>`,
      "vendor-statements": `<path d="M12 1v22M17 5.5c0-1.9-2.2-3-5-3s-5 1.3-5 3 2.2 2.6 5 3 5 1.1 5 3-2.2 3-5 3-5-1.1-5-3"/>`,
      "vendor-profile": `<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>`,
    };
    return `<a href="#${r}" id="vnav-${r}" class="vendor-nav-item${isActive ? " active" : ""}" role="menuitem" tabindex="0" data-route="${r}">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">${icons[r]}</svg>
      ${labels[r]}
    </a>`;
  }).join("");
}

// ─── Dashboard Panel ──────────────────────────────────────────────────────────
function renderDashboardContent() {
  return `<div class="vp-loading" id="vp-dashboard-loading" aria-live="polite">Loading supplier overview…</div>
<div id="vp-dashboard-data" hidden></div>`;
}

// ─── Orders Panel ─────────────────────────────────────────────────────────────
function renderOrdersContent() {
  return `
<div class="vp-toolbar" role="search" aria-label="Order search and filter">
  <div class="vp-search-wrap">
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-4.2-4.2"/></svg>
    <input id="vp-order-search" class="vp-input" type="search" placeholder="Search order ID…" aria-label="Search orders" autocomplete="off">
  </div>
  <select id="vp-status-filter" class="vp-select" aria-label="Filter by status">
    <option value="ALL">All Statuses</option>
    <option value="ORDERED">Ordered</option>
    <option value="DISPATCHED">Dispatched</option>
    <option value="PARTIALLY_RECEIVED">Partly Received</option>
    <option value="RECEIVED">Received</option>
    <option value="CLOSED">Closed</option>
  </select>
</div>
<div class="vp-loading" id="vp-orders-loading" aria-live="polite">Loading issued orders…</div>
<div id="vp-orders-data" hidden></div>
<div id="vp-order-modal" class="vp-modal" role="dialog" aria-modal="true" aria-label="Order Details" hidden></div>`;
}

// ─── Deliveries Panel ─────────────────────────────────────────────────────────
function renderDeliveriesContent() {
  return `<div class="vp-loading" id="vp-deliveries-loading" aria-live="polite">Loading delivery records…</div>
<div id="vp-deliveries-data" hidden></div>`;
}

// ─── Statements Panel ─────────────────────────────────────────────────────────
function renderStatementsContent() {
  return `<div class="vp-loading" id="vp-statements-loading" aria-live="polite">Loading account statements…</div>
<div id="vp-statements-data" hidden></div>`;
}

// ─── Profile Panel ────────────────────────────────────────────────────────────
function renderProfileContent() {
  return `<div class="vp-loading" id="vp-profile-loading" aria-live="polite">Loading business profile…</div>
<div id="vp-profile-data" hidden></div>`;
}

// ─── Page sections ────────────────────────────────────────────────────────────
const SECTION_TITLES = {
  "vendor-dashboard": "Supplier Overview",
  "vendor-orders": "Issued Purchase Orders",
  "vendor-deliveries": "Delivery Receipts",
  "vendor-statements": "Account Statements",
  "vendor-profile": "Business Profile",
  "vendor-portal": "Issued Purchase Orders",
};

const SECTION_CONTENT = {
  "vendor-dashboard": renderDashboardContent,
  "vendor-orders": renderOrdersContent,
  "vendor-deliveries": renderDeliveriesContent,
  "vendor-statements": renderStatementsContent,
  "vendor-profile": renderProfileContent,
  "vendor-portal": renderOrdersContent,
};

// ─── CSS ─────────────────────────────────────────────────────────────────────
const VENDOR_PORTAL_CSS = `
<style id="vp-styles">
.vp-shell { display:flex; min-height:100%; background:#0f172a; color:#e2e8f0; font-family:'Inter',system-ui,sans-serif; }
.vp-sidebar { width:220px; flex-shrink:0; background:#0b1120; border-right:1px solid #1e293b; padding:24px 0 32px; display:flex; flex-direction:column; }
.vp-brand { padding:0 20px 24px; border-bottom:1px solid #1e293b; margin-bottom:16px; }
.vp-brand-title { font-size:12px; font-weight:800; letter-spacing:1.5px; color:#94a3b8; text-transform:uppercase; }
.vp-brand-name { font-size:15px; font-weight:700; color:#f1f5f9; margin-top:4px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.vp-nav { display:flex; flex-direction:column; gap:2px; padding:0 8px; flex:1; }
.vendor-nav-item { display:flex; align-items:center; gap:10px; padding:9px 12px; border-radius:8px; color:#94a3b8; font-size:13px; font-weight:500; text-decoration:none; transition:all 0.15s; cursor:pointer; border:none; background:transparent; }
.vendor-nav-item:hover { color:#e2e8f0; background:#1e293b; }
.vendor-nav-item.active { color:#38bdf8; background:#0ea5e920; font-weight:700; }
.vendor-nav-item svg { flex-shrink:0; }
.vp-sidebar-footer { padding:16px 20px 0; border-top:1px solid #1e293b; margin-top:auto; }
.vp-sidebar-support { font-size:11px; color:#475569; line-height:1.5; }
.vp-sidebar-support a { color:#38bdf8; text-decoration:none; }
.vp-main { flex:1; display:flex; flex-direction:column; min-width:0; }
.vp-topbar { display:flex; align-items:center; justify-content:space-between; padding:12px 24px; border-bottom:1px solid #1e293b; background:#0f172a; position:sticky; top:0; z-index:10; }
.vp-topbar-left { display:flex; align-items:center; gap:12px; }
.vp-topbar-title { font-size:16px; font-weight:700; color:#f1f5f9; }
.vp-topbar-right { display:flex; align-items:center; gap:10px; }
.vp-content { flex:1; padding:28px 28px 48px; overflow-y:auto; }
.vp-loading { color:#64748b; font-size:14px; padding:40px 0; text-align:center; }
.vp-error { color:#f87171; font-size:14px; padding:20px; background:#7f1d1d22; border-radius:8px; border:1px solid #7f1d1d44; }
.vp-metric-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(180px,1fr)); gap:16px; margin-bottom:28px; }
.vp-metric-card { background:#1e293b; border:1px solid #334155; border-radius:12px; padding:20px 18px; }
.vp-metric-label { font-size:11px; font-weight:700; color:#64748b; text-transform:uppercase; letter-spacing:.7px; margin-bottom:6px; }
.vp-metric-value { font-size:22px; font-weight:800; color:#f1f5f9; }
.vp-metric-sub { font-size:11px; color:#64748b; margin-top:4px; }
.vp-table-wrap { overflow-x:auto; }
.vp-table { width:100%; border-collapse:collapse; font-size:13px; }
.vp-table th { background:#1e293b; color:#94a3b8; font-weight:700; font-size:11px; letter-spacing:.5px; text-transform:uppercase; padding:10px 12px; text-align:left; border-bottom:2px solid #334155; }
.vp-table td { padding:11px 12px; border-bottom:1px solid #1e293b; color:#e2e8f0; vertical-align:middle; }
.vp-table tr:hover td { background:#1e293b80; }
.vp-table .vp-amount { text-align:right; font-variant-numeric:tabular-nums; }
.vp-btn-link { background:transparent; border:none; color:#38bdf8; cursor:pointer; font-size:13px; padding:4px 0; text-decoration:underline; text-underline-offset:2px; font-weight:600; }
.vp-btn-link:hover { color:#7dd3fc; }
.vp-btn-icon { background:transparent; border:1px solid #334155; border-radius:6px; color:#94a3b8; cursor:pointer; padding:5px 8px; font-size:11px; font-weight:600; display:inline-flex; align-items:center; gap:5px; transition:all .15s; }
.vp-btn-icon:hover { border-color:#38bdf8; color:#38bdf8; }
.vp-toolbar { display:flex; gap:12px; margin-bottom:20px; flex-wrap:wrap; align-items:center; }
.vp-search-wrap { position:relative; }
.vp-search-wrap svg { position:absolute; left:10px; top:50%; transform:translateY(-50%); color:#64748b; pointer-events:none; }
.vp-input { background:#1e293b; border:1px solid #334155; border-radius:8px; color:#e2e8f0; font-size:13px; padding:8px 12px 8px 32px; outline:none; width:200px; transition:.15s; }
.vp-input:focus { border-color:#38bdf8; box-shadow:0 0 0 2px #38bdf820; }
.vp-select { background:#1e293b; border:1px solid #334155; border-radius:8px; color:#e2e8f0; font-size:13px; padding:8px 12px; outline:none; cursor:pointer; }
.vp-select:focus { border-color:#38bdf8; }
.vp-notice { display:flex; align-items:flex-start; gap:10px; background:#0ea5e912; border:1px solid #0ea5e930; border-radius:8px; padding:12px 16px; font-size:12px; color:#7dd3fc; margin-bottom:24px; line-height:1.5; }
.vp-profile-grid { display:grid; grid-template-columns:1fr 1fr; gap:20px; }
.vp-profile-card { background:#1e293b; border:1px solid #334155; border-radius:12px; padding:20px; }
.vp-profile-card h3 { font-size:11px; font-weight:700; color:#64748b; text-transform:uppercase; letter-spacing:.7px; margin:0 0 14px; }
.vp-profile-row { display:flex; justify-content:space-between; padding:6px 0; border-bottom:1px solid #0f172a; font-size:13px; }
.vp-profile-row:last-child { border-bottom:none; }
.vp-profile-key { color:#64748b; font-weight:500; }
.vp-profile-val { color:#e2e8f0; font-weight:600; }
.vp-modal { position:fixed; inset:0; background:#00000090; z-index:1000; display:flex; align-items:center; justify-content:center; padding:16px; }
.vp-modal-inner { background:#0f172a; border:1px solid #334155; border-radius:16px; max-width:760px; width:100%; max-height:90vh; display:flex; flex-direction:column; overflow:hidden; }
.vp-modal-header { display:flex; align-items:center; justify-content:space-between; padding:18px 24px; border-bottom:1px solid #1e293b; }
.vp-modal-title { font-size:16px; font-weight:700; color:#f1f5f9; }
.vp-modal-body { padding:20px 24px; overflow-y:auto; }
.vp-modal-close { background:transparent; border:none; color:#64748b; cursor:pointer; font-size:20px; line-height:1; padding:4px; border-radius:6px; }
.vp-modal-close:hover { color:#e2e8f0; background:#1e293b; }
.vp-empty { text-align:center; padding:60px 20px; color:#64748b; }
.vp-empty-icon { margin-bottom:12px; opacity:.4; }
.vp-empty-text { font-size:14px; }
.vp-pagination { display:flex; align-items:center; gap:12px; justify-content:flex-end; margin-top:16px; font-size:13px; color:#64748b; }
@media(max-width:700px){
  .vp-shell{flex-direction:column;}
  .vp-sidebar{width:100%;flex-direction:row;overflow-x:auto;padding:8px;border-right:none;border-bottom:1px solid #1e293b;}
  .vp-brand{display:none;}
  .vp-nav{flex-direction:row;gap:4px;padding:0;}
  .vp-sidebar-footer{display:none;}
  .vp-profile-grid{grid-template-columns:1fr;}
}
</style>`;

// ─── Main render function ─────────────────────────────────────────────────────
export function renderVendorPortal(activeRoute = "vendor-orders", subroute = "") {
  const normalizedRoute = activeRoute || "vendor-orders";
  const title = SECTION_TITLES[normalizedRoute] || "Vendor Portal";
  const panelFn = SECTION_CONTENT[normalizedRoute] || renderOrdersContent;
  const vendorName = state.user?.name || "Vendor";

  return `
${VENDOR_PORTAL_CSS}
<div class="vp-shell" data-active-route="${normalizedRoute}">
  <nav class="vp-sidebar" role="navigation" aria-label="Vendor Portal Navigation">
    <div class="vp-brand">
      <div class="vp-brand-title">Vendor Portal</div>
      <div class="vp-brand-name" title="${vendorName}">${vendorName}</div>
    </div>
    <div class="vp-nav" role="menu">${vendorSidebarActive(normalizedRoute)}</div>
    <div class="vp-sidebar-footer">
      <div class="vp-sidebar-support">
        <strong style="color:#e2e8f0;display:block;margin-bottom:4px;">Support</strong>
        <a href="mailto:procurement@zamorin.test">procurement@zamorin.test</a><br>
        Questions? Contact Café Operations via authenticated email.
      </div>
    </div>
  </nav>
  <div class="vp-main">
    <header class="vp-topbar">
      <div class="vp-topbar-left">
        <h1 class="vp-topbar-title" id="vp-page-title">${title}</h1>
      </div>
      <div class="vp-topbar-right">
        ${readOnlyBadge()}
      </div>
    </header>
    <main class="vp-content" id="vp-panel-content" aria-labelledby="vp-page-title">
      <div class="vp-notice" role="note" aria-label="Read-only notice">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>
        All data displayed here are official, read-only enterprise business records released by Zamorin Café ERP. To update any details, contact Café Operations directly.
      </div>
      ${panelFn()}
    </main>
  </div>
</div>`;
}

// ─── Wire function ─────────────────────────────────────────────────────────────
export function wireVendorPortal(container, activeRoute = "vendor-orders") {
  // Sidebar navigation clicks
  container.querySelectorAll(".vendor-nav-item").forEach(link => {
    link.addEventListener("click", (e) => {
      e.preventDefault();
      const route = link.dataset.route;
      if (route && typeof window !== "undefined") {
        window.location.hash = "#" + route;
      }
    });
    link.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        link.click();
      }
    });
  });

  // Load appropriate panel data
  const normalizedRoute = activeRoute || "vendor-orders";
  switch (normalizedRoute) {
    case "vendor-dashboard":
    case "vendor-portal":
      _loadDashboard(container);
      break;
    case "vendor-orders":
      _loadOrders(container, {});
      break;
    case "vendor-deliveries":
      _loadDeliveries(container);
      break;
    case "vendor-statements":
      _loadStatements(container);
      break;
    case "vendor-profile":
      _loadProfile(container);
      break;
  }
}

// ─── Panel data loaders ───────────────────────────────────────────────────────

async function _loadDashboard(container) {
  const loadEl = container.querySelector("#vp-dashboard-loading");
  const dataEl = container.querySelector("#vp-dashboard-data");
  try {
    const res = await apiGet("/vendor-portal/dashboard");
    const d = res?.data || {};
    loadEl?.remove();
    if (dataEl) {
      dataEl.hidden = false;
      dataEl.innerHTML = `
<div class="vp-metric-grid">
  <div class="vp-metric-card">
    <div class="vp-metric-label">Total Issued Orders</div>
    <div class="vp-metric-value">${d.totalIssuedOrdersCount ?? "—"}</div>
  </div>
  <div class="vp-metric-card">
    <div class="vp-metric-label">Pending Deliveries</div>
    <div class="vp-metric-value" style="color:#f59e0b;">${d.pendingDeliveriesCount ?? "—"}</div>
  </div>
  <div class="vp-metric-card">
    <div class="vp-metric-label">Completed Orders</div>
    <div class="vp-metric-value" style="color:#22c55e;">${d.completedOrdersCount ?? "—"}</div>
  </div>
  <div class="vp-metric-card">
    <div class="vp-metric-label">Total Issued Value</div>
    <div class="vp-metric-value">${formatRupees(d.totalIssuedValuePaisa)}</div>
  </div>
  <div class="vp-metric-card">
    <div class="vp-metric-label">Pending Delivery Value</div>
    <div class="vp-metric-value" style="color:#f59e0b;">${formatRupees(d.pendingDeliveryValuePaisa)}</div>
  </div>
  <div class="vp-metric-card">
    <div class="vp-metric-label">Last Order Date</div>
    <div class="vp-metric-value" style="font-size:16px;">${formatDate(d.lastOrderDate)}</div>
  </div>
</div>
${d.recentOrders?.length ? `
<h2 style="font-size:14px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:.5px;margin-bottom:14px;">Recent Orders</h2>
<div class="vp-table-wrap"><table class="vp-table" role="table" aria-label="Recent orders">
  <thead><tr><th>Order ID</th><th>Outlet</th><th>Date</th><th>Status</th><th class="vp-amount">Value</th></tr></thead>
  <tbody>
    ${d.recentOrders.map(o => `<tr>
      <td><strong>${o.purchaseOrderId}</strong></td>
      <td>${o.cafeId}</td>
      <td>${formatDate(o.orderDate)}</td>
      <td>${statusBadge(o.status)}</td>
      <td class="vp-amount">${formatRupees(o.totalPaisa)}</td>
    </tr>`).join("")}
  </tbody>
</table></div>` : ""}`;
    }
  } catch (err) {
    if (loadEl) loadEl.outerHTML = `<div class="vp-error">Failed to load supplier overview: ${err?.message || "unknown error"}</div>`;
  }
}

async function _loadOrders(container, { page = 1, status = "ALL", search = "" } = {}) {
  const loadEl = container.querySelector("#vp-orders-loading");
  const dataEl = container.querySelector("#vp-orders-data");

  const searchInput = container.querySelector("#vp-order-search");
  const statusSelect = container.querySelector("#vp-status-filter");

  // Wire search/filter events once
  if (searchInput && !searchInput._wired) {
    searchInput._wired = true;
    const handleVendorSearch = debounce((searchVal) => {
      _loadOrders(container, { page: 1, status: statusSelect?.value || "ALL", search: searchVal });
    }, 250);
    searchInput.addEventListener("input", (e) => {
      handleVendorSearch(e.target.value);
    });
  }
  if (statusSelect && !statusSelect._wired) {
    statusSelect._wired = true;
    statusSelect.addEventListener("change", () => {
      _loadOrders(container, { page: 1, status: statusSelect.value, search: searchInput?.value || "" });
    });
  }

  const params = new URLSearchParams({ page, limit: 50 });
  if (status && status !== "ALL") params.set("status", status);
  if (search) params.set("search", search);

  try {
    if (loadEl) loadEl.hidden = false;
    if (dataEl) dataEl.hidden = true;

    const res = await apiGet(`/vendor-portal/orders?${params.toString()}`);
    const orders = res?.data || [];
    const pagination = res?.pagination || {};

    if (loadEl) loadEl.hidden = true;
    if (dataEl) {
      dataEl.hidden = false;
      if (!orders.length) {
        dataEl.innerHTML = `<div class="vp-empty"><div class="vp-empty-icon"><svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M6 6h15l-1.5 9h-12Z"/><circle cx="9" cy="19" r="1.4"/><circle cx="17" cy="19" r="1.4"/><path d="M3 3h2l1 3"/></svg></div><div class="vp-empty-text">No issued orders found.</div></div>`;
      } else {
        dataEl.innerHTML = `
<div class="vp-table-wrap">
<table class="vp-table" role="table" aria-label="Issued purchase orders">
  <thead><tr>
    <th scope="col">Order ID</th>
    <th scope="col">Outlet</th>
    <th scope="col">Order Date</th>
    <th scope="col">Expected Delivery</th>
    <th scope="col">Status</th>
    <th scope="col" class="vp-amount">Value</th>
    <th scope="col">Items</th>
    <th scope="col"></th>
  </tr></thead>
  <tbody>
    ${orders.map(o => `<tr>
      <td><strong>${o.purchaseOrderId}</strong></td>
      <td>${o.cafeId}</td>
      <td>${formatDate(o.orderDate)}</td>
      <td>${formatDate(o.expectedDeliveryDate)}</td>
      <td>${statusBadge(o.status)}</td>
      <td class="vp-amount">${formatRupees(o.totalPaisa)}</td>
      <td>${o.itemCount}</td>
      <td>
        <button class="vp-btn-link" data-order-id="${o.purchaseOrderId}" aria-label="View details for order ${o.purchaseOrderId}">View</button>
        <button class="vp-btn-icon" data-print-id="${o.purchaseOrderId}" aria-label="Print order ${o.purchaseOrderId}">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>
        </button>
      </td>
    </tr>`).join("")}
  </tbody>
</table>
</div>
<div class="vp-pagination" aria-label="Pagination">
  <span>${pagination.total ?? orders.length} orders</span>
</div>`;

        // Wire view detail buttons
        dataEl.querySelectorAll("[data-order-id]").forEach(btn => {
          btn.addEventListener("click", () => _openOrderModal(container, btn.dataset.orderId));
        });
        // Wire print buttons
        dataEl.querySelectorAll("[data-print-id]").forEach(btn => {
          btn.addEventListener("click", () => _printOrder(btn.dataset.printId));
        });
      }
    }
  } catch (err) {
    if (loadEl) loadEl.hidden = true;
    if (dataEl) {
      dataEl.hidden = false;
      dataEl.innerHTML = `<div class="vp-error">Failed to load orders: ${err?.message || "unknown error"}</div>`;
    }
  }
}

async function _openOrderModal(container, purchaseOrderId) {
  const modal = container.querySelector("#vp-order-modal");
  if (!modal) return;
  modal.hidden = false;
  modal.innerHTML = `<div class="vp-modal-inner" role="document"><div class="vp-modal-header"><span class="vp-modal-title">Loading…</span><button class="vp-modal-close" aria-label="Close" id="vp-close-modal">×</button></div></div>`;
  modal.querySelector("#vp-close-modal")?.addEventListener("click", () => { modal.hidden = true; modal.innerHTML = ""; });
  modal.addEventListener("click", (e) => { if (e.target === modal) { modal.hidden = true; modal.innerHTML = ""; } });

  try {
    const res = await apiGet(`/vendor-portal/orders/${encodeURIComponent(purchaseOrderId)}`);
    const o = res?.data || {};
    const li = o.lineItems || [];
    modal.querySelector(".vp-modal-inner").innerHTML = `
<div class="vp-modal-header">
  <div>
    <div class="vp-modal-title">PO: ${o.purchaseOrderId}</div>
    <div style="font-size:12px;color:#64748b;margin-top:3px;">${statusBadge(o.status)} ${readOnlyBadge()}</div>
  </div>
  <button class="vp-modal-close" aria-label="Close order details" id="vp-close-modal2">×</button>
</div>
<div class="vp-modal-body">
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:20px;font-size:13px;">
    <div><span style="color:#64748b;">Outlet:</span> <strong>${o.cafeId}</strong></div>
    <div><span style="color:#64748b;">Order Date:</span> <strong>${formatDate(o.orderDate)}</strong></div>
    <div><span style="color:#64748b;">Expected Delivery:</span> <strong>${formatDate(o.expectedDeliveryDate)}</strong></div>
    <div><span style="color:#64748b;">Payment Terms:</span> <strong>${o.paymentTerms || "NET_30"}</strong></div>
  </div>
  <table class="vp-table" aria-label="Line items">
    <thead><tr><th>#</th><th>Item</th><th>Pack Size</th><th class="vp-amount">Qty</th><th class="vp-amount">Rate</th><th class="vp-amount">GST</th><th class="vp-amount">Total</th></tr></thead>
    <tbody>
      ${li.map((item, idx) => `<tr>
        <td>${idx + 1}</td>
        <td><strong>${item.itemName}</strong>${item.supplierItemCode ? `<br><span style="font-size:11px;color:#64748b;">${item.supplierItemCode}</span>` : ""}</td>
        <td>${item.packSize || "1 UNIT"}</td>
        <td class="vp-amount">${item.quantityOrdered}</td>
        <td class="vp-amount">${formatRupees(item.unitPricePaisa)}</td>
        <td class="vp-amount">${item.gstPercent || 0}%</td>
        <td class="vp-amount">${formatRupees(item.lineTotalPaisa)}</td>
      </tr>`).join("")}
    </tbody>
    <tfoot>
      <tr><td colspan="6" style="text-align:right;font-weight:700;color:#94a3b8;">Subtotal</td><td class="vp-amount" style="font-weight:700;">${formatRupees(o.subtotalPaisa)}</td></tr>
      <tr><td colspan="6" style="text-align:right;font-weight:700;color:#94a3b8;">Tax</td><td class="vp-amount" style="font-weight:700;">${formatRupees(o.taxPaisa)}</td></tr>
      <tr><td colspan="6" style="text-align:right;font-weight:800;color:#38bdf8;font-size:15px;">Grand Total</td><td class="vp-amount" style="font-weight:800;color:#38bdf8;font-size:15px;">${formatRupees(o.totalPaisa)}</td></tr>
    </tfoot>
  </table>
  <div style="margin-top:16px;font-size:12px;color:#64748b;">${o.clarificationNotice || ""}</div>
</div>`;
    modal.querySelector("#vp-close-modal2")?.addEventListener("click", () => { modal.hidden = true; modal.innerHTML = ""; });
  } catch (err) {
    modal.querySelector(".vp-modal-inner").innerHTML = `<div class="vp-modal-header"><span class="vp-modal-title">Error</span><button class="vp-modal-close" id="vp-close-modal3">×</button></div><div class="vp-modal-body"><div class="vp-error">${err?.message || "Could not load order details."}</div></div>`;
    modal.querySelector("#vp-close-modal3")?.addEventListener("click", () => { modal.hidden = true; modal.innerHTML = ""; });
  }
}

function _printOrder(purchaseOrderId) {
  const apiBase = (typeof window !== "undefined" && window.ZAMORIN_API_BASE_URL) || "/api/v1";
  window.open(`${apiBase}/vendor-portal/orders/${encodeURIComponent(purchaseOrderId)}/pdf`, "_blank");
}

async function _loadDeliveries(container) {
  const loadEl = container.querySelector("#vp-deliveries-loading");
  const dataEl = container.querySelector("#vp-deliveries-data");
  try {
    const res = await apiGet("/vendor-portal/deliveries");
    const deliveries = res?.data || [];
    if (loadEl) loadEl.hidden = true;
    if (dataEl) {
      dataEl.hidden = false;
      if (!deliveries.length) {
        dataEl.innerHTML = `<div class="vp-empty"><div class="vp-empty-icon"><svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M20 7 12 3 4 7v10l8 4 8-4Z"/></svg></div><div class="vp-empty-text">No delivery receipts found.</div></div>`;
      } else {
        dataEl.innerHTML = `<div class="vp-table-wrap"><table class="vp-table" role="table" aria-label="Delivery receipts">
  <thead><tr><th>GRN ID</th><th>Purchase Order</th><th>Outlet</th><th>Received At</th><th>Status</th><th>Items</th></tr></thead>
  <tbody>
    ${deliveries.map(d => `<tr>
      <td><strong>${d.grnId}</strong></td>
      <td>${d.purchaseOrderId}</td>
      <td>${d.cafeId}</td>
      <td>${formatDate(d.receivedAt)}</td>
      <td>${statusBadge(d.status || "VERIFIED_PHYSICAL_RECEIPT")}</td>
      <td>${d.itemCount}</td>
    </tr>`).join("")}
  </tbody>
</table></div>`;
      }
    }
  } catch (err) {
    if (loadEl) loadEl.outerHTML = `<div class="vp-error">Failed to load deliveries: ${err?.message || "unknown error"}</div>`;
  }
}

async function _loadStatements(container) {
  const loadEl = container.querySelector("#vp-statements-loading");
  const dataEl = container.querySelector("#vp-statements-data");
  try {
    const res = await apiGet("/vendor-portal/statements");
    const entries = res?.data || [];
    if (loadEl) loadEl.hidden = true;
    if (dataEl) {
      dataEl.hidden = false;
      if (!entries.length) {
        dataEl.innerHTML = `<div class="vp-empty"><div class="vp-empty-icon"><svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M12 1v22M17 5.5c0-1.9-2.2-3-5-3s-5 1.3-5 3 2.2 2.6 5 3 5 1.1 5 3-2.2 3-5 3-5-1.1-5-3"/></svg></div><div class="vp-empty-text">No ledger statements found.</div></div>`;
      } else {
        dataEl.innerHTML = `
<div class="vp-notice">
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>
  ${res?.readOnlyNotice || "Financial ledger records are maintained by Enterprise Accounts Payable."}
</div>
<div class="vp-table-wrap"><table class="vp-table" role="table" aria-label="Account statements">
  <thead><tr><th>Entry ID</th><th>Date</th><th>Transaction Type</th><th>Reference</th><th class="vp-amount">Amount</th><th class="vp-amount">Balance</th><th>Status</th></tr></thead>
  <tbody>
    ${entries.map(e => `<tr>
      <td style="font-size:11px;color:#64748b;">${e.entryId}</td>
      <td>${formatDate(e.postingDate)}</td>
      <td>${e.transactionType}</td>
      <td>${e.documentReference || "—"}</td>
      <td class="vp-amount">${formatRupees(e.amountPaisa)}</td>
      <td class="vp-amount" style="font-weight:700;">${formatRupees(e.runningBalancePaisa)}</td>
      <td>${statusBadge(e.status || "SETTLED")}</td>
    </tr>`).join("")}
  </tbody>
</table></div>`;
      }
    }
  } catch (err) {
    if (loadEl) loadEl.outerHTML = `<div class="vp-error">Failed to load statements: ${err?.message || "unknown error"}</div>`;
  }
}

async function _loadProfile(container) {
  const loadEl = container.querySelector("#vp-profile-loading");
  const dataEl = container.querySelector("#vp-profile-data");
  try {
    const res = await apiGet("/vendor-portal/profile");
    const p = res?.data || {};
    if (loadEl) loadEl.hidden = true;
    if (dataEl) {
      dataEl.hidden = false;
      dataEl.innerHTML = `
<div class="vp-profile-grid">
  <div class="vp-profile-card">
    <h3>Business Identity</h3>
    ${[
      ["Legal Business Name", p.legalBusinessName],
      ["Trade Name", p.tradeName],
      ["Category", p.vendorCategory],
      ["Supplier Type", p.supplierType],
      ["Status", p.status],
      ["GSTIN", p.gstin || "—"],
      ["PAN", p.panMasked || "—"],
      ["FSSAI Licence", p.fssaiLicenseNumber || "—"],
      ["Payment Terms", p.paymentTerms],
    ].map(([k, v]) => `<div class="vp-profile-row"><span class="vp-profile-key">${k}</span><span class="vp-profile-val">${v || "—"}</span></div>`).join("")}
  </div>
  <div class="vp-profile-card">
    <h3>Bank Details</h3>
    ${[
      ["Bank Name", p.bankDetails?.bankName],
      ["Account Holder", p.bankDetails?.accountHolderName],
      ["Account No.", p.bankDetails?.accountNumberMasked],
      ["IFSC", p.bankDetails?.ifscCode],
      ["Branch", p.bankDetails?.branchName],
    ].map(([k, v]) => `<div class="vp-profile-row"><span class="vp-profile-key">${k}</span><span class="vp-profile-val">${v || "—"}</span></div>`).join("")}
    <div style="margin-top:14px;font-size:11px;color:#64748b;line-height:1.5;">To update banking details, contact Café Operations via authenticated email.</div>
  </div>
  ${p.primaryContact ? `<div class="vp-profile-card">
    <h3>Primary Contact</h3>
    ${[
      ["Name", p.primaryContact?.name],
      ["Phone", p.primaryContact?.phone],
      ["Email", p.primaryContact?.email],
      ["Designation", p.primaryContact?.designation],
    ].map(([k, v]) => `<div class="vp-profile-row"><span class="vp-profile-key">${k}</span><span class="vp-profile-val">${v || "—"}</span></div>`).join("")}
  </div>` : ""}
  <div class="vp-profile-card">
    <h3>Support Contact</h3>
    ${[
      ["Role", p.supportContact?.role],
      ["Phone", p.supportContact?.phone],
      ["Email", p.supportContact?.email],
    ].map(([k, v]) => `<div class="vp-profile-row"><span class="vp-profile-key">${k}</span><span class="vp-profile-val">${v || "—"}</span></div>`).join("")}
    <div style="margin-top:10px;font-size:11px;color:#64748b;">${p.supportContact?.helpNotice || ""}</div>
  </div>
</div>`;
    }
  } catch (err) {
    if (loadEl) loadEl.outerHTML = `<div class="vp-error">Failed to load business profile: ${err?.message || "unknown error"}</div>`;
  }
}
