// =============================================================================
// Inventory — Phase 2 tabs wired to existing backend endpoints (no backend changes)
//   • Stock Freeze   : POST /inventory/freeze-date            (F188, F189, F191)
//   • Production Yield: POST /inventory/production/record-actual-yield (F156, F157, F159)
// Roles that may write: MASTER, CAFE_ADMIN (INVENTORY_WRITE). Others see read-only state.
// =============================================================================
import { apiGet, apiPost } from "../apiClient.js";
import { state } from "../state.js";
import { showToast, openModal, renderChildHeader } from "../components.js";
import { navigate } from "../router.js";
import { stateBlock } from "../utils/zui.js";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const canWrite = () => ["MASTER", "CAFE_ADMIN"].includes(state.user?.role);
function inr(paise) {
  const n = Number(paise);
  if (!Number.isFinite(n)) return "—";
  return "₹" + (n / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Kolkata" }) : "—");
const istDate = (d) => new Date(d).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
const unwrap = (r) => r?.data ?? r ?? {};
const readOnlyBanner = () => `<div class="readonly-banner" role="note">Read-only: your role can view this screen but cannot change it. The server enforces this too.</div>`;

async function loadCafes() {
  try {
    const r = await apiGet("/cafes");
    const list = r?.data || r?.cafes || (Array.isArray(r) ? r : []);
    return list.map((c) => ({ id: c.cafeId || c.id || c._id, name: c.name || c.cafeName || c.cafeId || c.id }));
  } catch { return []; }
}

/* ------------------------------ STOCK FREEZE ------------------------------ */
export async function renderStockFreezeTab(wrap) {
  wrap.innerHTML = `<div style="display:flex;flex-direction:column;gap:16px;">
    ${renderChildHeader({ parentTitle: "Inventory & Stock", parentRoute: "inventory", childTitle: "Historical Stock Freeze", childSubtitle: "Lock closed periods so late entries cannot change past stock.", icon: "🔒", backBtnId: "inv-back-to-hub-btn", actionsHtml: "" })}
    ${canWrite() ? "" : readOnlyBanner()}
    <div class="card"><div class="card-head"><div><h2>Freeze control</h2><p>Transactions dated on or before the freeze date are rejected.</p></div><span id="frz-badge" class="badge">Loading</span></div>
      <div class="card-body" id="frz-body"><div role="status" class="sk sk-stack"><div class="sk-bar sk-w60"></div><div class="sk-bar sk-w40"></div><span class="sr-only">Loading</span></div></div></div></div>`;
  wrap.querySelector("#inv-back-to-hub-btn")?.addEventListener("click", () => navigate("inventory"));
  const body = wrap.querySelector("#frz-body"), badge = wrap.querySelector("#frz-badge");
  const cafes = await loadCafes();
  if (!cafes.length) { body.innerHTML = stateBlock("error", "Cafés could not be loaded", "Check your connection and try again.", [{ label: "Retry", id: "frz-retry" }]); badge.textContent = "Unavailable"; body.querySelector("#frz-retry")?.addEventListener("click", () => renderStockFreezeTab(wrap)); return; }
  const preset = state.user?.role === "CAFE_ADMIN" ? (state.user?.cafeId || state.selectedCafeId) : null;
  body.innerHTML = `<div class="form-grid">
      <div class="field"><label class="label" for="frz-cafe">Café</label><select id="frz-cafe" class="select">${cafes.map((c) => `<option value="${esc(c.id)}" ${c.id === preset ? "selected" : ""}>${esc(c.name)}</option>`).join("")}</select></div>
      <div class="field"><label class="label" for="frz-current">Current freeze date</label><input id="frz-current" class="input" readonly value="—"></div>
      <div class="field"><label class="label" for="frz-new">New freeze date</label><input id="frz-new" class="input" type="date" ${canWrite() ? "" : "disabled"} aria-describedby="frz-hint"><span id="frz-hint" class="hint">Forward only. The date cannot be moved back once set.</span><span id="frz-err" class="error-text" role="alert"></span></div>
    </div>
    <div class="st-actions" style="justify-content:flex-start;margin-top:16px;">${canWrite() ? `<button id="frz-apply" class="btn btn-primary" type="button">Advance freeze date</button>` : `<span class="tt"><button class="btn btn-secondary" type="button" aria-disabled="true">Advance freeze date</button><span class="tt-bubble" role="tooltip">Only Primary Master and Café Operations can change this.</span></span>`}</div>`;
  let current = null;
  async function refresh() {
    const id = body.querySelector("#frz-cafe").value;
    badge.className = "badge"; badge.textContent = "Loading";
    try {
      const c = unwrap(await apiGet(`/cafes/${encodeURIComponent(id)}`, { bypassCache: true }));
      current = c.historicalStockFreezeDate || null;
      body.querySelector("#frz-current").value = current ? fmtDate(current) : "Not frozen";
      badge.className = `badge ${current ? "badge-info" : "badge-ok"}`; badge.textContent = current ? "FROZEN" : "ACTIVE";
      const n = body.querySelector("#frz-new"); if (current) n.min = istDate(current);
    } catch (e) { current = null; body.querySelector("#frz-current").value = "—"; badge.className = "badge badge-err"; badge.textContent = "Unavailable"; showToast(e.message || "Could not load the café.", "error"); }
  }
  body.querySelector("#frz-cafe").addEventListener("change", refresh);
  await refresh();
  body.querySelector("#frz-apply")?.addEventListener("click", () => {
    const err = body.querySelector("#frz-err"); err.textContent = "";
    const cafeId = body.querySelector("#frz-cafe").value, date = body.querySelector("#frz-new").value;
    if (!date) { err.textContent = "Choose the new freeze date."; return; }
    if (current && date < istDate(current)) { err.textContent = "The freeze date cannot be moved backward."; return; }
    if (date >= istDate(new Date())) { err.textContent = "Choose a date before today. Same-day operations cannot be frozen until the daily close is settled."; return; }
    const cafeName = body.querySelector("#frz-cafe").selectedOptions[0].textContent;
    openModal({
      title: "Confirm stock freeze", saveLabel: "Freeze stock", maxWidth: "480px",
      body: `<div class="alert alert-warn"><div><b>This cannot be undone.</b><br>For <b>${esc(cafeName)}</b>, all stock transactions dated on or before <b>${esc(fmtDate(date))}</b> will be rejected from now on.</div></div>`,
      onSave: async () => {
        try {
          const res = unwrap(await apiPost("/inventory/freeze-date", { cafeId, freezeDate: new Date(`${date}T23:59:59+05:30`).toISOString() }));
          showToast(`Stock frozen up to ${fmtDate(res.historicalStockFreezeDate || date)}.`, "success");
          await refresh(); body.querySelector("#frz-new").value = "";
        } catch (e) { showToast(e.message || "The freeze date could not be saved.", "error"); return false; }
      },
    });
  });
}

/* ---------------------------- PRODUCTION YIELD ---------------------------- */
const yieldLog = [];
export function renderProductionYieldTab(wrap) {
  wrap.innerHTML = `<div style="display:flex;flex-direction:column;gap:16px;">
    ${renderChildHeader({ parentTitle: "Inventory & Stock", parentRoute: "inventory", childTitle: "Production Yield", childSubtitle: "Record the weighed output of a production batch to see yield, shrinkage and the true unit cost.", icon: "⚖️", backBtnId: "inv-back-to-hub-btn", actionsHtml: "" })}
    ${canWrite() ? "" : readOnlyBanner()}
    <div class="split">
      <form id="yld-form" class="card" novalidate><div class="card-head"><div><h2>Record actual yield</h2><p>Enter the batch number and the weighed quantity after preparation.</p></div></div>
        <div class="card-body"><div class="form-grid">
          <div class="field"><label class="label" for="yld-batch">Batch number</label><input id="yld-batch" class="input" maxlength="60" autocomplete="off" style="text-transform:uppercase" ${canWrite() ? "" : "disabled"} aria-describedby="yld-batch-e"><span id="yld-batch-e" class="error-text" role="alert"></span></div>
          <div class="field"><label class="label" for="yld-qty">Actual yield weighed</label><input id="yld-qty" class="input num" type="number" min="0" step="any" inputmode="decimal" ${canWrite() ? "" : "disabled"} aria-describedby="yld-qty-e"><span id="yld-qty-e" class="error-text" role="alert"></span></div>
          <div class="field" style="grid-column:1/-1"><label class="label" for="yld-notes">Notes (optional)</label><textarea id="yld-notes" class="textarea" maxlength="500" ${canWrite() ? "" : "disabled"}></textarea></div>
        </div></div>
        <div class="card-foot">${canWrite() ? `<button id="yld-save" class="btn btn-primary" type="submit">Record yield</button>` : `<span class="tt"><button class="btn btn-secondary" type="button" aria-disabled="true">Record yield</button><span class="tt-bubble" role="tooltip">Only Primary Master and Café Operations can record yield.</span></span>`}</div></form>
      <div class="card"><div class="card-head"><h2>Result</h2></div><div class="card-body" id="yld-result" aria-live="polite">${stateBlock("empty", "No result yet", "Record a batch to see its yield and cost.")}</div></div>
    </div>
    <div class="card"><div class="card-head"><div><h2>Recorded in this session</h2><p>Cleared when you leave the app. The server keeps the permanent record.</p></div></div><div id="yld-log" class="table-wrap"></div></div></div>`;
  wrap.querySelector("#inv-back-to-hub-btn")?.addEventListener("click", () => navigate("inventory"));
  const form = wrap.querySelector("#yld-form"), result = wrap.querySelector("#yld-result"), logEl = wrap.querySelector("#yld-log");
  const drawLog = () => { logEl.innerHTML = yieldLog.length ? `<table class="table"><thead><tr><th>Batch</th><th class="r">Planned</th><th class="r">Actual</th><th class="r">Efficiency</th><th class="r">Shrinkage</th><th class="r">Unit cost</th></tr></thead><tbody>${yieldLog.map((r) => `<tr><td class="mono">${esc(r.batchNumber)}</td><td class="r">${esc(r.plannedYield)}</td><td class="r">${esc(r.actualYieldWeighed)}</td><td class="r">${esc(r.yieldEfficiencyPercent)}%</td><td class="r">${esc(r.shrinkagePercent)}%</td><td class="r">${inr(r.adjustedUnitCostPaisa)}</td></tr>`).join("")}</tbody></table>` : stateBlock("empty", "Nothing recorded yet"); };
  drawLog();
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!canWrite()) return;
    const batch = form.querySelector("#yld-batch").value.trim().toUpperCase(), qty = Number(form.querySelector("#yld-qty").value), notes = form.querySelector("#yld-notes").value.trim();
    const eb = form.querySelector("#yld-batch-e"), eq = form.querySelector("#yld-qty-e"); eb.textContent = ""; eq.textContent = "";
    let bad = false;
    if (!batch) { eb.textContent = "Batch number is required."; bad = true; }
    if (!(qty > 0)) { eq.textContent = "Enter a weighed quantity greater than zero."; bad = true; }
    if (bad) return;
    const btn = form.querySelector("#yld-save"); btn.disabled = true; btn.textContent = "Recording...";
    try {
      const r = unwrap(await apiPost("/inventory/production/record-actual-yield", { batchNumber: batch, actualYieldWeighed: qty, ...(notes ? { notes } : {}) }));
      result.innerHTML = `<dl class="kv"><dt>Batch</dt><dd class="mono">${esc(r.batchNumber || batch)}</dd><dt>Planned yield</dt><dd>${esc(r.plannedYield ?? "—")}</dd><dt>Actual weighed</dt><dd>${esc(r.actualYieldWeighed ?? qty)}</dd><dt>Yield efficiency</dt><dd>${esc(r.yieldEfficiencyPercent ?? "—")}%</dd><dt>Shrinkage</dt><dd>${esc(r.shrinkagePercent ?? "—")}%</dd><dt>Total material cost</dt><dd>${inr(r.totalMaterialCostPaisa)}</dd><dt>Adjusted unit cost</dt><dd>${inr(r.adjustedUnitCostPaisa)}</dd></dl>`;
      yieldLog.unshift({ batchNumber: r.batchNumber || batch, ...r, actualYieldWeighed: r.actualYieldWeighed ?? qty }); drawLog();
      showToast(`Yield recorded for ${r.batchNumber || batch}.`, "success"); form.reset();
    } catch (er) {
      const code = er?.code || er?.data?.code;
      if (code === "BATCH_NOT_FOUND" || /not found/i.test(er?.message || "")) eb.textContent = er.message || "Production batch not found.";
      else if (code === "INVALID_ACTUAL_YIELD") eq.textContent = er.message;
      else showToast(er.message || "The yield could not be recorded.", "error");
    } finally { btn.disabled = false; btn.textContent = "Record yield"; }
  });
}
