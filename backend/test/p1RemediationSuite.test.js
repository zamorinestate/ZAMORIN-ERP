'use strict';

/**
 * P1 REMEDIATION INDEPENDENT VERIFICATION SUITE
 * 
 * Verifies all three production-gate P1 remediations:
 * - DEF-P1-01: POS correlationId authoritative database uniqueness on Bill model + duplicate key handling
 * - DEF-P1-02: JobCoordinationService fail-closed distributed locking on Redis outages (no silent split-brain)
 * - DEF-P1-03: GRN PROCESSING idempotency reservation bounded recovery lease & authoritative state check
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryReplSet } = require('mongodb-memory-server');

const { Bill } = require('../src/models/Bill');
const { IdempotencyRecord } = require('../src/models/IdempotencyRecord');
const { RegisterSession } = require('../src/models/RegisterSession');
const { CashTransaction } = require('../src/models/CashTransaction');
const { PurchaseOrder } = require('../src/models/PurchaseOrder');
const { SequenceCounter } = require('../src/models/SequenceCounter');
const { CafeInventoryConfig } = require('../src/models/CafeInventoryConfig');
const { StockMovement } = require('../src/models/StockMovement');
const { InventoryLot } = require('../src/models/InventoryLot');
const { Notification } = require('../src/models/Notification');
const { PosOrderService } = require('../src/services/posOrderService');
const { JobCoordinationService } = require('../src/services/jobCoordinationService');
const procurementController = require('../src/controllers/procurementController');

const ORG_ID = 'ORG-ZAMORIN-P1';
const CAFE_ID = 'CAFE-P1-01';

async function invoke(controllerFn, req, res) {
  return new Promise((resolve, reject) => {
    const next = (err) => (err ? reject(err) : resolve());
    Promise.resolve(controllerFn(req, res, next)).then(resolve).catch(reject);
  });
}

test('CONTROLLED MULTI-NODE PRODUCTION GATE: P1 Remediation Master Verification Suite', async (t) => {
  let replSet;

  t.before(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await replSet.waitUntilRunning();
    await mongoose.connect(replSet.getUri());

    await Bill.createCollection();
    await IdempotencyRecord.createCollection();
    await RegisterSession.createCollection();
    await CashTransaction.createCollection();
    await PurchaseOrder.createCollection();
    await SequenceCounter.createCollection();
    await CafeInventoryConfig.createCollection().catch(() => {});
    await StockMovement.createCollection().catch(() => {});
    await InventoryLot.createCollection().catch(() => {});
    await Notification.createCollection().catch(() => {});

    await Bill.syncIndexes();
    await IdempotencyRecord.syncIndexes();
  });

  t.after(async () => {
    await mongoose.disconnect();
    if (replSet) await replSet.stop();
  });

  t.beforeEach(async () => {
    await Bill.deleteMany({});
    await IdempotencyRecord.deleteMany({});
    await RegisterSession.deleteMany({});
    await CashTransaction.deleteMany({});
    await PurchaseOrder.deleteMany({});
    await CafeInventoryConfig.deleteMany({});
    await StockMovement.deleteMany({});
    await InventoryLot.deleteMany({});
    await Notification.deleteMany({});
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 1. DEF-P1-01: POS CORRELATION ID AUTHORITATIVE DATABASE UNIQUENESS
  // ══════════════════════════════════════════════════════════════════════════

  await t.test('1.1 DEF-P1-01 Index Schema Verification on Live Replica Set', async () => {
    const indexes = await Bill.collection.getIndexes();
    assert.ok(indexes.org_cafe_correlation_unique, 'Index org_cafe_correlation_unique must exist on Bill');
    
    // Check partialFilterExpression to confirm null-safe compound uniqueness
    const list = await Bill.collection.listIndexes().toArray();
    const corrIdx = list.find((i) => i.name === 'org_cafe_correlation_unique');
    assert.ok(corrIdx, 'Index definition must be found in listIndexes()');
    assert.equal(corrIdx.unique, true, 'org_cafe_correlation_unique must have unique: true');
    assert.ok(corrIdx.partialFilterExpression, 'Must use partialFilterExpression');
    assert.deepEqual(corrIdx.key, { organisationId: 1, cafeId: 1, correlationId: 1 });
  });

  await t.test('1.2 DEF-P1-01 100 Concurrent Requests with Identical correlationId', async () => {
    await RegisterSession.create({
      organisationId: ORG_ID,
      cafeId: CAFE_ID,
      registerSessionId: 'REG-SESS-P1-01',
      sessionId: 'REG-SESS-P1-01',
      registerId: 'REG-01',
      businessDate: '2026-10-05',
      cashierUserId: 'CASHIER-P1',
      openedByUserId: 'CASHIER-P1',
      status: 'OPEN',
      openingFloatPaisa: 500000,
      currentCashPaisa: 500000,
      totalCashSalesPaisa: 0,
    });

    const sharedCorrelationId = 'CORR-BURST-100-TEST-001';
    const auth = { organisationId: ORG_ID, role: 'CASHIER', userId: 'CASHIER-P1' };
    const orderPayload = {
      cafeId: CAFE_ID,
      idempotencyKey: sharedCorrelationId,
      paymentMethod: 'CASH',
      isImmediateCompletion: true,
      lineItems: [{ menuItemId: 'ITM-01', itemNameSnapshot: 'Espresso', quantity: 1, unitPricePaisa: 15000, itemTotalPaisa: 15000 }],
    };

    // Fire 100 simultaneous requests with the same correlationId
    const promises = Array.from({ length: 100 }, () =>
      PosOrderService.processOrder(orderPayload, auth, 'SAVE_AND_PRINT', {
        idempotencyKey: sharedCorrelationId,
        requireAtomicInventory: false,
      }).catch((err) => ({ error: err.message }))
    );

    const results = await Promise.all(promises);
    const successful = results.filter((r) => r && !r.error);
    const failed = results.filter((r) => r && r.error);

    assert.equal(failed.length, 0, `All 100 requests must succeed without throwing 500 error: ${JSON.stringify(failed.slice(0, 3))}`);
    assert.equal(successful.length, 100, 'All 100 concurrent requests must receive valid response');

    // Authoritative DB invariant: Exactly 1 Bill exists with this correlationId
    const bills = await Bill.find({ organisationId: ORG_ID, correlationId: sharedCorrelationId });
    assert.equal(bills.length, 1, `Exactly 1 Bill must be persisted in database (found ${bills.length})`);
    assert.equal(bills[0].correlationId, sharedCorrelationId);

    // Exact 1 CashTransaction
    const cashTxs = await CashTransaction.find({ organisationId: ORG_ID, referenceId: bills[0].billId });
    assert.equal(cashTxs.length, 1, `Exactly 1 CashTransaction must be created (found ${cashTxs.length})`);

    // Replay assertions: 99 requests should be marked as idempotent replay
    const replays = successful.filter((r) => r.isIdempotentReplay);
    assert.ok(replays.length >= 90, `At least 90 requests should be idempotent replays (got ${replays.length})`);
  });

  await t.test('1.3 DEF-P1-01 Direct E11000 Duplicate Key Defense (Zero 500 to Client)', async () => {
    // Manually insert Bill directly to simulate a race where DB unique index triggers E11000
    const rawBill = new Bill({
      billId: 'BILL-20261005-11000',
      invoiceNumber: 'P/CAFE/2627/9991',
      organisationId: ORG_ID,
      cafeId: CAFE_ID,
      correlationId: 'CORR-DUPLICATE-MANUAL-001',
      saleAttemptId: 'SALE-MANUAL-001',
      orderType: 'QUICK_SALE',
      paymentMethod: 'CASH',
      paymentStatus: 'PAID',
      status: 'COMPLETED',
      businessDate: '2026-10-05',
      cashierUserId: 'CASHIER-P1',
      subtotalPaisa: 20000,
      totalPaisa: 20000,
      lineItems: [{
        menuItemId: 'ITM-01',
        itemNameSnapshot: 'Espresso',
        quantity: 1,
        unitPricePaisa: 20000,
        lineSubtotalPaisa: 20000,
        lineTotalPaisa: 20000,
      }],
    });
    await rawBill.save();

    // Now execute processOrder with the same correlationId: must catch E11000 and return committed bill with 200
    const auth = { organisationId: ORG_ID, role: 'CASHIER', userId: 'CASHIER-P1' };
    const orderPayload = {
      cafeId: CAFE_ID,
      idempotencyKey: 'CORR-DUPLICATE-MANUAL-001',
      paymentMethod: 'CASH',
      isImmediateCompletion: true,
      lineItems: [{ menuItemId: 'ITM-01', itemNameSnapshot: 'Espresso', quantity: 1, unitPricePaisa: 20000, itemTotalPaisa: 20000 }],
    };

    const res = await PosOrderService.processOrder(orderPayload, auth, 'SAVE_AND_PRINT', {
      idempotencyKey: 'CORR-DUPLICATE-MANUAL-001',
      requireAtomicInventory: false,
    });

    assert.equal(res.success, true);
    assert.equal(res.isIdempotentReplay, true);
    assert.equal(res.bill?.billId, 'BILL-20261005-11000');
    assert.equal(res.bill?.invoiceNumber, 'P/CAFE/2627/9991');
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 2. DEF-P1-02: FAIL-CLOSED DISTRIBUTED LOCKING (NO PROCESS-LOCAL SPLIT-BRAIN)
  // ══════════════════════════════════════════════════════════════════════════

  await t.test('2.1 DEF-P1-02 Clustered/Production Mode Fails Closed on Redis Drop', async () => {
    // Shared Redis mock that can simulate disconnect
    const mockRedis = {
      isOpen: true,
      set: async () => 'OK',
      eval: async () => 1,
      incr: async () => 1,
    };

    const service = new JobCoordinationService({
      redisClient: mockRedis,
      distributedAdapter: 'redis',
    });

    // 1. When connected, lock acquisition succeeds
    const lock1 = await service.acquireLock('JOB-PAYROLL-01', 'worker-1', 5000);
    assert.equal(lock1.acquired, true);

    // 2. Disconnect Redis
    mockRedis.isOpen = false;
    mockRedis.set = async () => { throw new Error('ECONNREFUSED 127.0.0.1:6379'); };
    mockRedis.eval = async () => { throw new Error('ECONNREFUSED 127.0.0.1:6379'); };

    // 3. acquireLock MUST throw DISTRIBUTED_LOCK_BACKEND_UNAVAILABLE (no silent local lock)
    await assert.rejects(
      async () => service.acquireLock('JOB-PAYROLL-01', 'worker-2', 5000),
      (err) => {
        assert.equal(err.code, 'DISTRIBUTED_LOCK_BACKEND_UNAVAILABLE');
        assert.ok(err.message.includes('Fail-closed in clustered mode'));
        return true;
      },
      'Must throw DISTRIBUTED_LOCK_BACKEND_UNAVAILABLE on Redis disconnect'
    );

    // 4. Verify local lock map was NOT populated as fallback
    assert.equal(service.localLocks.has('JOB-PAYROLL-01'), false, 'Local lock map must remain strictly empty');

    // 5. extendLock MUST throw DISTRIBUTED_LOCK_BACKEND_UNAVAILABLE
    await assert.rejects(
      async () => service.extendLock('JOB-PAYROLL-01', 'worker-1', 5000),
      (err) => err.code === 'DISTRIBUTED_LOCK_BACKEND_UNAVAILABLE'
    );

    // 6. releaseLock MUST throw DISTRIBUTED_LOCK_BACKEND_UNAVAILABLE
    await assert.rejects(
      async () => service.releaseLock('JOB-PAYROLL-01', 'worker-1'),
      (err) => err.code === 'DISTRIBUTED_LOCK_BACKEND_UNAVAILABLE'
    );

    // 7. runExclusive MUST fail closed without executing critical job body
    let executedWork = false;
    await assert.rejects(
      async () => service.runExclusive('CRITICAL_RECONCILIATION', async () => {
        executedWork = true;
      }),
      (err) => err.code === 'DISTRIBUTED_LOCK_BACKEND_UNAVAILABLE'
    );
    assert.equal(executedWork, false, 'Critical work must NEVER execute when distributed lock backend is unavailable');
  });

  await t.test('2.2 DEF-P1-02 Single-Instance Mode (DISTRIBUTED_ADAPTER=memory) Still Supported', async () => {
    const memoryService = new JobCoordinationService({
      distributedAdapter: 'memory',
    });

    const lockA = await memoryService.acquireLock('DEV-LOCAL-JOB', 'worker-A', 5000);
    assert.equal(lockA.acquired, true, 'Memory adapter safely acquires local lock');

    const lockB = await memoryService.acquireLock('DEV-LOCAL-JOB', 'worker-B', 5000);
    assert.equal(lockB.acquired, false, 'Memory adapter denies concurrent local lock');

    await memoryService.releaseLock('DEV-LOCAL-JOB', 'worker-A');
    const lockB2 = await memoryService.acquireLock('DEV-LOCAL-JOB', 'worker-B', 5000);
    assert.equal(lockB2.acquired, true, 'Memory adapter acquires lock after release');
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 3. DEF-P1-03: GRN BOUNDED LEASE & AUTHORITATIVE STATE CHECK MATRIX
  // ══════════════════════════════════════════════════════════════════════════

  await t.test('3.1 DEF-P1-03 Crash Test Point 1: Crash After Reservation (Lease Expired, PO Not Committed -> Safe Reclaim)', async () => {
    const idempotencyKey = 'GRN-CRASH-PT1-001';
    const purchaseOrderId = 'PO-CRASH-001';

    // Seed Purchase Order
    await PurchaseOrder.create({
      organisationId: ORG_ID,
      cafeId: CAFE_ID,
      purchaseOrderId,
      vendorId: 'VEND-01',
      createdByUserId: 'RECEIVER-01',
      status: 'APPROVED',
      orderDate: '2026-10-05',
      totalPaisa: 50000,
      lineItems: [{
        itemId: 'ITM-MILK',
        orderedQuantityBase: 10,
        receivedQuantityBase: 0,
        unitPricePaisa: 5000,
        totalLinePaisa: 50000,
      }],
      grnReceipts: [],
    });

    // Simulate node crash 10 minutes ago leaving an expired PROCESSING reservation
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
    const expiredLease = new Date(Date.now() - 5 * 60 * 1000);
    await IdempotencyRecord.create({
      organisationId: ORG_ID,
      cafeId: CAFE_ID,
      idempotencyKey,
      requestFingerprint: 'dummy_hash',
      status: 'PROCESSING',
      processingStartedAt: tenMinutesAgo,
      leaseExpiresAt: expiredLease,
      ownerId: 'dead-node-process-999',
    });

    // Now incoming request with the same idempotencyKey arrives
    const req = {
      auth: { organisationId: ORG_ID, userId: 'RECEIVER-01', role: 'MASTER' },
      params: { purchaseOrderId },
      body: {
        purchaseOrderId,
        idempotencyKey,
        deliveries: [{ itemId: 'ITM-MILK', deliveredQty: 10, acceptedQty: 10, rejectedQty: 0 }],
        deliveryNoteNumber: 'DN-CRASH-001',
      },
      headers: { 'x-idempotency-key': idempotencyKey },
    };

    let responseStatus = null;
    let responseBody = null;
    const res = {
      status: (code) => {
        responseStatus = code;
        return {
          json: (data) => { responseBody = data; },
        };
      },
    };

    await invoke(procurementController.verifyDeliveryAndSubmitBill, req, res);

    assert.equal(responseStatus, 200, 'Reclaimed retry must succeed with HTTP 200');
    assert.equal(responseBody.success, true);

    // Verify IdempotencyRecord finalized to COMPLETED and lease cleared
    const record = await IdempotencyRecord.findOne({ organisationId: ORG_ID, idempotencyKey });
    assert.equal(record.status, 'COMPLETED');
    assert.equal(record.leaseExpiresAt, null);

    // Verify PO recorded the GRN receipt
    const po = await PurchaseOrder.findOne({ organisationId: ORG_ID, purchaseOrderId });
    assert.equal(po.grnReceipts.length, 1);
    assert.equal(po.grnReceipts[0].idempotencyKey, idempotencyKey);
  });

  await t.test('3.2 DEF-P1-03 Crash Test Point 2: Active Lease Collision Blocks Concurrent Intake (409)', async () => {
    const idempotencyKey = 'GRN-CRASH-PT2-001';
    const purchaseOrderId = 'PO-CRASH-002';

    await PurchaseOrder.create({
      organisationId: ORG_ID,
      cafeId: CAFE_ID,
      purchaseOrderId,
      vendorId: 'VEND-01',
      createdByUserId: 'RECEIVER-01',
      status: 'APPROVED',
      orderDate: '2026-10-05',
      totalPaisa: 50000,
      lineItems: [{
        itemId: 'ITM-MILK',
        orderedQuantityBase: 10,
        receivedQuantityBase: 0,
        unitPricePaisa: 5000,
        totalLinePaisa: 50000,
      }],
      grnReceipts: [],
    });

    // An active processing lease exists (expires in 4 minutes)
    await IdempotencyRecord.create({
      organisationId: ORG_ID,
      cafeId: CAFE_ID,
      idempotencyKey,
      requestFingerprint: 'dummy_hash',
      status: 'PROCESSING',
      processingStartedAt: new Date(),
      leaseExpiresAt: new Date(Date.now() + 4 * 60 * 1000),
      ownerId: 'active-worker-process-101',
    });

    const req = {
      auth: { organisationId: ORG_ID, userId: 'RECEIVER-01', role: 'MASTER' },
      params: { purchaseOrderId },
      body: {
        purchaseOrderId,
        idempotencyKey,
        deliveries: [{ itemId: 'ITM-MILK', deliveredQty: 10, acceptedQty: 10, rejectedQty: 0 }],
        deliveryNoteNumber: 'DN-CRASH-002',
      },
      headers: { 'x-idempotency-key': idempotencyKey },
    };

    const res = { status: () => ({ json: () => {} }) };

    // Must throw 409 IDEMPOTENCY_CONFLICT while lease is active
    await assert.rejects(
      async () => invoke(procurementController.verifyDeliveryAndSubmitBill, req, res),
      (err) => {
        assert.equal(err.statusCode || err.status, 409);
        assert.equal(err.code, 'IDEMPOTENCY_CONFLICT');
        return true;
      },
      'Active lease must reject concurrent intake with 409'
    );
  });

  await t.test('3.3 DEF-P1-03 Crash Test Point 3: Crash After Commit Before Response (Authoritative PO Check Reconstructs & Returns 200 Replay)', async () => {
    const idempotencyKey = 'GRN-CRASH-PT3-001';
    const purchaseOrderId = 'PO-CRASH-003';

    // The transaction committed to the PO before the node crashed!
    await PurchaseOrder.create({
      organisationId: ORG_ID,
      cafeId: CAFE_ID,
      purchaseOrderId,
      vendorId: 'VEND-01',
      createdByUserId: 'RECEIVER-01',
      status: 'VERIFIED_PENDING_MASTER_APPROVAL',
      orderDate: '2026-10-05',
      totalPaisa: 50000,
      lineItems: [{
        itemId: 'ITM-MILK',
        orderedQuantityBase: 10,
        receivedQuantityBase: 10,
        unitPricePaisa: 5000,
        totalLinePaisa: 50000,
      }],
      grnReceipts: [
        {
          grnId: 'GRN-20261005-9999',
          idempotencyKey,
          deliveryNoteNumber: 'DN-CRASH-COMMITTED',
          receivedAt: new Date(),
          receivedByUserId: 'RECEIVER-01',
          items: [{ itemId: 'ITM-MILK', deliveredQty: 10, acceptedQty: 10, rejectedQty: 0 }],
          status: 'ACCEPTED',
        },
      ],
    });

    // Node died before setting IdempotencyRecord to COMPLETED; lease is now expired
    const expiredLease = new Date(Date.now() - 60 * 1000);
    await IdempotencyRecord.create({
      organisationId: ORG_ID,
      cafeId: CAFE_ID,
      idempotencyKey,
      requestFingerprint: 'dummy_hash',
      status: 'PROCESSING',
      processingStartedAt: new Date(Date.now() - 6 * 60 * 1000),
      leaseExpiresAt: expiredLease,
      ownerId: 'crashed-worker-404',
    });

    const req = {
      auth: { organisationId: ORG_ID, userId: 'RECEIVER-01', role: 'MASTER' },
      params: { purchaseOrderId },
      body: {
        purchaseOrderId,
        idempotencyKey,
        deliveries: [{ itemId: 'ITM-MILK', deliveredQty: 10, acceptedQty: 10, rejectedQty: 0 }],
        deliveryNoteNumber: 'DN-CRASH-COMMITTED',
      },
      headers: { 'x-idempotency-key': idempotencyKey },
    };

    let responseStatus = null;
    let responseBody = null;
    const res = {
      status: (code) => {
        responseStatus = code;
        return {
          json: (data) => { responseBody = data; },
        };
      },
    };

    await invoke(procurementController.verifyDeliveryAndSubmitBill, req, res);

    assert.equal(responseStatus, 200, 'Must return HTTP 200');
    assert.equal(responseBody.isIdempotentReplay, true, 'Must return as idempotent replay without duplicate receipt');
    assert.equal(responseBody.data?.grn?.grnId, 'GRN-20261005-9999');

    // Verify PO STILL has exactly 1 GRN receipt (no duplicate receipt created)
    const po = await PurchaseOrder.findOne({ organisationId: ORG_ID, purchaseOrderId });
    assert.equal(po.grnReceipts.length, 1);

    // Verify IdempotencyRecord was repaired to COMPLETED
    const repaired = await IdempotencyRecord.findOne({ organisationId: ORG_ID, idempotencyKey });
    assert.equal(repaired.status, 'COMPLETED');
    assert.equal(repaired.leaseExpiresAt, null);
  });
});
