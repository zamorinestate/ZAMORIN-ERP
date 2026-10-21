// =============================================================================
// ZAMORIN CAFÉ ERP — VENDOR PORTAL PAGE (FIFTH WINDOW)
//
// External supplier / vendor workspace. Strictly read-only.
// Design principles:
//   - Clean, professional, enterprise aesthetic integrating with ERP design tokens.
//   - No duplicate nested shells — works seamlessly within the main ERP shell.
//   - Prominent "READ-ONLY" status badges to guarantee role isolation.
//   - Quick navigation pill tabs to easily switch between supplier views.
//   - Keyboard navigable order list with full modal detail view.
//   - Graceful Dev-Preview / Unauthenticated Localhost fixtures for inspection.
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
  const raw = String(val);
  // Date-only values (YYYY-MM-DD) must not go through new Date(): that parses
  // them as UTC midnight and can shift the displayed day by one in local
  // timezones west of UTC. Render the stored calendar date verbatim instead.
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw.trim());
  if (dateOnly) {
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const month = months[Number(dateOnly[2]) - 1] || dateOnly[2];
    return `${dateOnly[3]} ${month} ${dateOnly[1]}`;
  }
  try {
    const parsed = new Date(val);
    if (Number.isNaN(parsed.getTime())) return raw;
    return parsed.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
  } catch {
    return raw;
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
    SETTLED: ["#059669", "Settled"],
    POSTED: ["#2563eb", "Posted"],
    REVERSED: ["#dc2626", "Reversed"],
    VERIFIED_PHYSICAL_RECEIPT: ["#059669", "Verified Receipt"],
  };
  const [color, label] = map[status] || ["#64748b", status || "Standard"];
  return `<span class="vp-badge" style="background:${color}18; color:${color}; border-color:${color}44;">${label}</span>`;
}

function readOnlyBadge() {
  return `<span class="vp-readonly-badge">
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
    STRICTLY READ-ONLY
  </span>`;
}

function isDevOrLocalhost() {
  return Boolean(
    state.user?.isDevPreview ||
    state.auth?.user?.isDevPreview ||
    (typeof location !== "undefined" && (location.hostname === "localhost" || location.hostname === "127.0.0.1"))
  );
}

// ─── High-Fidelity Canonical Fixtures (for Dev Preview / Localhost) ───────────
const CANONICAL_FIXTURES = {
  profile: {
    vendorId: "VENDOR-DEMO-001",
    legalBusinessName: "Malabar Roasters & Plantation Supplies Pvt Ltd",
    tradeName: "Demo Supplier Co.",
    vendorCategory: "Coffee & Beverage Raw Ingredients",
    supplierType: "DIRECT_MANUFACTURER",
    status: "ACTIVE / VERIFIED",
    gstin: "32AAECM1234F1Z8",
    panMasked: "AAECM••••F",
    fssaiLicenseNumber: "10020042001984",
    paymentTerms: "NET_30",
    registeredOfficeAddress: "7th Mile Road, Vengara P.O., Malappuram, Kerala 676301",
    bankDetails: {
      bankName: "HDFC Bank",
      accountHolderName: "Malabar Roasters & Plantation Supplies Pvt Ltd",
      accountNumberMasked: "•••• •••• •••• 8842",
      ifscCode: "HDFC0000184",
      branchName: "Calicut Main Branch",
    },
    primaryContact: {
      name: "Rajesh Varma",
      phone: "+91 98470 12345",
      email: "supply@demoroasters.test",
      designation: "Key Account Lead - HoReCa",
    },
    supportContact: {
      role: "Café Central Procurement Desk",
      phone: "+91 94470 12345",
      email: "procurement@zamorin.test",
      helpNotice: "To update tax registration, banking, or contact credentials, contact Central Operations via verified corporate email.",
    },
  },

  dashboard: {
    totalIssuedOrdersCount: 14,
    pendingDeliveriesCount: 2,
    completedOrdersCount: 12,
    totalIssuedValuePaisa: 48520000,
    pendingDeliveryValuePaisa: 3845000,
    lastOrderDate: new Date(Date.now() - 86400000 * 2).toISOString(),
    recentOrders: [
      { purchaseOrderId: "PO-2026-0042", cafeId: "KOZHIKODE-BEACH", orderDate: new Date(Date.now() - 86400000 * 2).toISOString(), status: "ORDERED", totalPaisa: 2450000 },
      { purchaseOrderId: "PO-2026-0039", cafeId: "CALICUT-CYBERPARK", orderDate: new Date(Date.now() - 86400000 * 5).toISOString(), status: "DISPATCHED", totalPaisa: 1395000 },
      { purchaseOrderId: "PO-2026-0035", cafeId: "MALABAR-MALL", orderDate: new Date(Date.now() - 86400000 * 9).toISOString(), status: "RECEIVED", totalPaisa: 4120000 },
      { purchaseOrderId: "PO-2026-0028", cafeId: "WAYANAD-ROAD", orderDate: new Date(Date.now() - 86400000 * 14).toISOString(), status: "RECEIVED", totalPaisa: 3875000 },
      { purchaseOrderId: "PO-2026-0021", cafeId: "KOZHIKODE-BEACH", orderDate: new Date(Date.now() - 86400000 * 21).toISOString(), status: "CLOSED", totalPaisa: 5210000 },
    ],
  },

  orders: [
    { purchaseOrderId: "PO-2026-0042", cafeId: "KOZHIKODE-BEACH", orderDate: new Date(Date.now() - 86400000 * 2).toISOString(), expectedDeliveryDate: new Date(Date.now() + 86400000 * 3).toISOString(), status: "ORDERED", totalPaisa: 2450000, itemCount: 4 },
    { purchaseOrderId: "PO-2026-0039", cafeId: "CALICUT-CYBERPARK", orderDate: new Date(Date.now() - 86400000 * 5).toISOString(), expectedDeliveryDate: new Date(Date.now() + 86400000 * 1).toISOString(), status: "DISPATCHED", totalPaisa: 1395000, itemCount: 2 },
    { purchaseOrderId: "PO-2026-0035", cafeId: "MALABAR-MALL", orderDate: new Date(Date.now() - 86400000 * 9).toISOString(), expectedDeliveryDate: new Date(Date.now() - 86400000 * 6).toISOString(), status: "RECEIVED", totalPaisa: 4120000, itemCount: 6 },
    { purchaseOrderId: "PO-2026-0028", cafeId: "WAYANAD-ROAD", orderDate: new Date(Date.now() - 86400000 * 14).toISOString(), expectedDeliveryDate: new Date(Date.now() - 86400000 * 11).toISOString(), status: "RECEIVED", totalPaisa: 3875000, itemCount: 5 },
    { purchaseOrderId: "PO-2026-0021", cafeId: "KOZHIKODE-BEACH", orderDate: new Date(Date.now() - 86400000 * 21).toISOString(), expectedDeliveryDate: new Date(Date.now() - 86400000 * 18).toISOString(), status: "CLOSED", totalPaisa: 5210000, itemCount: 7 },
  ],

  deliveries: [
    { grnId: "GRN-2026-089", purchaseOrderId: "PO-2026-0035", cafeId: "MALABAR-MALL", receivedAt: new Date(Date.now() - 86400000 * 6).toISOString(), status: "VERIFIED_PHYSICAL_RECEIPT", itemCount: 6 },
    { grnId: "GRN-2026-074", purchaseOrderId: "PO-2026-0028", cafeId: "WAYANAD-ROAD", receivedAt: new Date(Date.now() - 86400000 * 11).toISOString(), status: "VERIFIED_PHYSICAL_RECEIPT", itemCount: 5 },
    { grnId: "GRN-2026-052", purchaseOrderId: "PO-2026-0021", cafeId: "KOZHIKODE-BEACH", receivedAt: new Date(Date.now() - 86400000 * 18).toISOString(), status: "VERIFIED_PHYSICAL_RECEIPT", itemCount: 7 },
  ],

  statements: [
    { entryId: "VLE-2026-019", postingDate: new Date(Date.now() - 86400000 * 3).toISOString(), transactionType: "BANK_PAYMENT_SETTLEMENT", documentReference: "UTR-HDFC-9912049", amountPaisa: 4120000, runningBalancePaisa: 3845000, status: "SETTLED" },
    { entryId: "VLE-2026-016", postingDate: new Date(Date.now() - 86400000 * 7).toISOString(), transactionType: "PURCHASE_INVOICE_POSTED", documentReference: "INV-MR-4402", amountPaisa: 4120000, runningBalancePaisa: 7965000, status: "POSTED" },
    { entryId: "VLE-2026-012", postingDate: new Date(Date.now() - 86400000 * 12).toISOString(), transactionType: "BANK_PAYMENT_SETTLEMENT", documentReference: "UTR-HDFC-8830114", amountPaisa: 3875000, runningBalancePaisa: 3845000, status: "SETTLED" },
    { entryId: "VLE-2026-009", postingDate: new Date(Date.now() - 86400000 * 15).toISOString(), transactionType: "PURCHASE_INVOICE_POSTED", documentReference: "INV-MR-4389", amountPaisa: 3875000, runningBalancePaisa: 7720000, status: "POSTED" },
  ],

  sampleOrderDetails: {
    purchaseOrderId: "PO-2026-0042",
    cafeId: "KOZHIKODE-BEACH",
    orderDate: new Date(Date.now() - 86400000 * 2).toISOString(),
    expectedDeliveryDate: new Date(Date.now() + 86400000 * 3).toISOString(),
    paymentTerms: "NET_30",
    status: "ORDERED",
    subtotalPaisa: 2333333,
    taxPaisa: 116667,
    totalPaisa: 2450000,
    clarificationNotice: "Official Zamorin Café Enterprise Order. Delivery dock hours: 07:00 AM - 11:30 AM. Batch certificates and temperature logs must accompany cold-chain supplies.",
    lineItems: [
      { itemName: "Malabar Single Origin Arabica Beans", supplierItemCode: "BEANS-MSO-01", packSize: "5 KG BAG", quantityOrdered: 8, unitPricePaisa: 195000, gstPercent: 5, lineTotalPaisa: 1638000 },
      { itemName: "Organic Barista Oat Milk", supplierItemCode: "DAIRY-OAT-01", packSize: "12x1L CTN", quantityOrdered: 4, unitPricePaisa: 125000, gstPercent: 5, lineTotalPaisa: 525000 },
      { itemName: "Classic Filter Chicory Roast", supplierItemCode: "BEANS-CFR-02", packSize: "2 KG PACK", quantityOrdered: 5, unitPricePaisa: 55000, gstPercent: 5, lineTotalPaisa: 287000 },
    ],
  },
};

// ─── Section Definition ───────────────────────────────────────────────────────
const SECTION_TITLES = {
  "vendor-dashboard": "Supplier Overview",
  "vendor-orders": "Issued Purchase Orders",
  "vendor-deliveries": "Delivery Receipts",
  "vendor-statements": "Account Statements",
  "vendor-profile": "Business Profile",
  "vendor-portal": "Issued Purchase Orders",
};

const SECTION_DESCRIPTIONS = {
  "vendor-dashboard": "Executive procurement summary, delivery tracking, and recent purchase activity.",
  "vendor-orders": "Official purchase orders issued by Zamorin Café outlets, with detailed line items and print capabilities.",
  "vendor-deliveries": "Verified physical goods receipt notes (GRN) logged at café receiving docks.",
  "vendor-statements": "Official accounts payable ledger records, settled disbursements, and running trade balances.",
  "vendor-profile": "Verified corporate identity, banking details, and designated procurement support channels.",
  "vendor-portal": "Official purchase orders issued by Zamorin Café outlets, with detailed line items and print capabilities.",
};

// ─── Panel Renderers ──────────────────────────────────────────────────────────

function renderDashboardContent() {
  return `<div class="vp-loading" id="vp-dashboard-loading" aria-live="polite">Loading supplier overview…</div>
<div id="vp-dashboard-data" hidden></div>`;
}

function renderOrdersContent() {
  return `
<div class="vp-toolbar" role="search" aria-label="Order search and filter">
  <div class="vp-search-wrap">
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-4.2-4.2"/></svg>
    <input id="vp-order-search" class="vp-input" type="search" placeholder="Search PO or outlet…" aria-label="Search orders" autocomplete="off">
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

function renderDeliveriesContent() {
  return `<div class="vp-loading" id="vp-deliveries-loading" aria-live="polite">Loading delivery records…</div>
<div id="vp-deliveries-data" hidden></div>`;
}

function renderStatementsContent() {
  return `<div class="vp-loading" id="vp-statements-loading" aria-live="polite">Loading account statements…</div>
<div id="vp-statements-data" hidden></div>`;
}

function renderProfileContent() {
  return `<div class="vp-loading" id="vp-profile-loading" aria-live="polite">Loading business profile…</div>
<div id="vp-profile-data" hidden></div>`;
}

const SECTION_CONTENT = {
  "vendor-dashboard": renderDashboardContent,
  "vendor-orders": renderOrdersContent,
  "vendor-deliveries": renderDeliveriesContent,
  "vendor-statements": renderStatementsContent,
  "vendor-profile": renderProfileContent,
  "vendor-portal": renderOrdersContent,
};

// ─── Scoped CSS (Harmonized with ERP Tokens) ──────────────────────────────────
const VENDOR_PORTAL_CSS = `
<style id="vp-styles">
.vp-page-container {
  display: flex;
  flex-direction: column;
  gap: 20px;
  max-width: 1320px;
  margin: 0 auto;
  padding: 8px 4px 48px;
}

.vp-header-card {
  background: var(--surface, #ffffff);
  border: 1px solid var(--line, #e7e2d5);
  border-radius: var(--radius-lg, 12px);
  padding: 24px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04);
}

.vp-header-top {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
  margin-bottom: 12px;
}

.vp-header-identity {
  display: flex;
  align-items: center;
  gap: 14px;
}

.vp-header-icon-box {
  width: 48px;
  height: 48px;
  border-radius: var(--radius-md, 10px);
  background: var(--surface-sunken, #f2f0e9);
  border: 1px solid var(--line, #e7e2d5);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 24px;
  flex-shrink: 0;
}

.vp-header-kicker {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--bronze-600, #9a6a2c);
  margin-bottom: 2px;
}

.vp-header-title {
  font-size: 22px;
  font-weight: 700;
  color: var(--ink, #17140f);
  margin: 0;
  line-height: 1.25;
}

.vp-header-badges {
  display: flex;
  align-items: center;
  gap: 8px;
}

.vp-readonly-badge {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 4px 10px;
  border-radius: 99px;
  background: #dc262615;
  color: #dc2626;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.04em;
  border: 1px solid #dc262633;
}

.vp-partner-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 4px 10px;
  border-radius: 99px;
  background: var(--surface-sunken, #f2f0e9);
  color: var(--muted, #6f6a5c);
  font-size: 11px;
  font-weight: 600;
  border: 1px solid var(--line, #e7e2d5);
}

.vp-header-desc {
  font-size: 13.5px;
  color: var(--muted, #6f6a5c);
  line-height: 1.5;
  margin: 0 0 18px;
}

.vp-tabs {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  padding-top: 14px;
  border-top: 1px solid var(--line, #e7e2d5);
}

.vp-tab {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 7px 14px;
  border-radius: var(--radius-md, 8px);
  background: var(--surface-sunken, #f2f0e9);
  color: var(--muted, #6f6a5c);
  font-size: 12.5px;
  font-weight: 600;
  text-decoration: none;
  border: 1px solid var(--line, #e7e2d5);
  transition: all 0.15s ease;
}

.vp-tab:hover {
  background: var(--surface-hover, #f7f5ef);
  color: var(--ink, #17140f);
  border-color: var(--line-strong, #d7d0bd);
}

.vp-tab.active {
  background: var(--surface, #ffffff);
  color: var(--bronze-600, #9a6a2c);
  border-color: var(--bronze-400, #c99a5c);
  font-weight: 700;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
}

.vp-notice {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  background: var(--info-soft, #eaf1fb);
  border: 1px solid var(--info-border, rgba(44,92,158,0.2));
  border-radius: var(--radius-md, 8px);
  padding: 12px 16px;
  font-size: 12.5px;
  color: var(--info, #2c5c9e);
  line-height: 1.5;
}

.vp-notice svg {
  flex-shrink: 0;
  margin-top: 2px;
}

.vp-notice a {
  color: inherit;
  font-weight: 700;
  text-decoration: underline;
  text-underline-offset: 2px;
}

.vp-loading {
  color: var(--muted, #6f6a5c);
  font-size: 14px;
  padding: 48px 0;
  text-align: center;
}

.vp-error {
  color: var(--danger, #b23b35);
  font-size: 13.5px;
  padding: 16px 20px;
  background: var(--danger-soft, #fbeae7);
  border-radius: var(--radius-md, 8px);
  border: 1px solid var(--danger-border, rgba(178,59,53,0.2));
}

.vp-metric-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(190px, 1fr));
  gap: 14px;
  margin-bottom: 24px;
}

.vp-metric-card {
  background: var(--surface, #ffffff);
  border: 1px solid var(--line, #e7e2d5);
  border-radius: var(--radius-md, 10px);
  padding: 18px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.03);
}

.vp-metric-label {
  font-size: 11px;
  font-weight: 700;
  color: var(--muted, #6f6a5c);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin-bottom: 6px;
}

.vp-metric-value {
  font-size: 22px;
  font-weight: 800;
  color: var(--ink, #17140f);
  font-family: var(--font-mono, monospace);
}

.vp-toolbar {
  display: flex;
  gap: 12px;
  margin-bottom: 16px;
  flex-wrap: wrap;
  align-items: center;
}

.vp-search-wrap {
  position: relative;
}

.vp-search-wrap svg {
  position: absolute;
  left: 10px;
  top: 50%;
  transform: translateY(-50%);
  color: var(--muted, #6f6a5c);
  pointer-events: none;
}

.vp-input {
  background: var(--surface, #ffffff);
  border: 1px solid var(--line, #e7e2d5);
  border-radius: var(--radius-md, 8px);
  color: var(--ink, #17140f);
  font-size: 13px;
  padding: 8px 12px 8px 32px;
  outline: none;
  width: 220px;
  transition: border-color 0.15s;
}

.vp-input:focus {
  border-color: var(--bronze-500, #b17d38);
  box-shadow: 0 0 0 2px var(--bronze-100, #f4e7d2);
}

.vp-select {
  background: var(--surface, #ffffff);
  border: 1px solid var(--line, #e7e2d5);
  border-radius: var(--radius-md, 8px);
  color: var(--ink, #17140f);
  font-size: 13px;
  padding: 8px 12px;
  outline: none;
  cursor: pointer;
}

.vp-select:focus {
  border-color: var(--bronze-500, #b17d38);
}

.vp-card {
  background: var(--surface, #ffffff);
  border: 1px solid var(--line, #e7e2d5);
  border-radius: var(--radius-lg, 12px);
  padding: 20px;
  box-shadow: 0 1px 3px rgba(0,0,0,0.03);
}

.vp-table-wrap {
  overflow-x: auto;
  background: var(--surface, #ffffff);
  border: 1px solid var(--line, #e7e2d5);
  border-radius: var(--radius-lg, 12px);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.03);
}

.vp-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}

.vp-table th {
  background: var(--surface-sunken, #f2f0e9);
  color: var(--muted, #6f6a5c);
  font-weight: 700;
  font-size: 11px;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  padding: 10px 14px;
  text-align: left;
  border-bottom: 1px solid var(--line, #e7e2d5);
}

.vp-table td {
  padding: 11px 14px;
  border-bottom: 1px solid var(--line, #e7e2d5);
  color: var(--ink, #17140f);
  vertical-align: middle;
}

.vp-table tr:last-child td {
  border-bottom: none;
}

.vp-table tr:hover td {
  background: var(--surface-hover, #f7f5ef);
}

.vp-table .vp-amount {
  text-align: right;
  font-variant-numeric: tabular-nums;
  font-family: var(--font-mono, monospace);
  font-weight: 600;
}

.vp-badge {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 99px;
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.03em;
  border: 1px solid transparent;
}

.vp-btn-link {
  background: transparent;
  border: none;
  color: var(--color-info, #2c5c9e);
  cursor: pointer;
  font-size: 12.5px;
  padding: 3px 6px;
  text-decoration: underline;
  text-underline-offset: 2px;
  font-weight: 600;
}

.vp-btn-link:hover {
  color: var(--ink, #17140f);
}

.vp-btn-icon {
  background: var(--surface-sunken, #f2f0e9);
  border: 1px solid var(--line, #e7e2d5);
  border-radius: 6px;
  color: var(--muted, #6f6a5c);
  cursor: pointer;
  padding: 5px 8px;
  font-size: 11px;
  font-weight: 600;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  transition: all 0.15s;
}

.vp-btn-icon:hover {
  border-color: var(--bronze-500, #b17d38);
  color: var(--ink, #17140f);
  background: var(--surface, #ffffff);
}

.vp-profile-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}

.vp-profile-card {
  background: var(--surface, #ffffff);
  border: 1px solid var(--line, #e7e2d5);
  border-radius: var(--radius-lg, 12px);
  padding: 20px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.03);
}

.vp-profile-card h3 {
  font-size: 11px;
  font-weight: 700;
  color: var(--muted, #6f6a5c);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  margin: 0 0 12px;
}

.vp-profile-row {
  display: flex;
  justify-content: space-between;
  padding: 7px 0;
  border-bottom: 1px solid var(--line, #e7e2d5);
  font-size: 13px;
}

.vp-profile-row:last-child {
  border-bottom: none;
}

.vp-profile-key {
  color: var(--muted, #6f6a5c);
  font-weight: 500;
}

.vp-profile-val {
  color: var(--ink, #17140f);
  font-weight: 600;
  text-align: right;
}

.vp-modal {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.55);
  backdrop-filter: blur(2px);
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
}

.vp-modal-inner {
  background: var(--surface, #ffffff);
  border: 1px solid var(--line-strong, #d7d0bd);
  border-radius: var(--radius-lg, 14px);
  max-width: 760px;
  width: 100%;
  max-height: 90vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.15);
}

.vp-modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid var(--line, #e7e2d5);
  background: var(--surface-sunken, #f2f0e9);
}

.vp-modal-title {
  font-size: 16px;
  font-weight: 700;
  color: var(--ink, #17140f);
}

.vp-modal-body {
  padding: 20px;
  overflow-y: auto;
}

.vp-modal-close {
  background: transparent;
  border: none;
  color: var(--muted, #6f6a5c);
  cursor: pointer;
  font-size: 22px;
  line-height: 1;
  padding: 2px 6px;
  border-radius: 6px;
}

.vp-modal-close:hover {
  color: var(--ink, #17140f);
  background: var(--line, #e7e2d5);
}

.vp-empty {
  text-align: center;
  padding: 56px 20px;
  color: var(--muted, #6f6a5c);
}

.vp-empty-icon {
  margin-bottom: 10px;
  opacity: 0.5;
}

.vp-empty-text {
  font-size: 14px;
  font-weight: 500;
}

.vp-pagination {
  display: flex;
  align-items: center;
  gap: 12px;
  justify-content: flex-end;
  margin-top: 12px;
  font-size: 12px;
  color: var(--muted, #6f6a5c);
}

@media (max-width: 768px) {
  .vp-profile-grid {
    grid-template-columns: 1fr;
  }
  .vp-header-top {
    flex-direction: column;
    align-items: flex-start;
  }
}
</style>`;

// ─── Main Render Function ─────────────────────────────────────────────────────
export function renderVendorPortal(activeRoute = "vendor-orders", subroute = "") {
  const normalizedRoute = activeRoute || "vendor-orders";
  const title = SECTION_TITLES[normalizedRoute] || "Vendor Portal";
  const description = SECTION_DESCRIPTIONS[normalizedRoute] || "Zamorin Café Enterprise Vendor Workspace.";
  const panelFn = SECTION_CONTENT[normalizedRoute] || renderOrdersContent;
  const vendorName = state.user?.name || "Demo Supplier Co.";
  const vendorId = state.user?.vendorId || "VENDOR-DEMO-001";

  const tabs = [
    { route: "vendor-dashboard", label: "Overview" },
    { route: "vendor-orders", label: "Issued Orders" },
    { route: "vendor-deliveries", label: "Deliveries" },
    { route: "vendor-statements", label: "Statements" },
    { route: "vendor-profile", label: "Business Profile" },
  ];

  return `
${VENDOR_PORTAL_CSS}
<div class="vp-page-container" data-active-route="${normalizedRoute}">
  <!-- Header Card with Section Meta & Quick Navigation Tabs -->
  <header class="vp-header-card">
    <div class="vp-header-top">
      <div class="vp-header-identity">
        <div class="vp-header-icon-box">🏢</div>
        <div>
          <div class="vp-header-kicker">Zamorin Supplier Workspace · Fifth Window</div>
          <h1 class="vp-header-title">${title}</h1>
        </div>
      </div>
      <div class="vp-header-badges">
        ${readOnlyBadge()}
        <span class="vp-partner-chip" title="${vendorName} (${vendorId})">
          <span>${vendorName}</span>
          <span style="opacity:0.6;">·</span>
          <span style="font-family:var(--font-mono, monospace); font-size:10.5px;">${vendorId}</span>
        </span>
      </div>
    </div>

    <p class="vp-header-desc">${description}</p>

    <!-- Quick Navigation Pill Tabs -->
    <nav class="vp-tabs" role="tablist" aria-label="Vendor Portal Sections">
      ${tabs.map(t => {
        const isActive = t.route === normalizedRoute || (normalizedRoute === "vendor-portal" && t.route === "vendor-orders");
        return `<a href="#${t.route}" class="vp-tab${isActive ? " active" : ""}" role="tab" aria-selected="${isActive}">
          ${t.label}
        </a>`;
      }).join("")}
    </nav>
  </header>

  <!-- Notice Banner -->
  <div class="vp-notice" role="note" aria-label="Portal Security Notice">
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>
    <div>
      <strong>Strict Read-Only Enterprise Invariant:</strong>
      All records shown in this window are official certifications released by Zamorin Café ERP. Mutation, cashiering, and inventory adjustments are strictly restricted to Central Operations. Inquiries: <a href="mailto:procurement@zamorin.test">procurement@zamorin.test</a>.
    </div>
  </div>

  <!-- Main Panel Body -->
  <section class="vp-panel-wrap" aria-labelledby="vp-panel-heading">
    <h2 id="vp-panel-heading" class="sr-only" style="display:none;">${title} Content</h2>
    ${panelFn()}
  </section>
</div>`;
}

// ─── Wire Function ─────────────────────────────────────────────────────────────
export function wireVendorPortal(container, activeRoute = "vendor-orders") {
  const normalizedRoute = activeRoute || "vendor-orders";

  // Tab navigation
  container.querySelectorAll(".vp-tab").forEach(tab => {
    tab.addEventListener("click", (e) => {
      const href = tab.getAttribute("href");
      if (href && href.startsWith("#") && typeof window !== "undefined") {
        window.location.hash = href;
      }
    });
  });

  // Load appropriate panel data
  switch (normalizedRoute) {
    case "vendor-dashboard":
      _loadDashboard(container);
      break;
    case "vendor-orders":
    case "vendor-portal":
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
    default:
      _loadOrders(container, {});
  }
}

// ─── Panel Data Loaders ───────────────────────────────────────────────────────

async function _loadDashboard(container) {
  const loadEl = container.querySelector("#vp-dashboard-loading");
  const dataEl = container.querySelector("#vp-dashboard-data");

  let d = null;
  try {
    const res = await apiGet("/vendor-portal/dashboard");
    if (res?.data) d = res.data;
  } catch (err) {
    if (isDevOrLocalhost()) {
      d = CANONICAL_FIXTURES.dashboard;
    } else {
      if (loadEl) loadEl.outerHTML = `<div class="vp-error">Failed to load supplier overview: ${err?.message || "Authenticated session required"}</div>`;
      return;
    }
  }

  if (!d && isDevOrLocalhost()) {
    d = CANONICAL_FIXTURES.dashboard;
  }

  loadEl?.remove();
  if (dataEl && d) {
    dataEl.hidden = false;
    dataEl.innerHTML = `
<div class="vp-metric-grid">
  <div class="vp-metric-card">
    <div class="vp-metric-label">Total Issued Orders</div>
    <div class="vp-metric-value">${d.totalIssuedOrdersCount ?? 0}</div>
  </div>
  <div class="vp-metric-card">
    <div class="vp-metric-label">Pending Deliveries</div>
    <div class="vp-metric-value" style="color:var(--color-warning, #a9741a);">${d.pendingDeliveriesCount ?? 0}</div>
  </div>
  <div class="vp-metric-card">
    <div class="vp-metric-label">Completed Orders</div>
    <div class="vp-metric-value" style="color:var(--color-success, #1e7a4c);">${d.completedOrdersCount ?? 0}</div>
  </div>
  <div class="vp-metric-card">
    <div class="vp-metric-label">Total Issued Value</div>
    <div class="vp-metric-value">${formatRupees(d.totalIssuedValuePaisa)}</div>
  </div>
  <div class="vp-metric-card">
    <div class="vp-metric-label">Pending Delivery Value</div>
    <div class="vp-metric-value" style="color:var(--color-warning, #a9741a);">${formatRupees(d.pendingDeliveryValuePaisa)}</div>
  </div>
  <div class="vp-metric-card">
    <div class="vp-metric-label">Last Order Date</div>
    <div class="vp-metric-value" style="font-size:15px; padding-top:4px;">${formatDate(d.lastOrderDate)}</div>
  </div>
</div>

${d.recentOrders?.length ? `
<div class="vp-card" style="margin-top:14px;">
  <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:14px;">
    <h3 style="font-size:12px; font-weight:700; color:var(--muted); text-transform:uppercase; letter-spacing:0.06em; margin:0;">Recent Purchase Orders</h3>
    <a href="#vendor-orders" class="vp-btn-link">View All Orders →</a>
  </div>
  <div class="vp-table-wrap">
    <table class="vp-table" role="table" aria-label="Recent orders">
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
    </table>
  </div>
</div>` : ""}`;
  }
}

async function _loadOrders(container, { page = 1, status = "ALL", search = "" } = {}) {
  const loadEl = container.querySelector("#vp-orders-loading");
  const dataEl = container.querySelector("#vp-orders-data");
  const searchInput = container.querySelector("#vp-order-search");
  const statusSelect = container.querySelector("#vp-status-filter");

  // Wire search/filter once
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

  let orders = null;
  let pagination = {};

  try {
    if (loadEl) loadEl.hidden = false;
    if (dataEl) dataEl.hidden = true;

    const res = await apiGet(`/vendor-portal/orders?${params.toString()}`);
    if (Array.isArray(res?.data)) {
      orders = res.data;
      pagination = res.pagination || {};
    }
  } catch (err) {
    if (isDevOrLocalhost()) {
      let filtered = [...CANONICAL_FIXTURES.orders];
      if (status && status !== "ALL") {
        filtered = filtered.filter(o => o.status === status);
      }
      if (search) {
        const q = search.toLowerCase();
        filtered = filtered.filter(o => o.purchaseOrderId.toLowerCase().includes(q) || o.cafeId.toLowerCase().includes(q));
      }
      orders = filtered;
      pagination = { total: filtered.length };
    } else {
      if (loadEl) loadEl.hidden = true;
      if (dataEl) {
        dataEl.hidden = false;
        dataEl.innerHTML = `<div class="vp-error">Failed to load orders: ${err?.message || "Authenticated session required"}</div>`;
      }
      return;
    }
  }

  if (orders === null && isDevOrLocalhost()) {
    orders = CANONICAL_FIXTURES.orders;
    pagination = { total: orders.length };
  }

  if (loadEl) loadEl.hidden = true;
  if (dataEl && orders) {
    dataEl.hidden = false;
    if (!orders.length) {
      dataEl.innerHTML = `
        <div class="vp-empty">
          <div class="vp-empty-icon">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M6 6h15l-1.5 9h-12Z"/><circle cx="9" cy="19" r="1.4"/><circle cx="17" cy="19" r="1.4"/><path d="M3 3h2l1 3"/></svg>
          </div>
          <div class="vp-empty-text">No issued orders match your current filters.</div>
        </div>`;
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
      <th scope="col" style="text-align:right;">Actions</th>
    </tr></thead>
    <tbody>
      ${orders.map(o => `<tr>
        <td><strong>${o.purchaseOrderId}</strong></td>
        <td>${o.cafeId}</td>
        <td>${formatDate(o.orderDate)}</td>
        <td>${formatDate(o.expectedDeliveryDate)}</td>
        <td>${statusBadge(o.status)}</td>
        <td class="vp-amount">${formatRupees(o.totalPaisa)}</td>
        <td>${o.itemCount} items</td>
        <td style="text-align:right;">
          <button class="vp-btn-link" data-order-id="${o.purchaseOrderId}" aria-label="View details for order ${o.purchaseOrderId}">View PO</button>
          <button class="vp-btn-icon" data-print-id="${o.purchaseOrderId}" aria-label="Print order ${o.purchaseOrderId}" title="Print Official PDF">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>
            Print
          </button>
        </td>
      </tr>`).join("")}
    </tbody>
  </table>
</div>
<div class="vp-pagination" aria-label="Pagination">
  <span>Showing ${orders.length} of ${pagination.total ?? orders.length} orders</span>
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
}

async function _openOrderModal(container, purchaseOrderId) {
  const modal = container.querySelector("#vp-order-modal");
  if (!modal) return;
  modal.hidden = false;
  modal.innerHTML = `
    <div class="vp-modal-inner" role="document">
      <div class="vp-modal-header">
        <span class="vp-modal-title">Loading Purchase Order…</span>
        <button class="vp-modal-close" aria-label="Close" id="vp-close-modal">×</button>
      </div>
      <div class="vp-modal-body">
        <div class="vp-loading">Fetching order details…</div>
      </div>
    </div>`;

  modal.querySelector("#vp-close-modal")?.addEventListener("click", () => { modal.hidden = true; modal.innerHTML = ""; });
  modal.addEventListener("click", (e) => { if (e.target === modal) { modal.hidden = true; modal.innerHTML = ""; } });

  let o = null;
  try {
    const res = await apiGet(`/vendor-portal/orders/${encodeURIComponent(purchaseOrderId)}`);
    if (res?.data) o = res.data;
  } catch (err) {
    if (isDevOrLocalhost()) {
      o = {
        ...CANONICAL_FIXTURES.sampleOrderDetails,
        purchaseOrderId,
      };
    }
  }

  if (!o && isDevOrLocalhost()) {
    o = {
      ...CANONICAL_FIXTURES.sampleOrderDetails,
      purchaseOrderId,
    };
  }

  if (o) {
    const li = o.lineItems || [];
    modal.querySelector(".vp-modal-inner").innerHTML = `
<div class="vp-modal-header">
  <div>
    <div class="vp-modal-title">PO: ${o.purchaseOrderId}</div>
    <div style="font-size:12px; color:var(--muted); margin-top:3px; display:flex; align-items:center; gap:6px;">
      ${statusBadge(o.status)}
      ${readOnlyBadge()}
    </div>
  </div>
  <button class="vp-modal-close" aria-label="Close order details" id="vp-close-modal2">×</button>
</div>
<div class="vp-modal-body">
  <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(160px, 1fr)); gap:12px; margin-bottom:18px; font-size:12.5px; background:var(--surface-sunken); padding:12px 16px; border-radius:8px;">
    <div><span style="color:var(--muted);">Outlet:</span> <strong style="display:block; color:var(--ink);">${o.cafeId}</strong></div>
    <div><span style="color:var(--muted);">Order Date:</span> <strong style="display:block; color:var(--ink);">${formatDate(o.orderDate)}</strong></div>
    <div><span style="color:var(--muted);">Expected Delivery:</span> <strong style="display:block; color:var(--ink);">${formatDate(o.expectedDeliveryDate)}</strong></div>
    <div><span style="color:var(--muted);">Payment Terms:</span> <strong style="display:block; color:var(--ink);">${o.paymentTerms || "NET_30"}</strong></div>
  </div>

  <table class="vp-table" aria-label="Line items">
    <thead><tr><th>#</th><th>Item & Code</th><th>Pack Size</th><th class="vp-amount">Qty</th><th class="vp-amount">Rate</th><th class="vp-amount">GST</th><th class="vp-amount">Total</th></tr></thead>
    <tbody>
      ${li.map((item, idx) => `<tr>
        <td>${idx + 1}</td>
        <td><strong>${item.itemName}</strong>${item.supplierItemCode ? `<br><span style="font-size:11px; color:var(--muted); font-family:var(--font-mono, monospace);">${item.supplierItemCode}</span>` : ""}</td>
        <td>${item.packSize || "1 UNIT"}</td>
        <td class="vp-amount">${item.quantityOrdered}</td>
        <td class="vp-amount">${formatRupees(item.unitPricePaisa)}</td>
        <td class="vp-amount">${item.gstPercent || 0}%</td>
        <td class="vp-amount">${formatRupees(item.lineTotalPaisa)}</td>
      </tr>`).join("")}
    </tbody>
    <tfoot>
      <tr><td colspan="6" style="text-align:right; font-weight:700; color:var(--muted);">Subtotal</td><td class="vp-amount" style="font-weight:700;">${formatRupees(o.subtotalPaisa)}</td></tr>
      <tr><td colspan="6" style="text-align:right; font-weight:700; color:var(--muted);">Tax</td><td class="vp-amount" style="font-weight:700;">${formatRupees(o.taxPaisa)}</td></tr>
      <tr><td colspan="6" style="text-align:right; font-weight:800; color:var(--bronze-600, #9a6a2c); font-size:15px;">Grand Total</td><td class="vp-amount" style="font-weight:800; color:var(--bronze-600, #9a6a2c); font-size:15px;">${formatRupees(o.totalPaisa)}</td></tr>
    </tfoot>
  </table>
  <div style="margin-top:14px; font-size:11.5px; color:var(--muted); line-height:1.4;">${o.clarificationNotice || ""}</div>
</div>`;
    modal.querySelector("#vp-close-modal2")?.addEventListener("click", () => { modal.hidden = true; modal.innerHTML = ""; });
  } else {
    modal.querySelector(".vp-modal-inner").innerHTML = `
      <div class="vp-modal-header"><span class="vp-modal-title">Error</span><button class="vp-modal-close" id="vp-close-modal3">×</button></div>
      <div class="vp-modal-body"><div class="vp-error">Could not load details for order ${purchaseOrderId}.</div></div>`;
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

  let deliveries = null;
  try {
    const res = await apiGet("/vendor-portal/deliveries");
    if (Array.isArray(res?.data)) deliveries = res.data;
  } catch (err) {
    if (isDevOrLocalhost()) {
      deliveries = CANONICAL_FIXTURES.deliveries;
    } else {
      if (loadEl) loadEl.outerHTML = `<div class="vp-error">Failed to load deliveries: ${err?.message || "Authenticated session required"}</div>`;
      return;
    }
  }

  if (!deliveries && isDevOrLocalhost()) {
    deliveries = CANONICAL_FIXTURES.deliveries;
  }

  if (loadEl) loadEl.hidden = true;
  if (dataEl && deliveries) {
    dataEl.hidden = false;
    if (!deliveries.length) {
      dataEl.innerHTML = `
        <div class="vp-empty">
          <div class="vp-empty-icon">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M20 7 12 3 4 7v10l8 4 8-4Z"/></svg>
          </div>
          <div class="vp-empty-text">No delivery receipts found for this vendor account.</div>
        </div>`;
    } else {
      dataEl.innerHTML = `
<div class="vp-table-wrap">
  <table class="vp-table" role="table" aria-label="Delivery receipts">
    <thead><tr><th>GRN ID</th><th>Purchase Order</th><th>Outlet</th><th>Received At</th><th>Status</th><th>Items Received</th></tr></thead>
    <tbody>
      ${deliveries.map(d => `<tr>
        <td><strong>${d.grnId}</strong></td>
        <td>${d.purchaseOrderId}</td>
        <td>${d.cafeId}</td>
        <td>${formatDate(d.receivedAt)}</td>
        <td>${statusBadge(d.status || "VERIFIED_PHYSICAL_RECEIPT")}</td>
        <td>${d.itemCount} line items</td>
      </tr>`).join("")}
    </tbody>
  </table>
</div>`;
    }
  }
}

async function _loadStatements(container) {
  const loadEl = container.querySelector("#vp-statements-loading");
  const dataEl = container.querySelector("#vp-statements-data");

  let entries = null;
  let notice = null;

  try {
    const res = await apiGet("/vendor-portal/statements");
    if (Array.isArray(res?.data)) {
      entries = res.data;
      notice = res.readOnlyNotice;
    }
  } catch (err) {
    if (isDevOrLocalhost()) {
      entries = CANONICAL_FIXTURES.statements;
      notice = "Official financial ledger maintained by Enterprise Accounts Payable.";
    } else {
      if (loadEl) loadEl.outerHTML = `<div class="vp-error">Failed to load statements: ${err?.message || "Authenticated session required"}</div>`;
      return;
    }
  }

  if (!entries && isDevOrLocalhost()) {
    entries = CANONICAL_FIXTURES.statements;
    notice = "Official financial ledger maintained by Enterprise Accounts Payable.";
  }

  if (loadEl) loadEl.hidden = true;
  if (dataEl && entries) {
    dataEl.hidden = false;
    if (!entries.length) {
      dataEl.innerHTML = `
        <div class="vp-empty">
          <div class="vp-empty-icon">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M12 1v22M17 5.5c0-1.9-2.2-3-5-3s-5 1.3-5 3 2.2 2.6 5 3 5 1.1 5 3-2.2 3-5 3-5-1.1-5-3"/></svg>
          </div>
          <div class="vp-empty-text">No ledger entries recorded yet.</div>
        </div>`;
    } else {
      dataEl.innerHTML = `
<div class="vp-table-wrap">
  <table class="vp-table" role="table" aria-label="Account statements">
    <thead><tr><th>Entry ID</th><th>Posting Date</th><th>Transaction Type</th><th>Reference</th><th class="vp-amount">Amount</th><th class="vp-amount">Running Balance</th><th>Status</th></tr></thead>
    <tbody>
      ${entries.map(e => `<tr>
        <td style="font-size:11px; color:var(--muted); font-family:var(--font-mono, monospace);">${e.entryId}</td>
        <td>${formatDate(e.postingDate || e.entryDate)}</td>
        <td><strong>${e.transactionType || e.entryType}</strong></td>
        <td>${e.documentReference || "—"}</td>
        <td class="vp-amount">${formatRupees(typeof e.amountPaisa === "number" ? e.amountPaisa : (e.creditPaisa || e.debitPaisa))}</td>
        <td class="vp-amount" style="font-weight:700; color:var(--ink);">${formatRupees(e.runningBalancePaisa)}</td>
        <td>${statusBadge(e.status || "SETTLED")}</td>
      </tr>`).join("")}
    </tbody>
  </table>
</div>`;
    }
  }
}

async function _loadProfile(container) {
  const loadEl = container.querySelector("#vp-profile-loading");
  const dataEl = container.querySelector("#vp-profile-data");

  let p = null;
  try {
    const res = await apiGet("/vendor-portal/profile");
    if (res?.data) p = res.data;
  } catch (err) {
    if (isDevOrLocalhost()) {
      p = CANONICAL_FIXTURES.profile;
    } else {
      if (loadEl) loadEl.outerHTML = `<div class="vp-error">Failed to load business profile: ${err?.message || "Authenticated session required"}</div>`;
      return;
    }
  }

  if (!p && isDevOrLocalhost()) {
    p = CANONICAL_FIXTURES.profile;
  }

  if (loadEl) loadEl.hidden = true;
  if (dataEl && p) {
    dataEl.hidden = false;
    dataEl.innerHTML = `
<div class="vp-profile-grid">
  <div class="vp-profile-card">
    <h3>Enterprise Business Identity</h3>
    ${[
      ["Legal Business Name", p.legalBusinessName],
      ["Trade Name", p.tradeName],
      ["Category", p.vendorCategory],
      ["Supplier Type", p.supplierType],
      ["Verification Status", p.status],
      ["GSTIN", p.gstin || "—"],
      ["PAN (Masked)", p.panMasked || "—"],
      ["FSSAI Licence No.", p.fssaiLicenseNumber || "—"],
      ["Payment Terms", p.paymentTerms],
      ["Registered Office", p.registeredOfficeAddress || "—"],
    ].map(([k, v]) => `<div class="vp-profile-row"><span class="vp-profile-key">${k}</span><span class="vp-profile-val">${v || "—"}</span></div>`).join("")}
  </div>

  <div class="vp-profile-card">
    <h3>Disbursement Banking Details</h3>
    ${[
      ["Bank Name", p.bankDetails?.bankName],
      ["Account Holder", p.bankDetails?.accountHolderName],
      ["Account No. (Masked)", p.bankDetails?.accountNumberMasked],
      ["IFSC Code", p.bankDetails?.ifscCode],
      ["Branch Name", p.bankDetails?.branchName],
    ].map(([k, v]) => `<div class="vp-profile-row"><span class="vp-profile-key">${k}</span><span class="vp-profile-val">${v || "—"}</span></div>`).join("")}
    <div style="margin-top:14px; font-size:11.5px; color:var(--muted); line-height:1.5; background:var(--surface-sunken); padding:10px 12px; border-radius:6px;">
      🔒 Bank account modifications require dual-key verification via authenticated communication with Central Accounts.
    </div>
  </div>

  ${p.primaryContact ? `
  <div class="vp-profile-card">
    <h3>Primary Account Contact</h3>
    ${[
      ["Contact Name", p.primaryContact?.name],
      ["Telephone", p.primaryContact?.phone],
      ["Email Address", p.primaryContact?.email],
      ["Designation", p.primaryContact?.designation],
    ].map(([k, v]) => `<div class="vp-profile-row"><span class="vp-profile-key">${k}</span><span class="vp-profile-val">${v || "—"}</span></div>`).join("")}
  </div>` : ""}

  <div class="vp-profile-card">
    <h3>Procurement Help Desk</h3>
    ${[
      ["Support Channel", p.supportContact?.role],
      ["Direct Phone", p.supportContact?.phone],
      ["Inquiries Email", p.supportContact?.email],
    ].map(([k, v]) => `<div class="vp-profile-row"><span class="vp-profile-key">${k}</span><span class="vp-profile-val">${v || "—"}</span></div>`).join("")}
    <div style="margin-top:12px; font-size:11.5px; color:var(--muted); line-height:1.4;">
      ${p.supportContact?.helpNotice || "Contact Café Operations directly for order inquiries or delivery dock scheduling."}
    </div>
  </div>
</div>`;
  }
}
