'use strict';

/**
 * PURCHASE ORDER — MONGOOSE MODEL (SCR-025)
 *
 * Lifecycle:
 *   DRAFT → SUBMITTED → APPROVED → ORDER_PLACED / ORDERED → ACKNOWLEDGED →
 *   DISPATCHED → PARTIALLY_RECEIVED → RECEIVED_PENDING_FINAL_POSTING →
 *   POSTED_TO_INVENTORY / INVOICED → CLOSED
 *
 * A PurchaseOrder belongs to a single café and a single vendor.
 * Line items reference GlobalInventoryItem.itemId or pure service items.
 *
 * Owner-Mandated Posting Safeguard:
 *   Physical arrival (GRN) records delivery and sets state to RECEIVED_PENDING_FINAL_POSTING.
 *   Stock movements are NOT created until authenticated MASTER approves the validated 3-Way Match.
 *   Inventory is posted atomically and exactly once with unique idempotency protection.
 *   Service lines NEVER update stock.
 */

const mongoose = require('mongoose');

const PO_STATUSES = [
  'DRAFT',
  'SUBMITTED',
  'ESCALATED_PENDING_MASTER',
  'APPROVED',
  'ORDER_PLACED',
  'ORDERED',
  'ACKNOWLEDGED',
  'DISPATCHED',
  'PARTIALLY_RECEIVED',
  'RECEIVED_PENDING_FINAL_POSTING',
  'VERIFIED_PENDING_MASTER_APPROVAL',
  'RECEIVED',
  'CLOSED',
  'CANCELLED',
];

const PO_FULFILLMENT_STATUSES = [
  'PENDING_RECEIPT',
  'PARTIALLY_RECEIVED',
  'BACKORDER_PENDING',
  'SHORT_SUPPLY_ACTION_REQUIRED',
  'FULLY_RECEIVED',
  'CLOSED_WITH_SHORTAGE',
  'CANCELLED',
];

const PO_LINE_FULFILLMENT_STATUSES = [
  'ORDERED',
  'VENDOR_CONFIRMED',
  'PARTIALLY_CONFIRMED',
  'PENDING_RECEIPT',
  'PARTIALLY_RECEIVED',
  'BACKORDERED',
  'VENDOR_UNAVAILABLE',
  'SUBSTITUTION_PENDING',
  'FULLY_RECEIVED',
  'CLOSED_SHORT',
  'CANCELLED',
];

const poLineItemSchema = new mongoose.Schema(
  {
    itemId: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
    },

    itemNameSnapshot: {
      type: String,
      trim: true,
      maxlength: 200,
      default: '',
    },

    itemType: {
      type: String,
      enum: ['GOODS', 'SERVICE'],
      default: 'GOODS',
    },

    supplierItemCode: {
      type: String,
      trim: true,
      maxlength: 100,
      default: '',
    },

    packSize: {
      type: String,
      trim: true,
      maxlength: 50,
      default: '1 UNIT',
    },

    uomConversionFactor: {
      type: Number,
      min: 0.0001,
      default: 1,
    },

    baseUnit: {
      type: String,
      trim: true,
      lowercase: true,
      maxlength: 30,
      default: '',
    },

    orderedQuantityBase: {
      type: Number,
      required: true,
      min: 0.001,
    },

    receivedQuantityBase: {
      type: Number,
      min: 0,
      default: 0,
    },

    acceptedReceivedQty: {
      type: Number,
      min: 0,
      default: 0,
    },

    rejectedQty: {
      type: Number,
      min: 0,
      default: 0,
    },

    outstandingQty: {
      type: Number,
      min: 0,
      default: function () {
        return this.orderedQuantityBase || 0;
      },
    },

    backorderedQty: {
      type: Number,
      min: 0,
      default: 0,
    },

    vendorUnavailableQty: {
      type: Number,
      min: 0,
      default: 0,
    },

    closedShortQty: {
      type: Number,
      min: 0,
      default: 0,
    },

    buyerCancelledQty: {
      type: Number,
      min: 0,
      default: 0,
    },

    fulfillmentStatus: {
      type: String,
      enum: PO_LINE_FULFILLMENT_STATUSES,
      default: 'ORDERED',
    },

    backorderDetails: {
      expectedDeliveryDate: { type: Date, default: null },
      confirmationRef: { type: String, trim: true, default: '' },
      note: { type: String, trim: true, default: '' },
      backorderedAt: { type: Date, default: null },
      backorderedByUserId: { type: String, trim: true, uppercase: true, default: null },
      isOverdue: { type: Boolean, default: false },
    },

    vendorUnavailableDetails: {
      reason: {
        type: String,
        enum: [
          'OUT_OF_STOCK',
          'DISCONTINUED',
          'SUPPLY_CHAIN_DELAY',
          'MINIMUM_ORDER_NOT_MET',
          'PRICE_CHANGED',
          'VENDOR_REFUSED',
          'ITEM_NOT_AVAILABLE',
          'SEASONAL_UNAVAILABLE',
          'OTHER',
        ],
        default: 'OUT_OF_STOCK',
      },
      note: { type: String, trim: true, default: '' },
      recordedAt: { type: Date, default: null },
      recordedByUserId: { type: String, trim: true, uppercase: true, default: null },
    },

    closeShortDetails: {
      reason: { type: String, trim: true, default: '' },
      note: { type: String, trim: true, default: '' },
      closedAt: { type: Date, default: null },
      closedByUserId: { type: String, trim: true, uppercase: true, default: null },
      isVendorFault: { type: Boolean, default: true },
    },

    buyerCancellationDetails: {
      reason: { type: String, trim: true, default: '' },
      note: { type: String, trim: true, default: '' },
      cancelledAt: { type: Date, default: null },
      cancelledByUserId: { type: String, trim: true, uppercase: true, default: null },
    },

    substitution: {
      status: {
        type: String,
        enum: ['NONE', 'PROPOSED', 'APPROVED', 'REJECTED'],
        default: 'NONE',
      },
      proposedItemId: { type: String, trim: true, uppercase: true, default: null },
      proposedItemName: { type: String, trim: true, default: '' },
      proposedQuantityBase: { type: Number, min: 0, default: 0 },
      proposedUnitPricePaisa: { type: Number, min: 0, default: 0 },
      originalUnitPricePaisa: { type: Number, min: 0, default: 0 },
      priceDifferencePaisa: { type: Number, default: 0 },
      reason: { type: String, trim: true, default: '' },
      proposedAt: { type: Date, default: null },
      proposedByUserId: { type: String, trim: true, uppercase: true, default: null },
      decidedAt: { type: Date, default: null },
      decidedByUserId: { type: String, trim: true, uppercase: true, default: null },
      decisionReason: { type: String, trim: true, default: '' },
    },

    sourceElsewhere: {
      status: {
        type: String,
        enum: ['NONE', 'SOURCED'],
        default: 'NONE',
      },
      shortageQty: { type: Number, min: 0, default: 0 },
      replacementVendorId: { type: String, trim: true, uppercase: true, default: null },
      replacementPurchaseOrderId: { type: String, trim: true, uppercase: true, default: null },
      sourcedAt: { type: Date, default: null },
      sourcedByUserId: { type: String, trim: true, uppercase: true, default: null },
    },

    vendorConfirmationDetails: {
      confirmedSupplyQty: { type: Number, min: 0, default: 0 },
      backorderQty: { type: Number, min: 0, default: 0 },
      cannotSupplyQty: { type: Number, min: 0, default: 0 },
      expectedDeliveryDate: { type: Date, default: null },
      confirmationReference: { type: String, trim: true, default: '' },
      confirmedAt: { type: Date, default: null },
      confirmedByUserId: { type: String, trim: true, uppercase: true, default: null },
    },

    invoicedQuantityBase: {
      type: Number,
      min: 0,
      default: 0,
    },

    activeAsnReservedQuantityBase: {
      type: Number,
      min: 0,
      default: 0,
    },

    unitPricePaisa: {
      type: Number,
      required: true,
      min: 0,
      validate: {
        validator: Number.isInteger,
        message: 'unitPricePaisa must be an integer.',
      },
    },

    totalLinePaisa: {
      type: Number,
      required: true,
      min: 0,
    },

    lineNotes: {
      type: String,
      trim: true,
      maxlength: 500,
      default: '',
    },
  },
  { _id: true }
);

const milestoneSchema = new mongoose.Schema(
  {
    milestoneKey: { type: String, required: true, trim: true },
    label: { type: String, required: true, trim: true },
    timestamp: { type: Date, required: true, default: Date.now },
    actorUserId: { type: String, trim: true, uppercase: true, default: 'SYSTEM' },
    details: { type: String, trim: true, default: '' },
  },
  { _id: true }
);

const grnItemSchema = new mongoose.Schema(
  {
    itemId: { type: String, required: true, trim: true, uppercase: true },
    deliveredQty: { type: Number, required: true, min: 0 },
    acceptedQty: { type: Number, required: true, min: 0 },
    rejectedQty: { type: Number, min: 0, default: 0 },
    missingQty: { type: Number, min: 0, default: 0 },
    discrepancyReason: { type: String, trim: true, default: '' },
    lotNumber: { type: String, trim: true, default: null },
    manufacturingDate: { type: Date, default: null },
    expiryDate: { type: Date, default: null },
    rejectionReason: { type: String, trim: true, default: null },
    disposition: {
      type: String,
      enum: ['KEEP_OPEN', 'BACKORDER', 'VENDOR_CANNOT_SUPPLY', 'SUBSTITUTION_PROPOSED', 'SOURCE_ELSEWHERE', 'CLOSE_REMAINING', null],
      default: null,
    },
    notes: { type: String, trim: true, default: '' },
  },
  { _id: false }
);

const receiptAttachmentSchema = new mongoose.Schema(
  {
    attachmentId: { type: String, required: true, trim: true, uppercase: true },
    filename: { type: String, required: true, trim: true },
    mimeType: { type: String, required: true, trim: true },
    sizeBytes: { type: Number, min: 0, default: 0 },
    storagePath: { type: String, trim: true, default: '' },
    dataBase64: { type: String, default: null },
    uploadedAt: { type: Date, default: Date.now },
    uploadedByUserId: { type: String, required: true, trim: true, uppercase: true },
    uploadedByRole: { type: String, trim: true, uppercase: true, default: 'STAFF' },
    note: { type: String, trim: true, default: '' },
  },
  { _id: true }
);

const poApprovalRecordSchema = new mongoose.Schema(
  {
    approvedAt: { type: Date, default: null },
    approvedByUserId: { type: String, trim: true, uppercase: true, default: null },
    approvedByRole: { type: String, trim: true, uppercase: true, default: null },
    approvalPolicyId: { type: String, trim: true, default: 'DEFAULT' },
    approvalPolicyVersion: { type: String, trim: true, default: '1.0' },
    purchasingCapability: { type: String, trim: true, default: 'PURCHASE_ORDER_APPROVE' },
    isEscalatedApproval: { type: Boolean, default: false },
    notes: { type: String, trim: true, maxlength: 2000, default: '' },
    decisionFingerprint: { type: String, trim: true, default: '' },
  },
  { _id: false }
);

const poRevisionSchema = new mongoose.Schema(
  {
    revisionNumber: { type: Number, required: true, min: 1 },
    status: {
      type: String,
      enum: ['DRAFT', 'SUBMITTED', 'ESCALATED', 'APPROVED', 'SUPERSEDED', 'REVOKED', 'CANCELLED'],
      default: 'DRAFT',
    },
    createdAt: { type: Date, default: Date.now },
    createdByUserId: { type: String, trim: true, uppercase: true, default: null },
    changeReason: { type: String, trim: true, default: 'Initial revision' },
    lineItems: [poLineItemSchema],
    subtotalPaisa: { type: Number, min: 0, default: 0 },
    taxPaisa: { type: Number, min: 0, default: 0 },
    discountPaisa: { type: Number, min: 0, default: 0 },
    totalPaisa: { type: Number, min: 0, default: 0 },
    vendorId: { type: String, trim: true, uppercase: true },
    vendorNameSnapshot: { type: String, trim: true, default: '' },
    vendorContactEmail: { type: String, trim: true, lowercase: true, default: '' },
    expectedDeliveryDate: { type: String, trim: true, default: null },
    deliveryAddress: { type: String, trim: true, default: '' },
    terms: { type: String, trim: true, default: '' },
    notes: { type: String, trim: true, default: '' },
    approval: { type: poApprovalRecordSchema, default: null },
    dispatchJobId: { type: String, trim: true, default: null },
    documentHash: { type: String, trim: true, default: null },
  },
  { _id: true }
);

const poEditHistorySchema = new mongoose.Schema(
  {
    editedAt: { type: Date, default: Date.now },
    editedByUserId: { type: String, required: true, trim: true, uppercase: true },
    editedByRole: { type: String, required: true, trim: true, uppercase: true },
    reason: { type: String, trim: true, default: '' },
    wasApproved: { type: Boolean, default: false },
    changesSummary: { type: String, trim: true, default: '' },
    previousSnapshot: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  { _id: true }
);

const grnSchema = new mongoose.Schema(
  {
    grnId: { type: String, required: true, trim: true, uppercase: true },
    idempotencyKey: { type: String, trim: true, uppercase: true, default: null },
    deliveryNoteNumber: { type: String, trim: true, default: '' },
    receivedAt: { type: Date, default: Date.now },
    receivedByUserId: { type: String, required: true, trim: true, uppercase: true },
    items: [grnItemSchema],
    receiptAttachments: [receiptAttachmentSchema],
    notes: { type: String, trim: true, default: '' },
    status: { type: String, enum: ['ACCEPTED', 'PARTIAL', 'REJECTED'], default: 'ACCEPTED' },
  },
  { _id: true }
);

const supplierInvoiceRefSchema = new mongoose.Schema(
  {
    invoiceId: { type: String, required: true, trim: true, uppercase: true },
    invoiceNumber: { type: String, required: true, trim: true },
    invoiceDate: { type: String, required: true, trim: true },
    amountPaisa: { type: Number, required: true, min: 0 },
    taxPaisa: { type: Number, default: 0, min: 0 },
    totalPaisa: { type: Number, required: true, min: 0 },
    receivedAt: { type: Date, default: Date.now },
    irn: { type: String, trim: true, default: '' },
    signedQr: { type: String, trim: true, default: '' },
    status: { type: String, enum: ['CAPTURED', 'MATCHED', 'APPROVED', 'DISPUTED'], default: 'CAPTURED' },
  },
  { _id: true }
);

const threeWayMatchSchema = new mongoose.Schema(
  {
    matchStatus: {
      type: String,
      enum: [
        'MATCHED',
        'PRICE_VARIANCE',
        'QUANTITY_VARIANCE',
        'TAX_VARIANCE',
        'REVIEW_REQUIRED',
        'PENDING',
        'NOT_READY',
        'DOCUMENT_MISSING',
        'MANUAL_REVIEW_REQUIRED',
      ],
      default: 'PENDING',
    },
    matchedAt: { type: Date, default: null },
    matchedByUserId: { type: String, trim: true, uppercase: true, default: null },
    priceVariancePaisa: { type: Number, default: 0 },
    quantityVarianceBase: { type: Number, default: 0 },
    taxVariancePaisa: { type: Number, default: 0 },
    isExceptionApproved: { type: Boolean, default: false },
    exceptionReason: { type: String, trim: true, default: '' },
    exceptionApprovedByUserId: { type: String, trim: true, uppercase: true, default: null },
  },
  { _id: false }
);

const masterApprovalSchema = new mongoose.Schema(
  {
    approvedAt: { type: Date, default: null },
    approvedByUserId: { type: String, trim: true, uppercase: true, default: null },
    approvalNotes: { type: String, trim: true, maxlength: 2000, default: '' },
    isHighRiskReauthConfirmed: { type: Boolean, default: false },
  },
  { _id: false }
);

const inventoryPostingSchema = new mongoose.Schema(
  {
    postingId: { type: String, trim: true, uppercase: true, default: null },
    postedAt: { type: Date, default: null },
    postedByUserId: { type: String, trim: true, uppercase: true, default: null },
    stockMovementIds: [{ type: String, trim: true, uppercase: true }],
    status: {
      type: String,
      enum: ['IDLE', 'PENDING', 'POSTED', 'FAILED'],
      default: 'IDLE',
    },
    error: { type: String, trim: true, default: null },
  },
  { _id: false }
);

const purchaseOrderSchema = new mongoose.Schema(
  {
    // ── Business identifier ──────────────────────────────────────────────────
    purchaseOrderId: {
      type: String,
      required: true,
      unique: true,
      immutable: true,
      trim: true,
      uppercase: true,
      match: /^PO-[\dA-Z-]+$/,
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

    cafeId: {
      type: String,
      required: true,
      immutable: true,
      trim: true,
      uppercase: true,
      index: true,
    },

    vendorId: {
      type: String,
      required: true,
      immutable: true,
      trim: true,
      uppercase: true,
      index: true,
    },

    // Snapshot of vendor name at PO creation.
    vendorNameSnapshot: {
      type: String,
      trim: true,
      maxlength: 300,
      default: '',
    },

    vendorSiteId: {
      type: String,
      trim: true,
      uppercase: true,
      default: null,
    },

    requisitionId: {
      type: String,
      trim: true,
      uppercase: true,
      index: true,
    },

    // ── Line items ────────────────────────────────────────────────────────────
    lineItems: {
      type: [poLineItemSchema],
      required: true,
      validate: {
        validator: (v) => Array.isArray(v) && v.length > 0,
        message: 'A PurchaseOrder must have at least one line item.',
      },
    },

    // ── Totals (in paisa) ─────────────────────────────────────────────────────
    subtotalPaisa: { type: Number, min: 0, default: 0 },
    taxPaisa: { type: Number, min: 0, default: 0 },
    discountPaisa: { type: Number, min: 0, default: 0 },
    totalPaisa: { type: Number, min: 0, default: 0 },

    // ── Status lifecycle ──────────────────────────────────────────────────────
    status: {
      type: String,
      required: true,
      enum: PO_STATUSES,
      default: 'DRAFT',
      index: true,
    },

    // ── Order Tracking & Dates ────────────────────────────────────────────────
    orderDate: {
      type: String,
      trim: true,
      match: /^\d{4}-\d{2}-\d{2}$/,
      default: null,
    },

    orderPlacedAt: {
      type: Date,
      default: null,
    },

    expectedDeliveryDate: {
      type: String,
      trim: true,
      match: /^\d{4}-\d{2}-\d{2}$/,
      default: null,
    },

    supplierConfirmedDeliveryDate: {
      type: String,
      trim: true,
      match: /^\d{4}-\d{2}-\d{2}$/,
      default: null,
    },

    receivedDate: {
      type: String,
      trim: true,
      match: /^\d{4}-\d{2}-\d{2}$/,
      default: null,
    },

    // ── Supplier Collaboration ────────────────────────────────────────────────
    supplierAcknowledgedAt: { type: Date, default: null },
    supplierAcknowledgementStatus: {
      type: String,
      enum: ['PENDING', 'ACCEPTED', 'ACCEPTED_WITH_CHANGES', 'CANNOT_SUPPLY', 'NEW_DELIVERY_PROPOSED'],
      default: 'PENDING',
    },
    supplierProposedChanges: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },

    // ── Receiving & Invoicing Arrays ───────────────────────────────────────────
    receivingStatus: {
      type: String,
      enum: ['PENDING', 'PARTIALLY_RECEIVED', 'RECEIVED', 'RECEIVED_PENDING_FINAL_POSTING', 'POSTED_TO_INVENTORY'],
      default: 'PENDING',
    },
    fulfillmentStatus: {
      type: String,
      enum: PO_FULFILLMENT_STATUSES,
      default: 'PENDING_RECEIPT',
      index: true,
    },
    grnReceipts: {
      type: [grnSchema],
      default: [],
      validate: [
        {
          validator: function (receipts) {
            if (!Array.isArray(receipts)) return true;
            const keys = receipts.map((r) => r.idempotencyKey).filter(Boolean);
            return new Set(keys).size === keys.length;
          },
          message: 'Duplicate idempotencyKey within the same purchase order grnReceipts is prohibited.',
        },
      ],
    },
    advanceShippingNoticeIds: [{ type: String, trim: true, uppercase: true }],
    deliveryChallanIds: [{ type: String, trim: true }],
    quotationIds: [{ type: String, trim: true }],
    creditDebitNoteIds: [{ type: String, trim: true }],
    invoices: [supplierInvoiceRefSchema],
    receiptAttachments: {
      type: [receiptAttachmentSchema],
      default: [],
    },

    // ── Edit Governance & Counters ───────────────────────────────────────────
    editCountBeforeApproval: {
      type: Number,
      min: 0,
      default: 0,
    },
    editCountAfterApproval: {
      type: Number,
      min: 0,
      default: 0,
    },
    needsReapproval: {
      type: Boolean,
      default: false,
      index: true,
    },
    editHistory: {
      type: [poEditHistorySchema],
      default: [],
    },

    // ── P07 Immutable Revisions, Dispatch Outbox & Vendor Responses ───────────
    currentRevision: {
      type: Number,
      min: 1,
      default: 1,
      index: true,
    },

    activeApprovedRevision: {
      type: Number,
      min: 1,
      default: null,
      index: true,
    },

    revisions: {
      type: [poRevisionSchema],
      default: [],
    },

    sourceRecommendationIds: [
      {
        type: String,
        trim: true,
        uppercase: true,
        index: true,
      },
    ],

    dispatchStatus: {
      type: String,
      enum: [
        'NOT_QUEUED',
        'QUEUED',
        'CLAIMED',
        'SENDING',
        'ACCEPTED_BY_PROVIDER',
        'DELIVERED',
        'FAILED',
        'UNKNOWN',
        'CHANNEL_SETUP_REQUIRED',
        'CANCELLED',
      ],
      default: 'NOT_QUEUED',
      index: true,
    },

    vendorResponseStatus: {
      type: String,
      enum: ['AWAITING_RESPONSE', 'ACKNOWLEDGED', 'PARTIALLY_CONFIRMED', 'REJECTED', 'NO_RESPONSE'],
      default: 'AWAITING_RESPONSE',
      index: true,
    },

    vendorResponseDetails: {
      respondedAt: { type: Date, default: null },
      recordedByUserId: { type: String, trim: true, uppercase: true, default: null },
      channel: { type: String, trim: true, default: 'EMAIL' },
      notes: { type: String, trim: true, default: '' },
      confirmedLines: [
        {
          itemId: { type: String, trim: true, uppercase: true },
          confirmedQuantityBase: { type: Number, min: 0, default: 0 },
          unavailableQuantityBase: { type: Number, min: 0, default: 0 },
        },
      ],
    },

    // ── 3-Way Match & MASTER Approval & Inventory Posting ─────────────────────
    threeWayMatch: {
      type: threeWayMatchSchema,
      default: () => ({}),
    },

    masterApproval: {
      type: masterApprovalSchema,
      default: () => ({}),
    },

    inventoryPosting: {
      type: inventoryPostingSchema,
      default: () => ({}),
    },

    accountsHandoff: {
      status: {
        type: String,
        enum: ['PENDING', 'SENT_TO_ACCOUNTS', 'READY_FOR_AP_REVIEW', 'ACCOUNTS_ACCEPTED'],
        default: 'PENDING',
        index: true,
      },
      sentAt: { type: Date, default: null },
      sentByUserId: { type: String, trim: true, default: null },
      packet: {
        type: mongoose.Schema.Types.Mixed,
        default: null,
      },
    },

    // ── Milestones Timeline ───────────────────────────────────────────────────
    milestones: [milestoneSchema],

    // ── Approval trail ────────────────────────────────────────────────────────
    submittedByUserId: { type: String, trim: true, uppercase: true, default: null },
    submittedAt: { type: Date, default: null },

    approvedByUserId: { type: String, trim: true, uppercase: true, default: null },
    approvedAt: { type: Date, default: null },
    approvalNotes: { type: String, trim: true, maxlength: 2000, default: '' },

    cancelledByUserId: { type: String, trim: true, uppercase: true, default: null },
    cancelledAt: { type: Date, default: null },
    cancellationReason: { type: String, trim: true, maxlength: 2000, default: '' },

    // ── Vendor invoice / reference (Legacy compatibility) ─────────────────────
    vendorInvoiceNumber: { type: String, trim: true, maxlength: 100, default: '' },
    vendorInvoiceDate: { type: String, trim: true, match: /^\d{4}-\d{2}-\d{2}$/, default: null },

    // ── Notes / terms ─────────────────────────────────────────────────────────
    terms: { type: String, trim: true, maxlength: 3000, default: '' },
    notes: { type: String, trim: true, maxlength: 3000, default: '' },

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

    correlationId: {
      type: String,
      immutable: true,
      trim: true,
      maxlength: 150,
      default: null,
    },
  },
  {
    timestamps: true,
    versionKey: 'version',
    optimisticConcurrency: true,
    collection: 'purchase_orders',
  }
);

// ── Compound indexes ─────────────────────────────────────────────────────────

purchaseOrderSchema.index(
  { organisationId: 1, cafeId: 1, status: 1, createdAt: -1 },
  { name: 'org_cafe_status_date' }
);

purchaseOrderSchema.index(
  { organisationId: 1, vendorId: 1, status: 1 },
  { name: 'org_vendor_status' }
);

purchaseOrderSchema.index(
  { organisationId: 1, requisitionId: 1 },
  {
    unique: true,
    partialFilterExpression: { requisitionId: { $type: 'string' } },
    name: 'org_requisition_unique',
  }
);

// ── Normalisation ────────────────────────────────────────────────────────────

// ── Normalisation & Fulfillment Derivation ──────────────────────────────

purchaseOrderSchema.methods.recalculateFulfillment = function recalculateFulfillment() {
  if (this.status === 'CANCELLED') {
    this.fulfillmentStatus = 'CANCELLED';
    if (Array.isArray(this.lineItems)) {
      for (const li of this.lineItems) {
        li.fulfillmentStatus = 'CANCELLED';
      }
    }
    return this.fulfillmentStatus;
  }

  if (!Array.isArray(this.lineItems) || this.lineItems.length === 0) {
    return this.fulfillmentStatus || 'PENDING_RECEIPT';
  }

  let allLinesFullyReceived = true;
  let allLinesClosedOrFull = true;
  let hasClosedShort = false;
  let hasPendingSubstitution = false;
  let hasVendorUnavailable = false;
  let hasBackorder = false;
  let hasAnyAcceptedReceipt = false;
  let allCancelled = true;

  for (const li of this.lineItems) {
    const ordered = Number(li.orderedQuantityBase || 0);

    // Synchronize receivedQuantityBase and acceptedReceivedQty
    const acceptedFromRec = Number(li.receivedQuantityBase || 0);
    const acceptedFromField = Number(li.acceptedReceivedQty || 0);
    const accepted = Math.max(acceptedFromRec, acceptedFromField);
    li.acceptedReceivedQty = accepted;
    li.receivedQuantityBase = accepted;

    const closedShort = Number(li.closedShortQty || 0);
    const buyerCancelled = Number(li.buyerCancelledQty || 0);
    const outstanding = Math.max(0, ordered - accepted - closedShort - buyerCancelled);
    li.outstandingQty = outstanding;

    if (buyerCancelled < ordered) {
      allCancelled = false;
    }

    if (accepted > 0) {
      hasAnyAcceptedReceipt = true;
    }

    // Check overdue backorders
    if (li.backorderDetails && li.backorderDetails.expectedDeliveryDate) {
      const exp = new Date(li.backorderDetails.expectedDeliveryDate);
      if (exp < new Date() && (li.backorderedQty > 0 || outstanding > 0)) {
        li.backorderDetails.isOverdue = true;
      } else {
        li.backorderDetails.isOverdue = false;
      }
    }

    // Determine line fulfillmentStatus
    if (buyerCancelled >= ordered) {
      li.fulfillmentStatus = 'CANCELLED';
    } else if (accepted >= ordered) {
      li.fulfillmentStatus = 'FULLY_RECEIVED';
    } else if (outstanding === 0 && closedShort > 0) {
      li.fulfillmentStatus = 'CLOSED_SHORT';
      hasClosedShort = true;
    } else if (li.substitution && li.substitution.status === 'PROPOSED') {
      li.fulfillmentStatus = 'SUBSTITUTION_PENDING';
      hasPendingSubstitution = true;
      allLinesFullyReceived = false;
      allLinesClosedOrFull = false;
    } else if (li.vendorUnavailableQty > 0 && (accepted + li.vendorUnavailableQty >= ordered)) {
      li.fulfillmentStatus = 'VENDOR_UNAVAILABLE';
      hasVendorUnavailable = true;
      allLinesFullyReceived = false;
      allLinesClosedOrFull = false;
    } else if (accepted === 0 && li.vendorConfirmationDetails && li.vendorConfirmationDetails.confirmedSupplyQty > 0) {
      if (li.vendorConfirmationDetails.confirmedSupplyQty < ordered) {
        li.fulfillmentStatus = 'PARTIALLY_CONFIRMED';
      } else {
        li.fulfillmentStatus = 'VENDOR_CONFIRMED';
      }
      if (li.backorderedQty > 0) hasBackorder = true;
      if (li.vendorUnavailableQty > 0) hasVendorUnavailable = true;
      allLinesFullyReceived = false;
      allLinesClosedOrFull = false;
    } else if (li.backorderedQty > 0) {
      li.fulfillmentStatus = 'BACKORDERED';
      hasBackorder = true;
      allLinesFullyReceived = false;
      allLinesClosedOrFull = false;
    } else if (accepted > 0) {
      li.fulfillmentStatus = 'PARTIALLY_RECEIVED';
      allLinesFullyReceived = false;
      allLinesClosedOrFull = false;
    } else {
      if (!['ORDERED', 'PENDING_RECEIPT'].includes(li.fulfillmentStatus)) {
        li.fulfillmentStatus = 'ORDERED';
      }
      allLinesFullyReceived = false;
      allLinesClosedOrFull = false;
    }

    if (li.fulfillmentStatus !== 'FULLY_RECEIVED') {
      allLinesFullyReceived = false;
    }
    if (!['FULLY_RECEIVED', 'CLOSED_SHORT'].includes(li.fulfillmentStatus)) {
      allLinesClosedOrFull = false;
    }
    if (li.fulfillmentStatus === 'CLOSED_SHORT') {
      hasClosedShort = true;
    }
  }

  if (allCancelled && this.lineItems.length > 0) {
    this.fulfillmentStatus = 'CANCELLED';
  } else if (allLinesFullyReceived) {
    this.fulfillmentStatus = 'FULLY_RECEIVED';
  } else if (allLinesClosedOrFull && hasClosedShort) {
    this.fulfillmentStatus = 'CLOSED_WITH_SHORTAGE';
  } else if (hasPendingSubstitution || hasVendorUnavailable) {
    this.fulfillmentStatus = 'SHORT_SUPPLY_ACTION_REQUIRED';
  } else if (hasBackorder) {
    this.fulfillmentStatus = 'BACKORDER_PENDING';
  } else if (hasAnyAcceptedReceipt) {
    this.fulfillmentStatus = 'PARTIALLY_RECEIVED';
  } else {
    this.fulfillmentStatus = 'PENDING_RECEIPT';
  }

  return this.fulfillmentStatus;
};

purchaseOrderSchema.pre('validate', function normalisePOFields() {
  const upperFields = [
    'purchaseOrderId', 'organisationId', 'cafeId', 'vendorId',
    'createdByUserId', 'lastModifiedByUserId',
    'submittedByUserId', 'approvedByUserId', 'cancelledByUserId',
  ];
  for (const field of upperFields) {
    if (this[field] && typeof this[field] === 'string') {
      this[field] = this[field].trim().toUpperCase();
    }
  }
  if (this.status) {
    this.status = this.status.trim().toUpperCase();
  }
  if (Array.isArray(this.lineItems) && this.lineItems.length > 0) {
    this.recalculateFulfillment();
  }
});

const PurchaseOrder =
  mongoose.models.PurchaseOrder ||
  mongoose.model('PurchaseOrder', purchaseOrderSchema);

module.exports = {
  PurchaseOrder,
  PO_STATUSES,
  PO_FULFILLMENT_STATUSES,
  PO_LINE_FULFILLMENT_STATUSES,
};

