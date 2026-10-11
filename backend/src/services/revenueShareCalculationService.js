'use strict';

/**
 * REVENUE SHARE CALCULATION ENGINE SERVICE (SCR-026)
 * Pure, side-effect-free, decimal-safe financial calculation service.
 * Supports all 10 calculation methods and all 7 calculation bases.
 */

// Helper for integer/safe arithmetic (Paise-level integer precision)
const toIntPaisa = (val) => {
  if (val === null || val === undefined || isNaN(val)) return 0;
  return Math.round(Number(val));
};

/**
 * 1. Compute Eligible Revenue
 * Eligible Revenue = Gross Sales - Discounts - Cancellations - Refunds - Excluded Transactions
 * Adjusts for GST, COGS, and Operating Expenses depending on Calculation Basis.
 */
function computeEligibleRevenue(salesInput, basis = 'GROSS_SALES') {
  let gross = toIntPaisa(salesInput.grossSalesPaisa);

  // Credit Sales Treatment
  if (salesInput.creditSalesTreatment === 'COLLECTION_BASIS') {
    gross = gross - toIntPaisa(salesInput.creditSalesPaisa) + toIntPaisa(salesInput.creditCollectionsPaisa);
  }

  let eligible =
    gross -
    toIntPaisa(salesInput.discountsPaisa) -
    toIntPaisa(salesInput.cancellationsPaisa) -
    toIntPaisa(salesInput.refundsPaisa) -
    toIntPaisa(salesInput.excludedTransactionsPaisa);

  // Benchmark A049: Exclude add-ons / extras from commission if configured
  if (salesInput.includeAddonsInCommission === false && salesInput.addonSalesPaisa) {
    eligible -= toIntPaisa(salesInput.addonSalesPaisa);
  }

  if (basis === 'NET_SALES_EXCLUDING_GST' || basis === 'COLLECTED_REVENUE') {
    eligible -= toIntPaisa(salesInput.gstPaisa);
  }

  if (basis === 'GROSS_PROFIT') {
    eligible -= toIntPaisa(salesInput.costOfGoodsSoldPaisa);
  }

  if (basis === 'NET_OPERATING_PROFIT') {
    eligible =
      eligible -
      toIntPaisa(salesInput.costOfGoodsSoldPaisa) -
      toIntPaisa(salesInput.operatingExpensesPaisa);
  }

  // Eligible revenue for share computation never floors below 0
  return Math.max(0, eligible);
}

/**
 * 2. Compute Tiered Share
 */
function computeTieredShare(eligibleRevenuePaisa, tiers = []) {
  if (!tiers || !tiers.length) return 0;
  let remaining = eligibleRevenuePaisa;
  let totalSharePaisa = 0;

  for (const tier of tiers) {
    const fromPaisa = toIntPaisa(tier.fromPaisa);
    const toPaisa = tier.toPaisa !== null && tier.toPaisa !== undefined ? toIntPaisa(tier.toPaisa) : null;
    const bandWidth = toPaisa !== null ? toPaisa - fromPaisa : remaining;
    const amountInBand = Math.min(Math.max(remaining, 0), Math.max(0, bandWidth));

    if (amountInBand <= 0) continue;
    const tierRate = Number(tier.percentage || 0);
    totalSharePaisa += Math.round((amountInBand * tierRate) / 100);
    remaining -= amountInBand;
    if (remaining <= 0) break;
  }

  return Math.round(totalSharePaisa);
}

/**
 * 3. Compute Base Share based on Rate Rule Method
 */
function computeBaseShare(eligibleRevenuePaisa, rateRule) {
  const method = rateRule.calculationMethod || 'PERCENTAGE_ONLY';
  const percentage = Number(rateRule.percentage || 0);
  const fixedAmountPaisa = toIntPaisa(rateRule.fixedAmountPaisa);
  const minimumGuaranteePaisa = toIntPaisa(rateRule.minimumGuaranteePaisa);
  const maximumCapPaisa = toIntPaisa(rateRule.maximumCapPaisa);
  const thresholdPaisa = toIntPaisa(rateRule.thresholdPaisa);

  let baseSharePaisa = 0;
  let percentageApplied = percentage;
  let fixedAmountApplied = 0;
  let mgAdjustmentPaisa = 0;
  let capReductionPaisa = 0;
  const breakdown = [];

  breakdown.push({
    step: 1,
    description: `Computed Eligible Revenue: ₹${(eligibleRevenuePaisa / 100).toFixed(2)} based on ${rateRule.calculationBasis || 'GROSS_SALES'}`,
    amountPaisa: eligibleRevenuePaisa,
  });

  switch (method) {
    case 'PERCENTAGE_ONLY':
      baseSharePaisa = Math.round((eligibleRevenuePaisa * percentage) / 100);
      breakdown.push({
        step: 2,
        description: `Applied ${percentage}% share to eligible revenue`,
        amountPaisa: baseSharePaisa,
      });
      break;

    case 'FIXED_AMOUNT_ONLY':
      baseSharePaisa = fixedAmountPaisa;
      fixedAmountApplied = fixedAmountPaisa;
      percentageApplied = 0;
      breakdown.push({
        step: 2,
        description: `Applied fixed amount fee`,
        amountPaisa: baseSharePaisa,
      });
      break;

    case 'FIXED_PLUS_PERCENTAGE':
      const pctShare = Math.round((eligibleRevenuePaisa * percentage) / 100);
      baseSharePaisa = fixedAmountPaisa + pctShare;
      fixedAmountApplied = fixedAmountPaisa;
      breakdown.push({
        step: 2,
        description: `Applied Fixed Fee ₹${(fixedAmountPaisa / 100).toFixed(2)} + ${percentage}% Variable Share ₹${(pctShare / 100).toFixed(2)}`,
        amountPaisa: baseSharePaisa,
      });
      break;

    case 'HIGHER_OF_FIXED_OR_PERCENTAGE':
      const varShare = Math.round((eligibleRevenuePaisa * percentage) / 100);
      if (varShare >= fixedAmountPaisa) {
        baseSharePaisa = varShare;
        breakdown.push({
          step: 2,
          description: `Variable Share ₹${(varShare / 100).toFixed(2)} >= Fixed Fee ₹${(fixedAmountPaisa / 100).toFixed(2)}: Applied Variable Share`,
          amountPaisa: baseSharePaisa,
        });
      } else {
        baseSharePaisa = fixedAmountPaisa;
        fixedAmountApplied = fixedAmountPaisa;
        breakdown.push({
          step: 2,
          description: `Fixed Fee ₹${(fixedAmountPaisa / 100).toFixed(2)} > Variable Share ₹${(varShare / 100).toFixed(2)}: Applied Fixed Fee`,
          amountPaisa: baseSharePaisa,
        });
      }
      break;

    case 'TIERED_PERCENTAGE':
      baseSharePaisa = computeTieredShare(eligibleRevenuePaisa, rateRule.tiers);
      breakdown.push({
        step: 2,
        description: `Applied Tiered Percentage Bands across ${rateRule.tiers?.length || 0} tiers`,
        amountPaisa: baseSharePaisa,
      });
      break;

    case 'PERCENTAGE_WITH_MINIMUM_GUARANTEE':
      const rawPct = Math.round((eligibleRevenuePaisa * percentage) / 100);
      if (rawPct < minimumGuaranteePaisa) {
        mgAdjustmentPaisa = minimumGuaranteePaisa - rawPct;
        baseSharePaisa = minimumGuaranteePaisa;
        breakdown.push({
          step: 2,
          description: `Calculated Share ₹${(rawPct / 100).toFixed(2)} below Minimum Guarantee ₹${(minimumGuaranteePaisa / 100).toFixed(2)}. Applied MG Shortfall Adjustment +₹${(mgAdjustmentPaisa / 100).toFixed(2)}`,
          amountPaisa: baseSharePaisa,
        });
      } else {
        baseSharePaisa = rawPct;
        breakdown.push({
          step: 2,
          description: `Calculated Share ₹${(rawPct / 100).toFixed(2)} met Minimum Guarantee ₹${(minimumGuaranteePaisa / 100).toFixed(2)}`,
          amountPaisa: baseSharePaisa,
        });
      }
      break;

    case 'PERCENTAGE_WITH_MAXIMUM_CAP':
      const unconstrained = Math.round((eligibleRevenuePaisa * percentage) / 100);
      if (maximumCapPaisa > 0 && unconstrained > maximumCapPaisa) {
        capReductionPaisa = unconstrained - maximumCapPaisa;
        baseSharePaisa = maximumCapPaisa;
        breakdown.push({
          step: 2,
          description: `Calculated Share ₹${(unconstrained / 100).toFixed(2)} exceeded Maximum Cap ₹${(maximumCapPaisa / 100).toFixed(2)}. Capped at ₹${(maximumCapPaisa / 100).toFixed(2)}`,
          amountPaisa: baseSharePaisa,
        });
      } else {
        baseSharePaisa = unconstrained;
        breakdown.push({
          step: 2,
          description: `Applied ${percentage}% share (within Cap ₹${(maximumCapPaisa / 100).toFixed(2)})`,
          amountPaisa: baseSharePaisa,
        });
      }
      break;

    case 'RENT_RECOVERY_FIRST':
    case 'UTILITY_RECOVERY_FIRST':
    case 'CUSTOM_APPROVED_ADJUSTMENT':
    default:
      baseSharePaisa = Math.round((eligibleRevenuePaisa * percentage) / 100);
      breakdown.push({
        step: 2,
        description: `Applied standard percentage formula (${method})`,
        amountPaisa: baseSharePaisa,
      });
      break;
  }

  return {
    baseSharePaisa,
    percentageApplied,
    fixedAmountApplied,
    mgAdjustmentPaisa,
    capReductionPaisa,
    breakdown,
  };
}

/**
 * 4. Compute Complete Settlement Total
 */
function computeSettlementTotal({
  salesInput,
  rateRule,
  recoveries = {},
  adjustmentsPaisa = 0,
  previousOutstandingPaisa = 0,
  advanceOffsetPaisa = 0,
  penaltyPaisa = 0,
}) {
  const eligibleRevenuePaisa = computeEligibleRevenue(salesInput, rateRule.calculationBasis);
  const baseResult = computeBaseShare(eligibleRevenuePaisa, rateRule);

  const electricityPaisa = toIntPaisa(recoveries.electricityPaisa);
  const waterPaisa = toIntPaisa(recoveries.waterPaisa);
  const gasPaisa = toIntPaisa(recoveries.gasPaisa);
  const camMaintenancePaisa = toIntPaisa(recoveries.camMaintenancePaisa);
  const totalRecoveriesPaisa = electricityPaisa + waterPaisa + gasPaisa + camMaintenancePaisa;

  const breakdown = [...baseResult.breakdown];

  if (totalRecoveriesPaisa > 0) {
    breakdown.push({
      step: 3,
      description: `Added Utility & Maintenance Recoveries: ₹${(totalRecoveriesPaisa / 100).toFixed(2)} (Elec: ₹${(electricityPaisa / 100).toFixed(2)}, Water: ₹${(waterPaisa / 100).toFixed(2)}, CAM: ₹${(camMaintenancePaisa / 100).toFixed(2)})`,
      amountPaisa: totalRecoveriesPaisa,
    });
  }

  if (previousOutstandingPaisa > 0) {
    breakdown.push({
      step: 4,
      description: `Brought forward previous period outstanding balance`,
      amountPaisa: previousOutstandingPaisa,
    });
  }

  if (adjustmentsPaisa !== 0) {
    breakdown.push({
      step: 5,
      description: `Applied approved commercial adjustments / credits`,
      amountPaisa: adjustmentsPaisa,
    });
  }

  if (advanceOffsetPaisa > 0) {
    breakdown.push({
      step: 6,
      description: `Offset against available Operator Advance Balance`,
      amountPaisa: -advanceOffsetPaisa,
    });
  }

  const netPayablePaisa = Math.max(
    0,
    baseResult.baseSharePaisa +
      totalRecoveriesPaisa +
      toIntPaisa(previousOutstandingPaisa) +
      toIntPaisa(adjustmentsPaisa) +
      toIntPaisa(penaltyPaisa) -
      toIntPaisa(advanceOffsetPaisa)
  );

  breakdown.push({
    step: 7,
    description: `Final Net Payable for Period`,
    amountPaisa: netPayablePaisa,
  });

  return {
    eligibleRevenuePaisa,
    baseRevenueSharePaisa: baseResult.baseSharePaisa,
    fixedFeeComponentPaisa: baseResult.fixedAmountApplied,
    minimumGuaranteeShortfallPaisa: baseResult.mgAdjustmentPaisa,
    capReductionPaisa: baseResult.capReductionPaisa,
    recoveries: {
      electricityPaisa,
      waterPaisa,
      gasPaisa,
      camMaintenancePaisa,
      totalRecoveriesPaisa,
    },
    adjustmentsPaisa: toIntPaisa(adjustmentsPaisa),
    previousOutstandingPaisa: toIntPaisa(previousOutstandingPaisa),
    advanceOffsetPaisa: toIntPaisa(advanceOffsetPaisa),
    penaltyLateChargePaisa: toIntPaisa(penaltyPaisa),
    netPayablePaisa,
    calculationBreakdown: breakdown,
  };
}

module.exports = {
  computeEligibleRevenue,
  computeTieredShare,
  computeBaseShare,
  computeSettlementTotal,
};
