'use strict';

const mongoose = require('mongoose');

const {
  buildEmployeeSearchTerms,
  normalizeOptionalText,
  normalizePreviousNames,
} = require('../services/employeeReadService');

const USER_ROLES = ['MASTER', 'OWNER', 'CAFE_ADMIN', 'STAFF', 'VENDOR'];

const ACCOUNT_STATUSES = [
  'PENDING_ACTIVATION',
  'ACTIVE',
  'LOCKED',
  'SUSPENDED',
  'DISABLED',
  'ARCHIVED',
];

const addressSchema = new mongoose.Schema(
  {
    line1: {
      type: String,
      trim: true,
      maxlength: 200,
      default: '',
    },

    line2: {
      type: String,
      trim: true,
      maxlength: 200,
      default: '',
    },

    city: {
      type: String,
      trim: true,
      maxlength: 120,
      default: '',
    },

    state: {
      type: String,
      trim: true,
      maxlength: 120,
      default: '',
    },

    postalCode: {
      type: String,
      trim: true,
      maxlength: 20,
      default: '',
    },

    country: {
      type: String,
      trim: true,
      maxlength: 120,
      default: '',
    },
  },
  {
    _id: false,
  }
);

const emergencyContactSchema =
  new mongoose.Schema(
    {
      name: {
        type: String,
        trim: true,
        maxlength: 120,
        default: '',
      },

      relationship: {
        type: String,
        trim: true,
        maxlength: 80,
        default: '',
      },

      phone: {
        type: String,
        trim: true,
        maxlength: 20,
        default: '',
      },

      alternatePhone: {
        type: String,
        trim: true,
        maxlength: 20,
        default: '',
      },
    },
    {
      _id: false,
    }
  );

const roleHistoryEntrySchema = new mongoose.Schema(
  {
    fromRole: {
      type: String,
      enum: USER_ROLES,
      default: undefined,
    },

    toRole: {
      type: String,
      required: true,
      enum: USER_ROLES,
    },

    changedAt: {
      type: Date,
      required: true,
      default: Date.now,
    },

    changedBy: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
    },

    reason: {
      type: String,
      required: true,
      trim: true,
      maxlength: 2000,
    },

    correlationId: {
      type: String,
      trim: true,
      maxlength: 150,
      default: null,
    },

    sessionId: {
      type: String,
      trim: true,
      maxlength: 200,
      default: null,
    },
  },
  {
    _id: false,
  }
);

const cafeAssignmentHistoryEntrySchema =
  new mongoose.Schema(
    {
      previousAssignedCafeIds: {
        type: [String],
        default: [],
      },

      assignedCafeIds: {
        type: [String],
        default: [],
      },

      previousPrimaryCafeId: {
        type: String,
        trim: true,
        uppercase: true,
        default: null,
      },

      primaryCafeId: {
        type: String,
        trim: true,
        uppercase: true,
        default: null,
      },

      changedAt: {
        type: Date,
        required: true,
        default: Date.now,
      },

      changedBy: {
        type: String,
        required: true,
        trim: true,
        uppercase: true,
      },

      reason: {
        type: String,
        required: true,
        trim: true,
        maxlength: 2000,
      },

      correlationId: {
        type: String,
        trim: true,
        maxlength: 150,
        default: null,
      },

      sessionId: {
        type: String,
        trim: true,
        maxlength: 200,
        default: null,
      },
    },
    {
      _id: false,
    }
  );

const employeeDocumentEntrySchema = new mongoose.Schema(
  {
    documentType: {
      type: String,
      trim: true,
      default: 'OTHER',
    },
    documentName: {
      type: String,
      trim: true,
      default: '',
    },
    fileAttachmentId: {
      type: String,
      trim: true,
      default: null,
    },
    uploadedAt: {
      type: Date,
      default: Date.now,
    },
    expiresAt: {
      type: Date,
      default: null,
    },
    status: {
      type: String,
      enum: ['PENDING', 'VERIFIED', 'EXPIRED'],
      default: 'PENDING',
    },
  },
  { _id: false }
);

const employeeAssetEntrySchema = new mongoose.Schema(
  {
    assetType: {
      type: String,
      trim: true,
      default: 'OTHER',
    },
    assetTag: {
      type: String,
      trim: true,
      default: '',
    },
    details: {
      type: String,
      trim: true,
      default: '',
    },
    issuedDate: {
      type: Date,
      default: Date.now,
    },
    returnStatus: {
      type: String,
      enum: ['ISSUED', 'RETURNED', 'LOST', 'DAMAGED'],
      default: 'ISSUED',
    },
    returnedDate: {
      type: Date,
      default: null,
    },
  },
  { _id: false }
);

const employeeTrainingEntrySchema = new mongoose.Schema(
  {
    trainingType: {
      type: String,
      trim: true,
      default: 'OTHER',
    },
    trainingTitle: {
      type: String,
      trim: true,
      default: '',
    },
    completedDate: {
      type: Date,
      default: null,
    },
    certificateNumber: {
      type: String,
      trim: true,
      default: null,
    },
    expiresAt: {
      type: Date,
      default: null,
    },
    status: {
      type: String,
      enum: ['ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'EXPIRED'],
      default: 'ASSIGNED',
    },
  },
  { _id: false }
);

const sensitiveAccessLogSchema = new mongoose.Schema(
  {
    viewedBy: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
    },
    viewedAt: {
      type: Date,
      default: Date.now,
    },
    field: {
      type: String,
      required: true,
      trim: true,
    },
    purpose: {
      type: String,
      required: true,
      trim: true,
    },
    ipAddress: {
      type: String,
      trim: true,
      default: null,
    },
  },
  { _id: false }
);

const userSchema = new mongoose.Schema(
  {
    userId: {
      type: String,
      required: true,
      unique: true,
      immutable: true,
      trim: true,
      uppercase: true,
      match: /^((MU|OW|AD|ST|VU)-\d{4,}|EMP-ZC-\d{4,})$/,
    },

    organisationId: {
      type: String,
      required: true,
      immutable: true,
      trim: true,
      uppercase: true,
      index: true,
    },

    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 120,
    },

    preferredName: {
      type: String,
      trim: true,
      maxlength: 120,
      default: '',
    },

    previousNames: [
      {
        type: String,
        trim: true,
        maxlength: 120,
      },
    ],

    employeeSearchTerms: {
      type: [
        {
          type: String,
          maxlength: 120,
        },
      ],
      select: false,
      default: [],
    },

    joiningDate: {
      type: Date,
      default: null,
    },

    employmentType: {
      type: String,
      trim: true,
      maxlength: 80,
      default: '',
    },

    department: {
      type: String,
      trim: true,
      maxlength: 120,
      default: '',
    },

    designation: {
      type: String,
      trim: true,
      maxlength: 120,
      default: '',
    },

    address: {
      type: addressSchema,
      default: null,
    },

    emergencyContact: {
      type: emergencyContactSchema,
      default: null,
    },

    title: {
      type: String,
      trim: true,
      default: 'Mr',
    },

    dob: {
      type: Date,
      default: null,
    },

    gender: {
      type: String,
      trim: true,
      default: '',
    },

    nationality: {
      type: String,
      trim: true,
      default: 'Indian',
    },

    maritalStatus: {
      type: String,
      trim: true,
      default: '',
    },

    photoAttachmentId: {
      type: String,
      trim: true,
      default: null,
    },

    permanentAddress: {
      type: addressSchema,
      default: null,
    },

    currentAddress: {
      type: addressSchema,
      default: null,
    },

    alternatePhone: {
      type: String,
      trim: true,
      maxlength: 20,
      default: '',
    },

    personalEmail: {
      type: String,
      trim: true,
      lowercase: true,
      maxlength: 254,
      default: '',
    },

    effectiveDate: {
      type: Date,
      default: null,
    },

    probationPeriodDays: {
      type: Number,
      default: 90,
    },

    confirmationDate: {
      type: Date,
      default: null,
    },

    contractStartDate: {
      type: Date,
      default: null,
    },

    contractEndDate: {
      type: Date,
      default: null,
    },

    workingPattern: {
      type: String,
      trim: true,
      default: 'REGULAR',
    },

    shift: {
      type: String,
      trim: true,
      default: 'MORNING',
    },

    weeklyOff: {
      type: [String],
      default: ['SUNDAY'],
    },

    lifecycleStatus: {
      type: String,
      enum: [
        'ACTIVE',
        'PROBATION',
        'CONFIRMED',
        'SUSPENDED',
        'NOTICE_PERIOD',
        'SEPARATED',
        'TERMINATED',
        'RETIRED',
        'REHIRE_ELIGIBLE',
      ],
      default: 'PROBATION',
      index: true,
    },

    email: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
      maxlength: 254,
    },

    phone: {
      type: String,
      trim: true,
      maxlength: 20,
      default: '',
    },

    role: {
      type: String,
      required: true,
      enum: USER_ROLES,
      index: true,
    },

    capabilities: [
      {
        type: String,
        trim: true,
        uppercase: true,
      },
    ],

    accountStatus: {
      type: String,
      required: true,
      enum: ACCOUNT_STATUSES,
      default: 'PENDING_ACTIVATION',
      index: true,
    },

    primaryCafeId: {
      type: String,
      trim: true,
      uppercase: true,
      default: null,
    },

    assignedCafeIds: [
      {
        type: String,
        trim: true,
        uppercase: true,
      },
    ],

    vendorId: {
      type: String,
      trim: true,
      uppercase: true,
      default: null,
      index: true,
    },

    workerType: {
      type: String,
      enum: ['PERMANENT', 'FIXED_TERM', 'TRAINEE', 'INTERN', 'CONTINGENT'],
      default: 'PERMANENT',
    },

    employmentStatus: {
      type: String,
      enum: ['PREBOARDING', 'PROBATION', 'ACTIVE', 'NOTICE_PERIOD', 'EXITED', 'ARCHIVED'],
      default: 'ACTIVE',
      index: true,
    },

    fte: {
      type: Number,
      default: 1.0,
    },

    standardWeeklyHours: {
      type: Number,
      default: 48,
    },

    positionId: {
      type: String,
      trim: true,
      uppercase: true,
      default: null,
    },

    managerUserId: {
      type: String,
      trim: true,
      uppercase: true,
      default: null,
    },

    probationStatus: {
      type: String,
      enum: ['PENDING', 'CONFIRMED', 'EXTENDED', 'NOT_APPLICABLE'],
      default: 'CONFIRMED',
    },

    probationEndDate: {
      type: String,
      default: null,
    },

    offboardingDetails: {
      noticeDate: { type: String, default: null },
      lastWorkingDay: { type: String, default: null },
      exitType: { type: String, default: null },
      reasonCategory: { type: String, default: null },
      handoverComplete: { type: Boolean, default: false },
      assetsReturned: { type: Boolean, default: false },
      accessRevoked: { type: Boolean, default: false },
      payrollNotified: { type: Boolean, default: false },
    },

    statutoryStatus: {
      epfUanStatus: { type: String, default: 'VERIFIED' },
      esiStatus: { type: String, default: 'REGISTERED' },
    },

    // ── Stage 04: Section 4 — Payroll Configuration ──────────────────────────
    salaryStructure: {
      wageType: {
        type: String,
        enum: ['MONTHLY_SALARY', 'HOURLY', 'DAILY'],
        default: 'MONTHLY_SALARY',
      },
      baseSalary: { type: Number, default: 0 },
      hra: { type: Number, default: 0 },
      specialAllowance: { type: Number, default: 0 },
      grossSalary: { type: Number, default: 0 },
    },

    paymentMethod: {
      type: String,
      enum: ['BANK', 'CASH', 'CHEQUE'],
      default: 'BANK',
    },

    payrollGroup: {
      type: String,
      trim: true,
      default: 'STANDARD',
    },

    bankDetails: {
      bankName: { type: String, trim: true, default: '' },
      accountNumber: { type: String, trim: true, default: '' },
      accountNumberMasked: { type: String, trim: true, default: '' },
      ifsc: { type: String, trim: true, default: '' },
      ifscMasked: { type: String, trim: true, default: '' },
    },

    statutoryApplicability: {
      epfApplicable: { type: Boolean, default: false },
      uan: { type: String, trim: true, default: '' },
      uanMasked: { type: String, trim: true, default: '' },
      pfNumber: { type: String, trim: true, default: '' },
      pfStatus: { type: String, trim: true, default: 'PENDING' },
      previousUanLinked: { type: Boolean, default: false },
      esiApplicable: { type: Boolean, default: false },
      esiNumber: { type: String, trim: true, default: '' },
      esiNumberMasked: { type: String, trim: true, default: '' },
      esiStatus: { type: String, trim: true, default: 'PENDING' },
      pan: { type: String, trim: true, default: '' },
      panMasked: { type: String, trim: true, default: '' },
      aadhaarMasked: { type: String, trim: true, default: '' },
    },

    // ── Stage 04: Section 5 — Documents with Expiry Tracking ─────────────────
    documents: {
      type: [employeeDocumentEntrySchema],
      default: [],
    },

    // ── Stage 04: Section 6 — Operational Access ─────────────────────────────
    posRights: {
      type: String,
      enum: ['NONE', 'LIMITED', 'FULL'],
      default: 'LIMITED',
    },

    cashHandlingRights: {
      type: Boolean,
      default: false,
    },

    approvalAuthority: {
      type: Boolean,
      default: false,
    },

    approvalLimit: {
      type: Number,
      default: 0,
    },

    inventoryPrivileges: {
      type: Boolean,
      default: false,
    },

    attendanceMethod: {
      type: String,
      enum: ['BIOMETRIC', 'QR', 'MANUAL', 'APP'],
      default: 'QR',
    },

    biometricEnrolmentId: {
      type: String,
      trim: true,
      default: null,
    },

    employeeBadgeQrId: {
      type: String,
      trim: true,
      default: null,
    },

    systemAccountCreated: {
      type: Boolean,
      default: true,
    },

    // ── Stage 04: Section 7 — Assets ─────────────────────────────────────────
    assignedAssets: {
      type: [employeeAssetEntrySchema],
      default: [],
    },

    // ── Stage 04: Section 8 — Training ───────────────────────────────────────
    trainingRecords: {
      type: [employeeTrainingEntrySchema],
      default: [],
    },

    // ── Stage 04: Section 9 & 04.2 — Onboarding Readiness Checklist ──────────
    onboardingChecklist: {
      personalDetails: { type: Boolean, default: false },
      employmentDetails: { type: Boolean, default: false },
      bankDetails: { type: Boolean, default: false },
      requiredDocuments: { type: Boolean, default: false },
      payrollConfiguration: { type: Boolean, default: false },
      department: { type: Boolean, default: false },
      shift: { type: Boolean, default: false },
      manager: { type: Boolean, default: false },
      systemAccount: { type: Boolean, default: false },
      permissions: { type: Boolean, default: false },
      attendanceEnrolment: { type: Boolean, default: false },
      trainingInduction: { type: Boolean, default: false },
    },

    isReadyForActivation: {
      type: Boolean,
      default: false,
      index: true,
    },

    // ── Stage 04: 04.3 — DPDP Act 2023 / Rules 2025 Compliance ───────────────
    dpdpCompliance: {
      consentObtained: { type: Boolean, default: true },
      consentDate: { type: Date, default: Date.now },
      noticeVersion: { type: String, default: 'DPDP-2025-V1' },
      dataRetentionMonths: { type: Number, default: 84 },
      purposeMetadata: {
        type: Map,
        of: String,
        default: () => new Map([
          ['bankDetails', 'Salary disbursement and statutory transfers'],
          ['pan', 'Statutory TDS and income tax compliance'],
          ['uan', 'Employees Provident Fund compliance under EPF Act'],
          ['esiNumber', 'Employees State Insurance benefits under ESI Act'],
          ['aadhaar', 'Identity verification and statutory enrollment'],
          ['emergencyContact', 'Workplace health and emergency notification'],
        ]),
      },
    },

    sensitiveAccessLogs: {
      type: [sensitiveAccessLogSchema],
      default: [],
    },

    recordHold: {
      type: Boolean,
      default: false,
    },

    isPrimaryMaster: {
      type: Boolean,
      required: true,
      default: false,
      immutable: true,
      index: true,
    },

    primaryMasterDesignatedAt: {
      type: Date,
      immutable: true,
      default() {
        return this.isPrimaryMaster ? new Date() : null;
      },
      required() {
        return this.isPrimaryMaster;
      },
    },

    primaryMasterDesignatedBy: {
      type: String,
      trim: true,
      uppercase: true,
      immutable: true,
      default() {
        return this.isPrimaryMaster ? (this.createdBy || 'SYSTEM') : null;
      },
      required() {
        return this.isPrimaryMaster;
      },
    },

    primaryMasterDesignationReason: {
      type: String,
      trim: true,
      maxlength: 2000,
      immutable: true,
      default() {
        return this.isPrimaryMaster ? 'Primary Master bootstrap designation' : null;
      },
      required() {
        return this.isPrimaryMaster;
      },
    },

    primaryMasterProtectionSuspension: {
      type: Boolean,
      default: false,
    },

    statusReason: {
      type: String,
      trim: true,
      maxlength: 1000,
      default: null,
    },

    passwordHash: {
      type: String,
      required: true,
      select: false,
    },

    mustChangePassword: {
      type: Boolean,
      default: true,
    },

    passwordChangedAt: {
      type: Date,
      default: null,
    },

    passwordExpiresAt: {
      type: Date,
      default: null,
    },

    passwordHistoryHashes: {
      type: [String],
      select: false,
      default: [],
    },

    mfaEnabled: {
      type: Boolean,
      default: false,
    },

    mfaMethod: {
      type: String,
      enum: ['NONE', 'TOTP', 'PASSKEY'],
      default: 'NONE',
    },

    mfaSecretEncrypted: {
      type: String,
      select: false,
      default: null,
    },

    pendingMfaSecretEncrypted: {
      type: String,
      select: false,
      default: null,
    },

    recoveryCodeHashes: {
      type: [String],
      select: false,
      default: [],
    },

    lastMfaCounter: {
      type: Number,
      min: 0,
      select: false,
      default: null,
    },

    failedLoginAttempts: {
      type: Number,
      min: 0,
      default: 0,
    },

    lockedUntil: {
      type: Date,
      default: null,
    },

    // Personal Six-Digit Application PIN (ACP-05E-02: Isolated from operatorPinHash)
    appPinHash: {
      type: String,
      select: false,
      default: null,
    },

    appPinFailedAttempts: {
      type: Number,
      min: 0,
      default: 0,
    },

    appPinLockedUntil: {
      type: Date,
      default: null,
    },

    appPinSetAt: {
      type: Date,
      default: null,
    },

    appPinEnabled: {
      type: Boolean,
      default: false,
      index: true,
    },

    operatorPinHash: {
      type: String,
      select: false,
      default: null,
    },

    operatorPinFailedAttempts: {
      type: Number,
      min: 0,
      default: 0,
    },

    operatorPinLockedUntil: {
      type: Date,
      default: null,
    },

    operatorPinSetAt: {
      type: Date,
      default: null,
    },

    cafeOperatorAccess: {
      active: {
        type: Boolean,
        default: false,
      },
      assignedCafeId: {
        type: String,
        trim: true,
        uppercase: true,
        default: null,
      },
      validFrom: {
        type: Date,
        default: null,
      },
      validUntil: {
        type: Date,
        default: null,
      },
      assignedBy: {
        type: String,
        trim: true,
        uppercase: true,
        default: null,
      },
      assignmentReason: {
        type: String,
        trim: true,
        maxlength: 1000,
        default: null,
      },
    },

    lastLoginAt: {
      type: Date,
      default: null,
    },

    lastPasswordResetAt: {
      type: Date,
      default: null,
    },

    sessionVersion: {
      type: Number,
      min: 0,
      default: 0,
    },

    permissionsVersion: {
      type: Number,
      min: 0,
      default: 0,
    },

    roleHistory: {
      type: [roleHistoryEntrySchema],
      default: [],
    },

    cafeAssignmentHistory: {
      type: [cafeAssignmentHistoryEntrySchema],
      default: [],
    },

    preferredLanguage: {
      type: String,
      trim: true,
      default: 'en',
    },

    timezone: {
      type: String,
      immutable: true,
      default: 'Asia/Kolkata',
    },

    archivedAt: {
      type: Date,
      default: null,
    },

    archivedBy: {
      type: String,
      trim: true,
      uppercase: true,
      default: null,
    },

    archiveReason: {
      type: String,
      trim: true,
      maxlength: 500,
      default: null,
    },

    createdBy: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
    },

    updatedBy: {
      type: String,
      trim: true,
      uppercase: true,
      default: null,
    },

    // ── Custom Fields (Capability 26) ─────────────────────────────────────────
    // Arbitrary org-defined key→value metadata. Keys are set by CustomField
    // definitions (see CustomFieldDefinition model). Values are Mixed so they
    // can hold strings, numbers, booleans or ISO-date strings.
    // MASTER-only write; all roles may read (scope-filtered by the controller).
    // Keys are sanitised: alphanumeric + underscore, max 64 chars.
    // Total map size is capped at 50 keys in the controller before save.
    customFields: {
      type: Map,
      of: mongoose.Schema.Types.Mixed,
      default: () => new Map(),
    },
  },
  {
    timestamps: true,
    optimisticConcurrency: true,
    versionKey: 'version',
    collection: 'users',
  }
);

userSchema.index(
  { organisationId: 1, email: 1 },
  { unique: true, name: 'organisation_email_unique' }
);

userSchema.index(
  { organisationId: 1, userId: 1 },
  { unique: true, name: 'organisation_user_id_unique' }
);

userSchema.index(
  { organisationId: 1, role: 1, accountStatus: 1 },
  { name: 'organisation_role_status' }
);

userSchema.index(
  { organisationId: 1, assignedCafeIds: 1, accountStatus: 1 },
  { name: 'organisation_cafe_status' }
);

userSchema.index(
  {
    organisationId: 1,
    employeeSearchTerms: 1,
    accountStatus: 1,
  },
  {
    name:
      'organisation_employee_search_status',
  }
);

userSchema.index(
  {
    organisationId: 1,
    isPrimaryMaster: 1,
  },
  {
    unique: true,
    name: 'organisation_primary_master_unique',
    partialFilterExpression: {
      isPrimaryMaster: true,
    },
  }
);

userSchema.pre('validate', function normalizeUserFields() {
  if (this.email) {
    this.email = this.email.trim().toLowerCase();
  }

  if (this.userId) {
    this.userId = this.userId.trim().toUpperCase();
  }

  if (this.organisationId) {
    this.organisationId = this.organisationId.trim().toUpperCase();
  }

  this.name =
    normalizeOptionalText(this.name);

  this.preferredName =
    normalizeOptionalText(
      this.preferredName
    );

  this.previousNames =
    normalizePreviousNames(
      this.previousNames
    );

  this.employmentType =
    normalizeOptionalText(
      this.employmentType
    );

  this.department =
    normalizeOptionalText(
      this.department
    );

  this.designation =
    normalizeOptionalText(
      this.designation
    );

  if (this.address) {
    for (const field of [
      'line1',
      'line2',
      'city',
      'state',
      'postalCode',
      'country',
    ]) {
      this.address[field] =
        normalizeOptionalText(
          this.address[field]
        );
    }
  }

  if (this.emergencyContact) {
    for (const field of [
      'name',
      'relationship',
      'phone',
    ]) {
      this.emergencyContact[field] =
        normalizeOptionalText(
          this.emergencyContact[field]
        );
    }
  }

  if (this.permanentAddress) {
    for (const field of ['line1', 'line2', 'city', 'state', 'postalCode', 'country']) {
      this.permanentAddress[field] = normalizeOptionalText(this.permanentAddress[field]);
    }
  }

  if (this.currentAddress) {
    for (const field of ['line1', 'line2', 'city', 'state', 'postalCode', 'country']) {
      this.currentAddress[field] = normalizeOptionalText(this.currentAddress[field]);
    }
  }

  if (this.onboardingChecklist) {
    const cl = this.onboardingChecklist;
    this.isReadyForActivation = Boolean(
      cl.personalDetails &&
      cl.employmentDetails &&
      cl.bankDetails &&
      cl.requiredDocuments &&
      cl.payrollConfiguration &&
      cl.department &&
      cl.shift &&
      cl.manager &&
      cl.systemAccount &&
      cl.permissions &&
      cl.attendanceEnrolment &&
      cl.trainingInduction
    );
  }

  if (this.bankDetails) {
    if (this.bankDetails.accountNumber) {
      const acc = String(this.bankDetails.accountNumber).trim();
      this.bankDetails.accountNumberMasked =
        acc.length <= 4 ? '••••' : '•'.repeat(Math.max(0, acc.length - 4)) + acc.slice(-4);
    }
    if (this.bankDetails.ifsc) {
      const ifsc = String(this.bankDetails.ifsc).trim().toUpperCase();
      this.bankDetails.ifscMasked =
        ifsc.length >= 8 ? `${ifsc.slice(0, 4)}•••${ifsc.slice(-2)}` : '•••••••••••';
    }
  }

  if (this.statutoryApplicability) {
    if (this.statutoryApplicability.uan) {
      const uan = String(this.statutoryApplicability.uan).trim();
      this.statutoryApplicability.uanMasked =
        uan.length <= 4 ? '••••' : '•'.repeat(Math.max(0, uan.length - 4)) + uan.slice(-4);
    }
    if (this.statutoryApplicability.esiNumber) {
      const esi = String(this.statutoryApplicability.esiNumber).trim();
      this.statutoryApplicability.esiNumberMasked =
        esi.length <= 4 ? '••••' : '•'.repeat(Math.max(0, esi.length - 4)) + esi.slice(-4);
    }
    if (this.statutoryApplicability.pan) {
      const pan = String(this.statutoryApplicability.pan).trim().toUpperCase();
      this.statutoryApplicability.panMasked =
        pan.length === 10 ? `${pan.slice(0, 2)}•••••${pan.slice(7)}` : '••••••••••';
    }
  }

  this.employeeSearchTerms =
    buildEmployeeSearchTerms({
      name: this.name,
      preferredName:
        this.preferredName,
      previousNames:
        this.previousNames,
    });

  if (this.primaryCafeId) {
    this.primaryCafeId = this.primaryCafeId.trim().toUpperCase();
  }

  if (Array.isArray(this.assignedCafeIds)) {
    this.assignedCafeIds = [
      ...new Set(
        this.assignedCafeIds
          .filter(Boolean)
          .map((cafeId) => cafeId.trim().toUpperCase())
      ),
    ];
  }

  if (this.primaryMasterDesignatedBy) {
    this.primaryMasterDesignatedBy =
      this.primaryMasterDesignatedBy
        .trim()
        .toUpperCase();
  }

  if (Array.isArray(this.roleHistory)) {
    this.roleHistory.forEach((entry) => {
      if (entry.changedBy) {
        entry.changedBy =
          entry.changedBy
            .trim()
            .toUpperCase();
      }
    });
  }

  if (
    Array.isArray(
      this.cafeAssignmentHistory
    )
  ) {
    this.cafeAssignmentHistory.forEach(
      (entry) => {
        entry.previousAssignedCafeIds = [
          ...new Set(
            (
              entry.previousAssignedCafeIds ||
              []
            )
              .filter(Boolean)
              .map((cafeId) =>
                cafeId
                  .trim()
                  .toUpperCase()
              )
          ),
        ];

        entry.assignedCafeIds = [
          ...new Set(
            (entry.assignedCafeIds || [])
              .filter(Boolean)
              .map((cafeId) =>
                cafeId
                  .trim()
                  .toUpperCase()
              )
          ),
        ];

        if (entry.changedBy) {
          entry.changedBy =
            entry.changedBy
              .trim()
              .toUpperCase();
        }
      }
    );
  }

  if (this.isPrimaryMaster) {
    if (this.role !== 'MASTER') {
      this.invalidate(
        'role',
        'The Primary Master must retain the MASTER role.'
      );
    }

    if (this.accountStatus !== 'ACTIVE') {
      this.invalidate(
        'accountStatus',
        'The Primary Master account must remain active.'
      );
    }

    if (this.primaryCafeId) {
      this.invalidate(
        'primaryCafeId',
        'The Primary Master cannot be restricted to a primary café.'
      );
    }

    if (
      Array.isArray(this.assignedCafeIds) &&
      this.assignedCafeIds.length > 0
    ) {
      this.invalidate(
        'assignedCafeIds',
        'The Primary Master cannot be restricted to assigned cafés.'
      );
    }
  } else {
    // Normal Master Decommission Invariant:
    // If role === 'MASTER', isPrimaryMaster MUST be true for all new and active accounts.
    // Inactive legacy records may exist for historical audit integrity, but cannot be active or newly created.
    if (this.role === 'MASTER' && !this.isPrimaryMaster) {
      if (this.isNew || this.accountStatus === 'ACTIVE' || this.isModified('role') || this.isModified('isPrimaryMaster')) {
        this.invalidate(
          'role',
          'The Normal Master persona is permanently retired. The MASTER role is exclusively reserved for Primary Master.'
        );
      }
    }

    if (
      this.primaryMasterDesignatedAt ||
      this.primaryMasterDesignatedBy ||
      this.primaryMasterDesignationReason
    ) {
      this.invalidate(
        'isPrimaryMaster',
        'Primary Master designation metadata requires isPrimaryMaster to be true.'
      );
    }
  }

  if (this.role === 'VENDOR') {
    if (this.isPrimaryMaster) {
      this.invalidate(
        'isPrimaryMaster',
        'Vendor users cannot be designated as Primary Master.'
      );
    }
    if ((this.isNew || this.accountStatus === 'ACTIVE') && !this.vendorId) {
      this.invalidate(
        'vendorId',
        'Vendor persona users must be explicitly linked to a valid vendorId.'
      );
    }
    if (this.primaryCafeId) {
      this.invalidate(
        'primaryCafeId',
        'Vendor users cannot have internal café operational assignments.'
      );
    }
  }
});

userSchema.methods.canAccessCafe = function canAccessCafe(cafeId) {
  if (!cafeId) {
    return false;
  }

  if (this.role === 'VENDOR') {
    return false;
  }

  // Cross-café Master access is restricted strictly to Primary Master
  if (this.role === 'MASTER' && this.isPrimaryMaster === true) {
    return true;
  }

  const normalizedCafeId = cafeId.trim().toUpperCase();

  return this.assignedCafeIds.includes(normalizedCafeId);
};

userSchema.methods.incrementSessionVersion =
  function incrementSessionVersion() {
    this.sessionVersion += 1;
    return this.save();
  };

userSchema.methods.toJSON = function safeUserJSON() {
  const user = this.toObject();

  delete user.passwordHash;
  delete user.passwordHistoryHashes;
  delete user.mfaSecretEncrypted;
  delete user.pendingMfaSecretEncrypted;
  delete user.recoveryCodeHashes;
  delete user.employeeSearchTerms;

  if (user.bankDetails) {
    delete user.bankDetails.accountNumber;
    delete user.bankDetails.ifsc;
  }

  if (user.statutoryApplicability) {
    delete user.statutoryApplicability.uan;
    delete user.statutoryApplicability.esiNumber;
    delete user.statutoryApplicability.pan;
  }

  return user;
};

userSchema.index({ organisationId: 1, primaryCafeId: 1, status: 1 });
userSchema.index({ organisationId: 1, role: 1, status: 1 });
userSchema.index({ organisationId: 1, employeeId: 1 });
userSchema.index({ organisationId: 1, status: 1, name: 1 });

const User =
  mongoose.models.User || mongoose.model('User', userSchema);

module.exports = {
  User,
  USER_ROLES,
  ACCOUNT_STATUSES,
};