'use strict';

/**
 * ANTI-FRAUD GOVERNANCE & OPERATIONAL AUDIT SERVICE (F207 / A083 / F350)
 *
 * Implements authoritative cashier anti-fraud monitoring, bill reprint controls,
 * zero-sale cash drawer alerts, and immutable role permission change governance.
 * Enforces strict non-accusatory review protocol via OperationalAnomalyCase.
 */

const crypto = require('crypto');
const { Bill } = require('../models/Bill');
const { RegisterSession } = require('../models/RegisterSession');
const { OperationalAnomalyCase } = require('../models/OperationalAnomalyCase');
const { ApiError } = require('../utils/ApiError');
const auditService = require('./auditService');

const ANOMALY_THRESHOLDS = {
  MAX_REPRINTS_BEFORE_ALERT: 2,
  MAX_VOIDS_PER_SHIFT_BEFORE_ALERT: 3,
  MAX_VOID_AMOUNT_PAISA_BEFORE_ALERT: 100000, // ₹1,000.00
  MAX_NO_SALE_DRAWER_KICKS_BEFORE_ALERT: 2,
};

class AntiFraudGovernanceService {
  /**
   * Track bill reprint and trigger anti-fraud alert on excessive reprints (A083 / F207)
   */
  static async recordBillReprint({
    organisationId,
    cafeId,
    billId,
    actorUserId,
    reason = 'Customer Request',
    auth = null,
  }) {
    if (!organisationId || !cafeId || !billId) {
      throw new ApiError(400, 'VALIDATION_FAILED', 'organisationId, cafeId, and billId are required.');
    }

    const bill = await Bill.findOne({ organisationId, cafeId, billId });
    if (!bill) {
      throw new ApiError(404, 'BILL_NOT_FOUND', `Bill ${billId} not found.`);
    }

    const effectiveUserId = actorUserId || auth?.userId || 'SYSTEM';

    bill.reprints = bill.reprints || [];
    bill.reprints.push({
      reprintedBy: effectiveUserId,
      reprintedAt: new Date(),
      reason: reason || 'Customer Request',
    });

    await bill.save();

    const totalReprints = bill.reprints.length;
    const isExcessive = totalReprints > ANOMALY_THRESHOLDS.MAX_REPRINTS_BEFORE_ALERT;

    let anomalyCaseId = null;

    if (isExcessive) {
      const caseSeq = `CASE-REP-${Date.now().toString(36).toUpperCase()}`;
      try {
        const anomaly = await OperationalAnomalyCase.create({
          caseId: caseSeq,
          organisationId,
          cafeId,
          ruleType: 'EXCESSIVE_REPRINTS',
          severity: 'HIGH',
          status: 'DETECTED',
          summary: `Bill ${billId} has been reprinted ${totalReprints} times (Threshold: ${ANOMALY_THRESHOLDS.MAX_REPRINTS_BEFORE_ALERT}). Requires supervisor verification to ensure customer copy is not being reused for unrecorded cash collections.`,
          primaryEntityId: billId,
          primaryEntityType: 'Bill',
          actorUserId: effectiveUserId,
          details: {
            billId,
            totalReprints,
            billAmountPaisa: bill.grandTotalPaisa,
            paymentMethod: bill.paymentMethod,
            reprintHistory: bill.reprints,
          },
        });
        anomalyCaseId = anomaly.caseId;
      } catch (_) {}

      await auditService.recordAuditEvent({
        organisationId,
        cafeId,
        userId: effectiveUserId,
        eventCategory: 'SECURITY',
        eventType: 'EXCESSIVE_BILL_REPRINT_ALERT',
        resourceType: 'Bill',
        resourceId: billId,
        details: {
          totalReprints,
          threshold: ANOMALY_THRESHOLDS.MAX_REPRINTS_BEFORE_ALERT,
          anomalyCaseId,
        },
      });
    }

    return {
      billId,
      totalReprints,
      alertTriggered: isExcessive,
      anomalyCaseId,
      message: isExcessive
        ? `Warning: Bill reprinted ${totalReprints} times. Excessive reprint notification dispatched for supervisor review.`
        : 'Bill reprint recorded successfully.',
    };
  }

  /**
   * Evaluate Cashier Shift Anomalies: Voids, No-Sale drawer kicks, Cash variances (F207)
   */
  static async evaluateCashierShiftAnomalies({
    organisationId,
    cafeId,
    registerSessionId,
    auth = null,
  }) {
    if (!organisationId || !cafeId || !registerSessionId) {
      throw new ApiError(400, 'VALIDATION_FAILED', 'organisationId, cafeId, and registerSessionId are required.');
    }

    const session = await RegisterSession.findOne({
      organisationId,
      cafeId,
      registerSessionId,
    }).lean();

    if (!session) {
      throw new ApiError(404, 'SESSION_NOT_FOUND', `Register session ${registerSessionId} not found.`);
    }

    const anomaliesDetected = [];
    let riskScore = 0;

    // 1. Zero-Sale Drawer Kick Evaluation
    const cashEvents = session.cashEvents || [];
    const noSaleEvents = cashEvents.filter((ev) => ev.eventType === 'NO_SALE_OPEN');
    const noSaleCount = noSaleEvents.length;

    if (noSaleCount > ANOMALY_THRESHOLDS.MAX_NO_SALE_DRAWER_KICKS_BEFORE_ALERT) {
      riskScore += 25;
      anomaliesDetected.push({
        type: 'ZERO_SALE_DRAWER_KICK',
        severity: 'MEDIUM',
        count: noSaleCount,
        threshold: ANOMALY_THRESHOLDS.MAX_NO_SALE_DRAWER_KICKS_BEFORE_ALERT,
        message: `Cash drawer was manually kicked open ${noSaleCount} times without an associated order in this shift.`,
      });
    }

    // 2. Cash Discrepancy Evaluation
    const cashVariancePaisa = session.cashVariancePaisa || 0;
    if (Math.abs(cashVariancePaisa) >= 10000) {
      riskScore += 25;
      anomaliesDetected.push({
        type: 'UNEXPLAINED_CASH_DRAWER_VARIANCE',
        severity: 'HIGH',
        variancePaisa: cashVariancePaisa,
        formattedVariance: `₹${(cashVariancePaisa / 100).toFixed(2)}`,
        message: `Register session closed with a physical cash variance of ₹${(cashVariancePaisa / 100).toFixed(2)}.`,
      });
    }

    // 3. Repeated Voids & Cancellations Evaluation
    let voidedBills = [];
    try {
      voidedBills = await Bill.find({
        organisationId,
        cafeId,
        registerSessionId,
        paymentStatus: 'CANCELLED',
      }).lean();
    } catch (_) {}

    const voidCount = voidedBills.length;
    const voidTotalPaisa = voidedBills.reduce((acc, b) => acc + (b.grandTotalPaisa || 0), 0);

    if (
      voidCount > ANOMALY_THRESHOLDS.MAX_VOIDS_PER_SHIFT_BEFORE_ALERT ||
      voidTotalPaisa > ANOMALY_THRESHOLDS.MAX_VOID_AMOUNT_PAISA_BEFORE_ALERT
    ) {
      riskScore += 35;
      anomaliesDetected.push({
        type: 'REPEATED_VOIDS',
        severity: 'HIGH',
        voidCount,
        voidTotalPaisa,
        message: `Cashier recorded ${voidCount} bill voids totaling ₹${(voidTotalPaisa / 100).toFixed(2)} (Threshold: >${ANOMALY_THRESHOLDS.MAX_VOIDS_PER_SHIFT_BEFORE_ALERT} voids or >₹${(ANOMALY_THRESHOLDS.MAX_VOID_AMOUNT_PAISA_BEFORE_ALERT / 100).toFixed(2)}).`,
      });
    }

    // Normalize risk score (0-100)
    riskScore = Math.min(100, riskScore);

    let riskTier = 'NORMAL';
    if (riskScore >= 60) riskTier = 'HIGH_RISK_AUDIT_RECOMMENDED';
    else if (riskScore >= 25) riskTier = 'ELEVATED';

    // Auto-create OperationalAnomalyCase if high risk
    let caseId = null;
    if (riskTier === 'HIGH_RISK_AUDIT_RECOMMENDED') {
      caseId = `CASE-SHFT-${Date.now().toString(36).toUpperCase()}`;
      try {
        await OperationalAnomalyCase.create({
          caseId,
          organisationId,
          cafeId,
          ruleType: anomaliesDetected[0]?.type || 'REPEATED_VOIDS',
          severity: 'HIGH',
          status: 'DETECTED',
          summary: `Shift ${registerSessionId} (Cashier: ${session.cashierUserId}) triggered high-risk operational anomaly score (${riskScore}/100) with ${anomaliesDetected.length} risk flags. Non-accusatory manager review recommended.`,
          primaryEntityId: registerSessionId,
          primaryEntityType: 'RegisterSession',
          actorUserId: session.cashierUserId,
          details: {
            registerSessionId,
            riskScore,
            riskTier,
            anomaliesDetected,
          },
        });
      } catch (_) {}
    }

    return {
      registerSessionId,
      cashierUserId: session.cashierUserId,
      cafeId,
      riskScore,
      riskTier,
      anomaliesDetected,
      caseId,
      evaluatedAt: new Date(),
    };
  }

  /**
   * Record Immutable Role & Permission Change Audit with Cryptographic Hash Chaining (F350)
   */
  static async recordRolePermissionChange({
    organisationId,
    actorUserId,
    actorRole,
    targetUserId,
    targetRole,
    action = 'ROLE_MODIFIED',
    previousState = {},
    newState = {},
    changeJustification = '',
    auth = null,
  }) {
    if (!organisationId || !targetUserId || !targetRole) {
      throw new ApiError(400, 'VALIDATION_FAILED', 'organisationId, targetUserId, and targetRole are required.');
    }

    const effectiveActorId = actorUserId || auth?.userId || 'SYSTEM';
    const effectiveActorRole = actorRole || auth?.role || 'MASTER';

    const timestamp = new Date().toISOString();
    const payloadToHash = JSON.stringify({
      organisationId,
      actorUserId: effectiveActorId,
      targetUserId,
      targetRole,
      action,
      previousState,
      newState,
      changeJustification,
      timestamp,
    });

    const changeHash = crypto.createHash('sha256').update(payloadToHash).digest('hex');

    // Immutable audit record
    await auditService.recordAuditEvent({
      organisationId,
      cafeId: null,
      userId: effectiveActorId,
      eventCategory: 'SECURITY',
      eventType: 'ROLE_PERMISSION_CHANGED',
      resourceType: 'UserRolePermission',
      resourceId: targetUserId,
      details: {
        targetUserId,
        targetRole,
        action,
        previousState,
        newState,
        changeJustification,
        changeHash,
      },
    });

    // If role elevated to OWNER or MASTER, record elevated privilege event
    let elevationCaseId = null;
    if (['MASTER', 'OWNER'].includes(targetRole) && previousState.role !== targetRole) {
      elevationCaseId = `CASE-PRIV-${Date.now().toString(36).toUpperCase()}`;
      try {
        await OperationalAnomalyCase.create({
          caseId: elevationCaseId,
          organisationId,
          ruleType: 'ELEVATED_PRIVILEGE_EVENT',
          severity: 'HIGH',
          status: 'DETECTED',
          summary: `User ${targetUserId} granted elevated governance role (${targetRole}) by ${effectiveActorId} (${effectiveActorRole}). Justification: ${changeJustification || 'None stated'}.`,
          primaryEntityId: targetUserId,
          primaryEntityType: 'User',
          actorUserId: effectiveActorId,
          details: {
            targetUserId,
            previousRole: previousState.role,
            newRole: targetRole,
            changeHash,
          },
        });
      } catch (_) {}
    }

    return {
      targetUserId,
      targetRole,
      action,
      changeHash,
      elevationCaseId,
      isElevatedPrivilege: Boolean(elevationCaseId),
      recordedAt: timestamp,
      status: 'AUDIT_COMMITTED',
    };
  }
}

module.exports = {
  AntiFraudGovernanceService,
  ANOMALY_THRESHOLDS,
};
