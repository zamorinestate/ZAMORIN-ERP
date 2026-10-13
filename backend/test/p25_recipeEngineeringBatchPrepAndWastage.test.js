'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { Recipe } = require('../src/models/Recipe');
const { MenuItem } = require('../src/models/MenuItem');
const { GlobalInventoryItem } = require('../src/models/GlobalInventoryItem');
const { InventoryLot } = require('../src/models/InventoryLot');
const { CafeInventoryConfig } = require('../src/models/CafeInventoryConfig');
const { StockMovement } = require('../src/models/StockMovement');
const { WastageRecord } = require('../src/models/WastageRecord');
const { BatchProductionLog } = require('../src/models/BatchProductionLog');
const { BomDepletionService } = require('../src/services/bomDepletionService');
const { BatchProductionService } = require('../src/services/batchProductionService');
const { FefoService } = require('../src/services/fefoService');

test('Phase P25: Recipe Engineering, Batch Prep & Wastage Control Suite', async (t) => {
  const orgId = 'ORG-P25-TEST';
  const cafeId = 'ZC-CAFE-01';

  // In-memory test store
  const mockRecipes = [
    {
      recipeId: 'RCP-VANILLA-SYRUP-01',
      organisationId: orgId,
      name: 'Artisanal Vanilla Syrup Batch',
      isSubRecipe: true,
      status: 'APPROVED',
      batchYield: 5, // Yields 5 Litres
      yieldUom: 'LITRE',
      shelfLifeDays: 14,
      ingredients: [
        {
          inventoryItemId: 'INV-SUGAR-01',
          ingredientName: 'Granulated Sugar',
          quantity: 3,
          uom: 'KG',
          lossFactorPercent: 0,
        },
        {
          inventoryItemId: 'INV-VANILLA-BEANS-01',
          ingredientName: 'Bourbon Vanilla Beans',
          quantity: 0.1,
          uom: 'KG',
          lossFactorPercent: 10, // 10% trimming/peel loss: 0.1 / 0.9 = 0.1111 kg
        },
      ],
    },
    {
      recipeId: 'RCP-VANILLA-LATTE-01',
      organisationId: orgId,
      name: 'Iced Vanilla Bean Latte',
      isSubRecipe: false,
      status: 'APPROVED',
      batchYield: 1, // 1 glass
      yieldUom: 'PORTION',
      ingredients: [
        {
          subRecipeId: 'RCP-VANILLA-SYRUP-01',
          ingredientName: 'Artisanal Vanilla Syrup',
          quantity: 0.05, // 50ml of syrup
          uom: 'LITRE',
          lossFactorPercent: 0,
        },
        {
          inventoryItemId: 'INV-ESPRESSO-BEANS-01',
          ingredientName: 'Specialty Espresso Roast',
          quantity: 0.018,
          uom: 'KG',
          lossFactorPercent: 5, // 5% grinder retention loss
        },
        {
          inventoryItemId: 'INV-OAT-MILK-01',
          ingredientName: 'Barista Oat Milk',
          quantity: 0.200,
          uom: 'LITRE',
          lossFactorPercent: 0,
        },
      ],
    },
  ];

  const mockItems = [
    {
      organisationId: orgId,
      itemId: 'INV-SUGAR-01',
      name: 'Granulated Sugar',
      unitCostPaisa: 5000, // ₹50/kg
      standardCostPaisa: 5000,
    },
    {
      organisationId: orgId,
      itemId: 'INV-VANILLA-BEANS-01',
      name: 'Bourbon Vanilla Beans',
      unitCostPaisa: 400000, // ₹4000/kg
      standardCostPaisa: 400000,
    },
    {
      organisationId: orgId,
      itemId: 'INV-ESPRESSO-BEANS-01',
      name: 'Specialty Espresso Roast',
      unitCostPaisa: 120000, // ₹1200/kg
      standardCostPaisa: 120000,
    },
    {
      organisationId: orgId,
      itemId: 'INV-OAT-MILK-01',
      name: 'Barista Oat Milk',
      unitCostPaisa: 25000, // ₹250/Litre
      standardCostPaisa: 25000,
    },
    {
      organisationId: orgId,
      itemId: 'INV-WATER-SPARKLING-01',
      name: 'Perrier Sparkling Water 330ml',
      unitCostPaisa: 11000, // ₹110 cost
      standardCostPaisa: 11000,
    },
    {
      organisationId: orgId,
      itemId: 'INV-SEMI-VANILLA-SYRUP',
      name: 'Housemade Vanilla Syrup (Prep Item)',
      unitCostPaisa: 12000,
      standardCostPaisa: 12000,
    },
  ];

  // Mock Recipe queries
  const origRecipeFindOne = Recipe.findOne;
  Recipe.findOne = function (query) {
    const found = mockRecipes.find(
      (r) =>
        r.recipeId === query.recipeId?.toUpperCase() &&
        r.organisationId === query.organisationId
    );
    return {
      lean: async () => found || null,
      session: function () { return this; },
      then: (resolve) => resolve(found || null),
    };
  };

  // Mock GlobalInventoryItem queries
  const origItemFindOne = GlobalInventoryItem.findOne;
  GlobalInventoryItem.findOne = function (query) {
    const found = mockItems.find(
      (i) =>
        i.itemId === query.itemId?.toUpperCase() &&
        i.organisationId === query.organisationId
    );
    return {
      lean: async () => found || null,
      select: function () {
        return {
          lean: async () => found || null,
          session: function () { return this; },
          then: (resolve) => resolve(found || null),
        };
      },
      session: function () { return this; },
      then: (resolve) => resolve(found || null),
    };
  };

  // Mock StockMovement.findOne to prevent MongoDB buffering timeout on idempotency checks
  const origStockMovementFindOne = StockMovement.findOne;
  StockMovement.findOne = function () {
    return {
      select: function () {
        return {
          session: function () { return this; },
          lean: async () => null,
          then: (resolve) => resolve(null),
        };
      },
      session: function () { return this; },
      lean: async () => null,
      then: (resolve) => resolve(null),
    };
  };

  // ---------------------------------------------------------------------------
  // 1. F038: Sub-Recipe Explosion & Yield Loss Factor Calculation
  // ---------------------------------------------------------------------------
  await t.test('1. F038: Recursively explodes nested sub-recipes with yield loss factor calculation', async () => {
    // Explode single-level sub-recipe: Vanilla Syrup (5 Litre batch formula) for 1 batch
    const syrupExplosion = await BomDepletionService.explodeRecipe(
      'RCP-VANILLA-SYRUP-01',
      orgId,
      1
    );

    assert.equal(syrupExplosion.length, 2, 'Must contain Sugar and Vanilla Beans');
    const sugar = syrupExplosion.find((i) => i.inventoryItemId === 'INV-SUGAR-01');
    const vanilla = syrupExplosion.find((i) => i.inventoryItemId === 'INV-VANILLA-BEANS-01');

    assert.equal(sugar.quantityRequired, 3, 'Sugar has 0% loss: exactly 3kg');
    // Vanilla has 10% loss factor: 0.1 / (1 - 0.10) = 0.1111 kg
    assert.ok(
      vanilla.quantityRequired > 0.11 && vanilla.quantityRequired < 0.112,
      `Vanilla required should be adjusted for 10% loss factor: got ${vanilla.quantityRequired}`
    );
    assert.equal(vanilla.lossFactorPercent, 10);

    // Explode multi-level recipe: Iced Vanilla Bean Latte (2 portions)
    const latteExplosion = await BomDepletionService.explodeRecipe(
      'RCP-VANILLA-LATTE-01',
      orgId,
      2
    );

    // Should flatten into: Vanilla Syrup's ingredients (Sugar, Vanilla Beans) + Espresso Beans + Oat Milk = 4 items
    assert.equal(latteExplosion.length, 4, 'Must flatten sub-recipe ingredients and top-level ingredients');
    const espresso = latteExplosion.find((i) => i.inventoryItemId === 'INV-ESPRESSO-BEANS-01');
    const oatMilk = latteExplosion.find((i) => i.inventoryItemId === 'INV-OAT-MILK-01');

    assert.ok(espresso);
    // Espresso for 2 portions: base 0.036kg, 5% loss -> 0.036 / 0.95 = 0.0379 kg
    assert.ok(espresso.quantityRequired > 0.036);
    assert.equal(espresso.lossFactorPercent, 5);

    assert.ok(oatMilk);
    assert.equal(oatMilk.quantityRequired, 0.400, '2 portions * 0.200L = 0.400L');
  });

  // ---------------------------------------------------------------------------
  // 2. F038: Recipe Circular Cycle Detection
  // ---------------------------------------------------------------------------
  await t.test('2. F038: Detects circular dependency in sub-recipe BOM nesting', async () => {
    mockRecipes.push(
      {
        recipeId: 'RCP-CYCLE-ALPHA',
        organisationId: orgId,
        status: 'APPROVED',
        ingredients: [{ subRecipeId: 'RCP-CYCLE-BETA', quantity: 1 }],
      },
      {
        recipeId: 'RCP-CYCLE-BETA',
        organisationId: orgId,
        status: 'APPROVED',
        ingredients: [{ subRecipeId: 'RCP-CYCLE-ALPHA', quantity: 1 }],
      }
    );

    await assert.rejects(
      async () => {
        await BomDepletionService.explodeRecipe('RCP-CYCLE-ALPHA', orgId, 1);
      },
      (err) => err.code === 'RECIPE_CYCLE_DETECTED' || /Circular dependency/i.test(err.message)
    );
  });

  // ---------------------------------------------------------------------------
  // 3. F038: Recipe BOM Cost Rollup with Yield Loss Factor
  // ---------------------------------------------------------------------------
  await t.test('3. F038: Computes total recipe BOM cost rollups across sub-recipes and yield loss', async () => {
    const costAnalysis = await BomDepletionService.calculateRecipeCost(
      'RCP-VANILLA-LATTE-01',
      orgId
    );

    assert.equal(costAnalysis.recipeId, 'RCP-VANILLA-LATTE-01');
    assert.equal(costAnalysis.ingredients.length, 3);
    assert.ok(costAnalysis.totalCostPaisa > 0);
    assert.ok(costAnalysis.portionCostPaisa > 0);

    const subRecipeIng = costAnalysis.ingredients.find((i) => i.isSubRecipe);
    assert.ok(subRecipeIng, 'Must identify sub-recipe ingredient');
    assert.ok(subRecipeIng.nestedBreakdown, 'Must contain nested breakdown of sub-recipe costs');
  });

  // ---------------------------------------------------------------------------
  // 4. F040: Semi-Finished Batch Production Logging & Yield Efficiency
  // ---------------------------------------------------------------------------
  await t.test('4. F040: Executes semi-finished batch production, records actual yield efficiency and creates lot', async () => {
    let createdLot = null;
    let createdConfig = null;
    let createdMovement = [];
    let createdLog = null;

    const origLotCreate = InventoryLot.create;
    InventoryLot.create = async (doc) => {
      createdLot = doc;
      return doc;
    };

    const origMovementCreate = StockMovement.create;
    StockMovement.create = async (doc) => {
      createdMovement.push(doc);
      return doc;
    };

    const origConfigFindOne = CafeInventoryConfig.findOne;
    CafeInventoryConfig.findOne = function () {
      const configDoc = {
        organisationId: orgId,
        cafeId,
        itemId: 'INV-SEMI-VANILLA-SYRUP',
        currentQuantityBase: 2.0,
        availableQuantityBase: 2.0,
        save: async function () {
          createdConfig = this;
          return this;
        },
      };
      return {
        session: function () { return this; },
        then: (resolve) => resolve(configDoc),
      };
    };

    const origLogCreate = BatchProductionLog.create;
    BatchProductionLog.create = async (doc) => {
      createdLog = doc;
      return doc;
    };

    const origExecuteFefo = FefoService.executeFefoDeduction;
    FefoService.executeFefoDeduction = async () => ({
      allocatedLots: [],
      deductions: [],
    });

    // Execute production: planned 5 Litres, actual yield 4.8 Litres (4% shrinkage/evaporation)
    const result = await BatchProductionService.recordBatchProduction({
      organisationId: orgId,
      cafeId,
      recipeId: 'RCP-VANILLA-SYRUP-01',
      outputItemId: 'INV-SEMI-VANILLA-SYRUP',
      batchQuantity: 5,
      actualYield: 4.8,
      yieldUom: 'LITRE',
      notes: 'Batch #1 Morning prep',
      producedByUserId: 'CHEF-001',
    });

    assert.equal(result.success, true);
    assert.equal(result.plannedYield, 5);
    assert.equal(result.actualYield, 4.8);
    assert.equal(result.yieldEfficiencyPercent, 96.00, '4.8 / 5.0 = 96.00%');
    assert.equal(result.shrinkagePercent, 4.00, '100 - 96 = 4.00%');
    assert.equal(result.outputItemId, 'INV-SEMI-VANILLA-SYRUP');

    // Lot verification
    assert.ok(createdLot, 'Must create an inventory lot for the produced intermediate goods');
    assert.equal(createdLot.quantityBase, 4.8);
    assert.equal(createdLot.unit, 'LITRE');
    assert.equal(createdLot.status, 'AVAILABLE');

    // Movement verification
    const outputMvt = createdMovement.find((m) => m.movementType === 'PRODUCTION_OUTPUT');
    assert.ok(outputMvt, 'Must generate PRODUCTION_OUTPUT stock movement');
    assert.equal(outputMvt.quantityBase, 4.8);

    // Stock config updated
    assert.ok(createdConfig);
    assert.equal(createdConfig.currentQuantityBase, 6.8, '2.0 + 4.8 = 6.8 Litres');

    // Log verification
    assert.ok(createdLog);
    assert.equal(createdLog.yieldEfficiencyPercent, 96.00);

    // Restore
    InventoryLot.create = origLotCreate;
    StockMovement.create = origMovementCreate;
    CafeInventoryConfig.findOne = origConfigFindOne;
    BatchProductionLog.create = origLogCreate;
    FefoService.executeFefoDeduction = origExecuteFefo;
  });

  // ---------------------------------------------------------------------------
  // 5. F041: Wastage Logging with Mandatory Reason Codes & Financial Impact
  // ---------------------------------------------------------------------------
  await t.test('5. F041: Wastage logging enforces mandatory reason codes and calculates financial loss impact', async () => {
    let savedWastage = null;
    let savedMovement = null;

    const origWastageCreate = WastageRecord.create;
    WastageRecord.create = async (doc) => {
      savedWastage = doc;
      return doc;
    };
    WastageRecord.countDocuments = async () => 12;

    const origMovementCreate = StockMovement.create;
    StockMovement.create = async (doc) => {
      savedMovement = doc;
      return doc;
    };

    const origConfigFindOne = CafeInventoryConfig.findOne;
    CafeInventoryConfig.findOne = async () => ({
      organisationId: orgId,
      cafeId,
      itemId: 'INV-OAT-MILK-01',
      currentQuantityBase: 10,
      availableQuantityBase: 10,
      save: async function () { return this; },
    });

    const { recordWastage } = require('../src/controllers/inventoryController');

    // Sub-test A: Invalid reason code rejected
    const fakeReqInvalid = {
      auth: { organisationId: orgId, userId: 'USER-01', role: 'MASTER' },
      body: {
        cafeId,
        itemId: 'INV-OAT-MILK-01',
        quantity: 2,
        reasonCode: 'INVALID_REASON_RANDOM',
      },
    };
    const fakeRes = {
      status: function (code) {
        this.statusCode = code;
        return this;
      },
      json: function (data) {
        this.data = data;
        return this;
      },
    };

    await assert.rejects(
      async () => {
        await recordWastage(fakeReqInvalid, fakeRes);
      },
      (err) => err.code === 'INVALID_REASON_CODE' || /Invalid waste reason code/i.test(err.message)
    );

    // Sub-test B: Valid BURNT_BATCH wastage accepted with financial cost
    const fakeReqValid = {
      auth: { organisationId: orgId, userId: 'CHEF-02', role: 'MASTER' },
      body: {
        cafeId,
        itemId: 'INV-OAT-MILK-01',
        quantity: 3,
        reasonCode: 'BURNT_BATCH',
        notes: 'Overheated during steaming batch',
      },
    };

    await recordWastage(fakeReqValid, fakeRes);

    assert.equal(fakeRes.statusCode, 201);
    assert.ok(savedWastage);
    assert.equal(savedWastage.reasonCode, 'BURNT_BATCH');
    assert.equal(savedWastage.quantityBase, 3);
    // Cost: 3 Litres * ₹250 (25000 paisa) = 75000 paisa
    assert.equal(savedWastage.estimatedValuePaisa, 75000);
    assert.equal(fakeRes.data.costImpactPaisa, 75000);

    assert.ok(savedMovement);
    assert.equal(savedMovement.movementType, 'WASTAGE');
    assert.equal(savedMovement.quantityBase, -3);

    // Restore
    WastageRecord.create = origWastageCreate;
    StockMovement.create = origMovementCreate;
    CafeInventoryConfig.findOne = origConfigFindOne;
  });

  // ---------------------------------------------------------------------------
  // 6. F042: Non-Recipe Auto-Deduct Inventory Item Toggle
  // ---------------------------------------------------------------------------
  await t.test('6. F042: Non-recipe items with autoDeductInventory toggle deplete stock directly on sale', async () => {
    // Menu item: Perrier Sparkling Water (retail packaged good, no recipe BOM)
    const mockRetailMenuItem = {
      menuItemId: 'MENU-SPARKLING-01',
      organisationId: orgId,
      name: 'Perrier Sparkling Water 330ml',
      autoDeductInventory: true,
      inventoryItemId: 'INV-WATER-SPARKLING-01',
      recipeDeductionBaseQuantity: 1,
      primaryRecipeId: null, // No recipe
    };

    const origMenuItemFindOne = MenuItem.findOne;
    MenuItem.findOne = function (query) {
      if (query.menuItemId === 'MENU-SPARKLING-01') {
        return {
          session: function () { return this; },
          lean: async () => mockRetailMenuItem,
          then: (resolve) => resolve(mockRetailMenuItem),
        };
      }
      return {
        session: function () { return this; },
        lean: async () => null,
        then: (resolve) => resolve(null),
      };
    };

    let fefoDeductionCalled = null;
    const origExecuteFefo = FefoService.executeFefoDeduction;
    FefoService.executeFefoDeduction = async (params) => {
      fefoDeductionCalled = params;
      return {
        allocatedLots: [{ lotId: 'LOT-SPARK-01', quantityDeducted: params.requiredQuantity }],
        deductions: [{ lotId: 'LOT-SPARK-01', quantity: params.requiredQuantity }],
      };
    };

    // Sale of 3 bottles
    const depletionResult = await BomDepletionService.depleteOrderBOM({
      organisationId: orgId,
      cafeId,
      billId: 'BILL-RETAIL-001',
      serviceMode: null,
      lineItems: [
        {
          menuItemId: 'MENU-SPARKLING-01',
          quantity: 3,
        },
      ],
    });

    assert.equal(depletionResult.success, true);
    assert.equal(depletionResult.processedItemsCount, 1);
    assert.ok(fefoDeductionCalled, 'FefoService.executeFefoDeduction must be called for non-recipe item');
    assert.equal(fefoDeductionCalled.itemId, 'INV-WATER-SPARKLING-01');
    assert.equal(fefoDeductionCalled.requiredQuantity, 3);

    // Restore
    MenuItem.findOne = origMenuItemFindOne;
    FefoService.executeFefoDeduction = origExecuteFefo;
  });

  // Restore globals
  Recipe.findOne = origRecipeFindOne;
  GlobalInventoryItem.findOne = origItemFindOne;
  StockMovement.findOne = origStockMovementFindOne;
});
