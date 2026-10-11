'use strict';

const controlledDataMigrationService = require('../services/controlledDataMigrationService');
const { ApiError } = require('../utils/ApiError');

function assertNotRetired(req) {
  const role = (req.auth?.role || '').toUpperCase();
  if (role === 'NORMAL_MASTER' || req.auth?.isNormalMaster || role === 'MASTER_DECOMMISSIONED') {
    throw new ApiError(403, 'ROLE_RETIRED', 'Normal Master persona has been permanently decommissioned. Access denied.');
  }
}

function assertAuthorizedPersona(req) {
  assertNotRetired(req);
  const role = (req.auth?.role || '').toUpperCase();
  if (!['MASTER', 'OWNER', 'CAFE_ADMIN'].includes(role)) {
    throw new ApiError(403, 'FORBIDDEN', 'Insufficient permissions for onboarding and migration operations.');
  }
}

function assertWritePermission(req) {
  assertNotRetired(req);
  const role = (req.auth?.role || '').toUpperCase();
  if (role === 'OWNER') {
    throw new ApiError(403, 'OWNER_READ_ONLY', 'Owner persona is strictly read-only for onboarding and migration operations.');
  }
  if (!['MASTER', 'CAFE_ADMIN'].includes(role)) {
    throw new ApiError(403, 'FORBIDDEN', 'Write operations require Master or authorized Café Operations roles.');
  }
}

function assertCafeScope(req, targetCafeId) {
  assertNotRetired(req);
  const role = (req.auth?.role || '').toUpperCase();
  if (role === 'MASTER' || role === 'OWNER') {
    return; // Enterprise-wide
  }
  if (role === 'CAFE_ADMIN') {
    const userCafeId = (req.auth?.cafeId || '').toUpperCase();
    const assigned = (req.auth?.assignedCafes || []).map((c) => c.toUpperCase());
    const target = (targetCafeId || '').toUpperCase();

    if (target && target !== userCafeId && !assigned.includes(target)) {
      throw new ApiError(403, 'CAFE_ACCESS_DENIED', `Access to café ${target} is not permitted for your credentials.`);
    }
  }
}

class OnboardingMigrationController {
  // 1. Onboarding Summary & Readiness Profile
  async getOnboardingSummary(req, res, next) {
    try {
      assertAuthorizedPersona(req);
      const organisationId = req.auth?.organisationId || 'ORG-ZAMORIN';
      const cafeId = req.params.cafeId || req.query.cafeId;
      if (cafeId) assertCafeScope(req, cafeId);

      const summary = await controlledDataMigrationService.getOnboardingSummary({
        organisationId,
        cafeId,
      });

      return res.status(200).json({
        success: true,
        data: summary,
      });
    } catch (err) {
      next(err);
    }
  }

  // 2. Outlet Copy Settings Preview (F192, F193)
  async previewOutletCopySettings(req, res, next) {
    try {
      assertAuthorizedPersona(req);
      const organisationId = req.auth?.organisationId || 'ORG-ZAMORIN';
      const { sourceCafeId, destinationCafeId, sections } = req.body;

      assertCafeScope(req, destinationCafeId);

      const preview = await controlledDataMigrationService.previewOutletCopySettings({
        organisationId,
        sourceCafeId,
        destinationCafeId,
        sections,
      });

      return res.status(200).json({
        success: true,
        data: preview,
      });
    } catch (err) {
      next(err);
    }
  }

  // 3. Execute Outlet Copy Settings (F192, F193, F194)
  async executeOutletCopySettings(req, res, next) {
    try {
      assertWritePermission(req);
      const organisationId = req.auth?.organisationId || 'ORG-ZAMORIN';
      const { sourceCafeId, destinationCafeId, sections, reason } = req.body;

      assertCafeScope(req, destinationCafeId);

      const result = await controlledDataMigrationService.executeOutletCopySettings({
        organisationId,
        sourceCafeId,
        destinationCafeId,
        sections,
        reason,
        user: req.auth,
      });

      return res.status(200).json({
        success: true,
        message: 'Outlet configuration synchronized successfully.',
        data: result,
      });
    } catch (err) {
      next(err);
    }
  }

  // 4. Copy Logs & History (F125, F194)
  async getCopyLogs(req, res, next) {
    try {
      assertAuthorizedPersona(req);
      const organisationId = req.auth?.organisationId || 'ORG-ZAMORIN';
      const cafeId = req.query.cafeId;
      if (cafeId) assertCafeScope(req, cafeId);

      const logs = await controlledDataMigrationService.getCopyLogs({
        organisationId,
        cafeId,
      });

      return res.status(200).json({
        success: true,
        data: logs,
      });
    } catch (err) {
      next(err);
    }
  }

  // 5. Create Migration Preview / Dry-Run (F126, F169, F341, A093)
  async previewMigration(req, res, next) {
    try {
      assertWritePermission(req);
      const organisationId = req.auth?.organisationId || 'ORG-ZAMORIN';
      const { domain, sourceFileName, sourceFormat, records, cafeId, idempotencyKey } = req.body;
      if (cafeId) assertCafeScope(req, cafeId);

      const draft = await controlledDataMigrationService.createMigrationDraft({
        organisationId,
        cafeId,
        domain,
        sourceFileName,
        sourceFormat,
        records,
        idempotencyKey,
        user: req.auth,
      });

      return res.status(201).json({
        success: true,
        data: draft,
      });
    } catch (err) {
      next(err);
    }
  }

  // 6. Confirm and Execute Migration Run (F126, F169, F341, A095)
  async confirmMigration(req, res, next) {
    try {
      assertWritePermission(req);
      const organisationId = req.auth?.organisationId || 'ORG-ZAMORIN';
      const { migrationRunId } = req.params;
      const { allowPartialCommit } = req.body || {};

      const result = await controlledDataMigrationService.confirmAndExecuteMigration({
        organisationId,
        migrationRunId,
        allowPartialCommit: Boolean(allowPartialCommit),
        user: req.auth,
      });

      return res.status(200).json({
        success: true,
        message: 'Data migration committed successfully.',
        data: result,
      });
    } catch (err) {
      next(err);
    }
  }

  // 7. Export Domain Workbook CSV with Formula Sanitization (A094, A101)
  async exportDomainCsv(req, res, next) {
    try {
      assertAuthorizedPersona(req);
      const organisationId = req.auth?.organisationId || 'ORG-ZAMORIN';
      const { domain } = req.params;
      const cafeId = req.query.cafeId;
      if (cafeId) assertCafeScope(req, cafeId);

      const csvContent = await controlledDataMigrationService.exportDomainWorkbookCsv({
        organisationId,
        cafeId,
        domain,
      });

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="${domain.toLowerCase()}_export.csv"`);
      return res.status(200).send(csvContent);
    } catch (err) {
      next(err);
    }
  }
}

module.exports = new OnboardingMigrationController();
