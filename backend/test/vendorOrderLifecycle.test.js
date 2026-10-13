'use strict';

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryReplSet } = require('mongodb-memory-server');

const { User } = require('../src/models/User');
const { PurchaseOrder } = require('../src/models/PurchaseOrder');
const { Vendor } = require('../src/models/Vendor');
const { GlobalInventoryItem } = require('../src/models/GlobalInventoryItem');
const { CafeInventoryConfig } = require('../src/models/CafeInventoryConfig');
const { StockMovement } = require('../src/models/StockMovement');
const { InventoryLot } = require('../src/models/InventoryLot');
const { Notification } = require('../src/models/Notification');
const procurementController = require('../src/controllers/procurementController');

const ORG_ID = 'ORG-ZAMORIN';
const CAFE_ID = 'CAFE-PATIO-01';
const VENDOR_ID = 'VEN-9001';

const MASTER_AUTH = {
  userId: 'MU-1001',
  role: 'MASTER',
  isPrimaryMaster: true,
  organisationId: ORG_ID,
  assignedCafeIds: [],
};

const CASHIER_AUTH = {
  userId: 'ST-1001',
  role: 'STAFF',
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

describe('VENDOR ORDER LIFECYCLE: Cashier Placement, Delivery Verification, Auto-Inventory & Master Approval', () => {
  before(async () => {
    mongoReplSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(mongoReplSet.getUri());

    // Pre-create all collections to prevent transient catalog changes during transactions
    const colls = [
      'audit_events',
      'purchase_orders',
      'notifications',
      'cafe_inventory_configs',
      'stock_movements',
      'inventory_lots',
      'users',
      'vendors',
      'global_inventory_items',
      'sequence_counters',
    ];
    for (const c of colls) {
      try {
        await mongoose.connection.createCollection(c);
      } catch {}
    }
  });

  after(async () => {
    await mongoose.disconnect();
    await mongoReplSet.stop();
  });

  beforeEach(async () => {
    await User.deleteMany({});
    await PurchaseOrder.deleteMany({});
    await Vendor.deleteMany({});
    await GlobalInventoryItem.deleteMany({});
    await CafeInventoryConfig.deleteMany({});
    await StockMovement.deleteMany({});
    await InventoryLot.deleteMany({});
    await Notification.deleteMany({});

    // Seed master user
    await User.create({
      userId: 'MU-1001',
      organisationId: ORG_ID,
      name: 'Primary Master',
      email: 'master@zamorin.cafe',
      role: 'MASTER',
      isPrimaryMaster: true,
      accountStatus: 'ACTIVE',
      assignedCafeIds: [],
      passwordHash: 'hashed_pw',
      createdBy: 'SYSTEM',
    });

    // Seed cashier user
    await User.create({
      userId: 'ST-1001',
      organisationId: ORG_ID,
      name: 'Patio Cashier',
      email: 'cashier@zamorin.cafe',
      role: 'STAFF',
      accountStatus: 'ACTIVE',
      assignedCafeIds: [CAFE_ID],
      passwordHash: 'hashed_pw',
      createdBy: 'SYSTEM',
    });

    // Seed active vendor
    await Vendor.create({
      vendorId: VENDOR_ID,
      organisationId: ORG_ID,
      name: 'Malabar Fresh Dairy',
      nameLower: 'malabar fresh dairy',
      supplierType: 'GOODS',
      category: 'FOOD_BEVERAGE',
      createdByUserId: 'MU-1001',
      status: 'ACTIVE',
      itemCatalogue: [
        { itemId: 'ITM-MILK-01', currentPricePaisa: 6000, moq: 1, status: 'ACTIVE' },
        { itemId: 'ITM-CREAM-01', currentPricePaisa: 12000, moq: 1, status: 'ACTIVE' },
      ],
    });

    // Seed active items
    await GlobalInventoryItem.create([
      {
        itemId: 'ITM-MILK-01',
        sku: 'SKU-MILK-01',
        organisationId: ORG_ID,
        name: 'Whole Buffalo Milk 1L',
        category: 'DAIRY_FRESH',
        baseUnit: 'liter',
        unitCostPaisa: 6000,
        createdByUserId: 'MU-1001',
        status: 'ACTIVE',
      },
      {
        itemId: 'ITM-CREAM-01',
        sku: 'SKU-CREAM-01',
        organisationId: ORG_ID,
        name: 'Whipping Cream 500ml',
        category: 'DAIRY_FRESH',
        baseUnit: 'pack',
        unitCostPaisa: 12000,
        createdByUserId: 'MU-1001',
        status: 'ACTIVE',
      },
    ]);
  });

  it('1. Cashier creates new vendor order request for next day: order is SUBMITTED and Master receives notification', async () => {
    const req = {
      auth: CASHIER_AUTH,
      body: {
        cafeId: CAFE_ID,
        vendorId: VENDOR_ID,
        status: 'SUBMITTED',
        submitDirectly: true,
        expectedDeliveryDate: '2026-09-21',
        lineItems: [
          { itemId: 'ITM-MILK-01', orderedQuantityBase: 20, unitPricePaisa: 6000 },
          { itemId: 'ITM-CREAM-01', orderedQuantityBase: 10, unitPricePaisa: 12000 },
        ],
        notes: 'Delivery required early morning at 6:30 AM',
      },
    };
    const res = createMockResponse();

    await invoke(procurementController.createOrder, req, res);

    assert.strictEqual(res.statusCode, 201);
    assert.strictEqual(res.body.success, true);
    const order = res.body.data.order;
    assert.strictEqual(order.status, 'SUBMITTED');
    assert.strictEqual(order.cafeId, CAFE_ID);
    assert.strictEqual(order.editCountBeforeApproval, 0);
    assert.strictEqual(order.editCountAfterApproval, 0);

    // Master notification verification
    const notif = await Notification.findOne({
      organisationId: ORG_ID,
      recipientUserId: 'MU-1001',
      sourceEntityId: order.purchaseOrderId,
    });
    assert.ok(notif, 'Master must receive notification when order request is created');
    assert.match(notif.title, /New Order Request/);
  });

  it('2. Cashier edits order request BEFORE approval: editCountBeforeApproval increments, Master notified', async () => {
    // 1. Create order
    const createReq = {
      auth: CASHIER_AUTH,
      body: {
        cafeId: CAFE_ID,
        vendorId: VENDOR_ID,
        status: 'SUBMITTED',
        lineItems: [{ itemId: 'ITM-MILK-01', orderedQuantityBase: 15, unitPricePaisa: 6000 }],
      },
    };
    const createRes = createMockResponse();
    await invoke(procurementController.createOrder, createReq, createRes);
    const poId = createRes.body.data.order.purchaseOrderId;

    // 2. Edit before approval
    const editReq = {
      auth: CASHIER_AUTH,
      params: { purchaseOrderId: poId },
      body: {
        lineItems: [{ itemId: 'ITM-MILK-01', orderedQuantityBase: 25, unitPricePaisa: 6000 }],
        reason: 'Increased footfall expectation for tomorrow',
      },
    };
    const editRes = createMockResponse();
    await invoke(procurementController.editOrder, editReq, editRes);

    assert.strictEqual(editRes.statusCode, 200);
    const updated = editRes.body.data.order;
    assert.strictEqual(updated.editCountBeforeApproval, 1);
    assert.strictEqual(updated.editCountAfterApproval, 0);
    assert.strictEqual(updated.needsReapproval, false);
    assert.strictEqual(updated.lineItems[0].orderedQuantityBase, 25);
    assert.strictEqual(updated.editHistory.length, 1);
    assert.strictEqual(updated.editHistory[0].reason, 'Increased footfall expectation for tomorrow');
    assert.strictEqual(updated.editHistory[0].wasApproved, false);
  });

  it('3. Master approves order, then Cashier edits AFTER approval: editCountAfterApproval increments, approval revoked, re-approval mandated', async () => {
    // 1. Create order
    const createReq = {
      auth: CASHIER_AUTH,
      body: {
        cafeId: CAFE_ID,
        vendorId: VENDOR_ID,
        status: 'SUBMITTED',
        lineItems: [{ itemId: 'ITM-MILK-01', orderedQuantityBase: 20, unitPricePaisa: 6000 }],
      },
    };
    const createRes = createMockResponse();
    await invoke(procurementController.createOrder, createReq, createRes);
    const poId = createRes.body.data.order.purchaseOrderId;

    // 2. Master approves order
    const approveReq = {
      auth: MASTER_AUTH,
      params: { purchaseOrderId: poId },
      body: { notes: 'Initial approval by Master' },
    };
    const approveRes = createMockResponse();
    await invoke(procurementController.approveOrder, approveReq, approveRes);
    assert.strictEqual(approveRes.body.data.order.status, 'APPROVED');

    // 3. Cashier edits order AFTER approval
    const editReq = {
      auth: CASHIER_AUTH,
      params: { purchaseOrderId: poId },
      body: {
        lineItems: [{ itemId: 'ITM-MILK-01', orderedQuantityBase: 30, unitPricePaisa: 6000 }],
        reason: 'Chef requested 10 extra liters',
      },
    };
    const editRes = createMockResponse();
    await invoke(procurementController.editOrder, editReq, editRes);

    assert.strictEqual(editRes.statusCode, 200);
    const rechecked = editRes.body.data.order;
    assert.strictEqual(rechecked.editCountBeforeApproval, 0);
    assert.strictEqual(rechecked.editCountAfterApproval, 1);
    assert.strictEqual(rechecked.needsReapproval, true, 'Order edited after approval must require re-approval');
    assert.strictEqual(rechecked.status, 'SUBMITTED', 'Order status must revert from APPROVED to SUBMITTED');
    assert.strictEqual(rechecked.masterApproval.approvedAt, null, 'Previous approval must be wiped');
    assert.strictEqual(rechecked.editHistory[0].wasApproved, true);

    // Verify urgent alert notification to Master
    const alertNotif = await Notification.findOne({
      organisationId: ORG_ID,
      recipientUserId: 'MU-1001',
      title: new RegExp(`Approved Order Edited: ${poId}`),
    });
    assert.ok(alertNotif, 'Master must receive urgent notification of post-approval modification');
    assert.strictEqual(alertNotif.priority, 'HIGH');
  });

  it('4. Delivery Verification & Document Submission: auto-adds to inventory, records missing item, attaches vendor bill, alerts Master', async () => {
    // 1. Create order
    const createReq = {
      auth: CASHIER_AUTH,
      body: {
        cafeId: CAFE_ID,
        vendorId: VENDOR_ID,
        status: 'SUBMITTED',
        lineItems: [
          { itemId: 'ITM-MILK-01', orderedQuantityBase: 20, unitPricePaisa: 6000 },
          { itemId: 'ITM-CREAM-01', orderedQuantityBase: 10, unitPricePaisa: 12000 },
        ],
      },
    };
    const createRes = createMockResponse();
    await invoke(procurementController.createOrder, createReq, createRes);
    const poId = createRes.body.data.order.purchaseOrderId;

    // Check initial stock
    const initMilkStock = await CafeInventoryConfig.findOne({ organisationId: ORG_ID, cafeId: CAFE_ID, itemId: 'ITM-MILK-01' });
    assert.strictEqual(initMilkStock, null);

    // 2. Vendor delivers: Cashier counts items
    // Milk: ordered 20, delivered 20, accepted 20.
    // Cream: ordered 10, delivered 7, accepted 7 (3 missing / short!).
    // Cashier attaches vendor bill in base64 (PDF/JPEG)
    const dummyBillBase64 = Buffer.from('%PDF-1.4 Mock Vendor Invoice 9841').toString('base64');

    const verifyReq = {
      auth: CASHIER_AUTH,
      params: { purchaseOrderId: poId },
      body: {
        deliveryNoteNumber: 'DN-9941',
        vendorInvoiceNumber: 'INV-2026-0941',
        fileName: 'vendor_tax_bill_9841.pdf',
        fileType: 'application/pdf',
        fileBase64: dummyBillBase64,
        notes: 'Cream crate delivered with 3 units missing from vendor packaging',
        deliveries: [
          {
            itemId: 'ITM-MILK-01',
            deliveredQty: 20,
            acceptedQty: 20,
            rejectedQty: 0,
            lotNumber: 'LOT-MILK-001',
          },
          {
            itemId: 'ITM-CREAM-01',
            deliveredQty: 7,
            acceptedQty: 7,
            rejectedQty: 0,
            discrepancyReason: 'Vendor truck shortage - only 7 packs supplied',
            lotNumber: 'LOT-CREAM-001',
          },
        ],
      },
    };
    const verifyRes = createMockResponse();
    await invoke(procurementController.verifyDeliveryAndSubmitBill, verifyReq, verifyRes);

    assert.strictEqual(verifyRes.statusCode, 200);
    const verifiedOrder = verifyRes.body.data.order;
    assert.strictEqual(verifiedOrder.status, 'VERIFIED_PENDING_MASTER_APPROVAL');
    assert.strictEqual(verifiedOrder.receiptAttachments.length, 1);
    assert.strictEqual(verifiedOrder.receiptAttachments[0].filename, 'vendor_tax_bill_9841.pdf');

    // DUAL ACTION 1: Inventory stock automatically updated!
    const milkStock = await CafeInventoryConfig.findOne({ organisationId: ORG_ID, cafeId: CAFE_ID, itemId: 'ITM-MILK-01' });
    assert.ok(milkStock);
    assert.strictEqual(milkStock.currentQuantityBase, 20);

    const creamStock = await CafeInventoryConfig.findOne({ organisationId: ORG_ID, cafeId: CAFE_ID, itemId: 'ITM-CREAM-01' });
    assert.ok(creamStock);
    assert.strictEqual(creamStock.currentQuantityBase, 7);

    // Stock movements recorded
    const movements = await StockMovement.find({ organisationId: ORG_ID, referenceId: poId });
    assert.strictEqual(movements.length, 2);
    assert.strictEqual(movements[0].movementType, 'RECEIPT');

    // Available inventory lots created
    const lots = await InventoryLot.find({ organisationId: ORG_ID, procurementReference: poId });
    assert.strictEqual(lots.length, 2);
    assert.strictEqual(lots[0].status, 'AVAILABLE');

    // DUAL ACTION 2: Master window receives notification with delivery & bill details
    const masterNotif = await Notification.findOne({
      organisationId: ORG_ID,
      recipientUserId: 'MU-1001',
      title: new RegExp(`Delivery Verified: ${poId}`),
    });
    assert.ok(masterNotif, 'Master must receive notification when delivery is verified with bill');
    assert.match(masterNotif.message, /3 units reported missing\/short/);
    assert.match(masterNotif.message, /Vendor bill\/receipt attached/);

    // Check GRN record items missingQty
    const grn = verifiedOrder.grnReceipts[0];
    const creamGrnItem = grn.items.find((i) => i.itemId === 'ITM-CREAM-01');
    assert.strictEqual(creamGrnItem.missingQty, 3);
    assert.strictEqual(creamGrnItem.discrepancyReason, 'Vendor truck shortage - only 7 packs supplied');
  });

  it('5. Master downloads attached bill file for accounts handoff and approves order: order process completes', async () => {
    // 1. Create and verify order with bill
    const createReq = {
      auth: CASHIER_AUTH,
      body: {
        cafeId: CAFE_ID,
        vendorId: VENDOR_ID,
        status: 'SUBMITTED',
        lineItems: [{ itemId: 'ITM-MILK-01', orderedQuantityBase: 10, unitPricePaisa: 6000 }],
      },
    };
    const createRes = createMockResponse();
    await invoke(procurementController.createOrder, createReq, createRes);
    const poId = createRes.body.data.order.purchaseOrderId;

    const dummyBillBase64 = Buffer.from('%PDF-1.4 Zamorin Accounts Invoice 101').toString('base64');
    const verifyReq = {
      auth: CASHIER_AUTH,
      params: { purchaseOrderId: poId },
      body: {
        fileName: 'vendor_invoice_101.pdf',
        fileType: 'application/pdf',
        fileBase64: dummyBillBase64,
        deliveries: [{ itemId: 'ITM-MILK-01', deliveredQty: 10, acceptedQty: 10 }],
      },
    };
    await invoke(procurementController.verifyDeliveryAndSubmitBill, verifyReq, createMockResponse());

    // 2. Master downloads attached vendor bill for accounts handoff
    const downloadReq = {
      auth: MASTER_AUTH,
      params: { purchaseOrderId: poId },
    };
    const downloadRes = createMockResponse();
    await invoke(procurementController.downloadOrderReceiptBill, downloadReq, downloadRes);

    assert.strictEqual(downloadRes.statusCode, 200);
    assert.strictEqual(downloadRes.headers['Content-Type'], 'application/pdf');
    assert.match(downloadRes.headers['Content-Disposition'], /vendor_invoice_101\.pdf/);
    assert.ok(downloadRes.body, 'Downloaded file body must be present for accounts handoff');

    // 3. Master approves the order and attached bill
    const approveReq = {
      auth: MASTER_AUTH,
      params: { purchaseOrderId: poId },
      body: { notes: 'Verified counts and vendor invoice. Approved for accounts payment.' },
    };
    const approveRes = createMockResponse();
    await invoke(procurementController.masterApproveOrderAndBill, approveReq, approveRes);

    assert.strictEqual(approveRes.statusCode, 200);
    const finalOrder = approveRes.body.data.order;
    assert.strictEqual(finalOrder.status, 'CLOSED', 'Fulfilled and approved order moves to CLOSED');
    assert.strictEqual(finalOrder.masterApproval.approvedByUserId, 'MU-1001');
    assert.strictEqual(finalOrder.needsReapproval, false);
  });
});
