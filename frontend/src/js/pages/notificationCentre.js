// =============================================================================
// PAGE: Notification Centre — API-wired
// GET    /api/v1/notifications           — list (with ?status=UNREAD filter)
// PATCH  /api/v1/notifications/read-all — mark all read
// PATCH  /api/v1/notifications/:id/read — mark one read
// =============================================================================
import { apiGet, apiPatch } from "../apiClient.js";
import { navigate } from "../router.js";
import { showToast, updateBellBadge } from "../components.js";

let activeTab = "all";
let _notifications = [];

function timeAgo(ts) {
  const diff = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export function renderNotificationCentre() {
  return `
    <div class="page-enter">
      <div class="flex justify-between items-center" style="margin-bottom:18px;">
        <div>
          <div style="color:var(--ink); font-size:22px; font-weight:700;" class="font-display">Notification Centre</div>
          <div style="color:var(--muted);" style="font-size:13.5px;" id="notif-unread-count">Loading…</div>
        </div>
        <button class="btn btn-ghost" id="mark-all-read-btn">Mark all as read</button>
      </div>

      <div class="flex gap-sm" style="margin-bottom:16px;" id="notif-tabs">
        ${["all", "unread", "action"].map(
          (t) => `<button class="btn btn-ghost ${activeTab === t ? "selected" : ""}" data-tab="${t}" style="padding:9px 16px; font-size:12.5px;">${{ all: "All", unread: "Unread", action: "Action Required" }[t]}</button>`
        ).join("")}
      </div>

      <div class="flex-col gap-md" id="notif-list">
        <div class="glass" style="padding:32px; text-align:center;">
          <div style="color:var(--muted);">Loading notifications…</div>
        </div>
      </div>
    </div>
  `;
}

export async function wireNotificationCentre(root) {
  await loadNotifications(root);

  root.querySelectorAll("[data-tab]").forEach((btn) => {
    btn.addEventListener("click", () => {
      activeTab = btn.dataset.tab;
      root.querySelectorAll("[data-tab]").forEach((b) => b.classList.remove("selected"));
      btn.classList.add("selected");
      renderList(root);
    });
  });

  root.querySelector("#mark-all-read-btn")?.addEventListener("click", async () => {
    try {
      await apiPatch("/notifications/read-all");
      _notifications.forEach((n) => { n.status = "READ"; n.readAt = new Date().toISOString(); });
      renderList(root);
      if (typeof updateBellBadge === "function") updateBellBadge(0);
      showToast("All notifications marked as read", "mint");
    } catch {
      showToast("Could not mark all as read", "amber");
    }
  });
}

async function loadNotifications(root) {
  try {
    const data = await apiGet("/notifications");
    _notifications = data?.data?.notifications || data?.notifications || (Array.isArray(data?.data) ? data.data : []) || [];
    renderList(root);
  } catch {
    root.querySelector("#notif-list").innerHTML = `
      <div class="glass empty-state">
        <div class="empty-state-title">Could not load</div>
        <div style="color:var(--muted);">Notifications unavailable right now.</div>
      </div>`;
  }
}

function renderList(root) {
  let list = [..._notifications];
  if (activeTab === "unread") list = list.filter((n) => n.status !== "READ");
  if (activeTab === "action") list = list.filter((n) => n.actionRequired || n.severity === "critical" || n.severity === "high");
  list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  const unreadCount = _notifications.filter((n) => n.status !== "READ").length;
  const countEl = root.querySelector("#notif-unread-count");
  if (countEl) countEl.textContent = `${unreadCount} unread`;

  const listEl = root.querySelector("#notif-list");
  if (!listEl) return;

  if (list.length === 0) {
    listEl.innerHTML = `<div class="glass empty-state"><div class="empty-state-title">Nothing here</div><div>You're all caught up.</div></div>`;
    return;
  }

  listEl.innerHTML = list.map((n) => {
    const isRead = n.status === "READ";
    const pill = n.severity === "high" || n.severity === "critical" ? "pill-coral"
      : n.severity === "warning" ? "pill-amber" : "pill-mint";
    return `
      <div class="glass" style="padding:16px; display:flex; justify-content:space-between; align-items:flex-start; ${isRead ? "opacity:0.6;" : ""}" data-notif-id="${n._id || n.id}">
        <div style="flex:1;">
          <div class="flex items-center gap-sm" style="margin-bottom:6px;">
            <div class="pill ${pill}" style="padding:3px 9px; font-size:10.5px;">${n.category || n.type || "Info"}</div>
            ${!isRead ? `<div style="width:7px;height:7px;border-radius:50%;background:var(--color-accent-mint-bright);"></div>` : ""}
          </div>
          <div style="color:var(--ink); font-weight:600; font-size:13.5px;">${n.title || n.subject || "Notification"}</div>
          <div style="color:var(--muted);" style="font-size:12px; margin-top:2px;">${n.message || n.body || ""}</div>
          <div style="color:var(--muted);" style="font-size:10.5px; margin-top:6px;">${timeAgo(n.createdAt)}</div>
        </div>
        <button class="btn btn-ghost" style="padding:7px 12px; font-size:11.5px;" data-notif-open="${n._id || n.id}" data-deeplink="${n.deepLink || n.link || "dashboard"}">Open</button>
      </div>
    `;
  }).join("");

  // Wire individual open/read buttons
  listEl.querySelectorAll("[data-notif-open]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.dataset.notifOpen;
      const notif = _notifications.find((n) => (n._id || n.id) === id);
      if (notif && notif.status !== "READ") {
        try {
          await apiPatch(`/notifications/${id}/read`);
          notif.status = "READ";
          notif.readAt = new Date().toISOString();
          renderList(root);
        } catch { /* silent */ }
      }
      navigate(btn.dataset.deeplink || "dashboard");
    });
  });
}
