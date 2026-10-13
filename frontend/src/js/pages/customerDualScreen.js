/**
 * DYNAMIC CUSTOMER DUAL-SCREEN QR PRESENTATION (A060, F015, F016)
 *
 * Dedicated secondary monitor layout positioned facing the customer.
 * Uses BroadcastChannel('zamorin_pos_dualscreen') to reflect live cashier
 * ring-ups, applied discounts, customer loyalty points, and dynamic UPI QR code.
 */

let broadcastChannel = null;

export function renderDualScreen(subroute) {
  return `
    <div id="dual-screen-root" style="width:100vw; height:100vh; background:#0B0F19; color:#F8FAFC; font-family:-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; display:flex; flex-direction:column; overflow:hidden; position:fixed; top:0; left:0; z-index:99999;">
      
      <!-- Top Brand Strip -->
      <header style="background:#111827; border-bottom:2px solid #D4AF37; padding:16px 36px; display:flex; justify-content:space-between; align-items:center;">
        <div style="display:flex; align-items:center; gap:16px;">
          <div style="width:40px; height:40px; border-radius:8px; background:#D4AF37; color:#0B0F19; font-size:20px; font-weight:900; display:flex; align-items:center; justify-content:center;">Z</div>
          <div>
            <div style="font-size:20px; font-weight:800;">Zamorin Café</div>
            <div style="font-size:12px; color:#94A3B8;">Customer Welcome Screen</div>
          </div>
        </div>
        <div style="text-align:right;">
          <span style="background:#10B981; color:#064E3B; font-weight:800; font-size:11px; padding:4px 10px; border-radius:12px;">CONNECTED</span>
        </div>
      </header>

      <!-- Center Split Screen: Cart on Left, Dynamic QR & Payment on Right -->
      <div style="flex:1; display:grid; grid-template-columns: 1.2fr 1fr; gap:32px; padding:32px; box-sizing:border-box;">
        
        <!-- Left: Live Order Breakdown -->
        <div style="background:#111827; border:1px solid #1E293B; border-radius:16px; padding:24px; display:flex; flex-direction:column; justify-content:space-between;">
          <div>
            <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid #1E293B; padding-bottom:12px; margin-bottom:16px;">
              <h2 style="margin:0; font-size:18px; font-weight:700;">Your Order</h2>
              <span id="ds-order-type" style="font-size:12px; font-weight:700; color:#F59E0B; background:#3B270C; padding:4px 8px; border-radius:6px;">DINE-IN</span>
            </div>

            <div id="ds-cart-items" style="display:flex; flex-direction:column; gap:12px; max-height:480px; overflow-y:auto;">
              <div style="display:flex; justify-content:space-between; align-items:center; background:#1E293B; padding:12px 16px; border-radius:8px;">
                <div>
                  <div style="font-weight:700; font-size:15px;">Malabar Monsooned Pour-Over</div>
                  <div style="color:#94A3B8; font-size:12px;">Hot • Regular • No Sugar</div>
                </div>
                <div style="font-weight:800; font-size:16px; color:#D4AF37;">₹280.00</div>
              </div>
            </div>
          </div>

          <div style="border-top:1px solid #1E293B; padding-top:16px; margin-top:20px;">
            <div style="display:flex; justify-content:space-between; color:#94A3B8; font-size:14px; margin-bottom:6px;">
              <span>Subtotal</span>
              <span id="ds-subtotal">₹280.00</span>
            </div>
            <div style="display:flex; justify-content:space-between; color:#94A3B8; font-size:14px; margin-bottom:8px;">
              <span>GST (5%)</span>
              <span id="ds-gst">₹14.00</span>
            </div>
            <div style="display:flex; justify-content:space-between; color:#F8FAFC; font-size:24px; font-weight:900;">
              <span>Total Amount</span>
              <span id="ds-total" style="color:#10B981;">₹294.00</span>
            </div>
          </div>
        </div>

        <!-- Right: Dynamic UPI QR Code & Loyalty -->
        <div style="background:#111827; border:1px solid #1E293B; border-radius:16px; padding:32px; display:flex; flex-direction:column; align-items:center; justify-content:center; text-align:center;">
          <div style="font-size:16px; font-weight:700; color:#F8FAFC; margin-bottom:4px;">Scan & Pay via any UPI App</div>
          <div style="font-size:12px; color:#94A3B8; margin-bottom:24px;">GPay • PhonePe • Paytm • BHIM • CRED</div>

          <div style="background:#FFFFFF; padding:16px; border-radius:16px; box-shadow:0 10px 25px rgba(0,0,0,0.5); margin-bottom:20px;">
            <img id="ds-upi-qr" src="https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=upi://pay?pa=zamorincafe@icici&pn=ZamorinCafe&am=294.00&cu=INR" alt="Dynamic UPI QR" style="width:200px; height:200px; display:block;" />
          </div>

          <div id="ds-qr-amount-pill" style="background:#1E293B; border:1px solid #334155; padding:8px 20px; border-radius:30px; font-size:18px; font-weight:800; color:#D4AF37;">
            Pay Exactly: <span id="ds-qr-amount-text">₹294.00</span>
          </div>

          <div style="margin-top:24px; font-size:12px; color:#64748B;">
            Audio verification soundbox will announce once settled.
          </div>
        </div>

      </div>

      <!-- Bottom Welcome Banner -->
      <footer style="background:#111827; border-top:1px solid #1E293B; padding:12px 36px; text-align:center; font-size:13px; color:#94A3B8;">
        Thank you for visiting Zamorin Café • Tag us @zamorincafe to earn bonus rewards!
      </footer>
    </div>
  `;
}

export function wireDualScreen(container, subroute) {
  const root = container || document.getElementById("page-content") || document.body;

  try {
    broadcastChannel = new BroadcastChannel("zamorin_pos_dualscreen");
    broadcastChannel.onmessage = (event) => {
      const data = event.data;
      if (!data) return;

      const itemsEl = root.querySelector("#ds-cart-items");
      const subtotalEl = root.querySelector("#ds-subtotal");
      const gstEl = root.querySelector("#ds-gst");
      const totalEl = root.querySelector("#ds-total");
      const qrEl = root.querySelector("#ds-upi-qr");
      const qrTextEl = root.querySelector("#ds-qr-amount-text");

      if (data.items && itemsEl) {
        itemsEl.innerHTML = data.items.map(i => `
          <div style="display:flex; justify-content:space-between; align-items:center; background:#1E293B; padding:12px 16px; border-radius:8px;">
            <div>
              <div style="font-weight:700; font-size:15px;">${i.name}</div>
              <div style="color:#94A3B8; font-size:12px;">Qty: ${i.qty || 1}</div>
            </div>
            <div style="font-weight:800; font-size:16px; color:#D4AF37;">₹${((i.pricePaisa * (i.qty || 1)) / 100).toFixed(2)}</div>
          </div>
        `).join('');
      }

      const totalPaisa = data.totalPaisa || 0;
      const formattedTotal = `₹${(totalPaisa / 100).toFixed(2)}`;

      if (subtotalEl && data.subtotalPaisa !== undefined) subtotalEl.textContent = `₹${(data.subtotalPaisa / 100).toFixed(2)}`;
      if (gstEl && data.taxPaisa !== undefined) gstEl.textContent = `₹${(data.taxPaisa / 100).toFixed(2)}`;
      if (totalEl) totalEl.textContent = formattedTotal;
      if (qrTextEl) qrTextEl.textContent = formattedTotal;

      if (qrEl) {
        const upiUri = `upi://pay?pa=zamorincafe@icici&pn=ZamorinCafe&am=${(totalPaisa / 100).toFixed(2)}&cu=INR`;
        qrEl.src = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(upiUri)}`;
      }
    };
  } catch (err) {
    console.warn("Dual screen BroadcastChannel setup error:", err);
  }
}
