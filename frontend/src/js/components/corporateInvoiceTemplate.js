// =============================================================================
// ZAMORIN CAFÉ ERP — CORPORATE INVOICE & REPORT TEMPLATE (8K ULTRA-HD HIGH CONTRAST)
// Master Corporate Template reflecting the official high-contrast invoice standard:
// - Standalone Royal Crown Vector Crest Logo (#0062ea) matching reference layout
// - High-contrast pitch-black typography (#000000 / #090d16) and deep slate (#1e293b)
// - Standalone bold A, W, P contact indicators
// - Signature curved Vibrant Electric Cobalt Blue (#0062ea) top-right header block
// - Date grid with crisp vertical divider + High-contrast "Total Due:" card
// - Faint authentic security watermark (Zamorin Café / Void / Reprint)
// - Split two-tone table header with authentic diagonal angled seam
// - Floating alternate rounded pill rows with high-contrast text and crisp borders
// - Left: High-contrast Payment Methods & statutory Terms; Right: Detailed Totals & Grand Total pill
// - Signature bottom-left curved Vibrant Blue tab with embedded scannable SVG QR code
// - Signature bottom-right circular contact badges with razor-sharp SVG vector icons
// =============================================================================

import { generateQrSvg } from '../utils/qrCodeGen.js';

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function renderCorporateInvoiceHtml(bill, cafeBranding = {}) {
  const invoiceNum = bill.invoiceNumber || bill.billId || `INV-${Date.now()}`;
  const dateStr = bill.businessDate || new Date().toISOString().slice(0, 10);
  const dueDateStr = bill.dueDate || dateStr;
  const cafeName = cafeBranding.tradeName || bill.cafeName || 'Zamorin Café';
  const legalName = cafeBranding.legalName || 'Zamorin Speciality Coffee & Kitchens Pvt. Ltd.';
  const gstin = cafeBranding.gstin || bill.sellerGstin || '32AABCT1332L1ZV';
  const address = cafeBranding.address || '6128 West Media Spencer, BLR-560095';
  const customerName = bill.customerName || (bill.tableNumber ? `Guest (${bill.tableNumber})` : 'Johnson Doe');
  const customerSub = bill.customerTagline || legalName;
  const paymentMethod = bill.paymentMethod || 'UPI / Online';

  const subtotal = bill.subtotalPaisa !== undefined 
    ? bill.subtotalPaisa / 100 
    : (bill.subtotal !== undefined 
      ? Number(bill.subtotal) 
      : (bill.totalPaisa ? bill.totalPaisa / 100 : (bill.total !== undefined ? Number(bill.total) : 0)));

  const discount = bill.discountPaisa !== undefined
    ? bill.discountPaisa / 100
    : (bill.discount !== undefined ? Number(bill.discount) : 0);

  const gst = bill.taxPaisa !== undefined
    ? bill.taxPaisa / 100
    : (bill.tax !== undefined ? Number(bill.tax) : Math.round(Math.max(0, subtotal - discount) * 0.05));

  const grandTotal = bill.totalPaisa !== undefined
    ? bill.totalPaisa / 100
    : (bill.grandTotal !== undefined 
      ? Number(bill.grandTotal) 
      : (bill.total !== undefined ? Number(bill.total) : Math.max(0, subtotal + gst - discount)));

  const isVoid = bill.status === 'VOID' || bill.status === 'CANCELLED';
  const isReprint = (bill.reprints && bill.reprints.length > 0) || bill.isReprint;
  const reprintCount = bill.reprints?.length || 1;

  const watermarkText = isVoid ? 'VOID - CANCELLED' : (isReprint ? `REPRINT #${reprintCount}` : 'ZAMORIN CAFÉ');

  const rawItems = (Array.isArray(bill.lineItems) && bill.lineItems.length > 0)
    ? bill.lineItems
    : ((Array.isArray(bill.items) && bill.items.length > 0) ? bill.items : null);

  const items = rawItems || [
    { itemNameSnapshot: 'Product One Goes Here', quantity: 2, unitPricePaisa: 4000 },
    { itemNameSnapshot: 'Product Two Goes Here', quantity: 1, unitPricePaisa: 8000 },
    { itemNameSnapshot: 'Product Three Goes Here', quantity: 3, unitPricePaisa: 1000 },
    { itemNameSnapshot: 'Product Four Goes Here', quantity: 1, unitPricePaisa: 5000 },
    { itemNameSnapshot: 'Product Five Goes Here', quantity: 2, unitPricePaisa: 20000 },
  ];

  const qrUrl = bill.softCopyUrl || bill.invoiceUrl || `https://zamorin.cafe/qr/v1/inv/${encodeURIComponent(invoiceNum)}`;
  let qrSvgMarkup = '';
  try {
    const rawSvg = generateQrSvg(qrUrl, { size: 104, margin: 1, includeLogo: false });
    qrSvgMarkup = rawSvg.replace(
      '<svg ',
      '<svg style="width:104px !important;height:104px !important;display:block;" '
    );
  } catch (e) {
    qrSvgMarkup = '<div style="width:104px;height:104px;background:#000;"></div>';
  }

  return `
    <style>
      @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,600;0,700;0,800;1,600&family=Poppins:wght@400;500;600;700&display=swap');
    </style>
    <div class="zamorin-corporate-invoice" id="zamorin-corporate-invoice" style="position:relative;background:#ffffff;color:#090d16;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;width:100%;max-width:780px;margin:0 auto;box-shadow:0 14px 45px rgba(0,0,0,0.14);border-radius:14px;overflow:hidden;padding:38px 44px 28px;border:1.5px solid #cbd5e1;box-sizing:border-box;-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale;text-rendering:optimizeLegibility;">
      
      <!-- Authentic Subtle Diagonal Watermark -->
      <div style="position:absolute;top:50%;left:50%;transform:translate(-50%, -50%) rotate(-30deg);font-size:58px;font-weight:900;letter-spacing:14px;color:rgba(15,23,42,0.04);pointer-events:none;user-select:none;white-space:nowrap;z-index:0;text-transform:uppercase;">
        ${escapeHtml(watermarkText)}
      </div>

      <!-- Top Header: Brand Left + Vibrant Electric Blue Curved Header Right -->
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:28px;position:relative;z-index:1;">
        
        <!-- Left Column: High-Res Vector Brand Logo & Customer Details -->
        <div style="max-width:55%;">
          
          <!-- Brand Logo: Official Zamorin Corporate Brand Identity (Horizontal Lockup) -->
          <div style="margin-bottom:20px;">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 670 220" style="height:60px !important;width:auto !important;max-width:260px !important;display:block;" role="img" aria-label="Zamorin Estate Pvt. Ltd.">
              <defs>
                <linearGradient id="zam_off_g1" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stop-color="#C6A567"/>
                  <stop offset="100%" stop-color="#83622C"/>
                </linearGradient>
                <linearGradient id="zam_off_n1" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stop-color="#16223F"/>
                  <stop offset="100%" stop-color="#0B1220"/>
                </linearGradient>
                <g id="zam_off_icn">
                  <rect x="6" y="6" width="188" height="188" rx="52" fill="url(#zam_off_n1)"/>
                  <rect x="22" y="22" width="156" height="156" rx="38" fill="none" stroke="url(#zam_off_g1)" stroke-width="2.25" opacity="0.9"/>
                  <path d="M 58 68 L 142 68 L 58 132 L 142 132" fill="none" stroke="url(#zam_off_g1)" stroke-width="17" stroke-linecap="round" stroke-linejoin="round"/>
                </g>
              </defs>
              <use href="#zam_off_icn" transform="translate(20,15) scale(0.95)"/>
              <g transform="translate(250,0)">
                <text x="3" y="99" font-family="'Playfair Display', Georgia, serif" font-weight="700" font-size="80" letter-spacing="3" fill="#16223F">ZAMORIN</text>
                <text x="5" y="162" font-family="'Poppins', sans-serif" font-weight="400" font-size="22" letter-spacing="12" fill="#7C8598">ESTATE</text>
                <line x1="3" y1="178" x2="400" y2="178" stroke="#96733A" stroke-width="1.5"/>
                <text x="5" y="200" font-family="'Poppins', sans-serif" font-weight="500" font-size="13" letter-spacing="5" fill="#96733A">PVT. LTD.</text>
              </g>
            </svg>
          </div>

          <!-- INVOICE TO Recipient Block -->
          <div style="margin-bottom:16px;">
            <div style="font-size:10.5px;font-weight:800;letter-spacing:0.1em;text-transform:uppercase;color:#475569;">
              INVOICE TO
            </div>
            <div style="font-size:20px;font-weight:900;color:#000000;margin:3px 0 2px;">
              ${escapeHtml(customerName)}
            </div>
            <div style="font-size:12px;font-weight:600;color:#334155;margin-bottom:14px;">
              ${escapeHtml(customerSub)}
            </div>
          </div>

          <!-- High-Contrast Badged Contact List: Standalone A, W, P -->
          <div style="display:flex;flex-direction:column;gap:7px;font-size:11.5px;color:#090d16;">
            <div style="display:flex;align-items:flex-start;gap:12px;">
              <span style="font-weight:900;font-size:12px;color:#000000;min-width:14px;">A</span>
              <span style="color:#0f172a;font-weight:600;line-height:1.35;">${escapeHtml(address)}</span>
            </div>
            <div style="display:flex;align-items:center;gap:12px;">
              <span style="font-weight:900;font-size:12px;color:#000000;min-width:14px;">W</span>
              <span style="color:#0f172a;font-weight:600;">contact@zamorincafe.com, www.zamorincafe.com</span>
            </div>
            <div style="display:flex;align-items:center;gap:12px;">
              <span style="font-weight:900;font-size:12px;color:#000000;min-width:14px;">P</span>
              <span style="color:#0f172a;font-weight:600;">+91 80 4123 4567, +91 98765 43210</span>
            </div>
          </div>
        </div>

        <!-- Right Column: Signature Blue Header + Dates + Total Due Card -->
        <div style="display:flex;flex-direction:column;align-items:flex-end;max-width:44%;">
          
          <!-- Curved Vibrant Electric Blue Header Shape -->
          <div style="background:linear-gradient(135deg, #0062ea 0%, #004ec4 100%);color:#ffffff;padding:16px 28px 16px 36px;border-bottom-left-radius:38px;box-shadow:0 8px 24px rgba(0,98,234,0.35);margin-right:-44px;margin-top:-38px;text-align:right;min-width:245px;box-sizing:border-box;">
            <div style="font-size:26px;font-weight:900;letter-spacing:0.06em;line-height:1.1;text-shadow:0 2px 4px rgba(0,0,0,0.15);">
              INVOICE
            </div>
            <div style="font-size:12px;font-weight:700;letter-spacing:0.04em;opacity:0.95;margin-top:4px;">
              No. ${escapeHtml(invoiceNum)}
            </div>
          </div>

          <!-- Date Grid: Invoice Date | Due Date -->
          <div style="display:flex;align-items:center;gap:18px;margin-top:20px;margin-bottom:14px;padding-right:2px;">
            <div style="text-align:right;">
              <div style="font-size:10px;font-weight:800;letter-spacing:0.04em;text-transform:uppercase;color:#475569;">
                Invoice Date
              </div>
              <div style="font-size:12.5px;font-weight:900;color:#000000;margin-top:2px;">
                ${escapeHtml(dateStr)}
              </div>
            </div>
            <!-- Sharp Vertical Divider -->
            <div style="width:1.5px;height:24px;background:#94a3b8;"></div>
            <div style="text-align:right;">
              <div style="font-size:10px;font-weight:800;letter-spacing:0.04em;text-transform:uppercase;color:#475569;">
                Due Date
              </div>
              <div style="font-size:12.5px;font-weight:900;color:#000000;margin-top:2px;">
                ${escapeHtml(dueDateStr)}
              </div>
            </div>
          </div>

          <!-- "Total Due:" High-Contrast Card -->
          <div style="background:#f8fafc;border:1.5px solid #cbd5e1;border-radius:12px;padding:9px 24px;text-align:right;box-shadow:0 2px 6px rgba(0,0,0,0.04);box-sizing:border-box;">
            <div style="font-size:10.5px;font-weight:800;color:#475569;text-transform:uppercase;letter-spacing:0.04em;">Total Due:</div>
            <div style="font-size:22px;font-weight:900;color:#000000;letter-spacing:0.01em;margin-top:1px;">
              ₹${grandTotal.toFixed(2)}
            </div>
          </div>

        </div>
      </div>

      <!-- Table Section: Split Two-Tone Header & High-Contrast Rows -->
      <div style="position:relative;z-index:1;margin-bottom:28px;">
        
        <!-- Header Row: Deep Obsidian Left + Vibrant Electric Blue Right with Angled Seam -->
        <div style="display:flex;align-items:stretch;height:38px;border-radius:7px;overflow:hidden;margin-bottom:8px;font-size:11px;font-weight:900;letter-spacing:0.06em;color:#ffffff;box-shadow:0 2px 6px rgba(0,0,0,0.1);background:#0062ea;">
          <!-- Left Obsidian Header with diagonal clip -->
          <div style="background:#0a0f1d;display:flex;align-items:center;width:58%;padding:0 16px;clip-path:polygon(0 0, 100% 0, calc(100% - 16px) 100%, 0 100%);">
            <div style="width:42px;">SL.</div>
            <div>DESCRIPTION.</div>
          </div>
          <!-- Right Vibrant Blue Header -->
          <div style="display:flex;align-items:center;justify-content:space-between;width:42%;padding:0 20px 0 6px;">
            <div style="width:33%;text-align:right;">PRICE</div>
            <div style="width:33%;text-align:center;">QUANTITY</div>
            <div style="width:33%;text-align:right;">TOTAL</div>
          </div>
        </div>

        <!-- Floating Alternating High-Contrast Pill Rows -->
        <div style="display:flex;flex-direction:column;gap:6px;">
          ${items.map((it, idx) => {
            const sl = idx + 1;
            const name = it.itemNameSnapshot || it.itemName || it.name || 'Item';
            const sub = it.notes || it.itemNotes || it.modifiers?.size || it.description || 'Speciality roast & barista crafted.';
            const qty = it.quantity || it.qty || 1;
            const unitPrice = it.unitPricePaisa !== undefined
              ? (it.unitPricePaisa / 100)
              : (it.unitPrice !== undefined ? Number(it.unitPrice) : (it.price !== undefined ? Number(it.price) : 0));
            const lineTot = it.lineTotalPaisa !== undefined
              ? (it.lineTotalPaisa / 100)
              : (it.lineTotal !== undefined ? Number(it.lineTotal) : (unitPrice * qty));
            const price = unitPrice.toFixed(2);
            const totalStr = lineTot.toFixed(2);
            const isEven = idx % 2 === 1;
            const rowBg = isEven ? '#f1f5f9' : '#ffffff';
            const borderStyle = isEven ? '1px solid #e2e8f0' : '1px solid #f1f5f9';

            return `
              <div style="display:flex;align-items:center;background:${rowBg};border-radius:9px;padding:10px 16px;font-size:12px;border:${borderStyle};box-sizing:border-box;">
                <!-- Left Description Column -->
                <div style="display:flex;align-items:center;width:58%;">
                  <div style="width:42px;font-weight:900;color:#000000;">${sl}.</div>
                  <div>
                    <div style="font-weight:900;color:#000000;font-size:12.5px;">${escapeHtml(name)}</div>
                    <div style="font-size:10.5px;font-weight:600;color:#334155;margin-top:2px;">${escapeHtml(sub)}</div>
                  </div>
                </div>
                <!-- Right Price / Quantity / Line Total Column -->
                <div style="display:flex;align-items:center;justify-content:space-between;width:42%;padding-right:4px;">
                  <div style="width:33%;text-align:right;color:#000000;font-weight:800;">₹${price}</div>
                  <div style="width:33%;text-align:center;color:#000000;font-weight:900;">${qty}</div>
                  <div style="width:33%;text-align:right;font-weight:900;color:#000000;font-size:12.5px;">₹${totalStr}</div>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      </div>

      <!-- Bottom Financials: Payment Methods & Conditions Left + Totals Right -->
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:28px;position:relative;z-index:1;">
        
        <!-- Left: Payment Methods & Terms -->
        <div style="width:52%;">
          <div style="font-size:12.5px;font-weight:900;color:#000000;margin-bottom:8px;">
            Payment Methods
          </div>
          <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px;">
            <div style="background:#0a0f1d;border:1px solid #000000;border-radius:6px;padding:5px 12px;font-weight:900;font-size:11px;color:#ffffff;letter-spacing:0.04em;">
              ${escapeHtml(paymentMethod.toUpperCase())}
            </div>
            <div style="font-size:11px;font-weight:700;color:#0062ea;">
              billing@zamorincafe.com
            </div>
          </div>

          <div style="font-size:11.5px;font-weight:900;color:#000000;margin-bottom:4px;">
            Terms &amp; Conditions
          </div>
          <div style="font-size:10px;font-weight:600;line-height:1.5;color:#334155;max-width:330px;">
            Goods once sold are non-refundable. All prices inclusive of applicable statutory taxes. This document serves as an official electronic retained tax invoice under GST statutory provisions.
          </div>
        </div>

        <!-- Right: Totals Breakdown & Vibrant Grand Total Banner -->
        <div style="width:42%;display:flex;flex-direction:column;gap:8px;">
          <div style="display:flex;justify-content:space-between;font-size:12.5px;color:#334155;padding-bottom:2px;">
            <span style="font-weight:700;">Sub Total</span>
            <span style="font-weight:900;color:#000000;">₹${subtotal.toFixed(2)}</span>
          </div>
          <div style="display:flex;justify-content:space-between;font-size:12.5px;color:#334155;padding-bottom:2px;">
            <span style="font-weight:700;">Country Tax 10% / GST 5%</span>
            <span style="font-weight:900;color:#000000;">₹${gst.toFixed(2)}</span>
          </div>
          ${discount > 0 ? `
          <div style="display:flex;justify-content:space-between;font-size:12.5px;color:#b45309;padding-bottom:2px;">
            <span style="font-weight:800;">Discount</span>
            <span style="font-weight:900;">- ₹${discount.toFixed(2)}</span>
          </div>` : ''}

          <!-- Solid Vibrant Electric Blue Grand Total Pill Banner -->
          <div style="background:linear-gradient(135deg, #0062ea 0%, #004ec4 100%);color:#ffffff;border-radius:9px;padding:12px 20px;display:flex;justify-content:space-between;align-items:center;margin-top:6px;box-shadow:0 6px 16px rgba(0,98,234,0.35);">
            <span style="font-size:14px;font-weight:900;letter-spacing:0.04em;text-shadow:0 1px 2px rgba(0,0,0,0.15);">Grand Total :</span>
            <span style="font-size:18px;font-weight:900;letter-spacing:0.02em;text-shadow:0 1px 2px rgba(0,0,0,0.15);">₹${grandTotal.toFixed(2)}</span>
          </div>
        </div>
      </div>

      <!-- Bottom Signature Footer: Scannable QR Tab + 3 Vector Contact Badges -->
      <div style="position:relative;z-index:1;border-top:1.5px solid #e2e8f0;padding-top:16px;margin-top:8px;">
        
        <!-- Centered High-Contrast Greeting -->
        <div style="text-align:center;font-size:11.5px;font-weight:900;letter-spacing:0.14em;text-transform:uppercase;color:#000000;margin-bottom:16px;">
          THANK YOU FOR YOUR BUSINESS
        </div>

        <div style="display:flex;align-items:center;justify-content:space-between;">
          
          <!-- Signature Bottom-Left Vibrant Blue QR Tab with Soft Copy Indication -->
          <div style="display:flex;align-items:flex-end;margin-left:-44px;margin-bottom:-28px;">
            <div style="background:linear-gradient(135deg, #0062ea 0%, #004ec4 100%);padding:14px 20px 16px 24px;border-top-right-radius:36px;display:inline-flex;flex-direction:column;align-items:center;justify-content:center;box-shadow:0 8px 24px rgba(0,98,234,0.35);">
              <div class="zamorin-qr-card" style="background:#ffffff;padding:8px;border-radius:12px;box-shadow:0 4px 14px rgba(0,0,0,0.18);display:inline-flex;align-items:center;justify-content:center;width:120px;height:120px;box-sizing:border-box;">
                ${qrSvgMarkup}
              </div>
              <div style="margin-top:6px;text-align:center;">
                <div style="font-size:9px;font-weight:900;letter-spacing:0.08em;color:#ffffff;text-transform:uppercase;line-height:1.2;">
                  SCAN FOR SOFT COPY
                </div>
                <div style="font-size:7.5px;font-weight:700;color:rgba(255,255,255,0.85);margin-top:2px;">
                  Digital Tax Invoice
                </div>
              </div>
            </div>
          </div>

          <!-- Signature Bottom-Right 3 Contact Badges with Razor-Sharp Inline Vector SVGs -->
          <div style="display:flex;align-items:center;gap:22px;font-size:10.5px;color:#090d16;">
            
            <!-- Phone Badge -->
            <div style="display:flex;align-items:center;gap:10px;">
              <div style="width:34px;height:34px;border-radius:50%;border:1.5px solid #94a3b8;display:flex;align-items:center;justify-content:center;background:#ffffff;box-shadow:0 2px 5px rgba(0,0,0,0.05);flex-shrink:0;">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#0062ea" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="width:15px !important;height:15px !important;display:block;">
                  <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>
                </svg>
              </div>
              <div style="line-height:1.3;">
                <div style="font-weight:900;color:#000000;">+91 80 4123 4567</div>
                <div style="font-weight:700;color:#334155;">+91 98765 43210</div>
              </div>
            </div>

            <!-- Email / Web Badge -->
            <div style="display:flex;align-items:center;gap:10px;">
              <div style="width:34px;height:34px;border-radius:50%;border:1.5px solid #94a3b8;display:flex;align-items:center;justify-content:center;background:#ffffff;box-shadow:0 2px 5px rgba(0,0,0,0.05);flex-shrink:0;">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#0062ea" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="width:15px !important;height:15px !important;display:block;">
                  <rect x="2" y="4" width="20" height="16" rx="2"/>
                  <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>
                </svg>
              </div>
              <div style="line-height:1.3;">
                <div style="font-weight:900;color:#000000;">contact@zamorincafe.com</div>
                <div style="font-weight:700;color:#334155;">www.zamorincafe.com</div>
              </div>
            </div>

            <!-- Location Badge -->
            <div style="display:flex;align-items:center;gap:10px;">
              <div style="width:34px;height:34px;border-radius:50%;border:1.5px solid #94a3b8;display:flex;align-items:center;justify-content:center;background:#ffffff;box-shadow:0 2px 5px rgba(0,0,0,0.05);flex-shrink:0;">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#0062ea" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="width:15px !important;height:15px !important;display:block;">
                  <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/>
                  <circle cx="12" cy="10" r="3"/>
                </svg>
              </div>
              <div style="line-height:1.3;">
                <div style="font-weight:900;color:#000000;">123, Koramangala 5th Block</div>
                <div style="font-weight:700;color:#334155;">Bengaluru, KA 560095</div>
              </div>
            </div>

          </div>
        </div>

      </div>

    </div>
  `;
}
