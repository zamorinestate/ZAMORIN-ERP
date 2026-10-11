'use strict';

/**
 * TASK ROUTES — P16 Tasks, Training & SOPs Parity
 * Mounted at: /api/v1/tasks (registered in routes/index.js)
 */

const express = require('express');
const { authenticate } = require('../middleware/authenticate');
const { authorize } = require('../middleware/authorize');
const {
  listTasks,
  getTask,
  createTask,
  updateTaskStatus,
  completeTask,
  verifyTask,
  returnTask,
  reopenTask,
  cancelTask,
  blockTask,
  reassignTask,
  submitTaskEvidence,
  listTemplates,
  createTemplate,
  getTemplate,
  updateTemplate,
  runScheduler,
  processOverdue,
  getComplianceReport,
  getMyTasks,
  assignTraining,
  submitTrainingAssessment,
  getMyTraining,
} = require('../controllers/taskController');

const router = express.Router();

router.use(authenticate);

// ── STAFF SELF-SERVICE ROUTES ────────────────────────────────────────────────
router.get(
  '/my-tasks',
  authorize('TASKS_READ', { allowedRoles: ['MASTER', 'CAFE_ADMIN', 'STAFF'] }),
  getMyTasks
);

router.get(
  '/training/my-training',
  authorize('TRAINING_READ', { allowedRoles: ['MASTER', 'CAFE_ADMIN', 'STAFF'] }),
  getMyTraining
);

router.post(
  '/training/:trainingId/assessment',
  authorize('TRAINING_WRITE', { allowedRoles: ['MASTER', 'CAFE_ADMIN', 'STAFF'] }),
  submitTrainingAssessment
);

// ── TRAINING ASSIGNMENT ──────────────────────────────────────────────────────
router.post(
  '/training/assign',
  authorize('TRAINING_WRITE', { allowedRoles: ['MASTER', 'CAFE_ADMIN'] }),
  assignTraining
);

// ── COMPLIANCE & MULTI-OUTLET REPORTS (F331, F333) ───────────────────────────
router.get(
  '/reports/compliance',
  authorize('TASKS_READ', { allowedRoles: ['MASTER', 'OWNER', 'CAFE_ADMIN'] }),
  getComplianceReport
);

// ── TASK TEMPLATES & CHECKLISTS (F326) ───────────────────────────────────────
router.get(
  '/templates',
  authorize('TASKS_READ', { allowedRoles: ['MASTER', 'OWNER', 'CAFE_ADMIN'] }),
  listTemplates
);

router.post(
  '/templates',
  authorize('TASKS_WRITE', { allowedRoles: ['MASTER', 'CAFE_ADMIN'] }),
  createTemplate
);

router.get(
  '/templates/:templateId',
  authorize('TASKS_READ', { allowedRoles: ['MASTER', 'OWNER', 'CAFE_ADMIN'] }),
  getTemplate
);

router.patch(
  '/templates/:templateId',
  authorize('TASKS_WRITE', { allowedRoles: ['MASTER', 'CAFE_ADMIN'] }),
  updateTemplate
);

// ── SCHEDULER & RECURRING GENERATION (F326, F330) ───────────────────────────
router.post(
  '/scheduler/run',
  authorize('TASKS_WRITE', { allowedRoles: ['MASTER', 'CAFE_ADMIN'] }),
  runScheduler
);

router.post(
  '/scheduler/overdue',
  authorize('TASKS_WRITE', { allowedRoles: ['MASTER', 'CAFE_ADMIN'] }),
  processOverdue
);

// ── GENERAL TASK LISTING & CREATION ──────────────────────────────────────────
router.get(
  '/',
  authorize('TASKS_READ', { allowedRoles: ['MASTER', 'OWNER', 'CAFE_ADMIN', 'STAFF'] }),
  listTasks
);

router.post(
  '/',
  authorize('TASKS_WRITE', { allowedRoles: ['MASTER', 'CAFE_ADMIN'] }),
  createTask
);

// ── SINGLE TASK DETAIL & LIFECYCLE MUTATIONS ────────────────────────────────
router.get(
  '/:taskId',
  authorize('TASKS_READ', { allowedRoles: ['MASTER', 'OWNER', 'CAFE_ADMIN', 'STAFF'] }),
  getTask
);

router.patch(
  '/:taskId/status',
  authorize('TASKS_WRITE', { allowedRoles: ['MASTER', 'CAFE_ADMIN', 'STAFF'] }),
  updateTaskStatus
);

router.post(
  '/:taskId/submit-evidence',
  authorize('TASKS_WRITE', { allowedRoles: ['MASTER', 'CAFE_ADMIN', 'STAFF'] }),
  submitTaskEvidence
);

router.post(
  '/:taskId/complete',
  authorize('TASKS_WRITE', { allowedRoles: ['MASTER', 'CAFE_ADMIN', 'STAFF'] }),
  completeTask
);

router.post(
  '/:taskId/verify',
  authorize('TASKS_WRITE', { allowedRoles: ['MASTER', 'CAFE_ADMIN'] }),
  verifyTask
);

router.post(
  '/:taskId/approve',
  authorize('TASKS_WRITE', { allowedRoles: ['MASTER', 'CAFE_ADMIN'] }),
  verifyTask
);

router.post(
  '/:taskId/return',
  authorize('TASKS_WRITE', { allowedRoles: ['MASTER', 'CAFE_ADMIN'] }),
  returnTask
);

router.post(
  '/:taskId/reject',
  authorize('TASKS_WRITE', { allowedRoles: ['MASTER', 'CAFE_ADMIN'] }),
  returnTask
);

router.post(
  '/:taskId/reopen',
  authorize('TASKS_WRITE', { allowedRoles: ['MASTER', 'CAFE_ADMIN'] }),
  reopenTask
);

router.post(
  '/:taskId/cancel',
  authorize('TASKS_WRITE', { allowedRoles: ['MASTER', 'CAFE_ADMIN'] }),
  cancelTask
);

router.post(
  '/:taskId/block',
  authorize('TASKS_WRITE', { allowedRoles: ['MASTER', 'CAFE_ADMIN'] }),
  blockTask
);

router.post(
  '/:taskId/assign',
  authorize('TASKS_WRITE', { allowedRoles: ['MASTER', 'CAFE_ADMIN'] }),
  reassignTask
);

router.patch(
  '/:taskId/assign',
  authorize('TASKS_WRITE', { allowedRoles: ['MASTER', 'CAFE_ADMIN'] }),
  reassignTask
);

module.exports = router;
