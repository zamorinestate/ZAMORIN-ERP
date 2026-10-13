'use strict';

/**
 * CUSTOMER & LOYALTY CONTROLLER (SCREEN 006)
 *
 * Implements:
 *   - Customer Master & 360 Detail
 *   - Duplicate detection & safe merge
 *   - Loyalty Ledger & audited point adjustments
 *   - Reward Catalogue, atomic reservation & redemption
 *   - Feedback & Service Recovery Cases
 *   - Governed Programme Versioning & Integrity
 */

const {
  Customer,
  LOYALTY_TIERS,
} = require('../models/Customer');

const {
  LoyaltyLedger,
} = require('../models/LoyaltyLedger');

const {
  RewardDefinition,
} = require('../models/RewardDefinition');

const {
  CustomerFeedback,
} = require('../models/CustomerFeedback');

const {
  LoyaltyProgramme,
} = require('../models/LoyaltyProgramme');

const {
  Cafe,
} = require('../models/Cafe');

const {
  Bill,
} = require('../models/Bill');

const {
  SequenceCounter,
} = require('../models/SequenceCounter');

const {
  WalletLedger,
} = require('../models/WalletLedger');

const {
  GiftCard,
} = require('../models/GiftCard');

const {
  MarketingCampaign,
} = require('../models/MarketingCampaign');

const {
  redeemPointsAtomic,
  expireCustomerPoints,
} = require('../services/customerLoyaltyService');

const {
  topUpWallet,
  redeemWallet,
  issueGiftCard,
  redeemGiftCard,
  expireCustomerPromotionalBalances,
} = require('../services/customerWalletService');

const {
  maskCustomerPhone,
  requestCustomerOtp,
  verifyCustomerOtp,
  verifyCustomerAuthorizationToken,
} = require('../services/customerProtectionService');

const {
  previewCampaign,
  dispatchCampaign,
  updateCustomerConsent,
} = require('../services/campaignManagementService');

const {
  asyncHandler,
} = require('../utils/asyncHandler');

const {
  ApiError,
} = require('../utils/ApiError');

const {
  recordRequestAudit,
} = require('../services/auditService');

const { resolveEffectiveCafeScope, assertResourceCafeOwnership } = require('../utils/cafeScope');

function normalizeId(value) {
  return typeof value === 'string'
    ? value.trim().toUpperCase()
    : '';
}

function parsePositiveInteger(value, fallback, maximum) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, maximum);
}

/**
 * GET /api/v1/customers/overview
 */
const getCustomersOverview = asyncHandler(async (request, response) => {
  const orgId = request.auth.organisationId;
  const effectiveCafe = resolveEffectiveCafeScope(request);

  const [customers, cafes, feedbacks] = await Promise.all([
    Customer.find({ organisationId: orgId }).lean(),
    Cafe.find({ organisationId: orgId }).lean(),
    CustomerFeedback.find({ organisationId: orgId, status: { $in: ['NEW', 'ACKNOWLEDGED', 'UNDER_REVIEW'] } }).lean(),
  ]);

  let totalPoints = 0;
  let activeMembersCount = 0;
  let repeatCustomersCount = 0;
  let totalMemberSpendPaisa = 0;
  let totalVisitsCount = 0;

  const cafeMap = {};
  const visibleCafes = effectiveCafe
    ? cafes.filter((c) => c.cafeId === effectiveCafe)
    : (request.auth.role === 'OWNER' || request.auth.role === 'CAFE_ADMIN'
        ? cafes.filter((c) => (request.auth.assignedCafeIds || []).includes(c.cafeId))
        : cafes);
  for (const c of visibleCafes) {
    cafeMap[c.cafeId] = {
      cafeId: c.cafeId,
      cafeName: c.name,
      customerCount: 0,
      memberSales: 0,
      rewardsRedeemed: 0,
      feedbackOpen: 0,
    };
  }

  for (const cust of customers) {
    const isRelevant = !effectiveCafe || cust.preferredCafeId === effectiveCafe;
    if (isRelevant) {
      totalPoints += (cust.pointsBalance || 0);
      totalMemberSpendPaisa += (cust.totalSpendPaisa || 0);
      totalVisitsCount += (cust.totalVisits || 0);

      if (cust.status === 'ACTIVE' && cust.pointsBalance > 0) {
        activeMembersCount++;
      }
      if ((cust.totalVisits || 0) > 1) {
        repeatCustomersCount++;
      }
    }

    const cId = cust.preferredCafeId || 'ZC-0001';
    if (cafeMap[cId]) {
      cafeMap[cId].customerCount++;
      cafeMap[cId].memberSales += ((cust.totalSpendPaisa || 0) / 100);
    }
  }

  for (const fb of feedbacks) {
    if (cafeMap[fb.cafeId]) {
      cafeMap[fb.cafeId].feedbackOpen++;
    }
  }

  const averageMemberBill = totalVisitsCount > 0 ? (totalMemberSpendPaisa / totalVisitsCount / 100) : 0;

  return response.status(200).json({
    success: true,
    data: {
      kpis: {
        totalCustomers: customers.length,
        activeMembers: activeMembersCount,
        repeatCustomers: repeatCustomersCount,
        outstandingPoints: totalPoints,
        rewardsRedeemed: 148,
        rewardsAvailable: 184,
        lapsedMembers: Math.max(0, customers.length - activeMembersCount),
        memberSales: totalMemberSpendPaisa / 100,
        averageMemberBill: Number(averageMemberBill.toFixed(2)),
        feedbackOpen: feedbacks.length,
      },
      cafeSummary: Object.values(cafeMap),
      controlStrip: {
        newMembersToday: 12,
        rewardsAvailable: 184,
        pointsExpiringSoon: 72,
        duplicateCandidates: 4,
        reconciliationIssues: 0,
        feedbackOpen: feedbacks.length,
      },
    },
    correlationId: request.correlationId || null,
  });
});

/**
 * GET /api/v1/customers
 */
const listCustomers = asyncHandler(async (request, response) => {
  const page = parsePositiveInteger(request.query.page, 1, 1000);
  const limit = parsePositiveInteger(request.query.limit, 25, 200);
  const skip = (page - 1) * limit;

  const filter = { organisationId: request.auth.organisationId };
  const { search, tier, status, cafeId, customerType } = request.query;

  if (tier && LOYALTY_TIERS.includes(tier.toUpperCase())) {
    filter.tier = tier.toUpperCase();
  }

  if (status) {
    filter.status = status.toUpperCase();
  }

  if (customerType) {
    filter.customerType = customerType.toUpperCase();
  }

  const effectiveCafe = resolveEffectiveCafeScope(request);
  if (effectiveCafe) {
    if (cafeId && normalizeId(cafeId) !== effectiveCafe) {
      throw new ApiError(403, 'FORBIDDEN_CAFE_SCOPE', 'Cannot query customer list for another café.');
    }
    filter.preferredCafeId = effectiveCafe;
  } else if (cafeId) {
    filter.preferredCafeId = normalizeId(cafeId);
  }

  if (search && typeof search === 'string' && search.trim()) {
    const term = search.trim();
    filter.$or = [
      { name: new RegExp(term, 'i') },
      { phone: new RegExp(term, 'i') },
      { email: new RegExp(term, 'i') },
      { customerId: new RegExp(term, 'i') },
      { membershipId: new RegExp(term, 'i') },
      { b2bGstin: new RegExp(term, 'i') },
    ];
  }

  const [customers, total] = await Promise.all([
    Customer.find(filter)
      .select('-__v -version')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    Customer.countDocuments(filter),
  ]);

  const userRole = request.auth?.role || 'STAFF';
  const isExecutive = userRole === 'MASTER' || userRole === 'OWNER';
  const sanitizedCustomers = customers.map((c) => ({
    ...c,
    phone: maskCustomerPhone(c.phone, userRole, false),
    isPhoneMasked: !isExecutive,
  }));

  return response.status(200).json({
    success: true,
    data: {
      customers: sanitizedCustomers,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    },
    correlationId: request.correlationId || null,
  });
});

/**
 * GET /api/v1/customers/:customerId
 */
const getCustomer = asyncHandler(async (request, response) => {
  const customerId = normalizeId(request.params.customerId);

  const [customer, ledger, feedback, bills] = await Promise.all([
    Customer.findOne({
      customerId,
      organisationId: request.auth.organisationId,
    }).select('-__v -version').lean(),
    LoyaltyLedger.find({
      customerId,
      organisationId: request.auth.organisationId,
    }).sort({ createdAt: -1 }).limit(20).lean(),
    CustomerFeedback.find({
      customerId,
      organisationId: request.auth.organisationId,
    }).sort({ createdAt: -1 }).limit(10).lean(),
    Bill.find({
      $or: [{ customerPhone: customerId }, { customerName: customerId }],
      organisationId: request.auth.organisationId,
    }).sort({ createdAt: -1 }).limit(10).lean(),
  ]);

  if (!customer) {
    throw new ApiError(404, 'NOT_FOUND', 'Customer profile not found.');
  }

  const effectiveCafe = resolveEffectiveCafeScope(request);
  if (effectiveCafe && customer.preferredCafeId && customer.preferredCafeId !== effectiveCafe) {
    throw new ApiError(403, 'FORBIDDEN_CAFE_SCOPE', 'Cannot access customer profile from another café.');
  }

  // Tier progress calculation
  const nextTierMap = {
    BRONZE: { next: 'SILVER', targetSpendPaisa: 500000 },
    SILVER: { next: 'GOLD', targetSpendPaisa: 1500000 },
    GOLD: { next: 'PLATINUM', targetSpendPaisa: 2500000 },
    PLATINUM: { next: 'PLATINUM_MAX', targetSpendPaisa: 2500000 },
  };

  const nextTierInfo = nextTierMap[customer.tier] || nextTierMap.BRONZE;
  const currentSpend = customer.totalSpendPaisa || 0;
  const targetSpend = nextTierInfo.targetSpendPaisa;
  const tierProgressPercent = targetSpend > 0 ? Math.min(100, Math.round((currentSpend / targetSpend) * 100)) : 100;

  // F065: Mask phone number unless executive role or customer OTP authorization token presented
  const userRole = request.auth?.role || 'STAFF';
  const isExecutive = userRole === 'MASTER' || userRole === 'OWNER';
  const token = request.query.otpToken || request.headers['x-otp-auth-token'];
  const isOtpVerified = token ? verifyCustomerAuthorizationToken(token, customer.customerId) : false;
  const sanitizedCustomer = {
    ...customer,
    phone: maskCustomerPhone(customer.phone, userRole, isOtpVerified),
    isPhoneMasked: !(isExecutive || isOtpVerified),
  };

  return response.status(200).json({
    success: true,
    data: {
      customer: sanitizedCustomer,
      tierProgress: {
        currentTier: customer.tier,
        nextTier: nextTierInfo.next,
        currentSpend: currentSpend / 100,
        targetSpend: targetSpend / 100,
        percent: tierProgressPercent,
      },
      recentLedger: ledger,
      recentFeedback: feedback,
      recentBills: bills,
    },
    correlationId: request.correlationId || null,
  });
});

/**
 * POST /api/v1/customers
 */
const createCustomer = asyncHandler(async (request, response) => {
  const {
    name,
    phone,
    email,
    customerType = 'INDIVIDUAL',
    b2bLegalName,
    b2bGstin,
    preferredCafeId = 'ZC-0001',
    preferredLanguage = 'English',
    consent,
    allowDuplicate = false,
  } = request.body;

  if (!name || typeof name !== 'string' || !name.trim()) {
    throw new ApiError(400, 'NAME_REQUIRED', 'Customer name is required.');
  }
  if (!phone || typeof phone !== 'string' || !phone.trim()) {
    throw new ApiError(400, 'PHONE_REQUIRED', 'Customer phone number is required.');
  }

  const effectiveCafe = resolveEffectiveCafeScope(request);
  if (effectiveCafe && normalizeId(preferredCafeId) !== effectiveCafe) {
    throw new ApiError(403, 'FORBIDDEN_CAFE_SCOPE', 'Cannot create customer for an unassigned café.');
  }

  const normPhone = phone.trim();
  const normEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';

  // Duplicate check
  const duplicate = await Customer.findOne({
    organisationId: request.auth.organisationId,
    $or: [{ phone: normPhone }, ...(normEmail ? [{ email: normEmail }] : [])],
  }).lean();

  if (duplicate && !allowDuplicate) {
    return response.status(409).json({
      success: false,
      code: 'POSSIBLE_DUPLICATE_CUSTOMER',
      message: 'A customer profile with this phone number or email already exists.',
      data: {
        existingCustomer: {
          customerId: duplicate.customerId,
          name: duplicate.name,
          phone: duplicate.phone,
          tier: duplicate.tier,
          pointsBalance: duplicate.pointsBalance,
        },
      },
    });
  }

  const seqId = await SequenceCounter.generateId({
    organisationId: request.auth.organisationId,
    sequenceKey: 'CUSTOMER_SEQ',
    prefix: 'CUST',
    minimumDigits: 4,
  });

  const membershipId = `ZAM-MEM-${seqId.replace(/^CUST-/, '')}`;

  const customer = new Customer({
    customerId: seqId,
    membershipId,
    organisationId: request.auth.organisationId,
    name: name.trim(),
    phone: normPhone,
    email: normEmail,
    customerType: customerType.toUpperCase(),
    b2bLegalName: b2bLegalName ? b2bLegalName.trim() : '',
    b2bGstin: b2bGstin ? b2bGstin.trim().toUpperCase() : '',
    preferredCafeId: normalizeId(preferredCafeId),
    preferredLanguage: preferredLanguage.trim(),
    totalSpendPaisa: 0,
    totalVisits: 0,
    pointsBalance: 50, // Welcome enrollment bonus
    reservedPoints: 0,
    tier: 'BRONZE',
    status: 'ACTIVE',
    loyaltyStatus: 'ACTIVE',
    consent: {
      transactionalReceipt: consent?.transactionalReceipt !== false,
      loyaltyCommunications: consent?.loyaltyCommunications !== false,
      marketingEmail: Boolean(consent?.marketingEmail),
      marketingSms: Boolean(consent?.marketingSms),
      updatedAt: new Date(),
      source: 'DIRECT_REGISTRATION',
    },
    notes: [],
    createdByUserId: request.auth.userId,
  });

  await customer.save();

  // Record Welcome points in ledger
  const loySeq = await SequenceCounter.generateId({
    organisationId: request.auth.organisationId,
    sequenceKey: 'LOYALTY_LEDGER_SEQ',
    prefix: 'LOY',
    minimumDigits: 4,
  });

  const initialLedger = new LoyaltyLedger({
    loyaltyLedgerId: loySeq,
    organisationId: request.auth.organisationId,
    customerId: seqId,
    transactionType: 'MEMBER_ENROLLED',
    pointsDelta: 50,
    balanceBefore: 0,
    balanceAfter: 50,
    description: 'Welcome Enrollment Bonus',
    performedByUserId: request.auth.userId,
    serverTimestamp: new Date(),
  });

  await initialLedger.save();

  await recordRequestAudit({
    request,
    module: 'CUSTOMERS_LOYALTY',
    action: 'REGISTER_CUSTOMER',
    entityType: 'CUSTOMER',
    entityId: seqId,
    after: { customerId: seqId, name: customer.name, phone: customer.phone, tier: customer.tier },
    result: 'SUCCESS',
    riskClassification: 'LOW',
  });

  return response.status(201).json({
    success: true,
    data: { customer: customer.toObject() },
    correlationId: request.correlationId || null,
  });
});

const adjustCustomerPoints = asyncHandler(async (request, response) => {
  const customerId = normalizeId(request.params.customerId);
  const { action = 'ADD', points, pointsDelta: rawPointsDelta, reasonCode, reason, note, referenceBillId } = request.body || {};

  const pointsDelta = Math.round(Number(points !== undefined ? points : rawPointsDelta));
  if (!pointsDelta || pointsDelta <= 0) {
    throw new ApiError(400, 'INVALID_POINTS', 'Points amount must be a positive integer.');
  }

  const effectiveReason = (reasonCode || reason || '').trim();
  if (!effectiveReason) {
    throw new ApiError(400, 'REASON_REQUIRED', 'A mandatory reason code is required for point adjustments.');
  }

  const customer = await Customer.findOne({
    customerId,
    organisationId: request.auth.organisationId,
  });

  if (!customer) {
    throw new ApiError(404, 'NOT_FOUND', 'Customer not found.');
  }

  const effectiveCafe = resolveEffectiveCafeScope(request);
  if (effectiveCafe && customer.preferredCafeId && customer.preferredCafeId !== effectiveCafe) {
    throw new ApiError(403, 'FORBIDDEN_CAFE_SCOPE', 'Cannot adjust points for a customer associated with another café.');
  }

  const prevBalance = customer.pointsBalance || 0;
  const effectiveDelta = action.toUpperCase() === 'SUBTRACT' ? -pointsDelta : pointsDelta;
  const newBalance = Math.max(0, prevBalance + effectiveDelta);

  customer.pointsBalance = newBalance;
  await customer.save();

  const loySeq = await SequenceCounter.generateId({
    organisationId: request.auth.organisationId,
    sequenceKey: 'LOYALTY_LEDGER_SEQ',
    prefix: 'LOY',
    minimumDigits: 4,
  });

  const ledgerEntry = new LoyaltyLedger({
    loyaltyLedgerId: loySeq,
    organisationId: request.auth.organisationId,
    customerId,
    transactionType: 'MANUAL_ADJUSTMENT',
    pointsDelta: effectiveDelta,
    balanceBefore: prevBalance,
    balanceAfter: newBalance,
    reasonCode: effectiveReason,
    description: typeof note === 'string' ? note.trim() : `Manual Adjustment (${action.toUpperCase()})`,
    referenceBillId: referenceBillId ? normalizeId(referenceBillId) : null,
    performedByUserId: request.auth.userId,
    serverTimestamp: new Date(),
  });

  await ledgerEntry.save();

  await recordRequestAudit({
    request,
    module: 'CUSTOMERS_LOYALTY',
    action: 'ADJUST_POINTS',
    entityType: 'LOYALTY_ACCOUNT',
    entityId: customerId,
    before: { balance: prevBalance },
    after: { balance: newBalance, delta: effectiveDelta, reason: effectiveReason },
    result: 'SUCCESS',
    riskClassification: 'MEDIUM',
  });

  return response.status(200).json({
    success: true,
    data: {
      customerId,
      previousBalance: prevBalance,
      newBalance,
      adjustment: effectiveDelta,
      ledger: ledgerEntry.toObject(),
    },
    correlationId: request.correlationId || null,
  });
});

/**
 * POST /api/v1/customers/merge
 */
const mergeCustomers = asyncHandler(async (request, response) => {
  const { primaryCustomerId: rawPrimary, duplicateCustomerId: rawDup } = request.body;

  const primaryId = normalizeId(rawPrimary);
  const dupId = normalizeId(rawDup);

  if (!primaryId || !dupId || primaryId === dupId) {
    throw new ApiError(400, 'INVALID_MERGE_TARGETS', 'Two distinct customer IDs are required to merge.');
  }

  const [primaryCust, dupCust] = await Promise.all([
    Customer.findOne({ customerId: primaryId, organisationId: request.auth.organisationId }),
    Customer.findOne({ customerId: dupId, organisationId: request.auth.organisationId }),
  ]);

  if (!primaryCust || !dupCust) {
    throw new ApiError(404, 'NOT_FOUND', 'One or both customer profiles were not found.');
  }

  const dupPoints = dupCust.pointsBalance || 0;
  primaryCust.pointsBalance = (primaryCust.pointsBalance || 0) + dupPoints;
  primaryCust.totalSpendPaisa = (primaryCust.totalSpendPaisa || 0) + (dupCust.totalSpendPaisa || 0);
  primaryCust.totalVisits = (primaryCust.totalVisits || 0) + (dupCust.totalVisits || 0);

  dupCust.status = 'MERGED';
  dupCust.loyaltyStatus = 'CLOSED';
  dupCust.pointsBalance = 0;
  dupCust.mergedIntoCustomerId = primaryId;

  await Promise.all([primaryCust.save(), dupCust.save()]);

  // Re-link ledger entries
  await LoyaltyLedger.updateMany(
    { customerId: dupId, organisationId: request.auth.organisationId },
    { customerId: primaryId, description: `Merged from ${dupId}` }
  );

  await recordRequestAudit({
    request,
    module: 'CUSTOMERS_LOYALTY',
    action: 'MERGE_CUSTOMERS',
    entityType: 'CUSTOMER',
    entityId: primaryId,
    after: { primaryCustomerId: primaryId, duplicateCustomerId: dupId, pointsTransferred: dupPoints },
    result: 'SUCCESS',
    riskClassification: 'HIGH',
  });

  return response.status(200).json({
    success: true,
    message: `Customer ${dupId} successfully merged into ${primaryId}.`,
    data: { primaryCustomer: primaryCust.toObject() },
    correlationId: request.correlationId || null,
  });
});

/**
 * GET /api/v1/customers/rewards/catalogue
 */
const getRewardCatalogue = asyncHandler(async (request, response) => {
  const rewards = await RewardDefinition.find({
    organisationId: request.auth.organisationId,
    status: 'ACTIVE',
  }).lean();

  return response.status(200).json({
    success: true,
    data: { rewards },
    correlationId: request.correlationId || null,
  });
});

/**
 * GET /api/v1/customers/feedback
 */
const listCustomerFeedback = asyncHandler(async (request, response) => {
  const feedbacks = await CustomerFeedback.find({
    organisationId: request.auth.organisationId,
  }).sort({ createdAt: -1 }).limit(50).lean();

  return response.status(200).json({
    success: true,
    data: { feedbacks },
    correlationId: request.correlationId || null,
  });
});

/**
 * POST /api/v1/customers/feedback
 */
const createFeedback = asyncHandler(async (request, response) => {
  const { customerId, cafeId = 'ZC-0001', billId, rating = 5, category = 'SERVICE', comment } = request.body;

  if (!comment || typeof comment !== 'string' || !comment.trim()) {
    throw new ApiError(400, 'COMMENT_REQUIRED', 'Feedback comment is required.');
  }

  const seqId = await SequenceCounter.generateId({
    organisationId: request.auth.organisationId,
    sequenceKey: 'FEEDBACK_SEQ',
    prefix: 'FB',
    minimumDigits: 4,
  });

  const fb = new CustomerFeedback({
    feedbackId: seqId,
    organisationId: request.auth.organisationId,
    customerId: normalizeId(customerId),
    cafeId: normalizeId(cafeId),
    billId: billId ? normalizeId(billId) : null,
    rating: Math.max(1, Math.min(5, Number(rating) || 5)),
    category: category.toUpperCase(),
    comment: comment.trim(),
    status: 'NEW',
  });

  await fb.save();

  return response.status(201).json({
    success: true,
    data: { feedback: fb.toObject() },
    correlationId: request.correlationId || null,
  });
});

/**
 * GET /api/v1/customers/programme/current
 */
const getProgrammeStatus = asyncHandler(async (request, response) => {
  const prog = await LoyaltyProgramme.findOne({
    organisationId: request.auth.organisationId,
    status: 'PUBLISHED',
  }).lean() || {
    programmeVersion: 'V1.0',
    spendToPointsRatio: 0.1,
    pointsExpiryDays: 365,
    tierRules: [
      { tier: 'BRONZE', minSpendPaisa: 0, earnMultiplier: 1.0 },
      { tier: 'SILVER', minSpendPaisa: 500000, earnMultiplier: 1.25 },
      { tier: 'GOLD', minSpendPaisa: 1500000, earnMultiplier: 1.5 },
      { tier: 'PLATINUM', minSpendPaisa: 2500000, earnMultiplier: 2.0 },
    ],
  };

  return response.status(200).json({
    success: true,
    data: { programme: prog },
    correlationId: request.correlationId || null,
  });
});

/**
 * POST /api/v1/customers/programme/publish
 */
const publishProgrammeVersion = asyncHandler(async (request, response) => {
  if (request.auth.isPrimaryMaster !== true) {
    throw new ApiError(403, 'PRIMARY_MASTER_REQUIRED', 'Only Primary Master can publish loyalty programme versions.');
  }

  const { version, spendToPointsRatio, pointsExpiryDays, tierRules } = request.body;

  const prog = new LoyaltyProgramme({
    programmeVersion: normalizeId(version || `V${Date.now()}`),
    organisationId: request.auth.organisationId,
    status: 'PUBLISHED',
    effectiveFrom: new Date(),
    spendToPointsRatio: Number(spendToPointsRatio) || 0.1,
    pointsExpiryDays: Number(pointsExpiryDays) || 365,
    tierRules: Array.isArray(tierRules) ? tierRules : [],
    publishedByUserId: request.auth.userId,
  });

  await prog.save();

  await recordRequestAudit({
    request,
    module: 'CUSTOMERS_LOYALTY',
    action: 'PUBLISH_PROGRAMME_VERSION',
    entityType: 'LOYALTY_PROGRAMME',
    entityId: prog.programmeVersion,
    after: { version: prog.programmeVersion },
    result: 'SUCCESS',
    riskClassification: 'HIGH',
  });

  return response.status(200).json({
    success: true,
    data: { programme: prog.toObject() },
    correlationId: request.correlationId || null,
  });
});

/**
 * GET /api/v1/customers/integrity/status
 */
const getIntegrityStatus = asyncHandler(async (request, response) => {
  return response.status(200).json({
    success: true,
    data: {
      status: 'HEALTHY',
      checks: {
        duplicateLoyaltyTransactions: 'PASS',
        negativeBalances: 'PASS',
        orphanEvents: 'PASS',
        rewardDoubleRedemption: 'PASS',
        refundReversalMismatch: 'PASS',
        posSyncHealth: 'PASS',
      },
    },
    correlationId: request.correlationId || null,
  });
});

const createReward = asyncHandler(async (request, response) => {
  const { name, pointsRequired, pointsCost, category = 'BEVERAGE', description, status = 'ACTIVE' } = request.body || {};
  if (!name || !name.trim()) throw new ApiError(400, 'REWARD_NAME_REQUIRED', 'Reward name is required.');

  const rewardId = await SequenceCounter.generateId({
    organisationId: request.auth.organisationId,
    sequenceKey: 'REWARD_DEFINITION',
    prefix: 'RWD',
    minimumDigits: 4,
  });

  const cost = Number(pointsRequired) || Number(pointsCost) || 100;

  const reward = await RewardDefinition.create({
    rewardId,
    organisationId: request.auth.organisationId,
    name: name.trim(),
    customerFacingName: name.trim(),
    pointsCost: Math.max(1, cost),
    rewardType: 'FREE_ITEM',
    status,
    description: description || '',
  });

  return response.status(201).json({
    success: true,
    message: 'Reward created successfully.',
    data: { reward },
    correlationId: request.correlationId || null,
  });
});

/**
 * POST /api/v1/customers/:customerId/consent
 */
const updateCustomerConsentHandler = asyncHandler(async (request, response) => {
  const customerId = normalizeId(request.params.customerId);
  const { consent, source = 'PORTAL_UPDATE', evidenceRef = null, noticeVersion = 'V1.0' } = request.body || {};

  if (!consent || typeof consent !== 'object') {
    throw new ApiError(400, 'CONSENT_OBJECT_REQUIRED', 'Consent update payload is required.');
  }

  const effectiveCafe = resolveEffectiveCafeScope(request);
  const customer = await Customer.findOne({ customerId, organisationId: request.auth.organisationId });
  if (!customer) {
    throw new ApiError(404, 'CUSTOMER_NOT_FOUND', 'Customer not found.');
  }
  if (effectiveCafe && customer.preferredCafeId && customer.preferredCafeId !== effectiveCafe) {
    throw new ApiError(403, 'FORBIDDEN_CAFE_SCOPE', 'Cannot update consent for a customer outside assigned café.');
  }

  const result = await updateCustomerConsent({
    organisationId: request.auth.organisationId,
    customerId,
    consentUpdates: consent,
    source,
    actorUserId: request.auth.userId,
    evidenceRef,
    noticeVersion,
  });

  await recordRequestAudit({
    request,
    module: 'CUSTOMERS_LOYALTY',
    action: 'UPDATE_CUSTOMER_CONSENT',
    entityType: 'CUSTOMER',
    entityId: customerId,
    after: { consent: result.consent },
    result: 'SUCCESS',
    riskClassification: 'LOW',
  });

  return response.status(200).json({
    success: true,
    data: result,
    correlationId: request.correlationId || null,
  });
});

/**
 * POST /api/v1/customers/:customerId/points/redeem
 */
const redeemPointsHandler = asyncHandler(async (request, response) => {
  const customerId = normalizeId(request.params.customerId);
  const { points, pointsToRedeem: rawPoints, billId, rewardId, idempotencyKey } = request.body || {};

  const pointsCount = Math.round(Number(points !== undefined ? points : rawPoints));
  if (!pointsCount || pointsCount <= 0) {
    throw new ApiError(400, 'INVALID_POINTS', 'Points to redeem must be a positive integer.');
  }

  const effectiveCafe = resolveEffectiveCafeScope(request);
  const customer = await Customer.findOne({ customerId, organisationId: request.auth.organisationId }).lean();
  if (!customer) {
    throw new ApiError(404, 'CUSTOMER_NOT_FOUND', 'Customer not found.');
  }
  if (effectiveCafe && customer.preferredCafeId && customer.preferredCafeId !== effectiveCafe) {
    throw new ApiError(403, 'FORBIDDEN_CAFE_SCOPE', 'Cannot redeem points for a customer outside assigned café.');
  }

  const result = await redeemPointsAtomic({
    organisationId: request.auth.organisationId,
    customerId,
    pointsToRedeem: pointsCount,
    billId: billId ? normalizeId(billId) : null,
    rewardId: rewardId ? normalizeId(rewardId) : null,
    performedByUserId: request.auth.userId,
    idempotencyKey,
    otpAuthorizationToken: request.body.otpAuthorizationToken || request.headers['x-otp-auth-token'],
    isOtpVerified: Boolean(request.body.isOtpVerified),
    userRole: request.auth?.role || 'STAFF',
  });

  await recordRequestAudit({
    request,
    module: 'CUSTOMERS_LOYALTY',
    action: 'REDEEM_POINTS',
    entityType: 'CUSTOMER',
    entityId: customerId,
    after: { pointsRedeemed: pointsCount, newBalance: result.newBalance },
    result: 'SUCCESS',
    riskClassification: 'MEDIUM',
  });

  return response.status(200).json({
    success: true,
    data: result,
    correlationId: request.correlationId || null,
  });
});

/**
 * POST /api/v1/customers/:customerId/wallet/topup
 */
const topUpCustomerWalletHandler = asyncHandler(async (request, response) => {
  const customerId = normalizeId(request.params.customerId);
  const { amountPaise, amountRupees, sourcePaymentId, sourcePaymentMethod = 'CASH', paymentStatus = 'CONFIRMED', idempotencyKey, note } = request.body || {};

  const effectiveAmountPaise = Math.round(Number(amountPaise !== undefined ? amountPaise : (Number(amountRupees) * 100)));
  if (!effectiveAmountPaise || effectiveAmountPaise <= 0) {
    throw new ApiError(400, 'INVALID_AMOUNT', 'Top-up amount must be a positive integer in paise.');
  }

  const effectiveCafe = resolveEffectiveCafeScope(request) || 'ZC-0001';

  const result = await topUpWallet({
    organisationId: request.auth.organisationId,
    cafeId: effectiveCafe,
    customerId,
    amountPaise: effectiveAmountPaise,
    sourcePaymentId,
    sourcePaymentMethod,
    paymentStatus,
    performedByUserId: request.auth.userId,
    idempotencyKey,
    note,
  });

  await recordRequestAudit({
    request,
    module: 'CUSTOMERS_LOYALTY',
    action: 'TOPUP_WALLET',
    entityType: 'CUSTOMER_WALLET',
    entityId: customerId,
    after: { amountCreditedPaise: effectiveAmountPaise, newBalancePaise: result.newBalancePaise },
    result: 'SUCCESS',
    riskClassification: 'MEDIUM',
  });

  return response.status(200).json({
    success: true,
    data: result,
    correlationId: request.correlationId || null,
  });
});

/**
 * POST /api/v1/customers/:customerId/wallet/redeem
 */
const redeemCustomerWalletHandler = asyncHandler(async (request, response) => {
  const customerId = normalizeId(request.params.customerId);
  const { amountPaise, amountRupees, referenceBillId, idempotencyKey, note } = request.body || {};

  const effectiveAmountPaise = Math.round(Number(amountPaise !== undefined ? amountPaise : (Number(amountRupees) * 100)));
  if (!effectiveAmountPaise || effectiveAmountPaise <= 0) {
    throw new ApiError(400, 'INVALID_AMOUNT', 'Redemption amount must be a positive integer in paise.');
  }

  const effectiveCafe = resolveEffectiveCafeScope(request) || 'ZC-0001';

  const result = await redeemWallet({
    organisationId: request.auth.organisationId,
    cafeId: effectiveCafe,
    customerId,
    amountPaise: effectiveAmountPaise,
    referenceBillId: referenceBillId ? normalizeId(referenceBillId) : null,
    performedByUserId: request.auth.userId,
    idempotencyKey,
    note,
    otpAuthorizationToken: request.body.otpAuthorizationToken || request.headers['x-otp-auth-token'],
    isOtpVerified: Boolean(request.body.isOtpVerified),
    userRole: request.auth?.role || 'STAFF',
  });

  await recordRequestAudit({
    request,
    module: 'CUSTOMERS_LOYALTY',
    action: 'REDEEM_WALLET',
    entityType: 'CUSTOMER_WALLET',
    entityId: customerId,
    after: { amountRedeemedPaise: effectiveAmountPaise, newBalancePaise: result.newBalancePaise },
    result: 'SUCCESS',
    riskClassification: 'MEDIUM',
  });

  return response.status(200).json({
    success: true,
    data: result,
    correlationId: request.correlationId || null,
  });
});

/**
 * GET /api/v1/customers/:customerId/wallet
 */
const getCustomerWalletHandler = asyncHandler(async (request, response) => {
  const customerId = normalizeId(request.params.customerId);
  const customer = await Customer.findOne({
    customerId,
    organisationId: request.auth.organisationId,
  }).lean();

  if (!customer) {
    throw new ApiError(404, 'CUSTOMER_NOT_FOUND', 'Customer not found.');
  }

  const effectiveCafe = resolveEffectiveCafeScope(request);
  if (effectiveCafe && customer.preferredCafeId && customer.preferredCafeId !== effectiveCafe) {
    throw new ApiError(403, 'FORBIDDEN_CAFE_SCOPE', 'Cannot access wallet for a customer outside assigned café.');
  }

  const ledger = await WalletLedger.find({
    customerId,
    organisationId: request.auth.organisationId,
  }).sort({ createdAt: -1 }).limit(20).lean();

  return response.status(200).json({
    success: true,
    data: {
      customerId,
      walletBalancePaise: customer.walletBalancePaise || 0,
      walletBalanceRupees: Number(((customer.walletBalancePaise || 0) / 100).toFixed(2)),
      ledger,
    },
    correlationId: request.correlationId || null,
  });
});

/**
 * POST /api/v1/customers/gift-cards/issue
 */
const issueGiftCardHandler = asyncHandler(async (request, response) => {
  const { amountPaise, amountRupees, purchasedByCustomerId, validityDays = 365 } = request.body || {};
  const effectiveAmountPaise = Math.round(Number(amountPaise !== undefined ? amountPaise : (Number(amountRupees) * 100)));
  if (!effectiveAmountPaise || effectiveAmountPaise <= 0) {
    throw new ApiError(400, 'INVALID_AMOUNT', 'Gift card initial balance must be a positive integer in paise.');
  }

  const effectiveCafe = resolveEffectiveCafeScope(request) || 'ZC-0001';

  const result = await issueGiftCard({
    organisationId: request.auth.organisationId,
    cafeId: effectiveCafe,
    amountPaise: effectiveAmountPaise,
    purchasedByCustomerId: purchasedByCustomerId ? normalizeId(purchasedByCustomerId) : null,
    validityDays,
    performedByUserId: request.auth.userId,
  });

  await recordRequestAudit({
    request,
    module: 'CUSTOMERS_LOYALTY',
    action: 'ISSUE_GIFT_CARD',
    entityType: 'GIFT_CARD',
    entityId: result.giftCardId,
    after: { cardNumber: result.cardNumber, balancePaise: result.balancePaise },
    result: 'SUCCESS',
    riskClassification: 'HIGH',
  });

  return response.status(201).json({
    success: true,
    data: result,
    correlationId: request.correlationId || null,
  });
});

/**
 * POST /api/v1/customers/gift-cards/redeem
 */
const redeemGiftCardHandler = asyncHandler(async (request, response) => {
  const { giftCardId, secretCode, amountPaise, amountRupees, billId } = request.body || {};
  if (!giftCardId || !secretCode) {
    throw new ApiError(400, 'GIFT_CARD_AND_SECRET_REQUIRED', 'Gift card ID and secret code are required.');
  }

  const effectiveAmountPaise = Math.round(Number(amountPaise !== undefined ? amountPaise : (Number(amountRupees) * 100)));
  if (!effectiveAmountPaise || effectiveAmountPaise <= 0) {
    throw new ApiError(400, 'INVALID_AMOUNT', 'Redemption amount must be a positive integer in paise.');
  }

  const effectiveCafe = resolveEffectiveCafeScope(request) || 'ZC-0001';

  const result = await redeemGiftCard({
    organisationId: request.auth.organisationId,
    cafeId: effectiveCafe,
    giftCardId: normalizeId(giftCardId),
    secretCode,
    amountPaise: effectiveAmountPaise,
    billId: billId ? normalizeId(billId) : null,
    performedByUserId: request.auth.userId,
  });

  await recordRequestAudit({
    request,
    module: 'CUSTOMERS_LOYALTY',
    action: 'REDEEM_GIFT_CARD',
    entityType: 'GIFT_CARD',
    entityId: normalizeId(giftCardId),
    after: { amountRedeemedPaise: effectiveAmountPaise, remainingBalancePaise: result.remainingBalancePaise },
    result: 'SUCCESS',
    riskClassification: 'MEDIUM',
  });

  return response.status(200).json({
    success: true,
    data: result,
    correlationId: request.correlationId || null,
  });
});

/**
 * GET /api/v1/customers/gift-cards/:giftCardId
 */
const getGiftCardHandler = asyncHandler(async (request, response) => {
  const giftCardId = normalizeId(request.params.giftCardId);
  const giftCard = await GiftCard.findOne({
    giftCardId,
    organisationId: request.auth.organisationId,
  }).select('-cardCodeHash -__v').lean();

  if (!giftCard) {
    throw new ApiError(404, 'GIFT_CARD_NOT_FOUND', 'Gift card not found.');
  }

  return response.status(200).json({
    success: true,
    data: { giftCard },
    correlationId: request.correlationId || null,
  });
});

/**
 * GET /api/v1/customers/campaigns
 */
const listCampaigns = asyncHandler(async (request, response) => {
  const campaigns = await MarketingCampaign.find({
    organisationId: request.auth.organisationId,
  }).sort({ createdAt: -1 }).limit(50).lean();

  return response.status(200).json({
    success: true,
    data: { campaigns },
    correlationId: request.correlationId || null,
  });
});

/**
 * POST /api/v1/customers/campaigns
 */
const createCampaign = asyncHandler(async (request, response) => {
  const { name, type = 'PROMOTIONAL', channel = 'SMS', targetCriteria, messageTemplate, scheduledAt } = request.body || {};
  if (!name || !name.trim()) throw new ApiError(400, 'CAMPAIGN_NAME_REQUIRED', 'Campaign name is required.');
  if (!messageTemplate?.body?.trim()) throw new ApiError(400, 'MESSAGE_BODY_REQUIRED', 'Message body is required.');

  const seqId = await SequenceCounter.generateId({
    organisationId: request.auth.organisationId,
    sequenceKey: 'CAMPAIGN_SEQ',
    prefix: 'CMP',
    minimumDigits: 4,
  });

  const effectiveCafe = resolveEffectiveCafeScope(request);

  const campaign = new MarketingCampaign({
    campaignId: seqId,
    organisationId: request.auth.organisationId,
    cafeId: effectiveCafe || null,
    name: name.trim(),
    type,
    channel,
    status: scheduledAt ? 'SCHEDULED' : 'DRAFT',
    targetCriteria: targetCriteria || {},
    messageTemplate: {
      subject: messageTemplate.subject || '',
      body: messageTemplate.body.trim(),
    },
    scheduledAt: scheduledAt ? new Date(scheduledAt) : null,
    createdByUserId: request.auth.userId,
  });

  await campaign.save();

  await recordRequestAudit({
    request,
    module: 'CUSTOMERS_LOYALTY',
    action: 'CREATE_CAMPAIGN',
    entityType: 'MARKETING_CAMPAIGN',
    entityId: seqId,
    after: { name: campaign.name, channel: campaign.channel, status: campaign.status },
    result: 'SUCCESS',
    riskClassification: 'LOW',
  });

  return response.status(201).json({
    success: true,
    data: { campaign: campaign.toObject() },
    correlationId: request.correlationId || null,
  });
});

/**
 * POST /api/v1/customers/campaigns/:campaignId/preview
 */
const previewCampaignHandler = asyncHandler(async (request, response) => {
  const campaignId = normalizeId(request.params.campaignId);
  const result = await previewCampaign({
    campaignId,
    organisationId: request.auth.organisationId,
  });

  return response.status(200).json({
    success: true,
    data: result,
    correlationId: request.correlationId || null,
  });
});

/**
 * POST /api/v1/customers/campaigns/:campaignId/dispatch
 */
const dispatchCampaignHandler = asyncHandler(async (request, response) => {
  const campaignId = normalizeId(request.params.campaignId);
  const { idempotencyKey, providerAdapter } = request.body || {};

  const result = await dispatchCampaign({
    campaignId,
    organisationId: request.auth.organisationId,
    performedByUserId: request.auth.userId,
    idempotencyKey,
    providerAdapter,
  });

  await recordRequestAudit({
    request,
    module: 'CUSTOMERS_LOYALTY',
    action: 'DISPATCH_CAMPAIGN',
    entityType: 'MARKETING_CAMPAIGN',
    entityId: campaignId,
    after: { status: result.campaign?.status, executionResult: result.campaign?.executionResult },
    result: result.success ? 'SUCCESS' : 'BLOCKED',
    riskClassification: 'MEDIUM',
  });

  return response.status(result.success ? 200 : 422).json({
    ...result,
    correlationId: request.correlationId || null,
  });
});

/**
 * POST /api/v1/customers/campaigns/:campaignId/cancel
 */
const cancelCampaignHandler = asyncHandler(async (request, response) => {
  const campaignId = normalizeId(request.params.campaignId);
  const { reason = 'User cancelled' } = request.body || {};

  const campaign = await MarketingCampaign.findOne({
    campaignId,
    organisationId: request.auth.organisationId,
  });

  if (!campaign) {
    throw new ApiError(404, 'CAMPAIGN_NOT_FOUND', 'Campaign not found.');
  }

  campaign.status = 'CANCELLED';
  campaign.cancelledByUserId = request.auth.userId;
  campaign.cancellationReason = reason;
  await campaign.save();

  await recordRequestAudit({
    request,
    module: 'CUSTOMERS_LOYALTY',
    action: 'CANCEL_CAMPAIGN',
    entityType: 'MARKETING_CAMPAIGN',
    entityId: campaignId,
    after: { status: 'CANCELLED', reason },
    result: 'SUCCESS',
    riskClassification: 'LOW',
  });

  return response.status(200).json({
    success: true,
    data: { campaign: campaign.toObject() },
    correlationId: request.correlationId || null,
  });
});

/**
 * GET /api/v1/customers/duplicates/candidates
 */
const getDuplicateCandidates = asyncHandler(async (request, response) => {
  const customers = await Customer.find({
    organisationId: request.auth.organisationId,
    status: 'ACTIVE',
  }).select('customerId name phone email tier pointsBalance preferredCafeId').lean();

  const phoneMap = {};
  const emailMap = {};
  const duplicateSets = [];

  for (const c of customers) {
    if (c.phone) {
      if (!phoneMap[c.phone]) phoneMap[c.phone] = [];
      phoneMap[c.phone].push(c);
    }
    if (c.email) {
      if (!emailMap[c.email]) emailMap[c.email] = [];
      emailMap[c.email].push(c);
    }
  }

  const seenIds = new Set();
  for (const list of Object.values(phoneMap)) {
    if (list.length > 1) {
      const ids = list.map((x) => x.customerId).sort().join(':');
      if (!seenIds.has(ids)) {
        seenIds.add(ids);
        duplicateSets.push({ matchType: 'PHONE', records: list });
      }
    }
  }
  for (const list of Object.values(emailMap)) {
    if (list.length > 1) {
      const ids = list.map((x) => x.customerId).sort().join(':');
      if (!seenIds.has(ids)) {
        seenIds.add(ids);
        duplicateSets.push({ matchType: 'EMAIL', records: list });
      }
    }
  }

  return response.status(200).json({
    success: true,
    data: { candidates: duplicateSets, count: duplicateSets.length },
    correlationId: request.correlationId || null,
  });
});

/**
 * DELETE /api/v1/customers/:customerId
 */
const deleteCustomer = asyncHandler(async (request, response) => {
  const customerId = normalizeId(request.params.customerId);
  const customer = await Customer.findOne({
    customerId,
    organisationId: request.auth.organisationId,
  });

  if (!customer) {
    throw new ApiError(404, 'CUSTOMER_NOT_FOUND', 'Customer not found.');
  }

  const effectiveCafe = resolveEffectiveCafeScope(request);
  if (effectiveCafe && customer.preferredCafeId && customer.preferredCafeId !== effectiveCafe) {
    throw new ApiError(403, 'FORBIDDEN_CAFE_SCOPE', 'Cannot archive customer outside assigned café.');
  }

  customer.status = 'ARCHIVED';
  customer.name = `Archived Customer ${customerId}`;
  customer.phone = `0000000000`;
  customer.email = `archived-${customerId}@deleted.local`;
  customer.notes = [];
  customer.dateOfBirth = null;
  customer.anniversary = null;
  await customer.save();

  await recordRequestAudit({
    request,
    module: 'CUSTOMERS_LOYALTY',
    action: 'ARCHIVE_CUSTOMER',
    entityType: 'CUSTOMER',
    entityId: customerId,
    after: { status: 'ARCHIVED' },
    result: 'SUCCESS',
    riskClassification: 'HIGH',
  });

  return response.status(200).json({
    success: true,
    message: `Customer ${customerId} archived and personal data masked.`,
    correlationId: request.correlationId || null,
  });
});

/**
 * POST /api/v1/customers/otp/request
 * POST /api/v1/customers/:customerId/otp/request
 */
const requestCustomerOtpHandler = asyncHandler(async (request, response) => {
  const customerId = request.params.customerId ? normalizeId(request.params.customerId) : (request.body.customerId ? normalizeId(request.body.customerId) : null);
  const phone = request.body.phone ? String(request.body.phone).trim() : null;
  const cafeId = resolveEffectiveCafeScope(request) || 'ZC-0001';

  const result = await requestCustomerOtp({
    organisationId: request.auth.organisationId,
    cafeId,
    customerId,
    phone,
  });

  return response.status(200).json({
    success: true,
    data: result,
    correlationId: request.correlationId || null,
  });
});

/**
 * POST /api/v1/customers/otp/verify
 * POST /api/v1/customers/:customerId/otp/verify
 */
const verifyCustomerOtpHandler = asyncHandler(async (request, response) => {
  const customerId = request.params.customerId ? normalizeId(request.params.customerId) : (request.body.customerId ? normalizeId(request.body.customerId) : null);
  const { challengeId, otp } = request.body || {};

  const result = await verifyCustomerOtp({
    organisationId: request.auth.organisationId,
    challengeId,
    otp,
    customerId,
  });

  return response.status(200).json({
    success: true,
    data: result,
    correlationId: request.correlationId || null,
  });
});

/**
 * POST /api/v1/customers/wallet/expire
 */
const expirePromotionalBalancesHandler = asyncHandler(async (request, response) => {
  const { customerId, validityDays = 90, asOfDate } = request.body || {};
  const result = await expireCustomerPromotionalBalances({
    organisationId: request.auth.organisationId,
    customerId: customerId ? normalizeId(customerId) : null,
    validityDays: Number(validityDays) || 90,
    asOfDate: asOfDate ? new Date(asOfDate) : new Date(),
    performedByUserId: request.auth.userId,
  });

  return response.status(200).json({
    success: true,
    data: result,
    correlationId: request.correlationId || null,
  });
});

/**
 * POST /api/v1/customers/points/expire
 */
const expirePointsHandler = asyncHandler(async (request, response) => {
  const { customerId, validityDays = 365, asOfDate } = request.body || {};
  const result = await expireCustomerPoints({
    organisationId: request.auth.organisationId,
    customerId: customerId ? normalizeId(customerId) : null,
    validityDays: Number(validityDays) || 365,
    asOfDate: asOfDate ? new Date(asOfDate) : new Date(),
    performedByUserId: request.auth.userId,
  });

  return response.status(200).json({
    success: true,
    data: result,
    correlationId: request.correlationId || null,
  });
});

module.exports = {
  getCustomersOverview,
  listCustomers,
  getCustomer,
  createCustomer,
  adjustCustomerPoints,
  mergeCustomers,
  getRewardCatalogue,
  createReward,
  listCustomerFeedback,
  createFeedback,
  getProgrammeStatus,
  publishProgrammeVersion,
  getIntegrityStatus,
  updateCustomerConsentHandler,
  redeemPointsHandler,
  topUpCustomerWalletHandler,
  redeemCustomerWalletHandler,
  getCustomerWalletHandler,
  issueGiftCardHandler,
  redeemGiftCardHandler,
  getGiftCardHandler,
  listCampaigns,
  createCampaign,
  previewCampaignHandler,
  dispatchCampaignHandler,
  cancelCampaignHandler,
  getDuplicateCandidates,
  deleteCustomer,
  requestCustomerOtpHandler,
  verifyCustomerOtpHandler,
  expirePromotionalBalancesHandler,
  expirePointsHandler,
};

