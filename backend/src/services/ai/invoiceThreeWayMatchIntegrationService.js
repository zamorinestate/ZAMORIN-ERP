'use strict';

/**
 * ZAMORIN AI INVOICE INTELLIGENCE — THREE-WAY MATCH INTEGRATION SERVICE (PHASES 12, 13, 14)
 *
 * Integrates extracted invoice data with authoritative Purchase Order and Physical GRN records:
 *   PO ↔ GRN (Accepted Quantity) ↔ EXTRACTED INVOICE
 *
 * NON-NEGOTIABLE SAFETY PRINCIPLES:
 *   1. AI NEVER MODIFIES the Purchase Order.
 *   2. Invoice quantity NEVER overrides physical accepted GRN quantity.
 *      The physical GRN remains authoritative.
 *   3. Zero floating-point arithmetic: all rate and total comparisons use integer paise.
 */

const { PurchaseOrder } = require('../../models/PurchaseOrder');
const { ThreeWayMatchService } = require('../threeWayMatchService');
const { roundToPaisa } = require('../gstTaxService');

const DEFAULT_TOLERANCE = {
  rateTolerancePaisa: 100,      // ₹1.00 unit price variance allowance
  qtyTolerancePercent: 0,       // 0% quantity variance allowed on physical goods
  totalTolerancePaisa: 100,     // ₹1.00 header rounding allowance
};

function normalizeText(text) {
  if (!text || typeof text !== 'string') return '';
  return text.toLowerCase().replace(/[^\w]/g, '').trim();
}

class InvoiceThreeWayMatchIntegrationService {
  /**
   * Executes authoritative three-way reconciliation.
   *
   * @param {Object} params
   * @param {Object} params.extracted - Canonical invoice extraction data
   * @param {string} [params.matchedVendorId] - Resolved vendor ID
   * @param {string} [params.purchaseOrderId] - Target PO ID (or extracted PO number)
   * @param {string} [params.grnId] - Target GRN ID (or extracted delivery reference)
   * @param {string} params.organisationId
   * @param {string} [params.cafeId]
   * @param {Object} [params.toleranceConfig]
   * @returns {Promise<Object>} Reconciliation result conforming to InvoiceExtraction schema
   */
  static async reconcile({
    extracted = {},
    matchedVendorId = null,
    purchaseOrderId = null,
    grnId = null,
    organisationId,
    cafeId = null,
    toleranceConfig = DEFAULT_TOLERANCE,
  }) {
    if (!organisationId) {
      throw new Error('organisationId is required for three-way matching');
    }

    const orgId = String(organisationId).trim().toUpperCase();
    const targetPoId = purchaseOrderId || extracted.invoice?.purchaseOrderNumber || null;
    const targetGrnId = grnId || extracted.invoice?.deliveryReference || null;

    const tolerance = {
      rateTolerancePaisa: Number(toleranceConfig.rateTolerancePaisa ?? DEFAULT_TOLERANCE.rateTolerancePaisa),
      qtyTolerancePercent: Number(toleranceConfig.qtyTolerancePercent ?? DEFAULT_TOLERANCE.qtyTolerancePercent),
      totalTolerancePaisa: Number(toleranceConfig.totalTolerancePaisa ?? DEFAULT_TOLERANCE.totalTolerancePaisa),
    };

    const overallDiscrepancies = [];
    const lineMatches = [];
    let toleranceApplied = false;

    // ── Phase 12: PO Match Assessment ──────────────────────────────────────────
    if (!targetPoId) {
      overallDiscrepancies.push({
        code: 'PO_NOT_FOUND',
        message: 'No Purchase Order reference specified or extracted from invoice.',
        severity: 'BLOCKING',
      });

      return {
        status: 'BLOCKED',
        purchaseOrderId: null,
        grnId: null,
        lineMatches: [],
        overallDiscrepancies,
        toleranceApplied: false,
        toleranceDetails: tolerance,
      };
    }

    const cleanPoId = String(targetPoId).trim().toUpperCase();
    const po = await PurchaseOrder.findOne({
      organisationId: orgId,
      purchaseOrderId: cleanPoId,
    }).lean();

    if (!po) {
      overallDiscrepancies.push({
        code: 'PO_NOT_FOUND',
        message: `Purchase Order ${cleanPoId} does not exist in organisation ${orgId}.`,
        severity: 'BLOCKING',
      });

      return {
        status: 'BLOCKED',
        purchaseOrderId: cleanPoId,
        grnId: null,
        lineMatches: [],
        overallDiscrepancies,
        toleranceApplied: false,
        toleranceDetails: tolerance,
      };
    }

    // Verify PO Vendor vs Extracted/Matched Vendor
    if (matchedVendorId && po.vendorId && String(po.vendorId).toUpperCase() !== String(matchedVendorId).toUpperCase()) {
      overallDiscrepancies.push({
        code: 'PO_VENDOR_MISMATCH',
        message: `PO vendor (${po.vendorId}) does not match invoice supplier (${matchedVendorId}).`,
        severity: 'BLOCKING',
      });
    }

    // ── Phase 13: Physical GRN Assessment ──────────────────────────────────────
    const grnReceipts = po.grnReceipts || [];
    let activeGrn = null;

    if (targetGrnId) {
      const cleanGrnId = String(targetGrnId).trim().toUpperCase();
      activeGrn = grnReceipts.find((g) => g.grnId === cleanGrnId);
      if (!activeGrn) {
        overallDiscrepancies.push({
          code: 'GRN_NOT_FOUND',
          message: `Referenced GRN ${cleanGrnId} not found under PO ${cleanPoId}.`,
          severity: 'BLOCKING',
        });
      }
    } else if (grnReceipts.length > 0) {
      // Use latest GRN receipt under PO
      activeGrn = grnReceipts[grnReceipts.length - 1];
    } else {
      overallDiscrepancies.push({
        code: 'GRN_NOT_FOUND',
        message: `No physical goods receipt (GRN) recorded for PO ${cleanPoId}. Physical count pending.`,
        severity: 'BLOCKING',
      });
    }

    // Aggregate accepted quantities from GRN (Authoritative Physical Count)
    const grnItemMap = new Map();
    if (activeGrn && Array.isArray(activeGrn.items)) {
      for (const gi of activeGrn.items) {
        const id = String(gi.itemId || '').trim().toUpperCase();
        grnItemMap.set(id, {
          acceptedQty: Number(gi.acceptedQty || 0),
          deliveredQty: Number(gi.deliveredQty || 0),
          rejectedQty: Number(gi.rejectedQty || 0),
        });
      }
    }

    // Map PO line items
    const headerPoTaxRate = po.subtotalPaisa > 0 ? ((po.taxPaisa || 0) / po.subtotalPaisa) * 100 : 0;
    const poItemMap = new Map();
    for (const pl of po.lineItems || []) {
      const id = String(pl.itemId || '').trim().toUpperCase();
      poItemMap.set(id, {
        itemId: id,
        name: pl.name || pl.itemNameSnapshot,
        orderedQty: Number(pl.orderedQuantityBase || 0),
        receivedQty: Number(pl.receivedQuantityBase || 0),
        unitPricePaisa: Number(pl.unitPricePaisa || 0),
        taxRatePercent: pl.taxRatePercent !== undefined ? Number(pl.taxRatePercent) : headerPoTaxRate,
        baseUnit: String(pl.baseUnit || 'UNIT').trim().toUpperCase(),
      });
    }

    // ── Phase 14: Line-by-Line 3-Way Match ─────────────────────────────────────
    const invoiceLines = extracted.lineItems || [];
    const matchedPoItemIds = new Set();

    for (const invLine of invoiceLines) {
      const invDesc = String(invLine.description || '').trim();
      const invNormDesc = normalizeText(invDesc);
      const invSku = invLine.sku ? String(invLine.sku).trim().toUpperCase() : null;
      const invQty = Number(invLine.quantity || 0);
      const invRatePaisa = roundToPaisa(Number(invLine.unitPrice || 0) * 100);
      const invTaxRate = Number(invLine.gstRate || 0);

      // Match against PO item
      let matchedPoItem = null;
      if (invSku && poItemMap.has(invSku)) {
        matchedPoItem = poItemMap.get(invSku);
      } else {
        // Try matching by description/name
        for (const [id, pi] of poItemMap.entries()) {
          if (!matchedPoItemIds.has(id)) {
            const piNormName = normalizeText(pi.name);
            if (invNormDesc && piNormName && (invNormDesc.includes(piNormName) || piNormName.includes(invNormDesc))) {
              matchedPoItem = pi;
              break;
            }
          }
        }
      }

      if (!matchedPoItem) {
        lineMatches.push({
          lineNumber: invLine.lineNumber,
          invoiceSku: invSku,
          description: invDesc,
          poItemId: null,
          invoiceQuantity: invQty,
          grnAcceptedQuantity: 0,
          poOrderedQuantity: 0,
          invoiceUnitPrice: Number(invLine.unitPrice || 0),
          poUnitPrice: 0,
          varianceAmount: Number(invLine.lineTotal || 0),
          matchResult: 'INVOICE_EXTRA_ITEM',
          discrepancyReason: `Line item "${invDesc}" does not correspond to any line on PO ${cleanPoId}.`,
        });
        continue;
      }

      matchedPoItemIds.add(matchedPoItem.itemId);

      // Check physical GRN accepted quantity (Authoritative)
      const grnRecord = grnItemMap.get(matchedPoItem.itemId);
      const acceptedQty = grnRecord ? grnRecord.acceptedQty : matchedPoItem.receivedQty;

      const rateDiffPaisa = Math.abs(invRatePaisa - matchedPoItem.unitPricePaisa);
      const isRateVariance = rateDiffPaisa > tolerance.rateTolerancePaisa;
      const isRateWithinTolerance = rateDiffPaisa > 0 && rateDiffPaisa <= tolerance.rateTolerancePaisa;

      if (isRateWithinTolerance) {
        toleranceApplied = true;
      }

      const qtyDiff = invQty - acceptedQty;
      const isQtyVariance = Math.abs(qtyDiff) > (tolerance.qtyTolerancePercent / 100) * (acceptedQty || 1);

      const isTaxMismatch = Math.abs(invTaxRate - matchedPoItem.taxRatePercent) > 0.1;

      let lineResult = 'MATCH';
      const reasons = [];

      if (isQtyVariance) {
        lineResult = 'QUANTITY_VARIANCE';
        reasons.push(
          `Invoice quantity (${invQty}) differs from physical GRN accepted quantity (${acceptedQty}).`
        );
      }

      if (isRateVariance) {
        lineResult = 'PRICE_VARIANCE';
        reasons.push(
          `Unit price variance: PO ₹${(matchedPoItem.unitPricePaisa / 100).toFixed(2)} vs Invoice ₹${(invRatePaisa / 100).toFixed(2)}.`
        );
      }

      if (isTaxMismatch) {
        if (lineResult === 'MATCH') lineResult = 'TAX_MISMATCH';
        reasons.push(`Tax rate mismatch: PO ${matchedPoItem.taxRatePercent}% vs Invoice ${invTaxRate}%.`);
      }

      lineMatches.push({
        lineNumber: invLine.lineNumber,
        invoiceSku: invSku,
        description: invDesc,
        poItemId: matchedPoItem.itemId,
        invoiceQuantity: invQty,
        grnAcceptedQuantity: acceptedQty,
        poOrderedQuantity: matchedPoItem.orderedQty,
        invoiceUnitPrice: Number(invLine.unitPrice || 0),
        poUnitPrice: matchedPoItem.unitPricePaisa / 100,
        varianceAmount: (rateDiffPaisa * invQty) / 100,
        matchResult: lineResult,
        discrepancyReason: reasons.join(' ') || null,
      });
    }

    // ── Check for unbilled PO items ──────────────────────────────────────────
    for (const [poItemId, poItem] of poItemMap.entries()) {
      if (!matchedPoItemIds.has(poItemId)) {
        overallDiscrepancies.push({
          code: 'PO_EXTRA_ITEM',
          message: `PO Item ${poItemId} (${poItem.name}) is present on PO but missing from supplier invoice.`,
          severity: 'WARNING',
        });
      }
    }

    // ── Check Header Grand Total Variance ────────────────────────────────────
    const extractedGrandTotalPaisa = roundToPaisa(Number(extracted.totals?.grandTotal || 0) * 100);
    const poGrandTotalPaisa = Number(po.totalPaisa || 0);
    const totalDiffPaisa = Math.abs(extractedGrandTotalPaisa - poGrandTotalPaisa);

    if (totalDiffPaisa > tolerance.totalTolerancePaisa) {
      overallDiscrepancies.push({
        code: 'HEADER_TOTAL_MISMATCH',
        message: `Invoice grand total (₹${(extractedGrandTotalPaisa / 100).toFixed(2)}) differs from PO total (₹${(poGrandTotalPaisa / 100).toFixed(2)}). Variance: ₹${(totalDiffPaisa / 100).toFixed(2)}.`,
        severity: 'WARNING',
      });
    } else if (totalDiffPaisa > 0 && totalDiffPaisa <= tolerance.totalTolerancePaisa) {
      toleranceApplied = true;
    }

    // ── Derive Overall Status ────────────────────────────────────────────────
    const hasLineVariances = lineMatches.some((lm) => lm.matchResult !== 'MATCH');
    const hasBlockingDiscrepancies = overallDiscrepancies.some((d) => d.severity === 'BLOCKING');

    let overallStatus = 'MATCHED';
    if (hasBlockingDiscrepancies) {
      overallStatus = 'BLOCKED';
    } else if (hasLineVariances) {
      overallStatus = 'EXCEPTION';
    } else if (toleranceApplied) {
      overallStatus = 'MATCHED_WITH_TOLERANCE';
    }

    return {
      status: overallStatus,
      purchaseOrderId: po.purchaseOrderId,
      grnId: activeGrn ? activeGrn.grnId : null,
      lineMatches,
      overallDiscrepancies,
      toleranceApplied,
      toleranceDetails: tolerance,
    };
  }
}

module.exports = {
  InvoiceThreeWayMatchIntegrationService,
  DEFAULT_TOLERANCE,
};
