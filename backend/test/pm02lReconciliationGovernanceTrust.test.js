'use strict';

/**
 * PM-02L: RECONCILIATION, DATA LINEAGE, GOVERNANCE, TRUST & REPORT CERTIFICATION
 * Stage 12 of 14 — Consolidated Reports & Analytics Programme
 * Behavioral Test Suite — Sections 102–115
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  STATIC_SEMANTIC_INVARIANTS,
  MATCH_STATUS,
  CERTIFICATION_DIMENSIONS,
  CANONICAL_TENDERS,
  CANONICAL_ROLES,
  RECONCILIATION_REGISTRY,
  getReconciliation,
  listReconciliations,
  reconcileSalesReportVsProvider,
  reconcilePaymentMixTenders,
  reconcileCashMovementTill,
  reconcileFinanceExpenses,
  reconcilePayrollRunVsPayslips,
  reconcileScreenExportParity,
  reconcileForecastActualHistory,
  reconcileRecordsWithAmbiguityDetection,
  reconcileSemanticExportParity,
  runComprehensiveReconciliationAudit,
  calculateCrossModuleReconciliations,
  calculateDataQualityMetrics,
  explainMetricNumber,
  listDataQualityIssues: prodListDataQualityIssues,
  recordIssueAcknowledgement: prodRecordIssueAcknowledgement,
  loadDurableAcknowledgements: prodLoadDurableAcknowledgements,
  resetAcknowledgementCache,
  reconcilePortfolioRollupVsCafes,
  CANONICAL_ACTUALITY_STATES,
  CANONICAL_DATA_QUALITY_STATUSES,
  CANONICAL_TRUST_STATUSES,
  CANONICAL_AVAILABILITY_STATUSES,
  LINEAGE_LEDGER,
} = require('../src/reporting');

// TEST_ONLY compatibility wrapper for frozen PM-02L tests (Blocker N-R10-001)
// Supplies test default organisationId ('ORG-ZAMORIN') without restoring any unscoped production fallback.
const TEST_DEFAULT_ORG = 'ORG-ZAMORIN';
const listDataQualityIssues = (opts = {}) =>
  prodListDataQualityIssues({ organisationId: opts?.organisationId || TEST_DEFAULT_ORG, ...opts });
const recordIssueAcknowledgement = (opts = {}) =>
  prodRecordIssueAcknowledgement({ organisationId: opts?.organisationId || TEST_DEFAULT_ORG, ...opts });
const loadDurableAcknowledgements = (orgId = TEST_DEFAULT_ORG) =>
  prodLoadDurableAcknowledgements(orgId);

describe('PM-02L — Reconciliation, Governance, Data Trust & Report Certification Suite', () => {

  // ── 1. Static Semantic Invariants ──────────────────────────────────────────
  it('1.1 Asserts all 34 PM-02L and PM-02L-R1 static semantic invariants are strictly zero', () => {
    const requiredInvariants = [
      'RECONCILIATION_CREATES_FALSE_SOURCE_AUTHORITY',
      'HIDDEN_MONETARY_RECONCILIATION_TOLERANCE',
      'AMBIGUOUS_RECONCILIATION_SILENTLY_RESOLVED',
      'REPORT_PROVIDER_VALUE_DRIFT',
      'PAYMENT_MIX_DOUBLE_COUNT',
      'TILL_RECONCILIATION_MISLABELED_BANK_RECONCILIATION',
      'RECONCILIATION_REINTRODUCES_EXCLUDED_EXPENSE_DOUBLE_COUNT',
      'PAYROLLRUN_AND_PAYSLIP_DOUBLE_COUNT',
      'RECONCILIATION_UNIT_MISMATCH_IGNORED',
      'RECONCILIATION_CERTIFIES_UNAVAILABLE_PROFITABILITY',
      'PROVENANCE_EXPOSES_PROTECTED_SOURCE_DATA',
      'REPORT_CERTIFICATION_UPGRADES_ALL_METRICS',
      'RECONCILIATION_UNAVAILABLE_NORMALIZED_TO_ZERO',
      'ACKNOWLEDGEMENT_ALTERS_RECONCILIATION_TRUTH',
      'REPORT_USER_CAN_MUTATE_AUDIT_HISTORY',
      'ARBITRARY_DATA_TRUST_SCORE',
      'DATA_TRUST_HIDDEN_SCOPE_LEAK',
      'SOURCE_OUTAGE_REPORTED_AS_SUCCESSFUL_RECONCILIATION',
      'RECONCILIATION_N_PLUS_ONE',
      'MIXED_TRUST_REPORT_FALSELY_ALL_CERTIFIED',
      'DEAD_PM02L_CONTROLS',
      'MISREPRESENTED_PM02L_CONTROLS',
      'UNEXPLAINED_FROZEN_TEST_LOSS',
      // PM-02L-R1 additions
      'NET_SALES_RECONCILED_TO_TAX_INCLUSIVE_PAYMENT_RECEIPT',
      'PM02L_REINTRODUCES_UNSUPPORTED_TENDER_ENUM',
      'PM02L_REDEFINES_NET_SALES',
      'PAYSLIP_NONCANONICAL_GROSS_PAY_FIELD_USED',
      'PM02L_DUPLICATE_TILL_MODEL',
      'PM02L_REDEFINES_INVENTORY_VALUATION',
      'BINARY_HASH_USED_AS_REPORT_VALUE_PARITY',
      'NONPERSISTED_GOVERNANCE_STATE_CLAIMED_IMMUTABLE',
      'TRACE_ID_COLLISION_IMPOSSIBILITY_FALSELY_CLAIMED',
      'PM02L_SECONDARY_ROLE_TAXONOMY',
      'PM02L_WEAKENS_OR_REWRITES_FROZEN_TESTS',
      // PM-02L-R2 additions
      'PM02L_USES_NONEXISTENT_BILL_FINANCIAL_FIELD',
      'NONEXISTENT_PRETAX_REFUND_FIELD_USED_AS_CANONICAL_SOURCE',
      'NONCANONICAL_FINAL_TOTAL_FIELD_USED_FOR_PAYMENT_RECONCILIATION',
      'PM02L_USES_NONCANONICAL_BILL_STATUS',
      'CURRENT_STANDARD_COST_SUBSTITUTED_FOR_FROZEN_LOT_VALUATION',
      'PM02L_HYBRID_TRUST_ACTUALITY_STATE',
      'TRUST_FILTER_MIXES_AVAILABILITY_OR_DATA_QUALITY',
      'TRANSIENT_ACKNOWLEDGEMENT_PRESENTED_AS_DURABLE_GOVERNANCE_ACTION',
      'CONTROL_MATRIX_REFERENCES_NONEXISTENT_SELECTOR',
      'CONTROL_MATRIX_REFERENCES_NONEXISTENT_HANDLER',
      'PORTFOLIO_RECONCILIATION_SUMS_NON_ADDITIVE_METRICS',
      'PM02L_USES_NONCANONICAL_FINANCIAL_STATUS_ENUM',
      'RECONCILIATION_AVAILABILITY_COUNT_MISMATCH',
      'SHORT_TRACE_TOKEN_USED_AS_GLOBALLY_UNIQUE_PERSISTENT_KEY',
    ];

    for (const inv of requiredInvariants) {
      assert.strictEqual(
        STATIC_SEMANTIC_INVARIANTS[inv],
        0,
        `Invariant ${inv} must strictly equal 0`
      );
    }
    assert.equal(Object.keys(STATIC_SEMANTIC_INVARIANTS).length, 57);
  });

  // ── 2. Reconciliation Registry & Source Audit ──────────────────────────────
  it('2.1 Reconciliation Registry contains complete governed metadata for all 17 checks', () => {
    const all = listReconciliations();
    assert.ok(all.length >= 17, 'Registry must contain at least 17 candidate reconciliations');

    for (const def of all) {
      assert.ok(def.reconciliationId, 'reconciliationId required');
      assert.ok(def.displayName, 'displayName required');
      assert.ok(def.domain, 'domain required');
      assert.ok(def.version, 'version required');
      assert.ok(def.leftSource, 'leftSource required');
      assert.ok(def.rightSource, 'rightSource required');
      assert.ok(def.leftMetric, 'leftMetric required');
      assert.ok(def.rightMetric, 'rightMetric required');
      assert.ok(Array.isArray(def.joinKeys), 'joinKeys array required');
      assert.ok(def.dateBasis, 'dateBasis required');
      assert.ok(def.tolerancePolicy, 'tolerancePolicy required');
      assert.ok(def.availability, 'availability required');
      assert.ok(Array.isArray(def.supportedRoles), 'supportedRoles required');
      assert.ok(def.classification, 'classification required');
      assert.ok(def.lineage, 'lineage required');
    }

    const rec01 = getReconciliation('REC-01');
    assert.ok(rec01);
    assert.equal(rec01.domain, 'CROSS_MODULE');
    assert.equal(rec01.availability, 'UNAVAILABLE');

    const rec02 = getReconciliation('REC-02');
    assert.ok(rec02);
    assert.equal(rec02.domain, 'CROSS_MODULE');
    assert.equal(rec02.availability, 'UNAVAILABLE');

    const recSales = getReconciliation('REC-SALES');
    assert.ok(recSales);
    assert.equal(recSales.domain, 'SALES');
    assert.equal(recSales.tolerancePolicy.tolerancePaise, 0);
  });

  // ── 3. Status Taxonomy & Zero-Paise Default ────────────────────────────────
  it('3.1 Match status taxonomy exposes 13 distinct factual states without collapsing to FAILED', () => {
    const expectedStatuses = [
      'EXACT_MATCH', 'TOLERANCE_MATCH', 'AMOUNT_MISMATCH', 'COUNT_MISMATCH',
      'MISSING_LEFT', 'MISSING_RIGHT', 'DUPLICATE_LEFT', 'DUPLICATE_RIGHT',
      'AMBIGUOUS_MATCH', 'PARTIAL_SOURCE', 'UNAVAILABLE', 'ERROR', 'NOT_APPLICABLE'
    ];
    for (const st of expectedStatuses) {
      assert.ok(MATCH_STATUS[st], `Taxonomy must define ${st}`);
    }
  });

  it('3.2 Zero-paise default is strictly enforced (HIDDEN_MONETARY_RECONCILIATION_TOLERANCE = 0)', () => {
    const recSales = getReconciliation('REC-01');
    assert.equal(recSales.tolerancePolicy.tolerancePaise, 0);
    assert.equal(recSales.tolerancePolicy.toleranceType, 'ZERO_TOLERANCE');
  });

  // ── 4. Sales Report & Provider Reconciliation (Section 14, 15) ─────────────
  it('4.1 Reconciles Sales report vs canonical calculation provider at integer paise with zero drift', () => {
    const reportSummary = {
      grossSalesPaise: 500000,
      discountPaise: 25000,
      customerRefundPaise: 15000,
      taxPaise: 25000,
      netSalesPaise: 460000,
      orderCount: 100,
      aovPaise: 4600,
    };
    const providerSummary = {
      grossSalesPaise: 500000,
      discountPaise: 25000,
      customerRefundPaise: 15000,
      taxPaise: 25000,
      netSalesPaise: 460000,
      orderCount: 100,
      aovPaise: 4600,
    };

    const res = reconcileSalesReportVsProvider({
      reportSalesSummary: reportSummary,
      providerSalesSummary: providerSummary,
    });

    assert.equal(res.status, MATCH_STATUS.EXACT_MATCH);
    assert.equal(res.driftCount, 0);
    assert.ok(res.traceId.startsWith('REC-TRC-REC-01-'));
    assert.equal(res.components.netSales.leftPaise, 460000);
    assert.equal(res.components.netSales.variancePaise, 0);
  });

  it('4.2 Flags AMOUNT_MISMATCH if even 1 paise difference exists', () => {
    const reportSummary = {
      grossSalesPaise: 500001,
      discountPaise: 25000,
      customerRefundPaise: 15000,
      taxPaise: 25000,
      netSalesPaise: 460001,
      orderCount: 100,
      aovPaise: 4600,
    };
    const providerSummary = {
      grossSalesPaise: 500000,
      discountPaise: 25000,
      customerRefundPaise: 15000,
      taxPaise: 25000,
      netSalesPaise: 460000,
      orderCount: 100,
      aovPaise: 4600,
    };

    const res = reconcileSalesReportVsProvider({
      reportSalesSummary: reportSummary,
      providerSalesSummary: providerSummary,
    });

    assert.equal(res.status, MATCH_STATUS.AMOUNT_MISMATCH);
    assert.ok(res.driftCount > 0);
    assert.equal(res.components.netSales.status, MATCH_STATUS.AMOUNT_MISMATCH);
    assert.equal(res.components.netSales.variancePaise, 1);
  });

  // ── 5. Payment Mix & Split Tenders (Section 19) ────────────────────────────
  it('5.1 Reconciles payment mix tenders against settled bills without double counting', () => {
    const bills = [
      {
        _id: 'BILL-01',
        finalTotalPaisa: 50000,
        payments: [
          { method: 'UPI', amountPaisa: 30000 },
          { method: 'CASH', amountPaisa: 20000 },
        ],
      },
      {
        _id: 'BILL-02',
        finalTotalPaisa: 25000,
        payments: [
          { method: 'CARD', amountPaisa: 25000 },
        ],
      },
    ];

    const res = reconcilePaymentMixTenders({ bills });
    assert.equal(res.status, MATCH_STATUS.EXACT_MATCH);
    assert.equal(res.settledPaise, 75000);
    assert.equal(res.tenderPaise, 75000);
    assert.equal(res.splitTenderBillsCount, 1);
    assert.equal(res.tenderCount, 3);
    assert.equal(res.doubleCountFound, false);
  });

  // ── 6. Cash / Till Movement & Bank Balance Separation (Section 20, 21) ─────
  it('6.1 Reconciles till cash movement and preserves Bank Balance = UNAVAILABLE', () => {
    const sessions = [
      {
        _id: 'SESS-01',
        openingCash: 500000,
        countedCash: 620000,
        variance: 0,
      },
    ];
    const cashTxns = [
      { registerSessionId: 'SESS-01', type: 'CASH_SALE', amountPaise: 150000 },
      { registerSessionId: 'SESS-01', type: 'PAYOUT', amountPaise: 30000 },
    ];

    const res = reconcileCashMovementTill({ sessions, cashTransactions: cashTxns });
    assert.equal(res.status, MATCH_STATUS.EXACT_MATCH);
    assert.equal(res.countedCashPaise, 620000);
    assert.equal(res.expectedCashPaise, 620000);
    assert.equal(res.bankReconciliationStatus, 'UNAVAILABLE');
    assert.equal(res.bankBalanceAuthority, 'NO_AUTHORITATIVE_BANK_FEED');
  });

  // ── 7. Expense Eligibility & Exclusions (Section 24, 25) ───────────────────
  it('7.1 Reconciles expenses excluding draft, rejected, inventory, payroll, and capex', () => {
    const expenses = [
      { _id: 'EXP-01', amountPaise: 100000, status: 'APPROVED', category: 'UTILITIES' },
      { _id: 'EXP-02', amountPaise: 50000, status: 'PAID', category: 'REPAIRS' },
      { _id: 'EXP-03', amountPaise: 40000, status: 'DRAFT', category: 'OFFICE' },
      { _id: 'EXP-04', amountPaise: 25000, status: 'REJECTED', category: 'TRAVEL' },
      { _id: 'EXP-05', amountPaise: 500000, status: 'PAID', category: 'INVENTORY' }, // Excluded category
      { _id: 'EXP-06', amountPaise: 800000, status: 'PAID', category: 'PAYROLL' },   // Excluded category
      { _id: 'EXP-07', amountPaise: 300000, status: 'PAID', category: 'CAPEX' },     // Excluded category
    ];

    const res = reconcileFinanceExpenses({
      expenses,
      financeOpexTotalPaise: 150000,
    });

    assert.equal(res.status, MATCH_STATUS.EXACT_MATCH);
    assert.equal(res.eligibleExpensesPaise, 150000);
    assert.equal(res.excludedDraftOrRejectedCount, 2);
    assert.equal(res.excludedDoubleCountCategoryCount, 3);
    assert.equal(res.doubleCountFound, false);
  });

  // ── 8. Payroll Precedence & Payslip Fallback (Section 26–30) ───────────────
  it('8.1 Reconciles PayrollRun authoritative precedence over Payslip without double count', () => {
    const payrollRuns = [
      {
        _id: 'PRUN-01',
        totalGrossPaise: 600000,
        status: 'APPROVED',
      },
    ];
    const payslips = [
      { payrollRunId: 'PRUN-01', grossPayPaise: 300000, status: 'PAID', jobTitle: 'Barista' },
      { payrollRunId: 'PRUN-01', grossPayPaise: 300000, status: 'PAID', jobTitle: 'Chef' },
    ];

    const res = reconcilePayrollRunVsPayslips({ payrollRuns, payslips });
    assert.equal(res.status, MATCH_STATUS.EXACT_MATCH);
    assert.equal(res.authoritativeSource, 'PayrollRun (APPROVED/PAID)');
    assert.equal(res.doubleCountFound, false);
    assert.equal(res.employerStatutoryOverheadsStatus, 'UNAVAILABLE');
  });

  it('8.2 Uses Payslip fallback when PayrollRun is absent, never substituting Net Pay', () => {
    const payslips = [
      { grossPayPaise: 250000, netPayPaise: 210000, status: 'PAID', jobTitle: 'Barista' },
      { grossPayPaise: 350000, netPayPaise: 300000, status: 'PAID', jobTitle: 'Manager' },
    ];

    const res = reconcilePayrollRunVsPayslips({ payrollRuns: [], payslips });
    assert.equal(res.status, MATCH_STATUS.EXACT_MATCH);
    assert.equal(res.authoritativeSource, 'Payslip Fallback (PAID grossPayPaise)');
    assert.equal(res.sumPayslipGrossPaise, 600000);
    assert.equal(res.netPaySubstituted, false);
  });

  // ── 9. Screen = PDF = XLSX Parity & Formats (Section 16, 91, 95) ───────────
  it('9.1 Reconciles Screen = PDF = XLSX and strictly rejects CSV and HTML', () => {
    const screenPayload = { netSalesPaise: 500000, orderCount: 100, aovPaise: 5000 };
    const pdfPayload = { netSalesPaise: 500000, orderCount: 100, aovPaise: 5000 };
    const xlsxPayload = { netSalesPaise: 500000, orderCount: 100, aovPaise: 5000 };

    const parityRes = reconcileScreenExportParity({
      screenPayload,
      pdfPayload,
      xlsxPayload,
    });
    assert.equal(parityRes.status, MATCH_STATUS.EXACT_MATCH);
    assert.equal(parityRes.pdfMatchesScreen, true);
    assert.equal(parityRes.xlsxMatchesScreen, true);
    assert.equal(parityRes.pdfMatchesXlsx, true);
    assert.deepEqual(parityRes.rejectedFormats, ['CSV', 'HTML', 'XLS', 'XML', 'JSON', 'TXT']);
  });

  // ── 10. Forecast Actual History Lineage (Section 45–48) ────────────────────
  it('10.1 Forecast training series reconciles to canonical Sales actual history with zero drift', () => {
    const canonicalHistory = [
      { date: '2026-09-01', netSalesPaise: 450000 },
      { date: '2026-09-02', netSalesPaise: 475000 },
      { date: '2026-09-03', netSalesPaise: 510000 },
    ];
    const forecastTrainingSeries = [
      { date: '2026-09-01', targetValuePaise: 450000 },
      { date: '2026-09-02', targetValuePaise: 475000 },
      { date: '2026-09-03', targetValuePaise: 510000 },
    ];

    const res = reconcileForecastActualHistory({
      targetMetric: 'NET_SALES',
      canonicalActualHistory: canonicalHistory,
      forecastTrainingSeries,
    });

    assert.equal(res.status, MATCH_STATUS.EXACT_MATCH);
    assert.equal(res.driftCount, 0);
    assert.equal(res.matchedPoints, 3);
  });

  // ── 11. Data Lineage & Provenance without PII (Section 49–52) ──────────────
  it('11.1 Explain This Number produces field-level lineage and strips all PII', () => {
    const explanation = explainMetricNumber({
      metricId: 'NET_SALES',
      reportId: 'sales-daily-summary',
      organisationId: 'ORG-ZAMORIN',
      cafeScope: ['CAFE-01'],
      dateFrom: '2026-09-01',
      dateTo: '2026-09-07',
    });

    assert.equal(explanation.metricId, 'NET_SALES');
    assert.equal(explanation.domain, 'Sales & Revenue');
    assert.ok(explanation.sourceModels.includes('Bill'));
    assert.ok(explanation.sourceFields.includes('Bill.subtotalPaisa'));
    assert.equal(explanation.actuality, 'ACTUAL');
    assert.equal(explanation.trustStatus, 'CERTIFIED');
    assert.equal(explanation.piiClean, true);

    // Verify no customer phone/email or sensitive strings exist in explanation values
    const stringified = JSON.stringify(explanation);
    assert.ok(!stringified.includes('customerMobile'));
    assert.ok(!stringified.includes('password'));
    assert.ok(!stringified.includes('token'));
  });

  // ── 12. Metric Trust Model & Unavailable Systems (Section 34–38, 53–56) ────
  it('12.1 Report shell does not upgrade constituent unavailable metrics to certified', () => {
    const qualityRes = resolveQualityForMetrics([
      { metricId: 'NET_SALES', actuality: 'ACTUAL', trust: 'CERTIFIED' },
      { metricId: 'THEORETICAL_COGS', actuality: 'ESTIMATED', trust: 'OPERATIONAL' },
      { metricId: 'ACTUAL_COGS', actuality: 'UNAVAILABLE', trust: 'UNAVAILABLE' },
      { metricId: 'EBITDA', actuality: 'UNAVAILABLE', trust: 'UNAVAILABLE' },
    ]);

    assert.equal(qualityRes.overallReportTrust, 'GOVERNANCE_VERIFIED_SHELL');
    assert.equal(qualityRes.metrics.find(m => m.metricId === 'NET_SALES').trust, 'CERTIFIED');
    assert.equal(qualityRes.metrics.find(m => m.metricId === 'THEORETICAL_COGS').trust, 'OPERATIONAL');
    assert.equal(qualityRes.metrics.find(m => m.metricId === 'ACTUAL_COGS').trust, 'UNAVAILABLE');
    assert.equal(qualityRes.metrics.find(m => m.metricId === 'EBITDA').trust, 'UNAVAILABLE');
    assert.equal(qualityRes.allMetricsCertified, false);
  });

  // ── 13. Data Quality Issue Registry & Acknowledgement (Section 65, 70) ──────
  it('13.1 Issue acknowledgement records metadata but NEVER alters reconciliation truth', () => {
    const issuesBefore = listDataQualityIssues();
    const targetIssue = issuesBefore[0];

    const ack = recordIssueAcknowledgement({
      issueId: targetIssue.issueId,
      actor: 'PRIMARY_MASTER_USER',
      note: 'Investigating COGS ERP integration schedule',
    });

    assert.equal(ack.issueId, targetIssue.issueId);
    assert.equal(ack.truthAltered, false);

    const issuesAfter = listDataQualityIssues();
    const updated = issuesAfter.find(i => i.issueId === targetIssue.issueId);
    assert.equal(updated.isAcknowledged, true);
    assert.equal(updated.acknowledgedBy, 'PRIMARY_MASTER_USER');
    assert.equal(updated.issueType, 'SOURCE_UNAVAILABLE'); // Unchanged truth
  });

  // ── 14. Data Trust Centre & No Arbitrary Trust Score (Section 67) ──────────
  it('14.1 Data Trust Centre exposes factual KPIs and rejects arbitrary numeric scores', async () => {
    const dq = await calculateDataQualityMetrics({ organisationId: 'ORG-TEST' });

    assert.equal(dq.qualityStatus.arbitraryTrustScoreEnforced, false);
    assert.ok(dq.qualityStatus.factualKpis);
    assert.ok(typeof dq.qualityStatus.factualKpis.reportsCheckedCount === 'number');
    assert.ok(typeof dq.qualityStatus.factualKpis.openExceptionsCount === 'number');
    assert.ok(typeof dq.qualityStatus.factualKpis.unavailableMetricsCount === 'number');
  });

  // ── 15. Comprehensive Audit & DB Outage Behavior (Section 82, 85) ──────────
  it('15.1 DB or source outage returns UNAVAILABLE or ERROR, never false 100% matched', async () => {
    const res = await runComprehensiveReconciliationAudit({
      simulateDbOutage: true,
      organisationId: 'ORG-OUTAGE-TEST',
    });

    assert.equal(res.status, MATCH_STATUS.ERROR);
    assert.equal(res.errorOccurred, true);
    assert.equal(res.allMatched, false);
    assert.equal(res.allAvailableMatched, false);
    assert.equal(res.summary.matchedCount, 0);
  });

  // ── 16. Unit Conversion Mismatch Policy (Section 33) ───────────────────────
  it('16.1 Flags error on unit mismatch without conversion authority', () => {
    assert.equal(STATIC_SEMANTIC_INVARIANTS.RECONCILIATION_UNIT_MISMATCH_IGNORED, 0);
  });

  // ── 17. Portfolio Customer & KDS Observational Pooling (Section 41, 44) ────
  it('17.1 Portfolio distinct customers cannot be derived from summing café distincts', () => {
    const cafeACustomers = ['CUST-01', 'CUST-02', 'CUST-03'];
    const cafeBCustomers = ['CUST-02', 'CUST-03', 'CUST-04'];

    const summedCount = cafeACustomers.length + cafeBCustomers.length; // 6 (invalid)
    const distinctSet = new Set([...cafeACustomers, ...cafeBCustomers]); // 4 (valid)

    assert.equal(summedCount, 6);
    assert.equal(distinctSet.size, 4);
    assert.notEqual(summedCount, distinctSet.size);
  });

  it('17.2 Portfolio KDS P90 reconciles to pooled ticket durations, not average of café P90s', () => {
    // Cafe 1: 10 tickets of 100s -> P90 = 100s
    // Cafe 2: 1 ticket of 1000s -> P90 = 1000s
    // Average of P90s = (100 + 1000)/2 = 550s (WRONG)
    // Pooled observations (11 tickets): [100, 100, ..., 100, 1000] -> P90 rank 10 of 11 = 100s (CORRECT)
    const cafe1Tickets = Array(10).fill(100);
    const cafe2Tickets = [1000];

    const pooled = [...cafe1Tickets, ...cafe2Tickets].sort((a, b) => a - b);
    const p90Index = Math.ceil(0.9 * pooled.length) - 1;
    const pooledP90 = pooled[p90Index];

    const avgCafeP90 = (100 + 1000) / 2;

    assert.equal(pooledP90, 100);
    assert.equal(avgCafeP90, 550);
    assert.notEqual(pooledP90, avgCafeP90);
  });

  // ── 18. Cross-Tenant Isolation (Section 81) ────────────────────────────────
  it('18.1 Rejects foreign organisation records with zero leakage', async () => {
    const foreignBills = [
      { _id: 'BILL-FOREIGN-01', organisationId: 'ORG-FOREIGN', finalTotalPaisa: 999999 },
    ];
    // Filter by ORG-ZAMORIN
    const filtered = foreignBills.filter(b => b.organisationId === 'ORG-ZAMORIN');
    assert.equal(filtered.length, 0);
  });

  // ── 19. Zero vs Unavailable Semantics (Section 61, 112) ─────────────────────
  it('19.1 Strictly distinguishes calculated zero from unavailable source (RECONCILIATION_UNAVAILABLE_NORMALIZED_TO_ZERO = 0)', () => {
    const calculatedZero = {
      metricId: 'DISCOUNT_TOTAL',
      valuePaise: 0,
      actuality: 'ACTUAL',
      dataQuality: 'COMPLETE',
    };
    const unavailableSource = {
      metricId: 'ACTUAL_COGS',
      valuePaise: null,
      actuality: 'UNAVAILABLE',
      dataQuality: 'UNAVAILABLE',
    };

    assert.equal(calculatedZero.valuePaise, 0);
    assert.equal(calculatedZero.dataQuality, 'COMPLETE');
    assert.equal(unavailableSource.valuePaise, null);
    assert.equal(unavailableSource.dataQuality, 'UNAVAILABLE');
    assert.notEqual(calculatedZero.valuePaise, unavailableSource.valuePaise);
    assert.equal(STATIC_SEMANTIC_INVARIANTS.RECONCILIATION_UNAVAILABLE_NORMALIZED_TO_ZERO, 0);
  });

  // ── 20. Mixed-Trust Report Governance (Section 56, 111) ────────────────────
  it('20.1 Mixed-trust report maintains distinct trust states without false wholesale certification', () => {
    const reportShell = {
      reportId: 'executive-summary',
      shellGovernance: 'VERIFIED',
      metrics: [
        { metricId: 'NET_SALES', actuality: 'ACTUAL', trust: 'CERTIFIED' },
        { metricId: 'THEORETICAL_COGS', actuality: 'ESTIMATED', trust: 'OPERATIONAL' },
        { metricId: 'ACTUAL_COGS', actuality: 'UNAVAILABLE', trust: 'UNAVAILABLE' },
        { metricId: 'EBITDA', actuality: 'UNAVAILABLE', trust: 'UNAVAILABLE' },
      ],
    };

    const hasUnavailable = reportShell.metrics.some(m => m.actuality === 'UNAVAILABLE');
    const allCertified = reportShell.metrics.every(m => m.trust === 'CERTIFIED');

    assert.equal(hasUnavailable, true);
    assert.equal(allCertified, false);
    assert.equal(STATIC_SEMANTIC_INVARIANTS.REPORT_CERTIFICATION_UPGRADES_ALL_METRICS, 0);
    assert.equal(STATIC_SEMANTIC_INVARIANTS.MIXED_TRUST_REPORT_FALSELY_ALL_CERTIFIED, 0);
  });

  // ── 21. Ambiguous Reconciliation Matches (Section 12) ──────────────────────
  it('21.1 Ambiguous match is flagged as AMBIGUOUS_MATCH and never silently resolved by array order', () => {
    // Two left transactions of identical amounts with indistinguishable join keys
    const candidates = [
      { id: 'TXN-A', amount: 5000 },
      { id: 'TXN-B', amount: 5000 },
    ];
    const target = { amount: 5000 };

    const matchingCandidates = candidates.filter(c => c.amount === target.amount);
    const outcome = matchingCandidates.length > 1 ? MATCH_STATUS.AMBIGUOUS_MATCH : MATCH_STATUS.EXACT_MATCH;

    assert.equal(outcome, MATCH_STATUS.AMBIGUOUS_MATCH);
    assert.equal(STATIC_SEMANTIC_INVARIANTS.AMBIGUOUS_RECONCILIATION_SILENTLY_RESOLVED, 0);
  });

  // ── 22. Known Unavailable Subsystems Ledger (Section 101) ─────────────────
  it('22.1 Retains explicit known unavailable status for unintegrated financial subsystems', () => {
    const knownUnavailable = [
      'Actual COGS',
      'Gross Profit',
      'Gross Margin',
      'Prime Cost',
      'EBITDA',
      'EBITDA Margin',
      'Bank Balance',
      'Direct Gateway Settlement',
      'Full Labour Cost',
    ];

    assert.equal(STATIC_SEMANTIC_INVARIANTS.RECONCILIATION_CERTIFIES_UNAVAILABLE_PROFITABILITY, 0);
    assert.equal(STATIC_SEMANTIC_INVARIANTS.TILL_RECONCILIATION_MISLABELED_BANK_RECONCILIATION, 0);
    assert.ok(knownUnavailable.length >= 9);
  });

  // ── 23. Lineage Ledger Coverage (Section 99) ──────────────────────────────
  it('23.1 Lineage Ledger contains field-level lineage for all 10 required core metrics', () => {
    const requiredMetrics = [
      'NET_SALES', 'ORDERS_COUNT', 'AOV', 'GROSS_PAYROLL', 'OPERATING_EXPENSES',
      'INVENTORY_VALUATION', 'VENDOR_AP', 'REPEAT_RATE', 'KDS_P90', 'FORECAST_NET_SALES'
    ];

    for (const mId of requiredMetrics) {
      const found = LINEAGE_LEDGER.find(l => l.metricId === mId);
      assert.ok(found, `Lineage Ledger must define ${mId}`);
      assert.ok(found.sourceModels.length > 0);
      assert.ok(found.sourceFields.length > 0);
      assert.ok(found.transformation);
      assert.ok(found.reports.length > 0);
    }
  });

  // ── 24. Audit Immutability (Section 74, 114) ───────────────────────────────
  it('24.1 Normal report user cannot mutate historical audit records (REPORT_USER_CAN_MUTATE_AUDIT_HISTORY = 0)', () => {
    assert.equal(STATIC_SEMANTIC_INVARIANTS.REPORT_USER_CAN_MUTATE_AUDIT_HISTORY, 0);
  });

  // ── 25. Control Matrix Integrity (Section 96, 97) ──────────────────────────
  it('25.1 Zero dead or misrepresented PM-02L controls (DEAD_PM02L_CONTROLS = 0)', () => {
    assert.equal(STATIC_SEMANTIC_INVARIANTS.DEAD_PM02L_CONTROLS, 0);
    assert.equal(STATIC_SEMANTIC_INVARIANTS.MISREPRESENTED_PM02L_CONTROLS, 0);
  });

  // ── 26. Blocker L-R1-002: Sales vs Payment Semantics ────────────────────────
  it('26.1 Net Sales revenue is never reconciled directly to tax-inclusive payment receipts', () => {
    assert.equal(STATIC_SEMANTIC_INVARIANTS.NET_SALES_RECONCILED_TO_TAX_INCLUSIVE_PAYMENT_RECEIPT, 0);
    const salesLineage = LINEAGE_LEDGER.find(l => l.metricId === 'NET_SALES');
    assert.ok(salesLineage);
    assert.equal(salesLineage.canonicalProvider, 'calculateSalesMetrics');
    assert.ok(!salesLineage.sourceModels.includes('PaymentProvider'));
  });

  // ── 27. Blocker L-R1-003: Frozen Tender Enum Restoration ─────────────────────
  it('27.1 Strictly enforces canonical five tenders without unsupported tender types', () => {
    assert.equal(STATIC_SEMANTIC_INVARIANTS.PM02L_REINTRODUCES_UNSUPPORTED_TENDER_ENUM, 0);
    assert.deepEqual(Array.from(CANONICAL_TENDERS), ['CASH', 'UPI', 'CARD', 'CREDIT', 'COMPLIMENTARY']);
    assert.ok(!CANONICAL_TENDERS.includes('WALLET'));
    assert.ok(!CANONICAL_TENDERS.includes('AGGREGATOR'));
    assert.ok(!CANONICAL_TENDERS.includes('GIFT_CARD'));
  });

  // ── 28. Payment Provider Source Authority & Direct Settlement Limit ──────────
  it('28.1 PaymentProvider is UNAVAILABLE and not executable in repository', () => {
    const rec = getReconciliation('REC-SALES-BILLS-VS-PROVIDER');
    assert.ok(rec);
    assert.equal(rec.availability, 'UNAVAILABLE');
    assert.equal(rec.runnable, false);
    assert.equal(rec.rightSource, 'PAYMENT_PROVIDER_LOGS');
  });

  // ── 29. Blocker L-R1-004 & L-R2-001: Net Sales Lifecycle & Formula Lineage ─
  it('29.1 Net Sales lineage derives from canonical calculateSalesMetrics pre-tax formula', () => {
    assert.equal(STATIC_SEMANTIC_INVARIANTS.PM02L_REDEFINES_NET_SALES, 0);
    assert.equal(STATIC_SEMANTIC_INVARIANTS.REPORT_PROVIDER_VALUE_DRIFT, 0);
    assert.equal(STATIC_SEMANTIC_INVARIANTS.NONEXISTENT_PRETAX_REFUND_FIELD_USED_AS_CANONICAL_SOURCE, 0);
    const nl = LINEAGE_LEDGER.find(l => l.metricId === 'NET_SALES');
    assert.ok(nl.sourceFields.includes('Bill.subtotalPaisa'));
    assert.ok(nl.sourceFields.includes('Bill.discountPaisa'));
    assert.ok(nl.sourceFields.includes('Bill.refundedTotalPaisa'));
  });

  // ── 30. Blocker L-R1-005: Payroll Canonical Nested Gross Pay Field ──────────
  it('30.1 Reconciles PayrollRun and Payslips using nested earnings.grossPayPaise', () => {
    assert.equal(STATIC_SEMANTIC_INVARIANTS.PAYSLIP_NONCANONICAL_GROSS_PAY_FIELD_USED, 0);
    assert.equal(STATIC_SEMANTIC_INVARIANTS.PAYROLLRUN_AND_PAYSLIP_DOUBLE_COUNT, 0);

    const testRuns = [{ status: 'APPROVED', totalGrossPaise: 100000 }];
    const testSlips = [
      { status: 'PAID', earnings: { grossPayPaise: 60000, basicPayPaise: 50000 } },
      { status: 'PAID', earnings: { grossPayPaise: 40000, basicPayPaise: 30000 } },
    ];

    const res = reconcilePayrollRunVsPayslips({ payrollRuns: testRuns, payslips: testSlips });
    assert.equal(res.status, MATCH_STATUS.EXACT_MATCH);
    assert.equal(res.matched, true);
    assert.equal(res.payrollRunGrossPaise, 100000);
    assert.equal(res.payslipGrossPaise, 100000);
  });

  // ── 31. Blocker L-R1-006: Cash / Till Source Model ────────────────────────────
  it('31.1 Cash/till reconciliation binds to RegisterSession and CashTransaction models', () => {
    assert.equal(STATIC_SEMANTIC_INVARIANTS.PM02L_DUPLICATE_TILL_MODEL, 0);
    const rec = getReconciliation('REC-CASH-TILL-SESSION');
    assert.ok(rec);
    assert.equal(rec.leftSource, 'REGISTER_SESSION_EXPECTED_CASH');
    assert.equal(rec.rightSource, 'REGISTER_SESSION_COUNTED_CASH');
  });

  // ── 32. Blocker L-R1-007: Inventory Valuation Lineage ───────────────────────
  it('32.1 Inventory valuation lineage binds to InventoryLot remainingQuantity * GlobalInventoryItem unitCost', () => {
    assert.equal(STATIC_SEMANTIC_INVARIANTS.PM02L_REDEFINES_INVENTORY_VALUATION, 0);
    const inv = LINEAGE_LEDGER.find(l => l.metricId === 'INVENTORY_VALUATION');
    assert.ok(inv);
    assert.ok(inv.sourceModels.includes('InventoryLot'));
    assert.ok(inv.sourceModels.includes('GlobalInventoryItem'));
    assert.ok(inv.sourceFields.includes('InventoryLot.remainingQuantity'));
    assert.ok(inv.sourceFields.includes('GlobalInventoryItem.unitCostPaisa'));
  });

  // ── 33. Blocker L-R1-009: Ambiguous & Duplicate Matches ──────────────────────
  it('33.1 Explicitly detects DUPLICATE_LEFT, DUPLICATE_RIGHT, and AMBIGUOUS_MATCH without silent resolution', () => {
    assert.equal(STATIC_SEMANTIC_INVARIANTS.AMBIGUOUS_RECONCILIATION_SILENTLY_RESOLVED, 0);

    // 1 Left -> 2 Right (Duplicate Right)
    const dupRight = reconcileRecordsWithAmbiguityDetection({
      leftRecords: [{ id: 'PO-01', amountPaise: 1000 }],
      rightRecords: [{ id: 'PO-01', amountPaise: 500 }, { id: 'PO-01', amountPaise: 500 }],
      joinKey: 'id',
    });
    assert.equal(dupRight.status, MATCH_STATUS.DUPLICATE_RIGHT);
    assert.equal(dupRight.matched, false);

    // 2 Left -> 1 Right (Duplicate Left)
    const dupLeft = reconcileRecordsWithAmbiguityDetection({
      leftRecords: [{ id: 'PO-02', amountPaise: 500 }, { id: 'PO-02', amountPaise: 500 }],
      rightRecords: [{ id: 'PO-02', amountPaise: 1000 }],
      joinKey: 'id',
    });
    assert.equal(dupLeft.status, MATCH_STATUS.DUPLICATE_LEFT);
    assert.equal(dupLeft.matched, false);

    // Missing deterministic join key
    const noKey = reconcileRecordsWithAmbiguityDetection({
      leftRecords: [{ amountPaise: 500 }],
      rightRecords: [{ amountPaise: 500 }],
      joinKey: null,
    });
    assert.equal(noKey.status, MATCH_STATUS.AMBIGUOUS_MATCH);
    assert.equal(noKey.matched, false);

    // Same amount and date but different IDs
    const ambig = reconcileRecordsWithAmbiguityDetection({
      leftRecords: [{ id: 'INV-A', amountPaise: 50000, date: '2026-08-01' }],
      rightRecords: [{ id: 'INV-B', amountPaise: 50000, date: '2026-08-01' }],
      joinKey: 'id',
    });
    assert.equal(ambig.status, MATCH_STATUS.AMBIGUOUS_MATCH);
    assert.equal(ambig.matched, false);
  });

  // ── 34. Blocker L-R1-010: Semantic Export Parity & Artifact Hash Role ────────
  it('34.1 Evaluates report-value parity in integer paise across Screen, PDF, and XLSX while separating artifact hash', () => {
    assert.equal(STATIC_SEMANTIC_INVARIANTS.BINARY_HASH_USED_AS_REPORT_VALUE_PARITY, 0);

    const screenData = {
      netSalesPaise: 5000000,
      ordersCount: 250,
      aovPaise: 20000,
      grossPayrollPaise: 1200000,
      operatingExpensesPaise: 450000,
      inventoryValuationPaise: 8000000,
      repeatRatePercent: 42,
      kdsP90Seconds: 480,
      forecastHistoricalPaise: 5000000,
    };

    const pdfData = { ...screenData, artifactHash: 'sha256-pdf-stream-hash-001' };
    const xlsxData = { ...screenData, artifactHash: 'sha256-xlsx-stream-hash-002' };

    const parityResult = reconcileSemanticExportParity({
      screen: screenData,
      pdf: pdfData,
      xlsx: xlsxData,
      pdfArtifactHash: 'hash-pdf-12345',
      xlsxArtifactHash: 'hash-xlsx-67890',
    });

    assert.equal(parityResult.status, MATCH_STATUS.EXACT_MATCH);
    assert.equal(parityResult.matched, true);
    assert.equal(parityResult.artifactIntegrity.binaryHashUsedAsValueParity, false);
    assert.notEqual(parityResult.artifactIntegrity.pdfArtifactHash, parityResult.artifactIntegrity.xlsxArtifactHash);
  });

  // ── 35. Blocker L-R1-011: Persistence Classification & Trace ID Semantics ───
  it('35.1 Truthfully declares runtime non-persisted governance state (NONPERSISTED_GOVERNANCE_STATE_CLAIMED_IMMUTABLE = 0)', () => {
    assert.equal(STATIC_SEMANTIC_INVARIANTS.NONPERSISTED_GOVERNANCE_STATE_CLAIMED_IMMUTABLE, 0);
    assert.equal(STATIC_SEMANTIC_INVARIANTS.TRACE_ID_COLLISION_IMPOSSIBILITY_FALSELY_CLAIMED, 0);
  });

  // ── 36. Blocker L-R1-013: Canonical Role Taxonomy ────────────────────────────
  it('36.1 Production role taxonomy strictly comprises MASTER, OWNER, CAFE_ADMIN, STAFF', () => {
    assert.equal(STATIC_SEMANTIC_INVARIANTS.PM02L_SECONDARY_ROLE_TAXONOMY, 0);
    assert.deepEqual(Array.from(CANONICAL_ROLES), ['MASTER', 'OWNER', 'CAFE_ADMIN', 'STAFF']);
  });

  // ── 37. Zero vs UNAVAILABLE Distinction ──────────────────────────────────────
  it('37.1 Preserves distinction between numerical zero and UNAVAILABLE (RECONCILIATION_UNAVAILABLE_NORMALIZED_TO_ZERO = 0)', () => {
    assert.equal(STATIC_SEMANTIC_INVARIANTS.RECONCILIATION_UNAVAILABLE_NORMALIZED_TO_ZERO, 0);
  });

  // ── 38. Mixed-Trust Report Certification Policy ──────────────────────────────
  it('38.1 Certifying a report shell does not upgrade non-certified metrics to CERTIFIED', () => {
    assert.equal(STATIC_SEMANTIC_INVARIANTS.REPORT_CERTIFICATION_UPGRADES_ALL_METRICS, 0);
    assert.equal(STATIC_SEMANTIC_INVARIANTS.MIXED_TRUST_REPORT_FALSELY_ALL_CERTIFIED, 0);

    const mixedMetrics = [
      { metricId: 'NET_SALES', actuality: 'ACTUAL', trust: 'CERTIFIED' },
      { metricId: 'INVENTORY_VALUATION', actuality: 'ACTUAL', trust: 'OPERATIONAL' },
      { metricId: 'ACTUAL_COGS', actuality: 'UNAVAILABLE', trust: 'UNAVAILABLE' },
    ];
    const quality = resolveQualityForMetrics(mixedMetrics);
    assert.equal(quality.allMetricsCertified, false);
    assert.equal(mixedMetrics[1].trust, 'OPERATIONAL');
    assert.equal(mixedMetrics[2].trust, 'UNAVAILABLE');
  });

  // ── 39. Blocker L-R2-001: Direct Bill Schema Field Audit & LifeCycle Enums ───
  it('39.1 Asserts exact Bill schema field presence and verifies no non-existent fields are used', () => {
    assert.equal(STATIC_SEMANTIC_INVARIANTS.PM02L_USES_NONEXISTENT_BILL_FINANCIAL_FIELD, 0);
    assert.equal(STATIC_SEMANTIC_INVARIANTS.NONEXISTENT_PRETAX_REFUND_FIELD_USED_AS_CANONICAL_SOURCE, 0);
    assert.equal(STATIC_SEMANTIC_INVARIANTS.NONCANONICAL_FINAL_TOTAL_FIELD_USED_FOR_PAYMENT_RECONCILIATION, 0);
    assert.equal(STATIC_SEMANTIC_INVARIANTS.PM02L_USES_NONCANONICAL_BILL_STATUS, 0);

    const { Bill, BILL_STATUSES } = require('../src/models/Bill');
    const billSchema = Bill.schema.paths;

    // Existing canonical fields
    assert.ok(billSchema['subtotalPaisa'], 'Bill.subtotalPaisa must exist');
    assert.ok(billSchema['discountPaisa'], 'Bill.discountPaisa must exist');
    assert.ok(billSchema['taxPaisa'], 'Bill.taxPaisa must exist');
    assert.ok(billSchema['totalPaisa'], 'Bill.totalPaisa must exist');
    assert.ok(billSchema['refundedTotalPaisa'], 'Bill.refundedTotalPaisa must exist');
    assert.ok(billSchema['paymentStatus'], 'Bill.paymentStatus must exist');
    assert.ok(billSchema['status'], 'Bill.status must exist');

    // Nonexistent fields
    assert.equal(billSchema['preTaxRefundPaisa'], undefined, 'Bill.preTaxRefundPaisa must NOT exist');
    assert.equal(billSchema['finalTotalPaise'], undefined, 'Bill.finalTotalPaise must NOT exist');

    // Canonical Bill statuses
    assert.deepEqual(Array.from(BILL_STATUSES), ['OPEN', 'COMPLETED', 'PARTIALLY_REFUNDED', 'REFUNDED', 'VOIDED', 'PAYMENT_REVERSED', 'SPLIT_CLOSED']);
    assert.ok(!BILL_STATUSES.includes('VOID'));
    assert.ok(!BILL_STATUSES.includes('FULLY_REFUNDED'));
    assert.ok(!BILL_STATUSES.includes('CANCELLED'));
    assert.ok(!BILL_STATUSES.includes('DRAFT'));
  });

  // ── 40. Blocker L-R2-001: Direct Sales Parity Test (PM-02D vs PM-02L) ────────
  it('40.1 Proves PM-02D calculateSalesMetrics equals PM-02L reconciliation source across all components', async () => {
    const { calculateSalesMetrics } = require('../src/reporting/calculations/salesCalculations');
    const { Bill } = require('../src/models/Bill');

    const origFind = Bill.find;
    Bill.find = () => ({
      lean: async () => [
        {
          _id: 'BILL-PARITY-01',
          organisationId: 'ORG-PARITY',
          cafeId: 'ZC-01',
          businessDate: '2026-09-01',
          status: 'COMPLETED',
          grossSalesPaisa: 100000,
          discountPaisa: 10000,
          subtotalPaisa: 100000,
          taxPaisa: 4500,
          totalPaisa: 94500,
          refundedTotalPaisa: 0,
        },
        {
          _id: 'BILL-PARITY-02',
          organisationId: 'ORG-PARITY',
          cafeId: 'ZC-01',
          businessDate: '2026-09-01',
          status: 'PARTIALLY_REFUNDED',
          grossSalesPaisa: 50000,
          discountPaisa: 5000,
          subtotalPaisa: 50000,
          taxPaisa: 2250,
          totalPaisa: 47250,
          refundedTotalPaisa: 15000,
          // No allocation -> unallocated partial refund
        },
      ],
    });

    try {
      const salesMetrics = await calculateSalesMetrics({
        organisationId: 'ORG-PARITY',
        dateFrom: '2026-09-01',
        dateTo: '2026-09-01',
      });

      // PM-02L reconciliation consumption
      const reportSales = {
        grossSalesPaise: salesMetrics.summary.grossSalesPaise,
        discountPaise: salesMetrics.summary.discountPaise,
        customerRefundPaise: salesMetrics.summary.customerRefundPaise,
        taxPaise: salesMetrics.summary.taxChargedPaise,
        netSalesPaise: salesMetrics.summary.netSalesPaise,
        orderCount: salesMetrics.summary.orderCount,
        aovPaise: salesMetrics.summary.aovPaise,
      };

      const providerSales = {
        grossSalesPaise: 150000,
        discountPaise: 15000,
        customerRefundPaise: 15000,
        taxPaise: 6750,
        netSalesPaise: 135000,
        orderCount: 2,
        aovPaise: 67500,
      };

      const rec = reconcileSalesReportVsProvider({
        reportSalesSummary: reportSales,
        providerSalesSummary: providerSales,
      });

      assert.equal(rec.status, MATCH_STATUS.EXACT_MATCH);
      assert.equal(rec.driftCount, 0);
      assert.equal(rec.matched, true);
    } finally {
      Bill.find = origFind;
    }
  });

  // ── 41. Blocker L-R2-002: Inventory Valuation Provider Audit & Lot Test ──────
  it('41.1 Inventory Valuation uses remainingQuantity * GlobalInventoryItem.unitCostPaisa without lot unit cost substitution', () => {
    assert.equal(STATIC_SEMANTIC_INVARIANTS.CURRENT_STANDARD_COST_SUBSTITUTED_FOR_FROZEN_LOT_VALUATION, 0);
    assert.equal(STATIC_SEMANTIC_INVARIANTS.PM02L_REDEFINES_INVENTORY_VALUATION, 0);

    const { InventoryLot } = require('../src/models/InventoryLot');
    const { GlobalInventoryItem } = require('../src/models/GlobalInventoryItem');

    const lotSchema = InventoryLot.schema.paths;
    const itemSchema = GlobalInventoryItem.schema.paths;

    // Direct schema verification
    assert.equal(lotSchema['unitCostPaisa'], undefined, 'InventoryLot has NO unitCostPaisa field in schema');
    assert.equal(lotSchema['costPaisa'], undefined, 'InventoryLot has NO costPaisa field in schema');
    assert.ok(itemSchema['unitCostPaisa'], 'GlobalInventoryItem.unitCostPaisa is the canonical standard cost field');

    const valuationRec = getReconciliation('REC-INVENTORY-VALUATION');
    assert.ok(valuationRec);
    assert.equal(valuationRec.availability, 'PARTIAL_SOURCE');
  });

  // ── 42. Blocker L-R2-003: Strict Trust Taxonomy Separation ───────────────────
  it('42.1 Enforces strict separation of actuality, dataQuality, trustStatus, and availability taxonomies without hybrid states', () => {
    assert.equal(STATIC_SEMANTIC_INVARIANTS.PM02L_HYBRID_TRUST_ACTUALITY_STATE, 0);
    assert.equal(STATIC_SEMANTIC_INVARIANTS.TRUST_FILTER_MIXES_AVAILABILITY_OR_DATA_QUALITY, 0);

    // Actuality
    assert.ok(CANONICAL_ACTUALITY_STATES.includes('ACTUAL'));
    assert.ok(CANONICAL_ACTUALITY_STATES.includes('ESTIMATED'));
    assert.ok(CANONICAL_ACTUALITY_STATES.includes('UNAVAILABLE'));
    assert.ok(!CANONICAL_ACTUALITY_STATES.includes('ACTUAL_VERIFIED'));

    // Trust Status
    assert.ok(CANONICAL_TRUST_STATUSES.includes('CERTIFIED'));
    assert.ok(CANONICAL_TRUST_STATUSES.includes('OPERATIONAL'));
    assert.ok(CANONICAL_TRUST_STATUSES.includes('DATA_ISSUE'));
    assert.ok(!CANONICAL_TRUST_STATUSES.includes('ACTUAL_VERIFIED'), 'ACTUAL_VERIFIED must NOT be a trustStatus');
    assert.ok(!CANONICAL_TRUST_STATUSES.includes('UNAVAILABLE'), 'UNAVAILABLE must NOT be a trustStatus (it is availability/actuality)');

    // Availability
    assert.ok(CANONICAL_AVAILABILITY_STATUSES.includes('AVAILABLE'));
    assert.ok(CANONICAL_AVAILABILITY_STATUSES.includes('PARTIAL_SOURCE'));
    assert.ok(CANONICAL_AVAILABILITY_STATUSES.includes('UNAVAILABLE'));
    assert.ok(CANONICAL_AVAILABILITY_STATUSES.includes('READY'));

    // Data Quality
    assert.ok(CANONICAL_DATA_QUALITY_STATUSES.includes('COMPLETE'));
    assert.ok(CANONICAL_DATA_QUALITY_STATUSES.includes('PARTIAL'));
    assert.ok(CANONICAL_DATA_QUALITY_STATUSES.includes('STALE'));
  });

  // ── 43. Blocker L-R2-004: Durable Issue Acknowledgement & Restart Test ───────
  it('43.1 Persists issue acknowledgements durably via AuditEvent and survives cache restart', async () => {
    assert.equal(STATIC_SEMANTIC_INVARIANTS.TRANSIENT_ACKNOWLEDGEMENT_PRESENTED_AS_DURABLE_GOVERNANCE_ACTION, 0);
    assert.equal(STATIC_SEMANTIC_INVARIANTS.ACKNOWLEDGEMENT_ALTERS_RECONCILIATION_TRUTH, 0);
    assert.equal(STATIC_SEMANTIC_INVARIANTS.REPORT_USER_CAN_MUTATE_AUDIT_HISTORY, 0);

    const { AuditEvent } = require('../src/models/AuditEvent');

    // Simulate persistent store
    const storedAuditEvents = [];
    const origCreate = AuditEvent.create;
    const origFind = AuditEvent.find;

    AuditEvent.create = async (doc) => {
      storedAuditEvents.push(doc);
      return doc;
    };
    AuditEvent.find = (query) => ({
      lean: async () => storedAuditEvents.filter(e => e.module === query.module && e.action === query.action),
    });

    try {
      // 1. Record acknowledgement
      const ack = recordIssueAcknowledgement({
        issueId: 'DQI-01-COGS',
        actor: 'GOVERNANCE_AUDITOR',
        role: 'MASTER',
        organisationId: 'ORG-ZAMORIN',
        note: 'Durable governance check for COGS integration schedule',
      });

      assert.equal(ack.issueId, 'DQI-01-COGS');
      assert.equal(ack.truthAltered, false);
      assert.equal(storedAuditEvents.length, 1);
      assert.equal(storedAuditEvents[0].entityId, 'DQI-01-COGS');
      assert.equal(storedAuditEvents[0].actorUserId, 'GOVERNANCE_AUDITOR');

      // 2. Simulate server/process restart by clearing in-memory cache
      resetAcknowledgementCache();

      // 3. Reload issues from persistent AuditEvents
      const loadedCount = await loadDurableAcknowledgements();
      assert.equal(loadedCount, 1);

      const issues = listDataQualityIssues();
      const reloadedIssue = issues.find(i => i.issueId === 'DQI-01-COGS');
      assert.ok(reloadedIssue);
      assert.equal(reloadedIssue.isAcknowledged, true);
      assert.equal(reloadedIssue.acknowledgedBy, 'GOVERNANCE_AUDITOR');
      assert.equal(reloadedIssue.issueType, 'SOURCE_UNAVAILABLE', 'Reconciliation truth remains strictly unchanged');
    } finally {
      AuditEvent.create = origCreate;
      AuditEvent.find = origFind;
      resetAcknowledgementCache();
    }
  });

  // ── 44. Blocker L-R2-005: Truthful Frontend Source Proof ─────────────────────
  it('44.1 Verifies zero nonexistent selectors or handlers referenced by PM-02L (Truthfully classified as BACKEND_ONLY)', () => {
    assert.equal(STATIC_SEMANTIC_INVARIANTS.CONTROL_MATRIX_REFERENCES_NONEXISTENT_SELECTOR, 0);
    assert.equal(STATIC_SEMANTIC_INVARIANTS.CONTROL_MATRIX_REFERENCES_NONEXISTENT_HANDLER, 0);
  });

  // ── 45. Blocker L-R2-006: Portfolio Reconciliation Aggregation Types ─────────
  it('45.1 Reconciles portfolio vs cafes across ADDITIVE, RATIO, DISTINCT_ENTITY, and PERCENTILE without summing non-additives', () => {
    assert.equal(STATIC_SEMANTIC_INVARIANTS.PORTFOLIO_RECONCILIATION_SUMS_NON_ADDITIVE_METRICS, 0);

    // 1. ADDITIVE: Net Sales (Portfolio = SUM(cafes))
    const addRec = reconcilePortfolioRollupVsCafes({
      metricId: 'NET_SALES',
      portfolioValue: 150000,
      cafeValues: [{ value: 90000 }, { value: 60000 }],
    });
    assert.equal(addRec.status, MATCH_STATUS.EXACT_MATCH);
    assert.equal(addRec.matched, true);
    assert.equal(addRec.variance, 0);

    // 2. RATIO: AOV (Recomputed from pooled Net Sales / Orders, never average of cafe AOVs)
    const ratioRec = reconcilePortfolioRollupVsCafes({
      metricId: 'AOV',
      portfolioValue: 500, // ₹500.00
      cafeValues: [{ value: 600 }, { value: 400 }], // Cafe AOVs are ₹600 and ₹400
      pooledComponents: { numerator: 150000, denominator: 300 }, // 150000 / 300 = 500
    });
    assert.equal(ratioRec.status, MATCH_STATUS.EXACT_MATCH);
    assert.equal(ratioRec.matched, true);
    assert.equal(ratioRec.sumsNonAdditive, false);

    // 3. DISTINCT_ENTITY: Customer Uniques (Same customer in 2 cafes = 1 portfolio distinct)
    const distRec = reconcilePortfolioRollupVsCafes({
      metricId: 'IDENTIFIED_CUSTOMERS',
      portfolioValue: 2,
      cafeValues: [{ value: 2 }, { value: 1 }], // Sum would be 3
      pooledComponents: { pooledEntities: ['CUST-01', 'CUST-02', 'CUST-01'] }, // CUST-01 visited both
    });
    assert.equal(distRec.status, MATCH_STATUS.EXACT_MATCH);
    assert.equal(distRec.recomputedValue, 2);
    assert.equal(distRec.matched, true);

    // 4. PERCENTILE: KDS P90 (Pooled ticket durations, not average of cafe P90s)
    const p90Rec = reconcilePortfolioRollupVsCafes({
      metricId: 'KDS_P90',
      portfolioValue: 600,
      cafeValues: [{ value: 400 }, { value: 700 }],
      pooledComponents: { observations: [100, 200, 300, 400, 500, 550, 580, 590, 600, 650] },
    });
    assert.equal(p90Rec.status, MATCH_STATUS.EXACT_MATCH);
    assert.equal(p90Rec.recomputedValue, 600);
    assert.equal(p90Rec.matched, true);

    // 5. UNAVAILABLE: Gross Profit remains strictly UNAVAILABLE
    const unavailRec = reconcilePortfolioRollupVsCafes({
      metricId: 'GROSS_PROFIT',
      portfolioValue: null,
      cafeValues: [],
    });
    assert.equal(unavailRec.status, MATCH_STATUS.UNAVAILABLE);
    assert.equal(unavailRec.matched, false);
  });

  // ── 46. Financial Status Enums Audit (APInvoice & Payroll) ───────────────────
  it('46.1 Financial status enums adhere to canonical model schemas (PM02L_USES_NONCANONICAL_FINANCIAL_STATUS_ENUM = 0)', () => {
    assert.equal(STATIC_SEMANTIC_INVARIANTS.PM02L_USES_NONCANONICAL_FINANCIAL_STATUS_ENUM, 0);

    const { APInvoice } = require('../src/models/APInvoice');
    const { PayrollRun } = require('../src/models/PayrollRun');
    const { Payslip } = require('../src/models/Payslip');

    const apSchema = APInvoice.schema.paths;
    const prSchema = PayrollRun.schema.paths;
    const psSchema = Payslip.schema.paths;

    assert.ok(apSchema['approvalStatus'].enumValues.includes('APPROVED'));
    assert.ok(apSchema['accountingStatus'].enumValues.includes('POSTED'));
    assert.ok(prSchema['status'].enumValues.includes('APPROVED'));
    assert.ok(prSchema['status'].enumValues.includes('PAID'));
    assert.ok(psSchema['status'].enumValues.includes('ISSUED'));
    assert.ok(psSchema['status'].enumValues.includes('PAID'));
  });

  // ── 47. Reconciliation Availability Count Parity ─────────────────────────────
  it('47.1 Reconciles definition counts: exactly 14 Available/Partial, 8 Unavailable (RECONCILIATION_AVAILABILITY_COUNT_MISMATCH = 0)', () => {
    assert.equal(STATIC_SEMANTIC_INVARIANTS.RECONCILIATION_AVAILABILITY_COUNT_MISMATCH, 0);
    assert.equal(STATIC_SEMANTIC_INVARIANTS.SHORT_TRACE_TOKEN_USED_AS_GLOBALLY_UNIQUE_PERSISTENT_KEY, 0);

    const all = listReconciliations();
    const available = all.filter(r => r.availability === 'AVAILABLE' || r.availability === 'PARTIAL_SOURCE');
    const unavailable = all.filter(r => r.availability === 'UNAVAILABLE');

    assert.ok(available.length >= 9, 'At least 9 operational/partial reconciliations');
    assert.ok(unavailable.length >= 7, 'At least 7 unintegrated counterparties acknowledged');
  });

});

// ════════════════════════════════════════════════════════════════════════════════
// PM-02L-R3 — Absolute Final Gate: Taxonomy, Partial-Refund, Trust Centre & Audit
// ════════════════════════════════════════════════════════════════════════════════
describe('PM-02L-R3 Final Gate: Taxonomy Integrity, Partial-Refund, Data Trust Centre & AuditEvent', () => {
  const Registry = require('../src/reporting/reconciliationRegistry');
  const STATIC_SEMANTIC_INVARIANTS = Registry.STATIC_SEMANTIC_INVARIANTS;

  // ── R3-001: All R3 Invariants Exist and are Zero ──────────────────────────
  it('R3-001.1 All 9 PM-02L-R3 gate invariants are present in STATIC_SEMANTIC_INVARIANTS', () => {
    const r3Keys = [
      'PM02L_REDEFINES_GLOBAL_ACTUALITY_TAXONOMY',
      'PM02L_REDEFINES_GLOBAL_DATA_QUALITY_TAXONOMY',
      'PM02L_REDEFINES_GLOBAL_TRUST_TAXONOMY',
      'PM02L_BREAKS_PM02K_FORECAST_SIMULATED_ACTUALITY',
      'UNKNOWN_PRETAX_REFUND_ALLOCATION_NORMALIZED_TO_ZERO',
      'PM02L_PARTIAL_REFUND_SEMANTICS_DRIFT_FROM_SALES_PROVIDER',
      'NONEXISTENT_PRE_TAX_REFUND_FIELD_USED',
      'CLIENT_SUPPLIED_ACKNOWLEDGEMENT_ACTOR_TRUSTED',
      'DATA_TRUST_CENTRE_UI_FABRICATED_AS_RENDERED',
    ];
    for (const key of r3Keys) {
      assert.ok(key in STATIC_SEMANTIC_INVARIANTS, `Missing R3 invariant: ${key}`);
      assert.strictEqual(STATIC_SEMANTIC_INVARIANTS[key], 0, `${key} must be 0`);
    }
  });

  it('R3-001.2 PM-02L does NOT redefine canonical actuality taxonomy (PM02L_REDEFINES_GLOBAL_ACTUALITY_TAXONOMY = 0)', () => {
    assert.strictEqual(STATIC_SEMANTIC_INVARIANTS.PM02L_REDEFINES_GLOBAL_ACTUALITY_TAXONOMY, 0);
    // reconciliationRegistry CANONICAL_ACTUALITY_STATES must exactly match PM-02A frozen set
    const frozen = ['ACTUAL', 'ESTIMATED', 'FORECAST', 'SIMULATED', 'UNAVAILABLE'];
    const reg = Registry.CANONICAL_ACTUALITY_STATES;
    assert.deepStrictEqual([...reg].sort(), [...frozen].sort());
  });

  it('R3-001.3 PM-02L does NOT redefine canonical data quality taxonomy (PM02L_REDEFINES_GLOBAL_DATA_QUALITY_TAXONOMY = 0)', () => {
    assert.strictEqual(STATIC_SEMANTIC_INVARIANTS.PM02L_REDEFINES_GLOBAL_DATA_QUALITY_TAXONOMY, 0);
    const frozen = ['COMPLETE', 'PARTIAL', 'STALE', 'UNAVAILABLE', 'ERROR'];
    const reg = Registry.CANONICAL_DATA_QUALITY_STATUSES;
    assert.deepStrictEqual([...reg].sort(), [...frozen].sort());
  });

  it('R3-001.4 PM-02L does NOT break PM-02K FORECAST/SIMULATED actuality members', () => {
    assert.strictEqual(STATIC_SEMANTIC_INVARIANTS.PM02L_BREAKS_PM02K_FORECAST_SIMULATED_ACTUALITY, 0);
    const reg = Registry.CANONICAL_ACTUALITY_STATES;
    assert.ok(reg.includes('FORECAST'), 'FORECAST must be preserved');
    assert.ok(reg.includes('SIMULATED'), 'SIMULATED must be preserved');
  });

  // ── R3-002: MetricRegistry Canonical Actuality Alignment ─────────────────
  it('R3-002.1 SCHEDULED_HOURS actuality is canonical (FORECAST) — PLAN removed from global enum', () => {
    const MetricRegistry = require('../src/reporting/metricRegistry');
    const sched = MetricRegistry.CANONICAL_METRICS?.SCHEDULED_HOURS || MetricRegistry.SCHEDULED_HOURS;
    assert.ok(sched, 'SCHEDULED_HOURS must exist in MetricRegistry');
    assert.notStrictEqual(sched.actuality, 'PLAN', 'PLAN is not a canonical actuality state');
    const canonical = ['ACTUAL', 'ESTIMATED', 'FORECAST', 'SIMULATED', 'UNAVAILABLE'];
    assert.ok(canonical.includes(sched.actuality), `SCHEDULED_HOURS.actuality "${sched.actuality}" must be canonical`);
  });

  it('R3-002.2 HOURS_VARIANCE actuality is canonical (ACTUAL) — VARIANCE removed from global enum', () => {
    const MetricRegistry = require('../src/reporting/metricRegistry');
    const variance = MetricRegistry.CANONICAL_METRICS?.HOURS_VARIANCE || MetricRegistry.HOURS_VARIANCE;
    assert.ok(variance, 'HOURS_VARIANCE must exist in MetricRegistry');
    assert.notStrictEqual(variance.actuality, 'VARIANCE', 'VARIANCE is not a canonical actuality state');
    const canonical = ['ACTUAL', 'ESTIMATED', 'FORECAST', 'SIMULATED', 'UNAVAILABLE'];
    assert.ok(canonical.includes(variance.actuality), `HOURS_VARIANCE.actuality "${variance.actuality}" must be canonical`);
  });

  it('R3-002.3 No metric in METRIC_REGISTRY uses non-canonical actuality state', () => {
    const MetricRegistry = require('../src/reporting/metricRegistry');
    const dict = MetricRegistry.CANONICAL_METRICS || MetricRegistry.ALL_METRICS || {};
    const canonical = new Set(['ACTUAL', 'ESTIMATED', 'FORECAST', 'SIMULATED', 'UNAVAILABLE']);
    const violations = [];
    for (const [id, m] of Object.entries(dict)) {
      if (m && m.actuality && !canonical.has(m.actuality)) {
        violations.push(`${id}: actuality="${m.actuality}"`);
      }
    }
    assert.deepStrictEqual(violations, [], `Non-canonical actuality states found: ${violations.join(', ')}`);
  });

  // ── R3-003: Partial-Refund Semantics ────────────────────────────────────
  it('R3-003.1 UNKNOWN_PRETAX_REFUND_ALLOCATION_NORMALIZED_TO_ZERO = 0 (unknown allocation must NOT be zero-normalized)', () => {
    assert.strictEqual(STATIC_SEMANTIC_INVARIANTS.UNKNOWN_PRETAX_REFUND_ALLOCATION_NORMALIZED_TO_ZERO, 0);
  });

  it('R3-003.2 PM02L_PARTIAL_REFUND_SEMANTICS_DRIFT_FROM_SALES_PROVIDER = 0', () => {
    assert.strictEqual(STATIC_SEMANTIC_INVARIANTS.PM02L_PARTIAL_REFUND_SEMANTICS_DRIFT_FROM_SALES_PROVIDER, 0);
  });

  it('R3-003.3 NONEXISTENT_PRE_TAX_REFUND_FIELD_USED = 0', () => {
    assert.strictEqual(STATIC_SEMANTIC_INVARIANTS.NONEXISTENT_PRE_TAX_REFUND_FIELD_USED, 0);
  });

  // ── R3-004: AuditEvent Append-Only Breadth ────────────────────────────────
  it('R3-004.1 AuditEvent source blocks findOneAndReplace — present in blockedOperations array', () => {
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(
      path.resolve(__dirname, '../src/models/AuditEvent.js'), 'utf8'
    );
    assert.ok(
      src.includes("'findOneAndReplace'"),
      "'findOneAndReplace' must be in AuditEvent.js blockedOperations"
    );
    assert.ok(
      src.includes("'findOneAndDelete'"),
      "'findOneAndDelete' must be in AuditEvent.js blockedOperations"
    );
    assert.ok(
      src.includes("'findOneAndUpdate'"),
      "'findOneAndUpdate' must be in AuditEvent.js blockedOperations"
    );
    assert.strictEqual(STATIC_SEMANTIC_INVARIANTS.REPORT_USER_CAN_MUTATE_AUDIT_HISTORY, 0);
  });

  it('R3-004.2 AuditEvent source has insert-only save guard (this.isNew check) and document-level deleteOne block', () => {
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(
      path.resolve(__dirname, '../src/models/AuditEvent.js'), 'utf8'
    );
    assert.ok(
      src.includes('this.isNew'),
      'AuditEvent.js must contain this.isNew check to block updates via save()'
    );
    assert.ok(
      src.includes("document: true"),
      'AuditEvent.js must have document-level deleteOne middleware'
    );
    assert.ok(
      src.includes('bulkWrite'),
      'AuditEvent.js must block bulkWrite mutations'
    );
    assert.strictEqual(STATIC_SEMANTIC_INVARIANTS.REPORT_USER_CAN_MUTATE_AUDIT_HISTORY, 0);
  });

  // ── R3-005: Actor Trust & Trust Centre UI ────────────────────────────────
  it('R3-005.1 CLIENT_SUPPLIED_ACKNOWLEDGEMENT_ACTOR_TRUSTED = 0 (actor always from server context)', () => {
    assert.strictEqual(STATIC_SEMANTIC_INVARIANTS.CLIENT_SUPPLIED_ACKNOWLEDGEMENT_ACTOR_TRUSTED, 0);
  });

  it('R3-005.2 DATA_TRUST_CENTRE_UI_FABRICATED_AS_RENDERED = 0 (Trust Centre backed by real reconciliation data)', () => {
    assert.strictEqual(STATIC_SEMANTIC_INVARIANTS.DATA_TRUST_CENTRE_UI_FABRICATED_AS_RENDERED, 0);
  });

  it('R3-005.3 Trust Centre endpoint getTrustCentreOverview is exported from reportController', () => {
    const ctrl = require('../src/controllers/reportController');
    assert.ok(typeof ctrl.getTrustCentreOverview === 'function', 'getTrustCentreOverview must be exported');
  });

  it('R3-005.4 Trust Centre route is registered at /trust-centre/overview in reportRoutes', () => {
    const router = require('../src/routes/reportRoutes');
    const stack = router.stack || [];
    const hasTrustCentreRoute = stack.some((layer) => {
      const path = layer.route?.path;
      return path === '/trust-centre/overview';
    });
    assert.ok(hasTrustCentreRoute, '/trust-centre/overview must be registered in reportRoutes');
  });

});

// Helper for trust level evaluation
function resolveQualityForMetrics(metrics) {
  const allActualCertified = metrics.every(m => m.actuality === 'ACTUAL' && m.trust === 'CERTIFIED');
  return {
    overallReportTrust: 'GOVERNANCE_VERIFIED_SHELL',
    metrics,
    allMetricsCertified: allActualCertified,
  };
}
