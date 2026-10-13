/**
 * EMERGENCY WEB-BASED ORDER ACCEPTANCE TERMINAL (A007, F086, F089)
 *
 * Lightweight standalone mobile/tablet browser view for floor staff to accept,
 * snooze, or reject incoming aggregator orders during main hardware or terminal failures.
 * Backed by canonical GET /api/v1/channels/emergency-orders and
 * POST /api/v1/channels/emergency-orders/:orderId/decision endpoints.
 */

import { apiGet, apiPost } from "../apiClient.js";

let emergencyTimer = null;
let activeOrders = [];

export function renderEmergencyTerminal(subroute) {
  return `
    <div id="emergency-terminal-container" style="min-height:100vh; background:#0B0F19; color:#F8FAFC; font-family:-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; padding:16px;">
      <header style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid #1E293B; padding-bottom:12px; margin-bottom:16px;">
        <div style="display:flex; align-items:center; gap:12px;">
          <span style="background:#EF4444; color:#FFF; font-size:11px; font-weight:800; padding:4px 8px; border-radius:6px; letter-spacing:0.5px;">EMERGENCY BACKUP</span>
          <h1 style="font-size:18px; font-weight:700; margin:0;">Zamorin Mobile Intake</h1>
        </div>
        <div style="display:flex; gap:8px;">
          <button id="btn-emergency-snooze" style="background:#4B5563; border:none; color:#FFF; font-size:12px; font-weight:600; padding:6px 12px; border-radius:6px; cursor:pointer;">
            30-Min Snooze
          </button>
          <button id="btn-emergency-refresh" style="background:#2563EB; border:none; color:#FFF; font-size:12px; font-weight:600; padding:6px 12px; border-radius:6px; cursor:pointer;">
            ↻ Refresh
          </button>
        </div>
      </header>

      <div id="emergency-status-bar" style="background:#1E293B; border-radius:8px; padding:10px 14px; margin-bottom:16px; font-size:13px; display:flex; justify-content:space-between; align-items:center;">
        <div style="display:flex; align-items:center; gap:8px;">
          <span style="display:inline-block; width:8px; height:8px; border-radius:50%; background:#10B981;"></span>
          <span>Aggregator Intake Stream: <strong style="color:#10B981;">CONNECTED (A007)</strong></span>
        </div>
        <span id="emergency-clock" style="font-family:monospace; color:#94A3B8;">--:--:--</span>
      </div>

      <div id="emergency-orders-list" style="display:flex; flex-direction:column; gap:12px;">
        <div style="text-align:center; padding:40px; color:#64748B;">Checking for incoming aggregator orders...</div>
      </div>
    </div>
  `;
}

export function wireEmergencyTerminal(container, subroute) {
  const root = container || document.getElementById("page-content") || document.body;

  if (emergencyTimer) {
    clearInterval(emergencyTimer);
    emergencyTimer = null;
  }

  const clockEl = root.querySelector("#emergency-clock");
  if (clockEl) {
    clockEl.textContent = new Date().toLocaleTimeString();
    emergencyTimer = setInterval(() => {
      clockEl.textContent = new Date().toLocaleTimeString();
    }, 1000);
  }

  const refreshBtn = root.querySelector("#btn-emergency-refresh");
  if (refreshBtn) {
    refreshBtn.addEventListener("click", () => fetchEmergencyOrders(root));
  }

  const snoozeBtn = root.querySelector("#btn-emergency-snooze");
  if (snoozeBtn) {
    snoozeBtn.addEventListener("click", async () => {
      try {
        await apiPost("/channels/pause", { durationMinutes: 30, reason: "Emergency mobile terminal snooze" });
        alert("Aggregators snoozed for 30 minutes.");
      } catch (err) {
        alert("Snooze request failed: " + (err.message || "Unknown error"));
      }
    });
  }

  fetchEmergencyOrders(root);
}

async function fetchEmergencyOrders(root) {
  const listEl = root.querySelector("#emergency-orders-list");
  if (!listEl) return;

  try {
    let res;
    try {
      res = await apiGet("/channels/emergency-orders");
    } catch (routeErr) {
      // Fallback for earlier environments
      res = await apiGet("/channels/live-orders?status=PENDING");
    }

    activeOrders = res?.orders || [];

    if (activeOrders.length === 0) {
      listEl.innerHTML = `
        <div style="text-align:center; padding:48px 16px; color:#94A3B8; background:#111827; border-radius:8px; border:1px dashed #334155;">
          <div style="font-size:24px; margin-bottom:8px;">✅</div>
          <div style="font-weight:600; color:#F1F5F9; margin-bottom:4px;">No Pending Aggregator Orders</div>
          <div style="font-size:12px; color:#64748B;">All incoming delivery and takeaway orders are accepted or kitchen-routed.</div>
        </div>
      `;
      return;
    }

    listEl.innerHTML = activeOrders.map(order => {
      const orderId = order.orderId || order._id || "ORD";
      const channel = String(order.channel || "ONLINE").toUpperCase();
      const customer = order.customerName || order.customer?.name || "Customer";
      const totalInr = ((order.totalPaisa || order.totalAmount || 0) / 100).toFixed(2);
      const items = order.items || [];
      const placedAgoMin = order.placedAt ? Math.round((Date.now() - new Date(order.placedAt).getTime()) / 60000) : 0;

      return `
        <div style="background:#111827; border:1px solid #1E293B; border-radius:10px; padding:16px; display:flex; flex-direction:column; gap:12px;">
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <div style="display:flex; align-items:center; gap:8px;">
              <span style="font-weight:800; color:#F59E0B; font-size:13px; background:#451A03; padding:2px 8px; border-radius:4px;">${channel}</span>
              <span style="color:#FFF; font-weight:700; font-family:monospace;">#${orderId}</span>
              ${order.isVip ? `<span style="background:#D97706; color:#FFF; font-size:10px; font-weight:800; padding:2px 6px; border-radius:4px;">VIP</span>` : ''}
              <span style="color:#94A3B8; font-size:12px;">(${placedAgoMin}m ago)</span>
            </div>
            <span style="font-weight:800; color:#10B981; font-size:16px; font-family:monospace;">₹${totalInr}</span>
          </div>

          <div style="font-size:12px; color:#94A3B8;">
            Guest: <strong style="color:#F1F5F9;">${customer}</strong>
            ${order.instructions ? `<div style="color:#FBBF24; margin-top:2px;">⚠️ Note: ${order.instructions}</div>` : ''}
          </div>

          <div style="font-size:13px; color:#CBD5E1; line-height:1.5; background:#1E293B; border-radius:6px; padding:10px;">
            ${items.map(i => `<div>• <strong>${i.quantity || 1}x</strong> ${i.name || i.title} ${i.notes ? `<em style="color:#94A3B8;">(${i.notes})</em>` : ''}</div>`).join('')}
          </div>

          <div style="display:flex; gap:8px; margin-top:4px;">
            <button class="btn-accept-order" data-id="${orderId}" data-time="15" style="flex:1; background:#059669; color:#FFF; border:none; padding:10px 6px; border-radius:6px; font-weight:700; cursor:pointer; font-size:12px;">
              ACCEPT 15m
            </button>
            <button class="btn-accept-order" data-id="${orderId}" data-time="25" style="flex:1; background:#10B981; color:#FFF; border:none; padding:10px 6px; border-radius:6px; font-weight:700; cursor:pointer; font-size:12px;">
              ACCEPT 25m
            </button>
            <button class="btn-reject-order" data-id="${orderId}" style="flex:1; background:#EF4444; color:#FFF; border:none; padding:10px 6px; border-radius:6px; font-weight:700; cursor:pointer; font-size:12px;">
              REJECT
            </button>
          </div>
        </div>
      `;
    }).join('');

    root.querySelectorAll(".btn-accept-order").forEach(btn => {
      btn.addEventListener("click", async (e) => {
        const id = e.currentTarget.getAttribute("data-id");
        const prepTime = Number(e.currentTarget.getAttribute("data-time") || 20);
        try {
          try {
            await apiPost(`/channels/emergency-orders/${encodeURIComponent(id)}/decision`, {
              decision: "ACCEPT",
              prepTimeMinutes: prepTime,
            });
          } catch (canErr) {
            await apiPost(`/channels/orders/${encodeURIComponent(id)}/accept`, { prepTimeMinutes: prepTime });
          }
          alert(`Order ${id} accepted (${prepTime} min)! Routed to kitchen.`);
          fetchEmergencyOrders(root);
        } catch (err) {
          alert(`Accept failed: ` + (err.message || "Error"));
        }
      });
    });

    root.querySelectorAll(".btn-reject-order").forEach(btn => {
      btn.addEventListener("click", async (e) => {
        const id = e.currentTarget.getAttribute("data-id");
        const reason = prompt("Enter cancellation/rejection reason:", "KITCHEN_OVERLOAD");
        if (!reason) return;
        try {
          try {
            await apiPost(`/channels/emergency-orders/${encodeURIComponent(id)}/decision`, {
              decision: "REJECT",
              reason,
            });
          } catch (canErr) {
            await apiPost(`/channels/orders/${encodeURIComponent(id)}/reject`, { reason });
          }
          alert(`Order ${id} rejected.`);
          fetchEmergencyOrders(root);
        } catch (err) {
          alert(`Reject failed: ` + (err.message || "Error"));
        }
      });
    });
  } catch (err) {
    listEl.innerHTML = `<div style="color:#EF4444; padding:24px; text-align:center;">Failed to load emergency orders: ${err.message || "Network Error"}</div>`;
  }
}
