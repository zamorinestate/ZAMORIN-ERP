'use strict';

/**
 * ============================================================================
 * ZAMORIN CAFÉ ERP — DATA FOUNDATION & STOCK POLICY SERVICE (P05)
 * ============================================================================
 *
 * Authoritative business service for:
 *   - Item identity, base/purchase unit consistency and versioned conversions
 *   - Vendor mapping resolution and contracted rate validation
 *   - Stock policy invariants (Min, Par, Safety, Max, Order Multiples)
 *   - Data quality gating: Prevents automatic replenishment and purchasing
 *     for items with ambiguous units or missing vendor mappings.
 */

const { GlobalInventoryItem } = require('../models/GlobalInventoryItem');
const { CafeInventoryConfig } = require('../models/CafeInventoryConfig');
const { Vendor } = require('../models/Vendor');
const { ApiError } = require('../utils/ApiError');

/**
 * Evaluate data quality and stock-policy validity for a specific item at a café.
 *
 * Invariants enforced:
 *   1. Item must exist and be in ACTIVE status.
 *   2. Base unit must be defined.
 *   3. If purchaseUnit is specified and differs from baseUnit, an unambiguous
 *      conversion factor must exist in conversions.
 *   4. An active, approved vendor must be mapped in supplierItemCatalogue for this item.
 *   5. The vendor must have a valid contracted rate (> 0 paisa) that is currently effective.
 *   6. Stock policy parameters must satisfy: min >= 0, safety >= 0, leadTime >= 1,
 *      par >= min (if par > 0), max >= par (if max > 0), orderMultiple > 0.
 *
 * If ANY of these checks fail, automatic purchasing eligibility is strictly revoked.
 */
async function validateItemDataQuality({ organisationId, itemId, cafeId }) {
  if (!organisationId || !itemId || !cafeId) {
    throw new ApiError(400, 'VALIDATION_FAILED', 'organisationId, itemId, and cafeId are required.');
  }

  const cleanOrg = organisationId.trim().toUpperCase();
  const cleanItem = itemId.trim().toUpperCase();
  const cleanCafe = cafeId.trim().toUpperCase();

  const errors = [];
  const warnings = [];

  // 1. Check Global Item
  const item = await GlobalInventoryItem.findOne({ organisationId: cleanOrg, itemId: cleanItem }).lean();
  if (!item) {
    errors.push('ITEM_NOT_FOUND');
    return {
      isValid: false,
      isAutomaticPurchasingEligible: false,
      errors,
      warnings,
    };
  }

  if (item.status !== 'ACTIVE') {
    errors.push(`ITEM_NOT_ACTIVE_${item.status}`);
  }

  if (!item.baseUnit || !item.baseUnit.trim()) {
    errors.push('MISSING_BASE_UNIT');
  }

  // 2. Unit conversion validation
  const baseUom = (item.baseUnit || '').trim().toLowerCase();
  const purchaseUom = (item.purchaseUnit || '').trim().toLowerCase();

  let resolvedConversionFactor = 1;
  if (purchaseUom && purchaseUom !== baseUom) {
    const matchingConv = (item.conversions || []).find((c) => {
      const disp = (c.displayUnit || '').trim().toLowerCase();
      const fromU = (c.fromUnit || '').trim().toLowerCase();
      const toU = (c.toUnit || '').trim().toLowerCase();
      return (disp === purchaseUom || fromU === purchaseUom) && (toU === baseUom || toU === '' || disp === purchaseUom);
    });

    if (!matchingConv || !matchingConv.factor || matchingConv.factor <= 0) {
      errors.push('AMBIGUOUS_UNIT_CONVERSION');
    } else {
      // Check effective dates if present
      const now = new Date();
      if (matchingConv.effectiveTo && new Date(matchingConv.effectiveTo) < now) {
        errors.push('EXPIRED_UNIT_CONVERSION');
      } else {
        resolvedConversionFactor = matchingConv.factor;
      }
    }
  }

  // 3. Cafe Inventory Config
  const config = await CafeInventoryConfig.findOne({
    organisationId: cleanOrg,
    cafeId: cleanCafe,
    itemId: cleanItem,
  });

  if (!config) {
    errors.push('ITEM_NOT_ASSIGNED_TO_CAFE');
  } else {
    // Validate stock policy parameters
    if (config.minQuantityBase < 0) {
      errors.push('INVALID_MIN_QUANTITY_NEGATIVE');
    }
    if (config.safetyStockBase < 0) {
      errors.push('INVALID_SAFETY_STOCK_NEGATIVE');
    }
    if (config.leadTimeDays < 1) {
      errors.push('INVALID_LEAD_TIME_LESS_THAN_ONE');
    }
    if (config.parQuantityBase > 0 && config.minQuantityBase > 0 && config.parQuantityBase < config.minQuantityBase) {
      errors.push('INVALID_POLICY_PAR_LESS_THAN_MIN');
    }
    if (config.maxQuantityBase > 0 && config.parQuantityBase > 0 && config.maxQuantityBase < config.parQuantityBase) {
      errors.push('INVALID_POLICY_MAX_LESS_THAN_PAR');
    }
    if (config.orderMultipleBase && config.orderMultipleBase <= 0) {
      errors.push('INVALID_ORDER_MULTIPLE_NON_POSITIVE');
    }
  }

  // 4. Vendor Mapping & Contracted Rates
  const vendorQuery = {
    organisationId: cleanOrg,
    status: 'ACTIVE',
    'supplierItemCatalogue.itemId': cleanItem,
  };

  const eligibleVendors = await Vendor.find(vendorQuery).lean();
  let matchedVendor = null;
  let matchedLine = null;

  for (const v of eligibleVendors) {
    // Check if supplier hold prevents purchasing
    const hasPoHold = (v.supplierHolds || []).some(
      (h) => h.status === 'ACTIVE' && (h.holdType === 'BLOCK_ALL_POS' || h.holdType === 'QUALITY_HOLD')
    );
    if (hasPoHold) continue;

    // Check line item
    const line = (v.supplierItemCatalogue || []).find(
      (cat) => cat.itemId === cleanItem && cat.status === 'ACTIVE'
    );
    if (!line) continue;

    // Check cafe scope
    if (Array.isArray(line.approvedCafeIds) && line.approvedCafeIds.length > 0) {
      if (!line.approvedCafeIds.includes(cleanCafe)) continue;
    }

    // Check defaultVendor preference if configured
    if (config?.defaultVendorId && v.vendorId === config.defaultVendorId) {
      matchedVendor = v;
      matchedLine = line;
      break;
    }

    if (!matchedVendor) {
      matchedVendor = v;
      matchedLine = line;
    }
  }

  if (!matchedVendor || !matchedLine) {
    errors.push('MISSING_VENDOR_MAPPING');
  } else {
    // Verify contracted rate
    const price = matchedLine.currentPricePaisa || matchedLine.contractedPricePaisa;
    if (!price || price <= 0) {
      errors.push('MISSING_CONTRACTED_RATE');
    }

    // Verify rate expiration if price history is present
    const now = new Date();
    if (matchedLine.priceHistory && matchedLine.priceHistory.length > 0) {
      const activeHist = matchedLine.priceHistory.find((ph) => {
        const from = new Date(ph.effectiveFrom);
        const to = ph.effectiveTo ? new Date(ph.effectiveTo) : null;
        return from <= now && (!to || to >= now);
      });
      if (!activeHist && matchedLine.priceHistory.some((ph) => ph.effectiveTo && new Date(ph.effectiveTo) < now)) {
        warnings.push('CONTRACTED_RATE_PRICE_HISTORY_EXPIRED');
      }
    }
  }

  // Final determination
  const isAutomaticPurchasingEligible = errors.length === 0;
  const dataQualityStatus = errors.length === 0 ? 'VALID' : 'INVALID';

  // Persist evaluation state to CafeInventoryConfig if config exists
  if (config) {
    config.isAutomaticPurchasingEligible = isAutomaticPurchasingEligible;
    config.dataQualityStatus = dataQualityStatus;
    config.dataQualityErrors = errors;
    if (typeof config.save === 'function') {
      await config.save();
    }
  }

  return {
    isValid: errors.length === 0,
    isAutomaticPurchasingEligible,
    dataQualityStatus,
    errors,
    warnings,
    itemId: cleanItem,
    cafeId: cleanCafe,
    item: {
      itemId: item.itemId,
      sku: item.sku,
      name: item.name,
      baseUnit: item.baseUnit,
      purchaseUnit: item.purchaseUnit,
      resolvedConversionFactor,
      category: item.category,
      storageConstraints: item.storageConstraints,
    },
    config: config ? {
      minQuantityBase: config.minQuantityBase,
      parQuantityBase: config.parQuantityBase,
      safetyStockBase: config.safetyStockBase,
      maxQuantityBase: config.maxQuantityBase,
      orderMultipleBase: config.orderMultipleBase || 1,
      reorderPolicy: config.reorderPolicy || 'MIN_MAX',
      leadTimeDays: config.leadTimeDays,
      supplierDeliveryDays: config.supplierDeliveryDays || [],
    } : null,
    vendorMapping: matchedVendor ? {
      vendorId: matchedVendor.vendorId,
      name: matchedVendor.name,
      supplierItemCode: matchedLine.supplierItemCode,
      contractedPricePaisa: matchedLine.currentPricePaisa,
      uom: matchedLine.uom,
      uomConversionFactor: matchedLine.uomConversionFactor || 1,
      moq: matchedLine.moq || 1,
      orderMultiple: matchedLine.orderMultiple || 1,
      leadTimeDays: matchedLine.leadTimeDays || 2,
      deliveryDays: matchedLine.deliveryDays || [],
      taxPercent: matchedLine.taxPercent || 5,
    } : null,
  };
}

/**
 * Execute a complete organization/café data quality sweep across all stocked items.
 */
async function runDataQualitySweep({ organisationId, cafeId = null }) {
  const cleanOrg = organisationId.trim().toUpperCase();
  const filter = { organisationId: cleanOrg };
  if (cafeId && cafeId !== 'ALL') {
    filter.cafeId = cafeId.trim().toUpperCase();
  }

  const configs = await CafeInventoryConfig.find(filter).lean();
  let totalEvaluated = 0;
  let eligibleCount = 0;
  let blockedCount = 0;
  const items = [];

  for (const c of configs) {
    totalEvaluated++;
    const res = await validateItemDataQuality({
      organisationId: cleanOrg,
      itemId: c.itemId,
      cafeId: c.cafeId,
    });

    if (res.isAutomaticPurchasingEligible) {
      eligibleCount++;
    } else {
      blockedCount++;
    }

    items.push({
      itemId: c.itemId,
      cafeId: c.cafeId,
      sku: res.item?.sku || c.itemId,
      name: res.item?.name || c.itemId,
      isAutomaticPurchasingEligible: res.isAutomaticPurchasingEligible,
      dataQualityStatus: res.dataQualityStatus,
      errors: res.errors,
      warnings: res.warnings,
      vendorMapped: Boolean(res.vendorMapping),
    });
  }

  return {
    organisationId: cleanOrg,
    cafeId: cafeId || 'ALL',
    totalEvaluated,
    eligibleCount,
    blockedCount,
    items,
  };
}

/**
 * Resolve effective purchase parameters for generating orders.
 * Strictly throws if item is not eligible for purchasing due to data quality violations.
 */
async function resolveEffectivePurchaseOrderParams({ organisationId, cafeId, itemId }) {
  const result = await validateItemDataQuality({ organisationId, itemId, cafeId });
  if (!result.isAutomaticPurchasingEligible) {
    throw new ApiError(
      400,
      'INELIGIBLE_FOR_PURCHASING',
      `Item ${itemId} is not eligible for purchasing due to data-quality violations: ${result.errors.join(', ')}`
    );
  }

  const { item, config, vendorMapping } = result;
  return {
    itemId: item.itemId,
    sku: item.sku,
    name: item.name,
    baseUnit: item.baseUnit,
    purchaseUnit: item.purchaseUnit || item.baseUnit,
    unitConversionFactor: item.resolvedConversionFactor,
    vendorId: vendorMapping.vendorId,
    vendorName: vendorMapping.name,
    supplierItemCode: vendorMapping.supplierItemCode,
    contractedPricePaisa: vendorMapping.contractedPricePaisa,
    taxPercent: vendorMapping.taxPercent,
    moq: vendorMapping.moq,
    orderMultiple: vendorMapping.orderMultiple || config.orderMultipleBase || 1,
    leadTimeDays: vendorMapping.leadTimeDays || config.leadTimeDays,
    deliveryDays: vendorMapping.deliveryDays.length ? vendorMapping.deliveryDays : config.supplierDeliveryDays,
    minQuantityBase: config.minQuantityBase,
    parQuantityBase: config.parQuantityBase,
    maxQuantityBase: config.maxQuantityBase,
  };
}

module.exports = {
  validateItemDataQuality,
  runDataQualitySweep,
  resolveEffectivePurchaseOrderParams,
};
