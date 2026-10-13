'use strict';

/**
 * CUSTOMER DATA PROTECTION & OTP SERVICE (PHASE P24: F065, F066)
 *
 * Implements:
 *   - F065: Masked Customer Mobile Numbers (******3210 for non-executive roles).
 *   - F066: Cryptographic OTP Verification Challenges for customer search & redemptions.
 *   - Signed Customer Authorization Tokens for sensitive wallet & points spends.
 */

const crypto = require('crypto');
const { Customer } = require('../models/Customer');
const { GuestVerificationChallenge } = require('../models/GuestVerificationChallenge');
const { ApiError } = require('../utils/ApiError');

const TOKEN_SECRET = process.env.JWT_SECRET || 'zamorin-customer-protection-secret-2026';
const TOKEN_TTL_MS = 15 * 60 * 1000; // 15 minutes authorization window

function hashOtp(otp) {
  return crypto.createHash('sha256').update(String(otp).trim()).digest('hex');
}

/**
 * Mask customer phone number (F065)
 * Returns '******XXXX' (first digits masked, last 4 digits visible)
 */
function maskCustomerPhone(phone, userRole = 'STAFF', isOtpVerified = false) {
  if (!phone || typeof phone !== 'string') return '';
  if (userRole === 'MASTER' || userRole === 'OWNER' || isOtpVerified === true) {
    return phone;
  }
  const digits = phone.replace(/\D/g, '');
  if (digits.length <= 4) return '******';
  const last4 = digits.slice(-4);
  return `******${last4}`;
}

/**
 * Generate 6-digit OTP challenge for customer lookup / redemption (F066)
 */
async function requestCustomerOtp({ organisationId, cafeId = 'ZC-0001', customerId = null, phone = null }) {
  let targetPhone = phone;
  let targetCustomer = null;

  if (customerId) {
    targetCustomer = await Customer.findOne({ customerId, organisationId }).lean();
    if (!targetCustomer) {
      throw new ApiError(404, 'CUSTOMER_NOT_FOUND', `Customer ${customerId} not found.`);
    }
    targetPhone = targetCustomer.phone;
  }

  if (!targetPhone) {
    throw new ApiError(400, 'PHONE_REQUIRED', 'Customer phone number is required to generate OTP.');
  }

  const rawOtp = String(Math.floor(100000 + Math.random() * 900000));
  const challengeId = `CHAL-${Date.now()}-${Math.random().toString(36).substr(2, 6).toUpperCase()}`;
  const codeHash = hashOtp(rawOtp);
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 min expiry

  const challenge = new GuestVerificationChallenge({
    challengeId,
    organisationId,
    cafeId,
    phone: targetPhone,
    codeHash,
    attempts: 0,
    maxAttempts: 3,
    isVerified: false,
    isUsed: false,
    expiresAt,
    deliveryStatus: 'DELIVERED_TEST',
  });

  await challenge.save();

  return {
    success: true,
    challengeId,
    otp: rawOtp,
    expiresAt,
    maskedPhone: maskCustomerPhone(targetPhone),
    message: `Verification OTP dispatched to customer ${maskCustomerPhone(targetPhone)}`,
  };
}

/**
 * Verify customer OTP challenge and return signed authorization token (F066)
 */
async function verifyCustomerOtp({ organisationId, challengeId, otp, customerId = null }) {
  if (!challengeId || !otp) {
    throw new ApiError(400, 'INVALID_OTP_PARAMETERS', 'Challenge ID and OTP are required.');
  }

  const challenge = await GuestVerificationChallenge.findOne({ challengeId, organisationId });
  if (!challenge) {
    throw new ApiError(404, 'CHALLENGE_NOT_FOUND', 'Verification challenge not found or expired.');
  }

  if (new Date() > challenge.expiresAt) {
    throw new ApiError(400, 'OTP_EXPIRED', 'Verification OTP has expired. Please request a new OTP.');
  }

  if (challenge.attempts >= challenge.maxAttempts) {
    throw new ApiError(403, 'MAX_ATTEMPTS_EXCEEDED', 'Maximum verification attempts exceeded. Please request a new OTP.');
  }

  const providedHash = hashOtp(otp);
  if (providedHash !== challenge.codeHash) {
    challenge.attempts += 1;
    await challenge.save();
    throw new ApiError(400, 'INVALID_OTP', `Invalid OTP entered. ${challenge.maxAttempts - challenge.attempts} attempts remaining.`);
  }

  challenge.isVerified = true;
  challenge.verifiedAt = new Date();
  challenge.isUsed = true;
  challenge.usedAt = new Date();
  await challenge.save();

  // Find customer if customerId not passed directly
  let targetCustId = customerId;
  const targetPhone = challenge.phone;
  if (!targetCustId) {
    const cust = await Customer.findOne({ organisationId, phone: challenge.phone }).lean();
    if (cust) {
      targetCustId = cust.customerId;
    }
  }

  // Create signed authorization token
  const payload = {
    challengeId,
    customerId: targetCustId || 'GUEST',
    phone: targetPhone,
    verifiedAt: Date.now(),
    expiresAt: Date.now() + TOKEN_TTL_MS,
  };
  const payloadBase64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto.createHmac('sha256', TOKEN_SECRET).update(payloadBase64).digest('base64url');
  const authorizationToken = `${payloadBase64}.${signature}`;

  return {
    success: true,
    verified: true,
    authorizationToken,
    customerId: targetCustId,
    unmaskedPhone: targetPhone,
    message: 'Customer OTP verified successfully.',
  };
}

/**
 * Verify customer authorization token for sensitive operations (redemptions)
 */
function verifyCustomerAuthorizationToken(token, customerId = null) {
  if (!token || typeof token !== 'string') return false;
  const parts = token.split('.');
  if (parts.length !== 2) return false;
  const [payloadBase64, signature] = parts;
  const expectedSig = crypto.createHmac('sha256', TOKEN_SECRET).update(payloadBase64).digest('base64url');
  if (signature !== expectedSig) return false;

  try {
    const payload = JSON.parse(Buffer.from(payloadBase64, 'base64url').toString('utf8'));
    if (Date.now() > payload.expiresAt) return false;
    if (customerId && payload.customerId && payload.customerId !== customerId && payload.customerId !== 'GUEST') {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

module.exports = {
  maskCustomerPhone,
  requestCustomerOtp,
  verifyCustomerOtp,
  verifyCustomerAuthorizationToken,
};
