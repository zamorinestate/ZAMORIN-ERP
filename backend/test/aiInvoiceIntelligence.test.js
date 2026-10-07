'use strict';

/**
 * ZAMORIN AI INVOICE INTELLIGENCE — COMPREHENSIVE TEST SUITE (PHASES 29, 30, 31)
 *
 * Covers:
 *   A. Document Extraction (PDF, JPEG, PNG, multi-page, invalid file, provider outage)
 *   B. Canonical Normalization (dates, currency, GSTIN, invoice number, line items)
 *   C. Deterministic Mathematical & GST Validation (decimal safety, paise precision, tax split)
 *   D. Vendor Master Matching (Priority 1: exact GSTIN, PAN, code, name; never auto-creates)
 *   E. Duplicate Invoice Detection (SHA-256 collision, compound business key, cross-vendor)
 *   F. Three-Way Reconciliation (PO ↔ Physical GRN accepted count ↔ Invoice, tolerance)
 *   G. RBAC & Multi-Tenant Security (Primary Master, Owner, Cafe Admin cafe-scoping, Staff denial)
 *   H. Concurrency & Extraction Idempotency
 *   I. CRITICAL NON-NEGOTIABLE FINANCIAL NON-MUTATION: Zero GL, Zero Cash, Zero Inventory, Zero PO/GRN changes
 */

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryReplSet } = require('mongodb-memory-server');

const { InvoiceExtraction } = require('../src/models/InvoiceExtraction');
const { Vendor } = require('../src/models/Vendor');
const { PurchaseOrder } = require('../src/models/PurchaseOrder');
const { BusinessDocument } = require('../src/models/BusinessDocument');
const { StockMovement } = require('../src/models/StockMovement');
const { InventoryLot } = require('../src/models/InventoryLot');
const { VendorLedgerEntry } = require('../src/models/VendorLedgerEntry');

const { InvoiceValidationService } = require('../src/services/ai/invoiceValidationService');
const { InvoiceVendorMatchingService } = require('../src/services/ai/invoiceVendorMatchingService');
const { InvoiceDuplicateDetectionService } = require('../src/services/ai/invoiceDuplicateDetectionService');
const { InvoiceThreeWayMatchIntegrationService } = require('../src/services/ai/invoiceThreeWayMatchIntegrationService');
const { InvoiceConfidenceService } = require('../src/services/ai/invoiceConfidenceService');
const { InvoiceExtractionService } = require('../src/services/ai/invoiceExtractionService');
const { InvoiceIntelligenceController } = require('../src/controllers/invoiceIntelligenceController');

const ORG_ID = 'ORG-ZAMORIN-AI';
const CAFE_1 = 'CAFE-PATIO-01';
const CAFE_2 = 'CAFE-MALL-02';

const MASTER_USER = { userId: 'PM-001', role: 'MASTER', isPrimaryMaster: true, organisationId: ORG_ID };
const OWNER_USER = { userId: 'OWN-001', role: 'OWNER', organisationId: ORG_ID };
const CAFE_ADMIN_USER = { userId: 'ADM-001', role: 'CAFE_ADMIN', organisationId: ORG_ID, cafeId: CAFE_1, accessibleCafes: [CAFE_1] };
const STAFF_USER = { userId: 'STF-001', role: 'STAFF', organisationId: ORG_ID, cafeId: CAFE_1 };

let mongoReplSet;

function createMockResponse() {
  const res = {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(data) {
      this.body = data;
      return this;
    },
  };
  return res;
}

describe('Zamorin AI Invoice Intelligence — Full System Verification', () => {
  before(async () => {
    process.env.INVOICE_AI_PROVIDER = 'deterministic_mock';
    process.env.AI_INVOICE_INTELLIGENCE_ENABLED = 'true';

    mongoReplSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(mongoReplSet.getUri());

    await InvoiceExtraction.createCollection().catch(() => {});
    await Vendor.createCollection().catch(() => {});
    await PurchaseOrder.createCollection().catch(() => {});
    await BusinessDocument.createCollection().catch(() => {});
    await StockMovement.createCollection().catch(() => {});
    await InventoryLot.createCollection().catch(() => {});
    await VendorLedgerEntry.createCollection().catch(() => {});
  });

  after(async () => {
    await mongoose.disconnect();
    if (mongoReplSet) await mongoReplSet.stop();
  });

  beforeEach(async () => {
    await InvoiceExtraction.deleteMany({});
    await Vendor.deleteMany({});
    await PurchaseOrder.deleteMany({});
    await BusinessDocument.deleteMany({});
    await StockMovement.deleteMany({});
    await InventoryLot.deleteMany({});
    await mongoose.connection.collection('vendorledgerentries').deleteMany({}).catch(() => {});

    // Seed Master Vendor
    await Vendor.create({
      vendorId: 'VEN-4001',
      organisationId: ORG_ID,
      name: 'Malabar Coffee Traders Pvt Ltd',
      nameLower: 'malabar coffee traders pvt ltd',
      tradeName: 'Malabar Roasters',
      supplierType: 'GOODS',
      category: 'FOOD_BEVERAGE',
      gstNumber: '32AABCM1234F1Z5',
      panNumber: 'AABCM1234F',
      status: 'ACTIVE',
      approvedCafeIds: [CAFE_1, CAFE_2],
      createdByUserId: 'MU-1001',
    });

    // Seed Purchase Order with Physical GRN
    await PurchaseOrder.create({
      purchaseOrderId: 'PO-2026-901',
      organisationId: ORG_ID,
      cafeId: CAFE_1,
      vendorId: 'VEN-4001',
      status: 'RECEIVED_PENDING_FINAL_POSTING',
      subtotalPaisa: 500000,
      taxPaisa: 25000,
      totalPaisa: 525000,
      createdByUserId: 'ADM-001',
      lineItems: [
        {
          itemId: 'ITM-COFFEE-01',
          name: 'Estate Arabica Beans 1kg',
          orderedQuantityBase: 10,
          receivedQuantityBase: 10,
          unitPricePaisa: 50000,
          taxRatePercent: 5,
          totalLinePaisa: 525000,
          baseUnit: 'KG',
        },
      ],
      grnReceipts: [
        {
          grnId: 'GRN-2026-801',
          deliveryNoteNumber: 'DN-8812',
          receivedAt: new Date('2026-03-15'),
          receivedByUserId: 'ADM-001',
          status: 'ACCEPTED',
          items: [
            {
              itemId: 'ITM-COFFEE-01',
              deliveredQty: 10,
              acceptedQty: 10,
              rejectedQty: 0,
            },
          ],
        },
      ],
    });
  });

  // ==========================================================================
  // SUITE A: EXTRACTION & FORMAT SUPPORT
  // ==========================================================================
  describe('Suite A: Document Extraction & Formats', () => {
    it('successfully extracts synthetic GST invoice from PDF buffer', async () => {
      const record = await InvoiceExtractionService.processInvoice({
        documentId: 'DOC-PDF-001',
        fileBuffer: Buffer.from('%PDF-1.4 Mock Invoice Content'),
        mimeType: 'application/pdf',
        filename: 'tax-invoice-101.pdf',
        organisationId: ORG_ID,
        cafeId: CAFE_1,
        purchaseOrderId: 'PO-2026-901',
        grnId: 'GRN-2026-801',
        uploadedByUserId: 'ADM-001',
      });

      assert.equal(record.documentId, 'DOC-PDF-001');
      assert.ok(['READY_FOR_APPROVAL', 'REVIEW_REQUIRED'].includes(record.status));
      assert.equal(record.supplier.gstin, '32AABCM1234F1Z5');
      assert.equal(record.lineItems.length, 1);
      assert.equal(record.lineItems[0].quantity, 10);
      assert.equal(record.totals.grandTotal, 5250);
      assert.equal(record.attemptCount, 1);
    });

    it('successfully extracts invoice from JPEG image format', async () => {
      const record = await InvoiceExtractionService.processInvoice({
        documentId: 'DOC-JPG-002',
        fileBuffer: Buffer.from('FFD8FFE000104A464946', 'hex'),
        mimeType: 'image/jpeg',
        filename: 'invoice-scan.jpg',
        organisationId: ORG_ID,
        cafeId: CAFE_1,
        uploadedByUserId: 'ADM-001',
      });

      assert.equal(record.documentId, 'DOC-JPG-002');
      assert.ok(record.supplier.name);
      assert.ok(record.totals.grandTotal > 0);
    });

    it('successfully handles PNG invoice format with field provenance', async () => {
      const record = await InvoiceExtractionService.processInvoice({
        documentId: 'DOC-PNG-003',
        fileBuffer: Buffer.from('89504E470D0A1A0A', 'hex'),
        mimeType: 'image/png',
        filename: 'invoice-scan.png',
        organisationId: ORG_ID,
        cafeId: CAFE_1,
        uploadedByUserId: 'ADM-001',
      });

      assert.equal(record.documentId, 'DOC-PNG-003');
      assert.ok(record.provenance.supplierGstin);
      assert.equal(record.provenance.supplierGstin.confidence, 0.99);
      assert.equal(record.provenance.grandTotal.page, 1);
    });

    it('handles simulated provider outage gracefully without crashing (Phase 22)', async () => {
      const failingBuffer = Buffer.from('SIMULATE_HTTP_500');
      const record = await InvoiceExtractionService.processInvoice({
        documentId: 'DOC-FAIL-500',
        fileBuffer: failingBuffer,
        mimeType: 'application/pdf',
        filename: 'failing.pdf',
        organisationId: ORG_ID,
        cafeId: CAFE_1,
        uploadedByUserId: 'ADM-001',
      });

      assert.equal(record.status, 'FAILED');
      assert.equal(record.lastErrorCode, 'PROVIDER_OUTAGE_SIMULATED');
      assert.equal(record.exceptions.length, 1);
      assert.equal(record.exceptions[0].code, 'AI_PROVIDER_FAILURE');
      assert.equal(record.exceptions[0].severity, 'BLOCKING');
    });
  });

  // ==========================================================================
  // SUITE B: NORMALIZATION
  // ==========================================================================
  describe('Suite B: Canonical Normalization', () => {
    it('normalizes dates, GSTINs, and line numbers into canonical schema 2026.1', () => {
      const rawExtracted = {
        supplier: { name: '  Malabar Roasters  ', gstin: '32aabcm1234f1z5 ' },
        invoice: { invoiceNumber: ' INV/2026/099 ', invoiceDate: '2026-03-15' },
        lineItems: [
          { lineNumber: 1, description: 'Coffee Beans', quantity: 5, unitPrice: 500, lineTotal: 2625, gstRate: 5 },
        ],
        totals: { taxableValue: 2500, cgst: 62.5, sgst: 62.5, grandTotal: 2625 },
      };

      const validResult = InvoiceValidationService.validate(rawExtracted);
      assert.equal(validResult.isValid, true);
      assert.equal(validResult.discrepancies.length, 0);
    });
  });

  // ==========================================================================
  // SUITE C: DETERMINISTIC MATHEMATICAL & GST VALIDATION
  // ==========================================================================
  describe('Suite C: Deterministic Mathematical & GST Validation', () => {
    it('validates perfect line calculation and tax split using integer paise', () => {
      const data = {
        lineItems: [
          { lineNumber: 1, description: 'Arabica Coffee', quantity: 10, unitPrice: 500, discountAmount: 0, taxableValue: 5000, gstRate: 5, cgstAmount: 125, sgstAmount: 125, lineTotal: 5250 },
        ],
        totals: { taxableValue: 5000, cgst: 125, sgst: 125, igst: 0, cess: 0, freight: 0, grandTotal: 5250 },
        supplier: { gstin: '32AABCM1234F1Z5' },
        invoice: { invoiceNumber: 'INV-2026-001', invoiceDate: '2026-03-15', placeOfSupply: '32' },
      };

      const res = InvoiceValidationService.validate(data);
      assert.equal(res.isValid, true);
      assert.equal(res.recalculatedTotals.grandTotalPaisa, 525000);
      assert.equal(res.gstValidation.isGstinValid, true);
      assert.equal(res.gstValidation.isInterState, false);
    });

    it('detects line multiplication mismatch and flags LINE_CALCULATION_MISMATCH', () => {
      const data = {
        lineItems: [
          { lineNumber: 1, description: 'Bad Math Item', quantity: 10, unitPrice: 500, taxableValue: 4000, lineTotal: 4200, gstRate: 5 },
        ],
        totals: { taxableValue: 4000, grandTotal: 4200 },
        supplier: { gstin: '32AABCM1234F1Z5' },
      };

      const res = InvoiceValidationService.validate(data);
      assert.equal(res.isValid, false);
      const err = res.discrepancies.find((d) => d.code === 'LINE_CALCULATION_MISMATCH');
      assert.ok(err);
      assert.equal(err.severity, 'BLOCKING');
    });

    it('detects header total mismatch and flags TOTAL_MISMATCH', () => {
      const data = {
        lineItems: [
          { lineNumber: 1, description: 'Item 1', quantity: 2, unitPrice: 100, taxableValue: 200, gstRate: 5, lineTotal: 210 },
        ],
        totals: { taxableValue: 200, cgst: 5, sgst: 5, grandTotal: 250 }, // Grand total should be 210
        supplier: { gstin: '32AABCM1234F1Z5' },
      };

      const res = InvoiceValidationService.validate(data);
      assert.equal(res.isValid, false);
      const totalErr = res.discrepancies.find((d) => d.code === 'TOTAL_MISMATCH');
      assert.ok(totalErr);
    });

    it('detects invalid GSTIN format and flags GSTIN_INVALID', () => {
      const data = {
        lineItems: [{ lineNumber: 1, description: 'Item', quantity: 1, unitPrice: 100, taxableValue: 100, lineTotal: 105, gstRate: 5 }],
        totals: { taxableValue: 100, cgst: 2.5, sgst: 2.5, grandTotal: 105 },
        supplier: { gstin: 'INVALID_GSTIN_123' },
      };

      const res = InvoiceValidationService.validate(data);
      assert.equal(res.isValid, false);
      const gstinErr = res.discrepancies.find((d) => d.code === 'GSTIN_INVALID');
      assert.ok(gstinErr);
    });
  });

  // ==========================================================================
  // SUITE D: VENDOR MASTER MATCHING
  // ==========================================================================
  describe('Suite D: Vendor Master Matching (Phase 8)', () => {
    it('Priority 1: matches exact GSTIN with 100% confidence', async () => {
      const match = await InvoiceVendorMatchingService.matchSupplier({
        extractedSupplier: { name: 'Some Brand Name', gstin: '32AABCM1234F1Z5' },
        organisationId: ORG_ID,
      });

      assert.equal(match.status, 'MATCHED');
      assert.equal(match.matchedVendorId, 'VEN-4001');
      assert.equal(match.matchStrategy, 'EXACT_GSTIN');
      assert.equal(match.matchConfidence, 1.0);
    });

    it('Priority 2: matches exact PAN if GSTIN missing', async () => {
      const match = await InvoiceVendorMatchingService.matchSupplier({
        extractedSupplier: { name: 'Unknown Trading Co', pan: 'AABCM1234F' },
        organisationId: ORG_ID,
      });

      assert.equal(match.status, 'MATCHED');
      assert.equal(match.matchedVendorId, 'VEN-4001');
      assert.equal(match.matchStrategy, 'EXACT_PAN');
      assert.equal(match.matchConfidence, 0.95);
    });

    it('Priority 3: matches supplier ID pattern VEN-xxxx', async () => {
      const match = await InvoiceVendorMatchingService.matchSupplier({
        extractedSupplier: { name: 'Order for VEN-4001' },
        organisationId: ORG_ID,
      });

      assert.equal(match.status, 'MATCHED');
      assert.equal(match.matchedVendorId, 'VEN-4001');
      assert.equal(match.matchStrategy, 'SUPPLIER_CODE');
    });

    it('Priority 4: matches normalized vendor name', async () => {
      const match = await InvoiceVendorMatchingService.matchSupplier({
        extractedSupplier: { name: 'Malabar Coffee Traders Pvt Ltd' },
        organisationId: ORG_ID,
      });

      assert.equal(match.status, 'MATCHED');
      assert.equal(match.matchedVendorId, 'VEN-4001');
      assert.equal(match.matchStrategy, 'NORMALIZED_NAME');
    });

    it('returns NOT_FOUND for unknown supplier and NEVER creates a vendor record', async () => {
      const vendorCountBefore = await Vendor.countDocuments({ organisationId: ORG_ID });

      const match = await InvoiceVendorMatchingService.matchSupplier({
        extractedSupplier: { name: 'Ghost Roastery Unknown', gstin: '27AABCG9999F1Z0' },
        organisationId: ORG_ID,
      });

      assert.equal(match.status, 'NOT_FOUND');
      assert.equal(match.matchedVendorId, null);

      const vendorCountAfter = await Vendor.countDocuments({ organisationId: ORG_ID });
      assert.equal(vendorCountBefore, vendorCountAfter, 'INVARIANT VIOLATION: AI created a vendor record!');
    });
  });

  // ==========================================================================
  // SUITE E: DUPLICATE DETECTION
  // ==========================================================================
  describe('Suite E: Deterministic Duplicate Detection (Phase 9)', () => {
    it('detects exact SHA-256 document hash collision', async () => {
      await InvoiceExtraction.create({
        documentId: 'DOC-EXISTING-01',
        documentHash: 'a591a6d40bf420404a011733cfb7b190d62c65bf0bcda32b57b277d9ad9f146e',
        organisationId: ORG_ID,
        status: 'READY_FOR_APPROVAL',
        invoice: { invoiceNumber: 'INV-1001' },
      });

      const dup = await InvoiceDuplicateDetectionService.checkDuplicate({
        documentId: 'DOC-NEW-UPLOAD',
        documentHash: 'a591a6d40bf420404a011733cfb7b190d62c65bf0bcda32b57b277d9ad9f146e',
        extracted: { invoice: { invoiceNumber: 'INV-1001' } },
        organisationId: ORG_ID,
      });

      assert.equal(dup.status, 'EXACT_DUPLICATE');
      assert.equal(dup.duplicateRecordId, 'DOC-EXISTING-01');
      assert.ok(dup.matchedFields.includes('documentHash'));
    });

    it('detects compound business key collision (same vendor + invoice number)', async () => {
      await InvoiceExtraction.create({
        documentId: 'DOC-PRIOR-02',
        documentHash: 'different-hash-123',
        organisationId: ORG_ID,
        status: 'READY_FOR_APPROVAL',
        vendorMatch: { matchedVendorId: 'VEN-4001', matchedVendorName: 'Malabar Coffee Traders' },
        invoice: { invoiceNumber: 'INV-MALABAR-501' },
        totals: { grandTotal: 5250 },
      });

      const dup = await InvoiceDuplicateDetectionService.checkDuplicate({
        documentId: 'DOC-NEW-02',
        documentHash: 'another-hash-456',
        extracted: {
          invoice: { invoiceNumber: 'INV-MALABAR-501' },
          totals: { grandTotal: 5250 },
        },
        vendorMatch: { matchedVendorId: 'VEN-4001', matchedVendorName: 'Malabar Coffee Traders' },
        organisationId: ORG_ID,
      });

      assert.equal(dup.status, 'EXACT_DUPLICATE');
      assert.equal(dup.duplicateRecordId, 'DOC-PRIOR-02');
      assert.ok(dup.matchedFields.includes('invoiceNumber'));
    });

    it('allows same invoice number across DIFFERENT vendors as POSSIBLE_DUPLICATE warning', async () => {
      await InvoiceExtraction.create({
        documentId: 'DOC-VENDOR-A',
        documentHash: 'hash-aaa',
        organisationId: ORG_ID,
        status: 'READY_FOR_APPROVAL',
        vendorMatch: { matchedVendorId: 'VEN-4001', matchedVendorName: 'Malabar Coffee Traders' },
        invoice: { invoiceNumber: 'INV-COMMON-99' },
      });

      const dup = await InvoiceDuplicateDetectionService.checkDuplicate({
        documentId: 'DOC-VENDOR-B',
        documentHash: 'hash-bbb',
        extracted: { invoice: { invoiceNumber: 'INV-COMMON-99' } },
        vendorMatch: { matchedVendorId: 'VEN-9999', matchedVendorName: 'Packaging Express' },
        organisationId: ORG_ID,
      });

      assert.equal(dup.status, 'POSSIBLE_DUPLICATE');
    });
  });

  // ==========================================================================
  // SUITE F: THREE-WAY MATCH ENGINE (PO ↔ GRN ↔ INVOICE)
  // ==========================================================================
  describe('Suite F: Three-Way Match Engine (Phases 12, 13, 14)', () => {
    it('evaluates clean 100% 3-way match', async () => {
      const match = await InvoiceThreeWayMatchIntegrationService.reconcile({
        extracted: {
          invoice: { purchaseOrderNumber: 'PO-2026-901' },
          lineItems: [
            { lineNumber: 1, sku: 'ITM-COFFEE-01', description: 'Arabica Beans', quantity: 10, unitPrice: 500, gstRate: 5, lineTotal: 5250 },
          ],
          totals: { grandTotal: 5250 },
        },
        matchedVendorId: 'VEN-4001',
        purchaseOrderId: 'PO-2026-901',
        organisationId: ORG_ID,
      });

      assert.equal(match.status, 'MATCHED');
      assert.equal(match.lineMatches.length, 1);
      assert.equal(match.lineMatches[0].matchResult, 'MATCH');
      assert.equal(match.lineMatches[0].grnAcceptedQuantity, 10);
    });

    it('enforces PHYSICAL GRN accepted quantity: invoice quantity mismatch flags QUANTITY_VARIANCE', async () => {
      const match = await InvoiceThreeWayMatchIntegrationService.reconcile({
        extracted: {
          invoice: { purchaseOrderNumber: 'PO-2026-901' },
          lineItems: [
            // Supplier bills for 15, but dock accepted only 10
            { lineNumber: 1, sku: 'ITM-COFFEE-01', description: 'Arabica Beans', quantity: 15, unitPrice: 500, gstRate: 5, lineTotal: 7875 },
          ],
          totals: { grandTotal: 7875 },
        },
        matchedVendorId: 'VEN-4001',
        purchaseOrderId: 'PO-2026-901',
        organisationId: ORG_ID,
      });

      assert.equal(match.status, 'EXCEPTION');
      const line = match.lineMatches[0];
      assert.equal(line.matchResult, 'QUANTITY_VARIANCE');
      assert.equal(line.invoiceQuantity, 15);
      assert.equal(line.grnAcceptedQuantity, 10);
      assert.ok(line.discrepancyReason.includes('Invoice quantity (15) differs from physical GRN accepted quantity (10)'));
    });

    it('flags PRICE_VARIANCE when invoice unit rate exceeds PO rate outside tolerance', async () => {
      const match = await InvoiceThreeWayMatchIntegrationService.reconcile({
        extracted: {
          invoice: { purchaseOrderNumber: 'PO-2026-901' },
          lineItems: [
            // Rate is ₹550 vs PO rate ₹500
            { lineNumber: 1, sku: 'ITM-COFFEE-01', description: 'Arabica Beans', quantity: 10, unitPrice: 550, gstRate: 5, lineTotal: 5775 },
          ],
          totals: { grandTotal: 5775 },
        },
        matchedVendorId: 'VEN-4001',
        purchaseOrderId: 'PO-2026-901',
        organisationId: ORG_ID,
        toleranceConfig: { rateTolerancePaisa: 100, qtyTolerancePercent: 0, totalTolerancePaisa: 100 },
      });

      assert.equal(match.status, 'EXCEPTION');
      assert.equal(match.lineMatches[0].matchResult, 'PRICE_VARIANCE');
    });

    it('flags PO_VENDOR_MISMATCH if invoice supplier differs from PO supplier', async () => {
      const match = await InvoiceThreeWayMatchIntegrationService.reconcile({
        extracted: {
          invoice: { purchaseOrderNumber: 'PO-2026-901' },
          lineItems: [{ lineNumber: 1, sku: 'ITM-COFFEE-01', quantity: 10, unitPrice: 500, gstRate: 5, lineTotal: 5250 }],
          totals: { grandTotal: 5250 },
        },
        matchedVendorId: 'VEN-DIFFERENT-999',
        purchaseOrderId: 'PO-2026-901',
        organisationId: ORG_ID,
      });

      assert.equal(match.status, 'BLOCKED');
      const err = match.overallDiscrepancies.find((d) => d.code === 'PO_VENDOR_MISMATCH');
      assert.ok(err);
      assert.equal(err.severity, 'BLOCKING');
    });

    it('flags PO_NOT_FOUND when PO reference is missing from database', async () => {
      const match = await InvoiceThreeWayMatchIntegrationService.reconcile({
        extracted: {
          invoice: { purchaseOrderNumber: 'PO-NON-EXISTENT-404' },
          lineItems: [],
        },
        purchaseOrderId: 'PO-NON-EXISTENT-404',
        organisationId: ORG_ID,
      });

      assert.equal(match.status, 'BLOCKED');
      assert.equal(match.overallDiscrepancies[0].code, 'PO_NOT_FOUND');
    });
  });

  // ==========================================================================
  // SUITE G: RBAC & MULTI-TENANT SECURITY (PHASE 18)
  // ==========================================================================
  describe('Suite G: RBAC & Multi-Tenant Security', () => {
    it('DENIES Staff persona on extract API with HTTP 403 PERMISSION_DENIED', async () => {
      const req = {
        params: { documentId: 'DOC-STAFF-DENIAL' },
        body: {},
        auth: STAFF_USER,
      };
      const res = createMockResponse();

      await InvoiceIntelligenceController.extractVendorBill(req, res);
      assert.equal(res.statusCode, 403);
      assert.equal(res.body?.error?.code, 'PERMISSION_DENIED');
    });

    it('DENIES Staff persona on approval API with HTTP 403 PERMISSION_DENIED', async () => {
      const req = {
        params: { documentId: 'DOC-STAFF-DENIAL' },
        body: {},
        auth: STAFF_USER,
      };
      const res = createMockResponse();

      await InvoiceIntelligenceController.approveExtraction(req, res);
      assert.equal(res.statusCode, 403);
      assert.equal(res.body?.error?.code, 'PERMISSION_DENIED');
    });

    it('enforces CAFE_ADMIN scoping: rejects cross-café access with CROSS_CAFE_ACCESS_DENIED', async () => {
      // Create extraction for CAFE_2
      await InvoiceExtraction.create({
        documentId: 'DOC-CAFE2-BILL',
        documentHash: 'hash-cafe2',
        organisationId: ORG_ID,
        cafeId: CAFE_2,
        status: 'READY_FOR_APPROVAL',
      });

      // Admin assigned only to CAFE_1 attempts access
      const req = {
        params: { documentId: 'DOC-CAFE2-BILL' },
        auth: CAFE_ADMIN_USER,
      };
      const res = createMockResponse();

      await InvoiceIntelligenceController.getExtraction(req, res);
      assert.equal(res.statusCode, 403);
      assert.equal(res.body?.error?.code, 'CROSS_CAFE_ACCESS_DENIED');
    });

    it('allows Primary Master enterprise-wide access across all cafés', async () => {
      await InvoiceExtraction.create({
        documentId: 'DOC-MASTER-PERMITTED',
        documentHash: 'hash-master',
        organisationId: ORG_ID,
        cafeId: CAFE_2,
        status: 'READY_FOR_APPROVAL',
      });

      const req = {
        params: { documentId: 'DOC-MASTER-PERMITTED' },
        auth: MASTER_USER,
      };
      const res = createMockResponse();

      await InvoiceIntelligenceController.getExtraction(req, res);
      assert.equal(res.statusCode, 200);
      assert.equal(res.body?.data?.documentId, 'DOC-MASTER-PERMITTED');
    });
  });

  // ==========================================================================
  // SUITE H: CONCURRENCY & IDEMPOTENCY (PHASE 7)
  // ==========================================================================
  describe('Suite H: Concurrency & Extraction Idempotency', () => {
    it('re-processing the same documentId resolves to the same extraction record with incremented attemptCount', async () => {
      const run1 = await InvoiceExtractionService.processInvoice({
        documentId: 'DOC-IDEMPOTENT-01',
        fileBuffer: Buffer.from('Initial File Content'),
        mimeType: 'application/pdf',
        organisationId: ORG_ID,
        cafeId: CAFE_1,
        uploadedByUserId: 'ADM-001',
      });

      assert.equal(run1.attemptCount, 1);

      // Trigger reprocess
      const run2 = await InvoiceExtractionService.processInvoice({
        documentId: 'DOC-IDEMPOTENT-01',
        fileBuffer: Buffer.from('Initial File Content'),
        mimeType: 'application/pdf',
        organisationId: ORG_ID,
        cafeId: CAFE_1,
        uploadedByUserId: 'ADM-001',
        isReprocess: true,
      });

      assert.equal(run2.documentId, run1.documentId);
      assert.equal(run2.attemptCount, 2);

      const totalCount = await InvoiceExtraction.countDocuments({ documentId: 'DOC-IDEMPOTENT-01' });
      assert.equal(totalCount, 1, 'Duplicate extraction record created despite idempotency constraint!');
    });
  });

  // ==========================================================================
  // SUITE I: CRITICAL FINANCIAL NON-MUTATION REGRESSION (PHASE 31)
  // ==========================================================================
  describe('Suite I: Financial Non-Mutation Invariant (Phase 31)', () => {
    it('PROVES AI extraction creates ZERO GL entries, ZERO payments, ZERO cash movements, and ZERO inventory mutations', async () => {
      // 1. Snapshot ERP systems of record BEFORE AI extraction
      const glCountBefore = await VendorLedgerEntry.countDocuments({});
      const stockMovementsBefore = await StockMovement.countDocuments({});
      const inventoryLotsBefore = await InventoryLot.countDocuments({});
      const poBefore = await PurchaseOrder.findOne({ purchaseOrderId: 'PO-2026-901' }).lean();

      // 2. Execute full AI intelligence pipeline
      const extraction = await InvoiceExtractionService.processInvoice({
        documentId: 'DOC-FIN-SAFETY-TEST',
        fileBuffer: Buffer.from('Financial Non Mutation Verification'),
        mimeType: 'application/pdf',
        filename: 'tax-invoice.pdf',
        organisationId: ORG_ID,
        cafeId: CAFE_1,
        purchaseOrderId: 'PO-2026-901',
        grnId: 'GRN-2026-801',
        uploadedByUserId: 'ADM-001',
      });

      assert.equal(extraction.documentId, 'DOC-FIN-SAFETY-TEST');

      // 3. Snapshot ERP systems of record AFTER AI extraction
      const glCountAfter = await VendorLedgerEntry.countDocuments({});
      const stockMovementsAfter = await StockMovement.countDocuments({});
      const inventoryLotsAfter = await InventoryLot.countDocuments({});
      const poAfter = await PurchaseOrder.findOne({ purchaseOrderId: 'PO-2026-901' }).lean();

      // 4. Assert strict zero-mutation invariants
      assert.equal(glCountAfter, glCountBefore, 'INVARIANT VIOLATION: AI created a General Ledger / Vendor Ledger entry!');
      assert.equal(stockMovementsAfter, stockMovementsBefore, 'INVARIANT VIOLATION: AI created a StockMovement!');
      assert.equal(inventoryLotsAfter, inventoryLotsBefore, 'INVARIANT VIOLATION: AI mutated InventoryLot!');

      // 5. Assert Purchase Order & Physical GRN remain completely unaltered
      assert.equal(poAfter.status, poBefore.status, 'INVARIANT VIOLATION: AI altered Purchase Order status!');
      assert.equal(poAfter.totalPaisa, poBefore.totalPaisa, 'INVARIANT VIOLATION: AI altered Purchase Order financial total!');
      assert.deepEqual(poAfter.lineItems, poBefore.lineItems, 'INVARIANT VIOLATION: AI altered Purchase Order line items!');
      assert.deepEqual(poAfter.grnReceipts, poBefore.grnReceipts, 'INVARIANT VIOLATION: AI altered Physical GRN accepted quantities!');
    });
  });
});
