'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const { createApp } = require('../src/server');
const { Attendance } = require('../src/modules/attendance/Attendance');
const { User } = require('../src/models/User');
const authService = require('../src/services/authService');
const { calculateAttendanceMetrics } = require('../src/services/attendanceCalculationService');
const { getWeekStartDate, buildShiftDateTime } = require('../src/services/shiftResolverService');

// ── Unit: overnight calculation ──────────────────────────────────────────────
test('Overnight shift: worked minutes span midnight correctly', () => {
  const checkInAt = new Date('2026-11-18T22:00:00.000Z');
  const checkOutAt = new Date('2026-11-19T06:00:00.000Z');
  const metrics = calculateAttendanceMetrics({
    checkInAt,
    checkOutAt,
    breaks: [],
    scheduledStartAt: new Date('2026-11-18T22:00:00.000Z'),
    scheduledEndAt: new Date('2026-11-19T06:00:00.000Z'),
  });
  assert.equal(metrics.grossMinutes, 480);
  assert.equal(metrics.totalWorkedMinutes, 480);
  assert.equal(metrics.payableMinutes, 480);
});

test('Overnight shift: break minutes deducted', () => {
  const checkInAt = new Date('2026-11-18T22:00:00.000Z');
  const checkOutAt = new Date('2026-11-19T06:00:00.000Z');
  const metrics = calculateAttendanceMetrics({
    checkInAt,
    checkOutAt,
    breaks: [{ startedAt: new Date('2026-11-19T01:00:00.000Z'), endedAt: new Date('2026-11-19T01:30:00.000Z'), durationMinutes: 30, isPaid: false }],
    scheduledStartAt: new Date('2026-11-18T22:00:00.000Z'),
    scheduledEndAt: new Date('2026-11-19T06:00:00.000Z'),
  });
  assert.equal(metrics.grossMinutes, 480);
  assert.equal(metrics.breakMinutes, 30);
  assert.equal(metrics.totalWorkedMinutes, 450);
});

test('Overnight shift: missing checkout yields zero worked minutes', () => {
  const metrics = calculateAttendanceMetrics({
    checkInAt: new Date('2026-11-18T22:00:00.000Z'),
    checkOutAt: null,
    scheduledStartAt: new Date('2026-11-18T22:00:00.000Z'),
    scheduledEndAt: new Date('2026-11-19T06:00:00.000Z'),
  });
  assert.equal(metrics.totalWorkedMinutes, 0);
  assert.equal(metrics.payableMinutes, 0);
});

// ── Unit: week start date ────────────────────────────────────────────────────
test('getWeekStartDate: Sunday rolls back to previous Monday', () => {
  // 2026-11-15 is a Sunday
  assert.equal(getWeekStartDate('2026-11-15'), '2026-11-09');
});

test('getWeekStartDate: Monday stays', () => {
  assert.equal(getWeekStartDate('2026-11-16'), '2026-11-16');
});

test('buildShiftDateTime: produces IST date', () => {
  const d = buildShiftDateTime('2026-11-18', '22:00');
  assert.ok(d instanceof Date);
  assert.ok(!isNaN(d.getTime()));
});

// ── Integration: getStaffToday detects open overnight session ─────────────────
test('getStaffToday: open overnight session → canCheckOut true, canCheckIn false', async (t) => {
  const app = createApp({ allowedOrigins: ['*'], production: false });
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  t.after(async () => new Promise((resolve) => server.close(resolve)));

  const primaryMasterUser = {
    userId: 'EMP-OVN-01',
    role: 'STAFF',
    isPrimaryMaster: false,
    organisationId: 'ORG-ZAMORIN',
    email: 'ovn@zamorincafe.com',
    fullName: 'Overnight Staff',
    sessionVersion: 1,
    permissionsVersion: 1,
    primaryCafeId: 'ZC-0001',
    assignedCafeIds: ['ZC-0001'],
    primaryCafeName: 'Dawn Roast Koramangala',
  };

  t.mock.method(authService, 'verifyAccessToken', async () => ({
    payload: {
      sub: primaryMasterUser.userId,
      org: primaryMasterUser.organisationId,
      role: primaryMasterUser.role,
      isPrimaryMaster: false,
      sv: 0,
      usv: 1,
      pv: 1,
      sid: 'SS-OVN-001',
    },
    session: {
      sessionId: 'SS-OVN-001',
      roleSnapshot: primaryMasterUser.role,
      sessionVersion: 0,
      mfaVerified: true,
      stepUpVerifiedAt: new Date().toISOString(),
    },
  }));

  t.mock.method(User, 'findOne', async () => ({
    ...primaryMasterUser,
    toObject: () => primaryMasterUser,
  }));

  const openSession = {
    attendanceId: 'AT-20261118-001',
    organisationId: 'ORG-ZAMORIN',
    userId: 'EMP-OVN-01',
    cafeId: 'ZC-0001',
    businessDate: '2026-11-18',
    status: 'CHECKED_IN',
    checkInAt: new Date('2026-11-18T22:00:00.000Z'),
    checkOutAt: null,
    scheduledStartAt: new Date('2026-11-18T22:00:00.000Z'),
    scheduledEndAt: new Date('2026-11-19T06:00:00.000Z'),
    shiftId: 'SH-NIGHT',
    shiftName: 'Night Shift',
    rawTimeEvents: [],
    save: async function () { return this; },
  };

  t.mock.method(Attendance, 'findOne', (query) => {
    const q = query || {};
    if (q && q.status && q.status.$in) {
      return {
        sort: () => ({ lean: async () => openSession }),
      };
    }
    return { lean: async () => null, then: (r) => Promise.resolve(null).then(r) };
  });

  const makeRequest = (path) => new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port, method: 'GET', path, headers: { Authorization: 'Bearer tok_ovn' } }, (res) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(d); } catch (e) { json = { raw: d }; }
        resolve({ status: res.statusCode, data: json });
      });
    });
    req.on('error', reject);
    req.end();
  });

  const res = await makeRequest('/api/v1/attendance/today');
  assert.equal(res.status, 200);
  assert.equal(res.data.success, true);
  assert.equal(res.data.data.canCheckOut, true);
  assert.equal(res.data.data.canCheckIn, false);
  assert.equal(res.data.data.attendance.status, 'CHECKED_IN');
});
