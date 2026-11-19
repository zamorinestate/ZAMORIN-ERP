'use strict';

const express = require('express');

const {
  authenticate,
  requireStepUpAuthentication,
} = require('../middleware/authenticate');

const {
  listMyPayslips,
  getMyPayslip,
  downloadEmployeeMonthlyPayslip,
  exportBankDisbursement,
} = require('../controllers/payrollController');

const {
  createSelfPayrollQuery,
  listSelfPayrollQueries,
  listOrgPayrollQueries,
  reviewPayrollQuery,
} = require('../controllers/payrollQueryController');

const {
  listPayrollRuns,
  getPayrollRun,
  listPayrollRunPayslips,
  getPayrollOverview,
  getPayrollReconciliation,
  getPayrollExceptions,
  getPayrollPayments,
  generatePaymentBatch,
  getPayrollCompliance,
  getPayrollIntegrity,
} = require('../controllers/payrollManagementController');

const {
  createPayrollRun,
  createPayrollRunPayslip,
} = require('../controllers/payrollWriteController');

const {
  updateDraftPayrollRun,
  updateDraftPayrollRunPayslip,
} = require('../controllers/payrollDraftController');

const {
  calculatePayrollRun,
} = require('../controllers/payrollCalculationController');

const {
  submitPayrollRun,
  approvePayrollRun,
} = require('../controllers/payrollApprovalController');

const {
  issuePayrollRunPayslips,
} = require('../controllers/payrollIssuanceController');

const {
  payPayrollRun,
} = require('../controllers/payrollPaymentController');

const {
  voidPayrollRun,
} = require('../controllers/payrollVoidController');

const router = express.Router();

router.use(authenticate);

router.get(
  '/me/payslips',
  listMyPayslips
);

router.get(
  '/me/payslips/:payslipId',
  getMyPayslip
);

router.get(
  '/payslip/:employeeId/:month',
  downloadEmployeeMonthlyPayslip
);

router.get(
  '/export/bank-disbursement/:payrollRunId',
  exportBankDisbursement
);

router.post(
  '/me/queries',
  createSelfPayrollQuery
);

router.get(
  '/me/queries',
  listSelfPayrollQueries
);

router.get(
  '/queries',
  listOrgPayrollQueries
);

router.patch(
  '/queries/:queryId',
  reviewPayrollQuery
);

router.get(
  '/overview',
  getPayrollOverview
);

router.get(
  '/compliance/overview',
  getPayrollCompliance
);

router.get(
  '/integrity',
  getPayrollIntegrity
);

router.get(
  '/runs',
  listPayrollRuns
);

router.post(
  '/runs',
  createPayrollRun
);

router.get(
  '/runs/:payrollRunId/payslips',
  listPayrollRunPayslips
);

router.get(
  '/runs/:payrollRunId/reconciliation',
  getPayrollReconciliation
);

router.get(
  '/runs/:payrollRunId/exceptions',
  getPayrollExceptions
);

router.get(
  '/runs/:payrollRunId/payments',
  getPayrollPayments
);

router.post(
  '/runs/:payrollRunId/payments/batch',
  requireStepUpAuthentication,
  generatePaymentBatch
);

router.post(
  '/runs/:payrollRunId/payslips',
  createPayrollRunPayslip
);

router.patch(
  '/runs/:payrollRunId/payslips/:payslipId',
  updateDraftPayrollRunPayslip
);

router.post(
  '/runs/:payrollRunId/calculate',
  calculatePayrollRun
);

router.post(
  '/runs/:payrollRunId/submit',
  requireStepUpAuthentication,
  submitPayrollRun
);

router.post(
  '/runs/:payrollRunId/approve',
  requireStepUpAuthentication,
  approvePayrollRun
);

router.post(
  '/runs/:payrollRunId/issue-payslips',
  requireStepUpAuthentication,
  issuePayrollRunPayslips
);

router.post(
  '/runs/:payrollRunId/pay',
  requireStepUpAuthentication,
  payPayrollRun
);

router.post(
  '/runs/:payrollRunId/void',
  requireStepUpAuthentication,
  voidPayrollRun
);

router.get(
  '/runs/:payrollRunId',
  getPayrollRun
);

router.patch(
  '/runs/:payrollRunId',
  updateDraftPayrollRun
);

module.exports = router;
