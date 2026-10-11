'use strict';

const express = require('express');
const { authenticate } = require('../middleware/authenticate');
const onboardingMigrationController = require('../controllers/onboardingMigrationController');

const router = express.Router();

router.use(authenticate);

// 1. Onboarding Summary & Readiness Profile
router.get('/onboarding/:cafeId', (req, res, next) => onboardingMigrationController.getOnboardingSummary(req, res, next));

// 2. Outlet Copy Settings (F192, F193, F194)
router.post('/outlet-copy/preview', (req, res, next) => onboardingMigrationController.previewOutletCopySettings(req, res, next));
router.post('/outlet-copy/execute', (req, res, next) => onboardingMigrationController.executeOutletCopySettings(req, res, next));
router.get('/outlet-copy/logs', (req, res, next) => onboardingMigrationController.getCopyLogs(req, res, next));

// 3. Controlled Migration Workflow & Dry-Run (F126, F169, F341, A093, A095)
router.post('/migration/preview', (req, res, next) => onboardingMigrationController.previewMigration(req, res, next));
router.post('/migration/:migrationRunId/confirm', (req, res, next) => onboardingMigrationController.confirmMigration(req, res, next));
router.get('/migration/export/:domain', (req, res, next) => onboardingMigrationController.exportDomainCsv(req, res, next));

module.exports = router;
