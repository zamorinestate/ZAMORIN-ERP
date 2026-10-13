'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  maskCustomerPhone,
  requestCustomerOtp,
  verifyCustomerOtp,
  verifyCustomerAuthorizationToken,
} = require('../src/services/customerProtectionService');

const {
  evaluateCustomerTier,
  STANDARD_LOYALTY_SLABS,
  accrueSaleRewards,
  redeemPointsAtomic,
  expireCustomerPoints,
} = require('../src/services/customerLoyaltyService');

const {
  topUpWallet,
  redeemWallet,
  expireCustomerPromotionalBalances,
} = require('../src/services/customerWalletService');

const { Customer } = require('../src/models/Customer');
const { LoyaltyLedger } = require('../src/models/LoyaltyLedger');
const { LoyaltyProgramme } = require('../src/models/LoyaltyProgramme');
const { WalletLedger } = require('../src/models/WalletLedger');
const { GuestVerificationChallenge } = require('../src/models/GuestVerificationChallenge');
const { SequenceCounter } = require('../src/models/SequenceCounter');

test('Phase P24: Customer Data Protection & Loyalty Program Suite', async (t) => {
  const orgId = 'ORG-P24-TEST';
  const cafeId = 'ZC-0001';

  // ---------------------------------------------------------------------------
  // 1. F065: Customer Phone Masking
  // ---------------------------------------------------------------------------
  await t.test('1. F065: Non-executive role sees masked phone while executive sees full phone', () => {
    const rawPhone = '+919876543210';
    const rawLocalPhone = '9876543210';

    const cashierMasked = maskCustomerPhone(rawLocalPhone, 'CAFE_ADMIN', false);
    assert.equal(cashierMasked, '******3210', 'Cashier must see first 6 digits masked and last 4 visible');

    const staffMasked = maskCustomerPhone(rawPhone, 'STAFF', false);
    assert.equal(staffMasked, '******3210', 'Staff must see masked phone');

    const masterUnmasked = maskCustomerPhone(rawLocalPhone, 'MASTER', false);
    assert.equal(masterUnmasked, rawLocalPhone, 'MASTER sees full unmasked phone');

    const ownerUnmasked = maskCustomerPhone(rawPhone, 'OWNER', false);
    assert.equal(ownerUnmasked, rawPhone, 'OWNER sees full unmasked phone');

    const otpVerifiedCashier = maskCustomerPhone(rawLocalPhone, 'CAFE_ADMIN', true);
    assert.equal(otpVerifiedCashier, rawLocalPhone, 'Cashier with verified OTP sees unmasked phone');
  });

  // ---------------------------------------------------------------------------
  // 2. F066: Customer OTP Challenge & Authorization Token
  // ---------------------------------------------------------------------------
  await t.test('2. F066: OTP challenge issuance, verification and token generation', async () => {
    const origFindOne = GuestVerificationChallenge.findOne;
    const origSave = GuestVerificationChallenge.prototype.save;

    let savedChallenge = null;
    GuestVerificationChallenge.prototype.save = async function () {
      savedChallenge = this;
      return this;
    };
    GuestVerificationChallenge.findOne = async function (filter) {
      if (savedChallenge && filter.challengeId === savedChallenge.challengeId) {
        return savedChallenge;
      }
      return null;
    };

    try {
      // Step A: Request OTP
      const reqRes = await requestCustomerOtp({
        organisationId: orgId,
        cafeId,
        phone: '9876543210',
      });

      assert.equal(reqRes.success, true);
      assert.ok(reqRes.challengeId);
      assert.ok(reqRes.otp);
      assert.equal(reqRes.otp.length, 6, 'OTP must be 6 digits');
      assert.equal(reqRes.maskedPhone, '******3210');

      // Step B: Invalid OTP rejection
      await assert.rejects(
        async () => {
          await verifyCustomerOtp({
            organisationId: orgId,
            challengeId: reqRes.challengeId,
            otp: '000000',
          });
        },
        (err) => err.code === 'INVALID_OTP' || /Invalid OTP/i.test(err.message),
        'Invalid OTP must be rejected'
      );

      // Step C: Valid OTP verification
      const verifyRes = await verifyCustomerOtp({
        organisationId: orgId,
        challengeId: reqRes.challengeId,
        otp: reqRes.otp,
        customerId: 'CUST-0001',
      });

      assert.equal(verifyRes.success, true);
      assert.equal(verifyRes.verified, true);
      assert.ok(verifyRes.authorizationToken);

      // Step D: Validate token signature and customer association
      const isValid = verifyCustomerAuthorizationToken(verifyRes.authorizationToken, 'CUST-0001');
      assert.equal(isValid, true, 'Authorization token must be valid for target customer');

      const isMismatched = verifyCustomerAuthorizationToken(verifyRes.authorizationToken, 'CUST-9999');
      assert.equal(isMismatched, false, 'Token must not validate for another customer');
    } finally {
      GuestVerificationChallenge.findOne = origFindOne;
      GuestVerificationChallenge.prototype.save = origSave;
    }
  });

  // ---------------------------------------------------------------------------
  // 3. F066: Redemptions > ₹500 or 500 pts Enforce Customer OTP
  // ---------------------------------------------------------------------------
  await t.test('3. F066: High-value redemptions strictly enforce customer OTP authorization', async () => {
    // Loyalty redemptions > 500 points without OTP token
    await assert.rejects(
      async () => {
        await redeemPointsAtomic({
          organisationId: orgId,
          customerId: 'CUST-0001',
          pointsToRedeem: 600,
          userRole: 'CAFE_ADMIN',
          isOtpVerified: false,
          otpAuthorizationToken: null,
        });
      },
      (err) => err.code === 'CUSTOMER_OTP_REQUIRED' || /OTP/i.test(err.message),
      'Redeeming > 500 points without OTP must be rejected'
    );

    // Wallet redemptions > ₹500 (50,000 paise) without OTP token
    await assert.rejects(
      async () => {
        await redeemWallet({
          organisationId: orgId,
          customerId: 'CUST-0001',
          amountPaise: 60000,
          userRole: 'CAFE_ADMIN',
          isOtpVerified: false,
          otpAuthorizationToken: null,
        });
      },
      (err) => err.code === 'CUSTOMER_OTP_REQUIRED' || /OTP/i.test(err.message),
      'Redeeming > ₹500 without OTP must be rejected'
    );
  });

  // ---------------------------------------------------------------------------
  // 4. F067: Dynamic Loyalty Slabs & Tier Progression
  // ---------------------------------------------------------------------------
  await t.test('4. F067: Dynamic Loyalty Slabs determine tier from spend and visit thresholds', () => {
    // Bronze: 0 spend, 0 visits
    assert.equal(evaluateCustomerTier({ totalSpendPaisa: 0, totalVisits: 0 }), 'BRONZE');
    assert.equal(evaluateCustomerTier({ totalSpendPaisa: 200000, totalVisits: 2 }), 'BRONZE');

    // Silver: >= ₹5,000 (500,000 paise) or >= 5 visits
    assert.equal(evaluateCustomerTier({ totalSpendPaisa: 500000, totalVisits: 1 }), 'SILVER');
    assert.equal(evaluateCustomerTier({ totalSpendPaisa: 100000, totalVisits: 5 }), 'SILVER');

    // Gold: >= ₹15,000 (1,500,000 paise) or >= 15 visits
    assert.equal(evaluateCustomerTier({ totalSpendPaisa: 1500000, totalVisits: 2 }), 'GOLD');
    assert.equal(evaluateCustomerTier({ totalSpendPaisa: 200000, totalVisits: 16 }), 'GOLD');

    // Platinum: >= ₹30,000 (3,000,000 paise) or >= 30 visits
    assert.equal(evaluateCustomerTier({ totalSpendPaisa: 3000000, totalVisits: 1 }), 'PLATINUM');
    assert.equal(evaluateCustomerTier({ totalSpendPaisa: 100000, totalVisits: 35 }), 'PLATINUM');
  });

  await t.test('5. F067: Accruing sales rewards triggers tier upgrade and TIER_CHANGED ledger entry', async () => {
    const origFindCust = Customer.findOne;
    const origFindLoyalty = LoyaltyLedger.findOne;
    const origLoyaltySave = LoyaltyLedger.prototype.save;
    const origCustSave = Customer.prototype.save;
    const origGenerateId = SequenceCounter.generateId;

    let mockCustomer = {
      customerId: 'CUST-TIER-01',
      organisationId: orgId,
      status: 'ACTIVE',
      loyaltyStatus: 'ACTIVE',
      pointsBalance: 100,
      totalSpendPaisa: 400000, // ₹4,000 (Bronze)
      totalVisits: 4,
      tier: 'BRONZE',
      save: async function () { return this; },
    };

    const savedLedgers = [];
    LoyaltyLedger.prototype.save = async function () {
      savedLedgers.push(this);
      return this;
    };
    const origLoyaltyProgrammeFindOne = LoyaltyProgramme.findOne;
    Customer.findOne = async () => mockCustomer;
    LoyaltyLedger.findOne = () => ({ lean: async () => null });
    LoyaltyProgramme.findOne = () => ({ sort: () => ({ lean: async () => null }) });
    SequenceCounter.generateId = async () => `LOY-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;

    try {
      // Sale of ₹1,500 (eligibleAmountRupees: 1500), pushing total spend past ₹5,000 (500,000 paise)
      const res = await accrueSaleRewards({
        organisationId: orgId,
        customerId: 'CUST-TIER-01',
        billId: 'BILL-UPGRADE-01',
        eligibleAmountRupees: 1500,
        billAmountPaise: 150000,
      });

      assert.equal(res.success, true);
      assert.equal(res.tier, 'SILVER', 'Customer must dynamically upgrade to SILVER');
      assert.equal(res.tierUpgraded, true);
      assert.ok(res.tierChangeLedger, 'Must log TIER_CHANGED entry');
      assert.equal(res.tierChangeLedger.transactionType, 'TIER_CHANGED');
    } finally {
      Customer.findOne = origFindCust;
      LoyaltyLedger.findOne = origFindLoyalty;
      LoyaltyProgramme.findOne = origLoyaltyProgrammeFindOne;
      LoyaltyLedger.prototype.save = origLoyaltySave;
      Customer.prototype.save = origCustSave;
      SequenceCounter.generateId = origGenerateId;
    }
  });

  // ---------------------------------------------------------------------------
  // 5. F068: Promotional Wallet & Loyalty Points Auto-Expiry
  // ---------------------------------------------------------------------------
  await t.test('6. F068: Promotional wallet balances auto-expire with EXPIRATION ledger entry', async () => {
    const origFindCust = Customer.find;
    const origCustSave = Customer.prototype.save;
    const origWalletSave = WalletLedger.prototype.save;
    const origGenerateId = SequenceCounter.generateId;

    const mockCustomer = {
      customerId: 'CUST-WALLET-EXPIRE',
      organisationId: orgId,
      promotionalWalletBalancePaise: 25000, // ₹250 promotional credit
      walletBalancePaise: 50000, // ₹500 total (₹250 purchased + ₹250 promo)
      save: async function () { return this; },
    };

    const savedWalletLedgers = [];
    WalletLedger.prototype.save = async function () {
      savedWalletLedgers.push(this);
      return this;
    };
    Customer.find = async () => [mockCustomer];
    SequenceCounter.generateId = async () => `WAL-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;

    try {
      const res = await expireCustomerPromotionalBalances({
        organisationId: orgId,
        customerId: 'CUST-WALLET-EXPIRE',
        validityDays: 90,
      });

      assert.equal(res.success, true);
      assert.equal(res.totalExpiredCustomers, 1);
      assert.equal(mockCustomer.promotionalWalletBalancePaise, 0, 'Promotional balance must be zeroed');
      assert.equal(mockCustomer.walletBalancePaise, 25000, 'Total wallet balance reduced by promotional amount');

      assert.equal(savedWalletLedgers.length, 1);
      assert.equal(savedWalletLedgers[0].transactionType, 'EXPIRATION');
      assert.equal(savedWalletLedgers[0].amountPaise, -25000);
    } finally {
      Customer.find = origFindCust;
      Customer.prototype.save = origCustSave;
      WalletLedger.prototype.save = origWalletSave;
      SequenceCounter.generateId = origGenerateId;
    }
  });

  await t.test('7. F068: Lapsed loyalty points auto-expire with POINTS_EXPIRED ledger entry', async () => {
    const origFindCust = Customer.find;
    const origCustSave = Customer.prototype.save;
    const origLoyaltySave = LoyaltyLedger.prototype.save;
    const origGenerateId = SequenceCounter.generateId;

    const mockCustomer = {
      customerId: 'CUST-POINTS-EXPIRE',
      organisationId: orgId,
      pointsBalance: 450,
      lastVisitAt: new Date(Date.now() - 400 * 24 * 60 * 60 * 1000), // 400 days ago (> 365 days)
      save: async function () { return this; },
    };

    const savedLoyaltyLedgers = [];
    LoyaltyLedger.prototype.save = async function () {
      savedLoyaltyLedgers.push(this);
      return this;
    };
    Customer.find = async () => [mockCustomer];
    SequenceCounter.generateId = async () => `LOY-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;

    try {
      const res = await expireCustomerPoints({
        organisationId: orgId,
        customerId: 'CUST-POINTS-EXPIRE',
        validityDays: 365,
      });

      assert.equal(res.success, true);
      assert.equal(res.totalExpiredCustomers, 1);
      assert.equal(mockCustomer.pointsBalance, 0, 'Lapsed points must be zeroed');

      assert.equal(savedLoyaltyLedgers.length, 1);
      assert.equal(savedLoyaltyLedgers[0].transactionType, 'POINTS_EXPIRED');
      assert.equal(savedLoyaltyLedgers[0].pointsDelta, -450);
    } finally {
      Customer.find = origFindCust;
      Customer.prototype.save = origCustSave;
      LoyaltyLedger.prototype.save = origLoyaltySave;
      SequenceCounter.generateId = origGenerateId;
    }
  });
});
