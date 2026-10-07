'use strict';

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryReplSet } = require('mongodb-memory-server');

const { PurchaseOrder } = require('../src/models/PurchaseOrder');
const { Vendor } = require('../src/models/Vendor');
const { GlobalInventoryItem } = require('../src/models/GlobalInventoryItem');
const { CafeInventoryConfig } = require('../src/models/CafeInventoryConfig');
const { StockMovement } = require('../src/models/StockMovement');
const { InventoryLot } = require('../src/models/InventoryLot');
const { Notification } = require('../src/models/Notification');
const { IdempotencyRecord } = require('../src/models/IdempotencyRecord');
const { SequenceCounter } = require('../src/models/SequenceCounter');
const procurementController = require('../src/controllers/procurementController');
const { ApiError } = require('../src/utils/ApiError');

const ORG_ID = 'ORG-ZAMORIN';
const CAFE_ID = 'CAFE-PATIO-01';
const VENDOR_ID = 'VEN-9001';

const STAFF_AUTH = {
  userId: 'ST-1001',
  role: 'STAFF',
  organisationId: ORG_ID,
  assignedCafeIds: [CAFE_ID],
};

const MASTER_AUTH = {
  userId: 'MU-1001',
  role: 'MASTER',
  isPrimaryMaster: true,
  organisationId: ORG_ID,
  assignedCafeIds: [CAFE_ID],
};

let mongoReplSet;

function createMockResponse() {
  const res = {
    statusCode: 200,
    headers: {},
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    setHeader(name, val) {
      this.headers[name] = val;
      return this;
    },
    json(data) {
      this.body = data;
      return this;
    },
    send(data) {
      this.body = data;
      return this;
    },
  };
  return res;
}

async function invoke(controllerFn, req, res) {
  return new Promise((resolve, reject) => {
    const next = (err) => (err ? reject(err) : resolve());
    Promise.resolve(controllerFn(req, res, next)).then(resolve).catch(reject);
  });
}

describe('P0-D & P1-A: GRN Idempotency & Mandatory Discrepancy Enforcement', () => {
  before(async () => {
    mongoReplSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(mongoReplSet.getUri());

    await StockMovement.createCollection().catch(() => {});
    await InventoryLot.createCollection().catch(() => {});
    await CafeInventoryConfig.createCollection().catch(() => {});
    await PurchaseOrder.createCollection().catch(() => {});
    await IdempotencyRecord.createCollection().catch(() => {});
    await SequenceCounter.createCollection().catch(() => {});
    await Notification.createCollection().catch(() => {});
    await GlobalInventoryItem.createCollection().catch(() => {});
    await Vendor.createCollection().catch(() => {});

    await GlobalInventoryItem.create({
      itemId: 'ITM-MILK-01',
      sku: 'SKU-MILK-01',
      name: 'Organic Full Cream Milk',
      category: 'DAIRY_FRESH',
      organisationId: ORG_ID,
      baseUnit: 'litres',
      unitCostPaisa: 6000,
      createdByUserId: 'MU-1001',
      status: 'ACTIVE',
    });

    await GlobalInventoryItem.create({
      itemId: 'ITM-COFFEE-01',
      sku: 'SKU-COFFEE-01',
      name: 'Estate Arabica Beans',
      category: 'DAIRY_FRESH',
      organisationId: ORG_ID,
      baseUnit: 'kg',
      unitCostPaisa: 120000,
      createdByUserId: 'MU-1001',
      status: 'ACTIVE',
    });

    await Vendor.create({
      vendorId: VENDOR_ID,
      organisationId: ORG_ID,
      name: 'Malabar Dairy & Farm Co',
      supplierType: 'GOODS',
      category: 'FOOD_BEVERAGE',
      createdByUserId: 'MU-1001',
      status: 'ACTIVE',
      assignedCafeIds: [CAFE_ID],
    });
  });

  after(async () => {
    await mongoose.disconnect();
    if (mongoReplSet) await mongoReplSet.stop();
  });

  beforeEach(async () => {
    await PurchaseOrder.deleteMany({});
    await StockMovement.deleteMany({});
    await InventoryLot.deleteMany({});
    await CafeInventoryConfig.deleteMany({});
    await Notification.deleteMany({});
    await IdempotencyRecord.deleteMany({});
    await SequenceCounter.deleteMany({});
  });

  async function createApprovedPo(poId = 'PO-TEST-001', lineItems = null) {
    const defaultLines = [
      {
        itemId: 'ITM-MILK-01',
        orderedQuantityBase: 20,
        unitPricePaisa: 6000,
        totalLinePaisa: 120000,
        baseUnit: 'litres',
      },
    ];

    return await PurchaseOrder.create({
      purchaseOrderId: poId,
      organisationId: ORG_ID,
      cafeId: CAFE_ID,
      vendorId: VENDOR_ID,
      status: 'APPROVED',
      orderDate: '2026-10-05',
      expectedDeliveryDate: '2026-10-06',
      totalPaisa: 120000,
      lineItems: lineItems || defaultLines,
      createdByUserId: STAFF_AUTH.userId,
    });
  }

  // ──────────────────────────────────────────────────────────────────────────
  // P1-A: DISCREPANCY REASON ENFORCEMENT TESTS
  // ──────────────────────────────────────────────────────────────────────────

  it('P1-A.1: Fails with 422 DISCREPANCY_REASON_REQUIRED when delivery quantity is short and reason is missing', async () => {
    await createApprovedPo('PO-DISC-01');

    const verifyReq = {
      auth: STAFF_AUTH,
      params: { purchaseOrderId: 'PO-DISC-01' },
      body: {
        deliveryNoteNumber: 'DN-1001',
        deliveries: [
          {
            itemId: 'ITM-MILK-01',
            deliveredQty: 15, // Ordered: 20 -> Shortage of 5
            acceptedQty: 15,
            rejectedQty: 0,
            // discrepancyReason omitted!
          },
        ],
      },
    };

    let errorThrown = null;
    try {
      await invoke(procurementController.verifyDeliveryAndSubmitBill, verifyReq, createMockResponse());
    } catch (err) {
      errorThrown = err;
    }

    assert.ok(errorThrown, 'Must throw error when discrepancy reason is missing');
    assert.strictEqual(errorThrown.statusCode, 422);
    assert.strictEqual(errorThrown.code, 'DISCREPANCY_REASON_REQUIRED');
    assert.match(errorThrown.message, /discrepancy reason is required/i);

    // Verify ZERO inventory updates took place
    const stock = await CafeInventoryConfig.findOne({ organisationId: ORG_ID, itemId: 'ITM-MILK-01' });
    assert.strictEqual(stock, null);
    const movements = await StockMovement.find({ organisationId: ORG_ID });
    assert.strictEqual(movements.length, 0);
  });

  it('P1-A.2: Fails with 422 DISCREPANCY_REASON_REQUIRED when items are rejected and rejection reason is empty string', async () => {
    await createApprovedPo('PO-DISC-02');

    const verifyReq = {
      auth: STAFF_AUTH,
      params: { purchaseOrderId: 'PO-DISC-02' },
      body: {
        deliveryNoteNumber: 'DN-1002',
        deliveries: [
          {
            itemId: 'ITM-MILK-01',
            deliveredQty: 20,
            acceptedQty: 18,
            rejectedQty: 2,
            discrepancyReason: '   ', // whitespace only
          },
        ],
      },
    };

    let errorThrown = null;
    try {
      await invoke(procurementController.verifyDeliveryAndSubmitBill, verifyReq, createMockResponse());
    } catch (err) {
      errorThrown = err;
    }

    assert.ok(errorThrown, 'Must throw error for whitespace discrepancy reason');
    assert.strictEqual(errorThrown.statusCode, 422);
    assert.strictEqual(errorThrown.code, 'DISCREPANCY_REASON_REQUIRED');
  });

  it('P1-A.3: Succeeds when discrepancy reason is explicitly provided for short delivery', async () => {
    await createApprovedPo('PO-DISC-03');

    const verifyReq = {
      auth: STAFF_AUTH,
      params: { purchaseOrderId: 'PO-DISC-03' },
      body: {
        deliveryNoteNumber: 'DN-1003',
        deliveries: [
          {
            itemId: 'ITM-MILK-01',
            deliveredQty: 14,
            acceptedQty: 14,
            rejectedQty: 0,
            discrepancyReason: 'Supplier morning dairy run was short by 6 crates',
          },
        ],
      },
    };

    const res = createMockResponse();
    await invoke(procurementController.verifyDeliveryAndSubmitBill, verifyReq, res);

    assert.strictEqual(res.statusCode, 200);
    const grnItem = res.body.data.grn.items.find((i) => i.itemId === 'ITM-MILK-01');
    assert.strictEqual(grnItem.missingQty, 6);
    assert.strictEqual(grnItem.discrepancyReason, 'Supplier morning dairy run was short by 6 crates');

    // Inventory correctly incremented by accepted quantity (14)
    const stock = await CafeInventoryConfig.findOne({ organisationId: ORG_ID, itemId: 'ITM-MILK-01' });
    assert.strictEqual(stock.currentQuantityBase, 14);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // P0-D: GRN IDEMPOTENCY & REPLAY TESTS
  // ──────────────────────────────────────────────────────────────────────────

  it('P0-D.1: First delivery request creates IdempotencyRecord, updates inventory, and posts stock movements', async () => {
    await createApprovedPo('PO-IDEM-01');

    const verifyReq = {
      auth: STAFF_AUTH,
      params: { purchaseOrderId: 'PO-IDEM-01' },
      body: {
        deliveryNoteNumber: 'DN-9901',
        deliveries: [
          {
            itemId: 'ITM-MILK-01',
            deliveredQty: 20,
            acceptedQty: 20,
            rejectedQty: 0,
          },
        ],
      },
    };

    const res = createMockResponse();
    await invoke(procurementController.verifyDeliveryAndSubmitBill, verifyReq, res);

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.success, true);

    // Verify IdempotencyRecord status is COMPLETED
    const idemRecord = await IdempotencyRecord.findOne({
      organisationId: ORG_ID,
      cafeId: CAFE_ID,
      idempotencyKey: `GRN:PO-IDEM-01:DN-9901:0`,
    });
    assert.ok(idemRecord, 'Authoritative idempotency record must exist in MongoDB');
    assert.strictEqual(idemRecord.status, 'COMPLETED');
    assert.ok(idemRecord.responseSnapshot, 'Snapshot response must be durably stored');

    // Verify single inventory increment
    const stock = await CafeInventoryConfig.findOne({ organisationId: ORG_ID, itemId: 'ITM-MILK-01' });
    assert.strictEqual(stock.currentQuantityBase, 20);

    const movements = await StockMovement.find({ organisationId: ORG_ID, referenceId: 'PO-IDEM-01' });
    assert.strictEqual(movements.length, 1);
  });

  it('P0-D.2: Replaying the same delivery request returns original result with ZERO additional inventory mutation', async () => {
    await createApprovedPo('PO-IDEM-02');

    const verifyReq = {
      auth: STAFF_AUTH,
      params: { purchaseOrderId: 'PO-IDEM-02' },
      body: {
        deliveryNoteNumber: 'DN-9902',
        deliveries: [
          {
            itemId: 'ITM-MILK-01',
            deliveredQty: 20,
            acceptedQty: 20,
          },
        ],
      },
    };

    // First Request
    const res1 = createMockResponse();
    await invoke(procurementController.verifyDeliveryAndSubmitBill, verifyReq, res1);
    assert.strictEqual(res1.statusCode, 200);
    const originalGrnId = res1.body.data.grn.grnId;

    // Retry / Second Request (Client timed out or network drop after server commit)
    const res2 = createMockResponse();
    await invoke(procurementController.verifyDeliveryAndSubmitBill, verifyReq, res2);

    assert.strictEqual(res2.statusCode, 200);
    assert.strictEqual(res2.body.isIdempotentReplay, true, 'Retry must be marked as idempotent replay');
    assert.strictEqual(res2.body.data.grn.grnId, originalGrnId, 'Replay must return exact same GRN record');

    // Authoritative Invariants: NO DUPLICATE INVENTORY MUTATION
    const stock = await CafeInventoryConfig.findOne({ organisationId: ORG_ID, itemId: 'ITM-MILK-01' });
    assert.strictEqual(stock.currentQuantityBase, 20, 'Stock must remain 20 and NOT increment to 40');

    const movements = await StockMovement.find({ organisationId: ORG_ID, referenceId: 'PO-IDEM-02' });
    assert.strictEqual(movements.length, 1, 'Only one stock movement must exist; duplicates strictly blocked');

    const lots = await InventoryLot.find({ organisationId: ORG_ID, procurementReference: 'PO-IDEM-02' });
    assert.strictEqual(lots.length, 1, 'Only one lot must exist');

    const updatedPo = await PurchaseOrder.findOne({ purchaseOrderId: 'PO-IDEM-02' });
    assert.strictEqual(updatedPo.grnReceipts.length, 1, 'Only one GRN receipt must be logged on PO');
  });

  it('P0-D.3: Simultaneous duplicate request while operation is PROCESSING is safely rejected with 409 conflict', async () => {
    await createApprovedPo('PO-IDEM-03');

    // Simulate concurrent request that is actively PROCESSING in another node/thread
    const lockKey = `GRN:PO-IDEM-03:DN-CONCURRENT:0`;
    await IdempotencyRecord.create({
      organisationId: ORG_ID,
      cafeId: CAFE_ID,
      idempotencyKey: lockKey,
      requestFingerprint: 'mock-fingerprint-in-flight',
      status: 'PROCESSING',
    });

    const verifyReq = {
      auth: STAFF_AUTH,
      params: { purchaseOrderId: 'PO-IDEM-03' },
      body: {
        deliveryNoteNumber: 'DN-CONCURRENT',
        deliveries: [{ itemId: 'ITM-MILK-01', deliveredQty: 20, acceptedQty: 20 }],
      },
    };

    let errorThrown = null;
    try {
      await invoke(procurementController.verifyDeliveryAndSubmitBill, verifyReq, createMockResponse());
    } catch (err) {
      errorThrown = err;
    }

    assert.ok(errorThrown, 'Simultaneous duplicate submission must be rejected');
    assert.strictEqual(errorThrown.statusCode, 409);
    assert.strictEqual(errorThrown.code, 'IDEMPOTENCY_CONFLICT');
  });

  it('P0-D.4: Edited or re-approved order increments version and allows legitimate subsequent delivery', async () => {
    const po = await createApprovedPo('PO-IDEM-04');

    // First delivery (version 0_0_0)
    const req1 = {
      auth: STAFF_AUTH,
      params: { purchaseOrderId: 'PO-IDEM-04' },
      body: {
        deliveryNoteNumber: 'DN-BATCH-1',
        deliveries: [
          {
            itemId: 'ITM-MILK-01',
            deliveredQty: 10,
            acceptedQty: 10,
            discrepancyReason: 'Partial delivery batch 1 of 2',
          },
        ],
      },
    };
    const res1 = createMockResponse();
    await invoke(procurementController.verifyDeliveryAndSubmitBill, req1, res1);
    assert.strictEqual(res1.statusCode, 200);

    // After approval, PO is re-approved and second batch arrives (version becomes 0_0_1)
    const req2 = {
      auth: STAFF_AUTH,
      params: { purchaseOrderId: 'PO-IDEM-04' },
      body: {
        deliveryNoteNumber: 'DN-BATCH-2',
        deliveries: [
          {
            itemId: 'ITM-MILK-01',
            deliveredQty: 10,
            acceptedQty: 10,
            discrepancyReason: 'Remaining batch 2 of 2',
          },
        ],
      },
    };
    const res2 = createMockResponse();
    await invoke(procurementController.verifyDeliveryAndSubmitBill, req2, res2);
    assert.strictEqual(res2.statusCode, 200);

    // Total stock should now be 20 (10 + 10)
    const stock = await CafeInventoryConfig.findOne({ organisationId: ORG_ID, itemId: 'ITM-MILK-01' });
    assert.strictEqual(stock.currentQuantityBase, 20);

    const movements = await StockMovement.find({ organisationId: ORG_ID, referenceId: 'PO-IDEM-04' });
    assert.strictEqual(movements.length, 2);
  });
});
