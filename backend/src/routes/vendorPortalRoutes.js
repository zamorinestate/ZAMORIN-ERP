'use strict';

/**
 * VENDOR PORTAL ROUTES
 * Mounted at: /api/v1/vendor-portal
 * Strictly read-only for external vendor partners.
 */

const express = require('express');
const { authenticate } = require('../middleware/authenticate');
const { requireVendor } = require('../middleware/authorize');
const {
  getVendorProfile,
  getVendorDashboard,
  getIssuedOrders,
  getOrderDetail,
  downloadOrderPdf,
  getVendorDeliveries,
  getVendorStatements,
  blockVendorMutation,
} = require('../controllers/vendorPortalController');

const router = express.Router();

// All vendor portal routes require valid authentication and vendor authorization
router.use(authenticate);
router.use(requireVendor);

router.get('/profile', getVendorProfile);
router.get('/dashboard', getVendorDashboard);
router.get('/orders', getIssuedOrders);
router.get('/orders/:purchaseOrderId', getOrderDetail);
router.get('/orders/:purchaseOrderId/pdf', downloadOrderPdf);
router.get('/deliveries', getVendorDeliveries);
router.get('/statements', getVendorStatements);

// Explicit safeguard for any mutation attempt (Express 5 wildcard syntax)
router.all('/{*path}', (req, res, next) => {
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    return blockVendorMutation(req, res, next);
  }
  return next();
});

module.exports = router;
