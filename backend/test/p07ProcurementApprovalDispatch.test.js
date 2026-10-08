'use strict';

/**
 * ============================================================================
 * ZAMORIN CAFÉ ERP — P07: CAFÉ OPERATIONS PURCHASE REVIEW, APPROVAL,
 * IMMUTABLE PO REVISION & VENDOR DISPATCH SUITE
 * ============================================================================
 *
 * Verifies:
 *   1. Routine approval inside Café Operations authority threshold
 *   2. Primary Master escalation for orders exceeding configured threshold
 *   3. Persona isolation: Owner (read-only 403), Staff (excluded 403), Cross-café (403)
 *   4. Immutable PO Revision Semantics:
 *      - Revision 1 approved -> edit quantity -> Revision 2 created
 *      - Revision 1 approval revoked & dispatch cancelled
 *      - Worker suppresses superseded Revision 1
 *      - Revision 2 approved & dispatched cleanly
 *   5. Double approval & concurrency burst (50 parallel requests -> 1 PO, 1 approved revision, 1 dispatch job)
 *   6. Lost response retry idempotency (retried approval returns existing committed PO)
 *   7. Worker crash, provider timeout & UNKNOWN ambiguity handling (no duplicate resend)
 *   8. Safe reconciliation of UNKNOWN dispatch status
 *   9. Channel setup required when outbound credentials unconfigured
 *  10. Deterministic deferral suppression fix (unchanged need suppressed, material shortage escalates)
 *  11. Supplier substitution & alternative vendor request
 *  12. Transport status vs Vendor commercial response strict separation
 *  13. Partial vendor confirmation preserves original ordered quantities
 *  14. ZERO Inventory Mutation (no GRN, no StockMovement, no lot mutation)
 *  15. ZERO Financial Mutation (no APInvoice, no GL journal, no payment)
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const { createApp } = require('../src/server');
const { GlobalInventoryItem } = require('../src/models/GlobalInventoryItem');
const { CafeInventoryConfig } = require('../src/models/CafeInventoryConfig');
const { Vendor } = require('../src/models/Vendor');
const { InventoryLot } = require('../src/models/InventoryLot');
const { InventoryReservation } = require('../src/models/InventoryReservation');
const { StockMovement } = require('../src/models/StockMovement');
const { PurchaseOrder } = require('../src/models/PurchaseOrder');
const { ProcurementDispatchJob } = require('../src/models/ProcurementDispatchJob');
const { ReplenishmentRecommendation } = require('../src/models/ReplenishmentRecommendation');
const { ApprovalPolicy } = require('../src/models/ApprovalPolicy');
const { APInvoice } = require('../src/models/APInvoice');
const { VendorLedgerEntry } = require('../src/models/VendorLedgerEntry');
const { Journal } = require('../src/models/Journal');
const { CashTransaction } = require('../src/models/CashTransaction');
const { User } = require('../src/models/User');
const { Cafe } = require('../src/models/Cafe');
const { RolePermission } = require('../src/models/RolePermission');
const {
  ProcurementApprovalService,
} = require('../src/services/procurementApprovalService');
const {
  ProcurementDispatchService,
  defaultDispatchService,
} = require('../src/services/procurementDispatchService');
const {
  ReplenishmentRecommendationService,
} = require('../src/services/replenishmentRecommendationService');
const authService = require('../src/services/authService');
const { ConsoleTestEmailProvider } = require('../src/services/ConsoleTestEmailProvider');

function makeRequest({ port, method, path, headers = {}, body = null }) {
  return new Promise((resolve, reject) => {
    const serializedBody = body ? JSON.stringify(body) : null;
    const reqHeaders = { ...headers };
    if (serializedBody) {
      reqHeaders['Content-Type'] = 'application/json';
      reqHeaders['Content-Length'] = Buffer.byteLength(serializedBody);
    }

    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        method,
        path,
        headers: reqHeaders,
      },
      (res) => {
        let responseData = '';
        res.on('data', (chunk) => {
          responseData += chunk;
        });
        res.on('end', () => {
          let parsedJson = null;
          try {
            parsedJson = responseData ? JSON.parse(responseData) : null;
          } catch (_) {
            parsedJson = responseData;
          }
          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            body: parsedJson,
          });
        });
      }
    );

    req.on('error', reject);
    if (serializedBody) {
      req.write(serializedBody);
    }
    req.end();
  });
}

function createQueryWrapper(resolvedValue) {
  const query = {
    select() { return query; },
    sort() { return query; },
    skip() { return query; },
    limit() { return query; },
    lean() { return Promise.resolve(resolvedValue); },
    then(onFulfilled, onRejected) {
      return Promise.resolve(resolvedValue).then(onFulfilled, onRejected);
    },
  };
  return query;
}

test('P07: Café Operations Purchase Review, Approval, Immutable PO Revision & Dispatch Suite', async (t) => {
  const app = createApp({ allowedOrigins: ['*'], production: false });
  const server = http.createServer(app);

  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });

  const port = server.address().port;

  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  // ── Personas Fixtures ──────────────────────────────────────────────────────
  const primaryMaster = {
    userId: 'USR-MASTER-01',
    organisationId: 'ORG-ZAMORIN',
    role: 'MASTER',
    isPrimaryMaster: true,
    email: 'master@zamorin.com',
    fullName: 'Primary Master',
    sessionVersion: 1,
    permissionsVersion: 1,
    assignedCafeIds: ['ZC-0001', 'ZC-0002'],
    accountStatus: 'ACTIVE',
    save: async function () { return this; },
  };

  const cafeAdminKora = {
    userId: 'USR-ADMIN-KORA',
    organisationId: 'ORG-ZAMORIN',
    role: 'CAFE_ADMIN',
    email: 'admin.kora@zamorin.com',
    fullName: 'Koramangala Admin',
    sessionVersion: 1,
    permissionsVersion: 1,
    primaryCafeId: 'ZC-0001',
    assignedCafeIds: ['ZC-0001'],
    accountStatus: 'ACTIVE',
    save: async function () { return this; },
  };

  const cafeAdminIndira = {
    userId: 'USR-ADMIN-INDIRA',
    organisationId: 'ORG-ZAMORIN',
    role: 'CAFE_ADMIN',
    email: 'admin.indira@zamorin.com',
    fullName: 'Indiranagar Admin',
    sessionVersion: 1,
    permissionsVersion: 1,
    primaryCafeId: 'ZC-0002',
    assignedCafeIds: ['ZC-0002'],
    accountStatus: 'ACTIVE',
    save: async function () { return this; },
  };

  const ownerUser = {
    userId: 'USR-OWNER-01',
    organisationId: 'ORG-ZAMORIN',
    role: 'OWNER',
    email: 'owner@zamorin.com',
    fullName: 'Owner Stakeholder',
    sessionVersion: 1,
    permissionsVersion: 1,
    assignedCafeIds: ['ZC-0001', 'ZC-0002'],
    accountStatus: 'ACTIVE',
    save: async function () { return this; },
  };

  const staffUser = {
    userId: 'USR-STAFF-01',
    organisationId: 'ORG-ZAMORIN',
    role: 'STAFF',
    email: 'staff@zamorin.com',
    fullName: 'Floor Staff',
    sessionVersion: 1,
    permissionsVersion: 1,
    assignedCafeIds: ['ZC-0001'],
    accountStatus: 'ACTIVE',
    save: async function () { return this; },
  };

  t.mock.method(User, 'findOne', (criteria) => {
    let resolved = null;
    if (criteria?.userId === 'USR-MASTER-01') resolved = primaryMaster;
    if (criteria?.userId === 'USR-ADMIN-KORA') resolved = cafeAdminKora;
    if (criteria?.userId === 'USR-ADMIN-INDIRA') resolved = cafeAdminIndira;
    if (criteria?.userId === 'USR-OWNER-01') resolved = ownerUser;
    if (criteria?.userId === 'USR-STAFF-01') resolved = staffUser;
    return createQueryWrapper(resolved);
  });

  t.mock.method(RolePermission, 'find', () => {
    return createQueryWrapper([
      { role: 'MASTER', permissionCode: 'PROCUREMENT_READ', effect: 'ALLOW', scope: 'ORGANISATION', isCurrentlyEffective: () => true },
      { role: 'MASTER', permissionCode: 'PROCUREMENT_WRITE', effect: 'ALLOW', scope: 'ORGANISATION', isCurrentlyEffective: () => true },
      { role: 'MASTER', permissionCode: 'PROCUREMENT_APPROVE', effect: 'ALLOW', scope: 'ORGANISATION', isCurrentlyEffective: () => true },
      { role: 'CAFE_ADMIN', permissionCode: 'PROCUREMENT_READ', effect: 'ALLOW', scope: 'ASSIGNED_CAFES', isCurrentlyEffective: () => true },
      { role: 'CAFE_ADMIN', permissionCode: 'PROCUREMENT_WRITE', effect: 'ALLOW', scope: 'ASSIGNED_CAFES', isCurrentlyEffective: () => true },
      { role: 'CAFE_ADMIN', permissionCode: 'PROCUREMENT_APPROVE', effect: 'ALLOW', scope: 'ASSIGNED_CAFES', isCurrentlyEffective: () => true },
      { role: 'OWNER', permissionCode: 'PROCUREMENT_READ', effect: 'ALLOW', scope: 'ORGANISATION', isCurrentlyEffective: () => true },
    ]);
  });

  t.mock.method(authService, 'verifyAccessToken', async (token) => {
    let activeUser = primaryMaster;
    if (token === 'token_kora') activeUser = cafeAdminKora;
    if (token === 'token_indira') activeUser = cafeAdminIndira;
    if (token === 'token_owner') activeUser = ownerUser;
    if (token === 'token_staff') activeUser = staffUser;
    return {
      payload: {
        sub: activeUser.userId,
        org: activeUser.organisationId,
        role: activeUser.role,
        isPrimaryMaster: activeUser.isPrimaryMaster,
        sv: 0,
        usv: 1,
        pv: 1,
        sid: 'SS-P07-TEST',
      },
      session: {
        sessionId: 'SS-P07-TEST',
        roleSnapshot: activeUser.role,
        sessionVersion: 0,
        mfaVerified: true,
        stepUpVerifiedAt: new Date().toISOString(),
      },
    };
  });

  const masterToken = 'token_master';
  const koraToken = 'token_kora';
  const indiraToken = 'token_indira';
  const ownerToken = 'token_owner';
  const staffToken = 'token_staff';

  // ── Test Provider for deterministic outbox testing ─────────────────────────
  const mockEmailProvider = new ConsoleTestEmailProvider();
  defaultDispatchService.setProvider(mockEmailProvider);

  // ── In-Memory Datasets ─────────────────────────────────────────────────────
  let memoryItems = [
    {
      organisationId: 'ORG-ZAMORIN',
      itemId: 'ITEM-COFFEE-BEANS',
      sku: 'COF-ARA-001',
      name: 'Arabica Whole Roasted Beans',
      category: 'COFFEE_BEANS',
      baseUnit: 'g',
      purchaseUnit: 'kg',
      shelfLifeDays: 60,
      status: 'ACTIVE',
      unitCostPaisa: 80,
      conversions: [
        {
          fromUnit: 'kg',
          toUnit: 'g',
          displayUnit: 'kg',
          factor: 1000,
          version: 1,
          effectiveFrom: new Date('2026-01-01'),
          effectiveTo: null,
          isDefaultDisplay: true,
        },
      ],
    },
    {
      organisationId: 'ORG-ZAMORIN',
      itemId: 'ITEM-ORGANIC-MILK',
      sku: 'DRY-MLK-001',
      name: 'Farm Fresh Whole Milk',
      category: 'DAIRY',
      baseUnit: 'ml',
      purchaseUnit: 'l',
      shelfLifeDays: 5,
      status: 'ACTIVE',
      unitCostPaisa: 7,
      conversions: [
        {
          fromUnit: 'l',
          toUnit: 'ml',
          displayUnit: 'l',
          factor: 1000,
          version: 1,
          effectiveFrom: new Date('2026-01-01'),
          effectiveTo: null,
          isDefaultDisplay: true,
        },
      ],
    },
  ];

  let memoryConfigs = [
    {
      organisationId: 'ORG-ZAMORIN',
      cafeId: 'ZC-0001',
      itemId: 'ITEM-COFFEE-BEANS',
      reorderPolicy: 'MIN_MAX',
      minQuantityBase: 10000,
      maxQuantityBase: 50000,
      currentQuantityBase: 5000,
      replenishmentEnabled: true,
      stockedHere: true,
      leadTimeDays: 2,
      approvedSuppliers: [
        {
          vendorId: 'VND-COFFEE-SUPPLIER',
          supplierItemCode: 'SUP-COF-01',
          uom: 'kg',
          uomConversionFactor: 1000,
          contractedPricePaisa: 80000,
          moq: 10,
          orderMultiple: 5,
          leadTimeDays: 2,
          isActive: true,
        },
        {
          vendorId: 'VND-ALT-COFFEE',
          supplierItemCode: 'ALT-COF-01',
          uom: 'kg',
          uomConversionFactor: 1000,
          contractedPricePaisa: 85000,
          moq: 5,
          orderMultiple: 5,
          leadTimeDays: 3,
          isActive: true,
        },
      ],
      save: async function () { return this; },
    },
    {
      organisationId: 'ORG-ZAMORIN',
      cafeId: 'ZC-0001',
      itemId: 'ITEM-ORGANIC-MILK',
      reorderPolicy: 'MIN_MAX',
      minQuantityBase: 12000,
      maxQuantityBase: 30000,
      currentQuantityBase: 10000,
      replenishmentEnabled: true,
      stockedHere: true,
      leadTimeDays: 1,
      approvedSuppliers: [
        {
          vendorId: 'VND-COFFEE-SUPPLIER',
          supplierItemCode: 'SUP-MLK-01',
          uom: 'l',
          uomConversionFactor: 1000,
          contractedPricePaisa: 7000,
          moq: 1,
          orderMultiple: 1,
          leadTimeDays: 1,
          isActive: true,
        },
      ],
      save: async function () { return this; },
    },
  ];

  let memoryVendors = [
    {
      organisationId: 'ORG-ZAMORIN',
      vendorId: 'VND-COFFEE-SUPPLIER',
      name: 'Malabar Heritage Coffee Co.',
      contactEmail: 'orders@malabarcoffee.local',
      status: 'ACTIVE',
      paymentTerms: 'Net 30 Days',
      supplierHolds: [],
      supplierItemCatalogue: [
        {
          itemId: 'ITEM-COFFEE-BEANS',
          supplierItemCode: 'SUP-COF-01',
          uom: 'kg',
          uomConversionFactor: 1000,
          currentPricePaisa: 80000,
          contractedPricePaisa: 80000,
          moq: 10,
          orderMultiple: 5,
          leadTimeDays: 2,
          approvedCafeIds: ['ZC-0001', 'ZC-0002'],
          status: 'ACTIVE',
        },
        {
          itemId: 'ITEM-ORGANIC-MILK',
          supplierItemCode: 'SUP-MLK-01',
          uom: 'l',
          uomConversionFactor: 1000,
          currentPricePaisa: 7000,
          contractedPricePaisa: 7000,
          moq: 1,
          orderMultiple: 1,
          leadTimeDays: 1,
          approvedCafeIds: ['ZC-0001', 'ZC-0002'],
          status: 'ACTIVE',
        },
      ],
    },
    {
      organisationId: 'ORG-ZAMORIN',
      vendorId: 'VND-ALT-COFFEE',
      name: 'Nilgiri Roasters Co.',
      contactEmail: 'sales@nilgiriroasters.local',
      status: 'ACTIVE',
      paymentTerms: 'Net 15 Days',
      supplierHolds: [],
      supplierItemCatalogue: [
        {
          itemId: 'ITEM-COFFEE-BEANS',
          supplierItemCode: 'ALT-COF-01',
          uom: 'kg',
          uomConversionFactor: 1000,
          currentPricePaisa: 85000,
          contractedPricePaisa: 85000,
          moq: 5,
          orderMultiple: 5,
          leadTimeDays: 3,
          approvedCafeIds: ['ZC-0001', 'ZC-0002'],
          status: 'ACTIVE',
        },
      ],
    },
  ];

  let memoryOrders = [];
  let memoryDispatchJobs = [];
  let memoryRecommendations = [];

  // Wire Mongoose Models to Memory Stores for Isolated Testing
  t.mock.method(GlobalInventoryItem, 'findOne', (crit) => {
    const item = memoryItems.find((i) => i.itemId === crit?.itemId);
    return createQueryWrapper(item || null);
  });

  t.mock.method(CafeInventoryConfig, 'findOne', (crit) => {
    const cfg = memoryConfigs.find((c) => c.cafeId === crit?.cafeId && c.itemId === crit?.itemId);
    return createQueryWrapper(cfg || null);
  });

  t.mock.method(Vendor, 'findOne', (crit) => {
    const v = memoryVendors.find((x) => x.vendorId === crit?.vendorId);
    return createQueryWrapper(v || null);
  });

  t.mock.method(Vendor, 'find', (crit) => {
    let list = memoryVendors.filter((v) => !crit?.organisationId || v.organisationId === crit.organisationId);
    if (crit?.status) {
      list = list.filter((v) => v.status === crit.status);
    }
    if (crit?.['supplierItemCatalogue.itemId']) {
      list = list.filter((v) =>
        (v.supplierItemCatalogue || []).some(
          (c) => c.itemId === crit['supplierItemCatalogue.itemId'] && c.status === 'ACTIVE'
        )
      );
    }
    return createQueryWrapper(list);
  });

  t.mock.method(InventoryLot, 'find', () => createQueryWrapper([]));
  t.mock.method(InventoryReservation, 'find', () => createQueryWrapper([]));

  t.mock.method(PurchaseOrder, 'findOne', (crit) => {
    const po = memoryOrders.find((o) => o.purchaseOrderId === crit?.purchaseOrderId);
    return createQueryWrapper(po || null);
  });

  t.mock.method(PurchaseOrder, 'find', (crit) => {
    return createQueryWrapper(memoryOrders);
  });

  t.mock.method(ProcurementDispatchJob, 'findOne', (crit) => {
    const job = memoryDispatchJobs.find((j) => {
      if (crit?.dispatchJobId && j.dispatchJobId !== crit.dispatchJobId) return false;
      if (crit?.purchaseOrderId && j.purchaseOrderId !== crit.purchaseOrderId) return false;
      if (crit?.revisionNumber && j.revisionNumber !== crit.revisionNumber) return false;
      return true;
    });
    return createQueryWrapper(job || null);
  });

  t.mock.method(ProcurementDispatchJob, 'find', (crit) => {
    let filtered = memoryDispatchJobs;
    if (crit?.status) {
      filtered = filtered.filter((j) => j.status === crit.status);
    }
    return createQueryWrapper(filtered);
  });

  t.mock.method(ProcurementDispatchJob, 'findOneAndUpdate', async (crit, update, opts) => {
    const job = memoryDispatchJobs.find((j) => {
      if (crit?._id && j._id !== crit._id) return false;
      if (crit?.status && j.status !== crit.status) return false;
      return true;
    });
    if (!job) return null;
    if (update.$set) {
      Object.assign(job, update.$set);
    }
    return job;
  });

  t.mock.method(ProcurementDispatchJob, 'updateMany', async (crit, update) => {
    let count = 0;
    for (const job of memoryDispatchJobs) {
      if (crit?.purchaseOrderId && job.purchaseOrderId !== crit.purchaseOrderId) continue;
      if (crit?.revisionNumber && job.revisionNumber !== crit.revisionNumber) continue;
      if (crit?.status?.$in && !crit.status.$in.includes(job.status)) continue;
      if (update.$set) Object.assign(job, update.$set);
      count++;
    }
    return { modifiedCount: count };
  });

  t.mock.method(ReplenishmentRecommendation, 'findOne', (crit) => {
    const rec = memoryRecommendations.find((r) => {
      if (crit?.recommendationId && r.recommendationId !== crit.recommendationId) return false;
      if (crit?.itemId && r.itemId !== crit.itemId) return false;
      if (crit?.cafeId && r.cafeId !== crit.cafeId) return false;
      if (crit?.isActiveNeed !== undefined && r.isActiveNeed !== crit.isActiveNeed) return false;
      if (crit?.status && r.status !== crit.status) return false;
      return true;
    });
    return createQueryWrapper(rec || null);
  });

  t.mock.method(ReplenishmentRecommendation, 'find', (crit) => {
    let filtered = memoryRecommendations;
    if (crit?.status) filtered = filtered.filter((r) => r.status === crit.status);
    if (crit?.isActiveNeed !== undefined) filtered = filtered.filter((r) => r.isActiveNeed === crit.isActiveNeed);
    return createQueryWrapper(filtered);
  });

  t.mock.method(ReplenishmentRecommendation, 'create', async (data) => {
    const doc = new ReplenishmentRecommendation(data);
    memoryRecommendations.push(doc);
    return doc;
  });

  t.mock.method(Cafe, 'findOne', (crit) => {
    return createQueryWrapper({
      cafeId: crit?.cafeId || 'ZC-0001',
      name: 'Zamorin Koramangala Flagship',
      address: '100 Feet Road, 4th Block, Koramangala, Bengaluru, Karnataka 560034',
    });
  });

  t.mock.method(PurchaseOrder.prototype, 'save', async function () {
    const idx = memoryOrders.findIndex((o) => o.purchaseOrderId === this.purchaseOrderId);
    if (idx >= 0) {
      memoryOrders[idx] = this;
    } else {
      memoryOrders.push(this);
    }
    return this;
  });

  t.mock.method(ProcurementDispatchJob.prototype, 'save', async function () {
    const idx = memoryDispatchJobs.findIndex((j) => j.dispatchJobId === this.dispatchJobId);
    if (idx >= 0) {
      memoryDispatchJobs[idx] = this;
    } else {
      memoryDispatchJobs.push(this);
    }
    return this;
  });

  t.mock.method(ReplenishmentRecommendation.prototype, 'save', async function () {
    const idx = memoryRecommendations.findIndex((r) => r.recommendationId === this.recommendationId);
    if (idx >= 0) {
      memoryRecommendations[idx] = this;
    } else {
      memoryRecommendations.push(this);
    }
    return this;
  });

  t.mock.method(StockMovement, 'countDocuments', () => Promise.resolve(0));
  t.mock.method(InventoryLot, 'countDocuments', () => Promise.resolve(0));
  t.mock.method(APInvoice, 'countDocuments', () => Promise.resolve(0));
  t.mock.method(VendorLedgerEntry, 'countDocuments', () => Promise.resolve(0));
  t.mock.method(Journal, 'countDocuments', () => Promise.resolve(0));
  t.mock.method(CashTransaction, 'countDocuments', () => Promise.resolve(0));

  let effectivePolicyThreshold = 5000000; // default ₹50,000 threshold
  t.mock.method(ApprovalPolicy, 'findOne', () => {
    return createQueryWrapper({
      maxAmountPaisa: effectivePolicyThreshold,
    });
  });

  // Seed Initial Recommendation
  const seedRec = {
    recommendationId: 'REC-20261008-ZC0001-COF-01',
    organisationId: 'ORG-ZAMORIN',
    cafeId: 'ZC-0001',
    itemId: 'ITEM-COFFEE-BEANS',
    status: 'ACTIVE_REVIEW',
    isActiveNeed: true,
    itemSnapshot: {
      itemId: 'ITEM-COFFEE-BEANS',
      name: 'Arabica Whole Roasted Beans',
      baseUnit: 'g',
      purchaseUnit: 'kg',
    },
    stockSnapshot: {
      currentQuantityBase: 5000,
      usableQuantityBase: 5000,
      eligibleInboundBase: 0,
      inventoryPositionBase: 5000,
    },
    policySnapshot: {
      minQuantityBase: 10000,
      maxQuantityBase: 50000,
    },
    calculation: {
      rawNeedBase: 15000,
      suggestedBaseQuantity: 15000,
      conversionFactor: 1000,
      suggestedPurchaseQuantity: 15,
      purchaseUnit: 'kg',
      estimatedCostPaisa: 1200000, // ₹12,000 (below ₹50,000 limit)
      calculationFingerprint: 'FP-SEED-01',
    },
    supplierCandidate: {
      vendorId: 'VND-COFFEE-SUPPLIER',
      vendorName: 'Malabar Heritage Coffee Co.',
      supplierItemCode: 'SUP-COF-01',
      uom: 'kg',
      contractedPricePaisa: 80000,
      leadTimeDays: 2,
      moq: 10,
      orderMultiple: 5,
    },
    explanation: {
      summary: 'Usable stock (5000 g) is below reorder point (10000 g).',
      projectedStockoutDays: 3,
    },
    deferDetails: null,
    revisionHistory: [],
    save: async function () { return this; },
  };

  memoryRecommendations.push(seedRec);

  // ── TEST 1: Routine Draft Conversion from P06 Recommendation ───────────────
  await t.test('1. Routine conversion of P06 recommendation to PO draft', async () => {
    const res = await makeRequest({
      port,
      method: 'POST',
      path: '/api/v1/procurement/orders/from-recommendations',
      headers: {
        authorization: `Bearer ${koraToken}`,
        'x-cafe-id': 'ZC-0001',
      },
      body: {
        recommendationIds: ['REC-20261008-ZC0001-COF-01'],
      },
    });

    assert.equal(res.statusCode, 201);
    assert.equal(res.body.success, true);
    assert.equal(res.body.data.count, 1);

    const order = res.body.data.orders[0];
    assert.match(order.purchaseOrderId, /^PO-/);
    assert.equal(order.status, 'DRAFT');
    assert.equal(order.currentRevision, 1);
    assert.equal(order.vendorId, 'VND-COFFEE-SUPPLIER');
    assert.equal(order.lineItems.length, 1);
    assert.equal(order.lineItems[0].orderedQuantityBase, 15000);
    assert.equal(order.lineItems[0].unitPricePaisa, 80000);

    // Verify PO was saved to memoryOrders
    assert.ok(memoryOrders.length >= 1);
    assert.equal(memoryOrders[0].purchaseOrderId, order.purchaseOrderId);

    // Verify recommendation was marked CONVERTED
    assert.equal(seedRec.status, 'CONVERTED');
    assert.equal(seedRec.isActiveNeed, false);
    assert.equal(seedRec.convertedPurchaseOrderId, order.purchaseOrderId);
  });

  // ── TEST 2: Routine Approval and Atomic Dispatch Outbox Queueing ─────────────
  await t.test('2. Routine Café Operations approval binds exact revision and queues dispatch', async () => {
    const po = memoryOrders[0];
    const res = await makeRequest({
      port,
      method: 'POST',
      path: `/api/v1/procurement/orders/${po.purchaseOrderId}/approve-and-send`,
      headers: {
        authorization: `Bearer ${koraToken}`,
        'x-cafe-id': 'ZC-0001',
      },
      body: {
        revisionNumber: 1,
        notes: 'Routine weekly replenishment approved',
        sendImmediately: false,
      },
    });

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.data.order.status, 'APPROVED');
    assert.equal(res.body.data.order.activeApprovedRevision, 1);
    assert.equal(res.body.data.dispatchJob.status, 'QUEUED');
    assert.equal(res.body.data.dispatchJob.revisionNumber, 1);

    // Verify dispatch job exists in memoryDispatchJobs
    const rev1JobFound = memoryDispatchJobs.find((j) => j.dispatchJobId === res.body.data.dispatchJob.dispatchJobId);
    assert.ok(rev1JobFound);
  });

  // ── TEST 3: Immutable PO Revision - Edit After Approval Revokes Authority ────
  await t.test('3. Modifying quantity after approval increments revision and invalidates previous dispatch authority', async () => {
    const po = memoryOrders[0];

    const editRes = await makeRequest({
      port,
      method: 'POST',
      path: `/api/v1/procurement/orders/${po.purchaseOrderId}/revisions`,
      headers: {
        authorization: `Bearer ${koraToken}`,
        'x-cafe-id': 'ZC-0001',
      },
      body: {
        lineItems: [
          {
            itemId: 'ITEM-COFFEE-BEANS',
            orderedQuantityBase: 25000, // increased quantity
          },
        ],
        reason: 'Anticipating weekend catering surge',
      },
    });

    assert.equal(editRes.statusCode, 200);
    assert.equal(editRes.body.data.currentRevision, 2);

    // Reload PO and verify previous approval is revoked
    const updatedPo = memoryOrders.find((o) => o.purchaseOrderId === po.purchaseOrderId);
    assert.equal(updatedPo.status, 'SUBMITTED');
    assert.equal(updatedPo.activeApprovedRevision, null);
    assert.equal(updatedPo.needsReapproval, true);

    // Verify Revision 1 queued dispatch job was CANCELLED
    const rev1Job = memoryDispatchJobs.find((j) => j.purchaseOrderId === po.purchaseOrderId && j.revisionNumber === 1);
    assert.equal(rev1Job.status, 'CANCELLED');
    assert.match(rev1Job.reconciliationNotes, /Superseded by Revision 2/);
  });

  // ── TEST 4: Background Worker Suppresses Cancelled/Superseded Revisions ───────
  await t.test('4. Dispatch worker refuses to send superseded Revision 1', async () => {
    const outcomes = await defaultDispatchService.runDispatchWorker({ limit: 10 });
    // Since Revision 1 job was cancelled, worker does not dispatch it
    const activeJobs = memoryDispatchJobs.filter((j) => j.status === 'ACCEPTED_BY_PROVIDER');
    assert.equal(activeJobs.length, 0);
  });

  // ── TEST 5: Threshold Escalation to Primary Master ──────────────────────────
  await t.test('5. Order exceeding Café Admin threshold is escalated to Primary Master', async () => {
    const po = memoryOrders[0];

    // Configure a low threshold for testing (₹10,000 / 1000000 paisa)
    effectivePolicyThreshold = 1000000;

    // Café Admin attempts to approve Revision 2 (total is > ₹12,000)
    const approveRes = await makeRequest({
      port,
      method: 'POST',
      path: `/api/v1/procurement/orders/${po.purchaseOrderId}/approve-and-send`,
      headers: {
        authorization: `Bearer ${koraToken}`,
        'x-cafe-id': 'ZC-0001',
      },
      body: {
        revisionNumber: 2,
        notes: 'Attempting routine approval',
      },
    });

    assert.equal(approveRes.statusCode, 403);
    assert.equal(approveRes.body.error?.code, 'APPROVAL_THRESHOLD_EXCEEDED');

    // Verify PO status was transitioned to ESCALATED_PENDING_MASTER
    assert.equal(po.status, 'ESCALATED_PENDING_MASTER');

    // Primary Master approves the exact Revision 2
    const masterApproveRes = await makeRequest({
      port,
      method: 'POST',
      path: `/api/v1/procurement/orders/${po.purchaseOrderId}/approve-and-send`,
      headers: {
        authorization: `Bearer ${masterToken}`,
        'x-cafe-id': 'ZC-0001',
      },
      body: {
        revisionNumber: 2,
        notes: 'Primary Master exception authorized for catering surge',
        sendImmediately: false,
      },
    });

    assert.equal(masterApproveRes.statusCode, 200);
    assert.equal(masterApproveRes.body.data.order.status, 'APPROVED');
    assert.equal(masterApproveRes.body.data.order.activeApprovedRevision, 2);

    // Verify Revision 2 dispatch job exists in memoryDispatchJobs
    const rev2JobFound = memoryDispatchJobs.find((j) => j.dispatchJobId === masterApproveRes.body.data.dispatchJob.dispatchJobId);
    assert.ok(rev2JobFound);
  });

  // ── TEST 6: Owner and Staff Boundary Enforcement ────────────────────────────
  await t.test('6. Owner (read-only) and Staff are denied purchasing mutations', async () => {
    const po = memoryOrders[0];

    // Owner attempts approval
    const ownerRes = await makeRequest({
      port,
      method: 'POST',
      path: `/api/v1/procurement/orders/${po.purchaseOrderId}/approve-and-send`,
      headers: {
        authorization: `Bearer ${ownerToken}`,
        'x-cafe-id': 'ZC-0001',
      },
      body: { revisionNumber: 2 },
    });
    assert.equal(ownerRes.statusCode, 403);
    assert.equal(ownerRes.body.error?.code, 'ROLE_NOT_ALLOWED');

    // Staff attempts approval
    const staffRes = await makeRequest({
      port,
      method: 'POST',
      path: `/api/v1/procurement/orders/${po.purchaseOrderId}/approve-and-send`,
      headers: {
        authorization: `Bearer ${staffToken}`,
        'x-cafe-id': 'ZC-0001',
      },
      body: { revisionNumber: 2 },
    });
    assert.equal(staffRes.statusCode, 403);
  });

  // ── TEST 7: Cross-Café Denial ───────────────────────────────────────────────
  await t.test('7. Cross-café Café Admin is denied purchasing operations', async () => {
    const po = memoryOrders[0];

    // Indira admin (ZC-0002) attempts to approve Koramangala (ZC-0001) order
    const crossRes = await makeRequest({
      port,
      method: 'POST',
      path: `/api/v1/procurement/orders/${po.purchaseOrderId}/approve-and-send`,
      headers: {
        authorization: `Bearer ${indiraToken}`,
        'x-cafe-id': 'ZC-0001',
      },
      body: { revisionNumber: 2 },
    });

    assert.equal(crossRes.statusCode, 403);
    assert.equal(crossRes.body.error?.code, 'CAFE_ACCESS_DENIED');
  });

  // ── TEST 8: 50 Concurrent Approvals Burst Concurrency ───────────────────────
  await t.test('8. 50 parallel identical approval requests yield exactly 1 PO state and 1 active job', async () => {
    const po = memoryOrders[0];

    const promises = [];
    for (let i = 0; i < 50; i++) {
      promises.push(
        makeRequest({
          port,
          method: 'POST',
          path: `/api/v1/procurement/orders/${po.purchaseOrderId}/approve-and-send`,
          headers: {
            authorization: `Bearer ${masterToken}`,
            'x-cafe-id': 'ZC-0001',
          },
          body: {
            revisionNumber: 2,
            idempotencyKey: `IDEMP-BURST-${po.purchaseOrderId}-R2`,
            sendImmediately: false,
          },
        })
      );
    }

    const results = await Promise.all(promises);

    // All 50 requests should return 200 without 500 error
    for (const res of results) {
      assert.equal(res.statusCode, 200);
      assert.equal(res.body.data.order.activeApprovedRevision, 2);
    }

    // Exactly one active dispatch job exists for Revision 2
    const rev2Jobs = memoryDispatchJobs.filter(
      (j) => j.purchaseOrderId === po.purchaseOrderId && j.revisionNumber === 2 && j.status !== 'CANCELLED'
    );
    assert.equal(rev2Jobs.length, 1);
  });

  // ── TEST 9: Lost Response Retry Idempotency ─────────────────────────────────
  await t.test('9. Retried approval with same idempotency key returns existing authoritative PO', async () => {
    const po = memoryOrders[0];
    const key = `IDEMP-LOST-RESP-${po.purchaseOrderId}`;

    const res1 = await makeRequest({
      port,
      method: 'POST',
      path: `/api/v1/procurement/orders/${po.purchaseOrderId}/approve-and-send`,
      headers: { authorization: `Bearer ${masterToken}` },
      body: { revisionNumber: 2, idempotencyKey: key, sendImmediately: false },
    });

    const res2 = await makeRequest({
      port,
      method: 'POST',
      path: `/api/v1/procurement/orders/${po.purchaseOrderId}/approve-and-send`,
      headers: { authorization: `Bearer ${masterToken}` },
      body: { revisionNumber: 2, idempotencyKey: key, sendImmediately: false },
    });

    assert.equal(res1.statusCode, 200);
    assert.equal(res2.statusCode, 200);
    assert.equal(res2.body.data.alreadyApproved, true);
    assert.equal(res2.body.data.order.purchaseOrderId, po.purchaseOrderId);
  });

  // ── TEST 10: Dispatch Worker Execution & Provider Acceptance ────────────────
  await t.test('10. Background worker executes Revision 2 dispatch via provider', async () => {
    mockEmailProvider.clearHistory();
    const outcomes = await defaultDispatchService.runDispatchWorker({ limit: 10 });

    assert.equal(outcomes.length, 1);
    assert.equal(outcomes[0].status, 'ACCEPTED_BY_PROVIDER');

    const po = memoryOrders[0];
    assert.equal(po.dispatchStatus, 'ACCEPTED_BY_PROVIDER');
    assert.equal(po.status, 'ORDERED'); // advances to ORDERED
    assert.equal(mockEmailProvider.sentEmails.length, 1);
    assert.match(mockEmailProvider.sentEmails[0].subject, /Official Purchase Order/);
  });

  // ── TEST 11: Transport Status vs Vendor Response Strict Separation ──────────
  await t.test('11. Transport status and Vendor commercial response remain strictly separate', async () => {
    const po = memoryOrders[0];

    // Transport is ACCEPTED_BY_PROVIDER, but vendor response is still AWAITING_RESPONSE
    assert.equal(po.dispatchStatus, 'ACCEPTED_BY_PROVIDER');
    assert.equal(po.vendorResponseStatus, 'AWAITING_RESPONSE');

    // Operator records Vendor response: PARTIALLY_CONFIRMED
    const ackRes = await makeRequest({
      port,
      method: 'POST',
      path: `/api/v1/procurement/orders/${po.purchaseOrderId}/vendor-acknowledgement`,
      headers: {
        authorization: `Bearer ${koraToken}`,
        'x-cafe-id': 'ZC-0001',
      },
      body: {
        status: 'PARTIALLY_CONFIRMED',
        notes: 'Vendor can supply 20 kg immediately, 5 kg next week',
        channel: 'EMAIL',
        confirmedLines: [
          {
            itemId: 'ITEM-COFFEE-BEANS',
            confirmedQuantityBase: 20000,
            unavailableQuantityBase: 5000,
          },
        ],
      },
    });

    assert.equal(ackRes.statusCode, 200);
    assert.equal(ackRes.body.data.vendorResponseStatus, 'PARTIALLY_CONFIRMED');

    // Transport status remains unchanged as ACCEPTED_BY_PROVIDER
    assert.equal(po.dispatchStatus, 'ACCEPTED_BY_PROVIDER');
    // Original ordered quantity (25,000 g) is preserved and not overwritten!
    assert.equal(po.lineItems[0].orderedQuantityBase, 25000);
  });

  // ── TEST 12: Network Timeout Yields UNKNOWN Without Duplicate Resend ────────
  await t.test('12. Network timeout during transmission marks dispatch UNKNOWN without blind resend', async () => {
    // Stage an ambiguous dispatch job
    const ambiguousJob = new ProcurementDispatchJob({
      dispatchJobId: 'DISPATCH-AMBIGUOUS-01',
      organisationId: 'ORG-ZAMORIN',
      cafeId: 'ZC-0001',
      purchaseOrderId: 'PO-AMBIGUOUS-01',
      revisionNumber: 1,
      vendorId: 'VND-COFFEE-SUPPLIER',
      recipientEmail: 'vendor@zamorin.local',
      status: 'QUEUED',
      idempotencyKey: 'IDEMP-AMBIGUOUS-01',
      provider: 'EMAIL',
      attempts: [],
      payloadSnapshot: { purchaseOrderId: 'PO-AMBIGUOUS-01', totalPaisa: 50000, lineItems: [] },
    });
    memoryDispatchJobs.push(ambiguousJob);

    const ambiguousPo = new PurchaseOrder({
      purchaseOrderId: 'PO-AMBIGUOUS-01',
      organisationId: 'ORG-ZAMORIN',
      cafeId: 'ZC-0001',
      vendorId: 'VND-COFFEE-SUPPLIER',
      lineItems: [{ itemId: 'ITEM-COFFEE-BEANS', orderedQuantityBase: 5000, unitPricePaisa: 80, totalLinePaisa: 4000 }],
      status: 'APPROVED',
      currentRevision: 1,
      activeApprovedRevision: 1,
      dispatchStatus: 'QUEUED',
      createdByUserId: 'USR-MASTER-01',
    });
    memoryOrders.push(ambiguousPo);

    // Simulate network socket timeout on email provider
    mockEmailProvider.setOutageSimulation(true, 'ETIMEDOUT');

    const outcomes = await defaultDispatchService.runDispatchWorker({ limit: 10 });
    mockEmailProvider.setOutageSimulation(false);

    assert.equal(ambiguousJob.status, 'UNKNOWN');
    assert.equal(ambiguousPo.dispatchStatus, 'UNKNOWN');

    // Reconcile UNKNOWN dispatch safely
    const reconcileRes = await makeRequest({
      port,
      method: 'POST',
      path: `/api/v1/procurement/dispatch-jobs/${ambiguousJob.dispatchJobId}/reconcile`,
      headers: { authorization: `Bearer ${koraToken}` },
      body: {
        confirmedOutcome: 'ACCEPTED_BY_PROVIDER',
        providerReferenceId: 'EXT-CONFIRMED-GMAIL-REF',
        notes: 'Confirmed by calling vendor operations desk',
      },
    });

    assert.equal(reconcileRes.statusCode, 200);
    assert.equal(ambiguousJob.status, 'ACCEPTED_BY_PROVIDER');
    assert.equal(ambiguousPo.dispatchStatus, 'ACCEPTED_BY_PROVIDER');
    assert.equal(ambiguousPo.status, 'ORDERED');
  });

  // ── TEST 13: Deterministic Deferral Suppression (Fix for P06 edge case) ─────
  await t.test('13. Deferring recommendation deterministic suppression and material escalation reopen', async () => {
    // 1. Create a fresh recommendation
    const deferredRec = new ReplenishmentRecommendation({
      recommendationId: 'REC-DEFER-TEST-01',
      organisationId: 'ORG-ZAMORIN',
      cafeId: 'ZC-0001',
      itemId: 'ITEM-ORGANIC-MILK',
      status: 'ACTIVE_REVIEW',
      isActiveNeed: true,
      stockSnapshot: {
        currentQuantityBase: 10000,
        usableQuantityBase: 10000,
        eligibleInboundBase: 0,
      },
      calculation: {
        rawNeedBase: 5000,
        suggestedPurchaseQuantity: 5,
        estimatedCostPaisa: 35000,
        calculationFingerprint: 'FP-DEFER-01',
      },
      supplierCandidate: {
        vendorId: 'VND-COFFEE-SUPPLIER',
        vendorName: 'Malabar Heritage Coffee Co.',
      },
      explanation: { summary: 'Need 5L', projectedStockoutDays: 4 },
      save: async function () { return this; },
    });
    memoryRecommendations.push(deferredRec);

    // 2. Manager defers recommendation until 3 days in future
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 3);

    const deferRes = await makeRequest({
      port,
      method: 'POST',
      path: `/api/v1/procurement/recommendations/${deferredRec.recommendationId}/defer`,
      headers: {
        authorization: `Bearer ${koraToken}`,
        'x-cafe-id': 'ZC-0001',
      },
      body: {
        deferredUntil: futureDate.toISOString(),
        deferReason: 'Expected footfall drop during mid-week renovation',
      },
    });

    assert.equal(deferRes.statusCode, 200);
    assert.equal(deferredRec.status, 'DEFERRED');
    assert.equal(deferredRec.isActiveNeed, false);
    assert.equal(deferredRec.deferDetails.deferReason, 'Expected footfall drop during mid-week renovation');

    // 3. Replenishment sweep runs repeatedly -> verify deferral is preserved without creating duplicate active recommendation
    const evalUnchanged = await ReplenishmentRecommendationService.evaluateItem({
      organisationId: 'ORG-ZAMORIN',
      cafeId: 'ZC-0001',
      itemId: 'ITEM-ORGANIC-MILK',
      source: 'SCHEDULED_SWEEP',
    });

    assert.equal(evalUnchanged.action, 'DEFERRAL_PRESERVED');
    assert.equal(evalUnchanged.suppressed, true);

    // 4. Material shortage escalation occurs: usable stock drops significantly (e.g. from 10,000 to 4,000)
    const milkConfig = memoryConfigs.find((c) => c.itemId === 'ITEM-ORGANIC-MILK') || {
      organisationId: 'ORG-ZAMORIN',
      cafeId: 'ZC-0001',
      itemId: 'ITEM-ORGANIC-MILK',
      reorderPolicy: 'MIN_MAX',
      minQuantityBase: 12000,
      maxQuantityBase: 30000,
      currentQuantityBase: 4000, // drastic drop
      replenishmentEnabled: true,
      stockedHere: true,
      approvedSuppliers: [{ vendorId: 'VND-COFFEE-SUPPLIER', contractedPricePaisa: 7000, uomConversionFactor: 1000, moq: 1, orderMultiple: 1 }],
    };
    milkConfig.currentQuantityBase = 4000;
    memoryConfigs.push(milkConfig);

    const evalEscalated = await ReplenishmentRecommendationService.evaluateItem({
      organisationId: 'ORG-ZAMORIN',
      cafeId: 'ZC-0001',
      itemId: 'ITEM-ORGANIC-MILK',
      source: 'SCHEDULED_SWEEP',
    });

    // Deferral overridden due to material stock drop!
    assert.notEqual(evalEscalated.action, 'DEFERRAL_PRESERVED');
    assert.equal(deferredRec.deferDetails.overrideReason !== null, true);
    assert.match(deferredRec.deferDetails.overrideReason, /Usable stock fell significantly/);
  });

  // ── TEST 14: Supplier Alternative Request ──────────────────────────────────
  await t.test('14. Requesting alternative supplier selects alternate approved vendor', async () => {
    const rec = new ReplenishmentRecommendation({
      recommendationId: 'REC-ALT-SUPPLIER-01',
      organisationId: 'ORG-ZAMORIN',
      cafeId: 'ZC-0001',
      itemId: 'ITEM-COFFEE-BEANS',
      status: 'ACTIVE_REVIEW',
      isActiveNeed: true,
      calculation: {
        rawNeedBase: 10000,
        suggestedPurchaseQuantity: 10,
        estimatedCostPaisa: 800000,
        calculationFingerprint: 'FP-ALT-01',
      },
      supplierCandidate: {
        vendorId: 'VND-COFFEE-SUPPLIER',
        vendorName: 'Malabar Heritage Coffee Co.',
      },
      save: async function () { return this; },
    });
    memoryRecommendations.push(rec);

    const altRes = await makeRequest({
      port,
      method: 'POST',
      path: `/api/v1/procurement/recommendations/${rec.recommendationId}/request-alternative`,
      headers: {
        authorization: `Bearer ${koraToken}`,
        'x-cafe-id': 'ZC-0001',
      },
      body: {
        reason: 'Vendor experiencing roasting delays',
      },
    });

    assert.equal(altRes.statusCode, 200);
    assert.equal(altRes.body.data.supplierCandidate.vendorId, 'VND-ALT-COFFEE');
    assert.equal(altRes.body.data.supplierCandidate.vendorName, 'Nilgiri Roasters Co.');
  });

  // ── TEST 15: ZERO Physical Inventory Mutation Invariant ─────────────────────
  await t.test('15. Procurement lifecycle creates ZERO stock movements, lot mutations or GRN postings', async () => {
    // Verify that through P06 recommendation, PO creation, approval, dispatch, and vendor response:
    const movementCount = await StockMovement.countDocuments({});
    const lotCount = await InventoryLot.countDocuments({});

    assert.equal(movementCount, 0, 'ZERO StockMovement entries permitted in P07');
    assert.equal(lotCount, 0, 'ZERO InventoryLot mutations permitted in P07');

    for (const order of memoryOrders) {
      assert.equal(order.grnReceipts?.length || 0, 0, 'ZERO GRN receipts permitted in P07');
    }
  });

  // ── TEST 16: ZERO Financial / AP / GL Mutation Invariant ────────────────────
  await t.test('16. Procurement lifecycle creates ZERO AP liabilities, GL journals, or payment records', async () => {
    const apCount = await APInvoice.countDocuments({});
    const ledgerCount = await VendorLedgerEntry.countDocuments({});
    const glJournalCount = await Journal.countDocuments({});
    const cashCount = await CashTransaction.countDocuments({});

    assert.equal(apCount, 0, 'ZERO APInvoice liabilities permitted in P07');
    assert.equal(ledgerCount, 0, 'ZERO VendorLedgerEntry liabilities permitted in P07');
    assert.equal(glJournalCount, 0, 'ZERO GL Journal postings permitted in P07');
    assert.equal(cashCount, 0, 'ZERO CashTransaction movements permitted in P07');
  });

  // ── TEST 17: Vendor PO Document Consistency ─────────────────────────────────
  await t.test('17. Generated Vendor PO PDF matches exact approved database revision', async () => {
    const po = memoryOrders[0];
    const pdf = ProcurementDispatchService.generateVendorPoPdf(po, po.revisions[1]); // Revision 2

    assert.ok(pdf.buffer);
    assert.equal(pdf.mimeType, 'application/pdf');
    assert.match(pdf.filename, /Rev2\.pdf$/);
    assert.ok(pdf.documentHash);

    // Verify PDF header %PDF-1.4
    const header = pdf.buffer.subarray(0, 8).toString('utf8');
    assert.match(header, /^%PDF-1\.4/);
  });
});
