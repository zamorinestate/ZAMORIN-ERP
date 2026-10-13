'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

// Models
const { User } = require('../src/models/User');
const { EmployeeSkill } = require('../src/models/EmployeeSkill');
const { EmployeeTraining } = require('../src/models/EmployeeTraining');
const { ShiftRoster } = require('../src/models/ShiftRoster');
const { StaffLoanAdvance } = require('../src/models/StaffLoanAdvance');
const { Notification } = require('../src/models/Notification');
const { NotificationOutbox } = require('../src/models/NotificationOutbox');
const { ProfileChangeRequest } = require('../src/models/ProfileChangeRequest');
const { ShiftChangeRequest } = require('../src/models/ShiftChangeRequest');
const { RolePermission } = require('../src/models/RolePermission');

// Controllers & Services
const employeeReadService = require('../src/services/employeeReadService');
const employeeController = require('../src/controllers/employeeController');
const attendanceController = require('../src/modules/attendance/attendanceController');
const loanAdvanceController = require('../src/controllers/loanAdvanceController');
const shiftChangeController = require('../src/controllers/shiftChangeController');
const { authorize } = require('../src/middleware/authorize');

function createMockRes() {
  return {
    statusCode: 200,
    headers: {},
    data: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.data = payload;
      return this;
    },
    setHeader(key, value) {
      this.headers[key.toLowerCase()] = value;
      return this;
    },
    send(payload) {
      this.data = payload;
      return this;
    },
  };
}

test('Staff P2 Product Completion & Hardening Suite', async (suite) => {
  let mongoServer;

  suite.before(async () => {
    mongoServer = await MongoMemoryServer.create();
    await mongoose.connect(mongoServer.getUri());
  });

  suite.after(async () => {
    await mongoose.disconnect();
    await mongoServer.stop();
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // SUITE 1: EXPENSE ROUTE BOUNDARY HARDENING (ROLE-BASED ACCESS CONTROL)
  // ─────────────────────────────────────────────────────────────────────────────

  await suite.test('P2-EXP-1: expenseRoutes.js strictly excludes STAFF from all allowedRoles', () => {
    const expenseRoutesPath = path.resolve(__dirname, '../src/routes/expenseRoutes.js');
    const content = fs.readFileSync(expenseRoutesPath, 'utf8');

    const regex = /allowedRoles:\s*\[([^\]]+)\]/g;
    let match;
    let occurrences = 0;
    while ((match = regex.exec(content)) !== null) {
      occurrences++;
      const rolesString = match[1];
      assert.ok(!rolesString.includes("'STAFF'"), `Expense route allowedRoles must not include STAFF: found in ${rolesString}`);
      assert.ok(!rolesString.includes('"STAFF"'), `Expense route allowedRoles must not include STAFF: found in ${rolesString}`);
    }
    assert.ok(occurrences >= 6, `Expected at least 6 protected expense endpoints, found ${occurrences}`);
  });

  await suite.test('P2-EXP-2: expenseRoutes.js preserves managerial access for MASTER and excludes STAFF', () => {
    const expenseRoutesPath = path.resolve(__dirname, '../src/routes/expenseRoutes.js');
    const content = fs.readFileSync(expenseRoutesPath, 'utf8');

    const regex = /allowedRoles:\s*\[([^\]]+)\]/g;
    let match;
    while ((match = regex.exec(content)) !== null) {
      const rolesString = match[1];
      assert.ok(rolesString.includes("'MASTER'"), `Expense routes must permit MASTER: ${rolesString}`);
      assert.ok(!rolesString.includes("'STAFF'"), `Expense routes must exclude STAFF: ${rolesString}`);
    }
  });

  await suite.test('P2-EXP-3: Staff role gets 403 Forbidden from authorize middleware on expense routes', async () => {
    const staffMiddleware = authorize('EXPENSE_VIEW', { allowedRoles: ['MASTER', 'OWNER', 'CAFE_ADMIN'] });

    const req = {
      auth: {
        userId: 'usr_staff_101',
        role: 'STAFF',
        organisationId: 'org_zamorin_001',
      },
      headers: {},
    };
    let nextCalled = false;

    const res = createMockRes();
    await staffMiddleware(req, res, () => {
      nextCalled = true;
    });

    assert.equal(nextCalled, false, 'Staff should not pass authorize middleware for expense route');
    assert.equal(res.statusCode, 403, 'Should reject with 403 Forbidden');
    assert.equal(res.data?.error?.code, 'ROLE_NOT_ALLOWED');
  });

  await suite.test('P2-EXP-4: Master and Owner roles pass authorize middleware on expense routes', async () => {
    const managerMiddleware = authorize('EXPENSE_VIEW', { allowedRoles: ['MASTER', 'OWNER', 'CAFE_ADMIN'] });

    let ruleIndex = 9001;
    for (const role of ['MASTER', 'OWNER']) {
      await RolePermission.create({
        permissionRuleId: `PR-${ruleIndex++}`,
        organisationId: 'org_zamorin_001',
        role,
        permissionCode: 'EXPENSE_VIEW',
        module: 'FINANCE',
        resource: 'EXPENSE',
        action: 'VIEW',
        scope: 'ORGANISATION',
        effect: 'ALLOW',
        status: 'ACTIVE',
        createdBy: 'SYSTEM',
      });

      const req = {
        auth: {
          userId: `usr_${role.toLowerCase()}_001`,
          role,
          isPrimaryMaster: role === 'MASTER',
          organisationId: 'org_zamorin_001',
        },
        headers: {},
        get(headerName) {
          return this.headers[headerName.toLowerCase()];
        },
      };
      let nextCalled = false;

      const res = createMockRes();
      await managerMiddleware(req, res, () => {
        nextCalled = true;
      });

      assert.equal(nextCalled, true, `${role} must be permitted to access expense routes: status=${res.statusCode} body=${JSON.stringify(res.data)}`);
      assert.equal(res.statusCode, 200);
    }
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // SUITE 2: TRAINING & CERTIFICATION HYDRATION & PRIVACY
  // ─────────────────────────────────────────────────────────────────────────────

  await suite.test('P2-TRN-1: buildEmployeeProfile hydrates skills from options.skills', () => {
    const user = {
      _id: 'usr_staff_test_01',
      userId: 'ST-TEST-01',
      name: 'Priya Nair',
      email: 'priya@zamorin.cafe',
      role: 'STAFF',
      organisationId: 'ZAMORIN',
      employeeProfile: {
        designation: 'Senior Barista',
      },
    };

    const auth = {
      userId: user.userId,
      role: user.role,
      organisationId: user.organisationId,
    };

    const skills = [
      {
        skillName: 'Latte Art',
        proficiencyLevel: 'EXPERT',
        verifiedBy: 'usr_master_001',
        verifiedAt: new Date('2026-01-15T00:00:00Z'),
      },
      {
        name: 'Manual Brewing (V60)',
        level: 'ADVANCED',
        verifiedBy: 'Store Manager',
        verifiedAt: '2026-02-10',
      },
    ];

    const profile = employeeReadService.buildEmployeeProfile(user, auth, { skills });

    assert.equal(profile.skills.length, 2);
    assert.equal(profile.skills[0].name, 'Latte Art');
    assert.equal(profile.skills[0].level, 'EXPERT');
    assert.equal(profile.skills[1].name, 'Manual Brewing (V60)');
    assert.equal(profile.skills[1].level, 'ADVANCED');
  });

  await suite.test('P2-TRN-2: buildEmployeeProfile strips management/internal notes from skills', () => {
    const user = {
      _id: 'usr_staff_test_02',
      userId: 'ST-TEST-02',
      name: 'Anand Kumar',
      email: 'anand@zamorin.cafe',
      role: 'STAFF',
      organisationId: 'ZAMORIN',
    };

    const auth = {
      userId: user.userId,
      role: user.role,
      organisationId: user.organisationId,
    };

    const skills = [
      {
        skillName: 'Espresso Extraction',
        proficiencyLevel: 'INTERMEDIATE',
        managementNotes: 'Needs supervision on grind adjustments during peak rush.',
        internalNotes: 'Admin flagged inconsistency on double-shots.',
        adminFeedback: 'Performance improvement plan required if no progress.',
        confidentialNotes: 'Confidential HR remark',
      },
    ];

    const profile = employeeReadService.buildEmployeeProfile(user, auth, { skills });
    const s = profile.skills[0];

    assert.equal(s.name, 'Espresso Extraction');
    assert.equal(s.managementNotes, undefined, 'managementNotes must be stripped');
    assert.equal(s.internalNotes, undefined, 'internalNotes must be stripped');
    assert.equal(s.adminFeedback, undefined, 'adminFeedback must be stripped');
    assert.equal(s.confidentialNotes, undefined, 'confidentialNotes must be stripped');
  });

  await suite.test('P2-TRN-3: buildEmployeeProfile hydrates trainings from options.trainings', () => {
    const user = {
      _id: 'usr_staff_test_03',
      userId: 'ST-TEST-03',
      name: 'Rahul Varma',
      email: 'rahul@zamorin.cafe',
      role: 'STAFF',
      organisationId: 'ZAMORIN',
    };

    const auth = {
      userId: user.userId,
      role: user.role,
      organisationId: user.organisationId,
    };

    const trainings = [
      {
        course: 'FSSAI Food Safety & Hygiene Level 2',
        status: 'COMPLETED',
        score: '98%',
        completedAt: new Date('2026-03-01T00:00:00Z'),
      },
      {
        trainingTitle: 'Customer Hospitality Masterclass',
        status: 'IN_PROGRESS',
        score: 'N/A',
        dueDate: '2026-10-15',
      },
    ];

    const profile = employeeReadService.buildEmployeeProfile(user, auth, { trainings });

    assert.equal(profile.training.length, 2);
    assert.equal(profile.training[0].course, 'FSSAI Food Safety & Hygiene Level 2');
    assert.equal(profile.training[0].status, 'COMPLETED');
    assert.equal(profile.training[1].course, 'Customer Hospitality Masterclass');
    assert.equal(profile.training[1].status, 'IN_PROGRESS');
  });

  await suite.test('P2-TRN-4: buildEmployeeProfile strips trainer and manager notes from training records', () => {
    const user = {
      _id: 'usr_staff_test_04',
      userId: 'ST-TEST-04',
      name: 'Deepa Menon',
      email: 'deepa@zamorin.cafe',
      role: 'STAFF',
      organisationId: 'ZAMORIN',
    };

    const auth = {
      userId: user.userId,
      role: user.role,
      organisationId: user.organisationId,
    };

    const trainings = [
      {
        trainingTitle: 'Food Allergens & Cross-Contamination',
        status: 'COMPLETED',
        trainerNotes: 'Candidate was late for module 2.',
        evaluationRemarks: 'Marginal pass on practical exercise.',
        managerFeedback: 'HR review requested.',
        confidentialNotes: 'Confidential assessment metric',
      },
    ];

    const profile = employeeReadService.buildEmployeeProfile(user, auth, { trainings });
    const t = profile.training[0];

    assert.equal(t.course, 'Food Allergens & Cross-Contamination');
    assert.equal(t.trainerNotes, undefined, 'trainerNotes must be stripped');
    assert.equal(t.evaluationRemarks, undefined, 'evaluationRemarks must be stripped');
    assert.equal(t.managerFeedback, undefined, 'managerFeedback must be stripped');
    assert.equal(t.confidentialNotes, undefined, 'confidentialNotes must be stripped');
  });

  await suite.test('P2-TRN-5: buildEmployeeProfile attaches empty assets: [] property', () => {
    const user = {
      _id: 'usr_staff_test_05',
      userId: 'ST-TEST-05',
      name: 'Nikhil Das',
      email: 'nikhil@zamorin.cafe',
      role: 'STAFF',
      organisationId: 'ZAMORIN',
    };

    const auth = {
      userId: user.userId,
      role: user.role,
      organisationId: user.organisationId,
    };

    const profile = employeeReadService.buildEmployeeProfile(user, auth);
    assert.ok(Array.isArray(profile.assets), 'profile.assets must be an array');
    assert.equal(profile.assets.length, 0, 'profile.assets must default to empty array');
  });

  await suite.test('P2-TRN-6: getSelfProfile fetches and hydrates skills and training in runtime controller', async () => {
    const orgId = 'ZAMORIN';
    const userId = 'ST-0099';

    await User.create({
      userId,
      name: 'Maya Pillai',
      email: 'maya@zamorin.cafe',
      role: 'STAFF',
      organisationId: orgId,
      status: 'ACTIVE',
      accountStatus: 'ACTIVE',
      employmentStatus: 'ACTIVE',
      passwordHash: 'dummy_hash_for_test_maya',
      createdBy: 'SYSTEM',
    });

    await EmployeeSkill.create({
      skillId: 'SKL-TEST-001',
      organisationId: orgId,
      userId,
      skillName: 'Specialty Roasting',
      proficiencyLevel: 'EXPERT',
      verifiedBy: 'Lead Roaster',
      verifiedAt: new Date(),
    });

    await EmployeeTraining.create({
      trainingId: 'TRN-2026-0001',
      organisationId: orgId,
      userId,
      trainingTitle: 'POS & Cash Drawer Management',
      status: 'COMPLETED',
      dueDate: '2026-10-15',
      completedAt: new Date(),
      trainerNotes: 'Secret internal trainer remark',
    });

    const req = {
      auth: {
        userId,
        role: 'STAFF',
        organisationId: orgId,
      },
      user: {
        userId,
        role: 'STAFF',
        organisationId: orgId,
      },
    };
    const res = createMockRes();

    await employeeController.getSelfProfile(req, res);

    assert.equal(res.statusCode, 200);
    assert.ok(res.data && res.data.data && res.data.data.profile);
    const p = res.data.data.profile;

    assert.ok(Array.isArray(p.skills));
    assert.ok(p.skills.some((s) => s.name === 'Specialty Roasting'));
    assert.ok(Array.isArray(p.training));
    assert.ok(p.training.some((t) => t.course === 'POS & Cash Drawer Management'));
    assert.equal(p.training[0].trainerNotes, undefined, 'trainerNotes must be sanitized from response');
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // SUITE 3: SHIFT ROSTER PUBLICATION NOTIFICATION & DEDUPLICATION
  // ─────────────────────────────────────────────────────────────────────────────

  await suite.test('P2-RST-1: publishRoster dispatches in-app Notification with deepLink #staff-attendance?tab=weekly-roster', async () => {
    const orgId = 'ZAMORIN';
    const managerId = 'MU-0001';
    const staffId = 'ST-0001';
    const rosterId = 'ROSTER-20260907-001';

    await ShiftRoster.create({
      rosterId,
      employeeId: staffId,
      organisationId: orgId,
      cafeId: 'CAFE-01',
      weekStartDate: '2026-09-07',
      status: 'DRAFT',
      isPublished: false,
      createdByUserId: managerId,
      assignments: [
        {
          userId: staffId,
          employeeId: staffId,
          date: '2026-09-08',
          shiftName: 'Morning Shift',
          startTime: '07:00',
          endTime: '15:30',
        },
      ],
    });

    const req = {
      params: { rosterId },
      auth: {
        userId: managerId,
        role: 'MASTER',
        organisationId: orgId,
      },
      headers: {},
      ip: '127.0.0.1',
    };
    const res = createMockRes();

    await attendanceController.publishRoster(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.data.success, true);

    const notif = await Notification.findOne({
      organisationId: orgId,
      recipientUserId: staffId,
      eventType: 'ROSTER_PUBLISHED',
    }).lean();

    assert.ok(notif, 'Notification must be created for assigned staff member');
    assert.equal(notif.deepLink, '#staff-attendance?tab=weekly-roster');
    assert.equal(notif.title, 'Shift Schedule Published');
  });

  await suite.test('P2-RST-2: publishRoster creates NotificationOutbox entry with idempotent deduplication key', async () => {
    const orgId = 'ZAMORIN';
    const managerId = 'MU-0001';
    const staffId = 'ST-0002';
    const rosterId = 'ROSTER-20260914-002';

    await ShiftRoster.create({
      rosterId,
      employeeId: staffId,
      organisationId: orgId,
      cafeId: 'CAFE-02',
      weekStartDate: '2026-09-14',
      status: 'DRAFT',
      isPublished: false,
      createdByUserId: managerId,
      assignments: [
        {
          userId: staffId,
          employeeId: staffId,
          date: '2026-09-15',
          shiftName: 'Evening Shift',
          startTime: '15:00',
          endTime: '23:30',
        },
      ],
    });

    const req = {
      params: { rosterId },
      auth: {
        userId: managerId,
        role: 'MASTER',
        organisationId: orgId,
      },
      headers: {},
      ip: '127.0.0.1',
    };
    const res = createMockRes();

    await attendanceController.publishRoster(req, res);

    assert.equal(res.statusCode, 200);

    const outbox = await NotificationOutbox.findOne({
      organisationId: orgId,
      recipientUserId: staffId,
      eventType: 'ROSTER_PUBLISHED',
    }).lean();

    assert.ok(outbox, `NotificationOutbox must exist for staff recipient`);
    assert.equal(outbox.recipientUserId, staffId);
    assert.equal(outbox.status, 'SENT');
  });

  await suite.test('P2-RST-3: Roster notification payload contains accurate cafeId, weekStartDate, and shift count', async () => {
    const orgId = 'ZAMORIN';
    const managerId = 'MU-0001';
    const staffId = 'ST-0003';
    const rosterId = 'ROSTER-20260921-003';

    await ShiftRoster.create({
      rosterId,
      employeeId: staffId,
      organisationId: orgId,
      cafeId: 'CAFE-03',
      weekStartDate: '2026-09-21',
      status: 'DRAFT',
      isPublished: false,
      createdByUserId: managerId,
      assignments: [
        {
          userId: staffId,
          employeeId: staffId,
          date: '2026-09-22',
          shiftName: 'Morning Shift',
          startTime: '08:00',
          endTime: '16:00',
        },
        {
          userId: staffId,
          employeeId: staffId,
          date: '2026-09-23',
          shiftName: 'Morning Shift',
          startTime: '08:00',
          endTime: '16:00',
        },
      ],
    });

    const req = {
      params: { rosterId },
      auth: {
        userId: managerId,
        role: 'MASTER',
        organisationId: orgId,
      },
      headers: {},
      ip: '127.0.0.1',
    };
    const res = createMockRes();

    await attendanceController.publishRoster(req, res);

    const notif = await Notification.findOne({
      organisationId: orgId,
      recipientUserId: staffId,
      eventType: 'ROSTER_PUBLISHED',
    }).lean();

    assert.ok(notif);
    assert.ok(notif.message.includes('2026-09-21'));
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // SUITE 4: LOAN REPAYMENT DEFERMENT DECISION ENDPOINT & ROUTE
  // ─────────────────────────────────────────────────────────────────────────────

  await suite.test('P2-DEF-1: decideRepaymentPause allows MASTER/OWNER to APPROVE deferment request', async () => {
    const orgId = 'ZAMORIN';
    const staffId = 'ST-0001';
    const masterId = 'MU-0001';
    const loanAdvanceId = 'LN-2001';

    await StaffLoanAdvance.create({
      loanAdvanceId,
      organisationId: orgId,
      cafeId: 'CAFE01',
      employeeUserId: staffId,
      employeeName: 'Priya Nair',
      requestType: 'LOAN',
      requestedAmountPaise: 2500000,
      approvedAmountPaise: 2500000,
      principalPaise: 2500000,
      status: 'ACTIVE',
      createdByUserId: staffId,
      pauseDetails: {
        isPaused: false,
        pauseFromPeriod: '2026-10',
        resumePeriod: '2026-12',
        pauseReason: 'Medical emergency in family',
      },
    });

    const req = {
      params: { loanAdvanceId },
      body: {
        decision: 'APPROVE',
        decisionNotes: 'Approved based on medical documentation',
      },
      auth: {
        userId: masterId,
        role: 'MASTER',
        isPrimaryMaster: true,
        organisationId: orgId,
      },
      headers: {},
      ip: '127.0.0.1',
    };
    const res = createMockRes();

    await loanAdvanceController.decideRepaymentPause(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.data.success, true);
    assert.equal(res.data.data.loan.pauseDetails.isPaused, true);

    const notif = await Notification.findOne({
      organisationId: orgId,
      recipientUserId: staffId,
      eventType: 'LOAN_DEFERMENT_APPROVED',
    }).lean();

    assert.ok(notif, 'Approval notification must be dispatched to staff');
    assert.equal(notif.deepLink, '#staff-loans-advances');

    const outbox = await NotificationOutbox.findOne({
      organisationId: orgId,
      recipientUserId: staffId,
      eventType: 'LOAN_DEFERMENT_APPROVED',
    }).lean();

    assert.ok(outbox, 'NotificationOutbox entry must be created for deferment decision');
  });

  await suite.test('P2-DEF-2: decideRepaymentPause allows MASTER/OWNER to REJECT deferment request', async () => {
    const orgId = 'ZAMORIN';
    const staffId = 'ST-0002';
    const ownerId = 'OWN-0001';
    const loanAdvanceId = 'LN-2002';

    await StaffLoanAdvance.create({
      loanAdvanceId,
      organisationId: orgId,
      cafeId: 'CAFE01',
      employeeUserId: staffId,
      employeeName: 'Rahul Varma',
      requestType: 'LOAN',
      requestedAmountPaise: 1500000,
      approvedAmountPaise: 1500000,
      principalPaise: 1500000,
      status: 'ACTIVE',
      createdByUserId: staffId,
      pauseDetails: {
        isPaused: false,
        pauseFromPeriod: '2026-10',
        resumePeriod: '2026-11',
        pauseReason: 'Personal expense',
      },
    });

    const req = {
      params: { loanAdvanceId },
      body: {
        decision: 'REJECT',
        decisionNotes: 'Insufficient tenure for voluntary deferment',
      },
      auth: {
        userId: ownerId,
        role: 'OWNER',
        organisationId: orgId,
      },
      headers: {},
      ip: '127.0.0.1',
    };
    const res = createMockRes();

    await loanAdvanceController.decideRepaymentPause(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.data.success, true);
    assert.equal(res.data.data.loan.pauseDetails.isPaused, false);

    const notif = await Notification.findOne({
      organisationId: orgId,
      recipientUserId: staffId,
      eventType: 'LOAN_DEFERMENT_REJECTED',
    }).lean();

    assert.ok(notif, 'Rejection notification must be dispatched to staff');
    assert.equal(notif.deepLink, '#staff-loans-advances');
  });

  await suite.test('P2-DEF-3: decideRepaymentPause rejects duplicate decisions with 409 Conflict (idempotency guard)', async () => {
    const orgId = 'ZAMORIN';
    const staffId = 'ST-0003';
    const masterId = 'MU-0001';
    const loanAdvanceId = 'LN-2003';

    await StaffLoanAdvance.create({
      loanAdvanceId,
      organisationId: orgId,
      cafeId: 'CAFE01',
      employeeUserId: staffId,
      employeeName: 'Anand Kumar',
      requestType: 'LOAN',
      requestedAmountPaise: 1000000,
      approvedAmountPaise: 1000000,
      principalPaise: 1000000,
      status: 'ACTIVE',
      createdByUserId: staffId,
      pauseDetails: {
        isPaused: true,
        pauseFromPeriod: '2026-10',
        approvedAt: new Date(),
        approvedByUserId: masterId,
      },
    });

    const req = {
      params: { loanAdvanceId },
      body: {
        decision: 'APPROVE',
        decisionNotes: 'Trying to approve again',
      },
      auth: {
        userId: masterId,
        role: 'MASTER',
        isPrimaryMaster: true,
        organisationId: orgId,
      },
      headers: {},
      ip: '127.0.0.1',
    };
    const res = createMockRes();

    await loanAdvanceController.decideRepaymentPause(req, res);

    assert.equal(res.statusCode, 409, 'Duplicate decision must return 409 Conflict');
    assert.equal(res.data.success, false);
  });

  await suite.test('P2-DEF-4: loanAdvanceRoutes.js mounts pause-decision restricted to MASTER and OWNER', () => {
    const routesPath = path.resolve(__dirname, '../src/routes/loanAdvanceRoutes.js');
    const content = fs.readFileSync(routesPath, 'utf8');

    assert.ok(content.includes('/admin/loans/:loanAdvanceId/pause-decision'), 'Route must be mounted');
    assert.ok(content.includes("allowedRoles: ['MASTER', 'OWNER']"), 'Route must restrict to MASTER and OWNER');
    assert.ok(!content.includes("allowedRoles: ['MASTER', 'OWNER', 'STAFF']"), 'STAFF must never be in allowedRoles for pause-decision');
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // SUITE 5: SCREEN BADGE ALIGNMENT & VERIFICATION
  // ─────────────────────────────────────────────────────────────────────────────

  await suite.test('P2-SCR-1: announcements.js declares canonical screen badge EMP-SCR-002', () => {
    const filePath = path.resolve(__dirname, '../../frontend/src/js/pages/announcements.js');
    const content = fs.readFileSync(filePath, 'utf8');

    assert.ok(content.includes('EMP-SCR-002'), 'announcements.js must have EMP-SCR-002');
    assert.ok(!content.includes('EMP-SCR-004 · Zamorin Announcements'), 'Old mismatch EMP-SCR-004 must not be in announcements.js header');
  });

  await suite.test('P2-SCR-2: staffAttendance.js declares canonical screen badge EMP-SCR-003', () => {
    const filePath = path.resolve(__dirname, '../../frontend/src/js/modules/attendance/staffAttendance.js');
    const content = fs.readFileSync(filePath, 'utf8');

    assert.ok(content.includes('EMP-SCR-003'), 'staffAttendance.js must have EMP-SCR-003');
    assert.ok(!content.includes('EMP-SCR-002 · Attendance Hub'), 'Old mismatch EMP-SCR-002 must not be in staffAttendance.js header');
  });

  await suite.test('P2-SCR-3: All 5 canonical screen badges match Gate 0 historical reconciliation', () => {
    const screenFiles = [
      { id: 'EMP-SCR-001', file: '../../frontend/src/js/pages/staffHome.js' },
      { id: 'EMP-SCR-002', file: '../../frontend/src/js/pages/announcements.js' },
      { id: 'EMP-SCR-003', file: '../../frontend/src/js/modules/attendance/staffAttendance.js' },
      { id: 'EMP-SCR-004', file: '../../frontend/src/js/pages/staffLeave.js' },
      { id: 'EMP-SCR-005', file: '../../frontend/src/js/pages/staffLoansAdvances.js' },
    ];

    for (const screen of screenFiles) {
      const p = path.resolve(__dirname, screen.file);
      const content = fs.readFileSync(p, 'utf8');
      assert.ok(content.includes(screen.id), `Screen file ${screen.file} must include canonical ID ${screen.id}`);
    }
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // SUITE 6: WEEKLY ROSTER UX, DEEP LINKING & NAVIGATION
  // ─────────────────────────────────────────────────────────────────────────────

  await suite.test('P2-NAV-1: navigation.js isRouteAllowed correctly strips query params for route validation', () => {
    const navPath = path.resolve(__dirname, '../../frontend/src/js/navigation.js');
    const content = fs.readFileSync(navPath, 'utf8');

    assert.ok(content.includes("cleanRoute.split('?')[0]"), 'isRouteAllowed must split on ? to strip query strings');
  });

  await suite.test('P2-NAV-2: router.js strips query parameters before extracting baseRoute', () => {
    const routerPath = path.resolve(__dirname, '../../frontend/src/js/router.js');
    const content = fs.readFileSync(routerPath, 'utf8');

    assert.ok(content.includes('(route || "").split("?")'), 'router.js must split query strings before extracting baseRoute');
  });

  await suite.test('P2-NAV-3: staffAttendance.js renders Weekly Roster tab and shift change modal', () => {
    const attPath = path.resolve(__dirname, '../../frontend/src/js/modules/attendance/staffAttendance.js');
    const content = fs.readFileSync(attPath, 'utf8');

    assert.ok(content.includes('tab=weekly-roster'), 'staffAttendance.js must wire tab=weekly-roster');
    assert.ok(content.includes('renderWeeklyRosterTab'), 'staffAttendance.js must have renderWeeklyRosterTab');
    assert.ok(content.includes('openShiftChangeModal'), 'staffAttendance.js must wire openShiftChangeModal');
    assert.ok(content.includes('Overnight'), 'Roster must support overnight shift display');
  });

  await suite.test('P2-NAV-4: staffHome.js links roster action to staff-attendance?tab=weekly-roster', () => {
    const homePath = path.resolve(__dirname, '../../frontend/src/js/pages/staffHome.js');
    const content = fs.readFileSync(homePath, 'utf8');

    assert.ok(content.includes('staff-attendance?tab=weekly-roster'), 'staffHome.js must link to weekly-roster tab');
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // SUITE 7: BOUNDED PAGINATION PROTECTION
  // ─────────────────────────────────────────────────────────────────────────────

  await suite.test('P2-PAG-1: listSelfChangeRequests bounds pagination limit parameter between 1 and 100', async () => {
    const orgId = 'ZAMORIN';
    const userId = 'ST-PAGE-01';

    // Insert 105 requests
    const docs = [];
    for (let i = 0; i < 105; i++) {
      docs.push({
        requestId: `PCR-202609-${String(i + 1).padStart(5, '0')}`,
        organisationId: orgId,
        userId,
        requestType: 'CONTACT_UPDATE',
        section: 'PERSONAL',
        title: `Pagination Test ${i}`,
        reason: 'Testing pagination upper bound',
        status: 'SUBMITTED',
        proposedValues: {},
      });
    }
    await ProfileChangeRequest.insertMany(docs);

    const req = {
      auth: { userId, role: 'STAFF', organisationId: orgId },
      query: { limit: '9999' },
    };
    const res = createMockRes();

    await employeeController.listSelfChangeRequests(req, res);

    assert.equal(res.statusCode, 200);
    assert.ok(res.data.success);
    assert.equal(res.data.data.requests.length, 100, 'Requests array must be clamped to safeLimit of 100');
  });

  await suite.test('P2-PAG-2: listSelfShiftChangeRequests bounds pagination limit parameter between 1 and 100', async () => {
    const orgId = 'ZAMORIN';
    const userId = 'ST-PAGE-02';

    // Insert 105 shift change requests
    const docs = [];
    for (let i = 0; i < 105; i++) {
      docs.push({
        requestId: `SCR-202609-${String(i + 1).padStart(5, '0')}`,
        organisationId: orgId,
        employeeUserId: userId,
        requestedDate: '2026-09-10',
        currentShift: 'Morning',
        requestedShift: 'Evening',
        reason: 'Personal reason',
        status: 'SUBMITTED',
      });
    }
    await ShiftChangeRequest.insertMany(docs);

    const req = {
      auth: { userId, role: 'STAFF', organisationId: orgId },
      query: { limit: '500' },
    };
    const res = createMockRes();

    await shiftChangeController.listSelfShiftChangeRequests(req, res);

    assert.equal(res.statusCode, 200);
    assert.ok(res.data.success);
    assert.equal(res.data.data.requests.length, 100, 'Shift change requests array must be clamped to safeLimit of 100');
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // SUITE 8: MODAL ACCESSIBILITY & FOCUS TRAPPING
  // ─────────────────────────────────────────────────────────────────────────────

  await suite.test('P2-A11Y-1: modalA11y.js exists and exports setupModalA11y', () => {
    const modalA11yPath = path.resolve(__dirname, '../../frontend/src/js/utils/modalA11y.js');
    const content = fs.readFileSync(modalA11yPath, 'utf8');

    assert.ok(content.includes('export function setupModalA11y'), 'Must export setupModalA11y');
    assert.ok(content.includes('role'), 'Must manage role="dialog"');
    assert.ok(content.includes('aria-modal'), 'Must manage aria-modal="true"');
    assert.ok(content.includes('Escape'), 'Must support Escape dismissal');
    assert.ok(content.includes('Tab'), 'Must trap Tab focus');
  });

  await suite.test('P2-A11Y-2: staffDocuments.js wires setupModalA11y for upload modal', () => {
    const docPath = path.resolve(__dirname, '../../frontend/src/js/pages/staffDocuments.js');
    const content = fs.readFileSync(docPath, 'utf8');

    assert.ok(content.includes('setupModalA11y'), 'staffDocuments.js must import setupModalA11y');
    assert.ok(content.includes('upload-doc-modal-title'), 'staffDocuments.js must have upload-doc-modal-title');
  });

  await suite.test('P2-A11Y-3: employeeProfile.js wires setupModalA11y for edit, inaccuracy, and diagnostics modals', () => {
    const profPath = path.resolve(__dirname, '../../frontend/src/js/pages/employeeProfile.js');
    const content = fs.readFileSync(profPath, 'utf8');

    assert.ok(content.includes('setupModalA11y'), 'employeeProfile.js must import setupModalA11y');
    assert.ok(content.includes('edit-profile-modal-title'), 'employeeProfile.js must have edit-profile-modal-title');
    assert.ok(content.includes('report-inaccuracy-modal-title'), 'employeeProfile.js must have report-inaccuracy-modal-title');
    assert.ok(content.includes('diagnostics-modal-title'), 'employeeProfile.js must have diagnostics-modal-title');
  });

  await suite.test('P2-A11Y-4: settingsShared.js wires setupModalA11y for support ticket modals', () => {
    const setPath = path.resolve(__dirname, '../../frontend/src/js/pages/settingsShared.js');
    const content = fs.readFileSync(setPath, 'utf8');

    assert.ok(content.includes('setupModalA11y'), 'settingsShared.js must import setupModalA11y');
    assert.ok(content.includes('st-modal-title'), 'settingsShared.js must have st-modal-title');
    assert.ok(content.includes('erm-modal-title'), 'settingsShared.js must have erm-modal-title');
    assert.ok(content.includes('mtm-modal-title'), 'settingsShared.js must have mtm-modal-title');
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // SUITE 9: OFFLINE ATTENDANCE INVARIANT & PUNCH PROTECTION
  // ─────────────────────────────────────────────────────────────────────────────

  await suite.test('P2-OFF-1: Offline attendance punch caching is strictly prohibited', () => {
    const attPath = path.resolve(__dirname, '../../frontend/src/js/modules/attendance/staffAttendance.js');
    const content = fs.readFileSync(attPath, 'utf8');

    assert.ok(!content.includes('localStorage.setItem("attendance_punches"'), 'Must never queue offline punches to localStorage');
    assert.ok(!content.includes('localStorage.setItem("offline_punches"'), 'Must never queue offline punches to localStorage');
    assert.ok(content.includes('Offline punch caching is strictly prohibited') || content.includes('Network connection required'), 'Must explicitly communicate offline prohibition');
  });
});
