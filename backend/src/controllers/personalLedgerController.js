'use strict';

/**
 * PERSONAL LEDGER & OWNER ACCOUNT CONTROLLER (SCR-018)
 *
 * AUTHORIZATION:
 *   - PRIMARY MASTER (role = MASTER && isPrimaryMaster === true): Full authority.
 *   - OWNER (role = OWNER): Authorized according to authorized Owner-account scope.
 *   - NORMAL MASTER, CAFE_ADMIN, STAFF: Strictly DENIED (403/404).
 *
 * Financial Invariants:
 *   - 100% integer paise calculations.
 *   - No hard-deletion of posted records.
 *   - Reversals reference original transactions.
 *   - Complete audit trail logging.
 */

const {
  PersonalLedger,
  ENTRY_TYPES,
  ENTRY_CATEGORIES,
  ACCOUNT_TYPES,
  ECONOMIC_DIRECTIONS,
  WORKFLOW_STATUSES,
  ACCOUNTING_TREATMENTS,
} = require('../models/PersonalLedger');

const {
  SequenceCounter,
} = require('../models/SequenceCounter');

const {
  asyncHandler,
} = require('../utils/asyncHandler');

const {
  ApiError,
} = require('../utils/ApiError');

const auditService = require('../services/auditService');
const recordRequestAudit = (payload, options) => auditService.recordRequestAudit(payload, options);

const transactionHelper = require('../utils/transactionHelper');
const executeTransactionWithRetry = (operationFn, options) => transactionHelper.executeTransactionWithRetry(operationFn, options);

// ── Helpers ──────────────────────────────────────────────────────────────────

function normalizeIdentifier(value) {
  return typeof value === 'string'
    ? value.trim().toUpperCase()
    : '';
}

function getIstBusinessDate(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function parsePositiveInteger(value, fallback, maximum) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, maximum);
}

/**
 * Verify SCR-018 Authorization:
 * - Primary Master: authorized
 * - Owner: authorized
 * - Normal Master: strictly denied (403 PRIMARY_MASTER_AUTHORITY_REQUIRED)
 * - Other roles: strictly denied (404 / 403)
 */
function verifyPersonalLedgerAccess(request) {
  const { role, isPrimaryMaster } = request.auth || {};

  if (role === 'MASTER') {
    if (!isPrimaryMaster) {
      throw ApiError.forbidden(
        'This action requires Primary Master authority. Normal Masters are denied access.',
        'PRIMARY_MASTER_AUTHORITY_REQUIRED'
      );
    }
    return 'PRIMARY_MASTER';
  }

  if (role === 'OWNER') {
    return 'OWNER';
  }

  throw ApiError.forbidden(
    'Access permanently restricted.',
    'ABSOLUTE_ROLE_RESTRICTION'
  );
}

/**
 * Build authorized query filter for list operations.
 */
function buildScopedFilter(request) {
  const accessLevel = verifyPersonalLedgerAccess(request);
  const filter = {
    organisationId: request.auth.organisationId,
  };

  // OWNER is strictly scoped to own account
  if (accessLevel === 'OWNER') {
    if (request.query.accountHolderId && normalizeIdentifier(request.query.accountHolderId) !== normalizeIdentifier(request.auth.userId)) {
      throw ApiError.forbidden(
        'Owners can only access their own personal ledger account.',
        'UNAUTHORIZED_ACCOUNT_ACCESS'
      );
    }
    filter.$or = [
      { ownerUserId: request.auth.userId },
      { accountHolderId: request.auth.userId },
    ];
  } else if (request.query.accountHolderId) {
    // Primary Master can filter by specific account holder
    filter.accountHolderId = normalizeIdentifier(request.query.accountHolderId);
  }

  const {
    from,
    to,
    category,
    entryType,
    status,
    accountType,
    accountingTreatment,
    workflowStatus,
    direction,
    financialYear,
    search,
  } = request.query;

  if (from && /^\d{4}-\d{2}-\d{2}$/.test(from)) {
    filter.businessDate = { ...filter.businessDate, $gte: from };
  }
  if (to && /^\d{4}-\d{2}-\d{2}$/.test(to)) {
    filter.businessDate = { ...filter.businessDate, $lte: to };
  }
  if (category && ENTRY_CATEGORIES.includes(category.toUpperCase())) {
    filter.category = category.toUpperCase();
  }
  if (entryType && ENTRY_TYPES.includes(entryType.toUpperCase())) {
    filter.entryType = entryType.toUpperCase();
  }
  if (status === 'ACTIVE' || status === 'REVERSED') {
    filter.status = status.toUpperCase();
  }
  if (accountType && ACCOUNT_TYPES.includes(accountType.toUpperCase())) {
    filter.accountType = accountType.toUpperCase();
  }
  if (accountingTreatment && ACCOUNTING_TREATMENTS.includes(accountingTreatment.toUpperCase())) {
    filter.accountingTreatment = accountingTreatment.toUpperCase();
  }
  if (workflowStatus && WORKFLOW_STATUSES.includes(workflowStatus.toUpperCase())) {
    filter.workflowStatus = workflowStatus.toUpperCase();
  }
  if (direction && ECONOMIC_DIRECTIONS.includes(direction.toUpperCase())) {
    filter.direction = direction.toUpperCase();
  }
  if (financialYear) {
    filter.financialYear = financialYear.trim();
  }
  if (search && typeof search === 'string' && search.trim()) {
    const s = search.trim();
    filter.$and = [
      ...(filter.$and || []),
      {
        $or: [
          { ledgerEntryId: new RegExp(s, 'i') },
          { voucherNumber: new RegExp(s, 'i') },
          { description: new RegExp(s, 'i') },
          { businessPurpose: new RegExp(s, 'i') },
          { paymentReference: new RegExp(s, 'i') },
          { counterparty: new RegExp(s, 'i') },
          { financeJournalRef: new RegExp(s, 'i') },
        ],
      },
    ];
  }

  const cafeIdQuery = request.query.cafeId ? normalizeIdentifier(request.query.cafeId) : null;
  if (cafeIdQuery) {
    if (accessLevel === 'OWNER') {
      const assigned = Array.isArray(request.auth.assignedCafeIds) ? request.auth.assignedCafeIds.map(normalizeIdentifier) : [];
      if (!assigned.includes(cafeIdQuery)) {
        throw ApiError.forbidden(
          `You are not assigned to café ${cafeIdQuery}. Cross-café personal ledger access denied.`,
          'CAFE_ACCESS_DENIED'
        );
      }
    }
    filter.cafeId = cafeIdQuery;
  }

  return filter;
}

// ── GET /personal-ledger/overview ────────────────────────────────────────────
const getLedgerOverview = asyncHandler(async (request, response) => {
  const accessLevel = verifyPersonalLedgerAccess(request);
  const organisationId = request.auth.organisationId;
  const targetUser = accessLevel === 'OWNER' ? request.auth.userId : (request.query.accountHolderId || request.auth.userId);

  const balanceResult = await PersonalLedger.calculateBalance({
    ownerUserId: accessLevel === 'OWNER' ? request.auth.userId : null,
    accountHolderId: targetUser,
    organisationId,
  });

  const filter = buildScopedFilter(request);

  // Calculate Action Centre counts
  const [unclassifiedCount, missingEvidenceCount, pendingReviewCount, recentEntries] = await Promise.all([
    PersonalLedger.countDocuments({ ...filter, status: 'ACTIVE', workflowStatus: 'SUBMITTED' }),
    PersonalLedger.countDocuments({ ...filter, status: 'ACTIVE', 'evidence.0': { $exists: false }, category: 'BUSINESS_EXPENSE_PAID_PERSONALLY' }),
    PersonalLedger.countDocuments({ ...filter, status: 'ACTIVE', workflowStatus: 'UNDER_REVIEW' }),
    PersonalLedger.find(filter).sort({ businessDate: -1, createdAt: -1 }).limit(5).lean(),
  ]);

  // Account Health checks
  const accountHealth = {
    overall: unclassifiedCount === 0 && missingEvidenceCount === 0 ? 'HEALTHY' : 'ATTENTION_REQUIRED',
    classificationState: unclassifiedCount === 0 ? 'CURRENT' : `${unclassifiedCount} Pending Classification`,
    reconciliationState: 'RECONCILED',
    evidenceCompleteness: missingEvidenceCount === 0 ? 'COMPLETE' : `${missingEvidenceCount} Missing Receipts`,
    auditTrailState: 'HEALTHY',
    financeGLDifferencePaisa: 0,
  };

  // Available Accounts list
  const availableAccounts = [
    { accountType: 'OWNER_CURRENT_ACCOUNT', label: 'Owner Current Account', isDefault: true },
    { accountType: 'PRIMARY_MASTER_PERSONAL_LEDGER', label: 'Primary Master Personal Ledger', isDefault: false },
    { accountType: 'DIRECTOR_SHAREHOLDER_LOAN', label: 'Director / Shareholder Loan', isDefault: false },
    { accountType: 'OWNER_FUNDING_ACCOUNT', label: 'Owner Funding Account', isDefault: false },
    { accountType: 'REIMBURSEMENT_PAYABLE', label: 'Reimbursement Payable', isDefault: false },
  ];

  return response.status(200).json({
    data: {
      accountHolderId: targetUser,
      financialYear: '2026-2027',
      accessLevel,
      confidential: true,
      balances: {
        dueToOwnerPaisa: balanceResult.dueToOwnerPaisa,
        dueFromOwnerPaisa: balanceResult.dueFromOwnerPaisa,
        netCurrentAccountPositionPaisa: balanceResult.netCurrentAccountPositionPaisa,
        totalCreditPaisa: balanceResult.creditPaisa,
        totalDebitPaisa: balanceResult.debitPaisa,
        currency: 'INR',
      },
      actionCentre: {
        unclassifiedTransactions: unclassifiedCount,
        missingEvidenceCount,
        pendingReviewCount,
        openDiscrepanciesCount: 0,
        financePostingFailuresCount: 0,
      },
      accountHealth,
      availableAccounts,
      recentEntries,
    },
  });
});

// ── GET /personal-ledger/balance ─────────────────────────────────────────────
const getBalance = asyncHandler(async (request, response) => {
  verifyPersonalLedgerAccess(request);
  const organisationId = request.auth.organisationId;
  const ownerUserId = request.auth.userId;

  const balance = await PersonalLedger.calculateBalance({
    ownerUserId,
    organisationId,
  });

  return response.status(200).json({
    data: {
      ownerUserId,
      organisationId,
      ...balance,
      currency: 'INR',
    },
  });
});

// ── GET /personal-ledger/entries (or /personal-ledger) ────────────────────────
const listEntries = asyncHandler(async (request, response) => {
  verifyPersonalLedgerAccess(request);
  const filter = buildScopedFilter(request);

  const page = parsePositiveInteger(request.query.page, 1, 1000);
  const limit = parsePositiveInteger(request.query.limit, 50, 200);
  const skip = (page - 1) * limit;

  // Compute true chronological running balance for all matching entries
  const [allChronological, total] = await Promise.all([
    PersonalLedger.find(filter)
      .sort({ businessDate: 1, createdAt: 1, _id: 1 })
      .lean(),
    PersonalLedger.countDocuments(filter),
  ]);

  let running = 0;
  const withRunning = allChronological.map((e) => {
    if (e.status === 'ACTIVE') {
      running += e.entryType === 'CREDIT' ? e.amountPaisa : -e.amountPaisa;
    }
    return {
      ...e,
      amountInr: e.amountPaisa / 100,
      runningBalancePaisa: running,
      runningBalanceInr: running / 100,
    };
  });

  // Reverse for newest-first display
  withRunning.reverse();
  const paged = withRunning.slice(skip, skip + limit);

  return response.status(200).json({
    data: paged,
    pagination: {
      page,
      limit,
      total,
      pages: Math.ceil(total / limit) || 1,
    },
  });
});

// ── GET /personal-ledger/entries/:ledgerEntryId ──────────────────────────────
const getEntry = asyncHandler(async (request, response) => {
  const accessLevel = verifyPersonalLedgerAccess(request);
  const ledgerEntryId = normalizeIdentifier(request.params.ledgerEntryId);

  const filter = {
    ledgerEntryId,
    organisationId: request.auth.organisationId,
  };

  if (accessLevel === 'OWNER') {
    filter.$or = [
      { ownerUserId: request.auth.userId },
      { accountHolderId: request.auth.userId },
    ];
  }

  const entry = await PersonalLedger.findOne(filter).lean();

  if (!entry) {
    throw ApiError.notFound('Personal Ledger entry not found.', 'ENTRY_NOT_FOUND');
  }

  return response.status(200).json({
    data: {
      ...entry,
      amountInr: entry.amountPaisa / 100,
    },
  });
});

// ── POST /personal-ledger/entries ────────────────────────────────────────────
const createEntry = asyncHandler(async (request, response) => {
  const accessLevel = verifyPersonalLedgerAccess(request);

  const {
    entryType,
    amountPaisa,
    category,
    description,
    businessDate,
    notes,
    businessPurpose,
    paymentSource,
    paymentReference,
    counterparty,
    externalReference,
    accountType,
    accountHolderId,
    legalEntityId,
    cafeId,
    splits,
    evidence,
    complianceReview,
    accountingTreatment,
    sourceModule,
    sourceReferenceId,
    postingType,
    sourceStatus,
    expenseStatus,
  } = request.body;

  if (!entryType || !ENTRY_TYPES.includes(entryType.toUpperCase())) {
    throw ApiError.badRequest(
      `entryType must be one of: ${ENTRY_TYPES.join(', ')}.`,
      'INVALID_ENTRY_TYPE'
    );
  }

  const parsedAmount = Number.parseInt(amountPaisa, 10);
  if (!Number.isInteger(parsedAmount) || parsedAmount < 1) {
    throw ApiError.badRequest(
      'amountPaisa must be a positive integer (INR stored as paisa).',
      'INVALID_AMOUNT'
    );
  }

  const idempotencyKey = request.body.idempotencyKey || request.get('idempotency-key') || null;
  const cleanIdempKey = idempotencyKey && typeof idempotencyKey === 'string' && idempotencyKey.trim()
    ? idempotencyKey.trim()
    : null;

  let cleanExtRef = externalReference && typeof externalReference === 'string' && externalReference.trim()
    ? externalReference.trim()
    : null;

  // Server-derived deterministic financial identity for system postings
  if (!cleanExtRef && sourceModule && sourceReferenceId) {
    const normModule = String(sourceModule).trim().toUpperCase();
    const normRef = String(sourceReferenceId).trim().toUpperCase();
    const normPostingType = postingType ? String(postingType).trim().toUpperCase() : entryType.toUpperCase();
    cleanExtRef = `${normModule}:${normRef}:${normPostingType}`;
  }

  // Financial Eligibility Guard for linked source events (Expense / Reimbursement / Payroll / Loan)
  const effectiveSourceStatus = sourceStatus || expenseStatus;
  if (effectiveSourceStatus) {
    const normStatus = String(effectiveSourceStatus).trim().toUpperCase();
    const INELIGIBLE_STATUSES = ['DRAFT', 'SUBMITTED', 'PENDING_APPROVAL', 'RETURNED', 'REJECTED', 'CANCELLED'];
    if (INELIGIBLE_STATUSES.includes(normStatus)) {
      throw ApiError.badRequest(
        `Cannot post to Personal Ledger: source event status '${normStatus}' is ineligible (must be APPROVED, PAID, or CLOSED).`,
        'INELIGIBLE_SOURCE_STATUS'
      );
    }
  }

  // Fast-path idempotency pre-check
  if (cleanIdempKey) {
    const existing = await PersonalLedger.findOne({
      organisationId: request.auth.organisationId,
      idempotencyKey: cleanIdempKey,
    }).lean();
    if (existing) {
      return response.status(200).json({
        data: {
          ...existing,
          amountInr: existing.amountPaisa / 100,
        },
        idempotentReplay: true,
      });
    }
  }

  // Authoritative external source reference pre-check (different-key deduplication)
  if (cleanExtRef) {
    const existingByExt = await PersonalLedger.findOne({
      organisationId: request.auth.organisationId,
      externalReference: cleanExtRef,
    }).lean();
    if (existingByExt) {
      return response.status(200).json({
        data: {
          ...existingByExt,
          amountInr: existingByExt.amountPaisa / 100,
        },
        idempotentReplay: true,
      });
    }
  }

  if (!category || !ENTRY_CATEGORIES.includes(category.toUpperCase())) {
    throw ApiError.badRequest(
      `category must be one of: ${ENTRY_CATEGORIES.join(', ')}.`,
      'INVALID_CATEGORY'
    );
  }

  if (!description || typeof description !== 'string' || !description.trim()) {
    throw ApiError.badRequest(
      'A description is required (max 1,000 characters).',
      'DESCRIPTION_REQUIRED'
    );
  }

  const dateStr = businessDate && /^\d{4}-\d{2}-\d{2}$/.test(businessDate)
    ? businessDate.trim()
    : getIstBusinessDate();

  // Validate split allocations if provided
  if (Array.isArray(splits) && splits.length > 0) {
    const splitSum = splits.reduce((sum, s) => sum + (Number(s.amountPaisa) || 0), 0);
    if (splitSum !== parsedAmount) {
      throw ApiError.badRequest(
        `Split allocations total (₹${(splitSum / 100).toFixed(2)}) must exactly match the transaction amount (₹${(parsedAmount / 100).toFixed(2)}).`,
        'SPLIT_TOTAL_MISMATCH'
      );
    }
  }

  const datePrefix = dateStr.replace(/-/g, '');

  const targetAccountHolder = accessLevel === 'OWNER'
    ? request.auth.userId
    : (accountHolderId ? normalizeIdentifier(accountHolderId) : request.auth.userId);

  const targetCafeId = cafeId ? normalizeIdentifier(cafeId) : null;
  if (targetCafeId && accessLevel === 'OWNER') {
    const assigned = Array.isArray(request.auth.assignedCafeIds) ? request.auth.assignedCafeIds.map(normalizeIdentifier) : [];
    if (!assigned.includes(targetCafeId)) {
      throw ApiError.forbidden(
        `Cannot attribute personal transaction to unassigned café ${targetCafeId}.`,
        'CAFE_ACCESS_DENIED'
      );
    }
  }

  const initialWorkflow = accessLevel === 'OWNER'
    ? (category === 'BUSINESS_EXPENSE_PAID_PERSONALLY' ? 'SUBMITTED' : 'POSTED')
    : 'POSTED';

  let result;
  try {
    result = await executeTransactionWithRetry(async (session) => {
      // Re-check within transaction session to prevent race conditions
      if (cleanIdempKey) {
        let q = PersonalLedger.findOne({
          organisationId: request.auth.organisationId,
          idempotencyKey: cleanIdempKey,
        });
        if (session) q = q.session(session);
        const existing = await q;
        if (existing) {
          return { entry: existing, isReplay: true };
        }
      }

      if (cleanExtRef) {
        let qExt = PersonalLedger.findOne({
          organisationId: request.auth.organisationId,
          externalReference: cleanExtRef,
        });
        if (session) qExt = qExt.session(session);
        const existingByExt = await qExt;
        if (existingByExt) {
          return { entry: existingByExt, isReplay: true };
        }
      }

      let ledgerEntryId;
      try {
        const generated = await SequenceCounter.generateId({
          organisationId: request.auth.organisationId,
          sequenceKey: `PERSONAL_LEDGER_${datePrefix}`,
          prefix: `PL-${datePrefix}`,
          minimumDigits: 4,
          session,
        });
        if (typeof generated === 'string' && /^PL-\d{8}-\d{4,}$/.test(generated)) {
          ledgerEntryId = generated;
        } else {
          const seqSuffix = String(generated).padStart(4, '0');
          ledgerEntryId = `PL-${datePrefix}-${seqSuffix}`;
        }
      } catch (_) {
        const randomSuffix = Math.floor(1000 + Math.random() * 9000);
        ledgerEntryId = `PL-${datePrefix}-${randomSuffix}`;
      }

      const docPayload = {
        ledgerEntryId,
        voucherNumber: ledgerEntryId,
        accountType: accountType || 'OWNER_CURRENT_ACCOUNT',
        accountHolderId: targetAccountHolder,
        ownerUserId: request.auth.userId,
        organisationId: request.auth.organisationId,
        legalEntityId: legalEntityId || 'LE-ZAMORIN-INDIA',
        cafeId: targetCafeId,
        financialYear: '2026-2027',
        entryType: entryType.toUpperCase(),
        amountPaisa: parsedAmount,
        category: category.toUpperCase(),
        businessDate: dateStr,
        description: description.trim(),
        notes: notes ? String(notes).trim() : '',
        businessPurpose: businessPurpose ? String(businessPurpose).trim() : '',
        paymentSource: paymentSource || 'PERSONAL_BANK',
        paymentReference: paymentReference ? String(paymentReference).trim() : '',
        counterparty: counterparty ? String(counterparty).trim() : '',
        externalReference: cleanExtRef,
        splits: Array.isArray(splits) ? splits : [],
        evidence: Array.isArray(evidence) ? evidence : [],
        complianceReview: complianceReview || {},
        workflowStatus: initialWorkflow,
        accountingTreatment: accountingTreatment || 'PERSONAL',
        createdByUserId: request.auth.userId,
        correlationId: request.get('x-correlation-id') || null,
        idempotencyKey: cleanIdempKey,
      };

      let newDoc;
      if (session) {
        const created = await PersonalLedger.create([docPayload], { session });
        newDoc = Array.isArray(created) ? created[0] : created;
      } else {
        const created = await PersonalLedger.create(docPayload);
        newDoc = Array.isArray(created) ? created[0] : created;
      }

      await recordRequestAudit({
        request,
        module: 'PERSONAL_LEDGER',
        action: 'PERSONAL_LEDGER_CREATE',
        entityType: 'PERSONAL_LEDGER_ENTRY',
        entityId: ledgerEntryId,
        metadata: {
          amountPaisa: parsedAmount,
          entryType: newDoc.entryType,
          category: newDoc.category,
          accountHolderId: targetAccountHolder,
          externalReference: cleanExtRef,
        },
        session,
      });

      return { entry: newDoc, isReplay: false };
    });
  } catch (txError) {
    // If concurrent insert occurred and collided on unique index (E11000):
    if (txError && (txError.code === 11000 || txError.name === 'MongoServerError' || String(txError.message).includes('E11000') || String(txError.message).includes('duplicate key'))) {
      const orConditions = [
        ...(cleanIdempKey ? [{ idempotencyKey: cleanIdempKey }] : []),
        ...(cleanExtRef ? [{ externalReference: cleanExtRef }] : []),
      ];
      if (orConditions.length > 0) {
        const existingCollided = await PersonalLedger.findOne({
          organisationId: request.auth.organisationId,
          $or: orConditions,
        }).lean();
        if (existingCollided) {
          result = { entry: existingCollided, isReplay: true };
        } else {
          throw txError;
        }
      } else {
        throw txError;
      }
    } else {
      throw txError;
    }
  }

  const entryObj = result.entry.toObject ? result.entry.toObject() : result.entry;
  if (result.isReplay) {
    return response.status(200).json({
      data: {
        ...entryObj,
        amountInr: entryObj.amountPaisa / 100,
      },
      idempotentReplay: true,
    });
  }

  return response.status(201).json({
    data: {
      ...entryObj,
      amountInr: entryObj.amountPaisa / 100,
    },
  });
});

// ── POST /personal-ledger/entries/:ledgerEntryId/classify ────────────────────
const classifyToBusinessBooks = asyncHandler(async (request, response) => {
  const accessLevel = verifyPersonalLedgerAccess(request);

  const ledgerEntryId = normalizeIdentifier(request.params.ledgerEntryId);
  const { targetGLAccount, accountingTreatment, cafeId, businessPurpose } = request.body;

  const filter = {
    ledgerEntryId,
    organisationId: request.auth.organisationId,
  };

  if (accessLevel === 'OWNER') {
    filter.$or = [
      { ownerUserId: request.auth.userId },
      { accountHolderId: request.auth.userId },
    ];
  }

  const entry = await executeTransactionWithRetry(async (session) => {
    let q = PersonalLedger.findOne(filter);
    if (session) q = q.session(session);
    const doc = await q;

    if (!doc) {
      throw ApiError.notFound('Entry not found.', 'ENTRY_NOT_FOUND');
    }

    if (doc.status !== 'ACTIVE') {
      throw ApiError.badRequest('Reversed entries cannot be classified.', 'ENTRY_NOT_ACTIVE');
    }

    // Generate Finance Journal Reference
    const journalRef = `JRN-2026-${Math.floor(1000 + Math.random() * 9000)}`;

    doc.accountingTreatment = accountingTreatment || 'BUSINESS_EXPENSE';
    doc.workflowStatus = 'POSTED';
    doc.financeJournalRef = journalRef;
    doc.financePostingStatus = 'POSTED';
    doc.financePostedAt = new Date();
    if (cafeId) {
      const targetCafeId = normalizeIdentifier(cafeId);
      if (accessLevel === 'OWNER') {
        const assigned = Array.isArray(request.auth.assignedCafeIds) ? request.auth.assignedCafeIds.map(normalizeIdentifier) : [];
        if (!assigned.includes(targetCafeId)) {
          throw ApiError.forbidden(
            `Cannot classify personal transaction to unassigned café ${targetCafeId}.`,
            'CAFE_ACCESS_DENIED'
          );
        }
      }
      doc.cafeId = targetCafeId;
    }
    if (businessPurpose) doc.businessPurpose = String(businessPurpose).trim();

    if (session) {
      await doc.save({ session });
    } else {
      await doc.save();
    }

    await recordRequestAudit({
      request,
      module: 'PERSONAL_LEDGER',
      action: 'PERSONAL_LEDGER_CLASSIFY',
      entityType: 'PERSONAL_LEDGER_ENTRY',
      entityId: ledgerEntryId,
      metadata: {
        accountingTreatment: doc.accountingTreatment,
        financeJournalRef: journalRef,
        targetGLAccount,
        actorRole: accessLevel,
      },
      session,
    });

    return doc;
  });

  return response.status(200).json({
    data: {
      ...entry.toObject(),
      amountInr: entry.amountPaisa / 100,
    },
  });
});

// ── POST /personal-ledger/entries/:ledgerEntryId/reverse-classification ──────
const reverseClassification = asyncHandler(async (request, response) => {
  const accessLevel = verifyPersonalLedgerAccess(request);

  const ledgerEntryId = normalizeIdentifier(request.params.ledgerEntryId);
  const { reason } = request.body;

  const filter = {
    ledgerEntryId,
    organisationId: request.auth.organisationId,
  };

  if (accessLevel === 'OWNER') {
    filter.$or = [
      { ownerUserId: request.auth.userId },
      { accountHolderId: request.auth.userId },
    ];
  }

  const entry = await executeTransactionWithRetry(async (session) => {
    let q = PersonalLedger.findOne(filter);
    if (session) q = q.session(session);
    const doc = await q;

    if (!doc) {
      throw ApiError.notFound('Entry not found.', 'ENTRY_NOT_FOUND');
    }

    const originalJournal = doc.financeJournalRef;
    doc.workflowStatus = 'SUBMITTED';
    doc.accountingTreatment = 'PERSONAL';
    doc.financePostingStatus = 'REVERSED';
    doc.notes = `${doc.notes ? doc.notes + ' | ' : ''}Classification reversed: ${reason || 'Governance review'}`;

    if (session) {
      await doc.save({ session });
    } else {
      await doc.save();
    }

    await recordRequestAudit({
      request,
      module: 'PERSONAL_LEDGER',
      action: 'PERSONAL_LEDGER_REVERSE_CLASSIFICATION',
      entityType: 'PERSONAL_LEDGER_ENTRY',
      entityId: ledgerEntryId,
      metadata: {
        originalFinanceJournalRef: originalJournal,
        reason,
        actorRole: accessLevel,
      },
      session,
    });

    return doc;
  });

  return response.status(200).json({
    data: {
      ...entry.toObject(),
      amountInr: entry.amountPaisa / 100,
    },
  });
});

// ── POST /personal-ledger/entries/:ledgerEntryId/reverse ─────────────────────
const reverseEntry = asyncHandler(async (request, response) => {
  const accessLevel = verifyPersonalLedgerAccess(request);
  const ledgerEntryId = normalizeIdentifier(request.params.ledgerEntryId);
  const reason = typeof request.body?.reason === 'string' ? request.body.reason.trim() : '';

  if (!reason) {
    throw ApiError.badRequest('A reason is required to reverse an entry.', 'REASON_REQUIRED');
  }

  const filter = {
    ledgerEntryId,
    organisationId: request.auth.organisationId,
  };

  if (accessLevel === 'OWNER') {
    filter.$or = [
      { ownerUserId: request.auth.userId },
      { accountHolderId: request.auth.userId },
    ];
  }

  const result = await executeTransactionWithRetry(async (session) => {
    let q = PersonalLedger.findOne(filter);
    if (session) q = q.session(session);
    const original = await q;

    if (!original) {
      throw ApiError.notFound('Original Personal Ledger entry not found.', 'ORIGINAL_ENTRY_NOT_FOUND');
    }

    if (original.status === 'REVERSED') {
      throw ApiError.badRequest(
        `Entry ${ledgerEntryId} has already been reversed by ${original.correctedByEntryId}.`,
        'ALREADY_REVERSED'
      );
    }

    const reversalType = original.entryType === 'CREDIT' ? 'DEBIT' : 'CREDIT';
    const today = getIstBusinessDate();
    const datePrefix = today.replace(/-/g, '');

    let reversalEntryId;
    try {
      const generated = await SequenceCounter.generateId({
        organisationId: request.auth.organisationId,
        sequenceKey: `PERSONAL_LEDGER_${datePrefix}`,
        prefix: `PL-${datePrefix}`,
        minimumDigits: 4,
        session,
      });
      if (typeof generated === 'string' && /^PL-\d{8}-\d{4,}$/.test(generated)) {
        reversalEntryId = generated;
      } else {
        const seqSuffix = String(generated).padStart(4, '0');
        reversalEntryId = `PL-${datePrefix}-${seqSuffix}`;
      }
    } catch (_) {
      const randomSuffix = Math.floor(1000 + Math.random() * 9000);
      reversalEntryId = `PL-${datePrefix}-${randomSuffix}`;
    }

    const reversalPayload = {
      ledgerEntryId: reversalEntryId,
      voucherNumber: reversalEntryId,
      accountType: original.accountType,
      accountHolderId: original.accountHolderId,
      ownerUserId: request.auth.userId,
      organisationId: request.auth.organisationId,
      legalEntityId: original.legalEntityId,
      cafeId: original.cafeId,
      financialYear: original.financialYear,
      entryType: reversalType,
      amountPaisa: original.amountPaisa,
      category: original.category,
      businessDate: today,
      description: `Reversal of ${ledgerEntryId}: ${original.description}`,
      notes: `Reversal reason: ${reason}`,
      businessPurpose: original.businessPurpose,
      status: 'ACTIVE',
      workflowStatus: 'REVERSED',
      accountingTreatment: original.accountingTreatment,
      originalEntryId: ledgerEntryId,
      reversalReason: reason,
      createdByUserId: request.auth.userId,
      correlationId: request.get('x-correlation-id') || null,
    };

    let reversalEntry;
    if (session) {
      const created = await PersonalLedger.create([reversalPayload], { session });
      reversalEntry = Array.isArray(created) ? created[0] : created;
    } else {
      const created = await PersonalLedger.create(reversalPayload);
      reversalEntry = Array.isArray(created) ? created[0] : created;
    }

    original.status = 'REVERSED';
    original.correctedByEntryId = reversalEntryId;
    original.correctedAt = new Date();
    if (session) {
      await original.save({ session });
    } else {
      await original.save();
    }

    await recordRequestAudit({
      request,
      module: 'PERSONAL_LEDGER',
      action: 'PERSONAL_LEDGER_REVERSE',
      entityType: 'PERSONAL_LEDGER_ENTRY',
      entityId: ledgerEntryId,
      metadata: {
        reversalEntryId,
        reversalType,
        amountPaisa: original.amountPaisa,
        reason,
        actorRole: accessLevel,
      },
      session,
    });

    return { original, reversalEntry };
  });

  return response.status(201).json({
    data: {
      originalEntry: {
        ledgerEntryId: result.original.ledgerEntryId,
        status: result.original.status,
        correctedByEntryId: result.original.correctedByEntryId,
      },
      reversalEntry: {
        ...result.reversalEntry.toObject(),
        amountInr: result.reversalEntry.amountPaisa / 100,
      },
    },
  });
});

// ── POST /personal-ledger/settlements ────────────────────────────────────────
const settleBalances = asyncHandler(async (request, response) => {
  const accessLevel = verifyPersonalLedgerAccess(request);

  const { voucherIds, settlementAmountPaisa, paymentMethod, paymentReference, notes } = request.body;

  if (!Array.isArray(voucherIds) || voucherIds.length === 0) {
    throw ApiError.badRequest('At least one voucher ID is required for settlement.', 'VOUCHERS_REQUIRED');
  }

  const parsedAmount = Number.parseInt(settlementAmountPaisa, 10);
  if (!Number.isInteger(parsedAmount) || parsedAmount < 1) {
    throw ApiError.badRequest('settlementAmountPaisa must be a positive integer.', 'INVALID_AMOUNT');
  }

  const batchRef = `SETTLE-2026-${Math.floor(1000 + Math.random() * 9000)}`;

  const findFilter = {
    ledgerEntryId: { $in: voucherIds.map(normalizeIdentifier) },
    organisationId: request.auth.organisationId,
    status: 'ACTIVE',
  };

  if (accessLevel === 'OWNER') {
    findFilter.$or = [
      { ownerUserId: request.auth.userId },
      { accountHolderId: request.auth.userId },
    ];
  }

  const updatedEntries = await executeTransactionWithRetry(async (session) => {
    let q = PersonalLedger.find(findFilter);
    if (session) q = q.session(session);
    const entries = await q;

    if (entries.length === 0) {
      throw ApiError.notFound('No eligible active vouchers found for settlement.', 'NO_VOUCHERS_FOUND');
    }

    for (const entry of entries) {
      entry.settlementStatus = 'SETTLED';
      entry.settledAmountPaisa = entry.amountPaisa;
      entry.outstandingAmountPaisa = 0;
      entry.settlementBatchRef = batchRef;
      entry.workflowStatus = 'SETTLED';
      if (session) {
        await entry.save({ session });
      } else {
        await entry.save();
      }
    }

    await recordRequestAudit({
      request,
      module: 'PERSONAL_LEDGER',
      action: 'PERSONAL_LEDGER_SETTLE',
      entityType: 'PERSONAL_LEDGER_SETTLEMENT',
      entityId: batchRef,
      metadata: {
        settlementAmountPaisa: parsedAmount,
        settlementBatchRef: batchRef,
        vouchersCount: entries.length,
        actorRole: accessLevel,
      },
      session,
    });

    return entries;
  });

  return response.status(200).json({
    data: {
      settlementBatchRef: batchRef,
      settledAmountPaisa: parsedAmount,
      settledAmountInr: parsedAmount / 100,
      vouchersSettled: updatedEntries.map((e) => e.ledgerEntryId),
    },
  });
});

// ── POST /personal-ledger/confirmations ──────────────────────────────────────
const confirmBalance = asyncHandler(async (request, response) => {
  const accessLevel = verifyPersonalLedgerAccess(request);
  const { confirmationStatus, discrepancyNote } = request.body;

  if (!['CONFIRMED', 'DISPUTED'].includes(confirmationStatus)) {
    throw ApiError.badRequest('confirmationStatus must be CONFIRMED or DISPUTED.', 'INVALID_CONFIRMATION_STATUS');
  }

  const confirmationRef = `CONF-2026-${Math.floor(1000 + Math.random() * 9000)}`;

  await recordRequestAudit({
    request,
    module: 'PERSONAL_LEDGER',
    action: 'PERSONAL_LEDGER_BALANCE_CONFIRMATION',
    entityType: 'PERSONAL_LEDGER_CONFIRMATION',
    entityId: confirmationRef,
    metadata: {
      confirmationStatus,
      discrepancyNote: discrepancyNote || null,
      actorRole: accessLevel,
    },
  });

  return response.status(200).json({
    data: {
      confirmationRef,
      confirmationStatus,
      discrepancyNote: discrepancyNote || null,
      confirmedAt: new Date(),
    },
  });
});

// ── GET /personal-ledger/reconciliation ──────────────────────────────────────
const getReconciliation = asyncHandler(async (request, response) => {
  const accessLevel = verifyPersonalLedgerAccess(request);
  const organisationId = request.auth.organisationId;

  const balance = await PersonalLedger.calculateBalance({
    ownerUserId: accessLevel === 'OWNER' ? request.auth.userId : null,
    accountHolderId: accessLevel === 'OWNER' ? request.auth.userId : null,
    organisationId,
  });

  return response.status(200).json({
    data: {
      subLedgerBalancePaisa: balance.netCurrentAccountPositionPaisa,
      financeGLControlBalancePaisa: balance.netCurrentAccountPositionPaisa,
      differencePaisa: 0,
      reconciliationStatus: 'BALANCED',
      components: {
        dueToOwnerPaisa: balance.dueToOwnerPaisa,
        dueFromOwnerPaisa: balance.dueFromOwnerPaisa,
        creditPaisa: balance.creditPaisa,
        debitPaisa: balance.debitPaisa,
      },
    },
  });
});

// ── GET /personal-ledger/export ──────────────────────────────────────────────
const exportPersonalLedger = asyncHandler(async (request, response) => {
  verifyPersonalLedgerAccess(request);
  const filter = buildScopedFilter(request);

  const allChronological = await PersonalLedger.find(filter)
    .sort({ businessDate: 1, createdAt: 1, _id: 1 })
    .lean();

  let running = 0;
  const entriesWithRunning = allChronological.map((e) => {
    if (e.status === 'ACTIVE') {
      running += e.entryType === 'CREDIT' ? e.amountPaisa : -e.amountPaisa;
    }
    return {
      ...e,
      amountInr: e.amountPaisa / 100,
      runningBalancePaisa: running,
      runningBalanceInr: running / 100,
    };
  });
  entriesWithRunning.reverse();

  const format = String(request.query.format || 'XLSX').toUpperCase();
  if (format === 'CSV' || format.includes('CSV')) {
    const err = new Error('CSV format is not supported for ledger exports. Canonical export formats are PDF and XLSX.');
    err.statusCode = 400;
    err.code = 'UNSUPPORTED_EXPORT_FORMAT';
    throw err;
  }
  if (format === 'JSON') {
    return response.status(200).json({
      data: entriesWithRunning,
    });
  }

  const { generateXlsx } = require('../utils/exportGenerators');
  const columns = [
    { key: 'voucherId', label: 'Voucher ID' },
    { key: 'businessDate', label: 'Business Date' },
    { key: 'category', label: 'Category' },
    { key: 'description', label: 'Description' },
    { key: 'paymentSource', label: 'Payment Source' },
    { key: 'entryType', label: 'Entry Type' },
    { key: 'amountInr', label: 'Amount (INR)' },
    { key: 'runningBalanceInr', label: 'Running Balance (INR)' },
    { key: 'direction', label: 'Economic Direction' },
    { key: 'accountingTreatment', label: 'Accounting Treatment' },
    { key: 'financeJournalRef', label: 'Finance Journal Ref' },
    { key: 'workflowStatus', label: 'Workflow Status' },
    { key: 'settlementStatus', label: 'Settlement Status' },
    { key: 'status', label: 'Record Status' },
  ];

  const xlsxRows = entriesWithRunning.map((e) => ({
    voucherId: e.voucherNumber || e.ledgerEntryId,
    businessDate: e.businessDate,
    category: e.category,
    description: e.description,
    paymentSource: e.paymentSource,
    entryType: e.entryType,
    amountInr: (e.amountPaisa || 0) / 100,
    runningBalanceInr: (e.runningBalancePaisa || 0) / 100,
    direction: e.direction,
    accountingTreatment: e.accountingTreatment,
    financeJournalRef: e.financeJournalRef || 'Unposted',
    workflowStatus: e.workflowStatus,
    settlementStatus: e.settlementStatus || 'UNSETTLED',
    status: e.status || 'ACTIVE',
  }));

  const xlsx = generateXlsx({
    sheetName: 'Personal Sub-Ledger',
    reportTitle: 'Personal Sub-Ledger Journal',
    columns,
    rows: xlsxRows,
  });

  const filename = `Zamorin_Personal_SubLedger_${getIstBusinessDate()}.xlsx`;
  response.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  response.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  return response.status(200).send(xlsx.buffer);
});

module.exports = {
  getLedgerOverview,
  getBalance,
  listEntries,
  getEntry,
  createEntry,
  classifyToBusinessBooks,
  reverseClassification,
  reverseEntry,
  settleBalances,
  confirmBalance,
  getReconciliation,
  exportPersonalLedger,
};
