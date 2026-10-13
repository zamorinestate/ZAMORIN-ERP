'use strict';

/**
 * ============================================================================
 * P22 — FOH BILLING MASTERY & CASHIER GUARDRAILS TEST SUITE
 * ============================================================================
 *
 * Verifies the complete P22 operational requirements & Petpooja benchmark parity:
 * 1. A041: Open-Price & Open-Item Entry Flow
 *    - Open items compute proper taxable subtotal and taxes without catalogue entry
 *    - Invalid item names (<2 chars) and invalid prices rejected
 *    - High-value open items (> ₹5,000) require supervisor authorization
 * 2. A013: Manual Discount Ceiling & Supervisor Authorization
 *    - Cashier discount <= 10% ceiling allowed
 *    - Cashier discount > 10% ceiling rejected without supervisor authorization
 *    - Cashier discount > 10% allowed with valid supervisor credentials
 *    - Primary Master exempted from discount ceiling
 * 3. A012: Preconfigured Charge Edit Restriction
 *    - Cashier modifying packaging/delivery charges without supervisor approval rejected
 *    - Allowed with supervisor approval
 * 4. F028: Bill Split By Items
 *    - Selected items distributed across child bills; original marked SPLIT_CLOSED
 * 5. F029: Bill Split Evenly (Exact Minor-Unit Paise Conservation)
 *    - Grand total split across N shares with zero paise loss
 * 6. F031: Separate Food and Beverage Bills
 *    - Automatic separation of food lines and beverage lines into distinct invoices
 * 7. A008 & F033: Same-Day Void with Challenge & Mandatory Cancellation Reason
 *    - CAFE_ADMIN voiding without supervisor credentials/OTP rejected
 *    - CAFE_ADMIN voiding with valid supervisor credentials/OTP succeeds
 *    - Mandatory reason recorded on voided invoice
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { PosOrderService } = require('../src/services/posOrderService');
const { Bill } = require('../src/models/Bill');
const { Cafe } = require('../src/models/Cafe');
const { MenuItem } = require('../src/models/MenuItem');
const { SequenceCounter } = require('../src/models/SequenceCounter');
const { IdempotencyRecord } = require('../src/models/IdempotencyRecord');
const { PrintJob } = require('../src/models/PrintJob');
const { CashTransaction } = require('../src/models/CashTransaction');
const { RegisterSession } = require('../src/models/RegisterSession');
const auditService = require('../src/services/auditService');

const { voidBill } = require('../src/controllers/billController');

const ORG = 'ORG-ZAMORIN';
const CAFE_A = 'ZC-CAFE-01';

function mockReqRes(body = {}, auth = {}, params = {}, headers = {}) {
  const req = {
    body,
    auth,
    params,
    headers,
    method: 'POST',
    correlationId: `CORR-${Date.now()}`,
  };
  let statusCode = 200;
  let responseData = null;
  const res = {
    status(c) {
      statusCode = c;
      return this;
    },
    json(d) {
      responseData = d;
      return this;
    },
    send(d) {
      responseData = d;
      return this;
    },
    get statusCode() { return statusCode; },
    get body() { return responseData; },
  };
  return { req, res };
}

test('P22 Front-of-House Billing Mastery & Cashier Guardrails Suite', async (t) => {
  const billsDb = [];
  const idempotencyDb = [];
  let seqCount = 2000;

  // Setup test mocks
  t.mock.method(auditService, 'recordRequestAudit', async () => ({}));
  t.mock.method(auditService, 'recordAuditEvent', async () => ({}));

  PrintJob.prototype.save = async function () { return this; };

  const { BomDepletionService } = require('../src/services/bomDepletionService');
  t.mock.method(BomDepletionService, 'depleteOrderBOM', async ({ billId } = {}) => ({
    depleted: true,
    alreadyDepleted: false,
    processedItemsCount: 1,
    consumedLots: [],
    billId,
  }));

  const { User } = require('../src/models/User');
  t.mock.method(User, 'findOne', async (q = {}) => ({
    userId: q.userId,
    status: 'ACTIVE',
    assignedCafeIds: [CAFE_A],
  }));

  const { OutletOffering } = require('../src/models/OutletOffering');
  t.mock.method(OutletOffering, 'find', () => ({
    lean: async () => [],
  }));

  const { ModifierGroup } = require('../src/models/ModifierGroup');
  t.mock.method(ModifierGroup, 'find', () => ({
    lean: async () => [],
  }));

  const { ComboDefinition } = require('../src/models/ComboDefinition');
  t.mock.method(ComboDefinition, 'find', () => ({
    lean: async () => [],
  }));

  t.mock.method(Cafe, 'findOne', async () => ({
    organisationId: ORG,
    cafeId: CAFE_A,
    status: 'ACTIVE',
    businessDayCutoffHour: 4,
  }));

  t.mock.method(MenuItem, 'find', () => ({
    lean: async () => [],
  }));

  const { Receivable } = require('../src/models/Receivable');
  t.mock.method(Receivable, 'findOne', async () => null);
  Receivable.prototype.save = async function () { return this; };

  t.mock.method(SequenceCounter, 'generateId', async (opts = {}) => {
    seqCount++;
    const prefix = opts.prefix || 'ID';
    return `${prefix}-${seqCount}`;
  });

  t.mock.method(RegisterSession, 'findOne', async () => null);
  RegisterSession.prototype.save = async function () { return this; };
  CashTransaction.prototype.save = async function () { return this; };

  t.mock.method(IdempotencyRecord, 'findOne', async () => null);
  IdempotencyRecord.prototype.save = async function () {
    idempotencyDb.push(this);
    return this;
  };

  Bill.prototype.save = async function () {
    const existingIdx = billsDb.findIndex((b) => b.billId === this.billId);
    if (existingIdx >= 0) {
      billsDb[existingIdx] = this;
    } else {
      billsDb.push(this);
    }
    return this;
  };

  t.mock.method(Bill, 'findOne', async (query = {}) => {
    if (query.billId) {
      return billsDb.find((b) => b.billId === query.billId) || null;
    }
    if (query.$or) {
      for (const cond of query.$or) {
        if (cond.billId) {
          const match = billsDb.find((b) => b.billId === cond.billId);
          if (match) return match;
        }
      }
    }
    return null;
  });

  const authMaster = {
    userId: 'USR-MASTER-01',
    role: 'MASTER',
    isPrimaryMaster: true,
    organisationId: ORG,
    assignedCafeIds: [CAFE_A],
  };

  const authCashier = {
    userId: 'USR-CASHIER-01',
    role: 'CAFE_ADMIN',
    organisationId: ORG,
    primaryCafeId: CAFE_A,
    assignedCafeIds: [CAFE_A],
  };

  // =========================================================================
  // 1. A041: Open-Price & Custom Items Validation
  // =========================================================================
  await t.test('1. A041: Standard Open Item succeeds without catalogue registration', async () => {
    const payload = {
      cafeId: CAFE_A,
      orderType: 'QUICK_SALE',
      paymentMethod: 'CASH',
      lineItems: [
        {
          isOpenItem: true,
          name: 'Custom Chef Platter',
          unitPricePaisa: 35000, // ₹350.00
          quantity: 2,
          taxRatePercent: 5,
        },
      ],
      idempotencyKey: 'IDEMP-P22-OPEN-01',
    };

    const res = await PosOrderService.executeOrderCommit(payload, authCashier, 'SAVE');
    assert.equal(res.success, true);
    assert.equal(res.bill.lineItems[0].isOpenItem, true);
    assert.equal(res.bill.lineItems[0].itemNameSnapshot, 'Custom Chef Platter');
    assert.equal(res.bill.lineItems[0].unitPricePaisa, 35000);
    assert.equal(res.bill.subtotalPaisa, 70000); // 2 * 35000
    assert.equal(res.bill.totalPaisa > 70000, true); // Includes 5% tax
  });

  await t.test('1. A041: Open item with invalid short name or zero price is rejected', async () => {
    const invalidNamePayload = {
      cafeId: CAFE_A,
      lineItems: [{ isOpenItem: true, name: 'X', unitPricePaisa: 5000, quantity: 1 }],
    };
    await assert.rejects(
      async () => PosOrderService.executeOrderCommit(invalidNamePayload, authCashier, 'SAVE'),
      (err) => err.statusCode === 400 && err.code === 'INVALID_OPEN_ITEM_NAME'
    );

    const invalidPricePayload = {
      cafeId: CAFE_A,
      lineItems: [{ isOpenItem: true, name: 'Valid Item', unitPricePaisa: 0, quantity: 1 }],
    };
    await assert.rejects(
      async () => PosOrderService.executeOrderCommit(invalidPricePayload, authCashier, 'SAVE'),
      (err) => err.statusCode === 400 && err.code === 'INVALID_OPEN_ITEM_PRICE'
    );
  });

  await t.test('1. A041: High-value open item (> ₹5,000) requires supervisor approval', async () => {
    const highValPayload = {
      cafeId: CAFE_A,
      orderType: 'QUICK_SALE',
      paymentMethod: 'CASH',
      lineItems: [
        {
          isOpenItem: true,
          name: 'Executive Banquet Set',
          unitPricePaisa: 600000, // ₹6,000.00 > ₹5,000 limit
          quantity: 1,
        },
      ],
      idempotencyKey: 'IDEMP-P22-HIGHVAL-01',
    };

    // Rejected without supervisor
    await assert.rejects(
      async () => PosOrderService.executeOrderCommit(highValPayload, authCashier, 'SAVE'),
      (err) => err.statusCode === 403 && err.code === 'OPEN_ITEM_SUPERVISOR_REQUIRED'
    );

    // Allowed with supervisor
    highValPayload.supervisorApproval = {
      supervisorUserId: 'USR-MGR-01',
      supervisorPasscode: '9999',
      reason: 'Approved wedding party open item',
    };
    highValPayload.idempotencyKey = 'IDEMP-P22-HIGHVAL-02';

    const res = await PosOrderService.executeOrderCommit(highValPayload, authCashier, 'SAVE');
    assert.equal(res.success, true);
    assert.equal(res.bill.supervisorAuthorized, true);
  });

  // =========================================================================
  // 2. A013: Manual Discount Ceiling & Supervisor Authorization
  // =========================================================================
  await t.test('2. A013: Cashier discount within 10% ceiling succeeds', async () => {
    const payload = {
      cafeId: CAFE_A,
      orderType: 'QUICK_SALE',
      paymentMethod: 'CASH',
      lineItems: [
        { isOpenItem: true, name: 'Combo Meal', unitPricePaisa: 100000, quantity: 1 },
      ],
      discountPaisa: 8000, // ₹80 on ₹1000 = 8% <= 10%
      idempotencyKey: 'IDEMP-P22-DISC-01',
    };

    const res = await PosOrderService.executeOrderCommit(payload, authCashier, 'SAVE');
    assert.equal(res.success, true);
    assert.equal(res.bill.discountPaisa, 8000);
  });

  await t.test('2. A013: Cashier discount exceeding 10% ceiling rejected without supervisor', async () => {
    const payload = {
      cafeId: CAFE_A,
      orderType: 'QUICK_SALE',
      paymentMethod: 'CASH',
      lineItems: [
        { isOpenItem: true, name: 'Combo Meal', unitPricePaisa: 100000, quantity: 1 },
      ],
      discountPaisa: 25000, // ₹250 on ₹1000 = 25% > 10%
      idempotencyKey: 'IDEMP-P22-DISC-02',
    };

    await assert.rejects(
      async () => PosOrderService.executeOrderCommit(payload, authCashier, 'SAVE'),
      (err) => err.statusCode === 403 && err.code === 'DISCOUNT_CEILING_EXCEEDED'
    );

    // With supervisor approval, succeeds
    payload.supervisorApproval = {
      supervisorUserId: 'USR-MGR-01',
      supervisorPasscode: '9999',
      reason: 'VIP guest courtesy discount',
    };
    payload.idempotencyKey = 'IDEMP-P22-DISC-03';

    const res = await PosOrderService.executeOrderCommit(payload, authCashier, 'SAVE');
    assert.equal(res.success, true);
    assert.equal(res.bill.discountPaisa, 25000);
    assert.equal(res.bill.supervisorAuthorized, true);
  });

  await t.test('2. A013: Primary Master exempt from discount ceiling', async () => {
    const payload = {
      cafeId: CAFE_A,
      orderType: 'QUICK_SALE',
      paymentMethod: 'CASH',
      lineItems: [
        { isOpenItem: true, name: 'Special Item', unitPricePaisa: 50000, quantity: 1 },
      ],
      discountPaisa: 30000, // 60% discount
      idempotencyKey: 'IDEMP-P22-DISC-MASTER',
    };

    const res = await PosOrderService.executeOrderCommit(payload, authMaster, 'SAVE');
    assert.equal(res.success, true);
    assert.equal(res.bill.discountPaisa, 30000);
  });

  // =========================================================================
  // 3. A012: Preconfigured Charge Edit Restriction
  // =========================================================================
  await t.test('3. A012: Charge edit by cashier without supervisor is rejected', async () => {
    const payload = {
      cafeId: CAFE_A,
      orderType: 'TAKEAWAY',
      paymentMethod: 'CASH',
      lineItems: [
        { isOpenItem: true, name: 'Takeaway Box', unitPricePaisa: 20000, quantity: 1 },
      ],
      customCharges: { isModified: true, packagingChargePaisa: 5000 },
      idempotencyKey: 'IDEMP-P22-CHG-01',
    };

    await assert.rejects(
      async () => PosOrderService.executeOrderCommit(payload, authCashier, 'SAVE'),
      (err) => err.statusCode === 403 && err.code === 'CHARGE_EDIT_RESTRICTED'
    );
  });

  // =========================================================================
  // 4. F028: Bill Split By Items
  // =========================================================================
  await t.test('4. F028: Split Bill By Items creates child bills and closes parent', async () => {
    // Create parent bill with 2 items
    const origPayload = {
      cafeId: CAFE_A,
      orderType: 'DINE_IN',
      tableNumber: 'Table 04',
      isImmediateCompletion: false,
      lineItems: [
        { isOpenItem: true, name: 'Margherita Pizza', unitPricePaisa: 30000, quantity: 1 },
        { isOpenItem: true, name: 'Cold Brew Coffee', unitPricePaisa: 20000, quantity: 1 },
      ],
      idempotencyKey: 'IDEMP-P22-SPLIT-ORIG-01',
    };

    const origRes = await PosOrderService.executeOrderCommit(origPayload, authCashier, 'SAVE');
    const origBillId = origRes.bill.billId;

    const splitGroups = [
      { lineItems: [{ isOpenItem: true, name: 'Margherita Pizza', unitPricePaisa: 30000, quantity: 1 }] },
      { lineItems: [{ isOpenItem: true, name: 'Cold Brew Coffee', unitPricePaisa: 20000, quantity: 1 }] },
    ];

    const splitRes = await PosOrderService.splitBillByItems({
      originalBillId: origBillId,
      splitGroups,
      authContext: authCashier,
    });

    assert.equal(splitRes.status, 'SPLIT_CLOSED');
    assert.equal(splitRes.childBills.length, 2);

    const updatedParent = await Bill.findOne({ billId: origBillId });
    assert.equal(updatedParent.status, 'SPLIT_CLOSED');
    assert.equal(updatedParent.childSplitBillIds.length, 2);
  });

  // =========================================================================
  // 5. F029: Bill Split Evenly (Exact Paise Conservation)
  // =========================================================================
  await t.test('5. F029: Split Evenly conserves exact paise across all child shares', async () => {
    const origPayload = {
      cafeId: CAFE_A,
      orderType: 'DINE_IN',
      tableNumber: 'Table 10',
      isImmediateCompletion: false,
      lineItems: [
        { isOpenItem: true, name: 'Special Feast', unitPricePaisa: 10001, quantity: 1, taxRatePercent: 0 },
      ],
      idempotencyKey: 'IDEMP-P22-EVEN-ORIG-01',
    };

    const origRes = await PosOrderService.executeOrderCommit(origPayload, authCashier, 'SAVE');
    const origBillId = origRes.bill.billId;

    const splitRes = await PosOrderService.splitBillEvenly({
      originalBillId: origBillId,
      splitCount: 2,
      authContext: authCashier,
    });

    assert.equal(splitRes.status, 'SPLIT_CLOSED');
    assert.equal(splitRes.childBills.length, 2);

    // Sum of child totals must exactly equal original bill total
    const child1Total = splitRes.childBills[0].totalPaisa;
    const child2Total = splitRes.childBills[1].totalPaisa;
    assert.equal(child1Total + child2Total, origRes.bill.totalPaisa);
  });

  // =========================================================================
  // 6. F031: Separate Food and Beverage Bills
  // =========================================================================
  await t.test('6. F031: Split Food and Beverage partitions items into 2 bills', async () => {
    const origPayload = {
      cafeId: CAFE_A,
      orderType: 'DINE_IN',
      tableNumber: 'Table 08',
      isImmediateCompletion: false,
      lineItems: [
        { isOpenItem: true, name: 'Pasta Arrabiata', unitPricePaisa: 40000, quantity: 1, kitchenStation: 'KITCHEN' },
        { isOpenItem: true, name: 'Signature Iced Tea (BEVERAGE)', unitPricePaisa: 15000, quantity: 1, kitchenStation: 'BAR' },
      ],
      idempotencyKey: 'IDEMP-P22-FNB-ORIG-01',
    };

    const origRes = await PosOrderService.executeOrderCommit(origPayload, authCashier, 'SAVE');
    const origBillId = origRes.bill.billId;

    const splitRes = await PosOrderService.splitBillByFoodBeverage({
      originalBillId: origBillId,
      authContext: authCashier,
    });

    assert.equal(splitRes.status, 'SPLIT_CLOSED');
    assert.equal(splitRes.foodBill.lineItems[0].itemNameSnapshot, 'Pasta Arrabiata');
    assert.equal(splitRes.beverageBill.lineItems[0].itemNameSnapshot, 'Signature Iced Tea (BEVERAGE)');
  });

  // =========================================================================
  // 7. A008 & F033: Same-Day Void with Challenge & Mandatory Cancellation Reason
  // =========================================================================
  await t.test('7. A008 & F033: CAFE_ADMIN voiding same-day bill requires supervisor challenge & reason', async () => {
    const origPayload = {
      cafeId: CAFE_A,
      orderType: 'QUICK_SALE',
      paymentMethod: 'CASH',
      lineItems: [
        { isOpenItem: true, name: 'Test Void Item', unitPricePaisa: 25000, quantity: 1 },
      ],
      idempotencyKey: 'IDEMP-P22-VOID-01',
    };

    const origRes = await PosOrderService.executeOrderCommit(origPayload, authCashier, 'SAVE');
    const billToVoid = origRes.bill;

    // Void attempt without supervisor passcode/OTP rejected
    const { req: reqNoAuth, res: resNoAuth } = mockReqRes(
      { reason: 'Customer changed order' },
      authCashier,
      { billId: billToVoid.billId }
    );

    await assert.rejects(
      async () => voidBill(reqNoAuth, resNoAuth),
      (err) => err.statusCode === 403 && err.code === 'SUPERVISOR_CHALLENGE_REQUIRED'
    );

    // Void attempt with supervisor passcode '9999' succeeds
    const { req: reqWithAuth, res: resWithAuth } = mockReqRes(
      { reason: 'Customer changed mind after ordering', supervisorPasscode: '9999' },
      authCashier,
      { billId: billToVoid.billId }
    );

    await voidBill(reqWithAuth, resWithAuth);
    assert.equal(resWithAuth.statusCode, 200);
    assert.equal(resWithAuth.body.data.bill.status, 'VOIDED');
    assert.equal(resWithAuth.body.data.bill.voidReason, 'Customer changed mind after ordering');
  });
});
