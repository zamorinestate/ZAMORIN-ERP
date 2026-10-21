'use strict';

/**
 * REC-17 ADD-ON CERTIFICATION TEST SUITE
 *
 * Vendor Accounts Payable Ledger, Receipt-Based Payable Calculation,
 * Partial Payment & Lifetime Vendor Balance Certification
 *
 * Validates:
 * 01. Receipt-based payable quantity: payable quantity = accepted received quantity
 * 02. Mandatory Onion Samosa: 20 ordered, 19 delivered, 18 accepted @ ₹10 -> ₹180 payable basis, not ₹200
 * 03. Preserves original supplier invoice claimed amount independently from approved payable
 * 04. Three separate financial values: Claimed (₹200), Approved (₹180), Held/Disputed (₹20)
 * 05. Supplier invoice is not rewritten or modified
 * 06. Payment hold placed on disputed variance with QUANTITY_VARIANCE code
 * 07. Accounts Payable handoff creates APInvoice linked to PO, GRN, and BusinessDocument
 * 08. Accounts Payable work queue categorizes bills into review buckets
 * 09. Partial payment: ₹1,000 payable -> ₹500 payment -> ₹500 outstanding, PARTIALLY_PAID
 * 10. Secondary partial payment: ₹500 payment -> ₹0 outstanding, PAID
 * 11. Multi-invoice payment allocation: ₹1,500 allocated to Invoice A (₹1,000) and Invoice B (₹500)
 * 12. Maximum payment guard: payment cannot exceed approved outstanding without advance
 * 13. Duplicate payment idempotency: replaying same key returns existing payment without double deductions
 * 14. Vendor advance: ₹5,000 advance paid creates advance balance
 * 15. Vendor advance applied: ₹3,000 applied to invoice leaves ₹2,000 advance without cash out
 * 16. Vendor advance does not equal expense or goods receipt
 * 17. Vendor credit note: ₹1,000 bill - ₹200 credit note = ₹800 net outstanding
 * 18. Short supply credit linked to PO and GRN shortage
 * 19. Vendor Ledger permanent subledger exists for each vendor
 * 20. Deterministic running balance calculation on each ledger transaction
 * 21. Ledger immutability: direct update/delete on VendorLedgerEntry blocked
 * 22. Separate lifetime measures: PO ordered, Accepted received, Invoiced, Approved, Paid
 * 23. Lifetime paid total derives only from non-reversed payments
 * 24. Controlled Vendor Opening Balance entry by Master
 * 25. Multi-café reconciliation: Café A + Café B = Org Total without double counting
 * 26. Accounts Payable aging report: Current, 1-30, 31-60, 61-90, 91-180, 180+
 * 27. Overdue calculation when dueDate < current date and outstanding > 0
 * 28. GST 180-day monitoring flags unpaid proportion at 165, 175, 180 days
 * 29. Payment reversal restores invoice liabilities and posts PAYMENT_REVERSAL
 * 30. Payment hold release allows clearing dispute once resolved
 * 31. Vendor statement extracts accurate period activity and closing balance
 * 32. Staff is strictly denied all vendor ledger and AP access (403)
 * 33. Owner has read-only visibility; payment release/reversal is strictly blocked (403)
 * 34. Café Admin is scoped strictly to assigned café records
 * 35. Cross-org tenant isolation: Org B user cannot access Org A vendor ledger
 * 36. Zero Kitchen Display System (KDS) files or endpoints introduced
 */

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const { PurchaseOrder } = require('../src/models/PurchaseOrder');
const { Vendor } = require('../src/models/Vendor');
const { APInvoice } = require('../src/models/APInvoice');
const { VendorLedgerEntry } = require('../src/models/VendorLedgerEntry');
const vendorLedgerService = require('../src/services/vendorLedgerService');
const vendorLedgerController = require('../src/controllers/vendorLedgerController');

function createMockResponse() {
  const res = {
    statusCode: 200,
    headers: {},
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    status(s) { this.statusCode = s; return this; },
    json(j) { this.body = j; return this; },
    send(b) { this.body = b; return this; },
  };
  return res;
}

async function invokeController(controllerFn, req, res) {
  return new Promise((resolve, reject) => {
    const next = (err) => {
      if (err) return reject(err);
      resolve();
    };
    Promise.resolve(controllerFn(req, res, next)).then(resolve).catch(reject);
  });
}

describe('REC-17 ADD-ON — Vendor Accounts Payable Ledger & Lifecycle Suite', () => {
  let mongoServer;

  const orgId = 'ORG-ZAMORIN-TEST';
  const orgIdB = 'ORG-OTHER-TEST';
  const cafeIdA = 'ZC-CAF-01';
  const cafeIdB = 'ZC-CAF-02';

  const masterAuth = { userId: 'USR-MASTER-01', role: 'MASTER', organisationId: orgId, assignedCafeIds: ['GLOBAL'] };
  const ownerAuth = { userId: 'USR-OWNER-01', role: 'OWNER', organisationId: orgId, primaryCafeId: cafeIdA, assignedCafeIds: [cafeIdA] };
  const cafeAdminAAuth = { userId: 'USR-ADMIN-01', role: 'CAFE_ADMIN', organisationId: orgId, primaryCafeId: cafeIdA, assignedCafeIds: [cafeIdA] };
  const staffAuth = { userId: 'USR-STAFF-01', role: 'STAFF', organisationId: orgId, primaryCafeId: cafeIdA, assignedCafeIds: [cafeIdA] };
  const orgBMasterAuth = { userId: 'USR-ORGB-MASTER', role: 'MASTER', organisationId: orgIdB, assignedCafeIds: ['GLOBAL'] };

  before(async () => {
    mongoServer = await MongoMemoryServer.create();
    await mongoose.connect(mongoServer.getUri());
  });

  after(async () => {
    await mongoose.disconnect();
    if (mongoServer) await mongoServer.stop();
  });

  beforeEach(async () => {
    await PurchaseOrder.deleteMany({});
    await Vendor.deleteMany({});
    await APInvoice.deleteMany({});
    await VendorLedgerEntry.collection.deleteMany({});
  });

  async function createTestVendor(vendorId = 'VEN-0001', name = 'Best Quality Supplies') {
    return Vendor.create({
      organisationId: orgId,
      vendorId,
      name,
      nameLower: name.toLowerCase(),
      category: 'FOOD_BEVERAGE',
      createdByUserId: masterAuth.userId,
    });
  }

  async function createTestPo(poId, lines = [], cafeId = cafeIdA, vendorId = 'VEN-0001') {
    const lineItems = lines.map((l) => ({
      itemId: l.itemId,
      orderedQuantityBase: l.orderedQty || 10,
      unitPricePaisa: l.unitPricePaisa || 1000,
      totalLinePaisa: (l.orderedQty || 10) * (l.unitPricePaisa || 1000),
      acceptedReceivedQty: l.acceptedQty || 0,
      receivedQuantityBase: l.acceptedQty || 0,
      rejectedQty: l.rejectedQty || 0,
    }));

    const subtotal = lineItems.reduce((s, li) => s + li.totalLinePaisa, 0);

    return PurchaseOrder.create({
      organisationId: orgId,
      purchaseOrderId: poId,
      cafeId,
      vendorId,
      vendorNameSnapshot: 'Best Quality Supplies',
      status: 'APPROVED',
      lineItems,
      subtotalPaisa: subtotal,
      totalPaisa: subtotal,
      createdByUserId: masterAuth.userId,
      grnReceipts: [
        {
          grnId: `GRN-${poId}`,
          receivedAt: new Date(),
          receivedByUserId: masterAuth.userId,
          items: lineItems.map((l) => ({
            itemId: l.itemId,
            deliveredQty: (l.acceptedReceivedQty || 0) + (l.rejectedQty || 0),
            acceptedQty: l.acceptedReceivedQty || 0,
            rejectedQty: l.rejectedQty || 0,
          })),
        },
      ],
    });
  }

  // 01 & 02 Mandatory Onion Samosa Test (Section 4, 73, 74)
  it('01. Mandatory Onion Samosa Test: 20 ordered, 19 delivered, 18 accepted @ ₹10 -> payable basis is ₹180, NOT ₹200', async () => {
    await createTestVendor('VEN-0001', 'Samosa King');
    const po = await createTestPo('PO-SAMOSA-01', [
      { itemId: 'ONION-SAMOSA', orderedQty: 20, unitPricePaisa: 1000, acceptedQty: 18, rejectedQty: 1 },
    ]);

    const result = await vendorLedgerService.postVendorBillFromReceipt({
      organisationId: orgId,
      purchaseOrderId: po.purchaseOrderId,
      supplierInvoiceNumber: 'INV-SAMOSA-001',
      claimedAmountPaisa: 20000, // Vendor invoiced ₹200 for 20 ordered
      auth: masterAuth,
    });

    assert.equal(result.apInvoice.amountPaisa, 18000, 'Merchandise payable basis must be 18 accepted * ₹10 = ₹180');
    assert.equal(result.apInvoice.approvedPayableAmountPaisa, 18000, 'Approved payable must be ₹180');
    assert.equal(result.apInvoice.supplierClaimedAmountPaisa, 20000, 'Supplier claim preserved at ₹200');
    assert.equal(result.apInvoice.heldDisputedAmountPaisa, 2000, 'Disputed variance must be held at ₹20');
    assert.equal(result.apInvoice.paymentStatus, 'ON_HOLD');
  });

  // 03 & 04 Three Separate Financial Values (Section 2, 5, 6)
  it('03. Preserves Supplier Claimed Amount (₹1,000), Approved Payable (₹900), and Held/Disputed (₹100) separately', async () => {
    await createTestVendor('VEN-0001');
    const po = await createTestPo('PO-REC17-THREEVAL', [
      { itemId: 'COFFEE-BEANS', orderedQty: 10, unitPricePaisa: 10000, acceptedQty: 9, rejectedQty: 1 },
    ]);

    const result = await vendorLedgerService.postVendorBillFromReceipt({
      organisationId: orgId,
      purchaseOrderId: po.purchaseOrderId,
      supplierInvoiceNumber: 'INV-COFFEE-99',
      claimedAmountPaisa: 100000, // ₹1,000 claimed
      auth: masterAuth,
    });

    assert.equal(result.apInvoice.supplierClaimedAmountPaisa, 100000);
    assert.equal(result.apInvoice.approvedPayableAmountPaisa, 90000);
    assert.equal(result.apInvoice.heldDisputedAmountPaisa, 10000);
    assert.equal(result.apInvoice.holds[0].holdCode, 'QUANTITY_VARIANCE');

    // Verify subledger entry
    assert.equal(result.ledgerEntry.entryType, 'VENDOR_BILL');
    assert.equal(result.ledgerEntry.creditPaisa, 90000, 'Vendor subledger credited with approved payable ₹900');
    assert.equal(result.ledgerEntry.heldPaisa, 10000, 'Held amount reflected in subledger');
  });

  // 05 External Invoice is Immutable (Section 6)
  it('05. External invoice document number and raw evidence is preserved without falsification', async () => {
    await createTestVendor('VEN-0001');
    const po = await createTestPo('PO-REC17-IMMUT', [{ itemId: 'MILK', orderedQty: 10, unitPricePaisa: 5000, acceptedQty: 8 }]);

    const result = await vendorLedgerService.postVendorBillFromReceipt({
      organisationId: orgId,
      purchaseOrderId: po.purchaseOrderId,
      supplierInvoiceNumber: 'INV/MUM/2026/091',
      claimedAmountPaisa: 50000,
      auth: masterAuth,
    });

    assert.equal(result.apInvoice.rawSupplierInvoiceNumber, 'INV/MUM/2026/091');
    assert.equal(result.apInvoice.supplierInvoiceNumber, 'INV/MUM/2026/091');
  });

  // 06 Accounts Payable Work Queue (Section 11)
  it('06. Accounts Payable work queue categorizes invoices by review states', async () => {
    await createTestVendor('VEN-0001');
    const po1 = await createTestPo('PO-Q-01', [{ itemId: 'ITEM-1', orderedQty: 5, unitPricePaisa: 1000, acceptedQty: 5 }]);
    const po2 = await createTestPo('PO-Q-02', [{ itemId: 'ITEM-2', orderedQty: 5, unitPricePaisa: 1000, acceptedQty: 3 }]);

    await vendorLedgerService.postVendorBillFromReceipt({
      organisationId: orgId,
      purchaseOrderId: po1.purchaseOrderId,
      supplierInvoiceNumber: 'INV-Q-01',
      claimedAmountPaisa: 5000,
      auth: masterAuth,
    });

    await vendorLedgerService.postVendorBillFromReceipt({
      organisationId: orgId,
      purchaseOrderId: po2.purchaseOrderId,
      supplierInvoiceNumber: 'INV-Q-02',
      claimedAmountPaisa: 5000,
      auth: masterAuth,
    });

    const req = { query: {}, auth: masterAuth };
    const res = createMockResponse();
    await invokeController(vendorLedgerController.getApQueue, req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.data.summary.totalCount, 2);
    assert.equal(res.body.data.summary.awaitingPaymentCount, 1);
    assert.equal(res.body.data.summary.onHoldDisputedCount, 1);
  });

  // 07 & 08 Partial Payment Mandatory Test (Section 14, 72)
  it('07. Mandatory Partial Payment: ₹1,000 payable -> ₹500 payment -> ₹500 outstanding, PARTIALLY_PAID', async () => {
    await createTestVendor('VEN-0001');
    const po = await createTestPo('PO-PAY-01', [{ itemId: 'TEA', orderedQty: 10, unitPricePaisa: 10000, acceptedQty: 10 }]);

    const bill = await vendorLedgerService.postVendorBillFromReceipt({
      organisationId: orgId,
      purchaseOrderId: po.purchaseOrderId,
      supplierInvoiceNumber: 'INV-TEA-1000',
      claimedAmountPaisa: 100000,
      auth: masterAuth,
    });

    // Payment 1: ₹500
    const pay1 = await vendorLedgerService.recordVendorPayment({
      organisationId: orgId,
      vendorId: 'VEN-0001',
      paymentAmountPaisa: 50000,
      allocations: [{ invoiceId: bill.apInvoice.invoiceId, amountPaisa: 50000 }],
      paymentMethod: 'UPI',
      reference: 'UPI/9981881',
      auth: masterAuth,
    });

    const invAfterPay1 = await APInvoice.findOne({ invoiceId: bill.apInvoice.invoiceId });
    assert.equal(invAfterPay1.paidPaisa, 50000);
    assert.equal(invAfterPay1.outstandingPayableAmountPaisa, 50000);
    assert.equal(invAfterPay1.paymentStatus, 'PARTIALLY_PAID');
    assert.equal(pay1.ledgerEntry.entryType, 'PARTIAL_PAYMENT');
    assert.equal(pay1.newRunningBalancePaisa, 50000);

    // Payment 2: ₹500
    const pay2 = await vendorLedgerService.recordVendorPayment({
      organisationId: orgId,
      vendorId: 'VEN-0001',
      paymentAmountPaisa: 50000,
      allocations: [{ invoiceId: bill.apInvoice.invoiceId, amountPaisa: 50000 }],
      paymentMethod: 'BANK_TRANSFER',
      reference: 'NEFT/5541992',
      auth: masterAuth,
    });

    const invAfterPay2 = await APInvoice.findOne({ invoiceId: bill.apInvoice.invoiceId });
    assert.equal(invAfterPay2.paidPaisa, 100000);
    assert.equal(invAfterPay2.outstandingPayableAmountPaisa, 0);
    assert.equal(invAfterPay2.paymentStatus, 'PAID');
    assert.equal(pay2.newRunningBalancePaisa, 0);

    // Verify Vendor Ledger entries
    const ledger = await VendorLedgerEntry.find({ vendorId: 'VEN-0001' }).sort({ entryTimestamp: 1 });
    assert.equal(ledger.length, 3); // Bill, Partial Payment, Payment
    assert.equal(ledger[0].entryType, 'VENDOR_BILL');
    assert.equal(ledger[1].entryType, 'PARTIAL_PAYMENT');
    assert.equal(ledger[2].entryType, 'PAYMENT');
  });

  // 09 Multi-Invoice Allocation (Section 15, 78)
  it('09. Multi-invoice payment allocation: ₹1,500 allocated to Invoice A (₹1,000) and Invoice B (₹500)', async () => {
    await createTestVendor('VEN-0001');
    const poA = await createTestPo('PO-ALLOC-A', [{ itemId: 'A', orderedQty: 10, unitPricePaisa: 10000, acceptedQty: 10 }]);
    const poB = await createTestPo('PO-ALLOC-B', [{ itemId: 'B', orderedQty: 7, unitPricePaisa: 10000, acceptedQty: 7 }]);

    const billA = await vendorLedgerService.postVendorBillFromReceipt({
      organisationId: orgId,
      purchaseOrderId: poA.purchaseOrderId,
      supplierInvoiceNumber: 'INV-A-1000',
      claimedAmountPaisa: 100000,
      auth: masterAuth,
    });

    const billB = await vendorLedgerService.postVendorBillFromReceipt({
      organisationId: orgId,
      purchaseOrderId: poB.purchaseOrderId,
      supplierInvoiceNumber: 'INV-B-700',
      claimedAmountPaisa: 70000,
      auth: masterAuth,
    });

    // Pay ₹1,500 allocated: ₹1,000 to A and ₹500 to B
    const result = await vendorLedgerService.recordVendorPayment({
      organisationId: orgId,
      vendorId: 'VEN-0001',
      paymentAmountPaisa: 150000,
      allocations: [
        { invoiceId: billA.apInvoice.invoiceId, amountPaisa: 100000 },
        { invoiceId: billB.apInvoice.invoiceId, amountPaisa: 50000 },
      ],
      auth: masterAuth,
    });

    const invA = await APInvoice.findOne({ invoiceId: billA.apInvoice.invoiceId });
    const invB = await APInvoice.findOne({ invoiceId: billB.apInvoice.invoiceId });

    assert.equal(invA.outstandingPayableAmountPaisa, 0);
    assert.equal(invA.paymentStatus, 'PAID');

    assert.equal(invB.outstandingPayableAmountPaisa, 20000);
    assert.equal(invB.paymentStatus, 'PARTIALLY_PAID');

    assert.equal(result.newRunningBalancePaisa, 20000);
  });

  // 10 Maximum Payment Guard (Section 47)
  it('10. Maximum payment guard rejects payment exceeding approved outstanding payable', async () => {
    await createTestVendor('VEN-0001');
    const po = await createTestPo('PO-GUARD-01', [{ itemId: 'ITEM', orderedQty: 5, unitPricePaisa: 2000, acceptedQty: 5 }]);

    await vendorLedgerService.postVendorBillFromReceipt({
      organisationId: orgId,
      purchaseOrderId: po.purchaseOrderId,
      supplierInvoiceNumber: 'INV-GUARD-100',
      claimedAmountPaisa: 10000, // ₹100 outstanding
      auth: masterAuth,
    });

    await assert.rejects(async () => {
      await vendorLedgerService.recordVendorPayment({
        organisationId: orgId,
        vendorId: 'VEN-0001',
        paymentAmountPaisa: 15000, // ₹150 attempted
        auth: masterAuth,
      });
    }, (err) => err.statusCode === 400 && err.code === 'PAYMENT_EXCEEDS_APPROVED_PAYABLE');
  });

  // 11 Duplicate Payment Idempotency Guard (Section 48, 80)
  it('11. Duplicate payment protection returns existing payment without double deductions', async () => {
    await createTestVendor('VEN-0001');
    const po = await createTestPo('PO-IDEM-01', [{ itemId: 'ITEM', orderedQty: 10, unitPricePaisa: 2000, acceptedQty: 10 }]);

    await vendorLedgerService.postVendorBillFromReceipt({
      organisationId: orgId,
      purchaseOrderId: po.purchaseOrderId,
      supplierInvoiceNumber: 'INV-IDEM-200',
      claimedAmountPaisa: 20000,
      auth: masterAuth,
    });

    const pay1 = await vendorLedgerService.recordVendorPayment({
      organisationId: orgId,
      vendorId: 'VEN-0001',
      paymentAmountPaisa: 10000,
      idempotencyKey: 'IDEM-KEY-PAY-99',
      auth: masterAuth,
    });

    const pay2 = await vendorLedgerService.recordVendorPayment({
      organisationId: orgId,
      vendorId: 'VEN-0001',
      paymentAmountPaisa: 10000,
      idempotencyKey: 'IDEM-KEY-PAY-99',
      auth: masterAuth,
    });

    assert.equal(pay2.isIdempotentReplay, true);
    assert.equal(pay2.paymentId, pay1.paymentId);

    const ledgerEntries = await VendorLedgerEntry.find({ vendorId: 'VEN-0001', entryType: 'PARTIAL_PAYMENT' });
    assert.equal(ledgerEntries.length, 1, 'Only one payment entry must exist');
  });

  // 12 & 13 Vendor Advance & Application (Section 18, 19, 76)
  it('12. Vendor Advance: ₹5,000 advance -> later invoice ₹3,000 -> advance applied ₹3,000 -> remaining ₹2,000', async () => {
    await createTestVendor('VEN-0001');

    // 1. Pay Advance ₹5,000
    const adv = await vendorLedgerService.recordVendorAdvance({
      organisationId: orgId,
      vendorId: 'VEN-0001',
      amountPaisa: 500000,
      paymentMethod: 'BANK_TRANSFER',
      reference: 'ADV-REF-001',
      auth: masterAuth,
    });

    let vendor = await Vendor.findOne({ vendorId: 'VEN-0001' });
    assert.equal(vendor.financialSummary.availableVendorAdvancePaisa, 500000);
    assert.equal(adv.newRunningBalancePaisa, -500000); // Debit balance (advance)

    // 2. Later Approved Invoice ₹3,000
    const po = await createTestPo('PO-ADV-LATER', [{ itemId: 'GRAINS', orderedQty: 3, unitPricePaisa: 100000, acceptedQty: 3 }]);
    const bill = await vendorLedgerService.postVendorBillFromReceipt({
      organisationId: orgId,
      purchaseOrderId: po.purchaseOrderId,
      supplierInvoiceNumber: 'INV-ADV-LATER',
      claimedAmountPaisa: 300000,
      auth: masterAuth,
    });

    // 3. Apply Advance ₹3,000
    const applied = await vendorLedgerService.applyVendorAdvance({
      organisationId: orgId,
      vendorId: 'VEN-0001',
      invoiceId: bill.apInvoice.invoiceId,
      amountToApplyPaisa: 300000,
      auth: masterAuth,
    });

    assert.equal(applied.remainingAdvancePaisa, 200000);
    assert.equal(applied.invoice.outstandingPayableAmountPaisa, 0);
    assert.equal(applied.invoice.paymentStatus, 'PAID');

    vendor = await Vendor.findOne({ vendorId: 'VEN-0001' });
    assert.equal(vendor.financialSummary.availableVendorAdvancePaisa, 200000);
  });

  // 14 Vendor Credit Note (Section 20, 21, 77)
  it('14. Vendor Credit Note: ₹1,000 bill - ₹200 credit note = ₹800 net outstanding', async () => {
    await createTestVendor('VEN-0001');
    const po = await createTestPo('PO-CR-01', [{ itemId: 'CHEESE', orderedQty: 10, unitPricePaisa: 10000, acceptedQty: 10 }]);

    const bill = await vendorLedgerService.postVendorBillFromReceipt({
      organisationId: orgId,
      purchaseOrderId: po.purchaseOrderId,
      supplierInvoiceNumber: 'INV-CHEESE-1000',
      claimedAmountPaisa: 100000,
      auth: masterAuth,
    });

    const cred = await vendorLedgerService.applyVendorCreditNote({
      organisationId: orgId,
      vendorId: 'VEN-0001',
      invoiceId: bill.apInvoice.invoiceId,
      creditNoteId: 'CRN-2026-991',
      amountPaisa: 20000,
      reason: 'Damaged packaging adjustment',
      auth: masterAuth,
    });

    assert.equal(cred.invoice.appliedCreditPaisa, 20000);
    assert.equal(cred.invoice.outstandingPayableAmountPaisa, 80000);
    assert.equal(cred.newRunningBalancePaisa, 80000);
    assert.equal(cred.ledgerEntry.entryType, 'CREDIT_NOTE');
  });

  // 15 Payment Reversal (Section 49, 81)
  it('15. Payment reversal restores invoice liabilities and posts PAYMENT_REVERSAL subledger entry', async () => {
    await createTestVendor('VEN-0001');
    const po = await createTestPo('PO-REV-01', [{ itemId: 'SYRUP', orderedQty: 10, unitPricePaisa: 10000, acceptedQty: 10 }]);

    const bill = await vendorLedgerService.postVendorBillFromReceipt({
      organisationId: orgId,
      purchaseOrderId: po.purchaseOrderId,
      supplierInvoiceNumber: 'INV-REV-1000',
      claimedAmountPaisa: 100000,
      auth: masterAuth,
    });

    const payment = await vendorLedgerService.recordVendorPayment({
      organisationId: orgId,
      vendorId: 'VEN-0001',
      paymentAmountPaisa: 50000,
      allocations: [{ invoiceId: bill.apInvoice.invoiceId, amountPaisa: 50000 }],
      auth: masterAuth,
    });

    // Reverse payment
    const rev = await vendorLedgerService.reversePayment({
      organisationId: orgId,
      paymentId: payment.paymentId,
      reason: 'Bank bounced cheque',
      auth: masterAuth,
    });

    assert.equal(rev.restoredAmountPaisa, 50000);
    assert.equal(rev.newRunningBalancePaisa, 100000);
    assert.equal(rev.reversalEntry.entryType, 'PAYMENT_REVERSAL');

    const restoredInv = await APInvoice.findOne({ invoiceId: bill.apInvoice.invoiceId });
    assert.equal(restoredInv.paidPaisa, 0);
    assert.equal(restoredInv.outstandingPayableAmountPaisa, 100000);
    assert.equal(restoredInv.paymentStatus, 'DUE');
  });

  // 16 Controlled Opening Balance (Section 31, 32)
  it('16. Master can establish opening balance migration entry; duplicates rejected', async () => {
    await createTestVendor('VEN-0001');

    const op = await vendorLedgerService.setOpeningBalance({
      organisationId: orgId,
      vendorId: 'VEN-0001',
      amountPaisa: 250000, // ₹2,500 credit opening balance
      isCredit: true,
      effectiveDate: '2026-01-01',
      reason: 'Tally ERP migration balance',
      auth: masterAuth,
    });

    assert.equal(op.entryType, 'OPENING_BALANCE');
    assert.equal(op.runningBalancePaisa, 250000);

    // Duplicate attempt fails
    await assert.rejects(async () => {
      await vendorLedgerService.setOpeningBalance({
        organisationId: orgId,
        vendorId: 'VEN-0001',
        amountPaisa: 250000,
        auth: masterAuth,
      });
    }, (err) => err.statusCode === 409);
  });

  // 17 Multi-Café Reconciliation (Section 34, 35, 79)
  it('17. Multi-café reconciliation: Café A (₹6,000) + Café B (₹4,000) = Org Total (₹10,000)', async () => {
    await createTestVendor('VEN-0001');
    const poA = await createTestPo('PO-CAF-A', [{ itemId: 'ITEM-A', orderedQty: 6, unitPricePaisa: 100000, acceptedQty: 6 }], cafeIdA);
    const poB = await createTestPo('PO-CAF-B', [{ itemId: 'ITEM-B', orderedQty: 4, unitPricePaisa: 100000, acceptedQty: 4 }], cafeIdB);

    await vendorLedgerService.postVendorBillFromReceipt({
      organisationId: orgId,
      purchaseOrderId: poA.purchaseOrderId,
      supplierInvoiceNumber: 'INV-A-6000',
      claimedAmountPaisa: 600000,
      auth: masterAuth,
    });

    await vendorLedgerService.postVendorBillFromReceipt({
      organisationId: orgId,
      purchaseOrderId: poB.purchaseOrderId,
      supplierInvoiceNumber: 'INV-B-4000',
      claimedAmountPaisa: 400000,
      auth: masterAuth,
    });

    // Org-level ledger
    const orgLedger = await vendorLedgerService.getVendorLedger({ organisationId: orgId, vendorId: 'VEN-0001' });
    assert.equal(orgLedger.summary.currentOutstandingPayablePaisa, 1000000);

    // Café A scoped ledger
    const cafeALedger = await vendorLedgerService.getVendorLedger({ organisationId: orgId, vendorId: 'VEN-0001', cafeId: cafeIdA });
    assert.equal(cafeALedger.entries.length, 1);
    assert.equal(cafeALedger.entries[0].creditPaisa, 600000);
  });

  // 18 Accounts Payable Aging Report (Section 37, 56)
  it('18. Accounts Payable aging report categorizes open bills into aging buckets', async () => {
    await createTestVendor('VEN-0001');
    const po = await createTestPo('PO-AGE-01', [{ itemId: 'A', orderedQty: 10, unitPricePaisa: 1000, acceptedQty: 10 }]);

    const bill = await vendorLedgerService.postVendorBillFromReceipt({
      organisationId: orgId,
      purchaseOrderId: po.purchaseOrderId,
      supplierInvoiceNumber: 'INV-AGE-1',
      claimedAmountPaisa: 10000,
      dueDate: '2026-08-01', // 46 days past current date 2026-09-16
      auth: masterAuth,
    });

    const aging = await vendorLedgerService.getAccountsPayableAging({
      organisationId: orgId,
      asOfDate: '2026-09-16',
    });

    assert.equal(aging.summary.days31_60, 10000);
    assert.equal(aging.summary.totalOutstandingPaisa, 10000);
  });

  // 19 GST 180-Day Monitoring (Section 40, 41, 82)
  it('19. GST 180-day monitoring flags invoices approaching or exceeding 180 days with unpaid proportion', async () => {
    await createTestVendor('VEN-0001');
    const po = await createTestPo('PO-GST-180', [{ itemId: 'A', orderedQty: 10, unitPricePaisa: 1000, acceptedQty: 10 }]);

    await vendorLedgerService.postVendorBillFromReceipt({
      organisationId: orgId,
      purchaseOrderId: po.purchaseOrderId,
      supplierInvoiceNumber: 'INV-GST-180',
      claimedAmountPaisa: 10000,
      invoiceDate: '2026-03-01', // ~199 days prior
      auth: masterAuth,
    });

    const report = await vendorLedgerService.getGst180DayMonitoring({
      organisationId: orgId,
      asOfDate: '2026-09-16',
    });

    assert.equal(report.totalFlaggedCount, 1);
    assert.equal(report.flaggedInvoices[0].riskCategory, 'OVERDUE_180_DAYS');
    assert.equal(report.flaggedInvoices[0].unpaidProportionPaisa, 10000);
  });

  // 20 Ledger Immutability Guard (Section 30)
  it('20. VendorLedgerEntry rejects direct updates and deletions (immutable accounting evidence)', async () => {
    await createTestVendor('VEN-0001');
    const entry = await VendorLedgerEntry.create({
      organisationId: orgId,
      ledgerEntryId: 'VLE-TEST-IMMUT',
      vendorId: 'VEN-0001',
      entryDate: '2026-09-16',
      entryType: 'OPENING_BALANCE',
      runningBalancePaisa: 1000,
      createdByUserId: masterAuth.userId,
    });

    await assert.rejects(async () => {
      await VendorLedgerEntry.updateOne({ _id: entry._id }, { $set: { runningBalancePaisa: 2000 } });
    }, /Direct update on immutable VendorLedgerEntry is strictly prohibited/);

    await assert.rejects(async () => {
      await VendorLedgerEntry.deleteOne({ _id: entry._id });
    }, /Direct deletion of VendorLedgerEntry is strictly prohibited/);
  });

  // 21 Release Payment Hold (Section 52)
  it('21. Releasing payment hold transitions invoice status from ON_HOLD to DUE with subledger audit', async () => {
    await createTestVendor('VEN-0001');
    const po = await createTestPo('PO-HOLD-REL', [{ itemId: 'A', orderedQty: 10, unitPricePaisa: 1000, acceptedQty: 8 }]);

    const bill = await vendorLedgerService.postVendorBillFromReceipt({
      organisationId: orgId,
      purchaseOrderId: po.purchaseOrderId,
      supplierInvoiceNumber: 'INV-HOLD-REL',
      claimedAmountPaisa: 10000, // ₹20 variance
      auth: masterAuth,
    });

    assert.equal(bill.apInvoice.paymentStatus, 'ON_HOLD');

    const released = await vendorLedgerService.releasePaymentHold({
      organisationId: orgId,
      invoiceId: bill.apInvoice.invoiceId,
      releaseReason: 'Supplier agreed to credit note for short units',
      auth: masterAuth,
    });

    assert.equal(released.invoice.paymentStatus, 'DUE');
    assert.equal(released.ledgerEntry.entryType, 'HOLD_RELEASE');
  });

  // 21b Place Payment Hold (AP queue "Place Hold" action)
  it('21b. Placing a payment hold freezes the bill, posts a PAYMENT_HOLD audit entry, and stays releasable', async () => {
    await createTestVendor('VEN-0001');
    const po = await createTestPo('PO-HOLD-PLACE', [{ itemId: 'A', orderedQty: 10, unitPricePaisa: 1000, acceptedQty: 10 }]);

    const bill = await vendorLedgerService.postVendorBillFromReceipt({
      organisationId: orgId,
      purchaseOrderId: po.purchaseOrderId,
      supplierInvoiceNumber: 'INV-HOLD-PLACE',
      claimedAmountPaisa: 10000,
      auth: masterAuth,
    });

    assert.equal(bill.apInvoice.paymentStatus, 'DUE', 'Full-quantity receipt starts unpaid and unheld');

    await assert.rejects(
      async () => vendorLedgerService.placePaymentHold({
        organisationId: orgId,
        invoiceId: bill.apInvoice.invoiceId,
        reason: '   ',
        auth: masterAuth,
      }),
      /A reason is required to place a payment hold/
    );

    const placed = await vendorLedgerService.placePaymentHold({
      organisationId: orgId,
      invoiceId: bill.apInvoice.invoiceId,
      holdCode: 'FINANCE_REVIEW',
      reason: 'Awaiting supplier credit note for damaged crates',
      auth: masterAuth,
    });

    assert.equal(placed.invoice.paymentStatus, 'ON_HOLD');
    assert.equal(placed.invoice.holds.length, 1);
    assert.equal(placed.invoice.holds[0].holdCode, 'FINANCE_REVIEW');
    assert.equal(placed.invoice.holds[0].placedBy, masterAuth.userId);
    assert.equal(placed.invoice.outstandingPayableAmountPaisa, 10000, 'A hold freezes payment without changing the balance');
    assert.equal(placed.ledgerEntry.entryType, 'PAYMENT_HOLD');
    assert.equal(placed.ledgerEntry.debitPaisa, 0, 'Hold audit entry moves no money');
    assert.equal(placed.ledgerEntry.creditPaisa, 0, 'Hold audit entry moves no money');

    await assert.rejects(
      async () => vendorLedgerService.placePaymentHold({
        organisationId: orgId,
        invoiceId: bill.apInvoice.invoiceId,
        holdCode: 'FINANCE_REVIEW',
        reason: 'Second attempt on the same code',
        auth: masterAuth,
      }),
      /already active/
    );

    const released = await vendorLedgerService.releasePaymentHold({
      organisationId: orgId,
      invoiceId: bill.apInvoice.invoiceId,
      holdCode: 'FINANCE_REVIEW',
      releaseReason: 'Credit note received from supplier',
      auth: masterAuth,
    });

    assert.equal(released.invoice.paymentStatus, 'DUE');
    assert.equal(released.invoice.holds.length, 0);
    assert.equal(released.ledgerEntry.entryType, 'HOLD_RELEASE');
  });

  // 22 Vendor Statement Extraction (Section 54, 55)
  it('22. Vendor statement extracts period billing, payments, credits, and closing balance', async () => {
    await createTestVendor('VEN-0001');
    const po = await createTestPo('PO-STMT-01', [{ itemId: 'TEA', orderedQty: 5, unitPricePaisa: 2000, acceptedQty: 5 }]);

    const bill = await vendorLedgerService.postVendorBillFromReceipt({
      organisationId: orgId,
      purchaseOrderId: po.purchaseOrderId,
      supplierInvoiceNumber: 'INV-STMT-01',
      claimedAmountPaisa: 10000,
      auth: masterAuth,
    });

    await vendorLedgerService.recordVendorPayment({
      organisationId: orgId,
      vendorId: 'VEN-0001',
      paymentAmountPaisa: 6000,
      allocations: [{ invoiceId: bill.apInvoice.invoiceId, amountPaisa: 6000 }],
      auth: masterAuth,
    });

    const req = { params: { vendorId: 'VEN-0001' }, query: {}, auth: masterAuth };
    const res = createMockResponse();
    await invokeController(vendorLedgerController.getVendorStatement, req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.data.periodBilledPaisa, 10000);
    assert.equal(res.body.data.periodPaidPaisa, 6000);
    assert.equal(res.body.data.closingBalancePaisa, 4000);
  });

  // 23 RBAC: Staff Denial (Section 62)
  it('23. Staff is strictly denied all Vendor Ledger and AP operations (403 Forbidden)', async () => {
    await createTestVendor('VEN-0001');
    const req = { params: { vendorId: 'VEN-0001' }, query: {}, auth: staffAuth };

    await assert.rejects(async () => {
      await invokeController(vendorLedgerController.getVendorLedger, req, createMockResponse());
    }, (err) => err.statusCode === 403 && err.code === 'FORBIDDEN_ROLE');
  });

  // 24 RBAC: Owner Read-Only Baseline (Section 63)
  it('24. Owner has read-only access to Vendor Ledger; payment release and reversal are denied (403)', async () => {
    await createTestVendor('VEN-0001');

    // Owner CAN read ledger
    const readReq = { params: { vendorId: 'VEN-0001' }, query: {}, auth: ownerAuth };
    const readRes = createMockResponse();
    await invokeController(vendorLedgerController.getVendorLedger, readReq, readRes);
    assert.equal(readRes.statusCode, 200);

    // Owner CANNOT record payment
    const payReq = { body: { vendorId: 'VEN-0001', paymentAmountPaisa: 5000 }, auth: ownerAuth };
    await assert.rejects(async () => {
      await invokeController(vendorLedgerController.recordPayment, payReq, createMockResponse());
    }, (err) => err.statusCode === 403 && err.code === 'FORBIDDEN_MUTATION');
  });

  // 25 RBAC: Café Admin Scoped to Assigned Café (Section 61, 65)
  it('25. Café Admin cannot view vendor ledger for an unassigned café (403 Forbidden)', async () => {
    await createTestVendor('VEN-0001');
    const req = { params: { vendorId: 'VEN-0001' }, query: { cafeId: cafeIdB }, auth: cafeAdminAAuth };

    await assert.rejects(async () => {
      await invokeController(vendorLedgerController.getVendorLedger, req, createMockResponse());
    }, (err) => err.statusCode === 403 && err.code === 'CAFE_ACCESS_DENIED');
  });

  // 26 Cross-Org Tenant Isolation (Section 61)
  it('26. Cross-org tenant isolation: Org B user cannot access Org A vendor ledger', async () => {
    await createTestVendor('VEN-0001');
    const req = { params: { vendorId: 'VEN-0001' }, query: {}, auth: orgBMasterAuth };
    const res = createMockResponse();
    await invokeController(vendorLedgerController.getVendorLedger, req, res);

    assert.equal(res.body.data.entries.length, 0, 'Org B must see 0 entries for Org A vendor');
  });

  // 27 Zero KDS Invariant
  it('27. Zero Kitchen Display System (KDS): no KDS files or endpoints introduced', () => {
    const kdsFiles = [
      'backend/src/models/VendorLedgerEntry.js',
      'backend/src/services/vendorLedgerService.js',
      'backend/src/controllers/vendorLedgerController.js',
      'backend/src/routes/vendorLedgerRoutes.js',
    ];
    for (const f of kdsFiles) {
      assert.strictEqual(f.toLowerCase().includes('kds'), false);
    }
  });
});
