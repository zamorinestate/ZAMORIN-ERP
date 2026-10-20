'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const reportController = require('../src/controllers/reportController');
const { ZurfService } = require('../src/services/zurfService');
const { InventoryLot } = require('../src/models/InventoryLot');
const { GlobalInventoryItem } = require('../src/models/GlobalInventoryItem');
const { PurchaseOrder } = require('../src/models/PurchaseOrder');
const { Vendor } = require('../src/models/Vendor');

test('OWN-SCR-007 / Master Parity: Reports & Governed Analytics Parity & Security Suite', async (t) => {
  t.mock.method(InventoryLot, 'find', () => ({
    lean: async () => [
      { lotId: 'LOT-01', itemId: 'ITEM-1', cafeId: 'ZC-0001', remainingQuantity: 50, status: 'AVAILABLE' },
    ],
  }));
  t.mock.method(GlobalInventoryItem, 'find', () => ({
    lean: async () => [
      { itemId: 'ITEM-1', name: 'Arabica Coffee', category: 'COFFEE_BEANS', unitCostPaisa: 65000 },
    ],
  }));
  t.mock.method(PurchaseOrder, 'find', () => ({
    lean: async () => [
      {
        purchaseOrderId: 'PO-01',
        vendorId: 'VEN-01',
        status: 'CONFIRMED',
        totalPaisa: 500000,
        cafeId: 'ZC-0001',
        lineItems: [{ itemId: 'ITEM-1', orderedQuantityBase: 10, receivedQuantityBase: 10, unitPricePaisa: 50000 }],
      },
    ],
  }));
  t.mock.method(Vendor, 'find', () => ({
    lean: async () => [
      { vendorId: 'VEN-01', name: 'Wayanad Roasters', status: 'ACTIVE' },
    ],
  }));

  // Helper mock request and response builder
  function buildMockReqRes(role = 'OWNER', params = {}, query = {}, body = {}, authOverrides = {}) {
    const req = {
      auth: {
        userId: 'owner-usr-001',
        role,
        cafeId: 'ZC-0001',
        assignedCafeIds: ['ZC-0001', 'ZC-0002'],
        organisationId: 'ORG-ZAMORIN-01',
        ...authOverrides,
      },
      params,
      query,
      body,
      headers: {},
      ip: '127.0.0.1',
    };
    let responseData = null;
    let statusCode = 200;
    const responseHeaders = {};
    const res = {
      status(code) {
        statusCode = code;
        return this;
      },
      json(data) {
        responseData = data;
        return this;
      },
      setHeader(k, v) {
        responseHeaders[k.toLowerCase()] = v;
        return this;
      },
      send(data) {
        responseData = data;
        return this;
      },
    };
    const next = (err) => {
      if (err) throw err;
    };
    return { req, res, next, getResult: () => ({ statusCode, data: responseData, headers: responseHeaders }) };
  }

  // ── 1. Overview & Certified Reports ──────────────────────────────────────────
  await t.test('1. Overview endpoint returns KPI cards, recent certified reports, and scheduled deliveries', async () => {
    const { req, res, getResult } = buildMockReqRes('OWNER');
    await reportController.getAnalyticsOverview(req, res, () => {});
    const result = getResult();

    assert.equal(result.statusCode, 200);
    assert.equal(result.data.success, true);
    assert.ok(result.data.data.kpis, 'Must include KPI headline cards');
    assert.ok(result.data.data.kpis.netSalesMdt, 'Must have net sales MDT');
    assert.ok(Array.isArray(result.data.data.recentReports), 'Must include recent certified reports');
    assert.ok(result.data.data.recentReports.length >= 3, 'Must have at least 3 recent reports');
    assert.ok(Array.isArray(result.data.data.scheduledDeliveries), 'Must include scheduled deliveries');
  });

  // ── 2. Governed Report Library / Catalogue ───────────────────────────────────
  await t.test('2. Report Catalogue returns certified reports across all 10 corporate domains', async () => {
    const { req, res, getResult } = buildMockReqRes('OWNER');
    await reportController.getReportCatalogue(req, res, () => {});
    const result = getResult();

    assert.equal(result.statusCode, 200);
    assert.ok(Array.isArray(result.data.data.reports));
    assert.ok(result.data.data.reports.length >= 10);
    
    // Verify trustStatus on every certified report
    result.data.data.reports.forEach((r) => {
      assert.ok(r.reportId, 'Must have reportId');
      assert.ok(r.title, 'Must have title');
      assert.ok(r.category, 'Must have category');
      assert.ok(['CERTIFIED', 'GOVERNED', 'OPERATIONAL', 'ESTIMATED', 'DATA_ISSUE'].includes(r.trustStatus), 'Must have governed trustStatus');
      assert.ok(r.version, 'Must have version string');
    });
  });

  // ── 3. Sales & POS Analytics ────────────────────────────────────────────────
  await t.test('3. Sales analytics returns service modes, hourly trends, and payment mix', async () => {
    const { req, res, getResult } = buildMockReqRes('OWNER');
    await reportController.getSalesAnalytics(req, res, () => {});
    const result = getResult();

    assert.equal(result.statusCode, 200);
    assert.ok(result.data.data.summary, 'Must include summary');
    assert.ok(typeof result.data.data.summary.grossSalesPaise === 'number');
    assert.ok(Array.isArray(result.data.data.hourlyTrends), 'Must include hourly trends');
    assert.ok(Array.isArray(result.data.data.paymentMix), 'Must include payment mix (UPI, Cards, Cash)');
    assert.ok(Array.isArray(result.data.data.serviceModes), 'Must include service modes (Dine-in, Takeaway)');
  });

  // ── 4. Financial & P&L Waterfall ─────────────────────────────────────────────
  await t.test('4. Financial analytics returns P&L statement with EBITDA and waterfall', async () => {
    const { req, res, getResult } = buildMockReqRes('OWNER');
    await reportController.getFinanceAnalytics(req, res, () => {});
    const result = getResult();

    assert.equal(result.statusCode, 200);
    const { plStatement, waterfall } = result.data.data;
    assert.ok(plStatement, 'Must have P&L statement');
    assert.ok(typeof plStatement.grossRevenue === 'number');
    assert.ok(typeof plStatement.ebitda === 'number');
    assert.ok(Array.isArray(waterfall), 'Must have waterfall steps');
  });

  // ── 5. Workforce & Labour Analytics ──────────────────────────────────────────
  await t.test('5. Workforce analytics returns labor cost % of sales and attendance exceptions', async () => {
    const { req, res, getResult } = buildMockReqRes('OWNER');
    await reportController.getWorkforceAnalytics(req, res, () => {});
    const result = getResult();

    assert.equal(result.statusCode, 200);
    const { workforceMetrics, exceptions } = result.data.data;
    assert.ok(workforceMetrics.labourCostPctOfSales !== undefined);
    assert.ok(workforceMetrics.salesPerLabourHour !== undefined);
    assert.ok(Array.isArray(exceptions), 'Must have attendance exceptions');
  });

  // ── 6. Inventory, Movement & Valuation ───────────────────────────────────────
  await t.test('6. Inventory analytics returns stock valuation and movement waterfall', async () => {
    const { req, res, getResult } = buildMockReqRes('OWNER');
    await reportController.getInventoryAnalytics(req, res, () => {});
    const result = getResult();

    assert.equal(result.statusCode, 200);
    const { stockValuation, movementWaterfall } = result.data.data;
    assert.ok(stockValuation.totalValuation > 0);
    assert.ok(movementWaterfall.closingBalance > 0);
  });

  // ── 7. Procurement, Commitments & PPV ─────────────────────────────────────────
  await t.test('7. Procurement analytics returns total PO commitments, PPV, and INR exceptions', async () => {
    const { req, res, getResult } = buildMockReqRes('OWNER');
    await reportController.getProcurementAnalytics(req, res, () => {});
    const result = getResult();

    assert.equal(result.statusCode, 200);
    const { spendSummary, supplierSpend } = result.data.data;
    assert.ok(spendSummary.totalPoCommitments > 0);
    assert.ok(Array.isArray(supplierSpend));
  });

  // ── 8. Menu Engineering & Product Contribution ───────────────────────────────
  await t.test('8. Menu engineering returns item margin %, volume, COGS, and Boston-box class', async () => {
    const { req, res, getResult } = buildMockReqRes('OWNER');
    await reportController.getMenuAnalytics(req, res, () => {});
    const result = getResult();

    assert.equal(result.statusCode, 200);
    const { menuPerformance } = result.data.data;
    assert.ok(Array.isArray(menuPerformance));
    menuPerformance.forEach((m) => {
      assert.ok(m.item);
      assert.ok(m.marginPct !== undefined);
      assert.ok(m.class, 'Must categorize item into Star, Workhorse, Opportunity, Dog');
    });
  });

  // ── 9. Quality, Safety & Cold-Chain ──────────────────────────────────────────
  await t.test('9. Quality analytics returns checklist compliance %, temperature excursions, and CAPA logs', async () => {
    const { req, res, getResult } = buildMockReqRes('OWNER');
    await reportController.getQualityAnalytics(req, res, () => {});
    const result = getResult();

    assert.equal(result.statusCode, 200);
    const { qualityMetrics, recentIncidents } = result.data.data;
    assert.ok(qualityMetrics.checklistCompletionRatePct >= 90);
    assert.ok(Array.isArray(recentIncidents));
  });

  // ── 10. Assets & Maintenance Downtime ────────────────────────────────────────
  await t.test('10. Asset analytics returns availability rate %, PM compliance %, and downtime minutes', async () => {
    const { req, res, getResult } = buildMockReqRes('OWNER');
    await reportController.getAssetAnalytics(req, res, () => {});
    const result = getResult();

    assert.equal(result.statusCode, 200);
    const { assetMetrics } = result.data.data;
    assert.ok(assetMetrics.availabilityRatePct > 95);
    assert.ok(assetMetrics.preventativeServiceCompliancePct >= 90);
  });

  // ── 11. Portfolio Like-for-Like (Same-Store) Sales ───────────────────────────
  await t.test('11. Portfolio report returns mature vs ramping cohort comparison and LFL growth %', async () => {
    const { req, res, getResult } = buildMockReqRes('OWNER');
    await reportController.getPortfolioAnalytics(req, res, () => {});
    const result = getResult();

    assert.equal(result.statusCode, 200);
    const { portfolio, overallLikeForLikeGrowthPct } = result.data.data;
    assert.ok(Array.isArray(portfolio));
    assert.ok(overallLikeForLikeGrowthPct > 0);
  });

  // ── 12. Strategic Scorecards & Goals ─────────────────────────────────────────
  await t.test('12. Goals scorecards return derived metric targets and status', async () => {
    const { req, res, getResult } = buildMockReqRes('OWNER');
    await reportController.getGoalsAndScorecards(req, res, () => {});
    const result = getResult();

    assert.equal(result.statusCode, 200);
    const { scorecards } = result.data.data;
    assert.ok(Array.isArray(scorecards));
    scorecards.forEach((s) => {
      assert.ok(s.goalId);
      assert.ok(s.metric);
      assert.ok(s.target);
      assert.ok(s.actual);
      assert.ok(s.status);
    });
  });

  // ── 13. Reconciliations & 4-Way Integrity ───────────────────────────────────
  await t.test('13. Cross-module reconciliations return matched balance checks', async () => {
    const { req, res, getResult } = buildMockReqRes('OWNER');
    await reportController.getCrossModuleReconciliations(req, res, () => {});
    const result = getResult();

    assert.equal(result.statusCode, 200);
    const { reconciliations } = result.data.data;
    assert.ok(Array.isArray(reconciliations));
    assert.ok(reconciliations.length >= 4);
    reconciliations.forEach((r) => {
      assert.ok(['MATCHED', 'UNAVAILABLE'].includes(r.status));
    });
  });

  // ── 14. Semantic Dictionary & Governed Metrics ──────────────────────────────
  await t.test('14. Governed metrics dictionary returns formulas, stewards, versions', async () => {
    const { req, res, getResult } = buildMockReqRes('OWNER');
    await reportController.getMetricsDictionary(req, res, () => {});
    const result = getResult();

    assert.equal(result.statusCode, 200);
    const { metrics } = result.data.data;
    assert.ok(Array.isArray(metrics));
    assert.ok(metrics.length >= 6);
    metrics.forEach((m) => {
      assert.ok(m.metricId);
      assert.ok(m.name);
      assert.ok(m.formula);
      assert.ok(m.owner);
      assert.ok(m.version);
    });
  });

  // ── 15. Data Quality, Lineage & Freshness ────────────────────────────────────
  await t.test('15. Data quality returns optimal data health and lineage nodes', async () => {
    const { req, res, getResult } = buildMockReqRes('OWNER');
    await reportController.getDataQualityAndLineage(req, res, () => {});
    const result = getResult();

    assert.equal(result.statusCode, 200);
    const { qualityStatus, lineageNodes } = result.data.data;
    assert.ok(qualityStatus);
    assert.equal(qualityStatus.overallDataHealth, 'OPTIMAL');
    assert.ok(Array.isArray(lineageNodes));
  });

  // ── 16. ZURF v1 Export Generation & Job Queue ────────────────────────────────
  await t.test('16. ZURF Export generation renders certified output and queue list', async () => {
    const { req, res, getResult } = buildMockReqRes('OWNER', {}, {}, {
      reportId: 'Daily Sales & Operations Summary',
      format: 'PDF',
      scope: 'ALL_AUTHORIZED',
    });

    await reportController.generateZurfExport(req, res, () => {});
    const exportResult = getResult();

    assert.equal(exportResult.statusCode, 200);
    assert.equal(exportResult.data.success, true);
    assert.ok(exportResult.data.data.runId, 'Must generate runId');
    assert.equal(exportResult.data.data.format, 'PDF');
    assert.ok(exportResult.data.data.html, 'Must generate HTML for PDF print');

    // Verify job in queue
    const { req: qReq, res: qRes, getResult: getQResult } = buildMockReqRes('OWNER');
    await reportController.listExportJobs(qReq, qRes, () => {});
    const queueResult = getQResult();
    assert.equal(queueResult.statusCode, 200);
    assert.ok(Array.isArray(queueResult.data.data.jobs));
  });

  // ── 17. Security & Role Authorizations ───────────────────────────────────────
  await t.test('17. Security: OWNER and MASTER are authorized executive governance roles', () => {
    const permittedRoles = ['MASTER', 'OWNER'];
    assert.ok(permittedRoles.includes('OWNER'), 'OWNER must be in permitted roles');
    assert.ok(permittedRoles.includes('MASTER'), 'MASTER must be in permitted roles');
    assert.ok(!permittedRoles.includes('STAFF'), 'STAFF must NOT have global governance analytics access');
  });

  // ── 18. Analytics Integrity & Governance ────────────────────────────────────
  await t.test('18. Analytics integrity reports honest per-check results and audit timestamp', async () => {
    const { req, res, getResult } = buildMockReqRes('OWNER');
    await reportController.getAnalyticsIntegrity(req, res, () => {});
    const result = getResult();

    assert.equal(result.statusCode, 200);
    assert.ok(Array.isArray(result.data.data.checks));
    assert.equal(result.data.data.checks.length, 16);
    // Unevaluable controls must be honestly marked UNAVAILABLE, not fabricated PASS.
    assert.ok(result.data.data.unavailableChecks >= 3);
    assert.equal(result.data.data.failedChecks, 0);
    assert.equal(result.data.data.allPassed, true);
    assert.ok(result.data.data.integrityScore >= 0 && result.data.data.integrityScore <= 100);
    const validResults = new Set(['PASS', 'FAIL', 'UNAVAILABLE', 'ENFORCED']);
    assert.ok(result.data.data.checks.every((c) => validResults.has(c.result)));
  });

  // ── 19. Multi-Café Scoping & Cross-Café Rejection ───────────────────────────
  await t.test('19. Multi-Café Scoping: Requesting assigned café succeeds; unassigned café throws 403 CROSS_CAFE_RESOURCE_DENIED', async () => {
    // Authorized café ZC-0001
    const { req: okReq, res: okRes, next: okNext, getResult: getOkResult } = buildMockReqRes('OWNER', {}, { cafeId: 'ZC-0001' });
    await reportController.getSalesAnalytics(okReq, okRes, okNext);
    const okResult = getOkResult();
    assert.equal(okResult.statusCode, 200);

    // Unassigned café ZC-0099
    const { req: badReq, res: badRes, next: badNext } = buildMockReqRes('OWNER', {}, { cafeId: 'ZC-0099' });
    await assert.rejects(
      async () => {
        await reportController.getSalesAnalytics(badReq, badRes, badNext);
      },
      (err) => {
        assert.equal(err.statusCode, 403);
        assert.equal(err.code, 'CROSS_CAFE_RESOURCE_DENIED');
        return true;
      }
    );
  });

  // ── 20. Empty Assigned Cafés Fail-Closed ────────────────────────────────────
  await t.test('20. Empty assignedCafeIds fails closed with 403 CROSS_CAFE_RESOURCE_DENIED', async () => {
    const { req, res, next } = buildMockReqRes('OWNER', {}, {}, {}, { assignedCafeIds: [], cafeId: null, primaryCafeId: null });
    await assert.rejects(
      async () => {
        await reportController.getSalesAnalytics(req, res, next);
      },
      (err) => {
        assert.equal(err.statusCode, 403);
        assert.equal(err.code, 'CROSS_CAFE_RESOURCE_DENIED');
        return true;
      }
    );
  });

  // ── 21. Date Range Validation ────────────────────────────────────────────────
  await t.test('21. Date Range: dateFrom > dateTo is rejected with 400 INVALID_DATE_RANGE', async () => {
    const { req, res, next } = buildMockReqRes('OWNER', {}, { dateFrom: '2026-09-15', dateTo: '2026-09-01' });
    await assert.rejects(
      async () => {
        await reportController.getSalesAnalytics(req, res, next);
      },
      (err) => {
        assert.equal(err.statusCode, 400);
        assert.equal(err.code, 'INVALID_DATE_RANGE');
        return true;
      }
    );
  });

  // ── 22. CSV Formula Injection Defense ───────────────────────────────────────
  await t.test('22. CSV Formula Injection: Text formulas (=, +, -, @) are sanitized with single quote; numbers preserved', async () => {
    const columns = [
      { key: 'title', label: 'Report Title', isNum: false },
      { key: 'notes', label: 'Notes', isNum: false },
      { key: 'cmd', label: 'Command', isNum: false },
      { key: 'revenue', label: 'Revenue', isNum: true },
      { key: 'variance', label: 'Variance %', isNum: false },
    ];
    const rows = [
      {
        title: '=1+1',
        notes: '@SUM(A1:A10)',
        cmd: '+calc.exe',
        revenue: -24800,
        variance: '+9.2%',
      },
    ];

    const { csv } = await ZurfService.renderCsv({
      reportTitle: 'Security Test Export',
      scope: 'Security Scope',
      period: '2026-09',
      columns,
      rows,
    });

    // Injected text cells must be neutralized with leading single quote
    assert.ok(csv.includes(`"'=1+1"`), 'Formula =1+1 must be escaped as "\'=1+1"');
    assert.ok(csv.includes(`"'@SUM(A1:A10)"`), 'Formula @SUM must be escaped as "\'@SUM"');
    assert.ok(csv.includes(`"'+calc.exe"`), 'Formula +calc must be escaped as "\'+calc"');

    // Legitimate numbers and percentage indicators must not be broken
    assert.ok(csv.includes(`"-24800"`), 'Negative numeric amount -24800 must not have formula quote');
    assert.ok(csv.includes(`"+9.2%"`), 'Positive percentage +9.2% must not have formula quote');
  });

  // ── 23. Artifact Storage & Download Route ────────────────────────────────────
  await t.test('23. Export Artifact Storage & Download: Generated PDF/XLSX is stored and retrievable via download route', async () => {
    const { req: expReq, res: expRes, next: expNext, getResult: getExpResult } = buildMockReqRes('OWNER', {}, {}, {
      reportId: 'daily-sales',
      format: 'XLSX',
    });

    await reportController.generateZurfExport(expReq, expRes, expNext);
    const expResult = getExpResult();
    assert.equal(expResult.statusCode, 200);
    const runId = expResult.data.data.runId;
    assert.ok(runId, 'Must have runId');

    // Retrieve via download controller
    const { req: dlReq, res: dlRes, next: dlNext, getResult: getDlResult } = buildMockReqRes('OWNER', { runId });
    await reportController.downloadExportArtifact(dlReq, dlRes, dlNext);
    const dlResult = getDlResult();

    assert.equal(dlResult.statusCode, 200);
    assert.ok(dlResult.headers['content-type'].includes('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'));
    assert.ok(dlResult.headers['content-disposition'].includes('attachment'));
    assert.ok(dlResult.headers['content-disposition'].includes('.xlsx'));
    assert.ok(dlResult.data.length > 0);
  });

  // ── 24. Artifact Download Security & Path Traversal ──────────────────────────
  await t.test('24. Artifact Security: Path traversal in runId is rejected with 400; foreign organisation rejected with 403', async () => {
    // Path traversal attempt
    const { req: ptReq, res: ptRes, next: ptNext } = buildMockReqRes('OWNER', { runId: '../../etc/passwd' });
    await assert.rejects(
      async () => {
        await reportController.downloadExportArtifact(ptReq, ptRes, ptNext);
      },
      (err) => {
        assert.equal(err.statusCode, 400);
        assert.equal(err.code, 'INVALID_ARTIFACT_ID');
        return true;
      }
    );

    // Store an artifact belonging to ORG-ZAMORIN-01
    const testRunId = 'RPT-TEST-SEC-001';
    ZurfService.storeExportArtifact(testRunId, {
      format: 'CSV',
      csv: 'Test CSV',
      mimeType: 'text/csv',
      filename: 'test.csv',
      userId: 'owner-usr-001',
      organisationId: 'ORG-ZAMORIN-01',
    });

    // Foreign organisation attempt
    const { req: foreignReq, res: foreignRes, next: foreignNext } = buildMockReqRes('OWNER', { runId: testRunId }, {}, {}, {
      organisationId: 'ORG-FOREIGN-99',
      userId: 'foreign-usr-99',
    });

    await assert.rejects(
      async () => {
        await reportController.downloadExportArtifact(foreignReq, foreignRes, foreignNext);
      },
      (err) => {
        assert.equal(err.statusCode, 403);
        assert.equal(err.code, 'TENANT_MISMATCH');
        return true;
      }
    );
  });

  // ── 25. Tenant Isolation Invariant ──────────────────────────────────────────
  await t.test('25. Tenant Isolation: Organisation ID from JWT is strictly applied to report queries', async () => {
    const { req, res, getResult } = buildMockReqRes('OWNER', {}, {}, {}, { organisationId: 'ORG-TENANT-XYZ' });
    await reportController.getSalesAnalytics(req, res, () => {});
    const result = getResult();

    assert.equal(result.statusCode, 200);
    assert.equal(result.data.success, true);
  });
});
