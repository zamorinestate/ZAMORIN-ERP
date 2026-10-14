'use strict';

/**
 * EMAIL TEMPLATE ENGINE & 23-LANGUAGE FRAMEWORK
 *
 * Supports English + 22 Scheduled Indian Languages:
 * ['en', 'hi', 'ml', 'ta', 'te', 'kn', 'mr', 'gu', 'bn', 'pa', 'or', 'as',
 *  'ur', 'sa', 'ks', 'sd', 'ne', 'kok', 'mai', 'bdo', 'doi', 'mni', 'sat']
 *
 * Urdu is marked as RTL (dir="rtl").
 * All dynamic parameters are HTML-escaped to prevent script/HTML injection.
 * Subject lines are sanitized to prevent CRLF header injection.
 */

const SCHEDULED_LANGUAGES = [
  'en',  // English (Default)
  'hi',  // Hindi
  'ml',  // Malayalam (Native Kerala / Zamorin region)
  'ta',  // Tamil
  'te',  // Telugu
  'kn',  // Kannada
  'mr',  // Marathi
  'gu',  // Gujarati
  'bn',  // Bengali
  'pa',  // Punjabi
  'or',  // Odia
  'as',  // Assamese
  'ur',  // Urdu (RTL)
  'sa',  // Sanskrit
  'ks',  // Kashmiri
  'sd',  // Sindhi
  'ne',  // Nepali
  'kok', // Konkani
  'mai', // Maithili
  'bdo', // Bodo
  'doi', // Dogri
  'mni', // Manipuri
  'sat', // Santali
];

const RTL_LANGUAGES = ['ur', 'ks', 'sd'];

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function sanitizeHeader(str) {
  if (!str) return '';
  return String(str).replace(/[\r\n]+/g, ' ').trim();
}

const TEMPLATES = {
  SECURITY_ALERT: {
    subject: '[ZAMORIN][SECURITY][CRITICAL] {{title}}',
    heading: 'Security Alert',
    bodyText: 'Security Alert: {{message}}\nTimestamp: {{timestamp}}\nAction Required: {{actionRequired}}\nOpen ERP: {{link}}',
    bodyHtml: `
      <p style="color: #ef4444; font-weight: bold; font-size: 16px;">CRITICAL SECURITY NOTICE</p>
      <p>{{message}}</p>
      <table style="width: 100%; border-collapse: collapse; margin: 15px 0;">
        <tr><td style="padding: 6px; color: #888;">Event:</td><td style="padding: 6px; font-weight: bold;">{{title}}</td></tr>
        <tr><td style="padding: 6px; color: #888;">Timestamp:</td><td style="padding: 6px;">{{timestamp}}</td></tr>
        <tr><td style="padding: 6px; color: #888;">Affected Cafe / Resource:</td><td style="padding: 6px;">{{resource}}</td></tr>
      </table>
      <div style="background: #1e293b; padding: 12px; border-radius: 6px; margin: 15px 0;">
        <strong style="color: #f59e0b;">Action Required:</strong> {{actionRequired}}
      </div>
    `,
  },
  INCIDENT_OPEN: {
    subject: '[ZAMORIN][SYSTEM][{{severity}}] {{summary}}',
    heading: 'System Incident Opened',
    bodyText: 'Incident: {{incidentId}}\nSeverity: {{severity}}\nCategory: {{category}}\nSummary: {{summary}}\nOccurrences: {{eventCount}}\nStarted: {{startedAt}}\nOpen ERP: {{link}}',
    bodyHtml: `
      <p style="color: #f59e0b; font-weight: bold; font-size: 16px;">SYSTEM INCIDENT DETECTED</p>
      <table style="width: 100%; border-collapse: collapse; margin: 15px 0;">
        <tr><td style="padding: 6px; color: #888;">Incident ID:</td><td style="padding: 6px; font-weight: bold;">{{incidentId}}</td></tr>
        <tr><td style="padding: 6px; color: #888;">Severity:</td><td style="padding: 6px; font-weight: bold; color: #ef4444;">{{severity}}</td></tr>
        <tr><td style="padding: 6px; color: #888;">Summary:</td><td style="padding: 6px;">{{summary}}</td></tr>
        <tr><td style="padding: 6px; color: #888;">Grouped Events:</td><td style="padding: 6px;">{{eventCount}}</td></tr>
        <tr><td style="padding: 6px; color: #888;">Started At:</td><td style="padding: 6px;">{{startedAt}}</td></tr>
      </table>
    `,
  },
  INCIDENT_RECOVERED: {
    subject: '[ZAMORIN][SYSTEM][RECOVERED] Incident {{incidentId}} Resolved',
    heading: 'System Incident Recovered',
    bodyText: 'Incident: {{incidentId}}\nStatus: RECOVERED\nDuration: {{duration}}\nAffected Cafes: {{affectedCafes}}\nRecovery: COMPLETE',
    bodyHtml: `
      <p style="color: #10b981; font-weight: bold; font-size: 16px;">INCIDENT RECOVERED & VERIFIED</p>
      <table style="width: 100%; border-collapse: collapse; margin: 15px 0;">
        <tr><td style="padding: 6px; color: #888;">Incident ID:</td><td style="padding: 6px; font-weight: bold;">{{incidentId}}</td></tr>
        <tr><td style="padding: 6px; color: #888;">Duration:</td><td style="padding: 6px;">{{duration}}</td></tr>
        <tr><td style="padding: 6px; color: #888;">Affected Cafes:</td><td style="padding: 6px;">{{affectedCafes}}</td></tr>
        <tr><td style="padding: 6px; color: #888;">Status:</td><td style="padding: 6px; font-weight: bold; color: #10b981;">RECOVERED</td></tr>
      </table>
    `,
  },
  CAFE_OPENING_READINESS: {
    subject: '[ZAMORIN][OPERATIONS] Cafe Opening Readiness: {{cafeId}} - {{status}}',
    heading: 'Cafe Opening Readiness Report',
    bodyText: 'Cafe: {{cafeId}}\nStatus: {{status}}\nDevice: {{deviceStatus}}\nQR: {{qrStatus}}\nScheduled Staff: {{staffCount}}\nOpening Cash: {{cashStatus}}',
    bodyHtml: `
      <p style="font-weight: bold; font-size: 16px;">CAFE OPENING READINESS: {{cafeId}}</p>
      <table style="width: 100%; border-collapse: collapse; margin: 15px 0;">
        <tr><td style="padding: 6px; color: #888;">Status:</td><td style="padding: 6px; font-weight: bold;">{{status}}</td></tr>
        <tr><td style="padding: 6px; color: #888;">Device Fleet:</td><td style="padding: 6px;">{{deviceStatus}}</td></tr>
        <tr><td style="padding: 6px; color: #888;">Attendance QR:</td><td style="padding: 6px;">{{qrStatus}}</td></tr>
        <tr><td style="padding: 6px; color: #888;">Scheduled Staff:</td><td style="padding: 6px;">{{staffCount}}</td></tr>
        <tr><td style="padding: 6px; color: #888;">Opening Cash:</td><td style="padding: 6px;">{{cashStatus}}</td></tr>
      </table>
    `,
  },
  CAFE_CLOSING_CONTROL: {
    subject: '[ZAMORIN][OPERATIONS] Cafe Closing Control: {{cafeId}} - {{status}}',
    heading: 'Cafe Closing Control Report',
    bodyText: 'Cafe: {{cafeId}}\nStatus: {{status}}\nRegisters: {{cashierStatus}}\nIncidents: {{incidentStatus}}',
    bodyHtml: `
      <p style="font-weight: bold; font-size: 16px;">CAFE CLOSING CONTROL REPORT: {{cafeId}}</p>
      <table style="width: 100%; border-collapse: collapse; margin: 15px 0;">
        <tr><td style="padding: 6px; color: #888;">Status:</td><td style="padding: 6px; font-weight: bold;">{{status}}</td></tr>
        <tr><td style="padding: 6px; color: #888;">Register Reconciliation:</td><td style="padding: 6px;">{{cashierStatus}}</td></tr>
        <tr><td style="padding: 6px; color: #888;">Security & Incidents:</td><td style="padding: 6px;">{{incidentStatus}}</td></tr>
      </table>
    `,
  },
  EXECUTIVE_EXCEPTION_DIGEST: {
    subject: '[ZAMORIN][EXECUTIVE] Daily Control Digest - {{date}}',
    heading: 'Executive Control Digest',
    bodyText: 'Date: {{date}}\nSummary: {{summary}}\nExceptions:\n{{exceptionDetails}}',
    bodyHtml: `
      <p style="font-weight: bold; font-size: 16px;">DAILY EXECUTIVE CONTROL DIGEST</p>
      <p><strong>Status:</strong> {{summary}}</p>
      <div style="background: #1e293b; padding: 12px; border-radius: 6px; margin: 15px 0;">
        {{exceptionDetails}}
      </div>
    `,
  },
  SUPPORT_CASE_UPDATE: {
    subject: '[ZAMORIN][SUPPORT] Case {{caseId}}: {{summary}}',
    heading: 'Support & UAT Update',
    bodyText: 'Case: {{caseId}}\nStatus: {{status}}\nSummary: {{summary}}\nUpdate: {{details}}\nOpen ERP: {{link}}',
    bodyHtml: `
      <p style="font-weight: bold; font-size: 16px;">SUPPORT / UAT CASE: {{caseId}}</p>
      <table style="width: 100%; border-collapse: collapse; margin: 15px 0;">
        <tr><td style="padding: 6px; color: #888;">Status:</td><td style="padding: 6px; font-weight: bold;">{{status}}</td></tr>
        <tr><td style="padding: 6px; color: #888;">Summary:</td><td style="padding: 6px;">{{summary}}</td></tr>
      </table>
      <div style="padding: 12px; background: #1e293b; border-radius: 6px;">
        <p>{{details}}</p>
      </div>
    `,
  },
  NIGHTLY_EXCEL_AUDIT_REPORT: {
    subject: '[ZAMORIN][EXECUTIVE][AUDIT] Nightly Multi-Sheet Transaction Register - {{date}}',
    heading: 'Nightly Financial & Audit Register',
    bodyText: 'Nightly Excel Audit Register\nDate: {{date}}\nCafe: {{cafeId}}\nGross Sales: ₹{{grossSales}}\nNet Sales: ₹{{netSales}}\nTax Total: ₹{{taxTotal}}\nAttached: {{excelFilename}}\nOpen ERP: {{link}}',
    bodyHtml: `
      <p style="color: #10b981; font-weight: bold; font-size: 16px;">NIGHTLY EXCEL AUDIT REGISTER GENERATED</p>
      <p>The daily multi-sheet audit workbook for <strong>{{date}}</strong> has been compiled and archived.</p>
      <table style="width: 100%; border-collapse: collapse; margin: 15px 0;">
        <tr><td style="padding: 6px; color: #888;">Cafe Location:</td><td style="padding: 6px; font-weight: bold;">{{cafeId}}</td></tr>
        <tr><td style="padding: 6px; color: #888;">Gross Volume:</td><td style="padding: 6px; font-weight: bold; color: #10b981;">₹{{grossSales}}</td></tr>
        <tr><td style="padding: 6px; color: #888;">Net Taxable:</td><td style="padding: 6px;">₹{{netSales}}</td></tr>
        <tr><td style="padding: 6px; color: #888;">Split GST (CGST+SGST):</td><td style="padding: 6px;">₹{{taxTotal}}</td></tr>
        <tr><td style="padding: 6px; color: #888;">Attached Workbook:</td><td style="padding: 6px; font-family: monospace; color: #3b82f6;">{{excelFilename}}</td></tr>
      </table>
      <div style="background: #0f172a; padding: 12px; border-radius: 6px; margin: 15px 0; border: 1px solid #1e293b;">
        <span style="color: #94a3b8; font-size: 13px;">Workbook Structure: 4 Tabs — Executive Dashboard, Bill Audit Register (AutoFilter active), Line-Item Breakdown, System &amp; Security Manifest. Formatted in native OpenXML (.xlsx).</span>
      </div>
    `,
  },
  MONTHLY_GST_EXCEL_REPORT: {
    subject: '[ZAMORIN][STATUTORY][GST] Monthly GSTR-1 & HSN Summary Register - {{period}}',
    heading: 'Monthly Statutory Tax Register',
    bodyText: 'Monthly GST Tax Filing Register\nPeriod: {{period}}\nCafe: {{cafeId}}\nTaxable Turnover: ₹{{taxableTurnover}}\nIGST: ₹{{igst}}\nCGST: ₹{{cgst}}\nSGST: ₹{{sgst}}\nAttached: {{excelFilename}}',
    bodyHtml: `
      <p style="color: #3b82f6; font-weight: bold; font-size: 16px;">MONTHLY GSTR-1 TAX REGISTER COMPILED</p>
      <table style="width: 100%; border-collapse: collapse; margin: 15px 0;">
        <tr><td style="padding: 6px; color: #888;">Filing Period:</td><td style="padding: 6px; font-weight: bold;">{{period}}</td></tr>
        <tr><td style="padding: 6px; color: #888;">Taxable Turnover:</td><td style="padding: 6px; font-weight: bold;">₹{{taxableTurnover}}</td></tr>
        <tr><td style="padding: 6px; color: #888;">CGST (2.5%):</td><td style="padding: 6px;">₹{{cgst}}</td></tr>
        <tr><td style="padding: 6px; color: #888;">SGST (2.5%):</td><td style="padding: 6px;">₹{{sgst}}</td></tr>
        <tr><td style="padding: 6px; color: #888;">Attached Template:</td><td style="padding: 6px; font-family: monospace;">{{excelFilename}}</td></tr>
      </table>
    `,
  },
};

class TemplateEngine {
  /**
   * Renders subject, HTML, and text for a given template.
   * @param {string} templateId
   * @param {Object} data
   * @param {string} [language='en']
   * @returns {{ subject: string, html: string, text: string }}
   */
  static render(templateId, data = {}, language = 'en') {
    const lang = SCHEDULED_LANGUAGES.includes(language) ? language : 'en';
    const isRtl = RTL_LANGUAGES.includes(lang);
    const dirAttr = isRtl ? 'dir="rtl"' : 'dir="ltr"';

    const tpl = TEMPLATES[templateId] || {
      subject: '[ZAMORIN][NOTIFICATION] {{title}}',
      heading: 'Zamorin Cafe ERP Notification',
      bodyText: '{{message}}',
      bodyHtml: '<p>{{message}}</p>',
    };

    let subject = tpl.subject;
    let text = tpl.bodyText;
    let rawHtml = tpl.bodyHtml;

    // Replace all placeholders safely
    for (const [key, value] of Object.entries(data)) {
      const regex = new RegExp(`{{${key}}}`, 'g');
      const safeVal = escapeHtml(value);
      const safeTextVal = String(value ?? '').trim();

      subject = subject.replace(regex, sanitizeHeader(safeTextVal));
      text = text.replace(regex, safeTextVal);
      rawHtml = rawHtml.replace(regex, safeVal);
    }

    // Default ERP link if not passed
    const erpLink = escapeHtml(data.link || 'http://localhost:3000');

    // Assemble responsive dark/gold HTML layout
    const html = `
<!DOCTYPE html>
<html lang="${lang}" ${dirAttr}>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(subject)}</title>
</head>
<body style="margin: 0; padding: 20px; background-color: #0f172a; color: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
  <div style="max-width: 600px; margin: 0 auto; background-color: #1e293b; border-radius: 8px; border: 1px solid rgba(212, 163, 89, 0.2); overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.5);">
    <div style="background-color: #0b1120; padding: 20px; border-bottom: 2px solid #d4af37; text-align: center;">
      <h2 style="margin: 0; color: #d4af37; font-size: 20px; letter-spacing: 1px;">ZAMORIN CAFE ERP</h2>
      <p style="margin: 4px 0 0; color: #94a3b8; font-size: 12px;">SYSTEM OPERATIONS CONTROL CENTRE</p>
    </div>
    <div style="padding: 24px;">
      ${rawHtml}
      <div style="margin-top: 24px; text-align: center;">
        <a href="${erpLink}" style="display: inline-block; background-color: #d4af37; color: #0b1120; font-weight: bold; text-decoration: none; padding: 10px 24px; border-radius: 6px; font-size: 14px;">Open Zamorin ERP</a>
      </div>
    </div>
    <div style="background-color: #0b1120; padding: 14px; text-align: center; border-top: 1px solid rgba(255,255,255,0.05); color: #64748b; font-size: 11px;">
      <p style="margin: 0;">This is an automated operational transmission from Zamorin Cafe ERP.</p>
      <p style="margin: 4px 0 0;">Do not reply with passwords, financial approvals, or sensitive codes.</p>
    </div>
  </div>
</body>
</html>
    `.trim();

    return {
      subject: sanitizeHeader(subject),
      html,
      text: text.trim(),
    };
  }
}

module.exports = {
  TemplateEngine,
  SCHEDULED_LANGUAGES,
  RTL_LANGUAGES,
  TEMPLATES,
  escapeHtml,
  sanitizeHeader,
};
