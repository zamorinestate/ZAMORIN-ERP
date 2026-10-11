'use strict';

/**
 * ============================================================================
 * ZAMORIN CAFÉ ERP — PORTFOLIO GOVERNANCE & FOLLOW-THROUGH ROUTES (P18)
 * ============================================================================
 * Mounted at: /api/v1/portfolio-governance
 */

const express = require('express');
const { authenticate } = require('../middleware/authenticate');
const PortfolioGovernanceController = require('../controllers/portfolioGovernanceController');

const router = express.Router();

router.use(authenticate);

// 1. Consolidated Portfolio Overview (Budgets vs Actuals, Capex, Risk, Training)
router.get('/overview', PortfolioGovernanceController.getOverview);

// 2. Traceable Governance Decision Follow-Through Pipeline
router.post('/decisions', PortfolioGovernanceController.createDecision);
router.post('/decisions/:id/submit', PortfolioGovernanceController.submitDecision);
router.post('/decisions/:id/approve', PortfolioGovernanceController.approveDecision);
router.post('/decisions/:id/progress', PortfolioGovernanceController.progressAction);
router.post('/decisions/:id/verify', PortfolioGovernanceController.completeAndVerifyAction);

// 3. CAPEX Approval with Follow-Through
router.post('/capex/:id/approve', PortfolioGovernanceController.approveCapex);

// 4. Strategic Scenarios (Non-mutating projections)
router.post('/scenarios/run', PortfolioGovernanceController.runScenario);

// 5. Enterprise Risk Mitigation
router.post('/risks/:id/mitigate', PortfolioGovernanceController.updateRiskMitigation);

module.exports = router;
