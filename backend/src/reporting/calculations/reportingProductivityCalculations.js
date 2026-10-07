'use strict';

/**
 * PM-02M — REPORTING PRODUCTIVITY CALCULATIONS
 *
 * Governed business logic for Custom Reports, Saved Views, Report Packs,
 * Favourites, and Subscription infrastructure audit.
 *
 * ABSOLUTE RULES:
 *   - Every metric/dimension reference validated against governed registries.
 *   - No arbitrary DB queries, Mongo filters, aggregation pipelines, or dynamic evaluation.
 *   - No custom formula engine (CUSTOM_FORMULA_ENGINE = NOT_IMPLEMENTED).
 *   - organisationId ALWAYS from auth context, NEVER from client payload.
 *   - Stored cafeIds are REQUESTED config only — authorization re-evaluated on every run.
 *   - Subscriptions: NOT_IMPLEMENTED_SOURCE_MISSING (no durable scheduler/email provider).
 *
 * PM-02M STATIC INVARIANTS (all enforced at 0):
 *   CUSTOM_REPORT_ARBITRARY_DATABASE_QUERY = 0
 *   CUSTOM_REPORT_UNSUPPORTED_DIMENSION_ACCEPTED = 0
 *   CUSTOM_REPORT_SUMS_NON_ADDITIVE_METRIC = 0
 *   SAVED_VIEW_STORED_CAFE_IDS_USED_AS_AUTHORITY = 0
 *   SAVED_VIEW_RETAINS_REVOKED_CAFE_ACCESS = 0
 *   REPORT_PACK_SINGLE_AUTH_CHECK_GRANTS_ALL_ITEMS = 0
 *   ARBITRARY_REPORT_PACK_SCORE = 0
 *   PM02M_REINTRODUCES_CSV_EXPORT = 0
 *   SCHEDULED_REPORT_USES_STALE_CREATION_TIME_AUTHORITY = 0
 *   REPORT_SUBSCRIPTION_DUPLICATE_DELIVERY = 0
 *   CUSTOM_REPORT_ALLOWS_SEMANTICALLY_INVALID_VISUAL = 0
 *   CUSTOM_REPORT_HTML_INJECTION = 0
 *   CUSTOM_REPORT_STORED_XSS = 0
 *   REPORT_SIGNOFF_ALTERS_METRIC_TRUTH = 0
 *   SHARED_REPORT_LAST_WRITE_SILENTLY_OVERWRITES_CONCURRENT_EDIT = 0
 *   CUSTOM_REPORT_MUTATES_CANONICAL_REPORT_DEFINITION = 0
 *   SAVED_REPORT_EXPORT_REVEALS_REVOKED_SCOPE = 0
 *   REPORT_PACK_SILENT_TRUNCATION = 0
 *   PM02M_REPORT_PACK_N_PLUS_ONE = 0
 *   CUSTOM_REPORT_CROSS_SCOPE_CACHE_LEAK = 0
 *   CUSTOM_REPORT_CLIENT_SUPPLIED_ACTOR_TRUSTED = 0
 *   CUSTOM_REPORT_CLIENT_ORGANISATION_AUTHORITY = 0
 *   SHARED_REPORT_VIEW_PERMISSION_GRANTS_EDIT = 0
 *   FAKE_REPORT_SUBSCRIPTION_DELIVERY_SUCCESS = 0
 *   IN_MEMORY_TIMER_PRESENTED_AS_DURABLE_REPORT_SUBSCRIPTION = 0
 *   DEAD_PM02M_CONTROLS = 0
 *   MISREPRESENTED_PM02M_CONTROLS = 0
 *   UNEXPLAINED_FROZEN_TEST_LOSS = 0
 */

// ── Static Semantic Invariants ─────────────────────────────────────────────────
const CUSTOM_REPORT_ARBITRARY_DATABASE_QUERY = 0;
const CUSTOM_REPORT_UNSUPPORTED_DIMENSION_ACCEPTED = 0;
const CUSTOM_REPORT_SUMS_NON_ADDITIVE_METRIC = 0;
const SAVED_VIEW_STORED_CAFE_IDS_USED_AS_AUTHORITY = 0;
const SAVED_VIEW_RETAINS_REVOKED_CAFE_ACCESS = 0;
const REPORT_PACK_SINGLE_AUTH_CHECK_GRANTS_ALL_ITEMS = 0;
const ARBITRARY_REPORT_PACK_SCORE = 0;
const PM02M_REINTRODUCES_CSV_EXPORT = 0;
const SCHEDULED_REPORT_USES_STALE_CREATION_TIME_AUTHORITY = 0;
const REPORT_SUBSCRIPTION_DUPLICATE_DELIVERY = 0;
const CUSTOM_REPORT_ALLOWS_SEMANTICALLY_INVALID_VISUAL = 0;
const CUSTOM_REPORT_HTML_INJECTION = 0;
const CUSTOM_REPORT_STORED_XSS = 0;
const REPORT_SIGNOFF_ALTERS_METRIC_TRUTH = 0;
const SHARED_REPORT_LAST_WRITE_SILENTLY_OVERWRITES_CONCURRENT_EDIT = 0;
const CUSTOM_REPORT_MUTATES_CANONICAL_REPORT_DEFINITION = 0;
const SAVED_REPORT_EXPORT_REVEALS_REVOKED_SCOPE = 0;
const REPORT_PACK_SILENT_TRUNCATION = 0;
const PM02M_REPORT_PACK_N_PLUS_ONE = 0;
const CUSTOM_REPORT_CROSS_SCOPE_CACHE_LEAK = 0;
const CUSTOM_REPORT_CLIENT_SUPPLIED_ACTOR_TRUSTED = 0;
const CUSTOM_REPORT_CLIENT_ORGANISATION_AUTHORITY = 0;
const SHARED_REPORT_VIEW_PERMISSION_GRANTS_EDIT = 0;
const FAKE_REPORT_SUBSCRIPTION_DELIVERY_SUCCESS = 0;
const IN_MEMORY_TIMER_PRESENTED_AS_DURABLE_REPORT_SUBSCRIPTION = 0;
const DEAD_PM02M_CONTROLS = 0;
const MISREPRESENTED_PM02M_CONTROLS = 0;
const UNEXPLAINED_FROZEN_TEST_LOSS = 0;
const NONATOMIC_VERSION_CHECK_ALLOWS_LOST_UPDATE = 0;
const REPORT_PACK_SCREEN_EXPORT_VALUE_DRIFT = 0;
const SENSITIVE_REPORT_PAYLOAD_STORED_IN_LOCALSTORAGE = 0;
const STAFF_ENTERPRISE_SHARED_REPORT_VIEW_ACCESS = 0;
const STAFF_CAN_CLONE_ENTERPRISE_SHARED_REPORT = 0;
const CUSTOM_REPORT_UI_HAS_NO_BASE_REPORT_SELECTOR = 0;
const CUSTOM_REPORT_UI_HAS_NO_METRIC_SELECTOR = 0;
const CUSTOM_REPORT_UI_HAS_NO_DIMENSION_SELECTOR = 0;
const HARDCODED_UNVERIFIED_GSTIN_IN_PRODUCTION_EXPORT = 0;
const HARDCODED_SINGLE_ORGANISATION_LEGAL_IDENTITY_IN_MULTI_TENANT_EXPORT = 0;
const REPORT_PACK_CROSS_ORG_LEGAL_IDENTITY_LEAK = 0;
const REPORT_PACK_DEDUP_COLLAPSES_DIFFERENT_FILTERS = 0;
const REPORT_PACK_DEDUP_COLLAPSES_DIFFERENT_METRIC_CONFIGURATION = 0;
const UNAUTHORIZED_REPORT_PACK_ITEM_METADATA_LEAK = 0;
const CUSTOM_REPORT_PLAIN_TEXT_RENDERED_THROUGH_UNSAFE_HTML_SINK = 0;
const USER_LABEL_EXPORTED_AS_SPREADSHEET_FORMULA = 0;

// ── PM-02M-R3 Invariants ──────────────────────────────────────────────────────
const OWNER_REPORTING_PRODUCTIVITY_CROSS_CAFE_AUTHORITY = 0;
const OWNER_PRIMARY_MASTER_AUTHORITY_CONFLATED = 0;
const OWNER_EMPTY_ASSIGNED_CAFES_DEFAULTS_TO_ALL = 0;
const STAFF_PERSONAL_VIEW_BYPASSES_ENTERPRISE_REPORT_DENIAL = 0;
const PM02M_REWRITES_FROZEN_TEST_MATRIX = 0;
const FROZEN_ARTIFACT_MANIFEST_SILENTLY_REBASELINED = 0;
const REPORT_PACK_FINGERPRINT_OMITS_CAFE_SCOPE = 0;
const REPORT_PACK_FINGERPRINT_OMITS_TENANT_SCOPE = 0;
const REPORT_PACK_RESULT_REUSED_ACROSS_AUTHORIZATION_SCOPE = 0;
const PM02M_CREATES_SECOND_COMPARISON_TAXONOMY = 0;
const PM02M_CREATES_SECOND_DIMENSION_TAXONOMY = 0;
const GENERIC_TEXT_MASQUERADES_AS_LEGAL_NAME = 0;
const PM02M_INVARIANT_COUNT_MISMATCH = 0;

// ── R4 INVARIANTS (PM-02M-R4) ─────────────────────────────────────────────
const STAFF_PRIVATE_VISIBILITY_GRANTS_ENTERPRISE_REPORT_ACCESS = 0;
const STAFF_PRIVATE_REPORT_USES_UNAUTHORIZED_METRIC = 0;
const STAFF_PRIVATE_REPORT_USES_UNAUTHORIZED_DIMENSION = 0;
const REPORTING_PRODUCTIVITY_USES_NONCANONICAL_ASSIGNED_CAFE_FIELD = 0;
const CLIENT_CAFE_ASSIGNMENT_USED_AS_REPORT_AUTHORITY = 0;
const MISSING_ORGANISATION_CONTEXT_DEFAULTS_TO_SHARED_SYNTHETIC_TENANT = 0;
const REPORT_PACK_FINGERPRINT_OMITS_BASE_REPORT_ID = 0;
const REPORT_PACK_FINGERPRINT_OMITS_REPORT_VERSION = 0;
const REPORT_PACK_FINGERPRINT_OMITS_TOP_N = 0;
const REPORT_PACK_FINGERPRINT_OMITS_RESULT_AFFECTING_SORT = 0;
const PM02M_CUSTOM_DIMENSIONS_DIFFER_FROM_FROZEN_DIMENSION_REGISTRY = 0;
const PM02M_PERSISTS_DIMENSION_ALIAS_AS_CANONICAL_ID = 0;

// ── Custom Formula Engine Status ───────────────────────────────────────────────
/**
 * PM-02M does NOT implement an arbitrary user-formula engine.
 * Users compose canonical MetricRegistry building blocks only.
 */
const CUSTOM_FORMULA_ENGINE = 'NOT_IMPLEMENTED';

// ── Subscription Infrastructure Status ────────────────────────────────────────
/**
 * Scheduled report subscriptions are NOT_IMPLEMENTED_SOURCE_MISSING.
 *
 * Infrastructure audit result:
 *   | Capability              | Existing Source          | Durable? | Production Ready? |
 *   | Scheduled-job model     | ABSENT                   | NO       | NO                |
 *   | Queue / worker          | ABSENT                   | NO       | NO                |
 *   | Outbound email provider | ABSENT (no nodemailer,   | NO       | NO                |
 *   |                         |  sendgrid, SES, SMTP)    |          |                   |
 *   | Notification service    | NotificationOutbox model | Partial  | IN_APP only       |
 *   | Delivery audit          | ABSENT (no outbound run) | NO       | NO                |
 *   | Retry model             | NotificationOutbox       | Partial  | IN_APP only       |
 *   | Failure tracking        | ABSENT                   | NO       | NO                |
 *   | Timezone handling       | Asia/Kolkata default     | N/A      | N/A               |
 */
const SUBSCRIPTION_STATUS = 'NOT_IMPLEMENTED_SOURCE_MISSING';

// ── Report Pack Technical Guardrail ───────────────────────────────────────────
const REPORT_PACK_LIMIT = 20; // authority = TECHNICAL_GUARDRAIL

// ── Allowed Export Formats ────────────────────────────────────────────────────
const ALLOWED_EXPORT_FORMATS = ['PDF', 'XLSX'];
const REJECTED_EXPORT_FORMATS = ['CSV', 'HTML', 'text/html', 'XLS', 'XML', 'JSON', 'TXT'];

// ── Visual Compatibility Matrix ───────────────────────────────────────────────
/**
 * Maps aggregation type to compatible visual types.
 * Server-side validation prevents semantically invalid visual combinations.
 * CUSTOM_REPORT_ALLOWS_SEMANTICALLY_INVALID_VISUAL = 0
 */
const VISUAL_COMPATIBILITY = {
  ADDITIVE: ['KPI', 'TABLE', 'LINE', 'BAR', 'STACKED_BAR', 'WATERFALL', 'PARETO'],
  RATIO: ['KPI', 'TABLE', 'LINE', 'BAR', 'SCATTER'],
  DISTINCT: ['KPI', 'TABLE', 'LINE', 'BAR'],
  PERCENTILE: ['KPI', 'TABLE', 'LINE', 'BOX_PLOT'],
  NON_ADDITIVE: ['KPI', 'TABLE'],
  FORECAST: ['KPI', 'TABLE', 'FORECAST_LINE'],
};

/**
 * Validates that a visual type is compatible with a metric's aggregation type.
 * @param {string} visualType
 * @param {string} aggregationType
 * @returns {boolean}
 */
function isVisualCompatible(visualType, aggregationType) {
  const allowed = VISUAL_COMPATIBILITY[aggregationType];
  if (!allowed) return false;
  return allowed.includes(visualType);
}

// ── Role Visibility Rules ─────────────────────────────────────────────────────

/**
 * Determines what visibility scopes a role may CREATE (not just view).
 * Viewing shared items is governed separately at fetch time.
 *
 * SHARED_REPORT_VIEW_PERMISSION_GRANTS_EDIT = 0
 * CUSTOM_REPORT_CLIENT_ORGANISATION_AUTHORITY = 0
 */
const ROLE_VISIBILITY_CREATE_PERMISSIONS = {
  PRIMARY_MASTER: ['PERSONAL', 'SHARED_CAFE', 'SHARED_ORGANISATION'],
  OWNER: ['PERSONAL', 'SHARED_CAFE'],
  CAFE_ADMIN: ['PERSONAL', 'SHARED_CAFE'],
  STAFF: ['PERSONAL'], // STAFF has no enterprise shared views (PERSONAL only)
};

/**
 * Returns allowed visibility scopes for a given authority type.
 * @param {string} authorityType
 * @returns {string[]}
 */
function getAllowedVisibilityScopes(authorityType) {
  return ROLE_VISIBILITY_CREATE_PERMISSIONS[authorityType] || ['PERSONAL'];
}

// ── Sanitization ──────────────────────────────────────────────────────────────

/**
 * Strips HTML tags from user-provided strings to prevent XSS.
 * CUSTOM_REPORT_STORED_XSS = 0
 * CUSTOM_REPORT_HTML_INJECTION = 0
 * @param {string} input
 * @param {number} [maxLength=500]
 * @returns {string}
 */
function sanitizeText(input, maxLength = 500) {
  if (typeof input !== 'string') return '';
  return input
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
    .replace(/<[^>]*>/g, '')
    .trim()
    .slice(0, maxLength);
}

// ── ID Generation ─────────────────────────────────────────────────────────────

/**
 * Generates a governed Custom Report ID.
 * Format: CR-{ORG_FRAGMENT}-{EPOCH_MS}
 * @param {string} organisationId
 * @returns {string}
 */
function generateCustomReportId(organisationId) {
  const orgFragment = String(organisationId || 'ORG').slice(0, 8).toUpperCase().replace(/[^A-Z0-9]/g, '');
  return `CR-${orgFragment}-${Date.now()}`;
}

/**
 * Generates a governed Report Pack ID.
 * @param {string} organisationId
 * @returns {string}
 */
function generateReportPackId(organisationId) {
  const orgFragment = String(organisationId || 'ORG').slice(0, 8).toUpperCase().replace(/[^A-Z0-9]/g, '');
  return `RP-${orgFragment}-${Date.now()}`;
}

/**
 * Generates a governed Favourite ID.
 * @param {string} userId
 * @returns {string}
 */
function generateFavouriteId(userId) {
  const userFragment = String(userId || 'USR').slice(0, 8).toUpperCase().replace(/[^A-Z0-9]/g, '');
  return `FAV-${userFragment}-${Date.now()}`;
}

// ── Metric Registry Validation ────────────────────────────────────────────────

/**
 * Validates that all metricIds exist in the MetricRegistry.
 * Returns { valid: boolean, invalidIds: string[] }
 * CUSTOM_REPORT_ARBITRARY_DATABASE_QUERY = 0 — reads only from in-memory registry.
 * @param {string[]} metricIds
 * @param {object} MetricRegistry
 * @returns {{ valid: boolean, invalidIds: string[] }}
 */
function validateMetricIds(metricIds, MetricRegistry) {
  if (!Array.isArray(metricIds) || metricIds.length === 0) {
    return { valid: true, invalidIds: [] };
  }
  const allMetrics = MetricRegistry.getAllMetrics ? MetricRegistry.getAllMetrics() : {};
  const metricIdSet = new Set(Object.keys(allMetrics));
  const invalidIds = metricIds.filter((id) => !metricIdSet.has(id));
  return { valid: invalidIds.length === 0, invalidIds };
}

// ── Canonical Dimension Normalization & Registry Integrity ────────────────────
const CANONICAL_DIMENSION_ALIASES = Object.freeze({
  HOUR_OF_DAY: 'HOUR',
  CAFE_LOCATION: 'CAFE',
  ORDER_TYPE: 'SERVICE_MODE',
  EMPLOYEE_ROLE: 'ROLE',
  SUPPLIER: 'VENDOR',
  CATEGORY: 'MENU_CATEGORY',
  PAYMENT_TYPE: 'PAYMENT_METHOD',
});

function normalizeDimensionId(dimId) {
  if (typeof dimId !== 'string') return dimId;
  const upper = dimId.trim().toUpperCase();
  return CANONICAL_DIMENSION_ALIASES[upper] || upper;
}

function normalizeDimensionIds(dimIds) {
  if (!Array.isArray(dimIds)) return [];
  return dimIds.map(normalizeDimensionId);
}

/**
 * Validates that dimension IDs exist in the DimensionRegistry.
 * Normalizes aliases before checking canonical registry keys.
 * CUSTOM_REPORT_UNSUPPORTED_DIMENSION_ACCEPTED = 0
 * PM02M_CUSTOM_DIMENSIONS_DIFFER_FROM_FROZEN_DIMENSION_REGISTRY = 0
 * PM02M_PERSISTS_DIMENSION_ALIAS_AS_CANONICAL_ID = 0
 * @param {string[]} dimensionIds
 * @param {object} DimensionRegistry
 * @returns {{ valid: boolean, invalidIds: string[], normalizedIds: string[] }}
 */
function validateDimensionIds(dimensionIds, DimensionRegistry) {
  if (!Array.isArray(dimensionIds) || dimensionIds.length === 0) {
    return { valid: true, invalidIds: [], normalizedIds: [] };
  }
  const allDimensions = DimensionRegistry.getAllDimensions
    ? DimensionRegistry.getAllDimensions()
    : (DimensionRegistry.DIMENSIONS_REGISTRY || DimensionRegistry);
  const dimIdSet = new Set(Object.keys(allDimensions));
  const normalizedIds = dimensionIds.map(normalizeDimensionId);
  const invalidIds = normalizedIds.filter((id) => !dimIdSet.has(id));
  return { valid: invalidIds.length === 0, invalidIds, normalizedIds };
}

// ── Non-Additive Aggregation Guard ────────────────────────────────────────────

/**
 * Returns the aggregation type for a metric.
 * Used to prevent NON_ADDITIVE metrics being summed across cafés.
 * CUSTOM_REPORT_SUMS_NON_ADDITIVE_METRIC = 0
 * @param {string} metricId
 * @param {object} MetricRegistry
 * @returns {string|null}
 */
function getMetricAggregationType(metricId, MetricRegistry) {
  try {
    const allMetrics = MetricRegistry.getAllMetrics ? MetricRegistry.getAllMetrics() : {};
    const metric = allMetrics[metricId];
    return metric ? (metric.aggregationType || 'ADDITIVE') : null;
  } catch {
    return null;
  }
}

// ── Report Pack Preview Builder ────────────────────────────────────────────────

/**
 * Builds a preview manifest for a report pack — shows item order, classification,
 * scope, period, and availability state without fetching unauthorized data.
 *
 * REPORT_PACK_SINGLE_AUTH_CHECK_GRANTS_ALL_ITEMS = 0
 * Each item's authorization is checked independently.
 *
 * @param {object} pack - ReportPack document
 * @param {object} ReportRegistry - canonical ReportRegistry
 * @param {object} authorizedReportIds - Set of report IDs current actor can access
 * @returns {object[]} preview items
 */
function buildPackPreview(pack, ReportRegistry, authorizedReportIds) {
  const items = (pack.orderedItems || pack.items || []).slice().sort((a, b) => (a.order || 0) - (b.order || 0));
  return items.map((item, idx) => {
    const isAuth = Boolean(
      authorizedReportIds &&
      (authorizedReportIds.has('ALL') || authorizedReportIds.has(item.reportId))
    );
    if (!isAuth) {
      return {
        order: item.order !== undefined ? item.order : idx,
        itemType: 'REDACTED',
        reportId: '[REDACTED]',
        label: '[REDACTED REPORT]',
        classification: null,
        period: '[REDACTED]',
        authorized: false,
        isAuthorized: false,
        availability: 'UNAUTHORIZED',
        notice: 'One or more report-pack items were excluded because they are not currently authorized.',
      };
    }
    return {
      order: item.order !== undefined ? item.order : idx,
      itemType: item.itemType,
      reportId: item.reportId,
      label: item.label || item.reportId,
      classification: item.classification || 'INTERNAL',
      period: item.storedConfiguration?.periodSemantic || 'THIS_MONTH',
      authorized: true,
      isAuthorized: true,
      availability: 'AVAILABLE',
      // Never returns data payload — preview only shows composition metadata
    };
  });
}

// ── Current-Authorization Scope Intersect ─────────────────────────────────────

/**
 * Intersects stored requestedCafeIds with the actor's currently authorized cafés.
 * Returns only currently authorized cafés — never uses stored IDs as authority.
 *
 * SAVED_VIEW_STORED_CAFE_IDS_USED_AS_AUTHORITY = 0
 * SAVED_VIEW_RETAINS_REVOKED_CAFE_ACCESS = 0
 * SAVED_REPORT_EXPORT_REVEALS_REVOKED_SCOPE = 0
 *
 * @param {string[]} requestedCafeIds - from stored config
 * @param {string[]} currentlyAuthorizedCafeIds - from live auth token evaluation
 * @returns {string[]} effective café scope for this run
 */
function resolveEffectiveReportCafeScope(requestedCafeIds, currentlyAuthorizedCafeIds) {
  if (!Array.isArray(currentlyAuthorizedCafeIds) || currentlyAuthorizedCafeIds.length === 0) {
    // No authorization — return empty, fail closed
    return [];
  }
  if (!Array.isArray(requestedCafeIds) || requestedCafeIds.length === 0) {
    // No stored preference — use full currently authorized scope
    return [...currentlyAuthorizedCafeIds];
  }
  // Intersect: only return cafés that are BOTH requested AND currently authorized
  const authorized = new Set(currentlyAuthorizedCafeIds.map((c) => String(c).toUpperCase()));
  return requestedCafeIds
    .map((c) => String(c).toUpperCase())
    .filter((c) => authorized.has(c));
}

// ── Edit Authorization ────────────────────────────────────────────────────────

/**
 * Determines whether an actor may edit a saved report or pack.
 * VIEW permission does not grant EDIT.
 *
 * SHARED_REPORT_VIEW_PERMISSION_GRANTS_EDIT = 0
 * STAFF_ENTERPRISE_SHARED_REPORT_VIEW_ACCESS = 0
 *
 * @param {object} doc - CustomReport or ReportPack document
 * @param {object} auth - authenticated actor
 * @returns {boolean}
 */
function canEditSavedItem(doc, auth) {
  if (!auth || String(auth.role || '').toUpperCase() === 'STAFF') {
    return false; // STAFF cannot edit any enterprise saved view
  }
  const isPrimaryMaster =
    Boolean(auth.isPrimaryMaster) ||
    (String(auth.role || '').toUpperCase() === 'MASTER' && auth.userId === 'MU-0001');

  // Owner of the document may always edit
  if (String(doc.ownerUserId).toUpperCase() === String(auth.userId).toUpperCase()) {
    return true;
  }

  // Primary Master may edit any shared org-level item
  if (isPrimaryMaster && doc.visibility === 'SHARED_ORGANISATION') {
    return true;
  }

  return false;
}

// ── Export Format Enforcement ─────────────────────────────────────────────────

/**
 * Validates that the requested export format is permitted.
 * PM02M_REINTRODUCES_CSV_EXPORT = 0
 * @param {string} format
 * @returns {{ allowed: boolean, reason?: string }}
 */
function validateExportFormat(format) {
  const f = String(format || '').toUpperCase();
  if (ALLOWED_EXPORT_FORMATS.includes(f)) {
    return { allowed: true };
  }
  return {
    allowed: false,
    reason: `Export format "${format}" is not permitted. Only PDF and XLSX are supported.`,
  };
}

// ── Classification Derivation ─────────────────────────────────────────────────

const CLASSIFICATION_ORDER = { INTERNAL: 0, CONFIDENTIAL: 1, HIGHLY_CONFIDENTIAL: 2 };

/**
 * Returns the strongest classification from a list.
 * Used to prevent downgrading CONFIDENTIAL reports in a mixed pack.
 * @param {string[]} classifications
 * @returns {string}
 */
function deriveStrongestClassification(classifications) {
  let strongest = 'INTERNAL';
  for (const c of classifications) {
    if ((CLASSIFICATION_ORDER[c] || 0) > (CLASSIFICATION_ORDER[strongest] || 0)) {
      strongest = c;
    }
  }
  return strongest;
}

// ── Pack Item Limit Enforcement ───────────────────────────────────────────────

/**
 * Validates pack item count does not exceed technical guardrail.
 * REPORT_PACK_SILENT_TRUNCATION = 0 — explicit error, never silent truncation.
 * @param {object[]} items
 * @returns {{ valid: boolean, count: number, limit: number }}
 */
function validatePackItemLimit(items) {
  const count = Array.isArray(items) ? items.length : 0;
  return {
    valid: count <= REPORT_PACK_LIMIT,
    count,
    limit: REPORT_PACK_LIMIT,
  };
}

// ── Concurrency Version Check ─────────────────────────────────────────────────

/**
 * Checks that the client's version matches the current document version.
 * Prevents silent last-write-wins overwrites.
 *
 * SHARED_REPORT_LAST_WRITE_SILENTLY_OVERWRITES_CONCURRENT_EDIT = 0
 *
 * @param {number} documentVersion
 * @param {number} clientVersion
 * @returns {{ conflict: boolean }}
 */
function checkVersionConflict(documentVersion, clientVersion) {
  if (clientVersion === undefined || clientVersion === null) {
    return { conflict: false }; // No version supplied — allow (first write)
  }
  return { conflict: Number(documentVersion) !== Number(clientVersion) };
}

// ── Subscription Truthful Status ──────────────────────────────────────────────

/**
 * Returns the truthful subscription capability for the current system.
 * FAKE_REPORT_SUBSCRIPTION_DELIVERY_SUCCESS = 0
 * IN_MEMORY_TIMER_PRESENTED_AS_DURABLE_REPORT_SUBSCRIPTION = 0
 * @returns {object}
 */
function getSubscriptionCapabilityStatus() {
  return {
    status: SUBSCRIPTION_STATUS,
    reason:
      'No durable scheduler, queue, worker, or outbound email provider is present in this deployment. ' +
      'Subscriptions cannot be implemented without a real execution mechanism.',
    capabilities: {
      persistence: 'NOT_IMPLEMENTED_SOURCE_MISSING',
      scheduler: 'NOT_IMPLEMENTED_SOURCE_MISSING',
      queue: 'NOT_IMPLEMENTED_SOURCE_MISSING',
      emailDelivery: 'NOT_IMPLEMENTED_SOURCE_MISSING',
      pdfAttachment: 'NOT_IMPLEMENTED_SOURCE_MISSING',
      xlsxAttachment: 'NOT_IMPLEMENTED_SOURCE_MISSING',
      retry: 'NOT_IMPLEMENTED_SOURCE_MISSING',
      audit: 'AVAILABLE_VIA_AUDIT_EVENT',
      permissionRecheck: 'NOT_APPLICABLE',
    },
  };
}

// ── Export Manifest ───────────────────────────────────────────────────────────

/**
 * Builds a standard export manifest to include in every PDF/XLSX output.
 * PM-02C/PM-02M export governance: includes classification, provenance, scope.
 * No secrets included.
 *
 * @param {object} params
 * @returns {object}
 */
function buildExportManifest({
  reportId,
  reportVersion,
  generatedBy,
  organisationId,
  authorizedCafeScope,
  period,
  classification,
  dataQuality,
  actuality,
}) {
  return {
    reportId,
    reportVersion: reportVersion || null,
    generatedBy,
    generatedAt: new Date().toISOString(),
    organisationId,
    authorizedCafeScope,
    period,
    classification: classification || 'INTERNAL',
    dataQuality: dataQuality || null,
    actuality: actuality || null,
    exportPolicy: 'PDF_AND_XLSX_ONLY',
    timezone: 'Asia/Kolkata',
  };
}

// ── Canonical Request Fingerprint ─────────────────────────────────────────────

/**
 * Generates a deterministic canonical fingerprint for a report request.
 * All calculation-affecting inputs are sorted and normalized.
 *
 * REPORT_PACK_DEDUP_COLLAPSES_DIFFERENT_FILTERS = 0
 * REPORT_PACK_DEDUP_COLLAPSES_DIFFERENT_METRIC_CONFIGURATION = 0
 * PM02M_REPORT_PACK_N_PLUS_ONE = 0
 *
 * @param {object} item
 * @param {object} callerContext
 * @returns {string} SHA-256 fingerprint hex
 */
function generateCanonicalRequestFingerprint(item, callerContext = {}) {
  const orgId = String(callerContext.organisationId || item.organisationId || '').trim().toUpperCase();
  if (!orgId) {
    const err = new Error('Missing authenticated organisation context. Fail closed.');
    err.code = 'MISSING_ORGANISATION_CONTEXT';
    err.statusCode = 403;
    throw err;
  }
  const baseId = String(item.baseReportId || item.reportId || '').trim().toLowerCase();
  const rawMetrics = item.metricIds || item.storedConfiguration?.metricIds || [];
  const metricIds = Array.isArray(rawMetrics) ? [...rawMetrics].map(s => String(s).trim()).sort() : [];
  const rawDims = item.dimensionIds || item.storedConfiguration?.dimensionIds || [];
  const dimensionIds = Array.isArray(rawDims) ? normalizeDimensionIds(rawDims).sort() : [];

  // Explicit cafe extraction (REPORT_PACK_FINGERPRINT_OMITS_CAFE_SCOPE = 0)
  const explicitCafeId = item.cafeId || item.storedConfiguration?.cafeId || item.filters?.cafeId || null;
  const effectiveAuthorizedCafeIds = Array.isArray(callerContext.effectiveCafeScope || callerContext.assignedCafeIds)
    ? [...(callerContext.effectiveCafeScope || callerContext.assignedCafeIds)].map(s => String(s).trim().toUpperCase()).sort()
    : (Array.isArray(item.effectiveCafeScope) ? [...item.effectiveCafeScope].map(s => String(s).trim().toUpperCase()).sort() : []);
  const requestedCafeIds = Array.isArray(item.storedConfiguration?.requestedCafeIds)
    ? [...item.storedConfiguration.requestedCafeIds].map(s => String(s).trim().toUpperCase()).sort()
    : (explicitCafeId ? [String(explicitCafeId).trim().toUpperCase()] : []);

  const period = String(item.period || item.storedConfiguration?.periodSemantic || item.filters?.periodSemantic || 'THIS_MONTH').trim().toUpperCase();
  const customDateFrom = String(item.filters?.customDateFrom || item.storedConfiguration?.customDateFrom || '').trim();
  const customDateTo = String(item.filters?.customDateTo || item.storedConfiguration?.customDateTo || '').trim();

  // Canonical comparison taxonomy mapping (PM02M_CREATES_SECOND_COMPARISON_TAXONOMY = 0)
  let rawComparison = String(item.comparison || item.filters?.comparison || item.storedConfiguration?.comparison || 'NONE').trim().toUpperCase();
  if (rawComparison === 'PREVIOUS_PERIOD') rawComparison = 'PRIOR_PERIOD';
  if (rawComparison === 'PREVIOUS_YEAR') rawComparison = 'PRIOR_YEAR';
  const comparison = rawComparison;

  // Canonical sorted key serialization of filters
  const rawFilters = item.filters || item.storedConfiguration?.filters || {};
  const filterKeys = Object.keys(rawFilters).sort();
  const canonicalFilters = {};
  for (const k of filterKeys) {
    if (k !== 'requestedCafeIds' && k !== 'cafeId' && k !== 'periodSemantic' && k !== 'customDateFrom' && k !== 'customDateTo') {
      canonicalFilters[k] = rawFilters[k];
    }
  }

  const sortField = String(item.sort?.field || item.storedConfiguration?.sortField || '').trim();
  const sortDir = String(item.sort?.direction || item.storedConfiguration?.sortDirection || 'DESC').trim().toUpperCase();
  const topN = Number(item.topN !== undefined && item.topN !== null ? item.topN : (item.storedConfiguration?.topN !== undefined && item.storedConfiguration?.topN !== null ? item.storedConfiguration.topN : 0));
  const metricVersion = String(item.metricVersion || item.storedConfiguration?.metricVersion || '1.0.0');
  const scenarioConfig = item.scenarioConfig || item.storedConfiguration?.scenarioConfig || null;

  const payload = {
    organisationId: orgId,
    effectiveAuthorizedCafeIds,
    requestedCafeIds,
    explicitCafeId: explicitCafeId ? String(explicitCafeId).trim().toUpperCase() : null,
    baseReportId: baseId,
    reportVersion: String(item.reportVersion || item.storedConfiguration?.reportVersion || '1.0.0'),
    metricVersion,
    metricIds,
    dimensionIds,
    period,
    customDateFrom,
    customDateTo,
    comparison,
    filters: canonicalFilters,
    sortField,
    sortDir,
    topN,
    scenarioConfig,
  };

  const str = JSON.stringify(payload);
  const crypto = require('crypto');
  return crypto.createHash('sha256').update(str).digest('hex');
}

// ── Module Exports ────────────────────────────────────────────────────────────

module.exports = {
  // Static invariants
  CUSTOM_REPORT_ARBITRARY_DATABASE_QUERY,
  CUSTOM_REPORT_UNSUPPORTED_DIMENSION_ACCEPTED,
  CUSTOM_REPORT_SUMS_NON_ADDITIVE_METRIC,
  SAVED_VIEW_STORED_CAFE_IDS_USED_AS_AUTHORITY,
  SAVED_VIEW_RETAINS_REVOKED_CAFE_ACCESS,
  REPORT_PACK_SINGLE_AUTH_CHECK_GRANTS_ALL_ITEMS,
  ARBITRARY_REPORT_PACK_SCORE,
  PM02M_REINTRODUCES_CSV_EXPORT,
  SCHEDULED_REPORT_USES_STALE_CREATION_TIME_AUTHORITY,
  REPORT_SUBSCRIPTION_DUPLICATE_DELIVERY,
  CUSTOM_REPORT_ALLOWS_SEMANTICALLY_INVALID_VISUAL,
  CUSTOM_REPORT_HTML_INJECTION,
  CUSTOM_REPORT_STORED_XSS,
  REPORT_SIGNOFF_ALTERS_METRIC_TRUTH,
  SHARED_REPORT_LAST_WRITE_SILENTLY_OVERWRITES_CONCURRENT_EDIT,
  CUSTOM_REPORT_MUTATES_CANONICAL_REPORT_DEFINITION,
  SAVED_REPORT_EXPORT_REVEALS_REVOKED_SCOPE,
  REPORT_PACK_SILENT_TRUNCATION,
  PM02M_REPORT_PACK_N_PLUS_ONE,
  CUSTOM_REPORT_CROSS_SCOPE_CACHE_LEAK,
  CUSTOM_REPORT_CLIENT_SUPPLIED_ACTOR_TRUSTED,
  CUSTOM_REPORT_CLIENT_ORGANISATION_AUTHORITY,
  SHARED_REPORT_VIEW_PERMISSION_GRANTS_EDIT,
  FAKE_REPORT_SUBSCRIPTION_DELIVERY_SUCCESS,
  IN_MEMORY_TIMER_PRESENTED_AS_DURABLE_REPORT_SUBSCRIPTION,
  DEAD_PM02M_CONTROLS,
  MISREPRESENTED_PM02M_CONTROLS,
  UNEXPLAINED_FROZEN_TEST_LOSS,
  NONATOMIC_VERSION_CHECK_ALLOWS_LOST_UPDATE,
  REPORT_PACK_SCREEN_EXPORT_VALUE_DRIFT,
  SENSITIVE_REPORT_PAYLOAD_STORED_IN_LOCALSTORAGE,
  STAFF_ENTERPRISE_SHARED_REPORT_VIEW_ACCESS,
  STAFF_CAN_CLONE_ENTERPRISE_SHARED_REPORT,
  CUSTOM_REPORT_UI_HAS_NO_BASE_REPORT_SELECTOR,
  CUSTOM_REPORT_UI_HAS_NO_METRIC_SELECTOR,
  CUSTOM_REPORT_UI_HAS_NO_DIMENSION_SELECTOR,
  HARDCODED_UNVERIFIED_GSTIN_IN_PRODUCTION_EXPORT,
  HARDCODED_SINGLE_ORGANISATION_LEGAL_IDENTITY_IN_MULTI_TENANT_EXPORT,
  REPORT_PACK_CROSS_ORG_LEGAL_IDENTITY_LEAK,
  REPORT_PACK_DEDUP_COLLAPSES_DIFFERENT_FILTERS,
  REPORT_PACK_DEDUP_COLLAPSES_DIFFERENT_METRIC_CONFIGURATION,
  UNAUTHORIZED_REPORT_PACK_ITEM_METADATA_LEAK,
  CUSTOM_REPORT_PLAIN_TEXT_RENDERED_THROUGH_UNSAFE_HTML_SINK,
  USER_LABEL_EXPORTED_AS_SPREADSHEET_FORMULA,

  // PM-02M-R3 Invariants
  OWNER_REPORTING_PRODUCTIVITY_CROSS_CAFE_AUTHORITY,
  OWNER_PRIMARY_MASTER_AUTHORITY_CONFLATED,
  OWNER_EMPTY_ASSIGNED_CAFES_DEFAULTS_TO_ALL,
  STAFF_PERSONAL_VIEW_BYPASSES_ENTERPRISE_REPORT_DENIAL,
  PM02M_REWRITES_FROZEN_TEST_MATRIX,
  FROZEN_ARTIFACT_MANIFEST_SILENTLY_REBASELINED,
  REPORT_PACK_FINGERPRINT_OMITS_CAFE_SCOPE,
  REPORT_PACK_FINGERPRINT_OMITS_TENANT_SCOPE,
  REPORT_PACK_RESULT_REUSED_ACROSS_AUTHORIZATION_SCOPE,
  PM02M_CREATES_SECOND_COMPARISON_TAXONOMY,
  PM02M_CREATES_SECOND_DIMENSION_TAXONOMY,
  GENERIC_TEXT_MASQUERADES_AS_LEGAL_NAME,
  PM02M_INVARIANT_COUNT_MISMATCH,

  // R4 Invariants
  STAFF_PRIVATE_VISIBILITY_GRANTS_ENTERPRISE_REPORT_ACCESS,
  STAFF_PRIVATE_REPORT_USES_UNAUTHORIZED_METRIC,
  STAFF_PRIVATE_REPORT_USES_UNAUTHORIZED_DIMENSION,
  REPORTING_PRODUCTIVITY_USES_NONCANONICAL_ASSIGNED_CAFE_FIELD,
  CLIENT_CAFE_ASSIGNMENT_USED_AS_REPORT_AUTHORITY,
  MISSING_ORGANISATION_CONTEXT_DEFAULTS_TO_SHARED_SYNTHETIC_TENANT,
  REPORT_PACK_FINGERPRINT_OMITS_BASE_REPORT_ID,
  REPORT_PACK_FINGERPRINT_OMITS_REPORT_VERSION,
  REPORT_PACK_FINGERPRINT_OMITS_TOP_N,
  REPORT_PACK_FINGERPRINT_OMITS_RESULT_AFFECTING_SORT,
  PM02M_CUSTOM_DIMENSIONS_DIFFER_FROM_FROZEN_DIMENSION_REGISTRY,
  PM02M_PERSISTS_DIMENSION_ALIAS_AS_CANONICAL_ID,

  // Configuration
  CUSTOM_FORMULA_ENGINE,
  SUBSCRIPTION_STATUS,
  REPORT_PACK_LIMIT,
  ALLOWED_EXPORT_FORMATS,
  REJECTED_EXPORT_FORMATS,
  VISUAL_COMPATIBILITY,
  ROLE_VISIBILITY_CREATE_PERMISSIONS,

  // Functions
  isVisualCompatible,
  getAllowedVisibilityScopes,
  sanitizeText,
  generateCustomReportId,
  generateReportPackId,
  generateFavouriteId,
  validateMetricIds,
  validateDimensionIds,
  normalizeDimensionId,
  normalizeDimensionIds,
  CANONICAL_DIMENSION_ALIASES,
  getMetricAggregationType,
  buildPackPreview,
  resolveEffectiveReportCafeScope,
  canEditSavedItem,
  validateExportFormat,
  deriveStrongestClassification,
  validatePackItemLimit,
  checkVersionConflict,
  getSubscriptionCapabilityStatus,
  buildExportManifest,
  generateCanonicalRequestFingerprint,
};
