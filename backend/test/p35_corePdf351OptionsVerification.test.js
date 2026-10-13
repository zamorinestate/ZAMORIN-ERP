'use strict';

/**
 * ============================================================================
 * ZAMORIN CAFÉ ERP — PHASE P35 TEST SUITE
 * 15 REMAINING OPERATIONAL OPTIONS VERIFICATION (CORE 351 ENTRIES F001–F351)
 * ============================================================================
 *
 * Verifies all 15 remaining advanced operational options:
 *  1. F063: Half-and-Half Pizza Customizer (Higher-half pricing logic in integer paise)
 *  2. F044: Shortcode Fast-Biller Item Lookup
 *  3. F272: KDS Aggregated Item Batch View for bulk station prep
 *  4. F036: Payment-Gated Kitchen Dispatch
 *  5. F031: Food vs Bar Split Invoices (Separating GST 5% and State VAT)
 *  6. F122: Raw Material Menu Auto-86 Lock
 *  7. F137–F140: Daily Finished-Item Batch Register (Morning yield counter & depletion lock)
 *  8. F156–F159: Actual Production Yield & Unit Cost Adjustment
 *  9. F188–F191: Irreversible Historical Stock Freeze Lock
 * 10. F114–F116: Deferred Advance Stock Consumption
 * 11. F085: Food Court Prepaid Smart Card Engine (Issue, Topup, Debit, Refund, Float Liability)
 * 12. F074, F075: Pre-Tax vs Post-Tax Tip Base Selector
 * 13. F278: Delivery Rider Pickup OTP Handover Check-In
 * 14. F092: Train Delivery Logistics & Cutlery Preferences
 * 15. F011: Mandatory Tender Selection Mode
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
const { Recipe } = require('../src/models/Recipe');
const { GlobalInventoryItem } = require('../src/models/GlobalInventoryItem');
const { CafeInventoryConfig } = require('../src/models/CafeInventoryConfig');
const { Cafe } = require('../src/models/Cafe');
const { OnlineChannelConfig } = require('../src/models/OnlineChannelConfig');
const { KdsTicket } = require('../src/models/KdsTicket');
const { ChannelOrder } = require('../src/models/ChannelOrder');
const { AdvanceDeposit } = require('../src/models/AdvanceDeposit');
const { BatchProductionLog } = require('../src/models/BatchProductionLog');
const { InventoryLot } = require('../src/models/InventoryLot');
const { PrepaidSmartCard } = require('../src/models/PrepaidSmartCard');
const { DailyProductionRegister } = require('../src/models/DailyProductionRegister');

// Services & Controllers
const { PosOrderService } = require('../src/services/posOrderService');
const { SmartCardService } = require('../src/services/smartCardService');
const { DailyProductionService } = require('../src/services/dailyProductionService');
const KdsService = require('../src/services/kdsService');
const inventoryController = require('../src/controllers/inventoryController');
const channelOperationsController = require('../src/controllers/channelOperationsController');

let replSet;

function buildMockReqRes(role = 'CAFE_ADMIN', customAuth = {}, body = {}, query = {}, params = {}) {
  let statusCode = 200;
  let responseData = null;

  const req = {
    auth: {
      userId: customAuth.userId || 'USR-TEST-01',
      role,
      organisationId: customAuth.organisationId || 'ORG-ZAMORIN',
      isPrimaryMaster: role === 'MASTER',
      assignedCafeIds: customAuth.assignedCafeIds || ['ZC-0001', 'ZC-0002'],
      primaryCafeId: customAuth.primaryCafeId || 'ZC-0001',
      name: customAuth.name || 'Test Operator',
      ...customAuth,
    },
    params,
    query,
    body,
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
  };

  const next = (err) => {
    if (err) throw err;
  };

  return { req, res, next, getStatus: () => statusCode, getData: () => responseData };
}

test.before(async () => {
  replSet = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: 'wiredTiger' },
  });
  const uri = replSet.getUri();
  await mongoose.connect(uri);

  // Seed default cafe
  await Cafe.create({
    cafeId: 'ZC-0001',
    organisationId: 'ORG-ZAMORIN',
    name: 'Zamorin Calicut Flagship',
    displayName: 'Zamorin Calicut Flagship',
    createdBy: 'USR-SEED',
    status: 'ACTIVE',
    businessDayCutoffHour: 4,
  });
});

test.after(async () => {
  await mongoose.disconnect();
  if (replSet) await replSet.stop();
});

// ----------------------------------------------------------------------------
// TEST 1: F063 — Half-and-Half Pizza Higher-Half Pricing Engine
// ----------------------------------------------------------------------------
test('1. F063: Half-and-Half Pizza Customizer computes Math.max(halfA, halfB) + crust + toppings in integer paise', async () => {
  const lineItem = {
    menuItemId: 'MENU-PIZZA-HH',
    name: 'Custom Half and Half Pizza',
    quantity: 2,
    isHalfAndHalf: true,
    pizzaConfig: {
      isHalfAndHalf: true,
      halfA: { menuItemId: 'MENU-MARG', pricePaisa: 35000 }, // ₹350
      halfB: { menuItemId: 'MENU-PEPPERONI', pricePaisa: 42000 }, // ₹420 (higher)
      crust: { name: 'Cheese Burst', pricePaisa: 6000 }, // ₹60
      toppingsPricePaisa: 4000, // ₹40
    },
  };

  const totals = PosOrderService.calculateTotals({
    lineItems: [lineItem],
  });

  // Expected single unit price = Math.max(35000, 42000) + 6000 + 4000 = 52000 paise (₹520)
  assert.equal(totals.lineItems[0].unitPricePaisa, 52000);
  // Line subtotal for qty 2 = 52000 * 2 = 104000 paise (₹1040)
  assert.equal(totals.subtotalPaisa, 104000);
  assert.ok(totals.lineItems[0].pizzaConfig.isHalfAndHalf);
});

// ----------------------------------------------------------------------------
// TEST 2: F044 — Fast-Biller Shortcode Lookup
// ----------------------------------------------------------------------------
test('2. F044: Shortcode Fast-Biller correctly resolves item by alphanumeric shortcode', async () => {
  await MenuItem.create({
    menuItemId: 'MENU-991',
    name: 'Single Origin Cold Brew',
    nameLower: 'single origin cold brew',
    category: 'COFFEE',
    currentPricePaisa: 22000,
    shortcode: 'CB01',
    organisationId: 'ORG-ZAMORIN',
    createdByUserId: 'USR-SEED',
  });

  const foundItem = await PosOrderService.lookupMenuItemByShortcode('cb01', 'ZC-0001', 'ORG-ZAMORIN');
  assert.ok(foundItem);
  assert.equal(foundItem.menuItemId, 'MENU-991');
  assert.equal(foundItem.shortcode, 'CB01');
});

// ----------------------------------------------------------------------------
// TEST 3: F272 — KDS Aggregated Item Batch View
// ----------------------------------------------------------------------------
test('3. F272: KDS Aggregated Item Batch View groups active pending orders across tickets', async () => {
  await KdsTicket.create({
    ticketId: 'KDS-BATCH-01',
    organisationId: 'ORG-ZAMORIN',
    cafeId: 'ZC-0001',
    status: 'RECEIVED',
    prepStation: 'HOT_KITCHEN',
    items: [
      { itemId: 'MENU-DOSA', name: 'Masala Dosa', quantity: 3, prepStation: 'HOT_KITCHEN' },
      { itemId: 'MENU-VADA', name: 'Medu Vada', quantity: 2, prepStation: 'HOT_KITCHEN' },
    ],
  });

  await KdsTicket.create({
    ticketId: 'KDS-BATCH-02',
    organisationId: 'ORG-ZAMORIN',
    cafeId: 'ZC-0001',
    status: 'PREPARING',
    prepStation: 'HOT_KITCHEN',
    items: [
      { itemId: 'MENU-DOSA', name: 'Masala Dosa', quantity: 4, prepStation: 'HOT_KITCHEN' },
    ],
  });

  const batchView = await KdsService.getAggregatedItemBatchView({
    organisationId: 'ORG-ZAMORIN',
    cafeId: 'ZC-0001',
    prepStation: 'HOT_KITCHEN',
  });

  assert.equal(batchView.activeTicketCount, 2);
  const dosaAgg = batchView.aggregatedItems.find((i) => i.itemId === 'MENU-DOSA');
  assert.ok(dosaAgg);
  assert.equal(dosaAgg.totalPendingQuantity, 7); // 3 + 4 = 7
  assert.equal(dosaAgg.ticketCount, 2);
});

// ----------------------------------------------------------------------------
// TEST 4: F036 — Payment-Gated Kitchen Dispatch
// ----------------------------------------------------------------------------
test('4. F036: Payment-Gated Kitchen Dispatch holds tickets until payment completed', async () => {
  const tickets = await KdsService.createTicketsFromOrder({
    organisationId: 'ORG-ZAMORIN',
    cafeId: 'ZC-0001',
    billId: 'BILL-GATE-01',
    items: [{ itemId: 'MENU-BURGER', name: 'Classic Burger', quantity: 1 }],
    paymentGatedKitchenDispatch: true,
    paymentStatus: 'UNPAID',
  });

  assert.equal(tickets[0].status, 'HELD_AWAITING_PAYMENT');

  // Once paid, release held tickets
  const releaseRes = await KdsService.releaseHeldTicketsForBill({
    organisationId: 'ORG-ZAMORIN',
    cafeId: 'ZC-0001',
    billId: 'BILL-GATE-01',
  });

  assert.equal(releaseRes.releasedCount, 1);
  const updatedTicket = await KdsTicket.findOne({ ticketId: tickets[0].ticketId });
  assert.equal(updatedTicket.status, 'RECEIVED');
});

// ----------------------------------------------------------------------------
// TEST 5: F031 — Food vs Bar Split Invoices
// ----------------------------------------------------------------------------
test('5. F031: Food vs Bar Split Invoices creates separate Food (GST 5%) and Bar (State VAT 22%) invoices', async () => {
  const origBill = await Bill.create({
    billId: 'BILL-20261012-0081',
    organisationId: 'ORG-ZAMORIN',
    cafeId: 'ZC-0001',
    subtotalPaisa: 120000,
    totalPaisa: 126000,
    status: 'OPEN',
    cashierUserId: 'USR-SEED',
    businessDate: '2026-10-12',
    lineItems: [
      {
        menuItemId: 'MENU-PASTA',
        itemNameSnapshot: 'Penne Arrabiata',
        quantity: 1,
        unitPricePaisa: 40000,
        taxRatePercent: 5,
        taxClassification: 'GST_5',
        lineSubtotalPaisa: 40000,
      },
      {
        menuItemId: 'MENU-BEER',
        itemNameSnapshot: 'Craft IPA Pint',
        quantity: 2,
        unitPricePaisa: 40000,
        liquorClassification: { isLiquor: true, vatRatePercent: 22 },
        taxClassification: 'STATE_VAT',
        lineSubtotalPaisa: 80000,
      },
    ],
  });

  const splitResult = await PosOrderService.splitBillByFoodBar({
    originalBillId: origBill.billId,
    authContext: { userId: 'USR-01', organisationId: 'ORG-ZAMORIN', role: 'MASTER' },
  });

  assert.equal(splitResult.status, 'SPLIT_CLOSED');
  assert.equal(splitResult.foodBill.isLiquorInvoice, false);
  assert.equal(splitResult.barBill.isLiquorInvoice, true);
});

// ----------------------------------------------------------------------------
// TEST 6: F122 — Raw Material Menu Auto-86 Lock
// ----------------------------------------------------------------------------
test('6. F122: Raw Material Menu Auto-86 Lock toggles dependent items when raw stock depletes', async () => {
  await Recipe.create({
    recipeId: 'RCP-8801',
    organisationId: 'ORG-ZAMORIN',
    name: 'Espresso Tonic Recipe',
    ingredients: [
      { inventoryItemId: 'RM-TONIC-WATER', ingredientName: 'Tonic Water', quantity: 200, uom: 'ML' },
    ],
    createdByUserId: 'USR-SEED',
  });

  const item = await MenuItem.create({
    menuItemId: 'MENU-992',
    name: 'Espresso Tonic',
    nameLower: 'espresso tonic',
    category: 'BEVERAGES_OTHER',
    currentPricePaisa: 28000,
    primaryRecipeId: 'RCP-8801',
    isAvailable: true,
    organisationId: 'ORG-ZAMORIN',
    createdByUserId: 'USR-SEED',
  });

  const { req, res, next, getStatus, getData } = buildMockReqRes('MASTER', {}, {
    itemId: 'RM-TONIC-WATER',
    cafeId: 'ZC-0001',
    currentQuantity: 0, // Out of stock
  });

  await inventoryController.evaluateRawMaterialAuto86Handler(req, res, next);
  assert.equal(getStatus(), 200);

  const updatedItem = await MenuItem.findOne({ menuItemId: 'MENU-992' });
  assert.equal(updatedItem.auto86Locked, true);
  assert.equal(updatedItem.isAvailable, false);
  assert.ok(updatedItem.auto86Reason.includes('RM-TONIC-WATER'));

  // Replenish stock -> auto unlocks
  const { req: req2, res: res2, next: next2, getData: getData2 } = buildMockReqRes('MASTER', {}, {
    itemId: 'RM-TONIC-WATER',
    cafeId: 'ZC-0001',
    currentQuantity: 50,
  });
  await inventoryController.evaluateRawMaterialAuto86Handler(req2, res2, next2);
  const unlockedItem = await MenuItem.findOne({ menuItemId: 'MENU-992' });
  assert.equal(unlockedItem.auto86Locked, false);
  assert.equal(unlockedItem.isAvailable, true);
});

// ----------------------------------------------------------------------------
// TEST 7: F137–F140 — Daily Finished-Item Batch Register
// ----------------------------------------------------------------------------
test('7. F137–F140: Daily Finished-Item Batch Register tracks morning yield and locks on zero', async () => {
  const reg = await DailyProductionService.registerDailyBatch({
    organisationId: 'ORG-ZAMORIN',
    cafeId: 'ZC-0001',
    date: '2026-10-12',
    menuItemId: 'MENU-CROISSANT',
    initialYieldQty: 10,
    batchNumber: 'BAKERY-AM-01',
  });

  assert.equal(reg.remainingQty, 10);
  assert.equal(reg.isLocked, false);

  // Sale decrement 8
  const dec1 = await DailyProductionService.decrementDailyYield({
    organisationId: 'ORG-ZAMORIN',
    cafeId: 'ZC-0001',
    date: '2026-10-12',
    menuItemId: 'MENU-CROISSANT',
    quantity: 8,
  });
  assert.equal(dec1.remainingQty, 2);
  assert.equal(dec1.isLocked, false);

  // Sale decrement final 2 -> Exhausted
  const dec2 = await DailyProductionService.decrementDailyYield({
    organisationId: 'ORG-ZAMORIN',
    cafeId: 'ZC-0001',
    date: '2026-10-12',
    menuItemId: 'MENU-CROISSANT',
    quantity: 2,
  });
  assert.equal(dec2.remainingQty, 0);
  assert.equal(dec2.isLocked, true);
  assert.equal(dec2.status, 'DEPLETED');

  // Next sale attempt rejected
  await assert.rejects(
    DailyProductionService.decrementDailyYield({
      organisationId: 'ORG-ZAMORIN',
      cafeId: 'ZC-0001',
      date: '2026-10-12',
      menuItemId: 'MENU-CROISSANT',
      quantity: 1,
    }),
    (err) => err.code === 'DAILY_BATCH_DEPLETED' || /exhausted/i.test(err?.message || '')
  );
});

// ----------------------------------------------------------------------------
// TEST 8: F156–F159 — Actual Production Yield & Unit Cost Adjustment
// ----------------------------------------------------------------------------
test('8. F156–F159: Actual Production Yield recomputes unit cost in paise based on weighed output', async () => {
  await BatchProductionLog.create({
    batchNumber: 'BATCH-YIELD-01',
    organisationId: 'ORG-ZAMORIN',
    cafeId: 'ZC-0001',
    recipeId: 'RCP-COOKIE',
    recipeName: 'Choco Chip Cookies',
    outputItemId: 'RM-COOKIE-DOUGH',
    plannedYield: 10,
    actualYield: 10,
    yieldUom: 'UNIT',
    totalMaterialCostPaisa: 100000, // ₹1,000 total RM cost
    unitCostPaisa: 10000, // ₹100 per unit theoretical
    producedByUserId: 'USR-SEED',
  });

  const { req, res, next, getStatus, getData } = buildMockReqRes('MASTER', {}, {
    batchNumber: 'BATCH-YIELD-01',
    actualYieldWeighed: 8, // Actual yield was only 8 units
  });

  await inventoryController.recordActualProductionYield(req, res, next);
  assert.equal(getStatus(), 200);
  const data = getData();
  // 100,000 paise / 8 units = 12,500 paise (₹125) adjusted unit cost
  assert.equal(data.adjustedUnitCostPaisa, 12500);
  assert.equal(data.yieldEfficiencyPercent, 80);
});

// ----------------------------------------------------------------------------
// TEST 9: F188–F191 — Irreversible Historical Stock Freeze Lock
// ----------------------------------------------------------------------------
test('9. F188–F191: Irreversible Historical Stock Freeze Lock blocks backdated entries', async () => {
  // Set freeze date to 2026-10-01
  const { req, res, next, getStatus, getData } = buildMockReqRes('MASTER', {}, {
    cafeId: 'ZC-0001',
    freezeDate: '2026-10-01T00:00:00.000Z',
  });
  await inventoryController.setHistoricalFreezeDate(req, res, next);
  assert.equal(getStatus(), 200);

  // Attempting to move backward is rejected
  const { req: reqBack, res: resBack, next: nextBack } = buildMockReqRes('MASTER', {}, {
    cafeId: 'ZC-0001',
    freezeDate: '2026-09-01T00:00:00.000Z',
  });
  await assert.rejects(
    inventoryController.setHistoricalFreezeDate(reqBack, resBack, nextBack),
    (err) => err.code === 'FREEZE_DATE_IRREVERSIBLE' || /cannot be moved backward/i.test(err?.message || '')
  );

  // Attempting backdated stock entry prior to freeze date is rejected
  await CafeInventoryConfig.create({
    organisationId: 'ORG-ZAMORIN',
    cafeId: 'ZC-0001',
    itemId: 'RM-SUGAR',
    currentQuantityBase: 100,
    availableQuantityBase: 100,
  });

  const { req: reqEntry, res: resEntry, next: nextEntry } = buildMockReqRes('CAFE_ADMIN', {}, {
    cafeId: 'ZC-0001',
    itemId: 'RM-SUGAR',
    movementType: 'MANUAL_ADJUSTMENT',
    quantity: 10,
    movementDate: '2026-09-15T00:00:00.000Z', // Before 2026-10-01 freeze!
  });
  await assert.rejects(
    inventoryController.recordMovement(reqEntry, resEntry, nextEntry),
    (err) => err.code === 'CANNOT_POST_BEFORE_FREEZE_DATE' || /Cannot post or modify inventory entries prior to historical freeze date/i.test(err?.message || '')
  );
});

// ----------------------------------------------------------------------------
// TEST 10: F114–F116 — Deferred Advance Stock Consumption
// ----------------------------------------------------------------------------
test('10. F114–F116: Deferred Advance Stock Consumption executes explicit deduction and prevents double depletion', async () => {
  const deposit = await AdvanceDeposit.create({
    depositId: 'ADV-DEP-20261012-01',
    receiptVoucherNumber: 'RV-20261012-01',
    organisationId: 'ORG-ZAMORIN',
    cafeId: 'ZC-0001',
    customerName: 'Party Client',
    depositAmountPaisa: 500000,
    totalDepositAmountPaisa: 500000,
    unappliedAmountPaisa: 500000,
    plannedItems: [
      { menuItemId: 'MENU-PARTY-COMBO', name: 'Party Feast Pack', quantity: 5 },
    ],
    stockConsumptionStatus: 'PENDING',
    receivedByUserId: 'USR-01',
  });

  const { req, res, next, getStatus, getData } = buildMockReqRes('CAFE_ADMIN', {}, {}, {}, { depositId: deposit.depositId });
  await inventoryController.consumeAdvanceStockHandler(req, res, next);
  assert.equal(getStatus(), 200);
  assert.equal(getData().stockConsumptionStatus, 'CONSUMED');

  // Attempting second consumption throws error
  const { req: req2, res: res2, next: next2 } = buildMockReqRes('CAFE_ADMIN', {}, {}, {}, { depositId: deposit.depositId });
  await assert.rejects(
    inventoryController.consumeAdvanceStockHandler(req2, res2, next2),
    (err) => err.code === 'STOCK_ALREADY_CONSUMED' || /already been consumed/i.test(err?.message || '')
  );
});

// ----------------------------------------------------------------------------
// TEST 11: F085 — Food Court Prepaid Smart Card Engine
// ----------------------------------------------------------------------------
test('11. F085: Prepaid Smart Card Engine executes Issue -> Topup -> Debit -> Refund -> Liability Report', async () => {
  // 1. Issue card with ₹500 balance + ₹50 deposit
  const issued = await SmartCardService.issueCard({
    cardUid: 'RFID-CARD-8819',
    cafeId: 'ZC-0001',
    customerName: 'Rohit Sharma',
    initialTopupPaisa: 50000, // ₹500
    securityDepositPaisa: 5000, // ₹50
    authContext: { userId: 'CASHIER-1' },
  });
  assert.equal(issued.balancePaisa, 50000);
  assert.equal(issued.securityDepositPaisa, 5000);

  // 2. Top-up ₹200
  const topped = await SmartCardService.topupCard({
    cardUid: 'RFID-CARD-8819',
    amountPaisa: 20000,
    authContext: { userId: 'CASHIER-1' },
  });
  assert.equal(topped.balancePaisa, 70000);

  // 3. Debit ₹300 for lunch
  const debited = await SmartCardService.debitCard({
    cardUid: 'RFID-CARD-8819',
    amountPaisa: 30000,
    referenceBillId: 'BILL-LUNCH-01',
    authContext: { userId: 'CASHIER-1' },
  });
  assert.equal(debited.balancePaisa, 40000);

  // 4. Check liability report before refund
  const report = await SmartCardService.getUnspentLiabilityReport({ cafeId: 'ZC-0001' });
  assert.equal(report.totalUnspentBalancePaisa, 40000);
  assert.equal(report.totalSecurityDepositPaisa, 5000);
  assert.equal(report.totalFloatLiabilityPaisa, 45000);

  // 5. Surrender and refund card
  const refunded = await SmartCardService.refundAndCloseCard({
    cardUid: 'RFID-CARD-8819',
    authContext: { userId: 'CASHIER-1' },
  });
  assert.equal(refunded.status, 'REFUNDED');
  assert.equal(refunded.totalRefundPaisa, 45000); // 40000 balance + 5000 deposit
});

// ----------------------------------------------------------------------------
// TEST 12: F074, F075 — Pre-Tax vs Post-Tax Tip Base Selector
// ----------------------------------------------------------------------------
test('12. F074, F075: Tip Base Selector accurately computes on pre-tax subtotal vs post-tax grand total', async () => {
  const lineItem = {
    menuItemId: 'MENU-TEST-01',
    name: 'Gourmet Platter',
    quantity: 1,
    unitPricePaisa: 100000, // ₹1,000 subtotal
    taxRatePercent: 5, // ₹50 tax -> ₹1,050 post-tax
  };

  // Case A: Pre-Tax Subtotal tip (10% of ₹1,000 = ₹100 = 10,000p)
  const totalsPreTax = PosOrderService.calculateTotals({
    lineItems: [lineItem],
    tipPercentage: 10,
    tipCalculationBase: 'PRE_TAX_SUBTOTAL',
  });
  assert.equal(totalsPreTax.tipPaisa, 10000);
  assert.equal(totalsPreTax.totalPaisa, 115000); // 105,000 + 10,000 = 115,000p

  // Case B: Post-Tax Grand Total tip (10% of ₹1,050 = ₹105 = 10,500p)
  const totalsPostTax = PosOrderService.calculateTotals({
    lineItems: [lineItem],
    tipPercentage: 10,
    tipCalculationBase: 'POST_TAX_GRAND_TOTAL',
  });
  assert.equal(totalsPostTax.tipPaisa, 10500);
  assert.equal(totalsPostTax.totalPaisa, 115500); // 105,000 + 10,500 = 115,500p
});

// ----------------------------------------------------------------------------
// TEST 13: F278 — Delivery Rider Pickup OTP Handover Check-In
// ----------------------------------------------------------------------------
test('13. F278: Delivery Rider Pickup 4-digit OTP Check-In validates partner dispatch', async () => {
  const channelOrder = await ChannelOrder.create({
    orderId: 'ORD-SWIGGY-9011',
    orderNumber: 'SWG-9011',
    organisationId: 'ORG-ZAMORIN',
    cafeId: 'ZC-0001',
    channel: 'AGGREGATOR',
    provider: 'SWIGGY',
    status: 'READY_FOR_PICKUP',
    riderPickupOtp: '6543',
    lineItems: [
      { menuItemId: 'MENU-991', itemNameSnapshot: 'Cold Brew', quantity: 1, unitPricePaisa: 22000, lineSubtotalPaisa: 22000, lineTotalPaisa: 23100 },
    ],
    pricing: { subtotalPaisa: 22000, totalPaisa: 23100 },
  });

  // Wrong OTP rejected
  const { req: reqWrong, res: resWrong, next: nextWrong } = buildMockReqRes('CAFE_ADMIN', {}, { otp: '0000' }, {}, { orderId: channelOrder.orderId });
  await assert.rejects(
    channelOperationsController.verifyRiderHandoverHandler(reqWrong, resWrong, nextWrong),
    (err) => err.code === 'INVALID_RIDER_OTP' || /does not match/i.test(err?.message || '')
  );

  // Correct OTP accepted
  const { req, res, next, getStatus, getData } = buildMockReqRes('CAFE_ADMIN', {}, { otp: '6543' }, {}, { orderId: channelOrder.orderId });
  await channelOperationsController.verifyRiderHandoverHandler(req, res, next);
  assert.equal(getStatus(), 200);
  assert.equal(getData().riderHandoverStatus, 'VERIFIED');
  assert.equal(getData().status, 'DISPATCHED');
});

// ----------------------------------------------------------------------------
// TEST 14: F092 — Train Delivery Logistics & Cutlery Preferences
// ----------------------------------------------------------------------------
test('14. F092: Train Delivery Logistics and Cutlery badges persist correctly on ChannelOrder', async () => {
  const order = await ChannelOrder.create({
    orderId: 'ORD-IRCTC-5501',
    orderNumber: 'IRCTC-5501',
    organisationId: 'ORG-ZAMORIN',
    cafeId: 'ZC-0001',
    channel: 'DIRECT_WEB',
    trainDetails: {
      pnr: '4218901234',
      trainNumber: '12601',
      coach: 'B3',
      seatNumber: '56',
      stationCode: 'CLT',
    },
    cutleryPreference: {
      optIn: false,
      details: 'Guest opted out of plastic cutlery for environmental footprint',
    },
    lineItems: [
      { menuItemId: 'MENU-991', itemNameSnapshot: 'Cold Brew', quantity: 1, unitPricePaisa: 22000, lineSubtotalPaisa: 22000, lineTotalPaisa: 23100 },
    ],
    pricing: { subtotalPaisa: 22000, totalPaisa: 23100 },
  });

  assert.equal(order.trainDetails.pnr, '4218901234');
  assert.equal(order.trainDetails.coach, 'B3');
  assert.equal(order.cutleryPreference.optIn, false);
});

// ----------------------------------------------------------------------------
// TEST 15: F011 — Mandatory Tender Selection Mode
// ----------------------------------------------------------------------------
test('15. F011: Mandatory Tender Selection Mode rejects implicit fallback to Cash', async () => {
  await Cafe.updateOne(
    { cafeId: 'ZC-0001' },
    { $set: { mandatoryTenderSelection: true } }
  );

  // Attempt commit without payment method / tender
  await assert.rejects(
    PosOrderService.processOrder(
      {
        cafeId: 'ZC-0001',
        lineItems: [{ menuItemId: 'MENU-991', quantity: 1, unitPricePaisa: 22000, name: 'Cold Brew' }],
        paymentMethod: null, // No tender specified!
      },
      { userId: 'USR-01', role: 'MASTER', organisationId: 'ORG-ZAMORIN' },
      'SAVE'
    ),
    (err) => err.code === 'TENDER_SELECTION_MANDATORY' || /tender selection is required/i.test(err?.message || '')
  );

  // Commit with explicit tender succeeds
  const committed = await PosOrderService.processOrder(
    {
      cafeId: 'ZC-0001',
      lineItems: [{ menuItemId: 'MENU-991', quantity: 1, unitPricePaisa: 22000, name: 'Cold Brew' }],
      paymentMethod: 'CARD', // Explicit tender
    },
    { userId: 'USR-01', role: 'MASTER', organisationId: 'ORG-ZAMORIN' },
    'SAVE'
  );

  assert.ok(committed.bill);
  assert.equal(committed.bill.paymentMethod, 'CARD');
});
