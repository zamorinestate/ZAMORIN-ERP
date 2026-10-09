'use strict';

const express = require('express');

const { authenticate } = require('../middleware/authenticate');
const { authorize } = require('../middleware/authorize');

const {
  getFinanceOverview,
  getSalesAudit,
  clearStoreDay,
  listChartOfAccounts,
  createChartOfAccount,
  listJournals,
  getJournal,
  createJournal,
  postJournal,
  reverseJournal,
  listAPInvoices,
  createAPInvoice,
  listPaymentRuns,
  createPaymentRun,
  decidePaymentRun,
  listReceivables,
  recordCustomerReceipt,
  getReceivableAgeing,
  getInstitutionalAccountStatement,
  updateInstitutionalCreditLimit,
  listMarketplaceSettlements,
  reconcileMarketplaceSettlement,
  listBankAccounts,
  getBudgetsAndAllocations,
  getTaxReview,
  getPeriodCloseStatus,
  closeFinancialPeriod,
  reopenFinancialPeriod,
  getFinancialStatements,
  getFinanceIntegrity,
  generateGstTaxInvoice,
  downloadGstInvoicePdf,
  getGstr1Report,
  commitZReport,
  createAdvanceDeposit,
  listAdvanceDeposits,
  applyAdvanceDeposit,
  refundAdvanceDeposit,
  recordCashDrop,
  recordBankDeposit,
  getCustodyBalances,
} = require('../controllers/financeController');

const router = express.Router();

router.use(authenticate);

// 1. Overview & Command Centre
router.get(
  '/overview',
  authorize('FINANCE:READ', { allowedRoles: ['MASTER', 'OWNER', 'CAFE_ADMIN'] }),
  getFinanceOverview
);

// 2. Sales Audit & Revenue Assurance
router.get(
  '/sales-audit',
  authorize('FINANCE:READ', { allowedRoles: ['MASTER', 'OWNER', 'CAFE_ADMIN'] }),
  getSalesAudit
);

router.post(
  '/sales-audit/store-days/:storeDayId/clear',
  authorize('FINANCE:WRITE', { allowedRoles: ['MASTER'] }),
  clearStoreDay
);

// 3. Chart of Accounts
router.get(
  '/coa',
  authorize('FINANCE:READ', { allowedRoles: ['MASTER', 'OWNER'] }),
  listChartOfAccounts
);

router.post(
  '/coa',
  authorize('FINANCE:ADMIN', { allowedRoles: ['MASTER'] }),
  createChartOfAccount
);

// 4. General Ledger & Journals
router.get(
  '/journals',
  authorize('FINANCE:READ', { allowedRoles: ['MASTER', 'OWNER'] }),
  listJournals
);

router.get(
  '/journals/:journalId',
  authorize('FINANCE:READ', { allowedRoles: ['MASTER', 'OWNER'] }),
  getJournal
);

router.post(
  '/journals',
  authorize('FINANCE:WRITE', { allowedRoles: ['MASTER'] }),
  createJournal
);

router.post(
  '/journals/:journalId/post',
  authorize('FINANCE:POST', { allowedRoles: ['MASTER'] }),
  postJournal
);

router.post(
  '/journals/:journalId/reverse',
  authorize('FINANCE:POST', { allowedRoles: ['MASTER'] }),
  reverseJournal
);

// 5. Accounts Payable (AP)
router.get(
  '/ap/invoices',
  authorize('FINANCE:READ', { allowedRoles: ['MASTER', 'OWNER', 'CAFE_ADMIN'] }),
  listAPInvoices
);

router.post(
  '/ap/invoices',
  authorize('FINANCE:WRITE', { allowedRoles: ['MASTER', 'CAFE_ADMIN'] }),
  createAPInvoice
);

// 6. Payment Proposals & Runs
router.get(
  '/payments/runs',
  authorize('FINANCE:READ', { allowedRoles: ['MASTER', 'OWNER'] }),
  listPaymentRuns
);

router.post(
  '/payments/proposals',
  authorize('FINANCE:WRITE', { allowedRoles: ['MASTER'] }),
  createPaymentRun
);

router.post(
  '/payments/runs/:paymentRunId/decision',
  authorize('FINANCE:POST', { allowedRoles: ['MASTER', 'CAFE_ADMIN'] }),
  decidePaymentRun
);

// 7. Accounts Receivable (AR) & Collections
router.get(
  '/receivables',
  authorize('FINANCE:READ', { allowedRoles: ['MASTER', 'OWNER', 'CAFE_ADMIN'] }),
  listReceivables
);

router.get(
  '/ar/receivables',
  authorize('FINANCE:READ', { allowedRoles: ['MASTER', 'OWNER', 'CAFE_ADMIN'] }),
  listReceivables
);

router.post(
  '/receivables/receipts',
  authorize('FINANCE:WRITE', { allowedRoles: ['MASTER', 'CAFE_ADMIN'] }),
  recordCustomerReceipt
);

router.post(
  '/ar/receivables/receipts',
  authorize('FINANCE:WRITE', { allowedRoles: ['MASTER', 'CAFE_ADMIN'] }),
  recordCustomerReceipt
);

router.get(
  '/receivables/ageing',
  authorize('FINANCE:READ', { allowedRoles: ['MASTER', 'OWNER', 'CAFE_ADMIN'] }),
  getReceivableAgeing
);

router.get(
  '/ar/ageing',
  authorize('FINANCE:READ', { allowedRoles: ['MASTER', 'OWNER', 'CAFE_ADMIN'] }),
  getReceivableAgeing
);

router.get(
  '/institutional-accounts/:accountId/statement',
  authorize('FINANCE:READ', { allowedRoles: ['MASTER', 'OWNER', 'CAFE_ADMIN'] }),
  getInstitutionalAccountStatement
);

router.put(
  '/institutional-accounts/:accountId/credit-limit',
  authorize('FINANCE:ADMIN', { allowedRoles: ['MASTER'] }),
  updateInstitutionalCreditLimit
);

// 8. Marketplace Settlements
router.get(
  '/marketplaces/settlements',
  authorize('FINANCE:READ', { allowedRoles: ['MASTER', 'OWNER', 'CAFE_ADMIN'] }),
  listMarketplaceSettlements
);

router.get(
  '/marketplace/reconciliations',
  authorize('FINANCE:READ', { allowedRoles: ['MASTER', 'OWNER', 'CAFE_ADMIN'] }),
  listMarketplaceSettlements
);

router.post(
  '/marketplaces/settlements/:settlementId/reconcile',
  authorize('FINANCE:WRITE', { allowedRoles: ['MASTER'] }),
  reconcileMarketplaceSettlement
);

router.post(
  '/marketplace/reconciliations/:settlementId/reconcile',
  authorize('FINANCE:WRITE', { allowedRoles: ['MASTER'] }),
  reconcileMarketplaceSettlement
);

// 9. Cash & Bank Accounts
router.get(
  '/bank-accounts',
  authorize('FINANCE:READ', { allowedRoles: ['MASTER', 'OWNER'] }),
  listBankAccounts
);

router.get(
  '/treasury/bank-accounts',
  authorize('FINANCE:READ', { allowedRoles: ['MASTER', 'OWNER'] }),
  listBankAccounts
);

// 10. Budgets & Allocations
router.get(
  '/budgets',
  authorize('FINANCE:READ', { allowedRoles: ['MASTER', 'OWNER', 'CAFE_ADMIN'] }),
  getBudgetsAndAllocations
);

// 11. Tax & Statutory Review
router.get(
  '/tax/review',
  authorize('FINANCE:READ', { allowedRoles: ['MASTER', 'OWNER'] }),
  getTaxReview
);

router.get(
  '/tax/summary',
  authorize('FINANCE:READ', { allowedRoles: ['MASTER', 'OWNER'] }),
  getTaxReview
);

// 12. Period Close Workflow
router.get(
  '/close/status',
  authorize('FINANCE:READ', { allowedRoles: ['MASTER', 'OWNER'] }),
  getPeriodCloseStatus
);

router.get(
  '/period-close/checklist',
  authorize('FINANCE:READ', { allowedRoles: ['MASTER', 'OWNER'] }),
  getPeriodCloseStatus
);

router.post(
  '/close/periods/:periodId/close',
  authorize('FINANCE:CLOSE', { allowedRoles: ['MASTER'] }),
  closeFinancialPeriod
);

router.post(
  '/period-close/periods/:periodId/close',
  authorize('FINANCE:CLOSE', { allowedRoles: ['MASTER'] }),
  closeFinancialPeriod
);

router.post(
  '/close/periods/:periodId/reopen',
  authorize('FINANCE:CLOSE', { allowedRoles: ['MASTER'] }),
  reopenFinancialPeriod
);

// 13. Financial Statements
router.get(
  '/statements',
  authorize('FINANCE:READ', { allowedRoles: ['MASTER', 'OWNER'] }),
  getFinancialStatements
);

router.get(
  '/statements/overview',
  authorize('FINANCE:READ', { allowedRoles: ['MASTER', 'OWNER'] }),
  getFinancialStatements
);

router.get(
  '/statements/pnl',
  authorize('FINANCE:READ', { allowedRoles: ['MASTER', 'OWNER'] }),
  getFinancialStatements
);

// 14. Finance Integrity Centre
router.get(
  '/integrity',
  authorize('FINANCE:READ', { allowedRoles: ['MASTER', 'OWNER'] }),
  getFinanceIntegrity
);

// 15. Statutory GST Invoicing & GSTR Returns (Stage 08)
router.post(
  '/invoices/gst',
  authorize('FINANCE:WRITE', { allowedRoles: ['MASTER', 'CAFE_ADMIN'] }),
  generateGstTaxInvoice
);

router.get(
  '/invoices/:id/pdf',
  authorize('FINANCE:READ', { allowedRoles: ['MASTER', 'OWNER', 'CAFE_ADMIN'] }),
  downloadGstInvoicePdf
);

router.get(
  '/reports/gstr1/:cafeId',
  authorize('FINANCE:READ', { allowedRoles: ['MASTER', 'OWNER', 'CAFE_ADMIN'] }),
  getGstr1Report
);

// 16. Daily Till Reconciliation & Z-Report Settlement (Stage 08)
router.post(
  '/reconciliation/z-report',
  authorize('FINANCE:WRITE', { allowedRoles: ['MASTER', 'CAFE_ADMIN'] }),
  commitZReport
);

// 17. REC-17 Vendor Accounts Payable Ledger & Subledger
const vendorLedgerRoutes = require('./vendorLedgerRoutes');
router.use('/vendor-ledger', vendorLedgerRoutes);

// 18. P10 Advance Deposits & Event Bookings (CBIC Statutory Rules)
router.get(
  '/advance-deposits',
  authorize('FINANCE:READ', { allowedRoles: ['MASTER', 'OWNER', 'CAFE_ADMIN'] }),
  listAdvanceDeposits
);

router.post(
  '/advance-deposits',
  authorize('FINANCE:WRITE', { allowedRoles: ['MASTER', 'CAFE_ADMIN'] }),
  createAdvanceDeposit
);

router.post(
  '/advance-deposits/:depositId/apply',
  authorize('FINANCE:WRITE', { allowedRoles: ['MASTER', 'CAFE_ADMIN'] }),
  applyAdvanceDeposit
);

router.post(
  '/advance-deposits/:depositId/refund',
  authorize('FINANCE:WRITE', { allowedRoles: ['MASTER', 'CAFE_ADMIN'] }),
  refundAdvanceDeposit
);

// 19. P10 Physical Cash Custody: Safe Drops & Bank Deposits
router.post(
  '/cash/safe-drop',
  authorize('FINANCE:WRITE', { allowedRoles: ['MASTER', 'CAFE_ADMIN'] }),
  recordCashDrop
);

router.post(
  '/cash/bank-deposit',
  authorize('FINANCE:WRITE', { allowedRoles: ['MASTER', 'CAFE_ADMIN'] }),
  recordBankDeposit
);

router.get(
  '/cash/custody-balances',
  authorize('FINANCE:READ', { allowedRoles: ['MASTER', 'OWNER', 'CAFE_ADMIN'] }),
  getCustodyBalances
);

module.exports = router;
