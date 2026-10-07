'use strict';

/**
 * ============================================================================
 * ZAMORIN CAFÉ ERP — OWNER UTILITIES & WASTE ROUTES (STAGE 14)
 * ============================================================================
 */

const express = require('express');
const router = express.Router();
const controller = require('../controllers/ownerUtilitiesWasteController');
const { authenticate } = require('../middleware/authenticate');
const { authorize } = require('../middleware/authorize');

router.use(authenticate);

// Executive Dashboard & KPIs
router.get(
  '/dashboard',
  authorize('ADMIN_READ', { allowedRoles: ['MASTER', 'OWNER', 'CAFE_ADMIN', 'STORE_MANAGER'] }),
  (req, res) => controller.getUtilitiesDashboard(req, res)
);

// Utility Meters & Readings
router.post(
  '/meters',
  authorize('ADMIN_WRITE', { allowedRoles: ['MASTER', 'OWNER', 'CAFE_ADMIN'] }),
  (req, res) => controller.registerMeter(req, res)
);

router.post(
  '/readings',
  authorize('ADMIN_WRITE', { allowedRoles: ['MASTER', 'OWNER', 'CAFE_ADMIN', 'STORE_MANAGER'] }),
  (req, res) => controller.recordMeterReading(req, res)
);

// Solid & General Waste Records
router.post(
  '/waste',
  authorize('ADMIN_WRITE', { allowedRoles: ['MASTER', 'OWNER', 'CAFE_ADMIN', 'STORE_MANAGER'] }),
  (req, res) => controller.recordWaste(req, res)
);

// Used Cooking Oil (UCO) & 25% TPC Governance
router.post(
  '/used-cooking-oil',
  authorize('ADMIN_WRITE', { allowedRoles: ['MASTER', 'OWNER', 'CAFE_ADMIN', 'STORE_MANAGER'] }),
  (req, res) => controller.recordUsedCookingOil(req, res)
);

// Solid Waste Management Rules 2026 Applicability Evaluation
router.get(
  '/swm-2026/:cafeId',
  authorize('ADMIN_READ', { allowedRoles: ['MASTER', 'OWNER', 'CAFE_ADMIN'] }),
  (req, res) => controller.evaluateSWM2026Applicability(req, res)
);

module.exports = router;
