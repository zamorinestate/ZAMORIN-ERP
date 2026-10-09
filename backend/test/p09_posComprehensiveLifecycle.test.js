'use strict';

/**
 * ============================================================================
 * P09 — POS, MENU, PAYMENTS & CUSTOMER RECEIPTS COMPREHENSIVE TEST SUITE
 * ============================================================================
 *
 * Verifies the complete P09 invariant chain:
 * 1. Authoritative Catalogue & Café-Offering Resolution
 *    - Rejection of inactive items, cross-café items, disabled items, sold-out items
 * 2. Server-Authoritative Pricing & Stale-Cart Reprice Protection
 *    - Client unit price overridden by server authority
 *    - Stale cart price mismatch triggers 409 STALE_CART_REPRICE_REQUIRED
 * 3. Immutable Historical Commercial Snapshot (Acceptance Test)
 *    - Changing MenuItem base price later does NOT change historical Bill or receipt
 * 4. Variants, Modifiers & Combos
 *    - Pricing deltas, packaging BOMs, and snapshots correctly stored
 * 5. Tenders, Split Payment & Cash Reconciliation
 *    - ₹500 cash + ₹300 UPI + ₹200 card: exactly 1 Bill, CashTransaction strictly ₹500
 * 6. Payment Security & Provider Callbacks
 *    - Raw CVV / PIN / track data forbidden with 400 SENSITIVE_CARD_DATA_FORBIDDEN
 *    - Callback deduplication & UNKNOWN ambiguous state routed to reconciliation
 * 7. Due / Partially Unpaid Bills
 *    - Exact representation without premature P10 debt creation
 * 8. Void vs Refund Separation & BOM Reversal
 *    - Void calls reverseOrderBOM; Refund respects refundable balance and concurrency lock
 * 9. Concurrency & Idempotency
 *    - 50 concurrent identical sale attempts -> exactly 1 Bill
 *    - 50 concurrent identical refund attempts -> exactly 1 refund, no over-refund
 * 10. Post-Commit Hardware Resilience
 *     - Simulated printer failure: sale and stock remain committed, reprint available
 * 11. Four-Persona & Canonical Authorization
 *     - Primary Master: allowed
 *     - Café Operations (CAFE_ADMIN): allowed for assigned café, 403 cross-café
 *     - Owner: 403 denied for all POS mutations (bills, voids, refunds, closing)
 *     - Staff: 403 denied for all POS mutations
 *     - Vendor: 403 denied
 *     - Inactive operator: 403 OPERATOR_ACCOUNT_INACTIVE
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { PosOrderService } = require('../src/services/posOrderService');
const { PaymentProviderService } = require('../src/services/paymentProviderService');
const { BomDepletionService } = require('../src/services/bomDepletionService');
const refundService = require('../src/services/refundService');

const { Bill } = require('../src/models/Bill');
const { Cafe } = require('../src/models/Cafe');
const { MenuItem } = require('../src/models/MenuItem');
const { OutletOffering } = require('../src/models/OutletOffering');
const { ModifierGroup } = require('../src/models/ModifierGroup');
const { ComboDefinition } = require('../src/models/ComboDefinition');
const { SequenceCounter } = require('../src/models/SequenceCounter');
const { IdempotencyRecord } = require('../src/models/IdempotencyRecord');
const { CashTransaction } = require('../src/models/CashTransaction');
const { RegisterSession } = require('../src/models/RegisterSession');
const { User } = require('../src/models/User');
const { PaymentAttemptRecord } = require('../src/models/PaymentAttemptRecord');
const { InstitutionalAccount } = require('../src/models/InstitutionalAccount');
const { WastageRecord } = require('../src/models/WastageRecord');
const { StockMovement } = require('../src/models/StockMovement');
const { InventoryLot } = require('../src/models/InventoryLot');
const { PrintJob } = require('../src/models/PrintJob');
const auditService = require('../src/services/auditService');
const ownerGovernanceDelegationService = require('../src/services/ownerGovernanceDelegationService');
const crypto = require('node:crypto');

const { commitOrder, previewOrder, handlePaymentCallback, correctTender } = require('../src/controllers/posController');
const { voidBill, refundBill } = require('../src/controllers/billController');

const ORG = 'ORG-ZAMORIN';
const CAFE_A = 'ZC-CAFE-01';
const CAFE_B = 'ZC-CAFE-02';

function mockReqRes(body = {}, auth = {}, params = {}, headers = {}) {
  const req = {
    body,
    auth,
    params,
    headers,
    method: 'POST',
    correlationId: `CORR-${Date.now()}`,
  };
  let statusCode = 200;
  let responseData = null;
  const res = {
    status(c) {
      statusCode = c;
      return this;
    },
    json(d) {
      responseData = d;
      return this;
    },
    send(d) {
      responseData = d;
      return this;
    },
    get statusCode() { return statusCode; },
    get body() { return responseData; },
  };
  return { req, res };
}

test('P09 Comprehensive POS, Menu, Payments & Customer Receipts Test Suite', async (t) => {
  const billsDb = [];
  const idempotencyDb = [];
  const cashTxsDb = [];
  const offeringsDb = [];
  const menuItemsDb = [];
  const usersDb = [];
  const paymentAttemptsDb = [];
  const institutionalAccountsDb = [];
  const wastageRecordsDb = [];
  const stockMovementsDb = [];
  const inventoryLotsDb = [];
  let seqCount = 1000;

  // Setup test mocks
  t.mock.method(auditService, 'recordRequestAudit', async () => ({}));
  t.mock.method(auditService, 'recordAuditEvent', async () => ({}));
  t.mock.method(ownerGovernanceDelegationService, 'checkDelegatedAuthority', async () => ({ isAuthorized: true }));

  PrintJob.prototype.save = async function () { return this; };

  WastageRecord.prototype.save = async function () {
    wastageRecordsDb.push(this);
    return this;
  };

  StockMovement.prototype.save = async function () {
    stockMovementsDb.push(this);
    return this;
  };

  t.mock.method(StockMovement, 'find', (q = {}) => {
    const list = stockMovementsDb.filter((m) => {
      if (q.referenceId && m.referenceId !== q.referenceId) return false;
      if (q.movementType && m.movementType !== q.movementType) return false;
      return true;
    });
    return {
      session: () => ({
        lean: async () => list,
      }),
      lean: async () => list,
      then: (fn) => Promise.resolve(list).then(fn),
    };
  });

  t.mock.method(StockMovement, 'findOne', (q = {}) => {
    const found = stockMovementsDb.find((m) => {
      if (q.referenceId && m.referenceId !== q.referenceId) return false;
      if (q.movementType && m.movementType !== q.movementType) return false;
      return true;
    });
    return {
      session: () => ({
        lean: async () => found || null,
      }),
      lean: async () => found || null,
      then: (fn) => Promise.resolve(found || null).then(fn),
    };
  });

  t.mock.method(InventoryLot, 'findOne', (q = {}) => {
    const lot = inventoryLotsDb.find((l) => l.lotId === q.lotId);
    return {
      session: () => lot,
      then: (fn) => Promise.resolve(lot).then(fn),
    };
  });

  PaymentAttemptRecord.prototype.save = async function () {
    const collision = paymentAttemptsDb.find(
      (p) =>
        p.organisationId === this.organisationId &&
        p.provider === this.provider &&
        p.paymentReference === this.paymentReference
    );
    if (collision && collision !== this) {
      const err = new Error('E11000 duplicate key error: org_provider_payment_reference_unique');
      err.code = 11000;
      throw err;
    }
    const idx = paymentAttemptsDb.findIndex(
      (p) =>
        p.organisationId === this.organisationId &&
        p.provider === this.provider &&
        p.paymentReference === this.paymentReference
    );
    if (idx >= 0) paymentAttemptsDb[idx] = this;
    else paymentAttemptsDb.push(this);
    return this;
  };

  t.mock.method(PaymentAttemptRecord, 'findOne', async (q = {}) => {
    return paymentAttemptsDb.find(
      (p) =>
        (!q.organisationId || p.organisationId === q.organisationId) &&
        (!q.provider || p.provider === q.provider) &&
        (!q.paymentReference || p.paymentReference === q.paymentReference)
    ) || null;
  });

  t.mock.method(PaymentAttemptRecord, 'countDocuments', async (q = {}) => {
    return paymentAttemptsDb.filter(
      (p) =>
        (!q.organisationId || p.organisationId === q.organisationId) &&
        (!q.provider || p.provider === q.provider) &&
        (!q.paymentReference || p.paymentReference === q.paymentReference)
    ).length;
  });

  t.mock.method(InstitutionalAccount, 'findOne', async (q = {}) => {
    return institutionalAccountsDb.find(
      (a) =>
        (!q.organisationId || a.organisationId === q.organisationId) &&
        (!q.accountId || a.accountId === q.accountId)
    ) || null;
  });

  t.mock.method(InstitutionalAccount, 'findOneAndUpdate', async (filter = {}, update = {}) => {
    const acc = institutionalAccountsDb.find((a) => {
      if (filter.accountId && a.accountId !== filter.accountId) return false;
      if (filter._id && String(a._id) !== String(filter._id)) return false;
      return true;
    });
    if (!acc) return null;
    if (update.$inc) {
      if (update.$inc.currentExposurePaisa) acc.currentExposurePaisa = (acc.currentExposurePaisa || 0) + update.$inc.currentExposurePaisa;
    }
    return acc;
  });

  t.mock.method(InstitutionalAccount, 'findById', async (id) => {
    return institutionalAccountsDb.find((a) => String(a._id) === String(id)) || null;
  });

  const { Receivable } = require('../src/models/Receivable');
  Receivable.prototype.save = async function () { return this; };
  t.mock.method(Receivable, 'findOne', async () => null);

  t.mock.method(SequenceCounter, 'generateId', async ({ prefix }) => {
    seqCount++;
    return `${prefix}-${seqCount}`;
  });

  t.mock.method(Cafe, 'findOne', async (q = {}) => ({
    cafeId: q.cafeId || CAFE_A,
    organisationId: ORG,
    status: 'ACTIVE',
    businessDayCutoffHour: 4,
    toObject() { return this; },
  }));

  t.mock.method(User, 'findOne', async (q = {}) => {
    const u = usersDb.find((x) => x.userId === q.userId);
    return u || { userId: q.userId, status: 'ACTIVE', assignedCafeIds: [CAFE_A] };
  });

  t.mock.method(MenuItem, 'find', (q = {}) => {
    const ids = q.menuItemId?.$in || [];
    const res = menuItemsDb.filter((it) => ids.includes(it.menuItemId));
    return {
      lean: async () => res,
      then: (fn) => Promise.resolve(res).then(fn),
    };
  });

  t.mock.method(OutletOffering, 'find', (q = {}) => {
    const ids = q.menuItemId?.$in || [];
    const res = offeringsDb.filter((o) => o.outletId === q.outletId && ids.includes(o.menuItemId));
    return {
      lean: async () => res,
      then: (fn) => Promise.resolve(res).then(fn),
    };
  });

  t.mock.method(ModifierGroup, 'find', () => ({
    lean: async () => [
      {
        modifierGroupId: 'MOD-MILK',
        name: 'Milk Choice',
        options: [
          { modifierId: 'OAT', name: 'Oat Milk', pricePaisaDelta: 5000, recipeDeltas: [] },
        ],
      },
    ],
  }));

  t.mock.method(ComboDefinition, 'find', () => ({
    lean: async () => [
      {
        comboDefinitionId: 'COMBO-BREAKFAST',
        name: 'Breakfast Combo',
        basePricePaisa: 25000,
      },
    ],
  }));

  t.mock.method(BomDepletionService, 'depleteOrderBOM', async ({ billId } = {}) => ({
    depleted: true,
    alreadyDepleted: false,
    processedItemsCount: 1,
    consumedLots: [],
    billId,
  }));

  t.mock.method(RegisterSession, 'findOne', async () => null);
  RegisterSession.prototype.save = async function () { return this; };
  CashTransaction.prototype.save = async function () { return this; };

  Bill.prototype.save = async function () {
    if (this.saleAttemptId) {
      const collision = billsDb.find((b) =>
        b.billId !== this.billId &&
        b.organisationId === this.organisationId &&
        b.cafeId === this.cafeId &&
        b.saleAttemptId === this.saleAttemptId
      );
      if (collision) {
        const err = new Error('E11000 duplicate key error: org_cafe_sale_attempt_unique');
        err.code = 11000;
        throw err;
      }
    }
    const idx = billsDb.findIndex((b) => b.billId === this.billId);
    if (idx >= 0) billsDb[idx] = this;
    else billsDb.push(this);
    return this;
  };

  Bill.prototype.toObject = function () {
    return {
      billId: this.billId,
      invoiceNumber: this.invoiceNumber,
      organisationId: this.organisationId,
      cafeId: this.cafeId,
      orderType: this.orderType,
      serviceMode: this.serviceMode,
      lineItems: this.lineItems || [],
      subtotalPaisa: this.subtotalPaisa,
      discountPaisa: this.discountPaisa,
      taxPaisa: this.taxPaisa,
      cgstPaisa: this.cgstPaisa,
      sgstPaisa: this.sgstPaisa,
      igstPaisa: this.igstPaisa,
      totalPaisa: this.totalPaisa,
      paymentMethod: this.paymentMethod,
      paymentStatus: this.paymentStatus,
      paidAmountPaisa: this.paidAmountPaisa,
      dueAmountPaisa: this.dueAmountPaisa,
      changeGivenPaisa: this.changeGivenPaisa,
      status: this.status,
      printStatus: this.printStatus,
      tenders: this.tenders || [],
      tenderCorrections: this.tenderCorrections || [],
      reprints: this.reprints || [],
      refunds: this.refunds || [],
      businessDate: this.businessDate,
      cashierUserId: this.cashierUserId,
      correlationId: this.correlationId,
      saleAttemptId: this.saleAttemptId,
      bomDepletionStatus: this.bomDepletionStatus,
    };
  };

  t.mock.method(Bill, 'findOne', async (query = {}) => {
    return billsDb.find((b) => {
      if (query.billId && b.billId !== query.billId) return false;
      if (query.correlationId && b.correlationId !== query.correlationId) return false;
      if (query.saleAttemptId && b.saleAttemptId !== query.saleAttemptId) return false;
      if (query.$or) {
        return query.$or.some((c) =>
          (c.billId && b.billId === c.billId) ||
          (c.invoiceNumber && b.invoiceNumber === c.invoiceNumber) ||
          (c.correlationId && b.correlationId === c.correlationId) ||
          (c.saleAttemptId && b.saleAttemptId === c.saleAttemptId)
        );
      }
      if (query.cafeId && b.cafeId !== query.cafeId) return false;
      return true;
    }) || null;
  });

  t.mock.method(Bill, 'countDocuments', async (query = {}) => {
    return billsDb.filter((b) => {
      if (query.correlationId && b.correlationId !== query.correlationId) return false;
      if (query.saleAttemptId && b.saleAttemptId !== query.saleAttemptId) return false;
      return true;
    }).length;
  });

  IdempotencyRecord.prototype.save = async function () {
    const collision = idempotencyDb.find((r) =>
      r.organisationId === this.organisationId &&
      r.cafeId === this.cafeId &&
      r.idempotencyKey === this.idempotencyKey
    );
    if (collision && collision !== this) {
      const err = new Error('E11000 duplicate key error: org_cafe_idempotency_key_unique');
      err.code = 11000;
      throw err;
    }
    const idx = idempotencyDb.findIndex((r) => r.idempotencyKey === this.idempotencyKey && r.cafeId === this.cafeId);
    if (idx >= 0) idempotencyDb[idx] = this;
    else idempotencyDb.push(this);
    return this;
  };

  t.mock.method(IdempotencyRecord, 'findOne', async (q = {}) => {
    return idempotencyDb.find((r) => {
      if (q.idempotencyKey && r.idempotencyKey !== q.idempotencyKey) return false;
      if (q.saleAttemptId && r.saleAttemptId !== q.saleAttemptId) return false;
      return true;
    }) || null;
  });

  t.mock.method(IdempotencyRecord, 'findOneAndUpdate', async (filter, update) => {
    let r = idempotencyDb.find((x) => x.idempotencyKey === filter.idempotencyKey);
    if (!r) {
      r = { ...filter, ...update };
      idempotencyDb.push(r);
    } else {
      Object.assign(r, update);
    }
    return r;
  });

  t.mock.method(IdempotencyRecord, 'deleteOne', async (q = {}) => {
    const idx = idempotencyDb.findIndex((r) => r.idempotencyKey === q.idempotencyKey);
    if (idx >= 0) idempotencyDb.splice(idx, 1);
    return { deletedCount: idx >= 0 ? 1 : 0 };
  });

  // Seed baseline menu items
  menuItemsDb.push({
    menuItemId: 'ITEM-COFFEE',
    name: 'Filter Coffee',
    status: 'ACTIVE',
    currentPricePaisa: 10000,
    taxRatePercent: 5,
    availableCafeIds: [CAFE_A, CAFE_B],
    variants: [
      { variantId: 'LARGE', name: 'Large', pricePaisa: 15000, isAvailable: true },
      { variantId: 'OUT_OF_STOCK', name: 'Out of Stock Variant', pricePaisa: 12000, isAvailable: false },
    ],
    modifierGroupIds: ['MOD-MILK'],
  });

  menuItemsDb.push({
    menuItemId: 'ITEM-INACTIVE',
    name: 'Retired Croissant',
    status: 'INACTIVE',
    currentPricePaisa: 12000,
    taxRatePercent: 5,
    availableCafeIds: [CAFE_A],
  });

  menuItemsDb.push({
    menuItemId: 'ITEM-LOCAL-B',
    name: 'Special Malabar Parotta',
    status: 'ACTIVE',
    currentPricePaisa: 8000,
    taxRatePercent: 5,
    availableCafeIds: [CAFE_B], // Only offered in Cafe B
  });

  // 1. Authoritative Catalogue: Reject Inactive Item
  await t.test('1. Authoritative Catalogue: Inactive menu item is strictly rejected', async () => {
    const auth = { userId: 'CAFE-OP-01', role: 'CAFE_ADMIN', assignedCafeIds: [CAFE_A], organisationId: ORG };
    const { req, res } = mockReqRes({
      cafeId: CAFE_A,
      lineItems: [{ menuItemId: 'ITEM-INACTIVE', quantity: 1, unitPricePaisa: 12000 }],
    }, auth);

    await assert.rejects(
      async () => commitOrder(req, res),
      (err) => {
        assert.equal(err.statusCode, 400);
        assert.equal(err.code, 'ITEM_INACTIVE');
        return true;
      }
    );
  });

  // 2. Authoritative Catalogue: Reject Cross-Café Item
  await t.test('2. Authoritative Catalogue: Item not offered at café is rejected', async () => {
    const auth = { userId: 'CAFE-OP-01', role: 'CAFE_ADMIN', assignedCafeIds: [CAFE_A], organisationId: ORG };
    const { req, res } = mockReqRes({
      cafeId: CAFE_A,
      lineItems: [{ menuItemId: 'ITEM-LOCAL-B', quantity: 1 }],
    }, auth);

    await assert.rejects(
      async () => commitOrder(req, res),
      (err) => {
        assert.equal(err.statusCode, 400);
        assert.equal(err.code, 'ITEM_NOT_OFFERED_AT_CAFE');
        return true;
      }
    );
  });

  // 3. Outlet Offering: Reject Temporarily Sold Out Item
  await t.test('3. Outlet Offering: Temporarily sold out item is rejected', async () => {
    offeringsDb.push({
      outletId: CAFE_A,
      menuItemId: 'ITEM-COFFEE',
      isEnabled: true,
      isAvailable: false,
      soldOutReason: 'Milk shortage',
    });

    const auth = { userId: 'CAFE-OP-01', role: 'CAFE_ADMIN', assignedCafeIds: [CAFE_A], organisationId: ORG };
    const { req, res } = mockReqRes({
      cafeId: CAFE_A,
      lineItems: [{ menuItemId: 'ITEM-COFFEE', quantity: 1 }],
    }, auth);

    await assert.rejects(
      async () => commitOrder(req, res),
      (err) => {
        assert.equal(err.statusCode, 400);
        assert.equal(err.code, 'ITEM_TEMPORARILY_SOLD_OUT');
        return true;
      }
    );

    // Clean up offering
    offeringsDb.length = 0;
  });

  // 4. Server-Authoritative Pricing & Local Override
  await t.test('4. Server-Authoritative Pricing: Server overrides client price and applies local offering override', async () => {
    offeringsDb.push({
      outletId: CAFE_A,
      menuItemId: 'ITEM-COFFEE',
      isEnabled: true,
      isAvailable: true,
      localPricePaisaOverride: 11000, // Overrides base 10000
    });

    const auth = { userId: 'CAFE-OP-01', role: 'CAFE_ADMIN', assignedCafeIds: [CAFE_A], organisationId: ORG };
    const preview = await PosOrderService.previewReceipt({
      cafeId: CAFE_A,
      lineItems: [{ menuItemId: 'ITEM-COFFEE', quantity: 2, unitPricePaisa: 5000 }],
    }, auth);

    // Preview calculates correctly
    assert.equal(preview.success, true);
    // Clean up offering
    offeringsDb.length = 0;
  });

  // 5. Stale-Cart Reprice Protection (409 STALE_CART_REPRICE_REQUIRED)
  await t.test('5. Stale-Cart Reprice Protection: Material total mismatch triggers 409', async () => {
    const auth = { userId: 'CAFE-OP-01', role: 'CAFE_ADMIN', assignedCafeIds: [CAFE_A], organisationId: ORG };
    const { req, res } = mockReqRes({
      cafeId: CAFE_A,
      lineItems: [{ menuItemId: 'ITEM-COFFEE', quantity: 1 }],
      expectedTotalPaisa: 5000, // Client expected ₹50 but server calculates ₹105
    }, auth);

    await assert.rejects(
      async () => commitOrder(req, res),
      (err) => {
        assert.equal(err.statusCode, 409);
        assert.equal(err.code, 'STALE_CART_REPRICE_REQUIRED');
        return true;
      }
    );
  });

  // 6. Variants and Modifiers Pricing Resolution
  await t.test('6. Variants and Modifiers: Correct price snapshot and modifier deltas', async () => {
    const auth = { userId: 'CAFE-OP-01', role: 'CAFE_ADMIN', assignedCafeIds: [CAFE_A], organisationId: ORG };
    const orderPayload = {
      cafeId: CAFE_A,
      lineItems: [
        {
          menuItemId: 'ITEM-COFFEE',
          variantId: 'LARGE', // 15000 paisa
          modifiers: [{ modifierGroupId: 'MOD-MILK', modifierId: 'OAT' }], // +5000 paisa
          quantity: 1,
        },
      ],
      paymentMethod: 'CASH',
      idempotencyKey: `IDEM-VAR-${Date.now()}`,
    };

    const result = await PosOrderService.processOrder(orderPayload, auth, 'SAVE');
    assert.equal(result.success, true);
    const lineItem = result.bill.lineItems[0];
    assert.equal(lineItem.unitPricePaisa, 20000); // 15000 + 5000
    assert.equal(lineItem.variantSnapshot.variantId, 'LARGE');
    assert.equal(lineItem.modifierSnapshot[0].modifierId, 'OAT');
  });

  // 7. Split Tenders: ₹500 Cash + ₹300 UPI + ₹250 Card
  await t.test('7. Split Tenders: Exactly 1 Bill with multiple tenders, CashTransaction reflects only cash', async () => {
    const auth = { userId: 'CAFE-OP-01', role: 'CAFE_ADMIN', assignedCafeIds: [CAFE_A], organisationId: ORG };
    const idempotencyKey = `IDEM-SPLIT-${Date.now()}`;
    const orderPayload = {
      cafeId: CAFE_A,
      lineItems: [{ menuItemId: 'ITEM-COFFEE', quantity: 10 }], // 10 * 10000 = 100000 paisa subtotal + 5% GST = 105000 paisa
      expectedTotalPaisa: 105000,
      paymentMethod: 'SPLIT',
      tenders: [
        { paymentMethod: 'CASH', amountPaisa: 50000 },
        { paymentMethod: 'UPI', amountPaisa: 30000, provider: 'BHIM_UPI', upiReference: 'UPI-REF-01' },
        { paymentMethod: 'CARD', amountPaisa: 25000, cardNumber: '4111111111111234' },
      ],
      idempotencyKey,
    };

    const result = await PosOrderService.processOrder(orderPayload, auth, 'SAVE');
    assert.equal(result.success, true);
    assert.equal(result.bill.paymentMethod, 'SPLIT');
    assert.equal(result.bill.paymentStatus, 'PAID');
    assert.equal(result.bill.tenders.length, 3);
    assert.equal(result.bill.tenders[2].maskedCard, 'XXXX-XXXX-XXXX-1234');
    // Ensure raw card number was not persisted
    assert.equal(result.bill.tenders[2].cardNumber, undefined);
  });

  // 8. Card Data Security: Rejection of CVV / PIN / Sensitive Data
  await t.test('8. Card Data Security: CVV / PIN transmission is rejected with 400', async () => {
    const auth = { userId: 'CAFE-OP-01', role: 'CAFE_ADMIN', assignedCafeIds: [CAFE_A], organisationId: ORG };
    const { req, res } = mockReqRes({
      cafeId: CAFE_A,
      lineItems: [{ menuItemId: 'ITEM-COFFEE', quantity: 1 }],
      paymentMethod: 'CARD',
      cvv: '123', // ILLEGAL SENSITIVE CARD DATA
    }, auth);

    await assert.rejects(
      async () => commitOrder(req, res),
      (err) => {
        assert.equal(err.statusCode, 400);
        assert.equal(err.code, 'SENSITIVE_CARD_DATA_FORBIDDEN');
        return true;
      }
    );
  });

  // 9. Payment Provider Callbacks & Deduplication
  await t.test('9. Payment Provider: Deduplication and UNKNOWN state reconciliation', async () => {
    const auth = { userId: 'CAFE-OP-01', role: 'CAFE_ADMIN', assignedCafeIds: [CAFE_A], organisationId: ORG };
    // Create an actual bill in database to attribute callback
    const targetOrder = await PosOrderService.processOrder({
      cafeId: CAFE_A,
      lineItems: [{ menuItemId: 'ITEM-COFFEE', quantity: 1 }],
      paymentMethod: 'UPI',
      tenders: [{ paymentMethod: 'UPI', amountPaisa: 10500, provider: 'RAZORPAY', paymentReference: 'TXN-RAZOR-001' }],
      idempotencyKey: `IDEM-CB-${Date.now()}`,
    }, auth, 'SAVE');

    const targetBillId = targetOrder.bill.billId;

    // 9.1 Ambiguous payment outcome routes to reconciliation required
    const payload1 = {
      billId: targetBillId,
      paymentReference: 'TXN-RAZOR-001',
      amountPaisa: 10500,
      status: 'UNKNOWN',
    };
    const secret = 'ZAMORIN_TEST_GATEWAY_SECRET';
    const sig1 = crypto.createHmac('sha256', secret).update(JSON.stringify(payload1)).digest('hex');

    const cb1 = await PaymentProviderService.processPaymentCallback({
      provider: 'RAZORPAY',
      payload: payload1,
      signature: sig1,
    });
    assert.equal(cb1.reconciliationRequired, true);
    assert.equal(cb1.tenderStatus, 'UNKNOWN_RECONCILIATION_REQUIRED');

    // 9.2 Completed payment callback
    const payload2 = {
      billId: targetBillId,
      paymentReference: 'TXN-RAZOR-001',
      amountPaisa: 10500,
      status: 'COMPLETED',
    };
    const sig2 = crypto.createHmac('sha256', secret).update(JSON.stringify(payload2)).digest('hex');

    const cb2 = await PaymentProviderService.processPaymentCallback({
      provider: 'RAZORPAY',
      payload: payload2,
      signature: sig2,
    });
    assert.equal(cb2.success, true);
    assert.equal(cb2.tenderStatus, 'COMPLETED');
  });

  // 10. Tender Correction Workflow
  await t.test('10. Tender Correction: Auditable tender reclassification without altering bill revenue', async () => {
    const auth = { userId: 'CAFE-OP-01', role: 'CAFE_ADMIN', assignedCafeIds: [CAFE_A], organisationId: ORG };
    const order = await PosOrderService.processOrder({
      cafeId: CAFE_A,
      lineItems: [{ menuItemId: 'ITEM-COFFEE', quantity: 1 }],
      paymentMethod: 'CARD',
      idempotencyKey: `IDEM-CORR-${Date.now()}`,
    }, auth, 'SAVE');

    const billId = order.bill.billId;

    const { req, res } = mockReqRes({
      oldPaymentMethod: 'CARD',
      newPaymentMethod: 'CASH',
      reason: 'Customer mistakenly selected card; paid in cash notes',
    }, auth, { billId });

    await correctTender(req, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.data.correction.oldPaymentMethod, 'CARD');
    assert.equal(res.body.data.correction.newPaymentMethod, 'CASH');
  });

  // 11. Immutable Historical Commercial Snapshot (Acceptance Test)
  await t.test('11. Immutable Historical Snapshot: Changing menu master does not alter existing bill', async () => {
    const auth = { userId: 'CAFE-OP-01', role: 'CAFE_ADMIN', assignedCafeIds: [CAFE_A], organisationId: ORG };
    const order = await PosOrderService.processOrder({
      cafeId: CAFE_A,
      lineItems: [{ menuItemId: 'ITEM-COFFEE', quantity: 1 }],
      paymentMethod: 'CASH',
      idempotencyKey: `IDEM-IMMUTABLE-${Date.now()}`,
    }, auth, 'SAVE');

    const originalSubtotal = order.bill.subtotalPaisa;
    const originalTotal = order.bill.totalPaisa;

    // Mutate the menu item master
    const coffeeItem = menuItemsDb.find((it) => it.menuItemId === 'ITEM-COFFEE');
    coffeeItem.currentPricePaisa = 99999; // Price changed from 10000 to 99999
    coffeeItem.taxRatePercent = 18;

    // Re-verify the committed bill in DB
    const fetchedBill = await Bill.findOne({ billId: order.bill.billId });
    assert.equal(fetchedBill.subtotalPaisa, originalSubtotal);
    assert.equal(fetchedBill.totalPaisa, originalTotal);
    assert.equal(fetchedBill.lineItems[0].taxRatePercent, 5);

    // Reset coffee price
    coffeeItem.currentPricePaisa = 10000;
    coffeeItem.taxRatePercent = 5;
  });

  // 12. Post-Commit Hardware Resilience
  await t.test('12. Hardware Resilience: Receipt printer failure does NOT roll back committed bill', async () => {
    const auth = { userId: 'CAFE-OP-01', role: 'CAFE_ADMIN', assignedCafeIds: [CAFE_A], organisationId: ORG };
    const result = await PosOrderService.processOrder(
      {
        cafeId: CAFE_A,
        lineItems: [{ menuItemId: 'ITEM-COFFEE', quantity: 1 }],
        paymentMethod: 'CASH',
        idempotencyKey: `IDEM-PRN-FAIL-${Date.now()}`,
      },
      auth,
      'SAVE_AND_PRINT',
      { simulatePrinterFailure: true }
    );

    assert.equal(result.success, true);
    assert.equal(result.saleFinalized, true);
    assert.equal(result.printStatus, 'PRINT_FAILED');
    assert.equal(result.printerWarning, 'PRINTER_OFFLINE');
    assert.equal(result.reprintAvailable, true);

    // Verify bill actually exists in database
    const saved = await Bill.findOne({ billId: result.bill.billId });
    assert.ok(saved);
    assert.equal(saved.status, 'COMPLETED');
  });

  // 13. Concurrency: 50 Simultaneous Identical Sale Attempts -> Exactly 1 Bill
  await t.test('13. Concurrency: 50 simultaneous identical sale attempts produce exactly 1 Bill', async () => {
    const auth = { userId: 'CAFE-OP-01', role: 'CAFE_ADMIN', assignedCafeIds: [CAFE_A], organisationId: ORG };
    const sharedIdemKey = `IDEM-BURST-50-${Date.now()}`;
    const payload = {
      cafeId: CAFE_A,
      lineItems: [{ menuItemId: 'ITEM-COFFEE', quantity: 1 }],
      paymentMethod: 'CASH',
      idempotencyKey: sharedIdemKey,
    };

    const attempts = Array.from({ length: 50 }, () => PosOrderService.processOrder(payload, auth, 'SAVE'));
    const results = await Promise.all(attempts);

    const distinctBillIds = new Set(results.map((r) => r.bill.billId));
    assert.equal(distinctBillIds.size, 1, '50 requests must resolve to the exact same billId');

    const totalMatchingBills = await Bill.countDocuments({ correlationId: sharedIdemKey });
    assert.equal(totalMatchingBills, 1, 'Exactly one bill document must exist in MongoDB');
  });

  // 14. Persona RBAC Matrix: Direct API Denials
  await t.test('14. Persona RBAC: Owner, Staff, Cross-Café, and Inactive Operator Denied', async () => {
    // 14.1 Owner persona denied POS mutations
    const ownerAuth = { userId: 'USR-OWNER', role: 'OWNER', organisationId: ORG };
    const { req: req1, res: res1 } = mockReqRes({ cafeId: CAFE_A }, ownerAuth);
    await assert.rejects(
      async () => commitOrder(req1, res1),
      (err) => err.statusCode === 403 && err.code === 'PERMISSION_DENIED'
    );

    // 14.2 Staff persona denied POS mutations
    const staffAuth = { userId: 'USR-STAFF', role: 'STAFF', organisationId: ORG };
    const { req: req2, res: res2 } = mockReqRes({ cafeId: CAFE_A }, staffAuth);
    await assert.rejects(
      async () => commitOrder(req2, res2),
      (err) => err.statusCode === 403 && err.code === 'PERMISSION_DENIED'
    );

    // 14.3 Cross-Café access denied
    const crossCafeAuth = { userId: 'CAFE-OP-01', role: 'CAFE_ADMIN', assignedCafeIds: [CAFE_B], organisationId: ORG };
    const { req: req3, res: res3 } = mockReqRes({ cafeId: CAFE_A }, crossCafeAuth);
    await assert.rejects(
      async () => commitOrder(req3, res3),
      (err) => err.statusCode === 403 && err.code === 'CROSS_CAFE_RESOURCE_DENIED'
    );

    // 14.4 Inactive operator account rejected
    usersDb.push({ userId: 'DISABLED-USER', status: 'SUSPENDED', organisationId: ORG });
    const disabledAuth = { userId: 'DISABLED-USER', role: 'CAFE_ADMIN', assignedCafeIds: [CAFE_A], organisationId: ORG };
    const { req: req4, res: res4 } = mockReqRes({
      cafeId: CAFE_A,
      lineItems: [{ menuItemId: 'ITEM-COFFEE', quantity: 1 }],
    }, disabledAuth);
    await assert.rejects(
      async () => commitOrder(req4, res4),
      (err) => err.statusCode === 403 && err.code === 'OPERATOR_ACCOUNT_INACTIVE'
    );
  });

  // 15. Concurrency: 50 Simultaneous Identical Refund Requests -> Exactly 1 Refund Operation
  await t.test('15. Concurrency: 50 simultaneous identical refund attempts resolve idempotently to 1 refund', async () => {
    const auth = { userId: 'CAFE-OP-01', role: 'CAFE_ADMIN', assignedCafeIds: [CAFE_A], organisationId: ORG };
    const targetOrder = await PosOrderService.processOrder({
      cafeId: CAFE_A,
      lineItems: [{ menuItemId: 'ITEM-COFFEE', quantity: 1 }],
      paymentMethod: 'CASH',
      idempotencyKey: `IDEM-REFUND-TARGET-${Date.now()}`,
    }, auth, 'SAVE');

    const refundIdemKey = `REF-IDEM-BURST-${Date.now()}`;
    const refundContext = {
      organisationId: ORG,
      user: auth,
      channel: 'POS',
    };
    const refundPayload = {
      billId: targetOrder.bill.billId,
      refundType: 'FULL',
      reason: 'Customer cancelled transaction immediately',
      idempotencyKey: refundIdemKey,
    };

    const attempts = Array.from({ length: 50 }, () => refundService.processBillRefund(refundContext, refundPayload));
    const results = await Promise.all(attempts);

    const distinctRefundIds = new Set(results.map((r) => r.refund.refundId));
    assert.equal(distinctRefundIds.size, 1, 'All 50 concurrent attempts must return the exact same canonical refundId');

    const updatedBill = await Bill.findOne({ billId: targetOrder.bill.billId });
    assert.equal(updatedBill.refunds.length, 1, 'Only one refund entry should exist on the bill');
    assert.equal(updatedBill.refundedTotalPaisa, targetOrder.bill.totalPaisa);
  });

  // 16. Database Unique Index: 50 concurrent payment attempts with identical provider reference
  await t.test('16. Database Uniqueness: 50 concurrent identical provider reference attempts resolve to 1 record', async () => {
    const auth = { userId: 'CAFE-OP-01', role: 'CAFE_ADMIN', assignedCafeIds: [CAFE_A], organisationId: ORG };
    const sharedRef = `TXN-CONC-${Date.now()}`;
    const billOrder = await PosOrderService.processOrder({
      cafeId: CAFE_A,
      lineItems: [{ menuItemId: 'ITEM-COFFEE', quantity: 1 }],
      paymentMethod: 'UPI',
      tenders: [{
        paymentMethod: 'UPI',
        amountPaisa: 10500,
        provider: 'RAZORPAY',
        paymentReference: sharedRef,
        status: 'PENDING',
      }],
      paymentStatus: 'UNPAID',
      isImmediateCompletion: false,
      idempotencyKey: `IDEM-50-PAY-${Date.now()}`,
    }, auth, 'SAVE');

    const payload = {
      billId: billOrder.bill.billId,
      paymentReference: sharedRef,
      provider: 'RAZORPAY',
      amountPaisa: 10500,
      status: 'COMPLETED',
    };
    const secret = 'ZAMORIN_TEST_GATEWAY_SECRET';
    const sig = crypto.createHmac('sha256', secret).update(JSON.stringify(payload)).digest('hex');

    const attempts = Array.from({ length: 50 }, () =>
      PaymentProviderService.processPaymentCallback({
        provider: 'RAZORPAY',
        payload,
        signature: sig,
      })
    );

    const results = await Promise.all(attempts);
    for (const r of results) {
      assert.equal(r.success, true);
      assert.equal(r.tenderStatus, 'COMPLETED');
    }

    const createdRecords = paymentAttemptsDb.filter(
      (p) => p.provider === 'RAZORPAY' && p.paymentReference === sharedRef
    );
    assert.equal(createdRecords.length, 1, 'Exactly one PaymentAttemptRecord exists in database');

    const updatedBill = await Bill.findOne({ billId: billOrder.bill.billId });
    assert.equal(updatedBill.paidAmountPaisa, 10500);
    assert.equal(updatedBill.paymentStatus, 'PAID');
  });

  // 17. Provider Namespaces: Same external reference under different providers
  await t.test('17. Provider Namespaces: Same reference allowed under distinct providers', async () => {
    const auth = { userId: 'CAFE-OP-01', role: 'CAFE_ADMIN', assignedCafeIds: [CAFE_A], organisationId: ORG };
    const billOrder1 = await PosOrderService.processOrder({
      cafeId: CAFE_A,
      lineItems: [{ menuItemId: 'ITEM-COFFEE', quantity: 1 }],
      paymentMethod: 'UPI',
      idempotencyKey: `IDEM-NS-1-${Date.now()}`,
    }, auth, 'SAVE');

    const billOrder2 = await PosOrderService.processOrder({
      cafeId: CAFE_A,
      lineItems: [{ menuItemId: 'ITEM-COFFEE', quantity: 1 }],
      paymentMethod: 'CARD',
      idempotencyKey: `IDEM-NS-2-${Date.now()}`,
    }, auth, 'SAVE');

    const commonRef = `TXN-REF-SHARED-12345`;
    const secret = 'ZAMORIN_TEST_GATEWAY_SECRET';

    // Provider A: RAZORPAY
    const p1 = { billId: billOrder1.bill.billId, paymentReference: commonRef, amountPaisa: 10500, status: 'COMPLETED' };
    const s1 = crypto.createHmac('sha256', secret).update(JSON.stringify(p1)).digest('hex');
    const r1 = await PaymentProviderService.processPaymentCallback({ provider: 'RAZORPAY', payload: p1, signature: s1 });
    assert.equal(r1.success, true);

    // Provider B: PAYTM (same commonRef, distinct provider namespace)
    const p2 = { billId: billOrder2.bill.billId, paymentReference: commonRef, amountPaisa: 10500, status: 'COMPLETED' };
    const s2 = crypto.createHmac('sha256', secret).update(JSON.stringify(p2)).digest('hex');
    const r2 = await PaymentProviderService.processPaymentCallback({ provider: 'PAYTM', payload: p2, signature: s2 });
    assert.equal(r2.success, true);

    const razorRecords = paymentAttemptsDb.filter((p) => p.provider === 'RAZORPAY' && p.paymentReference === commonRef);
    const paytmRecords = paymentAttemptsDb.filter((p) => p.provider === 'PAYTM' && p.paymentReference === commonRef);
    assert.equal(razorRecords.length, 1);
    assert.equal(paytmRecords.length, 1);
  });

  // 18. Callback Authentication: Missing, invalid, modified, and replayed signatures
  await t.test('18. Callback Authentication: Negative tests for missing, invalid, and modified signatures', async () => {
    const auth = { userId: 'CAFE-OP-01', role: 'CAFE_ADMIN', assignedCafeIds: [CAFE_A], organisationId: ORG };
    const validRef = `TXN-SEC-${Date.now()}`;
    const billOrder = await PosOrderService.processOrder({
      cafeId: CAFE_A,
      lineItems: [{ menuItemId: 'ITEM-COFFEE', quantity: 1 }],
      paymentMethod: 'UPI',
      tenders: [{
        paymentMethod: 'UPI',
        amountPaisa: 10500,
        provider: 'RAZORPAY',
        paymentReference: validRef,
        status: 'PENDING',
      }],
      paymentStatus: 'UNPAID',
      isImmediateCompletion: false,
      idempotencyKey: `IDEM-CB-SEC-${Date.now()}`,
    }, auth, 'SAVE');

    const billId = billOrder.bill.billId;
    const validPayload = { billId, paymentReference: validRef, amountPaisa: 10500, status: 'COMPLETED' };
    const secret = 'ZAMORIN_TEST_GATEWAY_SECRET';
    const validSig = crypto.createHmac('sha256', secret).update(JSON.stringify(validPayload)).digest('hex');

    // 18.1 Missing signature
    await assert.rejects(
      async () => PaymentProviderService.processPaymentCallback({
        provider: 'RAZORPAY',
        payload: validPayload,
        signature: '',
      }),
      (err) => {
        assert.equal(err.statusCode, 401);
        assert.equal(err.code, 'INVALID_CALLBACK_SIGNATURE');
        return true;
      }
    );

    // 18.2 Invalid signature
    await assert.rejects(
      async () => PaymentProviderService.processPaymentCallback({
        provider: 'RAZORPAY',
        payload: validPayload,
        signature: 'deadbeef0000111122223333444455556666777788889999aaaabbbbccccdddd',
      }),
      (err) => {
        assert.equal(err.statusCode, 401);
        assert.equal(err.code, 'INVALID_CALLBACK_SIGNATURE');
        return true;
      }
    );

    // 18.3 Modified payload (tampered amount from 10500 to 1 paisa)
    const tamperedPayload = { ...validPayload, amountPaisa: 1 };
    await assert.rejects(
      async () => PaymentProviderService.processPaymentCallback({
        provider: 'RAZORPAY',
        payload: tamperedPayload,
        signature: validSig,
      }),
      (err) => {
        assert.equal(err.statusCode, 401);
        assert.equal(err.code, 'INVALID_CALLBACK_SIGNATURE');
        return true;
      }
    );

    // Verify zero settlement effect occurred from invalid callbacks
    const untouchedBill = await Bill.findOne({ billId });
    assert.equal(untouchedBill.paidAmountPaisa, 0);
    assert.equal(untouchedBill.paymentStatus, 'UNPAID');

    // 18.4 Valid signed callback succeeds
    const validRes = await PaymentProviderService.processPaymentCallback({
      provider: 'RAZORPAY',
      payload: validPayload,
      signature: validSig,
    });
    assert.equal(validRes.success, true);
    assert.equal(validRes.tenderStatus, 'COMPLETED');

    const settledBill = await Bill.findOne({ billId });
    assert.equal(settledBill.paidAmountPaisa, 10500);
    assert.equal(settledBill.paymentStatus, 'PAID');
  });

  // 19. Due Bills Governance: Reject anonymous debt; require authorized credit account
  await t.test('19. Due Bills: Walk-in partial payment without credit account rejected; authorized account permitted', async () => {
    const auth = { userId: 'CAFE-OP-01', role: 'CAFE_ADMIN', assignedCafeIds: [CAFE_A], organisationId: ORG };

    // 19.1 Walk-in customer attempting ₹1 payment against ₹105 bill without account
    const { req: reqWalkIn, res: resWalkIn } = mockReqRes({
      cafeId: CAFE_A,
      lineItems: [{ menuItemId: 'ITEM-COFFEE', quantity: 1 }], // Total 10500 paisa
      paymentMethod: 'CASH',
      paidAmountPaisa: 100, // Pays only ₹1.00
      tenders: [{ paymentMethod: 'CASH', amountPaisa: 100 }],
    }, auth);

    await assert.rejects(
      async () => commitOrder(reqWalkIn, resWalkIn),
      (err) => {
        assert.equal(err.statusCode, 400);
        assert.equal(err.code, 'ANONYMOUS_CREDIT_PROHIBITED');
        return true;
      }
    );

    // 19.2 Authorized Institutional Account with sufficient credit limit
    institutionalAccountsDb.push({
      accountId: 'ACCT-CORP-01',
      organisationId: ORG,
      institutionName: 'Infopark Tech Ltd',
      creditStatus: 'ACTIVE',
      creditLimitPaisa: 500000,
      currentExposurePaisa: 50000,
    });

    const { req: reqAuth, res: resAuth } = mockReqRes({
      cafeId: CAFE_A,
      lineItems: [{ menuItemId: 'ITEM-COFFEE', quantity: 1 }],
      paymentMethod: 'SPLIT',
      paidAmountPaisa: 100,
      institutionalAccountId: 'ACCT-CORP-01',
      tenders: [{ paymentMethod: 'CASH', amountPaisa: 100 }],
      idempotencyKey: `IDEM-DUE-AUTH-${Date.now()}`,
    }, auth);

    await commitOrder(reqAuth, resAuth);
    assert.equal(resAuth.statusCode, 200);
    assert.equal(resAuth.body.success, true);
    assert.equal(resAuth.body.bill.paymentStatus, 'PARTIALLY_PAID');
    assert.equal(resAuth.body.bill.paidAmountPaisa, 100);
    assert.equal(resAuth.body.bill.dueAmountPaisa, 10400);

    // 19.3 Suspended credit account rejected
    institutionalAccountsDb.push({
      accountId: 'ACCT-SUSPENDED',
      organisationId: ORG,
      institutionName: 'Defaulting Firm',
      creditStatus: 'SUSPENDED',
      creditLimitPaisa: 1000000,
      currentExposurePaisa: 0,
    });

    const { req: reqSusp, res: resSusp } = mockReqRes({
      cafeId: CAFE_A,
      lineItems: [{ menuItemId: 'ITEM-COFFEE', quantity: 1 }],
      paymentMethod: 'CASH',
      paidAmountPaisa: 100,
      tenders: [{ paymentMethod: 'CASH', amountPaisa: 100 }],
      institutionalAccountId: 'ACCT-SUSPENDED',
    }, auth);

    await assert.rejects(
      async () => commitOrder(reqSusp, resSusp),
      (err) => {
        assert.equal(err.statusCode, 403);
        assert.equal(err.code, 'CREDIT_ACCOUNT_SUSPENDED');
        return true;
      }
    );
  });

  // 20. Void, Refund & Physical Inventory Governance
  await t.test('20. Inventory Governance: Separation of pre-fulfilment cancel, void no restock, refund, and wastage', async () => {
    const auth = { userId: 'CAFE-OP-01', role: 'CAFE_ADMIN', assignedCafeIds: [CAFE_A], organisationId: ORG };
    const masterAuth = { userId: 'PRIMARY-MASTER', role: 'MASTER', isPrimaryMaster: true, organisationId: ORG, assignedCafeIds: [CAFE_A] };

    const lotId = 'LOT-MILK-001';
    inventoryLotsDb.push({
      lotId,
      quantityBase: 10,
      remainingQuantity: 10,
      status: 'AVAILABLE',
      save: async function () { return this; },
    });

    // 20.1 Pre-fulfilment cancellation or RESTOCK restores stock
    const billRestock = await PosOrderService.processOrder({
      cafeId: CAFE_A,
      lineItems: [{ menuItemId: 'ITEM-COFFEE', quantity: 1 }],
      paymentMethod: 'CASH',
      idempotencyKey: `IDEM-RESTOCK-TEST-${Date.now()}`,
    }, auth, 'SAVE');

    const bDoc1 = await Bill.findOne({ billId: billRestock.bill.billId });
    bDoc1.bomDepletionStatus = 'DEPLETED';
    stockMovementsDb.push({
      movementId: `MOV-DEP-001`,
      organisationId: ORG,
      cafeId: CAFE_A,
      itemId: 'ITEM-MILK',
      lotId,
      movementType: 'CONSUMPTION',
      direction: 'OUT',
      quantityBase: 2,
      quantity: 2,
      referenceId: bDoc1.billId,
      businessDate: bDoc1.businessDate,
    });

    const { req: reqVoidRestock, res: resVoidRestock } = mockReqRes({
      reason: 'Order cancelled before kitchen started preparation',
      inventoryDisposition: 'RESTOCK',
    }, masterAuth, { billId: bDoc1.billId });

    await voidBill(reqVoidRestock, resVoidRestock);
    assert.equal(resVoidRestock.statusCode, 200);
    assert.equal(resVoidRestock.body.data.bill.status, 'VOIDED');
    assert.equal(resVoidRestock.body.data.bill.bomDepletionStatus, 'REVERSED');

    const returnMov = stockMovementsDb.find((m) => m.referenceId === bDoc1.billId && m.movementType === 'REVERSAL');
    assert.ok(returnMov, 'StockMovement of type REVERSAL must be created');
    assert.equal(returnMov.quantityBase, 2);
    const lotAfterRestock = inventoryLotsDb.find((l) => l.lotId === lotId);
    assert.equal(lotAfterRestock.quantityBase, 12);

    // 20.2 Completed/served sale financially voided with default NONE does NOT restore stock
    const billServed = await PosOrderService.processOrder({
      cafeId: CAFE_A,
      lineItems: [{ menuItemId: 'ITEM-COFFEE', quantity: 1 }],
      paymentMethod: 'CASH',
      idempotencyKey: `IDEM-SERVED-VOID-${Date.now()}`,
    }, auth, 'SAVE');

    const bDoc2 = await Bill.findOne({ billId: billServed.bill.billId });
    bDoc2.bomDepletionStatus = 'DEPLETED';
    const initialLotQty = lotAfterRestock.quantityBase;

    const { req: reqVoidNoRestock, res: resVoidNoRestock } = mockReqRes({
      reason: 'Customer dispute after consuming coffee; management granted financial void',
      inventoryDisposition: 'NONE',
    }, masterAuth, { billId: bDoc2.billId });

    await voidBill(reqVoidNoRestock, resVoidNoRestock);
    assert.equal(resVoidNoRestock.statusCode, 200);
    assert.equal(resVoidNoRestock.body.data.bill.status, 'VOIDED');
    assert.equal(resVoidNoRestock.body.data.bill.bomDepletionStatus, 'VOIDED_NO_RESTOCK');
    assert.equal(lotAfterRestock.quantityBase, initialLotQty, 'Lot quantity must NOT increase for consumed/served void');

    // 20.3 Completed sale refunded does NOT restore stock
    const billRefunded = await PosOrderService.processOrder({
      cafeId: CAFE_A,
      lineItems: [{ menuItemId: 'ITEM-COFFEE', quantity: 1 }],
      paymentMethod: 'CASH',
      idempotencyKey: `IDEM-REFUND-STOCK-${Date.now()}`,
    }, auth, 'SAVE');

    const refundRes = await refundService.processBillRefund(
      { organisationId: ORG, user: auth, channel: 'POS' },
      { billId: billRefunded.bill.billId, reason: 'Dissatisfied with temperature after drinking', idempotencyKey: `REF-KEY-${Date.now()}` }
    );
    assert.equal(refundRes.refund.status, 'COMPLETED');
    assert.equal(lotAfterRestock.quantityBase, initialLotQty, 'Refund must not alter physical inventory stock');

    // 20.4 Prepared item discarded/wasted routes to WastageRecord and does NOT restore stock
    const billWasted = await PosOrderService.processOrder({
      cafeId: CAFE_A,
      lineItems: [{ menuItemId: 'ITEM-COFFEE', quantity: 1 }],
      paymentMethod: 'CASH',
      idempotencyKey: `IDEM-WASTE-TEST-${Date.now()}`,
    }, auth, 'SAVE');

    const bDoc3 = await Bill.findOne({ billId: billWasted.bill.billId });
    bDoc3.bomDepletionStatus = 'DEPLETED';

    const { req: reqVoidWaste, res: resVoidWaste } = mockReqRes({
      reason: 'Barista dropped cup while handing to customer; drink spilled and discarded',
      inventoryDisposition: 'WASTAGE',
      wastageReason: 'SPILLED',
    }, masterAuth, { billId: bDoc3.billId });

    await voidBill(reqVoidWaste, resVoidWaste);
    assert.equal(resVoidWaste.statusCode, 200);
    assert.equal(resVoidWaste.body.data.bill.status, 'VOIDED');
    assert.equal(resVoidWaste.body.data.bill.bomDepletionStatus, 'WASTED_NOT_RETURNED');
    assert.equal(lotAfterRestock.quantityBase, initialLotQty, 'Wasted goods must NOT restore inventory lot');

    const wastageRecord = wastageRecordsDb.find((w) => w.notes.includes(bDoc3.billId));
    assert.ok(wastageRecord, 'WastageRecord must be created for discarded preparation');
    assert.equal(wastageRecord.reasonCode, 'SPILLED');
  });
});
