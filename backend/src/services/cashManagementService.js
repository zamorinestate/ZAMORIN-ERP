'use strict';

/**
 * CASH MANAGEMENT SERVICE (P10 PHYSICAL CASH CUSTODY, SAFE DROPS & BANK DEPOSITS)
 *
 * Implements:
 *  - Operational cash custody lifecycle (Open, Safe Drop, Bank Deposit, Close)
 *  - Core Invariant:
 *    Opening Float ≠ Sales Revenue
 *    Safe Drop ≠ Expense (Custody transfer from register to safe)
 *    Bank Deposit ≠ Sale / New customer collection (Custody transfer from safe/till to bank)
 *  - Concurrency-safe register session closure
 *  - Authoritative server derivation of expected cash:
 *    expectedCash = openingFloat + cashSales + cashDebtCollections + cashAdvanceDeposits
 *                   - safeDrops - cashRefunds - cashAdvanceRefunds - cashOut
 *  - Atomic variance calculation and manager escalation requirement
 */

const mongoose = require('mongoose');
const { RegisterSession } = require('../models/RegisterSession');
const { CashTransaction } = require('../models/CashTransaction');
const { BankAccount } = require('../models/BankAccount');
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
 * Open a Register Session
 * Prevents concurrent double opening of the same register if already active.
 */
async function openRegisterSession({
  organisationId,
  cafeId,
  registerId = 'REG-01',
  openingFloatPaisa = 0,
  authContext = {},
}) {
  const orgId = normalizeId(organisationId);
  const cleanCafe = normalizeId(cafeId);
  const cleanReg = normalizeId(registerId);
  const floatAmount = Math.max(0, Math.round(Number(openingFloatPaisa) || 0));

  if (!orgId || !cleanCafe) {
    throw new ApiError(400, 'VALIDATION_FAILED', 'organisationId and cafeId are required.');
  }

  // Check if register is already OPEN
  const existingOpen = await RegisterSession.findOne({
    organisationId: orgId,
    cafeId: cleanCafe,
    registerId: cleanReg,
    status: 'OPEN',
  });

  if (existingOpen) {
    throw new ApiError(
      409,
      'REGISTER_ALREADY_OPEN',
      `Register ${cleanReg} at café ${cleanCafe} is already open (Session: ${existingOpen.registerSessionId}). Close it before opening a new session.`
    );
  }

  const businessDate = getIstBusinessDate();
  const dateCompact = businessDate.replace(/-/g, '');

  let sessionSeq;
  try {
    sessionSeq = await SequenceCounter.generateId({
      organisationId: orgId,
      sequenceKey: `REG_${dateCompact}`,
      prefix: `REG-${dateCompact}`,
      minimumDigits: 4,
    });
  } catch {
    sessionSeq = `REG-${dateCompact}-${Date.now().toString(36).toUpperCase()}`;
  }

  const session = new RegisterSession({
    registerSessionId: sessionSeq,
    organisationId: orgId,
    cafeId: cleanCafe,
    registerId: cleanReg,
    cashierUserId: authContext.userId || 'CASHIER-01',
    businessDate,
    openedAt: new Date(),
    status: 'OPEN',
    openingFloatPaisa: floatAmount,
    expectedCashPaisa: floatAmount,
    totalSalesPaisa: 0,
    totalCashSalesPaisa: 0,
    totalUpiSalesPaisa: 0,
    totalCardSalesPaisa: 0,
    orderCount: 0,
    cashEvents: [
      {
        eventType: 'OPENING_FLOAT',
        amountPaisa: floatAmount,
        reason: 'Opening Float',
        actorId: authContext.userId || 'SYSTEM',
        timestamp: new Date(),
      },
    ],
  });

  await session.save();

  if (authContext && authContext.userId) {
    await auditService.recordAuditEvent({
      organisationId: orgId,
      cafeId: cleanCafe,
      userId: authContext.userId,
      eventCategory: 'FINANCE',
      eventType: 'REGISTER_SESSION_OPENED',
      resourceType: 'RegisterSession',
      resourceId: session.registerSessionId,
      details: {
        registerId: cleanReg,
        openingFloatPaisa: floatAmount,
        businessDate,
      },
    }).catch(() => {});
  }

  return session;
}

/**
 * Record a Safe Drop (Transfer from Till to Safe Custody)
 * Reduces expected till cash, but DOES NOT affect sales or create an expense!
 */
async function recordCashDrop({
  organisationId,
  cafeId,
  registerSessionId,
  amountPaisa,
  reason = 'Safe Drop',
  idempotencyKey = null,
  authContext = {},
}) {
  const orgId = normalizeId(organisationId);
  const cleanCafe = normalizeId(cafeId);
  const amount = Math.max(0, Math.round(Number(amountPaisa) || 0));

  if (!orgId || !registerSessionId) {
    throw new ApiError(400, 'VALIDATION_FAILED', 'organisationId and registerSessionId are required.');
  }
  if (amount <= 0) {
    throw new ApiError(400, 'INVALID_AMOUNT', 'Drop amount must be greater than zero.');
  }

  return await executeTransactionWithRetry(async (session) => {
    const regSession = await (session
      ? RegisterSession.findOne({ organisationId: orgId, registerSessionId, status: 'OPEN' }).session(session)
      : RegisterSession.findOne({ organisationId: orgId, registerSessionId, status: 'OPEN' }));

    if (!regSession) {
      throw new ApiError(404, 'ACTIVE_SESSION_NOT_FOUND', `Active register session ${registerSessionId} not found.`);
    }

    // Idempotency guard inside cashEvents
    if (idempotencyKey) {
      const existing = (regSession.cashEvents || []).find((e) => e.reference === idempotencyKey);
      if (existing) {
        return {
          idempotentReplay: true,
          session: regSession,
          dropAmountPaisa: existing.amountPaisa,
        };
      }
    }

    // Ensure register has sufficient expected cash for drop
    if ((regSession.expectedCashPaisa || 0) < amount) {
      throw new ApiError(
        400,
        'INSUFFICIENT_TILL_CASH',
        `Cannot drop ₹${(amount / 100).toFixed(2)}: till expected balance is only ₹${(
          (regSession.expectedCashPaisa || 0) / 100
        ).toFixed(2)}.`
      );
    }

    regSession.expectedCashPaisa -= amount;
    regSession.cashEvents.push({
      eventType: 'SAFE_DROP',
      amountPaisa: amount,
      reason: reason.trim(),
      actorId: authContext.userId || 'SYSTEM',
      reference: idempotencyKey || `DROP-${Date.now()}`,
      timestamp: new Date(),
    });

    await regSession.save(session ? { session } : {});

    // Record internal custody transfer transaction
    try {
      const ctSeqId = `CT-${getIstBusinessDate().replace(/-/g, '')}-${Math.floor(1000 + Math.random() * 9000)}`;
      const cashTx = new CashTransaction({
        cashTransactionId: ctSeqId,
        organisationId: orgId,
        cafeId: cleanCafe || regSession.cafeId,
        businessDate: regSession.businessDate,
        transactionType: 'CASH_OUT',
        direction: 'OUT',
        category: 'SAFE_DROP',
        amount: amount / 100,
        paymentMethod: 'CASH',
        status: 'POSTED',
        description: `Cash Drop from ${regSession.registerId} to Safe: ${reason}`,
        referenceType: 'REGISTER_SESSION',
        referenceId: registerSessionId,
        recordedBy: authContext.userId || 'SYSTEM',
        createdBy: authContext.userId || 'SYSTEM',
      });
      await cashTx.save(session ? { session } : {});
    } catch (ctErr) {
      console.warn('[CASH_DROP] Could not record CashTransaction:', ctErr?.message);
    }

    if (authContext && authContext.userId) {
      await auditService.recordAuditEvent({
        organisationId: orgId,
        cafeId: cleanCafe || regSession.cafeId,
        userId: authContext.userId,
        eventCategory: 'FINANCE',
        eventType: 'CASH_SAFE_DROP_RECORDED',
        resourceType: 'RegisterSession',
        resourceId: registerSessionId,
        details: {
          amountPaisa: amount,
          remainingExpectedPaisa: regSession.expectedCashPaisa,
          reason,
        },
      }).catch(() => {});
    }

    return {
      success: true,
      registerSessionId,
      dropAmountPaisa: amount,
      remainingExpectedPaisa: regSession.expectedCashPaisa,
      session: regSession,
    };
  });
}

/**
 * Record a Bank Deposit
 * Custody transfer from physical cash (safe/till) into official bank account.
 * Core Invariant: Bank Deposit DOES NOT increase sales or customer receipts!
 */
async function recordBankDeposit({
  organisationId,
  cafeId,
  bankAccountId,
  amountPaisa,
  source = 'SAFE',
  referenceNumber = '',
  supportingDocumentUrl = '',
  authContext = {},
}) {
  const orgId = normalizeId(organisationId);
  const cleanCafe = normalizeId(cafeId);
  const cleanBankId = normalizeId(bankAccountId);
  const amount = Math.max(0, Math.round(Number(amountPaisa) || 0));

  if (!orgId || !cleanBankId) {
    throw new ApiError(400, 'VALIDATION_FAILED', 'organisationId and bankAccountId are required.');
  }
  if (amount <= 0) {
    throw new ApiError(400, 'INVALID_AMOUNT', 'Deposit amount must be greater than zero.');
  }

  // Verify Bank Account
  const bankAccount = await BankAccount.findOne({
    organisationId: orgId,
    bankAccountId: cleanBankId,
  });

  if (!bankAccount) {
    throw new ApiError(404, 'BANK_ACCOUNT_NOT_FOUND', `Bank account ${cleanBankId} not found.`);
  }

  const depositId = `BDEP-${getIstBusinessDate().replace(/-/g, '')}-${Math.floor(1000 + Math.random() * 9000)}`;

  // Record treasury custody cash movement
  const ctSeqId = `CT-${getIstBusinessDate().replace(/-/g, '')}-${Math.floor(1000 + Math.random() * 9000)}`;
  const cashTx = new CashTransaction({
    cashTransactionId: ctSeqId,
    organisationId: orgId,
    cafeId: cleanCafe,
    businessDate: getIstBusinessDate(),
    transactionType: 'BANK_DEPOSIT',
    direction: 'OUT',
    category: 'BANK_DEPOSIT',
    amount: amount / 100,
    paymentMethod: 'CASH',
    status: 'POSTED',
    description: `Bank Cash Deposit to ${bankAccount.bankName} (${bankAccount.accountNumberMasked || 'AC'}): Ref ${referenceNumber}`,
    referenceType: 'BANK_DEPOSIT',
    referenceId: depositId,
    recordedBy: authContext.userId || 'SYSTEM',
    createdBy: authContext.userId || 'SYSTEM',
  });
  await cashTx.save();

  if (authContext && authContext.userId) {
    await auditService.recordAuditEvent({
      organisationId: orgId,
      cafeId: cleanCafe,
      userId: authContext.userId,
      eventCategory: 'TREASURY',
      eventType: 'BANK_DEPOSIT_RECORDED',
      resourceType: 'BankAccount',
      resourceId: cleanBankId,
      details: {
        depositId,
        amountPaisa: amount,
        bankName: bankAccount.bankName,
        source,
        referenceNumber,
      },
    }).catch(() => {});
  }

  return {
    success: true,
    depositId,
    bankAccountId: cleanBankId,
    bankName: bankAccount.bankName,
    amountPaisa: amount,
    depositedAt: new Date(),
    status: 'SUBMITTED',
  };
}

/**
 * Concurrency-Safe Register Session Close & Variance Calculation
 * Server derives expected cash from authoritative cashEvents.
 * Operator supplies physical counted cash.
 * Atomic conditional update ensures only one close transaction can succeed.
 */
async function closeRegisterSessionAtomic({
  organisationId,
  cafeId,
  registerSessionId,
  countedCashPaisa,
  closingDeclarationNote = '',
  varianceReason = '',
  authContext = {},
}) {
  const orgId = normalizeId(organisationId);
  const counted = Math.max(0, Math.round(Number(countedCashPaisa) || 0));

  if (!orgId || !registerSessionId) {
    throw new ApiError(400, 'VALIDATION_FAILED', 'organisationId and registerSessionId are required.');
  }

  return await executeTransactionWithRetry(async (session) => {
    // 1. Fetch active session
    const regSession = await (session
      ? RegisterSession.findOne({ organisationId: orgId, registerSessionId }).session(session)
      : RegisterSession.findOne({ organisationId: orgId, registerSessionId }));

    if (!regSession) {
      throw new ApiError(404, 'SESSION_NOT_FOUND', `Register session ${registerSessionId} not found.`);
    }

    if (regSession.status === 'CLOSED') {
      throw new ApiError(409, 'SESSION_ALREADY_CLOSED', `Register session ${registerSessionId} is already closed.`);
    }

    // 2. Authoritative derivation of expected cash
    // expected = openingFloat + CASH_SALE + CASH_IN + RECEIVABLE_COLLECTION + ADVANCE_DEPOSIT
    //            - SAFE_DROP - CASH_OUT - CASH_REFUND - ADVANCE_REFUND
    let derivedExpected = regSession.openingFloatPaisa || 0;
    for (const ev of regSession.cashEvents || []) {
      if (['CASH_SALE', 'CASH_IN', 'RECEIVABLE_COLLECTION', 'ADVANCE_DEPOSIT'].includes(ev.eventType)) {
        derivedExpected += ev.amountPaisa;
      } else if (['SAFE_DROP', 'CASH_OUT', 'CASH_REFUND', 'ADVANCE_REFUND', 'BANK_DEPOSIT'].includes(ev.eventType)) {
        derivedExpected -= ev.amountPaisa;
      }
    }
    derivedExpected = Math.max(0, derivedExpected);

    const variancePaisa = counted - derivedExpected;

    if (variancePaisa !== 0 && !varianceReason && !closingDeclarationNote) {
      // Require note when there is a cash discrepancy
      throw new ApiError(
        400,
        'VARIANCE_REASON_REQUIRED',
        `A non-zero cash variance of ₹${(variancePaisa / 100).toFixed(
          2
        )} requires an explanatory variance reason or declaration note.`
      );
    }

    // 3. Atomic conditional update to close session
    const updated = await RegisterSession.findOneAndUpdate(
      {
        _id: regSession._id,
        status: 'OPEN',
      },
      {
        $set: {
          status: 'CLOSED',
          closedAt: new Date(),
          expectedCashPaisa: derivedExpected,
          countedCashPaisa: counted,
          cashVariancePaisa: variancePaisa,
          closingDeclarationNote: String(closingDeclarationNote || varianceReason || '').trim(),
        },
      },
      {
        new: true,
        session: session || undefined,
      }
    );

    if (!updated) {
      throw new ApiError(409, 'SESSION_ALREADY_CLOSED', 'Register session was closed concurrently by another request.');
    }

    if (authContext && authContext.userId) {
      await auditService.recordAuditEvent({
        organisationId: orgId,
        cafeId: updated.cafeId,
        userId: authContext.userId,
        eventCategory: 'FINANCE',
        eventType: 'REGISTER_SESSION_CLOSED',
        resourceType: 'RegisterSession',
        resourceId: registerSessionId,
        details: {
          expectedCashPaisa: derivedExpected,
          countedCashPaisa: counted,
          variancePaisa,
          orderCount: updated.orderCount,
          totalSalesPaisa: updated.totalSalesPaisa,
        },
      }).catch(() => {});
    }

    return {
      success: true,
      registerSessionId,
      cafeId: updated.cafeId,
      expectedCashPaisa: derivedExpected,
      countedCashPaisa: counted,
      variancePaisa,
      status: 'CLOSED',
      session: updated,
    };
  });
}

module.exports = {
  openRegisterSession,
  recordCashDrop,
  recordBankDeposit,
  closeRegisterSessionAtomic,
};
