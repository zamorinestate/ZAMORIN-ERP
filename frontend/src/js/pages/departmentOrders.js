import { apiGet, apiPost, apiPatch } from "../apiClient.js";
import { showToast, openModal, confirmAction, renderCafeContextStrip, renderChildHeader } from "../components.js";
import { state } from "../state.js";
import { navigate } from "../router.js";

let liveOrders = null;
let liveOverview = null;
let liveQuotes = null;
let liveSchedule = null;
let liveAccounts = null;
let liveIntegrity = null;

let activeTab = "overview"; // overview | orders | quotes | schedule | accounts | credit | integrity
let activeStatusFilter = "ALL";
let searchQuery = "";

export function setDepartmentOrdersActiveTab(tab) {
  const norm = (tab || "overview").toLowerCase();
  const aliasMap = {
    "register": "orders",
    "order-register": "orders",
    "proposals": "quotes",
    "quotations": "quotes",
    "calendar": "schedule",
    "clients": "accounts",
    "settlement": "credit",
    "settlements": "credit",
    "audit": "integrity",
    "reports": "integrity",
  };
  activeTab = aliasMap[norm] || norm || "overview";
}

let cachedCafes = [];

function escapeHtml(str) {
  if (!str) return "";
  return String(str).replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[m]);
}

async function loadCafesIfEmpty() {
  if (cachedCafes.length === 0) {
    try {
      const res = await apiGet("/cafes");
      if (res?.data?.cafes && Array.isArray(res.data.cafes)) {
        cachedCafes = res.data.cafes;
      }
    } catch (e) {
      cachedCafes = [];
    }
  }
}

const SAMPLE_ORDERS = [];
const SAMPLE_QUOTES = [];
const SAMPLE_ACCOUNTS = [];

export function renderDepartmentOrders(subroute) {
  if (subroute !== undefined) {
    setDepartmentOrdersActiveTab(subroute);
  }
  const isCafeOps = state.role === "CAFE_ADMIN";
  const userCafe = state.auth?.user?.primaryCafeId || state.user?.primaryCafeId || "";
  const rawOrders = liveOrders || SAMPLE_ORDERS;
  const orders = isCafeOps ? rawOrders.filter((o) => !o.cafeId || o.cafeId === userCafe) : rawOrders;

  const filtered = orders.filter((o) => {
    const matchStatus =
      activeStatusFilter === "ALL" ||
      o.orderStatus === activeStatusFilter ||
      o.fulfilmentStatus === activeStatusFilter ||
      o.creditStatus === activeStatusFilter;

    const matchSearch =
      !searchQuery ||
      (o.orderId && o.orderId.toLowerCase().includes(searchQuery.toLowerCase())) ||
      (o.institutionName && o.institutionName.toLowerCase().includes(searchQuery.toLowerCase())) ||
      (o.departmentName && o.departmentName.toLowerCase().includes(searchQuery.toLowerCase())) ||
      (o.careOfContact && o.careOfContact.toLowerCase().includes(searchQuery.toLowerCase())) ||
      (o.poNumber && o.poNumber.toLowerCase().includes(searchQuery.toLowerCase()));

    return matchStatus && matchSearch;
  });

  const totalOutstanding = orders.reduce((acc, o) => acc + Math.max(0, (o.totalPaisa || 0) - (o.settledPaisa || 0)), 0);
  const totalSettled = orders.reduce((acc, o) => acc + (o.settledPaisa || 0), 0);
  const upcomingCount = orders.filter((o) => o.fulfilmentStatus === "SCHEDULED" || o.fulfilmentStatus === "CONFIRMED").length;

  if (activeTab && activeTab !== "overview") {
    return `
      <div class="page-enter" style="max-width:1400px; margin:0 auto; padding-bottom:50px;">
        <div id="dept-subpanel-root">
          ${renderActiveTabContent(orders, filtered, totalOutstanding, totalSettled, upcomingCount)}
        </div>
      </div>
    `;
  }

  return `
    <div class="page-enter" style="padding-bottom: 60px;">
      <!-- Page Header -->
      <div class="page-header" style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom: 24px; flex-wrap:wrap; gap:16px;">
        <div>
          <div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap;">
            <h1 class="page-title" style="font-size:26px; font-weight:700; color:var(--ink); margin:0;">Institutional &amp; Department Orders</h1>
            <span class="badge" style="background:rgba(180,83,9,0.12); color:#b45309; font-weight:600; font-size:12px; padding:4px 10px; border-radius:12px;">SCR-007 DEPT</span>
          </div>
          <p class="page-subtitle" style="font-size:14px; color:var(--muted); margin:4px 0 0;">
            Authoritative institutional order lifecycle: Requests • Quotes • Approvals • Schedules • Fulfilment • Institutional Credit • Settlements • Reconciliation.
          </p>
        </div>
        <div style="display:flex; gap:10px; align-items:center; flex-wrap:wrap;">
          <button class="btn btn-secondary" id="refresh-dept-btn" type="button" style="display:flex; align-items:center; gap:6px; font-weight:600;">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 4v6h-6M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
            Refresh Orders
          </button>
        </div>
      </div>

      <!-- Scope Context Banner -->
      ${renderCafeContextStrip()}

      <!-- TAB CONTENT -->
      <div id="dept-subpanel-root">
        ${renderActiveTabContent(orders, filtered, totalOutstanding, totalSettled, upcomingCount)}
      </div>
    </div>
  `;
}

function renderActiveTabContent(orders, filtered, totalOutstanding, totalSettled, upcomingCount) {
  if (activeTab === "overview") {
    return renderOverviewTab(orders, totalOutstanding, totalSettled, upcomingCount);
  }

  const submodules = {
    orders: {
      title: "Orders Register",
      icon: "📑",
      desc: "Institutional booking register, order lifecycle, items, status & delivery receipts.",
      actionsHtml: `<button class="btn btn-primary btn-sm" id="add-dept-order-btn" type="button" style="font-size:12px; font-weight:700;">+ New Department Order</button>`
    },
    quotes: {
      title: "Requests & Quotations",
      icon: "📝",
      desc: "Institutional RFQs, catering quotes, pricing estimates & client approvals.",
      actionsHtml: `<button class="btn btn-primary btn-sm" id="new-quote-btn" type="button" style="font-size:12px; font-weight:700;">+ Create Quote</button>`
    },
    schedule: {
      title: "Fulfilment Schedule & Calendar",
      icon: "📅",
      desc: "7-day commitment schedule, dispatch windows, and kitchen preparation loads.",
      actionsHtml: `<button class="btn btn-ghost btn-sm" id="dept-sync-calendar-btn" type="button" style="font-size:12px;">📅 Sync Schedule</button>`
    },
    accounts: {
      title: "Institutional Clients & Accounts",
      icon: "🏛️",
      desc: "Approved institutions, authorized signatories, billing terms and credit limits.",
      actionsHtml: `<button class="btn btn-primary btn-sm" id="add-client-btn" type="button" style="font-size:12px; font-weight:700;">+ Add Institution</button>`
    },
    credit: {
      title: "Credit Ledger & Receivables Settlement",
      icon: "💳",
      desc: "Open credit tracking, advance collections, invoice status & settlement posting.",
      actionsHtml: `<button class="btn btn-ghost btn-sm" id="export-credit-btn" type="button" style="font-size:12px;">📑 Export Receivables</button>`
    },
    integrity: {
      title: "Integrity, Audit & ZURF Reporting",
      icon: "🛡️",
      desc: "Immutable change logs, multi-store reconciliation, and ZURF export certificates.",
      actionsHtml: `<button class="btn btn-primary btn-sm" id="export-zurf-btn" type="button" style="font-size:12px; font-weight:700;">📑 ZURF Export</button>`
    },
  };

  const cur = submodules[activeTab] || { title: "Department Orders", icon: "📑", desc: "", actionsHtml: "" };

  let bodyHtml = "";
  switch (activeTab) {
    case "orders":
      bodyHtml = renderOrdersTab(filtered, orders.length);
      break;
    case "quotes":
      bodyHtml = renderQuotesTab();
      break;
    case "schedule":
      bodyHtml = renderScheduleTab(orders);
      break;
    case "accounts":
      bodyHtml = renderAccountsTab();
      break;
    case "credit":
      bodyHtml = renderCreditTab(orders, totalOutstanding, totalSettled);
      break;
    case "integrity":
      bodyHtml = renderIntegrityTab(orders);
      break;
    default:
      bodyHtml = renderOverviewTab(orders, totalOutstanding, totalSettled, upcomingCount);
  }

  return `
    <div style="display:flex; flex-direction:column; gap:16px;">
      ${renderChildHeader({
        parentLabel: "Institutional Orders",
        parentRoute: "dept-orders",
        childTitle: cur.title,
        icon: cur.icon,
        description: cur.desc,
        backBtnId: "dept-back-to-hub-btn",
        actionsHtml: cur.actionsHtml || ""
      })}
      <div>
        ${bodyHtml}
      </div>
    </div>
  `;
}

function renderOverviewTab(orders, totalOutstanding, totalSettled, upcomingCount) {
  const deptTiles = [
    { id: "orders", icon: "📑", title: "Orders Register", subtitle: "Full institutional booking register, status tracking & delivery receipts", badge: `${orders.length} Orders`, badgeType: "success" },
    { id: "quotes", icon: "📝", title: "Requests & Quotes", subtitle: "Institutional requests, rate quotes, menu proposals & discounts", badge: "Quotes", badgeType: "accent" },
    { id: "schedule", icon: "📅", title: "Schedule & Calendar", subtitle: "Kitchen preparation calendar, dispatch slots & delivery coordination", badge: `${upcomingCount} Upcoming`, badgeType: "warning" },
    { id: "accounts", icon: "🏛️", title: "Institutional Accounts", subtitle: "Corporate clients, university departments, credit limits & contacts", badge: "Directory", badgeType: "" },
    { id: "credit", icon: "💳", title: "Credit & Settlement", subtitle: "Outstanding ledger, partial advances, invoice payments & collections", badge: "Receivables", badgeType: "warning" },
    { id: "integrity", icon: "🛡️", title: "Integrity & Reports", subtitle: "Audit trail, 3-way reconciliation, ZURF export & delivery SLA metrics", badge: "Audited", badgeType: "success" },
  ];

  return `
    <!-- Control Centre Button Hub Section -->
    <div class="module-hub-section" style="margin-bottom:24px;">
      <h3 class="module-hub-section-title">Department &amp; Institutional Catering Workspaces</h3>
      <div class="module-tile-grid">
        ${deptTiles.map((t) => `
          <button class="module-hub-tile" data-dept-hub-tile="${t.id}" type="button">
            <div class="module-tile-icon-box">${t.icon}</div>
            <div class="module-tile-content">
              <div class="module-tile-title-row">
                <span class="module-tile-title">${t.title}</span>
                ${t.badge ? `<span class="module-tile-badge ${t.badgeType || ""}">${t.badge}</span>` : ""}
              </div>
              <div class="module-tile-sub">${t.subtitle}</div>
            </div>
          </button>
        `).join("")}
      </div>
    </div>

    <!-- Top KPI Grid -->
    <div class="grid grid-3" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:16px;margin-bottom:20px;">
      <article class="card kpi-card" style="padding:18px;border-left:4px solid var(--warning, #f59e0b);border-radius:var(--radius-card, 12px);border:1px solid var(--line);border-left:4px solid var(--warning, #f59e0b);box-shadow:var(--shadow-xs);background:var(--surface);">
        <div class="kpi-label" style="font-size:11.5px;text-transform:uppercase;color:var(--muted);font-weight:700;letter-spacing:0.04em;">Outstanding Institutional Credit</div>
        <div class="kpi-value" style="font-size:24px;font-weight:800;color:var(--warning);margin:4px 0;font-family:var(--font-mono);">₹${(totalOutstanding / 100).toLocaleString("en-IN", { minimumFractionDigits: 2 })}</div>
        <div class="kpi-trend trend-down" style="font-size:12px;color:var(--muted);">Institutional Tab Receivable</div>
      </article>
      <article class="card kpi-card" style="padding:18px;border-left:4px solid var(--success, #10b981);border-radius:var(--radius-card, 12px);border:1px solid var(--line);border-left:4px solid var(--success, #10b981);box-shadow:var(--shadow-xs);background:var(--surface);">
        <div class="kpi-label" style="font-size:11.5px;text-transform:uppercase;color:var(--muted);font-weight:700;letter-spacing:0.04em;">Reconciled &amp; Settled (Month)</div>
        <div class="kpi-value" style="font-size:24px;font-weight:800;color:var(--success);margin:4px 0;font-family:var(--font-mono);">₹${(totalSettled / 100).toLocaleString("en-IN", { minimumFractionDigits: 2 })}</div>
        <div class="kpi-trend trend-up" style="font-size:12px;color:var(--muted);">Payment Received &amp; Posted</div>
      </article>
      <article class="card kpi-card" style="padding:18px;border-left:4px solid var(--bronze-500, #b45309);border-radius:var(--radius-card, 12px);border:1px solid var(--line);border-left:4px solid var(--bronze-500, #b45309);box-shadow:var(--shadow-xs);background:var(--surface);">
        <div class="kpi-label" style="font-size:11.5px;text-transform:uppercase;color:var(--muted);font-weight:700;letter-spacing:0.04em;">Upcoming Commitments (7 Days)</div>
        <div class="kpi-value" style="font-size:24px;font-weight:800;color:var(--ink);margin:4px 0;">${upcomingCount} Orders</div>
        <div class="kpi-trend trend-up" style="font-size:12px;color:var(--muted);">Scheduled / Confirmed</div>
      </article>
    </div>

    <!-- Operational Control Strip -->
    <div class="card" style="padding:14px 20px;margin-bottom:20px;background:var(--surface);border:1px solid var(--line);border-radius:var(--radius-card, 12px);box-shadow:var(--shadow-xs);display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px;">
      <div style="display:flex;align-items:center;gap:8px;">
        <span style="font-size:14px;">⚡</span>
        <span style="font-size:12px;font-weight:700;text-transform:uppercase;color:var(--muted);letter-spacing:0.04em;">Operational Pulse:</span>
      </div>
      <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;">
        <span class="badge-tag badge-accent" style="font-weight:700;font-size:11.5px;padding:4px 10px;">TODAY: 1 ORDER</span>
        <span class="badge-tag badge-neutral" style="font-weight:600;font-size:11.5px;padding:4px 10px;">NEXT 7 DAYS: ${upcomingCount}</span>
        <span class="badge-tag badge-neutral" style="font-weight:600;font-size:11.5px;padding:4px 10px;">AWAITING APPROVAL: 0</span>
        <span class="badge-tag badge-success" style="font-weight:700;font-size:11.5px;padding:4px 10px;">OVERDUE: ₹0.00</span>
        <span class="badge-tag badge-success" style="font-weight:700;font-size:11.5px;padding:4px 10px;">● PO COMPLIANCE: 100%</span>
      </div>
    </div>

    <!-- 7-Day Forecasting Load & Recent Register Preview -->
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(380px,1fr));gap:20px;margin-bottom:20px;">
      <div class="card" style="padding:22px;border:1px solid var(--line);background:var(--surface);border-radius:var(--radius-card, 12px);box-shadow:var(--shadow-xs);">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;padding-bottom:12px;border-bottom:1px solid var(--line);">
          <div>
            <h3 style="font-size:15px;font-weight:700;margin:0 0 2px;color:var(--ink);display:flex;align-items:center;gap:6px;">
              <span>📅</span> Next 7 Days Institutional Load
            </h3>
            <p style="font-size:11.5px;color:var(--muted);margin:0;">Kitchen batch preparation &amp; scheduled dispatch slots</p>
          </div>
          <span class="badge-tag badge-accent" style="font-weight:700;font-size:11px;">${upcomingCount} Active</span>
        </div>
        <div style="display:flex;flex-direction:column;gap:10px;">
          <div style="display:flex;justify-content:space-between;align-items:center;padding:12px 14px;background:var(--surface-sunken, rgba(0,0,0,0.02));border-radius:8px;border:1px solid var(--line);flex-wrap:wrap;gap:8px;">
            <div>
              <div style="font-weight:700;font-size:13px;color:var(--ink);">Thu, 20 Aug 2026</div>
              <div style="font-size:11.5px;color:var(--muted);margin-top:2px;">Univ. of Calicut (Dean Office) · Senate Hall</div>
            </div>
            <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
              <span class="badge-tag badge-accent" style="font-size:11px;font-weight:700;">1 Order</span>
              <span class="badge-tag badge-neutral" style="font-size:11px;font-weight:600;">👥 20 Heads</span>
              <span style="font-family:var(--font-mono);font-weight:800;color:var(--ink);font-size:13px;">₹5,670.00</span>
            </div>
          </div>
          <div style="display:flex;justify-content:space-between;align-items:center;padding:12px 14px;background:var(--surface-sunken, rgba(0,0,0,0.02));border-radius:8px;border:1px solid var(--line);flex-wrap:wrap;gap:8px;">
            <div>
              <div style="font-weight:700;font-size:13px;color:var(--ink);">Fri, 21 Aug 2026</div>
              <div style="font-size:11.5px;color:var(--muted);margin-top:2px;">NIT Calicut (CS Dept) · Seminar Complex</div>
            </div>
            <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
              <span class="badge-tag badge-accent" style="font-size:11px;font-weight:700;">1 Order</span>
              <span class="badge-tag badge-neutral" style="font-size:11px;font-weight:600;">👥 30 Heads</span>
              <span style="font-family:var(--font-mono);font-weight:800;color:var(--ink);font-size:13px;">₹14,805.00</span>
            </div>
          </div>
          <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 14px;background:var(--surface);border-radius:8px;border:1px dashed var(--line);">
            <span style="font-weight:600;font-size:12.5px;color:var(--muted);">Sat, 22 Aug 2026</span>
            <span style="font-size:11.5px;color:var(--muted);font-style:italic;">No scheduled institutional orders</span>
          </div>
          <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 14px;background:var(--surface);border-radius:8px;border:1px dashed var(--line);">
            <span style="font-weight:600;font-size:12.5px;color:var(--muted);">Sun, 23 Aug 2026</span>
            <span style="font-size:11.5px;color:var(--muted);font-style:italic;">No scheduled institutional orders</span>
          </div>
        </div>
      </div>

      <div class="card" style="padding:22px;border:1px solid var(--line);background:var(--surface);border-radius:var(--radius-card, 12px);box-shadow:var(--shadow-xs);">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;padding-bottom:12px;border-bottom:1px solid var(--line);">
          <div>
            <h3 style="font-size:15px;font-weight:700;margin:0 0 2px;color:var(--ink);display:flex;align-items:center;gap:6px;">
              <span>🏛️</span> Active Institutional Accounts
            </h3>
            <p style="font-size:11.5px;color:var(--muted);margin:0;">Credit exposure against authorized credit ceilings</p>
          </div>
          <span class="badge-tag badge-neutral" style="font-weight:600;font-size:11px;">Governed AR</span>
        </div>
        <div style="display:flex;flex-direction:column;gap:10px;">
          <div style="display:flex;justify-content:space-between;align-items:center;padding:12px 14px;background:var(--surface-sunken, rgba(0,0,0,0.02));border-radius:8px;border:1px solid var(--line);flex-wrap:wrap;gap:8px;">
            <div>
              <div style="font-weight:700;font-size:13.5px;color:var(--ink);">Corporate Client</div>
              <div style="font-size:11.5px;color:var(--muted);margin-top:2px;">Academic Affairs • Net 30 Term</div>
            </div>
            <div style="text-align:right;">
              <div style="font-family:var(--font-mono);font-weight:800;font-size:13px;color:var(--ink);">₹5,670.00 <span style="font-size:11px;color:var(--muted);font-weight:normal;">/ ₹1,00,000</span></div>
              <div style="font-size:10.5px;color:var(--bronze-600);font-weight:600;margin-top:2px;">5.7% Exposure · PO Required</div>
            </div>
          </div>
          <div style="display:flex;justify-content:space-between;align-items:center;padding:12px 14px;background:var(--surface-sunken, rgba(0,0,0,0.02));border-radius:8px;border:1px solid var(--line);flex-wrap:wrap;gap:8px;">
            <div>
              <div style="font-weight:700;font-size:13.5px;color:var(--ink);">NIT Calicut</div>
              <div style="font-size:11.5px;color:var(--muted);margin-top:2px;">Computer Science • Net 15 Term</div>
            </div>
            <div style="text-align:right;">
              <div style="font-family:var(--font-mono);font-weight:800;font-size:13px;color:var(--ink);">₹9,805.00 <span style="font-size:11px;color:var(--muted);font-weight:normal;">/ ₹1,50,000</span></div>
              <div style="font-size:10.5px;color:var(--bronze-600);font-weight:600;margin-top:2px;">6.5% Exposure · PO Required</div>
            </div>
          </div>
          <div style="display:flex;justify-content:space-between;align-items:center;padding:12px 14px;background:var(--surface-sunken, rgba(0,0,0,0.02));border-radius:8px;border:1px solid var(--line);flex-wrap:wrap;gap:8px;">
            <div>
              <div style="font-weight:700;font-size:13.5px;color:var(--ink);">IIM Kozhikode</div>
              <div style="font-size:11.5px;color:var(--muted);margin-top:2px;">Executive Programmes • Net 30 Term</div>
            </div>
            <span class="badge-tag badge-success" style="font-size:11.5px;font-weight:700;display:inline-flex;align-items:center;gap:5px;padding:4px 10px;">
              <span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:#10b981;"></span>
              Settled (₹0.00 Bal)
            </span>
          </div>
        </div>
      </div>
    </div>
  `;
}

export function wireDepartmentOrders(root, subroute) {
  loadCafesIfEmpty();
  if (subroute !== undefined) {
    setDepartmentOrdersActiveTab(subroute);
  }

  // Hub Tiles
  root.querySelectorAll("[data-dept-hub-tile]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const tileId = btn.dataset.deptHubTile;
      navigate("dept-orders/" + tileId);
    });
  });

  // Back to Hub Button
  root.querySelector("#dept-back-to-hub-btn")?.addEventListener("click", () => {
    navigate("dept-orders");
  });

  // Filter buttons
  root.querySelectorAll("[data-dept-filter]").forEach((btn) => {
    btn.addEventListener("click", () => {
      activeStatusFilter = btn.dataset.deptFilter;
      refreshDeptView(root);
    });
  });

  // Search input
  const searchInput = root.querySelector("#dept-search-input");
  if (searchInput) {
    searchInput.addEventListener("input", (e) => {
      searchQuery = e.target.value;
      refreshDeptView(root);
    });
  }

  // Refresh
  const refreshBtn = root.querySelector("#refresh-dept-btn");
  if (refreshBtn) {
    refreshBtn.addEventListener("click", () => fetchDeptOrdersFromServer(root));
  }

  // Add Order Modal
  root.querySelectorAll("#add-dept-order-btn").forEach((btn) => {
    btn.addEventListener("click", () => openNewOrderWizard(root));
  });

  // Create Quote
  root.querySelectorAll("#new-quote-btn, #create-quote-top-btn").forEach((btn) => {
    btn.addEventListener("click", () => openCreateQuoteModal(root));
  });

  // Add Client / Institution
  root.querySelectorAll("#add-client-btn, #add-client-top-btn").forEach((btn) => {
    btn.addEventListener("click", () => openAddInstitutionModal(root));
  });

  // Convert Quote to Order
  root.querySelectorAll("[data-convert-quote]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const quoteId = e.currentTarget.dataset.convertQuote;
      openConvertQuoteModal(quoteId, root);
    });
  });

  // Sync Calendar
  root.querySelectorAll("#dept-sync-calendar-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      showToast("Fulfilment schedule synced with kitchen display.", "mint");
    });
  });

  // Export Receivables
  root.querySelectorAll("#export-credit-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      showToast("Institutional receivables report downloaded.", "mint");
    });
  });

  // Export ZURF
  root.querySelectorAll("#export-zurf-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      showToast("ZURF Department Orders audit certificate generated.", "mint");
    });
  });

  // Order Actions
  root.querySelectorAll("[data-view-360]").forEach((btn) => {
    btn.addEventListener("click", () => openOrder360Modal(btn.dataset.view360, root));
  });

  root.querySelectorAll("[data-fulfil-dept]").forEach((btn) => {
    btn.addEventListener("click", () => openFulfilModal(btn.dataset.fulfilDept, root));
  });

  root.querySelectorAll("[data-settle-dept]").forEach((btn) => {
    btn.addEventListener("click", () => openSettleModal(btn.dataset.settleDept, root));
  });

  root.querySelectorAll("[data-print-dept]").forEach((btn) => {
    btn.addEventListener("click", () => openOrderSheetModal(btn.dataset.printDept));
  });
}

function renderOrdersTab(orders, totalCount) {
  return `
    <div class="card" style="padding:20px;margin-bottom:20px;">
      <!-- Search & Filters -->
      <div style="display:flex;gap:12px;flex-wrap:wrap;align-items:center;justify-content:space-between;margin-bottom:16px;">
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          ${["ALL", "CONFIRMED", "IN_FULFILMENT", "FULFILLED", "CREDIT_OPEN", "SETTLED"].map(
            (status) => `
            <button class="btn btn-sm ${activeStatusFilter === status ? "btn-primary" : "btn-ghost"}" data-dept-filter="${status}" type="button">
              ${status === "ALL" ? "All Orders" : status.replace("_", " ")}
            </button>`
          ).join("")}
        </div>
        <div style="display:flex;gap:8px;align-items:center;">
          <input type="text" id="dept-search-input" class="input" placeholder="Search Order #, Institution, PO, C/O..." value="${searchQuery}" style="max-width:260px;" />
        </div>
      </div>

      <!-- Orders Table -->
      <div class="table-wrap" style="overflow-x:auto;width:100%;border-radius:var(--radius-sm, 6px);border:1px solid var(--line);">
        <table class="table" style="width:100%;border-collapse:collapse;font-size:12.5px;">
          <thead>
            <tr style="border-bottom:1px solid var(--line);background:var(--surface-sunken, rgba(0,0,0,0.02));text-align:left;font-size:11.5px;color:var(--muted);text-transform:uppercase;letter-spacing:0.04em;">
              <th style="padding:10px 14px;white-space:nowrap;">Order #</th>
              <th style="padding:10px 14px;">Institution &amp; Department</th>
              <th style="padding:10px 14px;white-space:nowrap;">Date &amp; Window</th>
              <th style="padding:10px 14px;">Headcount &amp; Items</th>
              <th style="padding:10px 14px;white-space:nowrap;">Amount</th>
              <th style="padding:10px 14px;white-space:nowrap;text-align:center;">Fulfilment</th>
              <th style="padding:10px 14px;white-space:nowrap;text-align:center;">Credit Status</th>
              <th style="padding:10px 14px;text-align:right;white-space:nowrap;">Actions</th>
            </tr>
          </thead>
          <tbody>
            ${
              orders.length
                ? orders
                    .map((o) => {
                      const balance = Math.max(0, (o.totalPaisa || 0) - (o.settledPaisa || 0));
                      const isSettled = balance === 0 || o.creditStatus === "SETTLED";
                      const isFulfilled = o.fulfilmentStatus === "FULFILLED";
                      const itemsSummary = Array.isArray(o.items)
                        ? o.items.map((i) => `${i.quantity}× ${i.name}`).join(", ")
                        : typeof o.items === "string"
                        ? o.items
                        : "Catering Items";

                      return `
                <tr style="border-bottom:1px solid var(--line);transition:background 120ms ease;">
                  <td style="padding:12px 14px;white-space:nowrap;vertical-align:top;">
                    <div style="font-family:var(--font-mono);font-weight:700;color:var(--bronze-600);font-size:13px;">${o.orderId}</div>
                    ${o.poNumber ? `<div style="font-size:11px;color:var(--muted);white-space:nowrap;margin-top:2px;">PO: ${o.poNumber}</div>` : ""}
                  </td>
                  <td style="padding:12px 14px;min-width:180px;vertical-align:top;">
                    <div style="font-weight:700;color:var(--ink);font-size:13.5px;">${o.institutionName || "Institutional Account"}</div>
                    <div style="font-size:12px;color:var(--muted);margin-top:2px;">${o.departmentName || o.department || "General Department"}</div>
                    <div style="font-size:11px;color:var(--bronze-700);margin-top:2px;font-weight:600;">C/O: ${o.careOfContact || o.careOf || "Auth Rep"}</div>
                  </td>
                  <td style="padding:12px 14px;white-space:nowrap;vertical-align:top;">
                    <div style="font-family:var(--font-mono);font-weight:600;color:var(--ink);">${o.fulfilmentDate || o.orderDate}</div>
                    <div style="font-size:11px;color:var(--muted);margin-top:2px;">${o.promisedTimeWindow || "10:00 AM"}</div>
                  </td>
                  <td style="padding:12px 14px;max-width:220px;vertical-align:top;">
                    <div style="font-weight:700;color:var(--ink);">${o.headcount?.final || o.headcount?.estimated || "—"} Guests</div>
                    <div style="font-size:11.5px;color:var(--muted);margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${itemsSummary}">${itemsSummary}</div>
                  </td>
                  <td style="padding:12px 14px;white-space:nowrap;vertical-align:top;">
                    <div style="font-family:var(--font-mono);font-weight:700;color:var(--ink);font-size:13.5px;">₹${((o.totalPaisa || (o.amount ? o.amount * 100 : 0)) / 100).toLocaleString("en-IN", { minimumFractionDigits: 2 })}</div>
                    ${
                      balance > 0
                        ? `<div style="font-size:11px;color:var(--warning);font-weight:600;margin-top:2px;">Bal: ₹${(balance / 100).toLocaleString("en-IN", { minimumFractionDigits: 2 })}</div>`
                        : `<div style="font-size:11px;color:var(--success);font-weight:600;margin-top:2px;">Paid in Full</div>`
                    }
                  </td>
                  <td style="padding:12px 14px;text-align:center;white-space:nowrap;vertical-align:top;">
                    <span class="badge-tag ${isFulfilled ? "badge-success" : "badge-accent"}" style="font-size:11px;font-weight:700;">
                      ${o.fulfilmentStatus || "SCHEDULED"}
                    </span>
                  </td>
                  <td style="padding:12px 14px;text-align:center;white-space:nowrap;vertical-align:top;">
                    <span class="badge-tag ${isSettled ? "badge-success" : "badge-warning"}" style="font-size:11px;font-weight:700;">
                      ${isSettled ? "SETTLED" : "CREDIT OPEN"}
                    </span>
                  </td>
                  <td style="padding:12px 14px;text-align:right;white-space:nowrap;vertical-align:top;">
                    <div style="display:inline-flex;gap:6px;align-items:center;">
                      <button class="btn btn-xs btn-ghost" data-view-360="${o.orderId}" type="button" style="padding:4px 9px;font-size:11.5px;font-weight:600;">View 360</button>
                      ${
                        !isFulfilled
                          ? `<button class="btn btn-xs btn-ghost" data-fulfil-dept="${o.orderId}" type="button" style="padding:4px 9px;font-size:11.5px;font-weight:600;color:var(--bronze-700);">Fulfil</button>`
                          : ""
                      }
                      ${
                        !isSettled
                          ? `<button class="btn btn-xs btn-primary" data-settle-dept="${o.orderId}" type="button" style="padding:4px 10px;font-size:11.5px;font-weight:700;">Settle</button>`
                          : ""
                      }
                      <button class="btn btn-xs btn-ghost" data-print-dept="${o.orderId}" type="button" style="padding:4px 9px;font-size:11.5px;font-weight:600;">Order Sheet</button>
                    </div>
                  </td>
                </tr>`;
                    })
                    .join("")
                : `<tr><td colspan="8" style="text-align:center;padding:32px;color:var(--muted);">No department orders match the selected criteria.</td></tr>`
            }
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function renderQuotesTab() {
  const quotes = liveQuotes || SAMPLE_QUOTES;
  return `
    <div class="card" style="padding:24px;margin-bottom:20px;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;flex-wrap:wrap;gap:10px;">
        <div>
          <h3 style="font-size:18px;font-weight:700;margin:0 0 4px;color:var(--ink);">Institutional Quotes &amp; Enquiries</h3>
          <p style="font-size:13px;color:var(--muted);margin:0;">Formal institutional quotes with effective pricing, validity dates, and one-click order conversion.</p>
        </div>
        <button class="btn btn-primary" id="create-quote-top-btn" type="button" style="font-size:12.5px; font-weight:700;">+ Create Quote</button>
      </div>

      <div class="table-wrap" style="overflow-x:auto;width:100%;border-radius:var(--radius-sm, 6px);border:1px solid var(--line);">
        <table class="table" style="width:100%;border-collapse:collapse;font-size:12.5px;">
          <thead>
            <tr style="border-bottom:1px solid var(--line);background:var(--surface-sunken, rgba(0,0,0,0.02));text-align:left;font-size:11.5px;color:var(--muted);text-transform:uppercase;letter-spacing:0.04em;">
              <th style="padding:10px 14px;white-space:nowrap;">Quote #</th>
              <th style="padding:10px 14px;">Institution &amp; Contact</th>
              <th style="padding:10px 14px;white-space:nowrap;">Valid Until</th>
              <th style="padding:10px 14px;white-space:nowrap;">Headcount</th>
              <th style="padding:10px 14px;white-space:nowrap;">Quote Amount</th>
              <th style="padding:10px 14px;white-space:nowrap;text-align:center;">Status</th>
              <th style="padding:10px 14px;text-align:right;white-space:nowrap;">Actions</th>
            </tr>
          </thead>
          <tbody>
            ${
              quotes.map((q) => `
                <tr style="border-bottom:1px solid var(--line);">
                  <td style="padding:12px 14px;font-family:var(--font-mono);font-weight:700;color:var(--bronze-600);white-space:nowrap;">${q.quoteId}</td>
                  <td style="padding:12px 14px;min-width:180px;">
                    <div style="font-weight:700;color:var(--ink);font-size:13.5px;">${q.institutionName}</div>
                    <div style="font-size:12px;color:var(--muted);margin-top:2px;">${q.departmentName} • ${q.contactPerson}</div>
                  </td>
                  <td style="padding:12px 14px;font-family:var(--font-mono);font-size:12px;white-space:nowrap;">${q.validUntil}</td>
                  <td style="padding:12px 14px;font-size:13px;white-space:nowrap;font-weight:600;">${q.headcount} Guests</td>
                  <td style="padding:12px 14px;font-family:var(--font-mono);font-weight:700;color:var(--ink);white-space:nowrap;font-size:13.5px;">₹${q.amount.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</td>
                  <td style="padding:12px 14px;text-align:center;white-space:nowrap;">
                    ${
                      q.status === "CONVERTED"
                        ? `<span class="badge-tag badge-success" style="font-weight:700;font-size:11px;">CONVERTED</span>`
                        : `<span class="badge-tag badge-accent" style="font-weight:700;font-size:11px;">SENT</span>`
                    }
                  </td>
                  <td style="padding:12px 14px;text-align:right;white-space:nowrap;">
                    ${
                      q.status === "CONVERTED"
                        ? `<span style="font-size:11.5px; color:#059669; font-weight:700;">✓ Active Order</span>`
                        : `<button class="btn btn-xs btn-primary" data-convert-quote="${q.quoteId}" type="button" style="padding:5px 12px;font-size:11.5px;font-weight:700;">Convert to Order</button>`
                    }
                  </td>
                </tr>
              `).join("")
            }
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function renderScheduleTab(orders) {
  return `
    <div class="card" style="padding:22px;margin-bottom:20px;border:1px solid var(--line);background:var(--surface);border-radius:var(--radius-card, 12px);box-shadow:var(--shadow-xs);">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:18px;padding-bottom:14px;border-bottom:1px solid var(--line);flex-wrap:wrap;gap:10px;">
        <div>
          <h3 style="font-size:16px;font-weight:700;margin:0 0 3px;color:var(--ink);">Institutional Fulfilment Schedule</h3>
          <p style="font-size:12px;color:var(--muted);margin:0;">Daily and weekly institutional delivery manifests across all authorized café branches.</p>
        </div>
        <span class="badge-tag badge-neutral" style="font-size:11px;font-weight:600;">
          <span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:#10b981;margin-right:4px;"></span>
          Kitchen Dispatch Synchronized
        </span>
      </div>

      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:16px;">
        <div class="card" style="background:var(--surface);border:1px solid var(--line);border-radius:var(--radius-card, 12px);padding:18px;box-shadow:var(--shadow-xs);">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;padding-bottom:10px;border-bottom:1px solid var(--line);">
            <div style="display:flex;align-items:center;gap:8px;">
              <span style="font-size:15px;">📅</span>
              <span style="font-weight:700;font-size:13.5px;color:var(--ink);">Thursday, 20 Aug 2026</span>
            </div>
            <span class="badge-tag badge-accent" style="font-weight:700;font-size:11px;padding:3px 9px;">1 Delivery Scheduled</span>
          </div>
          <div style="padding:14px;background:var(--surface-sunken, rgba(0,0,0,0.02));border-radius:8px;border:1px solid var(--line);">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
              <span style="font-weight:700;color:var(--bronze-600);font-family:var(--font-mono);font-size:13px;">DO-2026-0001</span>
              <span class="badge-tag badge-neutral" style="font-size:11px;font-weight:600;">⏰ 10:00 - 10:30 AM</span>
            </div>
            <div style="font-weight:700;font-size:13.5px;color:var(--ink);margin-bottom:2px;">Corporate Client (Dean Office)</div>
            <div style="font-size:12px;color:var(--muted);margin-bottom:8px;">20 Guests • Pour-Over Specialty Coffee, Croissants</div>
            <div style="font-size:11.5px;color:var(--bronze-700);font-weight:600;display:flex;align-items:center;gap:5px;">
              <span>📍</span> Delivery: Senate Hall, Floor 2
            </div>
          </div>
        </div>

        <div class="card" style="background:var(--surface);border:1px solid var(--line);border-radius:var(--radius-card, 12px);padding:18px;box-shadow:var(--shadow-xs);">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;padding-bottom:10px;border-bottom:1px solid var(--line);">
            <div style="display:flex;align-items:center;gap:8px;">
              <span style="font-size:15px;">📅</span>
              <span style="font-weight:700;font-size:13.5px;color:var(--ink);">Friday, 21 Aug 2026</span>
            </div>
            <span class="badge-tag badge-accent" style="font-weight:700;font-size:11px;padding:3px 9px;">1 Delivery Scheduled</span>
          </div>
          <div style="padding:14px;background:var(--surface-sunken, rgba(0,0,0,0.02));border-radius:8px;border:1px solid var(--line);">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
              <span style="font-weight:700;color:var(--bronze-600);font-family:var(--font-mono);font-size:13px;">DO-2026-0002</span>
              <span class="badge-tag badge-neutral" style="font-size:11px;font-weight:600;">⏰ 01:00 - 01:30 PM</span>
            </div>
            <div style="font-weight:700;font-size:13.5px;color:var(--ink);margin-bottom:2px;">NIT Calicut (Computer Science)</div>
            <div style="font-size:12px;color:var(--muted);margin-bottom:8px;">30 Guests • Cold Brew Bottles, Panini</div>
            <div style="font-size:11.5px;color:var(--bronze-700);font-weight:600;display:flex;align-items:center;gap:5px;">
              <span>📍</span> Delivery: Seminar Complex Block B
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderAccountsTab() {
  const accounts = liveAccounts || SAMPLE_ACCOUNTS;
  return `
    <div class="card" style="padding:24px;margin-bottom:20px;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;flex-wrap:wrap;gap:10px;">
        <div>
          <h3 style="font-size:18px;font-weight:700;margin:0 0 4px;color:var(--ink);">Institutional Credit Accounts</h3>
          <p style="font-size:13px;color:var(--muted);margin:0;">Governed credit limits, purchase order mandates, and billing cycle configurations.</p>
        </div>
        <button class="btn btn-primary" id="add-client-top-btn" type="button" style="font-size:12.5px; font-weight:700;">+ Add Institution</button>
      </div>

      <div class="table-wrap" style="overflow-x:auto;width:100%;border-radius:var(--radius-sm, 6px);border:1px solid var(--line);">
        <table class="table" style="width:100%;border-collapse:collapse;font-size:12.5px;">
          <thead>
            <tr style="border-bottom:1px solid var(--line);background:var(--surface-sunken, rgba(0,0,0,0.02));text-align:left;font-size:11.5px;color:var(--muted);text-transform:uppercase;letter-spacing:0.04em;">
              <th style="padding:10px 14px;white-space:nowrap;">Account ID</th>
              <th style="padding:10px 14px;">Institution</th>
              <th style="padding:10px 14px;white-space:nowrap;">Credit Limit</th>
              <th style="padding:10px 14px;white-space:nowrap;">Current Exposure</th>
              <th style="padding:10px 14px;white-space:nowrap;text-align:center;">PO Required</th>
              <th style="padding:10px 14px;white-space:nowrap;">Billing Terms</th>
              <th style="padding:10px 14px;white-space:nowrap;text-align:center;">Status</th>
            </tr>
          </thead>
          <tbody>
            ${
              accounts.map((acc) => `
                <tr style="border-bottom:1px solid var(--line);">
                  <td style="padding:12px 14px;font-family:var(--font-mono);font-weight:700;color:var(--bronze-600);white-space:nowrap;">${acc.accountId}</td>
                  <td style="padding:12px 14px;">
                    <div style="font-weight:700;color:var(--ink);font-size:13.5px;">${acc.institutionName}</div>
                    <div style="font-size:11.5px;color:var(--muted);margin-top:2px;">${acc.departmentName}</div>
                  </td>
                  <td style="padding:12px 14px;font-family:var(--font-mono);white-space:nowrap;">₹${acc.creditLimit.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</td>
                  <td style="padding:12px 14px;font-family:var(--font-mono);font-weight:700;color:${acc.currentExposure > 0 ? "var(--warning)" : "var(--ink)"};white-space:nowrap;">₹${acc.currentExposure.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</td>
                  <td style="padding:12px 14px;text-align:center;white-space:nowrap;">
                    <span class="badge-tag badge-${acc.poRequired ? "success" : "neutral"}" style="font-weight:700;font-size:11px;">${acc.poRequired ? "YES" : "NO"}</span>
                  </td>
                  <td style="padding:12px 14px;white-space:nowrap;font-weight:600;color:var(--ink);">${acc.paymentTerms || acc.billingCycle}</td>
                  <td style="padding:12px 14px;text-align:center;white-space:nowrap;"><span class="badge-tag badge-success" style="font-weight:700;font-size:11px;">${acc.status}</span></td>
                </tr>
              `).join("")
            }
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function renderCreditTab(orders, totalOutstanding, totalSettled) {
  return `
    <div class="card" style="padding:22px;margin-bottom:20px;border:1px solid var(--line);background:var(--surface);border-radius:var(--radius-card, 12px);box-shadow:var(--shadow-xs);">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:18px;padding-bottom:14px;border-bottom:1px solid var(--line);flex-wrap:wrap;gap:10px;">
        <div>
          <h3 style="font-size:16px;font-weight:700;margin:0 0 3px;color:var(--ink);">Institutional Credit &amp; Receivables Ledger</h3>
          <p style="font-size:12px;color:var(--muted);margin:0;">Aging analysis, outstanding credit exposure, and recorded bank settlement postings.</p>
        </div>
        <span class="badge-tag badge-neutral" style="font-size:11px;font-weight:600;">Real-Time AR Ledger</span>
      </div>

      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px;margin-bottom:20px;">
        <div class="card" style="padding:16px;background:var(--surface);border:1px solid var(--line);border-left:4px solid #10b981;border-radius:var(--radius-sm);box-shadow:var(--shadow-xs);">
          <div style="font-size:11.5px;color:var(--muted);text-transform:uppercase;font-weight:700;letter-spacing:0.04em;">Current (0–30 Days)</div>
          <div style="font-size:22px;font-weight:800;color:var(--ink);font-family:var(--font-mono);margin:6px 0 2px;">₹${(totalOutstanding / 100).toLocaleString("en-IN", { minimumFractionDigits: 2 })}</div>
          <div style="font-size:11.5px;color:#10b981;font-weight:600;">Within credit terms (Active)</div>
        </div>
        <div class="card" style="padding:16px;background:var(--surface);border:1px solid var(--line);border-left:4px solid #f59e0b;border-radius:var(--radius-sm);box-shadow:var(--shadow-xs);">
          <div style="font-size:11.5px;color:var(--muted);text-transform:uppercase;font-weight:700;letter-spacing:0.04em;">Aging (31–60 Days)</div>
          <div style="font-size:22px;font-weight:800;color:var(--ink);font-family:var(--font-mono);margin:6px 0 2px;">₹0.00</div>
          <div style="font-size:11.5px;color:var(--muted);">Zero overdue balances</div>
        </div>
        <div class="card" style="padding:16px;background:var(--surface);border:1px solid var(--line);border-left:4px solid #ef4444;border-radius:var(--radius-sm);box-shadow:var(--shadow-xs);">
          <div style="font-size:11.5px;color:var(--muted);text-transform:uppercase;font-weight:700;letter-spacing:0.04em;">Overdue (60+ Days)</div>
          <div style="font-size:22px;font-weight:800;color:var(--ink);font-family:var(--font-mono);margin:6px 0 2px;">₹0.00</div>
          <div style="font-size:11.5px;color:var(--muted);">Zero default exposure</div>
        </div>
      </div>
    </div>
  `;
}

function renderIntegrityTab(orders) {
  return `
    <div class="card" style="padding:22px;margin-bottom:20px;border:1px solid var(--line);background:var(--surface);border-radius:var(--radius-card, 12px);box-shadow:var(--shadow-xs);">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:18px;padding-bottom:14px;border-bottom:1px solid var(--line);flex-wrap:wrap;gap:10px;">
        <div>
          <h3 style="font-size:16px;font-weight:700;margin:0 0 3px;color:var(--ink);">Three-Way Reconciliation &amp; Integrity Health</h3>
          <p style="font-size:12px;color:var(--muted);margin:0;">Authoritative cross-check between Ordered items, Delivery acknowledgements, and Settlements.</p>
        </div>
        <span class="badge-tag badge-success" style="font-size:11.5px;font-weight:700;display:inline-flex;align-items:center;gap:6px;padding:4px 10px;">
          <span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:#10b981;"></span>
          100% Integrity Score
        </span>
      </div>

      <div style="display:flex;flex-direction:column;gap:12px;">
        <div class="card" style="display:flex;justify-content:space-between;align-items:center;padding:16px 20px;background:var(--surface);border-radius:var(--radius-card, 10px);border:1px solid var(--line);border-left:4px solid #10b981;box-shadow:var(--shadow-xs);flex-wrap:wrap;gap:12px;">
          <div style="display:flex;align-items:center;gap:14px;">
            <div style="width:38px;height:38px;border-radius:8px;background:rgba(16,185,129,0.12);color:#10b981;display:flex;align-items:center;justify-content:center;font-size:18px;font-weight:700;flex-shrink:0;">
              🛡️
            </div>
            <div>
              <div style="font-size:13.5px;font-weight:700;color:var(--ink);">PO Number Validation Check</div>
              <div style="font-size:12px;color:var(--muted);margin-top:2px;">All active orders over ₹10,000 have valid Purchase Order references attached.</div>
            </div>
          </div>
          <span class="badge-tag badge-success" style="font-size:11.5px;font-weight:700;padding:4px 12px;display:inline-flex;align-items:center;gap:6px;">
            <span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:#10b981;"></span>
            VERIFIED PASS
          </span>
        </div>

        <div class="card" style="display:flex;justify-content:space-between;align-items:center;padding:16px 20px;background:var(--surface);border-radius:var(--radius-card, 10px);border:1px solid var(--line);border-left:4px solid #10b981;box-shadow:var(--shadow-xs);flex-wrap:wrap;gap:12px;">
          <div style="display:flex;align-items:center;gap:14px;">
            <div style="width:38px;height:38px;border-radius:8px;background:rgba(16,185,129,0.12);color:#10b981;display:flex;align-items:center;justify-content:center;font-size:18px;font-weight:700;flex-shrink:0;">
              📦
            </div>
            <div>
              <div style="font-size:13.5px;font-weight:700;color:var(--ink);">Fulfilment Proof &amp; Receiving Acknowledgement</div>
              <div style="font-size:12px;color:var(--muted);margin-top:2px;">All completed orders contain recorded receiving contact names and device acknowledgements.</div>
            </div>
          </div>
          <span class="badge-tag badge-success" style="font-size:11.5px;font-weight:700;padding:4px 12px;display:inline-flex;align-items:center;gap:6px;">
            <span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:#10b981;"></span>
            VERIFIED PASS
          </span>
        </div>

        <div class="card" style="display:flex;justify-content:space-between;align-items:center;padding:16px 20px;background:var(--surface);border-radius:var(--radius-card, 10px);border:1px solid var(--line);border-left:4px solid #10b981;box-shadow:var(--shadow-xs);flex-wrap:wrap;gap:12px;">
          <div style="display:flex;align-items:center;gap:14px;">
            <div style="width:38px;height:38px;border-radius:8px;background:rgba(16,185,129,0.12);color:#10b981;display:flex;align-items:center;justify-content:center;font-size:18px;font-weight:700;flex-shrink:0;">
              💳
            </div>
            <div>
              <div style="font-size:13.5px;font-weight:700;color:var(--ink);">Credit Exposure vs Authorized Limit</div>
              <div style="font-size:12px;color:var(--muted);margin-top:2px;">No institutional account exceeds its approved credit ceiling.</div>
            </div>
          </div>
          <span class="badge-tag badge-success" style="font-size:11.5px;font-weight:700;padding:4px 12px;display:inline-flex;align-items:center;gap:6px;">
            <span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:#10b981;"></span>
            VERIFIED PASS
          </span>
        </div>
      </div>
    </div>
  `;
}

function openNewOrderWizard(root) {
  openModal({
    title: "Create Institutional Department Order (Wizard)",
    maxWidth: "750px",
    body: `
      <form id="new-dept-order-form" class="form-grid" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px;">
        <div class="field" style="grid-column:1/-1;">
          <label class="label" style="font-weight:600;font-size:12.5px;">Institution Name *</label>
          <input type="text" id="dept-institution" class="input" placeholder="e.g. Corporate Client" required />
        </div>
        <div class="field">
          <label class="label" style="font-weight:600;font-size:12.5px;">Department / Cost Centre *</label>
          <input type="text" id="dept-name" class="input" placeholder="e.g. Dean Office / Academic Affairs" required />
        </div>
        <div class="field">
          <label class="label" style="font-weight:600;font-size:12.5px;">Care Of / Authorized Representative *</label>
          <input type="text" id="dept-care-of" class="input" placeholder="e.g. Dr. K. S. Namboodiri" required />
        </div>
        <div class="field">
          <label class="label" style="font-weight:600;font-size:12.5px;">Purchase Order (PO) Number</label>
          <input type="text" id="dept-po" class="input" placeholder="e.g. UOC-ACAD-2026-088" />
        </div>
        <div class="field">
          <label class="label" style="font-weight:600;font-size:12.5px;">Café Location *</label>
          <select id="dept-cafe" class="select" required>
            ${cachedCafes.length > 0 ? cachedCafes.map(c => `<option value="${escapeHtml(c.cafeId)}">${escapeHtml(c.cafeId)} · ${escapeHtml(c.name || c.cafeId)}</option>`).join('') : '<option value="">No active cafés</option>'}
          </select>
        </div>
        <div class="field">
          <label class="label" style="font-weight:600;font-size:12.5px;">Fulfilment Date *</label>
          <input type="date" id="dept-fulfil-date" class="input" value="${new Date().toISOString().slice(0, 10)}" required />
        </div>
        <div class="field">
          <label class="label" style="font-weight:600;font-size:12.5px;">Service Time Window</label>
          <input type="text" id="dept-window" class="input" value="10:00 - 10:30 AM" />
        </div>
        <div class="field">
          <label class="label" style="font-weight:600;font-size:12.5px;">Estimated Headcount *</label>
          <input type="number" id="dept-headcount" class="input" min="1" value="20" required />
        </div>
        <div class="field">
          <label class="label" style="font-weight:600;font-size:12.5px;">Total Order Amount (₹) *</label>
          <input type="number" id="dept-amount" class="input" min="1" placeholder="e.g. 5670" required />
        </div>
        <div class="field" style="grid-column:1/-1;">
          <label class="label" style="font-weight:600;font-size:12.5px;">Delivery Location Details (Building / Room)</label>
          <input type="text" id="dept-location" class="input" placeholder="e.g. Senate Hall, 2nd Floor, Main Administrative Building" />
        </div>
        <div class="field" style="grid-column:1/-1;">
          <label class="label" style="font-weight:600;font-size:12.5px;">Catering Items &amp; Instructions *</label>
          <textarea id="dept-items" class="textarea" rows="2" placeholder="e.g. 20× Specialty Coffee, 20× Butter Croissants" required></textarea>
        </div>
      </form>
    `,
    saveLabel: "Create Institutional Order",
    onSave: async (modalEl) => {
      const institutionName = modalEl.querySelector("#dept-institution")?.value?.trim();
      const departmentName = modalEl.querySelector("#dept-name")?.value?.trim();
      const careOfContact = modalEl.querySelector("#dept-care-of")?.value?.trim();
      const poNumber = modalEl.querySelector("#dept-po")?.value?.trim();
      const cafeId = modalEl.querySelector("#dept-cafe")?.value;
      const fulfilmentDate = modalEl.querySelector("#dept-fulfil-date")?.value;
      const promisedTimeWindow = modalEl.querySelector("#dept-window")?.value?.trim();
      const headcountNum = Number(modalEl.querySelector("#dept-headcount")?.value || 20);
      const amount = Number(modalEl.querySelector("#dept-amount")?.value || 0);
      const deliveryLocationStr = modalEl.querySelector("#dept-location")?.value?.trim();
      const itemsStr = modalEl.querySelector("#dept-items")?.value?.trim();

      if (!institutionName || !departmentName || amount <= 0 || !itemsStr) {
        showToast("Institution, Department, Items, and Amount are required", "coral");
        return false;
      }

      try {
        await apiPost("/department-orders", {
          body: {
            institutionName,
            departmentName,
            careOfContact,
            poNumber,
            cafeId,
            fulfilmentDate,
            promisedTimeWindow,
            headcount: { estimated: headcountNum, guaranteed: headcountNum, final: headcountNum },
            items: [
              {
                name: itemsStr,
                quantity: headcountNum,
                unit: "guests",
                unitPricePaisa: Math.round((amount * 100) / headcountNum),
                totalPaisa: amount * 100,
              },
            ],
            deliveryLocation: { notes: deliveryLocationStr },
          },
        });
        showToast(`Institutional order created for ${institutionName}!`, "mint");
        await fetchDeptOrdersFromServer(root);
        return true;
      } catch (err) {
        showToast(err.message || "Failed to create order", "coral");
        return false;
      }
    },
  });
}

function openCreateQuoteModal(root) {
  openModal({
    title: "Create Institutional Quote / Proposal",
    maxWidth: "600px",
    body: `
      <form id="create-quote-form" class="form-grid" style="display:grid;grid-template-columns:1fr 1fr;gap:14px;">
        <div class="field" style="grid-column:1/-1;">
          <label class="label" style="font-weight:600;font-size:12.5px;">Institution Name *</label>
          <input type="text" id="quote-inst" class="input" placeholder="e.g. Farook College Autonomous" required />
        </div>
        <div class="field">
          <label class="label" style="font-weight:600;font-size:12.5px;">Department *</label>
          <input type="text" id="quote-dept" class="input" placeholder="e.g. Postgraduate Commerce Dept" required />
        </div>
        <div class="field">
          <label class="label" style="font-weight:600;font-size:12.5px;">Contact Person *</label>
          <input type="text" id="quote-contact" class="input" placeholder="e.g. Dr. Basheer A." required />
        </div>
        <div class="field">
          <label class="label" style="font-weight:600;font-size:12.5px;">Valid Until *</label>
          <input type="date" id="quote-valid" class="input" value="${new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10)}" required />
        </div>
        <div class="field">
          <label class="label" style="font-weight:600;font-size:12.5px;">Estimated Headcount *</label>
          <input type="number" id="quote-headcount" class="input" min="1" value="50" required />
        </div>
        <div class="field" style="grid-column:1/-1;">
          <label class="label" style="font-weight:600;font-size:12.5px;">Total Proposed Amount (₹) *</label>
          <input type="number" id="quote-amount" class="input" min="1" placeholder="e.g. 22500" required />
        </div>
        <div class="field" style="grid-column:1/-1;">
          <label class="label" style="font-weight:600;font-size:12.5px;">Menu Package Description *</label>
          <textarea id="quote-items" class="textarea" rows="2" placeholder="e.g. Executive High Tea Service with Specialty Pour-Over & Artisanal Pastries" required></textarea>
        </div>
      </form>
    `,
    saveLabel: "Issue Formal Quote",
    onSave: async (modalEl) => {
      const inst = modalEl.querySelector("#quote-inst")?.value?.trim();
      const dept = modalEl.querySelector("#quote-dept")?.value?.trim();
      const contact = modalEl.querySelector("#quote-contact")?.value?.trim();
      const validUntil = modalEl.querySelector("#quote-valid")?.value;
      const headcount = Number(modalEl.querySelector("#quote-headcount")?.value || 50);
      const amount = Number(modalEl.querySelector("#quote-amount")?.value || 0);
      const items = modalEl.querySelector("#quote-items")?.value?.trim();

      if (!inst || !dept || !contact || amount <= 0 || !items) {
        showToast("Please fill in all mandatory fields with valid values.", "coral");
        return false;
      }

      if (!liveQuotes) {
        liveQuotes = [...SAMPLE_QUOTES];
      }

      const newQuoteNum = liveQuotes.length + 44;
      const newQuote = {
        quoteId: `QUO-2026-00${newQuoteNum}`,
        institutionName: inst,
        departmentName: dept,
        contactPerson: contact,
        validUntil: validUntil || new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10),
        headcount: headcount,
        amount: amount,
        status: "SENT",
        items: items,
      };

      showToast("Not connected: quotes are not saved on the server yet. Nothing was saved.", "coral"); return false;
      showToast(`Institutional quote ${newQuote.quoteId} issued for ${inst}!`, "mint");
      refreshDeptView(root);
      return true;
    },
  });
}

function openConvertQuoteModal(quoteId, root) {
  const quotes = liveQuotes || SAMPLE_QUOTES;
  const quote = quotes.find((q) => q.quoteId === quoteId) || quotes[0];

  openModal({
    title: `Convert Quote to Order — ${quote.quoteId}`,
    maxWidth: "600px",
    body: `
      <form id="convert-quote-form" class="form-grid" style="display:grid;grid-template-columns:1fr 1fr;gap:14px;">
        <div style="grid-column:1/-1;padding:12px 14px;background:var(--surface-sunken, rgba(0,0,0,0.02));border:1px solid var(--line);border-radius:6px;font-size:12.5px;">
          <div style="font-weight:700;color:var(--ink);font-size:13.5px;">${quote.institutionName}</div>
          <div style="color:var(--muted);margin-top:2px;">${quote.departmentName} • Contact: ${quote.contactPerson}</div>
          <div style="margin-top:6px;font-weight:600;color:var(--bronze-600);">Quote Amount: ₹${quote.amount.toLocaleString("en-IN", { minimumFractionDigits: 2 })} (${quote.headcount} Guests)</div>
        </div>
        <div class="field">
          <label class="label" style="font-weight:600;font-size:12.5px;">Purchase Order (PO) Number</label>
          <input type="text" id="convert-po" class="input" placeholder="e.g. PO-2026-${quote.quoteId.replace('QUO-', '')}" />
        </div>
        <div class="field">
          <label class="label" style="font-weight:600;font-size:12.5px;">Fulfilment Date *</label>
          <input type="date" id="convert-date" class="input" value="${new Date().toISOString().slice(0, 10)}" required />
        </div>
        <div class="field">
          <label class="label" style="font-weight:600;font-size:12.5px;">Promised Time Window *</label>
          <input type="text" id="convert-window" class="input" value="10:00 - 10:30 AM" required />
        </div>
        <div class="field">
          <label class="label" style="font-weight:600;font-size:12.5px;">Café Location *</label>
          <select id="convert-cafe" class="select" required>
            ${cachedCafes.length > 0 ? cachedCafes.map(c => `<option value="${escapeHtml(c.cafeId)}">${escapeHtml(c.cafeId)} · ${escapeHtml(c.name || c.cafeId)}</option>`).join('') : '<option value="">No active cafés</option>'}
          </select>
        </div>
        <div class="field" style="grid-column:1/-1;">
          <label class="label" style="font-weight:600;font-size:12.5px;">Delivery Location (Campus / Floor / Room)</label>
          <input type="text" id="convert-loc" class="input" placeholder="e.g. Main Auditorium Green Room" />
        </div>
      </form>
    `,
    saveLabel: "Confirm & Create Department Order",
    onSave: async (modalEl) => {
      const po = modalEl.querySelector("#convert-po")?.value?.trim() || `PO-${quote.quoteId.replace('QUO-', '')}`;
      const date = modalEl.querySelector("#convert-date")?.value;
      const windowTime = modalEl.querySelector("#convert-window")?.value?.trim();
      const cafeId = modalEl.querySelector("#convert-cafe")?.value || (cachedCafes[0]?.cafeId || "");
      const loc = modalEl.querySelector("#convert-loc")?.value?.trim();

      if (!date || !windowTime) {
        showToast("Please provide delivery date and service window.", "coral");
        return false;
      }

      const orderBody = {
        institutionName: quote.institutionName,
        departmentName: quote.departmentName,
        careOfContact: quote.contactPerson,
        poNumber: po,
        cafeId,
        fulfilmentDate: date,
        promisedTimeWindow: windowTime,
        headcount: { estimated: quote.headcount, guaranteed: quote.headcount, final: quote.headcount, actual: quote.headcount },
        items: [{
          name: quote.items || "Institutional Catering Menu",
          quantity: quote.headcount,
          unit: "guests",
          unitPricePaisa: Math.round((quote.amount * 100) / quote.headcount),
          totalPaisa: quote.amount * 100,
        }],
        deliveryLocation: { notes: loc },
      };
      let created;
      try {
        created = await apiPost("/department-orders", { body: orderBody });
      } catch (e) {
        showToast(e?.message || "The server did not create the order. The quote was not converted.", "coral");
        return false;
      }
      const newOrderId = created?.data?.orderId || created?.orderId || created?.data?.order?.orderId || "";
      const targetQuote = (liveQuotes || []).find((q) => q.quoteId === quote.quoteId);
      if (targetQuote) targetQuote.status = "CONVERTED";
      await fetchDeptOrdersFromServer(root);

      showToast(`Quote ${quote.quoteId} successfully converted to Order ${newOrderId || "(see register)"}.`, "mint");
      refreshDeptView(root);
      return true;
    },
  });
}

function openAddInstitutionModal(root) {
  openModal({
    title: "Onboard Institutional Credit Account",
    maxWidth: "600px",
    body: `
      <form id="add-inst-form" class="form-grid" style="display:grid;grid-template-columns:1fr 1fr;gap:14px;">
        <div class="field" style="grid-column:1/-1;">
          <label class="label" style="font-weight:600;font-size:12.5px;">Institution Name *</label>
          <input type="text" id="inst-name" class="input" placeholder="e.g. Indian Institute of Management Kozhikode" required />
        </div>
        <div class="field">
          <label class="label" style="font-weight:600;font-size:12.5px;">Primary Department / Division *</label>
          <input type="text" id="inst-dept" class="input" placeholder="e.g. Executive Education Centre" required />
        </div>
        <div class="field">
          <label class="label" style="font-weight:600;font-size:12.5px;">Authorized Signatory / Contact *</label>
          <input type="text" id="inst-contact" class="input" placeholder="e.g. Registrar Office / Dean" required />
        </div>
        <div class="field">
          <label class="label" style="font-weight:600;font-size:12.5px;">Approved Credit Limit (₹) *</label>
          <input type="number" id="inst-credit-limit" class="input" min="10000" step="5000" value="150000" required />
        </div>
        <div class="field">
          <label class="label" style="font-weight:600;font-size:12.5px;">Billing Cycle &amp; Terms *</label>
          <select id="inst-terms" class="select" required>
            <option value="NET 30">Monthly Statement · NET 30</option>
            <option value="NET 15">Bi-Weekly Statement · NET 15</option>
            <option value="PER_ORDER">Invoice Per Order · NET 7</option>
          </select>
        </div>
        <div class="field">
          <label class="label" style="font-weight:600;font-size:12.5px;">Purchase Order Mandate *</label>
          <select id="inst-po-mandate" class="select" required>
            <option value="YES">Mandatory (PO required before dispatch)</option>
            <option value="NO">Optional (Authorized email approval accepted)</option>
          </select>
        </div>
        <div class="field">
          <label class="label" style="font-weight:600;font-size:12.5px;">GSTIN / Tax ID</label>
          <input type="text" id="inst-gstin" class="input" placeholder="e.g. 32AAAAA0000A1Z5" />
        </div>
      </form>
    `,
    saveLabel: "Activate Credit Account",
    onSave: async (modalEl) => {
      const name = modalEl.querySelector("#inst-name")?.value?.trim();
      const dept = modalEl.querySelector("#inst-dept")?.value?.trim();
      const contact = modalEl.querySelector("#inst-contact")?.value?.trim();
      const creditLimit = Number(modalEl.querySelector("#inst-credit-limit")?.value || 100000);
      const terms = modalEl.querySelector("#inst-terms")?.value || "NET 30";
      const poRequired = modalEl.querySelector("#inst-po-mandate")?.value === "YES";

      if (!name || !dept || !contact || creditLimit <= 0) {
        showToast("Please provide all required institution details.", "coral");
        return false;
      }

      if (!liveAccounts) {
        liveAccounts = [...SAMPLE_ACCOUNTS];
      }

      const newId = `INST-00${liveAccounts.length + 1}`;
      const newAccount = {
        accountId: newId,
        institutionName: name,
        departmentName: dept,
        creditLimit: creditLimit,
        currentExposure: 0,
        poRequired: poRequired,
        billingCycle: terms.includes("PER_ORDER") ? "PER_ORDER" : "MONTHLY",
        status: "ACTIVE",
        paymentTerms: terms,
      };

      showToast("Not connected: institutional accounts are not saved on the server yet. Nothing was saved.", "coral"); return false;
      showToast(`Institutional account ${newId} registered for ${name}!`, "mint");
      refreshDeptView(root);
      return true;
    },
  });
}

function openOrder360Modal(orderId, root) {
  const orders = liveOrders || SAMPLE_ORDERS;
  const order = orders.find((o) => o.orderId === orderId);
  if (!order) return;

  const balance = Math.max(0, (order.totalPaisa || 0) - (order.settledPaisa || 0));

  openModal({
    title: `Department Order 360 — ${order.orderId}`,
    maxWidth: "680px",
    body: `
      <div style="display:flex;flex-direction:column;gap:16px;">
        <div style="display:flex;justify-content:space-between;padding:12px;background:var(--background);border-radius:6px;">
          <div>
            <div style="font-size:16px;font-weight:700;color:var(--ink);">${order.institutionName || "Institutional Account"}</div>
            <div style="font-size:13px;color:var(--muted);">${order.departmentName || order.department}</div>
            <div style="font-size:12px;color:var(--bronze-700);margin-top:2px;">Care of: ${order.careOfContact || order.careOf || "Authorized Rep"}</div>
          </div>
          <div style="text-align:right;">
            <div style="font-family:var(--font-mono);font-size:16px;font-weight:700;color:var(--ink);">₹${((order.totalPaisa || (order.amount ? order.amount * 100 : 0)) / 100).toLocaleString("en-IN", { minimumFractionDigits: 2 })}</div>
            <div style="font-size:12px;font-weight:600;color:${balance > 0 ? "var(--warning)" : "var(--success)"};">Outstanding: ₹${(balance / 100).toLocaleString("en-IN", { minimumFractionDigits: 2 })}</div>
          </div>
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
          <div style="padding:10px;background:var(--surface);border:1px solid var(--border-color,#e2e8f0);border-radius:6px;">
            <div style="font-size:11px;color:var(--muted);text-transform:uppercase;font-weight:600;">Fulfilment Status</div>
            <div style="font-weight:700;color:var(--ink);margin-top:2px;">${order.fulfilmentStatus || "SCHEDULED"}</div>
            <div style="font-size:11px;color:var(--muted);">${order.fulfilmentDate || order.orderDate} (${order.promisedTimeWindow || "10:00 AM"})</div>
          </div>
          <div style="padding:10px;background:var(--surface);border:1px solid var(--border-color,#e2e8f0);border-radius:6px;">
            <div style="font-size:11px;color:var(--muted);text-transform:uppercase;font-weight:600;">PO &amp; Authorization</div>
            <div style="font-weight:700;color:var(--ink);margin-top:2px;">${order.poNumber || "Direct Authorization"}</div>
            <div style="font-size:11px;color:var(--muted);">Headcount: ${order.headcount?.final || 20} Guests</div>
          </div>
        </div>

        <div>
          <div style="font-weight:700;font-size:13px;margin-bottom:6px;color:var(--ink);">Catering Items:</div>
          <div style="padding:10px;background:var(--background);border-radius:6px;font-size:13px;">
            ${Array.isArray(order.items) ? order.items.map((i) => `<div>• ${i.quantity}× ${i.name} — ₹${(i.totalPaisa / 100).toLocaleString("en-IN")}</div>`).join("") : order.items || "Standard Catering Pack"}
          </div>
        </div>
      </div>
    `,
  });
}

function openFulfilModal(orderId, root) {
  openModal({
    title: `Confirm Fulfilment — ${orderId}`,
    maxWidth: "500px",
    body: `
      <form id="fulfil-form" style="display:flex;flex-direction:column;gap:14px;">
        <div class="field">
          <label class="label" style="font-weight:600;">Receiving Person Name *</label>
          <input type="text" id="receiving-name" class="input" placeholder="e.g. Dr. K. S. Namboodiri / Staff Rep" required />
        </div>
        <div class="field">
          <label class="label" style="font-weight:600;">Discrepancy Notes (if any)</label>
          <textarea id="discrepancy-notes" class="textarea" rows="2" placeholder="Leave blank if fulfilled in full as requested"></textarea>
        </div>
      </form>
    `,
    saveLabel: "Record Fulfilment",
    onSave: async (modalEl) => {
      const receivingName = modalEl.querySelector("#receiving-name")?.value?.trim();
      const notes = modalEl.querySelector("#discrepancy-notes")?.value?.trim();
      if (!receivingName) {
        showToast("Receiving contact name is required", "coral");
        return false;
      }
      try {
        await apiPost(`/department-orders/${orderId}/fulfil`, {
          body: { receivingContactName: receivingName, discrepancyNotes: notes },
        });
        showToast(`Order ${orderId} marked as fulfilled!`, "mint");
        await fetchDeptOrdersFromServer(root);
        return true;
      } catch (err) {
        showToast(err.message || "Failed to confirm fulfilment", "coral");
        return false;
      }
    },
  });
}

function openSettleModal(orderId, root) {
  const orders = liveOrders || SAMPLE_ORDERS;
  const order = orders.find((o) => o.orderId === orderId);
  const balance = order ? Math.max(0, (order.totalPaisa || 0) - (order.settledPaisa || 0)) : 500000;

  openModal({
    title: `Record Institutional Settlement — ${orderId}`,
    maxWidth: "500px",
    body: `
      <form id="settle-form" style="display:flex;flex-direction:column;gap:14px;">
        <div style="padding:10px;background:var(--background);border-radius:6px;font-size:13px;">
          Outstanding Balance: <strong style="color:var(--warning);">₹${(balance / 100).toLocaleString("en-IN", { minimumFractionDigits: 2 })}</strong>
        </div>
        <div class="field">
          <label class="label" style="font-weight:600;">Settlement Amount (₹) *</label>
          <input type="number" id="settle-amount" class="input" value="${balance / 100}" max="${balance / 100}" min="1" required />
        </div>
        <div class="field">
          <label class="label" style="font-weight:600;">Payment Method *</label>
          <select id="settle-method" class="select" required>
            <option value="BANK_TRANSFER">Bank Transfer (NEFT / RTGS)</option>
            <option value="UPI">Institutional UPI</option>
            <option value="CHEQUE">Institutional Cheque</option>
            <option value="CREDIT_NOTE">Credit Note Offset</option>
          </select>
        </div>
        <div class="field">
          <label class="label" style="font-weight:600;">Transaction Reference / Cheque #</label>
          <input type="text" id="settle-ref" class="input" placeholder="e.g. UTR893274928" />
        </div>
      </form>
    `,
    saveLabel: "Post Settlement",
    onSave: async (modalEl) => {
      const amt = Number(modalEl.querySelector("#settle-amount")?.value || 0);
      const method = modalEl.querySelector("#settle-method")?.value;
      const ref = modalEl.querySelector("#settle-ref")?.value?.trim();

      if (amt <= 0) {
        showToast("Enter a valid settlement amount", "coral");
        return false;
      }
      try {
        await apiPost(`/department-orders/${orderId}/settle`, {
          body: { amountPaisa: amt * 100, paymentMethod: method, paymentReference: ref },
        });
        showToast(`Settlement posted for order ${orderId}!`, "mint");
        await fetchDeptOrdersFromServer(root);
        return true;
      } catch (err) {
        showToast(err.message || "Failed to record settlement", "coral");
        return false;
      }
    },
  });
}

function openOrderSheetModal(orderId) {
  const orders = liveOrders || SAMPLE_ORDERS;
  const order = orders.find((o) => o.orderId === orderId) || orders[0];

  openModal({
    title: `Institutional Order Sheet — ${order.orderId}`,
    maxWidth: "600px",
    body: `
      <div style="border:2px dashed var(--border-color, #cbd5e1);padding:20px;background:#fff;color:#000;font-family:sans-serif;">
        <div style="text-align:center;border-bottom:1px solid #000;padding-bottom:10px;margin-bottom:12px;">
          <h2 style="margin:0;font-size:20px;font-weight:800;letter-spacing:1px;">ZAMORIN CAFÉ</h2>
          <div style="font-size:12px;font-weight:600;text-transform:uppercase;">Institutional Catering Order Sheet</div>
        </div>
        <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:10px;">
          <div><strong>Order #:</strong> ${order.orderId}</div>
          <div><strong>Date:</strong> ${order.fulfilmentDate || order.orderDate}</div>
        </div>
        <div style="font-size:12px;margin-bottom:6px;"><strong>Institution:</strong> ${order.institutionName || "University / Corporate"}</div>
        <div style="font-size:12px;margin-bottom:6px;"><strong>Department:</strong> ${order.departmentName || order.department}</div>
        <div style="font-size:12px;margin-bottom:10px;"><strong>Care Of:</strong> ${order.careOfContact || order.careOf || "Authorized Rep"}</div>
        <div style="font-size:12px;margin-bottom:10px;"><strong>PO #:</strong> ${order.poNumber || "Direct"}</div>
        <div style="border-top:1px solid #000;border-bottom:1px solid #000;padding:8px 0;margin-bottom:12px;font-size:12px;">
          <strong>Items Catered:</strong><br/>
          ${Array.isArray(order.items) ? order.items.map((i) => `${i.quantity}× ${i.name}`).join("<br/>") : order.items}
        </div>
        <div style="text-align:right;font-size:14px;font-weight:700;margin-bottom:20px;">
          Total Billed: ₹${((order.totalPaisa || (order.amount ? order.amount * 100 : 0)) / 100).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
        </div>
        <div style="display:flex;justify-content:space-between;margin-top:30px;font-size:11px;">
          <div style="border-top:1px solid #000;padding-top:4px;width:40%;text-align:center;">Prepared By (Café)</div>
          <div style="border-top:1px solid #000;padding-top:4px;width:40%;text-align:center;">Received By (Care Of)</div>
        </div>
      </div>
    `,
  });
}

function refreshDeptView(root) {
  const activeId = document.activeElement?.id || null;
  const cursorStart = document.activeElement?.selectionStart;
  const cursorEnd = document.activeElement?.selectionEnd;
  const container = root.querySelector("#view-root") || root;
  container.innerHTML = renderDepartmentOrders();
  wireDepartmentOrders(container);
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

async function fetchDeptOrdersFromServer(root) {
  try {
    const res = await apiGet("/department-orders?limit=50");
    if (res && res.data && res.data.orders) {
      liveOrders = res.data.orders;
      showToast("Institutional orders refreshed", "mint");
      refreshDeptView(root);
    }
  } catch (err) {
    showToast(err?.message || "Could not refresh department orders.", "error");
  }
}
