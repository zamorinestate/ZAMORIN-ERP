'use strict';

/**
 * ============================================================================
 * ZAMORIN CAFÉ ERP — AUTOMATIC REPLENISHMENT RECOMMENDATION ENGINE (P06)
 * ============================================================================
 *
 * Authoritative business service for:
 *   - Deterministic, explainable inventory replenishment evaluation
 *   - Usable stock derivation (FEFO-aware, quarantines & expired lots excluded)
 *   - Firm allocation exclusion (catering/reservations uncommitted stock)
 *   - Time-sensitive confirmed inbound PO resolution (shortage horizon-aware)
 *   - Reorder policy calculation (MIN_MAX, PAR_LEVEL, PERIODIC_REVIEW, DEMAND_DRIVEN)
 *   - P05 data-quality gating (blocks automatic purchasing for unqualified master data)
 *   - Operational constraint enforcement (MOQ, pack multiples, shelf-life, storage capacity)
 *   - MongoDB boundary idempotency & duplicate-need prevention
 *   - Scheduled safety sweep & asynchronous event evaluation
 *
 * CRITICAL BOUNDARY INVARIANT:
 *   P06 Recommends. P07 Approves & Purchases.
 *   This service produces explainable purchase suggestions. It NEVER creates
 *   Purchase Orders, approves requisitions, contacts vendors, mutates lots,
 *   or posts to financial ledgers.
 */

const crypto = require('crypto');
const { GlobalInventoryItem } = require('../models/GlobalInventoryItem');
const { CafeInventoryConfig } = require('../models/CafeInventoryConfig');
const { Vendor } = require('../models/Vendor');
const { InventoryLot } = require('../models/InventoryLot');
const { StockMovement } = require('../models/StockMovement');
const { PurchaseOrder } = require('../models/PurchaseOrder');
const { InventoryReservation } = require('../models/InventoryReservation');
const {
  ReplenishmentRecommendation,
  ACTIVE_STATUSES,
} = require('../models/ReplenishmentRecommendation');
const {
  validateItemDataQuality,
  resolvePurchaseOrderParameters,
} = require('./dataFoundationService');
const { ApiError } = require('../utils/ApiError');

function getIstDateStr(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function addDaysToIstStr(dateStr, days) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function generateRecommendationId(organisationId, cafeId, itemId) {
  const datePart = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const rand = crypto.randomBytes(3).toString('hex').toUpperCase();
  return `REC-${datePart}-${cafeId}-${itemId}-${rand}`;
}

function computeFingerprint(payload) {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(payload))
    .digest('hex');
}

class ReplenishmentRecommendationService {
  /**
   * Evaluates a single item at a given café and persists an authoritative,
   * deduplicated recommendation.
   *
   * @param {Object} params
   * @param {string} params.organisationId
   * @param {string} params.cafeId
   * @param {string} params.itemId
   * @param {string} [params.source='MANUAL_ON_DEMAND']
   * @param {string} [params.actorId='SYSTEM']
   * @returns {Promise<Object>} Persisted recommendation result
   */
  static async evaluateItem({
    organisationId,
    cafeId,
    itemId,
    source = 'MANUAL_ON_DEMAND',
    actorId = 'SYSTEM',
  }) {
    if (!organisationId || !cafeId || !itemId) {
      throw new ApiError(400, 'VALIDATION_FAILED', 'organisationId, cafeId, and itemId are required.');
    }

    const cleanOrg = organisationId.trim().toUpperCase();
    const cleanCafe = cafeId.trim().toUpperCase();
    const cleanItem = itemId.trim().toUpperCase();
    const todayStr = getIstDateStr();

    // ── 1. Fetch Item Master & Café Inventory Config ────────────────────────
    const [item, config] = await Promise.all([
      GlobalInventoryItem.findOne({ organisationId: cleanOrg, itemId: cleanItem }).lean(),
      CafeInventoryConfig.findOne({ organisationId: cleanOrg, cafeId: cleanCafe, itemId: cleanItem }),
    ]);

    if (!item || !config) {
      return {
        evaluated: false,
        reason: !item ? 'ITEM_NOT_FOUND' : 'CONFIG_NOT_FOUND',
      };
    }

    // If item is inactive or replenishment is explicitly disabled at this café
    if (item.status !== 'ACTIVE' || config.replenishmentEnabled === false || config.stockedHere === false) {
      // If an active recommendation exists, mark it resolved/superseded
      const existing = await ReplenishmentRecommendation.findOne({
        organisationId: cleanOrg,
        cafeId: cleanCafe,
        itemId: cleanItem,
        isActiveNeed: true,
      });
      if (existing) {
        existing.status = 'RESOLVED';
        existing.isActiveNeed = false;
        existing.activeNeedKey = null;
        existing.explanation.summary = `Replenishment deactivated: item status is ${item.status}, replenishmentEnabled=${config.replenishmentEnabled}.`;
        await existing.save();
      }
      return {
        evaluated: true,
        action: 'DEACTIVATED_OR_DISABLED',
        status: 'RESOLVED',
      };
    }

    // ── 2. Run P05 Data-Quality Gate ─────────────────────────────────────────
    const dqResult = await validateItemDataQuality({
      organisationId: cleanOrg,
      cafeId: cleanCafe,
      itemId: cleanItem,
    });

    const actionableExceptions = [];
    let isBlockedByDataQuality = !dqResult.isAutomaticPurchasingEligible;

    if (isBlockedByDataQuality) {
      for (const errCode of dqResult.errors) {
        let message = `Data-quality validation failed: ${errCode}`;
        let correctiveAction = 'Review and update master data.';

        switch (errCode) {
          case 'MISSING_VENDOR_MAPPING':
            message = 'No active approved supplier mapped for this item at this café.';
            correctiveAction = 'Map an approved vendor in Vendor Item Catalogue with café approval.';
            break;
          case 'AMBIGUOUS_UNIT_CONVERSION':
            message = `Purchase unit (${item.purchaseUnit}) differs from base unit (${item.baseUnit}) with no valid conversion factor.`;
            correctiveAction = 'Define conversion factor in Global Inventory Item conversions.';
            break;
          case 'EXPIRED_UNIT_CONVERSION':
            message = 'The configured purchase-to-base unit conversion has expired.';
            correctiveAction = 'Update effective dates for unit conversion in Global Inventory Item.';
            break;
          case 'MISSING_CONTRACTED_RATE':
            message = 'Mapped supplier does not have an active contracted rate (> 0 paisa).';
            correctiveAction = 'Add valid contracted price in supplier catalogue.';
            break;
          case 'INVALID_LEAD_TIME_LESS_THAN_ONE':
            message = 'Configured supplier lead time is less than 1 day.';
            correctiveAction = 'Set leadTimeDays >= 1 in Café Inventory Config.';
            break;
          case 'INVALID_POLICY_PAR_LESS_THAN_MIN':
            message = 'Configured PAR level is strictly less than Minimum Stock threshold.';
            correctiveAction = 'Ensure parQuantityBase >= minQuantityBase.';
            break;
          case 'INVALID_POLICY_MAX_LESS_THAN_PAR':
            message = 'Configured Maximum Stock is strictly less than PAR level.';
            correctiveAction = 'Ensure maxQuantityBase >= parQuantityBase.';
            break;
        }

        actionableExceptions.push({
          code: errCode,
          severity: 'BLOCKER',
          message,
          correctiveAction,
        });
      }
    }

    // ── 3. Calculate Usable Stock & Usable Lots (FEFO-aware) ─────────────────
    const [lots, activeReservations] = await Promise.all([
      InventoryLot.find({
        organisationId: cleanOrg,
        cafeId: cleanCafe,
        itemId: cleanItem,
      }).lean(),
      InventoryReservation.find({
        organisationId: cleanOrg,
        cafeId: cleanCafe,
        itemId: cleanItem,
        status: 'ACTIVE',
        expiresAt: { $gt: new Date() },
      }).lean(),
    ]);

    let usableLotQuantity = 0;
    let expiredLotQuantity = 0;
    let quarantinedLotQuantity = 0;
    const evaluatedLots = [];

    for (const lot of lots) {
      const isExpired = lot.status === 'EXPIRED' || (lot.expiryDate && lot.expiryDate < todayStr);
      const isQuarantined = ['QUARANTINE', 'RECALL_HOLD', 'DISPOSED', 'RETURNED'].includes(lot.status);
      const isUsable = !isExpired && !isQuarantined && lot.remainingQuantity > 0;

      if (isExpired) {
        expiredLotQuantity += lot.remainingQuantity || 0;
      } else if (isQuarantined) {
        quarantinedLotQuantity += lot.remainingQuantity || 0;
      } else if (isUsable) {
        usableLotQuantity += lot.remainingQuantity;
      }

      evaluatedLots.push({
        lotId: lot.lotId,
        remainingQuantity: lot.remainingQuantity || 0,
        expiryDate: lot.expiryDate,
        status: lot.status,
        isUsable,
      });
    }

    // Calculate firm demand allocations (reservations)
    const firmAllocationsBase = activeReservations.reduce(
      (sum, r) => sum + (Number(r.reservedQty) || 0),
      0
    );

    // Negative stock check
    const currentStockBase = Number(config.currentQuantityBase) || 0;
    if (currentStockBase < 0) {
      actionableExceptions.push({
        code: 'NEGATIVE_STOCK',
        severity: 'BLOCKER',
        message: `Negative physical stock balance detected (${currentStockBase} ${item.baseUnit}). Immediate stock audit required.`,
        correctiveAction: 'Perform physical cycle count to reconcile discrepancy.',
      });
      isBlockedByDataQuality = true;
    }

    // Usable unallocated quantity
    const totalUnusable = Math.max(
      (Number(config.quarantinedQuantityBase) || 0) + (Number(config.expiredQuantityBase) || 0),
      quarantinedLotQuantity + expiredLotQuantity
    );
    const physicallyUsable = Math.max(0, currentStockBase - totalUnusable);
    const usableQuantityBase = Math.max(0, physicallyUsable - firmAllocationsBase);

    // ── 4. Calculate Time-Sensitive Inbound Supply ───────────────────────────
    const openPOs = await PurchaseOrder.find({
      organisationId: cleanOrg,
      cafeId: cleanCafe,
      'lineItems.itemId': cleanItem,
      status: {
        $in: [
          'APPROVED',
          'ORDER_PLACED',
          'ORDERED',
          'ACKNOWLEDGED',
          'DISPATCHED',
          'PARTIALLY_RECEIVED',
        ],
      },
    }).lean();

    let eligibleInboundBase = 0;
    let ineligibleInboundBase = 0;
    const evaluatedPOs = [];

    // Derive expected daily demand for shortage timing
    const leadTimeDays = Math.max(1, config.leadTimeDays || dqResult.vendorMapping?.leadTimeDays || 2);
    const reviewIntervalDays = config.reviewIntervalDays || 7;
    const safetyStockBase = Math.max(0, config.safetyStockBase || 0);

    let expectedDailyDemand = Number(config.avgDailyUsageBase) || 0;
    let demandBasis = 'CONFIGURED_AVG_DAILY_USAGE';

    if (config.reorderPolicy === 'DEMAND_DRIVEN') {
      // Inspect last 30 days of consumption movements
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      const consumptionMovements = await StockMovement.find({
        organisationId: cleanOrg,
        cafeId: cleanCafe,
        itemId: cleanItem,
        movementType: 'CONSUMPTION',
        createdAt: { $gte: thirtyDaysAgo },
      }).lean();

      if (consumptionMovements.length >= 7) {
        const totalConsumed = consumptionMovements.reduce(
          (sum, m) => sum + Math.abs(Number(m.quantityBase) || 0),
          0
        );
        expectedDailyDemand = Number((totalConsumed / 30).toFixed(2));
        demandBasis = 'HISTORICAL_CONSUMPTION';
      } else {
        // Safe fallback when demand history is insufficient
        demandBasis = 'CONFIGURED_AVG_DAILY_USAGE';
        actionableExceptions.push({
          code: 'INSUFFICIENT_DEMAND_HISTORY',
          severity: 'WARNING',
          message: `Insufficient consumption history (< 7 recorded movements). Safely falling back to configured average daily usage (${expectedDailyDemand} ${item.baseUnit}).`,
          correctiveAction: 'Maintain normal stock operations to accumulate 30-day demand history.',
        });
      }
    }

    // Determine projected stockout date
    let daysUntilStockout = null;
    let projectedStockoutDate = null;
    if (expectedDailyDemand > 0) {
      daysUntilStockout = Number((usableQuantityBase / expectedDailyDemand).toFixed(1));
      projectedStockoutDate = addDaysToIstStr(todayStr, Math.ceil(daysUntilStockout));
    } else if (usableQuantityBase === 0) {
      daysUntilStockout = 0;
      projectedStockoutDate = todayStr;
    }

    const shortageHorizonDate = projectedStockoutDate || addDaysToIstStr(todayStr, leadTimeDays);

    for (const po of openPOs) {
      const line = (po.lineItems || []).find((l) => l.itemId === cleanItem);
      if (!line) continue;

      const lineCancelled = ['CANCELLED', 'CLOSED_SHORT', 'VENDOR_UNAVAILABLE', 'FULLY_RECEIVED'].includes(
        line.fulfillmentStatus
      );
      if (lineCancelled) continue;

      const outstandingQty = Math.max(
        0,
        Number(line.outstandingQty || 0) ||
          Number(line.orderedQuantityBase || 0) - Number(line.acceptedReceivedQty || line.receivedQuantityBase || 0)
      );
      if (outstandingQty <= 0) continue;

      const arrivalDate =
        po.supplierConfirmedDeliveryDate || po.expectedDeliveryDate || po.orderDate || todayStr;

      // Inbound supply counts only if expected before or by shortage horizon
      const isArrivingInTime = !projectedStockoutDate || arrivalDate <= shortageHorizonDate;

      if (isArrivingInTime) {
        eligibleInboundBase += outstandingQty;
      } else {
        ineligibleInboundBase += outstandingQty;
        actionableExceptions.push({
          code: 'INBOUND_TOO_LATE',
          severity: 'WARNING',
          message: `Inbound PO ${po.purchaseOrderId} (${outstandingQty} ${item.baseUnit}) arrives on ${arrivalDate}, after projected stockout date (${projectedStockoutDate}). It cannot prevent this shortage.`,
          correctiveAction: 'Expedite vendor delivery or place an emergency replenishment order.',
        });
      }

      evaluatedPOs.push({
        purchaseOrderId: po.purchaseOrderId,
        status: po.status,
        outstandingQuantityBase: outstandingQty,
        expectedArrivalDate: arrivalDate,
        isArrivingInTime,
      });
    }

    // Net Inventory Position
    const inventoryPositionBase = usableQuantityBase + eligibleInboundBase;

    // ── 5. Reorder Point & Target Horizon Calculation ────────────────────────
    let reorderPointBase = 0;
    let targetQuantityBase = 0;

    switch (config.reorderPolicy) {
      case 'MIN_MAX':
        reorderPointBase =
          config.minQuantityBase > 0
            ? config.minQuantityBase
            : expectedDailyDemand * leadTimeDays + safetyStockBase;
        targetQuantityBase =
          config.maxQuantityBase > 0
            ? config.maxQuantityBase
            : expectedDailyDemand * (leadTimeDays + reviewIntervalDays) + safetyStockBase;
        break;

      case 'PAR_LEVEL':
        targetQuantityBase =
          config.parQuantityBase > 0
            ? config.parQuantityBase
            : expectedDailyDemand * (leadTimeDays + reviewIntervalDays) + safetyStockBase;
        reorderPointBase =
          config.minQuantityBase > 0 ? config.minQuantityBase : targetQuantityBase;
        break;

      case 'PERIODIC_REVIEW':
        reorderPointBase = expectedDailyDemand * leadTimeDays + safetyStockBase;
        targetQuantityBase =
          expectedDailyDemand * (leadTimeDays + reviewIntervalDays) + safetyStockBase;
        break;

      case 'DEMAND_DRIVEN':
        reorderPointBase = expectedDailyDemand * leadTimeDays + safetyStockBase;
        targetQuantityBase =
          expectedDailyDemand * (leadTimeDays + reviewIntervalDays) + safetyStockBase;
        break;

      default:
        reorderPointBase = config.minQuantityBase || 10;
        targetQuantityBase = config.maxQuantityBase || 30;
    }

    // ── 6. Trigger Determination & Raw Need ──────────────────────────────────
    const isBelowReorder = inventoryPositionBase <= reorderPointBase;
    const isProjectedStockout =
      daysUntilStockout !== null && daysUntilStockout <= leadTimeDays;
    const isTriggered = isBelowReorder || isProjectedStockout;

    // If stock is sufficient and not blocked by data quality, resolve any active recommendation
    if (!isTriggered && !isBlockedByDataQuality) {
      const existing = await ReplenishmentRecommendation.findOne({
        organisationId: cleanOrg,
        cafeId: cleanCafe,
        itemId: cleanItem,
        isActiveNeed: true,
      });

      if (existing) {
        existing.status = 'RESOLVED';
        existing.isActiveNeed = false;
        existing.activeNeedKey = null;
        existing.explanation.summary = `Shortage resolved. Net inventory position (${inventoryPositionBase} ${item.baseUnit}) exceeds reorder threshold (${reorderPointBase} ${item.baseUnit}).`;
        existing.explanation.triggerReason = 'RESOLVED';
        existing.lastEvaluatedAt = new Date();
        existing.evaluationSource = source;
        await existing.save();
        return {
          evaluated: true,
          action: 'RESOLVED_EXISTING',
          recommendation: existing,
        };
      }

      return {
        evaluated: true,
        action: 'NO_REPLENISHMENT_NEEDED',
        inventoryPosition: inventoryPositionBase,
        reorderPoint: reorderPointBase,
      };
    }

    // Raw purchase requirement in base units
    const rawNeedBase = Math.max(0, targetQuantityBase - inventoryPositionBase);

    // ── 7. Supplier Mapping, Unit Conversion & Order Multiples ───────────────
    let suggestedBaseQuantity = rawNeedBase;
    let suggestedPurchaseQuantity = rawNeedBase;
    let conversionFactor = 1;
    let orderMultiple = 1;
    let moq = 1;
    let contractedPricePaisa = 0;
    let supplierCandidate = {
      vendorId: null,
      vendorName: '',
      supplierItemCode: '',
      uom: item.purchaseUnit || item.baseUnit || 'unit',
      contractedPricePaisa: 0,
      leadTimeDays,
      deliveryDays: [],
      moq: 1,
      orderMultiple: 1,
      feasibilityNotes: '',
    };

    if (dqResult.vendorMapping) {
      const vm = dqResult.vendorMapping;
      conversionFactor = vm.uomConversionFactor || 1;
      orderMultiple = vm.orderMultiple || 1;
      moq = vm.moq || 1;
      contractedPricePaisa = vm.contractedPricePaisa || 0;

      // Convert raw base need into supplier purchase units
      const purchaseQtyRaw = rawNeedBase / conversionFactor;

      // Round UP to supplier order multiple
      let roundedPurchaseQty = Math.ceil(purchaseQtyRaw / orderMultiple) * orderMultiple;

      // Enforce MOQ
      if (roundedPurchaseQty < moq) {
        roundedPurchaseQty = moq;
      }

      suggestedPurchaseQuantity = roundedPurchaseQty;
      suggestedBaseQuantity = roundedPurchaseQty * conversionFactor;

      supplierCandidate = {
        vendorId: vm.vendorId,
        vendorName: vm.name,
        supplierItemCode: vm.supplierItemCode || '',
        uom: vm.uom || item.purchaseUnit || 'unit',
        contractedPricePaisa,
        leadTimeDays: vm.leadTimeDays || leadTimeDays,
        deliveryDays: vm.deliveryDays || [],
        moq,
        orderMultiple,
        feasibilityNotes: `Primary approved supplier mapped with contracted rate ₹${(contractedPricePaisa / 100).toFixed(2)}/${vm.uom || 'unit'}. Lead time: ${vm.leadTimeDays || leadTimeDays} days.`,
      };
    }

    // ── 8. Operational Constraints & Safety Exceptions ───────────────────────
    let isBlockedByConstraint = false;

    // Constraint A: MOQ or Pack Multiple creates extreme overstock
    if (config.maxQuantityBase > 0) {
      const projectedStockAfterOrder = inventoryPositionBase + suggestedBaseQuantity;
      if (projectedStockAfterOrder > config.maxQuantityBase) {
        if (suggestedPurchaseQuantity === moq && rawNeedBase < moq * conversionFactor) {
          actionableExceptions.push({
            code: 'MOQ_EXCEEDS_SAFE_STOCK',
            severity: 'BLOCKER',
            message: `Supplier Minimum Order Quantity (${moq} ${supplierCandidate.uom} = ${moq * conversionFactor} ${item.baseUnit}) forces stock (${projectedStockAfterOrder}) above configured maximum limit (${config.maxQuantityBase} ${item.baseUnit}).`,
            correctiveAction: 'Negotiate lower supplier MOQ or source via inter-café transfer.',
          });
          isBlockedByConstraint = true;
        } else {
          actionableExceptions.push({
            code: 'PACK_MULTIPLE_OVERSTOCK_RISK',
            severity: 'BLOCKER',
            message: `Supplier order multiple (${orderMultiple} ${supplierCandidate.uom}) yields ${suggestedBaseQuantity} ${item.baseUnit}, exceeding maximum stock capacity (${config.maxQuantityBase} ${item.baseUnit}).`,
            correctiveAction: 'Adjust café max stock policy or configure alternate packaging.',
          });
          isBlockedByConstraint = true;
        }
      }
    }

    // Constraint B: Perishability & Shelf-Life Risk
    const shelfLifeDays = item.shelfLifeDays || 30;
    if (expectedDailyDemand > 0) {
      const maxConsumableBeforeExpiry = expectedDailyDemand * shelfLifeDays;
      if (suggestedBaseQuantity > maxConsumableBeforeExpiry) {
        actionableExceptions.push({
          code: 'SHELF_LIFE_CONSTRAINT',
          severity: 'BLOCKER',
          message: `Proposed order quantity (${suggestedBaseQuantity} ${item.baseUnit}) exceeds total consumption capacity before shelf-life expiration (${shelfLifeDays} days = ${maxConsumableBeforeExpiry} ${item.baseUnit}). High spoilage risk.`,
          correctiveAction: 'Source smaller pack size or switch to shorter periodic review.',
        });
        isBlockedByConstraint = true;
      }
    }

    // Constraint C: Storage Physical Capacity
    const storageMaxBase = config.storageConstraints?.maxStorageCapacityBase;
    if (storageMaxBase && storageMaxBase > 0) {
      const totalVolume = usableQuantityBase + suggestedBaseQuantity;
      if (totalVolume > storageMaxBase) {
        actionableExceptions.push({
          code: 'STORAGE_CAPACITY_CONSTRAINT',
          severity: 'BLOCKER',
          message: `Proposed replenishment brings storage volume to ${totalVolume} ${item.baseUnit}, violating physical zone capacity limit (${storageMaxBase} ${item.baseUnit}).`,
          correctiveAction: 'Review storage allocation or stagger deliveries.',
        });
        isBlockedByConstraint = true;
      }
    }

    // Final Lifecycle Status Determination
    let finalStatus = 'ACTIVE_REVIEW';
    if (isBlockedByDataQuality) {
      finalStatus = 'BLOCKED_DATA_QUALITY';
    } else if (isBlockedByConstraint) {
      finalStatus = 'BLOCKED_CONSTRAINT';
    }

    // ── 9. Human-Readable Transparent Explanation ────────────────────────────
    let summary = '';
    let triggerReason = 'BELOW_REORDER_POINT';

    if (isBlockedByDataQuality) {
      triggerReason = 'DATA_QUALITY_BLOCK';
      summary = `Replenishment recommendation blocked by data-quality invariants (${actionableExceptions.map((e) => e.code).join(', ')}).`;
    } else if (isBlockedByConstraint) {
      triggerReason = 'CAPACITY_CONFLICT';
      summary = `Replenishment recommendation blocked by operational safety constraints (${actionableExceptions.map((e) => e.code).join(', ')}).`;
    } else if (isBelowReorder) {
      triggerReason = 'BELOW_REORDER_POINT';
      summary = `Usable unallocated stock (${usableQuantityBase}) + confirmed inbound (${eligibleInboundBase}) = ${inventoryPositionBase} ${item.baseUnit}, which is at or below reorder threshold (${reorderPointBase} ${item.baseUnit}). Suggested order: ${suggestedPurchaseQuantity} ${supplierCandidate.uom} (${suggestedBaseQuantity} ${item.baseUnit}).`;
    } else {
      triggerReason = 'PROJECTED_STOCKOUT';
      summary = `Projected stockout within lead time (${daysUntilStockout} days remaining vs ${leadTimeDays} days lead time). Suggested order: ${suggestedPurchaseQuantity} ${supplierCandidate.uom} (${suggestedBaseQuantity} ${item.baseUnit}).`;
    }

    // ── 10. Database Boundary Deduplication & Idempotency ────────────────────
    const calculationFingerprint = computeFingerprint({
      rawNeedBase,
      suggestedBaseQuantity,
      suggestedPurchaseQuantity,
      inventoryPositionBase,
      reorderPointBase,
      targetQuantityBase,
      finalStatus,
      vendorId: supplierCandidate.vendorId,
    });

    const recommendationData = {
      organisationId: cleanOrg,
      cafeId: cleanCafe,
      itemId: cleanItem,
      status: finalStatus,
      isActiveNeed: true,
      activeNeedKey: `${cleanOrg}:${cleanCafe}:${cleanItem}`,
      itemSnapshot: {
        itemId: item.itemId,
        sku: item.sku,
        name: item.name,
        category: item.category,
        baseUnit: item.baseUnit,
        purchaseUnit: item.purchaseUnit || item.baseUnit,
        shelfLifeDays: item.shelfLifeDays || 30,
        storageConstraints: {
          locationZone: config.storageConstraints?.locationZone || 'MAIN_STORE',
          temperatureZone: config.storageConstraints?.temperatureZone || 'AMBIENT',
          maxStorageCapacityBase: config.storageConstraints?.maxStorageCapacityBase || null,
        },
      },
      stockSnapshot: {
        currentQuantityBase: currentStockBase,
        quarantinedQuantityBase: quarantinedLotQuantity,
        expiredQuantityBase: expiredLotQuantity,
        firmAllocationsBase,
        usableQuantityBase,
        inTransitQuantityBase: Number(config.inTransitQuantityBase) || 0,
        eligibleInboundBase,
        ineligibleInboundBase,
        inventoryPositionBase,
        lotCount: evaluatedLots.length,
        evaluatedLots,
        openPurchaseOrders: evaluatedPOs,
      },
      policySnapshot: {
        reorderPolicy: config.reorderPolicy || 'MIN_MAX',
        minQuantityBase: config.minQuantityBase || 0,
        parQuantityBase: config.parQuantityBase || 0,
        maxQuantityBase: config.maxQuantityBase || 0,
        safetyStockBase,
        leadTimeDays,
        reviewIntervalDays,
        orderMultipleBase: config.orderMultipleBase || 1,
        expectedDailyDemandBase: expectedDailyDemand,
        demandBasis,
        reorderPointBase,
        targetQuantityBase,
      },
      calculation: {
        rawNeedBase,
        suggestedBaseQuantity,
        conversionFactor,
        suggestedPurchaseQuantity,
        purchaseUnit: supplierCandidate.uom,
        orderMultiple,
        moq,
        estimatedCostPaisa: suggestedPurchaseQuantity * contractedPricePaisa,
        calculationFingerprint,
      },
      supplierCandidate,
      actionableExceptions,
      revisionHistory: [],
      explanation: {
        summary,
        triggerReason,
        projectedStockoutDays: daysUntilStockout,
        projectedStockoutDate,
      },
      evaluationSource: source,
      evaluatedBy: actorId,
      lastEvaluatedAt: new Date(),
    };

    // Query existing active recommendation
    const existingRec = await ReplenishmentRecommendation.findOne({
      organisationId: cleanOrg,
      cafeId: cleanCafe,
      itemId: cleanItem,
      isActiveNeed: true,
    });

    if (existingRec) {
      // Check if inputs have materially changed
      const isIdentical =
        existingRec.calculation.calculationFingerprint === calculationFingerprint &&
        existingRec.status === finalStatus;

      if (isIdentical) {
        existingRec.lastEvaluatedAt = new Date();
        existingRec.evaluationSource = source;
        existingRec.evaluatedBy = actorId;
        await existingRec.save();
        return {
          evaluated: true,
          action: 'IDEMPOTENT_UNMODIFIED',
          recommendation: existingRec,
        };
      }

      // Record revision history
      const preservedHistory = Array.isArray(existingRec.revisionHistory) ? [...existingRec.revisionHistory] : [];
      preservedHistory.push({
        revisedAt: new Date(),
        reason: `State updated from ${existingRec.status} to ${finalStatus}. Input fingerprint changed.`,
        previousQuantities: {
          rawNeedBase: existingRec.calculation.rawNeedBase,
          suggestedBaseQuantity: existingRec.calculation.suggestedBaseQuantity,
          suggestedPurchaseQuantity: existingRec.calculation.suggestedPurchaseQuantity,
        },
        fingerprint: existingRec.calculation.calculationFingerprint,
        evaluatorActor: actorId,
      });

      // Apply new calculation snapshots while preserving revision history
      const { revisionHistory: _emptyHist, ...snapshotsToApply } = recommendationData;
      Object.assign(existingRec, snapshotsToApply);
      existingRec.revisionHistory = preservedHistory;
      await existingRec.save();

      return {
        evaluated: true,
        action: 'UPDATED_EXISTING',
        recommendation: existingRec,
      };
    }

    // ── Check Unresolved Deferral Suppression (P07 Fix) ──────────────────────
    const now = new Date();
    const activeDeferral = await ReplenishmentRecommendation.findOne({
      organisationId: cleanOrg,
      cafeId: cleanCafe,
      itemId: cleanItem,
      status: 'DEFERRED',
      'deferDetails.deferredUntil': { $gt: now },
    }).sort({ 'deferDetails.deferredAt': -1 });

    if (activeDeferral) {
      const snap = activeDeferral.deferDetails?.deferredSnapshot || {};
      const prevUsable = Number(snap.usableQuantityBase !== undefined ? snap.usableQuantityBase : usableQuantityBase);
      const prevInbound = Number(snap.eligibleInboundBase !== undefined ? snap.eligibleInboundBase : eligibleInboundBase);
      const prevStockoutDays = Number(snap.projectedStockoutDays !== undefined ? snap.projectedStockoutDays : daysUntilStockout);

      let materialEscalationReason = null;

      // Escalation Condition 1: Usable stock fell significantly (>= 10% drop or stock reached zero)
      if (usableQuantityBase < prevUsable && (prevUsable - usableQuantityBase >= Math.max(1, prevUsable * 0.1) || usableQuantityBase <= 0)) {
        materialEscalationReason = `Usable stock fell significantly from ${prevUsable} to ${usableQuantityBase} ${item.baseUnit} during deferral period.`;
      }
      // Escalation Condition 2: Confirmed inbound was cancelled or delayed
      else if (prevInbound > 0 && eligibleInboundBase < prevInbound) {
        materialEscalationReason = `Confirmed inbound supply reduced/cancelled from ${prevInbound} to ${eligibleInboundBase} ${item.baseUnit}.`;
      }
      // Escalation Condition 3: Projected stockout became materially earlier
      else if (daysUntilStockout !== null && prevStockoutDays !== null && daysUntilStockout < prevStockoutDays) {
        materialEscalationReason = `Projected stockout horizon shortened from ${prevStockoutDays} to ${daysUntilStockout} days.`;
      }

      if (!materialEscalationReason) {
        // Condition unchanged: PRESERVE DEFERRAL and suppress duplicate active recommendation
        return {
          evaluated: true,
          action: 'DEFERRAL_PRESERVED',
          recommendation: activeDeferral,
          suppressed: true,
          reason: `Active deferral until ${activeDeferral.deferDetails.deferredUntil.toISOString()} preserved (no material escalation).`,
        };
      }

      // Material escalation detected! Reopen and record override explanation
      activeDeferral.deferDetails.overrideReason = materialEscalationReason;
      activeDeferral.deferDetails.overriddenAt = now;
      await activeDeferral.save();

      recommendationData.explanation.summary = `[DEFERRAL OVERRIDDEN: ${materialEscalationReason}] ${recommendationData.explanation.summary}`;
    }

    // Insert new authoritative recommendation with E11000 race protection
    const recommendationId = generateRecommendationId(cleanOrg, cleanCafe, cleanItem);
    try {
      const created = await ReplenishmentRecommendation.create({
        ...recommendationData,
        recommendationId,
      });

      return {
        evaluated: true,
        action: 'CREATED_NEW',
        recommendation: created,
      };
    } catch (insertError) {
      if (insertError.code === 11000) {
        // Concurrency insert race lost to simultaneous request
        // Fetch and return the winning authoritative recommendation
        const winning = await ReplenishmentRecommendation.findOne({
          organisationId: cleanOrg,
          cafeId: cleanCafe,
          itemId: cleanItem,
          isActiveNeed: true,
        });

        if (winning) {
          winning.lastEvaluatedAt = new Date();
          winning.evaluationSource = source;
          await winning.save();
          return {
            evaluated: true,
            action: 'CONCURRENT_RACE_CONVERGED',
            recommendation: winning,
          };
        }
      }
      throw insertError;
    }
  }

  /**
   * Evaluates all replenishment-enabled items for a given café.
   *
   * @param {Object} params
   * @param {string} params.organisationId
   * @param {string} params.cafeId
   * @param {string} [params.actorId='SYSTEM_SWEEP']
   * @returns {Promise<Object>} Sweep summary report
   */
  static async sweepCafe({ organisationId, cafeId, actorId = 'SYSTEM_SWEEP' }) {
    if (!organisationId || !cafeId) {
      throw new ApiError(400, 'VALIDATION_FAILED', 'organisationId and cafeId are required for sweep.');
    }

    const cleanOrg = organisationId.trim().toUpperCase();
    const cleanCafe = cafeId.trim().toUpperCase();
    const startTime = Date.now();

    const configs = await CafeInventoryConfig.find({
      organisationId: cleanOrg,
      cafeId: cleanCafe,
      replenishmentEnabled: true,
      stockedHere: true,
      status: 'ACTIVE',
    }).lean();

    const metrics = {
      cafeId: cleanCafe,
      itemsEvaluated: configs.length,
      recommendationsCreated: 0,
      recommendationsUpdated: 0,
      recommendationsResolved: 0,
      blockedDataQuality: 0,
      blockedConstraint: 0,
      unmodified: 0,
      errors: [],
      durationMs: 0,
    };

    for (const c of configs) {
      try {
        const result = await this.evaluateItem({
          organisationId: cleanOrg,
          cafeId: cleanCafe,
          itemId: c.itemId,
          source: 'SCHEDULED_SWEEP',
          actorId,
        });

        if (result.action === 'CREATED_NEW') {
          metrics.recommendationsCreated++;
        } else if (result.action === 'UPDATED_EXISTING') {
          metrics.recommendationsUpdated++;
        } else if (result.action === 'RESOLVED_EXISTING') {
          metrics.recommendationsResolved++;
        } else if (result.action === 'IDEMPOTENT_UNMODIFIED' || result.action === 'CONCURRENT_RACE_CONVERGED') {
          metrics.unmodified++;
        }

        if (result.recommendation?.status === 'BLOCKED_DATA_QUALITY') {
          metrics.blockedDataQuality++;
        } else if (result.recommendation?.status === 'BLOCKED_CONSTRAINT') {
          metrics.blockedConstraint++;
        }
      } catch (err) {
        metrics.errors.push({ itemId: c.itemId, error: err.message });
      }
    }

    metrics.durationMs = Date.now() - startTime;
    return metrics;
  }

  /**
   * Retrieves active or filtered recommendations with role and café scoping.
   *
   * @param {Object} params
   * @param {string} params.organisationId
   * @param {string} [params.cafeId]
   * @param {string} [params.status]
   * @param {boolean} [params.activeOnly=true]
   * @returns {Promise<Array>}
   */
  static async getRecommendations({
    organisationId,
    cafeId = null,
    status = null,
    activeOnly = true,
  }) {
    const filter = { organisationId: organisationId.trim().toUpperCase() };

    if (cafeId) {
      filter.cafeId = cafeId.trim().toUpperCase();
    }

    if (status) {
      filter.status = status.trim().toUpperCase();
    } else if (activeOnly) {
      filter.isActiveNeed = true;
    }

    return ReplenishmentRecommendation.find(filter)
      .sort({ updatedAt: -1 })
      .lean();
  }

  /**
   * Initializes listeners on the distributed event bus for automatic reevaluation.
   * Dispatches asynchronously with fail-safe error isolation.
   *
   * @param {Object} [eventBus]
   */
  static initializeEventSubscriptions(eventBus = null) {
    const bus = eventBus || require('./distributedEventBus').defaultEventBus;
    if (!bus || typeof bus.subscribe !== 'function') return;

    const EVENT_TOPICS = [
      'INVENTORY_MOVEMENT_RECORDED',
      'GOODS_RECEIPT_POSTED',
      'POS_ORDER_COMPLETED',
      'STOCK_WASTAGE_POSTED',
      'STOCK_TRANSFER_COMPLETED',
      'PURCHASE_ORDER_UPDATED',
      'INVENTORY_LOT_UPDATED',
    ];

    for (const topic of EVENT_TOPICS) {
      bus.subscribe(topic, (payload) => {
        const org = payload?.organisationId;
        const cafe = payload?.cafeId;
        const item = payload?.itemId;

        if (org && cafe && item) {
          setImmediate(() => {
            this.evaluateItem({
              organisationId: org,
              cafeId: cafe,
              itemId: item,
              source: 'EVENT',
              actorId: `SYSTEM_EVENT:${topic}`,
            }).catch((err) => {
              console.warn(`[ReplenishmentRecommendationService] Event evaluation failed for ${item} on ${topic}:`, err.message);
            });
          });
        }
      });
    }
  }

  /**
   * Safely defers a replenishment recommendation with operational snapshotting (P07).
   */
  static async deferRecommendation({
    organisationId,
    cafeId,
    recommendationId,
    deferredUntil,
    deferReason = 'Deferred by café operations manager',
    auth,
  }) {
    if (!recommendationId || !deferredUntil) {
      throw new ApiError(400, 'VALIDATION_FAILED', 'recommendationId and deferredUntil are required.');
    }

    const rec = await ReplenishmentRecommendation.findOne({
      organisationId,
      cafeId,
      recommendationId,
    });

    if (!rec) {
      throw new ApiError(404, 'NOT_FOUND', `Recommendation ${recommendationId} not found.`);
    }

    const untilDate = new Date(deferredUntil);
    if (isNaN(untilDate.getTime()) || untilDate <= new Date()) {
      throw new ApiError(400, 'INVALID_DEFER_DATE', 'deferredUntil must be a valid future timestamp.');
    }

    rec.status = 'DEFERRED';
    rec.isActiveNeed = false;
    rec.activeNeedKey = null;
    rec.deferDetails = {
      deferredUntil: untilDate,
      deferredBy: auth?.userId || 'SYSTEM',
      deferredAt: new Date(),
      deferReason: String(deferReason).trim(),
      deferredSnapshot: {
        usableQuantityBase: rec.stockSnapshot?.usableQuantityBase || 0,
        eligibleInboundBase: rec.stockSnapshot?.eligibleInboundBase || 0,
        projectedStockoutDays: rec.explanation?.projectedStockoutDays || null,
        suggestedPurchaseQuantity: rec.calculation?.suggestedPurchaseQuantity || 0,
        status: rec.status,
      },
      overrideReason: null,
      overriddenAt: null,
    };

    if (!rec.revisionHistory) rec.revisionHistory = [];
    rec.revisionHistory.push({
      revisedAt: new Date(),
      reason: `Deferred until ${untilDate.toISOString()} by ${auth?.userId || 'SYSTEM'}. Reason: ${deferReason}`,
      previousQuantities: {
        rawNeedBase: rec.calculation?.rawNeedBase || 0,
        suggestedBaseQuantity: rec.calculation?.suggestedBaseQuantity || 0,
        suggestedPurchaseQuantity: rec.calculation?.suggestedPurchaseQuantity || 0,
      },
      fingerprint: rec.calculation?.calculationFingerprint || '',
      evaluatorActor: auth?.userId || 'SYSTEM',
    });

    await rec.save();
    return rec;
  }

  /**
   * Explicitly dismisses / rejects a replenishment recommendation with mandatory reason.
   */
  static async dismissRecommendation({
    organisationId,
    cafeId,
    recommendationId,
    reason,
    auth,
  }) {
    if (!recommendationId || !reason) {
      throw new ApiError(400, 'VALIDATION_FAILED', 'recommendationId and rejection reason are required.');
    }

    const rec = await ReplenishmentRecommendation.findOne({
      organisationId,
      cafeId,
      recommendationId,
    });

    if (!rec) {
      throw new ApiError(404, 'NOT_FOUND', `Recommendation ${recommendationId} not found.`);
    }

    rec.status = 'DISMISSED';
    rec.isActiveNeed = false;
    rec.activeNeedKey = null;

    if (!rec.revisionHistory) rec.revisionHistory = [];
    rec.revisionHistory.push({
      revisedAt: new Date(),
      reason: `Rejected / dismissed by ${auth?.userId || 'SYSTEM'}. Reason: ${reason}`,
      previousQuantities: {
        rawNeedBase: rec.calculation?.rawNeedBase || 0,
        suggestedBaseQuantity: rec.calculation?.suggestedBaseQuantity || 0,
        suggestedPurchaseQuantity: rec.calculation?.suggestedPurchaseQuantity || 0,
      },
      fingerprint: rec.calculation?.calculationFingerprint || '',
      evaluatorActor: auth?.userId || 'SYSTEM',
    });

    await rec.save();
    return rec;
  }
}

module.exports = {
  ReplenishmentRecommendationService,
  computeFingerprint,
};
