'use strict';

/**
 * ============================================================================
 * ZAMORIN CAFÉ ERP — REPLENISHMENT RECOMMENDATION MONGOOSE MODEL (P06)
 * ============================================================================
 *
 * Authoritative record of an identified purchasing requirement for an
 * organisation, café, and stock item.
 *
 * INVARIANTS:
 * 1. A recommendation represents a purchasing proposal, NEVER a Purchase Order,
 *    invoice, GL posting, or financial commitment.
 * 2. Exactly ONE active recommendation may exist per (organisationId, cafeId, itemId)
 *    triple at any point in time. Enforced authoritatively by a compound unique
 *    partial index in MongoDB.
 * 3. Lifecycle states explicitly distinguish actionable proposals, data-quality
 *    blocks, operational constraint blocks, supersessions, and resolutions.
 * 4. Stores full deterministic explanation, stock snapshot, demand assumptions,
 *    policy version, supplier feasibility, and calculation fingerprint.
 */

const mongoose = require('mongoose');

const RECOMMENDATION_STATUSES = [
  'ACTIVE_REVIEW',        // Actionable purchase suggestion requiring review (P07)
  'BLOCKED_DATA_QUALITY', // Gated by P05 data-quality failures (missing vendor, bad UOM conversion)
  'BLOCKED_CONSTRAINT',   // Blocked by operational/safety constraints (MOQ exceeds safe stock, shelf-life, storage limit)
  'DEFERRED',             // Intentionally deferred by authorized operator
  'DISMISSED',            // Explicitly rejected / dismissed by reviewer
  'SUPERSEDED',           // Replaced by a newer calculation
  'RESOLVED',             // Need cleared (shortage vanished due to stock receipt or decreased requirement)
  'CONVERTED',            // Converted to procurement draft / PO by P07 (boundary preserved)
];

const ACTIVE_STATUSES = ['ACTIVE_REVIEW', 'BLOCKED_DATA_QUALITY', 'BLOCKED_CONSTRAINT'];

const actionableExceptionSchema = new mongoose.Schema(
  {
    code: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
    },
    severity: {
      type: String,
      enum: ['WARNING', 'BLOCKER'],
      default: 'WARNING',
    },
    message: {
      type: String,
      required: true,
      trim: true,
    },
    correctiveAction: {
      type: String,
      trim: true,
      default: '',
    },
  },
  { _id: false }
);

const revisionHistorySchema = new mongoose.Schema(
  {
    revisedAt: {
      type: Date,
      default: Date.now,
    },
    reason: {
      type: String,
      trim: true,
      default: '',
    },
    previousQuantities: {
      rawNeedBase: { type: Number, default: 0 },
      suggestedBaseQuantity: { type: Number, default: 0 },
      suggestedPurchaseQuantity: { type: Number, default: 0 },
    },
    fingerprint: {
      type: String,
      trim: true,
      default: '',
    },
    evaluatorActor: {
      type: String,
      trim: true,
      default: 'SYSTEM',
    },
  },
  { _id: false }
);

const replenishmentRecommendationSchema = new mongoose.Schema(
  {
    recommendationId: {
      type: String,
      required: true,
      unique: true,
      immutable: true,
      trim: true,
      uppercase: true,
      index: true,
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
    itemId: {
      type: String,
      required: true,
      immutable: true,
      trim: true,
      uppercase: true,
      index: true,
    },

    // ── Lifecycle & Active-Need Identity ─────────────────────────────────────
    status: {
      type: String,
      required: true,
      enum: RECOMMENDATION_STATUSES,
      default: 'ACTIVE_REVIEW',
      index: true,
    },
    isActiveNeed: {
      type: Boolean,
      default: true,
      index: true,
    },
    activeNeedKey: {
      type: String,
      trim: true,
      default: null,
    },

    // ── Item Identity Snapshot ───────────────────────────────────────────────
    itemSnapshot: {
      itemId: { type: String, trim: true, uppercase: true },
      sku: { type: String, trim: true, uppercase: true },
      name: { type: String, trim: true },
      category: { type: String, trim: true },
      baseUnit: { type: String, trim: true, lowercase: true },
      purchaseUnit: { type: String, trim: true, lowercase: true },
      shelfLifeDays: { type: Number, default: 30 },
      storageConstraints: {
        locationZone: { type: String, default: 'MAIN_STORE' },
        temperatureZone: { type: String, default: 'AMBIENT' },
        maxStorageCapacityBase: { type: Number, default: null },
      },
    },

    // ── Authoritative Stock & Supply Snapshot ────────────────────────────────
    stockSnapshot: {
      currentQuantityBase: { type: Number, required: true, default: 0 },
      quarantinedQuantityBase: { type: Number, default: 0 },
      expiredQuantityBase: { type: Number, default: 0 },
      firmAllocationsBase: { type: Number, default: 0 },
      usableQuantityBase: { type: Number, required: true, default: 0 },
      inTransitQuantityBase: { type: Number, default: 0 },
      eligibleInboundBase: { type: Number, default: 0 },
      ineligibleInboundBase: { type: Number, default: 0 },
      inventoryPositionBase: { type: Number, required: true, default: 0 },
      lotCount: { type: Number, default: 0 },
      evaluatedLots: [
        {
          lotId: { type: String, trim: true },
          remainingQuantity: { type: Number, default: 0 },
          expiryDate: { type: String, trim: true },
          status: { type: String, trim: true },
          isUsable: { type: Boolean, default: true },
        },
      ],
      openPurchaseOrders: [
        {
          purchaseOrderId: { type: String, trim: true },
          status: { type: String, trim: true },
          outstandingQuantityBase: { type: Number, default: 0 },
          expectedArrivalDate: { type: String, trim: true },
          isArrivingInTime: { type: Boolean, default: true },
        },
      ],
    },

    // ── Policy & Demand Horizon ──────────────────────────────────────────────
    policySnapshot: {
      reorderPolicy: {
        type: String,
        enum: ['MIN_MAX', 'PAR_LEVEL', 'PERIODIC_REVIEW', 'DEMAND_DRIVEN'],
        default: 'MIN_MAX',
      },
      minQuantityBase: { type: Number, default: 0 },
      parQuantityBase: { type: Number, default: 0 },
      maxQuantityBase: { type: Number, default: 0 },
      safetyStockBase: { type: Number, default: 0 },
      leadTimeDays: { type: Number, default: 1 },
      reviewIntervalDays: { type: Number, default: 7 },
      orderMultipleBase: { type: Number, default: 1 },
      expectedDailyDemandBase: { type: Number, default: 0 },
      demandBasis: {
        type: String,
        enum: ['HISTORICAL_CONSUMPTION', 'CONFIGURED_AVG_DAILY_USAGE', 'POLICY_DEFAULT'],
        default: 'CONFIGURED_AVG_DAILY_USAGE',
      },
      reorderPointBase: { type: Number, default: 0 },
      targetQuantityBase: { type: Number, default: 0 },
    },

    // ── Deterministic Calculation ────────────────────────────────────────────
    calculation: {
      rawNeedBase: { type: Number, required: true, default: 0 },
      suggestedBaseQuantity: { type: Number, required: true, default: 0 },
      conversionFactor: { type: Number, default: 1 },
      suggestedPurchaseQuantity: { type: Number, required: true, default: 0 },
      purchaseUnit: { type: String, trim: true, lowercase: true, default: 'unit' },
      orderMultiple: { type: Number, default: 1 },
      moq: { type: Number, default: 1 },
      estimatedCostPaisa: { type: Number, default: 0 },
      calculationFingerprint: { type: String, trim: true, default: '' },
    },

    // ── Suggested Approved Supplier ──────────────────────────────────────────
    supplierCandidate: {
      vendorId: { type: String, trim: true, uppercase: true, default: null },
      vendorName: { type: String, trim: true, default: '' },
      supplierItemCode: { type: String, trim: true, default: '' },
      uom: { type: String, trim: true, lowercase: true, default: 'unit' },
      contractedPricePaisa: { type: Number, default: 0 },
      leadTimeDays: { type: Number, default: 2 },
      deliveryDays: [{ type: String, trim: true, uppercase: true }],
      moq: { type: Number, default: 1 },
      orderMultiple: { type: Number, default: 1 },
      feasibilityNotes: { type: String, trim: true, default: '' },
    },

    // ── Actionable Exceptions & Governance Blockers ──────────────────────────
    actionableExceptions: [actionableExceptionSchema],

    // ── Transparent Human-Readable Explanation ──────────────────────────────
    explanation: {
      summary: { type: String, trim: true, default: '' },
      triggerReason: {
        type: String,
        enum: [
          'BELOW_REORDER_POINT',
          'PROJECTED_STOCKOUT',
          'SAFETY_STOCK_BREACH',
          'DATA_QUALITY_BLOCK',
          'CAPACITY_CONFLICT',
          'RESOLVED',
        ],
        default: 'BELOW_REORDER_POINT',
      },
      projectedStockoutDays: { type: Number, default: null },
      projectedStockoutDate: { type: String, trim: true, default: null },
    },

    // ── Revision Audit Trail ─────────────────────────────────────────────────
    revisionHistory: [revisionHistorySchema],

    // ── Deferral Lifecycle & State (P07) ──────────────────────────────────────
    deferDetails: {
      deferredUntil: { type: Date, default: null, index: true },
      deferredBy: { type: String, trim: true, uppercase: true, default: null },
      deferredAt: { type: Date, default: null },
      deferReason: { type: String, trim: true, default: '' },
      deferredSnapshot: { type: mongoose.Schema.Types.Mixed, default: null },
      overrideReason: { type: String, trim: true, default: null },
      overriddenAt: { type: Date, default: null },
    },

    // ── P07 PO Conversion Linkage ─────────────────────────────────────────────
    convertedPurchaseOrderId: {
      type: String,
      trim: true,
      uppercase: true,
      default: null,
      index: true,
    },
    convertedRevisionNumber: {
      type: Number,
      default: null,
    },

    // ── Evaluation Context ───────────────────────────────────────────────────
    evaluationSource: {
      type: String,
      enum: ['EVENT', 'SCHEDULED_SWEEP', 'MANUAL_ON_DEMAND'],
      default: 'MANUAL_ON_DEMAND',
    },
    evaluatedBy: {
      type: String,
      trim: true,
      default: 'SYSTEM',
    },
    lastEvaluatedAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  }
);

// ── Compound Indexes & Database Boundary Protection ──────────────────────────
/**
 * CRITICAL DATABASE BOUNDARY INVARIANT:
 * Enforces exactly one active recommendation per (organisationId, cafeId, itemId).
 * When isActiveNeed is true, duplicate inserts fail with MongoDB duplicate key error (code 11000).
 * Historical or resolved records have isActiveNeed: false and do not conflict.
 */
replenishmentRecommendationSchema.index(
  { organisationId: 1, cafeId: 1, itemId: 1, isActiveNeed: 1 },
  {
    unique: true,
    name: 'unique_active_replenishment_need',
    partialFilterExpression: { isActiveNeed: true },
  }
);

replenishmentRecommendationSchema.index(
  { organisationId: 1, cafeId: 1, status: 1 },
  { name: 'idx_org_cafe_status' }
);

replenishmentRecommendationSchema.index(
  { organisationId: 1, itemId: 1 },
  { name: 'idx_org_item' }
);

replenishmentRecommendationSchema.index(
  { organisationId: 1, updatedAt: -1 },
  { name: 'idx_org_updated' }
);

// ── Pre-validate Hook ────────────────────────────────────────────────────────
replenishmentRecommendationSchema.pre('validate', function syncActiveState() {
  const isActive = ACTIVE_STATUSES.includes(this.status);
  this.isActiveNeed = isActive;
  if (isActive) {
    this.activeNeedKey = `${this.organisationId}:${this.cafeId}:${this.itemId}`;
  } else {
    this.activeNeedKey = null;
  }
});

const ReplenishmentRecommendation =
  mongoose.models.ReplenishmentRecommendation ||
  mongoose.model('ReplenishmentRecommendation', replenishmentRecommendationSchema);

module.exports = {
  ReplenishmentRecommendation,
  RECOMMENDATION_STATUSES,
  ACTIVE_STATUSES,
};
