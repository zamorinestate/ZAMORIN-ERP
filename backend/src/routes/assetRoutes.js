'use strict';

/**
 * ASSET & EQUIPMENT MAINTENANCE ROUTES
 * Mounted at: /api/v1/assets (registered in routes/index.js)
 */

const express = require('express');
const { authenticate } = require('../middleware/authenticate');
const { authorize } = require('../middleware/authorize');
const { attachDeviceContext } = require('../middleware/deviceContext');
const {
  getAssetOverview,
  listAssets,
  createAsset,
  getAssetDetail,
  commissionAsset,
  transferAsset,
  toggleSafetyHold,
  retireAsset,
  listWorkOrders,
  createWorkOrder,
  updateWorkOrder,
  listMaintenancePlans,
  createMaintenancePlan,
  getMaintenanceBacklog,
  getMaintenanceHistory,
  completeMaintenanceJob,
  rescheduleMaintenanceJob,
  cancelMaintenancePlan,
  runMaintenanceAlertEvaluation,
  logMaintenanceJob,
  recordInspection,
} = require('../controllers/assetController');

const router = express.Router();

router.use(authenticate);
router.use(attachDeviceContext);

const readAuth = authorize('ASSET_READ', { allowedRoles: ['MASTER', 'OWNER', 'CAFE_ADMIN'] });
const writeAuth = authorize('ASSET_WRITE', { allowedRoles: ['MASTER', 'CAFE_ADMIN'] });

// Overview
router.get('/overview', readAuth, getAssetOverview);

// Work Orders
router.get('/work-orders', readAuth, listWorkOrders);
router.post('/work-orders', writeAuth, createWorkOrder);
router.patch('/work-orders/:workOrderId', writeAuth, updateWorkOrder);
router.post('/work-orders/:workOrderId/resolve', writeAuth, updateWorkOrder);

// Inspections
router.post('/inspections', writeAuth, recordInspection);

// Maintenance Backlog, Schedules & Alert Evaluation
router.get('/maintenance/backlog', readAuth, getMaintenanceBacklog);
router.get('/maintenance/history', readAuth, getMaintenanceHistory);
router.post('/maintenance/evaluate-alerts', writeAuth, runMaintenanceAlertEvaluation);
router.post('/maintenance/complete', writeAuth, completeMaintenanceJob);
router.post('/maintenance/reschedule', writeAuth, rescheduleMaintenanceJob);
router.post('/maintenance/jobs/:jobId/complete', writeAuth, completeMaintenanceJob);
router.post('/maintenance/jobs/:jobId/reschedule', writeAuth, rescheduleMaintenanceJob);

// Maintenance Plans
router.get('/plans', readAuth, listMaintenancePlans);
router.post('/plans', writeAuth, createMaintenancePlan);
router.post('/plans/:planId/cancel', writeAuth, cancelMaintenancePlan);

// Asset Register CRUD & Lifecycle
router.get('/', readAuth, listAssets);
router.get('/items', readAuth, listAssets);
router.post('/', writeAuth, createAsset);
router.get('/:assetId', readAuth, getAssetDetail);
router.post('/:assetId/commission', writeAuth, commissionAsset);
router.post('/:assetId/transfer', writeAuth, transferAsset);
router.post('/:assetId/safety-hold', writeAuth, toggleSafetyHold);
router.post('/:assetId/retire', writeAuth, retireAsset);
router.get('/:assetId/maintenance', readAuth, getMaintenanceHistory);
router.post('/:assetId/maintenance', writeAuth, logMaintenanceJob);

module.exports = router;
