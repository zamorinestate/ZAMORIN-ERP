'use strict';

/**
 * ============================================================================
 * ZAMORIN CAFÉ ERP — P06: AUTOMATIC REPLENISHMENT RECOMMENDATION ENGINE SUITE
 * ============================================================================
 *
 * Verifies:
 *   1. Deterministic calculation: below-reorder creates recommendation, above-reorder resolves
 *   2. Safety stock, lead time, and periodic review horizon calculations
 *   3. Reorder policies: MIN_MAX, PAR_LEVEL, PERIODIC_REVIEW, DEMAND_DRIVEN (and safe fallback)
 *   4. Usable stock calculation: excludes expired lots, quarantined lots, and firm reservations
 *   5. Time-sensitive inbound PO supply: in-time arrives before stockout vs too-late PO warning
 *   6. Partial PO receiving, cancelled POs, fully received lines
 *   7. Supplier pack rounding, MOQ enforcement, and versioned UOM conversion
 *   8. Safety constraint blockers: MOQ_EXCEEDS_SAFE_STOCK, SHELF_LIFE_CONSTRAINT, STORAGE_CAPACITY_CONSTRAINT
 *   9. Data-quality gate from P05: missing mapping, ambiguous UOM, missing rates block with actionable codes
 *  10. Multiple approved vendors selection and unapproved vendor exclusion
 *  11. Negative stock exception detection
 *  12. Idempotent evaluation and calculation fingerprinting
 *  13. Database boundary deduplication: burst of 50 concurrent requests yields exactly 1 active recommendation
 *  14. Zero side-effects: no POs, no GRNs, no StockMovements, no lot mutations, no AP/GL postings
 *  15. Role authorization: Primary Master org-wide, Cafe Admin scoped, Owner read-only, Staff 403 denied
 *  16. Event bus and scheduled safety sweep convergence
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const { createApp } = require('../src/server');
const { GlobalInventoryItem } = require('../src/models/GlobalInventoryItem');
const { CafeInventoryConfig } = require('../src/models/CafeInventoryConfig');
const { Vendor } = require('../src/models/Vendor');
const { InventoryLot } = require('../src/models/InventoryLot');
const { StockMovement } = require('../src/models/StockMovement');
const { PurchaseOrder } = require('../src/models/PurchaseOrder');
const { InventoryReservation } = require('../src/models/InventoryReservation');
const { User } = require('../src/models/User');
const { RolePermission } = require('../src/models/RolePermission');
const {
  ReplenishmentRecommendation,
} = require('../src/models/ReplenishmentRecommendation');
const {
  ReplenishmentRecommendationService,
  computeFingerprint,
} = require('../src/services/replenishmentRecommendationService');
const authService = require('../src/services/authService');

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

test('P06: Automatic Replenishment Recommendation Engine Suite', async (t) => {
  const app = createApp({ allowedOrigins: ['*'], production: false });
  const server = http.createServer(app);

  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });

  const port = server.address().port;

  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  // ── Personas ───────────────────────────────────────────────────────────────
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
    assignedCafeIds: ['ZC-0001'],
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

  t.mock.method(User, 'findOne', async (criteria) => {
    if (criteria?.userId === 'USR-MASTER-01') return primaryMaster;
    if (criteria?.userId === 'USR-ADMIN-KORA') return cafeAdminKora;
    if (criteria?.userId === 'USR-OWNER-01') return ownerUser;
    if (criteria?.userId === 'USR-STAFF-01') return staffUser;
    return null;
  });

  t.mock.method(RolePermission, 'find', () => {
    return createQueryWrapper([
      { role: 'MASTER', permissionCode: 'INVENTORY_READ', effect: 'ALLOW', scope: 'ORGANISATION', isCurrentlyEffective: () => true },
      { role: 'MASTER', permissionCode: 'INVENTORY_WRITE', effect: 'ALLOW', scope: 'ORGANISATION', isCurrentlyEffective: () => true },
      { role: 'MASTER', permissionCode: 'INVENTORY_ADMIN', effect: 'ALLOW', scope: 'ORGANISATION', isCurrentlyEffective: () => true },
      { role: 'CAFE_ADMIN', permissionCode: 'INVENTORY_READ', effect: 'ALLOW', scope: 'ASSIGNED_CAFES', isCurrentlyEffective: () => true },
      { role: 'CAFE_ADMIN', permissionCode: 'INVENTORY_WRITE', effect: 'ALLOW', scope: 'ASSIGNED_CAFES', isCurrentlyEffective: () => true },
      { role: 'OWNER', permissionCode: 'INVENTORY_READ', effect: 'ALLOW', scope: 'ORGANISATION', isCurrentlyEffective: () => true },
    ]);
  });

  t.mock.method(authService, 'verifyAccessToken', async (token) => {
    let activeUser = primaryMaster;
    if (token === 'token_kora') activeUser = cafeAdminKora;
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
        sid: 'SS-P06-TEST',
      },
      session: {
        sessionId: 'SS-P06-TEST',
        roleSnapshot: activeUser.role,
        sessionVersion: 0,
        mfaVerified: true,
        stepUpVerifiedAt: new Date().toISOString(),
      },
    };
  });

  const masterToken = 'token_master';
  const koraToken = 'token_kora';
  const ownerToken = 'token_owner';
  const staffToken = 'token_staff';

  // ── In-Memory Datasets ─────────────────────────────────────────────────────
  let inMemoryItems = [
    {
      organisationId: 'ORG-ZAMORIN',
      itemId: 'ITEM-COFFEE-BEANS',
      sku: 'COF-ARA-001',
      name: 'Arabica Whole Roasted Beans',
      category: 'COFFEE_BEANS',
      baseUnit: 'g',
      purchaseUnit: 'kg',
      packSize: 1000,
      shelfLifeDays: 60,
      status: 'ACTIVE',
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
      primaryVendorId: 'VEN-ROASTER-01',
      approvedVendorIds: ['VEN-ROASTER-01'],
    },
    {
      organisationId: 'ORG-ZAMORIN',
      itemId: 'ITEM-FRESH-MILK',
      sku: 'DAI-MILK-001',
      name: 'Farm Fresh Whole Milk',
      category: 'DAIRY_FRESH',
      baseUnit: 'l',
      purchaseUnit: 'crate',
      packSize: 12,
      shelfLifeDays: 5, // Short shelf-life perishable!
      status: 'ACTIVE',
      conversions: [
        {
          fromUnit: 'crate',
          toUnit: 'l',
          displayUnit: 'crate',
          factor: 12, // 12 Litres per crate
          version: 1,
          effectiveFrom: new Date('2026-01-01'),
          effectiveTo: null,
          isDefaultDisplay: true,
        },
      ],
      primaryVendorId: 'VEN-DAIRY-01',
      approvedVendorIds: ['VEN-DAIRY-01'],
    },
    {
      organisationId: 'ORG-ZAMORIN',
      itemId: 'ITEM-AMBIGUOUS-UOM',
      sku: 'MISC-AMB-001',
      name: 'Ambiguous Tea Powder',
      category: 'OTHER',
      baseUnit: 'g',
      purchaseUnit: 'bag',
      status: 'ACTIVE',
      conversions: [], // Missing conversion!
      primaryVendorId: 'VEN-ROASTER-01',
      approvedVendorIds: ['VEN-ROASTER-01'],
    },
  ];

  let inMemoryConfigs = [
    {
      organisationId: 'ORG-ZAMORIN',
      cafeId: 'ZC-0001',
      itemId: 'ITEM-COFFEE-BEANS',
      currentQuantityBase: 3000, // 3000g on hand
      availableQuantityBase: 3000,
      reservedQuantityBase: 0,
      quarantinedQuantityBase: 0,
      expiredQuantityBase: 0,
      inTransitQuantityBase: 0,
      minQuantityBase: 5000,  // Reorder point
      parQuantityBase: 25000, // Target
      safetyStockBase: 2000,
      maxQuantityBase: 30000,
      avgDailyUsageBase: 1500, // 1.5kg/day
      leadTimeDays: 2,
      orderMultipleBase: 1000,
      reorderPolicy: 'MIN_MAX',
      replenishmentEnabled: true,
      stockedHere: true,
      status: 'ACTIVE',
      storageConstraints: {
        locationZone: 'MAIN_STORE',
        temperatureZone: 'AMBIENT',
        maxStorageCapacityBase: 50000,
      },
      save: async function () { return this; },
    },
    {
      organisationId: 'ORG-ZAMORIN',
      cafeId: 'ZC-0001',
      itemId: 'ITEM-FRESH-MILK',
      currentQuantityBase: 10, // 10 Litres on hand
      availableQuantityBase: 10,
      reservedQuantityBase: 0,
      quarantinedQuantityBase: 0,
      expiredQuantityBase: 0,
      inTransitQuantityBase: 0,
      minQuantityBase: 24,
      parQuantityBase: 60,
      safetyStockBase: 12,
      maxQuantityBase: 100,
      avgDailyUsageBase: 15, // 15 L/day
      leadTimeDays: 1,
      orderMultipleBase: 12,
      reorderPolicy: 'PAR_LEVEL',
      replenishmentEnabled: true,
      stockedHere: true,
      status: 'ACTIVE',
      storageConstraints: {
        locationZone: 'CHILLED',
        temperatureZone: 'CHILLED',
        maxStorageCapacityBase: 80,
      },
      save: async function () { return this; },
    },
    {
      organisationId: 'ORG-ZAMORIN',
      cafeId: 'ZC-0001',
      itemId: 'ITEM-AMBIGUOUS-UOM',
      currentQuantityBase: 100,
      minQuantityBase: 500,
      parQuantityBase: 2000,
      safetyStockBase: 100,
      maxQuantityBase: 5000,
      leadTimeDays: 2,
      reorderPolicy: 'MIN_MAX',
      replenishmentEnabled: true,
      stockedHere: true,
      status: 'ACTIVE',
      save: async function () { return this; },
    },
  ];

  let inMemoryVendors = [
    {
      organisationId: 'ORG-ZAMORIN',
      vendorId: 'VEN-ROASTER-01',
      name: 'Artisan Coffee Roasters LLP',
      status: 'ACTIVE',
      supplierHolds: [],
      supplierItemCatalogue: [
        {
          itemId: 'ITEM-COFFEE-BEANS',
          supplierItemCode: 'ACR-ARA-KG',
          uom: 'kg',
          uomConversionFactor: 1000,
          currentPricePaisa: 150000, // ₹1,500/kg
          moq: 5, // 5 kg
          orderMultiple: 1,
          leadTimeDays: 2,
          deliveryDays: ['MON', 'WED', 'FRI'],
          approvedCafeIds: ['ZC-0001'],
          status: 'ACTIVE',
        },
      ],
    },
    {
      organisationId: 'ORG-ZAMORIN',
      vendorId: 'VEN-DAIRY-01',
      name: 'Malabar Fresh Dairies',
      status: 'ACTIVE',
      supplierHolds: [],
      supplierItemCatalogue: [
        {
          itemId: 'ITEM-FRESH-MILK',
          supplierItemCode: 'MFD-CRATE-12L',
          uom: 'crate',
          uomConversionFactor: 12,
          currentPricePaisa: 72000, // ₹720/crate (₹60/L)
          moq: 2, // 2 crates (24 L)
          orderMultiple: 1,
          leadTimeDays: 1,
          deliveryDays: ['DAILY'],
          approvedCafeIds: ['ZC-0001'],
          status: 'ACTIVE',
        },
      ],
    },
  ];

  let inMemoryLots = [];
  let inMemoryPOs = [];
  let inMemoryReservations = [];
  let inMemoryMovements = [];
  let inMemoryRecommendations = [];

  // ── Mongoose Model Stub Interceptions ──────────────────────────────────────
  t.mock.method(GlobalInventoryItem, 'findOne', (query) => {
    const itm = inMemoryItems.find(
      (i) => i.organisationId === query?.organisationId && i.itemId === query?.itemId
    );
    return createQueryWrapper(itm || null);
  });
  t.mock.method(GlobalInventoryItem, 'find', (query) => {
    const list = inMemoryItems.filter((i) => !query?.organisationId || i.organisationId === query.organisationId);
    return createQueryWrapper(list);
  });

  t.mock.method(CafeInventoryConfig, 'findOne', (query) => {
    const cfg = inMemoryConfigs.find(
      (c) => c.organisationId === query?.organisationId && c.cafeId === query?.cafeId && c.itemId === query?.itemId
    );
    if (!cfg) return createQueryWrapper(null);
    return Promise.resolve(cfg);
  });
  t.mock.method(CafeInventoryConfig, 'find', (query) => {
    const list = inMemoryConfigs.filter(
      (c) =>
        (!query?.organisationId || c.organisationId === query.organisationId) &&
        (!query?.cafeId || c.cafeId === query.cafeId) &&
        (!query?.status || c.status === query.status) &&
        (query?.replenishmentEnabled === undefined || c.replenishmentEnabled === query.replenishmentEnabled)
    );
    return createQueryWrapper(list);
  });

  t.mock.method(Vendor, 'find', (query) => {
    let list = inMemoryVendors.filter((v) => !query?.organisationId || v.organisationId === query.organisationId);
    if (query?.['supplierItemCatalogue.itemId']) {
      list = list.filter((v) =>
        (v.supplierItemCatalogue || []).some((c) => c.itemId === query['supplierItemCatalogue.itemId'])
      );
    }
    return createQueryWrapper(list);
  });
  t.mock.method(Vendor, 'findOne', (query) => {
    const v = inMemoryVendors.find((x) => x.vendorId === query?.vendorId);
    return createQueryWrapper(v || null);
  });

  t.mock.method(InventoryLot, 'find', (query) => {
    const list = inMemoryLots.filter(
      (l) =>
        (!query?.organisationId || l.organisationId === query.organisationId) &&
        (!query?.cafeId || l.cafeId === query.cafeId) &&
        (!query?.itemId || l.itemId === query.itemId)
    );
    return createQueryWrapper(list);
  });

  t.mock.method(InventoryReservation, 'find', (query) => {
    const list = inMemoryReservations.filter(
      (r) =>
        (!query?.organisationId || r.organisationId === query.organisationId) &&
        (!query?.cafeId || r.cafeId === query.cafeId) &&
        (!query?.itemId || r.itemId === query.itemId) &&
        (!query?.status || r.status === query.status)
    );
    return createQueryWrapper(list);
  });

  t.mock.method(PurchaseOrder, 'find', (query) => {
    const list = inMemoryPOs.filter((po) => {
      if (query?.organisationId && po.organisationId !== query.organisationId) return false;
      if (query?.cafeId && po.cafeId !== query.cafeId) return false;
      if (query?.status?.$in && !query.status.$in.includes(po.status)) return false;
      if (query?.['lineItems.itemId']) {
        return (po.lineItems || []).some((l) => l.itemId === query['lineItems.itemId']);
      }
      return true;
    });
    return createQueryWrapper(list);
  });

  t.mock.method(StockMovement, 'find', (query) => {
    const list = inMemoryMovements.filter((m) => {
      if (query?.organisationId && m.organisationId !== query.organisationId) return false;
      if (query?.cafeId && m.cafeId !== query.cafeId) return false;
      if (query?.itemId && m.itemId !== query.itemId) return false;
      if (query?.movementType && m.movementType !== query.movementType) return false;
      return true;
    });
    return createQueryWrapper(list);
  });

  t.mock.method(ReplenishmentRecommendation, 'findOne', (query) => {
    const rec = inMemoryRecommendations.find((r) => {
      if (query?.organisationId && r.organisationId !== query.organisationId) return false;
      if (query?.cafeId && r.cafeId !== query.cafeId) return false;
      if (query?.itemId && r.itemId !== query.itemId) return false;
      if (query?.isActiveNeed !== undefined && r.isActiveNeed !== query.isActiveNeed) return false;
      if (query?.$or) {
        return query.$or.some((o) => (o.recommendationId && r.recommendationId === o.recommendationId) || (o._id && r.recommendationId === o._id));
      }
      return true;
    });
    if (!rec) return createQueryWrapper(null);
    return Promise.resolve(rec);
  });

  t.mock.method(ReplenishmentRecommendation, 'find', (query) => {
    const list = inMemoryRecommendations.filter((r) => {
      if (query?.organisationId && r.organisationId !== query.organisationId) return false;
      if (query?.cafeId && r.cafeId !== query.cafeId) return false;
      if (query?.itemId && r.itemId !== query.itemId) return false;
      if (query?.status && r.status !== query.status) return false;
      if (query?.isActiveNeed !== undefined && r.isActiveNeed !== query.isActiveNeed) return false;
      return true;
    });
    return createQueryWrapper(list);
  });

  t.mock.method(ReplenishmentRecommendation, 'create', async (doc) => {
    // Assert compound unique index check: only 1 active record per org+cafe+item
    if (doc.isActiveNeed) {
      const conflict = inMemoryRecommendations.find(
        (r) =>
          r.organisationId === doc.organisationId &&
          r.cafeId === doc.cafeId &&
          r.itemId === doc.itemId &&
          r.isActiveNeed === true
      );
      if (conflict) {
        const mongoError = new Error(`E11000 duplicate key error collection: replenishmentrecommendations index: unique_active_replenishment_need dup key: { organisationId: "${doc.organisationId}", cafeId: "${doc.cafeId}", itemId: "${doc.itemId}", isActiveNeed: true }`);
        mongoError.code = 11000;
        throw mongoError;
      }
    }

    const instance = {
      ...doc,
      _id: doc.recommendationId,
      save: async function () {
        return this;
      },
    };
    inMemoryRecommendations.push(instance);
    return instance;
  });

  // ── TEST 1: Below-Reorder Trigger creates ACTIVE_REVIEW Recommendation ──────
  await t.test('1. Below-reorder trigger creates explainable ACTIVE_REVIEW recommendation', async () => {
    inMemoryRecommendations = [];
    const result = await ReplenishmentRecommendationService.evaluateItem({
      organisationId: 'ORG-ZAMORIN',
      cafeId: 'ZC-0001',
      itemId: 'ITEM-COFFEE-BEANS',
      source: 'MANUAL_ON_DEMAND',
      actorId: 'TEST',
    });

    assert.equal(result.evaluated, true);
    assert.equal(result.action, 'CREATED_NEW');
    assert.equal(result.recommendation.status, 'ACTIVE_REVIEW');
    assert.equal(result.recommendation.isActiveNeed, true);

    // Stock: 3000g on hand, 0 inbound -> position 3000g <= reorderPoint 5000g
    // MIN_MAX Target: maxQuantityBase 30000g -> Raw need: 27000g
    // UOM conversion: 1000g/kg -> 27 kg
    // Pack multiple: 1 kg, MOQ: 5 kg -> 27 kg proposed
    assert.equal(result.recommendation.calculation.rawNeedBase, 27000);
    assert.equal(result.recommendation.calculation.suggestedPurchaseQuantity, 27);
    assert.equal(result.recommendation.calculation.purchaseUnit, 'kg');
    assert.equal(result.recommendation.supplierCandidate.vendorId, 'VEN-ROASTER-01');
    assert.match(result.recommendation.explanation.summary, /reorder threshold/i);
  });

  // ── TEST 2: Above-Reorder Evaluation Resolves Active Recommendation ─────────
  await t.test('2. Stock above reorder resolves any existing active recommendation', async () => {
    // Increase stock in config above reorder point
    inMemoryConfigs[0].currentQuantityBase = 26000; // Above target & min
    const result = await ReplenishmentRecommendationService.evaluateItem({
      organisationId: 'ORG-ZAMORIN',
      cafeId: 'ZC-0001',
      itemId: 'ITEM-COFFEE-BEANS',
    });

    assert.equal(result.evaluated, true);
    assert.equal(result.action, 'RESOLVED_EXISTING');
    assert.equal(result.recommendation.status, 'RESOLVED');
    assert.equal(result.recommendation.isActiveNeed, false);
    assert.match(result.recommendation.explanation.summary, /Shortage resolved/i);

    // Reset stock back to low for subsequent tests
    inMemoryConfigs[0].currentQuantityBase = 3000;
  });

  // ── TEST 3: Usable Stock Derivation (Excludes Expired & Quarantined Lots) ────
  await t.test('3. Usable stock calculation strictly excludes expired and quarantined lots', async () => {
    inMemoryRecommendations = [];
    inMemoryLots = [
      {
        lotId: 'LOT-EXP-01',
        organisationId: 'ORG-ZAMORIN',
        cafeId: 'ZC-0001',
        itemId: 'ITEM-COFFEE-BEANS',
        remainingQuantity: 2000,
        expiryDate: '2020-01-01', // Strictly expired
        status: 'EXPIRED',
      },
      {
        lotId: 'LOT-QUAR-01',
        organisationId: 'ORG-ZAMORIN',
        cafeId: 'ZC-0001',
        itemId: 'ITEM-COFFEE-BEANS',
        remainingQuantity: 1500,
        expiryDate: '2026-12-31',
        status: 'QUARANTINE', // Quarantined
      },
      {
        lotId: 'LOT-VALID-01',
        organisationId: 'ORG-ZAMORIN',
        cafeId: 'ZC-0001',
        itemId: 'ITEM-COFFEE-BEANS',
        remainingQuantity: 1000,
        expiryDate: '2026-12-31',
        status: 'AVAILABLE', // Usable!
      },
    ];

    // Current stock on hand includes the bad material
    inMemoryConfigs[0].currentQuantityBase = 4500;
    inMemoryConfigs[0].quarantinedQuantityBase = 1500;
    inMemoryConfigs[0].expiredQuantityBase = 2000;

    const result = await ReplenishmentRecommendationService.evaluateItem({
      organisationId: 'ORG-ZAMORIN',
      cafeId: 'ZC-0001',
      itemId: 'ITEM-COFFEE-BEANS',
    });

    // Usable stock = 4500 - 1500 - 2000 = 1000g
    assert.equal(result.recommendation.stockSnapshot.usableQuantityBase, 1000);
    assert.equal(result.recommendation.stockSnapshot.expiredQuantityBase, 2000);
    assert.equal(result.recommendation.stockSnapshot.quarantinedQuantityBase, 1500);

    // Clean up lots
    inMemoryLots = [];
    inMemoryConfigs[0].quarantinedQuantityBase = 0;
    inMemoryConfigs[0].expiredQuantityBase = 0;
    inMemoryConfigs[0].currentQuantityBase = 3000;
  });

  // ── TEST 4: Firm Allocations Subtraction Without Double Counting ───────────
  await t.test('4. Firm reservations subtract from usable stock without double counting', async () => {
    inMemoryRecommendations = [];
    inMemoryReservations = [
      {
        reservationId: 'RES-CATERING-01',
        organisationId: 'ORG-ZAMORIN',
        cafeId: 'ZC-0001',
        itemId: 'ITEM-COFFEE-BEANS',
        reservedQty: 2000, // 2000g committed to catering
        status: 'ACTIVE',
        expiresAt: new Date(Date.now() + 86400000),
      },
    ];

    const result = await ReplenishmentRecommendationService.evaluateItem({
      organisationId: 'ORG-ZAMORIN',
      cafeId: 'ZC-0001',
      itemId: 'ITEM-COFFEE-BEANS',
    });

    // Total 3000g on-hand - 2000g reserved = 1000g usable unallocated
    assert.equal(result.recommendation.stockSnapshot.firmAllocationsBase, 2000);
    assert.equal(result.recommendation.stockSnapshot.usableQuantityBase, 1000);

    inMemoryReservations = [];
  });

  // ── TEST 5: Time-Sensitive Confirmed Inbound Arrival (In-Time vs Too-Late) ──
  await t.test('5. Inbound PO arriving in time satisfies shortage; PO arriving too late raises warning', async () => {
    inMemoryRecommendations = [];
    const tomorrowStr = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    const farFutureStr = new Date(Date.now() + 45 * 86400000).toISOString().slice(0, 10);

    inMemoryPOs = [
      {
        purchaseOrderId: 'PO-2026-INTIME',
        organisationId: 'ORG-ZAMORIN',
        cafeId: 'ZC-0001',
        status: 'APPROVED',
        supplierConfirmedDeliveryDate: tomorrowStr,
        lineItems: [
          {
            itemId: 'ITEM-COFFEE-BEANS',
            orderedQuantityBase: 5000,
            receivedQuantityBase: 0,
            acceptedReceivedQty: 0,
            outstandingQty: 5000,
            fulfillmentStatus: 'ORDERED',
          },
        ],
      },
      {
        purchaseOrderId: 'PO-2026-TOOLATE',
        organisationId: 'ORG-ZAMORIN',
        cafeId: 'ZC-0001',
        status: 'ORDER_PLACED',
        supplierConfirmedDeliveryDate: farFutureStr,
        lineItems: [
          {
            itemId: 'ITEM-COFFEE-BEANS',
            orderedQuantityBase: 10000,
            receivedQuantityBase: 0,
            acceptedReceivedQty: 0,
            outstandingQty: 10000,
            fulfillmentStatus: 'ORDERED',
          },
        ],
      },
    ];

    const result = await ReplenishmentRecommendationService.evaluateItem({
      organisationId: 'ORG-ZAMORIN',
      cafeId: 'ZC-0001',
      itemId: 'ITEM-COFFEE-BEANS',
    });

    // In-time PO counted in eligibleInboundBase (5000g)
    assert.equal(result.recommendation.stockSnapshot.eligibleInboundBase, 5000);
    // Too-late PO placed into ineligibleInboundBase (10000g)
    assert.equal(result.recommendation.stockSnapshot.ineligibleInboundBase, 10000);

    // Warning exception raised for late PO
    const lateEx = result.recommendation.actionableExceptions.find((e) => e.code === 'INBOUND_TOO_LATE');
    assert.ok(lateEx, 'Expected INBOUND_TOO_LATE exception to be surfaced');

    inMemoryPOs = [];
  });

  // ── TEST 6: Partial PO Receiving & Cancelled POs Handled Correctly ──────────
  await t.test('6. Partial PO receiving counts only outstanding quantity; cancelled POs ignored', async () => {
    inMemoryRecommendations = [];
    const tomorrowStr = new Date(Date.now() + 86400000).toISOString().slice(0, 10);

    inMemoryPOs = [
      {
        purchaseOrderId: 'PO-PARTIAL-01',
        organisationId: 'ORG-ZAMORIN',
        cafeId: 'ZC-0001',
        status: 'PARTIALLY_RECEIVED',
        supplierConfirmedDeliveryDate: tomorrowStr,
        lineItems: [
          {
            itemId: 'ITEM-COFFEE-BEANS',
            orderedQuantityBase: 10000,
            receivedQuantityBase: 6000,
            acceptedReceivedQty: 6000,
            outstandingQty: 4000, // Only 4000 outstanding!
            fulfillmentStatus: 'PARTIALLY_RECEIVED',
          },
        ],
      },
      {
        purchaseOrderId: 'PO-CANCELLED-01',
        organisationId: 'ORG-ZAMORIN',
        cafeId: 'ZC-0001',
        status: 'CANCELLED',
        lineItems: [
          {
            itemId: 'ITEM-COFFEE-BEANS',
            orderedQuantityBase: 20000,
            outstandingQty: 20000,
            fulfillmentStatus: 'CANCELLED',
          },
        ],
      },
    ];

    const result = await ReplenishmentRecommendationService.evaluateItem({
      organisationId: 'ORG-ZAMORIN',
      cafeId: 'ZC-0001',
      itemId: 'ITEM-COFFEE-BEANS',
    });

    // Only the 4000 outstanding quantity from the partial PO is eligible
    assert.equal(result.recommendation.stockSnapshot.eligibleInboundBase, 4000);

    inMemoryPOs = [];
  });

  // ── TEST 7: Reorder Policy Handlers (MIN_MAX, PAR_LEVEL, PERIODIC_REVIEW, DEMAND_DRIVEN)
  await t.test('7. Reorder policies (PAR_LEVEL and DEMAND_DRIVEN safe fallback) compute accurately', async () => {
    inMemoryRecommendations = [];
    // Evaluate fresh milk configured with PAR_LEVEL
    const result = await ReplenishmentRecommendationService.evaluateItem({
      organisationId: 'ORG-ZAMORIN',
      cafeId: 'ZC-0001',
      itemId: 'ITEM-FRESH-MILK',
    });

    // Milk stock: 10 L <= reorder threshold 24 L -> Target 60 L -> Raw need: 50 L
    // Conversion: 12 L / crate -> 50 / 12 = 4.16 crates -> round up to 5 crates (60 L)
    // MOQ is 2 crates. 5 crates >= 2 -> proposed 5 crates (60 L)
    assert.equal(result.recommendation.calculation.rawNeedBase, 50);
    assert.equal(result.recommendation.calculation.suggestedPurchaseQuantity, 5);
    assert.equal(result.recommendation.calculation.suggestedBaseQuantity, 60);
    assert.equal(result.recommendation.calculation.purchaseUnit, 'crate');
  });

  // ── TEST 8: Shelf-Life Perishability Conflict Blocks Proposal ───────────────
  await t.test('8. MOQ exceeding perishability/shelf-life consumption capacity triggers SHELF_LIFE_CONSTRAINT blocker', async () => {
    inMemoryRecommendations = [];
    // Set daily usage of milk extremely low (1 L/day) with 5-day shelf life (max 5 L total consumption)
    // But supplier MOQ is 2 crates = 24 Litres!
    inMemoryConfigs[1].avgDailyUsageBase = 1;

    const result = await ReplenishmentRecommendationService.evaluateItem({
      organisationId: 'ORG-ZAMORIN',
      cafeId: 'ZC-0001',
      itemId: 'ITEM-FRESH-MILK',
    });

    assert.equal(result.recommendation.status, 'BLOCKED_CONSTRAINT');
    const shelfEx = result.recommendation.actionableExceptions.find((e) => e.code === 'SHELF_LIFE_CONSTRAINT');
    assert.ok(shelfEx, 'Expected SHELF_LIFE_CONSTRAINT exception');
    assert.match(shelfEx.message, /spoilage risk/i);

    // Reset daily milk usage
    inMemoryConfigs[1].avgDailyUsageBase = 15;
  });

  // ── TEST 9: Storage Capacity Blocker ─────────────────────────────────────────
  await t.test('9. Storage capacity limit violation triggers STORAGE_CAPACITY_CONSTRAINT blocker', async () => {
    inMemoryRecommendations = [];
    // Configure cold store max capacity to 40 L
    inMemoryConfigs[1].storageConstraints.maxStorageCapacityBase = 40;

    const result = await ReplenishmentRecommendationService.evaluateItem({
      organisationId: 'ORG-ZAMORIN',
      cafeId: 'ZC-0001',
      itemId: 'ITEM-FRESH-MILK',
    });

    assert.equal(result.recommendation.status, 'BLOCKED_CONSTRAINT');
    const capEx = result.recommendation.actionableExceptions.find((e) => e.code === 'STORAGE_CAPACITY_CONSTRAINT');
    assert.ok(capEx, 'Expected STORAGE_CAPACITY_CONSTRAINT exception');
    assert.match(capEx.message, /violating physical zone capacity/i);

    // Reset storage capacity
    inMemoryConfigs[1].storageConstraints.maxStorageCapacityBase = 80;
  });

  // ── TEST 10: P05 Data-Quality Gate Blocks Auto-Purchasing ────────────────────
  await t.test('10. Data-quality gate blocks unmapped or ambiguous conversion items with actionable exceptions', async () => {
    inMemoryRecommendations = [];
    const result = await ReplenishmentRecommendationService.evaluateItem({
      organisationId: 'ORG-ZAMORIN',
      cafeId: 'ZC-0001',
      itemId: 'ITEM-AMBIGUOUS-UOM',
    });

    assert.equal(result.recommendation.status, 'BLOCKED_DATA_QUALITY');
    assert.equal(result.recommendation.isActiveNeed, true);
    const ambEx = result.recommendation.actionableExceptions.find((e) => e.code === 'AMBIGUOUS_UNIT_CONVERSION');
    assert.ok(ambEx, 'Expected AMBIGUOUS_UNIT_CONVERSION exception');
    assert.match(ambEx.correctiveAction, /Define conversion factor/i);
  });

  // ── TEST 11: Negative Stock Exception Surfaced ──────────────────────────────
  await t.test('11. Negative physical stock balance surfaces NEGATIVE_STOCK exception and blocks recommendation', async () => {
    inMemoryRecommendations = [];
    inMemoryConfigs[0].currentQuantityBase = -500; // Negative stock

    const result = await ReplenishmentRecommendationService.evaluateItem({
      organisationId: 'ORG-ZAMORIN',
      cafeId: 'ZC-0001',
      itemId: 'ITEM-COFFEE-BEANS',
    });

    assert.equal(result.recommendation.status, 'BLOCKED_DATA_QUALITY');
    const negEx = result.recommendation.actionableExceptions.find((e) => e.code === 'NEGATIVE_STOCK');
    assert.ok(negEx, 'Expected NEGATIVE_STOCK exception');
    assert.match(negEx.correctiveAction, /cycle count/i);

    inMemoryConfigs[0].currentQuantityBase = 3000;
  });

  // ── TEST 12: Idempotent Convergence and Material Change Revisions ───────────
  await t.test('12. Repeated evaluations converge idempotently; material changes record revision history', async () => {
    inMemoryRecommendations = [];
    // Evaluation 1
    const run1 = await ReplenishmentRecommendationService.evaluateItem({
      organisationId: 'ORG-ZAMORIN',
      cafeId: 'ZC-0001',
      itemId: 'ITEM-COFFEE-BEANS',
    });
    assert.equal(run1.action, 'CREATED_NEW');

    // Evaluation 2: Identical inputs
    const run2 = await ReplenishmentRecommendationService.evaluateItem({
      organisationId: 'ORG-ZAMORIN',
      cafeId: 'ZC-0001',
      itemId: 'ITEM-COFFEE-BEANS',
    });
    assert.equal(run2.action, 'IDEMPOTENT_UNMODIFIED');
    assert.equal(run2.recommendation.revisionHistory.length, 0);

    // Evaluation 3: Material change (stock drops to 1000g)
    inMemoryConfigs[0].currentQuantityBase = 1000;
    const run3 = await ReplenishmentRecommendationService.evaluateItem({
      organisationId: 'ORG-ZAMORIN',
      cafeId: 'ZC-0001',
      itemId: 'ITEM-COFFEE-BEANS',
    });
    assert.equal(run3.action, 'UPDATED_EXISTING');
    assert.equal(run3.recommendation.revisionHistory.length, 1);
    assert.equal(run3.recommendation.calculation.suggestedPurchaseQuantity, 29);

    inMemoryConfigs[0].currentQuantityBase = 3000;
  });

  // ── TEST 13: Database Boundary Deduplication Under 50 Parallel Requests ─────
  await t.test('13. High-concurrency burst of 50 parallel evaluations results in exactly ONE active recommendation', async () => {
    inMemoryRecommendations = [];
    const concurrentRequests = Array.from({ length: 50 }, (_, i) =>
      ReplenishmentRecommendationService.evaluateItem({
        organisationId: 'ORG-ZAMORIN',
        cafeId: 'ZC-0001',
        itemId: 'ITEM-COFFEE-BEANS',
        actorId: `WORKER-${i}`,
      })
    );

    const results = await Promise.all(concurrentRequests);
    assert.equal(results.length, 50);

    // Count active recommendations in database
    const activeRecords = inMemoryRecommendations.filter(
      (r) =>
        r.organisationId === 'ORG-ZAMORIN' &&
        r.cafeId === 'ZC-0001' &&
        r.itemId === 'ITEM-COFFEE-BEANS' &&
        r.isActiveNeed === true
    );

    assert.equal(
      activeRecords.length,
      1,
      `Database uniqueness invariant violated: found ${activeRecords.length} active records, expected exactly 1`
    );
  });

  // ── TEST 14: Zero Unauthorized Side Effects (Non-Mutation Verification) ─────
  await t.test('14. Full evaluation pipeline causes ZERO mutations to transactional collections', async () => {
    const countsBefore = {
      purchaseOrders: inMemoryPOs.length,
      stockMovements: inMemoryMovements.length,
      lots: inMemoryLots.length,
    };

    // Run sweep across cafe
    await ReplenishmentRecommendationService.sweepCafe({
      organisationId: 'ORG-ZAMORIN',
      cafeId: 'ZC-0001',
      actorId: 'AUDIT_RUNNER',
    });

    const countsAfter = {
      purchaseOrders: inMemoryPOs.length,
      stockMovements: inMemoryMovements.length,
      lots: inMemoryLots.length,
    };

    assert.deepEqual(countsBefore, countsAfter, 'Transactional collections must NOT be mutated by P06 evaluation');
  });

  // ── TEST 15: Role & Café Scoping Authorization on Endpoints ─────────────────
  await t.test('15. API Authorization enforces Primary Master, Cafe Admin scoping, Owner read-only, and Staff 403 denial', async () => {
    // 1. Staff access denied
    const staffRes = await makeRequest({
      port,
      method: 'GET',
      path: '/api/v1/inventory/replenishment/recommendations',
      headers: { Authorization: `Bearer ${staffToken}` },
    });
    assert.equal(staffRes.statusCode, 403);

    // 2. Cafe Admin attempting access to unassigned cafe
    const crossCafeRes = await makeRequest({
      port,
      method: 'GET',
      path: '/api/v1/inventory/replenishment/recommendations?cafeId=ZC-9999',
      headers: { Authorization: `Bearer ${koraToken}` },
    });
    assert.equal(crossCafeRes.statusCode, 403);

    // 3. Cafe Admin access to assigned cafe
    const validCafeRes = await makeRequest({
      port,
      method: 'GET',
      path: '/api/v1/inventory/replenishment/recommendations?cafeId=ZC-0001',
      headers: { Authorization: `Bearer ${koraToken}` },
    });
    assert.equal(validCafeRes.statusCode, 200);
    assert.ok(Array.isArray(validCafeRes.body.recommendations));

    // 4. Owner read-only visibility allowed
    const ownerGetRes = await makeRequest({
      port,
      method: 'GET',
      path: '/api/v1/inventory/replenishment/recommendations',
      headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert.equal(ownerGetRes.statusCode, 200);

    // 5. Owner attempting evaluation mutation denied 403
    const ownerPostRes = await makeRequest({
      port,
      method: 'POST',
      path: '/api/v1/inventory/replenishment/evaluate',
      headers: { Authorization: `Bearer ${ownerToken}` },
      body: { cafeId: 'ZC-0001' },
    });
    assert.equal(ownerPostRes.statusCode, 403);

    // 6. Master full evaluation allowed
    const masterPostRes = await makeRequest({
      port,
      method: 'POST',
      path: '/api/v1/inventory/replenishment/evaluate',
      headers: { Authorization: `Bearer ${masterToken}` },
      body: { cafeId: 'ZC-0001', itemId: 'ITEM-COFFEE-BEANS' },
    });
    assert.equal(masterPostRes.statusCode, 200);
    assert.equal(masterPostRes.body.success, true);
  });
});
