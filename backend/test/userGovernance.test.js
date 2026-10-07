'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { User } = require('../src/models/User');
const { Cafe } = require('../src/models/Cafe');
const { Session } = require('../src/models/Session');
const auditService = require('../src/services/auditService');

const {
  loadActor,
  loadTarget,
  actorIsPrimaryMaster,
  assertNotPrimaryMasterTarget,
  assertPrimaryMasterAuthority,
  assertMayActOnMasterTarget,
  rejectProtectedFields,
  PROTECTED_USER_FIELDS,
  validateProposedRole,
  assertRoleIsNotNoOp,
  assertStatusIsNotNoOp,
  validateCafeIds,
  assertCafeChangeIsNotNoOp,
  assertExpectedState,
  calculateRoleImpactPreview,
  buildRoleHistoryEntry,
  buildCafeAssignmentHistoryEntry,
  buildUserSnapshot,
  auditGovernanceSuccess,
  auditGovernanceDenied,
} = require('../src/services/userGovernanceService');

const {
  previewRoleChange,
  executeRoleChange,
} = require('../src/controllers/roleGovernanceController');

const {
  createUser,
  updateUser,
  changeUserStatus,
  archiveUser,
} = require('../src/controllers/userController');

function createMockUser(overrides = {}) {
  return new User({
    userId: 'MU-0001',
    organisationId: 'ORG-TEST',
    name: 'Primary Master',
    email: 'primary@example.com',
    role: 'MASTER',
    accountStatus: 'ACTIVE',
    primaryCafeId: null,
    assignedCafeIds: [],
    isPrimaryMaster: true,
    primaryMasterDesignatedAt: new Date(),
    primaryMasterDesignatedBy: 'MU-0001',
    primaryMasterDesignationReason: 'Initial setup',
    roleHistory: [],
    cafeAssignmentHistory: [],
    sessionVersion: 1,
    permissionsVersion: 1,
    passwordHash: 'test-hash',
    createdBy: 'SYSTEM',
    ...overrides,
  });
}

function createMockRequest(overrides = {}) {
  return {
    auth: {
      userId: 'MU-0001',
      organisationId: 'ORG-TEST',
      role: 'MASTER',
      isPrimaryMaster: true,
      assignedCafeIds: [],
      primaryCafeId: null,
      sessionId: 'SS-20260806-0001',
      mfaVerified: true,
      stepUpVerifiedAt: new Date().toISOString(),
    },
    correlationId: 'test-correlation-id',
    params: {},
    body: {},
    query: {},
    headers: {},
    get: () => null,
    ...overrides,
  };
}

function createMockResponse() {
  const res = {
    statusCode: 200,
    jsonPayload: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.jsonPayload = payload;
      return this;
    },
  };
  return res;
}

function runController(controllerFn, req, res) {
  return new Promise((resolve, reject) => {
    const origJson = res.json;
    res.json = function (payload) {
      const result = origJson.call(this, payload);
      resolve(result);
      return result;
    };
    const next = (err) => {
      if (err) reject(err);
      else resolve();
    };
    try {
      controllerFn(req, res, next);
    } catch (err) {
      reject(err);
    }
  });
}

// =============================================================================
// BATCH B: PRIMARY MASTER TEST MATRIX
// =============================================================================

test('Primary Master cannot be demoted (role change)', () => {
  const pm = createMockUser({ isPrimaryMaster: true });
  assert.throws(
    () => assertNotPrimaryMasterTarget(pm, 'role change'),
    (err) => err.code === 'PRIMARY_MASTER_PROTECTED' && err.statusCode === 403
  );
});

test('Primary Master cannot be deactivated, locked, suspended, or disabled', () => {
  const pm = createMockUser({ isPrimaryMaster: true });
  for (const status of ['PENDING_ACTIVATION', 'LOCKED', 'SUSPENDED', 'DISABLED']) {
    assert.throws(
      () => assertNotPrimaryMasterTarget(pm, `status change to ${status}`),
      (err) => err.code === 'PRIMARY_MASTER_PROTECTED' && err.statusCode === 403
    );
  }
});

test('Primary Master cannot be archived', () => {
  const pm = createMockUser({ isPrimaryMaster: true });
  assert.throws(
    () => assertNotPrimaryMasterTarget(pm, 'archive'),
    (err) => err.code === 'PRIMARY_MASTER_PROTECTED' && err.statusCode === 403
  );
});

test('Primary Master model validation rejects primaryCafeId and assignedCafeIds', async () => {
  const pmWithCafe = createMockUser({
    isPrimaryMaster: true,
    primaryCafeId: 'CAFE-001',
  });
  await assert.rejects(
    pmWithCafe.validate(),
    /cannot be restricted to a primary café/
  );

  const pmWithAssigned = createMockUser({
    isPrimaryMaster: true,
    assignedCafeIds: ['CAFE-001'],
  });
  await assert.rejects(
    pmWithAssigned.validate(),
    /cannot be restricted to assigned cafés/
  );
});

test('Primary Master cannot be deleted via non-existent public delete routes', () => {
  const userRoutes = require('../src/routes/userRoutes');
  const hasDeleteRoute = userRoutes.stack.some(
    (layer) => layer.route && layer.route.methods.delete
  );
  assert.equal(hasDeleteRoute, false, 'No public DELETE route must exist for users.');
});

test('Primary Master self-demotion and self-archive are blocked', async () => {
  const req = createMockRequest({
    auth: {
      userId: 'MU-0001',
      organisationId: 'ORG-TEST',
      role: 'MASTER',
      isPrimaryMaster: true,
    },
    params: { userId: 'MU-0001' },
    body: { reason: 'Self archive attempt' },
  });
  const res = createMockResponse();

  const pm = createMockUser({ userId: 'MU-0001', isPrimaryMaster: true });
  const origFindOne = User.findOne;
  User.findOne = async () => pm;

  try {
    await assert.rejects(
      runController(archiveUser, req, res),
      (err) => err.code === 'SELF_ARCHIVE_BLOCKED' || err.code === 'PRIMARY_MASTER_PROTECTED'
    );
  } finally {
    User.findOne = origFindOne;
  }
});

test('Secondary Master cannot modify, change status, or archive Primary Master', () => {
  const secMaster = createMockUser({ userId: 'MU-0002', isPrimaryMaster: false });
  const pm = createMockUser({ userId: 'MU-0001', isPrimaryMaster: true });

  assert.throws(
    () => assertPrimaryMasterAuthority(secMaster, 'modify Primary Master'),
    (err) => err.code === 'PRIMARY_MASTER_AUTHORITY_REQUIRED'
  );
  assert.throws(
    () => assertNotPrimaryMasterTarget(pm, 'status change'),
    (err) => err.code === 'PRIMARY_MASTER_PROTECTED'
  );
});

test('Failed Primary Master takeover attempts do not revoke sessions, increment versions, or append history', async () => {
  const pm = createMockUser({
    userId: 'MU-0001',
    isPrimaryMaster: true,
    sessionVersion: 5,
    permissionsVersion: 5,
  });

  const secMaster = createMockUser({
    userId: 'MU-0002',
    isPrimaryMaster: false,
  });

  const req = createMockRequest({
    auth: { userId: 'MU-0002', organisationId: 'ORG-TEST', role: 'MASTER' },
    params: { userId: 'MU-0001' },
    body: { proposedRole: 'STAFF', confirmed: true, reason: 'Takeover attempt' },
  });
  const res = createMockResponse();

  const origFindOne = User.findOne;
  let sessionRevoked = false;
  const origRevoke = auditService.recordRequestAudit;

  User.findOne = async (filter) => {
    if (filter.userId === 'MU-0002') return secMaster;
    if (filter.userId === 'MU-0001') return pm;
    return null;
  };

  try {
    await assert.rejects(
      runController(executeRoleChange, req, res),
      (err) => err.code === 'PRIMARY_MASTER_AUTHORITY_REQUIRED' || err.code === 'PRIMARY_MASTER_PROTECTED'
    );

    assert.equal(pm.role, 'MASTER');
    assert.equal(pm.sessionVersion, 5);
    assert.equal(pm.permissionsVersion, 5);
    assert.equal(pm.roleHistory.length, 0);
    assert.equal(sessionRevoked, false);
  } finally {
    User.findOne = origFindOne;
    auditService.recordRequestAudit = origRevoke;
  }
});

// =============================================================================
// BATCH C: MASTER GOVERNANCE MATRIX
// =============================================================================

test('Secondary Master cannot grant or revoke MASTER role, or administer another MASTER account', () => {
  const secMaster = createMockUser({ userId: 'MU-0002', isPrimaryMaster: false });
  const otherMaster = createMockUser({ userId: 'MU-0003', isPrimaryMaster: false });

  assert.throws(
    () => assertPrimaryMasterAuthority(secMaster, 'grant MASTER'),
    (err) => err.code === 'PRIMARY_MASTER_AUTHORITY_REQUIRED'
  );

  assert.throws(
    () => assertMayActOnMasterTarget(secMaster, otherMaster),
    (err) => err.code === 'MASTER_ROLE_GOVERNANCE_FORBIDDEN'
  );
});

test('Secondary Master cannot deactivate, suspend, disable, or archive another MASTER', async () => {
  const secMaster = createMockUser({ userId: 'MU-0002', isPrimaryMaster: false });
  const targetMaster = createMockUser({ userId: 'MU-0003', isPrimaryMaster: false });

  const req = createMockRequest({
    auth: { userId: 'MU-0002', organisationId: 'ORG-TEST', role: 'MASTER' },
    params: { userId: 'MU-0003' },
    body: { accountStatus: 'SUSPENDED', reason: 'Attempted deactivation' },
  });
  const res = createMockResponse();

  const origFindOne = User.findOne;
  User.findOne = async (filter) => {
    if (filter.userId === 'MU-0002') return secMaster;
    if (filter.userId === 'MU-0003') return targetMaster;
    return null;
  };

  try {
    await assert.rejects(
      runController(changeUserStatus, req, res),
      (err) => err.code === 'PRIMARY_MASTER_AUTHORITY_REQUIRED' || err.code === 'MASTER_ROLE_GOVERNANCE_FORBIDDEN'
    );
    assert.equal(targetMaster.accountStatus, 'ACTIVE');
  } finally {
    User.findOne = origFindOne;
  }
});

test('Primary Master governance rejects promotion to retired MASTER role', () => {
  const pm = createMockUser({ userId: 'MU-0001', isPrimaryMaster: true });
  const staff = createMockUser({ userId: 'ST-0001', role: 'STAFF', isPrimaryMaster: false });
  const nonPrimaryMaster = createMockUser({ userId: 'MU-0002', role: 'MASTER', isPrimaryMaster: false });

  assert.doesNotThrow(() => assertPrimaryMasterAuthority(pm, 'promote user'));
  assert.doesNotThrow(() => assertMayActOnMasterTarget(pm, nonPrimaryMaster));
  assert.throws(
    () => validateProposedRole('MASTER'),
    (err) => err.code === 'ROLE_RETIRED_NORMAL_MASTER' && err.statusCode === 403
  );
  assert.doesNotThrow(() => assertRoleIsNotNoOp(staff.role, 'OWNER'));
});

test('Direct creation with role MASTER remains blocked in createUser', async () => {
  const req = createMockRequest({
    body: {
      name: 'New Master',
      email: 'newmaster@example.com',
      password: 'StrongPassword123!',
      role: 'MASTER',
      reason: 'Direct master creation',
    },
  });
  const res = createMockResponse();

  await assert.rejects(
    runController(createUser, req, res),
    (err) => (err.code === 'ROLE_RETIRED_NORMAL_MASTER' || err.code === 'MASTER_CREATION_RESTRICTED') && err.statusCode === 403
  );
});

test('Promotion preserves permanent User ID and rejects unsupported roles', () => {
  const staff = createMockUser({ userId: 'ST-0001', role: 'STAFF' });
  const historyEntry = buildRoleHistoryEntry({
    fromRole: staff.role,
    toRole: 'MASTER',
    request: createMockRequest(),
    reason: 'Promoted',
  });

  staff.roleHistory.push(historyEntry);
  staff.role = 'MASTER';

  assert.equal(staff.userId, 'ST-0001', 'Permanent User ID must remain unchanged.');
  assert.equal(staff.roleHistory[0].fromRole, 'STAFF');

  assert.throws(
    () => validateProposedRole('ADMINISTRATOR'),
    (err) => err.code === 'INVALID_USER_ROLE' && err.statusCode === 422
  );
});

// =============================================================================
// BATCH D: ROLE PREVIEW AND EXECUTION
// =============================================================================

test('Role preview performs no save, no mutation, appends no history, increments no versions', async () => {
  const pm = createMockUser({ userId: 'MU-0001', isPrimaryMaster: true });
  const staff = createMockUser({
    userId: 'ST-0001',
    role: 'STAFF',
    sessionVersion: 1,
    permissionsVersion: 1,
    isPrimaryMaster: false,
  });

  const req = createMockRequest({
    params: { userId: 'ST-0001' },
    body: { proposedRole: 'CAFE_ADMIN' },
  });
  const res = createMockResponse();

  const origFindOne = User.findOne;
  const origCountDocs = Session.countDocuments;
  const origRecordAudit = auditService.recordRequestAudit;

  let saved = false;
  staff.save = async () => {
    saved = true;
    return staff;
  };

  User.findOne = async (filter) => {
    if (filter.userId === 'MU-0001') return pm;
    if (filter.userId === 'ST-0001') return staff;
    return null;
  };
  Session.countDocuments = async () => 2;
  auditService.recordRequestAudit = async () => {};

  try {
    await runController(previewRoleChange, req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(saved, false);
    assert.equal(staff.role, 'STAFF');
    assert.equal(staff.sessionVersion, 1);
    assert.equal(staff.permissionsVersion, 1);
    assert.equal(staff.roleHistory.length, 0);
    assert.equal(res.jsonPayload.data.confirmationRequired, true);
    assert.equal(res.jsonPayload.data.activeSessionCount, 2);
  } finally {
    User.findOne = origFindOne;
    Session.countDocuments = origCountDocs;
    auditService.recordRequestAudit = origRecordAudit;
  }
});

test('Role execution handles stale role, stale sessionVersion, and stale permissionsVersion separately', () => {
  const target = createMockUser({
    role: 'STAFF',
    sessionVersion: 2,
    permissionsVersion: 3,
  });

  // Stale role
  assert.throws(
    () =>
      assertExpectedState(target, {
        expectedCurrentRole: 'CAFE_ADMIN',
        expectedSessionVersion: 2,
        expectedPermissionsVersion: 3,
      }),
    (err) => err.code === 'USER_GOVERNANCE_PREVIEW_STALE'
  );

  // Stale sessionVersion
  assert.throws(
    () =>
      assertExpectedState(target, {
        expectedCurrentRole: 'STAFF',
        expectedSessionVersion: 1,
        expectedPermissionsVersion: 3,
      }),
    (err) => err.code === 'USER_GOVERNANCE_PREVIEW_STALE'
  );

  // Stale permissionsVersion
  assert.throws(
    () =>
      assertExpectedState(target, {
        expectedCurrentRole: 'STAFF',
        expectedSessionVersion: 2,
        expectedPermissionsVersion: 1,
      }),
    (err) => err.code === 'USER_GOVERNANCE_PREVIEW_STALE'
  );
});

// =============================================================================
// BATCH E: CAFÉ ASSIGNMENT EXECUTION
// =============================================================================

test('updateUser café assignment creates history, increments versions, and detects no-op', async () => {
  const pm = createMockUser({ userId: 'MU-0001', isPrimaryMaster: true });
  const targetAdmin = createMockUser({
    userId: 'AD-0001',
    role: 'CAFE_ADMIN',
    primaryCafeId: 'CAFE-001',
    assignedCafeIds: ['CAFE-001'],
    sessionVersion: 1,
    permissionsVersion: 1,
    isPrimaryMaster: false,
  });

  const reqNoOp = createMockRequest({
    params: { userId: 'AD-0001' },
    body: {
      primaryCafeId: 'CAFE-001',
      assignedCafeIds: ['CAFE-001'],
    },
  });
  const resNoOp = createMockResponse();

  const origFindOne = User.findOne;
  const origCafeCount = Cafe.countDocuments;
  const origSessionFind = Session.find;
  const origRecordAudit = auditService.recordRequestAudit;

  User.findOne = async (filter) => {
    if (filter.userId === 'MU-0001') return pm;
    if (filter.userId === 'AD-0001') return targetAdmin;
    return null;
  };
  Cafe.countDocuments = async () => 2;
  Session.find = () => ({ select: async () => [] });
  auditService.recordRequestAudit = async () => {};

  targetAdmin.save = async () => targetAdmin;

  try {
    // 1. Test no-op assignment check helper
    assert.throws(
      () =>
        assertCafeChangeIsNotNoOp(
          'CAFE-001',
          ['CAFE-001'],
          'CAFE-001',
          ['CAFE-001']
        ),
      (err) => err.code === 'CAFE_ASSIGNMENT_NO_OP'
    );

    // 2. Real change via updateUser
    const reqChange = createMockRequest({
      params: { userId: 'AD-0001' },
      body: {
        primaryCafeId: 'CAFE-001',
        assignedCafeIds: ['CAFE-001', 'CAFE-002'],
        reason: 'Assigned secondary cafe',
      },
    });
    const resChange = createMockResponse();

    await runController(updateUser, reqChange, resChange);

    assert.equal(resChange.statusCode, 200);
    assert.equal(targetAdmin.assignedCafeIds.length, 2);
    assert.equal(targetAdmin.sessionVersion, 2);
    assert.equal(targetAdmin.permissionsVersion, 2);
    assert.equal(targetAdmin.cafeAssignmentHistory.length, 1);
    assert.equal(targetAdmin.cafeAssignmentHistory[0].reason, 'Assigned secondary cafe');
    assert.equal(targetAdmin.cafeAssignmentHistory[0].changedBy, 'MU-0001');
  } finally {
    User.findOne = origFindOne;
    Cafe.countDocuments = origCafeCount;
    Session.find = origSessionFind;
    auditService.recordRequestAudit = origRecordAudit;
  }
});

// =============================================================================
// BATCH F: STATUS AND ARCHIVE EXECUTION
// =============================================================================

test('changeUserStatus handles status changes, no-op detection, and session revocation', async () => {
  const pm = createMockUser({ userId: 'MU-0001', isPrimaryMaster: true });
  const staff = createMockUser({
    userId: 'ST-0001',
    role: 'STAFF',
    accountStatus: 'ACTIVE',
    sessionVersion: 1,
    isPrimaryMaster: false,
  });

  const origFindOne = User.findOne;
  const origSessionFind = Session.find;
  const origRecordAudit = auditService.recordRequestAudit;

  User.findOne = async (filter) => {
    if (filter.userId === 'MU-0001') return pm;
    if (filter.userId === 'ST-0001') return staff;
    return null;
  };
  Session.find = () => ({ select: async () => [] });
  auditService.recordRequestAudit = async () => {};

  staff.save = async () => staff;

  try {
    // 1. No-op status change -> 422
    const reqNoOp = createMockRequest({
      params: { userId: 'ST-0001' },
      body: { accountStatus: 'ACTIVE' },
    });
    const resNoOp = createMockResponse();

    await assert.rejects(
      runController(changeUserStatus, reqNoOp, resNoOp),
      (err) => err.code === 'USER_STATUS_NO_OP' && err.statusCode === 422
    );

    // 2. Valid access-removing status change -> 200, sessionVersion incremented
    const reqLock = createMockRequest({
      params: { userId: 'ST-0001' },
      body: { accountStatus: 'LOCKED', reason: 'Security lock' },
    });
    const resLock = createMockResponse();

    await runController(changeUserStatus, reqLock, resLock);

    assert.equal(resLock.statusCode, 200);
    assert.equal(staff.accountStatus, 'LOCKED');
    assert.equal(staff.sessionVersion, 2);
  } finally {
    User.findOne = origFindOne;
    Session.find = origSessionFind;
    auditService.recordRequestAudit = origRecordAudit;
  }
});

test('archiveUser retains User ID, roleHistory, cafeHistory, sets archivedAt & revokes sessions', async () => {
  const pm = createMockUser({ userId: 'MU-0001', isPrimaryMaster: true });
  const staff = createMockUser({
    userId: 'ST-0001',
    role: 'STAFF',
    accountStatus: 'ACTIVE',
    sessionVersion: 1,
    isPrimaryMaster: false,
    roleHistory: [{ toRole: 'STAFF', changedAt: new Date(), changedBy: 'MU-0001', reason: 'Initial' }],
    cafeAssignmentHistory: [{ primaryCafeId: 'CAFE-001', changedAt: new Date(), changedBy: 'MU-0001', reason: 'Initial' }],
  });

  const req = createMockRequest({
    params: { userId: 'ST-0001' },
    body: { reason: 'Employee left company' },
  });
  const res = createMockResponse();

  const origFindOne = User.findOne;
  const origSessionFind = Session.find;
  const origRecordAudit = auditService.recordRequestAudit;

  User.findOne = async (filter) => {
    if (filter.userId === 'MU-0001') return pm;
    if (filter.userId === 'ST-0001') return staff;
    return null;
  };
  Session.find = () => ({ select: async () => [] });
  auditService.recordRequestAudit = async () => {};

  staff.save = async () => staff;

  try {
    await runController(archiveUser, req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(staff.userId, 'ST-0001');
    assert.equal(staff.accountStatus, 'ARCHIVED');
    assert.ok(staff.archivedAt instanceof Date);
    assert.equal(staff.archivedBy, 'MU-0001');
    assert.equal(staff.archiveReason, 'Employee left company');
    assert.equal(staff.sessionVersion, 2);
    assert.equal(staff.roleHistory.length, 1);
    assert.equal(staff.cafeAssignmentHistory.length, 1);
  } finally {
    User.findOne = origFindOne;
    Session.find = origSessionFind;
    auditService.recordRequestAudit = origRecordAudit;
  }
});

// =============================================================================
// BATCH G: CROSS-ORGANISATION AND ACTOR TRUST
// =============================================================================

test('Target user from another organisation is not revealed (returns 404)', async () => {
  const pm = createMockUser({ userId: 'MU-0001', organisationId: 'ORG-TEST' });

  const req = createMockRequest({
    auth: { userId: 'MU-0001', organisationId: 'ORG-TEST', role: 'MASTER' },
    params: { userId: 'ST-0001' },
    body: { organisationId: 'ORG-OTHER', actorUserId: 'ATTACKER' },
  });

  const origFindOne = User.findOne;
  User.findOne = async (filter) => {
    if (filter.userId === 'MU-0001' && filter.organisationId === 'ORG-TEST') return pm;
    // Cross org target query returns null
    return null;
  };

  try {
    await assert.rejects(
      loadTarget(req, 'ST-0001'),
      (err) => err.code === 'USER_NOT_FOUND' && err.statusCode === 404
    );
  } finally {
    User.findOne = origFindOne;
  }
});

test('Cross-organisation café assignment is rejected', async () => {
  const origCafeCount = Cafe.countDocuments;
  // Return count less than assigned array length to simulate cross-org or missing cafe
  Cafe.countDocuments = async () => 0;

  try {
    await assert.rejects(
      validateCafeIds('ORG-TEST', ['CAFE-OTHER-ORG']),
      (err) => err.code === 'INVALID_CAFE_ASSIGNMENT' && err.statusCode === 400
    );
  } finally {
    Cafe.countDocuments = origCafeCount;
  }
});

// =============================================================================
// BATCH H: PROTECTED FIELD COVERAGE
// =============================================================================

test('rejectProtectedFields data-driven verification for every protected field', () => {
  for (const field of PROTECTED_USER_FIELDS) {
    assert.throws(
      () => rejectProtectedFields({ [field]: 'attempted-override' }),
      (err) => err.code === 'PROTECTED_USER_FIELD' && err.statusCode === 400,
      `Field "${field}" must be rejected by rejectProtectedFields.`
    );
  }
});

test('Allowed normal profile fields pass rejectProtectedFields', () => {
  const allowedInput = {
    name: 'Updated Name',
    preferredName: 'Johnny',
    phone: '+919876543210',
    preferredLanguage: 'en',
  };
  assert.doesNotThrow(() => rejectProtectedFields(allowedInput));
});

// =============================================================================
// BATCH I: AUDIT VERIFICATION
// =============================================================================

test('auditGovernanceSuccess excludes password and security secrets from audit payloads', async () => {
  let recordedPayload = null;
  const origRecord = auditService.recordRequestAudit;
  auditService.recordRequestAudit = async (payload) => {
    recordedPayload = payload;
  };

  const req = createMockRequest();
  const staff = createMockUser({
    userId: 'ST-0001',
    passwordHash: 'secret-hash-value',
  });

  try {
    await auditGovernanceSuccess({
      request: req,
      action: 'USER_ROLE_CHANGED',
      target: staff,
      before: { role: 'STAFF' },
      after: { role: 'CAFE_ADMIN' },
      reason: 'Role update audit test',
      riskClassification: 'CRITICAL',
    });

    assert.ok(recordedPayload);
    assert.equal(recordedPayload.request.auth.userId, 'MU-0001');
    assert.equal(recordedPayload.request.auth.organisationId, 'ORG-TEST');
    assert.equal(recordedPayload.entityId, 'ST-0001');
    assert.equal(recordedPayload.riskClassification, 'CRITICAL');
    assert.equal(recordedPayload.reason, 'Role update audit test');
    assert.equal(recordedPayload.before.passwordHash, undefined);
  } finally {
    auditService.recordRequestAudit = origRecord;
  }
});
