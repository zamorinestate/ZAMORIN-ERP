'use strict';

/**
 * QR ORDERING SERVICE (P15 CHANNELS & QR GUEST ORDERING)
 *
 * Implements authoritative customer-facing QR menu & multi-round ordering:
 *   - Cryptographic table QR generation & revocation using UniversalQrService.
 *   - Authoritative guest menu retrieval respecting outlet offerings, sold-out states,
 *     channel availability, and server-side pricing snapshots.
 *   - Secure customer verification challenge (OTP) with replay rejection and attempt limits.
 *   - Multi-round table ordering appending to authoritative TableSession.
 *   - Never trusts browser-submitted prices, tax amounts, or inventory quantities.
 */

const crypto = require('crypto');
const { UniversalQrService } = require('./universalQrService');
const { DiningTable } = require('../models/DiningTable');
const { TableSession } = require('../models/TableSession');
const { ChannelOrder } = require('../models/ChannelOrder');
const { MenuItem } = require('../models/MenuItem');
const { OutletOffering } = require('../models/OutletOffering');
const { Cafe } = require('../models/Cafe');
const { GuestVerificationChallenge } = require('../models/GuestVerificationChallenge');
const { OnlineChannelConfig } = require('../models/OnlineChannelConfig');
const { ApiError } = require('../utils/ApiError');
const auditService = require('./auditService');
const { calculateCustomerPayableRounding50P, roundToPaisa } = require('./gstTaxService');

class QrOrderingService {
  /**
   * Generates or regenerates a cryptographically unguessable table QR code.
   */
  static async generateTableQr({ cafeId, tableId, tableNumber, organisationId, actorUserId = 'SYSTEM' }) {
    if (!cafeId || !tableId || !organisationId) {
      throw new ApiError(400, 'REQUIRED_FIELDS_MISSING', 'cafeId, tableId, and organisationId are required.');
    }

    const table = await DiningTable.findOne({ organisationId, cafeId, tableId });
    if (!table) {
      throw new ApiError(404, 'TABLE_NOT_FOUND', `Dining table ${tableId} not found for café ${cafeId}.`);
    }

    const qrTitle = `Zamorin Café ${cafeId} — Table ${tableNumber || table.tableNumber}`;
    const qrRecord = await UniversalQrService.createQrRecord({
      qrType: 'TABLE_ORDER',
      targetEntityId: tableId,
      organisationId,
      cafeId,
      title: qrTitle,
      metadata: {
        tableId,
        tableNumber: tableNumber || table.tableNumber,
        section: table.section,
      },
      actorUserId,
    });

    table.activeQrRecordId = qrRecord.qrId;
    table.activeQrToken = qrRecord.opaqueToken;
    await table.save();

    return {
      qrId: qrRecord.qrId,
      opaqueToken: qrRecord.opaqueToken,
      payload: qrRecord.payload,
      tableNumber: table.tableNumber,
      svg: UniversalQrService.renderQrSvg(qrRecord.payload, { size: 256 }),
    };
  }

  /**
   * Revokes a table QR code.
   */
  static async revokeTableQr({ qrId, organisationId, actorUserId = 'SYSTEM', reason = 'Revoked by host' }) {
    const revoked = await UniversalQrService.revokeQr(qrId, { reason, actorUserId });
    await DiningTable.updateOne(
      { activeQrRecordId: qrId, organisationId },
      { $set: { activeQrRecordId: null, activeQrToken: null } }
    );
    return revoked;
  }

  /**
   * Regenerates/rotates a table QR token.
   */
  static async rotateTableQr({ qrId, organisationId, actorUserId = 'SYSTEM' }) {
    const table = await DiningTable.findOne({ activeQrRecordId: qrId, organisationId });
    if (!table) {
      throw new ApiError(404, 'TABLE_NOT_FOUND', 'Dining table associated with QR record not found.');
    }

    await UniversalQrService.revokeQr(qrId, { reason: 'Rotating table QR token', actorUserId });
    return await this.generateTableQr({
      cafeId: table.cafeId,
      tableId: table.tableId,
      tableNumber: table.tableNumber,
      organisationId,
      actorUserId,
    });
  }

  /**
   * Fetches active guest menu for a scanned QR token.
   * Never trusts client state; loads authoritative MenuItems joined with OutletOfferings.
   */
  static async getGuestMenu({ qrToken }) {
    if (!qrToken) {
      throw new ApiError(400, 'QR_TOKEN_REQUIRED', 'QR token is required to load guest menu.');
    }

    const verification = await UniversalQrService.verifyQrToken(qrToken, { qrType: 'TABLE_ORDER' });
    const { cafeId, organisationId, metadata = {}, targetEntityId: tableId } = verification;

    // Validate table status
    const table = await DiningTable.findOne({ organisationId, cafeId, tableId });
    if (!table) {
      throw new ApiError(404, 'TABLE_NOT_FOUND', 'Scanned table does not exist or has been removed.');
    }
    if (table.isServiceBlocked) {
      throw new ApiError(403, 'TABLE_SERVICE_BLOCKED', 'Table service is temporarily blocked for this table.');
    }

    // Validate cafe operational status
    const cafe = await Cafe.findOne({ cafeId, organisationId }).lean();
    if (!cafe) {
      throw new ApiError(404, 'CAFE_NOT_FOUND', 'Café outlet not found.');
    }

    // Query active menu items
    const menuItems = await MenuItem.find({
      organisationId,
      status: 'ACTIVE',
    }).lean();

    // Query outlet offerings for cafe-level pricing and availability
    const outletOfferings = await OutletOffering.find({
      organisationId,
      outletId: cafeId,
    }).lean();

    const offeringsMap = new Map();
    for (const off of outletOfferings) {
      offeringsMap.set(off.menuItemId, off);
    }

    const now = new Date();
    const guestCategories = {};

    for (const item of menuItems) {
      const offering = offeringsMap.get(item.menuItemId);

      // Channel eligibility check: if offering specifies channels, dineIn must be true
      if (offering && offering.channels && offering.channels.dineIn === false) {
        continue;
      }
      if (offering && offering.isEnabled === false) {
        continue;
      }

      // Check sold-out status
      let isSoldOut = false;
      let soldOutReason = null;
      if (offering) {
        if (offering.isAvailable === false) {
          isSoldOut = true;
          soldOutReason = offering.soldOutReason || 'Sold out today';
        } else if (offering.soldOutUntil && new Date(offering.soldOutUntil) > now) {
          isSoldOut = true;
          soldOutReason = offering.soldOutReason || 'Temporarily sold out';
        }
      }

      // Determine authoritative price
      const effectivePricePaisa =
        offering && Number.isInteger(offering.localPricePaisaOverride) && offering.localPricePaisaOverride >= 0
          ? offering.localPricePaisaOverride
          : (Number.isInteger(item.sellingPricePaisa) ? item.sellingPricePaisa : 0);

      const category = item.category || 'OTHER';
      if (!guestCategories[category]) {
        guestCategories[category] = [];
      }

      guestCategories[category].push({
        menuItemId: item.menuItemId,
        name: item.name,
        description: item.description || '',
        pricePaisa: effectivePricePaisa,
        taxRatePercent: item.taxRatePercent || 5,
        isVegetarian: Boolean(item.isVegetarian),
        isSoldOut,
        soldOutReason,
        variants: (item.variants || []).filter((v) => v.isAvailable !== false).map((v) => ({
          variantId: v.variantId,
          name: v.name,
          pricePaisa: v.pricePaisa,
        })),
        modifiers: (item.applicableModifierGroupIds || []),
        combos: (item.comboDefinitions || []),
      });
    }

    return {
      cafe: {
        cafeId: cafe.cafeId,
        name: cafe.name,
        tagline: cafe.tagline || 'Speciality Coffee & Kitchens',
      },
      table: {
        tableId: table.tableId,
        tableNumber: table.tableNumber,
        section: table.section,
        status: table.status,
      },
      categories: guestCategories,
    };
  }

  /**
   * Generates customer verification challenge (OTP) for QR ordering.
   */
  static async createVerificationChallenge({ phone, cafeId, organisationId }) {
    if (!phone) {
      throw new ApiError(400, 'PHONE_REQUIRED', 'Phone number is required for verification challenge.');
    }

    const cleanPhone = phone.replace(/[^0-9]/g, '');
    if (cleanPhone.length < 10) {
      throw new ApiError(400, 'INVALID_PHONE', 'Valid phone number with at least 10 digits required.');
    }

    const challengeId = `CHAL-${crypto.randomBytes(8).toString('hex').toUpperCase()}`;
    // Deterministic test code in test mode, cryptographically random in live
    const isTestMode = process.env.NODE_ENV === 'test' || Boolean(process.env.TEST_MODE);
    const otpCode = isTestMode ? '123456' : crypto.randomInt(100000, 999999).toString();
    const codeHash = crypto.createHash('sha256').update(`${challengeId}:${otpCode}`).digest('hex');
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes strict expiry

    let deliveryStatus = isTestMode ? 'DELIVERED_TEST' : 'BLOCKED_EXTERNAL_DEPENDENCY';
    let providerError = isTestMode ? null : 'SMS_GATEWAY_NOT_CONFIGURED';

    const challenge = await GuestVerificationChallenge.create({
      challengeId,
      organisationId,
      cafeId,
      phone: cleanPhone,
      codeHash,
      expiresAt,
      deliveryStatus,
      providerError,
    });

    return {
      challengeId: challenge.challengeId,
      expiresAt: challenge.expiresAt,
      deliveryStatus: challenge.deliveryStatus,
      message:
        deliveryStatus === 'DELIVERED_TEST'
          ? 'Test OTP sent successfully (use 123456).'
          : 'SMS provider unconfigured. Live delivery blocked per external dependency policy.',
    };
  }

  /**
   * Verifies an incoming OTP code against a challenge.
   */
  static async verifyChallenge({ challengeId, code }) {
    if (!challengeId || !code) {
      throw new ApiError(400, 'CHALLENGE_AND_CODE_REQUIRED', 'challengeId and code are required.');
    }

    const challenge = await GuestVerificationChallenge.findOne({ challengeId });
    if (!challenge) {
      throw new ApiError(404, 'CHALLENGE_NOT_FOUND', 'Verification challenge not found.');
    }

    if (challenge.isUsed) {
      throw new ApiError(400, 'CHALLENGE_ALREADY_USED', 'This verification challenge has already been consumed.');
    }

    if (new Date() > challenge.expiresAt) {
      throw new ApiError(400, 'CHALLENGE_EXPIRED', 'Verification challenge has expired.');
    }

    if (challenge.attempts >= challenge.maxAttempts) {
      throw new ApiError(403, 'CHALLENGE_MAX_ATTEMPTS_EXCEEDED', 'Maximum verification attempts exceeded.');
    }

    const expectedHash = crypto.createHash('sha256').update(`${challengeId}:${code.trim()}`).digest('hex');
    const isMatch = crypto.timingSafeEqual(Buffer.from(challenge.codeHash), Buffer.from(expectedHash));

    if (!isMatch) {
      challenge.attempts += 1;
      await challenge.save();
      throw new ApiError(400, 'INVALID_VERIFICATION_CODE', 'Incorrect verification code.');
    }

    challenge.isVerified = true;
    challenge.verifiedAt = new Date();
    await challenge.save();

    return {
      verified: true,
      challengeId: challenge.challengeId,
    };
  }

  /**
   * Submits an ordering round from a table QR session.
   * Appends to authoritative TableSession without duplicate financial ledgers.
   */
  static async submitGuestOrderRound({
    qrToken,
    lineItems,
    customerInfo = {},
    challengeId = null,
    idempotencyKey = null,
  }) {
    if (!qrToken) {
      throw new ApiError(400, 'QR_TOKEN_REQUIRED', 'QR token is required to submit order round.');
    }
    if (!Array.isArray(lineItems) || lineItems.length === 0) {
      throw new ApiError(400, 'LINE_ITEMS_REQUIRED', 'At least one line item is required.');
    }

    // Verify QR token
    const verification = await UniversalQrService.verifyQrToken(qrToken, { qrType: 'TABLE_ORDER' });
    const { cafeId, organisationId, targetEntityId: tableId, metadata = {} } = verification;

    // Check optional customer verification
    if (challengeId) {
      const challenge = await GuestVerificationChallenge.findOne({ challengeId });
      if (!challenge || !challenge.isVerified || challenge.isUsed) {
        throw new ApiError(400, 'VERIFICATION_REQUIRED', 'Valid completed verification challenge is required.');
      }
      challenge.isUsed = true;
      challenge.usedAt = new Date();
      await challenge.save();
    }

    // Check table
    const table = await DiningTable.findOne({ organisationId, cafeId, tableId });
    if (!table) {
      throw new ApiError(404, 'TABLE_NOT_FOUND', 'Dining table not found.');
    }
    if (table.isServiceBlocked) {
      throw new ApiError(403, 'TABLE_BLOCKED', 'Dining table is blocked for service.');
    }

    // Check idempotency if key provided
    if (idempotencyKey) {
      const existingOrder = await ChannelOrder.findOne({
        organisationId,
        cafeId,
        idempotencyKey,
      });
      if (existingOrder) {
        return {
          duplicate: true,
          orderId: existingOrder.orderId,
          orderNumber: existingOrder.orderNumber,
          status: existingOrder.status,
          totalPaisa: existingOrder.pricing.totalPaisa,
        };
      }
    }

    // Resolve authoritative prices & line item snapshots
    const menuItemIds = lineItems.map((li) => String(li.menuItemId || '').trim().toUpperCase());
    const dbMenuItems = await MenuItem.find({
      organisationId,
      menuItemId: { $in: menuItemIds },
      status: 'ACTIVE',
    }).lean();

    const dbOfferings = await OutletOffering.find({
      organisationId,
      outletId: cafeId,
      menuItemId: { $in: menuItemIds },
    }).lean();

    const itemsMap = new Map();
    for (const it of dbMenuItems) itemsMap.set(it.menuItemId, it);
    const offeringsMap = new Map();
    for (const off of dbOfferings) offeringsMap.set(off.menuItemId, off);

    const now = new Date();
    const verifiedLineItems = [];
    let roundSubtotalPaisa = 0;
    let roundTaxPaisa = 0;

    for (const clientItem of lineItems) {
      const mId = String(clientItem.menuItemId || '').trim().toUpperCase();
      const menuItem = itemsMap.get(mId);
      if (!menuItem) {
        throw new ApiError(400, 'MENU_ITEM_UNAVAILABLE', `Menu item ${mId} is inactive or not found.`);
      }

      const offering = offeringsMap.get(mId);
      if (offering && offering.isEnabled === false) {
        throw new ApiError(400, 'ITEM_DISABLED', `Menu item "${menuItem.name}" is disabled at this café.`);
      }
      if (offering && offering.channels && offering.channels.dineIn === false) {
        throw new ApiError(400, 'CHANNEL_UNAVAILABLE', `Menu item "${menuItem.name}" is not eligible for table dine-in.`);
      }
      if (offering && offering.isAvailable === false) {
        throw new ApiError(400, 'ITEM_SOLD_OUT', `Menu item "${menuItem.name}" is sold out.`);
      }
      if (offering && offering.soldOutUntil && new Date(offering.soldOutUntil) > now) {
        throw new ApiError(400, 'ITEM_SOLD_OUT', `Menu item "${menuItem.name}" is temporarily sold out.`);
      }

      const quantity = Math.max(1, Math.floor(Number(clientItem.quantity) || 1));

      // Resolve base unit price authoritatively
      let unitPricePaisa =
        offering && Number.isInteger(offering.localPricePaisaOverride) && offering.localPricePaisaOverride >= 0
          ? offering.localPricePaisaOverride
          : (Number.isInteger(menuItem.sellingPricePaisa) ? menuItem.sellingPricePaisa : 0);

      // Handle variant pricing if specified
      let variantSnapshot = null;
      if (clientItem.variantId && Array.isArray(menuItem.variants)) {
        const foundVariant = menuItem.variants.find((v) => v.variantId === clientItem.variantId);
        if (foundVariant && Number.isInteger(foundVariant.pricePaisa)) {
          unitPricePaisa = foundVariant.pricePaisa;
          variantSnapshot = {
            variantId: foundVariant.variantId,
            name: foundVariant.name,
            pricePaisa: foundVariant.pricePaisa,
          };
        }
      }

      const lineSubtotalPaisa = unitPricePaisa * quantity;
      const taxRatePercent = menuItem.taxRatePercent || 5;
      const taxAmountPaisa = roundToPaisa(lineSubtotalPaisa * (taxRatePercent / 100));
      const cgstPaisa = Math.floor(taxAmountPaisa / 2);
      const sgstPaisa = taxAmountPaisa - cgstPaisa;
      const lineTotalPaisa = lineSubtotalPaisa + taxAmountPaisa;

      roundSubtotalPaisa += lineSubtotalPaisa;
      roundTaxPaisa += taxAmountPaisa;

      verifiedLineItems.push({
        menuItemId: mId,
        itemNameSnapshot: menuItem.name,
        quantity,
        unitPricePaisa,
        lineSubtotalPaisa,
        taxRatePercent,
        cgstPaisa,
        sgstPaisa,
        lineTotalPaisa,
        modifiers: clientItem.modifiers || {},
        variantSnapshot,
        comboSnapshot: clientItem.comboSnapshot || null,
        itemNotes: String(clientItem.itemNotes || '').slice(0, 300),
      });
    }

    const roundTotalPaisa = roundSubtotalPaisa + roundTaxPaisa;

    // Find or create active TableSession for this table
    let session = null;
    if (table.activeSessionId) {
      session = await TableSession.findOne({
        sessionId: table.activeSessionId,
        status: 'ACTIVE',
      });
    }

    if (!session) {
      const sessionId = `TSESS-${Date.now()}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
      session = await TableSession.create({
        sessionId,
        organisationId,
        cafeId,
        tableId: table.tableId,
        tableNumber: table.tableNumber,
        covers: Number(customerInfo.covers) || 2,
        status: 'ACTIVE',
        customerName: customerInfo.name || 'Guest',
        customerPhone: customerInfo.phone || '',
        rounds: [],
        cumulativeTotalPaisa: 0,
      });

      table.activeSessionId = session.sessionId;
      table.status = 'OCCUPIED';
      await table.save();
    }

    // Construct new ordering round
    const roundNumber = (session.rounds ? session.rounds.length : 0) + 1;
    const roundId = `RND-${session.sessionId}-${roundNumber}`;
    const newRound = {
      roundId,
      roundNumber,
      channel: 'QR_ORDER',
      submittedAt: new Date(),
      lineItems: verifiedLineItems,
      roundSubtotalPaisa,
      roundTaxPaisa,
      roundTotalPaisa,
      status: 'RECEIVED',
    };

    session.rounds.push(newRound);
    session.cumulativeTotalPaisa = (session.cumulativeTotalPaisa || 0) + roundTotalPaisa;
    await session.save();

    // Create ChannelOrder record for operational channel visibility
    const orderId = `ORD-QR-${Date.now()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
    const orderNumber = `#T${table.tableNumber}-R${roundNumber}`;
    const channelOrder = await ChannelOrder.create({
      orderId,
      orderNumber,
      organisationId,
      cafeId,
      channel: 'QR_ORDER',
      fulfilmentMode: 'DINE_IN',
      tableNumber: table.tableNumber,
      tableSessionId: session.sessionId,
      customer: {
        name: customerInfo.name || session.customerName || 'Guest',
        phone: customerInfo.phone || session.customerPhone || '',
      },
      lineItems: verifiedLineItems,
      pricing: {
        subtotalPaisa: roundSubtotalPaisa,
        taxPaisa: roundTaxPaisa,
        totalPaisa: roundTotalPaisa,
      },
      paymentState: 'PENDING',
      status: 'ACCEPTED',
      idempotencyKey,
      lifecycleHistory: [
        {
          status: 'ACCEPTED',
          actorUserId: 'GUEST_QR',
          timestamp: new Date(),
          notes: `Round #${roundNumber} submitted from Table ${table.tableNumber}`,
        },
      ],
    });

    await auditService.recordAuditEvent({
      organisationId,
      cafeId,
      actorUserId: 'GUEST_QR',
      actorRole: 'GUEST',
      module: 'CHANNELS',
      action: 'QR_ORDER_ROUND_SUBMITTED',
      entityType: 'TABLE_SESSION',
      entityId: session.sessionId,
      reason: `Submitted Round #${roundNumber} for Table ${table.tableNumber}`,
      result: 'SUCCESS',
      metadata: { roundId, orderId, roundTotalPaisa },
    }).catch(() => {});

    return {
      success: true,
      sessionId: session.sessionId,
      roundId,
      roundNumber,
      orderId: channelOrder.orderId,
      orderNumber: channelOrder.orderNumber,
      tableNumber: table.tableNumber,
      lineItems: verifiedLineItems,
      roundTotalPaisa,
      sessionCumulativeTotalPaisa: session.cumulativeTotalPaisa,
    };
  }
}

module.exports = {
  QrOrderingService,
};
