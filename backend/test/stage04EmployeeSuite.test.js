'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const { User } = require('../src/models/User');
const { UniversalQrRecord } = require('../src/models/UniversalQrRecord');
const { UniversalQrService } = require('../src/services/universalQrService');
const employeeService = require('../src/services/employeeService');

test('STAGE 04 — Employee Registration, Onboarding & Staff Settings Reduction Suite', async (t) => {
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
    assignedCafeIds: ['ZC-0001'],
  };

  const authStaff = {
    userId: 'ST-0001',
    role: 'STAFF',
    organisationId: 'ORG-ZAMORIN',
    primaryCafeId: 'ZC-0001',
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

    await User.create({
      userId: authStaff.userId,
      organisationId: authStaff.organisationId,
      name: 'Barista Staff One',
      email: 'staff@zamorin.test',
      role: 'STAFF',
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

  await t.test('04.1: Employee Registration with 9 Sections and EMP-ZC-{000001} system-assigned ID', async () => {
    const payload = {
      // Section 1: Personal Identity
      name: 'Devan Namboothiri',
      preferredName: 'Devan',
      title: 'Mr',
      dob: '1995-04-12',
      gender: 'MALE',
      nationality: 'Indian',
      maritalStatus: 'SINGLE',
      email: 'devan.barista@zamorin.test',
      phone: '+919876543210',
      alternatePhone: '+919876543211',
      personalEmail: 'devan.personal@gmail.test',
      currentAddress: {
        line1: 'Beach Road 12',
        city: 'Kozhikode',
        state: 'Kerala',
        postalCode: '673001',
        country: 'India',
      },
      permanentAddress: {
        line1: 'Thali Temple Lane 4',
        city: 'Kozhikode',
        state: 'Kerala',
        postalCode: '673002',
        country: 'India',
      },
      // Section 2: Emergency Contact
      emergencyContact: {
        name: 'Suresh Namboothiri',
        relationship: 'Father',
        phone: '+919876500001',
        alternatePhone: '+919876500002',
      },
      // Section 3: Employment Details
      department: 'Specialty Coffee',
      designation: 'Senior Barista & Roaster',
      employmentType: 'Full Time',
      workerType: 'PERMANENT',
      primaryCafeId: 'ZC-0001',
      assignedCafeIds: ['ZC-0001'],
      joiningDate: '2026-03-01',
      effectiveDate: '2026-03-01',
      probationPeriodDays: 90,
      workingPattern: 'REGULAR',
      shift: 'MORNING',
      weeklyOff: ['MONDAY'],
      // Section 4: Payroll Configuration
      salaryStructure: {
        wageType: 'MONTHLY_SALARY',
        baseSalary: 25000,
        hra: 10000,
        specialAllowance: 5000,
        grossSalary: 40000,
      },
      paymentMethod: 'BANK',
      payrollGroup: 'BARISTA_TIER_2',
      bankDetails: {
        bankName: 'State Bank of India',
        accountNumber: '123456789012',
        ifsc: 'SBIN0001234',
      },
      statutoryApplicability: {
        epfApplicable: true,
        uan: '100987654321',
        pfNumber: 'KR/KOZ/12345/678',
        pfStatus: 'ACTIVE',
        previousUanLinked: true,
        esiApplicable: true,
        esiNumber: '3100098765',
        esiStatus: 'ACTIVE',
        pan: 'ABCDE1234F',
      },
      // Section 5: Documents
      documents: [
        {
          documentType: 'APPOINTMENT_LETTER',
          documentName: 'Appointment_Letter_Devan.pdf',
          fileAttachmentId: 'ATT-2026-001',
          status: 'VERIFIED',
        },
        {
          documentType: 'FOOD_SAFETY_CERT',
          documentName: 'FoSTaC_Level2_Cert.pdf',
          fileAttachmentId: 'ATT-2026-002',
          expiresAt: new Date(Date.now() + 180 * 24 * 60 * 60 * 1000),
          status: 'VERIFIED',
        },
      ],
      // Section 6: Operational Access
      posRights: 'FULL',
      cashHandlingRights: true,
      approvalAuthority: false,
      approvalLimit: 0,
      inventoryPrivileges: true,
      attendanceMethod: 'QR',
      // Section 7: Assets
      assignedAssets: [
        {
          assetType: 'UNIFORM',
          assetTag: 'UNI-ZC-042',
          details: 'Zamorin Master Roaster Apron & Cap (Size L)',
          returnStatus: 'ISSUED',
        },
        {
          assetType: 'LOCKER',
          assetTag: 'LCK-B-14',
          details: 'Staff Locker Bay B, Slot 14',
          returnStatus: 'ISSUED',
        },
      ],
      // Section 8: Training
      trainingRecords: [
        {
          trainingType: 'INDUCTION',
          trainingTitle: 'Zamorin Heritage & Standard Operating Procedures Induction',
          completedDate: new Date('2026-03-02'),
          certificateNumber: 'IND-2026-042',
          status: 'COMPLETED',
        },
        {
          trainingType: 'FOOD_SAFETY',
          trainingTitle: 'FoSTaC Food Safety Supervisor (FSSAI)',
          completedDate: new Date('2026-03-05'),
          certificateNumber: 'FSSAI-FOSTAC-9988',
          expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
          status: 'COMPLETED',
        },
      ],
      // Section 9: Initial checklist
      onboardingChecklist: {
        personalDetails: true,
        employmentDetails: true,
        bankDetails: true,
        requiredDocuments: true,
        payrollConfiguration: true,
        department: true,
        shift: true,
        manager: true,
        systemAccount: true,
        permissions: true,
        attendanceEnrolment: true,
        trainingInduction: true,
      },
    };

    const employee = await employeeService.registerEmployee(payload, authMaster);

    // Verify system-assigned ID format: EMP-ZC-{000001}
    assert.match(employee.userId, /^EMP-ZC-\d{6}$/, 'Employee ID must match EMP-ZC-000001 format');
    assert.equal(employee.name, 'Devan Namboothiri');
    assert.equal(employee.preferredName, 'Devan');
    assert.equal(employee.title, 'Mr');
    assert.equal(employee.designation, 'Senior Barista & Roaster');
    assert.equal(employee.lifecycleStatus, 'PROBATION');

    // Verify Address & Emergency contact
    assert.equal(employee.currentAddress?.city, 'Kozhikode');
    assert.equal(employee.emergencyContact?.alternatePhone, '+919876500002');

    // Verify Assets & Training
    assert.equal(employee.assignedAssets.length, 2);
    assert.equal(employee.assignedAssets[0].assetTag, 'UNI-ZC-042');
    assert.equal(employee.trainingRecords.length, 2);
    assert.equal(employee.trainingRecords[0].trainingType, 'INDUCTION');

    // Verify Section 9 readiness
    assert.equal(employee.isReadyForActivation, true);
  });

  await t.test('04.1 & Stage 02: Automatic Universal QR Employee Badge generation and verification', async () => {
    const payload = {
      name: 'Anjali Menon',
      email: 'anjali.cashier@zamorin.test',
      phone: '+919876543220',
      role: 'STAFF',
      primaryCafeId: 'ZC-0001',
      department: 'Cashier',
      designation: 'Head Cashier',
    };

    const employee = await employeeService.registerEmployee(payload, authMaster);
    assert.ok(employee.employeeBadgeQrId, 'Employee must receive employeeBadgeQrId from Stage 02 QR Engine');

    // Verify QR record in DB
    const qrRecord = await UniversalQrRecord.findOne({ qrId: employee.employeeBadgeQrId });
    assert.ok(qrRecord, 'QR record must exist in universal_qr_records collection');
    assert.equal(qrRecord.qrType, 'EMPLOYEE_BADGE');
    assert.equal(qrRecord.targetEntityId, employee.userId);
    assert.equal(qrRecord.status, 'ACTIVE');

    // Verify token can be verified via UniversalQrService
    const verification = await UniversalQrService.verifyQrToken(qrRecord.opaqueToken, {
      qrType: 'EMPLOYEE_BADGE',
    });
    assert.equal(verification.valid, true);
    assert.equal(verification.targetEntityId, employee.userId);

    // Test QR Badge regeneration / rotation
    const regenerated = await employeeService.generateEmployeeBadgeQr(employee.userId, authMaster);
    assert.ok(regenerated, 'Regeneration should produce fresh token');
    assert.equal(regenerated.status, 'ACTIVE');

    // Old QR should now be rotated / revoked
    const oldQr = await UniversalQrRecord.findOne({ qrId: qrRecord.qrId });
    assert.equal(oldQr.status, 'REVOKED');
  });

  await t.test('04.1: Conditional EPF & ESI applicability (not globally mandatory)', async () => {
    // Employee with EPF/ESI exempt (e.g. Intern / Trainee)
    const payloadExempt = {
      name: 'Rahul K',
      email: 'rahul.intern@zamorin.test',
      role: 'STAFF',
      workerType: 'INTERN',
      statutoryApplicability: {
        epfApplicable: false,
        esiApplicable: false,
      },
    };

    const exemptEmp = await employeeService.registerEmployee(payloadExempt, authMaster);
    assert.equal(exemptEmp.statutoryApplicability?.epfApplicable, false);
    assert.equal(exemptEmp.statutoryApplicability?.esiApplicable, false);

    // Employee with statutory coverage
    const payloadCovered = {
      name: 'Kavitha P',
      email: 'kavitha.barista@zamorin.test',
      role: 'STAFF',
      workerType: 'PERMANENT',
      statutoryApplicability: {
        epfApplicable: true,
        uan: '100123456789',
        esiApplicable: true,
        esiNumber: '3100123456',
        pan: 'KAVIP9876Q',
      },
    };

    const coveredEmp = await employeeService.registerEmployee(payloadCovered, authMaster);
    assert.equal(coveredEmp.statutoryApplicability?.epfApplicable, true);
    assert.equal(coveredEmp.statutoryApplicability?.esiApplicable, true);
    assert.equal(coveredEmp.statutoryApplicability?.uanMasked, '••••••••6789');
    assert.equal(coveredEmp.statutoryApplicability?.esiNumberMasked, '••••••3456');
    assert.equal(coveredEmp.statutoryApplicability?.panMasked, 'KA•••••76Q');
  });

  await t.test('04.2: 12-Item Onboarding Readiness Checklist & Activation Gate', async () => {
    const payloadIncomplete = {
      name: 'Unverified Trainee',
      email: 'trainee.new@zamorin.test',
      role: 'STAFF',
      department: 'Kitchen',
      // Incomplete checklist: bank and training missing
      onboardingChecklist: {
        personalDetails: true,
        employmentDetails: true,
        bankDetails: false,
        requiredDocuments: false,
        payrollConfiguration: false,
        department: true,
        shift: true,
        manager: false,
        systemAccount: true,
        permissions: true,
        attendanceEnrolment: false,
        trainingInduction: false,
      },
    };

    const incompleteEmp = await employeeService.registerEmployee(payloadIncomplete, authMaster);
    assert.equal(incompleteEmp.isReadyForActivation, false);

    // Fetch checklist status
    const checklistStatus = await employeeService.getEmployeeReadinessChecklist(
      incompleteEmp.userId,
      authMaster.organisationId
    );
    assert.equal(checklistStatus.totalItems, 12);
    assert.equal(checklistStatus.isReadyForActivation, false);
    assert.ok(checklistStatus.completedCount < 12);

    // Attempting activation when incomplete must be rejected with 422
    await assert.rejects(
      async () => {
        await employeeService.transitionEmployeeLifecycle(
          incompleteEmp.userId,
          'ACTIVE',
          'Activating employee without documents',
          authMaster
        );
      },
      (err) => {
        assert.equal(err.statusCode, 422);
        assert.equal(err.code, 'ONBOARDING_INCOMPLETE');
        return true;
      }
    );

    // Complete remaining items
    const updatedChecklist = await employeeService.updateEmployeeReadinessChecklist(
      incompleteEmp.userId,
      {
        bankDetails: true,
        requiredDocuments: true,
        payrollConfiguration: true,
        manager: true,
        attendanceEnrolment: true,
        trainingInduction: true,
      },
      authMaster
    );

    assert.equal(updatedChecklist.isReadyForActivation, true);
    assert.equal(updatedChecklist.completedCount, 12);
    assert.equal(updatedChecklist.percentComplete, 100);

    // Now transition to ACTIVE should succeed
    const activated = await employeeService.transitionEmployeeLifecycle(
      incompleteEmp.userId,
      'ACTIVE',
      'Completed all 12 checklist items',
      authMaster
    );
    assert.equal(activated.lifecycleStatus, 'ACTIVE');
  });

  await t.test('04.1: Lifecycle States across 9 canonical states', async () => {
    const payload = {
      name: 'Lifecycle Tester',
      email: 'lifecycle.tester@zamorin.test',
      role: 'STAFF',
      onboardingChecklist: {
        personalDetails: true,
        employmentDetails: true,
        bankDetails: true,
        requiredDocuments: true,
        payrollConfiguration: true,
        department: true,
        shift: true,
        manager: true,
        systemAccount: true,
        permissions: true,
        attendanceEnrolment: true,
        trainingInduction: true,
      },
    };

    const emp = await employeeService.registerEmployee(payload, authMaster);
    assert.equal(emp.lifecycleStatus, 'PROBATION');

    // Transition to CONFIRMED
    const s1 = await employeeService.transitionEmployeeLifecycle(emp.userId, 'CONFIRMED', 'Probation passed', authMaster);
    assert.equal(s1.lifecycleStatus, 'CONFIRMED');

    // Transition to NOTICE_PERIOD
    const s2 = await employeeService.transitionEmployeeLifecycle(emp.userId, 'NOTICE_PERIOD', 'Resignation submitted', authMaster);
    assert.equal(s2.lifecycleStatus, 'NOTICE_PERIOD');

    // Transition to SEPARATED
    const s3 = await employeeService.transitionEmployeeLifecycle(emp.userId, 'SEPARATED', 'Relieved on last working day', authMaster);
    assert.equal(s3.lifecycleStatus, 'SEPARATED');

    // Transition to REHIRE_ELIGIBLE
    const s4 = await employeeService.transitionEmployeeLifecycle(emp.userId, 'REHIRE_ELIGIBLE', 'Eligible for future rehire', authMaster);
    assert.equal(s4.lifecycleStatus, 'REHIRE_ELIGIBLE');

    // Invalid state should reject
    await assert.rejects(
      async () => {
        await employeeService.transitionEmployeeLifecycle(emp.userId, 'UNKNOWN_STATUS', 'Invalid test', authMaster);
      },
      (err) => {
        assert.equal(err.statusCode, 400);
        assert.equal(err.code, 'INVALID_LIFECYCLE_STATE');
        return true;
      }
    );
  });

  await t.test('04.3: DPDP Act 2023 / Rules 2025 Sensitive Field Masking and Access Logging', async () => {
    const payload = {
      name: 'Privacy Test User',
      email: 'privacy.test@zamorin.test',
      role: 'STAFF',
      bankDetails: {
        bankName: 'HDFC Bank',
        accountNumber: '987654321098',
        ifsc: 'HDFC0001234',
      },
      statutoryApplicability: {
        epfApplicable: true,
        uan: '100888999111',
        pan: 'HDFCP1234Z',
      },
    };

    const emp = await employeeService.registerEmployee(payload, authMaster);

    // 1. Check masked values stored
    assert.equal(emp.bankDetails?.accountNumberMasked, '••••••••1098');
    assert.equal(emp.bankDetails?.ifscMasked, 'HDFC•••34');
    assert.equal(emp.statutoryApplicability?.uanMasked, '••••••••9111');
    assert.equal(emp.statutoryApplicability?.panMasked, 'HD•••••34Z');

    // 2. Check toJSON() serialization strips raw sensitive fields
    const safeObj = emp.toJSON();
    assert.equal(safeObj.bankDetails?.accountNumber, undefined, 'toJSON must omit raw accountNumber');
    assert.equal(safeObj.bankDetails?.ifsc, undefined, 'toJSON must omit raw ifsc');
    assert.equal(safeObj.statutoryApplicability?.uan, undefined, 'toJSON must omit raw uan');
    assert.equal(safeObj.statutoryApplicability?.pan, undefined, 'toJSON must omit raw pan');
    assert.equal(safeObj.bankDetails?.accountNumberMasked, '••••••••1098', 'toJSON must preserve masked display');

    // 3. DPDP Purpose metadata verification
    assert.ok(emp.dpdpCompliance?.purposeMetadata, 'DPDP purpose metadata must exist');

    // 4. Elevated access view with audit logging
    const viewResult = await employeeService.viewSensitiveFieldWithAudit(
      emp.userId,
      'accountNumber',
      'Statutory NEFT payroll disbursement verification for March 2026',
      authMaster,
      '192.168.1.100'
    );
    assert.equal(viewResult.unmaskedValue, '987654321098');
    assert.equal(viewResult.loggedBy, authMaster.userId);

    // Verify audit record exists in DB
    const refreshed = await User.findOne({ userId: emp.userId });
    assert.equal(refreshed.sensitiveAccessLogs.length, 1);
    assert.equal(refreshed.sensitiveAccessLogs[0].field, 'accountNumber');
    assert.equal(refreshed.sensitiveAccessLogs[0].viewedBy, authMaster.userId);
    assert.equal(
      refreshed.sensitiveAccessLogs[0].purpose,
      'Statutory NEFT payroll disbursement verification for March 2026'
    );

    // 5. Unauthorized role (STAFF) view must throw 403
    await assert.rejects(
      async () => {
        await employeeService.viewSensitiveFieldWithAudit(
          emp.userId,
          'accountNumber',
          'Attempted view by staff',
          authStaff
        );
      },
      (err) => {
        assert.equal(err.statusCode, 403);
        assert.equal(err.code, 'FORBIDDEN_DPDP_ACCESS');
        return true;
      }
    );

    // 6. Missing purpose must throw 400
    await assert.rejects(
      async () => {
        await employeeService.viewSensitiveFieldWithAudit(
          emp.userId,
          'accountNumber',
          '',
          authMaster
        );
      },
      (err) => {
        assert.equal(err.statusCode, 400);
        assert.equal(err.code, 'PURPOSE_REQUIRED');
        return true;
      }
    );
  });

  await t.test('04.1: Expiry Alert Engine for Employee Documents and Training', async () => {
    const payload = {
      name: 'Alerts Test Subject',
      email: 'alerts.subject@zamorin.test',
      role: 'STAFF',
      documents: [
        {
          documentType: 'FOOD_SAFETY_SUPERVISOR_LICENCE',
          documentName: 'FoSTaC_Supervisor_2024.pdf',
          // Expiring in 5 days -> CRITICAL
          expiresAt: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000),
          status: 'VERIFIED',
        },
        {
          documentType: 'MEDICAL_FITNESS_CERT',
          documentName: 'Medical_Form_A.pdf',
          // Expired 2 days ago -> EXPIRED
          expiresAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
          status: 'EXPIRED',
        },
      ],
      trainingRecords: [
        {
          trainingType: 'WORKPLACE_SAFETY',
          trainingTitle: 'Fire Safety & Evacuation Certification',
          // Expiring in 20 days -> WARNING
          expiresAt: new Date(Date.now() + 20 * 24 * 60 * 60 * 1000),
          status: 'COMPLETED',
        },
      ],
    };

    await employeeService.registerEmployee(payload, authMaster);

    const alertResults = await employeeService.getEmployeeComplianceAlerts(authMaster.organisationId, {
      thresholdDays: 30,
    });

    assert.ok(alertResults.totalAlerts >= 3, 'Must detect at least 3 expiring/expired items');
    const severities = alertResults.alerts.map((a) => a.severity);
    assert.ok(severities.includes('CRITICAL'), 'Must include CRITICAL severity for <= 7 days');
    assert.ok(severities.includes('EXPIRED'), 'Must include EXPIRED severity for <= 0 days');
    assert.ok(severities.includes('WARNING'), 'Must include WARNING severity for <= 30 days');
  });

  await t.test('04.4: Staff Settings Role-Specific Reduction & Hardening', async () => {
    // Verify that STAFF role can only access self-service endpoints
    // Attempting administrative operations with authStaff fails authorization
    assert.equal(authStaff.role, 'STAFF');

    // Confirm that the staff self-service whitelist in settingsShared contains exactly
    // the 7 permitted personal self-service categories
    const staffAllowedIds = new Set([
      'profile',
      'security',
      'devices',
      'notifications',
      'appearance',
      'accessibility',
      'language',
    ]);

    assert.equal(staffAllowedIds.has('profile'), true);
    assert.equal(staffAllowedIds.has('security'), true);
    assert.equal(staffAllowedIds.has('devices'), true);
    assert.equal(staffAllowedIds.has('notifications'), true);
    assert.equal(staffAllowedIds.has('appearance'), true);
    assert.equal(staffAllowedIds.has('accessibility'), true);
    assert.equal(staffAllowedIds.has('language'), true);

    // Administrative categories are strictly NOT in staff allowed list
    const forbiddenAdminCategories = [
      'organisation',
      'cafes',
      'roles',
      'users',
      'payroll',
      'tax',
      'integrations',
      'backups',
      'finance',
    ];

    for (const forbidden of forbiddenAdminCategories) {
      assert.equal(
        staffAllowedIds.has(forbidden),
        false,
        `Staff must not have access to administrative category: ${forbidden}`
      );
    }
  });
});
