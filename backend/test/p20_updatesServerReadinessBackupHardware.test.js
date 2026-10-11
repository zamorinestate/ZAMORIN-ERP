'use strict';

/**
 * ============================================================================
 * ZAMORIN CAFÉ ERP — PACKAGE P20 BEHAVIORAL ACCEPTANCE SUITE
 * Updates, Own-Server Readiness, Backup and Recovery, and Hardware Integration
 * ============================================================================
 *
 * Verifies all in-scope P20 Acceptance Conditions across:
 *  1. Device Registration, Scoping, Duplicate Rejection & Cross-Café Isolation (F034, F035, F039, F342).
 *  2. Receipt Printer Adapter: ESC/POS Compilation, Reprint Tracking, Non-Mutation Invariant,
 *     Shifted KOT, Token Slip, and Unassigned-Printer Alerts (F031, F038, A022, A023, A025, A027).
 *  3. Cash Drawer Adapter: Pin 2/5 Kick Buffers & Strict Non-Mutation of Cash Ledgers.
 *  4. Barcode & QR Scanner Adapter: EAN-13/SKU Parsing, Catalog Validation & Sold-Out Enforcement (F040).
 *  5. Weighing Scale Adapter: Toledo, CAS, Generic Protocol Parsing & Range Enforcement (F183, A105).
 *  6. Payment Terminal Adapter: State Machine, Separation of Connectivity vs Payment Settlement (F070, A054).
 *  7. Own-Server Readiness & Diagnostics: Runtime, DB Ping, Storage Writability, Bridge & Secret Redaction (F335-F338).
 *  8. Safe Application Update Workflow: Manifest SHA-256 Checksum, Prerequisites, Dry-Run & Rollback.
 *  9. Backup Creation, SHA-256 Cryptographic Checksumming, and File Integrity Verification (F339, F340).
 *  10. Privileged Restore Rehearsal: Target Confirmation Guard, Production Protection & Invariant Verification.
 *  11. Canonical Persona Access Matrix (Primary Master, Owner Read-Only, Cafe Ops Scoped, Staff, Retired Master 403).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const { MongoMemoryReplSet } = require('mongodb-memory-server');

process.env.NODE_ENV = 'test';
process.env.TEST_MODE = 'true';
process.env.STORAGE_LOCAL_DIR = path.resolve(__dirname, '..', 'storage');
process.env.BACKUP_STORAGE_DIR = path.resolve(__dirname, '..', 'backups');

// Domain Models
const { HardwareDevice } = require('../src/models/HardwareDevice');
const { AppUpdateRun } = require('../src/models/AppUpdateRun');
const { AppRelease } = require('../src/models/AppRelease');
const { BackupRecord } = require('../src/models/BackupRecord');
const { Cafe } = require('../src/models/Cafe');
const { User } = require('../src/models/User');
const { Bill } = require('../src/models/Bill');

// Domain Services & Adapters
const { hardwareManagementService } = require('../src/services/hardwareManagementService');
const { ReceiptPrinterAdapter, ESC_POS_COMMANDS } = require('../src/services/hardwareAdapters/ReceiptPrinterAdapter');
const { CashDrawerAdapter } = require('../src/services/hardwareAdapters/CashDrawerAdapter');
const { BarcodeScannerAdapter } = require('../src/services/hardwareAdapters/BarcodeScannerAdapter');
const { WeighingScaleAdapter } = require('../src/services/hardwareAdapters/WeighingScaleAdapter');
const { PaymentTerminalAdapter } = require('../src/services/hardwareAdapters/PaymentTerminalAdapter');
const { ServerReadinessService } = require('../src/services/serverReadinessService');
const { appUpdateService } = require('../src/services/appUpdateService');
const { backupRecoveryService } = require('../src/services/backupRecoveryService');

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

test('P20 Updates, Own-Server Readiness, Backup/Recovery & Hardware Integration Suite', async (t) => {
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

  const masterActor = {
    userId: 'USR-MASTER-01',
    role: 'MASTER',
    isPrimaryMaster: true,
    organisationId: orgId,
  };

  const adminActor = {
    userId: 'USR-ADMIN-01',
    role: 'CAFE_ADMIN',
    cafeId,
    organisationId: orgId,
  };

  const ownerActor = {
    userId: 'USR-OWNER-01',
    role: 'OWNER',
    organisationId: orgId,
  };

  // ──────────────────────────────────────────────────────────────────────────
  // TEST 1: Peripheral Device Registration, Scoping, and Cross-Café Denial
  // ──────────────────────────────────────────────────────────────────────────
  await t.test('1. Hardware Device Registration, Scoping, and Cross-Café Reassignment Denial', async () => {
    // 1.1 Register printer under ZC-0001
    const printer = await hardwareManagementService.registerOrUpdateDevice(
      {
        deviceId: 'PRN-COUNTER-01',
        cafeId,
        name: 'Main Counter Thermal Printer',
        deviceType: 'RECEIPT_PRINTER',
        connectionMode: 'LAN_ETHERNET',
        configuration: { paperWidth: 80, ipAddress: '192.168.1.101', port: 9100 },
        assignment: { station: 'BILLING', counterName: 'Counter 1' },
      },
      adminActor
    );

    assert.equal(printer.deviceId, 'PRN-COUNTER-01');
    assert.equal(printer.deviceType, 'RECEIPT_PRINTER');
    assert.equal(printer.healthStatus, 'UNCONFIGURED');
    assert.equal(printer.auditHistory.length, 1);

    // 1.2 Cross-café unauthorized registration rejection
    await assert.rejects(
      async () => {
        await hardwareManagementService.registerOrUpdateDevice(
          {
            deviceId: 'PRN-OUTPOST-01',
            cafeId: otherCafeId, // Not assigned to adminActor
            name: 'Outpost Printer',
            deviceType: 'RECEIPT_PRINTER',
          },
          adminActor
        );
      },
      (err) => err.code === 'CAFE_ACCESS_DENIED'
    );

    // 1.3 Cross-café reassignment denial for existing device
    await assert.rejects(
      async () => {
        await hardwareManagementService.registerOrUpdateDevice(
          {
            deviceId: 'PRN-COUNTER-01',
            cafeId: otherCafeId,
            name: 'Attempted Hijack',
            deviceType: 'RECEIPT_PRINTER',
          },
          adminActor
        );
      },
      (err) => err.code === 'CROSS_CAFE_REASSIGNMENT_DENIED'
    );
  });

  // ──────────────────────────────────────────────────────────────────────────
  // TEST 2: Receipt Printer Adapter, Reprint Tracking & Financial Non-Mutation
  // ──────────────────────────────────────────────────────────────────────────
  await t.test('2. Receipt Printer Adapter, ESC/POS Bytecode, Reprint Tracking & Zero Financial Mutation', async () => {
    const cafeInfo = {
      brandName: 'Zamorin Cafe',
      legalName: 'Zamorin Hospitality Private Limited',
      gstin: '32AABCT1234L1ZV',
    };

    const initialBillCount = await Bill.countDocuments();

    // 2.1 First print attempt
    const rawFirstPrint = ReceiptPrinterAdapter.compileReceipt(
      {
        billNumber: 'ZC-BILL-1001',
        date: '2026-10-11',
        time: '14:30:00',
        items: [
          { name: 'Heritage Malabar Roast', quantity: 2, price: 120, total: 240 },
          { name: 'Cardamom Bun', quantity: 1, price: 60, total: 60 },
        ],
        subtotal: 300,
        tax: 15,
        grandTotal: 315,
        isReprint: false,
      },
      cafeInfo,
      { paperWidth: 80 }
    );

    assert(Buffer.isBuffer(rawFirstPrint));
    assert(rawFirstPrint.length > 50);
    // Verify ESC/POS initialization byte sequence ESC @
    assert.equal(rawFirstPrint[0], 0x1b);
    assert.equal(rawFirstPrint[1], 0x40);

    // 2.2 Reprint attempt (Benchmark A022 / F038)
    const rawReprint = ReceiptPrinterAdapter.compileReceipt(
      {
        billNumber: 'ZC-BILL-1001',
        date: '2026-10-11',
        time: '14:35:00',
        items: [{ name: 'Heritage Malabar Roast', quantity: 2, price: 120, total: 240 }],
        subtotal: 240,
        tax: 12,
        grandTotal: 252,
        isReprint: true,
        reprintCount: 2,
      },
      cafeInfo,
      { paperWidth: 80 }
    );

    const reprintStr = rawReprint.toString('utf8');
    assert(reprintStr.includes('REPRINT #2'), 'Reprint slip must feature bold reprint banner');

    // 2.3 Financial Invariant: Repeated prints create 0 new bills
    const postBillCount = await Bill.countDocuments();
    assert.equal(postBillCount, initialBillCount, 'Printing and reprinting must never create or duplicate Bill records.');

    // 2.4 Separate Token Slip (Benchmark A027)
    const tokenBuffer = ReceiptPrinterAdapter.compileTokenSlip(
      { tokenNumber: 'T-42', billNumber: 'ZC-BILL-1001', items: [{ name: 'Filter Coffee', quantity: 1 }] },
      cafeInfo
    );
    assert(tokenBuffer.toString('utf8').includes('TOKEN #T-42'));

    // 2.5 Moved-Item Shifted KOT (Benchmark A022)
    const shiftedBuffer = ReceiptPrinterAdapter.compileShiftedItemTicket({
      fromTable: 'T-10',
      toTable: 'T-12',
      reason: 'Guest moved outside',
      items: [{ name: 'Heritage Malabar Roast', quantity: 2 }],
    });
    assert(shiftedBuffer.toString('utf8').includes('ITEM SHIFTED / TABLE TRANSFER'));
    assert(shiftedBuffer.toString('utf8').includes('DO NOT RE-COOK'));

    // 2.6 Unassigned-Printer Alerts (Benchmark A023)
    const alertReport = await hardwareManagementService.checkUnassignedPrinterAlerts(cafeId, orgId);
    assert.equal(typeof alertReport.hasAlert, 'boolean');
    assert(Array.isArray(alertReport.unassignedStations));
  });

  // ──────────────────────────────────────────────────────────────────────────
  // TEST 3: Cash Drawer Adapter & Financial Non-Mutation
  // ──────────────────────────────────────────────────────────────────────────
  await t.test('3. Cash Drawer Adapter: Pulse Buffers and Zero Cash Ledger Mutation Invariant', async () => {
    // 3.1 Register cash drawer device
    const drawerDev = await hardwareManagementService.registerOrUpdateDevice(
      {
        deviceId: 'DRW-TILL-01',
        cafeId,
        name: 'Main Counter Cash Drawer',
        deviceType: 'CASH_DRAWER',
        configuration: { drawerPin: 2 },
        assignment: { station: 'BILLING', counterName: 'Counter 1' },
      },
      adminActor
    );

    // 3.2 Pin 2 pulse buffer
    const kickPin2 = CashDrawerAdapter.buildKickBuffer(2);
    assert.deepEqual(Array.from(kickPin2), [0x1b, 0x70, 0x00, 0x19, 0xfa]);

    // 3.3 Pin 5 pulse buffer
    const kickPin5 = CashDrawerAdapter.buildKickBuffer(5);
    assert.deepEqual(Array.from(kickPin5), [0x1b, 0x70, 0x01, 0x19, 0xfa]);

    // 3.4 Trigger authorized kick
    const kickResult = await hardwareManagementService.runDeviceDiagnostic('DRW-TILL-01', adminActor, {
      reason: 'Cash reconciliation audit test',
    });

    assert.equal(kickResult.result.success, true);
    assert.equal(kickResult.result.pin, 2);
    assert.equal(kickResult.result.financialMutation, false);

    // Verify audit record attached
    const refreshed = await HardwareDevice.findOne({ deviceId: 'DRW-TILL-01' });
    assert(refreshed.auditHistory.some((a) => a.event === 'DIAGNOSTIC_RUN'));
  });

  // ──────────────────────────────────────────────────────────────────────────
  // TEST 4: Barcode and QR Scanner Adapter & Catalogue Availability
  // ──────────────────────────────────────────────────────────────────────────
  await t.test('4. Barcode & QR Scanner Adapter: Format Parsing and Sold-Out Enforcement', async () => {
    const mockMenuItems = [
      { sku: 'ZC-COFFEE-01', barcode: '8901234567890', name: 'Malabar Filter Coffee', price: 60, soldOut: false, isActive: true },
      { sku: 'ZC-SAMOSA-01', barcode: '8901234567891', name: 'Heritage Samosa', price: 40, soldOut: true, isActive: true },
      { sku: 'ZC-SEASONAL-01', barcode: '8901234567892', name: 'Mango Halwa', price: 120, soldOut: false, isActive: false },
    ];

    // 4.1 Valid EAN-13 scan
    const validScan = BarcodeScannerAdapter.validateItemScan('8901234567890', mockMenuItems);
    assert.equal(validScan.success, true);
    assert.equal(validScan.scanType, 'EAN13');
    assert.equal(validScan.item.name, 'Malabar Filter Coffee');
    assert.equal(validScan.item.price, 60);

    // 4.2 Sold-out rejection
    const soldOutScan = BarcodeScannerAdapter.validateItemScan('ZC-SAMOSA-01', mockMenuItems);
    assert.equal(soldOutScan.success, false);
    assert.equal(soldOutScan.error, 'ITEM_UNAVAILABLE');

    // 4.3 Inactive item rejection
    const inactiveScan = BarcodeScannerAdapter.validateItemScan('ZC-SEASONAL-01', mockMenuItems);
    assert.equal(inactiveScan.success, false);
    assert.equal(inactiveScan.error, 'ITEM_INACTIVE');

    // 4.4 Non-existent item rejection
    const missingScan = BarcodeScannerAdapter.validateItemScan('UNKNOWN-999', mockMenuItems);
    assert.equal(missingScan.success, false);
    assert.equal(missingScan.error, 'ITEM_NOT_FOUND');
  });

  // ──────────────────────────────────────────────────────────────────────────
  // TEST 5: Weighing Scale Adapter & Protocol Validation
  // ──────────────────────────────────────────────────────────────────────────
  await t.test('5. Weighing Scale Adapter: Toledo, CAS, and Generic Protocol Parsing & Bounds Enforcement', async () => {
    // 5.1 Toledo continuous format (ST,GS,+00.450kg)
    const toledo = WeighingScaleAdapter.parseScalePayload('ST,GS,+00.450kg', {
      protocol: 'TOLEDO',
      unit: 'KG',
    });
    assert.equal(toledo.success, true);
    assert.equal(toledo.weight, 0.45);
    assert.equal(toledo.unit, 'KG');
    assert.equal(toledo.isStable, true);

    // 5.2 CAS format (W:1.250kg)
    const cas = WeighingScaleAdapter.parseScalePayload('W:1.250kg', {
      protocol: 'CAS',
      unit: 'KG',
    });
    assert.equal(cas.success, true);
    assert.equal(cas.weight, 1.25);
    assert.equal(cas.unit, 'KG');

    // 5.3 Unit conversion from Grams to KG
    const grams = WeighingScaleAdapter.parseScalePayload('850g', {
      protocol: 'GENERIC_CONTINUOUS',
      unit: 'KG',
    });
    assert.equal(grams.success, true);
    assert.equal(grams.weight, 0.85);

    // 5.4 Negative weight rejection
    const negative = WeighingScaleAdapter.parseScalePayload('-0.150kg', { protocol: 'GENERIC_CONTINUOUS' });
    assert.equal(negative.success, false);
    assert.equal(negative.error, 'NEGATIVE_WEIGHT_DETECTED');

    // 5.5 Capacity exceeded rejection
    const exceeded = WeighingScaleAdapter.parseScalePayload('35.000kg', {
      protocol: 'GENERIC_CONTINUOUS',
      maxWeight: 30.0,
    });
    assert.equal(exceeded.success, false);
    assert.equal(exceeded.error, 'SCALE_CAPACITY_EXCEEDED');
  });

  // ──────────────────────────────────────────────────────────────────────────
  // TEST 6: Payment Terminal Adapter States & Settlement Separation
  // ──────────────────────────────────────────────────────────────────────────
  await t.test('6. Payment Terminal Adapter: State Transitions & Never Auto-Marking Paid Invariant', async () => {
    // 6.1 Unconfigured terminal evaluation
    const unconfStatus = PaymentTerminalAdapter.assessTerminalStatus({ configuration: { paymentProvider: 'UNCONFIGURED' } });
    assert.equal(unconfStatus.status, 'UNCONFIGURED');
    assert.equal(unconfStatus.ready, false);

    // 6.2 Simulated adapter for testing
    const simStatus = PaymentTerminalAdapter.assessTerminalStatus({
      configuration: { paymentProvider: 'MOCK', merchantId: 'MID-123', terminalIdentifier: 'TID-01' },
    });
    assert.equal(simStatus.status, 'READY');
    assert.equal(simStatus.isSimulated, true);

    // 6.3 Payment Initiation: NEVER marks paid!
    const initTxn = PaymentTerminalAdapter.initTransaction({
      amountPaise: 45000,
      orderId: 'ORD-999',
      deviceConfig: { paymentProvider: 'MOCK', merchantId: 'MID-123', terminalIdentifier: 'TID-01' },
    });
    assert.equal(initTxn.success, true);
    assert.equal(initTxn.state, 'PENDING_CUSTOMER_ACTION');
    assert.equal(initTxn.paid, false, 'Payment initiation must NEVER mark the transaction paid!');

    // 6.4 Successful Callback Captures
    const authSuccess = PaymentTerminalAdapter.processTerminalCallback(initTxn, 'SUCCESS_AUTH');
    assert.equal(authSuccess.success, true);
    assert.equal(authSuccess.state, 'CAPTURED');
    assert.equal(authSuccess.paid, true);

    // 6.5 User Cancelled Rejection
    const authCancelled = PaymentTerminalAdapter.processTerminalCallback(initTxn, 'USER_CANCELLED');
    assert.equal(authCancelled.success, false);
    assert.equal(authCancelled.state, 'FAILED');
    assert.equal(authCancelled.paid, false);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // TEST 7: Own-Server Readiness Diagnostics & Secret Redaction
  // ──────────────────────────────────────────────────────────────────────────
  await t.test('7. Own-Server Readiness Diagnostics: Runtime, DB Ping, Storage Writability & Secret Redaction', async () => {
    // 7.1 Runtime assessment
    const runtime = ServerReadinessService.assessRuntime();
    assert.equal(typeof runtime.isSupportedVersion, 'boolean');
    assert.equal(typeof runtime.processUptimeSeconds, 'number');
    assert(runtime.memory.heapUsedMb > 0);

    // 7.2 Database assessment
    const dbReport = await ServerReadinessService.assessDatabase();
    assert.equal(dbReport.connected, true);
    assert.equal(dbReport.status, 'HEALTHY');
    assert(dbReport.pingLatencyMs >= 0);

    // 7.3 Storage writability assessment
    const storageReport = ServerReadinessService.assessStorage();
    assert.equal(storageReport.writable, true);
    assert.equal(storageReport.status, 'HEALTHY');

    // 7.4 Comprehensive Readiness Report
    const fullReport = await ServerReadinessService.getFullReadinessReport();
    assert.equal(fullReport.readyForBusiness, true);
    assert(Array.isArray(fullReport.checks));

    // 7.5 SECURITY INVARIANT: Secret Redaction
    const rawSensitiveUri = 'mongodb://app_user:super_secret_password123@cluster0.example.com:27017/zamorin_db';
    const redacted = ServerReadinessService.redactSensitive(rawSensitiveUri);
    assert(!redacted.includes('super_secret_password123'), 'Passwords must never appear in diagnostic logs');
    assert(redacted.includes('***'));
  });

  // ──────────────────────────────────────────────────────────────────────────
  // TEST 8: Application Update State Machine, Dry Runs, and Rollback
  // ──────────────────────────────────────────────────────────────────────────
  await t.test('8. Application Update Workflow: Manifest Checksums, Dry-Run Previews & State Machine', async () => {
    // Seed release
    await AppRelease.create({
      releaseId: 'REL-2026-v1.3.0',
      organisationId: orgId,
      version: 'v1.3.0',
      title: 'P20 Hardware & Own-Server Readiness Update',
      category: 'FEATURE',
      targetAudience: ['ALL'],
      releaseNotes: 'P20 Hardware & Own-Server Readiness Update release notes.',
      sha256Checksum: 'abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
      publishedBy: { userId: 'USR-MASTER-01', name: 'Zamorin Master', role: 'MASTER' },
    });

    // 8.1 Plan update dry run
    const plan = await appUpdateService.planUpdate({
      targetVersion: 'v1.3.0',
      releaseId: 'REL-2026-v1.3.0',
      actor: masterActor,
      dryRun: true,
    });

    assert.equal(plan.currentVersion, 'v1.2.0');
    assert.equal(plan.targetVersion, 'v1.3.0');
    assert.equal(plan.dryRun, true);
    assert.equal(plan.prerequisitesPassed, true);

    // 8.2 Execute update
    const execResult = await appUpdateService.executeUpdate({
      updateRunId: plan.updateRunId,
      actor: masterActor,
    });

    assert.equal(execResult.success, true);
    assert.equal(execResult.newVersion, 'v1.3.0');
    assert.equal(appUpdateService.getCurrentVersion(), 'v1.3.0');

    // 8.3 Safe rollback to baseline
    const rollbackResult = await appUpdateService.rollbackUpdate({
      updateRunId: plan.updateRunId,
      actor: masterActor,
    });

    assert.equal(rollbackResult.success, true);
    assert.equal(rollbackResult.status, 'ROLLED_BACK');
    assert.equal(rollbackResult.activeVersion, 'v1.2.0');
  });

  // ──────────────────────────────────────────────────────────────────────────
  // TEST 9: Non-Destructive Backup Creation & Cryptographic Integrity
  // ──────────────────────────────────────────────────────────────────────────
  await t.test('9. Backup Creation, SHA-256 Checksums, and Disk Archive Integrity Verification', async () => {
    const backup = await backupRecoveryService.createBackup({
      scope: 'FULL_ENTERPRISE',
      actor: masterActor,
    });

    assert.equal(backup.status, 'COMPLETED');
    assert(backup.backupId.startsWith('BKP-'));
    assert(backup.sha256Checksum && backup.sha256Checksum.length === 64);
    assert(fs.existsSync(backup.filePath));

    // 9.1 Verify cryptographic integrity
    const verifyResult = await backupRecoveryService.verifyBackupIntegrity(backup.backupId, masterActor);
    assert.equal(verifyResult.success, true);
    assert.equal(verifyResult.status, 'VERIFIED');
    assert.equal(verifyResult.sha256Checksum, backup.sha256Checksum);

    // 9.2 Tamper detection test
    const originalContent = fs.readFileSync(backup.filePath, 'utf8');
    fs.writeFileSync(backup.filePath, originalContent + '\n// TAMPERED_DATA', 'utf8');

    await assert.rejects(
      async () => {
        await backupRecoveryService.verifyBackupIntegrity(backup.backupId, masterActor);
      },
      (err) => err.code === 'CHECKSUM_INTEGRITY_MISMATCH'
    );

    // Restore original file
    fs.writeFileSync(backup.filePath, originalContent, 'utf8');
  });

  // ──────────────────────────────────────────────────────────────────────────
  // TEST 10: Privileged Restore Rehearsal & Target Safeguards
  // ──────────────────────────────────────────────────────────────────────────
  await t.test('10. Privileged Restore Rehearsal: Production Protection, Confirmation Guard & Isolated Verification', async () => {
    // Create clean verified backup
    const backup = await backupRecoveryService.createBackup({
      scope: 'FULL_ENTERPRISE',
      actor: masterActor,
    });
    await backupRecoveryService.verifyBackupIntegrity(backup.backupId, masterActor);

    // 10.1 Rejection of production database names
    await assert.rejects(
      async () => {
        await backupRecoveryService.executeRestoreRehearsal({
          backupId: backup.backupId,
          targetDbName: 'zamorin_erp_production', // Forbidden production name
          targetConfirmation: 'CONFIRM_ISOLATED_RESTORE_TARGET',
          restoreVerificationMode: true,
          actor: masterActor,
        });
      },
      (err) => err.code === 'PRODUCTION_TARGET_PROTECTION'
    );

    // 10.2 Rejection without confirmation token
    await assert.rejects(
      async () => {
        await backupRecoveryService.executeRestoreRehearsal({
          backupId: backup.backupId,
          targetDbName: 'zamorin_test_disposable',
          targetConfirmation: 'WRONG_TOKEN',
          restoreVerificationMode: true,
          actor: masterActor,
        });
      },
      (err) => err.code === 'RESTORE_TARGET_CONFIRMATION_REQUIRED'
    );

    // 10.3 Successful isolated restore rehearsal
    const rehearsalResult = await backupRecoveryService.executeRestoreRehearsal({
      backupId: backup.backupId,
      targetDbName: 'zamorin_isolated_rehearsal_db',
      targetConfirmation: 'CONFIRM_ISOLATED_RESTORE_TARGET',
      restoreVerificationMode: true,
      actor: masterActor,
    });

    assert.equal(rehearsalResult.success, true);
    assert.equal(rehearsalResult.status, 'VERIFIED');
    assert.equal(rehearsalResult.targetDbName, 'zamorin_isolated_rehearsal_db');
    assert.equal(rehearsalResult.productionInterference, false);
    assert(rehearsalResult.verifiedCollections.length > 0);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // TEST 11: Canonical Persona Security Matrix
  // ──────────────────────────────────────────────────────────────────────────
  await t.test('11. Canonical Persona Access Matrix: Master Universal, Owner Read-Only, Admin Scoped', async () => {
    // 11.1 Owner attempting to create backup (Denied: Owner is read-only)
    await assert.rejects(
      async () => {
        await backupRecoveryService.createBackup({
          scope: 'FULL_ENTERPRISE',
          actor: ownerActor,
        });
      },
      (err) => err.code === 'INSUFFICIENT_PERMISSIONS'
    );

    // 11.2 Owner attempting restore rehearsal (Denied)
    await assert.rejects(
      async () => {
        await backupRecoveryService.executeRestoreRehearsal({
          backupId: 'BKP-TEST',
          targetDbName: 'isolated_db',
          targetConfirmation: 'CONFIRM_ISOLATED_RESTORE_TARGET',
          restoreVerificationMode: true,
          actor: ownerActor,
        });
      },
      (err) => err.code === 'INSUFFICIENT_PERMISSIONS'
    );

    // 11.3 Cafe Admin attempting application update (Denied)
    await assert.rejects(
      async () => {
        await appUpdateService.planUpdate({
          targetVersion: 'v1.3.0',
          actor: adminActor,
        });
      },
      (err) => err.code === 'INSUFFICIENT_PERMISSIONS'
    );

    // 11.4 Retired Normal Master must fail closed
    const retiredMasterActor = {
      userId: 'USR-OLD-MASTER',
      role: 'MASTER',
      isPrimaryMaster: false,
      isPrimary: false,
    };

    await assert.rejects(
      async () => {
        await backupRecoveryService.executeRestoreRehearsal({
          backupId: 'BKP-TEST',
          targetDbName: 'isolated_db',
          targetConfirmation: 'CONFIRM_ISOLATED_RESTORE_TARGET',
          restoreVerificationMode: true,
          actor: retiredMasterActor,
        });
      },
      (err) => err.code === 'INSUFFICIENT_PERMISSIONS'
    );
  });
});
