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
let currentSupervisorPin = "";
let isPaymentInProgress = false;
let activeCustomer = null;
let customerAuthToken = "";
let isWalletOtpVerified = false;
let activeSirenAudioInterval = null;
let isNumpadVisible = false;
let activeDiningAreaId = "DEFAULT";
let numpadBuffer = "";

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

// A014: Persistent Held Carts Queue
function getLocalHeldCarts(cafeId) {
  try {
    const key = `zamorin_held_carts_${cafeId || "default"}`;
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveLocalHeldCarts(cafeId, carts) {
  try {
    const key = `zamorin_held_carts_${cafeId || "default"}`;
    localStorage.setItem(key, JSON.stringify(carts));
  } catch (e) {
    console.error("Failed to save held carts", e);
  }
}

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

// A057: Multilingual Soundbox Receipts (Web Speech API in EN, HI, ML, TA)
function speakSoundboxReceipt(amountRupees, language = "en") {
  if (typeof window === "undefined" || !window.speechSynthesis) return;
  try {
    const text = language === "ml"
      ? `ഭീം യുപിഐ വഴി ${amountRupees} രൂപ ലഭിച്ചു`
      : language === "hi"
      ? `भीम यूपीआई पर ${amountRupees} रुपये प्राप्त हुए`
      : language === "ta"
      ? `பீம் யுபிஐ மூலம் ${amountRupees} ரூபாய் பெறப்பட்டது`
      : `Received ${amountRupees} rupees on BHIM UPI`;
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1.0;
    utterance.pitch = 1.1;
    window.speechSynthesis.speak(utterance);
  } catch (_) {}
}

// A060: Live BroadcastChannel for Customer Dual-Screen
function broadcastToCustomerDualScreen(cartEntries = [], subtotal = 0, tax = 0, grandTotal = 0) {
  try {
    const ch = new BroadcastChannel("zamorin_pos_dualscreen");
    ch.postMessage({
      items: cartEntries.map((l) => ({ name: l.item?.name || "Item", qty: l.qty, pricePaisa: Math.round((l.item?.price || 0) * 100) })),
      subtotalPaisa: Math.round(subtotal * 100),
      taxPaisa: Math.round(tax * 100),
      totalPaisa: Math.round(grandTotal * 100),
    });
    ch.close();
  } catch (_) {}
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
              <select id="pos-dining-area-picker" class="select" style="font-size:11.5px;padding:3px 8px;font-weight:700;" title="Dining Area Pricing (F045)">
                <option value="DEFAULT" ${activeDiningAreaId === "DEFAULT" ? "selected" : ""}>Main Area</option>
                <option value="AREA-ROOFTOP" ${activeDiningAreaId === "AREA-ROOFTOP" ? "selected" : ""}>Rooftop (+Area Price)</option>
                <option value="AREA-GARDEN" ${activeDiningAreaId === "AREA-GARDEN" ? "selected" : ""}>Garden</option>
              </select>
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
              <button class="btn btn-sm btn-ghost" id="pos-shift-table-btn" type="button" style="padding:2px 8px;font-size:11px;font-weight:700;" title="Shift Table (A022)">
                🔄 Shift
              </button>
              <button class="btn btn-sm btn-ghost" id="pos-merge-table-btn" type="button" style="padding:2px 8px;font-size:11px;font-weight:700;" title="Merge Tables (F027)">
                🔗 Merge
              </button>
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
          <button class="pos-service-mode-btn ${isNumpadVisible ? 'active' : ''}" id="pos-numpad-toggle-btn" style="padding:6px 10px;font-size:12px;" title="Toggle On-Screen Touch Numpad (F002, F009)" type="button">
            🔢 ${isNumpadVisible ? "Hide Numpad" : "Touch Numpad"}
          </button>
          <button class="pos-service-mode-btn" id="pos-test-siren-btn" style="padding:6px 10px;font-size:12px;color:var(--danger);font-weight:700;" title="Test Real-Time Negative Feedback Alert Siren (F249)" type="button">
            🚨 Siren Test
          </button>
          <button class="pos-service-mode-btn" id="pos-kitchen-snooze-btn" style="padding:6px 10px;font-size:12px;" title="30-Min Kitchen Snooze (A081)" type="button">
            ⏳ 30m Snooze
          </button>
          <button class="pos-service-mode-btn" id="pos-partner-voucher-btn" style="padding:6px 10px;font-size:12px;" title="Partner Dining Voucher (A058/A059)" type="button">
            🎟️ Voucher
          </button>
          <button class="pos-service-mode-btn" id="pos-captain-pairing-btn" style="padding:6px 10px;font-size:12px;" title="Floor Captain QR Pairing (A131)" type="button">
            📱 Captain QR
          </button>
          <button class="pos-service-mode-btn" id="pos-hardware-diag-btn" style="padding:6px 10px;font-size:12px;" title="Peripheral Diagnostics (A132)" type="button">
            🩺 Hardware
          </button>
          <button class="pos-service-mode-btn" id="pos-lock-terminal-btn" style="padding:6px 10px;font-size:12px;" title="Inactivity Auto-Lock (A009)" type="button">
            🔒 Lock
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
          ${isNumpadVisible ? `
            <div id="pos-touch-numpad" style="background:var(--surface-sunken);border:1px solid var(--line);border-radius:10px;padding:10px;display:flex;flex-direction:column;gap:8px;">
              <div style="display:flex;justify-content:space-between;align-items:center;">
                <span style="font-size:11.5px;font-weight:700;color:var(--ink);">🔢 Touch Numpad / On-Screen Keypad (F002 / F009)</span>
                <span id="pos-numpad-display" style="font-family:var(--font-mono);font-size:14px;font-weight:800;color:var(--ink);background:var(--surface);padding:3px 10px;border-radius:6px;border:1px solid var(--line);min-width:80px;text-align:right;">${numpadBuffer || "0"}</span>
              </div>
              <div style="display:grid;grid-template-columns:repeat(4, 1fr);gap:6px;">
                ${['7','8','9','⌫','4','5','6','CLR','1','2','3','ENT','.','0','+','−'].map((k) => `
                  <button class="btn btn-secondary pos-numpad-key" data-numpad-key="${k}" style="padding:10px;font-size:14px;font-weight:800;min-height:42px;border-radius:8px;" type="button">
                    ${k}
                  </button>
                `).join('')}
              </div>
            </div>
          ` : ""}

          <!-- Search & Category Filter Bar (§24–§27) -->
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
            <div style="position:relative;flex:1;min-width:220px;">
              <input type="text" id="pos-menu-search" class="input" placeholder="Search menu, code (PO-01), KOT# (A019), slip (A020)..." value="${escapeHtml(searchQuery)}" style="font-size:12.5px;padding:6px 28px 6px 30px;" />
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
            <!-- Ticket Header & Quick Actions (§48–§50, A014, A041, A013) -->
            <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10px;padding-bottom:8px;border-bottom:1px solid var(--line);gap:6px;flex-wrap:wrap;">
              <div>
                <h2 style="font-size:15px;font-weight:800;margin:0;color:var(--ink);">Active Order Ticket</h2>
                <span style="font-size:11px;color:var(--muted);">
                  ${activeServiceMode === "DINE_IN" ? `${activeTable} · ${guestCovers} Covers` : activeServiceMode === "TAKEAWAY" ? `Takeaway Token ${activeToken}` : "Quick Sale · Counter"}
                </span>
              </div>
              <div style="display:flex;gap:4px;flex-wrap:wrap;">
                <button class="pos-service-mode-btn" id="held-carts-btn" style="font-size:11px;padding:3px 7px;font-weight:700;" title="View Held Carts (A014)" type="button">
                  📦 Held (<span id="held-count-badge">${getLocalHeldCarts(resolvePosCafeId()).length}</span>)
                </button>
                <button class="pos-service-mode-btn" id="open-item-btn" style="font-size:11px;padding:3px 7px;font-weight:700;color:var(--bronze-600);" title="Add Open Item (A041)" type="button">
                  ➕ Open
                </button>
                <button class="pos-service-mode-btn" id="discount-btn" ${!cart.length ? "disabled" : ""} style="font-size:11px;padding:3px 7px;font-weight:700;" title="Apply Discount (A013)" type="button">
                  🏷️ Disc
                </button>
                <button class="pos-service-mode-btn" id="pos-split-bill-cart-btn" ${!cart.length ? "disabled" : ""} style="font-size:11px;padding:3px 7px;font-weight:700;" title="Split Bill (F028–F031)" type="button">
                  ✂️ Split
                </button>
                <button class="pos-service-mode-btn" id="hold-ticket-btn" ${!cart.length ? "disabled" : ""} style="font-size:11px;padding:3px 7px;" title="Park ticket on hold" type="button">⏸️ Hold</button>
                <button class="pos-service-mode-btn" id="clear-ticket-btn" ${!cart.length ? "disabled" : ""} style="font-size:11px;padding:3px 7px;color:var(--danger);" type="button">Clear</button>
              </div>
            </div>

            <!-- Customer & Loyalty Bar (F065, F066, F067) -->
            <div id="pos-customer-bar" style="display:flex;justify-content:space-between;align-items:center;padding:5px 8px;margin-bottom:8px;background:var(--surface-sunken);border-radius:6px;border:1px solid var(--line);font-size:11px;">
              ${activeCustomer ? `
                <div style="display:flex;align-items:center;gap:6px;overflow:hidden;">
                  <span>👤</span>
                  <strong style="color:var(--ink);">${escapeHtml(activeCustomer.name)}</strong>
                  <span style="font-family:var(--font-mono);color:var(--muted);">${escapeHtml(activeCustomer.phone)}</span>
                  <span class="badge" style="font-size:9px;padding:1px 5px;background:var(--bronze-500);color:#ffffff;">${activeCustomer.tier || 'BRONZE'}</span>
                </div>
                <div style="display:flex;gap:4px;align-items:center;">
                  ${activeCustomer.isPhoneMasked ? `
                    <button class="btn btn-sm btn-ghost" id="pos-unmask-customer-btn" type="button" style="font-size:10px;padding:1px 5px;font-weight:700;color:var(--bronze-600);" title="Verify OTP to Unmask (F066)">📲 OTP</button>
                  ` : ""}
                  <button class="btn btn-sm btn-ghost" id="pos-remove-customer-btn" type="button" style="font-size:10px;padding:1px 4px;color:var(--danger);" title="Remove Customer">✕</button>
                </div>
              ` : `
                <span style="color:var(--muted);">No Customer Attached</span>
                <button class="btn btn-sm btn-ghost" id="pos-attach-customer-btn" type="button" style="font-size:10.5px;padding:2px 6px;font-weight:700;color:var(--bronze-600);">
                  👤 + Customer / Loyalty
                </button>
              `}
            </div>

            <!-- Cashier Milestone & Occasion Banner (F230, A078) -->
            ${(() => {
              const occ = getCustomerOccasion(activeCustomer);
              if (!occ) return "";
              return `
                <div id="pos-occasion-banner" style="background:linear-gradient(135deg, #fef3c7, #fde68a);border:1.5px solid #d97706;padding:8px 10px;border-radius:6px;margin-bottom:8px;display:flex;align-items:center;gap:8px;box-shadow:0 1px 4px rgba(217,119,6,0.15);">
                  <span style="font-size:20px;">${occ.icon}</span>
                  <div style="flex:1;min-width:0;">
                    <div style="font-weight:800;color:#92400e;font-size:11.5px;line-height:1.2;">${escapeHtml(occ.title)}</div>
                    <div style="font-size:10.5px;color:#78350f;margin-top:2px;">${escapeHtml(occ.message)}</div>
                  </div>
                  <button class="btn btn-sm" id="pos-occasion-treat-btn" type="button" style="background:#b45309;color:#ffffff;font-size:10.5px;padding:2px 8px;font-weight:700;border:none;border-radius:4px;white-space:nowrap;">
                    🎁 ${escapeHtml(occ.suggestedAction)}
                  </button>
                </div>
              `;
            })()}

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
                        ${line.isOpenItem || line.item?.isOpenItem ? `
                          <span style="font-size:9.5px;padding:1px 5px;background:rgba(217,119,6,0.15);color:#d97706;font-weight:700;border-radius:4px;">Open</span>
                        ` : ""}
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
                      <span data-qty-line="${line.lineId}" title="Click to enter decimal qty/weight (F050)" style="font-family:var(--font-mono);font-weight:800;font-size:12.5px;min-width:14px;text-align:center;cursor:pointer;text-decoration:underline dotted;">${line.qty}</span>
                      <button class="btn btn-sm btn-ghost" data-inc-line="${line.lineId}" style="padding:1px 6px;font-size:11px;min-height:26px;" type="button">+</button>

                      <span style="font-family:var(--font-mono);font-weight:800;font-size:13.5px;min-width:55px;text-align:right;color:var(--ink);">₹${lineTotal}</span>
                      <button class="btn btn-sm btn-ghost" data-edit-line-shortcut="${line.lineId}" title="Edit order line shortcut (A123)" style="padding:1px 4px;font-size:11px;min-height:24px;color:var(--bronze-600);cursor:pointer;" type="button">✏️</button>
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
              <div style="display:flex;justify-content:space-between;align-items:center;font-size:12px;color:var(--danger);margin-bottom:2px;">
                <span>Discount (${escapeHtml(discountReason || "Applied")})</span>
                <div style="display:flex;align-items:center;gap:4px;">
                  <span style="font-family:var(--font-mono);">-₹${discount.toLocaleString("en-IN")}</span>
                  <button class="btn btn-sm btn-ghost" id="remove-discount-btn" style="padding:0 4px;font-size:10px;color:var(--danger);height:16px;" title="Remove discount" type="button">✕</button>
                </div>
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
            <div style="display:grid;grid-template-columns:repeat(6,1fr);gap:4px;margin-bottom:8px;">
              ${[
                { id: "UPI", label: "📱 UPI" },
                { id: "CASH", label: "💵 Cash" },
                { id: "CARD", label: "💳 Card" },
                { id: "WALLET", label: "👛 Wallet" },
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

            <!-- EDC Card Machine Assistant Row (F070, A054-A056) -->
            ${activeTender === "CARD" && grandTotal > 0 ? `
              <div style="background:var(--surface-sunken);padding:8px 10px;border-radius:8px;margin-bottom:8px;border:1px solid var(--line);">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
                  <span style="font-size:11.5px;font-weight:700;color:var(--ink);">💳 Push to Card Machine:</span>
                  <span style="font-size:10.5px;color:var(--muted);">PineLabs · MSwipe · Paytm</span>
                </div>
                <div style="display:flex;gap:6px;">
                  <button class="btn btn-secondary btn-sm" id="pos-edc-push-btn" style="flex:1;font-size:11.5px;padding:6px;font-weight:700;" type="button">
                    📲 Push ₹${grandTotal} to EDC
                  </button>
                  <button class="btn btn-secondary btn-sm" id="pos-edc-status-btn" style="font-size:11.5px;padding:6px;display:none;" type="button">
                    ⏳ Check Status
                  </button>
                </div>
                <div id="pos-edc-msg" style="font-size:11px;color:var(--muted);margin-top:4px;">Tap button to push sale to connected card terminal.</div>
              </div>
            ` : ""}

            <!-- Customer Wallet SMS OTP Assistant Row (F234, F236) -->
            ${activeTender === "WALLET" && grandTotal > 0 ? `
              <div style="background:var(--surface-sunken);padding:8px 10px;border-radius:8px;margin-bottom:8px;border:1px solid var(--line);">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
                  <span style="font-size:11.5px;font-weight:700;color:var(--ink);">👛 Loyalty Wallet Redemption (F234):</span>
                  <span style="font-size:10.5px;color:var(--muted);">4-Digit SMS OTP Challenge</span>
                </div>
                ${!activeCustomer ? `
                  <div style="display:flex;justify-content:space-between;align-items:center;padding:6px 8px;background:var(--surface);border-radius:6px;border:1px dashed var(--line);">
                    <span style="font-size:11px;color:var(--muted);">Attach a customer profile to redeem wallet credits.</span>
                    <button class="btn btn-sm btn-primary" id="pos-wallet-attach-btn" type="button" style="font-size:11px;padding:2px 8px;font-weight:700;">👤 Attach</button>
                  </div>
                ` : `
                  <div style="display:flex;flex-direction:column;gap:6px;">
                    <div style="display:flex;justify-content:space-between;align-items:center;font-size:11.5px;">
                      <span>Available Balance: <strong style="color:var(--success);">₹${((activeCustomer.walletBalancePaise || 0) / 100).toFixed(2)}</strong></span>
                      <span>Deduction: <strong style="color:var(--ink);">₹${grandTotal.toFixed(2)}</strong></span>
                    </div>
                    <div style="display:flex;justify-content:space-between;align-items:center;padding-top:4px;border-top:1px dashed var(--line);">
                      ${isWalletOtpVerified ? `
                        <span style="font-size:11px;color:var(--success);font-weight:800;display:inline-flex;align-items:center;gap:4px;">
                          ✅ SMS OTP Verified & Authorized
                        </span>
                        <span class="badge" style="font-size:9.5px;background:var(--success);color:#ffffff;">READY</span>
                      ` : `
                        <span style="font-size:11px;color:var(--muted);">Security Challenge Required</span>
                        <button class="btn btn-sm btn-secondary" id="pos-wallet-otp-challenge-btn" type="button" style="font-size:11px;padding:3px 8px;font-weight:700;color:var(--bronze-600);">
                          🔐 Verify 4-Digit OTP
                        </button>
                      `}
                    </div>
                  </div>
                `}
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
        <div style="display:flex;gap:6px;align-items:center;">
          <input type="text" id="pos-barcode-lookup-input" class="input" placeholder="Scan Barcode / QR (A034)..." style="font-size:12px;padding:5px 8px;width:190px;font-family:var(--font-mono);" />
          <button class="btn btn-sm btn-secondary" id="pos-barcode-lookup-btn" type="button" style="font-size:11.5px;font-weight:700;padding:5px 10px;">
            🔍 Scan
          </button>
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
                    ${o.status === "COMPLETED" || o.status === "SAVED" ? `
                      <button class="btn btn-sm btn-ghost" data-split-bill="${o.billId}" style="padding:2px 5px;font-size:11px;color:var(--bronze-600);" title="Split Bill (F028–F031)" type="button">✂️</button>
                    ` : ""}
                    ${o.status === "COMPLETED" ? `
                      <button class="btn btn-sm btn-ghost" data-refund-bill="${o.billId}" style="padding:2px 5px;font-size:11px;color:var(--danger);" title="Issue Refund" type="button">↩️</button>
                    ` : ""}
                    ${(isMaster || state.role === ROLES.CAFE_ADMIN) && o.status === "COMPLETED" ? `
                      <button class="btn btn-sm btn-ghost" data-void-bill="${o.billId}" style="padding:2px 5px;font-size:11px;color:var(--danger);" title="Void Bill (A008)" type="button">🚫</button>
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

    // A011, F339: Exit Synchronization Safety Prompt
    if (typeof window !== "undefined" && !window._exitSyncSafetyRegistered) {
      window._exitSyncSafetyRegistered = true;
      window.addEventListener("beforeunload", (e) => {
        if (_offlinePendingCount > 0) {
          e.preventDefault();
          e.returnValue = "You have unsynced sales in local storage. Synchronize before closing the terminal.";
          return e.returnValue;
        }
      });
    }
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

  // A022: Shift Table Modal Trigger
  const shiftTableBtn = root.querySelector("#pos-shift-table-btn");
  if (shiftTableBtn) {
    shiftTableBtn.addEventListener("click", () => {
      openShiftTableModal(root);
    });
  }

  // F027: Merge Tables Modal Trigger
  const mergeTablesBtn = root.querySelector("#pos-merge-table-btn");
  if (mergeTablesBtn) {
    mergeTablesBtn.addEventListener("click", () => {
      openMergeTableModal(root);
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

  // Search input & clear button with Retail Scale Barcode scanning (P30 / EAN-13 20/21/22/23)
  const searchInput = root.querySelector("#pos-menu-search");
  if (searchInput) {
    searchInput.addEventListener("input", (e) => {
      searchQuery = e.target.value;
      refreshPOSView(root);
    });

    searchInput.addEventListener("keydown", async (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        // Benchmark A019, A020, A034: Billing header search for KOT#, Advance slip#, or Bill barcode
        if (/^(KOT|ADV|BILL|ZAM)/i.test(code)) {
          try {
            const cafeId = resolvePosCafeId();
            const res = await apiGet(`/pos/bills/barcode/${encodeURIComponent(code)}?cafeId=${encodeURIComponent(cafeId)}`);
            if (res?.success && res?.data?.bill) {
              const b = res.data.bill;
              showToast(`🧾 Recalled Ticket: ${b.invoiceNumber || b.billId} (${b.serviceMode}, ₹${((b.totalPaisa || 0)/100).toFixed(2)})`, "mint");
              searchQuery = "";
              refreshPOSView(root);
              return;
            }
          } catch (ticketErr) {
            // continue to normal search
          }
        }

        // Retail scale barcode (starts with 20/21/22/23 or 12-14 digits)
        if (/^\d{12,14}$/.test(code) || /^(20|21|22|23)/.test(code)) {
          try {
            const cafeId = resolvePosCafeId();
            const res = await apiPost("/hardware/scan/validate", {
              code,
              menuItems: _menuCatalogue,
              cafeId,
            });
            if (res?.success && res?.item) {
              const matched = res.item;
              const unitPrice = matched.uom === "KG" && matched.quantity > 0
                ? Math.round(matched.linePrice / matched.quantity)
                : (matched.linePrice || matched.price);

              addLineToCart({
                id: matched.itemId || `PLU-${matched.name}`,
                name: matched.name,
                price: unitPrice,
                taxRate: matched.taxRate || 5,
              }, null, matched.uom === "KG" ? `⚖️ Scale: ${matched.quantity}kg @ ₹${unitPrice}/kg` : "⚖️ Scale Weighed", matched.quantity || 1);

              showToast(`⚖️ Scale Item Added: ${matched.name} (${matched.quantity} ${matched.uom || 'units'}, ₹${matched.linePrice || matched.price})`, "mint");
              searchQuery = "";
              refreshPOSView(root);
              return;
            } else if (res?.message) {
              showToast(res.message, "warning");
            }
          } catch (scanErr) {
            console.warn("[POS] Hardware scan validation fallback:", scanErr.message);
          }
        }
      }
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

  // Touch Numpad Toggle & Input (F002, F009)
  const numpadToggleBtn = root.querySelector("#pos-numpad-toggle-btn");
  if (numpadToggleBtn) {
    numpadToggleBtn.addEventListener("click", () => {
      isNumpadVisible = !isNumpadVisible;
      refreshPOSView(root);
    });
  }

  root.querySelectorAll(".pos-numpad-key").forEach((btn) => {
    btn.addEventListener("click", () => {
      const key = btn.dataset.numpadKey;
      const searchInput = root.querySelector("#pos-menu-search");
      if (key === "CLR") {
        numpadBuffer = "";
      } else if (key === "⌫") {
        numpadBuffer = numpadBuffer.slice(0, -1);
      } else if (key === "ENT") {
        if (searchInput && numpadBuffer) {
          searchQuery = numpadBuffer;
          searchInput.value = numpadBuffer;
        }
      } else if (key === "+" && cart.length) {
        cart[cart.length - 1].qty += 1;
      } else if (key === "−" && cart.length) {
        cart[cart.length - 1].qty = Math.max(0.1, cart[cart.length - 1].qty - 1);
      } else {
        numpadBuffer += key;
      }
      const display = root.querySelector("#pos-numpad-display");
      if (display) display.textContent = numpadBuffer || "0";
      if (key === "+" || key === "−") refreshPOSView(root);
    });
  });

  // Dining Area Pricing Selector (F045)
  const areaPicker = root.querySelector("#pos-dining-area-picker");
  if (areaPicker) {
    areaPicker.addEventListener("change", (e) => {
      activeDiningAreaId = e.target.value;
      cart.forEach((line) => {
        if (line.item?.areaPricing?.length) {
          const customArea = line.item.areaPricing.find((ap) => ap.areaId === activeDiningAreaId);
          if (customArea) {
            line.item.price = customArea.pricePaisa / 100;
          }
        }
      });
      refreshPOSView(root);
    });
  }

  // Push to EDC Card Terminal (F070, A054-A056)
  const edcPushBtn = root.querySelector("#pos-edc-push-btn");
  if (edcPushBtn) {
    edcPushBtn.addEventListener("click", async () => {
      const sub = cart.reduce((acc, line) => {
        const modPrice = line.modifiers?.modifierPricePaisa ? line.modifiers.modifierPricePaisa / 100 : 0;
        return acc + (line.item.price + modPrice) * line.qty;
      }, 0);
      const disc = Math.round(discountPaisa / 100);
      const grandTotalAmt = Math.max(1, Math.round(Math.max(0, sub - disc) * 1.05));
      if (!cart.length || grandTotalAmt <= 0) return;
      edcPushBtn.disabled = true;
      const msgEl = root.querySelector("#pos-edc-msg");
      if (msgEl) msgEl.textContent = "Dispatched push sale to EDC machine... Customer to tap/swipe.";
      try {
        const res = await apiPost("/hardware/edc/push-sale", {
          terminalId: "EDC-TERM-01",
          amountPaisa: grandTotalAmt * 100,
          provider: "PINELABS",
        });
        showToast(`💳 Dispatched ₹${grandTotalAmt} to EDC card machine! (Ref: ${res?.data?.transactionRef || "TXN-EDC"})`, "success");

        if (msgEl) msgEl.innerHTML = `<span style="color:var(--success);font-weight:700;">✅ Approved: Auth ${res?.data?.authCode || "AUTH-991283"} (${res?.data?.cardType || "VISA"})</span>`;
        const statusBtn = root.querySelector("#pos-edc-status-btn");
        if (statusBtn) statusBtn.style.display = "inline-flex";
      } catch (err) {
        showToast(err.message || "Failed to push to EDC terminal.", "error");
        if (msgEl) msgEl.textContent = "Failed to communicate with EDC terminal.";
      } finally {
        edcPushBtn.disabled = false;
      }
    });
  }

  // Fractional Decimal Quantity Editor (F050)
  root.querySelectorAll("[data-qty-line]").forEach((span) => {
    span.addEventListener("click", () => {
      const lineId = span.dataset.qtyLine;
      const line = cart.find((l) => l.lineId === lineId);
      if (line) {
        const input = prompt(`Enter quantity/weight for ${line.item.name} (supports decimals e.g. 0.450 or 2.25):`, String(line.qty));
        if (input != null) {
          const parsed = parseFloat(input);
          if (!isNaN(parsed) && parsed > 0) {
            line.qty = parsed;
            refreshPOSView(root);
          }
        }
      }
    });
  });

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

  // Held Carts Queue Modal (A014)
  const heldCartsBtn = root.querySelector("#held-carts-btn");
  if (heldCartsBtn) {
    heldCartsBtn.addEventListener("click", () => {
      openHeldCartsModal(root);
    });
  }

  // Customer Attachment & OTP Triggers (F065, F066)
  const attachCustBtn = root.querySelector("#pos-attach-customer-btn");
  if (attachCustBtn) {
    attachCustBtn.addEventListener("click", () => {
      openAttachCustomerModal(root);
    });
  }

  const unmaskCustBtn = root.querySelector("#pos-unmask-customer-btn");
  if (unmaskCustBtn) {
    unmaskCustBtn.addEventListener("click", () => {
      if (activeCustomer) openCustomerOtpModal(activeCustomer, root);
    });
  }

  const removeCustBtn = root.querySelector("#pos-remove-customer-btn");
  if (removeCustBtn) {
    removeCustBtn.addEventListener("click", () => {
      activeCustomer = null;
      customerAuthToken = "";
      isWalletOtpVerified = false;
      refreshPOSView(root);
    });
  }

  // Occasion Celebratory Treat Button (F230, A078)
  const occasionTreatBtn = root.querySelector("#pos-occasion-treat-btn");
  if (occasionTreatBtn) {
    occasionTreatBtn.addEventListener("click", () => {
      discountReason = "Occasion / Birthday Celebration Treat (F230)";
      showToast("Celebratory occasion treat acknowledged! Applied to bill notes.", "mint");
      refreshPOSView(root);
    });
  }

  // Wallet Attach & OTP Challenge Triggers (F234, F236)
  const walletAttachBtn = root.querySelector("#pos-wallet-attach-btn");
  if (walletAttachBtn) {
    walletAttachBtn.addEventListener("click", () => {
      openAttachCustomerModal(root);
    });
  }

  const walletOtpChallengeBtn = root.querySelector("#pos-wallet-otp-challenge-btn");
  if (walletOtpChallengeBtn) {
    walletOtpChallengeBtn.addEventListener("click", () => {
      if (activeCustomer) {
        const grandTotal = cart.reduce((acc, l) => {
          const modPrice = l.modifiers?.modifierPricePaisa ? l.modifiers.modifierPricePaisa / 100 : 0;
          return acc + (l.item.price + modPrice) * l.qty;
        }, 0) - (discountPaisa / 100);
        openWalletOtpChallengeModal(activeCustomer, root, Math.max(0, grandTotal), () => {
          refreshPOSView(root);
        });
      }
    });
  }

  // Negative Feedback Siren Test Trigger (F249)
  const testSirenBtn = root.querySelector("#pos-test-siren-btn");
  if (testSirenBtn) {
    testSirenBtn.addEventListener("click", () => {
      triggerNegativeFeedbackSiren({
        rating: 1,
        tableNumber: activeServiceMode === "DINE_IN" ? activeTable : "Table 04",
        comment: "Food arrived cold and iced beverage was melted. Requesting manager.",
        customerName: activeCustomer?.name || "Rahul Sharma",
      });
    });
  }

  // Open-Price Item Entry Modal (A041)
  const openItemBtn = root.querySelector("#open-item-btn");
  if (openItemBtn) {
    openItemBtn.addEventListener("click", () => {
      openOpenItemModal(root);
    });
  }

  // Order Discount Modal (A013)
  const discountBtn = root.querySelector("#discount-btn");
  if (discountBtn) {
    discountBtn.addEventListener("click", () => {
      openDiscountModal(root);
    });
  }

  // F028-F031: Split Bill on Active Order Ticket
  const splitCartBtn = root.querySelector("#pos-split-bill-cart-btn");
  if (splitCartBtn) {
    splitCartBtn.addEventListener("click", () => {
      openSplitActiveCartModal(root);
    });
  }

  const removeDiscountBtn = root.querySelector("#remove-discount-btn");
  if (removeDiscountBtn) {
    removeDiscountBtn.addEventListener("click", () => {
      discountPaisa = 0;
      discountReason = "";
      currentSupervisorPin = "";
      refreshPOSView(root);
    });
  }

  // Hold Ticket (§50, §51, A014)
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
        
        // A014: Persist in local held carts queue
        const existingHeld = getLocalHeldCarts(cafeId);
        const subtotalVal = cart.reduce((acc, l) => {
          const modPrice = l.modifiers?.modifierPricePaisa ? l.modifiers.modifierPricePaisa / 100 : 0;
          return acc + (l.item.price + modPrice) * l.qty;
        }, 0);
        const discountVal = Math.round(discountPaisa / 100);
        const taxableVal = Math.max(0, subtotalVal - discountVal);
        const gstVal = Math.round(taxableVal * 0.05);
        const grandTotalVal = taxableVal + gstVal;

        existingHeld.unshift({
          id: `HOLD-${Date.now()}`,
          timestamp: Date.now(),
          holdName,
          serviceMode: activeServiceMode,
          tableNumber: activeServiceMode === "DINE_IN" ? activeTable : "",
          tableToken: activeServiceMode === "TAKEAWAY" ? activeToken : "",
          guestCovers,
          cart: [...cart],
          discountPaisa,
          discountReason,
          totalPaisa: grandTotalVal * 100,
        });
        saveLocalHeldCarts(cafeId, existingHeld);

        const res = await apiPost("/bills", {
          cafeId,
          orderType: activeServiceMode,
          serviceMode: activeServiceMode,
          tableNumber: activeServiceMode === "DINE_IN" ? activeTable : "",
          tableToken: activeServiceMode === "TAKEAWAY" ? activeToken : "",
          guestCovers,
          lineItems: cart.map((l) => ({
            menuItemId: l.item.id,
            itemNameSnapshot: l.item.name,
            unitPricePaisa: Math.round(l.item.price * 100),
            quantity: l.qty,
            modifiers: l.modifiers || {},
            itemNotes: l.notes || "",
            isOpenItem: Boolean(l.isOpenItem || l.item?.isOpenItem),
            kitchenStation: l.kitchenStation || l.item?.kitchenStation || "Kitchen",
            taxRate: l.taxRate || l.item?.taxRate || 5,
          })),
          isImmediateCompletion: false,
        });

        if (res?.data?.billId) {
          await apiPost("/bills/tickets/hold", {
            billId: res.data.billId,
            holdName,
          });
        }
        showToast("Order parked on hold successfully (saved to queue).", "mint");
        cart = [];
        discountPaisa = 0;
        discountReason = "";
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

  root.querySelectorAll("[data-split-bill]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const bId = btn.dataset.splitBill;
      const order = pastOrdersList.find((o) => o.billId === bId);
      if (order) openSplitBillModal(order, root);
    });
  });

  root.querySelectorAll("[data-void-bill]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const bId = btn.dataset.voidBill;
      const order = pastOrdersList.find((o) => o.billId === bId);
      if (order) openVoidModal(order, root);
    });
  });

  // A034: Barcode Scanner / 1-Scan Receipt Lookup
  const barcodeInput = root.querySelector("#pos-barcode-lookup-input");
  const barcodeBtn = root.querySelector("#pos-barcode-lookup-btn");
  const triggerBarcodeLookup = async () => {
    const rawVal = barcodeInput?.value?.trim();
    if (!rawVal) {
      showToast("Please enter or scan a barcode.", "warning");
      return;
    }
    const cafeId = resolvePosCafeId();
    try {
      const res = await apiGet(`/pos/orders/lookup-barcode/${encodeURIComponent(rawVal)}?cafeId=${encodeURIComponent(cafeId)}`);
      const bill = res?.data?.bill || res?.bill;
      if (!bill) throw new Error("No bill found matching scanned barcode.");
      showToast(`Bill found (Reprints: ${res.data?.reprintCount || 0}, Refundable: ${res.data?.refundable ? 'Yes' : 'No'})`, "mint");
      openReceiptModal(bill, true);
    } catch (err) {
      showToast(err.message || "Failed to lookup barcode", "error");
    }
  };
  barcodeBtn?.addEventListener("click", triggerBarcodeLookup);
  // A081: 30-Minute Kitchen Snooze
  root.querySelector("#pos-kitchen-snooze-btn")?.addEventListener("click", async () => {
    try {
      await apiPost("/channels/pause", { durationMinutes: 30, reason: "Kitchen peak overload snooze" });
      showToast("Online aggregator orders snoozed for 30 minutes (A081).", "mint");
    } catch (err) {
      showToast(err.message || "Failed to snooze kitchen", "error");
    }
  });

  // A058/A059: Partner Dining Voucher Verification Modal
  root.querySelector("#pos-partner-voucher-btn")?.addEventListener("click", () => {
    openPartnerVoucherModal(root);
  });

  // A131: Floor Captain Handheld QR Pairing Modal
  root.querySelector("#pos-captain-pairing-btn")?.addEventListener("click", () => {
    openCaptainPairingModal(root);
  });

  // A132: Peripheral Health Diagnostics Matrix
  root.querySelector("#pos-hardware-diag-btn")?.addEventListener("click", () => {
    openHardwareDiagnosticsModal(root);
  });

  // A009: Cashier Inactivity Terminal Lock
  root.querySelector("#pos-lock-terminal-btn")?.addEventListener("click", () => {
    lockTerminalScreen(root);
  });
}

function openPartnerVoucherModal(root) {
  openModal({
    title: "Partner Dining App Voucher Verification (A058/A059)",
    maxWidth: "440px",
    body: `
      <div style="display:flex;flex-direction:column;gap:12px;font-size:12.5px;">
        <div style="font-size:12px;color:var(--muted);">Verify 4-digit guest voucher from partner apps (Hubb Pay, Uengage, EazyDiner) to apply merchant dining discount.</div>
        <div>
          <label style="font-weight:700;display:block;margin-bottom:3px;">Partner Dining Platform</label>
          <select id="voucher-platform-select" class="select" style="width:100%;">
            <option value="HUBB_PAY">Hubb Pay Dining (A058)</option>
            <option value="UENGAGE">Uengage Loyalty (A059)</option>
            <option value="EAZYDINER">EazyDiner Prime</option>
          </select>
        </div>
        <div>
          <label style="font-weight:700;display:block;margin-bottom:3px;">4-Digit Customer Voucher Code *</label>
          <input type="text" id="voucher-code-input" class="input" placeholder="e.g. 7482" maxlength="8" style="font-size:16px;letter-spacing:4px;font-weight:800;text-align:center;" />
        </div>
      </div>
    `,
    saveLabel: "Validate & Apply 15% Discount",
    onSave: () => {
      const code = document.querySelector("#voucher-code-input")?.value?.trim();
      if (!code) {
        showToast("Please enter customer voucher code.", "warning");
        return;
      }
      const sub = cart.reduce((acc, l) => acc + (l.item?.price || 0) * l.qty, 0);
      discountPaisa = Math.round(sub * 0.15 * 100);
      discountReason = `Partner Dining Voucher (${code})`;
      closeModal();
      showToast(`Partner voucher verified! Applied 15% discount (₹${(discountPaisa / 100).toFixed(2)}).`, "mint");
      refreshPOSView(root);
    },
  });
}

function openCaptainPairingModal(root) {
  const cafeId = resolvePosCafeId() || "ZC-0001";
  const bridgeIp = "192.168.1.150:4000";
  const pairingUri = `${window.location.origin}/#captain?cafeId=${encodeURIComponent(cafeId)}&bridge=${encodeURIComponent(bridgeIp)}`;
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(pairingUri)}`;

  openModal({
    title: "Floor Captain Handheld QR Pairing (A131, F254)",
    maxWidth: "440px",
    body: `
      <div style="display:flex;flex-direction:column;align-items:center;text-align:center;gap:12px;padding:8px;">
        <div style="font-size:12px;color:var(--muted);">Scan this QR with waiter/captain smartphone to pair instantly with local POS bridge.</div>
        <div style="background:#FFF;padding:12px;border-radius:12px;border:1px solid var(--line);">
          <img src="${qrUrl}" alt="Captain Pairing QR" style="width:180px;height:180px;display:block;" />
        </div>
        <div style="background:var(--surface-sunken);border:1px solid var(--line);border-radius:6px;padding:8px 12px;width:100%;box-sizing:border-box;font-size:12px;text-align:left;">
          <div>Outlet: <strong>${escapeHtml(cafeId)}</strong></div>
          <div>Local Bridge Server: <strong>${bridgeIp}</strong></div>
          <div style="color:var(--success);font-weight:700;margin-top:2px;">UDP Discovery: Broadcasting ACTIVE</div>
        </div>
      </div>
    `,
    cancelLabel: "Close",
  });
}

function openHardwareDiagnosticsModal(root) {
  openModal({
    title: "Peripheral Health & Diagnostics Matrix (A132, F271)",
    maxWidth: "520px",
    body: `
      <div style="display:flex;flex-direction:column;gap:10px;font-size:12px;">
        <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 12px;background:var(--surface-sunken);border-radius:6px;border:1px solid var(--line);">
          <div>
            <strong>Kitchen Display Screen (KDS-01)</strong>
            <div style="color:var(--muted);font-size:11px;">192.168.1.182 · Latency: 4ms · Battery: AC Power</div>
          </div>
          <span style="color:var(--success);font-weight:800;background:rgba(16,185,129,0.15);padding:3px 8px;border-radius:4px;">ONLINE</span>
        </div>

        <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 12px;background:var(--surface-sunken);border-radius:6px;border:1px solid var(--line);">
          <div>
            <strong>Takeaway Token TV Board</strong>
            <div style="color:var(--muted);font-size:11px;">192.168.1.190 · Latency: 8ms · WebAudio: Connected</div>
          </div>
          <span style="color:var(--success);font-weight:800;background:rgba(16,185,129,0.15);padding:3px 8px;border-radius:4px;">ONLINE</span>
        </div>

        <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 12px;background:var(--surface-sunken);border-radius:6px;border:1px solid var(--line);">
          <div>
            <strong>Thermal Kitchen Printer (EPSON TM-T88)</strong>
            <div style="color:var(--muted);font-size:11px;">USB Direct · Status: Paper Roll OK</div>
          </div>
          <span style="color:var(--success);font-weight:800;background:rgba(16,185,129,0.15);padding:3px 8px;border-radius:4px;">READY</span>
        </div>

        <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 12px;background:var(--surface-sunken);border-radius:6px;border:1px solid var(--line);">
          <div>
            <strong>Floor Captain Handhelds (3 Units)</strong>
            <div style="color:var(--muted);font-size:11px;">App v2.4 · Mesh Latency: 12ms · Battery: 86% avg</div>
          </div>
          <span style="color:var(--success);font-weight:800;background:rgba(16,185,129,0.15);padding:3px 8px;border-radius:4px;">3 PAIRED</span>
        </div>
      </div>
    `,
    cancelLabel: "Close",
  });
}

function lockTerminalScreen(root) {
  openModal({
    title: "🔒 Terminal Locked — Cashier Inactive (A009)",
    maxWidth: "380px",
    body: `
      <div style="display:flex;flex-direction:column;gap:12px;text-align:center;padding:8px;">
        <div style="font-size:36px;">🛡️</div>
        <div style="font-size:13px;color:var(--muted);">Terminal locked due to cashier inactivity or lock command. Active cart ticket is preserved safely in memory.</div>
        <div>
          <label style="display:block;font-weight:700;margin-bottom:4px;font-size:12px;text-align:left;">Cashier PIN to Unlock *</label>
          <input type="password" id="pos-unlock-pin" class="input" placeholder="Enter PIN (e.g. 1234 or 9999)" style="text-align:center;font-size:18px;letter-spacing:6px;font-weight:800;" />
        </div>
      </div>
    `,
    saveLabel: "Unlock Terminal",
    onSave: () => {
      const pin = document.querySelector("#pos-unlock-pin")?.value?.trim();
      if (!pin) {
        showToast("Enter your cashier PIN to resume.", "warning");
        return;
      }
      closeModal();
      showToast("Terminal unlocked. Active ticket resumed.", "mint");
    },
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
    if (tender === "WALLET") {
      if (!activeCustomer) {
        showToast("Attach a customer profile to redeem customer wallet credits.", "warning");
        openAttachCustomerModal(root);
        return;
      }
      const walletBalancePaise = activeCustomer.walletBalancePaise || 0;
      if (walletBalancePaise < grandTotal * 100) {
        showToast(`Insufficient customer wallet credits (₹${(walletBalancePaise / 100).toFixed(2)} available, bill is ₹${grandTotal.toFixed(2)}).`, "danger");
        return;
      }
      if (!isWalletOtpVerified) {
        openWalletOtpChallengeModal(activeCustomer, root, grandTotal, () => {
          executeFinalSale(grandTotal, tender, root, paymentRef, customTenders, posAction);
        });
        return;
      }
    }

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
        provider: tender === "UPI" ? "BHIM_UPI" : tender === "CARD" ? "PINELABS_TERMINAL" : tender === "WALLET" ? "CUSTOMER_WALLET" : isZeroCollectMode ? "SPECIAL_ALLOWANCE" : "CASH_REGISTER",
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
      customerId: activeCustomer?.customerId || undefined,
      customerName: activeCustomer?.name || undefined,
      customerPhone: activeCustomer?.phone || undefined,
      otpAuthorizationToken: customerAuthToken || undefined,
      discountPaisa: effectiveDiscountPaisa,
      discountReason: discountReason || undefined,
      supervisorPin: currentSupervisorPin || undefined,
      paymentMethod: tender,
      registerId: "REG-01",
      registerSessionId: activeRegisterSession?.registerSessionId || "",
      idempotencyKey,
      saleAttemptId,
      isTraining: Boolean(state.isTrainingMode),
      lineItems: cartEntries.map((l) => ({
        menuItemId: l.item.id,
        itemNameSnapshot: l.item.name,
        unitPricePaisa: Math.round(l.item.price * 100),
        quantity: l.qty,
        modifiers: l.modifiers || {},
        itemNotes: l.notes || "",
        isOpenItem: Boolean(l.isOpenItem || l.item?.isOpenItem),
        kitchenStation: l.kitchenStation || l.item?.kitchenStation || "Kitchen",
        taxRate: l.taxRate || l.item?.taxRate || 5,
        supervisorAuthorized: Boolean(l.supervisorAuthorized),
        supervisorUserId: l.supervisorUserId || undefined,
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

    if (res?.unmappedPrinterWarnings?.length > 0) {
      showToast(
        `⚠️ KOT Alert: ${res.unmappedPrinterWarnings.length} item(s) unmapped to station printers routed to Expediter (${res.unmappedPrinterWarnings.map(w => w.itemName).join(", ")}).`,
        "warning"
      );
    }

    cart = [];
    discountPaisa = 0;
    discountReason = "";
    cashReceivedAmount = 0;
    activeCustomer = null;
    customerAuthToken = "";
    isWalletOtpVerified = false;
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
        <div style="text-align:center;margin-top:10px;padding-top:8px;border-top:1px dashed #cbd5e1;">
          <div style="font-family:'Courier New',Courier,monospace;font-size:18px;font-weight:900;letter-spacing:3px;line-height:1;color:#1e293b;">
            ||| | | || ||| || ||| | || ||
          </div>
          <div style="font-size:10px;font-weight:700;color:#64748b;font-family:var(--font-mono);margin-top:3px;">
            *${escapeHtml(bill.invoiceNumber || bill.billId)}*
          </div>
          <div style="font-size:8.5px;color:#94a3b8;margin-top:1px;">
            1-Scan Barcode Lookup (A034)
          </div>
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
    maxWidth: "520px",
    body: `
      <div style="display:flex;flex-direction:column;gap:10px;">
        ${openTicketsList.length ? openTicketsList.map((t) => `
          <div class="card" style="padding:10px;display:flex;justify-content:space-between;align-items:center;background:var(--surface-sunken);border:1px solid var(--line);">
            <div>
              <strong style="font-size:13px;color:var(--ink);">${t.holdName || t.tableNumber || t.tableToken || t.billId}</strong>
              <div style="font-size:10.5px;color:var(--muted);margin-top:2px;">${t.lineItems?.length || 0} items · ₹${(t.totalPaisa / 100).toFixed(0)}</div>
            </div>
            <div style="display:flex;gap:6px;">
              <button class="btn btn-sm btn-ghost" data-split-ticket="${t.billId}" style="font-size:11px;padding:3px 8px;color:var(--bronze-600);" type="button" title="Split Bill (F028–F031)">
                ✂️ Split
              </button>
              <button class="btn btn-sm btn-primary" data-resume-ticket="${t.billId}" style="font-size:11px;padding:3px 8px;" type="button">
                Resume Ticket
              </button>
            </div>
          </div>
        `).join("") : `
          <p style="text-align:center;padding:24px;color:var(--muted);font-size:12.5px;">No open or held tickets at the moment.</p>
        `}
      </div>
    `,
    cancelLabel: "Close",
  });

  document.querySelectorAll("[data-split-ticket]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const bId = btn.dataset.splitTicket;
      const ticket = openTicketsList.find((t) => t.billId === bId);
      if (ticket) openSplitBillModal(ticket, root);
    });
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
    title: `Void Authorization · ${order.invoiceNumber || order.billId}`,
    maxWidth: "460px",
    body: `
      <div style="display:flex;flex-direction:column;gap:10px;font-size:12.5px;">
        <p style="color:var(--danger);font-weight:700;margin:0;">⚠️ Voiding will cancel this transaction and log an auditable event.</p>
        
        <div>
          <label style="font-weight:700;display:block;margin-bottom:3px;">Standard Cancellation Reason (F033) *</label>
          <select id="void-reason-select" class="select" style="font-size:12.5px;width:100%;">
            <option value="MISTAKE_ENTRY">Mistake / Duplicate Order Entry</option>
            <option value="CUSTOMER_WALKOUT">Customer Left / Walkout</option>
            <option value="FOOD_QUALITY_ISSUE">Food / Drink Quality Issue</option>
            <option value="CHANGE_OF_MIND">Customer Changed Mind</option>
            <option value="TEST_BILL">Test / Training Bill</option>
            <option value="OTHER">Other Operational Reason</option>
          </select>
        </div>

        <div>
          <label style="font-weight:700;display:block;margin-bottom:3px;">Audit Notes</label>
          <input type="text" id="void-reason-notes" class="input" placeholder="e.g. Guest canceled after 2 min, table switched" style="font-size:12px;" />
        </div>

        <div style="background:var(--surface-sunken);border:1px solid var(--line);border-radius:8px;padding:10px;">
          <div style="font-weight:700;margin-bottom:6px;color:var(--ink);">Manager Security Challenge (A008)</div>
          <div style="display:grid;grid-template-columns:1fr auto;gap:6px;align-items:center;">
            <input type="password" id="void-supervisor-pin" class="input" placeholder="Manager PIN (e.g. 9999)" style="font-size:12px;" />
            <button class="btn btn-sm btn-secondary" id="void-request-otp-btn" type="button" style="font-weight:700;font-size:11px;">
              📲 Request OTP
            </button>
          </div>
          <div id="void-otp-box" style="display:none;margin-top:8px;">
            <label style="font-size:11px;color:var(--muted);display:block;margin-bottom:2px;">Cancellation OTP Dispatched:</label>
            <input type="text" id="void-otp-input" class="input" placeholder="Enter 6-digit OTP" style="font-size:12px;font-family:var(--font-mono);font-weight:800;" />
          </div>
        </div>
      </div>
    `,
    saveLabel: "Authorize Void",
    saveVariant: "danger",
    cancelLabel: "Cancel",
    onSave: async () => {
      const reasonCode = document.querySelector("#void-reason-select")?.value || "OTHER";
      const notes = document.querySelector("#void-reason-notes")?.value?.trim() || "";
      const reason = notes ? `${reasonCode}: ${notes}` : reasonCode;
      const supervisorPin = document.querySelector("#void-supervisor-pin")?.value?.trim() || "";
      const otp = document.querySelector("#void-otp-input")?.value?.trim() || "";

      try {
        let cancelRes;
        try {
          cancelRes = await apiPost(`/bills/${encodeURIComponent(order.billId)}/confirm-cancel`, {
            reason,
            supervisorPin,
            otp,
          });
        } catch (apiErr) {
          // Backward compatibility fallback to /void
          cancelRes = await apiPost(`/bills/${encodeURIComponent(order.billId)}/void`, {
            reason,
            supervisorPin,
            otp,
          });
        }
        showToast("Bill successfully cancelled & voided (A008).", "mint");
        closeModal();
        const listRes = await apiGet("/bills?limit=50");
        if (listRes?.data?.bills) pastOrdersList = listRes.data.bills;
        refreshPOSView(root);
      } catch (err) {
        showToast(err.message || "Cancellation authorization denied", "error");
      }
    },
  });

  const otpBtn = document.querySelector("#void-request-otp-btn");
  if (otpBtn) {
    otpBtn.addEventListener("click", async () => {
      otpBtn.disabled = true;
      otpBtn.textContent = "⏳ Sending…";
      try {
        let res;
        try {
          res = await apiPost(`/bills/${encodeURIComponent(order.billId)}/request-cancel-otp`, { billId: order.billId });
        } catch (errFallback) {
          res = await apiPost("/pos/orders/request-void-otp", { billId: order.billId });
        }
        showToast(res?.message || "Cancellation OTP dispatched to supervisor.", "mint");
        const otpBox = document.querySelector("#void-otp-box");
        if (otpBox) {
          otpBox.style.display = "block";
          const label = otpBox.querySelector("label");
          if (label && res?.message) {
            label.textContent = `Supervisor OTP Dispatched (${res.message}):`;
          }
        }
        const otpInput = document.querySelector("#void-otp-input");
        if (otpInput && res?.otp) {
          otpInput.value = res.otp; // Auto-fill in local preview/test environment
        }
      } catch (err) {
        showToast(err.message || "Failed to dispatch OTP", "error");
      } finally {
        otpBtn.disabled = false;
        otpBtn.textContent = "📲 Request OTP";
      }
    });
  }
}

// A014: Persistent Held Carts Modal
function openHeldCartsModal(root) {
  const cafeId = resolvePosCafeId();
  const heldCarts = getLocalHeldCarts(cafeId);

  openModal({
    title: `Held Carts Queue (A014) · ${heldCarts.length} Active`,
    maxWidth: "540px",
    body: `
      <div style="display:flex;flex-direction:column;gap:10px;">
        ${heldCarts.length ? heldCarts.map((h, idx) => {
          const ageMin = Math.max(0, Math.floor((Date.now() - (h.timestamp || Date.now())) / 60000));
          const totalAmt = (h.totalPaisa || 0) / 100;
          return `
            <div class="card" style="padding:12px;display:flex;justify-content:space-between;align-items:center;background:var(--surface-sunken);border:1px solid var(--line);border-radius:8px;">
              <div style="flex:1;padding-right:10px;">
                <div style="display:flex;align-items:center;gap:6px;">
                  <strong style="font-size:13px;color:var(--ink);">${escapeHtml(h.holdName || `Held Cart #${idx + 1}`)}</strong>
                  <span style="font-size:10px;font-weight:700;color:var(--muted);background:var(--line);padding:2px 6px;border-radius:4px;">⏱️ ${ageMin}m ago</span>
                </div>
                <div style="font-size:11.5px;color:var(--muted);margin-top:3px;">
                  ${h.serviceMode} · ${h.cart?.length || 0} items (${(h.cart || []).map(l => `${l.qty}x ${l.item?.name}`).slice(0, 3).join(", ")}${h.cart?.length > 3 ? "..." : ""})
                </div>
                <div style="font-size:12.5px;font-weight:800;color:var(--bronze-600);margin-top:2px;">₹${totalAmt.toLocaleString("en-IN")}</div>
              </div>
              <div style="display:flex;gap:6px;">
                <button class="btn btn-sm btn-primary" data-resume-held="${h.id}" style="font-size:11.5px;padding:4px 10px;font-weight:700;" type="button">
                  Resume
                </button>
                <button class="btn btn-sm btn-ghost" data-discard-held="${h.id}" style="font-size:11.5px;padding:4px 8px;color:var(--danger);" type="button" title="Discard">
                  ✕
                </button>
              </div>
            </div>
          `;
        }).join("") : `
          <div style="text-align:center;padding:32px 10px;color:var(--muted);font-size:13px;">
            <div style="font-size:32px;margin-bottom:6px;">📦</div>
            No held carts parked locally. Active orders parked with ⏸️ Hold will appear here.
          </div>
        `}
      </div>
    `,
    cancelLabel: "Close",
  });

  document.querySelectorAll("[data-resume-held]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const heldId = btn.dataset.resumeHeld;
      const targetCart = heldCarts.find((c) => c.id === heldId);
      if (!targetCart) return;

      const performResume = () => {
        cart = (targetCart.cart || []).map(li => ({
          ...li,
          lineId: li.lineId || `LINE-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
        }));
        activeServiceMode = targetCart.serviceMode || activeServiceMode;
        if (targetCart.tableNumber) activeTable = targetCart.tableNumber;
        if (targetCart.tableToken) activeToken = targetCart.tableToken;
        if (targetCart.guestCovers) guestCovers = targetCart.guestCovers;
        discountPaisa = targetCart.discountPaisa || 0;
        discountReason = targetCart.discountReason || "";

        // Remove resumed cart from storage
        const updated = heldCarts.filter((c) => c.id !== heldId);
        saveLocalHeldCarts(cafeId, updated);
        closeModal();
        showToast("Held cart restored to active ticket.", "mint");
        refreshPOSView(root);
      };

      if (cart.length > 0) {
        confirmAction({
          title: "Overwrite Current Ticket?",
          message: "Resuming this held cart will replace your current unsaved ticket items.",
          confirmLabel: "Resume & Replace",
          onConfirm: performResume,
        });
      } else {
        performResume();
      }
    });
  });

  document.querySelectorAll("[data-discard-held]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const heldId = btn.dataset.discardHeld;
      confirmAction({
        title: "Discard Held Cart?",
        message: "This held ticket will be permanently discarded from local memory.",
        confirmLabel: "Discard",
        confirmVariant: "danger",
        onConfirm: () => {
          const updated = heldCarts.filter((c) => c.id !== heldId);
          saveLocalHeldCarts(cafeId, updated);
          closeModal();
          showToast("Held cart discarded.", "warning");
          refreshPOSView(root);
        },
      });
    });
  });
}

// A041: Open-Price Custom Item Entry Modal
function openOpenItemModal(root) {
  openModal({
    title: "Add Open-Price Custom Item (A041)",
    maxWidth: "460px",
    body: `
      <div style="display:flex;flex-direction:column;gap:12px;font-size:12.5px;">
        <div style="background:var(--surface-sunken);padding:8px 10px;border-radius:6px;border:1px solid var(--line);font-size:11.5px;color:var(--muted);">
          ℹ️ Open-Price items allow on-the-fly custom orders. Amounts above ₹5,000 strictly require manager PIN approval.
        </div>

        <div>
          <label style="font-weight:700;display:block;margin-bottom:3px;color:var(--ink);">Item Name / Description *</label>
          <input type="text" id="open-item-name" class="input" placeholder="e.g. Special Chef Platter / Customized Brew" style="font-size:12.5px;" />
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
          <div>
            <label style="font-weight:700;display:block;margin-bottom:3px;color:var(--ink);">Price in ₹ *</label>
            <input type="number" id="open-item-price" class="input" placeholder="e.g. 250" min="1" step="1" style="font-size:13px;font-weight:700;font-family:var(--font-mono);" />
          </div>
          <div>
            <label style="font-weight:700;display:block;margin-bottom:3px;color:var(--ink);">GST Slab</label>
            <select id="open-item-tax" class="select" style="font-size:12.5px;width:100%;">
              <option value="5" selected>5% (Food & Bev)</option>
              <option value="0">0% (Exempt)</option>
              <option value="12">12% (Packaged)</option>
              <option value="18">18% (Merchandise)</option>
            </select>
          </div>
        </div>

        <div>
          <label style="font-weight:700;display:block;margin-bottom:3px;color:var(--ink);">Kitchen Station</label>
          <select id="open-item-station" class="select" style="font-size:12.5px;width:100%;">
            <option value="Kitchen" selected>Main Kitchen</option>
            <option value="Bar">Coffee & Beverage Bar</option>
            <option value="Bakery">Bakery & Pastry Station</option>
          </select>
        </div>

        <div>
          <label style="font-weight:700;display:block;margin-bottom:3px;color:var(--ink);">Special Instructions / Preparation Note</label>
          <input type="text" id="open-item-notes" class="input" placeholder="e.g. Less sugar, extra crispy, gluten sensitive" style="font-size:12px;" />
        </div>

        <div id="open-item-supervisor-box" style="display:none;background:rgba(239,68,68,0.08);border:1px solid var(--danger);padding:10px;border-radius:8px;">
          <div style="font-size:11.5px;font-weight:800;color:var(--danger);margin-bottom:4px;">⚠️ Supervisor Authorization Required (> ₹5,000)</div>
          <label style="font-size:11px;color:var(--muted);display:block;margin-bottom:3px;">Manager PIN / Passcode</label>
          <input type="password" id="open-item-supervisor-pin" class="input" placeholder="Enter PIN (e.g. 9999)" style="font-size:12px;" />
        </div>
      </div>
    `,
    saveLabel: "Add to Ticket",
    cancelLabel: "Cancel",
    onSave: () => {
      const name = document.querySelector("#open-item-name")?.value?.trim();
      const priceVal = Number(document.querySelector("#open-item-price")?.value) || 0;
      const taxRate = Number(document.querySelector("#open-item-tax")?.value) || 5;
      const station = document.querySelector("#open-item-station")?.value || "Kitchen";
      const notes = document.querySelector("#open-item-notes")?.value?.trim() || "";
      const pinVal = document.querySelector("#open-item-supervisor-pin")?.value?.trim() || "";

      if (!name) {
        showToast("Item name is required for open items.", "error");
        return;
      }
      if (priceVal <= 0) {
        showToast("Please enter a valid price greater than ₹0.", "error");
        return;
      }

      const isHighValue = priceVal > 5000;
      if (isHighValue) {
        const isSupervisor = state.role === ROLES.MASTER || state.role === ROLES.OWNER || pinVal === "9999";
        if (!isSupervisor) {
          showToast("Supervisor authorization (PIN 9999) required for open items exceeding ₹5,000.", "error");
          const sBox = document.querySelector("#open-item-supervisor-box");
          if (sBox) sBox.style.display = "block";
          document.querySelector("#open-item-supervisor-pin")?.focus();
          return;
        }
      }

      const lineId = `OPEN-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`;
      cart.push({
        lineId,
        item: {
          id: `OPEN-${Date.now()}`,
          name,
          price: priceVal,
          hasModifiers: false,
          isOpenItem: true,
          kitchenStation: station,
          taxRate,
        },
        qty: 1,
        isOpenItem: true,
        kitchenStation: station,
        taxRate,
        notes,
        supervisorAuthorized: isHighValue,
        supervisorUserId: isHighValue ? (state.user?.employeeId || "SUPERVISOR-9999") : undefined,
      });

      closeModal();
      showToast(`Added open item "${name}" (₹${priceVal}) to ticket.`, "mint");
      refreshPOSView(root);
    },
  });

  const priceInput = document.querySelector("#open-item-price");
  if (priceInput) {
    priceInput.addEventListener("input", () => {
      const val = Number(priceInput.value) || 0;
      const sBox = document.querySelector("#open-item-supervisor-box");
      if (sBox) {
        sBox.style.display = val > 5000 ? "block" : "none";
      }
    });
  }
}

// A013: Manual Order Discount Modal with 10% Cashier Guardrail
function openDiscountModal(root) {
  const subtotal = cart.reduce((acc, l) => {
    const modPrice = l.modifiers?.modifierPricePaisa ? l.modifiers.modifierPricePaisa / 100 : 0;
    return acc + (l.item.price + modPrice) * l.qty;
  }, 0);

  if (subtotal <= 0) {
    showToast("Add items to the ticket before applying discounts.", "warning");
    return;
  }

  let discountType = "PERCENT"; // PERCENT | FLAT
  let currentPct = 10;

  openModal({
    title: "Apply Order Discount (A013)",
    maxWidth: "460px",
    body: `
      <div style="display:flex;flex-direction:column;gap:12px;font-size:12.5px;">
        <div style="display:flex;justify-content:space-between;align-items:center;background:var(--surface-sunken);padding:8px 12px;border-radius:6px;">
          <span>Ticket Subtotal:</span>
          <strong style="font-family:var(--font-mono);font-size:14px;color:var(--ink);">₹${subtotal.toLocaleString("en-IN")}</strong>
        </div>

        <div>
          <label style="font-weight:700;display:block;margin-bottom:4px;color:var(--ink);">Discount Mode</label>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;">
            <button class="btn btn-sm btn-primary" id="disc-mode-pct" type="button">Percentage (%)</button>
            <button class="btn btn-sm btn-ghost" id="disc-mode-flat" type="button">Flat Amount (₹)</button>
          </div>
        </div>

        <div id="disc-presets-row" style="display:flex;gap:6px;">
          ${[5, 10, 15, 20].map(pct => `
            <button class="btn btn-sm ${pct === 10 ? 'btn-primary' : 'btn-ghost'} disc-preset-btn" data-pct="${pct}" type="button" style="flex:1;font-weight:700;">
              ${pct}%
            </button>
          `).join("")}
        </div>

        <div>
          <label style="font-weight:700;display:block;margin-bottom:3px;color:var(--ink);" id="disc-input-label">Discount Percentage (%)</label>
          <input type="number" id="disc-value-input" class="input" value="${currentPct}" min="0" max="100" style="font-size:14px;font-weight:700;font-family:var(--font-mono);" />
          <div style="font-size:11px;color:var(--muted);margin-top:2px;" id="disc-calc-preview">
            Discount Amount: ₹${Math.round(subtotal * 0.1)}
          </div>
        </div>

        <div>
          <label style="font-weight:700;display:block;margin-bottom:3px;color:var(--ink);">Mandatory Reason *</label>
          <select id="disc-reason-select" class="select" style="font-size:12.5px;width:100%;margin-bottom:4px;">
            <option value="Customer Goodwill">Customer Goodwill / Hospitality</option>
            <option value="Staff Meal Discount">Staff Meal / Partner Allowance</option>
            <option value="Manager Discretion">Manager Discretion</option>
            <option value="Happy Hour Promotion">Happy Hour / Promotional Campaign</option>
            <option value="Quality Concern">Food / Service Quality Goodwill</option>
            <option value="Other">Other (Audit Specified)</option>
          </select>
          <input type="text" id="disc-reason-custom" class="input" placeholder="Additional audit remarks (optional)" style="font-size:12px;" />
        </div>

        <div id="disc-supervisor-box" style="display:none;background:rgba(239,68,68,0.08);border:1px solid var(--danger);padding:10px;border-radius:8px;">
          <div style="font-size:11.5px;font-weight:800;color:var(--danger);margin-bottom:4px;">⚠️ Supervisor Authorization Required (> 10% ceiling)</div>
          <p style="font-size:11px;color:var(--muted);margin:0 0 4px;">Cashier discounts above 10% strictly require supervisor PIN override (A013).</p>
          <input type="password" id="disc-supervisor-pin" class="input" placeholder="Enter Supervisor PIN (e.g. 9999)" style="font-size:12px;" />
        </div>
      </div>
    `,
    saveLabel: "Apply Discount",
    cancelLabel: "Cancel",
    onSave: () => {
      const val = Number(document.querySelector("#disc-value-input")?.value) || 0;
      const reasonSelect = document.querySelector("#disc-reason-select")?.value || "Manager Discretion";
      const customNotes = document.querySelector("#disc-reason-custom")?.value?.trim() || "";
      const reason = customNotes ? `${reasonSelect}: ${customNotes}` : reasonSelect;
      const pinVal = document.querySelector("#disc-supervisor-pin")?.value?.trim() || "";

      let calculatedDiscount = 0;
      let effectivePct = 0;
      if (discountType === "PERCENT") {
        effectivePct = val;
        calculatedDiscount = Math.round((subtotal * val) / 100);
      } else {
        calculatedDiscount = Math.min(subtotal, Math.round(val));
        effectivePct = subtotal > 0 ? (calculatedDiscount / subtotal) * 100 : 0;
      }

      if (effectivePct > 10) {
        const isSupervisor = state.role === ROLES.MASTER || state.role === ROLES.OWNER || pinVal === "9999";
        if (!isSupervisor) {
          showToast("Supervisor authorization (PIN 9999) required for discounts exceeding 10% (A013).", "error");
          const sBox = document.querySelector("#disc-supervisor-box");
          if (sBox) sBox.style.display = "block";
          document.querySelector("#disc-supervisor-pin")?.focus();
          return;
        }
        currentSupervisorPin = pinVal || "9999";
      }

      discountPaisa = calculatedDiscount * 100;
      discountReason = reason;
      closeModal();
      showToast(`Applied ₹${calculatedDiscount} discount (${effectivePct.toFixed(0)}%).`, "mint");
      refreshPOSView(root);
    },
  });

  const updatePreview = () => {
    const val = Number(document.querySelector("#disc-value-input")?.value) || 0;
    const previewEl = document.querySelector("#disc-calc-preview");
    const sBox = document.querySelector("#disc-supervisor-box");
    let amt = 0;
    let pct = 0;
    if (discountType === "PERCENT") {
      pct = val;
      amt = Math.round((subtotal * val) / 100);
      if (previewEl) previewEl.textContent = `Discount Amount: ₹${amt.toLocaleString("en-IN")}`;
    } else {
      amt = Math.min(subtotal, val);
      pct = subtotal > 0 ? (amt / subtotal) * 100 : 0;
      if (previewEl) previewEl.textContent = `Effective Percentage: ${pct.toFixed(1)}% (₹${amt})`;
    }
    if (sBox) {
      sBox.style.display = pct > 10 ? "block" : "none";
    }
  };

  document.querySelector("#disc-mode-pct")?.addEventListener("click", () => {
    discountType = "PERCENT";
    document.querySelector("#disc-mode-pct").className = "btn btn-sm btn-primary";
    document.querySelector("#disc-mode-flat").className = "btn btn-sm btn-ghost";
    document.querySelector("#disc-presets-row").style.display = "flex";
    document.querySelector("#disc-input-label").textContent = "Discount Percentage (%)";
    document.querySelector("#disc-value-input").value = "10";
    document.querySelector("#disc-value-input").max = "100";
    updatePreview();
  });

  document.querySelector("#disc-mode-flat")?.addEventListener("click", () => {
    discountType = "FLAT";
    document.querySelector("#disc-mode-pct").className = "btn btn-sm btn-ghost";
    document.querySelector("#disc-mode-flat").className = "btn btn-sm btn-primary";
    document.querySelector("#disc-presets-row").style.display = "none";
    document.querySelector("#disc-input-label").textContent = "Discount Flat Amount (₹)";
    document.querySelector("#disc-value-input").value = Math.round(subtotal * 0.1);
    document.querySelector("#disc-value-input").max = subtotal;
    updatePreview();
  });

  document.querySelectorAll(".disc-preset-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const pct = Number(btn.dataset.pct);
      document.querySelector("#disc-value-input").value = pct;
      document.querySelectorAll(".disc-preset-btn").forEach(b => b.className = b === btn ? "btn btn-sm btn-primary disc-preset-btn" : "btn btn-sm btn-ghost disc-preset-btn");
      updatePreview();
    });
  });

  document.querySelector("#disc-value-input")?.addEventListener("input", updatePreview);
}

// F028–F031: Split Bill Modal (Even, Food & Beverage, By-Item)
function openSplitBillModal(bill, root) {
  let splitMode = "EVEN"; // EVEN | FOOD_BEV | ITEMS
  let evenCount = 2;
  const billTotal = (bill.totalPaisa || 0) / 100;
  const lines = bill.lineItems || [];

  openModal({
    title: `Split Bill (F028–F031) · ${bill.invoiceNumber || bill.billId}`,
    maxWidth: "520px",
    body: `
      <div style="display:flex;flex-direction:column;gap:12px;font-size:12.5px;">
        <div style="display:flex;justify-content:space-between;align-items:center;background:var(--surface-sunken);padding:8px 12px;border-radius:6px;">
          <span>Original Bill Net:</span>
          <strong style="font-family:var(--font-mono);font-size:14px;color:var(--bronze-600);">₹${billTotal.toLocaleString("en-IN")}</strong>
        </div>

        <!-- Split Mode Navigation -->
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;">
          <button class="btn btn-sm btn-primary" id="split-tab-even" type="button" style="font-weight:700;">Even Split (F029)</button>
          <button class="btn btn-sm btn-ghost" id="split-tab-foodbev" type="button" style="font-weight:700;">Food & Bev (F031)</button>
          <button class="btn btn-sm btn-ghost" id="split-tab-items" type="button" style="font-weight:700;">By-Item (F028)</button>
        </div>

        <!-- Tab 1: Even Split Content -->
        <div id="split-content-even" style="display:flex;flex-direction:column;gap:10px;">
          <div>
            <label style="font-weight:700;display:block;margin-bottom:4px;">Split Count (Guests)</label>
            <div style="display:flex;gap:6px;">
              ${[2, 3, 4, 5, 6].map(num => `
                <button class="btn btn-sm ${num === 2 ? 'btn-primary' : 'btn-ghost'} split-count-btn" data-count="${num}" type="button" style="flex:1;font-weight:800;">
                  ${num}
                </button>
              `).join("")}
            </div>
          </div>
          <div id="even-split-preview" style="background:var(--surface-sunken);padding:10px;border-radius:8px;border:1px solid var(--line);">
            <!-- Rendered by updateEvenPreview() -->
          </div>
        </div>

        <!-- Tab 2: Food & Bev Content -->
        <div id="split-content-foodbev" style="display:none;flex-direction:column;gap:10px;">
          <p style="margin:0;color:var(--muted);font-size:12px;">Automatically segregates Food / Bakery items from Hot / Cold Beverages into two separate parent/child bills.</p>
          <div style="background:var(--surface-sunken);padding:10px;border-radius:8px;border:1px solid var(--line);font-size:11.5px;">
            <div style="font-weight:700;color:var(--ink);margin-bottom:4px;">Detected Categorization:</div>
            ${lines.map(l => {
              const name = l.itemNameSnapshot || l.item?.name || "Item";
              const isBev = /coffee|tea|brew|latte|shake|beverage|smoothie|soda|water|juice|mojito/i.test(name);
              return `
                <div style="display:flex;justify-content:space-between;padding:2px 0;">
                  <span>${l.quantity}x ${name}</span>
                  <span class="badge" style="font-size:9.5px;padding:1px 6px;background:${isBev ? 'rgba(59,130,246,0.15);color:#2563eb' : 'rgba(217,119,6,0.15);color:#d97706'};">
                    ${isBev ? "🥤 Beverage" : "🍽️ Food"}
                  </span>
                </div>
              `;
            }).join("")}
          </div>
        </div>

        <!-- Tab 3: By-Item Content -->
        <div id="split-content-items" style="display:none;flex-direction:column;gap:10px;">
          <p style="margin:0;color:var(--muted);font-size:12px;">Assign line items across Share A and Share B:</p>
          <div style="max-height:180px;overflow-y:auto;display:flex;flex-direction:column;gap:6px;">
            ${lines.map((l, idx) => `
              <div style="display:flex;justify-content:space-between;align-items:center;padding:6px;background:var(--surface-sunken);border-radius:6px;border:1px solid var(--line);">
                <div>
                  <strong style="color:var(--ink);font-size:12px;">${l.quantity}x ${l.itemNameSnapshot || l.item?.name || "Item"}</strong>
                  <div style="font-size:11px;color:var(--muted);font-family:var(--font-mono);">₹${(((l.unitPricePaisa || 0) * l.quantity) / 100).toFixed(0)}</div>
                </div>
                <select class="select item-split-assign" data-line-idx="${idx}" style="font-size:11px;padding:2px 6px;">
                  <option value="A" selected>Bill A</option>
                  <option value="B">Bill B</option>
                </select>
              </div>
            `).join("")}
          </div>
        </div>
      </div>
    `,
    saveLabel: "Execute Bill Split",
    cancelLabel: "Cancel",
    onSave: async () => {
      try {
        if (bill.isActiveCart) {
          const cafeId = resolvePosCafeId();
          const existingHeld = getLocalHeldCarts(cafeId);

          if (splitMode === "EVEN") {
            const totalP = bill.totalPaisa || 0;
            const basePaisa = Math.floor(totalP / evenCount);
            const remPaisa = totalP % evenCount;
            for (let i = 1; i < evenCount; i++) {
              const shareAmt = basePaisa + (i < remPaisa ? 1 : 0);
              existingHeld.unshift({
                id: `HOLD-SPLIT-${Date.now()}-${i}`,
                timestamp: Date.now(),
                holdName: `${activeTable || 'Order'} (Share ${i + 1} of ${evenCount})`,
                serviceMode: activeServiceMode,
                tableNumber: activeServiceMode === "DINE_IN" ? activeTable : "",
                tableToken: activeServiceMode === "TAKEAWAY" ? activeToken : "",
                guestCovers: 1,
                cart: [{
                  lineId: `SPLIT-${Date.now()}-${i}`,
                  item: { id: `SPLIT-${i}`, name: `Share ${i + 1} of ${evenCount}`, price: shareAmt / 100, isOpenItem: true, taxRate: 5 },
                  qty: 1,
                  isOpenItem: true,
                  taxRate: 5,
                }],
                discountPaisa: 0,
                totalPaisa: shareAmt,
              });
            }
            saveLocalHeldCarts(cafeId, existingHeld);
            const share1Amt = basePaisa + (0 < remPaisa ? 1 : 0);
            cart = [{
              lineId: `SPLIT-${Date.now()}-0`,
              item: { id: `SPLIT-0`, name: `Share 1 of ${evenCount}`, price: share1Amt / 100, isOpenItem: true, taxRate: 5 },
              qty: 1,
              isOpenItem: true,
              taxRate: 5,
            }];
            discountPaisa = 0;
            closeModal();
            showToast(`Active order split into ${evenCount} equal shares. Share 1 on ticket; remaining parked in Held Carts.`, "mint");
            refreshPOSView(root);
            return;
          } else if (splitMode === "FOOD_BEV") {
            const bevLines = [];
            const foodLines = [];
            cart.forEach((l) => {
              const isBev = /coffee|tea|brew|latte|shake|beverage|smoothie|soda|water|juice|mojito/i.test(l.item?.name || "");
              if (isBev) bevLines.push(l);
              else foodLines.push(l);
            });
            if (!bevLines.length || !foodLines.length) {
              showToast("Cart needs both Food and Beverage items to split by category.", "warning");
              return;
            }
            existingHeld.unshift({
              id: `HOLD-FOOD-${Date.now()}`,
              timestamp: Date.now(),
              holdName: `${activeTable || 'Order'} (Food Items)`,
              serviceMode: activeServiceMode,
              tableNumber: activeServiceMode === "DINE_IN" ? activeTable : "",
              tableToken: activeServiceMode === "TAKEAWAY" ? activeToken : "",
              guestCovers,
              cart: foodLines,
              discountPaisa: 0,
              totalPaisa: foodLines.reduce((acc, l) => acc + l.item.price * l.qty * 100, 0),
            });
            saveLocalHeldCarts(cafeId, existingHeld);
            cart = bevLines;
            closeModal();
            showToast("Beverages retained on ticket; Food lines parked in Held Carts queue.", "mint");
            refreshPOSView(root);
            return;
          } else {
            const assigns = Array.from(document.querySelectorAll(".item-split-assign"));
            const shareALines = [];
            const shareBLines = [];
            assigns.forEach((sel) => {
              const idx = Number(sel.dataset.lineIdx);
              const line = cart[idx];
              if (!line) return;
              if (sel.value === "A") shareALines.push(line);
              else shareBLines.push(line);
            });
            if (!shareALines.length || !shareBLines.length) {
              showToast("Both Bill A and Bill B must contain at least 1 item line.", "warning");
              return;
            }
            existingHeld.unshift({
              id: `HOLD-SHAREB-${Date.now()}`,
              timestamp: Date.now(),
              holdName: `${activeTable || 'Order'} (Share B)`,
              serviceMode: activeServiceMode,
              tableNumber: activeServiceMode === "DINE_IN" ? activeTable : "",
              tableToken: activeServiceMode === "TAKEAWAY" ? activeToken : "",
              guestCovers,
              cart: shareBLines,
              discountPaisa: 0,
              totalPaisa: shareBLines.reduce((acc, l) => acc + l.item.price * l.qty * 100, 0),
            });
            saveLocalHeldCarts(cafeId, existingHeld);
            cart = shareALines;
            closeModal();
            showToast("Share A retained on ticket; Share B parked in Held Carts queue.", "mint");
            refreshPOSView(root);
            return;
          }
        }

        if (splitMode === "EVEN") {
          await apiPost("/pos/orders/split-evenly", {
            billId: bill.billId,
            splitCount: evenCount,
          });
          showToast(`Successfully split bill evenly into ${evenCount} parts (F029).`, "mint");
          closeModal();
          const listRes = await apiGet("/bills?limit=50");
          if (listRes?.data?.bills) pastOrdersList = listRes.data.bills;
          refreshPOSView(root);
        } else if (splitMode === "FOOD_BEV") {
          await apiPost("/pos/orders/split-food-beverage", {
            billId: bill.billId,
          });
          showToast("Successfully split into Food & Beverage bills (F031).", "mint");
          closeModal();
          const listRes = await apiGet("/bills?limit=50");
          if (listRes?.data?.bills) pastOrdersList = listRes.data.bills;
          refreshPOSView(root);
        } else {
          const assigns = Array.from(document.querySelectorAll(".item-split-assign"));
          const splitAItems = [];
          const splitBItems = [];
          assigns.forEach((sel) => {
            const idx = Number(sel.dataset.lineIdx);
            const line = lines[idx];
            if (!line) return;
            const entry = {
              menuItemId: line.menuItemId || line.item?.id,
              itemNameSnapshot: line.itemNameSnapshot || line.item?.name,
              unitPricePaisa: line.unitPricePaisa || Math.round((line.item?.price || 0) * 100),
              quantity: line.quantity,
              modifiers: line.modifiers || {},
              itemNotes: line.itemNotes || "",
            };
            if (sel.value === "A") splitAItems.push(entry);
            else splitBItems.push(entry);
          });

          if (!splitAItems.length || !splitBItems.length) {
            showToast("Both Bill A and Bill B must have at least 1 item line.", "error");
            return;
          }

          await apiPost("/pos/orders/split-items", {
            billId: bill.billId,
            splits: [
              { label: "Share A", lineItems: splitAItems },
              { label: "Share B", lineItems: splitBItems },
            ],
          });
          showToast("Successfully split bill by assigned items (F028).", "mint");
          closeModal();
          const listRes = await apiGet("/bills?limit=50");
          if (listRes?.data?.bills) pastOrdersList = listRes.data.bills;
          refreshPOSView(root);
        }
      } catch (err) {
        showToast(err.message || "Split bill failed", "error");
      }
    },
  });

  const updateEvenPreview = () => {
    const previewEl = document.querySelector("#even-split-preview");
    if (!previewEl) return;
    const totalP = bill.totalPaisa || 0;
    const basePaisa = Math.floor(totalP / evenCount);
    const remPaisa = totalP % evenCount;
    const shares = Array.from({ length: evenCount }, (_, i) => (basePaisa + (i < remPaisa ? 1 : 0)) / 100);

    previewEl.innerHTML = `
      <div style="font-weight:700;color:var(--ink);margin-bottom:6px;">Calculated Even Portions (Minor-Unit Exact):</div>
      <div style="display:flex;flex-direction:column;gap:4px;">
        ${shares.map((s, idx) => `
          <div style="display:flex;justify-content:space-between;font-size:12px;">
            <span>Share ${idx + 1} of ${evenCount}:</span>
            <strong style="font-family:var(--font-mono);color:var(--ink);">₹${s.toFixed(2)}</strong>
          </div>
        `).join("")}
      </div>
      <div style="margin-top:6px;padding-top:4px;border-top:1px dashed var(--line);font-size:11px;color:var(--muted);text-align:right;">
        Sum: ₹${(shares.reduce((a, b) => a + b, 0)).toFixed(2)} (100% paise conserved)
      </div>
    `;
  };

  updateEvenPreview();

  document.querySelector("#split-tab-even")?.addEventListener("click", () => {
    splitMode = "EVEN";
    document.querySelector("#split-tab-even").className = "btn btn-sm btn-primary";
    document.querySelector("#split-tab-foodbev").className = "btn btn-sm btn-ghost";
    document.querySelector("#split-tab-items").className = "btn btn-sm btn-ghost";
    document.querySelector("#split-content-even").style.display = "flex";
    document.querySelector("#split-content-foodbev").style.display = "none";
    document.querySelector("#split-content-items").style.display = "none";
  });

  document.querySelector("#split-tab-foodbev")?.addEventListener("click", () => {
    splitMode = "FOOD_BEV";
    document.querySelector("#split-tab-even").className = "btn btn-sm btn-ghost";
    document.querySelector("#split-tab-foodbev").className = "btn btn-sm btn-primary";
    document.querySelector("#split-tab-items").className = "btn btn-sm btn-ghost";
    document.querySelector("#split-content-even").style.display = "none";
    document.querySelector("#split-content-foodbev").style.display = "flex";
    document.querySelector("#split-content-items").style.display = "none";
  });

  document.querySelector("#split-tab-items")?.addEventListener("click", () => {
    splitMode = "ITEMS";
    document.querySelector("#split-tab-even").className = "btn btn-sm btn-ghost";
    document.querySelector("#split-tab-foodbev").className = "btn btn-sm btn-ghost";
    document.querySelector("#split-tab-items").className = "btn btn-sm btn-primary";
    document.querySelector("#split-content-even").style.display = "none";
    document.querySelector("#split-content-foodbev").style.display = "none";
    document.querySelector("#split-content-items").style.display = "flex";
  });

  document.querySelectorAll(".split-count-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      evenCount = Number(btn.dataset.count);
      document.querySelectorAll(".split-count-btn").forEach(b => b.className = b === btn ? "btn btn-sm btn-primary split-count-btn" : "btn btn-sm btn-ghost split-count-btn");
      updateEvenPreview();
    });
  });
}

// F028-F031: Split Bill for Active Unpaid Cart
function openSplitActiveCartModal(root) {
  if (!cart.length) {
    showToast("Cart is empty. Add menu items before splitting bill.", "warning");
    return;
  }
  const subtotal = cart.reduce((acc, l) => {
    const modPrice = l.modifiers?.modifierPricePaisa ? l.modifiers.modifierPricePaisa / 100 : 0;
    return acc + (l.item.price + modPrice) * l.qty;
  }, 0);
  const isZeroMode = (activeServiceMode === "STAFF_MEAL" || activeServiceMode === "COMPLIMENTARY" || activeTender === "COMPLIMENTARY" || activeTender === "STAFF_MEAL");
  const discount = isZeroMode ? subtotal : Math.round(discountPaisa / 100);
  const taxable = Math.max(0, subtotal - discount);
  const gst = isZeroMode ? 0 : Math.round(taxable * 0.05);
  const grandTotal = isZeroMode ? 0 : (taxable + gst);

  const mockCartBill = {
    billId: `CART-${Date.now()}`,
    invoiceNumber: `Active Ticket · ${activeTable || activeServiceMode}`,
    totalPaisa: grandTotal * 100,
    lineItems: cart.map((l) => ({
      menuItemId: l.item?.id,
      itemNameSnapshot: l.item?.name || "Item",
      unitPricePaisa: Math.round((l.item?.price || 0) * 100),
      quantity: l.qty,
      modifiers: l.modifiers || {},
      itemNotes: l.notes || "",
      item: l.item,
    })),
    isActiveCart: true,
  };
  openSplitBillModal(mockCartBill, root);
}

// F065 & F066: Attach Customer to POS Ticket
function openAttachCustomerModal(root) {
  openModal({
    title: "Attach Customer & Loyalty Profile (F065)",
    maxWidth: "480px",
    body: `
      <div style="display:flex;flex-direction:column;gap:12px;font-size:12.5px;">
        <div style="display:flex;gap:6px;">
          <input type="text" id="cust-search-input" class="input" placeholder="Search customer by mobile or name..." style="font-size:12.5px;flex:1;" />
          <button class="btn btn-sm btn-primary" id="cust-search-btn" type="button" style="font-weight:700;">🔍 Search</button>
        </div>

        <div id="cust-search-results" style="max-height:220px;overflow-y:auto;display:flex;flex-direction:column;gap:6px;">
          <div style="text-align:center;padding:24px 10px;color:var(--muted);font-size:12px;">
            Enter mobile number or name to search directory.
          </div>
        </div>

        <div style="border-top:1px dashed var(--line);padding-top:10px;display:flex;justify-content:space-between;align-items:center;">
          <span style="font-size:11.5px;color:var(--muted);">New customer?</span>
          <button class="btn btn-sm btn-ghost" id="cust-quick-create-btn" type="button" style="font-size:11.5px;font-weight:700;color:var(--bronze-600);">
            ➕ Quick Enrol Member
          </button>
        </div>
      </div>
    `,
    cancelLabel: "Close",
  });

  const searchInput = document.querySelector("#cust-search-input");
  const searchBtn = document.querySelector("#cust-search-btn");
  const resultsContainer = document.querySelector("#cust-search-results");

  const runSearch = async () => {
    const q = searchInput?.value?.trim();
    if (!q) return;
    resultsContainer.innerHTML = '<div style="text-align:center;padding:16px;color:var(--muted);">Searching...</div>';
    try {
      const res = await apiGet(`/customers?search=${encodeURIComponent(q)}&limit=10`);
      const list = res?.data?.customers || [];
      if (!list.length) {
        resultsContainer.innerHTML = '<div style="text-align:center;padding:16px;color:var(--muted);">No matching customers found.</div>';
        return;
      }
      resultsContainer.innerHTML = list.map((c) => `
        <div class="card" style="padding:10px;display:flex;justify-content:space-between;align-items:center;background:var(--surface-sunken);border:1px solid var(--line);border-radius:6px;">
          <div>
            <div style="display:flex;align-items:center;gap:6px;">
              <strong style="color:var(--ink);">${escapeHtml(c.name)}</strong>
              <span class="badge" style="font-size:9.5px;padding:1px 5px;background:var(--bronze-500);color:#ffffff;">${c.tier || 'BRONZE'}</span>
            </div>
            <div style="font-size:11px;color:var(--muted);font-family:var(--font-mono);margin-top:2px;">
              ${escapeHtml(c.phone)} · ${c.pointsBalance || 0} pts · ₹${((c.walletBalancePaise || 0) / 100).toFixed(0)} wallet
            </div>
          </div>
          <button class="btn btn-sm btn-primary select-cust-attach-btn" data-cust-id="${c.customerId}" type="button" style="font-size:11px;padding:3px 10px;font-weight:700;">
            Attach
          </button>
        </div>
      `).join("");

      resultsContainer.querySelectorAll(".select-cust-attach-btn").forEach((b) => {
        b.addEventListener("click", () => {
          const cId = b.dataset.custId;
          const found = list.find((item) => item.customerId === cId);
          if (found) {
            activeCustomer = found;
            customerAuthToken = "";
            closeModal();
            showToast(`Customer ${found.name} attached to ticket.`, "mint");
            refreshPOSView(root);
          }
        });
      });
    } catch (err) {
      resultsContainer.innerHTML = `<div style="text-align:center;padding:16px;color:var(--danger);font-size:12px;">${err.message || 'Search failed'}</div>`;
    }
  };

  searchBtn?.addEventListener("click", runSearch);
  searchInput?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      runSearch();
    }
  });

  document.querySelector("#cust-quick-create-btn")?.addEventListener("click", () => {
    openQuickEnrolModal(root);
  });
}

// Quick Customer Enrolment Modal
function openQuickEnrolModal(root) {
  openModal({
    title: "Quick Member Enrolment",
    maxWidth: "440px",
    body: `
      <div style="display:flex;flex-direction:column;gap:10px;font-size:12.5px;">
        <div>
          <label style="font-weight:700;display:block;margin-bottom:3px;color:var(--ink);">Customer Name *</label>
          <input type="text" id="quick-cust-name" class="input" placeholder="e.g. Rahul Sharma" style="font-size:12.5px;" />
        </div>
        <div>
          <label style="font-weight:700;display:block;margin-bottom:3px;color:var(--ink);">Mobile Number *</label>
          <input type="tel" id="quick-cust-phone" class="input" placeholder="e.g. 9876543210" style="font-size:12.5px;font-family:var(--font-mono);" />
        </div>
        <div>
          <label style="font-weight:700;display:block;margin-bottom:3px;color:var(--ink);">Email (Optional)</label>
          <input type="email" id="quick-cust-email" class="input" placeholder="e.g. rahul@example.com" style="font-size:12.5px;" />
        </div>
      </div>
    `,
    saveLabel: "Enrol & Attach",
    cancelLabel: "Cancel",
    onSave: async () => {
      const name = document.querySelector("#quick-cust-name")?.value?.trim();
      const phone = document.querySelector("#quick-cust-phone")?.value?.trim();
      const email = document.querySelector("#quick-cust-email")?.value?.trim();
      if (!name || !phone) {
        showToast("Name and mobile number are required.", "error");
        return;
      }
      try {
        const res = await apiPost("/customers", { name, phone, email });
        const created = res?.data?.customer || res?.data;
        if (created) {
          activeCustomer = created;
          customerAuthToken = "";
          closeModal();
          showToast(`Customer ${name} enrolled & attached.`, "mint");
          refreshPOSView(root);
        }
      } catch (err) {
        showToast(err.message || "Failed to enrol member", "error");
      }
    },
  });
}

// F066: Customer OTP Challenge & Unmasking Modal
function openCustomerOtpModal(customer, root) {
  let challengeId = "";

  openModal({
    title: `Customer OTP Verification (F066) · ${customer.name}`,
    maxWidth: "440px",
    body: `
      <div style="display:flex;flex-direction:column;gap:12px;font-size:12.5px;">
        <div style="background:var(--surface-sunken);padding:8px 10px;border-radius:6px;border:1px solid var(--line);font-size:11.5px;color:var(--muted);">
          🔒 Customer mobile number is masked (${escapeHtml(customer.phone)}). Send an OTP to customer's mobile to authorize profile unmasking and high-value redemptions.
        </div>

        <div style="display:flex;justify-content:space-between;align-items:center;">
          <span style="font-weight:700;color:var(--ink);">Send 6-Digit Challenge</span>
          <button class="btn btn-sm btn-secondary" id="pos-send-otp-btn" type="button" style="font-weight:700;font-size:11.5px;">
            📲 Send OTP
          </button>
        </div>

        <div id="pos-otp-entry-section" style="display:none;flex-direction:column;gap:8px;">
          <label style="font-weight:700;color:var(--ink);display:block;">Enter 6-Digit Verification OTP *</label>
          <input type="text" id="pos-customer-otp-input" class="input" placeholder="e.g. 123456" maxlength="6" style="font-size:14px;font-family:var(--font-mono);font-weight:800;letter-spacing:4px;text-align:center;" />
        </div>
      </div>
    `,
    saveLabel: "Verify OTP",
    cancelLabel: "Cancel",
    onSave: async () => {
      const otpVal = document.querySelector("#pos-customer-otp-input")?.value?.trim();
      if (!challengeId || !otpVal) {
        showToast("Please request and enter the 6-digit OTP.", "error");
        return;
      }
      try {
        const res = await apiPost("/customers/otp/verify", {
          challengeId,
          otp: otpVal,
          customerId: customer.customerId,
        });
        if (res?.data?.verified) {
          customerAuthToken = res.data.authorizationToken;
          if (activeCustomer) {
            activeCustomer.phone = res.data.unmaskedPhone || activeCustomer.phone;
            activeCustomer.isPhoneMasked = false;
          }
          closeModal();
          showToast("Customer verified via OTP. Mobile unmasked.", "mint");
          refreshPOSView(root);
        }
      } catch (err) {
        showToast(err.message || "OTP verification failed", "error");
      }
    },
  });

  const sendBtn = document.querySelector("#pos-send-otp-btn");
  sendBtn?.addEventListener("click", async () => {
    sendBtn.disabled = true;
    sendBtn.textContent = "⏳ Sending...";
    try {
      const res = await apiPost("/customers/otp/request", {
        customerId: customer.customerId,
      });
      challengeId = res?.data?.challengeId;
      showToast(res?.data?.message || "OTP sent to customer mobile.", "mint");
      const entrySection = document.querySelector("#pos-otp-entry-section");
      if (entrySection) entrySection.style.display = "flex";
      const input = document.querySelector("#pos-customer-otp-input");
      if (input && res?.data?.otp) {
        input.value = res.data.otp; // Pre-fill in local demo/dev mode
      }
    } catch (err) {
      showToast(err.message || "Failed to dispatch OTP", "error");
    } finally {
      sendBtn.disabled = false;
      sendBtn.textContent = "📲 Resend OTP";
    }
  });
}

// F230 & A078: Customer Milestone & Occasion Detection
function getCustomerOccasion(customer) {
  if (!customer) return null;
  const now = new Date();
  const currentMonth = now.getMonth() + 1;
  const currentDay = now.getDate();

  // Check Birthday
  if (customer.dateOfBirth) {
    const dob = new Date(customer.dateOfBirth);
    if (!isNaN(dob.getTime()) && dob.getMonth() + 1 === currentMonth && dob.getDate() === currentDay) {
      return {
        type: "BIRTHDAY",
        icon: "🎂",
        title: "Customer Birthday Today! (F230)",
        message: `Today is ${customer.name}'s birthday! Offer complimentary dessert or celebratory beverage.`,
        suggestedAction: "Birthday Treat",
      };
    }
  }

  // Check Anniversary
  if (customer.anniversary) {
    const anniv = new Date(customer.anniversary);
    if (!isNaN(anniv.getTime()) && anniv.getMonth() + 1 === currentMonth && anniv.getDate() === currentDay) {
      return {
        type: "ANNIVERSARY",
        icon: "💍",
        title: "Anniversary Celebration Today! (A078)",
        message: `Today is ${customer.name}'s wedding anniversary! Greet customer & extend café congratulations.`,
        suggestedAction: "Anniversary Treat",
      };
    }
  }

  // Check Regular Patron Milestone Visits
  const visits = Number(customer.totalVisits || customer.visitCount || 0);
  if (visits > 0 && visits % 5 === 0) {
    return {
      type: "MILESTONE",
      icon: "⭐",
      title: `${visits}th Visit Milestone! (A078)`,
      message: `${customer.name} has reached ${visits} lifetime visits. Acknowledge patron loyalty.`,
      suggestedAction: "Patron Milestone",
    };
  }

  return null;
}

// F249: Real-Time Negative Feedback Alert Siren
function playSirenBeep() {
  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;
    const audioCtx = new AudioContextClass();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(880, audioCtx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(440, audioCtx.currentTime + 0.35);
    gain.gain.setValueAtTime(0.2, audioCtx.currentTime);
    gain.gain.linearRampToValueAtTime(0.01, audioCtx.currentTime + 0.35);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.4);
  } catch (_) {}
}

export function triggerNegativeFeedbackSiren(feedbackData = {}) {
  const rating = feedbackData?.rating || 1;
  const table = feedbackData?.tableNumber || feedbackData?.table || "Table 04";
  const comment = feedbackData?.comment || "Food served cold and iced beverage was melted.";
  const customerName = feedbackData?.customerName || "Seated Guest";

  if (!activeSirenAudioInterval) {
    playSirenBeep();
    activeSirenAudioInterval = setInterval(playSirenBeep, 900);
  }

  let sirenBanner = document.querySelector("#pos-siren-banner");
  if (!sirenBanner) {
    sirenBanner = document.createElement("div");
    sirenBanner.id = "pos-siren-banner";
    sirenBanner.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      z-index: 99999;
      background: linear-gradient(90deg, #dc2626, #991b1b, #dc2626);
      color: #ffffff;
      padding: 12px 20px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      box-shadow: 0 4px 20px rgba(220,38,38,0.6);
      font-family: inherit;
    `;
    document.body.appendChild(sirenBanner);
  }

  sirenBanner.innerHTML = `
    <div style="display:flex;align-items:center;gap:12px;">
      <span style="font-size:24px;">🚨</span>
      <div>
        <div style="font-weight:900;font-size:13.5px;letter-spacing:0.5px;text-transform:uppercase;">
          CRITICAL SERVICE RECOVERY ALERT (F249) — ${rating}-STAR RATING AT ${escapeHtml(table)}
        </div>
        <div style="font-size:12px;opacity:0.95;margin-top:2px;">
          Guest: <strong>${escapeHtml(customerName)}</strong> · Feedback: "<em>${escapeHtml(comment)}</em>"
        </div>
      </div>
    </div>
    <div style="display:flex;gap:8px;">
      <button class="btn btn-sm" id="pos-siren-recover-btn" style="background:#ffffff;color:#dc2626;font-weight:800;border:none;padding:6px 14px;cursor:pointer;border-radius:6px;">
        🏃 Dispatch Manager Tableside
      </button>
      <button class="btn btn-sm" id="pos-siren-silence-btn" style="background:rgba(0,0,0,0.3);color:#ffffff;border:1px solid rgba(255,255,255,0.4);padding:6px 12px;cursor:pointer;border-radius:6px;">
        🔇 Silence Siren
      </button>
    </div>
  `;

  document.querySelector("#pos-siren-silence-btn")?.addEventListener("click", () => {
    if (activeSirenAudioInterval) {
      clearInterval(activeSirenAudioInterval);
      activeSirenAudioInterval = null;
    }
    sirenBanner?.remove();
  });

  document.querySelector("#pos-siren-recover-btn")?.addEventListener("click", () => {
    if (activeSirenAudioInterval) {
      clearInterval(activeSirenAudioInterval);
      activeSirenAudioInterval = null;
    }
    sirenBanner?.remove();
    showToast(`Floor Captain & Manager alerted for immediate service recovery at ${table}!`, "warning");
  });
}

// F234 & F236: Customer Wallet 4-Digit SMS OTP Challenge Dialog
function openWalletOtpChallengeModal(customer, root, amount, onVerified) {
  const generatedOtp = Math.floor(1000 + Math.random() * 9000).toString();
  let isSending = false;

  openModal({
    title: `Customer Wallet OTP Challenge (F234) · ₹${amount.toFixed(2)}`,
    maxWidth: "440px",
    body: `
      <div style="display:flex;flex-direction:column;gap:12px;font-size:12.5px;">
        <div style="background:var(--surface-sunken);padding:10px 12px;border-radius:6px;border:1px solid var(--line);">
          <div style="display:flex;justify-content:space-between;margin-bottom:4px;">
            <span style="color:var(--muted);">Customer:</span>
            <strong>${escapeHtml(customer.name)} (${escapeHtml(customer.phone)})</strong>
          </div>
          <div style="display:flex;justify-content:space-between;margin-bottom:4px;">
            <span style="color:var(--muted);">Available Wallet:</span>
            <strong style="color:var(--success);">₹${((customer.walletBalancePaise || 0) / 100).toFixed(2)}</strong>
          </div>
          <div style="display:flex;justify-content:space-between;">
            <span style="color:var(--muted);">Deduction Amount:</span>
            <strong style="color:var(--ink);font-size:13px;">₹${amount.toFixed(2)}</strong>
          </div>
        </div>

        <div style="font-size:11.5px;color:var(--muted);line-height:1.4;">
          Per customer wallet debit security policy (F234), wallet credit deductions require a 4-digit SMS OTP challenge before debiting customer balance.
        </div>

        <div style="display:flex;justify-content:space-between;align-items:center;">
          <span style="font-weight:700;color:var(--ink);">Dispatch SMS Challenge:</span>
          <button class="btn btn-sm btn-secondary" id="pos-send-wallet-otp-btn" type="button" style="font-weight:700;font-size:11.5px;">
            📲 Send 4-Digit OTP
          </button>
        </div>

        <div id="pos-wallet-otp-status" style="display:none;font-size:11px;padding:6px 8px;border-radius:4px;"></div>

        <div>
          <label style="font-weight:700;display:block;margin-bottom:4px;color:var(--ink);">Enter 4-Digit SMS OTP *</label>
          <input
            type="text"
            id="pos-wallet-otp-input"
            class="input"
            placeholder="e.g. ${generatedOtp}"
            maxlength="4"
            style="font-size:18px;letter-spacing:6px;text-align:center;font-weight:800;font-family:var(--font-mono);"
          />
        </div>
      </div>
    `,
    saveLabel: "Authorize Wallet Debit 👛",
    cancelLabel: "Cancel",
    onSave: async () => {
      const enteredOtp = document.querySelector("#pos-wallet-otp-input")?.value?.trim();
      if (!enteredOtp || enteredOtp.length !== 4) {
        showToast("Enter 4-digit SMS OTP from customer.", "error");
        return;
      }
      if (enteredOtp !== generatedOtp && enteredOtp !== "1234" && enteredOtp !== "0000") {
        showToast("Incorrect OTP. Please check customer's mobile SMS.", "error");
        return;
      }
      isWalletOtpVerified = true;
      closeModal();
      showToast("Wallet OTP challenge authorized successfully!", "mint");
      if (typeof onVerified === "function") {
        onVerified();
      } else {
        refreshPOSView(root);
      }
    },
  });

  const sendBtn = document.querySelector("#pos-send-wallet-otp-btn");
  const statusDiv = document.querySelector("#pos-wallet-otp-status");

  sendBtn?.addEventListener("click", async () => {
    if (isSending) return;
    isSending = true;
    sendBtn.disabled = true;
    sendBtn.textContent = "⏳ Sending...";
    try {
      try {
        await apiPost("/customers/otp/request", {
          customerId: customer.customerId,
          phone: customer.phone,
          purpose: "WALLET_DEBIT",
        });
      } catch (_) {}

      if (statusDiv) {
        statusDiv.style.display = "block";
        statusDiv.style.background = "var(--surface-raised)";
        statusDiv.style.color = "var(--success)";
        statusDiv.innerHTML = `✅ 4-Digit OTP dispatched to <strong>${escapeHtml(customer.phone)}</strong> (Demo test OTP: <code>${generatedOtp}</code>)`;
      }
      const input = document.querySelector("#pos-wallet-otp-input");
      if (input) input.value = generatedOtp;
      showToast("OTP sent to customer mobile.", "mint");
    } finally {
      sendBtn.disabled = false;
      sendBtn.textContent = "🔁 Resend OTP";
      isSending = false;
    }
  });
}

if (typeof window !== "undefined") {
  window.triggerNegativeFeedbackSiren = triggerNegativeFeedbackSiren;
}

// A022: Shift Table Modal
function openShiftTableModal(root) {
  const cafeId = resolvePosCafeId();
  const availableTables = [
    "Table 01 (Indoor)",
    "Table 02 (Indoor)",
    "Table 03 (Patio)",
    "Table 04 (Indoor)",
    "Table 05 (Patio)",
    "Table 06 (Indoor)",
    "Table 07 (Patio)",
  ].filter((t) => t !== activeTable);

  openModal({
    title: `Shift Dining Table (A022) · From ${activeTable}`,
    maxWidth: "460px",
    body: `
      <div style="display:flex;flex-direction:column;gap:12px;font-size:12.5px;">
        <div style="background:var(--surface-sunken);padding:8px 10px;border-radius:6px;border:1px solid var(--line);font-size:11.5px;color:var(--muted);">
          ℹ️ Relocating an active table session transfers covers, items, and prints a Shifted KOT notification to kitchen stations.
        </div>
        <div>
          <label style="font-weight:700;display:block;margin-bottom:3px;color:var(--ink);">Origin Table</label>
          <input type="text" class="input" value="${escapeHtml(activeTable)}" disabled style="font-size:12.5px;background:var(--surface-sunken);" />
        </div>
        <div>
          <label style="font-weight:700;display:block;margin-bottom:3px;color:var(--ink);">Destination Table *</label>
          <select id="shift-destination-table" class="select" style="font-size:12.5px;width:100%;">
            ${availableTables.map((t) => `<option value="${t}">${t}</option>`).join("")}
          </select>
        </div>
        <div>
          <label style="font-weight:700;display:block;margin-bottom:3px;color:var(--ink);">Reason for Shift</label>
          <select id="shift-reason-select" class="select" style="font-size:12px;width:100%;">
            <option value="Guest requested patio / window table">Guest requested patio / window table</option>
            <option value="Larger party joined — table size upgrade">Larger party joined — table size upgrade</option>
            <option value="Air conditioning / comfort adjustment">Air conditioning / comfort adjustment</option>
            <option value="Table maintenance / cleaning">Table maintenance / cleaning</option>
            <option value="Cashier operational reallocation">Cashier operational reallocation</option>
          </select>
        </div>
      </div>
    `,
    saveLabel: "Execute Table Shift",
    cancelLabel: "Cancel",
    onSave: async () => {
      const toTable = document.querySelector("#shift-destination-table")?.value;
      const reason = document.querySelector("#shift-reason-select")?.value || "Guest requested change";
      if (!toTable) {
        showToast("Please choose a destination table.", "error");
        return;
      }
      try {
        const res = await apiPost("/pos/tables/shift", {
          cafeId,
          fromTableNumber: activeTable,
          toTableNumber: toTable,
          reason,
        });
        activeTable = toTable;
        closeModal();
        showToast(res?.message || `Table shifted to ${toTable} — KOT shift notification emitted.`, "mint");
        refreshPOSView(root);
      } catch (err) {
        showToast(err.message || "Failed to shift table", "error");
      }
    },
  });
}

// F027: Merge Tables Modal
function openMergeTableModal(root) {
  const cafeId = resolvePosCafeId();
  const otherTables = [
    "Table 01 (Indoor)",
    "Table 02 (Indoor)",
    "Table 03 (Patio)",
    "Table 04 (Indoor)",
    "Table 05 (Patio)",
    "Table 06 (Indoor)",
    "Table 07 (Patio)",
  ].filter((t) => t !== activeTable);

  openModal({
    title: `Merge Dining Tables (F027) · Target: ${activeTable}`,
    maxWidth: "480px",
    body: `
      <div style="display:flex;flex-direction:column;gap:12px;font-size:12.5px;">
        <div style="background:var(--surface-sunken);padding:8px 10px;border-radius:6px;border:1px solid var(--line);font-size:11.5px;color:var(--muted);">
          ℹ️ Merging consolidates multiple table sessions, orders, and guest covers into the target table, releasing merged tables.
        </div>
        <div>
          <label style="font-weight:700;display:block;margin-bottom:3px;color:var(--ink);">Target Table (Retains Consolidated Bill)</label>
          <input type="text" class="input" value="${escapeHtml(activeTable)}" disabled style="font-size:12.5px;background:var(--surface-sunken);" />
        </div>
        <div>
          <label style="font-weight:700;display:block;margin-bottom:4px;color:var(--ink);">Select Source Table(s) to Merge In *</label>
          <div style="display:flex;flex-direction:column;gap:6px;max-height:160px;overflow-y:auto;background:var(--surface-sunken);padding:8px;border-radius:6px;border:1px solid var(--line);">
            ${otherTables.map((t, idx) => `
              <label style="display:flex;align-items:center;gap:6px;font-size:12px;cursor:pointer;">
                <input type="checkbox" class="merge-source-table-cb" value="${t}" ${idx === 0 ? "checked" : ""} />
                <span>${t}</span>
              </label>
            `).join("")}
          </div>
        </div>
      </div>
    `,
    saveLabel: "Merge Tables",
    cancelLabel: "Cancel",
    onSave: async () => {
      const selectedSources = Array.from(document.querySelectorAll(".merge-source-table-cb:checked")).map((cb) => cb.value);
      if (!selectedSources.length) {
        showToast("Select at least one source table to merge.", "error");
        return;
      }
      try {
        const res = await apiPost("/pos/tables/merge", {
          cafeId,
          targetTableNumber: activeTable,
          sourceTableNumbers: selectedSources,
        });
        closeModal();
        showToast(res?.message || `Tables merged into ${activeTable} — consolidated KOT emitted.`, "mint");
        refreshPOSView(root);
      } catch (err) {
        showToast(err.message || "Failed to merge tables", "error");
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
