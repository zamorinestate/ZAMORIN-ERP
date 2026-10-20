'use strict';

/**
 * LEAVE ROUTES (EMP-SCR-004: MY LEAVE)
 * Mounted at: /api/v1/leave (registered in routes/index.js)
 */

const express = require('express');
const { authenticate } = require('../middleware/authenticate');
const { attachDeviceContext } = require('../middleware/deviceContext');
const {
  getLeaveBalances,
  getLeaveTypes,
  calculateLeavePreview,
  applyLeave,
  getMyLeaves,
  getLeaveDetail,
  withdrawLeave,
  cancelLeave,
  getLeaveCalendar,
  getLeaveStatement,
} = require('../controllers/leaveController');

const router = express.Router();

router.use(authenticate);
router.use(attachDeviceContext);

// Self-Service Leave Endpoints
router.get('/balances', getLeaveBalances);
router.get('/types', getLeaveTypes);
router.post('/calculate', calculateLeavePreview);
router.post('/preview', calculateLeavePreview);
router.post('/requests', applyLeave);
router.get('/requests', getMyLeaves);
router.get('/requests/:leaveId', getLeaveDetail);
router.post('/requests/:leaveId/withdraw', withdrawLeave);
router.post('/requests/:leaveId/cancel', cancelLeave);
router.get('/calendar', getLeaveCalendar);
router.get('/statement', getLeaveStatement);

module.exports = router;
