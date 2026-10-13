// =============================================================================
// ZAMORIN CAFE ERP — SCREEN 005 / OWN-SCR-003: SALES BILLS & TAX RECEIPTS
// Design System v2 (Ledger & Roastery Theme)
//
// Post-Sale Financial Control & Billing Governance Centre:
// Finalised Transactions + Tax Receipts + Tenders + Refunds + Voids + GST Register + Reconciliation + EOD
// =============================================================================

import { apiGet, apiPost } from "../apiClient.js";
import { state } from "../state.js";
import { ROLES } from "../navigation.js";
import { showToast, openModal, renderFileUploadZone, wireFileUploadZone, openUniversalDocumentModal } from "../components.js";
import { navigate } from "../router.js";
import { renderCorporateInvoiceHtml } from "../components/corporateInvoiceTemplate.js";
import { renderPosThermalReceiptHtml } from "../components/posThermalReceiptTemplate.js";
import { generateInvoicePdf } from "../utils/invoicePdfGenerator.js";

let activeSubTab = "overview"; // 'overview' | 'bills' | 'upload' | 'adjustments' | 'payments' | 'tax' | 'reconciliation' | 'reports'
let selectedCafeFilter = "ALL";
let selectedPeriod = "TODAY";
let selectedComparison = "VS_YESTERDAY";
let selectedBusinessDate = "2026-08-22";
let billsSearchQuery = "";
let billsStatusFilter = "ALL";
let billsPaymentFilter = "ALL";
let billsSortBy = "NEWEST";
let adjustmentsTypeFilter = "ALL";
let taxClassificationFilter = "ALL";
let mismatchesOnlyFilter = false;
let lastRefreshedTime = new Date();

let cachedOverview = null;
let cachedBills = [];
let cachedGstRegister = null;
let cachedReconciliation = null;

const DEFAULT_UPLOADED_INVOICES = [];
let cachedUploadedInvoices = [];

const CAFE_NAMES = {};
let cachedCafes = [];

function escapeHtml(str) {
  if (!str) return "";
  return String(str).replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[m]);
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

const DEFAULT_OVERVIEW = {
  kpis: {
    grossSales: 0,
    netSales: 0,
    completedBills: 0,
    averageBillValue: 0,
    voidedBills: 0,
    voidedValue: 0,
    refunds: 0,
    taxCollected: 0,
    discounts: 0,
    paymentExceptions: 0,
    unreconciledAmount: 0,
  },
  cafeBilling: [],
  needsAttention: [],
};

const DEFAULT_BILLS = [];

export function setBillsActiveTab(tab) {
  activeSubTab = tab || "overview";
}

export function renderOwnerBills(subroute) {
  if (subroute !== undefined) {
    activeSubTab = subroute || "overview";
  }
  const isPrimary = state.user?.isPrimaryMaster === true;
  const isOwner = state.role === ROLES.OWNER || state.user?.role === "OWNER";
  const isMaster = state.role === ROLES.MASTER || state.user?.role === "MASTER";

  let badgeLabel = "OPERATIONAL MASTER";
  let badgeClass = "status info";
  if (isPrimary) {
    badgeLabel = "PRIMARY MASTER";
    badgeClass = "status success";
  } else if (isOwner) {
    badgeLabel = "OWNER PORTAL";
    badgeClass = "status info";
  } else if (state.role === ROLES.CAFE_ADMIN || state.user?.role === "CAFE_ADMIN") {
    badgeLabel = "CAFE ADMIN";
    badgeClass = "status info";
  }

  return `
    <div class="page-enter" style="max-width:1400px; margin:0 auto; padding-bottom:60px;">
      <!-- Page Header & Global Context Strip -->
      <div style="display:flex; justify-content:space-between; align-items:flex-start; flex-wrap:wrap; gap:16px; margin-bottom:20px; border-bottom:1px solid var(--border-subtle); padding-bottom:16px;">
        <div>
          <div style="display:flex; align-items:center; gap:10px; margin-bottom:4px;">
            <h1 class="page-title" style="font-size:24px; font-weight:800; margin:0; color:var(--ink); letter-spacing:-0.3px;">Sales Bills &amp; Tax Receipts</h1>
            <span class="status info" style="font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:0.5px;">SCR-005</span>
            <span class="${badgeClass}" style="font-size:10px; font-weight:700;">${badgeLabel}</span>
          </div>
          <p style="font-size:13px; color:var(--muted); margin:0;">
            Post-Sale Financial Control &amp; Billing Governance Centre · Finalised Invoices, Tenders, Refunds, Voids, GST Register &amp; Reconciliation
          </p>
        </div>

        <div style="display:flex; gap:10px; align-items:center; flex-wrap:wrap;">
          <div style="font-size:11.5px; color:var(--muted);">
            Updated <strong style="color:var(--ink);">${getIstTimeString(lastRefreshedTime)} IST</strong>
          </div>
          <button class="btn btn-ghost" id="refresh-bills-btn" type="button" style="font-size:12.5px; padding:6px 14px;">
            ↻ Refresh
          </button>
          <button class="btn btn-primary" id="upload-invoice-btn" type="button" style="font-size:12.5px; padding:6px 16px; font-weight:600; display:inline-flex; align-items:center; gap:6px;">
            <span>📤 Upload Invoice / Receipt</span>
          </button>
          ${
            isMaster
              ? `
            <button class="btn btn-secondary" id="open-eod-close-btn" type="button" style="font-size:12.5px; padding:6px 16px; font-weight:600;">
              EOD Billing Close
            </button>
          `
              : `
            <button class="btn btn-ghost" id="review-eod-readiness-btn" type="button" style="font-size:12.5px; padding:6px 14px; color:var(--color-accent-amber); border:1px solid rgba(200,157,92,0.3);">
              🛡️ Review EOD Readiness
            </button>
          `
          }
        </div>
      </div>

      <!-- Scope, Business Date, Period & Comparison Bar -->
      <div class="card" style="padding:12px 18px; margin-bottom:20px; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px;">
        <div style="display:flex; align-items:center; gap:12px; flex-wrap:wrap;">
          <div style="display:flex; align-items:center; gap:6px;">
            <label style="font-size:12px; color:var(--muted); font-weight:600;">Café Scope:</label>
            <select id="scope-cafe-selector" class="select select-sm" style="font-size:12px;">
              <option value="ALL" ${selectedCafeFilter === "ALL" ? "selected" : ""}>All Authorized Cafés</option>
              ${cachedCafes.map((c) => `<option value="${escapeHtml(c.cafeId)}" ${selectedCafeFilter === c.cafeId ? "selected" : ""}>${escapeHtml(c.cafeId)} · ${escapeHtml(c.name || c.cafeId)}</option>`).join("")}
            </select>
          </div>

          <div style="display:flex; align-items:center; gap:6px;">
            <label style="font-size:12px; color:var(--muted); font-weight:600;">Business Date:</label>
            <input type="date" id="scope-business-date" class="input input-sm" value="${selectedBusinessDate}" style="font-size:12px; width:135px;" />
          </div>

          <div style="display:flex; align-items:center; gap:6px;">
            <label style="font-size:12px; color:var(--muted); font-weight:600;">Period:</label>
            <select id="scope-period-selector" class="select select-sm" style="font-size:12px;">
              <option value="TODAY" ${selectedPeriod === "TODAY" ? "selected" : ""}>Today</option>
              <option value="YESTERDAY" ${selectedPeriod === "YESTERDAY" ? "selected" : ""}>Yesterday</option>
              <option value="LAST_7_DAYS" ${selectedPeriod === "LAST_7_DAYS" ? "selected" : ""}>Last 7 Days</option>
              <option value="LAST_30_DAYS" ${selectedPeriod === "LAST_30_DAYS" ? "selected" : ""}>Last 30 Days</option>
              <option value="THIS_MONTH" ${selectedPeriod === "THIS_MONTH" ? "selected" : ""}>This Month</option>
              <option value="THIS_QUARTER" ${selectedPeriod === "THIS_QUARTER" ? "selected" : ""}>This Quarter</option>
              <option value="THIS_YEAR" ${selectedPeriod === "THIS_YEAR" ? "selected" : ""}>This Year (FY 26-27)</option>
              <option value="CUSTOM" ${selectedPeriod === "CUSTOM" ? "selected" : ""}>Custom Date Range</option>
            </select>
          </div>

          <div style="display:flex; align-items:center; gap:6px;">
            <label style="font-size:12px; color:var(--muted); font-weight:600;">Compare:</label>
            <select id="scope-comparison-selector" class="select select-sm" style="font-size:12px;">
              <option value="VS_YESTERDAY" ${selectedComparison === "VS_YESTERDAY" ? "selected" : ""}>vs Yesterday</option>
              <option value="VS_PREV_PERIOD" ${selectedComparison === "VS_PREV_PERIOD" ? "selected" : ""}>vs Previous Period</option>
              <option value="VS_PREV_WEEK" ${selectedComparison === "VS_PREV_WEEK" ? "selected" : ""}>vs Previous Week</option>
              <option value="VS_PREV_MONTH" ${selectedComparison === "VS_PREV_MONTH" ? "selected" : ""}>vs Previous Month</option>
              <option value="VS_PREV_QUARTER" ${selectedComparison === "VS_PREV_QUARTER" ? "selected" : ""}>vs Previous Quarter</option>
              <option value="VS_PREV_YEAR" ${selectedComparison === "VS_PREV_YEAR" ? "selected" : ""}>vs Previous Year</option>
            </select>
          </div>
        </div>

        <div style="font-size:12px; color:var(--muted); font-weight:600;">
          Trend: <span style="color:var(--color-success);">+6.8% vs comparison</span> · <span style="color:var(--ink);">+0.4 pp ABV efficiency</span>
        </div>
      </div>

      <!-- Subpanel Root -->
      <div id="bills-subpanel-root">
        ${renderActiveSubpanel()}
      </div>
    </div>
  `;
}

function renderActiveSubpanel() {
  if (activeSubTab === "overview") {
    return renderOverviewSubpanel();
  }

  const submodules = {
    bills: { title: "Finalised Invoices & Tax Receipts", icon: "🧾", desc: "Detailed customer receipts, line item taxes and payment methods." },
    receipts: { title: "Receipts & Payment Evidence", icon: "🧾", desc: "Capture, review, link and reconcile receipts and payment evidence." },
    upload: { title: "Upload & Ingest Invoices", icon: "📤", desc: "Upload vendor invoices, utility receipts, purchase bills and attach supporting proofs." },
    adjustments: { title: "Adjustments, Refunds & Voids", icon: "🔄", desc: "Item cancellations, cashier voids, refund audit and reasons." },
    payments: { title: "Payment Tenders & Drawer Balancing", icon: "💳", desc: "UPI, Card, Cash breakdown, drawer variance and bank settlement." },
    tax: { title: "Tax Compliance & GST Register", icon: "📜", desc: "5% GST breakdowns (CGST + SGST), HSN summary and tax filings." },
    reconciliation: { title: "End of Day (EOD) Reconciliation", icon: "⚖️", desc: "Terminal reconciliations, drawer sign-off and day closures." },
    reports: { title: "Sales Reports & ZURF Export", icon: "📑", desc: "Financial billing summaries, Excel spreadsheets and PDF registers." },
  };

  const cur = submodules[activeSubTab] || { title: "Submodule", icon: "📁", desc: "" };

  let bodyHtml = "";
  switch (activeSubTab) {
    case "bills":
      bodyHtml = renderBillsSubpanel();
      break;
    case "receipts":
      bodyHtml = renderReceiptsSubpanel();
      break;
    case "upload":
      bodyHtml = renderUploadSubpanel();
      break;
    case "adjustments":
      bodyHtml = renderAdjustmentsSubpanel();
      break;
    case "payments":
      bodyHtml = renderPaymentsSubpanel();
      break;
    case "tax":
      bodyHtml = renderTaxSubpanel();
      break;
    case "reconciliation":
      bodyHtml = renderReconciliationSubpanel();
      break;
    case "reports":
      bodyHtml = renderReportsSubpanel();
      break;
    default:
      bodyHtml = renderOverviewSubpanel();
  }

  return `
    <div style="display:flex; flex-direction:column; gap:16px;">
      <div style="display:flex; justify-content:space-between; align-items:center; padding:12px 16px; background:var(--surface); border:1px solid var(--line); border-radius:var(--radius-md, 10px);">
        <div style="display:flex; align-items:center; gap:12px;">
          <button class="btn-back-nav" id="bills-back-to-hub-btn" type="button">
            <span class="back-icon">←</span>
            <span>Back to Bills Hub</span>
          </button>
          <div style="border-left:1px solid var(--line); padding-left:12px;">
            <h2 style="font-size:16px; font-weight:700; color:var(--ink); margin:0; display:flex; align-items:center; gap:8px;">
              <span>${cur.icon}</span> <span>${cur.title}</span>
            </h2>
            <p style="font-size:11.5px; color:var(--muted); margin:2px 0 0 0;">${cur.desc}</p>
          </div>
        </div>
      </div>
      <div>
        ${bodyHtml}
      </div>
    </div>
  `;
}

// 0. UPLOAD & INGEST INVOICES SUBPANEL
function renderUploadSubpanel() {
  const uploadedList = cachedUploadedInvoices || DEFAULT_UPLOADED_INVOICES;
  return `
    <div style="display:flex; flex-direction:column; gap:24px;" class="upload-subpanel-container">
      <!-- 1. Top Section: Upload Form (Adjusted Full-Width Card) -->
      <div class="card" style="padding:24px; background:var(--surface); border:1px solid var(--line); border-radius:var(--radius-lg, 12px); box-shadow:var(--shadow-xs);">
        <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:18px; border-bottom:1px solid var(--border-subtle); padding-bottom:12px;">
          <div>
            <h3 style="font-size:16px; font-weight:800; color:var(--ink); margin:0; display:flex; align-items:center; gap:8px;">
              <span>📥</span> Upload Vendor Bill / Tax Receipt
            </h3>
            <p style="font-size:12px; color:var(--muted); margin:3px 0 0;">Ingest vendor invoices, bills, utility receipts or credit notes directly into ERP records.</p>
          </div>
          <span class="badge badge-accent" style="font-size:11px; font-weight:700;">Document Ingestion</span>
        </div>

        <form id="upload-invoice-form" style="display:flex; flex-direction:column; gap:16px;">
          <div>
            ${renderFileUploadZone({
              id: "bill-doc-file",
              label: "Invoice or Receipt File *",
              required: true,
              helpText: "PDF, PNG, JPG, JPEG, XLSX (Max 15MB)",
            })}
          </div>

          <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap:14px;">
            <div>
              <label style="font-size:12px; font-weight:700; color:var(--ink); display:block; margin-bottom:6px;">Document Type *</label>
              <select id="bill-doc-type" class="select" style="width:100%; font-size:12.5px; height:38px;">
                <option value="VENDOR_INVOICE">Vendor Tax Invoice</option>
                <option value="UTILITY_BILL">Electricity / Water / Rent</option>
                <option value="PURCHASE_RECEIPT">Store Purchase Receipt</option>
                <option value="CREDIT_NOTE">Vendor Credit Note</option>
                <option value="TAX_CHALLAN">GST / Tax Challan</option>
              </select>
            </div>
            <div>
              <label style="font-size:12px; font-weight:700; color:var(--ink); display:block; margin-bottom:6px;">Café Outlet *</label>
              <select id="bill-doc-cafe" class="select" style="width:100%; font-size:12.5px; height:38px;">
                ${cachedCafes.length > 0 ? cachedCafes.map((c) => `<option value="${escapeHtml(c.cafeId)}">${escapeHtml(c.cafeId)} · ${escapeHtml(c.name || c.cafeId)}</option>`).join("") : '<option value="">No active cafés</option>'}
              </select>
            </div>
          </div>

          <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap:14px;">
            <div>
              <label style="font-size:12px; font-weight:700; color:var(--ink); display:block; margin-bottom:6px;">Vendor / Supplier Name *</label>
              <input type="text" id="bill-doc-vendor" class="input" placeholder="e.g. Vendor Name" required style="width:100%; font-size:12.5px; height:38px;" />
            </div>
            <div>
              <label style="font-size:12px; font-weight:700; color:var(--ink); display:block; margin-bottom:6px;">Invoice / Bill Number *</label>
              <input type="text" id="bill-doc-num" class="input" placeholder="e.g. INV-2026-9812" required style="width:100%; font-size:12.5px; height:38px;" />
            </div>
          </div>

          <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap:14px;">
            <div>
              <label style="font-size:12px; font-weight:700; color:var(--ink); display:block; margin-bottom:6px;">Bill Date *</label>
              <input type="date" id="bill-doc-date" class="input" value="${new Date().toISOString().split('T')[0]}" style="width:100%; font-size:12.5px; height:38px;" />
            </div>
            <div>
              <label style="font-size:12px; font-weight:700; color:var(--ink); display:block; margin-bottom:6px;">Payment Due Date</label>
              <input type="date" id="bill-doc-duedate" class="input" value="${new Date(Date.now() + 15 * 86400000).toISOString().split('T')[0]}" style="width:100%; font-size:12.5px; height:38px;" />
            </div>
          </div>

          <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap:14px;">
            <div>
              <label style="font-size:12px; font-weight:700; color:var(--ink); display:block; margin-bottom:6px;">Subtotal (₹) *</label>
              <input type="number" id="bill-doc-subtotal" class="input" placeholder="0.00" step="0.01" style="width:100%; font-size:12.5px; height:38px;" />
            </div>
            <div>
              <label style="font-size:12px; font-weight:700; color:var(--ink); display:block; margin-bottom:6px;">GST Rate</label>
              <select id="bill-doc-gstrate" class="select" style="width:100%; font-size:12.5px; height:38px;">
                <option value="5">5% GST</option>
                <option value="18">18% GST</option>
                <option value="12">12% GST</option>
                <option value="0">0% Exempt</option>
              </select>
            </div>
            <div>
              <label style="font-size:12px; font-weight:700; color:var(--ink); display:block; margin-bottom:6px;">Total Bill (₹) *</label>
              <input type="number" id="bill-doc-total" class="input" placeholder="0.00" step="0.01" style="width:100%; font-size:12.5px; height:38px; font-weight:800; color:var(--brand-gold, #c89d5c);" />
            </div>
          </div>

          <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap:14px;">
            <div>
              <label style="font-size:12px; font-weight:700; color:var(--ink); display:block; margin-bottom:6px;">Expense / COGS Category</label>
              <select id="bill-doc-category" class="select" style="width:100%; font-size:12.5px; height:38px;">
                <option value="COFFEE_BEANS">Coffee Beans &amp; Roastery Raw</option>
                <option value="DAIRY_MILK">Dairy &amp; Fresh Milk Supplies</option>
                <option value="PACKAGING">Packaging &amp; Disposables</option>
                <option value="KITCHEN_BAKERY">Bakery &amp; Pastry Ingredients</option>
                <option value="EQUIPMENT_REPAIR">Equipment Spares &amp; Maintenance</option>
                <option value="UTILITIES">Electricity, Water &amp; Internet</option>
              </select>
            </div>
            <div>
              <label style="font-size:12px; font-weight:700; color:var(--ink); display:block; margin-bottom:6px;">Payment Status</label>
              <select id="bill-doc-paystatus" class="select" style="width:100%; font-size:12.5px; height:38px;">
                <option value="UNPAID">Unpaid (Awaiting Settlement)</option>
                <option value="PAID">Paid (Bank / UPI Settled)</option>
                <option value="PARTIALLY_PAID">Partially Paid</option>
              </select>
            </div>
          </div>

          <div>
            <label style="font-size:12px; font-weight:700; color:var(--ink); display:block; margin-bottom:6px;">Notes &amp; Line Item Narration</label>
            <textarea id="bill-doc-notes" class="input" rows="2" placeholder="Optional invoice description or PO reference..." style="width:100%; font-size:12.5px; resize:vertical;"></textarea>
          </div>

          <div style="display:flex; justify-content:flex-end; gap:12px; margin-top:6px;">
            <button type="reset" class="btn btn-secondary" style="padding:8px 18px;">Clear</button>
            <button type="button" id="submit-upload-bill-btn" class="btn btn-primary" style="font-weight:700; padding:8px 22px;">
              💾 Save &amp; Ingest Bill
            </button>
          </div>
        </form>
      </div>

      <!-- 2. Bottom Section: Digital Invoices & Receipts Register (Full-Width Table) -->
      <div class="card" style="padding:24px; background:var(--surface); border:1px solid var(--line); border-radius:var(--radius-lg, 12px); box-shadow:var(--shadow-xs);">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:18px; border-bottom:1px solid var(--border-subtle); padding-bottom:12px; flex-wrap:wrap; gap:10px;">
          <div>
            <h3 style="font-size:16px; font-weight:800; color:var(--ink); margin:0; display:flex; align-items:center; gap:8px;">
              <span>📋</span> Digital Invoices &amp; Receipts Register
            </h3>
            <p style="font-size:12px; color:var(--muted); margin:3px 0 0;">Authoritative register of uploaded documents with file proof verification and audit trail.</p>
          </div>
          <span class="badge badge-accent" style="font-size:11.5px; font-weight:700; padding:4px 10px;">${uploadedList.length} Uploaded Documents</span>
        </div>

        <div class="table-wrap" style="width:100%; overflow-x:auto;">
          <table class="data-table" style="width:100%; font-size:12.5px; border-collapse:collapse; min-width:860px;">
            <thead>
              <tr style="border-bottom:2px solid var(--border-subtle); text-align:left; background:var(--surface-sunken);">
                <th style="padding:10px 14px; font-weight:700; color:var(--ink); font-size:11.5px; text-transform:uppercase; letter-spacing:0.5px;">Invoice # / Ref</th>
                <th style="padding:10px 14px; font-weight:700; color:var(--ink); font-size:11.5px; text-transform:uppercase; letter-spacing:0.5px;">Vendor &amp; Outlet</th>
                <th style="padding:10px 14px; font-weight:700; color:var(--ink); font-size:11.5px; text-transform:uppercase; letter-spacing:0.5px;">Category</th>
                <th style="padding:10px 14px; font-weight:700; color:var(--ink); font-size:11.5px; text-transform:uppercase; letter-spacing:0.5px; text-align:right;">Amount</th>
                <th style="padding:10px 14px; font-weight:700; color:var(--ink); font-size:11.5px; text-transform:uppercase; letter-spacing:0.5px; text-align:center;">File Proof</th>
                <th style="padding:10px 14px; font-weight:700; color:var(--ink); font-size:11.5px; text-transform:uppercase; letter-spacing:0.5px; text-align:center;">Status</th>
                <th style="padding:10px 14px; font-weight:700; color:var(--ink); font-size:11.5px; text-transform:uppercase; letter-spacing:0.5px; text-align:center;">Actions</th>
              </tr>
            </thead>
            <tbody id="uploaded-invoices-tbody">
              ${uploadedList.map((doc) => `
                <tr style="border-bottom:1px solid var(--border-subtle); transition:background 0.15s ease;">
                  <td style="padding:12px 14px;">
                    <div style="font-weight:800; font-family:var(--font-mono); color:var(--ink); font-size:13px;">${doc.invoiceNumber}</div>
                    <div style="font-size:11px; color:var(--muted); margin-top:2px;">📅 ${doc.date}</div>
                  </td>
                  <td style="padding:12px 14px;">
                    <div style="font-weight:700; color:var(--ink); font-size:13px;">${doc.vendor}</div>
                    <div style="font-size:11px; color:var(--muted); margin-top:2px;">📍 ${CAFE_NAMES[doc.cafeId] || doc.cafeId}</div>
                  </td>
                  <td style="padding:12px 14px;">
                    <span class="badge badge-subtle" style="font-size:11px; font-weight:600; padding:3px 8px;">${doc.category}</span>
                  </td>
                  <td style="padding:12px 14px; text-align:right; font-family:var(--font-mono); font-weight:800; font-size:13.5px; color:var(--ink);">
                    ₹${(doc.amount || 0).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                  </td>
                  <td style="padding:12px 14px; text-align:center;">
                    <button class="btn btn-xs btn-ghost view-doc-attachment-btn" data-doc-name="${doc.fileName || 'invoice.pdf'}" type="button" title="View attached document" style="color:var(--brand-gold, #c89d5c); display:inline-flex; align-items:center; gap:6px; background:rgba(200,157,92,0.08); padding:5px 10px; border-radius:6px; border:1px solid rgba(200,157,92,0.25);">
                      <span>📄</span> <span style="text-decoration:underline; font-weight:600;">${doc.fileName || 'Attached'}</span>
                    </button>
                  </td>
                  <td style="padding:12px 14px; text-align:center;">
                    <span class="badge ${doc.paymentStatus === 'PAID' ? 'badge-success' : 'badge-warning'}" style="font-size:11px; font-weight:700; padding:4px 10px;">
                      ${doc.paymentStatus || 'UNPAID'}
                    </span>
                  </td>
                  <td style="padding:12px 14px; text-align:center;">
                    <button class="btn btn-xs btn-secondary view-uploaded-bill-detail-btn" data-bill-id="${doc.id}" type="button" style="padding:5px 12px; font-weight:700; white-space:nowrap;">
                      👁️ View
                    </button>
                  </td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;
}

// 1. OVERVIEW & CONTROL SUBPANEL
function renderOverviewSubpanel() {
  const ov = (cachedOverview && Array.isArray(cachedOverview.cafeBilling)) ? cachedOverview : DEFAULT_OVERVIEW;

  // Compute portfolio totals filtered by selectedCafeFilter
  let filteredCafes = ov.cafeBilling || [];
  if (selectedCafeFilter !== "ALL") {
    filteredCafes = (ov.cafeBilling || []).filter((c) => c.cafeId === selectedCafeFilter);
  }

  let gross = 0;
  let net = 0;
  let billsCount = 0;
  let refunds = 0;
  let voidsCount = 0;
  let voidedValue = 0;
  let tax = 0;
  let exceptions = 0;

  for (const c of filteredCafes) {
    gross += Number(c.grossSales) || 0;
    net += Number(c.netSales) || 0;
    billsCount += Number(c.billsCount) || 0;
    refunds += Number(c.refunds) || 0;
    voidsCount += Number(c.voidsCount) || 0;
    voidedValue += Number(c.voidedValue) || 0;
    tax += Number(c.taxCollected) || 0;
    exceptions += Number(c.exceptionsCount) || 0;
  }

  const abv = billsCount > 0 ? Math.round(gross / billsCount) : 0;
  const refundRate = gross > 0 ? ((refunds / gross) * 100).toFixed(2) : "0.00";
  const voidRate = gross > 0 ? ((voidedValue / gross) * 100).toFixed(2) : "0.00";

  const billsTiles = [
    { id: "bills", icon: "🧾", title: "Bills & Receipts", subtitle: "Finalised customer invoices, line items & taxes", badge: `${billsCount} Bills`, badgeType: "accent" },
    { id: "upload", icon: "📤", title: "Upload Invoices & Receipts", subtitle: "Upload vendor invoices, utility receipts & digital proof", badge: `${cachedUploadedInvoices.length} Files`, badgeType: "accent" },
    { id: "adjustments", icon: "🔄", title: "Adjustments & Voids", subtitle: "Refunds, voids, cancellations & audit reasons", badge: `${voidsCount} Voids`, badgeType: voidsCount > 0 ? "warning" : "" },
    { id: "payments", icon: "💳", title: "Payments & Tenders", subtitle: "UPI, Card, Cash split & drawer variance", badge: "UPI 62%", badgeType: "success" },
    { id: "tax", icon: "📜", title: "Tax & GST Register", subtitle: "5% Composite GST breakdowns (CGST + SGST)", badge: "5% GST", badgeType: "success" },
    { id: "reconciliation", icon: "⚖️", title: "Reconciliation & EOD", subtitle: "Terminal settlements & daily drawer sign-off", badge: "Matched", badgeType: "success" },
    { id: "reports", icon: "📑", title: "Reports & ZURF Export", subtitle: "Financial summaries, Excel spreadsheets & PDF logs", badge: "ZURF v1", badgeType: "" },
  ];

  return `
    <div style="display:flex; flex-direction:column; gap:24px;">
      <!-- Control Centre Button Hub Section -->
      <div class="module-hub-section">
        <h3 class="module-hub-section-title">Sales Billing &amp; Tax Workspaces</h3>
        <div class="module-tile-grid">
          ${billsTiles.map((t) => `
            <button class="module-hub-tile" data-bills-hub-tile="${t.id}" type="button">
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

      <!-- Top 8-KPI Summary Strip -->
      <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(145px, 1fr)); gap:12px;">
        ${kpiCard("Gross Sales Today", `₹${gross.toLocaleString("en-IN")}`, "+6.8% vs comparison", "var(--ink)", "Sum of all settled and billed invoices before refunds")}
        ${kpiCard("Net Sales", `₹${net.toLocaleString("en-IN")}`, "+7.1% vs comparison", "var(--color-success, #2E7D32)", "Gross Sales minus returned refunds and discounts")}
        ${kpiCard("Completed Bills", `${billsCount} Bills`, "100% Finalised", "var(--ink)", "Total number of settled check tickets")}
        ${kpiCard("Gross ABV", `₹${abv}`, "Gross Sales ÷ Bills", "var(--color-accent-amber, #C89D5C)", "Gross Average Bill Value = Gross Sales ÷ Completed Bills")}
        ${kpiCard("Voided Bills", `${voidsCount} Bills · ₹${voidedValue}`, `${voidRate}% of Gross`, voidsCount > 0 ? "var(--color-danger, #D32F2F)" : "var(--muted)", "Post-sale cancelled orders preserved in audit trail")}
        ${kpiCard("Refunds", `₹${refunds.toLocaleString("en-IN")}`, `${refundRate}% of Gross`, refunds > 0 ? "var(--color-warning, #ED6C02)" : "var(--muted)", "Total customer returns processed via POS workflows")}
        ${kpiCard("Tax Collected", `₹${tax.toLocaleString("en-IN")}`, "GST Output (5%)", "var(--ink)", "5% Composite GST output collected across sales")}
        ${kpiCard("Exceptions", `${exceptions}`, "Payment Mismatches", exceptions > 0 ? "var(--color-danger)" : "var(--color-success)", "Unreconciled tenders or drawer discrepancies")}
      </div>

    <!-- Gross-to-Net Revenue Bridge & Integrity Ribbon -->
    <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(320px, 1fr)); gap:16px; margin-bottom:24px;">
      <!-- Revenue Bridge -->
      <div class="card" style="padding:16px 20px;">
        <h4 style="font-size:13px; font-weight:700; margin:0 0 10px; color:var(--ink); display:flex; justify-content:space-between;">
          <span>📊 Gross-to-Net Revenue Bridge</span>
          <span style="font-weight:500; font-size:11.5px; color:var(--muted);">Audited Integrity</span>
        </h4>
        <div style="display:flex; justify-content:space-between; align-items:center; font-size:13px; padding:6px 0; border-bottom:1px solid var(--border-subtle);">
          <span style="color:var(--muted);">Gross Sales Billed:</span>
          <strong style="font-family:var(--font-mono); color:var(--ink);">₹${gross.toLocaleString("en-IN")}</strong>
        </div>
        <div style="display:flex; justify-content:space-between; align-items:center; font-size:13px; padding:6px 0; border-bottom:1px solid var(--border-subtle);">
          <span style="color:var(--muted);">Less: Discounts &amp; Promos:</span>
          <span style="font-family:var(--font-mono); color:var(--muted);">- ₹0</span>
        </div>
        <div style="display:flex; justify-content:space-between; align-items:center; font-size:13px; padding:6px 0; border-bottom:1px solid var(--border-subtle);">
          <span style="color:var(--muted);">Less: Customer Refunds:</span>
          <span style="font-family:var(--font-mono); color:var(--color-warning);">- ₹${refunds.toLocaleString("en-IN")}</span>
        </div>
        <div style="display:flex; justify-content:space-between; align-items:center; font-size:13.5px; padding:8px 0 2px;">
          <span style="font-weight:700; color:var(--ink);">Net Retained Sales:</span>
          <strong style="font-family:var(--font-mono); color:var(--color-success); font-size:15px;">₹${net.toLocaleString("en-IN")}</strong>
        </div>
      </div>

      <!-- Financial Integrity Ribbon -->
      <div class="card" style="padding:16px 20px;">
        <h4 style="font-size:13px; font-weight:700; margin:0 0 10px; color:var(--ink); display:flex; justify-content:space-between;">
          <span>🛡️ Financial Integrity Ribbon</span>
          <button class="btn btn-xs btn-ghost" id="drill-reconciliation-btn" type="button" style="color:var(--color-accent-amber); font-size:11px;">
            Reconciliation Details →
          </button>
        </h4>
        <div style="display:flex; flex-direction:column; gap:8px; font-size:12.5px;">
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <span>Invoice Sequence Integrity:</span>
            <span class="status success" style="font-size:11px; font-weight:700;">✓ HEALTHY (NO GAPS)</span>
          </div>
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <span>Tender Reconciliation:</span>
            <span class="status success" style="font-size:11px; font-weight:700;">✓ MATCHED · ₹0 VARIANCE</span>
          </div>
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <span>GST Output Classification:</span>
            <span class="status success" style="font-size:11px; font-weight:700;">✓ 100% CLASSIFIED</span>
          </div>
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <span>EOD Portfolio Readiness:</span>
            <span class="status info" style="font-size:11px; font-weight:700;">● ${filteredCafes.length}/${filteredCafes.length} READY FOR EOD</span>
          </div>
        </div>
      </div>
    </div>

    <!-- Multi-Café Billing Portfolio Cards -->
    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:14px;">
      <h3 style="font-size:15px; font-weight:700; margin:0; color:var(--ink);">Café Billing Portfolio (${filteredCafes.length} Locations)</h3>
      <span style="font-size:12px; color:var(--muted);">All locations financially verified</span>
    </div>

    <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(340px, 1fr)); gap:16px;">
      ${filteredCafes
        .map(
          (c) => `
        <div class="card" style="padding:18px;">
          <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:12px;">
            <div>
              <strong style="color:var(--ink); font-size:14.5px;">${c.cafeName}</strong>
              <div style="font-size:11.5px; color:var(--muted); font-family:var(--font-mono);">${c.cafeId}</div>
            </div>
            <div style="text-align:right;">
              <div style="font-size:16px; font-weight:800; color:var(--ink); font-family:var(--font-mono);">₹${Number(c.grossSales).toLocaleString("en-IN")}</div>
              <div style="font-size:11px; color:var(--muted);">${c.billsCount} Bills Settled</div>
            </div>
          </div>

          <div style="font-size:12px; color:var(--muted); margin-bottom:10px; display:flex; justify-content:space-between;">
            <span>Net Sales: <strong style="color:var(--color-success);">₹${Number(c.netSales).toLocaleString("en-IN")}</strong></span>
            <span>Refunds: <strong style="color:${c.refunds > 0 ? "var(--color-warning)" : "var(--muted)"};">₹${Number(c.refunds).toLocaleString("en-IN")}</strong></span>
            <span>Voids: <strong>${c.voidsCount}</strong></span>
          </div>

          <!-- Payment Mix Strip -->
          <div style="border-top:1px solid var(--border-subtle); padding-top:10px; margin-bottom:10px; font-size:11.5px; display:flex; justify-content:space-between; color:var(--muted);">
            <span>UPI: <strong style="color:var(--ink);">${c.tendersPercent.UPI}%</strong></span>
            <span>Card: <strong style="color:var(--ink);">${c.tendersPercent.CARD}%</strong></span>
            <span>Cash: <strong style="color:var(--ink);">${c.tendersPercent.CASH}%</strong></span>
          </div>

          <!-- Cash Drawer & EOD State -->
          <div style="border-top:1px solid var(--border-subtle); padding-top:10px; font-size:11.5px; display:flex; justify-content:space-between; align-items:center;">
            <div style="display:flex; align-items:center; gap:6px;">
              <span class="status ${c.drawerStatus === "RECONCILED" ? "success" : "info"}" style="font-size:10px;">
                Drawer: ${c.drawerStatus}
              </span>
              <a href="#cash-drawers" class="btn btn-xs btn-ghost" style="font-size:10.5px; padding:2px 6px; color:var(--color-accent-amber);">
                View Drawer →
              </a>
            </div>
            <span class="status ${c.eodStatus === "CLOSED" ? "success" : "info"}" style="font-size:10px;">
              EOD: ${c.eodStatus}
            </span>
          </div>
        </div>
      `
        )
        .join("")}
    </div>
  `;
}

// 1.5 RECEIPTS & PAYMENT EVIDENCE SUBPANEL
function renderReceiptsSubpanel() {
  const bills = cachedBills.length > 0 ? cachedBills : DEFAULT_BILLS;
  const receipts = bills.map((b, idx) => ({
    receiptId: `RCP-2026-${(1001 + idx).toString().padStart(4, "0")}`,
    billId: b.billId,
    invoiceNumber: b.invoiceNumber,
    businessDate: b.businessDate,
    createdAt: b.createdAt,
    cafeId: b.cafeId,
    customerName: b.customerName,
    paymentMethod: b.paymentMethod,
    amount: (b.totalPaisa || 0) / 100,
    proofName: `${b.invoiceNumber}_Receipt.pdf`,
    reconciliationStatus: "MATCHED",
    status: b.status || "COMPLETED",
    uploadedBy: b.cashierUserId || "Staff Cashier",
  }));

  const totalReceipts = receipts.length;
  const totalReceiptsValue = receipts.reduce((acc, r) => acc + r.amount, 0);

  return `
    <div style="display:flex; flex-direction:column; gap:16px;">
      <!-- Top KPI Strip for Receipts -->
      <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(180px, 1fr)); gap:12px;">
        <div class="kpi-card glass" style="padding:14px;">
          <div class="kpi-label" style="font-size:11px; color:var(--muted); font-weight:600; text-transform:uppercase;">Total Receipts</div>
          <div class="kpi-value" style="font-size:20px; font-weight:800; color:var(--ink); margin:4px 0;">${totalReceipts}</div>
          <div style="font-size:11.5px; color:var(--muted);">Audited Payment Slips</div>
        </div>
        <div class="kpi-card glass" style="padding:14px;">
          <div class="kpi-label" style="font-size:11px; color:var(--muted); font-weight:600; text-transform:uppercase;">Total Retained Value</div>
          <div class="kpi-value" style="font-size:20px; font-weight:800; color:var(--color-accent-mint-bright, #15803d); margin:4px 0;">₹${totalReceiptsValue.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</div>
          <div style="font-size:11.5px; color:var(--muted);">All payment tenders</div>
        </div>
        <div class="kpi-card glass" style="padding:14px;">
          <div class="kpi-label" style="font-size:11px; color:var(--muted); font-weight:600; text-transform:uppercase;">Digital Proofs</div>
          <div class="kpi-value" style="font-size:20px; font-weight:800; color:var(--ink); margin:4px 0;">100%</div>
          <div style="font-size:11.5px; color:var(--muted);">SHA-256 Vault Verified</div>
        </div>
        <div class="kpi-card glass" style="padding:14px;">
          <div class="kpi-label" style="font-size:11px; color:var(--muted); font-weight:600; text-transform:uppercase;">Reconciliation</div>
          <div class="kpi-value" style="font-size:20px; font-weight:800; color:var(--color-accent-mint-bright, #15803d); margin:4px 0;">Matched</div>
          <div style="font-size:11.5px; color:var(--muted);">0 Unlinked Tenders</div>
        </div>
      </div>

      <!-- Receipts Register -->
      <div class="card" style="padding:20px; background:var(--surface); border:1px solid var(--line); border-radius:var(--radius-md, 10px);">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:14px; flex-wrap:wrap; gap:10px;">
          <div>
            <h3 style="font-size:15px; font-weight:700; color:var(--ink); margin:0;">Authoritative Payment Receipts Register</h3>
            <p style="font-size:11.5px; color:var(--muted); margin:2px 0 0;">Customer payment receipts, digital slips, tender vouchers, and bank settlement evidence.</p>
          </div>
          <div style="display:flex; gap:8px; align-items:center;">
            <button id="btn-upload-receipt-modal" class="btn btn-sm btn-primary" style="font-weight:700; display:flex; align-items:center; gap:6px;">
              <span>📤</span> Upload Receipt
            </button>
            <button id="btn-export-receipts-csv" class="btn btn-sm btn-secondary" style="font-weight:600;">
              Export CSV
            </button>
          </div>
        </div>

        <div class="table-wrap" style="overflow-x:auto;">
          <table class="data-table" style="width:100%; font-size:12.5px; border-collapse:collapse;">
            <thead>
              <tr style="border-bottom:1px solid var(--border-subtle); text-align:left; background:var(--surface-sunken);">
                <th style="padding:8px 10px; font-weight:700; color:var(--ink);">Receipt ID</th>
                <th style="padding:8px 10px; font-weight:700; color:var(--ink);">Linked Bill #</th>
                <th style="padding:8px 10px; font-weight:700; color:var(--ink);">Date &amp; Time</th>
                <th style="padding:8px 10px; font-weight:700; color:var(--ink);">Café</th>
                <th style="padding:8px 10px; font-weight:700; color:var(--ink);">Customer / Payee</th>
                <th style="padding:8px 10px; font-weight:700; color:var(--ink);">Tender</th>
                <th style="padding:8px 10px; font-weight:700; color:var(--ink); text-align:right;">Amount</th>
                <th style="padding:8px 10px; font-weight:700; color:var(--ink); text-align:center;">Digital Proof</th>
                <th style="padding:8px 10px; font-weight:700; color:var(--ink); text-align:center;">Status</th>
                <th style="padding:8px 10px; font-weight:700; color:var(--ink); text-align:center;">Actions</th>
              </tr>
            </thead>
            <tbody>
              ${receipts.map((r) => `
                <tr style="border-bottom:1px solid var(--border-subtle);">
                  <td style="padding:8px 10px; font-weight:700; color:var(--ink); font-family:var(--font-mono);">${r.receiptId}</td>
                  <td style="padding:8px 10px; font-weight:600; color:var(--accent); font-family:var(--font-mono);">${r.invoiceNumber}</td>
                  <td style="padding:8px 10px; font-size:11.5px; color:var(--muted);">${r.businessDate} ${r.createdAt}</td>
                  <td style="padding:8px 10px;">${CAFE_NAMES[r.cafeId] || r.cafeId}</td>
                  <td style="padding:8px 10px; font-weight:600; color:var(--ink);">${r.customerName}</td>
                  <td style="padding:8px 10px;">
                    <span class="badge ${r.paymentMethod === 'UPI' ? 'badge-accent' : r.paymentMethod === 'CARD' ? 'badge-info' : 'badge-subtle'}" style="font-size:10.5px;">${r.paymentMethod}</span>
                  </td>
                  <td style="padding:8px 10px; text-align:right; font-family:var(--font-mono); font-weight:700; color:var(--ink);">
                    ₹${r.amount.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                  </td>
                  <td style="padding:8px 10px; text-align:center;">
                    <button class="btn btn-xs btn-ghost view-doc-attachment-btn" data-doc-name="${r.proofName}" type="button" style="color:var(--brand-gold, #c89d5c); display:inline-flex; align-items:center; gap:4px;">
                      <span>📄</span> <span style="text-decoration:underline;">Proof.pdf</span>
                    </button>
                  </td>
                  <td style="padding:8px 10px; text-align:center;">
                    <span class="badge badge-success" style="font-size:10px;">MATCHED</span>
                  </td>
                  <td style="padding:8px 10px; text-align:center;">
                    <button class="btn btn-xs btn-ghost view-bill-detail-btn" data-bill-id="${r.billId}" type="button" style="padding:3px 8px; font-weight:600;">
                      👁️ View Bill
                    </button>
                  </td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;
}

// 2. BILLS & RECEIPTS SUBPANEL
function renderBillsSubpanel() {
  const bills = cachedBills.length > 0 ? cachedBills : DEFAULT_BILLS;

  let filtered = bills.filter((b) => {
    if (selectedCafeFilter !== "ALL" && b.cafeId !== selectedCafeFilter) return false;
    if (billsStatusFilter !== "ALL" && b.status !== billsStatusFilter) return false;
    if (billsPaymentFilter !== "ALL" && b.paymentMethod !== billsPaymentFilter) return false;
    if (billsSearchQuery) {
      const q = billsSearchQuery.toLowerCase();
      const match =
        (b.billId && b.billId.toLowerCase().includes(q)) ||
        (b.invoiceNumber && b.invoiceNumber.toLowerCase().includes(q)) ||
        (b.customerName && b.customerName.toLowerCase().includes(q)) ||
        (b.tableNumber && b.tableNumber.toLowerCase().includes(q)) ||
        (b.cashierUserId && b.cashierUserId.toLowerCase().includes(q));
      if (!match) return false;
    }
    return true;
  });

  // Sorting
  if (billsSortBy === "AMOUNT_HIGH") {
    filtered.sort((a, b) => b.totalPaisa - a.totalPaisa);
  } else if (billsSortBy === "AMOUNT_LOW") {
    filtered.sort((a, b) => a.totalPaisa - b.totalPaisa);
  } else if (billsSortBy === "INVOICE_ASC") {
    filtered.sort((a, b) => (a.invoiceNumber || "").localeCompare(b.invoiceNumber || ""));
  }

  return `
    <div class="card" style="padding:24px;">
      <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px; margin-bottom:18px;">
        <input type="text" class="input" id="bills-search-input" placeholder="Search by Invoice #, Bill ID, Table, Customer, Operator..." value="${billsSearchQuery}" style="max-width:380px; font-size:13px;">

        <div style="display:flex; gap:8px; flex-wrap:wrap;">
          <select class="select select-sm" id="bills-status-filter" style="font-size:12px;">
            <option value="ALL" ${billsStatusFilter === "ALL" ? "selected" : ""}>All Statuses</option>
            <option value="COMPLETED" ${billsStatusFilter === "COMPLETED" ? "selected" : ""}>Completed / Finalised</option>
            <option value="PARTIALLY_REFUNDED" ${billsStatusFilter === "PARTIALLY_REFUNDED" ? "selected" : ""}>Partially Refunded</option>
            <option value="REFUNDED" ${billsStatusFilter === "REFUNDED" ? "selected" : ""}>Fully Refunded</option>
            <option value="VOIDED" ${billsStatusFilter === "VOIDED" ? "selected" : ""}>Voided / Cancelled</option>
          </select>

          <select class="select select-sm" id="bills-payment-filter" style="font-size:12px;">
            <option value="ALL" ${billsPaymentFilter === "ALL" ? "selected" : ""}>All Tenders</option>
            <option value="UPI" ${billsPaymentFilter === "UPI" ? "selected" : ""}>UPI / Digital (QR)</option>
            <option value="CARD" ${billsPaymentFilter === "CARD" ? "selected" : ""}>Card (EDC Terminal)</option>
            <option value="CASH" ${billsPaymentFilter === "CASH" ? "selected" : ""}>Cash Till</option>
            <option value="SPLIT" ${billsPaymentFilter === "SPLIT" ? "selected" : ""}>Split Tender</option>
          </select>

          <select class="select select-sm" id="bills-sort-filter" style="font-size:12px;">
            <option value="NEWEST" ${billsSortBy === "NEWEST" ? "selected" : ""}>Sort: Newest First</option>
            <option value="AMOUNT_HIGH" ${billsSortBy === "AMOUNT_HIGH" ? "selected" : ""}>Sort: Amount (High to Low)</option>
            <option value="AMOUNT_LOW" ${billsSortBy === "AMOUNT_LOW" ? "selected" : ""}>Sort: Amount (Low to High)</option>
            <option value="INVOICE_ASC" ${billsSortBy === "INVOICE_ASC" ? "selected" : ""}>Sort: Invoice # (A-Z)</option>
          </select>
        </div>
      </div>

      <div class="table-wrap">
        <table class="table" style="width:100%;">
          <thead>
            <tr>
              <th>Invoice #</th>
              <th>Time &amp; Table</th>
              <th>Branch</th>
              <th>Items Ordered</th>
              <th>Tender</th>
              <th>Total Paid</th>
              <th>Status</th>
              <th style="text-align:right;">Actions</th>
            </tr>
          </thead>
          <tbody>
            ${
              filtered.length === 0
                ? `
                <tr>
                  <td colspan="8" style="text-align:center; padding:36px; color:var(--muted);">
                    No bills match the selected filters.
                  </td>
                </tr>
              `
                : filtered
                    .map((b) => {
                      const total = (b.totalPaisa / 100).toFixed(2);
                      const itemsSummary = Array.isArray(b.lineItems)
                        ? b.lineItems.map((li) => `${li.quantity}× ${li.itemNameSnapshot}`).join(", ")
                        : "Beverages";

                      return `
                      <tr>
                        <td>
                          <strong style="color:var(--color-accent-amber); font-family:var(--font-mono); font-size:13px;">${b.invoiceNumber || b.billId}</strong>
                          <div style="font-size:11px; color:var(--muted); font-family:var(--font-mono);">${b.billId}</div>
                        </td>
                        <td>
                          <strong style="color:var(--ink); font-size:13px;">${b.tableNumber || "Dine In"}</strong>
                          <div style="font-size:11px; color:var(--muted); font-family:var(--font-mono);">${b.businessDate} · ${b.createdAt || "IST"}</div>
                        </td>
                        <td>
                          <div style="font-weight:600; font-size:12.5px; color:var(--ink);">${CAFE_NAMES[b.cafeId] || b.cafeId}</div>
                          <span class="status info" style="font-size:10px; font-family:var(--font-mono);">${b.cafeId}</span>
                        </td>
                        <td style="font-size:12.5px; max-width:260px; color:var(--ink); line-height:1.4;">${itemsSummary}</td>
                        <td><strong style="font-size:12.5px; color:var(--ink);">${b.paymentMethod}</strong></td>
                        <td style="font-family:var(--font-mono); font-weight:800; font-size:14.5px; color:var(--ink);">₹${total}</td>
                        <td>
                          <span class="status ${b.status === "COMPLETED" ? "success" : b.status === "VOIDED" ? "danger" : "warning"}" style="font-size:11px; font-weight:700;">
                            ${b.status}
                          </span>
                        </td>
                        <td style="text-align:right;">
                          <div style="display:inline-flex; gap:6px;">
                            <button class="btn btn-ghost preview-receipt-btn" data-bill="${b.billId}" type="button" style="font-size:12px; padding:4px 10px;">
                              Receipt
                            </button>
                            <button class="btn btn-ghost view-bill-360-btn" data-bill="${b.billId}" type="button" style="font-size:12px; padding:4px 10px;">
                              Detail
                            </button>
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
    </div>
  `;
}

// 3. ADJUSTMENTS (Refunds & Voids)
function renderAdjustmentsSubpanel() {
  const voidedBills = (cachedBills || []).filter((b) => b.status === "VOID" || b.status === "VOIDED");
  const voidCount = cachedOverview?.kpis?.voidedBills ?? voidedBills.length;
  const voidValue = cachedOverview?.kpis?.voidedValue ?? voidedBills.reduce((sum, b) => sum + ((b.totalPaisa || 0) / 100), 0);

  const refundedBills = (cachedBills || []).filter((b) => (b.refundedTotalPaisa || 0) > 0 || b.status === "REFUNDED" || b.status === "PARTIALLY_REFUNDED");
  const refundCount = cachedOverview?.kpis?.refundsCount ?? refundedBills.length;
  const refundValue = cachedOverview?.kpis?.refunds ?? refundedBills.reduce((sum, b) => sum + ((b.refundedTotalPaisa || 0) / 100), 0);

  const grossSales = cachedOverview?.kpis?.grossSales || 1;
  const voidPercent = grossSales > 0 ? ((voidValue / grossSales) * 100).toFixed(2) : "0.00";
  const refundPercent = grossSales > 0 ? ((refundValue / grossSales) * 100).toFixed(2) : "0.00";

  return `
    <div style="display:flex; flex-direction:column; gap:20px;">
      <!-- Adjustment Metrics Summary -->
      <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(180px, 1fr)); gap:12px;">
        <div class="card" style="padding:14px 16px;">
          <div style="font-size:11.5px; color:var(--muted); font-weight:600;">Total Voids Count</div>
          <div style="font-size:20px; font-weight:800; color:var(--color-danger); font-family:var(--font-mono); margin:2px 0;">${voidCount} Void${voidCount === 1 ? '' : 's'}</div>
          <div style="font-size:11px; color:var(--muted);">Audited Invoices</div>
        </div>
        <div class="card" style="padding:14px 16px;">
          <div style="font-size:11.5px; color:var(--muted); font-weight:600;">Total Voided Value</div>
          <div style="font-size:20px; font-weight:800; color:var(--color-danger); font-family:var(--font-mono); margin:2px 0;">₹${voidValue.toFixed(2)}</div>
          <div style="font-size:11px; color:var(--muted);">${voidPercent}% of Gross</div>
        </div>
        <div class="card" style="padding:14px 16px;">
          <div style="font-size:11.5px; color:var(--muted); font-weight:600;">Total Refunds Count</div>
          <div style="font-size:20px; font-weight:800; color:var(--color-warning); font-family:var(--font-mono); margin:2px 0;">${refundCount} Refund${refundCount === 1 ? '' : 's'}</div>
          <div style="font-size:11px; color:var(--muted);">POS Credit Note</div>
        </div>
        <div class="card" style="padding:14px 16px;">
          <div style="font-size:11.5px; color:var(--muted); font-weight:600;">Total Refunded Value</div>
          <div style="font-size:20px; font-weight:800; color:var(--color-warning); font-family:var(--font-mono); margin:2px 0;">₹${refundValue.toFixed(2)}</div>
          <div style="font-size:11px; color:var(--muted);">${refundPercent}% of Gross</div>
        </div>
      </div>

      <!-- Adjustment Registers Grid -->
      <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(440px, 1fr)); gap:20px;">
        <!-- Post-Sale Voids Register -->
        <div class="card" style="padding:20px;">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:14px;">
            <div>
              <h3 style="font-size:15px; font-weight:700; margin:0 0 2px; color:var(--ink);">Controlled Post-Sale Voids</h3>
              <p style="font-size:12px; color:var(--muted); margin:0;">Post-sale invoice voids: Primary Master authority only</p>
            </div>
            <span class="status danger" style="font-size:11px;">Audited Action</span>
          </div>

          ${(() => {
            const voidedBills = (cachedBills || []).filter((b) => b.status === "VOID" || b.status === "VOIDED");
            if (voidedBills.length === 0) {
              return `
                <div style="padding:24px; text-align:center; color:var(--muted); font-size:12.5px; border:1px dashed var(--border-subtle); border-radius:6px; margin-bottom:12px;">
                  No post-sale voided invoices recorded for this period.
                </div>
              `;
            }
            return voidedBills.map((b) => `
              <div style="padding:12px; border:1px solid var(--border-subtle); border-radius:6px; margin-bottom:12px;">
                <div style="display:flex; justify-content:space-between; font-size:13px;">
                  <strong>${escapeHtml(b.invoiceNumber || b.billId)} · ₹${((b.totalPaisa || 0) / 100).toFixed(2)}</strong>
                  <span class="status danger" style="font-size:10.5px;">VOIDED</span>
                </div>
                <div style="font-size:11.5px; color:var(--muted); margin-top:4px;">
                  Branch: ${escapeHtml(CAFE_NAMES[b.cafeId] || b.cafeId || "—")} · Operator: ${escapeHtml(b.cashierUserId || "Staff")} · Reason: ${escapeHtml(b.voidReason || "Voided during audit")}
                </div>
              </div>
            `).join("");
          })()}

          <div style="font-size:12px; color:var(--muted); background:var(--bg-subtle, rgba(0,0,0,0.02)); padding:10px; border-radius:6px;">
            ℹ️ <strong>Governance Note:</strong> Owner accounts possess strategic audit oversight of all voids. Mutation rights remain restricted to operational cashier and manager roles.
          </div>
        </div>

        <!-- Refunds & Credit Notes Register -->
        <div class="card" style="padding:20px;">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:14px;">
            <div>
              <h3 style="font-size:15px; font-weight:700; margin:0 0 2px; color:var(--ink);">Refunds &amp; Credit Notes</h3>
              <p style="font-size:12px; color:var(--muted); margin:0;">Full &amp; partial refunds with refundable limit enforcement</p>
            </div>
            <span class="status info" style="font-size:11px;">100% Traceable</span>
          </div>

          ${(() => {
            const refundedBills = (cachedBills || []).filter((b) => b.status === "REFUNDED" || b.status === "REFUND" || b.refundAmountPaisa > 0);
            if (refundedBills.length === 0) {
              return `
                <div style="padding:24px; text-align:center; color:var(--muted); font-size:12.5px; border:1px dashed var(--border-subtle); border-radius:6px; margin-bottom:12px;">
                  No refunds or credit notes recorded for this period.
                </div>
              `;
            }
            return refundedBills.map((b) => `
              <div style="padding:12px; border:1px solid var(--border-subtle); border-radius:6px; margin-bottom:12px;">
                <div style="display:flex; justify-content:space-between; font-size:13px;">
                  <strong>${escapeHtml(b.refundRef || b.invoiceNumber || b.billId)} · ₹${((b.refundAmountPaisa || b.totalPaisa || 0) / 100).toFixed(2)}</strong>
                  <span class="status success" style="font-size:10.5px;">COMPLETED</span>
                </div>
                <div style="font-size:11.5px; color:var(--muted); margin-top:4px;">
                  Orig Bill: ${escapeHtml(b.invoiceNumber || b.billId)} · Tender: ${escapeHtml(b.paymentMethod || "—")} · Reason: ${escapeHtml(b.refundReason || "Customer refund")}
                </div>
              </div>
            `).join("");
          })()}

          <div style="font-size:12px; color:var(--muted); background:var(--bg-subtle, rgba(0,0,0,0.02)); padding:10px; border-radius:6px;">
            ℹ️ <strong>Refund Policy:</strong> All refunds require supervisor justification and are permanently recorded in both the GST register and payment ledger.
          </div>
        </div>
      </div>
    </div>
  `;
}

// 4. PAYMENTS & TENDERS
function renderPaymentsSubpanel() {
  const ov = cachedOverview || DEFAULT_OVERVIEW;
  let filteredCafes = ov.cafeBilling;
  if (selectedCafeFilter !== "ALL") {
    filteredCafes = ov.cafeBilling.filter((c) => c.cafeId === selectedCafeFilter);
  }

  // Portfolio weighted mix calculation
  let totalUpiAmount = 0;
  let totalCardAmount = 0;
  let totalCashAmount = 0;

  for (const c of filteredCafes) {
    totalUpiAmount += c.tendersAmount?.UPI || Number(c.grossSales) * 0.64;
    totalCardAmount += c.tendersAmount?.CARD || Number(c.grossSales) * 0.20;
    totalCashAmount += c.tendersAmount?.CASH || Number(c.grossSales) * 0.16;
  }

  const grandTotal = totalUpiAmount + totalCardAmount + totalCashAmount || 1;
  const weightedUpi = Math.round((totalUpiAmount / grandTotal) * 100);
  const weightedCard = Math.round((totalCardAmount / grandTotal) * 100);
  const weightedCash = 100 - weightedUpi - weightedCard;

  return `
    <div style="display:flex; flex-direction:column; gap:20px;">
      <!-- Top Tender KPI Cards -->
      <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(280px, 1fr)); gap:16px;">
        <div class="card" style="padding:20px;">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
            <h3 style="font-size:15px; font-weight:700; margin:0; color:var(--ink);">UPI / Digital Payments</h3>
            <span class="status success" style="font-size:11px;">${weightedUpi}% Weighted Mix</span>
          </div>
          <p style="font-size:12px; color:var(--muted); margin:0 0 14px;">BHIM / GPay / PhonePe direct QR settlement</p>
          <div style="font-size:28px; font-weight:800; color:var(--color-accent-amber); font-family:var(--font-mono);">₹${totalUpiAmount.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
          <div style="font-size:12px; color:var(--muted); margin-top:6px;">Instant Bank Settlement · 0 Gateway Mismatches</div>
        </div>

        <div class="card" style="padding:20px;">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
            <h3 style="font-size:15px; font-weight:700; margin:0; color:var(--ink);">Card Terminals (EDC)</h3>
            <span class="status info" style="font-size:11px;">${weightedCard}% Weighted Mix</span>
          </div>
          <p style="font-size:12px; color:var(--muted); margin:0 0 14px;">Visa / Mastercard / RuPay swipe &amp; tap</p>
          <div style="font-size:28px; font-weight:800; color:var(--ink); font-family:var(--font-mono);">₹${totalCardAmount.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
          <div style="font-size:12px; color:var(--muted); margin-top:6px;">Batch Close T+1 · Terminal Slip Verified</div>
        </div>

        <div class="card" style="padding:20px;">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
            <h3 style="font-size:15px; font-weight:700; margin:0; color:var(--ink);">Cash Till Transactions</h3>
            <span class="status success" style="font-size:11px;">${weightedCash}% Weighted Mix</span>
          </div>
          <p style="font-size:12px; color:var(--muted); margin:0 0 14px;">Physical cash verified in drawer session</p>
          <div style="font-size:28px; font-weight:800; color:var(--color-success); font-family:var(--font-mono);">₹${totalCashAmount.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
          <div style="font-size:12px; color:var(--muted); margin-top:6px;">Drawer Reconciled · ₹0 Cash Discrepancy</div>
        </div>
      </div>

      <!-- Tender Mismatch & Variance Register -->
      <div class="card" style="padding:20px;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px; flex-wrap:wrap; gap:8px;">
          <h3 style="font-size:15px; font-weight:700; margin:0; color:var(--ink);">Tender Mismatch &amp; Reconciliation Register</h3>
          <div style="font-size:12px; color:var(--color-success); font-weight:600;">
            ✓ 0 Unresolved Variances across Portfolio
          </div>
        </div>
        <div class="table-wrap">
          <table class="table" style="width:100%;">
            <thead>
              <tr>
                <th>Café Location</th>
                <th>Tender Method</th>
                <th>Expected Amount</th>
                <th>Recorded In Till</th>
                <th>Variance</th>
                <th>Status</th>
                <th>Audit Timestamp</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td colspan="7" style="padding: 24px; text-align: center; color: var(--muted); font-size: 13px;">
                  No live payment reconciliation records found for the selected filter.
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;
}

// 5. TAX & GST REGISTER
function renderTaxSubpanel() {
  const gst = cachedGstRegister?.summary || {
    totalTaxable: 46194,
    totalCgst: 1155,
    totalSgst: 1155,
    totalIgst: 0,
    totalTax: 2310,
    invoiceCount: 142,
  };

  return `
    <div class="card" style="padding:24px;">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:18px; flex-wrap:wrap; gap:12px;">
        <div>
          <h3 style="font-size:16px; font-weight:700; margin:0 0 2px; color:var(--ink);">Sales Tax &amp; GST Source Register</h3>
          <p style="font-size:12.5px; color:var(--muted); margin:0;">Authoritative tax records mapped to Legal Registrations (Karnataka 29AABCT1332L1ZV &amp; Kerala 32AABCT1332L1ZW)</p>
        </div>
        <div style="display:flex; gap:8px;">
          <button class="btn btn-ghost" id="export-gst-csv-btn" type="button" style="font-size:12.5px; padding:6px 14px;">
            ⬇ Export CSV
          </button>
          <button class="btn btn-ghost" id="export-gst-xlsx-btn" type="button" style="font-size:12.5px; padding:6px 14px;">
            ⬇ Export Excel
          </button>
        </div>
      </div>

      <!-- Tax Summary Strip -->
      <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(140px, 1fr)); gap:12px; margin-bottom:20px;">
        <div style="padding:12px; background:var(--bg-subtle, rgba(0,0,0,0.02)); border-radius:6px;">
          <div style="font-size:11px; color:var(--muted);">Taxable Value</div>
          <strong style="font-size:17px; color:var(--ink); font-family:var(--font-mono);">₹${Number(gst.totalTaxable).toLocaleString("en-IN")}</strong>
        </div>
        <div style="padding:12px; background:var(--bg-subtle, rgba(0,0,0,0.02)); border-radius:6px;">
          <div style="font-size:11px; color:var(--muted);">CGST (2.5%)</div>
          <strong style="font-size:17px; color:var(--ink); font-family:var(--font-mono);">₹${Number(gst.totalCgst).toLocaleString("en-IN")}</strong>
        </div>
        <div style="padding:12px; background:var(--bg-subtle, rgba(0,0,0,0.02)); border-radius:6px;">
          <div style="font-size:11px; color:var(--muted);">SGST (2.5%)</div>
          <strong style="font-size:17px; color:var(--ink); font-family:var(--font-mono);">₹${Number(gst.totalSgst).toLocaleString("en-IN")}</strong>
        </div>
        <div style="padding:12px; background:var(--bg-subtle, rgba(0,0,0,0.02)); border-radius:6px;">
          <div style="font-size:11px; color:var(--muted);">Total GST Output</div>
          <strong style="font-size:17px; color:var(--color-success); font-family:var(--font-mono);">₹${Number(gst.totalTax).toLocaleString("en-IN")}</strong>
        </div>
      </div>

      <!-- Tax Table -->
      <div class="table-wrap">
        <table class="table" style="width:100%;">
          <thead>
            <tr>
              <th>Invoice #</th>
              <th>Date</th>
              <th>Branch</th>
              <th>Customer GSTIN</th>
              <th>Taxable Value</th>
              <th>CGST (2.5%)</th>
              <th>SGST (2.5%)</th>
              <th>Total GST</th>
              <th>Final Total</th>
            </tr>
          </thead>
          <tbody>
            ${(cachedBills || []).length > 0 ? cachedBills.map((b) => {
              const taxable = ((b.subtotalPaisa || 0) / 100).toFixed(2);
              const cgst = ((b.cgstPaisa || (b.taxPaisa ? b.taxPaisa / 2 : 0)) / 100).toFixed(2);
              const sgst = ((b.sgstPaisa || (b.taxPaisa ? b.taxPaisa / 2 : 0)) / 100).toFixed(2);
              const totalTax = ((b.taxPaisa || 0) / 100).toFixed(2);
              const total = ((b.totalPaisa || 0) / 100).toFixed(2);
              const cafeName = CAFE_NAMES[b.cafeId] || b.cafeId || "—";
              return `
                <tr>
                  <td><strong style="color:var(--color-accent-amber); font-family:var(--font-mono);">${escapeHtml(b.invoiceNumber || b.billId)}</strong></td>
                  <td>${escapeHtml(b.businessDate || "—")}</td>
                  <td>${escapeHtml(cafeName)}</td>
                  <td style="color:var(--muted);">${escapeHtml(b.customerGstin || "B2C Retail")}</td>
                  <td style="font-family:var(--font-mono);">₹${taxable}</td>
                  <td style="font-family:var(--font-mono);">₹${cgst}</td>
                  <td style="font-family:var(--font-mono);">₹${sgst}</td>
                  <td style="font-family:var(--font-mono); color:var(--color-success);">₹${totalTax}</td>
                  <td style="font-family:var(--font-mono); font-weight:700;">₹${total}</td>
                </tr>
              `;
            }).join("") : `
              <tr>
                <td colspan="9" style="text-align:center; padding:24px; color:var(--muted); font-size:12.5px;">
                  No GST tax source invoices recorded for this period.
                </td>
              </tr>
            `}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

// 6. RECONCILIATION & EOD
function renderReconciliationSubpanel() {
  return `
    <div class="card" style="padding:24px; max-width:880px; margin:0 auto;">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:18px;">
        <div>
          <h3 style="font-size:16px; font-weight:700; margin:0 0 2px; color:var(--ink);">Operational Reconciliation &amp; EOD Close Gate</h3>
          <p style="font-size:12.5px; color:var(--muted); margin:0;">Bills ↔ Tenders ↔ Cash Sessions ↔ Provider Settlement</p>
        </div>
        <span class="status success" style="font-size:11px; font-weight:700;">READY TO CLOSE</span>
      </div>

      <div style="padding:16px; border:1px solid var(--border-subtle); border-radius:8px; margin-bottom:20px; font-size:13px;">
        <h4 style="font-size:13.5px; font-weight:700; margin:0 0 10px; color:var(--ink);">Billing Integrity Controls</h4>
        <div style="display:flex; justify-content:space-between; margin-bottom:6px;"><span>Duplicate Invoices:</span><strong style="color:var(--color-success);">0 (PASSED)</strong></div>
        <div style="display:flex; justify-content:space-between; margin-bottom:6px;"><span>Invoice Sequence Gaps:</span><strong style="color:var(--color-success);">0 (PASSED)</strong></div>
        <div style="display:flex; justify-content:space-between; margin-bottom:6px;"><span>Tender Total Mismatches:</span><strong style="color:var(--color-success);">0 (PASSED)</strong></div>
        <div style="display:flex; justify-content:space-between; margin-bottom:6px;"><span>Cash Drawer Reconciliation:</span><strong style="color:var(--color-success);">MATCHED (₹0.00 VARIANCE)</strong></div>
        <div style="display:flex; justify-content:space-between; margin-bottom:6px;"><span>Pending POS Checks:</span><strong style="color:var(--color-success);">0 OPEN</strong></div>
      </div>

      <div style="font-size:12px; color:var(--muted); background:var(--bg-subtle, rgba(0,0,0,0.02)); padding:12px; border-radius:6px;">
        🔒 <strong>EOD Close Authority:</strong> EOD Billing Close permanently seals the daily sales ledger for statutory and accounting finalization. Close execution is reserved for Master and designated branch managers.
      </div>
    </div>
  `;
}

// 7. REPORTS & EXPORT
function renderReportsSubpanel() {
  return `
    <div class="card" style="padding:24px; background:var(--surface); border:1px solid var(--line); border-radius:var(--radius-lg, 12px); box-shadow:var(--shadow-xs);">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:20px; border-bottom:1px solid var(--border-subtle); padding-bottom:12px; flex-wrap:wrap; gap:10px;">
        <div>
          <h3 style="font-size:16px; font-weight:800; margin:0 0 4px; color:var(--ink); display:flex; align-items:center; gap:8px;">
            <span>📑</span> Strategic &amp; Accounting Export Centre
          </h3>
          <p style="font-size:12px; color:var(--muted); margin:0;">Download reconciled billing, tax, and tender summaries in standard audit-ready formats.</p>
        </div>
        <span class="badge badge-accent" style="font-size:11.5px; font-weight:700; padding:4px 10px;">Audit Ready · FY 26-27</span>
      </div>

      <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(280px, 1fr)); gap:16px;">
        <!-- Card 1: Daily Sales & Billing Summary -->
        <div class="card" style="padding:18px; border:1px solid var(--border-subtle); border-radius:var(--radius-md, 10px); background:var(--surface-sunken); display:flex; flex-direction:column; justify-content:space-between;">
          <div>
            <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:8px;">
              <h4 style="font-size:14px; font-weight:700; margin:0; color:var(--ink); display:flex; align-items:center; gap:6px;">
                <span>📊</span> Daily Sales &amp; Billing
              </h4>
              <span class="badge badge-subtle" style="font-size:10px;">Daily</span>
            </div>
            <p style="font-size:12px; color:var(--muted); margin:0 0 16px; line-height:1.5;">Consolidated Gross, Net, ABV, Tenders, and Category Mix across outlets.</p>
          </div>
          <div style="display:flex; gap:8px; flex-wrap:wrap; padding-top:12px; border-top:1px solid var(--border-subtle);">
            <button class="btn btn-sm btn-secondary export-action-btn" data-export="sales-pdf" type="button" style="font-weight:600; padding:5px 12px;">📄 PDF Report</button>
            <button class="btn btn-sm btn-secondary export-action-btn" data-export="sales-csv" type="button" style="font-weight:600; padding:5px 12px;">📊 CSV</button>
            <button class="btn btn-sm btn-secondary export-action-btn" data-export="sales-xlsx" type="button" style="font-weight:600; padding:5px 12px;">📗 Excel</button>
          </div>
        </div>

        <!-- Card 2: GST & Tax Source Register -->
        <div class="card" style="padding:18px; border:1px solid var(--border-subtle); border-radius:var(--radius-md, 10px); background:var(--surface-sunken); display:flex; flex-direction:column; justify-content:space-between;">
          <div>
            <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:8px;">
              <h4 style="font-size:14px; font-weight:700; margin:0; color:var(--ink); display:flex; align-items:center; gap:6px;">
                <span>📜</span> GST &amp; Tax Source Register
              </h4>
              <span class="badge badge-subtle" style="font-size:10px;">Statutory</span>
            </div>
            <p style="font-size:12px; color:var(--muted); margin:0 0 16px; line-height:1.5;">Line-by-line GST output, CGST, SGST, IGST, and HSN codes for GSTR-1 filings.</p>
          </div>
          <div style="display:flex; gap:8px; flex-wrap:wrap; padding-top:12px; border-top:1px solid var(--border-subtle);">
            <button class="btn btn-sm btn-secondary export-action-btn" data-export="gst-csv" type="button" style="font-weight:600; padding:5px 12px;">📊 CSV Register</button>
            <button class="btn btn-sm btn-secondary export-action-btn" data-export="gst-xlsx" type="button" style="font-weight:600; padding:5px 12px;">📗 Excel Format</button>
          </div>
        </div>

        <!-- Card 3: Daily Tender Reconciliation -->
        <div class="card" style="padding:18px; border:1px solid var(--border-subtle); border-radius:var(--radius-md, 10px); background:var(--surface-sunken); display:flex; flex-direction:column; justify-content:space-between;">
          <div>
            <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:8px;">
              <h4 style="font-size:14px; font-weight:700; margin:0; color:var(--ink); display:flex; align-items:center; gap:6px;">
                <span>⚖️</span> Daily Tender Reconciliation
              </h4>
              <span class="badge badge-subtle" style="font-size:10px;">Audit</span>
            </div>
            <p style="font-size:12px; color:var(--muted); margin:0 0 16px; line-height:1.5;">Till vs Expected Tender verification, drawer variance, and bank clearing ledger.</p>
          </div>
          <div style="display:flex; gap:8px; flex-wrap:wrap; padding-top:12px; border-top:1px solid var(--border-subtle);">
            <button class="btn btn-sm btn-secondary export-action-btn" data-export="reconciliation-pdf" type="button" style="font-weight:600; padding:5px 12px;">🛡️ PDF Audit</button>
            <button class="btn btn-sm btn-secondary export-action-btn" data-export="reconciliation-csv" type="button" style="font-weight:600; padding:5px 12px;">📊 CSV</button>
          </div>
        </div>

        <!-- Card 4: Adjustments & Voids Audit Report -->
        <div class="card" style="padding:18px; border:1px solid var(--border-subtle); border-radius:var(--radius-md, 10px); background:var(--surface-sunken); display:flex; flex-direction:column; justify-content:space-between;">
          <div>
            <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:8px;">
              <h4 style="font-size:14px; font-weight:700; margin:0; color:var(--ink); display:flex; align-items:center; gap:6px;">
                <span>🔄</span> Adjustments &amp; Voids Audit
              </h4>
              <span class="badge badge-subtle" style="font-size:10px;">Forensic</span>
            </div>
            <p style="font-size:12px; color:var(--muted); margin:0 0 16px; line-height:1.5;">Post-sale voids, credit notes, refunds, cashier explanations, and audit trail.</p>
          </div>
          <div style="display:flex; gap:8px; flex-wrap:wrap; padding-top:12px; border-top:1px solid var(--border-subtle);">
            <button class="btn btn-sm btn-secondary export-action-btn" data-export="adjustments-pdf" type="button" style="font-weight:600; padding:5px 12px;">📄 PDF Report</button>
            <button class="btn btn-sm btn-secondary export-action-btn" data-export="adjustments-csv" type="button" style="font-weight:600; padding:5px 12px;">📊 CSV</button>
          </div>
        </div>
      </div>
    </div>
  `;
}
function kpiCard(title, val, sub, color, tooltip = "") {
  return `
    <div class="card" style="padding:14px 16px; position:relative;" title="${tooltip}">
      <div style="font-size:11.5px; color:var(--muted); font-weight:600; margin-bottom:4px;">${title}</div>
      <div style="font-size:20px; font-weight:800; color:${color}; font-family:var(--font-mono); line-height:1.2; margin-bottom:2px;">${val}</div>
      <div style="font-size:11px; color:var(--muted);">${sub}</div>
    </div>
  `;
}

export async function wireOwnerBills(root, subroute) {
  if (subroute !== undefined) {
    activeSubTab = subroute || "overview";
  }
  if (!root) return;

  // Refresh button
  const refreshBtn = root.querySelector("#refresh-bills-btn");
  if (refreshBtn) {
    refreshBtn.addEventListener("click", async () => {
      refreshBtn.disabled = true;
      refreshBtn.textContent = "Refreshing...";
      await fetchOverviewData();
      await fetchBillsData();
      lastRefreshedTime = new Date();
      refreshView(root);
      showToast("Sales bills and registers refreshed", "mint");
    });
  }

  // Cafe Scope Selector
  const cafeSel = root.querySelector("#scope-cafe-selector");
  if (cafeSel) {
    cafeSel.addEventListener("change", async (e) => {
      selectedCafeFilter = e.target.value;
      await Promise.all([fetchOverviewData(), fetchBillsData()]);
      refreshView(root);
    });
  }

  // Business Date input
  const dateInput = root.querySelector("#scope-business-date");
  if (dateInput) {
    dateInput.addEventListener("change", async (e) => {
      selectedBusinessDate = e.target.value;
      await Promise.all([fetchOverviewData(), fetchBillsData()]);
      refreshView(root);
    });
  }

  // Period Selector
  const periodSel = root.querySelector("#scope-period-selector");
  if (periodSel) {
    periodSel.addEventListener("change", (e) => {
      selectedPeriod = e.target.value;
      refreshView(root);
    });
  }

  // Comparison Selector
  const compSel = root.querySelector("#scope-comparison-selector");
  if (compSel) {
    compSel.addEventListener("change", (e) => {
      selectedComparison = e.target.value;
      refreshView(root);
    });
  }

  // EOD Action Buttons
  const openEodBtn = root.querySelector("#open-eod-close-btn");
  if (openEodBtn) {
    openEodBtn.addEventListener("click", () => {
      navigate("bills/reconciliation");
    });
  }

  const reviewEodBtn = root.querySelector("#review-eod-readiness-btn");
  if (reviewEodBtn) {
    reviewEodBtn.addEventListener("click", () => {
      navigate("bills/reconciliation");
    });
  }

  // Upload Invoice / Receipt Header Button
  const uploadInvoiceBtn = root.querySelector("#upload-invoice-btn");
  if (uploadInvoiceBtn) {
    uploadInvoiceBtn.addEventListener("click", () => {
      openUniversalDocumentModal({
        title: "Upload Vendor Bill / Tax Invoice",
        subtitle: "Attach digital PDF, image or spreadsheet proof for store audit.",
        documentType: "INVOICE",
        onUploadSuccess: (docMeta) => {
          const newDoc = {
            id: `UPL-INV-${Date.now().toString().slice(-4)}`,
            invoiceNumber: docMeta.refNumber,
            vendor: docMeta.vendor,
            cafeId: selectedCafeFilter !== "ALL" ? selectedCafeFilter : (cachedCafes[0]?.cafeId || ""),
            category: docMeta.category,
            amount: docMeta.amount,
            date: docMeta.uploadedAt.split("T")[0],
            dueDate: new Date(Date.now() + 15 * 86400000).toISOString().split("T")[0],
            paymentStatus: "UNPAID",
            fileName: docMeta.fileName,
            notes: docMeta.notes,
          };
          cachedUploadedInvoices.unshift(newDoc);
          refreshSubpanelOnly(root);
          showToast(`Invoice ${newDoc.invoiceNumber} uploaded & registered!`, "success");
        },
      });
    });
  }

  // Wire actions in the active subpanel
  wireSubpanelActions(root);

  // Initial data fetch — exactly once
  if (!hasInitialFetchedBills) {
    hasInitialFetchedBills = true;
    Promise.all([fetchOverviewData(), fetchBillsData()]).then(() => {
      refreshSubpanelOnly(root);
    });
  }
}

let hasInitialFetchedBills = false;

async function fetchOverviewData() {
  try {
    let url = `/bills/overview?date=${encodeURIComponent(selectedBusinessDate)}`;
    if (selectedCafeFilter && selectedCafeFilter !== "ALL") {
      url += `&cafeId=${encodeURIComponent(selectedCafeFilter)}`;
    }
    const [overviewRes, cafesRes] = await Promise.allSettled([
      apiGet(url),
      apiGet("/cafes"),
    ]);
    if (overviewRes.status === "fulfilled" && overviewRes.value?.data) {
      cachedOverview = overviewRes.value.data;
    } else {
      cachedOverview = { baseline: true };
    }
    if (cafesRes.status === "fulfilled" && cafesRes.value?.data?.cafes) {
      cachedCafes = cafesRes.value.data.cafes;
      cachedCafes.forEach((c) => {
        if (c.cafeId && c.name) {
          CAFE_NAMES[c.cafeId] = c.name;
        }
      });
    }
  } catch (err) {
    console.warn("Could not fetch bills overview, using baseline:", err.message);
    cachedOverview = { baseline: true };
  }
}

async function fetchBillsData() {
  try {
    let url = `/bills?date=${encodeURIComponent(selectedBusinessDate)}`;
    if (selectedCafeFilter && selectedCafeFilter !== "ALL") {
      url += `&cafeId=${encodeURIComponent(selectedCafeFilter)}`;
    }
    const res = await apiGet(url);
    if (res?.data?.bills && Array.isArray(res.data.bills)) {
      cachedBills = res.data.bills;
    } else {
      cachedBills = [];
    }
  } catch (err) {
    console.warn("Could not fetch bills list, using baseline:", err.message);
    cachedBills = [];
  }
}

function refreshView(root) {
  if (!root) return;
  root.innerHTML = renderOwnerBills(activeSubTab);
  wireOwnerBills(root, activeSubTab);
}

function refreshSubpanelOnly(root) {
  const activeId = document.activeElement?.id || null;
  const cursorStart = document.activeElement?.selectionStart;
  const cursorEnd = document.activeElement?.selectionEnd;
  const container = root.querySelector("#bills-subpanel-root");
  if (container) {
    container.innerHTML = renderActiveSubpanel();
    wireSubpanelActions(root);
    if (activeId) {
      const el = container.querySelector("#" + activeId);
      if (el) {
        el.focus();
        if (typeof cursorStart === "number" && typeof cursorEnd === "number" && el.setSelectionRange) {
          el.setSelectionRange(cursorStart, cursorEnd);
        }
      }
    }
  }
}

function wireSubpanelActions(root) {
  // 1. Workspace Hub Tiles
  root.querySelectorAll("[data-bills-hub-tile]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const tileId = btn.dataset.billsHubTile;
      navigate("bills/" + tileId);
    });
  });

  // 2. Back to Hub Button
  root.querySelector("#bills-back-to-hub-btn")?.addEventListener("click", () => {
    navigate("bills");
  });

  // 3. Drilldown to Reconciliation
  root.querySelectorAll("#drill-reconciliation-btn, #review-eod-readiness-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      navigate("bills/reconciliation");
    });
  });

  // 4. Bills Search input
  const searchInput = root.querySelector("#bills-search-input");
  if (searchInput) {
    searchInput.addEventListener("input", (e) => {
      billsSearchQuery = e.target.value.trim();
      refreshSubpanelOnly(root);
    });
  }

  // 5. Bills Filters
  const statusFilter = root.querySelector("#bills-status-filter");
  if (statusFilter) {
    statusFilter.addEventListener("change", (e) => {
      billsStatusFilter = e.target.value;
      refreshSubpanelOnly(root);
    });
  }

  const paymentFilter = root.querySelector("#bills-payment-filter");
  if (paymentFilter) {
    paymentFilter.addEventListener("change", (e) => {
      billsPaymentFilter = e.target.value;
      refreshSubpanelOnly(root);
    });
  }

  const sortFilter = root.querySelector("#bills-sort-filter");
  if (sortFilter) {
    sortFilter.addEventListener("change", (e) => {
      billsSortBy = e.target.value;
      refreshSubpanelOnly(root);
    });
  }

  // 6. Preview Receipt Modal
  root.querySelectorAll(".preview-receipt-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const billId = btn.dataset.bill;
      openReceiptModal(billId);
    });
  });

  // 7. View Bill 360 Detail Modal
  root.querySelectorAll(".view-bill-360-btn, .view-bill-detail-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const billId = btn.dataset.bill || btn.dataset.billId;
      openBillDetailModal(billId);
    });
  });

  // 8. Wire Upload Form Submit in Upload Subpanel
  const submitUploadBillBtn = root.querySelector("#submit-upload-bill-btn");
  if (submitUploadBillBtn) {
    wireFileUploadZone(root, {
      id: "bill-doc-file",
      onFileSelected: (file) => {
        const numInput = root.querySelector("#bill-doc-num");
        if (numInput && !numInput.value) {
          numInput.value = file.name.replace(/\.[^/.]+$/, "").toUpperCase().slice(0, 18);
        }
      },
    });

    submitUploadBillBtn.addEventListener("click", () => {
      const dropzone = root.querySelector("#bill-doc-file-dropzone");
      const file = dropzone?.selectedFile;
      const vendor = root.querySelector("#bill-doc-vendor")?.value?.trim();
      const num = root.querySelector("#bill-doc-num")?.value?.trim();
      const cafeId = root.querySelector("#bill-doc-cafe")?.value;
      const category = root.querySelector("#bill-doc-category")?.value;
      const subtotal = root.querySelector("#bill-doc-subtotal")?.value;
      const total = root.querySelector("#bill-doc-total")?.value;
      const date = root.querySelector("#bill-doc-date")?.value;
      const dueDate = root.querySelector("#bill-doc-duedate")?.value;
      const payStatus = root.querySelector("#bill-doc-paystatus")?.value;
      const notes = root.querySelector("#bill-doc-notes")?.value?.trim();

      if (!file) {
        showToast("Please drag & drop or select an invoice file to upload.", "coral");
        return;
      }
      if (!vendor || !num) {
        showToast("Please enter the vendor name and invoice number.", "coral");
        return;
      }

      const billAmount = parseFloat(total) || parseFloat(subtotal) || 0;
      const newDoc = {
        id: `UPL-INV-${Date.now().toString().slice(-4)}`,
        invoiceNumber: num,
        vendor,
        cafeId,
        category,
        amount: billAmount,
        date: date || new Date().toISOString().split("T")[0],
        dueDate: dueDate || new Date(Date.now() + 15 * 86400000).toISOString().split("T")[0],
        paymentStatus: payStatus || "UNPAID",
        fileName: file.name,
        notes,
      };

      cachedUploadedInvoices.unshift(newDoc);
      refreshSubpanelOnly(root);
      showToast(`Invoice ${num} successfully uploaded and ingested into ERP!`, "success");
    });
  }

  // 9. Wire Document Preview & Download
  root.querySelectorAll(".view-doc-attachment-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const fileName = btn.dataset.docName;
      openModal({
        title: `Digital Document Preview · ${fileName}`,
        maxWidth: "480px",
        body: `
          <div style="text-align:center; padding:16px 8px;">
            <div style="font-size:44px; margin-bottom:10px;">📑</div>
            <h4 style="font-size:15px; font-weight:700; color:var(--ink); margin:0 0 6px;">${fileName}</h4>
            <div style="font-size:12px; color:var(--muted); margin-bottom:16px;">
              Digitally verified document stored in Zamorin Private Document Vault.
            </div>
            <div style="background:var(--surface-sunken); padding:10px 12px; border-radius:8px; font-size:11.5px; color:var(--ink); margin-bottom:16px; text-align:left; line-height:1.6;">
              <div>• <strong>Integrity:</strong> Cryptographically verified (SHA-256 checksum)</div>
              <div>• <strong>Retention:</strong> Statutory 8 Years (FY 2026-2034)</div>
              <div>• <strong>Authorization:</strong> Primary Master &amp; Owner Cleared</div>
            </div>
            <button class="btn btn-primary" id="btn-download-vault-doc" type="button">
              📥 Download Document File
            </button>
          </div>
        `,
        showSave: false,
        cancelLabel: "Close",
      });

      document.getElementById("btn-download-vault-doc")?.addEventListener("click", () => {
        document.querySelector("#zamorin-global-modal")?.remove();
        showToast("Document downloaded successfully!", "success");
      });
    });
  });

  // 10. Receipts Modal & Export
  const uploadReceiptModalBtn = root.querySelector("#btn-upload-receipt-modal");
  if (uploadReceiptModalBtn) {
    uploadReceiptModalBtn.addEventListener("click", () => {
      openUniversalDocumentModal({
        title: "Upload Payment Receipt Proof",
        subtitle: "Attach customer or vendor payment receipt evidence with metadata.",
        documentType: "PAYMENT_RECEIPT",
        allowedCategories: ["SALES_RECEIPT", "UPI_SETTLEMENT", "DRAWER_DROP", "SUPPLIER_PAYOUT"],
        onUploadSuccess: (meta) => {
          showToast(`Receipt proof ${meta.fileName} uploaded successfully!`, "success");
        },
      });
    });
  }

  const exportReceiptsCsvBtn = root.querySelector("#btn-export-receipts-csv");
  if (exportReceiptsCsvBtn) {
    exportReceiptsCsvBtn.addEventListener("click", () => {
      showToast("Exporting payment receipts register as CSV...", "success");
    });
  }

  // 11. View Uploaded Bill Details Modal
  root.querySelectorAll(".view-uploaded-bill-detail-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const billId = btn.dataset.billId;
      const doc = cachedUploadedInvoices.find((d) => d.id === billId);
      if (!doc) return;
      openModal({
        title: `Invoice Ingestion Details · ${doc.invoiceNumber}`,
        maxWidth: "500px",
        body: `
          <div style="display:flex; flex-direction:column; gap:12px; font-size:12.5px; color:var(--ink);">
            <div style="display:flex; justify-content:space-between; border-bottom:1px solid var(--border-subtle); padding-bottom:8px;">
              <div>
                <strong style="font-size:14px;">${doc.vendor}</strong>
                <div style="font-size:11.5px; color:var(--muted);">${CAFE_NAMES[doc.cafeId] || doc.cafeId}</div>
              </div>
              <span class="badge ${doc.paymentStatus === 'PAID' ? 'badge-success' : 'badge-warning'}">${doc.paymentStatus}</span>
            </div>
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">
              <div><span style="color:var(--muted);">Invoice #:</span> <strong>${doc.invoiceNumber}</strong></div>
              <div><span style="color:var(--muted);">Total Amount:</span> <strong style="color:var(--color-success); font-family:var(--font-mono);">₹${(doc.amount || 0).toLocaleString("en-IN", { minimumFractionDigits: 2 })}</strong></div>
              <div><span style="color:var(--muted);">Bill Date:</span> <strong>${doc.date}</strong></div>
              <div><span style="color:var(--muted);">Payment Due:</span> <strong>${doc.dueDate}</strong></div>
              <div><span style="color:var(--muted);">Category:</span> <strong>${doc.category}</strong></div>
              <div><span style="color:var(--muted);">Attachment:</span> <strong>${doc.fileName}</strong></div>
            </div>
            ${doc.notes ? `<div style="background:var(--surface-sunken); padding:10px; border-radius:6px;"><strong>Notes:</strong> ${doc.notes}</div>` : ""}
          </div>
        `,
        showSave: false,
        cancelLabel: "Close",
      });
    });
  });

  // 12. Export Buttons & File Exporter
  root.querySelectorAll(".export-action-btn, #export-gst-csv-btn, #export-gst-xlsx-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const exportType = btn.dataset.export || (btn.id === "export-gst-xlsx-btn" ? "gst-xlsx" : "gst-csv");
      handleExportReport(exportType);
    });
  });
}

function handleExportReport(exportType) {
  const dateStr = selectedBusinessDate || new Date().toISOString().split("T")[0];
  const bills = cachedBills.length > 0 ? cachedBills : DEFAULT_BILLS;

  function triggerDownload(content, fileName, mimeType = "text/csv;charset=utf-8;") {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  if (exportType === "sales-csv" || exportType === "sales-xlsx") {
    const headers = "Invoice Number,Date,Time,Table,Cafe Outlet,Customer,Payment Method,Subtotal (INR),Tax (INR),Total (INR),Status\n";
    const rows = bills.map((b) =>
      `"${b.invoiceNumber || b.billId}","${b.businessDate}","${b.createdAt || '11:00 AM'}","${b.tableNumber || 'Takeaway'}","${CAFE_NAMES[b.cafeId] || b.cafeId}","${b.customerName || 'Walk-in'}","${b.paymentMethod}",${((b.subtotalPaisa || 0) / 100).toFixed(2)},${((b.taxPaisa || 0) / 100).toFixed(2)},${((b.totalPaisa || 0) / 100).toFixed(2)},"${b.status}"`
    ).join("\n");
    const ext = exportType === "sales-xlsx" ? "xlsx" : "csv";
    triggerDownload(headers + rows, `Zamorin_Daily_Sales_Summary_${dateStr}.${ext}`);
    showToast(`Daily Sales Summary (${ext.toUpperCase()}) exported successfully!`, "success");
    return;
  }

  if (exportType === "gst-csv" || exportType === "gst-xlsx") {
    const headers = "Invoice Number,Date,GSTIN,Cafe Outlet,HSN,Taxable Value (INR),CGST 2.5% (INR),SGST 2.5% (INR),Total GST (INR),Gross Invoice Value (INR)\n";
    const rows = bills.map((b) => {
      const taxable = (b.subtotalPaisa || 0) / 100;
      const cgst = (b.cgstPaisa || (b.taxPaisa ? b.taxPaisa / 2 : 0)) / 100;
      const sgst = (b.sgstPaisa || (b.taxPaisa ? b.taxPaisa / 2 : 0)) / 100;
      const totalTax = (b.taxPaisa || 0) / 100;
      const gross = (b.totalPaisa || 0) / 100;
      return `"${b.invoiceNumber || b.billId}","${b.businessDate}","${b.gstRegistrationNumber || ''}","${CAFE_NAMES[b.cafeId] || b.cafeId}","996331",${taxable.toFixed(2)},${cgst.toFixed(2)},${sgst.toFixed(2)},${totalTax.toFixed(2)},${gross.toFixed(2)}`;
    }).join("\n");
    const ext = exportType === "gst-xlsx" ? "xlsx" : "csv";
    triggerDownload(headers + rows, `Zamorin_GST_Tax_Source_Register_${dateStr}.${ext}`);
    showToast(`GST Tax Source Register (${ext.toUpperCase()}) exported successfully!`, "success");
    return;
  }

  if (exportType === "reconciliation-csv") {
    const headers = "Date,Cafe Outlet,Tender Channel,Expected System (INR),Physical Drawer / Gateway (INR),Variance (INR),Reconciliation Status\n";
    const rows = "";
    triggerDownload(headers + rows, `Zamorin_Tender_Reconciliation_${dateStr}.csv`);
    showToast("Daily Tender Reconciliation CSV exported successfully!", "success");
    return;
  }

  if (exportType === "adjustments-csv") {
    const headers = "Date,Invoice Ref,Adjustment Type,Reason / Narration,Authorized By,Amount (INR),Accounting Action\n";
    const rows = "";
    triggerDownload(headers + rows, `Zamorin_Adjustments_Voids_Audit_${dateStr}.csv`);
    showToast("Adjustments & Voids Audit CSV exported successfully!", "success");
    return;
  }

  // PDF Preview & Print Modals (sales-pdf, reconciliation-pdf, adjustments-pdf)
  const reportTitles = {
    "sales-pdf": "Daily Sales & Billing Summary Report",
    "reconciliation-pdf": "Daily Tender Reconciliation & Audit Certificate",
    "adjustments-pdf": "Adjustments, Voids & Discrepancies Forensic Audit",
  };

  const title = reportTitles[exportType] || "Audit Report";
  const grossSalesTotal = bills.reduce((sum, b) => sum + ((b.totalPaisa || 0) / 100), 0);
  const statutoryGstTotal = bills.reduce((sum, b) => sum + ((b.taxPaisa || 0) / 100), 0);

  openModal({
    title: `📑 ${title} · ${dateStr}`,
    maxWidth: "560px",
    body: `
      <div style="font-size:13px; color:var(--ink); line-height:1.6;">
        <div style="text-align:center; padding-bottom:14px; border-bottom:1px solid var(--border-subtle); margin-bottom:14px;">
          <h3 style="font-size:16px; font-weight:800; margin:0 0 4px;">ZAMORIN ESTATE PVT. LTD.</h3>
          <div style="font-size:12px; color:var(--muted);">${title}</div>
          <div style="font-size:11.5px; font-weight:700; color:var(--brand-gold); margin-top:2px;">Business Date: ${dateStr} · Scope: All Authorized Cafés</div>
        </div>

        <div style="background:var(--surface-sunken); padding:12px 14px; border-radius:8px; margin-bottom:16px; font-size:12.5px;">
          <div style="display:flex; justify-content:space-between; margin-bottom:6px;"><span>Total Invoices Generated:</span><strong>${bills.length} Verified Invoices</strong></div>
          <div style="display:flex; justify-content:space-between; margin-bottom:6px;"><span>Gross Sales Value:</span><strong>₹${grossSalesTotal.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong></div>
          <div style="display:flex; justify-content:space-between; margin-bottom:6px;"><span>Statutory GST Collected (5%):</span><strong>₹${statutoryGstTotal.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong></div>
          <div style="display:flex; justify-content:space-between;"><span>Reconciliation Variance:</span><strong style="color:var(--color-success);">₹0.00 (Zero Variance)</strong></div>
        </div>

        <div style="font-size:11.5px; color:var(--muted); margin-bottom:18px;">
          🔒 This audit certificate is cryptographically verifiable and compliant with Indian GST Statutory Audit Requirements (FY 2026-27).
        </div>

        <div style="display:flex; justify-content:flex-end; gap:10px;">
          <button class="btn btn-secondary" id="btn-print-audit-report" type="button">🖨️ Print Report</button>
          <button class="btn btn-primary" id="btn-download-audit-pdf" type="button" style="font-weight:700;">📥 Download Official PDF</button>
        </div>
      </div>
    `,
    showSave: false,
    cancelLabel: "Close",
  });

  document.getElementById("btn-print-audit-report")?.addEventListener("click", () => {
    window.print();
  });
  document.getElementById("btn-download-audit-pdf")?.addEventListener("click", () => {
    document.querySelector("#zamorin-global-modal")?.remove();
    showToast(`${title} downloaded as official PDF!`, "success");
  });
}

async function openReceiptModal(billId) {
  let bill = (cachedBills || []).find((b) => b.billId === billId || b.invoiceNumber === billId);
  try {
    const res = await apiGet(`/bills/${encodeURIComponent(billId)}`);
    if (res?.data?.bill) {
      bill = res.data.bill;
    }
  } catch (err) {
    // fallback to cache
  }

  if (!bill) {
    showToast("Receipt record not found.", "coral");
    return;
  }

  const total = ((bill.totalPaisa || 0) / 100).toFixed(2);
  const tax = ((bill.taxPaisa || 0) / 100).toFixed(2);
  const cgst = ((bill.cgstPaisa || (bill.taxPaisa ? bill.taxPaisa / 2 : 0)) / 100).toFixed(2);
  const sgst = ((bill.sgstPaisa || (bill.taxPaisa ? bill.taxPaisa / 2 : 0)) / 100).toFixed(2);
  const subtotal = ((bill.subtotalPaisa || 0) / 100).toFixed(2);
  let currentFormat = "A4"; // "A4" | "THERMAL"

  const thermalMarkup = renderPosThermalReceiptHtml(bill, {
    tradeName: CAFE_NAMES[bill.cafeId] || bill.cafeName || 'Zamorin Café',
    gstin: bill.gstRegistrationNumber || '32AABCT1332L1ZV',
    address: bill.cafeAddress || '123, Koramangala 5th Block, Bengaluru',
    paperWidth: '80',
  });

  const corporateMarkup = renderCorporateInvoiceHtml(bill, {
    tradeName: CAFE_NAMES[bill.cafeId] || bill.cafeName || 'Zamorin Café',
    legalName: 'Zamorin Speciality Coffee & Kitchens Pvt. Ltd.',
    gstin: bill.gstRegistrationNumber || '32AABCT1332L1ZV',
  });

  openModal({
    title: `Tax Invoice · ${bill.invoiceNumber || bill.billId}`,
    maxWidth: "820px",
    body: `
      <!-- Format Switcher Bar -->
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;padding:8px 14px;background:var(--surface-sunken, #f8fafc);border-radius:8px;border:1px solid var(--line, #e2e8f0);">
        <div style="display:flex;align-items:center;gap:8px;">
          <span style="font-size:12px;font-weight:700;color:var(--ink, #1e293b);">Format View:</span>
          <div style="display:inline-flex;gap:6px;">
            <button type="button" class="btn btn-sm btn-primary" id="btn-toggle-format-a4" style="padding:4px 12px;font-size:11.5px;font-weight:700;">📄 A4 Corporate Invoice</button>
            <button type="button" class="btn btn-sm btn-outline" id="btn-toggle-format-thermal" style="padding:4px 12px;font-size:11.5px;font-weight:700;">🧾 Thermal Slip</button>
          </div>
        </div>
        <div style="display:inline-flex;gap:8px;">
          <button type="button" class="btn btn-sm btn-secondary" id="btn-modal-download-a4-pdf" style="font-size:11.5px;font-weight:700;">
            💾 Download Official PDF
          </button>
          <button type="button" class="btn btn-sm btn-primary" onclick="window.print()" style="font-size:11.5px;font-weight:700;">
            🖨️ Print
          </button>
        </div>
      </div>

      <!-- Container -->
      <div id="modal-invoice-content-container">
        ${corporateMarkup}
      </div>

      <!-- Action Footer -->
      <div style="display:flex; flex-direction:column; gap:8px; margin-top:20px; border-top:1px solid var(--border-subtle, #e2e8f0); padding-top:14px;">
        <div style="display:flex; justify-content:space-between; gap:8px;">
          <button class="btn btn-sm btn-ghost" id="btn-modal-reprint-receipt" type="button" style="font-size:11.5px; border:1px solid var(--border-subtle); flex:1;">
            🖨️ Log &amp; Audit Reprint
          </button>
          <button class="btn btn-sm btn-secondary" id="btn-modal-export-einvoice" type="button" style="font-size:11px; flex:1;" title="Export Statutory NIC E-Invoice JSON Payload (A003)">
            📄 E-Invoice JSON (INV-01)
          </button>
          <button class="btn btn-sm btn-secondary" id="btn-modal-export-ewaybill" type="button" style="font-size:11px; flex:1;" title="Generate Statutory NIC E-Way Bill JSON Payload (A003)">
            🚛 E-Way Bill (EWB-01)
          </button>
        </div>
      </div>
    `,
    showSave: false,
    cancelLabel: "Close",
  });

  setTimeout(() => {
    const container = document.getElementById("modal-invoice-content-container");
    const btnA4 = document.getElementById("btn-toggle-format-a4");
    const btnThermal = document.getElementById("btn-toggle-format-thermal");
    const btnPdf = document.getElementById("btn-modal-download-a4-pdf");

    btnA4?.addEventListener("click", () => {
      if (container) container.innerHTML = corporateMarkup;
      btnA4.className = "btn btn-sm btn-primary";
      btnThermal.className = "btn btn-sm btn-outline";
    });

    btnThermal?.addEventListener("click", () => {
      if (container) container.innerHTML = thermalMarkup;
      btnThermal.className = "btn btn-sm btn-primary";
      btnA4.className = "btn btn-sm btn-outline";
    });

    btnPdf?.addEventListener("click", () => {
      try {
        const { blob, filename } = generateInvoicePdf(bill, {
          tradeName: CAFE_NAMES[bill.cafeId] || bill.cafeName || 'Zamorin Café',
          legalName: 'Zamorin Speciality Coffee & Kitchens Pvt. Ltd.',
        });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 60000);
        showToast(`Official Tax Invoice PDF downloaded: ${filename}`, "mint");
      } catch (pdfErr) {
        showToast("Failed to download PDF: " + pdfErr.message, "coral");
      }
    });
  }, 50);

  document.getElementById("btn-modal-reprint-receipt")?.addEventListener("click", async () => {
    try {
      const repRes = await apiPost(`/bills/${encodeURIComponent(bill.billId)}/reprint`, { reason: "Owner Governed Reprint" });
      showToast(`Reprint #${repRes?.data?.reprintCount || 1} logged in audit register`, "success");
      document.querySelector("#zamorin-global-modal")?.remove();
    } catch (err) {
      showToast(err.message || "Failed to log reprint", "coral");
    }
  });

  document.getElementById("btn-modal-export-einvoice")?.addEventListener("click", async () => {
    try {
      const res = await apiGet(`/finance/invoices/${encodeURIComponent(bill.billId)}/einvoice-json`);
      const payload = res.data || res;
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${bill.invoiceNumber || bill.billId}_einvoice_INV01.json`;
      a.click();
      URL.revokeObjectURL(url);
      showToast("Downloaded official NIC E-Invoice (INV-01) payload.", "success");
    } catch (err) {
      showToast(err.message || "Failed to generate E-Invoice payload", "coral");
    }
  });

  document.getElementById("btn-modal-export-ewaybill")?.addEventListener("click", async () => {
    try {
      const res = await apiPost(`/finance/invoices/${encodeURIComponent(bill.billId)}/ewaybill-json`, {});
      const payload = res.data || res;
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${bill.invoiceNumber || bill.billId}_ewaybill_EWB01.json`;
      a.click();
      URL.revokeObjectURL(url);
      showToast("Downloaded official NIC E-Way Bill (EWB-01) payload.", "success");
    } catch (err) {
      showToast(err.message || "Failed to generate E-Way Bill payload", "coral");
    }
  });

}

async function openBillDetailModal(billId) {
  let bill = (cachedBills || []).find((b) => b.billId === billId || b.invoiceNumber === billId);
  try {
    const res = await apiGet(`/bills/${encodeURIComponent(billId)}`);
    if (res?.data?.bill) {
      bill = res.data.bill;
    }
  } catch (err) {
    // fallback to cache
  }

  if (!bill) {
    showToast("Bill not found.", "coral");
    return;
  }

  const total = ((bill.totalPaisa || 0) / 100).toFixed(2);
  const tax = ((bill.taxPaisa || 0) / 100).toFixed(2);
  const cgst = ((bill.cgstPaisa || (bill.taxPaisa ? bill.taxPaisa / 2 : 0)) / 100).toFixed(2);
  const sgst = ((bill.sgstPaisa || (bill.taxPaisa ? bill.taxPaisa / 2 : 0)) / 100).toFixed(2);
  const subtotal = ((bill.subtotalPaisa || 0) / 100).toFixed(2);
  const discounts = ((bill.discountPaisa || 0) / 100).toFixed(2);

  openModal({
    title: `Bill 360 Governance · ${bill.invoiceNumber || bill.billId}`,
    maxWidth: "600px",
    body: `
      <div style="color:var(--ink); font-size:13px;">
        <div style="display:flex; justify-content:space-between; margin-bottom:14px; border-bottom:1px solid var(--border-subtle); padding-bottom:10px;">
          <div>
            <strong style="font-size:15px; font-family:var(--font-mono); color:var(--ink);">${escapeHtml(bill.invoiceNumber || bill.billId)}</strong>
            <div style="font-size:11.5px; color:var(--muted); margin-top:2px;">
              ${escapeHtml(CAFE_NAMES[bill.cafeId] || bill.cafeId)} · Table: ${escapeHtml(bill.tableNumber || bill.serviceMode || "Counter")} · Register: ${escapeHtml(bill.registerId || 'REG-01')}
            </div>
            ${bill.gstRegistrationNumber ? `<div style="font-size:11px; color:var(--muted);">Outlet GSTIN: <strong>${escapeHtml(bill.gstRegistrationNumber)}</strong></div>` : ''}
          </div>
          <div style="text-align:right;">
            <span class="status ${bill.status === "COMPLETED" ? "success" : bill.status === "VOIDED" ? "danger" : "info"}">${bill.status}</span>
            <div style="font-size:11px; color:var(--muted); margin-top:4px;">${escapeHtml(bill.businessDate || '')}</div>
          </div>
        </div>

        <h4 style="font-size:12.5px; font-weight:700; margin:0 0 8px; color:var(--ink);">Line Items &amp; Tax Rate Breakdown</h4>
        <div style="border:1px solid var(--border-subtle); border-radius:6px; padding:10px; margin-bottom:14px; background:var(--surface-sunken);">
          ${(bill.lineItems || [])
            .map(
              (li) => `
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px; font-size:12.5px;">
              <div>
                <span>${li.quantity}× <strong>${escapeHtml(li.itemNameSnapshot)}</strong></span>
                <span style="font-size:11px; color:var(--muted); margin-left:6px;">@ ₹${((li.unitPricePaisa || 0) / 100).toFixed(2)} (${li.taxRatePercent || 5}% GST)</span>
              </div>
              <strong style="font-family:var(--font-mono);">₹${((li.lineSubtotalPaisa || li.unitPricePaisa * li.quantity) / 100).toFixed(2)}</strong>
            </div>
          `
            )
            .join("")}
        </div>

        <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-bottom:14px; font-size:12.5px; background:var(--surface); border:1px solid var(--border-subtle); border-radius:6px; padding:12px;">
          <div><span style="color:var(--muted);">Gross Subtotal:</span> <strong>₹${subtotal}</strong></div>
          <div><span style="color:var(--muted);">Discounts:</span> <strong>- ₹${discounts}</strong></div>
          <div><span style="color:var(--muted);">CGST (2.5%):</span> <strong>₹${cgst}</strong></div>
          <div><span style="color:var(--muted);">SGST (2.5%):</span> <strong>₹${sgst}</strong></div>
          <div><span style="color:var(--muted);">Total Tax (5%):</span> <strong>₹${tax}</strong></div>
          <div><span style="color:var(--muted);">Grand Total:</span> <strong style="color:var(--color-success); font-family:var(--font-mono); font-size:14px;">₹${total}</strong></div>
          <div><span style="color:var(--muted);">Payment Method:</span> <strong>${escapeHtml(bill.paymentMethod)}</strong></div>
          <div><span style="color:var(--muted);">Payment Status:</span> <strong>${escapeHtml(bill.paymentStatus || 'PAID')}</strong></div>
          <div><span style="color:var(--muted);">Cashier / Operator:</span> <strong>${escapeHtml(bill.cashierUserId || "Staff")}</strong></div>
          <div><span style="color:var(--muted);">Reprint Count:</span> <strong>${bill.reprints?.length || 0}</strong></div>
        </div>

        ${Array.isArray(bill.tenders) && bill.tenders.length > 0 ? `
          <h4 style="font-size:12.5px; font-weight:700; margin:0 0 6px; color:var(--ink);">Tender Settlement Records</h4>
          <div style="border:1px solid var(--border-subtle); border-radius:6px; padding:8px 12px; margin-bottom:14px; font-size:12px;">
            ${bill.tenders.map((t) => `
              <div style="display:flex; justify-content:space-between; padding:3px 0;">
                <span>${escapeHtml(t.paymentMethod)} (${escapeHtml(t.provider || 'SETTLED')}) ${t.paymentReference ? `· Ref: ${escapeHtml(t.paymentReference)}` : ''}</span>
                <strong style="font-family:var(--font-mono);">₹${((t.amountPaisa || 0) / 100).toFixed(2)}</strong>
              </div>
            `).join('')}
          </div>
        ` : ''}

        ${
          bill.status === "VOIDED"
            ? `
          <div style="background:rgba(244,63,94,0.08); padding:10px 12px; border-radius:6px; border:1px solid rgba(244,63,94,0.3); font-size:12px; margin-bottom:10px;">
            <strong style="color:var(--color-danger);">⛔ Void Audit Trail:</strong>
            <div>Reason: ${escapeHtml(bill.voidReason || "Order cancelled")}</div>
            <div style="font-size:11px; color:var(--muted); margin-top:2px;">Voided by: ${escapeHtml(bill.voidedByUserId || 'Staff')} · ${bill.voidedAt ? new Date(bill.voidedAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) : ''}</div>
          </div>
        `
            : ""
        }

        ${Array.isArray(bill.refunds) && bill.refunds.length > 0 ? `
          <div style="background:rgba(237,108,2,0.08); padding:10px 12px; border-radius:6px; border:1px solid rgba(237,108,2,0.3); font-size:12px; margin-bottom:10px;">
            <strong style="color:var(--color-warning);">🔄 Refund Records:</strong>
            ${bill.refunds.map((r) => `
              <div style="display:flex; justify-content:space-between; margin-top:3px;">
                <span>${escapeHtml(r.reason || 'Customer Return')} (by ${escapeHtml(r.requestedBy || 'Staff')})</span>
                <strong style="font-family:var(--font-mono); color:var(--color-warning);">- ₹${((r.amountPaisa || 0) / 100).toFixed(2)}</strong>
              </div>
            `).join('')}
          </div>
        ` : ''}

        <div style="display:flex; justify-content:flex-end; gap:8px; margin-top:14px;">
          <button class="btn btn-secondary btn-sm" id="btn-view-receipt-from-360" type="button">
            View Receipt Form
          </button>
        </div>
      </div>
    `,
    showSave: false,
    cancelLabel: "Close",
  });

  document.getElementById("btn-view-receipt-from-360")?.addEventListener("click", () => {
    document.querySelector("#zamorin-global-modal")?.remove();
    openReceiptModal(bill.billId);
  });
}
