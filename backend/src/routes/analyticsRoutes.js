'use strict';

/**
 * EXECUTIVE ANALYTICS & BI ROUTER (STAGE 10 — PRIMARY MASTER PROGRAMME)
 */

const express = require('express');
const { authenticate } = require('../middleware/authenticate');
const analyticsController = require('../controllers/analyticsController');

const router = express.Router();

// Require valid authentication across all analytics endpoints
router.use(authenticate);

// Consolidated multi-café benchmarks (Must be before parameterized :cafeId routes)
router.get('/consolidated/benchmarks', analyticsController.getConsolidatedBenchmarks);

// Executive Management Dashboard
router.get('/summary', analyticsController.getExecutiveSummary);
router.get('/summary/:cafeId', analyticsController.getExecutiveSummary);

// BCG Matrix Menu Engineering
router.get('/menu-engineering', analyticsController.getMenuEngineering);
router.get('/menu-engineering/:cafeId', analyticsController.getMenuEngineering);

// Hourly Sales Heatmap
router.get('/hourly-heatmap', analyticsController.getHourlyHeatmap);
router.get('/hourly-heatmap/:cafeId', analyticsController.getHourlyHeatmap);

// Food Cost & Wastage
router.get('/food-cost', analyticsController.getFoodCostAndWastage);
router.get('/food-cost/:cafeId', analyticsController.getFoodCostAndWastage);

// Action-Needed Summary & Section 194-O TDS (A090)
router.get('/action-needed', analyticsController.getActionNeeded);
router.get('/action-needed/:cafeId', analyticsController.getActionNeeded);

module.exports = router;
