'use strict';

/**
 * REVENUE SHARE & LEASED OUTLETS CONTROLLER (SCR-026)
 * Server-authoritative business logic for leased outlets, agreements, rate rules,
 * sales submissions, settlement simulations, MASTER approvals, and Finance integration.
 */

const { LeasedOutlet } = require('../models/LeasedOutlet');
const { RevenueShareOperator } = require('../models/RevenueShareOperator');
const { RevenueShareAgreement } = require('../models/RevenueShareAgreement');
const { RevenueShareRateRule } = require('../models/RevenueShareRateRule');
const { SalesSubmission } = require('../models/SalesSubmission');
const { RevenueShareSettlement } = require('../models/RevenueShareSettlement');
const { RevenueSharePayment } = require('../models/RevenueSharePayment');
const { RecoveryCharge } = require('../models/RecoveryCharge');
const { SecurityDeposit } = require('../models/SecurityDeposit');
const { RevenueShareDispute } = require('../models/RevenueShareDispute');
const { APInvoice } = require('../models/APInvoice');
const {
  computeEligibleRevenue,
  computeBaseShare,
  computeSettlementTotal,
} = require('../services/revenueShareCalculationService');
const { asyncHandler } = require('../utils/asyncHandler');
const { ApiError } = require('../utils/ApiError');

function getOwnerAuthorizedCafes(request) {
  const { role, assignedCafeIds, cafeId } = request.auth;
  if (role === 'MASTER') return null;
  const rawCafes = (assignedCafeIds && assignedCafeIds.length > 0)
    ? assignedCafeIds
    : (cafeId ? [cafeId] : (Array.isArray(assignedCafeIds) && assignedCafeIds.length === 0 ? [] : null));
  if (Array.isArray(rawCafes) && rawCafes.length === 0) {
    throw new ApiError(403, 'CROSS_CAFE_RESOURCE_DENIED', 'Owner has no authorized café assignments.');
  }
  if (!rawCafes) return null;
  return rawCafes.map((c) => String(c).trim().toUpperCase());
}

// ── 1. Overview Dashboard KPIs ──────────────────────────────────────────────

const getOverview = asyncHandler(async (request, response) => {
  const { organisationId } = request.auth;
  const authorizedCafes = getOwnerAuthorizedCafes(request);
  const outletFilter = { organisationId };
  const agreementFilter = { organisationId };
  const settlementFilter = { organisationId };
  const submissionFilter = { organisationId };

  if (authorizedCafes) {
    outletFilter.cafeId = { $in: authorizedCafes };
    agreementFilter.cafeId = { $in: authorizedCafes };
    settlementFilter.cafeId = { $in: authorizedCafes };
    submissionFilter.cafeId = { $in: authorizedCafes };
  }

  const [outlets, operators, agreements, settlements, submissions, payments, deposits] =
    await Promise.all([
      LeasedOutlet.find(outletFilter).lean(),
      RevenueShareOperator.find({ organisationId }).lean(),
      RevenueShareAgreement.find(agreementFilter).lean(),
      RevenueShareSettlement.find(settlementFilter).lean(),
      SalesSubmission.find(submissionFilter).lean(),
      RevenueSharePayment.find({ organisationId }).lean(),
      SecurityDeposit.find({ organisationId }).lean(),
    ]);

  const activeOutletsCount = outlets.filter((o) => o.status === 'OCCUPIED' || o.status === 'AVAILABLE').length;
  const activeAgreementsCount = agreements.filter((a) => a.status === 'ACTIVE').length;

  const totalGrossSalesPaisa = submissions.reduce((sum, s) => sum + (s.grossSalesPaisa || 0), 0);
  const totalRevenueShareEarnedPaisa = settlements.reduce((sum, s) => sum + (s.netPayablePaisa || 0), 0);
  const totalPaidPaisa = payments
    .filter((p) => p.status === 'VERIFIED' || p.status === 'ALLOCATED')
    .reduce((sum, p) => sum + (p.amountPaisa || 0), 0);
  const totalOutstandingPaisa = Math.max(0, totalRevenueShareEarnedPaisa - totalPaidPaisa);

  const missingSalesCount = submissions.filter((s) => s.status === 'SUBMITTED' || s.status === 'VALIDATION_REQUIRED').length;
  const pendingApprovalsCount = settlements.filter((s) => s.status === 'CALCULATED' || s.status === 'APPROVAL_PENDING').length;
  const openDisputesCount = settlements.filter((s) => s.status === 'REVIEW_REQUIRED').length;

  return response.status(200).json({
    success: true,
    data: {
      metrics: {
        activeOutletsCount,
        activeAgreementsCount,
        totalOperatorsCount: operators.length,
        totalGrossSalesPaisa,
        totalRevenueShareEarnedPaisa,
        totalPaidPaisa,
        totalOutstandingPaisa,
        missingSalesCount,
        pendingApprovalsCount,
        openDisputesCount,
        collectionRatePercent: totalRevenueShareEarnedPaisa > 0 ? Math.round((totalPaidPaisa / totalRevenueShareEarnedPaisa) * 100) : 100,
        securityDepositsHeldPaisa: deposits.reduce((sum, d) => sum + (d.heldBalancePaisa || 0), 0),
      },
      recentSettlements: settlements.slice(-5).reverse(),
      recentSubmissions: submissions.slice(-5).reverse(),
    },
  });
});

// ── 2. Leased Outlets ───────────────────────────────────────────────────────

const listOutlets = asyncHandler(async (request, response) => {
  const { organisationId } = request.auth;
  const authorizedCafes = getOwnerAuthorizedCafes(request);
  const filter = { organisationId };
  if (authorizedCafes) {
    filter.cafeId = { $in: authorizedCafes };
  }
  if (request.query.cafeId && request.query.cafeId !== 'ALL') {
    const requestedCafe = String(request.query.cafeId).trim().toUpperCase();
    if (authorizedCafes && !authorizedCafes.includes(requestedCafe)) {
      throw new ApiError(403, 'CROSS_CAFE_RESOURCE_DENIED', 'You do not have access to this café.');
    }
    filter.cafeId = requestedCafe;
  }
  const outlets = await LeasedOutlet.find(filter).sort({ outletId: 1 }).lean();
  return response.status(200).json({ success: true, data: { outlets } });
});

const createOutlet = asyncHandler(async (request, response) => {
  const { organisationId, userId } = request.auth;
  const { cafeId, name, spaceType, zoneFloor, stallNumber, areaSqFt, permittedCategory, notes } = request.body;

  if (!name || !cafeId) {
    throw new ApiError(400, 'MISSING_REQUIRED_FIELDS', 'Name and cafeId are required to create a leased outlet space.');
  }

  const authorizedCafes = getOwnerAuthorizedCafes(request);
  const cleanCafe = cafeId.trim().toUpperCase();
  if (authorizedCafes && !authorizedCafes.includes(cleanCafe)) {
    throw new ApiError(403, 'CROSS_CAFE_RESOURCE_DENIED', 'You do not have access to this café.');
  }

  const outletCount = await LeasedOutlet.countDocuments({ organisationId });
  const outletId = `LO-${String(outletCount + 1).padStart(4, '0')}`;

  const outlet = await LeasedOutlet.create({
    outletId,
    organisationId,
    cafeId: cleanCafe,
    name: name.trim(),
    spaceType: spaceType || 'COUNTER',
    zoneFloor: zoneFloor || 'Ground Floor',
    stallNumber: stallNumber || '',
    areaSqFt: areaSqFt || 0,
    permittedCategory: permittedCategory || 'Food & Beverage',
    status: 'AVAILABLE',
    notes: notes || '',
    createdByUserId: userId,
  });

  return response.status(201).json({
    success: true,
    message: 'Leased commercial space registered successfully.',
    data: { outlet },
  });
});

const getOutletById = asyncHandler(async (request, response) => {
  const { organisationId } = request.auth;
  const { id } = request.params;

  const outlet = await LeasedOutlet.findOne({ organisationId, outletId: id.toUpperCase() }).lean();
  if (!outlet) {
    throw new ApiError(404, 'OUTLET_NOT_FOUND', `Leased outlet ${id} was not found.`);
  }

  const authorizedCafes = getOwnerAuthorizedCafes(request);
  if (authorizedCafes && !authorizedCafes.includes(outlet.cafeId)) {
    throw new ApiError(403, 'CROSS_CAFE_RESOURCE_DENIED', 'You do not have access to this café.');
  }

  return response.status(200).json({ success: true, data: { outlet } });
});

// ── 3. Operators Master ─────────────────────────────────────────────────────

const listOperators = asyncHandler(async (request, response) => {
  const { organisationId } = request.auth;
  const operators = await RevenueShareOperator.find({ organisationId }).sort({ legalName: 1 }).lean();
  return response.status(200).json({ success: true, data: { operators } });
});

const createOperator = asyncHandler(async (request, response) => {
  const { organisationId, userId } = request.auth;
  const { legalName, tradeName, brandCategory, gstin, panNumber, contacts, bankDetails, notes } = request.body;

  if (!legalName) {
    throw new ApiError(400, 'MISSING_LEGAL_NAME', 'Operator legal name is required.');
  }

  const operatorCount = await RevenueShareOperator.countDocuments({ organisationId });
  const operatorId = `OPR-${String(operatorCount + 1).padStart(4, '0')}`;

  const operator = await RevenueShareOperator.create({
    operatorId,
    organisationId,
    legalName: legalName.trim(),
    tradeName: tradeName || '',
    brandCategory: brandCategory || 'Speciality Food',
    gstin: gstin ? gstin.trim().toUpperCase() : '',
    panNumber: panNumber ? panNumber.trim().toUpperCase() : '',
    status: 'ACTIVE',
    contacts: contacts || [],
    bankDetails: bankDetails || {},
    notes: notes || '',
    createdByUserId: userId,
  });

  return response.status(201).json({
    success: true,
    message: 'Operator onboarded successfully.',
    data: { operator },
  });
});

const getOperatorById = asyncHandler(async (request, response) => {
  const { organisationId } = request.auth;
  const { id } = request.params;

  const operator = await RevenueShareOperator.findOne({ organisationId, operatorId: id.toUpperCase() }).lean();
  if (!operator) {
    throw new ApiError(404, 'OPERATOR_NOT_FOUND', `Operator ${id} was not found.`);
  }

  return response.status(200).json({ success: true, data: { operator } });
});

// ── 4. Agreements & Amendments ──────────────────────────────────────────────

const listAgreements = asyncHandler(async (request, response) => {
  const { organisationId } = request.auth;
  const authorizedCafes = getOwnerAuthorizedCafes(request);
  const filter = { organisationId };
  if (authorizedCafes) {
    filter.cafeId = { $in: authorizedCafes };
  }
  if (request.query.cafeId && request.query.cafeId !== 'ALL') {
    const requestedCafe = String(request.query.cafeId).trim().toUpperCase();
    if (authorizedCafes && !authorizedCafes.includes(requestedCafe)) {
      throw new ApiError(403, 'CROSS_CAFE_RESOURCE_DENIED', 'You do not have access to this café.');
    }
    filter.cafeId = requestedCafe;
  }
  const agreements = await RevenueShareAgreement.find(filter).sort({ agreementId: -1 }).lean();
  return response.status(200).json({ success: true, data: { agreements } });
});

const createAgreement = asyncHandler(async (request, response) => {
  const { organisationId, userId } = request.auth;
  const {
    cafeId,
    outletId,
    operatorId,
    partnerName,
    commencementDate,
    expiryDate,
    sharePercentage,
    fixedFeePaisa,
    minimumGuaranteeMonthlyPaisa,
    maximumCapMonthlyPaisa,
    securityDepositRequiredPaisa,
    salesReportingFrequency,
    settlementFrequency,
    responsibilities,
    notes,
  } = request.body;

  if (!outletId || !operatorId || !commencementDate || !expiryDate) {
    throw new ApiError(400, 'MISSING_REQUIRED_FIELDS', 'Outlet, Operator, Commencement Date, and Expiry Date are required.');
  }

  const outlet = await LeasedOutlet.findOne({ organisationId, outletId: outletId.toUpperCase() }).lean();
  if (!outlet) {
    throw new ApiError(404, 'OUTLET_NOT_FOUND', `Leased outlet ${outletId} was not found.`);
  }
  const authorizedCafes = getOwnerAuthorizedCafes(request);
  if (authorizedCafes && !authorizedCafes.includes(outlet.cafeId)) {
    throw new ApiError(403, 'CROSS_CAFE_RESOURCE_DENIED', 'You do not have access to this café.');
  }

  const count = await RevenueShareAgreement.countDocuments({ organisationId });
  const agreementId = `RSA-${String(count + 1).padStart(4, '0')}`;

  const agreement = await RevenueShareAgreement.create({
    agreementId,
    organisationId,
    cafeId: outlet.cafeId,
    outletId: outletId.toUpperCase(),
    operatorId: operatorId.toUpperCase(),
    partnerName: partnerName || operatorId,
    commencementDate,
    effectiveFrom: commencementDate,
    expiryDate,
    sharePercentage: sharePercentage || 0,
    fixedFeePaisa: fixedFeePaisa || 0,
    minimumGuaranteeMonthlyPaisa: minimumGuaranteeMonthlyPaisa || 0,
    maximumCapMonthlyPaisa: maximumCapMonthlyPaisa || 0,
    securityDepositRequiredPaisa: securityDepositRequiredPaisa || 0,
    salesReportingFrequency: salesReportingFrequency || 'DAILY',
    settlementFrequency: settlementFrequency || 'MONTHLY',
    responsibilities: responsibilities || {},
    status: 'ACTIVE',
    notes: notes || '',
    createdByUserId: userId,
  });

  // Update LeasedOutlet status to OCCUPIED
  await LeasedOutlet.updateOne(
    { organisationId, outletId: outletId.toUpperCase() },
    {
      $set: {
        status: 'OCCUPIED',
        currentOperatorId: operatorId.toUpperCase(),
        currentAgreementId: agreementId,
      },
      $push: {
        occupancyHistory: {
          operatorId: operatorId.toUpperCase(),
          operatorNameSnapshot: partnerName,
          agreementId,
          commencementDate,
        },
      },
    }
  );

  return response.status(201).json({
    success: true,
    message: 'Revenue share agreement created and activated.',
    data: { agreement },
  });
});

const getAgreementById = asyncHandler(async (request, response) => {
  const { organisationId } = request.auth;
  const { id } = request.params;

  const agreement = await RevenueShareAgreement.findOne({ organisationId, agreementId: id.toUpperCase() }).lean();
  if (!agreement) {
    throw new ApiError(404, 'AGREEMENT_NOT_FOUND', `Agreement ${id} was not found.`);
  }

  const authorizedCafes = getOwnerAuthorizedCafes(request);
  if (authorizedCafes && !authorizedCafes.includes(agreement.cafeId)) {
    throw new ApiError(403, 'CROSS_CAFE_RESOURCE_DENIED', 'You do not have access to this café.');
  }

  return response.status(200).json({ success: true, data: { agreement } });
});

// ── 5. Rate Rules ───────────────────────────────────────────────────────────

const listRateRules = asyncHandler(async (request, response) => {
  const { organisationId } = request.auth;
  const rateRules = await RevenueShareRateRule.find({ organisationId }).sort({ effectiveFrom: -1 }).lean();
  return response.status(200).json({ success: true, data: { rateRules } });
});

const createRateRule = asyncHandler(async (request, response) => {
  const { organisationId, userId } = request.auth;
  const {
    agreementId,
    outletId,
    operatorId,
    ruleName,
    calculationMethod,
    calculationBasis,
    creditSalesTreatment,
    percentage,
    fixedAmountPaisa,
    minimumGuaranteePaisa,
    maximumCapPaisa,
    effectiveFrom,
    effectiveTo,
    tiers,
    changeReason,
  } = request.body;

  if (!agreementId || !outletId || !effectiveFrom || !calculationMethod) {
    throw new ApiError(400, 'MISSING_FIELDS', 'Agreement, Outlet, Calculation Method, and Effective From date are required.');
  }

  // Pre-check for overlapping active rules
  const existingOverlap = await RevenueShareRateRule.findOne({
    organisationId,
    outletId: outletId.toUpperCase(),
    status: 'ACTIVE',
    effectiveFrom: { $lte: effectiveTo || '2099-12-31' },
    $or: [{ effectiveTo: null }, { effectiveTo: { $gte: effectiveFrom } }],
  }).lean();

  if (existingOverlap) {
    // Supersede previous rule if new rule starts on or after
    await RevenueShareRateRule.updateOne(
      { rateRuleId: existingOverlap.rateRuleId },
      { $set: { status: 'SUPERSEDED', effectiveTo: effectiveFrom } }
    );
  }

  const count = await RevenueShareRateRule.countDocuments({ organisationId });
  const rateRuleId = `RR-${String(count + 1).padStart(4, '0')}`;

  const rateRule = await RevenueShareRateRule.create({
    rateRuleId,
    organisationId,
    agreementId: agreementId.toUpperCase(),
    outletId: outletId.toUpperCase(),
    operatorId: operatorId ? operatorId.toUpperCase() : 'OPR-0001',
    ruleName: ruleName || `${calculationMethod} - ${effectiveFrom}`,
    calculationMethod,
    calculationBasis: calculationBasis || 'GROSS_SALES',
    creditSalesTreatment: creditSalesTreatment || 'SALES_BASIS',
    percentage: percentage || 0,
    fixedAmountPaisa: fixedAmountPaisa || 0,
    minimumGuaranteePaisa: minimumGuaranteePaisa || 0,
    maximumCapPaisa: maximumCapPaisa || 0,
    effectiveFrom,
    effectiveTo: effectiveTo || null,
    tiers: tiers || [],
    changeReason: changeReason || 'Initial rate schedule',
    status: 'ACTIVE',
    approvedByUserId: userId,
    approvedAt: new Date(),
    createdByUserId: userId,
  });

  return response.status(201).json({
    success: true,
    message: 'Effective-dated rate rule created successfully.',
    data: { rateRule },
  });
});

// ── 6. Sales Submissions & Restatements ──────────────────────────────────────

const listSalesSubmissions = asyncHandler(async (request, response) => {
  const { organisationId } = request.auth;
  const authorizedCafes = getOwnerAuthorizedCafes(request);
  const filter = { organisationId };
  if (authorizedCafes) {
    filter.cafeId = { $in: authorizedCafes };
  }
  if (request.query.cafeId && request.query.cafeId !== 'ALL') {
    const requestedCafe = String(request.query.cafeId).trim().toUpperCase();
    if (authorizedCafes && !authorizedCafes.includes(requestedCafe)) {
      throw new ApiError(403, 'CROSS_CAFE_RESOURCE_DENIED', 'You do not have access to this café.');
    }
    filter.cafeId = requestedCafe;
  }
  const submissions = await SalesSubmission.find(filter).sort({ businessDate: -1 }).lean();
  return response.status(200).json({ success: true, data: { submissions } });
});

const submitSales = asyncHandler(async (request, response) => {
  const { organisationId, userId } = request.auth;
  const {
    outletId,
    operatorId,
    agreementId,
    businessDate,
    grossSalesPaisa,
    discountsPaisa,
    cancellationsPaisa,
    refundsPaisa,
    gstPaisa,
    excludedTransactionsPaisa,
    creditSalesPaisa,
    creditCollectionsPaisa,
    costOfGoodsSoldPaisa,
    operatingExpensesPaisa,
    channels,
    source,
    isZeroSalesDeclaration,
    zeroSalesReason,
    evidenceFileUrl,
  } = request.body;

  if (!outletId || !businessDate) {
    throw new ApiError(400, 'MISSING_FIELDS', 'Outlet ID and Business Date are required.');
  }

  const outlet = await LeasedOutlet.findOne({ organisationId, outletId: outletId.toUpperCase() }).lean();
  const cafeId = outlet?.cafeId || 'ZC-0001';
  const authorizedCafes = getOwnerAuthorizedCafes(request);
  if (authorizedCafes && !authorizedCafes.includes(cafeId)) {
    throw new ApiError(403, 'CROSS_CAFE_RESOURCE_DENIED', 'You do not have access to this café.');
  }

  // Duplicate protection check
  const existing = await SalesSubmission.findOne({
    organisationId,
    outletId: outletId.toUpperCase(),
    businessDate,
  }).lean();

  if (existing) {
    throw new ApiError(409, 'DUPLICATE_SUBMISSION', `Sales report already submitted for outlet ${outletId} on ${businessDate}. Use restatement workflow for corrections.`);
  }

  const count = await SalesSubmission.countDocuments({ organisationId });
  const submissionId = `SS-${String(count + 1).padStart(4, '0')}`;

  const eligiblePaisa = computeEligibleRevenue(
    {
      grossSalesPaisa,
      discountsPaisa,
      cancellationsPaisa,
      refundsPaisa,
      gstPaisa,
      excludedTransactionsPaisa,
      creditSalesPaisa,
      creditCollectionsPaisa,
      costOfGoodsSoldPaisa,
      operatingExpensesPaisa,
      creditSalesTreatment: 'SALES_BASIS',
    },
    'GROSS_SALES'
  );

  const submission = await SalesSubmission.create({
    submissionId,
    organisationId,
    cafeId,
    outletId: outletId.toUpperCase(),
    operatorId: operatorId ? operatorId.toUpperCase() : 'OPR-0001',
    agreementId: agreementId ? agreementId.toUpperCase() : 'RSA-0001',
    businessDate,
    source: source || 'MANUAL',
    isZeroSalesDeclaration: Boolean(isZeroSalesDeclaration),
    zeroSalesReason: zeroSalesReason || '',
    grossSalesPaisa: isZeroSalesDeclaration ? 0 : (grossSalesPaisa || 0),
    discountsPaisa: discountsPaisa || 0,
    cancellationsPaisa: cancellationsPaisa || 0,
    refundsPaisa: refundsPaisa || 0,
    gstPaisa: gstPaisa || 0,
    excludedTransactionsPaisa: excludedTransactionsPaisa || 0,
    creditSalesPaisa: creditSalesPaisa || 0,
    creditCollectionsPaisa: creditCollectionsPaisa || 0,
    costOfGoodsSoldPaisa: costOfGoodsSoldPaisa || 0,
    operatingExpensesPaisa: operatingExpensesPaisa || 0,
    netEligibleRevenuePaisa: eligiblePaisa,
    channels: channels || {},
    evidenceFileUrl: evidenceFileUrl || '',
    status: 'SUBMITTED',
    createdByUserId: userId,
  });

  return response.status(201).json({
    success: true,
    message: 'Sales submission recorded successfully.',
    data: { submission },
  });
});

const approveSalesSubmission = asyncHandler(async (request, response) => {
  const { organisationId, userId } = request.auth;
  const { id } = request.params;
  const { notes, isCertified } = request.body || {};

  const submission = await SalesSubmission.findOne({ organisationId, submissionId: id.toUpperCase() });
  if (!submission) {
    throw new ApiError(404, 'SUBMISSION_NOT_FOUND', `Sales submission ${id} not found.`);
  }

  const authorizedCafes = getOwnerAuthorizedCafes(request);
  if (authorizedCafes && !authorizedCafes.includes(submission.cafeId)) {
    throw new ApiError(403, 'CROSS_CAFE_RESOURCE_DENIED', 'You do not have access to this café.');
  }

  submission.status = isCertified ? 'CERTIFIED' : 'APPROVED';
  submission.isCertified = Boolean(isCertified);
  submission.certifiedBy = isCertified ? userId : '';
  submission.certifiedAt = isCertified ? new Date() : null;
  submission.reviewedByUserId = userId;
  submission.reviewedAt = new Date();
  submission.reviewNotes = notes || 'Approved by authorized Primary Master / Owner.';

  await submission.save();

  return response.status(200).json({
    success: true,
    message: `Sales submission ${id} marked as ${submission.status}.`,
    data: { submission },
  });
});

// ── 7. Settlement Simulation & Calculations ─────────────────────────────────

const simulateSettlement = asyncHandler(async (request, response) => {
  const { organisationId } = request.auth;
  const { outletId, periodStart, periodEnd, rateRuleId } = request.body;

  if (!outletId || !periodStart || !periodEnd) {
    throw new ApiError(400, 'MISSING_FIELDS', 'Outlet ID, Period Start, and Period End are required.');
  }

  const outlet = await LeasedOutlet.findOne({ organisationId, outletId: outletId.toUpperCase() }).lean();
  const cafeId = outlet?.cafeId || 'ZC-0001';
  const authorizedCafes = getOwnerAuthorizedCafes(request);
  if (authorizedCafes && !authorizedCafes.includes(cafeId)) {
    throw new ApiError(403, 'CROSS_CAFE_RESOURCE_DENIED', 'You do not have access to this café.');
  }

  // Aggregate submissions in period
  const submissions = await SalesSubmission.find({
    organisationId,
    outletId: outletId.toUpperCase(),
    businessDate: { $gte: periodStart, $lte: periodEnd },
  }).lean();

  const totalGrossPaisa = submissions.reduce((sum, s) => sum + (s.grossSalesPaisa || 0), 0);
  const totalDiscountsPaisa = submissions.reduce((sum, s) => sum + (s.discountsPaisa || 0), 0);
  const totalCancellationsPaisa = submissions.reduce((sum, s) => sum + (s.cancellationsPaisa || 0), 0);
  const totalRefundsPaisa = submissions.reduce((sum, s) => sum + (s.refundsPaisa || 0), 0);
  const totalGstPaisa = submissions.reduce((sum, s) => sum + (s.gstPaisa || 0), 0);
  const totalCogsPaisa = submissions.reduce((sum, s) => sum + (s.costOfGoodsSoldPaisa || 0), 0);
  const totalOpexPaisa = submissions.reduce((sum, s) => sum + (s.operatingExpensesPaisa || 0), 0);

  // Fetch applicable rate rule
  let rule = null;
  if (rateRuleId) {
    rule = await RevenueShareRateRule.findOne({ organisationId, rateRuleId: rateRuleId.toUpperCase() }).lean();
  }
  if (!rule) {
    rule = await RevenueShareRateRule.findOne({
      organisationId,
      outletId: outletId.toUpperCase(),
      status: 'ACTIVE',
    }).lean();
  }

  if (!rule) {
    rule = {
      calculationMethod: 'PERCENTAGE_ONLY',
      calculationBasis: 'GROSS_SALES',
      percentage: 10,
    };
  }

  // Fetch recoveries for period
  const recoveries = await RecoveryCharge.find({
    organisationId,
    outletId: outletId.toUpperCase(),
  }).lean();

  const electricityPaisa = recoveries.filter((r) => r.utilityType === 'ELECTRICITY').reduce((sum, r) => sum + (r.amountPaisa || 0), 0);
  const waterPaisa = recoveries.filter((r) => r.utilityType === 'WATER').reduce((sum, r) => sum + (r.amountPaisa || 0), 0);

  const simulationResult = computeSettlementTotal({
    salesInput: {
      grossSalesPaisa: totalGrossPaisa,
      discountsPaisa: totalDiscountsPaisa,
      cancellationsPaisa: totalCancellationsPaisa,
      refundsPaisa: totalRefundsPaisa,
      gstPaisa: totalGstPaisa,
      costOfGoodsSoldPaisa: totalCogsPaisa,
      operatingExpensesPaisa: totalOpexPaisa,
      creditSalesTreatment: rule.creditSalesTreatment || 'SALES_BASIS',
    },
    rateRule: rule,
    recoveries: {
      electricityPaisa,
      waterPaisa,
    },
  });

  return response.status(200).json({
    success: true,
    data: {
      simulation: {
        outletId,
        periodStart,
        periodEnd,
        submissionCount: submissions.length,
        totalGrossSalesPaisa: totalGrossPaisa,
        ...simulationResult,
        isSimulation: true,
      },
    },
  });
});

// ── 8. Settlements & Authoritative Approval ─────────────────────────────────

const listSettlements = asyncHandler(async (request, response) => {
  const { organisationId } = request.auth;
  const authorizedCafes = getOwnerAuthorizedCafes(request);
  const filter = { organisationId };
  if (authorizedCafes) {
    filter.cafeId = { $in: authorizedCafes };
  }
  if (request.query.cafeId && request.query.cafeId !== 'ALL') {
    const requestedCafe = String(request.query.cafeId).trim().toUpperCase();
    if (authorizedCafes && !authorizedCafes.includes(requestedCafe)) {
      throw new ApiError(403, 'CROSS_CAFE_RESOURCE_DENIED', 'You do not have access to this café.');
    }
    filter.cafeId = requestedCafe;
  }
  const settlements = await RevenueShareSettlement.find(filter).sort({ periodStart: -1 }).lean();
  return response.status(200).json({ success: true, data: { settlements } });
});

const createSettlement = asyncHandler(async (request, response) => {
  const { organisationId, userId } = request.auth;
  const {
    outletId,
    operatorId,
    agreementId,
    rateRuleId,
    periodKey,
    periodStart,
    periodEnd,
    dueDate,
  } = request.body;

  if (!outletId || !periodKey || !periodStart || !periodEnd) {
    throw new ApiError(400, 'MISSING_FIELDS', 'Outlet ID, Period Key, Period Start, and Period End are required.');
  }

  const outlet = await LeasedOutlet.findOne({
    organisationId,
    outletId: outletId.toUpperCase(),
  }).lean();
  const cafeId = outlet?.cafeId || 'ZC-0001';
  const authorizedCafes = getOwnerAuthorizedCafes(request);
  if (authorizedCafes && !authorizedCafes.includes(cafeId)) {
    throw new ApiError(403, 'CROSS_CAFE_RESOURCE_DENIED', 'You do not have access to this café.');
  }

  const existing = await RevenueShareSettlement.findOne({
    organisationId,
    outletId: outletId.toUpperCase(),
    periodKey,
  }).lean();

  if (existing) {
    throw new ApiError(409, 'SETTLEMENT_ALREADY_EXISTS', `Settlement for outlet ${outletId} on period ${periodKey} already exists (${existing.settlementId}).`);
  }

  // Aggregate sales in period
  const submissions = await SalesSubmission.find({
    organisationId,
    outletId: outletId.toUpperCase(),
    businessDate: { $gte: periodStart, $lte: periodEnd },
  }).lean();

  const totalGrossPaisa = submissions.reduce((sum, s) => sum + (s.grossSalesPaisa || 0), 0);

  let rule = await RevenueShareRateRule.findOne({ organisationId, rateRuleId: rateRuleId ? rateRuleId.toUpperCase() : '' }).lean();
  if (!rule) {
    rule = await RevenueShareRateRule.findOne({ organisationId, outletId: outletId.toUpperCase(), status: 'ACTIVE' }).lean();
  }
  if (!rule) {
    rule = { calculationMethod: 'PERCENTAGE_ONLY', calculationBasis: 'GROSS_SALES', percentage: 10 };
  }

  const calculation = computeSettlementTotal({
    salesInput: { grossSalesPaisa: totalGrossPaisa, creditSalesTreatment: 'SALES_BASIS' },
    rateRule: rule,
  });

  const count = await RevenueShareSettlement.countDocuments({ organisationId });
  const settlementId = `SET-${String(count + 1).padStart(4, '0')}`;

  const settlement = await RevenueShareSettlement.create({
    settlementId,
    organisationId,
    cafeId,
    outletId: outletId.toUpperCase(),
    operatorId: operatorId ? operatorId.toUpperCase() : 'OPR-0001',
    agreementId: agreementId ? agreementId.toUpperCase() : 'RSA-0001',
    rateRuleId: rule.rateRuleId || 'RR-0001',
    periodKey,
    periodStart,
    periodEnd,
    dueDate: dueDate || periodEnd,
    status: 'CALCULATED',
    totalGrossSalesPaisa: totalGrossPaisa,
    eligibleRevenuePaisa: calculation.eligibleRevenuePaisa,
    calculationSnapshot: {
      calculationMethod: rule.calculationMethod,
      calculationBasis: rule.calculationBasis,
      percentageApplied: rule.percentage,
      fixedAmountPaisa: rule.fixedAmountPaisa || 0,
      minimumGuaranteePaisa: rule.minimumGuaranteePaisa || 0,
      maximumCapPaisa: rule.maximumCapPaisa || 0,
    },
    baseRevenueSharePaisa: calculation.baseRevenueSharePaisa,
    fixedFeeComponentPaisa: calculation.fixedFeeComponentPaisa,
    minimumGuaranteeShortfallPaisa: calculation.minimumGuaranteeShortfallPaisa,
    capReductionPaisa: calculation.capReductionPaisa,
    recoveries: calculation.recoveries,
    netPayablePaisa: calculation.netPayablePaisa,
    balanceOutstandingPaisa: calculation.netPayablePaisa,
    calculationBreakdown: calculation.calculationBreakdown,
    createdByUserId: userId,
  });

  return response.status(201).json({
    success: true,
    message: 'Settlement calculated and draft generated.',
    data: { settlement },
  });
});

const approveSettlement = asyncHandler(async (request, response) => {
  const { organisationId, userId } = request.auth;
  const { id } = request.params;
  const { notes } = request.body || {};

  const settlement = await RevenueShareSettlement.findOne({
    organisationId,
    settlementId: id.toUpperCase(),
  });

  if (!settlement) {
    throw new ApiError(404, 'SETTLEMENT_NOT_FOUND', `Settlement ${id} was not found.`);
  }

  const authorizedCafes = getOwnerAuthorizedCafes(request);
  if (authorizedCafes && !authorizedCafes.includes(settlement.cafeId)) {
    throw new ApiError(403, 'CROSS_CAFE_RESOURCE_DENIED', 'You do not have access to this café.');
  }

  // Idempotency check
  if (settlement.status === 'APPROVED' || settlement.status === 'POSTED') {
    return response.status(200).json({
      success: true,
      message: 'Settlement is already approved and posted to Finance.',
      data: { settlement },
    });
  }

  const postingKey = `FPOST-${settlement.settlementId}-${Date.now()}`;

  // Authoritatively create / link Finance AR entry
  const invoiceDoc = await APInvoice.create({
    invoiceId: `INV-RS-${settlement.settlementId}`,
    organisationId,
    cafeId: settlement.cafeId,
    vendorId: settlement.operatorId,
    supplierInvoiceNumber: `RS-${settlement.periodKey}-${settlement.outletId}`,
    invoiceDate: new Date(),
    subtotalPaisa: settlement.netPayablePaisa,
    totalPaisa: settlement.netPayablePaisa,
    status: 'APPROVED',
    notes: `Revenue Share Settlement ${settlement.settlementId} for ${settlement.periodKey}`,
    threeWayMatch: { matchStatus: 'MATCHED' },
  }).catch(() => null);

  settlement.status = 'APPROVED';
  settlement.approvedByUserId = userId;
  settlement.approvedAt = new Date();
  settlement.approvalNotes = notes || 'Authoritatively approved by Primary Master / Owner.';
  settlement.financePosting = {
    status: 'POSTED',
    financeInvoiceId: invoiceDoc ? invoiceDoc.invoiceId : `AR-${settlement.settlementId}`,
    postedAt: new Date(),
    idempotencyKey: postingKey,
  };

  await settlement.save();

  return response.status(200).json({
    success: true,
    message: `Settlement ${id} approved and posted to Finance receivable ledger.`,
    data: { settlement },
  });
});

// ── 9. Payments & Allocations ───────────────────────────────────────────────

const listPayments = asyncHandler(async (request, response) => {
  const { organisationId } = request.auth;
  const payments = await RevenueSharePayment.find({ organisationId }).sort({ paymentDate: -1 }).lean();
  return response.status(200).json({ success: true, data: { payments } });
});

const recordPayment = asyncHandler(async (request, response) => {
  const { organisationId, userId } = request.auth;
  const { operatorId, paymentDate, paymentMode, amountPaisa, transactionReferenceUtr, receiptFileUrl, allocations } = request.body;

  if (!operatorId || !paymentDate || !amountPaisa) {
    throw new ApiError(400, 'MISSING_FIELDS', 'Operator ID, Payment Date, and Amount are required.');
  }

  const count = await RevenueSharePayment.countDocuments({ organisationId });
  const paymentId = `RSP-${String(count + 1).padStart(4, '0')}`;

  const allocatedPaisa = (allocations || []).reduce((sum, a) => sum + (a.allocatedPaisa || 0), 0);
  const unallocatedPaisa = Math.max(0, amountPaisa - allocatedPaisa);

  const payment = await RevenueSharePayment.create({
    paymentId,
    organisationId,
    operatorId: operatorId.toUpperCase(),
    paymentDate,
    paymentMode: paymentMode || 'BANK_TRANSFER_NEFT_RTGS',
    amountPaisa,
    allocatedAmountPaisa: allocatedPaisa,
    unallocatedAmountPaisa: unallocatedPaisa,
    transactionReferenceUtr: transactionReferenceUtr || '',
    status: allocatedPaisa === amountPaisa ? 'ALLOCATED' : 'ENTERED',
    allocations: allocations || [],
    enteredByUserId: userId,
    verifiedByUserId: userId, // Default verified on entry by Primary Master
    verifiedAt: new Date(),
    receiptFileUrl: receiptFileUrl || '',
  });

  // Apply allocations to settlements
  if (allocations && allocations.length) {
    for (const alloc of allocations) {
      await RevenueShareSettlement.updateOne(
        { organisationId, settlementId: alloc.settlementId },
        {
          $inc: {
            paidAmountPaisa: alloc.allocatedPaisa,
            balanceOutstandingPaisa: -alloc.allocatedPaisa,
          },
        }
      );
    }
  }

  return response.status(201).json({
    success: true,
    message: 'Payment recorded and allocated successfully.',
    data: { payment },
  });
});

// ── 10. Outstanding & 7-Bucket Ageing ────────────────────────────────────────

const getOutstandingAndAgeing = asyncHandler(async (request, response) => {
  const { organisationId } = request.auth;
  const authorizedCafes = getOwnerAuthorizedCafes(request);
  const filter = {
    organisationId,
    status: { $in: ['APPROVED', 'POSTED', 'PARTIALLY_PAID'] },
    balanceOutstandingPaisa: { $gt: 0 },
  };
  if (authorizedCafes) {
    filter.cafeId = { $in: authorizedCafes };
  }

  const settlements = await RevenueShareSettlement.find(filter).lean();

  const now = new Date();
  const buckets = {
    currentPaisa: 0,
    days1_15Paisa: 0,
    days16_30Paisa: 0,
    days31_60Paisa: 0,
    days61_90Paisa: 0,
    days91_120Paisa: 0,
    days120PlusPaisa: 0,
    totalOutstandingPaisa: 0,
  };

  settlements.forEach((s) => {
    const due = new Date(s.dueDate || s.periodEnd);
    const diffDays = Math.floor((now - due) / (1000 * 60 * 60 * 24));
    const bal = s.balanceOutstandingPaisa || 0;
    buckets.totalOutstandingPaisa += bal;

    if (diffDays <= 0) {
      buckets.currentPaisa += bal;
    } else if (diffDays <= 15) {
      buckets.days1_15Paisa += bal;
    } else if (diffDays <= 30) {
      buckets.days16_30Paisa += bal;
    } else if (diffDays <= 60) {
      buckets.days31_60Paisa += bal;
    } else if (diffDays <= 90) {
      buckets.days61_90Paisa += bal;
    } else if (diffDays <= 120) {
      buckets.days91_120Paisa += bal;
    } else {
      buckets.days120PlusPaisa += bal;
    }
  });

  return response.status(200).json({
    success: true,
    data: {
      buckets,
      settlements,
    },
  });
});

// ── 11. Recoveries & Meters ─────────────────────────────────────────────────

const listRecoveries = asyncHandler(async (request, response) => {
  const { organisationId } = request.auth;
  const recoveries = await RecoveryCharge.find({ organisationId }).sort({ periodKey: -1 }).lean();
  return response.status(200).json({ success: true, data: { recoveries } });
});

const recordMeterReading = asyncHandler(async (request, response) => {
  const { organisationId, userId } = request.auth;
  const { outletId, operatorId, agreementId, periodKey, utilityType, previousReading, currentReading, unitRatePaisa } = request.body;

  if (!outletId || !periodKey || currentReading === undefined) {
    throw new ApiError(400, 'MISSING_FIELDS', 'Outlet ID, Period Key, and Current Reading are required.');
  }

  const units = Math.max(0, currentReading - (previousReading || 0));
  const rate = unitRatePaisa || 1200; // default ₹12/unit (1200 paise)
  const amountPaisa = units * rate;

  const count = await RecoveryCharge.countDocuments({ organisationId });
  const recoveryId = `REC-${String(count + 1).padStart(4, '0')}`;

  const recovery = await RecoveryCharge.create({
    recoveryId,
    organisationId,
    outletId: outletId.toUpperCase(),
    operatorId: operatorId ? operatorId.toUpperCase() : 'OPR-0001',
    agreementId: agreementId ? agreementId.toUpperCase() : 'RSA-0001',
    periodKey,
    utilityType: utilityType || 'ELECTRICITY',
    previousReading: previousReading || 0,
    currentReading,
    unitsConsumed: units,
    unitRatePaisa: rate,
    amountPaisa,
    status: 'PENDING_BILLING',
    createdByUserId: userId,
  });

  return response.status(201).json({
    success: true,
    message: 'Meter reading and utility charge recorded.',
    data: { recovery },
  });
});

// ── 12. Security Deposits ───────────────────────────────────────────────────

const getDepositLedger = asyncHandler(async (request, response) => {
  const { organisationId } = request.auth;
  const deposits = await SecurityDeposit.find({ organisationId }).lean();
  return response.status(200).json({ success: true, data: { deposits } });
});

const recordDepositTransaction = asyncHandler(async (request, response) => {
  const { organisationId, userId } = request.auth;
  const { agreementId, outletId, operatorId, transactionType, amountPaisa, reason, referenceDoc } = request.body;

  if (!agreementId || !amountPaisa || !transactionType) {
    throw new ApiError(400, 'MISSING_FIELDS', 'Agreement ID, Amount, and Transaction Type are required.');
  }

  let deposit = await SecurityDeposit.findOne({ organisationId, agreementId: agreementId.toUpperCase() });

  if (!deposit) {
    const count = await SecurityDeposit.countDocuments({ organisationId });
    deposit = new SecurityDeposit({
      depositId: `DEP-${String(count + 1).padStart(4, '0')}`,
      organisationId,
      agreementId: agreementId.toUpperCase(),
      outletId: outletId ? outletId.toUpperCase() : 'LO-0001',
      operatorId: operatorId ? operatorId.toUpperCase() : 'OPR-0001',
      requiredAmountPaisa: amountPaisa,
      heldBalancePaisa: 0,
      status: 'REQUIRED',
    });
  }

  if (transactionType === 'INITIAL_DEPOSIT' || transactionType === 'TOP_UP') {
    deposit.heldBalancePaisa += amountPaisa;
    deposit.status = 'HELD_ACTIVE';
  } else if (transactionType === 'DAMAGE_DEDUCTION' || transactionType === 'DEFAULT_DEDUCTION') {
    deposit.heldBalancePaisa = Math.max(0, deposit.heldBalancePaisa - amountPaisa);
    deposit.totalDeductionsPaisa += amountPaisa;
  } else if (transactionType === 'REFUND') {
    deposit.heldBalancePaisa = Math.max(0, deposit.heldBalancePaisa - amountPaisa);
    deposit.totalRefundedPaisa += amountPaisa;
    if (deposit.heldBalancePaisa === 0) deposit.status = 'REFUNDED';
  }

  deposit.ledgerTransactions.push({
    transactionType,
    amountPaisa,
    balanceAfterPaisa: deposit.heldBalancePaisa,
    referenceDoc: referenceDoc || '',
    authorizedByUserId: userId,
    reason: reason || 'Deposit ledger update',
  });

  await deposit.save();

  return response.status(200).json({
    success: true,
    message: 'Deposit transaction recorded successfully.',
    data: { deposit },
  });
});

/**
 * POST /revenue-share/deposits — "Record Security Deposit" modal.
 * Body: { operatorId, heldBalancePaisa, requiredAmountPaisa, status: 'HELD' }.
 * The modal only knows the operator, but SecurityDeposit requires outletId and
 * agreementId — derive both from the operator's agreement. The UI status token
 * 'HELD' maps to the model's 'HELD_ACTIVE'. One deposit ledger is kept per
 * agreement (unique index), so an existing deposit is topped up instead of duplicated.
 */
const createSecurityDeposit = asyncHandler(async (request, response) => {
  const { organisationId, userId } = request.auth;
  const { operatorId, heldBalancePaisa, requiredAmountPaisa } = request.body || {};

  if (!operatorId || heldBalancePaisa === undefined) {
    throw new ApiError(400, 'MISSING_FIELDS', 'operatorId and heldBalancePaisa are required.');
  }

  const held = Number(heldBalancePaisa) || 0;
  if (held <= 0) {
    throw new ApiError(400, 'INVALID_AMOUNT', 'heldBalancePaisa must be greater than zero.');
  }

  const normOperatorId = String(operatorId).trim().toUpperCase();
  const agreement = await RevenueShareAgreement.findOne({
    organisationId,
    operatorId: normOperatorId,
  }).lean();

  if (!agreement) {
    throw new ApiError(404, 'AGREEMENT_NOT_FOUND', `No revenue-share agreement found for operator ${normOperatorId}.`);
  }

  const required = Number(requiredAmountPaisa) || held;

  let deposit = await SecurityDeposit.findOne({ organisationId, agreementId: agreement.agreementId });

  if (deposit) {
    deposit.heldBalancePaisa = held;
    deposit.requiredAmountPaisa = required;
    deposit.status = 'HELD_ACTIVE';
    deposit.ledgerTransactions.push({
      transactionType: 'TOP_UP',
      amountPaisa: held,
      balanceAfterPaisa: held,
      authorizedByUserId: userId,
      reason: 'Recorded from Revenue Share deposits screen',
    });
    await deposit.save();
  } else {
    const count = await SecurityDeposit.countDocuments({ organisationId });
    deposit = await SecurityDeposit.create({
      depositId: `DEP-${String(count + 1).padStart(4, '0')}`,
      organisationId,
      operatorId: normOperatorId,
      outletId: agreement.outletId,
      agreementId: agreement.agreementId,
      requiredAmountPaisa: required,
      heldBalancePaisa: held,
      status: 'HELD_ACTIVE',
      ledgerTransactions: [
        {
          transactionType: 'INITIAL_DEPOSIT',
          amountPaisa: held,
          balanceAfterPaisa: held,
          authorizedByUserId: userId,
          reason: 'Recorded from Revenue Share deposits screen',
        },
      ],
    });
  }

  return response.status(201).json({
    success: true,
    message: 'Security deposit recorded.',
    data: { deposit },
  });
});

/**
 * POST /revenue-share/recoveries — "Add Recovery Charge" modal.
 * Body: { outletId, utilityType, periodKey, unitsConsumed, amountPaisa, status: 'BILLED' }.
 * The modal only knows the outlet, but RecoveryCharge requires operatorId and
 * agreementId — derive both from the outlet's agreement. The UI utility tokens
 * CAM_CHARGES / HVAC are outside the model enum and map to CAM_COMMON_AREA, and
 * the UI status token 'BILLED' maps to the model's PENDING_BILLING.
 */
const createRecoveryCharge = asyncHandler(async (request, response) => {
  const { organisationId, userId } = request.auth;
  const { outletId, utilityType, periodKey, unitsConsumed, amountPaisa, status } = request.body || {};

  if (!outletId || !periodKey || !utilityType) {
    throw new ApiError(400, 'MISSING_FIELDS', 'outletId, utilityType and periodKey are required.');
  }

  const amount = Number(amountPaisa) || 0;
  if (amount <= 0) {
    throw new ApiError(400, 'INVALID_AMOUNT', 'amountPaisa must be greater than zero.');
  }

  const normOutletId = String(outletId).trim().toUpperCase();
  const agreement = await RevenueShareAgreement.findOne({
    organisationId,
    outletId: normOutletId,
  }).lean();

  if (!agreement) {
    throw new ApiError(404, 'AGREEMENT_NOT_FOUND', `No revenue-share agreement found for outlet ${normOutletId}.`);
  }

  const UTILITY_TYPE_ALIASES = { CAM_CHARGES: 'CAM_COMMON_AREA', HVAC: 'CAM_COMMON_AREA' };
  const rawUtility = String(utilityType).trim().toUpperCase();
  const normUtility = UTILITY_TYPE_ALIASES[rawUtility] || rawUtility;

  const MODEL_STATUSES = ['ESTIMATED', 'PENDING_BILLING', 'BILLED_IN_SETTLEMENT', 'SETTLED', 'ADJUSTED'];
  const rawStatus = String(status || '').trim().toUpperCase();
  const normStatus = rawStatus === 'BILLED'
    ? 'PENDING_BILLING'
    : (MODEL_STATUSES.includes(rawStatus) ? rawStatus : 'PENDING_BILLING');

  const count = await RecoveryCharge.countDocuments({ organisationId });
  const recovery = await RecoveryCharge.create({
    recoveryId: `REC-${String(count + 1).padStart(4, '0')}`,
    organisationId,
    outletId: normOutletId,
    operatorId: agreement.operatorId,
    agreementId: agreement.agreementId,
    periodKey: String(periodKey).trim().toUpperCase(),
    utilityType: normUtility,
    unitsConsumed: Number(unitsConsumed) || 0,
    amountPaisa: amount,
    status: normStatus,
    createdByUserId: userId,
  });

  return response.status(201).json({
    success: true,
    message: 'Recovery charge recorded.',
    data: { recovery },
  });
});

// ── 13. Disputes & Default Cases ────────────────────────────────────────────

const listDisputes = asyncHandler(async (request, response) => {
  const { organisationId } = request.auth;
  const disputes = await RevenueShareDispute.find({ organisationId }).sort({ createdAt: -1 }).lean();
  return response.status(200).json({ success: true, data: { disputes } });
});

const createDispute = asyncHandler(async (request, response) => {
  const { organisationId, userId } = request.auth;
  const { outletId, operatorId, agreementId, settlementId, caseType, totalAmountPaisa, disputedAmountPaisa, reason, cureDeadline } = request.body;

  if (!outletId || !disputedAmountPaisa || !reason) {
    throw new ApiError(400, 'MISSING_FIELDS', 'Outlet ID, Disputed Amount, and Reason are required.');
  }

  const count = await RevenueShareDispute.countDocuments({ organisationId });
  const disputeId = `DSP-${String(count + 1).padStart(4, '0')}`;

  const total = totalAmountPaisa || disputedAmountPaisa;
  const undisputed = Math.max(0, total - disputedAmountPaisa);

  const dispute = await RevenueShareDispute.create({
    disputeId,
    organisationId,
    outletId: outletId.toUpperCase(),
    operatorId: operatorId ? operatorId.toUpperCase() : 'OPR-0001',
    agreementId: agreementId ? agreementId.toUpperCase() : 'RSA-0001',
    settlementId: settlementId ? settlementId.toUpperCase() : null,
    caseType: caseType || 'SETTLEMENT_CALCULATION',
    totalAmountPaisa: total,
    disputedAmountPaisa,
    undisputedAmountPaisa: undisputed,
    reason,
    cureDeadline: cureDeadline || null,
    status: 'OPEN',
    createdByUserId: userId,
  });

  return response.status(201).json({
    success: true,
    message: 'Dispute case registered successfully.',
    data: { dispute },
  });
});

const resolveDispute = asyncHandler(async (request, response) => {
  const { organisationId, userId } = request.auth;
  const { id } = request.params;
  const { action, adjustmentPaisa, notes } = request.body || {};

  const dispute = await RevenueShareDispute.findOne({ organisationId, disputeId: id.toUpperCase() });
  if (!dispute) {
    throw new ApiError(404, 'DISPUTE_NOT_FOUND', `Dispute case ${id} was not found.`);
  }

  dispute.status = 'RESOLVED';
  dispute.resolution = {
    action: action || 'NO_CHANGE_UPHELD',
    adjustmentPaisa: adjustmentPaisa || 0,
    resolvedByUserId: userId,
    resolvedAt: new Date(),
    notes: notes || 'Resolution issued by authorized Primary Master / Owner.',
  };

  await dispute.save();

  return response.status(200).json({
    success: true,
    message: `Dispute case ${id} resolved successfully.`,
    data: { dispute },
  });
});

// ── 14. ZURF v1 Compliance Export ───────────────────────────────────────────

const exportZurfPdf = asyncHandler(async (request, response) => {
  const { organisationId, userId } = request.auth;
  const authorizedCafes = getOwnerAuthorizedCafes(request);
  const filter = { organisationId };
  if (authorizedCafes) {
    filter.cafeId = { $in: authorizedCafes };
  }

  const [outlets, agreements, settlements] = await Promise.all([
    LeasedOutlet.find(filter).lean(),
    RevenueShareAgreement.find(filter).lean(),
    RevenueShareSettlement.find(filter).lean(),
  ]);

  const reportId = `ZURF-RS-${Date.now()}`;
  const totalEarnedPaisa = settlements.reduce((sum, s) => sum + (s.netPayablePaisa || 0), 0);

  return response.status(200).json({
    success: true,
    data: {
      reportId,
      title: 'ZAMORIN UNIVERSAL REPORT FORMAT (ZURF v1) — REVENUE SHARE PORTFOLIO REGISTER',
      generatedAt: new Date().toISOString(),
      generatedByUserId: userId,
      organisation: {
        legalName: 'Zamorin Specialty Coffee Private Limited',
        gstin: '32AABCU9603R1ZM',
        pan: 'AABCU9603R',
      },
      summary: {
        totalOutlets: outlets.length,
        activeAgreements: agreements.filter((a) => a.status === 'ACTIVE').length,
        totalRevenueShareEarnedInr: (totalEarnedPaisa / 100).toFixed(2),
        classification: 'HIGHLY CONFIDENTIAL — PRIMARY MASTER / OWNER ONLY',
      },
    },
  });
});

module.exports = {
  getOverview,
  listOutlets,
  createOutlet,
  getOutletById,
  listOperators,
  createOperator,
  getOperatorById,
  listAgreements,
  createAgreement,
  getAgreementById,
  listRateRules,
  createRateRule,
  listSalesSubmissions,
  submitSales,
  approveSalesSubmission,
  simulateSettlement,
  listSettlements,
  createSettlement,
  approveSettlement,
  listPayments,
  recordPayment,
  getOutstandingAndAgeing,
  listRecoveries,
  recordMeterReading,
  getDepositLedger,
  recordDepositTransaction,
  createSecurityDeposit,
  createRecoveryCharge,
  listDisputes,
  createDispute,
  resolveDispute,
  exportZurfPdf,
};
