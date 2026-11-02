// Phase 3 · POS front-of-house helpers (frontend only, no backend calls).
//  F013 persistent operations shortcuts · F014 shortcut help sheet · F010 preset cooking notes.
// Presets are a terminal-local preference stored in localStorage; they are not sent anywhere
// until the cashier applies one to a line note (which the existing order flow already submits).
import { openModal, showToast } from "../components.js";
import { openPosTools } from "./posTools.js";
import { openGiftCards } from "./giftCards.js";

const KEY = "zamorin-pos-note-presets";
const DEFAULTS = ["Less sugar", "No sugar", "Extra hot", "Less ice", "Oat milk", "Extra shot", "Pack separately"];
const SHORTCUTS = [
  ["F1 or ?", "Show this shortcut sheet"],
  ["F2 or Ctrl+K", "Focus menu search"],
  ["F4", "Toggle on-screen numpad"],
  ["F8", "Add open (custom-price) item"],
  ["Enter in search", "Look up barcode, KOT# or item code"],
  ["F9", "Kitchen & bill tools"],
  ["Esc", "Close the open dialog"],
];
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

export function getPresets() {
  try { const v = JSON.parse(localStorage.getItem(KEY)); if (Array.isArray(v) && v.length) return v.slice(0, 20); } catch {}
  return [...DEFAULTS];
}
function savePresets(list) { try { localStorage.setItem(KEY, JSON.stringify(list.slice(0, 20))); return true; } catch { return false; } }

export function openShortcutSheet() {
  openModal({
    title: "Keyboard shortcuts",
    body: `<table class="table" aria-label="POS keyboard shortcuts"><tbody>${SHORTCUTS.map(([k, d]) =>
      `<tr><td style="white-space:nowrap"><kbd class="mono">${esc(k)}</kbd></td><td>${esc(d)}</td></tr>`).join("")}</tbody></table>
      <p class="text-muted" style="font-size:12px;margin-top:10px">Shortcuts work on the POS screen only and never run while you are typing in a field.</p>`,
    saveLabel: "Close", onSave: () => true, maxWidth: "460px",
  });
}

function openPresetManager() {
  let list = getPresets();
  openModal({
    title: "Preset cooking notes",
    body: `<p class="text-muted" style="font-size:12px">One note per line, up to 20. Saved on this terminal only.</p>
      <textarea id="p3-presets" class="input" rows="9" style="width:100%" aria-label="Preset notes">${esc(list.join("\n"))}</textarea>`,
    saveLabel: "Save presets",
    onSave: () => {
      const next = (document.querySelector("#p3-presets")?.value || "").split("\n").map((s) => s.trim().slice(0, 60)).filter(Boolean);
      if (!next.length) { showToast("Add at least one note.", "error"); return false; }
      if (!savePresets(next)) { showToast("This browser blocked saving. Presets were not saved.", "error"); return false; }
      showToast("Presets saved on this terminal.", "success");
      return true;
    },
  });
}

function enhanceNoteField(input) {
  if (!input || input.dataset.p3 || !input.parentElement) return;
  input.dataset.p3 = "1";
  const bar = document.createElement("div");
  bar.className = "p3-presets";
  bar.setAttribute("role", "group");
  bar.setAttribute("aria-label", "Preset notes");
  bar.innerHTML = getPresets().map((p) => `<button type="button" class="p3-chip" data-p="${esc(p)}">${esc(p)}</button>`).join("") +
    `<button type="button" class="p3-chip p3-chip-edit" data-manage="1">Edit presets</button>`;
  bar.addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b) return;
    if (b.dataset.manage) return openPresetManager();
    const cur = input.value.trim();
    if (cur.split(/,\s*/).includes(b.dataset.p)) return;
    input.value = cur ? `${cur}, ${b.dataset.p}` : b.dataset.p;
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  input.insertAdjacentElement("afterend", bar);
}

function onKey(e) {
  const root = document.querySelector("#pos-menu-search");
  if (!root) return; // not on the POS screen
  const tag = (e.target.tagName || "").toLowerCase();
  const typing = tag === "input" || tag === "textarea" || tag === "select" || e.target.isContentEditable;
  if (e.key === "F1" || (e.key === "?" && !typing)) { e.preventDefault(); openShortcutSheet(); return; }
  if (e.key === "F2" || (e.ctrlKey && e.key.toLowerCase() === "k")) { e.preventDefault(); root.focus(); return; }
  if (typing || document.querySelector(".modal-backdrop.open")) return;
  if (e.key === "F4") { e.preventDefault(); document.querySelector("#pos-numpad-toggle-btn")?.click(); }
  else if (e.key === "F9") { e.preventDefault(); openPosTools(); }
  else if (e.key === "F8") { e.preventDefault(); document.querySelector("#open-item-btn")?.click(); }
}

export function startPosPhase3() {
  if (window.__posP3) return; window.__posP3 = true;
  window.addEventListener("keydown", onKey);
  const scan = () => {
    if (document.querySelector("#app.auth-screen")) return;
    enhanceNoteField(document.querySelector("#mod-notes-input"));
    enhanceNoteField(document.querySelector("#open-item-notes"));
    // Customers page: gift-card button next to the page title
    if (/^#\/?customers/.test(location.hash) && !document.querySelector("#p6-gc-btn")) {
      const h1 = document.querySelector("#page-content h1");
      if (h1) {
        const g = document.createElement("button");
        g.id = "p6-gc-btn"; g.type = "button"; g.className = "btn btn-sm btn-secondary"; g.textContent = "Gift cards"; g.style.marginLeft = "12px";
        g.addEventListener("click", openGiftCards); h1.insertAdjacentElement("afterend", g);
      }
    }
    const bar = document.querySelector("#pos-numpad-toggle-btn");
    if (bar && !document.querySelector("#p3-help-btn")) {
      const h = document.createElement("button");
      h.id = "p3-help-btn"; h.type = "button"; h.className = bar.className;
      h.title = "Keyboard shortcuts (F1)"; h.setAttribute("aria-label", "Keyboard shortcuts");
      h.style.cssText = "padding:6px 10px;font-size:12px;"; h.textContent = "Shortcuts";
      h.addEventListener("click", openShortcutSheet);
      bar.insertAdjacentElement("afterend", h);
      const k = h.cloneNode(); k.id = "p3-tools-btn"; k.title = "Kitchen & bill tools (F9)"; k.textContent = "Kitchen tools"; k.addEventListener("click", openPosTools);
      h.insertAdjacentElement("afterend", k);
    }
  };
  scan();
  new MutationObserver(scan).observe(document.body, { childList: true, subtree: true });
}
