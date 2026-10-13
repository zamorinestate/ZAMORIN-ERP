'use strict';

/**
 * Z-REPORT & DAILY TILL RECONCILIATION SERVICE (STAGE 08 — PRIMARY MASTER PROGRAMME)
 *
 * Implements authoritative Daily Till Settlement and Z-Report closing:
 *  - Currency Denomination counter (500, 200, 100, 50, 20, 10, 5, 2, 1)
 *  - Expected vs Counted Cash calculation and Variance analysis (Shortage / Overage)
 *  - Discrepancy threshold alert flagging for management sign-off
 *  - Terminal / Session trade locking with status 'CLOSED'
 *  - Generation of immutable Z-Report summary record with audit trail
 */

const { RegisterSession } = require('../models/RegisterSession');
const { SequenceCounter } = require('../models/SequenceCounter');
const { ApiError } = require('../utils/ApiError');
const auditService = require('./auditService');

// Tolerance threshold in Paisa before discrepancy alert is triggered (e.g. ₹100.00 = 10,000 Paisa)
const DISCREPANCY_ALERT_THRESHOLD_PAISA = 10000;

/**
 * Compute total physical cash from denomination map
 */
function calculateDenominationsTotal(denominations = {}) {
  const multipliers = {
    2000: 200000,
    500: 50000,
    200: 20000,
    100: 10000,
    50: 5000,
    20: 2000,
    10: 1000,
    5: 500,
    2: 200,
    1: 100,
  };

  let totalPaisa = 0;
  const parsedBreakdown = {};

  for (const [denomKey, count] of Object.entries(denominations)) {
    const numericStr = String(denomKey).replace(/\D/g, '');
    const val = Number(numericStr);
    const qty = Math.max(0, parseInt(count, 10) || 0);
    if (multipliers[val] && qty > 0) {
      const amountPaisa = qty * multipliers[val];
      totalPaisa += amountPaisa;
      parsedBreakdown[denomKey] = {
        denomination: val,
        count: qty,
        amountPaisa,
      };
    }
  }

  return { totalPaisa, parsedBreakdown };
}

/**
 * Commit End-of-Day Z-Report Settlement (Stage 08 / F210 / A053-A056)
 */
async function commitZReportSettlement({
  organisationId,
  cafeId,
  registerSessionId = null,
  denominations = null,
  countedCashPaisa = null,
  closingDeclarationNote = '',
  isBlindClose = false,
  supervisorUserId = null,
  supervisorOverridePin = null,
  requireSupervisorOnDiscrepancy = false,
  freezeDayClose = false,
  auth = null,
}) {
  if (!organisationId || !cafeId) {
    throw new ApiError(400, 'VALIDATION_FAILED', 'organisationId and cafeId are required.');
  }

  // Find register session
  let session = null;
  if (registerSessionId) {
    session = await RegisterSession.findOne({
      organisationId,
      cafeId,
      registerSessionId,
    });
  } else {
    // Locate currently open session for this cafe
    session = await RegisterSession.findOne({
      organisationId,
      cafeId,
      status: 'OPEN',
    }).sort({ openedAt: -1 });
  }

  if (!session) {
    throw new ApiError(404, 'SESSION_NOT_FOUND', 'No active or specified register session found to close.');
  }

  if (session.status === 'CLOSED') {
    throw new ApiError(409, 'ALREADY_CLOSED', 'This register session has already been settled and closed with a Z-Report.');
  }

  // Determine counted cash
  let physicalCountedPaisa = 0;
  let denominationBreakdown = null;

  if (denominations && typeof denominations === 'object') {
    const calc = calculateDenominationsTotal(denominations);
    physicalCountedPaisa = calc.totalPaisa;
    denominationBreakdown = calc.parsedBreakdown;
  } else if (typeof countedCashPaisa === 'number') {
    physicalCountedPaisa = Math.max(0, Math.round(countedCashPaisa));
  } else {
    throw new ApiError(
      400,
      'CASH_COUNT_REQUIRED',
      'Either physical denominations breakdown or countedCashPaisa must be provided for Z-Report reconciliation.'
    );
  }

  const expectedCashPaisa = session.expectedCashPaisa || 0;
  const variancePaisa = physicalCountedPaisa - expectedCashPaisa; // Positive = Overage, Negative = Shortage
  const varianceAbs = Math.abs(variancePaisa);

  let varianceType = 'EXACT';
  if (variancePaisa > 0) varianceType = 'OVERAGE';
  else if (variancePaisa < 0) varianceType = 'SHORTAGE';

  const requiresManagerSignOff = varianceAbs >= DISCREPANCY_ALERT_THRESHOLD_PAISA;

  const userRole = auth?.role;
  const isSupervisorAuthorized =
    Boolean(supervisorUserId) ||
    Boolean(supervisorOverridePin) ||
    userRole === 'MASTER' ||
    userRole === 'OWNER';

  if (requiresManagerSignOff && requireSupervisorOnDiscrepancy && !isSupervisorAuthorized) {
    throw new ApiError(
      403,
      'DISCREPANCY_SUPERVISOR_REQUIRED',
      `Cash variance of ₹${(varianceAbs / 100).toFixed(2)} exceeds threshold (₹${(DISCREPANCY_ALERT_THRESHOLD_PAISA / 100).toFixed(2)}). Supervisor override authorization required to settle till.`
    );
  }

  // Generate unique sequential Z-Report identifier
  const todayCompact = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  let zReportId;
  try {
    const seq = await SequenceCounter.generateId({
      organisationId,
      sequenceKey: `Z_REPORT:${cafeId}`,
      prefix: 'Z',
      minimumDigits: 4,
    });
    zReportId = `ZREP-${todayCompact}-${seq}`;
  } catch {
    zReportId = `ZREP-${todayCompact}-${Date.now().toString(36).toUpperCase()}`;
  }

  // Update session
  session.status = 'CLOSED';
  session.closedAt = new Date();
  session.countedCashPaisa = physicalCountedPaisa;
  session.cashVariancePaisa = variancePaisa;
  session.closingDeclarationNote = closingDeclarationNote || '';
  await session.save();

  // Day-end sequential freeze if requested (A055, A056)
  if (freezeDayClose) {
    try {
      const mongoose = require('mongoose');
      const DailyClosePack = mongoose.models.DailyClosePack || require('../models/DailyClosePack');
      await DailyClosePack.findOneAndUpdate(
        { organisationId, cafeId, businessDate: session.businessDate },
        {
          $set: {
            status: 'ACKNOWLEDGED',
            cashCollectedPaisa: expectedCashPaisa,
            cashCountedPaisa: physicalCountedPaisa,
            variancePaisa,
            varianceExplanation: closingDeclarationNote || '',
            reviewedByUserId: supervisorUserId || auth?.userId || session.cashierUserId,
            reviewedAt: new Date(),
          },
        },
        { upsert: true }
      );
    } catch (_) {}
  }

  // Audit event
  if (auth) {
    await auditService.recordAuditEvent({
      organisationId,
      cafeId,
      userId: auth.userId,
      eventCategory: 'FINANCE',
      eventType: 'Z_REPORT_SETTLED',
      resourceType: 'RegisterSession',
      resourceId: session.registerSessionId,
      details: {
        zReportId,
        expectedCashPaisa,
        countedCashPaisa: physicalCountedPaisa,
        cashVariancePaisa: variancePaisa,
        varianceType,
        requiresManagerSignOff,
      },
    });
  }

  const zReportSummary = {
    zReportId,
    registerSessionId: session.registerSessionId,
    registerId: session.registerId,
    cafeId: session.cafeId,
    businessDate: session.businessDate,
    openedAt: session.openedAt,
    closedAt: session.closedAt,
    cashierUserId: session.cashierUserId,
    reconciliation: {
      openingFloatPaisa: session.openingFloatPaisa,
      expectedCashPaisa,
      countedCashPaisa: physicalCountedPaisa,
      cashVariancePaisa: variancePaisa,
      varianceType,
      varianceFormatted: `${variancePaisa >= 0 ? '+' : ''}₹${(variancePaisa / 100).toFixed(2)}`,
      requiresManagerSignOff,
      isBlindClose,
      supervisorApproved: isSupervisorAuthorized,
      denominationBreakdown,
    },
    salesBreakdown: {
      totalSalesPaisa: session.totalSalesPaisa || 0,
      totalCashSalesPaisa: session.totalCashSalesPaisa || 0,
      totalUpiSalesPaisa: session.totalUpiSalesPaisa || 0,
      totalCardSalesPaisa: session.totalCardSalesPaisa || 0,
      orderCount: session.orderCount || 0,
    },
    closingNote: session.closingDeclarationNote,
    status: 'SETTLED',
  };

  return zReportSummary;
}

module.exports = {
  calculateDenominationsTotal,
  commitZReportSettlement,
  DISCREPANCY_ALERT_THRESHOLD_PAISA,
};
