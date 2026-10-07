'use strict';

const {
  RolePermission,
} = require('../models/RolePermission');

const {
  logSecurityEvent,
  SECURITY_ACTIONS,
} = require('../services/securityLogger');

const ABSOLUTE_ROLE_RESTRICTIONS = {
  PERSONAL_LEDGER: ['MASTER', 'OWNER'],
  MASTER_AUDIT: ['MASTER'],
  MASTER_TRASH_BIN: ['MASTER'],
  MASTER_USER_ADMINISTRATION: ['MASTER'],
  OWNER_PORTAL: ['OWNER'],
  EXPENSE_DECISION: ['MASTER'],
  OVERTIME_FINAL_DECISION: ['MASTER'],
  CAFE_ADMIN_ASSIGNMENT: ['MASTER'],
  CAFE_LIFECYCLE: ['MASTER'],
};

function normalizeIdentifier(value) {
  if (typeof value !== 'string') {
    return null;
  }

  const normalizedValue =
    value.trim().toUpperCase();

  return normalizedValue || null;
}

function normalizePermissionCode(
  permissionCode
) {
  const normalizedCode =
    normalizeIdentifier(permissionCode);

  if (!normalizedCode) {
    throw new Error(
      'A permission code is required.'
    );
  }

  return normalizedCode;
}

function sendAuthorizationError(
  response,
  code,
  message,
  status = 403,
  request = null
) {
  try {
    logSecurityEvent({
      correlationId: request?.correlationId || null,
      organisationId: request?.auth?.organisationId || null,
      cafeId: request?.auth?.cafeId || request?.headers?.['x-cafe-id'] || null,
      actorId: request?.auth?.userId || null,
      action: SECURITY_ACTIONS.AUTHORIZATION_DENIED,
      targetType: 'API_ENDPOINT',
      targetId: request?.originalUrl || request?.url || null,
      outcome: 'DENIED',
      severity: status >= 500 ? 'ERROR' : 'WARN',
      metadata: { code, message, statusCode: status },
    });
  } catch (_) {}

  return response.status(status).json({
    error: {
      code,
      message,
    },
  });
}

function getRequestCafeId(
  request,
  cafeIdResolver = null
) {
  if (typeof cafeIdResolver === 'function') {
    return normalizeIdentifier(
      cafeIdResolver(request)
    );
  }

  return normalizeIdentifier(
    request.params?.cafeId ||
      request.body?.cafeId ||
      request.body?.sourceCafeId ||
      request.body?.destCafeId ||
      request.query?.cafeId ||
      request.get('x-cafe-id')
  );
}

function getTargetUserId(
  request,
  targetUserIdResolver = null
) {
  if (
    typeof targetUserIdResolver ===
    'function'
  ) {
    return normalizeIdentifier(
      targetUserIdResolver(request)
    );
  }

  return normalizeIdentifier(
    request.params?.userId ||
      request.body?.userId ||
      request.query?.userId
  );
}

function isAbsoluteRoleAllowed(
  role,
  restrictionKey
) {
  if (!restrictionKey) {
    return true;
  }

  const allowedRoles =
    ABSOLUTE_ROLE_RESTRICTIONS[
      restrictionKey
    ];

  if (!allowedRoles) {
    throw new Error(
      `Unknown absolute restriction: ${restrictionKey}`
    );
  }

  return allowedRoles.includes(role);
}

function canAccessCafe(
  auth,
  cafeId
) {
  if (!cafeId) {
    return false;
  }

  if (auth.role === 'MASTER' && auth.isPrimaryMaster === true) {
    return true;
  }

  const assignedCafeIds =
    auth.assignedCafeIds || [];

  return assignedCafeIds.includes(cafeId);
}

function ruleAppliesToRequest({
  rule,
  auth,
  cafeId,
  targetUserId,
}) {
  if (!rule.isCurrentlyEffective()) {
    return false;
  }

  switch (rule.scope) {
    case 'ORGANISATION':
      return (auth.role === 'MASTER' && auth.isPrimaryMaster === true) ||
        auth.role === 'OWNER';

    case 'ASSIGNED_CAFES':
      if (!cafeId) {
        return (auth.assignedCafeIds || []).length > 0;
      }
      return Boolean(
        cafeId &&
          canAccessCafe(auth, cafeId)
      );

    case 'CAFE':
      return Boolean(
        cafeId &&
          rule.cafeId === cafeId &&
          canAccessCafe(auth, cafeId)
      );

    case 'SELF':
      return Boolean(
        targetUserId &&
          targetUserId === auth.userId
      );

    case 'RECORD':
      return true;

    default:
      return false;
  }
}

function selectEffectiveDecision(
  applicableRules
) {
  const denyRule =
    applicableRules.find(
      (rule) => rule.effect === 'DENY'
    );

  if (denyRule) {
    return {
      allowed: false,
      rule: denyRule,
    };
  }

  const allowRule =
    applicableRules.find(
      (rule) => rule.effect === 'ALLOW'
    );

  if (allowRule) {
    return {
      allowed: true,
      rule: allowRule,
    };
  }

  return {
    allowed: false,
    rule: null,
  };
}

function enforceSensitiveRequirements({
  request,
  response,
  rule,
}) {
  if (
    rule.requiresMfa &&
    !request.auth.mfaVerified
  ) {
    sendAuthorizationError(
      response,
      'MFA_REQUIRED',
      'Multi-factor authentication is required for this action.',
      403,
      request
    );

    return false;
  }

  if (
    rule.requiresStepUpAuthentication ||
    rule.requiresReauthentication
  ) {
    const verifiedAt =
      request.auth.stepUpVerifiedAt;

    const maximumAgeMinutes =
      Number.parseInt(
        process.env
          .STEP_UP_AUTH_MAX_AGE_MINUTES ||
          '10',
        10
      );

    const verifiedTime =
      verifiedAt
        ? new Date(verifiedAt).getTime()
        : Number.NaN;

    const validUntil =
      verifiedTime +
      maximumAgeMinutes * 60 * 1000;

    if (
      Number.isNaN(verifiedTime) ||
      validUntil <= Date.now()
    ) {
      sendAuthorizationError(
        response,
        'STEP_UP_AUTHENTICATION_REQUIRED',
        'Recent authentication is required for this action.',
        403,
        request
      );

      return false;
    }
  }

  return true;
}

/**
 * requirePrimaryMaster — standalone middleware that ensures the authenticated
 * user is a MASTER with isPrimaryMaster === true. Normal Masters, Owners,
 * Admins, and Staff all receive 403 PRIMARY_MASTER_AUTHORITY_REQUIRED.
 */
function requirePrimaryMaster(
  request,
  response,
  next
) {
  if (
    !request.auth ||
    request.auth.role !== 'MASTER' ||
    !request.auth.isPrimaryMaster
  ) {
    return sendAuthorizationError(
      response,
      'PRIMARY_MASTER_AUTHORITY_REQUIRED',
      'This action requires Primary Master authority.',
      403,
      request
    );
  }

  return next();
}

/**
 * requirePrimaryMasterOrOwner — ensures the authenticated user is either
 * an OWNER, or a MASTER with isPrimaryMaster === true.
 * Non-primary Masters, Admins, and Staff all receive 403 REVENUE_SHARE_RESTRICTED.
 */
function requirePrimaryMasterOrOwner(
  request,
  response,
  next
) {
  if (!request.auth) {
    return sendAuthorizationError(
      response,
      'UNAUTHORIZED',
      'Authentication required.',
      401,
      request
    );
  }

  const isOwner = request.auth.role === 'OWNER';
  const isPrimaryMaster =
    request.auth.role === 'MASTER' &&
    request.auth.isPrimaryMaster === true;

  if (!isOwner && !isPrimaryMaster) {
    return sendAuthorizationError(
      response,
      'REVENUE_SHARE_RESTRICTED',
      'SCR-026 Revenue Share is visible and accessible exclusively to Primary Master and Owner.',
      403,
      request
    );
  }

  return next();
}

function authorize(
  permissionCode,
  {
    allowedRoles = null,
    allowedCapabilities = null,
    absoluteRestriction = null,
    requirePrimaryMaster: requiresPrimary = false,
    cafeIdResolver = null,
    targetUserIdResolver = null,
    cafeRequired = false,
    selfOnly = false,
  } = {}
) {
  if (Array.isArray(permissionCode)) {
    const roles = permissionCode.map((r) => String(r).toUpperCase());
    return async function roleOnlyMiddleware(request, response, next) {
      if (!request.auth) {
        return sendAuthorizationError(
          response,
          'AUTHENTICATION_REQUIRED',
          'Authentication is required.',
          401,
          request
        );
      }
      const authRole = String(request.auth.role).toUpperCase();
      if (authRole === 'MASTER' && !request.auth.isPrimaryMaster) {
        return sendAuthorizationError(
          response,
          'ROLE_RETIRED',
          'The Normal Master role has been permanently retired.',
          403,
          request
        );
      }
      const isMasterRole = (authRole === 'MASTER' || authRole === 'PRIMARY_MASTER') && Boolean(request.auth.isPrimaryMaster);
      const isRoleAllowed = roles.includes(authRole) || (roles.includes('MASTER') && isMasterRole);
      if (!isRoleAllowed) {
        return sendAuthorizationError(
          response,
          'PERMISSION_DENIED',
          'You do not have permission to perform this action.',
          403,
          request
        );
      }
      return next();
    };
  }

  const normalizedPermissionCode =
    normalizePermissionCode(
      permissionCode
    );

  return async function authorizationMiddleware(
    request,
    response,
    next
  ) {
    try {
      if (!request.auth) {
        return sendAuthorizationError(
          response,
          'AUTHENTICATION_REQUIRED',
          'Authentication is required.',
          401,
          request
        );
      }

      if (request.auth.role === 'MASTER' && !request.auth.isPrimaryMaster) {
        return sendAuthorizationError(
          response,
          'ROLE_RETIRED',
          'The Normal Master role has been permanently retired.',
          403,
          request
        );
      }

      if (request.auth.role === 'VENDOR') {
        if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
          return sendAuthorizationError(
            response,
            'VENDOR_READ_ONLY',
            'Vendor accounts have strictly read-only access to business records.',
            403,
            request
          );
        }
      }

      const auth = request.auth;
      const userCaps = Array.isArray(auth.capabilities) ? auth.capabilities : [];
      const hasMatchingCapability =
        Array.isArray(allowedCapabilities) &&
        allowedCapabilities.some((cap) => userCaps.includes(String(cap).trim().toUpperCase()));

      if (
        Array.isArray(allowedRoles) &&
        !allowedRoles.includes(auth.role) &&
        !hasMatchingCapability
      ) {
        return sendAuthorizationError(
          response,
          'ROLE_NOT_ALLOWED',
          'Your role is not permitted to perform this action.',
          403,
          request
        );
      }

      if (
        !isAbsoluteRoleAllowed(
          auth.role,
          absoluteRestriction
        )
      ) {
        return sendAuthorizationError(
          response,
          'ABSOLUTE_ROLE_RESTRICTION',
          'This action is permanently restricted to another role.',
          403,
          request
        );
      }

      if (
        (requiresPrimary || absoluteRestriction === 'PERSONAL_LEDGER') &&
        auth.role === 'MASTER' &&
        !auth.isPrimaryMaster
      ) {
        return sendAuthorizationError(
          response,
          'PRIMARY_MASTER_AUTHORITY_REQUIRED',
          'This action requires Primary Master authority.',
          403,
          request
        );
      }

      const cafeId = getRequestCafeId(
        request,
        cafeIdResolver
      );

      if (cafeRequired && !cafeId) {
        return sendAuthorizationError(
          response,
          'CAFE_SCOPE_REQUIRED',
          'A café scope is required for this action.',
          400,
          request
        );
      }

      if (
        cafeId &&
        !canAccessCafe(auth, cafeId)
      ) {
        return sendAuthorizationError(
          response,
          'CAFE_ACCESS_DENIED',
          'You do not have access to this café.',
          403,
          request
        );
      }

      const targetUserId =
        getTargetUserId(
          request,
          targetUserIdResolver
        );

      if (
        selfOnly &&
        targetUserId !== auth.userId
      ) {
        return sendAuthorizationError(
          response,
          'SELF_ACCESS_ONLY',
          'You may access only your own information.',
          403,
          request
        );
      }

      const rules =
        await RolePermission.findEffectiveRules(
          {
            organisationId:
              auth.organisationId,
            role: auth.role,
            cafeId,
            permissionCode:
              normalizedPermissionCode,
          }
        );

      const applicableRules =
        rules.filter((rule) =>
          ruleAppliesToRequest({
            rule,
            auth,
            cafeId,
            targetUserId,
          })
        );

      const decision =
        selectEffectiveDecision(
          applicableRules
        );

      if (!decision.allowed) {
        return sendAuthorizationError(
          response,
          'PERMISSION_DENIED',
          'You do not have permission to perform this action.',
          403,
          request
        );
      }

      if (
        !enforceSensitiveRequirements({
          request,
          response,
          rule: decision.rule,
        })
      ) {
        return;
      }

      request.authorization = {
        permissionCode:
          normalizedPermissionCode,
        permissionRuleId:
          decision.rule.permissionRuleId,
        scope: decision.rule.scope,
        cafeId,
        targetUserId,
        requiresReason:
          decision.rule.requiresReason,
        requiresAuditEvent:
          decision.rule
            .requiresAuditEvent,
        allowedFields:
          decision.rule.fieldAccess
            ?.allowedFields || [],
        deniedFields:
          decision.rule.fieldAccess
            ?.deniedFields || [],
        maskedFields:
          decision.rule.fieldAccess
            ?.maskedFields || [],
      };

      return next();
    } catch (error) {
      return response.status(500).json({
        error: {
          code:
            'AUTHORIZATION_CHECK_FAILED',
          message:
            'The permission check could not be completed.',
        },
      });
    }
  };
}

function requireReason(
  request,
  response,
  next
) {
  if (
    !request.authorization
      ?.requiresReason
  ) {
    return next();
  }

  const reason =
    typeof request.body?.reason ===
    'string'
      ? request.body.reason.trim()
      : '';

  if (!reason) {
    return response.status(400).json({
      error: {
        code: 'REASON_REQUIRED',
        message:
          'A reason is required for this action.',
      },
    });
  }

  if (reason.length > 2000) {
    return response.status(400).json({
      error: {
        code: 'REASON_TOO_LONG',
        message:
          'The reason must not exceed 2,000 characters.',
      },
    });
  }

  return next();
}

/**
 * requireVendor — ensures the authenticated user is a verified VENDOR account.
 * Rejects non-vendor users with 403 VENDOR_ACCESS_REQUIRED.
 * Enforces strict read-only boundary: rejects any mutation with 403 VENDOR_READ_ONLY.
 */
function requireVendor(request, response, next) {
  if (!request.auth) {
    return sendAuthorizationError(
      response,
      'AUTHENTICATION_REQUIRED',
      'Authentication is required.',
      401,
      request
    );
  }

  if (request.auth.role !== 'VENDOR' || !request.auth.vendorId) {
    return sendAuthorizationError(
      response,
      'VENDOR_ACCESS_REQUIRED',
      'This endpoint is exclusively accessible to verified Vendor accounts.',
      403,
      request
    );
  }

  if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
    return sendAuthorizationError(
      response,
      'VENDOR_READ_ONLY',
      'Vendor accounts have strictly read-only access to business records.',
      403,
      request
    );
  }

  return next();
}

module.exports = {
  ABSOLUTE_ROLE_RESTRICTIONS,
  authorize,
  requireReason,
  requirePrimaryMaster,
  requirePrimaryMasterOrOwner,
  requireVendor,
  canAccessCafe,
};