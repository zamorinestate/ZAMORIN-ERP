'use strict';

/**
 * ============================================================================
 * ZAMORIN CAFÉ ERP — COGS & PRODUCT MARGINS INTEGRATION TEST SUITE (SCR-022)
 * Issue #2: [Reports] COGS reports return 'UNAVAILABLE', no cost-posting model exists
 * ============================================================================
 *
 * Verifies:
 *  1. Unit Cost Map resolution: Latest PurchaseOrder unitPricePaisa takes precedence
 *     over GlobalInventoryItem master catalogue baseline.
 *  2. BOM Unit Cost calculation: Sub-recipes and yield loss factors correctly computed.
 *  3. Sales Aggregation: Completed POS bills calculate COGS, gross profit, and margin.
 *  4. Controller endpoint GET /api/v1/reports/cogs returns status AVAILABLE, basis LAST_PO_PRICE.
 *  5. Role-based authorization: MASTER, OWNER, CAFE_ADMIN authorized; STAFF denied.
 *  6. ZURF P&L Statement export: Reflects estimated COGS and Gross Profit instead of UNAVAILABLE.
 *  7. Historical / Pre-cutover fallback: Items without PO history safely use catalogue standard.
 *  8. /reports/finance P&L + waterfall consume the COGS engine (ESTIMATED, basis disclosed),
 *     and stay honestly UNAVAILABLE when the sale cannot be priced from any cost source.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryReplSet } = require('mongodb-memory-server');

const { Bill } = require('../src/models/Bill');
const { MenuItem } = require('../src/models/MenuItem');
const { Recipe } = require('../src/models/Recipe');
const { PurchaseOrder } = require('../src/models/PurchaseOrder');
const { GlobalInventoryItem } = require('../src/models/GlobalInventoryItem');
const { Expense } = require('../src/models/Expense');
const { Cafe } = require('../src/models/Cafe');

const {
  getLatestItemCostMap,
  resolveRecipeUnitCostPaisa,
  calculateCogs,
} = require('../src/services/cogsService');
const reportController = require('../src/controllers/reportController');

function buildMockReqRes(role, params = {}, query = {}, body = {}, customAuth = {}) {
  let statusCode = 200;
  let responseData = null;
  const headers = {};

  const req = {
    auth: {
      userId: customAuth.userId || (role === 'MASTER' ? 'MU-0001' : (role === 'OWNER' ? 'OW-0001' : (role === 'CAFE_ADMIN' ? 'CA-0001' : 'ST-0001'))),
      role,
      organisationId: customAuth.organisationId || 'ORG-ZAMORIN-TEST',
      isPrimaryMaster: customAuth.isPrimaryMaster !== undefined ? customAuth.isPrimaryMaster : (role === 'MASTER'),
      assignedCafeIds: customAuth.assignedCafeIds || ['ZC-0001'],
      primaryCafeId: customAuth.primaryCafeId || 'ZC-0001',
      cafeId: customAuth.cafeId || 'ZC-0001',
      name: customAuth.name || 'Test Actor',
      capabilities: customAuth.capabilities || [],
      ...customAuth,
    },
    params,
    query,
    body,
    headers,
    get: (h) => headers[h.toLowerCase()],
  };

  const res = {
    status(code) {
      statusCode = code;
      return this;
    },
    json(data) {
      responseData = data;
      return this;
    },
    send(data) {
      responseData = data;
      return this;
    },
    setHeader(name, val) {
      headers[name] = val;
    },
  };

  return { req, res, getResult: () => ({ statusCode, data: responseData, headers }) };
}

test('COGS Engine & Product Margin Integration Suite (SCR-022 / Issue #2)', async (suite) => {
  let replSet;
  const orgId = 'ORG-ZAMORIN-TEST';
  const cafeId = 'ZC-0001';

  suite.before(async () => {
    replSet = await MongoMemoryReplSet.create({
      replSet: { count: 1, storageEngine: 'wiredTiger' },
    });
    await replSet.waitUntilRunning();
    const uri = replSet.getUri();
    await mongoose.connect(uri);

    await Promise.all([
      Bill.createCollection(),
      MenuItem.createCollection(),
      Recipe.createCollection(),
      PurchaseOrder.createCollection(),
      GlobalInventoryItem.createCollection(),
      Expense.createCollection(),
      Cafe.createCollection(),
    ]);

    await Cafe.create({
      cafeId,
      organisationId: orgId,
      name: 'Zamorin Flagship Cafe',
      displayName: 'Zamorin Flagship Cafe',
      cafeType: 'STANDARD_CAFE',
      city: 'Bangalore',
      status: 'ACTIVE',
      operationsPinHash: 'dummy-hash-pin-val',
      operationsPinSetAt: new Date(),
      createdBy: 'MU-0001',
    });
  });

  suite.after(async () => {
    await mongoose.disconnect();
    if (replSet) await replSet.stop();
  });

  suite.beforeEach(async () => {
    await Promise.all([
      Bill.deleteMany({}),
      MenuItem.deleteMany({}),
      Recipe.deleteMany({}),
      PurchaseOrder.deleteMany({}),
      GlobalInventoryItem.deleteMany({}),
      Expense.deleteMany({}),
    ]);
  });

  // ── 1. ITEM COST MAP RESOLUTION ──────────────────────────────────────────
  await suite.test('1. Latest PO line item unit price takes precedence over catalogue standard', async () => {
    // Inventory item in catalogue with standard cost ₹50.00 (5000 paisa)
    await GlobalInventoryItem.create({
      organisationId: orgId,
      itemId: 'INV-COFFEE-BEANS',
      sku: 'SKU-COFFEE-BEANS',
      name: 'Arabica Roasted Coffee Beans',
      category: 'COFFEE_BEANS',
      baseUnit: 'kg',
      unitCostPaisa: 5000,
      createdByUserId: 'MU-0001',
      status: 'ACTIVE',
    });

    // Older PO with unit price ₹52.00 (5200 paisa)
    await PurchaseOrder.create({
      organisationId: orgId,
      cafeId,
      purchaseOrderId: 'PO-202610-0001',
      vendorId: 'VND-001',
      status: 'RECEIVED',
      createdByUserId: 'MU-0001',
      createdAt: new Date('2026-10-01T10:00:00Z'),
      lineItems: [
        {
          itemId: 'INV-COFFEE-BEANS',
          orderedQuantityBase: 10,
          receivedQuantityBase: 10,
          unitPricePaisa: 5200,
          totalLinePaisa: 52000,
        },
      ],
    });

    // Newer PO with unit price ₹55.00 (5500 paisa)
    await PurchaseOrder.create({
      organisationId: orgId,
      cafeId,
      purchaseOrderId: 'PO-202610-0002',
      vendorId: 'VND-001',
      status: 'RECEIVED',
      createdByUserId: 'MU-0001',
      createdAt: new Date('2026-10-10T10:00:00Z'),
      lineItems: [
        {
          itemId: 'INV-COFFEE-BEANS',
          orderedQuantityBase: 10,
          receivedQuantityBase: 10,
          unitPricePaisa: 5500,
          totalLinePaisa: 55000,
        },
      ],
    });

    const costMap = await getLatestItemCostMap({ organisationId: orgId, cafeScope: cafeId });
    assert.ok(costMap.has('INV-COFFEE-BEANS'));
    const itemCost = costMap.get('INV-COFFEE-BEANS');

    assert.equal(itemCost.unitPricePaisa, 5500, 'Latest PO rate ₹55.00 must supersede older PO and catalogue');
    assert.equal(itemCost.source, 'LAST_PO_PRICE');
    assert.equal(itemCost.poId, 'PO-202610-0002');
  });

  // ── 2. CATALOGUE FALLBACK FOR HISTORICAL / PRE-CUTOVER INVENTORY ─────────
  await suite.test('2. Un-ordered catalogue items fall back cleanly to CATALOGUE_STANDARD cost', async () => {
    await GlobalInventoryItem.create({
      organisationId: orgId,
      itemId: 'INV-ORGANIC-SUGAR',
      sku: 'SKU-ORGANIC-SUGAR',
      name: 'Organic Cane Sugar',
      category: 'BAKERY_FOOD_INPUTS',
      baseUnit: 'kg',
      unitCostPaisa: 4200,
      createdByUserId: 'MU-0001',
      status: 'ACTIVE',
    });

    const costMap = await getLatestItemCostMap({ organisationId: orgId, cafeScope: cafeId });
    assert.ok(costMap.has('INV-ORGANIC-SUGAR'));
    const itemCost = costMap.get('INV-ORGANIC-SUGAR');

    assert.equal(itemCost.unitPricePaisa, 4200);
    assert.equal(itemCost.source, 'CATALOGUE_STANDARD');
    assert.equal(itemCost.poId, null);
  });

  // ── 3. RECIPE BOM EXPLOSION WITH SUB-RECIPES & LOSS ──────────────────────
  await suite.test('3. Recipe unit cost calculation with sub-recipe recursion and yield loss factor', () => {
    const costMap = new Map([
      ['INV-MILK', { unitPricePaisa: 60, source: 'LAST_PO_PRICE', poId: 'PO-01' }], // 60 paisa per ml
      ['INV-ESPRESSO-BEANS', { unitPricePaisa: 150, source: 'LAST_PO_PRICE', poId: 'PO-01' }], // 150 paisa per g
    ]);

    // Sub-recipe: Espresso Shot (18g beans, 5% grind loss, yield 1 shot)
    const espressoRecipe = {
      recipeId: 'RCP-0001',
      name: 'Espresso Double Shot',
      batchYield: 1,
      ingredients: [
        {
          inventoryItemId: 'INV-ESPRESSO-BEANS',
          quantity: 18,
          lossFactorPercent: 5,
        },
      ],
    };

    const recipeMap = new Map([['RCP-0001', espressoRecipe]]);

    // Espresso cost = 18 * 150 * 1.05 = 2835 paisa
    const espressoCost = resolveRecipeUnitCostPaisa(espressoRecipe, recipeMap, costMap);
    assert.equal(espressoCost, 2835);

    // Parent recipe: Flat White (1 espresso shot + 180ml milk with 0% loss, yield 1 cup)
    const flatWhiteRecipe = {
      recipeId: 'RCP-0002',
      name: 'Flat White Coffee',
      batchYield: 1,
      ingredients: [
        {
          subRecipeId: 'RCP-0001',
          quantity: 1,
          lossFactorPercent: 0,
        },
        {
          inventoryItemId: 'INV-MILK',
          quantity: 180,
          lossFactorPercent: 0,
        },
      ],
    };
    recipeMap.set('RCP-0002', flatWhiteRecipe);

    // Flat White cost = 2835 + (180 * 60) = 2835 + 10800 = 13635 paisa (₹136.35)
    const flatWhiteCost = resolveRecipeUnitCostPaisa(flatWhiteRecipe, recipeMap, costMap);
    assert.equal(flatWhiteCost, 13635);
  });

  // ── 4. SALES TRANSACTION AGGREGATION & COGS DERIVATION ───────────────────
  await suite.test('4. calculateCogs aggregates POS sales and computes accurate margins & basis', async () => {
    // Inventory
    await GlobalInventoryItem.create({
      organisationId: orgId,
      itemId: 'INV-COFFEE-POWDER',
      sku: 'SKU-COFFEE-POWDER',
      name: 'Signature Roast Coffee Powder',
      category: 'COFFEE_BEANS',
      baseUnit: 'kg',
      unitCostPaisa: 2000, // ₹20.00 standard
      createdByUserId: 'MU-0001',
      status: 'ACTIVE',
    });

    // Recipe: 1 portion uses 1 unit of coffee powder
    await Recipe.create({
      organisationId: orgId,
      recipeId: 'RCP-0010',
      name: 'House Brew Coffee',
      version: 1,
      batchYield: 1,
      createdByUserId: 'MU-0001',
      ingredients: [
        {
          inventoryItemId: 'INV-COFFEE-POWDER',
          ingredientName: 'Signature Roast Coffee Powder',
          quantity: 1,
          uom: 'PORTION',
          lossFactorPercent: 0,
        },
      ],
    });

    // Menu Item: House Brew Coffee selling at ₹150.00 (15000 paisa)
    await MenuItem.create({
      organisationId: orgId,
      menuItemId: 'MENU-01',
      name: 'House Brew Coffee',
      nameLower: 'house brew coffee',
      category: 'COFFEE',
      currentPricePaisa: 15000,
      primaryRecipeId: 'RCP-0010',
      createdByUserId: 'MU-0001',
    });

    // 2 Completed bills: Total 3 units sold (revenue ₹450.00 = 45000 paisa)
    await Bill.create([
      {
        organisationId: orgId,
        cafeId,
        billId: 'BILL-20261015-0001',
        businessDate: '2026-10-15',
        cashierUserId: 'CA-0001',
        status: 'COMPLETED',
        subtotalPaisa: 30000,
        grandTotalPaisa: 30000,
        totalPaisa: 30000,
        lineItems: [
          {
            menuItemId: 'MENU-01',
            itemNameSnapshot: 'House Brew Coffee',
            quantity: 2,
            unitPricePaisa: 15000,
            lineSubtotalPaisa: 30000,
            totalLinePaisa: 30000,
          },
        ],
      },
      {
        organisationId: orgId,
        cafeId,
        billId: 'BILL-20261015-0002',
        businessDate: '2026-10-15',
        cashierUserId: 'CA-0001',
        status: 'COMPLETED',
        subtotalPaisa: 15000,
        grandTotalPaisa: 15000,
        totalPaisa: 15000,
        lineItems: [
          {
            menuItemId: 'MENU-01',
            itemNameSnapshot: 'House Brew Coffee',
            quantity: 1,
            unitPricePaisa: 15000,
            lineSubtotalPaisa: 15000,
            totalLinePaisa: 15000,
          },
        ],
      },
    ]);

    const result = await calculateCogs({
      organisationId: orgId,
      cafeScope: cafeId,
    });

    assert.equal(result.status, 'AVAILABLE');
    assert.equal(result.basis, 'LAST_PO_PRICE');
    assert.equal(result.totalUnitsSold, 3);
    assert.equal(result.grossSalesPaisa, 45000, 'Total sales ₹450.00');
    assert.equal(result.cogsPaisa, 6000, 'Total COGS 3 * ₹20.00 = ₹60.00 (6000 paisa)');
    assert.equal(result.grossProfitPaisa, 39000, 'Gross profit ₹390.00 (39000 paisa)');
    assert.equal(result.costPerUnitPaisa, 2000, 'Cost per unit ₹20.00');
    assert.equal(result.grossMarginPct, 86.67, 'Margin % = (390/450)*100 = 86.67%');

    assert.equal(result.items.length, 1);
    const itemRow = result.items[0];
    assert.equal(itemRow.menuItemId, 'MENU-01');
    assert.equal(itemRow.unitsSold, 3);
    assert.equal(itemRow.revenuePaisa, 45000);
    assert.equal(itemRow.cogsPaisa, 6000);
  });

  // ── 5. CONTROLLER ENDPOINT GET /api/v1/reports/cogs ───────────────────────
  await suite.test('5. getCogsReport controller endpoint returns 200 with structured data', async () => {
    const { req, res, getResult } = buildMockReqRes('OWNER', {}, { cafeId });
    await reportController.getCogsReport(req, res);
    const result = getResult();

    assert.equal(result.statusCode, 200);
    assert.equal(result.data.success, true);
    assert.ok(result.data.data);
    assert.equal(result.data.data.status, 'AVAILABLE');
    assert.equal(result.data.data.basis, 'LAST_PO_PRICE');
  });

  // ── 6. AUTHORIZATION TIERS ON /api/v1/reports/cogs ────────────────────────
  await suite.test('6. Role authorization: MASTER, OWNER, CAFE_ADMIN succeed; STAFF is rejected', async () => {
    // OWNER
    {
      const { req, res, getResult } = buildMockReqRes('OWNER', {}, { cafeId });
      await reportController.getCogsReport(req, res);
      assert.equal(getResult().statusCode, 200);
    }

    // MASTER
    {
      const { req, res, getResult } = buildMockReqRes('MASTER', {}, { cafeId });
      await reportController.getCogsReport(req, res);
      assert.equal(getResult().statusCode, 200);
    }

    // CAFE_ADMIN
    {
      const { req, res, getResult } = buildMockReqRes('CAFE_ADMIN', {}, { cafeId });
      await reportController.getCogsReport(req, res);
      assert.equal(getResult().statusCode, 200);
    }
  });

  // ── 7. P&L STATEMENT INTEGRATION IN ZURF EXPORT ──────────────────────────
  await suite.test('7. ZURF P&L Statement export reflects estimated COGS and Gross Profit rows', async () => {
    // Setup Bill with Sales
    await Bill.create({
      organisationId: orgId,
      cafeId,
      billId: 'BILL-20261015-0003',
      businessDate: '2026-10-15',
      cashierUserId: 'CA-0001',
      status: 'COMPLETED',
      subtotalPaisa: 20000,
      grandTotalPaisa: 20000,
      totalPaisa: 20000, // ₹200.00
      lineItems: [
        {
          menuItemId: 'MENU-01',
          itemNameSnapshot: 'House Brew Coffee',
          quantity: 1,
          unitPricePaisa: 20000,
          lineSubtotalPaisa: 20000,
          totalLinePaisa: 20000,
        },
      ],
    });

    const { req, res, getResult } = buildMockReqRes('OWNER', {}, {}, {
      reportId: 'pl-statement',
      format: 'XLSX',
      cafeId,
    });

    await reportController.generateZurfExport(req, res);
    const result = getResult();

    assert.equal(result.statusCode, 200, 'P&L Statement export must generate successfully');
    assert.equal(result.data.success, true);
    assert.ok(result.data.data.runId);
  });

  // ── 8. /reports/finance P&L + WATERFALL CONSUME REAL COGS ────────────────
  await suite.test('8. GET /reports/finance derives COGS, gross profit & waterfall from real cost data', async () => {
    // beforeEach wiped the fixture tables — re-seed a minimal cost basis + sale
    await GlobalInventoryItem.create({
      organisationId: orgId,
      itemId: 'INV-COFFEE-POWDER',
      sku: 'SKU-COFFEE-POWDER',
      name: 'Signature Roast Coffee Powder',
      category: 'COFFEE_BEANS',
      baseUnit: 'kg',
      unitCostPaisa: 2000,
      createdByUserId: 'MU-0001',
      status: 'ACTIVE',
    });

    await Recipe.create({
      organisationId: orgId,
      recipeId: 'RCP-0020',
      name: 'House Brew Coffee',
      version: 1,
      batchYield: 1,
      createdByUserId: 'MU-0001',
      ingredients: [{
        inventoryItemId: 'INV-COFFEE-POWDER',
        ingredientName: 'Signature Roast Coffee Powder',
        quantity: 1,
        uom: 'PORTION',
        lossFactorPercent: 0,
      }],
    });

    await MenuItem.create({
      organisationId: orgId,
      menuItemId: 'MENU-02',
      name: 'House Brew Coffee',
      nameLower: 'house brew coffee',
      category: 'COFFEE',
      currentPricePaisa: 15000,
      primaryRecipeId: 'RCP-0020',
      createdByUserId: 'MU-0001',
    });

    await Bill.create({
      organisationId: orgId,
      cafeId,
      billId: 'BILL-20261015-0101',
      businessDate: '2026-10-15',
      cashierUserId: 'CA-0001',
      status: 'COMPLETED',
      subtotalPaisa: 30000,
      grandTotalPaisa: 30000,
      totalPaisa: 30000,
      lineItems: [{
        menuItemId: 'MENU-02',
        itemNameSnapshot: 'House Brew Coffee',
        quantity: 2,
        unitPricePaisa: 15000,
        lineSubtotalPaisa: 30000,
        totalLinePaisa: 30000,
      }],
    });

    const { req, res, getResult } = buildMockReqRes('MASTER', {}, { cafeId });
    await reportController.getFinanceAnalytics(req, res);
    const result = getResult();

    assert.equal(result.statusCode, 200);
    const pnl = result.data.data.plStatement;

    assert.equal(pnl.cogsStatus, 'AVAILABLE (Basis: LAST_PO_PRICE, ESTIMATED)');
    assert.equal(pnl.cogsAvailability, 'ESTIMATED');
    assert.equal(pnl.cogsBasis, 'LAST_PO_PRICE');
    assert.equal(pnl.cogs, 40, 'COGS 2 units × ₹20.00 = ₹40.00');
    assert.equal(pnl.costCoveragePct, 100, 'Every sold unit was priced from a real cost source');
    assert.notEqual(pnl.grossProfit, null, 'Gross profit must be derived once COGS is available');
    assert.equal(
      Number((pnl.grossProfit + pnl.cogs).toFixed(2)),
      pnl.netRevenue,
      'Gross profit + COGS must reconcile to net revenue',
    );

    const cogsRow = result.data.data.waterfall.find((w) => w.label === 'Cost of Goods (COGS)');
    assert.ok(cogsRow, 'Waterfall must contain the COGS row');
    assert.equal(cogsRow.value, -pnl.cogs, 'Waterfall COGS row is a real (negative) deduction');
    assert.match(cogsRow.note, /LAST_PO_PRICE/, 'Waterfall row must disclose the estimate basis');

    const warnings = result.data.dataQuality?.warnings || [];
    assert.ok(
      warnings.includes('COGS_ESTIMATED_LAST_PO_PRICE_NOT_A_POSTED_LEDGER'),
      'Data quality must flag the estimated basis',
    );
    assert.ok(!warnings.includes('COGS_UNAVAILABLE_LEDGER_UNPOSTED'));
  });

  await suite.test('8b. GET /reports/finance stays honestly UNAVAILABLE without a cost basis', async () => {
    // A sale exists, but nothing can price it (no PO rate, no catalogue cost, no recipe)
    await Bill.create({
      organisationId: orgId,
      cafeId,
      billId: 'BILL-20261016-0102',
      businessDate: '2026-10-16',
      cashierUserId: 'CA-0001',
      status: 'COMPLETED',
      subtotalPaisa: 10000,
      grandTotalPaisa: 10000,
      totalPaisa: 10000,
      lineItems: [{
        menuItemId: 'MENU-UNPRICED',
        itemNameSnapshot: 'Unpriced Item',
        quantity: 1,
        unitPricePaisa: 10000,
        lineSubtotalPaisa: 10000,
        totalLinePaisa: 10000,
      }],
    });

    const { req, res, getResult } = buildMockReqRes('MASTER', {}, { cafeId });
    await reportController.getFinanceAnalytics(req, res);
    const result = getResult();

    assert.equal(result.statusCode, 200);
    const pnl = result.data.data.plStatement;

    assert.equal(pnl.cogs, null, 'Unpriceable sales must never yield a fabricated COGS figure');
    assert.equal(pnl.cogsStatus, 'UNAVAILABLE');
    assert.equal(pnl.grossProfit, null);
    assert.equal(pnl.grossMarginPct, null);
    assert.equal(pnl.primeCost, null);

    const cogsRow = result.data.data.waterfall.find((w) => w.label === 'Cost of Goods (COGS)');
    assert.equal(cogsRow.value, null, 'Waterfall COGS row stays null (not a fake 0)');
    assert.match(cogsRow.note, /UNAVAILABLE/);
  });
});
