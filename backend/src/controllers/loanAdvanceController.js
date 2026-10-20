'use strict';

/**
 * LOANS & SALARY ADVANCES CONTROLLER — SCR-014
 *
 * Provides:
 * 1. Authenticated Employee Self-Service (My Loans, My Salary Advances, Schedules, Requests, Settlements)
 * 2. Primary MASTER Organisation-Wide Loan Governance (Approvals, Disbursements, Ledger Postings, Integrity)
 * 3. Complete Privacy Firewall against Normal MASTER access.
 */

const {
  StaffLoanAdvance,
  LOAN_ADVANCE_STATUSES,
} = require('../models/StaffLoanAdvance');
const { LoanTransaction } = require('../models/LoanTransaction');
const { LoanRepaymentSchedule } = require('../models/LoanRepaymentSchedule');
const { LoanPolicy } = require('../models/LoanPolicy');
const { LoanAdvanceService } = require('../services/loanAdvanceService');
const { asyncHandler } = require('../utils/asyncHandler');
const { ApiError } = require('../utils/ApiError');

function assertNotNormalMaster(request) {
  const { role, isPrimaryMaster } = request.auth;
  if (role === 'MASTER' && !isPrimaryMaster) {
    throw new ApiError(403, 'PRIVACY_FIREWALL_NORMAL_MASTER_DENIED', 'Normal Master is restricted from employee loan records.');
  }
}

function requirePrimaryMaster(request) {
  const { role, isPrimaryMaster } = request.auth;
  if (role !== 'MASTER' || !isPrimaryMaster) {
    throw new ApiError(403, 'PRIMARY_MASTER_REQUIRED', 'This administrative action requires Primary MASTER governance.');
  }
}

// ── 1. Self-Service Endpoints ────────────────────────────────────────────────

const listMyLoanAdvances = asyncHandler(async (request, response) => {
  assertNotNormalMaster(request);
  const { organisationId, userId } = request.auth;
  const { type, status, limit = 50, page = 1 } = request.query;

  const filter = { organisationId, employeeUserId: userId };
  if (type && type !== 'ALL') filter.requestType = type;
  if (status && status !== 'ALL') {
    if (!LOAN_ADVANCE_STATUSES.includes(status)) {
      throw new ApiError(400, 'INVALID_LOAN_ADVANCE_STATUS', `Invalid loan advance status: ${status}`);
    }
    filter.status = status;
  }

  const skip = (Math.max(1, parseInt(page, 10)) - 1) * parseInt(limit, 10);
  const rawLoans = await StaffLoanAdvance.find(filter)
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(parseInt(limit, 10));

  const loans = Array.isArray(rawLoans) ? rawLoans : [];
  const total = await StaffLoanAdvance.countDocuments(filter);

  // Calculate summary KPIs for authenticated employee
  const allUserLoans = await StaffLoanAdvance.find({ organisationId, employeeUserId: userId });
  const userLoansList = Array.isArray(allUserLoans) ? allUserLoans : [];

  const activeLoans = userLoansList.filter((l) => ['ACTIVE', 'DISBURSED', 'IN_ARREARS', 'PAUSED'].includes(l.status));
  const totalOutstandingPaise = activeLoans.reduce((sum, l) => sum + (l.outstandingPrincipalPaise || 0) + (l.arrearsPaise || 0), 0);
  const nextPayrollDeductionPaise = activeLoans.reduce((sum, l) => sum + (l.monthlyInstalmentPaise || 0), 0);
  const totalRepaidPaise = userLoansList.reduce((sum, l) => sum + (l.totalRepaidPaise || 0), 0);
  const activeAdvances = activeLoans.filter((l) => l.requestType === 'SALARY_ADVANCE');

  return response.status(200).json({
    success: true,
    data: {
      loanAdvances: loans.map((l) => ({
        id: l.loanAdvanceId,
        loanAdvanceId: l.loanAdvanceId,
        requestType: l.requestType,
        loanCategory: l.loanCategory,
        requestedAmountPaise: l.requestedAmountPaise,
        requestedAmountRupees: Number((l.requestedAmountPaise / 100).toFixed(2)),
        principalPaise: l.principalPaise || l.requestedAmountPaise,
        outstandingPrincipalPaise: l.outstandingPrincipalPaise,
        outstandingPrincipalRupees: Number((l.outstandingPrincipalPaise / 100).toFixed(2)),
        arrearsPaise: l.arrearsPaise,
        arrearsRupees: Number((l.arrearsPaise / 100).toFixed(2)),
        monthlyInstalmentPaise: l.monthlyInstalmentPaise,
        monthlyInstalmentRupees: Number((l.monthlyInstalmentPaise / 100).toFixed(2)),
        tenureMonths: l.tenureMonths,
        status: l.status,
        requestedAt: l.requestedAt,
        requestReason: l.requestReason,
        currency: 'INR',
      })),
      kpis: {
        activeLoansCount: activeLoans.length,
        totalOutstandingPaise,
        totalOutstandingRupees: Number((totalOutstandingPaise / 100).toFixed(2)),
        nextPayrollDeductionPaise,
        nextPayrollDeductionRupees: Number((nextPayrollDeductionPaise / 100).toFixed(2)),
        nextDeductionDate: '31 Aug 2026',
        totalRepaidPaise,
        totalRepaidRupees: Number((totalRepaidPaise / 100).toFixed(2)),
        activeAdvancesCount: activeAdvances.length,
      },
      pagination: {
        total,
        page: parseInt(page, 10),
        limit: parseInt(limit, 10),
      },
    },
  });
});

const getMyLoanAdvance = asyncHandler(async (request, response) => {
  assertNotNormalMaster(request);
  const { organisationId, userId } = request.auth;
  const { loanAdvanceId } = request.params;

  const rawLoan = await StaffLoanAdvance.findOne({ organisationId, loanAdvanceId, employeeUserId: userId });
  const loan = rawLoan?.toObject ? rawLoan.toObject() : rawLoan;
  if (!loan) {
    throw new ApiError(404, 'LOAN_ADVANCE_NOT_FOUND', `Loan record ${loanAdvanceId} not found.`);
  }

  const rawSchedules = await LoanRepaymentSchedule.find({ organisationId, loanAdvanceId }).sort({ instalmentNumber: 1 });
  const schedules = Array.isArray(rawSchedules) ? rawSchedules : [];

  const rawTxns = await LoanTransaction.find({ organisationId, loanAdvanceId }).sort({ postedAt: -1 });
  const transactions = Array.isArray(rawTxns) ? rawTxns : [];

  return response.status(200).json({
    success: true,
    data: {
      loan: {
        ...loan,
        requestedAmountRupees: Number((loan.requestedAmountPaise / 100).toFixed(2)),
        outstandingPrincipalRupees: Number((loan.outstandingPrincipalPaise / 100).toFixed(2)),
        arrearsRupees: Number((loan.arrearsPaise / 100).toFixed(2)),
        monthlyInstalmentRupees: Number((loan.monthlyInstalmentPaise / 100).toFixed(2)),
      },
      schedules,
      transactions,
    },
  });
});

const requestLoan = asyncHandler(async (request, response) => {
  assertNotNormalMaster(request);
  const { organisationId, userId, fullName, assignedCafeIds } = request.auth;
  const { requestedAmountPaise, requestedAmount, loanCategory = 'WELFARE', tenureMonths = 12, reason = '' } = request.body;

  const amountPaise = requestedAmountPaise !== undefined ? parseInt(requestedAmountPaise, 10) : Math.round(Number(requestedAmount) * 100);
  if (!amountPaise || amountPaise <= 0) {
    throw new ApiError(400, 'VALIDATION_FAILED', 'Requested amount must be greater than 0.');
  }

  const count = await StaffLoanAdvance.countDocuments({ organisationId });
  const loanAdvanceId = `LN-2026-${String(count + 1).padStart(4, '0')}`;
  const cafeId = assignedCafeIds?.[0] || request.auth.primaryCafeId;
  if (!cafeId) {
    throw new ApiError(400, 'CAFE_ID_REQUIRED', 'A café assignment is required for a loan or advance request.');
  }

  const monthlyInstalmentPaise = Math.floor(amountPaise / Math.max(1, parseInt(tenureMonths, 10)));

  const loan = await StaffLoanAdvance.create({
    loanAdvanceId,
    organisationId,
    cafeId,
    employeeUserId: userId,
    employeeName: fullName || userId,
    requestType: 'LOAN',
    loanCategory,
    requestedAmountPaise: amountPaise,
    principalPaise: amountPaise,
    outstandingPrincipalPaise: amountPaise,
    monthlyInstalmentPaise,
    tenureMonths: parseInt(tenureMonths, 10),
    requestReason: reason,
    status: 'SUBMITTED',
    policyVersion: 'POL-LOAN-2026-V1',
    deductionReference: `DED-${loanAdvanceId}`,
    requestedAt: new Date(),
    createdByUserId: userId,
  });

  return response.status(201).json({
    success: true,
    message: 'Loan application submitted successfully.',
    data: { loan },
  });
});

const requestSalaryAdvance = asyncHandler(async (request, response) => {
  assertNotNormalMaster(request);
  const { organisationId, userId, fullName, assignedCafeIds } = request.auth;
  const { requestedAmountPaise, requestedAmount, reason = '' } = request.body;

  const amountPaise = requestedAmountPaise !== undefined ? parseInt(requestedAmountPaise, 10) : Math.round(Number(requestedAmount) * 100);
  if (!amountPaise || amountPaise <= 0) {
    throw new ApiError(400, 'VALIDATION_FAILED', 'Requested advance amount must be greater than 0.');
  }

  const count = await StaffLoanAdvance.countDocuments({ organisationId });
  const loanAdvanceId = `ADV-2026-${String(count + 1).padStart(4, '0')}`;
  const cafeId = assignedCafeIds?.[0] || request.auth.primaryCafeId;
  if (!cafeId) {
    throw new ApiError(400, 'CAFE_ID_REQUIRED', 'A café assignment is required for a loan or advance request.');
  }

  const advance = await StaffLoanAdvance.create({
    loanAdvanceId,
    organisationId,
    cafeId,
    employeeUserId: userId,
    employeeName: fullName || userId,
    requestType: 'SALARY_ADVANCE',
    loanCategory: 'SALARY_ADVANCE',
    requestedAmountPaise: amountPaise,
    principalPaise: amountPaise,
    outstandingPrincipalPaise: amountPaise,
    monthlyInstalmentPaise: amountPaise,
    tenureMonths: 1,
    requestReason: reason,
    status: 'SUBMITTED',
    policyVersion: 'POL-ADV-2026-V1',
    deductionReference: `DED-${loanAdvanceId}`,
    requestedAt: new Date(),
    createdByUserId: userId,
  });

  return response.status(201).json({
    success: true,
    message: 'Salary advance request submitted successfully.',
    data: { advance },
  });
});

const withdrawMyRequest = asyncHandler(async (request, response) => {
  assertNotNormalMaster(request);
  const { organisationId, userId } = request.auth;
  const { loanAdvanceId } = request.params;

  const loan = await StaffLoanAdvance.findOne({ organisationId, loanAdvanceId, employeeUserId: userId });
  if (!loan) throw new ApiError(404, 'LOAN_NOT_FOUND', `Request ${loanAdvanceId} not found.`);

  if (!['SUBMITTED', 'UNDER_REVIEW', 'MORE_INFO_REQUIRED'].includes(loan.status)) {
    throw new ApiError(400, 'CANNOT_WITHDRAW', `Cannot withdraw request in status ${loan.status}.`);
  }

  loan.status = 'WITHDRAWN';
  loan.updatedByUserId = userId;
  await loan.save();

  return response.status(200).json({ success: true, message: 'Request withdrawn successfully.' });
});

const reportManualRepayment = asyncHandler(async (request, response) => {
  assertNotNormalMaster(request);
  const { organisationId, userId } = request.auth;
  const { loanAdvanceId } = request.params;
  const { amountPaise, amount, paymentReference = '', notes = '' } = request.body;

  const paidPaise = amountPaise !== undefined ? parseInt(amountPaise, 10) : Math.round(Number(amount) * 100);
  if (!paidPaise || paidPaise <= 0) throw new ApiError(400, 'VALIDATION_FAILED', 'Payment amount must be greater than 0.');

  const loan = await StaffLoanAdvance.findOne({ organisationId, loanAdvanceId, employeeUserId: userId });
  if (!loan) throw new ApiError(404, 'LOAN_NOT_FOUND', `Loan ${loanAdvanceId} not found.`);

  const count = await LoanTransaction.countDocuments({ organisationId });
  const transactionId = `TXN-LN-${String(count + 1).padStart(4, '0')}`;

  const txn = await LoanTransaction.create({
    transactionId,
    organisationId,
    loanAdvanceId,
    employeeUserId: userId,
    transactionType: 'MANUAL_REPAYMENT',
    amountPaise: paidPaise,
    principalDeltaPaise: -paidPaise,
    balanceAfterPaise: loan.outstandingPrincipalPaise + loan.arrearsPaise,
    paymentReference,
    notes,
    status: 'AWAITING_VERIFICATION',
    performedByUserId: userId,
    postedAt: new Date(),
  });

  return response.status(201).json({
    success: true,
    message: 'Manual repayment reported. Pending Primary Master verification.',
    data: { transaction: txn },
  });
});

const requestRepaymentPause = asyncHandler(async (request, response) => {
  assertNotNormalMaster(request);
  const { organisationId, userId } = request.auth;
  const { loanAdvanceId } = request.params;
  const { fromPeriod, resumePeriod, reason = '' } = request.body;

  const loan = await StaffLoanAdvance.findOne({ organisationId, loanAdvanceId, employeeUserId: userId });
  if (!loan) throw new ApiError(404, 'LOAN_NOT_FOUND', `Loan ${loanAdvanceId} not found.`);

  loan.pauseDetails = {
    isPaused: false,
    pauseFromPeriod: fromPeriod,
    resumePeriod,
    pauseReason: reason,
  };
  loan.updatedByUserId = userId;
  await loan.save();

  return response.status(200).json({
    success: true,
    message: 'Repayment pause requested. Awaiting administrative approval.',
  });
});

const getMySettlementQuote = asyncHandler(async (request, response) => {
  assertNotNormalMaster(request);
  const { organisationId, userId } = request.auth;
  const { loanAdvanceId } = request.params;

  const loan = await StaffLoanAdvance.findOne({ organisationId, loanAdvanceId, employeeUserId: userId });
  if (!loan) throw new ApiError(404, 'LOAN_NOT_FOUND', `Loan ${loanAdvanceId} not found.`);

  const quote = await LoanAdvanceService.generateSettlementQuote({ organisationId, loanAdvanceId });
  return response.status(200).json({ success: true, data: quote });
});

const requestEarlySettlement = asyncHandler(async (request, response) => {
  assertNotNormalMaster(request);
  const { organisationId, userId } = request.auth;
  const { loanAdvanceId } = request.params;
  const { paymentReference = '', notes = '', paymentMode = 'BANK_TRANSFER' } = request.body || {};

  const loan = await StaffLoanAdvance.findOne({ organisationId, loanAdvanceId, employeeUserId: userId });
  if (!loan) throw new ApiError(404, 'LOAN_NOT_FOUND', `Loan ${loanAdvanceId} not found.`);

  if (loan.status !== 'ACTIVE' && loan.status !== 'IN_REPAYMENT') {
    throw new ApiError(400, 'INVALID_STATUS_FOR_SETTLEMENT', `Only active or in-repayment loans can be settled early. Current status: ${loan.status}`);
  }

  const quote = await LoanAdvanceService.generateSettlementQuote({ organisationId, loanAdvanceId });
  const settlementAmountPaise = quote.settlementAmountPaise || ((loan.outstandingPrincipalPaise || 0) + (loan.arrearsPaise || 0));

  loan.settlementDetails = {
    isSettled: false,
    settlementRequested: true,
    settlementRequestedAt: new Date(),
    settlementQuotePaise: settlementAmountPaise,
    paymentRef: paymentReference,
    paymentMode,
    notes,
  };
  loan.updatedByUserId = userId;
  await loan.save();

  if (paymentReference) {
    const count = await LoanTransaction.countDocuments({ organisationId });
    const transactionId = `TXN-LN-${String(count + 1).padStart(4, '0')}`;
    await LoanTransaction.create({
      transactionId,
      organisationId,
      loanAdvanceId,
      employeeUserId: userId,
      transactionType: 'SETTLEMENT',
      amountPaise: settlementAmountPaise,
      principalDeltaPaise: -settlementAmountPaise,
      balanceAfterPaise: 0,
      paymentReference,
      notes: notes || 'Employee early settlement request pending verification',
      status: 'AWAITING_VERIFICATION',
      performedByUserId: userId,
      postedAt: new Date(),
    });
  }

  return response.status(200).json({
    success: true,
    message: 'Early settlement request submitted successfully. Pending Primary Master verification.',
    data: {
      loanAdvanceId,
      settlementAmountPaise,
      settlementQuote: quote,
    },
    correlationId: request.correlationId || null,
  });
});

// ── 2. Primary Master Administrative Endpoints ───────────────────────────────

const listOrgLoans = asyncHandler(async (request, response) => {
  requirePrimaryMaster(request);
  const { organisationId } = request.auth;
  const { status, type, cafeId, search } = request.query;

  const filter = { organisationId };
  if (status && status !== 'ALL') filter.status = status;
  if (type && type !== 'ALL') filter.requestType = type;
  if (cafeId && cafeId !== 'ALL') filter.cafeId = cafeId;

  if (search && search.trim()) {
    const q = search.trim();
    filter.$or = [
      { loanAdvanceId: { $regex: q, $options: 'i' } },
      { employeeUserId: { $regex: q, $options: 'i' } },
      { employeeName: { $regex: q, $options: 'i' } },
    ];
  }

  const rawLoans = await StaffLoanAdvance.find(filter).sort({ createdAt: -1 });
  const loans = Array.isArray(rawLoans) ? rawLoans : [];

  return response.status(200).json({ success: true, data: { loans } });
});

const approveLoan = asyncHandler(async (request, response) => {
  requirePrimaryMaster(request);
  const { organisationId, userId } = request.auth;
  const { loanAdvanceId } = request.params;
  const { approvedAmountPaise, tenureMonths } = request.body;

  const loan = await StaffLoanAdvance.findOne({ organisationId, loanAdvanceId });
  if (!loan) throw new ApiError(404, 'LOAN_NOT_FOUND', `Loan ${loanAdvanceId} not found.`);

  const approvedPaise = approvedAmountPaise !== undefined ? parseInt(approvedAmountPaise, 10) : loan.requestedAmountPaise;
  const tenure = tenureMonths !== undefined ? parseInt(tenureMonths, 10) : loan.tenureMonths;

  loan.approvedAmountPaise = approvedPaise;
  loan.principalPaise = approvedPaise;
  loan.outstandingPrincipalPaise = approvedPaise;
  loan.tenureMonths = tenure;
  loan.monthlyInstalmentPaise = Math.floor(approvedPaise / Math.max(1, tenure));
  loan.status = 'DISBURSEMENT_PENDING';
  loan.approvedAt = new Date();
  loan.approvedByUserId = userId;
  await loan.save();

  return response.status(200).json({ success: true, message: 'Loan approved for disbursement.', data: { loan } });
});

const disburseLoan = asyncHandler(async (request, response) => {
  requirePrimaryMaster(request);
  const { organisationId, userId } = request.auth;
  const { loanAdvanceId } = request.params;
  const { paymentMethod = 'BANK_TRANSFER', bankTransactionRef = `TXN-${Date.now()}` } = request.body;

  const loan = await StaffLoanAdvance.findOne({ organisationId, loanAdvanceId });
  if (!loan) throw new ApiError(404, 'LOAN_NOT_FOUND', `Loan ${loanAdvanceId} not found.`);

  loan.disbursedAmountPaise = loan.approvedAmountPaise || loan.principalPaise;
  loan.status = 'ACTIVE';
  loan.disbursedAt = new Date();
  loan.disbursedByUserId = userId;
  loan.disbursementDetails = { paymentMethod, bankTransactionRef, disbursementAccountRef: 'HDFC-SALARY-DISBURSE' };
  await loan.save();

  // Create initial ledger posting
  const count = await LoanTransaction.countDocuments({ organisationId });
  const transactionId = `TXN-LN-${String(count + 1).padStart(4, '0')}`;

  await LoanTransaction.create({
    transactionId,
    organisationId,
    loanAdvanceId,
    employeeUserId: loan.employeeUserId,
    transactionType: 'DISBURSEMENT',
    amountPaise: loan.disbursedAmountPaise,
    principalDeltaPaise: loan.disbursedAmountPaise,
    balanceAfterPaise: loan.disbursedAmountPaise,
    paymentReference: bankTransactionRef,
    notes: `Initial principal disbursement via ${paymentMethod}`,
    status: 'POSTED',
    performedByUserId: userId,
    postedAt: new Date(),
  });

  // Generate initial schedule
  const schedules = LoanAdvanceService.generateAmortizationSchedule({
    principalPaise: loan.disbursedAmountPaise,
    tenureMonths: loan.tenureMonths,
    interestMethod: loan.interestMethod,
    annualInterestRatePercent: loan.annualInterestRatePercent,
  });

  for (const s of schedules) {
    await LoanRepaymentSchedule.create({ ...s, organisationId, loanAdvanceId });
  }

  return response.status(200).json({ success: true, message: 'Loan disbursed and active.', data: { loan } });
});

const verifyManualRepayment = asyncHandler(async (request, response) => {
  requirePrimaryMaster(request);
  const { organisationId, userId } = request.auth;
  const { transactionId } = request.params;
  const { isApproved = true } = request.body;

  const txn = await LoanTransaction.findOne({ organisationId, transactionId });
  if (!txn) throw new ApiError(404, 'TRANSACTION_NOT_FOUND', `Transaction ${transactionId} not found.`);

  if (isApproved) {
    txn.status = 'POSTED';
    txn.verifiedByUserId = userId;
    await txn.save();

    const loan = await StaffLoanAdvance.findOne({ organisationId, loanAdvanceId: txn.loanAdvanceId });
    if (loan) {
      loan.outstandingPrincipalPaise = Math.max(0, loan.outstandingPrincipalPaise - txn.amountPaise);
      loan.totalRepaidPaise = (loan.totalRepaidPaise || 0) + txn.amountPaise;
      if (loan.outstandingPrincipalPaise === 0 && (loan.arrearsPaise || 0) === 0) {
        loan.status = 'REPAID';
      }
      await loan.save();
    }
  } else {
    txn.status = 'REVERSED';
    txn.verifiedByUserId = userId;
    await txn.save();
  }

  return response.status(200).json({ success: true, message: 'Manual repayment verified.', data: { transaction: txn } });
});

const postLoanSettlement = asyncHandler(async (request, response) => {
  requirePrimaryMaster(request);
  const { organisationId, userId } = request.auth;
  const { loanAdvanceId } = request.params;
  const { paymentRef = `SETTLE-${Date.now()}` } = request.body;

  const loan = await StaffLoanAdvance.findOne({ organisationId, loanAdvanceId });
  if (!loan) throw new ApiError(404, 'LOAN_NOT_FOUND', `Loan ${loanAdvanceId} not found.`);

  const remaining = (loan.outstandingPrincipalPaise || 0) + (loan.arrearsPaise || 0);

  const count = await LoanTransaction.countDocuments({ organisationId });
  const transactionId = `TXN-LN-${String(count + 1).padStart(4, '0')}`;

  await LoanTransaction.create({
    transactionId,
    organisationId,
    loanAdvanceId,
    employeeUserId: loan.employeeUserId,
    transactionType: 'SETTLEMENT',
    amountPaise: remaining,
    principalDeltaPaise: -remaining,
    balanceAfterPaise: 0,
    paymentReference: paymentRef,
    notes: 'Full settlement closure payment verified',
    status: 'POSTED',
    performedByUserId: userId,
    postedAt: new Date(),
  });

  loan.outstandingPrincipalPaise = 0;
  loan.arrearsPaise = 0;
  loan.totalRepaidPaise = (loan.totalRepaidPaise || 0) + remaining;
  loan.status = 'CLOSED';
  loan.closedAt = new Date();
  loan.settlementDetails = {
    isSettled: true,
    settledAmountPaise: remaining,
    settledAt: new Date(),
    paymentRef,
    noDueCertificateGenerated: true,
  };
  await loan.save();

  return response.status(200).json({ success: true, message: 'Loan settled and closed with No-Due certificate.', data: { loan } });
});

const decideRepaymentPause = asyncHandler(async (request, response) => {
  assertNotNormalMaster(request);
  const { organisationId, userId } = request.auth;
  const { loanAdvanceId } = request.params;
  const { decision, decisionNotes = '' } = request.body || {};

  const targetDecision = String(decision || '').toUpperCase().trim();
  if (!['APPROVE', 'REJECT'].includes(targetDecision)) {
    throw new ApiError(400, 'INVALID_DECISION', 'Decision must be APPROVE or REJECT.');
  }

  const loan = await StaffLoanAdvance.findOne({ organisationId, loanAdvanceId });
  if (!loan) throw new ApiError(404, 'LOAN_NOT_FOUND', `Loan ${loanAdvanceId} not found.`);

  if (!loan.pauseDetails || !loan.pauseDetails.pauseFromPeriod) {
    throw new ApiError(400, 'NO_PAUSE_REQUESTED', `No pending repayment pause request on loan ${loanAdvanceId}.`);
  }

  // Idempotency check: if decision already recorded
  if (loan.pauseDetails.approvedAt || loan.pauseDetails.rejectedAt) {
    return response.status(409).json({
      success: false,
      message: 'Repayment pause request has already been decided.',
      data: { loan },
    });
  }

  if (targetDecision === 'APPROVE') {
    loan.pauseDetails.isPaused = true;
    loan.pauseDetails.approvedByUserId = userId;
    loan.pauseDetails.approvedAt = new Date();
    loan.pauseDetails.notes = decisionNotes;
  } else {
    loan.pauseDetails.isPaused = false;
    loan.pauseDetails.rejectedAt = new Date();
    loan.pauseDetails.rejectionReason = decisionNotes;
  }
  loan.updatedByUserId = userId;
  await loan.save();

  // Dispatch canonical Notification and NotificationOutbox
  try {
    const { Notification } = require('../models/Notification');
    const { NotificationOutbox } = require('../models/NotificationOutbox');
    const { User } = require('../models/User');

    const eventType = targetDecision === 'APPROVE' ? 'LOAN_DEFERMENT_APPROVED' : 'LOAN_DEFERMENT_REJECTED';
    let recipientEmail = `${String(loan.employeeUserId).toLowerCase()}@zamorincafe.com`;
    let recipientName = loan.employeeName || loan.employeeUserId;
    try {
      const u = await User.findOne({ organisationId, userId: loan.employeeUserId }).select('email name').lean();
      if (u?.email) recipientEmail = u.email;
      if (u?.name) recipientName = u.name;
    } catch (_) {}

    const deduplicationKey = `LOAN_DEFER:${loanAdvanceId}:${targetDecision}`;
    const existingNotif = await Notification.findOne({ organisationId, deduplicationKey }).lean();

    if (!existingNotif) {
      const outboxId = `OUT-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;
      await NotificationOutbox.create({
        outboxId,
        organisationId,
        eventType,
        recipientUserId: loan.employeeUserId,
        recipientEmail,
        recipientName,
        recipientRole: 'STAFF',
        templateId: 'LOAN_DEFERMENT_STATUS_UPDATE',
        subject: `Repayment Deferment ${targetDecision === 'APPROVE' ? 'Approved' : 'Rejected'} (${loanAdvanceId})`,
        renderedSubject: `Repayment Deferment ${targetDecision === 'APPROVE' ? 'Approved' : 'Rejected'} (${loanAdvanceId})`,
        renderedBody: `Your request to pause loan repayment from ${loan.pauseDetails.pauseFromPeriod} has been ${targetDecision === 'APPROVE' ? 'approved' : 'rejected'}.${decisionNotes ? ' Notes: ' + decisionNotes : ''}`,
        status: 'SENT',
        sentAt: new Date(),
      });

      const todayStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      const notifId = `NT-${todayStr}-${Math.floor(1000 + Math.random() * 9000)}`;
      await Notification.create({
        notificationId: notifId,
        organisationId,
        eventType,
        category: 'FINANCE',
        recipientUserId: loan.employeeUserId,
        recipientRole: 'STAFF',
        recipientEmail,
        title: `Loan Deferment ${targetDecision === 'APPROVE' ? 'Approved' : 'Rejected'}`,
        message: `Your repayment deferment request for ${loanAdvanceId} has been ${targetDecision.toLowerCase()}d.`,
        priority: 'NORMAL',
        channels: ['IN_APP'],
        deepLink: '#staff-loans-advances',
        sourceModule: 'LOANS_ADVANCES',
        sourceEntityType: 'StaffLoanAdvance',
        sourceEntityId: loanAdvanceId,
        deduplicationKey,
        correlationId: request.correlationId || outboxId,
        createdBy: userId,
      });
    }
  } catch (notifErr) {
    // Non-blocking notification dispatch
  }

  return response.status(200).json({
    success: true,
    message: `Repayment pause request ${targetDecision === 'APPROVE' ? 'approved' : 'rejected'} successfully.`,
    data: { loan },
  });
});

const getLoanIntegrityAudit = asyncHandler(async (request, response) => {
  requirePrimaryMaster(request);
  const { organisationId } = request.auth;
  const audit = await LoanAdvanceService.runLoanIntegrityAudit(organisationId);
  return response.status(200).json({ success: true, data: audit });
});

module.exports = {
  listMyLoanAdvances,
  getMyLoanAdvance,
  requestLoan,
  requestSalaryAdvance,
  withdrawMyRequest,
  reportManualRepayment,
  requestRepaymentPause,
  decideRepaymentPause,
  getMySettlementQuote,
  requestEarlySettlement,
  listOrgLoans,
  approveLoan,
  disburseLoan,
  verifyManualRepayment,
  postLoanSettlement,
  getLoanIntegrityAudit,
};
