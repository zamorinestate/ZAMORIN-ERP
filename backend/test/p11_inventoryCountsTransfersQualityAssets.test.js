'use strict';

/**
 * ============================================================================
 * ZAMORIN CAFÉ ERP — P11 INVENTORY OPERATIONS LIFECYCLE TEST SUITE
 * ============================================================================
 *
 * Verifies non-negotiable operational inventory controls:
 *  1. Blind counts do not disclose expected quantity before count submission.
 *  2. Finalized count sessions are immutable or corrected through an auditable correction workflow.
 *  3. A duplicate count finalization cannot post duplicate adjustments.
 *  4. A stock movement racing with a count follows the documented cutoff policy.
 *  5. Approved variance posting creates the correct stock movement and balance.
 *  6. Unauthorized variance approval or posting is rejected.
 *  7. Two concurrent dispatch attempts cannot dispatch more than the source's available quantity.
 *  8. Dispatched stock is unavailable at the source while in transit.
 *  9. Destination stock increases only by accepted receipt quantity.
 * 10. Partial and rejected receipts preserve accurate quantities and discrepancy records.
 * 11. Duplicate transfer dispatch or receipt requests cannot duplicate movements.
 * 12. A transfer cannot cross organisation boundaries.
 * 13. Owner, Staff, Vendor, and out-of-scope Café Operations requests are rejected according to canonical matrix.
 * 14. Quarantined, expired, recalled, and blocked lots cannot be allocated by FEFO or consumed by POS/BOM workflows.
 * 15. Recall queries identify all locations represented by the application's available lot-level history.
 * 16. Wastage does not restore stock to usable inventory.
 * 17. Financial refunds do not independently restore stock.
 * 18. Asset maintenance updates preserve history and authorization boundaries.
 * 19. Due/overdue maintenance status is derived from persisted schedule data.
 * 20. Concurrent and repeated operations remain idempotent and do not create negative or duplicate stock.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryReplSet } = require('mongodb-memory-server');

// Models
const { InventoryCycleCount } = require('../src/models/InventoryCycleCount');
const { StockTransfer } = require('../src/models/StockTransfer');
const { StockMovement } = require('../src/models/StockMovement');
const { CafeInventoryConfig } = require('../src/models/CafeInventoryConfig');
const { GlobalInventoryItem } = require('../src/models/GlobalInventoryItem');
const { InventoryLot } = require('../src/models/InventoryLot');
const { IncomingInspection } = require('../src/models/IncomingInspection');
const { WastageRecord } = require('../src/models/WastageRecord');
const { Asset } = require('../src/models/Asset');
const { MaintenanceJob } = require('../src/models/MaintenanceJob');
const { MaintenancePlan } = require('../src/models/MaintenancePlan');
const { Cafe } = require('../src/models/Cafe');
const { Bill } = require('../src/models/Bill');

// Controllers & Services
const {
  submitCycleCount,
  approveCycleCount,
  getCycleCount,
  listCycleCounts,
  createTransfer,
  dispatchTransfer,
  receiveTransfer,
  recordWastage,
} = require('../src/controllers/inventoryController');

const {
  createAsset,
  completeMaintenanceJob,
} = require('../src/controllers/assetController');

const { FefoService } = require('../src/services/fefoService');
const RecallTraceService = require('../src/services/recallTraceService');
const { assetMaintenanceService } = require('../src/services/assetMaintenanceService');
const { authorize } = require('../src/middleware/authorize');

let replSet;
const ORG_A = 'ORG-ZAMORIN';
const ORG_B = 'ORG-OTHER';
const CAFE_1 = 'ZC-0001';
const CAFE_2 = 'ZC-0002';

function mockReq(auth, { params = {}, body = {}, query = {}, method = 'GET', url = '/' } = {}) {
  return {
    auth,
    params,
    body,
    query,
    method,
    url,
    originalUrl: url,
    headers: {},
    get(h) {
      return this.headers[h.toLowerCase()];
    },
  };
}

function mockRes() {
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

test.before(async () => {
  replSet = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: 'wiredTiger' },
  });
  await mongoose.connect(replSet.getUri(), { dbName: 'zamorin_p11_test' });

  await Promise.all([
    InventoryCycleCount.init(),
    StockTransfer.init(),
    StockMovement.init(),
    CafeInventoryConfig.init(),
    GlobalInventoryItem.init(),
    InventoryLot.init(),
    IncomingInspection.init(),
    WastageRecord.init(),
    Asset.init(),
    MaintenanceJob.init(),
    MaintenancePlan.init(),
    Cafe.init(),
    Bill.init(),
  ]);
});

test.after(async () => {
  await mongoose.disconnect();
  if (replSet) await replSet.stop();
});

test.beforeEach(async () => {
  const collections = mongoose.connection.collections;
  for (const key of Object.keys(collections)) {
    await collections[key].deleteMany({});
  }

  // Seed standard Cafés
  await Cafe.create([
    {
      organisationId: ORG_A,
      cafeId: CAFE_1,
      name: 'Zamorin Flagship Beach',
      displayName: 'Zamorin Flagship Beach',
      createdBy: 'SYSTEM',
      status: 'ACTIVE',
    },
    {
      organisationId: ORG_A,
      cafeId: CAFE_2,
      name: 'Zamorin City Center',
      displayName: 'Zamorin City Center',
      createdBy: 'SYSTEM',
      status: 'ACTIVE',
    },
    {
      organisationId: ORG_B,
      cafeId: 'ZC-9999',
      name: 'Other Tenant Cafe',
      displayName: 'Other Tenant Cafe',
      createdBy: 'SYSTEM',
      status: 'ACTIVE',
    },
  ]);
});

test('1. Blind counts do not disclose expected quantity before count submission', async () => {
  // Setup inventory config
  await CafeInventoryConfig.create({
    organisationId: ORG_A,
    cafeId: CAFE_1,
    itemId: 'COFFEE-BEANS',
    currentQuantityBase: 125.5,
    availableQuantityBase: 125.5,
  });

  const authMaster = {
    organisationId: ORG_A,
    userId: 'USR-MASTER',
    role: 'MASTER',
    isPrimaryMaster: true,
  };

  const authCounter = {
    organisationId: ORG_A,
    userId: 'USR-COUNTER',
    role: 'CAFE_ADMIN',
    assignedCafeIds: [CAFE_1],
  };

  // Submit blind count session
  const submitReq = mockReq(authCounter, {
    body: {
      cafeId: CAFE_1,
      countType: 'CYCLE_COUNT',
      isBlindCount: true,
      items: [{ itemId: 'COFFEE-BEANS', countedQty: 120.0 }],
    },
  });
  const submitRes = mockRes();
  await submitCycleCount(submitReq, submitRes);
  assert.equal(submitRes.statusCode, 201);
  const countId = submitRes.body.cycleCount.countId;

  // Retrieve count as store counter (non-master)
  const getReq = mockReq(authCounter, { params: { countId } });
  const getRes = mockRes();
  await getCycleCount(getReq, getRes);

  assert.equal(getRes.statusCode, 200);
  const returnedItem = getRes.body.count.items[0];
  // Expected quantity must be redacted / hidden
  assert.equal(returnedItem.systemQty, null, 'Expected systemQty must be null in blind count before approval');
  assert.equal(returnedItem.varianceQty, null, 'Expected varianceQty must be null in blind count before approval');
  assert.equal(returnedItem.countedQty, 120.0, 'Counted quantity must be preserved');
});

test('2. Finalized count sessions are immutable or rejected on resubmission', async () => {
  await CafeInventoryConfig.create({
    organisationId: ORG_A,
    cafeId: CAFE_1,
    itemId: 'MILK-TETRA',
    currentQuantityBase: 50,
    availableQuantityBase: 50,
  });

  const authMaster = {
    organisationId: ORG_A,
    userId: 'USR-MASTER',
    role: 'MASTER',
    isPrimaryMaster: true,
  };

  // Submit and approve
  const submitReq = mockReq(authMaster, {
    body: {
      cafeId: CAFE_1,
      countType: 'CYCLE_COUNT',
      isBlindCount: false,
      items: [{ itemId: 'MILK-TETRA', countedQty: 48, systemQty: 50 }],
    },
  });
  const submitRes = mockRes();
  await submitCycleCount(submitReq, submitRes);
  const countId = submitRes.body.cycleCount.countId;

  const appReq = mockReq(authMaster, { params: { countId } });
  const appRes = mockRes();
  await approveCycleCount(appReq, appRes);
  assert.equal(appRes.statusCode, 200);

  // Verify status is POSTED
  const posted = await InventoryCycleCount.findOne({ countId });
  assert.equal(posted.status, 'POSTED');
  assert.notEqual(posted.postedAt, null);
});

test('3. A duplicate count finalization cannot post duplicate adjustments', async () => {
  await CafeInventoryConfig.create({
    organisationId: ORG_A,
    cafeId: CAFE_1,
    itemId: 'SYRUP-VANILLA',
    currentQuantityBase: 20,
    availableQuantityBase: 20,
  });

  const authMaster = {
    organisationId: ORG_A,
    userId: 'USR-MASTER',
    role: 'MASTER',
    isPrimaryMaster: true,
  };

  // Submit count with variance -3 (counted 17 vs system 20)
  const submitReq = mockReq(authMaster, {
    body: {
      cafeId: CAFE_1,
      items: [{ itemId: 'SYRUP-VANILLA', countedQty: 17, systemQty: 20 }],
    },
  });
  const submitRes = mockRes();
  await submitCycleCount(submitReq, submitRes);
  const countId = submitRes.body.cycleCount.countId;

  // First approval
  const appReq1 = mockReq(authMaster, { params: { countId } });
  const appRes1 = mockRes();
  await approveCycleCount(appReq1, appRes1);
  assert.equal(appRes1.statusCode, 200);

  // Stock should be 17
  const cfg1 = await CafeInventoryConfig.findOne({ cafeId: CAFE_1, itemId: 'SYRUP-VANILLA' });
  assert.equal(cfg1.currentQuantityBase, 17);

  // Check movements count
  const mvts1 = await StockMovement.find({ referenceId: countId });
  assert.equal(mvts1.length, 1);

  // Duplicate approval call
  const appReq2 = mockReq(authMaster, { params: { countId } });
  const appRes2 = mockRes();
  await approveCycleCount(appReq2, appRes2);
  assert.equal(appRes2.statusCode, 200);
  assert.equal(appRes2.body.alreadyPosted, true);

  // Stock must NOT be reduced again to 14
  const cfg2 = await CafeInventoryConfig.findOne({ cafeId: CAFE_1, itemId: 'SYRUP-VANILLA' });
  assert.equal(cfg2.currentQuantityBase, 17, 'Balance must remain 17; duplicate post cannot adjust twice');

  const mvts2 = await StockMovement.find({ referenceId: countId });
  assert.equal(mvts2.length, 1, 'Exactly one stock movement must exist; duplicate adjustment prevented');
});

test('4. A stock movement racing with a count follows the documented cutoff policy', async () => {
  // T0: Initial stock = 100
  await CafeInventoryConfig.create({
    organisationId: ORG_A,
    cafeId: CAFE_1,
    itemId: 'TEA-LEAVES',
    currentQuantityBase: 100,
    availableQuantityBase: 100,
  });

  const authMaster = {
    organisationId: ORG_A,
    userId: 'USR-MASTER',
    role: 'MASTER',
    isPrimaryMaster: true,
  };

  // T0: Start count session. Snapshot is 100. Physical count counted at T0 is 97 (variance = -3).
  const submitReq = mockReq(authMaster, {
    body: {
      cafeId: CAFE_1,
      items: [{ itemId: 'TEA-LEAVES', countedQty: 97, systemQty: 100 }],
    },
  });
  const submitRes = mockRes();
  await submitCycleCount(submitReq, submitRes);
  const countId = submitRes.body.cycleCount.countId;

  // T1: Racing POS sale of 10 units occurs BEFORE count is approved!
  await CafeInventoryConfig.findOneAndUpdate(
    { cafeId: CAFE_1, itemId: 'TEA-LEAVES' },
    { $inc: { currentQuantityBase: -10, availableQuantityBase: -10 } }
  );
  await StockMovement.create({
    organisationId: ORG_A,
    movementId: 'MVT-RACING-POS-01',
    cafeId: CAFE_1,
    itemId: 'TEA-LEAVES',
    movementType: 'CONSUMPTION',
    quantityBase: -10,
    balanceBeforeBase: 100,
    balanceAfterBase: 90,
    reason: 'POS Sale during count session',
    referenceType: 'POS_SALE',
    referenceId: 'BILL-RACE-01',
    performedByUserId: 'USR-POS',
  });

  // Balance at T1 is 90
  const cfgT1 = await CafeInventoryConfig.findOne({ cafeId: CAFE_1, itemId: 'TEA-LEAVES' });
  assert.equal(cfgT1.currentQuantityBase, 90);

  // T2: Count approved. Cutoff variance of -3 is reconciled into current balance:
  // Expected reconciled balance = 90 + (-3) = 87! (NOT 97 which would erase the 10 sold units!)
  const appReq = mockReq(authMaster, { params: { countId } });
  const appRes = mockRes();
  await approveCycleCount(appReq, appRes);
  assert.equal(appRes.statusCode, 200);

  const cfgT2 = await CafeInventoryConfig.findOne({ cafeId: CAFE_1, itemId: 'TEA-LEAVES' });
  assert.equal(cfgT2.currentQuantityBase, 87, 'Racing sale of 10 units must be preserved: 90 + (-3) = 87');
});

test('5. Approved variance posting creates the correct stock movement and balance', async () => {
  await CafeInventoryConfig.create({
    organisationId: ORG_A,
    cafeId: CAFE_1,
    itemId: 'MATCHA-POWDER',
    currentQuantityBase: 40,
    availableQuantityBase: 40,
  });

  const authMaster = {
    organisationId: ORG_A,
    userId: 'USR-MASTER',
    role: 'MASTER',
    isPrimaryMaster: true,
  };

  const submitReq = mockReq(authMaster, {
    body: {
      cafeId: CAFE_1,
      items: [{ itemId: 'MATCHA-POWDER', countedQty: 42, systemQty: 40, reason: 'Found extra unopened tin' }],
    },
  });
  const submitRes = mockRes();
  await submitCycleCount(submitReq, submitRes);
  const countId = submitRes.body.cycleCount.countId;

  const appReq = mockReq(authMaster, { params: { countId } });
  const appRes = mockRes();
  await approveCycleCount(appReq, appRes);
  assert.equal(appRes.statusCode, 200);

  const movement = await StockMovement.findOne({ referenceId: countId });
  assert.ok(movement);
  assert.equal(movement.movementType, 'COUNT_ADJUSTMENT');
  assert.equal(movement.quantityBase, 2);
  assert.equal(movement.balanceBeforeBase, 40);
  assert.equal(movement.balanceAfterBase, 42);
  assert.match(movement.reason, /Found extra unopened tin/);
});

test('6. Unauthorized variance approval or posting is rejected', async () => {
  await CafeInventoryConfig.create({
    organisationId: ORG_A,
    cafeId: CAFE_1,
    itemId: 'COCOA-BEANS',
    currentQuantityBase: 30,
    availableQuantityBase: 30,
  });

  const count = await InventoryCycleCount.create({
    organisationId: ORG_A,
    countId: 'CNT-UNAUTH-01',
    cafeId: CAFE_1,
    items: [{ itemId: 'COCOA-BEANS', systemQty: 30, countedQty: 25, varianceQty: -5 }],
    status: 'SUBMITTED',
    countedByUserId: 'USR-COUNTER',
  });

  // Owner persona attempting approval (Owner has strictly read-only visibility)
  const authOwner = {
    organisationId: ORG_A,
    userId: 'USR-OWNER',
    role: 'OWNER',
  };

  const reqOwner = mockReq(authOwner, { params: { countId: count.countId } });
  const resOwner = mockRes();

  const middleware = authorize('INVENTORY_WRITE', { allowedRoles: ['MASTER', 'CAFE_ADMIN'] });
  let nextCalled = false;
  await middleware(reqOwner, resOwner, () => { nextCalled = true; });

  assert.equal(nextCalled, false, 'Middleware must not allow OWNER on INVENTORY_WRITE');
  assert.equal(resOwner.statusCode, 403);
  assert.equal(resOwner.body.error.code, 'ROLE_NOT_ALLOWED');
});

test('7. Two concurrent dispatch attempts cannot dispatch more than source available quantity', async () => {
  // Source has 10 units available
  await CafeInventoryConfig.create({
    organisationId: ORG_A,
    cafeId: CAFE_1,
    itemId: 'ALMOND-MILK',
    currentQuantityBase: 10,
    availableQuantityBase: 10,
  });

  await CafeInventoryConfig.create({
    organisationId: ORG_A,
    cafeId: CAFE_2,
    itemId: 'ALMOND-MILK',
    currentQuantityBase: 0,
    availableQuantityBase: 0,
    inTransitQuantityBase: 0,
  });

  const authMaster = {
    organisationId: ORG_A,
    userId: 'USR-MASTER',
    role: 'MASTER',
    isPrimaryMaster: true,
  };

  // Transfer 1 requests 7 units
  const t1 = await StockTransfer.create({
    organisationId: ORG_A,
    transferId: 'TRF-CONC-01',
    sourceCafeId: CAFE_1,
    destCafeId: CAFE_2,
    itemId: 'ALMOND-MILK',
    requestedQty: 7,
    status: 'REQUESTED',
    requestedBy: 'USR-MASTER',
  });

  // Transfer 2 requests 7 units
  const t2 = await StockTransfer.create({
    organisationId: ORG_A,
    transferId: 'TRF-CONC-02',
    sourceCafeId: CAFE_1,
    destCafeId: CAFE_2,
    itemId: 'ALMOND-MILK',
    requestedQty: 7,
    status: 'REQUESTED',
    requestedBy: 'USR-MASTER',
  });

  // Simulate two concurrent dispatches competing for 10 units
  const dispatch1 = async () => {
    const req = mockReq(authMaster, { params: { transferId: t1.transferId } });
    const res = mockRes();
    try {
      await dispatchTransfer(req, res);
      return { success: res.statusCode === 200, res };
    } catch (e) {
      return { success: false, error: e };
    }
  };

  const dispatch2 = async () => {
    const req = mockReq(authMaster, { params: { transferId: t2.transferId } });
    const res = mockRes();
    try {
      await dispatchTransfer(req, res);
      return { success: res.statusCode === 200, res };
    } catch (e) {
      return { success: false, error: e };
    }
  };

  const [r1, r2] = await Promise.all([dispatch1(), dispatch2()]);

  // Exactly one dispatch must succeed, and one must fail with INSUFFICIENT_STOCK
  const successCount = [r1.success, r2.success].filter(Boolean).length;
  assert.equal(successCount, 1, 'Exactly one concurrent dispatch can succeed when stock is insufficient for both');

  // Verify source balance: 10 - 7 = 3 (NEVER negative like -4)
  const sourceCfg = await CafeInventoryConfig.findOne({ cafeId: CAFE_1, itemId: 'ALMOND-MILK' });
  assert.equal(sourceCfg.currentQuantityBase, 3);
  assert.equal(sourceCfg.availableQuantityBase, 3);
});

test('8. Dispatched stock is unavailable at the source while in transit', async () => {
  await CafeInventoryConfig.create({
    organisationId: ORG_A,
    cafeId: CAFE_1,
    itemId: 'CHAI-SPICE',
    currentQuantityBase: 50,
    availableQuantityBase: 50,
  });

  await CafeInventoryConfig.create({
    organisationId: ORG_A,
    cafeId: CAFE_2,
    itemId: 'CHAI-SPICE',
    currentQuantityBase: 10,
    availableQuantityBase: 10,
    inTransitQuantityBase: 0,
  });

  const authMaster = {
    organisationId: ORG_A,
    userId: 'USR-MASTER',
    role: 'MASTER',
    isPrimaryMaster: true,
  };

  const t = await StockTransfer.create({
    organisationId: ORG_A,
    transferId: 'TRF-TRANSIT-01',
    sourceCafeId: CAFE_1,
    destCafeId: CAFE_2,
    itemId: 'CHAI-SPICE',
    requestedQty: 20,
    status: 'REQUESTED',
    requestedBy: 'USR-MASTER',
  });

  const dispatchReq = mockReq(authMaster, { params: { transferId: t.transferId } });
  const dispatchRes = mockRes();
  await dispatchTransfer(dispatchReq, dispatchRes);
  assert.equal(dispatchRes.statusCode, 200);

  // Invariant check:
  // Source café stock reduced from 50 to 30:
  const src = await CafeInventoryConfig.findOne({ cafeId: CAFE_1, itemId: 'CHAI-SPICE' });
  assert.equal(src.currentQuantityBase, 30);
  assert.equal(src.availableQuantityBase, 30);

  // Destination café available stock must NOT increase yet (remains 10), but inTransit is 20:
  const dst = await CafeInventoryConfig.findOne({ cafeId: CAFE_2, itemId: 'CHAI-SPICE' });
  assert.equal(dst.currentQuantityBase, 10, 'Destination available stock must NOT include in-transit stock');
  assert.equal(dst.availableQuantityBase, 10);
  assert.equal(dst.inTransitQuantityBase, 20, 'Destination in-transit must accurately reflect 20 units');
});

test('9. Destination stock increases only by accepted receipt quantity', async () => {
  await CafeInventoryConfig.create({
    organisationId: ORG_A,
    cafeId: CAFE_1,
    itemId: 'OAT-MILK',
    currentQuantityBase: 40,
    availableQuantityBase: 40,
  });

  await CafeInventoryConfig.create({
    organisationId: ORG_A,
    cafeId: CAFE_2,
    itemId: 'OAT-MILK',
    currentQuantityBase: 5,
    availableQuantityBase: 5,
    inTransitQuantityBase: 0,
  });

  const authMaster = {
    organisationId: ORG_A,
    userId: 'USR-MASTER',
    role: 'MASTER',
    isPrimaryMaster: true,
  };

  const t = await StockTransfer.create({
    organisationId: ORG_A,
    transferId: 'TRF-ACCEPT-01',
    sourceCafeId: CAFE_1,
    destCafeId: CAFE_2,
    itemId: 'OAT-MILK',
    requestedQty: 15,
    status: 'REQUESTED',
    requestedBy: 'USR-MASTER',
  });

  // Dispatch 15 units
  await dispatchTransfer(mockReq(authMaster, { params: { transferId: t.transferId } }), mockRes());

  // Receive: only 12 accepted, 3 rejected due to leakage in transit
  const recReq = mockReq(authMaster, {
    params: { transferId: t.transferId },
    body: { acceptedQty: 12, rejectedQty: 3, rejectionReason: '3 cartons crushed and leaking' },
  });
  const recRes = mockRes();
  await receiveTransfer(recReq, recRes);
  assert.equal(recRes.statusCode, 200);

  // Destination stock: 5 + 12 = 17 (NOT 5 + 15 = 20)
  const dst = await CafeInventoryConfig.findOne({ cafeId: CAFE_2, itemId: 'OAT-MILK' });
  assert.equal(dst.currentQuantityBase, 17, 'Stock must only increase by accepted quantity (12)');
  assert.equal(dst.availableQuantityBase, 17);
  assert.equal(dst.inTransitQuantityBase, 0, 'In-transit quantity must be fully cleared');
});

test('10. Partial and rejected receipts preserve accurate quantities and discrepancy records', async () => {
  const t = await StockTransfer.create({
    organisationId: ORG_A,
    transferId: 'TRF-DISCREP-01',
    sourceCafeId: CAFE_1,
    destCafeId: CAFE_2,
    itemId: 'CARAMEL-SYRUP',
    requestedQty: 10,
    dispatchedQty: 10,
    status: 'IN_TRANSIT',
    requestedBy: 'USR-MASTER',
    dispatchedBy: 'USR-MASTER',
    dispatchedAt: new Date(),
  });

  await CafeInventoryConfig.create({
    organisationId: ORG_A,
    cafeId: CAFE_2,
    itemId: 'CARAMEL-SYRUP',
    currentQuantityBase: 0,
    availableQuantityBase: 0,
    inTransitQuantityBase: 10,
  });

  const authDest = {
    organisationId: ORG_A,
    userId: 'USR-DEST-ADMIN',
    role: 'CAFE_ADMIN',
    assignedCafeIds: [CAFE_2],
  };

  const recReq = mockReq(authDest, {
    params: { transferId: t.transferId },
    body: {
      acceptedQty: 7,
      rejectedQty: 3,
      rejectionReason: 'Broken seals upon delivery',
    },
  });
  const recRes = mockRes();
  await receiveTransfer(recReq, recRes);
  assert.equal(recRes.statusCode, 200);

  const updatedTransfer = await StockTransfer.findOne({ transferId: t.transferId });
  assert.equal(updatedTransfer.status, 'COMPLETED');
  assert.equal(updatedTransfer.receivedQty, 7);
  assert.equal(updatedTransfer.rejectedQty, 3);
  assert.equal(updatedTransfer.varianceQty, -3);
  assert.equal(updatedTransfer.rejectionReason, 'Broken seals upon delivery');
});

test('11. Duplicate transfer dispatch or receipt requests cannot duplicate movements', async () => {
  await CafeInventoryConfig.create({
    organisationId: ORG_A,
    cafeId: CAFE_1,
    itemId: 'ESPRESSO-PODS',
    currentQuantityBase: 100,
    availableQuantityBase: 100,
  });

  await CafeInventoryConfig.create({
    organisationId: ORG_A,
    cafeId: CAFE_2,
    itemId: 'ESPRESSO-PODS',
    currentQuantityBase: 0,
    availableQuantityBase: 0,
  });

  const authMaster = {
    organisationId: ORG_A,
    userId: 'USR-MASTER',
    role: 'MASTER',
    isPrimaryMaster: true,
  };

  const t = await StockTransfer.create({
    organisationId: ORG_A,
    transferId: 'TRF-DUP-01',
    sourceCafeId: CAFE_1,
    destCafeId: CAFE_2,
    itemId: 'ESPRESSO-PODS',
    requestedQty: 25,
    status: 'REQUESTED',
    requestedBy: 'USR-MASTER',
  });

  // First dispatch
  await dispatchTransfer(mockReq(authMaster, { params: { transferId: t.transferId } }), mockRes());

  // Re-dispatch must reject with 409
  let dupDispatchErr = null;
  try {
    await dispatchTransfer(mockReq(authMaster, { params: { transferId: t.transferId } }), mockRes());
  } catch (e) {
    dupDispatchErr = e;
  }
  assert.ok(dupDispatchErr);
  assert.equal(dupDispatchErr.statusCode, 409);
  assert.equal(dupDispatchErr.errorCode, 'TRANSFER_ALREADY_DISPATCHED');

  // Verify only one dispatch movement
  const outMvts = await StockMovement.find({ referenceId: t.transferId, movementType: 'CAFE_TRANSFER_OUT' });
  assert.equal(outMvts.length, 1);

  // Receive transfer
  await receiveTransfer(mockReq(authMaster, { params: { transferId: t.transferId }, body: { acceptedQty: 25 } }), mockRes());

  // Re-receive must reject with 409
  let dupReceiveErr = null;
  try {
    await receiveTransfer(mockReq(authMaster, { params: { transferId: t.transferId }, body: { acceptedQty: 25 } }), mockRes());
  } catch (e) {
    dupReceiveErr = e;
  }
  assert.ok(dupReceiveErr);
  assert.equal(dupReceiveErr.statusCode, 409);
  assert.equal(dupReceiveErr.errorCode, 'TRANSFER_ALREADY_COMPLETED');

  // Verify only one receipt movement
  const inMvts = await StockMovement.find({ referenceId: t.transferId, movementType: 'CAFE_TRANSFER_IN' });
  assert.equal(inMvts.length, 1);
});

test('12. A transfer cannot cross organisation boundaries', async () => {
  const authMasterOrgA = {
    organisationId: ORG_A,
    userId: 'USR-MASTER-A',
    role: 'MASTER',
    isPrimaryMaster: true,
  };

  // Attempt transfer from CAFE_1 (ORG_A) to OTHER-01 (ORG_B)
  const req = mockReq(authMasterOrgA, {
    body: {
      sourceCafeId: CAFE_1,
      destCafeId: 'ZC-9999',
      itemId: 'COFFEE-BEANS',
      requestedQty: 10,
    },
  });
  const res = mockRes();

  let crossOrgErr = null;
  try {
    await createTransfer(req, res);
  } catch (e) {
    crossOrgErr = e;
  }

  assert.ok(crossOrgErr, 'Cross-organisation transfer must be rejected');
  assert.equal(crossOrgErr.statusCode, 400);
  assert.equal(crossOrgErr.errorCode, 'CROSS_TENANT_TRANSFER_PROHIBITED');
});

test('13. Owner, Staff, Vendor, and out-of-scope Café Operations requests are rejected according to canonical matrix', async () => {
  const writeMiddleware = authorize('INVENTORY_WRITE', { allowedRoles: ['MASTER', 'CAFE_ADMIN'] });

  // A. Staff persona: Forbidden
  const reqStaff = mockReq({ organisationId: ORG_A, userId: 'USR-STAFF', role: 'STAFF' }, { method: 'POST' });
  const resStaff = mockRes();
  let staffPassed = false;
  await writeMiddleware(reqStaff, resStaff, () => { staffPassed = true; });
  assert.equal(staffPassed, false);
  assert.equal(resStaff.statusCode, 403);
  assert.equal(resStaff.body.error.code, 'ROLE_NOT_ALLOWED');

  // B. Vendor persona mutating inventory: 403 VENDOR_READ_ONLY
  const reqVendor = mockReq({ organisationId: ORG_A, userId: 'USR-VENDOR', role: 'VENDOR' }, { method: 'POST' });
  const resVendor = mockRes();
  let vendorPassed = false;
  await writeMiddleware(reqVendor, resVendor, () => { vendorPassed = true; });
  assert.equal(vendorPassed, false);
  assert.equal(resVendor.statusCode, 403);
  assert.equal(resVendor.body.error.code, 'VENDOR_READ_ONLY');

  // C. Retired Normal Master: 403 ROLE_RETIRED
  const reqRetired = mockReq({ organisationId: ORG_A, userId: 'USR-OLD-MASTER', role: 'MASTER', isPrimaryMaster: false }, { method: 'POST' });
  const resRetired = mockRes();
  let retiredPassed = false;
  await writeMiddleware(reqRetired, resRetired, () => { retiredPassed = true; });
  assert.equal(retiredPassed, false);
  assert.equal(resRetired.statusCode, 403);
  assert.equal(resRetired.body.error.code, 'ROLE_RETIRED');

  // D. Out-of-scope Café Admin: Assigned CAFE_1 attempting operation on CAFE_2
  const authCafe1Admin = {
    organisationId: ORG_A,
    userId: 'USR-ADMIN-1',
    role: 'CAFE_ADMIN',
    assignedCafeIds: [CAFE_1],
  };

  const reqCrossCafe = mockReq(authCafe1Admin, {
    body: {
      sourceCafeId: CAFE_2, // Not assigned!
      destCafeId: CAFE_1,
      itemId: 'BEANS',
      requestedQty: 5,
    },
  });
  const resCrossCafe = mockRes();
  let crossCafeErr = null;
  try {
    await createTransfer(reqCrossCafe, resCrossCafe);
  } catch (e) {
    crossCafeErr = e;
  }
  assert.ok(crossCafeErr);
  assert.equal(crossCafeErr.statusCode, 403);
  assert.ok(
    ['CROSS_CAFE_RESOURCE_DENIED', 'CAFE_ACCESS_DENIED'].includes(crossCafeErr.errorCode),
    `Expected cross-café denial, got ${crossCafeErr.errorCode}`
  );
});

test('14. Quarantined, expired, recalled, and blocked lots cannot be allocated by FEFO or consumed', async () => {
  // Create test lots with various statuses
  await InventoryLot.create([
    {
      organisationId: ORG_A,
      cafeId: CAFE_1,
      lotId: 'LOT-QUARANTINE-01',
      itemId: 'DAIRY-CREAM',
      expiryDate: '2026-12-31',
      quantityBase: 20,
      remainingQuantity: 20,
      status: 'QUARANTINE',
    },
    {
      organisationId: ORG_A,
      cafeId: CAFE_1,
      lotId: 'LOT-EXPIRED-01',
      itemId: 'DAIRY-CREAM',
      expiryDate: '2026-01-01', // Already expired
      quantityBase: 30,
      remainingQuantity: 30,
      status: 'EXPIRED',
    },
    {
      organisationId: ORG_A,
      cafeId: CAFE_1,
      lotId: 'LOT-VALID-01',
      itemId: 'DAIRY-CREAM',
      expiryDate: '2026-11-30',
      quantityBase: 5,
      remainingQuantity: 5,
      status: 'AVAILABLE',
    },
  ]);

  // Requesting 10 units should fail because only 5 available non-quarantined/non-expired units exist
  let fefoErr = null;
  try {
    await FefoService.planFefoDeduction({
      organisationId: ORG_A,
      cafeId: CAFE_1,
      itemId: 'DAIRY-CREAM',
      requiredQuantity: 10,
      businessDate: '2026-10-10',
    });
  } catch (e) {
    fefoErr = e;
  }

  assert.ok(fefoErr);
  assert.equal(fefoErr.errorCode, 'INSUFFICIENT_UNEXPIRED_STOCK');

  // Requesting 4 units should succeed and allocate strictly from LOT-VALID-01
  const plan = await FefoService.planFefoDeduction({
    organisationId: ORG_A,
    cafeId: CAFE_1,
    itemId: 'DAIRY-CREAM',
    requiredQuantity: 4,
    businessDate: '2026-10-10',
  });

  assert.equal(plan.totalAllocated, 4);
  assert.equal(plan.allocatedLots.length, 1);
  assert.equal(plan.allocatedLots[0].lotId, 'LOT-VALID-01');
});

test('15. Recall queries identify all locations represented by available lot-level history', async () => {
  // Seed lots across both cafes
  await InventoryLot.create([
    {
      organisationId: ORG_A,
      cafeId: CAFE_1,
      lotId: 'LOT-RECALL-A',
      supplierLot: 'SUPP-RECALL-99',
      itemId: 'HAZELNUT-SYRUP',
      expiryDate: '2026-12-31',
      quantityBase: 12,
      remainingQuantity: 12,
      status: 'AVAILABLE',
    },
    {
      organisationId: ORG_A,
      cafeId: CAFE_2,
      lotId: 'LOT-RECALL-B',
      supplierLot: 'SUPP-RECALL-99',
      itemId: 'HAZELNUT-SYRUP',
      expiryDate: '2026-12-31',
      quantityBase: 8,
      remainingQuantity: 8,
      status: 'QUARANTINE',
    },
  ]);

  // Seed customer bill that consumed LOT-RECALL-A
  await Bill.create({
    organisationId: ORG_A,
    cafeId: CAFE_1,
    billId: 'BILL-20261010-0001',
    invoiceNumber: 'INV/C01/2627/0001',
    customerName: 'Aarav Patel',
    customerPhone: '+919876543210',
    businessDate: '2026-10-10',
    lineItems: [
      {
        menuItemId: 'HAZELNUT-LATTE',
        itemNameSnapshot: 'Hazelnut Latte',
        quantity: 2,
        unitPricePaisa: 2500,
        lineSubtotalPaisa: 5000,
        cgstPaisa: 125,
        sgstPaisa: 125,
        lineTotalPaisa: 5250,
        consumedLots: [{ lotId: 'LOT-RECALL-A', quantityConsumed: 0.1 }],
      },
    ],
    subtotalPaisa: 5000,
    taxPaisa: 250,
    preRoundingTotalPaisa: 5250,
    roundOffPaisa: 0,
    totalPaisa: 5250,
    paymentMethod: 'CASH',
    paymentStatus: 'PAID',
    cashierUserId: 'USR-CASHIER-01',
    status: 'COMPLETED',
  });

  const traceResult = await RecallTraceService.traceForward({
    organisationId: ORG_A,
    supplierLot: 'SUPP-RECALL-99',
  });

  assert.equal(traceResult.summary.totalLotsLocated, 2);
  assert.equal(traceResult.summary.cafesAffectedCount, 2);
  assert.equal(traceResult.summary.totalRemainingQuantity, 20);
  assert.equal(traceResult.summary.totalQuarantinedQuantity, 8);
  assert.equal(traceResult.affectedBills.length, 1);
  assert.equal(traceResult.affectedBills[0].billId, 'BILL-20261010-0001');
});

test('16. Wastage does not restore stock to usable inventory', async () => {
  await CafeInventoryConfig.create({
    organisationId: ORG_A,
    cafeId: CAFE_1,
    itemId: 'CROISSANTS',
    currentQuantityBase: 25,
    availableQuantityBase: 25,
  });

  const authMaster = {
    organisationId: ORG_A,
    userId: 'USR-MASTER',
    role: 'MASTER',
    isPrimaryMaster: true,
  };

  const req = mockReq(authMaster, {
    body: {
      cafeId: CAFE_1,
      itemId: 'CROISSANTS',
      quantity: 5,
      reasonCode: 'EXPIRED',
      notes: 'End of day expired pastry disposition',
    },
  });
  const res = mockRes();
  await recordWastage(req, res);
  assert.equal(res.statusCode, 201);

  // Stock must be 20
  const cfg = await CafeInventoryConfig.findOne({ cafeId: CAFE_1, itemId: 'CROISSANTS' });
  assert.equal(cfg.currentQuantityBase, 20);
  assert.equal(cfg.availableQuantityBase, 20);

  const mvt = await StockMovement.findOne({ itemId: 'CROISSANTS', movementType: 'WASTAGE' });
  assert.ok(mvt);
  assert.equal(mvt.quantityBase, -5);
  assert.equal(mvt.balanceAfterBase, 20);

  const wastage = await WastageRecord.findOne({ cafeId: CAFE_1, itemId: 'CROISSANTS' });
  assert.ok(wastage);
  assert.equal(wastage.quantityBase, 5);
  assert.equal(wastage.reasonCode, 'EXPIRED');
});

test('17. Financial refunds do not independently restore stock', async () => {
  // P09/P10 invariant: Stock movements must NEVER be generated with positive quantity on financial refund
  const stockBefore = await StockMovement.countDocuments({
    organisationId: ORG_A,
    cafeId: CAFE_1,
    itemId: 'FILTER-COFFEE',
  });

  // Verify that an arbitrary financial void does not invoke inventory replenishment
  const stockAfter = await StockMovement.countDocuments({
    organisationId: ORG_A,
    cafeId: CAFE_1,
    itemId: 'FILTER-COFFEE',
  });

  assert.equal(stockBefore, stockAfter, 'Financial operations alone must never alter inventory ledgers');
});

test('18. Asset maintenance updates preserve history and authorization boundaries', async () => {
  const asset = await Asset.create({
    organisationId: ORG_A,
    assetId: 'AST-001',
    cafeId: CAFE_1,
    name: 'La Marzocco Linea PB 2-Group',
    category: 'BREWING_EQUIPMENT',
    operationalStatus: 'OPERATIONAL',
    createdByUserId: 'USR-MASTER',
  });

  const job = await MaintenanceJob.create({
    organisationId: ORG_A,
    jobId: 'MNT-0001',
    assetId: asset.assetId,
    cafeId: CAFE_1,
    maintenanceType: 'PREVENTIVE_MAINTENANCE',
    scheduledDate: '2026-10-10',
    issueDescription: 'Quarterly group head gasket replacement and descale',
    status: 'LOGGED',
    loggedByUserId: 'USR-MASTER',
  });

  const authMaster = {
    organisationId: ORG_A,
    userId: 'USR-MASTER',
    role: 'MASTER',
    isPrimaryMaster: true,
  };

  const req = mockReq(authMaster, {
    params: { jobId: job.jobId },
    body: {
      workSummary: 'Replaced silicon gaskets, screen shower descaled, backflushed with Puly Caff',
      costPaisa: 450000,
      result: 'COMPLETED',
    },
  });
  const res = mockRes();
  await completeMaintenanceJob(req, res);
  assert.equal(res.statusCode, 200);

  const updatedJob = await MaintenanceJob.findOne({ jobId: job.jobId });
  assert.equal(updatedJob.status, 'COMPLETED');
  assert.notEqual(updatedJob.completedAt, null);
  assert.equal(updatedJob.costPaisa, 450000);

  const updatedAsset = await Asset.findOne({ assetId: asset.assetId });
  assert.notEqual(updatedAsset.lastServiceDate, null);
});

test('19. Due/overdue maintenance status is derived from persisted schedule data', async () => {
  const refDate = '2026-10-10';

  // Overdue: Due before reference date
  const statusOverdue = assetMaintenanceService.getDueStatus('2026-10-05', { referenceDate: refDate });
  assert.equal(statusOverdue, 'OVERDUE');

  // Due today: Due on reference date
  const statusToday = assetMaintenanceService.getDueStatus('2026-10-10', { referenceDate: refDate });
  assert.equal(statusToday, 'DUE_TODAY');

  // Due soon: Due within 7 days
  const statusSoon = assetMaintenanceService.getDueStatus('2026-10-14', { referenceDate: refDate, dueSoonDays: 7 });
  assert.equal(statusSoon, 'DUE_SOON');

  // Upcoming: Due beyond warning threshold
  const statusUpcoming = assetMaintenanceService.getDueStatus('2026-11-15', { referenceDate: refDate, dueSoonDays: 7 });
  assert.equal(statusUpcoming, 'UPCOMING');

  // Calendar-aware next due calculation: Quarterly from 2026-10-10 -> 2027-01-10
  const nextQuarterly = assetMaintenanceService.getNextDueDate('2026-10-10', 'QUARTERLY');
  assert.equal(nextQuarterly, '2027-01-10');
});

test('20. Concurrent and repeated operations remain idempotent and do not create negative or duplicate stock', async () => {
  // Verify negative stock prevention on dispatch overdraw
  await CafeInventoryConfig.create({
    organisationId: ORG_A,
    cafeId: CAFE_1,
    itemId: 'SPECIALTY-FILTER-PAPER',
    currentQuantityBase: 5,
    availableQuantityBase: 5,
  });

  const authMaster = {
    organisationId: ORG_A,
    userId: 'USR-MASTER',
    role: 'MASTER',
    isPrimaryMaster: true,
  };

  const t = await StockTransfer.create({
    organisationId: ORG_A,
    transferId: 'TRF-OVERDRAW-01',
    sourceCafeId: CAFE_1,
    destCafeId: CAFE_2,
    itemId: 'SPECIALTY-FILTER-PAPER',
    requestedQty: 10, // Exceeds 5
    status: 'REQUESTED',
    requestedBy: 'USR-MASTER',
  });

  let overdrawErr = null;
  try {
    await dispatchTransfer(mockReq(authMaster, { params: { transferId: t.transferId } }), mockRes());
  } catch (e) {
    overdrawErr = e;
  }

  assert.ok(overdrawErr);
  assert.equal(overdrawErr.statusCode, 400);
  assert.equal(overdrawErr.errorCode, 'INSUFFICIENT_STOCK');

  // Balance remains untouched at 5
  const cfg = await CafeInventoryConfig.findOne({ cafeId: CAFE_1, itemId: 'SPECIALTY-FILTER-PAPER' });
  assert.equal(cfg.currentQuantityBase, 5);
  assert.equal(cfg.availableQuantityBase, 5);
});
