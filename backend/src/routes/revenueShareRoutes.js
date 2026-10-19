'use strict';

/**
 * REVENUE SHARE & LEASED OUTLETS ROUTES (SCR-026)
 * Mounted at: /api/v1/revenue-share (registered in routes/index.js)
 * STRICT ACCESS: PRIMARY MASTER and OWNER exclusively.
 */

const express = require('express');
const { authenticate } = require('../middleware/authenticate');
const { requirePrimaryMasterOrOwner } = require('../middleware/authorize');
const {
  getOverview,
  listOutlets,
  createOutlet,
  getOutletById,
  listOperators,
  createOperator,
  getOperatorById,
  listAgreements,
  createAgreement,
  getAgreementById,
  listRateRules,
  createRateRule,
  listSalesSubmissions,
  submitSales,
  approveSalesSubmission,
  simulateSettlement,
  listSettlements,
  createSettlement,
  approveSettlement,
  listPayments,
  recordPayment,
  getOutstandingAndAgeing,
  listRecoveries,
  recordMeterReading,
  getDepositLedger,
  recordDepositTransaction,
  createSecurityDeposit,
  createRecoveryCharge,
  listDisputes,
  createDispute,
  resolveDispute,
  exportZurfPdf,
} = require('../controllers/revenueShareController');

const router = express.Router();

// Mandatory Authentication & Strict Primary Master / Owner Gate
router.use(authenticate);
router.use(requirePrimaryMasterOrOwner);

// 1. Overview Dashboard KPIs
router.get('/overview', getOverview);

// 2. Leased Outlets / Commercial Space
router.get('/outlets', listOutlets);
router.post('/outlets', createOutlet);
router.get('/outlets/:id', getOutletById);

// 3. Operators
router.get('/operators', listOperators);
router.post('/operators', createOperator);
router.get('/operators/:id', getOperatorById);

// 4. Agreements
router.get('/agreements', listAgreements);
router.post('/agreements', createAgreement);
router.get('/agreements/:id', getAgreementById);

// 5. Rate Rules
router.get('/rate-rules', listRateRules);
router.post('/rate-rules', createRateRule);

// 6. Sales Reporting & Approvals
router.get('/sales', listSalesSubmissions);
router.post('/sales', submitSales);
router.post('/sales/:id/approve', approveSalesSubmission);

// 7. Settlement Simulation & Calculations
router.post('/settlements/simulate', simulateSettlement);

// 8. Settlements & Authoritative Approval
router.get('/settlements', listSettlements);
router.post('/settlements', createSettlement);
router.post('/settlements/:id/approve', approveSettlement);

// 9. Payments & Allocations
router.get('/payments', listPayments);
router.post('/payments', recordPayment);

// 10. Outstanding & Ageing
router.get('/outstanding', getOutstandingAndAgeing);

// 11. Recoveries & Meters
router.get('/recoveries', listRecoveries);
// Frontend "Add Recovery Charge" modal (derives operator/agreement from the outlet).
router.post('/recoveries', createRecoveryCharge);
router.post('/recoveries/meter-readings', recordMeterReading);

// 12. Security Deposits
router.get('/deposits', getDepositLedger);
// Frontend "Record Security Deposit" modal (derives outlet/agreement from the operator).
router.post('/deposits', createSecurityDeposit);
router.post('/deposits/transactions', recordDepositTransaction);

// 13. Disputes & Default Cases
router.get('/disputes', listDisputes);
router.post('/disputes', createDispute);
router.post('/disputes/:id/resolve', resolveDispute);

// 14. ZURF v1 Compliance Export
router.get('/reports/zurf-pdf', exportZurfPdf);

module.exports = router;
