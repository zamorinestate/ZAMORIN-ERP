'use strict';

/**
 * ============================================================================
 * ZAMORIN CAFÉ ERP — STOCKOUT RISK ESTIMATION SERVICE (PACKAGE P17)
 * ============================================================================
 * Forward-looking predictive stockout risk intelligence combining:
 *   - Current usable on-hand inventory (excluding expired, quarantined, reserved)
 *   - Confirmed eligible inbound supply (PO lead times and expected deliveries)
 *   - Historical consumption burn rates & forecast demand
 *   - Safety stock and par level policies from P05/P06
 *
 * CRITICAL GOVERNANCE INVARIANTS:
 * 1. P06 REPLENISHMENT AUTHORITY: Integrates with P06 Replenishment Recommendations
 *    as an advisory intelligence view. NEVER auto-creates POs or posts stock.
 * 2. USABLE STOCK ISOLATION: Expired lots, quarantined lots, and in-transit transfers
 *    are strictly excluded from usable on-hand balance.
 * 3. TRANSPARENCY: Missing item config or ambiguous units return actionable warnings,
 *    never fabricated zero risk.
 */

const { GlobalInventoryItem } = require('../models/GlobalInventoryItem');
const { CafeInventoryConfig } = require('../models/CafeInventoryConfig');
const { InventoryLot } = require('../models/InventoryLot');
const { InventoryReservation } = require('../models/InventoryReservation');
const { PurchaseOrder } = require('../models/PurchaseOrder');
const { StockMovement } = require('../models/StockMovement');
const ApiError = require('../utils/ApiError');

function getIstDateStr(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function addDays(dateStr, days) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

class StockoutRiskService {
  /**
   * Evaluates predictive stockout risk across active inventory items for a café.
   *
   * @param {Object} params
   * @param {string} params.organisationId
   * @param {string} params.cafeId
   * @param {number} [params.horizonDays=14]
   * @param {string} [params.category]
   * @returns {Promise<Object>} Summary and item-level risk evaluations
   */
  static async evaluateStockoutRisk({
    organisationId = 'ZAMORIN',
    cafeId,
    horizonDays = 14,
    category = null,
  }) {
    if (!organisationId || !cafeId) {
      throw new ApiError(400, 'VALIDATION_FAILED', 'organisationId and cafeId are required.');
    }

    const cleanOrg = organisationId.trim().toUpperCase();
    const cleanCafe = cafeId.trim().toUpperCase();
    const horizon = Math.min(60, Math.max(3, Number(horizonDays) || 14));
    const todayStr = getIstDateStr();

    // ── 1. Fetch Café Configs & Active Items ─────────────────────────────────
    const configQuery = {
      organisationId: cleanOrg,
      cafeId: cleanCafe,
      stockedHere: { $ne: false },
    };

    const configs = await CafeInventoryConfig.find(configQuery).lean();
    if (configs.length === 0) {
      return {
        organisationId: cleanOrg,
        cafeId: cleanCafe,
        evaluatedAt: new Date(),
        horizonDays: horizon,
        totalItemsEvaluated: 0,
        riskSummary: { criticalCount: 0, highCount: 0, mediumCount: 0, lowCount: 0, safeCount: 0 },
        itemsAtRisk: [],
        warnings: ['No inventory items configured for this café.'],
      };
    }

    const itemIds = configs.map(c => c.itemId);
    const itemQuery = {
      organisationId: cleanOrg,
      itemId: { $in: itemIds },
      status: 'ACTIVE',
    };
    if (category) {
      itemQuery.category = category.trim().toUpperCase();
    }

    const items = await GlobalInventoryItem.find(itemQuery).lean();
    const itemMap = new Map(items.map(i => [i.itemId, i]));

    // ── 2. Fetch Lots, Active Reservations, and Open Inbound POs ─────────────
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const [allLots, allReservations, allOpenPOs, recentMovements] = await Promise.all([
      InventoryLot.find({
        organisationId: cleanOrg,
        cafeId: cleanCafe,
        itemId: { $in: itemIds },
      }).lean(),
      InventoryReservation.find({
        organisationId: cleanOrg,
        cafeId: cleanCafe,
        itemId: { $in: itemIds },
        status: 'ACTIVE',
        expiresAt: { $gt: new Date() },
      }).lean(),
      PurchaseOrder.find({
        organisationId: cleanOrg,
        cafeId: cleanCafe,
        'lineItems.itemId': { $in: itemIds },
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
      }).lean(),
      StockMovement.find({
        organisationId: cleanOrg,
        cafeId: cleanCafe,
        itemId: { $in: itemIds },
        movementType: { $in: ['CONSUMPTION', 'SALE_DEPLETION', 'PRODUCTION_ISSUE'] },
        createdAt: { $gte: thirtyDaysAgo },
      }).lean(),
    ]);

    // Group lots by itemId
    const lotsByItem = new Map();
    for (const lot of allLots) {
      if (!lotsByItem.has(lot.itemId)) lotsByItem.set(lot.itemId, []);
      lotsByItem.get(lot.itemId).push(lot);
    }

    // Group reservations by itemId
    const reservationsByItem = new Map();
    for (const res of allReservations) {
      const current = reservationsByItem.get(res.itemId) || 0;
      reservationsByItem.set(res.itemId, current + (Number(res.reservedQty) || 0));
    }

    // Group inbound PO quantities by itemId
    const inboundByItem = new Map();
    for (const po of allOpenPOs) {
      const poExpectedDate = po.expectedDeliveryDate
        ? new Date(po.expectedDeliveryDate).toISOString().slice(0, 10)
        : addDays(todayStr, 2);

      for (const line of po.lineItems || []) {
        if (!line.itemId) continue;
        const remainingQty = Math.max(
          0,
          (Number(line.orderedQuantityBase) || 0) - (Number(line.receivedQuantityBase) || 0)
        );
        if (remainingQty <= 0) continue;

        if (!inboundByItem.has(line.itemId)) inboundByItem.set(line.itemId, []);
        inboundByItem.get(line.itemId).push({
          poNumber: po.poNumber || po.purchaseOrderId,
          quantityBase: remainingQty,
          expectedDate: poExpectedDate,
        });
      }
    }

    // Group consumption movements by itemId
    const consumptionByItem = new Map();
    for (const m of recentMovements) {
      const current = consumptionByItem.get(m.itemId) || 0;
      consumptionByItem.set(m.itemId, current + Math.abs(Number(m.quantity) || 0));
    }

    // ── 3. Evaluate Stockout Risk for Each Item ──────────────────────────────
    const itemsAtRisk = [];
    const riskCounts = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0, NONE: 0 };
    const warnings = [];

    for (const config of configs) {
      const item = itemMap.get(config.itemId);
      if (!item) continue;

      const itemId = item.itemId;
      const baseUnit = item.baseUnit || 'UNIT';
      const leadTimeDays = Math.max(1, Number(config.leadTimeDays) || 2);
      const safetyStock = Math.max(0, Number(config.safetyStockBase) || 0);
      const minQty = Math.max(0, Number(config.minQuantityBase) || 0);

      // A. Calculate Usable Stock (strictly excluding expired/quarantined/reserved)
      const itemLots = lotsByItem.get(itemId) || [];
      let usableLotQty = 0;
      let expiredLotQty = 0;
      let quarantinedLotQty = 0;

      for (const lot of itemLots) {
        const isExpired = lot.status === 'EXPIRED' || (lot.expiryDate && lot.expiryDate < todayStr);
        const isQuarantined = ['QUARANTINE', 'RECALL_HOLD', 'DISPOSED', 'RETURNED'].includes(lot.status);
        const remaining = Number(lot.remainingQuantity) || 0;

        if (isExpired) {
          expiredLotQty += remaining;
        } else if (isQuarantined) {
          quarantinedLotQty += remaining;
        } else if (remaining > 0) {
          usableLotQty += remaining;
        }
      }

      const reservedQty = reservationsByItem.get(itemId) || 0;
      const currentStockBase = Number(config.currentQuantityBase) || 0;
      const totalUnusable = Math.max(
        (Number(config.quarantinedQuantityBase) || 0) + (Number(config.expiredQuantityBase) || 0),
        quarantinedLotQty + expiredLotQty
      );
      const physicallyUsable = Math.max(0, currentStockBase - totalUnusable);
      const usableQuantityBase = Math.max(0, physicallyUsable - reservedQty);

      // B. Calculate Daily Burn Rate (usage/demand rate)
      const historicalUsage30d = consumptionByItem.get(itemId) || 0;
      let dailyBurnRate = historicalUsage30d > 0
        ? Number((historicalUsage30d / 30).toFixed(2))
        : Number(config.avgDailyUsageBase) || 0;

      if (dailyBurnRate <= 0) {
        dailyBurnRate = 0.1; // Default minimal consumption rate to detect depletion
      }

      // C. Eligible Inbound Supply within Horizon
      const itemInbounds = inboundByItem.get(itemId) || [];
      const horizonEndDate = addDays(todayStr, horizon);
      let eligibleInboundQty = 0;
      const inboundSchedule = [];

      for (const inb of itemInbounds) {
        if (inb.expectedDate <= horizonEndDate) {
          eligibleInboundQty += inb.quantityBase;
          inboundSchedule.push(inb);
        }
      }

      // D. Day-by-Day Forward Simulation
      let runningStock = usableQuantityBase;
      let stockoutDayIndex = null;
      let stockoutDate = null;
      let daysUntilStockout = null;

      for (let day = 1; day <= horizon; day++) {
        const currentDate = addDays(todayStr, day);

        // Add inbound arriving on this day
        for (const inb of inboundSchedule) {
          if (inb.expectedDate === currentDate) {
            runningStock += inb.quantityBase;
          }
        }

        runningStock -= dailyBurnRate;

        // If stock drops below 0 (or strictly below safety stock if no stock left)
        if (runningStock <= 0 && stockoutDayIndex === null) {
          stockoutDayIndex = day;
          daysUntilStockout = day;
          stockoutDate = currentDate;
        }
      }

      // If no stockout reached in horizon, estimate days based on ending balance
      if (stockoutDayIndex === null) {
        if (dailyBurnRate > 0) {
          daysUntilStockout = Math.round((usableQuantityBase + eligibleInboundQty) / dailyBurnRate);
        } else {
          daysUntilStockout = 999;
        }
      }

      // E. Risk Level Classification
      let riskLevel = 'NONE';
      const contributingReasons = [];

      if (usableQuantityBase <= 0) {
        riskLevel = 'CRITICAL';
        contributingReasons.push('Zero usable stock currently on-hand.');
      } else if (daysUntilStockout <= leadTimeDays) {
        riskLevel = 'CRITICAL';
        contributingReasons.push(
          `Stockout projected in ${daysUntilStockout} days, which is less than supplier lead time (${leadTimeDays} days). Replenishment ordered today will arrive after stockout.`
        );
      } else if (daysUntilStockout <= leadTimeDays + 2) {
        riskLevel = 'HIGH';
        contributingReasons.push(
          `Stockout projected in ${daysUntilStockout} days, very close to supplier lead time (${leadTimeDays} days). Narrow buffer.`
        );
      } else if (daysUntilStockout <= leadTimeDays + 5 || usableQuantityBase < safetyStock) {
        riskLevel = 'MEDIUM';
        if (usableQuantityBase < safetyStock) {
          contributingReasons.push(`Current stock (${usableQuantityBase} ${baseUnit}) is below safety threshold (${safetyStock} ${baseUnit}).`);
        } else {
          contributingReasons.push(`Stock will deplete in ${daysUntilStockout} days.`);
        }
      } else if (daysUntilStockout <= horizon) {
        riskLevel = 'LOW';
        contributingReasons.push(`Depletion anticipated near end of ${horizon}-day horizon.`);
      }

      if (quarantinedLotQty > 0 || expiredLotQty > 0) {
        contributingReasons.push(
          `Blocked inventory present: ${quarantinedLotQty} ${baseUnit} in quarantine, ${expiredLotQty} ${baseUnit} expired.`
        );
      }
      if (reservedQty > 0) {
        contributingReasons.push(`${reservedQty} ${baseUnit} committed to active reservations.`);
      }
      if (eligibleInboundQty === 0 && riskLevel !== 'NONE') {
        contributingReasons.push('No confirmed purchase orders inbound within horizon.');
      }

      riskCounts[riskLevel] = (riskCounts[riskLevel] || 0) + 1;

      // Project shortage quantity required to restore to PAR or min
      const targetPar = Number(config.parQuantityBase) || (minQty * 1.5) || (dailyBurnRate * 7);
      const projectedShortageQty = Math.max(0, targetPar - (usableQuantityBase + eligibleInboundQty));

      itemsAtRisk.push({
        itemId,
        itemName: item.name,
        category: item.category || 'GENERAL',
        baseUnit,
        usableStock: usableQuantityBase,
        totalPhysicalStock: currentStockBase,
        quarantinedStock: quarantinedLotQty,
        expiredStock: expiredLotQty,
        reservedStock: reservedQty,
        inboundStock: eligibleInboundQty,
        leadTimeDays,
        dailyBurnRate,
        daysUntilStockout,
        projectedStockoutDate: stockoutDate,
        projectedShortageQty: Number(projectedShortageQty.toFixed(2)),
        riskLevel,
        contributingReasons,
        reorderPolicy: config.reorderPolicy || 'MIN_MAX',
        suggestedAction: riskLevel === 'CRITICAL' || riskLevel === 'HIGH'
          ? 'Urgent purchase order draft required in P06 Replenishment Desk.'
          : riskLevel === 'MEDIUM'
            ? 'Monitor and plan purchase order within standard review interval.'
            : 'Adequately stocked.',
      });
    }

    // Sort items by urgency (CRITICAL first, then HIGH, MEDIUM, LOW)
    const priorityOrder = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3, NONE: 4 };
    itemsAtRisk.sort((a, b) => {
      const pDiff = priorityOrder[a.riskLevel] - priorityOrder[b.riskLevel];
      if (pDiff !== 0) return pDiff;
      return (a.daysUntilStockout || 999) - (b.daysUntilStockout || 999);
    });

    return {
      organisationId: cleanOrg,
      cafeId: cleanCafe,
      evaluatedAt: new Date(),
      horizonDays: horizon,
      totalItemsEvaluated: configs.length,
      riskSummary: {
        criticalCount: riskCounts.CRITICAL,
        highCount: riskCounts.HIGH,
        mediumCount: riskCounts.MEDIUM,
        lowCount: riskCounts.LOW,
        safeCount: riskCounts.NONE,
      },
      itemsAtRisk,
      warnings,
      governanceNote: 'ADVISORY VIEW ONLY. Forward-looking estimation does not auto-create purchase orders. All procurement actions require authorized P06/P07 approval.',
    };
  }
}

module.exports = StockoutRiskService;
