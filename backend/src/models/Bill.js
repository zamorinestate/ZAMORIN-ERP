'use strict';

/**
 * BILL / RECEIPT — MONGOOSE MODEL (SCREEN 005)
 *
 * Implements POS Sales Invoices, Finalised Receipts & Post-Sale Control:
 *   - Immutable historical line item snapshots (name, rate, tax class, discounts, totals).
 *   - Split tender payment allocation & provider tracking.
 *   - Traceable refunds, voids, and credit-note adjustments.
 *   - GST/tax source register classifications.
 *   - Audit reprint counters and business-day closure linkages.
 */

const mongoose = require('mongoose');

const BILL_STATUSES = [
  'OPEN',                // Order created in POS, open check
  'COMPLETED',           // Paid and financially finalised
  'PARTIALLY_REFUNDED',  // Partial refund issued
  'REFUNDED',            // Fully refunded
  'VOIDED',              // Audited cancellation/void
  'PAYMENT_REVERSED',    // Payment reversed by processor
];

const PAYMENT_METHODS = [
  'CASH',
  'UPI',
  'CARD',
  'CREDIT',
  'COMPLIMENTARY',
  'STAFF_MEAL',
  'MIXED',
  'SPLIT',
];

const ORDER_TYPES = [
  'QUICK_SALE',
  'DINE_IN',
  'TAKEAWAY',
  'DELIVERY',
  'SCHEDULED_PICKUP',
  'STAFF_MEAL',
  'COMPLIMENTARY',
];

const TAX_CLASSIFICATIONS = [
  'GST_5',
  'GST_12',
  'GST_18',
  'GST_28',
  'EXEMPT',
  'NIL',
];

const modifierSnapshotSchema = new mongoose.Schema(
  {
    size: { type: String, default: 'Regular' },
    milk: { type: String, default: 'Standard' },
    temperature: { type: String, default: 'Hot' },
    sweetness: { type: String, default: 'Regular' },
    addOns: { type: [String], default: [] },
    modifierPricePaisa: { type: Number, default: 0 },
  },
  { _id: false }
);

const billLineItemSchema = new mongoose.Schema(
  {
    menuItemId: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
    },

    itemNameSnapshot: {
      type: String,
      required: true,
      trim: true,
    },

    quantity: {
      type: Number,
      required: true,
      min: 1,
      validate: { validator: Number.isInteger, message: 'quantity must be an integer.' },
    },

    unitPricePaisa: {
      type: Number,
      required: true,
      min: 0,
      validate: { validator: Number.isInteger, message: 'unitPricePaisa must be an integer.' },
    },

    modifiers: {
      type: modifierSnapshotSchema,
      default: () => ({}),
    },

    itemNotes: {
      type: String,
      trim: true,
      maxlength: 500,
      default: '',
    },

    taxRatePercent: {
      type: Number,
      min: 0,
      default: 5,
    },

    taxClassification: {
      type: String,
      enum: TAX_CLASSIFICATIONS,
      default: 'GST_5',
    },

    discountPaisa: {
      type: Number,
      min: 0,
      default: 0,
    },

    lineSubtotalPaisa: {
      type: Number,
      required: true,
      min: 0,
    },

    cgstPaisa: {
      type: Number,
      min: 0,
      default: 0,
    },

    sgstPaisa: {
      type: Number,
      min: 0,
      default: 0,
    },

    igstPaisa: {
      type: Number,
      min: 0,
      default: 0,
    },

    lineTotalPaisa: {
      type: Number,
      min: 0,
      default: 0,
    },

    hsnSacCode: {
      type: String,
      trim: true,
      default: '996331',
    },

    variantSnapshot: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },

    modifierSnapshot: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },

    comboSnapshot: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },

    consumedLots: [
      {
        lotId: {
          type: String,
          trim: true,
          uppercase: true,
        },
        quantityConsumed: {
          type: Number,
          min: 0,
          default: 0,
        },
        movementId: {
          type: String,
          trim: true,
          default: '',
        },
        sourceTransaction: {
          type: String,
          trim: true,
          default: '',
        },
      },
    ],
  },
  { _id: true }
);

const tenderAllocationSchema = new mongoose.Schema(
  {
    paymentMethod: {
      type: String,
      enum: PAYMENT_METHODS,
      required: true,
    },

    amountPaisa: {
      type: Number,
      required: true,
      min: 0,
    },

    status: {
      type: String,
      enum: ['PENDING', 'COMPLETED', 'FAILED', 'REVERSED', 'EXPIRED', 'CANCELLED', 'UNKNOWN_RECONCILIATION_REQUIRED'],
      default: 'COMPLETED',
    },

    currency: {
      type: String,
      trim: true,
      default: 'INR',
    },

    operatorUserId: {
      type: String,
      trim: true,
      default: '',
    },

    processor: {
      type: String,
      trim: true,
      default: '',
    },

    provider: {
      type: String,
      trim: true,
      default: '',
    },

    paymentReference: {
      type: String,
      trim: true,
      default: '',
    },

    upiReference: {
      type: String,
      trim: true,
      default: '',
    },

    maskedCard: {
      type: String,
      trim: true,
      default: '',
    },

    transactionTimestamp: {
      type: Date,
      default: Date.now,
    },
  },
  { _id: true }
);

const tenderCorrectionSchema = new mongoose.Schema(
  {
    correctionId: {
      type: String,
      required: true,
      trim: true,
    },
    oldPaymentMethod: {
      type: String,
      required: true,
    },
    newPaymentMethod: {
      type: String,
      required: true,
    },
    amountPaisa: {
      type: Number,
      required: true,
      min: 0,
    },
    reason: {
      type: String,
      required: true,
      trim: true,
    },
    correctedByUserId: {
      type: String,
      required: true,
      trim: true,
    },
    correctedAt: {
      type: Date,
      default: Date.now,
    },
    paymentReference: {
      type: String,
      trim: true,
      default: '',
    },
    financialEffect: {
      type: String,
      default: 'RECLASSIFICATION_ONLY',
    },
  },
  { _id: true }
);

const refundRecordSchema = new mongoose.Schema(
  {
    refundId: {
      type: String,
      required: true,
      trim: true,
    },

    refundType: {
      type: String,
      enum: ['FULL', 'PARTIAL', 'ITEM_BASED', 'AMOUNT_BASED'],
      default: 'FULL',
    },

    amountPaisa: {
      type: Number,
      required: true,
      min: 0,
    },

    reason: {
      type: String,
      required: true,
      trim: true,
      maxlength: 2000,
    },

    requestedBy: {
      type: String,
      required: true,
      trim: true,
    },

    approvedBy: {
      type: String,
      trim: true,
      default: null,
    },

    tender: {
      type: String,
      enum: PAYMENT_METHODS,
      default: 'CASH',
    },

    refundReference: {
      type: String,
      trim: true,
      default: '',
    },

    status: {
      type: String,
      enum: ['REQUESTED', 'APPROVED', 'PROCESSING', 'COMPLETED', 'FAILED', 'REJECTED'],
      default: 'COMPLETED',
    },

    channel: {
      type: String,
      default: 'POS',
    },

    complaintId: {
      type: String,
      default: null,
    },

    idempotencyKey: {
      type: String,
      trim: true,
      default: null,
      index: true,
    },

    createdAt: {
      type: Date,
      default: Date.now,
    },
  },
  { _id: true }
);

const creditNoteSchema = new mongoose.Schema(
  {
    creditNoteId: {
      type: String,
      required: true,
      trim: true,
    },

    creditNoteNumber: {
      type: String,
      required: true,
      trim: true,
    },

    date: {
      type: Date,
      default: Date.now,
    },

    reason: {
      type: String,
      required: true,
      trim: true,
    },

    taxableAdjustmentPaisa: {
      type: Number,
      required: true,
      min: 0,
    },

    taxAdjustmentPaisa: {
      type: Number,
      required: true,
      min: 0,
    },

    totalAdjustmentPaisa: {
      type: Number,
      required: true,
      min: 0,
    },
  },
  { _id: true }
);

const reprintRecordSchema = new mongoose.Schema(
  {
    reprintedBy: {
      type: String,
      required: true,
      trim: true,
    },

    reprintedAt: {
      type: Date,
      default: Date.now,
    },

    reason: {
      type: String,
      trim: true,
      default: 'Customer Request',
    },
  },
  { _id: true }
);

const billSchema = new mongoose.Schema(
  {
    billId: {
      type: String,
      required: true,
      unique: true,
      immutable: true,
      trim: true,
      uppercase: true,
      match: /^BILL-\d{8}-\d{4,}$/,
      index: true,
    },

    invoiceNumber: {
      type: String,
      trim: true,
      uppercase: true,
      index: true,
      default: null,
    },

    organisationId: {
      type: String,
      required: true,
      immutable: true,
      trim: true,
      uppercase: true,
      index: true,
    },

    cafeId: {
      type: String,
      required: true,
      immutable: true,
      trim: true,
      uppercase: true,
      index: true,
    },

    businessDate: {
      type: String,
      trim: true,
      index: true,
      default: null, // YYYY-MM-DD operational business trading day
    },

    orderType: {
      type: String,
      enum: ORDER_TYPES,
      default: 'QUICK_SALE',
    },

    serviceMode: {
      type: String,
      enum: ['QUICK_SALE', 'DINE_IN', 'TAKEAWAY', 'DELIVERY', 'SCHEDULED_PICKUP'],
      default: 'QUICK_SALE',
    },

    guestCovers: {
      type: Number,
      default: 1,
      min: 1,
    },

    tableToken: {
      type: String,
      trim: true,
      default: '',
    },

    isHeld: {
      type: Boolean,
      default: false,
      index: true,
    },

    heldAt: {
      type: Date,
      default: null,
    },

    holdName: {
      type: String,
      trim: true,
      default: '',
    },

    registerId: {
      type: String,
      trim: true,
      default: 'REG-01',
      index: true,
    },

    registerSessionId: {
      type: String,
      trim: true,
      default: '',
      index: true,
    },

    financialYear: {
      type: String,
      trim: true,
      default: '2026-2027',
      index: true,
    },

    upiPaymentIntent: {
      upiString: { type: String, default: '' },
      qrGeneratedAt: { type: Date, default: null },
      status: { type: String, default: 'PENDING' },
      paymentReference: { type: String, default: '' },
    },

    tableNumber: {
      type: String,
      trim: true,
      maxlength: 50,
      default: '',
    },

    customerName: {
      type: String,
      trim: true,
      maxlength: 100,
      default: '',
    },

    customerPhone: {
      type: String,
      trim: true,
      maxlength: 20,
      default: '',
    },

    b2bCustomerGstin: {
      type: String,
      trim: true,
      uppercase: true,
      default: '',
    },

    b2bCustomerLegalName: {
      type: String,
      trim: true,
      default: '',
    },

    gstRegistrationNumber: {
      type: String,
      trim: true,
      uppercase: true,
      default: '',
    },

    isTraining: {
      type: Boolean,
      default: false,
      index: true,
    },

    taxConfigVersion: {
      type: String,
      trim: true,
      default: 'GST-V1',
    },

    lineItems: {
      type: [billLineItemSchema],
      required: true,
      validate: {
        validator: (v) => Array.isArray(v) && v.length > 0,
        message: 'Bill must contain at least one line item.',
      },
    },

    subtotalPaisa: {
      type: Number,
      required: true,
      min: 0,
    },

    taxPaisa: {
      type: Number,
      min: 0,
      default: 0,
    },

    cgstPaisa: {
      type: Number,
      min: 0,
      default: 0,
    },

    sgstPaisa: {
      type: Number,
      min: 0,
      default: 0,
    },

    igstPaisa: {
      type: Number,
      min: 0,
      default: 0,
    },

    discountPaisa: {
      type: Number,
      min: 0,
      default: 0,
    },

    preRoundingTotalPaisa: {
      type: Number,
      min: 0,
      default: 0,
    },

    roundOffPaisa: {
      type: Number,
      default: 0,
    },

    totalPaisa: {
      type: Number,
      required: true,
      min: 0,
    },

    taxRuleVersion: {
      type: String,
      trim: true,
      default: 'GST_ROUNDING_V1_2026',
    },

    roundingPolicyVersion: {
      type: String,
      trim: true,
      default: 'ZAMORIN_PAYABLE_ROUNDING_50P_V1',
    },

    refundedTotalPaisa: {
      type: Number,
      min: 0,
      default: 0,
    },

    paymentStatus: {
      type: String,
      enum: ['UNPAID', 'PAID', 'PARTIALLY_PAID', 'PARTIALLY_REFUNDED', 'REFUNDED'],
      default: 'UNPAID',
    },

    paidAmountPaisa: {
      type: Number,
      min: 0,
      default: 0,
    },

    dueAmountPaisa: {
      type: Number,
      min: 0,
      default: 0,
    },

    changeGivenPaisa: {
      type: Number,
      min: 0,
      default: 0,
    },

    paymentMethod: {
      type: String,
      enum: PAYMENT_METHODS,
      default: 'CASH',
    },

    tenders: {
      type: [tenderAllocationSchema],
      default: [],
    },

    tenderCorrections: {
      type: [tenderCorrectionSchema],
      default: [],
    },

    refunds: {
      type: [refundRecordSchema],
      default: [],
    },

    creditNotes: {
      type: [creditNoteSchema],
      default: [],
    },

    reprints: {
      type: [reprintRecordSchema],
      default: [],
    },

    printStatus: {
      type: String,
      enum: ['NOT_REQUESTED', 'PRINT_PENDING', 'PRINT_DISPATCHED', 'PRINTED', 'PRINT_FAILED'],
      default: 'NOT_REQUESTED',
      index: true,
    },

    printJobs: [
      {
        printJobId: { type: String, trim: true },
        jobType: { type: String, default: 'RECEIPT' },
        status: { type: String, default: 'QUEUED' },
        dispatchedAt: { type: Date, default: Date.now },
        completedAt: { type: Date, default: null },
        failureCode: { type: String, default: null },
      },
    ],

    businessDate: {
      type: String,
      required: true,
      trim: true,
      match: /^\d{4}-\d{2}-\d{2}$/,
      index: true,
    },

    status: {
      type: String,
      required: true,
      enum: BILL_STATUSES,
      default: 'OPEN',
      index: true,
    },

    voidedByUserId: {
      type: String,
      trim: true,
      uppercase: true,
      default: null,
    },

    voidReason: {
      type: String,
      trim: true,
      maxlength: 2000,
      default: '',
    },

    voidedAt: {
      type: Date,
      default: null,
    },

    cashierUserId: {
      type: String,
      required: true,
      immutable: true,
      trim: true,
      uppercase: true,
    },

    operatorSessionId: {
      type: String,
      trim: true,
      default: null,
    },

    cashSessionId: {
      type: String,
      trim: true,
      default: null,
    },

    correlationId: {
      type: String,
      immutable: true,
      trim: true,
      maxlength: 150,
      default: null,
    },

    isOfflineReplay: {
      type: Boolean,
      default: false,
      index: true,
    },

    // REC-04A: Explicit BOM/inventory depletion reconciliation state.
    // 'DEPLETED' = stock consumed successfully.
    // 'FAILED'   = depletion threw; bill is COMPLETED but stock was NOT consumed.
    //              Operations must reconcile manually. Queryable for alert dashboards.
    // 'NOT_ATTEMPTED' = BOM not applicable (no recipe linked).
    // 'ALREADY_DEPLETED' = idempotent replay; depletion skipped safely.
    bomDepletionStatus: {
      type: String,
      enum: ['NOT_ATTEMPTED', 'DEPLETED', 'FAILED', 'ALREADY_DEPLETED'],
      default: 'NOT_ATTEMPTED',
      index: true,
    },

    bomDepletionError: {
      type: String,
      default: null,
      maxlength: 250,
    },

    clientOfflineId: {
      type: String,
      trim: true,
      default: '',
      index: true,
    },

    offlineCreatedAt: {
      type: Date,
      default: null,
    },

    // REC-04B: Canonical immutable checkout identity.
    // Database-level uniqueness prevents multi-process / multi-worker duplicate sale creation.
    saleAttemptId: {
      type: String,
      trim: true,
      index: true,
      sparse: true,
      default: null,
    },

    // REC-13A: Review governance tracking for offline transactions
    reviewedByUserId: {
      type: String,
      trim: true,
      uppercase: true,
      default: null,
    },

    reviewedByRole: {
      type: String,
      trim: true,
      uppercase: true,
      default: null,
    },

    reviewReason: {
      type: String,
      trim: true,
      default: null,
    },

    reviewId: {
      type: String,
      trim: true,
      default: null,
    },
  },
  {
    timestamps: true,
    versionKey: 'version',
    optimisticConcurrency: true,
    collection: 'bills',
  }
);

billSchema.index(
  { organisationId: 1, cafeId: 1, businessDate: -1, status: 1 },
  { name: 'org_cafe_date_status' }
);

billSchema.index(
  { organisationId: 1, invoiceNumber: 1 },
  { unique: true, sparse: true, name: 'org_invoice_number_unique' }
);

billSchema.index(
  { organisationId: 1, cafeId: 1, saleAttemptId: 1 },
  { unique: true, sparse: true, name: 'org_cafe_sale_attempt_unique' }
);

billSchema.index(
  { organisationId: 1, cafeId: 1, correlationId: 1 },
  {
    unique: true,
    partialFilterExpression: {
      correlationId: { $gt: '' },
    },
    name: 'org_cafe_correlation_unique',
  }
);

billSchema.index(
  { organisationId: 1, 'lineItems.consumedLots.lotId': 1 },
  { name: 'org_lineitem_consumed_lot' }
);

billSchema.index(
  { organisationId: 1, 'tenders.paymentReference': 1 },
  { sparse: true, name: 'org_tender_payment_ref' }
);

billSchema.pre('validate', function normaliseBillFields() {
  const upperFields = ['billId', 'invoiceNumber', 'organisationId', 'cafeId', 'cashierUserId', 'voidedByUserId', 'b2bCustomerGstin', 'gstRegistrationNumber'];
  for (const field of upperFields) {
    if (this[field] && typeof this[field] === 'string') {
      this[field] = this[field].trim().toUpperCase();
    }
  }
  if (this.status) this.status = this.status.trim().toUpperCase();
  if (this.paymentMethod) this.paymentMethod = this.paymentMethod.trim().toUpperCase();
  if (this.paymentStatus) this.paymentStatus = this.paymentStatus.trim().toUpperCase();
  if (this.orderType) this.orderType = this.orderType.trim().toUpperCase();
});

const Bill =
  mongoose.models.Bill ||
  mongoose.model('Bill', billSchema);

module.exports = {
  Bill,
  BILL_STATUSES,
  PAYMENT_METHODS,
  ORDER_TYPES,
  TAX_CLASSIFICATIONS,
};
