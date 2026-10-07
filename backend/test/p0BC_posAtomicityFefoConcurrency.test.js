'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryReplSet } = require('mongodb-memory-server');

const { PosOrderService } = require('../src/services/posOrderService');
const { FefoService } = require('../src/services/fefoService');
const { Bill } = require('../src/models/Bill');
const { InventoryLot } = require('../src/models/InventoryLot');
const { StockMovement } = require('../src/models/StockMovement');
const { CashTransaction } = require('../src/models/CashTransaction');
const { RegisterSession } = require('../src/models/RegisterSession');
const { Cafe } = require('../src/models/Cafe');
const { SequenceCounter } = require('../src/models/SequenceCounter');

let replSet;
const ORG_ID = 'ORG-P0BC';
const CAFE_ID = 'ZC-0001';

test.before(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(replSet.getUri());

  await Bill.createCollection();
  await CashTransaction.createCollection();
  await SequenceCounter.createCollection();
  await RegisterSession.createCollection();
  await InventoryLot.createCollection();
  await StockMovement.createCollection();

  await Cafe.create({
    organisationId: ORG_ID,
    cafeId: CAFE_ID,
    name: 'P0BC Test Cafe',
    displayName: 'P0BC Test Cafe',
    createdBy: 'ADMIN-01',
    status: 'ACTIVE',
    businessDayCutoffHour: 4,
  });
});

test.after(async () => {
  await mongoose.disconnect();
  if (replSet) {
    await replSet.stop();
  }
});

test('P0-B & P0-C: POS Settlement Atomicity & FEFO Concurrency Safety', async (t) => {
  const authContext = {
    userId: 'CASHIER-P0BC',
    organisationId: ORG_ID,
    role: 'CASHIER',
  };

  await t.test('1. Normal POS settlement completes and creates Bill, CashTransaction, and RegisterSession entry', async () => {
    const regSessionId = 'REG-SESS-001';
    await RegisterSession.create({
      organisationId: ORG_ID,
      cafeId: CAFE_ID,
      registerSessionId: regSessionId,
      registerId: 'REG-01',
      businessDate: '2026-10-05',
      cashierUserId: 'CASHIER-P0BC',
      status: 'OPEN',
      openedAt: new Date(),
    });

    const idempotencyKey = 'IDEM-P0B-001';
    const orderPayload = {
      cafeId: CAFE_ID,
      orderType: 'QUICK_SALE',
      paymentMethod: 'CASH',
      registerSessionId: regSessionId,
      idempotencyKey,
      lineItems: [
        {
          menuItemId: 'ITEM-COFFEE-01',
          name: 'Filter Coffee',
          quantity: 2,
          unitPricePaisa: 5000,
        },
      ],
    };

    const result = await PosOrderService.processOrder(orderPayload, authContext, 'SAVE');
    assert.equal(result.success, true);
    assert.equal(result.bill.paymentStatus, 'PAID');
    assert.equal(result.bill.totalPaisa, 10500); // 10000 + 5% GST = 10500

    const savedBill = await Bill.findOne({ billId: result.bill.billId });
    assert.ok(savedBill);
    assert.equal(savedBill.billId, result.bill.billId);

    const cashTx = await CashTransaction.findOne({ referenceId: result.bill.billId });
    assert.ok(cashTx);
    assert.equal(cashTx.amount, 105);

    const reg = await RegisterSession.findOne({ registerSessionId: regSessionId });
    assert.equal(reg.orderCount, 1);
    assert.equal(reg.totalSalesPaisa, 10500);
  });

  await t.test('2. POS Idempotency: Retrying with identical key returns cached/committed bill without duplicates', async () => {
    const idempotencyKey = 'IDEM-P0B-RETRY';
    const orderPayload = {
      cafeId: CAFE_ID,
      orderType: 'QUICK_SALE',
      paymentMethod: 'CASH',
      idempotencyKey,
      lineItems: [
        {
          menuItemId: 'ITEM-TEA-01',
          name: 'Masala Tea',
          quantity: 1,
          unitPricePaisa: 3000,
        },
      ],
    };

    const first = await PosOrderService.processOrder(orderPayload, authContext, 'SAVE');
    assert.equal(first.success, true);

    const second = await PosOrderService.processOrder(orderPayload, authContext, 'SAVE');
    assert.equal(second.success, true);
    assert.equal(second.isIdempotentReplay, true);
    assert.equal(second.bill.billId, first.bill.billId);

    const count = await Bill.countDocuments({ correlationId: idempotencyKey });
    assert.equal(count, 1, 'Exactly one bill must exist for this idempotency key');
  });

  await t.test('3. POS Transaction Rollback: Midway crash rolls back all transactional writes', async () => {
    const idempotencyKey = 'IDEM-P0B-CRASH';
    const orderPayload = {
      cafeId: CAFE_ID,
      orderType: 'QUICK_SALE',
      paymentMethod: 'CASH',
      idempotencyKey,
      lineItems: [
        {
          menuItemId: 'ITEM-BURGER-01',
          name: 'Veg Burger',
          quantity: 1,
          unitPricePaisa: 12000,
        },
      ],
    };

    await assert.rejects(
      async () => {
        await PosOrderService.processOrder(orderPayload, authContext, 'SAVE', {
          simulateCrashMidway: true,
        });
      },
      /Simulated crash midway through POS settlement transaction/
    );

    // Bill must not exist
    const bill = await Bill.findOne({ correlationId: idempotencyKey });
    assert.equal(bill, null, 'Bill write must be rolled back on crash');
  });

  await t.test('4. FEFO Concurrency: Simultaneous sales on limited lot stock cannot produce negative inventory', async () => {
    const testItemId = 'ING-MILK-P0C';
    await InventoryLot.deleteMany({ itemId: testItemId });

    // Seed single lot with 5 units
    await InventoryLot.create({
      organisationId: ORG_ID,
      cafeId: CAFE_ID,
      lotId: 'LOT-MILK-001',
      itemId: testItemId,
      initialQuantity: 5,
      quantityBase: 5,
      remainingQuantity: 5,
      expiryDate: '2027-12-31',
      status: 'AVAILABLE',
    });

    // Run two simultaneous attempts requesting 4 units each (total needed: 8 > 5 available)
    const results = await Promise.allSettled([
      FefoService.executeFefoDeduction({
        organisationId: ORG_ID,
        cafeId: CAFE_ID,
        itemId: testItemId,
        requiredQuantity: 4,
        billId: 'BILL-RACE-01',
      }),
      FefoService.executeFefoDeduction({
        organisationId: ORG_ID,
        cafeId: CAFE_ID,
        itemId: testItemId,
        requiredQuantity: 4,
        billId: 'BILL-RACE-02',
      }),
    ]);

    const successes = results.filter((r) => r.status === 'fulfilled');
    const failures = results.filter((r) => r.status === 'rejected');

    // Exactly one should succeed (took 4), and one should fail (only 1 was left for the second)
    assert.equal(successes.length, 1, 'Only one 4-unit request could be satisfied from 5 units');
    assert.equal(failures.length, 1, 'The other request must fail with insufficient stock');

    const lotAfter = await InventoryLot.findOne({ lotId: 'LOT-MILK-001' });
    assert.ok(lotAfter.quantityBase >= 0, 'Lot quantityBase must never be negative');
    assert.equal(lotAfter.quantityBase, 1, 'Remaining quantity must be exactly 1 (5 - 4)');
  });

  await t.test('5. FEFO Multi-Lot Expiry Ordering: Depletes earlier expiry lot first, then cascades to next', async () => {
    const testItemId = 'ING-COFFEE-BEANS';
    await InventoryLot.deleteMany({ itemId: testItemId });

    // Lot A expires sooner (2027-01-10, qty 3)
    await InventoryLot.create({
      organisationId: ORG_ID,
      cafeId: CAFE_ID,
      lotId: 'LOT-BEANS-EARLY',
      itemId: testItemId,
      initialQuantity: 3,
      quantityBase: 3,
      remainingQuantity: 3,
      expiryDate: '2027-01-10',
      status: 'AVAILABLE',
    });

    // Lot B expires later (2027-06-15, qty 5)
    await InventoryLot.create({
      organisationId: ORG_ID,
      cafeId: CAFE_ID,
      lotId: 'LOT-BEANS-LATER',
      itemId: testItemId,
      initialQuantity: 5,
      quantityBase: 5,
      remainingQuantity: 5,
      expiryDate: '2027-06-15',
      status: 'AVAILABLE',
    });

    // Request 5 units (3 from Early + 2 from Later)
    const ded = await FefoService.executeFefoDeduction({
      organisationId: ORG_ID,
      cafeId: CAFE_ID,
      itemId: testItemId,
      requiredQuantity: 5,
      billId: 'BILL-MULTI-LOT-01',
    });

    assert.equal(ded.success, true);
    assert.equal(ded.totalDeducted, 5);
    assert.equal(ded.deductions.length, 2);

    // Early lot should be completely depleted
    const lotEarly = await InventoryLot.findOne({ lotId: 'LOT-BEANS-EARLY' });
    assert.equal(lotEarly.quantityBase, 0);
    assert.equal(lotEarly.status, 'DEPLETED');

    // Later lot should have 3 remaining (5 - 2)
    const lotLater = await InventoryLot.findOne({ lotId: 'LOT-BEANS-LATER' });
    assert.equal(lotLater.quantityBase, 3);
    assert.equal(lotLater.status, 'AVAILABLE');

    // Verify StockMovements created for both
    const movements = await StockMovement.find({ referenceId: 'BILL-MULTI-LOT-01' });
    assert.equal(movements.length, 2);
  });
});
