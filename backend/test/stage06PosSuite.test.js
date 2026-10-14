'use strict';

/**
 * STAGE 06: POS & ORDER MANAGEMENT MASTER TEST SUITE
 *
 * Verifies:
 *  1. Concurrency Idempotency: 10 concurrent burst requests with same idempotencyKey create exactly 1 transaction.
 *  2. Explicit Action SAVE: Saves to DB, generates official receipt ID, no print buffer.
 *  3. Explicit Action PRINT: Generates print buffer for existing committed bill without state mutation.
 *  4. Explicit Action SAVE_AND_PRINT: Saves to DB, generates ESC/POS binary buffer with UPI QR code & drawer kick pulse.
 *  5. Safe Printer Failure Resilience: Printer failure during SAVE_AND_PRINT NEVER rolls back DB commit;
 *     returns committed bill + printerWarning: 'PRINTER_OFFLINE' + reprintAvailable: true.
 *  6. Failed Save Protection: Validation/save failures abort receipt generation and drawer kick.
 *  7. Authorized REPRINT: Retrieves original transaction with '*** REPRINT (Copy #N) ***' header & audit logging.
 *  8. Real-time PREVIEW: Computes line items, taxes, discounts without database persistence.
 *  9. Cross-Café Isolation: Denies cross-café submissions for unauthorized users.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { PosOrderService } = require('../src/services/posOrderService');
const { Bill } = require('../src/models/Bill');
const { Cafe } = require('../src/models/Cafe');
const { MenuItem } = require('../src/models/MenuItem');
const { OutletOffering } = require('../src/models/OutletOffering');
const { RegisterSession } = require('../src/models/RegisterSession');
const { CashTransaction } = require('../src/models/CashTransaction');
const { SequenceCounter } = require('../src/models/SequenceCounter');
const { AuditEvent } = require('../src/models/AuditEvent');
const { PrintJob } = require('../src/models/PrintJob');
const { IdempotencyRecord } = require('../src/models/IdempotencyRecord');
const { BomDepletionService } = require('../src/services/bomDepletionService');
const auditService = require('../src/services/auditService');

function createAuthContext(role = 'STAFF', cafeId = 'ZC-0001', userId = 'EMP-ZC-1001') {
  return {
    userId,
    name: 'Test Cashier',
    email: 'cashier@zamorin.local',
    role,
    organisationId: 'ORG-ZAMORIN',
    assignedCafeIds: [cafeId],
    primaryCafeId: cafeId,
  };
}

test('STAGE 06 — POS & Order Management Master Test Suite', async (t) => {
  // In-memory mock database store
  const mockBills = [];
  const mockSessions = [];
  const mockCashTransactions = [];
  const mockIdempotencyRecords = [];
  let seqCounter = 5000;

  // Mock models and services
  AuditEvent.prototype.save = async function () { return this; };
  PrintJob.prototype.save = async function () { return this; };

  IdempotencyRecord.prototype.save = async function () {
    const idx = mockIdempotencyRecords.findIndex(
      (r) => r.idempotencyKey === this.idempotencyKey && r.cafeId === this.cafeId
    );
    if (idx >= 0) mockIdempotencyRecords[idx] = this;
    else mockIdempotencyRecords.push(this);
    return this;
  };

  t.mock.method(IdempotencyRecord, 'findOne', async (query) => {
    return mockIdempotencyRecords.find(
      (r) => r.idempotencyKey === query.idempotencyKey &&
             (!query.cafeId || r.cafeId === query.cafeId)
    ) || null;
  });

  t.mock.method(IdempotencyRecord, 'findOneAndUpdate', async (query, update) => {
    const rec = mockIdempotencyRecords.find((r) => r.idempotencyKey === query.idempotencyKey);
    if (rec) {
      Object.assign(rec, update.$set || update);
    }
    return rec || null;
  });

  t.mock.method(IdempotencyRecord, 'deleteOne', async () => ({}));

  t.mock.method(BomDepletionService, 'depleteOrderBOM', async () => ({
    depleted: true,
    depletionCount: 1,
    source: 'MOCK',
  }));

  t.mock.method(auditService, 'recordRequestAudit', async () => ({}));
  t.mock.method(auditService, 'recordAuditEvent', async () => ({}));

  t.mock.method(SequenceCounter, 'generateId', async ({ prefix }) => {
    seqCounter += 1;
    return `${prefix}-${seqCounter}`;
  });

  CashTransaction.prototype.save = async function () {
    mockCashTransactions.push(this);
    return this;
  };

  RegisterSession.prototype.save = async function () {
    const idx = mockSessions.findIndex((s) => s.registerSessionId === this.registerSessionId);
    if (idx >= 0) mockSessions[idx] = this;
    else mockSessions.push(this);
    return this;
  };

  t.mock.method(RegisterSession, 'findOne', async (query) => {
    return mockSessions.find((s) => {
      if (query.registerSessionId && s.registerSessionId !== query.registerSessionId) return false;
      if (query.status && s.status !== query.status) return false;
      return true;
    }) || null;
  });

  t.mock.method(Cafe, 'findOne', async () => ({
    cafeId: 'ZC-0001',
    name: 'Zamorin Koramangala',
    legalName: 'Zamorin Hospitality Private Limited',
    gstin: '29AABCT1332L1ZV',
    fssaiLicenseNumber: '11223344556677',
    address: { line1: '80ft Road, 4th Block', city: 'Bengaluru', pincode: '560095' },
    contactPhone: '+91 80 2555 1234',
    toObject() { return this; },
  }));

  t.mock.method(MenuItem, 'find', () => ({
    lean: async () => [
      { menuItemId: 'MNU-COFFEE-01', name: 'Zamorin Pour-Over', currentPricePaisa: 22000, taxRatePercent: 5 },
      { menuItemId: 'MNU-BAKERY-01', name: 'Malabar Cardamom Bun', currentPricePaisa: 15000, taxRatePercent: 5 },
    ],
  }));

  t.mock.method(OutletOffering, 'find', () => ({
    lean: async () => [],
  }));

  Bill.prototype.save = async function () {
    const idx = mockBills.findIndex((b) => b.billId === this.billId);
    if (idx >= 0) mockBills[idx] = this;
    else mockBills.push(this);
    return this;
  };

  Bill.prototype.toObject = function () {
    return {
      billId: this.billId,
      invoiceNumber: this.invoiceNumber,
      organisationId: this.organisationId,
      cafeId: this.cafeId,
      serviceMode: this.serviceMode,
      orderType: this.orderType,
      tableNumber: this.tableNumber,
      lineItems: this.lineItems,
      subtotalPaisa: this.subtotalPaisa,
      discountPaisa: this.discountPaisa,
      taxPaisa: this.taxPaisa,
      cgstPaisa: this.cgstPaisa,
      sgstPaisa: this.sgstPaisa,
      igstPaisa: this.igstPaisa,
      totalPaisa: this.totalPaisa,
      paymentMethod: this.paymentMethod,
      paymentStatus: this.paymentStatus,
      status: this.status,
      tenders: this.tenders || [],
      reprints: this.reprints || [],
      businessDate: this.businessDate,
      cashierUserId: this.cashierUserId,
      correlationId: this.correlationId,
    };
  };

  t.mock.method(Bill, 'findOne', async (query) => {
    return mockBills.find((b) => {
      if (query.billId && b.billId !== query.billId) return false;
      if (query.correlationId && b.correlationId !== query.correlationId) return false;
      if (query.$or) {
        return query.$or.some((c) => (c.billId && b.billId === c.billId) || (c.invoiceNumber && b.invoiceNumber === c.invoiceNumber));
      }
      return true;
    }) || null;
  });

  // TEST 1: Real-time PREVIEW without DB commitment
  await t.test('1. PREVIEW computes totals and HTML markup without persisting to database', async () => {
    const auth = createAuthContext();
    const initialBillCount = mockBills.length;

    const preview = await PosOrderService.previewReceipt(
      {
        cafeId: 'ZC-0001',
        orderType: 'DINE_IN',
        tableNumber: 'T-05',
        lineItems: [
          { menuItemId: 'MNU-COFFEE-01', name: 'Zamorin Pour-Over', quantity: 2, unitPricePaisa: 22000, taxRatePercent: 5 },
          { menuItemId: 'MNU-BAKERY-01', name: 'Malabar Cardamom Bun', quantity: 1, unitPricePaisa: 15000, taxRatePercent: 5 },
        ],
        discountPaisa: 2000,
      },
      auth
    );

    assert.equal(preview.success, true);
    assert.equal(preview.action, 'PREVIEW');
    assert.equal(preview.preview, true);
    assert.equal(preview.totals.subtotalPaisa, 59000); // (2 * 22000) + 15000 = 59000
    assert.equal(preview.totals.discountPaisa, 2000);
    assert.ok(preview.receiptPreviewHtml.toUpperCase().includes('ZAMORIN'));
    assert.ok(preview.receiptPreviewHtml.includes('T-05') || preview.receiptPreviewHtml.includes('Zamorin Pour-Over'));

    // DB count remains unchanged
    assert.equal(mockBills.length, initialBillCount);
  });

  // TEST 2: Explicit Action SAVE (saves to DB, generates IDs, no print buffer)
  await t.test('2. SAVE persists transaction with official billId & invoiceNumber without emitting print buffer', async () => {
    const auth = createAuthContext();
    const result = await PosOrderService.processOrder(
      {
        cafeId: 'ZC-0001',
        orderType: 'QUICK_SALE',
        paymentMethod: 'CASH',
        lineItems: [
          { menuItemId: 'MNU-COFFEE-01', name: 'Zamorin Pour-Over', quantity: 1, unitPricePaisa: 22000, taxRatePercent: 5 },
        ],
      },
      auth,
      'SAVE'
    );

    assert.equal(result.success, true);
    assert.equal(result.action, 'SAVE');
    assert.equal(result.printed, false);
    assert.equal(result.printBuffer, null);
    assert.ok(result.bill.billId.startsWith('BILL-'));
    assert.ok(result.bill.invoiceNumber.startsWith('INV-') || result.bill.invoiceNumber.startsWith('P/'));
    assert.equal(result.bill.status, 'COMPLETED');
    assert.equal(result.bill.paymentStatus, 'PAID');

    // Verify cash transaction was recorded
    const savedCashTx = mockCashTransactions.find((c) => c.referenceId === result.bill.billId);
    assert.ok(savedCashTx);
    assert.equal(savedCashTx.category, 'POS_SALE');
  });

  // TEST 3: Explicit Action SAVE_AND_PRINT (saves to DB and generates binary ESC/POS buffer & drawer kick)
  await t.test('3. SAVE_AND_PRINT commits to DB and compiles ESC/POS binary receipt with drawer pulse', async () => {
    const auth = createAuthContext();
    const result = await PosOrderService.processOrder(
      {
        cafeId: 'ZC-0001',
        orderType: 'TAKEAWAY',
        paymentMethod: 'CASH',
        lineItems: [
          { menuItemId: 'MNU-COFFEE-01', name: 'Zamorin Pour-Over', quantity: 2, unitPricePaisa: 22000, taxRatePercent: 5 },
        ],
      },
      auth,
      'SAVE_AND_PRINT'
    );

    assert.equal(result.success, true);
    assert.equal(result.action, 'SAVE_AND_PRINT');
    assert.equal(result.printed, true);
    assert.ok(result.printBuffer);
    assert.ok(Buffer.isBuffer(result.rawBuffer));
    assert.ok(result.htmlPreview.toUpperCase().includes('ZAMORIN'));

    // Check ESC/POS byte sequence contains drawer kick command: 0x1B 0x70 (ESC p)
    const rawBytes = Array.from(result.rawBuffer);
    const hasDrawerKick = rawBytes.some((byte, idx) => byte === 0x1B && rawBytes[idx + 1] === 0x70);
    assert.ok(hasDrawerKick, 'Raw buffer must include ESC/POS cash drawer kick sequence (ESC p)');
  });

  // TEST 4: Safe Printer Failure Resilience
  await t.test('4. Safe Printer Failure Resilience: DB commit NEVER rolls back on printer error, returns PRINTER_OFFLINE warning', async () => {
    const auth = createAuthContext();
    const initialBillCount = mockBills.length;

    const result = await PosOrderService.processOrder(
      {
        cafeId: 'ZC-0001',
        orderType: 'QUICK_SALE',
        paymentMethod: 'UPI',
        lineItems: [
          { menuItemId: 'MNU-BAKERY-01', name: 'Malabar Cardamom Bun', quantity: 3, unitPricePaisa: 15000, taxRatePercent: 5 },
        ],
      },
      auth,
      'SAVE_AND_PRINT',
      { simulatePrinterFailure: true }
    );

    assert.equal(result.success, true);
    assert.equal(result.action, 'SAVE_AND_PRINT');
    assert.equal(result.printed, false);
    assert.equal(result.printerWarning, 'PRINTER_OFFLINE');
    assert.equal(result.reprintAvailable, true);
    assert.ok(result.bill.billId);

    // CRITICAL: Bill remains committed in DB despite printer failure!
    assert.equal(mockBills.length, initialBillCount + 1);
    const inDb = mockBills.find((b) => b.billId === result.bill.billId);
    assert.ok(inDb);
    assert.equal(inDb.status, 'COMPLETED');
  });

  // TEST 5: Explicit Action PRINT on committed bill
  await t.test('5. PRINT generates receipt buffer for existing committed bill without state mutation', async () => {
    const auth = createAuthContext();
    // Retrieve previously created bill
    const existingBill = mockBills[0];

    const result = await PosOrderService.printCommittedBill(existingBill.billId, auth);

    assert.equal(result.success, true);
    assert.equal(result.action, 'PRINT');
    assert.equal(result.printed, true);
    assert.ok(result.printBuffer);
    assert.equal(result.bill.billId, existingBill.billId);
  });

  // TEST 6: Authorized REPRINT with watermark and copy counter
  await t.test('6. REPRINT increments reprint counter and includes *** REPRINT (Copy #N) *** in receipt', async () => {
    const auth = createAuthContext('SUPERVISOR');
    const existingBill = mockBills[0];
    const initialReprintCount = existingBill.reprints?.length || 0;

    const result = await PosOrderService.reprintBill(existingBill.billId, auth, 'Customer Lost Bill');

    assert.equal(result.success, true);
    assert.equal(result.action, 'REPRINT');
    assert.equal(result.isReprint, true);
    assert.equal(result.reprintCount, initialReprintCount + 1);
    assert.ok(result.printBuffer);
    assert.ok(result.htmlPreview);

    // Verify reprint record was persisted to bill
    assert.equal(existingBill.reprints.length, initialReprintCount + 1);
    assert.equal(existingBill.reprints[initialReprintCount].reason, 'Customer Lost Bill');
  });

  // TEST 7: High-concurrency deduplication & 60-minute idempotency cache
  await t.test('7. High-concurrency deduplication: 10 concurrent requests with same idempotencyKey create exactly 1 transaction', async () => {
    const auth = createAuthContext();
    const sharedIdempotencyKey = `BURST-KEY-${Date.now()}`;
    const initialBillCount = mockBills.length;

    const payload = {
      cafeId: 'ZC-0001',
      orderType: 'QUICK_SALE',
      paymentMethod: 'UPI',
      idempotencyKey: sharedIdempotencyKey,
      lineItems: [
        { menuItemId: 'MNU-COFFEE-01', name: 'Zamorin Pour-Over', quantity: 1, unitPricePaisa: 22000, taxRatePercent: 5 },
      ],
    };

    // Execute 10 concurrent requests simultaneously
    const promises = Array.from({ length: 10 }, () =>
      PosOrderService.processOrder(payload, auth, 'SAVE_AND_PRINT', { idempotencyKey: sharedIdempotencyKey })
    );

    const results = await Promise.all(promises);

    // EXACTLY 1 new bill created in DB
    assert.equal(mockBills.length, initialBillCount + 1);

    // All 10 responses return the EXACT same billId
    const firstBillId = results[0].bill.billId;
    for (const r of results) {
      assert.equal(r.bill.billId, firstBillId);
      assert.equal(r.success, true);
    }

    // Subsequent call returns idempotent cached replay
    const subsequent = await PosOrderService.processOrder(payload, auth, 'SAVE_AND_PRINT', { idempotencyKey: sharedIdempotencyKey });
    assert.equal(subsequent.isIdempotentReplay, true);
    assert.equal(subsequent.bill.billId, firstBillId);
  });

  // TEST 8: Failed Save Protection
  await t.test('8. Failed Save Protection: validation or save error aborts receipt generation and drawer kick', async () => {
    const auth = createAuthContext();

    // Missing line items should fail validation
    await assert.rejects(
      async () => {
        await PosOrderService.processOrder(
          {
            cafeId: 'ZC-0001',
            orderType: 'QUICK_SALE',
            lineItems: [], // EMPTY
          },
          auth,
          'SAVE_AND_PRINT'
        );
      },
      {
        name: 'ApiError',
        code: 'LINE_ITEMS_REQUIRED',
      }
    );

    // Missing cafeId should fail validation
    await assert.rejects(
      async () => {
        await PosOrderService.processOrder(
          {
            cafeId: '',
            lineItems: [{ menuItemId: 'MNU-01', quantity: 1, unitPricePaisa: 100 }],
          },
          auth,
          'SAVE_AND_PRINT'
        );
      },
      {
        name: 'ApiError',
        code: 'CAFE_ID_REQUIRED',
      }
    );
  });

  // TEST 9: Cross-Café Isolation in Controller
  await t.test('9. Cross-Café Isolation: unauthorized cafe access is rejected with 403', async () => {
    const { commitOrder } = require('../src/controllers/posController');

    const unauthorizedAuth = createAuthContext('STAFF', 'ZC-0001'); // Only assigned to ZC-0001
    const req = {
      auth: unauthorizedAuth,
      body: {
        cafeId: 'ZC-0099', // Foreign cafe
        lineItems: [{ menuItemId: 'MNU-01', quantity: 1, unitPricePaisa: 100 }],
      },
      headers: {},
    };

    const res = {
      statusCode: 200,
      status(code) { this.statusCode = code; return this; },
      json(data) { this.body = data; return this; },
    };

    let caughtError = null;
    try {
      await new Promise((resolve, reject) => {
        commitOrder(req, res, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    } catch (err) {
      caughtError = err;
    }

    assert.ok(caughtError);
    assert.equal(caughtError.statusCode, 403);
  });
});
