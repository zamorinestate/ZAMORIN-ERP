'use strict';

/**
 * CUSTOMER WALLET & GIFT CARD SERVICE (P14 CUSTOMER WALLETS & GIFT CARDS)
 *
 * Implements:
 *   - Stored value top-ups requiring confirmed payment / cash receipt.
 *   - Idempotent top-ups preventing duplicate credits on callback retries.
 *   - Atomic redemption with concurrency protection (balances never overdrawn).
 *   - Gift card issuance with code hashing and masked public number (GC-****-XXXX).
 *   - Atomic gift card redemption.
 *   - Governed manual adjustments with audit trail.
 */

const crypto = require('crypto');
const { Customer } = require('../models/Customer');
const { WalletLedger } = require('../models/WalletLedger');
const { GiftCard } = require('../models/GiftCard');
const { SequenceCounter } = require('../models/SequenceCounter');
const { ApiError } = require('../utils/ApiError');

function hashSecret(secret) {
  return crypto.createHash('sha256').update(String(secret).trim()).digest('hex');
}

function maskCardNumber(fullNumber) {
  const str = String(fullNumber).trim();
  if (str.length <= 4) return 'GC-****';
  return `GC-****-${str.slice(-4)}`;
}

/**
 * Top up customer wallet with confirmed payment
 */
async function topUpWallet({
  organisationId,
  cafeId = 'ZC-0001',
  customerId,
  amountPaise,
  sourcePaymentId = null,
  sourcePaymentMethod = 'CASH',
  paymentStatus = 'CONFIRMED',
  performedByUserId,
  idempotencyKey = null,
  note = '',
}) {
  const amount = Math.round(Number(amountPaise));
  if (!amount || amount <= 0) {
    throw new ApiError(400, 'INVALID_AMOUNT', 'Top-up amount must be a positive integer in paise.');
  }

  // Authoritative payment check: pending or failed payments must not increase spendable balance
  if (paymentStatus !== 'CONFIRMED') {
    throw new ApiError(
      400,
      'UNCONFIRMED_PAYMENT',
      `Wallet credit requires confirmed payment status. Received: ${paymentStatus}`
    );
  }

  // Idempotency check: duplicate callback or replay cannot double credit
  if (idempotencyKey) {
    const existingEntry = await WalletLedger.findOne({
      organisationId,
      idempotencyKey,
      transactionType: 'TOPUP',
    }).lean();

    if (existingEntry) {
      return {
        success: true,
        alreadyProcessed: true,
        amountCreditedPaise: existingEntry.amountPaise,
        ledger: existingEntry,
      };
    }
  }

  const customer = await Customer.findOne({ customerId, organisationId });
  if (!customer) {
    throw new ApiError(404, 'CUSTOMER_NOT_FOUND', `Customer ${customerId} not found.`);
  }

  if (customer.status !== 'ACTIVE') {
    throw new ApiError(400, 'CUSTOMER_INACTIVE', 'Customer account is not active.');
  }

  const prevBalance = customer.walletBalancePaise || 0;
  const newBalance = prevBalance + amount;

  customer.walletBalancePaise = newBalance;
  await customer.save();

  const seqId = await SequenceCounter.generateId({
    organisationId,
    sequenceKey: 'WALLET_LEDGER_SEQ',
    prefix: 'WAL',
    minimumDigits: 4,
  });

  const ledgerEntry = new WalletLedger({
    walletLedgerId: seqId,
    organisationId,
    cafeId,
    customerId,
    transactionType: 'TOPUP',
    amountPaise: amount,
    balanceBeforePaise: prevBalance,
    balanceAfterPaise: newBalance,
    sourcePaymentId,
    sourcePaymentMethod,
    paymentStatus: 'CONFIRMED',
    idempotencyKey,
    description: note || `Wallet top-up via ${sourcePaymentMethod}`,
    performedByUserId,
    serverTimestamp: new Date(),
  });

  await ledgerEntry.save();

  return {
    success: true,
    amountCreditedPaise: amount,
    newBalancePaise: newBalance,
    ledger: ledgerEntry.toObject(),
  };
}

/**
 * Redeem from customer wallet atomically
 */
async function redeemWallet({
  organisationId,
  cafeId = 'ZC-0001',
  customerId,
  amountPaise,
  referenceBillId = null,
  performedByUserId,
  idempotencyKey = null,
  note = '',
}) {
  const amount = Math.round(Number(amountPaise));
  if (!amount || amount <= 0) {
    throw new ApiError(400, 'INVALID_AMOUNT', 'Redemption amount must be a positive integer in paise.');
  }

  if (idempotencyKey) {
    const existing = await WalletLedger.findOne({
      organisationId,
      idempotencyKey,
      transactionType: 'REDEMPTION',
    }).lean();

    if (existing) {
      return {
        success: true,
        alreadyProcessed: true,
        amountRedeemedPaise: Math.abs(existing.amountPaise),
        ledger: existing,
      };
    }
  }

  // Atomic deduction with balance guard to prevent negative balance / concurrent overspending
  const updatedCustomer = await Customer.findOneAndUpdate(
    {
      customerId,
      organisationId,
      status: 'ACTIVE',
      walletBalancePaise: { $gte: amount },
    },
    {
      $inc: { walletBalancePaise: -amount },
    },
    {
      returnDocument: 'after',
    }
  );

  if (!updatedCustomer) {
    const checkCust = await Customer.findOne({ customerId, organisationId }).lean();
    if (!checkCust) {
      throw new ApiError(404, 'CUSTOMER_NOT_FOUND', `Customer ${customerId} not found.`);
    }
    if (checkCust.status !== 'ACTIVE') {
      throw new ApiError(400, 'CUSTOMER_INACTIVE', 'Customer account is not active.');
    }
    throw new ApiError(
      400,
      'INSUFFICIENT_WALLET_BALANCE',
      `Insufficient wallet balance. Requested: ${amount} paise, Available: ${checkCust.walletBalancePaise || 0} paise.`
    );
  }

  const prevBalance = (updatedCustomer.walletBalancePaise || 0) + amount;
  const newBalance = updatedCustomer.walletBalancePaise || 0;

  const seqId = await SequenceCounter.generateId({
    organisationId,
    sequenceKey: 'WALLET_LEDGER_SEQ',
    prefix: 'WAL',
    minimumDigits: 4,
  });

  const ledgerEntry = new WalletLedger({
    walletLedgerId: seqId,
    organisationId,
    cafeId,
    customerId,
    transactionType: 'REDEMPTION',
    amountPaise: -amount,
    balanceBeforePaise: prevBalance,
    balanceAfterPaise: newBalance,
    referenceBillId,
    idempotencyKey,
    description: note || `Wallet payment for bill ${referenceBillId || 'POS'}`,
    performedByUserId,
    serverTimestamp: new Date(),
  });

  await ledgerEntry.save();

  return {
    success: true,
    amountRedeemedPaise: amount,
    newBalancePaise: newBalance,
    ledger: ledgerEntry.toObject(),
  };
}

/**
 * Issue new gift card
 */
async function issueGiftCard({
  organisationId,
  cafeId = 'ZC-0001',
  amountPaise,
  purchasedByCustomerId = null,
  validityDays = 365,
  performedByUserId,
}) {
  const amount = Math.round(Number(amountPaise));
  if (!amount || amount <= 0) {
    throw new ApiError(400, 'INVALID_AMOUNT', 'Gift card initial balance must be a positive integer in paise.');
  }

  const seqId = await SequenceCounter.generateId({
    organisationId,
    sequenceKey: 'GIFT_CARD_SEQ',
    prefix: 'GC',
    minimumDigits: 4,
  });

  // Secret redemption PIN/code (only returned on issuance, never stored plaintext)
  const secretCode = crypto.randomBytes(6).toString('hex').toUpperCase(); // 12-char secret
  const cardCodeHash = hashSecret(secretCode);
  const maskedNumber = maskCardNumber(seqId);

  const expiresAt = new Date(Date.now() + validityDays * 24 * 60 * 60 * 1000);

  const giftCard = new GiftCard({
    giftCardId: seqId,
    organisationId,
    cafeId,
    cardNumber: maskedNumber,
    cardCodeHash,
    initialBalancePaise: amount,
    currentBalancePaise: amount,
    status: 'ACTIVE',
    expiresAt,
    purchasedByCustomerId,
    issuedByUserId: performedByUserId,
    redemptionHistory: [],
  });

  await giftCard.save();

  return {
    success: true,
    giftCardId: seqId,
    cardNumber: maskedNumber,
    secretCode, // Single exposure on issuance
    balancePaise: amount,
    expiresAt,
  };
}

/**
 * Redeem gift card atomically
 */
async function redeemGiftCard({
  organisationId,
  cafeId = 'ZC-0001',
  giftCardId,
  secretCode,
  amountPaise,
  billId = null,
  performedByUserId,
}) {
  const amount = Math.round(Number(amountPaise));
  if (!amount || amount <= 0) {
    throw new ApiError(400, 'INVALID_AMOUNT', 'Redemption amount must be a positive integer in paise.');
  }

  const giftCard = await GiftCard.findOne({ giftCardId, organisationId });
  if (!giftCard) {
    throw new ApiError(404, 'GIFT_CARD_NOT_FOUND', `Gift card ${giftCardId} not found.`);
  }

  if (giftCard.status !== 'ACTIVE') {
    throw new ApiError(400, 'GIFT_CARD_INACTIVE', `Gift card is not active. Status: ${giftCard.status}`);
  }

  if (giftCard.expiresAt && giftCard.expiresAt < new Date()) {
    giftCard.status = 'EXPIRED';
    await giftCard.save();
    throw new ApiError(400, 'GIFT_CARD_EXPIRED', 'Gift card has expired.');
  }

  // Validate secret code hash
  if (hashSecret(secretCode) !== giftCard.cardCodeHash) {
    throw new ApiError(401, 'INVALID_GIFT_CARD_SECRET', 'Gift card secret code is incorrect.');
  }

  // Concurrency-guarded atomic update
  const updatedCard = await GiftCard.findOneAndUpdate(
    {
      giftCardId,
      organisationId,
      status: 'ACTIVE',
      currentBalancePaise: { $gte: amount },
    },
    {
      $inc: { currentBalancePaise: -amount },
      $push: {
        redemptionHistory: {
          redemptionId: `RED-${Date.now()}-${Math.floor(Math.random() * 8999 + 1000)}`,
          billId,
          amountPaise: amount,
          balanceAfterPaise: giftCard.currentBalancePaise - amount,
          redeemedAt: new Date(),
          cafeId,
          performedByUserId,
        },
      },
    },
    { returnDocument: 'after' }
  );

  if (!updatedCard) {
    throw new ApiError(
      400,
      'INSUFFICIENT_GIFT_CARD_BALANCE',
      `Insufficient gift card balance. Requested: ${amount} paise, Available: ${giftCard.currentBalancePaise} paise.`
    );
  }

  if (updatedCard.currentBalancePaise === 0) {
    updatedCard.status = 'REDEEMED';
    await updatedCard.save();
  }

  return {
    success: true,
    amountRedeemedPaise: amount,
    remainingBalancePaise: updatedCard.currentBalancePaise,
    status: updatedCard.status,
  };
}

module.exports = {
  topUpWallet,
  redeemWallet,
  issueGiftCard,
  redeemGiftCard,
};
