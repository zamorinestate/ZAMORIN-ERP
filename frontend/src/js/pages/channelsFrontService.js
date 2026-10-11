import { apiGet, apiPost, apiPatch } from "../apiClient.js";
import { state } from "../state.js";
import { showToast, openModal, renderCafeContextStrip, renderModuleErrorState } from "../components.js";
import { ROLES } from "../navigation.js";

let activeSubTab = "tables"; // 'tables' | 'reservations' | 'orders' | 'pickup' | 'config'
let cachedTables = [];
let cachedReservations = [];
let cachedWaitlist = [];
let cachedOrders = [];
let cachedTokens = [];
let cachedConfig = null;
let cachedCafeId = "ZC-0001";

export function setChannelsActiveTab(tab) {
  activeSubTab = tab || "tables";
}

export function renderChannelsFrontService(subroute) {
  if (subroute) {
    activeSubTab = subroute;
  }
  const isOwner = state.user?.role === ROLES.OWNER;
  const isMaster = state.user?.role === ROLES.MASTER;

  return `
    <div class="page-enter" style="max-width:1440px; margin:0 auto; padding-bottom:60px;">
      ${renderCafeContextStrip()}
      
      <!-- Top Header & Hero -->
      <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:24px; flex-wrap:wrap; gap:16px;">
        <div>
          <div style="display:flex; align-items:center; gap:10px; margin-bottom:6px;">
            <span style="font-size:24px; font-weight:700; color:var(--ink, #16223F); font-family:var(--font-serif, serif);">
              Channels, QR Ordering & Front Service
            </span>
            <span style="background:rgba(212,175,55,0.15); color:#8C6D1F; font-size:11px; font-weight:700; padding:3px 8px; border-radius:12px; letter-spacing:0.5px; border:1px solid rgba(212,175,55,0.3);">
              P15 ACTIVE
            </span>
          </div>
          <p style="margin:0; font-size:13px; color:var(--ink-muted, #64748B);">
            Universal table QR ordering, host desk reservations, live channel intake (POS, Web, Aggregators), and takeaway pickup tokens.
          </p>
        </div>

        <div style="display:flex; align-items:center; gap:10px;">
          <button id="btn-refresh-channels" class="btn" style="background:var(--surface, #FFFFFF); border:1px solid var(--line, #E2E8F0); padding:8px 14px; font-size:12px; border-radius:8px; cursor:pointer; display:flex; align-items:center; gap:6px;">
            <span>🔄</span> Refresh Data
          </button>
          ${!isOwner ? `
            <button id="btn-quick-new-res" class="btn" style="background:#16223F; color:#FFFFFF; border:none; padding:8px 14px; font-size:12px; font-weight:600; border-radius:8px; cursor:pointer; display:flex; align-items:center; gap:6px;">
              <span>📅</span> New Booking
            </button>
            <button id="btn-quick-waitlist" class="btn" style="background:#D4AF37; color:#16223F; border:none; padding:8px 14px; font-size:12px; font-weight:700; border-radius:8px; cursor:pointer; display:flex; align-items:center; gap:6px;">
              <span>⏱️</span> Add to Waitlist
            </button>
          ` : `
            <span style="font-size:12px; color:var(--ink-muted, #64748B); background:rgba(0,0,0,0.04); padding:6px 12px; border-radius:6px; font-weight:500;">
              👁️ Owner Portal (Read-Only)
            </span>
          `}
        </div>
      </div>

      <!-- Navigation Tabs -->
      <div style="display:flex; border-bottom:1px solid var(--line, #E2E8F0); margin-bottom:24px; gap:8px; overflow-x:auto;">
        <button class="channel-tab-btn ${activeSubTab === 'tables' ? 'active-tab' : ''}" data-tab="tables" style="padding:10px 16px; border:none; background:none; font-size:13px; font-weight:600; cursor:pointer; border-bottom:${activeSubTab === 'tables' ? '2px solid #D4AF37' : '2px solid transparent'}; color:${activeSubTab === 'tables' ? '#16223F' : '#64748B'};">
          🍽️ Dining Tables & QR Codes
        </button>
        <button class="channel-tab-btn ${activeSubTab === 'reservations' ? 'active-tab' : ''}" data-tab="reservations" style="padding:10px 16px; border:none; background:none; font-size:13px; font-weight:600; cursor:pointer; border-bottom:${activeSubTab === 'reservations' ? '2px solid #D4AF37' : '2px solid transparent'}; color:${activeSubTab === 'reservations' ? '#16223F' : '#64748B'};">
          📋 Host Desk (Bookings & Waitlist)
        </button>
        <button class="channel-tab-btn ${activeSubTab === 'orders' ? 'active-tab' : ''}" data-tab="orders" style="padding:10px 16px; border:none; background:none; font-size:13px; font-weight:600; cursor:pointer; border-bottom:${activeSubTab === 'orders' ? '2px solid #D4AF37' : '2px solid transparent'}; color:${activeSubTab === 'orders' ? '#16223F' : '#64748B'};">
          🚀 Live Channel Orders Feed
        </button>
        <button class="channel-tab-btn ${activeSubTab === 'pickup' ? 'active-tab' : ''}" data-tab="pickup" style="padding:10px 16px; border:none; background:none; font-size:13px; font-weight:600; cursor:pointer; border-bottom:${activeSubTab === 'pickup' ? '2px solid #D4AF37' : '2px solid transparent'}; color:${activeSubTab === 'pickup' ? '#16223F' : '#64748B'};">
          🏷️ Pickup Tokens & Customer Display
        </button>
        <button class="channel-tab-btn ${activeSubTab === 'config' ? 'active-tab' : ''}" data-tab="config" style="padding:10px 16px; border:none; background:none; font-size:13px; font-weight:600; cursor:pointer; border-bottom:${activeSubTab === 'config' ? '2px solid #D4AF37' : '2px solid transparent'}; color:${activeSubTab === 'config' ? '#16223F' : '#64748B'};">
          ⚙️ Channel Config & Reconciliation
        </button>
      </div>

      <!-- Tab Content Mount Root -->
      <div id="channels-panel-root">
        ${renderActiveTabContent()}
      </div>
    </div>
  `;
}

function renderActiveTabContent() {
  switch (activeSubTab) {
    case "tables":
      return renderTablesTab();
    case "reservations":
      return renderReservationsTab();
    case "orders":
      return renderOrdersTab();
    case "pickup":
      return renderPickupTab();
    case "config":
      return renderConfigTab();
    default:
      return renderTablesTab();
  }
}

function renderTablesTab() {
  const isOwner = state.user?.role === ROLES.OWNER;
  return `
    <div>
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px;">
        <div>
          <h3 style="margin:0 0 4px 0; font-size:16px; font-weight:700; color:#16223F;">Café Dining Tables & Live Sessions</h3>
          <p style="margin:0; font-size:12px; color:#64748B;">Floor status, active guest QR sessions, multi-round ordering rounds, and instant billing.</p>
        </div>
        ${!isOwner ? `
          <button id="btn-add-table" class="btn" style="background:#16223F; color:#FFFFFF; border:none; padding:7px 12px; font-size:12px; font-weight:600; border-radius:6px; cursor:pointer;">
            ➕ Add Dining Table
          </button>
        ` : ''}
      </div>

      <div id="tables-grid" style="display:grid; grid-template-columns:repeat(auto-fill, minmax(280px, 1fr)); gap:16px;">
        <div style="padding:24px; text-align:center; color:#64748B; background:#FFFFFF; border:1px solid #E2E8F0; border-radius:10px; grid-column:1/-1;">
          Loading dining tables...
        </div>
      </div>
    </div>
  `;
}

function renderReservationsTab() {
  return `
    <div style="display:grid; grid-template-columns:1fr 1fr; gap:24px;">
      <!-- Column 1: Today's Bookings -->
      <div style="background:#FFFFFF; border:1px solid #E2E8F0; border-radius:10px; padding:20px;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:14px;">
          <h3 style="margin:0; font-size:15px; font-weight:700; color:#16223F;">Confirmed Reservations</h3>
          <span id="res-count-badge" style="background:rgba(212,175,55,0.15); color:#8C6D1F; font-size:11px; font-weight:700; padding:2px 8px; border-radius:10px;">0 Today</span>
        </div>
        <div id="reservations-list" style="display:flex; flex-direction:column; gap:10px; max-height:550px; overflow-y:auto;">
          <div style="padding:20px; text-align:center; color:#64748B; font-size:13px;">Loading reservations...</div>
        </div>
      </div>

      <!-- Column 2: Walk-In Waitlist -->
      <div style="background:#FFFFFF; border:1px solid #E2E8F0; border-radius:10px; padding:20px;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:14px;">
          <h3 style="margin:0; font-size:15px; font-weight:700; color:#16223F;">Live Waitlist Queue</h3>
          <span id="waitlist-count-badge" style="background:#EFF6FF; color:#1D4ED8; font-size:11px; font-weight:700; padding:2px 8px; border-radius:10px;">0 Waiting</span>
        </div>
        <div id="waitlist-list" style="display:flex; flex-direction:column; gap:10px; max-height:550px; overflow-y:auto;">
          <div style="padding:20px; text-align:center; color:#64748B; font-size:13px;">Loading waitlist queue...</div>
        </div>
      </div>
    </div>
  `;
}

function renderOrdersTab() {
  return `
    <div style="background:#FFFFFF; border:1px solid #E2E8F0; border-radius:10px; padding:20px;">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px; flex-wrap:wrap; gap:10px;">
        <div>
          <h3 style="margin:0 0 4px 0; font-size:16px; font-weight:700; color:#16223F;">Incoming Channel Orders</h3>
          <p style="margin:0; font-size:12px; color:#64748B;">Live unified feed from QR Table Orders, Direct Web, Zomato, and Swiggy.</p>
        </div>
        <div style="display:flex; gap:8px;">
          <select id="filter-order-status" style="padding:6px 10px; font-size:12px; border:1px solid #CBD5E1; border-radius:6px;">
            <option value="">All Statuses</option>
            <option value="RECEIVED">Received</option>
            <option value="ACCEPTED">Accepted</option>
            <option value="PREPARING">Preparing</option>
            <option value="READY_FOR_PICKUP">Ready for Pickup</option>
            <option value="COMPLETED">Completed</option>
          </select>
          <select id="filter-order-channel" style="padding:6px 10px; font-size:12px; border:1px solid #CBD5E1; border-radius:6px;">
            <option value="">All Channels</option>
            <option value="QR_ORDER">QR Table</option>
            <option value="DIRECT_WEB">Direct Web</option>
            <option value="AGGREGATOR">Aggregators (Zomato/Swiggy)</option>
          </select>
        </div>
      </div>

      <div id="orders-list-table">
        <div style="padding:24px; text-align:center; color:#64748B; font-size:13px;">Loading orders...</div>
      </div>
    </div>
  `;
}

function renderPickupTab() {
  return `
    <div style="display:grid; grid-template-columns:1fr 1fr; gap:24px;">
      <!-- Active Pickup Tokens -->
      <div style="background:#FFFFFF; border:1px solid #E2E8F0; border-radius:10px; padding:20px;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:14px;">
          <h3 style="margin:0; font-size:15px; font-weight:700; color:#16223F;">Active Pickup Tokens</h3>
          <span style="font-size:11px; background:#F8FAFC; padding:3px 8px; border-radius:6px; color:#64748B;">Today's Counter</span>
        </div>
        <div id="pickup-tokens-list" style="display:flex; flex-direction:column; gap:10px;">
          <div style="padding:20px; text-align:center; color:#64748B; font-size:13px;">Loading pickup tokens...</div>
        </div>
      </div>

      <!-- Public Display Preview -->
      <div style="background:#16223F; color:#FFFFFF; border-radius:10px; padding:24px; box-shadow:0 4px 12px rgba(0,0,0,0.15);">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px;">
          <div>
            <h3 style="margin:0 0 4px 0; font-size:16px; font-weight:700; color:#D4AF37;">Customer Order Status Screen</h3>
            <span style="font-size:11px; color:#94A3B8;">Public Projection Preview (Zero PII Guaranteed)</span>
          </div>
          <span style="background:rgba(212,175,55,0.2); color:#D4AF37; font-size:11px; font-weight:700; padding:3px 8px; border-radius:8px;">
            PUBLIC DISPLAY
          </span>
        </div>

        <div style="display:grid; grid-template-columns:1fr 1fr; gap:16px; margin-top:20px;">
          <div style="background:rgba(255,255,255,0.06); padding:16px; border-radius:8px; border:1px solid rgba(255,255,255,0.1);">
            <div style="font-size:13px; font-weight:700; color:#FBBF24; margin-bottom:12px; letter-spacing:0.5px;">PREPARING NOW</div>
            <div id="public-display-preparing" style="display:flex; flex-wrap:wrap; gap:8px;">
              <span style="font-size:12px; color:#94A3B8;">None in queue</span>
            </div>
          </div>

          <div style="background:rgba(255,255,255,0.06); padding:16px; border-radius:8px; border:1px solid rgba(255,255,255,0.1);">
            <div style="font-size:13px; font-weight:700; color:#34D399; margin-bottom:12px; letter-spacing:0.5px;">READY FOR PICKUP</div>
            <div id="public-display-ready" style="display:flex; flex-wrap:wrap; gap:8px;">
              <span style="font-size:12px; color:#94A3B8;">None ready</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderConfigTab() {
  const isOwner = state.user?.role === ROLES.OWNER;
  return `
    <div style="background:#FFFFFF; border:1px solid #E2E8F0; border-radius:10px; padding:24px; max-width:800px;">
      <h3 style="margin:0 0 6px 0; font-size:16px; font-weight:700; color:#16223F;">Channel Operations & Marketplace Reconciliation</h3>
      <p style="margin:0 0 20px 0; font-size:12px; color:#64748B;">Configure direct online ordering policies and reconcile aggregator settlements.</p>

      <form id="form-channel-config" style="display:flex; flex-direction:column; gap:18px;">
        <div style="border-bottom:1px solid #E2E8F0; padding-bottom:14px;">
          <label style="display:flex; align-items:center; gap:8px; font-weight:600; font-size:13px; color:#16223F; cursor:pointer;">
            <input type="checkbox" id="cfg-qr-enabled" ${isOwner ? 'disabled' : ''} checked />
            Enable Universal QR Table Ordering
          </label>
          <span style="font-size:11px; color:#64748B; margin-left:24px; display:block;">Allows guests to scan table QR codes and submit multi-round orders from their phones.</span>
        </div>

        <div style="border-bottom:1px solid #E2E8F0; padding-bottom:14px;">
          <label style="display:flex; align-items:center; gap:8px; font-weight:600; font-size:13px; color:#16223F; cursor:pointer;">
            <input type="checkbox" id="cfg-web-enabled" ${isOwner ? 'disabled' : ''} checked />
            Enable Direct Web Ordering (Takeaway & Delivery)
          </label>
          <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-top:10px; margin-left:24px;">
            <div>
              <label style="font-size:11px; color:#64748B; display:block; margin-bottom:4px;">Packaging Fee (₹)</label>
              <input type="number" id="cfg-packaging-fee" value="15" ${isOwner ? 'disabled' : ''} style="width:100%; padding:6px 10px; font-size:12px; border:1px solid #CBD5E1; border-radius:6px;" />
            </div>
            <div>
              <label style="font-size:11px; color:#64748B; display:block; margin-bottom:4px;">Delivery Fee (₹)</label>
              <input type="number" id="cfg-delivery-fee" value="40" ${isOwner ? 'disabled' : ''} style="width:100%; padding:6px 10px; font-size:12px; border:1px solid #CBD5E1; border-radius:6px;" />
            </div>
          </div>
        </div>

        <div style="border-bottom:1px solid #E2E8F0; padding-bottom:14px;">
          <div style="font-size:13px; font-weight:700; color:#16223F; margin-bottom:8px;">Marketplace Aggregators</div>
          <div style="display:flex; gap:20px;">
            <label style="display:flex; align-items:center; gap:8px; font-size:12px; color:#16223F; cursor:pointer;">
              <input type="checkbox" id="cfg-zomato-enabled" ${isOwner ? 'disabled' : ''} checked />
              Zomato Integration Active
            </label>
            <label style="display:flex; align-items:center; gap:8px; font-size:12px; color:#16223F; cursor:pointer;">
              <input type="checkbox" id="cfg-swiggy-enabled" ${isOwner ? 'disabled' : ''} checked />
              Swiggy Integration Active
            </label>
          </div>
        </div>

        ${!isOwner ? `
          <button type="submit" class="btn" style="background:#16223F; color:#FFFFFF; border:none; padding:10px 16px; font-size:13px; font-weight:600; border-radius:6px; cursor:pointer; align-self:flex-start;">
            Save Channel Settings
          </button>
        ` : ''}
      </form>
    </div>
  `;
}

export function wireChannelsFrontService() {
  cachedCafeId = state.cafeContext?.cafeId || state.user?.primaryCafeId || "ZC-0001";

  // Tab switching
  const tabBtns = document.querySelectorAll(".channel-tab-btn");
  tabBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      const targetTab = btn.getAttribute("data-tab");
      setChannelsActiveTab(targetTab);
      const root = document.getElementById("channels-panel-root");
      if (root) {
        root.innerHTML = renderActiveTabContent();
        tabBtns.forEach((b) => {
          const isActive = b.getAttribute("data-tab") === targetTab;
          b.style.borderBottom = isActive ? "2px solid #D4AF37" : "2px solid transparent";
          b.style.color = isActive ? "#16223F" : "#64748B";
        });
        loadActiveTabData();
      }
    });
  });

  // Global action buttons
  const refreshBtn = document.getElementById("btn-refresh-channels");
  if (refreshBtn) {
    refreshBtn.addEventListener("click", () => {
      loadActiveTabData();
      showToast("Data refreshed.", "success");
    });
  }

  const newResBtn = document.getElementById("btn-quick-new-res");
  if (newResBtn) {
    newResBtn.addEventListener("click", openNewReservationModal);
  }

  const waitlistBtn = document.getElementById("btn-quick-waitlist");
  if (waitlistBtn) {
    waitlistBtn.addEventListener("click", openAddWaitlistModal);
  }

  loadActiveTabData();
}

async function loadActiveTabData() {
  if (activeSubTab === "tables") {
    await fetchTables();
  } else if (activeSubTab === "reservations") {
    await fetchReservationsAndWaitlist();
  } else if (activeSubTab === "orders") {
    await fetchOrders();
  } else if (activeSubTab === "pickup") {
    await fetchPickupTokens();
  } else if (activeSubTab === "config") {
    await fetchConfig();
  }
}

async function fetchTables() {
  const container = document.getElementById("tables-grid");
  if (!container) return;

  try {
    const res = await apiGet(`/api/v1/channels/tables?cafeId=${cachedCafeId}`);
    cachedTables = res.data || [];
    renderTablesGrid(cachedTables);
  } catch (err) {
    container.innerHTML = `<div style="padding:20px; color:#EF4444; text-align:center;">Failed to load tables: ${err.message}</div>`;
  }
}

function renderTablesGrid(tables) {
  const container = document.getElementById("tables-grid");
  if (!container) return;

  if (tables.length === 0) {
    container.innerHTML = `
      <div style="padding:32px; text-align:center; color:#64748B; background:#FFFFFF; border:1px solid #E2E8F0; border-radius:10px; grid-column:1/-1;">
        No dining tables registered for this café. Click "+ Add Dining Table" to create one.
      </div>
    `;
    return;
  }

  const isOwner = state.user?.role === ROLES.OWNER;

  container.innerHTML = tables.map((t) => {
    const isOccupied = t.status === "OCCUPIED";
    const statusBg = isOccupied ? "#FEE2E2" : (t.status === "RESERVED" ? "#FEF3C7" : "#DCFCE7");
    const statusColor = isOccupied ? "#991B1B" : (t.status === "RESERVED" ? "#92400E" : "#166534");

    return `
      <div style="background:#FFFFFF; border:1px solid #E2E8F0; border-radius:10px; padding:16px; display:flex; flex-direction:column; justify-content:space-between; box-shadow:0 1px 3px rgba(0,0,0,0.05);">
        <div>
          <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:8px;">
            <div>
              <span style="font-size:18px; font-weight:800; color:#16223F;">Table ${t.tableNumber}</span>
              <span style="font-size:11px; color:#64748B; display:block;">${t.section} • Capacity: ${t.seatingCapacity} covers</span>
            </div>
            <span style="background:${statusBg}; color:${statusColor}; font-size:11px; font-weight:700; padding:2px 8px; border-radius:10px;">
              ${t.status}
            </span>
          </div>

          ${t.activeSession ? `
            <div style="background:#F8FAFC; border:1px solid #E2E8F0; border-radius:6px; padding:10px; margin-top:8px;">
              <div style="display:flex; justify-content:space-between; font-size:12px; font-weight:600; color:#16223F;">
                <span>Session: ${t.activeSession.sessionId.slice(-6)}</span>
                <span>₹${((t.activeSession.cumulativeTotalPaisa || 0) / 100).toFixed(2)}</span>
              </div>
              <div style="font-size:11px; color:#64748B; margin-top:4px;">
                Rounds: ${t.activeSession.roundsCount} • Covers: ${t.activeSession.covers}
              </div>
            </div>
          ` : `
            <div style="font-size:11px; color:#94A3B8; margin-top:12px;">No active dining session</div>
          `}
        </div>

        <div style="display:flex; gap:6px; margin-top:14px; border-top:1px solid #F1F5F9; padding-top:12px;">
          ${!isOwner ? `
            ${isOccupied ? `
              <button class="btn-bill-table" data-session="${t.activeSessionId}" style="flex:1; background:#16223F; color:#FFFFFF; border:none; padding:6px 10px; font-size:11px; font-weight:600; border-radius:6px; cursor:pointer;">
                💵 Settle & Bill
              </button>
            ` : `
              <button class="btn-open-session" data-table="${t.tableId}" style="flex:1; background:#F1F5F9; color:#16223F; border:1px solid #CBD5E1; padding:6px 10px; font-size:11px; font-weight:600; border-radius:6px; cursor:pointer;">
                ▶ Open Session
              </button>
            `}
            <button class="btn-qr-table" data-table="${t.tableId}" data-num="${t.tableNumber}" style="background:#FFFFFF; border:1px solid #CBD5E1; padding:6px 10px; font-size:11px; border-radius:6px; cursor:pointer;">
              📱 QR Code
            </button>
          ` : `
            <span style="font-size:11px; color:#94A3B8;">Read-Only</span>
          `}
        </div>
      </div>
    `;
  }).join("");

  // Wire table buttons
  document.querySelectorAll(".btn-qr-table").forEach((btn) => {
    btn.addEventListener("click", () => {
      const tableId = btn.getAttribute("data-table");
      const tableNumber = btn.getAttribute("data-num");
      openTableQrModal(tableId, tableNumber);
    });
  });

  document.querySelectorAll(".btn-open-session").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const tableId = btn.getAttribute("data-table");
      try {
        await apiPost("/api/v1/channels/tables/session/open", {
          tableId,
          cafeId: cachedCafeId,
          covers: 2,
        });
        showToast("Session opened.", "success");
        fetchTables();
      } catch (err) {
        showToast(err.message, "error");
      }
    });
  });

  document.querySelectorAll(".btn-bill-table").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const sessionId = btn.getAttribute("data-session");
      try {
        const res = await apiPost("/api/v1/channels/tables/session/close", {
          sessionId,
          cafeId: cachedCafeId,
          paymentMethod: "CASH",
        });
        showToast(`Billed successfully. Invoice: ${res.data.bill.billId}`, "success");
        fetchTables();
      } catch (err) {
        showToast(err.message, "error");
      }
    });
  });

  const addTableBtn = document.getElementById("btn-add-table");
  if (addTableBtn) {
    addTableBtn.addEventListener("click", openAddTableModal);
  }
}

async function fetchReservationsAndWaitlist() {
  try {
    const res = await apiGet(`/api/v1/channels/reservations?cafeId=${cachedCafeId}`);
    const summary = res.data || {};
    cachedReservations = summary.reservations || [];
    cachedWaitlist = summary.waitlistQueue || [];

    const resBadge = document.getElementById("res-count-badge");
    if (resBadge) resBadge.textContent = `${cachedReservations.length} Today`;

    const wlBadge = document.getElementById("waitlist-count-badge");
    if (wlBadge) wlBadge.textContent = `${cachedWaitlist.length} Waiting`;

    renderReservationsList(cachedReservations);
    renderWaitlistQueue(cachedWaitlist);
  } catch (err) {
    console.error("Failed to load host desk summary:", err);
  }
}

function renderReservationsList(reservations) {
  const container = document.getElementById("reservations-list");
  if (!container) return;

  if (reservations.length === 0) {
    container.innerHTML = `<div style="padding:20px; text-align:center; color:#64748B; font-size:13px;">No reservations booked for today.</div>`;
    return;
  }

  const isOwner = state.user?.role === ROLES.OWNER;

  container.innerHTML = reservations.map((r) => {
    const timeStr = new Date(r.bookingTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return `
      <div style="border:1px solid #E2E8F0; border-radius:8px; padding:12px; display:flex; justify-content:space-between; align-items:center;">
        <div>
          <div style="font-weight:700; color:#16223F; font-size:13px;">${r.guestName} (${r.partySize} guests)</div>
          <div style="font-size:11px; color:#64748B;">
            ⏰ ${timeStr} • 📞 ${r.guestPhone} • Table: ${r.assignedTableNumber || 'Not assigned'}
          </div>
        </div>
        <div style="display:flex; align-items:center; gap:8px;">
          <span style="font-size:11px; font-weight:700; padding:2px 8px; border-radius:6px; background:#F1F5F9; color:#16223F;">
            ${r.status}
          </span>
          ${!isOwner && r.status === 'CONFIRMED' ? `
            <button class="btn-checkin-res" data-id="${r.reservationId}" style="background:#16223F; color:#FFFFFF; border:none; padding:4px 8px; font-size:11px; border-radius:4px; cursor:pointer;">
              Check In
            </button>
          ` : ''}
        </div>
      </div>
    `;
  }).join("");

  document.querySelectorAll(".btn-checkin-res").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-id");
      try {
        await apiPatch(`/api/v1/channels/reservations/${id}/status`, {
          status: "CHECKED_IN",
          cafeId: cachedCafeId,
        });
        showToast("Guest checked in.", "success");
        fetchReservationsAndWaitlist();
      } catch (err) {
        showToast(err.message, "error");
      }
    });
  });
}

function renderWaitlistQueue(queue) {
  const container = document.getElementById("waitlist-list");
  if (!container) return;

  if (queue.length === 0) {
    container.innerHTML = `<div style="padding:20px; text-align:center; color:#64748B; font-size:13px;">Waitlist is currently empty.</div>`;
    return;
  }

  const isOwner = state.user?.role === ROLES.OWNER;

  container.innerHTML = queue.map((q) => {
    return `
      <div style="border:1px solid #E2E8F0; border-radius:8px; padding:12px; display:flex; justify-content:space-between; align-items:center;">
        <div>
          <div style="display:flex; align-items:center; gap:8px;">
            <span style="background:#EFF6FF; color:#1D4ED8; font-weight:800; font-size:12px; padding:2px 6px; border-radius:4px;">
              ${q.queueNumber}
            </span>
            <span style="font-weight:700; color:#16223F; font-size:13px;">${q.guestName} (${q.partySize}p)</span>
          </div>
          <div style="font-size:11px; color:#64748B; margin-top:2px;">
            Est. wait: ${q.estimatedWaitMinutes}m • 📞 ${q.guestPhone}
          </div>
        </div>
        <div>
          ${!isOwner ? `
            <button class="btn-seat-waitlist" data-id="${q.waitlistId}" style="background:#D4AF37; color:#16223F; border:none; padding:5px 10px; font-size:11px; font-weight:700; border-radius:4px; cursor:pointer;">
              Seat Party
            </button>
          ` : ''}
        </div>
      </div>
    `;
  }).join("");

  document.querySelectorAll(".btn-seat-waitlist").forEach((btn) => {
    btn.addEventListener("click", () => {
      const waitlistId = btn.getAttribute("data-id");
      openSeatWaitlistModal(waitlistId);
    });
  });
}

async function fetchOrders() {
  const container = document.getElementById("orders-list-table");
  if (!container) return;

  try {
    const res = await apiGet(`/api/v1/channels/orders?cafeId=${cachedCafeId}`);
    cachedOrders = res.data || [];
    renderOrdersFeed(cachedOrders);
  } catch (err) {
    container.innerHTML = `<div style="padding:20px; color:#EF4444; text-align:center;">Failed to load orders: ${err.message}</div>`;
  }
}

function renderOrdersFeed(orders) {
  const container = document.getElementById("orders-list-table");
  if (!container) return;

  if (orders.length === 0) {
    container.innerHTML = `<div style="padding:32px; text-align:center; color:#64748B; font-size:13px;">No orders found in feed.</div>`;
    return;
  }

  const isOwner = state.user?.role === ROLES.OWNER;

  container.innerHTML = `
    <table style="width:100%; border-collapse:collapse; font-size:12px; text-align:left;">
      <thead>
        <tr style="border-bottom:1px solid #E2E8F0; color:#64748B; font-weight:600;">
          <th style="padding:8px;">Order #</th>
          <th style="padding:8px;">Channel</th>
          <th style="padding:8px;">Customer</th>
          <th style="padding:8px;">Items</th>
          <th style="padding:8px;">Amount</th>
          <th style="padding:8px;">Status</th>
          ${!isOwner ? `<th style="padding:8px;">Actions</th>` : ''}
        </tr>
      </thead>
      <tbody>
        ${orders.map((o) => `
          <tr style="border-bottom:1px solid #F1F5F9;">
            <td style="padding:8px; font-weight:700; color:#16223F;">${o.orderNumber}</td>
            <td style="padding:8px;"><span style="background:#F1F5F9; padding:2px 6px; border-radius:4px; font-size:10px;">${o.channel}</span></td>
            <td style="padding:8px;">${o.customer?.name || 'Guest'}</td>
            <td style="padding:8px;">${(o.lineItems || []).length} items</td>
            <td style="padding:8px; font-weight:600;">₹${((o.pricing?.totalPaisa || 0) / 100).toFixed(2)}</td>
            <td style="padding:8px;"><span style="font-weight:700; font-size:11px;">${o.status}</span></td>
            ${!isOwner ? `
              <td style="padding:8px;">
                ${o.status === 'RECEIVED' ? `
                  <button class="btn-order-action" data-id="${o.orderId}" data-act="ACCEPTED" style="background:#16223F; color:#FFFFFF; border:none; padding:3px 8px; border-radius:4px; font-size:10px; cursor:pointer;">Accept</button>
                ` : o.status === 'ACCEPTED' ? `
                  <button class="btn-order-action" data-id="${o.orderId}" data-act="READY_FOR_PICKUP" style="background:#059669; color:#FFFFFF; border:none; padding:3px 8px; border-radius:4px; font-size:10px; cursor:pointer;">Food Ready</button>
                ` : ''}
              </td>
            ` : ''}
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;

  document.querySelectorAll(".btn-order-action").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const orderId = btn.getAttribute("data-id");
      const status = btn.getAttribute("data-act");
      try {
        await apiPatch(`/api/v1/channels/orders/${orderId}/status`, {
          status,
          cafeId: cachedCafeId,
        });
        showToast(`Order marked ${status}`, "success");
        fetchOrders();
      } catch (err) {
        showToast(err.message, "error");
      }
    });
  });
}

async function fetchPickupTokens() {
  try {
    const resTokens = await apiGet(`/api/v1/channels/pickup-tokens?cafeId=${cachedCafeId}`);
    cachedTokens = resTokens.data || [];
    renderPickupTokensList(cachedTokens);

    const resDisplay = await apiGet(`/api/v1/channels/public/pickup-display/${cachedCafeId}`);
    const displayData = resDisplay.data || {};
    renderPublicDisplayPreview(displayData);
  } catch (err) {
    console.error("Failed to load pickup data:", err);
  }
}

function renderPickupTokensList(tokens) {
  const container = document.getElementById("pickup-tokens-list");
  if (!container) return;

  if (tokens.length === 0) {
    container.innerHTML = `<div style="padding:20px; text-align:center; color:#64748B; font-size:13px;">No active pickup tokens.</div>`;
    return;
  }

  container.innerHTML = tokens.map((t) => `
    <div style="border:1px solid #E2E8F0; border-radius:8px; padding:12px; display:flex; justify-content:space-between; align-items:center;">
      <div>
        <span style="font-weight:800; font-size:14px; color:#16223F;">${t.tokenNumber}</span>
        <span style="font-size:11px; color:#64748B; display:block;">Counter: ${t.pickupCounter}</span>
      </div>
      <span style="font-size:11px; font-weight:700; padding:2px 8px; border-radius:6px; background:#F1F5F9;">
        ${t.status}
      </span>
    </div>
  `).join("");
}

function renderPublicDisplayPreview(displayData) {
  const prepRoot = document.getElementById("public-display-preparing");
  const readyRoot = document.getElementById("public-display-ready");

  if (prepRoot) {
    const prepList = displayData.preparing || [];
    prepRoot.innerHTML = prepList.length > 0
      ? prepList.map((p) => `<span style="background:rgba(251,191,36,0.2); color:#FBBF24; font-size:14px; font-weight:800; padding:4px 10px; border-radius:6px;">${p.tokenNumber}</span>`).join("")
      : `<span style="font-size:12px; color:#94A3B8;">None in queue</span>`;
  }

  if (readyRoot) {
    const readyList = displayData.readyForPickup || [];
    readyRoot.innerHTML = readyList.length > 0
      ? readyList.map((r) => `<span style="background:rgba(52,211,153,0.2); color:#34D399; font-size:14px; font-weight:800; padding:4px 10px; border-radius:6px;">${r.tokenNumber}</span>`).join("")
      : `<span style="font-size:12px; color:#94A3B8;">None ready</span>`;
  }
}

async function fetchConfig() {
  try {
    const res = await apiGet(`/api/v1/channels/config?cafeId=${cachedCafeId}`);
    cachedConfig = res.data || {};
  } catch (err) {
    console.error("Failed to load channel config:", err);
  }
}

// ── Modals ──

function openAddTableModal() {
  openModal({
    title: "Add Dining Table",
    content: `
      <form id="form-create-table" style="display:flex; flex-direction:column; gap:12px;">
        <div>
          <label style="font-size:12px; font-weight:600; color:#16223F; display:block; margin-bottom:4px;">Table Number</label>
          <input type="text" id="modal-table-num" placeholder="e.g. T-05" required style="width:100%; padding:8px; border:1px solid #CBD5E1; border-radius:6px;" />
        </div>
        <div>
          <label style="font-size:12px; font-weight:600; color:#16223F; display:block; margin-bottom:4px;">Section / Area</label>
          <input type="text" id="modal-table-sec" value="Main Dining" style="width:100%; padding:8px; border:1px solid #CBD5E1; border-radius:6px;" />
        </div>
        <div>
          <label style="font-size:12px; font-weight:600; color:#16223F; display:block; margin-bottom:4px;">Seating Capacity</label>
          <input type="number" id="modal-table-cap" value="4" min="1" style="width:100%; padding:8px; border:1px solid #CBD5E1; border-radius:6px;" />
        </div>
        <button type="submit" class="btn" style="background:#16223F; color:#FFFFFF; border:none; padding:10px; font-weight:600; border-radius:6px; cursor:pointer; margin-top:8px;">
          Create Table
        </button>
      </form>
    `,
  });

  setTimeout(() => {
    const form = document.getElementById("form-create-table");
    if (form) {
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        const tableNumber = document.getElementById("modal-table-num").value;
        const section = document.getElementById("modal-table-sec").value;
        const seatingCapacity = document.getElementById("modal-table-cap").value;
        try {
          await apiPost("/api/v1/channels/tables", {
            tableNumber,
            section,
            seatingCapacity,
            cafeId: cachedCafeId,
          });
          showToast("Dining table created.", "success");
          fetchTables();
        } catch (err) {
          showToast(err.message, "error");
        }
      });
    }
  }, 100);
}

async function openTableQrModal(tableId, tableNumber) {
  try {
    const res = await apiPost("/api/v1/channels/qr/generate-table", {
      tableId,
      tableNumber,
      cafeId: cachedCafeId,
    });
    const qrData = res.data;

    openModal({
      title: `Table ${tableNumber} QR Code`,
      content: `
        <div style="text-align:center; padding:16px;">
          <div style="display:inline-block; padding:12px; background:#FFFFFF; border:1px solid #E2E8F0; border-radius:10px; margin-bottom:12px;">
            ${qrData.svg}
          </div>
          <p style="font-size:12px; color:#64748B; margin:0 0 12px 0;">
            Token: <code style="font-size:11px; background:#F1F5F9; padding:2px 6px; border-radius:4px;">${qrData.opaqueToken.slice(0, 16)}...</code>
          </p>
          <div style="font-size:11px; color:#16223F; background:#FEF3C7; padding:8px; border-radius:6px; margin-bottom:16px;">
            Guests can scan this code with any mobile browser camera to open the menu and order.
          </div>
        </div>
      `,
    });
  } catch (err) {
    showToast(err.message, "error");
  }
}

function openNewReservationModal() {
  openModal({
    title: "New Table Reservation",
    content: `
      <form id="form-create-res" style="display:flex; flex-direction:column; gap:12px;">
        <div>
          <label style="font-size:12px; font-weight:600; color:#16223F; display:block; margin-bottom:4px;">Guest Name</label>
          <input type="text" id="modal-res-name" required style="width:100%; padding:8px; border:1px solid #CBD5E1; border-radius:6px;" />
        </div>
        <div>
          <label style="font-size:12px; font-weight:600; color:#16223F; display:block; margin-bottom:4px;">Guest Phone</label>
          <input type="tel" id="modal-res-phone" required style="width:100%; padding:8px; border:1px solid #CBD5E1; border-radius:6px;" />
        </div>
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px;">
          <div>
            <label style="font-size:12px; font-weight:600; color:#16223F; display:block; margin-bottom:4px;">Party Size</label>
            <input type="number" id="modal-res-party" value="2" min="1" style="width:100%; padding:8px; border:1px solid #CBD5E1; border-radius:6px;" />
          </div>
          <div>
            <label style="font-size:12px; font-weight:600; color:#16223F; display:block; margin-bottom:4px;">Booking Time</label>
            <input type="datetime-local" id="modal-res-time" required style="width:100%; padding:8px; border:1px solid #CBD5E1; border-radius:6px;" />
          </div>
        </div>
        <button type="submit" class="btn" style="background:#16223F; color:#FFFFFF; border:none; padding:10px; font-weight:600; border-radius:6px; cursor:pointer; margin-top:8px;">
          Confirm Booking
        </button>
      </form>
    `,
  });

  setTimeout(() => {
    const form = document.getElementById("form-create-res");
    if (form) {
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        const guestName = document.getElementById("modal-res-name").value;
        const guestPhone = document.getElementById("modal-res-phone").value;
        const partySize = document.getElementById("modal-res-party").value;
        const bookingTime = document.getElementById("modal-res-time").value;
        try {
          await apiPost("/api/v1/channels/reservations", {
            guestName,
            guestPhone,
            partySize,
            bookingTime,
            cafeId: cachedCafeId,
          });
          showToast("Reservation confirmed.", "success");
          fetchReservationsAndWaitlist();
        } catch (err) {
          showToast(err.message, "error");
        }
      });
    }
  }, 100);
}

function openAddWaitlistModal() {
  openModal({
    title: "Add Walk-In Party to Waitlist",
    content: `
      <form id="form-create-wl" style="display:flex; flex-direction:column; gap:12px;">
        <div>
          <label style="font-size:12px; font-weight:600; color:#16223F; display:block; margin-bottom:4px;">Guest Name</label>
          <input type="text" id="modal-wl-name" required style="width:100%; padding:8px; border:1px solid #CBD5E1; border-radius:6px;" />
        </div>
        <div>
          <label style="font-size:12px; font-weight:600; color:#16223F; display:block; margin-bottom:4px;">Guest Phone</label>
          <input type="tel" id="modal-wl-phone" required style="width:100%; padding:8px; border:1px solid #CBD5E1; border-radius:6px;" />
        </div>
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px;">
          <div>
            <label style="font-size:12px; font-weight:600; color:#16223F; display:block; margin-bottom:4px;">Party Size</label>
            <input type="number" id="modal-wl-party" value="2" min="1" style="width:100%; padding:8px; border:1px solid #CBD5E1; border-radius:6px;" />
          </div>
          <div>
            <label style="font-size:12px; font-weight:600; color:#16223F; display:block; margin-bottom:4px;">Estimated Wait (min)</label>
            <input type="number" id="modal-wl-wait" value="15" min="5" style="width:100%; padding:8px; border:1px solid #CBD5E1; border-radius:6px;" />
          </div>
        </div>
        <button type="submit" class="btn" style="background:#D4AF37; color:#16223F; border:none; padding:10px; font-weight:700; border-radius:6px; cursor:pointer; margin-top:8px;">
          Issue Waitlist Ticket
        </button>
      </form>
    `,
  });

  setTimeout(() => {
    const form = document.getElementById("form-create-wl");
    if (form) {
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        const guestName = document.getElementById("modal-wl-name").value;
        const guestPhone = document.getElementById("modal-wl-phone").value;
        const partySize = document.getElementById("modal-wl-party").value;
        const estimatedWaitMinutes = document.getElementById("modal-wl-wait").value;
        try {
          const res = await apiPost("/api/v1/channels/waitlist", {
            guestName,
            guestPhone,
            partySize,
            estimatedWaitMinutes,
            cafeId: cachedCafeId,
          });
          showToast(`Waitlist ticket ${res.data.queueNumber} issued.`, "success");
          fetchReservationsAndWaitlist();
        } catch (err) {
          showToast(err.message, "error");
        }
      });
    }
  }, 100);
}

function openSeatWaitlistModal(waitlistId) {
  const availableTables = cachedTables.filter((t) => t.status === "AVAILABLE");
  if (availableTables.length === 0) {
    showToast("No available dining tables right now.", "warning");
    return;
  }

  openModal({
    title: "Assign Table to Waiting Party",
    content: `
      <div style="padding:12px;">
        <p style="font-size:13px; color:#16223F; margin-bottom:12px;">Select an available dining table to seat the party:</p>
        <div style="display:flex; flex-direction:column; gap:8px;">
          ${availableTables.map((t) => `
            <button class="btn-confirm-seat" data-table="${t.tableId}" style="background:#F8FAFC; border:1px solid #CBD5E1; padding:10px; border-radius:6px; text-align:left; cursor:pointer; display:flex; justify-content:space-between;">
              <span style="font-weight:700; color:#16223F;">Table ${t.tableNumber}</span>
              <span style="font-size:11px; color:#64748B;">${t.section} (${t.seatingCapacity} covers)</span>
            </button>
          `).join("")}
        </div>
      </div>
    `,
  });

  setTimeout(() => {
    document.querySelectorAll(".btn-confirm-seat").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const tableId = btn.getAttribute("data-table");
        try {
          await apiPost("/api/v1/channels/waitlist/seat", {
            waitlistId,
            tableId,
            cafeId: cachedCafeId,
          });
          showToast("Party seated successfully.", "success");
          fetchReservationsAndWaitlist();
        } catch (err) {
          showToast(err.message, "error");
        }
      });
    });
  }, 100);
}
