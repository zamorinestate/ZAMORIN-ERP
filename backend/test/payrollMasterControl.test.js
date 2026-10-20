'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');

const { createApp } = require('../src/server');
const { User } = require('../src/models/User');
const { PayrollRun } = require('../src/models/PayrollRun');
const { Payslip } = require('../src/models/Payslip');
const { Cafe } = require('../src/models/Cafe');
const { SequenceCounter } = require('../src/models/SequenceCounter');
const { AuditEvent } = require('../src/models/AuditEvent');
const authService = require('../src/services/authService');

function request(server, path, options = {}) {
  if (typeof options === 'string') {
    options = { token: options };
  }

  return new Promise((resolve, reject) => {
    const url = new URL(path, 'http://127.0.0.1:' + server.address().port);
    const body = options.body === undefined ? null : JSON.stringify(options.body);

    const req = http.request(
      {
        method: options.method || 'GET',
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        headers: {
          Accept: 'application/json',
          ...(body ? { 'Content-Type': 'application/json' } : {}),
          ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
        },
      },
      (res) => {
        let raw = '';
        res.on('data', (chunk) => {
          raw += chunk;
        });
        res.on('end', () => {
          let responseBody;
          try {
            responseBody = JSON.parse(raw);
          } catch {
            responseBody = raw;
          }
          resolve({ status: res.statusCode, body: responseBody });
        });
      }
    );

    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function startServer(t) {
  const app = createApp({ allowedOrigins: ['*'], production: false });
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, () => resolve(instance));
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return server;
}

function mockAuth(t, overrides = {}) {
  const role = overrides.role || 'MASTER';
  const user = {
    userId: overrides.userId || 'MU-0001',
    organisationId: overrides.organisationId || 'ORG-TEST',
    role,
    isPrimaryMaster: overrides.isPrimaryMaster !== undefined ? overrides.isPrimaryMaster : role === 'MASTER',
    assignedCafeIds: [],
    primaryCafeId: null,
    sessionVersion: 1,
    permissionsVersion: 1,
    ...overrides,
  };
  const session = {
    sessionId: 'SS-20260808-0001',
    roleSnapshot: user.role,
    sessionVersion: 0,
    mfaVerified: true,
    stepUpVerifiedAt: new Date().toISOString(),
  };
  t.mock.method(authService, 'verifyAccessToken', async () => ({
    payload: {
      sub: user.userId,
      org: user.organisationId,
      role: user.role,
      sv: 0,
      usv: 1,
      pv: 1,
      sid: session.sessionId,
    },
    session,
  }));
  t.mock.method(User, 'findOne', async () => user);
}

function mockAudit(t) {
  t.mock.method(SequenceCounter, 'generateId', async () => 'AE-20260808-0001');
  t.mock.method(AuditEvent, 'create', async (document) => document);
}

function findQuery(result) {
  return {
    sort() { return this; },
    skip() { return this; },
    limit() { return this; },
    async lean() { return result; },
    then(resolve) { return Promise.resolve(result).then(resolve); },
  };
}

test('SCR-017 Payroll Control Centre — Overview endpoint for Primary Master', async (t) => {
  const server = await startServer(t);
  mockAuth(t, { role: 'MASTER', isPrimaryMaster: true });
  mockAudit(t);

  const mockRuns = [
    {
      payrollRunId: 'PR-202608-0001',
      organisationId: 'ORG-TEST',
      cafeId: 'ZC-0001',
      periodKey: '2026-08',
      status: 'APPROVED',
      employeeCount: 10,
      totalGrossPaise: 30000000,
      totalDeductionPaise: 3600000,
      totalNetPayPaise: 26400000,
    },
  ];

  t.mock.method(PayrollRun, 'find', () => findQuery(mockRuns));

  const res = await request(server, '/api/v1/payroll/overview', { token: 'valid-token' });
  assert.equal(res.status, 200);
  assert.equal(res.body.success, true);
  assert.ok(res.body.data.kpis);
  assert.ok(res.body.data.readinessChecklist);
  assert.equal(res.body.data.readinessChecklist.length, 6);
});

test('SCR-017 Payroll Control Centre — Owner governance access to overview', async (t) => {
  const server = await startServer(t);
  mockAuth(t, { role: 'OWNER', isPrimaryMaster: false });
  mockAudit(t);

  t.mock.method(PayrollRun, 'find', () => findQuery([]));

  const res = await request(server, '/api/v1/payroll/overview', { token: 'valid-token' });
  assert.equal(res.status, 200);
  assert.equal(res.body.success, true);
});

test('SCR-017 Payroll Control Centre — CAFE_ADMIN and STAFF strictly denied (403)', async (t) => {
  const server = await startServer(t);

  // CAFE_ADMIN test
  mockAuth(t, { role: 'CAFE_ADMIN' });
  let res = await request(server, '/api/v1/payroll/overview', { token: 'valid-token' });
  assert.equal(res.status, 403);
  assert.equal(res.body.error?.code, 'PAYROLL_MANAGEMENT_FORBIDDEN');

  // STAFF test
  mockAuth(t, { role: 'STAFF' });
  res = await request(server, '/api/v1/payroll/overview', { token: 'valid-token' });
  assert.equal(res.status, 403);
  assert.equal(res.body.error?.code, 'PAYROLL_MANAGEMENT_FORBIDDEN');
});

test('SCR-017 Payroll Control Centre — Gross-to-Net reconciliation endpoint', async (t) => {
  const server = await startServer(t);
  mockAuth(t, { role: 'MASTER', isPrimaryMaster: true });
  mockAudit(t);

  const mockRun = {
    payrollRunId: 'PR-202608-0001',
    organisationId: 'ORG-TEST',
    cafeId: 'ZC-0001',
    periodKey: '2026-08',
    status: 'APPROVED',
  };

  const mockPayslips = [
    {
      employeeUserId: 'EU-0001',
      earnings: { basicPayPaise: 2000000, houseRentAllowancePaise: 600000, otherAllowancePaise: 200000, overtimePayPaise: 100000, incentivePaise: 100000, grossPayPaise: 3000000 },
      deductions: { providentFundPaise: 240000, employeeStateInsurancePaise: 22500, professionalTaxPaise: 20000, incomeTaxPaise: 50000, loanAdvanceDeductionPaise: 27500, unpaidLeaveDeductionPaise: 0, totalDeductionPaise: 360000 },
      netPayPaise: 2640000,
    },
  ];

  t.mock.method(PayrollRun, 'findOne', () => ({
    lean: async () => mockRun,
  }));

  t.mock.method(Payslip, 'find', () => ({
    lean: async () => mockPayslips,
  }));

  const res = await request(server, '/api/v1/payroll/runs/PR-202608-0001/reconciliation', { token: 'valid-token' });
  assert.equal(res.status, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.data.isBalanced, true);
  assert.equal(res.body.data.totalNetPayPaise, 2640000);
});

test('SCR-017 Payroll Control Centre — Payments & Banking batch generation', async (t) => {
  const server = await startServer(t);
  mockAuth(t, { role: 'MASTER', isPrimaryMaster: true });
  mockAudit(t);

  const mockRun = {
    payrollRunId: 'PR-202608-0001',
    organisationId: 'ORG-TEST',
    cafeId: 'ZC-0001',
    periodKey: '2026-08',
    status: 'APPROVED',
    totalNetPayPaise: 26400000,
  };

  t.mock.method(PayrollRun, 'findOne', () => ({
    lean: async () => mockRun,
  }));

  const res = await request(server, '/api/v1/payroll/runs/PR-202608-0001/payments/batch', {
    method: 'POST',
    token: 'valid-token',
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.data.totalAmountPaise, 26400000);
});

test('SCR-017 Payroll Control Centre — Statutory compliance overview', async (t) => {
  const server = await startServer(t);
  mockAuth(t, { role: 'MASTER', isPrimaryMaster: true });
  mockAudit(t);

  const res = await request(server, '/api/v1/payroll/compliance/overview', { token: 'valid-token' });
  assert.equal(res.status, 200);
  assert.equal(res.body.success, true);
  // Without a live DB there is no payslip data, so each scheme must report the
  // honest NO_DATA state (rate/ceiling config is still returned).
  assert.equal(res.body.data.dataAvailability, 'UNAVAILABLE');
  assert.equal(res.body.data.epf.status, 'NO_DATA');
  assert.equal(res.body.data.esi.status, 'NO_DATA');
  assert.equal(res.body.data.epf.employeeRatePct, 12);
  assert.equal(res.body.data.esi.employeeRatePct, 0.75);
});

test('SCR-017 Payroll Control Centre — payroll invariant integrity check is honest', async (t) => {
  const server = await startServer(t);
  mockAuth(t, { role: 'MASTER', isPrimaryMaster: true });
  mockAudit(t);

  const res = await request(server, '/api/v1/payroll/integrity', { token: 'valid-token' });
  assert.equal(res.status, 200);
  assert.equal(res.body.success, true);
  // Data-dependent checks cannot be evaluated without a DB; they must be reported
  // UNAVAILABLE (not falsely CERTIFIED). RBAC/authority checks remain enforced.
  const d = res.body.data;
  assert.equal(d.totalChecks, 10);
  assert.equal(d.checks.length, 10);
  assert.equal(d.status, 'PARTIAL_INTEGRITY');
  // Only the 3 code-enforced checks (CHK-04/05/06) can pass with no data.
  assert.equal(d.passedChecks, 3);
  assert.ok(d.unavailableChecks >= 4);
  // The three RBAC/authority locks are always enforced.
  const enforced = d.checks.filter((c) => c.status === 'ENFORCED');
  assert.equal(enforced.length, 3);
  assert.ok(enforced.every((c) => c.passed === true));
});
