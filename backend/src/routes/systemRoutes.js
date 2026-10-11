'use strict';

/**
 * ============================================================================
 * ZAMORIN CAFÉ ERP — SYSTEM OPERATIONS & HEALTH ROUTES
 * ============================================================================
 * Administrative API endpoints for Primary Master and Owner roles to monitor
 * system health, alerts, storage capacity, kill switches, and maintenance mode.
 */

const express = require('express');
const router = express.Router();

const { authenticate } = require('../middleware/authenticate');
const { authorize } = require('../middleware/authorize');
const { operationalAlertService } = require('../services/operationalAlertService');
const { documentReconciliationService } = require('../services/documentReconciliationService');
const { featureFlagService } = require('../services/featureFlagService');
const { maintenanceManager } = require('../middleware/maintenanceMode');
const { releaseService } = require('../services/releaseService');
const { scheduledJobRegistry } = require('../services/scheduledJobRegistry');
const { backupVerificationService } = require('../services/backupVerificationService');
const { documentStorageAdapter } = require('../services/documentStorageAdapter');

// Restrict all operational routes strictly to MASTER and OWNER
router.use(authenticate);
router.use(authorize(['MASTER', 'PRIMARY_MASTER', 'OWNER']));

/**
 * GET /api/v1/system/overview
 * Comprehensive system health overview.
 */
router.get('/overview', async (req, res, next) => {
  try {
    const storageState = await documentStorageAdapter.healthCheck().catch((err) => ({ status: 'ERROR', message: err.message }));
    const storageCapacity = await documentReconciliationService.assessStorageCapacity();
    const activeAlerts = await operationalAlertService.listActiveAlerts({ organisationId: req.auth.organisationId, limit: 10 });
    const release = await releaseService.getActiveRelease();
    const jobHealth = scheduledJobRegistry.auditJobHealth();
    const maintenance = maintenanceManager.getState();
    const flags = featureFlagService.getAllFlags();

    res.json({
      success: true,
      data: {
        timestamp: new Date().toISOString(),
        system: {
          uptimeSeconds: Math.floor(process.uptime()),
          nodeVersion: process.version,
          environment: process.env.NODE_ENV || 'production',
          serviceName: 'zamorin-cafe-erp-api',
        },
        release: {
          releaseId: release.releaseId,
          version: release.version,
          gitCommit: release.gitCommit,
          status: release.releaseStatus,
        },
        storage: {
          driver: storageState.driver || 'RENDER_PERSISTENT_DISK',
          health: storageState.status,
          capacity: storageCapacity,
        },
        alerts: {
          activeCount: activeAlerts.length,
          recent: activeAlerts,
        },
        jobs: jobHealth,
        maintenance,
        featureFlags: flags.flags,
      },
      correlationId: req.correlationId || null,
      requestId: req.requestId || null,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/v1/system/alerts
 */
router.get('/alerts', async (req, res, next) => {
  try {
    const alerts = await operationalAlertService.listActiveAlerts({
      organisationId: req.auth.organisationId,
      severity: req.query.severity || null,
    });
    res.json({ success: true, data: alerts, count: alerts.length });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/v1/system/alerts/:alertId/ack
 */
router.post('/alerts/:alertId/ack', async (req, res, next) => {
  try {
    const alert = await operationalAlertService.acknowledgeAlert({
      alertId: req.params.alertId,
      userId: req.auth.userId,
      organisationId: req.auth.organisationId,
    });
    res.json({ success: true, data: alert });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/v1/system/alerts/:alertId/resolve
 */
router.post('/alerts/:alertId/resolve', async (req, res, next) => {
  try {
    const alert = await operationalAlertService.resolveAlert({
      alertId: req.params.alertId,
      userId: req.auth.userId,
      resolution: req.body.resolution || 'Resolved by operational administrator',
      organisationId: req.auth.organisationId,
    });
    res.json({ success: true, data: alert });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/v1/system/storage
 */
router.get('/storage', async (req, res, next) => {
  try {
    const capacity = await documentReconciliationService.assessStorageCapacity();
    res.json({ success: true, data: capacity });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/v1/system/reconcile-documents
 */
router.post('/reconcile-documents', async (req, res, next) => {
  try {
    const result = await documentReconciliationService.reconcileDocuments({
      organisationId: req.auth.organisationId,
      verifyChecksums: Boolean(req.body.verifyChecksums !== false),
    });
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/v1/system/feature-flags
 */
router.get('/feature-flags', (req, res) => {
  res.json({ success: true, data: featureFlagService.getAllFlags() });
});

/**
 * POST /api/v1/system/feature-flags
 */
router.post('/feature-flags', (req, res) => {
  const { flagKey, value, reason } = req.body;
  const result = featureFlagService.setFlag(flagKey, value, {
    actorId: req.auth.userId,
    actorRole: req.auth.role,
    reason: reason || 'Admin updated feature flag via System Operations',
  });
  res.json({ success: true, data: result });
});

/**
 * GET /api/v1/system/maintenance
 */
router.get('/maintenance', (req, res) => {
  res.json({ success: true, data: maintenanceManager.getState() });
});

/**
 * POST /api/v1/system/maintenance
 */
router.post('/maintenance', (req, res) => {
  const { enabled, reason, message, scheduledEnd, readOnly } = req.body;
  let state;
  if (readOnly !== undefined) {
    state = maintenanceManager.setReadOnlyMode({ enabled: readOnly, reason });
  } else {
    state = maintenanceManager.setMaintenanceMode({ enabled, reason, message, scheduledEnd });
  }
  res.json({ success: true, data: state });
});

/**
 * GET /api/v1/system/backup
 */
router.get('/backup', async (req, res, next) => {
  try {
    const readiness = await backupVerificationService.assessBackupReadiness();
    res.json({ success: true, data: readiness });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/v1/system/backup/drill
 */
router.post('/backup/drill', async (req, res, next) => {
  try {
    const drill = await backupVerificationService.executeNonDestructiveRestoreDrill({
      organisationId: req.auth.organisationId,
    });
    res.json({ success: true, data: drill });
  } catch (err) {
    next(err);
  }
});

// ── P20 Own-Server Readiness & Authoritative Backup / Restore Rehearsal ──────

const { ServerReadinessService } = require('../services/serverReadinessService');
const { backupRecoveryService } = require('../services/backupRecoveryService');

/**
 * GET /api/v1/system/readiness
 * Returns comprehensive own-server dependency readiness and actionable remediations.
 */
router.get('/readiness', async (req, res, next) => {
  try {
    const report = await ServerReadinessService.getFullReadinessReport();
    res.status(report.readyForBusiness ? 200 : 503).json({
      success: report.readyForBusiness,
      data: report,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/v1/system/backup/create
 * Creates a persistent non-destructive database snapshot archive.
 */
router.post('/backup/create', async (req, res, next) => {
  try {
    if (req.auth.role === 'OWNER') {
      return res.status(403).json({
        success: false,
        error: { code: 'OWNER_READ_ONLY', message: 'Owner role is strictly read-only for operational mutations.' },
      });
    }

    const backup = await backupRecoveryService.createBackup({
      scope: req.body.scope || 'FULL_ENTERPRISE',
      cafeId: req.body.cafeId || null,
      actor: {
        userId: req.auth.userId,
        role: req.auth.role,
        isPrimaryMaster: Boolean(req.auth.isPrimaryMaster),
        organisationId: req.auth.organisationId,
      },
    });

    res.status(200).json({
      success: true,
      message: `Backup ${backup.backupId} created successfully.`,
      data: backup,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/v1/system/backup/list
 * Lists persisted backup archives.
 */
router.get('/backup/list', async (req, res, next) => {
  try {
    const list = await backupRecoveryService.listBackups(req.auth.organisationId);
    res.status(200).json({
      success: true,
      data: { backups: list, total: list.length },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/v1/system/backup/:backupId/verify
 * Cryptographically verifies backup archive SHA-256 integrity on disk.
 */
router.post('/backup/:backupId/verify', async (req, res, next) => {
  try {
    const result = await backupRecoveryService.verifyBackupIntegrity(req.params.backupId, {
      userId: req.auth.userId,
      role: req.auth.role,
    });
    res.status(200).json({
      success: true,
      message: `Backup ${req.params.backupId} cryptographically verified.`,
      data: result,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/v1/system/backup/:backupId/rehearsal
 * Authorizes and executes a non-destructive restore rehearsal into an isolated test target.
 */
router.post('/backup/:backupId/rehearsal', async (req, res, next) => {
  try {
    if (req.auth.role === 'OWNER') {
      return res.status(403).json({
        success: false,
        error: { code: 'OWNER_READ_ONLY', message: 'Owner role is strictly read-only for operational mutations.' },
      });
    }

    const result = await backupRecoveryService.executeRestoreRehearsal({
      backupId: req.params.backupId,
      targetDbName: req.body.targetDbName,
      targetConfirmation: req.body.targetConfirmation,
      restoreVerificationMode: req.body.restoreVerificationMode,
      actor: {
        userId: req.auth.userId,
        role: req.auth.role,
        isPrimaryMaster: Boolean(req.auth.isPrimaryMaster),
        organisationId: req.auth.organisationId,
      },
    });

    res.status(200).json({
      success: true,
      message: `Restore rehearsal ${result.rehearsalId} completed successfully into isolated target ${result.targetDbName}.`,
      data: result,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;

