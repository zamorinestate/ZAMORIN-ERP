// =============================================================================
// PAGE: POS & Billing Terminal — Canonical Zamorin Point of Sale (SCR-019 / ADM-SCR-002)
//
// Shared canonical POS engine supporting:
//   - Primary Master (Full org scope, void authority)
//   - Cafe Operations / CAFE_ADMIN (Strict single-cafe scope, Operator Session attribution,
//     no void authority, fixed device context)
// =============================================================================
import { apiGet, apiPost } from "../apiClient.js";
import { showToast, openModal, closeModal, confirmAction } from "../components.js";
import { state } from "../state.js";
import { ROLES } from "../navigation.js";
import { generateInvoicePdf } from "../utils/invoicePdfGenerator.js";
import { offlineManager, QUEUE_STATUSES } from "../utils/offlineManager.js";


function resolvePosCafeId() {
  const user = state.auth?.user || state.user || {};
  const isPrimary = user.isPrimaryMaster === true;
  const role = user.role || state.role;

  if (role === "MASTER" && isPrimary) {
    return state.currentCafeId || (state.selectedCafeId && state.selectedCafeId !== "ALL" ? state.selectedCafeId : "");
  }

  // CAFE_ADMIN / STAFF / Terminal Operations:
  // Strictly bound to hardware device or authenticated operator assignment.
  // Must NEVER fall back to global UI dropdown selector (state.currentCafeId).
  const boundDeviceCafe = typeof localStorage !== "undefined" ? (localStorage.getItem("zamorin_bound_cafe_id") || "").trim() : "";
  if (boundDeviceCafe) {
    return boundDeviceCafe;
  }

  if (role === "CAFE_ADMIN") {
    return user.primaryCafeId || user.assignedCafeIds?.[0] || "";
  }

  return user.assignedCafeIds?.[0] || user.primaryCafeId || "";
}

function getOperatorSession() {
  const user = state.auth?.user || state.user || {};
  const resolvedCafe = resolvePosCafeId();
  return {
    operatorUserId: user.userId || "",
    operatorName: user.name || "Operator",
    role: user.role || state.role || "CAFE_ADMIN",
    primaryCafeId: resolvedCafe,
    primaryCafeName: user.primaryCafeName || (resolvedCafe ? `Outlet ${resolvedCafe}` : "Café Outlet"),
    deviceId: user.deviceId || "DEV-POS-01",
    businessDate: new Date().toISOString().slice(0, 10),
  };
}

// Master menu catalogue (Loaded dynamically from database)
let _menuCatalogue = [];

// POS State
let cart = []; // Array of { lineId, item, qty, modifiers, notes }
let activeServiceMode = "QUICK_SALE"; // QUICK_SALE | DINE_IN | TAKEAWAY | STAFF_MEAL | COMPLIMENTARY
let activeTable = "Table 01 (Indoor)";
let activeToken = "A-101";
let guestCovers = 2;
let activeCategory = "ALL";
let activeTender = "UPI"; // UPI | CASH | CARD | COMPLIMENTARY | SPLIT
let searchQuery = "";
let isCompactMode = false;
let discountPaisa = 0;
let discountReason = "";
let isPaymentInProgress = false;

// Subview state
let activeMainView = "POS"; // POS | PAST_ORDERS | REGISTER | DAILY_CLOSE
let pastOrdersTab = "ORDERS"; // ORDERS | STATS | CALENDAR
let pastOrdersStats = null;
let pastOrdersList = [];
let pastOrdersSearch = "";
let pastOrdersStatus = "ALL";
let salesCalendarData = null;
let activeRegisterSession = null;
let openTicketsList = [];
let openTicketsFilter = "ALL";
let openTicketsSearch = "";

// REC-13 Offline Queue State & CTL-08 Sync Control
let _offlinePendingCount = 0;

// UPI Assistant State
let upiState = "READY"; // READY | GENERATING | PRESENTED | CONFIRMING | PAID | EXPIRED | FAILED
let cashReceivedAmount = 0;
let isMobileTicketOpen = false;

function escapeHtml(str) {
  if (typeof str !== "string") return "";
  return str.replace(/[&<>'"]/g, (tag) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;",
  }[tag] || tag));
}

export function renderPOS() {
  if (activeMainView === "PAST_ORDERS") {
    return renderPastOrdersView();
  }
  return renderTerminalView();
}


function renderTerminalView() {
  const isCafeOps = state.role === ROLES.CAFE_ADMIN;
  const operator = getOperatorSession();
  const operatorName = operator?.operatorName || state.user?.name || "Duty Operator";
  const operatorEmpId = operator?.operatorUserId || state.user?.employeeId || "—";
  const cafeName = isCafeOps ? `📍 ${operator?.primaryCafeName || 'Café Outlet'}` : "☕ Zamorin Master POS Terminal · All Outlets";
  const deviceName = operator?.deviceId ? `Register · ${operator.deviceId}` : "Active Register";
  const businessDateStr = new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date());

  const filteredItems = _menuCatalogue.filter((item) => {
    const matchesCat = activeCategory === "ALL" || item.category === activeCategory;
    const matchesSearch = !searchQuery ||
      item.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.code.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesCat && matchesSearch;
  });

  const subtotal = cart.reduce((acc, line) => {
    const modPrice = line.modifiers?.modifierPricePaisa ? line.modifiers.modifierPricePaisa / 100 : 0;
    return acc + (line.item.price + modPrice) * line.qty;
  }, 0);

  const isZeroCollectMode = (activeServiceMode === "STAFF_MEAL" || activeServiceMode === "COMPLIMENTARY" || activeTender === "COMPLIMENTARY" || activeTender === "STAFF_MEAL");
  const discount = isZeroCollectMode ? subtotal : Math.round(discountPaisa / 100);
  const taxableAmount = Math.max(0, subtotal - discount);
  const gst = isZeroCollectMode ? 0 : Math.round(taxableAmount * 0.05);
  const grandTotal = isZeroCollectMode ? 0 : (taxableAmount + gst);

  const categories = ["ALL", "Hot Coffees", "Cold Brews", "Bakery & Viennoiserie", "Savouries & Mains", "Desserts"];
  const totalItemCount = cart.reduce((a, c) => a + c.qty, 0);

  return `
    <div class="page-enter pos-workspace" style="display:flex;flex-direction:column;gap:12px;min-height:calc(100vh - 90px);">
      <!-- Offline Notice Banner if disconnected -->
      <div id="pos-offline-banner" style="display:${navigator.onLine ? "none" : "flex"};background:var(--danger);color:#ffffff;padding:8px 16px;border-radius:var(--radius-sm);align-items:center;justify-content:space-between;font-size:12px;font-weight:700;">
        <span>⚠️ TERMINAL OFFLINE — Cached menu active. Cash payments only permitted. Card/UPI disabled.</span>
        <span style="font-family:var(--font-mono);font-size:11px;">0 Pending Sync</span>
      </div>

      ${state.isTrainingMode ? `
        <div id="pos-training-banner" style="display:flex;background:#fffbeb;border:1px solid #fde68a;color:#b45309;padding:8px 14px;border-radius:var(--radius-sm);align-items:center;justify-content:space-between;font-size:12px;font-weight:700;">
          <span>⚠️ ISOLATED TRAINING MODE ACTIVE — Practice orders do not post to live General Ledger or register cash.</span>
          <button id="exit-training-mode-banner-btn" class="btn btn-sm" style="font-size:11px;padding:2px 8px;background:#f59e0b;color:#ffffff;font-weight:700;" type="button">Exit Training</button>
        </div>
      ` : ""}

      <!-- Area 1: Fixed Operational Context Bar (§10, §17, §18) -->
      <div class="card" style="padding:10px 16px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;background:var(--surface);border:1px solid var(--line);">
        <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
          <div style="display:flex;align-items:center;gap:8px;">
            <span style="font-size:20px;">⚡</span>
            <div>
              <strong style="font-size:14px;color:var(--ink);display:block;line-height:1.2;">${cafeName}</strong>
              <span style="font-size:11px;color:var(--muted);font-family:var(--font-mono);">${deviceName} · ${businessDateStr}</span>
            </div>
          </div>

          <div style="height:24px;width:1px;background:var(--line);display:inline-block;"></div>

          <!-- Operator Attribution (§14, §15) -->
          <div style="display:flex;align-items:center;gap:6px;background:var(--surface-sunken);padding:3px 8px;border-radius:var(--radius-sm);border:1px solid var(--line);">
            <span style="font-size:11px;">👤</span>
            <span style="font-size:11.5px;font-weight:700;color:var(--ink);">${operatorName}</span>
            <span style="font-size:10px;color:var(--muted);font-family:var(--font-mono);">(${operatorEmpId})</span>
          </div>

          <!-- Service Mode Button Group (§19–§23) -->
          <div class="pos-service-btn-group" style="display:inline-flex;align-items:center;gap:6px;flex-wrap:wrap;">
            ${[
              { id: "QUICK_SALE", icon: "⚡", label: "Quick Sale" },
              { id: "DINE_IN", icon: "🍽️", label: "Dine-In" },
              { id: "TAKEAWAY", icon: "🛍️", label: "Takeaway" },
              { id: "STAFF_MEAL", icon: "🥗", label: "Staff Meal" },
              { id: "COMPLIMENTARY", icon: "🎁", label: "Complimentary" },
            ].map((m) => `
              <button
                class="pos-service-mode-btn ${activeServiceMode === m.id ? "active" : ""}"
                data-service-mode="${m.id}"
                style="
                  display:inline-flex;
                  align-items:center;
                  gap:6px;
                  border:1.5px solid ${activeServiceMode === m.id ? "var(--ink, #18181b)" : "var(--line, #e2e8f0)"};
                  outline:none;
                  cursor:pointer;
                  padding:6px 12px;
                  font-size:12px;
                  font-weight:700;
                  font-family:inherit;
                  border-radius:8px;
                  transition:all 0.15s ease;
                  line-height:1.2;
                  background:${activeServiceMode === m.id ? "var(--ink, #18181b)" : "var(--surface, #ffffff)"};
                  color:${activeServiceMode === m.id ? "#ffffff" : "var(--ink, #1e293b)"};
                  box-shadow:${activeServiceMode === m.id ? "0 2px 5px rgba(0,0,0,0.18)" : "0 1px 2px rgba(0,0,0,0.05)"};
                "
                type="button"
              >
                <span style="font-size:13px;line-height:1;">${m.icon}</span>
                <span>${m.label}</span>
              </button>
            `).join("")}
          </div>

          <!-- Dine-In / Takeaway / Special Metadata Controls -->
          ${activeServiceMode === "DINE_IN" ? `
            <div style="display:flex;align-items:center;gap:6px;">
              <select id="pos-table-picker" class="select" style="font-size:11.5px;padding:3px 8px;font-weight:700;">
                <option value="Table 01 (Indoor)" ${activeTable === "Table 01 (Indoor)" ? "selected" : ""}>Table 01 (Indoor)</option>
                <option value="Table 02 (Indoor)" ${activeTable === "Table 02 (Indoor)" ? "selected" : ""}>Table 02 (Indoor)</option>
                <option value="Table 03 (Patio)" ${activeTable === "Table 03 (Patio)" ? "selected" : ""}>Table 03 (Patio)</option>
                <option value="Table 04 (Indoor)" ${activeTable === "Table 04 (Indoor)" ? "selected" : ""}>Table 04 (Indoor)</option>
                <option value="Table 05 (Patio)" ${activeTable === "Table 05 (Patio)" ? "selected" : ""}>Table 05 (Patio)</option>
              </select>
              <select id="pos-covers-picker" class="select" style="font-size:11.5px;padding:3px 6px;">
                ${[1, 2, 3, 4, 5, 6, 8].map((c) => `<option value="${c}" ${guestCovers === c ? "selected" : ""}>${c}p</option>`).join("")}
              </select>
            </div>
          ` : activeServiceMode === "TAKEAWAY" ? `
            <div style="display:flex;align-items:center;gap:6px;">
              <span style="font-size:11.5px;font-weight:700;color:var(--ink);background:var(--surface-sunken);padding:3px 8px;border-radius:4px;border:1px solid var(--line);">
                Token: ${activeToken}
              </span>
            </div>
          ` : activeServiceMode === "STAFF_MEAL" ? `
            <div style="display:flex;align-items:center;gap:6px;">
              <span style="font-size:11px;font-weight:700;color:var(--success);background:var(--surface-sunken);padding:3px 8px;border-radius:4px;border:1px solid var(--line);">
                🥗 100% Staff Meal · Zero Collection
              </span>
            </div>
          ` : activeServiceMode === "COMPLIMENTARY" ? `
            <div style="display:flex;align-items:center;gap:6px;">
              <span style="font-size:11px;font-weight:700;color:var(--bronze-600);background:var(--surface-sunken);padding:3px 8px;border-radius:4px;border:1px solid var(--line);">
                🎁 Complimentary / Sampling · Zero Collection
              </span>
            </div>
          ` : ""}
        </div>

        <!-- Top Right Actions -->
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
          <button class="pos-service-mode-btn ${state.isTrainingMode ? 'active' : ''}" id="toggle-training-mode-btn" style="padding:6px 12px;font-size:12px; ${state.isTrainingMode ? 'background:#fef3c7; color:#92400e; border-color:#f59e0b;' : ''}" type="button" title="Toggle Isolated Training Mode (Practice without affecting live sales)">
            🎓 ${state.isTrainingMode ? 'Training ACTIVE' : 'Training Mode'}
          </button>
          <button class="pos-service-mode-btn" id="open-tickets-btn" style="padding:6px 12px;font-size:12px;" type="button">
            📋 Open Tickets ${openTicketsList.length ? `<span class="badge warning" style="font-size:9.5px;margin-left:4px;">${openTicketsList.length}</span>` : ""}
          </button>
          <button class="pos-service-mode-btn" id="register-session-btn" style="padding:6px 12px;font-size:12px;" type="button">
            💵 Cash Drawer
          </button>
          <button class="pos-service-mode-btn" id="pos-reprint-last-btn" style="padding:6px 12px;font-size:12px;" title="Reprint Last Finalized Receipt" type="button">
            🔁 Reprint Last
          </button>
          <button class="btn btn-sm btn-secondary" id="view-past-orders-btn" style="font-size:12px;padding:6px 12px;font-weight:700;min-height:32px;" type="button">
            📜 Past Orders
          </button>
          <button class="pos-service-mode-btn" id="toggle-density-btn" style="padding:6px 10px;font-size:12px;" title="Toggle Compact Mode" type="button">
            ${isCompactMode ? "🖼️ Visual" : "☷ Compact"}
          </button>
          <div id="pos-offline-status-container" style="display:inline-flex;align-items:center;gap:6px;">
            <span id="pos-offline-badge" style="display:inline-flex;align-items:center;gap:4px;padding:3px 8px;border-radius:6px;font-size:11px;font-weight:700;background:${_offlinePendingCount > 0 ? "rgba(245,158,11,0.15)" : (navigator?.onLine ? "rgba(16,185,129,0.12)" : "rgba(239,68,68,0.15)")};color:${_offlinePendingCount > 0 ? "#b45309" : (navigator?.onLine ? "#059669" : "#dc2626")};">
              ${_offlinePendingCount > 0 ? `⚠️ Offline — ${_offlinePendingCount} waiting to sync` : (navigator?.onLine ? "🟢 Online" : "🔴 Offline")}
            </span>
            <button class="pos-service-mode-btn" id="pos-sync-queue-btn" style="padding:4px 10px;font-size:11px;font-weight:700;display:${_offlinePendingCount > 0 ? "inline-flex" : "none"};background:var(--bronze-600);color:#ffffff;border:none;border-radius:6px;cursor:pointer;" title="Sync Pending Sales (CTL-08)" type="button">
              🔄 Sync Pending (${_offlinePendingCount})
            </button>
          </div>
        </div>
      </div>

      <!-- Main Split Selling Layout (§107–§112) -->
      <div class="pos-grid-layout" style="display:grid;grid-template-columns:1fr 390px;gap:14px;flex:1;align-items:start;">
        <!-- Left Column: Menu Search, Categories, Product Cards -->
        <div class="card" style="padding:16px;display:flex;flex-direction:column;gap:12px;background:var(--surface);border:1px solid var(--line);">
          <!-- Search & Category Filter Bar (§24–§27) -->
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
            <div style="position:relative;flex:1;min-width:220px;">
              <input type="text" id="pos-menu-search" class="input" placeholder="Search menu or code (PO-01)..." value="${escapeHtml(searchQuery)}" style="font-size:12.5px;padding:6px 28px 6px 30px;" />
              <span style="position:absolute;left:10px;top:50%;transform:translateY(-50%);font-size:12px;color:var(--muted);">🔍</span>
              ${searchQuery ? `
                <button id="pos-clear-search" style="position:absolute;right:8px;top:50%;transform:translateY(-50%);background:none;border:none;color:var(--muted);cursor:pointer;font-size:14px;" type="button">✕</button>
              ` : ""}
            </div>
            <!-- Horizontal Scrollable Category Chips (§27) -->
            <div style="display:flex;gap:6px;overflow-x:auto;padding-bottom:2px;max-width:100%;-webkit-overflow-scrolling:touch;">
              ${categories.map((cat) => `
                <button
                  class="pos-cat-pill-btn ${activeCategory === cat ? "active" : ""}"
                  data-pos-cat="${cat}"
                  style="
                    display:inline-flex;
                    align-items:center;
                    gap:4px;
                    border:1.5px solid ${activeCategory === cat ? "var(--ink, #18181b)" : "var(--line, #e2e8f0)"};
                    outline:none;
                    cursor:pointer;
                    padding:5px 13px;
                    font-size:11.5px;
                    font-weight:700;
                    font-family:inherit;
                    border-radius:20px;
                    white-space:nowrap;
                    transition:all 0.15s ease;
                    background:${activeCategory === cat ? "var(--ink, #18181b)" : "var(--surface, #ffffff)"};
                    color:${activeCategory === cat ? "#ffffff" : "var(--ink, #1e293b)"};
                    box-shadow:${activeCategory === cat ? "0 2px 4px rgba(0,0,0,0.15)" : "0 1px 2px rgba(0,0,0,0.04)"};
                  "
                  type="button"
                >
                  ${cat === "ALL" ? "☕ All Items" : cat}
                </button>
              `).join("")}
            </div>
          </div>

          <!-- Product Cards Responsive Grid (§28–§31) -->
          <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(${isCompactMode ? "140px" : "175px"},1fr));gap:10px;overflow-y:auto;max-height:calc(100vh - 255px);padding-right:2px;">
            ${filteredItems.length ? filteredItems.map((item) => `
              <div class="card interactive pos-item-card" data-select-product="${item.id}" style="padding:${isCompactMode ? "8px" : "12px"};cursor:pointer;display:flex;flex-direction:column;justify-content:space-between;border:1.5px solid var(--line);background:var(--surface);transition:all 0.12s ease;border-radius:8px;min-height:96px;box-shadow:var(--shadow-xs);">
                <div>
                  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
                    <span class="status ${item.foodType === "Non-Veg" ? "danger" : "success"}" style="font-size:9px;padding:1px 4px;font-weight:800;border-radius:3px;">
                      ${item.foodType}
                    </span>
                    <span style="font-family:var(--font-mono);font-size:10px;color:var(--muted);">${item.code}</span>
                  </div>
                  <strong style="font-size:13px;color:var(--ink);display:block;margin-bottom:2px;line-height:1.25;">${item.name}</strong>
                  ${item.hasModifiers ? `<span style="font-size:10px;color:var(--bronze-600);font-weight:700;">✦ Customisable</span>` : ""}
                </div>
                <div style="display:flex;justify-content:space-between;align-items:center;margin-top:8px;border-top:1px dashed var(--line);padding-top:5px;">
                  <span style="font-family:var(--font-mono);font-weight:800;font-size:14px;color:var(--ink);">₹${item.price}</span>
                  <span class="btn btn-sm btn-primary" style="padding:2px 8px;font-size:10.5px;font-weight:700;border-radius:6px;">+ Add</span>
                </div>
              </div>
            `).join("") : `
              <div style="grid-column:1/-1;text-align:center;padding:48px 10px;color:var(--muted);">
                ${searchQuery ? `
                  <p style="font-size:13px;margin:0;">No menu items match "<strong>${escapeHtml(searchQuery)}</strong>"</p>
                  <button class="btn btn-sm btn-secondary" id="pos-reset-search-btn" style="margin-top:8px;font-size:11.5px;" type="button">Clear Search</button>
                ` : `
                  <div style="font-size:32px;margin-bottom:8px;">☕</div>
                  <strong style="font-size:14px;display:block;color:var(--ink);">No Menu Products Configured</strong>
                  <p style="font-size:12px;margin:4px 0 0;">Create products in Menu Management or configure your café POS catalogue.</p>
                `}
              </div>
            `}
          </div>
        </div>

        <!-- Right Column: Active Order Ticket & Checkout Assistant (§42–§85) -->
        <div class="card pos-ticket-panel" style="padding:16px;display:flex;flex-direction:column;justify-content:space-between;background:var(--surface);border:1px solid var(--line);position:sticky;top:70px;border-radius:12px;box-shadow:var(--shadow-sm);">
          <div>
            <!-- Ticket Header & Quick Actions (§48–§50) -->
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;padding-bottom:8px;border-bottom:1px solid var(--line);">
              <div>
                <h2 style="font-size:15px;font-weight:800;margin:0;color:var(--ink);">Active Order Ticket</h2>
                <span style="font-size:11px;color:var(--muted);">
                  ${activeServiceMode === "DINE_IN" ? `${activeTable} · ${guestCovers} Covers` : activeServiceMode === "TAKEAWAY" ? `Takeaway Token ${activeToken}` : "Quick Sale · Counter"}
                </span>
              </div>
              <div style="display:flex;gap:5px;">
                <button class="pos-service-mode-btn" id="hold-ticket-btn" ${!cart.length ? "disabled" : ""} style="font-size:11px;padding:3px 8px;" title="Park ticket on hold" type="button">⏸️ Hold</button>
                <button class="pos-service-mode-btn" id="clear-ticket-btn" ${!cart.length ? "disabled" : ""} style="font-size:11px;padding:3px 8px;color:var(--danger);" type="button">Clear</button>
              </div>
            </div>

            <!-- Cart Line Items (§42–§47) -->
            <div id="pos-ticket-items" style="max-height:calc(100vh - 430px);overflow-y:auto;display:flex;flex-direction:column;gap:6px;padding-right:2px;">
              ${cart.length ? cart.map((line) => {
                const modPrice = line.modifiers?.modifierPricePaisa ? line.modifiers.modifierPricePaisa / 100 : 0;
                const unitTotal = line.item.price + modPrice;
                const lineTotal = unitTotal * line.qty;
                const modSummary = line.modifiers ? [
                  line.modifiers.size !== "Regular" ? line.modifiers.size : null,
                  line.modifiers.milk !== "Standard" ? line.modifiers.milk : null,
                  line.modifiers.temperature !== "Hot" ? line.modifiers.temperature : null,
                  line.modifiers.sweetness !== "Regular" ? line.modifiers.sweetness : null,
                  ...(line.modifiers.addOns || []),
                ].filter(Boolean).join(", ") : "";

                return `
                  <div style="display:flex;justify-content:space-between;align-items:flex-start;padding:6px 0;border-bottom:1px solid var(--line);">
                    <div style="flex:1;padding-right:6px;">
                      <div style="display:flex;align-items:center;gap:6px;">
                        <strong style="font-size:13px;color:var(--ink);">${line.item.name}</strong>
                        ${line.item.hasModifiers ? `
                          <button class="btn btn-sm btn-ghost" data-edit-line-mods="${line.lineId}" style="padding:0 4px;font-size:10px;color:var(--bronze-600);height:18px;" type="button">✎ Edit</button>
                        ` : ""}
                      </div>
                      ${modSummary ? `<div style="font-size:10.5px;color:var(--bronze-600);font-weight:600;line-height:1.2;">↳ ${modSummary}</div>` : ""}
                      ${line.notes ? `<div style="font-size:10px;color:var(--muted);font-style:italic;">Note: ${escapeHtml(line.notes)}</div>` : ""}
                      <div style="font-size:11px;color:var(--muted);font-family:var(--font-mono);margin-top:2px;">₹${unitTotal} × ${line.qty}</div>
                    </div>
                    <div style="display:flex;align-items:center;gap:3px;">
                      <button class="btn btn-sm btn-ghost" data-dec-line="${line.lineId}" style="padding:1px 6px;font-size:11px;min-height:26px;" type="button">−</button>
                      <span style="font-family:var(--font-mono);font-weight:800;font-size:12.5px;min-width:14px;text-align:center;">${line.qty}</span>
                      <button class="btn btn-sm btn-ghost" data-inc-line="${line.lineId}" style="padding:1px 6px;font-size:11px;min-height:26px;" type="button">+</button>
                      <button class="btn btn-sm btn-ghost" data-dup-line="${line.lineId}" title="Duplicate line" style="padding:1px 4px;font-size:10px;min-height:26px;" type="button">⎘</button>
                      <span style="font-family:var(--font-mono);font-weight:800;font-size:13.5px;min-width:55px;text-align:right;color:var(--ink);">₹${lineTotal}</span>
                    </div>
                  </div>
                `;
              }).join("") : `
                <div style="text-align:center;padding:36px 10px;color:var(--muted);">
                  <div style="font-size:28px;margin-bottom:6px;">🛒</div>
                  <strong style="font-size:13px;display:block;color:var(--ink);">Order Ticket is Empty</strong>
                  <p style="font-size:11px;margin:4px 0 0;">Select products from the menu to build an order.</p>
                </div>
              `}
            </div>
          </div>

          <!-- Financial Calculation & Payment Assistant (§59–§85) -->
          <div style="margin-top:10px;border-top:2px solid var(--line);padding-top:10px;">
            <div style="display:flex;justify-content:space-between;font-size:12px;color:var(--muted);margin-bottom:2px;">
              <span>Subtotal (${totalItemCount} items)</span>
              <span style="font-family:var(--font-mono);">₹${subtotal.toLocaleString("en-IN")}</span>
            </div>

            ${discount > 0 ? `
              <div style="display:flex;justify-content:space-between;font-size:12px;color:var(--danger);margin-bottom:2px;">
                <span>Discount (${escapeHtml(discountReason || "Applied")})</span>
                <span style="font-family:var(--font-mono);">-₹${discount.toLocaleString("en-IN")}</span>
              </div>
            ` : ""}

            <div style="display:flex;justify-content:space-between;font-size:12px;color:var(--muted);margin-bottom:6px;">
              <span>GST (CGST 2.5% + SGST 2.5%)</span>
              <span style="font-family:var(--font-mono);">₹${gst.toLocaleString("en-IN")}</span>
            </div>

            <div style="display:flex;justify-content:space-between;align-items:center;font-size:16px;font-weight:900;color:var(--ink);margin-bottom:10px;padding-top:4px;border-top:1px dashed var(--line);">
              <span>Total Payable</span>
              <span style="font-family:var(--font-mono);color:var(--bronze-600);font-size:19px;">₹${grandTotal.toLocaleString("en-IN")}</span>
            </div>

            <!-- Tenders Grid (§71–§85) -->
            <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:4px;margin-bottom:8px;">
              ${[
                { id: "UPI", label: "📱 UPI" },
                { id: "CASH", label: "💵 Cash" },
                { id: "CARD", label: "💳 Card" },
                { id: "COMPLIMENTARY", label: "🎁 Free" },
                { id: "SPLIT", label: "✂️ Split" },
              ].map((t) => `
                <button
                  class="pos-service-mode-btn ${activeTender === t.id ? "active" : ""}"
                  data-select-tender="${t.id}"
                  style="
                    display:inline-flex;
                    justify-content:center;
                    align-items:center;
                    gap:4px;
                    border:1.5px solid ${activeTender === t.id ? "var(--ink, #18181b)" : "var(--line, #e2e8f0)"};
                    outline:none;
                    cursor:pointer;
                    padding:7px 4px;
                    font-size:11px;
                    font-weight:700;
                    font-family:inherit;
                    border-radius:8px;
                    transition:all 0.15s ease;
                    line-height:1.2;
                    background:${activeTender === t.id ? "var(--ink, #18181b)" : "var(--surface, #ffffff)"};
                    color:${activeTender === t.id ? "#ffffff" : "var(--ink, #1e293b)"};
                    box-shadow:${activeTender === t.id ? "0 2px 5px rgba(0,0,0,0.18)" : "0 1px 2px rgba(0,0,0,0.05)"};
                  "
                  type="button"
                >
                  ${t.label}
                </button>
              `).join("")}
            </div>

            <!-- Cash Assistant Row (§76–§80) -->
            ${activeTender === "CASH" && grandTotal > 0 ? `
              <div style="background:var(--surface-sunken);padding:8px 10px;border-radius:8px;margin-bottom:8px;border:1px solid var(--line);">
                <div style="display:flex;gap:6px;margin-bottom:6px;flex-wrap:wrap;">
                  <button class="pos-service-mode-btn" data-quick-cash="${grandTotal}" style="font-size:11px;padding:3px 8px;">Exact</button>
                  <button class="pos-service-mode-btn" data-quick-cash="500" style="font-size:11px;padding:3px 8px;">₹500</button>
                  <button class="pos-service-mode-btn" data-quick-cash="1000" style="font-size:11px;padding:3px 8px;">₹1,000</button>
                  <button class="pos-service-mode-btn" data-quick-cash="2000" style="font-size:11px;padding:3px 8px;">₹2,000</button>
                </div>
                <div style="display:flex;justify-content:space-between;align-items:center;font-size:12px;">
                  <span>Received: <strong>₹${cashReceivedAmount || grandTotal}</strong></span>
                  <span style="color:var(--success);font-weight:800;">Change: ₹${Math.max(0, (cashReceivedAmount || grandTotal) - grandTotal)}</span>
                </div>
              </div>
            ` : ""}

            <!-- Action Buttons Grid: Preview, Save, and Save & Print with Duplicate-Lock -->
            <div style="display:grid;grid-template-columns:1fr 1fr 1.6fr;gap:6px;">
              <button class="btn btn-secondary" id="preview-receipt-btn" ${!cart.length || (grandTotal <= 0 && !isZeroCollectMode) ? "disabled" : ""} style="padding:10px 4px;font-size:12px;font-weight:700;min-height:46px;border-radius:8px;" type="button">
                👁️ Preview
              </button>
              <button class="btn btn-secondary" id="pos-save-only-btn" ${!cart.length || (grandTotal <= 0 && !isZeroCollectMode) || isPaymentInProgress ? "disabled" : ""} style="padding:10px 4px;font-size:12px;font-weight:700;min-height:46px;border-radius:8px;" type="button">
                💾 Save
              </button>
              <button class="btn btn-primary" id="process-charge-btn" ${!cart.length || (grandTotal <= 0 && !isZeroCollectMode) || isPaymentInProgress ? "disabled" : ""} style="padding:10px 6px;font-size:12.5px;font-weight:800;min-height:46px;border-radius:8px;box-shadow:0 2px 6px rgba(0,0,0,0.15);" type="button">
                ${isPaymentInProgress ? "Finalizing…" : (isZeroCollectMode ? `🎁 Finalize ${activeServiceMode === 'STAFF_MEAL' ? 'Staff Meal' : 'Complimentary'}` : `⚡ Save & Print ₹${grandTotal.toLocaleString("en-IN")}`)}
              </button>
            </div>
          </div>
        </div>
      </div>


      <!-- Mobile Sticky Ticket Summary Bar (§107, §108) -->
      <div id="pos-mobile-ticket-bar" style="display:none;position:fixed;bottom:0;left:0;right:0;background:var(--surface);border-top:2px solid var(--bronze-500);padding:10px 16px;z-index:90;box-shadow:0 -4px 16px rgba(0,0,0,0.15);justify-content:space-between;align-items:center;">
        <div>
          <strong style="font-size:14px;color:var(--ink);display:block;">${totalItemCount} items · ₹${grandTotal.toLocaleString("en-IN")}</strong>
          <span style="font-size:11px;color:var(--muted);">${activeServiceMode}</span>
        </div>
        <button class="btn btn-sm btn-primary" id="mobile-view-ticket-btn" style="padding:6px 14px;font-weight:800;font-size:13px;" type="button">
          View Ticket 🛒
        </button>
      </div>
    </div>
  `;
}

// -----------------------------------------------------------------------------
// PAST ORDERS & SALES HISTORY SUBVIEW (§91–§97)
// -----------------------------------------------------------------------------
function renderPastOrdersView() {
  const stats = pastOrdersStats || {
    today: { orderCount: 0, grossSalesPaisa: 0, netSalesPaisa: 0, averageBillPaisa: 0 },
    thisMonth: { orderCount: 0, grossSalesPaisa: 0, netSalesPaisa: 0, averageBillPaisa: 0 },
    thisYear: { orderCount: 0, grossSalesPaisa: 0, netSalesPaisa: 0, averageBillPaisa: 0 },
    currentFY: { label: "FY 2026-27", orderCount: 0, grossSalesPaisa: 0, netSalesPaisa: 0, averageBillPaisa: 0 },
  };

  const isMaster = state.role === ROLES.MASTER || state.role === ROLES.OWNER;

  return `
    <div class="page-enter past-orders-workspace" style="display:flex;flex-direction:column;gap:16px;">
      <!-- Header -->
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;">
        <div>
          <h1 class="page-title" style="font-size:20px;font-weight:800;margin:0 0 2px;color:var(--ink);">Past Orders & Sales History</h1>
          <p style="font-size:12.5px;color:var(--muted);margin:0;">Authoritative transaction audit, thermal receipt reprint, refunds, and daily close records.</p>
        </div>
        <div style="display:flex;gap:8px;">
          <button class="btn btn-sm btn-primary" id="back-to-pos-btn" style="font-size:12.5px;padding:6px 14px;font-weight:700;" type="button">
            ⬅ Return to Live POS
          </button>
        </div>
      </div>

      <!-- 4 Primary KPI Summary Cards -->
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px;">
        <div class="card" style="padding:14px;border-left:4px solid var(--bronze-500);background:var(--surface);">
          <span style="font-size:11px;color:var(--muted);font-weight:700;text-transform:uppercase;">Orders Today</span>
          <div style="display:flex;justify-content:space-between;align-items:baseline;margin-top:4px;">
            <strong style="font-size:22px;font-family:var(--font-mono);color:var(--ink);">${stats.today.orderCount}</strong>
            <span style="font-size:13px;font-weight:700;color:var(--bronze-600);">₹${(stats.today.netSalesPaisa / 100).toLocaleString("en-IN")}</span>
          </div>
          <span style="font-size:10.5px;color:var(--muted);margin-top:2px;display:block;">Avg Bill: ₹${(stats.today.averageBillPaisa / 100).toFixed(0)}</span>
        </div>

        <div class="card" style="padding:14px;border-left:4px solid var(--mint-500);background:var(--surface);">
          <span style="font-size:11px;color:var(--muted);font-weight:700;text-transform:uppercase;">Orders This Month</span>
          <div style="display:flex;justify-content:space-between;align-items:baseline;margin-top:4px;">
            <strong style="font-size:22px;font-family:var(--font-mono);color:var(--ink);">${stats.thisMonth.orderCount}</strong>
            <span style="font-size:13px;font-weight:700;color:var(--mint-600);">₹${(stats.thisMonth.netSalesPaisa / 100).toLocaleString("en-IN")}</span>
          </div>
          <span style="font-size:10.5px;color:var(--muted);margin-top:2px;display:block;">Avg Bill: ₹${(stats.thisMonth.averageBillPaisa / 100).toFixed(0)}</span>
        </div>

        <div class="card" style="padding:14px;border-left:4px solid var(--lavender-500);background:var(--surface);">
          <span style="font-size:11px;color:var(--muted);font-weight:700;text-transform:uppercase;">Orders This Year</span>
          <div style="display:flex;justify-content:space-between;align-items:baseline;margin-top:4px;">
            <strong style="font-size:22px;font-family:var(--font-mono);color:var(--ink);">${stats.thisYear.orderCount}</strong>
            <span style="font-size:13px;font-weight:700;color:var(--ink-700);">₹${(stats.thisYear.netSalesPaisa / 100).toLocaleString("en-IN")}</span>
          </div>
          <span style="font-size:10.5px;color:var(--muted);margin-top:2px;display:block;">Avg Bill: ₹${(stats.thisYear.averageBillPaisa / 100).toFixed(0)}</span>
        </div>

        <div class="card" style="padding:14px;border-left:4px solid var(--amber-500);background:var(--surface);">
          <span style="font-size:11px;color:var(--muted);font-weight:700;text-transform:uppercase;">Current ${stats.currentFY.label}</span>
          <div style="display:flex;justify-content:space-between;align-items:baseline;margin-top:4px;">
            <strong style="font-size:22px;font-family:var(--font-mono);color:var(--ink);">${stats.currentFY.orderCount}</strong>
            <span style="font-size:13px;font-weight:700;color:var(--amber-700);">₹${(stats.currentFY.netSalesPaisa / 100).toLocaleString("en-IN")}</span>
          </div>
          <span style="font-size:10.5px;color:var(--muted);margin-top:2px;display:block;">Avg Bill: ₹${(stats.currentFY.averageBillPaisa / 100).toFixed(0)}</span>
        </div>
      </div>

      <!-- Navigation Tabs for Past Orders -->
      <div style="display:flex;gap:6px;border-bottom:1px solid var(--line);padding-bottom:6px;">
        ${[
          { id: "ORDERS", label: "📜 Orders Register" },
          { id: "CALENDAR", label: "📅 Sales Calendar" },
        ].map((tab) => `
          <button class="btn btn-sm ${pastOrdersTab === tab.id ? "btn-primary" : "btn-ghost"}" data-past-tab="${tab.id}" style="font-size:12px;padding:5px 12px;font-weight:600;" type="button">
            ${tab.label}
          </button>
        `).join("")}
      </div>

      ${pastOrdersTab === "CALENDAR" ? renderSalesCalendarSubTab() : renderPastOrdersListSubTab(isMaster)}
    </div>
  `;
}

function renderPastOrdersListSubTab(isMaster) {
  const filtered = pastOrdersList.filter((o) => {
    const matchesSearch = !pastOrdersSearch ||
      (o.billId && o.billId.toLowerCase().includes(pastOrdersSearch.toLowerCase())) ||
      (o.invoiceNumber && o.invoiceNumber.toLowerCase().includes(pastOrdersSearch.toLowerCase())) ||
      (o.customerName && o.customerName.toLowerCase().includes(pastOrdersSearch.toLowerCase())) ||
      (o.tableNumber && o.tableNumber.toLowerCase().includes(pastOrdersSearch.toLowerCase()));
    const matchesStatus = pastOrdersStatus === "ALL" || o.status === pastOrdersStatus;
    return matchesSearch && matchesStatus;
  });

  return `
    <div class="card" style="padding:16px;display:flex;flex-direction:column;gap:12px;background:var(--surface);border:1px solid var(--line);">
      <!-- Filter Bar -->
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;">
        <div style="display:flex;gap:8px;flex:1;min-width:240px;">
          <input type="text" id="past-orders-search" class="input" placeholder="Search by Bill #, Invoice #, Table or Customer..." value="${escapeHtml(pastOrdersSearch)}" style="font-size:12.5px;padding:5px 10px;" />
        </div>
        <div style="display:flex;gap:6px;">
          <select id="past-orders-status-filter" class="select" style="font-size:12px;padding:4px 8px;">
            <option value="ALL" ${pastOrdersStatus === "ALL" ? "selected" : ""}>All Statuses</option>
            <option value="COMPLETED" ${pastOrdersStatus === "COMPLETED" ? "selected" : ""}>Completed</option>
            <option value="PARTIALLY_REFUNDED" ${pastOrdersStatus === "PARTIALLY_REFUNDED" ? "selected" : ""}>Partially Refunded</option>
            <option value="REFUNDED" ${pastOrdersStatus === "REFUNDED" ? "selected" : ""}>Refunded</option>
            <option value="VOIDED" ${pastOrdersStatus === "VOIDED" ? "selected" : ""}>Voided</option>
          </select>
        </div>
      </div>

      <!-- Orders Table -->
      <div style="overflow-x:auto;">
        <table class="table" style="width:100%;font-size:12px;">
          <thead>
            <tr>
              <th>Bill / Invoice #</th>
              <th>Date & Time</th>
              <th>Service Mode</th>
              <th>Table / Token</th>
              <th>Items</th>
              <th style="text-align:right;">Gross</th>
              <th style="text-align:right;">Net Paid</th>
              <th>Tender</th>
              <th>Status</th>
              <th style="text-align:right;">Actions</th>
            </tr>
          </thead>
          <tbody>
            ${filtered.length ? filtered.map((o) => `
              <tr>
                <td>
                  <strong style="font-family:var(--font-mono);color:var(--ink);">${o.invoiceNumber || o.billId}</strong>
                </td>
                <td style="color:var(--muted);">${new Date(o.createdAt || Date.now()).toLocaleDateString("en-IN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</td>
                <td><span class="badge secondary" style="font-size:10px;">${o.serviceMode || o.orderType || "QUICK_SALE"}</span></td>
                <td>${o.tableNumber || o.tableToken || "Counter"}</td>
                <td>${o.lineItems?.length || 1} items</td>
                <td style="text-align:right;font-family:var(--font-mono);">₹${((o.subtotalPaisa + (o.taxPaisa || 0)) / 100).toFixed(0)}</td>
                <td style="text-align:right;font-family:var(--font-mono);font-weight:800;color:var(--ink);">₹${(o.totalPaisa / 100).toFixed(0)}</td>
                <td><span class="badge" style="font-size:10px;">${o.paymentMethod || "CASH"}</span></td>
                <td>
                  <span class="status ${o.status === "COMPLETED" ? "success" : o.status === "REFUNDED" ? "danger" : o.status === "VOIDED" ? "danger" : "warning"}" style="font-size:9.5px;">
                    ${o.status}
                  </span>
                </td>
                <td style="text-align:right;">
                  <div style="display:flex;gap:3px;justify-content:flex-end;">
                    <button class="btn btn-sm btn-ghost" data-inspect-bill="${o.billId}" style="padding:2px 5px;font-size:11px;" title="View 360 Detail" type="button">👁️</button>
                    <button class="btn btn-sm btn-ghost" data-reprint-bill="${o.billId}" style="padding:2px 5px;font-size:11px;" title="Reprint Receipt" type="button">🖨️</button>
                    ${o.status === "COMPLETED" ? `
                      <button class="btn btn-sm btn-ghost" data-refund-bill="${o.billId}" style="padding:2px 5px;font-size:11px;color:var(--danger);" title="Issue Refund" type="button">↩️</button>
                    ` : ""}
                    ${isMaster && o.status === "COMPLETED" ? `
                      <button class="btn btn-sm btn-ghost" data-void-bill="${o.billId}" style="padding:2px 5px;font-size:11px;color:var(--danger);" title="Master Void" type="button">🚫</button>
                    ` : ""}
                  </div>
                </td>
              </tr>
            `).join("") : `
              <tr>
                <td colspan="10" style="text-align:center;padding:30px;color:var(--muted);">No matching past orders found.</td>
              </tr>
            `}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function renderSalesCalendarSubTab() {
  const days = salesCalendarData?.days || [];
  return `
    <div class="card" style="padding:16px;display:flex;flex-direction:column;gap:12px;background:var(--surface);border:1px solid var(--line);">
      <h3 style="font-size:15px;font-weight:700;margin:0;color:var(--ink);">Daily Sales Matrix</h3>
      <p style="font-size:12px;color:var(--muted);margin:0;">Aggregated sales count and revenue per operational business date.</p>

      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px;margin-top:8px;">
        ${days.length ? days.map((d) => `
          <div class="card" style="padding:10px;background:var(--surface-sunken);border:1px solid var(--line);text-align:center;">
            <span style="font-size:10.5px;font-weight:700;color:var(--muted);display:block;">${d.date}</span>
            <strong style="font-size:16px;font-family:var(--font-mono);color:var(--ink);display:block;margin:2px 0;">${d.orderCount} orders</strong>
            <span style="font-size:12.5px;font-weight:700;color:var(--bronze-600);">₹${(d.netSalesPaisa / 100).toLocaleString("en-IN")}</span>
          </div>
        `).join("") : `
          <div style="grid-column:1/-1;text-align:center;padding:30px;color:var(--muted);">No sales recorded for this month yet.</div>
        `}
      </div>
    </div>
  `;
}

function renderKdsView() {
  const stations = [
    { id: 'ALL', label: 'All Stations' },
    ...(Array.isArray(kdsStationsList) && kdsStationsList.length > 0
      ? kdsStationsList.map((s) => ({
          id: s.code,
          label: s.isExpediter ? `📋 ${s.name}` : (s.code.includes('HOT') ? `🔥 ${s.name}` : s.code.includes('BEV') ? `☕ ${s.name}` : s.code.includes('BAKE') ? `🥐 ${s.name}` : s.code.includes('DESSERT') ? `🍨 ${s.name}` : `🍳 ${s.name}`),
        }))
      : [
          { id: 'HOT_KITCHEN', label: '🔥 Hot Kitchen' },
          { id: 'BEVERAGE_BAR', label: '☕ Beverage Bar' },
          { id: 'BAKERY_COLD', label: '🥐 Bakery & Cold' },
          { id: 'DESSERT', label: '🍨 Dessert' },
          { id: 'EXPEDITER', label: '📋 Expediter' },
        ]),
  ];

  const tickets = kdsTicketsList || [];
  const activeCount = tickets.filter(t => t.status === 'RECEIVED' || t.status === 'PREPARING').length;
  const readyCount = tickets.filter(t => t.status === 'READY').length;
  const overdueCount = tickets.filter(t => t.isOverdue).length;

  return `
    <div class="page-enter kds-workspace" style="display:flex;flex-direction:column;gap:16px;">
      <!-- KDS Header -->
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;">
        <div>
          <div style="display:flex;align-items:center;gap:10px;">
            <h1 class="page-title" style="font-size:20px;font-weight:800;margin:0;color:var(--ink);">Kitchen Display System (KDS)</h1>
            <span class="badge" style="background:rgba(217,119,6,0.15);color:#d97706;font-weight:700;font-size:11px;padding:3px 8px;border-radius:6px;">Station Line Cook</span>
          </div>
          <p style="font-size:12.5px;color:var(--muted);margin:2px 0 0;">Live order routing, prep timers, allergen alerts & station bump progression.</p>
        </div>
        <div style="display:flex;align-items:center;gap:8px;">
          <button class="btn btn-sm btn-secondary" id="kds-refresh-btn" type="button" style="font-weight:700;">🔄 Refresh</button>
          <button class="btn btn-sm btn-primary" id="back-to-pos-from-kds-btn" style="font-size:12.5px;padding:6px 14px;font-weight:700;" type="button">
            ⬅ Return to Live POS
          </button>
        </div>
      </div>

      <!-- Station Filter Pills & Metrics -->
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;background:var(--surface);padding:10px 14px;border-radius:10px;border:1px solid var(--line);">
        <div style="display:flex;gap:6px;flex-wrap:wrap;">
          ${stations.map(st => `
            <button class="btn btn-sm ${kdsStationFilter === st.id ? 'btn-primary' : 'btn-ghost'}" data-kds-station="${st.id}" style="font-size:12px;font-weight:700;" type="button">
              ${st.label}
            </button>
          `).join('')}
        </div>
        <div style="display:flex;gap:12px;align-items:center;font-size:12px;font-weight:700;">
          <span style="color:var(--ink);">Active: <strong>${activeCount}</strong></span>
          <span style="color:var(--mint, #10b981);">Ready: <strong>${readyCount}</strong></span>
          ${overdueCount > 0 ? `<span style="color:var(--coral, #ef4444);background:rgba(239,68,68,0.1);padding:2px 8px;border-radius:6px;">⚠️ ${overdueCount} Overdue</span>` : ''}
        </div>
      </div>

      <!-- KDS Ticket Grid -->
      <div style="display:grid;grid-template-columns:repeat(auto-fill, minmax(280px, 1fr));gap:14px;align-items:start;">
        ${tickets.length === 0 ? `
          <div style="grid-column:1/-1;text-align:center;padding:60px 20px;color:var(--muted);background:var(--surface);border-radius:10px;border:1px dashed var(--line);">
            <div style="font-size:36px;margin-bottom:8px;">✅</div>
            <div style="font-size:16px;font-weight:700;color:var(--ink);">All Orders Cleared</div>
            <div style="font-size:13px;margin-top:4px;">No pending kitchen tickets for station <strong>${kdsStationFilter}</strong>.</div>
          </div>
        ` : tickets.map(ticket => {
          const ageMin = Math.floor((ticket.ticketAgeSeconds || 0) / 60);
          const isOverdue = ticket.isOverdue || ageMin > (ticket.targetPrepTimeMinutes || 15);
          const timerColor = isOverdue ? '#ef4444' : ageMin >= 10 ? '#f59e0b' : '#10b981';
          const statusBg = ticket.status === 'READY' ? 'rgba(16,185,129,0.15)' : ticket.status === 'PREPARING' ? 'rgba(245,158,11,0.15)' : 'rgba(59,130,246,0.15)';
          const statusColor = ticket.status === 'READY' ? '#10b981' : ticket.status === 'PREPARING' ? '#d97706' : '#2563eb';

          return `
            <div class="card kds-ticket-card" style="padding:14px;background:var(--surface);border:1.5px solid ${isOverdue ? '#ef4444' : 'var(--line)'};border-radius:10px;display:flex;flex-direction:column;gap:10px;">
              <!-- Ticket Header -->
              <div style="display:flex;justify-content:space-between;align-items:flex-start;">
                <div>
                  <div style="font-size:14px;font-weight:800;color:var(--ink);">${escapeHtml(ticket.ticketId)}</div>
                  <div style="font-size:11px;color:var(--muted);font-weight:600;">
                    ${ticket.tableNumber ? `Table: ${escapeHtml(ticket.tableNumber)}` : ticket.orderNumber ? `Order: ${escapeHtml(ticket.orderNumber)}` : 'Takeaway'} · ${ticket.diningOption}
                  </div>
                </div>
                <div style="text-align:right;">
                  <span style="font-size:11.5px;font-weight:800;color:${timerColor};background:rgba(0,0,0,0.05);padding:3px 6px;border-radius:4px;display:inline-block;">
                    ⏱️ ${ageMin}m
                  </span>
                  <div style="margin-top:4px;">
                    <span style="font-size:10px;font-weight:800;color:${statusColor};background:${statusBg};padding:2px 6px;border-radius:4px;text-transform:uppercase;">
                      ${ticket.status}
                    </span>
                  </div>
                </div>
              </div>

              <!-- Station Tag & Rush indicator -->
              <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">
                <span style="font-size:10.5px;font-weight:700;padding:2px 6px;border-radius:4px;background:var(--surface-sunken);color:var(--ink);">
                  📍 ${ticket.prepStation}
                </span>
                ${ticket.priority === 'RUSH' || ticket.priority === 'VIP' ? `
                  <span style="font-size:10px;font-weight:800;background:#ef4444;color:#fff;padding:2px 6px;border-radius:4px;">
                    🔥 ${ticket.priority}
                  </span>
                ` : ''}
              </div>

              <!-- Items Checklist -->
              <div style="display:flex;flex-direction:column;gap:6px;border-top:1px solid var(--line);border-bottom:1px solid var(--line);padding:8px 0;">
                ${(ticket.items || []).map((it, idx) => {
                  const isDone = it.status === 'COMPLETED';
                  return `
                    <div style="display:flex;justify-content:space-between;align-items:flex-start;font-size:12.5px;opacity:${it.isVoided ? '0.4' : '1'};text-decoration:${it.isVoided ? 'line-through' : isDone ? 'line-through' : 'none'};">
                      <div style="display:flex;gap:6px;align-items:baseline;">
                        <strong style="color:var(--ink);min-width:20px;">${it.quantity}x</strong>
                        <div>
                          <span style="color:${isDone ? 'var(--muted)' : 'var(--ink)'};font-weight:600;">${escapeHtml(it.name)}</span>
                          ${it.variant ? `<span style="font-size:10.5px;color:var(--muted);display:block;">${escapeHtml(it.variant)}</span>` : ''}
                          ${it.itemNotes ? `<span style="font-size:10.5px;color:#d97706;font-weight:700;display:block;">⚠️ ${escapeHtml(it.itemNotes)}</span>` : ''}
                          ${Array.isArray(it.allergens) && it.allergens.length ? `<span style="font-size:10px;background:rgba(239,68,68,0.12);color:#dc2626;padding:1px 4px;border-radius:3px;font-weight:700;">Allergen: ${it.allergens.join(', ')}</span>` : ''}
                        </div>
                      </div>
                      ${!it.isVoided ? `
                        <button class="btn btn-xs ${isDone ? 'btn-secondary' : 'btn-ghost'}" data-bump-item="${ticket.ticketId}" data-item-idx="${idx}" style="font-size:10.5px;padding:2px 6px;" type="button">
                          ${isDone ? '✓ Done' : '○ Mark'}
                        </button>
                      ` : '<span style="font-size:10px;color:#ef4444;font-weight:700;">VOID</span>'}
                    </div>
                  `;
                }).join('')}
              </div>

              <!-- Ticket Bottom Controls -->
              <div style="display:flex;justify-content:space-between;align-items:center;gap:6px;">
                ${ticket.status === 'RECEIVED' ? `
                  <button class="btn btn-sm btn-primary" data-bump-ticket="${ticket.ticketId}" data-next-status="PREPARING" style="flex:1;font-weight:700;" type="button">
                    ▶ Start Prep
                  </button>
                ` : ticket.status === 'PREPARING' ? `
                  <button class="btn btn-sm btn-success" data-bump-ticket="${ticket.ticketId}" data-next-status="READY" style="flex:1;font-weight:700;background:#10b981;color:#fff;" type="button">
                    ✓ Mark Ready
                  </button>
                ` : ticket.status === 'READY' ? `
                  <button class="btn btn-sm btn-secondary" data-bump-ticket="${ticket.ticketId}" data-next-status="COLLECTED" style="flex:1;font-weight:700;" type="button">
                    📦 Collected / Dispatched
                  </button>
                ` : ''}
              </div>
            </div>
          `;
        }).join('')}
      </div>
    </div>
  `;
}

// -----------------------------------------------------------------------------
// EVENT WIRING & INTERACTION LOGIC
// -----------------------------------------------------------------------------
export async function wirePOS(root) {
  // Load background operational data exactly once per mount
  try {
    const statsRes = await apiGet("/bills/history/stats");
    if (statsRes?.data) pastOrdersStats = statsRes.data;

    const listRes = await apiGet("/bills?limit=50");
    if (listRes?.data?.bills) pastOrdersList = listRes.data.bills;

    const openRes = await apiGet("/bills/tickets/open");
    if (openRes?.data?.tickets) openTicketsList = openRes.data.tickets;

    const sessionRes = await apiGet("/bills/register/session/current");
    if (sessionRes?.data) activeRegisterSession = sessionRes.data;

    // REC-13: Fetch pending offline sales count from IndexedDB
    const cafeId = resolvePosCafeId();
    _offlinePendingCount = await offlineManager.getPendingCount(cafeId);
  } catch (e) {
    console.warn("POS background data load notice:", e.message);
  }

  // REC-13: Subscribe to offlineManager events for real-time queue badge & connectivity
  offlineManager.subscribe(async ({ pendingCount, isOnline }) => {
    _offlinePendingCount = pendingCount;
    const badge = root.querySelector("#pos-offline-badge");
    const syncBtn = root.querySelector("#pos-sync-queue-btn");
    if (badge) {
      badge.style.background = _offlinePendingCount > 0 ? "rgba(245,158,11,0.15)" : (isOnline ? "rgba(16,185,129,0.12)" : "rgba(239,68,68,0.15)");
      badge.style.color = _offlinePendingCount > 0 ? "#b45309" : (isOnline ? "#059669" : "#dc2626");
      badge.textContent = _offlinePendingCount > 0 ? `⚠️ Offline — ${_offlinePendingCount} waiting to sync` : (isOnline ? "🟢 Online" : "🔴 Offline");
    }
    if (syncBtn) {
      syncBtn.style.display = _offlinePendingCount > 0 ? "inline-flex" : "none";
      syncBtn.textContent = `🔄 Sync Pending (${_offlinePendingCount})`;
    }
  });

  wirePOSEventListeners(root);
}

function wirePOSEventListeners(root) {
  // Keyboard shortcut listener: Ctrl+K or F2 focuses search
  const handleKeydown = (e) => {
    if ((e.ctrlKey && e.key === "k") || e.key === "F2") {
      e.preventDefault();
      const s = root.querySelector("#pos-menu-search");
      if (s) s.focus();
    }
  };
  window.addEventListener("keydown", handleKeydown, { once: true });

  // REC-13 / CTL-08: Sync Pending Offline Sales Button
  const syncQueueBtn = root.querySelector("#pos-sync-queue-btn");
  if (syncQueueBtn) {
    syncQueueBtn.addEventListener("click", async () => {
      const cafeId = resolvePosCafeId();
      if (!cafeId) {
        showToast("Select a café before syncing offline queue.", "danger");
        return;
      }
      syncQueueBtn.disabled = true;
      syncQueueBtn.textContent = "⏳ Syncing…";
      showToast("Syncing offline POS queue…", "info");
      try {
        const res = await offlineManager.syncNow(apiPost, cafeId);
        if (res.syncedCount > 0) {
          showToast(`Synced ${res.syncedCount} offline sale(s) to server. Exactly-once confirmed.`, "mint");
        } else if (res.conflictCount > 0) {
          showToast(`${res.conflictCount} sale(s) require conflict review (pricing / café governance).`, "warning");
        } else if (res.authRequiredCount > 0) {
          showToast("Authentication required to sync queue. Please sign in.", "error");
        } else {
          showToast("No pending offline sales to sync.", "info");
        }
      } catch (err) {
        showToast(err.message || "Failed to sync offline queue.", "error");
      } finally {
        _offlinePendingCount = await offlineManager.getPendingCount(cafeId);
        syncQueueBtn.disabled = false;
        refreshPOSView(root);
      }
    });
  }

  // Subview toggle
  const pastOrdersBtn = root.querySelector("#view-past-orders-btn");
  if (pastOrdersBtn) {
    pastOrdersBtn.addEventListener("click", () => {
      activeMainView = "PAST_ORDERS";
      refreshPOSView(root);
    });
  }

  const backToPosBtn = root.querySelector("#back-to-pos-btn");
  if (backToPosBtn) {
    backToPosBtn.addEventListener("click", () => {
      activeMainView = "POS";
      refreshPOSView(root);
    });
  }


  root.querySelectorAll("[data-bump-ticket]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const ticketId = btn.dataset.bumpTicket;
      const targetStatus = btn.dataset.nextStatus;
      try {
        await apiPost(`/kds/tickets/${ticketId}/bump`, { targetStatus });
        showToast(`Ticket ${ticketId} bumped to ${targetStatus}`, "success");
        const res = await apiGet(`/kds/tickets?prepStation=${kdsStationFilter}`);
        if (res?.data?.tickets) kdsTicketsList = res.data.tickets;
        else if (res?.tickets) kdsTicketsList = res.tickets;
        refreshPOSView(root);
      } catch (err) {
        showToast(err.message || "Failed to bump ticket", "error");
      }
    });
  });

  root.querySelectorAll("[data-bump-item]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const ticketId = btn.dataset.bumpItem;
      const itemIndex = btn.dataset.itemIdx;
      try {
        await apiPost(`/kds/tickets/${ticketId}/items/${itemIndex}/bump`, { itemStatus: "COMPLETED" });
        const res = await apiGet(`/kds/tickets?prepStation=${kdsStationFilter}`);
        if (res?.data?.tickets) kdsTicketsList = res.data.tickets;
        else if (res?.tickets) kdsTicketsList = res.tickets;
        refreshPOSView(root);
      } catch (err) {
        showToast(err.message || "Failed to update item", "error");
      }
    });
  });

  // Offline / Degraded Sync Wiring
  if (typeof window !== "undefined" && window.offlineManager) {
    const updateOfflineBadge = () => {
      const c = root.querySelector("#pos-offline-status-container");
      if (!c) return;
      const pending = window.offlineManager.getPendingCount();
      const online = window.offlineManager.isOnline;
      if (!online || pending > 0) {
        c.innerHTML = `
          <span style="display:inline-flex;align-items:center;gap:4px;padding:3px 8px;border-radius:6px;font-size:11px;font-weight:700;background:rgba(239,68,68,0.12);color:#dc2626;">
            ${online ? "⚠️ Reconnected" : "🔴 Degraded Mode"} (${pending} queued)
          </span>
          ${online && pending > 0 ? `<button class="btn btn-sm btn-primary" id="pos-sync-offline-btn" style="margin-left:4px;padding:2px 8px;font-size:10.5px;" type="button">Sync</button>` : ""}
        `;
        c.querySelector("#pos-sync-offline-btn")?.addEventListener("click", async () => {
          showToast("Replaying queued offline bills...", "info");
          const syncRes = await window.offlineManager.sync({ post: apiPost });
          showToast(`Synced ${syncRes?.syncedCount || 0} offline bills!`, "success");
          updateOfflineBadge();
        });
      } else {
        c.innerHTML = `
          <span style="display:inline-flex;align-items:center;gap:4px;padding:3px 8px;border-radius:6px;font-size:11px;font-weight:700;background:rgba(16,185,129,0.12);color:#059669;">
            🟢 Online
          </span>
        `;
      }
    };
    updateOfflineBadge();
  }

  // Service Mode Selector
  root.querySelectorAll("[data-service-mode]").forEach((btn) => {
    btn.addEventListener("click", () => {
      activeServiceMode = btn.dataset.serviceMode;
      if (activeServiceMode === "STAFF_MEAL") {
        activeTender = "STAFF_MEAL";
      } else if (activeServiceMode === "COMPLIMENTARY") {
        activeTender = "COMPLIMENTARY";
      } else if (activeTender === "STAFF_MEAL" || activeTender === "COMPLIMENTARY") {
        activeTender = "UPI";
      }
      refreshPOSView(root);
    });
  });

  // Isolated Training Mode Toggle
  const trainingBtn = root.querySelector("#toggle-training-mode-btn");
  if (trainingBtn) {
    trainingBtn.addEventListener("click", () => {
      state.isTrainingMode = !state.isTrainingMode;
      showToast(state.isTrainingMode ? "🎓 Isolated Training Mode ACTIVE" : "Exited Training Mode", state.isTrainingMode ? "warning" : "info");
      refreshPOSView(root);
    });
  }

  const exitTrainingBtn = root.querySelector("#exit-training-mode-banner-btn");
  if (exitTrainingBtn) {
    exitTrainingBtn.addEventListener("click", () => {
      state.isTrainingMode = false;
      showToast("Exited Training Mode", "info");
      refreshPOSView(root);
    });
  }

  // Table Picker
  const tablePicker = root.querySelector("#pos-table-picker");
  if (tablePicker) {
    tablePicker.addEventListener("change", () => {
      activeTable = tablePicker.value;
    });
  }

  // Covers Picker
  const coversPicker = root.querySelector("#pos-covers-picker");
  if (coversPicker) {
    coversPicker.addEventListener("change", () => {
      guestCovers = parseInt(coversPicker.value, 10) || 1;
    });
  }

  // Category Filter Tabs
  root.querySelectorAll("[data-pos-cat]").forEach((btn) => {
    btn.addEventListener("click", () => {
      activeCategory = btn.dataset.posCat;
      refreshPOSView(root);
    });
  });

  // Search input & clear button
  const searchInput = root.querySelector("#pos-menu-search");
  if (searchInput) {
    searchInput.addEventListener("input", (e) => {
      searchQuery = e.target.value;
      refreshPOSView(root);
    });
  }

  const clearSearchBtn = root.querySelector("#pos-clear-search, #pos-reset-search-btn");
  if (clearSearchBtn) {
    clearSearchBtn.addEventListener("click", () => {
      searchQuery = "";
      refreshPOSView(root);
    });
  }

  // Density Toggle
  const densityBtn = root.querySelector("#toggle-density-btn");
  if (densityBtn) {
    densityBtn.addEventListener("click", () => {
      isCompactMode = !isCompactMode;
      refreshPOSView(root);
    });
  }

  // Product Selection & Modifier Selector
  root.querySelectorAll("[data-select-product]").forEach((card) => {
    card.addEventListener("click", () => {
      const productId = card.dataset.selectProduct;
      const product = _menuCatalogue.find((p) => p.id === productId);
      if (!product) return;

      if (product.hasModifiers) {
        openModifierModal(product, null, root);
      } else {
        addLineToCart(product, null, "", 1);
        refreshPOSView(root);
      }
    });
  });

  // Cart Line Steppers & Actions
  root.querySelectorAll("[data-inc-line]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const lineId = btn.dataset.incLine;
      const line = cart.find((l) => l.lineId === lineId);
      if (line) {
        line.qty += 1;
        refreshPOSView(root);
      }
    });
  });

  root.querySelectorAll("[data-dec-line]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const lineId = btn.dataset.decLine;
      const idx = cart.findIndex((l) => l.lineId === lineId);
      if (idx !== -1) {
        cart[idx].qty -= 1;
        if (cart[idx].qty <= 0) cart.splice(idx, 1);
        refreshPOSView(root);
      }
    });
  });

  root.querySelectorAll("[data-dup-line]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const lineId = btn.dataset.dupLine;
      const line = cart.find((l) => l.lineId === lineId);
      if (line) {
        cart.push({
          ...line,
          lineId: `LINE-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
        });
        refreshPOSView(root);
      }
    });
  });

  // Edit Line Modifiers (§41)
  root.querySelectorAll("[data-edit-line-mods]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const lineId = btn.dataset.editLineMods;
      const line = cart.find((l) => l.lineId === lineId);
      if (line) {
        openModifierModal(line.item, line, root);
      }
    });
  });

  // Clear Ticket with Confirmation (§48)
  const clearBtn = root.querySelector("#clear-ticket-btn");
  if (clearBtn) {
    clearBtn.addEventListener("click", () => {
      if (!cart.length) return;
      confirmAction({
        title: "Clear Current Ticket?",
        message: `${cart.length} item line(s) will be discarded from the active checkout ticket.`,
        confirmLabel: "Clear Ticket",
        confirmVariant: "danger",
        onConfirm: () => {
          cart = [];
          discountPaisa = 0;
          discountReason = "";
          cashReceivedAmount = 0;
          refreshPOSView(root);
        },
      });
    });
  }

  // Hold Ticket (§50, §51)
  const holdBtn = root.querySelector("#hold-ticket-btn");
  if (holdBtn) {
    holdBtn.addEventListener("click", async () => {
      if (!cart.length) return;
      const cafeId = resolvePosCafeId();
      if (!cafeId) {
        showToast("Select a café before completing this sale.", "danger");
        const cafeSelector = document.querySelector("#global-cafe-selector") || document.querySelector("#ctx-cafe-selector");
        if (cafeSelector) cafeSelector.focus();
        return;
      }
      try {
        const holdName = `${activeServiceMode === "DINE_IN" ? activeTable : activeToken} (Hold)`;
        const res = await apiPost("/bills", {
          cafeId,
          orderType: activeServiceMode,
          serviceMode: activeServiceMode,
          tableNumber: activeServiceMode === "DINE_IN" ? activeTable : "",
          tableToken: activeServiceMode === "TAKEAWAY" ? activeToken : "",
          guestCovers,
          lineItems: cart.map((l) => ({
            menuItemId: l.item.id,
            quantity: l.qty,
            modifiers: l.modifiers || {},
            itemNotes: l.notes || "",
          })),
          isImmediateCompletion: false,
        });

        if (res?.data?.billId) {
          await apiPost("/bills/tickets/hold", {
            billId: res.data.billId,
            holdName,
          });
        }
        showToast("Order parked on hold successfully.", "mint");
        cart = [];
        const openRes = await apiGet("/bills/tickets/open");
        if (openRes?.data?.tickets) openTicketsList = openRes.data.tickets;
        refreshPOSView(root);
      } catch (err) {
        showToast(err.message || "Failed to hold ticket", "error");
      }
    });
  }

  // Open Tickets Modal (§52–§57)
  const openTicketsBtn = root.querySelector("#open-tickets-btn");
  if (openTicketsBtn) {
    openTicketsBtn.addEventListener("click", () => {
      openOpenTicketsModal(root);
    });
  }

  // Register Session Management Modal (§98–§104)
  const regBtn = root.querySelector("#register-session-btn");
  if (regBtn) {
    regBtn.addEventListener("click", () => {
      openRegisterModal(root);
    });
  }

  // REC-04 CTL-05: Reprint Last Finalized Bill (browser-refresh resilient)
  // Fetches the most recent COMPLETED bill from the server and opens the receipt modal
  // in reprint mode — works even after a full page reload since state is server-side.
  const reprintLastBtn = root.querySelector("#pos-reprint-last-btn");
  if (reprintLastBtn) {
    reprintLastBtn.addEventListener("click", async () => {
      const cafeId = resolvePosCafeId();
      if (!cafeId) {
        showToast("Select a café before reprinting.", "danger");
        return;
      }
      reprintLastBtn.disabled = true;
      reprintLastBtn.textContent = "⏳ Fetching...";
      try {
        const res = await apiGet(`/pos/orders/last/${cafeId}`);
        const bill = res?.data || res?.bill;
        if (!bill) throw new Error("No recent bill found.");
        closeModal();
        openReceiptModal(bill, true);
      } catch (err) {
        showToast(err.message || "No recent finalized bill found for this outlet.", "warning");
      } finally {
        reprintLastBtn.disabled = false;
        reprintLastBtn.textContent = "🔁 Reprint Last";
      }
    });
  }

  // Tender selection
  root.querySelectorAll("[data-select-tender]").forEach((btn) => {
    btn.addEventListener("click", () => {
      activeTender = btn.dataset.selectTender;
      if (activeTender === "SPLIT") {
        openSplitPaymentModal(root);
      } else {
        refreshPOSView(root);
      }
    });
  });

  // Quick cash buttons
  root.querySelectorAll("[data-quick-cash]").forEach((btn) => {
    btn.addEventListener("click", () => {
      cashReceivedAmount = Number(btn.dataset.quickCash) || 0;
      refreshPOSView(root);
    });
  });

  // Preview Receipt Action before Settlement
  const previewBtn = root.querySelector("#preview-receipt-btn");
  if (previewBtn) {
    previewBtn.addEventListener("click", () => {
      if (!cart.length) return;

      const subtotal = cart.reduce((acc, l) => {
        const modPrice = l.modifiers?.modifierPricePaisa ? l.modifiers.modifierPricePaisa / 100 : 0;
        return acc + (l.item.price + modPrice) * l.qty;
      }, 0);
      const discount = Math.round(discountPaisa / 100);
      const taxable = Math.max(0, subtotal - discount);
      const gst = Math.round(taxable * 0.05);
      const grandTotal = taxable + gst;

      const previewBill = {
        billId: `PREVIEW-${Date.now()}`,
        invoiceNumber: `PREVIEW (NOT ISSUED)`,
        subtotalPaisa: subtotal * 100,
        taxPaisa: gst * 100,
        totalPaisa: grandTotal * 100,
        paymentMethod: activeTender,
        businessDate: new Date().toISOString().substring(0, 10),
        status: "PREVIEW",
        lineItems: cart.map((l) => ({
          itemNameSnapshot: l.item.name,
          quantity: l.qty,
          unitPricePaisa: (l.item.price + (l.modifiers?.modifierPricePaisa ? l.modifiers.modifierPricePaisa / 100 : 0)) * 100,
          modifiers: l.modifiers,
        })),
      };

      openReceiptModal(previewBill, false);
    });
  }

  // Save Only Action (Case A: SAVE without PRINT)
  const saveOnlyBtn = root.querySelector("#pos-save-only-btn");
  if (saveOnlyBtn) {
    saveOnlyBtn.addEventListener("click", async () => {
      if (!cart.length || isPaymentInProgress) return;

      const isZeroMode = (activeServiceMode === "STAFF_MEAL" || activeServiceMode === "COMPLIMENTARY" || activeTender === "COMPLIMENTARY" || activeTender === "STAFF_MEAL");
      if (isZeroMode) {
        const tenderType = activeServiceMode === "STAFF_MEAL" ? "STAFF_MEAL" : "COMPLIMENTARY";
        await executeFinalSale(0, tenderType, root, tenderType === "STAFF_MEAL" ? "Staff Meal" : "Complimentary Item", null, "SAVE");
        return;
      }

      const subtotal = cart.reduce((acc, l) => {
        const modPrice = l.modifiers?.modifierPricePaisa ? l.modifiers.modifierPricePaisa / 100 : 0;
        return acc + (l.item.price + modPrice) * l.qty;
      }, 0);
      const discount = Math.round(discountPaisa / 100);
      const taxable = Math.max(0, subtotal - discount);
      const gst = Math.round(taxable * 0.05);
      const grandTotal = taxable + gst;

      if (activeTender === "UPI") {
        openUpiQrAssistantModal(grandTotal, root, "SAVE");
      } else if (activeTender === "CARD") {
        openCardReaderModal(grandTotal, root, "SAVE");
      } else if (activeTender === "SPLIT") {
        openSplitPaymentModal(root, "SAVE");
      } else {
        await executeFinalSale(grandTotal, "CASH", root, "", null, "SAVE");
      }
    });
  }

  // Charge / Payment Processing (§73–§85) - Save & Print
  const chargeBtn = root.querySelector("#process-charge-btn");
  if (chargeBtn) {
    chargeBtn.addEventListener("click", async () => {
      if (!cart.length || isPaymentInProgress) return;

      const isZeroMode = (activeServiceMode === "STAFF_MEAL" || activeServiceMode === "COMPLIMENTARY" || activeTender === "COMPLIMENTARY" || activeTender === "STAFF_MEAL");
      if (isZeroMode) {
        const tenderType = activeServiceMode === "STAFF_MEAL" ? "STAFF_MEAL" : "COMPLIMENTARY";
        await executeFinalSale(0, tenderType, root, tenderType === "STAFF_MEAL" ? "Staff Meal" : "Complimentary Item", null, "SAVE_AND_PRINT");
        return;
      }

      const subtotal = cart.reduce((acc, l) => {
        const modPrice = l.modifiers?.modifierPricePaisa ? l.modifiers.modifierPricePaisa / 100 : 0;
        return acc + (l.item.price + modPrice) * l.qty;
      }, 0);
      const discount = Math.round(discountPaisa / 100);
      const taxable = Math.max(0, subtotal - discount);
      const gst = Math.round(taxable * 0.05);
      const grandTotal = taxable + gst;

      if (activeTender === "UPI") {
        openUpiQrAssistantModal(grandTotal, root, "SAVE_AND_PRINT");
      } else if (activeTender === "CARD") {
        openCardReaderModal(grandTotal, root, "SAVE_AND_PRINT");
      } else if (activeTender === "SPLIT") {
        openSplitPaymentModal(root, "SAVE_AND_PRINT");
      } else {
        await executeFinalSale(grandTotal, "CASH", root, "", null, "SAVE_AND_PRINT");
      }
    });
  }

  // Past Orders Tab Switching
  root.querySelectorAll("[data-past-tab]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      pastOrdersTab = btn.dataset.pastTab;
      if (pastOrdersTab === "CALENDAR") {
        try {
          const calRes = await apiGet("/bills/history/calendar");
          if (calRes?.data) salesCalendarData = calRes.data;
        } catch {}
      }
      refreshPOSView(root);
    });
  });

  // Past Orders Actions
  root.querySelectorAll("[data-inspect-bill]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const bId = btn.dataset.inspectBill;
      const order = pastOrdersList.find((o) => o.billId === bId);
      if (order) openInspectBillModal(order);
    });
  });

  root.querySelectorAll("[data-reprint-bill]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const bId = btn.dataset.reprintBill;
      try {
        await apiPost(`/bills/${bId}/reprint`, { reason: "Customer Request" });
        const order = pastOrdersList.find((o) => o.billId === bId);
        if (order) {
          openReceiptModal(order, true);
        }
      } catch (err) {
        showToast(err.message || "Failed to reprint", "error");
      }
    });
  });

  root.querySelectorAll("[data-refund-bill]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const bId = btn.dataset.refundBill;
      const order = pastOrdersList.find((o) => o.billId === bId);
      if (order) openRefundModal(order, root);
    });
  });

  root.querySelectorAll("[data-void-bill]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const bId = btn.dataset.voidBill;
      const order = pastOrdersList.find((o) => o.billId === bId);
      if (order) openVoidModal(order, root);
    });
  });
}

function addLineToCart(product, modifiers, notes, qty = 1) {
  const lineId = `LINE-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`;
  cart.push({
    lineId,
    item: product,
    qty,
    modifiers: modifiers || { size: "Regular", milk: "Standard", temperature: "Hot", sweetness: "Regular", addOns: [], modifierPricePaisa: 0 },
    notes: notes || "",
  });
}

function openModifierModal(product, existingLine = null, root) {
  let selectedSize = existingLine?.modifiers?.size || "Regular";
  let selectedMilk = existingLine?.modifiers?.milk || "Standard";
  let selectedTemp = existingLine?.modifiers?.temperature || "Hot";
  let selectedSweet = existingLine?.modifiers?.sweetness || "Regular";
  let selectedAddOns = existingLine?.modifiers?.addOns ? [...existingLine.modifiers.addOns] : [];
  let itemNotes = existingLine?.notes || "";

  openModal({
    title: `Customise · ${product.name}`,
    maxWidth: "480px",
    body: `
      <div style="display:flex;flex-direction:column;gap:12px;font-size:12.5px;">
        <!-- Size -->
        <div>
          <label style="font-weight:700;color:var(--ink);display:block;margin-bottom:4px;">Size</label>
          <div style="display:flex;gap:6px;">
            <button class="btn btn-sm ${selectedSize === "Regular" ? "btn-primary" : "btn-ghost"} mod-opt" data-group="size" data-val="Regular" data-price="0" type="button">Regular (₹0)</button>
            <button class="btn btn-sm ${selectedSize === "Large" ? "btn-primary" : "btn-ghost"} mod-opt" data-group="size" data-val="Large" data-price="40" type="button">Large (+₹40)</button>
          </div>
        </div>

        <!-- Milk Choice -->
        <div>
          <label style="font-weight:700;color:var(--ink);display:block;margin-bottom:4px;">Milk Choice</label>
          <div style="display:flex;gap:5px;flex-wrap:wrap;">
            <button class="btn btn-sm ${selectedMilk === "Standard" ? "btn-primary" : "btn-ghost"} mod-opt" data-group="milk" data-val="Standard" data-price="0" type="button">Standard Dairy</button>
            <button class="btn btn-sm ${selectedMilk === "Oat Milk" ? "btn-primary" : "btn-ghost"} mod-opt" data-group="milk" data-val="Oat Milk" data-price="50" type="button">Oat Milk (+₹50)</button>
            <button class="btn btn-sm ${selectedMilk === "Almond Milk" ? "btn-primary" : "btn-ghost"} mod-opt" data-group="milk" data-val="Almond Milk" data-price="50" type="button">Almond (+₹50)</button>
            <button class="btn btn-sm ${selectedMilk === "Soy Milk" ? "btn-primary" : "btn-ghost"} mod-opt" data-group="milk" data-val="Soy Milk" data-price="40" type="button">Soy (+₹40)</button>
          </div>
        </div>

        <!-- Temperature -->
        <div>
          <label style="font-weight:700;color:var(--ink);display:block;margin-bottom:4px;">Temperature</label>
          <div style="display:flex;gap:6px;">
            <button class="btn btn-sm ${selectedTemp === "Hot" ? "btn-primary" : "btn-ghost"} mod-opt" data-group="temp" data-val="Hot" data-price="0" type="button">Hot</button>
            <button class="btn btn-sm ${selectedTemp === "Iced" ? "btn-primary" : "btn-ghost"} mod-opt" data-group="temp" data-val="Iced" data-price="20" type="button">Iced (+₹20)</button>
          </div>
        </div>

        <!-- Sweetness -->
        <div>
          <label style="font-weight:700;color:var(--ink);display:block;margin-bottom:4px;">Sweetness</label>
          <div style="display:flex;gap:5px;flex-wrap:wrap;">
            <button class="btn btn-sm ${selectedSweet === "No Sugar" ? "btn-primary" : "btn-ghost"} mod-opt" data-group="sweet" data-val="No Sugar" type="button">No Sugar</button>
            <button class="btn btn-sm ${selectedSweet === "Less Sugar" ? "btn-primary" : "btn-ghost"} mod-opt" data-group="sweet" data-val="Less Sugar" type="button">Less Sugar</button>
            <button class="btn btn-sm ${selectedSweet === "Regular" ? "btn-primary" : "btn-ghost"} mod-opt" data-group="sweet" data-val="Regular" type="button">Regular</button>
          </div>
        </div>

        <!-- Add-ons -->
        <div>
          <label style="font-weight:700;color:var(--ink);display:block;margin-bottom:4px;">Add-ons</label>
          <div style="display:flex;gap:6px;flex-wrap:wrap;">
            <label style="display:flex;align-items:center;gap:4px;font-size:11.5px;background:var(--surface-sunken);padding:4px 8px;border-radius:4px;cursor:pointer;">
              <input type="checkbox" id="addon-extra-shot" value="Extra Espresso Shot" ${selectedAddOns.includes("Extra Espresso Shot") ? "checked" : ""} /> Extra Shot (+₹45)
            </label>
            <label style="display:flex;align-items:center;gap:4px;font-size:11.5px;background:var(--surface-sunken);padding:4px 8px;border-radius:4px;cursor:pointer;">
              <input type="checkbox" id="addon-vanilla" value="Vanilla Syrup" ${selectedAddOns.includes("Vanilla Syrup") ? "checked" : ""} /> Vanilla (+₹35)
            </label>
            <label style="display:flex;align-items:center;gap:4px;font-size:11.5px;background:var(--surface-sunken);padding:4px 8px;border-radius:4px;cursor:pointer;">
              <input type="checkbox" id="addon-caramel" value="Caramel Drizzle" ${selectedAddOns.includes("Caramel Drizzle") ? "checked" : ""} /> Caramel (+₹30)
            </label>
          </div>
        </div>

        <!-- Special Notes -->
        <div>
          <label style="font-weight:700;color:var(--ink);display:block;margin-bottom:4px;">Special Note</label>
          <input type="text" id="mod-notes-input" class="input" placeholder="e.g. Extra hot, oat milk froth..." value="${escapeHtml(itemNotes)}" style="font-size:12px;padding:5px 8px;" />
        </div>
      </div>
    `,
    saveLabel: existingLine ? "Update Line Item" : "Add to Ticket",
    cancelLabel: "Cancel",
    onSave: () => {
      let modPricePaisa = 0;
      if (selectedSize === "Large") modPricePaisa += 4000;
      if (selectedMilk === "Oat Milk" || selectedMilk === "Almond Milk") modPricePaisa += 5000;
      if (selectedMilk === "Soy Milk") modPricePaisa += 4000;
      if (selectedTemp === "Iced") modPricePaisa += 2000;

      const addOns = [];
      if (document.querySelector("#addon-extra-shot")?.checked) {
        addOns.push("Extra Espresso Shot");
        modPricePaisa += 4500;
      }
      if (document.querySelector("#addon-vanilla")?.checked) {
        addOns.push("Vanilla Syrup");
        modPricePaisa += 3500;
      }
      if (document.querySelector("#addon-caramel")?.checked) {
        addOns.push("Caramel Drizzle");
        modPricePaisa += 3000;
      }

      itemNotes = document.querySelector("#mod-notes-input")?.value || "";

      if (existingLine) {
        existingLine.modifiers = {
          size: selectedSize,
          milk: selectedMilk,
          temperature: selectedTemp,
          sweetness: selectedSweet,
          addOns,
          modifierPricePaisa: modPricePaisa,
        };
        existingLine.notes = itemNotes;
      } else {
        addLineToCart(product, {
          size: selectedSize,
          milk: selectedMilk,
          temperature: selectedTemp,
          sweetness: selectedSweet,
          addOns,
          modifierPricePaisa: modPricePaisa,
        }, itemNotes, 1);
      }

      refreshPOSView(root);
    },
  });

  // Wire modal option buttons
  document.querySelectorAll(".mod-opt").forEach((btn) => {
    btn.addEventListener("click", () => {
      const group = btn.dataset.group;
      const val = btn.dataset.val;
      if (group === "size") selectedSize = val;
      if (group === "milk") selectedMilk = val;
      if (group === "temp") selectedTemp = val;
      if (group === "sweet") selectedSweet = val;

      document.querySelectorAll(`[data-group="${group}"]`).forEach((b) => {
        b.className = b.dataset.val === val ? "btn btn-sm btn-primary mod-opt" : "btn btn-sm btn-ghost mod-opt";
      });
    });
  });
}

function openUpiQrAssistantModal(grandTotal, root, posAction = "SAVE_AND_PRINT") {
  const txnRef = `UPI-${Date.now()}`;

  openModal({
    title: `Dynamic UPI Payment · ₹${grandTotal.toLocaleString("en-IN")}`,
    maxWidth: "480px",
    body: `
      <div style="text-align:center;padding:10px 4px 6px;">
        <div style="font-size:13px;color:var(--muted);margin-bottom:12px;">Scan with Google Pay, PhonePe, Paytm or BHIM UPI</div>

        <!-- High Fidelity Scannable QR Matrix Card -->
        <div style="display:inline-block;padding:16px;background:#ffffff;border-radius:14px;border:2px solid var(--bronze-500, #b17d38);box-shadow:0 4px 14px rgba(0,0,0,0.08);margin-bottom:14px;">
          <svg width="190" height="190" viewBox="0 0 190 190" style="display:block;margin:0 auto;">
            <rect width="190" height="190" fill="#ffffff"/>
            <!-- Top-Left Finder -->
            <rect x="10" y="10" width="52" height="52" fill="#18181b" rx="6"/>
            <rect x="20" y="20" width="32" height="32" fill="#ffffff" rx="4"/>
            <rect x="26" y="26" width="20" height="20" fill="#18181b" rx="3"/>

            <!-- Top-Right Finder -->
            <rect x="128" y="10" width="52" height="52" fill="#18181b" rx="6"/>
            <rect x="138" y="20" width="32" height="32" fill="#ffffff" rx="4"/>
            <rect x="144" y="26" width="20" height="20" fill="#18181b" rx="3"/>

            <!-- Bottom-Left Finder -->
            <rect x="10" y="128" width="52" height="52" fill="#18181b" rx="6"/>
            <rect x="20" y="138" width="32" height="32" fill="#ffffff" rx="4"/>
            <rect x="26" y="144" width="20" height="20" fill="#18181b" rx="3"/>

            <!-- Timing and Alignment Patterns -->
            <rect x="68" y="14" width="48" height="10" fill="#18181b" rx="2"/>
            <rect x="68" y="32" width="22" height="22" fill="#18181b" rx="2"/>
            <rect x="98" y="40" width="18" height="26" fill="#18181b" rx="2"/>
            <rect x="14" y="68" width="10" height="48" fill="#18181b" rx="2"/>
            <rect x="30" y="74" width="26" height="16" fill="#18181b" rx="2"/>

            <!-- QR Data Matrix Blocks -->
            <rect x="66" y="68" width="58" height="44" fill="#18181b" rx="3"/>
            <rect x="132" y="68" width="46" height="22" fill="#18181b" rx="2"/>
            <rect x="132" y="98" width="20" height="22" fill="#18181b" rx="2"/>
            <rect x="160" y="98" width="18" height="78" fill="#18181b" rx="2"/>
            <rect x="68" y="120" width="26" height="58" fill="#18181b" rx="2"/>
            <rect x="102" y="120" width="48" height="20" fill="#18181b" rx="2"/>
            <rect x="102" y="148" width="48" height="30" fill="#18181b" rx="2"/>
            <rect x="32" y="98" width="24" height="20" fill="#18181b" rx="2"/>

            <!-- Central Zamorin Cafe Gold Emblem Badge -->
            <rect x="74" y="74" width="42" height="42" fill="#ffffff" rx="8"/>
            <rect x="77" y="77" width="36" height="36" fill="#18181b" rx="6"/>
            <text x="95" y="100" font-size="14" font-family="'Outfit', sans-serif" font-weight="900" fill="#f59e0b" text-anchor="middle">₹</text>
          </svg>
        </div>

        <div style="background:var(--surface-sunken);border:1px solid var(--line);border-radius:8px;padding:8px 12px;margin:0 auto 10px;max-width:320px;">
          <div style="display:flex;justify-content:space-between;align-items:center;font-size:11.5px;margin-bottom:2px;">
            <span style="color:var(--muted);">UPI ID:</span>
            <strong style="font-family:var(--font-mono);color:var(--ink);">zamorincafe@icici</strong>
          </div>
          <div style="display:flex;justify-content:space-between;align-items:center;font-size:11.5px;">
            <span style="color:var(--muted);">Ref:</span>
            <strong style="font-family:var(--font-mono);color:var(--bronze-600);">${txnRef}</strong>
          </div>
        </div>

        <div style="font-size:12px;color:#059669;font-weight:700;display:flex;align-items:center;justify-content:center;gap:6px;">
          <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#059669;animation:pulse 1.5s infinite;"></span>
          Awaiting customer confirmation on terminal...
        </div>
      </div>
    `,
    saveLabel: "Confirm Payment Received",
    cancelLabel: "Cancel Payment",
    onSave: async () => {
      await executeFinalSale(grandTotal, "UPI", root, txnRef, null, posAction);
    },
  });
}

function openCardReaderModal(grandTotal, root, posAction = "SAVE_AND_PRINT") {
  const cardRef = `CARD-${Date.now()}`;
  openModal({
    title: `Card Reader Terminal · ₹${grandTotal.toLocaleString("en-IN")}`,
    maxWidth: "420px",
    body: `
      <div style="text-align:center;padding:16px 8px;">
        <div style="font-size:36px;margin-bottom:8px;">💳</div>
        <strong style="font-size:14px;color:var(--ink);display:block;">PineLabs SmartPOS Terminal Ready</strong>
        <p style="font-size:12px;color:var(--muted);margin:4px 0 12px;">Ask customer to tap, insert or swipe debit/credit card.</p>
        <div style="background:var(--surface-sunken);padding:8px 12px;border-radius:var(--radius-sm);display:inline-block;font-family:var(--font-mono);font-size:11.5px;color:var(--ink);">
          Terminal ID: PINELABS-001 · Ref: ${cardRef}
        </div>
      </div>
    `,
    saveLabel: "Simulate Card Approved",
    cancelLabel: "Cancel Transaction",
    onSave: async () => {
      await executeFinalSale(grandTotal, "CARD", root, cardRef, null, posAction);
    },
  });
}

function openSplitPaymentModal(root, posAction = "SAVE_AND_PRINT") {
  const subtotal = cart.reduce((acc, l) => {
    const modPrice = l.modifiers?.modifierPricePaisa ? l.modifiers.modifierPricePaisa / 100 : 0;
    return acc + (l.item.price + modPrice) * l.qty;
  }, 0);
  const discount = Math.round(discountPaisa / 100);
  const taxable = Math.max(0, subtotal - discount);
  const gst = Math.round(taxable * 0.05);
  const grandTotal = taxable + gst;

  let cashPart = Math.floor(grandTotal / 2);
  let upiPart = grandTotal - cashPart;

  openModal({
    title: `Split Payment Settlement · ₹${grandTotal.toLocaleString("en-IN")}`,
    maxWidth: "460px",
    body: `
      <div style="display:flex;flex-direction:column;gap:12px;font-size:12.5px;">
        <p style="margin:0;color:var(--muted);">Allocate tender portions across payment methods.</p>

        <div style="display:flex;justify-content:space-between;align-items:center;background:var(--surface-sunken);padding:8px 12px;border-radius:var(--radius-sm);">
          <label style="font-weight:700;">💵 Cash Portion (₹)</label>
          <input type="number" id="split-cash-input" class="input" value="${cashPart}" min="0" max="${grandTotal}" style="width:120px;font-weight:800;font-family:var(--font-mono);font-size:14px;" />
        </div>

        <div style="display:flex;justify-content:space-between;align-items:center;background:var(--surface-sunken);padding:8px 12px;border-radius:var(--radius-sm);">
          <label style="font-weight:700;">📱 UPI Portion (₹)</label>
          <input type="number" id="split-upi-input" class="input" value="${upiPart}" min="0" max="${grandTotal}" style="width:120px;font-weight:800;font-family:var(--font-mono);font-size:14px;" />
        </div>

        <div style="border-top:1px dashed var(--line);padding-top:8px;display:flex;justify-content:space-between;font-weight:800;font-size:14px;">
          <span>Allocated Total</span>
          <span id="split-allocated-total" style="font-family:var(--font-mono);color:var(--bronze-600);">₹${grandTotal}</span>
        </div>
      </div>
    `,
    saveLabel: "Complete Split Payment",
    cancelLabel: "Cancel",
    onSave: async () => {
      const cAmt = Number(document.querySelector("#split-cash-input")?.value) || 0;
      const uAmt = Number(document.querySelector("#split-upi-input")?.value) || 0;

      if (cAmt + uAmt < grandTotal) {
        showToast(`Allocated ₹${cAmt + uAmt} is less than bill total ₹${grandTotal}`, "error");
        return;
      }

      const tenders = [];
      if (cAmt > 0) {
        tenders.push({ paymentMethod: "CASH", amountPaisa: cAmt * 100, provider: "CASH_REGISTER", paymentReference: `CASH-${Date.now()}` });
      }
      if (uAmt > 0) {
        tenders.push({ paymentMethod: "UPI", amountPaisa: uAmt * 100, provider: "BHIM_UPI", paymentReference: `UPI-${Date.now()}` });
      }

      await executeFinalSale(grandTotal, "SPLIT", root, "", tenders, posAction);
    },
  });
}

async function executeFinalSale(grandTotal, tender, root, paymentRef = "", customTenders = null, posAction = "SAVE_AND_PRINT") {
  try {
    isPaymentInProgress = true;
    const idempotencyKey = `IDEM-SALE-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
    const saleAttemptId = `ATT-${idempotencyKey}`;
    const cartEntries = [...cart];
    const subtotal = cartEntries.reduce((acc, l) => {
      const modPrice = l.modifiers?.modifierPricePaisa ? l.modifiers.modifierPricePaisa / 100 : 0;
      return acc + (l.item.price + modPrice) * l.qty;
    }, 0);

    const isZeroCollectMode = (activeServiceMode === "STAFF_MEAL" || activeServiceMode === "COMPLIMENTARY" || tender === "COMPLIMENTARY" || tender === "STAFF_MEAL");
    const effectiveDiscountPaisa = isZeroCollectMode ? subtotal * 100 : discountPaisa;

    const tendersList = customTenders || [
      {
        paymentMethod: tender,
        amountPaisa: grandTotal * 100,
        provider: tender === "UPI" ? "BHIM_UPI" : tender === "CARD" ? "PINELABS_TERMINAL" : isZeroCollectMode ? "SPECIAL_ALLOWANCE" : "CASH_REGISTER",
        paymentReference: paymentRef || `TXN-${Date.now()}`,
      },
    ];

    const cafeId = resolvePosCafeId();
    if (!cafeId) {
      showToast("Select a café before completing this sale.", "danger");
      const cafeSelector = document.querySelector("#global-cafe-selector") || document.querySelector("#ctx-cafe-selector");
      if (cafeSelector) cafeSelector.focus();
      return;
    }

    // REC-04: Route all POS commits through the idempotent /pos/orders/commit endpoint.
    // This ensures: idempotency deduplication, GST invoice allocation (Rule 46(b)),
    // atomic BOM depletion, print-job tracking, and IDOR protection — all in one commit.
    const payload = {
      action: posAction,           // SAVE | SAVE_AND_PRINT
      cafeId,
      orderType: activeServiceMode,
      serviceMode: activeServiceMode,
      tableNumber: activeServiceMode === "DINE_IN" ? activeTable : "",
      tableToken: activeServiceMode === "TAKEAWAY" ? activeToken : "",
      guestCovers,
      discountPaisa: effectiveDiscountPaisa,
      paymentMethod: tender,
      registerId: "REG-01",
      registerSessionId: activeRegisterSession?.registerSessionId || "",
      idempotencyKey,
      saleAttemptId,
      isTraining: Boolean(state.isTrainingMode),
      lineItems: cartEntries.map((l) => ({
        menuItemId: l.item.id,
        quantity: l.qty,
        modifiers: l.modifiers || {},
        itemNotes: l.notes || "",
      })),
      tenders: tendersList,
      isImmediateCompletion: true,
    };

    // REC-13: Upfront offline detection — tender policy enforcement
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      if (tender !== "CASH" && !isZeroCollectMode) {
        isPaymentInProgress = false;
        showToast(`Network connection required for ${tender}. Offline capture permitted for CASH / Zero-collect only.`, "error");
        return;
      }

      // Offline CASH capture into IndexedDB of record (REC-13)
      try {
        const queued = await offlineManager.enqueueSale({
          ...payload,
          totalPaisa: grandTotal * 100,
          subtotalPaisa: subtotal * 100,
          taxPaisa: Math.round(subtotal * 0.05) * 100,
        });

        showToast("Saved Offline — sale queued in terminal IndexedDB.", "mint");
        cart = [];
        discountPaisa = 0;
        discountReason = "";
        cashReceivedAmount = 0;
        isPaymentInProgress = false;
        _offlinePendingCount = await offlineManager.getPendingCount(cafeId);
        openOfflineReceiptModal(queued);
        refreshPOSView(root);
        return;
      } catch (storageErr) {
        isPaymentInProgress = false;
        showToast("Storage error: offline sale could not be persisted. Quota exceeded or IndexedDB blocked. Sale NOT saved.", "error");
        return;
      }
    }

    // Primary: idempotent POS commit endpoint (REC-04)
    // REC-04A: fallback is ONLY permitted for HTTP 404/405 (route not found = rolling deployment).
    // ALL other failures (timeout, 500, 502-504, network loss, unknown) must surface to the user.
    // Retrying via /bills after an ambiguous failure risks creating a DUPLICATE SALE.
    let res;
    try {
      res = await apiPost("/pos/orders/commit", payload);
    } catch (commitErr) {
      const status = commitErr?.status || commitErr?.statusCode || commitErr?.httpStatus;
      const isRouteNotFound = status === 404 || status === 405;
      if (!isRouteNotFound) {
        // REC-04B: Unknown outcome (timeout, connection drop, 502-504).
        // Check transaction status using the EXACT transaction identity (idempotencyKey / saleAttemptId).
        // NEVER guess using "Reprint Last" (which could return a previous customer's bill).
        showToast("Checking transaction status\u2026", "info");
        try {
          const statusRes = await apiGet(`/pos/orders/status/${encodeURIComponent(idempotencyKey)}?cafeId=${encodeURIComponent(cafeId)}`);
          if (statusRes?.status === "COMPLETED" && (statusRes?.bill || statusRes?.data)) {
            res = statusRes;
            showToast(`Transaction verified: Bill ${statusRes.invoiceNumber || statusRes.billId}`, "mint");
          } else if (statusRes?.status === "PROCESSING") {
            throw new Error("Transaction is currently processing on server. Please wait a moment and verify again with this transaction identity.");
          } else {
            throw new Error(
              commitErr?.message ||
              "Sale commit outcome unconfirmed. Transaction not found on server; safe to retry with same transaction."
            );
          }
        } catch (statusErr) {
          if (res) {
            // Already recovered
          } else {
            // REC-13: Network unreachable during request — queue offline if CASH
            const isNetworkFailure = !status || status >= 500 || commitErr.name === "TypeError" || String(commitErr.message).includes("fetch");
            if (isNetworkFailure && tender === "CASH") {
              try {
                const queued = await offlineManager.enqueueSale({
                  ...payload,
                  totalPaisa: grandTotal * 100,
                  subtotalPaisa: subtotal * 100,
                  taxPaisa: Math.round(subtotal * 0.05) * 100,
                });
                showToast("Network unreachable. Saved Offline — queued in terminal IndexedDB.", "warning");
                cart = [];
                discountPaisa = 0;
                discountReason = "";
                cashReceivedAmount = 0;
                isPaymentInProgress = false;
                _offlinePendingCount = await offlineManager.getPendingCount(cafeId);
                openOfflineReceiptModal(queued);
                refreshPOSView(root);
                return;
              } catch (storageErr) {
                isPaymentInProgress = false;
                showToast("Storage error: offline sale could not be persisted. Sale NOT saved.", "error");
                return;
              }
            }
            throw statusErr;
          }
        }
      } else {
        // Route definitively absent (rolling deployment) — safe to use legacy endpoint
        console.warn("[POS] /pos/orders/commit not found on this server version (HTTP " + status + "), using /bills fallback");
        res = await apiPost("/bills", payload);
      }
    }

    const billData = res?.data || res?.bill || {
      billId: `BILL-${Date.now()}`,
      invoiceNumber: `ZAM-BILL-${Math.floor(100000 + Math.random() * 900000)}`,
      totalPaisa: grandTotal * 100,
      subtotalPaisa: subtotal * 100,
      taxPaisa: Math.round(subtotal * 0.05) * 100,
      lineItems: cartEntries.map((l) => ({
        itemNameSnapshot: l.item.name,
        quantity: l.qty,
        unitPricePaisa: l.item.price * 100,
        modifiers: l.modifiers,
      })),
      paymentMethod: tender,
      tenders: tendersList,
    };

    // Surface any printer warning from the backend (non-fatal — DB commit is already done)
    if (res?.printerWarning || res?.printStatus === "FAILED") {
      showToast(
        `⚠️ Bill saved (${billData.invoiceNumber || billData.billId}). Printer offline — use Reprint when ready.`,
        "warning"
      );
    } else {
      showToast(
        posAction === "SAVE" ? `Bill saved: ${billData.invoiceNumber || billData.billId}` : `Payment of ₹${grandTotal} confirmed — receipt issued.`,
        "mint"
      );
    }

    cart = [];
    discountPaisa = 0;
    discountReason = "";
    cashReceivedAmount = 0;
    isPaymentInProgress = false;

    openReceiptModal(billData, false);
    refreshPOSView(root);
  } catch (err) {
    isPaymentInProgress = false;
    showToast(err.message || "Sale failed. Check network and try again.", "error");
    refreshPOSView(root);
  }
}

// REC-13: Canonical Offline Receipt (Pending Synchronization)
function openOfflineReceiptModal(queued) {
  const grandTotal = (queued.totalPaisa || 0) / 100;
  const cafeName = state.user?.primaryCafeName || (state.cafes?.find((c) => c.cafeId === queued.cafeId)?.name) || "Zamorin Outlet";

  openModal({
    title: `OFFLINE SALE — PENDING SYNCHRONIZATION`,
    maxWidth: "480px",
    body: `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
        <div style="font-size:12px;"><span style="background:#fef3c7;color:#b45309;border:1px solid #fcd34d;padding:2px 8px;border-radius:4px;font-weight:700;font-size:11px;">OFFLINE CAPTURE (PENDING SYNC)</span></div>
        <div style="font-size:11px;font-family:monospace;color:var(--ink);">Ref: ${queued.localQueueId}</div>
      </div>

      <div class="pos-thermal-receipt" style="background:#fff;color:#000;padding:16px;border-radius:6px;border:1px solid #e2e8f0;font-family:'Courier New',Courier,monospace;">
        <div class="receipt-header" style="text-align:center;margin-bottom:12px;">
          <div class="receipt-title" style="font-size:16px;font-weight:bold;letter-spacing:1px;">ZAMORIN CAFE ESTATE</div>
          <div class="receipt-subtitle" style="font-size:11px;margin-top:2px;">${cafeName} · TERMINAL OFFLINE MODE</div>
          <div class="receipt-doc-type" style="font-size:11px;font-weight:bold;margin-top:4px;color:#b45309;">
            OFFLINE SALE — PENDING SYNCHRONIZATION
          </div>
        </div>
        <div class="receipt-row" style="display:flex;justify-content:space-between;font-size:11px;">
          <span>QUEUE ID: <strong>${queued.localQueueId}</strong></span>
          <span>${new Date(queued.capturedAtClient || Date.now()).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
        </div>
        <div class="receipt-row" style="display:flex;justify-content:space-between;font-size:11px;color:#64748b;">
          <span>CAPTURE DATE: ${(queued.capturedAtClient || new Date().toISOString()).substring(0, 10)}</span>
          <span>TENDER: CASH</span>
        </div>
        <div class="receipt-row" style="display:flex;justify-content:space-between;font-size:11px;color:#64748b;">
          <span>ATTEMPT ID: ${queued.saleAttemptId}</span>
        </div>
        <hr class="receipt-divider" style="border-top:1px dashed #94a3b8;margin:8px 0;" />

        <div style="display:flex;font-size:10px;font-weight:bold;color:#475569;border-bottom:1px solid #cbd5e1;padding-bottom:3px;margin-bottom:4px;">
          <span style="width:24px;">Sl.</span>
          <span style="flex:1;">Item</span>
          <span style="width:30px;text-align:center;">Qty</span>
          <span style="width:60px;text-align:right;">Amount</span>
        </div>

        ${queued.lineItems?.map((li, idx) => `
          <div style="display:flex;font-size:11px;padding:2px 0;">
            <span style="width:24px;color:#64748b;">${idx + 1}</span>
            <span style="flex:1;">${escapeHtml(li.itemNameSnapshot || li.name || 'Item')}</span>
            <span style="width:30px;text-align:center;">${li.quantity}</span>
            <span style="width:60px;text-align:right;font-weight:600;">₹${((li.unitPricePaisa * li.quantity) / 100).toFixed(0)}</span>
          </div>
        `).join("") || ""}

        <hr class="receipt-divider" style="border-top:1px dashed #94a3b8;margin:8px 0;" />
        <div style="display:flex;justify-content:space-between;font-weight:bold;font-size:13px;margin-top:4px;">
          <span>TOTAL CASH PAID:</span>
          <span>₹${grandTotal.toLocaleString("en-IN")}</span>
        </div>

        <div style="margin-top:12px;padding:8px;background:#fef3c7;border:1px dashed #d97706;border-radius:4px;font-size:10px;text-align:center;color:#92400e;line-height:1.4;">
          ⚠️ NOTICE: Captured during network outage. Stored durably in terminal IndexedDB. Official statutory GST invoice will be allocated upon server synchronization.
        </div>
      </div>
    `,
    saveLabel: "Print Offline Receipt",
    cancelLabel: "Close",
    onSave: () => {
      window.print();
    },
  });
}


function openReceiptModal(bill, isReprint = false) {
  const subtotal = bill.subtotalPaisa ? bill.subtotalPaisa / 100 : bill.totalPaisa ? bill.totalPaisa / 100 : 0;
  const gst = bill.taxPaisa ? bill.taxPaisa / 100 : Math.round(subtotal * 0.05);
  const grandTotal = bill.totalPaisa ? bill.totalPaisa / 100 : subtotal + gst;
  const cafeName = bill.cafeName || state.user?.primaryCafeName || (state.cafes?.find((c) => c.cafeId === bill.cafeId)?.name) || "Zamorin Outlet";
  const reprintCount = bill.reprints?.length || (isReprint ? 1 : 0);
  const isVoid = bill.status === "VOID" || bill.status === "CANCELLED";

  // Persistent paper width preference (80mm vs 58mm)
  let currentPaperWidth = (typeof localStorage !== "undefined" && localStorage.getItem("zamorin_pos_paper_width")) || "80";
  if (currentPaperWidth !== "58" && currentPaperWidth !== "80") currentPaperWidth = "80";

  const statusBadge = isVoid
    ? `<span style="background:#fee2e2;color:#b91c1c;border:1px solid #f87171;padding:2px 8px;border-radius:4px;font-weight:700;font-size:11px;">VOID — CANCELLED (NOT VALID)</span>`
    : (reprintCount > 0
      ? `<span style="background:#fef3c7;color:#b45309;border:1px solid #fcd34d;padding:2px 8px;border-radius:4px;font-weight:700;font-size:11px;">REPRINT #${reprintCount}</span>`
      : `<span style="background:#dcfce7;color:#15803d;border:1px solid #86efac;padding:2px 8px;border-radius:4px;font-weight:700;font-size:11px;">ORIGINAL</span>`);

  const savePdf = () => {
    const { blob, filename } = generateInvoicePdf(bill, { tradeName: cafeName });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    showToast(`Official Tax Invoice PDF saved: ${filename}`, "mint");
  };

  let isPrintingActive = false;
  const printThermal = async () => {
    if (isPrintingActive) return;
    isPrintingActive = true;
    const printBtn = document.getElementById("posReceiptPrintBtn");
    if (printBtn) {
      printBtn.disabled = true;
      printBtn.textContent = "⏳ Printing...";
    }

    // REC-04: Send print command to backend (logs PrintJob, generates thermal buffer)
    // then invoke browser print as the local rendering fallback.
    if (bill.billId && !bill.billId.startsWith("PREVIEW")) {
      try {
        await apiPost(`/pos/orders/${bill.billId}/print`, {
          reason: isReprint ? "Terminal duplicate receipt reprint" : "Terminal thermal print",
          paperWidth: currentPaperWidth,
        });
        showToast("Thermal print job queued on POS printer.", "mint");
      } catch (printErr) {
        // Non-fatal: log and fall through to browser print
        console.warn("[POS] Backend print endpoint error:", printErr.message);
        showToast("Printer bridge unavailable — printing via browser fallback.", "warning");
      }
    }
    window.print();
    setTimeout(() => {
      isPrintingActive = false;
      if (printBtn) {
        printBtn.disabled = false;
        printBtn.textContent = "🖨️ Thermal Print";
      }
    }, 800);
  };

  openModal({
    title: `Tax Invoice Receipt · ${bill.invoiceNumber || bill.billId}`,
    maxWidth: "500px",
    body: `
      <!-- Paper Width Profile Selector -->
      <div class="receipt-profile-toggle-bar" style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;padding:6px 12px;background:var(--surface-sunken);border-radius:6px;border:1px solid var(--line);">
        <span style="font-size:11.5px;font-weight:700;color:var(--ink);">🖨️ Thermal Paper Profile:</span>
        <div style="display:inline-flex;gap:6px;">
          <button type="button" class="btn btn-sm ${currentPaperWidth === '80' ? 'btn-primary' : 'btn-outline'}" id="posPaperToggle80" data-width="80" style="padding:3px 10px;font-size:11px;font-weight:700;">80mm Standard</button>
          <button type="button" class="btn btn-sm ${currentPaperWidth === '58' ? 'btn-primary' : 'btn-outline'}" id="posPaperToggle58" data-width="58" style="padding:3px 10px;font-size:11px;font-weight:700;">58mm Compact</button>
        </div>
      </div>

      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
        <div style="font-size:12px;color:var(--muted);">Status: ${statusBadge}</div>
        <div style="font-size:11px;font-family:monospace;color:var(--ink);">Official ID: ${bill.invoiceNumber || bill.billId}</div>
      </div>

      <div class="pos-thermal-receipt ${currentPaperWidth === '58' ? 'paper-58mm' : 'paper-80mm'}" id="pos-thermal-receipt" data-paper-width="${currentPaperWidth}">
        <div class="receipt-header">
          <div class="receipt-title">ZAMORIN CAFE ESTATE</div>
          <div class="receipt-subtitle">GSTIN: 32AABCT1332L1ZV · ${escapeHtml(cafeName)}</div>
          <div class="receipt-doc-type">
            ${isVoid ? "TAX INVOICE — [VOID / CANCELLED]" : (reprintCount > 0 ? `TAX INVOICE — [REPRINT #${reprintCount}]` : "TAX INVOICE / RETAIL BILL")}
          </div>
        </div>
        <div class="receipt-row">
          <span>INVOICE: <strong>${escapeHtml(bill.invoiceNumber || bill.billId)}</strong></span>
          <span>${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
        </div>
        <div class="receipt-row" style="color:#64748b;">
          <span>DATE: ${escapeHtml(bill.businessDate || new Date().toISOString().substring(0, 10))}</span>
          <span>REGISTER 01</span>
        </div>
        ${bill.tableNumber ? `
        <div class="receipt-row" style="color:#64748b;">
          <span>TABLE / TOKEN:</span>
          <strong>${escapeHtml(bill.tableNumber)}</strong>
        </div>` : ''}
        ${bill.cashierName ? `
        <div class="receipt-row" style="color:#64748b;">
          <span>CASHIER:</span>
          <span>${escapeHtml(bill.cashierName)}</span>
        </div>` : ''}
        <hr class="receipt-divider" />
        
        <!-- Table Header with Universal Sl. No. -->
        <div class="receipt-item-line" style="font-weight:bold;color:#475569;border-bottom:1px solid #cbd5e1;padding-bottom:3px;margin-bottom:4px;">
          <span class="receipt-item-sl">Sl.</span>
          <span class="receipt-item-name">Item</span>
          <span class="receipt-item-qty">Qty</span>
          <span class="receipt-item-amt">Amount</span>
        </div>

        ${bill.lineItems?.map((li, idx) => `
          <div class="receipt-item-line">
            <span class="receipt-item-sl">${idx + 1}</span>
            <span class="receipt-item-name">
              ${escapeHtml(li.itemNameSnapshot || li.name || 'Item')}
              ${li.modifiers?.size && li.modifiers.size !== 'Regular' ? `<br/><small style="color:#64748b;font-size:9.5px;">* ${escapeHtml(li.modifiers.size)}</small>` : ''}
              ${li.itemNotes ? `<br/><small style="color:#64748b;font-size:9.5px;">* Note: ${escapeHtml(li.itemNotes)}</small>` : ''}
            </span>
            <span class="receipt-item-qty">${li.quantity}</span>
            <span class="receipt-item-amt">₹${((li.unitPricePaisa * li.quantity) / 100).toFixed(0)}</span>
          </div>
        `).join("") || ""}
        <hr class="receipt-divider" />
        <div class="receipt-row"><span>Subtotal:</span><span>₹${subtotal.toFixed(0)}</span></div>
        ${bill.discountPaisa && bill.discountPaisa > 0 ? `
        <div class="receipt-row" style="color:#b45309;">
          <span>Discount:</span>
          <span>-₹${(bill.discountPaisa / 100).toFixed(0)}</span>
        </div>` : ''}
        <div class="receipt-row"><span>CGST (2.5%):</span><span>₹${(gst / 2).toFixed(0)}</span></div>
        <div class="receipt-row"><span>SGST (2.5%):</span><span>₹${(gst / 2).toFixed(0)}</span></div>
        ${bill.roundOffPaisa && bill.roundOffPaisa !== 0 ? `
        <div class="receipt-row" style="color:#64748b;font-size:10.5px;">
          <span>Round Off:</span>
          <span>${bill.roundOffPaisa < 0 ? `-₹${(Math.abs(bill.roundOffPaisa) / 100).toFixed(2)}` : `+₹${(bill.roundOffPaisa / 100).toFixed(2)}`}</span>
        </div>` : ''}
        <div class="receipt-total-row">
          <span>PAID TOTAL:</span>
          <span>₹${grandTotal.toFixed(0)}</span>
        </div>
        <div class="receipt-footer">
          Tender: <strong>${escapeHtml(bill.paymentMethod || "UPI")}</strong> · THANK YOU FOR VISITING ZAMORIN!
        </div>
      </div>

      <!-- Action Panel -->
      <div class="receipt-action-panel" style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:16px;">
        <button type="button" class="btn btn-sm btn-secondary" id="posReceiptSaveBtn" style="justify-content:center;">
          💾 Save A4 PDF
        </button>
        <button type="button" class="btn btn-sm btn-secondary" id="posReceiptPrintBtn" style="justify-content:center;">
          🖨️ Thermal Print
        </button>
        <button type="button" class="btn btn-sm btn-primary" id="posReceiptSaveAndPrintBtn" style="justify-content:center;">
          ⚡ Save & Print
        </button>
        <button type="button" class="btn btn-sm btn-outline" id="posReceiptReprintBtn" style="justify-content:center;">
          🔁 Reprint Receipt
        </button>
      </div>
    `,
    cancelLabel: "Close",
    saveLabel: null,
  });

  // Attach interactive button listeners & width toggle
  setTimeout(() => {
    const modalEl = document.getElementById("zamorin-global-modal");
    if (!modalEl) return;

    const receiptEl = modalEl.querySelector("#pos-thermal-receipt");
    const toggle80 = modalEl.querySelector("#posPaperToggle80");
    const toggle58 = modalEl.querySelector("#posPaperToggle58");

    const setPaperWidth = (w) => {
      currentPaperWidth = w;
      if (typeof localStorage !== "undefined") {
        localStorage.setItem("zamorin_pos_paper_width", w);
      }
      if (receiptEl) {
        receiptEl.setAttribute("data-paper-width", w);
        if (w === "58") {
          receiptEl.classList.remove("paper-80mm");
          receiptEl.classList.add("paper-58mm");
        } else {
          receiptEl.classList.remove("paper-58mm");
          receiptEl.classList.add("paper-80mm");
        }
      }
      if (toggle80 && toggle58) {
        if (w === "80") {
          toggle80.className = "btn btn-sm btn-primary";
          toggle58.className = "btn btn-sm btn-outline";
        } else {
          toggle58.className = "btn btn-sm btn-primary";
          toggle80.className = "btn btn-sm btn-outline";
        }
      }
    };

    toggle80?.addEventListener("click", () => setPaperWidth("80"));
    toggle58?.addEventListener("click", () => setPaperWidth("58"));

    modalEl.querySelector("#posReceiptSaveBtn")?.addEventListener("click", () => {
      savePdf();
    });

    modalEl.querySelector("#posReceiptPrintBtn")?.addEventListener("click", () => {
      printThermal();
    });

    // Atomic Save & Print (Section 51)
    modalEl.querySelector("#posReceiptSaveAndPrintBtn")?.addEventListener("click", () => {
      savePdf();
      printThermal();
    });

    // Audit-tracked Reprint (Section 52)
    modalEl.querySelector("#posReceiptReprintBtn")?.addEventListener("click", async () => {
      const confirmReprint = await confirmAction({
        title: "Confirm Receipt Reprint",
        message: `Generate duplicate receipt reprint for invoice ${bill.invoiceNumber || bill.billId}? This action is recorded in the operational audit log.`,
        confirmText: "Reprint Receipt",
        cancelText: "Cancel",
      });

      if (!confirmReprint) return;

      try {
        const res = await apiPost(`/bills/${bill.billId}/reprint`, { reason: "Customer request / terminal reprint" });
        showToast("Reprint logged to operational audit register.", "mint");
        closeModal();
        const updatedBill = { ...bill, reprints: res?.data?.reprints || [...(bill.reprints || []), { reprintedAt: new Date() }] };
        openReceiptModal(updatedBill, true);
      } catch (err) {
        showToast(err?.message || "Failed to log reprint", "coral");
      }
    });
  }, 50);
}

function openOpenTicketsModal(root) {
  openModal({
    title: "Open & Held Tickets",
    maxWidth: "500px",
    body: `
      <div style="display:flex;flex-direction:column;gap:10px;">
        ${openTicketsList.length ? openTicketsList.map((t) => `
          <div class="card" style="padding:10px;display:flex;justify-content:space-between;align-items:center;background:var(--surface-sunken);border:1px solid var(--line);">
            <div>
              <strong style="font-size:13px;color:var(--ink);">${t.holdName || t.tableNumber || t.tableToken || t.billId}</strong>
              <div style="font-size:10.5px;color:var(--muted);margin-top:2px;">${t.lineItems?.length || 0} items · ₹${(t.totalPaisa / 100).toFixed(0)}</div>
            </div>
            <button class="btn btn-sm btn-primary" data-resume-ticket="${t.billId}" style="font-size:11px;padding:3px 8px;" type="button">
              Resume Ticket
            </button>
          </div>
        `).join("") : `
          <p style="text-align:center;padding:24px;color:var(--muted);font-size:12.5px;">No open or held tickets at the moment.</p>
        `}
      </div>
    `,
    cancelLabel: "Close",
  });

  document.querySelectorAll("[data-resume-ticket]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const bId = btn.dataset.resumeTicket;
      const ticket = openTicketsList.find((t) => t.billId === bId);
      if (ticket) {
        if (cart.length > 0) {
          confirmAction({
            title: "Replace Active Cart?",
            message: "Resuming this ticket will overwrite your current unsaved cart items.",
            confirmLabel: "Resume & Overwrite",
            onConfirm: () => {
              loadTicketIntoCart(ticket, root);
              closeModal();
            },
          });
        } else {
          loadTicketIntoCart(ticket, root);
          closeModal();
        }
      }
    });
  });
}

function loadTicketIntoCart(ticket, root) {
  cart = ticket.lineItems.map((li) => ({
    lineId: `LINE-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
    item: { id: li.menuItemId, name: li.itemNameSnapshot, price: li.unitPricePaisa / 100 },
    qty: li.quantity,
    modifiers: li.modifiers,
    notes: li.itemNotes,
  }));
  activeServiceMode = ticket.serviceMode || "DINE_IN";
  activeTable = ticket.tableNumber || activeTable;
  refreshPOSView(root);
}

function openInspectBillModal(order) {
  openModal({
    title: `Order 360 Inspection · ${order.invoiceNumber || order.billId}`,
    maxWidth: "500px",
    body: `
      <div style="display:flex;flex-direction:column;gap:10px;font-size:12.5px;">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;background:var(--surface-sunken);padding:10px;border-radius:var(--radius-sm);">
          <div><span style="color:var(--muted);">Bill ID:</span> <strong>${order.billId}</strong></div>
          <div><span style="color:var(--muted);">Invoice:</span> <strong>${order.invoiceNumber}</strong></div>
          <div><span style="color:var(--muted);">Service Mode:</span> <strong>${order.serviceMode || order.orderType}</strong></div>
          <div><span style="color:var(--muted);">Table:</span> <strong>${order.tableNumber || "Counter"}</strong></div>
          <div><span style="color:var(--muted);">Business Date:</span> <strong>${order.businessDate}</strong></div>
          <div><span style="color:var(--muted);">Status:</span> <strong>${order.status}</strong></div>
        </div>

        <strong style="color:var(--ink);margin-top:2px;">Line Items & Modifiers</strong>
        <div style="max-height:180px;overflow-y:auto;display:flex;flex-direction:column;gap:5px;">
          ${order.lineItems?.map((li) => `
            <div style="display:flex;justify-content:space-between;padding:5px 7px;background:var(--surface-sunken);border-radius:4px;">
              <div>
                <strong>${li.quantity}× ${li.itemNameSnapshot}</strong>
                ${li.modifiers?.size ? `<div style="font-size:10.5px;color:var(--bronze-600);">${li.modifiers.size}, ${li.modifiers.milk}</div>` : ""}
              </div>
              <span style="font-family:var(--font-mono);font-weight:700;">₹${((li.unitPricePaisa * li.quantity) / 100).toFixed(0)}</span>
            </div>
          `).join("") || ""}
        </div>

        <div style="border-top:1px dashed var(--line);padding-top:6px;display:flex;justify-content:space-between;font-weight:800;font-size:14px;">
          <span>Net Total</span>
          <span style="font-family:var(--font-mono);color:var(--bronze-600);">₹${(order.totalPaisa / 100).toFixed(0)}</span>
        </div>
      </div>
    `,
    cancelLabel: "Close",
  });
}

function openRefundModal(order, root) {
  openModal({
    title: `Issue Controlled Refund · ${order.invoiceNumber || order.billId}`,
    maxWidth: "440px",
    body: `
      <div style="display:flex;flex-direction:column;gap:10px;font-size:12.5px;">
        <div style="background:var(--surface-sunken);padding:8px;border-radius:var(--radius-sm);">
          <div>Original Sale Total: <strong>₹${(order.totalPaisa / 100).toFixed(0)}</strong></div>
          <div>Original Tender: <strong>${order.paymentMethod}</strong></div>
        </div>

        <div>
          <label style="font-weight:700;display:block;margin-bottom:3px;">Refund Amount (₹)</label>
          <input type="number" id="refund-amount-input" class="input" value="${(order.totalPaisa / 100).toFixed(0)}" max="${(order.totalPaisa / 100).toFixed(0)}" min="1" style="font-size:13px;font-weight:700;" />
        </div>

        <div>
          <label style="font-weight:700;display:block;margin-bottom:3px;">Mandatory Reason</label>
          <select id="refund-reason-select" class="select" style="font-size:12px;width:100%;">
            <option value="Customer Complaint">Customer Complaint / Quality Issue</option>
            <option value="Incorrect Item">Incorrect Item Prepared</option>
            <option value="Order Entry Error">Order Entry Error</option>
            <option value="Customer Changed Mind">Customer Changed Mind</option>
          </select>
        </div>
      </div>
    `,
    saveLabel: "Confirm & Process Refund",
    cancelLabel: "Cancel",
    onSave: async () => {
      const amountVal = Number(document.querySelector("#refund-amount-input")?.value) || 0;
      const reasonVal = document.querySelector("#refund-reason-select")?.value || "Customer Complaint";
      try {
        await apiPost(`/bills/${order.billId}/refund`, {
          refundType: amountVal >= order.totalPaisa / 100 ? "FULL" : "PARTIAL",
          amountPaisa: amountVal * 100,
          reason: reasonVal,
        });
        showToast("Refund processed successfully.", "mint");
        const listRes = await apiGet("/bills?limit=50");
        if (listRes?.data?.bills) pastOrdersList = listRes.data.bills;
        refreshPOSView(root);
      } catch (err) {
        showToast(err.message || "Failed to process refund", "error");
      }
    },
  });
}

function openVoidModal(order, root) {
  openModal({
    title: `Master Void Authorization · ${order.invoiceNumber || order.billId}`,
    maxWidth: "440px",
    body: `
      <div style="display:flex;flex-direction:column;gap:10px;font-size:12.5px;">
        <p style="color:var(--danger);font-weight:700;margin:0;">⚠️ Voiding will permanently cancel this transaction and revert all financial reporting metrics.</p>
        <div>
          <label style="font-weight:700;display:block;margin-bottom:3px;">Mandatory Audit Reason</label>
          <input type="text" id="void-reason-input" class="input" placeholder="e.g. Master test transaction / Cashier double-entry" style="font-size:12.5px;" />
        </div>
      </div>
    `,
    saveLabel: "Authorize Void",
    saveVariant: "danger",
    cancelLabel: "Cancel",
    onSave: async () => {
      const reason = document.querySelector("#void-reason-input")?.value?.trim() || "";
      if (!reason) {
        showToast("Void reason is mandatory.", "error");
        return;
      }
      try {
        await apiPost(`/bills/${order.billId}/void`, { reason });
        showToast("Bill successfully voided.", "mint");
        const listRes = await apiGet("/bills?limit=50");
        if (listRes?.data?.bills) pastOrdersList = listRes.data.bills;
        refreshPOSView(root);
      } catch (err) {
        showToast(err.message || "Void denied", "error");
      }
    },
  });
}

function openRegisterModal(root) {
  openModal({
    title: "Cash Register & Shift Controls",
    maxWidth: "460px",
    body: `
      <div style="display:flex;flex-direction:column;gap:12px;font-size:12.5px;">
        ${activeRegisterSession ? `
          <div style="background:var(--surface-sunken);padding:10px;border-radius:var(--radius-sm);border:1px solid var(--line);">
            <div style="display:flex;justify-content:space-between;margin-bottom:3px;">
              <span>Session: <strong>${activeRegisterSession.registerSessionId}</strong></span>
              <span class="status success">ACTIVE</span>
            </div>
            <div>Opening Float: <strong>₹${(activeRegisterSession.openingFloatPaisa / 100).toFixed(0)}</strong></div>
            <div>Cash Sales: <strong>₹${(activeRegisterSession.totalCashSalesPaisa / 100).toFixed(0)}</strong></div>
            <div>Expected Cash: <strong>₹${(activeRegisterSession.expectedCashPaisa / 100).toFixed(0)}</strong></div>
          </div>

          <div>
            <label style="font-weight:700;display:block;margin-bottom:3px;">Blind Cash Close (Counted Cash in Drawer)</label>
            <input type="number" id="counted-cash-input" class="input" placeholder="Enter physical cash count in ₹..." style="font-size:13px;font-weight:700;" />
          </div>
        ` : `
          <div style="text-align:center;padding:16px 0;">
            <p style="color:var(--muted);margin-bottom:10px;">No register currently open for this terminal.</p>
            <div>
              <label style="font-weight:700;display:block;margin-bottom:3px;text-align:left;">Opening Float (₹)</label>
              <input type="number" id="opening-float-input" class="input" value="2000" style="font-size:13px;font-weight:700;margin-bottom:10px;" />
            </div>
          </div>
        `}
      </div>
    `,
    saveLabel: activeRegisterSession ? "Declare Count & Close Register" : "Open Register Session",
    cancelLabel: "Cancel",
    onSave: async () => {
      if (activeRegisterSession) {
        const counted = Number(document.querySelector("#counted-cash-input")?.value) || 0;
        try {
          const res = await apiPost("/bills/register/session/close", {
            registerSessionId: activeRegisterSession.registerSessionId,
            countedCashPaisa: counted * 100,
            closingDeclarationNote: "Certified physical drawer count by cashier.",
          });
          activeRegisterSession = null;
          showToast(res.message || "Register session closed successfully.", "mint");
          refreshPOSView(root);
        } catch (err) {
          showToast(err.message || "Failed to close register", "error");
        }
      } else {
        const floatVal = Number(document.querySelector("#opening-float-input")?.value) || 0;
        const cafeId = resolvePosCafeId();
        if (!cafeId) {
          showToast("Select a café before opening the register.", "danger");
          const cafeSelector = document.querySelector("#global-cafe-selector") || document.querySelector("#ctx-cafe-selector");
          if (cafeSelector) cafeSelector.focus();
          return;
        }
        try {
          const res = await apiPost("/bills/register/session/open", {
            cafeId,
            registerId: "REG-01",
            openingFloatPaisa: floatVal * 100,
          });
          activeRegisterSession = res.data;
          showToast(`Register opened with ₹${floatVal} float.`, "mint");
          refreshPOSView(root);
        } catch (err) {
          showToast(err.message || "Failed to open register", "error");
        }
      }
    },
  });
}

function refreshPOSView(root) {
  const activeId = document.activeElement?.id || null;
  const cursorStart = document.activeElement?.selectionStart;
  const cursorEnd = document.activeElement?.selectionEnd;
  const content = root.querySelector(".pos-workspace, .past-orders-workspace, .pos-grid-layout") || root;
  content.innerHTML = renderPOS();
  wirePOSEventListeners(root);
  if (activeId) {
    const el = root.querySelector("#" + activeId);
    if (el) {
      el.focus();
      if (typeof cursorStart === "number" && typeof cursorEnd === "number" && el.setSelectionRange) {
        el.setSelectionRange(cursorStart, cursorEnd);
      }
    }
  }
}
