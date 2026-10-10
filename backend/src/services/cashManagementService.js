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
const { SafeCustody } = require('../models/SafeCustody');
const { BankDeposit } = require('../models/BankDeposit');
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
      sourceCustody: 'REGISTER',
      timestamp: new Date(),
    });

    await regSession.save(session ? { session } : {});

    // Atomically increment physical Safe Custody balance (Case A: Register -> Safe)
    const effectiveCafe = cleanCafe || regSession.cafeId;
    const safeCustody = await SafeCustody.findOneAndUpdate(
      { organisationId: orgId, cafeId: effectiveCafe },
      {
        $inc: { currentBalancePaisa: amount },
        $set: { lastUpdated: new Date() },
      },
      {
        upsert: true,
        returnDocument: 'after',
        session: session || undefined,
      }
    );

    // Record internal custody transfer transaction
    try {
      const ctSeqId = `CT-${getIstBusinessDate().replace(/-/g, '')}-${Math.floor(1000 + Math.random() * 9000)}`;
      const cashTx = new CashTransaction({
        cashTransactionId: ctSeqId,
        organisationId: orgId,
        cafeId: effectiveCafe,
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
        cafeId: effectiveCafe,
        userId: authContext.userId,
        eventCategory: 'FINANCE',
        eventType: 'CASH_SAFE_DROP_RECORDED',
        resourceType: 'RegisterSession',
        resourceId: registerSessionId,
        details: {
          amountPaisa: amount,
          remainingExpectedPaisa: regSession.expectedCashPaisa,
          safeBalancePaisa: safeCustody ? safeCustody.currentBalancePaisa : amount,
          reason,
        },
      }).catch(() => {});
    }

    return {
      success: true,
      registerSessionId,
      dropAmountPaisa: amount,
      remainingExpectedPaisa: regSession.expectedCashPaisa,
      safeBalancePaisa: safeCustody ? safeCustody.currentBalancePaisa : amount,
      session: regSession,
    };
  });
}

/**
 * Record a Bank Deposit
 * Custody transfer from physical cash (safe or register) into official bank account.
 *
 * Distinct Custody Rules:
 *  - Case B: Safe -> Bank (default: sourceCustody = 'SAFE')
 *    Decreases safe custody cash atomically (fails if safe balance < amount).
 *    Increases deposit-in-transit / bank destination.
 *    Does NOT touch register till cash or expected till cash!
 *    Does NOT change sales, income, or customer receipts.
 *
 *  - Case C: Direct Register -> Bank (sourceCustody = 'REGISTER')
 *    Decreases register till cash.
 *    Increases deposit-in-transit / bank destination.
 *    Does NOT touch safe custody.
 *    Does NOT change sales, income, or customer receipts.
 *
 * Enforces idempotency via BankDeposit unique key.
 */
async function recordBankDeposit({
  organisationId,
  cafeId,
  bankAccountId,
  amountPaisa,
  source = 'SAFE',
  sourceCustody = null,
  registerSessionId = null,
  referenceNumber = '',
  supportingDocumentUrl = '',
  idempotencyKey = null,
  authContext = {},
}) {
  const orgId = normalizeId(organisationId);
  const cleanCafe = normalizeId(cafeId);
  const cleanBankId = normalizeId(bankAccountId);
  const amount = Math.max(0, Math.round(Number(amountPaisa) || 0));
  const effectiveCustody = (sourceCustody || source || 'SAFE').toUpperCase().trim();

  if (!orgId || !cleanBankId) {
    throw new ApiError(400, 'VALIDATION_FAILED', 'organisationId and bankAccountId are required.');
  }
  if (amount <= 0) {
    throw new ApiError(400, 'INVALID_AMOUNT', 'Deposit amount must be greater than zero.');
  }
  if (!['SAFE', 'REGISTER'].includes(effectiveCustody)) {
    throw new ApiError(
      400,
      'INVALID_SOURCE_CUSTODY',
      `sourceCustody must be 'SAFE' or 'REGISTER', received '${effectiveCustody}'.`
    );
  }

  // Verify Bank Account
  const bankAccount = await BankAccount.findOne({
    organisationId: orgId,
    bankAccountId: cleanBankId,
  });

  if (!bankAccount) {
    throw new ApiError(404, 'BANK_ACCOUNT_NOT_FOUND', `Bank account ${cleanBankId} not found.`);
  }

  // Idempotency fast-path check
  if (idempotencyKey) {
    const existing = await BankDeposit.findOne({ organisationId: orgId, idempotencyKey });
    if (existing) {
      return {
        idempotentReplay: true,
        depositId: existing.depositId,
        bankAccountId: existing.bankAccountId,
        bankName: existing.bankName,
        amountPaisa: existing.amountPaisa,
        sourceCustody: existing.sourceCustody,
        source: existing.sourceCustody,
        depositedAt: existing.depositedAt,
        status: existing.status,
        success: true,
      };
    }
  }

  const businessDate = getIstBusinessDate();
  const dateCompact = businessDate.replace(/-/g, '');
  let depositSeq;
  try {
    depositSeq = await SequenceCounter.generateId({
      organisationId: orgId,
      sequenceKey: `BDEP_${dateCompact}`,
      prefix: `BDEP-${dateCompact}`,
      minimumDigits: 4,
    });
  } catch {
    depositSeq = `BDEP-${dateCompact}-${Date.now().toString(36).toUpperCase()}-${Math.floor(1000 + Math.random() * 9000)}`;
  }

  return await executeTransactionWithRetry(async (session) => {
    // Re-check idempotency under transaction/concurrency lock
    if (idempotencyKey) {
      const existing = await BankDeposit.findOne({ organisationId: orgId, idempotencyKey }).session(session || null);
      if (existing) {
        return {
          idempotentReplay: true,
          depositId: existing.depositId,
          bankAccountId: existing.bankAccountId,
          bankName: existing.bankName,
          amountPaisa: existing.amountPaisa,
          sourceCustody: existing.sourceCustody,
          source: existing.sourceCustody,
          depositedAt: existing.depositedAt,
          status: existing.status,
          success: true,
        };
      }
    }

    let remainingSafeBalancePaisa = null;
    let remainingTillBalancePaisa = null;

    if (effectiveCustody === 'SAFE') {
      // Case B: Safe -> Bank
      // Atomic conditional decrement: currentBalancePaisa >= amount
      const updatedSafe = await SafeCustody.findOneAndUpdate(
        {
          organisationId: orgId,
          cafeId: cleanCafe,
          currentBalancePaisa: { $gte: amount },
        },
        {
          $inc: { currentBalancePaisa: -amount },
          $set: { lastUpdated: new Date() },
        },
        {
          returnDocument: 'after',
          session: session || undefined,
        }
      );

      if (!updatedSafe) {
        const currentSafe = await SafeCustody.findOne({ organisationId: orgId, cafeId: cleanCafe }).session(session || null);
        const available = currentSafe ? (currentSafe.currentBalancePaisa || 0) : 0;
        throw new ApiError(
          400,
          'INSUFFICIENT_SAFE_CUSTODY',
          `Cannot deposit ₹${(amount / 100).toFixed(2)} from safe: available safe balance is only ₹${(available / 100).toFixed(2)}.`
        );
      }
      remainingSafeBalancePaisa = updatedSafe.currentBalancePaisa;
    } else if (effectiveCustody === 'REGISTER') {
      // Case C: Direct Register -> Bank
      let regSession = null;
      if (registerSessionId) {
        regSession = await (session
          ? RegisterSession.findOne({ organisationId: orgId, registerSessionId, status: 'OPEN' }).session(session)
          : RegisterSession.findOne({ organisationId: orgId, registerSessionId, status: 'OPEN' }));
      } else {
        regSession = await (session
          ? RegisterSession.findOne({ organisationId: orgId, cafeId: cleanCafe, status: 'OPEN' }).session(session)
          : RegisterSession.findOne({ organisationId: orgId, cafeId: cleanCafe, status: 'OPEN' }));
      }

      if (!regSession) {
        throw new ApiError(404, 'ACTIVE_SESSION_NOT_FOUND', `Active register session not found for direct bank deposit.`);
      }

      if ((regSession.expectedCashPaisa || 0) < amount) {
        throw new ApiError(
          400,
          'INSUFFICIENT_TILL_CASH',
          `Cannot deposit ₹${(amount / 100).toFixed(2)} directly from till: till balance is only ₹${(
            (regSession.expectedCashPaisa || 0) / 100
          ).toFixed(2)}.`
        );
      }

      regSession.expectedCashPaisa -= amount;
      regSession.cashEvents.push({
        eventType: 'BANK_DEPOSIT',
        amountPaisa: amount,
        reason: `Direct Register Cash Deposit to ${bankAccount.bankName}: Ref ${referenceNumber || depositSeq}`,
        actorId: authContext.userId || 'SYSTEM',
        reference: depositSeq,
        sourceCustody: 'REGISTER',
        timestamp: new Date(),
      });

      await regSession.save(session ? { session } : {});
      remainingTillBalancePaisa = regSession.expectedCashPaisa;
    }

    // Persist BankDeposit record (unique index on idempotencyKey protects against duplicate concurrent inserts)
    let depositRecord;
    try {
      depositRecord = new BankDeposit({
        depositId: depositSeq,
        organisationId: orgId,
        cafeId: cleanCafe,
        bankAccountId: cleanBankId,
        bankName: bankAccount.bankName,
        sourceCustody: effectiveCustody,
        registerSessionId: effectiveCustody === 'REGISTER' ? (registerSessionId || null) : null,
        amountPaisa: amount,
        referenceNumber: referenceNumber || '',
        supportingDocumentUrl: supportingDocumentUrl || '',
        idempotencyKey: idempotencyKey || null,
        status: 'IN_TRANSIT',
        depositedAt: new Date(),
        depositedByUserId: authContext.userId || 'SYSTEM',
      });
      await depositRecord.save(session ? { session } : {});
    } catch (insertErr) {
      if (insertErr.code === 11000 && idempotencyKey) {
        const replay = await BankDeposit.findOne({ organisationId: orgId, idempotencyKey });
        if (replay) {
          return {
            idempotentReplay: true,
            depositId: replay.depositId,
            bankAccountId: replay.bankAccountId,
            bankName: replay.bankName,
            amountPaisa: replay.amountPaisa,
            sourceCustody: replay.sourceCustody,
            source: replay.sourceCustody,
            depositedAt: replay.depositedAt,
            status: replay.status,
            success: true,
          };
        }
      }
      throw insertErr;
    }

    // Record treasury custody cash movement
    try {
      const ctSeqId = `CT-${businessDate.replace(/-/g, '')}-${Math.floor(1000 + Math.random() * 9000)}`;
      const cashTx = new CashTransaction({
        cashTransactionId: ctSeqId,
        organisationId: orgId,
        cafeId: cleanCafe,
        businessDate,
        transactionType: 'BANK_DEPOSIT',
        direction: 'OUT',
        category: 'BANK_DEPOSIT',
        amount: amount / 100,
        paymentMethod: 'CASH',
        status: 'POSTED',
        description: `Bank Cash Deposit (${effectiveCustody}) to ${bankAccount.bankName} (${bankAccount.accountNumberMasked || 'AC'}): Ref ${referenceNumber}`,
        referenceType: 'BANK_DEPOSIT',
        referenceId: depositSeq,
        recordedBy: authContext.userId || 'SYSTEM',
        createdBy: authContext.userId || 'SYSTEM',
      });
      await cashTx.save(session ? { session } : {});
    } catch (ctErr) {
      console.warn('[BANK_DEPOSIT] Could not record CashTransaction:', ctErr?.message);
    }

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
          depositId: depositSeq,
          amountPaisa: amount,
          bankName: bankAccount.bankName,
          sourceCustody: effectiveCustody,
          referenceNumber,
          remainingSafeBalancePaisa,
          remainingTillBalancePaisa,
        },
      }).catch(() => {});
    }

    return {
      success: true,
      depositId: depositSeq,
      bankAccountId: cleanBankId,
      bankName: bankAccount.bankName,
      amountPaisa: amount,
      sourceCustody: effectiveCustody,
      source: effectiveCustody,
      depositedAt: depositRecord.depositedAt,
      status: 'IN_TRANSIT',
      remainingSafeBalancePaisa,
      remainingTillBalancePaisa,
    };
  });
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
    //            - BANK_DEPOSIT (ONLY if sourced directly from REGISTER till)
    let derivedExpected = regSession.openingFloatPaisa || 0;
    for (const ev of regSession.cashEvents || []) {
      if (['CASH_SALE', 'CASH_IN', 'RECEIVABLE_COLLECTION', 'ADVANCE_DEPOSIT'].includes(ev.eventType)) {
        derivedExpected += ev.amountPaisa;
      } else if (['SAFE_DROP', 'CASH_OUT', 'CASH_REFUND', 'ADVANCE_REFUND'].includes(ev.eventType)) {
        derivedExpected -= ev.amountPaisa;
      } else if (ev.eventType === 'BANK_DEPOSIT') {
        if (ev.sourceCustody === 'REGISTER' || ev.source === 'REGISTER') {
          derivedExpected -= ev.amountPaisa;
        }
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
        returnDocument: 'after',
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

/**
 * Query safe custody balance
 */
async function getSafeCustodyBalance({ organisationId, cafeId }) {
  const orgId = normalizeId(organisationId);
  const cleanCafe = normalizeId(cafeId);
  const safe = await SafeCustody.findOne({ organisationId: orgId, cafeId: cleanCafe }).lean();
  return {
    organisationId: orgId,
    cafeId: cleanCafe,
    currentBalancePaisa: safe ? (safe.currentBalancePaisa || 0) : 0,
    lastUpdated: safe ? safe.lastUpdated : null,
  };
}

/**
 * Query full physical custody balances
 */
async function getCustodyBalances({ organisationId, cafeId, registerSessionId = null }) {
  const orgId = normalizeId(organisationId);
  const cleanCafe = normalizeId(cafeId);

  // 1. Till cash (from active open register session or specified session)
  let tillPaisa = 0;
  const regQuery = { organisationId: orgId, cafeId: cleanCafe, status: 'OPEN' };
  if (registerSessionId) regQuery.registerSessionId = registerSessionId;
  const openSession = await RegisterSession.findOne(regQuery).lean();
  if (openSession) {
    tillPaisa = openSession.expectedCashPaisa || 0;
  }

  // 2. Safe custody cash
  const safe = await SafeCustody.findOne({ organisationId: orgId, cafeId: cleanCafe }).lean();
  const safePaisa = safe ? (safe.currentBalancePaisa || 0) : 0;

  // 3. Bank in-transit cash (submitted deposits not yet reconciled)
  const inTransitAgg = await BankDeposit.aggregate([
    {
      $match: {
        organisationId: orgId,
        cafeId: cleanCafe,
        status: { $in: ['SUBMITTED', 'IN_TRANSIT'] },
      },
    },
    {
      $group: {
        _id: null,
        totalInTransitPaisa: { $sum: '$amountPaisa' },
      },
    },
  ]);
  const bankInTransitPaisa = inTransitAgg[0]?.totalInTransitPaisa || 0;

  // 4. Reconciled bank balance
  const bankAccounts = await BankAccount.find({
    organisationId: orgId,
    status: 'ACTIVE',
  }).lean();
  const reconciledBankPaisa = bankAccounts.reduce((sum, b) => sum + (b.reconciledBalancePaisa || 0), 0);

  return {
    organisationId: orgId,
    cafeId: cleanCafe,
    tillPaisa,
    safePaisa,
    bankInTransitPaisa,
    reconciledBankPaisa,
    totalCashInCustodyPaisa: tillPaisa + safePaisa + bankInTransitPaisa,
  };
}

/**
 * Concurrency-Safe Bank Deposit Confirmation / Reconciliation
 * Moves cash from IN_TRANSIT to BankAccount.reconciledBalancePaisa.
 * Safe custody balance was already reduced during deposit creation.
 * Confirmation moves in-transit cash to bank reconciled balance exactly once.
 * Replays are idempotent and never double-credit bank balance or change sales.
 */
async function confirmBankDeposit({
  organisationId,
  cafeId,
  depositId,
  reconciliationReference = '',
  authContext = {},
}) {
  const orgId = normalizeId(organisationId);
  const cleanCafe = normalizeId(cafeId);
  const cleanDepositId = normalizeId(depositId);

  if (!orgId || !cleanDepositId) {
    throw new ApiError(400, 'VALIDATION_FAILED', 'organisationId and depositId are required.');
  }

  // Find deposit
  const query = { organisationId: orgId, depositId: cleanDepositId };
  if (cleanCafe) query.cafeId = cleanCafe;

  const deposit = await BankDeposit.findOne(query);
  if (!deposit) {
    throw new ApiError(404, 'BANK_DEPOSIT_NOT_FOUND', `Bank deposit ${cleanDepositId} not found.`);
  }

  // Idempotency fast-path: if already confirmed or reconciled, return cleanly
  if (['CONFIRMED', 'RECONCILED'].includes(deposit.status)) {
    const bankAccount = await BankAccount.findOne({
      organisationId: orgId,
      bankAccountId: deposit.bankAccountId,
    }).lean();

    return {
      idempotentReplay: true,
      depositId: deposit.depositId,
      bankAccountId: deposit.bankAccountId,
      amountPaisa: deposit.amountPaisa,
      status: deposit.status,
      reconciledAt: deposit.reconciledAt,
      reconciledBankBalancePaisa: bankAccount?.reconciledBalancePaisa || 0,
      success: true,
    };
  }

  if (!['SUBMITTED', 'IN_TRANSIT'].includes(deposit.status)) {
    throw new ApiError(
      400,
      'INVALID_DEPOSIT_STATUS',
      `Deposit ${cleanDepositId} in status '${deposit.status}' cannot be confirmed.`
    );
  }

  return await executeTransactionWithRetry(async (session) => {
    // Atomically transition status from SUBMITTED/IN_TRANSIT to CONFIRMED
    const updatedDeposit = await BankDeposit.findOneAndUpdate(
      {
        organisationId: orgId,
        depositId: cleanDepositId,
        status: { $in: ['SUBMITTED', 'IN_TRANSIT'] },
      },
      {
        $set: {
          status: 'CONFIRMED',
          reconciledAt: new Date(),
          reconciliationReference: String(reconciliationReference || '').trim(),
          reconciledByUserId: authContext.userId || 'SYSTEM',
        },
      },
      {
        returnDocument: 'after',
        session: session || undefined,
      }
    );

    if (!updatedDeposit) {
      // Concurrency check: already confirmed by parallel request
      const alreadyConfirmed = await BankDeposit.findOne({
        organisationId: orgId,
        depositId: cleanDepositId,
        status: { $in: ['CONFIRMED', 'RECONCILED'] },
      }).session(session || null);

      if (alreadyConfirmed) {
        const bankAccount = await BankAccount.findOne({
          organisationId: orgId,
          bankAccountId: alreadyConfirmed.bankAccountId,
        }).session(session || null);

        return {
          idempotentReplay: true,
          depositId: alreadyConfirmed.depositId,
          bankAccountId: alreadyConfirmed.bankAccountId,
          amountPaisa: alreadyConfirmed.amountPaisa,
          status: alreadyConfirmed.status,
          reconciledAt: alreadyConfirmed.reconciledAt,
          reconciledBankBalancePaisa: bankAccount?.reconciledBalancePaisa || 0,
          success: true,
        };
      }

      throw new ApiError(409, 'DEPOSIT_CONFIRMATION_CONFLICT', 'Deposit was modified concurrently.');
    }

    // Atomically increment BankAccount.reconciledBalancePaisa
    const updatedBank = await BankAccount.findOneAndUpdate(
      {
        organisationId: orgId,
        bankAccountId: updatedDeposit.bankAccountId,
      },
      {
        $inc: { reconciledBalancePaisa: updatedDeposit.amountPaisa },
        $set: { lastReconciledDate: getIstBusinessDate() },
      },
      {
        returnDocument: 'after',
        session: session || undefined,
      }
    );

    if (!updatedBank) {
      throw new ApiError(
        404,
        'BANK_ACCOUNT_NOT_FOUND',
        `Destination bank account ${updatedDeposit.bankAccountId} not found.`
      );
    }

    if (authContext && authContext.userId) {
      await auditService.recordAuditEvent({
        organisationId: orgId,
        cafeId: updatedDeposit.cafeId,
        userId: authContext.userId,
        eventCategory: 'TREASURY',
        eventType: 'BANK_DEPOSIT_CONFIRMED',
        resourceType: 'BankDeposit',
        resourceId: cleanDepositId,
        details: {
          depositId: cleanDepositId,
          bankAccountId: updatedDeposit.bankAccountId,
          amountPaisa: updatedDeposit.amountPaisa,
          reconciledBalancePaisa: updatedBank.reconciledBalancePaisa,
          reconciliationReference,
        },
      }).catch(() => {});
    }

    return {
      success: true,
      depositId: cleanDepositId,
      bankAccountId: updatedDeposit.bankAccountId,
      amountPaisa: updatedDeposit.amountPaisa,
      reconciledBankBalancePaisa: updatedBank.reconciledBalancePaisa,
      status: 'CONFIRMED',
      reconciledAt: updatedDeposit.reconciledAt,
    };
  });
}

module.exports = {
  openRegisterSession,
  recordCashDrop,
  recordBankDeposit,
  confirmBankDeposit,
  closeRegisterSessionAtomic,
  getSafeCustodyBalance,
  getCustodyBalances,
};
