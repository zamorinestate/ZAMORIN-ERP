'use strict';

/**
 * VENDOR LEDGER SERVICE
 *
 * Core accounting & subledger management for Zamorin Café ERP:
 * - Receipt-based Accounts Payable bill generation
 * - 3-value financial preservation (Supplier Claimed, Approved Payable, Held/Disputed)
 * - Vendor payments, partial payments & invoice-level allocations
 * - Advances & credit note management
 * - Payment reversals and refunds
 * - Permanent immutable Vendor Ledger with running balances
 * - Accounts Payable aging and GST 180-day monitoring
 */

const { VendorLedgerEntry } = require('../models/VendorLedgerEntry');
const { APInvoice } = require('../models/APInvoice');
const { Vendor } = require('../models/Vendor');
const { PurchaseOrder } = require('../models/PurchaseOrder');
const { SequenceCounter } = require('../models/SequenceCounter');
const { CashTransaction } = require('../models/CashTransaction');
const { ApiError } = require('../utils/ApiError');
const { executeTransactionWithRetry } = require('../utils/transactionHelper');
const { recordRequestAudit } = require('./auditService');

function normalizeId(value) {
  return typeof value === 'string' ? value.trim().toUpperCase() : '';
}

function getIstBusinessDate(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

// ── Transaction plumbing ──────────────────────────────────────────────────────
// executeTransactionWithRetry passes `session = null` on deployments without
// transaction support (standalone mongod / mongodb-memory-server), in which case
// every helper below degrades to exactly the plain, non-session behaviour.

/** Attach the active transaction session to a query when one exists. */
function scoped(query, session) {
  return session ? query.session(session) : query;
}

/** Save options carrying the active session (empty object when none). */
function saveOptions(session) {
  return session ? { session } : {};
}

/** Model options carrying the active session (undefined when none). */
function modelOptions(session) {
  return session ? { session } : {};
}

/**
 * Atomic multi-write driver for the vendor subledger.
 *
 * With transaction support, every write the body performs commits or aborts as
 * one unit. Without it, the body runs plainly and any write that fails later in
 * the same attempt is undone by the compensating actions the body registered —
 * so a half-posted payment, bill or reversal can never be left behind.
 *
 * `bodyFn(session, compensations)` must push an undo action onto
 * `compensations` immediately after each successful write.
 */
async function runLedgerWrites(bodyFn) {
  return await executeTransactionWithRetry(async (session) => {
    const compensations = [];
    try {
      return await bodyFn(session, compensations);
    } catch (err) {
      if (!session) {
        for (const undo of compensations.reverse()) {
          try {
            await undo();
          } catch (_) {
            // Best effort: the original error is the one worth surfacing.
          }
        }
      }
      throw err;
    }
  });
}

// APInvoice money fields mutated by payment / advance / credit / hold flows.
const AP_INVOICE_MONEY_FIELDS = [
  'paidPaisa',
  'amountPaidPaisa',
  'appliedAdvancePaisa',
  'appliedCreditPaisa',
  'outstandingPayableAmountPaisa',
  'outstandingPaisa',
  'outstandingBalancePaisa',
  'paymentStatus',
  'heldDisputedAmountPaisa',
];

/** Snapshot the mutable money fields of an invoice before touching it. */
function snapshotInvoice(invoice) {
  const snapshot = {};
  for (const field of AP_INVOICE_MONEY_FIELDS) snapshot[field] = invoice[field];
  snapshot.paymentHistoryLength = Array.isArray(invoice.paymentHistory) ? invoice.paymentHistory.length : 0;
  return snapshot;
}

/** Undo action restoring a snapshotted invoice (non-transactional fallback only). */
function compensateInvoice(invoice, snapshot) {
  return async () => {
    const fresh = await APInvoice.findOne({ _id: invoice._id });
    if (!fresh) return;
    for (const field of AP_INVOICE_MONEY_FIELDS) {
      if (snapshot[field] !== undefined) fresh[field] = snapshot[field];
    }
    if (Array.isArray(fresh.paymentHistory) && fresh.paymentHistory.length > snapshot.paymentHistoryLength) {
      fresh.paymentHistory.splice(snapshot.paymentHistoryLength);
    }
    await fresh.save();
  };
}

/** Undo action removing a freshly appended (and not yet committed) ledger entry. */
function compensateLedgerEntry(ledgerEntry) {
  return async () => {
    await VendorLedgerEntry.collection.deleteOne({ _id: ledgerEntry._id });
  };
}

/**
 * Get current running balance for a vendor.
 */
async function getVendorRunningBalance(organisationId, vendorId, session = null) {
  const lastEntry = await scoped(
    VendorLedgerEntry.findOne({
      organisationId,
      vendorId: normalizeId(vendorId),
    }).sort({ entryTimestamp: -1, _id: -1 }),
    session
  ).lean();

  return lastEntry ? Number(lastEntry.runningBalancePaisa || 0) : 0;
}

/**
 * Recompute and update Vendor financialSummary rollup.
 * Pass the active transaction session so the rollup commits with the writes
 * that triggered it.
 */
async function syncVendorFinancialSummary(organisationId, vendorId, session = null) {
  const normVendorId = normalizeId(vendorId);

  const [orders, invoices, ledgerEntries] = await Promise.all([
    scoped(PurchaseOrder.find({ organisationId, vendorId: normVendorId }), session).lean(),
    scoped(APInvoice.find({ organisationId, vendorId: normVendorId }), session).lean(),
    scoped(VendorLedgerEntry.find({ organisationId, vendorId: normVendorId, isReversed: false }), session).lean(),
  ]);

  let lifetimePoOrderedValuePaisa = 0;
  let lifetimeAcceptedReceivedValuePaisa = 0;

  for (const po of orders) {
    lifetimePoOrderedValuePaisa += Number(po.totalPaisa || 0);
    for (const li of po.lineItems || []) {
      const acceptedQty = Number(li.acceptedReceivedQty || li.receivedQuantityBase || 0);
      const unitPrice = Number(li.unitPricePaisa || 0);
      lifetimeAcceptedReceivedValuePaisa += acceptedQty * unitPrice;
    }
  }

  let lifetimeVendorInvoiceValuePaisa = 0;
  let lifetimeApprovedPayablePaisa = 0;
  let currentGrossPayablesPaisa = 0;
  let currentPaymentHoldsPaisa = 0;
  let currentApprovedPayablePaisa = 0;
  let currentOutstandingPayablePaisa = 0;
  let overdueAmountPaisa = 0;
  const today = getIstBusinessDate();

  for (const inv of invoices) {
    const claimed = Number(inv.supplierClaimedAmountPaisa || inv.totalPaisa || 0);
    const approved = Number(inv.approvedPayableAmountPaisa || inv.totalPaisa || 0);
    const held = Number(inv.heldDisputedAmountPaisa || 0);
    const outstanding = Number(inv.outstandingPayableAmountPaisa !== undefined ? inv.outstandingPayableAmountPaisa : (inv.outstandingPaisa || 0));

    lifetimeVendorInvoiceValuePaisa += claimed;
    lifetimeApprovedPayablePaisa += approved;
    currentGrossPayablesPaisa += claimed;
    currentPaymentHoldsPaisa += held;
    currentApprovedPayablePaisa += approved;
    currentOutstandingPayablePaisa += outstanding;

    if (outstanding > 0 && inv.dueDate && inv.dueDate < today) {
      overdueAmountPaisa += outstanding;
    }
  }

  let lifetimePaidPaisa = 0;
  let availableVendorAdvancePaisa = 0;
  let availableVendorCreditPaisa = 0;
  let lastPaymentDate = null;
  let lastPaymentAmountPaisa = 0;

  for (const entry of ledgerEntries) {
    if (entry.isReversed) {
      continue;
    }
    if (entry.entryType === 'PAYMENT' || entry.entryType === 'PARTIAL_PAYMENT') {
      lifetimePaidPaisa += Number(entry.debitPaisa || 0);
      if (!lastPaymentDate || new Date(entry.entryTimestamp) > new Date(lastPaymentDate)) {
        lastPaymentDate = entry.entryTimestamp;
        lastPaymentAmountPaisa = Number(entry.debitPaisa || 0);
      }
    } else if (entry.entryType === 'ADVANCE_PAYMENT') {
      availableVendorAdvancePaisa += Number(entry.debitPaisa || 0);
    } else if (entry.entryType === 'ADVANCE_APPLIED') {
      const appliedAmt = Number(entry.paidPaisa || (entry.metadata && entry.metadata.appliedPaisa) || entry.creditPaisa || entry.debitPaisa || 0);
      availableVendorAdvancePaisa = Math.max(0, availableVendorAdvancePaisa - appliedAmt);
    }
  }

  const financialSummary = {
    lifetimePoOrderedValuePaisa,
    lifetimeAcceptedReceivedValuePaisa,
    lifetimeVendorInvoiceValuePaisa,
    lifetimeApprovedPayablePaisa,
    lifetimePaidPaisa,
    currentGrossPayablesPaisa,
    currentPaymentHoldsPaisa,
    currentApprovedPayablePaisa,
    currentOutstandingPayablePaisa,
    availableVendorAdvancePaisa,
    availableVendorCreditPaisa,
    overdueAmountPaisa,
    lastPaymentDate,
    lastPaymentAmountPaisa,
    lastEvaluatedAt: new Date(),
    totalInvoicedPaise: lifetimeApprovedPayablePaisa,
    totalPaidPaise: lifetimePaidPaisa,
    outstandingBalancePaise: currentOutstandingPayablePaisa,
  };

  await Vendor.findOneAndUpdate(
    { organisationId, vendorId: normVendorId },
    { $set: { financialSummary } },
    modelOptions(session)
  );

  return financialSummary;
}

/**
 * 1. Post Vendor Bill from PO Dock Receipt & Three-Way Match Handoff.
 * Preserves Supplier Claimed Amount independently from Approved Payable Amount.
 * Basis of merchandise payable = acceptedReceivedQty * unitPricePaisa.
 */
async function postVendorBillFromReceipt({
  organisationId,
  purchaseOrderId,
  supplierInvoiceNumber,
  invoiceDate,
  dueDate,
  claimedAmountPaisa,
  claimedTaxPaisa = 0,
  notes = '',
  auth,
}) {
  const po = await PurchaseOrder.findOne({
    organisationId,
    purchaseOrderId: normalizeId(purchaseOrderId),
  });

  if (!po) {
    throw new ApiError(404, 'PO_NOT_FOUND', `Purchase order ${purchaseOrderId} not found.`);
  }

  const vendorId = normalizeId(po.vendorId);
  const vendor = await Vendor.findOne({ organisationId, vendorId }).lean();
  const businessDate = getIstBusinessDate();
  const datePart = businessDate.replace(/-/g, '');

  // Calculate receipt-based merchandise payable basis: ONLY accepted received quantities
  let acceptedGoodsPaisa = 0;
  let lineItemsMatch = [];

  for (const li of po.lineItems || []) {
    const acceptedQty = Number(li.acceptedReceivedQty || li.receivedQuantityBase || 0);
    const orderedQty = Number(li.orderedQuantityBase || 0);
    const unitPrice = Number(li.unitPricePaisa || 0);
    const payableLinePaisa = acceptedQty * unitPrice;
    const orderedLinePaisa = orderedQty * unitPrice;

    acceptedGoodsPaisa += payableLinePaisa;

    lineItemsMatch.push({
      itemId: li.itemId,
      itemName: li.itemNameSnapshot || li.itemId,
      invoiceQuantity: orderedQty, // supplier invoiced as ordered
      acceptedQuantity: acceptedQty,
      rejectedQuantity: Number(li.rejectedQty || 0),
      unitPricePaisa: unitPrice,
      lineTotalPaisa: orderedLinePaisa,
      payableAmountPaisa: payableLinePaisa,
      disputeReason: acceptedQty < orderedQty ? `Quantity shortfall: received ${acceptedQty} of ${orderedQty}` : '',
    });
  }

  // Calculate tax proportion
  const taxRate = po.subtotalPaisa > 0 ? (po.taxPaisa / po.subtotalPaisa) : 0;
  const approvedTaxPaisa = Math.round(acceptedGoodsPaisa * taxRate);
  const approvedPayableAmountPaisa = acceptedGoodsPaisa + approvedTaxPaisa;

  const rawClaimedTotal = claimedAmountPaisa !== undefined
    ? Number(claimedAmountPaisa) + Number(claimedTaxPaisa || 0)
    : Number(po.totalPaisa || 0);

  const supplierClaimedAmountPaisa = rawClaimedTotal;
  const heldDisputedAmountPaisa = Math.max(0, supplierClaimedAmountPaisa - approvedPayableAmountPaisa);

  // Generate stable document ids outside the write attempt so a transient
  // transaction retry can never burn a duplicate id or double-increment.
  const apInvoiceSeq = await SequenceCounter.generateId({
    organisationId,
    sequenceKey: `AP_INV_${datePart}`,
    prefix: `AP-${datePart}`,
    minimumDigits: 4,
  });

  const ledgerSeq = await SequenceCounter.generateId({
    organisationId,
    sequenceKey: `VLE_${datePart}`,
    prefix: `VLE-${datePart}`,
    minimumDigits: 5,
  });

  const normInvoiceNum = normalizeId(supplierInvoiceNumber || `INV-${po.purchaseOrderId}`);
  const finalDueDate = dueDate || po.expectedDeliveryDate || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const grnIdList = (po.grnReceipts || []).map((g) => g.grnId).filter(Boolean);

  const holds = [];
  if (heldDisputedAmountPaisa > 0) {
    holds.push({
      holdCode: 'QUANTITY_VARIANCE',
      reason: `Disputed shortfall of ₹${(heldDisputedAmountPaisa / 100).toFixed(2)} between supplier claimed invoice and accepted dock receipt.`,
      placedAt: new Date(),
      placedBy: auth.userId,
    });
  }

  // AP invoice + VENDOR_BILL ledger entry + summary rollup post as one unit.
  return await runLedgerWrites(async (session, compensations) => {
    const apInvoice = new APInvoice({
      organisationId,
      invoiceId: apInvoiceSeq,
      vendorId,
      vendorName: vendor ? vendor.name : (po.vendorNameSnapshot || vendorId),
      supplierInvoiceNumber: normInvoiceNum,
      rawSupplierInvoiceNumber: supplierInvoiceNumber || normInvoiceNum,
      invoiceDate: invoiceDate || businessDate,
      dueDate: finalDueDate,
      amountPaisa: acceptedGoodsPaisa,
      taxPaisa: approvedTaxPaisa,
      totalPaisa: approvedPayableAmountPaisa,
      supplierClaimedAmountPaisa,
      approvedPayableAmountPaisa,
      heldDisputedAmountPaisa,
      paidPaisa: 0,
      outstandingPaisa: approvedPayableAmountPaisa,
      outstandingPayableAmountPaisa: approvedPayableAmountPaisa,
      cafeId: po.cafeId,
      poReferenceId: po.purchaseOrderId,
      grnIds: grnIdList,
      lineItems: lineItemsMatch,
      validationStatus: 'VALIDATED',
      approvalStatus: 'APPROVED',
      accountingStatus: 'POSTED',
      paymentStatus: heldDisputedAmountPaisa > 0 ? 'ON_HOLD' : 'DUE',
      holds,
    });

    await apInvoice.save(saveOptions(session));
    compensations.push(async () => {
      await APInvoice.deleteOne({ _id: apInvoice._id });
    });

    // Post VENDOR_BILL into VendorLedgerEntry
    const currentBal = await getVendorRunningBalance(organisationId, vendorId, session);
    const newBal = currentBal + approvedPayableAmountPaisa;

    const ledgerEntry = new VendorLedgerEntry({
      organisationId,
      ledgerEntryId: ledgerSeq,
      vendorId,
      vendorNameSnapshot: vendor ? vendor.name : vendorId,
      cafeId: po.cafeId,
      entryDate: businessDate,
      entryTimestamp: new Date(),
      entryType: 'VENDOR_BILL',
      referenceType: 'AP_INVOICE',
      referenceId: apInvoice.invoiceId,
      purchaseOrderId: po.purchaseOrderId,
      grnId: grnIdList[0] || null,
      supplierInvoiceNumber: normInvoiceNum,
      debitPaisa: 0,
      creditPaisa: approvedPayableAmountPaisa, // Liability increases
      heldPaisa: heldDisputedAmountPaisa,
      paidPaisa: 0,
      runningBalancePaisa: newBal,
      notes: `Vendor Bill for PO ${po.purchaseOrderId} against ${grnIdList.length} GRN(s). ${notes}`.trim(),
      createdByUserId: auth.userId,
    });

    await ledgerEntry.save(saveOptions(session));
    compensations.push(compensateLedgerEntry(ledgerEntry));

    // Sync vendor financial rollups
    await syncVendorFinancialSummary(organisationId, vendorId, session);

    return {
      apInvoice,
      ledgerEntry,
      threeWayDiscrepancy: {
        supplierClaimedPaisa: supplierClaimedAmountPaisa,
        approvedPayablePaisa: approvedPayableAmountPaisa,
        heldDisputedPaisa: heldDisputedAmountPaisa,
        hasDispute: heldDisputedAmountPaisa > 0,
      },
    };
  });
}

/**
 * 2. Record Full or Partial Vendor Payment.
 * Allocates payment to specified open AP invoices.
 */
async function recordVendorPayment({
  organisationId,
  vendorId,
  paymentAmountPaisa,
  amountPaise,
  allocations = [],
  paymentMethod = 'BANK_TRANSFER',
  reference = '',
  referenceNumber = '',
  bankAccountId = 'DEFAULT_BANK',
  notes = '',
  idempotencyKey = null,
  userId = null,
  auth,
}) {
  const normVendorId = normalizeId(vendorId);
  const payAmount = Number(paymentAmountPaisa !== undefined ? paymentAmountPaisa : amountPaise);
  const effectiveRef = referenceNumber || reference || '';
  const effectiveAuth = auth || { organisationId, userId: userId || 'MASTER_USER', role: 'MASTER' };
  const effectiveIdem = idempotencyKey || effectiveRef || null;

  if (!Number.isFinite(payAmount) || payAmount <= 0) {
    throw new ApiError(400, 'INVALID_AMOUNT', 'Payment amount must be greater than zero.');
  }

  // Fast-path idempotency replay. The authoritative re-check runs inside the
  // write attempt so a concurrent duplicate can never post twice.
  if (effectiveIdem) {
    const existing = await VendorLedgerEntry.findOne({
      organisationId,
      $or: [
        { 'metadata.idempotencyKey': effectiveIdem },
        { referenceNumber: effectiveIdem },
        { referenceId: effectiveIdem },
      ],
    }).lean();

    if (existing) {
      return {
        paymentId: existing.paymentId || existing.referenceId,
        isIdempotentReplay: true,
        ledgerEntry: existing,
      };
    }
  }

  const businessDate = getIstBusinessDate();
  const datePart = businessDate.replace(/-/g, '');

  // Pre-flight guard on a plain read so a doomed payment never consumes a
  // sequence id. The same guard is re-checked inside the write attempt below.
  const precheckInvoices = await APInvoice.find({
    organisationId,
    vendorId: normVendorId,
    outstandingPayableAmountPaisa: { $gt: 0 },
  }).sort({ dueDate: 1 });

  const precheckOutstanding = precheckInvoices.reduce((s, i) => s + (i.outstandingPayableAmountPaisa || 0), 0);

  if (payAmount > precheckOutstanding) {
    throw new ApiError(
      400,
      'PAYMENT_EXCEEDS_APPROVED_PAYABLE',
      `Payment amount ₹${(payAmount / 100).toFixed(2)} exceeds total approved outstanding payable ₹${(precheckOutstanding / 100).toFixed(2)}. Use Vendor Advance for overpayments.`
    );
  }

  // Stable ids generated once, outside the attempt: a transient retry reuses
  // them instead of burning duplicates or double-incrementing counters.
  const paymentSeq = await SequenceCounter.generateId({
    organisationId,
    sequenceKey: `VPAY_${datePart}`,
    prefix: `VPAY-${datePart}`,
    minimumDigits: 4,
  });

  const ledgerSeq = await SequenceCounter.generateId({
    organisationId,
    sequenceKey: `VLE_${datePart}`,
    prefix: `VLE-${datePart}`,
    minimumDigits: 5,
  });

  const cashSeq = await SequenceCounter.generateId({
    organisationId,
    sequenceKey: `CASH_TRANSACTION_${datePart}`,
    prefix: `CT-${datePart}`,
    minimumDigits: 4,
  });

  const result = await runLedgerWrites(async (session, compensations) => {
    // Authoritative idempotency re-check with the transaction session attached.
    if (effectiveIdem) {
      const existing = await scoped(
        VendorLedgerEntry.findOne({
          organisationId,
          $or: [
            { 'metadata.idempotencyKey': effectiveIdem },
            { referenceNumber: effectiveIdem },
            { referenceId: effectiveIdem },
          ],
        }),
        session
      ).lean();

      if (existing) {
        return {
          paymentId: existing.paymentId || existing.referenceId,
          isIdempotentReplay: true,
          ledgerEntry: existing,
        };
      }
    }

    // Fresh read of open invoices inside the attempt (never a stale snapshot).
    const openInvoices = await scoped(
      APInvoice.find({
        organisationId,
        vendorId: normVendorId,
        outstandingPayableAmountPaisa: { $gt: 0 },
      }).sort({ dueDate: 1 }),
      session
    );

    const totalOutstanding = openInvoices.reduce((s, i) => s + (i.outstandingPayableAmountPaisa || 0), 0);

    if (payAmount > totalOutstanding) {
      throw new ApiError(
        400,
        'PAYMENT_EXCEEDS_APPROVED_PAYABLE',
        `Payment amount ₹${(payAmount / 100).toFixed(2)} exceeds total approved outstanding payable ₹${(totalOutstanding / 100).toFixed(2)}. Use Vendor Advance for overpayments.`
      );
    }

    // Distribute payment across invoices
    let remainingToDistribute = payAmount;
    const updatedInvoices = [];

    for (const inv of openInvoices) {
      if (remainingToDistribute <= 0) break;

      // Check if specific allocation specified
      const allocSpec = allocations.find((a) => a.invoiceId === inv.invoiceId);
      let allocPaisa = 0;

      if (allocSpec) {
        const specifiedAmt = Number(allocSpec.amountPaisa !== undefined ? allocSpec.amountPaisa : allocSpec.amountPaise);
        allocPaisa = Math.min(specifiedAmt, inv.outstandingPayableAmountPaisa, remainingToDistribute);
      } else if (allocations.length === 0) {
        // Automatic allocation: oldest due first
        allocPaisa = Math.min(inv.outstandingPayableAmountPaisa, remainingToDistribute);
      }

      if (allocPaisa > 0) {
        const invoiceSnapshot = snapshotInvoice(inv);

        inv.paidPaisa = (inv.paidPaisa || 0) + allocPaisa;
        inv.amountPaidPaisa = inv.paidPaisa;
        inv.outstandingPayableAmountPaisa = Math.max(0, inv.outstandingPayableAmountPaisa - allocPaisa);
        inv.outstandingPaisa = inv.outstandingPayableAmountPaisa;
        inv.outstandingBalancePaisa = inv.outstandingPayableAmountPaisa;

        if (inv.outstandingPayableAmountPaisa === 0) {
          inv.paymentStatus = 'PAID';
        } else {
          inv.paymentStatus = 'PARTIALLY_PAID';
        }

        if (!inv.paymentHistory) inv.paymentHistory = [];
        inv.paymentHistory.push({
          paymentId: paymentSeq,
          paidPaisa: allocPaisa,
          paidAt: new Date(),
          paidByUserId: effectiveAuth.userId,
          paymentMethod,
          reference: effectiveRef || '',
        });

        await inv.save(saveOptions(session));
        compensations.push(compensateInvoice(inv, invoiceSnapshot));
        updatedInvoices.push({
          invoiceId: inv.invoiceId,
          allocatedPaisa: allocPaisa,
          newOutstandingPaisa: inv.outstandingPayableAmountPaisa,
          status: inv.paymentStatus,
        });

        remainingToDistribute -= allocPaisa;
      }
    }

    const entryType = payAmount < totalOutstanding ? 'PARTIAL_PAYMENT' : 'PAYMENT';

    const currentBal = await getVendorRunningBalance(organisationId, normVendorId, session);
    const newBal = currentBal - payAmount;

    const vendor = await scoped(
      Vendor.findOne({ organisationId, vendorId: normVendorId }),
      session
    ).lean();

    // Canonical cash/bank transaction is posted BEFORE the ledger entry so the
    // entry carries its id at creation — no out-of-band compensating stamp.
    const existingCt = await scoped(
      CashTransaction.findOne({
        organisationId,
        referenceType: 'VENDOR_PAYMENT',
        referenceId: paymentSeq,
      }),
      session
    );

    let cashTx = existingCt;
    if (!cashTx) {
      const validPaymentMethods = ['CASH', 'CARD', 'UPI', 'BANK_TRANSFER', 'WALLET', 'CREDIT'];
      const pMethod = validPaymentMethods.includes(paymentMethod) ? paymentMethod : 'BANK_TRANSFER';

      cashTx = new CashTransaction({
        cashTransactionId: cashSeq,
        organisationId,
        cafeId: openInvoices[0]?.cafeId || effectiveAuth.cafeId || 'CAFE-001',
        businessDate,
        transactionType: 'PAID_OUT',
        direction: 'OUT',
        category: 'VENDOR_PAYMENT',
        amount: Number((payAmount / 100).toFixed(2)),
        amountPaisa: payAmount,
        currency: 'INR',
        paymentMethod: pMethod,
        referenceType: 'VENDOR_PAYMENT',
        referenceId: paymentSeq,
        referenceNumber: effectiveRef || paymentSeq,
        description: `Payment to vendor ${normVendorId} (${vendor ? vendor.name : normVendorId}) for invoices: ${updatedInvoices.map((i) => i.invoiceId).join(', ')}`,
        status: 'POSTED',
        recordedBy: effectiveAuth.userId,
        createdBy: effectiveAuth.userId,
      });

      await cashTx.save(saveOptions(session));
      compensations.push(async () => {
        await CashTransaction.deleteOne({ _id: cashTx._id });
      });
    }

    const ledgerEntry = new VendorLedgerEntry({
      organisationId,
      ledgerEntryId: ledgerSeq,
      vendorId: normVendorId,
      vendorNameSnapshot: vendor ? vendor.name : normVendorId,
      cafeId: openInvoices[0]?.cafeId || 'ORGANISATION_WIDE',
      entryDate: businessDate,
      entryTimestamp: new Date(),
      entryType,
      referenceType: 'PAYMENT',
      referenceId: paymentSeq,
      referenceNumber: effectiveRef || paymentSeq,
      paymentId: paymentSeq,
      supplierInvoiceNumber: updatedInvoices[0]?.invoiceId || null,
      cashTransactionId: cashTx ? cashTx.cashTransactionId : null,
      debitPaisa: payAmount, // Payment reduces liability
      creditPaisa: 0,
      paidPaisa: payAmount,
      runningBalancePaisa: newBal,
      notes: `Vendor payment via ${paymentMethod}. Ref: ${effectiveRef}. ${notes}`.trim(),
      createdByUserId: effectiveAuth.userId,
      metadata: {
        idempotencyKey: effectiveIdem,
        bankAccountId,
        allocations: updatedInvoices,
      },
    });

    await ledgerEntry.save(saveOptions(session));
    compensations.push(compensateLedgerEntry(ledgerEntry));

    await syncVendorFinancialSummary(organisationId, normVendorId, session);

    return {
      paymentId: paymentSeq,
      cashTransactionId: cashTx ? cashTx.cashTransactionId : null,
      isIdempotentReplay: false,
      ledgerEntry,
      allocations: updatedInvoices.map((i) => ({
        invoiceId: i.invoiceId,
        amountPaise: i.allocatedPaisa,
        allocatedPaisa: i.allocatedPaisa,
        remainingInvoiceBalancePaise: i.newOutstandingPaisa,
        remainingInvoiceBalancePaisa: i.newOutstandingPaisa,
        status: i.status,
      })),
      updatedInvoices,
      newRunningBalancePaisa: newBal,
    };
  });

  // Idempotent replays are read-only — never audit them as a new disbursement.
  if (result.isIdempotentReplay) {
    return result;
  }

  // Audit stays outside the transaction: it must never be rolled back with the
  // business writes, and a failed attempt must not leave a SUCCESS event.
  await recordRequestAudit({
    request: { auth: effectiveAuth, correlationId: ledgerSeq },
    module: 'FINANCE',
    action: 'RECORD_VENDOR_PAYMENT',
    entityType: 'VENDOR_PAYMENT',
    entityId: paymentSeq,
    after: {
      vendorId: normVendorId,
      paymentAmountPaisa: payAmount,
      entryType: result.ledgerEntry.entryType,
      updatedInvoicesCount: result.updatedInvoices.length,
    },
    result: 'SUCCESS',
    riskClassification: 'HIGH',
  });

  return result;
}

/**
 * 3. Record Vendor Advance Payment.
 */
async function recordVendorAdvance({
  organisationId,
  vendorId,
  amountPaisa,
  amountPaise,
  cafeId = 'ORGANISATION_WIDE',
  paymentMethod = 'BANK_TRANSFER',
  reference = '',
  referenceNumber = '',
  notes = '',
  idempotencyKey = null,
  userId = null,
  auth,
}) {
  const normVendorId = normalizeId(vendorId);
  const advAmount = Number(amountPaisa !== undefined ? amountPaisa : amountPaise);
  const effectiveRef = referenceNumber || reference || '';
  const effectiveAuth = auth || { organisationId, userId: userId || 'MASTER_USER', role: 'MASTER' };

  if (!Number.isFinite(advAmount) || advAmount <= 0) {
    throw new ApiError(400, 'INVALID_AMOUNT', 'Advance amount must be greater than zero.');
  }

  const businessDate = getIstBusinessDate();
  const datePart = businessDate.replace(/-/g, '');

  const advanceSeq = await SequenceCounter.generateId({
    organisationId,
    sequenceKey: `VADV_${datePart}`,
    prefix: `VADV-${datePart}`,
    minimumDigits: 4,
  });

  // Stable ids generated once, outside the attempt: a transient retry reuses them.
  const ledgerSeq = await SequenceCounter.generateId({
    organisationId,
    sequenceKey: `VLE_${datePart}`,
    prefix: `VLE-${datePart}`,
    minimumDigits: 5,
  });

  const cashSeq = await SequenceCounter.generateId({
    organisationId,
    sequenceKey: `CASH_TRANSACTION_${datePart}`,
    prefix: `CT-${datePart}`,
    minimumDigits: 4,
  });

  return await runLedgerWrites(async (session, compensations) => {
    const currentBal = await getVendorRunningBalance(organisationId, normVendorId, session);
    const newBal = currentBal - advAmount;

    const vendor = await scoped(
      Vendor.findOne({ organisationId, vendorId: normVendorId }),
      session
    ).lean();

    // Canonical cash/bank transaction for Advance is posted BEFORE the ledger
    // entry so the entry carries its id at creation — no out-of-band stamp.
    const existingAdvCt = await scoped(
      CashTransaction.findOne({
        organisationId,
        referenceType: 'VENDOR_ADVANCE',
        referenceId: advanceSeq,
      }),
      session
    );

    let cashTx = existingAdvCt;
    if (!cashTx) {
      const validPaymentMethods = ['CASH', 'CARD', 'UPI', 'BANK_TRANSFER', 'WALLET', 'CREDIT'];
      const pMethod = validPaymentMethods.includes(paymentMethod) ? paymentMethod : 'BANK_TRANSFER';

      cashTx = new CashTransaction({
        cashTransactionId: cashSeq,
        organisationId,
        cafeId: cafeId || effectiveAuth.cafeId || 'CAFE-001',
        businessDate,
        transactionType: 'PAID_OUT',
        direction: 'OUT',
        category: 'VENDOR_ADVANCE',
        amount: Number((advAmount / 100).toFixed(2)),
        amountPaisa: advAmount,
        currency: 'INR',
        paymentMethod: pMethod,
        referenceType: 'VENDOR_ADVANCE',
        referenceId: advanceSeq,
        referenceNumber: effectiveRef || advanceSeq,
        description: `Advance to vendor ${normVendorId} (${vendor ? vendor.name : normVendorId}). Ref: ${effectiveRef}`,
        status: 'POSTED',
        recordedBy: effectiveAuth.userId,
        createdBy: effectiveAuth.userId,
      });

      await cashTx.save(saveOptions(session));
      compensations.push(async () => {
        await CashTransaction.deleteOne({ _id: cashTx._id });
      });
    }

    const ledgerEntry = new VendorLedgerEntry({
      organisationId,
      ledgerEntryId: ledgerSeq,
      vendorId: normVendorId,
      vendorNameSnapshot: vendor ? vendor.name : normVendorId,
      cafeId,
      entryDate: businessDate,
      entryTimestamp: new Date(),
      entryType: 'ADVANCE_PAYMENT',
      referenceType: 'ADVANCE',
      referenceId: advanceSeq,
      referenceNumber: effectiveRef || advanceSeq,
      paymentId: advanceSeq,
      cashTransactionId: cashTx ? cashTx.cashTransactionId : null,
      debitPaisa: advAmount, // Advance reduces net liability / creates debit balance
      creditPaisa: 0,
      paidPaisa: advAmount,
      runningBalancePaisa: newBal,
      notes: `Vendor advance payment via ${paymentMethod}. Ref: ${effectiveRef}. ${notes}`.trim(),
      createdByUserId: effectiveAuth.userId,
      metadata: { idempotencyKey },
    });

    await ledgerEntry.save(saveOptions(session));
    compensations.push(compensateLedgerEntry(ledgerEntry));

    await syncVendorFinancialSummary(organisationId, normVendorId, session);

    return {
      advanceId: advanceSeq,
      cashTransactionId: cashTx ? cashTx.cashTransactionId : null,
      ledgerEntry,
      newRunningBalancePaisa: newBal,
    };
  });
}

/**
 * 4. Apply Available Advance to an Approved Vendor Bill.
 */
async function applyVendorAdvance({
  organisationId,
  vendorId,
  invoiceId,
  amountToApplyPaisa,
  amountPaise,
  notes = '',
  userId = null,
  auth,
}) {
  const normVendorId = normalizeId(vendorId);
  const applyAmount = Number(amountToApplyPaisa !== undefined ? amountToApplyPaisa : amountPaise);
  const effectiveAuth = auth || { organisationId, userId: userId || 'MASTER_USER', role: 'MASTER' };

  if (!Number.isFinite(applyAmount) || applyAmount <= 0) {
    throw new ApiError(400, 'INVALID_AMOUNT', 'Advance amount to apply must be greater than zero.');
  }

  const businessDate = getIstBusinessDate();
  const datePart = businessDate.replace(/-/g, '');

  // Stable id generated once, outside the attempt: a transient retry reuses it.
  const ledgerSeq = await SequenceCounter.generateId({
    organisationId,
    sequenceKey: `VLE_${datePart}`,
    prefix: `VLE-${datePart}`,
    minimumDigits: 5,
  });

  return await runLedgerWrites(async (session, compensations) => {
    // Fresh reads + validation inside the attempt — never trust a stale snapshot.
    const invoice = await scoped(
      APInvoice.findOne({
        organisationId,
        invoiceId,
        vendorId: normVendorId,
      }),
      session
    );

    if (!invoice) {
      throw new ApiError(404, 'INVOICE_NOT_FOUND', `Invoice ${invoiceId} not found.`);
    }

    const vendor = await scoped(
      Vendor.findOne({ organisationId, vendorId: normVendorId }),
      session
    ).lean();
    const availableAdvance = Number(vendor?.financialSummary?.availableVendorAdvancePaisa || 0);

    if (applyAmount > availableAdvance) {
      throw new ApiError(
        400,
        'INSUFFICIENT_ADVANCE',
        `Cannot apply ₹${(applyAmount / 100).toFixed(2)}; available advance is only ₹${(availableAdvance / 100).toFixed(2)}.`
      );
    }

    if (applyAmount > invoice.outstandingPayableAmountPaisa) {
      throw new ApiError(
        400,
        'AMOUNT_EXCEEDS_OUTSTANDING',
        `Applied advance cannot exceed invoice outstanding ₹${(invoice.outstandingPayableAmountPaisa / 100).toFixed(2)}.`
      );
    }

    const invoiceSnapshot = snapshotInvoice(invoice);

    invoice.appliedAdvancePaisa = (invoice.appliedAdvancePaisa || 0) + applyAmount;
    invoice.outstandingPayableAmountPaisa = Math.max(0, invoice.outstandingPayableAmountPaisa - applyAmount);
    invoice.outstandingPaisa = invoice.outstandingPayableAmountPaisa;

    if (invoice.outstandingPayableAmountPaisa === 0) {
      invoice.paymentStatus = 'PAID';
    } else {
      invoice.paymentStatus = 'PARTIALLY_PAID';
    }

    await invoice.save(saveOptions(session));
    compensations.push(compensateInvoice(invoice, invoiceSnapshot));

    const currentBal = await getVendorRunningBalance(organisationId, normVendorId, session);

    const ledgerEntry = new VendorLedgerEntry({
      organisationId,
      ledgerEntryId: ledgerSeq,
      vendorId: normVendorId,
      vendorNameSnapshot: vendor ? vendor.name : normVendorId,
      cafeId: invoice.cafeId,
      entryDate: businessDate,
      entryTimestamp: new Date(),
      entryType: 'ADVANCE_APPLIED',
      referenceType: 'AP_INVOICE',
      referenceId: invoice.invoiceId,
      supplierInvoiceNumber: invoice.supplierInvoiceNumber,
      debitPaisa: 0,
      creditPaisa: 0, // Advance already debited when paid; applying it settles bill without changing overall net balance
      paidPaisa: applyAmount,
      runningBalancePaisa: currentBal,
      notes: `Applied ₹${(applyAmount / 100).toFixed(2)} advance to invoice ${invoice.invoiceId}. ${notes}`.trim(),
      createdByUserId: effectiveAuth.userId,
      metadata: { appliedPaisa: applyAmount },
    });

    await ledgerEntry.save(saveOptions(session));
    compensations.push(compensateLedgerEntry(ledgerEntry));

    await syncVendorFinancialSummary(organisationId, normVendorId, session);

    return {
      invoice,
      ledgerEntry,
      appliedAmountPaise: applyAmount,
      appliedAmountPaisa: applyAmount,
      remainingAdvancePaise: availableAdvance - applyAmount,
      remainingAdvancePaisa: availableAdvance - applyAmount,
      remainingInvoiceBalancePaise: invoice.outstandingPayableAmountPaisa,
      remainingInvoiceBalancePaisa: invoice.outstandingPayableAmountPaisa,
    };
  });
}

/**
 * 5. Apply Credit Note to reduce Vendor Bill.
 */
async function applyVendorCreditNote({
  organisationId,
  vendorId,
  invoiceId,
  creditNoteId,
  amountPaisa,
  reason = '',
  auth,
}) {
  const normVendorId = normalizeId(vendorId);
  const creditAmount = Number(amountPaisa);

  if (!Number.isFinite(creditAmount) || creditAmount <= 0) {
    throw new ApiError(400, 'INVALID_AMOUNT', 'Credit note amount must be greater than zero.');
  }

  const businessDate = getIstBusinessDate();
  const datePart = businessDate.replace(/-/g, '');

  // Stable id generated once, outside the attempt: a transient retry reuses it.
  const ledgerSeq = await SequenceCounter.generateId({
    organisationId,
    sequenceKey: `VLE_${datePart}`,
    prefix: `VLE-${datePart}`,
    minimumDigits: 5,
  });

  return await runLedgerWrites(async (session, compensations) => {
    // Fresh reads + validation inside the attempt — never trust a stale snapshot.
    const invoice = await scoped(
      APInvoice.findOne({
        organisationId,
        invoiceId,
        vendorId: normVendorId,
      }),
      session
    );

    if (!invoice) {
      throw new ApiError(404, 'INVOICE_NOT_FOUND', `Invoice ${invoiceId} not found.`);
    }

    if (creditAmount > invoice.outstandingPayableAmountPaisa) {
      throw new ApiError(
        400,
        'CREDIT_EXCEEDS_OUTSTANDING',
        `Credit note amount ₹${(creditAmount / 100).toFixed(2)} exceeds invoice outstanding ₹${(invoice.outstandingPayableAmountPaisa / 100).toFixed(2)}.`
      );
    }

    const invoiceSnapshot = snapshotInvoice(invoice);

    invoice.appliedCreditPaisa = (invoice.appliedCreditPaisa || 0) + creditAmount;
    invoice.outstandingPayableAmountPaisa = Math.max(0, invoice.outstandingPayableAmountPaisa - creditAmount);
    invoice.outstandingPaisa = invoice.outstandingPayableAmountPaisa;

    if (invoice.outstandingPayableAmountPaisa === 0) {
      invoice.paymentStatus = 'PAID';
    } else {
      invoice.paymentStatus = 'PARTIALLY_PAID';
    }

    await invoice.save(saveOptions(session));
    compensations.push(compensateInvoice(invoice, invoiceSnapshot));

    const currentBal = await getVendorRunningBalance(organisationId, normVendorId, session);
    const newBal = currentBal - creditAmount;

    const vendor = await scoped(
      Vendor.findOne({ organisationId, vendorId: normVendorId }),
      session
    ).lean();

    const ledgerEntry = new VendorLedgerEntry({
      organisationId,
      ledgerEntryId: ledgerSeq,
      vendorId: normVendorId,
      vendorNameSnapshot: vendor ? vendor.name : normVendorId,
      cafeId: invoice.cafeId,
      entryDate: businessDate,
      entryTimestamp: new Date(),
      entryType: 'CREDIT_NOTE',
      referenceType: 'CREDIT_NOTE',
      referenceId: creditNoteId,
      supplierInvoiceNumber: invoice.supplierInvoiceNumber,
      debitPaisa: creditAmount, // Credit note reduces liability
      creditPaisa: 0,
      runningBalancePaisa: newBal,
      notes: `Vendor credit note ${creditNoteId} applied. Reason: ${reason}`.trim(),
      createdByUserId: auth.userId,
    });

    await ledgerEntry.save(saveOptions(session));
    compensations.push(compensateLedgerEntry(ledgerEntry));

    await syncVendorFinancialSummary(organisationId, normVendorId, session);

    return {
      invoice,
      ledgerEntry,
      newRunningBalancePaisa: newBal,
    };
  });
}

/**
 * 6. Payment Reversal.
 * Reverses a recorded vendor payment and restores the invoice liabilities.
 */
async function reversePayment({
  organisationId,
  paymentId,
  reason = 'Payment reversed by authorised financial officer',
  userId = null,
  auth,
}) {
  const normPaymentId = normalizeId(paymentId);
  const effectiveAuth = auth || { organisationId, userId: userId || 'MASTER_USER', role: 'MASTER' };

  // Fast-fail on a plain read so a bogus payment id never consumes a sequence id.
  const precheckEntry = await VendorLedgerEntry.findOne({
    organisationId,
    paymentId: normPaymentId,
    entryType: { $in: ['PAYMENT', 'PARTIAL_PAYMENT'] },
    isReversed: false,
  }).lean();

  if (!precheckEntry) {
    throw new ApiError(404, 'PAYMENT_NOT_FOUND', `Active payment ${paymentId} not found or already reversed.`);
  }

  const businessDate = getIstBusinessDate();
  const datePart = businessDate.replace(/-/g, '');

  // Stable ids generated once, outside the attempt: a transient retry reuses them.
  const reversalSeq = await SequenceCounter.generateId({
    organisationId,
    sequenceKey: `VREV_${datePart}`,
    prefix: `VREV-${datePart}`,
    minimumDigits: 4,
  });

  const ledgerSeq = await SequenceCounter.generateId({
    organisationId,
    sequenceKey: `VLE_${datePart}`,
    prefix: `VLE-${datePart}`,
    minimumDigits: 5,
  });

  const cashSeq = await SequenceCounter.generateId({
    organisationId,
    sequenceKey: `CASH_TRANSACTION_${datePart}`,
    prefix: `CT-${datePart}`,
    minimumDigits: 4,
  });

  return await runLedgerWrites(async (session, compensations) => {
    // Authoritative re-read: the payment must still be active inside the attempt.
    const originalEntry = await scoped(
      VendorLedgerEntry.findOne({
        organisationId,
        paymentId: normPaymentId,
        entryType: { $in: ['PAYMENT', 'PARTIAL_PAYMENT'] },
        isReversed: false,
      }),
      session
    );

    if (!originalEntry) {
      throw new ApiError(404, 'PAYMENT_NOT_FOUND', `Active payment ${paymentId} not found or already reversed.`);
    }

    const payAmount = Number(originalEntry.debitPaisa || 0);
    const vendorId = originalEntry.vendorId;
    const allocations = originalEntry.metadata?.allocations || [];

    const currentBal = await getVendorRunningBalance(organisationId, vendorId, session);
    const newBal = currentBal + payAmount; // Restores payable

    // 1. Append the offsetting reversal entry first: if anything downstream
    //    fails, this fresh entry is the only artefact and it is removed again.
    const reversalEntry = new VendorLedgerEntry({
      organisationId,
      ledgerEntryId: ledgerSeq,
      vendorId,
      vendorNameSnapshot: originalEntry.vendorNameSnapshot,
      cafeId: originalEntry.cafeId,
      entryDate: businessDate,
      entryTimestamp: new Date(),
      entryType: 'PAYMENT_REVERSAL',
      referenceType: 'PAYMENT',
      referenceId: originalEntry.paymentId,
      referenceNumber: originalEntry.referenceNumber || reversalSeq,
      paymentId: reversalSeq,
      debitPaisa: 0,
      creditPaisa: payAmount, // Liability restored
      paidPaisa: 0,
      runningBalancePaisa: newBal,
      notes: `Reversal of payment ${originalEntry.paymentId}. Reason: ${reason}`.trim(),
      createdByUserId: effectiveAuth.userId,
      reversalEntryId: originalEntry.ledgerEntryId,
    });

    await reversalEntry.save(saveOptions(session));
    compensations.push(compensateLedgerEntry(reversalEntry));

    // 2. Mark the original reversed (guarded — direct collection update bypasses
    //    the model's immutability pre-hook, so the filter is the real guard).
    const markResult = await VendorLedgerEntry.collection.updateOne(
      { _id: originalEntry._id, isReversed: false },
      { $set: { isReversed: true, reversalEntryId: ledgerSeq } },
      modelOptions(session)
    );

    if (!markResult || markResult.matchedCount === 0) {
      throw new ApiError(404, 'PAYMENT_NOT_FOUND', `Active payment ${paymentId} not found or already reversed.`);
    }

    compensations.push(async () => {
      await VendorLedgerEntry.collection.updateOne(
        { _id: originalEntry._id, reversalEntryId: ledgerSeq },
        { $set: { isReversed: false, reversalEntryId: null } }
      );
    });

    // 3. Restore invoice balances
    for (const alloc of allocations) {
      const inv = await scoped(APInvoice.findOne({ organisationId, invoiceId: alloc.invoiceId }), session);
      if (inv) {
        const invoiceSnapshot = snapshotInvoice(inv);

        inv.paidPaisa = Math.max(0, (inv.paidPaisa || 0) - alloc.allocatedPaisa);
        inv.amountPaidPaisa = inv.paidPaisa;
        inv.recalculateOutstanding();
        inv.outstandingBalancePaisa = inv.outstandingPayableAmountPaisa;
        await inv.save(saveOptions(session));
        compensations.push(compensateInvoice(inv, invoiceSnapshot));
      }
    }

    // 4. Reverse the original CashTransaction and post the offsetting PAID_IN
    const originalCt = await scoped(
      CashTransaction.findOne({
        organisationId,
        referenceType: 'VENDOR_PAYMENT',
        referenceId: originalEntry.paymentId,
      }),
      session
    );

    if (originalCt) {
      const ctSnapshot = {
        status: originalCt.status,
        reversedAt: originalCt.reversedAt,
        reversedBy: originalCt.reversedBy,
        reversalReason: originalCt.reversalReason,
        reversalTransactionId: originalCt.reversalTransactionId,
      };

      originalCt.status = 'REVERSED';
      originalCt.reversedAt = new Date();
      originalCt.reversedBy = effectiveAuth.userId;
      originalCt.reversalReason = reason;
      originalCt.reversalTransactionId = reversalSeq;
      await originalCt.save(saveOptions(session));
      compensations.push(async () => {
        const freshCt = await CashTransaction.findOne({ _id: originalCt._id });
        if (!freshCt) return;
        freshCt.status = ctSnapshot.status;
        freshCt.reversedAt = ctSnapshot.reversedAt;
        freshCt.reversedBy = ctSnapshot.reversedBy;
        freshCt.reversalReason = ctSnapshot.reversalReason;
        freshCt.reversalTransactionId = ctSnapshot.reversalTransactionId;
        await freshCt.save();
      });

      const reversalCashTx = new CashTransaction({
        cashTransactionId: cashSeq,
        organisationId,
        cafeId: originalEntry.cafeId || 'CAFE-001',
        businessDate,
        transactionType: 'PAID_IN',
        direction: 'IN',
        category: 'PAYMENT_REVERSAL',
        amount: Number((payAmount / 100).toFixed(2)),
        amountPaisa: payAmount,
        currency: 'INR',
        paymentMethod: 'BANK_TRANSFER',
        referenceType: 'PAYMENT_REVERSAL',
        referenceId: reversalSeq,
        referenceNumber: originalEntry.referenceNumber || reversalSeq,
        description: `Payment reversal for ${originalEntry.paymentId}: ${reason}`,
        status: 'POSTED',
        recordedBy: effectiveAuth.userId,
        createdBy: effectiveAuth.userId,
      });

      await reversalCashTx.save(saveOptions(session));
      compensations.push(async () => {
        await CashTransaction.deleteOne({ _id: reversalCashTx._id });
      });
    }

    await syncVendorFinancialSummary(organisationId, vendorId, session);

    return {
      reversalEntry,
      reversedAmountPaise: payAmount,
      restoredAmountPaisa: payAmount,
      newRunningBalancePaisa: newBal,
    };
  });
}

/**
 * 7. Set Vendor Opening Balance.
 */
async function setOpeningBalance({
  organisationId,
  vendorId,
  amountPaisa,
  isCredit = true,
  effectiveDate,
  reason = 'Opening balance migration',
  auth,
}) {
  const normVendorId = normalizeId(vendorId);
  const amt = Number(amountPaisa);

  if (!Number.isFinite(amt) || amt < 0) {
    throw new ApiError(400, 'INVALID_AMOUNT', 'Opening balance amount must be non-negative.');
  }

  const existing = await VendorLedgerEntry.findOne({
    organisationId,
    vendorId: normVendorId,
    entryType: 'OPENING_BALANCE',
  }).lean();

  if (existing) {
    throw new ApiError(409, 'OPENING_BALANCE_EXISTS', 'Opening balance already recorded for this vendor.');
  }

  const businessDate = effectiveDate || getIstBusinessDate();
  const datePart = businessDate.replace(/-/g, '');

  // Stable id generated once, outside the attempt: a transient retry reuses it.
  const ledgerSeq = await SequenceCounter.generateId({
    organisationId,
    sequenceKey: `VLE_${datePart}`,
    prefix: `VLE-${datePart}`,
    minimumDigits: 5,
  });

  return await runLedgerWrites(async (session, compensations) => {
    // Authoritative duplicate re-check inside the attempt.
    const existing = await scoped(
      VendorLedgerEntry.findOne({
        organisationId,
        vendorId: normVendorId,
        entryType: 'OPENING_BALANCE',
      }),
      session
    ).lean();

    if (existing) {
      throw new ApiError(409, 'OPENING_BALANCE_EXISTS', 'Opening balance already recorded for this vendor.');
    }

    const runningBal = isCredit ? amt : -amt;
    const vendor = await scoped(
      Vendor.findOne({ organisationId, vendorId: normVendorId }),
      session
    ).lean();

    const ledgerEntry = new VendorLedgerEntry({
      organisationId,
      ledgerEntryId: ledgerSeq,
      vendorId: normVendorId,
      vendorNameSnapshot: vendor ? vendor.name : normVendorId,
      cafeId: 'ORGANISATION_WIDE',
      entryDate: businessDate,
      entryTimestamp: new Date(),
      entryType: 'OPENING_BALANCE',
      referenceType: 'MANUAL',
      referenceId: 'OPENING_BAL',
      debitPaisa: isCredit ? 0 : amt,
      creditPaisa: isCredit ? amt : 0,
      runningBalancePaisa: runningBal,
      notes: `Vendor opening balance. Reason: ${reason}`.trim(),
      createdByUserId: auth.userId,
    });

    await ledgerEntry.save(saveOptions(session));
    compensations.push(compensateLedgerEntry(ledgerEntry));

    await syncVendorFinancialSummary(organisationId, normVendorId, session);

    return ledgerEntry;
  });
}

/**
 * 8. Query Vendor Ledger with optional café and date filters.
 */
async function getVendorLedger({
  organisationId,
  vendorId,
  cafeId = null,
  startDate = null,
  endDate = null,
  entryType = null,
  limit = 100,
  skip = 0,
}) {
  const normVendorId = normalizeId(vendorId);
  const filter = { organisationId, vendorId: normVendorId };

  if (cafeId && cafeId !== 'ORGANISATION_WIDE' && cafeId !== 'GLOBAL') {
    filter.$or = [{ cafeId: cafeId.trim().toUpperCase() }, { cafeId: 'ORGANISATION_WIDE' }];
  }

  if (startDate || endDate) {
    filter.entryDate = {};
    if (startDate) filter.entryDate.$gte = startDate;
    if (endDate) filter.entryDate.$lte = endDate;
  }

  if (entryType) {
    filter.entryType = entryType;
  }

  const [entries, totalCount] = await Promise.all([
    VendorLedgerEntry.find(filter)
      .sort({ entryDate: 1, entryTimestamp: 1, _id: 1 })
      .skip(Number(skip) || 0)
      .limit(Number(limit) || 100)
      .lean(),
    VendorLedgerEntry.countDocuments(filter),
  ]);

  const vendor = await Vendor.findOne({ organisationId, vendorId: normVendorId }).lean();

  return {
    vendorId: normVendorId,
    vendorName: vendor ? vendor.name : normVendorId,
    summary: vendor?.financialSummary || {},
    entries,
    totalCount,
  };
}

/**
 * 9. Accounts Payable Aging Report.
 */
async function getAccountsPayableAging({ organisationId, cafeId = null, asOfDate = null }) {
  const today = asOfDate || getIstBusinessDate();

  const filter = {
    organisationId,
    outstandingPayableAmountPaisa: { $gt: 0 },
  };

  if (cafeId && cafeId !== 'ORGANISATION_WIDE' && cafeId !== 'GLOBAL') {
    filter.cafeId = cafeId.trim().toUpperCase();
  }

  const invoices = await APInvoice.find(filter).lean();

  const agingBuckets = {
    current: 0,
    days1_30: 0,
    days31_60: 0,
    days61_90: 0,
    days91_180: 0,
    days180_plus: 0,
    totalOutstandingPaisa: 0,
  };

  const vendorBreakdown = {};

  const parseDaysDiff = (dueStr) => {
    if (!dueStr) return 0;
    const dueTime = new Date(dueStr).getTime();
    const curTime = new Date(today).getTime();
    return Math.floor((curTime - dueTime) / (1000 * 60 * 60 * 24));
  };

  for (const inv of invoices) {
    const outstanding = Number(inv.outstandingPayableAmountPaisa || inv.outstandingPaisa || 0);
    const daysOverdue = parseDaysDiff(inv.dueDate);
    const vId = inv.vendorId;

    if (!vendorBreakdown[vId]) {
      vendorBreakdown[vId] = {
        vendorId: vId,
        vendorName: inv.vendorName,
        current: 0,
        days1_30: 0,
        days31_60: 0,
        days61_90: 0,
        days91_180: 0,
        days180_plus: 0,
        totalOutstandingPaisa: 0,
      };
    }

    agingBuckets.totalOutstandingPaisa += outstanding;
    vendorBreakdown[vId].totalOutstandingPaisa += outstanding;

    if (daysOverdue <= 0) {
      agingBuckets.current += outstanding;
      vendorBreakdown[vId].current += outstanding;
    } else if (daysOverdue <= 30) {
      agingBuckets.days1_30 += outstanding;
      vendorBreakdown[vId].days1_30 += outstanding;
    } else if (daysOverdue <= 60) {
      agingBuckets.days31_60 += outstanding;
      vendorBreakdown[vId].days31_60 += outstanding;
    } else if (daysOverdue <= 90) {
      agingBuckets.days61_90 += outstanding;
      vendorBreakdown[vId].days61_90 += outstanding;
    } else if (daysOverdue <= 180) {
      agingBuckets.days91_180 += outstanding;
      vendorBreakdown[vId].days91_180 += outstanding;
    } else {
      agingBuckets.days180_plus += outstanding;
      vendorBreakdown[vId].days180_plus += outstanding;
    }
  }

  const agingResult = {
    current: agingBuckets.current,
    days1_30: agingBuckets.days1_30,
    days31_60: agingBuckets.days31_60,
    days61_90: agingBuckets.days61_90,
    days91_180: agingBuckets.days91_180,
    days180_plus: agingBuckets.days180_plus,
    totalOutstandingPaisa: agingBuckets.totalOutstandingPaisa,
    // Aliases for compatibility
    currentPaisa: agingBuckets.current,
    currentPaise: agingBuckets.current,
    days1_30Paisa: agingBuckets.days1_30,
    days1_30Paise: agingBuckets.days1_30,
    days31_60Paisa: agingBuckets.days31_60,
    days31_60Paise: agingBuckets.days31_60,
    days61_90Paisa: agingBuckets.days61_90,
    days61_90Paise: agingBuckets.days61_90,
    days91_180Paisa: agingBuckets.days91_180,
    days91_180Paise: agingBuckets.days91_180,
    days180_plusPaisa: agingBuckets.days180_plus,
    days180_plusPaise: agingBuckets.days180_plus,
    totalOutstandingPaise: agingBuckets.totalOutstandingPaisa,
  };

  return {
    asOfDate: today,
    summary: agingResult,
    buckets: agingResult,
    vendors: Object.values(vendorBreakdown),
  };
}

/**
 * 10. GST 180-Day Payment Risk Monitoring.
 */
async function getGst180DayMonitoring({ organisationId, asOfDate = null }) {
  const today = asOfDate || getIstBusinessDate();
  const todayTime = new Date(today).getTime();

  const invoices = await APInvoice.find({
    organisationId,
    outstandingPayableAmountPaisa: { $gt: 0 },
  }).lean();

  const flaggedInvoices = [];

  for (const inv of invoices) {
    if (!inv.invoiceDate) continue;
    const invTime = new Date(inv.invoiceDate).getTime();
    const daysSince = Math.floor((todayTime - invTime) / (1000 * 60 * 60 * 24));

    let riskCategory = 'NONE';
    let is180DayRisk = false;

    if (daysSince >= 180) {
      riskCategory = 'OVERDUE_180_DAYS';
      is180DayRisk = true;
    } else if (daysSince >= 175) {
      riskCategory = 'APPROACHING_175_DAYS';
      is180DayRisk = true;
    } else if (daysSince >= 165) {
      riskCategory = 'APPROACHING_165_DAYS';
      is180DayRisk = true;
    }

    if (is180DayRisk) {
      const outstanding = Number(inv.outstandingPayableAmountPaisa || 0);
      const total = Number(inv.totalPaisa || 0);
      // ITC at risk = the invoice's own tax component weighted by how much of
      // the bill is still unpaid (0 paid → full tax; fully paid → none). The
      // tax component is taken from the invoice, never assumed at a flat rate.
      const taxPaisa = Number(inv.taxPaisa || 0);
      const unpaidProportion = total > 0 ? Math.min(1, outstanding / total) : 0;
      const itcAtRiskPaisa = Math.round(taxPaisa * unpaidProportion);

      flaggedInvoices.push({
        invoiceId: inv.invoiceId,
        vendorId: inv.vendorId,
        vendorName: inv.vendorName,
        supplierInvoiceNumber: inv.supplierInvoiceNumber,
        invoiceDate: inv.invoiceDate,
        daysSinceInvoice: daysSince,
        totalPaisa: total,
        taxPaisa,
        paidPaisa: inv.paidPaisa || 0,
        unpaidProportionPaisa: outstanding,
        itcAtRiskPaisa,
        riskCategory,
        complianceGuidance: 'CBIC section 16 180-day consideration review required. Flagged for Accounts/CA review.',
      });
    }
  }

  return {
    asOfDate: today,
    totalFlaggedCount: flaggedInvoices.length,
    flaggedInvoices,
  };
}

/**
 * 10b. Place a Payment Hold on an AP bill.
 *
 * Mirrors releasePaymentHold: the hold subdoc, the invoice paymentStatus and
 * the zero-value PAYMENT_HOLD audit entry commit (or abort) as one unit, so the
 * AP queue can never display a hold the ledger does not know about.
 */
async function placePaymentHold({
  organisationId,
  invoiceId,
  holdCode = 'FINANCE_REVIEW',
  reason,
  auth,
}) {
  const businessDate = getIstBusinessDate();
  const datePart = businessDate.replace(/-/g, '');
  const finalHoldCode = String(holdCode || 'FINANCE_REVIEW').trim().toUpperCase() || 'FINANCE_REVIEW';
  const finalReason = String(reason || '').trim();

  if (!finalReason) {
    throw new ApiError(400, 'HOLD_REASON_REQUIRED', 'A reason is required to place a payment hold.');
  }

  // Stable id generated once, outside the attempt: a transient retry reuses it.
  const ledgerSeq = await SequenceCounter.generateId({
    organisationId,
    sequenceKey: `VLE_${datePart}`,
    prefix: `VLE-${datePart}`,
    minimumDigits: 5,
  });

  return await runLedgerWrites(async (session, compensations) => {
    // Fresh read + validation inside the attempt — never trust a stale snapshot.
    const invoice = await scoped(
      APInvoice.findOne({
        organisationId,
        invoiceId,
      }),
      session
    );

    if (!invoice) {
      throw new ApiError(404, 'INVOICE_NOT_FOUND', `Invoice ${invoiceId} not found.`);
    }

    const activeHolds = (invoice.holds || []).filter((h) => !h.releasedAt);
    if (activeHolds.some((h) => h.holdCode === finalHoldCode)) {
      throw new ApiError(409, 'HOLD_ALREADY_ACTIVE', `Hold ${finalHoldCode} is already active on invoice ${invoiceId}.`);
    }
    if (Number(invoice.outstandingPayableAmountPaisa || 0) === 0) {
      throw new ApiError(400, 'INVOICE_SETTLED', `Invoice ${invoiceId} has no outstanding balance to hold.`);
    }

    const invoiceSnapshot = snapshotInvoice(invoice);
    const holdsSnapshot = (invoice.holds || []).map((h) => (h.toObject ? h.toObject() : { ...h }));

    invoice.holds.push({
      holdCode: finalHoldCode,
      reason: finalReason,
      placedAt: new Date(),
      placedBy: auth.userId,
    });
    invoice.paymentStatus = 'ON_HOLD';

    await invoice.save(saveOptions(session));
    compensations.push(async () => {
      await compensateInvoice(invoice, invoiceSnapshot)();
      const fresh = await APInvoice.findOne({ _id: invoice._id });
      if (!fresh) return;
      fresh.holds = holdsSnapshot;
      await fresh.save();
    });

    const currentBal = await getVendorRunningBalance(organisationId, invoice.vendorId, session);
    const vendor = await scoped(
      Vendor.findOne({ organisationId, vendorId: invoice.vendorId }),
      session
    ).lean();

    // Zero-value audit trail: a hold moves no money, but the subledger must
    // record who froze the bill and why, exactly as HOLD_RELEASE records the exit.
    const ledgerEntry = new VendorLedgerEntry({
      organisationId,
      ledgerEntryId: ledgerSeq,
      vendorId: invoice.vendorId,
      vendorNameSnapshot: vendor ? vendor.name : invoice.vendorId,
      cafeId: invoice.cafeId,
      entryDate: businessDate,
      entryTimestamp: new Date(),
      entryType: 'PAYMENT_HOLD',
      referenceType: 'AP_INVOICE',
      referenceId: invoice.invoiceId,
      supplierInvoiceNumber: invoice.supplierInvoiceNumber,
      debitPaisa: 0,
      creditPaisa: 0,
      heldPaisa: 0,
      runningBalancePaisa: currentBal,
      notes: `Placed hold ${finalHoldCode} on invoice ${invoice.invoiceId}. Reason: ${finalReason}`,
      createdByUserId: auth.userId,
      metadata: { placedHoldCode: finalHoldCode, holdReason: finalReason },
    });

    await ledgerEntry.save(saveOptions(session));
    compensations.push(compensateLedgerEntry(ledgerEntry));

    await syncVendorFinancialSummary(organisationId, invoice.vendorId, session);

    return {
      invoice,
      ledgerEntry,
    };
  });
}

/**
 * 11. Release Payment Hold on Disputed Bill.
 */
async function releasePaymentHold({
  organisationId,
  invoiceId,
  holdCode = 'QUANTITY_VARIANCE',
  releaseReason = 'Dispute resolved with supplier',
  auth,
}) {
  const businessDate = getIstBusinessDate();
  const datePart = businessDate.replace(/-/g, '');

  // Stable id generated once, outside the attempt: a transient retry reuses it.
  const ledgerSeq = await SequenceCounter.generateId({
    organisationId,
    sequenceKey: `VLE_${datePart}`,
    prefix: `VLE-${datePart}`,
    minimumDigits: 5,
  });

  return await runLedgerWrites(async (session, compensations) => {
    // Fresh read + validation inside the attempt — never trust a stale snapshot.
    const invoice = await scoped(
      APInvoice.findOne({
        organisationId,
        invoiceId,
      }),
      session
    );

    if (!invoice) {
      throw new ApiError(404, 'INVOICE_NOT_FOUND', `Invoice ${invoiceId} not found.`);
    }

    const holdIdx = (invoice.holds || []).findIndex((h) => h.holdCode === holdCode);
    if (holdIdx === -1 && invoice.paymentStatus !== 'ON_HOLD') {
      throw new ApiError(400, 'NO_ACTIVE_HOLD', `No active hold with code ${holdCode} on invoice ${invoiceId}.`);
    }

    const releasedAmount = Number(invoice.heldDisputedAmountPaisa || 0);
    const invoiceSnapshot = snapshotInvoice(invoice);
    const holdsSnapshot = (invoice.holds || []).map((h) => (h.toObject ? h.toObject() : { ...h }));

    // Remove hold
    if (holdIdx !== -1) {
      invoice.holds.splice(holdIdx, 1);
    }
    invoice.heldDisputedAmountPaisa = 0;
    invoice.paymentStatus = invoice.outstandingPayableAmountPaisa === 0 ? 'PAID' : 'DUE';

    await invoice.save(saveOptions(session));
    compensations.push(async () => {
      await compensateInvoice(invoice, invoiceSnapshot)();
      const fresh = await APInvoice.findOne({ _id: invoice._id });
      if (!fresh) return;
      fresh.holds = holdsSnapshot;
      await fresh.save();
    });

    const currentBal = await getVendorRunningBalance(organisationId, invoice.vendorId, session);
    const vendor = await scoped(
      Vendor.findOne({ organisationId, vendorId: invoice.vendorId }),
      session
    ).lean();

    const ledgerEntry = new VendorLedgerEntry({
      organisationId,
      ledgerEntryId: ledgerSeq,
      vendorId: invoice.vendorId,
      vendorNameSnapshot: vendor ? vendor.name : invoice.vendorId,
      cafeId: invoice.cafeId,
      entryDate: businessDate,
      entryTimestamp: new Date(),
      entryType: 'HOLD_RELEASE',
      referenceType: 'AP_INVOICE',
      referenceId: invoice.invoiceId,
      supplierInvoiceNumber: invoice.supplierInvoiceNumber,
      debitPaisa: 0,
      creditPaisa: 0,
      heldPaisa: 0,
      runningBalancePaisa: currentBal,
      notes: `Released hold on invoice ${invoice.invoiceId}. Reason: ${releaseReason}`.trim(),
      createdByUserId: auth.userId,
      metadata: { releasedHoldCode: holdCode, releasedAmountPaisa: releasedAmount },
    });

    await ledgerEntry.save(saveOptions(session));
    compensations.push(compensateLedgerEntry(ledgerEntry));

    await syncVendorFinancialSummary(organisationId, invoice.vendorId, session);

    return {
      invoice,
      ledgerEntry,
    };
  });
}

/**
 * Deterministic Rebuild / Reconciliation of Vendor Financial Summary from canonical accounting records.
 * Recalculates all lifetime and current metrics from PurchaseOrder, APInvoice, VendorLedgerEntry, and CashTransaction.
 */
async function rebuildVendorFinancialSummary({ organisationId, vendorId }) {
  const normVendorId = normalizeId(vendorId);
  const vendor = await Vendor.findOne({ organisationId, vendorId: normVendorId });
  if (!vendor) {
    throw new ApiError(404, 'VENDOR_NOT_FOUND', `Vendor ${normVendorId} not found.`);
  }

  // Re-sync from canonical database state
  const summary = await syncVendorFinancialSummary(organisationId, normVendorId);
  return {
    vendorId: normVendorId,
    vendorName: vendor.name,
    summary,
    financialSummary: summary,
    reconciledAt: new Date(),
  };
}

/**
 * Compatibility wrapper for posting bill directly from Purchase Order with GRN inspection
 */
async function postBillFromPurchaseOrder(args) {
  const {
    organisationId,
    purchaseOrderId,
    supplierInvoiceNumber,
    invoiceDate,
    dueDate,
    claimedTotalPaisa,
    claimedAmountPaisa,
    userId,
    grnReceiptNumber,
    auth = { organisationId, userId: userId || 'MASTER_USER', role: 'MASTER' },
  } = args;

  const result = await postVendorBillFromReceipt({
    organisationId,
    purchaseOrderId,
    supplierInvoiceNumber,
    invoiceDate,
    dueDate,
    claimedAmountPaisa: claimedTotalPaisa !== undefined ? claimedTotalPaisa : claimedAmountPaisa,
    notes: grnReceiptNumber ? `GRN Receipt: ${grnReceiptNumber}` : '',
    auth,
  });

  return {
    invoice: {
      ...result.apInvoice.toObject(),
      approvedPayablePaisa: result.apInvoice.approvedPayableAmountPaisa,
      claimedInvoiceTotalPaisa: result.apInvoice.supplierClaimedAmountPaisa,
      variancePaisa: result.apInvoice.heldDisputedAmountPaisa,
      holdStatus: result.apInvoice.holds?.length > 0 ? 'ON_HOLD' : result.apInvoice.paymentStatus,
      holdReasonCode: result.apInvoice.holds?.[0]?.holdCode,
    },
    ledgerEntry: result.ledgerEntry,
  };
}

/**
 * Bulk import supplier-material mappings into vendor item catalog (Benchmark A093-A095)
 */
async function importSupplierMaterialMappings({
  organisationId,
  vendorId,
  mappings = [],
  performedByUserId = 'SYSTEM',
}) {
  if (!organisationId || !vendorId) {
    throw new ApiError(400, 'MISSING_PARAMETERS', 'organisationId and vendorId are required.');
  }
  const normVendorId = normalizeId(vendorId);
  const vendor = await Vendor.findOne({ organisationId, vendorId: normVendorId });
  if (!vendor) {
    throw new ApiError(404, 'VENDOR_NOT_FOUND', `Vendor ${vendorId} not found.`);
  }

  vendor.itemCatalogue = vendor.itemCatalogue || [];
  const existingMap = new Map(vendor.itemCatalogue.map((it) => [normalizeId(it.itemId), it]));

  let importedCount = 0;
  for (const m of mappings) {
    const itemId = normalizeId(m.itemId || m.materialId);
    if (!itemId) continue;

    const price = Math.max(0, Math.round(Number(m.currentPricePaisa ?? m.unitPricePaisa ?? 0)));
    const supplierItemCode = String(m.supplierItemCode || '').trim();
    const itemName = String(m.itemName || itemId).trim();
    const moq = Math.max(1, Number(m.moq || 1));
    const leadTimeDays = Math.max(0, Number(m.leadTimeDays || 2));
    const sourcePriority = m.sourcePriority || 'APPROVED';

    const existing = existingMap.get(itemId);
    if (existing) {
      existing.supplierItemCode = supplierItemCode || existing.supplierItemCode;
      existing.currentPricePaisa = price;
      existing.moq = moq;
      existing.leadTimeDays = leadTimeDays;
      existing.sourcePriority = sourcePriority;
    } else {
      vendor.itemCatalogue.push({
        itemId,
        supplierItemCode,
        itemName,
        currentPricePaisa: price,
        moq,
        leadTimeDays,
        sourcePriority,
        status: 'ACTIVE',
      });
    }
    importedCount++;
  }

  await vendor.save();

  return {
    success: true,
    vendorId: normVendorId,
    importedCount,
    totalCatalogueItems: vendor.itemCatalogue.length,
  };
}

module.exports = {
  getVendorRunningBalance,
  syncVendorFinancialSummary,
  rebuildVendorFinancialSummary,
  postVendorBillFromReceipt,
  postBillFromPurchaseOrder,
  recordVendorPayment,
  recordVendorAdvance,
  applyVendorAdvance,
  applyVendorCreditNote,
  reversePayment,
  setOpeningBalance,
  getVendorLedger,
  getAccountsPayableAging,
  getGst180DayMonitoring,
  placePaymentHold,
  releasePaymentHold,
  importSupplierMaterialMappings,
};

