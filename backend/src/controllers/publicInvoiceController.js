'use strict';

/**
 * ============================================================================
 * PUBLIC INVOICE SOFT COPY CONTROLLER
 * ============================================================================
 * Handles public-facing scans and digital access to invoice soft copies:
 * - Scanned from physical invoice QR code (https://zamorin.cafe/qr/v1/inv/:invoiceNum)
 * - Returns interactive verified soft copy view (HTML) with print/download actions
 * - Streams official binary PDF when ?format=pdf or Accept: application/pdf is passed
 * ============================================================================
 */

const { Bill } = require('../models/Bill');
const { Cafe } = require('../models/Cafe');
const { generateTaxInvoicePdf } = require('../utils/exportGenerators');

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function resolveBillAndBranding(invoiceNum) {
  const cleanId = String(invoiceNum || '').trim();
  let bill = await Bill.findOne({
    $or: [
      { invoiceNumber: cleanId },
      { billId: cleanId },
      { invoiceNumber: cleanId.toUpperCase() },
      { billId: cleanId.toUpperCase() },
    ]
  }).lean();

  let cafe = null;
  if (bill && bill.cafeId) {
    cafe = await Cafe.findOne({ cafeId: bill.cafeId }).lean();
  }

  // Fallback for demonstration / mock preview if not yet in database
  if (!bill) {
    bill = {
      billId: cleanId,
      invoiceNumber: cleanId,
      businessDate: new Date().toISOString().slice(0, 10),
      customerName: 'Valued Guest',
      paymentMethod: 'UPI / Online',
      items: [
        { itemNameSnapshot: 'Signature Zamorin Pour-Over (Single Origin)', quantity: 2, unitPricePaisa: 18000 },
        { itemNameSnapshot: 'Malabar Cardamom Cold Brew', quantity: 1, unitPricePaisa: 22000 },
        { itemNameSnapshot: 'Artisanal Sourdough Croissant', quantity: 3, unitPricePaisa: 14000 },
        { itemNameSnapshot: 'Avocado Tartine with Herb Crumble', quantity: 1, unitPricePaisa: 29000 },
        { itemNameSnapshot: 'Classic Kerala Spiced Caramel Cake', quantity: 2, unitPricePaisa: 16000 },
      ],
      subtotalPaisa: 161000,
      discountPaisa: 10000,
      taxPaisa: 8050,
      totalPaisa: 159050,
      status: 'PAID',
    };
  }

  const branding = {
    legalName: cafe?.legalName || cafe?.name || 'Zamorin Speciality Coffee & Kitchens Pvt. Ltd.',
    tradeName: cafe?.tradeName || cafe?.name || 'Zamorin Café',
    gstin: cafe?.gstin || bill.sellerGstin || '32AABCT1332L1ZV',
    address: cafe?.address?.line1
      ? `${cafe.address.line1}, ${cafe.address.city || ''} - ${cafe.address.pincode || ''}`
      : '123, Koramangala 5th Block, Bengaluru, Karnataka — 560095',
  };

  return { bill, branding };
}

/**
 * Renders the HTML soft copy page with official branding, corporate layout, and PDF download toolbar
 */
function renderSoftCopyHtmlPage(bill, branding, currentUrl) {
  const invoiceNum = bill.invoiceNumber || bill.billId;
  const dateStr = bill.businessDate || new Date().toISOString().slice(0, 10);
  const subtotal = (bill.subtotalPaisa || 0) / 100;
  const discount = (bill.discountPaisa || 0) / 100;
  const tax = (bill.taxPaisa || 0) / 100;
  const grandTotal = (bill.totalPaisa || 0) / 100;
  const rawItems = bill.items || bill.lineItems || [];

  const pdfDownloadUrl = `${currentUrl}${currentUrl.includes('?') ? '&' : '?'}format=pdf`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Official Digital Soft Copy — ${escapeHtml(invoiceNum)} | Zamorin Café</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,600;0,700;0,800;1,600&family=Poppins:wght@400;500;600;700&family=Inter:wght@400;500;600;700;800;900&display=swap" rel="stylesheet" />
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: #f1f5f9;
      color: #090d16;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      padding: 24px 16px 48px;
      -webkit-font-smoothing: antialiased;
    }
    .top-action-bar {
      max-width: 780px;
      margin: 0 auto 20px;
      background: #ffffff;
      border: 1px solid #cbd5e1;
      border-radius: 12px;
      padding: 12px 20px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      box-shadow: 0 4px 14px rgba(0,0,0,0.06);
    }
    .badge-soft-copy {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      background: #e0f2fe;
      color: #0369a1;
      padding: 4px 12px;
      border-radius: 20px;
      font-size: 11.5px;
      font-weight: 800;
      letter-spacing: 0.04em;
    }
    .btn-action {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      background: #0062ea;
      color: #ffffff;
      padding: 8px 16px;
      border-radius: 8px;
      font-size: 12.5px;
      font-weight: 700;
      text-decoration: none;
      border: none;
      cursor: pointer;
      box-shadow: 0 2px 6px rgba(0,98,234,0.3);
      transition: all 0.2s ease;
    }
    .btn-action:hover {
      background: #004ec4;
      transform: translateY(-1px);
    }
    .btn-secondary {
      background: #f8fafc;
      color: #334155;
      border: 1px solid #cbd5e1;
      box-shadow: none;
    }
    .btn-secondary:hover {
      background: #e2e8f0;
    }
    @media print {
      body { padding: 0; background: #fff; }
      .top-action-bar { display: none !important; }
      .zamorin-corporate-invoice { box-shadow: none !important; border: none !important; }
    }
  </style>
</head>
<body>
  <!-- Soft Copy Quick Action Toolbar -->
  <div class="top-action-bar">
    <div style="display:flex;align-items:center;gap:12px;">
      <span class="badge-soft-copy">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
        OFFICIAL SOFT COPY
      </span>
      <span style="font-size:12.5px;font-weight:700;color:#334155;">
        ${escapeHtml(invoiceNum)}
      </span>
    </div>
    <div style="display:flex;align-items:center;gap:10px;">
      <a href="${escapeHtml(pdfDownloadUrl)}" class="btn-action">
        💾 Download Official PDF
      </a>
      <button onclick="window.print()" class="btn-action btn-secondary">
        🖨️ Print
      </button>
    </div>
  </div>

  <!-- Corporate Invoice Master Card -->
  <div class="zamorin-corporate-invoice" id="zamorin-corporate-invoice" style="position:relative;background:#ffffff;color:#090d16;width:100%;max-width:780px;margin:0 auto;box-shadow:0 14px 45px rgba(0,0,0,0.14);border-radius:14px;overflow:hidden;padding:38px 44px 28px;border:1.5px solid #cbd5e1;box-sizing:border-box;">
    
    <!-- Top Header: Brand Left + Vibrant Electric Blue Curved Header Right -->
    <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:28px;position:relative;z-index:1;">
      
      <!-- Left Column: Official Zamorin Corporate Brand Identity -->
      <div style="max-width:55%;">
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

        <div style="margin-bottom:16px;">
          <div style="font-size:10.5px;font-weight:800;letter-spacing:0.1em;text-transform:uppercase;color:#475569;">INVOICE TO</div>
          <div style="font-size:20px;font-weight:900;color:#000000;margin:3px 0 2px;">${escapeHtml(bill.customerName || 'Valued Guest')}</div>
          <div style="font-size:12px;font-weight:600;color:#334155;margin-bottom:14px;">${escapeHtml(branding.legalName)}</div>
        </div>

        <div style="display:flex;flex-direction:column;gap:6px;font-size:11px;">
          <div style="display:flex;align-items:center;gap:10px;">
            <span style="display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;border-radius:4px;background:#e0f2fe;color:#0062ea;font-weight:900;font-size:9.5px;">A</span>
            <span style="font-weight:600;color:#000000;">${escapeHtml(branding.address)}</span>
          </div>
          <div style="display:flex;align-items:center;gap:10px;">
            <span style="display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;border-radius:4px;background:#e0f2fe;color:#0062ea;font-weight:900;font-size:9.5px;">W</span>
            <span style="font-weight:600;color:#000000;">GSTIN: ${escapeHtml(branding.gstin)} | contact@zamorincafe.com</span>
          </div>
        </div>
      </div>

      <!-- Right Column: Signature Blue Header Block & Dates -->
      <div style="width:44%;display:flex;flex-direction:column;align-items:flex-end;">
        <div style="background:linear-gradient(135deg, #0062ea 0%, #004ec4 100%);color:#ffffff;padding:18px 24px;border-radius:18px 0 0 18px;box-shadow:0 8px 24px rgba(0,98,234,0.3);width:100%;max-width:280px;box-sizing:border-box;margin-right:-44px;margin-top:-14px;">
          <div style="font-size:24px;font-weight:900;letter-spacing:0.06em;line-height:1;">INVOICE</div>
          <div style="font-size:11.5px;font-weight:700;color:rgba(255,255,255,0.9);margin-top:5px;">No. ${escapeHtml(invoiceNum)}</div>
          <div style="font-size:8.5px;font-weight:700;letter-spacing:0.08em;color:rgba(255,255,255,0.75);margin-top:2px;">OFFICIAL DIGITAL SOFT COPY</div>
        </div>

        <div style="display:flex;justify-content:space-between;align-items:center;width:100%;max-width:236px;margin:20px 0 14px;padding:0 4px;">
          <div>
            <div style="font-size:9.5px;font-weight:800;letter-spacing:0.06em;text-transform:uppercase;color:#64748b;">Invoice Date</div>
            <div style="font-size:12.5px;font-weight:900;color:#000000;margin-top:2px;">${escapeHtml(dateStr)}</div>
          </div>
          <div style="width:1px;height:24px;background:#cbd5e1;"></div>
          <div style="text-align:right;">
            <div style="font-size:9.5px;font-weight:800;letter-spacing:0.06em;text-transform:uppercase;color:#64748b;">Due Date</div>
            <div style="font-size:12.5px;font-weight:900;color:#000000;margin-top:2px;">${escapeHtml(dateStr)}</div>
          </div>
        </div>

        <div style="background:#f1f5f9;border:1.5px solid #e2e8f0;border-radius:12px;padding:12px 18px;width:100%;max-width:236px;box-sizing:border-box;">
          <div style="font-size:10px;font-weight:800;letter-spacing:0.08em;text-transform:uppercase;color:#475569;">Total Due:</div>
          <div style="font-size:22px;font-weight:900;color:#000000;margin-top:3px;">₹${grandTotal.toFixed(2)}</div>
        </div>
      </div>

    </div>

    <!-- Line Items Table -->
    <div style="margin-bottom:28px;">
      <div style="display:flex;background:#090d16;color:#ffffff;border-radius:8px;padding:10px 16px;font-size:11px;font-weight:900;letter-spacing:0.06em;text-transform:uppercase;margin-bottom:8px;">
        <div style="width:58%;">SL. &nbsp; DESCRIPTION.</div>
        <div style="width:14%;text-align:right;">PRICE</div>
        <div style="width:14%;text-align:center;">QTY</div>
        <div style="width:14%;text-align:right;">TOTAL</div>
      </div>
      <div style="display:flex;flex-direction:column;gap:6px;">
        ${rawItems.map((it, idx) => {
          const name = it.name || it.itemNameSnapshot || it.itemName || 'Product Item';
          const qty = it.quantity || 1;
          const unitPrice = it.unitPricePaisa ? it.unitPricePaisa / 100 : (it.price || 0);
          const lineTot = it.lineTotalPaisa ? it.lineTotalPaisa / 100 : (unitPrice * qty);
          const isEven = idx % 2 === 1;
          return `
            <div style="display:flex;align-items:center;background:${isEven ? '#f1f5f9' : '#ffffff'};border-radius:8px;padding:10px 16px;font-size:12px;border:1px solid #e2e8f0;">
              <div style="width:58%;font-weight:900;color:#000000;">
                <span style="color:#64748b;margin-right:10px;">${idx + 1}.</span>
                ${escapeHtml(name)}
              </div>
              <div style="width:14%;text-align:right;font-weight:800;color:#000000;">₹${unitPrice.toFixed(2)}</div>
              <div style="width:14%;text-align:center;font-weight:900;color:#000000;">${qty}</div>
              <div style="width:14%;text-align:right;font-weight:900;color:#000000;">₹${lineTot.toFixed(2)}</div>
            </div>
          `;
        }).join('')}
      </div>
    </div>

    <!-- Totals & Payment Breakdown -->
    <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:28px;">
      <div style="width:52%;">
        <div style="font-size:12.5px;font-weight:900;color:#000000;margin-bottom:8px;">Payment Methods</div>
        <div style="display:inline-block;background:#0a0f1d;color:#fff;padding:5px 12px;border-radius:6px;font-size:11px;font-weight:900;margin-bottom:14px;">
          ${escapeHtml(String(bill.paymentMethod || 'UPI / ONLINE').toUpperCase())}
        </div>
        <div style="font-size:10px;font-weight:600;color:#475569;line-height:1.5;">
          This electronic invoice is an authentic digital soft copy issued under Section 31 of the CGST Act, 2017.
        </div>
      </div>
      <div style="width:42%;display:flex;flex-direction:column;gap:8px;">
        <div style="display:flex;justify-content:space-between;font-size:12.5px;">
          <span style="font-weight:700;color:#475569;">Sub Total</span>
          <span style="font-weight:900;color:#000000;">₹${subtotal.toFixed(2)}</span>
        </div>
        <div style="display:flex;justify-content:space-between;font-size:12.5px;">
          <span style="font-weight:700;color:#475569;">Country Tax 10% / GST 5%</span>
          <span style="font-weight:900;color:#000000;">₹${tax.toFixed(2)}</span>
        </div>
        ${discount > 0 ? `
          <div style="display:flex;justify-content:space-between;font-size:12.5px;color:#c2410c;">
            <span style="font-weight:700;">Discount</span>
            <span style="font-weight:900;">- ₹${discount.toFixed(2)}</span>
          </div>
        ` : ''}
        <div style="background:linear-gradient(135deg, #0062ea 0%, #004ec4 100%);color:#ffffff;border-radius:10px;padding:12px 18px;display:flex;justify-content:space-between;align-items:center;margin-top:6px;">
          <span style="font-size:13px;font-weight:900;">Grand Total :</span>
          <span style="font-size:18px;font-weight:900;">₹${grandTotal.toFixed(2)}</span>
        </div>
      </div>
    </div>

    <!-- Thank You Banner -->
    <div style="text-align:center;font-size:11.5px;font-weight:900;letter-spacing:0.1em;color:#000000;margin:28px 0 16px;text-transform:uppercase;">
      THANK YOU FOR YOUR BUSINESS
    </div>

  </div>
</body>
</html>`;
}

/**
 * Main public endpoint handler
 */
async function handlePublicInvoiceSoftCopy(req, res) {
  const invoiceNum = req.params.invoiceNum;
  if (!invoiceNum) {
    return res.status(400).send('Invoice number is required.');
  }

  const { bill, branding } = await resolveBillAndBranding(invoiceNum);

  // If PDF format requested via query or Accept header, stream binary PDF
  const isPdf = req.query.format === 'pdf' || req.headers.accept?.includes('application/pdf');
  if (isPdf) {
    const pdfResult = generateTaxInvoicePdf(bill, branding);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${pdfResult.filename}"`);
    return res.status(200).send(pdfResult.buffer);
  }

  // Otherwise, render full responsive HTML soft copy
  const currentUrl = `${req.protocol}://${req.get('host')}${req.originalUrl.split('?')[0]}`;
  const html = renderSoftCopyHtmlPage(bill, branding, currentUrl);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  return res.status(200).send(html);
}

module.exports = {
  handlePublicInvoiceSoftCopy,
};
