'use strict';

const { User, USER_ROLES, ACCOUNT_STATUSES } = require('../models/User');
const { Cafe } = require('../models/Cafe');
const { revokeAllUserSessions } = require('../services/authService');
const auditService = require('../services/auditService');
const { ApiError } = require('../utils/ApiError');

// ─── Identifier helpers ───────────────────────────────────────────────────────

function normalizeIdentifier(value) {
  return typeof value === 'string'
    ? value.trim().toUpperCase()
    : '';
}

function normalizeCafeIds(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return [
    ...new Set(
      value
        .filter((id) => typeof id === 'string' && id.trim())
        .map((id) => id.trim().toUpperCase())
    ),
  ];
}

// ─── Organisation-scoped actor loading ───────────────────────────────────────

/**
 * Load the authenticated actor from MongoDB using request.auth.
 * Throws USER_NOT_FOUND (404) when actor is no longer available.
 */
async function loadActor(request) {
  const actor = await User.findOne({
    organisationId: request.auth.organisationId,
    userId: request.auth.userId,
    accountStatus: 'ACTIVE',
  });

  if (!actor) {
    throw new ApiError(
      401,
      'ACTOR_UNAVAILABLE',
      'The authenticated actor could not be loaded.'
    );
  }

  return actor;
}

/**
 * Load a target user scoped to the actor's organisation.
 * Never reveals whether the user exists in another organisation.
 */
async function loadTarget(request, userId, { allowArchived = false } = {}) {
  const normalizedUserId = normalizeIdentifier(userId);

  const filter = {
    organisationId: request.auth.organisationId,
    userId: normalizedUserId,
  };

  if (!allowArchived) {
    filter.accountStatus = { $ne: 'ARCHIVED' };
  }

  const target = await User.findOne(filter);

  if (!target) {
    throw new ApiError(404, 'USER_NOT_FOUND', 'The user was not found.');
  }

  return target;
}

// ─── Primary Master verification ─────────────────────────────────────────────

/**
 * Verify that an actor (Mongoose document) is the current Primary Master.
 * Returns true/false — does NOT throw.
 */
function actorIsPrimaryMaster(actorDocument) {
  return actorDocument.isPrimaryMaster === true;
}

// ─── Primary Master protection ───────────────────────────────────────────────

/**
 * Countermeasure triggered when a secondary Master attempts an unauthorized
 * governance action against the Primary Master.
 *
 * Requirements:
 * 1. DO NOT modify the Primary Master.
 * 2. Suspend the attacking MASTER.
 * 3. Increment/revoke attacker session access (sessionVersion & permissionsVersion).
 * 4. Revoke all active attacker sessions.
 * 5. Record a CRITICAL audit event.
 * 6. Send CRITICAL security notifications to other Masters and Owners.
 * 7. Throw PRIMARY_MASTER_ATTACK_SUSPENDED (403).
 */
async function handlePrimaryMasterAttack({ request, actorDocument, target, operationDescription }) {
  if (!target.isPrimaryMaster || actorDocument.isPrimaryMaster) {
    return;
  }

  // 1. Suspend attacking MASTER
  actorDocument.accountStatus = 'SUSPENDED';
  actorDocument.statusReason = `PRIMARY_MASTER_PROTECTION_TRIGGERED: Attempted illegal action (${operationDescription}) on Primary Master`;
  actorDocument.primaryMasterProtectionSuspension = true;
  actorDocument.sessionVersion = (actorDocument.sessionVersion || 1) + 1;
  actorDocument.permissionsVersion = (actorDocument.permissionsVersion || 1) + 1;
  await actorDocument.save();

  // 2. Revoke all active attacker sessions
  try {
    if (request && request.auth) {
      await revokeAllUserSessions({
        organisationId: request.auth.organisationId,
        userId: actorDocument.userId,
        revokedBy: 'SYSTEM_SECURITY_COUNTERMEASURE',
        reason: 'PRIMARY_MASTER_ATTACK_SUSPENSION',
        details: `Session revoked automatically because actor attempted illegal action on Primary Master: ${operationDescription}`,
      });
    }
  } catch (_err) {}

  // 3. Record CRITICAL audit event
  try {
    if (request) {
      await auditService.recordRequestAudit({
        request,
        module: 'USER_GOVERNANCE',
        action: 'PRIMARY_MASTER_ATTACK_BLOCKED_AND_ACTOR_SUSPENDED',
        entityType: 'USER',
        entityId: actorDocument.userId,
        reason: operationDescription,
        result: 'SECURITY_COUNTERMEASURE',
        riskClassification: 'CRITICAL',
        metadata: {
          attackingUserId: actorDocument.userId,
          attackingUserName: actorDocument.name,
          targetPrimaryMasterUserId: target.userId,
          operationAttempted: operationDescription,
        },
      });
    }
  } catch (_err) {}

  // 4. Notify other Masters and Owners
  try {
    const { SequenceCounter } = require('../models/SequenceCounter');
    const { Notification } = require('../models/Notification');
    const orgId = actorDocument.organisationId || request?.auth?.organisationId;

    if (orgId) {
      const now = new Date();
      const datePart = now.toISOString().slice(0, 10).replaceAll('-', '');

      const recipients = await User.find({
        organisationId: orgId,
        $or: [
          { role: 'MASTER', isPrimaryMaster: true },
          { role: 'OWNER' },
        ],
        userId: { $ne: actorDocument.userId },
        accountStatus: 'ACTIVE',
      }).select('userId role');

      for (const recipient of recipients) {
        const notificationId = await SequenceCounter.generateId({
          organisationId: orgId,
          sequenceKey: `NOTIFICATION_${datePart}`,
          prefix: `NT-${datePart}`,
          minimumDigits: 4,
        });

        await Notification.create({
          notificationId,
          organisationId: orgId,
          recipientUserId: recipient.userId,
          recipientRole: recipient.role,
          eventType: 'PRIMARY_MASTER_ATTACK_PREVENTED',
          category: 'SECURITY',
          priority: 'CRITICAL',
          title: 'Primary Master Security Violation',
          message: `${actorDocument.name} (${actorDocument.userId}) attempted to remove the Primary Master and was suspended.`,
          channels: ['IN_APP', 'TOAST', 'POPUP'],
          status: 'DELIVERED',
          readStatus: 'UNREAD',
          createdBy: 'SYSTEM_SECURITY_COUNTERMEASURE',
        });
      }
    }
  } catch (_err) {}

  // 5. Throw 403 ApiError
  throw new ApiError(
    403,
    'PRIMARY_MASTER_ATTACK_SUSPENDED',
    `Critical security violation: ${actorDocument.name} (${actorDocument.userId}) attempted to remove the Primary Master and was suspended.`
  );
}

/**
 * Throw PRIMARY_MASTER_PROTECTED when the target is the Primary Master.
 * If actorDocument is a non-primary Master, triggers automated suspension countermeasure.
 */
function assertNotPrimaryMasterTarget(target, operationDescription, { request = null, actorDocument = null } = {}) {
  if (target && target.isPrimaryMaster) {
    if (actorDocument && !actorDocument.isPrimaryMaster) {
      handlePrimaryMasterAttack({
        request,
        actorDocument,
        target,
        operationDescription,
      }).catch((_err) => {});
    }

    throw new ApiError(
      403,
      'PRIMARY_MASTER_PROTECTED',
      `The Primary Master account cannot be modified: ${operationDescription}.`
    );
  }
}

/**
 * Enforce that only the Primary Master may restore an account suspended for attempting
 * to neutralize the Primary Master.
 */
function assertMayRestoreAccount(actorDocument, target) {
  if (
    target &&
    (target.primaryMasterProtectionSuspension === true ||
      (typeof target.statusReason === 'string' &&
        target.statusReason.includes('PRIMARY_MASTER_PROTECTION_TRIGGERED')))
  ) {
    if (!actorDocument.isPrimaryMaster) {
      throw new ApiError(
        403,
        'PRIMARY_MASTER_AUTHORITY_REQUIRED',
        'Only the Primary Master can restore an account suspended for attempting to neutralize the Primary Master.'
      );
    }
  }
}

/**
 * Throw MASTER_ROLE_GOVERNANCE_FORBIDDEN when a non-primary Master tries to
 * perform a governance action that only the Primary Master may do.
 */
function assertPrimaryMasterAuthority(actorDocument, operationDescription) {
  if (!actorDocument.isPrimaryMaster) {
    throw new ApiError(
      403,
      'PRIMARY_MASTER_AUTHORITY_REQUIRED',
      `Only the Primary Master may ${operationDescription}.`
    );
  }
}

/**
 * When the target is a MASTER, only the Primary Master actor may act.
 * Secondary Masters cannot change, suspend, archive or otherwise neutralize
 * another Master.
 */
function assertMayActOnMasterTarget(actorDocument, target) {
  if (target.role === 'MASTER' && !actorDocument.isPrimaryMaster) {
    throw new ApiError(
      403,
      'MASTER_ROLE_GOVERNANCE_FORBIDDEN',
      'Only the Primary Master may administer other MASTER accounts.'
    );
  }
}

// ─── Protected field validation ───────────────────────────────────────────────

const PROTECTED_USER_FIELDS = new Set([
  'userId',
  'organisationId',
  'organizationId',
  'role',
  'isPrimaryMaster',
  'primaryMasterDesignatedAt',
  'primaryMasterDesignatedBy',
  'primaryMasterDesignationReason',
  'roleHistory',
  'cafeAssignmentHistory',
  'previousNames',
  'employeeSearchTerms',
  'joiningDate',
  'employmentType',
  'department',
  'designation',
  'address',
  'emergencyContact',
  'sessionVersion',
  'permissionsVersion',
  'passwordHash',
  'password',
  'mfa',
  'mfaEnabled',
  'mfaMethod',
  'mfaSecretEncrypted',
  'recoveryCodeHashes',
  'passwordHistoryHashes',
  'failedLoginAttempts',
  'lockedUntil',
  'createdAt',
  'createdBy',
  'updatedAt',
  'archivedAt',
  'archivedBy',
  'status',
  'accountStatus',
  'vendorId',
]);

/**
 * Reject any protected fields present in the request body.
 * Exposes the field name only for non-secret fields.
 */
function rejectProtectedFields(body) {
  if (!body || typeof body !== 'object') {
    return;
  }

  for (const field of Object.keys(body)) {
    if (PROTECTED_USER_FIELDS.has(field)) {
      // Do not expose whether security-sensitive fields were present
      const safeToExpose = !field.match(
        /password|hash|mfa|secret|recovery|code/i
      );

      throw new ApiError(
        400,
        'PROTECTED_USER_FIELD',
        safeToExpose
          ? `The field "${field}" cannot be changed through the general update endpoint.`
          : 'A protected field was included in the request and cannot be updated.'
      );
    }
  }
}

// ─── Role validation ─────────────────────────────────────────────────────────

function validateProposedRole(proposedRole) {
  if (!USER_ROLES.includes(proposedRole)) {
    throw new ApiError(
      422,
      'INVALID_USER_ROLE',
      `The proposed role "${proposedRole}" is not valid. Supported roles: ${USER_ROLES.join(', ')}.`
    );
  }

  // Normal Master Decommission Invariant:
  // Non-primary Master is permanently retired; MASTER role cannot be assigned to another user.
  if (proposedRole === 'MASTER') {
    throw new ApiError(
      403,
      'ROLE_RETIRED_NORMAL_MASTER',
      'The Normal Master role is permanently retired. The MASTER role is exclusively reserved for Primary Master.'
    );
  }
}

function assertRoleIsNotNoOp(currentRole, proposedRole) {
  if (currentRole === proposedRole) {
    throw new ApiError(
      422,
      'ROLE_CHANGE_NO_OP',
      'The proposed role is the same as the current role. No change was made.'
    );
  }
}

// ─── Status validation ────────────────────────────────────────────────────────

function assertStatusIsNotNoOp(currentStatus, proposedStatus) {
  if (currentStatus === proposedStatus) {
    throw new ApiError(
      422,
      'USER_STATUS_NO_OP',
      'The proposed status is the same as the current status. No change was made.'
    );
  }
}

// ─── Café assignment validation ───────────────────────────────────────────────

/**
 * Validate that all proposed café IDs exist in the organisation and are not
 * archived. Cross-organisation cafés are rejected without revealing whether
 * they exist elsewhere.
 */
async function validateCafeIds(organisationId, cafeIds) {
  if (cafeIds.length === 0) {
    return;
  }

  const existingCount = await Cafe.countDocuments({
    organisationId,
    cafeId: { $in: cafeIds },
    status: { $ne: 'ARCHIVED' },
  });

  if (existingCount !== cafeIds.length) {
    throw new ApiError(
      400,
      'INVALID_CAFE_ASSIGNMENT',
      'One or more café IDs are invalid, archived or do not belong to this organisation.'
    );
  }
}

function assertCafeChangeIsNotNoOp(
  previousPrimaryCafeId,
  previousAssignedCafeIds,
  newPrimaryCafeId,
  newAssignedCafeIds
) {
  const prevPrimary = previousPrimaryCafeId || null;
  const newPrimary = newPrimaryCafeId || null;
  const prevAssigned = [...previousAssignedCafeIds].sort();
  const newAssigned = [...newAssignedCafeIds].sort();

  const sameAssigned =
    prevAssigned.length === newAssigned.length &&
    prevAssigned.every((id, i) => id === newAssigned[i]);

  if (prevPrimary === newPrimary && sameAssigned) {
    throw new ApiError(
      422,
      'CAFE_ASSIGNMENT_NO_OP',
      'The proposed café assignment is the same as the current assignment. No change was made.'
    );
  }
}

// ─── Stale-state / concurrency validation ────────────────────────────────────

/**
 * Reject stale executions where expected state no longer matches the target.
 */
function assertExpectedState(target, expected = {}) {
  const failures = [];

  if (
    expected.expectedCurrentRole !== undefined &&
    target.role !== expected.expectedCurrentRole
  ) {
    failures.push(
      `expectedCurrentRole "${expected.expectedCurrentRole}" does not match current "${target.role}"`
    );
  }

  if (
    expected.expectedSessionVersion !== undefined &&
    target.sessionVersion !== expected.expectedSessionVersion
  ) {
    failures.push(
      `expectedSessionVersion ${expected.expectedSessionVersion} does not match current ${target.sessionVersion}`
    );
  }

  if (
    expected.expectedPermissionsVersion !== undefined &&
    target.permissionsVersion !== expected.expectedPermissionsVersion
  ) {
    failures.push(
      `expectedPermissionsVersion ${expected.expectedPermissionsVersion} does not match current ${target.permissionsVersion}`
    );
  }

  if (failures.length > 0) {
    throw new ApiError(
      409,
      'USER_GOVERNANCE_PREVIEW_STALE',
      `The target user state has changed since the preview was generated: ${failures.join('; ')}.`
    );
  }
}

// ─── Role-impact preview calculation ─────────────────────────────────────────

function describeRolePermissions(role) {
  const descriptions = {
    MASTER: [
      'Organisation-wide access',
      'Full user administration',
      'Expense approval authority',
      'Audit log access',
      'Personal Ledger access',
      'All café access',
    ],
    OWNER: [
      'Organisation-wide reporting',
      'Café operations oversight',
      'Payroll visibility',
'Personal Ledger access',
      'No user administration',
      'No expense approval',
    ],
    CAFE_ADMIN: [
      'Assigned café operations',
      'Attendance management',
      'Cash management',
      'Limited to assigned cafés',
    ],
    STAFF: [
      'Own records only',
      'Clock-in/out',
      'View own payslips',
    ],
  };

  return descriptions[role] || [];
}

/**
 * Calculate the role-impact preview. Performs NO mutations.
 */
async function calculateRoleImpactPreview({
  request,
  actorDocument,
  target,
  proposedRole,
}) {
  const currentRole = target.role;

  // Count active sessions (informational — no revocation)
  const { Session } = require('../models/Session');
  let activeSessionCount = 0;

  try {
    activeSessionCount = await Session.countDocuments({
      organisationId: request.auth.organisationId,
      userId: target.userId,
      status: 'ACTIVE',
    });
  } catch (_err) {
    activeSessionCount = 0;
  }

  const willRevokeSession = true;
  const willChangePv = true;

  const warnings = [];

  if (proposedRole === 'MASTER') {
    warnings.push('Granting MASTER role gives organisation-wide authority.');
  }

  if (currentRole === 'MASTER' && proposedRole !== 'MASTER') {
    warnings.push('Revoking MASTER role removes organisation-wide authority.');
  }

  if (activeSessionCount > 0) {
    warnings.push(
      `${activeSessionCount} active session(s) will be revoked immediately on confirmation.`
    );
  }

  return {
    targetUserId: target.userId,
    targetName: target.name,
    isPrimaryMaster: target.isPrimaryMaster,
    currentRole,
    proposedRole,
    currentStatus: target.accountStatus,
    currentPrimaryCafeId: target.primaryCafeId || null,
    currentAssignedCafeIds: target.assignedCafeIds || [],
    currentSessionVersion: target.sessionVersion,
    currentPermissionsVersion: target.permissionsVersion,
    sessionsWillBeRevoked: willRevokeSession,
    sessionVersionWillChange: willRevokeSession,
    permissionsVersionWillChange: willChangePv,
    confirmationRequired: true,
    activeSessionCount,
    permissionsGained: describeRolePermissions(proposedRole).filter(
      (p) => !describeRolePermissions(currentRole).includes(p)
    ),
    permissionsLost: describeRolePermissions(currentRole).filter(
      (p) => !describeRolePermissions(proposedRole).includes(p)
    ),
    warnings,
  };
}

// ─── Role-history entry creation ──────────────────────────────────────────────

function buildRoleHistoryEntry({ fromRole, toRole, request, reason }) {
  return {
    fromRole: fromRole || undefined,
    toRole,
    changedAt: new Date(),
    changedBy: request.auth.userId,
    reason: (reason || '').trim(),
    correlationId: request.correlationId || null,
    sessionId: request.auth.sessionId || null,
  };
}

// ─── Café-assignment-history entry creation ───────────────────────────────────

function buildCafeAssignmentHistoryEntry({
  previousPrimaryCafeId,
  previousAssignedCafeIds,
  currentPrimaryCafeId,
  currentAssignedCafeIds,
  request,
  reason,
}) {
  return {
    previousPrimaryCafeId: previousPrimaryCafeId || null,
    previousAssignedCafeIds: previousAssignedCafeIds || [],
    primaryCafeId: currentPrimaryCafeId || null,
    assignedCafeIds: currentAssignedCafeIds || [],
    changedAt: new Date(),
    changedBy: request.auth.userId,
    reason: (reason || '').trim(),
    correlationId: request.correlationId || null,
    sessionId: request.auth.sessionId || null,
  };
}

// ─── Session revocation ───────────────────────────────────────────────────────

/**
 * Revoke all active sessions for the target. Returns count of revoked sessions.
 * Must only be called after a successful user document save.
 */
async function revokeTargetSessions({ request, target, reason }) {
  return revokeAllUserSessions({
    organisationId: request.auth.organisationId,
    userId: target.userId,
    revokedBy: request.auth.userId,
    reason,
    details: `Session revoked due to governance action: ${reason}.`,
  });
}

// ─── Audit helpers ────────────────────────────────────────────────────────────

function buildUserSnapshot(user) {
  return {
    userId: user.userId,
    role: user.role,
    accountStatus: user.accountStatus,
    primaryCafeId: user.primaryCafeId || null,
    assignedCafeIds: user.assignedCafeIds || [],
    isPrimaryMaster: user.isPrimaryMaster,
    sessionVersion: user.sessionVersion,
    permissionsVersion: user.permissionsVersion,
  };
}

async function auditGovernanceSuccess({
  request,
  action,
  target,
  before,
  after,
  reason,
  riskClassification = 'HIGH',
  metadata = {},
  session,
}) {
  try {
    await auditService.recordRequestAudit({
      request,
      module: 'USER_GOVERNANCE',
      action,
      entityType: 'USER',
      entityId: target.userId,
      before,
      after,
      reason,
      result: 'SUCCESS',
      riskClassification,
      metadata,
      session,
    });
  } catch (_err) {
    if (session) throw _err;
    // Audit failure is logged but must not mask the original success outside a transaction
  }
}

async function auditGovernanceDenied({
  request,
  action,
  targetUserId,
  reason,
  riskClassification = 'HIGH',
  metadata = {},
}) {
  try {
    await auditService.recordRequestAudit({
      request,
      module: 'USER_GOVERNANCE',
      action,
      entityType: 'USER',
      entityId: targetUserId || 'UNKNOWN',
      reason,
      result: 'DENIED',
      riskClassification,
      metadata,
    });
  } catch (_err) {
    // Audit failure is non-fatal for denied events
  }
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  normalizeIdentifier,
  normalizeCafeIds,
  loadActor,
  loadTarget,
  actorIsPrimaryMaster,
  assertNotPrimaryMasterTarget,
  handlePrimaryMasterAttack,
  assertMayRestoreAccount,
  assertPrimaryMasterAuthority,
  assertMayActOnMasterTarget,
  rejectProtectedFields,
  PROTECTED_USER_FIELDS,
  validateProposedRole,
  assertRoleIsNotNoOp,
  assertStatusIsNotNoOp,
  validateCafeIds,
  assertCafeChangeIsNotNoOp,
  assertExpectedState,
  calculateRoleImpactPreview,
  buildRoleHistoryEntry,
  buildCafeAssignmentHistoryEntry,
  revokeTargetSessions,
  buildUserSnapshot,
  auditGovernanceSuccess,
  auditGovernanceDenied,
};
