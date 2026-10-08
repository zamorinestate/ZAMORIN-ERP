'use strict';

/**
 * VENDOR / SUPPLIER — MONGOOSE MODEL (SCR-025)
 *
 * Authoritative enterprise supplier master and source governance entity.
 * Supports:
 *   - Multi-site definitions (Registered Office, Warehouse, Dispatch, Billing, Service Centre)
 *   - Multi-contact routing (Sales, Accounts, Dispatch, Service, Compliance, Escalation)
 *   - Supplier type categorization (GOODS, SERVICES, GOODS_AND_SERVICES)
 *   - Café-specific assignments & commercial agreements
 *   - Qualification areas & statutory compliance (FSSAI, GST, Quality, Tax)
 *   - Item catalogue with pack/UOM conversions & effective-dated price histories
 *   - High-risk master data fraud controls (Maker-checker bank account modification queue)
 *   - Scoped supplier holds (Block POs, Block Site, Block Item, Quality Hold)
 *   - Performance metrics & OTIF tracking rollups
 */

const mongoose = require('mongoose');

const VENDOR_STATUSES = [
  'ACTIVE',
  'SUSPENDED',
  'BLACKLISTED',
  'ARCHIVED',
  'DRAFT',
  'ONBOARDING',
];

const SUPPLIER_TYPES = [
  'GOODS',
  'SERVICES',
  'GOODS_AND_SERVICES',
];

const VENDOR_CATEGORIES = [
  'FOOD_BEVERAGE',
  'PACKAGING',
  'CLEANING_SUPPLIES',
  'EQUIPMENT',
  'STATIONERY',
  'SERVICES',
  'TECHNOLOGY',
  'OTHER',
];

const PAYMENT_TERMS = [
  'COD',           // Cash on delivery
  'NET_7',
  'NET_15',
  'NET_30',
  'NET_45',
  'NET_60',
  'ADVANCE',
  'CREDIT',
];

const SOURCE_PRIORITIES = [
  'PREFERRED',
  'APPROVED',
  'ALTERNATE',
  'EMERGENCY_ONLY',
  'SUSPENDED',
  'NOT_APPROVED',
];

const bankDetailsSchema = new mongoose.Schema(
  {
    accountHolderName: { type: String, trim: true, maxlength: 200, default: '' },
    bankName: { type: String, trim: true, maxlength: 200, default: '' },
    accountNumber: { type: String, trim: true, maxlength: 50, default: '' },
    accountNumberMasked: { type: String, trim: true, maxlength: 50, default: '' },
    ifscCode: { type: String, trim: true, uppercase: true, maxlength: 20, default: '' },
    branchName: { type: String, trim: true, maxlength: 200, default: '' },
    upiId: { type: String, trim: true, maxlength: 100, default: '' },
  },
  { _id: false }
);

const pendingBankChangeSchema = new mongoose.Schema(
  {
    changeId: { type: String, required: true, trim: true, uppercase: true },
    accountHolderName: { type: String, trim: true, maxlength: 200, default: '' },
    bankName: { type: String, trim: true, maxlength: 200, default: '' },
    accountNumber: { type: String, trim: true, maxlength: 50, default: '' },
    accountNumberMasked: { type: String, trim: true, maxlength: 50, default: '' },
    ifscCode: { type: String, trim: true, uppercase: true, maxlength: 20, default: '' },
    branchName: { type: String, trim: true, maxlength: 200, default: '' },
    upiId: { type: String, trim: true, maxlength: 100, default: '' },
    justification: { type: String, trim: true, maxlength: 2000, default: '' },
    requestedByUserId: { type: String, required: true, trim: true, uppercase: true },
    requestedAt: { type: Date, default: Date.now },
    status: {
      type: String,
      enum: ['PENDING', 'APPROVED', 'REJECTED'],
      default: 'PENDING',
    },
    approvedByUserId: { type: String, trim: true, uppercase: true, default: null },
    approvedAt: { type: Date, default: null },
    decisionNotes: { type: String, trim: true, maxlength: 2000, default: '' },
  },
  { _id: true }
);

const contactPersonSchema = new mongoose.Schema(
  {
    contactId: { type: String, trim: true, uppercase: true },
    name: { type: String, required: true, trim: true, maxlength: 200 },
    role: { type: String, trim: true, maxlength: 100, default: '' },
    department: {
      type: String,
      enum: ['SALES', 'ACCOUNTS', 'DISPATCH', 'SERVICE', 'COMPLIANCE', 'ESCALATION', 'MANAGEMENT', 'GENERAL'],
      default: 'GENERAL',
    },
    phone: { type: String, trim: true, maxlength: 20, default: '' },
    email: { type: String, trim: true, lowercase: true, maxlength: 200, default: '' },
    isPrimary: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true },
  },
  { _id: true }
);

const addressSchema = new mongoose.Schema(
  {
    line1: { type: String, trim: true, maxlength: 300, default: '' },
    line2: { type: String, trim: true, maxlength: 300, default: '' },
    city: { type: String, trim: true, maxlength: 100, default: '' },
    state: { type: String, trim: true, maxlength: 100, default: '' },
    pincode: { type: String, trim: true, maxlength: 20, default: '' },
    country: { type: String, trim: true, maxlength: 100, default: 'India' },
  },
  { _id: false }
);

const supplierSiteSchema = new mongoose.Schema(
  {
    siteId: { type: String, required: true, trim: true, uppercase: true },
    siteName: { type: String, required: true, trim: true, maxlength: 200 },
    siteType: {
      type: String,
      enum: ['REGISTERED_OFFICE', 'WAREHOUSE', 'DISPATCH_LOCATION', 'BILLING_OFFICE', 'SERVICE_CENTRE', 'PRIMARY'],
      default: 'WAREHOUSE',
    },
    address: { type: addressSchema, default: () => ({}) },
    primaryContactName: { type: String, trim: true, maxlength: 200, default: '' },
    phone: { type: String, trim: true, maxlength: 20, default: '' },
    email: { type: String, trim: true, lowercase: true, maxlength: 200, default: '' },
    leadTimeDays: { type: Number, min: 0, default: 2 },
    deliveryCutoffTime: { type: String, trim: true, default: '16:00' },
    deliveryDays: [{ type: String, trim: true }],
    approvedCafeIds: [{ type: String, trim: true, uppercase: true }],
    status: { type: String, enum: ['ACTIVE', 'INACTIVE', 'SUSPENDED'], default: 'ACTIVE' },
  },
  { _id: true }
);

const supplierQualificationSchema = new mongoose.Schema(
  {
    qualificationId: { type: String, required: true, trim: true, uppercase: true },
    area: {
      type: String,
      enum: ['LEGAL', 'TAX', 'FOOD_SAFETY_FSSAI', 'QUALITY', 'COMMERCIAL', 'DELIVERY', 'TECHNICAL', 'CONTINUITY'],
      required: true,
    },
    status: {
      type: String,
      enum: ['QUALIFIED', 'QUALIFIED_WITH_CONDITIONS', 'REVIEW_REQUIRED', 'NOT_QUALIFIED', 'EXPIRED'],
      default: 'QUALIFIED',
    },
    effectiveDate: { type: Date, default: Date.now },
    expiryDate: { type: Date, default: null },
    reviewedByUserId: { type: String, trim: true, uppercase: true, default: null },
    reviewedAt: { type: Date, default: null },
    notes: { type: String, trim: true, maxlength: 2000, default: '' },
    evidenceDocId: { type: String, trim: true, default: null },
  },
  { _id: true }
);

const priceHistorySchema = new mongoose.Schema(
  {
    effectiveFrom: { type: Date, required: true },
    effectiveTo: { type: Date, default: null },
    pricePaisa: { type: Number, required: true, min: 0 },
    previousPricePaisa: { type: Number, min: 0, default: null },
    changeReason: { type: String, trim: true, maxlength: 1000, default: '' },
    agreementReference: { type: String, trim: true, default: '' },
    approvedByUserId: { type: String, trim: true, uppercase: true, default: null },
    approvedAt: { type: Date, default: null },
  },
  { _id: true }
);

const supplierItemCatalogueSchema = new mongoose.Schema(
  {
    itemId: { type: String, required: true, trim: true, uppercase: true },
    supplierItemCode: { type: String, trim: true, maxlength: 100, default: '' },
    itemName: { type: String, trim: true, maxlength: 200, default: '' },
    uom: { type: String, trim: true, lowercase: true, maxlength: 30, default: 'unit' },
    packSize: { type: String, trim: true, maxlength: 50, default: '1 UNIT' },
    uomConversionFactor: { type: Number, min: 0.0001, default: 1 },
    currentPricePaisa: { type: Number, required: true, min: 0 },
    taxPercent: { type: Number, min: 0, max: 100, default: 5 },
    moq: { type: Number, min: 1, default: 1 },
    orderMultiple: { type: Number, min: 1, default: 1 },
    leadTimeDays: { type: Number, min: 0, default: 2 },
    deliveryDays: [{ type: String, trim: true, uppercase: true }],
    approvedCafeIds: [{ type: String, trim: true, uppercase: true }],
    sourcePriority: {
      type: String,
      enum: SOURCE_PRIORITIES,
      default: 'APPROVED',
    },
    status: { type: String, enum: ['ACTIVE', 'INACTIVE', 'SUSPENDED'], default: 'ACTIVE' },
    priceHistory: [priceHistorySchema],
  },
  { _id: true }
);

const supplierHoldSchema = new mongoose.Schema(
  {
    holdId: { type: String, required: true, trim: true, uppercase: true },
    holdType: {
      type: String,
      enum: ['BLOCK_NEW_POS', 'BLOCK_SITE', 'BLOCK_ITEM', 'BLOCK_CAFE', 'COMPLIANCE_HOLD', 'QUALITY_HOLD', 'PAYMENT_HOLD'],
      required: true,
    },
    scope: { type: String, trim: true, default: 'ORGANISATION' },
    targetEntityId: { type: String, trim: true, default: null },
    reason: { type: String, required: true, trim: true, maxlength: 2000 },
    placedByUserId: { type: String, required: true, trim: true, uppercase: true },
    placedAt: { type: Date, default: Date.now },
    reviewDate: { type: Date, default: null },
    isActive: { type: Boolean, default: true },
    releasedByUserId: { type: String, trim: true, uppercase: true, default: null },
    releasedAt: { type: Date, default: null },
    releaseReason: { type: String, trim: true, maxlength: 2000, default: '' },
  },
  { _id: true }
);

const fssaiSchema = new mongoose.Schema(
  {
    isApplicable: { type: Boolean, default: false },
    licenseNumber: { type: String, trim: true, uppercase: true, maxlength: 30, default: '' },
    category: { type: String, trim: true, default: 'FOOD_SERVICES' },
    isValid: { type: Boolean, default: true },
    expiryDate: { type: Date, default: null },
    lastVerifiedAt: { type: Date, default: null },
    verifiedByUserId: { type: String, trim: true, uppercase: true, default: null },
    verificationSource: { type: String, trim: true, default: 'FoSCoS Digital Registry' },
  },
  { _id: false }
);

const performanceMetricsSchema = new mongoose.Schema(
  {
    otifPercent: { type: Number, min: 0, max: 100, default: 95 },
    onTimeDeliveryPercent: { type: Number, min: 0, max: 100, default: 96 },
    fullDeliveryPercent: { type: Number, min: 0, max: 100, default: 98 },
    fillRatePercent: { type: Number, min: 0, max: 100, default: 100 },
    backorderRatePercent: { type: Number, min: 0, max: 100, default: 0 },
    shortSupplyRatePercent: { type: Number, min: 0, max: 100, default: 0 },
    completeLineFulfillmentRatePercent: { type: Number, min: 0, max: 100, default: 100 },
    rejectionRatePercent: { type: Number, min: 0, max: 100, default: 1.2 },
    averageLeadTimeDays: { type: Number, min: 0, default: 2.1 },
    totalOrdersCount: { type: Number, min: 0, default: 0 },
    totalSpendPaisa: { type: Number, min: 0, default: 0 },
    lastEvaluatedAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const vendorSchema = new mongoose.Schema(
  {
    // ── Business identifier ──────────────────────────────────────────────────
    vendorId: {
      type: String,
      required: true,
      unique: true,
      immutable: true,
      trim: true,
      uppercase: true,
      match: /^VEN-\d{4,}$/,
      index: true,
    },

    // ── Scope ────────────────────────────────────────────────────────────────
    organisationId: {
      type: String,
      required: true,
      immutable: true,
      trim: true,
      uppercase: true,
      index: true,
    },

    // ── Identity ─────────────────────────────────────────────────────────────
    name: {
      type: String,
      required: true,
      trim: true,
      minlength: 1,
      maxlength: 300,
    },

    nameLower: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      index: true,
    },

    tradeName: {
      type: String,
      trim: true,
      maxlength: 300,
      default: '',
    },

    supplierType: {
      type: String,
      required: true,
      enum: SUPPLIER_TYPES,
      default: 'GOODS',
      index: true,
    },

    category: {
      type: String,
      required: true,
      enum: VENDOR_CATEGORIES,
    },

    approvedCafeIds: [
      {
        type: String,
        trim: true,
        uppercase: true,
      },
    ],

    // ── Tax identifiers ───────────────────────────────────────────────────────
    gstNumber: {
      type: String,
      trim: true,
      uppercase: true,
      maxlength: 20,
      default: '',
    },

    panNumber: {
      type: String,
      trim: true,
      uppercase: true,
      maxlength: 15,
      default: '',
    },

    fssaiLicense: {
      type: String,
      trim: true,
      maxlength: 30,
      default: '',
    },

    fssaiDetails: {
      type: fssaiSchema,
      default: () => ({}),
    },

    // ── Contact & Sites ───────────────────────────────────────────────────────
    contactPersons: {
      type: [contactPersonSchema],
      default: [],
    },

    sites: {
      type: [supplierSiteSchema],
      default: [],
    },

    phone: {
      type: String,
      trim: true,
      maxlength: 20,
      default: '',
    },

    email: {
      type: String,
      trim: true,
      lowercase: true,
      maxlength: 200,
      default: '',
    },

    primaryContactEmail: {
      type: String,
      trim: true,
      lowercase: true,
      maxlength: 200,
      default: '',
    },

    accountsEmail: {
      type: String,
      trim: true,
      lowercase: true,
      maxlength: 200,
      default: '',
    },

    salesEmail: {
      type: String,
      trim: true,
      lowercase: true,
      maxlength: 200,
      default: '',
    },

    approvedEmailAddresses: [
      {
        type: String,
        trim: true,
        lowercase: true,
        maxlength: 200,
      },
    ],

    approvedDomains: [
      {
        type: String,
        trim: true,
        lowercase: true,
        maxlength: 150,
      },
    ],

    lastEmailVerifiedAt: {
      type: Date,
      default: null,
    },

    website: {
      type: String,
      trim: true,
      maxlength: 300,
      default: '',
    },

    // ── Address ───────────────────────────────────────────────────────────────
    address: {
      type: addressSchema,
      default: () => ({}),
    },

    // ── Financial ────────────────────────────────────────────────────────────
    paymentTerms: {
      type: String,
      enum: PAYMENT_TERMS,
      default: 'NET_30',
    },

    creditLimitInr: {
      type: Number,
      min: 0,
      default: 0,
    },

    bankDetails: {
      type: bankDetailsSchema,
      default: () => ({}),
    },

    pendingBankChange: {
      type: pendingBankChangeSchema,
      default: null,
    },

    bankDetailsHistory: {
      type: [pendingBankChangeSchema],
      default: [],
    },

    // ── Catalogue, Qualifications, Holds ──────────────────────────────────────
    itemCatalogue: {
      type: [supplierItemCatalogueSchema],
      default: [],
    },

    qualifications: {
      type: [supplierQualificationSchema],
      default: [],
    },

    holds: {
      type: [supplierHoldSchema],
      default: [],
    },

    // ── Rating / performance ──────────────────────────────────────────────────
    reliabilityRating: {
      type: Number,
      min: 1,
      max: 5,
      default: null,
    },

    performanceMetrics: {
      type: performanceMetricsSchema,
      default: () => ({}),
    },

    // ── Status lifecycle ──────────────────────────────────────────────────────
    status: {
      type: String,
      required: true,
      enum: VENDOR_STATUSES,
      default: 'ACTIVE',
      index: true,
    },

    statusChangedAt: {
      type: Date,
      default: null,
    },

    statusChangeReason: {
      type: String,
      trim: true,
      maxlength: 2000,
      default: '',
    },

    statusChangedByUserId: {
      type: String,
      trim: true,
      uppercase: true,
      default: null,
    },

    // ── Contract & Renewal (Capability 02) ────────────────────────────────────
    contractExpiryDate: {
      type: Date,
      default: null,
      index: true,
    },

    contractRenewalAlertDays: {
      type: Number,
      min: 0,
      max: 365,
      default: 30,
    },

    contractNotes: {
      type: String,
      trim: true,
      maxlength: 2000,
      default: '',
    },

    // ── Insurance & Claims (Capability 16) ────────────────────────────────────
    insurancePolicyNumber: {
      type: String,
      trim: true,
      maxlength: 100,
      default: '',
    },

    insuranceProvider: {
      type: String,
      trim: true,
      maxlength: 200,
      default: '',
    },

    insuranceExpiryDate: {
      type: Date,
      default: null,
      index: true,
    },

    insuranceRenewalAlertDays: {
      type: Number,
      min: 0,
      max: 365,
      default: 30,
    },

    // ── Financial Summary & Lifetime Balances ──────────────────────────────
    financialSummary: {
      lifetimePoOrderedValuePaisa: { type: Number, min: 0, default: 0 },
      lifetimeAcceptedReceivedValuePaisa: { type: Number, min: 0, default: 0 },
      lifetimeVendorInvoiceValuePaisa: { type: Number, min: 0, default: 0 },
      lifetimeApprovedPayablePaisa: { type: Number, min: 0, default: 0 },
      lifetimePaidPaisa: { type: Number, min: 0, default: 0 },
      currentGrossPayablesPaisa: { type: Number, min: 0, default: 0 },
      currentPaymentHoldsPaisa: { type: Number, min: 0, default: 0 },
      currentApprovedPayablePaisa: { type: Number, min: 0, default: 0 },
      currentOutstandingPayablePaisa: { type: Number, min: 0, default: 0 },
      availableVendorAdvancePaisa: { type: Number, min: 0, default: 0 },
      availableVendorCreditPaisa: { type: Number, min: 0, default: 0 },
      overdueAmountPaisa: { type: Number, min: 0, default: 0 },
      lastPaymentDate: { type: Date, default: null },
      lastPaymentAmountPaisa: { type: Number, min: 0, default: 0 },
      lastEvaluatedAt: { type: Date, default: Date.now },
      totalInvoicedPaise: { type: Number, default: 0 },
      totalPaidPaise: { type: Number, default: 0 },
      outstandingBalancePaise: { type: Number, default: 0 },
    },

    // ── Notes ────────────────────────────────────────────────────────────────
    notes: {
      type: String,
      trim: true,
      maxlength: 3000,
      default: '',
    },

    // ── Governance ───────────────────────────────────────────────────────────
    createdByUserId: {
      type: String,
      required: true,
      immutable: true,
      trim: true,
      uppercase: true,
    },

    lastModifiedByUserId: {
      type: String,
      trim: true,
      uppercase: true,
      default: null,
    },
  },
  {
    timestamps: true,
    versionKey: 'version',
    optimisticConcurrency: true,
    collection: 'vendors',
  }
);

// ── Compound indexes ─────────────────────────────────────────────────────────

vendorSchema.index(
  { organisationId: 1, nameLower: 1 },
  { unique: true, name: 'org_name_unique' }
);

vendorSchema.index(
  { organisationId: 1, status: 1, category: 1 },
  { name: 'org_status_category' }
);

vendorSchema.index(
  { organisationId: 1, 'supplierItemCatalogue.itemId': 1 },
  { name: 'org_supplier_item' }
);

vendorSchema.index(
  { name: 'text', tradeName: 'text', gstNumber: 'text', notes: 'text' },
  { name: 'vendor_text_search' }
);

// ── Normalisation ────────────────────────────────────────────────────────────

vendorSchema.pre('validate', function normaliseVendorFields() {
  if (this.name) {
    this.nameLower = this.name.trim().toLowerCase();
  }
  if (this.category) {
    this.category = this.category.trim().toUpperCase();
  }
  if (this.supplierType) {
    this.supplierType = this.supplierType.trim().toUpperCase();
  }
  if (this.status) {
    this.status = this.status.trim().toUpperCase();
  }
  if (this.paymentTerms) {
    this.paymentTerms = this.paymentTerms.trim().toUpperCase();
  }

  const upperFields = [
    'vendorId', 'organisationId', 'createdByUserId',
    'lastModifiedByUserId', 'statusChangedByUserId',
    'gstNumber', 'panNumber',
  ];
  for (const field of upperFields) {
    if (this[field] && typeof this[field] === 'string') {
      this[field] = this[field].trim().toUpperCase();
    }
  }
});

const Vendor =
  mongoose.models.Vendor ||
  mongoose.model('Vendor', vendorSchema);

module.exports = {
  Vendor,
  VENDOR_STATUSES,
  SUPPLIER_TYPES,
  VENDOR_CATEGORIES,
  PAYMENT_TERMS,
  SOURCE_PRIORITIES,
};
