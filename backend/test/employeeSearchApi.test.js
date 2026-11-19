'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');

const { createApp } = require('../src/server');
const { User } = require('../src/models/User');
const { Session } = require('../src/models/Session');
const { RolePermission } = require('../src/models/RolePermission');
const authService = require('../src/services/authService');

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
    sessionId: 'SS-20260807-0001',
    organisationId: 'ORG-TEST',
    userId: 'MU-0001',
    roleSnapshot: 'MASTER',
    sessionVersion: 0,
    userSessionVersionSnapshot: 1,
    permissionsVersionSnapshot: 1,
    status: 'ACTIVE',
    mfaVerified: true,
    stepUpVerifiedAt: null,
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
    requiresMfa: true,
    requiresStepUpAuthentication: false,
    requiresReason: false,
    requiresAuditEvent: false,
    requiresReauthentication: false,
    policyVersion: 1,
    createdBy: 'SYSTEM',
    ...overrides,
  });
}

let server;
let baseUrl;

async function startServer() {
  const app = createApp({
    allowedOrigins: ['*'],
    production: false,
  });

  server = http.createServer(app);
  await new Promise((resolve) =>
    server.listen(0, '127.0.0.1', resolve)
  );
  baseUrl =
    `http://127.0.0.1:${server.address().port}/api/v1`;
}

async function stopServer() {
  if (!server) return;
  await new Promise((resolve) =>
    server.close(resolve)
  );
  server = null;
}

function setupMocks({
  role = 'MASTER',
  userId = 'MU-0001',
  permissionRules = null,
  mfaVerified = true,
  rows = [],
  total = rows.length,
} = {}) {
  const actor = makeUser({
    userId,
    role,
    isPrimaryMaster:
      role === 'MASTER' && userId === 'MU-0001',
    primaryMasterDesignatedAt:
      role === 'MASTER' && userId === 'MU-0001'
        ? new Date()
        : null,
    primaryMasterDesignatedBy:
      role === 'MASTER' && userId === 'MU-0001'
        ? 'MU-0001'
        : null,
    primaryMasterDesignationReason:
      role === 'MASTER' && userId === 'MU-0001'
        ? 'Initial setup'
        : null,
  });

  const session = makeSession({
    userId,
    roleSnapshot: role,
    mfaVerified,
  });

  const originals = {
    verifyAccessToken: authService.verifyAccessToken,
    userFindOne: User.findOne,
    sessionFindOne: Session.findOne,
    rules: RolePermission.findEffectiveRules,
    userFind: User.find,
    count: User.countDocuments,
  };

  const observed = {
    findCalled: false,
    countCalled: false,
    findFilter: null,
    countFilter: null,
    permissionFilter: null,
    projection: null,
    sort: null,
    skip: null,
    limit: null,
  };

  authService.verifyAccessToken = async () => ({
    payload: {
      sub: userId,
      org: 'ORG-TEST',
      role,
      sv: 0,
      usv: 1,
      pv: 1,
      type: 'access',
    },
    session,
  });

  User.findOne = async (filter) =>
    filter.userId === userId &&
    filter.organisationId === 'ORG-TEST'
      ? actor
      : null;

  Session.findOne = async () => session;

  RolePermission.findEffectiveRules =
    async (filter) => {
      observed.permissionFilter = { ...filter };
      if (permissionRules !== null) {
        return permissionRules;
      }
      return [
        makePermissionRule({
          role,
          requiresMfa: role !== 'STAFF',
        }),
      ];
    };

  User.find = (filter) => {
    observed.findCalled = true;
    observed.findFilter = { ...filter };

    const query = {
      select(value) {
        observed.projection = value;
        return query;
      },
      sort(value) {
        observed.sort = value;
        return query;
      },
      skip(value) {
        observed.skip = value;
        return query;
      },
      limit(value) {
        observed.limit = value;
        return query;
      },
      async lean() {
        return rows;
      },
    };

    return query;
  };

  User.countDocuments = async (filter) => {
    observed.countCalled = true;
    observed.countFilter = { ...filter };
    return total;
  };

  return {
    observed,
    restore() {
      authService.verifyAccessToken =
        originals.verifyAccessToken;
      User.findOne = originals.userFindOne;
      Session.findOne = originals.sessionFindOne;
      RolePermission.findEffectiveRules =
        originals.rules;
      User.find = originals.userFind;
      User.countDocuments = originals.count;
    },
  };
}

async function get(path, token) {
  return fetch(
    `${baseUrl}${path}`,
    token
      ? {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      : undefined
  );
}

test(
  'employee search HTTP authorization and query contract',
  async (t) => {
    await startServer();
    t.after(stopServer);

    await t.test('unauthenticated search returns 401', async () => {
      const response =
        await get('/employees/search?q=Priya');
      const body = await response.json();

      assert.equal(response.status, 401);
      assert.equal(
        body.error.code,
        'AUTHENTICATION_REQUIRED'
      );
    });

    await t.test('STAFF search returns 403 before permission or Mongo query', async () => {
      const { observed, restore } =
        setupMocks({
          role: 'STAFF',
          userId: 'ST-0001',
        });

      try {
        const response = await get(
          '/employees/search?q=Priya',
          'valid-staff-token'
        );
        const body = await response.json();

        assert.equal(response.status, 403);
        assert.equal(
          body.error.code,
          'ROLE_NOT_ALLOWED'
        );
        assert.equal(
          observed.permissionFilter,
          null
        );
        assert.equal(observed.findCalled, false);
        assert.equal(observed.countCalled, false);
      } finally {
        restore();
      }
    });

    await t.test('OWNER name search is organisation-scoped, paginated and compact', async () => {
      const { observed, restore } =
        setupMocks({
          role: 'OWNER',
          userId: 'OW-0001',
          rows: [
            {
              userId: 'ST-0042',
              name: 'José Nair',
              preferredName: 'Jose',
              role: 'STAFF',
              accountStatus: 'ACTIVE',
              isPrimaryMaster: false,
              primaryCafeId: 'CF-0001',
              assignedCafeIds: ['CF-0001'],
              joiningDate:
                new Date('2026-01-10T00:00:00.000Z'),
              department: 'Service',
              designation: 'Associate',
              email: 'private@example.com',
              passwordHash: 'secret',
              employeeSearchTerms: ['jose'],
            },
          ],
          total: 21,
        });

      try {
        const response = await get(
          `/employees/search?q=${encodeURIComponent('José')}&page=2&limit=10`,
          'valid-owner-token'
        );
        const body = await response.json();

        assert.equal(response.status, 200);
        assert.deepEqual(
          observed.findFilter,
          {
            organisationId: 'ORG-TEST',
            employeeSearchTerms: 'jose',
          }
        );
        assert.deepEqual(
          observed.countFilter,
          observed.findFilter
        );
        assert.equal(observed.skip, 10);
        assert.equal(observed.limit, 10);
        assert.deepEqual(
          observed.sort,
          { name: 1, userId: 1 }
        );
        assert.equal(
          observed.permissionFilter.permissionCode,
          'EMPLOYEE:READ'
        );
        assert.equal(
          observed.permissionFilter.role,
          'OWNER'
        );
        assert.deepEqual(
          body.data.search,
          {
            mode: 'NAME',
            normalizedQuery: 'jose',
          }
        );
        assert.deepEqual(
          body.data.pagination,
          {
            page: 2,
            limit: 10,
            total: 21,
            totalPages: 3,
          }
        );

        const employee =
          body.data.employees[0];

        assert.equal(employee.userId, 'ST-0042');
        assert.equal(
          Object.hasOwn(employee, 'email'),
          false
        );
        assert.equal(
          Object.hasOwn(employee, 'passwordHash'),
          false
        );
        assert.equal(
          Object.hasOwn(
            employee,
            'employeeSearchTerms'
          ),
          false
        );
      } finally {
        restore();
      }
    });

    await t.test('MASTER exact-ID search uses backend organisation scope', async () => {
      const { observed, restore } =
        setupMocks();

      try {
        const response = await get(
          '/employees/search?q=st-0042',
          'valid-master-token'
        );
        const body = await response.json();

        assert.equal(response.status, 200);
        assert.deepEqual(
          observed.findFilter,
          {
            organisationId: 'ORG-TEST',
            userId: 'ST-0042',
          }
        );
        assert.deepEqual(
          body.data.search,
          {
            mode: 'EXACT_ID',
            normalizedQuery: 'ST-0042',
          }
        );
      } finally {
        restore();
      }
    });

    await t.test('missing permission returns 403 before Mongo query', async () => {
      const { observed, restore } =
        setupMocks({
          permissionRules: [makePermissionRule({ effect: 'DENY' })],
        });

      try {
        const response = await get(
          '/employees/search?q=Priya',
          'valid-master-token'
        );
        const body = await response.json();

        assert.equal(response.status, 403);
        assert.equal(
          body.error.code,
          'PERMISSION_DENIED'
        );
        assert.equal(observed.findCalled, false);
        assert.equal(observed.countCalled, false);
      } finally {
        restore();
      }
    });

    await t.test('missing MFA returns 403 before Mongo query', async () => {
      const { observed, restore } =
        setupMocks({
          mfaVerified: false,
        });

      try {
        const response = await get(
          '/employees/search?q=Priya',
          'valid-master-token'
        );
        const body = await response.json();

        assert.equal(response.status, 403);
        assert.equal(
          body.error.code,
          'MFA_REQUIRED'
        );
        assert.equal(observed.findCalled, false);
        assert.equal(observed.countCalled, false);
      } finally {
        restore();
      }
    });

    await t.test('short search returns 400 before Mongo query', async () => {
      const { observed, restore } =
        setupMocks();

      try {
        const response = await get(
          '/employees/search?q=P',
          'valid-master-token'
        );
        const body = await response.json();

        assert.equal(response.status, 400);
        assert.equal(
          body.error.code,
          'EMPLOYEE_SEARCH_QUERY_TOO_SHORT'
        );
        assert.equal(observed.findCalled, false);
        assert.equal(observed.countCalled, false);
      } finally {
        restore();
      }
    });
  }
);
