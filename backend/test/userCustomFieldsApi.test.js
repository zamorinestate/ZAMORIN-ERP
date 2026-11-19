'use strict';

/**
 * USER CUSTOM FIELD VALUES — HTTP API TESTS  (Capability 26)
 *
 * Covers PATCH /api/v1/users/:userId/custom-fields:
 *  - MASTER-only write guard, step-up + reason requirements
 *  - TEXT / LONG_TEXT / NUMBER / BOOLEAN / DATE / SELECT normalisation
 *  - unknown key, invalid value, required-clear and payload-shape rejection
 *  - Primary Master target protection
 *  - audit emission with before/after snapshots
 */

const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');

const { createApp } = require('../src/server');
const { User } = require('../src/models/User');
const { Session } = require('../src/models/Session');
const { RolePermission } = require('../src/models/RolePermission');
const {
  CustomFieldDefinition,
} = require('../src/models/CustomFieldDefinition');
const authService = require('../src/services/authService');
const auditService = require('../src/services/auditService');

function makeUser(overrides = {}) {
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
    passwordHash: 'hash',
    createdBy: 'SYSTEM',
    ...overrides,
  });
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
    permissionCode: 'USER:MANAGE',
    module: 'USER',
    resource: 'USER',
    action: 'MANAGE',
    effect: 'ALLOW',
    scope: 'ORGANISATION',
    requiresMfa: true,
    requiresStepUpAuthentication: true,
    requiresReason: true,
    requiresAuditEvent: true,
    requiresReauthentication: false,
    policyVersion: 1,
    createdBy: 'SYSTEM',
    ...overrides,
  });
}

function makeDefinition(overrides = {}) {
  return {
    organisationId: 'ORG-TEST',
    key: 'uniform_size',
    label: 'Uniform Size',
    fieldType: 'TEXT',
    allowedValues: [],
    isRequired: false,
    appliesTo: 'USER',
    status: 'ACTIVE',
    displayOrder: 0,
    ...overrides,
  };
}

const DEFINITIONS = [
  makeDefinition({ key: 'uniform_size', fieldType: 'TEXT' }),
  makeDefinition({ key: 'notes', fieldType: 'LONG_TEXT' }),
  makeDefinition({ key: 'locker_number', fieldType: 'NUMBER' }),
  makeDefinition({ key: 'meal_opt_in', fieldType: 'BOOLEAN' }),
  makeDefinition({ key: 'probation_end', fieldType: 'DATE' }),
  makeDefinition({
    key: 'blood_group',
    fieldType: 'SELECT',
    allowedValues: ['A+', 'B+', 'O+', 'AB+'],
  }),
  makeDefinition({ key: 'badge_id', fieldType: 'TEXT', isRequired: true }),
];

let server = null;
let baseUrl = '';

async function startApiServer() {
  const app = createApp({ allowedOrigins: ['*'], production: false });
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}/api/v1`;
}

async function stopApiServer() {
  if (server) {
    await new Promise((resolve) => server.close(resolve));
    server = null;
  }
}

function patchCustomFields(userId, body, { token = 'valid-master-token' } = {}) {
  return fetch(`${baseUrl}/users/${userId}/custom-fields`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

/**
 * Stub auth + model lookups for an authenticated MASTER request.
 * Returns a restore function and a mutable `auditCalls` array.
 */
function setupMasterMocks({ targetUser, sessionOverrides = {}, actorOverrides = {} } = {}) {
  const actor = makeUser(actorOverrides);
  const masterSession = makeSession(sessionOverrides);

  const originals = {
    verifyAccessToken: authService.verifyAccessToken,
    userFindOne: User.findOne,
    sessionFindOne: Session.findOne,
    sessionCountDocuments: Session.countDocuments,
    sessionFind: Session.find,
    findEffectiveRules: RolePermission.findEffectiveRules,
    audit: auditService.recordRequestAudit,
    definitionFind: CustomFieldDefinition.find,
  };

  const auditCalls = [];

  authService.verifyAccessToken = async () => ({
    payload: {
      sub: actor.userId,
      org: 'ORG-TEST',
      role: actor.role,
      sv: 0,
      usv: 1,
      pv: 1,
      type: 'access',
    },
    session: masterSession,
  });

  User.findOne = async (filter) => {
    if (filter.userId === actor.userId) return actor;
    if (targetUser && filter.userId === targetUser.userId) return targetUser;
    return null;
  };

  Session.findOne = async () => masterSession;
  Session.countDocuments = async () => 0;
  Session.find = () => ({ select: async () => [] });
  RolePermission.findEffectiveRules = async () => [makePermissionRule()];
  auditService.recordRequestAudit = async (payload) => {
    auditCalls.push(payload);
  };
  CustomFieldDefinition.find = () => ({
    lean: async () => DEFINITIONS,
  });

  return {
    actor,
    auditCalls,
    restore: () => {
      authService.verifyAccessToken = originals.verifyAccessToken;
      User.findOne = originals.userFindOne;
      Session.findOne = originals.sessionFindOne;
      Session.countDocuments = originals.sessionCountDocuments;
      Session.find = originals.sessionFind;
      RolePermission.findEffectiveRules = originals.findEffectiveRules;
      auditService.recordRequestAudit = originals.audit;
      CustomFieldDefinition.find = originals.definitionFind;
    },
  };
}

function makeTarget(overrides = {}) {
  const target = makeUser({
    userId: 'ST-0001',
    name: 'Staff Member',
    email: 'staff@example.com',
    role: 'STAFF',
    isPrimaryMaster: false,
    primaryMasterDesignatedAt: undefined,
    primaryMasterDesignatedBy: undefined,
    primaryMasterDesignationReason: undefined,
    ...overrides,
  });
  target.save = async () => target;
  return target;
}

test('Custom field values API', async (t) => {
  await startApiServer();

  t.after(async () => {
    await stopApiServer();
  });

  await t.test('unauthenticated request returns 401', async () => {
    const res = await fetch(`${baseUrl}/users/ST-0001/custom-fields`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ customFields: {} }),
    });

    assert.equal(res.status, 401);
    const payload = await res.json();
    assert.equal(payload.error.code, 'AUTHENTICATION_REQUIRED');
  });

  await t.test('non-MASTER actor returns 403 ROLE_NOT_ALLOWED', async () => {
    const { restore } = setupMasterMocks({
      targetUser: makeTarget(),
      actorOverrides: {
        userId: 'OW-0001',
        role: 'OWNER',
        isPrimaryMaster: false,
      },
    });

    try {
      // verifyAccessToken is stubbed with the actor object, so override afterwards.
      authService.verifyAccessToken = async () => ({
        payload: {
          sub: 'OW-0001',
          org: 'ORG-TEST',
          role: 'OWNER',
          sv: 0,
          usv: 1,
          pv: 1,
          type: 'access',
        },
        session: makeSession({ userId: 'OW-0001', roleSnapshot: 'OWNER' }),
      });

      const res = await patchCustomFields('ST-0001', {
        customFields: { uniform_size: 'M' },
        reason: 'test',
      });

      assert.equal(res.status, 403);
      const payload = await res.json();
      assert.equal(payload.error.code, 'ROLE_NOT_ALLOWED');
    } finally {
      restore();
    }
  });

  await t.test('writes every supported field type and audits the change', async () => {
    const target = makeTarget();
    const { auditCalls, restore } = setupMasterMocks({ targetUser: target });

    try {
      const res = await patchCustomFields('ST-0001', {
        customFields: {
          uniform_size: '  L  ',
          notes: 'Allergic to latex',
          locker_number: '14',
          meal_opt_in: 'true',
          probation_end: '2026-12-31',
          blood_group: 'o+',
        },
        reason: 'Onboarding metadata capture',
      });

      assert.equal(res.status, 200);
      const payload = await res.json();
      assert.equal(payload.success, true);
      assert.deepEqual(payload.data.customFields, {
        uniform_size: 'L',
        notes: 'Allergic to latex',
        locker_number: 14,
        meal_opt_in: true,
        probation_end: '2026-12-31',
        blood_group: 'O+',
      });
      assert.equal(target.customFields.get('uniform_size'), 'L');
      assert.equal(target.customFields.get('locker_number'), 14);
      assert.equal(target.customFields.get('meal_opt_in'), true);
      assert.equal(target.customFields.get('blood_group'), 'O+');

      assert.equal(auditCalls.length, 1);
      assert.equal(auditCalls[0].action, 'USER_CUSTOM_FIELDS_UPDATED');
      assert.deepEqual(auditCalls[0].metadata.changedKeys.sort(), [
        'blood_group',
        'locker_number',
        'meal_opt_in',
        'notes',
        'probation_end',
        'uniform_size',
      ]);
    } finally {
      restore();
    }
  });

  await t.test('rejects an unknown custom field key', async () => {
    const { restore } = setupMasterMocks({ targetUser: makeTarget() });

    try {
      const res = await patchCustomFields('ST-0001', {
        customFields: { not_registered: 'x' },
        reason: 'test',
      });

      assert.equal(res.status, 400);
      const payload = await res.json();
      assert.equal(payload.error.code, 'CUSTOM_FIELD_NOT_DEFINED');
    } finally {
      restore();
    }
  });

  await t.test('rejects a SELECT value outside allowedValues', async () => {
    const { restore } = setupMasterMocks({ targetUser: makeTarget() });

    try {
      const res = await patchCustomFields('ST-0001', {
        customFields: { blood_group: 'Z-' },
        reason: 'test',
      });

      assert.equal(res.status, 400);
      const payload = await res.json();
      assert.equal(payload.error.code, 'INVALID_CUSTOM_FIELD_VALUE');
    } finally {
      restore();
    }
  });

  await t.test('rejects a non-numeric NUMBER value', async () => {
    const { restore } = setupMasterMocks({ targetUser: makeTarget() });

    try {
      const res = await patchCustomFields('ST-0001', {
        customFields: { locker_number: 'fourteen' },
        reason: 'test',
      });

      assert.equal(res.status, 400);
      const payload = await res.json();
      assert.equal(payload.error.code, 'INVALID_CUSTOM_FIELD_VALUE');
    } finally {
      restore();
    }
  });

  await t.test('rejects a non-boolean BOOLEAN value', async () => {
    const { restore } = setupMasterMocks({ targetUser: makeTarget() });

    try {
      const res = await patchCustomFields('ST-0001', {
        customFields: { meal_opt_in: 'yes' },
        reason: 'test',
      });

      assert.equal(res.status, 400);
      const payload = await res.json();
      assert.equal(payload.error.code, 'INVALID_CUSTOM_FIELD_VALUE');
    } finally {
      restore();
    }
  });

  await t.test('rejects an impossible calendar date', async () => {
    const { restore } = setupMasterMocks({ targetUser: makeTarget() });

    try {
      const res = await patchCustomFields('ST-0001', {
        customFields: { probation_end: '2026-02-30' },
        reason: 'test',
      });

      assert.equal(res.status, 400);
      const payload = await res.json();
      assert.equal(payload.error.code, 'INVALID_CUSTOM_FIELD_VALUE');
    } finally {
      restore();
    }
  });

  await t.test('rejects clearing a required field', async () => {
    const { restore } = setupMasterMocks({ targetUser: makeTarget() });

    try {
      const res = await patchCustomFields('ST-0001', {
        customFields: { badge_id: null },
        reason: 'test',
      });

      assert.equal(res.status, 400);
      const payload = await res.json();
      assert.equal(payload.error.code, 'CUSTOM_FIELD_VALUE_REQUIRED');
    } finally {
      restore();
    }
  });

  await t.test('null clears an optional value and removes the key', async () => {
    const target = makeTarget({
      customFields: new Map([
        ['uniform_size', 'M'],
        ['locker_number', 7],
      ]),
    });
    const { restore } = setupMasterMocks({ targetUser: target });

    try {
      const res = await patchCustomFields('ST-0001', {
        customFields: { uniform_size: null },
        reason: 'Uniform size no longer tracked',
      });

      assert.equal(res.status, 200);
      const payload = await res.json();
      assert.equal(payload.data.customFields.uniform_size, undefined);
      assert.equal(payload.data.customFields.locker_number, 7);
      assert.equal(target.customFields.has('uniform_size'), false);
      assert.equal(target.customFields.get('locker_number'), 7);
    } finally {
      restore();
    }
  });

  await t.test('rejects an array payload', async () => {
    const { restore } = setupMasterMocks({ targetUser: makeTarget() });

    try {
      const res = await patchCustomFields('ST-0001', {
        customFields: [{ uniform_size: 'M' }],
        reason: 'test',
      });

      assert.equal(res.status, 400);
      const payload = await res.json();
      assert.equal(payload.error.code, 'INVALID_CUSTOM_FIELD_PAYLOAD');
    } finally {
      restore();
    }
  });

  await t.test('rejects an invalid key format', async () => {
    const { restore } = setupMasterMocks({ targetUser: makeTarget() });

    try {
      const res = await patchCustomFields('ST-0001', {
        customFields: { 'bad-key': 'x' },
        reason: 'test',
      });

      assert.equal(res.status, 400);
      const payload = await res.json();
      assert.equal(payload.error.code, 'INVALID_CUSTOM_FIELD_KEY');
    } finally {
      restore();
    }
  });

  await t.test('blocks updates against the Primary Master target', async () => {
    const primaryMasterTarget = makeUser({ userId: 'MU-0002' });
    const { restore } = setupMasterMocks({ targetUser: primaryMasterTarget });

    try {
      const res = await patchCustomFields('MU-0002', {
        customFields: { uniform_size: 'L' },
        reason: 'test',
      });

      assert.equal(res.status, 403);
      const payload = await res.json();
      assert.equal(payload.error.code, 'PRIMARY_MASTER_PROTECTED');
    } finally {
      restore();
    }
  });

  await t.test('requires a reason', async () => {
    const { restore } = setupMasterMocks({ targetUser: makeTarget() });

    try {
      const res = await patchCustomFields('ST-0001', {
        customFields: { uniform_size: 'M' },
        reason: '',
      });

      assert.equal(res.status, 400);
      const payload = await res.json();
      assert.equal(payload.error.code, 'REASON_REQUIRED');
    } finally {
      restore();
    }
  });
});
