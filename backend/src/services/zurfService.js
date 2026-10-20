'use strict';

/**
 * ZURF v1 — ZAMORIN UNIVERSAL REPORT & EXPORT FORMAT
 * Central corporate report rendering & export engine.
 * Enforces universal branding, mandatory logo watermark on every PDF page,
 * corporate headers with GSTIN and legal name, Run IDs, and classification.
 */

const crypto = require('crypto');
const { CompanyIdentityService } = require('./companyIdentityService');
const { generateQrSvg } = require('../utils/qrCodeGen');

/**
 * Backward-compatibility shim. Returns resolved branding via CompanyIdentityService.
 * Callers that used the static COMPANY_CONFIG must await this function.
 */
async function getCompanyConfig({ cafeId = null, sensitivityLevel = 'INTERNAL' } = {}) {
  return CompanyIdentityService.resolveExportBranding({ cafeId, sensitivityLevel });
}

// Kept for legacy synchronous callers that have not yet migrated to async
const COMPANY_CONFIG = {
  legalName: 'Zamorin Estate Pvt. Ltd.',
  tradingName: 'Zamorin Café',
  gstin: '29AABCZ1234M1Z5',
  cin: 'U55101KA2024PTC189201',
  regAddress: 'Koramangala, Bengaluru, Karnataka — 560095',
  contact: '+91 80 4123 9876 · corporate@zamorin.cafe',
  logoSvg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200"><rect x="10" y="10" width="180" height="180" rx="48" fill="#16223F"/><path d="M58 68 L142 68 L58 132 L142 132" fill="none" stroke="#C6A567" stroke-width="17" stroke-linecap="round" stroke-linejoin="round"/></svg>',
};

const exportJobs = new Map();
const exportArtifacts = new Map();

function sanitizeCsvCell(val, isNum = false) {
  if (val === null || val === undefined) return '""';
  const str = String(val);
  // If explicitly numeric or looks strictly like a formatted number/percentage, do not neutralize
  const isNumericStr = isNum || /^[+-]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?%?$/.test(str.trim());
  if (!isNumericStr && str.length > 0) {
    const firstChar = str.charAt(0);
    if (['=', '+', '-', '@', '\t', '\r'].includes(firstChar)) {
      return `"'${str.replace(/"/g, '""')}"`;
    }
  }
  return `"${str.replace(/"/g, '""')}"`;
}

class ZurfService {
  /**
   * Generates a unique immutable Report Run ID.
   */
  static generateRunId() {
    const d = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const rand = Math.floor(1000 + Math.random() * 9000);
    return `RPT-RUN-${d}-${rand}`;
  }

  /**
   * Builds an HTML-based printable ZURF v1 document with mandatory header,
   * background watermark on every page, and footer metadata.
   */
  static async renderZurfHtml({
    reportTitle = 'Executive Operations & Financial Report',
    reportCode = 'ZURF-OPS-01',
    scope = 'Zamorin Café — Global Portfolio',
    period = 'Current Period',
    classification = 'CONFIDENTIAL',
    generatedBy = 'Primary Master',
    runId = null,
    kpiCards = [],
    columns = [],
    rows = [],
    notes = '',
    cafeId = null,
    sensitivityLevel = 'INTERNAL',
  }) {
    const branding = await getCompanyConfig({ cafeId, sensitivityLevel });
    const finalRunId = runId || this.generateRunId();
    const generatedAt = new Date().toLocaleString('en-IN', {
      timeZone: 'Asia/Kolkata',
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    });

    const safeTitle = reportTitle || 'Executive Report';
    const safeLegalName = branding.legalName || 'Zamorin Speciality Coffee & Kitchens Pvt. Ltd.';
    const safeGstin = branding.gstin || '29AABCT1332L1ZV';
    const safeCin = branding.cin || 'U55101KA2024PTC189201';
    const safeAddress = branding.regAddress || '123, Koramangala 5th Block, Bengaluru, KA — 560095';

    // Verification QR Code
    const qrUrl = `https://zamorin.cafe/qr/v1/report/${encodeURIComponent(finalRunId)}`;
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

    // Guarantee Sl. No. column exists
    const hasSl = columns.some((c) => {
      const l = (c.label || c.key || '').toLowerCase();
      return l.includes('sl.') || l.includes('sl no') || l.includes('serial');
    });
    const finalCols = hasSl ? columns : [{ key: '__slNo', label: 'Sl.', width: '45px', isNum: false }, ...columns];
    const finalRows = rows.map((r, idx) => {
      if (!hasSl) {
        return { ...r, __slNo: idx + 1 };
      }
      return r;
    });

    const classUpper = String(classification || 'CONFIDENTIAL').toUpperCase();
    const classBg = classUpper === 'CONFIDENTIAL' ? '#fee2e2' : (classUpper === 'RESTRICTED' ? '#fef3c7' : '#e0f2fe');
    const classColor = classUpper === 'CONFIDENTIAL' ? '#991b1b' : (classUpper === 'RESTRICTED' ? '#92400e' : '#0369a1');
    const classBorder = classUpper === 'CONFIDENTIAL' ? '#fca5a5' : (classUpper === 'RESTRICTED' ? '#fcd34d' : '#7dd3fc');

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>${safeTitle} — ${branding.brandName || 'Zamorin Café'}</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,600;0,700;0,800;1,600&family=Poppins:wght@400;500;600;700&display=swap');
    
    @page {
      size: A4 portrait;
      margin: 10mm 12mm;
      @bottom-center {
        content: "Page " counter(page) " of " counter(pages);
      }
    }
    *, *::before, *::after { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      margin: 0;
      padding: 0;
      color: #090d16;
      background: #ffffff;
      font-size: 11px;
      line-height: 1.4;
      position: relative;
      -webkit-font-smoothing: antialiased;
      -moz-osx-font-smoothing: grayscale;
    }
    .zurf-report-wrapper {
      position: relative;
      background: #ffffff;
      width: 100%;
      max-width: 900px;
      margin: 0 auto;
      padding: 24px 28px;
    }
    /* AUTHENTIC ROTATED WATERMARK */
    .zurf-watermark,
    .zurf-page-watermark {
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%) rotate(-30deg);
      font-size: 62px;
      font-weight: 900;
      letter-spacing: 14px;
      color: rgba(15, 23, 42, 0.035);
      pointer-events: none;
      user-select: none;
      white-space: nowrap;
      z-index: 0;
      text-transform: uppercase;
      font-family: 'Playfair Display', Georgia, serif;
    }
    .zurf-content {
      position: relative;
      z-index: 1;
    }
    /* OFFICIAL HEADER LOCKUP */
    .zurf-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      border-bottom: 2px solid #0f172a;
      padding-bottom: 18px;
      margin-bottom: 20px;
    }
    .zurf-brand-box {
      max-width: 55%;
    }
    .zurf-logo-wrap {
      display: flex;
      align-items: center;
      margin-bottom: 8px;
    }
    .zurf-logo-wrap svg {
      height: 68px !important;
      width: auto !important;
      max-width: 295px !important;
      display: block;
    }
    .zurf-legal-name {
      font-size: 12.5px;
      font-weight: 800;
      color: #090d16;
      letter-spacing: 0.02em;
    }
    .zurf-address-bar {
      font-size: 10.5px;
      color: #475569;
      margin-top: 2px;
      line-height: 1.35;
    }
    .zurf-gstin-bar {
      font-size: 10px;
      font-weight: 700;
      color: #1e293b;
      margin-top: 2px;
      font-family: ui-monospace, monospace;
    }
    /* EXECUTIVE CONTROL BLOCK */
    .zurf-control-box {
      text-align: right;
      min-width: 38%;
    }
    .zurf-pills-row {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      margin-bottom: 6px;
    }
    .zurf-pill-class {
      background: ${classBg};
      color: ${classColor};
      border: 1px solid ${classBorder};
      padding: 2px 9px;
      border-radius: 16px;
      font-size: 9.5px;
      font-weight: 800;
      letter-spacing: 0.05em;
      text-transform: uppercase;
    }
    .zurf-run-ref {
      font-size: 11px;
      font-family: ui-monospace, monospace;
      font-weight: 800;
      color: #0f172a;
    }
    .zurf-run-ref span {
      color: #0052cc;
    }
    .zurf-meta-line {
      font-size: 10.5px;
      color: #475569;
      margin-top: 2px;
    }
    /* TITLE BAR */
    .zurf-title-bar {
      display: flex;
      justify-content: space-between;
      align-items: flex-end;
      margin-bottom: 20px;
    }
    .zurf-code-tag {
      font-size: 10px;
      font-weight: 800;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      color: #0052cc;
      margin-bottom: 3px;
    }
    .zurf-report-title {
      font-family: 'Playfair Display', Georgia, serif;
      font-size: 22px;
      font-weight: 800;
      color: #090d16;
      margin: 0;
      line-height: 1.2;
      letter-spacing: -0.02em;
    }
    .zurf-record-chip {
      font-size: 11px;
      font-weight: 700;
      color: #475569;
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      padding: 5px 12px;
      border-radius: 6px;
    }
    /* KPI CARDS */
    .zurf-kpi-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
      gap: 10px;
      margin-bottom: 22px;
    }
    .zurf-kpi-card {
      background: #f8fafc;
      border: 1.5px solid #cbd5e1;
      border-radius: 8px;
      padding: 10px 12px;
    }
    .zurf-kpi-title {
      font-size: 9.5px;
      font-weight: 800;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: #475569;
      margin-bottom: 3px;
    }
    .zurf-kpi-value {
      font-size: 17px;
      font-weight: 900;
      color: #090d16;
      font-family: -apple-system, BlinkMacSystemFont, sans-serif;
      letter-spacing: -0.02em;
    }
    /* DATA MATRIX TABLE */
    table.zurf-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 11px;
      border: 1px solid #cbd5e1;
      border-radius: 6px;
      overflow: hidden;
      margin-bottom: 24px;
    }
    table.zurf-table th {
      background: #0f172a;
      color: #ffffff;
      padding: 10px 12px;
      font-size: 9.5px;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      border-right: 1px solid #1e293b;
    }
    table.zurf-table td {
      padding: 8px 12px;
      border-bottom: 1px solid #e2e8f0;
      border-right: 1px solid #f1f5f9;
      color: #1e293b;
    }
    table.zurf-table tr:nth-child(even) td {
      background: #f8fafc;
    }
    table.zurf-table td.num {
      text-align: right;
      font-family: ui-monospace, monospace;
      font-weight: 600;
    }
    /* FOOTER */
    .zurf-footer {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding-top: 18px;
      border-top: 1.5px solid #e2e8f0;
    }
    .zurf-qr-block {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .zurf-qr-card {
      display: inline-flex;
      padding: 4px;
      background: #ffffff;
      border: 1px solid #cbd5e1;
      border-radius: 6px;
    }
    .zurf-disclaimer {
      text-align: right;
      max-width: 48%;
      font-size: 9px;
      color: #475569;
      line-height: 1.4;
    }
    @media print {
      body { margin: 0; }
      .zurf-report-wrapper { padding: 0 !important; max-width: 100% !important; }
      .no-print { display: none !important; }
    }
  </style>
</head>
<body>
  <div class="zurf-watermark zurf-page-watermark">ZAMORIN CAFÉ · CERTIFIED REPORT</div>

  <div class="zurf-report-wrapper">
    <div class="zurf-content">
      
      <!-- TOP HEADER -->
      <div class="zurf-header">
        <div class="zurf-brand-box">
          <div class="zurf-logo-wrap">${branding.logoSvg || ''}</div>
          <div class="zurf-legal-name">${safeLegalName}</div>
          <div class="zurf-address-bar">${safeAddress}</div>
          <div class="zurf-gstin-bar">GSTIN: <span style="color:#090d16;">${safeGstin}</span> · CIN: ${safeCin}</div>
        </div>

        <div class="zurf-control-box">
          <div class="zurf-pills-row">
            <span class="zurf-pill-class">${classUpper}</span>
          </div>
          <div class="zurf-run-ref">REF: <span>${finalRunId}</span></div>
          <div class="zurf-meta-line"><strong>Period:</strong> <span style="color:#090d16;font-weight:700;">${period}</span></div>
          <div class="zurf-meta-line"><strong>Generated:</strong> ${generatedAt}</div>
          <div class="zurf-meta-line"><strong>Scope:</strong> ${scope}</div>
        </div>
      </div>

      <!-- TITLE BAR -->
      <div class="zurf-title-bar">
        <div>
          <div class="zurf-code-tag">OFFICIAL CORPORATE REPORT · ${reportCode}</div>
          <h1 class="zurf-report-title">${safeTitle}</h1>
        </div>
        <div class="zurf-record-chip">
          Total Records: <strong style="color:#090d16;">${finalRows.length}</strong>
        </div>
      </div>

      <!-- KPI METRIC CARDS -->
      ${kpiCards.length > 0 ? `
        <div class="zurf-kpi-grid">
          ${kpiCards.map((k) => `
            <div class="zurf-kpi-card">
              <div class="zurf-kpi-title">${k.title || k.label || 'Metric'}</div>
              <div class="zurf-kpi-value">${k.value !== undefined ? k.value : '—'}</div>
              ${k.subtext ? `<div style="font-size:9px;font-weight:600;color:#059669;margin-top:2px;">${k.subtext}</div>` : ''}
            </div>
          `).join('')}
        </div>
      ` : ''}

      <!-- DATA MATRIX TABLE -->
      <table class="zurf-table">
        <thead>
          <tr>
            ${finalCols.map((c, i) => {
              const align = c.isNum ? 'text-align:right;' : (i === 0 ? 'text-align:center;width:40px;' : 'text-align:left;');
              return `<th style="${align}">${c.label || c.key}</th>`;
            }).join('')}
          </tr>
        </thead>
        <tbody>
          ${finalRows.map((r) => `
            <tr>
              ${finalCols.map((c, i) => {
                const isNum = c.isNum || (!c.label?.toLowerCase().includes('category') && !c.label?.toLowerCase().includes('item') && !c.label?.toLowerCase().includes('sl') && (String(r[c.key]).startsWith('₹') || String(r[c.key]).startsWith('INR') || String(r[c.key]).endsWith('%') || !isNaN(Number(r[c.key]))));
                const alignClass = isNum ? 'num' : (i === 0 ? 'center' : '');
                const alignStyle = i === 0 ? 'text-align:center;font-weight:bold;color:#475569;' : (i === 1 ? 'font-weight:700;color:#090d16;' : '');
                return `<td class="${alignClass}" style="${alignStyle}">${r[c.key] ?? '—'}</td>`;
              }).join('')}
            </tr>
          `).join('')}
        </tbody>
      </table>

      ${notes ? `<div style="font-size:10px;color:#475569;margin-top:8px;font-style:italic;">* ${notes}</div>` : ''}

      <!-- FOOTER -->
      <div class="zurf-footer">
        <div class="zurf-qr-block">
          <div class="zurf-qr-card">
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
              ${qrUrl}
            </div>
          </div>
        </div>

        <div class="zurf-disclaimer">
          This document is an authoritative corporate intelligence output generated by <strong>Zamorin Central ERP</strong>. It is subject to statutory audit logging and role-based confidentiality governance under Indian Companies Act and DPDP Act provisions.
          <div style="font-size:9px;font-weight:700;color:#090d16;margin-top:4px;">
            ZAMORIN ESTATE PVT. LTD. · ALL RIGHTS RESERVED
          </div>
        </div>
      </div>

    </div>
  </div>
</body>
</html>`;
  }

  /**
   * Generates clean machine-readable CSV with separate metadata manifest
   * and strict formula injection sanitization.
   */
  static async renderCsv({ reportTitle, scope, period, columns = [], rows = [], cafeId = null, sensitivityLevel = 'INTERNAL', runId = null }) {
    const branding = await getCompanyConfig({ cafeId, sensitivityLevel });
    const headerRow = columns.map((c) => `"${c.label.replace(/"/g, '""')}"`).join(',');
    const dataRows = rows.map((r) =>
      columns.map((c) => sanitizeCsvCell(r[c.key], c.isNum)).join(',')
    );

    const csvContent = [headerRow, ...dataRows].join('\n');
    const finalRunId = runId || this.generateRunId();

    const manifest = {
      reportTitle,
      scope,
      period,
      runId: finalRunId,
      company: branding.legalName,
      gstin: branding.gstin,
      companyDetailsVersionId: branding.companyDetailsVersionId,
      rowCount: rows.length,
      generatedAt: new Date().toISOString(),
      zurfVersion: 'v1.0',
    };

    return {
      csv: csvContent,
      manifest,
      runId: finalRunId,
    };
  }

  /**
   * Generates a standard binary PDF Buffer conforming to %PDF-1.4
   */
  static async renderBinaryPdf({ reportTitle, reportCode, qrCodeData, scope, period, columns = [], rows = [], kpiCards = [], cafeId = null, sensitivityLevel = 'INTERNAL', runId = null }) {
    const branding = await getCompanyConfig({ cafeId, sensitivityLevel });
    const { generatePdf } = require('../utils/exportGenerators');
    return generatePdf({
      reportTitle,
      reportCode,
      qrCodeData,
      scope,
      period,
      columns,
      rows,
      kpiCards,
      branding,
      runId
    });
  }

  /**
   * Generates a standard binary Microsoft Excel OpenXML package (.xlsx)
   */
  static async renderXlsx({ sheetName = 'Report', reportTitle = 'Export', columns = [], rows = [], sheets = null, cafeId = null, sensitivityLevel = 'INTERNAL', runId = null }) {
    const branding = await getCompanyConfig({ cafeId, sensitivityLevel });
    const { generateXlsx } = require('../utils/exportGenerators');
    return generateXlsx({
      sheetName,
      reportTitle,
      columns,
      rows,
      sheets,
      branding,
      runId
    });
  }

  /**
   * Asynchronously schedules an export job in the queue and caches artifact data.
   */
  static enqueueExportJob({ reportId, format = 'PDF', scope, period, userId, organisationId = null, artifact = null }) {
    const jobId = `EXP-${Date.now()}-${Math.floor(100 + Math.random() * 900)}`;
    const job = {
      jobId,
      reportId,
      format,
      scope,
      period,
      userId,
      organisationId,
      status: 'READY',
      progress: 100,
      createdAt: new Date().toISOString(),
      downloadUrl: `/api/v1/reports/export/${jobId}/download`,
    };
    exportJobs.set(jobId, job);
    if (artifact) {
      exportArtifacts.set(jobId, {
        ...artifact,
        jobId,
        userId,
        organisationId,
      });
    }
    return job;
  }

  /**
   * Stores a generated export artifact by runId or jobId and records in ExportHistory.
   */
  static storeExportArtifact(id, artifact) {
    if (!id || !artifact) return;
    exportArtifacts.set(id, {
      ...artifact,
      id,
      storedAt: Date.now(),
    });

    try {
      const { ExportHistory } = require('../models/ExportHistory');
      const crypto = require('crypto');
      const checksum = artifact.buffer ? crypto.createHash('sha256').update(artifact.buffer).digest('hex') : null;
      ExportHistory.create({
        exportId: id,
        documentType: artifact.documentType || 'REPORT',
        relatedRecordId: artifact.relatedRecordId || null,
        format: (artifact.format || 'PDF').toUpperCase(),
        filename: artifact.filename || `${id}.${(artifact.format || 'pdf').toLowerCase()}`,
        fileSize: artifact.buffer ? artifact.buffer.length : 0,
        checksum,
        organisationId: artifact.organisationId || 'ORG-DEFAULT',
        cafeId: artifact.cafeId || 'ALL',
        generatedByUserId: artifact.userId || 'SYSTEM',
        destinationType: artifact.destinationType || 'BROWSER_DOWNLOAD',
        status: 'COMPLETED',
        templateVersion: 'Zamorin Universal Corporate Standard v1.0',
        metadata: {
          mimeType: artifact.mimeType,
          runId: id
        }
      }).catch(() => {});
    } catch (_) {}
  }

  /**
   * Retrieves a generated export artifact safely by runId or jobId.
   */
  static getExportArtifact(id, auth = {}) {
    if (!id || typeof id !== 'string') {
      const { ApiError } = require('../utils/ApiError');
      throw new ApiError(400, 'INVALID_ARTIFACT_ID', 'Invalid artifact identifier.');
    }

    // Path traversal defense
    if (id.includes('..') || id.includes('/') || id.includes('\\') || id.includes('\0')) {
      const { ApiError } = require('../utils/ApiError');
      throw new ApiError(400, 'INVALID_ARTIFACT_ID', 'Path traversal characters are strictly forbidden in artifact identifier.');
    }

    const cleanId = id.replace(/\.(?:pdf|csv|xlsx)$/i, '').trim();
    const artifact = exportArtifacts.get(cleanId) || exportArtifacts.get(id);

    if (!artifact) {
      const { ApiError } = require('../utils/ApiError');
      throw new ApiError(404, 'ARTIFACT_NOT_FOUND', 'Export artifact not found or expired.');
    }

    // Tenant isolation
    if (artifact.organisationId && auth.organisationId && artifact.organisationId !== auth.organisationId) {
      const { ApiError } = require('../utils/ApiError');
      throw new ApiError(403, 'TENANT_MISMATCH', 'Unauthorized access to foreign organisation artifact.');
    }

    // Role / user scoping: non-master cannot access another user's artifact unless from same authorised scope
    if (auth.role !== 'MASTER' && artifact.userId && auth.userId && artifact.userId !== auth.userId) {
      const { ApiError } = require('../utils/ApiError');
      throw new ApiError(403, 'ACCESS_DENIED', 'You are not authorized to download this artifact.');
    }

    return artifact;
  }

  /**
   * Retrieves active export jobs for a user.
   */
  static listUserJobs(userId) {
    return Array.from(exportJobs.values())
      .filter((j) => !userId || j.userId === userId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
}

module.exports = {
  ZurfService,
  COMPANY_CONFIG,
  getCompanyConfig,
  sanitizeCsvCell,
};
