'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { Bill } = require('../src/models/Bill');
const { RegisterSession } = require('../src/models/RegisterSession');
const { MenuItem } = require('../src/models/MenuItem');
const { Cafe } = require('../src/models/Cafe');
const { CashTransaction } = require('../src/models/CashTransaction');
const { SequenceCounter } = require('../src/models/SequenceCounter');
const { AuditEvent } = require('../src/models/AuditEvent');
const auditService = require('../src/services/auditService');

const {
  createBill,
  getPastOrdersSummary,
  getSalesCalendar,
  holdBill,
  listOpenTickets,
  openRegisterSession,
  recordCashEvent,
  closeRegisterSession,
  getRegisterSession,
  splitBill,
  refundBill,
  reprintBill,
} = require('../src/controllers/billController');

// Mock helpers
function createMockAuthContext(role = 'MASTER', cafeId = 'ZC-0001', isPrimaryMaster = true) {
  return {
    userId: 'USR-TEST-001',
    name: 'Master Cashier',
    email: 'master@zamorin.local',
    role,
    isPrimaryMaster,
    organisationId: 'ORG-ZAMORIN',
    assignedCafeIds: [cafeId],
  };
}

function invokeHandler(handler, req) {
  return new Promise((resolve, reject) => {
    const res = {
      statusCode: 200,
      body: null,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(data) {
        this.body = data;
        resolve(this);
        return this;
      },
      send(data) {
        this.body = data;
        resolve(this);
        return this;
      },
    };
    const next = (err) => {
      if (err) reject(err);
      else resolve(res);
    };
    try {
      handler(req, res, next);
    } catch (err) {
      reject(err);
    }
  });
}

test('SCR-019: POS & Billing Terminal Master Control Test Suite', async (t) => {
  // Mock audit service & AuditEvent & CashTransaction
  AuditEvent.prototype.save = async function () { return this; };
  t.mock.method(AuditEvent, 'create', async (data) => ({ ...data, save: async function () { return this; } }));
  CashTransaction.prototype.save = async function () { return this; };
  t.mock.method(CashTransaction, 'create', async (data) => ({ ...data, save: async function () { return this; } }));
  t.mock.method(auditService, 'recordRequestAudit', async () => ({}));
  t.mock.method(auditService, 'recordAuditEvent', async () => ({}));

  // Mock SequenceCounter
  let seqCount = 1000;
  t.mock.method(SequenceCounter, 'generateId', async ({ prefix }) => `${prefix}-${seqCount++}`);
  t.mock.method(SequenceCounter, 'getNextNumber', async () => 1);

  // In-memory data store
  const mockBills = [];
  const mockSessions = [];

  // Mock MenuItem find
  t.mock.method(MenuItem, 'find', () => ({
    lean: async () => [
      {
        menuItemId: 'MNU-01',
        name: 'Zamorin Pour-Over',
        conceptEligibility: 'CAFE',
        category: 'COFFEE',
        organisationId: 'ORG-ZAMORIN',
        currentPricePaisa: 24000,
        taxRatePercent: 5,
      },
      {
        menuItemId: 'MNU-05',
        name: 'Butter Croissant',
        conceptEligibility: 'CAFE',
        category: 'BAKERY',
        organisationId: 'ORG-ZAMORIN',
        currentPricePaisa: 18000,
        taxRatePercent: 5,
      },
    ],
  }));

  // Mock Cafe find
  t.mock.method(Cafe, 'find', () => ({
    lean: async () => [
      {
        cafeId: 'ZC-0001',
        name: 'Koramangala Flagship',
        organisationId: 'ORG-ZAMORIN',
        gstin: '29AABCT1332L1ZV',
      },
    ],
  }));

  // Mock Bill save, toObject and find
  Bill.prototype.save = async function () {
    const idx = mockBills.findIndex((b) => b.billId === this.billId);
    if (idx >= 0) {
      mockBills[idx] = this;
    } else {
      mockBills.push(this);
    }
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
      guestCovers: this.guestCovers,
      lineItems: this.lineItems,
      subtotalPaisa: this.subtotalPaisa,
      taxPaisa: this.taxPaisa,
      discountPaisa: this.discountPaisa,
      totalPaisa: this.totalPaisa,
      paymentMethod: this.paymentMethod,
      tenders: this.tenders || [],
      paymentStatus: this.paymentStatus,
      status: this.status,
      reprints: this.reprints || [],
      refunds: this.refunds || [],
      refundedTotalPaisa: this.refundedTotalPaisa || 0,
      businessDate: this.businessDate,
      correlationId: this.correlationId || null,
    };
  };

  t.mock.method(Bill, 'find', (filter) => ({
    sort: () => ({
      lean: async () => {
        if (filter?.status === 'OPEN') return mockBills.filter((b) => b.status === 'OPEN');
        return mockBills;
      },
    }),
    lean: async () => {
      if (filter?.status?.$in) {
        return mockBills.filter((b) => filter.status.$in.includes(b.status));
      }
      if (filter?.status === 'OPEN') {
        return mockBills.filter((b) => b.status === 'OPEN');
      }
      return mockBills;
    },
  }));

  t.mock.method(Bill, 'findOne', (query) => {
    const found = mockBills.find((b) => {
      if (query.billId && b.billId !== query.billId) return false;
      if (query.correlationId && b.correlationId !== query.correlationId) return false;
      if (query.$or) {
        const matches = query.$or.some((cond) => {
          if (cond.billId && b.billId === cond.billId) return true;
          if (cond.invoiceNumber && b.invoiceNumber === cond.invoiceNumber) return true;
          return false;
        });
        if (!matches) return false;
      }
      return true;
    }) || null;

    if (!found) {
      return {
        lean: async () => null,
      };
    }
    found.save = async function () { return this; };
    found.lean = async () => found;
    return found;
  });

  // Mock RegisterSession save and find
  RegisterSession.prototype.save = async function () {
    const idx = mockSessions.findIndex((s) => s.registerSessionId === this.registerSessionId);
    if (idx >= 0) {
      mockSessions[idx] = this;
    } else {
      mockSessions.push(this);
    }
    return this;
  };

  t.mock.method(RegisterSession, 'findOne', async (query) => {
    return mockSessions.find((s) => {
      if (query.registerSessionId && s.registerSessionId !== query.registerSessionId) return false;
      if (query.status && s.status !== query.status) return false;
      return true;
    }) || null;
  });

  await t.test('1. Create Quick Sale order with modifier snapshot and server-calculated totals', async () => {
    const req = {
      auth: createMockAuthContext('CAFE_ADMIN', 'ZC-0001'),
      body: {
        cafeId: 'ZC-0001',
        serviceMode: 'QUICK_SALE',
        lineItems: [
          {
            menuItemId: 'MNU-01',
            quantity: 2,
            modifiers: {
              size: 'Large',
              milk: 'Oat Milk',
              temperature: 'Iced',
              addOns: ['Extra Espresso Shot'],
              modifierPricePaisa: 15500, // 15500 modifier price
            },
            itemNotes: 'Extra chilled',
          },
        ],
        paymentMethod: 'UPI',
        isImmediateCompletion: true,
      },
    };

    const res = await invokeHandler(createBill, req);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.success, true);
    const bill = res.body.data.bill || res.body.data;
    assert.equal(bill.serviceMode, 'QUICK_SALE');
    assert.equal(bill.status, 'COMPLETED');
    assert.equal(bill.paymentStatus, 'PAID');
    // Unit price = 24000 + 15500 = 39500. Subtotal for 2 = 79000. Tax (5%) = 3950. Total = 82950.
    assert.equal(bill.subtotalPaisa, 79000);
    assert.equal(bill.taxPaisa, 3950);
    assert.equal(bill.totalPaisa, 82950);
  });

  await t.test('2. Hold and resume open ticket workflow', async () => {
    // Create open bill
    const createReq = {
      auth: createMockAuthContext('CAFE_ADMIN', 'ZC-0001'),
      body: {
        cafeId: 'ZC-0001',
        serviceMode: 'DINE_IN',
        tableNumber: 'Table 04 (Indoor)',
        guestCovers: 3,
        lineItems: [
          {
            menuItemId: 'MNU-05',
            quantity: 3,
          },
        ],
        isImmediateCompletion: false,
      },
    };
    const createRes = await invokeHandler(createBill, createReq);
    const openBill = createRes.body?.data?.bill || createRes.body?.data;
    assert.ok(openBill, 'openBill should be present in response');
    const openBillId = openBill.billId;

    // Hold ticket
    const holdReq = {
      auth: createMockAuthContext('CAFE_ADMIN', 'ZC-0001'),
      body: {
        billId: openBillId,
        holdName: 'Table 04 (Hold)',
      },
    };
    const holdRes = await invokeHandler(holdBill, holdReq);

    assert.equal(holdRes.statusCode, 200);
    assert.equal(holdRes.body.data.isHeld, true);

    // List open tickets
    const listReq = {
      auth: createMockAuthContext('CAFE_ADMIN', 'ZC-0001'),
      query: {},
    };
    const listRes = await invokeHandler(listOpenTickets, listReq);

    assert.equal(listRes.statusCode, 200);
    assert.ok(listRes.body.data.count >= 1);
  });

  await t.test('3. Open register, record cash events, and perform blind cash count with variance', async () => {
    // Open session
    const openReq = {
      auth: createMockAuthContext('CAFE_ADMIN', 'ZC-0001'),
      body: {
        cafeId: 'ZC-0001',
        registerId: 'REG-01',
        openingFloatPaisa: 200000, // ₹2,000 float
      },
    };
    const openRes = await invokeHandler(openRegisterSession, openReq);

    assert.equal(openRes.statusCode, 201);
    const session = openRes.body.data;
    assert.equal(session.openingFloatPaisa, 200000);
    assert.equal(session.status, 'OPEN');

    // Record Cash In event
    const eventReq = {
      auth: createMockAuthContext('CAFE_ADMIN', 'ZC-0001'),
      body: {
        registerSessionId: session.registerSessionId,
        eventType: 'CASH_IN',
        amountPaisa: 50000, // ₹500
        reason: 'Change replenishment',
      },
    };
    const eventRes = await invokeHandler(recordCashEvent, eventReq);

    assert.equal(eventRes.statusCode, 200);
    assert.equal(eventRes.body.data.expectedCashPaisa, 250000); // 2000 + 500 = 2500

    // Close session with blind count of 250000 (0 variance)
    const closeReq = {
      auth: createMockAuthContext('CAFE_ADMIN', 'ZC-0001'),
      body: {
        registerSessionId: session.registerSessionId,
        countedCashPaisa: 250000,
        closingDeclarationNote: 'Certified count matches expected.',
      },
    };
    const closeRes = await invokeHandler(closeRegisterSession, closeReq);

    assert.equal(closeRes.statusCode, 200);
    assert.equal(closeRes.body.data.status, 'CLOSED');
    assert.equal(closeRes.body.data.cashVariancePaisa, 0);
  });

  await t.test('4. Retrieve Past Orders Summary (Today, Month, Year, FY)', async () => {
    const req = {
      auth: createMockAuthContext('MASTER', 'ZC-0001'),
      query: {},
    };
    const res = await invokeHandler(getPastOrdersSummary, req);

    assert.equal(res.statusCode, 200);
    assert.ok(res.body.data.today);
    assert.ok(res.body.data.thisMonth);
    assert.ok(res.body.data.thisYear);
    assert.ok(res.body.data.currentFY);
    assert.ok(res.body.data.today.orderCount >= 1);
  });

  await t.test('5. Retrieve Sales Calendar Matrix', async () => {
    const req = {
      auth: createMockAuthContext('MASTER', 'ZC-0001'),
      query: {},
    };
    const res = await invokeHandler(getSalesCalendar, req);

    assert.equal(res.statusCode, 200);
    assert.ok(Array.isArray(res.body.data.days));
  });

  await t.test('6. Controlled Refund & Reprint Audit Lineage', async () => {
    // Find completed bill
    const completedBill = mockBills.find((b) => b.status === 'COMPLETED');
    assert.ok(completedBill, 'completedBill must be present');

    // Issue Partial Refund
    const refundReq = {
      auth: createMockAuthContext('MASTER', 'ZC-0001'),
      params: { billId: completedBill.billId },
      body: {
        refundType: 'PARTIAL',
        amountPaisa: 10000,
        reason: 'Customer complaint about beverage temperature',
      },
    };
    const refundRes = await invokeHandler(refundBill, refundReq);

    assert.equal(refundRes.statusCode, 200);
    const refundedBill = refundRes.body.data?.bill || refundRes.body.data;
    assert.equal(refundedBill.status, 'PARTIALLY_REFUNDED');
    assert.equal(refundedBill.refundedTotalPaisa, 10000);

    // Reprint receipt
    const reprintReq = {
      auth: createMockAuthContext('CAFE_ADMIN', 'ZC-0001'),
      params: { billId: completedBill.billId },
      body: {
        reason: 'Customer requested another copy',
      },
    };
    const reprintRes = await invokeHandler(reprintBill, reprintReq);

    assert.equal(reprintRes.statusCode, 200);
    assert.equal(reprintRes.body.data.reprintCount, 1);
  });

  await t.test('7. CAFE_ADMIN Single-Cafe Scope Enforcement (Anti-Tampering)', async () => {
    // CAFE_ADMIN assigned to ZC-0001 attempts to create bill with spoofed cafeId: ZC-0002
    const req = {
      auth: {
        userId: 'USR-OPERATOR-01',
        name: 'Rahul K',
        role: 'CAFE_ADMIN',
        primaryCafeId: 'ZC-0001',
        assignedCafeIds: ['ZC-0001'],
        organisationId: 'ORG-ZAMORIN',
      },
      body: {
        cafeId: 'ZC-0002', // Spoofed target
        orderType: 'QUICK_SALE',
        lineItems: [
          {
            menuItemId: 'MNU-01',
            quantity: 1,
          },
        ],
        paymentMethod: 'CASH',
        isImmediateCompletion: true,
      },
    };

    const res = await invokeHandler(createBill, req);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.data.cafeId, 'ZC-0001', 'Must force primaryCafeId ZC-0001 and ignore spoofed ZC-0002');
  });

  await t.test('8. Payment Idempotency duplicate protection', async () => {
    const testIdempotencyKey = 'IDEM-TEST-KEY-001';
    const req1 = {
      auth: createMockAuthContext('MASTER', 'ZC-0001'),
      body: {
        cafeId: 'ZC-0001',
        orderType: 'QUICK_SALE',
        idempotencyKey: testIdempotencyKey,
        lineItems: [{ menuItemId: 'MNU-01', quantity: 1 }],
        paymentMethod: 'UPI',
        isImmediateCompletion: true,
      },
    };

    const res1 = await invokeHandler(createBill, req1);
    assert.equal(res1.statusCode, 200);
    const initialBillId = res1.body.data.billId;

    // Second duplicate request with identical idempotencyKey
    const req2 = {
      auth: createMockAuthContext('MASTER', 'ZC-0001'),
      body: {
        cafeId: 'ZC-0001',
        orderType: 'QUICK_SALE',
        idempotencyKey: testIdempotencyKey,
        lineItems: [{ menuItemId: 'MNU-01', quantity: 1 }],
        paymentMethod: 'UPI',
        isImmediateCompletion: true,
      },
    };

    const res2 = await invokeHandler(createBill, req2);
    assert.equal(res2.statusCode, 200, 'Idempotent replay returns HTTP 200');
    assert.equal(res2.body.isIdempotentReplay, true);
    assert.equal(res2.body.data.billId, initialBillId, 'Must return same bill without creating duplicate');
  });

  await t.test('9. Multi-tender split payment creates SPLIT bill with full tender breakdown', async () => {
    const req = {
      auth: createMockAuthContext('MASTER', 'ZC-0001'),
      body: {
        cafeId: 'ZC-0001',
        orderType: 'DINE_IN',
        tableNumber: 'Table 04 (Indoor)',
        guestCovers: 2,
        lineItems: [{ menuItemId: 'MNU-01', quantity: 2 }],
        paymentMethod: 'SPLIT',
        tenders: [
          { paymentMethod: 'CASH', amountPaisa: 20000, provider: 'CASH_REGISTER' },
          { paymentMethod: 'UPI', amountPaisa: 30400, provider: 'BHIM_UPI' },
        ],
        isImmediateCompletion: true,
      },
    };

    const res = await invokeHandler(createBill, req);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.data.paymentMethod, 'SPLIT');
    assert.equal(res.body.data.tenders.length, 2);
    assert.equal(res.body.data.status, 'COMPLETED');
  });

  await t.test('10. Negative & Invariant: Authenticated STAFF attempt receives HTTP 403 and produces 0 bills or side-effects, while CAFE_ADMIN succeeds', async () => {
    const initialBillCount = mockBills.length;

    // Staff attempt
    const staffReq = {
      auth: createMockAuthContext('STAFF', 'ZC-0001'),
      body: {
        cafeId: 'ZC-0001',
        serviceMode: 'QUICK_SALE',
        lineItems: [{ menuItemId: 'MNU-01', quantity: 1 }],
        paymentMethod: 'CASH',
        isImmediateCompletion: true,
      },
    };

    let caughtError = null;
    let staffRes = null;
    try {
      staffRes = await invokeHandler(createBill, staffReq);
    } catch (err) {
      caughtError = err;
    }

    if (caughtError) {
      assert.equal(caughtError.statusCode, 403);
      assert.equal(caughtError.code || caughtError.errorCode, 'PERMISSION_DENIED');
    } else {
      assert.equal(staffRes.statusCode, 403);
      assert.equal(staffRes.body.error.code, 'PERMISSION_DENIED');
    }

    // Invariant: zero bills created
    assert.equal(mockBills.length, initialBillCount, 'Staff 403 attempt must produce 0 bills or side effects');

    // Equivalent valid sale by authorized CAFE_ADMIN
    const opsReq = {
      auth: createMockAuthContext('CAFE_ADMIN', 'ZC-0001'),
      body: {
        cafeId: 'ZC-0001',
        serviceMode: 'QUICK_SALE',
        lineItems: [{ menuItemId: 'MNU-01', quantity: 1 }],
        paymentMethod: 'CASH',
        isImmediateCompletion: true,
      },
    };

    const opsRes = await invokeHandler(createBill, opsReq);
    assert.equal(opsRes.statusCode, 200);
    assert.equal(opsRes.body.success, true);
    assert.equal(mockBills.length, initialBillCount + 1, 'CAFE_ADMIN sale must succeed and persist bill');
    const createdBill = opsRes.body.data.bill || opsRes.body.data;
    assert.equal(createdBill.cafeId, 'ZC-0001');
    assert.equal(createdBill.status, 'COMPLETED');
  });
});
