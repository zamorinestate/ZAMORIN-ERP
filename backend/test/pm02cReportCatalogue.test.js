'use strict';

/**
 * PM-02C: Universal Category-Wise Report Catalogue, Navigation & Filter Foundation Test Suite
 * Stage 3 of the Consolidated Reports & Analytics Programme
 * 
 * Verifies:
 * - Canonical Category Registry (all 25 categories, human-friendly labels, management descriptions)
 * - Canonical Report Registry integrity (valid IDs, categories, trust, classification, runnable routes)
 * - Server-authorized catalogue filtering across Primary Master, Normal Master, Owner, Café Admin, Staff
 * - Zero count leakage across security tiers (category counts reflect only authorized reports)
 * - Direct navigation, endpoint resolution, legacy route deduplication, and terminology compliance
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  REPORT_CATEGORIES,
  REPORT_CLASSIFICATIONS,
  REPORT_TRUST_LEVELS,
  CANONICAL_REPORTS,
  ReportRegistry,
} = require('../src/reporting/reportRegistry');

const reportController = require('../src/controllers/reportController');

test('PM-02C: Universal Category-Wise Report Catalogue & Navigation Suite', async (suite) => {
  // ─── 1. CANONICAL CATEGORY REGISTRY ──────────────────────────────────────────

  await suite.test('1.1 Canonical Categories: Exactly 25 canonical categories present with exact IDs', () => {
    const expectedCategoryIds = [
      'EXECUTIVE',
      'SALES_REVENUE',
      'MENU_PRODUCT',
      'FINANCE_PROFITABILITY',
      'CASH_PAYMENTS',
      'INVENTORY_COGS',
      'PROCUREMENT_VENDORS',
      'WASTE_LOSS',
      'WORKFORCE',
      'ATTENDANCE_SHIFTS',
      'PAYROLL',
      'CUSTOMERS_LOYALTY',
      'POS_BILLING_CONTROL',
      'OPERATIONS_SERVICE',
      'QUALITY_COMPLIANCE',
      'MULTI_CAFE',
      'BUDGET_VARIANCE',
      'FORECASTING',
      'REVENUE_SHARE',
      'TREASURY_LEDGER',
      'ASSETS_MAINTENANCE',
      'TASKS_APPROVALS',
      'AUDIT_EXCEPTIONS',
      'TAX_STATUTORY',
      'CUSTOM',
    ];

    const actualKeys = Object.keys(REPORT_CATEGORIES);
    assert.equal(actualKeys.length, 25, 'Must have exactly 25 canonical categories defined');

    for (const expectedId of expectedCategoryIds) {
      assert.ok(REPORT_CATEGORIES[expectedId], `Category ${expectedId} must exist in REPORT_CATEGORIES`);
      assert.equal(REPORT_CATEGORIES[expectedId].id, expectedId, `Category ${expectedId} must have matching id property`);
      assert.ok(REPORT_CATEGORIES[expectedId].label, `Category ${expectedId} must have a display label`);
      assert.ok(REPORT_CATEGORIES[expectedId].description, `Category ${expectedId} must have a management description`);
      assert.ok(REPORT_CATEGORIES[expectedId].icon, `Category ${expectedId} must have an icon`);
    }
  });

  await suite.test('1.2 Category Labels: Section 7 human-friendly labels verified', () => {
    assert.equal(REPORT_CATEGORIES.EXECUTIVE.label, 'Executive & Management');
    assert.equal(REPORT_CATEGORIES.SALES_REVENUE.label, 'Sales & Revenue');
    assert.equal(REPORT_CATEGORIES.MENU_PRODUCT.label, 'Menu & Product Performance');
    assert.equal(REPORT_CATEGORIES.FINANCE_PROFITABILITY.label, 'Finance & Profitability');
    assert.equal(REPORT_CATEGORIES.CASH_PAYMENTS.label, 'Cash & Payments');
    assert.equal(REPORT_CATEGORIES.INVENTORY_COGS.label, 'Inventory & Cost');
    assert.equal(REPORT_CATEGORIES.PROCUREMENT_VENDORS.label, 'Procurement & Vendors');
    assert.equal(REPORT_CATEGORIES.WASTE_LOSS.label, 'Waste & Loss');
    assert.equal(REPORT_CATEGORIES.WORKFORCE.label, 'Workforce');
    assert.equal(REPORT_CATEGORIES.ATTENDANCE_SHIFTS.label, 'Attendance & Shifts');
    assert.equal(REPORT_CATEGORIES.PAYROLL.label, 'Payroll');
    assert.equal(REPORT_CATEGORIES.CUSTOMERS_LOYALTY.label, 'Customers & Loyalty');
    assert.equal(REPORT_CATEGORIES.POS_BILLING_CONTROL.label, 'POS & Billing Control');
    assert.equal(REPORT_CATEGORIES.OPERATIONS_SERVICE.label, 'Operations & Service');
    assert.equal(REPORT_CATEGORIES.QUALITY_COMPLIANCE.label, 'Quality & Compliance');
    assert.equal(REPORT_CATEGORIES.MULTI_CAFE.label, 'Multi-Café Performance');
    assert.equal(REPORT_CATEGORIES.BUDGET_VARIANCE.label, 'Budget & Variance');
    assert.equal(REPORT_CATEGORIES.FORECASTING.label, 'Forecasting & Planning');
    assert.equal(REPORT_CATEGORIES.REVENUE_SHARE.label, 'Revenue Share');
    assert.equal(REPORT_CATEGORIES.TREASURY_LEDGER.label, 'Treasury & Ledger');
    assert.equal(REPORT_CATEGORIES.ASSETS_MAINTENANCE.label, 'Assets & Maintenance');
    assert.equal(REPORT_CATEGORIES.TASKS_APPROVALS.label, 'Tasks & Approvals');
    assert.equal(REPORT_CATEGORIES.AUDIT_EXCEPTIONS.label, 'Audit & Exceptions');
    assert.equal(REPORT_CATEGORIES.TAX_STATUTORY.label, 'Tax & Statutory');
    assert.equal(REPORT_CATEGORIES.CUSTOM.label, 'Custom Reports');
  });

  // ─── 2. CANONICAL REPORT REGISTRY INTEGRITY ──────────────────────────────────

  await suite.test('2.1 Report Registry: No orphan reports and all IDs unique', () => {
    const reportList = ReportRegistry.listReports();
    assert.ok(reportList.length >= 15, 'Must have at least 15 canonical reports registered');

    const seenIds = new Set();
    for (const r of reportList) {
      assert.ok(r.reportId, 'Report must have reportId');
      assert.ok(!seenIds.has(r.reportId), `Duplicate report ID found: ${r.reportId}`);
      seenIds.add(r.reportId);

      // Category validation
      assert.ok(
        REPORT_CATEGORIES[r.category],
        `Report ${r.reportId} references unknown category: ${r.category}`
      );

      // Trust status validation
      assert.ok(
        REPORT_TRUST_LEVELS[r.trustLevel || r.trustStatus],
        `Report ${r.reportId} has invalid trust level: ${r.trustLevel || r.trustStatus}`
      );

      // Classification validation
      assert.ok(
        REPORT_CLASSIFICATIONS[r.classification],
        `Report ${r.reportId} has invalid classification: ${r.classification}`
      );

      // Runnable contract
      if (r.runnable) {
        assert.ok(r.endpoint, `Runnable report ${r.reportId} must have an endpoint`);
        assert.ok(r.endpoint.startsWith('/api/v1/reports/'), `Endpoint must follow /api/v1/reports/ convention: ${r.endpoint}`);
        assert.ok(r.frontendSubroute, `Runnable report ${r.reportId} must have a frontendSubroute`);
      }

      // Role and Filter metadata
      assert.ok(Array.isArray(r.supportedRoles), `Report ${r.reportId} must have supportedRoles array`);
      assert.ok(r.supportedRoles.length > 0, `Report ${r.reportId} must have at least one supported role`);
      assert.ok(Array.isArray(r.supportedFilters), `Report ${r.reportId} must have supportedFilters array`);
    }
  });

  await suite.test('2.2 Legacy Route Deduplication: Legacy endpoints are not registered as separate duplicate reports', () => {
    const reportList = ReportRegistry.listReports();
    const legacyAliases = ['dashboard', 'daily-summary', 'cash-flow', 'expenses', 'attendance'];

    for (const alias of legacyAliases) {
      const match = reportList.find((r) => r.reportId === alias);
      assert.equal(match, undefined, `Legacy alias "${alias}" must not be registered as a duplicate canonical report`);
    }
  });

  await suite.test('2.3 Terminology Integrity: Truthful labelling without misleading claims', () => {
    const reportList = ReportRegistry.listReports();
    for (const r of reportList) {
      // Section 48: Actual Menu Profitability must not be advertised without real COGS
      assert.ok(
        !r.title.toLowerCase().includes('actual menu profitability'),
        `Report ${r.reportId} must not claim "Actual Menu Profitability"`
      );

      // Section 47: Cash Flow Statement must not be presented if engine only does operational movements
      assert.ok(
        !r.title.toLowerCase().includes('cash flow statement'),
        `Report ${r.reportId} must not claim formal "Cash Flow Statement"`
      );
    }
  });

  // ─── 3. SERVER-AUTHORIZED LIBRARY API (CONTROLLER TESTS) ─────────────────────

  function createMockResponse() {
    return {
      statusCode: 200,
      jsonData: null,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(data) {
        this.jsonData = data;
        return this;
      },
    };
  }

  await suite.test('3.1 Primary Master: Receives all authorized reports and full 25 categories', async () => {
    const req = {
      auth: {
        userId: 'MU-0001',
        role: 'MASTER',
        isPrimaryMaster: true,
        organisationId: 'ORG-ZAMORIN',
      },
      query: {},
    };
    const res = createMockResponse();

    await reportController.getReportCatalogue(req, res);

    assert.equal(res.statusCode, 200);
    assert.ok(res.jsonData.success);
    const { categories, reports, totalReports, totalAuthorizedReports } = res.jsonData.data;

    assert.equal(categories.length, 25, 'Must return all 25 categories');
    assert.equal(totalReports, reports.length);
    assert.equal(totalAuthorizedReports, reports.length);
    assert.ok(reports.length >= 15, 'Primary Master must have access to all canonical reports');

    // Verify presence of CONFIDENTIAL and INTERNAL reports
    const internalRep = reports.find((r) => r.classification === 'INTERNAL');
    const confidentialRep = reports.find((r) => r.classification === 'CONFIDENTIAL');
    assert.ok(internalRep, 'Primary Master must receive INTERNAL reports');
    assert.ok(confidentialRep, 'Primary Master must receive CONFIDENTIAL reports');
  });

  await suite.test('3.2 Normal Master: Excludes HIGHLY_CONFIDENTIAL reports', async () => {
    const req = {
      auth: {
        userId: 'MU-0002',
        role: 'MASTER',
        isPrimaryMaster: false,
        organisationId: 'ORG-ZAMORIN',
      },
      query: {},
    };
    const res = createMockResponse();

    await reportController.getReportCatalogue(req, res);

    assert.equal(res.statusCode, 200);
    const { reports } = res.jsonData.data;

    for (const r of reports) {
      assert.notEqual(
        r.classification,
        'HIGHLY_CONFIDENTIAL',
        `Normal Master must not receive HIGHLY_CONFIDENTIAL report: ${r.reportId}`
      );
    }
  });

  await suite.test('3.3 Owner: Receives only OWNER-supported reports, excluding HIGHLY_CONFIDENTIAL', async () => {
    const req = {
      auth: {
        userId: 'OW-0001',
        role: 'OWNER',
        assignedCafeIds: ['ZC-0001'],
        primaryCafeId: 'ZC-0001',
        organisationId: 'ORG-ZAMORIN',
      },
      query: {},
      headers: {},
    };
    const res = createMockResponse();

    await reportController.getReportCatalogue(req, res);

    assert.equal(res.statusCode, 200);
    const { reports } = res.jsonData.data;

    for (const r of reports) {
      assert.ok(r.supportedRoles.includes('OWNER'), `Report ${r.reportId} must support OWNER`);
      assert.notEqual(r.classification, 'HIGHLY_CONFIDENTIAL');
    }
  });

  await suite.test('3.4 Café Admin: Receives authorized reports; unauthorized CONFIDENTIAL and HIGHLY_CONFIDENTIAL are excluded', async () => {
    const req = {
      auth: {
        userId: 'CA-0001',
        role: 'CAFE_ADMIN',
        cafeId: 'ZC-0001',
        primaryCafeId: 'ZC-0001',
        assignedCafeIds: ['ZC-0001'],
        organisationId: 'ORG-ZAMORIN',
      },
      query: {},
      headers: {},
    };
    const res = createMockResponse();

    await reportController.getReportCatalogue(req, res);

    assert.equal(res.statusCode, 200);
    const { reports, categories } = res.jsonData.data;

    for (const r of reports) {
      assert.notEqual(r.classification, 'HIGHLY_CONFIDENTIAL', `Café Admin must never see HIGHLY_CONFIDENTIAL report: ${r.reportId}`);
      assert.ok(
        (r.supportedRoles || []).includes('CAFE_ADMIN'),
        `Café Admin must only see reports listing CAFE_ADMIN in supportedRoles; found ${r.reportId}`
      );
    }

    // Unauthorized CONFIDENTIAL reports must not be in Café Admin catalogue
    for (const forbidden of ['pl-statement', 'procurement-spend', 'same-store-sales', 'cross-module-reconciliations']) {
      const plReport = reports.find((r) => r.reportId === forbidden);
      assert.equal(plReport, undefined, `${forbidden} (CONFIDENTIAL) must not be visible to Café Admin`);
    }

    // Category count security: Finance & Profitability count must be 0 for Café Admin (no count leakage)
    const financeCat = categories.find((c) => c.id === 'FINANCE_PROFITABILITY');
    assert.ok(financeCat, 'Finance category must exist in 25 categories');
    assert.equal(
      financeCat.reportCount,
      0,
      'Finance category report count must be 0 for Café Admin to prevent count leakage'
    );
    assert.equal(financeCat.hasRunnableReports, false);
  });

  await suite.test('3.5 Category Counts Security: Category counts reflect only authorized reports', async () => {
    // Check Master vs Cafe Admin category counts
    const masterReq = {
      auth: { userId: 'MU-0001', role: 'MASTER', isPrimaryMaster: true, organisationId: 'ORG-ZAMORIN' },
      query: {},
    };
    const masterRes = createMockResponse();
    await reportController.getReportCatalogue(masterReq, masterRes);

    const adminReq = {
      auth: {
        userId: 'CA-0001',
        role: 'CAFE_ADMIN',
        cafeId: 'ZC-0001',
        primaryCafeId: 'ZC-0001',
        assignedCafeIds: ['ZC-0001'],
        organisationId: 'ORG-ZAMORIN',
      },
      query: {},
      headers: {},
    };
    const adminRes = createMockResponse();
    await reportController.getReportCatalogue(adminReq, adminRes);

    const masterFinance = masterRes.jsonData.data.categories.find((c) => c.id === 'FINANCE_PROFITABILITY');
    const adminFinance = adminRes.jsonData.data.categories.find((c) => c.id === 'FINANCE_PROFITABILITY');

    assert.ok(masterFinance.reportCount > 0, 'Master must see reports in Finance & Profitability');
    assert.equal(adminFinance.reportCount, 0, 'Café Admin must see 0 reports in Finance & Profitability (zero leakage)');
  });

  // ─── 4. REPORT EXECUTION ROUTING & DISPATCH INTEGRITY ───────────────────────

  await suite.test('4.1 Destination Integrity: Every canonical report maps to an authorized endpoint', () => {
    const validEndpoints = [
      '/api/v1/reports/sales',
      '/api/v1/reports/finance',
      '/api/v1/reports/cash-flow',
      '/api/v1/reports/workforce',
      '/api/v1/reports/customers',
      '/api/v1/reports/inventory',
      '/api/v1/reports/procurement',
      '/api/v1/reports/menu',
      '/api/v1/reports/quality',
      '/api/v1/reports/assets',
      '/api/v1/reports/portfolio',
      '/api/v1/reports/goals',
      '/api/v1/reports/reconciliations',
      '/api/v1/reports/data-quality',
      '/api/v1/reports/scheduled-alerts',
    ];

    const reportList = ReportRegistry.listReports();
    for (const r of reportList) {
      if (r.runnable === false || r.availability === 'NOT_IMPLEMENTED') {
        assert.equal(r.runnable, false, 'Non-runnable report must be marked runnable: false');
        assert.equal(r.endpoint, null, 'Unimplemented report must have null endpoint');
        continue;
      }
      assert.ok(
        validEndpoints.includes(r.endpoint),
        `Report ${r.reportId} maps to unverified endpoint: ${r.endpoint}`
      );
    }
  });

  await suite.test('4.2 Zero Report Category: Category with 0 reports returns safe empty metadata', () => {
    const emptyCat = REPORT_CATEGORIES.TAX_STATUTORY;
    assert.ok(emptyCat, 'TAX_STATUTORY exists in canonical categories');
    const reportsInTax = ReportRegistry.listReports().filter((r) => r.category === 'TAX_STATUTORY');
    assert.equal(reportsInTax.length, 0, 'TAX_STATUTORY correctly has 0 runnable reports in this stage');
  });

  // ─── 5. CLASSIFICATION / ROLE CONSISTENCY (C-R1-002) ────────────────────────

  await suite.test('5.1 Classification & Authorization Decoupling: Unauthorized CONFIDENTIAL reports exclude CAFE_ADMIN', () => {
    const unauthorizedConfidential = ['pl-statement', 'procurement-spend', 'same-store-sales', 'cross-module-reconciliations'];
    for (const id of unauthorizedConfidential) {
      const r = ReportRegistry.getReport(id);
      assert.ok(r);
      assert.equal(r.classification, 'CONFIDENTIAL');
      assert.ok(
        !(r.supportedRoles || []).map((x) => x.toUpperCase()).includes('CAFE_ADMIN'),
        `Unauthorized CONFIDENTIAL report ${id} must not list CAFE_ADMIN`
      );
    }
    const inv = ReportRegistry.getReport('inventory-valuation');
    assert.equal(inv.classification, 'CONFIDENTIAL', 'inventory-valuation remains CONFIDENTIAL per §17');
    assert.ok(inv.supportedRoles.includes('CAFE_ADMIN'), 'inventory-valuation explicitly authorizes CAFE_ADMIN');
  });

  await suite.test('5.2 Category Mapping: attendance-exceptions is under ATTENDANCE_SHIFTS, not WORKFORCE', () => {
    const r = ReportRegistry.getReport('attendance-exceptions');
    assert.ok(r, 'attendance-exceptions must exist');
    assert.equal(r.category, 'ATTENDANCE_SHIFTS', 'attendance-exceptions must be categorised under ATTENDANCE_SHIFTS');
    assert.ok(
      REPORT_CATEGORIES.ATTENDANCE_SHIFTS,
      'ATTENDANCE_SHIFTS must be a canonical category'
    );
  });

  await suite.test('5.3 Procurement: procurement-spend does not include CAFE_ADMIN (vendor pricing is CONFIDENTIAL)', () => {
    const r = ReportRegistry.getReport('procurement-spend');
    assert.ok(r, 'procurement-spend must exist');
    assert.equal(r.classification, 'CONFIDENTIAL', 'procurement-spend must be CONFIDENTIAL');
    assert.ok(
      !(r.supportedRoles || []).map((x) => x.toUpperCase()).includes('CAFE_ADMIN'),
      'CAFE_ADMIN must not have access to procurement-spend'
    );
  });

  await suite.test('5.4 Operational & Commercial Sensitivity: cash-book-variance & executive-goals are INTERNAL; inventory-valuation is CONFIDENTIAL with CAFE_ADMIN access', () => {
    const cash = ReportRegistry.getReport('cash-book-variance');
    assert.equal(cash.classification, 'INTERNAL');
    assert.ok(cash.supportedRoles.includes('CAFE_ADMIN'));

    const goals = ReportRegistry.getReport('executive-goals');
    assert.equal(goals.classification, 'INTERNAL');
    assert.ok(goals.supportedRoles.includes('CAFE_ADMIN'));

    const inv = ReportRegistry.getReport('inventory-valuation');
    assert.equal(inv.classification, 'CONFIDENTIAL');
    assert.ok(inv.supportedRoles.includes('CAFE_ADMIN'));
  });

  // ─── 6. SEARCH IMPLEMENTATION (C-R1-003) ─────────────────────────────────────

  await suite.test('6.1 Search: Positive partial title match — "sales" matches daily-sales', () => {
    const reportList = ReportRegistry.listReports();
    const term = 'sales';
    const matched = reportList.filter((r) => {
      const t = term.toLowerCase();
      return (
        (r.title || '').toLowerCase().includes(t) ||
        (r.description || '').toLowerCase().includes(t) ||
        (r.category || '').toLowerCase().includes(t) ||
        (r.reportId || '').toLowerCase().includes(t)
      );
    });
    assert.ok(matched.length > 0, 'Search term "sales" must return at least one result');
    assert.ok(
      matched.find((r) => r.reportId === 'daily-sales'),
      'daily-sales must appear in results for term "sales"'
    );
  });

  await suite.test('6.2 Search: No-result term returns empty array', () => {
    const reportList = ReportRegistry.listReports();
    const term = 'xyznonexistent99';
    const matched = reportList.filter((r) => {
      const t = term.toLowerCase();
      return (
        (r.title || '').toLowerCase().includes(t) ||
        (r.description || '').toLowerCase().includes(t) ||
        (r.category || '').toLowerCase().includes(t) ||
        (r.reportId || '').toLowerCase().includes(t)
      );
    });
    assert.equal(matched.length, 0, 'Unknown search term must return zero results');
  });

  await suite.test('6.3 Search Security: CAFE_ADMIN authorized results exclude unauthorized CONFIDENTIAL reports', async () => {
    const req = {
      auth: {
        userId: 'CA-0001',
        role: 'CAFE_ADMIN',
        cafeId: 'ZC-0001',
        primaryCafeId: 'ZC-0001',
        assignedCafeIds: ['ZC-0001'],
        organisationId: 'ORG-ZAMORIN',
      },
      query: {},
      headers: {},
    };
    const res = {
      statusCode: 200,
      jsonData: null,
      status(c) { this.statusCode = c; return this; },
      json(d) { this.jsonData = d; return this; },
    };

    await require('../src/controllers/reportController').getReportCatalogue(req, res);

    assert.equal(res.statusCode, 200);
    const { reports } = res.jsonData.data;
    for (const r of reports) {
      assert.notEqual(r.classification, 'HIGHLY_CONFIDENTIAL', `CAFE_ADMIN must never see HIGHLY_CONFIDENTIAL report: ${r.reportId}`);
      assert.ok(
        (r.supportedRoles || []).includes('CAFE_ADMIN'),
        `CAFE_ADMIN must be authorized in supportedRoles for report: ${r.reportId}`
      );
    }
    // Verify unauthorized CONFIDENTIAL reports are NOT visible to CAFE_ADMIN
    for (const forbidden of ['pl-statement', 'procurement-spend', 'same-store-sales', 'cross-module-reconciliations']) {
      const found = reports.find((r) => r.reportId === forbidden);
      assert.equal(found, undefined, `${forbidden} must not appear in CAFE_ADMIN catalogue`);
    }
  });

  // ─── 7. FILTER METADATA & COMPARISON (C-R1-004 / C-R1-005) ─────────────────

  await suite.test('7.1 Filter Metadata: Every report has a non-empty supportedFilters array from registry', () => {
    const reportList = ReportRegistry.listReports();
    for (const r of reportList) {
      assert.ok(
        Array.isArray(r.supportedFilters) && r.supportedFilters.length > 0,
        `Report ${r.reportId} must declare at least one supported filter`
      );
      // period is canonical baseline for all reports
      assert.ok(
        r.supportedFilters.includes('period'),
        `Report ${r.reportId} must include "period" in supportedFilters`
      );
    }
  });

  await suite.test('7.2 Comparison Filter Contract: reportingContract accepts compare/comparison parameter', () => {
    const { parseReportRequest } = require('../src/reporting/reportingContract');
    const baseAuth = { userId: 'MU-0001', role: 'MASTER', isPrimaryMaster: true, organisationId: 'ORG-ZAMORIN' };

    // PRIOR_PERIOD
    const req1 = { query: { period: 'this_month', comparison: 'PRIOR_PERIOD' }, auth: baseAuth };
    const parsed1 = parseReportRequest(req1);
    assert.ok(parsed1.comparison, 'PRIOR_PERIOD comparison must be resolved');
    assert.equal(parsed1.comparison.comparisonType, 'PRIOR_PERIOD');

    // PRIOR_YEAR
    const req2 = { query: { period: 'this_month', compare: 'PRIOR_YEAR' }, auth: baseAuth };
    const parsed2 = parseReportRequest(req2);
    assert.ok(parsed2.comparison, 'PRIOR_YEAR comparison must be resolved');
    assert.equal(parsed2.comparison.comparisonType, 'PRIOR_YEAR');

    // No comparison
    const req3 = { query: { period: 'today' }, auth: baseAuth };
    const parsed3 = parseReportRequest(req3);
    assert.equal(parsed3.comparison, null, 'Absent comparison must return null');
  });

  await suite.test('7.3 Custom Period: Valid dateFrom/dateTo resolves correctly', () => {
    const { parseReportRequest } = require('../src/reporting/reportingContract');
    const req = {
      query: { period: 'CUSTOM', dateFrom: '2026-08-01', dateTo: '2026-08-31' },
      auth: { userId: 'MU-0001', role: 'MASTER', isPrimaryMaster: true, organisationId: 'ORG-ZAMORIN' },
    };
    const parsed = parseReportRequest(req);
    assert.equal(parsed.period.periodId, 'CUSTOM');
    assert.equal(parsed.period.dateFrom, '2026-08-01');
    assert.equal(parsed.period.dateTo, '2026-08-31');
  });

  await suite.test('7.4 Custom Period: start > end is rejected by backend', () => {
    const { parseReportRequest } = require('../src/reporting/reportingContract');
    const req = {
      query: { period: 'CUSTOM', dateFrom: '2026-08-31', dateTo: '2026-08-01' },
      auth: { organisationId: 'ORG-ZAMORIN', role: 'MASTER' },
    };
    assert.throws(
      () => parseReportRequest(req),
      (err) => {
        assert.ok(err.statusCode === 400 || err.message, 'Invalid date range must throw an error');
        return true;
      }
    );
  });

  // ─── 8. PRIMARY MASTER vs NORMAL MASTER DISTINCTION (§11) ───────────────────

  await suite.test('8.1 Primary Master receives HIGHLY_CONFIDENTIAL reports; Normal Master does not', async () => {
    // Register a temporary HIGHLY_CONFIDENTIAL test report
    ReportRegistry.registerReport({
      reportId: 'test-hc-report-pm02cr1',
      title: 'Test HC Report',
      category: 'EXECUTIVE',
      classification: 'HIGHLY_CONFIDENTIAL',
      trustLevel: 'CERTIFIED',
      actuality: 'ACTUAL',
      runnable: false,
      endpoint: '/api/v1/reports/sales',
      frontendSubroute: 'sales',
      requiredPermission: 'REPORTS_READ',
      supportedRoles: ['MASTER'],
      supportedFilters: ['period'],
      supportedExports: ['PDF'],
      supportedVisuals: [],
      sourceMetrics: [],
      drillTargets: [],
    });

    const makeReq = (isPrimary) => ({
      auth: { userId: isPrimary ? 'MU-0001' : 'MU-0002', role: 'MASTER', isPrimaryMaster: isPrimary, organisationId: 'ORG-ZAMORIN' },
      query: {},
    });
    const makeRes = () => {
      const r = { statusCode: 200, jsonData: null };
      r.status = (c) => { r.statusCode = c; return r; };
      r.json = (d) => { r.jsonData = d; return r; };
      return r;
    };

    const reportController = require('../src/controllers/reportController');

    const pmRes = makeRes();
    await reportController.getReportCatalogue(makeReq(true), pmRes);
    const pmReports = pmRes.jsonData.data.reports;
    assert.ok(pmReports.find((r) => r.reportId === 'test-hc-report-pm02cr1'), 'Primary Master must receive HIGHLY_CONFIDENTIAL reports');

    const nmRes = makeRes();
    await reportController.getReportCatalogue(makeReq(false), nmRes);
    const nmReports = nmRes.jsonData.data.reports;
    assert.equal(nmReports.find((r) => r.reportId === 'test-hc-report-pm02cr1'), undefined, 'Normal Master must NOT receive HIGHLY_CONFIDENTIAL reports');

    // Cleanup
    ReportRegistry.unregisterReport('test-hc-report-pm02cr1');
  });

  // ─── 9. COUNT SECURITY & ZERO-REPORT CATEGORIES (§37–§38) ───────────────────

  await suite.test('9.1 Count Security: No role sees a non-zero count for a category it has zero runnable reports in', async () => {
    const makeReq = (role, extra = {}) => ({
      auth: { userId: 'U-001', role, primaryCafeId: 'ZC-0001', assignedCafeIds: ['ZC-0001'], organisationId: 'ORG-ZAMORIN', ...extra },
      query: {},
      headers: {},
    });
    const makeRes = () => {
      const r = { statusCode: 200, jsonData: null };
      r.status = (c) => { r.statusCode = c; return r; };
      r.json = (d) => { r.jsonData = d; return r; };
      return r;
    };

    const reportController = require('../src/controllers/reportController');
    const roles = [
      { role: 'MASTER', extra: { isPrimaryMaster: true } },
      { role: 'OWNER', extra: { primaryCafeId: 'ZC-0001', assignedCafeIds: ['ZC-0001'] } },
      { role: 'CAFE_ADMIN', extra: { primaryCafeId: 'ZC-0001', assignedCafeIds: ['ZC-0001'] } },
    ];

    for (const { role, extra } of roles) {
      const res = makeRes();
      await reportController.getReportCatalogue(makeReq(role, extra), res);
      const { reports, categories } = res.jsonData.data;

      for (const cat of categories) {
        const actualVisibleCount = reports.filter((r) => r.category === cat.id).length;
        assert.equal(
          cat.reportCount,
          actualVisibleCount,
          `Role ${role}: category ${cat.id} reportCount (${cat.reportCount}) must equal visible report count (${actualVisibleCount})`
        );
      }
    }
  });

  await suite.test('9.2 Zero-report categories return hasRunnableReports=false for all roles', async () => {
    const reportController = require('../src/controllers/reportController');
    const req = {
      auth: { userId: 'MU-0001', role: 'MASTER', isPrimaryMaster: true, organisationId: 'ORG-ZAMORIN' },
      query: {},
    };
    const res = { statusCode: 200, jsonData: null };
    res.status = (c) => { res.statusCode = c; return res; };
    res.json = (d) => { res.jsonData = d; return res; };

    await reportController.getReportCatalogue(req, res);
    const { categories } = res.jsonData.data;

    // TAX_STATUTORY has no reports at this stage
    const taxCat = categories.find((c) => c.id === 'TAX_STATUTORY');
    assert.ok(taxCat, 'TAX_STATUTORY must appear in category list');
    assert.equal(taxCat.reportCount, 0, 'TAX_STATUTORY must have 0 reports');
    assert.equal(taxCat.hasRunnableReports, false, 'TAX_STATUTORY must have hasRunnableReports=false');
  });

  // ─── 10. CAFÉ SELECTOR & MULTI-SCOPE SECURITY (§25) ─────────────────────────

  await suite.test('10.1 Primary Master: "ALL" resolves to organisation-wide portfolio; specific café filters to that café', () => {
    const { resolveReportScope } = require('../src/reporting/reportingScope');
    const auth = { userId: 'MU-0001', role: 'MASTER', isPrimaryMaster: true, organisationId: 'ORG-ZAMORIN' };

    const scopeAll = resolveReportScope({ auth, query: { cafeId: 'ALL' } });
    assert.equal(scopeAll.isOrgWide, true);
    assert.equal(scopeAll.cafeScope, null);
    assert.equal(scopeAll.resolvedCafeId, null);

    const scopeOne = resolveReportScope({ auth, query: { cafeId: 'ZC-0001' } });
    assert.equal(scopeOne.isOrgWide, false);
    assert.equal(scopeOne.cafeScope, 'ZC-0001');
    assert.equal(scopeOne.resolvedCafeId, 'ZC-0001');
  });

  await suite.test('10.2 Owner: "ALL" resolves strictly to assignedCafeIds; unassigned cafe throws 403; empty fails closed', () => {
    const { resolveReportScope } = require('../src/reporting/reportingScope');
    const auth = {
      userId: 'OU-0001',
      role: 'OWNER',
      organisationId: 'ORG-ZAMORIN',
      assignedCafeIds: ['ZC-0001', 'ZC-0002'],
    };

    // ALL resolves to portfolio filter
    const scopeAll = resolveReportScope({ auth, query: { cafeId: 'ALL' } });
    assert.equal(scopeAll.isOrgWide, false);
    assert.deepEqual(scopeAll.cafeScope, { $in: ['ZC-0001', 'ZC-0002'] });

    // Specific assigned cafe
    const scopeAssigned = resolveReportScope({ auth, query: { cafeId: 'ZC-0001' } });
    assert.equal(scopeAssigned.resolvedCafeId, 'ZC-0001');

    // Unassigned cafe throws 403
    assert.throws(
      () => resolveReportScope({ auth, query: { cafeId: 'ZC-0999' } }),
      (err) => err.statusCode === 403 && err.code === 'CROSS_CAFE_RESOURCE_DENIED'
    );

    // Empty assigned fails closed
    const emptyAuth = { userId: 'OU-0002', role: 'OWNER', organisationId: 'ORG-ZAMORIN', assignedCafeIds: [] };
    assert.throws(
      () => resolveReportScope({ auth: emptyAuth, query: { cafeId: 'ALL' } }),
      (err) => err.statusCode === 403 && err.code === 'CROSS_CAFE_RESOURCE_DENIED'
    );
  });

  await suite.test('10.3 Café Admin: Supports multi-branch assignedCafeIds; "ALL" resolves to assigned portfolio; unassigned throws 403', () => {
    const { resolveReportScope } = require('../src/reporting/reportingScope');
    const multiAuth = {
      userId: 'CA-0001',
      role: 'CAFE_ADMIN',
      organisationId: 'ORG-ZAMORIN',
      assignedCafeIds: ['ZC-0001', 'ZC-0002'],
    };

    // ALL resolves to multi-cafe $in filter
    const scopeAll = resolveReportScope({ auth: multiAuth, query: { cafeId: 'ALL' } });
    assert.equal(scopeAll.isOrgWide, false);
    assert.deepEqual(scopeAll.cafeScope, { $in: ['ZC-0001', 'ZC-0002'] });

    // Single assigned cafe binds directly
    const singleAuth = {
      userId: 'CA-0002',
      role: 'CAFE_ADMIN',
      organisationId: 'ORG-ZAMORIN',
      assignedCafeIds: ['ZC-0001'],
    };
    const scopeSingle = resolveReportScope({ auth: singleAuth, query: { cafeId: 'ALL' } });
    assert.equal(scopeSingle.isOrgWide, false);
    assert.equal(scopeSingle.cafeScope, 'ZC-0001');

    // Specific assigned cafe
    const scopeSpecific = resolveReportScope({ auth: multiAuth, query: { cafeId: 'ZC-0002' } });
    assert.equal(scopeSpecific.resolvedCafeId, 'ZC-0002');

    // Cross-cafe unassigned cafe throws 403
    assert.throws(
      () => resolveReportScope({ auth: multiAuth, query: { cafeId: 'ZC-0003' } }),
      (err) => err.statusCode === 403 && err.code === 'CROSS_CAFE_RESOURCE_DENIED'
    );

    // Empty assigned fails closed
    const emptyAuth = { userId: 'CA-0003', role: 'CAFE_ADMIN', organisationId: 'ORG-ZAMORIN', assignedCafeIds: [] };
    assert.throws(
      () => resolveReportScope({ auth: emptyAuth, query: { cafeId: 'ALL' } }),
      (err) => err.statusCode === 403 && err.code === 'CROSS_CAFE_RESOURCE_DENIED'
    );
  });

  // ─── 11. SEARCH SECURITY ACROSS ALL ROLES (§26, §27) ────────────────────────

  await suite.test('11.1 Search Security: Server catalogue strictly denies leak of unauthorized report names for all roles', async () => {
    const reportController = require('../src/controllers/reportController');
    const makeRes = () => {
      const r = { statusCode: 200, jsonData: null };
      r.status = (c) => { r.statusCode = c; return r; };
      r.json = (d) => { r.jsonData = d; return r; };
      return r;
    };

    // 1. Owner: Cannot discover HIGHLY_CONFIDENTIAL reports
    ReportRegistry.registerReport({
      reportId: 'test-hc-search-pm02cr2',
      title: 'Board Executive Allocations',
      category: 'EXECUTIVE',
      classification: 'HIGHLY_CONFIDENTIAL',
      trustLevel: 'OPERATIONAL',
      actuality: 'ACTUAL',
      runnable: true,
      endpoint: '/api/v1/reports/sales',
      frontendSubroute: 'sales',
      requiredPermission: 'REPORTS_READ',
      supportedRoles: ['MASTER', 'OWNER'],
      supportedFilters: ['period'],
      supportedExports: ['PDF'],
      supportedVisuals: [],
      sourceMetrics: [],
      drillTargets: [],
    });

    try {
      const ownerRes = makeRes();
      await reportController.getReportCatalogue({
        auth: { userId: 'OU-0001', role: 'OWNER', organisationId: 'ORG-ZAMORIN', assignedCafeIds: ['ZC-0001'] },
        query: {},
      }, ownerRes);
      const ownerReports = ownerRes.jsonData.data.reports;
      assert.equal(ownerReports.find((r) => r.reportId === 'test-hc-search-pm02cr2'), undefined, 'Owner must NOT discover HIGHLY_CONFIDENTIAL reports');

      // 2. Normal Master: Cannot discover HIGHLY_CONFIDENTIAL reports
      const nmRes = makeRes();
      await reportController.getReportCatalogue({
        auth: { userId: 'MU-0002', role: 'MASTER', isPrimaryMaster: false, organisationId: 'ORG-ZAMORIN' },
        query: {},
      }, nmRes);
      const nmReports = nmRes.jsonData.data.reports;
      assert.equal(nmReports.find((r) => r.reportId === 'test-hc-search-pm02cr2'), undefined, 'Normal Master must NOT discover HIGHLY_CONFIDENTIAL reports');

      // 3. Cafe Admin: Cannot discover CONFIDENTIAL reports restricted to Owner/Master
      const caRes = makeRes();
      await reportController.getReportCatalogue({
        auth: { userId: 'CA-0001', role: 'CAFE_ADMIN', organisationId: 'ORG-ZAMORIN', assignedCafeIds: ['ZC-0001'] },
        query: {},
      }, caRes);
      const caReports = caRes.jsonData.data.reports;
      const forbiddenForCafeAdmin = ['pl-statement', 'procurement-spend', 'same-store-sales', 'cross-module-reconciliations'];
      for (const repId of forbiddenForCafeAdmin) {
        assert.equal(caReports.find((r) => r.reportId === repId), undefined, `Café Admin must NOT discover ${repId}`);
      }
    } finally {
      ReportRegistry.unregisterReport('test-hc-search-pm02cr2');
    }
  });

  // ─── 12. TRUST STATUS AUDIT & DATA_ISSUE / PARTIAL VERIFICATION (§37) ────────

  await suite.test('12.1 Trust Audit: pl-statement & cross-module-reconciliations are DATA_ISSUE and PARTIAL', async () => {
    const reportController = require('../src/controllers/reportController');
    const res = { statusCode: 200, jsonData: null };
    res.status = (c) => { res.statusCode = c; return res; };
    res.json = (d) => { res.jsonData = d; return res; };

    await reportController.getReportCatalogue({
      auth: { userId: 'MU-0001', role: 'MASTER', isPrimaryMaster: true, organisationId: 'ORG-ZAMORIN' },
      query: {},
    }, res);

    const { reports } = res.jsonData.data;
    const pl = reports.find((r) => r.reportId === 'pl-statement');
    assert.ok(pl);
    assert.notEqual(pl.trustStatus, 'CERTIFIED', 'pl-statement must not be CERTIFIED');
    assert.equal(pl.trustStatus, 'DATA_ISSUE');
    assert.equal(pl.availability, 'PARTIAL');

    const rec = reports.find((r) => r.reportId === 'cross-module-reconciliations');
    assert.ok(rec);
    assert.notEqual(rec.trustStatus, 'CERTIFIED', 'cross-module-reconciliations must not be CERTIFIED');
    assert.equal(rec.trustStatus, 'DATA_ISSUE');
    assert.equal(rec.availability, 'PARTIAL');

    // No report in catalogue falsely claims CERTIFIED without GL audit
    const certifiedReports = reports.filter((r) => r.trustStatus === 'CERTIFIED');
    assert.equal(certifiedReports.length, 0, 'Zero reports may be marked CERTIFIED without audit evidence');
  });

  await suite.test('12.2 Classification vs Authorization: inventory-valuation remains CONFIDENTIAL while allowing CAFE_ADMIN', () => {
    const inv = ReportRegistry.getReport('inventory-valuation');
    assert.ok(inv);
    assert.equal(inv.classification, 'CONFIDENTIAL', 'inventory-valuation must retain CONFIDENTIAL classification due to commercial costs');
    assert.ok(inv.supportedRoles.includes('CAFE_ADMIN'), 'inventory-valuation must authorize CAFE_ADMIN for store-level operational stock management');
  });

  // ─── 13. PERIOD ENGINE RESOLUTION ACROSS ALL 13 PERIODS (§38) ───────────────

  await suite.test('13.1 Period Engine: All 13 canonical periods resolve deterministically in reportingTime.js', () => {
    const { resolveReportPeriod } = require('../src/reporting/reportingTime');
    const canonicalPeriods = [
      'TODAY',
      'YESTERDAY',
      'THIS_WEEK',
      'LAST_WEEK',
      'THIS_MONTH',
      'LAST_MONTH',
      'MTD',
      'PREVIOUS_MTD',
      'THIS_QUARTER',
      'LAST_QUARTER',
      'YTD',
      'PREVIOUS_YTD',
      'CUSTOM',
    ];

    for (const p of canonicalPeriods) {
      const customRange = p === 'CUSTOM' ? { dateFrom: '2026-08-01', dateTo: '2026-08-15' } : {};
      const resUpper = resolveReportPeriod(p, customRange);
      assert.ok(resUpper, `Period ${p} must resolve`);
      assert.ok(resUpper.dateFrom, `Period ${p} must have dateFrom`);
      assert.ok(resUpper.dateTo, `Period ${p} must have dateTo`);
      assert.ok(resUpper.dateFrom <= resUpper.dateTo, `Period ${p} dateFrom <= dateTo`);

      // Lowercase variant must map deterministically
      const resLower = resolveReportPeriod(p.toLowerCase(), customRange);
      assert.equal(resLower.periodId, resUpper.periodId);
      assert.equal(resLower.dateFrom, resUpper.dateFrom);
      assert.equal(resLower.dateTo, resUpper.dateTo);
    }
  });

  // ─── 14. REPORT DESTINATION AUDIT (§30) ──────────────────────────────────────

  await suite.test('14.1 Destination Audit: cash-book-variance maps to /api/v1/reports/cash-flow and subroute "cash"', () => {
    const cashReport = ReportRegistry.getReport('cash-book-variance');
    assert.ok(cashReport);
    assert.equal(cashReport.endpoint, '/api/v1/reports/cash-flow');
    assert.equal(cashReport.frontendSubroute, 'cash');
    assert.notEqual(cashReport.frontendSubroute, 'reconciliations', 'cash-book-variance must NOT open reconciliations view');
  });

  // ─── 15. EXPORT & RUN REPORT FILTER PARITY (§28, §29) ───────────────────────

  await suite.test('15.1 Export Filter Parity: Export receives same cafeId, period, dateFrom, dateTo, comparison without silent drop', async () => {
    const reportController = require('../src/controllers/reportController');
    const req = {
      auth: { userId: 'OU-0001', role: 'OWNER', organisationId: 'ORG-ZAMORIN', assignedCafeIds: ['ZC-0001'] },
      body: {
        reportId: 'daily-sales',
        format: 'XLSX',
        period: 'THIS_MONTH',
        cafeId: 'ZC-0001',
        dateFrom: '2026-09-01',
        dateTo: '2026-09-08',
        comparison: 'PRIOR_PERIOD',
      },
      query: {},
      headers: {},
    };
    const res = {
      statusCode: 200,
      jsonData: null,
      status(c) { this.statusCode = c; return this; },
      json(d) { this.jsonData = d; return this; },
    };

    await reportController.generateZurfExport(req, res, () => {});
    assert.equal(res.statusCode, 200);
    assert.ok(res.jsonData.success);
    const exportJob = res.jsonData.data;
    assert.ok(exportJob.runId, 'Must generate runId');
    assert.ok(exportJob.manifest.scope.includes('ZC-0001'), 'Scope must reflect requested cafeId');
    assert.equal(exportJob.manifest.period, 'THIS_MONTH', 'Period must match requested period');
    assert.ok(exportJob.xlsxBase64, 'Must return xlsxBase64');
    assert.ok(exportJob.filename.endsWith('.xlsx'), 'Filename must end in .xlsx');
    assert.equal(exportJob.mimeType, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  });

  await suite.test('15.2 Run Report Filter Parity: Report execution accepts all active filters', async () => {
    const reportController = require('../src/controllers/reportController');
    const req = {
      auth: { userId: 'OU-0001', role: 'OWNER', organisationId: 'ORG-ZAMORIN', assignedCafeIds: ['ZC-0001'] },
      query: {
        cafeId: 'ZC-0001',
        period: 'LAST_MONTH',
        compare: 'PRIOR_YEAR',
      },
      headers: {},
    };
    const res = {
      statusCode: 200,
      jsonData: null,
      status(c) { this.statusCode = c; return this; },
      json(d) { this.jsonData = d; return this; },
    };

    await reportController.getSalesAnalytics(req, res, () => {});
    assert.equal(res.statusCode, 200);
    assert.ok(res.jsonData.success);
    assert.ok(res.jsonData.data, 'Must return sales report data');
  });

  // ─── 16. GOVERNANCE TRUST & AUDIT INTEGRITY TESTS (§37) ──────────────────────

  await suite.test('16.1 P&L Statement: Marked DATA_ISSUE/PARTIAL while COGS and downstream EBITDA are unavailable', async () => {
    const reportController = require('../src/controllers/reportController');
    const req = {
      auth: { userId: 'MU-0001', role: 'MASTER', isPrimaryMaster: true, organisationId: 'ORG-ZAMORIN' },
      query: {},
      headers: {},
    };
    const res = {
      statusCode: 200,
      jsonData: null,
      status(c) { this.statusCode = c; return this; },
      json(d) { this.jsonData = d; return this; },
    };

    await reportController.getFinanceAnalytics(req, res, () => {});
    assert.equal(res.statusCode, 200);
    assert.ok(res.jsonData.success);
    // Verified: COGS and EBITDA are unavailable
    const pnl = res.jsonData.data.plStatement;
    assert.ok(pnl, 'Must return pnlStatement');
    assert.equal(pnl.cogs, null, 'Authoritative COGS must be null / unavailable');
    assert.equal(pnl.cogsStatus, 'UNAVAILABLE', 'COGS status must be UNAVAILABLE');
    assert.equal(pnl.grossProfit, null, 'Gross Profit must be null / unavailable');
    assert.equal(pnl.primeCost, null, 'Prime Cost must be null / unavailable');
    assert.equal(pnl.ebitdaStatus, 'UNAVAILABLE', 'EBITDA status must be UNAVAILABLE');
  });

  await suite.test('16.2 Cross-Module Reconciliations: Exactly 3 controls UNAVAILABLE and 1 control MATCHED', async () => {
    const reportController = require('../src/controllers/reportController');
    const req = {
      auth: { userId: 'MU-0001', role: 'MASTER', isPrimaryMaster: true, organisationId: 'ORG-ZAMORIN' },
      query: {},
      headers: {},
    };
    const res = {
      statusCode: 200,
      jsonData: null,
      status(c) { this.statusCode = c; return this; },
      json(d) { this.jsonData = d; return this; },
    };

    await reportController.getCrossModuleReconciliations(req, res, () => {});
    assert.equal(res.statusCode, 200);
    assert.ok(res.jsonData.success);
    const reconciliations = res.jsonData.data.reconciliations;
    assert.ok(Array.isArray(reconciliations));
    assert.equal(reconciliations.length, 4);

    const unavailableControls = reconciliations.filter((c) => c.status === 'UNAVAILABLE');
    const matchedControls = reconciliations.filter((c) => c.status === 'MATCHED' || c.status === 'BALANCED');

    assert.equal(unavailableControls.length, 3, 'Must have exactly 3 controls unavailable (POS-GL, GRN-Stock, AP-Bank)');
    assert.equal(matchedControls.length, 1, 'Must have exactly 1 control matched/active (PayrollRun-Payslip)');
  });

  // ─── 17. PM-02C-R3 REPORT EXPORT POLICY, CANONICAL REGISTRY & VENDOR GATE ─────

  await suite.test('17.1 Direct CSV API Request is rejected with 400 UNSUPPORTED_EXPORT_FORMAT', async () => {
    const reportController = require('../src/controllers/reportController');
    const formats = ['CSV', 'csv', 'text/csv', 'FORMAT_CSV'];
    for (const fmt of formats) {
      const req = {
        auth: { userId: 'OU-0001', role: 'OWNER', organisationId: 'ORG-ZAMORIN', assignedCafeIds: ['ZC-0001'] },
        body: { reportId: 'daily-sales', format: fmt },
        query: {},
        headers: {},
      };
      let capturedError = null;
      try {
        await reportController.generateZurfExport(req, {}, (err) => { capturedError = err; });
      } catch (err) {
        capturedError = err;
      }
      assert.ok(capturedError, `Format '${fmt}' must be rejected with an error`);
      assert.equal(capturedError.statusCode, 400, `Format '${fmt}' must return 400 status`);
      assert.equal(capturedError.code, 'UNSUPPORTED_EXPORT_FORMAT', `Format '${fmt}' error code must be UNSUPPORTED_EXPORT_FORMAT`);
    }
  });

  await suite.test('17.2 PDF and XLSX Export Requests are both accepted', async () => {
    const reportController = require('../src/controllers/reportController');

    // Test PDF export
    const reqPdf = {
      auth: { userId: 'OU-0001', role: 'OWNER', organisationId: 'ORG-ZAMORIN', assignedCafeIds: ['ZC-0001'] },
      body: { reportId: 'daily-sales', format: 'PDF', cafeId: 'ZC-0001', period: 'THIS_MONTH' },
      query: {},
      headers: {},
    };
    const resPdf = {
      statusCode: 200,
      jsonData: null,
      status(c) { this.statusCode = c; return this; },
      json(d) { this.jsonData = d; return this; },
    };
    await reportController.generateZurfExport(reqPdf, resPdf, () => {});
    assert.equal(resPdf.statusCode, 200);
    assert.ok(resPdf.jsonData.success);
    assert.equal(resPdf.jsonData.data.format, 'PDF');
    assert.ok(resPdf.jsonData.data.pdfBase64);
    assert.ok(resPdf.jsonData.data.html.includes('ZURF'));

    // Test XLSX export
    const reqXlsx = {
      auth: { userId: 'OU-0001', role: 'OWNER', organisationId: 'ORG-ZAMORIN', assignedCafeIds: ['ZC-0001'] },
      body: { reportId: 'daily-sales', format: 'XLSX', cafeId: 'ZC-0001', period: 'THIS_MONTH' },
      query: {},
      headers: {},
    };
    const resXlsx = {
      statusCode: 200,
      jsonData: null,
      status(c) { this.statusCode = c; return this; },
      json(d) { this.jsonData = d; return this; },
    };
    await reportController.generateZurfExport(reqXlsx, resXlsx, () => {});
    assert.equal(resXlsx.statusCode, 200);
    assert.ok(resXlsx.jsonData.success);
    assert.equal(resXlsx.jsonData.data.format, 'XLSX');
    assert.ok(resXlsx.jsonData.data.xlsxBase64);
    assert.ok(resXlsx.jsonData.data.filename.endsWith('.xlsx'));
    assert.equal(resXlsx.jsonData.data.mimeType, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  });

  await suite.test('17.3 Report Registry supportedExports strictly contains only PDF and XLSX with zero CSV', async () => {
    const { ReportRegistry } = require('../src/reporting/reportRegistry');
    const reports = ReportRegistry.listReports();
    assert.ok(reports.length >= 15, 'Must have at least 15 canonical reports');
    for (const rpt of reports) {
      assert.ok(Array.isArray(rpt.supportedExports), `Report ${rpt.reportId} must have supportedExports array`);
      if (rpt.reportId === 'vendor-performance-intelligence' && rpt.availability === 'NOT_IMPLEMENTED') {
        assert.deepEqual(rpt.supportedExports, [], 'vendor-performance-intelligence supportedExports must be empty [] while unimplemented');
        assert.deepEqual(rpt.plannedExports, ['PDF', 'XLSX'], 'vendor-performance-intelligence plannedExports must be PDF and XLSX');
      } else {
        assert.deepEqual(rpt.supportedExports, ['PDF', 'XLSX'], `Report ${rpt.reportId} supportedExports must be exactly ['PDF', 'XLSX']`);
      }
      assert.equal(rpt.supportedExports.includes('CSV'), false, `Report ${rpt.reportId} must NOT include CSV in supportedExports`);
      assert.equal(rpt.supportedExports.includes('HTML'), false, `Report ${rpt.reportId} must NOT include HTML in supportedExports`);
    }
  });

  await suite.test('17.4 Category Taxonomy strictly matches exact frozen 25 category IDs', async () => {
    const { REPORT_CATEGORIES } = require('../src/reporting/reportRegistry');
    const FROZEN_25_CATEGORIES = [
      'EXECUTIVE',
      'SALES_REVENUE',
      'MENU_PRODUCT',
      'FINANCE_PROFITABILITY',
      'CASH_PAYMENTS',
      'INVENTORY_COGS',
      'PROCUREMENT_VENDORS',
      'WASTE_LOSS',
      'WORKFORCE',
      'ATTENDANCE_SHIFTS',
      'PAYROLL',
      'CUSTOMERS_LOYALTY',
      'POS_BILLING_CONTROL',
      'OPERATIONS_SERVICE',
      'QUALITY_COMPLIANCE',
      'MULTI_CAFE',
      'BUDGET_VARIANCE',
      'FORECASTING',
      'REVENUE_SHARE',
      'TREASURY_LEDGER',
      'ASSETS_MAINTENANCE',
      'TASKS_APPROVALS',
      'AUDIT_EXCEPTIONS',
      'TAX_STATUTORY',
      'CUSTOM',
    ];

    const actualIds = Object.keys(REPORT_CATEGORIES).sort();
    const expectedIds = [...FROZEN_25_CATEGORIES].sort();

    assert.equal(actualIds.length, 25, 'Must have exactly 25 category IDs');
    assert.deepEqual(actualIds, expectedIds, 'Set of category IDs must match frozen 25 category IDs exactly');

    // Verify no non-canonical IDs exist
    const invalidIds = ['FINANCE_PL', 'WORKFORCE_LABOUR', 'CUSTOMERS_GUESTS', 'INVENTORY_STOCK', 'MENU_RECIPES', 'QUALITY_SAFETY', 'ASSETS_FACILITIES'];
    for (const inv of invalidIds) {
      assert.equal(REPORT_CATEGORIES[inv], undefined, `Non-canonical category ID ${inv} must NOT exist`);
    }
  });

  await suite.test('17.5 Stable Canonical Report IDs and Compatibility Aliases', async () => {
    const { ReportRegistry } = require('../src/reporting/reportRegistry');
    
    // Stable canonical IDs
    const custRetention = ReportRegistry.getReport('customer-retention');
    assert.ok(custRetention, 'customer-retention must exist as canonical report ID');
    assert.equal(custRetention.reportId, 'customer-retention');

    const assetMaint = ReportRegistry.getReport('asset-maintenance');
    assert.ok(assetMaint, 'asset-maintenance must exist as canonical report ID');
    assert.equal(assetMaint.reportId, 'asset-maintenance');

    // Compatibility aliases resolve cleanly
    const guestAlias = ReportRegistry.getReport('guest-retention');
    assert.ok(guestAlias, 'guest-retention alias must resolve to customer-retention');
    assert.equal(guestAlias.reportId, 'customer-retention');

    const equipAlias = ReportRegistry.getReport('equipment-availability');
    assert.ok(equipAlias, 'equipment-availability alias must resolve to asset-maintenance');
    assert.equal(equipAlias.reportId, 'asset-maintenance');
  });

  await suite.test('17.6 Vendor Intelligence canonical requirement under PROCUREMENT_VENDORS', async () => {
    const { ReportRegistry } = require('../src/reporting/reportRegistry');
    const vendorReport = ReportRegistry.getReport('vendor-performance-intelligence');
    assert.ok(vendorReport, 'vendor-performance-intelligence must be registered in registry');
    assert.equal(vendorReport.category, 'PROCUREMENT_VENDORS', 'Must belong to canonical PROCUREMENT_VENDORS category');
    assert.ok(['AVAILABLE', 'NOT_IMPLEMENTED'].includes(vendorReport.availability), 'Availability must be AVAILABLE (PM-02E) or NOT_IMPLEMENTED (pre-PM-02E)');
    if (vendorReport.availability === 'AVAILABLE') {
      assert.equal(vendorReport.runnable, true, 'Report must be runnable when activated in PM-02E');
      assert.deepEqual(vendorReport.supportedExports, ['PDF', 'XLSX'], 'Supported exports must be PDF and XLSX');
    } else {
      assert.equal(vendorReport.runnable, false, 'Report must NOT be runnable while unimplemented');
      assert.deepEqual(vendorReport.supportedExports, [], 'Supported exports must be empty [] pending implementation');
    }
    assert.deepEqual(vendorReport.plannedExports || vendorReport.supportedExports, ['PDF', 'XLSX'], 'Exports must be PDF and XLSX');
  });

  await suite.test('17.7 Classification Enum contains only INTERNAL, CONFIDENTIAL, HIGHLY_CONFIDENTIAL (Zero PUBLIC)', async () => {
    const { REPORT_CLASSIFICATIONS } = require('../src/reporting/reportRegistry');
    const keys = Object.keys(REPORT_CLASSIFICATIONS);
    assert.equal(keys.length, 3, 'Must have exactly 3 classification levels');
    assert.deepEqual(keys.sort(), ['CONFIDENTIAL', 'HIGHLY_CONFIDENTIAL', 'INTERNAL']);
    assert.equal(REPORT_CLASSIFICATIONS.PUBLIC, undefined, 'PUBLIC classification must NOT exist in production constants');
  });

  // ─── 18. PM-02C-R4 FINAL EXPORT BOUNDARY & STABILITY GATES ───────────────────

  await suite.test('18.1 Public export strictly rejects HTML export requests with 400', async () => {
    const reportController = require('../src/controllers/reportController');
    const htmlFormats = ['HTML', 'html', 'text/html', 'FORMAT_HTML'];
    for (const fmt of htmlFormats) {
      const req = {
        auth: { userId: 'OU-0001', role: 'OWNER', organisationId: 'ORG-ZAMORIN', assignedCafeIds: ['ZC-0001'] },
        body: { reportId: 'daily-sales', format: fmt },
        query: {},
        headers: {},
      };
      let capturedError = null;
      try {
        await reportController.generateZurfExport(req, {}, (err) => { capturedError = err; });
      } catch (err) {
        capturedError = err;
      }
      assert.ok(capturedError, `Format '${fmt}' must be rejected`);
      assert.equal(capturedError.statusCode, 400, `Format '${fmt}' must return 400`);
      assert.equal(capturedError.code, 'UNSUPPORTED_EXPORT_FORMAT');
    }
  });

  await suite.test('18.2 Public export rejects other unsupported formats (XML, JSON, XLS, TXT)', async () => {
    const reportController = require('../src/controllers/reportController');
    const badFormats = ['XML', 'xml', 'JSON', 'json', 'XLS', 'xls', 'TXT', 'txt'];
    for (const fmt of badFormats) {
      const req = {
        auth: { userId: 'OU-0001', role: 'OWNER', organisationId: 'ORG-ZAMORIN', assignedCafeIds: ['ZC-0001'] },
        body: { reportId: 'daily-sales', format: fmt },
        query: {},
        headers: {},
      };
      let capturedError = null;
      try {
        await reportController.generateZurfExport(req, {}, (err) => { capturedError = err; });
      } catch (err) {
        capturedError = err;
      }
      assert.ok(capturedError, `Format '${fmt}' must be rejected`);
      assert.equal(capturedError.statusCode, 400, `Format '${fmt}' must return 400`);
      assert.equal(capturedError.code, 'UNSUPPORTED_EXPORT_FORMAT');
    }
  });

  await suite.test('18.3 Canonical same-store report ID is same-store-sales; alias portfolio-lfl-growth resolves cleanly', async () => {
    const { ReportRegistry } = require('../src/reporting/reportRegistry');
    const canonicalRpt = ReportRegistry.getReport('same-store-sales');
    assert.ok(canonicalRpt, 'same-store-sales must exist as canonical report');
    assert.equal(canonicalRpt.reportId, 'same-store-sales');
    assert.equal(canonicalRpt.category, 'MULTI_CAFE');

    const aliasRpt = ReportRegistry.getReport('portfolio-lfl-growth');
    assert.ok(aliasRpt, 'portfolio-lfl-growth alias must resolve');
    assert.equal(aliasRpt.reportId, 'same-store-sales');

    // Ensure no duplicate cards in catalogue
    const allReports = ReportRegistry.listReports();
    const sameStoreCards = allReports.filter((r) => r.reportId === 'same-store-sales');
    const lflCards = allReports.filter((r) => r.reportId === 'portfolio-lfl-growth');
    assert.equal(sameStoreCards.length, 1, 'Exactly one card for same-store-sales in catalogue');
    assert.equal(lflCards.length, 0, 'portfolio-lfl-growth alias must not create duplicate card in catalogue');
  });

  await suite.test('18.4 Executive goals category is strictly BUDGET_VARIANCE', async () => {
    const { ReportRegistry } = require('../src/reporting/reportRegistry');
    const execGoals = ReportRegistry.getReport('executive-goals');
    assert.ok(execGoals, 'executive-goals report must exist');
    assert.equal(execGoals.category, 'BUDGET_VARIANCE', 'executive-goals must be in BUDGET_VARIANCE category');
  });

  await suite.test('18.5 Menu report title is truthfully Menu Performance & Estimated Contribution', async () => {
    const { ReportRegistry } = require('../src/reporting/reportRegistry');
    const menuRpt = ReportRegistry.getReport('menu-engineering');
    assert.ok(menuRpt, 'menu-engineering report must exist');
    assert.equal(menuRpt.title, 'Menu Performance & Estimated Contribution', 'Must use truthful title while COGS is unavailable');
  });

  await suite.test('18.6 Frontend export selector contains exactly PDF and Excel (XLSX) options in reportsAnalytics.js', async () => {
    const fs = require('fs');
    const path = require('path');
    const frontendCode = fs.readFileSync(path.join(__dirname, '../../frontend/src/js/pages/reportsAnalytics.js'), 'utf8');

    // Ensure #modal-exp-fmt select has exactly PDF and XLSX options
    const selectMatch = frontendCode.match(/<select id="modal-exp-fmt"[^>]*>([\s\S]*?)<\/select>/);
    assert.ok(selectMatch, 'Must find modal-exp-fmt select element');
    const optionsHtml = selectMatch[1];
    
    assert.ok(optionsHtml.includes('<option value="PDF">PDF</option>'), 'Must have PDF option');
    assert.ok(optionsHtml.includes('<option value="XLSX">Excel</option>'), 'Must have Excel (XLSX) option');
    assert.equal(optionsHtml.includes('CSV'), false, 'Must NOT contain CSV option');
    assert.equal(optionsHtml.includes('HTML'), false, 'Must NOT contain HTML option');
    assert.equal(optionsHtml.includes('XLS<'), false, 'Must NOT contain legacy XLS option');
    assert.equal(optionsHtml.includes('XML'), false, 'Must NOT contain XML option');
  });
});

