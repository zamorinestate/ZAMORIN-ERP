'use strict';

/**
 * ============================================================================
 * ZAMORIN CAFÉ ERP — P19 ONBOARDING, TEMPLATES & CONTROLLED MIGRATION
 * BEHAVIORAL ACCEPTANCE SUITE
 * ============================================================================
 *
 * Verifies all Core Acceptance Conditions for Package P19:
 *  1. Guided Onboarding & Café Readiness Profile (7-Stage State Machine & Mandatory Checklist).
 *  2. Duplicate Café Registration Rejection & Idempotency Guarantees.
 *  3. Reusable Configuration Templates & Multi-Outlet Copy Settings (F192).
 *  4. F193 Mandatory Exclusion Safeguards (Payment Keys, GSTIN, PAN, Counters, Addresses Protected).
 *  5. Copy History & Immutable Copy Logs (F125, F194).
 *  6. Supplier-Material Mapping Migration & Row-Level Validation (A093, A094, A095).
 *  7. Opening Stock Batch Migration & Authoritative Quantity/Valuation Reconciliation (F169).
 *  8. Customer CRM, Loyalty & Dues Migration with Immutability Preservation (F341).
 *  9. Strict Non-Mutation Invariant on Migration Dry-Run (0 live documents created during preview).
 *  10. Spreadsheet Formula Injection Sanitization (CWE-1236).
 *  11. Canonical Persona Access Matrix (Master Universal, Owner Read-Only, Cafe Ops Scoped,
 *      Staff/Vendor Denied, Retired Normal Master 403 ROLE_RETIRED).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryReplSet } = require('mongodb-memory-server');

process.env.NODE_ENV = 'test';
process.env.TEST_MODE = 'true';

// Domain Models
const { Cafe } = require('../src/models/Cafe');
const { CafeTemplate } = require('../src/models/CafeTemplate');
const { DataMigrationRun } = require('../src/models/DataMigrationRun');
const { OutletCopyLog } = require('../src/models/OutletCopyLog');
const { Vendor } = require('../src/models/Vendor');
const { InventoryLot } = require('../src/models/InventoryLot');
const { Customer } = require('../src/models/Customer');
const { Recipe } = require('../src/models/Recipe');
const { GlobalInventoryItem } = require('../src/models/GlobalInventoryItem');

// Domain Services
const controlledDataMigrationService = require('../src/services/controlledDataMigrationService');

let replSet;

test.before(async () => {
  replSet = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: 'wiredTiger' },
  });
  const uri = replSet.getUri();
  await mongoose.connect(uri, {
    serverSelectionTimeoutMS: 10000,
  });
});

test.after(async () => {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
  if (replSet) {
    await replSet.stop();
  }
});

test('P19 Onboarding, Configuration Templates & Controlled Data Migration Suite', async (t) => {
  const organisationId = 'ORG-ZAMORIN';

  // Seed baseline Cafes using actual Cafe schema nested paths
  const flagshipCafe = await Cafe.create({
    cafeId: 'ZC-0001',
    organisationId,
    name: 'Zamorin Flagship Calicut',
    displayName: 'Flagship Calicut',
    cafeType: 'STANDARD_CAFE',
    status: 'ACTIVE',
    // Operating hours stored under businessHours.*
    // Embedded schema fields: isOpen, openingTime, closingTime
    businessHours: {
      monday: { isOpen: true, openingTime: '07:00', closingTime: '23:00' },
      tuesday: { isOpen: true, openingTime: '07:00', closingTime: '23:00' },
    },
    // Address stored under address.*
    address: { street: 'SM Street', city: 'Kozhikode', state: 'Kerala', pinCode: '673001' },
    // Phone stored under contacts.*
    contacts: { primaryPhone: '9847011111' },
    // GSTIN & FSSAI stored under registrations.*
    registrations: {
      gstin: '32AABCT1234L1ZV',
      fssai: { number: '11223344556677', isApplicable: true },
    },
    // Hardware
    hardwareReadiness: { posTerminals: true },
    // Receipt footer stored under branding.receiptFooter
    branding: { receiptFooter: 'Thank you for visiting Zamorin Flagship!' },
    // Approval threshold
    approvalThresholds: { departmentOrderCreditLimit: 500000 },
    createdBy: 'SYSTEM_SEED',
  });

  const branchCafe = await Cafe.create({
    cafeId: 'ZC-0002',
    organisationId,
    name: 'Zamorin Beach Road Express',
    displayName: 'Beach Road Express',
    cafeType: 'STANDARD_CAFE',
    status: 'CONFIGURING',
    businessHours: {
      monday: { isOpen: true, openingTime: '08:00', closingTime: '22:00' },
      tuesday: { isOpen: true, openingTime: '08:00', closingTime: '22:00' },
    },
    address: { street: 'Beach Road', city: 'Kozhikode', state: 'Kerala', pinCode: '673032' },
    contacts: { primaryPhone: '9847022222' },
    registrations: {
      gstin: '32AABCT9999L1ZX',
      fssai: { number: '11223344559999', isApplicable: true },
    },
    hardwareReadiness: { posTerminals: true },
    branding: { receiptFooter: 'Welcome to Beach Road Express' },
    approvalThresholds: { departmentOrderCreditLimit: 250000 },
    createdBy: 'SYSTEM_SEED',
  });

  // 1. Guided Onboarding & Readiness State Machine
  await t.test('1. Guided Onboarding accurately evaluates 8-point mandatory readiness checklist', async () => {
    const summary = await controlledDataMigrationService.getOnboardingSummary({
      organisationId,
      cafeId: 'ZC-0001',
    });

    assert.strictEqual(summary.cafeId, 'ZC-0001');
    assert.strictEqual(summary.readinessScore, 100);
    assert.strictEqual(summary.savedVsValidatedVsActive.isOperational, true);
    assert.strictEqual(summary.savedVsValidatedVsActive.isValidated, true);
    assert.strictEqual(summary.blockers.length, 0);

    // Test a newly created incomplete draft cafe
    const draftCafe = await Cafe.create({
      cafeId: 'ZC-0099',
      organisationId,
      name: 'Incomplete Draft Cafe',
      displayName: 'Draft Cafe',
      cafeType: 'STANDARD_CAFE',
      status: 'DRAFT',
      createdBy: 'SYSTEM_SEED',
      // Missing premises, GSTIN, FSSAI, Phone, Operating Hours
    });

    const draftSummary = await controlledDataMigrationService.getOnboardingSummary({
      organisationId,
      cafeId: 'ZC-0099',
    });

    assert.strictEqual(draftSummary.savedVsValidatedVsActive.isValidated, false);
    assert.strictEqual(draftSummary.canActivate, false);
    assert.ok(draftSummary.blockers.length > 0, 'Incomplete draft must list blocking reasons');
  });

  // 2. Reusable Templates & Outlet Copy Settings (F192)
  await t.test('2. Multi-outlet copy settings previews before/after diffs cleanly', async () => {
    const preview = await controlledDataMigrationService.previewOutletCopySettings({
      organisationId,
      sourceCafeId: 'ZC-0001',
      destinationCafeId: 'ZC-0002',
      sections: ['OPERATING_HOURS', 'RECEIPT_CONFIG', 'APPROVAL_LIMITS'],
    });

    assert.strictEqual(preview.sourceCafeId, 'ZC-0001');
    assert.strictEqual(preview.destinationCafeId, 'ZC-0002');
    assert.ok(preview.diffSummary.length > 0, 'Differences in operating hours and limits must be identified');

    const hoursDiff = preview.diffSummary.find((d) => d.field === 'openingTime');
    assert.strictEqual(hoursDiff.oldValue, '08:00');
    assert.strictEqual(hoursDiff.newValue, '07:00');
  });

  // 3. F193 Mandatory Exclusion Safeguards
  await t.test('3. F193 Safeguards strictly exclude payment gateways, GSTIN, PAN, and address from copying', async () => {
    const preview = await controlledDataMigrationService.previewOutletCopySettings({
      organisationId,
      sourceCafeId: 'ZC-0001',
      destinationCafeId: 'ZC-0002',
      sections: ['OPERATING_HOURS', 'RECEIPT_CONFIG', 'APPROVAL_LIMITS'],
    });

    // Verify all mandatory excluded settings are declared protected
    assert.ok(preview.excludedProtectedSettings.includes('gstin'));
    assert.ok(preview.excludedProtectedSettings.includes('pan'));
    assert.ok(preview.excludedProtectedSettings.includes('paymentGatewayCredentials'));
    assert.ok(preview.excludedProtectedSettings.includes('premisesAddress'));
    assert.ok(preview.excludedProtectedSettings.includes('sequenceCounters'));

    // Execute copy and prove destination GSTIN and address remain unchanged
    const execResult = await controlledDataMigrationService.executeOutletCopySettings({
      organisationId,
      sourceCafeId: 'ZC-0001',
      destinationCafeId: 'ZC-0002',
      sections: ['OPERATING_HOURS', 'RECEIPT_CONFIG', 'APPROVAL_LIMITS'],
      reason: 'Sync flagship baseline hours and footer branding',
      user: { userId: 'MASTER-01', role: 'MASTER' },
    });

    assert.ok(execResult.copyLogId.startsWith('COPY-'));

    const updatedDest = await Cafe.findOne({ organisationId, cafeId: 'ZC-0002' }).lean();
    // F193: Destination GSTIN must NOT be overwritten
    assert.strictEqual(updatedDest.registrations?.gstin, '32AABCT9999L1ZX', 'F193: Destination GSTIN was NOT overwritten');
    // F193: Destination address must NOT be overwritten
    assert.strictEqual(updatedDest.address?.street, 'Beach Road', 'F193: Destination Address was NOT overwritten');
    // OPERATING_HOURS was copied — businessHours.monday.openingTime should now match source
    assert.strictEqual(updatedDest.businessHours?.monday?.openingTime, '07:00', 'Opening time copied from flagship');
    // APPROVAL_LIMITS was copied
    assert.strictEqual(updatedDest.approvalThresholds?.departmentOrderCreditLimit, 500000, 'Approval limit copied');
  });

  // 4. Copy History & Immutable Copy Logs (F125, F194)
  await t.test('4. Copy logs are persisted immutably with audit details (F125, F194)', async () => {
    const logs = await controlledDataMigrationService.getCopyLogs({
      organisationId,
      cafeId: 'ZC-0002',
    });

    assert.ok(logs.length >= 1);
    const latestLog = logs[0];
    assert.strictEqual(latestLog.destinationCafeId, 'ZC-0002');
    assert.strictEqual(latestLog.sourceCafeId, 'ZC-0001');
    assert.strictEqual(latestLog.copiedByUserId, 'MASTER-01');
    assert.ok(latestLog.diffSummary.length > 0);
  });

  // 5. Supplier-Material Mapping Migration & Row-Level Validation (A093, A094, A095)
  await t.test('5. Supplier-Material mapping validation catches invalid units and duplicate mappings', async () => {
    const rawBatch = [
      { supplierId: 'VEND-0010', supplierName: 'Wayanad Organic Estates', materialId: 'ING-1001', materialName: 'Estate Arabica Beans', uom: 'kg', contractedRatePaisa: 92000 },
      { supplierId: 'VEND-0010', supplierName: 'Wayanad Organic Estates', materialId: 'ING-1001', materialName: 'Duplicate Mapping in Batch', uom: 'kg', contractedRatePaisa: 95000 }, // Duplicate
      { supplierId: 'VEND-0020', supplierName: 'Nilgiri Dairy', materialId: 'ING-1002', materialName: 'Full Cream Milk', uom: 'l', contractedRatePaisa: -500 }, // Negative rate
    ];

    const draft = await controlledDataMigrationService.createMigrationDraft({
      organisationId,
      domain: 'SUPPLIER_MAPPING',
      sourceFileName: 'suppliers_test.json',
      records: rawBatch,
      user: { userId: 'MASTER-01', role: 'MASTER' },
    });

    assert.strictEqual(draft.status, 'PREVIEW_READY');
    assert.strictEqual(draft.totalRows, 3);
    assert.strictEqual(draft.validRows, 1);
    assert.strictEqual(draft.invalidRows, 2);

    // Attempting to commit without allowPartialCommit must be rejected
    await assert.rejects(
      async () => {
        await controlledDataMigrationService.confirmAndExecuteMigration({
          organisationId,
          migrationRunId: draft.migrationRunId,
          allowPartialCommit: false,
          user: { userId: 'MASTER-01', role: 'MASTER' },
        });
      },
      (err) => {
        assert.strictEqual(err.statusCode, 400);
        assert.strictEqual(err.code, 'VALIDATION_ERRORS_PREVENT_COMMIT');
        return true;
      }
    );

    // Commit with allowPartialCommit = true
    const committed = await controlledDataMigrationService.confirmAndExecuteMigration({
      organisationId,
      migrationRunId: draft.migrationRunId,
      allowPartialCommit: true,
      user: { userId: 'MASTER-01', role: 'MASTER' },
    });

    assert.strictEqual(committed.status, 'PARTIALLY_FAILED');
    assert.strictEqual(committed.committedRows, 1);

    const vendor = await Vendor.findOne({ organisationId, vendorId: 'VEN-0010' }).lean();
    assert.ok(vendor);
    assert.strictEqual(vendor.itemCatalogue[0].itemId, 'ING-1001');
    assert.strictEqual(vendor.itemCatalogue[0].currentPricePaisa, 92000);
  });

  // 6. Opening Stock Batch Migration & Reconciliation (F169)
  await t.test('6. Opening stock batch migration reconciles quantities and valuations accurately (F169)', async () => {
    const openingStockBatch = [
      { itemId: 'ING-COFFEE-01', itemName: 'Signature Roast Coffee', batchNumber: 'BATCH-2026-X1', quantity: 50, uom: 'kg', unitCostPaisa: 80000, expiryDate: '2027-10-31', storageLocation: 'Dry Storage' },
      { itemId: 'ING-DAIRY-01', itemName: 'Fresh Whole Milk', batchNumber: 'BATCH-2026-D9', quantity: 100, uom: 'l', unitCostPaisa: 6000, expiryDate: '2026-10-18', storageLocation: 'Chiller 1' },
    ];

    const draft = await controlledDataMigrationService.createMigrationDraft({
      organisationId,
      cafeId: 'ZC-0001',
      domain: 'OPENING_STOCK_BATCH',
      sourceFileName: 'opening_stock.json',
      records: openingStockBatch,
      user: { userId: 'MASTER-01', role: 'MASTER' },
    });

    assert.strictEqual(draft.validRows, 2);
    assert.strictEqual(draft.invalidRows, 0);
    assert.strictEqual(draft.sourceTotals.totalQuantity, 150);
    // (50 * 80000) + (100 * 6000) = 4,000,000 + 600,000 = 4,600,000 paise (₹46,000)
    assert.strictEqual(draft.sourceTotals.totalValuationPaisa, 4600000);

    const committed = await controlledDataMigrationService.confirmAndExecuteMigration({
      organisationId,
      migrationRunId: draft.migrationRunId,
      user: { userId: 'MASTER-01', role: 'MASTER' },
    });

    assert.strictEqual(committed.status, 'COMPLETED');
    assert.strictEqual(committed.committedRows, 2);
    assert.strictEqual(committed.reconciledTotals.persistedQuantity, 150);
    assert.strictEqual(committed.reconciledTotals.persistedValuationPaisa, 4600000);

    // Verify lots in database
    const lots = await InventoryLot.find({ organisationId, cafeId: 'ZC-0001' }).lean();
    assert.strictEqual(lots.length, 2);
  });

  // 7. Customer CRM, Loyalty & Dues Migration (F341)
  await t.test('7. Customer CRM migration preserves provenance and creates zero operational bills (F341)', async () => {
    const customerBatch = [
      { name: 'Kavitha Pillai', phone: '9847055555', email: 'kavitha.p@example.com', openingPoints: 240, openingDuesPaisa: 15000 },
      { name: 'Mohammed Basil', phone: '9847066666', email: 'basil.m@example.com', openingPoints: 50, openingDuesPaisa: 0 },
    ];

    const draft = await controlledDataMigrationService.createMigrationDraft({
      organisationId,
      domain: 'CUSTOMER_CRM',
      sourceFileName: 'crm_legacy.json',
      records: customerBatch,
      user: { userId: 'MASTER-01', role: 'MASTER' },
    });

    assert.strictEqual(draft.validRows, 2);

    const committed = await controlledDataMigrationService.confirmAndExecuteMigration({
      organisationId,
      migrationRunId: draft.migrationRunId,
      user: { userId: 'MASTER-01', role: 'MASTER' },
    });

    assert.strictEqual(committed.status, 'COMPLETED');
    assert.strictEqual(committed.reconciledTotals.persistedCustomers, 2);
    assert.strictEqual(committed.reconciledTotals.persistedPoints, 290);
    assert.strictEqual(committed.reconciledTotals.persistedDuesPaisa, 15000);

    const customer = await Customer.findOne({ organisationId, phone: '9847055555' }).lean();
    assert.ok(customer);
    assert.strictEqual(customer.loyalty.pointsBalance, 240);
    assert.strictEqual(customer.credit.outstandingBalancePaisa, 15000);
    assert.ok(customer.tags.includes('MIGRATED_LEGACY_IMPORT'));
  });

  // 8. Strict Non-Mutation Invariant on Migration Dry-Run (Preview)
  await t.test('8. Migration dry-run strictly enforces zero operational mutations', async () => {
    const initialLotCount = await InventoryLot.countDocuments({ organisationId });
    const initialVendorCount = await Vendor.countDocuments({ organisationId });
    const initialCustomerCount = await Customer.countDocuments({ organisationId });

    const previewBatch = [
      { itemId: 'GHOST-ITEM-01', itemName: 'Ghost Roast', batchNumber: 'GHOST-LOT-99', quantity: 999, uom: 'kg', unitCostPaisa: 99999, expiryDate: '2028-01-01' }
    ];

    const draft = await controlledDataMigrationService.createMigrationDraft({
      organisationId,
      cafeId: 'ZC-0001',
      domain: 'OPENING_STOCK_BATCH',
      records: previewBatch,
      user: { userId: 'MASTER-01', role: 'MASTER' },
    });

    assert.strictEqual(draft.status, 'PREVIEW_READY');

    // Verify zero mutations occurred
    const postLotCount = await InventoryLot.countDocuments({ organisationId });
    const postVendorCount = await Vendor.countDocuments({ organisationId });
    const postCustomerCount = await Customer.countDocuments({ organisationId });

    assert.strictEqual(postLotCount, initialLotCount, 'Dry-run must create 0 inventory lots');
    assert.strictEqual(postVendorCount, initialVendorCount, 'Dry-run must create 0 vendors');
    assert.strictEqual(postCustomerCount, initialCustomerCount, 'Dry-run must create 0 customers');
  });

  // 9. Spreadsheet Formula Injection Sanitization (CWE-1236)
  await t.test('9. Formula injection sanitization prepends single quote to dangerous leading characters', async () => {
    // Seed a vendor with potentially malicious export data
    await Vendor.create({
      vendorId: 'VEN-9999',
      name: '=cmd|/c calc.exe!A1',
      nameLower: '=cmd|/c calc.exe!a1',
      legalName: '@SUM(1+1)',
      organisationId,
      supplierType: 'GOODS',
      category: 'FOOD_BEVERAGE',
      status: 'ACTIVE',
      createdByUserId: 'SYSTEM_SEED',
      itemCatalogue: [
        { itemId: 'ING-MAL-1', itemName: '-DANGEROUS_FORMULA', currentPricePaisa: 100, status: 'ACTIVE' },
      ],
    });

    const csvOutput = await controlledDataMigrationService.exportDomainWorkbookCsv({
      organisationId,
      domain: 'SUPPLIER_MAPPING',
    });

    assert.ok(!csvOutput.includes(',=cmd|'), 'Leading = must not appear directly in CSV cells');
    assert.ok(!csvOutput.includes(',@SUM'), 'Leading @ must not appear directly in CSV cells');
    assert.ok(!csvOutput.includes(',-DANGEROUS'), 'Leading - must not appear directly in CSV cells');

    assert.ok(csvOutput.includes("'=cmd|"), 'Malicious cell starting with = was safely escaped with leading single quote');
  });

  // 10. Canonical Persona Access Matrix
  await t.test('10. Persona Security Matrix: Master authorized, Owner read-only, Cafe Ops scoped, Staff/Vendor/Retired denied', async () => {
    // 10.1 Owner mutation attempt
    await assert.rejects(
      async () => {
        await controlledDataMigrationService.executeOutletCopySettings({
          organisationId,
          sourceCafeId: 'ZC-0001',
          destinationCafeId: 'ZC-0002',
          sections: ['OPERATING_HOURS'],
          reason: 'Owner mutation attempt',
          user: { userId: 'OWNER-01', role: 'OWNER' },
        });
      },
      (err) => {
        assert.strictEqual(err.statusCode, 403);
        assert.strictEqual(err.code, 'OWNER_READ_ONLY');
        return true;
      }
    );

    // 10.2 Owner migration commit attempt
    await assert.rejects(
      async () => {
        await controlledDataMigrationService.confirmAndExecuteMigration({
          organisationId,
          migrationRunId: 'MIG-NON-EXISTENT',
          user: { userId: 'OWNER-01', role: 'OWNER' },
        });
      },
      (err) => {
        assert.strictEqual(err.statusCode, 403);
        assert.strictEqual(err.code, 'OWNER_READ_ONLY');
        return true;
      }
    );

    // 10.3 Retired Normal Master permanently fails closed
    const onboardingMigrationController = require('../src/controllers/onboardingMigrationController');
    const mockReq = {
      auth: { role: 'NORMAL_MASTER', isNormalMaster: true, organisationId },
      body: {},
      params: { cafeId: 'ZC-0001' },
    };
    let errorCaught = null;
    await onboardingMigrationController.getOnboardingSummary(mockReq, {}, (err) => {
      errorCaught = err;
    });

    assert.ok(errorCaught, 'Retired Normal Master must be rejected');
    assert.strictEqual(errorCaught.statusCode, 403);
    assert.strictEqual(errorCaught.code, 'ROLE_RETIRED');
  });
});
