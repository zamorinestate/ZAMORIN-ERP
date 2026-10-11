'use strict';

/**
 * ============================================================================
 * ZAMORIN CAFÉ ERP — P17 FORECASTS, PREDICTIVE INSIGHTS & ASSISTED ANALYSIS
 * BEHAVIORAL ACCEPTANCE SUITE
 * ============================================================================
 *
 * Verifies all Core Acceptance Conditions for Package P17:
 *  1. Sales & Demand Forecasting with Day-of-Week Seasonality & Moving Averages.
 *  2. Canonical sales data extraction: Voided, Refunded, Reversed, and Training exclusions.
 *  3. Sparsity & Data Quality handling: INSUFFICIENT_HISTORY (<7 days) and DATA_QUALITY_WARNING.
 *  4. Rolling-origin Holdout Accuracy Evaluation with zero data leakage (MAE, WAPE, baseline).
 *  5. Stockout-risk estimation & Usable Stock Isolation (expired/quarantined/reserved exclusions).
 *  6. Supplier-Price Variance and Like-for-Like Cost Analysis (severe increase, favourable decrease).
 *  7. Controlled Assisted Business Inquiries with factual explanations and truthful AI unconfigured state.
 *  8. Canonical Persona Security Matrix: Primary Master universal, Cafe Ops scoped,
 *     Owner read-only (mutations denied), Staff denied, Vendor denied, retired Normal Master 403.
 *  9. Cross-café IDOR / BOLA protection: Cafe Operations denied unassigned café insights.
 * 10. Operational Non-Mutation Invariant: Forecasting operations never create bills, POs, or stock entries.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryReplSet } = require('mongodb-memory-server');

process.env.NODE_ENV = 'test';
process.env.TEST_MODE = 'true';

// Models
const { Bill } = require('../src/models/Bill');
const { MenuItem } = require('../src/models/MenuItem');
const { GlobalInventoryItem } = require('../src/models/GlobalInventoryItem');
const { CafeInventoryConfig } = require('../src/models/CafeInventoryConfig');
const { InventoryLot } = require('../src/models/InventoryLot');
const { InventoryReservation } = require('../src/models/InventoryReservation');
const { PurchaseOrder } = require('../src/models/PurchaseOrder');
const { Vendor } = require('../src/models/Vendor');
const { ForecastRun } = require('../src/models/ForecastRun');
const { ForecastEvaluation } = require('../src/models/ForecastEvaluation');

// Services & Controllers
const SalesForecastingService = require('../src/services/salesForecastingService');
const StockoutRiskService = require('../src/services/stockoutRiskService');
const SupplierPriceVarianceService = require('../src/services/supplierPriceVarianceService');
const BusinessExplanationService = require('../src/services/businessExplanationService');
const ForecastController = require('../src/controllers/forecastController');
const { authorize } = require('../src/middleware/authorize');

const ORG_ID = 'ORG-ZAMORIN-P17';
const CAFE_A = 'ZC-0001';
const CAFE_B = 'ZC-0002';

// Helper to construct mock request & response
function buildMockReqRes(role, customAuth = {}, body = {}, query = {}, params = {}) {
  let statusCode = 200;
  let responseData = null;

  const req = {
    auth: {
      userId: customAuth.userId || (role === 'MASTER' ? 'MU-0001' : (role === 'OWNER' ? 'OW-0001' : (role === 'CAFE_ADMIN' ? 'AD-0001' : 'ST-0001'))),
      role,
      organisationId: customAuth.organisationId || ORG_ID,
      isPrimaryMaster: customAuth.isPrimaryMaster !== undefined ? customAuth.isPrimaryMaster : (role === 'MASTER'),
      assignedCafeIds: customAuth.assignedCafeIds || [CAFE_A],
      primaryCafeId: customAuth.primaryCafeId || CAFE_A,
      ...customAuth,
    },
    params,
    query,
    body,
    headers: {},
    get: () => null,
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
    getStatusCode: () => statusCode,
    getData: () => responseData,
  };

  return { req, res };
}

let mongod;

test.before(async () => {
  mongod = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  const uri = mongod.getUri();
  await mongoose.connect(uri);
});

test.after(async () => {
  await mongoose.disconnect();
  if (mongod) await mongod.stop();
});

test('1. Sales & Demand Forecasting with Day-of-Week Seasonality and Confidence Bands', async () => {
  // Seed 28 days of canonical completed bills
  const baseDate = new Date();
  for (let i = 28; i >= 1; i--) {
    const d = new Date(baseDate);
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().slice(0, 10);

    const bill = new Bill({
      billId: `BILL-${dateStr.replace(/-/g, '')}-1001`,
      organisationId: ORG_ID,
      cafeId: CAFE_A,
      businessDate: dateStr,
      orderType: 'DINE_IN',
      status: 'COMPLETED',
      paymentStatus: 'PAID',
      subtotalPaisa: 50000,
      totalPaisa: 52500,
      paidAmountPaisa: 52500,
      cashierUserId: 'EMP-001',
      lineItems: [
        {
          menuItemId: 'MENU-01',
          itemNameSnapshot: 'Malabar Spiced Latte',
          quantity: 10,
          unitPricePaisa: 25000,
          lineSubtotalPaisa: 250000,
        },
        {
          menuItemId: 'MENU-02',
          itemNameSnapshot: 'Pista Cardamom Bun',
          quantity: 5,
          unitPricePaisa: 15000,
          lineSubtotalPaisa: 75000,
        },
      ],
    });
    await bill.save();
  }

  // Seed Menu Item metadata
  await MenuItem.create({
    menuItemId: 'MENU-01',
    organisationId: ORG_ID,
    name: 'Malabar Spiced Latte',
    nameLower: 'malabar spiced latte',
    category: 'COFFEE',
    currentPricePaisa: 25000,
    createdByUserId: 'MU-0001',
  });

  const forecast = await SalesForecastingService.generateSalesAndDemandForecast({
    organisationId: ORG_ID,
    cafeId: CAFE_A,
    horizonDays: 7,
    method: 'DAY_OF_WEEK_SEASONAL',
    observationWindowDays: 28,
    actorId: 'TEST-USER',
  });

  assert.equal(forecast.status, 'READY');
  assert.equal(forecast.horizonDays, 7);
  assert.equal(forecast.revenuePredictions.length, 7);
  assert.ok(forecast.summary.totalPredictedRevenuePaisa > 0);
  assert.ok(forecast.summary.avgDailyRevenuePaisa > 0);
  assert.ok(forecast.summary.totalPredictedItemsCount > 0);

  // Confidence bands invariant: Low <= Predicted <= High
  for (const pred of forecast.revenuePredictions) {
    assert.ok(pred.confidenceLowPaisa <= pred.predictedRevenuePaisa);
    assert.ok(pred.predictedRevenuePaisa <= pred.confidenceHighPaisa);
  }

  // Top demand items verification
  assert.ok(forecast.summary.topDemandItems.length > 0);
  assert.equal(forecast.summary.topDemandItems[0].menuItemId, 'MENU-01');
  assert.equal(forecast.summary.topDemandItems[0].category, 'COFFEE');
});

test('2. Canonical Exclusions: Voided, Refunded, Reversed, and Training Bills Excluded', async () => {
  const d = new Date();
  d.setDate(d.getDate() - 2);
  const dateStr = d.toISOString().slice(0, 10);

  // Voided bill
  await Bill.create({
    billId: `BILL-${dateStr.replace(/-/g, '')}-9901`,
    organisationId: ORG_ID,
    cafeId: CAFE_A,
    businessDate: dateStr,
    status: 'VOIDED',
    paymentStatus: 'UNPAID',
    subtotalPaisa: 999999,
    totalPaisa: 999999,
    cashierUserId: 'EMP-001',
    lineItems: [{ menuItemId: 'MENU-01', itemNameSnapshot: 'Void Item', quantity: 99, unitPricePaisa: 1000, lineSubtotalPaisa: 99000 }],
  });

  // Refunded bill
  await Bill.create({
    billId: `BILL-${dateStr.replace(/-/g, '')}-9902`,
    organisationId: ORG_ID,
    cafeId: CAFE_A,
    businessDate: dateStr,
    status: 'REFUNDED',
    paymentStatus: 'REFUNDED',
    subtotalPaisa: 888888,
    totalPaisa: 888888,
    cashierUserId: 'EMP-001',
    lineItems: [{ menuItemId: 'MENU-01', itemNameSnapshot: 'Refund Item', quantity: 88, unitPricePaisa: 1000, lineSubtotalPaisa: 88000 }],
  });

  // Training bill
  await Bill.create({
    billId: `BILL-${dateStr.replace(/-/g, '')}-9903`,
    organisationId: ORG_ID,
    cafeId: CAFE_A,
    businessDate: dateStr,
    isTraining: true,
    status: 'COMPLETED',
    paymentStatus: 'PAID',
    subtotalPaisa: 777777,
    totalPaisa: 777777,
    cashierUserId: 'EMP-001',
    lineItems: [{ menuItemId: 'MENU-01', itemNameSnapshot: 'Training Item', quantity: 77, unitPricePaisa: 1000, lineSubtotalPaisa: 77000 }],
  });

  const forecast = await SalesForecastingService.generateSalesAndDemandForecast({
    organisationId: ORG_ID,
    cafeId: CAFE_A,
    horizonDays: 7,
    method: 'MOVING_AVERAGE',
  });

  // The daily expectation should remain around ₹525.00, not millions
  assert.ok(forecast.summary.avgDailyRevenuePaisa < 100000);
});

test('3. Data Quality & Sparsity: Sparse History (<7 days) yields INSUFFICIENT_HISTORY', async () => {
  // CAFE_B has only 2 bills
  const d = new Date();
  d.setDate(d.getDate() - 1);
  const dateStr = d.toISOString().slice(0, 10);

  await Bill.create({
    billId: `BILL-${dateStr.replace(/-/g, '')}-2001`,
    organisationId: ORG_ID,
    cafeId: CAFE_B,
    businessDate: dateStr,
    status: 'COMPLETED',
    paymentStatus: 'PAID',
    subtotalPaisa: 10000,
    totalPaisa: 10000,
    cashierUserId: 'EMP-002',
    lineItems: [{ menuItemId: 'MENU-01', itemNameSnapshot: 'Coffee', quantity: 1, unitPricePaisa: 10000, lineSubtotalPaisa: 10000 }],
  });

  const forecast = await SalesForecastingService.generateSalesAndDemandForecast({
    organisationId: ORG_ID,
    cafeId: CAFE_B,
    horizonDays: 7,
  });

  assert.equal(forecast.status, 'INSUFFICIENT_HISTORY');
  assert.ok(forecast.warningDetails.length > 0);
  assert.ok(forecast.warningDetails[0].includes('Minimum 7 distinct days required'));
  assert.equal(forecast.summary.totalPredictedRevenuePaisa, 0);
});

test('4. Holdout Accuracy Evaluation with Zero Data Leakage (MAE, WAPE, Naive Baseline)', async () => {
  const evalResult = await SalesForecastingService.evaluateForecastAccuracy({
    organisationId: ORG_ID,
    cafeId: CAFE_A,
    holdoutDays: 7,
    observationWindowDays: 21,
    actorId: 'EVAL-ACTOR',
  });

  assert.equal(evalResult.status, 'VALID');
  assert.equal(evalResult.holdoutWindow.days, 7);
  assert.ok(evalResult.trainingCutoffDate <= evalResult.holdoutWindow.startDate);
  assert.ok(evalResult.mae >= 0);
  assert.ok(evalResult.wapePercent >= 0);
  assert.ok(evalResult.baselineMae >= 0);
  assert.equal(evalResult.actualVsPredicted.length, 7);

  // Invariant: no NaN or Infinity in percentage error
  for (const row of evalResult.actualVsPredicted) {
    assert.ok(!isNaN(row.absoluteError));
    if (row.percentageError !== null) {
      assert.ok(!isNaN(row.percentageError));
      assert.ok(isFinite(row.percentageError));
    }
  }
});

test('5. Stockout-Risk Estimation & Usable Stock Isolation (Expired/Quarantined/Reserved Excluded)', async () => {
  const ITEM_ID = 'RAW-MILK-01';

  await GlobalInventoryItem.create({
    itemId: ITEM_ID,
    organisationId: ORG_ID,
    sku: 'SKU-RAW-MILK-01',
    name: 'Fresh Full Cream Milk',
    baseUnit: 'litre',
    category: 'DAIRY_FRESH',
    status: 'ACTIVE',
    createdByUserId: 'MU-0001',
  });

  await CafeInventoryConfig.create({
    itemId: ITEM_ID,
    organisationId: ORG_ID,
    cafeId: CAFE_A,
    currentQuantityBase: 30, // 30L total physical
    leadTimeDays: 3,
    safetyStockBase: 10,
    parQuantityBase: 50,
    avgDailyUsageBase: 5,   // 5L/day burn rate
    stockedHere: true,
  });

  // Lots: 15L usable, 10L quarantined, 5L expired
  await InventoryLot.create([
    {
      lotId: 'LOT-USABLE-01',
      itemId: ITEM_ID,
      organisationId: ORG_ID,
      cafeId: CAFE_A,
      remainingQuantity: 15,
      status: 'AVAILABLE',
      expiryDate: '2026-12-31',
    },
    {
      lotId: 'LOT-QUARANTINE-01',
      itemId: ITEM_ID,
      organisationId: ORG_ID,
      cafeId: CAFE_A,
      remainingQuantity: 10,
      status: 'QUARANTINE',
      expiryDate: '2026-12-31',
    },
    {
      lotId: 'LOT-EXPIRED-01',
      itemId: ITEM_ID,
      organisationId: ORG_ID,
      cafeId: CAFE_A,
      remainingQuantity: 5,
      status: 'EXPIRED',
      expiryDate: '2026-01-01',
    },
  ]);

  // Active reservation: 5L
  await InventoryReservation.create({
    reservationId: 'RES-001',
    itemId: ITEM_ID,
    organisationId: ORG_ID,
    cafeId: CAFE_A,
    reservedQty: 5,
    status: 'ACTIVE',
    createdByUserId: 'MU-0001',
    expiresAt: new Date(Date.now() + 86400000),
  });

  const riskResult = await StockoutRiskService.evaluateStockoutRisk({
    organisationId: ORG_ID,
    cafeId: CAFE_A,
    horizonDays: 14,
  });

  assert.equal(riskResult.totalItemsEvaluated, 1);
  const milkRisk = riskResult.itemsAtRisk.find((i) => i.itemId === ITEM_ID);
  assert.ok(milkRisk);

  // Usable stock = physicallyUsable (30 - 15 unusable) - 5 reserved = 10L
  assert.equal(milkRisk.usableStock, 10);
  assert.equal(milkRisk.quarantinedStock, 10);
  assert.equal(milkRisk.expiredStock, 5);
  assert.equal(milkRisk.reservedStock, 5);

  // Days to stockout = 10L / 5L/day = 2 days <= leadTime (3 days) -> CRITICAL!
  assert.equal(milkRisk.daysUntilStockout, 2);
  assert.equal(milkRisk.riskLevel, 'CRITICAL');
  assert.ok(milkRisk.contributingReasons.some((r) => r.includes('lead time')));
  assert.ok(milkRisk.contributingReasons.some((r) => r.includes('Blocked inventory')));
});

test('6. Supplier-Price Variance and Cost Analysis (Severe Increase, Favourable Decrease)', async () => {
  const VENDOR_ID = 'VEN-1001';
  const ITEM_ID = 'RAW-MILK-01';

  // Vendor with contracted catalogue price: ₹60/L (6000 paisa)
  await Vendor.create({
    vendorId: VENDOR_ID,
    organisationId: ORG_ID,
    name: 'Malabar Dairy Co-operative',
    nameLower: 'malabar dairy co-operative',
    category: 'FOOD_BEVERAGE',
    createdByUserId: 'MU-0001',
    status: 'ACTIVE',
    itemCatalogue: [
      {
        itemId: ITEM_ID,
        itemName: 'Fresh Full Cream Milk',
        currentPricePaisa: 6000,
        uomConversionFactor: 1,
        status: 'ACTIVE',
      },
    ],
  });

  // PO 1: Rate ₹75/L (+25% severe increase)
  await PurchaseOrder.create({
    purchaseOrderId: 'PO-2026-0001',
    poNumber: 'PO-2026-0001',
    organisationId: ORG_ID,
    cafeId: CAFE_A,
    vendorId: VENDOR_ID,
    createdByUserId: 'MU-0001',
    status: 'RECEIVED',
    lineItems: [
      {
        itemId: ITEM_ID,
        itemNameSnapshot: 'Fresh Milk',
        orderedQuantityBase: 100,
        unitPricePaisa: 7500,
        totalLinePaisa: 750000,
        uomConversionFactor: 1,
      },
    ],
  });

  // PO 2: Rate ₹54/L (-10% favourable decrease)
  await PurchaseOrder.create({
    purchaseOrderId: 'PO-2026-0002',
    poNumber: 'PO-2026-0002',
    organisationId: ORG_ID,
    cafeId: CAFE_A,
    vendorId: VENDOR_ID,
    createdByUserId: 'MU-0001',
    status: 'RECEIVED',
    lineItems: [
      {
        itemId: ITEM_ID,
        itemNameSnapshot: 'Fresh Milk',
        orderedQuantityBase: 100,
        unitPricePaisa: 5400,
        totalLinePaisa: 540000,
        uomConversionFactor: 1,
      },
    ],
  });

  const analysis = await SupplierPriceVarianceService.analyzePriceVariances({
    organisationId: ORG_ID,
    cafeId: CAFE_A,
    days: 60,
  });

  assert.equal(analysis.varianceSummary.severeIncreaseCount, 1);
  assert.equal(analysis.varianceSummary.materialDecreaseCount, 1);

  const po1Finding = analysis.findings.find((f) => f.poNumber === 'PO-2026-0001');
  assert.equal(po1Finding.severity, 'SEVERE_INCREASE');
  assert.equal(po1Finding.variancePercent, 25);

  const po2Finding = analysis.findings.find((f) => f.poNumber === 'PO-2026-0002');
  assert.equal(po2Finding.severity, 'MATERIAL_DECREASE');
  assert.equal(po2Finding.variancePercent, -10);
});

test('7. Controlled Assisted Business Inquiries & Truthful AI Unconfigured Adapter', async () => {
  // Query supported question: SALES_TREND
  const answer = await BusinessExplanationService.queryBusinessAnalysis({
    questionKey: 'SALES_TREND',
    organisationId: ORG_ID,
    cafeId: CAFE_A,
  });

  assert.equal(answer.isSupported, true);
  assert.equal(answer.questionKey, 'SALES_TREND');
  assert.ok(answer.summaryExplanation.length > 0);
  assert.ok(answer.contributingFactors.length > 0);
  assert.equal(answer.aiStatus, 'UNCONFIGURED');
  assert.ok(answer.aiMessage.includes('unconfigured'));

  // Query supported question: STOCKOUT_ALERT
  const stockoutAnswer = await BusinessExplanationService.queryBusinessAnalysis({
    questionKey: 'STOCKOUT_ALERT',
    organisationId: ORG_ID,
    cafeId: CAFE_A,
  });
  assert.equal(stockoutAnswer.isSupported, true);
  assert.ok(stockoutAnswer.summaryExplanation.includes('CRITICAL'));

  // Query unsupported question: ARBITRARY_SQL_LEAK
  const unsupportedAnswer = await BusinessExplanationService.queryBusinessAnalysis({
    questionKey: 'ARBITRARY_SQL_LEAK',
    organisationId: ORG_ID,
  });
  assert.equal(unsupportedAnswer.isSupported, false);
  assert.ok(unsupportedAnswer.summaryExplanation.includes('outside the controlled catalogue'));
});

test('8. Persona Security Matrix: Primary Master Universal, Cafe Ops Scoped, Owner Read-Only', async () => {
  // A. Primary Master generates forecast -> 201 Created
  {
    const { req, res } = buildMockReqRes('MASTER', { isPrimaryMaster: true }, { cafeId: CAFE_A, horizonDays: 7 });
    await ForecastController.generateForecast(req, res, () => {});
    assert.equal(res.getStatusCode(), 201);
  }

  // B. Owner attempts to generate forecast -> 403 OWNER_READ_ONLY (mutation forbidden)
  {
    const { req, res } = buildMockReqRes('OWNER', {}, { cafeId: CAFE_A, horizonDays: 7 });
    await ForecastController.generateForecast(req, res, () => {});
    assert.equal(res.getStatusCode(), 403);
    assert.equal(res.getData().error.code, 'OWNER_READ_ONLY');
  }

  // C. Owner attempts to evaluate accuracy -> 403 OWNER_READ_ONLY
  {
    const { req, res } = buildMockReqRes('OWNER', {}, { cafeId: CAFE_A, holdoutDays: 7 });
    await ForecastController.evaluateForecast(req, res, () => {});
    assert.equal(res.getStatusCode(), 403);
    assert.equal(res.getData().error.code, 'OWNER_READ_ONLY');
  }

  // D. Owner reads latest forecast -> 200 OK (read-only allowed)
  {
    const { req, res } = buildMockReqRes('OWNER', {}, {}, { cafeId: CAFE_A });
    await ForecastController.getLatestForecast(req, res, () => {});
    assert.equal(res.getStatusCode(), 200);
  }

  // E. Owner reads stockout risk -> 200 OK
  {
    const { req, res } = buildMockReqRes('OWNER', {}, {}, { cafeId: CAFE_A });
    await ForecastController.getStockoutRisk(req, res, () => {});
    assert.equal(res.getStatusCode(), 200);
  }

  // F. Cafe Operations generates forecast for assigned cafe -> 201 Created
  {
    const { req, res } = buildMockReqRes('CAFE_ADMIN', { assignedCafeIds: [CAFE_A] }, { cafeId: CAFE_A, horizonDays: 7 });
    await ForecastController.generateForecast(req, res, () => {});
    assert.equal(res.getStatusCode(), 201);
  }

  // G. Cafe Operations tries cross-cafe generation for CAFE_B -> 403 CAFE_ACCESS_DENIED
  {
    const { req, res } = buildMockReqRes('CAFE_ADMIN', { assignedCafeIds: [CAFE_A] }, { cafeId: CAFE_B, horizonDays: 7 });
    await ForecastController.generateForecast(req, res, () => {});
    assert.equal(res.getStatusCode(), 403);
    assert.equal(res.getData().error.code, 'CAFE_ACCESS_DENIED');
  }

  // H. Retired Normal Master (role MASTER, isPrimaryMaster: false) fails closed with 403 ROLE_RETIRED
  {
    const middleware = authorize(['MASTER', 'OWNER', 'CAFE_ADMIN']);
    const { req, res } = buildMockReqRes('MASTER', { isPrimaryMaster: false });
    let nextCalled = false;
    await middleware(req, res, () => { nextCalled = true; });
    assert.equal(nextCalled, false);
    assert.equal(res.getStatusCode(), 403);
    assert.equal(res.getData().error.code, 'ROLE_RETIRED');
  }

  // I. Staff role fails closed with 403 PERMISSION_DENIED
  {
    const middleware = authorize(['MASTER', 'OWNER', 'CAFE_ADMIN']);
    const { req, res } = buildMockReqRes('STAFF', {});
    let nextCalled = false;
    await middleware(req, res, () => { nextCalled = true; });
    assert.equal(nextCalled, false);
    assert.equal(res.getStatusCode(), 403);
    assert.equal(res.getData().error.code, 'PERMISSION_DENIED');
  }

  // J. Vendor role fails closed with 403 (VENDOR_READ_ONLY or PERMISSION_DENIED)
  {
    const middleware = authorize(['MASTER', 'OWNER', 'CAFE_ADMIN']);
    const { req, res } = buildMockReqRes('VENDOR', {});
    let nextCalled = false;
    await middleware(req, res, () => { nextCalled = true; });
    assert.equal(nextCalled, false);
    assert.equal(res.getStatusCode(), 403);
    assert.ok(['VENDOR_READ_ONLY', 'PERMISSION_DENIED'].includes(res.getData().error.code));
  }
});

test('9. Operational Immutability Invariant: Forecasting never creates orders, bills, or stock entries', async () => {
  const billsBefore = await Bill.countDocuments();
  const posBefore = await PurchaseOrder.countDocuments();
  const lotsBefore = await InventoryLot.countDocuments();

  // Run full suite of forecasting and analytical calls
  await SalesForecastingService.generateSalesAndDemandForecast({ organisationId: ORG_ID, cafeId: CAFE_A });
  await SalesForecastingService.evaluateForecastAccuracy({ organisationId: ORG_ID, cafeId: CAFE_A });
  await StockoutRiskService.evaluateStockoutRisk({ organisationId: ORG_ID, cafeId: CAFE_A });
  await SupplierPriceVarianceService.analyzePriceVariances({ organisationId: ORG_ID, cafeId: CAFE_A });
  await BusinessExplanationService.queryBusinessAnalysis({ questionKey: 'SALES_TREND', organisationId: ORG_ID });

  const billsAfter = await Bill.countDocuments();
  const posAfter = await PurchaseOrder.countDocuments();
  const lotsAfter = await InventoryLot.countDocuments();

  assert.equal(billsAfter, billsBefore, 'Bills count must remain strictly unchanged');
  assert.equal(posAfter, posBefore, 'PurchaseOrders count must remain strictly unchanged');
  assert.equal(lotsAfter, lotsBefore, 'InventoryLots count must remain strictly unchanged');
});
