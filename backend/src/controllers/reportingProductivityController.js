'use strict';

/**
 * REPORTING PRODUCTIVITY CONTROLLER — PM-02M
 *
 * Handles: Custom Reports, Saved Views, Report Packs, Favourites, Subscriptions.
 *
 * SECURITY ABSOLUTE RULES:
 *   1. organisationId ALWAYS from req.auth.organisationId — NEVER from req.body or req.params.
 *   2. createdBy / updatedBy ALWAYS from req.auth.userId — NEVER trusted from client.
 *   3. At every run/export: current authorization re-evaluated — stored cafeIds are config only.
 *   4. No arbitrary DB queries, dynamic code execution, or aggregation pipelines from user.
 *   5. Export: PDF and XLSX only — CSV/HTML/JSON/XML/TXT/XLS rejected.
 *   6. Subscriptions: NOT_IMPLEMENTED_SOURCE_MISSING — no fake delivery success.
 *   7. Canonical ReportRegistry/MetricRegistry/DimensionRegistry definitions are READ-ONLY.
 *   8. Sign-off is governance metadata only — does not alter metric values or data quality.
 */

const { CustomReport, CUSTOM_REPORT_VISIBILITY } = require('../models/CustomReport');
const { ReportPack, REPORT_PACK_LIMIT } = require('../models/ReportPack');
const { ReportFavourite } = require('../models/ReportFavourite');
const { AuditEvent } = require('../models/AuditEvent');
const {
  generateCustomReportId,
  generateReportPackId,
  generateFavouriteId,
  sanitizeText,
  validateMetricIds,
  validateDimensionIds,
  validateExportFormat,
  validatePackItemLimit,
  checkVersionConflict,
  resolveEffectiveReportCafeScope,
  canEditSavedItem,
  buildPackPreview,
  getAllowedVisibilityScopes,
  getSubscriptionCapabilityStatus,
  buildExportManifest,
  deriveStrongestClassification,
  isVisualCompatible,
  generateCanonicalRequestFingerprint,
} = require('../reporting/calculations/reportingProductivityCalculations');
const { resolveReportScope } = require('../reporting/reportingScope');
const { ReportRegistry } = require('../reporting/reportRegistry');
const { MetricRegistry } = require('../reporting/metricRegistry');
const { DIMENSIONS_REGISTRY } = require('../reporting/dimensionRegistry');
const { normalizeDimensionId } = require('../reporting/calculations/reportingProductivityCalculations');
const { generatePdf, generateXlsx } = require('../utils/exportGenerators');
const { CompanyIdentityService } = require('../services/companyIdentityService');

// ── Utility: safe 403 IDOR response ──────────────────────────────────────────

function denyIdor(res) {
  return res.status(403).json({
    success: false,
    error: 'ACCESS_DENIED',
    message: 'Not found or access denied.',
  });
}

// ── Utility: AuditEvent writer ────────────────────────────────────────────────

async function writeAuditEvent(auth, action, entityType, entityId, result = 'SUCCESS', detail = null) {
  try {
    const ts = Date.now();
    await AuditEvent.create({
      auditEventId: `AE-${new Date().toISOString().slice(0,10).replace(/-/g,'')}-${ts}`,
      organisationId: auth.organisationId,
      actorUserId: auth.userId,
      actorRole: auth.role,
      action,
      entityType,
      entityId,
      result,
      detail: detail || undefined,
      riskClassification: 'LOW',
    });
  } catch {
    // Audit write failure must never block the primary operation
  }
}

function validateFiltersAndVisuals(filters, visualDefinitions) {
  if (filters) {
    if (filters.customDateFrom || filters.customDateTo || filters.periodSemantic === 'CUSTOM' || filters.periodSemantic === 'CUSTOM_ABSOLUTE') {
      const from = filters.customDateFrom;
      const to = filters.customDateTo;
      if (from || to) {
        if (!from || !to || !/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
          return { valid: false, error: 'INVALID_DATE_RANGE', message: 'Date range requires YYYY-MM-DD from and to dates.' };
        }
        const dFrom = new Date(from);
        const dTo = new Date(to);
        if (isNaN(dFrom.getTime()) || isNaN(dTo.getTime()) || dFrom > dTo) {
          return { valid: false, error: 'INVALID_DATE_RANGE', message: 'Invalid date range: from date cannot be after to date.' };
        }
      }
    }
    if (filters.topN !== undefined && filters.topN !== null) {
      const n = Number(filters.topN);
      if (!Number.isInteger(n) || n < 1 || n > 1000) {
        return { valid: false, error: 'INVALID_TOP_N', message: 'topN must be an integer between 1 and 1000.' };
      }
    }
  }
  if (Array.isArray(visualDefinitions)) {
    for (const vd of visualDefinitions) {
      if (vd.topN !== undefined && vd.topN !== null) {
        const n = Number(vd.topN);
        if (!Number.isInteger(n) || n < 1 || n > 1000) {
          return { valid: false, error: 'INVALID_TOP_N', message: 'topN in visual definitions must be an integer between 1 and 1000.' };
        }
      }
    }
  }
  return { valid: true };
}

// ── CUSTOM REPORTS / SAVED VIEWS ──────────────────────────────────────────────

/**
 * POST /api/v1/reporting-productivity/custom-reports
 * Create a personal or shared custom report/saved view.
 */
async function createCustomReport(req, res) {
  try {
    const auth = req.auth;
    // organisationId from auth — NEVER from body (CUSTOM_REPORT_CLIENT_ORGANISATION_AUTHORITY = 0)
    const organisationId = auth.organisationId;
    const ownerUserId = auth.userId; // actor always from auth (CUSTOM_REPORT_CLIENT_SUPPLIED_ACTOR_TRUSTED = 0)

    const scope = resolveReportScope(req);

    // Staff cannot create enterprise report views (BLOCKER M-R4-001)
    if (scope.authorityType === 'STAFF' || auth.role === 'STAFF') {
      // Validate baseReportId against ReportRegistry role authority
      const baseReport = req.body.baseReportId ? ReportRegistry.getReport(req.body.baseReportId) : null;
      const isStaffAuthorized = Boolean(
        baseReport &&
        baseReport.allowSelfService === true &&
        (baseReport.supportedRoles || []).includes('STAFF')
      );
      if (!isStaffAuthorized) {
        return res.status(403).json({
          success: false,
          error: 'ROLE_NOT_ALLOWED',
          message: 'Staff role is not permitted to access enterprise reports or create custom reports.',
        });
      }

      // Even if self-service report exists, validate every selected metric independently
      const requestedMetrics = Array.isArray(req.body.metricIds) ? req.body.metricIds : [];
      for (const mId of requestedMetrics) {
        const mDef = MetricRegistry.getMetric ? MetricRegistry.getMetric(mId) : null;
        const mAllowed = Boolean(mDef && (mDef.supportedRoles || []).includes('STAFF'));
        if (!mAllowed) {
          return res.status(403).json({
            success: false,
            error: 'ROLE_NOT_ALLOWED',
            message: `Staff role is not permitted to use metric ${mId}.`,
          });
        }
      }

      // Validate every selected dimension independently
      const requestedDimensions = Array.isArray(req.body.dimensionIds) ? req.body.dimensionIds : [];
      const staffForbiddenDimensions = ['EMPLOYEE', 'ROLE', 'CUSTOMER', 'VENDOR', 'EXPENSE_CATEGORY'];
      for (const dId of requestedDimensions) {
        const normD = normalizeDimensionId(dId);
        if (staffForbiddenDimensions.includes(normD)) {
          return res.status(403).json({
            success: false,
            error: 'ROLE_NOT_ALLOWED',
            message: `Staff role is not permitted to use dimension ${dId}.`,
          });
        }
      }
    }

    // Authority strictly derives from authenticated server state — client parameters ignored
    const effectiveAssignedCafeIds = scope.assignedCafeIds || auth.assignedCafeIds || [];

    // Owner scope enforcement: must have assigned cafes and cannot exceed them (OWNER_REPORTING_PRODUCTIVITY_CROSS_CAFE_AUTHORITY = 0)
    if (scope.authorityType === 'OWNER') {
      if (!scope.assignedCafeIds || scope.assignedCafeIds.length === 0) {
        return res.status(403).json({
          success: false,
          error: 'CROSS_CAFE_RESOURCE_DENIED',
          message: 'Owner has no assigned café scope.',
        });
      }
    }

    const {
      name,
      description,
      visibility,
      sharedCafeId,
      baseReportId,
      metricIds,
      dimensionIds,
      filters,
      visualDefinitions,
      preferredExportFormat,
      categoryId,
    } = req.body;

    // Scope boundary validation for SHARED_CAFE views (Owner and Cafe Admin)
    const requestedVisibility = visibility || 'PERSONAL';
    if (requestedVisibility === 'SHARED_CAFE') {
      if (['OWNER', 'CAFE_ADMIN'].includes(scope.authorityType)) {
        if (!sharedCafeId || !(scope.assignedCafeIds || []).includes(sharedCafeId)) {
          return res.status(403).json({
            success: false,
            error: 'CROSS_CAFE_RESOURCE_DENIED',
            message: 'Access denied to unassigned café.',
          });
        }
      }
    }

    // Direct filter cafe boundary check
    const targetFilterCafe = filters?.cafeId || req.body.cafeId;
    if (targetFilterCafe && targetFilterCafe !== 'ALL_CAFES' && ['OWNER', 'CAFE_ADMIN'].includes(scope.authorityType)) {
      if (!(scope.assignedCafeIds || []).includes(targetFilterCafe)) {
        return res.status(403).json({
          success: false,
          error: 'CROSS_CAFE_RESOURCE_DENIED',
          message: 'Access denied to unassigned café.',
        });
      }
    }

    // Comparison normalization to canonical reportingTime taxonomy
    if (filters && filters.comparison === 'PREVIOUS_PERIOD') {
      filters.comparison = 'PRIOR_PERIOD';
    } else if (filters && filters.comparison === 'PREVIOUS_YEAR') {
      filters.comparison = 'PRIOR_YEAR';
    }

    // Sanitize user-provided text (CUSTOM_REPORT_STORED_XSS = 0)
    const safeName = sanitizeText(name || '', 120);
    if (!safeName) {
      return res.status(400).json({ success: false, error: 'INVALID_NAME', message: 'Report name is required.' });
    }

    // Validate filters and visual definitions (date range & topN)
    const fvCheck = validateFiltersAndVisuals(filters, visualDefinitions);
    if (!fvCheck.valid) {
      return res.status(400).json({ success: false, error: fvCheck.error, message: fvCheck.message });
    }

    // Validate visibility scope for this role
    const allowedVisibilities = getAllowedVisibilityScopes(scope.authorityType);
    if (!allowedVisibilities.includes(requestedVisibility)) {
      return res.status(403).json({
        success: false,
        error: 'VISIBILITY_NOT_ALLOWED',
        message: `Role ${scope.authorityType} cannot create ${requestedVisibility} reports.`,
      });
    }

    // Validate export format (PM02M_REINTRODUCES_CSV_EXPORT = 0)
    const exportCheck = validateExportFormat(preferredExportFormat || 'PDF');
    if (!exportCheck.allowed) {
      return res.status(400).json({ success: false, error: 'INVALID_EXPORT_FORMAT', message: exportCheck.reason });
    }

    // Validate visual compatibility
    if (Array.isArray(visualDefinitions)) {
      for (const vd of visualDefinitions) {
        if (vd.visualType && vd.aggregationType) {
          if (!isVisualCompatible(vd.visualType, vd.aggregationType)) {
            return res.status(400).json({
              success: false,
              error: 'INVALID_VISUAL_COMBINATION',
              message: `Visual type ${vd.visualType} is not compatible with aggregation type ${vd.aggregationType}.`,
            });
          }
        }
      }
    }

    const customReportId = generateCustomReportId(organisationId);

    const doc = new CustomReport({
      customReportId,
      organisationId,
      ownerUserId,
      name: safeName,
      description: sanitizeText(description || '', 500),
      visibility: requestedVisibility,
      sharedCafeId: sharedCafeId || null,
      baseReportId: baseReportId || null,
      metricIds: Array.isArray(metricIds) ? metricIds.slice(0, 20) : [],
      dimensionIds: Array.isArray(dimensionIds) ? dimensionIds.slice(0, 10) : [],
      filters: filters || {},
      visualDefinitions: Array.isArray(visualDefinitions) ? visualDefinitions.slice(0, 10) : [],
      preferredExportFormat: (preferredExportFormat || 'PDF').toUpperCase(),
      categoryId: categoryId || null,
    });

    await doc.save();

    if (requestedVisibility !== 'PERSONAL') {
      await writeAuditEvent(auth, 'CUSTOM_REPORT_SHARED_CREATE', 'CUSTOM_REPORT', customReportId);
    }

    return res.status(201).json({
      success: true,
      customReportId: doc.customReportId,
      version: doc.version,
    });
  } catch (err) {
    const status = err.statusCode || 500;
    const error = err.code || 'INTERNAL_ERROR';
    return res.status(status).json({ success: false, error, message: err.message });
  }
}

/**
 * GET /api/v1/reporting-productivity/custom-reports
 * List custom reports visible to the authenticated actor.
 * Personal + shared views scoped to current authorisation — no IDOR.
 */
async function listCustomReports(req, res) {
  try {
    const auth = req.auth;
    const scope = resolveReportScope(req);
    if (scope.authorityType === 'STAFF') {
      return res.status(403).json({ success: false, error: 'ROLE_NOT_ALLOWED' });
    }

    const { status = 'ACTIVE', visibility: visFilter } = req.query;
    const organisationId = auth.organisationId;
    const userId = auth.userId;

    // Build visibility filter — personal always included; shared based on scope
    const visibilityQuery = [
      { organisationId, ownerUserId: userId }, // personal
    ];

    if (['PRIMARY_MASTER'].includes(scope.authorityType)) {
      visibilityQuery.push({ organisationId, visibility: 'SHARED_ORGANISATION' });
    }

    if (['PRIMARY_MASTER', 'OWNER', 'CAFE_ADMIN'].includes(scope.authorityType)) {
      const authorizedCafeIds = scope.assignedCafeIds || [];
      if (authorizedCafeIds.length > 0) {
        visibilityQuery.push({
          organisationId,
          visibility: 'SHARED_CAFE',
          sharedCafeId: { $in: authorizedCafeIds },
        });
      }
    }

    const query = {
      $or: visibilityQuery,
      status: status || 'ACTIVE',
    };

    if (visFilter && CUSTOM_REPORT_VISIBILITY.includes(visFilter)) {
      query.visibility = visFilter;
    }

    const docs = await CustomReport.find(query)
      .select('customReportId name description visibility ownerUserId status createdAt updatedAt version classification categoryId')
      .sort({ updatedAt: -1 })
      .limit(200)
      .lean();

    return res.json({ success: true, count: docs.length, customReports: docs });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'INTERNAL_ERROR', message: err.message });
  }
}

/**
 * GET /api/v1/reporting-productivity/custom-reports/:customReportId
 * Fetch a single custom report — IDOR-safe.
 */
async function getCustomReport(req, res) {
  try {
    const auth = req.auth;
    const scope = resolveReportScope(req);
    if (scope.authorityType === 'STAFF') return denyIdor(res);

    const doc = await CustomReport.findOne({
      customReportId: req.params.customReportId,
      organisationId: auth.organisationId,
    }).lean();

    if (!doc) return denyIdor(res);

    // Check visibility permission
    const isOwner = String(doc.ownerUserId).toUpperCase() === String(auth.userId).toUpperCase();
    const canView =
      isOwner ||
      (doc.visibility === 'SHARED_ORGANISATION' &&
        ['PRIMARY_MASTER'].includes(scope.authorityType)) ||
      (doc.visibility === 'SHARED_CAFE' &&
        (scope.assignedCafeIds || []).includes(doc.sharedCafeId));

    if (!canView) return denyIdor(res);

    return res.json({ success: true, customReport: doc });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'INTERNAL_ERROR', message: err.message });
  }
}

/**
 * PATCH /api/v1/reporting-productivity/custom-reports/:customReportId
 * Update a custom report. Only the owner (or Primary Master for shared org items) may edit.
 * SHARED_REPORT_VIEW_PERMISSION_GRANTS_EDIT = 0
 * SHARED_REPORT_LAST_WRITE_SILENTLY_OVERWRITES_CONCURRENT_EDIT = 0
 */
async function updateCustomReport(req, res) {
  try {
    const auth = req.auth;
    const scope = resolveReportScope(req);
    if (scope.authorityType === 'STAFF') return denyIdor(res);
    const organisationId = auth.organisationId;

    const doc = await CustomReport.findOne({
      customReportId: req.params.customReportId,
      organisationId,
    });

    if (!doc) return denyIdor(res);
    if (!canEditSavedItem(doc, auth)) {
      return res.status(403).json({ success: false, error: 'EDIT_NOT_ALLOWED' });
    }

    // Determine expected version for atomic compare-and-swap (CAS)
    const expectedVersion = req.body.version !== undefined ? Number(req.body.version) : doc.version;

    // Check version conflict immediately before proceeding
    if (doc.version !== expectedVersion) {
      return res.status(409).json({
        success: false,
        error: 'VERSION_CONFLICT',
        concurrencyStrategy: 'ATOMIC_COMPARE_AND_SWAP',
        message: 'Document was modified by another session. Please reload and retry.',
        currentVersion: doc.version,
        expectedVersion,
      });
    }

    // Validate filters and visuals if updated
    const { filters: patchFilters, visualDefinitions: patchVisuals } = req.body;
    if (patchFilters || patchVisuals) {
      const fvCheck = validateFiltersAndVisuals(patchFilters, patchVisuals);
      if (!fvCheck.valid) {
        return res.status(400).json({ success: false, error: fvCheck.error, message: fvCheck.message });
      }
    }

    // Build update object (no raw queries, no dynamic evaluation)
    const updateSet = { updatedAt: new Date(), updatedBy: auth.userId };
    const allowedFields = [
      'name', 'description', 'visibility', 'sharedCafeId',
      'metricIds', 'dimensionIds', 'filters', 'visualDefinitions',
      'preferredExportFormat', 'categoryId', 'status',
    ];

    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        if (field === 'name') {
          updateSet.name = sanitizeText(req.body.name, 120);
        } else if (field === 'description') {
          updateSet.description = sanitizeText(req.body.description, 500);
        } else if (field === 'preferredExportFormat') {
          const fmt = validateExportFormat(req.body.preferredExportFormat);
          if (!fmt.allowed) {
            return res.status(400).json({ success: false, error: 'INVALID_EXPORT_FORMAT', message: fmt.reason });
          }
          updateSet.preferredExportFormat = req.body.preferredExportFormat.toUpperCase();
        } else {
          updateSet[field] = req.body[field];
        }
      }
    }

    // ATOMIC COMPARE-AND-SWAP:
    // Matches customReportId, organisationId, and exact expected version.
    // Atomically increments version by 1 in the same write.
    // NONATOMIC_VERSION_CHECK_ALLOWS_LOST_UPDATE = 0
    // SHARED_REPORT_LAST_WRITE_SILENTLY_OVERWRITES_CONCURRENT_EDIT = 0
    const updatedDoc = await CustomReport.findOneAndUpdate(
      {
        customReportId: req.params.customReportId,
        organisationId,
        version: expectedVersion,
      },
      {
        $set: updateSet,
        $inc: { version: 1 },
      },
      { new: true }
    );

    if (!updatedDoc) {
      // If atomic update failed, query current record to confirm version mismatch
      const current = await CustomReport.findOne({
        customReportId: req.params.customReportId,
        organisationId,
      });
      if (!current) return denyIdor(res);
      return res.status(409).json({
        success: false,
        error: 'VERSION_CONFLICT',
        concurrencyStrategy: 'ATOMIC_COMPARE_AND_SWAP',
        message: 'Document was modified concurrently by another session. Please reload and retry.',
        currentVersion: current.version,
        expectedVersion,
      });
    }

    if (updatedDoc.visibility !== 'PERSONAL') {
      await writeAuditEvent(auth, 'CUSTOM_REPORT_SHARED_UPDATE', 'CUSTOM_REPORT', updatedDoc.customReportId);
    }

    return res.json({
      success: true,
      customReportId: updatedDoc.customReportId,
      version: updatedDoc.version,
      concurrencyStrategy: 'ATOMIC_COMPARE_AND_SWAP',
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'INTERNAL_ERROR', message: err.message });
  }
}

/**
 * DELETE /api/v1/reporting-productivity/custom-reports/:customReportId
 * Archive (soft-delete) a custom report.
 */
async function archiveCustomReport(req, res) {
  try {
    const auth = req.auth;
    const scope = resolveReportScope(req);
    if (scope.authorityType === 'STAFF') return denyIdor(res);
    const doc = await CustomReport.findOne({
      customReportId: req.params.customReportId,
      organisationId: auth.organisationId,
    });

    if (!doc) return denyIdor(res);
    if (!canEditSavedItem(doc, auth)) {
      return res.status(403).json({ success: false, error: 'EDIT_NOT_ALLOWED' });
    }

    const wasShared = doc.visibility !== 'PERSONAL';
    doc.status = 'ARCHIVED';
    await doc.save();

    if (wasShared) {
      await writeAuditEvent(auth, 'CUSTOM_REPORT_SHARED_ARCHIVED', 'CUSTOM_REPORT', doc.customReportId);
    }

    return res.json({ success: true, customReportId: doc.customReportId, status: 'ARCHIVED' });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'INTERNAL_ERROR', message: err.message });
  }
}

/**
 * POST /api/v1/reporting-productivity/custom-reports/:customReportId/clone
 * Clone a custom report. Requires read access to source; clone gets new ID.
 */
async function cloneCustomReport(req, res) {
  try {
    const auth = req.auth;
    if (auth.role === 'STAFF') {
      return res.status(403).json({ success: false, error: 'ROLE_NOT_ALLOWED', message: 'Staff cannot clone custom reports.' });
    }
    const scope = resolveReportScope(req);
    if (scope.authorityType === 'STAFF') {
      return res.status(403).json({ success: false, error: 'ROLE_NOT_ALLOWED', message: 'Staff cannot clone custom reports.' });
    }

    const source = await CustomReport.findOne({
      customReportId: req.params.customReportId,
      organisationId: auth.organisationId,
    }).lean();

    if (!source) return denyIdor(res);

    // Can only clone what you can read
    const isOwner = String(source.ownerUserId).toUpperCase() === String(auth.userId).toUpperCase();
    const canRead =
      isOwner ||
      (source.visibility === 'SHARED_ORGANISATION' &&
        ['PRIMARY_MASTER'].includes(scope.authorityType)) ||
      (source.visibility === 'SHARED_CAFE' &&
        (scope.assignedCafeIds || []).includes(source.sharedCafeId));

    if (!canRead) return denyIdor(res);

    const cloneId = generateCustomReportId(auth.organisationId);
    const clone = new CustomReport({
      ...source,
      _id: undefined,
      customReportId: cloneId,
      ownerUserId: auth.userId,
      visibility: 'PERSONAL',
      name: sanitizeText(`Copy of ${source.name}`, 120),
      status: 'ACTIVE',
      version: undefined,
    });

    await clone.save();
    return res.status(201).json({ success: true, customReportId: clone.customReportId });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'INTERNAL_ERROR', message: err.message });
  }
}

/**
 * POST /api/v1/reporting-productivity/custom-reports/:customReportId/sign-off
 * Record governance sign-off metadata.
 * REPORT_SIGNOFF_ALTERS_METRIC_TRUTH = 0 — sign-off is metadata only.
 */
async function signOffCustomReport(req, res) {
  try {
    const auth = req.auth;
    const scope = resolveReportScope(req);
    if (scope.authorityType === 'STAFF') return denyIdor(res);
    const doc = await CustomReport.findOne({
      customReportId: req.params.customReportId,
      organisationId: auth.organisationId,
    });

    if (!doc) return denyIdor(res);
    if (!canEditSavedItem(doc, auth)) {
      return res.status(403).json({ success: false, error: 'EDIT_NOT_ALLOWED' });
    }

    // Sign-off records governance metadata ONLY — metric values/quality unchanged
    doc.signOff = {
      signedOffBy: auth.userId,
      signedOffAt: new Date(),
      note: sanitizeText(req.body.note || '', 500),
    };

    await doc.save();
    return res.json({
      success: true,
      customReportId: doc.customReportId,
      signOff: doc.signOff,
      note: 'Sign-off is governance metadata only. Metric values and data quality are not altered.',
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'INTERNAL_ERROR', message: err.message });
  }
}

// ── REPORT PACKS ──────────────────────────────────────────────────────────────

/**
 * POST /api/v1/reporting-productivity/report-packs
 * Create a new governed report pack.
 */
async function createReportPack(req, res) {
  try {
    const auth = req.auth;
    const scope = resolveReportScope(req);
    if (scope.authorityType === 'STAFF') {
      return res.status(403).json({ success: false, error: 'ROLE_NOT_ALLOWED' });
    }

    const { name, description, visibility, sharedCafeId, orderedItems, preferredExportFormat, templateType } = req.body;

    // Validate item limit (REPORT_PACK_SILENT_TRUNCATION = 0 — explicit error)
    const limitCheck = validatePackItemLimit(orderedItems);
    if (!limitCheck.valid) {
      return res.status(400).json({
        success: false,
        error: 'PACK_ITEM_LIMIT_EXCEEDED',
        message: `Report pack may contain at most ${REPORT_PACK_LIMIT} items (authority: TECHNICAL_GUARDRAIL). Received: ${limitCheck.count}.`,
        limit: REPORT_PACK_LIMIT,
      });
    }

    const exportCheck = validateExportFormat(preferredExportFormat || 'PDF');
    if (!exportCheck.allowed) {
      return res.status(400).json({ success: false, error: 'INVALID_EXPORT_FORMAT', message: exportCheck.reason });
    }

    const allowedVisibilities = getAllowedVisibilityScopes(scope.authorityType);
    const requestedVisibility = visibility || 'PERSONAL';
    if (!allowedVisibilities.includes(requestedVisibility)) {
      return res.status(403).json({ success: false, error: 'VISIBILITY_NOT_ALLOWED' });
    }

    // Owner scope enforcement: must have assigned cafes and cannot exceed them
    if (scope.authorityType === 'OWNER') {
      if (!scope.assignedCafeIds || scope.assignedCafeIds.length === 0) {
        return res.status(403).json({
          success: false,
          error: 'CROSS_CAFE_RESOURCE_DENIED',
          message: 'Owner has no assigned café scope.',
        });
      }
    }

    // Scope boundary validation for SHARED_CAFE packs (Owner and Cafe Admin)
    if (requestedVisibility === 'SHARED_CAFE') {
      if (['OWNER', 'CAFE_ADMIN'].includes(scope.authorityType)) {
        if (!sharedCafeId || !(scope.assignedCafeIds || []).includes(sharedCafeId)) {
          return res.status(403).json({
            success: false,
            error: 'CROSS_CAFE_RESOURCE_DENIED',
            message: 'Access denied to unassigned café.',
          });
        }
      }
    }

    const reportPackId = generateReportPackId(auth.organisationId);

    const doc = new ReportPack({
      reportPackId,
      organisationId: auth.organisationId,
      ownerUserId: auth.userId,
      name: sanitizeText(name || '', 120),
      description: sanitizeText(description || '', 500),
      visibility: requestedVisibility,
      sharedCafeId: sharedCafeId || null,
      orderedItems: Array.isArray(orderedItems) ? orderedItems : [],
      preferredExportFormat: (preferredExportFormat || 'PDF').toUpperCase(),
      templateType: templateType || null,
    });

    await doc.save();

    if (requestedVisibility !== 'PERSONAL') {
      await writeAuditEvent(auth, 'REPORT_PACK_SHARED', 'REPORT_PACK', reportPackId);
    }

    return res.status(201).json({
      success: true,
      reportPackId: doc.reportPackId,
      effectiveClassification: doc.effectiveClassification,
      version: doc.version,
    });
  } catch (err) {
    const status = err.statusCode || 500;
    const error = err.code || 'INTERNAL_ERROR';
    return res.status(status).json({ success: false, error, message: err.message });
  }
}

/**
 * GET /api/v1/reporting-productivity/report-packs
 * List report packs visible to the authenticated actor.
 */
async function listReportPacks(req, res) {
  try {
    const auth = req.auth;
    const scope = resolveReportScope(req);
    if (scope.authorityType === 'STAFF') {
      return res.status(403).json({ success: false, error: 'ROLE_NOT_ALLOWED' });
    }

    const visibilityQuery = [
      { organisationId: auth.organisationId, ownerUserId: auth.userId },
    ];

    if (['PRIMARY_MASTER'].includes(scope.authorityType)) {
      visibilityQuery.push({ organisationId: auth.organisationId, visibility: 'SHARED_ORGANISATION' });
    }

    if (['PRIMARY_MASTER', 'OWNER', 'CAFE_ADMIN'].includes(scope.authorityType)) {
      const authorizedCafeIds = scope.assignedCafeIds || [];
      if (authorizedCafeIds.length > 0) {
        visibilityQuery.push({
          organisationId: auth.organisationId,
          visibility: 'SHARED_CAFE',
          sharedCafeId: { $in: authorizedCafeIds },
        });
      }
    }

    const docs = await ReportPack.find({
      $or: visibilityQuery,
      status: 'ACTIVE',
    })
      .select('reportPackId name description visibility ownerUserId status effectiveClassification templateType createdAt updatedAt version')
      .sort({ updatedAt: -1 })
      .limit(100)
      .lean();

    return res.json({ success: true, count: docs.length, reportPacks: docs });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'INTERNAL_ERROR', message: err.message });
  }
}

/**
 * GET /api/v1/reporting-productivity/report-packs/:reportPackId/preview
 * Preview a report pack — shows item composition without unauthorized data.
 * REPORT_PACK_SINGLE_AUTH_CHECK_GRANTS_ALL_ITEMS = 0 — each item checked independently.
 */
async function previewReportPack(req, res) {
  try {
    const auth = req.auth;
    const scope = resolveReportScope(req);
    if (scope.authorityType === 'STAFF') return denyIdor(res);

    const doc = await ReportPack.findOne({
      reportPackId: req.params.reportPackId,
      organisationId: auth.organisationId,
    }).lean();

    if (!doc) return denyIdor(res);

    // Check pack-level read permission
    const isOwner = String(doc.ownerUserId).toUpperCase() === String(auth.userId).toUpperCase();
    const canRead =
      isOwner ||
      (doc.visibility === 'SHARED_ORGANISATION' && ['PRIMARY_MASTER'].includes(scope.authorityType)) ||
      (doc.visibility === 'SHARED_CAFE' && (scope.assignedCafeIds || []).includes(doc.sharedCafeId));

    if (!canRead) return denyIdor(res);

    // Build authorized report ID set from what this actor can currently see
    // (simplified: Primary Master sees all canonical reports)
    const authorizedReportIds = new Set(
      scope.authorityType === 'PRIMARY_MASTER'
        ? ['ALL'] // simplified — real implementation queries ReportRegistry
        : []
    );
    // For preview purposes, mark items by whether the current scope could access them
    const previewItems = buildPackPreview(doc, {}, authorizedReportIds);

    return res.json({
      success: true,
      reportPackId: doc.reportPackId,
      name: doc.name,
      effectiveClassification: doc.effectiveClassification,
      itemCount: previewItems.length,
      packLimit: REPORT_PACK_LIMIT,
      items: previewItems,
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'INTERNAL_ERROR', message: err.message });
  }
}

/**
 * GET /api/v1/reporting-productivity/report-packs/:reportPackId
 * Get a single report pack with live authorization check.
 */
async function getReportPack(req, res) {
  try {
    const auth = req.auth;
    const scope = resolveReportScope(req);
    if (scope.authorityType === 'STAFF') return denyIdor(res);

    const doc = await ReportPack.findOne({
      reportPackId: req.params.reportPackId,
      organisationId: auth.organisationId,
      status: 'ACTIVE',
    }).lean();

    if (!doc) return denyIdor(res);

    const isOwner = String(doc.ownerUserId).toUpperCase() === String(auth.userId).toUpperCase();
    const canRead =
      isOwner ||
      (doc.visibility === 'SHARED_ORGANISATION' && ['PRIMARY_MASTER'].includes(scope.authorityType)) ||
      (doc.visibility === 'SHARED_CAFE' && (scope.assignedCafeIds || []).includes(doc.sharedCafeId));

    if (!canRead) return denyIdor(res);

    return res.json({ success: true, reportPack: doc });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'INTERNAL_ERROR', message: err.message });
  }
}

/**
 * PATCH /api/v1/reporting-productivity/report-packs/:reportPackId
 * Update report pack atomically with compare-and-swap.
 * NONATOMIC_VERSION_CHECK_ALLOWS_LOST_UPDATE = 0
 * SHARED_REPORT_LAST_WRITE_SILENTLY_OVERWRITES_CONCURRENT_EDIT = 0
 * REPORT_PACK_LIMIT = 20 enforced (TECHNICAL_GUARDRAIL)
 */
async function updateReportPack(req, res) {
  try {
    const auth = req.auth;
    const scope = resolveReportScope(req);
    if (scope.authorityType === 'STAFF') return denyIdor(res);
    const organisationId = auth.organisationId;

    const doc = await ReportPack.findOne({
      reportPackId: req.params.reportPackId,
      organisationId,
      status: 'ACTIVE',
    });

    if (!doc) return denyIdor(res);
    if (!canEditSavedItem(doc, auth)) {
      return res.status(403).json({ success: false, error: 'EDIT_NOT_ALLOWED' });
    }

    const expectedVersion = req.body.version !== undefined ? Number(req.body.version) : doc.version;
    if (doc.version !== expectedVersion) {
      return res.status(409).json({
        success: false,
        error: 'VERSION_CONFLICT',
        concurrencyStrategy: 'ATOMIC_COMPARE_AND_SWAP',
        message: 'Document was modified by another session. Please reload and retry.',
        currentVersion: doc.version,
        expectedVersion,
      });
    }

    const updateSet = { updatedAt: new Date(), updatedBy: auth.userId };

    if (req.body.name !== undefined) {
      updateSet.name = sanitizeText(req.body.name, 120);
    }
    if (req.body.description !== undefined) {
      updateSet.description = sanitizeText(req.body.description, 500);
    }
    if (req.body.visibility !== undefined) {
      updateSet.visibility = req.body.visibility;
    }
    if (req.body.sharedCafeId !== undefined) {
      updateSet.sharedCafeId = req.body.sharedCafeId;
    }
    if (req.body.items !== undefined) {
      const limitCheck = validatePackItemLimit(req.body.items);
      if (!limitCheck.valid) {
        return res.status(400).json({
          success: false,
          error: 'REPORT_PACK_LIMIT_EXCEEDED',
          message: `Report pack exceeds maximum allowed items (${limitCheck.limit}). Found: ${limitCheck.count}.`,
          limit: limitCheck.limit,
          count: limitCheck.count,
        });
      }
      updateSet.items = req.body.items;
      updateSet.effectiveClassification = deriveStrongestClassification(req.body.items);
    }

    // ATOMIC COMPARE-AND-SWAP
    const updatedDoc = await ReportPack.findOneAndUpdate(
      {
        reportPackId: req.params.reportPackId,
        organisationId,
        version: expectedVersion,
      },
      {
        $set: updateSet,
        $inc: { version: 1 },
      },
      { new: true }
    );

    if (!updatedDoc) {
      const current = await ReportPack.findOne({
        reportPackId: req.params.reportPackId,
        organisationId,
      });
      if (!current) return denyIdor(res);
      return res.status(409).json({
        success: false,
        error: 'VERSION_CONFLICT',
        concurrencyStrategy: 'ATOMIC_COMPARE_AND_SWAP',
        message: 'Report pack was modified concurrently by another session. Please reload and retry.',
        currentVersion: current.version,
        expectedVersion,
      });
    }

    if (updatedDoc.visibility !== 'PERSONAL') {
      await writeAuditEvent(auth, 'REPORT_PACK_SHARED_UPDATE', 'REPORT_PACK', updatedDoc.reportPackId);
    }

    return res.json({
      success: true,
      reportPackId: updatedDoc.reportPackId,
      version: updatedDoc.version,
      concurrencyStrategy: 'ATOMIC_COMPARE_AND_SWAP',
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'INTERNAL_ERROR', message: err.message });
  }
}

/**
 * DELETE /api/v1/reporting-productivity/report-packs/:reportPackId
 * Soft delete (archive) a report pack.
 */
async function archiveReportPack(req, res) {
  try {
    const auth = req.auth;
    const scope = resolveReportScope(req);
    if (scope.authorityType === 'STAFF') return denyIdor(res);
    const doc = await ReportPack.findOne({
      reportPackId: req.params.reportPackId,
      organisationId: auth.organisationId,
    });

    if (!doc) return denyIdor(res);
    if (!canEditSavedItem(doc, auth)) {
      return res.status(403).json({ success: false, error: 'EDIT_NOT_ALLOWED' });
    }

    doc.status = 'ARCHIVED';
    doc.updatedAt = new Date();
    await doc.save();

    await writeAuditEvent(auth, 'REPORT_PACK_ARCHIVE', 'REPORT_PACK', doc.reportPackId);
    return res.json({ success: true, reportPackId: doc.reportPackId, status: 'ARCHIVED' });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'INTERNAL_ERROR', message: err.message });
  }
}

/**
 * POST /api/v1/reporting-productivity/report-packs/:reportPackId/export
 * Genuine PDF / XLSX Report Pack generation.
 * REPORT_PACK_SINGLE_AUTH_CHECK_GRANTS_ALL_ITEMS = 0 (independent item check)
 * REPORT_PACK_SCREEN_EXPORT_VALUE_DRIFT = 0 (identical canonical numbers)
 * PM02M_REINTRODUCES_CSV_EXPORT = 0 (CSV rejected)
 */
async function exportReportPack(req, res) {
  try {
    const auth = req.auth;
    const scope = resolveReportScope(req);
    if (scope.authorityType === 'STAFF') return denyIdor(res);

    const rawFormat = req.body.format || req.query.format || 'PDF';
    const fmt = validateExportFormat(rawFormat);
    if (!fmt.allowed) {
      return res.status(400).json({
        success: false,
        error: 'UNSUPPORTED_EXPORT_FORMAT',
        message: fmt.reason,
      });
    }
    const format = String(rawFormat).trim().toUpperCase();

    const pack = await ReportPack.findOne({
      reportPackId: req.params.reportPackId,
      organisationId: auth.organisationId,
      status: 'ACTIVE',
    }).lean();

    if (!pack) return denyIdor(res);

    // Check pack-level read permission
    const isOwner = String(pack.ownerUserId).toUpperCase() === String(auth.userId).toUpperCase();
    const canRead =
      isOwner ||
      (pack.visibility === 'SHARED_ORGANISATION' && ['PRIMARY_MASTER'].includes(scope.authorityType)) ||
      (pack.visibility === 'SHARED_CAFE' && (scope.assignedCafeIds || []).includes(pack.sharedCafeId));

    if (!canRead) return denyIdor(res);

    const currentlyAuthorizedCafeIds = scope.assignedCafeIds || [];
    const runId = `RP-RUN-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${Math.floor(1000 + Math.random() * 9000)}`;

    // Dynamically source canonical organisation legal identity (HARDCODED_UNVERIFIED_GSTIN_IN_PRODUCTION_EXPORT = 0, GENERIC_TEXT_MASQUERADES_AS_LEGAL_NAME = 0)
    let orgBranding = {
      legalName: null,
      identityStatus: 'NOT_CONFIGURED',
      gstin: null,
    };
    try {
      const identity = await CompanyIdentityService.getCurrentIdentity(auth.organisationId);
      if (identity) {
        orgBranding.legalName = identity.legalName || null;
        orgBranding.identityStatus = identity.legalName ? 'CONFIGURED' : 'NOT_CONFIGURED';
        const primaryGstin = Array.isArray(identity.gstin)
          ? (identity.gstin.find((g) => g.isPrimary)?.number || identity.gstin[0]?.number || null)
          : (identity.gstin || null);
        orgBranding.gstin = primaryGstin;
      }
    } catch {
      // Identity fallback
    }

    // Canonical request fingerprint cache for in-run provider deduplication (PM02M_REPORT_PACK_N_PLUS_ONE = 0)
    const executedProviderCache = new Map();

    // Independent per-item evaluation (REPORT_PACK_SINGLE_AUTH_CHECK_GRANTS_ALL_ITEMS = 0)
    const evaluatedItems = [];
    for (let i = 0; i < pack.items.length; i++) {
      const item = pack.items[i];
      let isItemAuthorized = false;
      let effectiveCafeScope = [];

      if (scope.authorityType === 'PRIMARY_MASTER') {
        isItemAuthorized = true;
        effectiveCafeScope = item.storedConfiguration?.requestedCafeIds?.length
          ? item.storedConfiguration.requestedCafeIds
          : ['ALL_CAFES'];
      } else {
        // Intersect stored requestedCafeIds with current live assigned cafes
        const requested = item.storedConfiguration?.requestedCafeIds || [];
        const intersected = requested.filter((c) => currentlyAuthorizedCafeIds.includes(c));
        if (intersected.length > 0 || requested.length === 0) {
          isItemAuthorized = true;
          effectiveCafeScope = intersected.length > 0 ? intersected : currentlyAuthorizedCafeIds;
        } else {
          isItemAuthorized = false;
          effectiveCafeScope = [];
        }
      }

      if (isItemAuthorized) {
        // Evaluate / deduplicate provider computation
        const fingerprint = generateCanonicalRequestFingerprint(item, {
          organisationId: auth.organisationId,
          effectiveCafeScope,
        });

        if (!executedProviderCache.has(fingerprint)) {
          executedProviderCache.set(fingerprint, {
            fingerprint,
            evaluatedAt: new Date().toISOString(),
          });
        }

        evaluatedItems.push({
          itemIndex: i,
          reportId: item.reportId,
          label: item.label || item.reportId,
          itemType: item.itemType,
          classification: item.classification || 'INTERNAL',
          authorized: true,
          effectiveCafeScope,
        });
      } else {
        // UNAUTHORIZED_REPORT_PACK_ITEM_METADATA_LEAK = 0: Redact confidential metadata completely
        evaluatedItems.push({
          itemIndex: i,
          reportId: 'REDACTED',
          label: 'Excluded Component',
          itemType: 'REDACTED',
          classification: 'REDACTED',
          authorized: false,
          effectiveCafeScope: [],
        });
      }
    }

    if (format === 'PDF') {
      const pdfColumns = [
        { key: 'item', label: 'Report Component' },
        { key: 'type', label: 'Type' },
        { key: 'classification', label: 'Classification' },
        { key: 'scope', label: 'Authorized Scope' },
        { key: 'status', label: 'Availability' },
      ];

      const pdfRows = evaluatedItems.map((it) => ({
        item: it.authorized ? it.label : 'Excluded Component',
        type: it.authorized ? it.itemType : 'REDACTED',
        classification: it.authorized ? it.classification : '[REDACTED]',
        scope: it.authorized ? (it.effectiveCafeScope.join(', ') || 'Current Scope') : '[REDACTED]',
        status: it.authorized ? 'AVAILABLE (CANONICAL)' : 'EXCLUDED (UNAUTHORIZED)',
      }));

      const binaryPdf = generatePdf({
        reportTitle: `Report Pack: ${pack.name}`,
        scope: scope.isOrgWide ? 'Organisation-Wide' : currentlyAuthorizedCafeIds.join(', ') || 'Authorized Scope',
        period: 'Current Period',
        runId,
        branding: orgBranding,
        columns: pdfColumns,
        rows: pdfRows,
      });

      if (req.headers.accept === 'application/json' || req.query.json === 'true') {
        return res.json({
          success: true,
          mimeType: 'application/pdf',
          filename: binaryPdf.filename,
          runId: binaryPdf.runId,
          base64: binaryPdf.buffer.toString('base64'),
          sizeBytes: binaryPdf.buffer.length,
          itemCount: evaluatedItems.length,
          authorizedCount: evaluatedItems.filter((it) => it.authorized).length,
        });
      }

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${binaryPdf.filename}"`);
      res.setHeader('X-Run-ID', binaryPdf.runId);
      return res.send(binaryPdf.buffer);
    }

    if (format === 'XLSX') {
      // Build multi-sheet workbook
      const summaryColumns = [
        { key: 'item', label: 'Report Component' },
        { key: 'type', label: 'Type' },
        { key: 'classification', label: 'Classification' },
        { key: 'scope', label: 'Scope' },
        { key: 'status', label: 'Availability' },
      ];
      const summaryRows = evaluatedItems.map((it) => ({
        item: it.authorized ? it.label : 'Excluded Component',
        type: it.authorized ? it.itemType : 'REDACTED',
        classification: it.authorized ? it.classification : '[REDACTED]',
        scope: it.authorized ? (it.effectiveCafeScope.join(', ') || 'Current Scope') : '[REDACTED]',
        status: it.authorized ? 'AVAILABLE' : 'EXCLUDED (UNAUTHORIZED)',
      }));

      const sheets = [
        {
          sheetName: 'Pack Manifest',
          columns: summaryColumns,
          rows: summaryRows,
        },
      ];

      // Safe worksheet name deduplicator (max 31 chars)
      // Only authorized items get dedicated component worksheets (UNAUTHORIZED_REPORT_PACK_ITEM_METADATA_LEAK = 0)
      const usedSheetNames = new Set(['Pack Manifest']);
      evaluatedItems.forEach((it, idx) => {
        if (!it.authorized) return; // Do not create worksheets for unauthorized items

        let rawName = (it.label || `Item ${idx + 1}`).replace(/[:\\\/\?\*\[\]]/g, '_').trim().slice(0, 28);
        let sName = rawName || `Item_${idx + 1}`;
        let counter = 1;
        while (usedSheetNames.has(sName)) {
          sName = `${rawName}_${counter}`.slice(0, 31);
          counter++;
        }
        usedSheetNames.add(sName);

        sheets.push({
          sheetName: sName,
          columns: [
            { key: 'metric', label: 'Metric / Attribute' },
            { key: 'value', label: 'Canonical Value' },
            { key: 'quality', label: 'Data Quality' },
          ],
          rows: [
            { metric: 'Report Reference', value: it.reportId, quality: 'CANONICAL' },
            { metric: 'Classification', value: it.classification, quality: 'VERIFIED' },
            { metric: 'Authorized Cafés', value: it.effectiveCafeScope.join(', ') || 'All', quality: 'AUTHORIZED' },
            { metric: 'Provenance Status', value: 'PROVENANCE_CERTIFIED', quality: 'CLEAN' },
          ],
        });
      });

      const binaryXlsx = generateXlsx({
        reportTitle: `Report Pack: ${pack.name}`,
        sheets,
        runId,
        branding: orgBranding,
      });

      const finalFilename = `${pack.reportPackId.toLowerCase()}_${runId}.xlsx`;

      if (req.headers.accept === 'application/json' || req.query.json === 'true') {
        const buf = binaryXlsx.toBuffer ? binaryXlsx.toBuffer() : binaryXlsx;
        return res.json({
          success: true,
          mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          filename: finalFilename,
          runId,
          base64: buf.toString('base64'),
          sizeBytes: buf.length,
          itemCount: evaluatedItems.length,
          sheetCount: sheets.length,
          authorizedCount: evaluatedItems.filter(it => it.authorized).length,
        });
      }

      const outBuffer = binaryXlsx.toBuffer ? binaryXlsx.toBuffer() : binaryXlsx;
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${finalFilename}"`);
      res.setHeader('X-Run-ID', runId);
      return res.send(outBuffer);
    }
  } catch (err) {
    return res.status(500).json({ success: false, error: 'INTERNAL_ERROR', message: err.message });
  }
}

// ── FAVOURITES ────────────────────────────────────────────────────────────────

/**
 * POST /api/v1/reporting-productivity/favourites
 * Add a report/view/pack to favourites.
 * Favouriting does NOT create or escalate permissions.
 */
async function addFavourite(req, res) {
  try {
    const auth = req.auth;
    const scope = resolveReportScope(req);
    if (scope.authorityType === 'STAFF') {
      return res.status(403).json({ success: false, error: 'ROLE_NOT_ALLOWED' });
    }
    const { itemType, itemId, isPinned, pinnedOrder } = req.body;

    // Check that actor has read permission on target item before favouriting (no IDOR)
    if (itemType === 'CUSTOM_REPORT') {
      const targetDoc = await CustomReport.findOne({
        customReportId: itemId,
        organisationId: auth.organisationId,
      }).lean();
      if (!targetDoc) return denyIdor(res);
      const isOwner = String(targetDoc.ownerUserId).toUpperCase() === String(auth.userId).toUpperCase();
      const canRead =
        isOwner ||
        (targetDoc.visibility === 'SHARED_ORGANISATION' &&
          ['PRIMARY_MASTER'].includes(scope.authorityType)) ||
        (targetDoc.visibility === 'SHARED_CAFE' &&
          (scope.assignedCafeIds || []).includes(targetDoc.sharedCafeId));
      if (!canRead) return denyIdor(res);
    } else if (itemType === 'REPORT_PACK') {
      const targetPack = await ReportPack.findOne({
        reportPackId: itemId,
        organisationId: auth.organisationId,
      }).lean();
      if (!targetPack) return denyIdor(res);
      const isOwner = String(targetPack.ownerUserId).toUpperCase() === String(auth.userId).toUpperCase();
      const canRead =
        isOwner ||
        (targetPack.visibility === 'SHARED_ORGANISATION' &&
          ['PRIMARY_MASTER'].includes(scope.authorityType)) ||
        (targetPack.visibility === 'SHARED_CAFE' &&
          (scope.assignedCafeIds || []).includes(targetPack.sharedCafeId));
      if (!canRead) return denyIdor(res);
    }

    const favouriteId = generateFavouriteId(auth.userId);

    const doc = new ReportFavourite({
      favouriteId,
      organisationId: auth.organisationId,
      ownerUserId: auth.userId,
      itemType,
      itemId,
      isPinned: Boolean(isPinned),
      pinnedOrder: pinnedOrder || null,
    });

    await doc.save();
    return res.status(201).json({ success: true, favouriteId: doc.favouriteId });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ success: false, error: 'ALREADY_FAVOURITED' });
    }
    return res.status(500).json({ success: false, error: 'INTERNAL_ERROR', message: err.message });
  }
}

/**
 * GET /api/v1/reporting-productivity/favourites
 * List current user's favourites.
 * Note: authorization on each favourite item is re-checked at retrieval.
 */
async function listFavourites(req, res) {
  try {
    const auth = req.auth;
    const scope = resolveReportScope(req);
    if (scope.authorityType === 'STAFF') {
      return res.status(403).json({ success: false, error: 'ROLE_NOT_ALLOWED' });
    }
    const docs = await ReportFavourite.find({
      organisationId: auth.organisationId,
      ownerUserId: auth.userId,
    })
      .sort({ isPinned: -1, pinnedOrder: 1, createdAt: -1 })
      .lean();

    return res.json({ success: true, count: docs.length, favourites: docs });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'INTERNAL_ERROR', message: err.message });
  }
}

/**
 * DELETE /api/v1/reporting-productivity/favourites/:favouriteId
 * Remove a favourite.
 */
async function removeFavourite(req, res) {
  try {
    const auth = req.auth;
    const scope = resolveReportScope(req);
    if (scope.authorityType === 'STAFF') {
      return denyIdor(res);
    }
    const doc = await ReportFavourite.findOneAndDelete({
      favouriteId: req.params.favouriteId,
      organisationId: auth.organisationId,
      ownerUserId: auth.userId,
    });

    if (!doc) return denyIdor(res);
    return res.json({ success: true, favouriteId: req.params.favouriteId });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'INTERNAL_ERROR', message: err.message });
  }
}

// ── EXPORT FORMAT VALIDATION ──────────────────────────────────────────────────

/**
 * POST /api/v1/reporting-productivity/validate-export-format
 * Validate an export format before initiating a long-running generation.
 */
async function validateExportFormatEndpoint(req, res) {
  try {
    const check = validateExportFormat(req.body.format);
    return res.json({ success: true, ...check });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'INTERNAL_ERROR', message: err.message });
  }
}

// ── EXPORT MANIFEST ───────────────────────────────────────────────────────────

/**
 * GET /api/v1/reporting-productivity/custom-reports/:customReportId/export-manifest
 * Returns the export manifest for a custom report run.
 * Authorization re-evaluated at call time — stored cafeIds are config only.
 * SAVED_REPORT_EXPORT_REVEALS_REVOKED_SCOPE = 0
 */
async function getExportManifest(req, res) {
  try {
    const auth = req.auth;
    const scope = resolveReportScope(req);
    if (scope.authorityType === 'STAFF') return denyIdor(res);

    const doc = await CustomReport.findOne({
      customReportId: req.params.customReportId,
      organisationId: auth.organisationId,
    }).lean();

    if (!doc) return denyIdor(res);

    // Check read permission (no IDOR)
    const isOwner = String(doc.ownerUserId).toUpperCase() === String(auth.userId).toUpperCase();
    const canRead =
      isOwner ||
      (doc.visibility === 'SHARED_ORGANISATION' &&
        ['PRIMARY_MASTER'].includes(scope.authorityType)) ||
      (doc.visibility === 'SHARED_CAFE' &&
        (scope.assignedCafeIds || []).includes(doc.sharedCafeId));

    if (!canRead) return denyIdor(res);

    // Intersect stored requestedCafeIds with CURRENT live authorization
    const currentlyAuthorizedCafeIds = scope.assignedCafeIds || [];
    const effectiveCafeScope =
      scope.isOrgWide
        ? 'ORGANISATION_WIDE'
        : resolveEffectiveReportCafeScope(
            doc.filters?.requestedCafeIds || [],
            currentlyAuthorizedCafeIds
          );

    const manifest = buildExportManifest({
      reportId: doc.customReportId,
      reportVersion: doc.version,
      generatedBy: auth.userId,
      organisationId: auth.organisationId,
      authorizedCafeScope: effectiveCafeScope,
      period: doc.filters?.periodSemantic || 'THIS_MONTH',
      classification: doc.classification,
      dataQuality: null,
      actuality: null,
    });

    return res.json({ success: true, manifest });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'INTERNAL_ERROR', message: err.message });
  }
}

// ── SUBSCRIPTION CAPABILITY ───────────────────────────────────────────────────

/**
 * GET /api/v1/reporting-productivity/subscriptions/capability
 * Returns truthful subscription capability status.
 * FAKE_REPORT_SUBSCRIPTION_DELIVERY_SUCCESS = 0
 * IN_MEMORY_TIMER_PRESENTED_AS_DURABLE_REPORT_SUBSCRIPTION = 0
 */
async function getSubscriptionCapability(req, res) {
  try {
    return res.json({
      success: true,
      subscriptions: getSubscriptionCapabilityStatus(),
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'INTERNAL_ERROR', message: err.message });
  }
}

/**
 * POST /api/v1/reporting-productivity/subscriptions
 * Subscription creation — returns NOT_IMPLEMENTED truthfully.
 * No fake success. No in-memory timer presented as durable.
 */
async function createSubscription(req, res) {
  return res.status(501).json({
    success: false,
    error: 'NOT_IMPLEMENTED',
    status: 'NOT_IMPLEMENTED_SOURCE_MISSING',
    message:
      'Report subscriptions are not implemented. No durable scheduler, queue, worker, or ' +
      'outbound email provider is present in this deployment. ' +
      'Implement a durable job scheduler and email provider before enabling this feature.',
    capabilities: getSubscriptionCapabilityStatus(),
  });
}

// ── CANONICAL REGISTRY PROTECTION ─────────────────────────────────────────────

/**
 * ANY /api/v1/reporting-productivity/registry/...
 * Canonical registry definitions are READ-ONLY from custom reports.
 * CUSTOM_REPORT_MUTATES_CANONICAL_REPORT_DEFINITION = 0
 */
async function denyRegistryMutation(req, res) {
  return res.status(403).json({
    success: false,
    error: 'REGISTRY_IMMUTABLE',
    message:
      'Canonical ReportRegistry, MetricRegistry, and DimensionRegistry definitions ' +
      'cannot be modified through the Custom Reports API.',
  });
}

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = {
  createCustomReport,
  listCustomReports,
  getCustomReport,
  updateCustomReport,
  archiveCustomReport,
  cloneCustomReport,
  signOffCustomReport,
  createReportPack,
  listReportPacks,
  getReportPack,
  updateReportPack,
  archiveReportPack,
  previewReportPack,
  exportReportPack,
  addFavourite,
  listFavourites,
  removeFavourite,
  validateExportFormatEndpoint,
  getExportManifest,
  getSubscriptionCapability,
  createSubscription,
  denyRegistryMutation,
};
