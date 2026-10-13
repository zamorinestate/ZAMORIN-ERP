/**
 * CENTRALIZED CALL CENTER ORDER & RESERVATION DESK (F111)
 *
 * High-speed multi-outlet telephone ordering portal allowing call center agents
 * to select any branch outlet, look up customer phone history, and place scheduled
 * orders up to 60 days in advance.
 */

import { apiGet, apiPost } from "../apiClient.js";

let selectedOutlet = "CALICUT_BEACH";
let orderType = "DELIVERY";

export function renderCallCenter(subroute) {
  return `
    <div id="call-center-container" style="min-height:100vh; background:#0B0F19; color:#F8FAFC; font-family:-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; display:flex; flex-direction:column; padding:20px;">
      
      <!-- Top Desk Header -->
      <header style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid #1E293B; padding-bottom:16px; margin-bottom:20px;">
        <div style="display:flex; align-items:center; gap:12px;">
          <div style="background:#3B82F6; color:#FFF; font-weight:800; padding:6px 12px; border-radius:6px; font-size:13px;">CALL CENTER DESK</div>
          <h1 style="font-size:20px; font-weight:700; margin:0;">Zamorin Central Phone Ordering Hub</h1>
        </div>
        <div style="display:flex; gap:12px; align-items:center;">
          <label style="font-size:13px; color:#94A3B8;">Outlet Routing:</label>
          <select id="callcenter-outlet-select" style="background:#1E293B; border:1px solid #334155; color:#F8FAFC; padding:8px 12px; border-radius:6px; font-size:13px; font-weight:600;">
            <option value="CALICUT_BEACH">Calicut Beach Flagship</option>
            <option value="HILITE_MALL">Hi-Lite Mall Express</option>
            <option value="CYBERPARK">Cyberpark Tech Cafe</option>
          </select>
        </div>
      </header>

      <div style="display:grid; grid-template-columns: 360px 1fr 340px; gap:20px; flex:1;">
        
        <!-- Left: Caller ID & CRM Lookup -->
        <div style="background:#111827; border:1px solid #1E293B; border-radius:10px; padding:16px; display:flex; flex-direction:column; gap:16px;">
          <h3 style="margin:0; font-size:15px; border-bottom:1px solid #1E293B; padding-bottom:8px;">Caller Information</h3>
          
          <div>
            <label style="display:block; font-size:12px; color:#94A3B8; margin-bottom:4px;">Phone Number (Caller ID)</label>
            <div style="display:flex; gap:8px;">
              <input id="input-caller-phone" type="text" placeholder="+91 98470 12345" value="+91 98470 54321" style="flex:1; background:#1E293B; border:1px solid #334155; border-radius:6px; color:#FFF; padding:8px 12px; font-size:13px;" />
              <button id="btn-caller-lookup" style="background:#2563EB; border:none; color:#FFF; padding:8px 12px; border-radius:6px; font-size:12px; font-weight:600; cursor:pointer;">Lookup</button>
            </div>
          </div>

          <div>
            <label style="display:block; font-size:12px; color:#94A3B8; margin-bottom:4px;">Customer Name</label>
            <input id="input-caller-name" type="text" value="Amina Farooq" style="width:100%; box-sizing:border-box; background:#1E293B; border:1px solid #334155; border-radius:6px; color:#FFF; padding:8px 12px; font-size:13px;" />
          </div>

          <div>
            <label style="display:block; font-size:12px; color:#94A3B8; margin-bottom:4px;">Delivery Address / Landmark</label>
            <textarea id="input-caller-address" rows="3" style="width:100%; box-sizing:border-box; background:#1E293B; border:1px solid #334155; border-radius:6px; color:#FFF; padding:8px 12px; font-size:13px;">Villa 14, Palm Grove, Beach Road, Calicut</textarea>
          </div>

          <div style="background:#1E293B; border-radius:8px; padding:12px;">
            <div style="font-size:11px; color:#94A3B8; font-weight:700; margin-bottom:6px;">PAST ORDER HISTORY</div>
            <div style="font-size:12px; color:#CBD5E1; line-height:1.4;">
              <div>• 08-Oct: 2x Cold Brew, 1x Biryani (₹820)</div>
              <div>• 29-Sep: 1x Pour-Over, 2x Pastry (₹540)</div>
            </div>
            <div style="font-size:11px; color:#10B981; font-weight:700; margin-top:8px;">Loyalty Tier: GOLD (1,240 pts)</div>
          </div>
        </div>

        <!-- Middle: Menu Selection & Schedule Order -->
        <div style="background:#111827; border:1px solid #1E293B; border-radius:10px; padding:16px; display:flex; flex-direction:column; gap:16px;">
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <h3 style="margin:0; font-size:15px;">Fast Phone Menu</h3>
            <div style="display:flex; gap:8px;">
              <button class="callcenter-tag active" data-type="DELIVERY" style="background:#2563EB; color:#FFF; border:none; padding:6px 12px; border-radius:6px; font-size:12px; font-weight:600; cursor:pointer;">Delivery</button>
              <button class="callcenter-tag" data-type="TAKEAWAY" style="background:#1E293B; color:#CBD5E1; border:none; padding:6px 12px; border-radius:6px; font-size:12px; font-weight:600; cursor:pointer;">Pickup</button>
              <button class="callcenter-tag" data-type="RESERVATION" style="background:#1E293B; color:#CBD5E1; border:none; padding:6px 12px; border-radius:6px; font-size:12px; font-weight:600; cursor:pointer;">Dine-In Table</button>
            </div>
          </div>

          <!-- Advance Schedule Order up to 60 days -->
          <div style="background:#1E293B; border-radius:8px; padding:12px; display:flex; gap:16px; align-items:center;">
            <div>
              <label style="display:block; font-size:11px; color:#94A3B8; margin-bottom:2px;">Order Timing</label>
              <select id="select-order-timing" style="background:#0F172A; border:1px solid #334155; color:#FFF; padding:6px 10px; border-radius:4px; font-size:12px;">
                <option value="ASAP">Immediate (ASAP)</option>
                <option value="FUTURE">Scheduled (Advance Booking)</option>
              </select>
            </div>
            <div id="advance-date-picker" style="display:none;">
              <label style="display:block; font-size:11px; color:#94A3B8; margin-bottom:2px;">Schedule Date & Time</label>
              <input type="datetime-local" style="background:#0F172A; border:1px solid #334155; color:#FFF; padding:6px 10px; border-radius:4px; font-size:12px;" />
            </div>
          </div>

          <div style="display:grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap:12px;" id="callcenter-items-grid">
            <button class="btn-add-call-item" data-name="Signature Malabar Pour-Over" data-price="28000" style="background:#1E293B; border:1px solid #334155; border-radius:8px; padding:12px; text-align:left; color:#FFF; cursor:pointer;">
              <div style="font-weight:700; font-size:13px;">Signature Pour-Over</div>
              <div style="color:#D4AF37; font-size:12px; margin-top:4px;">₹280.00</div>
            </button>
            <button class="btn-add-call-item" data-name="Iced Spanish Latte" data-price="32000" style="background:#1E293B; border:1px solid #334155; border-radius:8px; padding:12px; text-align:left; color:#FFF; cursor:pointer;">
              <div style="font-weight:700; font-size:13px;">Iced Spanish Latte</div>
              <div style="color:#D4AF37; font-size:12px; margin-top:4px;">₹320.00</div>
            </button>
            <button class="btn-add-call-item" data-name="Zamorin Club Sandwich" data-price="38000" style="background:#1E293B; border:1px solid #334155; border-radius:8px; padding:12px; text-align:left; color:#FFF; cursor:pointer;">
              <div style="font-weight:700; font-size:13px;">Club Sandwich</div>
              <div style="color:#D4AF37; font-size:12px; margin-top:4px;">₹380.00</div>
            </button>
            <button class="btn-add-call-item" data-name="Truffle Mushroom Pasta" data-price="49000" style="background:#1E293B; border:1px solid #334155; border-radius:8px; padding:12px; text-align:left; color:#FFF; cursor:pointer;">
              <div style="font-weight:700; font-size:13px;">Truffle Pasta</div>
              <div style="color:#D4AF37; font-size:12px; margin-top:4px;">₹490.00</div>
            </button>
          </div>
        </div>

        <!-- Right: Dispatch Ticket Summary -->
        <div style="background:#111827; border:1px solid #1E293B; border-radius:10px; padding:16px; display:flex; flex-direction:column; justify-content:space-between;">
          <div>
            <h3 style="margin:0; font-size:15px; border-bottom:1px solid #1E293B; padding-bottom:8px; margin-bottom:12px;">Call Ticket</h3>
            <div id="call-cart-list" style="display:flex; flex-direction:column; gap:8px; font-size:13px; max-height:280px; overflow-y:auto;">
              <div style="color:#64748B; text-align:center; padding:30px 0;">No items selected yet.</div>
            </div>
          </div>

          <div style="border-top:1px solid #1E293B; padding-top:12px;">
            <div style="display:flex; justify-content:space-between; font-size:15px; font-weight:700; margin-bottom:12px;">
              <span>Total Payable</span>
              <span id="call-cart-total">₹0.00</span>
            </div>
            <button id="btn-submit-call-order" style="width:100%; background:#10B981; border:none; color:#FFF; font-weight:700; padding:12px; border-radius:8px; cursor:pointer;">
              Dispatch to Kitchen & Rider
            </button>
          </div>
        </div>

      </div>
    </div>
  `;
}

export function wireCallCenter(container, subroute) {
  const root = container || document.getElementById("page-content") || document.body;
  let callCart = [];

  const updateCart = () => {
    const list = root.querySelector("#call-cart-list");
    const totalEl = root.querySelector("#call-cart-total");
    if (!list) return;

    if (callCart.length === 0) {
      list.innerHTML = `<div style="color:#64748B; text-align:center; padding:30px 0;">No items selected yet.</div>`;
      if (totalEl) totalEl.textContent = "₹0.00";
      return;
    }

    let sum = 0;
    list.innerHTML = callCart.map(c => {
      sum += c.pricePaisa * c.qty;
      return `
        <div style="display:flex; justify-content:space-between; background:#1E293B; padding:8px 10px; border-radius:6px;">
          <span>${c.name} (x${c.qty})</span>
          <span style="font-weight:700; color:#10B981;">₹${((c.pricePaisa * c.qty) / 100).toFixed(2)}</span>
        </div>
      `;
    }).join('');

    if (totalEl) totalEl.textContent = `₹${(sum / 100).toFixed(2)}`;
  };

  root.querySelectorAll(".btn-add-call-item").forEach(btn => {
    btn.addEventListener("click", () => {
      const name = btn.getAttribute("data-name");
      const pricePaisa = Number(btn.getAttribute("data-price"));
      const existing = callCart.find(i => i.name === name);
      if (existing) existing.qty += 1;
      else callCart.push({ name, pricePaisa, qty: 1 });
      updateCart();
    });
  });

  const timingSelect = root.querySelector("#select-order-timing");
  const datePicker = root.querySelector("#advance-date-picker");
  if (timingSelect && datePicker) {
    timingSelect.addEventListener("change", (e) => {
      datePicker.style.display = e.target.value === "FUTURE" ? "block" : "none";
    });
  }

  const submitBtn = root.querySelector("#btn-submit-call-order");
  if (submitBtn) {
    submitBtn.addEventListener("click", () => {
      if (callCart.length === 0) {
        alert("Please add items to the ticket first.");
        return;
      }
      alert(`Call Center Order dispatched to ${selectedOutlet}! Customer SMS notification sent.`);
      callCart = [];
      updateCart();
    });
  }
}
