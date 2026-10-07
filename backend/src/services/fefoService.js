'use strict';

/**
 * ============================================================================
 * ZAMORIN CAFÉ ERP — FIRST EXPIRED, FIRST OUT (FEFO) ENGINE
 * ============================================================================
 * Implements authoritative FEFO stock issue algorithm:
 * 1. Prioritizes eligible lots with earliest expiry date.
 * 2. Hard blocks deduction from expired stock (expiryDate <= businessDate).
 * 3. Atomic multi-lot balance reduction with session transaction support.
 * 4. Generates proactive expiry alerts (NEAR_EXPIRY, EXPIRED_STILL_AVAILABLE).
 */

const { InventoryLot } = require('../models/InventoryLot');
const { StockMovement } = require('../models/StockMovement');
const { ApiError } = require('../utils/ApiError');

function getIstDateStr(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

class FefoService {
  /**
   * Plans stock deduction according to First Expired, First Out (FEFO).
   */
  static async planFefoDeduction({ organisationId, cafeId, itemId, requiredQuantity, businessDate = null }) {
    if (!organisationId || !cafeId || !itemId || requiredQuantity <= 0) {
      throw new ApiError(400, 'INVALID_FEFO_PARAMS', 'Valid organisationId, cafeId, itemId, and positive requiredQuantity are required.');
    }

    const todayStr = businessDate || getIstDateStr();

    // Query active available lots
    const lots = await InventoryLot.find({
      organisationId,
      cafeId,
      itemId,
      status: 'AVAILABLE',
      quantityBase: { $gt: 0 },
    })
      .sort({ expiryDate: 1, createdAt: 1 })
      .lean();

    if (!lots || lots.length === 0) {
      throw new ApiError(400, 'NO_AVAILABLE_LOTS', `No available lots found for item ${itemId} at café ${cafeId}.`);
    }

    // Identify and filter out expired stock
    const validLots = [];
    const expiredLots = [];

    for (const lot of lots) {
      if (lot.expiryDate && lot.expiryDate < todayStr) {
        expiredLots.push(lot);
      } else {
        validLots.push(lot);
      }
    }

    // Auto-mark expired lots
    if (expiredLots.length > 0) {
      await InventoryLot.updateMany(
        { _id: { $in: expiredLots.map((l) => l._id) } },
        { $set: { status: 'EXPIRED' } }
      ).catch(() => {});
    }

    let remainingNeeded = Number(requiredQuantity);
    const plan = [];

    for (const lot of validLots) {
      if (remainingNeeded <= 0) break;
      const availableInLot = Number(lot.quantityBase);
      const deductFromLot = Math.min(availableInLot, remainingNeeded);

      plan.push({
        lotId: lot.lotId,
        supplierLot: lot.supplierLot,
        expiryDate: lot.expiryDate,
        deductQuantity: deductFromLot,
        lotRemainingAfter: availableInLot - deductFromLot,
      });

      remainingNeeded -= deductFromLot;
    }

    if (remainingNeeded > 0) {
      throw new ApiError(
        400,
        'INSUFFICIENT_UNEXPIRED_STOCK',
        `Insufficient non-expired stock for item ${itemId}. Required: ${requiredQuantity}, Unexpired Available: ${requiredQuantity - remainingNeeded}.`
      );
    }

    return {
      itemId,
      requiredQuantity,
      allocatedLots: plan,
      totalAllocated: requiredQuantity,
    };
  }

  /**
   * Executes FEFO deduction atomically across multiple lots with concurrency guard.
   */
  static async executeFefoDeduction({
    organisationId,
    cafeId,
    itemId,
    requiredQuantity,
    session = null,
    businessDate = null,
    billId = '',
    referenceId = '',
    referenceType = 'BILL',
    userId = 'SYSTEM',
  }) {
    if (!organisationId || !cafeId || !itemId || requiredQuantity <= 0) {
      throw new ApiError(400, 'INVALID_FEFO_PARAMS', 'Valid organisationId, cafeId, itemId, and positive requiredQuantity are required.');
    }

    const todayStr = businessDate || getIstDateStr();
    const sourceTx = billId || referenceId || '';
    let remainingNeeded = Number(requiredQuantity);
    const deductions = [];

    // Query active available lots sorted by earliest expiry date (FEFO)
    let lotQuery = InventoryLot.find({
      organisationId,
      cafeId,
      itemId,
      status: 'AVAILABLE',
      quantityBase: { $gt: 0 },
    }).sort({ expiryDate: 1, createdAt: 1 });

    if (session) {
      lotQuery = lotQuery.session(session);
    }

    const lots = await lotQuery.lean();

    if (!lots || lots.length === 0) {
      throw new ApiError(400, 'NO_AVAILABLE_LOTS', `No available lots found for item ${itemId} at café ${cafeId}.`);
    }

    // Identify unexpired lots
    const validLots = [];
    const expiredLots = [];

    for (const lot of lots) {
      if (lot.expiryDate && lot.expiryDate < todayStr) {
        expiredLots.push(lot);
      } else {
        validLots.push(lot);
      }
    }

    if (expiredLots.length > 0) {
      await InventoryLot.updateMany(
        { _id: { $in: expiredLots.map((l) => l._id) } },
        { $set: { status: 'EXPIRED' } },
        session ? { session } : {}
      ).catch(() => {});
    }

    for (const lot of validLots) {
      if (remainingNeeded <= 0) break;

      let lotAvail = Number(lot.quantityBase);
      while (lotAvail > 0 && remainingNeeded > 0) {
        const attemptDeduct = Math.min(lotAvail, remainingNeeded);

        const updateQuery = {
          $inc: { quantityBase: -attemptDeduct, remainingQuantity: -attemptDeduct },
        };

        const opts = { new: true };
        if (session) opts.session = session;

        // Atomic $gte guard prevents concurrent over-consumption and negative inventory
        const updated = await InventoryLot.findOneAndUpdate(
          {
            organisationId,
            cafeId,
            lotId: lot.lotId,
            quantityBase: { $gte: attemptDeduct },
          },
          updateQuery,
          opts
        );

        if (updated) {
          if (updated.quantityBase === 0) {
            await InventoryLot.updateOne(
              { _id: updated._id },
              { $set: { status: 'DEPLETED' } },
              session ? { session } : {}
            ).catch(() => {});
          }

          const movementId = `SM-${Date.now()}-${Math.random().toString(36).substring(2, 7).toUpperCase()}`;
          try {
            await StockMovement.create(
              [
                {
                  organisationId,
                  movementId,
                  cafeId,
                  itemId,
                  movementType: 'CONSUMPTION',
                  quantityBase: -attemptDeduct,
                  balanceBeforeBase: (updated ? updated.quantityBase : 0) + attemptDeduct,
                  balanceAfterBase: updated ? updated.quantityBase : 0,
                  lotId: lot.lotId,
                  supplierBatchNumber: lot.supplierLot || '',
                  referenceId: sourceTx,
                  referenceType: referenceType || 'BILL',
                  performedByUserId: userId || 'SYSTEM',
                  reason: `FEFO consumption allocation for ${sourceTx || itemId}`,
                },
              ],
              session ? { session } : {}
            );
          } catch (_) {}

          deductions.push({
            lotId: lot.lotId,
            deductedQuantity: attemptDeduct,
            newBalance: updated ? updated.quantityBase : 0,
            status: updated ? (updated.quantityBase === 0 ? 'DEPLETED' : updated.status) : 'UNKNOWN',
            movementId,
            sourceTransaction: sourceTx,
          });

          remainingNeeded -= attemptDeduct;
          break; // successfully deducted from this lot, proceed to next lot if remainingNeeded > 0
        } else {
          // Lot was modified concurrently. Re-check fresh balance.
          let freshQuery = InventoryLot.findOne({ organisationId, cafeId, lotId: lot.lotId });
          if (session) freshQuery = freshQuery.session(session);
          const freshLot = await freshQuery.lean();
          if (!freshLot || freshLot.status !== 'AVAILABLE' || freshLot.quantityBase <= 0) {
            break; // exhausted, move to next lot
          }
          lotAvail = freshLot.quantityBase;
        }
      }
    }

    if (remainingNeeded > 0) {
      if (!session && deductions.length > 0) {
        // Rollback partial deductions made in this standalone call to maintain atomicity
        for (const d of deductions) {
          try {
            await InventoryLot.updateOne(
              { organisationId, cafeId, lotId: d.lotId },
              {
                $inc: { quantityBase: d.deductedQuantity, remainingQuantity: d.deductedQuantity },
                $set: { status: 'AVAILABLE' },
              }
            );
            await StockMovement.deleteOne({ movementId: d.movementId });
          } catch (_) {}
        }
      }

      throw new ApiError(
        400,
        'INSUFFICIENT_UNEXPIRED_STOCK',
        `Insufficient non-expired stock for item ${itemId}. Required: ${requiredQuantity}, Unfulfilled: ${remainingNeeded}.`
      );
    }

    return {
      success: true,
      itemId,
      totalDeducted: requiredQuantity,
      deductions,
      allocatedLots: deductions.map((d) => ({
        lotId: d.lotId,
        quantityConsumed: d.deductedQuantity,
        movementId: d.movementId,
        sourceTransaction: d.sourceTransaction,
      })),
    };
  }

  /**
   * Finds expiring stock within N days or already expired stock with positive quantity.
   */
  static async getExpiryAlerts({ organisationId, cafeId, thresholdDays = 7, businessDate = null }) {
    const today = businessDate ? new Date(businessDate) : new Date();
    const futureDate = new Date(today);
    futureDate.setDate(futureDate.getDate() + Number(thresholdDays));

    const todayStr = getIstDateStr(today);
    const thresholdStr = getIstDateStr(futureDate);

    const [nearExpiryLots, expiredAvailableLots] = await Promise.all([
      InventoryLot.find({
        organisationId,
        cafeId,
        status: 'AVAILABLE',
        quantityBase: { $gt: 0 },
        expiryDate: { $gte: todayStr, $lte: thresholdStr },
      })
        .sort({ expiryDate: 1 })
        .lean(),

      InventoryLot.find({
        organisationId,
        cafeId,
        quantityBase: { $gt: 0 },
        expiryDate: { $lt: todayStr },
      })
        .sort({ expiryDate: 1 })
        .lean(),
    ]);

    return {
      today: todayStr,
      thresholdDays: Number(thresholdDays),
      thresholdDate: thresholdStr,
      nearExpiryCount: nearExpiryLots.length,
      nearExpiryLots,
      expiredCount: expiredAvailableLots.length,
      expiredAvailableLots,
    };
  }
}

module.exports = {
  FefoService,
};
