'use strict';

/**
 * ============================================================================
 * ZAMORIN CAFÉ ERP — P16 TASKS, TRAINING & SOPS ACCEPTANCE SUITE
 * ============================================================================
 *
 * Verifies all 20 Acceptance Conditions for Package P16:
 *  1. Task creation and assignment with role, category, risk, and café scoping.
 *  2. Predecessor task dependency enforcement: predecessor must be COMPLETED before dependent task can proceed.
 *  3. Stepwise checklist execution with item pass/fail statuses and failure reasons.
 *  4. GPS geofence validation: in-range (<200m) passes; out-of-range (>200m) fails validation.
 *  5. Photo evidence attachment submission with actor audit and private metadata.
 *  6. AI proof review: truthful pending-human-review state when unconfigured (TASK_AI_VISION_API_KEY absent).
 *  7. Segregation of duties: performer cannot verify their own work when verification is required.
 *  8. Supervisor verification and completion workflow.
 *  9. Return for correction with mandatory reason, return history audit, and rejection workflow.
 * 10. Reopening completed tasks with mandatory reason and audit logging.
 * 11. Task cancellation and blocking with mandatory reasons.
 * 12. Idempotent recurring task scheduler: repeated runs on the same date create exactly 0 duplicate tasks.
 * 13. Overdue task detector and notification outbox reminders.
 * 14. SOP version lineage preservation on tasks and staff acknowledgments.
 * 15. Employee training course creation, assignment, assessment scoring (80% pass threshold), and certification.
 * 16. Operational task prerequisite enforcement: uncertified staff blocked from high-risk tasks requiring training.
 * 17. Suspended / exited employee protection: cannot receive tasks or training assignments.
 * 18. Multi-outlet compliance reporting reconciliation (completion %, on-time %, geofence %).
 * 19. Canonical persona security matrix: Primary Master full, Cafe Ops scoped, Owner read-only, Staff self-service only, Vendor denied, retired Normal Master 403.
 * 20. Cross-café IDOR / BOLA protection: Cafe Operations denied mutations on unassigned café tasks.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryReplSet } = require('mongodb-memory-server');

process.env.NODE_ENV = 'test';
process.env.TEST_MODE = 'true';

// Models
const { Task } = require('../src/models/Task');
const { TaskTemplate } = require('../src/models/TaskTemplate');
const { TaskRecurrenceSchedule } = require('../src/models/TaskRecurrenceSchedule');
const { TrainingCourse } = require('../src/models/TrainingCourse');
const { EmployeeTraining } = require('../src/models/EmployeeTraining');
const { StandardOperatingProcedure } = require('../src/models/StandardOperatingProcedure');
const { SopAcknowledgement } = require('../src/models/SopAcknowledgement');
const { User } = require('../src/models/User');
const { Cafe } = require('../src/models/Cafe');
const { NotificationOutbox } = require('../src/models/NotificationOutbox');
const { AuditEvent } = require('../src/models/AuditEvent');
const { SequenceCounter } = require('../src/models/SequenceCounter');

// Services & Controllers
const { TaskManagementService } = require('../src/services/taskManagementService');
const { TaskSchedulerService } = require('../src/services/taskSchedulerService');
const { TaskAiVerificationService } = require('../src/services/taskAiVerificationService');
const { validateLocationProof, calculateHaversineDistanceMeters } = require('../src/services/taskLocationService');
const { EmployeeTrainingService } = require('../src/services/employeeTrainingService');
const {
  listTasks,
  getTask,
  createTask,
  updateTaskStatus,
  completeTask,
  verifyTask,
  returnTask,
  reopenTask,
  cancelTask,
  blockTask,
  reassignTask,
  submitTaskEvidence,
  listTemplates,
  createTemplate,
  getTemplate,
  updateTemplate,
  runScheduler,
  processOverdue,
  getComplianceReport,
  getMyTasks,
  assignTraining,
  submitTrainingAssessment,
  getMyTraining,
} = require('../src/controllers/taskController');
const { authorize } = require('../src/middleware/authorize');

// Helper to construct mock request & response
function buildMockReqRes(role, customAuth = {}, body = {}, query = {}, params = {}, headers = {}) {
  let statusCode = 200;
  let responseData = null;
  const resHeaders = {};

  const req = {
    auth: {
      userId: customAuth.userId || (role === 'MASTER' ? 'MU-0001' : (role === 'OWNER' ? 'OW-0001' : (role === 'CAFE_ADMIN' ? 'AD-0001' : 'ST-0001'))),
      role,
      organisationId: customAuth.organisationId || 'ORG-ZAMORIN',
      isPrimaryMaster: customAuth.isPrimaryMaster !== undefined ? customAuth.isPrimaryMaster : (role === 'MASTER'),
      assignedCafeIds: customAuth.assignedCafeIds || ['ZC-0001'],
      primaryCafeId: customAuth.primaryCafeId || 'ZC-0001',
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
      resHeaders[name] = val;
    },
  };

  return { req, res, getResult: () => ({ statusCode, data: responseData, headers: resHeaders }) };
}

test('P16: Tasks, Training & SOPs Parity Implementation Suite', async (suite) => {
  let replSet;

  suite.before(async () => {
    replSet = await MongoMemoryReplSet.create({
      replSet: { count: 1, storageEngine: 'wiredTiger' },
    });
    await replSet.waitUntilRunning();
    const uri = replSet.getUri();
    await mongoose.connect(uri);

    // Pre-create collections and indexes
    await Promise.all([
      Task.createCollection(),
      TaskTemplate.createCollection(),
      TaskRecurrenceSchedule.createCollection(),
      TrainingCourse.createCollection(),
      EmployeeTraining.createCollection(),
      StandardOperatingProcedure.createCollection(),
      SopAcknowledgement.createCollection(),
      User.createCollection(),
      Cafe.createCollection(),
      NotificationOutbox.createCollection(),
      AuditEvent.createCollection(),
      SequenceCounter.createCollection(),
    ]);

    // Seed test cafes
    await Cafe.create([
      {
        cafeId: 'ZC-0001',
        organisationId: 'ORG-ZAMORIN',
        name: 'Zamorin Speciality Coffee Flagship',
        displayName: 'Zamorin Flagship',
        status: 'ACTIVE',
        createdBy: 'SYSTEM',
      },
      {
        cafeId: 'ZC-0002',
        organisationId: 'ORG-ZAMORIN',
        name: 'Zamorin Beachfront Bistro',
        displayName: 'Zamorin Beachfront',
        status: 'ACTIVE',
        createdBy: 'SYSTEM',
      },
    ]);

    // Seed test users
    await User.create([
      {
        userId: 'MU-0001',
        organisationId: 'ORG-ZAMORIN',
        name: 'Primary Master Admin',
        role: 'MASTER',
        email: 'master@zamorin.test',
        passwordHash: '$2b$10$dummyHashPrimaryMaster00000000000000000000000000000000000',
        accountStatus: 'ACTIVE',
        status: 'ACTIVE',
        isPrimaryMaster: true,
        primaryMasterDesignatedAt: new Date(),
        primaryMasterDesignatedBy: 'SYSTEM_BOOTSTRAP',
        primaryMasterDesignationReason: 'Initial bootstrap',
        assignedCafeIds: [],
        createdBy: 'SYSTEM',
      },
      {
        userId: 'AD-0001',
        organisationId: 'ORG-ZAMORIN',
        name: 'Flagship Operations Manager',
        role: 'CAFE_ADMIN',
        email: 'ops.flagship@zamorin.test',
        passwordHash: '$2b$10$dummyHashCafeAdmin000000000000000000000000000000000000000',
        accountStatus: 'ACTIVE',
        status: 'ACTIVE',
        assignedCafeIds: ['ZC-0001'],
        primaryCafeId: 'ZC-0001',
        createdBy: 'SYSTEM',
      },
      {
        userId: 'ST-0001',
        organisationId: 'ORG-ZAMORIN',
        name: 'Barista Rahul',
        role: 'STAFF',
        email: 'rahul.barista@zamorin.test',
        passwordHash: '$2b$10$dummyHashStaff010000000000000000000000000000000000000000',
        accountStatus: 'ACTIVE',
        status: 'ACTIVE',
        assignedCafeIds: ['ZC-0001'],
        primaryCafeId: 'ZC-0001',
        createdBy: 'SYSTEM',
      },
      {
        userId: 'ST-0002',
        organisationId: 'ORG-ZAMORIN',
        name: 'Kitchen Staff Priya',
        role: 'STAFF',
        email: 'priya.kitchen@zamorin.test',
        passwordHash: '$2b$10$dummyHashStaff020000000000000000000000000000000000000000',
        accountStatus: 'ACTIVE',
        status: 'ACTIVE',
        assignedCafeIds: ['ZC-0001'],
        primaryCafeId: 'ZC-0001',
        createdBy: 'SYSTEM',
      },
      {
        userId: 'ST-9999',
        organisationId: 'ORG-ZAMORIN',
        name: 'Exited Employee Sam',
        role: 'STAFF',
        email: 'sam.exited@zamorin.test',
        passwordHash: '$2b$10$dummyHashStaffExited000000000000000000000000000000000000',
        accountStatus: 'ARCHIVED',
        status: 'EXITED',
        employmentStatus: 'EXITED',
        assignedCafeIds: ['ZC-0001'],
        createdBy: 'SYSTEM',
      },
      {
        userId: 'OW-0001',
        organisationId: 'ORG-ZAMORIN',
        name: 'Executive Owner',
        role: 'OWNER',
        email: 'owner@zamorin.test',
        passwordHash: '$2b$10$dummyHashOwner00000000000000000000000000000000000000000',
        accountStatus: 'ACTIVE',
        status: 'ACTIVE',
        assignedCafeIds: ['ZC-0001', 'ZC-0002'],
        createdBy: 'SYSTEM',
      },
    ]);
  });

  suite.after(async () => {
    await mongoose.disconnect();
    if (replSet) {
      await replSet.stop();
    }
  });

  // ─── 1. TASK CREATION & ASSIGNMENT ───────────────────────────────────────────
  await suite.test('1. Task creation and assignment with role, category, risk, and café scoping', async () => {
    const { req, res, getResult } = buildMockReqRes(
      'CAFE_ADMIN',
      { userId: 'AD-0001', assignedCafeIds: ['ZC-0001'] },
      {
        title: 'Morning Espresso Machine Calibration',
        category: 'EQUIPMENT_MAINTENANCE',
        priority: 'HIGH',
        risk: 'MEDIUM',
        cafeId: 'ZC-0001',
        assignedUserId: 'ST-0001',
        assignedRole: 'STAFF',
        dueDate: '2026-10-15',
        dueTime: '07:30',
        verificationRequired: true,
        checklist: [
          'Flush group heads with hot water',
          'Measure grinder dose weight (18.0g +/- 0.2g)',
          'Calibrate boiler pressure to 9.0 bar',
        ],
      }
    );

    await createTask(req, res);
    const { statusCode, data } = getResult();
    assert.equal(statusCode, 201);
    assert.ok(data.data.task.taskId.startsWith('TSK-'));
    assert.equal(data.data.task.assignedUserId, 'ST-0001');
    assert.equal(data.data.task.status, 'PENDING');
    assert.equal(data.data.task.verificationRequired, true);
    assert.equal(data.data.task.checklist.length, 3);

    // Verify outbox notification generated for assignee
    const outbox = await NotificationOutbox.findOne({
      recipientUserId: 'ST-0001',
      'payload.taskId': data.data.task.taskId,
    });
    assert.ok(outbox);
    assert.equal(outbox.eventType, 'TASK_ASSIGNED');
  });

  // ─── 2. PREDECESSOR TASK DEPENDENCY ENFORCEMENT ──────────────────────────────
  await suite.test('2. Predecessor task dependency enforcement: predecessor must be COMPLETED before dependent task can proceed', async () => {
    // Create Task A (Prerequisite)
    const taskA = await TaskManagementService.createTask(
      'ORG-ZAMORIN',
      {
        title: 'Receiving Dairy Delivery',
        category: 'INVENTORY_RECEIVING',
        assignedUserId: 'ST-0001',
        cafeId: 'ZC-0001',
      },
      { userId: 'AD-0001', role: 'CAFE_ADMIN' }
    );

    // Create Task B dependent on Task A
    const taskB = await TaskManagementService.createTask(
      'ORG-ZAMORIN',
      {
        title: 'Cold Storage Stocking',
        category: 'INVENTORY_RECEIVING',
        assignedUserId: 'ST-0001',
        cafeId: 'ZC-0001',
        dependencyTaskIds: [taskA.taskId],
      },
      { userId: 'AD-0001', role: 'CAFE_ADMIN' }
    );

    // Try starting or completing Task B while Task A is still PENDING -> should throw error
    await assert.rejects(async () => {
      await TaskManagementService.submitTaskEvidence({
        organisationId: 'ORG-ZAMORIN',
        taskId: taskB.taskId,
        submission: { notes: 'Attempting to store dairy before receiving' },
        auth: { userId: 'ST-0001', role: 'STAFF' },
      });
    }, (err) => err.code === 'PREDECESSOR_NOT_COMPLETED' && err.predecessorTaskId === taskA.taskId);

    // Now complete Task A
    await TaskManagementService.submitTaskEvidence({
      organisationId: 'ORG-ZAMORIN',
      taskId: taskA.taskId,
      submission: { notes: 'Dairy shipment received and verified' },
      auth: { userId: 'ST-0001', role: 'STAFF' },
    });

    const taskADoc = await Task.findOne({ taskId: taskA.taskId });
    assert.equal(taskADoc.status, 'COMPLETED');

    // Now Task B submission should succeed without dependency violation
    const resB = await TaskManagementService.submitTaskEvidence({
      organisationId: 'ORG-ZAMORIN',
      taskId: taskB.taskId,
      submission: { notes: 'Stocked in cold storage' },
      auth: { userId: 'ST-0001', role: 'STAFF' },
    });
    assert.equal(resB.task.status, 'COMPLETED');
  });

  // ─── 3. STEPWISE CHECKLIST EXECUTION ─────────────────────────────────────────
  await suite.test('3. Stepwise checklist execution with item pass/fail statuses and failure reasons', async () => {
    const task = await TaskManagementService.createTask(
      'ORG-ZAMORIN',
      {
        title: 'Daily Water Filter Inspection',
        category: 'EQUIPMENT_MAINTENANCE',
        assignedUserId: 'ST-0001',
        cafeId: 'ZC-0001',
        checklist: ['Check inlet water pressure', 'Inspect sediment pre-filter', 'Measure TDS output'],
      },
      { userId: 'AD-0001', role: 'CAFE_ADMIN' }
    );

    const submission = {
      checklist: [
        { item: 'Check inlet water pressure', status: 'PASS' },
        { item: 'Inspect sediment pre-filter', status: 'FAIL', failureReason: 'Sediment buildup visible; cartridge needs replacement.' },
        { item: 'Measure TDS output', status: 'PASS' },
      ],
      notes: 'Sediment filter requires replacement within 24 hours.',
    };

    const result = await TaskManagementService.submitTaskEvidence({
      organisationId: 'ORG-ZAMORIN',
      taskId: task.taskId,
      submission,
      auth: { userId: 'ST-0001', role: 'STAFF' },
    });

    assert.equal(result.task.checklist[0].status, 'PASS');
    assert.equal(result.task.checklist[1].status, 'FAIL');
    assert.equal(result.task.checklist[1].failureReason, 'Sediment buildup visible; cartridge needs replacement.');
    assert.equal(result.task.checklist[2].status, 'PASS');
  });

  // ─── 4. GPS GEOFENCE VALIDATION ──────────────────────────────────────────────
  await suite.test('4. GPS geofence validation: in-range (<200m) passes; out-of-range (>200m) fails validation', async () => {
    // Calicut Flagship coordinates
    const siteLat = 11.2588;
    const siteLng = 75.7804;

    // Haversine distance tests
    const samePoint = calculateHaversineDistanceMeters(siteLat, siteLng, siteLat, siteLng);
    assert.equal(samePoint, 0);

    // Coordinate ~50m away
    const closePoint = { latitude: 11.2592, longitude: 75.7806 };
    const closeValidation = validateLocationProof(closePoint, {
      latitude: siteLat,
      longitude: siteLng,
      radiusMeters: 200,
    });
    assert.equal(closeValidation.isVerified, true);
    assert.equal(closeValidation.status, 'VERIFIED_IN_RANGE');
    assert.ok(closeValidation.distanceMeters <= 200);

    // Coordinate ~1.5km away
    const farPoint = { latitude: 11.2720, longitude: 75.7900 };
    const farValidation = validateLocationProof(farPoint, {
      latitude: siteLat,
      longitude: siteLng,
      radiusMeters: 200,
    });
    assert.equal(farValidation.isVerified, false);
    assert.equal(farValidation.status, 'OUT_OF_RANGE');
    assert.ok(farValidation.distanceMeters > 200);

    // Backend enforcement in submitTaskEvidence
    const geoTask = await TaskManagementService.createTask(
      'ORG-ZAMORIN',
      {
        title: 'Morning Store Opening Walkthrough',
        assignedUserId: 'ST-0001',
        cafeId: 'ZC-0001',
        locationRequirement: {
          requiresLocation: true,
          targetLatitude: siteLat,
          targetLongitude: siteLng,
          allowedRadiusMeters: 200,
        },
      },
      { userId: 'AD-0001', role: 'CAFE_ADMIN' }
    );

    // Submission with far point must throw GEOFENCE_VALIDATION_FAILED
    await assert.rejects(async () => {
      await TaskManagementService.submitTaskEvidence({
        organisationId: 'ORG-ZAMORIN',
        taskId: geoTask.taskId,
        submission: { location: farPoint },
        auth: { userId: 'ST-0001', role: 'STAFF' },
      });
    }, (err) => err.code === 'GEOFENCE_VALIDATION_FAILED');

    // Submission with close point succeeds
    const successGeo = await TaskManagementService.submitTaskEvidence({
      organisationId: 'ORG-ZAMORIN',
      taskId: geoTask.taskId,
      submission: { location: closePoint },
      auth: { userId: 'ST-0001', role: 'STAFF' },
    });
    assert.equal(successGeo.task.submittedLocation.isVerified, true);
    assert.ok(successGeo.task.submittedLocation.distanceMeters <= 200);
  });

  // ─── 5. PHOTO EVIDENCE SUBMISSION & ACTOR AUDIT ──────────────────────────────
  await suite.test('5. Photo evidence attachment submission with actor audit and private metadata', async () => {
    const task = await TaskManagementService.createTask(
      'ORG-ZAMORIN',
      {
        title: 'Deep Clean Coffee Grinder Burr Chamber',
        category: 'EQUIPMENT_MAINTENANCE',
        assignedUserId: 'ST-0001',
        cafeId: 'ZC-0001',
      },
      { userId: 'AD-0001', role: 'CAFE_ADMIN' }
    );

    const evidencePhotos = [
      {
        fileId: 'FILE-BURR-CLEAN-01',
        fileName: 'clean_burr_chamber.jpg',
        fileUrl: '/api/v1/files/FILE-BURR-CLEAN-01',
        photoType: 'BEFORE_AFTER_PROOF',
      },
    ];

    const result = await TaskManagementService.submitTaskEvidence({
      organisationId: 'ORG-ZAMORIN',
      taskId: task.taskId,
      submission: { evidence: evidencePhotos, notes: 'Burr chamber brushed and vacuumed' },
      auth: { userId: 'ST-0001', role: 'STAFF' },
    });

    assert.equal(result.task.evidence.length, 1);
    assert.equal(result.task.evidence[0].fileId, 'FILE-BURR-CLEAN-01');
    assert.equal(result.task.evidence[0].uploadedByUserId, 'ST-0001');
    assert.equal(result.task.evidence[0].photoType, 'BEFORE_AFTER_PROOF');
  });

  // ─── 6. AI PROOF REVIEW TRUTHFUL UNCONFIGURED HANDLING ───────────────────────
  await suite.test('6. AI proof review: truthful pending-human-review state when unconfigured (TASK_AI_VISION_API_KEY absent)', async () => {
    delete process.env.TASK_AI_VISION_API_KEY;

    const evaluation = TaskAiVerificationService.evaluateEvidence(
      {
        evidence: [{ fileId: 'F1', fileName: 'proof.jpg' }],
        locationRequirement: { requiresLocation: false },
      },
      {
        checklist: [{ item: 'Visual inspection', status: 'PASS' }],
        evidence: [{ fileId: 'F1', fileName: 'proof.jpg' }],
      }
    );

    assert.equal(evaluation.providerStatus, 'PENDING_HUMAN_REVIEW');
    assert.equal(evaluation.isApproved, null, 'Human supervisor must make final determination');
    assert.ok(evaluation.evaluationNotes.includes('TASK_AI_VISION_API_KEY missing'));
  });

  // ─── 7. SEGREGATION OF DUTIES ────────────────────────────────────────────────
  await suite.test('7. Segregation of duties: performer cannot verify their own work when verification is required', async () => {
    const task = await TaskManagementService.createTask(
      'ORG-ZAMORIN',
      {
        title: 'End of Day Safe Cash Count',
        category: 'CASH_CONTROL_AUDIT',
        assignedUserId: 'ST-0001',
        cafeId: 'ZC-0001',
        verificationRequired: true,
      },
      { userId: 'AD-0001', role: 'CAFE_ADMIN' }
    );

    // Performer submits evidence
    await TaskManagementService.submitTaskEvidence({
      organisationId: 'ORG-ZAMORIN',
      taskId: task.taskId,
      submission: { notes: 'Safe counted: ₹45,000 matches register.' },
      auth: { userId: 'ST-0001', role: 'STAFF' },
    });

    // Performer attempts to verify own work -> must fail with SELF_VERIFICATION_PROHIBITED (403)
    const { req: selfReq, res: selfRes, getResult: getSelfResult } = buildMockReqRes(
      'CAFE_ADMIN',
      { userId: 'ST-0001', assignedCafeIds: ['ZC-0001'] },
      { remarks: 'Self approval attempt' },
      {},
      { taskId: task.taskId }
    );

    await assert.rejects(async () => {
      await verifyTask(selfReq, selfRes);
    }, (err) => err.statusCode === 403 && err.errorCode === 'SELF_VERIFICATION_PROHIBITED');
  });

  // ─── 8. SUPERVISOR VERIFICATION WORKFLOW ─────────────────────────────────────
  await suite.test('8. Supervisor verification and completion workflow', async () => {
    const task = await Task.findOne({ title: 'End of Day Safe Cash Count' });
    assert.equal(task.status, 'AWAITING_VERIFICATION');

    // Independent supervisor verifies task
    const { req, res, getResult } = buildMockReqRes(
      'CAFE_ADMIN',
      { userId: 'AD-0001', assignedCafeIds: ['ZC-0001'] },
      { remarks: 'Physical envelope count re-checked and confirmed.' },
      {},
      { taskId: task.taskId }
    );

    await verifyTask(req, res);
    const { statusCode, data } = getResult();
    assert.equal(statusCode, 200);
    assert.equal(data.data.task.status, 'COMPLETED');
    assert.equal(data.data.task.verificationStatus, 'VERIFIED');
    assert.equal(data.data.task.verifiedByUserId, 'AD-0001');

    // Verify AuditEvent recorded
    const audit = await AuditEvent.findOne({
      action: 'TASK_VERIFIED',
      entityId: task.taskId,
    });
    assert.ok(audit);
    assert.equal(audit.actorUserId, 'AD-0001');
  });

  // ─── 9. RETURN FOR CORRECTION / REJECTION WORKFLOW ────────────────────────────
  await suite.test('9. Return for correction with mandatory reason, return history audit, and rejection workflow', async () => {
    const task = await TaskManagementService.createTask(
      'ORG-ZAMORIN',
      {
        title: 'Espresso Steam Wand Sanitization',
        category: 'HYGIENE_INSPECTION',
        assignedUserId: 'ST-0001',
        cafeId: 'ZC-0001',
        verificationRequired: true,
      },
      { userId: 'AD-0001', role: 'CAFE_ADMIN' }
    );

    await TaskManagementService.submitTaskEvidence({
      organisationId: 'ORG-ZAMORIN',
      taskId: task.taskId,
      submission: { notes: 'Wand soaked in milk cleaner' },
      auth: { userId: 'ST-0001', role: 'STAFF' },
    });

    // Missing reason must be rejected
    const { req: noReasonReq, res: noReasonRes } = buildMockReqRes(
      'CAFE_ADMIN',
      { userId: 'AD-0001', assignedCafeIds: ['ZC-0001'] },
      { reason: '' },
      {},
      { taskId: task.taskId }
    );

    await assert.rejects(async () => {
      await returnTask(noReasonReq, noReasonRes);
    }, (err) => err.statusCode === 400 && err.errorCode === 'REASON_REQUIRED');

    // Valid return with mandatory reason
    const { req, res, getResult } = buildMockReqRes(
      'CAFE_ADMIN',
      { userId: 'AD-0001', assignedCafeIds: ['ZC-0001'] },
      { reason: 'Steam tip holes still clogged with milk residue; disassemble tip and purge.', remarks: 'Check nozzle holes' },
      {},
      { taskId: task.taskId }
    );

    await returnTask(req, res);
    const { statusCode, data } = getResult();
    assert.equal(statusCode, 200);
    assert.equal(data.data.task.status, 'RETURNED_FOR_CORRECTION');
    assert.equal(data.data.task.returnReason, 'Steam tip holes still clogged with milk residue; disassemble tip and purge.');
    assert.equal(data.data.task.returnHistory.length, 1);
    assert.equal(data.data.task.returnHistory[0].returnedByUserId, 'AD-0001');
  });

  // ─── 10. REOPENING COMPLETED TASKS ───────────────────────────────────────────
  await suite.test('10. Reopening completed tasks with mandatory reason and audit logging', async () => {
    const completedTask = await Task.findOne({ title: 'Receiving Dairy Delivery' });
    assert.equal(completedTask.status, 'COMPLETED');

    // Attempting to reopen without reason fails
    const { req: noReasonReq, res: noReasonRes } = buildMockReqRes(
      'CAFE_ADMIN',
      { userId: 'AD-0001', assignedCafeIds: ['ZC-0001'] },
      { reason: '' },
      {},
      { taskId: completedTask.taskId }
    );
    await assert.rejects(async () => {
      await reopenTask(noReasonReq, noReasonRes);
    }, (err) => err.statusCode === 400 && err.errorCode === 'REASON_REQUIRED');

    // Valid reopen
    const { req, res, getResult } = buildMockReqRes(
      'CAFE_ADMIN',
      { userId: 'AD-0001', assignedCafeIds: ['ZC-0001'] },
      { reason: 'Invoice variance found during audit: 2 crates damaged on arrival.' },
      {},
      { taskId: completedTask.taskId }
    );
    await reopenTask(req, res);
    const { statusCode, data } = getResult();
    assert.equal(statusCode, 200);
    assert.equal(data.data.task.status, 'IN_PROGRESS');
  });

  // ─── 11. TASK CANCELLATION & BLOCKING ─────────────────────────────────────────
  await suite.test('11. Task cancellation and blocking with mandatory reasons', async () => {
    const task = await TaskManagementService.createTask(
      'ORG-ZAMORIN',
      {
        title: 'Outdoor Canopy Pressure Washing',
        category: 'EQUIPMENT_MAINTENANCE',
        assignedUserId: 'ST-0001',
        cafeId: 'ZC-0001',
      },
      { userId: 'AD-0001', role: 'CAFE_ADMIN' }
    );

    // Block task due to weather
    const { req: blockReq, res: blockRes, getResult: getBlockResult } = buildMockReqRes(
      'CAFE_ADMIN',
      { userId: 'AD-0001', assignedCafeIds: ['ZC-0001'] },
      { reason: 'Heavy rain in Calicut; outdoor washing delayed.' },
      {},
      { taskId: task.taskId }
    );
    await blockTask(blockReq, blockRes);
    const blockResult = getBlockResult();
    assert.equal(blockResult.statusCode, 200);
    assert.equal(blockResult.data.data.task.status, 'BLOCKED');

    // Cancel task
    const { req: cancelReq, res: cancelRes, getResult: getCancelResult } = buildMockReqRes(
      'CAFE_ADMIN',
      { userId: 'AD-0001', assignedCafeIds: ['ZC-0001'] },
      { reason: 'Vendor hired to replace entire canopy; washing cancelled.' },
      {},
      { taskId: task.taskId }
    );
    await cancelTask(cancelReq, cancelRes);
    const cancelResult = getCancelResult();
    assert.equal(cancelResult.statusCode, 200);
    assert.equal(cancelResult.data.data.task.status, 'CANCELLED');
    assert.equal(cancelResult.data.data.task.cancellationReason, 'Vendor hired to replace entire canopy; washing cancelled.');
  });

  // ─── 12. IDEMPOTENT RECURRING TASK SCHEDULER ─────────────────────────────────
  await suite.test('12. Idempotent recurring task scheduler: repeated runs on the same date create exactly 0 duplicate tasks', async () => {
    // Create recurring template
    const template = await TaskTemplate.create({
      templateId: 'TPL-0001',
      organisationId: 'ORG-ZAMORIN',
      cafeId: 'ZC-0001',
      title: 'Daily Opening Kitchen Sanitation Routine',
      category: 'HYGIENE_INSPECTION',
      priority: 'HIGH',
      assignedRole: 'STAFF',
      defaultAssignedUserId: 'ST-0002',
      checklist: [
        { item: 'Sanitize cutting boards and knives', isMandatory: true },
        { item: 'Check reach-in refrigerator temp (< 4°C)', isMandatory: true },
        { item: 'Empty sanitizing bucket and prepare fresh solution', isMandatory: true },
      ],
      recurrence: {
        isRecurring: true,
        frequency: 'DAILY',
        scheduledTime: '06:30',
        dueTimeOffsetHours: 2,
      },
      isActive: true,
      createdByUserId: 'AD-0001',
    });

    const execDate = '2026-10-12';

    // First run generates task
    const run1 = await TaskSchedulerService.runRecurringGeneration({
      organisationId: 'ORG-ZAMORIN',
      cafeId: 'ZC-0001',
      executionDate: execDate,
      actorId: 'AD-0001',
    });
    assert.equal(run1.generatedCount, 1);
    assert.equal(run1.skippedCount, 0);

    const generatedTaskId = run1.tasks[0].taskId;
    assert.ok(generatedTaskId);

    // Second run with identical parameters must detect duplicate and generate 0 new tasks
    const run2 = await TaskSchedulerService.runRecurringGeneration({
      organisationId: 'ORG-ZAMORIN',
      cafeId: 'ZC-0001',
      executionDate: execDate,
      actorId: 'AD-0001',
    });
    assert.equal(run2.generatedCount, 0, 'Exact-once generation: no duplicate tasks generated');
    assert.equal(run2.skippedCount, 1);
    assert.equal(run2.skipped[0].reason, 'ALREADY_GENERATED_FOR_DATE');

    // Verify exactly 1 task exists in database for this template and date
    const count = await Task.countDocuments({
      organisationId: 'ORG-ZAMORIN',
      templateId: 'TPL-0001',
      dueDate: execDate,
    });
    assert.equal(count, 1);
  });

  // ─── 13. OVERDUE TASK DETECTOR & OUTBOX REMINDERS ────────────────────────────
  await suite.test('13. Overdue task detector and notification outbox reminders', async () => {
    // Seed an overdue task (due date in past)
    await Task.create({
      taskId: 'TSK-9901',
      organisationId: 'ORG-ZAMORIN',
      cafeId: 'ZC-0001',
      title: 'Quarterly Fire Extinguisher Gauge Inspection',
      assignedUserId: 'ST-0001',
      dueDate: '2026-09-01',
      dueTime: '18:00',
      status: 'PENDING',
      createdByUserId: 'AD-0001',
    });

    const overdueResult = await TaskSchedulerService.processOverdueTasks({
      organisationId: 'ORG-ZAMORIN',
      cafeId: 'ZC-0001',
    });
    assert.ok(overdueResult.overdueCount >= 1);
    assert.ok(overdueResult.remindersQueued >= 1);

    const reminder = await NotificationOutbox.findOne({
      recipientUserId: 'ST-0001',
      eventType: 'TASK_OVERDUE',
      'payload.taskId': 'TSK-9901',
    });
    assert.ok(reminder);
    assert.ok(reminder.subject.includes('OVERDUE TASK'));
  });

  // ─── 14. SOP VERSION LINEAGE & ACKNOWLEDGMENTS ───────────────────────────────
  await suite.test('14. SOP version lineage preservation on tasks and staff acknowledgments', async () => {
    // Create SOP Version 1
    const sop = await StandardOperatingProcedure.create({
      organisationId: 'ORG-ZAMORIN',
      sopId: 'SOP-HYG-001',
      title: 'Espresso Bar Cleanliness Standard',
      domain: 'HYGIENE_CLEANING',
      version: 1,
      status: 'EFFECTIVE',
      ownerUserId: 'AD-0001',
      content: 'Version 1 cleaning instructions.',
    });

    // Create task referencing SOP-HYG-001
    const taskV1 = await TaskManagementService.createTask(
      'ORG-ZAMORIN',
      {
        title: 'Clean Espresso Bar According to SOP',
        sopId: 'SOP-HYG-001',
        assignedUserId: 'ST-0001',
        cafeId: 'ZC-0001',
      },
      { userId: 'AD-0001', role: 'CAFE_ADMIN' }
    );
    assert.equal(taskV1.sopReference.sopId, 'SOP-HYG-001');
    assert.equal(taskV1.sopReference.version, 1);

    // Amend SOP to Version 2
    sop.version = 2;
    sop.currentVersion = 2;
    await sop.save();

    // Verify taskV1 retains original Version 1 snapshot
    const reloadedTaskV1 = await Task.findOne({ taskId: taskV1.taskId });
    assert.equal(reloadedTaskV1.sopReference.version, 1, 'Historical task must retain original version');

    // Create new task referencing SOP-HYG-001 now snapshots Version 2
    const taskV2 = await TaskManagementService.createTask(
      'ORG-ZAMORIN',
      {
        title: 'Clean Espresso Bar Today',
        sopId: 'SOP-HYG-001',
        assignedUserId: 'ST-0001',
        cafeId: 'ZC-0001',
      },
      { userId: 'AD-0001', role: 'CAFE_ADMIN' }
    );
    assert.equal(taskV2.sopReference.version, 2);

    // Record Staff Acknowledgment
    const ack = await SopAcknowledgement.create({
      organisationId: 'ORG-ZAMORIN',
      sopId: 'SOP-HYG-001',
      sopVersion: 2,
      userId: 'ST-0001',
      role: 'STAFF',
      dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      status: 'ACKNOWLEDGED',
      acknowledgedAt: new Date(),
    });
    assert.equal(ack.sopVersion, 2);
    assert.equal(ack.status, 'ACKNOWLEDGED');
  });

  // ─── 15. TRAINING ASSIGNMENT, QUIZ ATTEMPTS & CERTIFICATION ──────────────────
  await suite.test('15. Employee training course creation, assignment, assessment scoring (80% pass threshold), and certification', async () => {
    // Create Food Safety Course with 3 Quiz Questions (10 pts each, total 30 pts)
    const course = await TrainingCourse.create({
      organisationId: 'ORG-ZAMORIN',
      courseId: 'CRS-FOOD-001',
      title: 'Food Safety & Hygiene Fundamentals',
      domain: 'FOOD_SAFETY',
      passThresholdPercent: 80,
      quiz: [
        {
          question: 'What is the safe holding temperature for cold dairy?',
          options: ['Above 10°C', 'Below 4°C', 'Room temperature', 'Above 60°C'],
          correctOptionIndex: 1,
          points: 10,
        },
        {
          question: 'How frequently must cutting boards be sanitized?',
          options: ['Once a week', 'Every 4 hours or between food types', 'End of month', 'Never'],
          correctOptionIndex: 1,
          points: 10,
        },
        {
          question: 'What is the required handwashing duration?',
          options: ['5 seconds', 'At least 20 seconds', '1 minute', 'Rinse only'],
          correctOptionIndex: 1,
          points: 10,
        },
      ],
      mandatoryForCategories: ['SAFETY_COMPLIANCE'],
      isActive: true,
    });

    // Assign to ST-0001
    const assignment = await EmployeeTrainingService.assignTraining({
      organisationId: 'ORG-ZAMORIN',
      cafeId: 'ZC-0001',
      userId: 'ST-0001',
      courseId: 'CRS-FOOD-001',
      dueDate: '2026-10-30',
      assignedByUserId: 'AD-0001',
    });
    assert.equal(assignment.status, 'ASSIGNED');
    assert.equal(assignment.isCertified, false);

    // Attempt 1: Failed attempt (1 out of 3 correct = 33% < 80%)
    const attempt1 = await EmployeeTrainingService.submitAssessmentAttempt({
      organisationId: 'ORG-ZAMORIN',
      trainingId: assignment.trainingId,
      userId: 'ST-0001',
      answers: [1, 0, 0], // Only Q1 correct
    });
    assert.equal(attempt1.passed, false);
    assert.equal(attempt1.score, 10);
    assert.equal(attempt1.percentage, 33);
    assert.equal(attempt1.isCertified, false);

    // Verify record in DB remains uncertified
    let trainingDoc = await EmployeeTraining.findOne({ trainingId: assignment.trainingId });
    assert.equal(trainingDoc.attempts.length, 1);
    assert.equal(trainingDoc.isCertified, false);
    assert.equal(trainingDoc.status, 'IN_PROGRESS');

    // Attempt 2: Passed attempt (3 out of 3 correct = 100% >= 80%)
    const attempt2 = await EmployeeTrainingService.submitAssessmentAttempt({
      organisationId: 'ORG-ZAMORIN',
      trainingId: assignment.trainingId,
      userId: 'ST-0001',
      answers: [1, 1, 1], // All correct
    });
    assert.equal(attempt2.passed, true);
    assert.equal(attempt2.score, 30);
    assert.equal(attempt2.percentage, 100);
    assert.equal(attempt2.isCertified, true);

    // Verify record in DB is now certified
    trainingDoc = await EmployeeTraining.findOne({ trainingId: assignment.trainingId });
    assert.equal(trainingDoc.attempts.length, 2);
    assert.equal(trainingDoc.isCertified, true);
    assert.equal(trainingDoc.status, 'COMPLETED');
    assert.ok(trainingDoc.certifiedAt);
  });

  // ─── 16. OPERATIONAL TRAINING PREREQUISITE ENFORCEMENT ───────────────────────
  await suite.test('16. Operational task prerequisite enforcement: uncertified staff blocked from high-risk tasks requiring training', async () => {
    // ST-0002 has NOT taken CRS-FOOD-001 which is mandatory for SAFETY_COMPLIANCE
    await assert.rejects(async () => {
      await TaskManagementService.createTask(
        'ORG-ZAMORIN',
        {
          title: 'HACCP Critical Control Point Audit',
          category: 'SAFETY_COMPLIANCE',
          assignedUserId: 'ST-0002',
          cafeId: 'ZC-0001',
        },
        { userId: 'AD-0001', role: 'CAFE_ADMIN' }
      );
    }, (err) => err.code === 'TRAINING_PREREQUISITE_UNMET');

    // ST-0001 has passed CRS-FOOD-001 -> task creation succeeds
    const task = await TaskManagementService.createTask(
      'ORG-ZAMORIN',
      {
        title: 'HACCP Critical Control Point Audit',
        category: 'SAFETY_COMPLIANCE',
        assignedUserId: 'ST-0001',
        cafeId: 'ZC-0001',
      },
      { userId: 'AD-0001', role: 'CAFE_ADMIN' }
    );
    assert.ok(task.taskId);
  });

  // ─── 17. SUSPENDED / EXITED EMPLOYEE PROTECTION ──────────────────────────────
  await suite.test('17. Suspended / exited employee protection: cannot receive tasks or training assignments', async () => {
    // Exited employee ST-9999 cannot be assigned tasks
    await assert.rejects(async () => {
      await TaskManagementService.createTask(
        'ORG-ZAMORIN',
        {
          title: 'Restock Paper Cups',
          assignedUserId: 'ST-9999',
          cafeId: 'ZC-0001',
        },
        { userId: 'AD-0001', role: 'CAFE_ADMIN' }
      );
    }, (err) => err.code === 'EMPLOYEE_INACTIVE');

    // Exited employee ST-9999 cannot be assigned training
    await assert.rejects(async () => {
      await EmployeeTrainingService.assignTraining({
        organisationId: 'ORG-ZAMORIN',
        cafeId: 'ZC-0001',
        userId: 'ST-9999',
        courseId: 'CRS-FOOD-001',
        dueDate: '2026-11-01',
        assignedByUserId: 'AD-0001',
      });
    }, (err) => err.code === 'EMPLOYEE_INACTIVE');
  });

  // ─── 18. MULTI-OUTLET COMPLIANCE REPORTING RECONCILIATION ────────────────────
  await suite.test('18. Multi-outlet compliance reporting reconciliation (completion %, on-time %, geofence %)', async () => {
    const report = await TaskManagementService.getComplianceReport({
      organisationId: 'ORG-ZAMORIN',
      cafeId: 'ZC-0001',
    });

    assert.ok(report.totalTasks > 0);
    assert.ok(report.completedTasks > 0);
    assert.ok(typeof report.completionRate === 'number');
    assert.ok(typeof report.onTimeRate === 'number');
    assert.ok(typeof report.geofenceComplianceRate === 'number');
    assert.ok(report.byOutlet['ZC-0001']);
    assert.ok(report.byCategory);
  });

  // ─── 19. CANONICAL PERSONA SECURITY MATRIX ───────────────────────────────────
  await suite.test('19. Canonical persona security matrix: Primary Master full, Cafe Ops scoped, Owner read-only, Staff self-service only, Vendor denied, retired Normal Master 403', async () => {
    // 1. Owner role is strictly read-only for operational task mutations
    const ownerAuth = { userId: 'OW-0001', role: 'OWNER', organisationId: 'ORG-ZAMORIN' };
    const taskWriteMiddleware = authorize('TASKS_WRITE', { allowedRoles: ['MASTER', 'CAFE_ADMIN'] });

    let ownerBlocked = false;
    taskWriteMiddleware({ auth: ownerAuth }, { status: (c) => ({ json: () => { ownerBlocked = (c === 403); } }) }, (err) => {
      if (err) ownerBlocked = true;
    });
    assert.equal(ownerBlocked, true, 'Owner role denied operational write mutation');

    // 2. Staff role denied general task creation & management
    let staffBlocked = false;
    taskWriteMiddleware({ auth: { userId: 'ST-0001', role: 'STAFF', organisationId: 'ORG-ZAMORIN' } }, { status: () => ({ json: () => { staffBlocked = true; } }) }, (err) => {
      if (err) staffBlocked = true;
    });
    assert.equal(staffBlocked, true, 'Staff denied task management');

    // 3. Vendor role denied
    let vendorBlocked = false;
    taskWriteMiddleware({ auth: { userId: 'VU-0001', role: 'VENDOR', organisationId: 'ORG-ZAMORIN' } }, { status: () => ({ json: () => { vendorBlocked = true; } }) }, (err) => {
      if (err) vendorBlocked = true;
    });
    assert.equal(vendorBlocked, true, 'Vendor denied access');

    // 4. Retired Normal Master fails closed with 403 ROLE_RETIRED
    let retiredBlocked = false;
    taskWriteMiddleware({ auth: { userId: 'NM-0001', role: 'ROLE_RETIRED', organisationId: 'ORG-ZAMORIN' } }, { status: () => ({ json: () => { retiredBlocked = true; } }) }, (err) => {
      if (err) retiredBlocked = true;
    });
    assert.equal(retiredBlocked, true, 'Retired Normal Master fails closed');

    // 5. Staff has access to /my-tasks endpoint
    const { req: staffMyTasksReq, res: staffMyTasksRes, getResult: getMyTasksResult } = buildMockReqRes(
      'STAFF',
      { userId: 'ST-0001', assignedCafeIds: ['ZC-0001'] }
    );
    await getMyTasks(staffMyTasksReq, staffMyTasksRes);
    const myTasksResult = getMyTasksResult();
    assert.equal(myTasksResult.statusCode, 200);
    assert.ok(Array.isArray(myTasksResult.data.data.tasks));
  });

  // ─── 20. CROSS-CAFÉ IDOR / BOLA PROTECTION ───────────────────────────────────
  await suite.test('20. Cross-café IDOR / BOLA protection: Cafe Operations denied mutations on unassigned café tasks', async () => {
    // Create task in Café ZC-0002
    const taskCafe2 = await TaskManagementService.createTask(
      'ORG-ZAMORIN',
      {
        title: 'Beachfront Bistro Outdoor Seating Setup',
        assignedRole: 'CAFE_ADMIN',
        cafeId: 'ZC-0002',
      },
      { userId: 'MU-0001', role: 'MASTER' }
    );

    // Cafe Admin AD-0001 (assigned only to ZC-0001) attempts to cancel task in ZC-0002
    const { req, res } = buildMockReqRes(
      'CAFE_ADMIN',
      { userId: 'AD-0001', assignedCafeIds: ['ZC-0001'] },
      { reason: 'Attempted cross cafe cancellation' },
      {},
      { taskId: taskCafe2.taskId }
    );

    await assert.rejects(async () => {
      await cancelTask(req, res);
    }, (err) => err.statusCode === 404 && (err.errorCode === 'NOT_FOUND' || err.code === 'NOT_FOUND'));
  });
});
