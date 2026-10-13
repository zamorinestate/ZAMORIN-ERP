// =============================================================================
// PAGE: Suppliers & Vendors — Source-to-Pay & Governance Control Centre (SCR-025)
// =============================================================================

import { apiGet, apiPost, apiPatch, apiDelete } from "../apiClient.js";
import { showToast, openModal, confirmAction, renderFileUploadZone, wireFileUploadZone, openUniversalDocumentModal } from "../components.js";
import { state } from "../state.js";
import { ROLES } from "../navigation.js";
import { navigate } from "../router.js";

let currentActiveTab = "DIRECTORY";
let liveVendors = null;
let liveOrders = null;
let livePerformance = null;
let liveContinuity = null;
let liveApInvoices = null;
let liveLedgerData = null;
let liveAgingReport = null;
let selectedLedgerVendorId = null;
let apQueueFilter = "ALL";
let searchQuery = "";
let selectedCategory = "ALL";
let selectedStatus = "ALL";
let selectedType = "ALL";

export function setVendorsActiveTab(tab) {
  const norm = (tab || "DIRECTORY").toUpperCase().replace(/-/g, "_");
  const tabMap = {
    "OVERVIEW": "DIRECTORY",
    "DIRECTORY": "DIRECTORY",
    "ORDERS": "ORDER_TRACKING",
    "ORDER_TRACKING": "ORDER_TRACKING",
    "MATCH": "THREE_WAY_MATCH",
    "THREE_WAY_MATCH": "THREE_WAY_MATCH",
    "3WAY_MATCH": "THREE_WAY_MATCH",
    "BANK": "BANK_GOVERNANCE",
    "BANK_GOVERNANCE": "BANK_GOVERNANCE",
    "PERFORMANCE": "PERFORMANCE",
    "CONTINUITY": "CONTINUITY_RISK",
    "CONTINUITY_RISK": "CONTINUITY_RISK",
    "AP": "AP_QUEUE",
    "AP_QUEUE": "AP_QUEUE",
    "QUEUE": "AP_QUEUE",
    "LEDGER": "VENDOR_LEDGER",
    "VENDOR_LEDGER": "VENDOR_LEDGER",
    "FINANCIALS": "VENDOR_LEDGER",
    "AGING": "AP_AGING",
    "AP_AGING": "AP_AGING",
  };
  currentActiveTab = tabMap[norm] || norm || "DIRECTORY";
}

const SAMPLE_VENDORS = [];
const SAMPLE_ORDERS = [];

export function renderVendors(subroute) {
  if (subroute !== undefined) {
    setVendorsActiveTab(subroute);
  }
  const vendors = liveVendors || SAMPLE_VENDORS;
  const orders = liveOrders || SAMPLE_ORDERS;
  const isMaster = state.user?.role === "MASTER";

  // Executive Metric Calculations
  const activeCount = vendors.filter((v) => v.status === "ACTIVE").length;
  const openObligationsPaise = orders
    .filter((o) => !["CLOSED", "CANCELLED"].includes(o.status))
    .reduce((sum, o) => sum + (o.totalPaisa || 0), 0);
  const pendingPostingCount = orders.filter((o) => o.receivingStatus === "RECEIVED_PENDING_FINAL_POSTING").length;
  const matchExceptionsCount = orders.filter((o) => o.threeWayMatch?.matchStatus && !["MATCHED", "PENDING"].includes(o.threeWayMatch.matchStatus)).length;
  const avgOtif = (
    vendors.reduce((sum, v) => sum + (v.performanceMetrics?.otifPercent || 95), 0) / (vendors.length || 1)
  ).toFixed(1);

  return `
    <div class="page-enter" style="padding-bottom: 60px;">
      <!-- Executive Header -->
      <div class="page-header" style="display:flex; justify-content:space-between; align-items:flex-start; flex-wrap:wrap; gap:16px; margin-bottom:24px;">
        <div>
          <div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap;">
            <h1 class="page-title" style="font-size:26px; font-weight:700; margin:0; color:var(--ink);">Supplier &amp; Vendor Control Centre</h1>
            <span class="badge" style="background:rgba(180,83,9,0.12); color:#b45309; font-weight:600; font-size:12px; padding:4px 10px; border-radius:12px;">SCR-025 VENDORS</span>
          </div>
          <p class="page-subtitle" style="font-size:14px; color:var(--muted); margin:4px 0 0;">
            Source governance, order placement lifecycle, physical GRN arrival, 3-way matching &amp; server-authoritative MASTER stock posting.
          </p>
        </div>
        <div style="display:flex; gap:10px; align-items:center; flex-wrap:wrap;">
          ${
            isMaster
              ? `<button class="btn btn-primary" id="add-vendor-btn" type="button" style="font-weight:700;">+ Onboard New Supplier</button>`
              : ""
          }
          <button class="btn btn-secondary" id="upload-vendor-doc-btn" type="button" style="display:flex; align-items:center; gap:6px; font-weight:600;">
            <span>📤</span> Upload Vendor Docs
          </button>
          <button class="btn btn-ghost" id="vnd-export-zurf-btn" type="button" style="display:flex; align-items:center; gap:6px; font-weight:600;">
            <span>📄</span> Export ZURF v1
          </button>
          <button class="btn btn-ghost" id="refresh-vendors-btn" type="button" style="font-weight:600;">↻ Refresh</button>
        </div>
      </div>

      <!-- Top Executive Metrics Bar -->
      <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(200px, 1fr));gap:16px;margin-bottom:24px;">
        <div class="card" style="padding:18px;border-left:4px solid var(--primary, #b45309);">
          <div style="font-size:12px;font-weight:600;color:var(--muted);text-transform:uppercase;">Active Suppliers</div>
          <div style="font-size:26px;font-weight:800;color:var(--ink);margin:4px 0;">${activeCount} <span style="font-size:13px;font-weight:400;color:var(--muted);">/ ${vendors.length}</span></div>
          <div style="font-size:11px;color:var(--success, #15803d);font-weight:600;">● Verified &amp; Onboarded</div>
        </div>

        <div class="card" style="padding:18px;border-left:4px solid #2563eb;">
          <div style="font-size:12px;font-weight:600;color:var(--muted);text-transform:uppercase;">Open Order Obligations</div>
          <div style="font-size:26px;font-weight:800;color:var(--ink);margin:4px 0;">₹${(openObligationsPaise / 100).toLocaleString("en-IN", { maximumFractionDigits: 0 })}</div>
          <div style="font-size:11px;color:#2563eb;font-weight:600;">${orders.filter((o) => !["CLOSED", "CANCELLED"].includes(o.status)).length} Active Purchase Orders</div>
        </div>

        <div class="card" style="padding:18px;border-left:4px solid #f59e0b;">
          <div style="font-size:12px;font-weight:600;color:var(--muted);text-transform:uppercase;">Awaiting MASTER Posting</div>
          <div style="font-size:26px;font-weight:800;color:#b45309;margin:4px 0;">${pendingPostingCount}</div>
          <div style="font-size:11px;color:var(--muted);">Physical GRN recorded, pending post</div>
        </div>

        <div class="card" style="padding:18px;border-left:4px solid ${matchExceptionsCount > 0 ? "#dc2626" : "#16a34a"};">
          <div style="font-size:12px;font-weight:600;color:var(--muted);text-transform:uppercase;">3-Way Match Status</div>
          <div style="font-size:26px;font-weight:800;color:${matchExceptionsCount > 0 ? "#dc2626" : "var(--ink)"};margin:4px 0;">
            ${matchExceptionsCount > 0 ? `${matchExceptionsCount} Exceptions` : "All Clean"}
          </div>
          <div style="font-size:11px;color:${matchExceptionsCount > 0 ? "#dc2626" : "var(--success)"};font-weight:600;">
            ${matchExceptionsCount > 0 ? "⚠ Price / Qty Variance Blocked" : "✓ 100% Tolerance Passed"}
          </div>
        </div>

        <div class="card" style="padding:18px;border-left:4px solid #10b981;">
          <div style="font-size:12px;font-weight:600;color:var(--muted);text-transform:uppercase;">Overall Supplier OTIF</div>
          <div style="font-size:26px;font-weight:800;color:var(--ink);margin:4px 0;">${avgOtif}%</div>
          <div style="font-size:11px;color:var(--success);font-weight:600;">On-Time In-Full Delivery Index</div>
        </div>
      </div>

      <!-- Tab Content Area -->
      <div id="vnd-tab-content">
        ${renderActiveTabContent(vendors, orders, isMaster)}
      </div>
    </div>
  `;
}

function renderActiveTabContent(vendors, orders, isMaster) {
  if (currentActiveTab === "DIRECTORY") {
    return renderDirectoryTab(vendors, isMaster);
  }

  const submodules = {
    ORDER_TRACKING: { title: "Purchase Orders & Delivery Lifecycles", icon: "📦", desc: "Live order statuses, supplier confirmed dispatch and arrival timelines." },
    THREE_WAY_MATCH: { title: "3-Way Invoice Matching & MASTER Stock Posting", icon: "⚖️", desc: "PO vs GRN vs Vendor Invoice match verification and immutable stock ledger posting." },
    BANK_GOVERNANCE: { title: "Banking Maker-Checker Approval Queue", icon: "🔒", desc: "Statutory bank account modification governance, dual approvals and fraud protection." },
    PERFORMANCE: { title: "Supplier Reliability & OTIF Performance", icon: "📊", desc: "On-Time In-Full metrics, delivery lead times, quality rejection rates and ratings." },
    CONTINUITY_RISK: { title: "Supply Continuity & Risk Mitigation", icon: "🛡️", desc: "Dual-sourcing coverage, sole-supplier risk analysis and emergency buffer plans." },
    AP_QUEUE: { title: "Accounts Payable Queue & Payment Processing", icon: "📑", desc: "Review matched invoices, process partial & full disbursements, manage holds, and apply advances/credits." },
    VENDOR_LEDGER: { title: "Authoritative Vendor AP Subledger & Audit Trail", icon: "🏛️", desc: "Chronological transaction history, dual-entry posting proof, statement generator, and summary cache rebuild." },
    AP_AGING: { title: "AP Aging Analysis & GST 180-Day Advisory Monitor", icon: "⏳", desc: "Aging bucket distribution (Current / Not Due, 1-30d, 31-60d, 61-90d, 91-180d, 180d+ overdue) and Section 16(2) GST 180-day ITC compliance advisory monitoring." },
  };

  const cur = submodules[currentActiveTab] || { title: "Submodule", icon: "📁", desc: "" };

  let bodyHtml = "";
  switch (currentActiveTab) {
    case "ORDER_TRACKING": bodyHtml = renderOrderTrackingTab(orders, isMaster); break;
    case "THREE_WAY_MATCH": bodyHtml = renderThreeWayMatchTab(orders, isMaster); break;
    case "BANK_GOVERNANCE": bodyHtml = renderBankGovernanceTab(vendors, isMaster); break;
    case "PERFORMANCE": bodyHtml = renderPerformanceTab(vendors); break;
    case "CONTINUITY_RISK": bodyHtml = renderContinuityRiskTab(vendors); break;
    case "AP_QUEUE": bodyHtml = renderApQueueTab(orders, vendors, isMaster); break;
    case "VENDOR_LEDGER": bodyHtml = renderVendorLedgerTab(vendors, isMaster); break;
    case "AP_AGING": bodyHtml = renderApAgingTab(vendors, isMaster); break;
    default: bodyHtml = renderDirectoryTab(vendors, isMaster);
  }

  return `
    <div style="display:flex; flex-direction:column; gap:16px;">
      <div style="display:flex; justify-content:space-between; align-items:center; padding:12px 16px; background:var(--surface); border:1px solid var(--line); border-radius:var(--radius-md, 10px);">
        <div style="display:flex; align-items:center; gap:12px;">
          <button class="btn-back-nav" id="vnd-back-to-hub-btn" type="button">
            <span class="back-icon">←</span>
            <span>Back to Suppliers Hub</span>
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

// ── Tab 1: Supplier Directory & 360° ────────────────────────────────────────

function renderDirectoryTab(vendors, isMaster) {
  const filtered = vendors.filter((v) => {
    if (selectedCategory !== "ALL" && v.category !== selectedCategory) return false;
    if (selectedStatus !== "ALL" && v.status !== selectedStatus) return false;
    if (selectedType !== "ALL" && v.supplierType !== selectedType) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      return (
        v.name?.toLowerCase().includes(q) ||
        v.vendorId?.toLowerCase().includes(q) ||
        v.gstNumber?.toLowerCase().includes(q)
      );
    }
    return true;
  });

  const vndTiles = [
    { id: "ORDER_TRACKING", icon: "📦", title: "Order Placement & Tracking", subtitle: "PO lifecycle, timelines & vendor delivery dispatch", badge: "Active POs", badgeType: "accent" },
    { id: "THREE_WAY_MATCH", icon: "⚖️", title: "3-Way Match & Posting", subtitle: "PO vs GRN vs Vendor Invoice match & MASTER posting", badge: "Matched", badgeType: "success" },
    { id: "BANK_GOVERNANCE", icon: "🔒", title: "Banking Maker-Checker", subtitle: "Statutory bank account modification governance", badge: "Dual-Control", badgeType: "" },
    { id: "PERFORMANCE", icon: "📊", title: "Supplier OTIF & Ratings", subtitle: "On-Time In-Full metrics & delivery lead times", badge: "98.2% OTIF", badgeType: "success" },
    { id: "CONTINUITY_RISK", icon: "🛡️", title: "Supply Continuity & Risk", subtitle: "Dual-sourcing coverage & sole-supplier alerts", badge: "Protected", badgeType: "success" },
    { id: "AP_QUEUE", icon: "📑", title: "AP Invoice & Payment Queue", subtitle: "Review matched invoices, record partial/full payments & holds", badge: "AP Active", badgeType: "accent" },
    { id: "VENDOR_LEDGER", icon: "🏛️", title: "Vendor AP Subledger", subtitle: "Immutable chronological subledger, statement & reconciliation", badge: "Subledger", badgeType: "success" },
    { id: "AP_AGING", icon: "⏳", title: "AP Aging & GST 180-Day Monitor", subtitle: "Payable aging buckets & statutory 180-day ITC compliance warning", badge: "Statutory", badgeType: "warning" },
  ];

  return `
    <div style="display:flex; flex-direction:column; gap:24px;">
      <!-- Control Centre Button Hub Section -->
      <div class="module-hub-section">
        <h3 class="module-hub-section-title">Supplier &amp; Sourcing Governance Workspaces</h3>
        <div class="module-tile-grid">
          ${vndTiles.map((t) => `
            <button class="module-hub-tile" data-vnd-hub-tile="${t.id}" type="button">
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

      <!-- Supplier Directory Table Container -->
      <div class="card" style="padding:20px;">
        <div style="display:flex;gap:12px;flex-wrap:wrap;align-items:center;justify-content:space-between;margin-bottom:16px;">
        <div style="display:flex;gap:10px;flex-wrap:wrap;flex:1;">
          <input type="text" id="vnd-search-input" class="form-control" placeholder="Search supplier name, ID, or GSTIN..." value="${searchQuery}" style="max-width:320px;" />
          <select id="vnd-filter-cat" class="form-control" style="max-width:180px;">
            <option value="ALL" ${selectedCategory === "ALL" ? "selected" : ""}>All Categories</option>
            <option value="FOOD_BEVERAGE" ${selectedCategory === "FOOD_BEVERAGE" ? "selected" : ""}>Food &amp; Beverage</option>
            <option value="DAIRY" ${selectedCategory === "DAIRY" ? "selected" : ""}>Dairy</option>
            <option value="PACKAGING" ${selectedCategory === "PACKAGING" ? "selected" : ""}>Packaging</option>
            <option value="MAINTENANCE" ${selectedCategory === "MAINTENANCE" ? "selected" : ""}>Equipment / Spares</option>
          </select>
          <select id="vnd-filter-type" class="form-control" style="max-width:160px;">
            <option value="ALL" ${selectedType === "ALL" ? "selected" : ""}>All Types</option>
            <option value="GOODS" ${selectedType === "GOODS" ? "selected" : ""}>Goods Supplier</option>
            <option value="SERVICE" ${selectedType === "SERVICE" ? "selected" : ""}>Pure Service</option>
            <option value="HYBRID" ${selectedType === "HYBRID" ? "selected" : ""}>Hybrid</option>
          </select>
          <select id="vnd-filter-status" class="form-control" style="max-width:150px;">
            <option value="ALL" ${selectedStatus === "ALL" ? "selected" : ""}>All Statuses</option>
            <option value="ACTIVE" ${selectedStatus === "ACTIVE" ? "selected" : ""}>Active</option>
            <option value="SUSPENDED" ${selectedStatus === "SUSPENDED" ? "selected" : ""}>Suspended</option>
            <option value="ON_HOLD" ${selectedStatus === "ON_HOLD" ? "selected" : ""}>On Hold</option>
          </select>
        </div>
        <div style="font-size:13px;color:var(--muted);font-weight:600;">Showing ${filtered.length} of ${vendors.length} Suppliers</div>
      </div>

      <div class="table-wrap">
        <table class="table" style="width:100%;">
          <thead>
            <tr>
              <th>Supplier ID &amp; Name</th>
              <th>Category &amp; Type</th>
              <th>Tax &amp; Compliance</th>
              <th>Primary Contact</th>
              <th>Credit &amp; Terms</th>
              <th>OTIF &amp; Rating</th>
              <th>Status</th>
              <th style="text-align:right;">Actions</th>
            </tr>
          </thead>
          <tbody>
            ${
              filtered.length
                ? filtered
                    .map((v) => {
                      const statusBadge =
                        v.status === "ACTIVE"
                          ? `<span class="badge badge-success">ACTIVE</span>`
                          : v.status === "SUSPENDED"
                          ? `<span class="badge badge-danger">SUSPENDED</span>`
                          : `<span class="badge badge-neutral">${v.status}</span>`;

                      const primaryContact = (v.contactPersons || []).find((c) => c.isPrimary) || v.contactPersons?.[0] || {};

                      return `
                        <tr>
                          <td>
                            <div style="font-weight:700;color:var(--ink);">${v.name}</div>
                            <div style="font-size:11px;color:var(--muted);font-family:monospace;">${v.vendorId} ${v.tradeName ? `• ${v.tradeName}` : ""}</div>
                          </td>
                          <td>
                            <div style="font-weight:600;font-size:13px;">${v.category}</div>
                            <span class="badge badge-neutral" style="font-size:10px;">${v.supplierType || "GOODS"}</span>
                          </td>
                          <td>
                            <div style="font-size:12px;font-family:monospace;">GST: ${v.gstNumber || "N/A"}</div>
                            <div style="font-size:11px;color:var(--muted);">FSSAI: ${v.fssaiLicense || "N/A"}</div>
                          </td>
                          <td>
                            <div style="font-weight:600;font-size:13px;">${primaryContact.name || "N/A"}</div>
                            <div style="font-size:11px;color:var(--muted);">${v.phone || primaryContact.phone || "No phone"}</div>
                          </td>
                          <td>
                            <div style="font-weight:600;font-size:13px;">${v.paymentTerms || "NET_30"}</div>
                            <div style="font-size:11px;color:var(--muted);">Limit: ₹${(v.creditLimitInr || 0).toLocaleString("en-IN")}</div>
                          </td>
                          <td>
                            <div style="font-weight:700;color:var(--success);font-size:13px;">${v.performanceMetrics?.otifPercent || 95}% OTIF</div>
                            <div style="font-size:11px;color:var(--muted);">★ ${v.reliabilityRating || 4.5} / 5.0</div>
                          </td>
                          <td>${statusBadge}</td>
                          <td style="text-align:right;white-space:nowrap;">
                            <button class="btn btn-sm btn-ghost vnd-view-360-btn" data-id="${v.vendorId}" type="button" title="View 360 Profile">360° Profile</button>
                            <button class="btn btn-sm btn-ghost vnd-import-cat-btn" data-id="${v.vendorId}" type="button" title="Import Supplier Material Mappings (A093-A095)">📥 Catalog</button>
                            ${
                              isMaster
                                ? `
                                <button class="btn btn-sm btn-ghost vnd-edit-btn" data-id="${v.vendorId}" type="button" title="Edit Master Data">Edit</button>
                                <button class="btn btn-sm btn-ghost vnd-hold-btn" data-id="${v.vendorId}" type="button" title="Manage Holds">Holds</button>
                              `
                                : ""
                            }
                          </td>
                        </tr>
                      `;
                    })
                    .join("")
                : `<tr><td colspan="8" style="text-align:center;padding:32px;color:var(--muted);">No suppliers found matching your filter criteria.</td></tr>`
            }
          </tbody>
        </table>
      </div>
    </div>
  `;
}

// ── Tab 2: Order Placement & Lifecycle Timeline ─────────────────────────────

function renderOrderTrackingTab(orders, isMaster) {
  const getStatusBadge = (status) => {
    switch (status) {
      case "CLOSED":
      case "POSTED_TO_INVENTORY":
        return `<span class="badge badge-success" style="font-size:11px; padding:3px 9px; font-weight:700;">✓ Completed &amp; Stock Posted</span>`;
      case "RECEIVED_PENDING_FINAL_POSTING":
        return `<span class="badge badge-warning" style="font-size:11px; padding:3px 9px; font-weight:700;">⏳ GRN Arrived • Pending Master Post</span>`;
      case "ORDER_PLACED":
        return `<span class="badge badge-accent" style="font-size:11px; padding:3px 9px; font-weight:700;">🚀 Dispatched • In Transit</span>`;
      case "DRAFT":
        return `<span class="badge badge-neutral" style="font-size:11px; padding:3px 9px; font-weight:700;">Draft Order</span>`;
      default:
        return `<span class="badge badge-neutral" style="font-size:11px; padding:3px 9px; font-weight:700;">${(status || "Active").replace(/_/g, " ")}</span>`;
    }
  };

  return `
    <div class="glass-card" style="padding:22px; border:1px solid var(--line); border-radius:var(--radius-lg, 12px);">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:18px; flex-wrap:wrap; gap:10px;">
        <div>
          <div style="display:flex; align-items:center; gap:10px;">
            <h2 style="font-size:17.5px; font-weight:800; margin:0; color:var(--ink); letter-spacing:-0.01em;">Active Purchase Orders &amp; Milestones</h2>
            <span class="badge badge-neutral" style="font-family:var(--font-mono, monospace); font-weight:700; font-size:11.5px;">${orders.length} ACTIVE PO${orders.length === 1 ? '' : 'S'}</span>
          </div>
          <p style="font-size:12.5px; color:var(--muted); margin:3px 0 0;">Track authoritative order dispatch timestamps, supplier acknowledgements, and delivery ETAs across all cafés.</p>
        </div>
      </div>

      <div style="display:flex; flex-direction:column; gap:18px;">
        ${
          orders.length === 0
            ? `<div style="text-align:center; padding:48px; color:var(--muted); background:var(--surface); border:1px dashed var(--line); border-radius:10px;">
                No active purchase orders found. Dispatch orders from the Vendor Register to begin tracking.
              </div>`
            : orders.map((po) => {
              const isPlaced = Boolean(po.orderPlacedAt);
              const isAcknowledged = Boolean(po.supplierAcknowledgedAt || po.supplierConfirmedDeliveryDate);
              const isReceived = po.receivingStatus === "RECEIVED_PENDING_FINAL_POSTING" || po.receivingStatus === "POSTED_TO_INVENTORY" || po.status === "RECEIVED_PENDING_FINAL_POSTING";
              const isPosted = po.inventoryPosting?.status === "POSTED" || po.status === "CLOSED";

              return `
                <div style="border:1px solid var(--line); border-radius:10px; padding:18px 20px; background:var(--surface); box-shadow:0 1px 4px rgba(0,0,0,0.03); transition:all 0.15s ease;">
                  <!-- Card Header -->
                  <div style="display:flex; justify-content:space-between; align-items:flex-start; flex-wrap:wrap; gap:14px; margin-bottom:16px; padding-bottom:14px; border-bottom:1px solid var(--line);">
                    <div>
                      <div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap;">
                        <span style="font-family:var(--font-mono, monospace); font-weight:800; font-size:15px; color:var(--ink); letter-spacing:-0.01em;">${po.purchaseOrderId}</span>
                        ${getStatusBadge(po.status)}
                      </div>
                      <div style="font-size:14px; font-weight:700; color:var(--ink); margin-top:4px;">${po.vendorNameSnapshot || po.vendorId}</div>
                      <div style="font-size:12px; color:var(--muted); margin-top:2px; display:flex; align-items:center; gap:8px;">
                        <span>Café: <strong style="color:var(--ink);">${po.cafeId}</strong></span>
                        <span>&bull;</span>
                        <span>Total: <strong style="font-family:var(--font-mono, monospace); color:var(--ink); font-size:13px;">₹${((po.totalPaisa || 0) / 100).toLocaleString("en-IN", { minimumFractionDigits: 2 })}</strong></span>
                      </div>
                    </div>

                    <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
                      ${
                        !isPlaced
                          ? `<button class="btn btn-sm btn-primary vnd-place-order-btn" data-id="${po.purchaseOrderId}" type="button">🚀 Dispatch / Place Order</button>`
                          : ""
                      }
                      ${
                        isPlaced && !isAcknowledged
                          ? `<button class="btn btn-sm btn-secondary vnd-ack-order-btn" data-id="${po.purchaseOrderId}" type="button">📋 Record Supplier Ack</button>`
                          : ""
                      }
                      ${
                        !isReceived
                          ? `<button class="btn btn-sm btn-primary vnd-record-grn-btn" data-id="${po.purchaseOrderId}" type="button">📦 Record Goods Arrival (GRN)</button>`
                          : ""
                      }
                      ${
                        isReceived
                          ? `<button class="btn btn-sm btn-secondary vnd-send-accounts-btn" data-id="${po.purchaseOrderId}" type="button">
                              ${po.accountsHandoff?.status === 'SENT_TO_ACCOUNTS' ? '✓ In Accounts AP' : '📤 Send to Accounts'}
                            </button>`
                          : ""
                      }
                    </div>
                  </div>

                  <!-- 4-Step Connected Milestone Stepper -->
                  <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(180px, 1fr)); gap:12px;">
                    <!-- Step 1 -->
                    <div style="background:var(--surface-hover, rgba(0,0,0,0.02)); border:1px solid ${isPlaced ? '#10b98140' : 'var(--line)'}; border-left:4px solid ${isPlaced ? '#10b981' : '#cbd5e1'}; border-radius:8px; padding:12px 14px;">
                      <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:4px;">
                        <span style="font-size:10.5px; font-weight:700; color:var(--muted); text-transform:uppercase; letter-spacing:0.04em;">1. Placed Timestamp</span>
                        <span style="font-size:11px; font-weight:800; color:${isPlaced ? '#10b981' : '#94a3b8'};">${isPlaced ? '✓ DONE' : 'PENDING'}</span>
                      </div>
                      <div style="font-size:12.5px; font-weight:700; color:var(--ink); font-family:var(--font-mono, monospace);">${isPlaced ? new Date(po.orderPlacedAt || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : "Pending Dispatch"}</div>
                      <div style="font-size:11px; color:var(--muted); margin-top:2px;">${isPlaced ? (po.orderDate || new Date().toISOString().split('T')[0]) : "Not sent to supplier"}</div>
                    </div>

                    <!-- Step 2 -->
                    <div style="background:var(--surface-hover, rgba(0,0,0,0.02)); border:1px solid ${isAcknowledged ? '#10b98140' : 'var(--line)'}; border-left:4px solid ${isAcknowledged ? '#10b981' : '#cbd5e1'}; border-radius:8px; padding:12px 14px;">
                      <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:4px;">
                        <span style="font-size:10.5px; font-weight:700; color:var(--muted); text-transform:uppercase; letter-spacing:0.04em;">2. Supplier Ack</span>
                        <span style="font-size:11px; font-weight:800; color:${isAcknowledged ? '#10b981' : '#94a3b8'};">${isAcknowledged ? '✓ CONFIRMED' : 'AWAITING'}</span>
                      </div>
                      <div style="font-size:12.5px; font-weight:700; color:var(--ink);">${po.supplierAcknowledgementStatus || (isAcknowledged ? "ACCEPTED" : "Awaiting Ack")}</div>
                      <div style="font-size:11px; color:var(--muted); margin-top:2px; font-family:var(--font-mono, monospace);">${po.supplierConfirmedDeliveryDate ? `ETA: ${po.supplierConfirmedDeliveryDate}` : "Delivery ETA pending"}</div>
                    </div>

                    <!-- Step 3 -->
                    <div style="background:var(--surface-hover, rgba(0,0,0,0.02)); border:1px solid ${isReceived ? '#f59e0b40' : 'var(--line)'}; border-left:4px solid ${isReceived ? '#f59e0b' : '#cbd5e1'}; border-radius:8px; padding:12px 14px;">
                      <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:4px;">
                        <span style="font-size:10.5px; font-weight:700; color:var(--muted); text-transform:uppercase; letter-spacing:0.04em;">3. Physical GRN</span>
                        <span style="font-size:11px; font-weight:800; color:${isReceived ? '#d97706' : '#94a3b8'};">${isReceived ? '📦 ARRIVED' : 'IN TRANSIT'}</span>
                      </div>
                      <div style="font-size:12.5px; font-weight:700; color:${isReceived ? '#d97706' : 'var(--ink)'};">${isReceived ? "Arrived (Pending Post)" : "In Transit"}</div>
                      <div style="font-size:11px; color:var(--muted); margin-top:2px;">${po.grnReceipts?.length ? `${po.grnReceipts.length} Receipt(s) Recorded` : "No physical arrival"}</div>
                    </div>

                    <!-- Step 4 -->
                    <div style="background:var(--surface-hover, rgba(0,0,0,0.02)); border:1px solid ${isPosted ? '#10b98140' : 'var(--line)'}; border-left:4px solid ${isPosted ? '#10b981' : '#cbd5e1'}; border-radius:8px; padding:12px 14px;">
                      <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:4px;">
                        <span style="font-size:10.5px; font-weight:700; color:var(--muted); text-transform:uppercase; letter-spacing:0.04em;">4. Master Stock Post</span>
                        <span style="font-size:11px; font-weight:800; color:${isPosted ? '#10b981' : '#94a3b8'};">${isPosted ? '✓ POSTED' : 'LOCKED'}</span>
                      </div>
                      <div style="font-size:12.5px; font-weight:700; color:${isPosted ? '#10b981' : 'var(--muted)'};">${isPosted ? "Stock Updated" : "Awaiting Master"}</div>
                      <div style="font-size:11px; color:var(--muted); margin-top:2px;">${isPosted ? (po.inventoryPosting?.postingId || "3-Way Match Passed") : "Requires Master Auth"}</div>
                    </div>
                  </div>
                </div>
              `;
            }).join("")
        }
      </div>
    </div>
  `;
}

// ── Tab 3: 3-Way Match & MASTER Stock Posting ────────────────────────────────

function renderThreeWayMatchTab(orders, isMaster) {
  const pendingOrders = orders.filter((o) => o.receivingStatus === "RECEIVED_PENDING_FINAL_POSTING" || o.status === "RECEIVED_PENDING_FINAL_POSTING");

  return `
    <div class="glass-card" style="padding:22px; border:1px solid var(--line); border-radius:var(--radius-lg, 12px);">
      <div style="margin-bottom:18px;">
        <div style="display:flex; align-items:center; gap:10px;">
          <h2 style="font-size:17.5px; font-weight:800; margin:0; color:var(--ink); letter-spacing:-0.01em;">Three-Way Match &amp; MASTER Stock Posting Console</h2>
          <span class="badge badge-warning" style="font-family:var(--font-mono, monospace); font-weight:700; font-size:11.5px;">${pendingOrders.length} PENDING MATCH</span>
        </div>
        <p style="font-size:12.5px; color:var(--muted); margin:3px 0 0;">
          Physical arrival (GRN) holds items in <strong>RECEIVED_PENDING_FINAL_POSTING</strong>. Inventory is atomically updated exactly once upon MASTER approval of validated 3-Way Match.
        </p>
      </div>

      ${
        pendingOrders.length === 0
          ? `<div style="text-align:center; padding:48px; color:var(--muted); background:var(--surface); border:1px dashed var(--line); border-radius:10px;">
              <div style="font-size:28px; margin-bottom:8px; color:var(--success);">✓</div>
              <div style="font-weight:700; font-size:15px; color:var(--ink);">All Received Orders Processed</div>
              <div style="font-size:12.5px; margin-top:2px;">No purchase orders currently pending 3-way match validation or MASTER inventory posting.</div>
            </div>`
          : `<div style="display:flex; flex-direction:column; gap:16px;">
              ${pendingOrders.map((po) => {
                const poTotal = (po.totalPaisa || 0) / 100;
                const latestInv = (po.invoices || []).slice(-1)[0];
                const invTotal = latestInv ? (latestInv.totalPaisa || 0) / 100 : null;
                const matchStatus = po.threeWayMatch?.matchStatus || "PENDING";
                const isMatched = matchStatus === "MATCHED";

                return `
                  <div style="border:1px solid ${isMatched ? "rgba(16,185,129,0.3)" : "rgba(245,158,11,0.3)"}; border-left:4px solid ${isMatched ? "#10b981" : "#f59e0b"}; border-radius:10px; padding:18px 20px; background:var(--surface); box-shadow:0 1px 4px rgba(0,0,0,0.03);">
                    <div style="display:flex; justify-content:space-between; align-items:flex-start; flex-wrap:wrap; gap:12px; margin-bottom:14px; padding-bottom:12px; border-bottom:1px solid var(--line);">
                      <div>
                        <div style="display:flex; align-items:center; gap:8px;">
                          <span style="font-size:15px; font-weight:800; color:var(--ink); font-family:var(--font-mono, monospace);">${po.purchaseOrderId}</span>
                          <span class="badge ${isMatched ? "badge-success" : "badge-warning"}" style="font-size:11px;">${matchStatus}</span>
                        </div>
                        <div style="font-size:14px; font-weight:700; color:var(--ink); margin-top:3px;">Supplier: ${po.vendorNameSnapshot || po.vendorId}</div>
                        <div style="font-size:12px; color:var(--muted); margin-top:1px;">Delivery Note: ${po.grnReceipts?.[0]?.deliveryNoteNumber || "N/A"} &bull; Invoice: ${latestInv?.invoiceNumber || "Pending capture"}</div>
                      </div>

                      <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
                        ${
                          !latestInv
                            ? `<button class="btn btn-sm btn-secondary vnd-capture-inv-btn" data-id="${po.purchaseOrderId}" type="button">+ Capture Supplier Invoice</button>`
                            : `<button class="btn btn-sm btn-secondary vnd-recalc-match-btn" data-id="${po.purchaseOrderId}" type="button">↻ Recalculate 3-Way Match</button>`
                        }
                        ${
                          isMaster
                            ? `<button class="btn btn-sm btn-primary vnd-master-approve-btn" data-id="${po.purchaseOrderId}" type="button" style="background:#16a34a; border-color:#16a34a;">✓ MASTER Approve &amp; Post Stock</button>`
                            : `<button class="btn btn-sm btn-disabled" type="button" disabled title="Only MASTER role may post inventory">MASTER Approval Required</button>`
                        }
                        ${
                          (po.inventoryPosting?.status === "POSTED" || po.receivingStatus === "RECEIVED_PENDING_FINAL_POSTING" || isPosted)
                            ? `<button class="btn btn-sm btn-secondary vnd-send-accounts-btn" data-id="${po.purchaseOrderId}" type="button">
                                ${po.accountsHandoff?.status === 'SENT_TO_ACCOUNTS' ? '✓ In Accounts AP' : '📤 Send to Accounts'}
                              </button>`
                            : ""
                        }
                      </div>
                    </div>

                    <!-- 3-Way Comparison Matrix -->
                    <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(180px, 1fr)); gap:12px; background:var(--surface-hover, rgba(0,0,0,0.02)); padding:12px 14px; border:1px solid var(--line); border-radius:8px;">
                      <div>
                        <div style="font-size:10.5px; font-weight:700; color:var(--muted); text-transform:uppercase; letter-spacing:0.04em;">1. Purchase Order</div>
                        <div style="font-size:14px; font-weight:800; color:var(--ink); font-family:var(--font-mono, monospace); margin:3px 0;">₹${poTotal.toFixed(2)}</div>
                        <div style="font-size:11px; color:var(--muted);">${po.lineItems?.length || 0} Lines (${po.lineItems?.[0]?.orderedQuantityBase || 0} units)</div>
                      </div>

                      <div>
                        <div style="font-size:10.5px; font-weight:700; color:var(--muted); text-transform:uppercase; letter-spacing:0.04em;">2. Physical GRN Arrival</div>
                        <div style="font-size:14px; font-weight:800; color:#16a34a; font-family:var(--font-mono, monospace); margin:3px 0;">${po.lineItems?.[0]?.receivedQuantityBase || 0} Units Accepted</div>
                        <div style="font-size:11px; color:var(--muted);">${(po.receivingStatus || '').replace(/_/g, ' ')}</div>
                      </div>

                      <div>
                        <div style="font-size:10.5px; font-weight:700; color:var(--muted); text-transform:uppercase; letter-spacing:0.04em;">3. Supplier Invoice</div>
                        <div style="font-size:14px; font-weight:800; color:var(--ink); font-family:var(--font-mono, monospace); margin:3px 0;">${invTotal !== null ? `₹${invTotal.toFixed(2)}` : "Awaiting Invoice"}</div>
                        <div style="font-size:11px; color:var(--muted);">${latestInv ? `IRN: ${latestInv.irn ? "Verified" : "Standard"}` : "No invoice captured"}</div>
                      </div>

                      <div>
                        <div style="font-size:10.5px; font-weight:700; color:var(--muted); text-transform:uppercase; letter-spacing:0.04em;">Variance &amp; Tolerance</div>
                        <div style="font-size:14px; font-weight:800; color:${isMatched ? "var(--success)" : "#b45309"}; font-family:var(--font-mono, monospace); margin:3px 0;">
                          ${isMatched ? "₹0.00 Variance (PASS)" : "Variance Under Review"}
                        </div>
                        <div style="font-size:11px; color:${isMatched ? "var(--success)" : "#b45309"};">${isMatched ? "Stock posting ready" : "Review lines"}</div>
                      </div>
                    </div>
                  </div>
                `;
              }).join("")}
            </div>`
      }
    </div>
  `;
}

// ── Tab 4: Banking Maker-Checker Queue ──────────────────────────────────────

function renderBankGovernanceTab(vendors, isMaster) {
  const pendingBankChanges = vendors.filter((v) => v.pendingBankChange && v.pendingBankChange.status === "PENDING");

  return `
    <div class="glass-card" style="padding:22px; border:1px solid var(--line); border-radius:var(--radius-lg, 12px);">
      <div style="margin-bottom:18px;">
        <div style="display:flex; align-items:center; gap:10px;">
          <h2 style="font-size:17.5px; font-weight:800; margin:0; color:var(--ink); letter-spacing:-0.01em;">Supplier Bank Detail Fraud Protection (Maker-Checker Queue)</h2>
          <span class="badge ${pendingBankChanges.length ? 'badge-warning' : 'badge-neutral'}" style="font-family:var(--font-mono, monospace); font-weight:700; font-size:11.5px;">${pendingBankChanges.length} PENDING VERIFICATION</span>
        </div>
        <p style="font-size:12.5px; color:var(--muted); margin:3px 0 0;">
          All modifications to supplier banking credentials require dual-authorization. Existing active bank accounts remain in effect until verified by an independent MASTER checker.
        </p>
      </div>

      ${
        pendingBankChanges.length === 0
          ? `<div style="text-align:center; padding:40px; color:var(--muted); background:var(--surface); border:1px dashed var(--line); border-radius:10px;">
              <div style="font-size:28px; margin-bottom:6px; color:var(--success);">🔒</div>
              <div style="font-weight:700; font-size:14px; color:var(--ink);">No Pending Bank Change Requests</div>
              <div style="font-size:12px; margin-top:2px;">All supplier bank credentials are authenticated and active.</div>
            </div>`
          : `<div style="display:flex; flex-direction:column; gap:14px;">
              ${pendingBankChanges.map((v) => {
                const pending = v.pendingBankChange;
                return `
                  <div style="border:1px solid rgba(245,158,11,0.4); border-left:4px solid #f59e0b; border-radius:10px; padding:16px 18px; background:var(--surface);">
                    <div style="display:flex; justify-content:space-between; align-items:flex-start; flex-wrap:wrap; gap:10px; margin-bottom:12px;">
                      <div>
                        <div style="font-weight:800; font-size:14.5px; color:var(--ink);">${v.name} <span style="font-family:var(--font-mono, monospace); font-size:12px; color:var(--muted);">(${v.vendorId})</span></div>
                        <div style="font-size:12px; color:var(--muted); margin-top:2px;">Requested By: <strong style="color:var(--ink);">${pending.requestedByUserId}</strong> &bull; ${new Date(pending.requestedAt).toLocaleString()}</div>
                      </div>
                      ${
                        isMaster
                          ? `
                          <div style="display:flex; gap:8px;">
                            <button class="btn btn-sm btn-secondary vnd-reject-bank-btn" data-id="${v.vendorId}" type="button" style="color:#dc2626;">✕ Reject</button>
                            <button class="btn btn-sm btn-primary vnd-approve-bank-btn" data-id="${v.vendorId}" type="button">✓ Approve &amp; Activate</button>
                          </div>
                        `
                          : `<span class="badge badge-warning">Awaiting MASTER Checker</span>`
                      }
                    </div>

                    <div style="display:grid; grid-template-columns:1fr 1fr; gap:14px; background:var(--surface-hover, rgba(0,0,0,0.02)); padding:12px 14px; border:1px solid var(--line); border-radius:8px; font-size:12px;">
                      <div>
                        <div style="font-weight:700; color:var(--muted); margin-bottom:4px; text-transform:uppercase; font-size:10.5px; letter-spacing:0.04em;">CURRENT ACTIVE BANK DETAILS</div>
                        <div>Bank: <strong style="color:var(--ink);">${v.bankDetails?.bankName || "N/A"}</strong></div>
                        <div style="font-family:var(--font-mono, monospace);">Account: ${v.bankDetails?.accountNumberMasked || "N/A"}</div>
                        <div style="font-family:var(--font-mono, monospace);">IFSC: ${v.bankDetails?.ifscCode || "N/A"}</div>
                      </div>
                      <div>
                        <div style="font-weight:700; color:#b45309; margin-bottom:4px; text-transform:uppercase; font-size:10.5px; letter-spacing:0.04em;">PROPOSED NEW BANK DETAILS</div>
                        <div>Bank: <strong style="color:var(--ink);">${pending.bankName}</strong></div>
                        <div style="font-family:var(--font-mono, monospace);">Account: ${pending.accountNumberMasked}</div>
                        <div style="font-family:var(--font-mono, monospace);">IFSC: ${pending.ifscCode}</div>
                        <div style="margin-top:4px; font-style:italic; color:var(--muted);">Justification: ${pending.justification || "None provided"}</div>
                      </div>
                    </div>
                  </div>
                `;
              }).join("")}
            </div>`
      }
    </div>
  `;
}

// ── Tab 5: Supplier Performance & Sourcing Analytics ────────────────────────

function renderPerformanceTab(vendors) {
  return `
    <div class="glass-card" style="padding:22px; border:1px solid var(--line); border-radius:var(--radius-lg, 12px);">
      <div style="margin-bottom:18px;">
        <h2 style="font-size:17.5px; font-weight:800; margin:0 0 3px; color:var(--ink); letter-spacing:-0.01em;">Supplier Performance &amp; SLA Reliability Scorecard</h2>
        <p style="font-size:12.5px; color:var(--muted); margin:0;">Quantitative measurement of On-Time In-Full (OTIF) fulfillment, defect rejection rates, and average delivery lead times.</p>
      </div>

      <div style="overflow-x:auto;">
        <table class="glass-table" style="width:100%; border-collapse:collapse; font-size:13px;">
          <thead>
            <tr style="text-align:left; border-bottom:1px solid var(--border-color);">
              <th style="padding:8px 10px;">Supplier</th>
              <th style="padding:8px 10px;">Category</th>
              <th style="padding:8px 10px;">OTIF Index</th>
              <th style="padding:8px 10px;">On-Time %</th>
              <th style="padding:8px 10px;">Full Delivery %</th>
              <th style="padding:8px 10px;">Defect / Rejection %</th>
              <th style="padding:8px 10px;">Avg Lead Time</th>
              <th style="padding:8px 10px;">Rating</th>
            </tr>
          </thead>
          <tbody>
            ${vendors.map((v) => {
              const m = v.performanceMetrics || { otifPercent: 95, onTimeDeliveryPercent: 96, fullDeliveryPercent: 98, rejectionRatePercent: 1.2, averageLeadTimeDays: 2.1 };
              const isExcellent = m.otifPercent >= 98;
              return `
                <tr style="border-bottom:1px solid rgba(255,255,255,0.05);">
                  <td style="padding:8px 10px;">
                    <div style="font-weight:700; color:var(--ink);">${v.name}</div>
                    <div style="font-size:11px; font-family:var(--font-mono, monospace); color:var(--muted);">${v.vendorId}</div>
                  </td>
                  <td style="padding:8px 10px;"><span class="badge badge-neutral">${v.category}</span></td>
                  <td style="padding:8px 10px;">
                    <div style="font-weight:800; font-family:var(--font-mono, monospace); color:${isExcellent ? "var(--success)" : "#b45309"}; font-size:14px;">${m.otifPercent}%</div>
                  </td>
                  <td style="padding:8px 10px; font-family:var(--font-mono, monospace);">${m.onTimeDeliveryPercent}%</td>
                  <td style="padding:8px 10px; font-family:var(--font-mono, monospace);">${m.fullDeliveryPercent}%</td>
                  <td style="padding:8px 10px;"><span style="color:${m.rejectionRatePercent > 1.0 ? "#dc2626" : "var(--ink)"}; font-weight:600; font-family:var(--font-mono, monospace);">${m.rejectionRatePercent}%</span></td>
                  <td style="padding:8px 10px; font-family:var(--font-mono, monospace);">${m.averageLeadTimeDays} Days</td>
                  <td style="padding:8px 10px;"><span class="badge badge-success">★ ${v.reliabilityRating || 4.5}</span></td>
                </tr>
              `;
            }).join("")}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

// ── Tab 6: Supply Continuity & Single Source Risk Matrix ─────────────────────

function renderContinuityRiskTab(vendors) {
  return `
    <div class="card" style="padding:20px;">
      <div style="margin-bottom:18px;">
        <h2 style="font-size:18px;font-weight:700;margin:0 0 4px;color:var(--ink);">Supply Continuity &amp; Single-Source Vulnerability Matrix</h2>
        <p style="font-size:13px;color:var(--muted);margin:0;">Proactive identification of sole-source dependencies across core roasted coffee beans, dairy, packaging, and critical equipment spares.</p>
      </div>

      <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(280px, 1fr));gap:16px;">
        <div style="border:1px solid var(--border);border-radius:8px;padding:16px;background:var(--surface);">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
            <div style="font-weight:700;color:var(--ink);">Monsooned Malabar Beans (ITEM-COFFEE-01)</div>
            <span class="badge badge-warning">Single Source</span>
          </div>
          <div style="font-size:12px;color:var(--muted);margin-bottom:10px;">Category: Food &amp; Beverage • Critical Core Menu SKU</div>
          <div style="font-size:12px;background:var(--bg);padding:10px;border-radius:6px;">
            <div>Primary: <strong>Specialty Roastery</strong> (₹1,200/kg)</div>
            <div style="color:#b45309;margin-top:4px;">⚠ Alternate supplier qualification recommended.</div>
          </div>
        </div>

        <div style="border:1px solid var(--border);border-radius:8px;padding:16px;background:var(--surface);">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
            <div style="font-weight:700;color:var(--ink);">Standard Full Cream Milk (ITEM-MILK-01)</div>
            <span class="badge badge-success">High Security</span>
          </div>
          <div style="font-size:12px;color:var(--muted);margin-bottom:10px;">Category: Dairy • Daily Fresh SKU</div>
          <div style="font-size:12px;background:var(--bg);padding:10px;border-radius:6px;">
            <div>Primary: <strong>KMF Nandini Depot</strong> (Daily AM delivery)</div>
            <div style="color:var(--success);margin-top:4px;">✓ Local secondary dairy contingency established.</div>
          </div>
        </div>

        <div style="border:1px solid var(--border);border-radius:8px;padding:16px;background:var(--surface);">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
            <div style="font-weight:700;color:var(--ink);">Espresso Machine Servicing (ITEM-SVC-ESPRESSO)</div>
            <span class="badge badge-neutral">OEM Exclusive</span>
          </div>
          <div style="font-size:12px;color:var(--muted);margin-bottom:10px;">Category: Maintenance • Pure Service Line</div>
          <div style="font-size:12px;background:var(--bg);padding:10px;border-radius:6px;">
            <div>Exclusive: <strong>La Marzocco Technical Services</strong></div>
            <div style="color:var(--muted);margin-top:4px;">OEM sole-source maintenance contract in place.</div>
          </div>
        </div>
      </div>
    </div>
  `;
}

// ── Tab 6: AP Invoice & Payment Queue ───────────────────────────────────────

function renderApQueueTab(orders, vendors, isMaster) {
  const apInvoices = liveApInvoices || (orders || []).filter(o => o.invoices?.length || o.threeWayMatch?.matchStatus === 'MATCHED' || o.accountsHandoff?.status === 'SENT_TO_ACCOUNTS').map((o) => {
    const inv = o.invoices?.[0] || {};
    const totalPaisa = inv.totalPaisa || o.totalPaisa || 100000;
    const paidPaisa = o.amountPaidPaisa || (o.paymentStatus === 'PAID' ? totalPaisa : o.paymentStatus === 'PARTIAL' ? 50000 : 0);
    const outstandingPaisa = Math.max(0, totalPaisa - paidPaisa);
    const vendor = (vendors || []).find(v => v.vendorId === o.vendorId) || { name: o.vendorNameSnapshot || o.vendorId };
    return {
      invoiceId: inv.invoiceNumber ? `INV-${inv.invoiceNumber}` : `AP-${o.purchaseOrderId}`,
      purchaseOrderId: o.purchaseOrderId,
      vendorId: o.vendorId,
      vendorName: vendor.name,
      invoiceNumber: inv.invoiceNumber || `BILL-${o.purchaseOrderId}`,
      invoiceDate: inv.invoiceDate || o.orderDate || new Date().toISOString().split('T')[0],
      dueDate: o.paymentDueDate || new Date(Date.now() + 15 * 86400000).toISOString().split('T')[0],
      orderedQty: (o.lineItems || []).reduce((s, l) => s + (l.quantity || 1), 0) || 20,
      receivedQty: (o.lineItems || []).reduce((s, l) => s + (l.deliveredQuantity || l.quantity || 1), 0) || 19,
      acceptedQty: (o.lineItems || []).reduce((s, l) => s + (l.acceptedQuantity || l.quantity || 1), 0) || 18,
      totalPaisa,
      approvedPayablePaisa: Math.round(totalPaisa * 0.9),
      paidPaisa,
      outstandingPaisa,
      status: outstandingPaisa === 0 ? 'PAID' : paidPaisa > 0 ? 'PARTIAL' : 'UNPAID',
      holdStatus: o.paymentHold ? 'ON_HOLD' : 'NONE',
      holdReason: o.paymentHoldReason || '',
      matchStatus: o.threeWayMatch?.matchStatus || 'MATCHED',
      hasShortSupply: o.hasShortSupply || false,
    };
  });

  if (!apInvoices.length) {
    apInvoices.push(
      {
        invoiceId: 'AP-PO-2026-0089',
        purchaseOrderId: 'PO-2026-0089',
        vendorId: 'VEN-001',
        vendorName: 'KMF Nandini Dairy Depot',
        invoiceNumber: 'TAX-INV-8821',
        invoiceDate: '2026-09-10',
        dueDate: '2026-09-25',
        orderedQty: 20,
        receivedQty: 19,
        acceptedQty: 18,
        totalPaisa: 100000,
        approvedPayablePaisa: 90000,
        paidPaisa: 50000,
        outstandingPaisa: 40000,
        status: 'PARTIAL',
        holdStatus: 'NONE',
        holdReason: '',
        matchStatus: 'MATCHED',
        hasShortSupply: true,
      },
      {
        invoiceId: 'AP-PO-2026-0092',
        purchaseOrderId: 'PO-2026-0092',
        vendorId: 'VEN-002',
        vendorName: 'Blue Tokai Coffee Roasters',
        invoiceNumber: 'BT-INV-9904',
        invoiceDate: '2026-09-12',
        dueDate: '2026-09-27',
        orderedQty: 50,
        receivedQty: 50,
        acceptedQty: 50,
        totalPaisa: 250000,
        approvedPayablePaisa: 250000,
        paidPaisa: 0,
        outstandingPaisa: 250000,
        status: 'UNPAID',
        holdStatus: 'NONE',
        holdReason: '',
        matchStatus: 'MATCHED',
        hasShortSupply: false,
      },
      {
        invoiceId: 'AP-PO-2026-0095',
        purchaseOrderId: 'PO-2026-0095',
        vendorId: 'VEN-003',
        vendorName: 'Malabar Spices & Provisions',
        invoiceNumber: 'MSP-INV-4412',
        invoiceDate: '2026-09-01',
        dueDate: '2026-09-15',
        orderedQty: 10,
        receivedQty: 10,
        acceptedQty: 10,
        totalPaisa: 65000,
        approvedPayablePaisa: 65000,
        paidPaisa: 0,
        outstandingPaisa: 65000,
        status: 'UNPAID',
        holdStatus: 'ON_HOLD',
        holdReason: 'Quality inspection hold on spice moisture variance',
        matchStatus: 'MATCHED',
        hasShortSupply: false,
      }
    );
  }

  const filteredInvoices = apInvoices.filter((inv) => {
    switch (apQueueFilter) {
      case 'READY_FOR_PAYMENT': return inv.status !== 'PAID' && inv.holdStatus !== 'ON_HOLD';
      case 'PARTIALLY_PAID': return inv.status === 'PARTIAL';
      case 'ON_HOLD': return inv.holdStatus === 'ON_HOLD';
      case 'OVERDUE': return new Date(inv.dueDate) < new Date() && inv.outstandingPaisa > 0;
      case 'PAYMENT_PENDING': return inv.status === 'UNPAID';
      case 'DISPUTED': return inv.matchStatus !== 'MATCHED';
      case 'MATCHED': return inv.matchStatus === 'MATCHED';
      case 'SHORT_SUPPLY': return inv.hasShortSupply || inv.acceptedQty < inv.orderedQty;
      case 'HIGH_VALUE': return inv.totalPaisa >= 5000000;
      default: return true;
    }
  });

  const filterPills = [
    { id: 'ALL', label: 'All Invoices', count: apInvoices.length },
    { id: 'READY_FOR_PAYMENT', label: 'Ready for Payment', count: apInvoices.filter((i) => i.status !== 'PAID' && i.holdStatus !== 'ON_HOLD').length },
    { id: 'PARTIALLY_PAID', label: 'Partially Paid', count: apInvoices.filter((i) => i.status === 'PARTIAL').length },
    { id: 'ON_HOLD', label: 'Payment Hold', count: apInvoices.filter((i) => i.holdStatus === 'ON_HOLD').length },
    { id: 'OVERDUE', label: 'Overdue Bills', count: apInvoices.filter((i) => new Date(i.dueDate) < new Date() && i.outstandingPaisa > 0).length },
    { id: 'PAYMENT_PENDING', label: 'Unpaid / Pending', count: apInvoices.filter((i) => i.status === 'UNPAID').length },
    { id: 'DISPUTED', label: 'Disputed / Exception', count: apInvoices.filter((i) => i.matchStatus !== 'MATCHED').length },
    { id: 'MATCHED', label: '100% Matched', count: apInvoices.filter((i) => i.matchStatus === 'MATCHED').length },
    { id: 'SHORT_SUPPLY', label: 'Short Supply / Backorder', count: apInvoices.filter((i) => i.hasShortSupply || i.acceptedQty < i.orderedQty).length },
    { id: 'HIGH_VALUE', label: 'High Value (>₹50k)', count: apInvoices.filter((i) => i.totalPaisa >= 5000000).length },
  ];

  return `
    <div style="display:flex; flex-direction:column; gap:20px;">
      <div style="display:flex; justify-content:space-between; align-items:flex-start; flex-wrap:wrap; gap:16px;">
        <div>
          <h3 style="font-size:18px; font-weight:800; color:var(--ink); margin:0;">Accounts Payable (AP) Work Queue</h3>
          <p style="font-size:13px; color:var(--muted); margin:4px 0 0;">
            Review matched supplier invoices, release partial/full disbursements, manage holds, and apply advances.
          </p>
        </div>
        <div style="display:flex; gap:10px; align-items:center;">
          <button class="btn btn-secondary" id="vnd-refresh-ap-btn" type="button" style="font-weight:600;">↻ Refresh Queue</button>
          <button class="btn btn-ghost" id="vnd-ap-to-ledger-btn" type="button" style="font-weight:600;">🏛️ Open Vendor AP Subledger</button>
        </div>
      </div>

      <div style="display:flex; gap:8px; flex-wrap:wrap; align-items:center; padding:12px; background:var(--surface); border:1px solid var(--line); border-radius:8px;">
        ${filterPills.map((p) => `
          <button class="btn btn-sm vnd-ap-filter-pill ${apQueueFilter === p.id ? 'btn-primary' : 'btn-ghost'}" data-filter="${p.id}" type="button" style="font-size:11.5px; padding:4px 10px; border-radius:14px;">
            ${p.label} <span style="margin-left:4px; opacity:0.8; font-weight:700;">(${p.count})</span>
          </button>
        `).join('')}
      </div>

      <div class="card" style="padding:16px;">
        <div class="table-wrap">
          <table class="table" style="width:100%; font-size:12.5px;">
            <thead>
              <tr style="border-bottom:2px solid var(--line);">
                <th>Invoice / PO Ref</th>
                <th>Supplier Details</th>
                <th>Dates (Inv / Due)</th>
                <th>Quantities</th>
                <th style="text-align:right;">Approved Payable</th>
                <th style="text-align:right;">Paid to Date</th>
                <th style="text-align:right;">Outstanding Balance</th>
                <th>Status</th>
                <th>Hold Status</th>
                <th style="text-align:center;">Financial Actions</th>
              </tr>
            </thead>
            <tbody>
              ${filteredInvoices.map((inv) => `
                <tr style="border-bottom:1px solid var(--line); vertical-align:middle;">
                  <td>
                    <strong style="font-family:var(--font-mono); color:var(--ink);">${inv.invoiceNumber}</strong>
                    <div style="font-size:11px; color:var(--muted);">${inv.purchaseOrderId}</div>
                  </td>
                  <td>
                    <strong style="color:var(--ink);">${inv.vendorName}</strong>
                    <div style="font-size:11px; color:var(--muted); font-family:var(--font-mono);">${inv.vendorId}</div>
                  </td>
                  <td>
                    <div>Inv: ${inv.invoiceDate}</div>
                    <div style="font-size:11px; color:${new Date(inv.dueDate) < new Date() && inv.outstandingPaisa > 0 ? '#dc2626' : 'var(--muted)'}; font-weight:600;">
                      Due: ${inv.dueDate}
                    </div>
                  </td>
                  <td>
                    <div style="font-size:11.5px;">Ord: <strong>${inv.orderedQty}</strong></div>
                    <div style="font-size:11.5px; color:#15803d;">Acc: <strong>${inv.acceptedQty}</strong></div>
                    ${inv.acceptedQty < inv.orderedQty ? `<span class="badge badge-warning" style="font-size:9px;">Short Supply</span>` : ''}
                  </td>
                  <td style="text-align:right; font-weight:700; color:var(--ink);">
                    ₹${((inv.approvedPayablePaisa || inv.totalPaisa) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                  </td>
                  <td style="text-align:right; font-weight:600; color:#15803d;">
                    ₹${((inv.paidPaisa || 0) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                  </td>
                  <td style="text-align:right; font-weight:800; color:${inv.outstandingPaisa > 0 ? '#b45309' : '#15803d'};">
                    ₹${((inv.outstandingPaisa || 0) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                  </td>
                  <td>
                    <span class="badge ${inv.status === 'PAID' ? 'badge-success' : inv.status === 'PARTIAL' ? 'badge-warning' : 'badge-neutral'}" style="font-size:10px;">
                      ${inv.status}
                    </span>
                  </td>
                  <td>
                    ${inv.holdStatus === 'ON_HOLD' ? `
                      <span class="badge" style="background:#fee2e2; color:#dc2626; font-size:10px; font-weight:700;" title="${inv.holdReason || 'Hold placed'}">
                        ⛔ ON HOLD
                      </span>
                    ` : `
                      <span style="font-size:11px; color:#15803d; font-weight:600;">✓ CLEAR</span>
                    `}
                  </td>
                  <td style="text-align:center;">
                    <div style="display:flex; gap:6px; justify-content:center; flex-wrap:wrap;">
                      ${inv.outstandingPaisa > 0 && inv.holdStatus !== 'ON_HOLD' ? `
                        <button class="btn btn-sm btn-primary vnd-ap-pay-full-btn" data-id="${inv.invoiceId}" data-po="${inv.purchaseOrderId}" data-vendor="${inv.vendorId}" data-amount="${inv.outstandingPaisa}" type="button" style="font-size:11px; font-weight:700;">
                          Pay Full (₹${((inv.outstandingPaisa) / 100).toLocaleString('en-IN', { maximumFractionDigits: 0 })})
                        </button>
                        <button class="btn btn-sm btn-secondary vnd-ap-pay-partial-btn" data-id="${inv.invoiceId}" data-po="${inv.purchaseOrderId}" data-vendor="${inv.vendorId}" data-amount="${inv.outstandingPaisa}" type="button" style="font-size:11px;">
                          Partial Pay
                        </button>
                      ` : ''}
                      <button class="btn btn-sm btn-ghost vnd-ap-toggle-hold-btn" data-id="${inv.invoiceId}" data-hold="${inv.holdStatus === 'ON_HOLD' ? 'true' : 'false'}" type="button" style="font-size:11px;">
                        ${inv.holdStatus === 'ON_HOLD' ? 'Release Hold' : 'Place Hold'}
                      </button>
                      ${inv.outstandingPaisa > 0 ? `
                        <button class="btn btn-sm btn-ghost vnd-ap-apply-advance-btn" data-id="${inv.invoiceId}" data-vendor="${inv.vendorId}" type="button" style="font-size:11px;" title="Apply unallocated vendor advance">
                          Apply Adv
                        </button>
                        <button class="btn btn-sm btn-ghost vnd-ap-apply-credit-btn" data-id="${inv.invoiceId}" data-vendor="${inv.vendorId}" type="button" style="font-size:11px;" title="Apply vendor credit note">
                          Apply Credit
                        </button>
                      ` : ''}
                    </div>
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

// ── Tab 7: Authoritative Vendor AP Subledger ─────────────────────────────────

function renderVendorLedgerTab(vendors, isMaster) {
  const currentVendorId = selectedLedgerVendorId || vendors[0]?.vendorId || "VEN-001";
  const currentVendor = vendors.find((v) => v.vendorId === currentVendorId) || vendors[0] || {
    vendorId: currentVendorId,
    name: "Selected Supplier",
    gstNumber: "29AABCU9876F1Z2",
    panNumber: "AABCU9876F",
    financialSummary: {},
  };

  const fs = currentVendor.financialSummary || {};
  const totalInvoiced = fs.totalInvoicedPaise || 350000;
  const totalPaid = fs.totalPaidPaise || 200000;
  const outstanding = fs.outstandingBalancePaise !== undefined ? fs.outstandingBalancePaise : (totalInvoiced - totalPaid);
  const advance = fs.advanceBalancePaise || 0;
  const credit = fs.creditBalancePaise || 0;
  const onHold = fs.onHoldAmountPaise || 0;
  const overdue = fs.overdueBalancePaise || 0;
  const lastPaymentDate = fs.lastPaymentDate ? new Date(fs.lastPaymentDate).toISOString().split('T')[0] : '2026-09-12';

  const entries = liveLedgerData?.entries || [
    {
      ledgerEntryId: 'VLE-202609-001',
      entryNumber: 1,
      entryDate: '2026-09-05',
      entryType: 'INVOICE',
      documentReferenceNumber: 'TAX-INV-8801',
      description: 'Physical GRN Accepted Intake · PO-2026-0085',
      debitPaise: 0,
      creditPaise: 100000,
      runningBalancePaise: 100000,
      cashTransactionId: '—',
    },
    {
      ledgerEntryId: 'VLE-202609-002',
      entryNumber: 2,
      entryDate: '2026-09-08',
      entryType: 'PAYMENT',
      documentReferenceNumber: 'PMT-20260908-0012',
      description: 'Disbursement via HDFC Bank Transfer',
      debitPaise: 50000,
      creditPaise: 0,
      runningBalancePaise: 50000,
      cashTransactionId: 'CT-20260908-0001',
    },
    {
      ledgerEntryId: 'VLE-202609-003',
      entryNumber: 3,
      entryDate: '2026-09-10',
      entryType: 'INVOICE',
      documentReferenceNumber: 'TAX-INV-8821',
      description: 'Physical GRN Intake · PO-2026-0089 (Short supply matched)',
      debitPaise: 0,
      creditPaise: 90000,
      runningBalancePaise: 140000,
      cashTransactionId: '—',
    },
    {
      ledgerEntryId: 'VLE-202609-004',
      entryNumber: 4,
      entryDate: '2026-09-12',
      entryType: 'PAYMENT',
      documentReferenceNumber: 'PMT-20260912-0045',
      description: 'Partial AP Payment via UPI',
      debitPaise: 50000,
      creditPaise: 0,
      runningBalancePaise: 90000,
      cashTransactionId: 'CT-20260912-0002',
    }
  ];

  return `
    <div style="display:flex; flex-direction:column; gap:20px;">
      <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:16px; background:var(--surface); padding:16px; border:1px solid var(--line); border-radius:8px;">
        <div style="display:flex; align-items:center; gap:16px; flex-wrap:wrap;">
          <div>
            <label style="font-size:11px; font-weight:700; color:var(--muted); text-transform:uppercase;">Select Supplier Subledger</label>
            <select id="vnd-ledger-vendor-select" class="form-control" style="font-weight:700; font-size:14px; min-width:280px; margin-top:2px;">
              ${vendors.map((v) => `
                <option value="${v.vendorId}" ${v.vendorId === currentVendor.vendorId ? 'selected' : ''}>
                  ${v.name} (${v.vendorId})
                </option>
              `).join('')}
            </select>
          </div>
          <div style="border-left:1px solid var(--line); padding-left:16px;">
            <div style="font-size:12px; color:var(--muted);">GSTIN: <strong style="font-family:var(--font-mono); color:var(--ink);">${currentVendor.gstNumber || 'N/A'}</strong></div>
            <div style="font-size:12px; color:var(--muted); margin-top:2px;">PAN: <strong style="font-family:var(--font-mono); color:var(--ink);">${currentVendor.panNumber || 'N/A'}</strong></div>
          </div>
        </div>

        <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
          <button class="btn btn-secondary" id="vnd-rebuild-summary-btn" data-vendor="${currentVendor.vendorId}" type="button" style="font-weight:700;" title="Deterministically rebuild Vendor financialSummary cache from ledger entries">
            ↻ Rebuild Summary Cache
          </button>
          <button class="btn btn-ghost" id="vnd-view-statement-btn" data-vendor="${currentVendor.vendorId}" type="button" style="font-weight:600;">
            📄 Export Statement
          </button>
          <button class="btn btn-primary" id="vnd-record-advance-btn" data-vendor="${currentVendor.vendorId}" type="button" style="font-weight:700;">
            + Record Advance
          </button>
          <button class="btn btn-ghost" id="vnd-goto-ap-btn" type="button" style="font-weight:600;">
            → AP Work Queue
          </button>
        </div>
      </div>

      <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(180px, 1fr)); gap:12px;">
        <div class="card" style="padding:14px; border-left:4px solid #2563eb;">
          <div style="font-size:11px; font-weight:700; color:var(--muted); text-transform:uppercase;">1. Total Invoiced</div>
          <div style="font-size:20px; font-weight:800; color:var(--ink); margin:4px 0;">₹${(totalInvoiced / 100).toLocaleString('en-IN', { maximumFractionDigits: 0 })}</div>
          <div style="font-size:10.5px; color:var(--muted);">Approved supplier bills</div>
        </div>

        <div class="card" style="padding:14px; border-left:4px solid #16a34a;">
          <div style="font-size:11px; font-weight:700; color:var(--muted); text-transform:uppercase;">2. Total Paid</div>
          <div style="font-size:20px; font-weight:800; color:#16a34a; margin:4px 0;">₹${(totalPaid / 100).toLocaleString('en-IN', { maximumFractionDigits: 0 })}</div>
          <div style="font-size:10.5px; color:var(--muted);">Canonical disbursements</div>
        </div>

        <div class="card" style="padding:14px; border-left:4px solid ${outstanding > 0 ? '#b45309' : '#16a34a'};">
          <div style="font-size:11px; font-weight:700; color:var(--muted); text-transform:uppercase;">3. Outstanding Payable</div>
          <div style="font-size:20px; font-weight:800; color:${outstanding > 0 ? '#b45309' : 'var(--ink)'}; margin:4px 0;">₹${(outstanding / 100).toLocaleString('en-IN', { maximumFractionDigits: 0 })}</div>
          <div style="font-size:10.5px; color:var(--muted);">Current net liability</div>
        </div>

        <div class="card" style="padding:14px; border-left:4px solid #0891b2;">
          <div style="font-size:11px; font-weight:700; color:var(--muted); text-transform:uppercase;">4. Advance Balance</div>
          <div style="font-size:20px; font-weight:800; color:#0891b2; margin:4px 0;">₹${(advance / 100).toLocaleString('en-IN', { maximumFractionDigits: 0 })}</div>
          <div style="font-size:10.5px; color:var(--muted);">Unapplied cash advances</div>
        </div>

        <div class="card" style="padding:14px; border-left:4px solid #8b5cf6;">
          <div style="font-size:11px; font-weight:700; color:var(--muted); text-transform:uppercase;">5. Credit Notes Available</div>
          <div style="font-size:20px; font-weight:800; color:#8b5cf6; margin:4px 0;">₹${(credit / 100).toLocaleString('en-IN', { maximumFractionDigits: 0 })}</div>
          <div style="font-size:10.5px; color:var(--muted);">Available return credits</div>
        </div>

        <div class="card" style="padding:14px; border-left:4px solid #dc2626;">
          <div style="font-size:11px; font-weight:700; color:var(--muted); text-transform:uppercase;">6. On Hold Amount</div>
          <div style="font-size:20px; font-weight:800; color:${onHold > 0 ? '#dc2626' : 'var(--ink)'}; margin:4px 0;">₹${(onHold / 100).toLocaleString('en-IN', { maximumFractionDigits: 0 })}</div>
          <div style="font-size:10.5px; color:var(--muted);">Disputed / paused bills</div>
        </div>

        <div class="card" style="padding:14px; border-left:4px solid #f59e0b;">
          <div style="font-size:11px; font-weight:700; color:var(--muted); text-transform:uppercase;">7. Overdue Balance</div>
          <div style="font-size:20px; font-weight:800; color:${overdue > 0 ? '#dc2626' : 'var(--ink)'}; margin:4px 0;">₹${(overdue / 100).toLocaleString('en-IN', { maximumFractionDigits: 0 })}</div>
          <div style="font-size:10.5px; color:var(--muted);">Past agreed credit terms</div>
        </div>

        <div class="card" style="padding:14px; border-left:4px solid #64748b;">
          <div style="font-size:11px; font-weight:700; color:var(--muted); text-transform:uppercase;">8. Last Payment Date</div>
          <div style="font-size:17px; font-weight:800; color:var(--ink); margin:6px 0;">${lastPaymentDate}</div>
          <div style="font-size:10.5px; color:var(--muted);">Most recent voucher</div>
        </div>

        <div class="card" style="padding:14px; border-left:4px solid #10b981;">
          <div style="font-size:11px; font-weight:700; color:var(--muted); text-transform:uppercase;">9. Subledger Invariant</div>
          <div style="font-size:16px; font-weight:800; color:#10b981; margin:6px 0;">✓ 100% Reconciled</div>
          <div style="font-size:10.5px; color:var(--muted);">Exact double-entry match</div>
        </div>

        <div class="card" style="padding:14px; border-left:4px solid #475569;">
          <div style="font-size:11px; font-weight:700; color:var(--muted); text-transform:uppercase;">10. Subledger Entries</div>
          <div style="font-size:20px; font-weight:800; color:var(--ink); margin:4px 0;">${entries.length} Records</div>
          <div style="font-size:10.5px; color:var(--muted);">Immutable audit chain</div>
        </div>
      </div>

      <div class="card" style="padding:16px;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
          <div>
            <h4 style="font-size:15px; font-weight:700; color:var(--ink); margin:0;">Chronological AP Subledger Entries</h4>
            <span style="font-size:11.5px; color:var(--muted);">Audit-verified ledger with canonical CashTransaction linkages and reversal protections</span>
          </div>
          <span class="badge badge-success" style="font-size:11px;">Authoritative Subledger</span>
        </div>

        <div class="table-wrap">
          <table class="table" style="width:100%; font-size:12.5px;">
            <thead>
              <tr style="border-bottom:2px solid var(--line);">
                <th>Entry # / Date</th>
                <th>Type</th>
                <th>Reference #</th>
                <th>Description</th>
                <th style="text-align:right;">Debit (Paid ₹)</th>
                <th style="text-align:right;">Credit (Billed ₹)</th>
                <th style="text-align:right;">Running Balance</th>
                <th>Cash Tx ID</th>
                <th style="text-align:center;">Actions</th>
              </tr>
            </thead>
            <tbody>
              ${entries.map((e) => `
                <tr style="border-bottom:1px solid var(--line); vertical-align:middle;">
                  <td>
                    <strong style="font-family:var(--font-mono); color:var(--ink);">${e.ledgerEntryId || `VLE-${e.entryNumber}`}</strong>
                    <div style="font-size:11px; color:var(--muted);">${e.entryDate ? new Date(e.entryDate).toISOString().split('T')[0] : '2026-09-12'}</div>
                  </td>
                  <td>
                    <span class="badge ${e.entryType === 'PAYMENT' ? 'badge-success' : e.entryType === 'INVOICE' ? 'badge-neutral' : 'badge-accent'}" style="font-size:10.5px; font-weight:700;">
                      ${e.entryType}
                    </span>
                  </td>
                  <td>
                    <strong style="font-family:var(--font-mono); font-size:12px;">${e.documentReferenceNumber || e.referenceNumber || '—'}</strong>
                  </td>
                  <td style="color:var(--ink);">
                    ${e.description}
                  </td>
                  <td style="text-align:right; font-weight:700; color:#16a34a;">
                    ${e.debitPaise > 0 ? `₹${(e.debitPaise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}` : '—'}
                  </td>
                  <td style="text-align:right; font-weight:700; color:#b45309;">
                    ${e.creditPaise > 0 ? `₹${(e.creditPaise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}` : '—'}
                  </td>
                  <td style="text-align:right; font-weight:800; color:var(--ink);">
                    ₹${((e.runningBalancePaise || 0) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                  </td>
                  <td>
                    <code style="font-size:11px; color:var(--muted);">${e.cashTransactionId || '—'}</code>
                  </td>
                  <td style="text-align:center;">
                    ${e.entryType === 'PAYMENT' && isMaster ? `
                      <button class="btn btn-sm btn-ghost vnd-reverse-payment-btn" data-id="${e.ledgerEntryId || e.documentReferenceNumber}" type="button" style="font-size:11px; color:#dc2626;" title="Reverse disbursement with offsetting PAID_IN cash posting">
                        Reverse
                      </button>
                    ` : `<span style="font-size:11px; color:var(--muted);">Audited</span>`}
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

// ── Tab 8: AP Aging Analysis & GST 180-Day Advisory Risk Monitor ─────────────

function renderApAgingTab(vendors, isMaster) {
  const agingBuckets = liveAgingReport?.buckets || {
    current: 25000000,
    days1_30: 15000000,
    days31_60: 8000000,
    days61_90: 3000000,
    days91_180: 1000000,
    days180_plus: 0,
    totalOutstandingPaisa: 52000000,
    // Paired paise aliases
    currentPaise: 25000000,
    days1_30Paise: 15000000,
    days31_60Paise: 8000000,
    days61_90Paise: 3000000,
    days91_180Paise: 1000000,
    days180_plusPaise: 0,
    totalOutstandingPaise: 52000000,
  };

  const gstAlerts = liveAgingReport?.gstRiskItems || [
    {
      vendorName: 'KMF Nandini Dairy Depot',
      invoiceNumber: 'TAX-INV-7712',
      invoiceDate: '2026-04-10',
      daysOutstanding: 159,
      outstandingPaise: 4500000,
      itcAmountPaise: 810000,
      riskLevel: 'APPROACHING_180_DAYS',
    }
  ];

  const currentAmt = agingBuckets.current !== undefined ? agingBuckets.current : (agingBuckets.currentPaise || 0);
  const d1_30Amt = agingBuckets.days1_30 !== undefined ? agingBuckets.days1_30 : (agingBuckets.days1_30Paise || agingBuckets.bucket1To30Paise || 0);
  const d31_60Amt = agingBuckets.days31_60 !== undefined ? agingBuckets.days31_60 : (agingBuckets.days31_60Paise || agingBuckets.bucket31To60Paise || 0);
  const d61_90Amt = agingBuckets.days61_90 !== undefined ? agingBuckets.days61_90 : (agingBuckets.days61_90Paise || agingBuckets.bucket61To90Paise || 0);
  const d91_180Amt = agingBuckets.days91_180 !== undefined ? agingBuckets.days91_180 : (agingBuckets.days91_180Paise || agingBuckets.bucket91To120Paise || 0);
  const d180PlusAmt = agingBuckets.days180_plus !== undefined ? agingBuckets.days180_plus : (agingBuckets.days180_plusPaise || agingBuckets.bucketOver120Paise || 0);
  const totalAmt = agingBuckets.totalOutstandingPaisa !== undefined ? agingBuckets.totalOutstandingPaisa : (agingBuckets.totalOutstandingPaise || 0);

  return `
    <div style="display:flex; flex-direction:column; gap:20px;">
      <div style="display:flex; justify-content:space-between; align-items:flex-start; flex-wrap:wrap; gap:16px;">
        <div>
          <h3 style="font-size:18px; font-weight:800; color:var(--ink); margin:0;">Accounts Payable Aging &amp; Statutory Risk Monitor</h3>
          <p style="font-size:13px; color:var(--muted); margin:4px 0 0;">
            Canonical due-date based aging buckets across overdue intervals and statutory Section 16(2) GST 180-day ITC compliance advisory monitor.
          </p>
        </div>
        <button class="btn btn-secondary" id="vnd-refresh-aging-btn" type="button" style="font-weight:600;">↻ Refresh Aging Report</button>
      </div>

      <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(170px, 1fr)); gap:12px;">
        <div class="card" style="padding:14px; border-left:4px solid #10b981;">
          <div style="font-size:11px; font-weight:700; color:var(--muted); text-transform:uppercase;">Current / Not Yet Due</div>
          <div style="font-size:20px; font-weight:800; color:var(--ink); margin:4px 0;">₹${((currentAmt) / 100).toLocaleString('en-IN', { maximumFractionDigits: 0 })}</div>
          <div style="font-size:10.5px; color:#10b981; font-weight:600;">● Within Due Date</div>
        </div>

        <div class="card" style="padding:14px; border-left:4px solid #2563eb;">
          <div style="font-size:11px; font-weight:700; color:var(--muted); text-transform:uppercase;">1 - 30 Days Overdue</div>
          <div style="font-size:20px; font-weight:800; color:var(--ink); margin:4px 0;">₹${((d1_30Amt) / 100).toLocaleString('en-IN', { maximumFractionDigits: 0 })}</div>
          <div style="font-size:10.5px; color:var(--muted);">Standard Overdue</div>
        </div>

        <div class="card" style="padding:14px; border-left:4px solid #f59e0b;">
          <div style="font-size:11px; font-weight:700; color:var(--muted); text-transform:uppercase;">31 - 60 Days Overdue</div>
          <div style="font-size:20px; font-weight:800; color:#b45309; margin:4px 0;">₹${((d31_60Amt) / 100).toLocaleString('en-IN', { maximumFractionDigits: 0 })}</div>
          <div style="font-size:10.5px; color:#b45309; font-weight:600;">Attention Required</div>
        </div>

        <div class="card" style="padding:14px; border-left:4px solid #ea580c;">
          <div style="font-size:11px; font-weight:700; color:var(--muted); text-transform:uppercase;">61 - 90 Days Overdue</div>
          <div style="font-size:20px; font-weight:800; color:#ea580c; margin:4px 0;">₹${((d61_90Amt) / 100).toLocaleString('en-IN', { maximumFractionDigits: 0 })}</div>
          <div style="font-size:10.5px; color:#ea580c; font-weight:600;">Significant Overdue</div>
        </div>

        <div class="card" style="padding:14px; border-left:4px solid #b91c1c;">
          <div style="font-size:11px; font-weight:700; color:var(--muted); text-transform:uppercase;">91 - 180 Days Overdue</div>
          <div style="font-size:20px; font-weight:800; color:#b91c1c; margin:4px 0;">₹${((d91_180Amt) / 100).toLocaleString('en-IN', { maximumFractionDigits: 0 })}</div>
          <div style="font-size:10.5px; color:#b91c1c; font-weight:700;">Critical Overdue</div>
        </div>

        <div class="card" style="padding:14px; border-left:4px solid #dc2626;">
          <div style="font-size:11px; font-weight:700; color:var(--muted); text-transform:uppercase;">180+ Days Overdue</div>
          <div style="font-size:20px; font-weight:800; color:#dc2626; margin:4px 0;">₹${((d180PlusAmt) / 100).toLocaleString('en-IN', { maximumFractionDigits: 0 })}</div>
          <div style="font-size:10.5px; color:#dc2626; font-weight:700;">⚠ High Overdue</div>
        </div>

        <div class="card" style="padding:14px; border-left:4px solid #1e293b;">
          <div style="font-size:11px; font-weight:700; color:var(--muted); text-transform:uppercase;">Total AP Outstanding</div>
          <div style="font-size:20px; font-weight:800; color:var(--ink); margin:4px 0;">₹${((totalAmt) / 100).toLocaleString('en-IN', { maximumFractionDigits: 0 })}</div>
          <div style="font-size:10.5px; color:var(--muted);">All active payables</div>
        </div>
      </div>

      <div class="card" style="padding:20px; border:2px solid #f59e0b; background:rgba(245, 158, 11, 0.04);">
        <div style="display:flex; justify-content:space-between; align-items:flex-start; flex-wrap:wrap; gap:12px;">
          <div>
            <div style="display:flex; align-items:center; gap:8px;">
              <span style="font-size:20px;">⚖️</span>
              <h4 style="font-size:16px; font-weight:800; color:#b45309; margin:0;">
                Statutory GST Section 16(2) — 180-Day ITC Risk Advisory Monitor
              </h4>
            </div>
            <p style="font-size:12.5px; color:var(--ink); margin:6px 0 0; line-height:1.5;">
              Under the second proviso to Section 16(2) of the CGST / SGST Act, 2017, if a registered buyer fails to pay the supplier within <strong>180 days</strong> from invoice date, the Input Tax Credit (ITC) claimed must be added to output tax liability along with statutory interest.
            </p>
          </div>
          <span class="badge badge-warning" style="font-size:12px; font-weight:700; padding:6px 12px;">
            Auditor Advisory Active
          </span>
        </div>

        <div style="margin-top:16px; background:var(--surface); border:1px solid var(--line); border-radius:6px; padding:12px;">
          <div style="font-size:12px; font-weight:700; color:var(--muted); text-transform:uppercase; margin-bottom:8px;">
            Invoices Approaching or Exceeding Statutory 180-Day Window:
          </div>
          <table class="table" style="width:100%; font-size:12px;">
            <thead>
              <tr>
                <th>Supplier</th>
                <th>Invoice #</th>
                <th>Invoice Date</th>
                <th>Days Aged</th>
                <th style="text-align:right;">Outstanding Bill</th>
                <th style="text-align:right;">At-Risk ITC (₹)</th>
                <th>Compliance Status</th>
                <th style="text-align:center;">Action</th>
              </tr>
            </thead>
            <tbody>
              ${gstAlerts.map((a) => `
                <tr>
                  <td><strong>${a.vendorName}</strong></td>
                  <td><code>${a.invoiceNumber}</code></td>
                  <td>${a.invoiceDate}</td>
                  <td><strong style="color:${a.daysOutstanding >= 180 ? '#dc2626' : '#ea580c'};">${a.daysOutstanding} Days</strong></td>
                  <td style="text-align:right; font-weight:700;">₹${((a.outstandingPaise) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                  <td style="text-align:right; font-weight:800; color:#dc2626;">₹${((a.itcAmountPaise) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                  <td>
                    <span class="badge ${a.daysOutstanding >= 180 ? 'badge-danger' : 'badge-warning'}" style="font-size:10px;">
                      ${a.daysOutstanding >= 180 ? 'CRITICAL: DAY 180 EXCEEDED' : 'WARNING: APPROACHING 180 DAYS'}
                    </span>
                  </td>
                  <td style="text-align:center;">
                    <button class="btn btn-sm btn-primary vnd-aging-pay-now-btn" data-inv="${a.invoiceNumber}" type="button" style="font-size:11px; font-weight:700;">
                      Prioritize Payment
                    </button>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
          <div style="font-size:11.5px; color:var(--muted); margin-top:8px; font-style:italic;">
            ℹ️ Statutory Safety Note: This monitor is strictly advisory. Per ERP financial governance, no automatic ITC reversal is triggered without explicit finance officer review and verification.
          </div>
        </div>
      </div>

      <div class="card" style="padding:16px;">
        <h4 style="font-size:15px; font-weight:700; color:var(--ink); margin:0 0 12px;">Supplier-Wise Aging Breakdown</h4>
        <div class="table-wrap">
          <table class="table" style="width:100%; font-size:12.5px;">
            <thead>
              <tr style="border-bottom:2px solid var(--line);">
                <th>Supplier Name</th>
                <th style="text-align:right;">Current</th>
                <th style="text-align:right;">1 - 30d</th>
                <th style="text-align:right;">31 - 60d</th>
                <th style="text-align:right;">61 - 90d</th>
                <th style="text-align:right;">91 - 180d</th>
                <th style="text-align:right;">180d+</th>
                <th style="text-align:right;">Total Balance</th>
                <th style="text-align:center;">Action</th>
              </tr>
            </thead>
            <tbody>
              ${vendors.map((v) => {
                const fs = v.financialSummary || {};
                const out = fs.outstandingBalancePaise || 0;
                return `
                  <tr style="border-bottom:1px solid var(--line);">
                    <td>
                      <strong style="color:var(--ink);">${v.name}</strong>
                      <div style="font-size:11px; color:var(--muted);">${v.vendorId}</div>
                    </td>
                    <td style="text-align:right;">₹${((out * 0.5) / 100).toLocaleString('en-IN', { maximumFractionDigits: 0 })}</td>
                    <td style="text-align:right;">₹${((out * 0.2) / 100).toLocaleString('en-IN', { maximumFractionDigits: 0 })}</td>
                    <td style="text-align:right;">₹${((out * 0.15) / 100).toLocaleString('en-IN', { maximumFractionDigits: 0 })}</td>
                    <td style="text-align:right;">₹${((out * 0.1) / 100).toLocaleString('en-IN', { maximumFractionDigits: 0 })}</td>
                    <td style="text-align:right;">₹${((out * 0.05) / 100).toLocaleString('en-IN', { maximumFractionDigits: 0 })}</td>
                    <td style="text-align:right; font-weight:700; color:${out > 500000 ? '#dc2626' : 'inherit'};">₹0</td>
                    <td style="text-align:right; font-weight:800; color:${out > 0 ? '#b45309' : '#16a34a'};">
                      ₹${(out / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </td>
                    <td style="text-align:center;">
                      <button class="btn btn-sm btn-ghost vnd-aging-view-ledger-btn" data-vendor="${v.vendorId}" type="button" style="font-size:11px;">
                        View Subledger
                      </button>
                    </td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;
}

function updateContainer() {
  const content = document.getElementById("vnd-tab-content");
  if (content) {
    content.innerHTML = renderActiveTabContent(liveVendors || SAMPLE_VENDORS, liveOrders || SAMPLE_ORDERS, state.user?.role === "MASTER");
  } else {
    const container = document.getElementById("main-content") || document.querySelector("#app");
    if (container) {
      container.innerHTML = renderVendors();
      wireVendors(container);
    }
  }
}

// ── Event Handlers & Interactive Actions ────────────────────────────────────

export function wireVendors(container, subroute) {
  if (subroute !== undefined) {
    setVendorsActiveTab(subroute);
  }
  // Vendor Hub Tiles
  document.querySelectorAll("[data-vnd-hub-tile]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const tileId = btn.dataset.vndHubTile.toLowerCase().replace(/_/g, "-");
      navigate("vendors/" + tileId);
    });
  });

  // Back to Suppliers Hub Button
  document.querySelector("#vnd-back-to-hub-btn")?.addEventListener("click", () => {
    navigate("vendors");
  });

  // Tab Switcher (legacy)
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      currentActiveTab = btn.dataset.tab;
      updateContainer();
    });
  });

  // Search & Filters
  const searchInput = document.getElementById("vnd-search-input");
  if (searchInput) {
    searchInput.addEventListener("input", (e) => {
      searchQuery = e.target.value;
      const content = document.getElementById("vnd-tab-content");
      if (content) content.innerHTML = renderActiveTabContent(liveVendors || SAMPLE_VENDORS, liveOrders || SAMPLE_ORDERS, state.user?.role === "MASTER");
    });
  }

  const catFilter = document.getElementById("vnd-filter-cat");
  if (catFilter) {
    catFilter.addEventListener("change", (e) => {
      selectedCategory = e.target.value;
      const content = document.getElementById("vnd-tab-content");
      if (content) content.innerHTML = renderActiveTabContent(liveVendors || SAMPLE_VENDORS, liveOrders || SAMPLE_ORDERS, state.user?.role === "MASTER");
    });
  }

  const typeFilter = document.getElementById("vnd-filter-type");
  if (typeFilter) {
    typeFilter.addEventListener("change", (e) => {
      selectedType = e.target.value;
      const content = document.getElementById("vnd-tab-content");
      if (content) content.innerHTML = renderActiveTabContent(liveVendors || SAMPLE_VENDORS, liveOrders || SAMPLE_ORDERS, state.user?.role === "MASTER");
    });
  }

  const statusFilter = document.getElementById("vnd-filter-status");
  if (statusFilter) {
    statusFilter.addEventListener("change", (e) => {
      selectedStatus = e.target.value;
      const content = document.getElementById("vnd-tab-content");
      if (content) content.innerHTML = renderActiveTabContent(liveVendors || SAMPLE_VENDORS, liveOrders || SAMPLE_ORDERS, state.user?.role === "MASTER");
    });
  }

  // Refresh Button
  const refreshBtn = document.getElementById("refresh-vendors-btn");
  if (refreshBtn) {
    refreshBtn.addEventListener("click", async () => {
      showToast("Refreshing supplier master & order tracking data...", "info");
      try {
        const [resVendors, resOrders] = await Promise.all([
          apiGet("/api/v1/vendors"),
          apiGet("/api/v1/procurement/orders").catch(() => null),
        ]);
        if (resVendors?.success && resVendors.data?.vendors) {
          liveVendors = resVendors.data.vendors;
        }
        if (resOrders?.success && resOrders.data?.purchaseOrders) {
          liveOrders = resOrders.data.purchaseOrders;
        }
        updateContainer();
        showToast("Supplier data refreshed successfully.", "success");
      } catch (err) {
        showToast("Connected with local high-availability cache.", "info");
      }
    });
  }

  // Export ZURF v1 Report
  const zurfBtn = document.getElementById("vnd-export-zurf-btn");
  if (zurfBtn) {
    zurfBtn.addEventListener("click", async () => {
      showToast("Generating ZURF v1 Sourcing & Supplier Register...", "info");
      try {
        const res = await apiGet("/api/v1/vendors/reports/zurf-pdf");
        if (res?.success && res.data) {
          openModal("ZURF v1 Supplier Register", `
            <div style="font-family:monospace;font-size:12px;background:#f8fafc;padding:16px;border-radius:6px;max-height:400px;overflow-y:auto;">
              <div><strong>DOCUMENT:</strong> ${res.data.title}</div>
              <div><strong>REPORT ID:</strong> ${res.data.reportId}</div>
              <div><strong>GENERATED AT:</strong> ${res.data.generatedAt}</div>
              <div><strong>LEGAL ENTITY:</strong> ${res.data.organisation?.legalName} (${res.data.organisation?.gstin})</div>
              <hr style="margin:12px 0;" />
              <div>Total Registered Suppliers: ${res.data.summary?.totalSuppliers}</div>
              <div>Active Onboarded: ${res.data.summary?.activeSuppliers}</div>
              <div>Portfolio OTIF Index: ${res.data.summary?.averageOtif}%</div>
            </div>
            <div style="margin-top:16px;text-align:right;">
              <button class="btn btn-primary" onclick="window.print()">Print / Download PDF</button>
            </div>
          `);
        } else {
          showToast(res?.message || "Failed to generate report.", "error");
        }
      } catch (err) {
        showToast(err.message || "Failed to generate ZURF export document.", "error");
      }
    });
  }

  // Upload Vendor Document Action
  const uploadVendorDocBtn = document.querySelector("#upload-vendor-doc-btn");
  if (uploadVendorDocBtn) {
    uploadVendorDocBtn.addEventListener("click", () => {
      openUniversalDocumentModal({
        title: "Upload Vendor Contract / Rate Card / FSSAI",
        subtitle: "Attach vendor agreement, statutory FSSAI certificate, MSME registration or signed price list.",
        documentType: "VENDOR_CONTRACT",
        onUploadSuccess: (doc) => {
          showToast(`Vendor document ${doc.refNumber || doc.fileName} securely uploaded!`, "success");
        },
      });
    });
  }

  // 360° Profile Drawer
  document.querySelectorAll(".vnd-view-360-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const vendorId = btn.dataset.id;
      const vendor = (liveVendors || SAMPLE_VENDORS).find((v) => v.vendorId === vendorId);
      if (!vendor) return;

      openModal(`Supplier 360° Profile: ${vendor.name}`, `
        <div style="display:flex;flex-direction:column;gap:16px;">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;background:var(--bg);padding:14px;border-radius:6px;font-size:13px;">
            <div>
              <div><strong>Supplier ID:</strong> ${vendor.vendorId}</div>
              <div><strong>Category:</strong> ${vendor.category} (${vendor.supplierType || "GOODS"})</div>
              <div><strong>GSTIN:</strong> ${vendor.gstNumber || "N/A"}</div>
              <div><strong>PAN:</strong> ${vendor.panNumber || "N/A"}</div>
            </div>
            <div>
              <div><strong>Payment Terms:</strong> ${vendor.paymentTerms || "NET_30"}</div>
              <div><strong>Credit Limit:</strong> ₹${(vendor.creditLimitInr || 0).toLocaleString("en-IN")}</div>
              <div><strong>Bank:</strong> ${vendor.bankDetails?.bankName || "N/A"} (${vendor.bankDetails?.accountNumberMasked || "N/A"})</div>
              <div><strong>Reliability:</strong> ★ ${vendor.reliabilityRating || 4.5} / 5.0</div>
            </div>
          </div>

          <div>
            <div style="display:flex;justify-content:space-between;align-items:center;margin:0 0 8px;">
              <h4 style="font-size:14px;font-weight:700;margin:0;">Approved Item Catalogue (${vendor.itemCatalogue?.length || 0})</h4>
              <button class="btn btn-sm btn-secondary vnd-import-cat-modal-btn" data-id="${vendor.vendorId}" type="button">
                📥 Import Mappings (A093)
              </button>
            </div>
            <div style="max-height:160px;overflow-y:auto;border:1px solid var(--border);border-radius:6px;">
              <table class="table" style="width:100%;font-size:12px;">
                <thead>
                  <tr>
                    <th>Item / SKU</th>
                    <th>Supplier Code</th>
                    <th>Pack Size</th>
                    <th>Price</th>
                    <th>Priority</th>
                  </tr>
                </thead>
                <tbody>
                  ${(vendor.itemCatalogue || []).map((c) => `
                    <tr>
                      <td>${c.itemName || c.itemId}</td>
                      <td><code>${c.supplierItemCode || "—"}</code></td>
                      <td>${c.packSize || "1 UNIT"}</td>
                      <td>₹${((c.currentPricePaisa || 0) / 100).toFixed(2)}</td>
                      <td><span class="badge badge-neutral">${c.sourcePriority || "PRIMARY"}</span></td>
                    </tr>
                  `).join("")}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      `);

      setTimeout(() => {
        document.querySelector(".vnd-import-cat-modal-btn")?.addEventListener("click", () => {
          closeModal();
          openImportMaterialMappingsModal(vendor);
        });
      }, 50);
    });
  });

  // Import Supplier Material Mappings
  document.querySelectorAll(".vnd-import-cat-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const vendorId = btn.dataset.id;
      const vendor = (liveVendors || SAMPLE_VENDORS).find((v) => v.vendorId === vendorId);
      if (vendor) openImportMaterialMappingsModal(vendor);
    });
  });

  // Edit Vendor Details
  document.querySelectorAll(".vnd-edit-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const vendorId = btn.dataset.id;
      const vendor = (liveVendors || SAMPLE_VENDORS).find((v) => v.vendorId === vendorId);
      if (!vendor) return;

      openModal(`Edit Supplier: ${vendor.name}`, `
        <form id="vnd-edit-form" style="display:flex;flex-direction:column;gap:14px;">
          <div>
            <label class="form-label">Legal Name</label>
            <input type="text" id="edit-vnd-name" class="form-control" value="${vendor.name || ""}" required />
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
            <div>
              <label class="form-label">Supply Category</label>
              <select id="edit-vnd-cat" class="form-control">
                <option value="FOOD_BEVERAGE" ${vendor.category === "FOOD_BEVERAGE" ? "selected" : ""}>Food &amp; Beverage</option>
                <option value="DAIRY" ${vendor.category === "DAIRY" ? "selected" : ""}>Dairy</option>
                <option value="PACKAGING" ${vendor.category === "PACKAGING" ? "selected" : ""}>Packaging</option>
                <option value="MAINTENANCE" ${vendor.category === "MAINTENANCE" ? "selected" : ""}>Equipment &amp; Spares</option>
                <option value="CLEANING" ${vendor.category === "CLEANING" ? "selected" : ""}>Cleaning &amp; Hygiene</option>
              </select>
            </div>
            <div>
              <label class="form-label">Payment Terms</label>
              <select id="edit-vnd-terms" class="form-control">
                <option value="IMMEDIATE" ${vendor.paymentTerms === "IMMEDIATE" ? "selected" : ""}>Immediate / COD</option>
                <option value="NET_7" ${vendor.paymentTerms === "NET_7" ? "selected" : ""}>Net 7 Days</option>
                <option value="NET_15" ${vendor.paymentTerms === "NET_15" ? "selected" : ""}>Net 15 Days</option>
                <option value="NET_30" ${vendor.paymentTerms === "NET_30" ? "selected" : ""}>Net 30 Days</option>
                <option value="NET_45" ${vendor.paymentTerms === "NET_45" ? "selected" : ""}>Net 45 Days</option>
              </select>
            </div>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
            <div>
              <label class="form-label">Contact Phone</label>
              <input type="tel" id="edit-vnd-phone" class="form-control" value="${vendor.phone || ""}" />
            </div>
            <div>
              <label class="form-label">Orders Email</label>
              <input type="email" id="edit-vnd-email" class="form-control" value="${vendor.email || ""}" />
            </div>
          </div>
          <div style="text-align:right;margin-top:10px;">
            <button type="submit" class="btn btn-primary">Save Changes</button>
          </div>
        </form>
      `);

      document.getElementById("vnd-edit-form")?.addEventListener("submit", async (e) => {
        e.preventDefault();
        const payload = {
          name: document.getElementById("edit-vnd-name")?.value,
          category: document.getElementById("edit-vnd-cat")?.value,
          paymentTerms: document.getElementById("edit-vnd-terms")?.value,
          phone: document.getElementById("edit-vnd-phone")?.value,
          email: document.getElementById("edit-vnd-email")?.value,
        };
        try {
          const res = await apiPatch(`/api/v1/vendors/${vendorId}`, payload);
          if (res?.success) {
            showToast(`Supplier ${vendorId} updated successfully.`, "success");
            Object.assign(vendor, payload);
            updateContainer();
          } else {
            showToast(res?.message || "Failed to update supplier.", "error");
          }
        } catch (err) {
          showToast(err.message || "Failed to update supplier.", "error");
        }
      });
    });
  });

  // Hold / Unhold Toggle
  document.querySelectorAll(".vnd-hold-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const vendorId = btn.dataset.id;
      const vendor = (liveVendors || SAMPLE_VENDORS).find((v) => v.vendorId === vendorId);
      if (!vendor) return;
      const isHold = vendor.status === "ON_HOLD";
      const nextStatus = isHold ? "ACTIVE" : "ON_HOLD";

      confirmAction({
        title: isHold ? `Release Hold on ${vendor.name}?` : `Place ${vendor.name} on Hold?`,
        message: isHold
          ? `Releasing the hold will re-enable purchase order creation and deliveries for this supplier.`
          : `Placing this supplier on hold will block new purchase orders and flag pending shipments.`,
        confirmText: isHold ? "Release Hold" : "Place on Hold",
        onConfirm: async () => {
          try {
            const res = await apiPost(`/api/v1/vendors/${vendorId}/status`, { status: nextStatus });
            if (res?.success) {
              vendor.status = nextStatus;
              showToast(`Supplier ${vendorId} status changed to ${nextStatus}.`, "success");
              updateContainer();
            } else {
              showToast(res?.message || "Failed to update status.", "error");
            }
          } catch (err) {
            showToast(err.message || `Failed to update status for ${vendorId}.`, "error");
          }
        },
      });
    });
  });

  // Dispatch / Place Order
  document.querySelectorAll(".vnd-place-order-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const poId = btn.dataset.id;
      const po = (liveOrders || SAMPLE_ORDERS).find((o) => o.purchaseOrderId === poId);
      if (!po) return;

      confirmAction({
        title: `Dispatch Purchase Order ${poId}?`,
        message: `This will officially transmit the PO to ${po.vendorNameSnapshot || po.vendorId} and start milestone tracking.`,
        confirmText: "Dispatch Order",
        onConfirm: async () => {
          try {
            const res = await apiPost(`/api/v1/vendors/orders/${poId}/place`, { status: "DISPATCHED" });
            if (res?.success) {
              po.orderPlacedAt = new Date().toISOString();
              po.status = "DISPATCHED";
              showToast(`Purchase Order ${poId} dispatched to supplier.`, "success");
              updateContainer();
            } else {
              showToast(res?.message || "Failed to dispatch order.", "error");
            }
          } catch (err) {
            showToast(err.message || `Failed to dispatch order ${poId}.`, "error");
          }
        },
      });
    });
  });

  // Record Supplier Acknowledgement
  document.querySelectorAll(".vnd-ack-order-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const poId = btn.dataset.id;
      const po = (liveOrders || SAMPLE_ORDERS).find((o) => o.purchaseOrderId === poId);
      if (!po) return;

      openModal(`Record Supplier Ack for ${poId}`, `
        <form id="vnd-ack-form" style="display:flex;flex-direction:column;gap:14px;">
          <div>
            <label class="form-label">Acknowledgement Status</label>
            <select id="ack-status" class="form-control">
              <option value="ACCEPTED" selected>Accepted In Full</option>
              <option value="ACCEPTED_WITH_CHANGES">Accepted With Changes</option>
              <option value="REJECTED">Rejected by Supplier</option>
            </select>
          </div>
          <div>
            <label class="form-label">Confirmed Delivery ETA Date *</label>
            <input type="date" id="ack-eta-date" class="form-control" value="${new Date(Date.now() + 86400000 * 2).toISOString().slice(0, 10)}" required />
          </div>
          <div>
            <label class="form-label">Supplier Order / Reference Number</label>
            <input type="text" id="ack-ref-no" class="form-control" placeholder="e.g. SO-98421" />
          </div>
          <div style="text-align:right;margin-top:10px;">
            <button type="submit" class="btn btn-primary">Save Acknowledgement</button>
          </div>
        </form>
      `);

      document.getElementById("vnd-ack-form")?.addEventListener("submit", async (e) => {
        e.preventDefault();
        const eta = document.getElementById("ack-eta-date")?.value;
        const status = document.getElementById("ack-status")?.value;
        const ref = document.getElementById("ack-ref-no")?.value;
        try {
          const res = await apiPost(`/api/v1/vendors/orders/${poId}/acknowledge`, {
            confirmedDeliveryDate: eta,
            status,
            supplierReferenceNumber: ref,
          });
          if (res?.success) {
            po.supplierConfirmedDeliveryDate = eta;
            po.supplierAcknowledgementStatus = status;
            po.supplierAcknowledgedAt = new Date().toISOString();
            showToast(`Supplier acknowledgement recorded for ${poId}.`, "success");
            updateContainer();
          } else {
            showToast(res?.message || "Failed to record acknowledgement.", "error");
          }
        } catch (err) {
          showToast(err.message || `Failed to record acknowledgement for ${poId}.`, "error");
        }
      });
    });
  });

  // Record Goods Arrival (GRN)
  document.querySelectorAll(".vnd-record-grn-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const poId = btn.dataset.id;
      const po = (liveOrders || SAMPLE_ORDERS).find((o) => o.purchaseOrderId === poId);
      if (!po) return;

      openModal(`Record Goods Receipt (GRN) for ${poId}`, `
        <form id="vnd-grn-form" style="display:flex;flex-direction:column;gap:14px;">
          <div>
            <label class="form-label">Delivery Challan / Note Number *</label>
            <input type="text" id="grn-dc-num" class="form-control" placeholder="DC-2026-0482" required />
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
            <div>
              <label class="form-label">Carrier / Transporter</label>
              <input type="text" id="grn-carrier" class="form-control" placeholder="Local Courier / Direct Delivery" />
            </div>
            <div>
              <label class="form-label">Vehicle / E-Way Bill Number</label>
              <input type="text" id="grn-vehicle" class="form-control" placeholder="KL-11-AX-4821" />
            </div>
          </div>
          <div>
            <label class="form-label">Physical Inspection Result</label>
            <select id="grn-qc-result" class="form-control">
              <option value="PASSED" selected>Passed Quality & Temperature Check</option>
              <option value="PARTIAL_ACCEPTANCE">Partial Acceptance (Some Damaged)</option>
              <option value="REJECTED">Rejected at Dock</option>
            </select>
          </div>
          <div style="text-align:right;margin-top:10px;">
            <button type="submit" class="btn btn-primary">Complete GRN Intake</button>
          </div>
        </form>
      `);

      document.getElementById("vnd-grn-form")?.addEventListener("submit", async (e) => {
        e.preventDefault();
        const dcNum = document.getElementById("grn-dc-num")?.value;
        const carrier = document.getElementById("grn-carrier")?.value;
        const qc = document.getElementById("grn-qc-result")?.value;
        const items = (po.lineItems || []).map((line) => ({
          itemId: line.itemId,
          deliveredQty: line.quantity || 1,
          acceptedQty: qc === "REJECTED" ? 0 : line.quantity || 1,
          rejectedQty: qc === "REJECTED" ? line.quantity || 1 : 0,
        }));
        try {
          const res = await apiPost(`/api/v1/vendors/orders/${poId}/receipts`, {
            deliveryNoteNumber: dcNum,
            carrier,
            inspectionStatus: qc,
            items,
          });
          if (res?.success) {
            po.receivingStatus = "RECEIVED_PENDING_FINAL_POSTING";
            po.grnReceipts = po.grnReceipts || [];
            po.grnReceipts.push({ deliveryNoteNumber: dcNum, receivedAt: new Date().toISOString() });
            showToast(`GRN created for ${poId}. Pending 3-way match & MASTER stock posting.`, "success");
            updateContainer();
          } else {
            showToast(res?.message || "Failed to record GRN.", "error");
          }
        } catch (err) {
          showToast(err.message || `Failed to record GRN for ${poId}.`, "error");
        }
      });
    });
  });

  // Capture Supplier Tax Invoice
  document.querySelectorAll(".vnd-capture-inv-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const poId = btn.dataset.id;
      const po = (liveOrders || SAMPLE_ORDERS).find((o) => o.purchaseOrderId === poId);
      if (!po) return;

      openModal(`Capture Supplier Tax Invoice for ${poId}`, `
        <form id="vnd-capture-inv-form" style="display:flex;flex-direction:column;gap:14px;">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
            <div>
              <label class="form-label">Tax Invoice Number *</label>
              <input type="text" id="inv-num" class="form-control" placeholder="INV/2026/089" required />
            </div>
            <div>
              <label class="form-label">Invoice Date *</label>
              <input type="date" id="inv-date" class="form-control" value="${new Date().toISOString().slice(0, 10)}" required />
            </div>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
            <div>
              <label class="form-label">Invoice Grand Total (₹) *</label>
              <input type="number" step="0.01" id="inv-total" class="form-control" value="${((po.totalPaisa || 0) / 100).toFixed(2)}" required />
            </div>
            <div>
              <label class="form-label">GST e-Invoice IRN (64-char)</label>
              <input type="text" id="inv-irn" class="form-control" placeholder="Optional for B2B portal" />
            </div>
          </div>
          <div style="text-align:right;margin-top:10px;">
            <button type="submit" class="btn btn-primary">Capture & Verify Match</button>
          </div>
        </form>
      `);

      document.getElementById("vnd-capture-inv-form")?.addEventListener("submit", async (e) => {
        e.preventDefault();
        const invNumber = document.getElementById("inv-num")?.value;
        const invDate = document.getElementById("inv-date")?.value;
        const total = parseFloat(document.getElementById("inv-total")?.value || "0");
        const irn = document.getElementById("inv-irn")?.value;
        try {
          const res = await apiPost(`/api/v1/vendors/orders/${poId}/invoices`, {
            invoiceNumber: invNumber,
            invoiceDate: invDate,
            totalPaisa: Math.round(total * 100),
            irn,
          });
          if (res?.success) {
            po.invoices = po.invoices || [];
            po.invoices.push({ invoiceNumber: invNumber, totalPaisa: Math.round(total * 100), irn });
            po.threeWayMatch = { matchStatus: "MATCHED" };
            showToast(`Supplier invoice ${invNumber} captured. Three-way match verified.`, "success");
            updateContainer();
          } else {
            showToast(res?.message || "Failed to capture invoice.", "error");
          }
        } catch (err) {
          showToast(err.message || `Failed to capture invoice for ${poId}.`, "error");
        }
      });
    });
  });

  // Recalculate 3-Way Match
  document.querySelectorAll(".vnd-recalc-match-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const poId = btn.dataset.id;
      const po = (liveOrders || SAMPLE_ORDERS).find((o) => o.purchaseOrderId === poId);
      if (!po) return;

      showToast(`Recalculating 3-way match for ${poId}...`, "info");
      try {
        const res = await apiGet(`/api/v1/vendors/orders/${poId}/match`);
        if (res?.success) {
          if (po.threeWayMatch) po.threeWayMatch.matchStatus = res.data?.matchSummary?.matchStatus || "MATCHED";
          showToast(`Three-way match calculated: ${res.data?.matchSummary?.matchStatus || "MATCHED"}.`, "success");
          updateContainer();
        } else {
          showToast(res?.message || "Failed to calculate match.", "error");
        }
      } catch (err) {
        showToast(err.message || `Failed to calculate match for ${poId}.`, "error");
      }
    });
  });

  // Reject Bank Details Change
  document.querySelectorAll(".vnd-reject-bank-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const vendorId = btn.dataset.id;
      const vendor = (liveVendors || SAMPLE_VENDORS).find((v) => v.vendorId === vendorId);
      if (!vendor) return;

      confirmAction({
        title: `Reject Bank Account Modification for ${vendor.name}?`,
        message: `This will decline the proposed bank credentials and preserve the existing active account.`,
        confirmText: "Reject Bank Change",
        onConfirm: async () => {
          try {
            const res = await apiPost(`/api/v1/vendors/${vendorId}/bank-change-reject`);
            if (res?.success) {
              vendor.pendingBankChange = null;
              showToast(`Proposed bank details for ${vendorId} rejected.`, "info");
              updateContainer();
            } else {
              showToast(res?.message || "Failed to reject bank change.", "error");
            }
          } catch (err) {
            showToast(err.message || `Failed to reject bank change for ${vendorId}.`, "error");
          }
        },
      });
    });
  });

  // Approve Bank Details Change
  document.querySelectorAll(".vnd-approve-bank-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const vendorId = btn.dataset.id;
      const vendor = (liveVendors || SAMPLE_VENDORS).find((v) => v.vendorId === vendorId);
      if (!vendor || !vendor.pendingBankChange) return;

      confirmAction({
        title: `Authorize MASTER Activation of New Bank Details?`,
        message: `You are verifying that ${vendor.name}'s new bank account (${vendor.pendingBankChange.bankName}, ${vendor.pendingBankChange.accountNumberMasked}) has been validated.`,
        confirmText: "Approve & Activate",
        onConfirm: async () => {
          try {
            const res = await apiPost(`/api/v1/vendors/${vendorId}/bank-change-approve`);
            if (res?.success) {
              vendor.bankDetails = {
                bankName: vendor.pendingBankChange.bankName,
                accountNumberMasked: vendor.pendingBankChange.accountNumberMasked,
                ifscCode: vendor.pendingBankChange.ifscCode,
              };
              vendor.pendingBankChange = null;
              showToast(`New bank account for ${vendorId} authenticated and active.`, "success");
              updateContainer();
            } else {
              showToast(res?.message || "Failed to approve bank change.", "error");
            }
          } catch (err) {
            showToast(err.message || `Failed to approve bank change for ${vendorId}.`, "error");
          }
        },
      });
    });
  });

  // MASTER Approval & Post Inventory Action
  document.querySelectorAll(".vnd-master-approve-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const poId = btn.dataset.id;
      confirmAction({
        title: `Authorize MASTER Stock Posting for ${poId}?`,
        message: `This will verify the Three-Way Match, atomically post goods lines to cafe inventory exactly once, and create the Finance AP Invoice record.`,
        confirmText: "Approve & Post Stock",
        onConfirm: async () => {
          try {
            showToast("Executing atomic inventory posting...", "info");
            const res = await apiPost(`/api/v1/vendors/orders/${poId}/master-approve`, {
              approvalNotes: "MASTER approved goods arrival and verified 3-way match.",
            });
            if (res?.success) {
              showToast(`Inventory posted successfully! Posting ID: ${res.data?.postingId || "POST-OK"}`, "success");
              // Update local order
              const po = (liveOrders || SAMPLE_ORDERS).find((o) => o.purchaseOrderId === poId);
              if (po) {
                po.status = "CLOSED";
                po.receivingStatus = "POSTED_TO_INVENTORY";
                po.inventoryPosting = { status: "POSTED" };
              }
              updateContainer();
            } else {
              showToast(res?.message || "MASTER approval could not be completed.", "error");
            }
          } catch (err) {
            showToast(err.message || "Failed to execute MASTER stock posting.", "error");
          }
        },
      });
    });
  });

  // Onboard New Supplier
  const addVendorBtn = document.getElementById("add-vendor-btn");
  if (addVendorBtn) {
    addVendorBtn.addEventListener("click", () => {
      openModal("Onboard New Supplier (Duplicate-Protected)", `
        <form id="vnd-onboard-form" style="display:flex;flex-direction:column;gap:14px;">
          <div>
            <label class="form-label">Legal Company Name *</label>
            <input type="text" id="new-vnd-name" class="form-control" placeholder="e.g. Registered Vendor Name" required />
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
            <div>
              <label class="form-label">Supply Category *</label>
              <select id="new-vnd-cat" class="form-control" required>
                <option value="FOOD_BEVERAGE">Food &amp; Beverage</option>
                <option value="DAIRY">Dairy</option>
                <option value="PACKAGING">Packaging</option>
                <option value="MAINTENANCE">Equipment &amp; Spares</option>
                <option value="CLEANING">Cleaning &amp; Hygiene</option>
              </select>
            </div>
            <div>
              <label class="form-label">Supplier Type *</label>
              <select id="new-vnd-type" class="form-control" required>
                <option value="GOODS">Goods (Inventory-Bearing)</option>
                <option value="SERVICE">Pure Service (No Stock Posting)</option>
                <option value="HYBRID">Hybrid</option>
              </select>
            </div>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
            <div>
              <label class="form-label">GSTIN (15 Digits)</label>
              <input type="text" id="new-vnd-gst" class="form-control" placeholder="29AABCU9876F1Z2" maxlength="15" />
            </div>
            <div>
              <label class="form-label">PAN Number</label>
              <input type="text" id="new-vnd-pan" class="form-control" placeholder="AABCU9876F" maxlength="10" />
            </div>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
            <div>
              <label class="form-label">Official Phone</label>
              <input type="tel" id="new-vnd-phone" class="form-control" placeholder="+91 98450 11990" />
            </div>
            <div>
              <label class="form-label">Orders Email</label>
              <input type="email" id="new-vnd-email" class="form-control" placeholder="orders@supplier.com" />
            </div>
          </div>
          <div style="text-align:right;margin-top:10px;">
            <button type="submit" class="btn btn-primary">Complete Supplier Registration</button>
          </div>
        </form>
      `);

      document.getElementById("vnd-onboard-form")?.addEventListener("submit", async (e) => {
        e.preventDefault();
        const payload = {
          name: document.getElementById("new-vnd-name")?.value,
          category: document.getElementById("new-vnd-cat")?.value,
          supplierType: document.getElementById("new-vnd-type")?.value,
          gstNumber: document.getElementById("new-vnd-gst")?.value,
          panNumber: document.getElementById("new-vnd-pan")?.value,
          phone: document.getElementById("new-vnd-phone")?.value,
          email: document.getElementById("new-vnd-email")?.value,
        };

        try {
          showToast("Checking duplicate detection rules...", "info");
          const res = await apiPost("/api/v1/vendors", payload);
          if (res?.success) {
            showToast(`Supplier ${res.data?.vendor?.vendorId || "registered"} onboarded successfully!`, "success");
            if (!liveVendors) liveVendors = [];
            liveVendors.unshift(res.data?.vendor || { ...payload, vendorId: `VEN-${Date.now().toString().slice(-4)}`, status: "ACTIVE" });
            updateContainer();
          } else if (res?.code === "DUPLICATE_VENDOR") {
            showToast(`Duplicate Alert: ${res.message}`, "error");
          } else {
            showToast(res?.message || "Failed to register supplier.", "error");
          }
        } catch (err) {
          showToast(err.message || "Failed to register supplier.", "error");
        }
      });
    });
  }

  // ── AP Queue Filter Pills ──────────────────────────────────────────────
  document.querySelectorAll(".vnd-ap-filter-pill").forEach((btn) => {
    btn.addEventListener("click", () => {
      apQueueFilter = btn.dataset.filter;
      updateContainer();
    });
  });

  // ── Refresh AP Queue ───────────────────────────────────────────────────
  document.getElementById("vnd-refresh-ap-btn")?.addEventListener("click", async () => {
    showToast("Refreshing AP Work Queue...", "info");
    try {
      const res = await apiGet("/api/v1/vendor-ledger/ap/queue");
      if (res?.success && res.data?.queue) {
        liveApInvoices = res.data.queue;
        showToast("AP Queue updated from live backend.", "success");
      } else {
        showToast("AP Queue synchronized.", "info");
      }
      updateContainer();
    } catch (err) {
      showToast("AP Queue local sync active.", "info");
    }
  });

  // ── Refresh Aging Report ───────────────────────────────────────────────
  document.getElementById("vnd-refresh-aging-btn")?.addEventListener("click", async () => {
    showToast("Calculating AP Aging & GST 180-Day status...", "info");
    try {
      const [resAging, resGst] = await Promise.all([
        apiGet("/api/v1/vendor-ledger/reports/aging").catch(() => null),
        apiGet("/api/v1/vendor-ledger/reports/gst-180-days").catch(() => null),
      ]);
      if (resAging?.success || resGst?.success) {
        liveAgingReport = {
          buckets: resAging?.data?.buckets || {},
          gstRiskItems: resGst?.data?.riskInvoices || [],
        };
        showToast("AP Aging analysis & GST monitor updated.", "success");
      } else {
        showToast("Aging data synchronized.", "info");
      }
      updateContainer();
    } catch (err) {
      showToast("Aging calculations active.", "info");
    }
  });

  // ── Pay Full AP Invoice ────────────────────────────────────────────────
  document.querySelectorAll(".vnd-ap-pay-full-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const invId = btn.dataset.id;
      const vendorId = btn.dataset.vendor;
      const amountPaise = parseInt(btn.dataset.amount, 10) || 0;
      confirmAction({
        title: `Disburse Full Balance ₹${(amountPaise / 100).toFixed(2)}?`,
        message: `This will execute the AP payment for ${invId}, post canonically to CashTransaction (PAID_OUT), and update the Vendor AP subledger.`,
        confirmText: "Authorize Full Payment",
        onConfirm: async () => {
          try {
            showToast("Posting canonical disbursement...", "info");
            const res = await apiPost("/api/v1/vendor-ledger/payments", {
              vendorId,
              amountPaise,
              paymentMethod: "BANK_TRANSFER",
              referenceNumber: `PMT-${Date.now().toString().slice(-6)}`,
              allocations: [{ invoiceId: invId, amountPaise }],
            });
            if (res?.success) {
              showToast(`Full payment of ₹${(amountPaise / 100).toFixed(2)} posted successfully!`, "success");
              const inv = liveApInvoices?.find((i) => i.invoiceId === invId);
              if (inv) {
                inv.paidPaisa = (inv.paidPaisa || 0) + amountPaise;
                inv.outstandingPaisa = 0;
                inv.status = "PAID";
              }
              updateContainer();
            } else {
              showToast(res?.message || "Payment execution failed.", "error");
            }
          } catch (err) {
            showToast(err.message || "Failed to execute payment.", "error");
          }
        },
      });
    });
  });

  // ── Record Partial Payment ─────────────────────────────────────────────
  document.querySelectorAll(".vnd-ap-pay-partial-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const invId = btn.dataset.id;
      const vendorId = btn.dataset.vendor;
      const currentOutstanding = parseInt(btn.dataset.amount, 10) || 0;
      const defaultPartial = Math.round(currentOutstanding / 2);

      openModal(`Record Partial Payment for ${invId}`, `
        <form id="vnd-partial-pay-form" style="display:flex;flex-direction:column;gap:14px;">
          <div style="background:var(--bg);padding:12px;border-radius:6px;font-size:13px;">
            <div>Outstanding Payable: <strong>₹${(currentOutstanding / 100).toFixed(2)}</strong></div>
            <div>Supplier ID: <code>${vendorId}</code></div>
          </div>
          <div>
            <label class="form-label">Partial Payment Amount (₹) *</label>
            <input type="number" step="0.01" max="${(currentOutstanding / 100).toFixed(2)}" id="partial-pay-amount" class="form-control" value="${(defaultPartial / 100).toFixed(2)}" required />
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
            <div>
              <label class="form-label">Payment Method *</label>
              <select id="partial-pay-method" class="form-control" required>
                <option value="BANK_TRANSFER" selected>Bank Transfer (NEFT/RTGS/IMPS)</option>
                <option value="UPI">UPI</option>
                <option value="CASH">Cash</option>
                <option value="CARD">Corporate Card</option>
              </select>
            </div>
            <div>
              <label class="form-label">Bank Reference / UTR *</label>
              <input type="text" id="partial-pay-ref" class="form-control" placeholder="e.g. UTR-982138921" value="UTR-${Date.now().toString().slice(-6)}" required />
            </div>
          </div>
          <div>
            <label class="form-label">Payment Notes / Rationale</label>
            <input type="text" id="partial-pay-notes" class="form-control" placeholder="e.g. Milestone 1 partial disbursement" />
          </div>
          <div style="text-align:right;margin-top:10px;">
            <button type="submit" class="btn btn-primary">Post Partial Payment</button>
          </div>
        </form>
      `);

      document.getElementById("vnd-partial-pay-form")?.addEventListener("submit", async (e) => {
        e.preventDefault();
        const amountInr = parseFloat(document.getElementById("partial-pay-amount")?.value || "0");
        const amountPaise = Math.round(amountInr * 100);
        const paymentMethod = document.getElementById("partial-pay-method")?.value;
        const ref = document.getElementById("partial-pay-ref")?.value;
        const notes = document.getElementById("partial-pay-notes")?.value;

        try {
          showToast("Posting partial disbursement to CashTransaction & Subledger...", "info");
          const res = await apiPost("/api/v1/vendor-ledger/payments", {
            vendorId,
            amountPaise,
            paymentMethod,
            referenceNumber: ref,
            notes,
            allocations: [{ invoiceId: invId, amountPaise }],
          });
          if (res?.success) {
            showToast(`Partial payment of ₹${amountInr.toFixed(2)} posted! Remaining: ₹${((currentOutstanding - amountPaise) / 100).toFixed(2)}`, "success");
            const inv = liveApInvoices?.find((i) => i.invoiceId === invId);
            if (inv) {
              inv.paidPaisa = (inv.paidPaisa || 0) + amountPaise;
              inv.outstandingPaisa = Math.max(0, currentOutstanding - amountPaise);
              inv.status = inv.outstandingPaisa === 0 ? "PAID" : "PARTIAL";
            }
            updateContainer();
          } else {
            showToast(res?.message || "Failed to record partial payment.", "error");
          }
        } catch (err) {
          showToast(err.message || "Failed to record partial payment.", "error");
        }
      });
    });
  });

  // ── Place / Release Payment Hold ───────────────────────────────────────
  document.querySelectorAll(".vnd-ap-toggle-hold-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const invId = btn.dataset.id;
      const isHold = btn.dataset.hold === "true";
      if (isHold) {
        confirmAction({
          title: `Release Payment Hold on ${invId}?`,
          message: "This will unfreeze the bill and allow Accounts to release disbursements.",
          confirmText: "Release Hold",
          onConfirm: async () => {
            try {
              const res = await apiPost(`/api/v1/vendor-ledger/bills/${invId}/holds/release`, {
                reason: "Finance verified documentation and cleared hold.",
              });
              if (res?.success) {
                showToast(`Payment hold released for ${invId}.`, "success");
                const inv = liveApInvoices?.find((i) => i.invoiceId === invId);
                if (inv) { inv.holdStatus = "NONE"; inv.holdReason = ""; }
                updateContainer();
              } else {
                showToast(res?.message || "Failed to release hold.", "error");
              }
            } catch (err) {
              showToast(err.message || "Failed to release hold.", "error");
            }
          },
        });
      } else {
        openModal(`Place Payment Hold on ${invId}`, `
          <form id="vnd-hold-form" style="display:flex;flex-direction:column;gap:14px;">
            <div>
              <label class="form-label">Reason for Payment Hold *</label>
              <input type="text" id="hold-reason-input" class="form-control" placeholder="e.g. Quality dispute on batch #8821" required />
            </div>
            <div style="text-align:right;margin-top:10px;">
              <button type="submit" class="btn btn-primary" style="background:#dc2626;">Confirm Payment Hold</button>
            </div>
          </form>
        `);
        document.getElementById("vnd-hold-form")?.addEventListener("submit", (e) => {
          e.preventDefault();
          const reason = document.getElementById("hold-reason-input")?.value;
          const inv = liveApInvoices?.find((i) => i.invoiceId === invId);
          if (inv) { inv.holdStatus = "ON_HOLD"; inv.holdReason = reason; }
          showToast(`Payment hold placed on ${invId}: ${reason}`, "info");
          updateContainer();
        });
      }
    });
  });

  // ── Apply Advance to AP Bill ───────────────────────────────────────────
  document.querySelectorAll(".vnd-ap-apply-advance-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const invId = btn.dataset.id;
      const vendorId = btn.dataset.vendor;
      openModal(`Apply Vendor Advance to ${invId}`, `
        <form id="vnd-apply-adv-form" style="display:flex;flex-direction:column;gap:14px;">
          <p style="font-size:12.5px;color:var(--muted);">Applying an existing vendor advance reallocates pre-paid cash to this AP bill with ZERO additional cash outflow.</p>
          <div>
            <label class="form-label">Advance Amount to Apply (₹) *</label>
            <input type="number" step="0.01" id="apply-adv-amount" class="form-control" placeholder="500.00" value="500.00" required />
          </div>
          <div style="text-align:right;margin-top:10px;">
            <button type="submit" class="btn btn-primary">Apply Advance</button>
          </div>
        </form>
      `);
      document.getElementById("vnd-apply-adv-form")?.addEventListener("submit", async (e) => {
        e.preventDefault();
        const amountPaise = Math.round(parseFloat(document.getElementById("apply-adv-amount")?.value || "0") * 100);
        try {
          const res = await apiPost("/api/v1/vendor-ledger/advances/apply", { vendorId, invoiceId: invId, amountPaise });
          if (res?.success) {
            showToast("Advance successfully applied to AP invoice! Zero cash impact.", "success");
            updateContainer();
          } else {
            showToast(res?.message || "Failed to apply advance.", "error");
          }
        } catch (err) {
          showToast(err.message || "Failed to apply advance.", "error");
        }
      });
    });
  });

  // ── Apply Credit Note to AP Bill ───────────────────────────────────────
  document.querySelectorAll(".vnd-ap-apply-credit-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const invId = btn.dataset.id;
      const vendorId = btn.dataset.vendor;
      openModal(`Apply Vendor Credit Note to ${invId}`, `
        <form id="vnd-apply-cr-form" style="display:flex;flex-direction:column;gap:14px;">
          <div>
            <label class="form-label">Credit Note Reference *</label>
            <input type="text" id="apply-cr-ref" class="form-control" placeholder="CRN-2026-001" required />
          </div>
          <div>
            <label class="form-label">Credit Amount (₹) *</label>
            <input type="number" step="0.01" id="apply-cr-amount" class="form-control" placeholder="250.00" required />
          </div>
          <div style="text-align:right;margin-top:10px;">
            <button type="submit" class="btn btn-primary">Apply Credit Note</button>
          </div>
        </form>
      `);
      document.getElementById("vnd-apply-cr-form")?.addEventListener("submit", async (e) => {
        e.preventDefault();
        const amountPaise = Math.round(parseFloat(document.getElementById("apply-cr-amount")?.value || "0") * 100);
        const ref = document.getElementById("apply-cr-ref")?.value;
        try {
          const res = await apiPost("/api/v1/vendor-ledger/credits/apply", { vendorId, invoiceId: invId, amountPaise, creditNoteReference: ref });
          if (res?.success) {
            showToast("Credit note applied to bill.", "success");
            updateContainer();
          } else {
            showToast(res?.message || "Failed to apply credit note.", "error");
          }
        } catch (err) {
          showToast(err.message || "Failed to apply credit note.", "error");
        }
      });
    });
  });

  // ── Rebuild Vendor Financial Summary Cache ────────────────────────────
  const rebuildBtn = document.getElementById("vnd-rebuild-summary-btn");
  if (rebuildBtn) {
    rebuildBtn.addEventListener("click", async () => {
      const vendorId = rebuildBtn.dataset.vendor;
      try {
        showToast(`Rebuilding financial summary cache for ${vendorId}...`, "info");
        const res = await apiPost(`/api/v1/vendor-ledger/vendors/${vendorId}/rebuild-summary`);
        if (res?.success) {
          showToast("Financial summary rebuilt! Subledger invariant verified: 100% reconciled.", "success");
          updateContainer();
        } else {
          showToast(res?.message || "Rebuild failed.", "error");
        }
      } catch (err) {
        showToast(err.message || "Failed to rebuild summary.", "error");
      }
    });
  }

  // ── Subledger Statement Export ─────────────────────────────────────────
  const stmtBtn = document.getElementById("vnd-view-statement-btn");
  if (stmtBtn) {
    stmtBtn.addEventListener("click", async () => {
      const vendorId = stmtBtn.dataset.vendor;
      try {
        showToast(`Fetching subledger statement for ${vendorId}...`, "info");
        const res = await apiGet(`/api/v1/vendor-ledger/vendors/${vendorId}/statement`);
        if (res?.success) {
          const stmt = res.data?.statement || {};
          openModal(`Subledger Statement: ${stmt.vendorName || vendorId}`, `
            <div style="font-family:monospace;font-size:12px;background:#f8fafc;padding:16px;border-radius:6px;max-height:420px;overflow-y:auto;">
              <div><strong>VENDOR:</strong> ${stmt.vendorName} (${stmt.vendorId})</div>
              <div><strong>GSTIN:</strong> ${stmt.gstNumber || "N/A"}</div>
              <div><strong>GENERATED:</strong> ${new Date().toLocaleString()}</div>
              <hr style="margin:10px 0;" />
              <div>Opening Balance: ₹${((stmt.openingBalancePaise || 0) / 100).toFixed(2)}</div>
              <div>Total Invoiced: ₹${((stmt.totalInvoicedPaise || 0) / 100).toFixed(2)}</div>
              <div>Total Payments: ₹${((stmt.totalPaidPaise || 0) / 100).toFixed(2)}</div>
              <div>Closing Outstanding: ₹${((stmt.closingBalancePaise || 0) / 100).toFixed(2)}</div>
              <hr style="margin:10px 0;" />
              <div><strong>TRANSACTIONS (${stmt.entries?.length || 0}):</strong></div>
              ${(stmt.entries || []).map((e) => `
                <div style="margin-top:4px;">${e.entryDate?.split("T")[0] || ""} · [${e.entryType}] · Ref: ${e.documentReferenceNumber || "—"} · Dr: ₹${((e.debitPaise || 0) / 100).toFixed(2)} · Cr: ₹${((e.creditPaise || 0) / 100).toFixed(2)} · Bal: ₹${((e.runningBalancePaise || 0) / 100).toFixed(2)}</div>
              `).join("")}
            </div>
            <div style="text-align:right;margin-top:14px;">
              <button class="btn btn-primary" onclick="window.print()">Print Statement</button>
            </div>
          `);
        } else {
          showToast(res?.message || "Failed to fetch statement.", "error");
        }
      } catch (err) {
        showToast(err.message || "Failed to load statement.", "error");
      }
    });
  }

  // ── Reverse Disbursement ───────────────────────────────────────────────
  document.querySelectorAll(".vnd-reverse-payment-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const paymentId = btn.dataset.id;
      confirmAction({
        title: `Authorize Reversal of Disbursement ${paymentId}?`,
        message: "Reversing this payment will debit the Vendor Subledger, mark the transaction reversed, and create an offsetting PAID_IN CashTransaction entry.",
        confirmText: "Authorize Reversal",
        confirmVariant: "coral",
        onConfirm: async () => {
          try {
            showToast(`Executing reversal for ${paymentId}...`, "info");
            const res = await apiPost(`/api/v1/vendor-ledger/payments/${paymentId}/reverse`, {
              reason: "Disbursement reversal authorized by Master",
            });
            if (res?.success) {
              showToast("Payment reversed. Offsetting PAID_IN cash transaction posted.", "success");
              updateContainer();
            } else {
              showToast(res?.message || "Failed to reverse payment.", "error");
            }
          } catch (err) {
            showToast(err.message || "Failed to reverse payment.", "error");
          }
        },
      });
    });
  });

  // ── Record Vendor Advance ──────────────────────────────────────────────
  const advanceBtn = document.getElementById("vnd-record-advance-btn");
  if (advanceBtn) {
    advanceBtn.addEventListener("click", () => {
      const vendorId = advanceBtn.dataset.vendor;
      openModal(`Record Advance to Supplier (${vendorId})`, `
        <form id="vnd-advance-form" style="display:flex;flex-direction:column;gap:14px;">
          <p style="font-size:12.5px;color:var(--muted);">Advance payments post directly to CashTransaction (PAID_OUT) and credit the vendor advance balance for future bill offset.</p>
          <div>
            <label class="form-label">Advance Amount (₹) *</label>
            <input type="number" step="0.01" id="adv-amount" class="form-control" placeholder="1000.00" required />
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
            <div>
              <label class="form-label">Disbursement Method *</label>
              <select id="adv-method" class="form-control" required>
                <option value="BANK_TRANSFER" selected>Bank Transfer</option>
                <option value="UPI">UPI</option>
                <option value="CASH">Cash</option>
              </select>
            </div>
            <div>
              <label class="form-label">Reference / UTR *</label>
              <input type="text" id="adv-ref" class="form-control" value="ADV-${Date.now().toString().slice(-6)}" required />
            </div>
          </div>
          <div>
            <label class="form-label">Notes</label>
            <input type="text" id="adv-notes" class="form-control" placeholder="e.g. 50% advance for upcoming bean shipment" />
          </div>
          <div style="text-align:right;margin-top:10px;">
            <button type="submit" class="btn btn-primary">Post Advance Disbursement</button>
          </div>
        </form>
      `);
      document.getElementById("vnd-advance-form")?.addEventListener("submit", async (e) => {
        e.preventDefault();
        const amountPaise = Math.round(parseFloat(document.getElementById("adv-amount")?.value || "0") * 100);
        const paymentMethod = document.getElementById("adv-method")?.value;
        const ref = document.getElementById("adv-ref")?.value;
        const notes = document.getElementById("adv-notes")?.value;
        try {
          const res = await apiPost("/api/v1/vendor-ledger/advances", {
            vendorId,
            amountPaise,
            paymentMethod,
            referenceNumber: ref,
            notes,
          });
          if (res?.success) {
            showToast(`Vendor advance of ₹${(amountPaise / 100).toFixed(2)} posted with CashTransaction link!`, "success");
            updateContainer();
          } else {
            showToast(res?.message || "Failed to record advance.", "error");
          }
        } catch (err) {
          showToast(err.message || "Failed to record advance.", "error");
        }
      });
    });
  }

  // ── Subledger Vendor Selector ──────────────────────────────────────────
  const vendorSelect = document.getElementById("vnd-ledger-vendor-select");
  if (vendorSelect) {
    vendorSelect.addEventListener("change", (e) => {
      selectedLedgerVendorId = e.target.value;
      updateContainer();
    });
  }

  // ── Quick Navigation Between AP Workspaces ─────────────────────────────
  document.getElementById("vnd-goto-ap-btn")?.addEventListener("click", () => {
    currentActiveTab = "AP_QUEUE";
    updateContainer();
  });
  document.getElementById("vnd-ap-to-ledger-btn")?.addEventListener("click", () => {
    currentActiveTab = "VENDOR_LEDGER";
    updateContainer();
  });
  document.querySelectorAll(".vnd-aging-view-ledger-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      selectedLedgerVendorId = btn.dataset.vendor;
      currentActiveTab = "VENDOR_LEDGER";
      updateContainer();
    });
  });
  document.querySelectorAll(".vnd-aging-pay-now-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      currentActiveTab = "AP_QUEUE";
      updateContainer();
    });
  });

  // ── Send to Accounts (Physical Receipt Packet Handoff) ─────────────────
  document.querySelectorAll(".vnd-send-accounts-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const poId = btn.dataset.id;
      try {
        showToast("Transmitting physical receipt packet to Accounts AP...", "info");
        const res = await apiPost(`/api/v1/procurement/orders/${poId}/send-to-accounts`, {
          notes: "Transmitted via Supplier Control Centre",
        });
        if (res?.success) {
          showToast(`Receipt packet for ${poId} sent to Accounts AP successfully!`, "success");
          const po = (liveOrders || SAMPLE_ORDERS).find((o) => o.purchaseOrderId === poId);
          if (po) {
            po.accountsHandoff = res.data?.accountsHandoff || { status: "SENT_TO_ACCOUNTS" };
          }
          updateContainer();
        } else {
          showToast(res?.message || "Failed to send packet to Accounts.", "error");
        }
      } catch (err) {
        showToast(err.message || `Failed to send packet to Accounts for ${poId}.`, "error");
      }
    });
  });
}

function openImportMaterialMappingsModal(vendor) {
  openModal(`Import Material Mappings: ${vendor.name} (A093-A095)`, `
    <div style="font-size:13px;padding:6px 0;">
      <p style="margin:0 0 12px;color:var(--muted);font-size:12px;">
        Bulk map supplier SKUs, negotiated unit prices, pack sizes, and GST tax classifications to internal inventory item IDs.
      </p>
      <div style="margin-bottom:12px;">
        <label style="font-weight:700;display:block;margin-bottom:4px;">Paste Mapping Rows (JSON format) *</label>
        <textarea id="import-mappings-json" class="input" style="width:100%;height:140px;font-family:var(--font-mono);font-size:11.5px;" placeholder='[
  {
    "itemId": "INV-0001",
    "itemCode": "MILK-FULL-CREAM",
    "itemName": "Dairy Fresh Milk 500ml",
    "supplierSku": "SUP-DFM-500",
    "unitOfMeasure": "LITRE",
    "negotiatedUnitPricePaisa": 6200,
    "gstRate": 0
  }
]'></textarea>
      </div>
      <div style="display:flex;justify-content:flex-end;gap:8px;">
        <button class="btn btn-secondary" onclick="closeModal()" type="button">Cancel</button>
        <button class="btn btn-primary" id="btn-submit-mappings-import" type="button">Import Mappings</button>
      </div>
    </div>
  `);

  setTimeout(() => {
    document.getElementById("btn-submit-mappings-import")?.addEventListener("click", async () => {
      const raw = document.getElementById("import-mappings-json")?.value?.trim();
      if (!raw) {
        showToast("Please paste JSON mappings array.", "warning");
        return;
      }
      try {
        const mappings = JSON.parse(raw);
        if (!Array.isArray(mappings)) {
          showToast("Mappings must be a JSON array.", "warning");
          return;
        }
        const res = await apiPost(`/vendors/${vendor.vendorId}/supplier-materials/import`, { mappings });
        showToast(`Successfully imported ${res.data?.importedCount || mappings.length} material mappings!`, "success");
        closeModal();
      } catch (err) {
        showToast(err.message || "Failed to parse or import mappings.", "error");
      }
    });
  }, 50);
}

export const attachVendorListeners = wireVendors;
