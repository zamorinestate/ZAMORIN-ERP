'use strict';

/**
 * APPROVAL CONTROLLER
 */

const {
  Approval,
  APPROVAL_STATUSES,
} = require('../models/Approval');

const {
  SequenceCounter,
} = require('../models/SequenceCounter');

const {
  asyncHandler,
} = require('../utils/asyncHandler');

const {
  ApiError,
} = require('../utils/ApiError');

const {
  recordRequestAudit,
} = require('../services/auditService');

const { LeaveRequest } = require('../models/LeaveRequest');
const { Notification } = require('../models/Notification');
const { NotificationOutbox } = require('../models/NotificationOutbox');
const { User } = require('../models/User');
const { reconcileLeaveToAttendance } = require('../services/leaveReconciliationService');

function normalizeId(value) {
  return typeof value === 'string'
    ? value.trim().toUpperCase()
    : '';
}

function parsePositiveInteger(value, fallback, maximum) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, maximum);
}

const listApprovals = asyncHandler(async (request, response) => {
  const page = parsePositiveInteger(request.query.page, 1, 1000);
  const limit = parsePositiveInteger(request.query.limit, 25, 100);
  const skip = (page - 1) * limit;

  const filter = { organisationId: request.auth.organisationId };
  const { status } = request.query;

  if (status && APPROVAL_STATUSES.includes(status.toUpperCase())) {
    filter.status = status.toUpperCase();
  }

  if (!['MASTER', 'OWNER'].includes(request.auth.role)) {
    const assigned = Array.isArray(request.auth.assignedCafeIds)
      ? request.auth.assignedCafeIds
      : (request.auth.assignedCafeIds ? [request.auth.assignedCafeIds] : []);
    filter.cafeId = { $in: assigned };
  }

  const [approvals, total] = await Promise.all([
    Approval.find(filter)
      .select('-__v -version')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    Approval.countDocuments(filter),
  ]);

  return response.status(200).json({
    success: true,
    data: {
      approvals,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    },
    correlationId: request.correlationId || null,
  });
});

/**
 * Entity types whose approval decisions are absolutely restricted to MASTER.
 * These workflows have their own canonical controllers (expenseController,
 * attendanceController, etc.) that enforce MASTER-only decisions.
 * Allowing OWNER or CAFE_ADMIN to decide a generic Approval record tagged
 * with these types would create an audit-trail pollution risk.
 */
const PROTECTED_ENTITY_TYPES = new Set([
  'EXPENSE',
  'OVERTIME',
  'OVERTIME_DECISION',
  'PAYROLL',
  'PAYROLL_RUN',
  'PERSONAL_LEDGER',
  'USER_ADMINISTRATION',
]);

const decideApproval = asyncHandler(async (request, response) => {
  const approvalId = normalizeId(request.params.approvalId);
  const { decision, reason } = request.body; // APPROVED or REJECTED

  const targetDecision = normalizeId(decision);
  if (!['APPROVED', 'REJECTED'].includes(targetDecision)) {
    throw new ApiError(400, 'INVALID_DECISION', 'Decision must be APPROVED or REJECTED.');
  }

  const approval = await Approval.findOne({
    approvalId,
    organisationId: request.auth.organisationId,
  });

  if (!approval) {
    throw new ApiError(404, 'NOT_FOUND', 'Approval request not found.');
  }

  if (request.auth.role === 'OWNER') {
    throw new ApiError(
      403,
      'PERMISSION_DENIED',
      'Owner persona is read-only governance and cannot decide operational approvals.'
    );
  }

  if (approval.requestedByUserId && approval.requestedByUserId === request.auth.userId) {
    throw new ApiError(
      403,
      'SELF_APPROVAL_FORBIDDEN',
      'Staff cannot approve their own requests.'
    );
  }

  const assigned = Array.isArray(request.auth.assignedCafeIds)
    ? request.auth.assignedCafeIds
    : (request.auth.assignedCafeIds ? [request.auth.assignedCafeIds] : []);
  if (request.auth.role === 'CAFE_ADMIN' && (!approval.cafeId || !assigned.includes(approval.cafeId))) {
    throw new ApiError(
      403,
      'CAFE_ACCESS_DENIED',
      'You do not have access to decide this approval.'
    );
  }

  // Security: block non-MASTER roles from deciding approvals that belong to
  // MASTER-only protected workflows. These must be decided through their
  // canonical controller endpoints, not the generic approval route.
  if (
    PROTECTED_ENTITY_TYPES.has(approval.entityType) &&
    request.auth.role !== 'MASTER'
  ) {
    throw new ApiError(
      403,
      'PROTECTED_ENTITY_TYPE',
      `Approvals of type ${approval.entityType} must be decided through the ` +
      `canonical workflow endpoint by MASTER only. Use the appropriate module route.`
    );
  }

  // For protected entity types, Normal Master is also blocked — only Primary Master
  // has final authority over sensitive approval categories.
  if (
    PROTECTED_ENTITY_TYPES.has(approval.entityType) &&
    request.auth.role === 'MASTER' &&
    !request.auth.isPrimaryMaster
  ) {
    throw new ApiError(
      403,
      'PRIMARY_MASTER_AUTHORITY_REQUIRED',
      `Deciding approvals of type ${approval.entityType} requires Primary Master authority.`
    );
  }

  if (approval.status !== 'PENDING') {
    throw new ApiError(409, 'ALREADY_DECIDED', `Approval request is already ${approval.status}.`);
  }

  if (approval.entityType === 'LEAVE' || approval.entityType === 'LEAVE_REQUEST' || approval.entityType === 'LEAVE_CANCELLATION') {
    const isCancellation = approval.entityType === 'LEAVE_CANCELLATION';
    const leaveRequest = await LeaveRequest.findOne({
      organisationId: request.auth.organisationId,
      $or: [{ leaveId: approval.entityId }, { requestId: approval.entityId }],
    });
    if (leaveRequest) {
      if (leaveRequest.userId === request.auth.userId) {
        throw new ApiError(
          403,
          'SELF_APPROVAL_FORBIDDEN',
          'Staff cannot approve their own leave request.'
        );
      }

      if (targetDecision === 'APPROVED' && !isCancellation) {
        const currentYear = new Date().getFullYear();
        const yearStart = `${currentYear}-01-01`;
        const yearEnd = `${currentYear}-12-31`;

        const approvedLeaves = await LeaveRequest.find({
          organisationId: request.auth.organisationId,
          userId: leaveRequest.userId,
          leaveType: leaveRequest.leaveType,
          status: 'APPROVED',
          startDate: { $gte: yearStart, $lte: yearEnd },
        });

        const usedDays = approvedLeaves.reduce((sum, l) => sum + (l.requestedDays || 0), 0);
        const entitlement = leaveRequest.leaveType === 'CASUAL' ? 12.0 : (leaveRequest.leaveType === 'SICK' ? 10.0 : 15.0);
        if (leaveRequest.leaveType !== 'UNPAID' && (usedDays + (leaveRequest.requestedDays || 0)) > entitlement) {
          throw new ApiError(
            409,
            'INSUFFICIENT_LEAVE_BALANCE',
            `Approving this leave would exceed available annual entitlement (${entitlement} days).`
          );
        }
      }
    }
  }

  approval.status = targetDecision;
  approval.decidedByUserId = request.auth.userId;
  approval.decisionReason = typeof reason === 'string' ? reason.trim() : '';
  approval.decidedAt = new Date();

  await approval.save();

  if (approval.entityType === 'LEAVE' || approval.entityType === 'LEAVE_REQUEST' || approval.entityType === 'LEAVE_CANCELLATION') {
    try {
      const leaveRequest = await LeaveRequest.findOne({
        organisationId: request.auth.organisationId,
        $or: [{ leaveId: approval.entityId }, { requestId: approval.entityId }],
      });
      if (leaveRequest) {
        const isCancellation = approval.entityType === 'LEAVE_CANCELLATION';
        if (isCancellation) {
          leaveRequest.status = targetDecision === 'APPROVED' ? 'CANCELLED' : 'APPROVED';
          leaveRequest.cancellationDecision = targetDecision;
          leaveRequest.cancellationDecidedBy = request.auth.userId;
          leaveRequest.cancellationDecidedAt = new Date();
        } else {
          leaveRequest.status = targetDecision;
          leaveRequest.approvedBy = request.auth.userId;
          leaveRequest.approvedAt = new Date();
        }
        leaveRequest.decisionReason = typeof reason === 'string' ? reason.trim() : '';
        await leaveRequest.save();

        const reconcileAction = isCancellation
          ? (targetDecision === 'APPROVED' ? 'CANCEL' : 'NONE')
          : (targetDecision === 'APPROVED' ? 'APPROVE' : 'REJECT');

        if (reconcileAction !== 'NONE') {
          await reconcileLeaveToAttendance({
            organisationId: request.auth.organisationId,
            leaveRequest,
            action: reconcileAction,
            actorUserId: request.auth.userId,
          });
        }

        // Emit Employee Notification
        const eventType = isCancellation
          ? (targetDecision === 'APPROVED' ? 'LEAVE_CANCELLATION_APPROVED' : 'LEAVE_CANCELLATION_REJECTED')
          : (targetDecision === 'APPROVED' ? 'LEAVE_APPROVED' : 'LEAVE_REJECTED');

        const empUser = await User.findOne({
          organisationId: request.auth.organisationId,
          userId: leaveRequest.userId,
        }).select('email name').lean();

        const recipientEmail = empUser?.email || `${String(leaveRequest.userId).toLowerCase()}@zamorincafe.com`;
        const recipientName = empUser?.name || leaveRequest.userId;

        const outboxId = `OUT-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;
        await NotificationOutbox.create({
          outboxId,
          organisationId: request.auth.organisationId,
          eventType,
          recipientUserId: leaveRequest.userId,
          recipientEmail,
          recipientName,
          recipientRole: 'STAFF',
          templateId: 'LEAVE_STATUS_UPDATE',
          subject: `Leave Request ${leaveRequest.leaveId || approval.entityId}: ${isCancellation ? 'Cancellation ' + targetDecision : targetDecision}`,
          renderedSubject: `Leave Request ${leaveRequest.leaveId || approval.entityId}: ${isCancellation ? 'Cancellation ' + targetDecision : targetDecision}`,
          renderedBody: `Your leave request (${leaveRequest.startDate} to ${leaveRequest.endDate}) has been updated: ${targetDecision}.${leaveRequest.decisionReason ? ' Reason: ' + leaveRequest.decisionReason : ''}`,
          status: 'SENT',
          sentAt: new Date(),
        });

        const todayStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
        const notifId = `NT-${todayStr}-${Math.floor(1000 + Math.random() * 9000)}`;
        await Notification.create({
          notificationId: notifId,
          organisationId: request.auth.organisationId,
          eventType,
          category: 'OPERATIONS',
          recipientUserId: leaveRequest.userId,
          recipientRole: 'STAFF',
          recipientEmail,
          title: `Leave ${isCancellation ? 'Cancellation ' : ''}${targetDecision}`,
          message: `Your leave request for ${leaveRequest.startDate} to ${leaveRequest.endDate} was ${targetDecision.toLowerCase()}.`,
          priority: 'NORMAL',
          channels: ['IN_APP'],
          deepLink: `#staff-leave?requestId=${leaveRequest.leaveId || approval.entityId}`,
          sourceModule: 'LEAVE',
          sourceEntityType: approval.entityType,
          sourceEntityId: leaveRequest.leaveId || approval.entityId,
          deduplicationKey: `${leaveRequest.leaveId || approval.entityId}:${targetDecision}:${Date.now()}`,
          correlationId: request.correlationId || outboxId,
          createdBy: request.auth.userId || 'SYSTEM',
        });
      }
    } catch (_) {}
  }

  await recordRequestAudit({
    request,
    module: 'APPROVALS',
    action: 'DECIDE_APPROVAL',
    entityType: 'APPROVAL',
    entityId: approvalId,
    after: { status: targetDecision, reason: approval.decisionReason },
    result: 'SUCCESS',
    riskClassification: 'MEDIUM',
  });

  return response.status(200).json({
    success: true,
    data: { approval: approval.toObject() },
    correlationId: request.correlationId || null,
  });
});

module.exports = {
  listApprovals,
  decideApproval,
};
