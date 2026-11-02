// Design-system replacements for the browser's alert / prompt / confirm.
//  askText / askConfirm return Promises (use with await). notify() is a non-blocking message.
import { openModal, showToast } from "../components.js";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

export function askText({ title = "Enter a value", label = "", value = "", type = "text", placeholder = "", required = true, min, step, okLabel = "OK", validate } = {}) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    openModal({
      title: esc(title), saveLabel: okLabel, maxWidth: "420px",
      body: `<label class="p3-f" for="dlg-in"><span>${esc(label)}</span><input id="dlg-in" class="input" type="${type}" value="${esc(value)}" placeholder="${esc(placeholder)}"${min != null ? ` min="${min}"` : ""}${step ? ` step="${step}"` : ""}></label><div id="dlg-err" role="alert" style="color:var(--err);font-size:12px;min-height:16px"></div>`,
      onSave: () => {
        const v = document.querySelector("#dlg-in")?.value.trim() ?? "";
        const err = (required && !v) ? "This field is required." : (validate ? validate(v) : "");
        if (err) { document.querySelector("#dlg-err").textContent = err; return false; }
        finish(v); return true;
      },
      onCancel: () => finish(null),
    });
    setTimeout(() => document.querySelector("#dlg-in")?.focus(), 50);
    // closing with the X or backdrop also cancels
    const t = setInterval(() => { if (!document.querySelector("#dlg-in")) { clearInterval(t); finish(null); } }, 200);
  });
}

export function askConfirm({ title = "Please confirm", message = "", okLabel = "Confirm", danger = false } = {}) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    openModal({
      title: esc(title), saveLabel: okLabel, maxWidth: "420px",
      body: `<p style="margin:0;${danger ? "color:var(--err);" : ""}">${esc(message)}</p>`,
      onSave: () => { finish(true); return true; },
      onCancel: () => finish(false),
    });
    const t = setInterval(() => { if (!document.querySelector("[data-modal-save]")) { clearInterval(t); finish(false); } }, 200);
  });
}

export function notify(message, type = "info") { showToast(String(message), type); }

// Blocking alert() cannot be awaited, so it becomes a toast (same message, no browser pop-up).
export function installAlertShim() {
  if (window.__alertShim) return; window.__alertShim = true;
  window.alert = (m) => showToast(String(m ?? ""), /fail|error|not |could not|cannot|invalid/i.test(String(m)) ? "error" : "info");
}

// Visible banner for "this page could not load real data". Replaces silent zero or sample fallbacks.
export function showDataError(host, message) {
  if (!host) { showToast(String(message || "Data could not be loaded."), "error"); return; }
  host.querySelectorAll?.(":scope > .data-error-banner").forEach((n) => n.remove());
  const d = document.createElement("div");
  d.className = "data-error-banner"; d.setAttribute("role", "alert");
  d.style.cssText = "margin:0 0 12px;padding:10px 12px;border:1px solid var(--err);border-radius:10px;color:var(--err);font-size:13px;background:var(--err-soft)";
  d.textContent = `This page could not load live data (${String(message || "request failed").slice(0, 160)}). The figures shown are not real.`;
  host.insertAdjacentElement("afterbegin", d);
}
