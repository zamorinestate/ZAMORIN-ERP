'use strict';

/**
 * REPORTS & ANALYTICS ROUTES — SCR-022
 * Mounted at: /api/v1/reports (registered in routes/index.js)
 */

const express = require('express');
const { authenticate } = require('../middleware/authenticate');
const { authorize } = require('../middleware/authorize');
const {
  getAnalyticsOverview,
  getReportCatalogue,
  getSalesAnalytics,
  getFinanceAnalytics,
  getWorkforceAnalytics,
  getCustomerAnalytics,
  getInventoryAnalytics,
  getProcurementAnalytics,
  getMenuAnalytics,
  getQualityAnalytics,
  getAssetAnalytics,
  getPortfolioAnalytics,
  getGoalsAndScorecards,
  getScheduledReportsAndAlerts,
  getCrossModuleReconciliations,
  getComprehensiveReconciliationAudit,
  getExplainThisNumber,
  acknowledgeReconciliationIssue,
  getDataQualityAndLineage,
  getMetricsDictionary,
  generateZurfExport,
  listExportJobs,
  downloadExportArtifact,
  getAnalyticsIntegrity,
  getDashboardReport,
  getDailySummaryReport,
  getCashFlowReport,
  getExpensesReport,
  getAttendanceReport,
  getDiagnosticDecomposition,
  getVarianceWaterfall,
  getParetoAnalysis,
  getDistributionAnalysis,
  getCorrelationAnalysis,
  getDiagnosticExceptions,
  getForecastModels,
  runForecast,
  runScenarioSimulation,
  runSensitivityAnalysis,
  getTrustCentreOverview,
} = require('../controllers/reportController');

const router = express.Router();

router.use(authenticate);

// ── Headline & Overview ────────────────────────────────────────────────────────
router.get(
  '/overview',
  authorize('REPORTS_READ', { allowedRoles: ['MASTER', 'OWNER', 'CAFE_ADMIN'] }),
  getAnalyticsOverview
);

router.get(
  '/library',
  authorize('REPORTS_READ', { allowedRoles: ['MASTER', 'OWNER', 'CAFE_ADMIN'] }),
  getReportCatalogue
);

router.get(
  '/catalogue',
  authorize('REPORTS_READ', { allowedRoles: ['MASTER', 'OWNER', 'CAFE_ADMIN'] }),
  getReportCatalogue
);

// ── Domain Analytics ───────────────────────────────────────────────────────────
router.get(
  '/sales',
  authorize('REPORTS_READ', { allowedRoles: ['MASTER', 'OWNER', 'CAFE_ADMIN'] }),
  getSalesAnalytics
);

router.get(
  '/finance',
  authorize('REPORTS_READ', { allowedRoles: ['MASTER', 'OWNER', 'CAFE_ADMIN'] }),
  getFinanceAnalytics
);

router.get(
  '/workforce',
  authorize('REPORTS_READ', { allowedRoles: ['MASTER', 'OWNER', 'CAFE_ADMIN'] }),
  getWorkforceAnalytics
);

router.get(
  '/customers',
  authorize('REPORTS_READ', { allowedRoles: ['MASTER', 'OWNER', 'CAFE_ADMIN'] }),
  getCustomerAnalytics
);

router.get(
  '/inventory',
  authorize('REPORTS_READ', { allowedRoles: ['MASTER', 'OWNER', 'CAFE_ADMIN'] }),
  getInventoryAnalytics
);

router.get(
  '/procurement',
  authorize('REPORTS_READ', { allowedRoles: ['MASTER', 'OWNER', 'CAFE_ADMIN'] }),
  getProcurementAnalytics
);

router.get(
  '/menu',
  authorize('REPORTS_READ', { allowedRoles: ['MASTER', 'OWNER', 'CAFE_ADMIN'] }),
  getMenuAnalytics
);

router.get(
  '/quality',
  authorize('REPORTS_READ', { allowedRoles: ['MASTER', 'OWNER', 'CAFE_ADMIN'] }),
  getQualityAnalytics
);

router.get(
  '/assets',
  authorize('REPORTS_READ', { allowedRoles: ['MASTER', 'OWNER', 'CAFE_ADMIN'] }),
  getAssetAnalytics
);

router.get(
  '/portfolio',
  authorize('REPORTS_READ', { allowedRoles: ['MASTER', 'OWNER'] }),
  getPortfolioAnalytics
);

router.get(
  '/goals',
  authorize('REPORTS_READ', { allowedRoles: ['MASTER', 'OWNER', 'CAFE_ADMIN'] }),
  getGoalsAndScorecards
);

router.get(
  '/scheduled-alerts',
  authorize('REPORTS_READ', { allowedRoles: ['MASTER', 'OWNER', 'CAFE_ADMIN'] }),
  getScheduledReportsAndAlerts
);

router.get(
  '/reconciliations',
  authorize('REPORTS_READ', { allowedRoles: ['MASTER', 'OWNER'] }),
  getCrossModuleReconciliations
);

router.get(
  '/reconciliations/audit',
  authorize('REPORTS_READ', { allowedRoles: ['MASTER', 'OWNER'] }),
  getComprehensiveReconciliationAudit
);

router.get(
  '/reconciliations/explain',
  authorize('REPORTS_READ', { allowedRoles: ['MASTER', 'OWNER', 'CAFE_ADMIN'] }),
  getExplainThisNumber
);

router.post(
  '/reconciliations/acknowledge',
  authorize('REPORTS_READ', { allowedRoles: ['MASTER', 'OWNER'] }),
  acknowledgeReconciliationIssue
);

router.get(
  '/data-quality',
  authorize('REPORTS_READ', { allowedRoles: ['MASTER', 'OWNER'] }),
  getDataQualityAndLineage
);

router.get(
  '/metrics',
  authorize('REPORTS_READ', { allowedRoles: ['MASTER', 'OWNER', 'CAFE_ADMIN'] }),
  getMetricsDictionary
);

// ── PM-02J Diagnostic & Exploratory Analytics ──────────────────────────────
router.get(
  '/diagnostics/decomposition',
  authorize('REPORTS_READ', { allowedRoles: ['MASTER', 'OWNER', 'CAFE_ADMIN'] }),
  getDiagnosticDecomposition
);

router.get(
  '/diagnostics/waterfall',
  authorize('REPORTS_READ', { allowedRoles: ['MASTER', 'OWNER', 'CAFE_ADMIN'] }),
  getVarianceWaterfall
);

router.get(
  '/diagnostics/pareto',
  authorize('REPORTS_READ', { allowedRoles: ['MASTER', 'OWNER', 'CAFE_ADMIN'] }),
  getParetoAnalysis
);

router.get(
  '/diagnostics/distribution',
  authorize('REPORTS_READ', { allowedRoles: ['MASTER', 'OWNER', 'CAFE_ADMIN'] }),
  getDistributionAnalysis
);

router.get(
  '/diagnostics/correlation',
  authorize('REPORTS_READ', { allowedRoles: ['MASTER', 'OWNER', 'CAFE_ADMIN'] }),
  getCorrelationAnalysis
);

router.get(
  '/diagnostics/exceptions',
  authorize('REPORTS_READ', { allowedRoles: ['MASTER', 'OWNER', 'CAFE_ADMIN'] }),
  getDiagnosticExceptions
);

// ── PM-02K Forecasting & Scenario Intelligence ─────────────────────────────
router.get(
  '/forecast/models',
  authorize('REPORTS_READ', { allowedRoles: ['MASTER', 'OWNER', 'CAFE_ADMIN'] }),
  getForecastModels
);

router.get(
  '/forecast/run',
  authorize('REPORTS_READ', { allowedRoles: ['MASTER', 'OWNER', 'CAFE_ADMIN'] }),
  runForecast
);

router.post(
  '/forecast/scenario',
  authorize('REPORTS_READ', { allowedRoles: ['MASTER', 'OWNER', 'CAFE_ADMIN'] }),
  runScenarioSimulation
);

router.get(
  '/forecast/sensitivity',
  authorize('REPORTS_READ', { allowedRoles: ['MASTER', 'OWNER', 'CAFE_ADMIN'] }),
  runSensitivityAnalysis
);

router.post(
  '/forecast/sensitivity',
  authorize('REPORTS_READ', { allowedRoles: ['MASTER', 'OWNER', 'CAFE_ADMIN'] }),
  runSensitivityAnalysis
);

// ── ZURF Corporate Exports ────────────────────────────────────────────────────
router.post(
  '/export',
  authorize('REPORTS_EXPORT', { allowedRoles: ['MASTER', 'OWNER', 'CAFE_ADMIN'] }),
  generateZurfExport
);

router.get(
  '/export/jobs',
  authorize('REPORTS_EXPORT', { allowedRoles: ['MASTER', 'OWNER', 'CAFE_ADMIN'] }),
  listExportJobs
);

router.get(
  '/export/:runId/download',
  authorize('REPORTS_EXPORT', { allowedRoles: ['MASTER', 'OWNER', 'CAFE_ADMIN'] }),
  downloadExportArtifact
);

router.get(
  '/integrity',
  authorize('REPORTS_READ', { allowedRoles: ['MASTER', 'OWNER'] }),
  getAnalyticsIntegrity
);

// ── Legacy Compatibility ───────────────────────────────────────────────────────
router.get(
  '/dashboard',
  authorize('REPORTS_READ', { allowedRoles: ['MASTER', 'OWNER', 'CAFE_ADMIN'] }),
  getDashboardReport
);

router.get(
  '/daily-summary',
  authorize('REPORTS_READ', { allowedRoles: ['MASTER', 'OWNER', 'CAFE_ADMIN'] }),
  getDailySummaryReport
);

router.get(
  '/cash-flow',
  authorize('REPORTS_READ', { allowedRoles: ['MASTER', 'OWNER', 'CAFE_ADMIN'] }),
  getCashFlowReport
);

router.get(
  '/expenses',
  authorize('REPORTS_READ', { allowedRoles: ['MASTER', 'OWNER', 'CAFE_ADMIN'] }),
  getExpensesReport
);

router.get(
  '/attendance',
  authorize('REPORTS_READ', { allowedRoles: ['MASTER', 'OWNER', 'CAFE_ADMIN'] }),
  getAttendanceReport
);

// ── PM-02L-R3: Data Trust & Reconciliation Centre ───────────────────────────
// BACKEND_ONLY: Actor derived from request.auth only. Role-gated to MASTER|OWNER.
router.get(
  '/trust-centre/overview',
  authorize('REPORTS_READ', { allowedRoles: ['MASTER', 'OWNER'] }),
  getTrustCentreOverview
);

module.exports = router;
