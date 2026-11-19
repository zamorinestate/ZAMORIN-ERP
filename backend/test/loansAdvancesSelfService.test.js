'use strict';

/**
 * AUTOMATED TEST SUITE: MY LOANS & ADVANCES (SCR-014)
 *
 * Validates:
 * 1. Server-side User -> Employee identity resolution for Self-Service
 * 2. Normal MASTER Privacy Firewall (403 blocked from all loan endpoints)
 * 3. Primary MASTER Organisation-Wide Governance & Approvals
 * 4. Distinct Loan vs Salary Advance Lifecycle
 * 5. Immutable Ledger-First Balance & Amortization Schedules
 * 6. Code on Wages Statutory 50% Deduction Capacity Engine
 * 7. Payroll Recovery, Arrears, Idempotency & Reversal
 * 8. Manual Repayment Reporting & Primary Verification Gate
 * 9. Settlement Quotes & No-Due Certificate Generation
 * 10. 24-Point Loan Integrity Engine
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const { createApp } = require('../src/server');
const { StaffLoanAdvance } = require('../src/models/StaffLoanAdvance');
const { LoanTransaction } = require('../src/models/LoanTransaction');
const { LoanRepaymentSchedule } = require('../src/models/LoanRepaymentSchedule');
const { LoanPolicy } = require('../src/models/LoanPolicy');
const { User } = require('../src/models/User');
const { RolePermission } = require('../src/models/RolePermission');
const { LoanAdvanceService } = require('../src/services/loanAdvanceService');
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

test('SCR-014: My Loans & Advances — Comprehensive Integration Suite', async (t) => {
  const app = createApp({ allowedOrigins: ['*'], production: false });
  const server = http.createServer(app);

  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });

  const port = server.address().port;

  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  const primaryMaster = {
    userId: 'USR-PRIMARY-MASTER',
    organisationId: 'ORG-ZAMORIN',
    role: 'MASTER',
    isPrimaryMaster: true,
    email: 'primary@zamorin.com',
    fullName: 'Primary Master',
    sessionVersion: 1,
    permissionsVersion: 1,
    assignedCafeIds: ['ZC-0001', 'ZC-0002'],
    accountStatus: 'ACTIVE',
    save: async function () { return this; },
  };

  const normalMaster = {
    userId: 'USR-NORMAL-MASTER',
    organisationId: 'ORG-ZAMORIN',
    role: 'MASTER',
    isPrimaryMaster: false,
    email: 'normal.master@zamorin.com',
    fullName: 'Normal Master',
    sessionVersion: 1,
    permissionsVersion: 1,
    assignedCafeIds: ['ZC-0001', 'ZC-0002'],
    accountStatus: 'ACTIVE',
    save: async function () { return this; },
  };

  const staffRahul = {
    userId: 'ST-0001',
    organisationId: 'ORG-ZAMORIN',
    role: 'STAFF',
    isPrimaryMaster: false,
    email: 'rahul@zamorin.com',
    fullName: 'Rahul Verma',
    sessionVersion: 1,
    permissionsVersion: 1,
    assignedCafeIds: ['ZC-0001'],
    accountStatus: 'ACTIVE',
    save: async function () { return this; },
  };

  const staffPriya = {
    userId: 'ST-0002',
    organisationId: 'ORG-ZAMORIN',
    role: 'STAFF',
    isPrimaryMaster: false,
    email: 'priya@zamorin.com',
    fullName: 'Priya Sharma',
    sessionVersion: 1,
    permissionsVersion: 1,
    assignedCafeIds: ['ZC-0001'],
    accountStatus: 'ACTIVE',
    save: async function () { return this; },
  };

  const cafeAdminKora = {
    userId: 'USR-ADMIN-KORA',
    organisationId: 'ORG-ZAMORIN',
    role: 'CAFE_ADMIN',
    isPrimaryMaster: false,
    email: 'admin.kora@zamorin.com',
    fullName: 'Koramangala Admin',
    sessionVersion: 1,
    permissionsVersion: 1,
    assignedCafeIds: ['ZC-0001'],
    accountStatus: 'ACTIVE',
    save: async function () { return this; },
  };

  // In-memory collections
  const inMemoryLoans = [
    {
      loanAdvanceId: 'LN-2026-0001',
      organisationId: 'ORG-ZAMORIN',
      cafeId: 'ZC-0001',
      employeeUserId: 'ST-0001',
      employeeName: 'Rahul Verma',
      requestType: 'LOAN',
      loanCategory: 'WELFARE',
      requestedAmountPaise: 6000000,
      approvedAmountPaise: 6000000,
      disbursedAmountPaise: 6000000,
      principalPaise: 6000000,
      outstandingPrincipalPaise: 4250000,
      arrearsPaise: 0,
      monthlyInstalmentPaise: 500000,
      totalRepaidPaise: 1750000,
      tenureMonths: 12,
      status: 'ACTIVE',
      policyVersion: 'POL-LOAN-2026-V1',
      deductionReference: 'DED-LN-2026-0001',
      requestedAt: new Date(Date.now() - 60 * 86400000),
      save: async function () { return this; },
    },
  ];

  const inMemoryTransactions = [];
  const inMemorySchedules = [];

  t.mock.method(authService, 'verifyAccessToken', async (token) => {
    let activeUser = primaryMaster;
    if (token === 'token_normal_master') activeUser = normalMaster;
    if (token === 'token_staff_rahul') activeUser = staffRahul;
    if (token === 'token_staff_priya') activeUser = staffPriya;
    if (token === 'token_kora_admin') activeUser = cafeAdminKora;

    return {
      payload: {
        sub: activeUser.userId,
        org: activeUser.organisationId,
        role: activeUser.role,
        isPrimaryMaster: activeUser.isPrimaryMaster,
        sv: 0,
        usv: 1,
        pv: 1,
        sid: 'SS-LOAN-TEST',
      },
      session: {
        sessionId: 'SS-LOAN-TEST',
        roleSnapshot: activeUser.role,
        sessionVersion: 0,
        mfaVerified: true,
        stepUpVerifiedAt: new Date().toISOString(),
      },
    };
  });

  t.mock.method(User, 'findOne', async (query) => {
    if (query?.userId === 'USR-PRIMARY-MASTER') return primaryMaster;
    if (query?.userId === 'USR-NORMAL-MASTER') return normalMaster;
    if (query?.userId === 'ST-0001') return staffRahul;
    if (query?.userId === 'ST-0002') return staffPriya;
    if (query?.userId === 'USR-ADMIN-KORA') return cafeAdminKora;
    return null;
  });

  t.mock.method(RolePermission, 'findEffectiveRules', async ({ role, permissionCode }) => [
    {
      role,
      permissionCode,
      effect: 'ALLOW',
      scope: 'RECORD',
      requiresMfa: false,
      isCurrentlyEffective: () => true,
    },
  ]);

  t.mock.method(StaffLoanAdvance, 'find', (filter) => {
    let list = [...inMemoryLoans];
    if (filter?.employeeUserId) {
      list = list.filter((l) => l.employeeUserId === filter.employeeUserId);
    }
    if (filter?.status && filter.status !== 'ALL') {
      list = list.filter((l) => l.status === filter.status);
    }
    if (filter?.requestType && filter.requestType !== 'ALL') {
      list = list.filter((l) => l.requestType === filter.requestType);
    }
    return createQueryWrapper(list);
  });

  t.mock.method(StaffLoanAdvance, 'findOne', async (query) => {
    return inMemoryLoans.find((l) => {
      let match = true;
      if (query?.loanAdvanceId && l.loanAdvanceId !== query.loanAdvanceId) match = false;
      if (query?.employeeUserId && l.employeeUserId !== query.employeeUserId) match = false;
      return match;
    }) || null;
  });

  t.mock.method(StaffLoanAdvance, 'countDocuments', async (filter) => {
    let list = [...inMemoryLoans];
    if (filter?.employeeUserId) list = list.filter((l) => l.employeeUserId === filter.employeeUserId);
    return list.length;
  });

  t.mock.method(StaffLoanAdvance, 'create', async (doc) => {
    const item = { ...doc, save: async function () { return this; } };
    inMemoryLoans.push(item);
    return item;
  });

  t.mock.method(LoanTransaction, 'find', () => createQueryWrapper(inMemoryTransactions));
  t.mock.method(LoanTransaction, 'findOne', async (query) => {
    return inMemoryTransactions.find((t) => {
      let match = true;
      if (query?.transactionId && t.transactionId !== query.transactionId) match = false;
      if (query?.payrollRunId && t.payrollRunId !== query.payrollRunId) match = false;
      if (query?.loanAdvanceId && t.loanAdvanceId !== query.loanAdvanceId) match = false;
      if (query?.status && t.status !== query.status) match = false;
      return match;
    }) || null;
  });
  t.mock.method(LoanTransaction, 'countDocuments', async () => inMemoryTransactions.length);
  t.mock.method(LoanTransaction, 'create', async (doc) => {
    const txn = { ...doc, save: async function () { return this; } };
    inMemoryTransactions.push(txn);
    return txn;
  });

  t.mock.method(LoanRepaymentSchedule, 'find', () => createQueryWrapper(inMemorySchedules));
  t.mock.method(LoanRepaymentSchedule, 'create', async (doc) => {
    const s = { ...doc, save: async function () { return this; } };
    inMemorySchedules.push(s);
    return s;
  });

  // ── 1. Self-Service Identity & Normal Master Privacy Firewall ─────────────
  await t.test('1. Retired Normal MASTER is blocked with 403 ROLE_RETIRED on loan endpoints', async () => {
    const res = await makeRequest({
      port,
      method: 'GET',
      path: '/api/v1/loan-advances/me',
      headers: { Authorization: 'Bearer token_normal_master' },
    });
    assert.equal(res.statusCode, 403);
    assert.equal(res.body?.error?.code, 'ROLE_RETIRED');
  });

  await t.test('2. Staff user retrieves own self-service loans and factual KPIs', async () => {
    const res = await makeRequest({
      port,
      method: 'GET',
      path: '/api/v1/loan-advances/me',
      headers: { Authorization: 'Bearer token_staff_rahul' },
    });

    assert.equal(res.statusCode, 200);
    assert.equal(res.body?.success, true);
    assert.equal(res.body?.data?.loanAdvances?.length, 1);
    assert.equal(res.body?.data?.loanAdvances[0]?.loanAdvanceId, 'LN-2026-0001');
    assert.equal(res.body?.data?.kpis?.activeLoansCount, 1);
    assert.equal(res.body?.data?.kpis?.totalOutstandingPaise, 4250000);
  });

  await t.test('3. Staff 2 cannot see Staff 1 loans (Zero IDOR / Cross-Employee Leakage)', async () => {
    const res = await makeRequest({
      port,
      method: 'GET',
      path: '/api/v1/loan-advances/me',
      headers: { Authorization: 'Bearer token_staff_priya' },
    });

    assert.equal(res.statusCode, 200);
    assert.equal(res.body?.data?.loanAdvances?.length, 0);
    assert.equal(res.body?.data?.kpis?.activeLoansCount, 0);
  });

  // ── 2. Staff Requests & Withdrawals ───────────────────────────────────────
  await t.test('4. Staff submits Loan Request with policy bounds', async () => {
    const res = await makeRequest({
      port,
      method: 'POST',
      path: '/api/v1/loan-advances/me/requests/loan',
      headers: { Authorization: 'Bearer token_staff_priya' },
      body: {
        requestedAmount: 50000,
        loanCategory: 'EMERGENCY',
        tenureMonths: 10,
        reason: 'Family medical emergency',
      },
    });

    assert.equal(res.statusCode, 201);
    assert.equal(res.body?.success, true);
    assert.equal(res.body?.data?.loan?.status, 'SUBMITTED');
    assert.equal(res.body?.data?.loan?.requestedAmountPaise, 5000000);
  });

  await t.test('5. Staff submits Salary Advance request', async () => {
    const res = await makeRequest({
      port,
      method: 'POST',
      path: '/api/v1/loan-advances/me/requests/advance',
      headers: { Authorization: 'Bearer token_staff_priya' },
      body: {
        requestedAmount: 15000,
        reason: 'Monthly festival advance',
      },
    });

    assert.equal(res.statusCode, 201);
    assert.equal(res.body?.success, true);
    assert.equal(res.body?.data?.advance?.requestType, 'SALARY_ADVANCE');
  });

  // ── 3. Primary Master Governance & Disbursement ───────────────────────────
  await t.test('6. Primary MASTER approves and disburses loan to ACTIVE status', async () => {
    const loan = inMemoryLoans.find((l) => l.employeeUserId === 'ST-0002' && l.requestType === 'LOAN');
    assert.ok(loan);

    // Approve
    const appRes = await makeRequest({
      port,
      method: 'POST',
      path: `/api/v1/loan-advances/admin/loans/${loan.loanAdvanceId}/approve`,
      headers: { Authorization: 'Bearer token_primary_master' },
      body: { approvedAmountPaise: 5000000, tenureMonths: 10 },
    });
    assert.equal(appRes.statusCode, 200);
    assert.equal(appRes.body?.data?.loan?.status, 'DISBURSEMENT_PENDING');

    // Disburse
    const disbRes = await makeRequest({
      port,
      method: 'POST',
      path: `/api/v1/loan-advances/admin/loans/${loan.loanAdvanceId}/disburse`,
      headers: { Authorization: 'Bearer token_primary_master' },
      body: { paymentMethod: 'BANK_TRANSFER', bankTransactionRef: 'HDFC-TXN-123456' },
    });
    assert.equal(disbRes.statusCode, 200);
    assert.equal(disbRes.body?.data?.loan?.status, 'ACTIVE');

    // Verify initial ledger posting was created
    const txn = inMemoryTransactions.find((t) => t.loanAdvanceId === loan.loanAdvanceId && t.transactionType === 'DISBURSEMENT');
    assert.ok(txn);
    assert.equal(txn.amountPaise, 5000000);
    assert.equal(txn.status, 'POSTED');
  });

  // ── 4. Code on Wages 50% Deduction Ceiling & Payroll Recovery ─────────────
  await t.test('7. Statutory 50% Deduction Capacity strictly limits recovery under Code on Wages', () => {
    const capacity = LoanAdvanceService.calculateStatutoryDeductionCapacity({
      grossWagesPaise: 3000000, // ₹30,000 gross
      otherDeductionsPaise: 1200000, // ₹12,000 PF/ESI/Taxes
      statutoryCapPercent: 50,
    });

    assert.equal(capacity.maxPermittedTotalDeductions, 1500000); // ₹15,000 max total
    assert.equal(capacity.availableForLoanRecovery, 300000); // Only ₹3,000 remaining capacity
  });

  await t.test('8. Payroll recovery processes with partial recovery and tracks arrears correctly', async () => {
    const loan = inMemoryLoans.find((l) => l.employeeUserId === 'ST-0002' && l.requestType === 'LOAN');
    assert.ok(loan);

    // Scheduled is ₹5,000, but available capacity is only ₹3,000
    const txn = await LoanAdvanceService.processPayrollLoanRecovery({
      organisationId: 'ORG-ZAMORIN',
      payrollRunId: 'PR-2026-08',
      payrollPeriod: '2026-08',
      employeeUserId: 'ST-0002',
      loanAdvanceId: loan.loanAdvanceId,
      scheduledAmountPaise: 500000,
      availableCapacityPaise: 300000,
    });

    assert.equal(txn.amountPaise, 300000); // ₹3,000 recovered
    assert.equal(txn.arrearsDeltaPaise, 200000); // ₹2,000 placed in arrears

    const updatedLoan = inMemoryLoans.find((l) => l.loanAdvanceId === loan.loanAdvanceId);
    assert.equal(updatedLoan.outstandingPrincipalPaise, 4700000);
    assert.equal(updatedLoan.arrearsPaise, 200000);
    assert.equal(updatedLoan.status, 'IN_ARREARS');
  });

  await t.test('9. Duplicate payroll recovery posting on same run is idempotent', async () => {
    const loan = inMemoryLoans.find((l) => l.employeeUserId === 'ST-0002' && l.requestType === 'LOAN');
    const txn2 = await LoanAdvanceService.processPayrollLoanRecovery({
      organisationId: 'ORG-ZAMORIN',
      payrollRunId: 'PR-2026-08',
      payrollPeriod: '2026-08',
      employeeUserId: 'ST-0002',
      loanAdvanceId: loan.loanAdvanceId,
      scheduledAmountPaise: 500000,
      availableCapacityPaise: 300000,
    });

    assert.ok(txn2);
    // Loan balance did not double deduct
    const updatedLoan = inMemoryLoans.find((l) => l.loanAdvanceId === loan.loanAdvanceId);
    assert.equal(updatedLoan.outstandingPrincipalPaise, 4700000);
  });

  await t.test('10. Payroll reversal reverses linked loan transaction and restores balance', async () => {
    const loan = inMemoryLoans.find((l) => l.employeeUserId === 'ST-0002' && l.requestType === 'LOAN');
    const reversalTxn = await LoanAdvanceService.reversePayrollLoanRecovery({
      organisationId: 'ORG-ZAMORIN',
      payrollRunId: 'PR-2026-08',
      loanAdvanceId: loan.loanAdvanceId,
    });

    assert.ok(reversalTxn);
    assert.equal(reversalTxn.transactionType, 'REVERSAL');
    assert.equal(reversalTxn.amountPaise, 300000);

    const restoredLoan = inMemoryLoans.find((l) => l.loanAdvanceId === loan.loanAdvanceId);
    assert.equal(restoredLoan.outstandingPrincipalPaise, 5000000);
    assert.equal(restoredLoan.arrearsPaise, 0);
  });

  // ── 5. Manual Repayments & Primary Verification ───────────────────────────
  await t.test('11. Employee reports manual repayment without changing balance until verified', async () => {
    const loan = inMemoryLoans.find((l) => l.employeeUserId === 'ST-0002' && l.requestType === 'LOAN');

    const repRes = await makeRequest({
      port,
      method: 'POST',
      path: `/api/v1/loan-advances/me/loans/${loan.loanAdvanceId}/repayments/manual`,
      headers: { Authorization: 'Bearer token_staff_priya' },
      body: { amount: 5000, paymentReference: 'UPI-REF-998877' },
    });

    assert.equal(repRes.statusCode, 201);
    assert.equal(repRes.body?.data?.transaction?.status, 'AWAITING_VERIFICATION');

    // Balance remains unchanged before verification
    const unverifiedLoan = inMemoryLoans.find((l) => l.loanAdvanceId === loan.loanAdvanceId);
    assert.equal(unverifiedLoan.outstandingPrincipalPaise, 5000000);

    // Primary MASTER verifies
    const verRes = await makeRequest({
      port,
      method: 'POST',
      path: `/api/v1/loan-advances/admin/transactions/${repRes.body.data.transaction.transactionId}/verify`,
      headers: { Authorization: 'Bearer token_primary_master' },
      body: { isApproved: true },
    });

    assert.equal(verRes.statusCode, 200);
    const verifiedLoan = inMemoryLoans.find((l) => l.loanAdvanceId === loan.loanAdvanceId);
    assert.equal(verifiedLoan.outstandingPrincipalPaise, 4500000);
    assert.equal(verifiedLoan.totalRepaidPaise, 500000);
  });

  // ── 6. Settlement Quotes & No-Due Certificate ─────────────────────────────
  await t.test('12. Settlement quote calculates accurate payoff and full settlement closes loan', async () => {
    const loan = inMemoryLoans.find((l) => l.employeeUserId === 'ST-0002' && l.requestType === 'LOAN');

    const quoteRes = await makeRequest({
      port,
      method: 'GET',
      path: `/api/v1/loan-advances/me/loans/${loan.loanAdvanceId}/settlement-quote`,
      headers: { Authorization: 'Bearer token_staff_priya' },
    });

    assert.equal(quoteRes.statusCode, 200);
    assert.equal(quoteRes.body?.data?.totalSettlementPaise, 4500000);

    // Post settlement
    const setRes = await makeRequest({
      port,
      method: 'POST',
      path: `/api/v1/loan-advances/admin/loans/${loan.loanAdvanceId}/settlement`,
      headers: { Authorization: 'Bearer token_primary_master' },
      body: { paymentRef: 'NEFT-FULL-SETTLE-001' },
    });

    assert.equal(setRes.statusCode, 200);
    assert.equal(setRes.body?.data?.loan?.status, 'CLOSED');
    assert.equal(setRes.body?.data?.loan?.outstandingPrincipalPaise, 0);
    assert.equal(setRes.body?.data?.loan?.settlementDetails?.noDueCertificateGenerated, true);
  });

  // ── 7. 24-Point Loan Integrity Audit Engine ───────────────────────────────
  await t.test('13. 24-Point Loan Integrity Audit Engine passes on clean data', async () => {
    const auditRes = await makeRequest({
      port,
      method: 'GET',
      path: '/api/v1/loan-advances/admin/integrity',
      headers: { Authorization: 'Bearer token_primary_master' },
    });

    assert.equal(auditRes.statusCode, 200);
    assert.equal(auditRes.body?.data?.checksEvaluated, 24);
    assert.equal(auditRes.body?.data?.issuesFound, 0);
    assert.equal(auditRes.body?.data?.status, 'PASS');
  });

  await t.test('14. Café Admin accesses own self-service loans only', async () => {
    const res = await makeRequest({
      port,
      method: 'GET',
      path: '/api/v1/loan-advances/me',
      headers: { Authorization: 'Bearer token_kora_admin' },
    });

    assert.equal(res.statusCode, 200);
    assert.equal(res.body?.data?.loanAdvances?.length, 0);
  });

  await t.test('15. Staff can withdraw a pending loan request', async () => {
    const advance = inMemoryLoans.find((l) => l.employeeUserId === 'ST-0002' && l.requestType === 'SALARY_ADVANCE');
    assert.ok(advance);

    const withRes = await makeRequest({
      port,
      method: 'POST',
      path: `/api/v1/loan-advances/me/requests/${advance.loanAdvanceId}/withdraw`,
      headers: { Authorization: 'Bearer token_staff_priya' },
    });

    assert.equal(withRes.statusCode, 200);
    const updatedAdv = inMemoryLoans.find((l) => l.loanAdvanceId === advance.loanAdvanceId);
    assert.equal(updatedAdv.status, 'WITHDRAWN');
  });

  await t.test('16. Repayment Pause request records pause parameters', async () => {
    const loan = inMemoryLoans.find((l) => l.employeeUserId === 'ST-0001');
    assert.ok(loan);

    const pauseRes = await makeRequest({
      port,
      method: 'POST',
      path: `/api/v1/loan-advances/me/loans/${loan.loanAdvanceId}/pause`,
      headers: { Authorization: 'Bearer token_staff_rahul' },
      body: { fromPeriod: '2026-09', resumePeriod: '2026-11', reason: 'Family medical leave' },
    });

    assert.equal(pauseRes.statusCode, 200);
    assert.equal(pauseRes.body?.success, true);
  });

  await t.test('17. Amortization Schedule generator handles reducing balance and fixed rate', () => {
    const fixedSched = LoanAdvanceService.generateAmortizationSchedule({
      principalPaise: 12000000,
      tenureMonths: 12,
      interestMethod: 'FIXED',
      annualInterestRatePercent: 10,
    });

    assert.equal(fixedSched.length, 12);
    assert.equal(fixedSched[0].principalPaise, 1000000);
    assert.equal(fixedSched[0].interestPaise, 100000);

    const redSched = LoanAdvanceService.generateAmortizationSchedule({
      principalPaise: 12000000,
      tenureMonths: 12,
      interestMethod: 'REDUCING_BALANCE',
      annualInterestRatePercent: 12,
    });

    assert.equal(redSched.length, 12);
    assert.equal(redSched[0].principalPaise, 1000000);
    assert.equal(redSched[0].interestPaise, 120000);
  });

  await t.test('18. Loan Integrity Engine flags negative balances and closed loans with balances', async () => {
    inMemoryLoans.push({
      loanAdvanceId: 'LN-BAD-001',
      organisationId: 'ORG-ZAMORIN',
      employeeUserId: 'ST-9999',
      status: 'CLOSED',
      outstandingPrincipalPaise: 100000,
      arrearsPaise: 0,
      save: async function () { return this; },
    });

    inMemoryLoans.push({
      loanAdvanceId: 'LN-BAD-002',
      organisationId: 'ORG-ZAMORIN',
      employeeUserId: 'ST-9998',
      status: 'ACTIVE',
      outstandingPrincipalPaise: -50000,
      arrearsPaise: 0,
      save: async function () { return this; },
    });

    const audit = await LoanAdvanceService.runLoanIntegrityAudit('ORG-ZAMORIN');
    assert.equal(audit.status, 'CRITICAL');
    assert.equal(audit.issuesFound >= 2, true);
  });
});
