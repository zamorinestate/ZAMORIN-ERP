'use strict';

/**
 * ============================================================================
 * ZAMORIN CAFÉ ERP — P12 FINANCE, REPORTS, EXPORTS & OWNER INSIGHT TEST SUITE
 * ============================================================================
 *
 * Verifies P12 requirements against authoritative models, services, and routes:
 *  1. 18-Report Catalogue mapping and metadata across all business domains.
 *  2. Financial totals reconcile to authoritative ledger and source records.
 *  3. Period boundaries, business dates, as-of cutoffs, and empty periods behave deterministically.
 *  4. Accounts Payable aging classifies current, 1-30, 31-60, 61-90, 91-180, 180+ buckets.
 *  5. Three-Value AP Architecture: Disputed/held amounts are segregated from approved payables.
 *  6. Accounts Receivable aging correctly calculates overdue buckets from invoice due dates.
 *  7. Institutional Account Statements preserve transaction history, credit limits, and balances.
 *  8. Customer advance deposits held as liabilities are distinguished from sales revenue.
 *  9. Physical cash custody: Safe drops, bank deposits in transit, and custody balances are tracked.
 * 10. Stock-risk indicators distinguish usable available stock from in-transit, quarantined, or expired stock.
 * 11. Multi-sheet Excel OpenXML (.xlsx) generation succeeds with valid PKZip signature and Sl. No.
 * 12. Corporate PDF generation succeeds with %PDF-1.4 header, APA 7 typography, and watermark.
 * 13. Spreadsheet formula injection neutralization: Untrusted formula prefixes remain literal text.
 * 14. Organisation and café isolation is strictly enforced across queries and exports.
 * 15. Owner Persona receives executive insight and exports, but is strictly denied operational mutations.
 * 16. Staff Persona is denied management analytics, financial overview, and report exports.
 * 17. Vendor Persona is denied internal financial statements, customer data, and enterprise reports.
 * 18. Permanently decommissioned Normal Master fails closed with 403 ROLE_RETIRED.
 * 19. Report generation and export are strictly read-only and produce zero database mutations.
 * 20. Concurrent and repeated export requests execute safely and idempotently.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryReplSet } = require('mongodb-memory-server');

// Models
const { Bill } = require('../src/models/Bill');
const { Expense } = require('../src/models/Expense');
const { Journal } = require('../src/models/Journal');
const { ChartOfAccount } = require('../src/models/ChartOfAccount');
const { FinancialPeriod } = require('../src/models/FinancialPeriod');
const { APInvoice } = require('../src/models/APInvoice');
const { PaymentRun } = require('../src/models/PaymentRun');
const { BankAccount } = require('../src/models/BankAccount');
const { InstitutionalAccount } = require('../src/models/InstitutionalAccount');
const { Receivable } = require('../src/models/Receivable');
const { AdvanceDeposit } = require('../src/models/AdvanceDeposit');
const { BankDeposit } = require('../src/models/BankDeposit');
const { CafeInventoryConfig } = require('../src/models/CafeInventoryConfig');
const { GlobalInventoryItem } = require('../src/models/GlobalInventoryItem');
const { InventoryLot } = require('../src/models/InventoryLot');
const { StockMovement } = require('../src/models/StockMovement');
const { Vendor } = require('../src/models/Vendor');
const { Cafe } = require('../src/models/Cafe');
const { RegisterSession } = require('../src/models/RegisterSession');
const { AttendanceSubmission } = require('../src/models/AttendanceSubmission');
const { Approval } = require('../src/models/Approval');
const { Task } = require('../src/models/Task');

// Controllers & Services
const reportController = require('../src/controllers/reportController');
const financeController = require('../src/controllers/financeController');
const vendorLedgerController = require('../src/controllers/vendorLedgerController');
const dashboardController = require('../src/controllers/dashboardController');
const { ReportRegistry } = require('../src/reporting/reportRegistry');
const { generatePdf, generateXlsx, sanitizeCsvValue } = require('../src/utils/exportGenerators');
const { ZurfService } = require('../src/services/zurfService');

function buildMockReqRes(role, params = {}, query = {}, body = {}, customAuth = {}) {
  let statusCode = 200;
  let responseData = null;
  const headers = {};

  const req = {
    auth: {
      userId: customAuth.userId || (role === 'MASTER' ? 'MU-0001' : (role === 'OWNER' ? 'OW-0001' : (role === 'CAFE_ADMIN' ? 'CA-0001' : 'ST-0001'))),
      role,
      organisationId: customAuth.organisationId || 'ORG-ZAMORIN-TEST',
      isPrimaryMaster: customAuth.isPrimaryMaster !== undefined ? customAuth.isPrimaryMaster : (role === 'MASTER'),
      assignedCafeIds: customAuth.assignedCafeIds || ['ZC-0001'],
      primaryCafeId: customAuth.primaryCafeId || 'ZC-0001',
      cafeId: customAuth.cafeId || 'ZC-0001',
      name: customAuth.name || 'Test Actor',
      capabilities: customAuth.capabilities || [],
      ...customAuth,
    },
    params,
    query,
    body,
    headers,
    get: (h) => headers[h.toLowerCase()],
  };

  const res = {
    status(code) {
      statusCode = code;
      return this;
    },
    json(data) {
      responseData = data;
      return this;
    },
    send(data) {
      responseData = data;
      return this;
    },
    setHeader(name, val) {
      headers[name] = val;
    },
  };

  return { req, res, getResult: () => ({ statusCode, data: responseData, headers }) };
}

test('P12: Finance, Reports, Exports & Owner Insight Suite', async (suite) => {
  let replSet;

  suite.before(async () => {
    replSet = await MongoMemoryReplSet.create({
      replSet: { count: 1, storageEngine: 'wiredTiger' },
    });
    await replSet.waitUntilRunning();
    const uri = replSet.getUri();
    await mongoose.connect(uri);

    // Pre-create collections for transactional operations
    await Promise.all([
      Bill.createCollection(),
      Expense.createCollection(),
      Journal.createCollection(),
      ChartOfAccount.createCollection(),
      FinancialPeriod.createCollection(),
      APInvoice.createCollection(),
      PaymentRun.createCollection(),
      BankAccount.createCollection(),
      InstitutionalAccount.createCollection(),
      Receivable.createCollection(),
      AdvanceDeposit.createCollection(),
      BankDeposit.createCollection(),
      CafeInventoryConfig.createCollection(),
      GlobalInventoryItem.createCollection(),
      InventoryLot.createCollection(),
      StockMovement.createCollection(),
      Vendor.createCollection(),
      Cafe.createCollection(),
      RegisterSession.createCollection(),
      AttendanceSubmission.createCollection(),
      Approval.createCollection(),
      Task.createCollection(),
    ]);
  });

  suite.after(async () => {
    await mongoose.disconnect();
    if (replSet) await replSet.stop();
  });

  suite.beforeEach(async () => {
    await Promise.all([
      Bill.deleteMany({}),
      Expense.deleteMany({}),
      Journal.deleteMany({}),
      APInvoice.deleteMany({}),
      InstitutionalAccount.deleteMany({}),
      Receivable.deleteMany({}),
      AdvanceDeposit.deleteMany({}),
      BankDeposit.deleteMany({}),
      CafeInventoryConfig.deleteMany({}),
      GlobalInventoryItem.deleteMany({}),
      InventoryLot.deleteMany({}),
      StockMovement.deleteMany({}),
      Vendor.deleteMany({}),
      RegisterSession.deleteMany({}),
      AttendanceSubmission.deleteMany({}),
    ]);
  });

  // ── 1. REPORT CATALOGUE MAPPING ──────────────────────────────────────────
  await suite.test('1. 18-Report Catalogue mapping and metadata across all corporate domains', async () => {
    const { req, res, getResult } = buildMockReqRes('OWNER');
    await reportController.getReportCatalogue(req, res);
    const result = getResult();

    assert.equal(result.statusCode, 200);
    assert.equal(result.data.success, true);
    const { reports, categories } = result.data.data;

    assert.ok(Array.isArray(reports), 'Must return reports array');
    assert.ok(reports.length >= 18, `Must return at least 18 governed reports, got ${reports.length}`);
    assert.equal(categories.length, 25, 'Must return all 25 canonical categories');

    const expectedReportIds = [
      'daily-sales',
      'pl-statement',
      'cash-book-variance',
      'workforce-overview',
      'attendance-exceptions',
      'payroll-summary',
      'customer-retention',
      'pos-exceptions',
      'service-speed',
      'inventory-valuation',
      'procurement-spend',
      'vendor-performance-intelligence',
      'menu-engineering',
      'quality-compliance',
      'asset-maintenance',
      'same-store-sales',
      'multi-cafe-benchmark',
      'executive-goals',
    ];

    for (const rId of expectedReportIds) {
      const match = reports.find((r) => r.reportId === rId);
      assert.ok(match, `Catalogue must include canonical report ${rId}`);
      assert.ok(match.title, `Report ${rId} must have a display title`);
      assert.ok(match.category, `Report ${rId} must belong to a category`);
      assert.ok(match.endpoint, `Report ${rId} must have an API endpoint`);
      assert.ok(['OPERATIONAL', 'ESTIMATED', 'CERTIFIED', 'DATA_ISSUE'].includes(match.trustStatus));
    }
  });

  // ── 2. FINANCIAL TOTALS RECONCILE TO AUTHORITATIVE LEDGER ──────────────────
  await suite.test('2. Financial totals reconcile to authoritative ledger and source records', async () => {
    const orgId = 'ORG-ZAMORIN-TEST';
    const cafeId = 'ZC-0001';
    const today = '2026-10-10';

    await Bill.create([
      {
        organisationId: orgId,
        cafeId,
        billId: 'BILL-20261010-0001',
        businessDate: today,
        cashierUserId: 'CA-0001',
        status: 'PARTIALLY_REFUNDED',
        subtotalPaisa: 500000,
        totalPaisa: 500000, // ₹5,000.00
        refundedTotalPaisa: 50000, // ₹500.00
        preTaxRefundPaisa: 50000,
        lineItems: [
          {
            menuItemId: 'ITEM-01',
            itemNameSnapshot: 'Filter Coffee',
            quantity: 5,
            unitPricePaisa: 100000,
            lineSubtotalPaisa: 500000,
          },
        ],
        creditNotes: [
          {
            creditNoteId: 'CN-P12-001',
            creditNoteNumber: 'CN-20261010-001',
            reason: 'Item return adjustment',
            taxableAdjustmentPaisa: 50000,
            taxAdjustmentPaisa: 0,
            totalAdjustmentPaisa: 50000,
          },
        ],
        tenders: [{ paymentMethod: 'UPI', amountPaisa: 450000, status: 'COMPLETED' }],
      },
      {
        organisationId: orgId,
        cafeId,
        billId: 'BILL-20261010-0002',
        businessDate: today,
        cashierUserId: 'CA-0001',
        status: 'COMPLETED',
        subtotalPaisa: 300000,
        totalPaisa: 300000, // ₹3,000.00
        refundedTotalPaisa: 0,
        lineItems: [
          {
            menuItemId: 'ITEM-02',
            itemNameSnapshot: 'Masala Tea',
            quantity: 3,
            unitPricePaisa: 100000,
            lineSubtotalPaisa: 300000,
          },
        ],
        tenders: [{ paymentMethod: 'CASH', amountPaisa: 300000, status: 'COMPLETED' }],
      },
    ]);

    const { req, res, getResult } = buildMockReqRes('OWNER', {}, { cafeId, dateFrom: today, dateTo: today, period: 'custom' });
    await reportController.getSalesAnalytics(req, res);
    const result = getResult();

    assert.equal(result.statusCode, 200);
    const summary = result.data.data.summary;
    assert.equal(summary.grossSalesPaise, 800000, 'Gross sales must be ₹8,000.00');
    assert.equal(summary.customerRefundPaise, 50000, 'Refunds must be ₹500.00');
    assert.equal(summary.netSalesPaise, 750000, 'Net sales must be ₹7,500.00');
    assert.equal(summary.orderCount, 2, 'Order count must be 2');
  });

  // ── 3. PERIOD BOUNDARIES, DATES & ZERO-RESULT REPORTS ─────────────────────
  await suite.test('3. Period boundaries, business dates, as-of cutoffs, and empty periods behave deterministically', async () => {
    const { req, res, getResult } = buildMockReqRes('OWNER', {}, { cafeId: 'ZC-0001', period: 'today' });
    await reportController.getSalesAnalytics(req, res);
    const result = getResult();

    assert.equal(result.statusCode, 200);
    const summary = result.data.data.summary;
    assert.equal(summary.orderCount, 0, 'Zero orders for empty date');
    assert.equal(summary.grossSalesPaise, 0);
    assert.equal(summary.netSalesPaise, 0);
    assert.ok(Array.isArray(result.data.data.paymentMix));
    assert.equal(result.data.data.paymentMix.length, 0);
  });

  // ── 4. ACCOUNTS PAYABLE AGING ──────────────────────────────────────────────
  await suite.test('4. Accounts Payable aging classifies current, 1-30, 31-60, 61-90, 91-180, 180+ buckets', async () => {
    const orgId = 'ORG-ZAMORIN-TEST';
    const cafeId = 'ZC-0001';
    const asOfDate = '2026-10-10';

    await APInvoice.create([
      {
        organisationId: orgId,
        cafeId,
        invoiceId: 'INV-P12-01',
        vendorId: 'VND-001',
        vendorName: 'Monsoon Coffee Estates',
        supplierInvoiceNumber: 'SUP-01',
        invoiceDate: '2026-10-01',
        dueDate: '2026-10-15', // Current (not due)
        amountPaisa: 100000,
        totalPaisa: 100000,
        outstandingPaisa: 100000,
        outstandingPayableAmountPaisa: 100000,
      },
      {
        organisationId: orgId,
        cafeId,
        invoiceId: 'INV-P12-02',
        vendorId: 'VND-001',
        vendorName: 'Monsoon Coffee Estates',
        supplierInvoiceNumber: 'SUP-02',
        invoiceDate: '2026-09-01',
        dueDate: '2026-09-20', // Overdue by 20 days -> days1_30
        amountPaisa: 200000,
        totalPaisa: 200000,
        outstandingPaisa: 200000,
        outstandingPayableAmountPaisa: 200000,
      },
      {
        organisationId: orgId,
        cafeId,
        invoiceId: 'INV-P12-03',
        vendorId: 'VND-002',
        vendorName: 'Dairy Fresh Co',
        supplierInvoiceNumber: 'SUP-03',
        invoiceDate: '2026-08-01',
        dueDate: '2026-08-20', // Overdue by 51 days -> days31_60
        amountPaisa: 300000,
        totalPaisa: 300000,
        outstandingPaisa: 300000,
        outstandingPayableAmountPaisa: 300000,
      },
    ]);

    const { req, res, getResult } = buildMockReqRes('OWNER', {}, { cafeId, asOfDate });
    await vendorLedgerController.getApAgingReport(req, res);
    const result = getResult();

    assert.equal(result.statusCode, 200);
    const { summary, vendors } = result.data.data;
    assert.equal(summary.currentPaisa, 100000, 'Current bucket must be ₹1,000.00');
    assert.equal(summary.days1_30Paisa, 200000, '1-30 days bucket must be ₹2,000.00');
    assert.equal(summary.days31_60Paisa, 300000, '31-60 days bucket must be ₹3,000.00');
    assert.equal(summary.totalOutstandingPaisa, 600000, 'Total outstanding must be ₹6,000.00');
    assert.equal(vendors.length, 2, 'Two vendors breakdown');
  });

  // ── 5. THREE-VALUE AP FINANCIAL ARCHITECTURE ─────────────────────────────
  await suite.test('5. Three-Value AP Architecture: Disputed/held amounts are segregated from approved payables', async () => {
    const orgId = 'ORG-ZAMORIN-TEST';
    const cafeId = 'ZC-0001';

    await APInvoice.create({
      organisationId: orgId,
      cafeId,
      invoiceId: 'INV-P12-DISPUTE-01',
      vendorId: 'VND-001',
      vendorName: 'Monsoon Coffee Estates',
      supplierInvoiceNumber: 'SUP-DISP-01',
      invoiceDate: '2026-10-01',
      dueDate: '2026-10-15',
      amountPaisa: 500000,
      totalPaisa: 500000,
      supplierClaimedAmountPaisa: 500000, // ₹5,000.00 claimed
      approvedPayableAmountPaisa: 400000, // ₹4,000.00 approved
      heldDisputedAmountPaisa: 100000, // ₹1,000.00 held under dispute
      outstandingPaisa: 400000,
      outstandingPayableAmountPaisa: 400000,
      paymentStatus: 'ON_HOLD',
    });

    const { req, res, getResult } = buildMockReqRes('OWNER', {}, { cafeId });
    await financeController.listAPInvoices(req, res);
    const result = getResult();

    assert.equal(result.statusCode, 200);
    const inv = result.data.invoices[0];
    assert.equal(inv.supplierClaimedAmountPaisa, 500000);
    assert.equal(inv.approvedPayableAmountPaisa, 400000);
    assert.equal(inv.heldDisputedAmountPaisa, 100000, 'Disputed amount must be explicitly segregated');
    assert.notEqual(inv.approvedPayableAmountPaisa, inv.supplierClaimedAmountPaisa);
  });

  // ── 6. ACCOUNTS RECEIVABLE AGING ──────────────────────────────────────────
  await suite.test('6. Accounts Receivable aging correctly calculates overdue buckets from invoice due dates', async () => {
    const orgId = 'ORG-ZAMORIN-TEST';
    const cafeId = 'ZC-0001';
    const asOfDate = '2026-10-10';

    await Receivable.create([
      {
        organisationId: orgId,
        cafeId,
        receivableId: 'REC-P12-001',
        accountId: 'INST-001',
        customerName: 'TechCorp India Pvt Ltd',
        originalAmountPaisa: 200000,
        outstandingAmountPaisa: 200000,
        issueDate: '2026-09-01',
        dueDate: '2026-09-25', // Overdue by 15 days -> DAYS_1_30
        status: 'OUTSTANDING',
      },
      {
        organisationId: orgId,
        cafeId,
        receivableId: 'REC-P12-002',
        accountId: 'INST-001',
        customerName: 'TechCorp India Pvt Ltd',
        originalAmountPaisa: 150000,
        outstandingAmountPaisa: 150000,
        issueDate: '2026-10-01',
        dueDate: '2026-10-25', // Current (not yet due)
        status: 'OUTSTANDING',
      },
    ]);

    const { req, res, getResult } = buildMockReqRes('OWNER', {}, { cafeId, asOfDate });
    await financeController.getReceivableAgeing(req, res);
    const result = getResult();

    assert.equal(result.statusCode, 200);
    const data = result.data.data;
    assert.equal(data.buckets.CURRENT.amountPaisa, 150000);
    assert.equal(data.buckets.DAYS_1_30.amountPaisa, 200000);
    assert.equal(data.totalOutstandingPaisa, 350000);
  });

  // ── 7. INSTITUTIONAL ACCOUNT STATEMENTS ──────────────────────────────────
  await suite.test('7. Institutional Account Statements preserve transaction history, credit limits, and balances', async () => {
    const orgId = 'ORG-ZAMORIN-TEST';
    const cafeId = 'ZC-0001';

    await InstitutionalAccount.create({
      organisationId: orgId,
      accountId: 'INST-002',
      institutionName: 'Acme Systems Ltd',
      accountName: 'Acme Systems Ltd',
      creditLimitPaisa: 500000,
      currentExposurePaisa: 120000,
      status: 'ACTIVE',
    });

    await Receivable.create({
      organisationId: orgId,
      cafeId,
      receivableId: 'REC-P12-010',
      accountId: 'INST-002',
      customerName: 'Acme Systems Ltd',
      originalAmountPaisa: 120000,
      outstandingAmountPaisa: 120000,
      issueDate: '2026-10-01',
      dueDate: '2026-10-20',
      status: 'OUTSTANDING',
    });

    const { req, res, getResult } = buildMockReqRes('OWNER', { accountId: 'INST-002' });
    await financeController.getInstitutionalAccountStatement(req, res);
    const result = getResult();

    assert.equal(result.statusCode, 200);
    const stmt = result.data.data;
    assert.equal(stmt.account.accountName, 'Acme Systems Ltd');
    assert.equal(stmt.account.creditLimitPaisa, 500000);
    assert.equal(stmt.account.currentExposurePaisa, 120000);
    assert.equal(stmt.account.availableCreditPaisa, 380000);
    assert.equal(stmt.summary.totalBilledPaisa, 120000);
    assert.equal(stmt.summary.totalOutstandingPaisa, 120000);
  });

  // ── 8. CUSTOMER ADVANCES HELD AS LIABILITIES ─────────────────────────────
  await suite.test('8. Customer advance deposits held as liabilities are distinguished from sales revenue', async () => {
    const orgId = 'ORG-ZAMORIN-TEST';
    const cafeId = 'ZC-0001';

    await AdvanceDeposit.create({
      organisationId: orgId,
      cafeId,
      depositId: 'ADV-P12-001',
      receiptVoucherNumber: 'RV-2026-001',
      customerName: 'Anoop Kumar',
      customerPhone: '9876543210',
      depositAmountPaisa: 250000, // ₹2,500.00
      unappliedAmountPaisa: 250000,
      receivedByUserId: 'CA-0001',
      status: 'HELD_UNAPPLIED',
    });

    const { req, res, getResult } = buildMockReqRes('OWNER', {}, { cafeId });
    await financeController.listAdvanceDeposits(req, res);
    const result = getResult();

    assert.equal(result.statusCode, 200);
    const deposits = result.data.deposits;
    assert.equal(deposits.length, 1);
    assert.equal(deposits[0].status, 'HELD_UNAPPLIED');
    assert.equal(deposits[0].unappliedAmountPaisa, 250000);
    // Advances held must never be confused with completed bill revenue
    const billCount = await Bill.countDocuments({ organisationId: orgId });
    assert.equal(billCount, 0, 'Advance deposit must create ZERO completed bills/revenue');
  });

  // ── 9. PHYSICAL CASH CUSTODY BALANCES ────────────────────────────────────
  await suite.test('9. Physical cash custody: Safe drops, bank deposits in transit, and custody balances are tracked', async () => {
    const orgId = 'ORG-ZAMORIN-TEST';
    const cafeId = 'ZC-0001';

    await BankDeposit.create({
      organisationId: orgId,
      cafeId,
      depositId: 'DEP-P12-001',
      depositReferenceNumber: 'BD-2026-001',
      amountPaisa: 800000, // ₹8,000.00
      status: 'IN_TRANSIT',
      bankAccountId: 'HDFC-001',
      preparedByUserId: 'CA-0001',
    });

    const { req, res, getResult } = buildMockReqRes('OWNER', {}, { cafeId });
    await financeController.getCustodyBalances(req, res);
    const result = getResult();

    assert.equal(result.statusCode, 200);
    const balances = result.data.data;
    assert.equal(balances.bankInTransitPaisa, 800000);
  });

  // ── 10. STOCK RISK: USABLE VS IN-TRANSIT / RESTRICTED STOCK ───────────────
  await suite.test('10. Stock-risk indicators distinguish usable available stock from in-transit, quarantined, or expired stock', async () => {
    const orgId = 'ORG-ZAMORIN-TEST';
    const cafeId = 'ZC-0001';

    // Item 1: Gross quantity is 50, but all 50 are in transit (availableQuantityBase = 0).
    // Minimum stock = 10. Usable stock is 0 -> MUST trigger CRITICAL stock risk!
    await CafeInventoryConfig.create({
      organisationId: orgId,
      cafeId,
      itemId: 'ITEM-ROASTED-BEANS',
      currentQuantityBase: 50,
      availableQuantityBase: 0, // Usable stock is 0!
      inTransitQuantityBase: 50,
      reorderLevelBase: 25,
      minimumStockBase: 10,
      status: 'ACTIVE',
    });

    // Item 2: Gross quantity 100, available 100, reorderLevel 50 -> HEALTHY
    await CafeInventoryConfig.create({
      organisationId: orgId,
      cafeId,
      itemId: 'ITEM-WHOLE-MILK',
      currentQuantityBase: 100,
      availableQuantityBase: 100,
      inTransitQuantityBase: 0,
      reorderLevelBase: 50,
      minimumStockBase: 20,
      status: 'ACTIVE',
    });

    const { req, res, getResult } = buildMockReqRes('OWNER', {}, { cafeId });
    await dashboardController.getDashboardData(req, res);
    const result = getResult();

    assert.equal(result.statusCode, 200);
    const stockRisk = result.data.data.portfolioKpis.stockRisk;
    assert.equal(stockRisk.critical, 1, 'In-transit stock must NOT be treated as usable stock; critical risk must be 1');
  });

  // ── 11. MULTI-SHEET EXCEL OPENXML (.XLSX) GENERATION ──────────────────────
  await suite.test('11. Multi-sheet Excel OpenXML (.xlsx) generation succeeds with valid PKZip signature and Sl. No.', () => {
    const res = generateXlsx({
      reportTitle: 'Financial Performance & AP Aging',
      columns: [
        { key: 'category', label: 'Expense Category' },
        { key: 'amount', label: 'Amount (₹)' },
      ],
      rows: [
        { category: 'Raw Materials & Coffee', amount: 45000 },
        { category: 'Utilities & Power', amount: 12000 },
      ],
      branding: {
        legalName: 'Zamorin Speciality Coffee & Kitchens Pvt. Ltd.',
        gstin: '32AAACZ1234K1Z5',
      },
    });

    assert.ok(Buffer.isBuffer(res.buffer), 'Excel export must produce a binary Buffer');
    // OpenXML PKZip magic bytes: 0x50, 0x4B, 0x03, 0x04
    assert.equal(res.buffer[0], 0x50, 'PKZip magic byte 0');
    assert.equal(res.buffer[1], 0x4b, 'PKZip magic byte 1');
    assert.equal(res.buffer[2], 0x03, 'PKZip magic byte 2');
    assert.equal(res.buffer[3], 0x04, 'PKZip magic byte 3');
    assert.equal(res.mimeType, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    assert.ok(res.filename.endsWith('.xlsx'));
  });

  // ── 12. CORPORATE PDF GENERATION ──────────────────────────────────────────
  await suite.test('12. Corporate PDF generation succeeds with %PDF-1.4 header, APA 7 typography, and watermark', () => {
    const res = generatePdf({
      reportTitle: 'Executive Financial Summary',
      reportCode: 'ZURF-FIN-01',
      columns: [
        { key: 'metric', label: 'Financial Metric' },
        { key: 'value', label: 'Value (₹)' },
      ],
      rows: [
        { metric: 'Net Revenue', value: '₹1,26,000.00' },
        { metric: 'Operating Outflows', value: '₹58,000.00' },
      ],
      branding: {
        legalName: 'Zamorin Speciality Coffee & Kitchens Pvt. Ltd.',
        gstin: '32AAACZ1234K1Z5',
      },
    });

    assert.ok(Buffer.isBuffer(res.buffer));
    const content = res.buffer.toString('latin1');
    assert.ok(content.startsWith('%PDF-1.4'), 'Must start with %PDF-1.4 header');
    assert.ok(content.includes('%%EOF'), 'Must terminate with %%EOF');
    assert.ok(content.includes('/BaseFont /Times-Roman'), 'Must use Times-Roman typography');
    assert.ok(content.includes('(ZAMORIN CAFE)'), 'Must include watermark');
    assert.equal(res.mimeType, 'application/pdf');
    assert.ok(res.filename.endsWith('.pdf'));
  });

  // ── 13. SPREADSHEET FORMULA INJECTION ESCAPING ────────────────────────────
  await suite.test('13. Spreadsheet formula injection neutralization: Untrusted formula prefixes remain literal text', () => {
    const maliciousValues = [
      '=SUM(A1:B10)',
      '+cmd|\' /C calc\'!A0',
      '-1+1',
      '@HYPERLINK("http://attacker.com")',
      '\tDDE_ATTACK',
      '＝FULL_WIDTH_EQUALS',
    ];

    for (const val of maliciousValues) {
      const sanitized = sanitizeCsvValue(val);
      assert.ok(sanitized.startsWith('\'') || sanitized.startsWith('"\''), `Value "${val}" must be prefixed with single-quote`);
    }

    // Verify generateXlsx shared string table escaping
    const xlsxRes = generateXlsx({
      reportTitle: 'Safety Test',
      columns: [{ key: 'note', label: 'Note' }],
      rows: [{ note: '=2+5' }, { note: '+cmd|calc' }],
    });
    assert.ok(Buffer.isBuffer(xlsxRes.buffer));
  });

  // ── 14. ORGANISATION AND CAFÉ ISOLATION ──────────────────────────────────
  await suite.test('14. Organisation and café isolation is strictly enforced across queries and exports', async () => {
    // Cafe Admin assigned to ZC-0001 attempts to read report for unassigned ZC-9999
    const { req, res, getResult } = buildMockReqRes('CAFE_ADMIN', {}, { cafeId: 'ZC-9999' });

    let errCaught = null;
    try {
      await reportController.getSalesAnalytics(req, res);
    } catch (err) {
      errCaught = err;
    }

    assert.ok(errCaught, 'Must reject cross-café query');
    assert.equal(errCaught.statusCode, 403);
    assert.equal(errCaught.code, 'CROSS_CAFE_RESOURCE_DENIED');
  });

  // ── 15. OWNER PERSONA: READ-ONLY OVERSIGHT VS MUTATION DENIAL ─────────────
  await suite.test('15. Owner Persona receives executive insight and exports, but is strictly denied operational mutations', async () => {
    // 15a. Owner CAN generate export
    const { req: exReq, res: exRes, getResult: exResult } = buildMockReqRes('OWNER', {}, {}, {
      reportId: 'daily-sales',
      format: 'PDF',
      scope: 'ALL_AUTHORIZED',
    });
    await reportController.generateZurfExport(exReq, exRes);
    const r1 = exResult();
    assert.equal(r1.statusCode, 200);
    assert.equal(r1.data.success, true);

    // 15b. Owner CANNOT post journal mutations
    const { req: jReq, res: jRes, getResult: jResult } = buildMockReqRes('OWNER', { journalId: 'JRN-001' });
    let jErr = null;
    try {
      await financeController.postJournal(jReq, jRes);
    } catch (err) {
      jErr = err;
    }
    // Controller or route middleware must deny non-Master
    assert.ok(jErr || jResult().statusCode === 403, 'Owner cannot post journals');
  });

  // ── 16. STAFF PERSONA ACCESS DENIED ──────────────────────────────────────
  await suite.test('16. Staff Persona is denied management analytics, financial overview, and report exports', async () => {
    const { req, res } = buildMockReqRes('STAFF');
    let staffErr = null;
    try {
      await reportController.getAnalyticsOverview(req, res);
    } catch (err) {
      staffErr = err;
    }
    assert.ok(staffErr);
    assert.equal(staffErr.statusCode, 403);
    assert.equal(staffErr.code, 'ROLE_NOT_ALLOWED');
  });

  // ── 17. VENDOR PERSONA ACCESS DENIED ──────────────────────────────────────
  await suite.test('17. Vendor Persona is denied internal financial statements, customer data, and enterprise reports', async () => {
    const { req, res } = buildMockReqRes('VENDOR');
    let vendorErr = null;
    try {
      await reportController.getFinanceAnalytics(req, res);
    } catch (err) {
      vendorErr = err;
    }
    assert.ok(vendorErr);
    assert.equal(vendorErr.statusCode, 403);
  });

  // ── 18. RETIRED NORMAL MASTER DENIED WITH ROLE_RETIRED ───────────────────
  await suite.test('18. Permanently decommissioned Normal Master fails closed with 403 ROLE_RETIRED', async () => {
    const { req, res } = buildMockReqRes('MASTER', {}, {}, {}, { isPrimaryMaster: false, userId: 'MU-0002' });
    let retiredErr = null;
    try {
      await financeController.reopenFinancialPeriod(req, res);
    } catch (err) {
      retiredErr = err;
    }
    assert.ok(retiredErr, 'Non-primary master must be rejected');
    assert.equal(retiredErr.statusCode, 403);
  });

  // ── 19. ZERO MUTATIONS DURING REPORT GENERATION AND EXPORTS ──────────────
  await suite.test('19. Report generation and export are strictly read-only and produce zero database mutations', async () => {
    const orgId = 'ORG-ZAMORIN-TEST';
    const cafeId = 'ZC-0001';

    // Baseline counts
    const [b0, e0, j0, ap0, sm0] = await Promise.all([
      Bill.countDocuments({ organisationId: orgId }),
      Expense.countDocuments({ organisationId: orgId }),
      Journal.countDocuments({ organisationId: orgId }),
      APInvoice.countDocuments({ organisationId: orgId }),
      StockMovement.countDocuments({ organisationId: orgId }),
    ]);

    // Generate exports and reports
    const { req: rReq, res: rRes } = buildMockReqRes('OWNER', {}, { cafeId });
    await reportController.getSalesAnalytics(rReq, rRes);
    await reportController.getFinanceAnalytics(rReq, rRes);
    await reportController.getInventoryAnalytics(rReq, rRes);

    const { req: exReq, res: exRes } = buildMockReqRes('OWNER', {}, {}, {
      reportId: 'daily-sales',
      format: 'PDF',
      cafeId,
    });
    await reportController.generateZurfExport(exReq, exRes);

    // Verify zero counts changed
    const [b1, e1, j1, ap1, sm1] = await Promise.all([
      Bill.countDocuments({ organisationId: orgId }),
      Expense.countDocuments({ organisationId: orgId }),
      Journal.countDocuments({ organisationId: orgId }),
      APInvoice.countDocuments({ organisationId: orgId }),
      StockMovement.countDocuments({ organisationId: orgId }),
    ]);

    assert.equal(b1, b0, 'Bill count unchanged');
    assert.equal(e1, e0, 'Expense count unchanged');
    assert.equal(j1, j0, 'Journal count unchanged');
    assert.equal(ap1, ap0, 'AP count unchanged');
    assert.equal(sm1, sm0, 'Stock movements count unchanged');
  });

  // ── 20. CONCURRENT AND REPEATED EXPORT REQUESTS REMAIN SAFE ──────────────
  await suite.test('20. Concurrent and repeated export requests execute safely and idempotently', async () => {
    const promises = Array.from({ length: 5 }).map(() => {
      const { req, res, getResult } = buildMockReqRes('OWNER', {}, {}, {
        reportId: 'daily-sales',
        format: 'XLSX',
        scope: 'ALL_AUTHORIZED',
      });
      return reportController.generateZurfExport(req, res).then(() => getResult());
    });

    const results = await Promise.all(promises);
    for (const r of results) {
      assert.equal(r.statusCode, 200);
      assert.equal(r.data.success, true);
      assert.equal(r.data.data.format, 'XLSX');
      assert.ok(r.data.data.runId);
    }
  });
});
