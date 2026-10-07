'use strict';

/**
 * ZAMORIN AI INVOICE INTELLIGENCE — GEMINI MULTIMODAL INVOICE PROVIDER (PHASE 0)
 *
 * Connects to Google Gemini Multimodal APIs with structured output schema enforcement.
 * Supported stable default: gemini-3.8-flash (configurable via GEMINI_MODEL).
 * Obsolete models (gemini-1.5-flash / gemini-2.0-flash) are strictly prohibited.
 *
 * Enforces:
 *   1. Native Google generationConfig.responseSchema constraint.
 *   2. Server-side validation against Canonical Extraction Schema 2026.1.
 *   3. AI_SCHEMA_VALIDATION_FAILED code on schema discrepancies.
 *   4. Auditable model versioning in extractionMetadata.
 */

const { InvoiceExtractionProvider } = require('./InvoiceExtractionProvider');
const {
  CANONICAL_SCHEMA_VERSION,
  GEMINI_CANONICAL_RESPONSE_SCHEMA,
  createEmptyCanonicalExtraction,
  createFieldProvenance,
  validateCanonicalExtraction,
} = require('../canonicalExtractionSchema');

const GEMINI_API_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';
const DEFAULT_MODEL = 'gemini-3.8-flash';

const GEMINI_SYSTEM_INSTRUCTION = `
You are an expert Indian GST Invoice Extraction Engine for Zamorin Café ERP.
Extract all invoice details with mathematical precision according to Indian Goods and Services Tax (GST) statutory rules.
You must return a strictly valid JSON object conforming directly to the requested response schema.

Statutory Rules & Extraction Directives:
1. Extract exact supplier legal/trade name, 15-character GSTIN, PAN (chars 3-12 of GSTIN), and address.
2. Extract exact invoice number, invoice date (ISO YYYY-MM-DD), and purchase order number if referenced.
3. Extract each line item with description, HSN/SAC code, quantity, unit of measurement (KG, LTR, PKT, NOS, UNIT), unit price, discount, taxable value, GST rate (%), CGST/SGST/IGST amounts, and line total.
4. Correctly classify Intra-State supplies (CGST + SGST) versus Inter-State supplies (IGST).
5. Extract totals: subtotal, discount, taxable value, CGST, SGST, IGST, cess, freight, round-off, and grand total.
6. If bank account number or IFSC code is present, extract them into bankDetails.
7. Set missing or unreadable fields to null. Never hallucinate or fabricate values.
`;

class GeminiInvoiceExtractionProvider extends InvoiceExtractionProvider {
  constructor(config = {}) {
    super();
    this.name = 'GOOGLE_GEMINI';
    this.apiKey = config.apiKey || process.env.GEMINI_API_KEY || null;
    this.model = config.model || process.env.GEMINI_MODEL || process.env.GEMINI_INVOICE_MODEL || DEFAULT_MODEL;
    this.timeoutMs = config.timeoutMs || 30000;
  }

  getProviderName() {
    return this.name;
  }

  getModelVersion() {
    return this.model;
  }

  async healthCheck() {
    if (!this.apiKey) {
      return {
        ok: false,
        status: 'PENDING_CONFIGURATION',
        message: `Gemini API key is not configured. (Set GEMINI_API_KEY in environment, target model: ${this.model})`,
        model: this.model,
      };
    }
    return {
      ok: true,
      status: 'READY',
      message: `Gemini Invoice Provider (${this.model}) configured and operational.`,
      model: this.model,
      supportsStructuredOutput: true,
      schemaVersion: CANONICAL_SCHEMA_VERSION,
    };
  }

  /**
   * Calls Gemini Multimodal GenerateContent endpoint with document buffer or base64.
   */
  async extractInvoice(document = {}, options = {}) {
    // ── Testing / Simulation Hooks for Phase 11 & Failure Resilience ───────────
    if (options.simulateError) {
      const err = new Error(options.simulateErrorMessage || 'Simulated Gemini Provider Error (HTTP 500)');
      err.code = options.simulateErrorCode || 'AI_PROVIDER_HTTP_ERROR';
      err.statusCode = options.simulateStatusCode || 500;
      throw err;
    }

    if (options.simulateTimeout) {
      const err = new Error(`Gemini extraction timed out after ${this.timeoutMs}ms.`);
      err.code = 'AI_PROVIDER_TIMEOUT';
      err.statusCode = 504;
      throw err;
    }

    if (options.simulateRateLimit) {
      const err = new Error('Resource exhausted (HTTP 429): Quota exceeded for model ' + this.model);
      err.code = 'AI_PROVIDER_RATE_LIMIT';
      err.statusCode = 429;
      throw err;
    }

    if (options.simulateSchemaInvalid) {
      const schemaErr = new Error('Gemini response failed canonical schema validation: invoice object is required.');
      schemaErr.code = 'AI_SCHEMA_VALIDATION_FAILED';
      schemaErr.statusCode = 422;
      schemaErr.details = ['invoice object is required.'];
      throw schemaErr;
    }

    // Direct mock response bypass for staging dataset evaluation when live credentials are in offline mode
    if (options.mockParsedResponse) {
      const parsedJson = options.mockParsedResponse;
      const schemaValidation = validateCanonicalExtraction(parsedJson);
      if (!schemaValidation.isValid) {
        const schemaErr = new Error(`Gemini response failed canonical schema validation: ${schemaValidation.errors.join('; ')}`);
        schemaErr.code = 'AI_SCHEMA_VALIDATION_FAILED';
        schemaErr.statusCode = 422;
        schemaErr.details = schemaValidation.errors;
        throw schemaErr;
      }

      const normalized = this.normalizeResponse(parsedJson, {
        documentHash: document.documentHash,
        documentId: document.documentId,
      });

      return {
        schemaVersion: normalized.canonical.schemaVersion,
        documentType: normalized.canonical.documentType,
        supplier: normalized.canonical.supplier,
        invoice: normalized.canonical.invoice,
        lineItems: normalized.canonical.lineItems,
        totals: normalized.canonical.totals,
        bankDetails: normalized.canonical.bankDetails,
        provenance: normalized.provenance,
        extractionMetadata: {
          provider: this.name,
          modelVersion: this.model,
          providerRequestId: 'req-simulated-' + Date.now(),
          durationMs: options.mockDurationMs || 450,
          usageMetadata: { promptTokenCount: 1250, candidatesTokenCount: 420, totalTokenCount: 1670 },
          rawOutput: parsedJson,
        },
      };
    }

    // ── Live Gemini API Call ──────────────────────────────────────────────────
    if (!this.apiKey) {
      const err = new Error(`Gemini API key is not configured in environment (PENDING_CONFIGURATION for model ${this.model}).`);
      err.code = 'AI_PROVIDER_UNCONFIGURED';
      err.statusCode = 503;
      throw err;
    }

    let fileBase64 = document.fileBase64;
    const buf = document.documentBuffer || document.fileBuffer;
    if (!fileBase64 && buf) {
      fileBase64 = Buffer.isBuffer(buf) ? buf.toString('base64') : Buffer.from(buf).toString('base64');
    }

    if (!fileBase64) {
      const err = new Error('Document buffer or base64 data is required for Gemini invoice extraction.');
      err.code = 'INVALID_DOCUMENT_PAYLOAD';
      err.statusCode = 400;
      throw err;
    }

    const mimeType = document.mimeType || 'application/pdf';
    const requestUrl = `${GEMINI_API_ENDPOINT}/${this.model}:generateContent`;

    const requestPayload = {
      systemInstruction: {
        parts: [{ text: GEMINI_SYSTEM_INSTRUCTION }],
      },
      contents: [
        {
          role: 'user',
          parts: [
            {
              text: 'Extract the full Indian GST tax invoice data from this document as structured JSON conforming strictly to the response schema.',
            },
            {
              inlineData: {
                mimeType,
                data: fileBase64,
              },
            },
          ],
        },
      ],
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: GEMINI_CANONICAL_RESPONSE_SCHEMA,
        temperature: 0.1,
      },
    };

    const startTime = Date.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs || this.timeoutMs);

    try {
      const response = await fetch(requestUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': this.apiKey },
        body: JSON.stringify(requestPayload),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        const err = new Error(`Gemini API error (HTTP ${response.status}): ${errorText.slice(0, 300)}`);
        err.code = response.status === 429 ? 'AI_PROVIDER_RATE_LIMIT' : 'AI_PROVIDER_HTTP_ERROR';
        err.statusCode = response.status;
        throw err;
      }

      const responseJson = await response.json();
      const candidateText = responseJson?.candidates?.[0]?.content?.parts?.[0]?.text;

      if (!candidateText) {
        throw new Error('Gemini returned an empty extraction candidate.');
      }

      let parsedJson;
      try {
        parsedJson = JSON.parse(candidateText);
      } catch (parseErr) {
        const err = new Error(`Failed to parse Gemini structured JSON output: ${parseErr.message}`);
        err.code = 'AI_SCHEMA_VALIDATION_FAILED';
        err.statusCode = 422;
        throw err;
      }

      // ── Server-Side Canonical Schema Validation ─────────────────────────────
      const schemaValidation = validateCanonicalExtraction(parsedJson);
      if (!schemaValidation.isValid) {
        const schemaErr = new Error(`Gemini response failed canonical schema validation: ${schemaValidation.errors.join('; ')}`);
        schemaErr.code = 'AI_SCHEMA_VALIDATION_FAILED';
        schemaErr.statusCode = 422;
        schemaErr.details = schemaValidation.errors;
        throw schemaErr;
      }

      const normalized = this.normalizeResponse(parsedJson, {
        documentHash: document.documentHash,
        documentId: document.documentId,
      });

      return {
        schemaVersion: normalized.canonical.schemaVersion,
        documentType: normalized.canonical.documentType,
        supplier: normalized.canonical.supplier,
        invoice: normalized.canonical.invoice,
        lineItems: normalized.canonical.lineItems,
        totals: normalized.canonical.totals,
        bankDetails: normalized.canonical.bankDetails,
        provenance: normalized.provenance,
        extractionMetadata: {
          provider: this.name,
          modelVersion: this.model,
          providerRequestId: responseJson?.responseId || null,
          durationMs: Date.now() - startTime,
          usageMetadata: responseJson.usageMetadata || null,
          rawOutput: parsedJson,
        },
      };
    } catch (err) {
      clearTimeout(timeout);
      if (err.name === 'AbortError') {
        const timeoutErr = new Error(`Gemini extraction timed out after ${this.timeoutMs}ms.`);
        timeoutErr.code = 'AI_PROVIDER_TIMEOUT';
        timeoutErr.statusCode = 504;
        throw timeoutErr;
      }
      throw err;
    }
  }

  normalizeResponse(rawOutput = {}, context = {}) {
    const canonical = createEmptyCanonicalExtraction({
      provider: this.name,
      modelVersion: this.model,
      documentHash: context.documentHash,
      documentId: context.documentId,
    });

    if (!rawOutput) return { canonical, provenance: {} };

    canonical.documentType = rawOutput.documentType || 'TAX_INVOICE';

    if (rawOutput.supplier) {
      canonical.supplier.name = rawOutput.supplier.name ? String(rawOutput.supplier.name).trim() : null;
      canonical.supplier.gstin = rawOutput.supplier.gstin ? String(rawOutput.supplier.gstin).trim().toUpperCase() : null;
      canonical.supplier.pan = rawOutput.supplier.pan ? String(rawOutput.supplier.pan).trim().toUpperCase() : null;
      if (!canonical.supplier.pan && canonical.supplier.gstin && canonical.supplier.gstin.length === 15) {
        canonical.supplier.pan = canonical.supplier.gstin.substring(2, 12);
      }
      canonical.supplier.address = rawOutput.supplier.address ? String(rawOutput.supplier.address).trim() : null;
      canonical.supplier.state = rawOutput.supplier.state ? String(rawOutput.supplier.state).trim() : null;
      canonical.supplier.stateCode = rawOutput.supplier.stateCode ? String(rawOutput.supplier.stateCode).trim().padStart(2, '0') : null;
      if (!canonical.supplier.stateCode && canonical.supplier.gstin && canonical.supplier.gstin.length === 15) {
        canonical.supplier.stateCode = canonical.supplier.gstin.substring(0, 2);
      }
      canonical.supplier.phone = rawOutput.supplier.phone ? String(rawOutput.supplier.phone).trim() : null;
      canonical.supplier.email = rawOutput.supplier.email ? String(rawOutput.supplier.email).trim().toLowerCase() : null;
    }

    if (rawOutput.invoice) {
      canonical.invoice.invoiceNumber = rawOutput.invoice.invoiceNumber ? String(rawOutput.invoice.invoiceNumber).trim() : null;
      canonical.invoice.invoiceDate = rawOutput.invoice.invoiceDate ? String(rawOutput.invoice.invoiceDate).trim() : null;
      canonical.invoice.dueDate = rawOutput.invoice.dueDate ? String(rawOutput.invoice.dueDate).trim() : null;
      canonical.invoice.purchaseOrderNumber = rawOutput.invoice.purchaseOrderNumber ? String(rawOutput.invoice.purchaseOrderNumber).trim().toUpperCase() : null;
      canonical.invoice.deliveryReference = rawOutput.invoice.deliveryReference ? String(rawOutput.invoice.deliveryReference).trim().toUpperCase() : null;
      canonical.invoice.currency = rawOutput.invoice.currency || 'INR';
      canonical.invoice.placeOfSupply = rawOutput.invoice.placeOfSupply ? String(rawOutput.invoice.placeOfSupply).trim() : null;
      canonical.invoice.reverseCharge = Boolean(rawOutput.invoice.reverseCharge);
      canonical.invoice.irn = rawOutput.invoice.irn ? String(rawOutput.invoice.irn).trim() : null;
      canonical.invoice.eWayBillNumber = rawOutput.invoice.eWayBillNumber ? String(rawOutput.invoice.eWayBillNumber).trim() : null;
    }

    if (Array.isArray(rawOutput.lineItems)) {
      canonical.lineItems = rawOutput.lineItems.map((line, idx) => ({
        lineNumber: Number(line.lineNumber) || (idx + 1),
        description: String(line.description || '').trim(),
        sku: line.sku ? String(line.sku).trim().toUpperCase() : null,
        supplierSku: line.supplierSku ? String(line.supplierSku).trim() : null,
        hsnSac: line.hsnSac ? String(line.hsnSac).trim() : null,
        quantity: Number(line.quantity) || 0,
        unit: String(line.unit || 'UNIT').trim().toUpperCase(),
        unitPrice: Number(line.unitPrice) || 0,
        discountAmount: Number(line.discountAmount) || 0,
        taxableValue: Number(line.taxableValue) || 0,
        gstRate: Number(line.gstRate) || 0,
        cgstRate: Number(line.cgstRate) || 0,
        cgstAmount: Number(line.cgstAmount) || 0,
        sgstRate: Number(line.sgstRate) || 0,
        sgstAmount: Number(line.sgstAmount) || 0,
        igstRate: Number(line.igstRate) || 0,
        igstAmount: Number(line.igstAmount) || 0,
        cessAmount: Number(line.cessAmount) || 0,
        lineTotal: Number(line.lineTotal) || 0,
      }));
    }

    if (rawOutput.totals) {
      canonical.totals.subtotal = Number(rawOutput.totals.subtotal) || 0;
      canonical.totals.discount = Number(rawOutput.totals.discount) || 0;
      canonical.totals.taxableValue = Number(rawOutput.totals.taxableValue) || 0;
      canonical.totals.cgst = Number(rawOutput.totals.cgst) || 0;
      canonical.totals.sgst = Number(rawOutput.totals.sgst) || 0;
      canonical.totals.igst = Number(rawOutput.totals.igst) || 0;
      canonical.totals.cess = Number(rawOutput.totals.cess) || 0;
      canonical.totals.freight = Number(rawOutput.totals.freight) || 0;
      canonical.totals.otherCharges = Number(rawOutput.totals.otherCharges) || 0;
      canonical.totals.roundOff = Number(rawOutput.totals.roundOff) || 0;
      canonical.totals.grandTotal = Number(rawOutput.totals.grandTotal) || 0;
    }

    if (rawOutput.bankDetails) {
      canonical.bankDetails.accountName = rawOutput.bankDetails.accountName || null;
      canonical.bankDetails.maskedAccountNumber = rawOutput.bankDetails.maskedAccountNumber || null;
      canonical.bankDetails.ifsc = rawOutput.bankDetails.ifsc ? String(rawOutput.bankDetails.ifsc).trim().toUpperCase() : null;
    }

    const provenance = {};
    if (canonical.supplier.name) provenance.supplierName = createFieldProvenance({ value: canonical.supplier.name, confidence: 0.95 });
    if (canonical.supplier.gstin) provenance.gstin = createFieldProvenance({ value: canonical.supplier.gstin, confidence: 0.98 });
    if (canonical.invoice.invoiceNumber) provenance.invoiceNumber = createFieldProvenance({ value: canonical.invoice.invoiceNumber, confidence: 0.96 });
    if (canonical.invoice.invoiceDate) provenance.invoiceDate = createFieldProvenance({ value: canonical.invoice.invoiceDate, confidence: 0.95 });
    if (canonical.totals.grandTotal) provenance.grandTotal = createFieldProvenance({ value: canonical.totals.grandTotal, confidence: 0.97 });

    return {
      canonical,
      provenance,
    };
  }
}

module.exports = {
  GeminiInvoiceExtractionProvider,
  DEFAULT_MODEL,
};
