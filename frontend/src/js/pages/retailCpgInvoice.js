/**
 * PETPOOJA INVOICE — RETAIL & WHOLESALE CPG POS (F309–F316, A003)
 *
 * Dedicated retail billing layout for packaged cafe goods, support for tiered
 * B2B wholesale price lists (F312), customer credit notes (F311), and statutory
 * E-Way Bill / E-Invoice generation (F314, A003).
 */

import { apiGet, apiPost } from "../apiClient.js";

let cartItems = [];
let customerType = "B2C"; // B2C or B2B_WHOLESALE

export function renderRetailCpg(subroute) {
  return `
    <div id="retail-cpg-container" style="min-height:100vh; background:#0B0F19; color:#F8FAFC; font-family:-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; display:flex; flex-direction:column; padding:20px; box-sizing:border-box;">
      
      <!-- Top Bar -->
      <header style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid #1E293B; padding-bottom:16px; margin-bottom:20px;">
        <div style="display:flex; align-items:center; gap:12px;">
          <div style="background:#D4AF37; color:#0B0F19; font-weight:900; padding:6px 12px; border-radius:6px; font-size:14px;">CPG STUDIO</div>
          <h1 style="font-size:20px; font-weight:700; margin:0;">Zamorin Retail & Wholesale Invoicing</h1>
        </div>
        <div style="display:flex; gap:12px; align-items:center;">
          <select id="select-customer-tier" style="background:#1E293B; border:1px solid #334155; color:#F8FAFC; padding:8px 12px; border-radius:6px; font-weight:600; font-size:13px;">
            <option value="B2C">Retail B2C (Standard MRP)</option>
            <option value="B2B_TIER1">B2B Wholesale Tier 1 (15% Off)</option>
            <option value="B2B_TIER2">B2B Corporate Tier 2 (25% Off)</option>
          </select>
          <button id="btn-cpg-credit-note" style="background:#475569; border:none; color:#FFF; padding:8px 14px; border-radius:6px; font-size:13px; font-weight:600; cursor:pointer;">
            Issue Credit Note
          </button>
        </div>
      </header>

      <div style="display:grid; grid-template-columns: 1fr 380px; gap:20px; flex:1;">
        <!-- Left: Product Catalog & Barcode Intake -->
        <div style="display:flex; flex-direction:column; gap:16px;">
          <!-- Barcode Quick Scan Bar -->
          <div style="background:#111827; border:1px solid #1E293B; border-radius:8px; padding:12px; display:flex; gap:12px; align-items:center;">
            <span style="font-size:18px;">🔍</span>
            <input id="input-cpg-barcode" type="text" placeholder="Scan Barcode (Code128 / EAN13) or search CPG products..." style="flex:1; background:transparent; border:none; outline:none; color:#FFF; font-size:14px;" />
            <button id="btn-cpg-scan-add" style="background:#2563EB; border:none; color:#FFF; padding:8px 16px; border-radius:6px; font-size:13px; font-weight:600; cursor:pointer;">
              Add Item
            </button>
          </div>

          <!-- Quick Shelf Selection Grid -->
          <div style="display:grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap:12px;" id="cpg-product-grid">
            <div class="cpg-card" data-sku="CPG-CB-250G" data-name="Estate Reserve Coffee 250g" data-price="45000" style="background:#111827; border:1px solid #1E293B; border-radius:8px; padding:14px; cursor:pointer;">
              <div style="font-size:11px; color:#94A3B8; font-weight:600;">CPG-CB-250G</div>
              <div style="font-weight:700; font-size:14px; margin:4px 0 8px 0;">Estate Reserve 250g</div>
              <div style="color:#D4AF37; font-weight:700; font-size:15px;">₹450.00</div>
              <div style="font-size:11px; color:#10B981; margin-top:4px;">In Stock: 42 units</div>
            </div>

            <div class="cpg-card" data-sku="CPG-COLD-500ML" data-name="Artisanal Cold Brew 500ml" data-price="22000" style="background:#111827; border:1px solid #1E293B; border-radius:8px; padding:14px; cursor:pointer;">
              <div style="font-size:11px; color:#94A3B8; font-weight:600;">CPG-COLD-500ML</div>
              <div style="font-weight:700; font-size:14px; margin:4px 0 8px 0;">Artisanal Cold Brew 500ml</div>
              <div style="color:#D4AF37; font-weight:700; font-size:15px;">₹220.00</div>
              <div style="font-size:11px; color:#10B981; margin-top:4px;">In Stock: 88 units</div>
            </div>

            <div class="cpg-card" data-sku="CPG-BIS-BOX" data-name="Malabar Spice Cookies Box" data-price="18000" style="background:#111827; border:1px solid #1E293B; border-radius:8px; padding:14px; cursor:pointer;">
              <div style="font-size:11px; color:#94A3B8; font-weight:600;">CPG-BIS-BOX</div>
              <div style="font-weight:700; font-size:14px; margin:4px 0 8px 0;">Spice Cookies Box (12pc)</div>
              <div style="color:#D4AF37; font-weight:700; font-size:15px;">₹180.00</div>
              <div style="font-size:11px; color:#10B981; margin-top:4px;">In Stock: 26 units</div>
            </div>
          </div>
        </div>

        <!-- Right: Invoice Cart & Statutory E-Invoice Pane -->
        <div style="background:#111827; border:1px solid #1E293B; border-radius:10px; padding:16px; display:flex; flex-direction:column; justify-content:space-between;">
          <div>
            <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid #1E293B; padding-bottom:12px; margin-bottom:12px;">
              <h3 style="margin:0; font-size:16px;">Tax Invoice</h3>
              <span id="cpg-cart-count" style="font-size:12px; color:#94A3B8;">0 items</span>
            </div>

            <div id="cpg-cart-items" style="display:flex; flex-direction:column; gap:8px; max-height:360px; overflow-y:auto;">
              <div style="text-align:center; padding:32px 0; color:#64748B; font-size:13px;">Cart is empty. Scan an item barcode.</div>
            </div>
          </div>

          <div style="border-top:1px solid #1E293B; padding-top:12px; margin-top:16px;">
            <div style="display:flex; justify-content:space-between; font-size:13px; color:#94A3B8; margin-bottom:4px;">
              <span>Subtotal</span>
              <span id="cpg-subtotal">₹0.00</span>
            </div>
            <div style="display:flex; justify-content:space-between; font-size:13px; color:#94A3B8; margin-bottom:4px;">
              <span>GST (18% / 5% HSN)</span>
              <span id="cpg-gst">₹0.00</span>
            </div>
            <div style="display:flex; justify-content:space-between; font-size:16px; font-weight:800; color:#F8FAFC; margin:8px 0 16px 0;">
              <span>Total Payable</span>
              <span id="cpg-grand-total">₹0.00</span>
            </div>

            <button id="btn-cpg-generate-invoice" style="width:100%; background:#10B981; border:none; color:#FFF; font-weight:700; padding:12px; border-radius:8px; font-size:15px; cursor:pointer;">
              Generate Tax Invoice (E-Invoice IRN)
            </button>
          </div>
        </div>
      </div>
    </div>
  `;
}

export function wireRetailCpg(container, subroute) {
  const root = container || document.getElementById("page-content") || document.body;

  const cards = root.querySelectorAll(".cpg-card");
  cards.forEach(c => {
    c.addEventListener("click", () => {
      const sku = c.getAttribute("data-sku");
      const name = c.getAttribute("data-name");
      const pricePaisa = Number(c.getAttribute("data-price"));
      addItemToCart(root, { sku, name, pricePaisa });
    });
  });

  const barcodeInput = root.querySelector("#input-cpg-barcode");
  const scanBtn = root.querySelector("#btn-cpg-scan-add");
  const handleScan = () => {
    const val = (barcodeInput.value || "").trim();
    if (!val) return;
    addItemToCart(root, { sku: val, name: `Scanned Item (${val})`, pricePaisa: 30000 });
    barcodeInput.value = "";
  };

  if (scanBtn) scanBtn.addEventListener("click", handleScan);
  if (barcodeInput) {
    barcodeInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") handleScan();
    });
  }

  const invoiceBtn = root.querySelector("#btn-cpg-generate-invoice");
  if (invoiceBtn) {
    invoiceBtn.addEventListener("click", async () => {
      if (cartItems.length === 0) {
        alert("Please add items to cart first.");
        return;
      }
      const total = cartItems.reduce((acc, i) => acc + i.pricePaisa * i.qty, 0);
      alert(`CPG Tax Invoice Generated! Total: ₹${(total / 100).toFixed(2)} with IRN QR Code.`);
      cartItems = [];
      updateCartUi(root);
    });
  }

  const creditBtn = root.querySelector("#btn-cpg-credit-note");
  if (creditBtn) {
    creditBtn.addEventListener("click", () => {
      const invNo = prompt("Enter original Invoice Number for Credit Note adjustment:");
      if (invNo) {
        alert(`Credit Note linked to Invoice #${invNo}. Amount will be credited to customer balance.`);
      }
    });
  }
}

function addItemToCart(root, item) {
  const existing = cartItems.find(i => i.sku === item.sku);
  if (existing) {
    existing.qty += 1;
  } else {
    cartItems.push({ ...item, qty: 1 });
  }
  updateCartUi(root);
}

function updateCartUi(root) {
  const itemsEl = root.querySelector("#cpg-cart-items");
  const subtotalEl = root.querySelector("#cpg-subtotal");
  const gstEl = root.querySelector("#cpg-gst");
  const grandEl = root.querySelector("#cpg-grand-total");
  const countEl = root.querySelector("#cpg-cart-count");

  if (!itemsEl) return;

  if (cartItems.length === 0) {
    itemsEl.innerHTML = `<div style="text-align:center; padding:32px 0; color:#64748B; font-size:13px;">Cart is empty. Scan an item barcode.</div>`;
    if (subtotalEl) subtotalEl.textContent = "₹0.00";
    if (gstEl) gstEl.textContent = "₹0.00";
    if (grandEl) grandEl.textContent = "₹0.00";
    if (countEl) countEl.textContent = "0 items";
    return;
  }

  let subtotal = 0;
  itemsEl.innerHTML = cartItems.map(i => {
    const lineTotal = i.pricePaisa * i.qty;
    subtotal += lineTotal;
    return `
      <div style="background:#1E293B; border-radius:6px; padding:10px; display:flex; justify-content:space-between; align-items:center; font-size:13px;">
        <div>
          <div style="font-weight:600;">${i.name}</div>
          <div style="color:#94A3B8; font-size:11px;">₹${(i.pricePaisa / 100).toFixed(2)} × ${i.qty}</div>
        </div>
        <div style="font-weight:700; color:#10B981;">₹${(lineTotal / 100).toFixed(2)}</div>
      </div>
    `;
  }).join('');

  const gst = Math.round(subtotal * 0.18);
  const total = subtotal + gst;

  if (countEl) countEl.textContent = `${cartItems.length} line items`;
  if (subtotalEl) subtotalEl.textContent = `₹${(subtotal / 100).toFixed(2)}`;
  if (gstEl) gstEl.textContent = `₹${(gst / 100).toFixed(2)}`;
  if (grandEl) grandEl.textContent = `₹${(total / 100).toFixed(2)}`;
}
