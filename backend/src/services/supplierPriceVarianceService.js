'use strict';

/**
 * ============================================================================
 * ZAMORIN CAFÉ ERP — SUPPLIER PRICE VARIANCE & COST ANALYSIS SERVICE (PACKAGE P17)
 * ============================================================================
 * Evaluates purchase order and receiving price movements against contracted
 * vendor catalogue rates and historical baselines.
 *
 * CRITICAL GOVERNANCE INVARIANTS:
 * 1. LIKE-FOR-LIKE COMPARISON: Compares the same canonical itemId, normalised to
 *    base units via authoritative uomConversionFactors.
 * 2. DIVISION-BY-ZERO SAFETY: Handles zero or missing baseline prices cleanly;
 *    never outputs NaN, Infinity, or unhandled percentages.
 * 3. ANALYTICAL ONLY: Variances are analytical findings. They NEVER rewrite historical
 *    invoices, modify approved purchase orders, or alter general ledger balances.
 */

const { PurchaseOrder } = require('../models/PurchaseOrder');
const { Vendor } = require('../models/Vendor');
const { GlobalInventoryItem } = require('../models/GlobalInventoryItem');
const ApiError = require('../utils/ApiError');

class SupplierPriceVarianceService {
  /**
   * Analyzes supplier price variances for purchases over a historical period.
   *
   * @param {Object} params
   * @param {string} params.organisationId
   * @param {string} [params.cafeId]
   * @param {number} [params.days=60] - Lookback window in days
   * @param {string} [params.vendorId] - Optional vendor filter
   * @param {string} [params.itemId] - Optional item filter
   * @returns {Promise<Object>} Summary and item-level price variance report
   */
  static async analyzePriceVariances({
    organisationId = 'ZAMORIN',
    cafeId = null,
    days = 60,
    vendorId = null,
    itemId = null,
  }) {
    if (!organisationId) {
      throw new ApiError(400, 'VALIDATION_FAILED', 'organisationId is required.');
    }

    const cleanOrg = organisationId.trim().toUpperCase();
    const cleanCafe = cafeId ? cafeId.trim().toUpperCase() : null;
    const lookbackDays = Math.min(365, Math.max(7, Number(days) || 60));

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - lookbackDays);

    // ── 1. Query Purchase Orders ─────────────────────────────────────────────
    const poQuery = {
      organisationId: cleanOrg,
      createdAt: { $gte: cutoffDate },
      status: { $in: ['APPROVED', 'ORDER_PLACED', 'ORDERED', 'ACKNOWLEDGED', 'DISPATCHED', 'PARTIALLY_RECEIVED', 'COMPLETED', 'RECEIVED'] },
    };

    if (cleanCafe) poQuery.cafeId = cleanCafe;
    if (vendorId) poQuery.vendorId = vendorId.trim().toUpperCase();
    if (itemId) poQuery['lineItems.itemId'] = itemId.trim().toUpperCase();

    const [pos, vendors, globalItems] = await Promise.all([
      PurchaseOrder.find(poQuery).lean(),
      Vendor.find({ organisationId: cleanOrg }).lean(),
      GlobalInventoryItem.find({ organisationId: cleanOrg }).lean(),
    ]);

    const vendorMap = new Map(vendors.map(v => [v.vendorId, v]));
    const itemMap = new Map(globalItems.map(i => [i.itemId, i]));

    // ── 2. Analyze Line-by-Line Variances ────────────────────────────────────
    const findings = [];
    let severeCount = 0;
    let materialIncreaseCount = 0;
    let stableCount = 0;
    let materialDecreaseCount = 0;

    for (const po of pos) {
      const vDoc = vendorMap.get(po.vendorId);
      const vendorName = vDoc ? vDoc.legalName || vDoc.tradeName || po.vendorId : po.vendorId;

      for (const line of po.lineItems || []) {
        if (!line.itemId) continue;
        if (itemId && line.itemId !== itemId.trim().toUpperCase()) continue;

        const gItem = itemMap.get(line.itemId);
        const itemName = line.itemNameSnapshot || (gItem ? gItem.name : line.itemId);
        const baseUnit = line.baseUnit || (gItem ? gItem.baseUnit : 'unit');

        // Normalise PO price to base unit:
        // line.unitPricePaisa is typically per purchase unit; conversion factor gives base units per purchase unit
        const conversionFactor = Number(line.uomConversionFactor) || 1;
        const poBaseUnitPricePaisa = conversionFactor > 0
          ? Math.round(Number(line.unitPricePaisa) / conversionFactor)
          : Number(line.unitPricePaisa) || 0;

        // Find contracted rate in vendor catalogue
        let contractedBaseUnitPricePaisa = null;
        let contractedTaxPercent = 5;

        const catalogueList = Array.isArray(vDoc?.itemCatalogue) && vDoc.itemCatalogue.length > 0
          ? vDoc.itemCatalogue
          : (Array.isArray(vDoc?.itemsSupplied) ? vDoc.itemsSupplied : []);

        if (catalogueList.length > 0) {
          const supplierEntry = catalogueList.find(
            s => s.itemId && s.itemId.toUpperCase() === line.itemId.toUpperCase()
          );
          if (supplierEntry && supplierEntry.currentPricePaisa > 0) {
            const catConv = Number(supplierEntry.uomConversionFactor) || 1;
            contractedBaseUnitPricePaisa = catConv > 0
              ? Math.round(supplierEntry.currentPricePaisa / catConv)
              : supplierEntry.currentPricePaisa;
            if (supplierEntry.taxPercent != null) {
              contractedTaxPercent = supplierEntry.taxPercent;
            }
          }
        }

        // Calculate variance
        let variancePaisa = null;
        let variancePercent = null;
        let severity = 'STABLE';
        let statusNote = 'Within expected price tolerances.';

        if (contractedBaseUnitPricePaisa !== null && contractedBaseUnitPricePaisa > 0) {
          variancePaisa = poBaseUnitPricePaisa - contractedBaseUnitPricePaisa;
          variancePercent = Number(
            (((variancePaisa) / contractedBaseUnitPricePaisa) * 100).toFixed(2)
          );

          if (variancePercent > 15) {
            severity = 'SEVERE_INCREASE';
            severeCount += 1;
            statusNote = `Price increased by ${variancePercent}% over contracted baseline. Review required.`;
          } else if (variancePercent >= 5) {
            severity = 'MATERIAL_INCREASE';
            materialIncreaseCount += 1;
            statusNote = `Material increase of ${variancePercent}% over contracted baseline.`;
          } else if (variancePercent <= -5) {
            severity = 'MATERIAL_DECREASE';
            materialDecreaseCount += 1;
            statusNote = `Favourable rate: ${Math.abs(variancePercent)}% lower than contracted baseline.`;
          } else {
            stableCount += 1;
          }
        } else {
          severity = 'NO_CONTRACTED_BASELINE';
          statusNote = 'No active contracted catalogue rate found in vendor master.';
        }

        findings.push({
          poNumber: po.poNumber || po.purchaseOrderId,
          orderDate: po.createdAt,
          cafeId: po.cafeId,
          vendorId: po.vendorId,
          vendorName,
          itemId: line.itemId,
          itemName,
          baseUnit,
          orderedQuantityBase: line.orderedQuantityBase,
          poBaseUnitPricePaisa,
          contractedBaseUnitPricePaisa,
          variancePaisa,
          variancePercent,
          severity,
          statusNote,
        });
      }
    }

    // Sort findings: most severe increases first, then by date descending
    const severityRank = {
      SEVERE_INCREASE: 0,
      MATERIAL_INCREASE: 1,
      MATERIAL_DECREASE: 2,
      NO_CONTRACTED_BASELINE: 3,
      STABLE: 4,
    };

    findings.sort((a, b) => {
      const sDiff = (severityRank[a.severity] ?? 5) - (severityRank[b.severity] ?? 5);
      if (sDiff !== 0) return sDiff;
      return new Date(b.orderDate) - new Date(a.orderDate);
    });

    return {
      organisationId: cleanOrg,
      cafeId: cleanCafe,
      analysisWindowDays: lookbackDays,
      totalPurchaseLinesEvaluated: findings.length,
      varianceSummary: {
        severeIncreaseCount: severeCount,
        materialIncreaseCount,
        stableCount,
        materialDecreaseCount,
        noBaselineCount: findings.filter(f => f.severity === 'NO_CONTRACTED_BASELINE').length,
      },
      findings,
      governanceNote: 'ANALYTICAL FINDINGS ONLY. Variances do not retroactively modify approved purchase orders, AP invoices, or general ledgers. Any supplier adjustments require authorized review.',
    };
  }

  /**
   * Real-time pre-order price spike check for a proposed line item against vendor contracts and past purchases (F154, F155).
   */
  static async checkLineItemPriceVariance({
    itemId,
    proposedUnitPricePaisa,
    organisationId = 'ZAMORIN',
    vendorId = null,
  }) {
    const cleanItem = String(itemId || '').trim().toUpperCase();
    const cleanOrg = String(organisationId || 'ZAMORIN').trim().toUpperCase();
    const cleanVendor = vendorId ? String(vendorId).trim().toUpperCase() : null;
    const proposedRate = Math.max(0, Number(proposedUnitPricePaisa || 0));

    // 1. Look up contracted rate in Vendor catalogue
    let baselinePricePaisa = null;
    let baselineSource = 'NONE';

    if (cleanVendor) {
      const vendorDoc = await Vendor.findOne({ organisationId: cleanOrg, vendorId: cleanVendor }).lean();
      if (vendorDoc && Array.isArray(vendorDoc.catalogue)) {
        const catEntry = vendorDoc.catalogue.find(
          (c) => String(c.itemId || c.sku || '').trim().toUpperCase() === cleanItem
        );
        if (catEntry && Number(catEntry.unitPricePaisa) > 0) {
          baselinePricePaisa = Number(catEntry.unitPricePaisa);
          baselineSource = 'VENDOR_CONTRACT_CATALOGUE';
        }
      }
    }

    // 2. If no vendor contract rate, check GlobalInventoryItem standard or last purchase cost
    if (!baselinePricePaisa) {
      const gItem = await GlobalInventoryItem.findOne({ organisationId: cleanOrg, itemId: cleanItem }).lean();
      if (gItem) {
        baselinePricePaisa = Number(gItem.lastPurchasePricePaisa || gItem.standardCostPaisa || gItem.unitCostPaisa || 0);
        if (baselinePricePaisa > 0) {
          baselineSource = 'GLOBAL_ITEM_HISTORY';
        }
      }
    }

    if (!baselinePricePaisa || baselinePricePaisa <= 0) {
      return {
        itemId: cleanItem,
        proposedUnitPricePaisa: proposedRate,
        baselinePricePaisa: null,
        baselineSource: 'NONE',
        variancePaisa: 0,
        variancePercent: 0,
        isAlert: false,
        severity: 'NO_CONTRACTED_BASELINE',
        message: 'No baseline price found for comparison.',
      };
    }

    const variancePaisa = proposedRate - baselinePricePaisa;
    const variancePercent = Number(((variancePaisa / baselinePricePaisa) * 100).toFixed(2));

    let isAlert = false;
    let severity = 'STABLE';
    let message = 'Price matches expected baseline.';

    if (variancePercent > 15) {
      isAlert = true;
      severity = 'SEVERE_INCREASE';
      message = `Severe price spike alert: Proposed rate (₹${(proposedRate / 100).toFixed(2)}) is ${variancePercent}% above baseline (₹${(baselinePricePaisa / 100).toFixed(2)})!`;
    } else if (variancePercent > 5) {
      isAlert = true;
      severity = 'MATERIAL_INCREASE';
      message = `Price increase alert: Proposed rate (₹${(proposedRate / 100).toFixed(2)}) is ${variancePercent}% above baseline (₹${(baselinePricePaisa / 100).toFixed(2)}).`;
    } else if (variancePercent < -5) {
      severity = 'MATERIAL_DECREASE';
      message = `Favorable price: Proposed rate is ${Math.abs(variancePercent)}% lower than baseline.`;
    }

    return {
      itemId: cleanItem,
      proposedUnitPricePaisa: proposedRate,
      baselinePricePaisa,
      baselineSource,
      variancePaisa,
      variancePercent,
      isAlert,
      severity,
      message,
    };
  }
}

module.exports = SupplierPriceVarianceService;
