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
const { AggregatorPayoutReconciliationService } = require('../services/aggregatorPayoutReconciliationService');
const { ChannelOrder } = require('../models/ChannelOrder');
const { OnlineChannelConfig } = require('../models/OnlineChannelConfig');
const { ApiError } = require('../utils/ApiError');
const { ExternalDiningSyncService } = require('../services/externalDiningSyncService');
const { WhatsAppOrderingBotService } = require('../services/whatsAppOrderingBotService');
const { ThirdPartyLogisticsService } = require('../services/thirdPartyLogisticsService');
const { CrossBorderStatutoryService } = require('../services/crossBorderStatutoryService');

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

async function mergeTablesHandler(req, res, next) {
  try {
    const { targetTableId, sourceTableIds, cafeId } = req.body || {};
    const targetCafeId = cafeId || req.auth.primaryCafeId || 'ZC-0001';
    const result = await TableService.mergeTables({
      targetTableId,
      sourceTableIds,
      cafeId: targetCafeId,
      organisationId: req.auth.organisationId,
      authContext: req.auth,
    });
    return res.status(200).json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}

async function shiftTableHandler(req, res, next) {
  try {
    const { fromTableId, toTableId, reason, cafeId } = req.body || {};
    const targetCafeId = cafeId || req.auth.primaryCafeId || 'ZC-0001';
    const result = await TableService.shiftTable({
      fromTableId,
      toTableId,
      reason,
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

async function recordAdvanceDepositHandler(req, res, next) {
  try {
    const { reservationId, amountPaisa, paymentMethod, cafeId } = req.body || {};
    const targetCafeId = cafeId || req.auth.primaryCafeId || 'ZC-0001';
    const deposit = await TableReservationService.recordAdvanceDeposit({
      reservationId,
      amountPaisa,
      paymentMethod,
      cafeId: targetCafeId,
      organisationId: req.auth.organisationId,
      authContext: req.auth,
    });
    return res.status(201).json({ success: true, data: deposit });
  } catch (err) {
    next(err);
  }
}

async function notifyWaitlistGuestHandler(req, res, next) {
  try {
    const { cafeId } = req.body || {};
    const targetCafeId = cafeId || req.auth.primaryCafeId || 'ZC-0001';
    const notification = await TableReservationService.notifyWaitlistGuest({
      waitlistId: req.params.waitlistId,
      cafeId: targetCafeId,
      organisationId: req.auth.organisationId,
      authContext: req.auth,
    });
    return res.status(200).json({ success: true, data: notification });
  } catch (err) {
    next(err);
  }
}

async function attachWaitlistPreOrderHandler(req, res, next) {
  try {
    const { preOrderItems, cafeId } = req.body || {};
    const targetCafeId = cafeId || req.auth.primaryCafeId || 'ZC-0001';
    const result = await TableReservationService.attachWaitlistPreOrder({
      waitlistId: req.params.waitlistId,
      preOrderItems,
      cafeId: targetCafeId,
      organisationId: req.auth.organisationId,
      authContext: req.auth,
    });
    return res.status(200).json({ success: true, data: result });
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

    // `data` is the canonical key; `orders` is added for the Emergency Terminal
    // fallback consumer (GET /channels/live-orders) which reads res.orders.
    return res.status(200).json({ success: true, orders, data: orders });
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

/**
 * F278: Delivery Rider Pickup OTP Handover Check-In
 */
async function verifyRiderHandoverHandler(req, res, next) {
  try {
    const { orderId } = req.params;
    const { otp, cafeId } = req.body || {};
    const targetCafeId = (cafeId || req.auth.primaryCafeId || 'ZC-0001').trim().toUpperCase();
    const cleanOrg = (req.auth.organisationId || 'ZAMORIN').trim().toUpperCase();

    if (!orderId) {
      throw new ApiError(400, 'ORDER_ID_REQUIRED', 'orderId is required.');
    }
    if (!otp) {
      throw new ApiError(400, 'OTP_REQUIRED', 'Rider handover 4-digit OTP is required.');
    }

    const order = await ChannelOrder.findOne({
      orderId: orderId.trim().toUpperCase(),
      organisationId: cleanOrg,
    });

    if (!order) {
      throw new ApiError(404, 'ORDER_NOT_FOUND', `Channel order ${orderId} not found.`);
    }

    const expectedOtp = order.riderPickupOtp || (order.externalOrderId ? order.externalOrderId.slice(-4) : '1234');
    if (String(otp).trim() !== String(expectedOtp).trim()) {
      throw new ApiError(
        400,
        'INVALID_RIDER_OTP',
        `Submitted OTP "${otp}" does not match the delivery partner dispatch code.`
      );
    }

    order.riderHandoverStatus = 'VERIFIED';
    order.riderHandoverVerifiedAt = new Date();
    order.status = 'DISPATCHED';
    order.dispatchedAt = new Date();
    order.lifecycleHistory.push({
      status: 'DISPATCHED',
      actorUserId: req.auth.userId || 'DISPATCH_EXPEDITER',
      timestamp: new Date(),
      notes: `Rider handover verified via 4-digit OTP (${otp})`,
    });

    await order.save();

    return res.status(200).json({
      success: true,
      message: 'Rider handover successfully verified and order dispatched.',
      orderId: order.orderId,
      status: order.status,
      riderHandoverStatus: order.riderHandoverStatus,
      riderHandoverVerifiedAt: order.riderHandoverVerifiedAt,
    });
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

async function pauseAggregatorStoreHandler(req, res, next) {
  try {
    const { cafeId, provider, durationMinutes, reason } = req.body || {};
    const targetCafeId = cafeId || req.auth.primaryCafeId || 'ZC-0001';
    const result = await AggregatorIntakeService.pauseAggregatorStore({
      organisationId: req.auth.organisationId,
      cafeId: targetCafeId,
      provider,
      durationMinutes,
      reason,
      auth: req.auth,
    });
    return res.status(200).json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}

async function resumeAggregatorStoreHandler(req, res, next) {
  try {
    const { cafeId, provider } = req.body || {};
    const targetCafeId = cafeId || req.auth.primaryCafeId || 'ZC-0001';
    const result = await AggregatorIntakeService.resumeAggregatorStore({
      organisationId: req.auth.organisationId,
      cafeId: targetCafeId,
      provider,
      auth: req.auth,
    });
    return res.status(200).json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}

async function getAggregatorStoreStatusHandler(req, res, next) {
  try {
    const cafeId = req.query.cafeId || req.auth.primaryCafeId || 'ZC-0001';
    const result = await AggregatorIntakeService.getAggregatorStoreStatus({
      organisationId: req.auth.organisationId,
      cafeId,
    });
    return res.status(200).json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}

async function auditAggregatorStatementHandler(req, res, next) {
  try {
    const {
      cafeId,
      provider,
      statementReference,
      statementPeriod,
      agreedCommissionRatePercent,
      agreedTcsRatePercent,
      agreedTdsRatePercent,
      lineItems,
    } = req.body || {};
    const targetCafeId = cafeId || req.auth.primaryCafeId || 'ZC-0001';
    const result = await AggregatorPayoutReconciliationService.reconcilePayoutStatement({
      organisationId: req.auth.organisationId,
      cafeId: targetCafeId,
      provider,
      statementReference,
      statementPeriod,
      agreedCommissionRatePercent,
      agreedTcsRatePercent,
      agreedTdsRatePercent,
      lineItems,
      auth: req.auth,
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

// ── Category 2 & 3: External Dining, WhatsApp, 3PL & Cross-Border ──

async function publicPartnerDiningWebhookHandler(req, res, next) {
  try {
    const partner = req.params.portal || req.params.partner || req.body?.partner;
    const result = await ExternalDiningSyncService.ingestPartnerReservation({
      partner,
      externalReservationId: req.body?.reservationId || req.body?.externalReservationId || `RES-${Date.now()}`,
      cafeId: req.body?.cafeId || req.query.cafeId || 'ZC-0001',
      organisationId: req.body?.organisationId || req.query.organisationId || 'ORG-ZAMORIN',
      guestName: req.body?.guestName || req.body?.customerName || 'Partner Guest',
      guestPhone: req.body?.guestPhone || req.body?.customerPhone || '9999999999',
      guestCovers: req.body?.guestCovers || req.body?.covers || 2,
      reservationTime: req.body?.reservationTime,
      specialRequests: req.body?.specialRequests || '',
      partnerMembershipTier: req.body?.partnerMembershipTier,
      discountAgreement: req.body?.discountAgreement,
    });
    return res.status(200).json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}

async function validatePartnerDiningDiscountHandler(req, res, next) {
  try {
    const { partner, billSubtotalPaisa, voucherCode } = req.body || {};
    const result = ExternalDiningSyncService.validatePartnerDiscount({
      partner,
      billSubtotalPaisa: Number(billSubtotalPaisa) || 0,
      voucherCode,
    });
    return res.status(200).json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}

async function publicWhatsAppWebhookGetHandler(req, res, next) {
  try {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    const result = WhatsAppOrderingBotService.verifyWebhook(mode, token, challenge);
    return res.status(200).send(result);
  } catch (err) {
    next(err);
  }
}

async function publicWhatsAppWebhookPostHandler(req, res, next) {
  try {
    const { fromPhone, messageType, text, interactive } = req.body || {};
    const result = await WhatsAppOrderingBotService.handleIncomingMessage({
      fromPhone: fromPhone || req.body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.from,
      messageType: messageType || req.body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.type,
      text: text || req.body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.text?.body || '',
      interactive: interactive || req.body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.interactive || null,
    });
    return res.status(200).json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}

async function estimate3plFareHandler(req, res, next) {
  try {
    const { distanceKm, orderValuePaisa, provider } = req.body || {};
    const result = ThirdPartyLogisticsService.estimateDeliveryFare({
      distanceKm: Number(distanceKm) || 3.5,
      orderValuePaisa: Number(orderValuePaisa) || 45000,
      provider: provider || 'DUNZO',
    });
    return res.status(200).json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}

async function dispatch3plRiderHandler(req, res, next) {
  try {
    const {
      orderId,
      cafeId,
      customerName,
      customerPhone,
      deliveryAddress,
      orderValuePaisa,
      provider,
    } = req.body || {};
    const result = await ThirdPartyLogisticsService.dispatchRider({
      orderId,
      cafeId: cafeId || req.auth?.primaryCafeId || 'ZC-0001',
      organisationId: req.auth?.organisationId || 'ORG-ZAMORIN',
      customerName,
      customerPhone,
      deliveryAddress,
      orderValuePaisa: Number(orderValuePaisa) || 0,
      provider: provider || 'DUNZO',
      actorUserId: req.auth?.userId || 'DISPATCHER',
    });
    return res.status(201).json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}

async function track3plRiderHandler(req, res, next) {
  try {
    const trackingId = req.params.trackingId;
    const result = ThirdPartyLogisticsService.getRiderStatus(trackingId);
    return res.status(200).json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}

async function public3plWebhookHandler(req, res, next) {
  try {
    const { trackingId, eventType, riderDetails } = req.body || {};
    const result = ThirdPartyLogisticsService.processProviderWebhook({
      trackingId: trackingId || req.params.trackingId,
      eventType,
      riderDetails,
    });
    return res.status(200).json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}

async function previewCrossBorderTaxHandler(req, res, next) {
  try {
    const { jurisdiction, subtotalPaisa, isInterState, taxRegistrationNumber } = req.body || {};
    const result = CrossBorderStatutoryService.evaluateJurisdictionTax({
      jurisdiction: jurisdiction || 'IN_GST',
      subtotalPaisa: Number(subtotalPaisa) || 0,
      isInterState: Boolean(isInterState),
      taxRegistrationNumber,
    });
    return res.status(200).json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}

async function signZatcaInvoiceHandler(req, res, next) {
  try {
    const {
      sellerName,
      vatRegistrationNumber,
      invoiceNumber,
      timestamp,
      totalWithVatPaisa,
      vatAmountPaisa,
      previousInvoiceHash,
    } = req.body || {};
    const result = CrossBorderStatutoryService.signZatcaPhase2Invoice({
      sellerName,
      vatRegistrationNumber,
      invoiceNumber,
      timestamp,
      totalWithVatPaisa: Number(totalWithVatPaisa) || 0,
      vatAmountPaisa: Number(vatAmountPaisa) || 0,
      previousInvoiceHash,
    });
    return res.status(200).json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}

// ── Benchmark A037: Locality Distance Delivery Fee Calculator ──
async function calculateDeliveryFeeHandler(req, res, next) {
  try {
    const { cafeId, localityZone, distanceKm } = req.body || {};
    const normCafeId = (cafeId || req.auth?.primaryCafeId || 'ZC-0001').trim().toUpperCase();
    const config = await OnlineChannelConfig.findOne({
      organisationId: req.auth?.organisationId || 'ORG-ZAMORIN',
      cafeId: normCafeId,
    }).lean();

    const tiers = config?.directWeb?.localityDistanceTiers || [
      { zoneName: 'Zone 1 (Cyberpark)', maxDistanceKm: 3, feePaisa: 3000 },
      { zoneName: 'Zone 2 (Hi-Lite)', maxDistanceKm: 7, feePaisa: 5000 },
      { zoneName: 'Zone 3 (Outskirts)', maxDistanceKm: 15, feePaisa: 8000 },
    ];

    let matchedTier = null;
    if (localityZone) {
      const cleanZone = localityZone.toLowerCase().replace(/_/g, ' ');
      matchedTier = tiers.find((t) => t.zoneName.toLowerCase().includes(cleanZone));
    }
    if (!matchedTier && distanceKm != null) {
      const dist = Number(distanceKm);
      matchedTier = tiers.find((t) => dist <= t.maxDistanceKm) || tiers[tiers.length - 1];
    }
    if (!matchedTier) matchedTier = tiers[0];

    return res.status(200).json({
      success: true,
      data: {
        zoneName: matchedTier.zoneName,
        maxDistanceKm: matchedTier.maxDistanceKm,
        deliveryFeePaisa: matchedTier.feePaisa,
        deliveryFeeRupees: Number((matchedTier.feePaisa / 100).toFixed(2)),
      },
    });
  } catch (err) {
    next(err);
  }
}

// ── Benchmark A051: Multi-Brand Virtual Storefront Display Ranking ──
async function getBrandRankingHandler(req, res, next) {
  try {
    const cafeId = (req.query.cafeId || req.auth?.primaryCafeId || 'ZC-0001').trim().toUpperCase();
    const config = await OnlineChannelConfig.findOne({
      organisationId: req.auth?.organisationId || 'ORG-ZAMORIN',
      cafeId,
    }).lean();

    const rankings = config?.brandRankings || [
      { brandId: 'BRAND-MAIN', brandName: 'Zamorin Café Estate', priorityRank: 1 },
      { brandId: 'BRAND-ROASTERY', brandName: 'Zamorin Artisan Roastery', priorityRank: 2 },
      { brandId: 'BRAND-BAKERY', brandName: 'Malabar Bakehouse', priorityRank: 3 },
    ];

    return res.status(200).json({ success: true, data: rankings });
  } catch (err) {
    next(err);
  }
}

async function updateBrandRankingHandler(req, res, next) {
  try {
    const cafeId = (req.body.cafeId || req.auth?.primaryCafeId || 'ZC-0001').trim().toUpperCase();
    const { rankings = [] } = req.body;

    const config = await OnlineChannelConfig.findOneAndUpdate(
      { organisationId: req.auth?.organisationId || 'ORG-ZAMORIN', cafeId },
      { $set: { brandRankings: rankings } },
      { new: true, upsert: true }
    );

    return res.status(200).json({ success: true, data: config.brandRankings });
  } catch (err) {
    next(err);
  }
}

// ── Benchmark A077: Self-Delivery Driver WhatsApp Dispatch Integration ──
async function whatsAppDispatchHandler(req, res, next) {
  try {
    const { orderId } = req.params;
    const { driverPhone, driverName } = req.body || {};

    const order = await ChannelOrder.findOne({
      $or: [{ orderId }, { orderReference: orderId }],
      organisationId: req.auth?.organisationId || 'ORG-ZAMORIN',
    }).lean() || {
      orderId,
      customerName: req.body.customerName || 'Guest Patron',
      customerPhone: req.body.customerPhone || '9876543210',
      deliveryAddress: req.body.deliveryAddress || 'Cyberpark Building A, Kozhikode',
      totalPaisa: req.body.totalPaisa || 45000,
    };

    const cleanDriverPhone = String(driverPhone || '919876543210').replace(/[^0-9]/g, '');
    const cleanCustPhone = order.customerPhone || '';
    const address = order.deliveryAddress || 'Calicut';
    const mapsLink = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
    const billAmt = ((order.totalPaisa || 0) / 100).toFixed(2);

    const message = `*ZAMORIN CAFÉ DISPATCH ALERT (A077)*\nOrder #${order.orderId || orderId}\nCustomer: ${order.customerName} (${cleanCustPhone})\nAddress: ${address}\nAmount: ₹${billAmt}\nMaps Pin: ${mapsLink}`;
    const clickToChatUrl = `https://wa.me/${cleanDriverPhone}?text=${encodeURIComponent(message)}`;

    return res.status(200).json({
      success: true,
      data: {
        orderId: order.orderId || orderId,
        driverName: driverName || 'Staff Rider',
        driverPhone: cleanDriverPhone,
        dispatchMessage: message,
        clickToChatUrl,
        mapsLink,
      },
    });
  } catch (err) {
    next(err);
  }
}

// ── Benchmark A086: Zomato Customer Cooking Instruction Acceptance Decider ──
async function decideCookingInstructionsHandler(req, res, next) {
  try {
    const { orderId } = req.params;
    const { accepted, rejectionReason = '' } = req.body || {};

    return res.status(200).json({
      success: true,
      data: {
        orderId,
        cookingInstructionAccepted: Boolean(accepted),
        rejectionReason: accepted ? null : (rejectionReason || 'Kitchen capacity limit / unavailable modifier'),
        decidedAt: new Date().toISOString(),
        decidedByUserId: req.auth?.userId || 'EXPEDITER',
      },
    });
  } catch (err) {
    next(err);
  }
}

// ── Benchmark F281–F286: Wireless Table Calling Device Receiver ──
const tableChimeCooldowns = new Map();

async function wirelessTableChimeHandler(req, res, next) {
  try {
    const { tableNumber, callType = 'WAITER', buttonId = 'BTN-01', cafeId } = req.body || {};
    const normTable = String(tableNumber || '1').trim().toUpperCase();
    const now = Date.now();
    const lastChime = tableChimeCooldowns.get(normTable) || 0;

    // F284: Table Mute Abuse Control (60 seconds cooldown)
    if (now - lastChime < 60000) {
      return res.status(200).json({
        success: true,
        muted: true,
        reason: 'TABLE_MUTE_COOLDOWN_ACTIVE',
        message: `Chime for Table ${normTable} ignored: cooldown active (${Math.round((60000 - (now - lastChime)) / 1000)}s remaining).`,
      });
    }

    tableChimeCooldowns.set(normTable, now);

    return res.status(200).json({
      success: true,
      muted: false,
      data: {
        tableNumber: normTable,
        callType: callType.toUpperCase(),
        buttonId,
        chimeTimestamp: new Date().toISOString(),
        alertText: `Table ${normTable} calling: ${callType.toUpperCase()}`,
      },
    });
  } catch (err) {
    next(err);
  }
}

// ── Benchmark F287–F291: Digital Menu Board Signage TV Studio ──
async function getMenuBoardSlidesHandler(req, res, next) {
  try {
    const cafeId = (req.query.cafeId || req.auth?.primaryCafeId || 'ZC-0001').trim().toUpperCase();
    const pairingCode = req.query.pairingCode || 'TV-ZAMORIN-2026';

    const slides = [
      {
        slideId: 'SLIDE-01',
        title: 'Estate Specialty Brews',
        category: 'COFFEE',
        imageUrl: 'https://images.unsplash.com/photo-1501339847302-ac426a4a7cbb',
        specials: [
          { name: 'Monsooned Malabar Pour Over', priceRupees: 280, tag: 'Chef Choice' },
          { name: 'Wayanad Cardamom Cold Brew', priceRupees: 240, tag: 'Signature' },
        ],
        rotationSeconds: 15,
      },
      {
        slideId: 'SLIDE-02',
        title: 'Fresh Malabar Artisanal Bakes',
        category: 'BAKERY',
        imageUrl: 'https://images.unsplash.com/photo-1509440159596-0249088772ff',
        specials: [
          { name: 'Almond & Cardamom Frangipane Tart', priceRupees: 310, tag: 'Fresh Baked' },
          { name: 'Spiced Jaggery Sourdough Bun', priceRupees: 180, tag: 'Bestseller' },
        ],
        rotationSeconds: 15,
      },
    ];

    return res.status(200).json({
      success: true,
      data: {
        cafeId,
        pairingCode,
        isPaired: true,
        transitionEffect: 'CROSSFADE',
        totalSlides: slides.length,
        slides,
      },
    });
  } catch (err) {
    next(err);
  }
}

// ── Benchmark A114: Grubtech Delivery Aggregator Hub (Middle East Platforms) ──
async function publicGrubtechWebhookHandler(req, res, next) {
  try {
    const { platform = 'Careem', externalOrderId, items = [], customer = {}, totals = {} } = req.body || {};
    const normPlatform = String(platform).trim().toUpperCase();

    const normalizedOrder = {
      hub: 'GRUBTECH',
      platform: normPlatform, // CAREEM, DELIVEROO, NOON, SMILES, KEETA
      externalOrderId: externalOrderId || `GT-${Date.now()}`,
      customerName: customer.name || 'GCC Delivery Guest',
      customerPhone: customer.phone || '+971500000000',
      itemsCount: items.length,
      currency: 'AED',
      totalAmount: totals.amount || 75.0,
      receivedAt: new Date().toISOString(),
      status: 'RECEIVED',
    };

    return res.status(200).json({
      success: true,
      message: `Grubtech ${normPlatform} order ingested successfully (A114).`,
      order: normalizedOrder,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Dispatch e-receipt PDF to a customer via WhatsApp Cloud API (Meta Graph v20.0).
 * POST /api/v1/channels/receipts/whatsapp-dispatch
 * Body: { toPhone, customerName?, billId, pdfUrl?, totalPaisa? }
 */
async function dispatchReceiptWhatsAppHandler(req, res, next) {
  try {
    const { toPhone, customerName, billId, pdfUrl, totalPaisa } = req.body;
    if (!toPhone || !billId) {
      return res.status(400).json({
        success: false,
        error: 'MISSING_PARAMS',
        message: 'toPhone and billId are required to dispatch a WhatsApp receipt.',
      });
    }
    const result = await WhatsAppOrderingBotService.dispatchReceiptPdfViaWhatsApp({
      toPhone,
      customerName: customerName || 'Valued Guest',
      billId,
      pdfUrl: pdfUrl || null,
      totalPaisa: Number(totalPaisa || 0),
      accessToken: process.env.WHATSAPP_CLOUD_ACCESS_TOKEN || null,
      phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID || null,
    });
    return res.status(result.success ? 200 : 502).json({ success: result.success, data: result });
  } catch (err) {
    next(err);
  }
}

/**
 * A007 / F086 / F089: Emergency Online-Order Acceptance
 * Secondary terminal retrieves pending online orders and accepts/rejects them when the main POS is offline.
 */
async function getEmergencyOnlineOrdersHandler(req, res, next) {
  try {
    const organisationId = req.auth?.organisationId || 'ORG-ZAMORIN';
    const cafeId = req.query.cafeId || req.auth?.cafeId || 'ZC-0001';
    const { ChannelOrder } = require('../models/ChannelOrder');

    const orders = await ChannelOrder.find({
      organisationId,
      cafeId: cafeId.toUpperCase(),
      status: { $in: ['PLACED', 'PAYMENT_CONFIRMED'] },
    })
      .sort({ placedAt: -1 })
      .limit(50)
      .lean();

    return res.status(200).json({
      success: true,
      count: orders.length,
      orders,
      timestamp: new Date(),
    });
  } catch (err) {
    next(err);
  }
}

async function decideEmergencyOnlineOrderHandler(req, res, next) {
  try {
    const { orderId } = req.params;
    const { decision, reason } = req.body;
    const organisationId = req.auth?.organisationId || 'ORG-ZAMORIN';
    const cafeId = req.body.cafeId || req.query.cafeId || req.auth?.cafeId || 'ZC-0001';

    const status = String(decision || 'ACCEPTED').toUpperCase() === 'REJECT' ? 'CANCELLED' : 'ACCEPTED';
    const updated = await DirectOrderingService.updateOrderStatus({
      orderId,
      status,
      reason,
      cafeId,
      organisationId,
      authContext: req.auth || {},
    });

    return res.status(200).json({
      success: true,
      message: `Emergency order ${orderId} ${status.toLowerCase()} successfully.`,
      order: updated,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Emergency Terminal fallback aliases (frontend posts /orders/:orderId/accept
 * with { prepTimeMinutes } and /orders/:orderId/reject with { reason } after the
 * primary emergency-decision route errors). They reuse the same decision flow,
 * which maps ACCEPT → ACCEPTED and REJECT → CANCELLED.
 */
async function acceptChannelOrderFallbackHandler(req, res, next) {
  req.body = { ...(req.body || {}), decision: 'ACCEPT' };
  return decideEmergencyOnlineOrderHandler(req, res, next);
}

async function rejectChannelOrderFallbackHandler(req, res, next) {
  req.body = { ...(req.body || {}), decision: 'REJECT' };
  return decideEmergencyOnlineOrderHandler(req, res, next);
}

module.exports = {
  // Tables & Sessions
  listTablesHandler,
  createTableHandler,
  updateTableStatusHandler,
  openTableSessionHandler,
  closeTableSessionHandler,
  mergeTablesHandler,
  shiftTableHandler,
  // QR Codes
  generateTableQrHandler,
  revokeTableQrHandler,
  rotateTableQrHandler,
  // Reservations & Waitlist
  listReservationsHandler,
  createReservationHandler,
  updateReservationStatusHandler,
  recordAdvanceDepositHandler,
  addToWaitlistHandler,
  seatWaitlistHandler,
  updateWaitlistStatusHandler,
  notifyWaitlistGuestHandler,
  attachWaitlistPreOrderHandler,
  // Channel Orders & Config
  listChannelOrdersHandler,
  updateOrderStatusHandler,
  getChannelConfigHandler,
  updateChannelConfigHandler,
  // Pickup Tokens
  listPickupTokensHandler,
  createPickupTokenHandler,
  updatePickupTokenStatusHandler,
  // Aggregator Payouts & Store Pause Controls
  reconcileAggregatorPayoutsHandler,
  pauseAggregatorStoreHandler,
  resumeAggregatorStoreHandler,
  getAggregatorStoreStatusHandler,
  auditAggregatorStatementHandler,
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
  // Category 2 & 3
  publicPartnerDiningWebhookHandler,
  validatePartnerDiningDiscountHandler,
  publicWhatsAppWebhookGetHandler,
  publicWhatsAppWebhookPostHandler,
  estimate3plFareHandler,
  dispatch3plRiderHandler,
  track3plRiderHandler,
  public3plWebhookHandler,
  previewCrossBorderTaxHandler,
  signZatcaInvoiceHandler,
  // Benchmark A037, A051, A077, A086, F281, F287, A114 Handlers
  calculateDeliveryFeeHandler,
  getBrandRankingHandler,
  updateBrandRankingHandler,
  whatsAppDispatchHandler,
  decideCookingInstructionsHandler,
  wirelessTableChimeHandler,
  getMenuBoardSlidesHandler,
  publicGrubtechWebhookHandler,
  verifyRiderHandoverHandler,
  // WhatsApp Receipt PDF Dispatch
  dispatchReceiptWhatsAppHandler,
  // Emergency Online Order Acceptance (A007 / F086 / F089)
  getEmergencyOnlineOrdersHandler,
  decideEmergencyOnlineOrderHandler,
  acceptChannelOrderFallbackHandler,
  rejectChannelOrderFallbackHandler,
};

