'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const zReportService = require('../src/services/zReportService');
const { RegisterSession } = require('../src/models/RegisterSession');
const DailyClosePack = require('../src/models/DailyClosePack');
const { SequenceCounter } = require('../src/models/SequenceCounter');
const auditService = require('../src/services/auditService');

function createSessionMock(fakeSession) {
  return () => ({
    sort: () => Promise.resolve(fakeSession),
    lean: () => Promise.resolve(fakeSession),
    then: (resolve, reject) => Promise.resolve(fakeSession).then(resolve, reject),
  });
}

test('Phase P27: Daily Close, Shift Cash Reconciliation & Z-Reports Suite', async (t) => {
  const orgId = 'ORG-P27-TEST';
  const cafeId = 'ZC-CAFE-01';

  // ---------------------------------------------------------------------------
  // 1. Currency Denomination Multiplier (A053-A056)
  // ---------------------------------------------------------------------------
  await t.test('1. calculateDenominationsTotal computes all note and coin denominations accurately', () => {
    const denominations = {
      notes_2000: 2,  // 4,000 -> 400000 paise
      notes_500: 5,   // 2,500 -> 250000 paise
      notes_200: 10,  // 2,000 -> 200000 paise
      notes_100: 15,  // 1,500 -> 150000 paise
      notes_50: 20,   // 1,000 -> 100000 paise
      notes_20: 25,   //   500 ->  50000 paise
      notes_10: 30,   //   300 ->  30000 paise
      coins_10: 10,   //   100 ->  10000 paise
      coins_5: 20,    //   100 ->  10000 paise
      coins_2: 25,    //    50 ->   5000 paise
      coins_1: 50,    //    50 ->   5000 paise
    };

    const result = zReportService.calculateDenominationsTotal(denominations);
    // Expected total rupees: 4000 + 2500 + 2000 + 1500 + 1000 + 500 + 300 + 100 + 100 + 50 + 50 = 12,100
    // In paisa: 1,210,000
    assert.equal(result.totalPaisa, 1210000);
    assert.equal(result.parsedBreakdown.notes_2000.count, 2);
    assert.equal(result.parsedBreakdown.notes_2000.amountPaisa, 400000);
    assert.equal(result.parsedBreakdown.coins_1.count, 50);
    assert.equal(result.parsedBreakdown.coins_1.amountPaisa, 5000);
  });

  // ---------------------------------------------------------------------------
  // 2. Exact Match Settlement & Z-Report Identifier Generation
  // ---------------------------------------------------------------------------
  await t.test('2. commitZReportSettlement settles session when counted cash matches expected', async () => {
    const origFindOne = RegisterSession.findOne;
    const origAudit = auditService.recordAuditEvent;
    const origSeq = SequenceCounter.generateId;

    let savedSession = null;
    const fakeSession = {
      registerSessionId: 'REG-SESS-001',
      registerId: 'REG-MAIN-01',
      organisationId: orgId,
      cafeId,
      businessDate: '2026-10-12',
      status: 'OPEN',
      openingFloatPaisa: 200000,
      expectedCashPaisa: 850000,
      totalSalesPaisa: 1500000,
      totalCashSalesPaisa: 650000,
      totalUpiSalesPaisa: 850000,
      orderCount: 42,
      cashierUserId: 'USR-CASHIER-1',
      save: async function () {
        savedSession = this;
        return this;
      },
    };

    RegisterSession.findOne = createSessionMock(fakeSession);
    SequenceCounter.generateId = async () => '0042';
    auditService.recordAuditEvent = async () => ({ success: true });

    try {
      const summary = await zReportService.commitZReportSettlement({
        organisationId: orgId,
        cafeId,
        countedCashPaisa: 850000,
        closingDeclarationNote: 'Shift 1 closed smoothly',
        auth: { userId: 'USR-CASHIER-1', role: 'STAFF' },
      });

      assert.equal(savedSession.status, 'CLOSED');
      assert.equal(savedSession.countedCashPaisa, 850000);
      assert.equal(savedSession.cashVariancePaisa, 0);
      assert.equal(summary.reconciliation.varianceType, 'EXACT');
      assert.equal(summary.reconciliation.cashVariancePaisa, 0);
      assert.equal(summary.reconciliation.requiresManagerSignOff, false);
      assert.ok(summary.zReportId.includes('ZREP-'));
      assert.equal(summary.status, 'SETTLED');
    } finally {
      RegisterSession.findOne = origFindOne;
      auditService.recordAuditEvent = origAudit;
      SequenceCounter.generateId = origSeq;
    }
  });

  // ---------------------------------------------------------------------------
  // 3. Blind Close Mode Flagging (A053)
  // ---------------------------------------------------------------------------
  await t.test('3. Blind close correctly records denomination count and sets isBlindClose flag', async () => {
    const origFindOne = RegisterSession.findOne;
    const origAudit = auditService.recordAuditEvent;

    const fakeSession = {
      registerSessionId: 'REG-SESS-BLIND',
      registerId: 'REG-MAIN-01',
      organisationId: orgId,
      cafeId,
      businessDate: '2026-10-12',
      status: 'OPEN',
      expectedCashPaisa: 500000,
      save: async function () { return this; },
    };

    RegisterSession.findOne = createSessionMock(fakeSession);
    auditService.recordAuditEvent = async () => ({ success: true });

    try {
      const summary = await zReportService.commitZReportSettlement({
        organisationId: orgId,
        cafeId,
        denominations: {
          notes_500: 10, // ₹5,000 = 500000 paise
        },
        isBlindClose: true,
        auth: { userId: 'USR-CASHIER-2', role: 'STAFF' },
      });

      assert.equal(summary.reconciliation.isBlindClose, true);
      assert.equal(summary.reconciliation.countedCashPaisa, 500000);
      assert.equal(summary.reconciliation.varianceType, 'EXACT');
      assert.equal(summary.reconciliation.denominationBreakdown.notes_500.count, 10);
    } finally {
      RegisterSession.findOne = origFindOne;
      auditService.recordAuditEvent = origAudit;
    }
  });

  // ---------------------------------------------------------------------------
  // 4. Discrepancy Threshold Enforces Supervisor Override PIN / Role (A054)
  // ---------------------------------------------------------------------------
  await t.test('4. Cash variance >= ₹100 rejects without supervisor authorization when required', async () => {
    const origFindOne = RegisterSession.findOne;
    const fakeSession = {
      registerSessionId: 'REG-SESS-VAR',
      organisationId: orgId,
      cafeId,
      status: 'OPEN',
      expectedCashPaisa: 1000000, // ₹10,000
      save: async function () { return this; },
    };

    RegisterSession.findOne = createSessionMock(fakeSession);

    try {
      // Counted is ₹9,500 (shortage of ₹500, > ₹100 threshold)
      await assert.rejects(
        async () => {
          await zReportService.commitZReportSettlement({
            organisationId: orgId,
            cafeId,
            countedCashPaisa: 950000,
            requireSupervisorOnDiscrepancy: true,
            auth: { userId: 'USR-CASHIER-3', role: 'STAFF' },
          });
        },
        (err) => {
          assert.equal(err.code, 'DISCREPANCY_SUPERVISOR_REQUIRED');
          assert.ok(err.message.includes('Supervisor override authorization required'));
          return true;
        }
      );
    } finally {
      RegisterSession.findOne = origFindOne;
    }
  });

  // ---------------------------------------------------------------------------
  // 5. Discrepancy Settlement Succeeds with Supervisor Override PIN or Owner Role
  // ---------------------------------------------------------------------------
  await t.test('5. Cash variance succeeds when supervisorOverridePin is supplied', async () => {
    const origFindOne = RegisterSession.findOne;
    const origAudit = auditService.recordAuditEvent;

    const fakeSession = {
      registerSessionId: 'REG-SESS-VAR-2',
      organisationId: orgId,
      cafeId,
      status: 'OPEN',
      expectedCashPaisa: 1000000, // ₹10,000
      save: async function () { return this; },
    };

    RegisterSession.findOne = createSessionMock(fakeSession);
    auditService.recordAuditEvent = async () => ({ success: true });

    try {
      const summary = await zReportService.commitZReportSettlement({
        organisationId: orgId,
        cafeId,
        countedCashPaisa: 950000, // shortage of ₹500
        requireSupervisorOnDiscrepancy: true,
        supervisorOverridePin: '9988',
        supervisorUserId: 'USR-SUP-01',
        auth: { userId: 'USR-CASHIER-3', role: 'STAFF' },
      });

      assert.equal(summary.reconciliation.varianceType, 'SHORTAGE');
      assert.equal(summary.reconciliation.cashVariancePaisa, -50000);
      assert.equal(summary.reconciliation.requiresManagerSignOff, true);
      assert.equal(summary.reconciliation.supervisorApproved, true);
    } finally {
      RegisterSession.findOne = origFindOne;
      auditService.recordAuditEvent = origAudit;
    }
  });

  // ---------------------------------------------------------------------------
  // 6. Day-Close Freeze Integration with DailyClosePack (A055, A056)
  // ---------------------------------------------------------------------------
  await t.test('6. freezeDayClose synchronizes DailyClosePack record', async () => {
    const origFindOne = RegisterSession.findOne;
    const origAudit = auditService.recordAuditEvent;
    const origDailyPack = DailyClosePack.findOneAndUpdate;

    let dailyClosePackPayload = null;
    DailyClosePack.findOneAndUpdate = async (query, update, opts) => {
      dailyClosePackPayload = { query, update, opts };
      return { _id: 'DCP-001' };
    };

    const fakeSession = {
      registerSessionId: 'REG-SESS-FREEZE',
      organisationId: orgId,
      cafeId,
      businessDate: '2026-10-12',
      status: 'OPEN',
      expectedCashPaisa: 750000,
      save: async function () { return this; },
    };

    RegisterSession.findOne = createSessionMock(fakeSession);
    auditService.recordAuditEvent = async () => ({ success: true });

    try {
      const summary = await zReportService.commitZReportSettlement({
        organisationId: orgId,
        cafeId,
        countedCashPaisa: 755000, // Overage ₹50
        freezeDayClose: true,
        closingDeclarationNote: 'Day end freeze verified with drawer inspection',
        auth: { userId: 'USR-OWNER-1', role: 'OWNER' },
      });

      assert.equal(summary.reconciliation.varianceType, 'OVERAGE');
      assert.equal(summary.reconciliation.cashVariancePaisa, 5000);
      assert.ok(dailyClosePackPayload);
      assert.equal(dailyClosePackPayload.update.$set.status, 'ACKNOWLEDGED');
      assert.equal(dailyClosePackPayload.update.$set.variancePaisa, 5000);
      assert.equal(dailyClosePackPayload.update.$set.varianceExplanation, 'Day end freeze verified with drawer inspection');
    } finally {
      RegisterSession.findOne = origFindOne;
      auditService.recordAuditEvent = origAudit;
      DailyClosePack.findOneAndUpdate = origDailyPack;
    }
  });
});
