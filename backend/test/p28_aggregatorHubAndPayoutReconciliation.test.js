'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { AggregatorIntakeService } = require('../src/services/aggregatorIntakeService');
const {
  AggregatorPayoutReconciliationService,
  DISCREPANCY_TYPES,
} = require('../src/services/aggregatorPayoutReconciliationService');
const { OnlineChannelConfig } = require('../src/models/OnlineChannelConfig');
const { AggregatorOrder } = require('../src/models/AggregatorOrder');
const { ChannelOrder } = require('../src/models/ChannelOrder');
const auditService = require('../src/services/auditService');

test('Phase P28: Aggregator Hub, Store Overload Pause & Payout Reconciliation Suite', async (t) => {
  const orgId = 'ORG-P28-TEST';
  const cafeId = 'ZC-CAFE-01';

  // ---------------------------------------------------------------------------
  // 1. Store Overload Pause & Auto-Resume Logic (F088 / A081)
  // ---------------------------------------------------------------------------
  await t.test('1. pauseAggregatorStore pauses channel intake with target duration and reason', async () => {
    let savedConfig = null;
    const fakeConfig = {
      organisationId: orgId,
      cafeId,
      aggregators: {
        zomato: { isEnabled: true, storeStatus: 'ONLINE' },
        swiggy: { isEnabled: true, storeStatus: 'ONLINE' },
      },
      markModified: () => {},
      save: async function () {
        savedConfig = this;
        return this;
      },
    };

    const origFindOne = OnlineChannelConfig.findOne;
    const origAudit = auditService.recordAuditEvent;

    OnlineChannelConfig.findOne = () => Promise.resolve(fakeConfig);
    auditService.recordAuditEvent = async () => ({ success: true });

    try {
      const res = await AggregatorIntakeService.pauseAggregatorStore({
        organisationId: orgId,
        cafeId,
        provider: 'ZOMATO',
        durationMinutes: 30,
        reason: 'KITCHEN_OVERLOAD',
        auth: { userId: 'USR-MGR-01', role: 'CAFE_ADMIN' },
      });

      assert.equal(res.storeStatus, 'PAUSED');
      assert.equal(res.provider, 'ZOMATO');
      assert.equal(res.durationMinutes, 30);
      assert.equal(res.reason, 'KITCHEN_OVERLOAD');
      assert.ok(res.pausedUntil instanceof Date);

      assert.equal(savedConfig.aggregators.zomato.storeStatus, 'PAUSED');
      assert.equal(savedConfig.aggregators.zomato.pauseReason, 'KITCHEN_OVERLOAD');
      // Swiggy remains online
      assert.equal(savedConfig.aggregators.swiggy.storeStatus, 'ONLINE');
    } finally {
      OnlineChannelConfig.findOne = origFindOne;
      auditService.recordAuditEvent = origAudit;
    }
  });

  // ---------------------------------------------------------------------------
  // 2. Auto-Resume after elapsed pause timer
  // ---------------------------------------------------------------------------
  await t.test('2. getAggregatorStoreStatus automatically resumes store when timer expired', async () => {
    // Config with past pausedUntil date (5 minutes ago)
    const pastTime = new Date(Date.now() - 5 * 60 * 1000);
    let savedConfig = null;
    const fakeConfig = {
      organisationId: orgId,
      cafeId,
      aggregators: {
        zomato: {
          isEnabled: true,
          storeStatus: 'PAUSED',
          pausedUntil: pastTime,
          pauseReason: 'KITCHEN_OVERLOAD',
          autoResume: true,
        },
        swiggy: { isEnabled: true, storeStatus: 'ONLINE' },
      },
      markModified: () => {},
      save: async function () {
        savedConfig = this;
        return this;
      },
    };

    const origFindOne = OnlineChannelConfig.findOne;
    OnlineChannelConfig.findOne = () => Promise.resolve(fakeConfig);

    try {
      const status = await AggregatorIntakeService.getAggregatorStoreStatus({
        organisationId: orgId,
        cafeId,
      });

      assert.equal(status.zomato.storeStatus, 'ONLINE');
      assert.equal(status.zomato.pausedUntil, null);
      assert.ok(savedConfig);
    } finally {
      OnlineChannelConfig.findOne = origFindOne;
    }
  });

  // ---------------------------------------------------------------------------
  // 3. Manual Immediate Resume
  // ---------------------------------------------------------------------------
  await t.test('3. resumeAggregatorStore immediately restores store to ONLINE status', async () => {
    let savedConfig = null;
    const fakeConfig = {
      organisationId: orgId,
      cafeId,
      aggregators: {
        zomato: {
          isEnabled: true,
          storeStatus: 'PAUSED',
          pausedUntil: new Date(Date.now() + 60 * 60 * 1000),
          pauseReason: 'RAIN_SURGE',
        },
        swiggy: { isEnabled: true, storeStatus: 'ONLINE' },
      },
      markModified: () => {},
      save: async function () {
        savedConfig = this;
        return this;
      },
    };

    const origFindOne = OnlineChannelConfig.findOne;
    const origAudit = auditService.recordAuditEvent;

    OnlineChannelConfig.findOne = () => Promise.resolve(fakeConfig);
    auditService.recordAuditEvent = async () => ({ success: true });

    try {
      const res = await AggregatorIntakeService.resumeAggregatorStore({
        organisationId: orgId,
        cafeId,
        provider: 'ZOMATO',
        auth: { userId: 'USR-MGR-01', role: 'CAFE_ADMIN' },
      });

      assert.equal(res.storeStatus, 'ONLINE');
      assert.equal(savedConfig.aggregators.zomato.storeStatus, 'ONLINE');
      assert.equal(savedConfig.aggregators.zomato.pausedUntil, null);
    } finally {
      OnlineChannelConfig.findOne = origFindOne;
      auditService.recordAuditEvent = origAudit;
    }
  });

  // ---------------------------------------------------------------------------
  // 4. Ingest webhook rejection during Store Pause
  // ---------------------------------------------------------------------------
  await t.test('4. Webhook order callback returns STORE_PAUSED_REJECTED when store is paused', async () => {
    const futureTime = new Date(Date.now() + 20 * 60 * 1000);
    const origFindOne = OnlineChannelConfig.findOne;

    OnlineChannelConfig.findOne = () => ({
      lean: () => Promise.resolve({
        organisationId: orgId,
        cafeId,
        aggregators: {
          zomato: {
            isEnabled: true,
            storeStatus: 'PAUSED',
            pausedUntil: futureTime,
            pauseReason: 'KITCHEN_OVERLOAD',
          },
        },
      }),
      then: (resolve) => Promise.resolve({
        aggregators: {
          zomato: { storeStatus: 'PAUSED', pausedUntil: futureTime, pauseReason: 'KITCHEN_OVERLOAD' },
        },
      }).then(resolve),
    });

    try {
      const res = await AggregatorIntakeService.processWebhookIntake({
        provider: 'ZOMATO',
        payload: {
          externalOrderId: 'ZOM-EXT-99881',
          cafeId,
        },
        organisationId: orgId,
      });

      assert.equal(res.status, 'STORE_PAUSED_REJECTED');
      assert.ok(res.message.includes('KITCHEN_OVERLOAD') || res.message.includes('Kitchen Overload'));
    } finally {
      OnlineChannelConfig.findOne = origFindOne;
    }
  });

  // ---------------------------------------------------------------------------
  // 5. Aggregator Statement Ingestion & Discrepancy Reconciliation (F100-F106)
  // ---------------------------------------------------------------------------
  await t.test('5. reconcilePayoutStatement detects commission overcharge, missing POS orders and generates dispute sheet', async () => {
    const origAggOrderFind = AggregatorOrder.findOne;
    const origOrderFind = ChannelOrder.findOne;
    const origAudit = auditService.recordAuditEvent;

    // Order 1: Matched, but charged 28% commission instead of 20% agreed ceiling
    // Gross = ₹1,000 (100000 paise). Agreed commission = ₹200 (20000 paise). Charged = ₹280 (28000 paise).
    // Order 2: Not in POS database (Ghost order on Zomato statement)
    // Order 3: Matched, but has wrongful penalty deduction of ₹150 (15000 paise)
    // Order 4: Clean order, perfectly reconciled
    const mockDbOrders = {
      'ZOM-ORD-01': {
        externalOrderId: 'ZOM-ORD-01',
        pricing: { netPayablePaisa: 100000 },
      },
      'ZOM-ORD-03': {
        externalOrderId: 'ZOM-ORD-03',
        pricing: { netPayablePaisa: 50000 },
      },
      'ZOM-ORD-04': {
        externalOrderId: 'ZOM-ORD-04',
        pricing: { netPayablePaisa: 40000 },
      },
    };

    AggregatorOrder.findOne = (query) => ({
      lean: () => Promise.resolve(mockDbOrders[query.externalOrderId] || null),
      then: (resolve) => Promise.resolve(mockDbOrders[query.externalOrderId] || null).then(resolve),
    });
    ChannelOrder.findOne = () => ({
      lean: () => Promise.resolve(null),
      then: (resolve) => Promise.resolve(null).then(resolve),
    });
    auditService.recordAuditEvent = async () => ({ success: true });

    const statementLines = [
      // Line 1: Commission Overcharge
      {
        externalOrderId: 'ZOM-ORD-01',
        grossOrderPaisa: 100000, // ₹1,000
        commissionPaisa: 28000,  // ₹280 (28% instead of 20%)
        tcsPaisa: 1000,          // ₹10 (1%)
        tdsPaisa: 1000,          // ₹10 (1%)
        netPayoutPaisa: 70000,   // ₹700
      },
      // Line 2: Missing from POS database
      {
        externalOrderId: 'ZOM-ORD-02',
        grossOrderPaisa: 80000,
        commissionPaisa: 16000,
        tcsPaisa: 800,
        tdsPaisa: 800,
        netPayoutPaisa: 62400,
      },
      // Line 3: Unauthorized deduction / penalty
      {
        externalOrderId: 'ZOM-ORD-03',
        grossOrderPaisa: 50000,
        commissionPaisa: 10000,  // 20%
        deductionsPaisa: 15000,  // ₹150 cancellation charge penalty
        deductionReason: 'Late Handover Penalty',
        tcsPaisa: 500,
        tdsPaisa: 500,
        netPayoutPaisa: 24000,
      },
      // Line 4: Clean order
      {
        externalOrderId: 'ZOM-ORD-04',
        grossOrderPaisa: 40000,
        commissionPaisa: 8000,   // 20%
        tcsPaisa: 400,
        tdsPaisa: 400,
        netPayoutPaisa: 31200,   // 40000 - 8000 - 400 - 400 = 31200
      },
    ];

    try {
      const result = await AggregatorPayoutReconciliationService.reconcilePayoutStatement({
        organisationId: orgId,
        cafeId,
        provider: 'ZOMATO',
        statementReference: 'ZOM-STMT-2026W41',
        statementPeriod: { start: '2026-10-01', end: '2026-10-07' },
        agreedCommissionRatePercent: 20,
        lineItems: statementLines,
        auth: { userId: 'USR-ACCOUNTS-01', role: 'OWNER' },
      });

      assert.equal(result.summary.totalRowsAudited, 4);
      assert.equal(result.summary.matchedOrdersCount, 3);
      assert.equal(result.summary.status, 'DISCREPANCIES_DETECTED');

      // Check specific discrepancy types detected
      const overchargeDiscrepancy = result.discrepancies.find(
        (d) => d.type === DISCREPANCY_TYPES.COMMISSION_RATE_OVERCHARGE
      );
      assert.ok(overchargeDiscrepancy, 'Commission rate overcharge must be flagged');
      assert.equal(overchargeDiscrepancy.externalOrderId, 'ZOM-ORD-01');
      assert.equal(overchargeDiscrepancy.variancePaisa, 8000); // ₹80 overcharge

      const missingOrderDiscrepancy = result.discrepancies.find(
        (d) => d.type === DISCREPANCY_TYPES.UNMATCHED_ORDER_IN_POS
      );
      assert.ok(missingOrderDiscrepancy, 'Unmatched POS order must be flagged');
      assert.equal(missingOrderDiscrepancy.externalOrderId, 'ZOM-ORD-02');

      const wrongfulDeductionDiscrepancy = result.discrepancies.find(
        (d) => d.type === DISCREPANCY_TYPES.WRONGFUL_DEDUCTION
      );
      assert.ok(wrongfulDeductionDiscrepancy, 'Penalty deduction must be flagged');
      assert.equal(wrongfulDeductionDiscrepancy.variancePaisa, 15000);
      assert.equal(wrongfulDeductionDiscrepancy.deductionReason, 'Late Handover Penalty');

      // Dispute ticket structure
      assert.ok(result.disputeTicketPayload);
      assert.equal(result.disputeTicketPayload.provider, 'ZOMATO');
      assert.ok(result.disputeTicketPayload.claimedRefundPaisa > 0);
    } finally {
      AggregatorOrder.findOne = origAggOrderFind;
      ChannelOrder.findOne = origOrderFind;
      auditService.recordAuditEvent = origAudit;
    }
  });
});
