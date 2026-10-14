'use strict';

/**
 * PASSBOOK & MULTI-CAFÉ TREASURY CONTROLLER
 * RESTful handlers for Overview, Accounts, Transactions, Transfers,
 * Reconciliations, Physical Cash, Reservations, and Analytics.
 */

const { PassbookService } = require('../services/passbookService');
const { PassbookAccount } = require('../models/PassbookAccount');
const { PassbookTransaction } = require('../models/PassbookTransaction');
const { PassbookTransfer } = require('../models/PassbookTransfer');
const { PassbookReconciliation } = require('../models/PassbookReconciliation');
const { PassbookStatementImport } = require('../models/PassbookStatementImport');
const { PassbookReservation } = require('../models/PassbookReservation');
const { PassbookMapping } = require('../models/PassbookMapping');
const { Cafe } = require('../models/Cafe');
const { ZurfService } = require('../services/zurfService');
const { asyncHandler } = require('../utils/asyncHandler');
const { ApiError } = require('../utils/ApiError');

// ── 1. OVERVIEW & CONSOLIDATED KPIS ──────────────────────────────────────────

const getPassbookOverview = asyncHandler(async (req, res) => {
  const org = req.auth.organisationId || 'ZAMORIN';
  const { cafeId, period } = req.query;

  const accountsData = await PassbookService.getAccountsSummary(org, { cafeId });
  const analyticsData = await PassbookService.getAnalytics(org, { cafeId, period });
  const integrityData = await PassbookService.runIntegrityAudit(org);

  // Get active cafes summary
  const cafeFilter = { organisationId: org, status: 'ACTIVE' };
  if (req.auth.role === 'OWNER') {
    const assigned = (req.auth.assignedCafeIds || []).map((c) => String(c).trim().toUpperCase()).filter(Boolean);
    if (!assigned.length) {
      throw new ApiError(403, 'CROSS_CAFE_RESOURCE_DENIED', 'Owner has no assigned cafés.');
    }
    cafeFilter.cafeId = { $in: assigned };
  }
  const cafes = await Cafe.find(cafeFilter).lean();
  const cafePositions = cafes.map((c) => {
    const cafeAccounts = accountsData.accounts.filter(
      (a) => a.scopeType === 'ORGANISATION_GLOBAL' || (a.assignedCafeIds || []).includes(c.cafeId) || a.primaryCafeId === c.cafeId
    );
    const cafeBookPaisa = cafeAccounts.reduce((sum, a) => sum + (a.bookBalancePaisa || 0), 0);
    const cafeReservedPaisa = cafeAccounts.reduce((sum, a) => sum + (a.reservedPaisa || 0), 0);
    const flow = analyticsData.cafeBreakdown[c.cafeId] || { incomePaisa: 0, expensePaisa: 0, netPaisa: 0 };

    return {
      cafeId: c.cafeId,
      cafeName: c.name,
      accountCount: cafeAccounts.length,
      bookBalancePaisa: cafeBookPaisa,
      reservedPaisa: cafeReservedPaisa,
      freeBalancePaisa: cafeBookPaisa - cafeReservedPaisa,
      externalIncomePaisa: flow.incomePaisa,
      externalExpensePaisa: flow.expensePaisa,
      netExternalCashFlowPaisa: flow.netPaisa,
      reconciliationStatus: cafeAccounts.some((a) => Math.abs((a.verifiedStatementBalancePaisa || 0) - (a.bookBalancePaisa || 0)) > 0)
        ? 'NEEDS_RECONCILIATION'
        : 'RECONCILED',
    };
  });

  // Recent Activity
  const recentTransactions = await PassbookTransaction.find({ organisationId: org })
    .sort({ postingDate: -1, postingSequence: -1, createdAt: -1 })
    .limit(8)
    .lean();

  res.status(200).json({
    success: true,
    data: {
      kpis: {
        totalBookBalancePaisa: accountsData.kpis.totalBookBalancePaisa,
        totalExternalIncomePaisa: analyticsData.externalIncomePaisa,
        totalExternalExpensePaisa: analyticsData.externalExpensePaisa,
        netExternalCashFlowPaisa: analyticsData.netCashFlowPaisa,
        totalInternalTransfersPaisa: analyticsData.internalTransfersPaisa,
        totalInterCafeTransfersPaisa: analyticsData.internalTransfersPaisa,
        totalReservedPaisa: accountsData.kpis.totalReservedPaisa,
        freeBalancePaisa: accountsData.kpis.totalFreeBalancePaisa,
        unreconciledDifferencePaisa: accountsData.kpis.unreconciledDifferencePaisa,
        activeAccountsCount: accountsData.kpis.activeAccounts,
        accountsNeedingReconciliation: accountsData.kpis.accountsNeedingReconciliation,
      },
      cafePositions,
      accounts: accountsData.accounts,
      recentActivity: recentTransactions,
      integrityStatus: integrityData.status,
    },
  });
});

// ── 2. ACCOUNTS ENDPOINTS ───────────────────────────────────────────────────

const listAccounts = asyncHandler(async (req, res) => {
  const org = req.auth.organisationId || 'ZAMORIN';
  const query = { ...req.query };
  if (req.auth.role === 'OWNER') {
    const assigned = (req.auth.assignedCafeIds || []).map((c) => String(c).trim().toUpperCase()).filter(Boolean);
    if (!assigned.length) {
      throw new ApiError(403, 'CROSS_CAFE_RESOURCE_DENIED', 'Owner has no assigned cafés.');
    }
    if (query.cafeId && query.cafeId !== 'ALL') {
      if (!assigned.includes(query.cafeId.trim().toUpperCase())) {
        throw new ApiError(403, 'CROSS_CAFE_RESOURCE_DENIED', 'You do not have access to this café.');
      }
    }
  }
  const result = await PassbookService.getAccountsSummary(org, query);
  if (req.auth.role === 'OWNER') {
    const assigned = (req.auth.assignedCafeIds || []).map((c) => String(c).trim().toUpperCase());
    result.accounts = (result.accounts || []).filter(
      (a) => a.scopeType === 'ORGANISATION_GLOBAL' || (a.assignedCafeIds || []).some((c) => assigned.includes(c)) || (a.primaryCafeId && assigned.includes(a.primaryCafeId))
    );
  }
  res.status(200).json({ success: true, data: result });
});

const createAccount = asyncHandler(async (req, res) => {
  const account = await PassbookService.createAccount(req.body, req.auth);
  res.status(201).json({ success: true, data: account, message: 'Passbook account created successfully.' });
});

const getAccountById = asyncHandler(async (req, res) => {
  const org = req.auth.organisationId || 'ZAMORIN';
  const account = await PassbookAccount.findOne({ accountId: req.params.accountId, organisationId: org }).lean();
  if (!account) throw new ApiError(404, 'ACCOUNT_NOT_FOUND', 'Account not found.');

  const recentTxns = await PassbookTransaction.find({ accountId: account.accountId, organisationId: org })
    .sort({ postingDate: -1, postingSequence: -1 })
    .limit(10)
    .lean();

  const reservations = await PassbookReservation.find({ accountId: account.accountId, organisationId: org, status: 'ACTIVE' }).lean();

  res.status(200).json({
    success: true,
    data: {
      account,
      recentTransactions: recentTxns,
      activeReservations: reservations,
    },
  });
});

const updateAccount = asyncHandler(async (req, res) => {
  const account = await PassbookService.updateAccount(req.params.accountId, req.body, req.auth);
  res.status(200).json({ success: true, data: account, message: 'Account updated successfully.' });
});

const rebuildAccountBalance = asyncHandler(async (req, res) => {
  const org = req.auth.organisationId || 'ZAMORIN';
  const result = await PassbookService.rebuildAccountBalance(req.params.accountId, org);
  res.status(200).json({ success: true, data: result, message: 'Account balance rebuilt from immutable ledger.' });
});

// ── 3. TRANSACTIONS & ADJUSTMENTS ───────────────────────────────────────────

const listTransactions = asyncHandler(async (req, res) => {
  const org = req.auth.organisationId || 'ZAMORIN';
  const query = { ...req.query };
  if (req.auth.role === 'OWNER') {
    const assigned = (req.auth.assignedCafeIds || []).map((c) => String(c).trim().toUpperCase()).filter(Boolean);
    if (!assigned.length) {
      throw new ApiError(403, 'CROSS_CAFE_RESOURCE_DENIED', 'Owner has no assigned cafés.');
    }
    if (query.cafeId && query.cafeId !== 'ALL') {
      if (!assigned.includes(query.cafeId.trim().toUpperCase())) {
        throw new ApiError(403, 'CROSS_CAFE_RESOURCE_DENIED', 'You do not have access to this café.');
      }
    }
  }
  const result = await PassbookService.listTransactions(org, query);
  res.status(200).json({ success: true, data: result });
});

const postTransaction = asyncHandler(async (req, res) => {
  const txn = await PassbookService.postTransaction(req.body, req.auth);
  res.status(201).json({ success: true, data: txn, message: 'Transaction posted successfully.' });
});

const directBalanceAdjustment = asyncHandler(async (req, res) => {
  const result = await PassbookService.directBalanceAdjustment(req.params.accountId, req.body, req.auth);
  res.status(200).json({ success: true, data: result, message: 'Direct balance adjustment applied.' });
});

const reverseTransaction = asyncHandler(async (req, res) => {
  const reversal = await PassbookService.reverseTransaction(req.params.transactionId, req.body.reason, req.auth);
  res.status(200).json({ success: true, data: reversal, message: 'Transaction reversed successfully.' });
});

// ── 4. TRANSFERS ────────────────────────────────────────────────────────────

const createTransfer = asyncHandler(async (req, res) => {
  const result = await PassbookService.createTransfer(req.body, req.auth);
  res.status(201).json({ success: true, data: result, message: 'Transfer executed successfully.' });
});

// ── 5. RECONCILIATIONS & STATEMENTS ─────────────────────────────────────────

const commitStatementImport = asyncHandler(async (req, res) => {
  const statement = await PassbookService.commitStatementImport(req.body, req.auth);
  res.status(201).json({ success: true, data: statement, message: 'Statement imported successfully.' });
});

const confirmBalance = asyncHandler(async (req, res) => {
  const recon = await PassbookService.confirmBalance(req.params.reconciliationId || 'NEW', req.body, req.auth);
  res.status(200).json({ success: true, data: recon, message: 'Balance confirmed and signed off.' });
});

// ── 6. RESERVED FUNDS ───────────────────────────────────────────────────────

const createReservation = asyncHandler(async (req, res) => {
  const resv = await PassbookService.createReservation(req.body, req.auth);
  res.status(201).json({ success: true, data: resv, message: 'Funds reserved successfully.' });
});

// ── 7. INTEGRITY AUDIT ──────────────────────────────────────────────────────

const runIntegrityAudit = asyncHandler(async (req, res) => {
  const org = req.auth.organisationId || 'ZAMORIN';
  const result = await PassbookService.runIntegrityAudit(org);
  res.status(200).json({ success: true, data: result });
});

// ── 8. ANALYTICS & EXPORTS ──────────────────────────────────────────────────

const getAnalytics = asyncHandler(async (req, res) => {
  const org = req.auth.organisationId || 'ZAMORIN';
  const analytics = await PassbookService.getAnalytics(org, req.query);
  res.status(200).json({ success: true, data: analytics });
});

const exportPassbookPdf = asyncHandler(async (req, res) => {
  const org = req.auth.organisationId || 'ZAMORIN';
  const { accountId, period } = req.query;

  const account = accountId ? await PassbookAccount.findOne({ accountId, organisationId: org }).lean() : null;
  const txns = await PassbookTransaction.find({ organisationId: org, ...(accountId ? { accountId } : {}) })
    .sort({ postingDate: 1, postingSequence: 1 })
    .lean();

  const columns = [
    { key: 'postingDate', label: 'DATE' },
    { key: 'transactionId', label: 'TXN ID' },
    { key: 'narration', label: 'PARTICULARS' },
    { key: 'externalReference', label: 'REF / UTR' },
    { key: 'debit', label: 'DEBIT (₹)', align: 'right' },
    { key: 'credit', label: 'CREDIT (₹)', align: 'right' },
    { key: 'balance', label: 'BALANCE (₹)', align: 'right' },
  ];

  const rows = txns.map((t) => ({
    postingDate: t.postingDate,
    transactionId: t.transactionId,
    narration: t.narration,
    externalReference: t.externalReference || '—',
    debit: t.direction === 'DEBIT' ? `₹${(t.amountPaisa / 100).toFixed(2)}` : '—',
    credit: t.direction === 'CREDIT' ? `₹${(t.amountPaisa / 100).toFixed(2)}` : '—',
    balance: `₹${(t.runningBalancePaisa / 100).toFixed(2)}`,
  }));

  if (req.query.format === 'XLSX') {
    const xlsx = await ZurfService.renderXlsx({
      sheetName: 'Passbook Statement',
      reportTitle: account ? `Passbook Statement - ${account.accountName}` : 'Consolidated Treasury Passbook',
      columns,
      rows,
    });
    res.setHeader('Content-Type', xlsx.mimeType);
    res.setHeader('Content-Disposition', `attachment; filename="${xlsx.filename}"`);
    return res.send(xlsx.buffer);
  }

  if (req.query.format === 'CSV') {
    return res.status(400).json({
      success: false,
      error: {
        code: 'UNSUPPORTED_EXPORT_FORMAT',
        message: 'CSV format is not supported for passbook exports. Canonical export formats are PDF and XLSX.',
      },
    });
  }

  if (req.query.format === 'PDF' || req.headers.accept === 'application/pdf') {
    const pdf = await ZurfService.renderBinaryPdf({
      reportTitle: account ? `PASSBOOK STATEMENT — ${account.accountName} (${account.maskedAccountNumber})` : 'CONSOLIDATED TREASURY PASSBOOK STATEMENT',
      reportCode: 'ZURF-PB-01',
      scope: account ? `Account: ${account.accountName}` : 'All Accounts — Global Portfolio',
      period: period || 'August 2026',
      columns,
      rows,
    });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${pdf.filename}"`);
    return res.send(pdf.buffer);
  }

  const html = await ZurfService.renderZurfHtml({
    reportTitle: account ? `PASSBOOK STATEMENT — ${account.accountName} (${account.maskedAccountNumber})` : 'CONSOLIDATED TREASURY PASSBOOK STATEMENT',
    scope: account ? `Account: ${account.accountName}` : 'All Accounts — Global Portfolio',
    period: period || 'August 2026',
    classification: 'RESTRICTED',
    generatedBy: req.auth.name || req.auth.role,
    columns,
    rows,
    notes: 'Official ZURF v1 Treasury Document. All transaction values are verified against authoritative ERP ledger records.',
  });

  res.setHeader('Content-Type', 'text/html');
  res.send(html);
});

module.exports = {
  getPassbookOverview,
  listAccounts,
  createAccount,
  getAccountById,
  updateAccount,
  rebuildAccountBalance,
  listTransactions,
  postTransaction,
  directBalanceAdjustment,
  reverseTransaction,
  createTransfer,
  commitStatementImport,
  confirmBalance,
  createReservation,
  runIntegrityAudit,
  getAnalytics,
  exportPassbookPdf,
};
