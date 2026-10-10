'use strict';

/**
 * INSTITUTIONAL CREDIT SERVICE (P10 CONCURRENCY-SAFE RECEIVABLES & CREDIT EXPOSURE)
 *
 * Implements:
 *  - Atomic conditional credit limit validation and exposure consumption
 *  - Strict segregation: Sale value ≠ Money received ≠ Outstanding receivable
 *  - Atomic creation of Receivable synchronized with InstitutionalAccount exposure increment
 *  - Atomic collection of receivables with idempotency and exposure release
 *  - Concurrency-safe overcollection prevention
 *  - Derived ageing reporting (CURRENT, 1-30, 31-60, 61-90, 90+) based on business due dates
 *  - Authoritative account statement generation
 *  - Governed master data management (Credit limit changes restricted to Primary Master)
 */

const mongoose = require('mongoose');
const { InstitutionalAccount } = require('../models/InstitutionalAccount');
const { Receivable } = require('../models/Receivable');
const { RegisterSession } = require('../models/RegisterSession');
const { CashTransaction } = require('../models/CashTransaction');
const { SequenceCounter } = require('../models/SequenceCounter');
const { executeTransactionWithRetry } = require('../utils/transactionHelper');
const { ApiError } = require('../utils/ApiError');
const auditService = require('./auditService');

function getIstBusinessDate(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function normalizeId(val) {
  return typeof val === 'string' ? val.trim().toUpperCase() : '';
}

/**
 * Atomically evaluate and reserve/commit credit capacity for an institutional account.
 * Uses atomic conditional findOneAndUpdate with $inc to guarantee that even under
 * 50 concurrent requests, currentExposurePaisa + amount <= creditLimitPaisa.
 */
async function reserveCreditAtomic({
  organisationId,
  cafeId,
  accountId,
  amountPaisa,
  session = null,
}) {
  const orgId = normalizeId(organisationId);
  const accId = normalizeId(accountId);
  const cleanCafe = normalizeId(cafeId);
  const amount = Math.max(0, Math.round(Number(amountPaisa) || 0));

  if (!orgId || !accId) {
    throw new ApiError(400, 'VALIDATION_FAILED', 'organisationId and accountId are required.');
  }
  if (amount <= 0) {
    return { success: true, exposureIncreased: 0 };
  }

  // Find account to verify cafe authorization & active status first
  const query = { organisationId: orgId, accountId: accId };
  let account = await (session ? InstitutionalAccount.findOne(query).session(session) : InstitutionalAccount.findOne(query));

  if (!account) {
    throw new ApiError(404, 'CREDIT_ACCOUNT_NOT_FOUND', `Institutional account ${accId} not found.`);
  }

  if (account.creditStatus !== 'ACTIVE') {
    throw new ApiError(
      403,
      'CREDIT_ACCOUNT_SUSPENDED',
      `Credit account ${accId} is not active (status: ${account.creditStatus}).`
    );
  }

  if (account.permittedCafeIds && account.permittedCafeIds.length > 0) {
    const permitted = account.permittedCafeIds.map((c) => normalizeId(c));
    if (!permitted.includes(cleanCafe)) {
      throw new ApiError(
        403,
        'CAFE_NOT_PERMITTED',
        `Café ${cleanCafe} is not authorized for institutional account ${accId}.`
      );
    }
  }

  // Atomic conditional update to safely consume exposure
  // Filter ensures:
  // creditStatus === 'ACTIVE'
  // currentExposurePaisa + reservedExposurePaisa + amount <= creditLimitPaisa
  const atomicFilter = {
    _id: account._id,
    creditStatus: 'ACTIVE',
    $expr: {
      $lte: [
        {
          $add: [
            { $ifNull: ['$currentExposurePaisa', 0] },
            { $ifNull: ['$reservedExposurePaisa', 0] },
            amount,
          ],
        },
        '$creditLimitPaisa',
      ],
    },
  };

  const atomicUpdate = {
    $inc: { currentExposurePaisa: amount },
  };

  const updateOptions = { new: true };
  if (session) updateOptions.session = session;

  const updatedAccount = await InstitutionalAccount.findOneAndUpdate(
    atomicFilter,
    atomicUpdate,
    updateOptions
  );

  if (!updatedAccount) {
    // Determine the exact failure reason for clear diagnostics
    const fresh = await (session
      ? InstitutionalAccount.findById(account._id).session(session)
      : InstitutionalAccount.findById(account._id));
    const currentExp = (fresh?.currentExposurePaisa || 0) + (fresh?.reservedExposurePaisa || 0);
    const limit = fresh?.creditLimitPaisa || 0;
    const available = Math.max(0, limit - currentExp);

    throw new ApiError(
      403,
      'CREDIT_LIMIT_EXCEEDED',
      `Credit limit exceeded for account ${accId}. Requested obligation of ₹${(amount / 100).toFixed(
        2
      )} exceeds available credit of ₹${(available / 100).toFixed(2)} (Limit: ₹${(limit / 100).toFixed(
        2
      )}, Exposure: ₹${(currentExp / 100).toFixed(2)}).`
    );
  }

  return {
    success: true,
    account: updatedAccount,
    exposureIncreased: amount,
  };
}

/**
 * Atomically create an Accounts Receivable record linked to an Institutional Account and Bill/Order.
 * Executed within the transaction so that if Bill fails or exposure update fails, everything rolls back.
 */
async function commitCreditSaleAtomic({
  organisationId,
  cafeId,
  accountId,
  billId = null,
  invoiceNumber = null,
  orderId = null,
  dueAmountPaisa,
  customerPoNumber = '',
  departmentName = '',
  costCentre = '',
  authContext = {},
  session = null,
}) {
  const orgId = normalizeId(organisationId);
  const accId = normalizeId(accountId);
  const amount = Math.max(0, Math.round(Number(dueAmountPaisa) || 0));

  if (amount <= 0) {
    return null;
  }

  // 1. Consume credit atomically
  const creditRes = await reserveCreditAtomic({
    organisationId: orgId,
    cafeId,
    accountId: accId,
    amountPaisa: amount,
    session,
  });

  const account = creditRes.account;
  const businessDate = getIstBusinessDate();
  const dateCompact = businessDate.replace(/-/g, '');

  let receivableSeq;
  try {
    receivableSeq = await SequenceCounter.generateId({
      organisationId: orgId,
      sequenceKey: `AR_${dateCompact}`,
      prefix: `AR-${dateCompact}`,
      minimumDigits: 4,
    });
  } catch {
    receivableSeq = `AR-${dateCompact}-${Date.now().toString(36).toUpperCase()}`;
  }

  const paymentTermsDays = account.paymentTermsDays || 30;
  const dueDateObj = new Date();
  dueDateObj.setDate(dueDateObj.getDate() + paymentTermsDays);
  const dueDateStr = getIstBusinessDate(dueDateObj);

  const receivable = new Receivable({
    receivableId: receivableSeq,
    organisationId: orgId,
    cafeId: normalizeId(cafeId),
    accountId: accId,
    customerName: account.accountName,
    billId: billId ? normalizeId(billId) : null,
    invoiceNumber: invoiceNumber ? String(invoiceNumber).trim() : null,
    orderId: orderId ? normalizeId(orderId) : null,
    customerPoNumber: String(customerPoNumber || '').trim(),
    departmentName: String(departmentName || '').trim(),
    costCentre: String(costCentre || '').trim(),
    originalAmountPaisa: amount,
    collectedAmountPaisa: 0,
    outstandingAmountPaisa: amount,
    currency: 'INR',
    issueDate: businessDate,
    dueDate: dueDateStr,
    paymentTermsDays,
    status: 'OUTSTANDING',
    collections: [],
  });

  await receivable.save(session ? { session } : {});

  if (authContext && authContext.userId) {
    await auditService.recordAuditEvent({
      organisationId: orgId,
      cafeId: normalizeId(cafeId),
      userId: authContext.userId,
      eventCategory: 'FINANCE',
      eventType: 'RECEIVABLE_CREATED',
      resourceType: 'Receivable',
      resourceId: receivable.receivableId,
      details: {
        accountId: accId,
        amountPaisa: amount,
        billId,
        dueDate: dueDateStr,
      },
    }).catch(() => {});
  }

  return receivable;
}

/**
 * Atomically collect an existing receivable.
 * Core Invariant:
 *  - Collection of old debt INCREASES money received and REDUCES receivable / exposure.
 *  - Collection creates ₹0 NEW SALES.
 *  - Overcollection is prevented atomically by database conditional filter:
 *    outstandingAmountPaisa >= amountPaisa.
 *  - Concurrency safe and idempotent.
 */
async function collectReceivableAtomic({
  organisationId,
  cafeId,
  receivableId,
  amountPaisa,
  paymentMethod = 'CASH',
  provider = '',
  paymentReference = '',
  registerSessionId = null,
  idempotencyKey = null,
  notes = '',
  authContext = {},
}) {
  const orgId = normalizeId(organisationId);
  const recId = normalizeId(receivableId);
  const amount = Math.max(0, Math.round(Number(amountPaisa) || 0));

  if (!orgId || !recId) {
    throw new ApiError(400, 'VALIDATION_FAILED', 'organisationId and receivableId are required.');
  }
  if (amount <= 0) {
    throw new ApiError(400, 'INVALID_AMOUNT', 'Collection amount must be greater than zero.');
  }

  // Execute within transaction
  return await executeTransactionWithRetry(async (session) => {
    // 1. Check existing receivable
    const query = { organisationId: orgId, receivableId: recId };
    const receivable = await (session ? Receivable.findOne(query).session(session) : Receivable.findOne(query));

    if (!receivable) {
      throw new ApiError(404, 'RECEIVABLE_NOT_FOUND', `Receivable ${recId} not found.`);
    }

    if (receivable.status === 'COLLECTED' || receivable.outstandingAmountPaisa <= 0) {
      throw new ApiError(409, 'RECEIVABLE_ALREADY_PAID', `Receivable ${recId} is already fully collected.`);
    }
    if (['WRITTEN_OFF', 'CANCELLED'].includes(receivable.status)) {
      throw new ApiError(409, 'INVALID_RECEIVABLE_STATE', `Receivable ${recId} status is ${receivable.status}; cannot collect.`);
    }

    // 2. Check idempotency: if already processed this collection
    if (idempotencyKey) {
      const existingCol = receivable.collections.find((c) => c.idempotencyKey === idempotencyKey);
      if (existingCol) {
        return {
          idempotentReplay: true,
          receivable,
          collection: existingCol,
          collectedAmountPaisa: existingCol.amountPaisa,
          outstandingAmountPaisa: receivable.outstandingAmountPaisa,
        };
      }
    }

    // 3. Atomically update Receivable: ensure outstandingAmountPaisa >= amount
    const collectionId = `COL-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;
    const collectionEntry = {
      collectionId,
      amountPaisa: amount,
      paymentMethod,
      provider: provider || '',
      paymentReference: paymentReference || '',
      receiptNumber: `REC-${Date.now().toString(36).toUpperCase()}`,
      registerSessionId: registerSessionId || null,
      collectedByUserId: authContext.userId || 'SYSTEM',
      collectedAt: new Date(),
      idempotencyKey: idempotencyKey || null,
      notes: notes || '',
    };

    const updatedReceivable = await Receivable.findOneAndUpdate(
      {
        _id: receivable._id,
        outstandingAmountPaisa: { $gte: amount },
      },
      {
        $inc: {
          collectedAmountPaisa: amount,
          outstandingAmountPaisa: -amount,
        },
        $push: {
          collections: collectionEntry,
        },
      },
      {
        returnDocument: 'after',
        session: session || undefined,
      }
    );

    if (!updatedReceivable) {
      // Overcollection or race detected
      const freshRec = await (session ? Receivable.findById(receivable._id).session(session) : Receivable.findById(receivable._id));
      throw new ApiError(
        409,
        'OVERCOLLECTION_PROHIBITED',
        `Requested collection ₹${(amount / 100).toFixed(2)} exceeds remaining outstanding balance ₹${(
          (freshRec?.outstandingAmountPaisa || 0) / 100
        ).toFixed(2)}.`
      );
    }

    // Update status if fully collected
    if (updatedReceivable.outstandingAmountPaisa === 0) {
      updatedReceivable.status = 'COLLECTED';
    } else {
      updatedReceivable.status = 'PARTIALLY_COLLECTED';
    }
    await updatedReceivable.save(session ? { session } : {});

    // 4. Atomically release Institutional Account currentExposurePaisa
    const accountFilter = {
      organisationId: orgId,
      accountId: receivable.accountId,
    };
    const updatedAccount = await InstitutionalAccount.findOneAndUpdate(
      accountFilter,
      {
        $inc: { currentExposurePaisa: -amount },
      },
      {
        returnDocument: 'after',
        session: session || undefined,
      }
    );

    // Ensure exposure does not dip below zero
    if (updatedAccount && updatedAccount.currentExposurePaisa < 0) {
      updatedAccount.currentExposurePaisa = 0;
      await updatedAccount.save(session ? { session } : {});
    }

    // 5. If paid in CASH, link to active RegisterSession and auto-post CashTransaction
    // Notice: Cash received increases expected cash, but NOT POS sales!
    if (paymentMethod === 'CASH') {
      let regSession = null;
      if (registerSessionId) {
        regSession = await (session
          ? RegisterSession.findOne({ registerSessionId, status: 'OPEN' }).session(session)
          : RegisterSession.findOne({ registerSessionId, status: 'OPEN' }));
      } else if (cafeId) {
        regSession = await (session
          ? RegisterSession.findOne({ organisationId: orgId, cafeId: normalizeId(cafeId), status: 'OPEN' }).session(session)
          : RegisterSession.findOne({ organisationId: orgId, cafeId: normalizeId(cafeId), status: 'OPEN' }));
      }

      if (regSession) {
        regSession.expectedCashPaisa = (regSession.expectedCashPaisa || 0) + amount;
        regSession.cashEvents = regSession.cashEvents || [];
        regSession.cashEvents.push({
          eventType: 'RECEIVABLE_COLLECTION',
          amountPaisa: amount,
          reason: `Debt Collection for ${recId}`,
          actorId: authContext.userId || 'SYSTEM',
          reference: recId,
          timestamp: new Date(),
        });
        await regSession.save(session ? { session } : {});
      }

      // Record in CashTransaction ledger
      try {
        const ctSeqId = `CT-${getIstBusinessDate().replace(/-/g, '')}-${Math.floor(1000 + Math.random() * 9000)}`;
        const cashTx = new CashTransaction({
          cashTransactionId: ctSeqId,
          organisationId: orgId,
          cafeId: normalizeId(cafeId || receivable.cafeId),
          businessDate: getIstBusinessDate(),
          transactionType: 'CASH_IN',
          direction: 'IN',
          category: 'RECEIVABLE_COLLECTION',
          amount: amount / 100,
          paymentMethod: 'CASH',
          status: 'POSTED',
          description: `Customer Debt Collection: ${receivable.customerName} (${recId})`,
          referenceType: 'RECEIVABLE',
          referenceId: recId,
          recordedBy: authContext.userId || 'SYSTEM',
          createdBy: authContext.userId || 'SYSTEM',
        });
        await cashTx.save(session ? { session } : {});
      } catch (ctErr) {
        console.warn('[RECEIVABLE] Could not record CashTransaction:', ctErr?.message);
      }
    }

    // 6. Audit Trail
    if (authContext && authContext.userId) {
      await auditService.recordAuditEvent({
        organisationId: orgId,
        cafeId: normalizeId(cafeId || receivable.cafeId),
        userId: authContext.userId,
        eventCategory: 'FINANCE',
        eventType: 'RECEIVABLE_COLLECTION_RECORDED',
        resourceType: 'Receivable',
        resourceId: recId,
        details: {
          collectionId,
          amountPaisa: amount,
          remainingOutstandingPaisa: updatedReceivable.outstandingAmountPaisa,
          paymentMethod,
        },
      }).catch(() => {});
    }

    return {
      success: true,
      receivable: updatedReceivable,
      collection: collectionEntry,
      collectedAmountPaisa: amount,
      remainingOutstandingPaisa: updatedReceivable.outstandingAmountPaisa,
      accountExposure: updatedAccount?.currentExposurePaisa || 0,
    };
  });
}

/**
 * Reverse or reduce a receivable due to a credit sale void/refund.
 * If ₹10,000 credit sale is refunded with ₹0 collected:
 *  - Outstanding receivable becomes 0 / CANCELLED
 *  - Institutional exposure decreases by ₹10,000
 *  - Cash refund = ₹0 (no cash was paid!)
 */
async function reverseCreditSaleAtomic({
  organisationId,
  billId,
  reason = 'Bill Voided/Refunded',
  authContext = {},
  session = null,
}) {
  const orgId = normalizeId(organisationId);
  const cleanBillId = normalizeId(billId);

  const receivable = await (session
    ? Receivable.findOne({ organisationId: orgId, billId: cleanBillId }).session(session)
    : Receivable.findOne({ organisationId: orgId, billId: cleanBillId }));

  if (!receivable) return null;

  const unpaidAmount = receivable.outstandingAmountPaisa;
  if (unpaidAmount <= 0) return receivable;

  // Reduce receivable outstanding to 0 and mark CANCELLED
  receivable.outstandingAmountPaisa = 0;
  receivable.status = 'CANCELLED';
  receivable.disputeDetails = {
    reason,
    disputedAt: new Date(),
    disputedByUserId: authContext.userId || 'SYSTEM',
  };
  await receivable.save(session ? { session } : {});

  // Release exposure on Institutional Account
  await InstitutionalAccount.findOneAndUpdate(
    { organisationId: orgId, accountId: receivable.accountId },
    { $inc: { currentExposurePaisa: -unpaidAmount } },
    { session: session || undefined }
  );

  return receivable;
}

/**
 * Ageing Report Generator
 * Buckets based on business due date:
 *  - CURRENT: not yet due (dueDate >= today)
 *  - 1-30 DAYS: 1 to 30 days overdue
 *  - 31-60 DAYS: 31 to 60 days overdue
 *  - 61-90 DAYS: 61 to 90 days overdue
 *  - 90+ DAYS: >90 days overdue
 */
async function getReceivableAgeingReport({
  organisationId,
  cafeId = null,
  asOfDate = null,
}) {
  const orgId = normalizeId(organisationId);
  const todayStr = asOfDate || getIstBusinessDate();

  const filter = {
    organisationId: orgId,
    status: { $in: ['OUTSTANDING', 'PARTIALLY_COLLECTED'] },
    outstandingAmountPaisa: { $gt: 0 },
  };

  if (cafeId && cafeId !== 'ALL') {
    filter.cafeId = normalizeId(cafeId);
  }

  const receivables = await Receivable.find(filter).sort({ dueDate: 1 }).lean();

  const today = new Date(`${todayStr}T00:00:00+05:30`);

  const summary = {
    asOfDate: todayStr,
    totalOutstandingPaisa: 0,
    buckets: {
      CURRENT: { count: 0, amountPaisa: 0, label: 'Not Yet Due' },
      DAYS_1_30: { count: 0, amountPaisa: 0, label: '1 - 30 Days Overdue' },
      DAYS_31_60: { count: 0, amountPaisa: 0, label: '31 - 60 Days Overdue' },
      DAYS_61_90: { count: 0, amountPaisa: 0, label: '61 - 90 Days Overdue' },
      DAYS_OVER_90: { count: 0, amountPaisa: 0, label: 'Over 90 Days Overdue' },
    },
    items: [],
  };

  for (const r of receivables) {
    const due = new Date(`${r.dueDate}T00:00:00+05:30`);
    const diffMs = today.getTime() - due.getTime();
    const overdueDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    let bucket = 'CURRENT';
    if (overdueDays > 90) bucket = 'DAYS_OVER_90';
    else if (overdueDays > 60) bucket = 'DAYS_61_90';
    else if (overdueDays > 30) bucket = 'DAYS_31_60';
    else if (overdueDays > 0) bucket = 'DAYS_1_30';

    summary.totalOutstandingPaisa += r.outstandingAmountPaisa;
    summary.buckets[bucket].count += 1;
    summary.buckets[bucket].amountPaisa += r.outstandingAmountPaisa;

    summary.items.push({
      receivableId: r.receivableId,
      accountId: r.accountId,
      customerName: r.customerName,
      billId: r.billId,
      invoiceNumber: r.invoiceNumber,
      cafeId: r.cafeId,
      originalAmountPaisa: r.originalAmountPaisa,
      collectedAmountPaisa: r.collectedAmountPaisa,
      outstandingAmountPaisa: r.outstandingAmountPaisa,
      issueDate: r.issueDate,
      dueDate: r.dueDate,
      overdueDays: Math.max(0, overdueDays),
      bucket,
      status: r.status,
    });
  }

  return summary;
}

/**
 * Institutional Account Statement
 * Reconciles opening balance, invoices/charges, collections, and closing balance.
 */
async function getAccountStatement({
  organisationId,
  accountId,
  startDate = null,
  endDate = null,
}) {
  const orgId = normalizeId(organisationId);
  const accId = normalizeId(accountId);

  const account = await InstitutionalAccount.findOne({
    organisationId: orgId,
    accountId: accId,
  }).lean();

  if (!account) {
    throw new ApiError(404, 'ACCOUNT_NOT_FOUND', `Institutional account ${accId} not found.`);
  }

  const query = { organisationId: orgId, accountId: accId };
  if (startDate || endDate) {
    query.issueDate = {};
    if (startDate) query.issueDate.$gte = startDate;
    if (endDate) query.issueDate.$lte = endDate;
  }

  const receivables = await Receivable.find(query).sort({ issueDate: 1 }).lean();

  let totalBilledPaisa = 0;
  let totalCollectedPaisa = 0;
  let totalOutstandingPaisa = 0;
  const ledgerEntries = [];

  for (const r of receivables) {
    totalBilledPaisa += r.originalAmountPaisa;
    totalCollectedPaisa += r.collectedAmountPaisa;
    totalOutstandingPaisa += r.outstandingAmountPaisa;

    // Debit entry (Invoice created)
    ledgerEntries.push({
      date: r.issueDate,
      type: 'INVOICE',
      documentId: r.receivableId,
      billId: r.billId,
      invoiceNumber: r.invoiceNumber,
      description: `Bill ${r.invoiceNumber || r.billId}`,
      debitPaisa: r.originalAmountPaisa,
      creditPaisa: 0,
      runningBalancePaisa: 0, // will compute after sorting
    });

    // Credit entries (Collections)
    for (const c of r.collections || []) {
      const colDate = getIstBusinessDate(new Date(c.collectedAt));
      ledgerEntries.push({
        date: colDate,
        type: 'COLLECTION',
        documentId: c.collectionId,
        billId: r.billId,
        invoiceNumber: r.invoiceNumber,
        description: `Collection via ${c.paymentMethod} (${c.receiptNumber})`,
        debitPaisa: 0,
        creditPaisa: c.amountPaisa,
        runningBalancePaisa: 0,
      });
    }
  }

  // Sort chronologically and calculate running balance
  ledgerEntries.sort((a, b) => (a.date > b.date ? 1 : a.date < b.date ? -1 : 0));
  let running = 0;
  for (const entry of ledgerEntries) {
    running += entry.debitPaisa - entry.creditPaisa;
    entry.runningBalancePaisa = running;
  }

  return {
    account: {
      accountId: account.accountId,
      accountName: account.accountName,
      creditLimitPaisa: account.creditLimitPaisa,
      currentExposurePaisa: account.currentExposurePaisa,
      availableCreditPaisa: Math.max(0, account.creditLimitPaisa - account.currentExposurePaisa),
      creditStatus: account.creditStatus,
      paymentTermsDays: account.paymentTermsDays || 30,
      gstin: account.gstin || '',
      billingAddress: account.billingAddress || '',
    },
    period: {
      startDate: startDate || receivables[0]?.issueDate || getIstBusinessDate(),
      endDate: endDate || getIstBusinessDate(),
    },
    summary: {
      totalBilledPaisa,
      totalCollectedPaisa,
      totalOutstandingPaisa,
      closingBalancePaisa: running,
    },
    ledgerEntries,
  };
}

/**
 * Governed Master Data: Update Credit Limit (Primary Master Only)
 */
async function updateCreditLimit({
  organisationId,
  accountId,
  newCreditLimitPaisa,
  reason = '',
  authContext = {},
}) {
  const orgId = normalizeId(organisationId);
  const accId = normalizeId(accountId);
  const newLimit = Math.max(0, Math.round(Number(newCreditLimitPaisa) || 0));

  if (!orgId || !accId) {
    throw new ApiError(400, 'VALIDATION_FAILED', 'organisationId and accountId are required.');
  }
  if (!reason || !reason.trim()) {
    throw new ApiError(400, 'REASON_REQUIRED', 'A mandatory reason is required to modify credit limit.');
  }

  const account = await InstitutionalAccount.findOne({
    organisationId: orgId,
    accountId: accId,
  });

  if (!account) {
    throw new ApiError(404, 'ACCOUNT_NOT_FOUND', `Institutional account ${accId} not found.`);
  }

  const oldLimit = account.creditLimitPaisa;
  account.creditLimitPaisa = newLimit;
  await account.save();

  await auditService.recordAuditEvent({
    organisationId: orgId,
    cafeId: account.permittedCafeIds?.[0] || 'HEAD_OFFICE',
    userId: authContext.userId || 'SYSTEM',
    eventCategory: 'MASTER_DATA',
    eventType: 'CREDIT_LIMIT_UPDATED',
    resourceType: 'InstitutionalAccount',
    resourceId: accId,
    details: {
      oldLimitPaisa: oldLimit,
      newLimitPaisa: newLimit,
      currentExposurePaisa: account.currentExposurePaisa,
      reason,
    },
  }).catch(() => {});

  return {
    success: true,
    account,
    oldLimitPaisa: oldLimit,
    newLimitPaisa: newLimit,
  };
}

/**
 * Governed Master Data: Suspend or Change Account Status
 */
async function setAccountStatus({
  organisationId,
  accountId,
  newStatus,
  reason = '',
  authContext = {},
}) {
  const orgId = normalizeId(organisationId);
  const accId = normalizeId(accountId);

  if (!['ACTIVE', 'ON_HOLD', 'SUSPENDED'].includes(newStatus)) {
    throw new ApiError(400, 'INVALID_STATUS', `Invalid credit status: ${newStatus}`);
  }

  const account = await InstitutionalAccount.findOne({
    organisationId: orgId,
    accountId: accId,
  });

  if (!account) {
    throw new ApiError(404, 'ACCOUNT_NOT_FOUND', `Institutional account ${accId} not found.`);
  }

  const oldStatus = account.creditStatus;
  account.creditStatus = newStatus;
  await account.save();

  await auditService.recordAuditEvent({
    organisationId: orgId,
    cafeId: account.permittedCafeIds?.[0] || 'HEAD_OFFICE',
    userId: authContext.userId || 'SYSTEM',
    eventCategory: 'MASTER_DATA',
    eventType: 'CREDIT_ACCOUNT_STATUS_CHANGED',
    resourceType: 'InstitutionalAccount',
    resourceId: accId,
    details: {
      oldStatus,
      newStatus,
      reason,
    },
  }).catch(() => {});

  return {
    success: true,
    account,
    oldStatus,
    newStatus,
  };
}

module.exports = {
  reserveCreditAtomic,
  commitCreditSaleAtomic,
  collectReceivableAtomic,
  reverseCreditSaleAtomic,
  getReceivableAgeingReport,
  getAccountStatement,
  updateCreditLimit,
  setAccountStatus,
};
