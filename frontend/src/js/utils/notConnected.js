// "Not connected" capabilities: backend support does not exist yet (Phase 2 audit, not_found_list.md).
// Shown as an informational card; nothing here saves or simulates data.
export const NOT_CONNECTED = {
  reports: [
    { id: "F221", name: "Ask questions about your data in plain English", note: "No question-answering service exists yet." },
    { id: "F222", name: "Chain-level AI questions", note: "No AI assistant is connected." },
    { id: "F100-saved", name: "File download for saved report views", note: "Saved views can be checked, but a downloadable file is not connected." },
  ],
  menu: [
    { id: "F005", name: "Item picture upload", note: "Items hold an image link only; there is no upload route yet." },
    { id: "F006", name: "Image download to POS terminals", note: "Offline image cache is not available." },
    { id: "F056", name: "Category pictures", note: "Categories do not support pictures yet." },
    { id: "F058", name: "Bill-total threshold promotions", note: "Automatic promotions on bill value are not available." },
    { id: "F051", name: "Dining-area sequence from a sheet", note: "Area order cannot be set by spreadsheet yet." },
    { id: "A112", name: "Area-specific recipe extras", note: "Recipes are defined once per item, not per dining area." },
    { id: "F137", name: "Finished-item daily quantity register", note: "No screen route exists for it yet." },
    { id: "A040", name: "Add-on mapping sheet", note: "Download and upload are not connected; nothing is applied." },
  ],
  inventory: [
    { id: "F167", name: "Monthly batch-code change lock", note: "Static prefix mode is active. The monthly lock has no backend yet." },
    { id: "F175", name: "Add-on-only wastage", note: "Wastage is recorded against an item or a dish only." },
  ],
  procurement: [
    { id: "F144", name: "Custom supplier-payment types", note: "Standard payment modes only (Cash, Bank transfer, Cheque, UPI)." },
    { id: "F145", name: "Cross-outlet fallback supplier", note: "Reassign suppliers manually; fallback works inside approved substitutes." },
    { id: "F161", name: "External market-price comparison", note: "Contract rates are active; live market prices are not available." },
  ],
  vendors: [
    { id: "F144", name: "Custom supplier-payment types", note: "Standard payment modes only (Cash, Bank transfer, Cheque, UPI)." },
    { id: "F145", name: "Cross-outlet fallback supplier", note: "Reassign suppliers manually; fallback works inside approved substitutes." },
  ],
  "cafe-ops-devices": [
    { id: "F180", name: "Custom label fields (8 user fields)", note: "Standard format (FSSAI, batch, item, date) is active." },
    { id: "F182", name: "Bulk label printing from a spreadsheet", note: "Single prep-label printing only." },
  ],
};
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
export function notConnectedCard(route) {
  const list = NOT_CONNECTED[route];
  if (!list?.length) return "";
  return `<section class="acc nc-card" data-nc="${esc(route)}" aria-label="Capabilities not connected yet"><details>
    <summary>Not connected yet <span class="badge badge-proposed">${list.length} capabilities</span></summary>
    <div class="acc-body"><ul class="list">${list.map((x) => `<li><div class="grow"><b>${esc(x.name)}</b><span>${esc(x.note)}</span></div><span class="badge">Not connected</span></li>`).join("")}</ul></div>
  </details></section>`;
}
let _o = null;
function routeOf() { return (location.hash || "").replace(/^#\/?/, "").split(/[/?]/)[0]; }
function mount() {
  const host = document.getElementById("page-content");
  if (!host) return;
  const route = routeOf();
  const existing = host.querySelector(":scope > .nc-card");
  if (existing && existing.dataset.nc === route) return;
  existing?.remove();
  const html = notConnectedCard(route);
  if (html && host.children.length) host.insertAdjacentHTML("beforeend", html);
}
export function startNotConnected() {
  if (_o || typeof MutationObserver === "undefined") return;
  const app = document.getElementById("app"); if (!app) return;
  let t = 0;
  _o = new MutationObserver(() => { clearTimeout(t); t = setTimeout(mount, 80); });
  _o.observe(app, { childList: true, subtree: true });
  window.addEventListener("hashchange", () => { clearTimeout(t); t = setTimeout(mount, 150); });
}
