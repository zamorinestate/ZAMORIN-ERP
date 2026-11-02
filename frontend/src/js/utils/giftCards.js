// Phase 6 · Gift cards (F081 issue, F082 redeem and balance, F083 validation). Server does all checks.
//  POST /customers/gift-cards/issue · POST /customers/gift-cards/redeem · GET /customers/gift-cards/:id
import { openModal, showToast } from "../components.js";
import { apiGet, apiPost } from "../apiClient.js";
import { state } from "../state.js";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const inr = (p) => "₹" + ((p || 0) / 100).toLocaleString("en-IN", { minimumFractionDigits: 2 });
const $ = (s) => document.querySelector(s);
const field = (id, label, type = "text", extra = "") => `<label class="p3-f"><span>${label}</span><input id="${id}" class="input" type="${type}" ${extra}></label>`;

async function run(btn, outSel, fn) {
  const o = $(outSel); btn.disabled = true; o.className = "p3-out";
  try { o.innerHTML = await fn(); o.classList.add("ok"); } catch (e) { o.textContent = e?.message || "Request failed."; o.classList.add("err"); } finally { btn.disabled = false; }
}

export function openGiftCards() {
  const role = (state.auth?.user || state.user || {}).role;
  const canWrite = role === "MASTER" || role === "CAFE_ADMIN";
  openModal({
    title: "Gift cards", maxWidth: "620px", saveLabel: "Close", onSave: () => true,
    body: `<div class="p3-tools">
      <section><h4>Check a card</h4>${field("gc-id", "Card ID", "text", 'placeholder="GC-0014"')}
        <button id="gc-look" class="btn" type="button">Check balance</button><div id="gc-look-o" class="p3-out" role="status" aria-live="polite"></div></section>
      ${canWrite ? `<section><h4>Sell a new card</h4>${field("gc-amt", "Amount (INR)", "number", 'min="1" step="1"')}${field("gc-days", "Valid for (days)", "number", 'min="1" value="365"')}${field("gc-cust", "Buyer customer ID (optional)")}
        <button id="gc-issue" class="btn" type="button">Issue card</button><div id="gc-issue-o" class="p3-out" role="status" aria-live="polite"></div></section>
      <section><h4>Use a card</h4>${field("gc-rid", "Card ID")}${field("gc-sec", "Secret code (12 characters)", "password", 'autocomplete="off"')}${field("gc-ramt", "Amount to use (INR)", "number", 'min="0.01" step="0.01"')}${field("gc-bill", "Bill ID (optional)")}
        <button id="gc-redeem" class="btn" type="button">Use card</button><div id="gc-redeem-o" class="p3-out" role="status" aria-live="polite"></div></section>` : ""}
    </div>`,
  });
  $("#gc-look").onclick = (e) => run(e.target, "#gc-look-o", async () => {
    const id = $("#gc-id").value.trim(); if (!id) throw new Error("Enter the card ID.");
    const r = await apiGet(`/customers/gift-cards/${encodeURIComponent(id)}`, { bypassCache: true });
    const d = r?.data || r; if (!d || (!d.giftCardId && !d.cardNumber)) throw new Error("Card not found.");
    const bal = d.currentBalancePaise ?? d.balancePaise;
    const hist = (d.redemptionHistory || []).slice(-5).map((h) => `<li>${esc((h.redeemedAt || "").slice(0, 10))} · ${inr(h.amountPaise)} · left ${inr(h.balanceAfterPaise)}</li>`).join("");
    return `<strong>${esc(d.cardNumber || d.giftCardId)}</strong> · <span class="badge">${esc(d.status)}</span><br>Balance ${inr(bal)}${d.expiresAt ? ` · expires ${esc(String(d.expiresAt).slice(0, 10))}` : ""}${hist ? `<ul>${hist}</ul>` : ""}`;
  });
  if (!canWrite) return;
  $("#gc-issue").onclick = (e) => run(e.target, "#gc-issue-o", async () => {
    const rupees = Number($("#gc-amt").value); if (!(rupees >= 1)) throw new Error("Enter an amount of at least ₹1.");
    const body = { amountPaise: Math.round(rupees * 100), validityDays: Number($("#gc-days").value) || 365 };
    const c = $("#gc-cust").value.trim(); if (c) body.purchasedByCustomerId = c;
    const r = await apiPost("/customers/gift-cards/issue", body); const d = r?.data || r;
    showToast("Gift card issued.", "success");
    return `Issued <strong>${esc(d.giftCardId)}</strong> (${esc(d.cardNumber)}) for ${inr(d.balancePaise)}.<br>Secret code: <strong class="mono">${esc(d.secretCode)}</strong><br><em>Give this to the buyer now. It is shown only once and cannot be looked up again.</em>`;
  });
  $("#gc-redeem").onclick = (e) => run(e.target, "#gc-redeem-o", async () => {
    const giftCardId = $("#gc-rid").value.trim(), secretCode = $("#gc-sec").value.trim(), rupees = Number($("#gc-ramt").value);
    if (!giftCardId || !secretCode) throw new Error("Card ID and secret code are required.");
    if (!(rupees > 0)) throw new Error("Enter an amount above zero.");
    const body = { giftCardId, secretCode, amountPaise: Math.round(rupees * 100) };
    const b = $("#gc-bill").value.trim(); if (b) body.billId = b;
    const r = await apiPost("/customers/gift-cards/redeem", body); const d = r?.data || r;
    $("#gc-sec").value = "";
    showToast("Gift card used.", "success");
    return `Used ${inr(d.amountRedeemedPaise)}. Remaining ${inr(d.remainingBalancePaise)} · ${esc(d.status)}.`;
  });
}
