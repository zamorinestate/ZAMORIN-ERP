'use strict';

/**
 * ============================================================================
 * ZAMORIN CAFÉ ERP — OWNER CUSTOMER & LOYALTY ROUTES (STAGE 13)
 * ============================================================================
 */

const express = require('express');
const router = express.Router();
const controller = require('../controllers/ownerCustomerLoyaltyController');
const { authenticate } = require('../middleware/authenticate');
const { authorize } = require('../middleware/authorize');

router.use(authenticate);

// Aggregated Customer Analytics & Cohorts
router.get(
  '/analytics',
  authorize('ADMIN_READ', { allowedRoles: ['MASTER', 'OWNER', 'CAFE_ADMIN'] }),
  (req, res) => controller.getCustomerAnalytics(req, res)
);

router.get(
  '/cohorts',
  authorize('ADMIN_READ', { allowedRoles: ['MASTER', 'OWNER', 'CAFE_ADMIN'] }),
  (req, res) => controller.getCohortDistribution(req, res)
);

// Loyalty Ledger Operations (Idempotent)
router.post(
  '/loyalty/accrue',
  authorize('ADMIN_WRITE', { allowedRoles: ['MASTER', 'OWNER', 'CAFE_ADMIN', 'STORE_MANAGER'] }),
  (req, res) => controller.accrueLoyaltyPoints(req, res)
);

router.post(
  '/loyalty/redeem',
  authorize('ADMIN_WRITE', { allowedRoles: ['MASTER', 'OWNER', 'CAFE_ADMIN', 'STORE_MANAGER'] }),
  (req, res) => controller.redeemLoyaltyPoints(req, res)
);

router.get(
  '/loyalty/exposure',
  authorize('ADMIN_READ', { allowedRoles: ['MASTER', 'OWNER', 'CAFE_ADMIN'] }),
  (req, res) => controller.calculateLoyaltyExposure(req, res)
);

router.get(
  '/loyalty/liability',
  authorize('ADMIN_READ', { allowedRoles: ['MASTER', 'OWNER', 'CAFE_ADMIN'] }),
  (req, res) => controller.calculateLoyaltyExposure(req, res)
);

// Purpose limitation check (Stage 11 complaints vs Stage 13 marketing)
router.get(
  '/purpose-separation/:customerId',
  authorize('ADMIN_READ', { allowedRoles: ['MASTER', 'OWNER', 'CAFE_ADMIN'] }),
  (req, res) => controller.verifyComplaintMarketingSeparation(req, res)
);

// Governed Customer Data Export (Role-based masked)
router.post(
  '/export',
  authorize('ADMIN_WRITE', { allowedRoles: ['MASTER', 'OWNER'] }),
  (req, res) => controller.exportCustomerData(req, res)
);

module.exports = router;
