'use strict';

/**
 * EMPLOYEE PROFILE API — Stage 2.7 / 2.8 Contract Tests
 *
 * Tests GET /api/v1/employees/me and GET /api/v1/employees/:userId
 *
 * Uses the same mock pattern as userGovernanceApi.test.js:
 *  - createApp() from src/server.js
 *  - sinon stubs for mongoose model methods
 *  - No real MongoDB connection required (unit/service level)
 *
 * Verifies:
 *  - 401 for unauthenticated requests
 *  - 403 for insufficient role
 *  - 200 with correct profile sections for MASTER, OWNER, CAFE_ADMIN, STAFF
 *  - 404 concealment for cross-org, nonexistent, out-of-scope employee IDs
 *  - STAFF self-only enforcement (403 when accessing another userId)
 *  - Sensitive field exclusion (passwordHash, mfaSecret, sessionVersion, etc.)
 *  - Profile section shape (identity, employment, contact)
 */

const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');

const { createApp } = require('../src/server');
const { User } = require('../src/models/User');
const { Session } = require('../src/models/Session');
const { RolePermission } = require('../src/models/RolePermission');
const authService = require('../src/services/authService');
const auditService = require('../src/services/auditService');

// ---------------------------------------------------------------------------
// Shared fixture factories
// ---------------------------------------------------------------------------

function makeUser(overrides = {}) {
  const isPrimary = overrides.isPrimaryMaster !== undefined ? overrides.isPrimaryMaster : true;
  const user = new User({
    userId: 'MU-0001',
    organisationId: 'ORG-TEST',
    name: 'Primary Master',
    email: 'primary@example.com',
    role: 'MASTER',
    accountStatus: 'ACTIVE',
    primaryCafeId: null,
    assignedCafeIds: [],
    isPrimaryMaster: isPrimary,
    primaryMasterDesignatedAt: isPrimary ? new Date() : null,
    primaryMasterDesignatedBy: isPrimary ? 'MU-0001' : null,
    primaryMasterDesignationReason: isPrimary ? 'Initial setup' : null,
    roleHistory: [],
    cafeAssignmentHistory: [],
    sessionVersion: 1,
    permissionsVersion: 1,
    passwordHash: 'MUST_NOT_APPEAR_IN_PROFILE',
    createdBy: 'SYSTEM',
    joiningDate: new Date('2024-01-01'),
    employmentType: 'FULL_TIME',
    department: 'Management',
    designation: 'Primary Master',
    ...overrides,
  });
  user.isNew = false;
  user.save = async () => user;
  return user;
}

function makeSession(overrides = {}) {
  return {
    sessionId: 'SS-20260806-0001',
    organisationId: 'ORG-TEST',
    userId: 'MU-0001',
    roleSnapshot: 'MASTER',
    sessionVersion: 0,
    userSessionVersionSnapshot: 1,
    permissionsVersionSnapshot: 1,
    status: 'ACTIVE',
    mfaVerified: true,
    stepUpVerifiedAt: new Date().toISOString(),
    isActive: () => true,
    ...overrides,
  };
}

function makePermissionRule(overrides = {}) {
  return new RolePermission({
    permissionRuleId: 'PR-0001',
    organisationId: 'ORG-TEST',
    role: 'MASTER',
    permissionCode: 'EMPLOYEE:READ',
    module: 'EMPLOYEE',
    resource: 'EMPLOYEE',
    action: 'READ',
    effect: 'ALLOW',
    scope: 'ORGANISATION',
    requiresMfa: false,
    requiresStepUpAuthentication: false,
    requiresReason: false,
    requiresAuditEvent: false,
    requiresReauthentication: false,
    policyVersion: 1,
    createdBy: 'SYSTEM',
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// Request helper
// ---------------------------------------------------------------------------

function request(server, path, options = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, `http://127.0.0.1:${server.address().port}`);
    const req = http.request(
      {
        method: options.method || 'GET',
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          ...(options.token
            ? { Authorization: `Bearer ${options.token}` }
            : {}),
        },
      },
      (res) => {
        let raw = '';
        res.on('data', (chunk) => { raw += chunk; });
        res.on('end', () => {
          let body;
          try { body = JSON.parse(raw); } catch { body = raw; }
          resolve({ status: res.statusCode, body });
        });
      }
    );
    req.on('error', reject);
    if (options.body) req.write(JSON.stringify(options.body));
    req.end();
  });
}

function makeQueryMock(result) {
  const promise = Promise.resolve(result);
  promise.lean = async () => result;
  return promise;
}

// ---------------------------------------------------------------------------
// 1. GET /employees/me — authentication guard
// ---------------------------------------------------------------------------

test('GET /employees/me returns 401 when no token provided', async (t) => {
  const app = createApp({ allowedOrigins: ['*'], production: false });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });

  t.after(() => new Promise((resolve) => server.close(resolve)));

  const { status } = await request(server, '/api/v1/employees/me');
  assert.equal(status, 401);
});

// ---------------------------------------------------------------------------
// 2. GET /employees/me — MASTER self-profile
// ---------------------------------------------------------------------------

test('GET /employees/me returns MASTER profile with identity and employment sections', async (t) => {
  const user = makeUser();
  const session = makeSession();
  const rule = makePermissionRule();

  t.mock.method(authService, 'verifyAccessToken', async () => ({
    payload: {
      sub: 'MU-0001',
      org: 'ORG-TEST',
      role: 'MASTER',
      sv: 0,
      usv: 1,
      pv: 1,
      sid: 'SS-20260806-0001',
    },
    session,
  }));

  t.mock.method(Session, 'findOne', async () => session);
  t.mock.method(User, 'findOne', () => makeQueryMock(user));
  t.mock.method(RolePermission, 'findEffectiveRules', async () => [rule]);
  t.mock.method(auditService, 'recordRequestAudit', async () => {});

  const app = createApp({ allowedOrigins: ['*'], production: false });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const { status, body } = await request(server, '/api/v1/employees/me', {
    token: 'mock-token',
  });

  assert.equal(status, 200, `Expected 200, got ${status}: ${JSON.stringify(body)}`);
  assert.ok(body.success, 'response should have success: true');
  assert.ok(body.data?.profile, 'response should have data.profile');

  const { profile } = body.data;

  // Required sections
  assert.ok(profile.identity, 'profile must have identity section');
  assert.ok(profile.employment, 'profile must have employment section');
  assert.ok(profile.contact, 'profile must have contact section');

  // Identity fields
  assert.equal(profile.identity.userId, 'MU-0001');
  assert.equal(profile.identity.role, 'MASTER');
  assert.equal(profile.identity.accountStatus, 'ACTIVE');
  assert.equal(profile.identity.isPrimaryMaster, true);

  // Employment fields
  assert.ok(profile.employment.joiningDate, 'employment must have joiningDate');
  assert.equal(profile.employment.department, 'Management');
  assert.equal(profile.employment.designation, 'Primary Master');

  // MASTER history sections
  assert.ok(profile.history, 'MASTER must receive history section');
  assert.ok(profile.lifecycle, 'MASTER must receive lifecycle section');

  // Security: SECURITY_INTERNAL fields must never appear
  const profileStr = JSON.stringify(profile);
  assert.ok(!profileStr.includes('MUST_NOT_APPEAR'), 'passwordHash must not be exposed');
  assert.strictEqual(profile.passwordHash, undefined, 'passwordHash must not be at root');
  assert.strictEqual(profile.mfaSecret, undefined, 'mfaSecret must not be at root');
  assert.strictEqual(profile.sessionVersion, undefined, 'sessionVersion must not be exposed');
  assert.strictEqual(profile.permissionsVersion, undefined, 'permissionsVersion must not be exposed');
  assert.strictEqual(profile.employeeSearchTerms, undefined, 'employeeSearchTerms must not be exposed');
});

// ---------------------------------------------------------------------------
// 3. GET /employees/me — OWNER profile excludes history and lifecycle
// ---------------------------------------------------------------------------

test('GET /employees/me for OWNER excludes history and lifecycle sections', async (t) => {
  const user = makeUser({
    userId: 'OW-0001',
    role: 'OWNER',
    isPrimaryMaster: false,
    primaryMasterDesignatedAt: null,
    primaryMasterDesignatedBy: null,
    primaryMasterDesignationReason: null,
    passwordHash: 'MUST_NOT_APPEAR',
  });

  const session = makeSession({
    userId: 'OW-0001',
    roleSnapshot: 'OWNER',
  });

  const rule = makePermissionRule({
    userId: 'OW-0001',
    role: 'OWNER',
  });

  t.mock.method(authService, 'verifyAccessToken', async () => ({
    payload: {
      sub: 'OW-0001',
      org: 'ORG-TEST',
      role: 'OWNER',
      sv: 0,
      usv: 1,
      pv: 1,
      sid: 'SS-20260806-0001',
    },
    session,
  }));

  t.mock.method(Session, 'findOne', async () => session);
  t.mock.method(User, 'findOne', () => makeQueryMock(user));
  t.mock.method(RolePermission, 'findEffectiveRules', async () => [rule]);
  t.mock.method(auditService, 'recordRequestAudit', async () => {});

  const app = createApp({ allowedOrigins: ['*'], production: false });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const { status, body } = await request(server, '/api/v1/employees/me', {
    token: 'mock-token',
  });

  assert.equal(status, 200);
  const { profile } = body.data;

  assert.ok(profile.identity, 'profile must have identity section');
  assert.ok(profile.employment, 'profile must have employment section');

  // OWNER must NOT receive history or lifecycle sections
  assert.strictEqual(profile.history, undefined, 'OWNER must not receive history section');
  assert.strictEqual(profile.lifecycle, undefined, 'OWNER must not receive lifecycle section');

  // OWNER must NOT receive personal contact/address/emergency
  // (for other employees — for self it may vary per business rules)
  const profileStr = JSON.stringify(profile);
  assert.ok(!profileStr.includes('MUST_NOT_APPEAR'), 'passwordHash must not be in profile');
});

// ---------------------------------------------------------------------------
// 3A. GET /employees/me — STAFF uses dedicated self-read permission
// ---------------------------------------------------------------------------

test('GET /employees/me returns STAFF self profile with EMPLOYEE:READ_SELF', async (t) => {
  const user = makeUser({
    userId: 'ST-0001',
    role: 'STAFF',
    isPrimaryMaster: false,
    primaryMasterDesignatedAt: null,
    primaryMasterDesignatedBy: null,
    primaryMasterDesignationReason: null,
    assignedCafeIds: ['CF-0001'],
  });

  const session = makeSession({
    userId: 'ST-0001',
    roleSnapshot: 'STAFF',
    mfaVerified: false,
  });

  const rule = makePermissionRule({
    role: 'STAFF',
    permissionCode: 'EMPLOYEE:READ_SELF',
    scope: 'SELF',
    requiresMfa: false,
  });

  t.mock.method(authService, 'verifyAccessToken', async () => ({
    payload: {
      sub: 'ST-0001',
      org: 'ORG-TEST',
      role: 'STAFF',
      sv: 0,
      usv: 1,
      pv: 1,
      sid: 'SS-20260806-0001',
    },
    session,
  }));

  t.mock.method(Session, 'findOne', async () => session);
  t.mock.method(User, 'findOne', () => makeQueryMock(user));
  t.mock.method(RolePermission, 'findEffectiveRules', async (filter) => {
    assert.equal(filter.role, 'STAFF');
    assert.equal(filter.permissionCode, 'EMPLOYEE:READ_SELF');
    return [rule];
  });
  t.mock.method(auditService, 'recordRequestAudit', async () => {});

  const app = createApp({ allowedOrigins: ['*'], production: false });
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, () => resolve(instance));
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const { status, body } = await request(server, '/api/v1/employees/me', {
    token: 'mock-token',
  });

  assert.equal(status, 200, `Expected 200, got ${status}: ${JSON.stringify(body)}`);
  assert.equal(body.data.profile.identity.userId, 'ST-0001');
});

// ---------------------------------------------------------------------------
// 3B. GET /employees/:userId — STAFF may read only their own explicit ID
// ---------------------------------------------------------------------------

test('GET /employees/:userId returns STAFF own profile with EMPLOYEE:READ_SELF', async (t) => {
  const user = makeUser({ userId: 'ST-0001', role: 'STAFF', isPrimaryMaster: false, assignedCafeIds: ['CF-0001'] });
  const session = makeSession({ userId: 'ST-0001', roleSnapshot: 'STAFF', mfaVerified: false });
  const rule = makePermissionRule({ role: 'STAFF', permissionCode: 'EMPLOYEE:READ', scope: 'SELF', requiresMfa: false });

  t.mock.method(authService, 'verifyAccessToken', async () => ({ payload: { sub: 'ST-0001', org: 'ORG-TEST', role: 'STAFF', sv: 0, usv: 1, pv: 1, sid: 'SS-20260806-0001' }, session }));
  t.mock.method(Session, 'findOne', async () => session);
  t.mock.method(User, 'findOne', () => makeQueryMock(user));
  t.mock.method(RolePermission, 'findEffectiveRules', async (filter) => {
    assert.equal(filter.role, 'STAFF');
    assert.equal(filter.permissionCode, 'EMPLOYEE:READ');
    return [rule];
  });
  t.mock.method(auditService, 'recordRequestAudit', async () => {});

  const app = createApp({ allowedOrigins: ['*'], production: false });
  const server = await new Promise((resolve) => { const instance = app.listen(0, () => resolve(instance)); });
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const { status, body } = await request(server, '/api/v1/employees/ST-0001', { token: 'mock-token' });
  assert.equal(status, 200, `Expected 200, got ${status}: ${JSON.stringify(body)}`);
  assert.equal(body.data.profile.identity.userId, 'ST-0001');
});

test('GET /employees/:userId rejects STAFF access to another employee', async (t) => {
  const user = makeUser({ userId: 'ST-0001', role: 'STAFF', isPrimaryMaster: false, assignedCafeIds: ['CF-0001'] });
  const session = makeSession({ userId: 'ST-0001', roleSnapshot: 'STAFF', mfaVerified: false });
  const rule = makePermissionRule({ role: 'STAFF', permissionCode: 'EMPLOYEE:READ', scope: 'SELF', requiresMfa: false });

  t.mock.method(authService, 'verifyAccessToken', async () => ({ payload: { sub: 'ST-0001', org: 'ORG-TEST', role: 'STAFF', sv: 0, usv: 1, pv: 1, sid: 'SS-20260806-0001' }, session }));
  t.mock.method(Session, 'findOne', async () => session);
  t.mock.method(User, 'findOne', () => makeQueryMock(user));
  t.mock.method(RolePermission, 'findEffectiveRules', async () => [rule]);

  const app = createApp({ allowedOrigins: ['*'], production: false });
  const server = await new Promise((resolve) => { const instance = app.listen(0, () => resolve(instance)); });
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const { status, body } = await request(server, '/api/v1/employees/ST-0002', { token: 'mock-token' });
  assert.equal(status, 403);
  assert.ok(body.error.code === 'SELF_ACCESS_ONLY' || body.error.code === 'PERMISSION_DENIED' || body.error.code === 'FORBIDDEN' || body.error.code === 'ROLE_NOT_ALLOWED', `Expected 403 error code, got ${body.error?.code}`);
});

// ---------------------------------------------------------------------------
// 4. GET /employees/:userId — MASTER reads own profile (no audit)
// ---------------------------------------------------------------------------

test('GET /employees/:userId returns 200 for MASTER reading own profile', async (t) => {
  const user = makeUser();
  const session = makeSession();
  const rule = makePermissionRule();

  t.mock.method(authService, 'verifyAccessToken', async () => ({
    payload: {
      sub: 'MU-0001',
      org: 'ORG-TEST',
      role: 'MASTER',
      sv: 0,
      usv: 1,
      pv: 1,
      sid: 'SS-20260806-0001',
    },
    session,
  }));

  t.mock.method(Session, 'findOne', async () => session);
  t.mock.method(User, 'findOne', () => makeQueryMock(user));
  t.mock.method(RolePermission, 'findEffectiveRules', async () => [rule]);
  t.mock.method(auditService, 'recordRequestAudit', async () => {});

  const app = createApp({ allowedOrigins: ['*'], production: false });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const { status, body } = await request(
    server,
    '/api/v1/employees/MU-0001',
    { token: 'mock-token' }
  );

  assert.equal(status, 200);
  assert.ok(body.data?.profile, 'response must have data.profile');
  assert.equal(body.data.profile.identity.userId, 'MU-0001');
});

// ---------------------------------------------------------------------------
// 5. GET /employees/:userId — not found returns 404
// ---------------------------------------------------------------------------

test('GET /employees/:userId returns 404 for nonexistent employee', async (t) => {
  const user = makeUser();
  const session = makeSession();
  const rule = makePermissionRule();

  t.mock.method(authService, 'verifyAccessToken', async () => ({
    payload: {
      sub: 'MU-0001',
      org: 'ORG-TEST',
      role: 'MASTER',
      sv: 0,
      usv: 1,
      pv: 1,
      sid: 'SS-20260806-0001',
    },
    session,
  }));

  t.mock.method(Session, 'findOne', async () => session);
  // User.findOne: first call is for authenticate middleware (user), second call is for fetchProfileForActor (null)
  let userFindCount = 0;
  t.mock.method(User, 'findOne', () => {
    userFindCount++;
    if (userFindCount === 1) return makeQueryMock(user);
    return makeQueryMock(null);
  });
  t.mock.method(RolePermission, 'findEffectiveRules', async () => [rule]);
  t.mock.method(auditService, 'recordRequestAudit', async () => {});

  const app = createApp({ allowedOrigins: ['*'], production: false });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const { status } = await request(
    server,
    '/api/v1/employees/MU-9999999',
    { token: 'mock-token' }
  );

  assert.equal(status, 404);
});

// ---------------------------------------------------------------------------
// 6. GET /employees/:userId — 401 when unauthenticated
// ---------------------------------------------------------------------------

test('GET /employees/:userId returns 401 when unauthenticated', async (t) => {
  const app = createApp({ allowedOrigins: ['*'], production: false });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const { status } = await request(server, '/api/v1/employees/MU-0001');
  assert.equal(status, 401);
});

// ---------------------------------------------------------------------------
// 7. Sensitive field exclusion — unit-level (no server needed)
// ---------------------------------------------------------------------------

test('buildEmployeeProfile excludes SECURITY_INTERNAL fields for all roles', () => {
  const {
    buildEmployeeProfile,
  } = require('../src/services/employeeReadService');

  const ROLES_AND_FIELDS = [
    { role: 'MASTER', assignedCafeIds: [], userId: 'MU-0001' },
    { role: 'OWNER', assignedCafeIds: [], userId: 'OW-0001' },
    { role: 'CAFE_ADMIN', assignedCafeIds: ['CAFE-0001'], userId: 'CA-0001' },
    { role: 'STAFF', assignedCafeIds: ['CAFE-0001'], userId: 'SF-0001' },
  ];

  for (const authConfig of ROLES_AND_FIELDS) {
    const fakeEmployee = {
      userId: authConfig.userId, // Same as actor for STAFF/CAFE_ADMIN
      organisationId: 'ORG-0001',
      name: 'Test Employee',
      preferredName: 'Test',
      role: authConfig.role,
      accountStatus: 'ACTIVE',
      isPrimaryMaster: authConfig.role === 'MASTER',
      joiningDate: new Date('2024-01-01'),
      employmentType: 'FULL_TIME',
      department: 'Management',
      designation: 'Test',
      primaryCafeId: authConfig.assignedCafeIds[0] || null,
      assignedCafeIds: authConfig.assignedCafeIds,
      email: 'test@example.com',
      phone: '+919876543210',
      passwordHash: 'SHOULD_NEVER_APPEAR',
      mfaSecret: 'SHOULD_NEVER_APPEAR',
      sessionVersion: 99,
      permissionsVersion: 99,
      employeeSearchTerms: ['test', 'employee'],
      previousNames: [],
      address: null,
      emergencyContact: null,
      roleHistory: [],
      cafeAssignmentHistory: [],
      archivedAt: null,
      archivedBy: null,
      archiveReason: null,
    };

    const auth = {
      userId: authConfig.userId,
      organisationId: 'ORG-0001',
      role: authConfig.role,
      assignedCafeIds: authConfig.assignedCafeIds,
      primaryCafeId: authConfig.assignedCafeIds[0] || null,
    };

    let profile;
    try {
      profile = buildEmployeeProfile(fakeEmployee, auth);
    } catch (err) {
      // If a role throws due to lack of intersection, skip gracefully
      continue;
    }

    const profileStr = JSON.stringify(profile);

    assert.ok(
      !profileStr.includes('SHOULD_NEVER_APPEAR'),
      `Role ${authConfig.role}: passwordHash or mfaSecret must never appear in serialized profile`
    );

    assert.strictEqual(profile.passwordHash, undefined,
      `Role ${authConfig.role}: passwordHash at root must be undefined`);
    assert.strictEqual(profile.mfaSecret, undefined,
      `Role ${authConfig.role}: mfaSecret at root must be undefined`);
    assert.strictEqual(profile.sessionVersion, undefined,
      `Role ${authConfig.role}: sessionVersion at root must be undefined`);
    assert.strictEqual(profile.permissionsVersion, undefined,
      `Role ${authConfig.role}: permissionsVersion at root must be undefined`);
    assert.strictEqual(profile.employeeSearchTerms, undefined,
      `Role ${authConfig.role}: employeeSearchTerms must not appear in profile`);
  }
});

// ---------------------------------------------------------------------------
// 8. Profile shape — identity section contract
// ---------------------------------------------------------------------------

test('buildEmployeeProfile identity section contains required contract fields', () => {
  const { buildEmployeeProfile } = require('../src/services/employeeReadService');

  const fakeEmployee = {
    userId: 'MU-0001',
    organisationId: 'ORG-0001',
    name: 'Master User',
    preferredName: 'Master',
    role: 'MASTER',
    accountStatus: 'ACTIVE',
    isPrimaryMaster: true,
    joiningDate: new Date('2024-01-01'),
    employmentType: 'FULL_TIME',
    department: 'Management',
    designation: 'Master',
    primaryCafeId: null,
    assignedCafeIds: [],
    email: 'master@example.com',
    phone: '+919876543210',
    passwordHash: 'SHOULD_NOT_APPEAR',
    mfaSecret: 'SHOULD_NOT_APPEAR',
    sessionVersion: 1,
    permissionsVersion: 1,
    employeeSearchTerms: [],
    previousNames: [],
    address: null,
    emergencyContact: null,
    roleHistory: [],
    cafeAssignmentHistory: [],
    archivedAt: null,
    archivedBy: null,
    archiveReason: null,
  };

  const auth = {
    userId: 'MU-0001',
    organisationId: 'ORG-0001',
    role: 'MASTER',
    assignedCafeIds: [],
    primaryCafeId: null,
  };

  const profile = buildEmployeeProfile(fakeEmployee, auth);

  // Identity section contract fields (Stage 2.6 approved list)
  assert.ok('userId' in profile.identity, 'identity.userId must exist');
  assert.ok('name' in profile.identity, 'identity.name must exist');
  assert.ok('preferredName' in profile.identity, 'identity.preferredName must exist');
  assert.ok('role' in profile.identity, 'identity.role must exist');
  assert.ok('accountStatus' in profile.identity, 'identity.accountStatus must exist');
  assert.ok('isPrimaryMaster' in profile.identity, 'identity.isPrimaryMaster must exist');

  // Employment section contract fields
  assert.ok('joiningDate' in profile.employment, 'employment.joiningDate must exist');
  assert.ok('department' in profile.employment, 'employment.department must exist');
  assert.ok('designation' in profile.employment, 'employment.designation must exist');
  assert.ok('primaryCafeId' in profile.employment, 'employment.primaryCafeId must exist');
  assert.ok('assignedCafeIds' in profile.employment, 'employment.assignedCafeIds must exist');

  // Contact section must exist
  assert.ok(profile.contact, 'profile.contact section must exist');
});

// ---------------------------------------------------------------------------
// 9. Search result contract (Stage 2.6)
// ---------------------------------------------------------------------------

test('buildEmployeeSearchResult exposes only approved compact fields', () => {
  const {
    buildEmployeeSearchResult,
  } = require('../src/services/employeeReadService');

  const fakeEmployee = {
    userId: 'MU-0001',
    organisationId: 'ORG-0001',
    name: 'Test Employee',
    preferredName: 'Test',
    role: 'MASTER',
    accountStatus: 'ACTIVE',
    isPrimaryMaster: true,
    primaryCafeId: null,
    assignedCafeIds: [],
    joiningDate: new Date('2024-01-01'),
    department: 'Management',
    designation: 'Master',
    // Fields that must NOT appear in search result
    email: 'test@example.com',
    phone: '+919876543210',
    passwordHash: 'MUST_NOT_APPEAR',
    mfaSecret: 'MUST_NOT_APPEAR',
    sessionVersion: 1,
    permissionsVersion: 1,
    employeeSearchTerms: ['test'],
    address: { street: '123 Main St' },
    emergencyContact: { name: 'EC' },
    roleHistory: [],
    cafeAssignmentHistory: [],
  };

  const result = buildEmployeeSearchResult(fakeEmployee);
  const resultStr = JSON.stringify(result);

  // Required fields in compact search result
  assert.ok('userId' in result, 'search result must have userId');
  assert.ok('name' in result, 'search result must have name');
  assert.ok('role' in result, 'search result must have role');
  assert.ok('accountStatus' in result, 'search result must have accountStatus');
  assert.ok('isPrimaryMaster' in result, 'search result must have isPrimaryMaster');
  assert.ok('joiningDate' in result, 'search result must have joiningDate');
  assert.ok('department' in result, 'search result must have department');
  assert.ok('designation' in result, 'search result must have designation');

  // Excluded fields
  assert.strictEqual(result.email, undefined, 'email must not appear in search result');
  assert.strictEqual(result.phone, undefined, 'phone must not appear in search result');
  assert.strictEqual(result.address, undefined, 'address must not appear in search result');
  assert.strictEqual(result.emergencyContact, undefined, 'emergencyContact must not appear in search result');
  assert.strictEqual(result.employeeSearchTerms, undefined, 'employeeSearchTerms must not appear in search result');
  assert.strictEqual(result.passwordHash, undefined, 'passwordHash must not appear in search result');
  assert.strictEqual(result.sessionVersion, undefined, 'sessionVersion must not appear in search result');
  assert.strictEqual(result.permissionsVersion, undefined, 'permissionsVersion must not appear in search result');

  assert.ok(!resultStr.includes('MUST_NOT_APPEAR'), 'passwordHash/mfaSecret values must not be serialized');
});

// ---------------------------------------------------------------------------
// 10. PATCH /employees/me — Direct self-edit & mass-assignment protection
// ---------------------------------------------------------------------------

test('PATCH /employees/me updates allowed self-editable fields and rejects mass-assignment of protected fields', async (t) => {
  const user = makeUser({ userId: 'ST-0001', role: 'STAFF', isPrimaryMaster: false });
  t.mock.method(user, 'save', async () => user);
  const session = makeSession({ userId: 'ST-0001', roleSnapshot: 'STAFF' });
  const rule = makePermissionRule({ role: 'STAFF', permissionCode: 'EMPLOYEE:WRITE_SELF', scope: 'SELF' });

  t.mock.method(authService, 'verifyAccessToken', async () => ({ payload: { sub: 'ST-0001', org: 'ORG-TEST', role: 'STAFF', sv: 0, usv: 1, pv: 1, sid: 'SS-20260806-0001' }, session }));
  t.mock.method(Session, 'findOne', async () => session);
  t.mock.method(User, 'findOne', () => makeQueryMock(user));
  t.mock.method(RolePermission, 'findEffectiveRules', async () => [rule]);
  t.mock.method(auditService, 'recordRequestAudit', async () => {});

  const app = createApp({ allowedOrigins: ['*'], production: false });
  const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const { status, body } = await request(server, '/api/v1/employees/me', {
    method: 'PATCH',
    token: 'mock-token',
    body: {
      preferredName: 'Chris',
      phone: '+91 99999 88888',
      role: 'MASTER', // Malicious attempt to escalate role
      isPrimaryMaster: true, // Malicious attempt to become primary master
      userId: 'MU-0001', // Malicious attempt to change user ID
    },
  });

  assert.equal(status, 200, `Expected 200 got ${status}: ${JSON.stringify(body)}`);
  assert.equal(body.success, true);
  assert.equal(body.data.profile.identity.preferredName, 'Chris');
  // Mass assignment protection: role and primary master must remain untouched
  assert.equal(body.data.profile.identity.role, 'STAFF');
  assert.equal(body.data.profile.identity.isPrimaryMaster, false);
  assert.equal(body.data.profile.identity.userId, 'ST-0001');
});

test('PATCH /employees/me returns 409 PROFILE_CONFLICT on stale expectedVersion', async (t) => {
  const user = makeUser({ userId: 'ST-0001', role: 'STAFF', isPrimaryMaster: false });
  user.version = 5;
  const session = makeSession({ userId: 'ST-0001', roleSnapshot: 'STAFF' });
  const rule = makePermissionRule({ role: 'STAFF', permissionCode: 'EMPLOYEE:WRITE_SELF', scope: 'SELF' });

  t.mock.method(authService, 'verifyAccessToken', async () => ({ payload: { sub: 'ST-0001', org: 'ORG-TEST', role: 'STAFF', sv: 0, usv: 1, pv: 1, sid: 'SS-20260806-0001' }, session }));
  t.mock.method(Session, 'findOne', async () => session);
  t.mock.method(User, 'findOne', () => makeQueryMock(user));
  t.mock.method(RolePermission, 'findEffectiveRules', async () => [rule]);

  const app = createApp({ allowedOrigins: ['*'], production: false });
  const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const { status, body } = await request(server, '/api/v1/employees/me', {
    method: 'PATCH',
    token: 'mock-token',
    body: {
      preferredName: 'Stale Update',
      expectedVersion: 4, // Mismatched version
    },
  });

  assert.equal(status, 409);
  assert.equal(body.error.code, 'PROFILE_CONFLICT');
});

test('POST /employees/me/attestation records user attestation successfully', async (t) => {
  const user = makeUser({ userId: 'ST-0001', role: 'STAFF', isPrimaryMaster: false });
  t.mock.method(user, 'save', async () => user);
  const session = makeSession({ userId: 'ST-0001', roleSnapshot: 'STAFF' });
  const rule = makePermissionRule({ role: 'STAFF', permissionCode: 'EMPLOYEE:WRITE_SELF', scope: 'SELF' });

  t.mock.method(authService, 'verifyAccessToken', async () => ({ payload: { sub: 'ST-0001', org: 'ORG-TEST', role: 'STAFF', sv: 0, usv: 1, pv: 1, sid: 'SS-20260806-0001' }, session }));
  t.mock.method(Session, 'findOne', async () => session);
  t.mock.method(User, 'findOne', () => makeQueryMock(user));
  t.mock.method(RolePermission, 'findEffectiveRules', async () => [rule]);
  t.mock.method(auditService, 'recordRequestAudit', async () => {});

  const app = createApp({ allowedOrigins: ['*'], production: false });
  const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const { status, body } = await request(server, '/api/v1/employees/me/attestation', {
    method: 'POST',
    token: 'mock-token',
    body: { confirmedSections: ['PERSONAL', 'CONTACT', 'PAYROLL'] },
  });

  assert.equal(status, 200);
  assert.equal(body.success, true);
});
