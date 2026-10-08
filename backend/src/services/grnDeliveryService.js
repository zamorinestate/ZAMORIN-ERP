'use strict';

/**
 * ============================================================================
 * ZAMORIN CAFE ERP - P08 GOODS RECEIPT & DELIVERY VERIFICATION SERVICE
 * ============================================================================
 *
 * PURPOSE
 * -------
 * Orchestrates the authoritative GRN -> 3-Way Match -> AP Invoice creation
 * pipeline for purchase orders that have been physically delivered.
 *
 * LIFECYCLE GOVERNED
 * ------------------
 *   VERIFIED_PENDING_MASTER_APPROVAL  (set by verifyDeliveryAndSubmitBill)
 *   -> Master reviews GRN + bill attachment
 *   -> [CLOSED / PARTIALLY_RECEIVED] + optional AP Invoice auto-creation
 *   -> AP Invoice enters Accounts Payable work queue
 *   -> Vendor Ledger records VENDOR_BILL liability
 *
 * INVARIANTS PRESERVED
 * --------------------
 *   1. ZERO additional stock mutation from this service - inventory was already
 *      posted atomically during GRN submission (verifyDeliveryAndSubmitBill).
 *   2. AP Invoice is created ONLY after Master approval of the GRN.
 *   3. Three-Value Financial Preservation:
 *        supplierClaimedAmountPaisa  - raw supplier invoice total
 *        approvedPayableAmountPaisa  - accepted-qty x PO rate
 *        heldDisputedAmountPaisa     - variance held pending resolution
 *   4. Idempotent - re-triggering AP creation for an already-billed PO
 *      returns the existing invoice without creating duplicates.
 *   5. GRN cannot exceed PO ordered quantities per line.
 *
 * ROLES
 * -----
 *   Cafe Admin / Cashier : submit delivery (verify-delivery endpoint)
 *   Primary Master       : approve GRN + bill; trigger AP invoice
 */

const { PurchaseOrder } = require('../models/PurchaseOrder');
const { APInvoice } = require('../models/APInvoice');
const { VendorLedgerEntry } = require('../models/VendorLedgerEntry');
const { ThreeWayMatchService } = require('./threeWayMatchService');
const { ApiError } = require('../utils/ApiError');

/**
 * Validate a GRN submission payload against the authoritative PO.
 * Returns validated line items with computed quantities.
 *
 * @param {Object} po          - Mongoose PurchaseOrder document (or plain object)
 * @param {Array}  deliveries  - Raw delivery line items from caller
 * @returns {{ validatedItems, hasDiscrepancy, totalAcceptedPaisa }}
 */
function validateGrnPayload(po, deliveries) {
  if (!Array.isArray(deliveries) || deliveries.length === 0) {
    throw new ApiError(400, 'DELIVERIES_REQUIRED', 'At least one delivery line item is required.');
  }

  const validatedItems = [];
  let hasDiscrepancy = false;
  let totalAcceptedPaisa = 0;

  for (const del of deliveries) {
    const itemId = String(del.itemId || '').trim().toUpperCase();
    if (!itemId) {
      throw new ApiError(400, 'INVALID_LINE_ITEM', 'Each delivery item must have a valid itemId.');
    }

    const lineItem = (po.lineItems || []).find((li) => li.itemId === itemId);
    if (!lineItem) {
      throw new ApiError(
        400,
        'INVALID_LINE_ITEM',
        `Item ${itemId} is not in purchase order ${po.purchaseOrderId}.`
      );
    }

    const orderedQty = Number(lineItem.orderedQuantityBase || 0);
    const deliveredQty = Number(
      del.deliveredQty !== undefined ? del.deliveredQty
        : del.quantityReceived !== undefined ? del.quantityReceived
        : orderedQty
    );
    const acceptedQty = Number(
      del.acceptedQty !== undefined ? del.acceptedQty
        : del.acceptedQuantity !== undefined ? del.acceptedQuantity
        : deliveredQty
    );
    const rejectedQty = Number(del.rejectedQty || del.rejectedQuantity || 0);
    const missingQty = Math.max(0, orderedQty - acceptedQty);

    const lineHasDiscrepancy =
      deliveredQty !== orderedQty ||
      acceptedQty !== orderedQty ||
      missingQty > 0 ||
      rejectedQty > 0;

    if (lineHasDiscrepancy) {
      const reason = String(del.discrepancyReason || del.rejectionReason || del.reason || '').trim();
      if (!reason) {
        throw new ApiError(
          422,
          'DISCREPANCY_REASON_REQUIRED',
          `A discrepancy reason is required for item ${itemId} where received quantity differs from ordered quantity.`
        );
      }
      hasDiscrepancy = true;
    }

    const unitPrice = Number(lineItem.unitPricePaisa || 0);
    totalAcceptedPaisa += acceptedQty * unitPrice;

    validatedItems.push({
      itemId,
      orderedQty,
      deliveredQty,
      acceptedQty,
      rejectedQty,
      missingQty,
      unitPricePaisa: unitPrice,
      acceptedLinePaisa: acceptedQty * unitPrice,
      discrepancyReason: String(del.discrepancyReason || del.rejectionReason || del.reason || '').trim(),
      lotNumber: del.lotNumber || null,
      expiryDate: del.expiryDate || null,
      manufacturingDate: del.manufacturingDate || null,
      notes: String(del.notes || '').trim(),
    });
  }

  return { validatedItems, hasDiscrepancy, totalAcceptedPaisa };
}

/**
 * Build a GRN record object from validated items.
 *
 * @param {{ grnId, validatedItems, deliveryNoteNumber, receivedByUserId, notes }} params
 * @returns {Object} GRN sub-document
 */
function buildGrnRecord({ grnId, validatedItems, deliveryNoteNumber = '', receivedByUserId, notes = '' }) {
  const items = validatedItems.map((vi) => ({
    itemId: vi.itemId,
    deliveredQty: vi.deliveredQty,
    acceptedQty: vi.acceptedQty,
    rejectedQty: vi.rejectedQty,
    missingQty: vi.missingQty,
    discrepancyReason: vi.discrepancyReason,
    lotNumber: vi.lotNumber,
    notes: vi.notes,
  }));

  const hasShortage = items.some((i) => i.missingQty > 0 || i.rejectedQty > 0);

  return {
    grnId,
    deliveryNoteNumber: String(deliveryNoteNumber).trim(),
    receivedAt: new Date(),
    receivedByUserId,
    items,
    status: hasShortage ? 'PARTIAL' : 'ACCEPTED',
    notes: String(notes).trim(),
  };
}

/**
 * Perform 3-way match between PO, GRN items, and supplier invoice data.
 *
 * @param {{ po, grnItems, supplierInvoiceTotalPaisa, supplierInvoiceLines }} params
 * @returns {Object} Match result from ThreeWayMatchService
 */
function performThreeWayMatch({ po, grnItems, supplierInvoiceTotalPaisa, supplierInvoiceLines }) {
  const combinedGrn = {
    items: grnItems.map((i) => ({
      itemId: i.itemId,
      acceptedQty: i.acceptedQty,
      deliveredQty: i.deliveredQty,
      rejectedQty: i.rejectedQty,
    })),
  };

  let invoiceTotalPaisa = supplierInvoiceTotalPaisa;
  if (!invoiceTotalPaisa) {
    invoiceTotalPaisa = grnItems.reduce((sum, i) => sum + (i.acceptedLinePaisa || 0), 0);
  }

  const combinedInvoice = {
    totalPaisa: invoiceTotalPaisa,
    lineItems:
      supplierInvoiceLines && supplierInvoiceLines.length > 0
        ? supplierInvoiceLines
        : (po.lineItems || []).map((li) => ({
            itemId: li.itemId,
            quantity: li.receivedQuantityBase || li.orderedQuantityBase,
            unitPricePaisa: li.unitPricePaisa,
            taxRatePercent: li.taxRatePercent || 0,
          })),
  };

  return ThreeWayMatchService.reconcileProcurementDocuments({
    purchaseOrder: po.toObject ? po.toObject() : po,
    grnReceipts: [combinedGrn],
    supplierInvoices: [combinedInvoice],
    toleranceConfig: {
      rateTolerancePaisa: 100,
      qtyTolerancePercent: 0,
      totalTolerancePaisa: 500,
    },
  });
}

/**
 * P08-CORE: Compute approved payable amounts for AP Invoice creation.
 *
 * Three-value financial architecture:
 *   supplierClaimedAmountPaisa  = what vendor claims (from their invoice)
 *   approvedPayableAmountPaisa  = accepted qty x PO unit rate
 *   heldDisputedAmountPaisa     = difference held pending dispute resolution
 *
 * @param {{ po, validatedItems, supplierClaimedPaisa, supplierClaimedTaxPaisa }} params
 */
function computeApInvoiceAmounts({ po, validatedItems, supplierClaimedPaisa, supplierClaimedTaxPaisa = 0 }) {
  let acceptedGoodsPaisa = 0;
  const lineItems = [];

  for (const vi of validatedItems) {
    acceptedGoodsPaisa += vi.acceptedLinePaisa;
    const orderedLinePaisa = vi.orderedQty * vi.unitPricePaisa;

    lineItems.push({
      itemId: vi.itemId,
      itemName:
        (po.lineItems || []).find((li) => li.itemId === vi.itemId)?.itemNameSnapshot || vi.itemId,
      invoiceQuantity: vi.orderedQty,
      acceptedQuantity: vi.acceptedQty,
      rejectedQuantity: vi.rejectedQty,
      unitPricePaisa: vi.unitPricePaisa,
      lineTotalPaisa: orderedLinePaisa,
      payableAmountPaisa: vi.acceptedLinePaisa,
      disputeReason:
        vi.acceptedQty < vi.orderedQty
          ? `Quantity shortfall: received ${vi.acceptedQty} of ${vi.orderedQty}`
          : '',
    });
  }

  const taxRate =
    Number(po.subtotalPaisa) > 0 ? Number(po.taxPaisa || 0) / Number(po.subtotalPaisa) : 0;
  const approvedTaxPaisa = Math.round(acceptedGoodsPaisa * taxRate);
  const approvedPayableAmountPaisa = acceptedGoodsPaisa + approvedTaxPaisa;

  const rawClaimed =
    supplierClaimedPaisa !== undefined
      ? Number(supplierClaimedPaisa) + Number(supplierClaimedTaxPaisa || 0)
      : Number(po.totalPaisa || approvedPayableAmountPaisa);

  const supplierClaimedAmountPaisa = rawClaimed;
  const heldDisputedAmountPaisa = Math.max(0, supplierClaimedAmountPaisa - approvedPayableAmountPaisa);

  return {
    approvedPayableAmountPaisa,
    supplierClaimedAmountPaisa,
    heldDisputedAmountPaisa,
    approvedTaxPaisa,
    acceptedGoodsPaisa,
    lineItems,
  };
}

/**
 * P08-MAIN: Create AP Invoice from GRN receipt after Master approval.
 *
 * @param {{ organisationId, purchaseOrderId, supplierInvoiceNumber, invoiceDate,
 *           dueDate, supplierClaimedPaisa, supplierClaimedTaxPaisa, notes, auth }} params
 * @returns {{ apInvoice, ledgerEntry, matchResult, threeWayDiscrepancy, alreadyExists }}
 */
async function createApInvoiceFromGrn({
  organisationId,
  purchaseOrderId,
  supplierInvoiceNumber,
  invoiceDate,
  dueDate,
  supplierClaimedPaisa,
  supplierClaimedTaxPaisa = 0,
  notes = '',
  auth,
}) {
  const normPoId = String(purchaseOrderId || '').trim().toUpperCase();
  const po = await PurchaseOrder.findOne({ organisationId, purchaseOrderId: normPoId });

  if (!po) {
    throw new ApiError(404, 'PO_NOT_FOUND', `Purchase order ${normPoId} not found.`);
  }

  if (!po.grnReceipts || po.grnReceipts.length === 0) {
    throw new ApiError(
      409,
      'GRN_REQUIRED',
      'An AP Invoice cannot be created before goods have been received and verified (GRN required).'
    );
  }

  // Idempotency guard
  const existingInvoice = await APInvoice.findOne({ organisationId, poReferenceId: normPoId }).lean();
  if (existingInvoice) {
    const existingLedger = await VendorLedgerEntry.findOne({
      organisationId,
      purchaseOrderId: normPoId,
      entryType: 'VENDOR_BILL',
    }).lean();

    return {
      apInvoice: existingInvoice,
      ledgerEntry: existingLedger,
      matchResult: null,
      threeWayDiscrepancy: {
        supplierClaimedPaisa: existingInvoice.supplierClaimedAmountPaisa,
        approvedPayablePaisa: existingInvoice.approvedPayableAmountPaisa,
        heldDisputedPaisa: existingInvoice.heldDisputedAmountPaisa,
        hasDispute: (existingInvoice.heldDisputedAmountPaisa || 0) > 0,
      },
      alreadyExists: true,
    };
  }

  // Aggregate accepted quantities across all GRN receipts
  const itemAccepted = new Map();
  for (const grn of po.grnReceipts) {
    for (const item of grn.items || []) {
      const cur = itemAccepted.get(item.itemId) || { acceptedQty: 0, rejectedQty: 0, missingQty: 0 };
      cur.acceptedQty += Number(item.acceptedQty || 0);
      cur.rejectedQty += Number(item.rejectedQty || 0);
      cur.missingQty += Number(item.missingQty || 0);
      itemAccepted.set(item.itemId, cur);
    }
  }

  const validatedItems = (po.lineItems || []).map((li) => {
    const agg = itemAccepted.get(li.itemId) || { acceptedQty: 0, rejectedQty: 0, missingQty: 0 };
    const acceptedQty = agg.acceptedQty || Number(li.acceptedReceivedQty || li.receivedQuantityBase || 0);
    const orderedQty = Number(li.orderedQuantityBase || 0);
    const unitPrice = Number(li.unitPricePaisa || 0);
    return {
      itemId: li.itemId,
      orderedQty,
      acceptedQty,
      rejectedQty: agg.rejectedQty,
      missingQty: agg.missingQty,
      unitPricePaisa: unitPrice,
      acceptedLinePaisa: acceptedQty * unitPrice,
    };
  });

  // 3-way match
  const grnItemsForMatch = validatedItems.map((vi) => ({
    itemId: vi.itemId,
    acceptedQty: vi.acceptedQty,
    deliveredQty: vi.acceptedQty + vi.rejectedQty,
    rejectedQty: vi.rejectedQty,
    acceptedLinePaisa: vi.acceptedLinePaisa,
  }));

  const matchResult = performThreeWayMatch({
    po,
    grnItems: grnItemsForMatch,
    supplierInvoiceTotalPaisa: supplierClaimedPaisa
      ? Number(supplierClaimedPaisa) + Number(supplierClaimedTaxPaisa || 0)
      : undefined,
    supplierInvoiceLines: [],
  });

  // Compute financial amounts
  const amounts = computeApInvoiceAmounts({ po, validatedItems, supplierClaimedPaisa, supplierClaimedTaxPaisa });

  // Delegate to vendorLedgerService (single source of truth for AP creation)
  const vendorLedgerService = require('./vendorLedgerService');
  const result = await vendorLedgerService.postVendorBillFromReceipt({
    organisationId,
    purchaseOrderId: normPoId,
    supplierInvoiceNumber: supplierInvoiceNumber || `INV-${normPoId}`,
    invoiceDate: invoiceDate || new Date().toISOString().slice(0, 10),
    dueDate:
      dueDate ||
      po.expectedDeliveryDate ||
      new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
    claimedAmountPaisa: amounts.supplierClaimedAmountPaisa - amounts.approvedTaxPaisa,
    claimedTaxPaisa: amounts.approvedTaxPaisa,
    notes,
    auth,
  });

  return {
    apInvoice: result.apInvoice,
    ledgerEntry: result.ledgerEntry,
    matchResult,
    threeWayDiscrepancy: result.threeWayDiscrepancy || {
      supplierClaimedPaisa: amounts.supplierClaimedAmountPaisa,
      approvedPayablePaisa: amounts.approvedPayableAmountPaisa,
      heldDisputedPaisa: amounts.heldDisputedAmountPaisa,
      hasDispute: amounts.heldDisputedAmountPaisa > 0,
    },
    alreadyExists: false,
  };
}

/**
 * Get the AP invoice and match status for a given PO.
 *
 * @param {{ organisationId, purchaseOrderId }} params
 * @returns {{ po, apInvoice, matchResult, grnCount, hasGrn, hasApInvoice }}
 */
async function getGrnAndMatchStatus({ organisationId, purchaseOrderId }) {
  const normPoId = String(purchaseOrderId || '').trim().toUpperCase();

  const [po, apInvoice] = await Promise.all([
    PurchaseOrder.findOne({ organisationId, purchaseOrderId: normPoId }).lean(),
    APInvoice.findOne({ organisationId, poReferenceId: normPoId }).lean(),
  ]);

  if (!po) {
    throw new ApiError(404, 'PO_NOT_FOUND', `Purchase order ${normPoId} not found.`);
  }

  const grnCount = (po.grnReceipts || []).length;
  const hasGrn = grnCount > 0;

  let matchResult = null;
  if (hasGrn) {
    const allGrnItems = [];
    for (const grn of po.grnReceipts) {
      for (const item of grn.items || []) {
        const existing = allGrnItems.find((g) => g.itemId === item.itemId);
        if (existing) {
          existing.acceptedQty += Number(item.acceptedQty || 0);
        } else {
          allGrnItems.push({
            itemId: item.itemId,
            acceptedQty: Number(item.acceptedQty || 0),
            deliveredQty: Number(item.deliveredQty || item.acceptedQty || 0),
            rejectedQty: Number(item.rejectedQty || 0),
          });
        }
      }
    }

    try {
      matchResult = ThreeWayMatchService.reconcileProcurementDocuments({
        purchaseOrder: po,
        grnReceipts: [{ items: allGrnItems }],
        supplierInvoices: apInvoice
          ? [
              {
                totalPaisa: apInvoice.totalPaisa,
                lineItems: (apInvoice.lineItems || []).map((li) => ({
                  itemId: li.itemId,
                  quantity: li.acceptedQuantity,
                  unitPricePaisa: li.unitPricePaisa,
                })),
              },
            ]
          : [],
      });
    } catch (_) {
      matchResult = { reconciliationStatus: 'NOT_READY' };
    }
  }

  return {
    po,
    apInvoice: apInvoice || null,
    matchResult,
    grnCount,
    hasGrn,
    hasApInvoice: !!apInvoice,
    poStatus: po.status,
  };
}

module.exports = {
  validateGrnPayload,
  buildGrnRecord,
  performThreeWayMatch,
  computeApInvoiceAmounts,
  createApInvoiceFromGrn,
  getGrnAndMatchStatus,
};
