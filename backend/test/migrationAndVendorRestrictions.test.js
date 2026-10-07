'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const { User } = require('../src/models/User');
const { Vendor } = require('../src/models/Vendor');
const { PurchaseOrder } = require('../src/models/PurchaseOrder');
const { VendorLedgerEntry } = require('../src/models/VendorLedgerEntry');
const { retireNormalMasterAccounts } = require('../src/scripts/retireNormalMasterAccounts');
const { rollbackNormalMasterMigration } = require('../src/scripts/rollbackNormalMasterMigration');
const { requireVendor, blockVendorMutation, authorize } = require('../src/middleware/authorize');
const authService = require('../src/services/authService');

const ORG = 'ORG-ZAMORIN-CORRECTIONS';

function createTestUser(attrs) {
  return User.create({
    createdBy: 'TEST',
    passwordHash: '$2b$10$abcdefghijklmnopqrstuu',
    accountStatus: 'ACTIVE',
    ...attrs,
  });
}

test('ZAMORIN CAFÉ ERP — FOUNDATION CORRECTIONS & VENDOR ISOLATION VERIFICATION SUITE', async (t) => {
  let mongoServer;

  t.before(async () => {
    mongoServer = await MongoMemoryServer.create();
    const uri = mongoServer.getUri();
    await mongoose.connect(uri, { autoIndex: true });
  });

  t.after(async () => {
    await mongoose.disconnect();
    if (mongoServer) {
      await mongoServer.stop();
    }
  });

  // ── SECTION 1: Migration Safety, Invariants & Recovery Procedures ─────────

  await t.test('1.1 Migration dry-run reports planned changes without mutating database', async () => {
    await mongoose.connection.db.collection('users').insertOne({
      userId: 'MU-9001',
      organisationId: ORG,
      name: 'Legacy Active Normal Master',
      email: 'active.nm@test.com',
      role: 'MASTER',
      isPrimaryMaster: false,
      accountStatus: 'ACTIVE',
      statusReason: 'PRE_MIGRATION_ACTIVE_SIMULATION',
      createdBy: 'LEGACY_BOOTSTRAP',
      passwordHash: '$2b$10$abcdefghijklmnopqrstuu',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const dryRunReport = await retireNormalMasterAccounts(mongoose, {
      dryRun: true,
      migrationRunId: 'TEST-DRY-RUN-001',
    });

    assert.equal(dryRunReport.dryRun, true);
    assert.equal(dryRunReport.totalFound, 1);
    assert.equal(dryRunReport.accounts[0].dryRun, true);

    const doc = await User.findOne({ userId: 'MU-9001' }).lean();
    assert.equal(doc.statusReason, 'PRE_MIGRATION_ACTIVE_SIMULATION');
    assert.equal(doc.migrationMetadata?.retireNormalMaster, undefined);
  });

  await t.test('1.2 Live migration decommissions Normal Master and records pre-change snapshot', async () => {
    const runId = 'TEST-RUN-LIVE-001';
    const report = await retireNormalMasterAccounts(mongoose, {
      dryRun: false,
      migrationRunId: runId,
    });

    assert.equal(report.dryRun, false);
    assert.equal(report.totalFound, 1);

    const doc = await User.findOne({ userId: 'MU-9001' }).lean();
    assert.equal(doc.accountStatus, 'DISABLED');
    assert.equal(doc.statusReason, 'ROLE_RETIRED_NORMAL_MASTER');
    assert.equal(doc.migrationMetadata.retireNormalMaster.migrationRunId, runId);
    assert.equal(doc.migrationMetadata.retireNormalMaster.preChangeSnapshot.role, 'MASTER');
  });

  await t.test('1.3 Repeated migration execution is completely idempotent', async () => {
    const report2 = await retireNormalMasterAccounts(mongoose, {
      dryRun: false,
      migrationRunId: 'TEST-RUN-LIVE-002',
    });

    assert.equal(report2.totalFound, 1);
    assert.equal(report2.alreadyDisabled, 1);
    assert.equal(report2.accountsDisabled, 0);
  });

  await t.test('1.4 Migration preserves Primary Master, Owner, Staff, and Vendor untouched', async () => {
    const pm = await createTestUser({
      userId: 'MU-0001',
      organisationId: ORG,
      name: 'Primary Master Admin',
      email: 'pm@test.com',
      role: 'MASTER',
      isPrimaryMaster: true,
      accountStatus: 'ACTIVE',
    });

    const owner = await createTestUser({
      userId: 'OW-0001',
      organisationId: ORG,
      name: 'Owner Account',
      email: 'owner@test.com',
      role: 'OWNER',
      accountStatus: 'ACTIVE',
    });

    const staff = await createTestUser({
      userId: 'ST-0001',
      organisationId: ORG,
      name: 'Staff Account',
      email: 'staff@test.com',
      role: 'STAFF',
      accountStatus: 'ACTIVE',
    });

    await Vendor.create({
      vendorId: 'VEN-0001',
      organisationId: ORG,
      name: 'Spice Supplies Ltd',
      nameLower: 'spice supplies ltd',
      category: 'FOOD_BEVERAGE',
      createdByUserId: 'MU-0001',
      status: 'ACTIVE',
    });

    const vendorUser = await createTestUser({
      userId: 'VU-0001',
      organisationId: ORG,
      name: 'Vendor Account',
      email: 'vendor@test.com',
      role: 'VENDOR',
      vendorId: 'VEN-0001',
      accountStatus: 'ACTIVE',
    });

    const report = await retireNormalMasterAccounts(mongoose, {
      dryRun: false,
      migrationRunId: 'TEST-RUN-OTHER-ROLES',
    });

    // None of PM, Owner, Staff, or Vendor should be touched
    const pmCheck = await User.findOne({ userId: 'MU-0001' }).lean();
    assert.equal(pmCheck.accountStatus, 'ACTIVE');
    assert.equal(pmCheck.migrationMetadata?.retireNormalMaster, undefined);

    const ownerCheck = await User.findOne({ userId: 'OW-0001' }).lean();
    assert.equal(ownerCheck.accountStatus, 'ACTIVE');

    const staffCheck = await User.findOne({ userId: 'ST-0001' }).lean();
    assert.equal(staffCheck.accountStatus, 'ACTIVE');

    const vendorCheck = await User.findOne({ userId: 'VU-0001' }).lean();
    assert.equal(vendorCheck.accountStatus, 'ACTIVE');
  });

  await t.test('1.5 Rollback procedure blocks revival of retired Normal Master to ACTIVE status', async () => {
    // Attempt to rollback the migration run
    const rollbackReport = await rollbackNormalMasterMigration(mongoose, {
      migrationRunId: 'TEST-RUN-LIVE-001',
      dryRun: false,
    });

    assert.equal(rollbackReport.totalFound, 1);
    assert.equal(rollbackReport.accountsSkippedSecurityInvariant, 1);
    assert.equal(rollbackReport.accountsRestored, 0);

    const doc = await User.findOne({ userId: 'MU-9001' }).lean();
    assert.equal(doc.accountStatus, 'DISABLED');
    assert.notEqual(doc.role, 'OWNER'); // Must NEVER assign OWNER!
    assert.equal(doc.role, 'MASTER');
  });

  await t.test('1.6 Legacy retired records remain readable and archivable via Mongoose model methods', async () => {
    const retired = await User.findOne({ userId: 'MU-9001' });
    assert.ok(retired);
    assert.equal(retired.role, 'MASTER');
    assert.equal(retired.isPrimaryMaster, false);

    // Can update archival notes safely without validation failure
    retired.preferredName = 'Archived Former Master';
    await retired.save();

    const reloaded = await User.findOne({ userId: 'MU-9001' }).lean();
    assert.equal(reloaded.preferredName, 'Archived Former Master');

    // Attempting to make it ACTIVE fails schema validation
    retired.accountStatus = 'ACTIVE';
    await assert.rejects(
      async () => {
        await retired.save();
      },
      (err) => err.name === 'ValidationError' && err.message.includes('retired')
    );
  });

  // ── SECTION 2: Vendor Role Verification & Horizontal Isolation ────────────

  let vendorAUser, vendorBUser, vendorA, vendorB;
  let poVendorA_Issued, poVendorA_Draft, poVendorB_Issued;

  t.before(async () => {
    vendorA = await Vendor.create({
      vendorId: 'VEN-1001',
      organisationId: ORG,
      name: 'Alpha Spices',
      nameLower: 'alpha spices',
      category: 'FOOD_BEVERAGE',
      createdByUserId: 'MU-0001',
      legalBusinessName: 'Alpha Spices Private Limited',
      status: 'ACTIVE',
      gstin: '32ABCDE1234F1Z5',
      pan: 'ABCDE1234F',
    });

    vendorB = await Vendor.create({
      vendorId: 'VEN-2002',
      organisationId: ORG,
      name: 'Beta Packaging',
      nameLower: 'beta packaging',
      category: 'PACKAGING',
      createdByUserId: 'MU-0001',
      legalBusinessName: 'Beta Packaging LLP',
      status: 'ACTIVE',
      gstin: '32VWXYZ9876G1Z2',
      pan: 'VWXYZ9876G',
    });

    vendorAUser = await createTestUser({
      userId: 'VU-1001',
      organisationId: ORG,
      name: 'Alpha Contact',
      email: 'contact@alpha.test',
      role: 'VENDOR',
      vendorId: 'VEN-1001',
      accountStatus: 'ACTIVE',
    });

    vendorBUser = await createTestUser({
      userId: 'VU-2002',
      organisationId: ORG,
      name: 'Beta Contact',
      email: 'contact@beta.test',
      role: 'VENDOR',
      vendorId: 'VEN-2002',
      accountStatus: 'ACTIVE',
    });

    // Issued PO for Vendor A
    poVendorA_Issued = await PurchaseOrder.create({
      purchaseOrderId: 'PO-2026-A1',
      organisationId: ORG,
      cafeId: 'CAFE-01',
      vendorId: 'VEN-1001',
      createdByUserId: 'MU-0001',
      status: 'APPROVED',
      totalPaisa: 500000,
      subtotalPaisa: 450000,
      taxPaisa: 50000,
      lineItems: [
        {
          itemId: 'ITEM-CARDAMOM',
          itemNameSnapshot: 'Green Cardamom 1kg',
          orderedQuantityBase: 5,
          unitPricePaisa: 90000,
          totalLinePaisa: 450000,
        },
      ],
      grnReceipts: [
        {
          grnId: 'GRN-A1-001',
          receivedAt: new Date(),
          receivedByUserId: 'ST-0001',
          items: [{ itemId: 'ITEM-CARDAMOM', deliveredQty: 5, acceptedQty: 5 }],
        },
      ],
    });

    // Internal Draft PO for Vendor A (should NOT be visible to vendor)
    poVendorA_Draft = await PurchaseOrder.create({
      purchaseOrderId: 'PO-2026-A-DRAFT',
      organisationId: ORG,
      cafeId: 'CAFE-01',
      vendorId: 'VEN-1001',
      createdByUserId: 'MU-0001',
      status: 'DRAFT',
      totalPaisa: 200000,
      subtotalPaisa: 200000,
      taxPaisa: 0,
      lineItems: [
        {
          itemId: 'ITEM-CARDAMOM',
          itemNameSnapshot: 'Green Cardamom 1kg',
          orderedQuantityBase: 2,
          unitPricePaisa: 100000,
          totalLinePaisa: 200000,
        },
      ],
    });

    // Issued PO for Vendor B
    poVendorB_Issued = await PurchaseOrder.create({
      purchaseOrderId: 'PO-2026-B1',
      organisationId: ORG,
      cafeId: 'CAFE-02',
      vendorId: 'VEN-2002',
      createdByUserId: 'MU-0001',
      status: 'APPROVED',
      totalPaisa: 350000,
      subtotalPaisa: 350000,
      taxPaisa: 0,
      lineItems: [
        {
          itemId: 'ITEM-BOXES',
          itemNameSnapshot: 'Packaging Boxes',
          orderedQuantityBase: 100,
          unitPricePaisa: 3500,
          totalLinePaisa: 350000,
        },
      ],
    });

    // Ledger statements
    await VendorLedgerEntry.create({
      ledgerEntryId: 'VLE-A1-001',
      organisationId: ORG,
      vendorId: 'VEN-1001',
      entryDate: '2026-10-07',
      entryType: 'VENDOR_BILL',
      referenceType: 'PURCHASE_ORDER',
      referenceId: 'PO-2026-A1',
      debitPaisa: 0,
      creditPaisa: 500000,
      runningBalancePaisa: 500000,
      createdByUserId: 'MU-0001',
    });

    await VendorLedgerEntry.create({
      ledgerEntryId: 'VLE-B1-001',
      organisationId: ORG,
      vendorId: 'VEN-2002',
      entryDate: '2026-10-07',
      entryType: 'VENDOR_BILL',
      referenceType: 'PURCHASE_ORDER',
      referenceId: 'PO-2026-B1',
      debitPaisa: 0,
      creditPaisa: 350000,
      runningBalancePaisa: 350000,
      createdByUserId: 'MU-0001',
    });
  });

  await t.test('2.1 requireVendor validates existence of vendor in organisation', async () => {
    // Valid vendor A
    let nextCalled = false;
    const req = {
      method: 'GET',
      auth: {
        userId: 'VU-1001',
        role: 'VENDOR',
        vendorId: 'VEN-1001',
        organisationId: ORG,
      },
    };
    const res = {
      status: (code) => ({
        json: (data) => ({ code, data }),
      }),
    };

    await requireVendor(req, res, () => {
      nextCalled = true;
    });
    assert.equal(nextCalled, true);
  });

  await t.test('2.2 requireVendor rejects non-existent or cross-organisation vendorId', async () => {
    let errorCode = null;
    const req = {
      method: 'GET',
      auth: {
        userId: 'VU-9999',
        role: 'VENDOR',
        vendorId: 'VEN-NON-EXISTENT',
        organisationId: ORG,
      },
    };
    const res = {
      status: (code) => ({
        json: (data) => {
          errorCode = data?.error?.code;
        },
      }),
    };

    await requireVendor(req, res, () => {});
    assert.equal(errorCode, 'VENDOR_NOT_FOUND');
  });

  await t.test('2.3 requireVendor rejects suspended or inactive vendor', async () => {
    await Vendor.create({
      vendorId: 'VEN-0999',
      organisationId: ORG,
      name: 'Blocked Supplier',
      nameLower: 'blocked supplier',
      category: 'OTHER',
      createdByUserId: 'MU-0001',
      status: 'SUSPENDED',
    });

    let errorCode = null;
    const req = {
      method: 'GET',
      auth: {
        userId: 'VU-BLOCKED',
        role: 'VENDOR',
        vendorId: 'VEN-0999',
        organisationId: ORG,
      },
    };
    const res = {
      status: (code) => ({
        json: (data) => {
          errorCode = data?.error?.code;
        },
      }),
    };

    await requireVendor(req, res, () => {});
    assert.equal(errorCode, 'VENDOR_INACTIVE');
  });

  await t.test('2.4 requireVendor blocks any mutation method (POST, PUT, PATCH, DELETE)', async () => {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      let errorCode = null;
      let statusSent = null;
      const req = {
        method,
        auth: {
          userId: 'VU-1001',
          role: 'VENDOR',
          vendorId: 'VEN-1001',
          organisationId: ORG,
        },
      };
      const res = {
        status: (code) => {
          statusSent = code;
          return {
            json: (data) => {
              errorCode = data?.error?.code;
            },
          };
        },
      };

      await requireVendor(req, res, () => {});
      assert.equal(statusSent, 403, `Method ${method} should be blocked with 403`);
      assert.equal(errorCode, 'VENDOR_READ_ONLY', `Method ${method} should have code VENDOR_READ_ONLY`);
    }
  });

  await t.test('2.5 Horizontal Isolation: Vendor A cannot access Vendor B purchase order', async () => {
    const { getOrderDetail } = require('../src/controllers/vendorPortalController');

    let errorThrown = null;
    const req = {
      auth: {
        userId: 'VU-1001',
        role: 'VENDOR',
        vendorId: 'VEN-1001',
        organisationId: ORG,
      },
      params: { purchaseOrderId: 'PO-2026-B1' }, // Belongs to Vendor B!
    };
    const res = {};
    const next = (err) => {
      errorThrown = err;
    };

    await getOrderDetail(req, res, next);
    assert.ok(errorThrown);
    assert.equal(errorThrown.statusCode, 403);
    assert.equal(errorThrown.code, 'ACCESS_DENIED');
  });

  await t.test('2.6 Draft Isolation: Vendor A cannot view internal draft purchase orders', async () => {
    const { getOrderDetail } = require('../src/controllers/vendorPortalController');

    let errorThrown = null;
    const req = {
      auth: {
        userId: 'VU-1001',
        role: 'VENDOR',
        vendorId: 'VEN-1001',
        organisationId: ORG,
      },
      params: { purchaseOrderId: 'PO-2026-A-DRAFT' }, // Draft status
    };
    const res = {};
    const next = (err) => {
      errorThrown = err;
    };

    await getOrderDetail(req, res, next);
    assert.ok(errorThrown);
    assert.equal(errorThrown.statusCode, 404);
    assert.equal(errorThrown.code, 'ORDER_NOT_ISSUED');
  });

  await t.test('2.7 Vendor A can read their own issued purchase order and statement', async () => {
    const { getOrderDetail, getVendorStatements } = require('../src/controllers/vendorPortalController');

    let responseData = null;
    const req = {
      auth: {
        userId: 'VU-1001',
        role: 'VENDOR',
        vendorId: 'VEN-1001',
        organisationId: ORG,
      },
      params: { purchaseOrderId: 'PO-2026-A1' },
    };
    const res = {
      status: (code) => ({
        json: (payload) => {
          responseData = payload?.data;
        },
      }),
    };
    const next = (err) => {
      if (err) throw err;
    };

    await getOrderDetail(req, res, next);
    assert.ok(responseData);
    assert.equal(responseData.purchaseOrderId, 'PO-2026-A1');
    assert.equal(responseData.lineItems.length, 1);
    assert.equal(responseData.deliveries.length, 1);

    // Read statement
    let statementData = null;
    const resStmt = {
      status: (code) => ({
        json: (payload) => {
          statementData = payload?.data;
        },
      }),
    };
    await getVendorStatements(req, resStmt, next);
    assert.ok(statementData);
    assert.equal(statementData.length, 1);
    assert.equal(statementData[0].documentReference, 'PO-2026-A1');
  });

  await t.test('2.8 Vendor calling internal routes guarded by authorize() receives 403', async () => {
    const internalGuard = authorize('PROCUREMENT_READ', {
      allowedRoles: ['MASTER', 'OWNER', 'CAFE_ADMIN'],
    });

    let errorCode = null;
    const req = {
      method: 'GET',
      auth: {
        userId: 'VU-1001',
        role: 'VENDOR',
        vendorId: 'VEN-1001',
        organisationId: ORG,
      },
    };
    const res = {
      status: (code) => ({
        json: (data) => {
          errorCode = data?.error?.code;
        },
      }),
    };

    await internalGuard(req, res, () => {});
    assert.equal(errorCode, 'ROLE_NOT_ALLOWED');
  });

  await t.test('2.9 Vendor mutation on internal role-guarded route receives VENDOR_READ_ONLY', async () => {
    const internalRoleGuard = authorize(['CAFE_ADMIN', 'STAFF']);

    let errorCode = null;
    let statusSent = null;
    const req = {
      method: 'POST',
      auth: {
        userId: 'VU-1001',
        role: 'VENDOR',
        vendorId: 'VEN-1001',
        organisationId: ORG,
      },
    };
    const res = {
      status: (code) => {
        statusSent = code;
        return {
          json: (data) => {
            errorCode = data?.error?.code;
          },
        };
      },
    };

    await internalRoleGuard(req, res, () => {});
    assert.equal(statusSent, 403);
    assert.equal(errorCode, 'VENDOR_READ_ONLY');
  });
});
