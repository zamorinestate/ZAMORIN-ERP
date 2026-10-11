'use strict';

/**
 * ============================================================================
 * ZAMORIN CAFÉ ERP — OWNER COMPLAINTS ROUTES (STAGE 11)
 * ============================================================================
 */

const express = require('express');
const router = express.Router();
const controller = require('../controllers/ownerComplaintsController');
const { authenticate } = require('../middleware/authenticate');
const { authorize } = require('../middleware/authorize');

router.use(authenticate);

// List & Dashboard
router.get(
  '/dashboard',
  authorize('ADMIN_READ', { allowedRoles: ['MASTER', 'OWNER', 'CAFE_ADMIN', 'STORE_MANAGER'] }),
  (req, res) => controller.getDashboardMetrics(req, res)
);

router.get(
  '/',
  authorize('ADMIN_READ', { allowedRoles: ['MASTER', 'OWNER', 'CAFE_ADMIN', 'STORE_MANAGER'] }),
  (req, res) => controller.listComplaints(req, res)
);

router.get(
  '/:complaintId',
  authorize('ADMIN_READ', { allowedRoles: ['MASTER', 'OWNER', 'CAFE_ADMIN', 'STORE_MANAGER'] }),
  (req, res) => controller.getComplaintById(req, res)
);

// Create Complaint (Intake)
router.post(
  '/',
  authorize('ADMIN_WRITE', { allowedRoles: ['MASTER', 'CAFE_ADMIN', 'STORE_MANAGER'] }),
  (req, res) => controller.createComplaint(req, res)
);

// Transition Lifecycle Status
router.patch(
  '/:complaintId/status',
  authorize('ADMIN_WRITE', { allowedRoles: ['MASTER', 'CAFE_ADMIN', 'STORE_MANAGER'] }),
  (req, res) => controller.updateComplaintStatus(req, res)
);

// Service Recovery Refund
router.post(
  '/:complaintId/refund',
  authorize('ADMIN_WRITE', { allowedRoles: ['MASTER', 'CAFE_ADMIN', 'STORE_MANAGER'] }),
  (req, res) => controller.issueServiceRecoveryRefund(req, res)
);

// Communication Log
router.post(
  '/:complaintId/communications',
  authorize('ADMIN_WRITE', { allowedRoles: ['MASTER', 'CAFE_ADMIN', 'STORE_MANAGER'] }),
  (req, res) => controller.addCommunication(req, res)
);

// Evidence Attachments
router.post(
  '/:complaintId/evidence',
  authorize('ADMIN_WRITE', { allowedRoles: ['MASTER', 'CAFE_ADMIN', 'STORE_MANAGER'] }),
  (req, res) => controller.attachEvidence(req, res)
);

module.exports = router;
