'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  AntiFraudGovernanceService,
  ANOMALY_THRESHOLDS,
} = require('../src/services/antiFraudGovernanceService');
const { Bill } = require('../src/models/Bill');
const { RegisterSession } = require('../src/models/RegisterSession');
const { OperationalAnomalyCase } = require('../src/models/OperationalAnomalyCase');
const auditService = require('../src/services/auditService');

test('Phase P29: Operational Governance, Audits & Anti-Fraud Suite', async (t) => {
  const orgId = 'ORG-P29-TEST';
  const cafeId = 'ZC-CAFE-01';

  // ---------------------------------------------------------------------------
  // 1. Bill Reprint Monitoring & Excessive Reprint Alert (A083 / F207)
  // ---------------------------------------------------------------------------
  await t.test('1. recordBillReprint tracks reprint counts and alerts on 3rd reprint', async () => {
    let savedBill = null;
    const fakeBill = {
      billId: 'BILL-1001',
      organisationId: orgId,
      cafeId,
      grandTotalPaisa: 75000,
      paymentMethod: 'CASH',
      reprints: [{ reprintedBy: 'USR-CASHIER-1', reprintedAt: new Date(), reason: 'Customer request' }],
      save: async function () {
        savedBill = this;
        return this;
      },
    };

    const origBillFind = Bill.findOne;
    const origAnomalyCreate = OperationalAnomalyCase.create;
    const origAudit = auditService.recordAuditEvent;

    let anomalyCreated = null;
    Bill.findOne = () => Promise.resolve(fakeBill);
    OperationalAnomalyCase.create = async (doc) => {
      anomalyCreated = doc;
      return { caseId: doc.caseId, ...doc };
    };
    auditService.recordAuditEvent = async () => ({ success: true });

    try {
      // 2nd reprint: within limit (threshold is 2)
      const res2 = await AntiFraudGovernanceService.recordBillReprint({
        organisationId: orgId,
        cafeId,
        billId: 'BILL-1001',
        actorUserId: 'USR-CASHIER-1',
        reason: 'Customer misplaced bill',
      });

      assert.equal(res2.totalReprints, 2);
      assert.equal(res2.alertTriggered, false);
      assert.equal(anomalyCreated, null);

      // 3rd reprint: EXCEEDS threshold (2), must trigger alert
      const res3 = await AntiFraudGovernanceService.recordBillReprint({
        organisationId: orgId,
        cafeId,
        billId: 'BILL-1001',
        actorUserId: 'USR-CASHIER-1',
        reason: 'Tax accountant copy requested',
      });

      assert.equal(res3.totalReprints, 3);
      assert.equal(res3.alertTriggered, true);
      assert.ok(res3.anomalyCaseId);
      assert.ok(anomalyCreated);
      assert.equal(anomalyCreated.ruleType, 'EXCESSIVE_REPRINTS');
      assert.equal(anomalyCreated.severity, 'HIGH');
      assert.equal(anomalyCreated.primaryEntityId, 'BILL-1001');
    } finally {
      Bill.findOne = origBillFind;
      OperationalAnomalyCase.create = origAnomalyCreate;
      auditService.recordAuditEvent = origAudit;
    }
  });

  // ---------------------------------------------------------------------------
  // 2. Normal Shift Evaluation (Clean Shift)
  // ---------------------------------------------------------------------------
  await t.test('2. evaluateCashierShiftAnomalies passes clean shift with zero risk score', async () => {
    const origSessionFind = RegisterSession.findOne;
    const origBillFind = Bill.find;

    const fakeSession = {
      registerSessionId: 'SESS-CLEAN-01',
      organisationId: orgId,
      cafeId,
      cashierUserId: 'USR-CASHIER-GOOD',
      cashVariancePaisa: 0,
      cashEvents: [
        { eventType: 'OPENING_FLOAT', amountPaisa: 100000 },
        { eventType: 'CASH_SALE', amountPaisa: 25000 },
        { eventType: 'CASH_SALE', amountPaisa: 40000 },
      ],
    };

    RegisterSession.findOne = () => ({
      lean: () => Promise.resolve(fakeSession),
      then: (fn) => Promise.resolve(fakeSession).then(fn),
    });
    Bill.find = () => ({
      lean: () => Promise.resolve([]),
      then: (fn) => Promise.resolve([]).then(fn),
    });

    try {
      const evaluation = await AntiFraudGovernanceService.evaluateCashierShiftAnomalies({
        organisationId: orgId,
        cafeId,
        registerSessionId: 'SESS-CLEAN-01',
      });

      assert.equal(evaluation.riskScore, 0);
      assert.equal(evaluation.riskTier, 'NORMAL');
      assert.equal(evaluation.anomaliesDetected.length, 0);
      assert.equal(evaluation.caseId, null);
    } finally {
      RegisterSession.findOne = origSessionFind;
      Bill.find = origBillFind;
    }
  });

  // ---------------------------------------------------------------------------
  // 3. Shift Anomaly Detection (No-Sale Drawer Kicks, Voids, High Variance)
  // ---------------------------------------------------------------------------
  await t.test('3. evaluateCashierShiftAnomalies flags multiple anomalies and recommends audit review', async () => {
    const origSessionFind = RegisterSession.findOne;
    const origBillFind = Bill.find;
    const origAnomalyCreate = OperationalAnomalyCase.create;

    let anomalyCasePayload = null;
    OperationalAnomalyCase.create = async (doc) => {
      anomalyCasePayload = doc;
      return { caseId: doc.caseId, ...doc };
    };

    // Session with 4 NO_SALE_OPEN events (>2 threshold), and -₹250 cash variance (>=10000 threshold)
    const fakeSession = {
      registerSessionId: 'SESS-RISK-01',
      organisationId: orgId,
      cafeId,
      cashierUserId: 'USR-CASHIER-SUSPECT',
      cashVariancePaisa: -25000, // Shortage of ₹250
      cashEvents: [
        { eventType: 'NO_SALE_OPEN', amountPaisa: 0 },
        { eventType: 'NO_SALE_OPEN', amountPaisa: 0 },
        { eventType: 'NO_SALE_OPEN', amountPaisa: 0 },
        { eventType: 'NO_SALE_OPEN', amountPaisa: 0 },
      ],
    };

    // 4 cancelled bills totaling ₹1,500 (>3 count and >100000 paise threshold)
    const fakeCancelledBills = [
      { billId: 'B-V1', grandTotalPaisa: 30000, paymentStatus: 'CANCELLED' },
      { billId: 'B-V2', grandTotalPaisa: 40000, paymentStatus: 'CANCELLED' },
      { billId: 'B-V3', grandTotalPaisa: 50000, paymentStatus: 'CANCELLED' },
      { billId: 'B-V4', grandTotalPaisa: 30000, paymentStatus: 'CANCELLED' },
    ];

    RegisterSession.findOne = () => ({
      lean: () => Promise.resolve(fakeSession),
      then: (fn) => Promise.resolve(fakeSession).then(fn),
    });
    Bill.find = () => ({
      lean: () => Promise.resolve(fakeCancelledBills),
      then: (fn) => Promise.resolve(fakeCancelledBills).then(fn),
    });

    try {
      const evaluation = await AntiFraudGovernanceService.evaluateCashierShiftAnomalies({
        organisationId: orgId,
        cafeId,
        registerSessionId: 'SESS-RISK-01',
      });

      // Risk score: 25 (no sale) + 25 (cash variance) + 35 (repeated voids) = 85
      assert.ok(evaluation.riskScore >= 60, `Risk score must be high, got ${evaluation.riskScore}`);
      assert.equal(evaluation.riskTier, 'HIGH_RISK_AUDIT_RECOMMENDED');
      assert.equal(evaluation.anomaliesDetected.length, 3);

      const drawerKickAnomaly = evaluation.anomaliesDetected.find((a) => a.type === 'ZERO_SALE_DRAWER_KICK');
      assert.ok(drawerKickAnomaly);
      assert.equal(drawerKickAnomaly.count, 4);

      const voidAnomaly = evaluation.anomaliesDetected.find((a) => a.type === 'REPEATED_VOIDS');
      assert.ok(voidAnomaly);
      assert.equal(voidAnomaly.voidCount, 4);

      // OperationalAnomalyCase should have been generated automatically
      assert.ok(evaluation.caseId);
      assert.ok(anomalyCasePayload);
      assert.equal(anomalyCasePayload.primaryEntityId, 'SESS-RISK-01');
    } finally {
      RegisterSession.findOne = origSessionFind;
      Bill.find = origBillFind;
      OperationalAnomalyCase.create = origAnomalyCreate;
    }
  });

  // ---------------------------------------------------------------------------
  // 4. Immutable Role & Permission Change Audit with Hash Chaining (F350)
  // ---------------------------------------------------------------------------
  await t.test('4. recordRolePermissionChange generates cryptographic hash and flags elevated privilege for MASTER/OWNER', async () => {
    const origAudit = auditService.recordAuditEvent;
    const origAnomalyCreate = OperationalAnomalyCase.create;

    let auditLogged = null;
    let anomalyCreated = null;

    auditService.recordAuditEvent = async (doc) => {
      auditLogged = doc;
      return { success: true };
    };

    OperationalAnomalyCase.create = async (doc) => {
      anomalyCreated = doc;
      return { caseId: doc.caseId, ...doc };
    };

    try {
      const result = await AntiFraudGovernanceService.recordRolePermissionChange({
        organisationId: orgId,
        actorUserId: 'USR-MASTER-SUPER',
        actorRole: 'MASTER',
        targetUserId: 'USR-STAFF-PROMOTED',
        targetRole: 'OWNER',
        action: 'ROLE_ELEVATED',
        previousState: { role: 'STAFF', accountStatus: 'ACTIVE' },
        newState: { role: 'OWNER', accountStatus: 'ACTIVE' },
        changeJustification: 'Promoted to franchise co-owner after capital equity investment',
      });

      assert.equal(result.status, 'AUDIT_COMMITTED');
      assert.equal(result.isElevatedPrivilege, true);
      assert.ok(result.changeHash);
      assert.equal(typeof result.changeHash, 'string');
      assert.equal(result.changeHash.length, 64); // SHA-256 length

      assert.ok(auditLogged);
      assert.equal(auditLogged.eventType, 'ROLE_PERMISSION_CHANGED');
      assert.equal(auditLogged.details.changeHash, result.changeHash);

      assert.ok(anomalyCreated);
      assert.equal(anomalyCreated.ruleType, 'ELEVATED_PRIVILEGE_EVENT');
      assert.equal(anomalyCreated.primaryEntityId, 'USR-STAFF-PROMOTED');
    } finally {
      auditService.recordAuditEvent = origAudit;
      OperationalAnomalyCase.create = origAnomalyCreate;
    }
  });
});
