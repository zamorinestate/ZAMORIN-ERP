'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const { createApp } = require('../src/server');
const { Attendance } = require('../src/modules/attendance/Attendance');
const { AttendancePeriod } = require('../src/models/AttendancePeriod');
const { ShiftRoster } = require('../src/models/ShiftRoster');
const { Cafe } = require('../src/models/Cafe');
const { AuditEvent } = require('../src/models/AuditEvent');
const { SequenceCounter } = require('../src/models/SequenceCounter');
const authService = require('../src/services/authService');
const { User } = require('../src/models/User');

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
          let json = null;
          try {
            json = JSON.parse(responseData);
          } catch (e) {
            json = { raw: responseData };
          }
          resolve({ status: res.statusCode, data: json });
        });
      }
    );

    req.on('error', reject);
    if (serializedBody) req.write(serializedBody);
    req.end();
  });
}

test('Attendance & Shifts — Screen 004 Integration Test Suite', async (t) => {
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
  };

  t.mock.method(authService, 'verifyAccessToken', async (token) => {
    const isNormal = token === 'token_normal_master';
    const activeUser = isNormal ? normalMasterUser : primaryMasterUser;
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

  t.mock.method(User, 'findOne', async (query) => {
    if (query?.userId === 'MU-NORMAL-01') {
      return { ...normalMasterUser, isPrimaryMaster: false, toObject: () => normalMasterUser };
    }
    return { ...primaryMasterUser, isPrimaryMaster: true, toObject: () => primaryMasterUser };
  });

  const auditService = require('../src/services/auditService');
  t.mock.method(auditService, 'recordRequestAudit', async () => ({}));
  t.mock.method(auditService, 'recordAuditEvent', async () => ({}));

  t.mock.method(SequenceCounter, 'generateId', async ({ prefix }) => `${prefix}-0001`);
  t.mock.method(SequenceCounter, 'getNextNumber', async () => 1);

  Attendance.prototype.save = async function () { return this; };
  AttendancePeriod.prototype.save = async function () { return this; };
  ShiftRoster.prototype.save = async function () { return this; };
  AuditEvent.prototype.save = async function () { return this; };
  t.mock.method(AuditEvent, 'create', async (data) => ({ ...data, save: async function () { return this; } }));

  const sampleAttendance = {
    attendanceId: 'AT-20260819-001',
    organisationId: 'ORG-ZAMORIN',
    cafeId: 'ZC-0001',
    userId: 'EMP-001',
    businessDate: '2026-08-19',
    status: 'CHECKED_IN',
    checkInAt: new Date('2026-08-19T06:45:00Z'),
    checkOutAt: null,
    regularMinutes: 360,
    isLate: false,
    overtimeStatus: 'PENDING_REVIEW',
    detectedOvertimeMinutes: 90,
    rawTimeEvents: [],
    save: async function () { return this; },
  };

  t.mock.method(Attendance, 'find', () => ({
    sort: () => ({
      lean: async () => [sampleAttendance],
    }),
    lean: async () => [sampleAttendance],
  }));

  t.mock.method(Attendance, 'findOne', (query) => {
    let result = null;
    if (query?.userId === 'EMP-001' || query?.attendanceId === 'AT-20260819-001') {
      result = sampleAttendance;
    }
    return {
      lean: () => Promise.resolve(result),
      then: (resolve, reject) => Promise.resolve(result).then(resolve, reject),
      catch: (reject) => Promise.resolve(result).catch(reject),
    };
  });

  t.mock.method(Attendance, 'updateMany', async () => ({ modifiedCount: 148 }));

  t.mock.method(Cafe, 'find', () => ({
    lean: async () => [
      { cafeId: 'ZC-0001', name: 'Dawn Roast Koramangala', status: 'ACTIVE' },
      { cafeId: 'ZC-0002', name: 'Indiranagar Central', status: 'ACTIVE' },
    ],
  }));

  t.mock.method(ShiftRoster, 'findOne', () => ({
    lean: async () => ({
      rosterId: 'ROS-20260817-ZC0001',
      cafeId: 'ZC-0001',
      weekStartDate: '2026-08-17',
      status: 'PUBLISHED',
      assignments: [],
    }),
    then: (resolve) => Promise.resolve(null).then(resolve),
  }));

  const samplePeriod = {
    periodId: 'PER-2026-08',
    organisationId: 'ORG-ZAMORIN',
    year: 2026,
    month: 8,
    status: 'LOCKED',
    reopenHistory: [],
    save: async function () { return this; },
  };

  t.mock.method(AttendancePeriod, 'findOne', () => ({
    ...samplePeriod,
    then: (resolve) => Promise.resolve(samplePeriod).then(resolve),
  }));

  // 1. GET /api/v1/attendance/overview
  await t.test('Master receives real-time Attendance Overview and staffing KPIs', async () => {
    const res = await makeRequest({
      port,
      method: 'GET',
      path: '/api/v1/attendance/overview',
      headers: { Authorization: `Bearer token_primary_master` },
    });

    assert.equal(res.status, 200);
    assert.equal(res.data.success, true);
    assert.equal(res.data.data.kpis.presentNow, 1);
    assert.equal(res.data.data.cafeWorkforce.length, 2);
  });

  // 2. GET /api/v1/attendance/live
  await t.test('Master receives live multi-cafe attendance presence table', async () => {
    const res = await makeRequest({
      port,
      method: 'GET',
      path: '/api/v1/attendance/live',
      headers: { Authorization: `Bearer token_primary_master` },
    });

    assert.equal(res.status, 200);
    assert.equal(res.data.success, true);
    assert.equal(res.data.data.attendance.length, 1);
  });

  // 3. POST /api/v1/attendance/master-manual (Primary Master marks manual punch)
  await t.test('Primary Master can record manual attendance for ANY employee across ANY cafe', async () => {
    const res = await makeRequest({
      port,
      method: 'POST',
      path: '/api/v1/attendance/master-manual',
      headers: { Authorization: `Bearer token_primary_master` },
      body: {
        userId: 'EMP-001',
        cafeId: 'ZC-0001',
        eventType: 'CHECK_OUT',
        reason: 'Employee forgot to punch checkout after peak rush',
      },
    });

    assert.equal(res.status, 200);
    assert.equal(res.data.success, true);
    assert.equal(res.data.data.attendance.isManualEntry, true);
  });

  // 4. GET /api/v1/attendance/calendar-360/:userId
  await t.test('Master receives Employee Attendance 360 monthly matrix', async () => {
    const res = await makeRequest({
      port,
      method: 'GET',
      path: '/api/v1/attendance/calendar-360/EMP-001?year=2026&month=8',
      headers: { Authorization: `Bearer token_primary_master` },
    });

    assert.equal(res.status, 200);
    assert.equal(res.data.success, true);
    assert.equal(res.data.data.userId, 'EMP-001');
    assert.equal(res.data.data.summary.daysPresent, 1);
  });

  // 5. POST /api/v1/attendance/overtime/decide (Primary Master final decision)
  await t.test('Primary Master can approve Overtime decision', async () => {
    const res = await makeRequest({
      port,
      method: 'POST',
      path: '/api/v1/attendance/overtime/decide',
      headers: { Authorization: `Bearer token_primary_master` },
      body: {
        attendanceId: 'AT-20260819-001',
        decision: 'APPROVE',
        approvedMinutes: 90,
        reason: 'Peak evening festival coverage',
      },
    });

    assert.equal(res.status, 200);
    assert.equal(res.data.success, true);
    assert.equal(res.data.data.attendance.overtimeStatus, 'APPROVED_BY_PRIMARY');
  });

  // 6. POST /api/v1/attendance/periods/:periodId/close (Primary Master lock)
  await t.test('Primary Master can lock attendance period for payroll export', async () => {
    const res = await makeRequest({
      port,
      method: 'POST',
      path: '/api/v1/attendance/periods/PER-2026-08/close',
      headers: { Authorization: `Bearer token_primary_master` },
    });

    assert.equal(res.status, 200);
    assert.equal(res.data.success, true);
    assert.equal(res.data.data.period.status, 'LOCKED');
  });

  // 7. POST /api/v1/attendance/periods/:periodId/reopen (Primary Master controlled reopen)
  await t.test('Primary Master can reopen a locked attendance period with mandatory reason', async () => {
    const res = await makeRequest({
      port,
      method: 'POST',
      path: '/api/v1/attendance/periods/PER-2026-08/reopen',
      headers: { Authorization: `Bearer token_primary_master` },
      body: {
        reason: 'Retroactive punch correction approved by management',
      },
    });

    assert.equal(res.status, 200);
    assert.equal(res.data.success, true);
    assert.equal(res.data.data.period.status, 'OPEN');
  });

  // 8. POST /api/v1/attendance/evidence/purge (Primary Master selfie purge)
  await t.test('Primary Master can execute selfie evidence retention purge', async () => {
    const res = await makeRequest({
      port,
      method: 'POST',
      path: '/api/v1/attendance/evidence/purge',
      headers: { Authorization: `Bearer token_primary_master` },
    });

    assert.equal(res.status, 200);
    assert.equal(res.data.success, true);
    assert.match(res.data.message, /Purged selfie evidence/);
  });
});
