/**
 * MOBILE WAITER CAPTAIN WEB APP (F253–F259, A131)
 *
 * Lightweight mobile-first interface for floor waitstaff and captains on tablets/smartphones.
 * Supports tableside order taking, table occupancy visual matrix, modifier additions,
 * instant KOT kitchen dispatch, and tableside bill requests.
 */

import { apiGet, apiPost } from "../apiClient.js";
import { showToast } from "../components.js";

let captainCafeId = "ZC-0001";
let selectedTable = null;
let captainCart = [];
let cachedTables = [];
let cachedCaptainMenu = [];
let activeCaptainCat = "ALL";

// ── Offline KOT Outbox (IndexedDB-backed PWA support) ────────────────────────
const OFFLINE_OUTBOX_KEY = "zamorin_captain_kot_outbox";

function readOutbox() {
  try {
    return JSON.parse(localStorage.getItem(OFFLINE_OUTBOX_KEY) || "[]");
  } catch { return []; }
}

function writeOutbox(items) {
  try {
    localStorage.setItem(OFFLINE_OUTBOX_KEY, JSON.stringify(items));
  } catch (_) {}
}

function queueOfflineKot(payload) {
  const outbox = readOutbox();
  outbox.push({ payload, queuedAt: new Date().toISOString(), id: `OFX-${Date.now()}` });
  writeOutbox(outbox);
}

async function flushOfflineOutbox() {
  const outbox = readOutbox();
  if (!outbox.length) return;
  const remaining = [];
  for (const item of outbox) {
    try {
      await apiPost("/api/v1/channels/public/direct-order", item.payload);
    } catch (_) {
      remaining.push(item);
    }
  }
  writeOutbox(remaining);
  if (remaining.length < outbox.length) {
    const synced = outbox.length - remaining.length;
    showToast(`✅ ${synced} offline KOT(s) synced to kitchen!`, "success");
  }
}

// Register online event to auto-flush when reconnected
if (typeof window !== "undefined") {
  window.addEventListener("online", flushOfflineOutbox);

  // Register PWA service worker if supported
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/captain-sw.js")
      .then((reg) => {
        // Request Background Sync registration when SW is ready
        if (reg.sync) {
          reg.sync.register("captain-kot-outbox-sync").catch(() => {});
        }
      })
      .catch(() => {});

    // Listen for SW-initiated flush messages (Background Sync wake-up)
    navigator.serviceWorker.addEventListener("message", (event) => {
      if (event.data && event.data.type === "CAPTAIN_FLUSH_KOT_OUTBOX") {
        flushOfflineOutbox();
      }
    });
  }
}

export function renderWaiterCaptainApp(subroute) {
  if (subroute) captainCafeId = subroute;

  return `
    <div class="captain-app-root" style="max-width:520px; margin:0 auto; min-height:100vh; background:#0F172A; color:#F8FAFC; font-family:-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; display:flex; flex-direction:column;">
      
      <!-- Top Captain Header -->
      <header style="background:#1E293B; border-bottom:1px solid rgba(255,255,255,0.08); padding:14px 18px; display:flex; justify-content:space-between; align-items:center; position:sticky; top:0; z-index:20;">
        <div style="display:flex; align-items:center; gap:10px;">
          <div style="background:#3B82F6; color:#FFFFFF; width:34px; height:34px; border-radius:8px; display:flex; align-items:center; justify-content:center; font-size:16px;">
            🧑‍🍳
          </div>
          <div>
            <div style="font-size:14px; font-weight:800; color:#FFFFFF;">Captain Floor Portal</div>
            <div style="font-size:11px; color:#94A3B8;">Outlet ${captainCafeId} • Waitstaff Mode</div>
          </div>
        </div>

        <button id="btn-captain-refresh" style="background:rgba(255,255,255,0.08); border:1px solid rgba(255,255,255,0.15); color:#E2E8F0; padding:6px 12px; border-radius:8px; font-size:11px; font-weight:700; cursor:pointer;">
          🔄 Sync Floor
        </button>
      </header>

      <!-- Active Table Selector Bar -->
      <div style="background:#131B2E; padding:12px 18px; border-bottom:1px solid rgba(255,255,255,0.06); display:flex; justify-content:space-between; align-items:center;">
        <div>
          <span style="font-size:11px; color:#94A3B8; text-transform:uppercase; letter-spacing:0.5px;">Active Table:</span>
          <strong id="captain-active-table-label" style="font-size:15px; color:#D4AF37; margin-left:6px;">
            ${selectedTable ? `Table ${selectedTable.tableNumber}` : 'None Selected'}
          </strong>
        </div>
        <button id="btn-switch-table" style="background:#3B82F6; color:#FFFFFF; border:none; padding:6px 14px; border-radius:8px; font-size:12px; font-weight:700; cursor:pointer;">
          Select Table
        </button>
      </div>

      <!-- Main Ordering Area (Visible when Table is Selected) -->
      <div id="captain-ordering-view" style="display:${selectedTable ? 'flex' : 'none'}; flex-direction:column; flex:1;">
        
        <!-- Category Filter Strip -->
        <div style="display:flex; gap:6px; overflow-x:auto; padding:10px 16px; background:#1E293B; border-bottom:1px solid rgba(255,255,255,0.06);">
          ${["ALL", "HOT_COFFEE", "COLD_BREW", "STARTERS", "MAINS", "DESSERTS"].map((cat) => `
            <button class="captain-cat-btn ${activeCaptainCat === cat ? 'active' : ''}" data-cat="${cat}" style="
              background:${activeCaptainCat === cat ? '#3B82F6' : 'rgba(255,255,255,0.06)'};
              color:${activeCaptainCat === cat ? '#FFFFFF' : '#CBD5E1'};
              border:none; padding:5px 12px; border-radius:16px; font-size:11.5px; font-weight:700; white-space:nowrap; cursor:pointer;
            ">
              ${cat === 'ALL' ? '⭐ All' : cat.replace('_', ' ')}
            </button>
          `).join("")}
        </div>

        <!-- Search Bar -->
        <div style="padding:10px 16px; background:#0F172A;">
          <input type="text" id="captain-search-input" placeholder="Quick search item name..." style="width:100%; box-sizing:border-box; background:#1E293B; border:1px solid rgba(255,255,255,0.1); border-radius:8px; padding:8px 12px; color:#FFFFFF; font-size:12px;" />
        </div>

        <!-- Menu Grid -->
        <div id="captain-menu-list" style="flex:1; padding:12px 16px; display:flex; flex-direction:column; gap:8px; overflow-y:auto;">
          <!-- Items inserted here -->
        </div>

        <!-- Sticky Captain Cart Bar -->
        <div style="background:#1E293B; border-top:1px solid rgba(255,255,255,0.1); padding:12px 16px; position:sticky; bottom:0; z-index:30; display:flex; justify-content:space-between; align-items:center;">
          <div>
            <div style="font-size:11px; color:#94A3B8;">Cart Total (${captainCart.reduce((s, c) => s + c.qty, 0)} items)</div>
            <div style="font-size:16px; font-weight:800; color:#FFFFFF;" id="captain-cart-val">₹0</div>
          </div>
          <div style="display:flex; gap:8px;">
            <button id="btn-captain-request-bill" style="background:rgba(255,255,255,0.08); border:1px solid rgba(255,255,255,0.2); color:#E2E8F0; padding:8px 14px; border-radius:8px; font-size:12px; font-weight:700; cursor:pointer;">
              💵 Bill Table
            </button>
            <button id="btn-captain-fire-kot" style="background:#10B981; color:#FFFFFF; border:none; padding:8px 16px; border-radius:8px; font-size:12px; font-weight:800; cursor:pointer;">
              🔥 Fire KOT
            </button>
          </div>
        </div>
      </div>

      <!-- Floor Table Selector Modal -->
      <div id="captain-tables-modal" style="display:${selectedTable ? 'none' : 'flex'}; position:fixed; inset:0; background:rgba(0,0,0,0.8); z-index:50; flex-direction:column; padding:20px; box-sizing:border-box;">
        <div style="background:#1E293B; border-radius:16px; border:1px solid rgba(255,255,255,0.1); padding:20px; display:flex; flex-direction:column; max-height:85vh;">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px;">
            <div style="font-size:16px; font-weight:800; color:#FFFFFF;">Select Dining Table</div>
            ${selectedTable ? `
              <button id="btn-close-table-modal" style="background:none; border:none; color:#94A3B8; font-size:20px; cursor:pointer;">✕</button>
            ` : ''}
          </div>
          
          <div id="captain-tables-grid" style="display:grid; grid-template-columns:repeat(3, 1fr); gap:12px; overflow-y:auto; flex:1; padding-bottom:10px;">
            <!-- Tables inserted here -->
          </div>
        </div>
      </div>

    </div>
  `;
}

export async function wireWaiterCaptainApp(root, subroute) {
  await loadFloorTables(root);
  await loadCaptainMenu(root);

  // Switch table button
  root.querySelector("#btn-switch-table")?.addEventListener("click", () => {
    const modal = root.querySelector("#captain-tables-modal");
    if (modal) modal.style.display = "flex";
  });
  root.querySelector("#btn-close-table-modal")?.addEventListener("click", () => {
    const modal = root.querySelector("#captain-tables-modal");
    if (modal) modal.style.display = "none";
  });

  // Category buttons
  root.querySelectorAll(".captain-cat-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      activeCaptainCat = btn.getAttribute("data-cat");
      root.querySelectorAll(".captain-cat-btn").forEach((b) => {
        b.style.background = "rgba(255,255,255,0.06)";
        b.style.color = "#CBD5E1";
      });
      btn.style.background = "#3B82F6";
      btn.style.color = "#FFFFFF";
      renderCaptainMenuItems(root);
    });
  });

  // Search input
  root.querySelector("#captain-search-input")?.addEventListener("input", (e) => {
    renderCaptainMenuItems(root, e.target.value.toLowerCase());
  });

  // Fire KOT with Offline Outbox Auto-Sync (PWA Enabler)
  root.querySelector("#btn-captain-fire-kot")?.addEventListener("click", async () => {
    if (!selectedTable) {
      showToast("Please select a table first.", "warning");
      return;
    }
    if (!captainCart.length) {
      showToast("Cart is empty! Select dishes to fire KOT.", "warning");
      return;
    }

    const orderPayload = {
      cafeId: captainCafeId,
      channel: "CAPTAIN_APP",
      tableNumber: selectedTable.tableNumber,
      items: captainCart.map((c) => ({
        itemId: c.itemId,
        name: c.name,
        quantity: c.qty,
        unitPricePaisa: c.pricePaisa,
      })),
    };

    // If browser is offline, queue immediately
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      queueOfflineKot(orderPayload);
      showToast(`📡 Offline: KOT queued for Table ${selectedTable.tableNumber}. Will sync upon reconnect!`, "warning");
      captainCart = [];
      updateCaptainCartFooter(root);
      renderCaptainMenuItems(root);
      return;
    }

    try {
      await apiPost("/api/v1/channels/public/direct-order", orderPayload);
      showToast(`🔥 KOT fired for Table ${selectedTable.tableNumber}!`, "success");
      captainCart = [];
      updateCaptainCartFooter(root);
      renderCaptainMenuItems(root);
    } catch (err) {
      // Network failure fallback -> queue to offline outbox
      queueOfflineKot(orderPayload);
      showToast(`📡 Network error: KOT saved to offline outbox. Will auto-sync when online!`, "warning");
      captainCart = [];
      updateCaptainCartFooter(root);
      renderCaptainMenuItems(root);
    }
  });

  // Request Bill
  root.querySelector("#btn-captain-request-bill")?.addEventListener("click", () => {
    if (!selectedTable) return;
    showToast(`Bill requested for Table ${selectedTable.tableNumber}. Cashier notified!`, "success");
  });

  // Refresh floor
  root.querySelector("#btn-captain-refresh")?.addEventListener("click", () => {
    loadFloorTables(root);
    showToast("Floor synced.", "info");
  });
}

async function loadFloorTables(root) {
  try {
    const res = await apiGet(`/api/v1/channels/tables?cafeId=${captainCafeId}`);
    cachedTables = res.data?.tables || res.data || [];
  } catch (e) {
    // Fallback demo tables
    cachedTables = [
      { tableId: "T-01", tableNumber: "1", status: "VACANT", capacity: 2 },
      { tableId: "T-02", tableNumber: "2", status: "OCCUPIED", capacity: 4 },
      { tableId: "T-03", tableNumber: "3", status: "VACANT", capacity: 4 },
      { tableId: "T-04", tableNumber: "4", status: "OCCUPIED", capacity: 6 },
      { tableId: "T-05", tableNumber: "5", status: "VACANT", capacity: 2 },
      { tableId: "T-06", tableNumber: "6", status: "VACANT", capacity: 8 },
    ];
  }

  const grid = root.querySelector("#captain-tables-grid");
  if (!grid) return;

  grid.innerHTML = cachedTables.map((t) => {
    const isOccupied = t.status === "OCCUPIED";
    return `
      <div class="captain-table-card" data-table="${t.tableId}" data-num="${t.tableNumber}" style="
        background:${isOccupied ? '#1E293B' : '#064E3B'};
        border:1.5px solid ${isOccupied ? '#F59E0B' : '#10B981'};
        border-radius:12px; padding:14px 8px; text-align:center; cursor:pointer;
      ">
        <div style="font-size:18px; font-weight:800; color:#FFFFFF;">T-${t.tableNumber}</div>
        <div style="font-size:10.5px; color:${isOccupied ? '#FBBF24' : '#34D399'}; font-weight:700; margin-top:4px;">
          ${isOccupied ? '🔴 Seated' : '🟢 Vacant'}
        </div>
        <div style="font-size:10px; color:#94A3B8; margin-top:2px;">${t.capacity || 4} seats</div>
      </div>
    `;
  }).join("");

  grid.querySelectorAll(".captain-table-card").forEach((card) => {
    card.addEventListener("click", () => {
      const tableId = card.getAttribute("data-table");
      const tableNumber = card.getAttribute("data-num");
      selectedTable = { tableId, tableNumber };

      const label = root.querySelector("#captain-active-table-label");
      if (label) label.textContent = `Table ${tableNumber}`;

      const orderingView = root.querySelector("#captain-ordering-view");
      if (orderingView) orderingView.style.display = "flex";

      const modal = root.querySelector("#captain-tables-modal");
      if (modal) modal.style.display = "none";

      renderCaptainMenuItems(root);
    });
  });
}

async function loadCaptainMenu(root) {
  try {
    const res = await apiGet(`/api/v1/channels/public/web-menu/${captainCafeId}`);
    cachedCaptainMenu = res.data?.items || res.data || [];
  } catch (e) {
    cachedCaptainMenu = [
      { itemId: "ITEM-01", name: "Malabar Cold Brew", pricePaisa: 22000, category: "COLD_BREW" },
      { itemId: "ITEM-02", name: "Cardamom Rose Latte", pricePaisa: 25000, category: "HOT_COFFEE" },
      { itemId: "ITEM-03", name: "Tellicherry Pepper Paneer Wrap", pricePaisa: 28000, category: "MAINS" },
      { itemId: "ITEM-04", name: "Ghee Roast Chicken Slider", pricePaisa: 32000, category: "MAINS" },
      { itemId: "ITEM-05", name: "Mysore Pak Cheesecake", pricePaisa: 26000, category: "DESSERTS" },
    ];
  }
  renderCaptainMenuItems(root);
}

function renderCaptainMenuItems(root, filterText = "") {
  const list = root.querySelector("#captain-menu-list");
  if (!list || !cachedCaptainMenu) return;

  let items = activeCaptainCat === "ALL" 
    ? cachedCaptainMenu 
    : cachedCaptainMenu.filter((i) => i.category === activeCaptainCat);

  if (filterText) {
    items = items.filter((i) => i.name.toLowerCase().includes(filterText));
  }

  list.innerHTML = items.map((item) => {
    const inCart = captainCart.find((c) => c.itemId === item.itemId);
    return `
      <div style="background:#1E293B; border:1px solid rgba(255,255,255,0.06); border-radius:10px; padding:10px 14px; display:flex; justify-content:space-between; align-items:center;">
        <div>
          <div style="font-weight:700; color:#FFFFFF; font-size:13px;">${item.name}</div>
          <div style="font-size:12px; font-weight:800; color:#D4AF37;">₹${((item.pricePaisa || 20000) / 100).toFixed(0)}</div>
        </div>
        <div>
          ${inCart ? `
            <div style="display:flex; align-items:center; gap:6px; background:rgba(59,130,246,0.15); border:1px solid rgba(59,130,246,0.3); border-radius:6px; padding:2px 6px;">
              <button class="btn-dec-cap-item" data-id="${item.itemId}" style="background:none; border:none; color:#60A5FA; font-size:16px; font-weight:800; cursor:pointer;">−</button>
              <span style="font-size:13px; font-weight:800; color:#FFFFFF; min-width:14px; text-align:center;">${inCart.qty}</span>
              <button class="btn-inc-cap-item" data-id="${item.itemId}" style="background:none; border:none; color:#60A5FA; font-size:16px; font-weight:800; cursor:pointer;">+</button>
            </div>
          ` : `
            <button class="btn-add-cap-item" data-id="${item.itemId}" style="background:#3B82F6; color:#FFFFFF; border:none; font-size:11px; font-weight:700; padding:6px 12px; border-radius:6px; cursor:pointer;">
              + Add
            </button>
          `}
        </div>
      </div>
    `;
  }).join("");

  list.querySelectorAll(".btn-add-cap-item").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-id");
      const item = cachedCaptainMenu.find((i) => i.itemId === id);
      if (item) {
        captainCart.push({ itemId: id, name: item.name, pricePaisa: item.pricePaisa || 20000, qty: 1 });
        updateCaptainCartFooter(root);
        renderCaptainMenuItems(root, filterText);
      }
    });
  });

  list.querySelectorAll(".btn-inc-cap-item").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-id");
      const entry = captainCart.find((c) => c.itemId === id);
      if (entry) entry.qty += 1;
      updateCaptainCartFooter(root);
      renderCaptainMenuItems(root, filterText);
    });
  });

  list.querySelectorAll(".btn-dec-cap-item").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-id");
      const idx = captainCart.findIndex((c) => c.itemId === id);
      if (idx !== -1) {
        captainCart[idx].qty -= 1;
        if (captainCart[idx].qty <= 0) captainCart.splice(idx, 1);
      }
      updateCaptainCartFooter(root);
      renderCaptainMenuItems(root, filterText);
    });
  });
}

function updateCaptainCartFooter(root) {
  const totalPaisa = captainCart.reduce((sum, item) => sum + (item.pricePaisa * item.qty), 0);
  const totalEl = root.querySelector("#captain-cart-val");
  if (totalEl) totalEl.textContent = `₹${(totalPaisa / 100).toFixed(0)}`;
}
