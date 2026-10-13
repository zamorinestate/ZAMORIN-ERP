// =============================================================================
// ZAMORIN CAFÉ ERP — POS THERMAL RECEIPT TEMPLATE (80MM / 58MM PROFILES)
// =============================================================================
// Features:
// 1. Official Monochrome Vector Zamorin Brand Logo (Header)
// 2. Clear Cafe & Statutory Identity (Trade Name, GSTIN, Address, FSSAI)
// 3. Document Number, Date, Time, Table/Token & Cashier
// 4. Universal Sl. No. Itemization, Modifiers, Qty & Amounts
// 5. Statutory Tax Breakdown (CGST 2.5%, SGST 2.5%, Discounts, Round Off)
// 6. Scannable Vector QR Code linking to Official Invoice Soft Copy
//    with "SCAN FOR DIGITAL TAX INVOICE" label
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

export function renderPosThermalReceiptHtml(bill, options = {}) {
  const paperWidth = options.paperWidth === '58' ? '58' : '80';
  const cafeName = options.tradeName || bill.cafeName || 'Zamorin Café';
  const gstin = options.gstin || bill.gstRegistrationNumber || bill.sellerGstin || '32AABCT1332L1ZV';
  const address = options.address || bill.cafeAddress || '123, Koramangala 5th Block, Bengaluru';
  
  const invoiceNum = bill.invoiceNumber || bill.billId || `INV-${Date.now()}`;
  const dateStr = bill.businessDate || (bill.createdAt ? new Date(bill.createdAt).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10));
  const timeStr = bill.createdAt 
    ? new Date(bill.createdAt).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: true })
    : new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  const isVoid = bill.status === 'VOID' || bill.status === 'CANCELLED';
  const reprintCount = bill.reprints?.length || (options.isReprint ? 1 : 0);

  const subtotal = bill.subtotalPaisa !== undefined 
    ? bill.subtotalPaisa / 100 
    : (bill.subtotal !== undefined ? Number(bill.subtotal) : (bill.totalPaisa ? bill.totalPaisa / 100 : 0));
  
  const discount = bill.discountPaisa !== undefined 
    ? bill.discountPaisa / 100 
    : (bill.discount !== undefined ? Number(bill.discount) : 0);

  const gst = bill.taxPaisa !== undefined 
    ? bill.taxPaisa / 100 
    : (bill.tax !== undefined ? Number(bill.tax) : Math.round(Math.max(0, subtotal - discount) * 0.05));

  const grandTotal = bill.totalPaisa !== undefined 
    ? bill.totalPaisa / 100 
    : (bill.grandTotal !== undefined ? Number(bill.grandTotal) : Math.max(0, subtotal + gst - discount));

  const rawItems = (Array.isArray(bill.lineItems) && bill.lineItems.length > 0)
    ? bill.lineItems
    : ((Array.isArray(bill.items) && bill.items.length > 0) ? bill.items : []);

  // 1. Scannable Soft Copy QR Code URL
  const qrUrl = bill.softCopyUrl || bill.invoiceUrl || `https://zamorin.cafe/qr/v1/inv/${encodeURIComponent(invoiceNum)}`;
  const qrSize = paperWidth === '58' ? 76 : 96;
  let qrSvgMarkup = '';
  try {
    const rawSvg = generateQrSvg(qrUrl, {
      size: qrSize,
      margin: 1,
      includeLogo: false,
      darkColor: '#000000',
      lightColor: '#ffffff'
    });
    qrSvgMarkup = rawSvg.replace(
      '<svg ',
      `<svg style="width:${qrSize}px !important;height:${qrSize}px !important;display:block;margin:0 auto;" `
    );
  } catch (e) {
    qrSvgMarkup = `<div style="width:${qrSize}px;height:${qrSize}px;background:#000;margin:0 auto;"></div>`;
  }

  const docTitle = isVoid 
    ? 'TAX INVOICE — [VOID / CANCELLED]' 
    : (reprintCount > 0 ? `TAX INVOICE — [REPRINT #${reprintCount}]` : 'TAX INVOICE / RETAIL BILL');

  return `
    <div class="pos-thermal-receipt ${paperWidth === '58' ? 'paper-58mm' : 'paper-80mm'}" id="pos-thermal-receipt" data-paper-width="${paperWidth}" style="background:#ffffff;color:#000000;padding:${paperWidth === '58' ? '12px 8px' : '16px 14px'};border-radius:6px;border:1px solid #cbd5e1;box-shadow:0 4px 14px rgba(0,0,0,0.06);font-family:var(--font-mono, 'Courier New', Courier, monospace);max-width:${paperWidth === '58' ? '250px' : '360px'};margin:0 auto;box-sizing:border-box;">
      
      <!-- Receipt Header: Official Monochrome Brand Logo -->
      <div class="receipt-header" style="text-align:center;margin-bottom:10px;">
        
        <!-- Official Monochrome Vector Zamorin Brand Logo -->
        <div class="receipt-brand-logo" style="display:flex;justify-content:center;margin-bottom:6px;">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 670 220" style="height:${paperWidth === '58' ? '30px' : '38px'} !important;width:auto !important;max-width:${paperWidth === '58' ? '135px' : '165px'} !important;display:block;" role="img" aria-label="Zamorin Estate Pvt. Ltd.">
            <defs>
              <g id="zam_th_icn_${paperWidth}">
                <rect x="6" y="6" width="188" height="188" rx="52" fill="#000000"/>
                <rect x="22" y="22" width="156" height="156" rx="38" fill="none" stroke="#ffffff" stroke-width="3"/>
                <path d="M 58 68 L 142 68 L 58 132 L 142 132" fill="none" stroke="#ffffff" stroke-width="18" stroke-linecap="round" stroke-linejoin="round"/>
              </g>
            </defs>
            <use href="#zam_th_icn_${paperWidth}" transform="translate(20,15) scale(0.95)"/>
            <g transform="translate(250,0)" fill="#000000">
              <text x="3" y="99" font-family="'Playfair Display', Georgia, serif" font-weight="700" font-size="80" letter-spacing="3">ZAMORIN</text>
              <text x="5" y="162" font-family="'Poppins', sans-serif" font-weight="400" font-size="22" letter-spacing="12">ESTATE</text>
              <line x1="3" y1="178" x2="400" y2="178" stroke="#000000" stroke-width="2"/>
              <text x="5" y="200" font-family="'Poppins', sans-serif" font-weight="600" font-size="13" letter-spacing="5">PVT. LTD.</text>
            </g>
          </svg>
        </div>

        <div class="receipt-title" style="font-size:${paperWidth === '58' ? '13px' : '15px'};font-weight:900;letter-spacing:0.04em;color:#000000;margin-top:2px;">
          ${escapeHtml(cafeName.toUpperCase())}
        </div>
        <div class="receipt-subtitle" style="font-size:${paperWidth === '58' ? '9px' : '10.5px'};color:#334155;margin-top:2px;line-height:1.3;">
          ${escapeHtml(address)}
        </div>
        <div style="font-size:${paperWidth === '58' ? '9px' : '10px'};font-weight:800;color:#000000;margin-top:2px;">
          GSTIN: ${escapeHtml(gstin)}
        </div>
        <div class="receipt-doc-type" style="font-size:${paperWidth === '58' ? '10px' : '11px'};font-weight:900;margin-top:5px;display:inline-block;border:1.5px solid #000000;padding:2px 8px;border-radius:3px;color:#000000;letter-spacing:0.04em;">
          ${escapeHtml(docTitle)}
        </div>
      </div>

      <!-- Receipt Meta Grid -->
      <div style="border-top:1px dashed #000000;border-bottom:1px dashed #000000;padding:6px 0;margin-bottom:8px;font-size:${paperWidth === '58' ? '10px' : '11px'};line-height:1.45;">
        <div class="receipt-row" style="display:flex;justify-content:space-between;">
          <span>INVOICE: <strong>${escapeHtml(invoiceNum)}</strong></span>
          <span>${escapeHtml(timeStr)}</span>
        </div>
        <div class="receipt-row" style="display:flex;justify-content:space-between;color:#334155;">
          <span>DATE: ${escapeHtml(dateStr)}</span>
          <span>REGISTER 01</span>
        </div>
        ${bill.tableNumber || bill.tableNo ? `
        <div class="receipt-row" style="display:flex;justify-content:space-between;">
          <span>TABLE / TOKEN:</span>
          <strong>${escapeHtml(bill.tableNumber || bill.tableNo)}</strong>
        </div>` : ''}
        ${bill.cashierName || bill.cashierUserId ? `
        <div class="receipt-row" style="display:flex;justify-content:space-between;color:#334155;">
          <span>CASHIER:</span>
          <span>${escapeHtml(bill.cashierName || bill.cashierUserId)}</span>
        </div>` : ''}
        ${bill.customerName && bill.customerName !== 'Johnson Doe' ? `
        <div class="receipt-row" style="display:flex;justify-content:space-between;color:#334155;">
          <span>GUEST:</span>
          <span>${escapeHtml(bill.customerName)}</span>
        </div>` : ''}
        ${bill.b2bCustomerGstin ? `
        <div class="receipt-row" style="display:flex;justify-content:space-between;color:#000000;font-weight:800;">
          <span>B2B GSTIN:</span>
          <span>${escapeHtml(bill.b2bCustomerGstin)}</span>
        </div>` : ''}
      </div>

      <!-- Table Header -->
      <div class="receipt-item-line" style="display:flex;font-weight:900;color:#000000;border-bottom:1px solid #000000;padding-bottom:3px;margin-bottom:5px;font-size:${paperWidth === '58' ? '9.5px' : '10.5px'};">
        <span style="width:20px;">Sl.</span>
        <span style="flex:1;">Item</span>
        <span style="width:28px;text-align:center;">Qty</span>
        <span style="width:58px;text-align:right;">Amount</span>
      </div>

      <!-- Item Rows -->
      <div style="margin-bottom:8px;">
        ${rawItems.map((li, idx) => {
          const name = li.name || li.itemNameSnapshot || li.itemName || 'Item';
          const qty = li.quantity || 1;
          const unitPrice = li.unitPricePaisa ? li.unitPricePaisa / 100 : (li.price || 0);
          const lineTotal = li.lineTotalPaisa ? li.lineTotalPaisa / 100 : (unitPrice * qty);
          const modifier = li.modifiers?.size && li.modifiers.size !== 'Regular' ? li.modifiers.size : null;
          const note = li.itemNotes || li.notes || null;

          return `
            <div class="receipt-item-line" style="display:flex;padding:2px 0;font-size:${paperWidth === '58' ? '10px' : '11px'};line-height:1.35;">
              <span style="width:20px;color:#475569;">${idx + 1}.</span>
              <span style="flex:1;font-weight:700;color:#000000;">
                ${escapeHtml(name)}
                ${modifier ? `<br/><small style="color:#475569;font-size:9px;font-weight:normal;">* ${escapeHtml(modifier)}</small>` : ''}
                ${note ? `<br/><small style="color:#475569;font-size:9px;font-weight:normal;">* Note: ${escapeHtml(note)}</small>` : ''}
              </span>
              <span style="width:28px;text-align:center;font-weight:800;">${qty}</span>
              <span style="width:58px;text-align:right;font-weight:800;">₹${lineTotal.toFixed(0)}</span>
            </div>
          `;
        }).join('')}
      </div>

      <!-- Financial Totals -->
      <div style="border-top:1px dashed #000000;padding-top:6px;font-size:${paperWidth === '58' ? '10px' : '11.5px'};line-height:1.45;">
        <div class="receipt-row" style="display:flex;justify-content:space-between;">
          <span>Subtotal:</span>
          <span>₹${subtotal.toFixed(2)}</span>
        </div>
        ${discount > 0 ? `
        <div class="receipt-row" style="display:flex;justify-content:space-between;font-weight:700;">
          <span>Discount:</span>
          <span>- ₹${discount.toFixed(2)}</span>
        </div>` : ''}
        <div class="receipt-row" style="display:flex;justify-content:space-between;color:#334155;">
          <span>CGST (2.5%):</span>
          <span>₹${(gst / 2).toFixed(2)}</span>
        </div>
        <div class="receipt-row" style="display:flex;justify-content:space-between;color:#334155;">
          <span>SGST (2.5%):</span>
          <span>₹${(gst / 2).toFixed(2)}</span>
        </div>
        ${bill.roundOffPaisa && bill.roundOffPaisa !== 0 ? `
        <div class="receipt-row" style="display:flex;justify-content:space-between;color:#475569;font-size:9.5px;">
          <span>Round Off:</span>
          <span>${bill.roundOffPaisa < 0 ? `- ₹${(Math.abs(bill.roundOffPaisa) / 100).toFixed(2)}` : `+ ₹${(bill.roundOffPaisa / 100).toFixed(2)}`}</span>
        </div>` : ''}

        <div class="receipt-total-row" style="display:flex;justify-content:space-between;font-size:${paperWidth === '58' ? '13px' : '15px'};font-weight:900;border-top:1.5px solid #000000;margin-top:6px;padding-top:6px;">
          <span>PAID TOTAL:</span>
          <span>₹${grandTotal.toFixed(2)}</span>
        </div>
      </div>

      <!-- Tender & Greeting Footer -->
      <div class="receipt-footer" style="text-align:center;margin-top:8px;font-size:${paperWidth === '58' ? '9px' : '10px'};color:#334155;">
        Tender: <strong>${escapeHtml(String(bill.paymentMethod || 'UPI').toUpperCase())}</strong> · THANK YOU FOR VISITING ZAMORIN!
      </div>

      <!-- Official Soft Copy QR Code Block -->
      <div class="receipt-qr-container" style="text-align:center;margin-top:12px;padding-top:10px;border-top:1px dashed #000000;">
        <div style="display:inline-flex;padding:5px;background:#ffffff;border:1px solid #cbd5e1;border-radius:6px;">
          ${qrSvgMarkup}
        </div>
        <div style="font-size:${paperWidth === '58' ? '8.5px' : '9.5px'};font-weight:900;letter-spacing:0.06em;text-transform:uppercase;color:#000000;margin-top:5px;">
          SCAN FOR DIGITAL TAX INVOICE
        </div>
        <div style="font-size:${paperWidth === '58' ? '7.5px' : '8px'};font-weight:700;color:#334155;margin-top:1px;">
          Official E-Invoice Soft Copy
        </div>
        <div style="font-size:7px;font-family:monospace;color:#64748b;margin-top:2px;word-break:break-all;">
          ${escapeHtml(qrUrl)}
        </div>
      </div>

    </div>
  `;
}
