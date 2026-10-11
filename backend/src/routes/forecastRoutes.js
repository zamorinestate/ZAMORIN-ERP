'use strict';

/**
 * ============================================================================
 * ZAMORIN CAFÉ ERP — FORECAST & INSIGHTS ROUTER (PACKAGE P17)
 * ============================================================================
 * Authoritative routes for Sales & Demand Forecasting, Holdout Evaluation,
 * Stockout Risks, Supplier Price Variances, and Assisted Business Analysis.
 */

const express = require('express');
const { authenticate } = require('../middleware/authenticate');
const { authorize } = require('../middleware/authorize');
const ForecastController = require('../controllers/forecastController');

const router = express.Router();

// 1. All forecasting routes require valid authentication
router.use(authenticate);

// 2. Sales & Demand Forecasting
router.post(
  '/generate',
  authorize(['MASTER', 'CAFE_ADMIN']),
  ForecastController.generateForecast
);

router.get(
  '/latest',
  authorize(['MASTER', 'OWNER', 'CAFE_ADMIN']),
  ForecastController.getLatestForecast
);

router.get(
  '/history',
  authorize(['MASTER', 'OWNER', 'CAFE_ADMIN']),
  ForecastController.getForecastHistory
);

// 3. Forecast Accuracy & Holdout Evaluation
router.post(
  '/evaluate',
  authorize(['MASTER', 'CAFE_ADMIN']),
  ForecastController.evaluateForecast
);

router.get(
  '/evaluations',
  authorize(['MASTER', 'OWNER', 'CAFE_ADMIN']),
  ForecastController.getEvaluationHistory
);

// 4. Stockout Risk Intelligence
router.get(
  '/stockout-risk',
  authorize(['MASTER', 'OWNER', 'CAFE_ADMIN']),
  ForecastController.getStockoutRisk
);

// 5. Supplier Price Variance & Cost Analysis
router.get(
  '/supplier-price-variance',
  authorize(['MASTER', 'OWNER', 'CAFE_ADMIN']),
  ForecastController.getSupplierPriceVariance
);

// 6. Assisted Business Analysis
router.get(
  '/assisted-analysis/catalog',
  authorize(['MASTER', 'OWNER', 'CAFE_ADMIN']),
  ForecastController.getSupportedQuestions
);

router.post(
  '/assisted-analysis/query',
  authorize(['MASTER', 'OWNER', 'CAFE_ADMIN']),
  ForecastController.askBusinessAnalysis
);

module.exports = router;
