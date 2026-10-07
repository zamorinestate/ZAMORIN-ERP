'use strict';

const {
  User,
  USER_ROLES,
  ACCOUNT_STATUSES,
} = require('../models/User');

const { Cafe } = require('../models/Cafe');

const {
  SequenceCounter,
} = require('../models/SequenceCounter');

const {
  hashPassword,
  revokeAllUserSessions,
} = require('../services/authService');

const {
  asyncHandler,
} = require('../utils/asyncHandler');

const {
  ApiError,
} = require('../utils/ApiError');

const { executeTransactionWithRetry } = require('../utils/transactionHelper');

const {
  normalizeIdentifier: govNormId,
  normalizeCafeIds: govNormCafes,
  loadActor,
  loadTarget,
  assertNotPrimaryMasterTarget,
  assertMayActOnMasterTarget,
  assertMayRestoreAccount,
  rejectProtectedFields,
  assertStatusIsNotNoOp,
  assertCafeChangeIsNotNoOp,
  validateCafeIds,
  buildCafeAssignmentHistoryEntry,
  buildUserSnapshot,
  revokeTargetSessions,
  auditGovernanceSuccess,
} = require('../services/userGovernanceService');

const ROLE_PREFIXES = {
  MASTER: 'MU',
  OWNER: 'OW',
  CAFE_ADMIN: 'AD',
  STAFF: 'ST',
};

function normalizeIdentifier(value) {
  return typeof value === 'string'
    ? value.trim().toUpperCase()
    : '';
}

function normalizeEmail(value) {
  return typeof value === 'string'
    ? value.trim().toLowerCase()
    : '';
}

function normalizeCafeIds(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return [
    ...new Set(
      value
        .filter(
          (cafeId) =>
            typeof cafeId === 'string' &&
            cafeId.trim()
        )
        .map((cafeId) =>
          cafeId.trim().toUpperCase()
        )
    ),
  ];
}

function requireMaster(request) {
  if (request.auth.role !== 'MASTER' || !request.auth.isPrimaryMaster) {
    throw new ApiError(
      403,
      'PRIMARY_MASTER_AUTHORITY_REQUIRED',
      'Only the Primary Master may perform this action.'
    );
  }
}

async function validateCafeAssignments({
  organisationId,
  assignedCafeIds,
  primaryCafeId,
}) {
  if (
    primaryCafeId &&
    !assignedCafeIds.includes(primaryCafeId)
  ) {
    throw new ApiError(
      400,
      'PRIMARY_CAFE_NOT_ASSIGNED',
      'The primary café must be included in the assigned cafés.'
    );
  }

  if (assignedCafeIds.length === 0) {
    return;
  }

  const existingCafeCount =
    await Cafe.countDocuments({
      organisationId,
      cafeId: {
        $in: assignedCafeIds,
      },
      status: {
        $ne: 'ARCHIVED',
      },
    });

  if (
    existingCafeCount !==
    assignedCafeIds.length
  ) {
    throw new ApiError(
      400,
      'INVALID_CAFE_ASSIGNMENT',
      'One or more assigned cafés are invalid.'
    );
  }
}

function buildUserFilter(request) {
  const filter = {
    organisationId:
      request.auth.organisationId,
  };

  if (request.auth.role === 'CAFE_ADMIN') {
    filter.assignedCafeIds = {
      $in:
        request.auth.assignedCafeIds || [],
    };
  }

  if (request.auth.role === 'STAFF') {
    filter.userId = request.auth.userId;
  }

  const role =
    normalizeIdentifier(request.query.role);

  if (role) {
    if (!USER_ROLES.includes(role)) {
      throw new ApiError(
        400,
        'INVALID_USER_ROLE',
        'The requested user role is invalid.'
      );
    }

    filter.role = role;
  }

  const accountStatus =
    normalizeIdentifier(
      request.query.accountStatus
    );

  if (accountStatus) {
    if (
      !ACCOUNT_STATUSES.includes(
        accountStatus
      )
    ) {
      throw new ApiError(
        400,
        'INVALID_ACCOUNT_STATUS',
        'The requested account status is invalid.'
      );
    }

    filter.accountStatus =
      accountStatus;
  }

  const cafeId =
    normalizeIdentifier(
      request.query.cafeId
    );

  if (cafeId) {
    if (
      request.auth.role !== 'MASTER' &&
      !request.auth.assignedCafeIds.includes(
        cafeId
      )
    ) {
      throw new ApiError(
        403,
        'CAFE_ACCESS_DENIED',
        'You do not have access to this café.'
      );
    }

    filter.assignedCafeIds = cafeId;
  }

  if (
    typeof request.query.search ===
      'string' &&
    request.query.search.trim()
  ) {
    const search =
      request.query.search.trim();

    filter.$or = [
      {
        name: {
          $regex: search,
          $options: 'i',
        },
      },
      {
        email: {
          $regex: search,
          $options: 'i',
        },
      },
      {
        userId: {
          $regex: search,
          $options: 'i',
        },
      },
      {
        phone: {
          $regex: search,
          $options: 'i',
        },
      },
    ];
  }

  return filter;
}

function ensureUserIsAccessible(
  request,
  user
) {
  if (
    request.auth.role === 'MASTER' ||
    request.auth.role === 'OWNER'
  ) {
    return;
  }

  if (
    user.userId === request.auth.userId
  ) {
    return;
  }

  if (
    request.auth.role === 'CAFE_ADMIN' &&
    user.assignedCafeIds.some(
      (cafeId) =>
        request.auth.assignedCafeIds.includes(
          cafeId
        )
    )
  ) {
    return;
  }

  throw new ApiError(
    403,
    'USER_ACCESS_DENIED',
    'You do not have access to this user.'
  );
}

const listUsers = asyncHandler(
  async (request, response) => {
    const users = await User.find(
      buildUserFilter(request)
    ).sort({
      name: 1,
      userId: 1,
    });

    return response.status(200).json({
      success: true,
      data: {
        users,
        count: users.length,
      },
      correlationId:
        request.correlationId || null,
    });
  }
);

const getUser = asyncHandler(
  async (request, response) => {
    const userId =
      normalizeIdentifier(
        request.params.userId
      );

    const user = await User.findOne({
      organisationId:
        request.auth.organisationId,
      userId,
    });

    if (!user) {
      throw new ApiError(
        404,
        'USER_NOT_FOUND',
        'The user was not found.'
      );
    }

    ensureUserIsAccessible(
      request,
      user
    );

    return response.status(200).json({
      success: true,
      data: {
        user,
      },
      correlationId:
        request.correlationId || null,
    });
  }
);

const createUser = asyncHandler(
  async (request, response) => {
    requireMaster(request);

    const {
      name,
      email,
      password,
      role,
      phone = '',
      preferredName = '',
      preferredLanguage = 'en',
    } = request.body || {};

    const normalizedEmail =
      normalizeEmail(email);

    const normalizedRole =
      normalizeIdentifier(role);

    if (
      typeof name !== 'string' ||
      !name.trim() ||
      !normalizedEmail ||
      typeof password !== 'string' ||
      !password ||
      !USER_ROLES.includes(
        normalizedRole
      )
    ) {
      throw new ApiError(
        400,
        'USER_FIELDS_REQUIRED',
        'Name, email, password and a valid role are required.'
      );
    }

    if (normalizedRole === 'MASTER') {
      throw new ApiError(
        403,
        'ROLE_RETIRED_NORMAL_MASTER',
        'The Normal Master role is permanently retired. The MASTER role is exclusively reserved for Primary Master.'
      );
    }

    const existingUser =
      await User.findOne({
        organisationId:
          request.auth.organisationId,
        email: normalizedEmail,
      });

    if (existingUser) {
      throw new ApiError(
        409,
        'EMAIL_ALREADY_EXISTS',
        'A user with this email already exists.'
      );
    }

    const assignedCafeIds =
      normalizeCafeIds(
        request.body.assignedCafeIds
      );

    const primaryCafeId =
      normalizeIdentifier(
        request.body.primaryCafeId
      ) || null;

    if (
      ['OWNER', 'CAFE_ADMIN', 'STAFF'].includes(
        normalizedRole
      ) &&
      assignedCafeIds.length === 0
    ) {
      throw new ApiError(
        400,
        'CAFE_ASSIGNMENT_REQUIRED',
        'Owner, Café Admin and Staff users require at least one café assignment.'
      );
    }

    await validateCafeAssignments({
      organisationId:
        request.auth.organisationId,
      assignedCafeIds,
      primaryCafeId,
    });

    const prefix =
      ROLE_PREFIXES[normalizedRole];

    const userId =
      await SequenceCounter.generateId({
        organisationId:
          request.auth.organisationId,
        sequenceKey:
          `USER_${normalizedRole}`,
        prefix,
        minimumDigits: 4,
      });

    const passwordHash =
      await hashPassword(password, { minLength: 15 });

    const reason =
      typeof request.body?.reason ===
        'string'
        ? request.body.reason.trim()
        : '';

    const user = await User.create({
      userId,
      organisationId:
        request.auth.organisationId,
      name: name.trim(),
      preferredName:
        typeof preferredName === 'string'
          ? preferredName.trim()
          : '',
      email: normalizedEmail,
      phone:
        typeof phone === 'string'
          ? phone.trim()
          : '',
      role: normalizedRole,
      accountStatus:
        'PENDING_ACTIVATION',
      primaryCafeId,
      assignedCafeIds,
      passwordHash,
      mustChangePassword: true,
      passwordChangedAt: new Date(),
      preferredLanguage:
        typeof preferredLanguage === 'string'
          ? preferredLanguage.trim() ||
            'en'
          : 'en',
      timezone: 'Asia/Kolkata',
      createdBy:
        request.auth.userId,
      updatedBy:
        request.auth.userId,
    });

    // Audit user creation (no secrets)
    try {
      await auditGovernanceSuccess({
        request,
        action: 'USER_CREATED',
        target: user,
        before: null,
        after: {
          userId: user.userId,
          role: user.role,
          accountStatus: user.accountStatus,
          email: user.email,
          name: user.name,
          primaryCafeId: user.primaryCafeId,
          assignedCafeIds: user.assignedCafeIds,
        },
        reason: reason || 'User created.',
        riskClassification: 'MEDIUM',
      });
    } catch (_err) {
      // Non-fatal
    }

    return response.status(201).json({
      success: true,
      message:
        'User created successfully.',
      data: {
        user,
      },
      correlationId:
        request.correlationId || null,
    });
  }
);

const updateUser = asyncHandler(
  async (request, response) => {
    requireMaster(request);

    // ── Reject protected fields first ──
    rejectProtectedFields(request.body);

    const userId =
      govNormId(
        request.params.userId
      );

    // Load actor freshly for governance checks
    const actorDocument = await loadActor(request);

    const user = await User.findOne({
      organisationId:
        request.auth.organisationId,
      userId,
      accountStatus: {
        $ne: 'ARCHIVED',
      },
    });

    if (!user) {
      throw new ApiError(
        404,
        'USER_NOT_FOUND',
        'The user was not found.'
      );
    }

    // Primary Master protection — no admin updates to PM
    await assertNotPrimaryMasterTarget(user, 'profile cannot be administratively modified', { request, actorDocument });

    // Secondary Master cannot modify another Master
    assertMayActOnMasterTarget(actorDocument, user);

    const allowedTextFields = [
      'name',
      'preferredName',
      'phone',
      'preferredLanguage',
    ];

    const beforeSnapshot = buildUserSnapshot(user);

    allowedTextFields.forEach(
      (field) => {
        if (
          typeof request.body?.[field] ===
          'string'
        ) {
          user[field] =
            request.body[field].trim();
        }
      }
    );

    if (
      typeof request.body?.email ===
      'string'
    ) {
      const email =
        normalizeEmail(
          request.body.email
        );

      if (!email) {
        throw new ApiError(
          400,
          'EMAIL_REQUIRED',
          'A valid email is required.'
        );
      }

      const duplicate =
        await User.findOne({
          organisationId:
            request.auth.organisationId,
          email,
          userId: {
            $ne: user.userId,
          },
        });

      if (duplicate) {
        throw new ApiError(
          409,
          'EMAIL_ALREADY_EXISTS',
          'A user with this email already exists.'
        );
      }

      user.email = email;
    }

    // ── Café assignment governance ──
    if (
      request.body?.assignedCafeIds !==
        undefined ||
      request.body?.primaryCafeId !==
        undefined
    ) {
      const newAssignedCafeIds =
        request.body.assignedCafeIds !==
        undefined
          ? govNormCafes(
              request.body.assignedCafeIds
            )
          : govNormCafes(user.assignedCafeIds);

      const newPrimaryCafeId =
        request.body.primaryCafeId !==
        undefined
          ? govNormId(
              request.body.primaryCafeId
            ) || null
          : user.primaryCafeId;

      // Primary Master café restriction is already blocked by assertNotPrimaryMasterTarget above

      if (
        ['CAFE_ADMIN', 'STAFF'].includes(
          user.role
        ) &&
        newAssignedCafeIds.length === 0
      ) {
        throw new ApiError(
          400,
          'CAFE_ASSIGNMENT_REQUIRED',
          'Café Admin and Staff users require at least one café assignment.'
        );
      }

      await validateCafeAssignments({
        organisationId:
          request.auth.organisationId,
        assignedCafeIds: newAssignedCafeIds,
        primaryCafeId: newPrimaryCafeId,
      });

      // No-op detection
      const previousPrimary = user.primaryCafeId;
      const previousAssigned = govNormCafes(user.assignedCafeIds);

      const normalizedPrev = [...previousAssigned].sort();
      const normalizedNew = [...newAssignedCafeIds].sort();
      const sameAssigned =
        normalizedPrev.length === normalizedNew.length &&
        normalizedPrev.every((id, i) => id === normalizedNew[i]);
      const samePrimary =
        (previousPrimary || null) === (newPrimaryCafeId || null);

      const cafeChanged = !sameAssigned || !samePrimary;

      if (cafeChanged) {
        const reason =
          typeof request.body?.reason === 'string'
            ? request.body.reason.trim()
            : '';

        // Append café assignment history
        const historyEntry = buildCafeAssignmentHistoryEntry({
          previousPrimaryCafeId: previousPrimary,
          previousAssignedCafeIds: previousAssigned,
          currentPrimaryCafeId: newPrimaryCafeId,
          currentAssignedCafeIds: newAssignedCafeIds,
          request,
          reason: reason || 'Café assignment updated.',
        });

        user.cafeAssignmentHistory.push(historyEntry);
        user.assignedCafeIds = newAssignedCafeIds;
        user.primaryCafeId = newPrimaryCafeId;
        user.sessionVersion += 1;
        user.permissionsVersion += 1;
      }
    }

    user.updatedBy =
      request.auth.userId;

    await user.save();

    const afterSnapshot = buildUserSnapshot(user);

    // Session revocation when café assignments changed
    const cafeVersionChanged =
      afterSnapshot.sessionVersion > beforeSnapshot.sessionVersion;

    let revokedCount = 0;

    if (cafeVersionChanged) {
      try {
        revokedCount = await revokeTargetSessions({
          request,
          target: user,
          reason: 'CAFE_ASSIGNMENT_CHANGED',
        });
      } catch (_err) {
        // Non-fatal
      }

      try {
        await auditGovernanceSuccess({
          request,
          action: 'USER_CAFE_ASSIGNMENT_CHANGED',
          target: user,
          before: beforeSnapshot,
          after: afterSnapshot,
          reason:
            typeof request.body?.reason === 'string'
              ? request.body.reason.trim()
              : 'Café assignment updated.',
          riskClassification: 'HIGH',
          metadata: { revokedSessionCount: revokedCount },
        });
      } catch (_err) {
        // Non-fatal
      }
    }

    return response.status(200).json({
      success: true,
      message:
        'User updated successfully.',
      data: {
        user,
      },
      correlationId:
        request.correlationId || null,
    });
  }
);

const changeUserStatus = asyncHandler(
  async (request, response) => {
    requireMaster(request);

    const userId =
      normalizeIdentifier(
        request.params.userId
      );

    const accountStatus =
      normalizeIdentifier(
        request.body?.accountStatus
      );

    if (
      !ACCOUNT_STATUSES.includes(
        accountStatus
      ) ||
      accountStatus === 'ARCHIVED'
    ) {
      throw new ApiError(
        400,
        'INVALID_ACCOUNT_STATUS',
        'The requested account status is invalid.'
      );
    }

    // Load actor freshly for governance checks
    const actorDocument = await loadActor(request);

    const user = await User.findOne({
      organisationId:
        request.auth.organisationId,
      userId,
      accountStatus: {
        $ne: 'ARCHIVED',
      },
    });

    if (!user) {
      throw new ApiError(
        404,
        'USER_NOT_FOUND',
        'The user was not found.'
      );
    }

    // Primary Master protection — PM must always remain ACTIVE
    await assertNotPrimaryMasterTarget(
      user,
      'status cannot be changed — Primary Master must remain ACTIVE',
      { request, actorDocument }
    );

    // Secondary Master cannot deactivate/suspend another Master
    assertMayActOnMasterTarget(actorDocument, user);

    // Check restoration authority for accounts suspended due to Primary Master security events
    assertMayRestoreAccount(actorDocument, user);

    // Self-deactivation protection
    if (
      user.userId ===
        request.auth.userId &&
      accountStatus !== 'ACTIVE'
    ) {
      throw new ApiError(
        400,
        'SELF_STATUS_CHANGE_BLOCKED',
        'You cannot deactivate your own MASTER account.'
      );
    }

    // No-op detection
    assertStatusIsNotNoOp(user.accountStatus, accountStatus);

    const beforeSnapshot = buildUserSnapshot(user);
    const accessRemoved = accountStatus !== 'ACTIVE';

    user.accountStatus =
      accountStatus;

    user.lockedUntil = null;
    user.failedLoginAttempts = 0;
    if (accountStatus === 'ACTIVE') {
      user.primaryMasterProtectionSuspension = false;
      user.statusReason = null;
    }

    if (accessRemoved) {
      user.sessionVersion += 1;
    }

    const afterSnapshot = buildUserSnapshot(user);

    const reason =
      typeof request.body?.reason === 'string'
        ? request.body.reason.trim()
        : `Status changed to ${accountStatus}.`;

    await executeTransactionWithRetry(async (session) => {
      await user.save(session ? { session } : {});

      await auditGovernanceSuccess({
        request,
        action: 'USER_STATUS_CHANGED',
        target: user,
        before: beforeSnapshot,
        after: afterSnapshot,
        reason,
        riskClassification: 'HIGH',
        metadata: {
          fromStatus: beforeSnapshot.accountStatus,
          toStatus: accountStatus,
        },
        session,
      });
    });

    let revokedCount = 0;

    if (accessRemoved) {
      try {
        revokedCount = await revokeAllUserSessions({
          organisationId:
            request.auth.organisationId,
          userId: user.userId,
          revokedBy:
            request.auth.userId,
          reason:
            accountStatus === 'LOCKED'
              ? 'ACCOUNT_LOCKED'
              : 'ACCOUNT_SUSPENDED',
          details:
            `User account status changed to ${accountStatus}.`,
        });
      } catch (_err) {
        // Non-fatal
      }
    }

    return response.status(200).json({
      success: true,
      message:
        'User status updated successfully.',
      data: {
        user,
      },
      correlationId:
        request.correlationId || null,
    });
  }
);

const archiveUser = asyncHandler(
  async (request, response) => {
    requireMaster(request);

    const userId =
      normalizeIdentifier(
        request.params.userId
      );

    const reason =
      typeof request.body?.reason ===
        'string'
        ? request.body.reason.trim()
        : '';

    if (!reason) {
      throw new ApiError(
        400,
        'ARCHIVE_REASON_REQUIRED',
        'An archive reason is required.'
      );
    }

    if (
      userId === request.auth.userId
    ) {
      throw new ApiError(
        400,
        'SELF_ARCHIVE_BLOCKED',
        'You cannot archive your own MASTER account.'
      );
    }

    // Load actor freshly for governance checks
    const actorDocument = await loadActor(request);

    const user = await User.findOne({
      organisationId:
        request.auth.organisationId,
      userId,
      accountStatus: {
        $ne: 'ARCHIVED',
      },
    });

    if (!user) {
      throw new ApiError(
        404,
        'USER_NOT_FOUND',
        'The user was not found.'
      );
    }

    // Primary Master protection
    await assertNotPrimaryMasterTarget(
      user,
      'Primary Master cannot be archived',
      { request, actorDocument }
    );

    // Secondary Master cannot archive another Master
    assertMayActOnMasterTarget(actorDocument, user);

    const beforeSnapshot = buildUserSnapshot(user);

    user.accountStatus = 'ARCHIVED';
    user.archivedAt = new Date();
    user.archivedBy =
      request.auth.userId;
    user.archiveReason = reason;
    user.sessionVersion += 1;
    user.updatedBy =
      request.auth.userId;

    const afterSnapshot = buildUserSnapshot(user);

    await executeTransactionWithRetry(async (session) => {
      await user.save(session ? { session } : {});

      await auditGovernanceSuccess({
        request,
        action: 'USER_ARCHIVED',
        target: user,
        before: beforeSnapshot,
        after: afterSnapshot,
        reason,
        riskClassification: 'HIGH',
        session,
      });
    });

    let revokedCount = 0;

    try {
      revokedCount = await revokeAllUserSessions({
        organisationId:
          request.auth.organisationId,
        userId: user.userId,
        revokedBy:
          request.auth.userId,
        reason: 'ADMIN_REVOKED',
        details:
          'The user account was archived.',
      });
    } catch (_err) {
      // Non-fatal
    }

    return response.status(200).json({
      success: true,
      message:
        'User archived successfully.',
      data: {
        user,
      },
      correlationId:
        request.correlationId || null,
    });
  }
);

module.exports = {
  listUsers,
  getUser,
  createUser,
  updateUser,
  changeUserStatus,
  archiveUser,
};