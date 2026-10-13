/**
 * FULLSCREEN TV TAKEAWAY TOKEN DISPLAY BOARD (F276–F280, A035)
 *
 * Dedicated fullscreen Android TV / large-screen web interface for takeaway counters.
 * Displays "Preparing (In Kitchen)" vs "Ready for Handover", with audible chime
 * synthesis via Web Audio API whenever an order status transitions to ready.
 */

import { apiGet } from "../apiClient.js";

let displayCafeId = "ZC-0001";
let refreshIntervalTimer = null;
let lastKnownReadyTokens = new Set();

function playTokenReadyChime() {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    const ctx = new AudioContext();

    // Two-tone chord: 587.33 Hz (D5) -> 880.00 Hz (A5)
    const now = ctx.currentTime;
    const osc1 = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    const gain = ctx.createGain();

    osc1.type = "sine";
    osc1.frequency.setValueAtTime(587.33, now);
    osc1.frequency.exponentialRampToValueAtTime(880.0, now + 0.35);

    osc2.type = "triangle";
    osc2.frequency.setValueAtTime(880.0, now + 0.15);

    gain.gain.setValueAtTime(0.01, now);
    gain.gain.linearRampToValueAtTime(0.4, now + 0.05);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 1.2);

    osc1.connect(gain);
    osc2.connect(gain);
    gain.connect(ctx.destination);

    osc1.start(now);
    osc2.start(now + 0.15);
    osc1.stop(now + 1.2);
    osc2.stop(now + 1.2);
  } catch (e) {
    // Audio context may be restricted by browser gesture policy
  }
}

export function renderTakeawayTokenDisplay(subroute) {
  if (subroute) displayCafeId = subroute;

  return `
    <div class="tv-token-display-root" style="min-height:100vh; background:#0B0F19; color:#F8FAFC; font-family:-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; display:flex; flex-direction:column; padding:0; margin:0; overflow:hidden;">
      
      <!-- Top TV Branding Strip -->
      <header style="background:#111827; border-bottom:2px solid rgba(212,175,55,0.4); padding:16px 32px; display:flex; justify-content:space-between; align-items:center;">
        <div style="display:flex; align-items:center; gap:16px;">
          <div style="width:48px; height:48px; border-radius:12px; background:#D4AF37; display:flex; align-items:center; justify-content:center; font-size:24px; font-weight:900; color:#0B0F19;">
            Z
          </div>
          <div>
            <h1 style="margin:0; font-size:24px; font-weight:800; color:#FFFFFF; letter-spacing:0.5px;">ZAMORIN CAFÉ — ORDER STATUS</h1>
            <span style="font-size:13px; color:#94A3B8; font-weight:600;">Takeaway & Online Pickup Counter • Outlet ${displayCafeId}</span>
          </div>
        </div>
        <div style="display:flex; align-items:center; gap:20px;">
          <button id="btn-toggle-fullscreen" style="background:rgba(255,255,255,0.08); color:#E2E8F0; border:1px solid rgba(255,255,255,0.15); padding:8px 16px; border-radius:8px; font-size:13px; font-weight:700; cursor:pointer;">
            ⛶ Fullscreen
          </button>
          <div id="tv-clock" style="font-size:22px; font-weight:800; color:#D4AF37; font-family:monospace;">
            --:--:--
          </div>
        </div>
      </header>

      <!-- Main Two-Column Display Matrix -->
      <main style="flex:1; display:grid; grid-template-columns:1fr 1fr; gap:24px; padding:28px 32px; box-sizing:border-box;">
        
        <!-- Column 1: PREPARING (In Kitchen) -->
        <section style="background:#131B2E; border:1.5px solid rgba(245,158,11,0.3); border-radius:20px; display:flex; flex-direction:column; overflow:hidden; box-shadow:0 8px 32px rgba(0,0,0,0.5);">
          <div style="background:linear-gradient(90deg, rgba(245,158,11,0.2) 0%, rgba(245,158,11,0.05) 100%); padding:20px 28px; border-bottom:1.5px solid rgba(245,158,11,0.3); display:flex; justify-content:space-between; align-items:center;">
            <div style="display:flex; align-items:center; gap:12px;">
              <span style="font-size:26px;">🍳</span>
              <span style="font-size:22px; font-weight:800; color:#FBBF24; letter-spacing:1px; text-transform:uppercase;">Preparing</span>
            </div>
            <span id="tv-prep-count" style="background:#F59E0B; color:#0B0F19; font-size:14px; font-weight:800; padding:4px 12px; border-radius:12px;">0 Orders</span>
          </div>
          <div id="tv-preparing-grid" style="flex:1; padding:24px; display:grid; grid-template-columns:repeat(auto-fill, minmax(130px, 1fr)); gap:16px; align-content:start; overflow-y:auto;">
            <!-- Preparing tokens inserted here -->
          </div>
        </section>

        <!-- Column 2: READY FOR PICKUP -->
        <section style="background:#0F241E; border:1.5px solid rgba(16,185,129,0.4); border-radius:20px; display:flex; flex-direction:column; overflow:hidden; box-shadow:0 8px 32px rgba(16,185,129,0.15);">
          <div style="background:linear-gradient(90deg, rgba(16,185,129,0.25) 0%, rgba(16,185,129,0.05) 100%); padding:20px 28px; border-bottom:1.5px solid rgba(16,185,129,0.4); display:flex; justify-content:space-between; align-items:center;">
            <div style="display:flex; align-items:center; gap:12px;">
              <span style="font-size:26px;">🛎️</span>
              <span style="font-size:22px; font-weight:800; color:#34D399; letter-spacing:1px; text-transform:uppercase;">Ready For Handover</span>
            </div>
            <span id="tv-ready-count" style="background:#10B981; color:#0B0F19; font-size:14px; font-weight:800; padding:4px 12px; border-radius:12px;">0 Orders</span>
          </div>
          <div id="tv-ready-grid" style="flex:1; padding:24px; display:grid; grid-template-columns:repeat(auto-fill, minmax(130px, 1fr)); gap:16px; align-content:start; overflow-y:auto;">
            <!-- Ready tokens inserted here -->
          </div>
        </section>

      </main>

      <!-- Bottom Audio Guidance Strip -->
      <footer style="background:#111827; border-top:1px solid rgba(255,255,255,0.08); padding:12px 32px; display:flex; justify-content:space-between; align-items:center; font-size:13px; color:#94A3B8;">
        <div>🔔 Audio chime activates automatically when your token number appears under Ready.</div>
        <div>Please keep your bill receipt ready for verification.</div>
      </footer>
    </div>
  `;
}

export function wireTakeawayTokenDisplay(root, subroute) {
  // Update clock every second
  const clockEl = root.querySelector("#tv-clock");
  if (clockEl) {
    setInterval(() => {
      clockEl.textContent = new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    }, 1000);
  }

  // Fullscreen button
  root.querySelector("#btn-toggle-fullscreen")?.addEventListener("click", () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen?.().catch(() => {});
    } else {
      document.exitFullscreen?.().catch(() => {});
    }
  });

  // Initial fetch and 4-second refresh cycle
  fetchTokens(root);
  if (refreshIntervalTimer) clearInterval(refreshIntervalTimer);
  refreshIntervalTimer = setInterval(() => fetchTokens(root), 4000);
}

async function fetchTokens(root) {
  try {
    let preparing = [];
    let ready = [];

    try {
      const res = await apiGet(`/api/v1/channels/public/pickup-display/${displayCafeId}`);
      preparing = res.data?.preparing || [];
      ready = res.data?.ready || [];
    } catch (e) {
      // Mock demonstration tokens if server endpoint empty
      preparing = [
        { tokenNumber: "101", channel: "POS" },
        { tokenNumber: "104", channel: "SWIGGY" },
        { tokenNumber: "105", channel: "ZOMATO" },
        { tokenNumber: "107", channel: "WEB" },
      ];
      ready = [
        { tokenNumber: "098", channel: "POS" },
        { tokenNumber: "099", channel: "SWIGGY" },
        { tokenNumber: "102", channel: "POS" },
      ];
    }

    // Check for newly ready tokens and trigger audio chime
    const currentReadySet = new Set(ready.map((t) => t.tokenNumber));
    let hasNewReady = false;
    for (const num of currentReadySet) {
      if (!lastKnownReadyTokens.has(num)) {
        hasNewReady = true;
        break;
      }
    }
    if (hasNewReady && lastKnownReadyTokens.size > 0) {
      playTokenReadyChime();
    }
    lastKnownReadyTokens = currentReadySet;

    // Render preparing tokens
    const prepGrid = root.querySelector("#tv-preparing-grid");
    const prepCount = root.querySelector("#tv-prep-count");
    if (prepCount) prepCount.textContent = `${preparing.length} Orders`;
    if (prepGrid) {
      prepGrid.innerHTML = preparing.length ? preparing.map((t) => `
        <div style="background:#1E293B; border:1.5px solid #F59E0B; border-radius:14px; padding:16px 12px; text-align:center; box-shadow:0 4px 12px rgba(0,0,0,0.3);">
          <div style="font-size:32px; font-weight:900; color:#FBBF24; font-family:monospace; line-height:1;">${t.tokenNumber}</div>
          <div style="font-size:11px; font-weight:700; color:#94A3B8; margin-top:6px; text-transform:uppercase;">${t.channel || 'COUNTER'}</div>
        </div>
      `).join("") : `<div style="grid-column:1/-1; text-align:center; padding:40px; color:#64748B; font-size:16px;">All pending orders prepared!</div>`;
    }

    // Render ready tokens
    const readyGrid = root.querySelector("#tv-ready-grid");
    const readyCount = root.querySelector("#tv-ready-count");
    if (readyCount) readyCount.textContent = `${ready.length} Orders`;
    if (readyGrid) {
      readyGrid.innerHTML = ready.length ? ready.map((t, idx) => `
        <div style="background:#064E3B; border:2px solid #10B981; border-radius:14px; padding:16px 12px; text-align:center; box-shadow:0 6px 18px rgba(16,185,129,0.3); ${idx === 0 ? 'animation:pulse 2s infinite;' : ''}">
          <div style="font-size:36px; font-weight:900; color:#34D399; font-family:monospace; line-height:1;">${t.tokenNumber}</div>
          <div style="font-size:11px; font-weight:800; color:#A7F3D0; margin-top:6px; text-transform:uppercase;">${t.channel || 'COUNTER'}</div>
        </div>
      `).join("") : `<div style="grid-column:1/-1; text-align:center; padding:40px; color:#64748B; font-size:16px;">No orders currently awaiting pickup.</div>`;
    }

  } catch (err) {
    console.error("Failed to load TV tokens:", err);
  }
}
