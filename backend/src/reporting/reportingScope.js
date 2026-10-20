'use strict';

/**
 * ZAMORIN CAFÉ ERP — REPORTING FOUNDATION
 * Module: reportingScope.js
 * 
 * Canonical Reporting Scope & Role Authorization Engine:
 * - Derives organisationId strictly from authenticated token context (JWT).
 * - Enforces role-based café authority:
 *   • PRIMARY MASTER: Organisation-wide portfolio by default, with optional explicit café filter.
 *   • OWNER: Strictly bound to assignedCafeIds; fails closed (403) on unassigned cafés or empty assignments.
 *   • CAFE_ADMIN: Bound strictly to assigned café; cross-café query returns 403.
 *   • STAFF: Denied access (403).
 * - Neutralizes IDOR and query-parameter tenant tampering.
 */

const { resolveEffectiveCafeScope } = require('../utils/cafeScope');


/**
 * Canonical Role Authority Matrix for Zamorin Reporting:
 * - PRIMARY_MASTER: Organisation-wide portfolio authority across all reports including HIGHLY_CONFIDENTIAL.
 * - NORMAL_MASTER: Organisation-wide operational authority across standard reports; restricted from executive governance/passbook targets.
 * - OWNER: Bound strictly to assignedCafeIds portfolio; can view multiple assigned cafés.
 * - CAFE_ADMIN: Bound strictly to assignedCafeIds portfolio (supports multi-branch admins outside POS device binding); cross-café queries to unassigned cafés prohibited.
 * - STAFF: Zero general / enterprise report access; authorized solely for defined self-service personal reports.
 */
const ROLE_AUTHORITY_MATRIX = {
  PRIMARY_MASTER: {
    authorityType: 'PRIMARY_MASTER',
    scope: 'ORGANISATION_WIDE_PORTFOLIO',
    multiCafe: true,
    enterpriseReports: true,
    highlyConfidential: true,
    selfServiceOnly: false,
  },
  OWNER: {
    authorityType: 'OWNER',
    scope: 'ASSIGNED_CAFES_PORTFOLIO',
    multiCafe: true,
    enterpriseReports: true,
    highlyConfidential: false,
    selfServiceOnly: false,
  },
  CAFE_ADMIN: {
    authorityType: 'CAFE_ADMIN',
    scope: 'ASSIGNED_CAFES_PORTFOLIO',
    multiCafe: true,
    enterpriseReports: true,
    highlyConfidential: false,
    selfServiceOnly: false,
  },
  STAFF: {
    authorityType: 'STAFF',
    scope: 'SELF_SERVICE_USER_ONLY',
    multiCafe: false,
    enterpriseReports: false,
    highlyConfidential: false,
    selfServiceOnly: true,
  },
};

/**
 * Resolves canonical scope for reporting requests.
 * @param {object} req - Express request object with req.auth
 * @param {object} [queryParams={}] - Query parameters { cafeId, organisationId }
 * @param {object|null} [reportDefinition=null] - Optional ReportRegistry definition for self-service evaluation
 * @returns {{ organisationId: string, cafeScope: string|object|null, isOrgWide: boolean, resolvedCafeId: string|null, authorityType: string }}
 */
function resolveReportScope(req, queryParamsOrReportDef = {}, maybeReportDefinition = null) {
  let queryParams = {};
  let reportDefinition = maybeReportDefinition;

  if (queryParamsOrReportDef && (queryParamsOrReportDef.allowSelfService !== undefined || queryParamsOrReportDef.reportId !== undefined || queryParamsOrReportDef.supportedRoles !== undefined)) {
    reportDefinition = queryParamsOrReportDef;
    queryParams = req?.query || {};
  } else {
    queryParams = queryParamsOrReportDef || {};
  }

  const auth = req?.auth;
  if (!auth || !auth.userId) {
    const err = new Error('Authentication required for report access.');
    err.statusCode = 401;
    err.code = 'AUTHENTICATION_REQUIRED';
    throw err;
  }

  // Tenant isolation: ALWAYS use auth.organisationId; NEVER trust browser params
  const organisationId = auth.organisationId;
  if (!organisationId) {
    const err = new Error('No organisation context associated with authenticated user.');
    err.statusCode = 403;
    err.code = 'ORGANISATION_REQUIRED';
    throw err;
  }

  const role = String(auth.role || '').toUpperCase();
  const isPrimaryMaster = auth.isPrimaryMaster === true;
  
  if (role === 'MASTER' && !isPrimaryMaster) {
    const err = new Error('The Normal Master persona has been permanently retired.');
    err.statusCode = 403;
    err.code = 'ROLE_RETIRED';
    throw err;
  }

  const isOwner = role === 'OWNER';
  const isCafeAdmin = role === 'CAFE_ADMIN';
  const isStaff = role === 'STAFF';

  const rawCafeParam = queryParams.cafeId !== undefined ? queryParams.cafeId : (req?.query?.cafeId !== undefined ? req.query.cafeId : null);
  const isAllCafes = typeof rawCafeParam === 'string' && rawCafeParam.trim().toUpperCase() === 'ALL';
  const requestedCafeId = (isAllCafes || !rawCafeParam) ? null : String(rawCafeParam).trim().toUpperCase();

  const rawCafes = [
    ...(Array.isArray(auth.assignedCafeIds) ? auth.assignedCafeIds : (auth.assignedCafeIds ? [auth.assignedCafeIds] : [])),
    ...(auth.primaryCafeId ? [auth.primaryCafeId] : []),
    ...(auth.cafeId ? [auth.cafeId] : []),
  ];
  const assignedCafeIds = [...new Set(rawCafes.filter(Boolean).map((c) => String(c).trim().toUpperCase()))];

  // Staff Scoping: Reject enterprise reports, allow self-service reports if declared in ReportRegistry
  if (isStaff) {
    const isAuthorizedSelfService = Boolean(
      reportDefinition &&
      reportDefinition.allowSelfService === true &&
      (!reportDefinition.supportedRoles || reportDefinition.supportedRoles.includes('STAFF'))
    );

    if (!isAuthorizedSelfService) {
      const err = new Error('Your role is not permitted to access enterprise reports.');
      err.statusCode = 403;
      err.code = 'ROLE_NOT_ALLOWED';
      throw err;
    }

    const boundCafe = auth.primaryCafeId || (assignedCafeIds.length > 0 ? assignedCafeIds[0] : null);
    return {
      organisationId,
      cafeScope: boundCafe,
      isOrgWide: false,
      resolvedCafeId: boundCafe,
      resolvedUserId: auth.userId,
      isSelfService: true,
      authorityType: 'STAFF',
      role,
    };
  }

  // Owner scoping: Strictly bound to assignedCafeIds portfolio
  if (isOwner) {
    if (assignedCafeIds.length === 0) {
      const err = new Error('Owner has no assigned café scope.');
      err.statusCode = 403;
      err.code = 'CROSS_CAFE_RESOURCE_DENIED';
      throw err;
    }

    if (requestedCafeId) {
      if (!assignedCafeIds.includes(requestedCafeId)) {
        const err = new Error(`Access denied to unassigned café ${requestedCafeId}.`);
        err.statusCode = 403;
        err.code = 'CROSS_CAFE_RESOURCE_DENIED';
        throw err;
      }
      return {
        organisationId,
        cafeScope: requestedCafeId,
        isOrgWide: false,
        resolvedCafeId: requestedCafeId,
        assignedCafeIds,
        authorityType: 'OWNER',
        role,
      };
    }

    // No café specified or "ALL" requested for Owner: aggregate authorized assigned cafés
    const cafeScope = assignedCafeIds.length === 1 ? assignedCafeIds[0] : { $in: assignedCafeIds };
    return {
      organisationId,
      cafeScope,
      isOrgWide: false,
      resolvedCafeId: assignedCafeIds.length === 1 ? assignedCafeIds[0] : null,
      assignedCafeIds,
      authorityType: 'OWNER',
      role,
    };
  }

  // Café Admin scoping: Scoped strictly to assignedCafeIds portfolio (one or more authorized cafés)
  if (isCafeAdmin) {
    if (assignedCafeIds.length === 0) {
      const err = new Error('Café Administrator has no assigned café.');
      err.statusCode = 403;
      err.code = 'CROSS_CAFE_RESOURCE_DENIED';
      throw err;
    }

    if (requestedCafeId) {
      if (!assignedCafeIds.includes(requestedCafeId)) {
        const err = new Error(`Café Administrator cannot access other café ${requestedCafeId}.`);
        err.statusCode = 403;
        err.code = 'CROSS_CAFE_RESOURCE_DENIED';
        throw err;
      }
      return {
        organisationId,
        cafeScope: requestedCafeId,
        isOrgWide: false,
        resolvedCafeId: requestedCafeId,
        assignedCafeIds,
        authorityType: 'CAFE_ADMIN',
        role,
      };
    }

    // When no specific café is requested or "ALL" is requested:
    // If single assigned café, bind directly; if multiple assigned cafés, filter using $in
    const cafeScope = assignedCafeIds.length === 1 ? assignedCafeIds[0] : { $in: assignedCafeIds };
    return {
      organisationId,
      cafeScope,
      isOrgWide: false,
      resolvedCafeId: assignedCafeIds.length === 1 ? assignedCafeIds[0] : null,
      assignedCafeIds,
      authorityType: 'CAFE_ADMIN',
      role,
    };
  }

  // Primary Master scoping
  if (isPrimaryMaster) {
    const authorityType = 'PRIMARY_MASTER';
    if (requestedCafeId) {
      return {
        organisationId,
        cafeScope: requestedCafeId,
        isOrgWide: false,
        resolvedCafeId: requestedCafeId,
        authorityType,
        role,
      };
    }
    // Default: organisation-wide
    return {
      organisationId,
      cafeScope: null,
      isOrgWide: true,
      resolvedCafeId: null,
      authorityType,
      role,
    };
  }

  // Fallback safe resolver using cafeScope.js
  const effective = resolveEffectiveCafeScope(req, requestedCafeId, assignedCafeIds);
  return {
    organisationId,
    cafeScope: effective,
    isOrgWide: !effective,
    resolvedCafeId: effective,
    role,
  };
}

/**
 * Builds standard MongoDB aggregation match criteria from scope and date boundaries.
 * @param {object} req
 * @param {{ dateFrom?: string, dateTo?: string, cafeId?: string }} [filters={}]
 * @returns {object} MongoDB $match object
 */
function buildBaseReportFilter(req, filters = {}) {
  const scope = resolveReportScope(req, filters);
  const match = { organisationId: scope.organisationId };

  if (scope.cafeScope) {
    match.cafeId = scope.cafeScope;
  }

  if (filters.dateFrom && filters.dateTo) {
    match.businessDate = filters.dateFrom === filters.dateTo
      ? filters.dateFrom
      : { $gte: filters.dateFrom, $lte: filters.dateTo };
  }

  return match;
}

module.exports = {
  ROLE_AUTHORITY_MATRIX,
  resolveReportScope,
  buildBaseReportFilter,
};
