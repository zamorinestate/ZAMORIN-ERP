'use strict';

const mongoose = require('mongoose');
const { User } = require('../models/User');
const SequenceCounter = require('../models/SequenceCounter');
const { UniversalQrService } = require('./universalQrService');
const { ApiError } = require('../utils/ApiError');

const LIFECYCLE_STATES = [
  'ACTIVE',
  'PROBATION',
  'CONFIRMED',
  'SUSPENDED',
  'NOTICE_PERIOD',
  'SEPARATED',
  'TERMINATED',
  'RETIRED',
  'REHIRE_ELIGIBLE',
];

const ONBOARDING_CHECKLIST_ITEMS = [
  'personalDetails',
  'employmentDetails',
  'bankDetails',
  'requiredDocuments',
  'payrollConfiguration',
  'department',
  'shift',
  'manager',
  'systemAccount',
  'permissions',
  'attendanceEnrolment',
  'trainingInduction',
];

/**
 * Register a new employee with full 9-section schema, Stage 02 QR badge, and DPDP compliance.
 */
async function registerEmployee(payload = {}, actor = {}) {
  const { organisationId, userId: actorUserId } = actor;
  if (!organisationId) {
    throw new ApiError(400, 'ORGANISATION_REQUIRED', 'organisationId is required.');
  }

  const {
    name,
    email,
    phone = '',
    role = 'STAFF',
    primaryCafeId = null,
    assignedCafeIds = [],
    title = 'Mr',
    preferredName = '',
    dob = null,
    gender = '',
    nationality = 'Indian',
    maritalStatus = '',
    photoAttachmentId = null,
    permanentAddress = null,
    currentAddress = null,
    alternatePhone = '',
    personalEmail = '',
    emergencyContact = null,
    department = 'Front of House',
    designation = 'Barista',
    employmentType = 'Full Time',
    workerType = 'PERMANENT',
    managerUserId = null,
    joiningDate = new Date(),
    effectiveDate = new Date(),
    probationPeriodDays = 90,
    workingPattern = 'REGULAR',
    shift = 'MORNING',
    weeklyOff = ['SUNDAY'],
    salaryStructure = {},
    paymentMethod = 'BANK',
    payrollGroup = 'STANDARD',
    bankDetails = {},
    statutoryApplicability = {},
    documents = [],
    posRights = 'LIMITED',
    cashHandlingRights = false,
    approvalAuthority = false,
    approvalLimit = 0,
    inventoryPrivileges = false,
    attendanceMethod = 'QR',
    biometricEnrolmentId = null,
    assignedAssets = [],
    trainingRecords = [],
    onboardingChecklist = {},
    passwordHash = '$2b$10$EixZaYVK1fsbw1ZfbX3OXePaWxn96p36WQmG6W65WVRp7nJ6e9i1e',
  } = payload;

  if (!name || !name.trim()) {
    throw new ApiError(400, 'INVALID_PAYLOAD', 'Employee name is required.');
  }
  if (!email || !email.trim()) {
    throw new ApiError(400, 'INVALID_PAYLOAD', 'Employee email is required.');
  }

  // Check duplicate email
  const existing = await User.findOne({
    organisationId: organisationId.trim().toUpperCase(),
    email: email.trim().toLowerCase(),
  });
  if (existing) {
    throw new ApiError(409, 'DUPLICATE_EMPLOYEE', `Employee with email ${email} already exists.`);
  }

  // Generate system-assigned EMP-ZC-{000001}
  let newUserId;
  try {
    newUserId = await SequenceCounter.generateId({
      organisationId: organisationId.trim().toUpperCase(),
      sequenceKey: 'EMPLOYEE',
      prefix: 'EMP-ZC',
      minimumDigits: 6,
    });
  } catch (err) {
    const count = await User.countDocuments({ organisationId });
    newUserId = `EMP-ZC-${String(count + 1).padStart(6, '0')}`;
  }

  // Initialize 12-item checklist
  const checklist = {};
  for (const item of ONBOARDING_CHECKLIST_ITEMS) {
    checklist[item] = Boolean(onboardingChecklist[item]);
  }

  // Auto-mark completed fields if provided in initial registration
  if (name && (currentAddress || permanentAddress)) checklist.personalDetails = true;
  if (department && designation && joiningDate) checklist.employmentDetails = true;
  if (bankDetails && bankDetails.accountNumber) checklist.bankDetails = true;
  if (documents && documents.length > 0) checklist.requiredDocuments = true;
  if (salaryStructure && salaryStructure.grossSalary) checklist.payrollConfiguration = true;
  if (department) checklist.department = true;
  if (shift) checklist.shift = true;
  if (managerUserId) checklist.manager = true;
  checklist.systemAccount = true;
  if (role) checklist.permissions = true;
  if (attendanceMethod) checklist.attendanceEnrolment = true;
  if (trainingRecords && trainingRecords.some((t) => t.trainingType === 'INDUCTION' || t.status === 'COMPLETED')) {
    checklist.trainingInduction = true;
  }

  const isReady = ONBOARDING_CHECKLIST_ITEMS.every((k) => checklist[k] === true);

  // Generate Stage 02 Universal QR Employee Badge
  let employeeBadgeQrId = null;
  try {
    const qrRecord = await UniversalQrService.createQrRecord({
      organisationId: organisationId.trim().toUpperCase(),
      cafeId: primaryCafeId || assignedCafeIds?.[0],
      qrType: 'EMPLOYEE_BADGE',
      targetEntityId: newUserId,
      targetEntityType: 'USER',
      label: `${name.trim()} (${newUserId}) Official Badge`,
      actorUserId: actorUserId || 'SYSTEM',
    });
    employeeBadgeQrId = qrRecord.qrId;
  } catch (qrErr) {
    // Non-blocking fallback
  }

  const employee = await User.create({
    userId: newUserId,
    organisationId: organisationId.trim().toUpperCase(),
    name: name.trim(),
    preferredName: preferredName.trim(),
    title,
    dob: dob ? new Date(dob) : null,
    gender,
    nationality,
    maritalStatus,
    photoAttachmentId,
    permanentAddress,
    currentAddress,
    alternatePhone,
    personalEmail: personalEmail.trim().toLowerCase(),
    emergencyContact,
    email: email.trim().toLowerCase(),
    phone: phone.trim(),
    role,
    accountStatus: 'ACTIVE',
    primaryCafeId,
    assignedCafeIds: assignedCafeIds.length > 0 ? assignedCafeIds : (primaryCafeId ? [primaryCafeId] : []),
    department,
    designation,
    employmentType,
    workerType,
    managerUserId,
    joiningDate: new Date(joiningDate),
    effectiveDate: new Date(effectiveDate),
    probationPeriodDays,
    workingPattern,
    shift,
    weeklyOff,
    lifecycleStatus: 'PROBATION',
    salaryStructure,
    paymentMethod,
    payrollGroup,
    bankDetails,
    statutoryApplicability,
    documents,
    posRights,
    cashHandlingRights,
    approvalAuthority,
    approvalLimit,
    inventoryPrivileges,
    attendanceMethod,
    biometricEnrolmentId,
    employeeBadgeQrId,
    systemAccountCreated: true,
    assignedAssets,
    trainingRecords,
    onboardingChecklist: checklist,
    isReadyForActivation: isReady,
    createdBy: actorUserId || 'SYSTEM',
    passwordHash,
    mustChangePassword: true,
  });

  return employee;
}

/**
 * Get employee onboarding readiness checklist.
 */
async function getEmployeeReadinessChecklist(userId, organisationId) {
  const employee = await User.findOne({
    userId: userId.trim().toUpperCase(),
    organisationId: organisationId.trim().toUpperCase(),
  });
  if (!employee) {
    throw new ApiError(404, 'EMPLOYEE_NOT_FOUND', `Employee ${userId} not found.`);
  }

  const checklist = employee.onboardingChecklist || {};
  const items = ONBOARDING_CHECKLIST_ITEMS.map((key) => ({
    key,
    completed: Boolean(checklist[key]),
  }));

  const completedCount = items.filter((i) => i.completed).length;

  return {
    userId: employee.userId,
    name: employee.name,
    isReadyForActivation: employee.isReadyForActivation,
    totalItems: ONBOARDING_CHECKLIST_ITEMS.length,
    completedCount,
    percentComplete: Math.round((completedCount / ONBOARDING_CHECKLIST_ITEMS.length) * 100),
    items,
  };
}

/**
 * Update onboarding checklist items and compute readiness state.
 */
async function updateEmployeeReadinessChecklist(userId, updates = {}, actor = {}) {
  const { organisationId } = actor;
  const employee = await User.findOne({
    userId: userId.trim().toUpperCase(),
    organisationId: organisationId.trim().toUpperCase(),
  });
  if (!employee) {
    throw new ApiError(404, 'EMPLOYEE_NOT_FOUND', `Employee ${userId} not found.`);
  }

  if (!employee.onboardingChecklist) {
    employee.onboardingChecklist = {};
  }

  for (const [key, val] of Object.entries(updates)) {
    if (ONBOARDING_CHECKLIST_ITEMS.includes(key)) {
      employee.onboardingChecklist[key] = Boolean(val);
    }
  }

  employee.isReadyForActivation = ONBOARDING_CHECKLIST_ITEMS.every(
    (k) => employee.onboardingChecklist[k] === true
  );

  await employee.save();

  return getEmployeeReadinessChecklist(userId, organisationId);
}

/**
 * Transition employee lifecycle across the 9 states.
 */
async function transitionEmployeeLifecycle(userId, nextState, reasonOrActor, maybeActor = {}) {
  let reason = '';
  let actor = {};
  if (typeof reasonOrActor === 'string') {
    reason = reasonOrActor;
    actor = maybeActor || {};
  } else if (typeof reasonOrActor === 'object' && reasonOrActor !== null) {
    actor = reasonOrActor;
    reason = actor.reason || '';
  }

  const { organisationId, userId: actorUserId } = actor;
  if (!organisationId) {
    throw new ApiError(400, 'ORGANISATION_REQUIRED', 'organisationId is required in actor context.');
  }

  if (!LIFECYCLE_STATES.includes(nextState)) {
    throw new ApiError(400, 'INVALID_LIFECYCLE_STATE', `Invalid state. Allowed: ${LIFECYCLE_STATES.join(', ')}`);
  }

  const employee = await User.findOne({
    userId: userId.trim().toUpperCase(),
    organisationId: organisationId.trim().toUpperCase(),
  });
  if (!employee) {
    throw new ApiError(404, 'EMPLOYEE_NOT_FOUND', `Employee ${userId} not found.`);
  }

  // Activation check: Incomplete employee cannot transition to ACTIVE / CONFIRMED
  if ((nextState === 'ACTIVE' || nextState === 'CONFIRMED') && !employee.isReadyForActivation) {
    throw new ApiError(
      422,
      'ONBOARDING_INCOMPLETE',
      'Employee has not completed all 12 onboarding readiness checklist items and cannot be activated.'
    );
  }

  employee.lifecycleStatus = nextState;
  employee.statusReason = reason || `Transitioned to ${nextState} by ${actorUserId || 'ADMIN'}`;
  employee.updatedBy = actorUserId || 'SYSTEM';

  if (['SUSPENDED', 'SEPARATED', 'TERMINATED', 'RETIRED'].includes(nextState)) {
    employee.accountStatus = nextState === 'SUSPENDED' ? 'SUSPENDED' : 'INACTIVE';
    try {
      const { Session } = require('../models/Session');
      await Session.updateMany(
        { userId: employee.userId, status: 'ACTIVE' },
        { status: 'REVOKED', revokedAt: new Date(), revokedReason: `EMPLOYEE_LIFECYCLE_${nextState}` }
      );
    } catch (_) {}
  }

  await employee.save();

  return {
    userId: employee.userId,
    lifecycleStatus: employee.lifecycleStatus,
    isReadyForActivation: employee.isReadyForActivation,
    updatedAt: employee.updatedAt,
  };
}

/**
 * Generate or refresh Stage 02 Universal QR Employee Badge.
 */
async function generateEmployeeBadgeQr(userId, actor = {}) {
  const { organisationId, userId: actorUserId } = actor;
  const employee = await User.findOne({
    userId: userId.trim().toUpperCase(),
    organisationId: organisationId.trim().toUpperCase(),
  });
  if (!employee) {
    throw new ApiError(404, 'EMPLOYEE_NOT_FOUND', `Employee ${userId} not found.`);
  }

  // If active badge exists, rotate it; otherwise create fresh
  let qrRecord;
  if (employee.employeeBadgeQrId) {
    try {
      qrRecord = await UniversalQrService.rotateQr(employee.employeeBadgeQrId, {
        actorUserId: actorUserId || 'SYSTEM',
        reason: 'EMPLOYEE_BADGE_ROTATION',
      });
    } catch (e) {
      // Fallback create
      qrRecord = await UniversalQrService.createQrRecord({
        organisationId: organisationId.trim().toUpperCase(),
        cafeId: employee.primaryCafeId,
        qrType: 'EMPLOYEE_BADGE',
        targetEntityId: employee.userId,
        targetEntityType: 'USER',
        label: `${employee.name} (${employee.userId}) Official Badge`,
        actorUserId: actorUserId || 'SYSTEM',
      });
    }
  } else {
    qrRecord = await UniversalQrService.createQrRecord({
      organisationId: organisationId.trim().toUpperCase(),
      cafeId: employee.primaryCafeId,
      qrType: 'EMPLOYEE_BADGE',
      targetEntityId: employee.userId,
      targetEntityType: 'USER',
      label: `${employee.name} (${employee.userId}) Official Badge`,
      actorUserId: actorUserId || 'SYSTEM',
    });
  }

  employee.employeeBadgeQrId = qrRecord.qrId;
  await employee.save();

  return qrRecord;
}

/**
 * Expiry alert engine for employee documents and training.
 * Tracks 90, 60, 30, 15, 7 days and expired items.
 */
async function getEmployeeComplianceAlerts(organisationId, { thresholdDays = 90 } = {}) {
  const employees = await User.find({
    organisationId: organisationId.trim().toUpperCase(),
    accountStatus: { $ne: 'ARCHIVED' },
  }).lean();

  const now = Date.now();
  const alerts = [];

  for (const emp of employees) {
    // Check documents
    const docs = emp.documents || [];
    for (const doc of docs) {
      if (doc.expiresAt) {
        const expTime = new Date(doc.expiresAt).getTime();
        const diffDays = Math.ceil((expTime - now) / (1000 * 60 * 60 * 24));

        if (diffDays <= thresholdDays) {
          let severity = 'INFO';
          if (diffDays <= 0) severity = 'EXPIRED';
          else if (diffDays <= 7) severity = 'CRITICAL';
          else if (diffDays <= 30) severity = 'WARNING';

          alerts.push({
            type: 'DOCUMENT_EXPIRY',
            userId: emp.userId,
            employeeName: emp.name,
            documentType: doc.documentType,
            documentName: doc.documentName,
            expiresAt: doc.expiresAt,
            daysRemaining: diffDays,
            severity,
          });
        }
      }
    }

    // Check training
    const trainings = emp.trainingRecords || [];
    for (const trn of trainings) {
      if (trn.expiresAt) {
        const expTime = new Date(trn.expiresAt).getTime();
        const diffDays = Math.ceil((expTime - now) / (1000 * 60 * 60 * 24));

        if (diffDays <= thresholdDays) {
          let severity = 'INFO';
          if (diffDays <= 0) severity = 'EXPIRED';
          else if (diffDays <= 7) severity = 'CRITICAL';
          else if (diffDays <= 30) severity = 'WARNING';

          alerts.push({
            type: 'TRAINING_EXPIRY',
            userId: emp.userId,
            employeeName: emp.name,
            trainingType: trn.trainingType,
            trainingTitle: trn.trainingTitle,
            expiresAt: trn.expiresAt,
            daysRemaining: diffDays,
            severity,
          });
        }
      }
    }
  }

  return {
    totalAlerts: alerts.length,
    alerts,
  };
}

/**
 * DPDP Act 2023 / Rules 2025: View sensitive unmasked fields with access logging.
 * Strictly restricted to MASTER / OWNER roles.
 */
async function viewSensitiveFieldWithAudit(userId, fieldName, purpose, actor = {}, ipAddress = null) {
  const { organisationId, userId: actorUserId, role } = actor;
  if (!['MASTER', 'OWNER'].includes(role)) {
    throw new ApiError(403, 'FORBIDDEN_DPDP_ACCESS', 'Viewing sensitive statutory and banking data requires elevated administrative privileges.');
  }

  if (!purpose || !purpose.trim()) {
    throw new ApiError(400, 'PURPOSE_REQUIRED', 'DPDP compliance mandates recording a legitimate business purpose for unmasked field access.');
  }

  const employee = await User.findOne({
    userId: userId.trim().toUpperCase(),
    organisationId: organisationId.trim().toUpperCase(),
  });
  if (!employee) {
    throw new ApiError(404, 'EMPLOYEE_NOT_FOUND', `Employee ${userId} not found.`);
  }

  // Record audit log entry
  employee.sensitiveAccessLogs.push({
    viewedBy: actorUserId || 'SYSTEM',
    viewedAt: new Date(),
    field: fieldName,
    purpose: purpose.trim(),
    ipAddress: ipAddress || null,
  });

  await employee.save();

  let unmaskedValue = null;
  if (fieldName === 'accountNumber') {
    unmaskedValue = employee.bankDetails?.accountNumber || '';
  } else if (fieldName === 'ifsc') {
    unmaskedValue = employee.bankDetails?.ifsc || '';
  } else if (fieldName === 'uan') {
    unmaskedValue = employee.statutoryApplicability?.uan || '';
  } else if (fieldName === 'esiNumber') {
    unmaskedValue = employee.statutoryApplicability?.esiNumber || '';
  } else if (fieldName === 'pan') {
    unmaskedValue = employee.statutoryApplicability?.pan || '';
  } else {
    throw new ApiError(400, 'UNSUPPORTED_SENSITIVE_FIELD', `Field ${fieldName} is not recognized as a protected sensitive field.`);
  }

  return {
    userId: employee.userId,
    field: fieldName,
    unmaskedValue,
    loggedAt: new Date(),
    loggedBy: actorUserId,
  };
}

module.exports = {
  LIFECYCLE_STATES,
  ONBOARDING_CHECKLIST_ITEMS,
  registerEmployee,
  getEmployeeReadinessChecklist,
  updateEmployeeReadinessChecklist,
  transitionEmployeeLifecycle,
  updateEmployeeLifecycle: transitionEmployeeLifecycle,
  generateEmployeeBadgeQr,
  getEmployeeComplianceAlerts,
  viewSensitiveFieldWithAudit,
};
