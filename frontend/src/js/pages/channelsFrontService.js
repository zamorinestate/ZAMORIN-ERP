import { apiGet, apiPost, apiPatch } from "../apiClient.js";
import { state } from "../state.js";
import { showToast, openModal, closeModal, renderCafeContextStrip, renderModuleErrorState } from "../components.js";
import { ROLES } from "../navigation.js";

let activeSubTab = "tables"; // 'tables' | 'reservations' | 'orders' | 'pickup' | 'config'
let cachedTables = [];
let cachedReservations = [];
let cachedWaitlist = [];
let cachedOrders = [];
let cachedTokens = [];
let cachedConfig = null;
let cachedAggregatorStatus = { zomato: { isPaused: false }, swiggy: { isPaused: false } };
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

        <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
          <button id="btn-launch-captain-app" class="btn" style="background:#0F766E; color:#FFFFFF; border:none; padding:7px 12px; font-size:11.5px; font-weight:700; border-radius:6px; cursor:pointer; display:flex; align-items:center; gap:5px;" title="Launch Mobile Waiter / Captain Floor Web App (F253-F259, A131)">
            <span>📱</span> Captain App
          </button>
          <button id="btn-launch-token-display" class="btn" style="background:#1E293B; color:#FFFFFF; border:none; padding:7px 12px; font-size:11.5px; font-weight:700; border-radius:6px; cursor:pointer; display:flex; align-items:center; gap:5px;" title="Launch Takeaway Fullscreen TV Token Display (F276-F280)">
            <span>📺</span> TV Tokens
          </button>
          <button id="btn-launch-call-center" class="btn" style="background:var(--surface, #FFFFFF); border:1px solid var(--line, #E2E8F0); padding:7px 12px; font-size:11.5px; font-weight:700; border-radius:6px; cursor:pointer; display:flex; align-items:center; gap:5px;" title="Central Multi-Outlet Phone Order Call Center Desk (F111)">
            <span>📞</span> Call Center
          </button>
          <button id="btn-launch-emergency-terminal" class="btn" style="background:rgba(239,68,68,0.1); color:#DC2626; border:1px solid rgba(239,68,68,0.3); padding:7px 12px; font-size:11.5px; font-weight:700; border-radius:6px; cursor:pointer; display:flex; align-items:center; gap:5px;" title="Emergency Offline Order Acceptance Terminal (A007 / F086)">
            <span>⚡</span> Emergency Terminal
          </button>
          <button id="btn-refresh-channels" class="btn" style="background:var(--surface, #FFFFFF); border:1px solid var(--line, #E2E8F0); padding:7px 12px; font-size:11.5px; border-radius:6px; cursor:pointer; display:flex; align-items:center; gap:5px;">
            <span>🔄</span> Refresh
          </button>
          ${!isOwner ? `
            <button id="btn-quick-new-res" class="btn" style="background:#16223F; color:#FFFFFF; border:none; padding:7px 12px; font-size:11.5px; font-weight:600; border-radius:6px; cursor:pointer; display:flex; align-items:center; gap:5px;">
              <span>📅</span> New Booking
            </button>
            <button id="btn-quick-waitlist" class="btn" style="background:#D4AF37; color:#16223F; border:none; padding:7px 12px; font-size:11.5px; font-weight:700; border-radius:6px; cursor:pointer; display:flex; align-items:center; gap:5px;">
              <span>⏱️</span> Waitlist
            </button>
          ` : `
            <span style="font-size:11.5px; color:var(--ink-muted, #64748B); background:rgba(0,0,0,0.04); padding:6px 10px; border-radius:6px; font-weight:500;">
              👁️ Owner (Read-Only)
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
        <div style="display:flex; gap:8px;">
          <button id="btn-captain-app-dining" class="btn" style="background:#0F766E; color:#FFFFFF; border:none; padding:7px 12px; font-size:12px; font-weight:700; border-radius:6px; cursor:pointer;" title="Launch Mobile Waiter Captain Web App (A131)">
            📱 Floor Captain App
          </button>
          ${!isOwner ? `
            <button id="btn-add-table" class="btn" style="background:#16223F; color:#FFFFFF; border:none; padding:7px 12px; font-size:12px; font-weight:600; border-radius:6px; cursor:pointer;">
              ➕ Add Dining Table
            </button>
          ` : ''}
        </div>
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
    <!-- Visual Hourly Shift Booking Timeline (F297–F301) -->
    <div style="background:#FFFFFF; border:1px solid #E2E8F0; border-radius:10px; padding:16px 20px; margin-bottom:20px;">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
        <div>
          <h4 style="margin:0; font-size:14px; font-weight:700; color:#16223F;">📅 Today's Shift Booking Timeline & Table Load (F297–F301)</h4>
          <span style="font-size:11px; color:#64748B;">Lunch (12:00–16:00) & Dinner (19:00–23:00) Slot Capacities</span>
        </div>
        <span style="font-size:11px; font-weight:700; color:#059669; background:#ECFDF5; padding:3px 8px; border-radius:6px;">Floor Capacity: 84 Covers</span>
      </div>
      <div style="display:grid; grid-template-columns:repeat(8, 1fr); gap:8px;">
        ${[
          { slot: "12:00 PM", covers: 14, status: "OPEN" },
          { slot: "1:00 PM", covers: 28, status: "PEAK" },
          { slot: "2:00 PM", covers: 18, status: "OPEN" },
          { slot: "3:00 PM", covers: 8, status: "LOW" },
          { slot: "7:00 PM", covers: 22, status: "OPEN" },
          { slot: "8:00 PM", covers: 36, status: "PEAK" },
          { slot: "9:00 PM", covers: 24, status: "OPEN" },
          { slot: "10:00 PM", covers: 12, status: "LOW" },
        ].map((s) => `
          <div style="background:${s.status === 'PEAK' ? '#FEF2F2' : s.status === 'OPEN' ? '#F0FDF4' : '#F8FAFC'}; border:1px solid ${s.status === 'PEAK' ? '#FECACA' : s.status === 'OPEN' ? '#BBF7D0' : '#E2E8F0'}; border-radius:8px; padding:8px; text-align:center;">
            <div style="font-size:11px; font-weight:800; color:#16223F;">${s.slot}</div>
            <div style="font-size:13px; font-weight:900; color:${s.status === 'PEAK' ? '#DC2626' : s.status === 'OPEN' ? '#16A34A' : '#64748B'}; margin-top:2px;">${s.covers}p</div>
            <div style="font-size:9.5px; font-weight:700; color:${s.status === 'PEAK' ? '#B91C1C' : s.status === 'OPEN' ? '#15803D' : '#94A3B8'}; text-transform:uppercase;">${s.status}</div>
          </div>
        `).join("")}
      </div>
    </div>

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
            <option value="AGGREGATOR">Aggregators (Zomato/Swiggy/Toing)</option>
            <option value="TOING">Toing Direct (A070)</option>
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
          <div style="display:flex; align-items:center; gap:8px;">
            <button id="btn-launch-fullscreen-tv" class="btn" style="background:#D4AF37; color:#16223F; border:none; padding:5px 12px; font-size:11.5px; font-weight:800; border-radius:6px; cursor:pointer;" title="Launch Fullscreen Takeaway TV Token Screen (F276-F280)">
              📺 Launch TV Display
            </button>
            <span style="background:rgba(212,175,55,0.2); color:#D4AF37; font-size:11px; font-weight:700; padding:3px 8px; border-radius:8px;">
              PUBLIC DISPLAY
            </span>
          </div>
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

function renderAggregatorCard(provider, name, brandColor, statusObj = {}) {
  const isPaused = Boolean(statusObj?.isPaused);
  const remainingMins = statusObj?.remainingMinutes || 0;
  const reason = statusObj?.reason || "Operational adjustment";
  const pauseExpiresAt = statusObj?.pauseExpiresAt ? new Date(statusObj.pauseExpiresAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : "";

  return `
    <div style="border:1.5px solid ${isPaused ? '#F59E0B' : '#E2E8F0'}; border-radius:8px; padding:16px; background:${isPaused ? '#FFFBEB' : '#FAFAFA'}; display:flex; flex-direction:column; justify-content:space-between; gap:12px;">
      <div>
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
          <div style="display:flex; align-items:center; gap:8px;">
            <span style="display:inline-block; width:10px; height:10px; border-radius:50%; background:${brandColor};"></span>
            <strong style="font-size:14px; color:#16223F;">${name} Store</strong>
          </div>
          ${isPaused ? `
            <span style="background:#FDE68A; color:#92400E; font-size:10.5px; font-weight:800; padding:2px 8px; border-radius:6px; border:1px solid #FCD34D;">
              ⏸️ PAUSED (${remainingMins > 0 ? `${remainingMins}m left` : 'Indefinite'})
            </span>
          ` : `
            <span style="background:#DCFCE7; color:#15803D; font-size:10.5px; font-weight:800; padding:2px 8px; border-radius:6px; border:1px solid #86EFAC;">
              🟢 ACCEPTING ORDERS
            </span>
          `}
        </div>

        <p style="margin:0 0 10px 0; font-size:11.5px; color:${isPaused ? '#B45309' : '#64748B'};">
          ${isPaused ? `Paused until ${pauseExpiresAt || 'manual resume'}: "${escapeHtml(reason)}"` : 'Accepting marketplace delivery and takeaway orders.'}
        </p>

        ${isPaused ? `
          <button class="btn btn-resume-agg" data-provider="${provider}" style="background:#059669; color:#FFFFFF; border:none; padding:8px 14px; font-size:12px; font-weight:700; border-radius:6px; cursor:pointer; width:100%;">
            ▶️ Resume ${name} Store Now
          </button>
        ` : `
          <div style="display:flex; flex-direction:column; gap:8px;">
            <select class="select agg-pause-reason" data-provider="${provider}" style="font-size:11.5px; padding:5px 8px; border-radius:6px; border:1px solid #CBD5E1; width:100%;">
              <option value="Kitchen Rush / Surge Orders">Kitchen Rush / Surge Orders</option>
              <option value="Heavy Rain / Delivery Partner Shortage">Heavy Rain / Delivery Partner Shortage</option>
              <option value="Key Raw Material Exhaustion">Key Raw Material Exhaustion</option>
              <option value="Equipment Maintenance / Power Outage">Equipment Maintenance / Power Outage</option>
            </select>
            <div style="display:grid; grid-template-columns:repeat(4, 1fr); gap:6px;">
              <button class="btn btn-pause-agg" data-provider="${provider}" data-mins="15" style="background:#F1F5F9; border:1px solid #CBD5E1; padding:6px 0; font-size:11px; font-weight:700; border-radius:6px; cursor:pointer;" type="button">⏸️ 15m</button>
              <button class="btn btn-pause-agg" data-provider="${provider}" data-mins="30" style="background:#F1F5F9; border:1px solid #CBD5E1; padding:6px 0; font-size:11px; font-weight:700; border-radius:6px; cursor:pointer;" type="button">⏸️ 30m</button>
              <button class="btn btn-pause-agg" data-provider="${provider}" data-mins="60" style="background:#F1F5F9; border:1px solid #CBD5E1; padding:6px 0; font-size:11px; font-weight:700; border-radius:6px; cursor:pointer;" type="button">⏸️ 60m</button>
              <button class="btn btn-pause-agg" data-provider="${provider}" data-mins="0" style="background:#FEE2E2; border:1px solid #FCA5A5; color:#991B1B; padding:6px 0; font-size:11px; font-weight:700; border-radius:6px; cursor:pointer;" type="button">⏸️ Off</button>
            </div>
          </div>
        `}
      </div>
    </div>
  `;
}

function renderConfigTab() {
  const isOwner = state.user?.role === ROLES.OWNER;
  return `
    <div style="display:flex; flex-direction:column; gap:20px; max-width:960px;">
      <!-- Direct Channels & Policies Card -->
      <div style="background:#FFFFFF; border:1px solid #E2E8F0; border-radius:10px; padding:24px;">
        <h3 style="margin:0 0 6px 0; font-size:16px; font-weight:700; color:#16223F;">Direct Channels & Store Policies</h3>
        <p style="margin:0 0 20px 0; font-size:12px; color:#64748B;">Configure universal QR table ordering and direct web ordering policies.</p>

        <form id="form-channel-config" style="display:flex; flex-direction:column; gap:16px;">
          <div style="border-bottom:1px solid #E2E8F0; padding-bottom:14px;">
            <label style="display:flex; align-items:center; gap:8px; font-weight:600; font-size:13px; color:#16223F; cursor:pointer;">
              <input type="checkbox" id="cfg-qr-enabled" ${isOwner ? 'disabled' : ''} ${cachedConfig?.qrOrderingEnabled !== false ? 'checked' : ''} />
              Enable Universal QR Table Ordering
            </label>
            <span style="font-size:11px; color:#64748B; margin-left:24px; display:block;">Allows guests to scan table QR codes and submit multi-round orders from their phones.</span>
          </div>

          <div style="border-bottom:1px solid #E2E8F0; padding-bottom:14px;">
            <label style="display:flex; align-items:center; gap:8px; font-weight:600; font-size:13px; color:#16223F; cursor:pointer;">
              <input type="checkbox" id="cfg-web-enabled" ${isOwner ? 'disabled' : ''} ${cachedConfig?.webOrderingEnabled !== false ? 'checked' : ''} />
              Enable Direct Web Ordering (Takeaway & Delivery)
            </label>
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-top:10px; margin-left:24px;">
              <div>
                <label style="font-size:11px; color:#64748B; display:block; margin-bottom:4px;">Packaging Fee (₹)</label>
                <input type="number" id="cfg-packaging-fee" value="${cachedConfig?.packagingFeePaisa ? (cachedConfig.packagingFeePaisa / 100).toFixed(0) : '15'}" ${isOwner ? 'disabled' : ''} style="width:100%; padding:6px 10px; font-size:12px; border:1px solid #CBD5E1; border-radius:6px;" />
              </div>
              <div>
                <label style="font-size:11px; color:#64748B; display:block; margin-bottom:4px;">Delivery Fee (₹)</label>
                <input type="number" id="cfg-delivery-fee" value="${cachedConfig?.deliveryFeePaisa ? (cachedConfig.deliveryFeePaisa / 100).toFixed(0) : '40'}" ${isOwner ? 'disabled' : ''} style="width:100%; padding:6px 10px; font-size:12px; border:1px solid #CBD5E1; border-radius:6px;" />
              </div>
            </div>
          </div>

          ${!isOwner ? `
            <button type="submit" class="btn" style="background:#16223F; color:#FFFFFF; border:none; padding:10px 16px; font-size:13px; font-weight:600; border-radius:6px; cursor:pointer; align-self:flex-start;">
              Save Channel Policies
            </button>
          ` : ''}
        </form>
      </div>

      <!-- Marketplace Aggregators 1-Click Store Pause Controls (F088 / A081) -->
      <div style="background:#FFFFFF; border:1px solid #E2E8F0; border-radius:10px; padding:24px;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px;">
          <div>
            <h3 style="margin:0 0 4px 0; font-size:16px; font-weight:700; color:#16223F;">1-Click Aggregator Store Controls (F088, A081)</h3>
            <p style="margin:0; font-size:12px; color:#64748B;">Instantly pause and resume store availability on Zomato & Swiggy during kitchen rushes, bad weather, or stock-outs.</p>
          </div>
          <button class="btn btn-sm btn-ghost" id="btn-refresh-agg-status" type="button" style="font-size:11px; font-weight:700;">
            🔄 Refresh Status
          </button>
        </div>

        <div style="display:grid; grid-template-columns:repeat(3, 1fr); gap:16px;">
          ${renderAggregatorCard("ZOMATO", "Zomato", "#E23744", cachedAggregatorStatus?.zomato)}
          ${renderAggregatorCard("SWIGGY", "Swiggy", "#FC8019", cachedAggregatorStatus?.swiggy)}
          ${renderAggregatorCard("TOING", "Toing", "#8B5CF6", cachedAggregatorStatus?.toing)}
        </div>
      </div>

      <!-- Marketplace Weekly Payout Statement Reconciler (F100-F106) -->
      <div style="background:#FFFFFF; border:1px solid #E2E8F0; border-radius:10px; padding:24px;">
        <div style="display:flex; justify-content:space-between; align-items:flex-start; flex-wrap:wrap; gap:16px;">
          <div>
            <div style="display:flex; align-items:center; gap:8px; margin-bottom:4px;">
              <h3 style="margin:0; font-size:16px; font-weight:700; color:#16223F;">Weekly Payout Statement Reconciler & Dispute Generator (F100–F106)</h3>
              <span style="background:rgba(16,185,129,0.12); color:#059669; font-size:10px; font-weight:800; padding:2px 8px; border-radius:12px;">STATUTORY GST SEC 52 AUDIT</span>
            </div>
            <p style="margin:0; font-size:12.5px; color:#64748B; max-width:640px;">
              Line-by-line audit of Zomato & Swiggy weekly payout remittance CSVs. Detects overcharged commissions, TDS/TCS miscalculations, and unacknowledged cancellation penalties with 1-click legal dispute ticket generation.
            </p>
          </div>
          <button class="btn" id="btn-launch-statement-reconciler" style="background:#D4AF37; color:#16223F; border:none; padding:10px 16px; font-size:12.5px; font-weight:800; border-radius:8px; cursor:pointer; display:flex; align-items:center; gap:6px;">
            <span>📊</span> Launch Statement Reconciler
          </button>
        </div>
      </div>
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

  // Cross-screen launcher links
  document.querySelectorAll("#btn-launch-captain-app, #btn-captain-app-dining").forEach((btn) => {
    btn.addEventListener("click", () => {
      window.location.hash = "#captain";
    });
  });

  document.querySelectorAll("#btn-launch-token-display, #btn-launch-fullscreen-tv").forEach((btn) => {
    btn.addEventListener("click", () => {
      window.open("#token-display", "TVTokenDisplay", "width=1920,height=1080,menubar=no,toolbar=no");
      showToast("Takeaway TV Token Display launched.", "info");
    });
  });

  document.getElementById("btn-launch-call-center")?.addEventListener("click", () => {
    window.location.hash = "#call-center";
  });

  document.getElementById("btn-launch-emergency-terminal")?.addEventListener("click", () => {
    window.location.hash = "#emergency-terminal";
  });

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
    const depositPaid = r.depositStatus === 'PAID';
    return `
      <div style="border:1px solid #E2E8F0; border-radius:8px; padding:12px; display:flex; justify-content:space-between; align-items:center;">
        <div>
          <div style="display:flex; align-items:center; gap:8px;">
            <strong style="color:#16223F; font-size:13px;">${r.guestName} (${r.partySize} guests)</strong>
            ${depositPaid ? `
              <span style="font-size:10px; font-weight:700; padding:1px 6px; border-radius:4px; background:#ECFDF5; color:#059669; border:1px solid #A7F3D0;">
                💰 ₹${((r.depositAmountPaisa || 0) / 100).toFixed(0)} Deposit Paid
              </span>
            ` : `
              <span style="font-size:10px; color:#94A3B8;">No Deposit</span>
            `}
          </div>
          <div style="font-size:11px; color:#64748B; margin-top:2px;">
            ⏰ ${timeStr} • 📞 ${r.guestPhone} • Table: ${r.assignedTableNumber || 'Not assigned'}
          </div>
        </div>
        <div style="display:flex; align-items:center; gap:6px;">
          <span style="font-size:11px; font-weight:700; padding:2px 8px; border-radius:6px; background:#F1F5F9; color:#16223F;">
            ${r.status}
          </span>
          ${!isOwner && !depositPaid ? `
            <button class="btn-deposit-res" data-id="${r.reservationId}" style="background:#0F766E; color:#FFFFFF; border:none; padding:4px 8px; font-size:11px; border-radius:4px; cursor:pointer;" title="Collect Advance Per-Cover Deposit (F296)">
              💳 Deposit
            </button>
          ` : ''}
          ${!isOwner && r.status === 'CONFIRMED' ? `
            <button class="btn-checkin-res" data-id="${r.reservationId}" style="background:#16223F; color:#FFFFFF; border:none; padding:4px 8px; font-size:11px; border-radius:4px; cursor:pointer;">
              Check In
            </button>
          ` : ''}
        </div>
      </div>
    `;
  }).join("");

  document.querySelectorAll(".btn-deposit-res").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const reservationId = btn.getAttribute("data-id");
      const val = prompt("Enter advance booking deposit amount in ₹ (e.g. 500 per cover):", "1000");
      if (!val || isNaN(Number(val))) return;
      try {
        const res = await apiPost("/api/v1/channels/reservations/deposit", {
          reservationId,
          amountPaisa: Math.round(Number(val) * 100),
          paymentMethod: "UPI",
          cafeId: cachedCafeId,
        });
        showToast(`Advance deposit recorded! Receipt: ${res.data.receiptNumber}`, "success");
        fetchReservationsAndWaitlist();
      } catch (err) {
        showToast(err.message, "error");
      }
    });
  });

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
            ${q.status === 'NOTIFIED' ? `
              <span style="background:#FEF3C7; color:#B45309; font-size:10px; font-weight:800; padding:1px 5px; border-radius:4px;">📲 Notified</span>
            ` : ''}
            ${q.preOrderItems?.length ? `
              <span style="background:#F0FDF4; color:#16A34A; font-size:10px; font-weight:800; padding:1px 5px; border-radius:4px;">🍲 Pre-Order (${q.preOrderItems.length})</span>
            ` : ''}
          </div>
          <div style="font-size:11px; color:#64748B; margin-top:2px;">
            Est. wait: ${q.estimatedWaitMinutes}m • 📞 ${q.guestPhone}
          </div>
        </div>
        <div style="display:flex; align-items:center; gap:6px;">
          ${!isOwner ? `
            <button class="btn-notify-waitlist" data-id="${q.waitlistId}" style="background:#3B82F6; color:#FFFFFF; border:none; padding:5px 8px; font-size:11px; font-weight:700; border-radius:4px; cursor:pointer;" title="SMS Table Ready Notification (F295)">
              📲 SMS Ready
            </button>
            <button class="btn-preorder-waitlist" data-id="${q.waitlistId}" style="background:#10B981; color:#FFFFFF; border:none; padding:5px 8px; font-size:11px; font-weight:700; border-radius:4px; cursor:pointer;" title="Attach Pre-Order Dishes (A069)">
              🍲 Pre-Order
            </button>
            <button class="btn-seat-waitlist" data-id="${q.waitlistId}" style="background:#D4AF37; color:#16223F; border:none; padding:5px 10px; font-size:11px; font-weight:700; border-radius:4px; cursor:pointer;">
              Seat Party
            </button>
          ` : ''}
        </div>
      </div>
    `;
  }).join("");

  document.querySelectorAll(".btn-notify-waitlist").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const waitlistId = btn.getAttribute("data-id");
      try {
        const res = await apiPost(`/api/v1/channels/waitlist/${waitlistId}/notify`, { cafeId: cachedCafeId });
        showToast(`📲 SMS table-ready alert dispatched to ${res.data.guestName}!`, "success");
        fetchReservationsAndWaitlist();
      } catch (err) {
        showToast(err.message, "error");
      }
    });
  });

  document.querySelectorAll(".btn-preorder-waitlist").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const waitlistId = btn.getAttribute("data-id");
      const dish = prompt("Enter pre-ordered dishes (e.g. '1x Cold Brew, 1x Paneer Wrap'):", "1x Malabar Cold Brew, 1x Pepper Paneer Wrap");
      if (!dish) return;
      try {
        await apiPost(`/api/v1/channels/waitlist/${waitlistId}/pre-order`, {
          cafeId: cachedCafeId,
          preOrderItems: [{ dish, notes: "Pre-order while waiting" }],
        });
        showToast("Pre-order attached to waitlist party!", "success");
        fetchReservationsAndWaitlist();
      } catch (err) {
        showToast(err.message, "error");
      }
    });
  });

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
  try {
    const statusRes = await apiGet(`/api/v1/channels/aggregators/status?cafeId=${cachedCafeId}`);
    cachedAggregatorStatus = statusRes.data || { zomato: { isPaused: false }, swiggy: { isPaused: false } };
  } catch (err) {
    console.warn("Failed to load aggregator pause status:", err);
  }
  const root = document.getElementById("channels-panel-root");
  if (root && activeSubTab === "config") {
    root.innerHTML = renderConfigTab();
    wireConfigTab();
  }
}

function wireConfigTab() {
  document.querySelectorAll(".btn-pause-agg").forEach((b) => {
    b.addEventListener("click", async () => {
      const provider = b.dataset.provider;
      const mins = Number(b.dataset.mins);
      const reasonEl = document.querySelector(`.agg-pause-reason[data-provider="${provider}"]`);
      const reason = reasonEl ? reasonEl.value : "Kitchen Rush / Surge Orders";
      try {
        await apiPost("/api/v1/channels/aggregators/pause", {
          cafeId: cachedCafeId,
          provider,
          durationMinutes: mins,
          reason,
        });
        showToast(`⏸️ ${provider} store paused (${mins === 0 ? 'Indefinite' : `${mins} minutes`}).`, "mint");
        await fetchConfig();
      } catch (err) {
        showToast(err.message || "Failed to pause aggregator store", "error");
      }
    });
  });

  document.querySelectorAll(".btn-resume-agg").forEach((b) => {
    b.addEventListener("click", async () => {
      const provider = b.dataset.provider;
      try {
        await apiPost("/api/v1/channels/aggregators/resume", {
          cafeId: cachedCafeId,
          provider,
        });
        showToast(`▶️ ${provider} store resumed! Accepting marketplace orders.`, "mint");
        await fetchConfig();
      } catch (err) {
        showToast(err.message || "Failed to resume aggregator store", "error");
      }
    });
  });

  document.querySelector("#btn-refresh-agg-status")?.addEventListener("click", async () => {
    await fetchConfig();
    showToast("Aggregator live statuses updated.", "info");
  });

  document.querySelector("#btn-launch-statement-reconciler")?.addEventListener("click", () => {
    openAggregatorStatementModal();
  });

  const form = document.querySelector("#form-channel-config");
  if (form) {
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const qrEnabled = document.querySelector("#cfg-qr-enabled")?.checked ?? true;
      const webEnabled = document.querySelector("#cfg-web-enabled")?.checked ?? true;
      const packagingFee = Number(document.querySelector("#cfg-packaging-fee")?.value) || 0;
      const deliveryFee = Number(document.querySelector("#cfg-delivery-fee")?.value) || 0;
      try {
        await apiPatch("/api/v1/channels/config", {
          cafeId: cachedCafeId,
          config: {
            qrOrderingEnabled: qrEnabled,
            webOrderingEnabled: webEnabled,
            packagingFeePaisa: packagingFee * 100,
            deliveryFeePaisa: deliveryFee * 100,
          },
        });
        showToast("Channel store policies updated successfully.", "mint");
      } catch (err) {
        showToast(err.message || "Failed to save settings", "error");
      }
    });
  }
}

function openAggregatorStatementModal() {
  let sampleStatement = [
    { channelOrderId: "ZOM-7801", orderDate: "2026-10-05", grossAmountPaisa: 65000, commissionPaisa: 11700, tcsPaisa: 650, tdsPaisa: 650, netPayoutPaisa: 52000 },
    { channelOrderId: "ZOM-7802", orderDate: "2026-10-06", grossAmountPaisa: 120000, commissionPaisa: 21600, tcsPaisa: 1200, tdsPaisa: 1200, netPayoutPaisa: 96000 },
    { channelOrderId: "ZOM-7803", orderDate: "2026-10-07", grossAmountPaisa: 85000, commissionPaisa: 21250, tcsPaisa: 1275, tdsPaisa: 850, netPayoutPaisa: 61625 },
    { channelOrderId: "ZOM-7804", orderDate: "2026-10-08", grossAmountPaisa: 45000, commissionPaisa: 8100, tcsPaisa: 450, tdsPaisa: 450, netPayoutPaisa: 36000 },
    { channelOrderId: "ZOM-7805", orderDate: "2026-10-09", grossAmountPaisa: 98000, commissionPaisa: 17640, tcsPaisa: 980, tdsPaisa: 980, netPayoutPaisa: 78400 },
  ];

  openModal({
    title: "Aggregator Payout Reconciler & Statutory Audit (F100–F106)",
    maxWidth: "760px",
    content: `
      <div style="display:flex; flex-direction:column; gap:16px; font-size:12.5px;">
        <div style="background:var(--surface-sunken, #F8FAFC); padding:10px 14px; border-radius:8px; border:1px solid #E2E8F0; font-size:11.5px; color:#64748B;">
          ℹ️ <strong>Statutory Reconciliation Engine:</strong> Validates weekly payout statements against contracted commission rates, CBIC Section 52 1% GST TCS deductions, Section 194-O 1% TDS, and unagreed cancellations.
        </div>

        <div style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:10px;">
          <div>
            <label style="font-weight:700; color:#16223F; display:block; margin-bottom:3px;">Aggregator</label>
            <select id="modal-stmt-provider" class="select" style="width:100%; font-size:12px;">
              <option value="ZOMATO" selected>Zomato (Hyperpure)</option>
              <option value="SWIGGY">Swiggy (Bundl)</option>
            </select>
          </div>
          <div>
            <label style="font-weight:700; color:#16223F; display:block; margin-bottom:3px;">Agreed Commission (%)</label>
            <input type="number" id="modal-stmt-comm" class="input" value="18" min="5" max="40" step="0.5" style="width:100%; font-size:12px; font-weight:700;" />
          </div>
          <div>
            <label style="font-weight:700; color:#16223F; display:block; margin-bottom:3px;">Statement Reference</label>
            <input type="text" id="modal-stmt-ref" class="input" value="STMT-ZOM-2026-W41" style="width:100%; font-size:12px;" />
          </div>
        </div>

        <div>
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
            <label style="font-weight:700; color:#16223F;">Statement Line Items (<span id="stmt-line-count">${sampleStatement.length}</span> orders)</label>
            <button class="btn btn-sm btn-secondary" id="modal-stmt-load-demo-btn" type="button" style="font-size:11px; padding:2px 8px; font-weight:700;">
              📥 Reload Sample Remittance
            </button>
          </div>
          <div id="modal-stmt-lines-table" style="max-height:160px; overflow-y:auto; border:1px solid #E2E8F0; border-radius:6px; background:#FFFFFF;">
          </div>
        </div>

        <button class="btn btn-primary" id="modal-stmt-run-audit-btn" type="button" style="padding:10px 16px; font-weight:800; font-size:13px; border-radius:6px; background:#16223F; color:#FFFFFF;">
          ⚡ Run Payout & Statutory Audit
        </button>

        <div id="modal-stmt-audit-results" style="display:none; flex-direction:column; gap:12px; border-top:1px dashed #CBD5E1; padding-top:12px;">
        </div>
      </div>
    `,
  });

  const renderTable = () => {
    const tableEl = document.getElementById("modal-stmt-lines-table");
    if (!tableEl) return;
    tableEl.innerHTML = `
      <table style="width:100%; font-size:11px; border-collapse:collapse; text-align:left;">
        <thead>
          <tr style="background:#F8FAFC; border-bottom:1px solid #E2E8F0; color:#64748B;">
            <th style="padding:6px 8px;">Order Ref</th>
            <th style="padding:6px 8px; text-align:right;">Gross (₹)</th>
            <th style="padding:6px 8px; text-align:right;">Commission (₹)</th>
            <th style="padding:6px 8px; text-align:right;">TCS (1%)</th>
            <th style="padding:6px 8px; text-align:right;">Net Remittance (₹)</th>
          </tr>
        </thead>
        <tbody>
          ${sampleStatement.map(s => `
            <tr style="border-bottom:1px solid #F1F5F9;">
              <td style="padding:5px 8px; font-family:monospace; font-weight:700;">${s.channelOrderId}</td>
              <td style="padding:5px 8px; text-align:right;">₹${(s.grossAmountPaisa / 100).toFixed(2)}</td>
              <td style="padding:5px 8px; text-align:right;">₹${(s.commissionPaisa / 100).toFixed(2)}</td>
              <td style="padding:5px 8px; text-align:right;">₹${(s.tcsPaisa / 100).toFixed(2)}</td>
              <td style="padding:5px 8px; text-align:right; font-weight:700; color:#16223F;">₹${(s.netPayoutPaisa / 100).toFixed(2)}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    `;
  };

  setTimeout(() => {
    renderTable();

    document.getElementById("modal-stmt-load-demo-btn")?.addEventListener("click", () => {
      renderTable();
      showToast("Sample weekly remittance statement reloaded.", "info");
    });

    document.getElementById("modal-stmt-run-audit-btn")?.addEventListener("click", async () => {
      const provider = document.getElementById("modal-stmt-provider")?.value || "ZOMATO";
      const commRate = Number(document.getElementById("modal-stmt-comm")?.value) || 18;
      const ref = document.getElementById("modal-stmt-ref")?.value || "STMT-ZOM-2026-W41";
      const resultsContainer = document.getElementById("modal-stmt-audit-results");

      if (resultsContainer) {
        resultsContainer.style.display = "flex";
        resultsContainer.innerHTML = '<div style="text-align:center; padding:16px; color:#64748B;">Auditing remittance against contract and statutory GST rules...</div>';
      }

      try {
        const res = await apiPost("/api/v1/channels/aggregators/statement-audit", {
          cafeId: cachedCafeId,
          provider,
          statementReference: ref,
          statementPeriod: "2026-W41",
          agreedCommissionRatePercent: commRate,
          agreedTcsRatePercent: 1,
          agreedTdsRatePercent: 1,
          lineItems: sampleStatement,
        });

        const auditData = res?.data || res;
        const totalGross = (auditData.totalGrossPaisa || 0) / 100;
        const totalDiscrepancy = (auditData.totalDiscrepancyPaisa || 0) / 100;
        const discrepancies = auditData.discrepancies || [];
        const hasLeakage = totalDiscrepancy > 0 || discrepancies.length > 0;

        resultsContainer.innerHTML = `
          <div style="background:${hasLeakage ? '#FFFBEB' : '#ECFDF5'}; border:1px solid ${hasLeakage ? '#FDE68A' : '#A7F3D0'}; border-radius:8px; padding:12px;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
              <span style="font-weight:800; font-size:13px; color:${hasLeakage ? '#92400E' : '#065F46'};">
                ${hasLeakage ? `⚠️ AUDIT COMPLETE: ₹${totalDiscrepancy.toFixed(2)} LEAKAGE FLAGGED` : '🟢 AUDIT COMPLETE: 100% RECONCILED CLEAN'}
              </span>
              <span class="badge" style="font-size:10px; background:${hasLeakage ? '#F59E0B' : '#10B981'}; color:#FFFFFF; font-weight:700;">
                ${auditData.status || (hasLeakage ? 'DISCREPANCY_FLAGGED' : 'RECONCILED_CLEAN')}
              </span>
            </div>
            <div style="display:grid; grid-template-columns:repeat(3, 1fr); gap:8px; font-size:11.5px;">
              <div>Gross Orders: <strong>₹${totalGross.toFixed(2)}</strong></div>
              <div>Agreed Comm (${commRate}%): <strong>₹${((auditData.totalExpectedCommissionPaisa || 0) / 100).toFixed(2)}</strong></div>
              <div>Net Remittance Disbursed: <strong>₹${((auditData.totalNetRemittancePaisa || 0) / 100).toFixed(2)}</strong></div>
            </div>
          </div>

          ${discrepancies.length > 0 ? `
            <div>
              <div style="font-weight:700; color:#16223F; margin-bottom:4px;">Discrepancy Breakdown (${discrepancies.length} issues detected):</div>
              <div style="border:1px solid #E2E8F0; border-radius:6px; overflow:hidden;">
                <table style="width:100%; font-size:11px; border-collapse:collapse; text-align:left;">
                  <thead style="background:#F8FAFC; color:#64748B;">
                    <tr>
                      <th style="padding:5px 8px;">Order Ref</th>
                      <th style="padding:5px 8px;">Anomaly Code</th>
                      <th style="padding:5px 8px;">Variance Description</th>
                      <th style="padding:5px 8px; text-align:right;">Leakage (₹)</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${discrepancies.map(d => `
                      <tr style="border-bottom:1px solid #F1F5F9;">
                        <td style="padding:5px 8px; font-family:monospace; font-weight:700;">${d.channelOrderId}</td>
                        <td style="padding:5px 8px;"><span style="background:rgba(239,68,68,0.12); color:#DC2626; font-size:9.5px; padding:1px 5px; border-radius:4px; font-weight:700;">${d.anomalyCode}</span></td>
                        <td style="padding:5px 8px; color:#64748B;">${d.description || 'Rate variance detected'}</td>
                        <td style="padding:5px 8px; text-align:right; font-weight:700; color:#DC2626;">+₹${((d.variancePaisa || 0) / 100).toFixed(2)}</td>
                      </tr>
                    `).join("")}
                  </tbody>
                </table>
              </div>
            </div>

            <div style="display:flex; justify-content:space-between; align-items:center;">
              <span style="font-size:11.5px; color:#64748B;">Discrepant orders are eligible for merchant dispute filing.</span>
              <button class="btn btn-sm" id="modal-stmt-gen-dispute-btn" style="background:#16223F; color:#FFFFFF; font-weight:700; font-size:11.5px; padding:6px 12px; border-radius:6px;">
                📩 Generate Merchant Dispute Notice
              </button>
            </div>

            <div id="modal-stmt-dispute-box" style="display:none; background:#F8FAFC; border:1px solid #CBD5E1; border-radius:6px; padding:12px; font-family:monospace; font-size:11px; white-space:pre-wrap; color:#1E293B;">
            </div>
          ` : `
            <div style="font-size:12px; color:#059669; font-weight:600; text-align:center; padding:8px 0;">
              ✨ All remittance lines conform strictly to contract commission rate and statutory GST rules.
            </div>
          `}
        `;

        document.getElementById("modal-stmt-gen-dispute-btn")?.addEventListener("click", () => {
          const disputeBox = document.getElementById("modal-stmt-dispute-box");
          if (!disputeBox) return;
          const noticeText = [
            `TO: ${provider.toUpperCase()} MERCHANT SETTLEMENT SUPPORT`,
            `DATE: ${new Date().toISOString().slice(0, 10)}`,
            `MERCHANT: ZAMORIN CAFE ESTATE (CAFÉ ID: ${cachedCafeId})`,
            `STATEMENT REF: ${ref}`,
            `CONTRACTED COMMISSION: ${commRate}% | STATUTORY TCS: 1% (CBIC SEC 52)`,
            `----------------------------------------------------------------------`,
            `FORMAL NOTICE OF SETTLEMENT DISCREPANCY & RECOVERY CLAIM`,
            `----------------------------------------------------------------------`,
            `Upon automated audit of the remittance statement for period 2026-W41,`,
            `the following contractual and statutory over-deductions were identified:`,
            ``,
            ...discrepancies.map((d, i) => `${i + 1}. Order ${d.channelOrderId}: ${d.anomalyCode} — Leakage: ₹${((d.variancePaisa || 0) / 100).toFixed(2)} (${d.description})`),
            ``,
            `TOTAL RECOVERY CLAIMED: ₹${totalDiscrepancy.toFixed(2)}`,
            `Please reverse these excess deductions in the upcoming remittance cycle.`,
            `Zamorin Café Internal Audit Ref: AUDIT-${Date.now()}`,
          ].join('\\n');

          disputeBox.style.display = "block";
          disputeBox.textContent = noticeText;
          showToast("Merchant dispute notice generated.", "mint");
        });
      } catch (auditErr) {
        if (resultsContainer) {
          resultsContainer.innerHTML = `<div style="color:#EF4444; text-align:center; padding:12px;">Audit failed: ${auditErr.message}</div>`;
        }
      }
    });
  }, 100);
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
