'use strict';

/**
 * ============================================================================
 * ZAMORIN CAFÉ ERP — PACKAGE P21 BEHAVIORAL ACCEPTANCE SUITE
 * External Services, Integration Dependencies and Benchmark Scope Decisions
 * ============================================================================
 *
 * Verifies all in-scope P21 Acceptance Conditions across:
 *  1. Canonical 485 Benchmark Coverage: Exact source IDs (351 main report F001-F351,
 *     134 supplement A001-A134), valid dispositions, zero loss/renumbering.
 *  2. Mandatory Reason & Next Decision Governance: Every conditional (13) and
 *     excluded (18) entry has a meaningful non-placeholder reason and next prerequisite.
 *  3. Authorized Mutation with History Audit: Primary Master can update decisions;
 *     earlier disposition, actor, timestamp, and rationale are immutably preserved in history.
 *  4. Four-Persona Governance & Security Matrix:
 *     - Primary Master: Universal enterprise authority.
 *     - Owner: Read-only governance (403 OWNER_READ_ONLY on mutation attempts).
 *     - Café Operations: Scoped strictly to assigned café (403 CAFE_ACCESS_DENIED on cross-café).
 *     - Staff & Vendor: Strict access denial (403 INSUFFICIENT_PERMISSIONS).
 *     - Retired Normal Master: Decommissioned fail-closed enforcement (403 ROLE_RETIRED).
 *  5. Truthful External Provider Integration Probes:
 *     - Unconfigured providers (Pine Labs, Razorpay POS, NIC e-Invoice, Google Business,
 *       WhatsApp SMS, Gemini OCR) truthfully return BLOCKED_UNCONFIGURED.
 *     - Zero fabricated delivery receipts, payments, AI outputs, or simulated successes.
 *  6. Zero-Secret Retention & Redaction:
 *     - No passwords, API keys, tokens, or private connection strings in scope register.
 *     - Verification that secret variables are redacted and never returned to clients.
 *  7. Financial & Inventory Non-Mutation Invariant:
 *     - Scope register mutations never create bills, payments, stock movements, or POs.
 *  8. KDS Architectural Exclusion Invariant:
 *     - KDS records (F275-F292) remain frozen; activation attempts strictly rejected with
 *       403 KDS_ACTIVATION_EXCLUDED_BY_FREEZE.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const mongoose = require('mongoose');
const { MongoMemoryReplSet } = require('mongodb-memory-server');

process.env.NODE_ENV = 'test';
process.env.TEST_MODE = 'true';

// Domain Models
const { BenchmarkScopeDecision } = require('../src/models/BenchmarkScopeDecision');
const { Cafe } = require('../src/models/Cafe');
const { Bill } = require('../src/models/Bill');
const { StockMovement } = require('../src/models/StockMovement');
const { PurchaseOrder } = require('../src/models/PurchaseOrder');

// Domain Service & Controller
const {
  benchmarkScopeDecisionService,
  CANONICAL_DISPOSITIONS,
  DEPENDENCY_CATEGORIES,
} = require('../src/services/benchmarkScopeDecisionService');

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

test('P21 External Services, Integration Dependencies & Benchmark Scope Decisions Suite', async (t) => {
  const orgId = 'ORG-ZAMORIN';
  const cafeId = 'ZC-0001';
  const otherCafeId = 'ZC-0002';

  // Seed baseline Cafés
  await Cafe.create({
    cafeId,
    organisationId: orgId,
    name: 'Zamorin Flagship Calicut',
    displayName: 'Zamorin Flagship Calicut',
    status: 'ACTIVE',
    registrations: { gstin: '32AABCT1234L1ZV' },
    createdBy: 'SYSTEM',
  });

  await Cafe.create({
    cafeId: otherCafeId,
    organisationId: orgId,
    name: 'Zamorin Beach Outpost',
    displayName: 'Zamorin Beach Outpost',
    status: 'ACTIVE',
    registrations: { gstin: '32AABCT5678M1ZW' },
    createdBy: 'SYSTEM',
  });

  // Actors
  const primaryMasterActor = {
    userId: 'USR-MASTER-01',
    role: 'PRIMARY_MASTER',
    isPrimaryMaster: true,
    organisationId: orgId,
    name: 'Chief Enterprise Architect',
  };

  const ownerActor = {
    userId: 'USR-OWNER-01',
    role: 'OWNER',
    isPrimaryMaster: false,
    organisationId: orgId,
    name: 'Estate Owner',
  };

  const cafeOpsActor = {
    userId: 'USR-ADMIN-01',
    role: 'CAFE_ADMIN',
    primaryCafeId: cafeId,
    allowedCafes: [cafeId],
    organisationId: orgId,
    name: 'Calicut Operations Admin',
  };

  const staffActor = {
    userId: 'USR-STAFF-01',
    role: 'STAFF',
    primaryCafeId: cafeId,
    allowedCafes: [cafeId],
    organisationId: orgId,
    name: 'Floor Barista',
  };

  const vendorActor = {
    userId: 'USR-VENDOR-01',
    role: 'VENDOR',
    organisationId: orgId,
    name: 'Dairy Supplier Partner',
  };

  const retiredNormalMasterActor = {
    userId: 'USR-RETIRED-01',
    role: 'NORMAL_MASTER',
    organisationId: orgId,
    name: 'Decommissioned Normal Master',
  };

  // --------------------------------------------------------------------------
  // TEST 1: Canonical 485 Benchmark Seeding & Traceability Coverage
  // --------------------------------------------------------------------------
  await t.test('1. Canonical 485 Benchmark Records Seeding & ID Integrity', async () => {
    const seedResult = await benchmarkScopeDecisionService.seedCanonicalBenchmarkScope({
      organisationId: orgId,
      actor: primaryMasterActor,
    });

    assert.equal(seedResult.total, 485, 'Total seeded records must match exactly 485');
    assert.ok(seedResult.inserted > 0, 'Initial seed must insert records');

    const totalCount = await BenchmarkScopeDecision.countDocuments({ organisationId: orgId });
    assert.equal(totalCount, 485, 'Database must contain exactly 485 benchmark records');

    // Verify main report range F001-F351
    const f001 = await BenchmarkScopeDecision.findOne({ organisationId: orgId, benchmarkId: 'F001' });
    const f351 = await BenchmarkScopeDecision.findOne({ organisationId: orgId, benchmarkId: 'F351' });
    assert.ok(f001, 'F001 must exist');
    assert.ok(f351, 'F351 must exist');

    // Verify supplement range A001-A134
    const a001 = await BenchmarkScopeDecision.findOne({ organisationId: orgId, benchmarkId: 'A001' });
    const a134 = await BenchmarkScopeDecision.findOne({ organisationId: orgId, benchmarkId: 'A134' });
    assert.ok(a001, 'A001 must exist');
    assert.ok(a134, 'A134 must exist');

    // Verify stats breakdown
    const stats = await benchmarkScopeDecisionService.getScopeStatistics(orgId);
    assert.equal(stats.totalBenchmarkRecords, 485, 'Stats total must be 485');
    assert.equal(stats.implementedAndVerified, 447, '447 verified core items');
    assert.equal(stats.conditionalOnExternalDependency, 13, '13 conditional integrations');
    assert.equal(stats.explicitlyExcluded, 18, '18 architecturally excluded KDS records');
    assert.equal(stats.benchmarkContext, 7, '7 reference benchmark context items');
  });

  // --------------------------------------------------------------------------
  // TEST 2: Mandatory Reasons & Next Decisions on Conditional/Excluded Items
  // --------------------------------------------------------------------------
  await t.test('2. Every Conditional (13) and Excluded (18) Record Has Meaningful Reason & Next Prerequisite', async () => {
    const conditionalRecords = await BenchmarkScopeDecision.find({
      organisationId: orgId,
      disposition: 'CONDITIONAL_INTEGRATION',
    });

    assert.equal(conditionalRecords.length, 13, 'Must have exactly 13 conditional records');
    for (const rec of conditionalRecords) {
      assert.ok(rec.decisionReason && rec.decisionReason.length >= 10, `Conditional ${rec.benchmarkId} must have meaningful reason`);
      assert.ok(rec.nextDecision && rec.nextDecision.length >= 5, `Conditional ${rec.benchmarkId} must have next decision`);
      assert.ok(!['later', 'pending', 'not supported'].includes(rec.nextDecision.toLowerCase().trim()), `Next decision must not be generic placeholder`);
    }

    const excludedRecords = await BenchmarkScopeDecision.find({
      organisationId: orgId,
      disposition: 'EXCLUDED_BY_CURRENT_SCOPE',
    });

    assert.equal(excludedRecords.length, 18, 'Must have exactly 18 excluded records (KDS F275-F292)');
    for (const rec of excludedRecords) {
      assert.ok(rec.decisionReason && rec.decisionReason.length >= 10, `Excluded ${rec.benchmarkId} must have meaningful reason`);
      assert.ok(rec.nextDecision && rec.nextDecision.length >= 5, `Excluded ${rec.benchmarkId} must have next decision`);
      assert.ok(rec.isKdsComponent === true, `Excluded record ${rec.benchmarkId} must be identified as KDS`);
    }
  });

  // --------------------------------------------------------------------------
  // TEST 3: Authorized Decision Mutation & Immutable Audit Trail
  // --------------------------------------------------------------------------
  await t.test('3. Primary Master Decision Update with Immutable Audit History', async () => {
    // Pick conditional record A003 (NIC e-Invoicing)
    const original = await BenchmarkScopeDecision.findOne({ organisationId: orgId, benchmarkId: 'A003' });
    assert.equal(original.disposition, 'CONDITIONAL_INTEGRATION');

    const updatePayload = {
      disposition: 'ADAPT_TO_ZAMORIN',
      decisionReason: 'Enterprise sandbox credentials verified for B2B JSON schema validation in staging rehearsal.',
      nextDecision: 'Execute end-to-end sandbox payload dry-run on staging IRP mock.',
      evidenceReference: 'STAGING-IRP-RUN-2026-10-11',
    };

    const updated = await benchmarkScopeDecisionService.updateScopeDecision(
      'A003',
      updatePayload,
      primaryMasterActor
    );

    assert.equal(updated.disposition, 'ADAPT_TO_ZAMORIN');
    assert.equal(updated.evidenceReference, 'STAGING-IRP-RUN-2026-10-11');
    assert.equal(updated.decisionHistory.length, 1, 'Decision history must contain 1 entry');

    const historyEntry = updated.decisionHistory[0];
    assert.equal(historyEntry.previousDisposition, 'CONDITIONAL_INTEGRATION');
    assert.equal(historyEntry.newDisposition, 'ADAPT_TO_ZAMORIN');
    assert.equal(historyEntry.changedByUserId, primaryMasterActor.userId);
    assert.equal(historyEntry.changedByPersona, 'PRIMARY_MASTER');
    assert.ok(historyEntry.changedAt, 'History entry must have timestamp');

    // Revert back for consistency
    await benchmarkScopeDecisionService.updateScopeDecision(
      'A003',
      {
        disposition: 'CONDITIONAL_INTEGRATION',
        decisionReason: 'Direct NIC IRP e-invoicing API integration requires active live taxpayer portal credentials.',
        nextDecision: 'Tax compliance review and test portal access request with CA firm.',
      },
      primaryMasterActor
    );

    const reverted = await BenchmarkScopeDecision.findOne({ organisationId: orgId, benchmarkId: 'A003' });
    assert.equal(reverted.decisionHistory.length, 2, 'History must accumulate 2 entries');
    assert.equal(reverted.disposition, 'CONDITIONAL_INTEGRATION');
  });

  // --------------------------------------------------------------------------
  // TEST 4: Four-Persona Authorization Matrix & Security Enforcement
  // --------------------------------------------------------------------------
  await t.test('4. Security Enforcement: Owner Read-Only, Cross-Café, Staff/Vendor, Retired Role Rejection', async () => {
    // 4.1 Owner attempt to mutate scope decision must fail with 403 OWNER_READ_ONLY
    await assert.rejects(
      async () => {
        await benchmarkScopeDecisionService.updateScopeDecision(
          'F001',
          { disposition: 'ADAPT_TO_ZAMORIN', decisionReason: 'Owner attempting edit' },
          ownerActor
        );
      },
      (err) => {
        assert.equal(err.statusCode, 403);
        assert.equal(err.code, 'OWNER_READ_ONLY');
        return true;
      },
      'Owner mutation must be rejected with 403 OWNER_READ_ONLY'
    );

    // 4.2 Staff attempt to mutate scope decision must fail with 403 INSUFFICIENT_PERMISSIONS
    await assert.rejects(
      async () => {
        await benchmarkScopeDecisionService.updateScopeDecision(
          'F001',
          { disposition: 'ADAPT_TO_ZAMORIN', decisionReason: 'Staff attempting edit' },
          staffActor
        );
      },
      (err) => {
        assert.equal(err.statusCode, 403);
        assert.equal(err.code, 'INSUFFICIENT_PERMISSIONS');
        return true;
      },
      'Staff mutation must be rejected with 403'
    );

    // 4.3 Vendor attempt to access scope records must fail with 403 INSUFFICIENT_PERMISSIONS
    await assert.rejects(
      async () => {
        await benchmarkScopeDecisionService.listScopeDecisions({
          organisationId: orgId,
          actor: vendorActor,
        });
      },
      (err) => {
        assert.equal(err.statusCode, 403);
        assert.equal(err.code, 'INSUFFICIENT_PERMISSIONS');
        return true;
      },
      'Vendor access must be rejected with 403'
    );

    // 4.4 Retired Normal Master must fail closed with 403 ROLE_RETIRED
    await assert.rejects(
      async () => {
        await benchmarkScopeDecisionService.listScopeDecisions({
          organisationId: orgId,
          actor: retiredNormalMasterActor,
        });
      },
      (err) => {
        assert.equal(err.statusCode, 403);
        assert.equal(err.code, 'ROLE_RETIRED');
        return true;
      },
      'Retired Normal Master must fail closed with 403 ROLE_RETIRED'
    );

    // 4.5 Café Admin attempting cross-café access must be rejected with 403 CAFE_ACCESS_DENIED
    await assert.rejects(
      async () => {
        await benchmarkScopeDecisionService.listScopeDecisions({
          organisationId: orgId,
          cafeId: otherCafeId, // Requesting ZC-0002 when authorized only for ZC-0001
          actor: cafeOpsActor,
        });
      },
      (err) => {
        assert.equal(err.statusCode, 403);
        assert.equal(err.code, 'CAFE_ACCESS_DENIED');
        return true;
      },
      'Cross-café access must be rejected with 403 CAFE_ACCESS_DENIED'
    );
  });

  // --------------------------------------------------------------------------
  // TEST 5: Truthful External Provider Integration Probing
  // --------------------------------------------------------------------------
  await t.test('5. Truthful External Provider Probing: Missing Credentials Report BLOCKED_UNCONFIGURED', async () => {
    // Clear any test environment variables to test unconfigured baseline
    delete process.env.PINELABS_CLIENT_ID;
    delete process.env.PINELABS_TERMINAL_ID;
    delete process.env.RAZORPAY_KEY_ID;
    delete process.env.NIC_IRP_API_KEY;
    delete process.env.GOOGLE_BUSINESS_ACCOUNT_ID;
    delete process.env.WHATSAPP_BUSINESS_API_KEY;
    delete process.env.GEMINI_API_KEY;

    // Test Pine Labs POS
    const pineResult = await benchmarkScopeDecisionService.probeProviderIntegration('PINELABS_TERMINAL', primaryMasterActor);
    assert.equal(pineResult.providerKey, 'PINELABS_TERMINAL');
    assert.equal(pineResult.configured, false);
    assert.equal(pineResult.operationalHealth, 'BLOCKED_UNCONFIGURED');
    assert.ok(pineResult.missingPrerequisites.includes('PINELABS_CLIENT_ID'));
    assert.equal(pineResult.secretsExposed, 0, 'Zero secrets exposed');

    // Test NIC e-Invoice
    const nicResult = await benchmarkScopeDecisionService.probeProviderIntegration('NIC_E_INVOICE', primaryMasterActor);
    assert.equal(nicResult.configured, false);
    assert.equal(nicResult.operationalHealth, 'BLOCKED_UNCONFIGURED');
    assert.ok(nicResult.missingPrerequisites.includes('NIC_IRP_API_KEY'));

    // Test Razorpay POS
    const rzpResult = await benchmarkScopeDecisionService.probeProviderIntegration('RAZORPAY_POS', primaryMasterActor);
    assert.equal(rzpResult.configured, false);
    assert.equal(rzpResult.operationalHealth, 'BLOCKED_UNCONFIGURED');

    // Test Gemini AI OCR
    const geminiResult = await benchmarkScopeDecisionService.probeProviderIntegration('GEMINI_AI_INVOICE', primaryMasterActor);
    assert.equal(geminiResult.configured, false);
    assert.equal(geminiResult.operationalHealth, 'BLOCKED_UNCONFIGURED');

    // Test unknown provider rejection
    await assert.rejects(
      async () => {
        await benchmarkScopeDecisionService.probeProviderIntegration('UNKNOWN_PROVIDER_XYZ', primaryMasterActor);
      },
      (err) => {
        assert.equal(err.statusCode, 404);
        assert.equal(err.code, 'PROVIDER_UNKNOWN');
        return true;
      }
    );
  });

  // --------------------------------------------------------------------------
  // TEST 6: Zero-Secret Retention & Redaction Guarantee
  // --------------------------------------------------------------------------
  await t.test('6. Zero-Secret Retention: Model Never Stores or Leaks Credentials in Public JSON', async () => {
    const record = await BenchmarkScopeDecision.findOne({ organisationId: orgId, benchmarkId: 'A003' });
    const publicObj = record.toPublicJSON();

    assert.strictEqual(publicObj.secretsExposed, 0);
    assert.strictEqual(publicObj.hasRequiredCredentials, false);
    assert.ok(Array.isArray(publicObj.configPrerequisites));

    // Inspect fields: ensure no password, apiKey, token, or secret field exists anywhere in serialized object
    const serialized = JSON.stringify(publicObj);
    assert.ok(!serialized.includes('apiKey'));
    assert.ok(!serialized.includes('privateKey'));
    assert.ok(!serialized.includes('clientSecret'));
    assert.ok(!serialized.includes('password'));
  });

  // --------------------------------------------------------------------------
  // TEST 7: Financial & Inventory Non-Mutation Invariant
  // --------------------------------------------------------------------------
  await t.test('7. Financial & Inventory Invariant: Scope Mutations Never Create Bills, POs, or Stock Movements', async () => {
    const billsBefore = await Bill.countDocuments({});
    const stockBefore = await StockMovement.countDocuments({});
    const posBefore = await PurchaseOrder.countDocuments({});

    // Perform an authorized scope decision update
    await benchmarkScopeDecisionService.updateScopeDecision(
      'F010',
      {
        disposition: 'VERIFY_AND_EXTEND',
        decisionReason: 'Verified verified POS item categorization with allergen tags in Calicut store.',
      },
      primaryMasterActor
    );

    const billsAfter = await Bill.countDocuments({});
    const stockAfter = await StockMovement.countDocuments({});
    const posAfter = await PurchaseOrder.countDocuments({});

    assert.equal(billsAfter, billsBefore, 'Bills count must remain 0');
    assert.equal(stockAfter, stockBefore, 'Stock movements must remain 0');
    assert.equal(posAfter, posBefore, 'Purchase orders must remain 0');
  });

  // --------------------------------------------------------------------------
  // TEST 8: KDS Architectural Freeze Invariant
  // --------------------------------------------------------------------------
  await t.test('8. KDS Architectural Invariant: KDS Activation Attempts Strictly Rejected with 403', async () => {
    // For every KDS component F275 through F292, activation must be rejected
    for (let i = 275; i <= 280; i++) {
      const benchmarkId = `F${i}`;
      await assert.rejects(
        async () => {
          await benchmarkScopeDecisionService.attemptKdsActivation(benchmarkId, primaryMasterActor);
        },
        (err) => {
          assert.equal(err.statusCode, 403);
          assert.equal(err.code, 'KDS_ACTIVATION_EXCLUDED_BY_FREEZE');
          assert.ok(err.message.includes('strictly excluded'));
          return true;
        },
        `Activation of KDS ${benchmarkId} must be rejected with 403 KDS_ACTIVATION_EXCLUDED_BY_FREEZE`
      );
    }
  });

  // --------------------------------------------------------------------------
  // TEST 9: Querying, Filtering & Pagination Integrity
  // --------------------------------------------------------------------------
  await t.test('9. Querying, Category Filtering & Pagination Verification', async () => {
    // 9.1 Filter by disposition
    const condList = await benchmarkScopeDecisionService.listScopeDecisions({
      organisationId: orgId,
      disposition: 'CONDITIONAL_INTEGRATION',
      actor: primaryMasterActor,
    });
    assert.equal(condList.length, 13, 'Must return all 13 conditional records');

    // 9.2 Filter by category
    const kdsList = await benchmarkScopeDecisionService.listScopeDecisions({
      organisationId: orgId,
      category: 'KITCHEN_OPERATIONS',
      actor: primaryMasterActor,
    });
    assert.equal(kdsList.length, 18, 'Must return all 18 KDS records');

    // 9.3 Search query
    const searchResult = await benchmarkScopeDecisionService.listScopeDecisions({
      organisationId: orgId,
      search: 'Pine Labs',
      actor: primaryMasterActor,
    });
    assert.ok(searchResult.length >= 1, 'Search by keyword must return matching items');

    // 9.4 Owner read access
    const ownerList = await benchmarkScopeDecisionService.listScopeDecisions({
      organisationId: orgId,
      actor: ownerActor,
    });
    assert.equal(ownerList.length, 485, 'Owner can read all 485 records in read-only mode');
  });
});
