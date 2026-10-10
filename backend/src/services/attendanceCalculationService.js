'use strict';

/**
 * ATTENDANCE CALCULATION SERVICE
 * Authoritative, deterministic calculation engine for presence, breaks,
 * regular hours, shift-aware overtime, late arrival, and early departure.
 */

function calculateAttendanceMetrics({
  checkInAt = null,
  checkOutAt = null,
  breaks = [],
  scheduledStartAt = null,
  scheduledEndAt = null,
  scheduledDurationMinutes = null,
  gracePeriodMinutes = 15,
  approvedOvertimeMinutes = 0,
  deductUnclassifiedBreaks = true,
} = {}) {
  // Normalize break minutes, merge overlapping intervals, and track classifications
  let breakMinutes = 0;
  let paidBreakMinutes = 0;
  let unpaidBreakMinutes = 0;
  let unclassifiedBreakMinutes = 0;

  if (Array.isArray(breaks) && breaks.length > 0) {
    // Process break records, completing open breaks if checkOutAt is present
    const normalizedBreaks = breaks.map((b) => {
      let bStart = b.startedAt ? new Date(b.startedAt).getTime() : null;
      let effectiveEnd = b.endedAt || checkOutAt;
      let bEnd = effectiveEnd ? new Date(effectiveEnd).getTime() : null;

      let dur = typeof b.durationMinutes === 'number' && b.durationMinutes > 0
        ? b.durationMinutes
        : (bStart && bEnd && !isNaN(bStart) && !isNaN(bEnd) && bEnd > bStart
            ? Math.floor((bEnd - bStart) / 60000)
            : 0);

      if (!b.endedAt && effectiveEnd) {
        b.endedAt = typeof effectiveEnd === 'string' ? effectiveEnd : new Date(effectiveEnd).toISOString();
        b.durationMinutes = dur;
      }

      const isPaid = b.isPaid === true || b.isDeductible === false || b.breakType === 'PAID';
      const isExplicitUnpaid = b.isPaid === false || b.isDeductible === true || b.breakType === 'UNPAID';

      return {
        record: b,
        startMs: bStart && !isNaN(bStart) ? bStart : null,
        endMs: bEnd && !isNaN(bEnd) ? bEnd : null,
        durationMinutes: dur,
        isPaid,
        isExplicitUnpaid,
        isUnclassified: !isPaid && !isExplicitUnpaid,
      };
    });

    // Merge overlapping intervals for timestamp-based breaks to avoid double-deductions
    const timedBreaks = normalizedBreaks.filter((nb) => nb.startMs !== null && nb.endMs !== null && nb.endMs > nb.startMs);
    const untimedBreaks = normalizedBreaks.filter((nb) => nb.startMs === null || nb.endMs === null || nb.endMs <= nb.startMs);

    if (timedBreaks.length > 0) {
      timedBreaks.sort((a, b) => a.startMs - b.startMs);
      const mergedIntervals = [];
      let cur = { startMs: timedBreaks[0].startMs, endMs: timedBreaks[0].endMs };

      for (let i = 1; i < timedBreaks.length; i++) {
        const nextB = timedBreaks[i];
        if (nextB.startMs <= cur.endMs) {
          cur.endMs = Math.max(cur.endMs, nextB.endMs);
        } else {
          mergedIntervals.push(cur);
          cur = { startMs: nextB.startMs, endMs: nextB.endMs };
        }
      }
      mergedIntervals.push(cur);

      const mergedTimedMinutes = mergedIntervals.reduce((sum, inv) => sum + Math.floor((inv.endMs - inv.startMs) / 60000), 0);
      const untimedMinutes = untimedBreaks.reduce((sum, nb) => sum + nb.durationMinutes, 0);
      breakMinutes = mergedTimedMinutes + untimedMinutes;
    } else {
      breakMinutes = normalizedBreaks.reduce((sum, nb) => sum + nb.durationMinutes, 0);
    }

    for (const nb of normalizedBreaks) {
      if (nb.isPaid) {
        paidBreakMinutes += nb.durationMinutes;
      } else if (nb.isExplicitUnpaid) {
        unpaidBreakMinutes += nb.durationMinutes;
      } else {
        unclassifiedBreakMinutes += nb.durationMinutes;
      }
    }
  }

  // Deductible breaks: paid breaks are never deducted; unclassified breaks follow deductUnclassifiedBreaks policy
  let deductibleBreakMinutes = 0;
  if (paidBreakMinutes === 0) {
    deductibleBreakMinutes = (deductUnclassifiedBreaks || unpaidBreakMinutes > 0) ? breakMinutes : 0;
  } else {
    const rawDeductible = unpaidBreakMinutes + (deductUnclassifiedBreaks ? unclassifiedBreakMinutes : 0);
    deductibleBreakMinutes = Math.min(breakMinutes, Math.max(0, breakMinutes - paidBreakMinutes, rawDeductible));
  }

  // Determine scheduled duration
  let scheduledMinutes = typeof scheduledDurationMinutes === 'number' && scheduledDurationMinutes > 0
    ? scheduledDurationMinutes
    : null;

  if (!scheduledMinutes && scheduledStartAt && scheduledEndAt) {
    const sStart = new Date(scheduledStartAt).getTime();
    const sEnd = new Date(scheduledEndAt).getTime();
    if (!isNaN(sStart) && !isNaN(sEnd) && sEnd > sStart) {
      scheduledMinutes = Math.floor((sEnd - sStart) / 60000);
    }
  }

  if (!scheduledMinutes || scheduledMinutes <= 0) {
    scheduledMinutes = 8 * 60; // Standard 480 minutes (8h) default
  }

  const effectiveGrace = typeof gracePeriodMinutes === 'number' && gracePeriodMinutes >= 0
    ? gracePeriodMinutes
    : 15;

  let isLate = false;
  let lateMinutes = 0;
  if (checkInAt && scheduledStartAt) {
    const inTime = new Date(checkInAt).getTime();
    const schedStart = new Date(scheduledStartAt).getTime();
    if (!isNaN(inTime) && !isNaN(schedStart)) {
      const diff = Math.floor((inTime - schedStart) / 60000);
      if (diff > effectiveGrace) {
        isLate = true;
        lateMinutes = Math.max(0, diff);
      }
    }
  }

  let isEarlyExit = false;
  let earlyDepartureMinutes = 0;
  if (checkOutAt && scheduledEndAt) {
    const outTime = new Date(checkOutAt).getTime();
    const schedEnd = new Date(scheduledEndAt).getTime();
    if (!isNaN(outTime) && !isNaN(schedEnd)) {
      const diff = Math.floor((schedEnd - outTime) / 60000);
      if (diff > effectiveGrace) {
        isEarlyExit = true;
        earlyDepartureMinutes = Math.max(0, diff);
      }
    }
  }

  if (!checkInAt || !checkOutAt) {
    return {
      grossMinutes: 0,
      breakMinutes,
      totalWorkedMinutes: 0,
      regularMinutes: 0,
      detectedOvertimeMinutes: 0,
      approvedOvertimeMinutes: Number(approvedOvertimeMinutes) || 0,
      overtimeMinutes: Number(approvedOvertimeMinutes) || 0,
      isOvertime: false,
      isLate,
      lateMinutes,
      isEarlyExit,
      earlyDepartureMinutes,
      payableMinutes: 0,
      scheduledMinutes,
    };
  }

  const inTime = new Date(checkInAt).getTime();
  const outTime = new Date(checkOutAt).getTime();

  if (isNaN(inTime) || isNaN(outTime) || outTime <= inTime) {
    return {
      grossMinutes: 0,
      breakMinutes,
      totalWorkedMinutes: 0,
      regularMinutes: 0,
      detectedOvertimeMinutes: 0,
      approvedOvertimeMinutes: Number(approvedOvertimeMinutes) || 0,
      overtimeMinutes: Number(approvedOvertimeMinutes) || 0,
      isOvertime: false,
      isLate,
      lateMinutes,
      isEarlyExit,
      earlyDepartureMinutes,
      payableMinutes: 0,
      scheduledMinutes,
      scheduledDurationMinutes: scheduledMinutes,
    };
  }

  const grossMinutes = Math.max(0, Math.floor((outTime - inTime) / 60000));
  const totalWorkedMinutes = Math.max(0, grossMinutes - deductibleBreakMinutes);
  const regularMinutes = Math.min(totalWorkedMinutes, scheduledMinutes);
  const detectedOvertimeMinutes = Math.max(0, totalWorkedMinutes - scheduledMinutes);
  const approvedOT = Number(approvedOvertimeMinutes) || 0;

  return {
    grossMinutes,
    grossPresenceMinutes: grossMinutes,
    breakMinutes,
    paidBreakMinutes,
    unpaidBreakMinutes,
    unclassifiedBreakMinutes,
    deductibleBreakMinutes,
    breaks,
    totalWorkedMinutes,
    workedMinutes: totalWorkedMinutes,
    regularMinutes,
    detectedOvertimeMinutes,
    approvedOvertimeMinutes: approvedOT,
    overtimeMinutes: approvedOT || detectedOvertimeMinutes,
    overtimeStatus: detectedOvertimeMinutes > 0 ? 'PENDING_REVIEW' : 'NONE',
    isOvertime: detectedOvertimeMinutes > 0,
    isLate,
    lateMinutes,
    isEarlyExit,
    earlyDepartureMinutes,
    payableMinutes: totalWorkedMinutes,
    scheduledMinutes,
    scheduledDurationMinutes: scheduledMinutes,
    hasUnclassifiedBreaks: unclassifiedBreakMinutes > 0,
    workedMinutesQuality: unclassifiedBreakMinutes > 0 ? 'PARTIAL_SOURCE' : 'AVAILABLE',
    status: 'COMPLETED',
  };
}

module.exports = {
  calculateAttendanceMetrics,
};
