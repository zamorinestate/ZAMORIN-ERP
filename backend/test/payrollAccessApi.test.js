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
    const body = options.body === undefined
      ? null
      : JSON.stringify(options.body);

    const req = http.request({
      method: options.method || 'GET',
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers: {
        Accept: 'application/json',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
      },
    }, (res) => {
      let raw = '';
      res.on('data', (chunk) => { raw += chunk; });
      res.on('end', () => {
        let responseBody;
        try { responseBody = JSON.parse(raw); } catch { responseBody = raw; }
        resolve({ status: res.statusCode, body: responseBody });
      });
    });

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
    userId: 'MU-0001',
    organisationId: 'ORG-TEST',
    role,
    // Primary Master by default for all MASTER users in tests.
    // Set isPrimaryMaster: false in overrides to test Normal Master denial.
    isPrimaryMaster: role === 'MASTER' ? true : false,
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

function findQuery(result) {
  return {
    sort() { return this; },
    skip() { return this; },
    async limit() { return result; },
  };
}

function mockAudit(t) {
  t.mock.method(SequenceCounter, 'generateId', async () => 'AE-20260808-0001');
  t.mock.method(AuditEvent, 'create', async (document) => document);
}

test('payroll self-service requires authentication', async (t) => {
  const server = await startServer(t);
  const result = await request(server, '/api/v1/payroll/me/payslips');
  assert.equal(result.status, 401);
  assert.equal(result.body.error?.code, 'AUTHENTICATION_REQUIRED');
});

test('STAFF lists only own issued or paid payslips', async (t) => {
  mockAuth(t, {
    userId: 'ST-0001',
    role: 'STAFF',
    assignedCafeIds: ['CF-0001'],
  });
  const expected = {
    organisationId: 'ORG-TEST',
    employeeUserId: 'ST-0001',
    status: { $in: ['ISSUED', 'PAID'] },
  };
  const rows = [{ payslipId: 'PS-202608-0001', status: 'ISSUED' }];
  t.mock.method(Payslip, 'find', (filter) => {
    assert.deepEqual(filter, expected);
    return findQuery(rows);
  });
  t.mock.method(Payslip, 'countDocuments', async (filter) => {
    assert.deepEqual(filter, expected);
    return rows.length;
  });
  const server = await startServer(t);
  const result = await request(server, '/api/v1/payroll/me/payslips', 'token');
  assert.equal(result.status, 200, `Expected 200, got ${result.status}: ${JSON.stringify(result.body)}`);
  assert.equal(result.body.data?.payslips?.length, 1);
});

test('STAFF is forbidden from payroll management', async (t) => {
  mockAuth(t, { userId: 'ST-0001', role: 'STAFF' });
  const server = await startServer(t);
  const result = await request(server, '/api/v1/payroll/runs', 'token');
  assert.equal(result.status, 403);
  assert.equal(result.body.error?.code, 'PAYROLL_MANAGEMENT_FORBIDDEN');
});

test('OWNER payroll listing is restricted to assigned cafes', async (t) => {
  mockAuth(t, {
    userId: 'OW-0001',
    role: 'OWNER',
    assignedCafeIds: ['CF-0001', 'CF-0002'],
  });
  mockAudit(t);
  const expected = {
    organisationId: 'ORG-TEST',
    cafeId: { $in: ['CF-0001', 'CF-0002'] },
  };
  const rows = [{
    payrollRunId: 'PR-202608-0001',
    cafeId: 'CF-0001',
    periodKey: '2026-08',
    status: 'DRAFT',
  }];
  t.mock.method(PayrollRun, 'find', (filter) => {
    assert.deepEqual(filter, expected);
    return findQuery(rows);
  });
  t.mock.method(PayrollRun, 'countDocuments', async (filter) => {
    assert.deepEqual(filter, expected);
    return rows.length;
  });
  const server = await startServer(t);
  const result = await request(server, '/api/v1/payroll/runs', 'token');
  assert.equal(result.status, 200, `Expected 200, got ${result.status}: ${JSON.stringify(result.body)}`);
  assert.equal(result.body.data?.payrollRuns?.length, 1);
});


test('MASTER rejects client-controlled payroll lifecycle fields', async (t) => {
  mockAuth(t);
  const server = await startServer(t);
  const result = await request(server, '/api/v1/payroll/runs', {
    method: 'POST',
    token: 'token',
    body: {
      cafeId: 'ZC-0001',
      periodKey: '2026-08',
      status: 'PAID',
    },
  });

  assert.equal(result.status, 400);
  assert.equal(result.body.error?.code, 'PROTECTED_PAYROLL_RUN_FIELD');
});

test('OWNER cannot create payroll for an unassigned cafe', async (t) => {
  mockAuth(t, {
    userId: 'OW-0001',
    role: 'OWNER',
    assignedCafeIds: ['ZC-0001'],
  });
  const server = await startServer(t);
  const result = await request(server, '/api/v1/payroll/runs', {
    method: 'POST',
    token: 'token',
    body: {
      cafeId: 'ZC-9999',
      periodKey: '2026-08',
    },
  });

  assert.equal(result.status, 403);
  assert.equal(result.body.error?.code, 'CAFE_ACCESS_DENIED');
});

test('MASTER creates a backend-controlled draft payroll run', async (t) => {
  mockAuth(t);

  const cafe = {
    cafeId: 'ZC-0001',
    organisationId: 'ORG-TEST',
    status: 'ACTIVE',
  };

  t.mock.method(Cafe, 'findOne', async (filter) => {
    assert.deepEqual(filter, {
      organisationId: 'ORG-TEST',
      cafeId: 'ZC-0001',
      status: { $ne: 'ARCHIVED' },
    });
    return cafe;
  });

  t.mock.method(PayrollRun, 'findOne', async (filter) => {
    assert.deepEqual(filter, {
      organisationId: 'ORG-TEST',
      cafeId: 'ZC-0001',
      periodKey: '2026-08',
    });
    return null;
  });

  let createdDocument = null;
  t.mock.method(PayrollRun, 'create', async (document) => {
    createdDocument = document;
    return document;
  });

  t.mock.method(SequenceCounter, 'generateId', async (input) => {
    if (input.sequenceKey === 'PAYROLL_RUN_202608') {
      assert.equal(input.organisationId, 'ORG-TEST');
      assert.equal(input.prefix, 'PR-202608');
      assert.equal(input.minimumDigits, 4);
      return 'PR-202608-0001';
    }

    assert.match(input.sequenceKey, /^AUDIT_EVENT_[0-9]{8}$/);
    return 'AE-20260808-0001';
  });

  t.mock.method(AuditEvent, 'create', async (document) => document);

  const server = await startServer(t);
  const result = await request(server, '/api/v1/payroll/runs', {
    method: 'POST',
    token: 'token',
    body: {
      cafeId: 'ZC-0001',
      periodKey: '2026-08',
      notes: 'August payroll',
    },
  });

  assert.equal(
    result.status,
    201,
    `Expected 201, got ${result.status}: ${JSON.stringify(result.body)}`
  );
  assert.equal(result.body.success, true);
  assert.equal(result.body.data?.payrollRun?.payrollRunId, 'PR-202608-0001');

  assert.deepEqual(createdDocument, {
    payrollRunId: 'PR-202608-0001',
    organisationId: 'ORG-TEST',
    cafeId: 'ZC-0001',
    periodKey: '2026-08',
    periodStartDate: '2026-08-01',
    periodEndDate: '2026-08-31',
    status: 'DRAFT',
    employeeCount: 0,
    totalGrossPaise: 0,
    totalDeductionPaise: 0,
    totalNetPayPaise: 0,
    currency: 'INR',
    notes: 'August payroll',
    timezone: 'Asia/Kolkata',
    createdBy: 'MU-0001',
    updatedBy: 'MU-0001',
  });
});


test('MASTER calculates a draft payroll run from authoritative payslip totals', async (t) => {
  mockAuth(t);
  mockAudit(t);

  let saveCount = 0;
  const payrollRun = {
    payrollRunId: 'PR-202608-0001',
    organisationId: 'ORG-TEST',
    cafeId: 'ZC-0001',
    periodKey: '2026-08',
    status: 'DRAFT',
    employeeCount: 0,
    totalGrossPaise: 0,
    totalDeductionPaise: 0,
    totalNetPayPaise: 0,
    calculatedAt: null,
    calculatedBy: null,
    updatedBy: 'MU-0001',
    async save() {
      saveCount += 1;
      return this;
    },
  };

  t.mock.method(PayrollRun, 'findOne', async (filter) => {
    assert.deepEqual(filter, {
      organisationId: 'ORG-TEST',
      payrollRunId: 'PR-202608-0001',
    });
    return payrollRun;
  });

  const payslips = [{
    payslipId: 'PS-202608-0001',
    status: 'DRAFT',
    earnings: {
      basicPayPaise: 100000,
      houseRentAllowancePaise: 20000,
      otherAllowancePaise: 0,
      overtimePayPaise: 5000,
      incentivePaise: 0,
      otherEarningPaise: 0,
      grossPayPaise: 125000,
    },
    deductions: {
      providentFundPaise: 10000,
      employeeStateInsurancePaise: 0,
      professionalTaxPaise: 2000,
      incomeTaxPaise: 0,
      loanAdvanceDeductionPaise: 3000,
      unpaidLeaveDeductionPaise: 0,
      otherDeductionPaise: 0,
      totalDeductionPaise: 15000,
    },
    netPayPaise: 110000,
  }];

  t.mock.method(Payslip, 'find', async (filter) => {
    assert.deepEqual(filter, {
      organisationId: 'ORG-TEST',
      payrollRunId: 'PR-202608-0001',
      cafeId: 'ZC-0001',
    });
    return payslips;
  });

  const server = await startServer(t);
  const result = await request(
    server,
    '/api/v1/payroll/runs/PR-202608-0001/calculate',
    { method: 'POST', token: 'token' }
  );

  assert.equal(
    result.status,
    200,
    `Expected 200, got ${result.status}: ${JSON.stringify(result.body)}`
  );
  assert.equal(payrollRun.status, 'CALCULATED');
  assert.equal(payrollRun.employeeCount, 1);
  assert.equal(payrollRun.totalGrossPaise, 125000);
  assert.equal(payrollRun.totalDeductionPaise, 15000);
  assert.equal(payrollRun.totalNetPayPaise, 110000);
  assert.equal(payrollRun.calculatedBy, 'MU-0001');
  assert.ok(payrollRun.calculatedAt instanceof Date);
  assert.equal(saveCount, 1);
});

test('MASTER submits only a calculated payroll run with verified backend totals', async (t) => {
  mockAuth(t);
  mockAudit(t);

  let saveCount = 0;
  const payrollRun = {
    payrollRunId: 'PR-202608-0001',
    organisationId: 'ORG-TEST',
    cafeId: 'ZC-0001',
    periodKey: '2026-08',
    status: 'CALCULATED',
    employeeCount: 1,
    totalGrossPaise: 125000,
    totalDeductionPaise: 15000,
    totalNetPayPaise: 110000,
    calculatedAt: new Date('2026-08-31T18:00:00.000Z'),
    calculatedBy: 'MU-0001',
    submittedAt: null,
    submittedBy: null,
    updatedBy: 'MU-0001',
    async save() {
      saveCount += 1;
      return this;
    },
  };

  t.mock.method(PayrollRun, 'findOne', async () => payrollRun);

  const server = await startServer(t);
  const result = await request(
    server,
    '/api/v1/payroll/runs/PR-202608-0001/submit',
    { method: 'POST', token: 'token' }
  );

  assert.equal(
    result.status,
    200,
    `Expected 200, got ${result.status}: ${JSON.stringify(result.body)}`
  );
  assert.equal(payrollRun.status, 'SUBMITTED');
  assert.equal(payrollRun.submittedBy, 'MU-0001');
  assert.ok(payrollRun.submittedAt instanceof Date);
  assert.equal(saveCount, 1);
});

test('MASTER approves only a submitted payroll run with complete lifecycle metadata', async (t) => {
  mockAuth(t);
  mockAudit(t);

  let saveCount = 0;
  const payrollRun = {
    payrollRunId: 'PR-202608-0001',
    organisationId: 'ORG-TEST',
    cafeId: 'ZC-0001',
    periodKey: '2026-08',
    status: 'SUBMITTED',
    employeeCount: 1,
    totalGrossPaise: 125000,
    totalDeductionPaise: 15000,
    totalNetPayPaise: 110000,
    calculatedAt: new Date('2026-08-31T18:00:00.000Z'),
    calculatedBy: 'MU-0001',
    submittedAt: new Date('2026-08-31T18:05:00.000Z'),
    submittedBy: 'MU-0001',
    approvedAt: null,
    approvedBy: null,
    updatedBy: 'MU-0001',
    async save() {
      saveCount += 1;
      return this;
    },
  };

  t.mock.method(PayrollRun, 'findOne', async () => payrollRun);

  const server = await startServer(t);
  const result = await request(
    server,
    '/api/v1/payroll/runs/PR-202608-0001/approve',
    { method: 'POST', token: 'token' }
  );

  assert.equal(
    result.status,
    200,
    `Expected 200, got ${result.status}: ${JSON.stringify(result.body)}`
  );
  assert.equal(payrollRun.status, 'APPROVED');
  assert.equal(payrollRun.approvedBy, 'MU-0001');
  assert.ok(payrollRun.approvedAt instanceof Date);
  assert.equal(saveCount, 1);
});

test('payroll submission rejects a run that has not been calculated', async (t) => {
  mockAuth(t);

  const payrollRun = {
    payrollRunId: 'PR-202608-0001',
    organisationId: 'ORG-TEST',
    cafeId: 'ZC-0001',
    periodKey: '2026-08',
    status: 'DRAFT',
  };

  t.mock.method(PayrollRun, 'findOne', async () => payrollRun);

  const server = await startServer(t);
  const result = await request(
    server,
    '/api/v1/payroll/runs/PR-202608-0001/submit',
    { method: 'POST', token: 'token' }
  );

  assert.equal(result.status, 409);
  assert.equal(result.body.error?.code, 'PAYROLL_RUN_NOT_SUBMITTABLE');
});


test('MASTER issues approved payroll payslips with backend issuance metadata', async (t) => {
  mockAuth(t);
  mockAudit(t);

  const payrollRun = {
    payrollRunId: 'PR-202608-0001',
    organisationId: 'ORG-TEST',
    cafeId: 'ZC-0001',
    periodKey: '2026-08',
    status: 'APPROVED',
    employeeCount: 1,
    totalGrossPaise: 125000,
    totalDeductionPaise: 15000,
    totalNetPayPaise: 110000,
    calculatedAt: new Date('2026-08-31T18:00:00.000Z'),
    calculatedBy: 'MU-0001',
    submittedAt: new Date('2026-08-31T18:05:00.000Z'),
    submittedBy: 'MU-0001',
    approvedAt: new Date('2026-08-31T18:10:00.000Z'),
    approvedBy: 'MU-0001',
  };

  t.mock.method(PayrollRun, 'findOne', async (filter) => {
    assert.deepEqual(filter, {
      organisationId: 'ORG-TEST',
      payrollRunId: 'PR-202608-0001',
    });
    return payrollRun;
  });

  const draftPayslip = {
    payslipId: 'PS-202608-0001',
    status: 'DRAFT',
    earnings: {
      basicPayPaise: 100000,
      houseRentAllowancePaise: 20000,
      otherAllowancePaise: 0,
      overtimePayPaise: 5000,
      incentivePaise: 0,
      otherEarningPaise: 0,
      grossPayPaise: 125000,
    },
    deductions: {
      providentFundPaise: 10000,
      employeeStateInsurancePaise: 0,
      professionalTaxPaise: 2000,
      incomeTaxPaise: 0,
      loanAdvanceDeductionPaise: 3000,
      unpaidLeaveDeductionPaise: 0,
      otherDeductionPaise: 0,
      totalDeductionPaise: 15000,
    },
    netPayPaise: 110000,
  };

  let findCallCount = 0;
  let issuanceUpdate = null;

  t.mock.method(Payslip, 'find', async (filter) => {
    assert.deepEqual(filter, {
      organisationId: 'ORG-TEST',
      payrollRunId: 'PR-202608-0001',
      cafeId: 'ZC-0001',
    });

    findCallCount += 1;

    if (findCallCount === 1) {
      return [draftPayslip];
    }

    return [{
      ...draftPayslip,
      status: 'ISSUED',
      issuedAt: issuanceUpdate.$set.issuedAt,
      issuedBy: issuanceUpdate.$set.issuedBy,
      updatedBy: issuanceUpdate.$set.updatedBy,
    }];
  });

  t.mock.method(Payslip, 'updateMany', async (filter, update) => {
    assert.deepEqual(filter, {
      organisationId: 'ORG-TEST',
      payrollRunId: 'PR-202608-0001',
      cafeId: 'ZC-0001',
      status: 'DRAFT',
    });
    assert.equal(update.$set.status, 'ISSUED');
    assert.ok(update.$set.issuedAt instanceof Date);
    assert.equal(update.$set.issuedBy, 'MU-0001');
    assert.equal(update.$set.updatedBy, 'MU-0001');
    issuanceUpdate = update;
    return { matchedCount: 1, modifiedCount: 1 };
  });

  const server = await startServer(t);
  const result = await request(
    server,
    '/api/v1/payroll/runs/PR-202608-0001/issue-payslips',
    { method: 'POST', token: 'token' }
  );

  assert.equal(
    result.status,
    200,
    `Expected 200, got ${result.status}: ${JSON.stringify(result.body)}`
  );
  assert.equal(result.body.success, true);
  assert.equal(result.body.data?.payrollRunId, 'PR-202608-0001');
  assert.equal(result.body.data?.cafeId, 'ZC-0001');
  assert.equal(result.body.data?.issuedCount, 1);
  assert.equal(result.body.data?.newlyIssuedCount, 1);
  assert.equal(result.body.data?.issuedBy, 'MU-0001');
  assert.equal(findCallCount, 2);
});


/**
 * Full mock fixture for POST /payroll/runs/:id/pay. `expectedReference` may be
 * an exact string, or a RegExp for the references the backend synthesizes when
 * the caller omits paymentReference.
 */
function mockPayablePayrollRun(t, expectedReference) {
  const assertReference = (actual) => {
    if (expectedReference instanceof RegExp) {
      assert.match(actual, expectedReference);
    } else {
      assert.equal(actual, expectedReference);
    }
  };

  mockAuth(t);
  mockAudit(t);

  const payrollRun = {
    payrollRunId: 'PR-202608-0001',
    organisationId: 'ORG-TEST',
    cafeId: 'ZC-0001',
    periodKey: '2026-08',
    status: 'APPROVED',
    employeeCount: 1,
    totalGrossPaise: 125000,
    totalDeductionPaise: 15000,
    totalNetPayPaise: 110000,
    calculatedAt: new Date('2026-08-31T18:00:00.000Z'),
    calculatedBy: 'MU-0001',
    submittedAt: new Date('2026-08-31T18:05:00.000Z'),
    submittedBy: 'MU-0001',
    approvedAt: new Date('2026-08-31T18:10:00.000Z'),
    approvedBy: 'MU-0001',
    paidAt: null,
    paidBy: null,
    paymentReference: '',
  };

  let runFindCount = 0;
  let runPaymentUpdate = null;

  t.mock.method(PayrollRun, 'findOne', async (filter) => {
    assert.deepEqual(filter, {
      organisationId: 'ORG-TEST',
      payrollRunId: 'PR-202608-0001',
    });

    runFindCount += 1;

    if (runFindCount === 1) {
      return payrollRun;
    }

    return {
      ...payrollRun,
      status: 'PAID',
      paidAt: runPaymentUpdate.$set.paidAt,
      paidBy: runPaymentUpdate.$set.paidBy,
      paymentReference: runPaymentUpdate.$set.paymentReference,
      updatedBy: runPaymentUpdate.$set.updatedBy,
    };
  });

  const issuedPayslip = {
    payslipId: 'PS-202608-0001',
    status: 'ISSUED',
    issuedAt: new Date('2026-08-31T18:15:00.000Z'),
    issuedBy: 'MU-0001',
    paidAt: null,
    paidBy: null,
    paymentReference: '',
    earnings: {
      basicPayPaise: 100000,
      houseRentAllowancePaise: 20000,
      otherAllowancePaise: 0,
      overtimePayPaise: 5000,
      incentivePaise: 0,
      otherEarningPaise: 0,
      grossPayPaise: 125000,
    },
    deductions: {
      providentFundPaise: 10000,
      employeeStateInsurancePaise: 0,
      professionalTaxPaise: 2000,
      incomeTaxPaise: 0,
      loanAdvanceDeductionPaise: 3000,
      unpaidLeaveDeductionPaise: 0,
      otherDeductionPaise: 0,
      totalDeductionPaise: 15000,
    },
    netPayPaise: 110000,
  };

  let payslipFindCount = 0;
  let payslipPaymentUpdate = null;

  t.mock.method(Payslip, 'find', async (filter) => {
    assert.deepEqual(filter, {
      organisationId: 'ORG-TEST',
      payrollRunId: 'PR-202608-0001',
      cafeId: 'ZC-0001',
    });

    payslipFindCount += 1;

    if (payslipFindCount === 1) {
      return [issuedPayslip];
    }

    return [{
      ...issuedPayslip,
      status: 'PAID',
      paidAt: payslipPaymentUpdate.$set.paidAt,
      paidBy: payslipPaymentUpdate.$set.paidBy,
      paymentReference: payslipPaymentUpdate.$set.paymentReference,
      updatedBy: payslipPaymentUpdate.$set.updatedBy,
    }];
  });

  t.mock.method(Payslip, 'updateMany', async (filter, update) => {
    assert.deepEqual(filter, {
      organisationId: 'ORG-TEST',
      payrollRunId: 'PR-202608-0001',
      cafeId: 'ZC-0001',
      status: 'ISSUED',
    });
    assert.equal(update.$set.status, 'PAID');
    assert.ok(update.$set.paidAt instanceof Date);
    assert.equal(update.$set.paidBy, 'MU-0001');
    assertReference(update.$set.paymentReference);
    assert.equal(update.$set.updatedBy, 'MU-0001');
    payslipPaymentUpdate = update;
    return { matchedCount: 1, modifiedCount: 1 };
  });

  t.mock.method(PayrollRun, 'updateOne', async (filter, update) => {
    assert.deepEqual(filter, {
      organisationId: 'ORG-TEST',
      payrollRunId: 'PR-202608-0001',
      cafeId: 'ZC-0001',
      status: 'APPROVED',
    });
    assert.equal(update.$set.status, 'PAID');
    assert.ok(update.$set.paidAt instanceof Date);
    assert.equal(update.$set.paidBy, 'MU-0001');
    assertReference(update.$set.paymentReference);
    assert.equal(update.$set.updatedBy, 'MU-0001');
    runPaymentUpdate = update;
    return { matchedCount: 1, modifiedCount: 1 };
  });

  return {
    get runFindCount() {
      return runFindCount;
    },
    get payslipFindCount() {
      return payslipFindCount;
    },
  };
}

async function requestPay(t, body) {
  const server = await startServer(t);
  return request(server, '/api/v1/payroll/runs/PR-202608-0001/pay', {
    method: 'POST',
    token: 'token',
    body,
  });
}

test('MASTER pays an issued approved payroll run with normalized backend payment metadata', async (t) => {
  const stats = mockPayablePayrollRun(t, 'BANK-REF-001');

  const result = await requestPay(t, { paymentReference: ' bank-ref-001 ' });

  assert.equal(
    result.status,
    200,
    `Expected 200, got ${result.status}: ${JSON.stringify(result.body)}`
  );
  assert.equal(result.body.success, true);
  assert.equal(result.body.data?.status, 'PAID');
  assert.equal(result.body.data?.paidPayslipCount, 1);
  assert.equal(result.body.data?.newlyPaidPayslipCount, 1);
  assert.equal(result.body.data?.paidBy, 'MU-0001');
  assert.equal(result.body.data?.paymentReference, 'BANK-REF-001');
  assert.equal(stats.runFindCount, 2);
  assert.equal(stats.payslipFindCount, 2);
});

test('Record Pay with an empty body synthesizes a backend payment reference', async (t) => {
  const stats = mockPayablePayrollRun(t, /^PAY-PR-202608-0001-[0-9A-Z]+$/);

  const result = await requestPay(t, {});

  assert.equal(
    result.status,
    200,
    `Expected 200, got ${result.status}: ${JSON.stringify(result.body)}`
  );
  assert.equal(result.body.success, true);
  assert.equal(result.body.data?.status, 'PAID');
  assert.equal(result.body.data?.newlyPaidPayslipCount, 1);
  assert.equal(result.body.data?.paidBy, 'MU-0001');
  assert.match(
    result.body.data?.paymentReference,
    /^PAY-PR-202608-0001-[0-9A-Z]+$/
  );
  assert.equal(stats.runFindCount, 2);
  assert.equal(stats.payslipFindCount, 2);
});

test('MASTER voids a payroll run and all payslips with one backend void state', async (t) => {
  mockAuth(t);
  mockAudit(t);

  const payrollRun = {
    payrollRunId: 'PR-202608-0001',
    organisationId: 'ORG-TEST',
    cafeId: 'ZC-0001',
    periodKey: '2026-08',
    status: 'PAID',
    employeeCount: 1,
    voidedAt: null,
    voidedBy: null,
    voidReason: '',
  };

  let runFindCount = 0;
  let runVoidUpdate = null;

  t.mock.method(PayrollRun, 'findOne', async (filter) => {
    assert.deepEqual(filter, {
      organisationId: 'ORG-TEST',
      payrollRunId: 'PR-202608-0001',
    });

    runFindCount += 1;

    if (runFindCount === 1) {
      return payrollRun;
    }

    return {
      ...payrollRun,
      status: 'VOIDED',
      voidedAt: runVoidUpdate.$set.voidedAt,
      voidedBy: runVoidUpdate.$set.voidedBy,
      voidReason: runVoidUpdate.$set.voidReason,
      updatedBy: runVoidUpdate.$set.updatedBy,
    };
  });

  t.mock.method(PayrollRun, 'updateOne', async (filter, update) => {
    assert.deepEqual(filter, {
      organisationId: 'ORG-TEST',
      payrollRunId: 'PR-202608-0001',
      cafeId: 'ZC-0001',
      status: { $ne: 'VOIDED' },
    });
    assert.equal(update.$set.status, 'VOIDED');
    assert.ok(update.$set.voidedAt instanceof Date);
    assert.equal(update.$set.voidedBy, 'MU-0001');
    assert.equal(update.$set.voidReason, 'Incorrect payroll data');
    assert.equal(update.$set.updatedBy, 'MU-0001');
    runVoidUpdate = update;
    return { matchedCount: 1, modifiedCount: 1 };
  });

  const activePayslip = {
    payslipId: 'PS-202608-0001',
    status: 'PAID',
    voidedAt: null,
    voidedBy: null,
    voidReason: '',
  };

  let payslipFindCount = 0;
  let payslipVoidUpdate = null;

  t.mock.method(Payslip, 'find', async (filter) => {
    assert.deepEqual(filter, {
      organisationId: 'ORG-TEST',
      payrollRunId: 'PR-202608-0001',
      cafeId: 'ZC-0001',
    });

    payslipFindCount += 1;

    if (payslipFindCount === 1) {
      return [activePayslip];
    }

    return [{
      ...activePayslip,
      status: 'VOIDED',
      voidedAt: payslipVoidUpdate.$set.voidedAt,
      voidedBy: payslipVoidUpdate.$set.voidedBy,
      voidReason: payslipVoidUpdate.$set.voidReason,
      updatedBy: payslipVoidUpdate.$set.updatedBy,
    }];
  });

  t.mock.method(Payslip, 'updateMany', async (filter, update) => {
    assert.deepEqual(filter, {
      organisationId: 'ORG-TEST',
      payrollRunId: 'PR-202608-0001',
      cafeId: 'ZC-0001',
      status: { $ne: 'VOIDED' },
    });
    assert.equal(update.$set.status, 'VOIDED');
    assert.equal(update.$set.voidedAt, runVoidUpdate.$set.voidedAt);
    assert.equal(update.$set.voidedBy, 'MU-0001');
    assert.equal(update.$set.voidReason, 'Incorrect payroll data');
    assert.equal(update.$set.updatedBy, 'MU-0001');
    payslipVoidUpdate = update;
    return { matchedCount: 1, modifiedCount: 1 };
  });

  const server = await startServer(t);
  const result = await request(
    server,
    '/api/v1/payroll/runs/PR-202608-0001/void',
    {
      method: 'POST',
      token: 'token',
      body: { voidReason: '  Incorrect payroll data  ' },
    }
  );

  assert.equal(
    result.status,
    200,
    `Expected 200, got ${result.status}: ${JSON.stringify(result.body)}`
  );
  assert.equal(result.body.success, true);
  assert.equal(result.body.data?.status, 'VOIDED');
  assert.equal(result.body.data?.voidedPayslipCount, 1);
  assert.equal(result.body.data?.newlyVoidedPayslipCount, 1);
  assert.equal(result.body.data?.voidedBy, 'MU-0001');
  assert.equal(result.body.data?.voidReason, 'Incorrect payroll data');
  assert.equal(runFindCount, 2);
  assert.equal(payslipFindCount, 2);
});

test('MASTER rejects client-controlled payslip fields', async (t) => {
  mockAuth(t);
  const server = await startServer(t);
  const result = await request(
    server,
    '/api/v1/payroll/runs/PR-202608-0001/payslips',
    {
      method: 'POST',
      token: 'token',
      body: {
        employeeUserId: 'MU-0001',
        netPayPaise: 999999,
      },
    }
  );

  assert.equal(result.status, 400);
  assert.equal(result.body.error?.code, 'PROTECTED_PAYSLIP_FIELD');
});

test('MASTER creates a draft payslip with backend identity and calculated totals', async (t) => {
  mockAuth(t, { name: 'Master User' });

  const run = {
    payrollRunId: 'PR-202608-0001',
    cafeId: 'ZC-0001',
    periodKey: '2026-08',
    periodStartDate: '2026-08-01',
    periodEndDate: '2026-08-31',
    status: 'DRAFT',
  };
  let runFindCount = 0;
  t.mock.method(PayrollRun, 'findOne', async () => {
    runFindCount += 1;
    return run;
  });

  t.mock.method(Payslip, 'findOne', async (filter) => {
    assert.deepEqual(filter, {
      organisationId: 'ORG-TEST',
      payrollRunId: 'PR-202608-0001',
      employeeUserId: 'MU-0001',
    });
    return null;
  });

  let created;
  t.mock.method(Payslip, 'create', async (document) => {
    created = document;
    return document;
  });

  t.mock.method(SequenceCounter, 'generateId', async (input) => {
    if (input.sequenceKey === 'PAYSLIP_202608') return 'PS-202608-0001';
    return 'AE-20260808-0001';
  });
  t.mock.method(AuditEvent, 'create', async (document) => document);

  const server = await startServer(t);
  const result = await request(
    server,
    '/api/v1/payroll/runs/PR-202608-0001/payslips',
    {
      method: 'POST',
      token: 'token',
      body: {
        employeeUserId: 'MU-0001',
        jobTitle: ' Owner ',
        attendanceSummary: {
          presentDays: 25,
          payableDays: 25,
          overtimeMinutes: 600,
        },
        earnings: {
          basicPayPaise: 100000,
          houseRentAllowancePaise: 20000,
          overtimePayPaise: 5000,
        },
        deductions: {
          providentFundPaise: 10000,
          professionalTaxPaise: 2000,
        },
        notes: ' August payslip ',
      },
    }
  );

  assert.equal(
    result.status,
    201,
    `Expected 201, got ${result.status}: ${JSON.stringify(result.body)}`
  );
  assert.equal(created.payslipId, 'PS-202608-0001');
  assert.equal(created.employeeName, 'Master User');
  assert.equal(created.jobTitle, 'Owner');
  // Client-typed attendance is ignored: the snapshot is derived server-side
  // from Attendance / Leave / Holiday records (none exist in this fixture).
  assert.equal(created.attendanceSummary.presentDays, 0);
  assert.equal(created.attendanceSummary.payableDays, 0);
  assert.equal(created.attendanceSummary.overtimeMinutes, 0);
  assert.equal(created.attendanceSummary.totalCalendarDays, 31);
  assert.equal(created.earnings.grossPayPaise, 125000);
  assert.equal(created.deductions.totalDeductionPaise, 12000);
  assert.equal(created.netPayPaise, 113000);
  assert.equal(created.currency, 'INR');
  assert.equal(created.status, 'DRAFT');
  assert.equal(created.timezone, 'Asia/Kolkata');
  assert.equal(created.createdBy, 'MU-0001');
  assert.equal(created.updatedBy, 'MU-0001');
  assert.equal(runFindCount, 2);
});

test('MASTER recalculates draft payslip totals on edit', async (t) => {
  mockAuth(t);
  mockAudit(t);

  t.mock.method(PayrollRun, 'findOne', async () => ({
    payrollRunId: 'PR-202608-0001',
    cafeId: 'ZC-0001',
    periodKey: '2026-08',
    status: 'DRAFT',
  }));

  let saveCount = 0;
  const payslip = {
    payslipId: 'PS-202608-0001',
    employeeUserId: 'ST-0001',
    periodKey: '2026-08',
    status: 'DRAFT',
    attendanceSummary: { presentDays: 25 },
    earnings: {
      basicPayPaise: 100000,
      houseRentAllowancePaise: 20000,
      otherAllowancePaise: 0,
      overtimePayPaise: 0,
      incentivePaise: 0,
      otherEarningPaise: 0,
      grossPayPaise: 120000,
    },
    deductions: {
      providentFundPaise: 10000,
      employeeStateInsurancePaise: 0,
      professionalTaxPaise: 2000,
      incomeTaxPaise: 0,
      loanAdvanceDeductionPaise: 0,
      unpaidLeaveDeductionPaise: 0,
      otherDeductionPaise: 0,
      totalDeductionPaise: 12000,
    },
    netPayPaise: 108000,
    notes: 'old',
    updatedBy: 'MU-0001',
    async save() {
      saveCount += 1;
      return this;
    },
  };

  t.mock.method(Payslip, 'findOne', async (filter) => {
    assert.deepEqual(filter, {
      organisationId: 'ORG-TEST',
      payrollRunId: 'PR-202608-0001',
      cafeId: 'ZC-0001',
      payslipId: 'PS-202608-0001',
    });
    return payslip;
  });

  const server = await startServer(t);
  const result = await request(
    server,
    '/api/v1/payroll/runs/PR-202608-0001/payslips/PS-202608-0001',
    {
      method: 'PATCH',
      token: 'token',
      body: {
        earnings: { basicPayPaise: 150000 },
        notes: ' revised ',
      },
    }
  );

  assert.equal(
    result.status,
    200,
    `Expected 200, got ${result.status}: ${JSON.stringify(result.body)}`
  );
  assert.equal(payslip.earnings.grossPayPaise, 170000);
  assert.equal(payslip.deductions.totalDeductionPaise, 12000);
  assert.equal(payslip.netPayPaise, 158000);
  // attendanceSummary is re-derived on every draft edit, not taken from the client.
  assert.equal(payslip.attendanceSummary.presentDays, 0);
  assert.equal(payslip.attendanceSummary.totalCalendarDays, 31);
  assert.equal(payslip.notes, 'revised');
  assert.equal(payslip.updatedBy, 'MU-0001');
  assert.equal(saveCount, 1);
});

test('issued payslips are locked from draft edits', async (t) => {
  mockAuth(t);

  t.mock.method(PayrollRun, 'findOne', async () => ({
    payrollRunId: 'PR-202608-0001',
    cafeId: 'ZC-0001',
    status: 'DRAFT',
  }));

  t.mock.method(Payslip, 'findOne', async () => ({
    payslipId: 'PS-202608-0001',
    status: 'ISSUED',
  }));

  const server = await startServer(t);
  const result = await request(
    server,
    '/api/v1/payroll/runs/PR-202608-0001/payslips/PS-202608-0001',
    {
      method: 'PATCH',
      token: 'token',
      body: { notes: 'x' },
    }
  );

  assert.equal(result.status, 409);
  assert.equal(result.body.error?.code, 'PAYSLIP_NOT_EDITABLE');
});

test('STAFF reads only an own issued payslip detail', async (t) => {
  mockAuth(t, {
    userId: 'ST-0001',
    role: 'STAFF',
    assignedCafeIds: ['ZC-0001'],
  });

  const payslip = {
    payslipId: 'PS-202608-0001',
    employeeUserId: 'ST-0001',
    status: 'ISSUED',
  };

  t.mock.method(Payslip, 'findOne', async (filter) => {
    assert.deepEqual(filter, {
      organisationId: 'ORG-TEST',
      employeeUserId: 'ST-0001',
      payslipId: 'PS-202608-0001',
      status: { $in: ['ISSUED', 'PAID'] },
    });
    return payslip;
  });

  const server = await startServer(t);
  const result = await request(
    server,
    '/api/v1/payroll/me/payslips/PS-202608-0001',
    'token'
  );

  assert.equal(
    result.status,
    200,
    `Expected 200, got ${result.status}: ${JSON.stringify(result.body)}`
  );
  assert.equal(result.body.data?.payslip?.payslipId, 'PS-202608-0001');
  assert.equal(result.body.data?.payslip?.employeeUserId, 'ST-0001');
  assert.equal(result.body.data?.payslip?.status, 'ISSUED');
});

test('STAFF downloads an own issued payslip as PDF (format=PDF)', async (t) => {
  mockAuth(t, {
    userId: 'ST-0001',
    role: 'STAFF',
    assignedCafeIds: ['ZC-0001'],
  });

  const payslip = {
    payslipId: 'PS-202608-0001',
    employeeUserId: 'ST-0001',
    employeeName: 'Aarav Nair',
    jobTitle: 'Senior Barista',
    periodKey: '2026-08',
    cafeId: 'ZC-0001',
    status: 'ISSUED',
    attendanceSummary: { totalCalendarDays: 31, payableDays: 28, presentDays: 24 },
    earnings: {
      basicPayPaise: 100000,
      houseRentAllowancePaise: 20000,
      otherAllowancePaise: 0,
      overtimePayPaise: 5000,
      incentivePaise: 2000,
      otherEarningPaise: 0,
      grossPayPaise: 127000,
    },
    deductions: {
      providentFundPaise: 10000,
      employeeStateInsurancePaise: 0,
      professionalTaxPaise: 2000,
      incomeTaxPaise: 0,
      loanAdvanceDeductionPaise: 0,
      unpaidLeaveDeductionPaise: 0,
      otherDeductionPaise: 0,
      totalDeductionPaise: 12000,
    },
    netPayPaise: 115000,
  };

  t.mock.method(Payslip, 'findOne', async () => payslip);

  const server = await startServer(t);
  const result = await request(
    server,
    '/api/v1/payroll/me/payslips/PS-202608-0001?format=PDF',
    'token'
  );

  assert.equal(
    result.status,
    200,
    `Expected 200, got ${result.status}: ${JSON.stringify(result.body)}`
  );
  assert.equal(typeof result.body, 'string');
  assert.ok(result.body.startsWith('%PDF-1.4'), 'response must be a PDF document');
  assert.ok(result.body.includes('Aarav Nair'));
  // Backend-computed totals, not the legacy netPayPaisa/grossPayPaisa spellings.
  assert.ok(result.body.includes('Gross Earnings: INR 1270.00'));
  assert.ok(result.body.includes('Total Deductions: INR 120.00'));
  assert.ok(result.body.includes('NET SALARY PAYABLE: INR 1150.00'));
  // Real employee id, not the fabricated EMP-ZC-000001 default.
  assert.ok(result.body.includes('ST-0001'));
});

test('STAFF cannot reveal another employee or draft payslip through self-service detail', async (t) => {
  mockAuth(t, {
    userId: 'ST-0001',
    role: 'STAFF',
    assignedCafeIds: ['ZC-0001'],
  });

  t.mock.method(Payslip, 'findOne', async (filter) => {
    assert.deepEqual(filter, {
      organisationId: 'ORG-TEST',
      employeeUserId: 'ST-0001',
      payslipId: 'PS-202608-0002',
      status: { $in: ['ISSUED', 'PAID'] },
    });
    return null;
  });

  const server = await startServer(t);
  const result = await request(
    server,
    '/api/v1/payroll/me/payslips/PS-202608-0002',
    'token'
  );

  assert.equal(result.status, 404);
  assert.equal(result.body.error?.code, 'PAYSLIP_NOT_FOUND');
});

test('MASTER rejects an invalid payroll calendar period', async (t) => {
  mockAuth(t);

  const server = await startServer(t);
  const result = await request(
    server,
    '/api/v1/payroll/runs',
    {
      method: 'POST',
      token: 'token',
      body: {
        cafeId: 'ZC-0001',
        periodKey: '2026-13',
      },
    }
  );

  assert.equal(result.status, 400);
  assert.equal(result.body.error?.code, 'INVALID_PAYROLL_PERIOD');
});

test('MASTER rejects a duplicate payroll run for the same cafe and period', async (t) => {
  mockAuth(t);

  t.mock.method(Cafe, 'findOne', async (filter) => {
    assert.deepEqual(filter, {
      organisationId: 'ORG-TEST',
      cafeId: 'ZC-0001',
      status: { $ne: 'ARCHIVED' },
    });
    return { cafeId: 'ZC-0001', status: 'ACTIVE' };
  });

  t.mock.method(PayrollRun, 'findOne', async (filter) => {
    assert.deepEqual(filter, {
      organisationId: 'ORG-TEST',
      cafeId: 'ZC-0001',
      periodKey: '2026-08',
    });
    return {
      payrollRunId: 'PR-202608-0001',
      organisationId: 'ORG-TEST',
      cafeId: 'ZC-0001',
      periodKey: '2026-08',
      status: 'DRAFT',
    };
  });

  const server = await startServer(t);
  const result = await request(
    server,
    '/api/v1/payroll/runs',
    {
      method: 'POST',
      token: 'token',
      body: {
        cafeId: 'ZC-0001',
        periodKey: '2026-08',
      },
    }
  );

  assert.equal(result.status, 409);
  assert.equal(result.body.error?.code, 'PAYROLL_RUN_ALREADY_EXISTS');
});

test('CAFE_ADMIN is forbidden from payroll management', async (t) => {
  mockAuth(t, {
    userId: 'AD-0001',
    role: 'CAFE_ADMIN',
    assignedCafeIds: ['ZC-0001'],
  });

  const server = await startServer(t);
  const result = await request(
    server,
    '/api/v1/payroll/runs',
    'token'
  );

  assert.equal(result.status, 403);
  assert.equal(result.body.error?.code, 'PAYROLL_MANAGEMENT_FORBIDDEN');
});
