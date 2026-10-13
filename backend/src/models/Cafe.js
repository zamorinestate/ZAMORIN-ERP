'use strict';

const mongoose = require('mongoose');

const CAFE_STATUSES = [
  'DRAFT',
  'CONFIGURING',
  'VERIFICATION_REQUIRED',
  'READY_FOR_TESTING',
  'TEST_MODE',
  'READY_FOR_ACTIVATION',
  'ACTIVE',
  'PENDING_OPENING',
  'TEMPORARILY_CLOSED',
  'UNDER_REVIEW',
  'CLOSING',
  'CLOSED',
  'ARCHIVED',
];

const CAFE_TYPES = [
  'CAFE',
  'RESTAURANT',
  'CAFE_AND_RESTAURANT',
  'STANDARD_CAFE',
  'KIOSK',
  'FOOD_COURT',
  'CAMPUS_CAFE',
  'INSTITUTIONAL_CAFE',
  'OTHER',
];

const CAFE_LIFECYCLE_STAGES = [
  'DRAFT',
  'VALIDATION',
  'PREVIEW',
  'CREATED',
  'PROVISIONING',
  'PROVISIONED',
  'VERIFIED',
  'ACTIVATED',
  'PROVISIONING_FAILED',
];

const PAYMENT_METHODS = [
  'CASH',
  'CARD',
  'UPI',
  'BANK_TRANSFER',
  'WALLET',
  'CREDIT',
];

const SERVICE_TYPES = [
  'DINE_IN',
  'TAKEAWAY',
  'DELIVERY',
  'PICKUP',
  'COUNTER_SALE',
  'DEPARTMENT_ORDER',
];

const dayScheduleSchema = new mongoose.Schema(
  {
    isOpen: {
      type: Boolean,
      default: true,
    },

    openingTime: {
      type: String,
      trim: true,
      match: /^([01]\d|2[0-3]):([0-5]\d)$/,
      default: '09:00',
    },

    closingTime: {
      type: String,
      trim: true,
      match: /^([01]\d|2[0-3]):([0-5]\d)$/,
      default: '21:00',
    },
  },
  {
    _id: false,
  }
);

const holidaySchema = new mongoose.Schema(
  {
    date: {
      type: Date,
      required: true,
    },

    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 120,
    },

    isClosed: {
      type: Boolean,
      default: true,
    },

    openingTime: {
      type: String,
      trim: true,
      match: /^([01]\d|2[0-3]):([0-5]\d)$/,
      default: null,
    },

    closingTime: {
      type: String,
      trim: true,
      match: /^([01]\d|2[0-3]):([0-5]\d)$/,
      default: null,
    },
  },
  {
    _id: true,
  }
);

const cafeAdminAssignmentSchema = new mongoose.Schema(
  {
    userId: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
    },

    assignmentType: {
      type: String,
      required: true,
      enum: ['PRIMARY', 'SECONDARY', 'TEMPORARY'],
    },

    effectiveFrom: {
      type: Date,
      required: true,
    },

    effectiveTo: {
      type: Date,
      default: null,
    },

    isActive: {
      type: Boolean,
      default: true,
    },

    assignedBy: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
    },

    assignmentReason: {
      type: String,
      trim: true,
      maxlength: 500,
      default: '',
    },
  },
  {
    _id: true,
    timestamps: true,
  }
);

const cafeSchema = new mongoose.Schema(
  {
    cafeId: {
      type: String,
      required: true,
      unique: true,
      immutable: true,
      trim: true,
      uppercase: true,
      match: /^ZC-(CAF-)?\d{4,}$/,
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
      maxlength: 150,
    },

    displayName: {
      type: String,
      required: true,
      trim: true,
      maxlength: 150,
    },

    legalName: {
      type: String,
      trim: true,
      maxlength: 200,
      default: '',
    },

    branchName: {
      type: String,
      trim: true,
      maxlength: 150,
      default: '',
    },

    establishmentCategory: {
      type: String,
      trim: true,
      default: 'Café',
    },

    dietaryType: {
      type: String,
      trim: true,
      default: 'MIXED',
    },

    dateBusinessStarted: {
      type: Date,
      default: null,
    },

    branchCode: {
      type: String,
      trim: true,
      maxlength: 50,
      default: '',
    },

    internalCafeId: {
      type: String,
      trim: true,
      maxlength: 50,
      default: '',
    },

    storeNumber: {
      type: String,
      trim: true,
      maxlength: 50,
      default: '',
    },

    parentOrganisationId: {
      type: String,
      trim: true,
      default: '',
    },

    templateId: {
      type: String,
      trim: true,
      uppercase: true,
      default: null,
      index: true,
    },

    templateOverrides: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },

    businessDayCutoffHour: {
      type: Number,
      default: 4,
      min: 0,
      max: 12,
    },

    // Payment-Gated Kitchen Dispatch (F036)
    paymentGatedKitchenDispatch: {
      type: Boolean,
      default: false,
    },

    // Mandatory Tender Selection Mode (F011)
    mandatoryTenderSelection: {
      type: Boolean,
      default: false,
    },

    // Pre-Tax vs Post-Tax Tip Base (F074, F075)
    tipCalculationBase: {
      type: String,
      enum: ['PRE_TAX_SUBTOTAL', 'POST_TAX_GRAND_TOTAL'],
      default: 'PRE_TAX_SUBTOTAL',
    },

    // Irreversible Historical Stock Freeze Date (F188–F191)
    historicalStockFreezeDate: {
      type: Date,
      default: null,
    },

    legalConstitution: {
      constitution: {
        type: String,
        trim: true,
        default: 'PROPRIETORSHIP',
      },
      legalOwnerName: {
        type: String,
        trim: true,
        default: '',
      },
      partnersDirectors: [
        {
          type: String,
          trim: true,
        },
      ],
      authorisedSignatory: {
        type: String,
        trim: true,
        default: '',
      },
      pan: {
        type: String,
        trim: true,
        uppercase: true,
        default: '',
      },
      cin: {
        type: String,
        trim: true,
        uppercase: true,
        default: '',
      },
      registrationNumber: {
        type: String,
        trim: true,
        default: '',
      },
      incorporationDate: {
        type: Date,
        default: null,
      },
      registeredOfficeAddress: {
        type: String,
        trim: true,
        default: '',
      },
      udyamNumber: {
        type: String,
        trim: true,
        default: '',
      },
      udyamRegistrationDate: {
        type: Date,
        default: null,
      },
      enterpriseClassification: {
        type: String,
        trim: true,
        default: '',
      },
    },

    contactProfile: {
      primaryContact: {
        name: { type: String, trim: true, default: '' },
        designation: { type: String, trim: true, default: '' },
        mobile: { type: String, trim: true, default: '' },
        alternateMobile: { type: String, trim: true, default: '' },
        whatsapp: { type: String, trim: true, default: '' },
        email: { type: String, trim: true, default: '' },
        secondaryEmail: { type: String, trim: true, default: '' },
      },
      emergencyContact: {
        name: { type: String, trim: true, default: '' },
        role: { type: String, trim: true, default: '' },
        phone: { type: String, trim: true, default: '' },
        alternatePhone: { type: String, trim: true, default: '' },
      },
      communicationPreference: {
        type: String,
        trim: true,
        enum: ['EMAIL', 'SMS', 'WHATSAPP', 'IN_APP', ''],
        default: 'EMAIL',
      },
    },

    cafeType: {
      type: String,
      required: true,
      enum: CAFE_TYPES,
      default: 'STANDARD_CAFE',
    },

    groupName: {
      type: String,
      trim: true,
      maxlength: 120,
      default: '',
    },

    status: {
      type: String,
      required: true,
      enum: CAFE_STATUSES,
      default: 'DRAFT',
      index: true,
    },

    lifecycleStage: {
      type: String,
      enum: CAFE_LIFECYCLE_STAGES,
      default: 'DRAFT',
      index: true,
    },

    lifecycleHistory: [
      {
        fromStage: String,
        toStage: String,
        transitionedAt: { type: Date, default: Date.now },
        transitionedBy: String,
        reason: String,
        metadata: mongoose.Schema.Types.Mixed,
      },
    ],

    openingDate: {
      type: Date,
      default: null,
    },

    businessDateCutoffTime: {
      type: String,
      trim: true,
      match: /^([01]\d|2[0-3]):([0-5]\d)$/,
      default: '23:59',
    },

    timezone: {
      type: String,
      immutable: true,
      default: 'Asia/Kolkata',
    },

    currency: {
      type: String,
      immutable: true,
      enum: ['INR'],
      default: 'INR',
    },

    address: {
      building: {
        type: String,
        trim: true,
        maxlength: 120,
        default: '',
      },

      unit: {
        type: String,
        trim: true,
        maxlength: 60,
        default: '',
      },

      floor: {
        type: String,
        trim: true,
        maxlength: 60,
        default: '',
      },

      street: {
        type: String,
        trim: true,
        maxlength: 200,
        default: '',
      },

      area: {
        type: String,
        trim: true,
        maxlength: 120,
        default: '',
      },

      city: {
        type: String,
        trim: true,
        maxlength: 100,
        default: '',
      },

      district: {
        type: String,
        trim: true,
        maxlength: 100,
        default: '',
      },

      state: {
        type: String,
        trim: true,
        maxlength: 100,
        default: 'Karnataka',
      },

      pinCode: {
        type: String,
        trim: true,
        match: /^[1-9][0-9]{5}$/,
        default: '',
      },

      landmark: {
        type: String,
        trim: true,
        maxlength: 200,
        default: '',
      },

      latitude: {
        type: Number,
        min: -90,
        max: 90,
        default: null,
      },

      longitude: {
        type: Number,
        min: -180,
        max: 180,
        default: null,
      },

      geofenceRadiusMetres: {
        type: Number,
        min: 0,
        max: 10000,
        default: 100,
      },

      doorNumber: {
        type: String,
        trim: true,
        default: '',
      },

      possessionType: {
        type: String,
        trim: true,
        enum: ['OWNED', 'RENTED', 'LEASED', 'FRANCHISE', ''],
        default: '',
      },

      leaseStartDate: {
        type: Date,
        default: null,
      },

      leaseEndDate: {
        type: Date,
        default: null,
      },

      mapsLink: {
        type: String,
        trim: true,
        default: '',
      },
    },

    contacts: {
      primaryPhone: {
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

      email: {
        type: String,
        trim: true,
        lowercase: true,
        maxlength: 254,
        default: '',
      },
    },

    registrations: {
      gstin: {
        type: String,
        trim: true,
        uppercase: true,
        maxlength: 15,
        default: '',
      },

      gstDetails: {
        isRegistered: { type: Boolean, default: false },
        gstin: { type: String, trim: true, uppercase: true, default: '' },
        legalName: { type: String, trim: true, default: '' },
        tradeName: { type: String, trim: true, default: '' },
        registrationDate: { type: Date, default: null },
        stateCode: { type: String, trim: true, default: '' },
        taxpayerType: { type: String, trim: true, default: 'REGULAR' },
        principalPlace: { type: String, trim: true, default: '' },
        certificateUrl: { type: String, trim: true, default: '' },
        effectiveDate: { type: Date, default: null },
        status: { type: String, trim: true, default: 'ACTIVE' },
        verificationStatus: {
          type: String,
          enum: ['NOT_APPLICABLE', 'FORMAT_VALIDATED', 'DOCUMENT_PROVIDED', 'EXTERNALLY_VERIFIED'],
          default: 'NOT_APPLICABLE',
        },
        documentAttachmentId: { type: String, trim: true, default: null },
      },

      pan: {
        type: String,
        trim: true,
        uppercase: true,
        maxlength: 10,
        default: '',
      },

      municipalId: {
        type: String,
        trim: true,
        uppercase: true,
        maxlength: 100,
        default: '',
      },

      fssai: {
        isApplicable: { type: Boolean, default: true },
        number: { type: String, trim: true, default: '' },
        category: {
          type: String,
          enum: ['REGISTRATION', 'STATE_LICENCE', 'CENTRAL_LICENCE'],
          default: 'STATE_LICENCE',
        },
        licenseType: { type: String, trim: true, default: 'State Licence' },
        kindOfBusiness: { type: String, trim: true, default: 'Food Service / Café' },
        issuingAuthority: { type: String, trim: true, default: 'FSSAI FoSCoS' },
        validFrom: { type: Date, default: null },
        validTill: { type: Date, default: null }, // Optional legacy field
        isPerpetual: { type: Boolean, default: true },
        status: {
          type: String,
          enum: ['ACTIVE', 'SUSPENDED', 'CANCELLED', 'SURRENDERED', 'UNDER_REVIEW'],
          default: 'ACTIVE',
        },
        annualFeeInr: { type: Number, default: 0 },
        annualFeeHistory: [
          {
            financialYear: String,
            amount: Number,
            paidAt: Date,
            transactionReference: String,
          },
        ],
        fostacCompliant: { type: Boolean, default: false },
        certificateUrl: { type: String, trim: true, default: '' },
        certificateAttachmentId: { type: String, trim: true, default: null },
        renewalReminderDate: { type: Date, default: null },
      },

      licenceNumbers: [
        {
          type: String,
          trim: true,
          uppercase: true,
        },
      ],

      otherRegistrations: [
        {
          name: { type: String, trim: true },
          registrationNumber: { type: String, trim: true, default: '' },
          status: { type: String, trim: true, enum: ['APPLICABLE', 'NOT_APPLICABLE', 'PENDING'], default: 'APPLICABLE' },
          validTill: { type: Date, default: null },
          documentUrl: { type: String, trim: true, default: '' },
        },
      ],
    },

    businessHours: {
      monday: {
        type: dayScheduleSchema,
        default: () => ({}),
      },

      tuesday: {
        type: dayScheduleSchema,
        default: () => ({}),
      },

      wednesday: {
        type: dayScheduleSchema,
        default: () => ({}),
      },

      thursday: {
        type: dayScheduleSchema,
        default: () => ({}),
      },

      friday: {
        type: dayScheduleSchema,
        default: () => ({}),
      },

      saturday: {
        type: dayScheduleSchema,
        default: () => ({}),
      },

      sunday: {
        type: dayScheduleSchema,
        default: () => ({}),
      },
    },

    holidays: {
      type: [holidaySchema],
      default: [],
    },

    weeklyOffDays: [
      {
        type: String,
        enum: [
          'MONDAY',
          'TUESDAY',
          'WEDNESDAY',
          'THURSDAY',
          'FRIDAY',
          'SATURDAY',
          'SUNDAY',
        ],
      },
    ],

    serviceTypes: [
      {
        type: String,
        enum: SERVICE_TYPES,
      },
    ],

    paymentMethods: [
      {
        type: String,
        enum: PAYMENT_METHODS,
      },
    ],

    operations: {
      seatingCapacity: {
        type: Number,
        min: 0,
        default: 0,
      },

      counterCount: {
        type: Number,
        min: 0,
        default: 1,
      },

      cashPointCount: {
        type: Number,
        min: 0,
        default: 1,
      },

      storageLocationCount: {
        type: Number,
        min: 0,
        default: 1,
      },

      tableCount: {
        type: Number,
        min: 0,
        default: 0,
      },

      splitShifts: {
        type: Boolean,
        default: false,
      },

      floorZoneStructure: {
        type: String,
        trim: true,
        default: '',
      },

      kitchenSections: [
        {
          type: String,
          trim: true,
        },
      ],

      prepStations: [
        {
          type: String,
          trim: true,
        },
      ],

      kotRouting: {
        type: String,
        trim: true,
        default: 'STANDARD',
      },

      serviceChargePolicy: {
        type: String,
        trim: true,
        default: '',
      },

      cancellationPolicy: {
        type: String,
        trim: true,
        default: '',
      },

      refundPolicy: {
        type: String,
        trim: true,
        default: '',
      },

      discountPolicy: {
        type: String,
        trim: true,
        default: '',
      },

      orderNumberingScheme: {
        type: String,
        trim: true,
        default: 'DAILY_RESET',
      },
    },

    staffing: {
      minimumStaff: {
        type: Number,
        min: 0,
        default: 0,
      },

      maximumStaff: {
        type: Number,
        min: 0,
        default: 0,
      },

      plannedLabourBudget: {
        type: Number,
        min: 0,
        default: 0,
      },

      defaultShiftPattern: {
        type: String,
        trim: true,
        maxlength: 120,
        default: '',
      },
    },

    finance: {
      costCentreCode: {
        type: String,
        trim: true,
        uppercase: true,
        maxlength: 50,
        default: '',
      },

      profitCentreCode: {
        type: String,
        trim: true,
        uppercase: true,
        maxlength: 50,
        default: '',
      },

      monthlyBudget: {
        type: Number,
        min: 0,
        default: 0,
      },

      monthlySalesTarget: {
        type: Number,
        min: 0,
        default: 0,
      },

      monthlyLabourBudget: {
        type: Number,
        min: 0,
        default: 0,
      },

      monthlyRent: {
        type: Number,
        min: 0,
        default: 0,
      },

      openingCashRequired: {
        type: Boolean,
        default: true,
      },

      defaultOpeningCash: {
        type: Number,
        min: 0,
        default: 0,
      },

      banking: {
        accountHolderName: {
          type: String,
          trim: true,
          default: '',
        },
        bankName: {
          type: String,
          trim: true,
          default: '',
        },
        branch: {
          type: String,
          trim: true,
          default: '',
        },
        accountNumber: {
          type: String,
          trim: true,
          default: '',
        },
        accountNumberMasked: {
          type: String,
          trim: true,
          default: '',
        },
        ifsc: {
          type: String,
          trim: true,
          uppercase: true,
          default: '',
        },
        accountType: {
          type: String,
          trim: true,
          enum: ['CURRENT', 'SAVINGS', ''],
          default: 'CURRENT',
        },
        upiId: {
          type: String,
          trim: true,
          default: '',
        },
        merchantId: {
          type: String,
          trim: true,
          default: '',
        },
        settlementAccount: {
          type: String,
          trim: true,
          default: '',
        },
        cashOpeningBalance: {
          type: Number,
          default: 0,
        },
        accountingYear: {
          type: String,
          trim: true,
          default: '2026-2027',
        },
        financialYear: {
          type: String,
          trim: true,
          default: '2026-2027',
        },
        currency: {
          type: String,
          trim: true,
          default: 'INR',
        },
        taxRoundingMethod: {
          type: String,
          trim: true,
          default: 'ROUND_HALF_UP',
        },
      },
    },

    inventorySetup: {
      enabled: {
        type: Boolean,
        default: true,
      },

      globalMasterDataPublished: {
        type: Boolean,
        default: false,
      },

      openingStockCompleted: {
        type: Boolean,
        default: false,
      },

      mainStore: {
        type: String,
        trim: true,
        default: 'Main Store',
      },

      subStore: {
        type: String,
        trim: true,
        default: '',
      },

      kitchenStore: {
        type: String,
        trim: true,
        default: 'Kitchen Store',
      },

      dryStorage: {
        type: String,
        trim: true,
        default: 'Dry Storage',
      },

      coldStorageLocations: [
        {
          type: String,
          trim: true,
        },
      ],

      defaultSuppliers: [
        {
          type: String,
          trim: true,
        },
      ],

      stockValuationMethod: {
        type: String,
        trim: true,
        default: 'FIFO',
      },

      uoms: [
        {
          type: String,
          trim: true,
        },
      ],

      reorderPolicy: {
        type: String,
        trim: true,
        default: 'PAR_LEVEL',
      },

      openingStockImported: {
        type: Boolean,
        default: false,
      },

      batchExpiryTracking: {
        type: Boolean,
        default: true,
      },

      wastePolicy: {
        type: String,
        trim: true,
        default: 'DAILY_AUDIT',
      },
    },

    branding: {
      logoUrl: {
        type: String,
        trim: true,
        default: '',
      },

      companyLogoUrl: {
        type: String,
        trim: true,
        default: '',
      },

      cafeLogoUrl: {
        type: String,
        trim: true,
        default: '',
      },

      legalEntityName: {
        type: String,
        trim: true,
        default: 'Zamorin Speciality Coffee & Kitchens Pvt. Ltd.',
      },

      tradeName: {
        type: String,
        trim: true,
        default: 'Zamorin Café',
      },

      primaryBrandColor: {
        type: String,
        trim: true,
        default: '#16223F',
      },

      addressText: {
        type: String,
        trim: true,
        default: '',
      },

      phoneText: {
        type: String,
        trim: true,
        default: '',
      },

      emailText: {
        type: String,
        trim: true,
        default: '',
      },

      websiteText: {
        type: String,
        trim: true,
        default: 'https://zamorin.app',
      },

      receiptFooter: {
        type: String,
        trim: true,
        maxlength: 500,
        default: '',
      },

      reportFooter: {
        type: String,
        trim: true,
        maxlength: 500,
        default: '',
      },

      invoiceFooterText: {
        type: String,
        trim: true,
        maxlength: 500,
        default: 'Thank you for dining with Zamorin Café.',
      },

      authorizedSignatoryName: {
        type: String,
        trim: true,
        default: '',
      },

      authorizedSignatoryDesignation: {
        type: String,
        trim: true,
        default: 'Managing Director',
      },
    },

    hardwareReadiness: {
      posTerminals: { type: Boolean, default: false },
      androidTablets: { type: Boolean, default: false },
      desktopLaptop: { type: Boolean, default: false },
      thermalPrinters: { type: Boolean, default: false },
      kitchenPrinter: { type: Boolean, default: false },
      a4Printer: { type: Boolean, default: false },
      barcodeScanner: { type: Boolean, default: false },
      qrScanner: { type: Boolean, default: false },
      biometricDevice: { type: Boolean, default: false },
      cashDrawer: { type: Boolean, default: false },
      customerDisplay: { type: Boolean, default: false },
      weighingScale: { type: Boolean, default: false },
      labelPrinter: { type: Boolean, default: false },
      cctvIntegration: { type: Boolean, default: false },
      internetConnection: { type: Boolean, default: false },
      backupInternet: { type: Boolean, default: false },
      routerNetwork: { type: Boolean, default: false },
      powerBackup: { type: Boolean, default: false },
      notes: { type: String, default: '' },
    },

    qrLoginContext: {
      qrRecordId: { type: String, trim: true, default: null },
      securePublicCafeReference: { type: String, trim: true, default: null },
      loginUrl: { type: String, trim: true, default: null },
      status: { type: String, trim: true, default: 'ACTIVE' },
      lastScannedAt: { type: Date, default: null },
      scanCount: { type: Number, default: 0 },
    },

    readinessChecklist: {
      qrLoginTest: { type: Boolean, default: false },
      employeeLoginTest: { type: Boolean, default: false },
      posTest: { type: Boolean, default: false },
      printerTest: { type: Boolean, default: false },
      orderTest: { type: Boolean, default: false },
      inventoryTest: { type: Boolean, default: false },
      reportTest: { type: Boolean, default: false },
      pdfExportTest: { type: Boolean, default: false },
      excelExportTest: { type: Boolean, default: false },
      roleBoundaryTest: { type: Boolean, default: false },
    },

    readinessHistory: [
      {
        fromStatus: { type: String, trim: true },
        toStatus: { type: String, trim: true },
        changedBy: { type: String, trim: true },
        changedAt: { type: Date, default: Date.now },
        reason: { type: String, trim: true, default: '' },
        testResults: { type: mongoose.Schema.Types.Mixed, default: null },
      },
    ],

    cafeAdminAssignments: {
      type: [cafeAdminAssignmentSchema],
      default: [],
    },

    operationsPinHash: {
      type: String,
      select: false,
      default: null,
    },

    operationsPinSetAt: {
      type: Date,
      default: null,
    },

    operationsPinFailedAttempts: {
      type: Number,
      min: 0,
      default: 0,
    },

    operationsPinLockedUntil: {
      type: Date,
      default: null,
    },

    approvalThresholds: {
      expenseSubmissionWarningAmount: {
        type: Number,
        min: 0,
        default: 0,
      },

      cashVarianceWarningAmount: {
        type: Number,
        min: 0,
        default: 0,
      },

      departmentOrderCreditLimit: {
        type: Number,
        min: 0,
        default: 0,
      },

      stockAdjustmentWarningAmount: {
        type: Number,
        min: 0,
        default: 0,
      },
    },

    notificationRecipients: [
      {
        type: String,
        trim: true,
        uppercase: true,
      },
    ],

    closure: {
      closedAt: {
        type: Date,
        default: null,
      },

      closedBy: {
        type: String,
        trim: true,
        uppercase: true,
        default: null,
      },

      closureReason: {
        type: String,
        trim: true,
        maxlength: 1000,
        default: '',
      },
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
      maxlength: 1000,
      default: '',
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
  },
  {
    timestamps: true,
    optimisticConcurrency: true,
    versionKey: 'version',
    collection: 'cafes',
  }
);

cafeSchema.index(
  {
    organisationId: 1,
    status: 1,
    name: 1,
  },
  {
    name: 'organisation_status_name',
  }
);

cafeSchema.index(
  {
    organisationId: 1,
    'address.city': 1,
    status: 1,
  },
  {
    name: 'organisation_city_status',
  }
);

cafeSchema.index(
  {
    organisationId: 1,
    'cafeAdminAssignments.userId': 1,
    status: 1,
  },
  {
    name: 'organisation_admin_status',
  }
);

cafeSchema.pre('validate', function normalizeCafeFields() {
  if (this.cafeId) {
    this.cafeId = this.cafeId.trim().toUpperCase();
  }

  if (this.organisationId) {
    this.organisationId =
      this.organisationId.trim().toUpperCase();
  }

  if (this.contacts?.email) {
    this.contacts.email =
      this.contacts.email.trim().toLowerCase();
  }

  if (this.registrations?.gstin) {
    this.registrations.gstin =
      this.registrations.gstin.trim().toUpperCase();
  }

  if (this.registrations?.pan) {
    this.registrations.pan =
      this.registrations.pan.trim().toUpperCase();
  }

  if (Array.isArray(this.serviceTypes)) {
    this.serviceTypes = [...new Set(this.serviceTypes)];
  }

  if (Array.isArray(this.paymentMethods)) {
    this.paymentMethods = [...new Set(this.paymentMethods)];
  }

  if (
    this.staffing.maximumStaff > 0 &&
    this.staffing.minimumStaff >
      this.staffing.maximumStaff
  ) {
    this.invalidate(
      'staffing.minimumStaff',
      'Minimum staff cannot exceed maximum staff.'
    );
  }
});

cafeSchema.methods.isOperational =
  function isOperational() {
    return this.status === 'ACTIVE';
  };

cafeSchema.methods.hasActiveAdmin =
  function hasActiveAdmin(userId) {
    const normalizedUserId =
      userId?.trim().toUpperCase();

    if (!normalizedUserId) {
      return false;
    }

    const now = new Date();

    return this.cafeAdminAssignments.some(
      (assignment) =>
        assignment.userId === normalizedUserId &&
        assignment.isActive &&
        assignment.effectiveFrom <= now &&
        (!assignment.effectiveTo ||
          assignment.effectiveTo >= now)
    );
  };

cafeSchema.methods.archive = function archive({
  userId,
  reason,
}) {
  if (!userId || !reason) {
    throw new Error(
      'Archiving requires a user ID and reason.'
    );
  }

  this.status = 'ARCHIVED';
  this.archivedAt = new Date();
  this.archivedBy = userId.trim().toUpperCase();
  this.archiveReason = reason.trim();

  return this.save();
};

const READINESS_CHECKLIST_KEYS = [
  'qrLoginTest',
  'employeeLoginTest',
  'posTest',
  'printerTest',
  'orderTest',
  'inventoryTest',
  'reportTest',
  'pdfExportTest',
  'excelExportTest',
  'roleBoundaryTest',
];

const READINESS_STATES = [
  'DRAFT',
  'CONFIGURING',
  'VERIFICATION_REQUIRED',
  'READY_FOR_TESTING',
  'TEST_MODE',
  'READY_FOR_ACTIVATION',
  'ACTIVE',
];

cafeSchema.methods.isTestModeComplete = function isTestModeComplete() {
  const checklist = this.readinessChecklist || {};
  return READINESS_CHECKLIST_KEYS.every((key) => Boolean(checklist[key]));
};

cafeSchema.methods.computeExpiryAlerts = function computeExpiryAlerts(referenceDate = new Date()) {
  const alerts = [];
  const ref = new Date(referenceDate).getTime();

  function evaluateExpiry(name, number, validTillDate, isApplicable = true) {
    if (!isApplicable || !validTillDate) return;
    const expiryTime = new Date(validTillDate).getTime();
    if (isNaN(expiryTime)) return;

    const diffDays = Math.ceil((expiryTime - ref) / (1000 * 60 * 60 * 24));
    let alertLevel = 'VALID';
    if (diffDays <= 0) alertLevel = 'EXPIRED';
    else if (diffDays <= 7) alertLevel = 'EXPIRING_7';
    else if (diffDays <= 15) alertLevel = 'EXPIRING_15';
    else if (diffDays <= 30) alertLevel = 'EXPIRING_30';
    else if (diffDays <= 60) alertLevel = 'EXPIRING_60';
    else if (diffDays <= 90) alertLevel = 'EXPIRING_90';

    if (alertLevel !== 'VALID') {
      alerts.push({
        licenceType: name,
        licenceNumber: number || '',
        validTill: new Date(validTillDate).toISOString().slice(0, 10),
        daysRemaining: diffDays,
        alertLevel,
      });
    }
  }

  // FSSAI Licence evaluation
  if (this.registrations?.fssai?.validTill) {
    evaluateExpiry(
      'FSSAI Licence',
      this.registrations.fssai.number,
      this.registrations.fssai.validTill,
      this.registrations.fssai.isApplicable !== false
    );
  }

  // Other Registrations evaluation
  if (Array.isArray(this.registrations?.otherRegistrations)) {
    for (const reg of this.registrations.otherRegistrations) {
      if (reg.status === 'APPLICABLE' && reg.validTill) {
        evaluateExpiry(reg.name, reg.registrationNumber, reg.validTill, true);
      }
    }
  }

  return alerts;
};

const Cafe =
  mongoose.models.Cafe ||
  mongoose.model('Cafe', cafeSchema);

module.exports = {
  Cafe,
  CAFE_STATUSES,
  CAFE_TYPES,
  CAFE_LIFECYCLE_STAGES,
  PAYMENT_METHODS,
  SERVICE_TYPES,
  READINESS_CHECKLIST_KEYS,
  READINESS_STATES,
};