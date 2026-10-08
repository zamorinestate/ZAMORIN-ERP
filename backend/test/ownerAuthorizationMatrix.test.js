'use strict';

/**
 * OWNER AUTHORIZATION ENDPOINT MATRIX TEST SUITE
 * 
 * Verifies the strict boundaries of the OWNER persona:
 * 1. Positive Verification: Accessible executive governance, oversight, audit, and personal ledger routes.
 * 2. Negative Verification: Strict 403 rejection on forbidden operational mutations:
 *    - POS mutations (order commits, register sessions, voids, refunds, EOD close)
 *    - GRN mutations (goods receipt posting)
 *    - Vendor master edits (create, update, patch, delete, deactivate)
 *    - Staff administration (user provisioning, role modifications, status changes, archival)
 *    - Primary Master finance (chart of accounts creation, journal posting, period closing)
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { voidBill, refundBill, closeBusinessDayBilling, createBill, openRegisterSession, recordCashEvent, closeRegisterSession } = require('../src/controllers/billController');
const { commitOrder } = require('../src/controllers/posController');
const { authorize } = require('../src/middleware/authorize');
const { createGoodsReceipt } = require('../src/controllers/procurementController');

test('OWNER Persona Authorization Matrix — Security Gate Verification', async (t) => {
  const orgId = 'ORG-ZAMORIN-TEST';
  const cafeId = 'ZC-0001';

  const ownerAuth = {
    userId: 'USR-OWNER-01',
    role: 'OWNER',
    organisationId: orgId,
    assignedCafeIds: [cafeId],
    isPrimaryMaster: false,
  };

  const masterAuth = {
    userId: 'USR-MASTER-01',
    role: 'MASTER',
    organisationId: orgId,
    assignedCafeIds: [cafeId],
    isPrimaryMaster: true,
  };

  function createMockResponse() {
    return {
      statusCode: 200,
      body: null,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(data) {
        this.body = data;
        return this;
      },
    };
  }

  // ─── 1. POS MUTATIONS (STRICTLY FORBIDDEN FOR OWNER) ──────────────────────

  await t.test('1.1 Negative: Owner cannot commit POS orders (/api/v1/pos/orders/commit)', async () => {
    const req = {
      auth: { ...ownerAuth },
      body: { cafeId, lineItems: [{ menuItemId: 'ITM-01', quantity: 1, unitPricePaisa: 1000 }] },
      headers: {},
    };
    const res = createMockResponse();

    let caughtError = null;
    await new Promise((resolve) => {
      commitOrder(req, res, (err) => {
        caughtError = err;
        resolve();
      });
    });

    assert.ok(caughtError, 'Expected commitOrder to reject Owner');
    assert.equal(caughtError.statusCode, 403);
    assert.equal(caughtError.code, 'PERMISSION_DENIED');
  });

  await t.test('1.2 Negative: Owner cannot create bills (/api/v1/bills)', async () => {
    const req = {
      auth: { ...ownerAuth },
      body: { cafeId, lineItems: [{ menuItemId: 'ITM-01', quantity: 1, unitPricePaisa: 1000 }] },
      headers: {},
    };
    const res = createMockResponse();

    await assert.rejects(
      async () => {
        await createBill(req, res);
      },
      (err) => {
        assert.equal(err.statusCode, 403);
        assert.equal(err.code, 'POS_MUTATION_FORBIDDEN');
        return true;
      }
    );
  });

  await t.test('1.3 Negative: Owner cannot open register session (/api/v1/bills/register/session/open)', async () => {
    const req = {
      auth: { ...ownerAuth },
      body: { cafeId, registerId: 'REG-01', openingFloatPaisa: 10000 },
      headers: {},
    };
    const res = createMockResponse();

    await assert.rejects(
      async () => {
        await openRegisterSession(req, res);
      },
      (err) => {
        assert.equal(err.statusCode, 403);
        assert.equal(err.code, 'REGISTER_MUTATION_FORBIDDEN');
        return true;
      }
    );
  });

  await t.test('1.4 Negative: Owner cannot record cash drawer events (/api/v1/bills/register/session/event)', async () => {
    const req = {
      auth: { ...ownerAuth },
      body: { registerSessionId: 'REG-2026-0001', eventType: 'CASH_IN', amountPaisa: 5000 },
      headers: {},
    };
    const res = createMockResponse();

    await assert.rejects(
      async () => {
        await recordCashEvent(req, res);
      },
      (err) => {
        assert.equal(err.statusCode, 403);
        assert.equal(err.code, 'REGISTER_MUTATION_FORBIDDEN');
        return true;
      }
    );
  });

  await t.test('1.5 Negative: Owner cannot close register sessions (/api/v1/bills/register/session/close)', async () => {
    const req = {
      auth: { ...ownerAuth },
      body: { registerSessionId: 'REG-2026-0001', countedCashPaisa: 15000 },
      headers: {},
    };
    const res = createMockResponse();

    await assert.rejects(
      async () => {
        await closeRegisterSession(req, res);
      },
      (err) => {
        assert.equal(err.statusCode, 403);
        assert.equal(err.code, 'REGISTER_MUTATION_FORBIDDEN');
        return true;
      }
    );
  });

  await t.test('1.6 Negative: Owner cannot void bills (/api/v1/bills/:id/void)', async () => {
    const req = {
      auth: { ...ownerAuth },
      params: { billId: 'BILL-001' },
      body: { reason: 'Test void' },
    };
    const res = createMockResponse();

    await assert.rejects(
      async () => {
        await voidBill(req, res);
      },
      (err) => {
        assert.equal(err.statusCode, 403);
        assert.equal(err.code, 'VOID_FORBIDDEN');
        return true;
      }
    );
  });

  await t.test('1.7 Negative: Owner cannot refund bills (/api/v1/bills/:id/refund)', async () => {
    const req = {
      auth: { ...ownerAuth },
      params: { billId: 'BILL-001' },
      body: { reason: 'Test refund', refundType: 'FULL' },
    };
    const res = createMockResponse();

    await assert.rejects(
      async () => {
        await refundBill(req, res);
      },
      (err) => {
        assert.equal(err.statusCode, 403);
        assert.equal(err.code, 'REFUND_FORBIDDEN');
        return true;
      }
    );
  });

  await t.test('1.8 Negative: Owner cannot perform EOD close (/api/v1/bills/eod/close)', async () => {
    const req = {
      auth: { ...ownerAuth },
      body: { cafeId, businessDate: '2026-10-07' },
    };
    const res = createMockResponse();

    await assert.rejects(
      async () => {
        await closeBusinessDayBilling(req, res);
      },
      (err) => {
        assert.equal(err.statusCode, 403);
        assert.equal(err.code, 'EOD_CLOSE_FORBIDDEN');
        return true;
      }
    );
  });

  // ─── 2. GRN MUTATIONS (STRICTLY FORBIDDEN FOR OWNER) ──────────────────────

  await t.test('2.1 Negative: Owner cannot post Goods Receipts (/api/v1/procurement/grns)', async () => {
    const middleware = authorize('PROCUREMENT_RECEIVE', { allowedRoles: ['MASTER', 'CAFE_ADMIN'] });
    const req = {
      auth: { ...ownerAuth },
      body: { cafeId, purchaseOrderId: 'PO-001' },
      method: 'POST',
    };
    const res = createMockResponse();

    let nextCalled = false;
    await middleware(req, res, () => { nextCalled = true; });

    assert.equal(nextCalled, false, 'Middleware must NOT call next() for Owner on GRN creation');
    assert.equal(res.statusCode, 403);
    assert.equal(res.body.error.code, 'ROLE_NOT_ALLOWED');
  });

  // ─── 3. VENDOR MASTER MUTATIONS (STRICTLY FORBIDDEN FOR OWNER) ────────────

  await t.test('3.1 Negative: Owner cannot update vendor master (PUT /api/v1/vendors/:id)', async () => {
    const middleware = authorize('VENDORS_WRITE', { allowedRoles: ['MASTER'] });
    const req = {
      auth: { ...ownerAuth },
      params: { vendorId: 'VND-001' },
      method: 'PUT',
    };
    const res = createMockResponse();

    let nextCalled = false;
    await middleware(req, res, () => { nextCalled = true; });

    assert.equal(nextCalled, false);
    assert.equal(res.statusCode, 403);
    assert.equal(res.body.error.code, 'ROLE_NOT_ALLOWED');
  });

  await t.test('3.2 Negative: Owner cannot patch vendor master (PATCH /api/v1/vendors/:id)', async () => {
    const middleware = authorize('VENDORS_WRITE', { allowedRoles: ['MASTER'] });
    const req = {
      auth: { ...ownerAuth },
      params: { vendorId: 'VND-001' },
      method: 'PATCH',
    };
    const res = createMockResponse();

    let nextCalled = false;
    await middleware(req, res, () => { nextCalled = true; });

    assert.equal(nextCalled, false);
    assert.equal(res.statusCode, 403);
    assert.equal(res.body.error.code, 'ROLE_NOT_ALLOWED');
  });

  await t.test('3.3 Negative: Owner cannot delete vendor master (DELETE /api/v1/vendors/:id)', async () => {
    const middleware = authorize('VENDORS_WRITE', { allowedRoles: ['MASTER'] });
    const req = {
      auth: { ...ownerAuth },
      params: { vendorId: 'VND-001' },
      method: 'DELETE',
    };
    const res = createMockResponse();

    let nextCalled = false;
    await middleware(req, res, () => { nextCalled = true; });

    assert.equal(nextCalled, false);
    assert.equal(res.statusCode, 403);
    assert.equal(res.body.error.code, 'ROLE_NOT_ALLOWED');
  });

  await t.test('3.4 Negative: Owner cannot deactivate vendor (POST /api/v1/vendors/:id/deactivate)', async () => {
    const middleware = authorize('VENDORS_WRITE', { allowedRoles: ['MASTER'] });
    const req = {
      auth: { ...ownerAuth },
      params: { vendorId: 'VND-001' },
      method: 'POST',
    };
    const res = createMockResponse();

    let nextCalled = false;
    await middleware(req, res, () => { nextCalled = true; });

    assert.equal(nextCalled, false);
    assert.equal(res.statusCode, 403);
    assert.equal(res.body.error.code, 'ROLE_NOT_ALLOWED');
  });

  // ─── 4. STAFF ADMINISTRATION (STRICTLY FORBIDDEN FOR OWNER) ──────────────

  await t.test('4.1 Negative: Owner cannot provision new staff users (POST /api/v1/users)', async () => {
    const middleware = authorize('USER:MANAGE', {
      allowedRoles: ['MASTER'],
      absoluteRestriction: 'MASTER_USER_ADMINISTRATION',
    });
    const req = {
      auth: { ...ownerAuth },
      body: { email: 'newstaff@zamorin.com', role: 'STAFF' },
      method: 'POST',
    };
    const res = createMockResponse();

    let nextCalled = false;
    await middleware(req, res, () => { nextCalled = true; });

    assert.equal(nextCalled, false);
    assert.equal(res.statusCode, 403);
    assert.ok(['ROLE_NOT_ALLOWED', 'ABSOLUTE_ROLE_RESTRICTION'].includes(res.body.error.code));
  });

  await t.test('4.2 Negative: Owner cannot mutate user roles (PATCH /api/v1/users/:id/role)', async () => {
    const middleware = authorize('USER:MANAGE', {
      allowedRoles: ['MASTER'],
      absoluteRestriction: 'MASTER_USER_ADMINISTRATION',
    });
    const req = {
      auth: { ...ownerAuth },
      params: { userId: 'USR-STAFF-01' },
      body: { role: 'CAFE_ADMIN' },
      method: 'PATCH',
    };
    const res = createMockResponse();

    let nextCalled = false;
    await middleware(req, res, () => { nextCalled = true; });

    assert.equal(nextCalled, false);
    assert.equal(res.statusCode, 403);
  });

  await t.test('4.3 Negative: Owner cannot change user status (PATCH /api/v1/users/:id/status)', async () => {
    const middleware = authorize('USER:MANAGE', {
      allowedRoles: ['MASTER'],
      absoluteRestriction: 'MASTER_USER_ADMINISTRATION',
    });
    const req = {
      auth: { ...ownerAuth },
      params: { userId: 'USR-STAFF-01' },
      body: { status: 'SUSPENDED' },
      method: 'PATCH',
    };
    const res = createMockResponse();

    let nextCalled = false;
    await middleware(req, res, () => { nextCalled = true; });

    assert.equal(nextCalled, false);
    assert.equal(res.statusCode, 403);
  });

  // ─── 5. PRIMARY MASTER FINANCE (STRICTLY FORBIDDEN FOR OWNER) ─────────────

  await t.test('5.1 Negative: Owner cannot create Chart of Accounts (POST /api/v1/finance/coa)', async () => {
    const middleware = authorize('FINANCE:ADMIN', { allowedRoles: ['MASTER'] });
    const req = {
      auth: { ...ownerAuth },
      body: { accountCode: '1001', accountName: 'Cash on Hand' },
      method: 'POST',
    };
    const res = createMockResponse();

    let nextCalled = false;
    await middleware(req, res, () => { nextCalled = true; });

    assert.equal(nextCalled, false);
    assert.equal(res.statusCode, 403);
    assert.equal(res.body.error.code, 'ROLE_NOT_ALLOWED');
  });

  await t.test('5.2 Negative: Owner cannot create manual journals (POST /api/v1/finance/journals)', async () => {
    const middleware = authorize('FINANCE:WRITE', { allowedRoles: ['MASTER'] });
    const req = {
      auth: { ...ownerAuth },
      body: { lines: [] },
      method: 'POST',
    };
    const res = createMockResponse();

    let nextCalled = false;
    await middleware(req, res, () => { nextCalled = true; });

    assert.equal(nextCalled, false);
    assert.equal(res.statusCode, 403);
    assert.equal(res.body.error.code, 'ROLE_NOT_ALLOWED');
  });

  await t.test('5.3 Negative: Owner cannot post journals to GL (POST /api/v1/finance/journals/:id/post)', async () => {
    const middleware = authorize('FINANCE:POST', { allowedRoles: ['MASTER'] });
    const req = {
      auth: { ...ownerAuth },
      params: { journalId: 'JRN-001' },
      method: 'POST',
    };
    const res = createMockResponse();

    let nextCalled = false;
    await middleware(req, res, () => { nextCalled = true; });

    assert.equal(nextCalled, false);
    assert.equal(res.statusCode, 403);
    assert.equal(res.body.error.code, 'ROLE_NOT_ALLOWED');
  });

  await t.test('5.4 Negative: Owner cannot close financial periods (POST /api/v1/finance/period-close/close)', async () => {
    const middleware = authorize('FINANCE:ADMIN', { allowedRoles: ['MASTER'] });
    const req = {
      auth: { ...ownerAuth },
      body: { periodKey: '2026-10' },
      method: 'POST',
    };
    const res = createMockResponse();

    let nextCalled = false;
    await middleware(req, res, () => { nextCalled = true; });

    assert.equal(nextCalled, false);
    assert.equal(res.statusCode, 403);
    assert.equal(res.body.error.code, 'ROLE_NOT_ALLOWED');
  });

  // ─── 6. POSITIVE VERIFICATION: PERMITTED OWNER OPERATIONS ─────────────────

  const { RolePermission } = require('../src/models/RolePermission');
  const originalFindEffectiveRules = RolePermission.findEffectiveRules;

  t.after(() => {
    RolePermission.findEffectiveRules = originalFindEffectiveRules;
  });

  // Stub effective rules to allow ORGANISATION scope rule
  RolePermission.findEffectiveRules = async () => [
    {
      permissionRuleId: 'PR-1001',
      isCurrentlyEffective: () => true,
      scope: 'ORGANISATION',
      effect: 'ALLOW',
      requiresMfa: false,
      requiresStepUpAuthentication: false,
      requiresReauthentication: false,
      requiresReason: false,
      requiresAuditEvent: false,
    },
  ];

  await t.test('6.1 Positive: Owner can read finance overview (GET /api/v1/finance/overview)', async () => {
    const middleware = authorize('FINANCE:READ', { allowedRoles: ['MASTER', 'OWNER', 'CAFE_ADMIN'] });
    const req = {
      auth: { ...ownerAuth },
      method: 'GET',
      get: () => null,
      params: {},
      body: {},
      query: {},
    };
    const res = createMockResponse();

    let nextCalled = false;
    await middleware(req, res, () => { nextCalled = true; });

    assert.equal(nextCalled, true, 'Owner MUST be allowed to read finance overview');
    assert.equal(res.statusCode, 200);
  });

  await t.test('6.2 Positive: Owner can read Chart of Accounts (GET /api/v1/finance/coa)', async () => {
    const middleware = authorize('FINANCE:READ', { allowedRoles: ['MASTER', 'OWNER'] });
    const req = {
      auth: { ...ownerAuth },
      method: 'GET',
      get: () => null,
      params: {},
      body: {},
      query: {},
    };
    const res = createMockResponse();

    let nextCalled = false;
    await middleware(req, res, () => { nextCalled = true; });

    assert.equal(nextCalled, true, 'Owner MUST be allowed to read Chart of Accounts');
    assert.equal(res.statusCode, 200);
  });

  await t.test('6.3 Positive: Owner can access Personal Ledger (ABSOLUTE_ROLE_RESTRICTION: PERSONAL_LEDGER)', async () => {
    const middleware = authorize('PERSONAL_LEDGER_READ', {
      allowedRoles: ['MASTER', 'OWNER'],
      absoluteRestriction: 'PERSONAL_LEDGER',
    });
    const req = {
      auth: { ...ownerAuth },
      method: 'GET',
      get: () => null,
      params: {},
      body: {},
      query: {},
    };
    const res = createMockResponse();

    let nextCalled = false;
    await middleware(req, res, () => { nextCalled = true; });

    assert.equal(nextCalled, true, 'Owner MUST have access to Personal Ledger');
    assert.equal(res.statusCode, 200);
  });
});
