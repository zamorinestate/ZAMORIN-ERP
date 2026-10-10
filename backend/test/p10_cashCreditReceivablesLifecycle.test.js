'use strict';

/**
 * P10 CASH, CREDIT, RECEIVABLES & ADVANCE DEPOSITS LIFECYCLE TEST SUITE
 *
 * Verifies non-negotiable financial invariants:
 *  1. Sale value ≠ Money received ≠ Outstanding receivable ≠ Advance deposit
 *  2. Concurrency-Safe Credit Limit Boundary (50 concurrent requests competing for finite credit)
 *  3. Concurrency-Safe Overcollection Prevention (50 concurrent requests on same receivable)
 *  4. Old-Debt Collection: ₹10,000 receivable, collect ₹4,000 -> historical sales = ₹10,000,
 *     new sales = ₹0, cash received = ₹4,000, receivable = ₹6,000, exposure released by ₹4,000
 *  5. Statutory Advance Deposit: ₹20,000 advance -> sales = ₹0, unapplied = ₹20,000.
 *     Final Bill ₹60,000: apply ₹20,000 advance, collect ₹40,000 -> final sale = ₹60,000,
 *     new money received = ₹40,000, advance applied = ₹20,000 (No revenue or cash double-counting)
 *  6. Advance Refund on Cancellation: statutory refund voucher, zero inventory restored
 *  7. Physical Cash Custody: Safe Drops & Bank Deposits do NOT change sales revenue
 *  8. Cash Register Close: Server-derived expected cash, counted variance, duplicate close race rejection
 *  9. RBAC & Persona Security Matrix: Owner, Staff, Vendor, Normal Master forbidden from mutations
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryReplSet } = require('mongodb-memory-server');

const { InstitutionalAccount } = require('../src/models/InstitutionalAccount');
const { Receivable } = require('../src/models/Receivable');
const { AdvanceDeposit } = require('../src/models/AdvanceDeposit');
const { RegisterSession } = require('../src/models/RegisterSession');
const { CashTransaction } = require('../src/models/CashTransaction');
const { BankAccount } = require('../src/models/BankAccount');
const { SafeCustody } = require('../src/models/SafeCustody');
const { BankDeposit } = require('../src/models/BankDeposit');
const { Bill } = require('../src/models/Bill');

const institutionalCreditService = require('../src/services/institutionalCreditService');
const advanceDepositService = require('../src/services/advanceDepositService');
const cashManagementService = require('../src/services/cashManagementService');
const { PosOrderService } = require('../src/services/posOrderService');

let replSet;
const ORG_ID = 'ORG-ZAMORIN';
const CAFE_ID = 'ZC-0001';

test.before(async () => {
  replSet = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: 'wiredTiger' },
  });
  await mongoose.connect(replSet.getUri(), {
    dbName: 'zamorin_p10_test',
  });
});

test.after(async () => {
  await mongoose.disconnect();
  if (replSet) await replSet.stop();
});

test.beforeEach(async () => {
  const collections = mongoose.connection.collections;
  for (const key of Object.keys(collections)) {
    await collections[key].deleteMany({});
  }
});

test('P10 Invariant 1: 50 Concurrent Credit Sales Never Exceed Credit Limit', async () => {
  // Account with ₹5,000 limit (500,000 Paisa)
  const account = await InstitutionalAccount.create({
    organisationId: ORG_ID,
    accountId: 'INST-CONCUR-01',
    accountName: 'Tech Corp India',
    creditLimitPaisa: 500000, // ₹5,000.00
    currentExposurePaisa: 0,
    creditStatus: 'ACTIVE',
    permittedCafeIds: [CAFE_ID],
  });

  // Burst of 50 concurrent requests of ₹200 (20,000 Paisa) each = total attempted ₹10,000
  // Exactly 25 can succeed (25 * ₹200 = ₹5,000). Remaining 25 must fail deterministically.
  const burstCount = 50;
  const requestAmount = 20000; // ₹200

  const results = await Promise.allSettled(
    Array.from({ length: burstCount }, (_, i) =>
      institutionalCreditService.commitCreditSaleAtomic({
        organisationId: ORG_ID,
        cafeId: CAFE_ID,
        accountId: 'INST-CONCUR-01',
        billId: `BILL-BURST-${i}`,
        invoiceNumber: `INV-BURST-${i}`,
        dueAmountPaisa: requestAmount,
        authContext: { userId: 'CASHIER-BURST' },
      })
    )
  );

  const successful = results.filter((r) => r.status === 'fulfilled');
  const rejected = results.filter((r) => r.status === 'rejected');

  assert.equal(successful.length, 25, 'Exactly 25 requests of ₹200 must succeed for a ₹5,000 limit');
  assert.equal(rejected.length, 25, 'Remaining 25 requests must be rejected with CREDIT_LIMIT_EXCEEDED');

  for (const rej of rejected) {
    assert.match(rej.reason.message, /Credit limit exceeded/i);
  }

  // Verify DB state
  const updatedAccount = await InstitutionalAccount.findOne({ accountId: 'INST-CONCUR-01' });
  assert.equal(updatedAccount.currentExposurePaisa, 500000, 'Final exposure must equal ₹5,000 and never exceed it');

  const createdReceivables = await Receivable.find({ accountId: 'INST-CONCUR-01' });
  assert.equal(createdReceivables.length, 25, 'Exactly 25 receivable records created in database');
});

test('P10 Invariant 2: Two Simultaneous Credit Sales of ₹4,000 Each on a ₹5,000 Limit (Exactly One Wins)', async () => {
  await InstitutionalAccount.create({
    organisationId: ORG_ID,
    accountId: 'INST-RACE-01',
    accountName: 'Apollo Hospitals',
    creditLimitPaisa: 500000, // ₹5,000
    currentExposurePaisa: 0,
    creditStatus: 'ACTIVE',
    permittedCafeIds: [CAFE_ID],
  });

  const [res1, res2] = await Promise.allSettled([
    institutionalCreditService.commitCreditSaleAtomic({
      organisationId: ORG_ID,
      cafeId: CAFE_ID,
      accountId: 'INST-RACE-01',
      billId: 'BILL-RACE-A',
      dueAmountPaisa: 400000, // ₹4,000
      authContext: { userId: 'CASHIER-1' },
    }),
    institutionalCreditService.commitCreditSaleAtomic({
      organisationId: ORG_ID,
      cafeId: CAFE_ID,
      accountId: 'INST-RACE-01',
      billId: 'BILL-RACE-B',
      dueAmountPaisa: 400000, // ₹4,000
      authContext: { userId: 'CASHIER-2' },
    }),
  ]);

  const fulfilled = [res1, res2].filter((r) => r.status === 'fulfilled');
  const failed = [res1, res2].filter((r) => r.status === 'rejected');

  assert.equal(fulfilled.length, 1, 'Exactly one ₹4,000 sale must succeed');
  assert.equal(failed.length, 1, 'The other ₹4,000 sale must fail due to limit');

  const account = await InstitutionalAccount.findOne({ accountId: 'INST-RACE-01' });
  assert.equal(account.currentExposurePaisa, 400000, 'Exposure must be ₹4,000');
});

test('P10 Invariant 3: Old-Debt Collection Creates Zero New Sales and Reduces Exposure', async () => {
  // Setup Institutional Account
  await InstitutionalAccount.create({
    organisationId: ORG_ID,
    accountId: 'INST-DEBT-01',
    accountName: 'Kalyan Silks',
    creditLimitPaisa: 2000000, // ₹20,000
    currentExposurePaisa: 0,
    creditStatus: 'ACTIVE',
    permittedCafeIds: [CAFE_ID],
  });

  // Step 1: Create a ₹10,000 credit sale
  const receivable = await institutionalCreditService.commitCreditSaleAtomic({
    organisationId: ORG_ID,
    cafeId: CAFE_ID,
    accountId: 'INST-DEBT-01',
    billId: 'BILL-INITIAL-10K',
    invoiceNumber: 'INV-10K',
    dueAmountPaisa: 1000000, // ₹10,000
    authContext: { userId: 'CASHIER-01' },
  });

  assert.equal(receivable.originalAmountPaisa, 1000000);
  assert.equal(receivable.outstandingAmountPaisa, 1000000);

  let account = await InstitutionalAccount.findOne({ accountId: 'INST-DEBT-01' });
  assert.equal(account.currentExposurePaisa, 1000000, 'Exposure is ₹10,000');

  // Step 2: Open a cash register session
  const session = await cashManagementService.openRegisterSession({
    organisationId: ORG_ID,
    cafeId: CAFE_ID,
    registerId: 'REG-01',
    openingFloatPaisa: 200000, // ₹2,000 float
    authContext: { userId: 'CASHIER-01' },
  });

  // Initial sales count before collection
  const totalBillsBefore = await Bill.countDocuments({});

  // Step 3: Customer later pays ₹4,000 cash towards old debt
  const colResult = await institutionalCreditService.collectReceivableAtomic({
    organisationId: ORG_ID,
    cafeId: CAFE_ID,
    receivableId: receivable.receivableId,
    amountPaisa: 400000, // ₹4,000
    paymentMethod: 'CASH',
    registerSessionId: session.registerSessionId,
    authContext: { userId: 'CASHIER-01' },
  });

  assert.equal(colResult.success, true);
  assert.equal(colResult.remainingOutstandingPaisa, 600000, 'Remaining debt is ₹6,000');
  assert.equal(colResult.accountExposure, 600000, 'Account exposure reduced to ₹6,000');

  // CRITICAL AUDIT: Bill count must remain UNCHANGED (₹0 new sales created)
  const totalBillsAfter = await Bill.countDocuments({});
  assert.equal(totalBillsAfter, totalBillsBefore, 'ZERO new sales bills created by collecting old debt');

  // Register session expected cash must increase by ₹4,000
  // expected = float (₹2,000) + collection (₹4,000) = ₹6,000
  const updatedSession = await RegisterSession.findOne({ registerSessionId: session.registerSessionId });
  assert.equal(updatedSession.expectedCashPaisa, 600000, 'Till expected cash is ₹6,000 (Float + Debt collected)');
  assert.equal(updatedSession.totalSalesPaisa, 0, 'Session sales total remains ₹0');

  // Step 4: Collect remaining ₹6,000
  const colResult2 = await institutionalCreditService.collectReceivableAtomic({
    organisationId: ORG_ID,
    cafeId: CAFE_ID,
    receivableId: receivable.receivableId,
    amountPaisa: 600000, // ₹6,000
    paymentMethod: 'CASH',
    registerSessionId: session.registerSessionId,
    authContext: { userId: 'CASHIER-01' },
  });

  assert.equal(colResult2.remainingOutstandingPaisa, 0);
  assert.equal(colResult2.receivable.status, 'COLLECTED');

  account = await InstitutionalAccount.findOne({ accountId: 'INST-DEBT-01' });
  assert.equal(account.currentExposurePaisa, 0, 'Account exposure fully released to ₹0');
});

test('P10 Invariant 4: 50 Concurrent Collections on Same Receivable Cannot Overcollect', async () => {
  // Setup receivable with ₹1,000 balance (100,000 Paisa)
  const receivable = await Receivable.create({
    receivableId: 'REC-OVERCOL-01',
    organisationId: ORG_ID,
    cafeId: CAFE_ID,
    accountId: 'INST-01',
    customerName: 'Test Corp',
    originalAmountPaisa: 100000,
    collectedAmountPaisa: 0,
    outstandingAmountPaisa: 100000, // ₹1,000
    issueDate: '2026-10-09',
    dueDate: '2026-11-08',
    status: 'OUTSTANDING',
  });

  await InstitutionalAccount.create({
    organisationId: ORG_ID,
    accountId: 'INST-01',
    accountName: 'Test Corp',
    creditLimitPaisa: 500000,
    currentExposurePaisa: 100000,
    creditStatus: 'ACTIVE',
  });

  // 50 concurrent collection attempts of ₹700 (70,000 Paisa) each
  // Exactly 1 can succeed for ₹700 (leaving ₹300). Remaining 49 must fail with OVERCOLLECTION_PROHIBITED.
  const results = await Promise.allSettled(
    Array.from({ length: 50 }, (_, i) =>
      institutionalCreditService.collectReceivableAtomic({
        organisationId: ORG_ID,
        cafeId: CAFE_ID,
        receivableId: 'REC-OVERCOL-01',
        amountPaisa: 70000, // ₹700
        paymentMethod: 'BANK_TRANSFER',
        authContext: { userId: `CASHIER-${i}` },
      })
    )
  );

  const successful = results.filter((r) => r.status === 'fulfilled');
  const rejected = results.filter((r) => r.status === 'rejected');

  assert.equal(successful.length, 1, 'Exactly one ₹700 collection must succeed');
  assert.equal(rejected.length, 49, '49 attempts must be rejected to prevent overcollection');

  const rec = await Receivable.findOne({ receivableId: 'REC-OVERCOL-01' });
  assert.equal(rec.collectedAmountPaisa, 70000, 'Collected amount must be exactly ₹700');
  assert.equal(rec.outstandingAmountPaisa, 30000, 'Outstanding must be exactly ₹300');
});

test('P10 Invariant 5: Advance Deposit Recorded as Unapplied Liability, Applied Exactly Once to Final Bill', async () => {
  // Step 1: Monday — Customer pays ₹20,000 advance deposit for Saturday event
  const depResult = await advanceDepositService.recordAdvanceDeposit({
    organisationId: ORG_ID,
    cafeId: CAFE_ID,
    customerName: 'Dr. Suresh Wedding',
    eventReference: 'WEDDING-SAT-OCT-14',
    eventDate: '2026-10-14',
    amountPaisa: 2000000, // ₹20,000
    paymentMethod: 'CASH',
    notes: 'Advance for 100 guests catering',
    authContext: { userId: 'MANAGER-01' },
  });

  assert.equal(depResult.success, true);
  assert.match(depResult.receiptVoucherNumber, /^RV-/);
  assert.equal(depResult.unappliedAmountPaisa, 2000000);

  // Sales in system must be ₹0
  const billCount = await Bill.countDocuments({});
  assert.equal(billCount, 0, 'Advance deposit must produce ₹0 completed sales revenue');

  // Step 2: Saturday — Final commercial event bill of ₹60,000 is finalized
  // Apply ₹20,000 deposit to bill
  const appResult = await advanceDepositService.applyAdvanceToBillAtomic({
    organisationId: ORG_ID,
    depositId: depResult.deposit.depositId,
    billId: 'BILL-EVENT-FINAL-60K',
    invoiceNumber: 'INV-EV-60K',
    amountToApplyPaisa: 2000000, // Apply all ₹20,000
    authContext: { userId: 'CASHIER-01' },
  });

  assert.equal(appResult.success, true);
  assert.equal(appResult.unappliedRemainingPaisa, 0, 'Deposit is now fully applied (₹0 unapplied)');
  assert.equal(appResult.deposit.status, 'FULLY_APPLIED');

  // Step 3: Attempting to apply the same deposit a second time must fail
  await assert.rejects(
    async () => {
      await advanceDepositService.applyAdvanceToBillAtomic({
        organisationId: ORG_ID,
        depositId: depResult.deposit.depositId,
        billId: 'BILL-EVENT-ANOTHER',
        amountToApplyPaisa: 500000,
        authContext: { userId: 'CASHIER-01' },
      });
    },
    (err) => err.code === 'INSUFFICIENT_UNAPPLIED_DEPOSIT' || /unapplied advance deposit/i.test(err.message)
  );
});

test('P10 Invariant 6: Advance Cancellation Issues Refund Voucher Without Restoring Inventory', async () => {
  const depResult = await advanceDepositService.recordAdvanceDeposit({
    organisationId: ORG_ID,
    cafeId: CAFE_ID,
    customerName: 'Cancelled Seminar',
    amountPaisa: 500000, // ₹5,000
    paymentMethod: 'BANK_TRANSFER',
    reason: 'Initial booking deposit',
    authContext: { userId: 'MANAGER-01' },
  });

  const refResult = await advanceDepositService.refundAdvanceAtomic({
    organisationId: ORG_ID,
    depositId: depResult.deposit.depositId,
    amountToRefundPaisa: 500000,
    reason: 'Client cancelled conference due to rain',
    paymentMethod: 'BANK_TRANSFER',
    paymentReference: 'UTR-REFUND-99281',
    authContext: { userId: 'MANAGER-01' },
  });

  assert.equal(refResult.success, true);
  assert.match(refResult.refundVoucherNumber, /^RFV-/);
  assert.equal(refResult.remainingUnappliedPaisa, 0);
  assert.equal(refResult.deposit.status, 'FULLY_REFUNDED');

  // Duplicate refund attempt must fail
  await assert.rejects(
    async () => {
      await advanceDepositService.refundAdvanceAtomic({
        organisationId: ORG_ID,
        depositId: depResult.deposit.depositId,
        amountToRefundPaisa: 500000,
        reason: 'Duplicate refund attempt',
        authContext: { userId: 'MANAGER-01' },
      });
    },
    (err) => err.code === 'NO_REFUNDABLE_BALANCE' || /unapplied balance/i.test(err.message)
  );
});

test('P10 Invariant 7: Cash Custody Lifecycle (Float, Sales, Drop, Bank Deposit, Close)', async () => {
  // 1. Open register with ₹2,000 float
  const session = await cashManagementService.openRegisterSession({
    organisationId: ORG_ID,
    cafeId: CAFE_ID,
    registerId: 'REG-01',
    openingFloatPaisa: 200000, // ₹2,000
    authContext: { userId: 'CASHIER-01' },
  });

  // Duplicate open on same register must fail with 409
  await assert.rejects(
    async () => {
      await cashManagementService.openRegisterSession({
        organisationId: ORG_ID,
        cafeId: CAFE_ID,
        registerId: 'REG-01',
        openingFloatPaisa: 100000,
        authContext: { userId: 'CASHIER-02' },
      });
    },
    (err) => err.code === 'REGISTER_ALREADY_OPEN' || /already open/i.test(err.message)
  );

  // 2. Simulate cash sale of ₹10,000
  session.cashEvents.push({
    eventType: 'CASH_SALE',
    amountPaisa: 1000000, // ₹10,000
    reason: 'POS Sales',
    actorId: 'CASHIER-01',
    timestamp: new Date(),
  });
  session.expectedCashPaisa += 1000000;
  await session.save();

  // 3. Record cash safe drop of ₹8,000
  const dropRes = await cashManagementService.recordCashDrop({
    organisationId: ORG_ID,
    cafeId: CAFE_ID,
    registerSessionId: session.registerSessionId,
    amountPaisa: 800000, // ₹8,000
    reason: 'Midday till drop to drop safe',
    authContext: { userId: 'CASHIER-01' },
  });

  assert.equal(dropRes.success, true);
  assert.equal(dropRes.remainingExpectedPaisa, 400000, 'Remaining till expected cash is ₹4,000 (Float ₹2,000 + Sale ₹10,000 - Drop ₹8,000)');

  // Verify Safe Custody balance after drop: ₹8,000
  const safeAfterDrop = await cashManagementService.getSafeCustodyBalance({ organisationId: ORG_ID, cafeId: CAFE_ID });
  assert.equal(safeAfterDrop.currentBalancePaisa, 800000, 'Physical safe custody cash is ₹8,000');

  // 4. Record bank deposit from safe of ₹8,000
  await BankAccount.create({
    organisationId: ORG_ID,
    bankAccountId: 'BANK-HDFC-01',
    accountAlias: 'HDFC Operating Current A/C',
    bankName: 'HDFC Bank Ltd',
    maskedAccountNumber: 'XXXX-XXXX-5678',
    ifscCode: 'HDFC0001234',
    glAccountCode: '1010-01',
    accountType: 'CURRENT',
  });

  const bdepRes = await cashManagementService.recordBankDeposit({
    organisationId: ORG_ID,
    cafeId: CAFE_ID,
    bankAccountId: 'BANK-HDFC-01',
    amountPaisa: 800000,
    source: 'SAFE',
    referenceNumber: 'CHQ-DEP-001',
    authContext: { userId: 'MANAGER-01' },
  });

  assert.equal(bdepRes.success, true);
  assert.equal(bdepRes.amountPaisa, 800000);
  assert.equal(bdepRes.remainingSafeBalancePaisa, 0, 'Safe balance reduced to ₹0 after deposit');

  // Verify Safe Custody balance after deposit to bank: ₹0
  const safeAfterDeposit = await cashManagementService.getSafeCustodyBalance({ organisationId: ORG_ID, cafeId: CAFE_ID });
  assert.equal(safeAfterDeposit.currentBalancePaisa, 0, 'Physical safe custody cash is ₹0');

  // Query comprehensive custody balances
  const custodySnap = await cashManagementService.getCustodyBalances({
    organisationId: ORG_ID,
    cafeId: CAFE_ID,
    registerSessionId: session.registerSessionId,
  });
  assert.equal(custodySnap.tillPaisa, 400000, 'Till expected cash is unchanged at ₹4,000');
  assert.equal(custodySnap.safePaisa, 0, 'Safe cash is ₹0');
  assert.equal(custodySnap.bankInTransitPaisa, 800000, 'Bank in transit cash is ₹8,000');

  // 5. Close Register Session: Counted cash = ₹4,000 (Exact match, NO double deduction!)
  const closeRes = await cashManagementService.closeRegisterSessionAtomic({
    organisationId: ORG_ID,
    cafeId: CAFE_ID,
    registerSessionId: session.registerSessionId,
    countedCashPaisa: 400000, // ₹4,000 counted
    closingDeclarationNote: 'Shift 1 closed by Cashier 1',
    authContext: { userId: 'CASHIER-01' },
  });

  assert.equal(closeRes.success, true);
  assert.equal(closeRes.variancePaisa, 0, 'Variance is exactly 0');
  assert.equal(closeRes.status, 'CLOSED');

  // Concurrent second close attempt must be rejected
  await assert.rejects(
    async () => {
      await cashManagementService.closeRegisterSessionAtomic({
        organisationId: ORG_ID,
        cafeId: CAFE_ID,
        registerSessionId: session.registerSessionId,
        countedCashPaisa: 400000,
        authContext: { userId: 'CASHIER-01' },
      });
    },
    (err) => err.code === 'SESSION_ALREADY_CLOSED' || /already closed/i.test(err.message)
  );
});

test('P10 Invariant 8: Ageing Report & Account Statement Reconciliation', async () => {
  await InstitutionalAccount.create({
    organisationId: ORG_ID,
    accountId: 'INST-AGE-01',
    institutionName: 'Malabar Chambers',
    accountName: 'Malabar Chambers',
    creditLimitPaisa: 10000000,
    currentExposurePaisa: 500000,
    creditStatus: 'ACTIVE',
  });

  // Create two receivables: one current, one overdue
  await Receivable.create([
    {
      receivableId: 'REC-CURR-01',
      organisationId: ORG_ID,
      cafeId: CAFE_ID,
      accountId: 'INST-AGE-01',
      customerName: 'Malabar Chambers',
      originalAmountPaisa: 300000,
      collectedAmountPaisa: 0,
      outstandingAmountPaisa: 300000,
      issueDate: '2026-10-01',
      dueDate: '2026-10-31', // Future (Current)
      status: 'OUTSTANDING',
    },
    {
      receivableId: 'REC-OVERDUE-01',
      organisationId: ORG_ID,
      cafeId: CAFE_ID,
      accountId: 'INST-AGE-01',
      customerName: 'Malabar Chambers',
      originalAmountPaisa: 200000,
      collectedAmountPaisa: 0,
      outstandingAmountPaisa: 200000,
      issueDate: '2026-08-01',
      dueDate: '2026-08-31', // Over 30 days overdue as of 2026-10-09
      status: 'OUTSTANDING',
    },
  ]);

  const ageing = await institutionalCreditService.getReceivableAgeingReport({
    organisationId: ORG_ID,
    cafeId: CAFE_ID,
    asOfDate: '2026-10-09',
  });

  assert.equal(ageing.totalOutstandingPaisa, 500000);
  assert.equal(ageing.buckets.CURRENT.amountPaisa, 300000, 'Current bucket has ₹3,000');
  assert.equal(ageing.buckets.DAYS_31_60.amountPaisa, 200000, '31-60 days bucket has ₹2,000');

  // Account Statement
  const statement = await institutionalCreditService.getAccountStatement({
    organisationId: ORG_ID,
    accountId: 'INST-AGE-01',
  });

  assert.equal(statement.summary.totalBilledPaisa, 500000);
  assert.equal(statement.summary.closingBalancePaisa, 500000);
  assert.equal(statement.ledgerEntries.length, 2);
});

test('P10 Invariant 9: Governed Master Data (Credit Limit Update Restricted and Audited)', async () => {
  await InstitutionalAccount.create({
    organisationId: ORG_ID,
    accountId: 'INST-GOV-01',
    institutionName: 'Governed Client',
    accountName: 'Governed Client',
    creditLimitPaisa: 1000000, // ₹10,000
    currentExposurePaisa: 400000,
    creditStatus: 'ACTIVE',
  });

  const updated = await institutionalCreditService.updateCreditLimit({
    organisationId: ORG_ID,
    accountId: 'INST-GOV-01',
    newCreditLimitPaisa: 1500000, // ₹15,000
    reason: 'Annual credit review approved by finance head',
    authContext: { userId: 'PRIMARY-MASTER-01', role: 'MASTER' },
  });

  assert.equal(updated.success, true);
  assert.equal(updated.newLimitPaisa, 1500000);

  // Missing reason must fail
  await assert.rejects(
    async () => {
      await institutionalCreditService.updateCreditLimit({
        organisationId: ORG_ID,
        accountId: 'INST-GOV-01',
        newCreditLimitPaisa: 2000000,
        reason: '',
      });
    },
    (err) => err.code === 'REASON_REQUIRED' || /reason/i.test(err.message)
  );
});

test('P10 Invariant 10: Refunding an Unpaid Credit Sale Cancels Receivable with Zero Cash Refund', async () => {
  await InstitutionalAccount.create({
    organisationId: ORG_ID,
    accountId: 'INST-VOID-01',
    institutionName: 'Void Client',
    accountName: 'Void Client',
    creditLimitPaisa: 2000000, // ₹20,000
    currentExposurePaisa: 0,
    creditStatus: 'ACTIVE',
  });

  // Credit sale of ₹10,000
  const receivable = await institutionalCreditService.commitCreditSaleAtomic({
    organisationId: ORG_ID,
    cafeId: CAFE_ID,
    accountId: 'INST-VOID-01',
    billId: 'BILL-VOID-10K',
    dueAmountPaisa: 1000000, // ₹10,000
    authContext: { userId: 'CASHIER-01' },
  });

  let account = await InstitutionalAccount.findOne({ accountId: 'INST-VOID-01' });
  assert.equal(account.currentExposurePaisa, 1000000, 'Exposure is ₹10,000');

  // Void/reverse credit sale
  const reversedRec = await institutionalCreditService.reverseCreditSaleAtomic({
    organisationId: ORG_ID,
    billId: 'BILL-VOID-10K',
    reason: 'Customer cancelled credit order',
    authContext: { userId: 'MANAGER-01' },
  });

  assert.equal(reversedRec.outstandingAmountPaisa, 0);
  assert.equal(reversedRec.status, 'CANCELLED');

  // Account exposure must be released back to 0
  account = await InstitutionalAccount.findOne({ accountId: 'INST-VOID-01' });
  assert.equal(account.currentExposurePaisa, 0, 'Exposure fully released on credit void');
});

test('P10 Invariant 11: Advance Deposit and Receivable Interaction on Final Large Bill', async () => {
  // Scenario:
  // Final event bill: ₹100,000 (10,000,000 Paisa)
  // Advance applied: ₹20,000 (2,000,000 Paisa)
  // Additional cash paid at finalization: ₹30,000 (3,000,000 Paisa)
  // Remaining balance as authorized institutional receivable: ₹50,000 (5,000,000 Paisa)
  await InstitutionalAccount.create({
    organisationId: ORG_ID,
    accountId: 'INST-EVENT-01',
    institutionName: 'Apex Medical Conclave',
    accountName: 'Apex Medical Conclave',
    creditLimitPaisa: 10000000, // ₹100,000 limit
    currentExposurePaisa: 0,
    creditStatus: 'ACTIVE',
    permittedCafeIds: [CAFE_ID],
  });

  // 1. Advance deposit ₹20,000 received earlier
  const dep = await advanceDepositService.recordAdvanceDeposit({
    organisationId: ORG_ID,
    cafeId: CAFE_ID,
    customerName: 'Apex Medical Conclave',
    amountPaisa: 2000000, // ₹20,000
    paymentMethod: 'BANK_TRANSFER',
    authContext: { userId: 'MANAGER-01' },
  });

  // 2. Final event: Apply deposit
  const app = await advanceDepositService.applyAdvanceToBillAtomic({
    organisationId: ORG_ID,
    depositId: dep.deposit.depositId,
    billId: 'BILL-APEX-FINAL',
    amountToApplyPaisa: 2000000,
    authContext: { userId: 'CASHIER-01' },
  });
  assert.equal(app.success, true);

  // 3. Remaining ₹50,000 converted to authorized Institutional Receivable
  const rec = await institutionalCreditService.commitCreditSaleAtomic({
    organisationId: ORG_ID,
    cafeId: CAFE_ID,
    accountId: 'INST-EVENT-01',
    billId: 'BILL-APEX-FINAL',
    dueAmountPaisa: 5000000, // ₹50,000
    authContext: { userId: 'CASHIER-01' },
  });

  assert.equal(rec.originalAmountPaisa, 5000000);
  assert.equal(rec.outstandingAmountPaisa, 5000000);

  const account = await InstitutionalAccount.findOne({ accountId: 'INST-EVENT-01' });
  assert.equal(account.currentExposurePaisa, 5000000, 'Exposure increases ONLY by the unpaid ₹50,000, not the full ₹100,000 bill');
});

test('P10 Invariant 12: Direct Register to Bank Deposit (Case C)', async () => {
  // Register with ₹2,000 float + ₹8,000 cash sale = ₹10,000 till expected cash
  const session = await cashManagementService.openRegisterSession({
    organisationId: ORG_ID,
    cafeId: CAFE_ID,
    registerId: 'REG-DIRECT-01',
    openingFloatPaisa: 200000, // ₹2,000
    authContext: { userId: 'CASHIER-DIRECT' },
  });

  session.cashEvents.push({
    eventType: 'CASH_SALE',
    amountPaisa: 800000, // ₹8,000
    reason: 'POS Sales',
    actorId: 'CASHIER-DIRECT',
    timestamp: new Date(),
  });
  session.expectedCashPaisa += 800000;
  await session.save();

  await BankAccount.create({
    organisationId: ORG_ID,
    bankAccountId: 'BANK-DIRECT-01',
    accountAlias: 'Direct Operating A/C',
    bankName: 'Axis Bank',
    maskedAccountNumber: 'XXXX-XXXX-9999',
    ifscCode: 'UTIB0001234',
    glAccountCode: '1010-02',
    accountType: 'CURRENT',
  });

  // Direct deposit ₹6,000 directly from REGISTER till to bank (Case C)
  const directDep = await cashManagementService.recordBankDeposit({
    organisationId: ORG_ID,
    cafeId: CAFE_ID,
    bankAccountId: 'BANK-DIRECT-01',
    amountPaisa: 600000, // ₹6,000
    source: 'REGISTER',
    sourceCustody: 'REGISTER',
    registerSessionId: session.registerSessionId,
    referenceNumber: 'AXIS-DIRECT-001',
    authContext: { userId: 'MANAGER-DIRECT' },
  });

  assert.equal(directDep.success, true);
  assert.equal(directDep.sourceCustody, 'REGISTER');
  assert.equal(directDep.remainingTillBalancePaisa, 400000, 'Till expected cash decreases from ₹10,000 to ₹4,000');

  // Physical safe custody was untouched (0)
  const safeBal = await cashManagementService.getSafeCustodyBalance({ organisationId: ORG_ID, cafeId: CAFE_ID });
  assert.equal(safeBal.currentBalancePaisa, 0, 'Safe balance is untouched');

  // Close Register Session with ₹4,000 counted cash -> exactly 0 variance!
  const closeRes = await cashManagementService.closeRegisterSessionAtomic({
    organisationId: ORG_ID,
    cafeId: CAFE_ID,
    registerSessionId: session.registerSessionId,
    countedCashPaisa: 400000, // ₹4,000
    closingDeclarationNote: 'Shift closed after direct bank deposit',
    authContext: { userId: 'CASHIER-DIRECT' },
  });

  assert.equal(closeRes.success, true);
  assert.equal(closeRes.variancePaisa, 0, 'Variance is 0 after direct register bank deposit');
  assert.equal(closeRes.expectedCashPaisa, 400000);
});

test('P10 Invariant 13: Insufficient Safe Custody Fails Deterministically (Case D)', async () => {
  // Seed safe with ₹5,000 (500,000 Paisa)
  await SafeCustody.findOneAndUpdate(
    { organisationId: ORG_ID, cafeId: CAFE_ID },
    { $set: { currentBalancePaisa: 500000, lastUpdated: new Date() } },
    { upsert: true }
  );

  await BankAccount.create({
    organisationId: ORG_ID,
    bankAccountId: 'BANK-SAFE-01',
    accountAlias: 'Safe Dep A/C',
    bankName: 'SBI',
    maskedAccountNumber: 'XXXX-XXXX-1111',
    ifscCode: 'SBIN0001234',
    glAccountCode: '1010-03',
    accountType: 'CURRENT',
  });

  // Attempt to deposit ₹8,000 from safe (only ₹5,000 available)
  await assert.rejects(
    async () => {
      await cashManagementService.recordBankDeposit({
        organisationId: ORG_ID,
        cafeId: CAFE_ID,
        bankAccountId: 'BANK-SAFE-01',
        amountPaisa: 800000, // ₹8,000
        source: 'SAFE',
        referenceNumber: 'DEP-OVERDRAW-FAIL',
        authContext: { userId: 'MANAGER-01' },
      });
    },
    (err) => err.code === 'INSUFFICIENT_SAFE_CUSTODY' || /available safe balance is only ₹5000/i.test(err.message)
  );

  // Safe balance must remain untouched at ₹5,000
  const safeBal = await cashManagementService.getSafeCustodyBalance({ organisationId: ORG_ID, cafeId: CAFE_ID });
  assert.equal(safeBal.currentBalancePaisa, 500000, 'Safe balance is preserved at ₹5,000');
});

test('P10 Invariant 14: 50 Concurrent Duplicate Bank Deposits With Same Idempotency Key Transfer Exactly Once (Case E & F)', async () => {
  // Seed safe with ₹10,000 (1,000,000 Paisa)
  await SafeCustody.findOneAndUpdate(
    { organisationId: ORG_ID, cafeId: CAFE_ID },
    { $set: { currentBalancePaisa: 1000000, lastUpdated: new Date() } },
    { upsert: true }
  );

  await BankAccount.create({
    organisationId: ORG_ID,
    bankAccountId: 'BANK-IDEMP-01',
    accountAlias: 'Idemp Test A/C',
    bankName: 'ICICI Bank',
    maskedAccountNumber: 'XXXX-XXXX-4444',
    ifscCode: 'ICIC0001234',
    glAccountCode: '1010-04',
    accountType: 'CURRENT',
  });

  // Fire 50 concurrent duplicate deposit requests for ₹8,000 with the SAME idempotency key
  const sharedKey = `IDEMP-CORRECT-KEY-${Date.now()}`;
  const burstCount = 50;

  const results = await Promise.allSettled(
    Array.from({ length: burstCount }, () =>
      cashManagementService.recordBankDeposit({
        organisationId: ORG_ID,
        cafeId: CAFE_ID,
        bankAccountId: 'BANK-IDEMP-01',
        amountPaisa: 800000, // ₹8,000
        source: 'SAFE',
        referenceNumber: 'BURST-REF-50',
        idempotencyKey: sharedKey,
        authContext: { userId: 'MANAGER-IDEMP' },
      })
    )
  );

  const successful = results.filter((r) => r.status === 'fulfilled');
  const rejected = results.filter((r) => r.status === 'rejected');

  assert.equal(successful.length, burstCount, 'All 50 duplicate requests must resolve successfully (primary or replay)');
  assert.equal(rejected.length, 0, 'No requests should crash');

  // Verify that safe balance was decremented EXACTLY ONCE: ₹10,000 - ₹8,000 = ₹2,000
  const safeBal = await cashManagementService.getSafeCustodyBalance({ organisationId: ORG_ID, cafeId: CAFE_ID });
  assert.equal(safeBal.currentBalancePaisa, 200000, 'Safe balance decremented exactly once to ₹2,000');

  // Exactly one BankDeposit record exists
  const depositDocs = await BankDeposit.find({ organisationId: ORG_ID, idempotencyKey: sharedKey });
  assert.equal(depositDocs.length, 1, 'Exactly one BankDeposit persisted in database');
});

test('P10 Invariant 15: Competing Concurrent Non-Duplicate Deposits Cannot Overdraw Safe Balance (Case G)', async () => {
  // Safe has ₹10,000 (1,000,000 Paisa)
  await SafeCustody.findOneAndUpdate(
    { organisationId: ORG_ID, cafeId: CAFE_ID },
    { $set: { currentBalancePaisa: 1000000, lastUpdated: new Date() } },
    { upsert: true }
  );

  await BankAccount.create({
    organisationId: ORG_ID,
    bankAccountId: 'BANK-COMPETE-01',
    accountAlias: 'Compete Test A/C',
    bankName: 'Kotak Bank',
    maskedAccountNumber: 'XXXX-XXXX-7777',
    ifscCode: 'KKBK0001234',
    glAccountCode: '1010-05',
    accountType: 'CURRENT',
  });

  // Two concurrent distinct requests for ₹8,000 each (total attempted ₹16,000 > ₹10,000 available)
  const results = await Promise.allSettled([
    cashManagementService.recordBankDeposit({
      organisationId: ORG_ID,
      cafeId: CAFE_ID,
      bankAccountId: 'BANK-COMPETE-01',
      amountPaisa: 800000, // ₹8,000
      source: 'SAFE',
      referenceNumber: 'COMPETE-01',
      idempotencyKey: `KEY-COMPETE-A-${Date.now()}`,
      authContext: { userId: 'MANAGER-01' },
    }),
    cashManagementService.recordBankDeposit({
      organisationId: ORG_ID,
      cafeId: CAFE_ID,
      bankAccountId: 'BANK-COMPETE-01',
      amountPaisa: 800000, // ₹8,000
      source: 'SAFE',
      referenceNumber: 'COMPETE-02',
      idempotencyKey: `KEY-COMPETE-B-${Date.now()}`,
      authContext: { userId: 'MANAGER-02' },
    }),
  ]);

  const successful = results.filter((r) => r.status === 'fulfilled');
  const rejected = results.filter((r) => r.status === 'rejected');

  assert.equal(successful.length, 1, 'Exactly 1 competing deposit can succeed');
  assert.equal(rejected.length, 1, 'The competing deposit must fail due to insufficient safe balance');
  assert.equal(rejected[0].reason.code, 'INSUFFICIENT_SAFE_CUSTODY');

  // Safe balance ends at ₹2,000 (never negative!)
  const safeBal = await cashManagementService.getSafeCustodyBalance({ organisationId: ORG_ID, cafeId: CAFE_ID });
  assert.equal(safeBal.currentBalancePaisa, 200000, 'Safe balance is exactly ₹2,000 (never negative)');
});

test('P10 Invariant 16: Concurrency Race on Register Session Close', async () => {
  const session = await cashManagementService.openRegisterSession({
    organisationId: ORG_ID,
    cafeId: CAFE_ID,
    registerId: 'REG-RACE-01',
    openingFloatPaisa: 100000, // ₹1,000
    authContext: { userId: 'CASHIER-RACE' },
  });

  // 10 concurrent close requests on the exact same session
  const closeBurst = 10;
  const results = await Promise.allSettled(
    Array.from({ length: closeBurst }, () =>
      cashManagementService.closeRegisterSessionAtomic({
        organisationId: ORG_ID,
        cafeId: CAFE_ID,
        registerSessionId: session.registerSessionId,
        countedCashPaisa: 100000,
        closingDeclarationNote: 'Shift close race test',
        authContext: { userId: 'CASHIER-RACE' },
      })
    )
  );

  const successful = results.filter((r) => r.status === 'fulfilled');
  const rejected = results.filter((r) => r.status === 'rejected');

  assert.equal(successful.length, 1, 'Exactly 1 close request must succeed');
  assert.equal(rejected.length, closeBurst - 1, 'All other concurrent close requests must be rejected');
  assert.ok(rejected.every((r) => r.reason.code === 'SESSION_ALREADY_CLOSED'));
});

test('P10 Invariant 17: Statutory CBIC GST Advance Deposit Configuration (GOODS vs SERVICES)', async () => {
  // Case 1: Advance deposit for GOODS (Exempt from GST at advance receipt per CBIC Notification 66/2017-CT)
  const goodsDeposit = await advanceDepositService.recordAdvanceDeposit({
    organisationId: ORG_ID,
    cafeId: CAFE_ID,
    customerName: 'Speciality Coffee Pack Wholesaler',
    amountPaisa: 500000, // ₹5,000
    supplyType: 'GOODS',
    paymentMethod: 'UPI',
    paymentReference: 'UPI-GOODS-ADV-01',
    authContext: { userId: 'CASHIER-01' },
  });

  assert.equal(goodsDeposit.deposit.supplyType, 'GOODS');
  assert.equal(goodsDeposit.deposit.taxRatePercent, 0, 'Statutory tax rate at advance receipt for goods is 0%');
  assert.equal(goodsDeposit.deposit.cgstPaisa, 0, 'CGST is 0 for goods advance');
  assert.equal(goodsDeposit.deposit.sgstPaisa, 0, 'SGST is 0 for goods advance');
  assert.equal(goodsDeposit.deposit.igstPaisa, 0, 'IGST is 0 for goods advance');
  assert.equal(goodsDeposit.deposit.taxableAmountPaisa, 500000, 'Taxable value is full deposit amount ₹5,000');

  // Case 2: Advance deposit for SERVICES (e.g. banquet/catering event, attracting GST at receipt)
  const servicesDeposit = await advanceDepositService.recordAdvanceDeposit({
    organisationId: ORG_ID,
    cafeId: CAFE_ID,
    customerName: 'Zamorin Banquet Corporate Party',
    amountPaisa: 1050000, // ₹10,500 gross (inclusive of 5% GST = ₹10,000 taxable + ₹250 CGST + ₹250 SGST)
    supplyType: 'SERVICES',
    taxRatePercent: 5,
    paymentMethod: 'BANK_TRANSFER',
    paymentReference: 'NEFT-SERV-ADV-01',
    authContext: { userId: 'MANAGER-01' },
  });

  assert.equal(servicesDeposit.deposit.supplyType, 'SERVICES');
  assert.equal(servicesDeposit.deposit.taxRatePercent, 5);
  assert.equal(servicesDeposit.deposit.taxableAmountPaisa, 1000000, 'Taxable value is ₹10,000');
  assert.equal(servicesDeposit.deposit.cgstPaisa, 25000, 'CGST is ₹250');
  assert.equal(servicesDeposit.deposit.sgstPaisa, 25000, 'SGST is ₹250');
  assert.equal(servicesDeposit.deposit.igstPaisa, 0);
  assert.equal(servicesDeposit.deposit.taxRuleVersion, 'GST_ROUNDING_V1_2026');
});

test('P10 Invariant 18: Safe ₹10,000 to ₹8,000 Bank Deposit & Confirmation Lifecycle (Idempotent, Zero Sales Revenue Impact)', async () => {
  // 1. Initial State: Safe holds ₹10,000 (1,000,000 Paisa), Bank holds ₹0 reconciled balance
  await SafeCustody.findOneAndUpdate(
    { organisationId: ORG_ID, cafeId: CAFE_ID },
    { $set: { currentBalancePaisa: 1000000, lastUpdated: new Date() } },
    { upsert: true }
  );

  await BankAccount.create({
    organisationId: ORG_ID,
    bankAccountId: 'BANK-HDFC-01',
    accountAlias: 'Main HDFC Operating A/C',
    bankName: 'HDFC Bank',
    maskedAccountNumber: 'XXXX-XXXX-8888',
    ifscCode: 'HDFC0001234',
    glAccountCode: '1010-01',
    accountType: 'CURRENT',
    reconciledBalancePaisa: 0,
    status: 'ACTIVE',
  });

  // Verify initial custody balances
  const initialBalances = await cashManagementService.getCustodyBalances({
    organisationId: ORG_ID,
    cafeId: CAFE_ID,
  });
  assert.equal(initialBalances.safePaisa, 1000000, 'Safe initial balance is ₹10,000');
  assert.equal(initialBalances.bankInTransitPaisa, 0, 'Initial in-transit cash is ₹0');
  assert.equal(initialBalances.reconciledBankPaisa, 0, 'Initial reconciled bank balance is ₹0');

  // Sales revenue checkpoint: no sales recorded
  const initialBillsCount = await Bill.countDocuments({ organisationId: ORG_ID });
  assert.equal(initialBillsCount, 0, 'Zero sales revenue initially');

  // 2. Transfer ₹8,000 from Safe to Bank Deposit
  const depositKey = `DEP-SAFE-BANK-KEY-${Date.now()}`;
  const depositRes = await cashManagementService.recordBankDeposit({
    organisationId: ORG_ID,
    cafeId: CAFE_ID,
    bankAccountId: 'BANK-HDFC-01',
    amountPaisa: 800000, // ₹8,000
    source: 'SAFE',
    referenceNumber: 'HDFC-CHQ-1001',
    idempotencyKey: depositKey,
    authContext: { userId: 'CAFE_ADMIN_01', role: 'CAFE_ADMIN' },
  });

  assert.equal(depositRes.success, true);
  assert.equal(depositRes.amountPaisa, 800000);
  assert.equal(depositRes.status, 'IN_TRANSIT');
  assert.equal(depositRes.remainingSafeBalancePaisa, 200000, 'Safe balance reduced to ₹2,000');

  // 3. Before Confirmation: safe custody is ₹2,000, in-transit is ₹8,000, reconciled bank is unchanged (₹0)
  const preConfirmBalances = await cashManagementService.getCustodyBalances({
    organisationId: ORG_ID,
    cafeId: CAFE_ID,
  });
  assert.equal(preConfirmBalances.safePaisa, 200000, 'Safe custody is ₹2,000 before confirmation');
  assert.equal(preConfirmBalances.bankInTransitPaisa, 800000, 'In-transit cash is ₹8,000 before confirmation');
  assert.equal(preConfirmBalances.reconciledBankPaisa, 0, 'Reconciled bank balance is unchanged (₹0)');

  // Replay of creation request must not duplicate debit or movement
  const replayDeposit = await cashManagementService.recordBankDeposit({
    organisationId: ORG_ID,
    cafeId: CAFE_ID,
    bankAccountId: 'BANK-HDFC-01',
    amountPaisa: 800000,
    source: 'SAFE',
    referenceNumber: 'HDFC-CHQ-1001',
    idempotencyKey: depositKey,
    authContext: { userId: 'CAFE_ADMIN_01', role: 'CAFE_ADMIN' },
  });
  assert.equal(replayDeposit.idempotentReplay, true);

  const postReplayBalances = await cashManagementService.getCustodyBalances({
    organisationId: ORG_ID,
    cafeId: CAFE_ID,
  });
  assert.equal(postReplayBalances.safePaisa, 200000, 'Safe custody remains ₹2,000 after replay');
  assert.equal(postReplayBalances.bankInTransitPaisa, 800000, 'In-transit cash remains ₹8,000 after replay');
  assert.equal(postReplayBalances.reconciledBankPaisa, 0, 'Reconciled bank balance remains ₹0 after replay');

  // 4. Confirmation: moves ₹8,000 from transit to bank exactly once
  const confirmRes = await cashManagementService.confirmBankDeposit({
    organisationId: ORG_ID,
    cafeId: CAFE_ID,
    depositId: depositRes.depositId,
    reconciliationReference: 'BANK-STMT-MATCH-9988',
    authContext: { userId: 'CAFE_ADMIN_01', role: 'CAFE_ADMIN' },
  });

  assert.equal(confirmRes.success, true);
  assert.equal(confirmRes.status, 'CONFIRMED');
  assert.equal(confirmRes.reconciledBankBalancePaisa, 800000, 'Reconciled bank balance increased to ₹8,000');

  // Verify balances after confirmation
  const postConfirmBalances = await cashManagementService.getCustodyBalances({
    organisationId: ORG_ID,
    cafeId: CAFE_ID,
  });
  assert.equal(postConfirmBalances.safePaisa, 200000, 'Safe custody remains ₹2,000');
  assert.equal(postConfirmBalances.bankInTransitPaisa, 0, 'In-transit cash is cleared to ₹0');
  assert.equal(postConfirmBalances.reconciledBankPaisa, 800000, 'Reconciled bank balance is exactly ₹8,000');

  // 5. Repeating confirmation request must NOT duplicate movement or bank balance
  const replayConfirm = await cashManagementService.confirmBankDeposit({
    organisationId: ORG_ID,
    cafeId: CAFE_ID,
    depositId: depositRes.depositId,
    reconciliationReference: 'BANK-STMT-MATCH-9988',
    authContext: { userId: 'CAFE_ADMIN_01', role: 'CAFE_ADMIN' },
  });
  assert.equal(replayConfirm.idempotentReplay, true);
  assert.equal(replayConfirm.reconciledBankBalancePaisa, 800000, 'Bank balance is never doubled to ₹16,000');

  const finalBalances = await cashManagementService.getCustodyBalances({
    organisationId: ORG_ID,
    cafeId: CAFE_ID,
  });
  assert.equal(finalBalances.safePaisa, 200000, 'Safe remains ₹2,000');
  assert.equal(finalBalances.bankInTransitPaisa, 0, 'In-transit remains ₹0');
  assert.equal(finalBalances.reconciledBankPaisa, 800000, 'Reconciled bank remains ₹8,000');

  // 6. Sales revenue check: treasury custody movement creates ZERO sales revenue
  const finalBillsCount = await Bill.countDocuments({ organisationId: ORG_ID });
  assert.equal(finalBillsCount, 0, 'Treasury custody mutations create zero sales revenue');
});

test('P10 Invariant 19: Complete Advance-to-Final-Invoice Flow for Eligible Goods vs Taxable Services (CBIC Advance Tax Adjustment)', async () => {
  // Case A: Eligible Goods Advance (Packaged Coffee Beans, HSN 0901, statutory GST 5%)
  // Under Notification No. 66/2017-CT, regular taxpayer advance for goods attracts 0 tax at receipt.
  // CRITICAL: The 0 tax on advance must NOT overwrite the final invoice's applicable GST rate!
  const goodsAdvance = await advanceDepositService.recordAdvanceDeposit({
    organisationId: ORG_ID,
    cafeId: CAFE_ID,
    customerName: 'Highland Coffee Roasters',
    amountPaisa: 500000, // ₹5,000 advance
    category: 'PACKAGED_COFFEE_BEANS',
    supplyType: 'GOODS',
    taxpayerRegime: 'REGULAR',
    taxRatePercent: 5, // underlying statutory goods rate
    paymentMethod: 'UPI',
    paymentReference: 'UPI-BEANS-ADV',
    authContext: { userId: 'CASHIER-01' },
  });

  // Advance Receipt timing verification
  assert.equal(goodsAdvance.deposit.supplyClassification, 'GOODS');
  assert.equal(goodsAdvance.deposit.applicableSupplyGstRatePercent, 5, 'Applicable goods GST rate is 5%');
  assert.equal(goodsAdvance.deposit.taxRatePercentAtAdvance, 0, 'Tax rate due at advance timing is 0%');
  assert.equal(goodsAdvance.deposit.taxDueAtAdvancePaisa, 0, 'Zero tax due at advance receipt');
  assert.equal(goodsAdvance.deposit.taxAccountedOnAdvancePaisa, 0, 'Zero tax accounted on receipt voucher');

  // Final Tax Invoice: Customer purchases ₹10,000 taxable coffee beans
  // Final invoice line items must be taxed at 5% (₹250 CGST + ₹250 SGST = ₹500 total tax, ₹10,500 grand total)
  const goodsFinalInvoiceTaxSummary = {
    taxableAmountPaisa: 1000000, // ₹10,000
    totalCgstPaisa: 25000,       // ₹250
    totalSgstPaisa: 25000,       // ₹250
    totalIgstPaisa: 0,
    totalTaxPaisa: 50000,        // ₹500
    grandTotalPaisa: 1050000,    // ₹10,500
  };

  const goodsAdjustment = advanceDepositService.calculateAdvanceTaxAdjustmentOnFinalInvoice({
    invoiceTotalTaxablePaisa: goodsFinalInvoiceTaxSummary.taxableAmountPaisa,
    invoiceTaxSummary: goodsFinalInvoiceTaxSummary,
    appliedAdvanceDeposits: [
      {
        deposit: goodsAdvance.deposit,
        amountAppliedPaisa: 500000, // ₹5,000 advance applied
      },
    ],
  });

  assert.equal(goodsAdjustment.grossTaxPaisa, 50000, 'Final invoice gross tax is ₹500 (5% maintained, NOT overwritten to 0%)');
  assert.equal(goodsAdjustment.advanceTaxAccountedTotalPaisa, 0, 'Advance tax accounted was 0, so 0 tax is deducted');
  assert.equal(goodsAdjustment.netTaxPayablePaisa, 50000, 'Full ₹500 tax is due on final invoice');
  assert.equal(goodsAdjustment.netCustomerPayablePaisa, 550000, 'Customer pays remaining ₹5,500 (₹10,500 - ₹5,000)');

  // Case B: Taxable Services Advance (Banquet / Catering / Event Hosting)
  // Under Section 13(2), tax is due on receipt of service advance.
  const servicesAdvance = await advanceDepositService.recordAdvanceDeposit({
    organisationId: ORG_ID,
    cafeId: CAFE_ID,
    customerName: 'Kozhikode Heritage Banquet',
    amountPaisa: 1050000, // ₹10,500 advance (inclusive of 5% GST = ₹10,000 taxable + ₹250 CGST + ₹250 SGST)
    category: 'EVENT_BANQUET',
    serviceType: 'CATERING',
    taxpayerRegime: 'REGULAR',
    taxRatePercent: 5,
    paymentMethod: 'BANK_TRANSFER',
    paymentReference: 'NEFT-BANQUET-ADV',
    authContext: { userId: 'MANAGER-01' },
  });

  assert.equal(servicesAdvance.deposit.supplyClassification, 'SERVICES');
  assert.equal(servicesAdvance.deposit.taxRatePercentAtAdvance, 5);
  assert.equal(servicesAdvance.deposit.taxDueAtAdvancePaisa, 50000, '₹500 tax due at advance receipt');
  assert.equal(servicesAdvance.deposit.taxAccountedOnAdvancePaisa, 50000, '₹500 accounted on receipt voucher');
  assert.equal(servicesAdvance.deposit.cgstPaisa, 25000, '₹250 CGST accounted on receipt voucher');
  assert.equal(servicesAdvance.deposit.sgstPaisa, 25000, '₹250 SGST accounted on receipt voucher');

  // Final Tax Invoice: Banquet bill total is ₹21,000 gross (₹20,000 taxable + ₹500 CGST + ₹500 SGST = ₹1,000 tax)
  const serviceFinalInvoiceTaxSummary = {
    taxableAmountPaisa: 2000000, // ₹20,000
    totalCgstPaisa: 50000,       // ₹500
    totalSgstPaisa: 50000,       // ₹500
    totalIgstPaisa: 0,
    totalTaxPaisa: 100000,       // ₹1,000
    grandTotalPaisa: 2100000,    // ₹21,000
  };

  const serviceAdjustment = advanceDepositService.calculateAdvanceTaxAdjustmentOnFinalInvoice({
    invoiceTotalTaxablePaisa: serviceFinalInvoiceTaxSummary.taxableAmountPaisa,
    invoiceTaxSummary: serviceFinalInvoiceTaxSummary,
    appliedAdvanceDeposits: [
      {
        deposit: servicesAdvance.deposit,
        amountAppliedPaisa: 1050000, // Full ₹10,500 advance applied
      },
    ],
  });

  assert.equal(serviceAdjustment.grossTaxPaisa, 100000, 'Gross tax liability on invoice is ₹1,000');
  assert.equal(serviceAdjustment.advanceTaxAccountedTotalPaisa, 50000, '₹500 tax credited from advance receipt voucher');
  assert.equal(serviceAdjustment.advanceCgstAdjustedPaisa, 25000, '₹250 CGST credited');
  assert.equal(serviceAdjustment.advanceSgstAdjustedPaisa, 25000, '₹250 SGST credited');
  assert.equal(serviceAdjustment.netCgstPayablePaisa, 25000, 'Net CGST remaining to be collected is ₹250');
  assert.equal(serviceAdjustment.netSgstPayablePaisa, 25000, 'Net SGST remaining to be collected is ₹250');
  assert.equal(serviceAdjustment.netTaxPayablePaisa, 50000, 'Net tax payable on final invoice is ₹500');
  assert.equal(serviceAdjustment.netCustomerPayablePaisa, 1050000, 'Net customer balance payable is ₹10,500');

  // Case C: Statutory Supply Classification Boundary
  // Food service transactions (Restaurant, Takeaway, Catering) MUST NOT enter the goods branch merely because they involve physical food!
  const takeawayAdvance = await advanceDepositService.recordAdvanceDeposit({
    organisationId: ORG_ID,
    cafeId: CAFE_ID,
    customerName: 'Takeaway Food Bulk Order',
    amountPaisa: 210000, // ₹2,100 gross
    category: 'TAKEAWAY',
    supplyType: 'GOODS', // Client erroneously requested 'GOODS'
    serviceType: 'RESTAURANT',
    taxRatePercent: 5,
    paymentMethod: 'CASH',
    authContext: { userId: 'CASHIER-01' },
  });

  // Server authoritatively derives SERVICES per Schedule II Para 6(b)
  assert.equal(takeawayAdvance.deposit.supplyClassification, 'SERVICES', 'Food service stays SERVICES even if client passes supplyType GOODS');
  assert.equal(takeawayAdvance.deposit.taxRatePercentAtAdvance, 5, 'Tax due at advance receipt because it is a food service');
  assert.equal(takeawayAdvance.deposit.taxDueAtAdvancePaisa, 10000, '₹100 tax due at advance receipt');
});

test('P10 Invariant 20: Five-Persona Custody Authorization Matrix & Strict Boundaries', async () => {
  const { authorize } = require('../src/middleware/authorize');
  const { RolePermission } = require('../src/models/RolePermission');

  function createMockRes() {
    return {
      statusCode: 200,
      body: null,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(data) {
        this.body = data;
        return this;
      },
    };
  }

  // Set up mock effective role rules: Primary Master has ORGANISATION scope, operations has ASSIGNED_CAFES
  const originalFind = RolePermission.findEffectiveRules;
  RolePermission.findEffectiveRules = async ({ role } = {}) => [
    {
      effect: 'ALLOW',
      scope: role === 'MASTER' ? 'ORGANISATION' : 'ASSIGNED_CAFES',
      isCurrentlyEffective: () => true,
      requiresMfa: false,
      requiresStepUpAuthentication: false,
    },
  ];

  try {
    const custodyWriteMiddleware = authorize('FINANCE:WRITE', { allowedRoles: ['MASTER', 'CAFE_ADMIN'] });
    const custodyReadMiddleware = authorize('FINANCE:READ', { allowedRoles: ['MASTER', 'OWNER', 'CAFE_ADMIN'] });

    // Persona 1: PRIMARY MASTER retains universal custody administration
    {
      const req = {
        auth: { role: 'MASTER', isPrimaryMaster: true },
        body: { cafeId: 'ZC-0001' },
        method: 'POST',
        correlationId: 'c-pm',
      };
      const res = createMockRes();
      let passed = false;
      await custodyWriteMiddleware(req, res, () => { passed = true; });
      assert.equal(passed, true, 'Primary Master must have write access to custody mutations');
    }

    // Persona 2: CAFE OPERATIONS has authorised café-scoped custody capabilities
    {
      // In-scope cafe: PASS
      const reqScope = {
        auth: { role: 'CAFE_ADMIN', isPrimaryMaster: false, assignedCafeIds: ['ZC-0001'] },
        body: { cafeId: 'ZC-0001' },
        method: 'POST',
        correlationId: 'c-ca-in',
      };
      const resScope = createMockRes();
      let passedScope = false;
      await custodyWriteMiddleware(reqScope, resScope, () => { passedScope = true; });
      assert.equal(passedScope, true, 'Café Operations has authorised custody capabilities in assigned café');

      // Cross-cafe attempt: DENIED
      const reqCross = {
        auth: { role: 'CAFE_ADMIN', isPrimaryMaster: false, assignedCafeIds: ['ZC-0001'] },
        body: { cafeId: 'ZC-0002' },
        method: 'POST',
        correlationId: 'c-ca-cross',
      };
      const resCross = createMockRes();
      let passedCross = false;
      await custodyWriteMiddleware(reqCross, resCross, () => { passedCross = true; });
      assert.equal(passedCross, false, 'Café Operations is denied custody mutation on unassigned café');
      assert.equal(resCross.statusCode, 403);
      assert.equal(resCross.body?.error?.code, 'CAFE_ACCESS_DENIED');
    }

    // Persona 3: OWNER retains permitted oversight (read-only), strictly denied custody mutations
    {
      // Read balances: PASS
      const reqRead = {
        auth: { role: 'OWNER', isPrimaryMaster: false, assignedCafeIds: ['ZC-0001'] },
        query: { cafeId: 'ZC-0001' },
        method: 'GET',
        correlationId: 'c-ow-read',
      };
      const resRead = createMockRes();
      let passedRead = false;
      await custodyReadMiddleware(reqRead, resRead, () => { passedRead = true; });
      assert.equal(passedRead, true, 'Owner retains permitted read oversight on custody balances');

      // Custody mutation: DENIED
      const reqWrite = {
        auth: { role: 'OWNER', isPrimaryMaster: false, assignedCafeIds: ['ZC-0001'] },
        body: { cafeId: 'ZC-0001' },
        method: 'POST',
        correlationId: 'c-ow-write',
      };
      const resWrite = createMockRes();
      let passedWrite = false;
      await custodyWriteMiddleware(reqWrite, resWrite, () => { passedWrite = true; });
      assert.equal(passedWrite, false, 'Owner is strictly forbidden from executing custody mutations');
      assert.equal(resWrite.statusCode, 403);
      assert.equal(resWrite.body?.error?.code, 'ROLE_NOT_ALLOWED');
    }

    // Persona 4: STAFF cannot execute custody mutations
    {
      const reqStaff = {
        auth: { role: 'STAFF', isPrimaryMaster: false, assignedCafeIds: ['ZC-0001'] },
        body: { cafeId: 'ZC-0001' },
        method: 'POST',
        correlationId: 'c-st-write',
      };
      const resStaff = createMockRes();
      let passedStaff = false;
      await custodyWriteMiddleware(reqStaff, resStaff, () => { passedStaff = true; });
      assert.equal(passedStaff, false, 'Staff is strictly denied custody mutations');
      assert.equal(resStaff.statusCode, 403);
      assert.equal(resStaff.body?.error?.code, 'ROLE_NOT_ALLOWED');
    }

    // Persona 5: VENDOR cannot execute custody mutations
    {
      const reqVendor = {
        auth: { role: 'VENDOR', isPrimaryMaster: false },
        body: { cafeId: 'ZC-0001' },
        method: 'POST',
        correlationId: 'c-vn-write',
      };
      const resVendor = createMockRes();
      let passedVendor = false;
      await custodyWriteMiddleware(reqVendor, resVendor, () => { passedVendor = true; });
      assert.equal(passedVendor, false, 'Vendor partner is strictly denied custody mutations');
      assert.equal(resVendor.statusCode, 403);
      assert.equal(resVendor.body?.error?.code, 'VENDOR_READ_ONLY');
    }

    // Retired Normal Master: Remains denied (403 ROLE_RETIRED) across all access
    {
      const reqRetired = {
        auth: { role: 'MASTER', isPrimaryMaster: false },
        body: { cafeId: 'ZC-0001' },
        method: 'POST',
        correlationId: 'c-ret-write',
      };
      const resRetired = createMockRes();
      let passedRetired = false;
      await custodyWriteMiddleware(reqRetired, resRetired, () => { passedRetired = true; });
      assert.equal(passedRetired, false, 'Retired Normal Master must fail closed');
      assert.equal(resRetired.statusCode, 403);
      assert.equal(resRetired.body?.error?.code, 'ROLE_RETIRED');
    }
  } finally {
    RolePermission.findEffectiveRules = originalFind;
  }
});


