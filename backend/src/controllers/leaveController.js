'use strict';

/**
 * LEAVE CONTROLLER (EMP-SCR-004: MY LEAVE)
 *
 * Implements self-service leave management, policy resolution, balance calculation,
 * multi-day/partial-day preview, request submission, cancellation,
 * calendar and annual statements.
 * Strictly SELF-SERVICE ONLY for STAFF role.
 */

const mongoose = require('mongoose');
const { LeaveRequest, LEAVE_ENTITLEMENTS } = require('../models/LeaveRequest');
const { HolidayCalendar } = require('../models/HolidayCalendar');
const { ShiftRoster } = require('../models/ShiftRoster');
const { getWeekStartDate } = require('../services/shiftResolverService');
const { SequenceCounter } = require('../models/SequenceCounter');
const { asyncHandler } = require('../utils/asyncHandler');
const { ApiError } = require('../utils/ApiError');
const { recordRequestAudit } = require('../services/auditService');

function normalizeIdentifier(val) {
  return typeof val === 'string' ? val.trim().toUpperCase() : '';
}

// Statuses that hold balance (in flight, not yet approved).
const PENDING_LEAVE_STATUSES = ['PENDING', 'UNDER_REVIEW', 'RECOMMENDED'];

// Business dates are IST (UTC+05:30).
function currentIstDate() {
  return new Date(Date.now() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/**
 * Derives leave balances + summary from real request records against the
 * LEAVE_ENTITLEMENTS policy. Single query (YTD requests + any still-pending
 * request); shared by the balances endpoint, the leave preview and the
 * annual statement. Nothing is stored or seeded.
 */
async function deriveLeaveBalances({ organisationId, userId, year = currentIstDate().slice(0, 4) }) {
  if (!organisationId) {
    throw new ApiError(400, 'ORGANISATION_CONTEXT_REQUIRED', 'Organisation context is required.');
  }

  const yearStart = `${year}-01-01`;
  const yearEnd = `${year}-12-31`;
  let requests = [];
  if (mongoose.connection?.readyState === 1 || LeaveRequest.find !== mongoose.Model.find) {
    requests = await LeaveRequest.find({
      organisationId,
      userId,
      $or: [
        { startDate: { $gte: yearStart, $lte: yearEnd } },
        { status: { $in: PENDING_LEAVE_STATUSES } },
      ],
    }).lean();
  }

  const today = currentIstDate();
  const balances = {};
  const summary = {
    totalAvailable: 0,
    totalPending: 0,
    totalUsedYtd: 0,
    actionRequiredCount: 0,
    upcomingApprovedCount: 0,
  };

  for (const [leaveType, policy] of Object.entries(LEAVE_ENTITLEMENTS)) {
    let usedYtd = 0;
    let pending = 0;
    for (const request of requests) {
      if (request.leaveType !== leaveType) continue;
      const days = request.requestedDays || 0;
      if (request.status === 'APPROVED') {
        if (request.startDate >= yearStart && request.startDate <= yearEnd) usedYtd += days;
      } else if (PENDING_LEAVE_STATUSES.includes(request.status)) {
        pending += days;
      }
    }

    const available = Math.max(0, policy.totalEntitled - usedYtd - pending);
    balances[leaveType] = {
      leaveType,
      displayName: policy.displayName,
      available,
      pending,
      totalEntitled: policy.totalEntitled,
      accruedYtd: policy.totalEntitled,
      usedYtd,
      carryForward: 0, // prior-year balances are not tracked yet
      expiringSoon: 0, // no expiry ledger exists yet
      unit: 'DAYS',
      isPaid: policy.isPaid,
      isPayrollAffecting: !policy.isPaid,
    };
    summary.totalAvailable += available;
    summary.totalPending += pending;
    summary.totalUsedYtd += usedYtd;
  }

  for (const request of requests) {
    if (request.status === 'INFORMATION_REQUIRED') summary.actionRequiredCount += 1;
    if (request.status === 'APPROVED' && (request.endDate || request.startDate) >= today) {
      summary.upcomingApprovedCount += 1;
    }
  }

  return { balances, summary, requests };
}

// 1. GET /api/v1/leave/balances
const getLeaveBalances = asyncHandler(async (request, response) => {
  const { organisationId, userId } = request.auth;
  const { balances, summary } = await deriveLeaveBalances({ organisationId, userId });

  return response.status(200).json({
    success: true,
    data: {
      userId,
      balances,
      summary,
    },
    correlationId: request.correlationId || null,
  });
});

// 2. GET /api/v1/leave/types
const getLeaveTypes = asyncHandler(async (request, response) => {
  const types = [
    {
      code: 'CASUAL',
      name: 'Casual Leave',
      unit: 'DAYS',
      allowHalfDay: true,
      maxConsecutiveDays: 3,
      noticeDaysRequired: 2,
      requiresDocument: false,
      isPaid: true,
      description: 'For unforeseen personal matters, short family events or rest.',
    },
    {
      code: 'SICK',
      name: 'Sick Leave',
      unit: 'DAYS',
      allowHalfDay: true,
      maxConsecutiveDays: 7,
      noticeDaysRequired: 0,
      requiresDocument: true,
      documentNotice: 'Medical certificate required for leaves exceeding 2 consecutive days.',
      isPaid: true,
      description: 'For medical recovery, clinical appointments or health restoration.',
    },
    {
      code: 'EARNED',
      name: 'Earned / Privilege Leave',
      unit: 'DAYS',
      allowHalfDay: false,
      maxConsecutiveDays: 14,
      noticeDaysRequired: 7,
      requiresDocument: false,
      isPaid: true,
      description: 'Planned vacation or annual leave. Requires 7 days advance notice.',
    },
    {
      code: 'COMP_OFF',
      name: 'Compensatory Off',
      unit: 'DAYS',
      allowHalfDay: true,
      maxConsecutiveDays: 2,
      noticeDaysRequired: 1,
      requiresDocument: false,
      isPaid: true,
      description: 'Earned compensatory off for authorized non-working day shifts.',
    },
    {
      code: 'RESTRICTED_HOLIDAY',
      name: 'Restricted / Optional Holiday',
      unit: 'DAYS',
      allowHalfDay: false,
      maxConsecutiveDays: 1,
      noticeDaysRequired: 3,
      requiresDocument: false,
      isPaid: true,
      description: 'Optional cultural or regional festivals from approved list.',
    },
    {
      code: 'UNPAID',
      name: 'Leave Without Pay (Unpaid)',
      unit: 'DAYS',
      allowHalfDay: true,
      maxConsecutiveDays: 30,
      noticeDaysRequired: 3,
      requiresDocument: false,
      isPaid: false,
      isPayrollAffecting: true,
      description: 'Unpaid extended absence. Direct salary deduction applies for requested days.',
    },
  ];

  return response.status(200).json({
    success: true,
    data: { types },
    correlationId: request.correlationId || null,
  });
});

// 4. POST /api/v1/leave/calculate (Preview)
const calculateLeavePreview = asyncHandler(async (request, response) => {
  const { organisationId, userId, primaryCafeId, assignedCafeIds } = request.auth;
  const {
    leaveType = 'CASUAL',
    startDate,
    endDate,
    durationUnit = 'FULL_DAY',
    cafeId: rawCafe,
  } = request.body || {};

  if (!organisationId) {
    throw new ApiError(400, 'ORGANISATION_CONTEXT_REQUIRED', 'Organisation context is required.');
  }
  if (!startDate || !endDate) {
    throw new ApiError(400, 'DATES_REQUIRED', 'startDate and endDate are required.');
  }

  const start = new Date(startDate);
  const end = new Date(endDate);
  if (isNaN(start.getTime()) || isNaN(end.getTime())) {
    throw new ApiError(400, 'INVALID_DATES', 'Invalid date format.');
  }
  if (start > end) {
    throw new ApiError(400, 'INVALID_DATE_RANGE', 'startDate cannot be after endDate.');
  }

  const cafeId = normalizeIdentifier(rawCafe) || primaryCafeId || (assignedCafeIds && assignedCafeIds[0]) || '';

  const dateStrings = [];
  for (let curr = new Date(start); curr <= end; curr.setUTCDate(curr.getUTCDate() + 1)) {
    dateStrings.push(curr.toISOString().slice(0, 10));
  }

  // Real holidays from HolidayCalendar (org-wide, plus this cafe when known).
  const holidayFilter = { organisationId, isActive: true, date: { $in: dateStrings } };
  if (cafeId) holidayFilter.$or = [{ cafeId: null }, { cafeId }];
  else holidayFilter.cafeId = null;
  const holidayMap = new Map();
  const holidayQueryUsable = mongoose.connection?.readyState === 1
    || HolidayCalendar.find !== mongoose.Model.find;
  if (holidayQueryUsable) {
    try {
      for (const holiday of await HolidayCalendar.find(holidayFilter).lean()) {
        holidayMap.set(holiday.date, holiday.name);
      }
    } catch (_) {}
  }

  // Weekly off = a PUBLISHED roster exists for the week but has no assignment
  // for this user on that date. Without a roster context the day is charged.
  const rosterCache = new Map();
  async function isRosteredWeekOff(dateStr) {
    if (!cafeId) return false;
    const weekStartDate = getWeekStartDate(dateStr);
    const cacheKey = `${cafeId}|${weekStartDate}`;
    if (!rosterCache.has(cacheKey)) {
      let roster = null;
      const rosterQueryUsable = mongoose.connection?.readyState === 1
        || ShiftRoster.findOne !== mongoose.Model.findOne;
      if (rosterQueryUsable) {
        try {
          roster = await ShiftRoster.findOne({
            organisationId,
            cafeId,
            weekStartDate,
            status: 'PUBLISHED',
          }).lean();
        } catch (_) {
          roster = null;
        }
      }
      rosterCache.set(cacheKey, roster);
    }
    const roster = rosterCache.get(cacheKey);
    if (!roster) return false;
    return !(roster.assignments || []).some((a) => a.userId === userId && a.date === dateStr);
  }

  const dayBreakdown = [];
  let totalCharge = 0;
  let holidaysExcluded = 0;
  let weeklyOffsExcluded = 0;

  for (const dateStr of dateStrings) {
    if (holidayMap.has(dateStr)) {
      dayBreakdown.push({ date: dateStr, dayType: 'HOLIDAY', charge: 0, note: holidayMap.get(dateStr) });
      holidaysExcluded++;
    } else if (await isRosteredWeekOff(dateStr)) {
      dayBreakdown.push({ date: dateStr, dayType: 'WEEKLY_OFF', charge: 0, note: 'Rostered Weekly Off' });
      weeklyOffsExcluded++;
    } else {
      const charge = (durationUnit === 'FIRST_HALF' || durationUnit === 'SECOND_HALF') && start.getTime() === end.getTime() ? 0.5 : 1.0;
      dayBreakdown.push({ date: dateStr, dayType: 'SCHEDULED', charge, note: 'Working Shift' });
      totalCharge += charge;
    }
  }

  const { balances } = await deriveLeaveBalances({ organisationId, userId });
  const balanceBefore = balances[leaveType]?.available ?? 0;
  const projectedBalance = Math.max(0, balanceBefore - totalCharge);

  return response.status(200).json({
    success: true,
    data: {
      leaveType,
      startDate,
      endDate,
      durationUnit,
      calendarDays: dayBreakdown.length,
      holidaysExcluded,
      weeklyOffsExcluded,
      totalChargeableDays: totalCharge,
      balanceBefore,
      projectedBalance,
      isSufficientBalance: balanceBefore >= totalCharge || leaveType === 'UNPAID',
      dayBreakdown,
    },
    correlationId: request.correlationId || null,
  });
});

// 5. POST /api/v1/leave/requests (Apply)
const applyLeave = asyncHandler(async (request, response) => {
  const { organisationId, userId, assignedCafeIds } = request.auth;
  const {
    cafeId: rawCafe,
    leaveType = 'CASUAL',
    startDate,
    endDate,
    durationUnit = 'FULL_DAY',
    reason = '',
    attachmentUrl = null,
    attachmentName = null,
  } = request.body || {};

  const cafeId = normalizeIdentifier(rawCafe) || (assignedCafeIds && assignedCafeIds[0]) || request.auth.primaryCafeId;
  if (!cafeId) {
    throw new ApiError(400, 'CAFE_ID_REQUIRED', 'A café assignment is required to apply for leave.');
  }

  if (!startDate || !endDate) {
    throw new ApiError(400, 'DATES_REQUIRED', 'startDate and endDate are required.');
  }

  if (!reason.trim()) {
    throw new ApiError(400, 'REASON_REQUIRED', 'A mandatory reason for leave is required.');
  }

  const start = new Date(startDate);
  const end = new Date(endDate);
  if (start > end) {
    throw new ApiError(400, 'INVALID_DATE_RANGE', 'startDate cannot be after endDate.');
  }

  // Calculate requested days
  let diffDays = Math.round((end - start) / (1000 * 60 * 60 * 24)) + 1;
  if (durationUnit === 'FIRST_HALF' || durationUnit === 'SECOND_HALF') {
    diffDays = 0.5;
  }

  const dateKey = startDate.replace(/-/g, '');
  const leaveId = await SequenceCounter.generateId({
    organisationId,
    sequenceKey: 'LEAVE_REQUEST',
    prefix: `LR-${dateKey}`,
    minimumDigits: 3,
  });

  const leave = new LeaveRequest({
    leaveId,
    organisationId,
    cafeId,
    userId,
    leaveType,
    startDate,
    endDate,
    durationUnit,
    requestedDays: diffDays,
    reason: reason.trim(),
    attachmentUrl,
    attachmentName,
    status: 'PENDING',
  });

  await leave.save();

  await recordRequestAudit({
    request,
    module: 'LEAVE',
    action: 'LEAVE_REQUESTED',
    entityType: 'LeaveRequest',
    entityId: leave.leaveId,
    metadata: { userId, leaveId, leaveType, startDate, endDate, requestedDays: diffDays },
  });

  return response.status(201).json({
    success: true,
    message: 'Leave request submitted successfully.',
    data: { leave },
    correlationId: request.correlationId || null,
  });
});

// 6. GET /api/v1/leave/requests
const getMyLeaves = asyncHandler(async (request, response) => {
  const { organisationId, userId } = request.auth;
  const { status, year } = request.query;

  const filter = {
    organisationId,
    userId,
  };

  if (status && status !== 'ALL') {
    filter.status = status;
  }
  if (year) {
    filter.startDate = { $regex: `^${year}` };
  }

  const leaves = await LeaveRequest.find(filter).sort({ createdAt: -1 }).lean();

  return response.status(200).json({
    success: true,
    data: { leaves },
    correlationId: request.correlationId || null,
  });
});

// 7. GET /api/v1/leave/requests/:leaveId
const getLeaveDetail = asyncHandler(async (request, response) => {
  const { organisationId, userId } = request.auth;
  const { leaveId: rawLid } = request.params;
  const leaveId = normalizeIdentifier(rawLid);

  const leave = await LeaveRequest.findOne({
    leaveId,
    organisationId,
    userId,
  }).lean();

  if (!leave) {
    throw new ApiError(404, 'LEAVE_NOT_FOUND', 'Leave request not found.');
  }

  return response.status(200).json({
    success: true,
    data: { leave },
    correlationId: request.correlationId || null,
  });
});

// 8. POST /api/v1/leave/requests/:leaveId/withdraw
const withdrawLeave = asyncHandler(async (request, response) => {
  const { organisationId, userId } = request.auth;
  const { leaveId: rawLid } = request.params;
  const leaveId = normalizeIdentifier(rawLid);

  const leave = await LeaveRequest.findOne({
    leaveId,
    organisationId,
    userId,
  });

  if (!leave) {
    throw new ApiError(404, 'LEAVE_NOT_FOUND', 'Leave request not found.');
  }

  if (leave.status !== 'PENDING' && leave.status !== 'UNDER_REVIEW') {
    throw new ApiError(400, 'CANNOT_WITHDRAW', `Cannot withdraw request in ${leave.status} state.`);
  }

  leave.status = 'WITHDRAWN';
  await leave.save();

  await recordRequestAudit({
    request,
    module: 'LEAVE',
    action: 'LEAVE_WITHDRAWN',
    entityType: 'LeaveRequest',
    entityId: leave.leaveId,
    metadata: { userId, leaveId },
  });

  return response.status(200).json({
    success: true,
    message: 'Leave request withdrawn successfully.',
    data: { leave },
    correlationId: request.correlationId || null,
  });
});

// 9. POST /api/v1/leave/requests/:leaveId/cancel
const cancelLeave = asyncHandler(async (request, response) => {
  const { organisationId, userId } = request.auth;
  const { leaveId: rawLid } = request.params;
  const reason = request.body?.cancellationReason || request.body?.reason || '';
  const leaveId = normalizeIdentifier(rawLid);

  const leave = await LeaveRequest.findOne({
    leaveId,
    organisationId,
    userId,
  });

  if (!leave) {
    throw new ApiError(404, 'LEAVE_NOT_FOUND', 'Leave request not found.');
  }

  if (leave.status !== 'APPROVED') {
    throw new ApiError(400, 'CANNOT_CANCEL', 'Only approved leaves can have cancellation requested.');
  }

  leave.status = 'CANCELLATION_REQUESTED';
  leave.cancellationReason = reason.trim();
  leave.cancellationRequestedAt = new Date();
  await leave.save();

  await recordRequestAudit({
    request,
    module: 'LEAVE',
    action: 'LEAVE_CANCELLATION_REQUESTED',
    entityType: 'LeaveRequest',
    entityId: leave.leaveId,
    metadata: { userId, leaveId, reason },
  });

  return response.status(200).json({
    success: true,
    message: 'Leave cancellation requested for administrative approval.',
    data: { leave },
    correlationId: request.correlationId || null,
  });
});

// 10. GET /api/v1/leave/calendar
const getLeaveCalendar = asyncHandler(async (request, response) => {
  const { organisationId, userId, primaryCafeId, assignedCafeIds } = request.auth;
  if (!organisationId) {
    throw new ApiError(400, 'ORGANISATION_CONTEXT_REQUIRED', 'Organisation context is required.');
  }

  const monthParam = String(request.query.month || '').trim();
  const month = monthParam || currentIstDate().slice(0, 7);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    throw new ApiError(400, 'INVALID_MONTH', "month must be in 'YYYY-MM' format.");
  }

  const approvedLeaves = await LeaveRequest.find({
    organisationId,
    userId,
    status: { $in: ['APPROVED', 'PENDING'] },
    startDate: { $regex: `^${month}` },
  }).lean();

  const cafeId = primaryCafeId || (assignedCafeIds && assignedCafeIds[0]) || '';
  const holidayFilter = { organisationId, isActive: true, date: { $regex: `^${month}` } };
  if (cafeId) holidayFilter.$or = [{ cafeId: null }, { cafeId }];
  else holidayFilter.cafeId = null;

  let holidayDocs = [];
  if (mongoose.connection?.readyState === 1 || HolidayCalendar.find !== mongoose.Model.find) {
    try {
      holidayDocs = await HolidayCalendar.find(holidayFilter).lean();
    } catch (_) {}
  }

  return response.status(200).json({
    success: true,
    data: {
      month,
      userId,
      leaves: approvedLeaves,
      holidays: holidayDocs.map((h) => ({ date: h.date, name: h.name, type: h.type || 'NATIONAL' })),
    },
    correlationId: request.correlationId || null,
  });
});

// 11. GET /api/v1/leave/statement
const getLeaveStatement = asyncHandler(async (request, response) => {
  const { organisationId, userId } = request.auth;
  if (!organisationId) {
    throw new ApiError(400, 'ORGANISATION_CONTEXT_REQUIRED', 'Organisation context is required.');
  }

  const yearParam = String(request.query.year || '').trim();
  const year = yearParam || currentIstDate().slice(0, 4);
  if (!/^\d{4}$/.test(year)) {
    throw new ApiError(400, 'INVALID_YEAR', "year must be in 'YYYY' format.");
  }

  const requests = await LeaveRequest.find({
    organisationId,
    userId,
    startDate: { $regex: `^${year}` },
  }).sort({ startDate: -1 }).lean();

  const { balances, summary } = await deriveLeaveBalances({ organisationId, userId, year });

  return response.status(200).json({
    success: true,
    data: {
      year,
      userId,
      generatedAt: new Date().toISOString(),
      summary: {
        casualBalance: balances.CASUAL.available,
        sickBalance: balances.SICK.available,
        earnedBalance: balances.EARNED.available,
        totalUsedYtd: summary.totalUsedYtd,
      },
      requests,
    },
    correlationId: request.correlationId || null,
  });
});

module.exports = {
  getLeaveBalances,
  getLeaveTypes,
  calculateLeavePreview,
  applyLeave,
  getMyLeaves,
  getLeaveDetail,
  withdrawLeave,
  cancelLeave,
  getLeaveCalendar,
  getLeaveStatement,
};
