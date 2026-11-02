// =============================================================================
// Procurement — Phase 2 tabs wired to existing backend endpoints (no backend changes)
//   • Supplier Matrix : GET /procurement/supplier-matrix/export, POST /procurement/supplier-matrix/import (A093–A095)
//   • Landed Cost     : POST /procurement/orders/:id/landed-cost/distribute (F147, F148)
// Write roles: MASTER, CAFE_ADMIN. OWNER may view the matrix. Imports are .xlsx only.
// =============================================================================
import { apiGet, apiPost } from "../apiClient.js";
import { state } from "../state.js";
import { showToast } from "../components.js";
import { stateBlock, paginate, renderPager, wirePager, getPageSize } from "../utils/zui.js";
import { readXlsx } from "../utils/xlsxRead.js";
import { exportTable } from "../utils/exportFile.js";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const canWrite = () => ["MASTER", "CAFE_ADMIN"].includes(state.user?.role);
const unwrap = (r) => r?.data ?? r ?? {};
const inr = (p) => (Number.isFinite(Number(p)) ? "₹" + (Number(p) / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—");
const roBanner = `<div class="readonly-banner" role="note">Read-only: your role can view this screen but cannot change it. The server enforces this too.</div>`;
const reasonBtn = (label, why) => `<span class="tt"><button class="btn btn-secondary" type="button" aria-disabled="true">${esc(label)}</button><span class="tt-bubble" role="tooltip">${esc(why)}</span></span>`;

/* ----------------------------- SUPPLIER MATRIX ----------------------------- */
const MATRIX_COLS = [
  { key: "itemId", label: "itemId" }, { key: "itemName", label: "itemName" }, { key: "category", label: "category" }, { key: "baseUnit", label: "baseUnit" },
  { key: "packSize", label: "packSize", type: "number" }, { key: "primaryVendorId", label: "primaryVendorId" }, { key: "primaryVendorName", label: "primaryVendorName" },
  { key: "contractCostRupees", label: "contractCostRupees", type: "number" }, { key: "vendorItemCode", label: "vendorItemCode" }, { key: "secondaryVendors", label: "secondaryVendors" },
];
const IMPORT_FIELDS = ["itemId", "primaryVendorId", "contractCostRupees", "packSize", "vendorItemCode"];

/** Client-side checks that mirror the server rules; the server stays authoritative. */
export function validateMappings(rows) {
  const seen = new Set(), errors = [], mappings = [];
  rows.forEach((r, i) => {
    const n = i + 2, itemId = String(r.itemId ?? "").trim(), errs = [];
    if (!itemId) errs.push("itemId is required");
    else if (seen.has(itemId)) errs.push("duplicate itemId in file"); else seen.add(itemId);
    const pack = r.packSize === "" || r.packSize == null ? null : Number(r.packSize);
    if (pack !== null && !(pack > 0)) errs.push("pack size must be a positive number");
    const cost = r.contractCostRupees === "" || r.contractCostRupees == null ? null : Number(r.contractCostRupees);
    if (cost !== null && !(cost >= 0)) errs.push("contract cost must be zero or more");
    for (const f of ["itemId", "primaryVendorId", "vendorItemCode"]) if (/^[=+\-@\t\r]/.test(String(r[f] ?? ""))) errs.push(`${f} starts with a formula character`);
    if (errs.length) errors.push({ row: n, message: errs.join("; ") });
    else mappings.push({ itemId, ...(r.primaryVendorId ? { primaryVendorId: String(r.primaryVendorId).trim() } : {}), ...(cost !== null ? { contractCostRupees: cost } : {}), ...(pack !== null ? { packSize: pack } : {}), ...(r.vendorItemCode ? { vendorItemCode: String(r.vendorItemCode).trim() } : {}) });
  });
  return { mappings, errors };
}

export async function renderSupplierMatrixTab(container) {
  let matrix = [], page = 1, loaded = false, pending = null;
  container.innerHTML = `<div style="display:flex;flex-direction:column;gap:16px;">
    ${canWrite() ? "" : roBanner}
    <div class="card"><div class="card-head"><div><h2>Supplier-to-material matrix</h2><p>One primary supplier, contract cost, pack size and supplier item code for each material.</p></div>
      <div class="page-actions"><button id="sm-reload" class="btn btn-secondary btn-sm" type="button">Reload</button><button id="sm-export" class="btn btn-secondary btn-sm" type="button" disabled>Download .xlsx</button></div></div>
      <div id="sm-table" class="table-wrap"><div role="status" class="sk sk-stack" style="padding:20px"><div class="sk-bar sk-w60"></div><div class="sk-bar sk-w80"></div><span class="sr-only">Loading</span></div></div><div id="sm-pager"></div></div>
    <div class="card"><div class="card-head"><div><h2>Import from Excel</h2><p>Upload a .xlsx with a header row: ${IMPORT_FIELDS.join(", ")}. The checks below run before anything is sent.</p></div></div>
      <div class="card-body"><div class="dropzone"><input id="sm-file" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" aria-label="Upload supplier matrix workbook (.xlsx)" ${canWrite() ? "" : "disabled"}><div id="sm-file-status" class="hint" role="status">${canWrite() ? "No file chosen." : "Importing needs Primary Master or Café Operations."}</div></div>
      <div id="sm-preview" style="margin-top:16px"></div></div>
      <div class="card-foot">${canWrite() ? `<button id="sm-apply" class="btn btn-primary" type="button" disabled>Apply to matrix</button>` : reasonBtn("Apply to matrix", "Only Primary Master and Café Operations can import.")}</div></div></div>`;
  const tbl = container.querySelector("#sm-table"), pager = container.querySelector("#sm-pager"), exportBtn = container.querySelector("#sm-export");
  function draw() {
    if (!loaded) return;
    if (!matrix.length) { tbl.innerHTML = stateBlock("empty", "No mappings yet", "Import a workbook to create the first mappings."); pager.innerHTML = ""; return; }
    const key = "supplier-matrix", m = paginate(matrix, page, getPageSize(key)); page = m.page;
    tbl.innerHTML = `<table class="table" data-nopage><thead><tr><th>Material</th><th>Category</th><th>Unit</th><th class="r">Pack size</th><th>Primary supplier</th><th class="r">Contract cost</th><th>Supplier code</th></tr></thead><tbody>${m.rows.map((r) => `<tr><td><b>${esc(r.itemName || r.itemId)}</b><div class="hint mono">${esc(r.itemId)}</div></td><td>${esc(r.category)}</td><td>${esc(r.baseUnit)}</td><td class="r">${esc(r.packSize ?? "—")}</td><td>${esc(r.primaryVendorName || r.primaryVendorId || "Not set")}</td><td class="r">${r.contractCostRupees === "" || r.contractCostRupees == null ? "—" : "₹" + Number(r.contractCostRupees).toLocaleString("en-IN", { minimumFractionDigits: 2 })}</td><td class="mono">${esc(r.vendorItemCode || "—")}</td></tr>`).join("")}</tbody></table>`;
    pager.innerHTML = renderPager(m, key);
    wirePager(pager, key, ({ page: p }) => { page = p; draw(); });
  }
  async function load() {
    loaded = false; exportBtn.disabled = true;
    try { const r = unwrap(await apiGet("/procurement/supplier-matrix/export", { bypassCache: true })); matrix = r.matrix || []; loaded = true; exportBtn.disabled = !matrix.length; draw(); }
    catch (e) { tbl.innerHTML = stateBlock("error", "The matrix could not be loaded", e.message || "Try again.", [{ label: "Retry", id: "sm-retry" }]); tbl.querySelector("#sm-retry")?.addEventListener("click", load); pager.innerHTML = ""; }
  }
  container.querySelector("#sm-reload").addEventListener("click", load);
  exportBtn.addEventListener("click", () => exportTable({ format: "xlsx", title: "Supplier matrix", filename: `supplier_matrix_${new Date().toISOString().slice(0, 10)}`, columns: MATRIX_COLS, rows: matrix }));
  const status = container.querySelector("#sm-file-status"), prev = container.querySelector("#sm-preview"), apply = container.querySelector("#sm-apply");
  container.querySelector("#sm-file")?.addEventListener("change", async (ev) => {
    const f = ev.target.files?.[0]; pending = null; if (apply) apply.disabled = true; prev.innerHTML = "";
    if (!f) return;
    if (!/\.xlsx$/i.test(f.name)) { status.textContent = "Only .xlsx workbooks are accepted."; ev.target.value = ""; return; }
    try {
      const { headers, rows } = await readXlsx(f);
      if (!headers.includes("itemId")) { status.textContent = "The first row must contain an itemId column."; return; }
      const { mappings, errors } = validateMappings(rows);
      status.textContent = `${f.name}: ${rows.length} rows read, ${mappings.length} valid, ${errors.length} with problems.`;
      prev.innerHTML = `${errors.length ? `<div class="alert alert-err" role="alert"><div><b>${errors.length} row${errors.length > 1 ? "s" : ""} need fixing.</b> Nothing will be sent until the file is clean.<ul>${errors.slice(0, 20).map((e) => `<li>Row ${e.row}: ${esc(e.message)}</li>`).join("")}</ul>${errors.length > 20 ? `<div class="hint">and ${errors.length - 20} more.</div>` : ""}</div></div>` : `<div class="alert alert-ok"><div><b>All ${mappings.length} rows passed the checks.</b> The server validates again when you apply.</div></div>`}`;
      if (!errors.length && mappings.length) { pending = mappings; if (apply) apply.disabled = false; }
    } catch (e) { status.textContent = e.message || "The workbook could not be read."; }
  });
  apply?.addEventListener("click", async () => {
    if (!pending?.length) return;
    apply.disabled = true; apply.textContent = "Applying...";
    try {
      const r = unwrap(await apiPost("/procurement/supplier-matrix/import", { mappings: pending }));
      showToast(`Matrix updated: ${r.updatedCount ?? pending.length} of ${r.totalProcessed ?? pending.length} rows.`, "success");
      pending = null; prev.innerHTML = ""; status.textContent = "Import complete."; container.querySelector("#sm-file").value = ""; await load();
    } catch (e) { showToast(e.message || "The import was rejected.", "error"); prev.innerHTML = `<div class="alert alert-err" role="alert"><div><b>The server rejected the import.</b> ${esc(e.message || "")}</div></div>`; apply.disabled = false; }
    finally { apply.textContent = "Apply to matrix"; }
  });
  await load();
}

/* ------------------------------- LANDED COST ------------------------------- */
const rupeesToPaise = (v) => Math.round(Number(String(v).replace(/,/g, "")) * 100);
export function renderLandedCostTab(container) {
  container.innerHTML = `<div style="display:flex;flex-direction:column;gap:16px;">${canWrite() ? "" : roBanner}
    <form id="lc-form" class="card" novalidate><div class="card-head"><div><h2>Distribute additional charges</h2><p>Spread freight, insurance, packaging and other costs across the lines of a purchase order.</p></div></div>
      <div class="card-body"><div class="form-grid">
        <div class="field"><label class="label" for="lc-po">Purchase order ID</label><input id="lc-po" class="input" maxlength="50" style="text-transform:uppercase" ${canWrite() ? "" : "disabled"}><span id="lc-po-e" class="error-text" role="alert"></span></div>
        <div class="field"><label class="label" for="lc-method">Distribute by</label><select id="lc-method" class="select" ${canWrite() ? "" : "disabled"}><option value="VALUE">Line value (percentage share)</option><option value="QUANTITY">Quantity (equal per unit)</option></select></div>
        ${[["freight", "Freight"], ["insurance", "Insurance"], ["packaging", "Packaging"], ["other", "Other"]].map(([k, l]) => `<div class="field"><label class="label" for="lc-${k}">${l} (₹)</label><input id="lc-${k}" class="input num" type="number" min="0" step="0.01" inputmode="decimal" placeholder="0.00" ${canWrite() ? "" : "disabled"}></div>`).join("")}
      </div><span id="lc-e" class="error-text" role="alert"></span></div>
      <div class="card-foot">${canWrite() ? `<button id="lc-go" class="btn btn-primary" type="submit">Distribute charges</button>` : reasonBtn("Distribute charges", "Only Primary Master and Café Operations can change landed cost.")}</div></form>
    <div class="card"><div class="card-head"><h2>Result</h2></div><div id="lc-result" class="card-body">${stateBlock("empty", "No result yet", "Enter a purchase order and the charges to see each line's landed cost.")}</div></div></div>`;
  const form = container.querySelector("#lc-form"), res = container.querySelector("#lc-result");
  form.addEventListener("submit", async (e) => {
    e.preventDefault(); if (!canWrite()) return;
    const po = form.querySelector("#lc-po").value.trim().toUpperCase(), pe = form.querySelector("#lc-po-e"), ge = form.querySelector("#lc-e"); pe.textContent = ""; ge.textContent = "";
    const amt = {}; let total = 0, bad = false;
    for (const k of ["freight", "insurance", "packaging", "other"]) { const raw = form.querySelector(`#lc-${k}`).value; const p = raw === "" ? 0 : rupeesToPaise(raw); if (!Number.isFinite(p) || p < 0) { bad = true; } amt[`${k}Paisa`] = p; total += p; }
    if (!po) { pe.textContent = "Purchase order ID is required."; return; }
    if (bad) { ge.textContent = "Charges must be zero or more."; return; }
    if (total <= 0) { ge.textContent = "Enter at least one charge greater than zero."; return; }
    const btn = form.querySelector("#lc-go"); btn.disabled = true; btn.textContent = "Distributing...";
    try {
      const r = unwrap(await apiPost(`/procurement/orders/${encodeURIComponent(po)}/landed-cost/distribute`, { additionalCharges: amt, distributionMethod: form.querySelector("#lc-method").value }));
      const lines = r.lineItems || [];
      res.innerHTML = `<dl class="kv" style="margin-bottom:16px"><dt>Total additional</dt><dd>${inr(r.totalAdditionalPaisa)}</dd><dt>Method</dt><dd>${esc(r.distributionMethod)}</dd></dl>
        <div class="table-wrap"><table class="table" data-nopage><thead><tr><th>Material</th><th class="r">Quantity</th><th class="r">Unit price</th><th class="r">Line total</th><th class="r">Allocated</th><th class="r">Landed total</th><th class="r">Landed unit cost</th></tr></thead><tbody>${lines.map((l) => `<tr><td class="mono">${esc(l.itemId)}</td><td class="r">${esc(l.orderedQuantityBase ?? "—")}</td><td class="r">${inr(l.unitPricePaisa)}</td><td class="r">${inr(l.totalLinePaisa)}</td><td class="r">${inr(l.allocatedLandedPaisa)}</td><td class="r">${inr(l.landedTotalPaisa)}</td><td class="r">${inr(l.landedUnitCostPaisa)}</td></tr>`).join("")}</tbody></table></div>`;
      showToast(`Landed cost distributed for ${po}.`, "success");
    } catch (er) {
      if (er?.code === "ORDER_NOT_FOUND" || er?.status === 404) pe.textContent = er.message || "Purchase order not found.";
      else showToast(er.message || "The charges could not be distributed.", "error");
    } finally { btn.disabled = false; btn.textContent = "Distribute charges"; }
  });
}
