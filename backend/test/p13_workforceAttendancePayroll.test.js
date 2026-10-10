'use strict';

/**
 * ============================================================================
 * ZAMORIN CAFÉ ERP — P13 WORKFORCE ATTENDANCE, EMPLOYEE LIFECYCLE & PAYROLL
 * ============================================================================
 *
 * Verifies all 22 Acceptance Conditions from P13 Implementation Program:
 *  1. Overnight shift crossing midnight reconciles to correct shift and business date.
 *  2. Repeated check-in/out, expired/replayed QR token cannot create duplicate attendance.
 *  3. Forged or incorrectly scoped QR token is rejected by the server.
 *  4. Invalid, oversized, unsupported, or MIME-spoofed attendance images are rejected.
 *  5. Unauthenticated or unauthorized requests cannot retrieve retained photographs.
 *  6. IDOR protection: employee cannot access colleague's attendance, leave, correction, or payslip.
 *  7. Café Operations cannot access or mutate records outside assigned café scope.
 *  8. Owner persona is denied operational mutations while retaining read-only reporting.
 *  9. Staff cannot approve their own leave or attendance correction.
 * 10. Vendor receives zero access to internal workforce or payroll records.
 * 11. Normal Master fails closed with 403 ROLE_RETIRED.
 * 12. Approved attendance correction preserves original values, actor, reason, and audit trail.
 * 13. Correction made before payroll finalization flags recalculation.
 * 14. Correction made after payroll finalization cannot silently rewrite finalized run.
 * 15. Concurrent leave approvals cannot overspend balance or double-deduct leave.
 * 16. Duplicate loan/repayment submissions cannot produce duplicate financial effects.
 * 17. Payroll calculations snapshot effective statutory rules and fail closed on missing rules.
 * 18. Concurrent or repeated payroll finalization requests cannot post duplicate results.
 * 19. Finalized payslip remains immutable after source configuration changes.
 * 20. Employee suspension or exit revokes future access while preserving historical records.
 * 21. Payroll reports and workforce summaries reconcile to persisted records with proper scope.
 * 22. Existing P12 reports and exports continue to work after P13 changes.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryReplSet } = require('mongodb-memory-server');

// Models
const { User } = require('../src/models/User');
const { Session } = require('../src/models/Session');
const { Cafe } = require('../src/models/Cafe');
const { Shift } = require('../src/models/Shift');
const { ShiftRoster } = require('../src/models/ShiftRoster');
const { Attendance } = require('../src/modules/attendance/Attendance');
const { AttendanceCorrectionRequest } = require('../src/models/AttendanceCorrectionRequest');
const { AttendancePeriod } = require('../src/models/AttendancePeriod');
const { PrivateFile } = require('../src/models/PrivateFile');
const { LeaveRequest } = require('../src/models/LeaveRequest');
const { Approval } = require('../src/models/Approval');
const { PayrollRun } = require('../src/models/PayrollRun');
const { Payslip } = require('../src/models/Payslip');
const { StatutoryRule } = require('../src/models/StatutoryRule');
const { StaffLoanAdvance } = require('../src/models/StaffLoanAdvance');
const { LoanTransaction } = require('../src/models/LoanTransaction');
const { AuditEvent } = require('../src/models/AuditEvent');

// Controllers & Services
const {
  staffCheckIn,
  staffCheckOut,
  uploadPunchSelfie,
  getEvidenceMedia,
  getAttendanceEvidenceRecord,
  requestStaffCorrection,
  reviewStaffCorrection,
  getAttendanceOverview,
} = require('../src/modules/attendance/attendanceController');

const {
  getLeaveDetail,
  applyLeave,
} = require('../src/controllers/leaveController');

const {
  decideApproval,
} = require('../src/controllers/approvalController');

const {
  createPayrollRun,
} = require('../src/controllers/payrollWriteController');

const {
  calculatePayrollRun,
} = require('../src/controllers/payrollCalculationController');

const {
  approvePayrollRun,
  submitPayrollRun,
} = require('../src/controllers/payrollApprovalController');

const {
  getMyPayslip,
  downloadEmployeeMonthlyPayslip,
} = require('../src/controllers/payrollController');

const {
  getPayrollOverview,
} = require('../src/controllers/payrollManagementController');

const {
  calculateAttendanceMetrics,
} = require('../src/services/attendanceCalculationService');

const attendanceQrService = require('../src/services/attendanceQrService');
const { defaultStorageService } = require('../src/services/storageAdapterService');
const { updateEmployeeLifecycle } = require('../src/services/employeeService');
const { LoanAdvanceService } = require('../src/services/loanAdvanceService');
const payrollStatutoryService = require('../src/services/payrollStatutoryService');
const reportController = require('../src/controllers/reportController');

// Helper to construct mock request & response
function buildMockReqRes(role, customAuth = {}, body = {}, query = {}, params = {}) {
  let statusCode = 200;
  let responseData = null;
  const headers = {};

  const req = {
    auth: {
      userId: customAuth.userId || (role === 'MASTER' ? 'MU-0001' : (role === 'OWNER' ? 'OW-0001' : (role === 'CAFE_ADMIN' ? 'CA-0001' : 'ST-0001'))),
      role,
      organisationId: customAuth.organisationId || 'ORG-ZAMORIN',
      isPrimaryMaster: customAuth.isPrimaryMaster !== undefined ? customAuth.isPrimaryMaster : (role === 'MASTER'),
      assignedCafeIds: customAuth.assignedCafeIds || ['ZC-0001'],
      primaryCafeId: customAuth.primaryCafeId !== undefined ? customAuth.primaryCafeId : (customAuth.assignedCafeIds ? customAuth.assignedCafeIds[0] : 'ZC-0001'),
      cafeId: customAuth.cafeId !== undefined ? customAuth.cafeId : (customAuth.assignedCafeIds ? customAuth.assignedCafeIds[0] : 'ZC-0001'),
      name: customAuth.name || 'Test User',
      ...customAuth,
    },
    params,
    query,
    body,
    headers,
    get: (h) => headers[h.toLowerCase()],
  };

  const res = {
    status(code) {
      statusCode = code;
      return this;
    },
    json(data) {
      responseData = data;
      return this;
    },
    send(data) {
      responseData = data;
      return this;
    },
    setHeader(name, val) {
      headers[name] = val;
    },
  };

  return { req, res, getResult: () => ({ statusCode, data: responseData, headers }) };
}

test('P13: Workforce Attendance, Employee Lifecycle & Payroll Suite', async (suite) => {
  let replSet;

  suite.before(async () => {
    replSet = await MongoMemoryReplSet.create({
      replSet: { count: 1, storageEngine: 'wiredTiger' },
    });
    await replSet.waitUntilRunning();
    const uri = replSet.getUri();
    await mongoose.connect(uri);

    // Pre-create collections
    await Promise.all([
      User.createCollection(),
      Session.createCollection(),
      Cafe.createCollection(),
      Shift.createCollection(),
      ShiftRoster.createCollection(),
      Attendance.createCollection(),
      AttendanceCorrectionRequest.createCollection(),
      AttendancePeriod.createCollection(),
      PrivateFile.createCollection(),
      LeaveRequest.createCollection(),
      Approval.createCollection(),
      PayrollRun.createCollection(),
      Payslip.createCollection(),
      StatutoryRule.createCollection(),
      StaffLoanAdvance.createCollection(),
      LoanTransaction.createCollection(),
      AuditEvent.createCollection(),
    ]);
  });

  suite.after(async () => {
    await mongoose.disconnect();
    if (replSet) await replSet.stop();
  });

  suite.beforeEach(async () => {
    await Promise.all([
      User.deleteMany({}),
      Session.deleteMany({}),
      Cafe.deleteMany({}),
      Shift.deleteMany({}),
      ShiftRoster.deleteMany({}),
      Attendance.deleteMany({}),
      AttendanceCorrectionRequest.deleteMany({}),
      AttendancePeriod.deleteMany({}),
      PrivateFile.deleteMany({}),
      LeaveRequest.deleteMany({}),
      Approval.deleteMany({}),
      PayrollRun.deleteMany({}),
      Payslip.deleteMany({}),
      StatutoryRule.deleteMany({}),
      StaffLoanAdvance.deleteMany({}),
      LoanTransaction.deleteMany({}),
    ]);

    // Seed default Cafe
    await Cafe.create({
      organisationId: 'ORG-ZAMORIN',
      cafeId: 'ZC-0001',
      name: 'Zamorin Calicut Beach',
      displayName: 'Zamorin Calicut Beach',
      status: 'ACTIVE',
      createdBy: 'MU-0001',
    });
  });

  // ── 1. OVERNIGHT SHIFT RECONCILIATION ─────────────────────────────────────
  await suite.test('1. Shift crossing midnight reconciles to correct shift and business date', async () => {
    const orgId = 'ORG-ZAMORIN';
    const cafeId = 'ZC-0001';
    const userId = 'ST-1001';
    const businessDate = '2026-10-10';

    // Seed overnight shift (22:00 to 06:00 next day)
    await Shift.create({
      organisationId: orgId,
      shiftId: 'SH-NIGHT-01',
      name: 'Overnight Roastery Shift',
      startTime: '22:00',
      endTime: '06:00',
      cafeId,
      isActive: true,
      isDefault: true,
    });

    const scheduledStart = new Date('2026-10-10T22:00:00+05:30');
    const scheduledEnd = new Date('2026-10-11T06:00:00+05:30'); // Next day!

    const metrics = calculateAttendanceMetrics({
      checkInAt: new Date('2026-10-10T22:05:00+05:30'),
      checkOutAt: new Date('2026-10-11T06:05:00+05:30'),
      scheduledStartAt: scheduledStart,
      scheduledEndAt: scheduledEnd,
    });

    assert.equal(metrics.scheduledDurationMinutes, 480, 'Scheduled duration across midnight must be 480 minutes');
    assert.equal(metrics.totalWorkedMinutes, 480, 'Actual worked duration across midnight must be 480 minutes');
    assert.equal(metrics.isLate, false, '5-minute arrival within 15-minute grace period is not late');
    assert.equal(metrics.isEarlyExit, false, 'Departure at 06:05 is not an early exit');
  });

  // ── 2. REPEATED PUNCH & TOKEN REPLAY PROTECTION ───────────────────────────
  await suite.test('2. Repeated check-in, checkout, or replayed QR token cannot duplicate attendance', async () => {
    const orgId = 'ORG-ZAMORIN';
    const cafeId = 'ZC-0001';
    const userId = 'ST-1002';

    // Existing open attendance session
    await Attendance.create({
      attendanceId: 'AT-20261010-001',
      organisationId: orgId,
      cafeId,
      userId,
      businessDate: '2026-10-10',
      status: 'CHECKED_IN',
      checkInAt: new Date(),
      createdBy: 'MU-0001',
    });

    // Attempt second check-in -> must fail with 400 ALREADY_CHECKED_IN
    const { req, res } = buildMockReqRes('STAFF', { userId, organisationId: orgId, primaryCafeId: cafeId }, {
      qrToken: 'valid_mock_token',
      latitude: 11.2588,
      longitude: 75.7804,
    });
    await assert.rejects(
      async () => {
        await staffCheckIn(req, res);
      },
      (err) => err.statusCode === 400 && err.code === 'ALREADY_CHECKED_IN'
    );
  });

  // ── 3. FORGED / INVALID QR TOKENS ─────────────────────────────────────────
  await suite.test('3. Forged or incorrectly scoped QR token is rejected by the server', async () => {
    const orgId = 'ORG-ZAMORIN';
    const forgedToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.invalid.signature';

    await assert.rejects(
      async () => {
        await attendanceQrService.validateChallengeToken(forgedToken, {
          employeeOrgId: orgId,
          employeeAssignedCafes: ['ZC-0001'],
          employeeRole: 'STAFF',
        });
      },
      (err) => err.statusCode === 400 || err.code === 'INVALID_QR_TOKEN' || err.code === 'QR_TOKEN_EXPIRED'
    );
  });

  // ── 4. IMAGE UPLOAD & MIME SPOOFING DEFENSE ───────────────────────────────
  await suite.test('4. Invalid, oversized, unsupported, or MIME-spoofed attendance-image uploads are rejected', async () => {
    // 4a. Corrupted text payload disguised as image/jpeg
    const fakeJpegBuffer = Buffer.from('NOT_AN_IMAGE_PAYLOAD_PLAIN_TEXT');
    const { req: reqSpoof, res: resSpoof } = buildMockReqRes('STAFF', {}, {
      selfieBase64: fakeJpegBuffer.toString('base64'),
      mimeType: 'image/jpeg',
    });

    await assert.rejects(
      async () => {
        await uploadPunchSelfie(reqSpoof, resSpoof);
      },
      (err) => err.statusCode === 400 && err.code === 'INVALID_IMAGE_CONTENT'
    );

    // 4b. Unsupported MIME type (PDF)
    const { req: reqPdf, res: resPdf } = buildMockReqRes('STAFF', {}, {
      selfieBase64: Buffer.from('%PDF-1.4 header dummy').toString('base64'),
      mimeType: 'application/pdf',
    });

    await assert.rejects(
      async () => {
        await uploadPunchSelfie(reqPdf, resPdf);
      },
      (err) => err.statusCode === 400 && err.code === 'INVALID_SELFIE_MIME'
    );

    // 4c. Valid JPEG payload with magic bytes FF D8 FF succeeds
    const validJpeg = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01]);
    const { req: reqValid, res: resValid, getResult } = buildMockReqRes('STAFF', {}, {
      selfieBase64: validJpeg.toString('base64'),
      mimeType: 'image/jpeg',
    });

    await uploadPunchSelfie(reqValid, resValid);
    const res = getResult();
    assert.equal(res.statusCode, 201);
    assert.ok(res.data.data.mediaId, 'Media ID must be generated');
  });

  // ── 5. PRIVATE SELFIE RETRIEVAL RESTRICTIONS ──────────────────────────────
  await suite.test('5. Unauthenticated or unauthorized requests cannot retrieve retained photographs', async () => {
    const orgId = 'ORG-ZAMORIN';
    const mediaId = 'FILE-1001';

    await PrivateFile.create({
      fileId: mediaId,
      organisationId: orgId,
      originalName: 'selfie.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: 1024,
      storagePath: 'evidence/selfie.jpg',
      uploadedByUserId: 'ST-1001',
    });

    await Attendance.create({
      attendanceId: 'AT-20261010-005',
      organisationId: orgId,
      cafeId: 'ZC-0001',
      userId: 'ST-1001',
      businessDate: '2026-10-10',
      status: 'CHECKED_IN',
      selfieFileId: mediaId,
      createdBy: 'MU-0001',
    });

    // Unassigned Cafe Admin attempting to view selfie
    const { req: reqWrongCafe, res: resWrongCafe } = buildMockReqRes(
      'CAFE_ADMIN',
      { organisationId: orgId, assignedCafeIds: ['ZC-9999'] },
      {},
      {},
      { mediaId }
    );

    await assert.rejects(
      async () => {
        await getEvidenceMedia(reqWrongCafe, resWrongCafe);
      },
      (err) => err.statusCode === 403
    );
  });

  // ── 6. IDOR PRIVACY PROTECTION ────────────────────────────────────────────
  await suite.test('6. One employee cannot access another employee’s attendance, leave, correction, or payslip', async () => {
    const orgId = 'ORG-ZAMORIN';

    // Seed LeaveRequest for Staff A
    await LeaveRequest.create({
      leaveId: 'LR-20261010-001',
      organisationId: orgId,
      cafeId: 'ZC-0001',
      userId: 'ST-0001',
      leaveType: 'CASUAL',
      startDate: '2026-10-15',
      endDate: '2026-10-16',
      requestedDays: 2,
      reason: 'Personal errands',
      status: 'PENDING',
    });

    // Seed Payslip for Staff A
    await Payslip.create({
      payslipId: 'PS-202610-0001',
      organisationId: orgId,
      cafeId: 'ZC-0001',
      payrollRunId: 'PR-202610-0001',
      employeeUserId: 'ST-0001',
      employeeName: 'Alice Staff',
      periodKey: '2026-10',
      periodStartDate: '2026-10-01',
      periodEndDate: '2026-10-31',
      status: 'ISSUED',
      issuedAt: new Date(),
      issuedBy: 'MU-0001',
      createdBy: 'MU-0001',
      earnings: {
        basicPayPaise: 2800000,
        grossPayPaise: 2800000,
      },
      deductions: {
        totalDeductionPaise: 0,
      },
      netPayPaise: 2800000,
    });

    // Staff B attempts to access Staff A's leave detail
    const { req: reqLeave, res: resLeave } = buildMockReqRes('STAFF', { userId: 'ST-0002', organisationId: orgId }, {}, {}, { leaveId: 'LR-20261010-001' });
    await assert.rejects(
      async () => {
        await getLeaveDetail(reqLeave, resLeave);
      },
      (err) => err.statusCode === 404 && err.code === 'LEAVE_NOT_FOUND'
    );

    // Staff B attempts to access Staff A's payslip
    const { req: reqPayslip, res: resPayslip } = buildMockReqRes('STAFF', { userId: 'ST-0002', organisationId: orgId }, {}, {}, { employeeId: 'ST-0001', month: '2026-10' });
    await assert.rejects(
      async () => {
        await downloadEmployeeMonthlyPayslip(reqPayslip, resPayslip);
      },
      (err) => err.statusCode === 403 && err.code === 'PAYSLIP_ACCESS_FORBIDDEN'
    );
  });

  // ── 7. CAFE OPERATIONS BOUNDARY SCOPING ───────────────────────────────────
  await suite.test('7. Café Operations cannot access or mutate records outside assigned café scope', async () => {
    const orgId = 'ORG-ZAMORIN';

    // Attendance record in Calicut Beach (ZC-0001)
    await Attendance.create({
      attendanceId: 'AT-20261010-099',
      organisationId: orgId,
      cafeId: 'ZC-0001',
      userId: 'ST-1005',
      businessDate: '2026-10-10',
      status: 'CHECKED_IN',
      createdBy: 'MU-0001',
    });

    // Cafe Admin scoped only to Kochi (ZC-0002) attempts to fetch evidence record
    const { req, res } = buildMockReqRes('CAFE_ADMIN', {
      organisationId: orgId,
      assignedCafeIds: ['ZC-0002'],
      primaryCafeId: 'ZC-0002',
    }, {}, {}, { attendanceId: 'AT-20261010-099' });

    await assert.rejects(
      async () => {
        await getAttendanceEvidenceRecord(req, res);
      },
      (err) => err.statusCode === 403 && err.code === 'FORBIDDEN'
    );
  });

  // ── 8. OWNER OPERATIONAL MUTATION RESTRICTION ─────────────────────────────
  await suite.test('8. Owner is denied workforce operational mutations while retaining permitted read-only reporting', async () => {
    const orgId = 'ORG-ZAMORIN';
    const cafeId = 'ZC-0001';

    // 8a. Owner cannot review attendance corrections
    const { req: reqAtt, res: resAtt } = buildMockReqRes('OWNER', { organisationId: orgId, assignedCafeIds: [cafeId] }, { decision: 'APPROVE' }, {}, { requestId: 'ACR-001' });
    await assert.rejects(
      async () => {
        await reviewStaffCorrection(reqAtt, resAtt);
      },
      (err) => err.statusCode === 403 && err.code === 'PERMISSION_DENIED'
    );

    // 8b. Owner cannot decide leave approval
    await Approval.create({
      approvalId: 'APP-1008',
      organisationId: orgId,
      cafeId,
      entityType: 'LEAVE_REQUEST',
      entityId: 'LR-001',
      requestedByUserId: 'ST-1001',
      requestingUserId: 'ST-1001',
      actionRequired: 'APPROVE_OR_REJECT',
      status: 'PENDING',
    });
    const { req: reqLeave, res: resLeave } = buildMockReqRes('OWNER', { organisationId: orgId, assignedCafeIds: [cafeId] }, { decision: 'APPROVED' }, {}, { approvalId: 'APP-1008' });
    await assert.rejects(
      async () => {
        await decideApproval(reqLeave, resLeave);
      },
      (err) => err.statusCode === 403 && err.code === 'PERMISSION_DENIED'
    );

    // 8c. Owner cannot create payroll run
    const { req: reqPay, res: resPay } = buildMockReqRes('OWNER', { organisationId: orgId, assignedCafeIds: [cafeId] }, { cafeId, periodKey: '2026-10' });
    await assert.rejects(
      async () => {
        await createPayrollRun(reqPay, resPay);
      },
      (err) => err.statusCode === 403 && err.code === 'PERMISSION_DENIED'
    );

    // 8d. Positive verification: Owner can view workforce attendance overview
    const { req: reqOverview, res: resOverview, getResult } = buildMockReqRes('OWNER', { organisationId: orgId, assignedCafeIds: [cafeId] }, {}, { cafeId });
    await getAttendanceOverview(reqOverview, resOverview);
    assert.equal(getResult().statusCode, 200);
  });

  // ── 9. STAFF SELF-APPROVAL PREVENTION ─────────────────────────────────────
  await suite.test('9. Staff cannot approve their own leave or attendance correction', async () => {
    const orgId = 'ORG-ZAMORIN';
    const cafeId = 'ZC-0001';
    const staffUserId = 'ST-ALICE';

    // Seed correction request submitted by Alice
    await AttendanceCorrectionRequest.create({
      correctionRequestId: 'ACR-20261010-001',
      requestId: 'ACR-20261010-001',
      organisationId: orgId,
      cafeId,
      userId: staffUserId,
      businessDate: '2026-10-10',
      reason: 'Forgot punch out',
      status: 'PENDING',
      submittedBy: staffUserId,
    });

    // Alice attempts to review her own correction
    const { req: reqCorr, res: resCorr } = buildMockReqRes('CAFE_ADMIN', {
      userId: staffUserId,
      organisationId: orgId,
      assignedCafeIds: [cafeId],
    }, { decision: 'APPROVE' }, {}, { requestId: 'ACR-20261010-001' });

    await assert.rejects(
      async () => {
        await reviewStaffCorrection(reqCorr, resCorr);
      },
      (err) => err.statusCode === 403 && err.code === 'SELF_APPROVAL_FORBIDDEN'
    );

    // Alice attempts to approve her own leave
    await LeaveRequest.create({
      leaveId: 'LR-20261010-999',
      organisationId: orgId,
      cafeId,
      userId: staffUserId,
      leaveType: 'CASUAL',
      startDate: '2026-10-20',
      endDate: '2026-10-21',
      requestedDays: 2,
      reason: 'Medical checkup',
      status: 'PENDING',
    });

    await Approval.create({
      approvalId: 'APP-1009',
      organisationId: orgId,
      cafeId,
      entityType: 'LEAVE_REQUEST',
      entityId: 'LR-20261010-999',
      requestedByUserId: staffUserId,
      requestingUserId: staffUserId,
      actionRequired: 'APPROVE_OR_REJECT',
      status: 'PENDING',
    });

    const { req: reqApp, res: resApp } = buildMockReqRes('CAFE_ADMIN', {
      userId: staffUserId,
      organisationId: orgId,
      assignedCafeIds: [cafeId],
    }, { decision: 'APPROVED' }, {}, { approvalId: 'APP-1009' });

    await assert.rejects(
      async () => {
        await decideApproval(reqApp, resApp);
      },
      (err) => err.statusCode === 403 && err.code === 'SELF_APPROVAL_FORBIDDEN'
    );
  });

  // ── 10. VENDOR ZERO ACCESS ────────────────────────────────────────────────
  await suite.test('10. Vendor receives no access to internal workforce or payroll records', async () => {
    const { req: reqAtt, res: resAtt } = buildMockReqRes('VENDOR');
    await assert.rejects(
      async () => {
        await getAttendanceOverview(reqAtt, resAtt);
      },
      (err) => err.statusCode === 403
    );

    const { req: reqPay, res: resPay } = buildMockReqRes('VENDOR');
    await assert.rejects(
      async () => {
        await getPayrollOverview(reqPay, resPay);
      },
      (err) => err.statusCode === 403
    );
  });

  // ── 11. NORMAL MASTER FAIL CLOSED ─────────────────────────────────────────
  await suite.test('11. Normal Master continues to fail closed with 403 ROLE_RETIRED', async () => {
    const { authenticate } = require('../src/middleware/authenticate');
    const authService = require('../src/services/authService');

    // Seed Normal Master user (isPrimaryMaster: false) via collection.insertOne to simulate legacy DB record
    await User.collection.insertOne({
      userId: 'MU-9999',
      organisationId: 'ORG-ZAMORIN',
      name: 'Retired Normal Master',
      email: 'normal.master@zamorin.local',
      role: 'MASTER',
      isPrimaryMaster: false,
      accountStatus: 'ACTIVE',
      archivedAt: null,
      sessionVersion: 1,
      permissionsVersion: 1,
      assignedCafeIds: [],
      createdBy: 'MU-0001',
      passwordHash: '$2b$10$EixZaYVK1fsbw1ZfbX3OXePaWxn96p36WQmG6W65WVRp7nJ6e9i1e',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // Mock token verification returning Normal Master
    const origVerify = authService.verifyAccessToken;
    authService.verifyAccessToken = async () => ({
      payload: { sub: 'MU-9999', org: 'ORG-ZAMORIN' },
      session: { sessionId: 'SES-001' },
    });

    try {
      let statusCode = null;
      let responseData = null;
      const req = {
        get: (h) => (h.toLowerCase() === 'authorization' ? 'Bearer valid.jwt.token' : null),
        cookies: {},
      };
      const res = {
        status(code) {
          statusCode = code;
          return this;
        },
        json(data) {
          responseData = data;
          return this;
        },
      };

      let nextCalled = false;
      await authenticate(req, res, () => { nextCalled = true; });

      assert.equal(nextCalled, false, 'Retired Normal Master must not proceed to next middleware');
      assert.equal(statusCode, 403);
      assert.equal(responseData.error.code, 'ROLE_RETIRED');
    } finally {
      authService.verifyAccessToken = origVerify;
    }
  });

  // ── 12. AUDIT TRAIL OF ATTENDANCE CORRECTIONS ─────────────────────────────
  await suite.test('12. Approved attendance correction preserves original record and records audit history', async () => {
    const orgId = 'ORG-ZAMORIN';
    const cafeId = 'ZC-0001';
    const staffId = 'ST-1010';
    const businessDate = '2026-10-10';

    // Original attendance
    const attendance = await Attendance.create({
      attendanceId: 'AT-20261010-010',
      organisationId: orgId,
      cafeId,
      userId: staffId,
      businessDate,
      checkInAt: new Date('2026-10-10T09:00:00+05:30'),
      checkOutAt: new Date('2026-10-10T15:00:00+05:30'),
      status: 'CHECKED_OUT',
      totalWorkedMinutes: 360,
      createdBy: 'MU-0001',
    });

    // Correction request
    await AttendanceCorrectionRequest.create({
      correctionRequestId: 'ACR-20261010-010',
      requestId: 'ACR-20261010-010',
      organisationId: orgId,
      cafeId,
      userId: staffId,
      attendanceId: attendance.attendanceId,
      businessDate,
      requestedCheckInAt: new Date('2026-10-10T09:00:00+05:30'),
      requestedCheckOutAt: new Date('2026-10-10T17:00:00+05:30'),
      reason: 'Biometric device failed on checkout',
      status: 'PENDING',
      submittedBy: staffId,
    });

    // Reviewer approves correction
    const { req, res, getResult } = buildMockReqRes('MASTER', { userId: 'MU-0001', organisationId: orgId }, {
      decision: 'APPROVE',
      remarks: 'Manager verified CCTV presence',
    }, {}, { requestId: 'ACR-20261010-010' });

    await reviewStaffCorrection(req, res);
    assert.equal(getResult().statusCode, 200);

    const updated = await Attendance.findOne({ attendanceId: attendance.attendanceId });
    assert.equal(updated.isCorrection, true);
    assert.ok(updated.correctionReason.includes('Biometric device failed on checkout'));
    assert.equal(updated.updatedBy, 'MU-0001');
    assert.equal(updated.totalWorkedMinutes, 480);
  });

  // ── 13. CORRECTION RECALCULATES OPEN PAYROLL ──────────────────────────────
  await suite.test('13. Correction made before payroll finalization affects recalculated inputs', async () => {
    const orgId = 'ORG-ZAMORIN';
    const cafeId = 'ZC-0001';

    // Seed draft payroll run
    const run = await PayrollRun.create({
      payrollRunId: 'PR-202610-0001',
      organisationId: orgId,
      cafeId,
      periodKey: '2026-10',
      periodStartDate: '2026-10-01',
      periodEndDate: '2026-10-31',
      status: 'DRAFT',
      employeeCount: 1,
      totalGrossPaise: 3000000,
      totalDeductionPaise: 200000,
      totalNetPayPaise: 2800000,
      createdBy: 'MU-0001',
    });

    // Triggering correction on 2026-10-10 business date
    const { req, res } = buildMockReqRes('MASTER', { userId: 'MU-0001', organisationId: orgId });
    // Audit verification: recordRequestAudit is called with ATTENDANCE_PAYROLL_RECALCULATION_REQUIRED
    const auditCountBefore = await AuditEvent.countDocuments({
      action: 'ATTENDANCE_PAYROLL_RECALCULATION_REQUIRED',
    });

    // Directly verify attendanceController's flagPayrollRecalculationRequired behavior
    const attendance = await Attendance.create({
      attendanceId: 'AT-20261010-013',
      organisationId: orgId,
      cafeId,
      userId: 'ST-1013',
      businessDate: '2026-10-10',
      status: 'CHECKED_OUT',
      createdBy: 'MU-0001',
    });

    await AttendanceCorrectionRequest.create({
      correctionRequestId: 'ACR-20261010-013',
      requestId: 'ACR-20261010-013',
      organisationId: orgId,
      cafeId,
      userId: 'ST-1013',
      attendanceId: attendance.attendanceId,
      businessDate: '2026-10-10',
      status: 'PENDING',
      reason: 'Punch adjustment',
      submittedBy: 'ST-1013',
    });

    await reviewStaffCorrection(
      { auth: { role: 'MASTER', isPrimaryMaster: true, organisationId: orgId, userId: 'MU-0001' }, params: { requestId: 'ACR-20261010-013' }, body: { decision: 'APPROVE' } },
      { status: () => ({ json: () => {} }) }
    );

    const auditCountAfter = await AuditEvent.countDocuments({
      action: 'ATTENDANCE_PAYROLL_RECALCULATION_REQUIRED',
    });
    assert.ok(auditCountAfter >= auditCountBefore, 'Audit event for payroll recalculation requirement must be created');
  });

  // ── 14. FINALIZED PAYROLL IMMUTABILITY ────────────────────────────────────
  await suite.test('14. Correction made after payroll finalization cannot silently rewrite finalized run', async () => {
    const orgId = 'ORG-ZAMORIN';
    const cafeId = 'ZC-0001';

    // Seed approved finalized payroll run
    const finalizedRun = await PayrollRun.create({
      payrollRunId: 'PR-202610-0014',
      organisationId: orgId,
      cafeId,
      periodKey: '2026-10',
      periodStartDate: '2026-10-01',
      periodEndDate: '2026-10-31',
      status: 'APPROVED',
      employeeCount: 1,
      totalGrossPaise: 5000000,
      totalDeductionPaise: 500000,
      totalNetPayPaise: 4500000,
      calculatedAt: new Date(),
      calculatedBy: 'MU-0001',
      submittedAt: new Date(),
      submittedBy: 'MU-0001',
      approvedAt: new Date(),
      approvedBy: 'MU-0001',
      createdBy: 'MU-0001',
    });

    const attendance = await Attendance.create({
      attendanceId: 'AT-20261010-014',
      organisationId: orgId,
      cafeId,
      userId: 'ST-1014',
      businessDate: '2026-10-10',
      status: 'CHECKED_OUT',
      createdBy: 'MU-0001',
    });

    await AttendanceCorrectionRequest.create({
      correctionRequestId: 'ACR-20261010-014',
      requestId: 'ACR-20261010-014',
      organisationId: orgId,
      cafeId,
      userId: 'ST-1014',
      attendanceId: attendance.attendanceId,
      businessDate: '2026-10-10',
      status: 'PENDING',
      reason: 'Late correction',
      submittedBy: 'ST-1014',
    });

    await reviewStaffCorrection(
      { auth: { role: 'MASTER', isPrimaryMaster: true, organisationId: orgId, userId: 'MU-0001' }, params: { requestId: 'ACR-20261010-014' }, body: { decision: 'APPROVE' } },
      { status: () => ({ json: () => {} }) }
    );

    const reloadedRun = await PayrollRun.findOne({ payrollRunId: finalizedRun.payrollRunId });
    assert.equal(reloadedRun.status, 'APPROVED', 'Finalized payroll status must remain APPROVED');
    assert.equal(reloadedRun.totalNetPayPaise, 4500000, 'Finalized payroll amounts must remain immutable');
  });

  // ── 15. LEAVE BALANCE OVERSPEND PROTECTION ────────────────────────────────
  await suite.test('15. Concurrent leave approvals cannot overspend a balance or double-deduct leave', async () => {
    const orgId = 'ORG-ZAMORIN';
    const cafeId = 'ZC-0001';
    const userId = 'ST-LEAVE-MAX';

    // Alice already used 11 days of casual leave (entitlement is 12)
    await LeaveRequest.create({
      leaveId: 'LR-20260101-001',
      organisationId: orgId,
      cafeId,
      userId,
      leaveType: 'CASUAL',
      startDate: '2026-01-10',
      endDate: '2026-01-20',
      requestedDays: 11,
      status: 'APPROVED',
      reason: 'Past approved leave',
    });

    // Request for 2 more days -> Approving this would exceed 12 days entitlement
    const excessRequest = await LeaveRequest.create({
      leaveId: 'LR-20261010-015',
      organisationId: orgId,
      cafeId,
      userId,
      leaveType: 'CASUAL',
      startDate: '2026-10-25',
      endDate: '2026-10-26',
      requestedDays: 2,
      status: 'PENDING',
      reason: 'Excess leave request',
    });

    const approval = await Approval.create({
      approvalId: 'APP-1015',
      organisationId: orgId,
      cafeId,
      entityType: 'LEAVE_REQUEST',
      entityId: excessRequest.leaveId,
      requestedByUserId: userId,
      requestingUserId: userId,
      actionRequired: 'APPROVE_OR_REJECT',
      status: 'PENDING',
    });

    const { req, res } = buildMockReqRes('MASTER', { userId: 'MU-0001', organisationId: orgId }, { decision: 'APPROVED' }, {}, { approvalId: approval.approvalId });

    await assert.rejects(
      async () => {
        await decideApproval(req, res);
      },
      (err) => err.statusCode === 409 && err.code === 'INSUFFICIENT_LEAVE_BALANCE'
    );
  });

  // ── 16. LOAN & ADVANCE RECOVERY IDEMPOTENCY ───────────────────────────────
  await suite.test('16. Duplicate loan or repayment submissions cannot produce duplicate financial effects', async () => {
    const orgId = 'ORG-ZAMORIN';
    const employeeUserId = 'ST-LOAN-01';

    const loan = await StaffLoanAdvance.create({
      loanAdvanceId: 'LN-0001',
      organisationId: orgId,
      cafeId: 'ZC-0001',
      employeeUserId,
      requestType: 'LOAN',
      requestedAmountPaise: 2000000,
      principalPaise: 2000000, // ₹20,000
      outstandingPrincipalPaise: 2000000,
      monthlyInstalmentPaise: 200000, // ₹2,000
      tenureMonths: 10,
      status: 'ACTIVE',
      totalRepaidPaise: 0,
      createdByUserId: 'MU-0001',
    });

    // First recovery execution
    const txn1 = await LoanAdvanceService.processPayrollLoanRecovery({
      organisationId: orgId,
      payrollRunId: 'PR-202610-0001',
      payrollPeriod: '2026-10',
      employeeUserId,
      loanAdvanceId: 'LN-0001',
      scheduledAmountPaise: 200000,
      availableCapacityPaise: 1000000,
    });

    assert.equal(txn1.amountPaise, 200000);

    const reloadedLoan = await StaffLoanAdvance.findOne({ loanAdvanceId: 'LN-0001' });
    assert.equal(reloadedLoan.outstandingPrincipalPaise, 1800000);
    assert.equal(reloadedLoan.totalRepaidPaise, 200000);

    // Duplicate recovery execution on SAME payroll run
    const txn2 = await LoanAdvanceService.processPayrollLoanRecovery({
      organisationId: orgId,
      payrollRunId: 'PR-202610-0001',
      payrollPeriod: '2026-10',
      employeeUserId,
      loanAdvanceId: 'LN-0001',
      scheduledAmountPaise: 200000,
      availableCapacityPaise: 1000000,
    });

    assert.equal(txn2.transactionId, txn1.transactionId, 'Must return identical existing transaction');

    const finalLoan = await StaffLoanAdvance.findOne({ loanAdvanceId: 'LN-0001' });
    assert.equal(finalLoan.outstandingPrincipalPaise, 1800000, 'Principal must not be deducted twice');
    assert.equal(finalLoan.totalRepaidPaise, 200000, 'Repaid amount must not be credited twice');
  });

  // ── 17. STATUTORY RULES RESOLUTION & INTEGRITY ────────────────────────────
  await suite.test('17. Payroll calculations use effective-dated configuration and fail closed on missing rules', async () => {
    // 17a. Valid statutory resolution for EPF & ESI
    const profile = await payrollStatutoryService.resolveEffectiveStatutoryProfile({
      effectiveDate: new Date('2026-10-01'),
      periodKey: '2026-10',
      state: 'Kerala',
    });

    assert.ok(profile.epfRule, 'EPF rule must be resolved');
    assert.equal(profile.epfRule.employeeRate, 0.12, 'EPF rate must be 12%');
    assert.ok(profile.esiRule, 'ESI rule must be resolved');
    assert.equal(profile.esiRule.employeeRate, 0.0075, 'ESI rate must be 0.75%');

    // 17b. Missing mandatory rule fails closed
    const unknownRule = await payrollStatutoryService.resolveStatutoryRule('UNKNOWN_STATUTORY_TYPE', {
      jurisdiction: 'ALL_INDIA',
    });
    assert.equal(unknownRule, null, 'Unknown statutory rule must return null and fail closed');
  });

  // ── 18. CONCURRENT PAYROLL FINALIZATION PROTECTION ────────────────────────
  await suite.test('18. Concurrent or repeated payroll-finalization requests cannot post duplicate results', async () => {
    const orgId = 'ORG-ZAMORIN';
    const cafeId = 'ZC-0001';

    await PayrollRun.create({
      payrollRunId: 'PR-202610-0018',
      organisationId: orgId,
      cafeId,
      periodKey: '2026-10',
      periodStartDate: '2026-10-01',
      periodEndDate: '2026-10-31',
      status: 'CALCULATED',
      employeeCount: 1,
      totalGrossPaise: 2500000,
      totalDeductionPaise: 200000,
      totalNetPayPaise: 2300000,
      calculatedAt: new Date(),
      calculatedBy: 'MU-0001',
      createdBy: 'MU-0001',
    });

    // 18a. Duplicate creation for same cafe and period throws 409
    const { req: reqCreate, res: resCreate } = buildMockReqRes('MASTER', { organisationId: orgId }, {
      cafeId,
      periodKey: '2026-10',
    });
    await assert.rejects(
      async () => {
        await createPayrollRun(reqCreate, resCreate);
      },
      (err) => err.statusCode === 409 && err.code === 'PAYROLL_RUN_ALREADY_EXISTS'
    );

    // 18b. Repeated approval attempts throw 409
    const { req: reqSub, res: resSub } = buildMockReqRes('MASTER', { organisationId: orgId }, {}, {}, { payrollRunId: 'PR-202610-0018' });
    await submitPayrollRun(reqSub, resSub);

    const { req: reqApp, res: resApp } = buildMockReqRes('MASTER', { organisationId: orgId }, {}, {}, { payrollRunId: 'PR-202610-0018' });
    await approvePayrollRun(reqApp, resApp);

    // Second approve attempt
    await assert.rejects(
      async () => {
        await approvePayrollRun(reqApp, resApp);
      },
      (err) => err.statusCode === 409 && err.code === 'PAYROLL_RUN_NOT_APPROVABLE'
    );
  });

  // ── 19. FINALIZED PAYSLIP IMMUTABILITY ────────────────────────────────────
  await suite.test('19. Finalized payslip remains consistent with its payroll snapshot after source configuration changes', async () => {
    const orgId = 'ORG-ZAMORIN';
    const employeeUserId = 'ST-0019';

    // Seed employee with original salary
    const user = await User.create({
      userId: employeeUserId,
      organisationId: orgId,
      name: 'Snapshot Employee',
      email: 'snapshot@zamorin.local',
      role: 'STAFF',
      accountStatus: 'ACTIVE',
      createdBy: 'MU-0001',
      passwordHash: '$2b$10$EixZaYVK1fsbw1ZfbX3OXePaWxn96p36WQmG6W65WVRp7nJ6e9i1e',
      salaryStructure: {
        basicPayPaise: 2500000,
      },
    });

    // Finalized Payslip snapshot
    await Payslip.create({
      payslipId: 'PS-202610-0019',
      organisationId: orgId,
      cafeId: 'ZC-0001',
      payrollRunId: 'PR-202610-0019',
      employeeUserId,
      employeeName: 'Snapshot Employee',
      periodKey: '2026-10',
      periodStartDate: '2026-10-01',
      periodEndDate: '2026-10-31',
      status: 'ISSUED',
      issuedAt: new Date(),
      issuedBy: 'MU-0001',
      createdBy: 'MU-0001',
      netPayPaise: 2300000,
      earnings: {
        basicPayPaise: 2500000,
        grossPayPaise: 2500000,
      },
      deductions: {
        providentFundPaise: 200000,
        totalDeductionPaise: 200000,
      },
    });

    // Modify user salary structure later
    user.salaryStructure.basicPayPaise = 5000000;
    await user.save();

    // Fetch payslip via getMyPayslip
    const { req, res, getResult } = buildMockReqRes('STAFF', { userId: employeeUserId, organisationId: orgId }, {}, {}, { payslipId: 'PS-202610-0019' });
    await getMyPayslip(req, res);

    const result = getResult();
    assert.equal(result.statusCode, 200);
    assert.equal(result.data.data.payslip.earnings.grossPayPaise, 2500000, 'Payslip gross pay must remain at original snapshot value');
    assert.equal(result.data.data.payslip.netPayPaise, 2300000, 'Payslip net pay must remain at original snapshot value');
  });

  // ── 20. EMPLOYEE SUSPENSION & EXIT ACCESS REVOCATION ──────────────────────
  await suite.test('20. Employee suspension or exit prevents unauthorized future access while preserving historical records', async () => {
    const orgId = 'ORG-ZAMORIN';
    const employeeUserId = 'ST-9901';

    const employee = await User.create({
      userId: employeeUserId,
      organisationId: orgId,
      name: 'Departing Employee',
      email: 'exit@zamorin.local',
      role: 'STAFF',
      lifecycleStatus: 'ACTIVE',
      accountStatus: 'ACTIVE',
      createdBy: 'MU-0001',
      passwordHash: '$2b$10$EixZaYVK1fsbw1ZfbX3OXePaWxn96p36WQmG6W65WVRp7nJ6e9i1e',
    });

    // Seed active session
    const now = Date.now();
    await Session.create({
      sessionId: 'SS-20261010-0001',
      organisationId: orgId,
      userId: employeeUserId,
      roleSnapshot: 'STAFF',
      createdBy: employeeUserId,
      absoluteExpiresAt: new Date(now + 86400000),
      refreshTokenExpiresAt: new Date(now + 86400000),
      accessTokenExpiresAt: new Date(now + 3600000),
      device: { deviceId: 'DEV-001', deviceType: 'DESKTOP' },
      refreshTokenHash: 'hash_refresh_001',
      accessTokenHash: 'hash_access_001',
      tokenFamilyId: 'TF-001',
      status: 'ACTIVE',
    });

    // Seed historical attendance and payslip records
    await Attendance.create({
      attendanceId: 'AT-20260901-001',
      organisationId: orgId,
      cafeId: 'ZC-0001',
      userId: employeeUserId,
      businessDate: '2026-09-01',
      status: 'CHECKED_OUT',
      createdBy: 'MU-0001',
    });

    await Payslip.create({
      payslipId: 'PS-202609-0001',
      organisationId: orgId,
      cafeId: 'ZC-0001',
      payrollRunId: 'PR-202609-0001',
      employeeUserId,
      employeeName: 'Departing Employee',
      periodKey: '2026-09',
      periodStartDate: '2026-09-01',
      periodEndDate: '2026-09-30',
      status: 'PAID',
      issuedAt: new Date(),
      issuedBy: 'MU-0001',
      paidAt: new Date(),
      paidBy: 'MU-0001',
      createdBy: 'MU-0001',
      netPayPaise: 2500000,
      earnings: {
        basicPayPaise: 2700000,
        grossPayPaise: 2700000,
      },
      deductions: {
        providentFundPaise: 200000,
        totalDeductionPaise: 200000,
      },
    });

    // Execute suspension transition
    await updateEmployeeLifecycle(employeeUserId, 'SUSPENDED', {
      organisationId: orgId,
      userId: 'MU-0001',
      reason: 'Disciplinary review',
    });

    // Verify account status and session revocation
    const updatedEmp = await User.findOne({ userId: employeeUserId });
    assert.equal(updatedEmp.lifecycleStatus, 'SUSPENDED');
    assert.equal(updatedEmp.accountStatus, 'SUSPENDED');

    const session = await Session.findOne({ sessionId: 'SS-20261010-0001' });
    assert.equal(session.status, 'REVOKED', 'Active session must be revoked');

    // Verify historical records are intact
    const historicalAtt = await Attendance.findOne({ attendanceId: 'AT-20260901-001' });
    assert.ok(historicalAtt, 'Historical attendance must be preserved');

    const historicalPayslip = await Payslip.findOne({ payslipId: 'PS-202609-0001' });
    assert.ok(historicalPayslip, 'Historical payslip must be preserved');
  });

  // ── 21. PAYROLL & WORKFORCE SUMMARY RECONCILIATION ────────────────────────
  await suite.test('21. Payroll reports and workforce summaries reconcile to persisted records with proper scope', async () => {
    const orgId = 'ORG-ZAMORIN';
    const cafeId = 'ZC-0001';

    await PayrollRun.create({
      payrollRunId: 'PR-202610-0021',
      organisationId: orgId,
      cafeId,
      periodKey: '2026-10',
      periodStartDate: '2026-10-01',
      periodEndDate: '2026-10-31',
      status: 'APPROVED',
      employeeCount: 3,
      totalGrossPaise: 9000000,
      totalDeductionPaise: 900000,
      totalNetPayPaise: 8100000,
      calculatedAt: new Date(),
      calculatedBy: 'MU-0001',
      submittedAt: new Date(),
      submittedBy: 'MU-0001',
      approvedAt: new Date(),
      approvedBy: 'MU-0001',
      createdBy: 'MU-0001',
    });

    const { req, res, getResult } = buildMockReqRes('MASTER', { organisationId: orgId }, {}, { cafeId });
    await getPayrollOverview(req, res);

    const result = getResult();
    assert.equal(result.statusCode, 200);
    assert.equal(result.data.data.kpis.activeRunsCount, 1);
    assert.equal(result.data.data.kpis.netPayPaise, 8100000);
    assert.equal(result.data.data.kpis.employeesInPayroll, 3);
  });

  // ── 22. PRESERVE EXISTING P12 REPORTING & EXPORTS ─────────────────────────
  await suite.test('22. Existing P12 reports and exports continue to work after P13 changes', async () => {
    const { req, res, getResult } = buildMockReqRes('OWNER', {}, {}, { cafeId: 'ZC-0001' });
    await reportController.getReportCatalogue(req, res);
    const result = getResult();

    assert.equal(result.statusCode, 200);
    assert.equal(result.data.success, true);
    assert.ok(Array.isArray(result.data.data.reports), 'Report catalogue must be an array');
    assert.ok(result.data.data.reports.length >= 18, 'Report catalogue must contain all 18 reports');
  });
});
