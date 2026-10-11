'use strict';

/**
 * CHANNEL OPERATIONS CONTROLLER (P15 CHANNELS, QR ORDERING & FRONT SERVICE)
 *
 * Implements endpoints for:
 *   - Dining tables & table session billing
 *   - Universal table QR generation & rotation
 *   - Table reservations, host desk waitlists, and party seating
 *   - Direct web ordering & live channel order management
 *   - Front-service pickup tokens and privacy-safe public order display
 *   - Aggregator webhook intake and P12 settlement reconciliation
 */

const { TableService } = require('../services/tableService');
const { QrOrderingService } = require('../services/qrOrderingService');
const { TableReservationService } = require('../services/tableReservationService');
const { DirectOrderingService } = require('../services/directOrderingService');
const { FrontServiceTools } = require('../services/frontServiceTools');
const { AggregatorIntakeService } = require('../services/aggregatorIntakeService');
const { ChannelOrder } = require('../models/ChannelOrder');
const { OnlineChannelConfig } = require('../models/OnlineChannelConfig');
const { ApiError } = require('../utils/ApiError');

// ── Tables & Sessions ──

async function listTablesHandler(req, res, next) {
  try {
    const cafeId = req.query.cafeId || req.auth.primaryCafeId || 'ZC-0001';
    const tables = await TableService.listTables({
      cafeId,
      organisationId: req.auth.organisationId,
      authContext: req.auth,
    });
    return res.status(200).json({ success: true, data: tables });
  } catch (err) {
    next(err);
  }
}

async function createTableHandler(req, res, next) {
  try {
    const { tableNumber, section, seatingCapacity, cafeId } = req.body || {};
    const targetCafeId = cafeId || req.auth.primaryCafeId || 'ZC-0001';
    const table = await TableService.createTable({
      tableNumber,
      section,
      seatingCapacity,
      cafeId: targetCafeId,
      organisationId: req.auth.organisationId,
      authContext: req.auth,
    });
    return res.status(201).json({ success: true, data: table });
  } catch (err) {
    next(err);
  }
}

async function updateTableStatusHandler(req, res, next) {
  try {
    const { status, isServiceBlocked } = req.body || {};
    const cafeId = req.query.cafeId || req.body.cafeId || req.auth.primaryCafeId || 'ZC-0001';
    const table = await TableService.updateTableStatus({
      tableId: req.params.tableId,
      status,
      isServiceBlocked,
      cafeId,
      organisationId: req.auth.organisationId,
      authContext: req.auth,
    });
    return res.status(200).json({ success: true, data: table });
  } catch (err) {
    next(err);
  }
}

async function openTableSessionHandler(req, res, next) {
  try {
    const { tableId, covers, customerName, customerPhone, cafeId } = req.body || {};
    const targetCafeId = cafeId || req.auth.primaryCafeId || 'ZC-0001';
    const session = await TableService.openTableSession({
      tableId,
      covers,
      customerName,
      customerPhone,
      cafeId: targetCafeId,
      organisationId: req.auth.organisationId,
      authContext: req.auth,
    });
    return res.status(201).json({ success: true, data: session });
  } catch (err) {
    next(err);
  }
}

async function closeTableSessionHandler(req, res, next) {
  try {
    const { sessionId, paymentMethod, tenders, cashierUserId, cafeId } = req.body || {};
    const targetCafeId = cafeId || req.auth.primaryCafeId || 'ZC-0001';
    const result = await TableService.closeTableSessionAndBill({
      sessionId,
      paymentMethod,
      tenders,
      cashierUserId,
      cafeId: targetCafeId,
      organisationId: req.auth.organisationId,
      authContext: req.auth,
    });
    return res.status(200).json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}

// ── QR Codes ──

async function generateTableQrHandler(req, res, next) {
  try {
    const { tableId, tableNumber, cafeId } = req.body || {};
    const targetCafeId = cafeId || req.auth.primaryCafeId || 'ZC-0001';
    const result = await QrOrderingService.generateTableQr({
      cafeId: targetCafeId,
      tableId,
      tableNumber,
      organisationId: req.auth.organisationId,
      actorUserId: req.auth.userId,
    });
    return res.status(201).json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}

async function revokeTableQrHandler(req, res, next) {
  try {
    const { reason } = req.body || {};
    const revoked = await QrOrderingService.revokeTableQr({
      qrId: req.params.qrId,
      organisationId: req.auth.organisationId,
      actorUserId: req.auth.userId,
      reason,
    });
    return res.status(200).json({ success: true, data: revoked });
  } catch (err) {
    next(err);
  }
}

async function rotateTableQrHandler(req, res, next) {
  try {
    const fresh = await QrOrderingService.rotateTableQr({
      qrId: req.params.qrId,
      organisationId: req.auth.organisationId,
      actorUserId: req.auth.userId,
    });
    return res.status(200).json({ success: true, data: fresh });
  } catch (err) {
    next(err);
  }
}

// ── Reservations & Waitlist ──

async function listReservationsHandler(req, res, next) {
  try {
    const cafeId = req.query.cafeId || req.auth.primaryCafeId || 'ZC-0001';
    const summary = await TableReservationService.getHostDeskSummary({
      cafeId,
      organisationId: req.auth.organisationId,
      authContext: req.auth,
    });
    return res.status(200).json({ success: true, data: summary });
  } catch (err) {
    next(err);
  }
}

async function createReservationHandler(req, res, next) {
  try {
    const {
      guestName,
      guestPhone,
      guestEmail,
      partySize,
      bookingTime,
      durationMinutes,
      sectionPreference,
      specialRequests,
      sourceChannel,
      assignedTableId,
      cafeId,
    } = req.body || {};
    const targetCafeId = cafeId || req.auth.primaryCafeId || 'ZC-0001';

    const reservation = await TableReservationService.createReservation({
      cafeId: targetCafeId,
      guestName,
      guestPhone,
      guestEmail,
      partySize,
      bookingTime,
      durationMinutes,
      sectionPreference,
      specialRequests,
      sourceChannel,
      assignedTableId,
      organisationId: req.auth.organisationId,
      authContext: req.auth,
    });
    return res.status(201).json({ success: true, data: reservation });
  } catch (err) {
    next(err);
  }
}

async function updateReservationStatusHandler(req, res, next) {
  try {
    const { status, assignedTableId, cancellationReason, cafeId } = req.body || {};
    const targetCafeId = cafeId || req.auth.primaryCafeId || 'ZC-0001';
    const updated = await TableReservationService.updateReservationStatus({
      reservationId: req.params.reservationId,
      status,
      assignedTableId,
      cancellationReason,
      cafeId: targetCafeId,
      organisationId: req.auth.organisationId,
      authContext: req.auth,
    });
    return res.status(200).json({ success: true, data: updated });
  } catch (err) {
    next(err);
  }
}

async function addToWaitlistHandler(req, res, next) {
  try {
    const { guestName, guestPhone, partySize, sectionPreference, estimatedWaitMinutes, notes, cafeId } = req.body || {};
    const targetCafeId = cafeId || req.auth.primaryCafeId || 'ZC-0001';
    const entry = await TableReservationService.addToWaitlist({
      guestName,
      guestPhone,
      partySize,
      sectionPreference,
      estimatedWaitMinutes,
      notes,
      cafeId: targetCafeId,
      organisationId: req.auth.organisationId,
      authContext: req.auth,
    });
    return res.status(201).json({ success: true, data: entry });
  } catch (err) {
    next(err);
  }
}

async function seatWaitlistHandler(req, res, next) {
  try {
    const { waitlistId, tableId, cafeId } = req.body || {};
    const targetCafeId = cafeId || req.auth.primaryCafeId || 'ZC-0001';
    const result = await TableReservationService.seatWaitlistEntry({
      waitlistId,
      tableId,
      cafeId: targetCafeId,
      organisationId: req.auth.organisationId,
      authContext: req.auth,
    });
    return res.status(200).json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}

async function updateWaitlistStatusHandler(req, res, next) {
  try {
    const { status, cafeId } = req.body || {};
    const targetCafeId = cafeId || req.auth.primaryCafeId || 'ZC-0001';
    const updated = await TableReservationService.updateWaitlistStatus({
      waitlistId: req.params.waitlistId,
      status,
      cafeId: targetCafeId,
      organisationId: req.auth.organisationId,
      authContext: req.auth,
    });
    return res.status(200).json({ success: true, data: updated });
  } catch (err) {
    next(err);
  }
}

// ── Live Channel Orders & Config ──

async function listChannelOrdersHandler(req, res, next) {
  try {
    const cafeId = (req.query.cafeId || req.auth.primaryCafeId || 'ZC-0001').trim().toUpperCase();
    const filter = { organisationId: req.auth.organisationId, cafeId };
    if (req.query.status) filter.status = req.query.status;
    if (req.query.channel) filter.channel = req.query.channel;

    const orders = await ChannelOrder.find(filter)
      .sort({ receivedAt: -1 })
      .limit(100)
      .lean();

    return res.status(200).json({ success: true, data: orders });
  } catch (err) {
    next(err);
  }
}

async function updateOrderStatusHandler(req, res, next) {
  try {
    const { status, reason, cafeId } = req.body || {};
    const targetCafeId = cafeId || req.auth.primaryCafeId || 'ZC-0001';
    const updated = await DirectOrderingService.updateOrderStatus({
      orderId: req.params.orderId,
      status,
      reason,
      cafeId: targetCafeId,
      organisationId: req.auth.organisationId,
      authContext: req.auth,
    });
    return res.status(200).json({ success: true, data: updated });
  } catch (err) {
    next(err);
  }
}

async function getChannelConfigHandler(req, res, next) {
  try {
    const cafeId = (req.query.cafeId || req.auth.primaryCafeId || 'ZC-0001').trim().toUpperCase();
    let config = await OnlineChannelConfig.findOne({
      organisationId: req.auth.organisationId,
      cafeId,
    }).lean();

    if (!config) {
      config = await OnlineChannelConfig.create({
        organisationId: req.auth.organisationId,
        cafeId,
      });
    }

    return res.status(200).json({ success: true, data: config });
  } catch (err) {
    next(err);
  }
}

async function updateChannelConfigHandler(req, res, next) {
  try {
    const cafeId = (req.body.cafeId || req.auth.primaryCafeId || 'ZC-0001').trim().toUpperCase();
    const update = req.body.config || req.body;

    const config = await OnlineChannelConfig.findOneAndUpdate(
      { organisationId: req.auth.organisationId, cafeId },
      { $set: update },
      { new: true, upsert: true }
    );

    return res.status(200).json({ success: true, data: config });
  } catch (err) {
    next(err);
  }
}

// ── Pickup Tokens ──

async function listPickupTokensHandler(req, res, next) {
  try {
    const cafeId = req.query.cafeId || req.auth.primaryCafeId || 'ZC-0001';
    const tokens = await FrontServiceTools.listPickupTokens({
      cafeId,
      organisationId: req.auth.organisationId,
      authContext: req.auth,
    });
    return res.status(200).json({ success: true, data: tokens });
  } catch (err) {
    next(err);
  }
}

async function createPickupTokenHandler(req, res, next) {
  try {
    const { orderReference, channel, pickupCounter, cafeId } = req.body || {};
    const targetCafeId = cafeId || req.auth.primaryCafeId || 'ZC-0001';
    const token = await FrontServiceTools.assignPickupToken({
      orderReference,
      channel,
      pickupCounter,
      cafeId: targetCafeId,
      organisationId: req.auth.organisationId,
      authContext: req.auth,
    });
    return res.status(201).json({ success: true, data: token });
  } catch (err) {
    next(err);
  }
}

async function updatePickupTokenStatusHandler(req, res, next) {
  try {
    const { status, cafeId } = req.body || {};
    const targetCafeId = cafeId || req.auth.primaryCafeId || 'ZC-0001';
    const token = await FrontServiceTools.updatePickupTokenStatus({
      tokenId: req.params.tokenId,
      status,
      cafeId: targetCafeId,
      organisationId: req.auth.organisationId,
      authContext: req.auth,
    });
    return res.status(200).json({ success: true, data: token });
  } catch (err) {
    next(err);
  }
}

// ── Aggregator Payout Reconciliation ──

async function reconcileAggregatorPayoutsHandler(req, res, next) {
  try {
    const { settlementId, cafeId } = req.body || {};
    const result = await AggregatorIntakeService.reconcilePayoutsAgainstSettlement({
      settlementId,
      cafeId,
      organisationId: req.auth.organisationId,
    });
    return res.status(200).json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}

// ── Public Guest Endpoints (Unauthenticated) ──

async function publicGetGuestMenuHandler(req, res, next) {
  try {
    const { token } = req.params;
    const menu = await QrOrderingService.getGuestMenu({ qrToken: token });
    return res.status(200).json({ success: true, data: menu });
  } catch (err) {
    next(err);
  }
}

async function publicSubmitOrderRoundHandler(req, res, next) {
  try {
    const { token } = req.params;
    const { lineItems, customerInfo, challengeId, idempotencyKey } = req.body || {};
    const round = await QrOrderingService.submitGuestOrderRound({
      qrToken: token,
      lineItems,
      customerInfo,
      challengeId,
      idempotencyKey,
    });
    return res.status(201).json({ success: true, data: round });
  } catch (err) {
    next(err);
  }
}

async function publicCreateChallengeHandler(req, res, next) {
  try {
    const { phone, cafeId, organisationId = 'ORG-ZAMORIN' } = req.body || {};
    const challenge = await QrOrderingService.createVerificationChallenge({
      phone,
      cafeId: cafeId || 'ZC-0001',
      organisationId,
    });
    return res.status(200).json({ success: true, data: challenge });
  } catch (err) {
    next(err);
  }
}

async function publicVerifyChallengeHandler(req, res, next) {
  try {
    const { challengeId, code } = req.body || {};
    const result = await QrOrderingService.verifyChallenge({ challengeId, code });
    return res.status(200).json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}

async function publicGetWebMenuHandler(req, res, next) {
  try {
    const { cafeId } = req.params;
    const menu = await DirectOrderingService.getWebMenu({
      cafeId,
      organisationId: req.query.organisationId || 'ORG-ZAMORIN',
    });
    return res.status(200).json({ success: true, data: menu });
  } catch (err) {
    next(err);
  }
}

async function publicSubmitDirectOrderHandler(req, res, next) {
  try {
    const {
      cafeId,
      fulfilmentMode,
      customer,
      lineItems,
      paymentMethod,
      paymentReference,
      idempotencyKey,
      organisationId = 'ORG-ZAMORIN',
    } = req.body || {};

    const order = await DirectOrderingService.submitDirectWebOrder({
      cafeId,
      fulfilmentMode,
      customer,
      lineItems,
      paymentMethod,
      paymentReference,
      idempotencyKey,
      organisationId,
    });
    return res.status(201).json({ success: true, data: order });
  } catch (err) {
    next(err);
  }
}

async function publicGetOrderStatusHandler(req, res, next) {
  try {
    const { orderReference } = req.params;
    const status = await DirectOrderingService.getDirectOrderStatus({ orderReference });
    return res.status(200).json({ success: true, data: status });
  } catch (err) {
    next(err);
  }
}

async function publicGetPickupDisplayHandler(req, res, next) {
  try {
    const { cafeId } = req.params;
    const display = await FrontServiceTools.getPublicPickupStatusDisplay({
      cafeId,
      organisationId: req.query.organisationId || 'ORG-ZAMORIN',
    });
    return res.status(200).json({ success: true, data: display });
  } catch (err) {
    next(err);
  }
}

async function publicAggregatorWebhookHandler(req, res, next) {
  try {
    const { provider } = req.params;
    const signature = req.headers['x-signature'] || req.headers['x-zomato-signature'] || req.headers['x-swiggy-signature'];
    const result = await AggregatorIntakeService.processWebhookIntake({
      provider,
      payload: req.body,
      signature,
      rawBody: req.rawBody,
      organisationId: req.query.organisationId || 'ORG-ZAMORIN',
      cafeId: req.query.cafeId,
    });
    return res.status(200).json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  // Tables & Sessions
  listTablesHandler,
  createTableHandler,
  updateTableStatusHandler,
  openTableSessionHandler,
  closeTableSessionHandler,
  // QR Codes
  generateTableQrHandler,
  revokeTableQrHandler,
  rotateTableQrHandler,
  // Reservations & Waitlist
  listReservationsHandler,
  createReservationHandler,
  updateReservationStatusHandler,
  addToWaitlistHandler,
  seatWaitlistHandler,
  updateWaitlistStatusHandler,
  // Channel Orders & Config
  listChannelOrdersHandler,
  updateOrderStatusHandler,
  getChannelConfigHandler,
  updateChannelConfigHandler,
  // Pickup Tokens
  listPickupTokensHandler,
  createPickupTokenHandler,
  updatePickupTokenStatusHandler,
  // Aggregator Payouts
  reconcileAggregatorPayoutsHandler,
  // Public Guest
  publicGetGuestMenuHandler,
  publicSubmitOrderRoundHandler,
  publicCreateChallengeHandler,
  publicVerifyChallengeHandler,
  publicGetWebMenuHandler,
  publicSubmitDirectOrderHandler,
  publicGetOrderStatusHandler,
  publicGetPickupDisplayHandler,
  publicAggregatorWebhookHandler,
};
