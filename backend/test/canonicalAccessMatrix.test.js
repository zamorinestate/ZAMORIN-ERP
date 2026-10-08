'use strict';

/**
 * CANONICAL FOUR-PERSONA & VENDOR PARTNER ACCESS MATRIX TEST SUITE
 * 
 * Verifies the canonical enterprise topology and access boundaries:
 * 1. PRIMARY MASTER (role: 'MASTER', isPrimaryMaster: true) — Full enterprise governance
 * 2. OWNER (role: 'OWNER') — Strategic governance, analytics, read-only operational drilldowns,
 *    strictly denied POS, GRN, and Finance operational mutations (GST invoice generation, Z-report settlement).
 * 3. CAFE OPERATIONS (role: 'CAFE_ADMIN') — Operational execution scoped strictly to assigned café;
 *    denied cross-café mutations, Master administration, and Owner performance analytics.
 * 4. EMPLOYEE / STAFF (role: 'STAFF') — Strictly self-service; denied POS, Procurement, Finance, Governance.
 * 
 * External Partner: VENDOR (role: 'VENDOR') — Supplier partner portal only.
 * Legacy Decommissioned: Normal Master (role: 'MASTER', isPrimaryMaster: false) — 403 ROLE_RETIRED.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Read frontend navigation file to evaluate navigation logic in an isolated node context
const navFilePath = path.resolve(__dirname, '..', '..', 'frontend', 'src', 'js', 'navigation.js');
const navSource = fs.readFileSync(navFilePath, 'utf8');

const evaluatedNav = (() => {
  const transformed = navSource
    .replace(/export const /g, 'const ')
    .replace(/export function /g, 'function ');
  const fn = new Function(
    `${transformed}; return { ROLES, NAVIGATION, isRouteAllowed, getGroupedNavItems };`
  );
  return fn();
})();

const { ROLES, NAVIGATION, isRouteAllowed, getGroupedNavItems } = evaluatedNav;
const { authorize } = require('../src/middleware/authorize');
const { ApiError } = require('../src/utils/ApiError');

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

test('Canonical Four-Persona & Vendor Access Matrix Security Verification', async (t) => {

  // ─── 1. PRIMARY MASTER ──────────────────────────────────────────────────
  await t.test('1. Primary Master retains unrestricted universal enterprise authority', () => {
    assert.equal(isRouteAllowed(ROLES.MASTER, 'dashboard', true), true);
    assert.equal(isRouteAllowed(ROLES.MASTER, 'pos', true), true);
    assert.equal(isRouteAllowed(ROLES.MASTER, 'procurement', true), true);
    assert.equal(isRouteAllowed(ROLES.MASTER, 'performance', true), true);
    assert.equal(isRouteAllowed(ROLES.MASTER, 'settings/trash', true), true);
    assert.equal(isRouteAllowed(ROLES.MASTER, 'finance', true), true);
    assert.equal(isRouteAllowed(ROLES.MASTER, 'system-health', true), true);

    const groups = getGroupedNavItems(ROLES.MASTER, true);
    assert.ok(Object.keys(groups).length > 0, 'Primary Master must have navigation groups');
  });

  // ─── 2. NORMAL MASTER DECOMMISSIONED ────────────────────────────────────
  await t.test('2. Normal Master (non-primary) fails closed with zero route access & 403 ROLE_RETIRED', async () => {
    assert.equal(isRouteAllowed(ROLES.MASTER, 'dashboard', false), false);
    assert.equal(isRouteAllowed(ROLES.MASTER, 'pos', false), false);
    assert.equal(isRouteAllowed(ROLES.MASTER, 'finance', false), false);
    assert.equal(isRouteAllowed(ROLES.MASTER, 'inventory', false), false);
    assert.equal(isRouteAllowed(ROLES.MASTER, 'settings', false), false);

    const groups = getGroupedNavItems(ROLES.MASTER, false);
    assert.deepEqual(groups, {}, 'Normal Master grouped items must be empty');

    const middleware = authorize('FINANCE:READ', { allowedRoles: ['MASTER', 'OWNER', 'CAFE_ADMIN'] });
    const req = { auth: { role: 'MASTER', isPrimaryMaster: false }, correlationId: 'c-nm-1' };
    const res = createMockResponse();
    let passed = false;
    await middleware(req, res, () => { passed = true; });

    assert.equal(passed, false);
    assert.equal(res.statusCode, 403);
    assert.equal(res.body?.error?.code, 'ROLE_RETIRED');
  });

  // ─── 3. OWNER PERSONA & FINANCE OPERATIONAL BOUNDARY ────────────────────
  await t.test('3.1 Owner has executive oversight and operational drilldown visibility in navigation (DISC-003)', () => {
    assert.equal(isRouteAllowed(ROLES.OWNER, 'dashboard'), true);
    assert.equal(isRouteAllowed(ROLES.OWNER, 'performance'), true);
    assert.equal(isRouteAllowed(ROLES.OWNER, 'owner-food-safety'), true);
    assert.equal(isRouteAllowed(ROLES.OWNER, 'owner-risk-audit'), true);
    assert.equal(isRouteAllowed(ROLES.OWNER, 'bills'), true);

    // Read-only operational drilldowns allowed
    assert.equal(isRouteAllowed(ROLES.OWNER, 'dept-orders'), true);
    assert.equal(isRouteAllowed(ROLES.OWNER, 'inventory'), true);
    assert.equal(isRouteAllowed(ROLES.OWNER, 'procurement'), true);
    assert.equal(isRouteAllowed(ROLES.OWNER, 'expenses'), true);
    assert.equal(isRouteAllowed(ROLES.OWNER, 'customers'), true);

    const ownerNav = NAVIGATION[ROLES.OWNER];
    const drilldownGroup = ownerNav.items.filter((item) => item.group === 'OPERATIONS (READ-ONLY)');
    assert.equal(drilldownGroup.length, 5, 'Must have 5 drilldown items in Owner sidebar');
  });

  await t.test('3.2 Owner is strictly denied POST /api/v1/finance/invoices/gst (GST tax invoice generation)', async () => {
    const middleware = authorize('FINANCE:WRITE', { allowedRoles: ['MASTER', 'CAFE_ADMIN'] });
    const req = { auth: { role: 'OWNER', isPrimaryMaster: false, assignedCafeIds: ['ZC-0001'] }, method: 'POST', correlationId: 'c-own-gst' };
    const res = createMockResponse();
    let passed = false;
    await middleware(req, res, () => { passed = true; });

    assert.equal(passed, false, 'Owner MUST be denied from generating GST tax invoices');
    assert.equal(res.statusCode, 403);
    assert.equal(res.body?.error?.code, 'ROLE_NOT_ALLOWED');
  });

  await t.test('3.3 Owner is strictly denied POST /api/v1/finance/reconciliation/z-report (Till reconciliation)', async () => {
    const middleware = authorize('FINANCE:WRITE', { allowedRoles: ['MASTER', 'CAFE_ADMIN'] });
    const req = { auth: { role: 'OWNER', isPrimaryMaster: false, assignedCafeIds: ['ZC-0001'] }, method: 'POST', correlationId: 'c-own-z' };
    const res = createMockResponse();
    let passed = false;
    await middleware(req, res, () => { passed = true; });

    assert.equal(passed, false, 'Owner MUST be denied from committing daily till reconciliation');
    assert.equal(res.statusCode, 403);
    assert.equal(res.body?.error?.code, 'ROLE_NOT_ALLOWED');
  });

  await t.test('3.4 Owner retains read-only access to GET /api/v1/finance/invoices/:id/pdf where scoped', async () => {
    const { RolePermission } = require('../src/models/RolePermission');
    const originalFind = RolePermission.findEffectiveRules;
    RolePermission.findEffectiveRules = async () => [
      {
        effect: 'ALLOW',
        scope: 'ASSIGNED_CAFES',
        isCurrentlyEffective: () => true,
        requiresMfa: false,
        requiresStepUpAuthentication: false,
      },
    ];

    try {
      const middleware = authorize('FINANCE:READ', { allowedRoles: ['MASTER', 'OWNER', 'CAFE_ADMIN'] });
      const req = {
        auth: { role: 'OWNER', isPrimaryMaster: false, assignedCafeIds: ['ZC-0001'] },
        params: { id: 'INV-2026-001' },
        query: { cafeId: 'ZC-0001' },
        method: 'GET',
        correlationId: 'c-own-pdf',
      };
      const res = createMockResponse();
      let passed = false;
      await middleware(req, res, () => { passed = true; });

      assert.equal(passed, true, 'Owner MUST be allowed to read invoice PDF when scoped to assigned cafe');
      assert.equal(res.statusCode, 200);
    } finally {
      RolePermission.findEffectiveRules = originalFind;
    }
  });

  // ─── 4. CAFE OPERATIONS & SCOPING BOUNDARIES ───────────────────────────
  await t.test('4.1 Cafe Operations with correct cafe scope can perform permitted operational actions', async () => {
    const { RolePermission } = require('../src/models/RolePermission');
    const originalFind = RolePermission.findEffectiveRules;
    RolePermission.findEffectiveRules = async () => [
      {
        effect: 'ALLOW',
        scope: 'ASSIGNED_CAFES',
        isCurrentlyEffective: () => true,
        requiresMfa: false,
        requiresStepUpAuthentication: false,
      },
    ];

    try {
      const middleware = authorize('FINANCE:WRITE', { allowedRoles: ['MASTER', 'CAFE_ADMIN'] });
      const req = {
        auth: { role: 'CAFE_ADMIN', isPrimaryMaster: false, assignedCafeIds: ['ZC-0001'] },
        query: { cafeId: 'ZC-0001' },
        method: 'POST',
        correlationId: 'c-ca-pass',
      };
      const res = createMockResponse();
      let passed = false;
      await middleware(req, res, () => { passed = true; });

      assert.equal(passed, true, 'Authorized Cafe Admin MUST pass operational mutation');
      assert.equal(res.statusCode, 200);
    } finally {
      RolePermission.findEffectiveRules = originalFind;
    }
  });

  await t.test('4.2 Cafe Operations from another cafe is denied cross-cafe access', async () => {
    const { RolePermission } = require('../src/models/RolePermission');
    const originalFind = RolePermission.findEffectiveRules;
    RolePermission.findEffectiveRules = async () => [
      {
        effect: 'ALLOW',
        scope: 'ASSIGNED_CAFES',
        isCurrentlyEffective: () => true,
        requiresMfa: false,
        requiresStepUpAuthentication: false,
      },
    ];

    try {
      const middleware = authorize('FINANCE:WRITE', { allowedRoles: ['MASTER', 'CAFE_ADMIN'] });
      // Cafe admin assigned only to ZC-0001, attempting to mutate ZC-0002
      const req = {
        auth: { role: 'CAFE_ADMIN', isPrimaryMaster: false, assignedCafeIds: ['ZC-0001'] },
        query: { cafeId: 'ZC-0002' },
        method: 'POST',
        correlationId: 'c-ca-cross',
      };
      const res = createMockResponse();
      let passed = false;
      await middleware(req, res, () => { passed = true; });

      assert.equal(passed, false, 'Cross-cafe access must be denied');
      assert.equal(res.statusCode, 403);
      assert.equal(res.body?.error?.code, 'CAFE_ACCESS_DENIED');
    } finally {
      RolePermission.findEffectiveRules = originalFind;
    }
  });

  await t.test('4.3 Cafe Operations cannot access Owner performance view via alias (DISC-010)', () => {
    assert.equal(isRouteAllowed(ROLES.CAFE_ADMIN, 'performance'), false);
  });

  // ─── 5. STAFF PERSONA & VENDOR PARTNER BOUNDARIES ───────────────────────
  await t.test('5.1 Staff is strictly denied GST invoice generation and till reconciliation', async () => {
    const middleware = authorize('FINANCE:WRITE', { allowedRoles: ['MASTER', 'CAFE_ADMIN'] });
    const req = { auth: { role: 'STAFF', isPrimaryMaster: false }, method: 'POST', correlationId: 'c-st-1' };
    const res = createMockResponse();
    let passed = false;
    await middleware(req, res, () => { passed = true; });

    assert.equal(passed, false, 'Staff MUST be denied from financial mutations');
    assert.equal(res.statusCode, 403);
    assert.equal(res.body?.error?.code, 'ROLE_NOT_ALLOWED');
  });

  await t.test('5.2 Vendor partner is strictly read-only and denied mutations', async () => {
    const middleware = authorize('FINANCE:WRITE', { allowedRoles: ['MASTER', 'CAFE_ADMIN'] });
    const req = { auth: { role: 'VENDOR', isPrimaryMaster: false }, method: 'POST', correlationId: 'c-vn-1' };
    const res = createMockResponse();
    let passed = false;
    await middleware(req, res, () => { passed = true; });

    assert.equal(passed, false, 'Vendor MUST be denied from business mutations');
    assert.equal(res.statusCode, 403);
    assert.equal(res.body?.error?.code, 'VENDOR_READ_ONLY');
  });
});
