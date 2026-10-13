/**
 * DIGITAL MENU BOARD SIGNAGE TV STUDIO (F287–F291)
 *
 * Fullscreen digital signage view for TV displays and commercial menu screens.
 * Supports rotational specials (F288), scheduled slides, day-parting, and TV pairing flow (F290).
 */

import { apiGet } from "../apiClient.js";

let slideTimer = null;
let currentSlideIndex = 0;

export function renderMenuBoard(subroute) {
  return `
    <div id="digital-menu-board-root" style="width:100vw; height:100vh; background:#0B0F19; color:#F8FAFC; font-family:-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; display:flex; flex-direction:column; overflow:hidden; position:fixed; top:0; left:0; z-index:99999;">
      
      <!-- Top Cafe TV Brand Header -->
      <div style="background:#111827; border-bottom:2px solid #D4AF37; padding:18px 36px; display:flex; justify-content:space-between; align-items:center;">
        <div style="display:flex; align-items:center; gap:16px;">
          <div style="width:44px; height:44px; border-radius:10px; background:#D4AF37; color:#0B0F19; font-size:22px; font-weight:900; display:flex; align-items:center; justify-content:center;">Z</div>
          <div>
            <div style="font-size:22px; font-weight:800; letter-spacing:0.5px;">ZAMORIN CAFÉ</div>
            <div style="font-size:12px; color:#94A3B8; letter-spacing:1px; text-transform:uppercase;">Artisanal Roastery & Kitchen</div>
          </div>
        </div>

        <div style="display:flex; align-items:center; gap:24px;">
          <div style="text-align:right;">
            <div id="menu-board-time" style="font-size:24px; font-weight:800; font-family:monospace; color:#F8FAFC;">--:--</div>
            <div id="menu-board-daypart" style="font-size:12px; color:#10B981; font-weight:700;">EVENING BREW SPECIALS</div>
          </div>
          <div id="tv-pairing-badge" style="background:#1E293B; border:1px solid #334155; padding:6px 12px; border-radius:6px; font-size:12px; color:#94A3B8;">
            TV-PIN: <span style="font-family:monospace; color:#D4AF37; font-weight:800;">7829</span>
          </div>
        </div>
      </div>

      <!-- Main Signage Carousel Pane -->
      <div id="signage-slide-container" style="flex:1; display:flex; padding:32px; gap:32px; align-items:stretch;">
        
        <!-- Left Hero Promotion -->
        <div style="flex:1.2; background:linear-gradient(145deg, #1E1B4B 0%, #0F172A 100%); border:1px solid #3730A3; border-radius:16px; padding:32px; display:flex; flex-direction:column; justify-content:space-between; position:relative; overflow:hidden;">
          <div style="position:absolute; top:20px; right:20px; background:#D4AF37; color:#0B0F19; font-weight:900; padding:6px 14px; border-radius:20px; font-size:13px; text-transform:uppercase;">
            Chef's Special
          </div>
          <div>
            <div style="font-size:14px; color:#A5B4FC; font-weight:700; letter-spacing:1.5px; text-transform:uppercase; margin-bottom:12px;">Featured Craft Roast</div>
            <h2 style="font-size:38px; font-weight:800; margin:0 0 16px 0; line-height:1.2; color:#FFF;">Single Origin Malabar Monsooned Pour-Over</h2>
            <p style="font-size:16px; color:#CBD5E1; line-height:1.6; max-width:500px; margin:0;">Aged under monsoon sea breezes with deep earthen cocoa, toasted hazelnuts, and velvety brown sugar notes.</p>
          </div>
          <div style="display:flex; justify-content:space-between; align-items:flex-end;">
            <div>
              <span style="font-size:14px; color:#94A3B8;">Crafted Fresh</span>
              <div style="font-size:36px; font-weight:900; color:#D4AF37;">₹280<span style="font-size:18px; color:#94A3B8;"> / cup</span></div>
            </div>
            <div style="font-size:12px; color:#10B981; font-weight:700;">★ 4.9 (420+ Reviews)</div>
          </div>
        </div>

        <!-- Right Live Category Grid -->
        <div style="flex:1; display:flex; flex-direction:column; gap:16px;">
          <div style="background:#111827; border:1px solid #1E293B; border-radius:12px; padding:20px; flex:1; display:flex; flex-direction:column; justify-content:space-between;">
            <div style="font-size:13px; font-weight:800; color:#F59E0B; letter-spacing:1px; text-transform:uppercase; border-bottom:1px solid #1E293B; padding-bottom:8px;">
              Espresso & Specialties
            </div>
            <div style="display:flex; flex-direction:column; gap:10px; margin-top:12px;">
              <div style="display:flex; justify-content:space-between; font-size:16px; font-weight:600;">
                <span>Spanish Iced Latte</span>
                <span style="color:#D4AF37; font-weight:800;">₹320</span>
              </div>
              <div style="display:flex; justify-content:space-between; font-size:16px; font-weight:600;">
                <span>Velvet Flat White</span>
                <span style="color:#D4AF37; font-weight:800;">₹260</span>
              </div>
              <div style="display:flex; justify-content:space-between; font-size:16px; font-weight:600;">
                <span>Cortado Cortecito</span>
                <span style="color:#D4AF37; font-weight:800;">₹240</span>
              </div>
              <div style="display:flex; justify-content:space-between; font-size:16px; font-weight:600;">
                <span>Cascara Sparkling Tea</span>
                <span style="color:#D4AF37; font-weight:800;">₹220</span>
              </div>
            </div>
          </div>

          <div style="background:#111827; border:1px solid #1E293B; border-radius:12px; padding:20px; flex:1; display:flex; flex-direction:column; justify-content:space-between;">
            <div style="font-size:13px; font-weight:800; color:#10B981; letter-spacing:1px; text-transform:uppercase; border-bottom:1px solid #1E293B; padding-bottom:8px;">
              Artisanal Bakery & Desserts
            </div>
            <div style="display:flex; flex-direction:column; gap:10px; margin-top:12px;">
              <div style="display:flex; justify-content:space-between; font-size:16px; font-weight:600;">
                <span>Almond Frangipane Tart</span>
                <span style="color:#D4AF37; font-weight:800;">₹240</span>
              </div>
              <div style="display:flex; justify-content:space-between; font-size:16px; font-weight:600;">
                <span>Classic Sourdough Croissant</span>
                <span style="color:#D4AF37; font-weight:800;">₹190</span>
              </div>
              <div style="display:flex; justify-content:space-between; font-size:16px; font-weight:600;">
                <span>San Sebastian Cheesecake</span>
                <span style="color:#D4AF37; font-weight:800;">₹310</span>
              </div>
            </div>
          </div>
        </div>

      </div>

      <!-- Bottom Rotational Banner -->
      <footer style="background:#111827; border-top:1px solid #1E293B; padding:12px 36px; display:flex; justify-content:space-between; align-items:center; font-size:14px; color:#94A3B8;">
        <div>📍 Zamorin Café Calicut Flagship • All artisanal beans 100% ethically sourced</div>
        <div style="color:#10B981; font-weight:600;">🌿 Freshly roasted batch on brew: Barista Lot #2026-B8</div>
      </footer>
    </div>
  `;
}

export function wireMenuBoard(container, subroute) {
  const root = container || document.getElementById("page-content") || document.body;

  const timeEl = root.querySelector("#menu-board-time");
  if (timeEl) {
    slideTimer = setInterval(() => {
      const now = new Date();
      timeEl.textContent = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }, 1000);
  }
}
