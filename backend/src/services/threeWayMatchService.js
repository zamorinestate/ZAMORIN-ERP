'use strict';

/**
 * THREE-WAY MATCHING SERVICE (PO ↔ GRN ↔ SUPPLIER INVOICE)
 * Evaluates full 13-field line-item and header matrix:
 * 1.  Item / SKU
 * 2.  Quantity Ordered
 * 3.  Quantity Received
 * 4.  Quantity Invoiced
 * 5.  UOM (Unit of Measure)
 * 6.  PO Unit Rate
 * 7.  Invoiced Unit Rate
 * 8.  Discount
 * 9.  GST Rate (%)
 * 10. Taxable Value
 * 11. Tax Amount
 * 12. Line Total
 * 13. Grand Total
 */

const { ApiError } = require('../utils/ApiError');
const { roundToPaisa } = require('./gstTaxService');

/**
 * Computes canonical split tax for procurement matching (REC-16 §22).
 */
function computeLineTaxPaisa(taxableVal, gstRatePercent, isInterState = false) {
  const taxable = Math.max(0, Number(taxableVal || 0));
  const rate = Math.max(0, Number(gstRatePercent || 0));
  if (isInterState) {
    return roundToPaisa((taxable * rate) / 100);
  }
  const half = rate / 2;
  const cgst = roundToPaisa((taxable * half) / 100);
  const sgst = roundToPaisa((taxable * half) / 100);
  return cgst + sgst;
}

class ThreeWayMatchService {
  /**
   * Compares PO line items, GRN received quantities, and Supplier Invoice line items.
   */
  static performMatch({
    purchaseOrder,
    grn,
    supplierInvoice,
    toleranceConfig = { rateTolerancePaisa: 100, qtyTolerancePercent: 0, totalTolerancePaisa: 100 },
  }) {
    if (!purchaseOrder || !supplierInvoice) {
      throw new ApiError(400, 'DOCUMENTS_REQUIRED', 'Both PurchaseOrder and SupplierInvoice are required for 3-way matching.');
    }

    const isInterState = Boolean(
      supplierInvoice.isInterState ||
      purchaseOrder.isInterState ||
      supplierInvoice.supplyType === 'INTER_STATE' ||
      purchaseOrder.supplyType === 'INTER_STATE'
    );

    const discrepancies = [];
    const lineComparisons = [];

    const poLines = purchaseOrder.lineItems || [];
    const grnItems = grn ? (grn.items || []) : [];
    const invLines = supplierInvoice.lineItems || [];

    let computedPoTotal = 0;
    let computedInvTotal = 0;

    for (const poLine of poLines) {
      const sku = poLine.itemId;
      const grnLine = grnItems.find((g) => g.itemId === sku) || {};
      const invLine = invLines.find((i) => (i.itemId || i.sku) === sku) || {};

      const qtyOrdered = Number(poLine.orderedQuantityBase || 0);
      const qtyReceived = Number(grnLine.acceptedQty !== undefined ? grnLine.acceptedQty : (poLine.receivedQuantityBase || 0));
      const qtyInvoiced = Number(invLine.quantity !== undefined ? invLine.quantity : (poLine.invoicedQuantityBase || qtyReceived));

      const uomPo = String(poLine.baseUnit || 'UNIT').trim().toUpperCase();
      const uomInv = String(invLine.uom || invLine.baseUnit || uomPo).trim().toUpperCase();

      const poRate = Number(poLine.unitPricePaisa || 0);
      const invRate = Number(invLine.unitPricePaisa !== undefined ? invLine.unitPricePaisa : poRate);

      const discount = Number(invLine.discountPaisa || poLine.discountPaisa || 0);
      const poGst = poLine.taxRatePercent !== undefined ? Number(poLine.taxRatePercent) : (invLine.taxRatePercent !== undefined ? Number(invLine.taxRatePercent) : 0);
      const invGst = invLine.taxRatePercent !== undefined ? Number(invLine.taxRatePercent) : poGst;

      const taxableVal = Math.max(0, (qtyInvoiced * invRate) - discount);
      const taxAmount = computeLineTaxPaisa(taxableVal, invGst, isInterState);
      const lineTotal = taxableVal + taxAmount;

      computedPoTotal += Number(poLine.totalLinePaisa || (qtyOrdered * poRate));
      computedInvTotal += lineTotal;

      const lineDiscrepancy = {
        itemId: sku,
        qtyOrdered,
        qtyReceived,
        qtyInvoiced,
        uomPo,
        uomInv,
        poRate,
        invRate,
        discount,
        poGst,
        invGst,
        taxableVal,
        taxAmount,
        lineTotal,
        issues: [],
      };

      // 1. Quantity Mismatch with tolerance percentage (A047-A052)
      const qtyTol = Number(toleranceConfig.qtyTolerancePercent || 0);
      const allowedMaxInvoiced = qtyTol > 0 ? (qtyReceived * (1 + qtyTol / 100)) : qtyReceived;
      if (qtyInvoiced > allowedMaxInvoiced) {
        lineDiscrepancy.issues.push(
          qtyTol > 0
            ? `Quantity invoiced (${qtyInvoiced}) exceeds received quantity (${qtyReceived}) beyond ${qtyTol}% tolerance limit.`
            : `Quantity invoiced (${qtyInvoiced}) exceeds received quantity (${qtyReceived}).`
        );
      }

      // 2. Rate Mismatch with tolerance
      const rateDiff = Math.abs(invRate - poRate);
      const rateTolPercent = Number(toleranceConfig.rateTolerancePercent || 0);
      const rateTolPaisa = Number(toleranceConfig.rateTolerancePaisa || 0);
      const allowedRateDiff = rateTolPercent > 0 ? ((poRate * rateTolPercent) / 100) : rateTolPaisa;
      if (rateDiff > allowedRateDiff) {
        lineDiscrepancy.issues.push(`Unit price variance: PO ₹${(poRate / 100).toFixed(2)} vs Invoice ₹${(invRate / 100).toFixed(2)}.`);
      }

      // 3. UOM Mismatch
      if (uomPo !== uomInv) {
        lineDiscrepancy.issues.push(`UOM mismatch: PO ${uomPo} vs Invoice ${uomInv}.`);
      }

      // 4. GST Rate Mismatch
      if (poGst !== invGst) {
        lineDiscrepancy.issues.push(`GST rate mismatch: PO ${poGst}% vs Invoice ${invGst}%.`);
      }

      if (lineDiscrepancy.issues.length > 0) {
        discrepancies.push(lineDiscrepancy);
      }

      lineComparisons.push(lineDiscrepancy);
    }

    // 5. Grand Total Mismatch
    const invGrandTotal = Number(supplierInvoice.totalPaisa || computedInvTotal);
    const poGrandTotal = Number(purchaseOrder.totalPaisa || computedPoTotal);
    const totalDiff = Math.abs(invGrandTotal - poGrandTotal);

    const isTotalExceeded = totalDiff > (toleranceConfig.totalTolerancePaisa || 0);
    if (isTotalExceeded && discrepancies.length === 0) {
      discrepancies.push({
        itemId: 'HEADER_TOTAL',
        issues: [`Overall invoice total (₹${(invGrandTotal / 100).toFixed(2)}) differs from PO total (₹${(poGrandTotal / 100).toFixed(2)}).`],
      });
    }

    const matchStatus = discrepancies.length === 0 ? 'MATCHED' : 'VARIANCE_FLAGGED';

    let primaryVariance = null;
    let quantityVarianceBase = 0;
    let priceVariancePaisa = 0;
    let taxVariancePaisa = 0;

    for (const d of discrepancies) {
      if (d.qtyInvoiced !== d.qtyReceived) {
        quantityVarianceBase += Math.abs(d.qtyInvoiced - d.qtyReceived);
        if (!primaryVariance) primaryVariance = 'QUANTITY_VARIANCE';
      }
      if (Math.abs(d.invRate - d.poRate) > (toleranceConfig.rateTolerancePaisa || 0)) {
        priceVariancePaisa += Math.abs(d.invRate - d.poRate) * (d.qtyInvoiced || 1);
        if (!primaryVariance) primaryVariance = 'PRICE_VARIANCE';
      }
      if (d.poGst !== d.invGst) {
        taxVariancePaisa += Math.abs(d.taxAmount - computeLineTaxPaisa(d.taxableVal, d.poGst, isInterState));
        if (!primaryVariance) primaryVariance = 'TAX_VARIANCE';
      }
    }

    const canonicalStatus = matchStatus === 'MATCHED'
      ? 'MATCHED'
      : (primaryVariance || 'MANUAL_REVIEW_REQUIRED');

    return {
      matchStatus,
      canonicalStatus,
      reconciliationStatus: canonicalStatus,
      primaryVariance: matchStatus === 'MATCHED' ? null : (primaryVariance || 'MANUAL_REVIEW_REQUIRED'),
      isMatched: matchStatus === 'MATCHED',
      hasDiscrepancies: matchStatus !== 'MATCHED',
      hasVariance: matchStatus !== 'MATCHED',
      poGrandTotal,
      invGrandTotal,
      totalDifferencePaisa: invGrandTotal - poGrandTotal,
      quantityVarianceBase,
      priceVariancePaisa,
      taxVariancePaisa,
      discrepancies,
      lineVariances: lineComparisons.map((d) => ({
        itemId: d.itemId,
        quantityVariance: Math.abs((d.qtyInvoiced || 0) - (d.qtyReceived || 0)),
        priceVariancePaisa: Math.abs((d.invRate || 0) - (d.poRate || 0)),
        taxVariancePaisa: Math.abs((d.taxAmount || 0) - computeLineTaxPaisa(d.taxableVal || 0, d.poGst || 0, isInterState)),
        issues: d.issues,
      })),
      lineComparisons,
      matchedAt: new Date(),
    };
  }

  /**
   * Reconciles PO, multiple GRNs, and multiple supplier invoices.
   * Supports partial deliveries, many-to-one relationships, and missing document detection.
   * Returns canonical REC-05 states:
   * NOT_READY | MATCHED | QUANTITY_VARIANCE | PRICE_VARIANCE | TAX_VARIANCE | DOCUMENT_MISSING | MANUAL_REVIEW_REQUIRED
   */
  static reconcileProcurementDocuments({
    purchaseOrder,
    grnReceipts = [],
    supplierInvoices = [],
    toleranceConfig = { rateTolerancePaisa: 100, qtyTolerancePercent: 0, totalTolerancePaisa: 100 },
  }) {
    if (!purchaseOrder) {
      return {
        reconciliationStatus: 'NOT_READY',
        matchStatus: 'NOT_READY',
        message: 'No purchase order provided.',
      };
    }

    const grns = Array.isArray(grnReceipts) ? grnReceipts : (purchaseOrder.grnReceipts || []);
    const invoices = Array.isArray(supplierInvoices) ? supplierInvoices : (purchaseOrder.invoices || []);

    if (grns.length === 0 && invoices.length === 0) {
      return {
        reconciliationStatus: 'NOT_READY',
        matchStatus: 'NOT_READY',
        message: 'Awaiting supplier delivery and invoice submission.',
        grnCount: 0,
        invoiceCount: 0,
      };
    }

    if (grns.length === 0 && invoices.length > 0) {
      return {
        reconciliationStatus: 'DOCUMENT_MISSING',
        matchStatus: 'DOCUMENT_MISSING',
        missingDocumentType: 'GRN',
        message: 'Supplier invoice attached but Goods Receipt Note (GRN) missing.',
        grnCount: 0,
        invoiceCount: invoices.length,
      };
    }

    if (grns.length > 0 && invoices.length === 0) {
      return {
        reconciliationStatus: 'DOCUMENT_MISSING',
        matchStatus: 'DOCUMENT_MISSING',
        missingDocumentType: 'SUPPLIER_INVOICE',
        message: 'Goods receipt recorded but supplier invoice missing.',
        grnCount: grns.length,
        invoiceCount: 0,
      };
    }

    // Aggregate GRN accepted quantities across all GRNs for partial delivery support
    const aggregatedGrnItems = new Map();
    for (const grn of grns) {
      for (const item of (grn.items || grn.lineItems || [])) {
        const sku = String(item.itemId || item.sku).trim().toUpperCase();
        const existing = aggregatedGrnItems.get(sku) || { acceptedQty: 0, deliveredQty: 0, rejectedQty: 0 };
        const accepted = Number(item.acceptedQty !== undefined ? item.acceptedQty : (item.receivedQuantity !== undefined ? item.receivedQuantity : (item.acceptedQuantityBase !== undefined ? item.acceptedQuantityBase : (item.quantity || 0))));
        const delivered = Number(item.deliveredQty !== undefined ? item.deliveredQty : (item.orderedQuantity !== undefined ? item.orderedQuantity : accepted));
        const rejected = Number(item.rejectedQty || 0);
        existing.acceptedQty += accepted;
        existing.deliveredQty += delivered;
        existing.rejectedQty += rejected;
        aggregatedGrnItems.set(sku, existing);
      }
    }

    // Aggregate supplier invoice lines or values across all invoices
    const aggregatedInvLines = new Map();
    let aggregatedInvTotalPaisa = 0;

    for (const inv of invoices) {
      aggregatedInvTotalPaisa += Number(inv.totalPaisa || inv.invoiceTotalPaisa || inv.amountPaisa || 0);
      const lines = inv.lineItems || inv.items || [];
      if (Array.isArray(lines) && lines.length > 0) {
        for (const line of lines) {
          const sku = String(line.itemId || line.sku).trim().toUpperCase();
          const existing = aggregatedInvLines.get(sku) || {
            quantity: 0,
            totalPaisa: 0,
            unitPricePaisa: line.unitPricePaisa !== undefined ? Number(line.unitPricePaisa) : (line.unitCostPaisa !== undefined ? Number(line.unitCostPaisa) : 0),
            taxRatePercent: line.taxRatePercent !== undefined ? Number(line.taxRatePercent) : 0,
            taxAmountPaisa: Number(line.taxAmountPaisa || 0),
          };
          const lineQty = Number(line.quantity !== undefined ? line.quantity : (line.billedQuantity !== undefined ? line.billedQuantity : (line.invoicedQuantityBase || 0)));
          existing.quantity += lineQty;
          existing.totalPaisa += Number(line.lineTotal || line.totalLinePaisa || (lineQty * existing.unitPricePaisa));
          if (line.taxAmountPaisa) existing.taxAmountPaisa += Number(line.taxAmountPaisa);
          aggregatedInvLines.set(sku, existing);
        }
      }
    }

    // Synthesize combined GRN & combined invoice objects
    const combinedGrn = {
      items: Array.from(aggregatedGrnItems.entries()).map(([itemId, val]) => ({
        itemId,
        acceptedQty: val.acceptedQty,
        deliveredQty: val.deliveredQty,
        rejectedQty: val.rejectedQty,
      })),
    };

    const combinedInvoice = {
      totalPaisa: aggregatedInvTotalPaisa,
      lineItems: aggregatedInvLines.size > 0
        ? Array.from(aggregatedInvLines.entries()).map(([itemId, val]) => ({
            itemId,
            quantity: val.quantity,
            unitPricePaisa: val.unitPricePaisa,
            taxRatePercent: val.taxRatePercent,
            taxAmount: val.taxAmountPaisa,
          }))
        : (purchaseOrder.lineItems || []).map((l) => ({
            itemId: l.itemId,
            quantity: l.invoicedQuantityBase || l.receivedQuantityBase || l.orderedQuantityBase,
            unitPricePaisa: l.unitPricePaisa,
          })),
    };

    const matchResult = this.performMatch({
      purchaseOrder,
      grn: combinedGrn,
      supplierInvoice: combinedInvoice,
      toleranceConfig,
    });

    return {
      ...matchResult,
      matchStatus: matchResult.canonicalStatus || matchResult.matchStatus,
      rawMatchStatus: matchResult.matchStatus,
    };
  }

  /**
   * Distributes additional landed charges (freight, packaging, insurance) proportionally across line items (F147-F149).
   */
  static distributeLandedCost({
    lineItems = [],
    additionalCharges = {},
    distributionMethod = 'VALUE', // 'VALUE' or 'QUANTITY'
  } = {}) {
    const freightPaisa = Math.max(0, Number(additionalCharges.freightPaisa || 0));
    const insurancePaisa = Math.max(0, Number(additionalCharges.insurancePaisa || 0));
    const packagingPaisa = Math.max(0, Number(additionalCharges.packagingPaisa || 0));
    const otherPaisa = Math.max(0, Number(additionalCharges.otherPaisa || 0));
    const totalAdditionalPaisa = freightPaisa + insurancePaisa + packagingPaisa + otherPaisa;

    if (!Array.isArray(lineItems) || lineItems.length === 0) {
      return {
        totalAdditionalPaisa,
        lineItems: [],
      };
    }

    if (totalAdditionalPaisa === 0) {
      return {
        totalAdditionalPaisa: 0,
        distributionMethod,
        chargesBreakdown: { freightPaisa: 0, insurancePaisa: 0, packagingPaisa: 0, otherPaisa: 0 },
        lineItems: lineItems.map((item) => ({
          ...item,
          allocatedLandedPaisa: 0,
          landedTotalPaisa: Number(item.totalLinePaisa || (Number(item.orderedQuantityBase || item.quantity || 1) * Number(item.unitPricePaisa || 0))),
          landedUnitCostPaisa: Number(item.unitPricePaisa || 0),
        })),
      };
    }

    const totalValue = lineItems.reduce(
      (sum, item) => sum + Number(item.totalLinePaisa || (Number(item.orderedQuantityBase || item.quantity || 1) * Number(item.unitPricePaisa || 0))),
      0
    );
    const totalQty = lineItems.reduce(
      (sum, item) => sum + Number(item.orderedQuantityBase || item.quantity || 1),
      0
    );

    let runningAllocated = 0;
    const enrichedLines = lineItems.map((item, idx) => {
      const lineVal = Number(item.totalLinePaisa || (Number(item.orderedQuantityBase || item.quantity || 1) * Number(item.unitPricePaisa || 0)));
      const lineQty = Math.max(0.001, Number(item.orderedQuantityBase || item.quantity || 1));

      let allocatedShare = 0;
      if (idx === lineItems.length - 1) {
        allocatedShare = totalAdditionalPaisa - runningAllocated;
      } else {
        if (distributionMethod === 'QUANTITY' && totalQty > 0) {
          allocatedShare = Math.round((totalAdditionalPaisa * lineQty) / totalQty);
        } else if (totalValue > 0) {
          allocatedShare = Math.round((totalAdditionalPaisa * lineVal) / totalValue);
        } else {
          allocatedShare = Math.round(totalAdditionalPaisa / lineItems.length);
        }
        runningAllocated += allocatedShare;
      }

      const landedTotalPaisa = lineVal + allocatedShare;
      const landedUnitCostPaisa = Math.round(landedTotalPaisa / lineQty);

      return {
        ...item,
        allocatedLandedPaisa: allocatedShare,
        landedTotalPaisa,
        landedUnitCostPaisa,
      };
    });

    return {
      totalAdditionalPaisa,
      distributionMethod,
      chargesBreakdown: {
        freightPaisa,
        insurancePaisa,
        packagingPaisa,
        otherPaisa,
      },
      lineItems: enrichedLines,
    };
  }
}

module.exports = {
  ThreeWayMatchService,
  performMatch: ThreeWayMatchService.performMatch.bind(ThreeWayMatchService),
  reconcileProcurementDocuments: ThreeWayMatchService.reconcileProcurementDocuments.bind(ThreeWayMatchService),
};
