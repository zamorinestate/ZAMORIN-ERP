'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const { createApp } = require('../src/server');
const { User } = require('../src/models/User');
const { Position } = require('../src/models/Position');
const { StaffingRequest } = require('../src/models/StaffingRequest');
const { EmployeeSkill } = require('../src/models/EmployeeSkill');
const { EmployeeTraining } = require('../src/models/EmployeeTraining');
const { EmployeeDocument } = require('../src/models/EmployeeDocument');
const { EmployeeMovement } = require('../src/models/EmployeeMovement');
const { ProbationReview } = require('../src/models/ProbationReview');
const { Asset } = require('../src/models/Asset');
const { SequenceCounter } = require('../src/models/SequenceCounter');
const { RolePermission } = require('../src/models/RolePermission');
const { AuditEvent } = require('../src/models/AuditEvent');
const authService = require('../src/services/authService');
const auditService = require('../src/services/auditService');

function makeRequest({ port, method, path, headers = {}, body = null }) {
  return new Promise((resolve, reject) => {
    const serializedBody = body ? JSON.stringify(body) : null;
    const reqHeaders = { ...headers };
    if (serializedBody) {
      reqHeaders['Content-Type'] = 'application/json';
      reqHeaders['Content-Length'] = Buffer.byteLength(serializedBody);
    }

    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        method,
        path,
        headers: reqHeaders,
      },
      (res) => {
        let responseData = '';
        res.on('data', (chunk) => {
          responseData += chunk;
        });
        res.on('end', () => {
          let parsedJson = null;
          try {
            parsedJson = responseData ? JSON.parse(responseData) : null;
          } catch (e) {
            parsedJson = responseData;
          }
          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            body: parsedJson,
          });
        });
      }
    );

    req.on('error', reject);
    if (serializedBody) {
      req.write(serializedBody);
    }
    req.end();
  });
}

function createQueryWrapper(resolvedValue) {
  const query = {
    select() { return query; },
    sort() { return query; },
    skip() { return query; },
    limit() { return query; },
    lean() { return Promise.resolve(resolvedValue); },
    then(onFulfilled, onRejected) {
      return Promise.resolve(resolvedValue).then(onFulfilled, onRejected);
    },
  };
  return query;
}

test('Screen 008: Employee Directory & Staffing Integration Test Suite', async (t) => {
  const app = createApp({ allowedOrigins: ['*'], production: false });
  const server = http.createServer(app);

  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });

  const port = server.address().port;

  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  const primaryMasterUser = {
    userId: 'MU-PRIMARY-01',
    role: 'MASTER',
    isPrimaryMaster: true,
    organisationId: 'ORG-ZAMORIN',
    email: 'primary@zamorincafe.com',
    fullName: 'Primary Master',
    sessionVersion: 1,
    permissionsVersion: 1,
    assignedCafeIds: ['ZC-0001', 'ZC-0002'],
    accountStatus: 'ACTIVE',
    save: async function () { return this; },
  };

  const normalMasterUser = {
    userId: 'MU-NORMAL-01',
    role: 'MASTER',
    isPrimaryMaster: false,
    organisationId: 'ORG-ZAMORIN',
    email: 'normal@zamorincafe.com',
    fullName: 'Normal Master',
    sessionVersion: 1,
    permissionsVersion: 1,
    assignedCafeIds: ['ZC-0001', 'ZC-0002'],
    accountStatus: 'ACTIVE',
    save: async function () { return this; },
  };

  const ownerUser = {
    userId: 'MU-OWNER-01',
    role: 'OWNER',
    isPrimaryMaster: false,
    organisationId: 'ORG-ZAMORIN',
    email: 'owner@zamorincafe.com',
    fullName: 'Owner',
    sessionVersion: 1,
    permissionsVersion: 1,
    assignedCafeIds: ['ZC-0001', 'ZC-0002'],
    accountStatus: 'ACTIVE',
    save: async function () { return this; },
  };

  t.mock.method(authService, 'verifyAccessToken', async (token) => {
    const isOwner = token === 'token_owner';
    const isNormal = token === 'token_normal_master';
    const activeUser = isOwner ? ownerUser : (isNormal ? normalMasterUser : primaryMasterUser);
    return {
      payload: {
        sub: activeUser.userId,
        org: activeUser.organisationId,
        role: activeUser.role,
        isPrimaryMaster: activeUser.isPrimaryMaster,
        sv: 0,
        usv: 1,
        pv: 1,
        sid: 'SS-TEST-001',
      },
      session: {
        sessionId: 'SS-TEST-001',
        roleSnapshot: activeUser.role,
        sessionVersion: 0,
        mfaVerified: true,
        stepUpVerifiedAt: new Date().toISOString(),
      },
    };
  });

  t.mock.method(RolePermission, 'findEffectiveRules', async ({ role, permissionCode }) => [
    {
      role,
      permissionCode,
      effect: 'ALLOW',
      scope: 'ORGANISATION',
      isCurrentlyEffective: () => true,
    },
  ]);

  t.mock.method(auditService, 'recordRequestAudit', async () => ({}));
  t.mock.method(auditService, 'recordAuditEvent', async () => ({}));
  t.mock.method(SequenceCounter, 'generateId', async () => 'ST-2026-9999');

  User.prototype.save = async function () { return this; };
  Position.prototype.save = async function () { return this; };
  StaffingRequest.prototype.save = async function () { return this; };
  EmployeeSkill.prototype.save = async function () { return this; };
  EmployeeTraining.prototype.save = async function () { return this; };
  EmployeeDocument.prototype.save = async function () { return this; };
  EmployeeMovement.prototype.save = async function () { return this; };
  ProbationReview.prototype.save = async function () { return this; };
  AuditEvent.prototype.save = async function () { return this; };
  t.mock.method(AuditEvent, 'create', async (data) => ({ ...data, save: async function () { return this; } }));

  // Global User.findOne handler
  t.mock.method(User, 'findOne', (query) => {
    if (query?.userId === 'MU-OWNER-01') {
      return createQueryWrapper({ ...ownerUser, isPrimaryMaster: false, toObject: () => ownerUser });
    }
    if (query?.userId === 'MU-NORMAL-01') {
      return createQueryWrapper({ ...normalMasterUser, isPrimaryMaster: false, toObject: () => normalMasterUser });
    }
    if (query?.userId === 'MU-PRIMARY-01') {
      return createQueryWrapper({ ...primaryMasterUser, isPrimaryMaster: true, toObject: () => primaryMasterUser });
    }
    if (query?.userId === 'ST-0004') {
      return createQueryWrapper({
        userId: 'ST-0004',
        name: 'Priya Nair',
        role: 'STAFF',
        primaryCafeId: 'ZC-0001',
        designation: 'Senior Head Barista',
        department: 'Barista',
        positionId: 'POS-001-02',
        accountStatus: 'ACTIVE',
        employmentStatus: 'ACTIVE',
        assignedCafeIds: ['ZC-0001'],
        save: async function () { return this; },
        toObject: () => ({ userId: 'ST-0004', name: 'Priya Nair' }),
      });
    }
    if (query?.userId === 'ST-0006') {
      return createQueryWrapper({
        userId: 'ST-0006',
        name: 'Ananya Sen',
        role: 'STAFF',
        probationStatus: 'PENDING',
        employmentStatus: 'PROBATION',
        accountStatus: 'ACTIVE',
        primaryCafeId: 'ZC-0003',
        department: 'Service',
        designation: 'Floor Lead',
        save: async function () { return this; },
        toObject: () => ({ userId: 'ST-0006', name: 'Ananya Sen' }),
      });
    }
    if (query?.$or && Array.isArray(query.$or)) {
      const match = query.$or.find((item) => item.email === 'duplicate@zamorin.cafe');
      if (match) {
        return createQueryWrapper({ userId: 'ST-0004', email: 'duplicate@zamorin.cafe' });
      }
    }
    return createQueryWrapper(null);
  });

  await t.test('1. GET /api/v1/employees/overview returns KPIs and control strip', async () => {
    t.mock.method(User, 'find', () => createQueryWrapper([
      { userId: 'MU-PRIMARY-01', name: 'Master User', role: 'MASTER', isPrimaryMaster: true, accountStatus: 'ACTIVE', employmentStatus: 'ACTIVE', primaryCafeId: 'ZC-0001' },
      { userId: 'ST-0004', name: 'Priya Nair', role: 'STAFF', accountStatus: 'ACTIVE', employmentStatus: 'ACTIVE', primaryCafeId: 'ZC-0001' },
      { userId: 'ST-0006', name: 'Ananya Sen', role: 'STAFF', accountStatus: 'ACTIVE', employmentStatus: 'PROBATION', probationStatus: 'PENDING', primaryCafeId: 'ZC-0003' },
    ]));
    t.mock.method(Position, 'find', () => createQueryWrapper([
      { positionId: 'POS-001-01', positionTitle: 'Head Barista', cafeId: 'ZC-0001', approvedCapacity: 2, status: 'OPEN', isCritical: true },
    ]));
    t.mock.method(StaffingRequest, 'find', () => createQueryWrapper([]));
    t.mock.method(EmployeeSkill, 'find', () => createQueryWrapper([]));
    t.mock.method(EmployeeTraining, 'find', () => createQueryWrapper([]));
    t.mock.method(EmployeeDocument, 'find', () => createQueryWrapper([]));
    t.mock.method(EmployeeMovement, 'find', () => createQueryWrapper([]));
    t.mock.method(ProbationReview, 'find', () => createQueryWrapper([]));

    const res = await makeRequest({
      port,
      method: 'GET',
      path: '/api/v1/employees/overview',
      headers: { Authorization: 'Bearer token_primary_master' },
    });

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.data.kpis.activeEmployees, 3);
    assert.equal(res.body.data.kpis.openPositions, 1);
    assert.ok(Array.isArray(res.body.data.cafeWorkforce));
  });

  await t.test('2. GET /api/v1/employees lists employees with privacy masking for non-Primary Master (Owner)', async () => {
    t.mock.method(User, 'countDocuments', async () => 1);
    t.mock.method(User, 'find', () => createQueryWrapper([
      {
        userId: 'ST-0004',
        name: 'Priya Nair',
        role: 'STAFF',
        designation: 'Senior Head Barista',
        primaryCafeId: 'ZC-0001',
        address: { line1: '123 Private St', city: 'Bangalore', state: 'KA' },
        emergencyContact: { name: 'Secret Contact', phone: '+919999999999' },
      },
    ]));

    const res = await makeRequest({
      port,
      method: 'GET',
      path: '/api/v1/employees',
      headers: { Authorization: 'Bearer token_owner' },
    });

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.data.employees[0].name, 'Priya Nair');
    assert.equal(res.body.data.employees[0].address.line1, undefined);
    assert.equal(res.body.data.employees[0].emergencyContact.relationship, 'ON_FILE');
  });

  await t.test('3. POST /api/v1/employees onboards a new staff member with checklist generation', async () => {
    t.mock.method(User, 'create', async (doc) => ({ ...doc, save: async function () { return this; } }));
    t.mock.method(EmployeeTraining, 'create', async (doc) => ({ ...doc, save: async function () { return this; } }));
    t.mock.method(EmployeeDocument, 'create', async (doc) => ({ ...doc, save: async function () { return this; } }));

    const res = await makeRequest({
      port,
      method: 'POST',
      path: '/api/v1/employees',
      headers: { Authorization: 'Bearer token_primary_master' },
      body: {
        name: 'Kiran Menon',
        email: 'kiran@zamorin.cafe',
        phone: '+919845099887',
        department: 'Barista',
        designation: 'Junior Barista',
        primaryCafeId: 'ZC-0001',
        workerType: 'PERMANENT',
      },
    });

    assert.equal(res.statusCode, 201);
    assert.equal(res.body.success, true);
    assert.equal(res.body.data.employee.name, 'Kiran Menon');
    assert.equal(res.body.data.employee.employmentStatus, 'PROBATION');
  });

  await t.test('4. POST /api/v1/employees rejects duplicate email registration', async () => {
    const res = await makeRequest({
      port,
      method: 'POST',
      path: '/api/v1/employees',
      headers: { Authorization: 'Bearer token_primary_master' },
      body: {
        name: 'Duplicate Priya',
        email: 'duplicate@zamorin.cafe',
      },
    });

    assert.equal(res.statusCode, 409);
  });

  await t.test('5. GET /api/v1/employees/:userId returns 360 view with movements and allowed actions', async () => {
    t.mock.method(Position, 'findOne', () => createQueryWrapper({ positionId: 'POS-001-02', positionTitle: 'Senior Head Barista' }));
    t.mock.method(EmployeeSkill, 'find', () => createQueryWrapper([{ skillName: 'Manual Brewing', proficiency: 'EXPERT' }]));
    t.mock.method(EmployeeTraining, 'find', () => createQueryWrapper([]));
    t.mock.method(EmployeeDocument, 'find', () => createQueryWrapper([]));
    t.mock.method(EmployeeMovement, 'find', () => createQueryWrapper([]));
    t.mock.method(ProbationReview, 'find', () => createQueryWrapper([]));
    t.mock.method(Asset, 'find', () => createQueryWrapper([{ assetId: 'AST-001', name: 'Barista Tablet' }]));

    const res = await makeRequest({
      port,
      method: 'GET',
      path: '/api/v1/employees/ST-0004',
      headers: { Authorization: 'Bearer token_primary_master' },
    });

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.data.profile.name, 'Priya Nair');
    assert.equal(res.body.data.skills[0].skillName, 'Manual Brewing');
    assert.ok(res.body.data.allowedActions.includes('TRANSFER'));
  });

  await t.test('6. POST /api/v1/employees/:userId/movements schedules permanent relocation', async () => {
    t.mock.method(EmployeeMovement, 'create', async (doc) => ({ ...doc, save: async function () { return this; } }));

    const res = await makeRequest({
      port,
      method: 'POST',
      path: '/api/v1/employees/ST-0004/movements',
      headers: { Authorization: 'Bearer token_primary_master' },
      body: {
        movementType: 'TRANSFER',
        toCafeId: 'ZC-0002',
        effectiveDate: new Date().toISOString().split('T')[0],
        reason: 'Leadership transfer to support morning coffee volume.',
      },
    });

    assert.equal(res.statusCode, 201);
    assert.equal(res.body.success, true);
    assert.equal(res.body.data.movement.toCafeId, 'ZC-0002');
  });

  await t.test('7. POST /api/v1/employees/:userId/probation records manager review and confirmation', async () => {
    t.mock.method(ProbationReview, 'create', async (doc) => ({ ...doc, save: async function () { return this; } }));

    const res = await makeRequest({
      port,
      method: 'POST',
      path: '/api/v1/employees/ST-0006/probation',
      headers: { Authorization: 'Bearer token_primary_master' },
      body: {
        decision: 'CONFIRM',
        managerComments: 'Outstanding front of house performance.',
        ratings: { jobKnowledge: 5, serviceStandards: 5, reliability: 5 },
      },
    });

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.data.review.decision, 'CONFIRM');
  });

  await t.test('8. POST /api/v1/employees/:userId/skills verifies staff competency', async () => {
    t.mock.method(EmployeeSkill, 'create', async (doc) => ({ ...doc, save: async function () { return this; } }));

    const res = await makeRequest({
      port,
      method: 'POST',
      path: '/api/v1/employees/ST-0004/skills',
      headers: { Authorization: 'Bearer token_primary_master' },
      body: {
        skillName: 'Latte Art Mastery',
        category: 'BARISTA',
        proficiency: 'EXPERT',
      },
    });

    assert.equal(res.statusCode, 201);
    assert.equal(res.body.data.skill.proficiency, 'EXPERT');
  });

  await t.test('9. POST /api/v1/employees/:userId/documents/generate creates template-versioned HR letter', async () => {
    t.mock.method(EmployeeDocument, 'create', async (doc) => ({ ...doc, save: async function () { return this; } }));

    const res = await makeRequest({
      port,
      method: 'POST',
      path: '/api/v1/employees/ST-0004/documents/generate',
      headers: { Authorization: 'Bearer token_primary_master' },
      body: {
        category: 'CONFIRMATION_LETTER',
        documentName: 'Probation Confirmation Letter',
      },
    });

    assert.equal(res.statusCode, 201);
    assert.equal(res.body.data.document.templateVersion, 'v2.0');
  });

  await t.test('10. GET /api/v1/employees/integrity checks organisation compliance', async () => {
    t.mock.method(User, 'find', () => createQueryWrapper([
      { userId: 'ST-0007', name: 'Orphan Staff', employmentStatus: 'ACTIVE', managerUserId: null, isPrimaryMaster: false },
    ]));
    t.mock.method(Position, 'find', () => createQueryWrapper([]));
    t.mock.method(EmployeeTraining, 'find', () => createQueryWrapper([]));

    const res = await makeRequest({
      port,
      method: 'GET',
      path: '/api/v1/employees/integrity',
      headers: { Authorization: 'Bearer token_primary_master' },
    });

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.data.totalIssues, 1);
    assert.equal(res.body.data.issues[0].category, 'ORGANISATION_HIERARCHY');
  });
});
