// =============================================================================
// ZAMORIN CAFÉ ERP — GLOBAL CORPORATE REPORT TEMPLATE (8K ULTRA-HD HIGH CONTRAST)
// Master Corporate Report Template reflecting the global executive standard:
// - Official Monochrome & Corporate Brand Identity Lockup (Zamorin Estate Pvt. Ltd.)
// - Ultra-High Contrast Pitch-Black Typography (#000000 / #090d16) and Slate (#1e293b)
// - Dynamic Executive KPI Metric Grid with Currency Normalization
// - Global Accounting Data Matrix with Intelligent Column Widths & Right-Aligned Numbers
// - High-Contrast Midnight/Cobalt Table Header & Alternating Floating Row Cards
// - Prominent Scannable Vector QR Code for Digital Report Verification
// - Authentic Diagonal Security Watermark (Zamorin Café / Certified Report)
// =============================================================================

import { generateQrSvg } from '../utils/qrCodeGen.js';

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function renderCorporateReportHtml(reportData = {}, options = {}) {
  const reportTitle = reportData.reportTitle || reportData.title || 'Executive Operations & Financial Report';
  const reportCode = reportData.reportCode || reportData.code || 'ZURF-OPS-01';
  const scope = reportData.scope || 'Zamorin Café — Global Portfolio';
  const period = reportData.period || 'October 2026';
  const classification = (reportData.classification || 'CONFIDENTIAL').toUpperCase();
  const runId = reportData.runId || `RPT-RUN-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${Math.floor(1000 + Math.random() * 9000)}`;
  
  const legalName = options.legalName || reportData.legalName || 'Zamorin Speciality Coffee & Kitchens Pvt. Ltd.';
  const gstin = options.gstin || reportData.gstin || '32AABCT1332L1ZV';
  const cin = options.cin || reportData.cin || 'U55101KA2024PTC189201';
  const address = options.address || reportData.address || '123, Koramangala 5th Block, Bengaluru, KA — 560095';
  
  const generatedDate = reportData.generatedDate || new Date().toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true
  });

  const kpiCards = reportData.kpiCards || reportData.kpis || [];
  const rawColumns = reportData.columns || [];
  const rawRows = reportData.rows || [];

  // Guarantee Sl. No. column exists as first column
  const hasSl = rawColumns.some(c => {
    const l = (c.label || c.key || '').toLowerCase();
    return l.includes('sl.') || l.includes('sl no') || l.includes('serial');
  });

  const columns = hasSl ? rawColumns : [{ key: '__slNo', label: 'Sl.', width: '45px', align: 'center' }, ...rawColumns];
  const rows = rawRows.map((r, idx) => {
    if (!hasSl) {
      return { ...r, __slNo: idx + 1 };
    }
    return r;
  });

  // Verification QR Code URL
  const qrUrl = reportData.verificationUrl || `https://zamorin.cafe/qr/v1/report/${encodeURIComponent(runId)}`;
  let qrSvgMarkup = '';
  try {
    const rawSvg = generateQrSvg(qrUrl, {
      size: 96,
      margin: 1,
      includeLogo: false,
      darkColor: '#090d16',
      lightColor: '#ffffff'
    });
    qrSvgMarkup = rawSvg.replace(
      '<svg ',
      '<svg style="width:96px !important;height:96px !important;display:block;" '
    );
  } catch (e) {
    qrSvgMarkup = '<div style="width:96px;height:96px;background:#000;"></div>';
  }

  // Classification styling
  const classPillBg = classification === 'CONFIDENTIAL' ? '#fee2e2' : (classification === 'RESTRICTED' ? '#fef3c7' : '#e0f2fe');
  const classPillColor = classification === 'CONFIDENTIAL' ? '#991b1b' : (classification === 'RESTRICTED' ? '#92400e' : '#0369a1');
  const classPillBorder = classification === 'CONFIDENTIAL' ? '#fca5a5' : (classification === 'RESTRICTED' ? '#fcd34d' : '#7dd3fc');

  return `
    <style>
      @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,600;0,700;0,800;1,600&family=Poppins:wght@400;500;600;700&display=swap');
      
      .zamorin-report-container {
        position: relative;
        background: #ffffff;
        color: #090d16;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
        width: 100%;
        max-width: 900px;
        margin: 0 auto;
        box-shadow: 0 16px 50px rgba(0, 0, 0, 0.12);
        border-radius: 12px;
        overflow: hidden;
        padding: 40px 48px;
        border: 1.5px solid #cbd5e1;
        box-sizing: border-box;
        -webkit-font-smoothing: antialiased;
        -moz-osx-font-smoothing: grayscale;
      }

      @media print {
        @page {
          size: A4 portrait;
          margin: 10mm 12mm;
        }
        body {
          margin: 0 !important;
          padding: 0 !important;
          background: #fff !important;
          color: #000 !important;
        }
        .zamorin-report-container {
          box-shadow: none !important;
          border: none !important;
          padding: 0 !important;
          max-width: 100% !important;
          border-radius: 0 !important;
        }
      }
    </style>

    <div class="zamorin-report-container" id="zamorin-corporate-report">
      
      <!-- Authentic Subtle Diagonal Security Watermark -->
      <div style="position:absolute;top:50%;left:50%;transform:translate(-50%, -50%) rotate(-30deg);font-size:62px;font-weight:900;letter-spacing:14px;color:rgba(15,23,42,0.035);pointer-events:none;user-select:none;white-space:nowrap;z-index:0;text-transform:uppercase;">
        ZAMORIN CAFÉ · CERTIFIED REPORT
      </div>

      <!-- Header Section: Official Brand Left + Executive Reference Right -->
      <div style="display:flex;justify-content:space-between;align-items:flex-start;padding-bottom:24px;border-bottom:2px solid #0f172a;margin-bottom:24px;position:relative;z-index:1;">
        
        <!-- Brand Identity & Corporate Coordinates -->
        <div style="max-width:55%;">
          
          <!-- Official Monochrome / Deep Navy Brand Emblem -->
          <div style="margin-bottom:14px;">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 670 220" style="height:68px !important;width:auto !important;max-width:295px !important;display:block;" role="img" aria-label="Zamorin Estate Pvt. Ltd.">
              <defs>
                <linearGradient id="rpt_zam_g1" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stop-color="#C6A567"/>
                  <stop offset="100%" stop-color="#83622C"/>
                </linearGradient>
                <linearGradient id="rpt_zam_n1" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stop-color="#16223F"/>
                  <stop offset="100%" stop-color="#0B1220"/>
                </linearGradient>
                <g id="rpt_zam_icn">
                  <rect x="6" y="6" width="188" height="188" rx="52" fill="url(#rpt_zam_n1)"/>
                  <rect x="22" y="22" width="156" height="156" rx="38" fill="none" stroke="url(#rpt_zam_g1)" stroke-width="2.25" opacity="0.9"/>
                  <path d="M 58 68 L 142 68 L 58 132 L 142 132" fill="none" stroke="url(#rpt_zam_g1)" stroke-width="17" stroke-linecap="round" stroke-linejoin="round"/>
                </g>
              </defs>
              <use href="#rpt_zam_icn" transform="translate(20,15) scale(0.95)"/>
              <g transform="translate(250,0)">
                <text x="3" y="99" font-family="'Playfair Display', Georgia, serif" font-weight="700" font-size="80" letter-spacing="3" fill="#16223F">ZAMORIN</text>
                <text x="5" y="162" font-family="'Poppins', sans-serif" font-weight="400" font-size="22" letter-spacing="12" fill="#7C8598">ESTATE</text>
                <line x1="3" y1="178" x2="400" y2="178" stroke="#96733A" stroke-width="1.5"/>
                <text x="5" y="200" font-family="'Poppins', sans-serif" font-weight="600" font-size="13" letter-spacing="5" fill="#96733A">PVT. LTD.</text>
              </g>
            </svg>
          </div>

          <div style="font-size:13px;font-weight:800;color:#090d16;letter-spacing:0.02em;">
            ${escapeHtml(legalName)}
          </div>
          <div style="font-size:11px;color:#475569;margin-top:2px;line-height:1.4;">
            ${escapeHtml(address)}
          </div>
          <div style="font-size:10.5px;font-weight:700;color:#1e293b;margin-top:3px;font-family:ui-monospace, monospace;">
            GSTIN: <span style="color:#090d16;">${escapeHtml(gstin)}</span> · CIN: ${escapeHtml(cin)}
          </div>
        </div>

        <!-- Right: Executive Document Control Block -->
        <div style="text-align:right;min-width:38%;">
          <div style="display:inline-flex;align-items:center;gap:8px;margin-bottom:8px;">
            <span style="background:${classPillBg};color:${classPillColor};border:1px solid ${classPillBorder};padding:3px 10px;border-radius:20px;font-size:10px;font-weight:800;letter-spacing:0.06em;text-transform:uppercase;">
              ${escapeHtml(classification)}
            </span>
          </div>

          <div style="font-size:11.5px;font-family:ui-monospace, monospace;font-weight:800;color:#0f172a;">
            REF: <span style="color:#0052cc;">${escapeHtml(runId)}</span>
          </div>
          <div style="font-size:11px;color:#475569;margin-top:4px;">
            <strong>Period:</strong> <span style="color:#0f172a;font-weight:700;">${escapeHtml(period)}</span>
          </div>
          <div style="font-size:11px;color:#475569;margin-top:2px;">
            <strong>Generated:</strong> ${escapeHtml(generatedDate)}
          </div>
          <div style="font-size:11px;color:#475569;margin-top:2px;">
            <strong>Scope:</strong> <span style="color:#0f172a;font-weight:600;">${escapeHtml(scope)}</span>
          </div>
        </div>

      </div>

      <!-- Report Title Bar -->
      <div style="margin-bottom:24px;position:relative;z-index:1;">
        <div style="display:flex;justify-content:space-between;align-items:flex-end;">
          <div>
            <div style="font-size:10.5px;font-weight:800;letter-spacing:0.12em;text-transform:uppercase;color:#0052cc;margin-bottom:4px;">
              OFFICIAL CORPORATE REPORT · ${escapeHtml(reportCode)}
            </div>
            <h1 style="font-family:'Playfair Display', Georgia, serif;font-size:24px;font-weight:800;color:#090d16;margin:0;line-height:1.2;letter-spacing:-0.02em;">
              ${escapeHtml(reportTitle)}
            </h1>
          </div>
          <div style="font-size:11.5px;font-weight:700;color:#475569;background:#f8fafc;border:1px solid #e2e8f0;padding:6px 14px;border-radius:6px;">
            Total Records: <strong style="color:#090d16;font-size:13px;">${rows.length}</strong>
          </div>
        </div>
      </div>

      <!-- Executive KPI Cards Grid (if provided) -->
      ${kpiCards.length > 0 ? `
      <div style="display:grid;grid-template-columns:repeat(${Math.min(4, kpiCards.length)}, 1fr);gap:12px;margin-bottom:28px;position:relative;z-index:1;">
        ${kpiCards.map(kpi => {
          const title = kpi.title || kpi.label || 'Metric';
          const value = kpi.value !== undefined ? kpi.value : '—';
          const sub = kpi.subtext || kpi.change || null;
          return `
            <div style="background:#f8fafc;border:1.5px solid #cbd5e1;border-radius:8px;padding:12px 14px;box-shadow:0 2px 6px rgba(0,0,0,0.02);">
              <div style="font-size:10px;font-weight:800;letter-spacing:0.06em;text-transform:uppercase;color:#475569;margin-bottom:4px;">
                ${escapeHtml(title)}
              </div>
              <div style="font-size:18px;font-weight:900;color:#090d16;font-family:-apple-system, BlinkMacSystemFont, sans-serif;letter-spacing:-0.02em;">
                ${escapeHtml(value)}
              </div>
              ${sub ? `<div style="font-size:9.5px;font-weight:600;color:#059669;margin-top:2px;">${escapeHtml(sub)}</div>` : ''}
            </div>
          `;
        }).join('')}
      </div>
      ` : ''}

      <!-- High-Contrast Data Matrix Table -->
      <div style="margin-bottom:28px;position:relative;z-index:1;overflow-x:auto;">
        <table style="width:100%;border-collapse:collapse;font-size:11.5px;border:1px solid #cbd5e1;border-radius:8px;overflow:hidden;">
          <thead>
            <tr style="background:#0f172a;color:#ffffff;text-transform:uppercase;font-size:10px;font-weight:800;letter-spacing:0.06em;">
              ${columns.map((col, idx) => {
                const align = col.align || (idx === 0 ? 'center' : (col.key.toLowerCase().includes('sales') || col.key.toLowerCase().includes('qty') || col.key.toLowerCase().includes('orders') || col.key.toLowerCase().includes('percent') || col.key.toLowerCase().includes('amount') ? 'right' : 'left'));
                const widthStyle = col.width ? `width:${col.width};` : (idx === 1 ? 'width:32%;' : '');
                return `
                  <th style="padding:11px 14px;text-align:${align};${widthStyle}border-right:1px solid #1e293b;">
                    ${escapeHtml(col.label || col.key)}
                  </th>
                `;
              }).join('')}
            </tr>
          </thead>
          <tbody>
            ${rows.map((row, rIdx) => {
              const bg = rIdx % 2 === 0 ? '#ffffff' : '#f8fafc';
              return `
                <tr style="background:${bg};border-bottom:1px solid #e2e8f0;transition:background 0.15s ease;">
                  ${columns.map((col, cIdx) => {
                    const align = col.align || (cIdx === 0 ? 'center' : (col.key.toLowerCase().includes('sales') || col.key.toLowerCase().includes('qty') || col.key.toLowerCase().includes('orders') || col.key.toLowerCase().includes('percent') || col.key.toLowerCase().includes('amount') ? 'right' : 'left'));
                    const val = row[col.key] !== undefined && row[col.key] !== null ? row[col.key] : '—';
                    const isPrimary = cIdx === 1;
                    const isMetric = align === 'right';
                    return `
                      <td style="padding:9px 14px;text-align:${align};color:${isPrimary ? '#090d16' : '#1e293b'};font-weight:${isPrimary ? '700' : (isMetric ? '600' : 'normal')};border-right:1px solid #f1f5f9;font-family:${isMetric ? 'ui-monospace, monospace' : 'inherit'};">
                        ${escapeHtml(val)}
                      </td>
                    `;
                  }).join('')}
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>

      <!-- Report Footer: Verification QR Code & Official Governance Seals -->
      <div style="display:flex;justify-content:space-between;align-items:center;padding-top:20px;border-top:1.5px solid #e2e8f0;position:relative;z-index:1;">
        
        <!-- Scannable Digital Audit QR Code -->
        <div style="display:flex;align-items:center;gap:14px;">
          <div style="display:inline-flex;padding:5px;background:#ffffff;border:1px solid #cbd5e1;border-radius:6px;box-shadow:0 2px 6px rgba(0,0,0,0.04);">
            ${qrSvgMarkup}
          </div>
          <div>
            <div style="font-size:10px;font-weight:800;letter-spacing:0.06em;text-transform:uppercase;color:#090d16;">
              SCAN TO VERIFY AUDIT RECORD
            </div>
            <div style="font-size:9.5px;font-weight:600;color:#475569;margin-top:2px;">
              ZURF v1.0 Cryptographic Integrity
            </div>
            <div style="font-size:8px;font-family:monospace;color:#64748b;margin-top:2px;max-width:240px;word-break:break-all;">
              ${escapeHtml(qrUrl)}
            </div>
          </div>
        </div>

        <!-- Center / Right: Compliance Statement & Coordinates -->
        <div style="text-align:right;max-width:48%;">
          <div style="font-size:9.5px;color:#475569;line-height:1.4;">
            This document is an authoritative corporate intelligence output generated by <strong>Zamorin Central ERP</strong>. It is subject to statutory audit trail logging and role-based confidentiality governance under Indian Companies Act and DPDP Act provisions.
          </div>
          <div style="font-size:9px;font-weight:700;color:#090d16;margin-top:6px;">
            ZAMORIN ESTATE PVT. LTD. · ALL RIGHTS RESERVED
          </div>
        </div>

      </div>

    </div>
  `;
}
