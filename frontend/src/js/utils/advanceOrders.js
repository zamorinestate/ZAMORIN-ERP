// Phase 5 · Advance-order register (F108) and explicit stock consumption (F115/F116).
// Real endpoints only: GET /finance/advance-deposits, GET /finance/advance-deposits/by-slip/:slip,
// POST /inventory/advance-stock/:depositId/consume. No success is shown before the server answers.
import { openModal, showToast } from "../components.js";
import { apiGet, apiPost } from "../apiClient.js";
import { state } from "../state.js";
import { paginate, renderPager, wirePager } from "./zui.js";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const inr = (p) => "₹" + ((p || 0) / 100).toLocaleString("en-IN", { minimumFractionDigits: 2 });
const STATUSES = ["", "HELD_UNAPPLIED", "PARTIALLY_APPLIED", "FULLY_APPLIED"];
const KEY = "advance-orders";

export function openAdvanceOrders() {
  const u = state.auth?.user || state.user || {};
  const canConsume = u.role === "MASTER" || u.role === "CAFE_ADMIN";
  let rows = [], page = 1, size = 10, status = "";
  openModal({
    title: "Advance orders", maxWidth: "820px", saveLabel: "Close", onSave: () => true,
    body: `<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end;margin-bottom:10px">
      <label class="p3-f"><span>Status</span><select id="ao-st" class="input">${STATUSES.map((s) => `<option value="${s}">${s || "All"}</option>`).join("")}</select></label>
      <label class="p3-f"><span>Find by slip number</span><input id="ao-slip" class="input" placeholder="RV-… or ADV-DEP-…"></label>
      <button id="ao-find" class="btn" type="button">Find</button><button id="ao-ref" class="btn" type="button">Refresh</button></div>
      <div id="ao-out" role="status" aria-live="polite"></div>`,
  });
  const out = () => document.querySelector("#ao-out");
  const draw = () => {
    const m = paginate(rows, page, size);
    out().innerHTML = rows.length ? `<div style="overflow-x:auto"><table class="table" aria-label="Advance orders"><thead><tr><th>Slip</th><th>Customer</th><th>Event</th><th>Deposit</th><th>Unapplied</th><th>Status</th><th>Stock</th><th></th></tr></thead><tbody>${m.rows.map((r) => `<tr>
      <td class="mono">${esc(r.receiptVoucherNumber || r.depositId)}</td><td>${esc(r.customerName)}</td>
      <td>${esc((r.targetEventDate || "").slice(0, 10))}</td><td>${inr(r.depositAmountPaisa)}</td><td>${inr(r.unappliedAmountPaisa)}</td>
      <td><span class="badge">${esc(r.status)}</span></td><td>${esc(r.stockConsumptionStatus || "—")}</td>
      <td>${canConsume && r.stockConsumptionStatus !== "CONSUMED" && r.status !== "CANCELLED" ? `<button class="btn btn-sm ao-use" data-id="${esc(r.depositId)}">Consume stock</button>` : ""}</td></tr>`).join("")}</tbody></table></div>${renderPager(m, KEY)}`
      : `<p class="text-muted">No advance orders found.</p>`;
    wirePager(out(), KEY, (c) => { page = c.page; size = c.size; draw(); });
    out().querySelectorAll(".ao-use").forEach((b) => b.addEventListener("click", () => consume(b)));
  };
  const load = async () => {
    out().textContent = "Loading…";
    try {
      const q = new URLSearchParams(); if (status) q.set("status", status);
      const r = await apiGet(`/finance/advance-deposits${q.toString() ? "?" + q : ""}`, { bypassCache: true });
      rows = r?.deposits || r?.data?.deposits || []; page = 1; draw();
    } catch (e) { out().innerHTML = `<p role="alert" style="color:var(--err)">${esc(e.message || "Could not load advance orders.")}</p>`; }
  };
  const consume = async (b) => {
    if (!confirm(`Use up the stock planned for ${b.dataset.id}? This reduces inventory and cannot be repeated.`)) return;
    b.disabled = true;
    try {
      const r = await apiPost(`/inventory/advance-stock/${encodeURIComponent(b.dataset.id)}/consume`, {});
      showToast(`Stock consumed (${r?.consumedItemCount ?? r?.data?.consumedItemCount ?? 0} items).`, "success");
      load();
    } catch (e) { b.disabled = false; showToast(e.message || "Stock was not consumed.", "error"); }
  };
  document.querySelector("#ao-st").onchange = (e) => { status = e.target.value; load(); };
  document.querySelector("#ao-ref").onclick = load;
  document.querySelector("#ao-find").onclick = async () => {
    const s = document.querySelector("#ao-slip").value.trim(); if (!s) return load();
    try {
      const r = await apiGet(`/finance/advance-deposits/by-slip/${encodeURIComponent(s)}`, { bypassCache: true });
      const d = r?.deposit || r?.data?.deposit; if (!d) throw new Error("Not found.");
      rows = [d]; page = 1; draw();
    } catch (e) { out().innerHTML = `<p role="alert" style="color:var(--err)">${esc(e.message || "No advance deposit found for that slip.")}</p>`; }
  };
  load();
}
