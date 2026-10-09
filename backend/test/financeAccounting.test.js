'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const { createApp } = require('../src/server');
const { ChartOfAccount } = require('../src/models/ChartOfAccount');
const { Journal } = require('../src/models/Journal');
const { FinancialPeriod } = require('../src/models/FinancialPeriod');
const { APInvoice } = require('../src/models/APInvoice');
const { PaymentRun } = require('../src/models/PaymentRun');
const { StoreDayAudit } = require('../src/models/StoreDayAudit');
const { MarketplaceSettlement } = require('../src/models/MarketplaceSettlement');
const { BankAccount } = require('../src/models/BankAccount');
const { User } = require('../src/models/User');
const { RolePermission } = require('../src/models/RolePermission');
const { SequenceCounter } = require('../src/models/SequenceCounter');
const authService = require('../src/services/authService');

function makeRequest({ port, method, path, headers = {}, body = null }) {
  return new Promise((resolve, reject) => {
    const serializedBody = body ? JSON.stringify(body) : null;
    const reqHeaders = { ...headers };
    if (serializedBody) {
      reqHeaders['Content-Type'] = 'application/json';
      reqHeaders['Content-Length'] = Buffer.byteLength(serializedBody);
    }

    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        method,
        path,
        headers: reqHeaders,
      },
      (res) => {
        let responseData = '';
        res.on('data', (chunk) => {
          responseData += chunk;
        });
        res.on('end', () => {
          let parsedJson = null;
          try {
            parsedJson = responseData ? JSON.parse(responseData) : null;
          } catch (e) {
            parsedJson = responseData;
          }
          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            body: parsedJson,
          });
        });
      }
    );

    req.on('error', reject);
    if (serializedBody) {
      req.write(serializedBody);
    }
    req.end();
  });
}

function createQueryWrapper(resolvedValue) {
  const query = {
    select() { return query; },
    sort() { return query; },
    skip() { return query; },
    limit() { return query; },
    lean() { return Promise.resolve(resolvedValue); },
    then(onFulfilled, onRejected) {
      return Promise.resolve(resolvedValue).then(onFulfilled, onRejected);
    },
  };
  return query;
}

test('Screen 010: Finance & Accounts Integration Test Suite', async (t) => {
  const app = createApp({ allowedOrigins: ['*'], production: false });
  const server = http.createServer(app);

  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });

  const port = server.address().port;

  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  const primaryMasterUser = {
    userId: 'MU-PRIMARY-01',
    organisationId: 'ORG-ZAMORIN',
    role: 'MASTER',
    isPrimaryMaster: true,
    email: 'primary@zamorincafe.com',
    fullName: 'Primary Master',
    sessionVersion: 1,
    permissionsVersion: 1,
    assignedCafeIds: ['ZC-0001', 'ZC-0002'],
    accountStatus: 'ACTIVE',
    save: async function () { return this; },
  };

  const normalMasterUser = {
    userId: 'MU-NORMAL-01',
    organisationId: 'ORG-ZAMORIN',
    role: 'MASTER',
    isPrimaryMaster: false,
    email: 'normal@zamorincafe.com',
    fullName: 'Normal Master',
    sessionVersion: 1,
    permissionsVersion: 1,
    assignedCafeIds: ['ZC-0001', 'ZC-0002'],
    accountStatus: 'ACTIVE',
    save: async function () { return this; },
  };

  const cafeAdminUser = {
    userId: 'ADM-001',
    organisationId: 'ORG-ZAMORIN',
    role: 'CAFE_ADMIN',
    email: 'admin.koramangala@zamorincafe.com',
    fullName: 'Cafe Admin Koramangala',
    sessionVersion: 1,
    permissionsVersion: 1,
    assignedCafeIds: ['ZC-0001'],
    accountStatus: 'ACTIVE',
    save: async function () { return this; },
  };

  const inMemoryCoA = [
    { organisationId: 'ORG-ZAMORIN', accountCode: '1010-CASH', accountName: 'Cash on Hand', accountType: 'ASSET', accountGroup: 'CURRENT_ASSETS' },
    { organisationId: 'ORG-ZAMORIN', accountCode: '1020-BANK-HDFC', accountName: 'HDFC Current A/C', accountType: 'ASSET', accountGroup: 'CURRENT_ASSETS' },
    { organisationId: 'ORG-ZAMORIN', accountCode: '6020-OPEX-RENT', accountName: 'Rent Expense', accountType: 'EXPENSE', accountGroup: 'OPERATING_EXPENSES' },
  ];

  const inMemoryJournals = [
    {
      journalId: 'JRN-20260818-0001',
      organisationId: 'ORG-ZAMORIN',
      periodId: 'FY2026-P05',
      journalDate: '2026-08-18',
      journalType: 'MANUAL',
      sourceModule: 'MANUAL',
      description: 'Monthly coffee equipment lease adjustment',
      cafeId: 'ZC-0001',
      lines: [
        { lineId: 'L-1', accountCode: '6020-OPEX-RENT', accountName: 'Rent', debitPaisa: 1500000, creditPaisa: 0 },
        { lineId: 'L-2', accountCode: '1020-BANK-HDFC', accountName: 'HDFC Bank', debitPaisa: 0, creditPaisa: 1500000 },
      ],
      totalDebitPaisa: 1500000,
      totalCreditPaisa: 1500000,
      status: 'DRAFT',
      makerUserId: 'MU-PRIMARY-01',
      save: async function () { return this; },
    },
  ];

  const inMemoryStoreDays = [
    {
      storeDayId: 'SDA-ZC0001-20260818',
      organisationId: 'ORG-ZAMORIN',
      cafeId: 'ZC-0001',
      businessDate: '2026-08-18',
      posEventCount: 428,
      financeEventCount: 428,
      grossSalesPaisa: 14200000,
      discountsPaisa: 600000,
      netSalesPaisa: 13600000,
      taxPaisa: 680000,
      tenderBreakdown: { cashPaisa: 4200000, upiPaisa: 6500000, cardPaisa: 2900000, departmentCreditPaisa: 0, marketplacePaisa: 0 },
      cashExpectedPaisa: 4200000,
      cashDeclaredPaisa: 4200000,
      cashVariancePaisa: 0,
      status: 'FINANCE_CLEARED',
      clearedBy: 'MU-PRIMARY-01',
      clearedAt: new Date(),
      save: async function () { return this; },
    },
  ];

  const inMemoryInvoices = [
    {
      invoiceId: 'AP-2026-00001',
      organisationId: 'ORG-ZAMORIN',
      vendorId: 'VEN-001',
      vendorName: 'Blue Tokai Coffee Roasters',
      supplierInvoiceNumber: 'BT-9921',
      invoiceDate: '2026-08-14',
      dueDate: '2026-08-28',
      amountPaisa: 1450000,
      taxPaisa: 0,
      totalPaisa: 1450000,
      paidPaisa: 0,
      outstandingPaisa: 1450000,
      cafeId: 'ZC-0001',
      paymentStatus: 'UNPAID',
      save: async function () { return this; },
    },
  ];

  const inMemoryPeriods = [
    {
      periodId: 'FY2026-P05',
      organisationId: 'ORG-ZAMORIN',
      fiscalYear: '2026-2027',
      periodNumber: 5,
      periodName: 'August 2026',
      startDate: '2026-08-01',
      endDate: '2026-08-31',
      status: 'OPEN',
      reopenHistory: [],
      save: async function () { return this; },
    },
  ];

  const inMemoryBankAccounts = [
    {
      bankAccountId: 'BANK-HDFC-01',
      organisationId: 'ORG-ZAMORIN',
      accountAlias: 'HDFC Operating Current A/C',
      bankName: 'HDFC Bank Ltd',
      maskedAccountNumber: '•••• 4892',
      ifscCode: 'HDFC0000128',
      glAccountCode: '1020-BANK-HDFC',
      bookBalancePaisa: 45000000,
      status: 'ACTIVE',
    },
  ];

  const inMemorySettlements = [
    {
      settlementId: 'SET-ZOMATO-2026-08-A',
      organisationId: 'ORG-ZAMORIN',
      platform: 'ZOMATO',
      externalSettlementId: 'ZOM-SET-8912',
      periodStart: '2026-08-01',
      periodEnd: '2026-08-07',
      cafeId: 'ZC-0001',
      grossSalesPaisa: 8500000,
      commissionPaisa: 1700000,
      netSettlementPaisa: 6800000,
      status: 'RECEIVED',
      save: async function () { return this; },
    },
  ];

  t.mock.method(authService, 'verifyAccessToken', async (token) => {
    let activeUser = primaryMasterUser;
    if (token === 'token_normal_master') activeUser = normalMasterUser;
    if (token === 'token_cafe_admin') activeUser = cafeAdminUser;
    return {
      payload: {
        sub: activeUser.userId,
        org: activeUser.organisationId,
        role: activeUser.role,
        isPrimaryMaster: activeUser.isPrimaryMaster,
        sv: 0,
        usv: 1,
        pv: 1,
        sid: 'SS-TEST-001',
      },
      session: {
        sessionId: 'SS-TEST-001',
        roleSnapshot: activeUser.role,
        sessionVersion: 0,
        mfaVerified: true,
        stepUpVerifiedAt: new Date().toISOString(),
      },
    };
  });

  t.mock.method(User, 'findOne', async (query) => {
    if (query?.userId === 'MU-PRIMARY-01') return primaryMasterUser;
    if (query?.userId === 'MU-NORMAL-01') return normalMasterUser;
    if (query?.userId === 'ADM-001') return cafeAdminUser;
    return null;
  });

  t.mock.method(RolePermission, 'findEffectiveRules', async ({ role, permissionCode }) => [
    {
      role,
      permissionCode,
      effect: 'ALLOW',
      scope: role === 'CAFE_ADMIN' ? 'ASSIGNED_CAFES' : 'ORGANISATION',
      isCurrentlyEffective: () => true,
    },
  ]);

  t.mock.method(SequenceCounter, 'generateId', async ({ prefix }) => `${prefix}-0002`);

  t.mock.method(ChartOfAccount, 'find', () => createQueryWrapper(inMemoryCoA));
  t.mock.method(ChartOfAccount, 'findOne', async (query) => inMemoryCoA.find((c) => c.accountCode === query.accountCode) || null);
  t.mock.method(ChartOfAccount, 'create', async (data) => {
    inMemoryCoA.push(data);
    return data;
  });

  t.mock.method(Journal, 'find', () => createQueryWrapper(inMemoryJournals));
  t.mock.method(Journal, 'findOne', async (query) => inMemoryJournals.find((j) => j.journalId === query.journalId) || null);
  t.mock.method(Journal, 'create', async (data) => {
    const item = { ...data, save: async function () { return this; } };
    inMemoryJournals.push(item);
    return item;
  });

  t.mock.method(StoreDayAudit, 'find', () => createQueryWrapper(inMemoryStoreDays));
  t.mock.method(StoreDayAudit, 'findOne', async (query) => inMemoryStoreDays.find((s) => s.storeDayId === query.storeDayId) || null);

  t.mock.method(APInvoice, 'find', () => createQueryWrapper(inMemoryInvoices));
  t.mock.method(APInvoice, 'findOne', async (query) => {
    if (query?.invoiceId) return inMemoryInvoices.find((i) => i.invoiceId === query.invoiceId) || null;
    if (query?.supplierInvoiceNumber === 'DUPLICATE-INV') return inMemoryInvoices[0];
    return null;
  });
  t.mock.method(APInvoice, 'countDocuments', async () => inMemoryInvoices.length);
  t.mock.method(APInvoice, 'create', async (data) => {
    const item = { ...data, save: async function () { return this; } };
    inMemoryInvoices.push(item);
    return item;
  });
  t.mock.method(APInvoice, 'updateMany', async () => ({ modifiedCount: 1 }));

  t.mock.method(FinancialPeriod, 'find', () => createQueryWrapper(inMemoryPeriods));
  t.mock.method(FinancialPeriod, 'findOne', async (query) => inMemoryPeriods.find((p) => p.periodId === query.periodId || p.status === query.status) || inMemoryPeriods[0]);

  t.mock.method(BankAccount, 'find', () => createQueryWrapper(inMemoryBankAccounts));
  t.mock.method(MarketplaceSettlement, 'find', () => createQueryWrapper(inMemorySettlements));
  t.mock.method(MarketplaceSettlement, 'findOne', async (query) => inMemorySettlements.find((m) => m.settlementId === query.settlementId) || null);

  t.mock.method(PaymentRun, 'find', () => createQueryWrapper([]));
  t.mock.method(PaymentRun, 'countDocuments', async () => 1);
  t.mock.method(PaymentRun, 'create', async (data) => ({ ...data, save: async function () { return this; } }));

  await t.test('1. GET /api/v1/finance/overview returns KPIs and control strip', async () => {
    const res = await makeRequest({
      port,
      method: 'GET',
      path: '/api/v1/finance/overview',
      headers: { Authorization: 'Bearer token_primary_master' },
    });

    assert.equal(res.statusCode, 200);
    assert.ok(res.body.kpis);
    assert.ok(res.body.controlStrip);
    assert.ok(Array.isArray(res.body.cafeBreakdown));
  });

  await t.test('2. GET /api/v1/finance/sales-audit returns store day sales audit', async () => {
    const res = await makeRequest({
      port,
      method: 'GET',
      path: '/api/v1/finance/sales-audit',
      headers: { Authorization: 'Bearer token_primary_master' },
    });

    assert.equal(res.statusCode, 200);
    assert.ok(Array.isArray(res.body.storeDays));
    assert.equal(res.body.totalEvaluated, 1);
  });

  await t.test('3. POST /api/v1/finance/coa creates chart of account for Primary Master', async () => {
    const res = await makeRequest({
      port,
      method: 'POST',
      path: '/api/v1/finance/coa',
      headers: { Authorization: 'Bearer token_primary_master' },
      body: {
        accountCode: '4030-REV-MERCH',
        accountName: 'Retail Merchandise & Beans Sales',
        accountType: 'REVENUE',
        accountGroup: 'OPERATING_REVENUE',
      },
    });

    assert.equal(res.statusCode, 201);
    assert.ok(res.body.account);
  });

  await t.test('4. POST /api/v1/finance/journals rejects unbalanced journal', async () => {
    const res = await makeRequest({
      port,
      method: 'POST',
      path: '/api/v1/finance/journals',
      headers: { Authorization: 'Bearer token_primary_master' },
      body: {
        journalDate: '2026-08-18',
        periodId: 'FY2026-P05',
        description: 'Unbalanced entry test',
        lines: [
          { accountCode: '6020-OPEX-RENT', debitPaisa: 1500000, creditPaisa: 0 },
          { accountCode: '1020-BANK-HDFC', debitPaisa: 0, creditPaisa: 1000000 },
        ],
      },
    });

    assert.equal(res.statusCode, 400);
    assert.equal(res.body.error.code, 'UNBALANCED_JOURNAL');
  });

  await t.test('5. POST /api/v1/finance/journals creates balanced draft and posts to GL', async () => {
    const createRes = await makeRequest({
      port,
      method: 'POST',
      path: '/api/v1/finance/journals',
      headers: { Authorization: 'Bearer token_primary_master' },
      body: {
        journalDate: '2026-08-18',
        periodId: 'FY2026-P05',
        description: 'Store maintenance expense adjustment',
        lines: [
          { accountCode: '6020-OPEX-RENT', debitPaisa: 500000, creditPaisa: 0 },
          { accountCode: '1020-BANK-HDFC', debitPaisa: 0, creditPaisa: 500000 },
        ],
      },
    });

    assert.equal(createRes.statusCode, 201);
    assert.equal(createRes.body.journal.status, 'DRAFT');

    const postRes = await makeRequest({
      port,
      method: 'POST',
      path: `/api/v1/finance/journals/${createRes.body.journal.journalId}/post`,
      headers: { Authorization: 'Bearer token_primary_master' },
    });

    assert.equal(postRes.statusCode, 200);
    assert.equal(postRes.body.journal.status, 'POSTED');
  });

  await t.test('6. POST /api/v1/finance/journals/:journalId/reverse reverses posted journal', async () => {
    // Post JRN-20260818-0001 first
    inMemoryJournals[0].status = 'POSTED';

    const res = await makeRequest({
      port,
      method: 'POST',
      path: '/api/v1/finance/journals/JRN-20260818-0001/reverse',
      headers: { Authorization: 'Bearer token_primary_master' },
      body: {
        reason: 'Duplicate entry correction for August lease.',
      },
    });

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.originalJournal.status, 'REVERSED');
    assert.equal(res.body.reversalJournal.journalType, 'REVERSAL');
  });

  await t.test('7. POST /api/v1/finance/ap/invoices rejects duplicate supplier invoice', async () => {
    const res = await makeRequest({
      port,
      method: 'POST',
      path: '/api/v1/finance/ap/invoices',
      headers: { Authorization: 'Bearer token_cafe_admin' },
      body: {
        vendorId: 'VEN-001',
        vendorName: 'Blue Tokai Coffee Roasters',
        supplierInvoiceNumber: 'DUPLICATE-INV',
        invoiceDate: '2026-08-14',
        dueDate: '2026-08-28',
        amount: 14500,
        cafeId: 'ZC-0001',
      },
    });

    assert.equal(res.statusCode, 409);
    assert.equal(res.body.error.code, 'DUPLICATE_SUPPLIER_INVOICE');
  });

  await t.test('8. POST /api/v1/finance/payments/proposals creates payment run', async () => {
    const res = await makeRequest({
      port,
      method: 'POST',
      path: '/api/v1/finance/payments/proposals',
      headers: { Authorization: 'Bearer token_primary_master' },
      body: {
        bankAccountId: 'BANK-HDFC-01',
        selectedInvoiceIds: ['AP-2026-00001'],
      },
    });

    assert.equal(res.statusCode, 201);
    assert.ok(res.body.paymentRun);
    assert.equal(res.body.paymentRun.status, 'PENDING_APPROVAL');
  });

  await t.test('9. POST /api/v1/finance/marketplaces/settlements/:settlementId/reconcile reconciles batch', async () => {
    const res = await makeRequest({
      port,
      method: 'POST',
      path: '/api/v1/finance/marketplaces/settlements/SET-ZOMATO-2026-08-A/reconcile',
      headers: { Authorization: 'Bearer token_primary_master' },
      body: {
        bankMatchReference: 'TXN-BANK-HDFC-9912',
      },
    });

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.settlement.status, 'RECONCILED');
  });

  await t.test('10. POST /api/v1/finance/close/periods/:periodId/close and reopen tests', async () => {
    const closeRes = await makeRequest({
      port,
      method: 'POST',
      path: '/api/v1/finance/close/periods/FY2026-P05/close',
      headers: { Authorization: 'Bearer token_primary_master' },
      body: { signOffNotes: 'Audited close for August 2026' },
    });

    assert.equal(closeRes.statusCode, 200);
    assert.equal(closeRes.body.period.status, 'CLOSED');

    const reopenRes = await makeRequest({
      port,
      method: 'POST',
      path: '/api/v1/finance/close/periods/FY2026-P05/reopen',
      headers: { Authorization: 'Bearer token_primary_master' },
      body: { reason: 'Tax adjustment journal required.' },
    });

    assert.equal(reopenRes.statusCode, 200);
    assert.equal(reopenRes.body.period.status, 'REOPENED');
  });

  await t.test('11. GET /api/v1/finance/integrity performs 18-point audit', async () => {
    const res = await makeRequest({
      port,
      method: 'GET',
      path: '/api/v1/finance/integrity',
      headers: { Authorization: 'Bearer token_primary_master' },
    });

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.checksEvaluated, 18);
    assert.ok(res.body.status);
  });
});
