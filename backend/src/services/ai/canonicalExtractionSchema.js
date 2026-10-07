'use strict';

/**
 * ZAMORIN AI INVOICE INTELLIGENCE — CANONICAL EXTRACTION SCHEMA (PHASE 3 & 4)
 *
 * Defines the standard, normalized data contract independent of AI provider output format.
 * All providers (Gemini, Google Document AI, Mock) normalize their raw output to this schema.
 */

const CANONICAL_SCHEMA_VERSION = '2026.1';

/**
 * Creates an empty canonical extraction structure with strict defaults.
 * Missing fields are represented as null (not fabricated).
 */
function createEmptyCanonicalExtraction(metadata = {}) {
  return {
    schemaVersion: CANONICAL_SCHEMA_VERSION,
    documentType: 'TAX_INVOICE',

    supplier: {
      name: null,
      gstin: null,
      pan: null,
      address: null,
      state: null,
      stateCode: null,
      phone: null,
      email: null,
    },

    invoice: {
      invoiceNumber: null,
      invoiceDate: null,
      dueDate: null,
      purchaseOrderNumber: null,
      deliveryReference: null,
      currency: 'INR',
      placeOfSupply: null,
      reverseCharge: false,
      irn: null,
      eInvoiceNumber: null,
      eWayBillNumber: null,
    },

    lineItems: [],

    totals: {
      subtotal: null,
      discount: 0,
      taxableValue: null,
      cgst: 0,
      sgst: 0,
      igst: 0,
      cess: 0,
      freight: 0,
      otherCharges: 0,
      roundOff: 0,
      grandTotal: null,
    },

    bankDetails: {
      accountName: null,
      maskedAccountNumber: null,
      ifsc: null,
    },

    extractionMetadata: {
      provider: metadata.provider || 'UNKNOWN',
      modelVersion: metadata.modelVersion || 'UNKNOWN',
      schemaVersion: CANONICAL_SCHEMA_VERSION,
      processedAt: new Date(),
      documentHash: metadata.documentHash || null,
      documentId: metadata.documentId || null,
    },
  };
}

/**
 * Creates a field provenance record for source audit and human review UI.
 */
function createFieldProvenance({
  value = null,
  confidence = 1.0,
  page = 1,
  sourceText = '',
  boundingRegion = null,
} = {}) {
  return {
    value,
    confidence: Number(confidence) || 0,
    page: Number(page) || 1,
    sourceText: sourceText ? String(sourceText).slice(0, 500) : '',
    boundingRegion: boundingRegion || null,
  };
}

/**
 * Gemini responseSchema definition matching Canonical Extraction Schema 2026.1
 */
const GEMINI_CANONICAL_RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    documentType: {
      type: 'STRING',
      enum: ['TAX_INVOICE', 'BILL_OF_SUPPLY', 'CREDIT_NOTE', 'DEBIT_NOTE', 'PROFORMA_INVOICE', 'RECEIPT'],
    },
    supplier: {
      type: 'OBJECT',
      properties: {
        name: { type: 'STRING' },
        gstin: { type: 'STRING' },
        pan: { type: 'STRING' },
        address: { type: 'STRING' },
        state: { type: 'STRING' },
        stateCode: { type: 'STRING' },
        phone: { type: 'STRING' },
        email: { type: 'STRING' },
      },
      required: ['name'],
    },
    invoice: {
      type: 'OBJECT',
      properties: {
        invoiceNumber: { type: 'STRING' },
        invoiceDate: { type: 'STRING' },
        dueDate: { type: 'STRING' },
        purchaseOrderNumber: { type: 'STRING' },
        deliveryReference: { type: 'STRING' },
        currency: { type: 'STRING' },
        placeOfSupply: { type: 'STRING' },
        reverseCharge: { type: 'BOOLEAN' },
        irn: { type: 'STRING' },
        eInvoiceNumber: { type: 'STRING' },
        eWayBillNumber: { type: 'STRING' },
      },
      required: ['invoiceNumber', 'invoiceDate'],
    },
    lineItems: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          lineNumber: { type: 'INTEGER' },
          description: { type: 'STRING' },
          sku: { type: 'STRING' },
          supplierSku: { type: 'STRING' },
          hsnSac: { type: 'STRING' },
          quantity: { type: 'NUMBER' },
          unit: { type: 'STRING' },
          unitPrice: { type: 'NUMBER' },
          discountAmount: { type: 'NUMBER' },
          taxableValue: { type: 'NUMBER' },
          gstRate: { type: 'NUMBER' },
          cgstRate: { type: 'NUMBER' },
          cgstAmount: { type: 'NUMBER' },
          sgstRate: { type: 'NUMBER' },
          sgstAmount: { type: 'NUMBER' },
          igstRate: { type: 'NUMBER' },
          igstAmount: { type: 'NUMBER' },
          cessAmount: { type: 'NUMBER' },
          lineTotal: { type: 'NUMBER' },
        },
        required: ['description', 'quantity', 'unitPrice', 'taxableValue', 'lineTotal'],
      },
    },
    totals: {
      type: 'OBJECT',
      properties: {
        subtotal: { type: 'NUMBER' },
        discount: { type: 'NUMBER' },
        taxableValue: { type: 'NUMBER' },
        cgst: { type: 'NUMBER' },
        sgst: { type: 'NUMBER' },
        igst: { type: 'NUMBER' },
        cess: { type: 'NUMBER' },
        freight: { type: 'NUMBER' },
        otherCharges: { type: 'NUMBER' },
        roundOff: { type: 'NUMBER' },
        grandTotal: { type: 'NUMBER' },
      },
      required: ['grandTotal'],
    },
    bankDetails: {
      type: 'OBJECT',
      properties: {
        accountName: { type: 'STRING' },
        maskedAccountNumber: { type: 'STRING' },
        ifsc: { type: 'STRING' },
      },
    },
  },
  required: ['supplier', 'invoice', 'lineItems', 'totals'],
};

/**
 * Validates canonical extraction output structure server-side.
 * Returns { isValid: boolean, errors: string[] }.
 */
function validateCanonicalExtraction(obj) {
  const errors = [];
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    return { isValid: false, errors: ['Root extraction output must be a non-null object.'] };
  }

  if (!obj.supplier || typeof obj.supplier !== 'object' || Array.isArray(obj.supplier)) {
    errors.push('supplier object is required.');
  }

  if (!obj.invoice || typeof obj.invoice !== 'object' || Array.isArray(obj.invoice)) {
    errors.push('invoice object is required.');
  }

  if (obj.lineItems !== undefined && !Array.isArray(obj.lineItems)) {
    errors.push('lineItems must be an array.');
  }

  if (!obj.totals || typeof obj.totals !== 'object' || Array.isArray(obj.totals)) {
    errors.push('totals object is required.');
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}

module.exports = {
  CANONICAL_SCHEMA_VERSION,
  GEMINI_CANONICAL_RESPONSE_SCHEMA,
  createEmptyCanonicalExtraction,
  createFieldProvenance,
  validateCanonicalExtraction,
};
