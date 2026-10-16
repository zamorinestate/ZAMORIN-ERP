'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function authorizationLines(file) {
  const filePath = fs.existsSync(file) ? file : path.resolve(__dirname, '..', file.replace(/^backend\//, ''));
  return fs
    .readFileSync(filePath, 'utf8')
    .split(/\r?\n/)
    .filter((line) => line.includes("authorize('"));
}

test('Staff Scope Security — STAFF is strictly restricted to self-service', async (t) => {
  await t.test('STAFF is excluded from Inventory Stock Movement route authorization', () => {
    const inventoryLines = authorizationLines('backend/src/routes/inventoryRoutes.js');
    assert.ok(inventoryLines.length > 0, 'Expected inventory authorization routes');
    
    // Movement routes and global item creation should never include STAFF
    for (const line of inventoryLines) {
      if (line.includes('INVENTORY_STOCK_MOVEMENT') || line.includes('INVENTORY_MANAGE') || line.includes('INVENTORY_ITEM_CREATE')) {
        assert.equal(line.includes("'STAFF'"), false, `Staff must not be authorized on: ${line.trim()}`);
      }
    }
  });

  await t.test('STAFF is excluded from POS Billing route authorization', () => {
    const billLines = authorizationLines('backend/src/routes/billRoutes.js');
    assert.ok(billLines.length > 0, 'Expected Bill authorization routes');
    for (const line of billLines) {
      assert.equal(line.includes("'STAFF'"), false, `Staff must not be authorized on: ${line.trim()}`);
    }
  });

  await t.test('STAFF is excluded from Vendor management route authorization', () => {
    const vendorLines = authorizationLines('backend/src/routes/vendorRoutes.js');
    assert.ok(vendorLines.length > 0, 'Expected Vendor authorization routes');
    for (const line of vendorLines) {
      assert.equal(line.includes("'STAFF'"), false, `Staff must not be authorized on: ${line.trim()}`);
    }
  });

  await t.test('STAFF is excluded from Procurement route authorization', () => {
    const procurementLines = authorizationLines('backend/src/routes/procurementRoutes.js');
    assert.ok(procurementLines.length > 0, 'Expected Procurement authorization routes');
    for (const line of procurementLines) {
      assert.equal(line.includes("'STAFF'"), false, `Staff must not be authorized on: ${line.trim()}`);
    }
  });

  await t.test('STAFF and legacy CASHIER are excluded from Statutory GST & Till Reconciliation in financeRoutes.js', () => {
    const financeLines = authorizationLines('backend/src/routes/financeRoutes.js');
    assert.ok(financeLines.length > 0, 'Expected Finance authorization routes');
    for (const line of financeLines) {
      assert.equal(line.includes("'STAFF'"), false, `Staff must not be authorized on: ${line.trim()}`);
      assert.equal(line.includes("'CASHIER'"), false, `Legacy Cashier must not be authorized on: ${line.trim()}`);
    }
  });

  await t.test('STAFF is excluded from Owner Governance routes (complaints, loyalty, utilities)', () => {
    const complaintsLines = authorizationLines('backend/src/routes/ownerComplaintsRoutes.js');
    for (const line of complaintsLines) {
      assert.equal(line.includes("'STAFF'"), false, `Staff must not be authorized on: ${line.trim()}`);
    }
    const loyaltyLines = authorizationLines('backend/src/routes/ownerCustomerLoyaltyRoutes.js');
    for (const line of loyaltyLines) {
      assert.equal(line.includes("'STAFF'"), false, `Staff must not be authorized on: ${line.trim()}`);
    }
    const utilitiesLines = authorizationLines('backend/src/routes/ownerUtilitiesWasteRoutes.js');
    for (const line of utilitiesLines) {
      assert.equal(line.includes("'STAFF'"), false, `Staff must not be authorized on: ${line.trim()}`);
    }
  });

  // ──────────────────────────────────────────────────────────────────────────
  // FINDING-RBAC-001: Advance Deposit Slip Lookup Security & Scope Invariants
  // ──────────────────────────────────────────────────────────────────────────

  const { RolePermission } = require('../src/models/RolePermission');
  const { AdvanceDeposit } = require('../src/models/AdvanceDeposit');
  const financeRoutes = require('../src/routes/financeRoutes');
  const { getAdvanceDepositBySlip } = require('../src/controllers/financeController');
  const advanceDepositService = require('../src/services/advanceDepositService');

  const slipRouteLayer = financeRoutes.stack.find(
    (s) => s.route && s.route.path === '/advance-deposits/by-slip/:slipNumber'
  );
  assert.ok(slipRouteLayer, 'Route /advance-deposits/by-slip/:slipNumber must exist');
  const slipAuthMiddleware = slipRouteLayer.route.stack[0].handle;

  function createMockResponse() {
    return {
      statusCode: 200,
      body: null,
      headers: {},
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(data) {
        this.body = data;
        return this;
      },
      setHeader(name, value) {
        this.headers[name] = value;
      },
      send(data) {
        this.body = data;
        return this;
      },
    };
  }

  function createMockRequest(options = {}) {
    return {
      method: options.method || 'GET',
      params: options.params || { slipNumber: 'RV-2026-0001' },
      query: options.query || {},
      body: options.body || {},
      headers: options.headers || {},
      auth: options.auth !== undefined ? options.auth : null,
      correlationId: options.correlationId || 'c-sec-test',
      get(headerName) {
        return this.headers[headerName.toLowerCase()] || null;
      },
    };
  }

  const sampleDepositRecord = {
    _id: 'mongo-id-12345',
    __v: 0,
    depositId: 'DEP-2026-0001',
    receiptVoucherNumber: 'RV-2026-0001',
    bookingReference: 'BK-2026-0099',
    eventReference: 'BK-2026-0099',
    eventDate: '2026-11-20',
    organisationId: 'ORG-ZAMORIN',
    cafeId: 'ZC-0001',
    customerName: 'Kishore Kumar',
    customerPhone: '+919876543210',
    customerGstin: '32AAAAA0000A1Z5',
    depositAmountPaisa: 500000,
    unappliedAmountPaisa: 500000,
    appliedAmountPaisa: 0,
    refundedAmountPaisa: 0,
    status: 'HELD_UNAPPLIED',
    receivedAt: new Date('2026-10-15T10:00:00Z'),
  };

  // Stub RolePermission.findEffectiveRules to return [] so authorize falls back to role checks
  const originalFindEffectiveRules = RolePermission.findEffectiveRules;
  const originalFindOne = AdvanceDeposit.findOne;

  t.after(() => {
    RolePermission.findEffectiveRules = originalFindEffectiveRules;
    AdvanceDeposit.findOne = originalFindOne;
  });

  RolePermission.findEffectiveRules = async () => [];

  await t.test('1. STAFF cannot access the finance advance-slip lookup (FINDING-RBAC-001)', async () => {
    // A. Route definition verification
    const financeFile = fs.readFileSync(path.resolve(__dirname, '../src/routes/financeRoutes.js'), 'utf8');
    const slipRouteMatch = financeFile.match(/\/advance-deposits\/by-slip\/:slipNumber[\s\S]*?authorize\([^)]+\)/);
    assert.ok(slipRouteMatch, 'Advance slip route must exist in financeRoutes.js');
    assert.equal(slipRouteMatch[0].includes("'STAFF'"), false, 'STAFF role must be removed from advance-slip route');

    // B. Authorization middleware rejection
    const req = createMockRequest({
      auth: { role: 'STAFF', isPrimaryMaster: false, organisationId: 'ORG-ZAMORIN', cafeId: 'ZC-0001' },
    });
    const res = createMockResponse();
    let nextCalled = false;
    await slipAuthMiddleware(req, res, () => { nextCalled = true; });

    assert.equal(nextCalled, false, 'STAFF must not pass authorization middleware');
    assert.equal(res.statusCode, 403, 'STAFF must be denied with 403');
    assert.equal(res.body?.error?.code, 'ROLE_NOT_ALLOWED');

    // C. Controller defense-in-depth rejection
    const ctrlRes = createMockResponse();
    await getAdvanceDepositBySlip(req, ctrlRes);
    assert.equal(ctrlRes.statusCode, 403);
    assert.equal(ctrlRes.body?.error?.code, 'ROLE_NOT_ALLOWED');
  });

  await t.test('2. Unauthenticated requests remain denied', async () => {
    const req = createMockRequest({ auth: null });
    const res = createMockResponse();
    let nextCalled = false;
    await slipAuthMiddleware(req, res, () => { nextCalled = true; });

    assert.equal(nextCalled, false);
    assert.equal(res.statusCode, 401);
    assert.equal(res.body?.error?.code, 'AUTHENTICATION_REQUIRED');
  });

  await t.test('3. Normal Master (non-primary) remains denied', async () => {
    const req = createMockRequest({
      auth: { role: 'MASTER', isPrimaryMaster: false, organisationId: 'ORG-ZAMORIN' },
    });
    const res = createMockResponse();
    let nextCalled = false;
    await slipAuthMiddleware(req, res, () => { nextCalled = true; });

    assert.equal(nextCalled, false);
    assert.equal(res.statusCode, 403);
    assert.equal(res.body?.error?.code, 'ROLE_RETIRED');
  });

  await t.test('4. Vendor remains read-only and cannot access this finance route', async () => {
    const req = createMockRequest({
      auth: { role: 'VENDOR', organisationId: 'ORG-ZAMORIN', vendorId: 'VEND-001' },
    });
    const res = createMockResponse();
    let nextCalled = false;
    await slipAuthMiddleware(req, res, () => { nextCalled = true; });

    assert.equal(nextCalled, false);
    assert.equal(res.statusCode, 403);
    assert.equal(res.body?.error?.code, 'ROLE_NOT_ALLOWED');
  });

  await t.test('5. Primary Master retains legitimate access and cross-café lookup', async () => {
    let capturedQuery = null;
    AdvanceDeposit.findOne = (q) => {
      capturedQuery = q;
      return { lean: async () => ({ ...sampleDepositRecord }) };
    };

    const req = createMockRequest({
      auth: { role: 'MASTER', isPrimaryMaster: true, organisationId: 'ORG-ZAMORIN' },
      query: { cafeId: 'ZC-0002' },
    });
    const res = createMockResponse();
    let nextCalled = false;
    await slipAuthMiddleware(req, res, () => { nextCalled = true; });
    assert.equal(nextCalled, true, 'Primary Master must pass authorization middleware');

    const ctrlRes = createMockResponse();
    await getAdvanceDepositBySlip(req, ctrlRes);
    assert.equal(ctrlRes.statusCode, 200);
    assert.equal(ctrlRes.body?.success, true);
    assert.equal(capturedQuery?.cafeId, 'ZC-0002', 'Primary Master can query target café');
    assert.equal(ctrlRes.body?.data?.customerPhone, '+919876543210', 'Primary Master can view customer phone');
    assert.equal(ctrlRes.body?.data?.customerGstin, '32AAAAA0000A1Z5', 'Primary Master can view customer GSTIN');
  });

  await t.test('6. Owner retains legitimate access within the established scope', async () => {
    let capturedQuery = null;
    AdvanceDeposit.findOne = (q) => {
      capturedQuery = q;
      return { lean: async () => ({ ...sampleDepositRecord }) };
    };

    const req = createMockRequest({
      auth: {
        role: 'OWNER',
        isPrimaryMaster: false,
        organisationId: 'ORG-ZAMORIN',
        assignedCafeIds: ['ZC-0001', 'ZC-0002'],
      },
      query: { cafeId: 'ZC-0001' },
    });
    const res = createMockResponse();
    let nextCalled = false;
    await slipAuthMiddleware(req, res, () => { nextCalled = true; });
    assert.equal(nextCalled, true, 'Owner must pass authorization middleware');

    const ctrlRes = createMockResponse();
    await getAdvanceDepositBySlip(req, ctrlRes);
    assert.equal(ctrlRes.statusCode, 200);
    assert.equal(ctrlRes.body?.success, true);
    assert.equal(ctrlRes.body?.data?.customerPhone, '+919876543210', 'Owner can view customer phone');
    assert.equal(ctrlRes.body?.data?.customerGstin, '32AAAAA0000A1Z5', 'Owner can view customer GSTIN');
  });

  await t.test('7. CAFE_ADMIN can retrieve deposits belonging to its own café', async () => {
    let capturedQuery = null;
    AdvanceDeposit.findOne = (q) => {
      capturedQuery = q;
      return { lean: async () => ({ ...sampleDepositRecord, cafeId: 'ZC-0001' }) };
    };

    const req = createMockRequest({
      auth: {
        role: 'CAFE_ADMIN',
        isPrimaryMaster: false,
        organisationId: 'ORG-ZAMORIN',
        cafeId: 'ZC-0001',
        assignedCafeIds: ['ZC-0001'],
      },
    });
    const res = createMockResponse();
    let nextCalled = false;
    await slipAuthMiddleware(req, res, () => { nextCalled = true; });
    assert.equal(nextCalled, true, 'CAFE_ADMIN must pass authorization middleware');

    const ctrlRes = createMockResponse();
    await getAdvanceDepositBySlip(req, ctrlRes);
    assert.equal(ctrlRes.statusCode, 200);
    assert.equal(ctrlRes.body?.success, true);
    assert.equal(ctrlRes.body?.data?.depositId, 'DEP-2026-0001');
    assert.equal(capturedQuery?.cafeId, 'ZC-0001', 'Query must be scoped to assigned cafe');
  });

  await t.test("8. CAFE_ADMIN cannot retrieve another café's deposit by supplying a different cafeId, '*' or 'ALL'", async () => {
    const invalidCafeQueries = ['*', 'ALL', 'ZC-9999', 'ZC-0002'];

    for (const badCafe of invalidCafeQueries) {
      const req = createMockRequest({
        auth: {
          role: 'CAFE_ADMIN',
          isPrimaryMaster: false,
          organisationId: 'ORG-ZAMORIN',
          cafeId: 'ZC-0001',
          assignedCafeIds: ['ZC-0001'],
        },
        query: { cafeId: badCafe },
      });
      const ctrlRes = createMockResponse();
      await getAdvanceDepositBySlip(req, ctrlRes);

      assert.equal(
        ctrlRes.statusCode,
        403,
        `CAFE_ADMIN with cafeId=${badCafe} must be rejected with 403`
      );
      assert.equal(
        ctrlRes.body?.error?.code,
        'CROSS_CAFE_ACCESS_DENIED',
        `CAFE_ADMIN with cafeId=${badCafe} must yield CROSS_CAFE_ACCESS_DENIED`
      );
    }
  });

  await t.test('9. Organisation/tenant isolation remains enforced', async () => {
    let capturedQuery = null;
    AdvanceDeposit.findOne = (q) => {
      capturedQuery = q;
      // If query does not match tenant, return null (deposit not found)
      if (q.organisationId !== 'ORG-TENANT-A') {
        return { lean: async () => null };
      }
      return { lean: async () => ({ ...sampleDepositRecord, organisationId: 'ORG-TENANT-A' }) };
    };

    const reqTenantB = createMockRequest({
      auth: {
        role: 'CAFE_ADMIN',
        isPrimaryMaster: false,
        organisationId: 'ORG-TENANT-B',
        cafeId: 'ZC-0001',
        assignedCafeIds: ['ZC-0001'],
      },
    });

    const ctrlRes = createMockResponse();
    await getAdvanceDepositBySlip(reqTenantB, ctrlRes);

    assert.equal(capturedQuery?.organisationId, 'ORG-TENANT-B', 'Query must enforce caller organisationId');
    assert.equal(ctrlRes.statusCode, 404, 'Caller from Tenant B must never see Tenant A deposit');
  });

  await t.test('10. Sensitive fields are not returned unnecessarily for CAFE_ADMIN', async () => {
    AdvanceDeposit.findOne = () => ({
      lean: async () => ({ ...sampleDepositRecord }),
    });

    const req = createMockRequest({
      auth: {
        role: 'CAFE_ADMIN',
        isPrimaryMaster: false,
        organisationId: 'ORG-ZAMORIN',
        cafeId: 'ZC-0001',
        assignedCafeIds: ['ZC-0001'],
      },
    });
    const ctrlRes = createMockResponse();
    await getAdvanceDepositBySlip(req, ctrlRes);

    assert.equal(ctrlRes.statusCode, 200);
    const data = ctrlRes.body?.data;
    assert.ok(data, 'Response data must exist');

    // Sensitive customer PII must NOT be returned for CAFE_ADMIN
    assert.equal(data.customerPhone, undefined, 'customerPhone must be withheld from CAFE_ADMIN');
    assert.equal(data.customerGstin, undefined, 'customerGstin must be withheld from CAFE_ADMIN');
    assert.equal(data._id, undefined, '_id must not be exposed');
    assert.equal(data.__v, undefined, '__v must not be exposed');

    // Operational slip workflow fields must be present
    assert.equal(data.depositId, 'DEP-2026-0001');
    assert.equal(data.receiptVoucherNumber, 'RV-2026-0001');
    assert.equal(data.bookingReference, 'BK-2026-0099');
    assert.equal(data.eventReference, 'BK-2026-0099');
    assert.equal(data.eventDate, '2026-11-20');
    assert.equal(data.cafeId, 'ZC-0001');
    assert.equal(data.customerName, 'Kishore Kumar');
    assert.equal(data.depositAmountPaisa, 500000);
    assert.equal(data.unappliedAmountPaisa, 500000);
    assert.equal(data.appliedAmountPaisa, 0);
    assert.equal(data.refundedAmountPaisa, 0);
    assert.equal(data.status, 'HELD_UNAPPLIED');
  });

  await t.test('11. Legitimate advance-deposit creation and application workflows remain unchanged', () => {
    // Verify creation route
    const createLayer = financeRoutes.stack.find(
      (s) => s.route && s.route.path === '/advance-deposits' && s.route.methods.post
    );
    assert.ok(createLayer, 'Route POST /advance-deposits must exist');

    // Verify application route
    const applyLayer = financeRoutes.stack.find(
      (s) => s.route && s.route.path === '/advance-deposits/:depositId/apply' && s.route.methods.post
    );
    assert.ok(applyLayer, 'Route POST /advance-deposits/:depositId/apply must exist');

    // Verify refund route
    const refundLayer = financeRoutes.stack.find(
      (s) => s.route && s.route.path === '/advance-deposits/:depositId/refund' && s.route.methods.post
    );
    assert.ok(refundLayer, 'Route POST /advance-deposits/:depositId/refund must exist');

    // Verify service interface remains intact
    assert.equal(typeof advanceDepositService.recordAdvanceDeposit, 'function');
    assert.equal(typeof advanceDepositService.applyAdvanceToBillAtomic, 'function');
    assert.equal(typeof advanceDepositService.refundAdvanceAtomic, 'function');
  });
});

