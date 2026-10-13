'use strict';

/**
 * PREPAID SMART CARD SERVICE (F085 FOOD COURT SMART CARD ENGINE)
 *
 * Implements authoritative food court tap-card / RFID wallet engine:
 *   - Card Issue with cardUid and optional refundable security deposit
 *   - Cashier Top-up with multi-tender support
 *   - POS Tap-Debit with strict balance checks (never negative)
 *   - Card Surrender & Balance/Deposit Refund
 *   - Outlet / Organisation unspent float liability reporting
 *
 * All amounts handled in Integer Paise (zero floating-point math).
 */

const { PrepaidSmartCard, SMART_CARD_STATUSES } = require('../models/PrepaidSmartCard');
const { ApiError } = require('../utils/ApiError');
const auditService = require('./auditService');

function normalizeId(val) {
  return typeof val === 'string' ? val.trim().toUpperCase() : '';
}

class SmartCardService {
  /**
   * Issue a new prepaid smart card with optional initial top-up and security deposit.
   */
  static async issueCard({
    cardUid,
    cafeId,
    organisationId = 'ZAMORIN',
    customerId = null,
    customerName = 'Guest',
    customerPhone = '',
    initialTopupPaisa = 0,
    securityDepositPaisa = 0,
    paymentMethod = 'CASH',
    authContext = {},
  }) {
    if (!cardUid) {
      throw new ApiError(400, 'CARD_UID_REQUIRED', 'cardUid is required to issue a card.');
    }
    if (!cafeId) {
      throw new ApiError(400, 'CAFE_ID_REQUIRED', 'cafeId is required.');
    }

    const cleanCardUid = normalizeId(cardUid);
    const cleanOrg = normalizeId(organisationId);
    const cleanCafe = normalizeId(cafeId);

    const existing = await PrepaidSmartCard.findOne({ cardUid: cleanCardUid });
    if (existing) {
      if (existing.status === 'ACTIVE') {
        throw new ApiError(409, 'CARD_ALREADY_ACTIVE', `Smart card ${cleanCardUid} is already active.`);
      }
      if (existing.status === 'BLOCKED') {
        throw new ApiError(409, 'CARD_BLOCKED', `Smart card ${cleanCardUid} is blocked and cannot be re-issued.`);
      }
    }

    const initialTopup = Math.max(0, Math.floor(Number(initialTopupPaisa || 0)));
    const deposit = Math.max(0, Math.floor(Number(securityDepositPaisa || 0)));
    const now = new Date();

    const transactions = [];
    if (deposit > 0) {
      transactions.push({
        transactionId: `TXN-DEP-${Date.now()}-${Math.floor(100 + Math.random() * 900)}`,
        type: 'ISSUE',
        amountPaisa: deposit,
        balanceBeforePaisa: 0,
        balanceAfterPaisa: 0,
        paymentMethod,
        notes: `Card issuance deposit: ₹${(deposit / 100).toFixed(2)}`,
        performedByUserId: authContext.userId || 'CASHIER',
        timestamp: now,
      });
    }

    if (initialTopup > 0) {
      transactions.push({
        transactionId: `TXN-TOP-${Date.now()}-${Math.floor(100 + Math.random() * 900)}`,
        type: 'TOPUP',
        amountPaisa: initialTopup,
        balanceBeforePaisa: 0,
        balanceAfterPaisa: initialTopup,
        paymentMethod,
        notes: `Initial card topup: ₹${(initialTopup / 100).toFixed(2)}`,
        performedByUserId: authContext.userId || 'CASHIER',
        timestamp: now,
      });
    }

    let card;
    if (existing && existing.status === 'REFUNDED') {
      existing.status = 'ACTIVE';
      existing.balancePaisa = initialTopup;
      existing.securityDepositPaisa = deposit;
      existing.customerName = customerName || 'Guest';
      existing.customerPhone = customerPhone || '';
      existing.customerId = customerId || null;
      existing.issuedAt = now;
      existing.refundedAt = null;
      existing.transactions.push(...transactions);
      card = await existing.save();
    } else {
      card = await PrepaidSmartCard.create({
        cardUid: cleanCardUid,
        organisationId: cleanOrg,
        cafeId: cleanCafe,
        customerId: customerId || null,
        customerName: customerName || 'Guest',
        customerPhone: customerPhone || '',
        balancePaisa: initialTopup,
        securityDepositPaisa: deposit,
        status: 'ACTIVE',
        issuedAt: now,
        transactions,
      });
    }

    try {
      await auditService.recordAuditEvent({
        organisationId: cleanOrg,
        cafeId: cleanCafe,
        module: 'POS',
        action: 'SMART_CARD_ISSUE',
        actorRole: authContext.role || 'STAFF',
        actorUserId: authContext.userId || 'CASHIER',
        entityType: 'PrepaidSmartCard',
        entityId: cleanCardUid,
        details: { balancePaisa: initialTopup, depositPaisa: deposit },
      });
    } catch (_) {}

    return {
      success: true,
      cardUid: card.cardUid,
      balancePaisa: card.balancePaisa,
      securityDepositPaisa: card.securityDepositPaisa,
      status: card.status,
    };
  }

  /**
   * Top-up an active smart card.
   */
  static async topupCard({
    cardUid,
    amountPaisa,
    paymentMethod = 'CASH',
    cafeId = null,
    organisationId = 'ZAMORIN',
    authContext = {},
  }) {
    if (!cardUid) {
      throw new ApiError(400, 'CARD_UID_REQUIRED', 'cardUid is required.');
    }
    const topupAmount = Math.floor(Number(amountPaisa || 0));
    if (topupAmount <= 0) {
      throw new ApiError(400, 'INVALID_AMOUNT', 'Top-up amount must be a positive integer in paise.');
    }

    const cleanCardUid = normalizeId(cardUid);
    const card = await PrepaidSmartCard.findOne({ cardUid: cleanCardUid });
    if (!card) {
      throw new ApiError(404, 'CARD_NOT_FOUND', `Smart card ${cleanCardUid} not found.`);
    }
    if (card.status !== 'ACTIVE') {
      throw new ApiError(400, 'CARD_NOT_ACTIVE', `Smart card is ${card.status} and cannot be topped up.`);
    }

    const balanceBefore = card.balancePaisa;
    const balanceAfter = balanceBefore + topupAmount;
    card.balancePaisa = balanceAfter;

    const txnId = `TXN-TOP-${Date.now()}-${Math.floor(100 + Math.random() * 900)}`;
    card.transactions.push({
      transactionId: txnId,
      type: 'TOPUP',
      amountPaisa: topupAmount,
      balanceBeforePaisa: balanceBefore,
      balanceAfterPaisa: balanceAfter,
      paymentMethod,
      performedByUserId: authContext.userId || 'CASHIER',
      timestamp: new Date(),
    });

    await card.save();

    try {
      await auditService.recordAuditEvent({
        organisationId: card.organisationId,
        cafeId: cafeId || card.cafeId,
        module: 'POS',
        action: 'SMART_CARD_TOPUP',
        actorRole: authContext.role || 'STAFF',
        actorUserId: authContext.userId || 'CASHIER',
        entityType: 'PrepaidSmartCard',
        entityId: cleanCardUid,
        details: { topupAmountPaisa: topupAmount, newBalancePaisa: balanceAfter },
      });
    } catch (_) {}

    return {
      success: true,
      cardUid: card.cardUid,
      toppedUpPaisa: topupAmount,
      balancePaisa: card.balancePaisa,
      transactionId: txnId,
    };
  }

  /**
   * Tap-debit from card for bill settlement.
   */
  static async debitCard({
    cardUid,
    amountPaisa,
    referenceBillId = null,
    cafeId = null,
    authContext = {},
  }) {
    if (!cardUid) {
      throw new ApiError(400, 'CARD_UID_REQUIRED', 'cardUid is required.');
    }
    const debitAmount = Math.floor(Number(amountPaisa || 0));
    if (debitAmount <= 0) {
      throw new ApiError(400, 'INVALID_AMOUNT', 'Debit amount must be positive.');
    }

    const cleanCardUid = normalizeId(cardUid);
    const card = await PrepaidSmartCard.findOne({ cardUid: cleanCardUid });
    if (!card) {
      throw new ApiError(404, 'CARD_NOT_FOUND', `Smart card ${cleanCardUid} not found.`);
    }
    if (card.status !== 'ACTIVE') {
      throw new ApiError(400, 'CARD_NOT_ACTIVE', `Smart card is ${card.status} and cannot be used for payment.`);
    }

    if (card.balancePaisa < debitAmount) {
      throw new ApiError(
        400,
        'INSUFFICIENT_CARD_BALANCE',
        `Insufficient smart card balance. Available: ₹${(card.balancePaisa / 100).toFixed(2)}, Required: ₹${(debitAmount / 100).toFixed(2)}.`
      );
    }

    const balanceBefore = card.balancePaisa;
    const balanceAfter = balanceBefore - debitAmount;
    card.balancePaisa = balanceAfter;

    const txnId = `TXN-DEB-${Date.now()}-${Math.floor(100 + Math.random() * 900)}`;
    card.transactions.push({
      transactionId: txnId,
      type: 'DEBIT',
      amountPaisa: debitAmount,
      balanceBeforePaisa: balanceBefore,
      balanceAfterPaisa: balanceAfter,
      referenceBillId,
      performedByUserId: authContext.userId || 'CASHIER',
      timestamp: new Date(),
    });

    await card.save();

    return {
      success: true,
      cardUid: card.cardUid,
      debitedPaisa: debitAmount,
      balancePaisa: card.balancePaisa,
      transactionId: txnId,
    };
  }

  /**
   * Refund remaining balance & security deposit when card is surrendered.
   */
  static async refundAndCloseCard({
    cardUid,
    refundDeposit = true,
    authContext = {},
  }) {
    if (!cardUid) {
      throw new ApiError(400, 'CARD_UID_REQUIRED', 'cardUid is required.');
    }
    const cleanCardUid = normalizeId(cardUid);
    const card = await PrepaidSmartCard.findOne({ cardUid: cleanCardUid });
    if (!card) {
      throw new ApiError(404, 'CARD_NOT_FOUND', `Smart card ${cleanCardUid} not found.`);
    }
    if (card.status !== 'ACTIVE') {
      throw new ApiError(400, 'CARD_NOT_ACTIVE', `Smart card is already ${card.status}.`);
    }

    const unspentBalance = card.balancePaisa;
    const depositRefund = refundDeposit ? card.securityDepositPaisa : 0;
    const totalRefundPaisa = unspentBalance + depositRefund;

    card.transactions.push({
      transactionId: `TXN-REF-${Date.now()}-${Math.floor(100 + Math.random() * 900)}`,
      type: 'REFUND',
      amountPaisa: totalRefundPaisa,
      balanceBeforePaisa: unspentBalance,
      balanceAfterPaisa: 0,
      notes: `Card surrendered. Balance refund: ₹${(unspentBalance / 100).toFixed(2)}, Deposit refund: ₹${(depositRefund / 100).toFixed(2)}`,
      performedByUserId: authContext.userId || 'CASHIER',
      timestamp: new Date(),
    });

    card.balancePaisa = 0;
    card.securityDepositPaisa = refundDeposit ? 0 : card.securityDepositPaisa;
    card.status = 'REFUNDED';
    card.refundedAt = new Date();

    await card.save();

    try {
      await auditService.recordAuditEvent({
        organisationId: card.organisationId,
        cafeId: card.cafeId,
        module: 'POS',
        action: 'SMART_CARD_REFUND',
        actorRole: authContext.role || 'STAFF',
        actorUserId: authContext.userId || 'CASHIER',
        entityType: 'PrepaidSmartCard',
        entityId: cleanCardUid,
        details: { refundedBalancePaisa: unspentBalance, refundedDepositPaisa: depositRefund },
      });
    } catch (_) {}

    return {
      success: true,
      cardUid: card.cardUid,
      status: 'REFUNDED',
      refundedBalancePaisa: unspentBalance,
      refundedDepositPaisa: depositRefund,
      totalRefundPaisa,
    };
  }

  /**
   * Get balance and transaction log for a card.
   */
  static async getCardBalance(cardUid) {
    if (!cardUid) {
      throw new ApiError(400, 'CARD_UID_REQUIRED', 'cardUid is required.');
    }
    const cleanCardUid = normalizeId(cardUid);
    const card = await PrepaidSmartCard.findOne({ cardUid: cleanCardUid });
    if (!card) {
      throw new ApiError(404, 'CARD_NOT_FOUND', `Smart card ${cleanCardUid} not found.`);
    }
    return {
      cardUid: card.cardUid,
      customerName: card.customerName,
      customerPhone: card.customerPhone,
      balancePaisa: card.balancePaisa,
      securityDepositPaisa: card.securityDepositPaisa,
      status: card.status,
      issuedAt: card.issuedAt,
      transactionCount: card.transactions.length,
      recentTransactions: card.transactions.slice(-10),
    };
  }

  /**
   * Store-level Unspent Float Liability Report.
   */
  static async getUnspentLiabilityReport({ cafeId, organisationId = 'ZAMORIN' }) {
    const query = { status: 'ACTIVE' };
    if (organisationId) query.organisationId = normalizeId(organisationId);
    if (cafeId) query.cafeId = normalizeId(cafeId);

    const activeCards = await PrepaidSmartCard.find(query);
    let totalUnspentBalancePaisa = 0;
    let totalSecurityDepositPaisa = 0;

    for (const c of activeCards) {
      totalUnspentBalancePaisa += c.balancePaisa;
      totalSecurityDepositPaisa += c.securityDepositPaisa;
    }

    return {
      cafeId: cafeId || 'ALL',
      activeCardCount: activeCards.length,
      totalUnspentBalancePaisa,
      totalSecurityDepositPaisa,
      totalFloatLiabilityPaisa: totalUnspentBalancePaisa + totalSecurityDepositPaisa,
    };
  }
}

module.exports = { SmartCardService };
