'use strict';
/**
 * CANONICAL GOVERNANCE AUTHORIZATION WRAPPER
 *
 * Delegates to canonical Zamorin authorization engine (backend/src/middleware/authorize.js).
 * Validates caller identity, normalizes canonical roles (MASTER/OWNER/CAFE_ADMIN),
 * evaluates cafe-scope access via canAccessCafe, and enforces strict deny-by-default.
 */
const { fail } = require('../utils/responses');
let canAccessCafe;
try {
  ({ canAccessCafe } = require('../../middleware/authorize'));
} catch (e) {
  // Fallback for standalone preview if canonical tree is detached
  canAccessCafe = (auth, cafeId) => {
    if (!auth) return false;
    if (auth.role === 'MASTER' || auth.role === 'OWNER') return true;
    if (auth.role === 'CAFE_ADMIN') return String(auth.assignedCafeId || auth.cafeId) === String(cafeId);
    return false;
  };
}

function resolveCallerFromRequest(req) {
  if (req.cafeOpsCaller) {
    return req.cafeOpsCaller;
  }
  if (process.env.NODE_ENV !== 'production' && req.headers && req.headers['x-mock-user-role']) {
    const isPrimary = req.headers['x-mock-user-is-primary'] === 'true' || req.headers['x-mock-user-role'] === 'MASTER_PRIMARY';
    const role = req.headers['x-mock-user-role'];
    return {
      employeeId: req.headers['x-mock-user-id'] || 'MOCK_GOVERNANCE_CALLER',
      userId: req.headers['x-mock-user-id'] || 'MOCK_GOVERNANCE_CALLER',
      role,
      canonicalRole: role === 'MASTER_PRIMARY' || role === 'MASTER_NORMAL' ? 'MASTER' : role,
      organisationId: req.headers['x-mock-org-id'] || 'ORG_ZAMORIN',
      isPrimaryMaster: isPrimary,
      assignedCafeId: req.headers['x-mock-cafe-id'] || null,
      cafeIds: req.headers['x-mock-cafe-ids'] ? req.headers['x-mock-cafe-ids'].split(',') : [],
      status: req.headers['x-mock-user-status'] || 'ACTIVE',
      rawAuth: {
        userId: req.headers['x-mock-user-id'] || 'MOCK_GOVERNANCE_CALLER',
        role: role === 'MASTER_PRIMARY' || role === 'MASTER_NORMAL' ? 'MASTER' : role,
        isPrimaryMaster: isPrimary,
        organisationId: req.headers['x-mock-org-id'] || 'ORG_ZAMORIN',
        status: req.headers['x-mock-user-status'] || 'ACTIVE',
      },
    };
  }
  if (req.auth) {
    const isPrimary = req.auth.isPrimaryMaster === true || req.auth.isPrimary === true;
    const role = req.auth.role === 'MASTER'
      ? (isPrimary ? 'MASTER_PRIMARY' : 'MASTER_NORMAL')
      : req.auth.role;
    return {
      employeeId: req.auth.userId || req.auth.id || req.auth._id,
      userId: req.auth.userId || req.auth.id || req.auth._id,
      role,
      canonicalRole: req.auth.role,
      organisationId: req.auth.organisationId,
      isPrimaryMaster: isPrimary,
      assignedCafeId: req.auth.assignedCafeId || req.auth.cafeId,
      cafeIds: req.auth.cafeIds || [],
      status: req.auth.status || 'ACTIVE',
      rawAuth: req.auth,
    };
  }
  if (req.authenticatedUser) {
    const isPrimary = req.authenticatedUser.isPrimaryMaster === true;
    const role = req.authenticatedUser.role === 'MASTER'
      ? (isPrimary ? 'MASTER_PRIMARY' : 'MASTER_NORMAL')
      : req.authenticatedUser.role;
    return {
      employeeId: req.authenticatedUser.userId || req.authenticatedUser._id,
      userId: req.authenticatedUser.userId || req.authenticatedUser._id,
      role,
      canonicalRole: req.authenticatedUser.role,
      organisationId: req.authenticatedUser.organisationId,
      isPrimaryMaster: isPrimary,
      assignedCafeId: req.authenticatedUser.assignedCafeId || req.authenticatedUser.cafeId,
      cafeIds: req.authenticatedUser.cafeIds || [],
      status: req.authenticatedUser.accountStatus || req.authenticatedUser.status || 'ACTIVE',
      rawAuth: req.authenticatedUser,
    };
  }
  if (req.user) {
    const isPrimary = req.user.isPrimaryMaster === true || req.user.role === 'MASTER_PRIMARY';
    return {
      employeeId: req.user.employeeId || req.user.userId || req.user.id || req.user._id,
      userId: req.user.employeeId || req.user.userId || req.user.id || req.user._id,
      role: req.user.role,
      canonicalRole: req.user.role === 'MASTER_PRIMARY' || req.user.role === 'MASTER_NORMAL' ? 'MASTER' : req.user.role,
      organisationId: req.user.organisationId,
      isPrimaryMaster: isPrimary,
      assignedCafeId: req.user.assignedCafeId || req.user.cafeId,
      cafeIds: req.user.cafeIds || [],
      status: req.user.status || 'ACTIVE',
      rawAuth: req.user,
    };
  }
  return null;
}

const KNOWN_GOVERNANCE_ROLES = new Set([
  'MASTER_PRIMARY',
  'MASTER',
  'OWNER',
  'CAFE_ADMIN',
]);

function requireGovernanceRole(...allowedRoles) {
  return function (req, res, next) {
    const caller = resolveCallerFromRequest(req);
    // 1. Deny missing caller
    if (!caller) {
      return fail(res, 401, 'UNAUTHORIZED', 'Authentication required for governance operations.');
    }

    // 2. Deny inactive or disabled user
    if (caller.status && caller.status !== 'ACTIVE') {
      return fail(res, 403, 'ACCOUNT_INACTIVE', 'User account is disabled or suspended.');
    }

    // 2b. Normal Master Decommission Invariant:
    // Non-primary Master is permanently retired. Deny access immediately.
    if (caller.role === 'MASTER_NORMAL' || (caller.canonicalRole === 'MASTER' && !caller.isPrimaryMaster)) {
      return fail(res, 403, 'ROLE_RETIRED', 'The Normal Master role has been permanently retired.');
    }

    // 3. Deny unknown or unprivileged roles (e.g. STAFF)
    if (!KNOWN_GOVERNANCE_ROLES.has(caller.role) && !KNOWN_GOVERNANCE_ROLES.has(caller.canonicalRole)) {
      return fail(res, 403, 'FORBIDDEN', 'Role is not authorized for governance operations.');
    }

    // 4. Match against allowedRoles specification
    const matchesRole = allowedRoles.some((allowed) => {
      if (allowed === caller.role) return true;
      if (allowed === caller.canonicalRole && caller.canonicalRole !== 'MASTER') return true;
      if (allowed === 'MASTER' && caller.isPrimaryMaster === true) return true;
      if (allowed === 'MASTER_PRIMARY' && caller.isPrimaryMaster === true) return true;
      return false;
    });

    if (!matchesRole) {
      return fail(res, 403, 'FORBIDDEN', 'You do not have access to this area.');
    }

    // 5. Enforce Cafe Scope intersection if a target cafeId is specified in request
    const targetCafeId = (req.query && req.query.cafeId) || (req.body && req.body.cafeId);
    if (targetCafeId && typeof canAccessCafe === 'function') {
      const authPayload = caller.rawAuth || {
        role: caller.canonicalRole,
        isPrimaryMaster: caller.isPrimaryMaster,
        assignedCafeId: caller.assignedCafeId,
        cafeIds: caller.cafeIds,
      };
      if (!canAccessCafe(authPayload, targetCafeId)) {
        return fail(res, 403, 'CAFE_ACCESS_DENIED', 'You do not have access to this café.');
      }
    }

    req.cafeOpsCaller = caller;
    next();
  };
}

module.exports = { requireGovernanceRole, resolveCallerFromRequest };

