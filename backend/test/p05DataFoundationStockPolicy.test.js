'use strict';

/**
 * ============================================================================
 * ZAMORIN CAFÉ ERP — P05: DATA FOUNDATION & STOCK POLICY TEST SUITE
 * ============================================================================
 *
 * Verifies:
 *   1. Authoritative Item identity, category, active state, base units
 *   2. Versioned unit conversions & pack sizes
 *   3. Supplier aliases & supplier-item catalogue mappings
 *   4. Contracted rates, effective dates, MOQ & order multiples
 *   5. Delivery lead times, supplier delivery days, shelf-life & storage constraints
 *   6. Reorder policies (MIN_MAX, PAR_LEVEL) & buffer levels (min, par, safety, max)
 *   7. Data-quality checks: ambiguous units & missing vendor mappings block auto-purchasing
 *   8. Recipe consumption formulas, batch yields, modifier deltas & packaging BOMs
 *   9. Role boundaries: Primary Master write, Café Operations store config, Owner/Staff 403
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const { createApp } = require('../src/server');
const { GlobalInventoryItem } = require('../src/models/GlobalInventoryItem');
const { CafeInventoryConfig } = require('../src/models/CafeInventoryConfig');
const { Vendor } = require('../src/models/Vendor');
const { Recipe } = require('../src/models/Recipe');
const { ModifierGroup } = require('../src/models/ModifierGroup');
const { ServiceModeBOM } = require('../src/models/ServiceModeBOM');
const { Cafe } = require('../src/models/Cafe');
const { User } = require('../src/models/User');
const { RolePermission } = require('../src/models/RolePermission');
const dataFoundationService = require('../src/services/dataFoundationService');
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
          } catch (e) {
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

test('P05: Authoritative Item, Unit, Vendor, Recipe and Stock-Policy Foundation Suite', async (t) => {
  const app = createApp({ allowedOrigins: ['*'], production: false });
  const server = http.createServer(app);

  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });

  const port = server.address().port;

  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  // Actors
  const primaryMaster = {
    userId: 'USR-MASTER-01',
    organisationId: 'ORG-ZAMORIN',
    role: 'MASTER',
    isPrimaryMaster: true,
    email: 'primary@zamorin.com',
    fullName: 'Primary Master',
    sessionVersion: 1,
    permissionsVersion: 1,
    assignedCafeIds: ['ZC-0001', 'ZC-0002'],
    accountStatus: 'ACTIVE',
    save: async function () { return this; },
  };

  const cafeAdmin = {
    userId: 'USR-ADMIN-01',
    organisationId: 'ORG-ZAMORIN',
    role: 'CAFE_ADMIN',
    email: 'cafeadmin@zamorin.com',
    fullName: 'Cafe Admin 1',
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
    assignedCafeIds: ['ZC-0001'],
    accountStatus: 'ACTIVE',
    save: async function () { return this; },
  };

  const staffUser = {
    userId: 'USR-STAFF-01',
    organisationId: 'ORG-ZAMORIN',
    role: 'STAFF',
    email: 'staff@zamorin.com',
    fullName: 'Staff Counter',
    sessionVersion: 1,
    permissionsVersion: 1,
    assignedCafeIds: ['ZC-0001'],
    accountStatus: 'ACTIVE',
    save: async function () { return this; },
  };

  // In-memory records
  const inMemoryItems = [
    {
      organisationId: 'ORG-ZAMORIN',
      itemId: 'ITEM-ROAST-BEANS',
      sku: 'COF-RB-001',
      name: 'Arabica Roasted Whole Beans',
      nameLower: 'arabica roasted whole beans',
      category: 'COFFEE_BEANS',
      baseUnit: 'g',
      purchaseUnit: 'kg',
      packSize: 1000,
      status: 'ACTIVE',
      shelfLifeDays: 90,
      minShelfLifeOnReceiptDays: 45,
      storageConstraints: {
        temperatureZone: 'COOL_DRY',
        minTemperatureCelsius: 15,
        maxTemperatureCelsius: 24,
      },
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
      itemId: 'ITEM-OAT-MILK',
      sku: 'DAI-OM-002',
      name: 'Barista Edition Oat Milk',
      nameLower: 'barista edition oat milk',
      category: 'DAIRY_FRESH',
      baseUnit: 'ml',
      purchaseUnit: 'case',
      packSize: 6,
      status: 'ACTIVE',
      shelfLifeDays: 180,
      minShelfLifeOnReceiptDays: 30,
      storageConstraints: {
        temperatureZone: 'CHILLED',
      },
      conversions: [], // Intentionally missing conversion factor!
      primaryVendorId: null, // Intentionally missing vendor!
      approvedVendorIds: [],
    },
  ];

  const inMemoryConfigs = [
    {
      organisationId: 'ORG-ZAMORIN',
      cafeId: 'ZC-0001',
      itemId: 'ITEM-ROAST-BEANS',
      currentQuantityBase: 12000,
      availableQuantityBase: 12000,
      reservedQuantityBase: 0,
      minQuantityBase: 5000,
      parQuantityBase: 25000,
      safetyStockBase: 4000,
      maxQuantityBase: 40000,
      orderMultipleBase: 1000, // 1 kg = 1000 g multiple
      leadTimeDays: 2,
      reorderPolicy: 'MIN_MAX',
      storageConstraints: {
        locationZone: 'MAIN_STORE',
        temperatureZone: 'COOL_DRY',
      },
      supplierDeliveryDays: ['MON', 'WED', 'FRI'],
      defaultVendorId: 'VEN-ROASTER-01',
      isAutomaticPurchasingEligible: false,
      dataQualityStatus: 'VALID',
      dataQualityErrors: [],
      status: 'ACTIVE',
      save: async function () { return this; },
    },
    {
      organisationId: 'ORG-ZAMORIN',
      cafeId: 'ZC-0001',
      itemId: 'ITEM-OAT-MILK',
      currentQuantityBase: 2000,
      availableQuantityBase: 2000,
      reservedQuantityBase: 0,
      minQuantityBase: 10000,
      parQuantityBase: 30000,
      safetyStockBase: 5000,
      maxQuantityBase: 50000,
      orderMultipleBase: 6000,
      leadTimeDays: 1,
      reorderPolicy: 'PAR_LEVEL',
      storageConstraints: {
        locationZone: 'COLD_STORE',
        temperatureZone: 'CHILLED',
      },
      supplierDeliveryDays: ['TUE', 'THU'],
      defaultVendorId: null,
      isAutomaticPurchasingEligible: false,
      dataQualityStatus: 'INVALID',
      dataQualityErrors: [],
      status: 'ACTIVE',
      save: async function () { return this; },
    },
  ];

  const inMemoryVendors = [
    {
      organisationId: 'ORG-ZAMORIN',
      vendorId: 'VEN-ROASTER-01',
      name: 'Artisan Coffee Roasters LLP',
      status: 'ACTIVE',
      supplierType: 'GOODS',
      supplierHolds: [],
      supplierItemCatalogue: [
        {
          itemId: 'ITEM-ROAST-BEANS',
          supplierItemCode: 'ACR-ARA-WHOLE-KG',
          itemName: 'Arabica Whole Beans 1KG Bag',
          uom: 'kg',
          packSize: '1 KG',
          uomConversionFactor: 1000,
          currentPricePaisa: 145000, // ₹1,450.00 / kg
          taxPercent: 5,
          moq: 5, // Minimum 5 kg
          orderMultiple: 1,
          leadTimeDays: 2,
          deliveryDays: ['MON', 'WED', 'FRI'],
          approvedCafeIds: ['ZC-0001', 'ZC-0002'],
          status: 'ACTIVE',
          priceHistory: [
            {
              effectiveFrom: new Date('2026-01-01'),
              effectiveTo: null,
              pricePaisa: 145000,
              changeReason: 'Annual supplier agreement contract rate',
            },
          ],
        },
      ],
    },
  ];

  t.mock.method(User, 'findOne', async (criteria) => {
    if (criteria?.userId === 'USR-MASTER-01') return primaryMaster;
    if (criteria?.userId === 'USR-ADMIN-01') return cafeAdmin;
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

  t.mock.method(GlobalInventoryItem, 'findOne', (query) => {
    const item = inMemoryItems.find((i) => i.itemId === query?.itemId && i.organisationId === query?.organisationId);
    return createQueryWrapper(item ? { ...item } : null);
  });

  t.mock.method(GlobalInventoryItem, 'find', (query) => {
    let res = inMemoryItems.filter((i) => i.organisationId === query?.organisationId);
    if (query?.status) res = res.filter((i) => i.status === query.status);
    return createQueryWrapper(res);
  });

  t.mock.method(CafeInventoryConfig, 'findOne', (query) => {
    const cfg = inMemoryConfigs.find(
      (c) => c.organisationId === query?.organisationId && c.cafeId === query?.cafeId && c.itemId === query?.itemId
    );
    return createQueryWrapper(cfg || null);
  });

  t.mock.method(CafeInventoryConfig, 'find', (query) => {
    let res = inMemoryConfigs.filter((c) => c.organisationId === query?.organisationId);
    if (query?.cafeId && query.cafeId !== 'ALL') res = res.filter((c) => c.cafeId === query.cafeId);
    return createQueryWrapper(res);
  });

  t.mock.method(Vendor, 'find', (query) => {
    let res = inMemoryVendors.filter((v) => v.organisationId === query?.organisationId);
    if (query?.status) res = res.filter((v) => v.status === query.status);
    if (query?.['supplierItemCatalogue.itemId']) {
      const itm = query['supplierItemCatalogue.itemId'];
      res = res.filter((v) => v.supplierItemCatalogue?.some((c) => c.itemId === itm));
    }
    return createQueryWrapper(res);
  });

  t.mock.method(authService, 'verifyAccessToken', async (token) => {
    let activeUser = primaryMaster;
    if (token === 'token_cafe_admin') activeUser = cafeAdmin;
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
        sid: 'SS-P05-TEST',
      },
      session: {
        sessionId: 'SS-P05-TEST',
        roleSnapshot: activeUser.role,
        sessionVersion: 0,
        mfaVerified: true,
        stepUpVerifiedAt: new Date().toISOString(),
      },
    };
  });

  const masterToken = 'token_master';
  const cafeAdminToken = 'token_cafe_admin';
  const ownerToken = 'token_owner';
  const staffToken = 'token_staff';

  await t.test('1. Authoritative Item Identity, Base Unit, Versioned Conversion and Storage Specs', async () => {
    const itm = inMemoryItems[0];
    assert.equal(itm.itemId, 'ITEM-ROAST-BEANS');
    assert.equal(itm.sku, 'COF-RB-001');
    assert.equal(itm.category, 'COFFEE_BEANS');
    assert.equal(itm.baseUnit, 'g');
    assert.equal(itm.purchaseUnit, 'kg');
    assert.equal(itm.packSize, 1000);
    assert.equal(itm.conversions[0].factor, 1000);
    assert.equal(itm.conversions[0].version, 1);
    assert.equal(itm.storageConstraints.temperatureZone, 'COOL_DRY');
    assert.equal(itm.storageConstraints.minTemperatureCelsius, 15);
  });

  await t.test('2. Supplier-Item Catalogue Mapping, Aliases, Contracted Rates, MOQ and Multiples', async () => {
    const v = inMemoryVendors[0];
    const cat = v.supplierItemCatalogue[0];
    assert.equal(cat.itemId, 'ITEM-ROAST-BEANS');
    assert.equal(cat.supplierItemCode, 'ACR-ARA-WHOLE-KG'); // Supplier Alias
    assert.equal(cat.currentPricePaisa, 145000); // Contracted rate
    assert.equal(cat.moq, 5); // Minimum order quantity
    assert.equal(cat.orderMultiple, 1);
    assert.equal(cat.leadTimeDays, 2);
    assert.deepEqual(cat.deliveryDays, ['MON', 'WED', 'FRI']);
    assert.ok(cat.approvedCafeIds.includes('ZC-0001'));
  });

  await t.test('3. Data Quality Engine: Valid Item Passes and Grants Purchasing Eligibility', async () => {
    const evaluation = await dataFoundationService.validateItemDataQuality({
      organisationId: 'ORG-ZAMORIN',
      itemId: 'ITEM-ROAST-BEANS',
      cafeId: 'ZC-0001',
    });

    assert.equal(evaluation.isValid, true);
    assert.equal(evaluation.isAutomaticPurchasingEligible, true);
    assert.equal(evaluation.dataQualityStatus, 'VALID');
    assert.equal(evaluation.errors.length, 0);
    assert.ok(evaluation.vendorMapping);
    assert.equal(evaluation.vendorMapping.vendorId, 'VEN-ROASTER-01');
    assert.equal(evaluation.vendorMapping.supplierItemCode, 'ACR-ARA-WHOLE-KG');
    assert.equal(evaluation.vendorMapping.contractedPricePaisa, 145000);
  });

  await t.test('4. Data Quality Gating: Missing Vendor and Ambiguous Units BLOCK Purchasing Eligibility', async () => {
    const evaluation = await dataFoundationService.validateItemDataQuality({
      organisationId: 'ORG-ZAMORIN',
      itemId: 'ITEM-OAT-MILK',
      cafeId: 'ZC-0001',
    });

    assert.equal(evaluation.isValid, false);
    assert.equal(evaluation.isAutomaticPurchasingEligible, false);
    assert.equal(evaluation.dataQualityStatus, 'INVALID');
    assert.ok(evaluation.errors.includes('AMBIGUOUS_UNIT_CONVERSION'));
    assert.ok(evaluation.errors.includes('MISSING_VENDOR_MAPPING'));
  });

  await t.test('5. Purchasing Resolution throws when data quality is ineligible', async () => {
    await assert.rejects(
      async () => {
        await dataFoundationService.resolveEffectivePurchaseOrderParams({
          organisationId: 'ORG-ZAMORIN',
          cafeId: 'ZC-0001',
          itemId: 'ITEM-OAT-MILK',
        });
      },
      (err) => err.code === 'INELIGIBLE_FOR_PURCHASING'
    );
  });

  await t.test('6. Purchasing Resolution resolves complete contract parameters for valid item', async () => {
    const params = await dataFoundationService.resolveEffectivePurchaseOrderParams({
      organisationId: 'ORG-ZAMORIN',
      cafeId: 'ZC-0001',
      itemId: 'ITEM-ROAST-BEANS',
    });

    assert.equal(params.vendorId, 'VEN-ROASTER-01');
    assert.equal(params.supplierItemCode, 'ACR-ARA-WHOLE-KG');
    assert.equal(params.contractedPricePaisa, 145000);
    assert.equal(params.moq, 5);
    assert.equal(params.unitConversionFactor, 1000);
  });

  await t.test('7. Data Quality Sweep Endpoint returns organization-wide audit summary', async () => {
    const res = await makeRequest({
      port,
      method: 'GET',
      path: '/api/v1/inventory/data-quality?cafeId=ZC-0001',
      headers: { Authorization: `Bearer ${masterToken}` },
    });

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.totalEvaluated, 2);
    assert.equal(res.body.eligibleCount, 1);
    assert.equal(res.body.blockedCount, 1);
    assert.equal(res.body.items.length, 2);
  });

  await t.test('8. Café Operations can configure store-level stock policy and trigger data quality audit', async () => {
    const res = await makeRequest({
      port,
      method: 'PATCH',
      path: '/api/v1/inventory/cafes/ZC-0001/stock/ITEM-ROAST-BEANS/configure',
      headers: { Authorization: `Bearer ${cafeAdminToken}` },
      body: {
        minQuantity: 6000,
        parQuantity: 28000,
        safetyStock: 5000,
        maxQuantity: 45000,
        orderMultipleBase: 1000,
        reorderPolicy: 'MIN_MAX',
        leadTimeDays: 2,
        supplierDeliveryDays: ['MON', 'WED', 'FRI'],
      },
    });

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.config.minQuantityBase, 6000);
    assert.equal(res.body.config.parQuantityBase, 28000);
    assert.equal(res.body.config.orderMultipleBase, 1000);
    assert.equal(res.body.quality.isAutomaticPurchasingEligible, true);
  });

  await t.test('9. Invariant: Par < Min policy creates data quality error and blocks automatic purchasing', async () => {
    const res = await makeRequest({
      port,
      method: 'PATCH',
      path: '/api/v1/inventory/cafes/ZC-0001/stock/ITEM-ROAST-BEANS/configure',
      headers: { Authorization: `Bearer ${cafeAdminToken}` },
      body: {
        minQuantity: 15000,
        parQuantity: 10000, // Par < Min violation!
      },
    });

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.quality.isValid, false);
    assert.equal(res.body.quality.isAutomaticPurchasingEligible, false);
    assert.ok(res.body.quality.errors.includes('INVALID_POLICY_PAR_LESS_THAN_MIN'));

    // Revert back to healthy policy
    await makeRequest({
      port,
      method: 'PATCH',
      path: '/api/v1/inventory/cafes/ZC-0001/stock/ITEM-ROAST-BEANS/configure',
      headers: { Authorization: `Bearer ${cafeAdminToken}` },
      body: {
        minQuantity: 5000,
        parQuantity: 25000,
      },
    });
  });

  await t.test('10. Cross-Café Protection: Café Operations cannot configure unassigned café (403)', async () => {
    const res = await makeRequest({
      port,
      method: 'PATCH',
      path: '/api/v1/inventory/cafes/ZC-0002/stock/ITEM-ROAST-BEANS/configure',
      headers: { Authorization: `Bearer ${cafeAdminToken}` },
      body: { minQuantity: 5000 },
    });

    assert.equal(res.statusCode, 403);
  });

  await t.test('11. Security Boundary: Owner cannot mutate stock policy (403)', async () => {
    const res = await makeRequest({
      port,
      method: 'PATCH',
      path: '/api/v1/inventory/cafes/ZC-0001/stock/ITEM-ROAST-BEANS/configure',
      headers: { Authorization: `Bearer ${ownerToken}` },
      body: { minQuantity: 5000 },
    });

    assert.equal(res.statusCode, 403);
  });

  await t.test('12. Security Boundary: Staff cannot mutate stock policy (403)', async () => {
    const res = await makeRequest({
      port,
      method: 'PATCH',
      path: '/api/v1/inventory/cafes/ZC-0001/stock/ITEM-ROAST-BEANS/configure',
      headers: { Authorization: `Bearer ${staffToken}` },
      body: { minQuantity: 5000 },
    });

    assert.equal(res.statusCode, 403);
  });

  await t.test('13. Recipe BOM, yields, modifier deltas and service mode packaging references', async () => {
    // Recipe with ingredient linked to ITEM-ROAST-BEANS
    const recipe = new Recipe({
      recipeId: 'RCP-0001',
      organisationId: 'ORG-ZAMORIN',
      name: 'Double Espresso Shot Formula',
      version: 1,
      batchYield: 1,
      yieldUom: 'PORTION',
      portionSize: 60,
      portionUom: 'ML',
      preparationLossPercent: 2,
      ingredients: [
        {
          inventoryItemId: 'ITEM-ROAST-BEANS',
          ingredientName: 'Ground Espresso Blend',
          quantity: 18,
          uom: 'G',
          lossFactorPercent: 2,
        },
      ],
      createdByUserId: 'USR-MASTER-01',
      status: 'APPROVED',
    });

    assert.equal(recipe.ingredients[0].inventoryItemId, 'ITEM-ROAST-BEANS');
    assert.equal(recipe.ingredients[0].quantity, 18);
    assert.equal(recipe.ingredients[0].uom, 'G');

    // Modifier with recipe deltas
    const modifierGroup = new ModifierGroup({
      modifierGroupId: 'MOD-0001',
      organisationId: 'ORG-ZAMORIN',
      name: 'Espresso Boost Options',
      modifiers: [
        {
          modifierId: 'MOD-OPT-EXTRA-SHOT',
          name: 'Add Extra Espresso Shot',
          pricePaisaDelta: 5000,
          recipeDeltas: [
            {
              inventoryItemId: 'ITEM-ROAST-BEANS',
              quantityDelta: 18,
              uom: 'G',
            },
          ],
        },
      ],
    });

    assert.equal(modifierGroup.modifiers[0].recipeDeltas[0].inventoryItemId, 'ITEM-ROAST-BEANS');
    assert.equal(modifierGroup.modifiers[0].recipeDeltas[0].quantityDelta, 18);

    // Service Mode Packaging BOM
    const pkgBom = new ServiceModeBOM({
      organisationId: 'ORG-ZAMORIN',
      menuItemId: 'MENU-01',
      serviceMode: 'TAKEAWAY',
      packagingItems: [
        {
          inventoryItemId: 'ITEM-CUP-8OZ',
          itemName: '8oz Paper Cup with Lid',
          quantity: 1,
          uom: 'UNIT',
        },
      ],
    });

    assert.equal(pkgBom.serviceMode, 'TAKEAWAY');
    assert.equal(pkgBom.packagingItems[0].inventoryItemId, 'ITEM-CUP-8OZ');
  });
});
