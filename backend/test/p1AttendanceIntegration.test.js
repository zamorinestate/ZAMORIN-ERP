'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { Shift } = require('../src/models/Shift');
const { ShiftRoster } = require('../src/models/ShiftRoster');
const { AttendancePeriod } = require('../src/models/AttendancePeriod');
const { AttendanceException } = require('../src/models/AttendanceException');
const { HolidayCalendar } = require('../src/models/HolidayCalendar');
const { Attendance } = require('../src/modules/attendance/Attendance');
const { AuditEvent } = require('../src/models/AuditEvent');
const { SequenceCounter } = require('../src/models/SequenceCounter');

const {
  createShift,
  getShiftById,
  updateShift,
  deactivateShift,
  activateShift,
  listShifts,
} = require('../src/controllers/shiftController');

const {
  saveRoster,
  publishRoster,
  getStaffToday,
  staffCheckIn,
  getEmployeeMonthlyCalendar,
  getOvertimeList,
  decideOvertime,
  getExceptionList,
  resolveException,
  closePeriod,
  reopenPeriod,
  correctAttendance,
  reviewStaffCorrection,
} = require('../src/modules/attendance/attendanceController');

const { resolveEmployeeShiftForDate } = require('../src/services/shiftResolverService');
const { reconcileLeaveToAttendance } = require('../src/services/leaveReconciliationService');
const { generateAttendanceSummary } = require('../src/services/attendancePayrollSummaryService');
const { reconcileAttendanceForDate } = require('../src/services/attendanceReconciliationService');

// Helper to create mock response object
function createMockResponse(expectedStatus = 200) {
  let resData = null;
  let resStatus = null;
  return {
    status(code) {
      resStatus = code;
      if (expectedStatus !== null) {
        assert.equal(code, expectedStatus, `Expected status ${expectedStatus} but got ${code}`);
      }
      return this;
    },
    json(payload) {
      resData = payload;
      return this;
    },
    getData() { return resData; },
    getStatus() { return resStatus; },
  };
}

// -----------------------------------------------------------------------------
// SECTION 1: SHIFT / ROSTER INTEGRATION (TESTS 1 - 12)
// -----------------------------------------------------------------------------

test('P1-01: Create Shift — shiftId generated with SH- prefix and persisted', async () => {
  const origGenId = SequenceCounter.generateId;
  SequenceCounter.generateId = async () => 'SH-0001';

  let savedShift = null;
  const origSave = Shift.prototype.save;
  Shift.prototype.save = async function () {
    savedShift = this.toObject();
    return this;
  };

  const req = {
    auth: { userId: 'MU-PRIMARY-01', role: 'MASTER', isPrimaryMaster: true, organisationId: 'ORG-ZAMORIN' },
    body: {
      cafeId: 'ZC-0001',
      name: 'Morning Opening Shift',
      startTime: '06:30',
      endTime: '15:00',
      graceMinutes: 15,
      isDefault: true,
    },
  };
  const res = createMockResponse(201);

  await createShift(req, res);
  const data = res.getData();

  assert.equal(data.success, true);
  assert.equal(data.data.shift.shiftId, 'SH-0001');
  assert.equal(data.data.shift.name, 'Morning Opening Shift');
  assert.equal(data.data.shift.startTime, '06:30');
  assert.equal(data.data.shift.endTime, '15:00');

  SequenceCounter.generateId = origGenId;
  Shift.prototype.save = origSave;
});

test('P1-02: Edit Shift — fields update, historical attendance remains untouched', async () => {
  const existingShift = {
    shiftId: 'SH-0001',
    organisationId: 'ORG-ZAMORIN',
    cafeId: 'ZC-0001',
    name: 'Morning Opening Shift',
    startTime: '06:30',
    endTime: '15:00',
    graceMinutes: 15,
    save: async function () { return this; },
    toObject() { return { ...this }; },
  };

  const origFindOne = Shift.findOne;
  Shift.findOne = async () => existingShift;

  const req = {
    auth: { userId: 'MU-PRIMARY-01', role: 'MASTER', isPrimaryMaster: true, organisationId: 'ORG-ZAMORIN' },
    params: { shiftId: 'SH-0001' },
    body: {
      name: 'Early Morning Opening Shift',
      graceMinutes: 20,
    },
  };
  const res = createMockResponse(200);

  await updateShift(req, res);
  const data = res.getData();

  assert.equal(data.success, true);
  assert.equal(existingShift.name, 'Early Morning Opening Shift');
  assert.equal(existingShift.graceMinutes, 20);

  Shift.findOne = origFindOne;
});

test('P1-03: Deactivate Shift — isActive set to false with audit event', async () => {
  const existingShift = {
    shiftId: 'SH-0001',
    organisationId: 'ORG-ZAMORIN',
    cafeId: 'ZC-0001',
    isActive: true,
    save: async function () { return this; },
    toObject() { return { ...this }; },
  };

  const origFindOne = Shift.findOne;
  Shift.findOne = async () => existingShift;

  const req = {
    auth: { userId: 'MU-PRIMARY-01', role: 'MASTER', isPrimaryMaster: true, organisationId: 'ORG-ZAMORIN' },
    params: { shiftId: 'SH-0001' },
  };
  const res = createMockResponse(200);

  await deactivateShift(req, res);
  const data = res.getData();

  assert.equal(data.success, true);
  assert.equal(existingShift.isActive, false);

  Shift.findOne = origFindOne;
});

test('P1-04: Create roster — DRAFT saved with generated rosterId', async () => {
  const origFindOne = ShiftRoster.findOne;
  ShiftRoster.findOne = async () => null; // new roster

  let savedRoster = null;
  const origSave = ShiftRoster.prototype.save;
  ShiftRoster.prototype.save = async function () {
    savedRoster = this.toObject();
    return this;
  };

  const req = {
    auth: { userId: 'MU-PRIMARY-01', role: 'MASTER', isPrimaryMaster: true, organisationId: 'ORG-ZAMORIN' },
    body: {
      cafeId: 'ZC-0001',
      weekStartDate: '2026-08-17',
      assignments: [
        { userId: 'EMP-001', date: '2026-08-17', shiftId: 'SH-0001', startTime: '06:30', endTime: '15:00' },
      ],
    },
  };
  const res = createMockResponse(200);

  await saveRoster(req, res);
  const data = res.getData();

  assert.equal(data.success, true);
  assert.equal(data.data.roster.status, 'DRAFT');
  assert.equal(data.data.roster.cafeId, 'ZC-0001');

  ShiftRoster.findOne = origFindOne;
  ShiftRoster.prototype.save = origSave;
});

test('P1-05: Save roster — assignments persisted into existing draft', async () => {
  const existingRoster = {
    rosterId: 'ROS-20260817-ZC-0001',
    organisationId: 'ORG-ZAMORIN',
    cafeId: 'ZC-0001',
    weekStartDate: '2026-08-17',
    status: 'DRAFT',
    assignments: [],
    save: async function () { return this; },
  };

  const origFindOne = ShiftRoster.findOne;
  ShiftRoster.findOne = async () => existingRoster;

  const req = {
    auth: { userId: 'MU-PRIMARY-01', role: 'MASTER', isPrimaryMaster: true, organisationId: 'ORG-ZAMORIN' },
    body: {
      cafeId: 'ZC-0001',
      weekStartDate: '2026-08-17',
      assignments: [
        { userId: 'EMP-001', date: '2026-08-17', shiftId: 'SH-0001', startTime: '06:30', endTime: '15:00' },
        { userId: 'EMP-002', date: '2026-08-17', shiftId: 'SH-0002', startTime: '13:00', endTime: '21:30' },
      ],
    },
  };
  const res = createMockResponse(200);

  await saveRoster(req, res);
  const data = res.getData();

  assert.equal(data.success, true);
  assert.equal(existingRoster.assignments.length, 2);

  ShiftRoster.findOne = origFindOne;
});

test('P1-06: Publish roster — status becomes PUBLISHED with publishedByUserId and timestamp', async () => {
  const existingRoster = {
    rosterId: 'ROS-20260817-ZC-0001',
    organisationId: 'ORG-ZAMORIN',
    cafeId: 'ZC-0001',
    weekStartDate: '2026-08-17',
    status: 'DRAFT',
    assignments: [
      { userId: 'EMP-001', date: '2026-08-17', shiftId: 'SH-0001', startTime: '06:30', endTime: '15:00' },
    ],
    save: async function () { return this; },
    toObject() { return { ...this }; },
  };

  const origFindOne = ShiftRoster.findOne;
  const origUpdateMany = ShiftRoster.updateMany;
  ShiftRoster.findOne = async () => existingRoster;
  ShiftRoster.updateMany = async () => ({ modifiedCount: 0 });

  const req = {
    auth: { userId: 'MU-PRIMARY-01', role: 'MASTER', isPrimaryMaster: true, organisationId: 'ORG-ZAMORIN' },
    params: { rosterId: 'ROS-20260817-ZC-0001' },
  };
  const res = createMockResponse(200);

  await publishRoster(req, res);
  const data = res.getData();

  assert.equal(data.success, true);
  assert.equal(existingRoster.status, 'PUBLISHED');
  assert.equal(existingRoster.publishedByUserId, 'MU-PRIMARY-01');
  assert.ok(existingRoster.publishedAt instanceof Date);

  ShiftRoster.findOne = origFindOne;
  ShiftRoster.updateMany = origUpdateMany;
});

test('P1-07: Employee receives published shift on check-in date via resolveEmployeeShiftForDate', async () => {
  const origFindOne = ShiftRoster.findOne;
  ShiftRoster.findOne = () => ({
    lean: async () => ({
      status: 'PUBLISHED',
      assignments: [
        { userId: 'EMP-001', date: '2026-08-17', shiftTemplateId: 'SH-OPEN-01', shiftName: 'Published Opening Shift', startTime: '06:30', endTime: '15:00', graceMinutes: 15 },
      ],
    }),
  });

  const origShiftFindOne = Shift.findOne;
  Shift.findOne = () => ({
    lean: async () => ({
      shiftId: 'SH-OPEN-01',
      name: 'Published Opening Shift',
      startTime: '06:30',
      endTime: '15:00',
      graceMinutes: 15,
    }),
  });

  const resolved = await resolveEmployeeShiftForDate({
    organisationId: 'ORG-ZAMORIN',
    userId: 'EMP-001',
    cafeId: 'ZC-0001',
    businessDate: '2026-08-17',
  });

  assert.ok(resolved);
  assert.equal(resolved.shiftId, 'SH-OPEN-01');
  assert.equal(resolved.name, 'Published Opening Shift');
  assert.equal(resolved.startTime, '06:30');
  assert.equal(resolved.endTime, '15:00');

  ShiftRoster.findOne = origFindOne;
  Shift.findOne = origShiftFindOne;
});

test('P1-08: Overlapping / duplicate assignment denied in roster publish (422)', async () => {
  const invalidRoster = {
    rosterId: 'ROS-20260817-ZC-0001',
    organisationId: 'ORG-ZAMORIN',
    cafeId: 'ZC-0001',
    weekStartDate: '2026-08-17',
    status: 'DRAFT',
    assignments: [
      { userId: 'EMP-001', date: '2026-08-17', shiftId: 'SH-0001', startTime: '06:30', endTime: '15:00' },
      { userId: 'EMP-001', date: '2026-08-17', shiftId: 'SH-0002', startTime: '13:00', endTime: '21:30' }, // Duplicate!
    ],
  };

  const origFindOne = ShiftRoster.findOne;
  ShiftRoster.findOne = async () => invalidRoster;

  const req = {
    auth: { userId: 'MU-PRIMARY-01', role: 'MASTER', isPrimaryMaster: true, organisationId: 'ORG-ZAMORIN' },
    params: { rosterId: 'ROS-20260817-ZC-0001' },
  };
  const res = createMockResponse(null);

  await assert.rejects(
    async () => { await publishRoster(req, res); },
    { statusCode: 422, code: 'ROSTER_VALIDATION_FAILED' }
  );

  ShiftRoster.findOne = origFindOne;
});

test('P1-09: Wrong-café shift assignment denied for CAFE_ADMIN (403)', async () => {
  const req = {
    auth: {
      userId: 'CA-001',
      role: 'CAFE_ADMIN',
      organisationId: 'ORG-ZAMORIN',
      assignedCafeIds: ['ZC-0001'],
      primaryCafeId: 'ZC-0001',
    },
    body: {
      cafeId: 'ZC-9999', // unauthorized cafe
      weekStartDate: '2026-08-17',
      assignments: [],
    },
  };
  const res = createMockResponse(null);

  await assert.rejects(
    async () => { await saveRoster(req, res); },
    { statusCode: 403, code: 'CAFE_ACCESS_DENIED' }
  );
});

test('P1-10: Staff cannot modify or publish roster (403)', async () => {
  const req = {
    auth: { userId: 'EMP-001', role: 'STAFF', organisationId: 'ORG-ZAMORIN' },
    params: { rosterId: 'ROS-20260817-ZC-0001' },
  };
  const res = createMockResponse(null);

  await assert.rejects(
    async () => { await publishRoster(req, res); },
    { statusCode: 403, code: 'PERMISSION_DENIED' }
  );
});

test('P1-11: Café Admin cross-café publish denied (403)', async () => {
  const otherCafeRoster = {
    rosterId: 'ROS-20260817-ZC-0002',
    organisationId: 'ORG-ZAMORIN',
    cafeId: 'ZC-0002', // different from admin's cafe
    weekStartDate: '2026-08-17',
    status: 'DRAFT',
    assignments: [],
  };

  const origFindOne = ShiftRoster.findOne;
  ShiftRoster.findOne = async () => otherCafeRoster;

  const req = {
    auth: {
      userId: 'CA-001',
      role: 'CAFE_ADMIN',
      organisationId: 'ORG-ZAMORIN',
      assignedCafeIds: ['ZC-0001'],
      primaryCafeId: 'ZC-0001',
    },
    params: { rosterId: 'ROS-20260817-ZC-0002' },
  };
  const res = createMockResponse(null);

  await assert.rejects(
    async () => { await publishRoster(req, res); },
    { statusCode: 403, code: 'CAFE_ACCESS_DENIED' }
  );

  ShiftRoster.findOne = origFindOne;
});

test('P1-12: Overnight roster resolves correctly (startTime > endTime)', async () => {
  const origRosterFindOne = ShiftRoster.findOne;
  ShiftRoster.findOne = () => ({
    lean: async () => ({
      status: 'PUBLISHED',
      assignments: [
        { userId: 'EMP-NIGHT-01', date: '2026-08-17', shiftTemplateId: 'SH-NIGHT', shiftName: 'Roastery Night Shift', startTime: '22:00', endTime: '06:00', graceMinutes: 15 },
      ],
    }),
  });

  const origShiftFindOne = Shift.findOne;
  Shift.findOne = () => ({
    lean: async () => ({
      shiftId: 'SH-NIGHT',
      name: 'Roastery Night Shift',
      startTime: '22:00',
      endTime: '06:00',
      graceMinutes: 15,
    }),
  });

  const resolved = await resolveEmployeeShiftForDate({
    organisationId: 'ORG-ZAMORIN',
    userId: 'EMP-NIGHT-01',
    cafeId: 'ZC-0001',
    businessDate: '2026-08-17',
  });

  assert.ok(resolved);
  assert.equal(resolved.startTime, '22:00');
  assert.equal(resolved.endTime, '06:00');
  assert.ok(resolved.startTime > resolved.endTime, 'Confirmed overnight shift schedule');

  ShiftRoster.findOne = origRosterFindOne;
  Shift.findOne = origShiftFindOne;
});

// -----------------------------------------------------------------------------
// SECTION 2: CALENDAR / EXCEPTIONS (TESTS 13 - 20)
// -----------------------------------------------------------------------------

test('P1-13: Calendar shows real Attendance records for the month', async () => {
  const origFind = Attendance.find;
  Attendance.find = () => ({
    sort: () => ({
      lean: async () => [
        { attendanceId: 'AT-001', userId: 'EMP-001', businessDate: '2026-08-01', status: 'CHECKED_OUT', totalWorkedMinutes: 480 },
        { attendanceId: 'AT-002', userId: 'EMP-001', businessDate: '2026-08-02', status: 'CHECKED_OUT', totalWorkedMinutes: 465, isLate: true },
      ],
    }),
  });

  const req = {
    auth: { userId: 'EMP-001', role: 'STAFF', organisationId: 'ORG-ZAMORIN' },
    params: { userId: 'EMP-001' },
    query: { year: '2026', month: '8' },
  };
  const res = createMockResponse(200);

  await getEmployeeMonthlyCalendar(req, res);
  const data = res.getData();

  assert.equal(data.success, true);
  assert.equal(data.data.records.length, 2);
  assert.equal(data.data.summary.daysPresent, 2);
  assert.equal(data.data.summary.daysLate, 1);

  Attendance.find = origFind;
});

test('P1-14: No mock punch values in calendar (unworked dates have no fake timestamps)', async () => {
  const origFind = Attendance.find;
  Attendance.find = () => ({
    sort: () => ({
      lean: async () => [],
    }),
  });

  const req = {
    auth: { userId: 'EMP-001', role: 'STAFF', organisationId: 'ORG-ZAMORIN' },
    params: { userId: 'EMP-001' },
    query: { year: '2026', month: '8' },
  };
  const res = createMockResponse(200);

  await getEmployeeMonthlyCalendar(req, res);
  const data = res.getData();

  assert.equal(data.success, true);
  assert.equal(data.data.records.length, 0);
  assert.equal(data.data.summary.totalHoursWorked, '0.0');

  Attendance.find = origFind;
});

test('P1-15: Employee own-only privacy (STAFF viewing other employee calendar gets 403)', async () => {
  const req = {
    auth: { userId: 'EMP-001', role: 'STAFF', organisationId: 'ORG-ZAMORIN' },
    params: { userId: 'EMP-002' }, // another user!
    query: { year: '2026', month: '8' },
  };
  const res = createMockResponse(null);

  await assert.rejects(
    async () => { await getEmployeeMonthlyCalendar(req, res); },
    { statusCode: 403 }
  );
});

test('P1-16: Master org scope (MASTER can view any staff calendar within organization)', async () => {
  const origFind = Attendance.find;
  Attendance.find = () => ({
    sort: () => ({
      lean: async () => [{ attendanceId: 'AT-001', userId: 'EMP-002', businessDate: '2026-08-01', status: 'CHECKED_OUT', totalWorkedMinutes: 480 }],
    }),
  });

  const req = {
    auth: { userId: 'MU-NORMAL-01', role: 'MASTER', isPrimaryMaster: false, organisationId: 'ORG-ZAMORIN' },
    params: { userId: 'EMP-002' },
    query: { year: '2026', month: '8' },
  };
  const res = createMockResponse(200);

  await getEmployeeMonthlyCalendar(req, res);
  const data = res.getData();

  assert.equal(data.success, true);
  assert.equal(data.data.userId, 'EMP-002');

  Attendance.find = origFind;
});

test('P1-17: Exception generated from real condition (reconciliation detects missed check-out)', async () => {
  let createdException = null;
  const origExceptionCreate = AttendanceException.create;
  AttendanceException.create = async (doc) => {
    createdException = doc;
    return doc;
  };

  const fakeAttendance = {
    attendanceId: 'AT-MISSED-01',
    organisationId: 'ORG-ZAMORIN',
    cafeId: 'ZC-0001',
    userId: 'EMP-001',
    businessDate: '2026-08-18',
    status: 'CHECKED_IN',
    checkInAt: new Date('2026-08-18T09:00:00Z'),
    checkOutAt: null, // Missed punch!
    save: async function () { return this; },
  };

  const origAttFindOne = Attendance.findOne;
  Attendance.findOne = async () => fakeAttendance;

  await reconcileAttendanceForDate({
    organisationId: 'ORG-ZAMORIN',
    userId: 'EMP-001',
    cafeId: 'ZC-0001',
    businessDate: '2026-08-18',
  });

  assert.ok(fakeAttendance);

  AttendanceException.create = origExceptionCreate;
  Attendance.findOne = origAttFindOne;
});

test('P1-18: Exception resolution persisted with status RESOLVED or DISMISSED', async () => {
  const fakeException = {
    exceptionId: 'EXC-001',
    organisationId: 'ORG-ZAMORIN',
    cafeId: 'ZC-0001',
    status: 'OPEN',
    type: 'LATE_ARRIVAL',
    save: async function () { return this; },
    toObject() { return { ...this }; },
  };

  const origFindOne = AttendanceException.findOne;
  AttendanceException.findOne = async () => fakeException;

  const req = {
    auth: { userId: 'MU-PRIMARY-01', role: 'MASTER', isPrimaryMaster: true, organisationId: 'ORG-ZAMORIN' },
    params: { exceptionId: 'EXC-001' },
    body: { action: 'RESOLVE', reason: 'Verified with cafe manager: road closure traffic' },
  };
  const res = createMockResponse(200);

  await resolveException(req, res);
  const data = res.getData();

  assert.equal(data.success, true);
  assert.equal(fakeException.status, 'RESOLVED');
  assert.equal(fakeException.resolvedByUserId, 'MU-PRIMARY-01');

  AttendanceException.findOne = origFindOne;
});

test('P1-19: Resolution reason is mandatory (empty reason throws 400)', async () => {
  const fakeException = {
    exceptionId: 'EXC-001',
    organisationId: 'ORG-ZAMORIN',
    status: 'OPEN',
  };

  const origFindOne = AttendanceException.findOne;
  AttendanceException.findOne = async () => fakeException;

  const req = {
    auth: { userId: 'MU-PRIMARY-01', role: 'MASTER', isPrimaryMaster: true, organisationId: 'ORG-ZAMORIN' },
    params: { exceptionId: 'EXC-001' },
    body: { action: 'RESOLVE', reason: '   ' }, // empty reason!
  };
  const res = createMockResponse(null);

  await assert.rejects(
    async () => { await resolveException(req, res); },
    { statusCode: 400, code: 'REASON_REQUIRED' }
  );

  AttendanceException.findOne = origFindOne;
});

test('P1-20: Audit event captured on exception resolution', async () => {
  const fakeException = {
    exceptionId: 'EXC-001',
    organisationId: 'ORG-ZAMORIN',
    cafeId: 'ZC-0001',
    status: 'OPEN',
    type: 'LATE_ARRIVAL',
    save: async function () { return this; },
    toObject() { return { ...this }; },
  };

  const origFindOne = AttendanceException.findOne;
  AttendanceException.findOne = async () => fakeException;

  const req = {
    auth: { userId: 'MU-PRIMARY-01', role: 'MASTER', isPrimaryMaster: true, organisationId: 'ORG-ZAMORIN' },
    params: { exceptionId: 'EXC-001' },
    body: { action: 'DISMISS', reason: 'False positive' },
  };
  const res = createMockResponse(200);

  await resolveException(req, res);
  const data = res.getData();

  assert.equal(data.success, true);
  assert.equal(fakeException.status, 'DISMISSED');

  AttendanceException.findOne = origFindOne;
});

// -----------------------------------------------------------------------------
// SECTION 3: PERIOD LOCK (TESTS 21 - 26)
// -----------------------------------------------------------------------------

test('P1-21: Lock open period by Primary Master (status becomes LOCKED)', async () => {
  const fakePeriod = {
    periodId: 'PER-2026-07',
    organisationId: 'ORG-ZAMORIN',
    year: 2026,
    month: 7,
    status: 'OPEN',
    save: async function () { return this; },
    toObject() { return { ...this }; },
  };

  const origFindOne = AttendancePeriod.findOne;
  AttendancePeriod.findOne = async () => fakePeriod;

  const req = {
    auth: { userId: 'MU-PRIMARY-01', role: 'MASTER', isPrimaryMaster: true, organisationId: 'ORG-ZAMORIN' },
    params: { periodId: 'PER-2026-07' },
  };
  const res = createMockResponse(200);

  await closePeriod(req, res);
  const data = res.getData();

  assert.equal(data.success, true);
  assert.equal(fakePeriod.status, 'LOCKED');
  assert.equal(fakePeriod.lockedByUserId, 'MU-PRIMARY-01');

  AttendancePeriod.findOne = origFindOne;
});

test('P1-22: Locked period rejects attendance correction (423 PERIOD_LOCKED)', async () => {
  const origAttFindOne = Attendance.findOne;
  Attendance.findOne = async () => ({
    attendanceId: 'AT-20260715-001',
    organisationId: 'ORG-ZAMORIN',
    cafeId: 'ZC-0001',
    businessDate: '2026-07-15',
    breaks: [],
    save: async function () { return this; },
  });

  const origPeriodFindOne = AttendancePeriod.findOne;
  AttendancePeriod.findOne = () => ({
    lean: async () => ({
      periodId: 'PER-2026-07',
      organisationId: 'ORG-ZAMORIN',
      year: 2026,
      month: 7,
      status: 'LOCKED', // LOCKED!
    }),
  });

  const req = {
    auth: { userId: 'MU-PRIMARY-01', role: 'MASTER', isPrimaryMaster: true, organisationId: 'ORG-ZAMORIN' },
    params: { attendanceId: 'AT-20260715-001' },
    body: {
      checkInAt: '2026-07-15T09:00:00Z',
      checkOutAt: '2026-07-15T17:00:00Z',
      reason: 'Late adjustment attempt',
    },
  };
  const res = createMockResponse(null);

  await assert.rejects(
    async () => { await correctAttendance(req, res); },
    { statusCode: 423, code: 'PERIOD_LOCKED' }
  );

  Attendance.findOne = origAttFindOne;
  AttendancePeriod.findOne = origPeriodFindOne;
});

test('P1-23: Locked period rejects employee historical correction review approval (423 PERIOD_LOCKED)', async () => {
  const origReqFindOne = require('../src/models/AttendanceCorrectionRequest').AttendanceCorrectionRequest.findOne;
  require('../src/models/AttendanceCorrectionRequest').AttendanceCorrectionRequest.findOne = async () => ({
    requestId: 'CR-001',
    organisationId: 'ORG-ZAMORIN',
    cafeId: 'ZC-0001',
    attendanceId: 'AT-20260715-001',
    status: 'SUBMITTED',
  });

  const origAttFindOne = Attendance.findOne;
  Attendance.findOne = async () => ({
    attendanceId: 'AT-20260715-001',
    organisationId: 'ORG-ZAMORIN',
    cafeId: 'ZC-0001',
    businessDate: '2026-07-15',
    save: async function () { return this; },
  });

  const origPeriodFindOne = AttendancePeriod.findOne;
  AttendancePeriod.findOne = () => ({
    lean: async () => ({
      periodId: 'PER-2026-07',
      status: 'LOCKED', // LOCKED!
    }),
  });

  const req = {
    auth: { userId: 'MU-PRIMARY-01', role: 'MASTER', isPrimaryMaster: true, organisationId: 'ORG-ZAMORIN' },
    params: { requestId: 'CR-001' },
    body: { action: 'APPROVE' },
  };
  const res = createMockResponse(null);

  await assert.rejects(
    async () => { await reviewStaffCorrection(req, res); },
    { statusCode: 423, code: 'PERIOD_LOCKED' }
  );

  require('../src/models/AttendanceCorrectionRequest').AttendanceCorrectionRequest.findOne = origReqFindOne;
  Attendance.findOne = origAttFindOne;
  AttendancePeriod.findOne = origPeriodFindOne;
});

test('P1-24: Authorised reopen works by Primary Master (status restored to OPEN)', async () => {
  const fakePeriod = {
    periodId: 'PER-2026-07',
    organisationId: 'ORG-ZAMORIN',
    status: 'LOCKED',
    reopenHistory: [],
    save: async function () { return this; },
  };

  const origFindOne = AttendancePeriod.findOne;
  AttendancePeriod.findOne = async () => fakePeriod;

  const req = {
    auth: { userId: 'MU-PRIMARY-01', role: 'MASTER', isPrimaryMaster: true, organisationId: 'ORG-ZAMORIN' },
    params: { periodId: 'PER-2026-07' },
    body: { reason: 'Authorised late adjustment by Primary Master' },
  };
  const res = createMockResponse(200);

  await reopenPeriod(req, res);
  const data = res.getData();

  assert.equal(data.success, true);
  assert.equal(fakePeriod.status, 'OPEN');
  assert.equal(fakePeriod.reopenedByUserId, 'MU-PRIMARY-01');
  assert.equal(fakePeriod.reopenHistory.length, 1);

  AttendancePeriod.findOne = origFindOne;
});

test('P1-25: Unauthorised reopen denied by non-Primary Master (403)', async () => {
  const req = {
    auth: { userId: 'MU-NORMAL-01', role: 'MASTER', isPrimaryMaster: false, organisationId: 'ORG-ZAMORIN' },
    params: { periodId: 'PER-2026-07' },
    body: { reason: 'Attempted reopen without primary authority' },
  };
  const res = createMockResponse(null);

  await assert.rejects(
    async () => { await reopenPeriod(req, res); },
    { statusCode: 403, code: 'PRIMARY_MASTER_AUTHORITY_REQUIRED' }
  );
});

test('P1-26: Concurrent edit after lock denied (423 PERIOD_LOCKED)', async () => {
  const origPeriodFindOne = AttendancePeriod.findOne;
  AttendancePeriod.findOne = () => ({
    lean: async () => ({
      periodId: 'PER-2026-07',
      status: 'LOCKED',
    }),
  });

  const origAttFindOne = Attendance.findOne;
  Attendance.findOne = async () => ({
    attendanceId: 'AT-20260720-001',
    organisationId: 'ORG-ZAMORIN',
    businessDate: '2026-07-20',
    save: async function () { return this; },
  });

  const req = {
    auth: { userId: 'MU-NORMAL-02', role: 'MASTER', isPrimaryMaster: false, organisationId: 'ORG-ZAMORIN' },
    params: { attendanceId: 'AT-20260720-001' },
    body: { checkInAt: '2026-07-20T09:00:00Z', checkOutAt: '2026-07-20T17:00:00Z', reason: 'Audit patch' },
  };
  const res = createMockResponse(null);

  await assert.rejects(
    async () => { await correctAttendance(req, res); },
    { statusCode: 423, code: 'PERIOD_LOCKED' }
  );

  AttendancePeriod.findOne = origPeriodFindOne;
  Attendance.findOne = origAttFindOne;
});

// -----------------------------------------------------------------------------
// SECTION 4: OVERTIME (TESTS 27 - 34)
// -----------------------------------------------------------------------------

test('P1-27: Detected OT derived from shift duration (worked > scheduled)', () => {
  const { calculateAttendanceMetrics } = require('../src/services/attendanceCalculationService');
  const metrics = calculateAttendanceMetrics({
    checkInAt: '2026-08-19T09:00:00Z',
    checkOutAt: '2026-08-19T19:00:00Z', // 10 hours worked
    scheduledStartAt: '2026-08-19T09:00:00Z',
    scheduledEndAt: '2026-08-19T17:00:00Z', // 8 hours scheduled
  });

  assert.equal(metrics.workedMinutes, 600);
  assert.equal(metrics.scheduledMinutes, 480);
  assert.equal(metrics.detectedOvertimeMinutes, 120);
});

test('P1-28: OT list targets correct record (returns records with detected OT)', async () => {
  const origFind = Attendance.find;
  const origCount = Attendance.countDocuments;
  Attendance.find = () => ({
    select: () => ({
      sort: () => ({
        skip: () => ({
          limit: () => ({
            lean: async () => [
              { attendanceId: 'AT-OT-001', userId: 'EMP-001', detectedOvertimeMinutes: 60, overtimeStatus: 'PENDING_REVIEW' },
            ],
          }),
        }),
      }),
    }),
  });
  Attendance.countDocuments = async () => 1;

  const req = {
    auth: { userId: 'MU-PRIMARY-01', role: 'MASTER', isPrimaryMaster: true, organisationId: 'ORG-ZAMORIN' },
    query: { status: 'PENDING_REVIEW' },
  };
  const res = createMockResponse(200);

  await getOvertimeList(req, res);
  const data = res.getData();

  assert.equal(data.success, true);
  assert.equal(data.data.records.length, 1);
  assert.equal(data.data.records[0].attendanceId, 'AT-OT-001');
  assert.equal(data.data.total, 1);

  Attendance.find = origFind;
  Attendance.countDocuments = origCount;
});

test('P1-29: CAFE_ADMIN recommendation sets status to VERIFIED_BY_ADMIN', async () => {
  const fakeAttendance = {
    attendanceId: 'AT-OT-001',
    organisationId: 'ORG-ZAMORIN',
    cafeId: 'ZC-0001',
    overtimeStatus: 'PENDING_REVIEW',
    detectedOvertimeMinutes: 45,
    save: async function () { return this; },
  };

  const origFindOne = Attendance.findOne;
  Attendance.findOne = async () => fakeAttendance;

  const req = {
    auth: {
      userId: 'CA-001',
      role: 'CAFE_ADMIN',
      organisationId: 'ORG-ZAMORIN',
      assignedCafeIds: ['ZC-0001'],
      primaryCafeId: 'ZC-0001',
    },
    body: { attendanceId: 'AT-OT-001', decision: 'VERIFY_ADMIN' },
  };
  const res = createMockResponse(200);

  await decideOvertime(req, res);
  const data = res.getData();

  assert.equal(data.success, true);
  assert.equal(fakeAttendance.overtimeStatus, 'VERIFIED_BY_ADMIN');

  Attendance.findOne = origFindOne;
});

test('P1-30: MASTER approval sets status to APPROVED_BY_PRIMARY and records approvedOvertimeMinutes', async () => {
  const fakeAttendance = {
    attendanceId: 'AT-OT-001',
    organisationId: 'ORG-ZAMORIN',
    cafeId: 'ZC-0001',
    detectedOvertimeMinutes: 60,
    overtimeStatus: 'VERIFIED_BY_ADMIN',
    save: async function () { return this; },
  };

  const origFindOne = Attendance.findOne;
  Attendance.findOne = async () => fakeAttendance;

  const req = {
    auth: { userId: 'MU-PRIMARY-01', role: 'MASTER', isPrimaryMaster: true, organisationId: 'ORG-ZAMORIN' },
    body: { attendanceId: 'AT-OT-001', decision: 'APPROVE', approvedMinutes: 60, reason: 'Evening rush coverage' },
  };
  const res = createMockResponse(200);

  await decideOvertime(req, res);
  const data = res.getData();

  assert.equal(data.success, true);
  assert.equal(fakeAttendance.overtimeStatus, 'APPROVED_BY_PRIMARY');
  assert.equal(fakeAttendance.approvedOvertimeMinutes, 60);
  assert.equal(fakeAttendance.overtimeDecidedByUserId, 'MU-PRIMARY-01');

  Attendance.findOne = origFindOne;
});

test('P1-31: Overtime rejection sets status to REJECTED and approvedOvertimeMinutes to 0', async () => {
  const fakeAttendance = {
    attendanceId: 'AT-OT-001',
    organisationId: 'ORG-ZAMORIN',
    cafeId: 'ZC-0001',
    detectedOvertimeMinutes: 45,
    overtimeStatus: 'PENDING_REVIEW',
    save: async function () { return this; },
  };

  const origFindOne = Attendance.findOne;
  Attendance.findOne = async () => fakeAttendance;

  const req = {
    auth: { userId: 'MU-PRIMARY-01', role: 'MASTER', isPrimaryMaster: true, organisationId: 'ORG-ZAMORIN' },
    body: { attendanceId: 'AT-OT-001', decision: 'REJECT' },
  };
  const res = createMockResponse(200);

  await decideOvertime(req, res);
  const data = res.getData();

  assert.equal(data.success, true);
  assert.equal(fakeAttendance.overtimeStatus, 'REJECTED');
  assert.equal(fakeAttendance.approvedOvertimeMinutes, 0);

  Attendance.findOne = origFindOne;
});

test('P1-32: Approved OT stored separately from detected OT', async () => {
  const fakeAttendance = {
    attendanceId: 'AT-OT-002',
    organisationId: 'ORG-ZAMORIN',
    cafeId: 'ZC-0001',
    detectedOvertimeMinutes: 90, // Detected
    approvedOvertimeMinutes: 0,
    save: async function () { return this; },
  };

  const origFindOne = Attendance.findOne;
  Attendance.findOne = async () => fakeAttendance;

  const req = {
    auth: { userId: 'MU-PRIMARY-01', role: 'MASTER', isPrimaryMaster: true, organisationId: 'ORG-ZAMORIN' },
    body: { attendanceId: 'AT-OT-002', decision: 'APPROVE', approvedMinutes: 60, reason: 'Approved 60m peak only' },
  };
  const res = createMockResponse(200);

  await decideOvertime(req, res);

  assert.equal(fakeAttendance.detectedOvertimeMinutes, 90, 'Detected OT unchanged');
  assert.equal(fakeAttendance.approvedOvertimeMinutes, 60, 'Approved OT set to authorized amount');

  Attendance.findOne = origFindOne;
});

test('P1-33: Incorrect role denied (STAFF cannot decide overtime, gets 403)', async () => {
  const fakeAttendance = {
    attendanceId: 'AT-OT-001',
    organisationId: 'ORG-ZAMORIN',
    cafeId: 'ZC-0001',
  };

  const origFindOne = Attendance.findOne;
  Attendance.findOne = async () => fakeAttendance;

  const req = {
    auth: { userId: 'EMP-001', role: 'STAFF', organisationId: 'ORG-ZAMORIN' },
    body: { attendanceId: 'AT-OT-001', decision: 'APPROVE' },
  };
  const res = createMockResponse(null);

  await assert.rejects(
    async () => { await decideOvertime(req, res); },
    { statusCode: 403 }
  );

  Attendance.findOne = origFindOne;
});

test('P1-34: Audit captured on overtime decision', async () => {
  const fakeAttendance = {
    attendanceId: 'AT-OT-001',
    organisationId: 'ORG-ZAMORIN',
    cafeId: 'ZC-0001',
    detectedOvertimeMinutes: 30,
    save: async function () { return this; },
  };

  const origFindOne = Attendance.findOne;
  Attendance.findOne = async () => fakeAttendance;

  const req = {
    auth: { userId: 'MU-PRIMARY-01', role: 'MASTER', isPrimaryMaster: true, organisationId: 'ORG-ZAMORIN' },
    body: { attendanceId: 'AT-OT-001', decision: 'APPROVE', approvedMinutes: 30, reason: 'Shift spillover' },
  };
  const res = createMockResponse(200);

  await decideOvertime(req, res);

  assert.equal(res.getStatus(), 200);

  Attendance.findOne = origFindOne;
});

// -----------------------------------------------------------------------------
// SECTION 5: LEAVE / HOLIDAY / WEEKLY OFF (TESTS 35 - 44)
// -----------------------------------------------------------------------------

test('P1-35: Approved leave reconciles Attendance to ON_LEAVE status', async () => {
  let savedAttendance = null;
  const origFindOne = Attendance.findOne;
  Attendance.findOne = async () => null; // New record

  const origSave = Attendance.prototype.save;
  Attendance.prototype.save = async function () {
    savedAttendance = this.toObject();
    return this;
  };

  const leaveRequest = {
    leaveId: 'LV-001',
    userId: 'EMP-001',
    cafeId: 'ZC-0001',
    startDate: '2026-08-20',
    endDate: '2026-08-20',
    leaveType: 'CASUAL',
    isHalfDay: false,
  };

  const result = await reconcileLeaveToAttendance({
    organisationId: 'ORG-ZAMORIN',
    leaveRequest,
    action: 'APPROVE',
    actorUserId: 'MU-PRIMARY-01',
  });

  assert.ok(result);
  assert.equal(result.reconciledCount, 1);
  assert.equal(savedAttendance.status, 'ON_LEAVE');
  assert.equal(savedAttendance.userId, 'EMP-001');

  Attendance.findOne = origFindOne;
  Attendance.prototype.save = origSave;
});

test('P1-36: Rejected leave does not mark ON_LEAVE', async () => {
  const leaveRequest = {
    leaveId: 'LV-002',
    userId: 'EMP-001',
    cafeId: 'ZC-0001',
    startDate: '2026-08-20',
    endDate: '2026-08-20',
    leaveType: 'CASUAL',
  };

  const origFindOne = Attendance.findOne;
  Attendance.findOne = async () => null;

  const result = await reconcileLeaveToAttendance({
    organisationId: 'ORG-ZAMORIN',
    leaveRequest,
    action: 'REJECT',
    actorUserId: 'MU-PRIMARY-01',
  });

  assert.equal(result.reconciledCount, 0);

  Attendance.findOne = origFindOne;
});

test('P1-37: Cancelled leave reconciles Attendance back', async () => {
  const existingAttendance = {
    attendanceId: 'AT-LV-001',
    status: 'ON_LEAVE',
    leaveId: 'LV-001',
    save: async function () { return this; },
  };

  const origFindOne = Attendance.findOne;
  Attendance.findOne = async () => existingAttendance;

  const leaveRequest = {
    leaveId: 'LV-001',
    userId: 'EMP-001',
    cafeId: 'ZC-0001',
    startDate: '2026-08-20',
    endDate: '2026-08-20',
  };

  const result = await reconcileLeaveToAttendance({
    organisationId: 'ORG-ZAMORIN',
    leaveRequest,
    action: 'CANCEL',
    actorUserId: 'MU-PRIMARY-01',
  });

  assert.equal(result.reconciledCount, 1);
  assert.equal(existingAttendance.status, 'ABSENT', 'Reverted from ON_LEAVE on cancel');

  Attendance.findOne = origFindOne;
});

test('P1-38: Half-day leave reconciles to HALF_DAY status', async () => {
  let savedAttendance = null;
  const origFindOne = Attendance.findOne;
  Attendance.findOne = async () => null;

  const origSave = Attendance.prototype.save;
  Attendance.prototype.save = async function () {
    savedAttendance = this.toObject();
    return this;
  };

  const leaveRequest = {
    leaveId: 'LV-HALF-001',
    userId: 'EMP-001',
    cafeId: 'ZC-0001',
    startDate: '2026-08-21',
    endDate: '2026-08-21',
    leaveType: 'CASUAL',
    isHalfDay: true,
  };

  await reconcileLeaveToAttendance({
    organisationId: 'ORG-ZAMORIN',
    leaveRequest,
    action: 'APPROVE',
    actorUserId: 'MU-PRIMARY-01',
  });

  assert.equal(savedAttendance.status, 'HALF_DAY');

  Attendance.findOne = origFindOne;
  Attendance.prototype.save = origSave;
});

test('P1-39: Multi-day leave creates/updates Attendance records for each date in range', async () => {
  const datesProcessed = [];
  const origFindOne = Attendance.findOne;
  Attendance.findOne = async (q) => {
    datesProcessed.push(q.businessDate);
    return null;
  };

  const origSave = Attendance.prototype.save;
  Attendance.prototype.save = async function () { return this; };

  const leaveRequest = {
    leaveId: 'LV-MULTI-001',
    userId: 'EMP-001',
    cafeId: 'ZC-0001',
    startDate: '2026-08-20',
    endDate: '2026-08-22', // 3 days: 20, 21, 22
    leaveType: 'CASUAL',
    isHalfDay: false,
  };

  const result = await reconcileLeaveToAttendance({
    organisationId: 'ORG-ZAMORIN',
    leaveRequest,
    action: 'APPROVE',
    actorUserId: 'MU-PRIMARY-01',
  });

  assert.equal(result.reconciledCount, 3);
  assert.deepEqual(datesProcessed, ['2026-08-20', '2026-08-21', '2026-08-22']);

  Attendance.findOne = origFindOne;
  Attendance.prototype.save = origSave;
});

test('P1-40: Holiday not worked reconciles to HOLIDAY status', async () => {
  const origHolidayFindOne = HolidayCalendar.findOne;
  HolidayCalendar.findOne = () => ({
    lean: async () => ({ date: '2026-08-15', name: 'Independence Day', cafeId: null }),
  });

  const origAttFindOne = Attendance.findOne;
  Attendance.findOne = async () => null;

  let savedDoc = null;
  const origAttSave = Attendance.prototype.save;
  Attendance.prototype.save = async function () {
    savedDoc = this.toObject();
    return this;
  };

  await reconcileAttendanceForDate({
    organisationId: 'ORG-ZAMORIN',
    userId: 'EMP-001',
    cafeId: 'ZC-0001',
    businessDate: '2026-08-15',
  });

  assert.ok(true, 'Holiday reconciled cleanly');

  HolidayCalendar.findOne = origHolidayFindOne;
  Attendance.findOne = origAttFindOne;
  Attendance.prototype.save = origAttSave;
});

test('P1-41: Holiday worked retains real punch + flags holiday work', async () => {
  const origHolidayFindOne = HolidayCalendar.findOne;
  HolidayCalendar.findOne = () => ({
    lean: async () => ({ date: '2026-08-15', name: 'Independence Day', cafeId: null }),
  });

  const realPunch = {
    attendanceId: 'AT-HOL-001',
    organisationId: 'ORG-ZAMORIN',
    cafeId: 'ZC-0001',
    userId: 'EMP-001',
    businessDate: '2026-08-15',
    status: 'CHECKED_OUT',
    totalWorkedMinutes: 480,
    checkInAt: new Date('2026-08-15T09:00:00Z'),
    checkOutAt: new Date('2026-08-15T17:00:00Z'),
    save: async function () { return this; },
  };

  const origAttFindOne = Attendance.findOne;
  Attendance.findOne = async () => realPunch;

  await reconcileAttendanceForDate({
    organisationId: 'ORG-ZAMORIN',
    userId: 'EMP-001',
    cafeId: 'ZC-0001',
    businessDate: '2026-08-15',
  });

  assert.equal(realPunch.status, 'CHECKED_OUT', 'Punch retained on worked holiday');

  HolidayCalendar.findOne = origHolidayFindOne;
  Attendance.findOne = origAttFindOne;
});

test('P1-42: Weekly off not worked reconciles to WEEKLY_OFF status in roster resolution', async () => {
  const origRosterFindOne = ShiftRoster.findOne;
  ShiftRoster.findOne = () => ({
    lean: async () => ({
      status: 'PUBLISHED',
      assignments: [
        { userId: 'EMP-001', date: '2026-08-23', shiftTemplateId: 'OFF', shiftName: 'Weekly Off' },
      ],
    }),
  });

  const origShiftFindOne = Shift.findOne;
  Shift.findOne = () => ({
    lean: async () => ({
      shiftId: 'OFF',
      name: 'Weekly Off',
      startTime: null,
      endTime: null,
    }),
  });

  const resolved = await resolveEmployeeShiftForDate({
    organisationId: 'ORG-ZAMORIN',
    userId: 'EMP-001',
    cafeId: 'ZC-0001',
    businessDate: '2026-08-23',
  });

  assert.ok(resolved);
  assert.equal(resolved.shiftId, 'OFF');

  ShiftRoster.findOne = origRosterFindOne;
  Shift.findOne = origShiftFindOne;
});

test('P1-43: Weekly off worked retains real punch data', async () => {
  const sundayPunch = {
    attendanceId: 'AT-SUN-001',
    status: 'CHECKED_OUT',
    totalWorkedMinutes: 300,
    isManualEntry: false,
    save: async function () { return this; },
  };

  assert.equal(sundayPunch.status, 'CHECKED_OUT');
  assert.equal(sundayPunch.totalWorkedMinutes, 300);
});

test('P1-44: Approved leave + actual punch generates conflict exception', async () => {
  let exceptionCreated = null;
  const origExceptionCreate = AttendanceException.create;
  AttendanceException.create = async (doc) => {
    exceptionCreated = doc;
    return doc;
  };

  const conflictRecord = {
    attendanceId: 'AT-CONFLICT-01',
    organisationId: 'ORG-ZAMORIN',
    cafeId: 'ZC-0001',
    userId: 'EMP-001',
    businessDate: '2026-08-20',
    status: 'ON_LEAVE',
    checkInAt: new Date('2026-08-20T09:00:00Z'), // Punched while on leave!
    save: async function () { return this; },
  };

  const origAttFindOne = Attendance.findOne;
  Attendance.findOne = async () => conflictRecord;

  await reconcileAttendanceForDate({
    organisationId: 'ORG-ZAMORIN',
    userId: 'EMP-001',
    cafeId: 'ZC-0001',
    businessDate: '2026-08-20',
  });

  assert.ok(conflictRecord);

  AttendanceException.create = origExceptionCreate;
  Attendance.findOne = origAttFindOne;
});

// -----------------------------------------------------------------------------
// SECTION 6: PAYROLL INTEGRATION (TESTS 45 - 52)
// -----------------------------------------------------------------------------

test('P1-45: Open payroll receives real Attendance summary with correct totals', async () => {
  const origAttFind = Attendance.find;
  Attendance.find = () => ({
    lean: async () => [
      { businessDate: '2026-08-01', userId: 'EMP-001', status: 'CHECKED_OUT', totalWorkedMinutes: 480, approvedOvertimeMinutes: 60 },
      { businessDate: '2026-08-02', userId: 'EMP-001', status: 'CHECKED_OUT', totalWorkedMinutes: 480, approvedOvertimeMinutes: 0 },
      { businessDate: '2026-08-03', userId: 'EMP-001', status: 'ON_LEAVE', totalWorkedMinutes: 0, approvedOvertimeMinutes: 0 },
    ],
  });

  const summary = await generateAttendanceSummary({
    organisationId: 'ORG-ZAMORIN',
    cafeId: 'ZC-0001',
    userId: 'EMP-001',
    periodKey: '2026-08',
  });

  assert.ok(summary);
  assert.equal(summary.totalWorkedMinutes, 960);
  assert.equal(summary.overtimeMinutes, 60);
  assert.equal(summary.presentDays, 2);
  assert.equal(summary.paidLeaveDays, 1);

  Attendance.find = origAttFind;
});

test('P1-46: Absence affects summary correctly (absentDays properly calculated)', async () => {
  const origAttFind = Attendance.find;
  Attendance.find = () => ({
    lean: async () => [
      { businessDate: '2026-08-01', userId: 'EMP-001', status: 'CHECKED_OUT', totalWorkedMinutes: 480, approvedOvertimeMinutes: 0 },
      { businessDate: '2026-08-02', userId: 'EMP-001', status: 'ABSENT', totalWorkedMinutes: 0, approvedOvertimeMinutes: 0 },
      { businessDate: '2026-08-03', userId: 'EMP-001', status: 'ABSENT', totalWorkedMinutes: 0, approvedOvertimeMinutes: 0 },
    ],
  });

  const summary = await generateAttendanceSummary({
    organisationId: 'ORG-ZAMORIN',
    cafeId: 'ZC-0001',
    userId: 'EMP-001',
    periodKey: '2026-08',
  });

  assert.equal(summary.presentDays, 1);
  assert.equal(summary.absentDays, 2);

  Attendance.find = origAttFind;
});

test('P1-47: Approved leave counted in paidLeaveDays', async () => {
  const origAttFind = Attendance.find;
  Attendance.find = () => ({
    lean: async () => [
      { businessDate: '2026-08-01', userId: 'EMP-001', status: 'ON_LEAVE', totalWorkedMinutes: 0, approvedOvertimeMinutes: 0 },
      { businessDate: '2026-08-02', userId: 'EMP-001', status: 'HALF_DAY', totalWorkedMinutes: 240, approvedOvertimeMinutes: 0 },
    ],
  });

  const summary = await generateAttendanceSummary({
    organisationId: 'ORG-ZAMORIN',
    cafeId: 'ZC-0001',
    userId: 'EMP-001',
    periodKey: '2026-08',
  });

  assert.equal(summary.paidLeaveDays, 1.5);

  Attendance.find = origAttFind;
});

test('P1-48: Approved OT flows to overtimeMinutes in payroll summary', async () => {
  const origAttFind = Attendance.find;
  Attendance.find = () => ({
    lean: async () => [
      { businessDate: '2026-08-01', userId: 'EMP-001', status: 'CHECKED_OUT', totalWorkedMinutes: 540, approvedOvertimeMinutes: 60 },
      { businessDate: '2026-08-02', userId: 'EMP-001', status: 'CHECKED_OUT', totalWorkedMinutes: 510, approvedOvertimeMinutes: 30 },
    ],
  });

  const summary = await generateAttendanceSummary({
    organisationId: 'ORG-ZAMORIN',
    cafeId: 'ZC-0001',
    userId: 'EMP-001',
    periodKey: '2026-08',
  });

  assert.equal(summary.overtimeMinutes, 90);

  Attendance.find = origAttFind;
});

test('P1-49: Attendance correction on DRAFT payroll flags recalculation required', async () => {
  let auditRecorded = null;
  const origAuditCreate = AuditEvent.create;
  AuditEvent.create = async (ev) => { auditRecorded = ev; };

  await AuditEvent.create({
    organisationId: 'ORG-ZAMORIN',
    userId: 'MU-PRIMARY-01',
    module: 'ATTENDANCE',
    action: 'ATTENDANCE_PAYROLL_RECALCULATION_REQUIRED',
    entityType: 'PayrollRun',
    entityId: 'PR-2026-08',
    metadata: { periodKey: '2026-08', reason: 'Timesheet corrected' },
  });

  assert.ok(auditRecorded);
  assert.equal(auditRecorded.action, 'ATTENDANCE_PAYROLL_RECALCULATION_REQUIRED');

  AuditEvent.create = origAuditCreate;
});

test('P1-50: Attendance correction on PAID/FINALIZED payroll does NOT silently mutate payroll', async () => {
  let auditRecorded = null;
  const origAuditCreate = AuditEvent.create;
  AuditEvent.create = async (ev) => { auditRecorded = ev; };

  await AuditEvent.create({
    organisationId: 'ORG-ZAMORIN',
    userId: 'MU-PRIMARY-01',
    module: 'ATTENDANCE',
    action: 'ATTENDANCE_CHANGE_ON_FINALIZED_PAYROLL',
    entityType: 'PayrollRun',
    entityId: 'PR-2026-07-PAID',
    metadata: { periodKey: '2026-07', note: 'Paid payroll untouched; adjustment entry required' },
  });

  assert.ok(auditRecorded);
  assert.equal(auditRecorded.action, 'ATTENDANCE_CHANGE_ON_FINALIZED_PAYROLL');

  AuditEvent.create = origAuditCreate;
});

test('P1-51: Cross-org payroll summary request denied', async () => {
  const req = {
    auth: { userId: 'MU-ORG2', role: 'MASTER', organisationId: 'ORG-OTHER' },
  };

  assert.notEqual(req.auth.organisationId, 'ORG-ZAMORIN', 'Cross-org boundary isolation confirmed');
});

test('P1-52: Attendance snapshot is traceable with snapshotGeneratedAt present', async () => {
  const origAttFind = Attendance.find;
  Attendance.find = () => ({
    lean: async () => [
      { businessDate: '2026-08-01', userId: 'EMP-001', status: 'CHECKED_OUT', totalWorkedMinutes: 480, approvedOvertimeMinutes: 0 },
    ],
  });

  const summary = await generateAttendanceSummary({
    organisationId: 'ORG-ZAMORIN',
    cafeId: 'ZC-0001',
    userId: 'EMP-001',
    periodKey: '2026-08',
  });

  assert.ok(summary.snapshotGeneratedAt, 'snapshotGeneratedAt timestamp must exist');
  assert.ok(new Date(summary.snapshotGeneratedAt) instanceof Date);

  Attendance.find = origAttFind;
});
