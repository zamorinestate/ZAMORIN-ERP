'use strict';

const express = require('express');
const { authenticate } = require('../middleware/authenticate');
const {
  listTargetedUpdates,
  checkForUpdates,
  publishRelease,
  downloadPackage,
  applyRelease,
  verifyRelease,
  rollbackRelease,
  planUpdateRun,
  executeControlledUpdate,
  rollbackControlledUpdate,
} = require('../controllers/updateController');

const router = express.Router();

router.use(authenticate);

// ── Role-Targeted Update Endpoints ───────────────────────────────────────────
router.get('/', listTargetedUpdates);
router.get('/check', checkForUpdates);
router.post('/', publishRelease);
router.get('/:releaseId/download', downloadPackage);
router.post('/:releaseId/apply', applyRelease);
router.post('/:releaseId/verify', verifyRelease);
router.post('/:releaseId/rollback', rollbackRelease);

// ── P20 Controlled Update Planning & State Machine Execution ─────────────────
router.post('/plan', planUpdateRun);
router.post('/execute', executeControlledUpdate);
router.post('/runs/:updateRunId/rollback', rollbackControlledUpdate);

module.exports = router;

