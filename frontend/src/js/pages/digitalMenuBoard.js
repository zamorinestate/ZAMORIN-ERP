/**
 * DIGITAL MENU BOARD SIGNAGE (F287–F291)
 *
 * Fullscreen signage view for TV displays. Slides come only from
 * GET /channels/menu-board/slides — nothing is hard-coded. When the server returns
 * no slides (or cannot be reached) the screen says so instead of showing sample dishes.
 *
 * Optional query on the hash: #menu-board?cafeId=ZC-0001&screenTag=MAIN_COUNTER
 */

import { apiGet } from "../apiClient.js";
import { state } from "../state.js";

let slideTimer = null;
let clockTimer = null;
let currentSlideIndex = 0;

const esc = (v) =>
  String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function queryParams() {
  const q = (location.hash.split("?")[1] || "");
  return new URLSearchParams(q);
}

export function renderMenuBoard() {
  return `
    <div id="digital-menu-board-root" style="width:100vw; height:100vh; background:#0B0F19; color:#F8FAFC; display:flex; flex-direction:column; overflow:hidden;">
      <div style="background:#111827; border-bottom:2px solid #D4AF37; padding:18px 36px; display:flex; justify-content:space-between; align-items:center;">
        <div style="font-size:22px; font-weight:800; letter-spacing:0.5px;">ZAMORIN CAFÉ</div>
        <div style="text-align:right;">
          <div id="menu-board-time" style="font-size:24px; font-weight:800; font-family:monospace;">--:--</div>
          <div id="menu-board-daypart" style="font-size:12px; color:#10B981; font-weight:700;"></div>
        </div>
      </div>
      <div id="signage-slide-container" style="flex:1; display:flex; align-items:center; justify-content:center; padding:32px;">
        <div style="color:#94A3B8; font-size:18px;">Loading menu…</div>
      </div>
    </div>`;
}

function slideHtml(s) {
  const price = Number.isFinite(Number(s.pricePaisa)) && Number(s.pricePaisa) > 0
    ? `<div style="font-size:44px; font-weight:900; color:#D4AF37; margin-top:18px;">₹${(Number(s.pricePaisa) / 100).toFixed(2).replace(/\.00$/, "")}</div>`
    : "";
  const img = s.imageUrl && /^https?:\/\//.test(s.imageUrl)
    ? `<div style="flex:1; border-radius:16px; background:#111827 url('${esc(s.imageUrl)}') center/cover no-repeat; min-height:300px;"></div>`
    : "";
  return `
    <div style="display:flex; gap:32px; width:100%; height:100%; align-items:stretch;">
      <div style="flex:1.2; background:#111827; border:1px solid #1E293B; border-radius:16px; padding:40px; display:flex; flex-direction:column; justify-content:center;">
        <h2 style="font-size:44px; font-weight:800; margin:0 0 16px; line-height:1.2; color:#FFF;">${esc(s.title)}</h2>
        ${s.subtitle ? `<p style="font-size:20px; color:#CBD5E1; line-height:1.6; margin:0;">${esc(s.subtitle)}</p>` : ""}
        ${price}
      </div>
      ${img}
    </div>`;
}

export function wireMenuBoard(container) {
  const root = container || document.getElementById("page-content") || document.body;
  const stage = root.querySelector("#signage-slide-container");
  const timeEl = root.querySelector("#menu-board-time");
  const dpEl = root.querySelector("#menu-board-daypart");
  clearInterval(clockTimer);
  clearTimeout(slideTimer);
  if (timeEl) {
    const tick = () => { timeEl.textContent = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); };
    tick();
    clockTimer = setInterval(() => {
      if (!timeEl.isConnected) { clearInterval(clockTimer); return; }
      tick();
    }, 1000);
  }

  const qp = queryParams();
  const cafeId = qp.get("cafeId") || state.selectedCafeId || "";
  const screenTag = qp.get("screenTag") || "";
  const path = `/channels/menu-board/slides?${new URLSearchParams({ ...(cafeId ? { cafeId } : {}), ...(screenTag ? { screenTag } : {}) })}`;

  const message = (text) => {
    if (stage) stage.innerHTML = `<div style="color:#94A3B8; font-size:20px; text-align:center;">${esc(text)}</div>`;
  };

  const load = async () => {
    try {
      const res = await apiGet(path, { bypassCache: true });
      const slides = res?.data?.slides;
      if (!Array.isArray(slides) || slides.length === 0) {
        message("No menu slides are scheduled for this screen.");
        return [];
      }
      return slides;
    } catch (err) {
      message("The menu could not be loaded. Retrying…");
      return null;
    }
  };

  const run = async () => {
    if (!stage || !stage.isConnected) return;
    const slides = await load();
    if (!slides || slides.length === 0) {
      slideTimer = setTimeout(run, 30000);
      return;
    }
    currentSlideIndex = 0;
    const show = () => {
      if (!stage.isConnected) return;
      const s = slides[currentSlideIndex % slides.length];
      if (dpEl) dpEl.textContent = s.dayPart ? String(s.dayPart).replace(/_/g, " ") : "";
      stage.innerHTML = slideHtml(s);
      currentSlideIndex += 1;
      const wait = Math.max(5, Number(s.displayDurationSeconds) || 15) * 1000;
      if (currentSlideIndex >= slides.length) {
        slideTimer = setTimeout(run, wait); // refresh the list after a full loop
      } else {
        slideTimer = setTimeout(show, wait);
      }
    };
    show();
  };
  run();
}
