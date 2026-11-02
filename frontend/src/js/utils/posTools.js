// Phase 3 · POS kitchen & correction tools. Every action calls a real endpoint (PHASE3_DATA audit);
// nothing reports success before the server answers.
//  A019 KOT lookup · A022 moved-item reprint · A025 readiness slip · A023 printer alert · F067 tender correction
import { openModal, showToast } from "../components.js";
import { apiGet, apiPost } from "../apiClient.js";
import { state } from "../state.js";
import { openAdvanceOrders } from "./advanceOrders.js";
import { openGiftCards } from "./giftCards.js";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const STATIONS = ["ALL", "BARISTA", "HOT_KITCHEN", "DESSERT_BAR", "DISPATCH"];
const TENDERS = ["CASH", "CARD", "UPI"];

function who() {
  const u = state.auth?.user || state.user || {};
  return { role: u.role || state.role || "", cafeId: (localStorage.getItem("zamorin_bound_cafe_id") || u.cafeId || state.currentCafeId || "").trim() };
}
const errText = (e) => (e && (e.message || e.code)) || "Request failed.";
const sel = (id, opts, label) => `<label class="p3-f"><span>${label}</span><select id="${id}" class="input">${opts.map((o) => `<option>${esc(o)}</option>`).join("")}</select></label>`;
const inp = (id, label, ph = "", type = "text") => `<label class="p3-f"><span>${label}</span><input id="${id}" type="${type}" class="input" placeholder="${esc(ph)}"/></label>`;
const out = (id) => `<div id="${id}" class="p3-out" role="status" aria-live="polite"></div>`;
const $ = (s) => document.querySelector(s);

async function run(btn, outSel, fn) {
  const o = $(outSel); btn.disabled = true; const t = btn.textContent; btn.textContent = "Working…"; o.className = "p3-out";
  try { o.innerHTML = await fn(); o.classList.add("ok"); }
  catch (e) { o.textContent = errText(e); o.classList.add("err"); }
  finally { btn.disabled = false; btn.textContent = t; }
}
const lines = (items) => (items || []).map((i) => `<li>${esc(i.quantity ?? i.qty ?? 1)} × ${esc(i.name)}${i.notes ? ` <em>(${esc(i.notes)})</em>` : ""}</li>`).join("");
const parseItems = (txt) => txt.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => {
  const m = l.match(/^(\d+)\s*[x×]?\s+(.+)$/i); return m ? { quantity: +m[1], name: m[2] } : { quantity: 1, name: l };
});

export function openPosTools() {
  const { role, cafeId } = who();
  const canCorrect = role === "MASTER" || role === "CAFE_ADMIN";
  openModal({
    title: "Kitchen & bill tools",
    maxWidth: "640px", saveLabel: "Close", onSave: () => true,
    body: `<div class="p3-tools">
      <section><h4>Advance orders</h4><p class="text-muted">Register of advance bookings; use up planned stock when the order is made.</p>
        <button id="p3-ao" class="btn" type="button">Open register</button></section>
      <section><h4>Gift cards</h4><p class="text-muted">Sell, check and use gift cards.</p>
        <button id="p3-gc" class="btn" type="button">Open gift cards</button></section>
      <section><h4>Printer check</h4><p class="text-muted">Stations with no online printer.</p>
        <button id="p3-pc" class="btn" type="button">Check printers</button>${out("p3-pc-o")}</section>
      <section><h4>Find item by shortcode</h4>
        ${inp("p3-sc", "Shortcode", "CB01")}<button id="p3-sc-b" class="btn" type="button">Look up</button>${out("p3-sc-o")}</section>
      <section><h4>Find a kitchen ticket</h4>
        ${inp("p3-kot", "KOT number", "KOT-101")}<button id="p3-kot-b" class="btn" type="button">Look up</button>${out("p3-kot-o")}</section>
      <section><h4>Moved-item slip</h4><p class="text-muted">Tells the kitchen an item moved tables; do not re-cook.</p>
        ${inp("p3-mf", "From table")}${inp("p3-mt", "To table")}${inp("p3-mr", "Reason", "Guest request")}
        <label class="p3-f"><span>Items (one per line, e.g. 2 Cappuccino)</span><textarea id="p3-mi" class="input" rows="3"></textarea></label>
        ${sel("p3-mw", ["80", "58"], "Paper width (mm)")}
        <button id="p3-mb" class="btn" type="button">Create slip</button>${out("p3-mo")}</section>
      <section><h4>Food-ready slip</h4>
        ${sel("p3-rs", STATIONS.filter((s) => s !== "ALL"), "Station")}${inp("p3-rt", "Table")}${inp("p3-ro", "Order ID")}
        <label class="p3-f"><span>Items (one per line)</span><textarea id="p3-ri" class="input" rows="3"></textarea></label>
        <button id="p3-rb" class="btn" type="button">Create slip</button>${out("p3-ro-o")}</section>
      ${canCorrect ? `<section><h4>Correct payment type</h4><p class="text-muted">Changes how a settled bill was paid. Totals and tax stay the same.</p>
        ${inp("p3-cb", "Bill ID", "BILL-…")}${sel("p3-co", TENDERS, "Was paid by")}${sel("p3-cn", TENDERS.slice().reverse(), "Should be")}${inp("p3-cr", "Reason (min 5 characters)")}
        <button id="p3-cbtn" class="btn" type="button">Apply correction</button>${out("p3-cout")}</section>` : ""}
    </div>`,
  });
  $("#p3-gc").onclick = () => openGiftCards();
  $("#p3-ao").onclick = () => openAdvanceOrders();
  $("#p3-pc").onclick = (e) => run(e.target, "#p3-pc-o", async () => {
    if (!cafeId) throw new Error("No café is selected for this terminal.");
    const r = await apiGet(`/hardware/unassigned-printers/${encodeURIComponent(cafeId)}`, { bypassCache: true });
    const d = r?.data || r || {};
    return d.hasAlert ? `Missing printer for: <strong>${esc((d.unassignedStations || []).join(", "))}</strong>` : `All stations covered. Online printers: ${esc(d.onlinePrintersCount ?? 0)}.`;
  });
  $("#p3-sc-b").onclick = (e) => run(e.target, "#p3-sc-o", async () => {
    const c = $("#p3-sc").value.trim(); if (!c) throw new Error("Enter a shortcode.");
    const d = (await apiGet(`/pos/items/shortcode/${encodeURIComponent(c)}`, { bypassCache: true }))?.data;
    if (!d) throw new Error(`No active item for "${c}".`);
    return `<strong>${esc(d.name)}</strong> · ${esc(d.shortcode || c.toUpperCase())} · ₹${((d.currentPricePaisa || 0) / 100).toFixed(2)} · ${esc(d.category || "")} · ${esc(d.status || "")}`;
  });
  $("#p3-kot-b").onclick = (e) => run(e.target, "#p3-kot-o", async () => {
    const n = $("#p3-kot").value.trim(); if (!n) throw new Error("Enter a KOT number.");
    const d = (await apiGet(`/hardware/kot/by-number/${encodeURIComponent(n)}`, { bypassCache: true }))?.data;
    if (!d) throw new Error(`KOT ${n} not found.`);
    return `<strong>${esc(d.kotNumber)}</strong> · ${esc(d.tableNumber || "—")} · ${esc(d.prepStation || "")} · <span class="badge">${esc(d.status)}</span><ul>${lines(d.lineItems)}</ul>`;
  });
  $("#p3-mb").onclick = (e) => run(e.target, "#p3-mo", async () => {
    const fromTable = $("#p3-mf").value.trim(), toTable = $("#p3-mt").value.trim();
    if (!fromTable || !toTable) throw new Error("Both tables are required.");
    const items = parseItems($("#p3-mi").value); if (!items.length) throw new Error("Add at least one item.");
    const r = await apiPost("/hardware/shifted-item", { fromTable, toTable, reason: $("#p3-mr").value.trim() || "Guest request", items, paperWidth: +$("#p3-mw").value });
    const d = r?.data || r || {};
    showToast("Moved-item slip created.", "success");
    return `Slip created (${esc(d.byteLength ?? d.length ?? "")} bytes). It says “${esc(d.watermark || "SHIFTED - DO NOT RE-COOK")}”.`;
  });
  $("#p3-rb").onclick = (e) => run(e.target, "#p3-ro-o", async () => {
    const tableNumber = $("#p3-rt").value.trim(), orderId = $("#p3-ro").value.trim();
    if (!tableNumber || !orderId) throw new Error("Table and order ID are required.");
    const items = parseItems($("#p3-ri").value); if (!items.length) throw new Error("Add at least one item.");
    await apiPost("/hardware/readiness-slip", { station: $("#p3-rs").value, tableNumber, orderId, items });
    showToast("Food-ready slip created.", "success");
    return "Food-ready slip created.";
  });
  if (canCorrect) $("#p3-cbtn").onclick = (e) => run(e.target, "#p3-cout", async () => {
    const id = $("#p3-cb").value.trim(), oldTender = $("#p3-co").value, newTender = $("#p3-cn").value, reason = $("#p3-cr").value.trim();
    if (!id) throw new Error("Enter the bill ID.");
    if (oldTender === newTender) throw new Error("Choose a different payment type.");
    if (reason.length < 5) throw new Error("Reason must be at least 5 characters.");
    if (!confirm(`Change ${id} from ${oldTender} to ${newTender}?`)) throw new Error("Cancelled. Nothing was changed.");
    await apiPost(`/pos/orders/${encodeURIComponent(id)}/tender-correction`, { oldTender, newTender, reason });
    showToast("Payment type corrected.", "success");
    return `Corrected ${esc(id)}: ${esc(oldTender)} → ${esc(newTender)}.`;
  });
}
