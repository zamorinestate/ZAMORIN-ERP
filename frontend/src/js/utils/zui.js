// Phase 1 shared UI helpers (pager, skeleton, six states, appearance). Vanilla ES module, no dependencies.
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const safeGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const safeSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* storage blocked */ } };

/* ---------- Pagination (10 / 25 / 50, remembered per table key) ---------- */
export const PAGE_SIZES = [10, 25, 50];
export function getPageSize(key) {
  const n = Number(safeGet(`zamorin-page-size:${key}`));
  return PAGE_SIZES.includes(n) ? n : 25;
}
export function setPageSize(key, n) { if (PAGE_SIZES.includes(n)) safeSet(`zamorin-page-size:${key}`, String(n)); }

/** Slice rows for the current page. Returns { rows, page, pages, total, from, to, size }. */
export function paginate(all, page = 1, size = 25) {
  const total = all.length;
  const pages = Math.max(1, Math.ceil(total / size));
  const p = Math.min(Math.max(1, page), pages);
  const start = (p - 1) * size;
  const rows = all.slice(start, start + size);
  return { rows, page: p, pages, total, size, from: total ? start + 1 : 0, to: start + rows.length };
}

function pageList(page, pages) {
  if (pages <= 7) return Array.from({ length: pages }, (_, i) => i + 1);
  const s = new Set([1, pages, page, page - 1, page + 1]);
  const list = [...s].filter((n) => n >= 1 && n <= pages).sort((a, b) => a - b);
  const out = [];
  list.forEach((n, i) => { if (i && n - list[i - 1] > 1) out.push("…"); out.push(n); });
  return out;
}

/** Pager markup. Wire with wirePager(root, key, onChange). */
export function renderPager(meta, key = "tbl") {
  const { page, pages, total, from, to, size } = meta;
  const nums = pageList(page, pages).map((n) => n === "…"
    ? `<li class="pg-gap" aria-hidden="true">…</li>`
    : `<li><button type="button" class="pg-num" data-pg="${n}" ${n === page ? 'aria-current="page"' : ""} aria-label="Page ${n}">${n}</button></li>`).join("");
  return `<div class="pg" data-pager="${esc(key)}">
    <div class="pg-info" aria-live="polite">${total ? `Showing <b>${from}–${to}</b> of <b>${total}</b>` : "No records"}</div>
    <label class="pg-size">Rows <select data-pg-size aria-label="Rows per page">${PAGE_SIZES.map((n) => `<option value="${n}" ${n === size ? "selected" : ""}>${n}</option>`).join("")}</select></label>
    <nav aria-label="Pagination"><ul class="pg-nav">
      <li><button type="button" data-pg="${page - 1}" ${page <= 1 ? "disabled" : ""} aria-label="Previous page">‹</button></li>${nums}
      <li><button type="button" data-pg="${page + 1}" ${page >= pages ? "disabled" : ""} aria-label="Next page">›</button></li>
    </ul></nav></div>`;
}
export function wirePager(root, key, onChange) {
  const el = root.querySelector(`[data-pager="${key}"]`);
  if (!el) return;
  el.querySelectorAll("[data-pg]").forEach((b) => b.addEventListener("click", () => onChange({ page: Number(b.dataset.pg), size: getPageSize(key) })));
  el.querySelector("[data-pg-size]")?.addEventListener("change", (e) => { const n = Number(e.target.value); setPageSize(key, n); onChange({ page: 1, size: n }); });
}

/* ---------- Skeletons (Flowbite pulse pattern) ---------- */
const sr = `<span class="sr-only">Loading…</span>`;
export const skeleton = {
  text: (n = 3) => `<div role="status" class="sk sk-stack">${Array.from({ length: n }, (_, i) => `<div class="sk-bar ${i === n - 1 ? "sk-w60" : "sk-w100"}"></div>`).join("")}${sr}</div>`,
  kpi: (n = 4) => `<div role="status" class="grid-kpi">${Array.from({ length: n }, () => `<div class="sk sk-kpi"><div class="sk-bar sk-w40"></div><div class="sk-bar h10 sk-w60"></div><div class="sk-bar sk-w80"></div></div>`).join("")}${sr}</div>`,
  list: (n = 5) => `<div role="status" class="sk sk-list">${Array.from({ length: n }, () => `<div class="sk-row"><div style="flex:1"><div class="sk-bar h10 sk-w40" style="margin-bottom:10px"></div><div class="sk-bar sk-w60"></div></div><div class="sk-bar h10" style="width:48px"></div></div>`).join("")}${sr}</div>`,
  table: (n = 6) => `<div role="status" class="sk sk-table"><div class="sk-head"></div>${Array.from({ length: n }, () => `<div class="sk-row"><div class="sk-bar sk-w80"></div><div class="sk-bar"></div><div class="sk-bar"></div><div class="sk-bar"></div></div>`).join("")}${sr}</div>`,
  card: () => `<div role="status" class="sk sk-card"><div class="sk-block" style="height:160px"></div><div class="sk-bar h10 sk-w60"></div><div class="sk-bar sk-w100"></div><div class="sk-bar sk-w80"></div>${sr}</div>`,
};

/* ---------- Six states ---------- */
const ICON = {
  empty: `<path d="M3 7l9-4 9 4-9 4-9-4zM3 7v10l9 4 9-4V7"/>`,
  error: `<circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16h.01"/>`,
  success: `<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>`,
  offline: `<path d="M2 8.8a15 15 0 0 1 20 0M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0M12 20h.01"/><path d="m3 3 18 18"/>`,
  denied: `<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>`,
};
/** kind: empty | error | success | offline | denied. actions: [{label, id, primary}] */
export function stateBlock(kind, title, text = "", actions = []) {
  const cls = { error: "st-err", success: "st-ok", offline: "st-offline", denied: "st-denied" }[kind] || "";
  return `<div class="st ${cls}" role="${kind === "error" ? "alert" : "status"}"><div class="st-icon"><svg class="i" viewBox="0 0 24 24" aria-hidden="true">${ICON[kind] || ICON.empty}</svg></div>
    <h3>${esc(title)}</h3>${text ? `<p>${esc(text)}</p>` : ""}
    ${actions.length ? `<div class="st-actions">${actions.map((a) => `<button type="button" class="btn ${a.primary ? "btn-primary" : "btn-secondary"} btn-sm" ${a.id ? `id="${esc(a.id)}"` : ""}>${esc(a.label)}</button>`).join("")}</div>` : ""}</div>`;
}

/** Button that is disabled for a stated reason (tooltip + aria). */
export function reasonButton(label, reason, cls = "btn-secondary") {
  return `<span class="tt"><button type="button" class="btn ${cls}" aria-disabled="true" aria-describedby="r-${esc(label)}">${esc(label)}</button><span class="tt-bubble" role="tooltip" id="r-${esc(label)}">${esc(reason)}</span></span>`;
}

/* ---------- Appearance: theme / font family / font size ---------- */
export const FONT_FAMILIES = [
  { code: "inter", label: "Inter", desc: "Default, clean and compact" },
  { code: "poppins", label: "Poppins", desc: "Rounder, friendlier" },
  { code: "system", label: "System", desc: "Your device font" },
  { code: "serif", label: "Fraunces", desc: "Serif, editorial" },
  { code: "mono", label: "IBM Plex Mono", desc: "Monospaced" },
];
export function applyAppearance(p = {}) {
  const r = document.documentElement;
  const fam = p.fontFamily || safeGet("zamorin-font-family") || "inter";
  const size = p.fontSize || safeGet("zamorin-font-size") || "standard";
  r.setAttribute("data-font-family", FONT_FAMILIES.some((f) => f.code === fam) ? fam : "inter");
  r.setAttribute("data-font-size", ["compact", "standard", "large", "extra-large"].includes(size) ? size : "standard");
}
export function setFontFamily(code) { safeSet("zamorin-font-family", code); applyAppearance({ fontFamily: code }); }
export function setFontSize(code) { safeSet("zamorin-font-size", code); applyAppearance({ fontSize: code }); }

/* ---------- Auto-pagination for every data table in the signed-in shell ----------
   Pure presentation: rows beyond the page window get the `hidden` attribute; no data is removed.
   Opt out with data-nopage on the <table>. Tables with 10 rows or fewer get no pager. */
function dataRows(table) {
  const body = table.tBodies[0];
  if (!body) return [];
  return [...body.rows].filter((r) => !(r.cells.length === 1 && r.cells[0].colSpan > 1));
}
function routeKey() { return (location.hash || "#").replace(/[?].*$/, "").slice(0, 60); }

function paginateTable(table, idx) {
  if (table.hasAttribute("data-nopage") || table.closest("[data-nopage],.zamorin-print,.print-preview")) return;
  const rows = dataRows(table);
  const anchor = table.closest(".table-wrap, .table-responsive, .data-table-wrap, .data-table-container") || table;
  let host = anchor.nextElementSibling?.classList?.contains("pg-host") ? anchor.nextElementSibling : null;
  if (rows.length <= 10) { host?.remove(); rows.forEach((r) => r.removeAttribute("data-zpg-hide")); rows.forEach((r) => { r.hidden = false; }); delete table._zpg; return; }
  const key = `${routeKey()}#${idx}`;
  const st = table._zpg || (table._zpg = { page: 1, size: getPageSize(key), sig: "" });
  const meta = paginate(rows, st.page, st.size);
  st.page = meta.page;
  const sig = `${rows.length}|${st.page}|${st.size}`;
  if (sig === st.sig && host) return;
  st.sig = sig;
  rows.forEach((r, i) => { r.hidden = !(i >= meta.from - 1 && i < meta.to); });
  if (!host) { host = document.createElement("div"); host.className = "pg-host"; anchor.after(host); }
  host.innerHTML = renderPager(meta, key);
  wirePager(host, key, ({ page, size }) => { st.page = page; st.size = size; st.sig = ""; paginateTable(table, idx); });
}

let _obs = null, _timer = 0;
export function enhanceTables(root = document.getElementById("app")) {
  if (!root || root.classList.contains("auth-screen")) return;
  root.querySelectorAll("table").forEach((t, i) => { try { paginateTable(t, i); } catch { /* never break a page */ } });
}
export function startAutoPagination() {
  if (_obs || typeof MutationObserver === "undefined") return;
  const root = document.getElementById("app");
  if (!root) return;
  _obs = new MutationObserver((muts) => {
    if (muts.every((m) => m.target.closest?.(".pg-host"))) return;
    clearTimeout(_timer);
    _timer = setTimeout(() => enhanceTables(root), 60);
  });
  _obs.observe(root, { childList: true, subtree: true });
  enhanceTables(root);
}
