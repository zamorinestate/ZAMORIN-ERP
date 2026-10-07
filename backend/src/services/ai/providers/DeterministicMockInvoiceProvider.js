'use strict';

/**
 * ZAMORIN AI INVOICE INTELLIGENCE — DETERMINISTIC MOCK INVOICE PROVIDER
 *
 * Deterministic, offline-safe provider implementation used for testing, QA verification,
 * and environments without live cloud credentials.
 * Simulates high-accuracy multimodal extraction, Indian GST structures, and edge cases.
 */

const { InvoiceExtractionProvider } = require('./InvoiceExtractionProvider');
const {
  CANONICAL_SCHEMA_VERSION,
  createEmptyCanonicalExtraction,
  createFieldProvenance,
} = require('../canonicalExtractionSchema');

class DeterministicMockInvoiceProvider extends InvoiceExtractionProvider {
  constructor(config = {}) {
    super();
    this.name = 'MOCK_INVOICE_INTELLIGENCE';
    this.modelVersion = 'mock-v2.0-deterministic';
    this.config = config;
  }

  getProviderName() {
    return this.name;
  }

  getModelVersion() {
    return this.modelVersion;
  }

  async healthCheck() {
    return { ok: true, message: 'Deterministic Mock Invoice Provider Operational' };
  }

  /**
   * Extracts mock structured invoice data.
   * Allows synthetic test documents or options to dictate the exact extracted payload.
   */
  async extractInvoice(document = {}, options = {}) {
    // Failure simulation support for Phase 22 & 23 resilience tests
    const bufferStr = document.documentBuffer ? document.documentBuffer.toString() : '';
    if (options.simulateError || bufferStr.includes('SIMULATE_HTTP_500')) {
      const err = new Error(options.simulateErrorMessage || 'Simulated AI Provider API Error (HTTP 500)');
      err.code = options.simulateErrorCode || 'PROVIDER_OUTAGE_SIMULATED';
      err.statusCode = options.simulateStatusCode || 500;
      throw err;
    }

    if (options.simulateTimeout) {
      const err = new Error('AI provider request timed out after 30000ms.');
      err.code = 'AI_PROVIDER_TIMEOUT';
      err.statusCode = 504;
      throw err;
    }

    if (options.simulateRateLimit) {
      const err = new Error('Resource exhausted (HTTP 429): Quota exceeded.');
      err.code = 'AI_PROVIDER_RATE_LIMIT';
      err.statusCode = 429;
      throw err;
    }

    // Custom synthetic payload override if passed in options
    if (options.syntheticExtraction) {
      const normOverride = this.normalizeResponse(options.syntheticExtraction, options);
      return {
        schemaVersion: normOverride.canonical.schemaVersion,
        documentType: normOverride.canonical.documentType,
        supplier: normOverride.canonical.supplier,
        invoice: normOverride.canonical.invoice,
        lineItems: normOverride.canonical.lineItems,
        totals: normOverride.canonical.totals,
        bankDetails: normOverride.canonical.bankDetails,
        provenance: normOverride.provenance,
        extractionMetadata: {
          provider: this.name,
          modelVersion: this.modelVersion,
          processingDurationMs: 45,
          pageCount: options.syntheticExtraction.pageCount || 1,
        },
      };
    }

    let stagingItem = null;
    try {
      const { STAGING_INVOICE_DATASET } = require('../../../../test/fixtures/stagingInvoiceDataset');
      const fname = document.filename || '';
      const docId = document.documentId || '';
      stagingItem = STAGING_INVOICE_DATASET.find(
        (d) => d.id === docId || d.filename === fname || bufferStr.includes(d.id) || (fname && fname.includes(d.id.toLowerCase().replace(/-/g, '_')))
      );
    } catch {}

    const isPo901 =
      options.purchaseOrderId === 'PO-2026-901' ||
      document.purchaseOrderId === 'PO-2026-901' ||
      (document.filename && document.filename.includes('101')) ||
      bufferStr.includes('PO-2026-901');

    let rawOutput;
    if (stagingItem) {
      const gt = stagingItem.groundTruth;
      rawOutput = {
        documentType: 'TAX_INVOICE',
        supplier: {
          name: gt.supplierName,
          gstin: gt.supplierGstin,
          pan: gt.pan,
          address: 'Industrial Area, Kozhikode, Kerala',
          state: 'Kerala',
          stateCode: gt.supplierGstin && gt.supplierGstin.length >= 2 ? gt.supplierGstin.substring(0, 2) : '32',
        },
        invoice: {
          invoiceNumber: gt.invoiceNumber,
          invoiceDate: gt.invoiceDate,
          dueDate: null,
          purchaseOrderNumber: gt.poNumber,
          deliveryReference: gt.deliveryReference || null,
          currency: 'INR',
          reverseCharge: false,
          irn: gt.irn || null,
          eWayBillNumber: gt.eWayBillNumber || null,
        },
        lineItems: gt.lineItems.map((li, idx) => ({
          lineNumber: li.lineNumber || idx + 1,
          description: li.description,
          sku: li.sku || null,
          hsnSac: li.hsnSac || null,
          quantity: li.quantity,
          unit: li.unit || 'UNIT',
          unitPrice: li.unitPrice,
          discountAmount: 0,
          taxableValue: li.taxableValue,
          gstRate: li.gstRate || 0,
          cgstRate: (li.gstRate || 0) / 2,
          cgstAmount: li.cgst || 0,
          sgstRate: (li.gstRate || 0) / 2,
          sgstAmount: li.sgst || 0,
          igstRate: li.igstRate || (li.igst > 0 ? li.gstRate : 0),
          igstAmount: li.igst || 0,
          cessAmount: li.cessAmount || 0,
          lineTotal: li.lineTotal,
        })),
        totals: {
          subtotal: gt.subtotal,
          discount: gt.discount,
          taxableValue: gt.taxableValue,
          cgst: gt.cgst,
          sgst: gt.sgst,
          igst: gt.igst,
          cess: gt.cess || 0,
          freight: gt.freight || 0,
          otherCharges: 0,
          roundOff: gt.roundOff || 0,
          grandTotal: gt.grandTotal,
        },
        bankDetails: gt.bankDetails || null,
        provenance: {
          supplierName: { confidence: 0.98, page: 1, sourceText: gt.supplierName },
          invoiceNumber: { confidence: 0.98, page: 1, sourceText: gt.invoiceNumber },
          invoiceDate: { confidence: 0.97, page: 1, sourceText: gt.invoiceDate },
          grandTotal: { confidence: 0.99, page: 1, sourceText: String(gt.grandTotal) },
        },
      };
    } else if (isPo901) {
      rawOutput = {
        documentType: 'TAX_INVOICE',
        supplier: {
          name: 'Malabar Coffee Traders Pvt Ltd',
          gstin: '32AABCM1234F1Z5',
          pan: 'AABCM1234F',
          address: 'Industrial Estate, Kozhikode, Kerala 673001',
          state: 'Kerala',
          stateCode: '32',
          phone: '+91 94470 12345',
          email: 'accounts@malabarcoffee.com',
        },
        invoice: {
          invoiceNumber: options.invoiceNumber || 'INV-2026-101',
          invoiceDate: options.invoiceDate || '2026-03-15',
          dueDate: options.dueDate || '2026-03-30',
          purchaseOrderNumber: 'PO-2026-901',
          deliveryReference: 'DN-8812',
          currency: 'INR',
          placeOfSupply: '32',
          reverseCharge: false,
        },
        lineItems: [
          {
            lineNumber: 1,
            description: 'Estate Arabica Beans 1kg',
            sku: 'ITM-COFFEE-01',
            supplierSku: 'MCT-ARA-1K',
            hsnSac: '0901',
            quantity: 10,
            unit: 'KG',
            unitPrice: 500.00,
            discountAmount: 0.00,
            taxableValue: 5000.00,
            gstRate: 5.0,
            cgstRate: 2.5,
            cgstAmount: 125.00,
            sgstRate: 2.5,
            sgstAmount: 125.00,
            igstRate: 0.0,
            igstAmount: 0.00,
            cessAmount: 0.00,
            lineTotal: 5250.00,
          },
        ],
        totals: {
          subtotal: 5000.00,
          discount: 0.00,
          taxableValue: 5000.00,
          cgst: 125.00,
          sgst: 125.00,
          igst: 0.00,
          cess: 0.00,
          freight: 0.00,
          otherCharges: 0.00,
          roundOff: 0.00,
          grandTotal: 5250.00,
        },
        bankDetails: {
          accountName: 'Malabar Coffee Traders Pvt Ltd',
          maskedAccountNumber: 'XXXXXX9012',
          ifsc: 'SBIN0001234',
        },
        provenance: {
          supplierName: { confidence: 0.99, page: 1, sourceText: 'Malabar Coffee Traders Pvt Ltd' },
          supplierGstin: { confidence: 0.99, page: 1, sourceText: 'GSTIN: 32AABCM1234F1Z5' },
          gstin: { confidence: 0.99, page: 1, sourceText: 'GSTIN: 32AABCM1234F1Z5' },
          invoiceNumber: { confidence: 0.98, page: 1, sourceText: 'INV-2026-101' },
          invoiceDate: { confidence: 0.98, page: 1, sourceText: '2026-03-15' },
          grandTotal: { confidence: 0.99, page: 1, sourceText: '₹5,250.00' },
        },
      };
    } else {
      rawOutput = {
        documentType: 'TAX_INVOICE',
        supplier: {
          name: 'Calicut Fresh Farms & Agro Enterprises',
          gstin: '32AABCC1234D1Z5',
          pan: 'AABCC1234D',
          address: 'Plot 45, Wayanad Road, Kozhikode, Kerala 673001',
          state: 'Kerala',
          stateCode: '32',
          phone: '+91 94471 23456',
          email: 'billing@calicutfreshfarms.com',
        },
        invoice: {
          invoiceNumber: options.invoiceNumber || 'INV-2026-0891',
          invoiceDate: options.invoiceDate || '2026-10-02',
          dueDate: options.dueDate || '2026-10-17',
          purchaseOrderNumber: options.purchaseOrderNumber || 'PO-2026-0001',
          deliveryReference: options.deliveryReference || 'DC-2026-881',
          currency: 'INR',
          placeOfSupply: '32-Kerala',
          reverseCharge: false,
          irn: '98a7b6c5d4e3f21098a7b6c5d4e3f21098a7b6c5d4e3f21098a7b6c5d4e3f210',
          eWayBillNumber: '321098765432',
        },
        lineItems: [
          {
            lineNumber: 1,
            description: 'Farm Fresh Full Cream Milk 1L',
            sku: 'ITM-MILK-001',
            supplierSku: 'CF-MILK-FC-1L',
            hsnSac: '0401',
            quantity: 100,
            unit: 'LITRE',
            unitPrice: 50.00,
            discountAmount: 0.00,
            taxableValue: 5000.00,
            gstRate: 5.0,
            cgstRate: 2.5,
            cgstAmount: 125.00,
            sgstRate: 2.5,
            sgstAmount: 125.00,
            igstRate: 0.0,
            igstAmount: 0.00,
            cessAmount: 0.00,
            lineTotal: 5250.00,
          },
          {
            lineNumber: 2,
            description: 'Speciality Roastery Coffee Beans 1kg (Malabar Arabica)',
            sku: 'ITM-COFFEE-001',
            supplierSku: 'CF-BEANS-MAL-1K',
            hsnSac: '0901',
            quantity: 20,
            unit: 'KG',
            unitPrice: 650.00,
            discountAmount: 500.00,
            taxableValue: 12500.00,
            gstRate: 5.0,
            cgstRate: 2.5,
            cgstAmount: 312.50,
            sgstRate: 2.5,
            sgstAmount: 312.50,
            igstRate: 0.0,
            igstAmount: 0.00,
            cessAmount: 0.00,
            lineTotal: 13125.00,
          },
        ],
        totals: {
          subtotal: 18000.00,
          discount: 500.00,
          taxableValue: 17500.00,
          cgst: 437.50,
          sgst: 437.50,
          igst: 0.00,
          cess: 0.00,
          freight: 100.00,
          otherCharges: 0.00,
          roundOff: 0.00,
          grandTotal: 18475.00,
        },
        bankDetails: {
          accountName: 'Calicut Fresh Farms & Agro Enterprises',
          maskedAccountNumber: 'XXXXXX4892',
          ifsc: 'HDFC0000123',
        },
        provenance: {
          supplierName: { confidence: 0.99, page: 1, sourceText: 'Calicut Fresh Farms & Agro Enterprises' },
          supplierGstin: { confidence: 0.99, page: 1, sourceText: 'GSTIN: 32AABCC1234D1Z5' },
          gstin: { confidence: 0.99, page: 1, sourceText: 'GSTIN: 32AABCC1234D1Z5' },
          invoiceNumber: { confidence: 0.98, page: 1, sourceText: 'Invoice No: INV-2026-0891' },
          invoiceDate: { confidence: 0.98, page: 1, sourceText: 'Date: 02/10/2026' },
          grandTotal: { confidence: 0.99, page: 1, sourceText: 'Total: ₹18,475.00' },
        },
      };
    }

    const normalized = this.normalizeResponse(rawOutput, options);
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
        modelVersion: this.modelVersion,
        processingDurationMs: 38,
        pageCount: 1,
      },
    };
  }


  normalizeResponse(rawOutput = {}, context = {}) {
    const canonical = createEmptyCanonicalExtraction({
      provider: this.name,
      modelVersion: this.modelVersion,
      documentHash: context.documentHash,
      documentId: context.documentId,
    });

    if (!rawOutput) return { canonical, provenance: {} };

    canonical.documentType = rawOutput.documentType || 'TAX_INVOICE';

    // Supplier normalization
    if (rawOutput.supplier) {
      canonical.supplier.name = rawOutput.supplier.name ? String(rawOutput.supplier.name).trim() : null;
      canonical.supplier.gstin = rawOutput.supplier.gstin ? String(rawOutput.supplier.gstin).trim().toUpperCase() : null;
      canonical.supplier.pan = rawOutput.supplier.pan ? String(rawOutput.supplier.pan).trim().toUpperCase() : null;
      canonical.supplier.address = rawOutput.supplier.address ? String(rawOutput.supplier.address).trim() : null;
      canonical.supplier.state = rawOutput.supplier.state ? String(rawOutput.supplier.state).trim() : null;
      canonical.supplier.stateCode = rawOutput.supplier.stateCode ? String(rawOutput.supplier.stateCode).trim().padStart(2, '0') : null;
      canonical.supplier.phone = rawOutput.supplier.phone ? String(rawOutput.supplier.phone).trim() : null;
      canonical.supplier.email = rawOutput.supplier.email ? String(rawOutput.supplier.email).trim().toLowerCase() : null;
    }

    // Invoice normalization
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

    // Line items normalization
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

    // Totals normalization
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

    // Bank details
    if (rawOutput.bankDetails) {
      canonical.bankDetails.accountName = rawOutput.bankDetails.accountName || null;
      canonical.bankDetails.maskedAccountNumber = rawOutput.bankDetails.maskedAccountNumber || null;
      canonical.bankDetails.ifsc = rawOutput.bankDetails.ifsc ? String(rawOutput.bankDetails.ifsc).trim().toUpperCase() : null;
    }

    // Build provenance map
    const provenance = {};
    const rawProv = rawOutput.provenance || {};
    for (const [key, val] of Object.entries(rawProv)) {
      provenance[key] = createFieldProvenance(val);
    }

    return {
      canonical,
      provenance,
    };
  }
}

module.exports = {
  DeterministicMockInvoiceProvider,
};
