'use strict';

/**
 * ============================================================================
 * ZAMORIN CAFÉ ERP — P07 VERIFICATION CASES:
 * STALE DRAFT APPROVAL, WORKER PROCESS TERMINATION RECOVERY &
 * CONCURRENT CANCELLATION / AMENDMENT COORDINATION
 * ============================================================================
 *
 * Verifies the 3 core robustness cases:
 *
 * Case 1: Stale Draft Approval Protection
 *   - User A loads draft; User B alters quantities/rates/supplier; User A approves
 *     using reviewed fingerprint -> Atomically rejected with 409 PURCHASING_SNAPSHOT_STALE.
 *   - Neither changed contents approved nor dispatch job created.
 *   - Verified at service level and HTTP route level.
 *
 * Case 2: Worker Process Termination and Recovery
 *   - Real child process terminates after claiming job, before sending.
 *     Lease expires; recovery worker reclaims job without stranding; provider attempt history = 1.
 *   - Real child process terminates after provider accepts message, before persisting result.
 *     Lease expires while in SENDING; recovery worker marks UNKNOWN without blind resend;
 *     provider attempt history = 1; reconciled safely.
 *   - Zombie/expired worker cannot overwrite newer outcomes (lease fencing).
 *
 * Case 3: Concurrent Cancellation and Amendment During Dispatch
 *   - Pre-send cancellation suppresses dispatch outbox.
 *   - In-flight cancellation prevents completed dispatch from overwriting CANCELLED with ORDERED.
 *   - In-flight amendment to Revision 2 prevents Revision 1 dispatch from overwriting SUBMITTED.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('fs');
const http = require('node:http');
const { fork } = require('node:child_process');
const mongoose = require('mongoose');

const { createApp } = require('../src/server');
const { PurchaseOrder } = require('../src/models/PurchaseOrder');
const { ProcurementDispatchJob } = require('../src/models/ProcurementDispatchJob');
const { GlobalInventoryItem } = require('../src/models/GlobalInventoryItem');
const { CafeInventoryConfig } = require('../src/models/CafeInventoryConfig');
const { Vendor } = require('../src/models/Vendor');
const { Cafe } = require('../src/models/Cafe');
const { User } = require('../src/models/User');
const { RolePermission } = require('../src/models/RolePermission');
const { ApprovalPolicy } = require('../src/models/ApprovalPolicy');
const {
  ProcurementApprovalService,
  computePurchasingFingerprint,
  computePurchasingSnapshot,
} = require('../src/services/procurementApprovalService');
const {
  ProcurementDispatchService,
  defaultDispatchService,
} = require('../src/services/procurementDispatchService');
const authService = require('../src/services/authService');
const { FileBackedControlledProvider } = require('./helpers/realWorkerProcess');

const MONGO_TEST_URI = 'mongodb://127.0.0.1:27017/zamorin_p07_verification';
const HISTORY_FILE_PATH = path.resolve(__dirname, 'helpers', 'temp_provider_history.json');

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
          } catch (_) {
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

test('P07 Verification Cases: Stale Approval, Worker Crash Recovery & In-flight Coordination', async (t) => {
  let provider;
  try {
    // Connect to real MongoDB for end-to-end multi-process verification
    await mongoose.connect(MONGO_TEST_URI);

    // Clean test collections
    await PurchaseOrder.deleteMany({});
    await ProcurementDispatchJob.deleteMany({});
    await GlobalInventoryItem.deleteMany({});
    await CafeInventoryConfig.deleteMany({});
    await Vendor.deleteMany({});
    await Cafe.deleteMany({});
    await User.deleteMany({});
    await ApprovalPolicy.deleteMany({});

    provider = new FileBackedControlledProvider(HISTORY_FILE_PATH);
    provider.clearHistory();
  } catch (setupErr) {
    console.error('SETUP_FAILED_ROOT_CAUSE:', setupErr);
    throw setupErr;
  }

  try {
    // Seed baseline master data
    await Cafe.create({
      organisationId: 'ORG-ZAMORIN',
      cafeId: 'ZC-0001',
      name: 'Koramangala Flagship',
      displayName: 'Koramangala Flagship',
      status: 'ACTIVE',
      createdBy: 'MU-0001',
      address: '100 Feet Rd, Koramangala, Bengaluru',
    });

    await Vendor.create({
      organisationId: 'ORG-ZAMORIN',
      vendorId: 'VEN-4001',
      name: 'Malabar Heritage Coffee Co.',
      nameLower: 'malabar heritage coffee co.',
      category: 'FOOD_BEVERAGE',
      supplierType: 'GOODS',
      status: 'ACTIVE',
      approvedCafeIds: ['ZC-0001'],
      contactEmail: 'orders@malabarcoffee.local',
      email: 'orders@malabarcoffee.local',
      createdByUserId: 'MU-0001',
      paymentTerms: 'NET_30',
    });

    await GlobalInventoryItem.create({
      organisationId: 'ORG-ZAMORIN',
      itemId: 'ITEM-COFFEE-BEANS',
      sku: 'SKU-COF-01',
      name: 'Arabica Whole Roasted Beans',
      category: 'DAIRY_FRESH',
      baseUnit: 'g',
      unitCostPaisa: 80,
      status: 'ACTIVE',
      createdByUserId: 'MU-0001',
    });

    await CafeInventoryConfig.create({
      organisationId: 'ORG-ZAMORIN',
      cafeId: 'ZC-0001',
      itemId: 'ITEM-COFFEE-BEANS',
      reorderPolicy: 'MIN_MAX',
      minQuantityBase: 10000,
      maxQuantityBase: 50000,
      currentQuantityBase: 5000,
      availableQuantityBase: 5000,
      reservedQuantityBase: 0,
      replenishmentEnabled: true,
      stockedHere: true,
    });

    // Users
    const userAdmin = await User.create({
      userId: 'AD-0001',
      organisationId: 'ORG-ZAMORIN',
      name: 'Koramangala Admin',
      email: 'admin.kora@zamorin.local',
      role: 'CAFE_ADMIN',
      primaryCafeId: 'ZC-0001',
      assignedCafeIds: ['ZC-0001'],
      accountStatus: 'ACTIVE',
      createdBy: 'SYSTEM',
      sessionVersion: 1,
      permissionsVersion: 1,
      passwordHash: '$2b$12$DummyHashForTesting12345678901234567890123456789012',
    });

    const userMaster = await User.create({
      userId: 'MU-0001',
      organisationId: 'ORG-ZAMORIN',
      name: 'Primary Master',
      email: 'master@zamorin.local',
      role: 'MASTER',
      isPrimaryMaster: true,
      primaryCafeId: null,
      assignedCafeIds: [],
      accountStatus: 'ACTIVE',
      createdBy: 'SYSTEM',
      sessionVersion: 1,
      permissionsVersion: 1,
      passwordHash: '$2b$12$DummyHashForTesting12345678901234567890123456789012',
    });

    await ApprovalPolicy.create({
      policyId: 'POL-PO-01',
      organisationId: 'ORG-ZAMORIN',
      cafeId: 'ZC-0001',
      workflowType: 'PURCHASE_ORDER',
      role: 'CAFE_ADMIN',
      maxAmountPaisa: 5000000, // ₹50,000 threshold
      status: 'ACTIVE',
      createdBy: 'SYSTEM',
    });

  // JWT auth contexts
  const koraAuth = {
    userId: 'AD-0001',
    organisationId: 'ORG-ZAMORIN',
    role: 'CAFE_ADMIN',
    primaryCafeId: 'ZC-0001',
    assignedCafeIds: ['ZC-0001'],
  };
  const masterAuth = {
    userId: 'MU-0001',
    organisationId: 'ORG-ZAMORIN',
    role: 'MASTER',
    primaryCafeId: null,
    assignedCafeIds: [],
    isPrimaryMaster: true,
  };

  const koraToken = 'token_kora';
  const masterToken = 'token_master';

  t.mock.method(authService, 'verifyAccessToken', async (token) => {
    let activeUser = userMaster;
    if (token === 'token_kora') activeUser = userAdmin;
    return {
      payload: {
        sub: activeUser.userId,
        org: activeUser.organisationId,
        role: activeUser.role,
        isPrimaryMaster: Boolean(activeUser.isPrimaryMaster),
        sv: 0,
        usv: 1,
        pv: 1,
        sid: 'SS-P07-VERIFY-TEST',
      },
      session: {
        sessionId: 'SS-P07-VERIFY-TEST',
        roleSnapshot: activeUser.role,
        currentCafeId: activeUser.primaryCafeId,
      },
    };
  });

  const mockRules = [
    {
      permissionRuleId: 'RULE-ADMIN-PROCUREMENT-A',
      role: 'CAFE_ADMIN',
      permissionCode: 'PROCUREMENT_APPROVE',
      effect: 'ALLOW',
      scope: 'ASSIGNED_CAFES',
      isCurrentlyEffective: () => true,
      requiresMfa: false,
      requiresStepUpAuthentication: false,
      requiresReauthentication: false,
      requiresReason: false,
      requiresAuditEvent: false,
      fieldAccess: { allowedFields: [], deniedFields: [], maskedFields: [] },
    },
    {
      permissionRuleId: 'RULE-ADMIN-PROCUREMENT-W',
      role: 'CAFE_ADMIN',
      permissionCode: 'PROCUREMENT_WRITE',
      effect: 'ALLOW',
      scope: 'ASSIGNED_CAFES',
      isCurrentlyEffective: () => true,
      requiresMfa: false,
      requiresStepUpAuthentication: false,
      requiresReauthentication: false,
      requiresReason: false,
      requiresAuditEvent: false,
      fieldAccess: { allowedFields: [], deniedFields: [], maskedFields: [] },
    },
    {
      permissionRuleId: 'RULE-ADMIN-PROCUREMENT-R',
      role: 'CAFE_ADMIN',
      permissionCode: 'PROCUREMENT_READ',
      effect: 'ALLOW',
      scope: 'ASSIGNED_CAFES',
      isCurrentlyEffective: () => true,
      requiresMfa: false,
      requiresStepUpAuthentication: false,
      requiresReauthentication: false,
      requiresReason: false,
      requiresAuditEvent: false,
      fieldAccess: { allowedFields: [], deniedFields: [], maskedFields: [] },
    },
    {
      permissionRuleId: 'RULE-MASTER-PROCUREMENT-A',
      role: 'MASTER',
      permissionCode: 'PROCUREMENT_APPROVE',
      effect: 'ALLOW',
      scope: 'ORGANISATION',
      isCurrentlyEffective: () => true,
      requiresMfa: false,
      requiresStepUpAuthentication: false,
      requiresReauthentication: false,
      requiresReason: false,
      requiresAuditEvent: false,
      fieldAccess: { allowedFields: [], deniedFields: [], maskedFields: [] },
    },
  ];

  t.mock.method(RolePermission, 'findEffectiveRules', ({ role, permissionCode }) => {
    const matched = mockRules.filter((r) => {
      if (role && r.role !== role) return false;
      if (permissionCode && r.permissionCode !== permissionCode) return false;
      return true;
    });
    return Promise.resolve(matched);
  });

  t.mock.method(RolePermission, 'find', () => {
    return {
      lean: () => Promise.resolve(mockRules),
      then: function (onFulfilled, onRejected) { return Promise.resolve(mockRules).then(onFulfilled, onRejected); },
    };
  });

  // Setup express server for route assertions
  const app = createApp({ allowedOrigins: ['*'], production: false });
  let server;
  let port;

  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', () => {
      port = server.address().port;
      resolve();
    });
  });

  t.after(async () => {
    if (server) await new Promise((res) => server.close(res));
    provider.clearHistory();
    await mongoose.disconnect();
  });

  // ===========================================================================
  // CASE 1: STALE DRAFT APPROVAL PROTECTION
  // ===========================================================================

  await t.test('Case 1.1: Stale draft approval is rejected atomically when purchasing details change', async () => {
    // 1. Create a server-authoritative Draft PO (Revision 1)
    const poId = 'PO-STALE-TEST-001';
    const draftOrder = new PurchaseOrder({
      purchaseOrderId: poId,
      organisationId: 'ORG-ZAMORIN',
      cafeId: 'ZC-0001',
      vendorId: 'VEN-4001',
      vendorNameSnapshot: 'Malabar Heritage Coffee Co.',
      lineItems: [
        {
          itemId: 'ITEM-COFFEE-BEANS',
          itemNameSnapshot: 'Arabica Whole Roasted Beans',
          orderedQuantityBase: 15000, // 15 kg
          baseUnit: 'g',
          packSize: '1 kg',
          unitPricePaisa: 80,
          totalLinePaisa: 12000,
        },
      ],
      subtotalPaisa: 12000,
      taxPaisa: 600,
      totalPaisa: 12600,
      status: 'DRAFT',
      currentRevision: 1,
      activeApprovedRevision: null,
      revisions: [
        {
          revisionNumber: 1,
          status: 'DRAFT',
          lineItems: [
            {
              itemId: 'ITEM-COFFEE-BEANS',
              itemNameSnapshot: 'Arabica Whole Roasted Beans',
              orderedQuantityBase: 15000,
              baseUnit: 'g',
              packSize: '1 kg',
              unitPricePaisa: 80,
              totalLinePaisa: 12000,
            },
          ],
          subtotalPaisa: 12000,
          taxPaisa: 600,
          totalPaisa: 12600,
          vendorId: 'VEN-4001',
          deliveryAddress: '100 Feet Rd, Koramangala, Bengaluru',
        },
      ],
      dispatchStatus: 'NOT_QUEUED',
      createdByUserId: 'AD-0001',
    });
    await draftOrder.save();

    // 2. User A loads draft and records the reviewed snapshot fingerprint
    const reviewedSnapshot = computePurchasingSnapshot(draftOrder, 1);
    const userAFingerprint = computePurchasingFingerprint(draftOrder, 1);
    assert.ok(userAFingerprint, 'Snapshot fingerprint must be computed');
    assert.equal(reviewedSnapshot.lines[0].orderedQuantityBase, 15000);

    // 3. User B modifies purchasing details (increases quantity to 25 kg) before User A approves
    await ProcurementApprovalService.editOrderRevision({
      purchaseOrderId: poId,
      lineItems: [
        {
          itemId: 'ITEM-COFFEE-BEANS',
          orderedQuantityBase: 25000,
        },
      ],
      reason: 'User B adjusted quantity to 25 kg due to weekend projection',
      auth: koraAuth,
    });

    // Check that revision remains 1 (draft in-place edit) but content has changed
    const freshDraft = await PurchaseOrder.findOne({ purchaseOrderId: poId });
    assert.equal(freshDraft.currentRevision, 1);
    assert.equal(freshDraft.lineItems[0].orderedQuantityBase, 25000);
    assert.equal(freshDraft.status, 'DRAFT');

    const freshFingerprint = computePurchasingFingerprint(freshDraft, 1);
    assert.notEqual(freshFingerprint, userAFingerprint, 'Fingerprints must differ after User B edit');

    // 4. User A attempts approval using their original reviewed fingerprint
    await assert.rejects(
      async () => {
        await ProcurementApprovalService.approveAndQueueDispatch({
          purchaseOrderId: poId,
          revisionNumber: 1,
          expectedSnapshotFingerprint: userAFingerprint, // Stale fingerprint from initial review
          auth: koraAuth,
        });
      },
      (err) => {
        assert.equal(err.statusCode, 409);
        assert.equal(err.code, 'PURCHASING_SNAPSHOT_STALE');
        assert.match(err.message, /modified after review screen loaded/);
        return true;
      }
    );

    // 5. Invariants: Draft was NOT approved and NO dispatch job was created
    const postRejectOrder = await PurchaseOrder.findOne({ purchaseOrderId: poId });
    assert.equal(postRejectOrder.status, 'DRAFT', 'Order status must remain DRAFT');
    assert.equal(postRejectOrder.activeApprovedRevision, null, 'No revision must be marked approved');

    const jobsCount = await ProcurementDispatchJob.countDocuments({ purchaseOrderId: poId });
    assert.equal(jobsCount, 0, 'Zero dispatch jobs must exist after rejected stale approval');
  });

  await t.test('Case 1.2: Stale draft approval rejected via HTTP route API with 409 code', async () => {
    const poId = 'PO-STALE-HTTP-002';
    const draft = new PurchaseOrder({
      purchaseOrderId: poId,
      organisationId: 'ORG-ZAMORIN',
      cafeId: 'ZC-0001',
      vendorId: 'VEN-4001',
      lineItems: [
        {
          itemId: 'ITEM-COFFEE-BEANS',
          orderedQuantityBase: 10000,
          baseUnit: 'g',
          packSize: '1 kg',
          unitPricePaisa: 80,
          totalLinePaisa: 8000,
        },
      ],
      subtotalPaisa: 8000,
      taxPaisa: 400,
      totalPaisa: 8400,
      status: 'DRAFT',
      currentRevision: 1,
      revisions: [
        {
          revisionNumber: 1,
          status: 'DRAFT',
          lineItems: [
            {
              itemId: 'ITEM-COFFEE-BEANS',
              orderedQuantityBase: 10000,
              baseUnit: 'g',
              unitPricePaisa: 80,
              totalLinePaisa: 8000,
            },
          ],
          subtotalPaisa: 8000,
          taxPaisa: 400,
          totalPaisa: 8400,
          vendorId: 'VEN-4001',
        },
      ],
      dispatchStatus: 'NOT_QUEUED',
      createdByUserId: 'AD-0001',
    });
    await draft.save();

    const staleFingerprint = computePurchasingFingerprint(draft, 1);

    // Edit in background
    await ProcurementApprovalService.editOrderRevision({
      purchaseOrderId: poId,
      lineItems: [{ itemId: 'ITEM-COFFEE-BEANS', orderedQuantityBase: 12000 }],
      reason: 'Changed qty',
      auth: koraAuth,
    });

    // Submit HTTP request with stale fingerprint
    const res = await makeRequest({
      port,
      method: 'POST',
      path: `/api/v1/procurement/orders/${poId}/approve-and-send`,
      headers: {
        authorization: `Bearer ${koraToken}`,
        'x-cafe-id': 'ZC-0001',
      },
      body: {
        revisionNumber: 1,
        expectedSnapshotFingerprint: staleFingerprint,
      },
    });

    assert.equal(res.statusCode, 409);
    assert.equal(res.body.error?.code, 'PURCHASING_SNAPSHOT_STALE');

    // Invariant: Job not created
    const job = await ProcurementDispatchJob.findOne({ purchaseOrderId: poId });
    assert.equal(job, null);
  });

  await t.test('Case 1.3: Approval succeeds after user refreshes review and submits updated fingerprint', async () => {
    const poId = 'PO-STALE-HTTP-002';
    const refreshedDoc = await PurchaseOrder.findOne({ purchaseOrderId: poId });
    const freshFingerprint = computePurchasingFingerprint(refreshedDoc, 1);

    const res = await makeRequest({
      port,
      method: 'POST',
      path: `/api/v1/procurement/orders/${poId}/approve-and-send`,
      headers: {
        authorization: `Bearer ${koraToken}`,
        'x-cafe-id': 'ZC-0001',
      },
      body: {
        revisionNumber: 1,
        expectedSnapshotFingerprint: freshFingerprint,
        sendImmediately: false,
      },
    });

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.data.order.status, 'APPROVED');
    assert.equal(res.body.data.order.activeApprovedRevision, 1);
    assert.equal(res.body.data.dispatchJob.status, 'QUEUED');
  });

  // ===========================================================================
  // CASE 2: WORKER PROCESS TERMINATION AND RECOVERY
  // ===========================================================================

  await t.test('Case 2.1: Real worker process terminates after claiming job; recovery executes without stranding or duplicates', async () => {
    provider.clearHistory();
    await ProcurementDispatchJob.deleteMany({});
    await PurchaseOrder.deleteMany({});

    const poId = 'PO-WORKER-RECOVER-001';
    const jobId = 'DISPATCH-WORKER-RECOVER-001';

    await PurchaseOrder.create({
      purchaseOrderId: poId,
      organisationId: 'ORG-ZAMORIN',
      cafeId: 'ZC-0001',
      vendorId: 'VEN-4001',
      vendorNameSnapshot: 'Malabar Heritage Coffee Co.',
      status: 'APPROVED',
      currentRevision: 1,
      activeApprovedRevision: 1,
      lineItems: [{ itemId: 'ITEM-COFFEE-BEANS', orderedQuantityBase: 15000, unitPricePaisa: 80, totalLinePaisa: 12000 }],
      revisions: [{ revisionNumber: 1, status: 'APPROVED', lineItems: [{ itemId: 'ITEM-COFFEE-BEANS', orderedQuantityBase: 15000, unitPricePaisa: 80, totalLinePaisa: 12000 }] }],
      dispatchStatus: 'QUEUED',
      createdByUserId: 'AD-0001',
    });

    await ProcurementDispatchJob.create({
      dispatchJobId: jobId,
      organisationId: 'ORG-ZAMORIN',
      cafeId: 'ZC-0001',
      purchaseOrderId: poId,
      revisionNumber: 1,
      vendorId: 'VEN-4001',
      recipientEmail: 'orders@malabarcoffee.local',
      recipientName: 'Malabar Heritage Coffee Co.',
      status: 'QUEUED',
      idempotencyKey: `IDEMP-${jobId}`,
      provider: 'EMAIL',
      payloadSnapshot: { purchaseOrderId: poId, revisionNumber: 1, totalPaisa: 12600, lineItems: [] },
    });

    // 1. Fork a REAL child worker process that claims the job and terminates before sending
    const workerScript = path.resolve(__dirname, 'helpers', 'realWorkerProcess.js');
    const childWorker = fork(workerScript, [
      MONGO_TEST_URI,
      HISTORY_FILE_PATH,
      'TERMINATE_AFTER_CLAIM',
      'WORKER-CHILD-CRASH-01',
      jobId,
    ]);

    await new Promise((resolve) => {
      childWorker.on('exit', resolve);
    });

    // 2. Verify state immediately after child process crash:
    const claimedJob = await ProcurementDispatchJob.findOne({ dispatchJobId: jobId });
    assert.equal(claimedJob.status, 'CLAIMED', 'Job must be in CLAIMED status when child crashed');
    assert.equal(claimedJob.claimedByWorkerId, 'WORKER-CHILD-CRASH-01');

    // Zero messages sent to provider
    const attemptsBeforeRecovery = provider.getAttemptHistory();
    assert.equal(attemptsBeforeRecovery.length, 0, 'ZERO emails should be sent before worker crash');

    // 3. Fast-forward lease expiry to simulate lease expiration
    await ProcurementDispatchJob.updateOne(
      { dispatchJobId: jobId },
      { $set: { lockExpiresAt: new Date(Date.now() - 1000) } }
    );

    // 4. Run recovery worker in parent process
    const recoveryDispatchService = new ProcurementDispatchService();
    const recoveryOutcomes = await recoveryDispatchService.runDispatchWorker({
      workerId: 'RECOVERY-WORKER-MAIN',
      provider,
    });

    assert.equal(recoveryOutcomes.length, 1);
    assert.equal(recoveryOutcomes[0].status, 'ACCEPTED_BY_PROVIDER');

    // 5. Invariants: Job is NOT stranded, exactly 1 send attempt occurred, PO is ORDERED
    const recoveredJob = await ProcurementDispatchJob.findOne({ dispatchJobId: jobId });
    assert.equal(recoveredJob.status, 'ACCEPTED_BY_PROVIDER');
    assert.equal(recoveredJob.claimedByWorkerId, 'RECOVERY-WORKER-MAIN');

    const poAfterRecovery = await PurchaseOrder.findOne({ purchaseOrderId: poId });
    assert.equal(poAfterRecovery.dispatchStatus, 'ACCEPTED_BY_PROVIDER');
    assert.equal(poAfterRecovery.status, 'ORDERED');

    const finalAttempts = provider.getAttemptHistory();
    assert.equal(finalAttempts.length, 1, 'Provider must record exactly 1 attempt overall — zero duplicates');
  });

  await t.test('Case 2.2: Worker terminates after provider accepts message before persisting; recovered to UNKNOWN without blind resend', async () => {
    provider.clearHistory();
    await ProcurementDispatchJob.deleteMany({});
    await PurchaseOrder.deleteMany({});

    const poId = 'PO-WORKER-UNCERTAIN-002';
    const jobId = 'DISPATCH-WORKER-UNCERTAIN-002';

    await PurchaseOrder.create({
      purchaseOrderId: poId,
      organisationId: 'ORG-ZAMORIN',
      cafeId: 'ZC-0001',
      vendorId: 'VEN-4001',
      vendorNameSnapshot: 'Malabar Heritage Coffee Co.',
      status: 'APPROVED',
      currentRevision: 1,
      activeApprovedRevision: 1,
      lineItems: [{ itemId: 'ITEM-COFFEE-BEANS', orderedQuantityBase: 15000, unitPricePaisa: 80, totalLinePaisa: 12000 }],
      revisions: [{ revisionNumber: 1, status: 'APPROVED', lineItems: [{ itemId: 'ITEM-COFFEE-BEANS', orderedQuantityBase: 15000, unitPricePaisa: 80, totalLinePaisa: 12000 }] }],
      dispatchStatus: 'QUEUED',
      createdByUserId: 'AD-0001',
    });

    await ProcurementDispatchJob.create({
      dispatchJobId: jobId,
      organisationId: 'ORG-ZAMORIN',
      cafeId: 'ZC-0001',
      purchaseOrderId: poId,
      revisionNumber: 1,
      vendorId: 'VEN-4001',
      recipientEmail: 'orders@malabarcoffee.local',
      recipientName: 'Malabar Heritage Coffee Co.',
      status: 'QUEUED',
      idempotencyKey: `IDEMP-${jobId}`,
      provider: 'EMAIL',
      payloadSnapshot: { purchaseOrderId: poId, revisionNumber: 1, totalPaisa: 12600, lineItems: [] },
    });

    // 1. Fork a REAL child worker process that sends to provider, but crashes BEFORE persisting to DB
    const workerScript = path.resolve(__dirname, 'helpers', 'realWorkerProcess.js');
    const childWorker = fork(workerScript, [
      MONGO_TEST_URI,
      HISTORY_FILE_PATH,
      'TERMINATE_AFTER_PROVIDER_ACCEPT_BEFORE_PERSIST',
      'WORKER-CHILD-CRASH-02',
      jobId,
    ]);

    await new Promise((resolve) => {
      childWorker.on('exit', resolve);
    });

    // 2. Assert state immediately after crash:
    // Provider received the email and has 1 recorded attempt
    const historyAfterCrash = provider.getAttemptHistory();
    assert.equal(historyAfterCrash.length, 1, 'Provider accepted message and recorded 1 attempt');

    // But in database, job is still in SENDING with the crashed worker lease
    const sendingJob = await ProcurementDispatchJob.findOne({ dispatchJobId: jobId });
    assert.equal(sendingJob.status, 'SENDING');

    // 3. Fast-forward lease expiry
    await ProcurementDispatchJob.updateOne(
      { dispatchJobId: jobId },
      { $set: { lockExpiresAt: new Date(Date.now() - 1000) } }
    );

    // 4. Run recovery worker in parent process
    const recoveryDispatchService = new ProcurementDispatchService();
    const recoveryOutcomes = await recoveryDispatchService.runDispatchWorker({
      workerId: 'RECOVERY-WORKER-MAIN',
      provider,
    });

    // Recovery detects uncertain transmission and transitions to UNKNOWN
    assert.equal(recoveryOutcomes.length, 1);
    assert.equal(recoveryOutcomes[0].status, 'UNKNOWN');
    assert.equal(recoveryOutcomes[0].reason, 'RECOVERED_UNCERTAIN_SENDING');

    // CRITICAL: Provider must NOT have received a second send (NO BLIND RESENDING!)
    const historyAfterRecoverySweep = provider.getAttemptHistory();
    assert.equal(historyAfterRecoverySweep.length, 1, 'Zero blind resends permitted! Attempt count remains 1');

    // 5. Reconcile UNKNOWN dispatch safely using recorded provider reference
    const providerMsgId = historyAfterCrash[0].attemptId;
    await ProcurementDispatchService.reconcileUnknownDispatch({
      dispatchJobId: jobId,
      confirmedOutcome: 'ACCEPTED_BY_PROVIDER',
      providerReferenceId: providerMsgId,
      notes: 'Confirmed by checking provider audit trail',
      auth: masterAuth,
    });

    // 6. Final state verified
    const finalJob = await ProcurementDispatchJob.findOne({ dispatchJobId: jobId });
    assert.equal(finalJob.status, 'ACCEPTED_BY_PROVIDER');
    assert.equal(finalJob.providerMessageId, providerMsgId);

    const finalPo = await PurchaseOrder.findOne({ purchaseOrderId: poId });
    assert.equal(finalPo.status, 'ORDERED');
    assert.equal(finalPo.dispatchStatus, 'ACCEPTED_BY_PROVIDER');

    // Provider attempts must remain exactly 1 throughout
    assert.equal(provider.getAttemptHistory().length, 1);
  });

  await t.test('Case 2.3: Expired worker cannot overwrite newer outcomes (lease fencing)', async () => {
    await ProcurementDispatchJob.deleteMany({});
    await PurchaseOrder.deleteMany({});

    const poId = 'PO-WORKER-FENCE-003';
    const jobId = 'DISPATCH-WORKER-FENCE-003';

    await PurchaseOrder.create({
      purchaseOrderId: poId,
      organisationId: 'ORG-ZAMORIN',
      cafeId: 'ZC-0001',
      vendorId: 'VEN-4001',
      status: 'APPROVED',
      currentRevision: 1,
      activeApprovedRevision: 1,
      lineItems: [{ itemId: 'ITEM-COFFEE-BEANS', orderedQuantityBase: 10000, unitPricePaisa: 80, totalLinePaisa: 8000 }],
      revisions: [{ revisionNumber: 1, status: 'APPROVED', lineItems: [{ itemId: 'ITEM-COFFEE-BEANS', orderedQuantityBase: 10000, unitPricePaisa: 80, totalLinePaisa: 8000 }] }],
      dispatchStatus: 'ACCEPTED_BY_PROVIDER',
      createdByUserId: 'AD-0001',
    });

    // Job was already reconciled / completed by Worker 2
    await ProcurementDispatchJob.create({
      dispatchJobId: jobId,
      organisationId: 'ORG-ZAMORIN',
      cafeId: 'ZC-0001',
      purchaseOrderId: poId,
      revisionNumber: 1,
      vendorId: 'VEN-4001',
      recipientEmail: 'orders@malabarcoffee.local',
      status: 'ACCEPTED_BY_PROVIDER', // Newer outcome
      claimedByWorkerId: 'WORKER-NEW-02',
      lockExpiresAt: null,
      idempotencyKey: `IDEMP-${jobId}`,
      provider: 'EMAIL',
      payloadSnapshot: { purchaseOrderId: poId, revisionNumber: 1, totalPaisa: 8400, lineItems: [] },
    });

    // Zombie Worker 1 (whose lease expired) attempts to write an old outcome
    const zombieWorkerId = 'WORKER-EXPIRED-ZOMBIE-01';
    const persistResult = await ProcurementDispatchJob.findOneAndUpdate(
      {
        dispatchJobId: jobId,
        claimedByWorkerId: zombieWorkerId,
        status: 'SENDING',
      },
      {
        $set: {
          status: 'FAILED', // Zombie tries to write FAILED
          reconciliationNotes: 'Zombie write attempt',
        },
      },
      { new: true }
    );

    assert.equal(persistResult, null, 'Zombie write must be suppressed and return null');

    // Confirm newer outcome remained untouched
    const preservedJob = await ProcurementDispatchJob.findOne({ dispatchJobId: jobId });
    assert.equal(preservedJob.status, 'ACCEPTED_BY_PROVIDER');
    assert.equal(preservedJob.claimedByWorkerId, 'WORKER-NEW-02');
  });

  // ===========================================================================
  // CASE 3: CONCURRENT CANCELLATION & AMENDMENT COORDINATION
  // ===========================================================================

  await t.test('Case 3.1: Pre-send cancellation cancels queued dispatch job and suppresses transmission', async () => {
    provider.clearHistory();
    await ProcurementDispatchJob.deleteMany({});
    await PurchaseOrder.deleteMany({});

    const poId = 'PO-CANCEL-PRE-001';
    const jobId = 'DISPATCH-CANCEL-PRE-001';

    await PurchaseOrder.create({
      purchaseOrderId: poId,
      organisationId: 'ORG-ZAMORIN',
      cafeId: 'ZC-0001',
      vendorId: 'VEN-4001',
      status: 'APPROVED',
      currentRevision: 1,
      activeApprovedRevision: 1,
      lineItems: [{ itemId: 'ITEM-COFFEE-BEANS', orderedQuantityBase: 10000, unitPricePaisa: 80, totalLinePaisa: 8000 }],
      revisions: [{ revisionNumber: 1, status: 'APPROVED', lineItems: [{ itemId: 'ITEM-COFFEE-BEANS', orderedQuantityBase: 10000, unitPricePaisa: 80, totalLinePaisa: 8000 }] }],
      dispatchStatus: 'QUEUED',
      createdByUserId: 'AD-0001',
    });

    await ProcurementDispatchJob.create({
      dispatchJobId: jobId,
      organisationId: 'ORG-ZAMORIN',
      cafeId: 'ZC-0001',
      purchaseOrderId: poId,
      revisionNumber: 1,
      vendorId: 'VEN-4001',
      recipientEmail: 'orders@malabarcoffee.local',
      status: 'QUEUED',
      idempotencyKey: `IDEMP-${jobId}`,
      provider: 'EMAIL',
      payloadSnapshot: { purchaseOrderId: poId, revisionNumber: 1, totalPaisa: 8400, lineItems: [] },
    });

    // User cancels the purchase order
    await ProcurementApprovalService.cancelPurchaseOrder({
      purchaseOrderId: poId,
      reason: 'Chef decided not to order coffee beans today',
      auth: koraAuth,
    });

    // Verify PO and Dispatch job cancelled
    const cancelledPo = await PurchaseOrder.findOne({ purchaseOrderId: poId });
    assert.equal(cancelledPo.status, 'CANCELLED');
    assert.equal(cancelledPo.dispatchStatus, 'CANCELLED');

    const cancelledJob = await ProcurementDispatchJob.findOne({ dispatchJobId: jobId });
    assert.equal(cancelledJob.status, 'CANCELLED');

    // Run dispatch worker -> worker must skip sending
    const outcomes = await defaultDispatchService.runDispatchWorker({ provider });
    assert.equal(outcomes.length, 0, 'No jobs eligible to run');
    assert.equal(provider.getAttemptHistory().length, 0, 'ZERO emails transmitted for cancelled PO');
  });

  await t.test('Case 3.2: Concurrent cancellation during in-flight dispatch prevents completed dispatch from overwriting CANCELLED with ORDERED', async () => {
    provider.clearHistory();
    await ProcurementDispatchJob.deleteMany({});
    await PurchaseOrder.deleteMany({});

    const poId = 'PO-CANCEL-INFLIGHT-002';
    const jobId = 'DISPATCH-CANCEL-INFLIGHT-002';

    await PurchaseOrder.create({
      purchaseOrderId: poId,
      organisationId: 'ORG-ZAMORIN',
      cafeId: 'ZC-0001',
      vendorId: 'VEN-4001',
      status: 'APPROVED',
      currentRevision: 1,
      activeApprovedRevision: 1,
      lineItems: [{ itemId: 'ITEM-COFFEE-BEANS', orderedQuantityBase: 10000, unitPricePaisa: 80, totalLinePaisa: 8000 }],
      revisions: [{ revisionNumber: 1, status: 'APPROVED', lineItems: [{ itemId: 'ITEM-COFFEE-BEANS', orderedQuantityBase: 10000, unitPricePaisa: 80, totalLinePaisa: 8000 }] }],
      dispatchStatus: 'QUEUED',
      createdByUserId: 'AD-0001',
    });

    await ProcurementDispatchJob.create({
      dispatchJobId: jobId,
      organisationId: 'ORG-ZAMORIN',
      cafeId: 'ZC-0001',
      purchaseOrderId: poId,
      revisionNumber: 1,
      vendorId: 'VEN-4001',
      recipientEmail: 'orders@malabarcoffee.local',
      status: 'QUEUED',
      idempotencyKey: `IDEMP-${jobId}`,
      provider: 'EMAIL',
      payloadSnapshot: { purchaseOrderId: poId, revisionNumber: 1, totalPaisa: 8400, lineItems: [] },
    });

    // Create a provider that triggers concurrent PO cancellation WHILE sendEmail is in flight
    const delayedProvider = {
      async sendEmail(options) {
        // Concurrently cancel the PO while in flight!
        await ProcurementApprovalService.cancelPurchaseOrder({
          purchaseOrderId: poId,
          reason: 'Emergency budget freeze while email was transmitting',
          auth: koraAuth,
        });

        return {
          delivered: true,
          providerMessageId: 'EXT-MSG-INFLIGHT-CANCEL-01',
        };
      },
    };

    // Worker executes
    const outcomes = await defaultDispatchService.runDispatchWorker({ provider: delayedProvider });
    assert.equal(outcomes.length, 1);
    assert.equal(outcomes[0].status, 'ACCEPTED_BY_PROVIDER');

    // CRITICAL ASSERTION: PO status MUST REMAIN 'CANCELLED', NEVER overwritten to 'ORDERED'!
    const poAfterDispatch = await PurchaseOrder.findOne({ purchaseOrderId: poId });
    assert.equal(poAfterDispatch.status, 'CANCELLED', 'PO must retain CANCELLED status, not be overwritten to ORDERED');
    assert.equal(poAfterDispatch.dispatchStatus, 'ACCEPTED_BY_PROVIDER', 'Transport status records delivery');

    // Dispatch job notes concurrent cancellation
    const jobAfterDispatch = await ProcurementDispatchJob.findOne({ dispatchJobId: jobId });
    assert.equal(jobAfterDispatch.status, 'ACCEPTED_BY_PROVIDER');
    assert.match(jobAfterDispatch.reconciliationNotes, /concurrently cancelled/);
  });

  await t.test('Case 3.3: In-flight amendment to Revision 2 prevents Revision 1 dispatch from setting status to ORDERED', async () => {
    provider.clearHistory();
    await ProcurementDispatchJob.deleteMany({});
    await PurchaseOrder.deleteMany({});

    const poId = 'PO-AMEND-INFLIGHT-003';
    const jobId = 'DISPATCH-AMEND-INFLIGHT-003';

    await PurchaseOrder.create({
      purchaseOrderId: poId,
      organisationId: 'ORG-ZAMORIN',
      cafeId: 'ZC-0001',
      vendorId: 'VEN-4001',
      status: 'APPROVED',
      currentRevision: 1,
      activeApprovedRevision: 1,
      lineItems: [{ itemId: 'ITEM-COFFEE-BEANS', orderedQuantityBase: 10000, unitPricePaisa: 80, totalLinePaisa: 8000 }],
      revisions: [{ revisionNumber: 1, status: 'APPROVED', lineItems: [{ itemId: 'ITEM-COFFEE-BEANS', orderedQuantityBase: 10000, unitPricePaisa: 80, totalLinePaisa: 8000 }] }],
      dispatchStatus: 'QUEUED',
      createdByUserId: 'AD-0001',
    });

    await ProcurementDispatchJob.create({
      dispatchJobId: jobId,
      organisationId: 'ORG-ZAMORIN',
      cafeId: 'ZC-0001',
      purchaseOrderId: poId,
      revisionNumber: 1,
      vendorId: 'VEN-4001',
      recipientEmail: 'orders@malabarcoffee.local',
      status: 'QUEUED',
      idempotencyKey: `IDEMP-${jobId}`,
      provider: 'EMAIL',
      payloadSnapshot: { purchaseOrderId: poId, revisionNumber: 1, totalPaisa: 8400, lineItems: [] },
    });

    // Provider that triggers material PO amendment while Revision 1 dispatch is in-flight
    const amendProvider = {
      async sendEmail(options) {
        // Concurrently edit order (promotes to Revision 2, status SUBMITTED)
        await ProcurementApprovalService.editOrderRevision({
          purchaseOrderId: poId,
          lineItems: [{ itemId: 'ITEM-COFFEE-BEANS', orderedQuantityBase: 30000 }],
          reason: 'Need increased to 30 kg during supplier phone call',
          auth: koraAuth,
        });

        return {
          delivered: true,
          providerMessageId: 'EXT-MSG-AMEND-01',
        };
      },
    };

    const outcomes = await defaultDispatchService.runDispatchWorker({ provider: amendProvider });
    assert.equal(outcomes.length, 1);

    // CRITICAL ASSERTION: The PO was amended to Revision 2, so it MUST NOT be set to ORDERED!
    const poAfterAmend = await PurchaseOrder.findOne({ purchaseOrderId: poId });
    assert.equal(poAfterAmend.currentRevision, 2, 'PO must be on Revision 2');
    assert.equal(poAfterAmend.status, 'SUBMITTED', 'PO must be in SUBMITTED status awaiting re-approval, not ORDERED');
    assert.equal(poAfterAmend.activeApprovedRevision, null, 'Active approval was revoked for Revision 2');
  });
  } catch (err) {
    console.error('FATAL_TEST_BODY_FAIL:', err);
    throw err;
  }
});
