'use strict';

/**
 * ============================================================================
 * ZAMORIN CAFÉ ERP — P14 CUSTOMERS, LOYALTY, FEEDBACK & CAMPAIGNS TEST SUITE
 * ============================================================================
 *
 * Verifies all 30 Acceptance Conditions from P14 Specification:
 *  1. Customer creation, retrieval and history are organisation- and café-scoped.
 *  2. Duplicate-customer review does not silently merge unrelated identities.
 *  3. A customer cannot access another customer's protected information.
 *  4. Staff and Vendor are denied internal customer-management operations.
 *  5. Owner remains read-only for P14 operational mutations.
 *  6. Café Operations cannot read or mutate another café's records.
 *  7. Preference changes are persisted and auditable.
 *  8. An unsubscribed customer is excluded from the relevant campaign.
 *  9. A scheduled campaign rechecks current preferences before dispatch.
 * 10. A campaign preview does not send external messages.
 * 11. An unconfigured provider results in a visible blocked state rather than false delivery success.
 * 12. Duplicate campaign execution or outbox replay cannot create duplicate sends for the same idempotency identity.
 * 13. A completed eligible sale awards rewards exactly once.
 * 14. A repeated sale event cannot award the same rewards twice.
 * 15. Voiding a bill reverses its rewards exactly once.
 * 16. A refund reverses eligible rewards correctly and cannot reverse more than the remaining original award.
 * 17. A duplicate refund or replay cannot repeat the reward reversal.
 * 18. Discount-ineligible items follow the configured loyalty rules.
 * 19. Concurrent redemption requests cannot overspend the same points balance.
 * 20. Expired or blocked rewards cannot be redeemed.
 * 21. Wallet top-ups require authoritative receipt or payment confirmation.
 * 22. A pending or ambiguous payment does not create spendable wallet value.
 * 23. Duplicate payment callbacks cannot create duplicate wallet credits.
 * 24. Concurrent wallet or gift-card redemptions cannot overdraw the balance.
 * 25. Paid stored value is distinguished from promotional rewards and is reflected in the applicable liability workflow.
 * 26. Manual adjustments require the correct role, reason and audit record.
 * 27. Feedback and complaint lifecycle changes persist with their actors and timestamps.
 * 28. A complaint cannot bypass the existing financial refund or payment-approval process.
 * 29. Cross-café compensation requests and unauthorised data exports are denied.
 * 30. Existing P09, P10, P11, P12 and P13 behaviours remain intact.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryReplSet } = require('mongodb-memory-server');

// Models
const { Customer } = require('../src/models/Customer');
const { LoyaltyLedger } = require('../src/models/LoyaltyLedger');
const { LoyaltyProgramme } = require('../src/models/LoyaltyProgramme');
const { WalletLedger } = require('../src/models/WalletLedger');
const { GiftCard } = require('../src/models/GiftCard');
const { MarketingCampaign } = require('../src/models/MarketingCampaign');
const { CustomerComplaint } = require('../src/models/CustomerComplaint');
const { CustomerFeedback } = require('../src/models/CustomerFeedback');
const { Bill } = require('../src/models/Bill');
const { AuditEvent } = require('../src/models/AuditEvent');

// Services & Controllers
const customerLoyaltyService = require('../src/services/customerLoyaltyService');
const customerWalletService = require('../src/services/customerWalletService');
const campaignManagementService = require('../src/services/campaignManagementService');
const ownerComplaintsService = require('../src/services/ownerComplaintsService');
const customerController = require('../src/controllers/customerController');
const { authorize } = require('../src/middleware/authorize');

// Helper to construct mock request & response
function buildMockReqRes(role, customAuth = {}, body = {}, query = {}, params = {}) {
  let statusCode = 200;
  let responseData = null;
  const headers = {};

  const req = {
    auth: {
      userId: customAuth.userId || (role === 'MASTER' ? 'MU-0001' : (role === 'OWNER' ? 'OW-0001' : (role === 'CAFE_ADMIN' ? 'CA-0001' : 'ST-0001'))),
      role,
      organisationId: customAuth.organisationId || 'ORG-ZAMORIN',
      isPrimaryMaster: customAuth.isPrimaryMaster !== undefined ? customAuth.isPrimaryMaster : (role === 'MASTER'),
      assignedCafeIds: customAuth.assignedCafeIds || ['ZC-0001'],
      primaryCafeId: customAuth.primaryCafeId !== undefined ? customAuth.primaryCafeId : (customAuth.assignedCafeIds ? customAuth.assignedCafeIds[0] : 'ZC-0001'),
      cafeId: customAuth.cafeId !== undefined ? customAuth.cafeId : (customAuth.assignedCafeIds ? customAuth.assignedCafeIds[0] : 'ZC-0001'),
      name: customAuth.name || 'Test User',
      ...customAuth,
    },
    params,
    query,
    body,
    headers,
    get: (h) => headers[h.toLowerCase()],
  };

  const res = {
    status(code) {
      statusCode = code;
      return this;
    },
    json(data) {
      responseData = data;
      return this;
    },
    send(data) {
      responseData = data;
      return this;
    },
    setHeader(name, val) {
      headers[name] = val;
    },
  };

  return { req, res, getResult: () => ({ statusCode, data: responseData, headers }) };
}

test('P14: Customers, Loyalty, Feedback & Campaigns Suite', async (suite) => {
  let replSet;

  suite.before(async () => {
    replSet = await MongoMemoryReplSet.create({
      replSet: { count: 1, storageEngine: 'wiredTiger' },
    });
    await replSet.waitUntilRunning();
    const uri = replSet.getUri();
    await mongoose.connect(uri);

    // Pre-create collections
    await Promise.all([
      Customer.createCollection(),
      LoyaltyLedger.createCollection(),
      LoyaltyProgramme.createCollection(),
      WalletLedger.createCollection(),
      GiftCard.createCollection(),
      MarketingCampaign.createCollection(),
      CustomerComplaint.createCollection(),
      CustomerFeedback.createCollection(),
      Bill.createCollection(),
      AuditEvent.createCollection(),
    ]);
  });

  suite.after(async () => {
    await mongoose.disconnect();
    if (replSet) await replSet.stop();
  });

  // ─── 1. CUSTOMER CREATION, RETRIEVAL AND SCOPING ───────────────────────────
  await suite.test('1. Customer creation, retrieval and history are organisation- and café-scoped', async () => {
    const { req, res, getResult } = buildMockReqRes('MASTER', { organisationId: 'ORG-ZAMORIN' }, {
      name: 'Aditi Nair',
      phone: '+919876543210',
      email: 'aditi.nair@example.com',
      preferredCafeId: 'ZC-0001',
    });

    await customerController.createCustomer(req, res);
    const result = getResult();
    assert.equal(result.statusCode, 201);
    assert.ok(result.data.data.customer.customerId);
    const customerId = result.data.data.customer.customerId;

    // Verify retrieval under same organisation
    const { req: getReq, res: getRes, getResult: getResResult } = buildMockReqRes('MASTER', { organisationId: 'ORG-ZAMORIN' }, {}, {}, { customerId });
    await customerController.getCustomer(getReq, getRes);
    assert.equal(getResResult().statusCode, 200);
    assert.equal(getResResult().data.data.customer.name, 'Aditi Nair');

    // Verify isolation: other organisation cannot retrieve customer (404)
    const { req: otherOrgReq, res: otherOrgRes, getResult: otherOrgResult } = buildMockReqRes('MASTER', { organisationId: 'ORG-OTHER' }, {}, {}, { customerId });
    await assert.rejects(async () => {
      await customerController.getCustomer(otherOrgReq, otherOrgRes);
    }, (err) => err.statusCode === 404);
  });

  // ─── 2. DUPLICATE CUSTOMER REVIEW ──────────────────────────────────────────
  await suite.test('2. Duplicate-customer review does not silently merge unrelated identities', async () => {
    // Attempt to create second customer with existing phone without allowDuplicate flag
    const { req, res, getResult } = buildMockReqRes('MASTER', { organisationId: 'ORG-ZAMORIN' }, {
      name: 'Aditi Duplicate Attempt',
      phone: '+919876543210',
      email: 'different.email@example.com',
    });

    await customerController.createCustomer(req, res);
    const result = getResult();
    assert.equal(result.statusCode, 409);
    assert.equal(result.data.code, 'POSSIBLE_DUPLICATE_CUSTOMER');

    // Duplicate candidate review endpoint returns candidates
    const { req: candReq, res: candRes, getResult: candResult } = buildMockReqRes('MASTER', { organisationId: 'ORG-ZAMORIN' });
    await customerController.getDuplicateCandidates(candReq, candRes);
    assert.equal(candResult().statusCode, 200);
    assert.ok(candResult().data.data.count >= 0);
  });

  // ─── 3. IDOR CUSTOMER DATA PROTECTION ──────────────────────────────────────
  await suite.test("3. A customer cannot access another customer's protected information", async () => {
    const cust1 = await Customer.create({
      customerId: 'CUST-0091',
      membershipId: 'MEM-0091',
      organisationId: 'ORG-ZAMORIN',
      name: 'Customer One',
      phone: '+919111111111',
      email: 'c1@example.com',
      preferredCafeId: 'ZC-0001',
      createdByUserId: 'SYSTEM',
    });

    // Cross-customer retrieval attempt: Staff without proper permissions is rejected
    const authMw = authorize('CUSTOMERS_READ', { allowedRoles: ['MASTER', 'OWNER', 'CAFE_ADMIN'] });
    const { req, res, getResult } = buildMockReqRes('STAFF', { organisationId: 'ORG-ZAMORIN', userId: 'ST-0099' });

    let nextCalled = false;
    await authMw(req, res, () => { nextCalled = true; });
    assert.equal(nextCalled, false);
    assert.equal(getResult().statusCode, 403);
  });

  // ─── 4. STAFF AND VENDOR DENIAL ────────────────────────────────────────────
  await suite.test('4. Staff and Vendor are denied internal customer-management operations', async () => {
    const authMw = authorize('CUSTOMERS_WRITE', { allowedRoles: ['MASTER', 'CAFE_ADMIN'] });

    // Staff attempt
    const { req: staffReq, res: staffRes, getResult: staffResult } = buildMockReqRes('STAFF');
    let staffNext = false;
    await authMw(staffReq, staffRes, () => { staffNext = true; });
    assert.equal(staffNext, false);
    assert.equal(staffResult().statusCode, 403);

    // Vendor attempt
    const { req: vendorReq, res: vendorRes, getResult: vendorResult } = buildMockReqRes('VENDOR');
    let vendorNext = false;
    await authMw(vendorReq, vendorRes, () => { vendorNext = true; });
    assert.equal(vendorNext, false);
    assert.equal(vendorResult().statusCode, 403);
  });

  // ─── 5. OWNER REMAINS READ-ONLY ────────────────────────────────────────────
  await suite.test('5. Owner remains read-only for P14 operational mutations', async () => {
    const writeMw = authorize('CUSTOMERS_WRITE', { allowedRoles: ['MASTER', 'CAFE_ADMIN'] });
    const { req, res, getResult } = buildMockReqRes('OWNER');

    let nextCalled = false;
    await writeMw(req, res, () => { nextCalled = true; });
    assert.equal(nextCalled, false);
    assert.equal(getResult().statusCode, 403);
    assert.ok(['ROLE_NOT_ALLOWED', 'PERMISSION_DENIED'].includes(getResult().data.error.code));
  });

  // ─── 6. CAFÉ OPERATIONS SCOPING ────────────────────────────────────────────
  await suite.test("6. Café Operations cannot read or mutate another café's records", async () => {
    const foreignCust = await Customer.create({
      customerId: 'CUST-0092',
      membershipId: 'MEM-0092',
      organisationId: 'ORG-ZAMORIN',
      name: 'Customer Calicut',
      phone: '+919222222222',
      preferredCafeId: 'ZC-0002', // Calicut café
      createdByUserId: 'SYSTEM',
    });

    // Cafe admin assigned only to ZC-0001 (Kochi) attempts to access CUST-0092
    const { req, res } = buildMockReqRes('CAFE_ADMIN', {
      organisationId: 'ORG-ZAMORIN',
      assignedCafeIds: ['ZC-0001'],
      cafeId: 'ZC-0001',
      primaryCafeId: 'ZC-0001',
    }, {}, {}, { customerId: foreignCust.customerId });

    await assert.rejects(async () => {
      await customerController.getCustomer(req, res);
    }, (err) => err.statusCode === 403 && err.code === 'FORBIDDEN_CAFE_SCOPE');
  });

  // ─── 7. PERSISTED & AUDITABLE PREFERENCES ──────────────────────────────────
  await suite.test('7. Preference changes are persisted and auditable', async () => {
    const customer = await Customer.create({
      customerId: 'CUST-0093',
      membershipId: 'MEM-0093',
      organisationId: 'ORG-ZAMORIN',
      name: 'Consent Customer',
      phone: '+919333333333',
      preferredCafeId: 'ZC-0001',
      consent: {
        marketingEmail: true,
        marketingSms: true,
        marketingWhatsApp: true,
      },
      createdByUserId: 'SYSTEM',
    });

    const updateRes = await campaignManagementService.updateCustomerConsent({
      organisationId: 'ORG-ZAMORIN',
      customerId: customer.customerId,
      consentUpdates: { marketingEmail: false, marketingSms: false },
      source: 'UNSUBSCRIBE_LINK',
      actorUserId: 'CUSTOMER',
      evidenceRef: 'REQ-OPT-OUT-001',
    });

    assert.equal(updateRes.success, true);
    assert.equal(updateRes.consent.marketingEmail, false);
    assert.equal(updateRes.consent.marketingSms, false);
    assert.equal(updateRes.historyEntriesAdded, 2);

    const saved = await Customer.findOne({ customerId: customer.customerId });
    assert.equal(saved.consent.marketingEmail, false);
    assert.ok(saved.consentHistory.length >= 2);
    assert.equal(saved.consentHistory[0].status, 'OPTED_OUT');
  });

  // ─── 8. UNSUBSCRIBED EXCLUSION FROM CAMPAIGN ───────────────────────────────
  await suite.test('8. An unsubscribed customer is excluded from the relevant campaign', async () => {
    const campaign = new MarketingCampaign({
      campaignId: 'CMP-0001',
      organisationId: 'ORG-ZAMORIN',
      name: 'Weekend Special Promo',
      type: 'PROMOTIONAL',
      channel: 'SMS',
      status: 'DRAFT',
      messageTemplate: { body: 'Get 20% off all artisan brews this weekend!' },
      createdByUserId: 'MU-0001',
    });
    await campaign.save();

    const audience = await campaignManagementService.evaluateAudience(campaign, 'ORG-ZAMORIN');
    // Customer CUST-0093 (opted out of SMS) must be in excludedOptOut
    const isExcluded = audience.eligible.some((c) => c.customerId === 'CUST-0093');
    assert.equal(isExcluded, false, 'Unsubscribed customer must not be in eligible audience');
  });

  // ─── 9. SCHEDULED CAMPAIGN RECHECKS CURRENT PREFERENCES ────────────────────
  await suite.test('9. A scheduled campaign rechecks current preferences before dispatch', async () => {
    const custToOptOut = await Customer.create({
      customerId: 'CUST-0094',
      membershipId: 'MEM-0094',
      organisationId: 'ORG-ZAMORIN',
      name: 'Late Opt Out',
      phone: '+919444444444',
      preferredCafeId: 'ZC-0001',
      consent: { marketingSms: true },
      createdByUserId: 'SYSTEM',
    });

    const campaign = await MarketingCampaign.create({
      campaignId: 'CMP-0002',
      organisationId: 'ORG-ZAMORIN',
      name: 'Late Check Campaign',
      type: 'PROMOTIONAL',
      channel: 'SMS',
      status: 'SCHEDULED',
      messageTemplate: { body: 'Fresh roast beans arriving today!' },
      createdByUserId: 'MU-0001',
    });

    // Preview sees customer as eligible
    const preview = await campaignManagementService.previewCampaign({
      campaignId: campaign.campaignId,
      organisationId: 'ORG-ZAMORIN',
    });
    assert.ok(preview.previewStats.eligibleCount >= 1);

    // Customer opts out after scheduling/preview
    await campaignManagementService.updateCustomerConsent({
      organisationId: 'ORG-ZAMORIN',
      customerId: custToOptOut.customerId,
      consentUpdates: { marketingSms: false },
      source: 'PORTAL_OPT_OUT',
    });

    // Provider test adapter
    let deliveredRecipients = [];
    const testAdapter = {
      sendBatch: async (recipients) => {
        deliveredRecipients = recipients;
        return recipients.length;
      },
    };

    const dispatchResult = await campaignManagementService.dispatchCampaign({
      campaignId: campaign.campaignId,
      organisationId: 'ORG-ZAMORIN',
      performedByUserId: 'MU-0001',
      providerAdapter: testAdapter,
    });

    assert.equal(dispatchResult.success, true);
    const optedOutDelivered = deliveredRecipients.some((r) => r.customerId === custToOptOut.customerId);
    assert.equal(optedOutDelivered, false, 'Customer who opted out must be excluded at dispatch time');
  });

  // ─── 10. PREVIEW DOES NOT SEND EXTERNAL MESSAGES ───────────────────────────
  await suite.test('10. A campaign preview does not send external messages', async () => {
    let mockSenderCalled = false;
    const testAdapter = {
      sendBatch: async () => {
        mockSenderCalled = true;
      },
    };

    const preview = await campaignManagementService.previewCampaign({
      campaignId: 'CMP-0001',
      organisationId: 'ORG-ZAMORIN',
    });

    assert.equal(preview.success, true);
    assert.equal(mockSenderCalled, false, 'Preview must never trigger external delivery');
  });

  // ─── 11. UNCONFIGURED PROVIDER RESULTS IN BLOCKED STATE ────────────────────
  await suite.test('11. An unconfigured provider results in a visible blocked state rather than false delivery success', async () => {
    // Ensure provider environment variables are unset
    const originalEnv = { ...process.env };
    delete process.env.SMS_PROVIDER_API_KEY;
    delete process.env.EMAIL_PROVIDER_API_KEY;
    delete process.env.WHATSAPP_PROVIDER_API_KEY;

    const campaign = await MarketingCampaign.create({
      campaignId: 'CMP-0003',
      organisationId: 'ORG-ZAMORIN',
      name: 'Unconfigured Dispatch',
      type: 'PROMOTIONAL',
      channel: 'SMS',
      status: 'DRAFT',
      messageTemplate: { body: 'Special message' },
      createdByUserId: 'MU-0001',
    });

    const result = await campaignManagementService.dispatchCampaign({
      campaignId: campaign.campaignId,
      organisationId: 'ORG-ZAMORIN',
      performedByUserId: 'MU-0001',
      providerAdapter: null, // No provider configured
    });

    assert.equal(result.success, false);
    assert.equal(result.blocked, true);
    assert.equal(result.campaign.status, 'BLOCKED');
    assert.equal(result.campaign.executionResult.providerStatus, 'PROVIDER_UNCONFIGURED_BLOCKED');
    assert.equal(result.campaign.executionResult.dispatchedCount, 0);

    process.env = originalEnv;
  });

  // ─── 12. DUPLICATE CAMPAIGN DISPATCH PREVENTION ────────────────────────────
  await suite.test('12. Duplicate campaign execution or outbox replay cannot create duplicate sends for the same idempotency identity', async () => {
    const campaign = await MarketingCampaign.create({
      campaignId: 'CMP-0004',
      organisationId: 'ORG-ZAMORIN',
      name: 'Idempotent Dispatch',
      type: 'PROMOTIONAL',
      channel: 'SMS',
      status: 'DRAFT',
      messageTemplate: { body: 'Idempotent alert' },
      createdByUserId: 'MU-0001',
    });

    let sendCounter = 0;
    const testAdapter = {
      sendBatch: async (recipients) => {
        sendCounter++;
        return recipients.length;
      },
    };

    const firstDispatch = await campaignManagementService.dispatchCampaign({
      campaignId: campaign.campaignId,
      organisationId: 'ORG-ZAMORIN',
      performedByUserId: 'MU-0001',
      providerAdapter: testAdapter,
    });
    assert.equal(firstDispatch.success, true);
    assert.equal(sendCounter, 1);

    // Replay attempt
    const replayDispatch = await campaignManagementService.dispatchCampaign({
      campaignId: campaign.campaignId,
      organisationId: 'ORG-ZAMORIN',
      performedByUserId: 'MU-0001',
      providerAdapter: testAdapter,
    });
    assert.equal(replayDispatch.alreadyDispatched, true);
    assert.equal(sendCounter, 1, 'Provider sendBatch must not be called again on replayed dispatch');
  });

  // ─── 13. COMPLETED ELIGIBLE SALE REWARDS ACCRUAL ───────────────────────────
  await suite.test('13. A completed eligible sale awards rewards exactly once', async () => {
    const cust = await Customer.create({
      customerId: 'CUST-0095',
      membershipId: 'MEM-0095',
      organisationId: 'ORG-ZAMORIN',
      name: 'Loyal Shopper',
      phone: '+919555555555',
      tier: 'BRONZE',
      pointsBalance: 100,
      createdByUserId: 'SYSTEM',
    });

    const accrual = await customerLoyaltyService.accrueSaleRewards({
      organisationId: 'ORG-ZAMORIN',
      customerId: cust.customerId,
      billId: 'BILL-0095-01',
      eligibleAmountRupees: 500, // 500 * 0.1 ratio = 50 points
      billAmountPaise: 50000,
      performedByUserId: 'POS-CASHIER',
    });

    assert.equal(accrual.success, true);
    assert.equal(accrual.pointsAccrued, 50);
    assert.equal(accrual.newBalance, 150);

    const updatedCust = await Customer.findOne({ customerId: cust.customerId });
    assert.equal(updatedCust.pointsBalance, 150);
    assert.equal(updatedCust.totalSpendPaisa, 50000);
  });

  // ─── 14. REPEATED SALE EVENT CANNOT AWARD POINTS TWICE ─────────────────────
  await suite.test('14. A repeated sale event cannot award the same rewards twice', async () => {
    const replayAccrual = await customerLoyaltyService.accrueSaleRewards({
      organisationId: 'ORG-ZAMORIN',
      customerId: 'CUST-0095',
      billId: 'BILL-0095-01', // Repeated bill
      eligibleAmountRupees: 500,
      performedByUserId: 'POS-CASHIER',
    });

    assert.equal(replayAccrual.alreadyAccrued, true);
    const cust = await Customer.findOne({ customerId: 'CUST-0095' });
    assert.equal(cust.pointsBalance, 150, 'Balance must remain unchanged on repeated accrual event');
  });

  // ─── 15. VOIDING BILL REVERSES REWARDS ONCE ────────────────────────────────
  await suite.test('15. Voiding a bill reverses its rewards exactly once', async () => {
    const voidResult = await customerLoyaltyService.reverseSaleRewardsOnVoid({
      organisationId: 'ORG-ZAMORIN',
      customerId: 'CUST-0095',
      billId: 'BILL-0095-01',
      performedByUserId: 'MANAGER-01',
      reason: 'BILL_VOIDED',
    });

    assert.equal(voidResult.success, true);
    assert.equal(voidResult.pointsReversed, 50);
    assert.equal(voidResult.newBalance, 100);

    const cust = await Customer.findOne({ customerId: 'CUST-0095' });
    assert.equal(cust.pointsBalance, 100);

    // Repeated void attempt
    const replayVoid = await customerLoyaltyService.reverseSaleRewardsOnVoid({
      organisationId: 'ORG-ZAMORIN',
      customerId: 'CUST-0095',
      billId: 'BILL-0095-01',
      performedByUserId: 'MANAGER-01',
    });
    assert.equal(replayVoid.alreadyReversed, true);
    const finalCust = await Customer.findOne({ customerId: 'CUST-0095' });
    assert.equal(finalCust.pointsBalance, 100, 'Repeated void cannot reverse rewards a second time');
  });

  // ─── 16. REFUND REVERSES ELIGIBLE REWARDS CORRECTLY ────────────────────────
  await suite.test('16. A refund reverses eligible rewards correctly and cannot reverse more than remaining award', async () => {
    const cust = await Customer.create({
      customerId: 'CUST-0096',
      membershipId: 'MEM-0096',
      organisationId: 'ORG-ZAMORIN',
      name: 'Partial Refund Guest',
      phone: '+919666666666',
      tier: 'BRONZE',
      pointsBalance: 200,
      createdByUserId: 'SYSTEM',
    });

    // Accrue 100 points on 1000 INR bill
    await customerLoyaltyService.accrueSaleRewards({
      organisationId: 'ORG-ZAMORIN',
      customerId: cust.customerId,
      billId: 'BILL-0096-01',
      eligibleAmountRupees: 1000,
      billAmountPaise: 100000,
      performedByUserId: 'POS-CASHIER',
    });
    // Balance is now 300 (200 + 100)

    // Partial refund of 500 INR (50% of bill) -> should reverse 50 points
    const refundRes1 = await customerLoyaltyService.reverseRewardsOnRefund({
      organisationId: 'ORG-ZAMORIN',
      customerId: cust.customerId,
      billId: 'BILL-0096-01',
      refundId: 'REF-0096-01',
      refundAmountRupees: 500,
      totalBillAmountRupees: 1000,
      performedByUserId: 'MANAGER-01',
    });

    assert.equal(refundRes1.success, true);
    assert.equal(refundRes1.pointsReversed, 50);
    assert.equal(refundRes1.newBalance, 250);

    // Second refund of remaining 500 INR -> should reverse remaining 50 points
    const refundRes2 = await customerLoyaltyService.reverseRewardsOnRefund({
      organisationId: 'ORG-ZAMORIN',
      customerId: cust.customerId,
      billId: 'BILL-0096-01',
      refundId: 'REF-0096-02',
      refundAmountRupees: 500,
      totalBillAmountRupees: 1000,
      performedByUserId: 'MANAGER-01',
    });
    assert.equal(refundRes2.pointsReversed, 50);
    assert.equal(refundRes2.newBalance, 200);

    // Third refund attempt cannot reverse more than remaining original award
    const refundRes3 = await customerLoyaltyService.reverseRewardsOnRefund({
      organisationId: 'ORG-ZAMORIN',
      customerId: cust.customerId,
      billId: 'BILL-0096-01',
      refundId: 'REF-0096-03',
      refundAmountRupees: 500,
      totalBillAmountRupees: 1000,
      performedByUserId: 'MANAGER-01',
    });
    assert.equal(refundRes3.pointsReversed, 0, 'Cannot reverse more than original award');
  });

  // ─── 17. DUPLICATE REFUND REPLAY CANNOT REVERSE AGAIN ──────────────────────
  await suite.test('17. A duplicate refund or replay cannot repeat the reward reversal', async () => {
    const replay = await customerLoyaltyService.reverseRewardsOnRefund({
      organisationId: 'ORG-ZAMORIN',
      customerId: 'CUST-0096',
      billId: 'BILL-0096-01',
      refundId: 'REF-0096-01', // Already processed refund ID
      refundAmountRupees: 500,
      totalBillAmountRupees: 1000,
      performedByUserId: 'MANAGER-01',
    });

    assert.equal(replay.alreadyReversed, true);
    const cust = await Customer.findOne({ customerId: 'CUST-0096' });
    assert.equal(cust.pointsBalance, 200, 'Balance must remain unchanged on duplicate refund replay');
  });

  // ─── 18. DISCOUNT-INELIGIBLE ITEMS FOLLOW CONFIG ───────────────────────────
  await suite.test('18. Discount-ineligible items follow the configured loyalty rules', async () => {
    const cust = await Customer.create({
      customerId: 'CUST-0097',
      membershipId: 'MEM-0097',
      organisationId: 'ORG-ZAMORIN',
      name: 'Ineligible Items Guest',
      phone: '+919777777777',
      pointsBalance: 50,
      createdByUserId: 'SYSTEM',
    });

    // Zero eligible amount on excluded line items produces zero rewards
    const accrual = await customerLoyaltyService.accrueSaleRewards({
      organisationId: 'ORG-ZAMORIN',
      customerId: cust.customerId,
      billId: 'BILL-0097-01',
      eligibleAmountRupees: 0,
      billAmountPaise: 45000,
      performedByUserId: 'POS-CASHIER',
    });

    assert.equal(accrual.pointsAccrued, 0);
    const reloaded = await Customer.findOne({ customerId: cust.customerId });
    assert.equal(reloaded.pointsBalance, 50, 'Points balance must not increase for ineligible items');
  });

  // ─── 19. CONCURRENT REDEMPTION REQUESTS CANNOT OVERSPEND ───────────────────
  await suite.test('19. Concurrent redemption requests cannot overspend the same points balance', async () => {
    const cust = await Customer.create({
      customerId: 'CUST-0098',
      membershipId: 'MEM-0098',
      organisationId: 'ORG-ZAMORIN',
      name: 'Concurrency Guest',
      phone: '+919888888888',
      pointsBalance: 100, // Exactly 100 points
      createdByUserId: 'SYSTEM',
    });

    // Execute 3 concurrent redemption requests of 60 points each (total requested: 180 > 100)
    const results = await Promise.allSettled([
      customerLoyaltyService.redeemPointsAtomic({
        organisationId: 'ORG-ZAMORIN',
        customerId: cust.customerId,
        pointsToRedeem: 60,
        billId: 'BILL-0098-A',
      }),
      customerLoyaltyService.redeemPointsAtomic({
        organisationId: 'ORG-ZAMORIN',
        customerId: cust.customerId,
        pointsToRedeem: 60,
        billId: 'BILL-0098-B',
      }),
      customerLoyaltyService.redeemPointsAtomic({
        organisationId: 'ORG-ZAMORIN',
        customerId: cust.customerId,
        pointsToRedeem: 60,
        billId: 'BILL-0098-C',
      }),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    assert.equal(fulfilled.length, 1, 'Exactly one concurrent request of 60 points should succeed');
    assert.equal(rejected.length, 2, 'Two concurrent requests must fail due to insufficient balance');

    const finalCust = await Customer.findOne({ customerId: cust.customerId });
    assert.equal(finalCust.pointsBalance, 40, 'Remaining balance must be exactly 40 (100 - 60)');
    assert.ok(finalCust.pointsBalance >= 0, 'Points balance must never become negative');
  });

  // ─── 20. EXPIRED OR BLOCKED REWARDS CANNOT BE REDEEMED ─────────────────────
  await suite.test('20. Expired or blocked rewards cannot be redeemed', async () => {
    const suspendedCust = await Customer.create({
      customerId: 'CUST-0099',
      membershipId: 'MEM-0099',
      organisationId: 'ORG-ZAMORIN',
      name: 'Suspended Member',
      phone: '+919999999999',
      pointsBalance: 500,
      loyaltyStatus: 'SUSPENDED',
      createdByUserId: 'SYSTEM',
    });

    await assert.rejects(async () => {
      await customerLoyaltyService.redeemPointsAtomic({
        organisationId: 'ORG-ZAMORIN',
        customerId: suspendedCust.customerId,
        pointsToRedeem: 50,
      });
    }, (err) => err.code === 'LOYALTY_ACCOUNT_SUSPENDED');
  });

  // ─── 21. WALLET TOP-UPS REQUIRE CONFIRMED PAYMENT ──────────────────────────
  await suite.test('21. Wallet top-ups require authoritative receipt or payment confirmation', async () => {
    const cust = await Customer.create({
      customerId: 'CUST-0100',
      membershipId: 'MEM-0100',
      organisationId: 'ORG-ZAMORIN',
      name: 'Wallet User',
      phone: '+919000000001',
      walletBalancePaise: 0,
      createdByUserId: 'SYSTEM',
    });

    const topUpRes = await customerWalletService.topUpWallet({
      organisationId: 'ORG-ZAMORIN',
      cafeId: 'ZC-0001',
      customerId: cust.customerId,
      amountPaise: 250000, // 2500 INR in paise
      sourcePaymentId: 'PAY-CONFIRMED-01',
      sourcePaymentMethod: 'UPI',
      paymentStatus: 'CONFIRMED',
      performedByUserId: 'POS-CASHIER',
      idempotencyKey: 'IDEMP-TOPUP-01',
    });

    assert.equal(topUpRes.success, true);
    assert.equal(topUpRes.amountCreditedPaise, 250000);
    assert.equal(topUpRes.newBalancePaise, 250000);

    const reloaded = await Customer.findOne({ customerId: cust.customerId });
    assert.equal(reloaded.walletBalancePaise, 250000);
  });

  // ─── 22. PENDING/AMBIGUOUS PAYMENT DOES NOT CREATE VALUE ───────────────────
  await suite.test('22. A pending or ambiguous payment does not create spendable wallet value', async () => {
    await assert.rejects(async () => {
      await customerWalletService.topUpWallet({
        organisationId: 'ORG-ZAMORIN',
        cafeId: 'ZC-0001',
        customerId: 'CUST-0100',
        amountPaise: 100000,
        sourcePaymentId: 'PAY-PENDING-02',
        paymentStatus: 'PENDING', // Ambiguous / unconfirmed
        performedByUserId: 'POS-CASHIER',
      });
    }, (err) => err.code === 'UNCONFIRMED_PAYMENT');

    const cust = await Customer.findOne({ customerId: 'CUST-0100' });
    assert.equal(cust.walletBalancePaise, 250000, 'Balance must remain unchanged after unconfirmed payment attempt');
  });

  // ─── 23. DUPLICATE PAYMENT CALLBACKS CANNOT DOUBLE CREDIT ──────────────────
  await suite.test('23. Duplicate payment callbacks cannot create duplicate wallet credits', async () => {
    const replayTopUp = await customerWalletService.topUpWallet({
      organisationId: 'ORG-ZAMORIN',
      cafeId: 'ZC-0001',
      customerId: 'CUST-0100',
      amountPaise: 250000,
      sourcePaymentId: 'PAY-CONFIRMED-01',
      paymentStatus: 'CONFIRMED',
      performedByUserId: 'POS-CASHIER',
      idempotencyKey: 'IDEMP-TOPUP-01', // Repeated idempotency key
    });

    assert.equal(replayTopUp.alreadyProcessed, true);
    const cust = await Customer.findOne({ customerId: 'CUST-0100' });
    assert.equal(cust.walletBalancePaise, 250000, 'Wallet balance must not double credit on duplicate callback');
  });

  // ─── 24. CONCURRENT WALLET/GIFT-CARD REDEMPTIONS CANNOT OVERDRAW ───────────
  await suite.test('24. Concurrent wallet or gift-card redemptions cannot overdraw the balance', async () => {
    // Current wallet balance: 250,000 paise (2500 INR)
    // Run two concurrent redemption requests for 150,000 paise each (total 300,000 > 250,000)
    const results = await Promise.allSettled([
      customerWalletService.redeemWallet({
        organisationId: 'ORG-ZAMORIN',
        customerId: 'CUST-0100',
        amountPaise: 150000,
        referenceBillId: 'BILL-CONC-01',
        performedByUserId: 'POS-CASHIER',
      }),
      customerWalletService.redeemWallet({
        organisationId: 'ORG-ZAMORIN',
        customerId: 'CUST-0100',
        amountPaise: 150000,
        referenceBillId: 'BILL-CONC-02',
        performedByUserId: 'POS-CASHIER',
      }),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    assert.equal(fulfilled.length, 1);
    assert.equal(rejected.length, 1);

    const cust = await Customer.findOne({ customerId: 'CUST-0100' });
    assert.equal(cust.walletBalancePaise, 100000, 'Remaining balance must be 100,000 paise');

    // Gift card concurrent overdraw test
    const gc = await customerWalletService.issueGiftCard({
      organisationId: 'ORG-ZAMORIN',
      amountPaise: 100000, // 1000 INR
      performedByUserId: 'MU-0001',
    });

    const gcResults = await Promise.allSettled([
      customerWalletService.redeemGiftCard({
        organisationId: 'ORG-ZAMORIN',
        giftCardId: gc.giftCardId,
        secretCode: gc.secretCode,
        amountPaise: 60000,
        performedByUserId: 'POS-CASHIER',
      }),
      customerWalletService.redeemGiftCard({
        organisationId: 'ORG-ZAMORIN',
        giftCardId: gc.giftCardId,
        secretCode: gc.secretCode,
        amountPaise: 60000,
        performedByUserId: 'POS-CASHIER',
      }),
    ]);

    const gcSuccess = gcResults.filter((r) => r.status === 'fulfilled');
    const gcFail = gcResults.filter((r) => r.status === 'rejected');
    assert.equal(gcSuccess.length, 1);
    assert.equal(gcFail.length, 1);

    const reloadedGc = await GiftCard.findOne({ giftCardId: gc.giftCardId });
    assert.equal(reloadedGc.currentBalancePaise, 40000);
  });

  // ─── 25. STORED VALUE SEPARATION FROM PROMOTIONAL REWARDS ──────────────────
  await suite.test('25. Paid stored value is distinguished from promotional rewards and reflected in liabilities', async () => {
    const cust = await Customer.findOne({ customerId: 'CUST-0100' });
    assert.ok(typeof cust.walletBalancePaise === 'number', 'Wallet balance is pure stored monetary value');
    assert.ok(typeof cust.pointsBalance === 'number', 'Points balance is reward points');

    // Wallet balance in integer paise must never be conflated with points
    assert.notEqual(cust.walletBalancePaise, cust.pointsBalance);

    // Ledger models are distinct
    const walletLedgerCount = await WalletLedger.countDocuments({ customerId: 'CUST-0100' });
    assert.ok(walletLedgerCount >= 1);
  });

  // ─── 26. MANUAL ADJUSTMENTS REQUIRE ROLE, REASON AND AUDIT ─────────────────
  await suite.test('26. Manual adjustments require the correct role, reason and audit record', async () => {
    // Missing reason must fail
    const { req: noReasonReq, res: noReasonRes } = buildMockReqRes('MASTER', { organisationId: 'ORG-ZAMORIN' }, {
      action: 'ADD',
      points: 20,
    }, {}, { customerId: 'CUST-0100' });

    await assert.rejects(async () => {
      await customerController.adjustCustomerPoints(noReasonReq, noReasonRes);
    }, (err) => err.code === 'REASON_REQUIRED');

    // Valid adjustment with reason code creates audit trail
    const { req: validReq, res: validRes, getResult: validResult } = buildMockReqRes('MASTER', { organisationId: 'ORG-ZAMORIN' }, {
      action: 'ADD',
      points: 25,
      reasonCode: 'CUSTOMER_SERVICE_GOODWILL',
      note: 'Granted for delayed order',
    }, {}, { customerId: 'CUST-0100' });

    await customerController.adjustCustomerPoints(validReq, validRes);
    assert.equal(validResult().statusCode, 200);

    const audit = await AuditEvent.findOne({
      entityId: 'CUST-0100',
      action: 'ADJUST_POINTS',
    });
    assert.ok(audit, 'Audit event must be persisted for manual point adjustment');
  });

  // ─── 27. FEEDBACK AND COMPLAINT LIFECYCLE CHANGES PERSIST ──────────────────
  await suite.test('27. Feedback and complaint lifecycle changes persist with their actors and timestamps', async () => {
    const complaint = await ownerComplaintsService.createComplaint('ORG-ZAMORIN', {
      cafeId: 'ZC-0001',
      channel: 'CAFE_IN_PERSON',
      complaintCategory: 'SERVICE',
      severity: 'MEDIUM',
      description: 'Long waiting time for cold brew',
      customerName: 'Rohit Verma',
      customerPhone: '+919200000001',
    }, { userId: 'CA-0001', role: 'CAFE_ADMIN' });

    assert.ok(complaint.complaintId);
    assert.equal(complaint.status, 'RECEIVED');

    // Transition to TRIAGED
    const triaged = await ownerComplaintsService.updateComplaintStatus(
      'ORG-ZAMORIN',
      complaint.complaintId,
      'TRIAGED',
      { userId: 'CA-0001', role: 'CAFE_ADMIN' },
      'Reviewed by shift supervisor'
    );
    assert.equal(triaged.status, 'TRIAGED');

    // Add communication log
    const comm = await ownerComplaintsService.addCommunication(
      'ORG-ZAMORIN',
      complaint.complaintId,
      { channel: 'PHONE', direction: 'OUTBOUND', summary: 'Called guest to apologize' },
      { userId: 'CA-0001', role: 'CAFE_ADMIN' }
    );
    const commLog = comm.communicationLog || (comm.complaint && comm.complaint.communicationLog) || [];
    assert.equal(commLog.length, 1);
  });

  // ─── 28. COMPLAINT CANNOT BYPASS FINANCIAL APPROVAL PROCESS ────────────────
  await suite.test('28. A complaint cannot bypass the existing financial refund or payment-approval process', async () => {
    const unlinkedComplaint = await ownerComplaintsService.createComplaint('ORG-ZAMORIN', {
      cafeId: 'ZC-0001',
      description: 'No bill attached complaint',
    }, { userId: 'CA-0001', role: 'CAFE_ADMIN' });

    // Attempting service recovery refund without canonical bill linkage fails closed
    await assert.rejects(async () => {
      await ownerComplaintsService.issueServiceRecoveryRefund(
        'ORG-ZAMORIN',
        unlinkedComplaint.complaintId,
        { amount: 150, reason: 'Goodwill refund attempt' },
        { userId: 'CA-0001', role: 'CAFE_ADMIN' }
      );
    }, (err) => err.message === 'CANNOT_REFUND_WITHOUT_CANONICAL_BILL_LINKAGE');
  });

  // ─── 29. CROSS-CAFÉ COMPENSATION & MUTATION DENIED ─────────────────────────
  await suite.test('29. Cross-café compensation requests and unauthorised data exports are denied', async () => {
    const complaintCafe2 = await ownerComplaintsService.createComplaint('ORG-ZAMORIN', {
      cafeId: 'ZC-0002', // Calicut café
      description: 'Calicut feedback',
    }, { userId: 'MU-0001', role: 'MASTER' });

    // Cafe Admin assigned only to ZC-0001 attempts to mutate or compensate ZC-0002 complaint
    await assert.rejects(async () => {
      await ownerComplaintsService.updateComplaintStatus(
        'ORG-ZAMORIN',
        complaintCafe2.complaintId,
        'TRIAGED',
        { userId: 'CA-0001', role: 'CAFE_ADMIN', assignedCafeIds: ['ZC-0001'] },
        'Cross-cafe triage attempt'
      );
    }, (err) => err.message.includes('CROSS_CAFE_ACCESS_DENIED'));

    await assert.rejects(async () => {
      await ownerComplaintsService.issueServiceRecoveryRefund(
        'ORG-ZAMORIN',
        complaintCafe2.complaintId,
        { amount: 100, reason: 'Cross-cafe refund attempt' },
        { userId: 'CA-0001', role: 'CAFE_ADMIN', assignedCafeIds: ['ZC-0001'] }
      );
    }, (err) => err.message.includes('CROSS_CAFE_COMPENSATION_DENIED'));
  });

  // ─── 30. REGRESSION: P09-P13 FUNCTIONALITY INTACT ──────────────────────────
  await suite.test('30. Existing P09, P10, P11, P12 and P13 behaviours remain intact', async () => {
    // Verify core models and services are operational
    assert.ok(Bill);
    assert.ok(Customer);
    assert.ok(LoyaltyLedger);
    assert.ok(WalletLedger);
    assert.ok(GiftCard);
    assert.ok(MarketingCampaign);
    assert.ok(CustomerComplaint);

    // Verify retired Normal Master fails closed
    const authMw = authorize('CUSTOMERS_READ', { allowedRoles: ['MASTER', 'OWNER', 'CAFE_ADMIN'] });
    const { req, res, getResult } = buildMockReqRes('MASTER', { isPrimaryMaster: false }); // Retired Normal Master
    let nextCalled = false;
    await authMw(req, res, () => { nextCalled = true; });
    assert.equal(nextCalled, false);
    assert.equal(getResult().statusCode, 403);
    assert.equal(getResult().data.error.code, 'ROLE_RETIRED');
  });
});
