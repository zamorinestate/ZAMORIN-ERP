'use strict';

/**
 * CUSTOMER LOYALTY SERVICE (P14 LOYALTY RULES & IMMUTABLE POINTS LEDGER)
 *
 * Implements:
 *   - Configured, versioned loyalty rules engine.
 *   - Idempotent sale rewards accrual.
 *   - Bill void reward reversal (reverses exactly once, never more than original award).
 *   - Deterministic refund reward reversal (never exceeds remaining original award; duplicate replay prevented).
 *   - Atomic redemption with concurrency protection (pointsBalance never negative; simultaneous spends guarded).
 *   - Blocked/expired loyalty status enforcement.
 */

const { Customer } = require('../models/Customer');
const { LoyaltyLedger } = require('../models/LoyaltyLedger');
const { LoyaltyProgramme } = require('../models/LoyaltyProgramme');
const { SequenceCounter } = require('../models/SequenceCounter');
const { ApiError } = require('../utils/ApiError');

/**
 * Retrieve active loyalty programme rules for an organization
 */
async function getEffectiveLoyaltyRules(organisationId) {
  const programme = await LoyaltyProgramme.findOne({
    organisationId,
    status: 'PUBLISHED',
  }).sort({ effectiveFrom: -1 }).lean();

  if (programme) {
    return {
      version: programme.programmeVersion || 'V1.0',
      spendToPointsRatio: programme.spendToPointsRatio || 0.1, // e.g. 1 point per 10 rupees
      tierRules: programme.tierRules || [
        { tier: 'BRONZE', minSpendPaisa: 0, earnMultiplier: 1.0 },
        { tier: 'SILVER', minSpendPaisa: 500000, earnMultiplier: 1.25 },
        { tier: 'GOLD', minSpendPaisa: 1500000, earnMultiplier: 1.5 },
        { tier: 'PLATINUM', minSpendPaisa: 2500000, earnMultiplier: 2.0 },
      ],
    };
  }

  return {
    version: 'V1.0-DEFAULT',
    spendToPointsRatio: 0.1,
    tierRules: [
      { tier: 'BRONZE', minSpendPaisa: 0, earnMultiplier: 1.0 },
      { tier: 'SILVER', minSpendPaisa: 500000, earnMultiplier: 1.25 },
      { tier: 'GOLD', minSpendPaisa: 1500000, earnMultiplier: 1.5 },
      { tier: 'PLATINUM', minSpendPaisa: 2500000, earnMultiplier: 2.0 },
    ],
  };
}

/**
 * Accrue loyalty points for an eligible completed sale
 */
async function accrueSaleRewards({
  organisationId,
  customerId,
  billId,
  eligibleAmountRupees,
  billAmountPaise = 0,
  performedByUserId = 'SYSTEM',
  idempotencyKey = null,
}) {
  if (!organisationId || !customerId || !billId) {
    throw new ApiError(400, 'INVALID_ACCRUAL_PARAMETERS', 'Organisation, customer ID, and bill ID are required.');
  }

  const effectiveIdempotencyKey = idempotencyKey || `SALE_ACCRUAL:${billId}`;

  // Check if points already accrued for this bill or idempotency key
  const existingAccrual = await LoyaltyLedger.findOne({
    organisationId,
    $or: [
      { idempotencyKey: effectiveIdempotencyKey },
      { referenceBillId: billId, transactionType: 'PURCHASE_ACCRUAL' },
    ],
  }).lean();

  if (existingAccrual) {
    return {
      success: true,
      alreadyAccrued: true,
      pointsAccrued: existingAccrual.pointsDelta,
      ledger: existingAccrual,
    };
  }

  const customer = await Customer.findOne({ customerId, organisationId });
  if (!customer) {
    throw new ApiError(404, 'CUSTOMER_NOT_FOUND', `Customer ${customerId} not found.`);
  }

  if (customer.status !== 'ACTIVE' || customer.loyaltyStatus !== 'ACTIVE') {
    throw new ApiError(400, 'LOYALTY_ACCOUNT_INACTIVE', 'Customer account is not active for loyalty accrual.');
  }

  const rules = await getEffectiveLoyaltyRules(organisationId);
  const tierConfig = rules.tierRules.find((t) => t.tier === customer.tier) || { earnMultiplier: 1.0 };
  const basePoints = Math.floor((Number(eligibleAmountRupees) || 0) * rules.spendToPointsRatio);
  const pointsToAccrue = Math.max(0, Math.floor(basePoints * (tierConfig.earnMultiplier || 1.0)));

  if (pointsToAccrue <= 0) {
    return { success: true, pointsAccrued: 0, message: 'No points earned for this transaction.' };
  }

  const prevBalance = customer.pointsBalance || 0;
  const newBalance = prevBalance + pointsToAccrue;

  customer.pointsBalance = newBalance;
  customer.totalSpendPaisa = (customer.totalSpendPaisa || 0) + (billAmountPaise || Math.round((eligibleAmountRupees || 0) * 100));
  customer.totalVisits = (customer.totalVisits || 0) + 1;
  customer.lastVisitAt = new Date();
  await customer.save();

  const loySeq = await SequenceCounter.generateId({
    organisationId,
    sequenceKey: 'LOYALTY_LEDGER_SEQ',
    prefix: 'LOY',
    minimumDigits: 4,
  });

  const ledgerEntry = new LoyaltyLedger({
    loyaltyLedgerId: loySeq,
    organisationId,
    customerId,
    transactionType: 'PURCHASE_ACCRUAL',
    pointsDelta: pointsToAccrue,
    balanceBefore: prevBalance,
    balanceAfter: newBalance,
    referenceBillId: billId,
    idempotencyKey: effectiveIdempotencyKey,
    description: `Points accrued for bill ${billId} under ${rules.version}`,
    performedByUserId,
    serverTimestamp: new Date(),
  });

  await ledgerEntry.save();

  return {
    success: true,
    pointsAccrued: pointsToAccrue,
    newBalance,
    ledger: ledgerEntry.toObject(),
  };
}

/**
 * Reverse loyalty points when a bill is voided
 */
async function reverseSaleRewardsOnVoid({
  organisationId,
  customerId,
  billId,
  performedByUserId = 'SYSTEM',
  reason = 'BILL_VOIDED',
  idempotencyKey = null,
}) {
  if (!organisationId || !customerId || !billId) {
    throw new ApiError(400, 'INVALID_VOID_REVERSAL_PARAMETERS', 'Organisation, customer ID, and bill ID are required.');
  }

  const effectiveIdempotencyKey = idempotencyKey || `VOID_REVERSAL:${billId}`;

  // Check if void reversal already processed
  const existingReversal = await LoyaltyLedger.findOne({
    organisationId,
    $or: [
      { idempotencyKey: effectiveIdempotencyKey },
      { referenceBillId: billId, transactionType: 'VOID_REVERSAL' },
    ],
  }).lean();

  if (existingReversal) {
    return {
      success: true,
      alreadyReversed: true,
      pointsReversed: Math.abs(existingReversal.pointsDelta),
      ledger: existingReversal,
    };
  }

  // Find original accrual
  const originalAccruals = await LoyaltyLedger.find({
    organisationId,
    customerId,
    referenceBillId: billId,
    transactionType: 'PURCHASE_ACCRUAL',
  }).lean();

  const totalOriginalPoints = originalAccruals.reduce((sum, a) => sum + (a.pointsDelta || 0), 0);
  if (totalOriginalPoints <= 0) {
    return { success: true, pointsReversed: 0, message: 'No points were originally accrued for this bill.' };
  }

  // Check previous refund reversals
  const existingRefundReversals = await LoyaltyLedger.find({
    organisationId,
    customerId,
    referenceBillId: billId,
    transactionType: 'REFUND_REVERSAL',
  }).lean();

  const alreadyReversed = existingRefundReversals.reduce((sum, r) => sum + Math.abs(r.pointsDelta || 0), 0);
  const remainingAward = Math.max(0, totalOriginalPoints - alreadyReversed);

  if (remainingAward <= 0) {
    return { success: true, pointsReversed: 0, message: 'Original points already fully reversed by prior refunds.' };
  }

  const customer = await Customer.findOne({ customerId, organisationId });
  if (!customer) {
    throw new ApiError(404, 'CUSTOMER_NOT_FOUND', `Customer ${customerId} not found.`);
  }

  const prevBalance = customer.pointsBalance || 0;
  const newBalance = Math.max(0, prevBalance - remainingAward);

  customer.pointsBalance = newBalance;
  await customer.save();

  const loySeq = await SequenceCounter.generateId({
    organisationId,
    sequenceKey: 'LOYALTY_LEDGER_SEQ',
    prefix: 'LOY',
    minimumDigits: 4,
  });

  const ledgerEntry = new LoyaltyLedger({
    loyaltyLedgerId: loySeq,
    organisationId,
    customerId,
    transactionType: 'VOID_REVERSAL',
    pointsDelta: -remainingAward,
    balanceBefore: prevBalance,
    balanceAfter: newBalance,
    referenceBillId: billId,
    reasonCode: reason,
    idempotencyKey: effectiveIdempotencyKey,
    description: `Full reward reversal for voided bill ${billId}`,
    performedByUserId,
    serverTimestamp: new Date(),
  });

  await ledgerEntry.save();

  return {
    success: true,
    pointsReversed: remainingAward,
    newBalance,
    ledger: ledgerEntry.toObject(),
  };
}

/**
 * Reverse loyalty points on item/bill refund
 */
async function reverseRewardsOnRefund({
  organisationId,
  customerId,
  billId,
  refundId,
  refundAmountRupees,
  totalBillAmountRupees,
  performedByUserId = 'SYSTEM',
  reason = 'CUSTOMER_REFUND',
  idempotencyKey = null,
}) {
  if (!organisationId || !customerId || !billId || !refundId) {
    throw new ApiError(400, 'INVALID_REFUND_REVERSAL_PARAMETERS', 'Organisation, customer, bill, and refund IDs are required.');
  }

  const effectiveIdempotencyKey = idempotencyKey || `REFUND_REVERSAL:${refundId}`;

  // Check if this refund already reversed points
  const existingRefund = await LoyaltyLedger.findOne({
    organisationId,
    $or: [
      { idempotencyKey: effectiveIdempotencyKey },
      { referenceRefundId: refundId, transactionType: 'REFUND_REVERSAL' },
    ],
  }).lean();

  if (existingRefund) {
    return {
      success: true,
      alreadyReversed: true,
      pointsReversed: Math.abs(existingRefund.pointsDelta),
      ledger: existingRefund,
    };
  }

  // Calculate remaining unreversed points for this bill
  const originalAccruals = await LoyaltyLedger.find({
    organisationId,
    customerId,
    referenceBillId: billId,
    transactionType: 'PURCHASE_ACCRUAL',
  }).lean();

  const totalOriginalPoints = originalAccruals.reduce((sum, a) => sum + (a.pointsDelta || 0), 0);
  if (totalOriginalPoints <= 0) {
    return { success: true, pointsReversed: 0, message: 'No points were accrued on this bill.' };
  }

  const priorReversals = await LoyaltyLedger.find({
    organisationId,
    customerId,
    referenceBillId: billId,
    transactionType: { $in: ['REFUND_REVERSAL', 'VOID_REVERSAL'] },
  }).lean();

  const alreadyReversed = priorReversals.reduce((sum, r) => sum + Math.abs(r.pointsDelta || 0), 0);
  const remainingAward = Math.max(0, totalOriginalPoints - alreadyReversed);

  if (remainingAward <= 0) {
    return { success: true, pointsReversed: 0, message: 'Award already fully reversed.' };
  }

  // Proportional reversal
  const ratio = (totalBillAmountRupees > 0) ? Math.min(1.0, refundAmountRupees / totalBillAmountRupees) : 1.0;
  const calculatedPoints = Math.round(totalOriginalPoints * ratio);
  const pointsToReverse = Math.min(calculatedPoints, remainingAward);

  if (pointsToReverse <= 0) {
    return { success: true, pointsReversed: 0, message: 'Zero points calculated for refund reversal.' };
  }

  const customer = await Customer.findOne({ customerId, organisationId });
  if (!customer) {
    throw new ApiError(404, 'CUSTOMER_NOT_FOUND', `Customer ${customerId} not found.`);
  }

  const prevBalance = customer.pointsBalance || 0;
  const newBalance = Math.max(0, prevBalance - pointsToReverse);

  customer.pointsBalance = newBalance;
  await customer.save();

  const loySeq = await SequenceCounter.generateId({
    organisationId,
    sequenceKey: 'LOYALTY_LEDGER_SEQ',
    prefix: 'LOY',
    minimumDigits: 4,
  });

  const ledgerEntry = new LoyaltyLedger({
    loyaltyLedgerId: loySeq,
    organisationId,
    customerId,
    transactionType: 'REFUND_REVERSAL',
    pointsDelta: -pointsToReverse,
    balanceBefore: prevBalance,
    balanceAfter: newBalance,
    referenceBillId: billId,
    referenceRefundId: refundId,
    reasonCode: reason,
    idempotencyKey: effectiveIdempotencyKey,
    description: `Proportional points reversal for refund ${refundId}`,
    performedByUserId,
    serverTimestamp: new Date(),
  });

  await ledgerEntry.save();

  return {
    success: true,
    pointsReversed: pointsToReverse,
    newBalance,
    ledger: ledgerEntry.toObject(),
  };
}

/**
 * Redeem loyalty points atomically with strict concurrency protection
 */
async function redeemPointsAtomic({
  organisationId,
  customerId,
  pointsToRedeem,
  billId = null,
  rewardId = null,
  performedByUserId = 'SYSTEM',
  idempotencyKey = null,
}) {
  const points = Math.round(Number(pointsToRedeem));
  if (!points || points <= 0) {
    throw new ApiError(400, 'INVALID_REDEMPTION_AMOUNT', 'Points to redeem must be a positive integer.');
  }

  if (idempotencyKey) {
    const existing = await LoyaltyLedger.findOne({
      organisationId,
      idempotencyKey,
      transactionType: 'REWARD_REDEEMED',
    }).lean();

    if (existing) {
      return {
        success: true,
        alreadyProcessed: true,
        pointsRedeemed: Math.abs(existing.pointsDelta),
        ledger: existing,
      };
    }
  }

  // Atomic deduction with balance condition to prevent negative balance and double-spend concurrency
  const updatedCustomer = await Customer.findOneAndUpdate(
    {
      customerId,
      organisationId,
      status: 'ACTIVE',
      loyaltyStatus: 'ACTIVE',
      pointsBalance: { $gte: points },
    },
    {
      $inc: { pointsBalance: -points },
    },
    {
      returnDocument: 'after',
    }
  );

  if (!updatedCustomer) {
    // Determine specific reason for failure
    const checkCust = await Customer.findOne({ customerId, organisationId }).lean();
    if (!checkCust) {
      throw new ApiError(404, 'CUSTOMER_NOT_FOUND', `Customer ${customerId} not found.`);
    }
    if (checkCust.status !== 'ACTIVE' || checkCust.loyaltyStatus !== 'ACTIVE') {
      throw new ApiError(400, 'LOYALTY_ACCOUNT_SUSPENDED', 'Customer loyalty account is suspended or expired.');
    }
    throw new ApiError(
      400,
      'INSUFFICIENT_LOYALTY_POINTS',
      `Insufficient loyalty points. Requested: ${points}, Available: ${checkCust.pointsBalance || 0}.`
    );
  }

  const prevBalance = (updatedCustomer.pointsBalance || 0) + points;
  const newBalance = updatedCustomer.pointsBalance || 0;

  const loySeq = await SequenceCounter.generateId({
    organisationId,
    sequenceKey: 'LOYALTY_LEDGER_SEQ',
    prefix: 'LOY',
    minimumDigits: 4,
  });

  const ledgerEntry = new LoyaltyLedger({
    loyaltyLedgerId: loySeq,
    organisationId,
    customerId,
    transactionType: 'REWARD_REDEEMED',
    pointsDelta: -points,
    balanceBefore: prevBalance,
    balanceAfter: newBalance,
    referenceBillId: billId,
    referenceRewardId: rewardId,
    idempotencyKey,
    description: `Redeemed ${points} points for reward/bill ${billId || rewardId || 'POS'}`,
    performedByUserId,
    serverTimestamp: new Date(),
  });

  await ledgerEntry.save();

  return {
    success: true,
    pointsRedeemed: points,
    newBalance,
    ledger: ledgerEntry.toObject(),
  };
}

module.exports = {
  getEffectiveLoyaltyRules,
  accrueSaleRewards,
  reverseSaleRewardsOnVoid,
  reverseRewardsOnRefund,
  redeemPointsAtomic,
};
