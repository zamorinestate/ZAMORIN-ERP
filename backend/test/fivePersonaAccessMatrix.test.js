'use strict';

/**
 * FIVE-PERSONA ACCESS MATRIX & NAVIGATION BOUNDARY TEST SUITE
 * 
 * Verifies the five-persona topology and access boundaries:
 * 1. Primary Master (role: 'MASTER', isPrimaryMaster: true) — Full enterprise governance
 * 2. Normal Master (role: 'MASTER', isPrimaryMaster: false) — Retired / fails closed
 * 3. Owner (role: 'OWNER') — Executive oversight, read-only operational drilldowns, no cashiering/mutations
 * 4. Café Admin (role: 'CAFE_ADMIN') — Operational management for assigned café, no owner analytics leak
 * 5. Staff (role: 'STAFF') — Strictly self-service, blocked from POS, Procurement, Finance, Governance
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Read frontend navigation file to evaluate navigation logic in an isolated node context
const navFilePath = path.resolve(__dirname, '..', '..', 'frontend', 'src', 'js', 'navigation.js');
const navSource = fs.readFileSync(navFilePath, 'utf8');

// Lightweight evaluation of navigation module exports
const evaluatedNav = (() => {
  const exports = {};
  // Strip export keywords for evaluation in clean function scope
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

test('Five-Persona Navigation & Authorization Security Matrix', async (t) => {
  
  // ─── 1. PRIMARY MASTER ──────────────────────────────────────────────────
  await t.test('1. Primary Master has unrestricted universal access across all routes', () => {
    assert.equal(isRouteAllowed(ROLES.MASTER, 'dashboard', true), true);
    assert.equal(isRouteAllowed(ROLES.MASTER, 'pos', true), true);
    assert.equal(isRouteAllowed(ROLES.MASTER, 'procurement', true), true);
    assert.equal(isRouteAllowed(ROLES.MASTER, 'performance', true), true);
    assert.equal(isRouteAllowed(ROLES.MASTER, 'settings/trash', true), true);
    assert.equal(isRouteAllowed(ROLES.MASTER, 'finance', true), true);
    assert.equal(isRouteAllowed(ROLES.MASTER, 'system-health', true), true);
    
    const groups = getGroupedNavItems(ROLES.MASTER, true);
    assert.ok(Object.keys(groups).length > 0, 'Primary master must have navigation groups');
  });

  // ─── 2. NORMAL MASTER (DECOMMISSIONED) ──────────────────────────────────
  await t.test('2. Normal Master (non-primary) fails closed with zero route access', () => {
    assert.equal(isRouteAllowed(ROLES.MASTER, 'dashboard', false), false);
    assert.equal(isRouteAllowed(ROLES.MASTER, 'pos', false), false);
    assert.equal(isRouteAllowed(ROLES.MASTER, 'finance', false), false);
    assert.equal(isRouteAllowed(ROLES.MASTER, 'inventory', false), false);
    assert.equal(isRouteAllowed(ROLES.MASTER, 'settings', false), false);

    const groups = getGroupedNavItems(ROLES.MASTER, false);
    assert.deepEqual(groups, {}, 'Normal master grouped items must be empty');
  });

  // ─── 3. OWNER PERSONA ───────────────────────────────────────────────────
  await t.test('3.1 Owner has executive oversight and operational drilldown visibility (DISC-003)', () => {
    // Executive governance routes
    assert.equal(isRouteAllowed(ROLES.OWNER, 'dashboard'), true);
    assert.equal(isRouteAllowed(ROLES.OWNER, 'performance'), true);
    assert.equal(isRouteAllowed(ROLES.OWNER, 'owner-food-safety'), true);
    assert.equal(isRouteAllowed(ROLES.OWNER, 'owner-risk-audit'), true);
    assert.equal(isRouteAllowed(ROLES.OWNER, 'bills'), true);

    // Operational read-only drilldown routes are allowed
    assert.equal(isRouteAllowed(ROLES.OWNER, 'dept-orders'), true);
    assert.equal(isRouteAllowed(ROLES.OWNER, 'inventory'), true);
    assert.equal(isRouteAllowed(ROLES.OWNER, 'procurement'), true);
    assert.equal(isRouteAllowed(ROLES.OWNER, 'expenses'), true);
    assert.equal(isRouteAllowed(ROLES.OWNER, 'customers'), true);

    // Verify operational drilldowns exist in OWNER navigation items under OPERATIONS (READ-ONLY)
    const ownerNav = NAVIGATION[ROLES.OWNER];
    const drilldownGroup = ownerNav.items.filter((item) => item.group === 'OPERATIONS (READ-ONLY)');
    assert.equal(drilldownGroup.length, 5, 'Must have 5 drilldown items in Owner sidebar');
    const drilldownRoutes = drilldownGroup.map((i) => i.route);
    assert.ok(drilldownRoutes.includes('dept-orders'));
    assert.ok(drilldownRoutes.includes('inventory'));
    assert.ok(drilldownRoutes.includes('procurement'));
    assert.ok(drilldownRoutes.includes('expenses'));
    assert.ok(drilldownRoutes.includes('customers'));
  });

  await t.test('3.2 Owner is strictly blocked from cashiering and master administration', () => {
    // POS terminal is not allowed
    assert.equal(isRouteAllowed(ROLES.OWNER, 'pos'), false);
    assert.equal(isRouteAllowed(ROLES.OWNER, 'cafe-ops-devices'), false);
    assert.equal(isRouteAllowed(ROLES.OWNER, 'settings/trash'), false);
    assert.equal(isRouteAllowed(ROLES.OWNER, 'settings/data-recovery'), false);
  });

  // ─── 4. CAFE ADMIN PERSONA ──────────────────────────────────────────────
  await t.test('4.1 Cafe Admin has operational management for assigned cafe', () => {
    assert.equal(isRouteAllowed(ROLES.CAFE_ADMIN, 'dashboard'), true);
    assert.equal(isRouteAllowed(ROLES.CAFE_ADMIN, 'pos'), true);
    assert.equal(isRouteAllowed(ROLES.CAFE_ADMIN, 'inventory'), true);
    assert.equal(isRouteAllowed(ROLES.CAFE_ADMIN, 'procurement'), true);
    assert.equal(isRouteAllowed(ROLES.CAFE_ADMIN, 'vendors'), true);
    assert.equal(isRouteAllowed(ROLES.CAFE_ADMIN, 'menu'), true);
    assert.equal(isRouteAllowed(ROLES.CAFE_ADMIN, 'employees'), true);
    assert.equal(isRouteAllowed(ROLES.CAFE_ADMIN, 'cafe-ops-devices'), true);
  });

  await t.test('4.2 Cafe Admin cannot access Owner performance view via alias (DISC-010)', () => {
    // Cafe Admin must NOT have route access to performance
    assert.equal(isRouteAllowed(ROLES.CAFE_ADMIN, 'performance'), false);
  });

  await t.test('4.3 Cafe Admin is blocked from Owner governance and Master-only modules', () => {
    assert.equal(isRouteAllowed(ROLES.CAFE_ADMIN, 'owner-food-safety'), false);
    assert.equal(isRouteAllowed(ROLES.CAFE_ADMIN, 'owner-risk-audit'), false);
    assert.equal(isRouteAllowed(ROLES.CAFE_ADMIN, 'passbook'), false);
    assert.equal(isRouteAllowed(ROLES.CAFE_ADMIN, 'ledger'), false);
    assert.equal(isRouteAllowed(ROLES.CAFE_ADMIN, 'revenue-share'), false);
  });

  // ─── 5. STAFF PERSONA ───────────────────────────────────────────────────
  await t.test('5.1 Staff is strictly restricted to self-service', () => {
    assert.equal(isRouteAllowed(ROLES.STAFF, 'staff-home'), true);
    assert.equal(isRouteAllowed(ROLES.STAFF, 'announcements'), true);
    assert.equal(isRouteAllowed(ROLES.STAFF, 'staff-attendance'), true);
    assert.equal(isRouteAllowed(ROLES.STAFF, 'staff-leave'), true);
    assert.equal(isRouteAllowed(ROLES.STAFF, 'staff-settings'), true);

    // Blocked from operations and governance
    assert.equal(isRouteAllowed(ROLES.STAFF, 'pos'), false);
    assert.equal(isRouteAllowed(ROLES.STAFF, 'inventory'), false);
    assert.equal(isRouteAllowed(ROLES.STAFF, 'procurement'), false);
    assert.equal(isRouteAllowed(ROLES.STAFF, 'finance'), false);
    assert.equal(isRouteAllowed(ROLES.STAFF, 'bills'), false);
    assert.equal(isRouteAllowed(ROLES.STAFF, 'dashboard'), false);
    assert.equal(isRouteAllowed(ROLES.STAFF, 'performance'), false);
  });

  // ─── 6. BACKEND ROUTE MIDDLEWARE VERIFICATION ───────────────────────────
  await t.test('6.1 Backend authorize middleware enforces role restrictions for Finance mutations', async () => {
    const { RolePermission } = require('../src/models/RolePermission');
    const originalFindEffectiveRules = RolePermission.findEffectiveRules;
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

      const financeWriteAuth = authorize('FINANCE:WRITE', { allowedRoles: ['MASTER', 'OWNER', 'CAFE_ADMIN'] });

      // Test STAFF rejection
      const staffReq = { auth: { role: 'STAFF', isPrimaryMaster: false }, correlationId: 'c1' };
      const staffRes = createMockResponse();
      let staffPassed = false;
      await financeWriteAuth(staffReq, staffRes, () => { staffPassed = true; });
      assert.equal(staffPassed, false, 'STAFF must not pass FINANCE:WRITE authorization');
      assert.equal(staffRes.statusCode, 403, 'STAFF must receive HTTP 403');

      // Test CAFE_ADMIN acceptance
      const adminReq = { auth: { role: 'CAFE_ADMIN', isPrimaryMaster: false, assignedCafeIds: ['ZC-01'] }, query: { cafeId: 'ZC-01' }, correlationId: 'c2' };
      const adminRes = createMockResponse();
      let adminPassed = false;
      await financeWriteAuth(adminReq, adminRes, () => { adminPassed = true; });
      assert.equal(adminPassed, true, 'CAFE_ADMIN must pass FINANCE:WRITE authorization');

      // Test Normal Master rejection
      const normalMasterReq = { auth: { role: 'MASTER', isPrimaryMaster: false }, correlationId: 'c3' };
      const normalMasterRes = createMockResponse();
      let normalMasterPassed = false;
      await financeWriteAuth(normalMasterReq, normalMasterRes, () => { normalMasterPassed = true; });
      assert.equal(normalMasterPassed, false, 'Normal Master must not pass authorization');
      assert.equal(normalMasterRes.statusCode, 403, 'Normal Master must receive HTTP 403');
    } finally {
      RolePermission.findEffectiveRules = originalFindEffectiveRules;
    }
  });
});
