'use strict';

/**
 * NORMAL MASTER DECOMMISSION & FOUR-PERSONA TOPOLOGY VERIFICATION SUITE
 *
 * Formally verifies the permanent retirement of the Normal Master persona and
 * the enforcement of the strict Four-Persona Role Topology:
 * 1. PRIMARY MASTER (role === 'MASTER' && isPrimaryMaster === true)
 * 2. OWNER (role === 'OWNER')
 * 3. CAFE OPERATIONS (role === 'CAFE_ADMIN')
 * 4. EMPLOYEE / STAFF (role === 'STAFF')
 *
 * Invariant: IF role === 'MASTER' THEN isPrimaryMaster MUST === true
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryReplSet } = require('mongodb-memory-server');

const { User } = require('../src/models/User');
const { Session } = require('../src/models/Session');
const { Cafe } = require('../src/models/Cafe');
const { AuditEvent } = require('../src/models/AuditEvent');
const { Notification } = require('../src/models/Notification');
const { NotificationService } = require('../src/services/NotificationService');
const {
  hashPassword,
  authenticatePassword,
  createSession,
  rotateRefreshToken,
} = require('../src/services/authService');
const { authenticate } = require('../src/middleware/authenticate');
const {
  authorize,
  requirePrimaryMaster,
  requirePrimaryMasterOrOwner,
  canAccessCafe,
} = require('../src/middleware/authorize');
const {
  validateProposedRole,
} = require('../src/services/userGovernanceService');
const {
  createUser,
} = require('../src/controllers/userController');
const {
  retireNormalMasterAccounts,
} = require('../src/scripts/retireNormalMasterAccounts');
const {
  NAVIGATION,
  isRouteAllowed,
  getGroupedNavItems,
  ROLES,
} = require('../../Frontend/src/js/navigation');
const {
  getIsPrimaryMaster,
} = require('../../Frontend/src/js/router');

const ORG_ID = 'ORG-ZAMORIN-DECOM';
const CAFE_01 = 'ZC-0001';
const CAFE_02 = 'ZC-0002';

test('ZAMORIN CAFÉ ERP — FOUR-PERSONA ROLE TOPOLOGY VERIFICATION SUITE', async (suite) => {
  let replSet;
  let defaultPasswordHash;

  suite.before(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await replSet.waitUntilRunning();
    await mongoose.connect(replSet.getUri());

    await User.createCollection();
    await Session.createCollection();
    await Cafe.createCollection();
    await AuditEvent.createCollection();
    await Notification.createCollection();

    defaultPasswordHash = await hashPassword('ValidPassphrase123#');

    await Cafe.create({
      organisationId: ORG_ID,
      cafeId: CAFE_01,
      name: 'Calicut Heritage Cafe',
      displayName: 'Calicut Heritage Cafe',
      status: 'ACTIVE',
      createdBy: 'MU-0001',
    });

    await Cafe.create({
      organisationId: ORG_ID,
      cafeId: CAFE_02,
      name: 'Kochi Marine Drive Cafe',
      displayName: 'Kochi Marine Drive Cafe',
      status: 'ACTIVE',
      createdBy: 'MU-0001',
    });
  });

  suite.after(async () => {
    await mongoose.disconnect();
    if (replSet) {
      await replSet.stop();
    }
  });

  // ── TEST 1: Normal Master cannot be created through API ───────────────────────
  await suite.test('1. Normal Master cannot be created through API (POST /users with role MASTER rejected)', async () => {
    const req = {
      auth: {
        userId: 'MU-0001',
        organisationId: ORG_ID,
        role: 'MASTER',
        isPrimaryMaster: true,
      },
      body: {
        name: 'Attempted Normal Master',
        email: 'attempted.normal@example.com',
        role: 'MASTER',
        password: 'ValidPassword123#',
      },
    };
    const res = {
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(payload) {
        this.body = payload;
        return this;
      },
    };

    await assert.rejects(
      async () => {
        await createUser(req, res, (err) => {
          if (err) throw err;
        });
      },
      (err) => {
        assert.equal(err.statusCode, 403);
        assert.equal(err.code, 'ROLE_RETIRED_NORMAL_MASTER');
        return true;
      }
    );
  });

  // ── TEST 2: MASTER + isPrimaryMaster: false is denied in User model pre-validation
  await suite.test('2. MASTER + isPrimaryMaster: false is denied in User model pre-validation', async () => {
    const user = new User({
      userId: 'MU-0099',
      organisationId: ORG_ID,
      name: 'Illegal Normal Master',
      email: 'illegal.master@example.com',
      role: 'MASTER',
      isPrimaryMaster: false,
      accountStatus: 'ACTIVE',
      passwordHash: defaultPasswordHash,
    });

    await assert.rejects(
      async () => {
        await user.validate();
      },
      (err) => {
        assert(err.errors.role);
        assert(err.errors.role.message.includes('Normal Master persona is permanently retired'));
        return true;
      }
    );
  });

  // ── TEST 3: Existing retired Normal Master cannot log in ──────────────────────
  await suite.test('3. Existing retired Normal Master cannot log in (authenticatePassword throws ROLE_RETIRED)', async () => {
    // Create an unvalidated legacy record directly via collection to simulate pre-existing account
    await mongoose.connection.db.collection('users').insertOne({
      userId: 'MU-0002',
      organisationId: ORG_ID,
      name: 'Legacy Normal Master',
      email: 'legacy.normal@example.com',
      role: 'MASTER',
      isPrimaryMaster: false,
      accountStatus: 'ACTIVE',
      passwordHash: defaultPasswordHash,
      sessionVersion: 1,
      permissionsVersion: 1,
      failedLoginAttempts: 0,
    });

    await assert.rejects(
      async () => {
        await authenticatePassword({
          organisationId: ORG_ID,
          email: 'legacy.normal@example.com',
          password: 'ValidPassphrase123#',
        });
      },
      (err) => {
        assert.equal(err.code, 'ROLE_RETIRED');
        return true;
      }
    );
  });

  // ── TEST 4: Existing retired Normal Master cannot refresh token ───────────────
  await suite.test('4. Existing retired Normal Master cannot refresh token (rotateRefreshToken throws ROLE_RETIRED and revokes session)', async () => {
    const dummyUser = {
      userId: 'MU-0002',
      organisationId: ORG_ID,
      role: 'MASTER',
      isPrimaryMaster: false,
      assignedCafeIds: [],
      sessionVersion: 1,
      permissionsVersion: 1,
    };

    const sessionData = await createSession({
      user: dummyUser,
      device: { deviceId: 'DEV-001', deviceType: 'DESKTOP' },
      network: { ipAddress: '127.0.0.1' },
      createdBy: 'MU-0002',
    });

    await assert.rejects(
      async () => {
        await rotateRefreshToken({
          sessionId: sessionData.session.sessionId,
          refreshToken: sessionData.refreshToken,
          deviceId: 'DEV-001',
        });
      },
      (err) => {
        assert.equal(err.code, 'ROLE_RETIRED');
        return true;
      }
    );

    // Verify session was revoked in DB
    const sessionInDb = await Session.findOne({ sessionId: sessionData.session.sessionId });
    assert.equal(sessionInDb.status, 'REVOKED');
    assert.equal(sessionInDb.revocationReason, 'ROLE_RETIRED_NORMAL_MASTER');
  });

  // ── TEST 5: Existing Normal Master session becomes invalid ────────────────────
  await suite.test('5. Existing Normal Master session becomes invalid (authenticate middleware returns 403 ROLE_RETIRED)', async () => {
    // Generate valid JWT but with retired user in DB
    const dummyUser = {
      userId: 'MU-0002',
      organisationId: ORG_ID,
      role: 'MASTER',
      isPrimaryMaster: false,
      assignedCafeIds: [],
      sessionVersion: 1,
      permissionsVersion: 1,
    };

    const sessionData = await createSession({
      user: dummyUser,
      device: { deviceId: 'DEV-001' },
      network: { ipAddress: '127.0.0.1' },
      createdBy: 'MU-0002',
    });

    const req = {
      get(header) {
        if (header.toLowerCase() === 'authorization') {
          return `Bearer ${sessionData.accessToken}`;
        }
        return null;
      },
      cookies: {},
    };

    let statusCode = null;
    let jsonBody = null;
    const res = {
      status(code) {
        statusCode = code;
        return this;
      },
      json(body) {
        jsonBody = body;
        return this;
      },
    };

    let nextCalled = false;
    await authenticate(req, res, () => {
      nextCalled = true;
    });

    assert.equal(nextCalled, false, 'Middleware must not call next() for Normal Master');
    assert.equal(statusCode, 403);
    assert.equal(jsonBody?.error?.code, 'ROLE_RETIRED');
  });

  // ── TEST 6: Normal Master dashboard route unavailable ─────────────────────────
  await suite.test('6. Normal Master dashboard and all routes unavailable (isRouteAllowed returns false when !isPrimaryMaster)', () => {
    const testRoutes = [
      'dashboard',
      'inventory',
      'procurement',
      'reports',
      'finance',
      'bills',
      'pos',
      'employees',
      'attendance',
      'admin',
      'ledger',
      'passbook',
      'revenue-share',
    ];

    for (const route of testRoutes) {
      const allowedForNormal = isRouteAllowed(ROLES.MASTER, route, false);
      assert.equal(
        allowedForNormal,
        false,
        `Route '${route}' must be strictly DENIED when isPrimaryMaster is false`
      );
    }
  });

  // ── TEST 7: Normal Master navigation absent ───────────────────────────────────
  await suite.test('7. Normal Master navigation absent (getGroupedNavItems returns empty object)', () => {
    const normalNav = getGroupedNavItems(ROLES.MASTER, false);
    assert.deepEqual(normalNav, {}, 'getGroupedNavItems for non-primary master must return empty object {}');

    const primaryNav = getGroupedNavItems(ROLES.MASTER, true);
    assert(Object.keys(primaryNav).length > 0, 'Primary Master navigation must contain groups');
    assert(primaryNav.COMMAND, 'Primary Master must have COMMAND group');
    assert(primaryNav.FINANCE, 'Primary Master must have FINANCE group');
  });

  // ── TEST 8: Normal Master user option absent from user-management UI ─────────
  await suite.test('8. Normal Master user option absent from role validation (validateProposedRole blocks MASTER)', () => {
    // Attempting to validate MASTER for user assignment / promotion must throw ROLE_RETIRED_NORMAL_MASTER
    assert.throws(
      () => validateProposedRole('MASTER'),
      (err) => {
        assert.equal(err.code, 'ROLE_RETIRED_NORMAL_MASTER');
        assert.equal(err.statusCode, 403);
        return true;
      }
    );

    // Active roles (OWNER, CAFE_ADMIN, STAFF) validate successfully
    assert.doesNotThrow(() => validateProposedRole('OWNER'));
    assert.doesNotThrow(() => validateProposedRole('CAFE_ADMIN'));
    assert.doesNotThrow(() => validateProposedRole('STAFF'));
  });

  // ── TEST 9: Primary Master login succeeds ────────────────────────────────────
  await suite.test('9. Primary Master login succeeds', async () => {
    // Seed legitimate Primary Master
    await mongoose.connection.db.collection('users').insertOne({
      userId: 'MU-0001',
      organisationId: ORG_ID,
      name: 'Zamorin Primary Master',
      email: 'pm@zamorincafe.com',
      role: 'MASTER',
      isPrimaryMaster: true,
      accountStatus: 'ACTIVE',
      passwordHash: defaultPasswordHash,
      sessionVersion: 1,
      permissionsVersion: 1,
      primaryMasterDesignatedAt: new Date(),
      primaryMasterDesignatedBy: 'SYSTEM',
      primaryMasterDesignationReason: 'Enterprise Provisioning',
      failedLoginAttempts: 0,
    });

    const result = await authenticatePassword({
      organisationId: ORG_ID,
      email: 'pm@zamorincafe.com',
      password: 'ValidPassphrase123#',
    });

    assert.equal(result.user.userId, 'MU-0001');
    assert.equal(result.user.role, 'MASTER');
    assert.equal(result.user.isPrimaryMaster, true);
  });

  // ── TEST 10: Primary Master authorization remains intact ──────────────────────
  await suite.test('10. Primary Master authorization remains intact', async () => {
    const pmReq = {
      auth: {
        userId: 'MU-0001',
        organisationId: ORG_ID,
        role: 'MASTER',
        isPrimaryMaster: true,
        assignedCafeIds: [],
        mfaVerified: true,
      },
    };
    const res = {
      status(code) { this.statusCode = code; return this; },
      json(body) { this.body = body; return this; },
    };

    let pmPassed = false;
    requirePrimaryMaster(pmReq, res, () => {
      pmPassed = true;
    });
    assert.equal(pmPassed, true, 'Primary Master must pass requirePrimaryMaster');

    let pmOrOwnerPassed = false;
    requirePrimaryMasterOrOwner(pmReq, res, () => {
      pmOrOwnerPassed = true;
    });
    assert.equal(pmOrOwnerPassed, true, 'Primary Master must pass requirePrimaryMasterOrOwner');

    // All Primary Master routes allowed
    assert.equal(isRouteAllowed(ROLES.MASTER, 'passbook', true), true);
    assert.equal(isRouteAllowed(ROLES.MASTER, 'ledger', true), true);
    assert.equal(isRouteAllowed(ROLES.MASTER, 'revenue-share', true), true);
    assert.equal(isRouteAllowed(ROLES.MASTER, 'admin', true), true);
    assert.equal(isRouteAllowed(ROLES.MASTER, 'reports', true), true);
  });

  // ── TEST 11: Owner permissions unchanged ─────────────────────────────────────
  await suite.test('11. Owner permissions unchanged (GRC, executive reporting allowed; user administration denied)', () => {
    assert.equal(isRouteAllowed(ROLES.OWNER, 'dashboard'), true);
    assert.equal(isRouteAllowed(ROLES.OWNER, 'owner-risk-audit'), true);
    assert.equal(isRouteAllowed(ROLES.OWNER, 'owner-planning'), true);
    assert.equal(isRouteAllowed(ROLES.OWNER, 'finance'), true);
    assert.equal(isRouteAllowed(ROLES.OWNER, 'ledger'), true);
    assert.equal(isRouteAllowed(ROLES.OWNER, 'revenue-share'), true);

    // Blocked from User Administration and Devices
    assert.equal(isRouteAllowed(ROLES.OWNER, 'admin'), false);
    assert.equal(isRouteAllowed(ROLES.OWNER, 'cafe-ops-devices'), false);
  });

  // ── TEST 12: Café Operations permissions unchanged ────────────────────────────
  await suite.test('12. Café Operations permissions unchanged (POS, local inventory, local expenses allowed)', () => {
    assert.equal(isRouteAllowed(ROLES.CAFE_ADMIN, 'dashboard'), true);
    assert.equal(isRouteAllowed(ROLES.CAFE_ADMIN, 'pos'), true);
    assert.equal(isRouteAllowed(ROLES.CAFE_ADMIN, 'inventory'), true);
    assert.equal(isRouteAllowed(ROLES.CAFE_ADMIN, 'procurement'), true);
    assert.equal(isRouteAllowed(ROLES.CAFE_ADMIN, 'dept-orders'), true);
    assert.equal(isRouteAllowed(ROLES.CAFE_ADMIN, 'attendance'), true);

    // Blocked from Executive / Master routes
    assert.equal(isRouteAllowed(ROLES.CAFE_ADMIN, 'ledger'), false);
    assert.equal(isRouteAllowed(ROLES.CAFE_ADMIN, 'passbook'), false);
    assert.equal(isRouteAllowed(ROLES.CAFE_ADMIN, 'revenue-share'), false);
    assert.equal(isRouteAllowed(ROLES.CAFE_ADMIN, 'admin'), false);
  });

  // ── TEST 13: Staff permissions unchanged ─────────────────────────────────────
  await suite.test('13. Staff permissions unchanged (self-service, attendance, payslips allowed; admin denied)', () => {
    assert.equal(isRouteAllowed(ROLES.STAFF, 'staff-home'), true);
    assert.equal(isRouteAllowed(ROLES.STAFF, 'staff-attendance'), true);
    assert.equal(isRouteAllowed(ROLES.STAFF, 'staff-payslips'), true);
    assert.equal(isRouteAllowed(ROLES.STAFF, 'staff-leave'), true);
    assert.equal(isRouteAllowed(ROLES.STAFF, 'staff-loans-advances'), true);

    // Blocked from all operational and management routes
    assert.equal(isRouteAllowed(ROLES.STAFF, 'dashboard'), false);
    assert.equal(isRouteAllowed(ROLES.STAFF, 'pos'), false);
    assert.equal(isRouteAllowed(ROLES.STAFF, 'inventory'), false);
    assert.equal(isRouteAllowed(ROLES.STAFF, 'procurement'), false);
    assert.equal(isRouteAllowed(ROLES.STAFF, 'admin'), false);
    assert.equal(isRouteAllowed(ROLES.STAFF, 'ledger'), false);
  });

  // ── TEST 14: Café Operations cannot gain cross-café Normal Master authority ────
  await suite.test('14. Café Operations cannot gain cross-café Normal Master authority (canAccessCafe restricts to assigned café)', () => {
    const cafeAdminAuth = {
      role: 'CAFE_ADMIN',
      assignedCafeIds: [CAFE_01],
    };

    assert.equal(canAccessCafe(cafeAdminAuth, CAFE_01), true, 'Must access assigned café');
    assert.equal(canAccessCafe(cafeAdminAuth, CAFE_02), false, 'Must be denied unassigned café');

    // Retired Normal Master check: even with role MASTER, without isPrimaryMaster: true, canAccessCafe must deny
    const normalMasterAuth = {
      role: 'MASTER',
      isPrimaryMaster: false,
      assignedCafeIds: [],
    };
    assert.equal(canAccessCafe(normalMasterAuth, CAFE_01), false, 'Non-primary master must not gain cross-cafe access');

    // Primary Master holds legitimate cross-café access
    const primaryMasterAuth = {
      role: 'MASTER',
      isPrimaryMaster: true,
      assignedCafeIds: [],
    };
    assert.equal(canAccessCafe(primaryMasterAuth, CAFE_01), true, 'Primary master retains cross-cafe access');
    assert.equal(canAccessCafe(primaryMasterAuth, CAFE_02), true, 'Primary master retains cross-cafe access');
  });

  // ── TEST 15: Owner cannot gain Normal Master operational permissions ─────────
  await suite.test('15. Owner cannot gain Normal Master operational permissions (cannot administer users)', async () => {
    const ownerReq = {
      auth: {
        userId: 'OW-0001',
        organisationId: ORG_ID,
        role: 'OWNER',
        isPrimaryMaster: false,
      },
    };
    const res = {
      status(code) { this.statusCode = code; return this; },
      json(body) { this.body = body; return this; },
    };

    let passed = false;
    try {
      requirePrimaryMaster(ownerReq, res, () => {
        passed = true;
      });
    } catch (_) {}

    assert.equal(passed, false, 'Owner must be denied Primary Master authority');
  });

  // ── TEST 16: Staff cannot gain additional access ──────────────────────────────
  await suite.test('16. Staff cannot gain additional access (blocked from all administrative middleware)', () => {
    const staffReq = {
      auth: {
        userId: 'ST-0001',
        organisationId: ORG_ID,
        role: 'STAFF',
        isPrimaryMaster: false,
      },
    };
    const res = {
      status(code) { this.statusCode = code; return this; },
      json(body) { this.body = body; return this; },
    };

    let pmPassed = false;
    requirePrimaryMaster(staffReq, res, () => { pmPassed = true; });
    assert.equal(pmPassed, false, 'Staff must be denied requirePrimaryMaster');

    let pmOrOwnerPassed = false;
    requirePrimaryMasterOrOwner(staffReq, res, () => { pmOrOwnerPassed = true; });
    assert.equal(pmOrOwnerPassed, false, 'Staff must be denied requirePrimaryMasterOrOwner');
  });

  // ── TEST 17: Direct API request cannot bypass retired role restriction ────────
  await suite.test('17. Direct API request cannot bypass retired role restriction (roleOnlyMiddleware rejects non-primary MASTER)', async () => {
    const roleMiddleware = authorize(['MASTER']);
    const nonPrimaryReq = {
      auth: {
        userId: 'MU-0002',
        organisationId: ORG_ID,
        role: 'MASTER',
        isPrimaryMaster: false,
      },
    };
    let statusCode = null;
    let jsonBody = null;
    const res = {
      status(code) { statusCode = code; return this; },
      json(body) { jsonBody = body; return this; },
    };

    let nextCalled = false;
    await roleMiddleware(nonPrimaryReq, res, () => { nextCalled = true; });
    assert.equal(nextCalled, false);
    assert.equal(statusCode, 403);
    assert.equal(jsonBody?.error?.code, 'ROLE_RETIRED');
  });

  // ── TEST 18: Historical audit record containing MASTER/Normal Master remains readable
  await suite.test('18. Historical audit record containing MASTER/Normal Master remains readable', async () => {
    await AuditEvent.create({
      auditEventId: 'AE-20260801-0001',
      correlationId: 'CORR-LEGACY-001',
      organisationId: ORG_ID,
      module: 'USER_GOVERNANCE',
      action: 'LEGACY_ACTION',
      entityType: 'USER',
      entityId: 'MU-0002',
      actorUserId: 'MU-0002',
      actorRole: 'MASTER',
      result: 'SUCCESS',
      riskClassification: 'LOW',
      reason: 'Historical transaction performed by legacy Normal Master persona prior to decommissioning',
    });

    const record = await AuditEvent.findOne({ actorUserId: 'MU-0002' });
    assert(record, 'Historical audit record must be preserved and queryable');
    assert.equal(record.actorRole, 'MASTER');
    assert(record.reason.includes('prior to decommissioning'));
  });

  // ── TEST 19: Procurement approval flow routes correctly after retirement ─────
  await suite.test('19. Procurement approval flow routes correctly after retirement (targets Primary Master and Owner only)', async () => {
    const notifService = new NotificationService();
    const recipients = await notifService.resolveRecipients({
      organisationId: ORG_ID,
      recipientRoles: ['MASTER', 'OWNER'],
    });

    // All recipients with role MASTER must have isPrimaryMaster: true
    for (const r of recipients) {
      if (r.role === 'MASTER') {
        assert.equal(r.isPrimaryMaster, true, 'Recipients with role MASTER must be Primary Master');
        assert.notEqual(r.userId, 'MU-0002', 'Retired Normal Master must never be a notification recipient');
      }
    }
  });

  // ── TEST 20: Notifications no longer target retired Normal Master accounts ────
  await suite.test('20. Notifications no longer target retired Normal Master accounts (targetUserIds filters out retired Master)', async () => {
    const notifService = new NotificationService();
    const recipients = await notifService.resolveRecipients({
      organisationId: ORG_ID,
      targetUserIds: ['MU-0001', 'MU-0002'],
    });

    assert(recipients.some((r) => r.userId === 'MU-0001'), 'Primary Master must be included');
    assert(!recipients.some((r) => r.userId === 'MU-0002'), 'Retired Normal Master must be excluded from recipients');
  });

  // ── TEST 21: Native clients contain no Normal Master role route ───────────────
  await suite.test('21. Native clients contain no Normal Master role route', () => {
    // NAVIGATION object must have the 5 approved Five-Window Foundation personas:
    // Primary Master (MASTER), Owner (OWNER), Cafe Operations (CAFE_ADMIN),
    // Staff (STAFF), Vendor Partner (VENDOR). Normal Master is retired.
    const APPROVED_ROLES = [ROLES.MASTER, ROLES.OWNER, ROLES.CAFE_ADMIN, ROLES.STAFF, 'vendor'].sort();
    const activeRoles = Object.keys(NAVIGATION).sort();
    for (const role of activeRoles) {
      assert(APPROVED_ROLES.includes(role), `Unexpected role in navigation: ${role}`);
    }
    assert(activeRoles.includes(ROLES.MASTER), 'Primary Master must be present');
    assert(activeRoles.includes(ROLES.OWNER), 'Owner must be present');
    assert(activeRoles.includes(ROLES.CAFE_ADMIN), 'Cafe Operations must be present');
    assert(activeRoles.includes(ROLES.STAFF), 'Staff must be present');
    assert(!activeRoles.includes('MASTER_NORMAL'), 'Normal Master must not appear');
    assert(!activeRoles.includes('NORMAL_MASTER'), 'Normal Master must not appear');
  });

  // ── TEST 22: Service-worker upgrade removes obsolete Normal Master UI caches ─
  await suite.test('22. Service-worker upgrade cache configuration', () => {
    const fs = require('fs');
    const path = require('path');
    const swContent = fs.readFileSync(path.resolve(__dirname, '../../Frontend/sw.js'), 'utf8');

    assert(swContent.includes('zamorin-pwa-v2.9.0-topology'), 'Service worker must specify upgraded cache version');
    assert(swContent.includes('caches.delete(key)'), 'Service worker must prune previous caches on activation');
  });

  // ── TEST 23: Database migration execution verification ────────────────────────
  await suite.test('23. Migration script retireNormalMasterAccounts runs and deactivates legacy accounts', async () => {
    const report = await retireNormalMasterAccounts(mongoose);

    assert(report.totalFound >= 1, 'Should find at least the test legacy account');
    assert(report.accountsDisabled >= 1, 'Should disable legacy accounts');

    // Verify user in DB is now DISABLED with statusReason ROLE_RETIRED_NORMAL_MASTER
    const migratedUser = await mongoose.connection.db.collection('users').findOne({ userId: 'MU-0002' });
    assert.equal(migratedUser.accountStatus, 'DISABLED');
    assert.equal(migratedUser.statusReason, 'ROLE_RETIRED_NORMAL_MASTER');
  });
});
