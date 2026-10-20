'use strict';

/**
 * ATTENDANCE PAYROLL SUMMARY SERVICE (P1)
 * Generates a traceable Attendance summary snapshot for a given
 * employee + period. Used to populate Payslip.attendanceSummary.
 * Never silently alters a PAID or VOIDED PayrollRun.
 */

const mongoose = require('mongoose');
const { Attendance } = require('../modules/attendance/Attendance');
const { LeaveRequest } = require('../models/LeaveRequest');
const { HolidayCalendar } = require('../models/HolidayCalendar');
const { AttendancePeriod } = require('../models/AttendancePeriod');

/**
 * Returns all YYYY-MM-DD dates for a given YYYY-MM period.
 */
function getDatesForPeriod(periodKey) {
  const [year, month] = periodKey.split('-').map(Number);
  const dates = [];
  const daysInMonth = new Date(year, month, 0).getDate();
  for (let d = 1; d <= daysInMonth; d++) {
    const dd = String(d).padStart(2, '0');
    const mm = String(month).padStart(2, '0');
    dates.push(`${year}-${mm}-${dd}`);
  }
  return dates;
}

/**
 * Generate the Attendance summary for a single employee in a period.
 * @param {object} params
 * @param {string} params.organisationId
 * @param {string} params.cafeId
 * @param {string} params.userId
 * @param {string} params.periodKey    YYYY-MM
 * @returns {object} summary snapshot
 */
async function generateAttendanceSummary({ organisationId, cafeId, userId, periodKey }) {
  if (!/^\d{4}-\d{2}$/.test(periodKey)) {
    throw new Error(`Invalid periodKey: ${periodKey}. Expected YYYY-MM.`);
  }

  const dates = getDatesForPeriod(periodKey);
  const isDbReady = mongoose.connection?.readyState === 1;

  // 1. All Attendance records for the employee in this period
  const attendanceRecords = (isDbReady || Attendance.find !== mongoose.Model.find)
    ? await Attendance.find({
        organisationId,
        userId,
        businessDate: { $regex: `^${periodKey}` },
      }).lean()
    : [];

  const attendanceByDate = {};
  for (const rec of (attendanceRecords || [])) {
    attendanceByDate[rec.businessDate] = rec;
  }

  // 2. Approved leave requests overlapping this period
  const approvedLeave = (isDbReady || LeaveRequest.find !== mongoose.Model.find)
    ? await LeaveRequest.find({
        organisationId,
        userId,
        status: 'APPROVED',
        startDate: { $lte: `${periodKey}-31` },
        endDate: { $gte: `${periodKey}-01` },
      }).lean()
    : [];

  const leaveDateSet = new Set();
  const unpaidLeaveDateSet = new Set();
  for (const lr of (approvedLeave || [])) {
    const isPaid = lr.isPaid !== false; // default paid unless explicitly false
    const start = new Date(lr.startDate + 'T00:00:00.000Z');
    const end = new Date(lr.endDate + 'T00:00:00.000Z');
    const cur = new Date(start);
    while (cur <= end) {
      const ds = cur.toISOString().slice(0, 10);
      if (ds.startsWith(periodKey)) {
        if (isPaid) leaveDateSet.add(ds);
        else unpaidLeaveDateSet.add(ds);
      }
      cur.setUTCDate(cur.getUTCDate() + 1);
    }
  }

  // 3. Holidays for this period (org-wide and café-specific)
  const holidays = (isDbReady || HolidayCalendar.find !== mongoose.Model.find)
    ? await HolidayCalendar.find({
        organisationId,
        isActive: true,
        date: { $regex: `^${periodKey}` },
        $or: [{ cafeId: null }, { cafeId: cafeId }],
      }).lean()
    : [];

  const holidayDateSet = new Set((holidays || []).map((h) => h.date));

  // 4. Calculate summary
  const totalCalendarDays = dates.length;
  let presentDays = 0;
  let paidLeaveDays = 0;
  let unpaidLeaveDays = 0;
  let weeklyOffDays = 0;
  let holidayDays = 0;
  let absentDays = 0;
  let totalWorkedMinutes = 0;
  let overtimeMinutes = 0;

  for (const date of dates) {
    const rec = attendanceByDate[date];
    if (!rec) {
      // No record — check if it's a holiday or leave-only date
      if (holidayDateSet.has(date)) holidayDays++;
      else if (leaveDateSet.has(date)) paidLeaveDays++;
      else if (unpaidLeaveDateSet.has(date)) unpaidLeaveDays++;
      continue;
    }

    if (rec.totalWorkedMinutes) {
      totalWorkedMinutes += Number(rec.totalWorkedMinutes) || 0;
    }

    switch (rec.status) {
      case 'CHECKED_IN':
      case 'CHECKED_OUT':
      case 'MANUALLY_CORRECTED':
        presentDays++;
        break;
      case 'HALF_DAY':
        presentDays += 0.5;
        paidLeaveDays += 0.5;
        break;
      case 'ON_LEAVE':
        if (unpaidLeaveDateSet.has(date)) unpaidLeaveDays++;
        else paidLeaveDays++;
        break;
      case 'HOLIDAY':
        holidayDays++;
        break;
      case 'WEEKLY_OFF':
        weeklyOffDays++;
        break;
      case 'ABSENT':
      case 'MISSED_PUNCH':
        absentDays++;
        break;
      case 'NOT_SCHEDULED':
      default:
        break;
    }

    overtimeMinutes += rec.approvedOvertimeMinutes || 0;
  }

  // payableDays = present + paid leave + holidays + weekly off
  const payableDays = presentDays + paidLeaveDays + holidayDays + weeklyOffDays;

  return {
    periodKey,
    userId,
    cafeId,
    organisationId,
    totalCalendarDays,
    presentDays,
    absentDays,
    totalWorkedMinutes,
    paidLeaveDays,
    unpaidLeaveDays,
    weeklyOffDays,
    holidayDays,
    payableDays,
    overtimeMinutes,
    snapshotGeneratedAt: new Date().toISOString(),
    snapshotVersion: Date.now(),
  };
}

/**
 * Build the exact Payslip.attendanceSummary snapshot (the 8 schema fields)
 * for an employee + period, derived from real Attendance / Leave / Holiday data.
 * Used by payroll create/edit so attendance is server-derived, never client-typed.
 */
async function buildPayslipAttendanceSnapshot({
  organisationId,
  cafeId,
  userId,
  periodKey,
}) {
  const snapshot = await generateAttendanceSummary({
    organisationId,
    cafeId,
    userId,
    periodKey,
  });

  return {
    totalCalendarDays: snapshot.totalCalendarDays,
    presentDays: snapshot.presentDays,
    paidLeaveDays: snapshot.paidLeaveDays,
    unpaidLeaveDays: snapshot.unpaidLeaveDays,
    weeklyOffDays: snapshot.weeklyOffDays,
    holidayDays: snapshot.holidayDays,
    payableDays: snapshot.payableDays,
    overtimeMinutes: snapshot.overtimeMinutes,
  };
}

module.exports = {
  generateAttendanceSummary,
  buildPayslipAttendanceSnapshot,
  getDatesForPeriod,
};
