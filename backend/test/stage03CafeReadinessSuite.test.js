'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const { Cafe, READINESS_CHECKLIST_KEYS } = require('../src/models/Cafe');
const { CafeAccess } = require('../src/models/CafeAccess');
const { UniversalQrRecord } = require('../src/models/UniversalQrRecord');
const { User } = require('../src/models/User');
const cafeService = require('../src/services/cafeService');

test('STAGE 03 — Café Registration, 12-Section Onboarding & Store Readiness Suite', async (t) => {
  let mongoServer;

  const passwordHash = '$2b$10$abcdefghijklmnopqrstuu';

  const authMaster = {
    userId: 'MU-0001',
    role: 'MASTER',
    isPrimaryMaster: true,
    organisationId: 'ORG-ZAMORIN',
  };

  const authOwner = {
    userId: 'OW-0001',
    role: 'OWNER',
    organisationId: 'ORG-ZAMORIN',
    assignedCafeIds: [],
  };

  t.before(async () => {
    mongoServer = await MongoMemoryServer.create();
    await mongoose.connect(mongoServer.getUri());

    await User.create({
      userId: authMaster.userId,
      organisationId: authMaster.organisationId,
      name: 'Primary Master Admin',
      email: 'master@zamorin.test',
      role: 'MASTER',
      isPrimaryMaster: true,
      createdBy: 'SYSTEM',
      accountStatus: 'ACTIVE',
      passwordHash,
    });

    await User.create({
      userId: authOwner.userId,
      organisationId: authOwner.organisationId,
      name: 'Cafe Owner Partner',
      email: 'owner@zamorin.test',
      role: 'OWNER',
      createdBy: 'SYSTEM',
      accountStatus: 'ACTIVE',
      passwordHash,
    });
  });

  t.after(async () => {
    await mongoose.disconnect();
    if (mongoServer) {
      await mongoServer.stop();
    }
  });

  let createdCafeId = null;

  await t.test('3.1 Full 12-Section Wizard Creation & Auto-Provisioning of Stage 02 QR', async () => {
    const cafePayload = {
      // Section A: Basic Identity
      name: 'Zamorin Calicut Beach Flagship',
      displayName: 'Calicut Beach',
      legalName: 'Zamorin Beach Hospitality Pvt. Ltd.',
      branchName: 'Beach Promenade Branch',
      cafeType: 'STANDARD_CAFE',
      establishmentCategory: 'Café',
      dietaryType: 'MIXED',
      dateBusinessStarted: '2026-01-15',
      branchCode: 'ZAM-CC-01',
      internalCafeId: 'INT-CAL-01',
      storeNumber: 'STORE-101',

      // Section B: Legal Constitution & Ownership
      constitution: 'PRIVATE_LIMITED',
      legalOwnerName: 'Zamorin Hospitality Group',
      partnersDirectors: ['K. P. Nambiar', 'A. K. Menon'],
      authorisedSignatory: 'K. P. Nambiar',
      pan: 'AAACZ1234K',
      cin: 'U55101KL2026PTC099887',
      registrationNumber: 'REG-KL-2026-00451',
      incorporationDate: '2026-01-10',
      registeredOfficeAddress: 'Beach Road, Mananchira, Kozhikode, Kerala 673001',
      udyamNumber: 'UDYAM-KL-06-0012345',
      udyamRegistrationDate: '2026-02-01',
      enterpriseClassification: 'SMALL',

      // Section C: Contact Information
      managerName: 'Devanarayanan K.',
      phone: '+919876543210',
      alternatePhone: '+919876543211',
      email: 'beach.manager@zamorin.test',
      emergencyName: 'Rajesh Nair',
      emergencyPhone: '+919876543299',
      communicationPreference: 'EMAIL',

      // Section D: Premises and Location Profile
      doorNumber: '42/100-B',
      addressLine1: 'Beach Road Promenade',
      addressLine2: 'Opposite Old Pier',
      landmark: 'Near Corporation Beach Park',
      city: 'Kozhikode',
      district: 'Kozhikode',
      state: 'Kerala',
      stateCode: '32',
      pincode: '673032',
      country: 'India',
      latitude: 11.2588,
      longitude: 75.7804,
      mapsLink: 'https://maps.google.com/?q=11.2588,75.7804',
      possessionType: 'LEASED',
      leaseStartDate: '2026-01-01',
      leaseEndDate: '2031-12-31',

      // Section E: Tax and Statutory Registration
      gstin: '32AAACZ1234K1Z5',
      gstDetails: {
        isRegistered: true,
        gstin: '32AAACZ1234K1Z5',
        legalName: 'Zamorin Beach Hospitality Pvt. Ltd.',
        tradeName: 'Zamorin Calicut Beach Flagship',
        registrationDate: '2026-01-15',
        stateCode: '32',
        taxpayerType: 'REGULAR',
        principalPlace: 'Beach Road, Kozhikode',
        effectiveDate: '2026-01-15',
        status: 'ACTIVE',
      },
      fssaiNumber: '11326001000123',
      fssaiType: 'State Licence',
      fssaiExpiryDate: new Date(Date.now() + 45 * 24 * 60 * 60 * 1000).toISOString(), // 45 days remaining -> EXPIRING_60
      otherRegistrations: [
        {
          name: 'Municipal Trade Permit',
          registrationNumber: 'KZD-TRD-2026-88',
          status: 'APPLICABLE',
          validTill: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString(), // 5 days remaining -> EXPIRING_7
        },
        {
          name: 'Fire Safety NOC',
          registrationNumber: 'FS-NOC-2025-01',
          status: 'APPLICABLE',
          validTill: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(), // Expired 2 days ago -> EXPIRED
        },
      ],

      // Section F: Financial and Banking Configuration
      banking: {
        accountHolderName: 'Zamorin Beach Hospitality Pvt. Ltd.',
        bankName: 'HDFC Bank Ltd.',
        branch: 'Mananchira Kozhikode Branch',
        accountNumber: '50200088991122',
        ifsc: 'HDFC0001234',
        accountType: 'CURRENT',
        upiId: 'zamorinbeach@hdfcbank',
      },

      // Section G: Café Operational Setup
      seatingCapacity: 64,
      tableCount: 16,
      counterCount: 2,
      splitShifts: true,
      serviceModes: ['DINE_IN', 'TAKEAWAY'],
      kitchenSections: ['Specialty Bar', 'Bakery Prep', 'Hot Kitchen'],
      prepStations: ['Espresso Line', 'Steam Station', 'Plate Counter'],
      kotRouting: 'MULTI_STATION_SPLIT',

      // Section H: Inventory and Procurement Profile
      inventoryConfig: {
        mainStore: 'Central Dry Store B1',
        kitchenStore: 'Line Store Ground Floor',
        coldStorageLocations: ['Walk-in Chiller', 'Display Fridge'],
      },

      // Section I: Hardware Readiness
      hardwareReadiness: {
        posTerminals: true,
        androidTablets: true,
        thermalPrinters: true,
        kitchenPrinter: true,
        barcodeScanner: true,
        cashDrawer: true,
        internetConnection: true,
        backupInternet: true,
        powerBackup: true,
      },

      // Section J: Branding
      branding: {
        companyLogoUrl: 'https://zamorin.app/assets/zamorin-corp-logo.png',
        cafeLogoUrl: 'https://zamorin.app/assets/calicut-beach-logo.png',
        legalEntityName: 'Zamorin Beach Hospitality Pvt. Ltd.',
        tradeName: 'Zamorin Café',
        primaryBrandColor: '#16223F',
        invoiceFooterText: 'Official Speciality Coffee of the Malabar Coast.',
      },

      // Section L: Initial Status
      status: 'CONFIGURING',
    };

    const result = await cafeService.createCafeWithAccess({
      auth: authMaster,
      cafeData: cafePayload,
    });

    assert.ok(result.cafe);
    assert.ok(result.access);
    createdCafeId = result.cafe.cafeId;

    // Verify Official ID format matches ZC-0001 (or ZC-CAF-000001)
    assert.match(createdCafeId, /^ZC-(CAF-)?\d{4,}$/);

    // Verify 12-Section profile persisted
    const savedCafe = await Cafe.findOne({ cafeId: createdCafeId });
    assert.equal(savedCafe.branchName, 'Beach Promenade Branch');
    assert.equal(savedCafe.legalConstitution.constitution, 'PRIVATE_LIMITED');
    assert.equal(savedCafe.legalConstitution.pan, 'AAACZ1234K');
    assert.equal(savedCafe.registrations.gstin, '32AAACZ1234K1Z5');
    assert.equal(savedCafe.registrations.fssai.number, '11326001000123');
    assert.equal(savedCafe.operations.tableCount, 16);
    assert.equal(savedCafe.hardwareReadiness.posTerminals, true);
    assert.equal(savedCafe.branding.primaryBrandColor, '#16223F');

    // Section K: Verify Stage 02 Universal QR Auto-Provisioned
    assert.ok(savedCafe.qrLoginContext);
    assert.ok(savedCafe.qrLoginContext.securePublicCafeReference);
    assert.match(savedCafe.qrLoginContext.loginUrl, /^https:\/\/zamorin\.app\/cafe\/.+\/login$/);

    // Verify Stage 02 UniversalQrRecord exists in DB
    const qrRec = await UniversalQrRecord.findOne({ qrId: savedCafe.qrLoginContext.qrRecordId });
    assert.ok(qrRec);
    assert.equal(qrRec.qrType, 'CAFE_LOGIN');
    assert.equal(qrRec.cafeId, createdCafeId);
    assert.equal(qrRec.status, 'ACTIVE');

    // Section F: Verify bank masking
    assert.equal(savedCafe.finance.banking.accountNumberMasked, '••••••••1122');
  });

  await t.test('3.2 Licence Expiry Alert Engine (X.03 / Section E evaluation)', async () => {
    const alertsData = await cafeService.getComplianceAlerts({
      organisationId: authMaster.organisationId,
      cafeId: createdCafeId,
    });

    assert.equal(alertsData.cafesWithAlertsCount, 1);
    const cafeAlerts = alertsData.alerts[0].alerts;
    assert.ok(cafeAlerts.length >= 3);

    // FSSAI (45 days) -> EXPIRING_60
    const fssaiAlert = cafeAlerts.find((a) => a.licenceType === 'FSSAI Licence');
    assert.ok(fssaiAlert);
    assert.equal(fssaiAlert.alertLevel, 'EXPIRING_60');

    // Municipal permit (5 days) -> EXPIRING_7
    const munAlert = cafeAlerts.find((a) => a.licenceType === 'Municipal Trade Permit');
    assert.ok(munAlert);
    assert.equal(munAlert.alertLevel, 'EXPIRING_7');

    // Fire Safety NOC (-2 days) -> EXPIRED
    const fireAlert = cafeAlerts.find((a) => a.licenceType === 'Fire Safety NOC');
    assert.ok(fireAlert);
    assert.equal(fireAlert.alertLevel, 'EXPIRED');
  });

  await t.test('3.3 10-Point Test Mode Readiness Checklist & Progress Inspection', async () => {
    const readinessInitial = await cafeService.getCafeReadiness({
      organisationId: authMaster.organisationId,
      cafeId: createdCafeId,
    });

    assert.equal(readinessInitial.totalTests, 10);
    assert.equal(readinessInitial.completedTests, 0);
    assert.equal(readinessInitial.readinessPercentage, 0);
    assert.equal(readinessInitial.isTestModeComplete, false);

    // Partially update 4 checklist items
    const updateRes = await cafeService.updateReadinessChecklist({
      organisationId: authMaster.organisationId,
      cafeId: createdCafeId,
      checklistUpdates: {
        qrLoginTest: true,
        employeeLoginTest: true,
        posTest: true,
        printerTest: true,
      },
      auth: authMaster,
    });

    assert.equal(updateRes.success, true);
    assert.equal(updateRes.isTestModeComplete, false);

    const readinessMid = await cafeService.getCafeReadiness({
      organisationId: authMaster.organisationId,
      cafeId: createdCafeId,
    });
    assert.equal(readinessMid.completedTests, 4);
    assert.equal(readinessMid.readinessPercentage, 40);
    assert.equal(readinessMid.isTestModeComplete, false);
  });

  await t.test('3.4 Controlled 7-Stage Lifecycle Transitions & Incomplete Checklist Blocking', async () => {
    // Current is CONFIGURING -> Advance to READY_FOR_TESTING
    await cafeService.transitionLifecycleState({
      organisationId: authMaster.organisationId,
      cafeId: createdCafeId,
      targetStatus: 'READY_FOR_TESTING',
      reason: 'Setup complete, proceeding to store hardware tests.',
      auth: authMaster,
    });

    // Advance to TEST_MODE
    await cafeService.transitionLifecycleState({
      organisationId: authMaster.organisationId,
      cafeId: createdCafeId,
      targetStatus: 'TEST_MODE',
      reason: 'Entering active on-site verification testing.',
      auth: authMaster,
    });

    // Attempting to advance to READY_FOR_ACTIVATION while checklist is only 4/10 complete MUST FAIL
    await assert.rejects(
      async () => {
        await cafeService.transitionLifecycleState({
          organisationId: authMaster.organisationId,
          cafeId: createdCafeId,
          targetStatus: 'READY_FOR_ACTIVATION',
          reason: 'Premature activation attempt.',
          auth: authMaster,
        });
      },
      (err) => {
        assert.equal(err.code, 'READINESS_CHECKLIST_INCOMPLETE');
        assert.equal(err.statusCode, 400);
        return true;
      }
    );

    // Attempting to jump directly to ACTIVE from TEST_MODE MUST ALSO FAIL
    await assert.rejects(
      async () => {
        await cafeService.transitionLifecycleState({
          organisationId: authMaster.organisationId,
          cafeId: createdCafeId,
          targetStatus: 'ACTIVE',
          reason: 'Bypass readiness attempt.',
          auth: authMaster,
        });
      },
      (err) => {
        assert.equal(err.code, 'INVALID_LIFECYCLE_TRANSITION');
        assert.equal(err.statusCode, 400);
        return true;
      }
    );
  });

  await t.test('3.5 Full Checklist Completion, Ready for Activation & Operational Activation', async () => {
    // Complete remaining 6 tests
    const remainingTests = {};
    for (const key of READINESS_CHECKLIST_KEYS) {
      remainingTests[key] = true;
    }

    await cafeService.updateReadinessChecklist({
      organisationId: authMaster.organisationId,
      cafeId: createdCafeId,
      checklistUpdates: remainingTests,
      auth: authMaster,
    });

    const readinessFull = await cafeService.getCafeReadiness({
      organisationId: authMaster.organisationId,
      cafeId: createdCafeId,
    });
    assert.equal(readinessFull.completedTests, 10);
    assert.equal(readinessFull.readinessPercentage, 100);
    assert.equal(readinessFull.isTestModeComplete, true);

    // Transition to READY_FOR_ACTIVATION now succeeds!
    const resReady = await cafeService.transitionLifecycleState({
      organisationId: authMaster.organisationId,
      cafeId: createdCafeId,
      targetStatus: 'READY_FOR_ACTIVATION',
      reason: 'All 10 tests passed on site.',
      auth: authMaster,
    });
    assert.equal(resReady.status, 'READY_FOR_ACTIVATION');

    // Transition to ACTIVE succeeds and activates CafeAccess!
    const resActive = await cafeService.transitionLifecycleState({
      organisationId: authMaster.organisationId,
      cafeId: createdCafeId,
      targetStatus: 'ACTIVE',
      reason: 'Grand opening authorized.',
      auth: authMaster,
    });
    assert.equal(resActive.status, 'ACTIVE');

    const access = await CafeAccess.findOne({ cafeId: createdCafeId });
    assert.equal(access.accessStatus, 'ACTIVE');

    // Verify readiness audit trail recorded
    const savedCafe = await Cafe.findOne({ cafeId: createdCafeId });
    assert.ok(savedCafe.readinessHistory.length >= 4);
  });

  await t.test('3.6 Universal QR Code Regeneration & Token Revocation', async () => {
    const cafeBefore = await Cafe.findOne({ cafeId: createdCafeId });
    const oldQrId = cafeBefore.qrLoginContext.qrRecordId;
    const oldRef = cafeBefore.qrLoginContext.securePublicCafeReference;

    const regenRes = await cafeService.regenerateCafeLoginQr({
      organisationId: authMaster.organisationId,
      cafeId: createdCafeId,
      auth: authMaster,
    });

    assert.equal(regenRes.success, true);
    assert.notEqual(regenRes.qrId, oldQrId);
    assert.notEqual(regenRes.securePublicCafeReference, oldRef);

    // Verify old QR Record is revoked in Stage 02 UniversalQrRecord
    const oldQrRec = await UniversalQrRecord.findOne({ qrId: oldQrId });
    assert.equal(oldQrRec.status, 'REVOKED');

    // Verify new QR Record is active
    const newQrRec = await UniversalQrRecord.findOne({ qrId: regenRes.qrId });
    assert.equal(newQrRec.status, 'ACTIVE');
    assert.equal(newQrRec.targetEntityId, regenRes.securePublicCafeReference);
  });

  await t.test('3.7 A4 Printable Café QR Card PDF Generation', async () => {
    const { pdfBuffer, filename, qrRecord } = await cafeService.generatePrintableQrCardPdf({
      organisationId: authMaster.organisationId,
      cafeId: createdCafeId,
    });

    assert.ok(Buffer.isBuffer(pdfBuffer));
    assert.ok(pdfBuffer.length > 500);
    // Verify valid PDF header
    assert.equal(pdfBuffer.subarray(0, 5).toString('ascii'), '%PDF-');
    assert.equal(filename, `ZAMORIN_QR_CARD_${createdCafeId}.pdf`);
    assert.equal(qrRecord.qrType, 'CAFE_LOGIN');
  });
});
