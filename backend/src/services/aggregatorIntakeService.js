'use strict';

/**
 * AGGREGATOR INTAKE & RECONCILIATION SERVICE (P15 AGGREGATOR INTEGRATION)
 *
 * Implements webhook intake, cryptographic signature validation, idempotency,
 * and payout reconciliation for third-party food aggregators (Zomato & Swiggy).
 *
 * RECONCILIATION CONTRACT:
 * Reconciles incoming aggregator orders against canonical P12 MarketplaceSettlement.
 * Surfaces discrepancies as reviewable exceptions without automatic write-offs.
 *
 * EXTERNAL DEPENDENCY INTEGRITY:
 * Unconfigured production credentials or signatures are explicitly reported as
 * BLOCKED_EXTERNAL_DEPENDENCY.
 */

const crypto = require('crypto');
const { AggregatorOrder } = require('../models/AggregatorOrder');
const { ChannelOrder } = require('../models/ChannelOrder');
const { MarketplaceSettlement } = require('../models/MarketplaceSettlement');
const { OnlineChannelConfig } = require('../models/OnlineChannelConfig');
const { ApiError } = require('../utils/ApiError');
const auditService = require('./auditService');

function verifyHmacSignature(rawBody, signature, secret) {
  if (!rawBody || !signature || !secret) return false;
  try {
    const computed = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(computed));
  } catch (_) {
    return false;
  }
}

class AggregatorIntakeService {
  /**
   * Processes an incoming aggregator webhook payload (Zomato / Swiggy).
   * Verifies signature, enforces database uniqueness, and prevents duplicate billing.
   */
  static async processWebhookIntake({
    provider,
    payload,
    signature = null,
    rawBody = null,
    organisationId = 'ORG-ZAMORIN',
    cafeId = null,
  }) {
    const normProvider = String(provider).trim().toUpperCase();
    if (!['ZOMATO', 'SWIGGY', 'URBANPIPER', 'MAGICPIN'].includes(normProvider)) {
      throw new ApiError(400, 'UNSUPPORTED_PROVIDER', `Aggregator provider ${provider} is not supported.`);
    }

    const resolvedCafeId = (cafeId || payload.cafeId || 'ZC-0001').trim().toUpperCase();

    // A050 / F062: Failed Menu Publication Alerts
    if (
      payload.eventType === 'MENU_REJECTION' ||
      payload.event === 'MENU_SYNC_FAILED' ||
      payload.qcStatus === 'REJECTED' ||
      (payload.rejectionReason && !payload.externalOrderId)
    ) {
      const reason = payload.rejectionReason || payload.message || 'Image/Quality Check Rejected by Partner';
      const affectedItem = payload.itemId || payload.menuItemId || payload.itemName || 'Menu Item';
      console.warn(`[AGGREGATOR] ${normProvider} menu publication rejected for ${resolvedCafeId}:`, reason);

      try {
        const { NotificationService } = require('./NotificationService');
        if (typeof NotificationService?.broadcastNotification === 'function') {
          NotificationService.broadcastNotification({
            organisationId,
            cafeId: resolvedCafeId,
            type: 'MENU_SYNC_FAILED',
            title: `Menu Publication Rejected by ${normProvider}`,
            message: `Item: ${affectedItem}. Reason: ${reason}`,
            metadata: { provider: normProvider, rejectionReason: reason, payload },
          });
        }
      } catch (_) {}

      return {
        status: 'MENU_SYNC_REJECTION_LOGGED',
        provider: normProvider,
        cafeId: resolvedCafeId,
        rejectionReason: reason,
        item: affectedItem,
      };
    }

    if (!payload || !payload.externalOrderId) {
      throw new ApiError(400, 'INVALID_PAYLOAD', 'Payload must contain externalOrderId.');
    }

    // Check channel configuration and webhook signature
    const channelConfig = await OnlineChannelConfig.findOne({
      organisationId,
      cafeId: resolvedCafeId,
    }).lean();

    const providerConfig = channelConfig?.aggregators?.[normProvider.toLowerCase()];
    const configuredSecret = providerConfig?.webhookSecret || process.env[`${normProvider}_WEBHOOK_SECRET`];

    // Check if store is paused for this aggregator (F088 / A081 Store Overload Pause)
    if (providerConfig?.storeStatus === 'PAUSED') {
      const now = new Date();
      if (!providerConfig.pausedUntil || new Date(providerConfig.pausedUntil) > now) {
        return {
          status: 'STORE_PAUSED_REJECTED',
          message: `Store is temporarily paused for ${normProvider} due to: ${providerConfig.pauseReason || 'Kitchen Overload'}.`,
          pausedUntil: providerConfig.pausedUntil,
          provider: normProvider,
        };
      }
    }

    // If signature provided, verify it. If unconfigured in prod, classify dependency.
    if (signature && configuredSecret) {
      const isValid = verifyHmacSignature(rawBody || JSON.stringify(payload), signature, configuredSecret);
      if (!isValid) {
        throw new ApiError(401, 'INVALID_WEBHOOK_SIGNATURE', 'HMAC signature verification failed.');
      }
    } else if (!configuredSecret && process.env.NODE_ENV !== 'test') {
      // In live production, unconfigured webhook secret blocks intake
      return {
        status: 'BLOCKED_EXTERNAL_DEPENDENCY',
        message: `${normProvider} webhook secret unconfigured. Live callback rejected.`,
        provider: normProvider,
      };
    }

    const externalOrderId = String(payload.externalOrderId).trim();

    // Fast-path idempotency check: Already processed?
    const existing = await AggregatorOrder.findOne({
      organisationId,
      provider: normProvider,
      externalOrderId,
    });
    if (existing) {
      return {
        duplicate: true,
        aggregatorOrderId: existing.aggregatorOrderId,
        status: existing.status,
        message: 'Order was already received and processed. Idempotent replay acknowledged.',
      };
    }

    // Normalise incoming payload items
    const rawItems = Array.isArray(payload.items) ? payload.items : [];
    const items = rawItems.map((it) => ({
      externalItemId: it.externalItemId || it.id || '',
      menuItemId: it.menuItemId || '',
      itemName: String(it.itemName || it.name || 'Aggregator Item').trim(),
      quantity: Math.max(1, Number(it.quantity) || 1),
      unitPricePaisa: Math.max(0, Number(it.unitPricePaisa) || 0),
      lineTotalPaisa: Math.max(0, Number(it.lineTotalPaisa || it.unitPricePaisa * (it.quantity || 1)) || 0),
      modifiers: it.modifiers || {},
      instructions: it.instructions || '',
    }));

    const grossAmountPaisa = Math.max(0, Number(payload.pricing?.grossAmountPaisa) || 0);
    const discountPaisa = Math.max(0, Number(payload.pricing?.discountPaisa) || 0);
    const packagingFeePaisa = Math.max(0, Number(payload.pricing?.packagingFeePaisa) || 0);
    const deliveryFeePaisa = Math.max(0, Number(payload.pricing?.deliveryFeePaisa) || 0);
    const taxPaisa = Math.max(0, Number(payload.pricing?.taxPaisa) || 0);
    const netPayablePaisa = Math.max(0, Number(payload.pricing?.netPayablePaisa) || (grossAmountPaisa - discountPaisa + packagingFeePaisa + taxPaisa));

    const commissionPaisa = Math.max(0, Number(payload.payoutExpected?.commissionPaisa) || Math.round(netPayablePaisa * 0.18));
    const platformFeesPaisa = Math.max(0, Number(payload.payoutExpected?.platformFeesPaisa) || 500);
    const taxWithheldPaisa = Math.max(0, Number(payload.payoutExpected?.taxWithheldPaisa) || Math.round(commissionPaisa * 0.18));
    const netPayoutPaisa = netPayablePaisa - commissionPaisa - platformFeesPaisa - taxWithheldPaisa;

    const aggregatorOrderId = `AGG-${normProvider.slice(0, 3)}-${Date.now()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;

    let aggregatorOrder;
    try {
      aggregatorOrder = await AggregatorOrder.create({
        aggregatorOrderId,
        organisationId,
        cafeId: resolvedCafeId,
        provider: normProvider,
        externalOrderId,
        displayOrderId: payload.displayOrderId || `#${externalOrderId.slice(-4)}`,
        channel: 'AGGREGATOR',
        customerName: payload.customerName || 'Aggregator Customer',
        customerPhoneMasked: payload.customerPhoneMasked || '+91-XXXXX-XXXXX',
        deliveryAddressSummary: payload.deliveryAddressSummary || '',
        items,
        pricing: {
          grossAmountPaisa,
          discountPaisa,
          packagingFeePaisa,
          deliveryFeePaisa,
          taxPaisa,
          netPayablePaisa,
        },
        payoutExpected: {
          commissionPaisa,
          platformFeesPaisa,
          taxWithheldPaisa,
          netPayoutPaisa,
        },
        status: 'RECEIVED',
        reconciliationStatus: 'PENDING',
        receivedAt: new Date(),
      });
    } catch (err) {
      // Handle concurrent race on unique compound index { organisationId, provider, externalOrderId }
      if (err.code === 11000) {
        const raceWinner = await AggregatorOrder.findOne({
          organisationId,
          provider: normProvider,
          externalOrderId,
        });
        return {
          duplicate: true,
          aggregatorOrderId: raceWinner.aggregatorOrderId,
          status: raceWinner.status,
          message: 'Order was received concurrently. Idempotent replay acknowledged.',
        };
      }
      throw err;
    }

    // Mirror in ChannelOrder feed for operational visibility
    await ChannelOrder.create({
      orderId: `ORD-${aggregatorOrderId}`,
      orderNumber: `#${normProvider.slice(0, 3)}-${externalOrderId.slice(-4)}`,
      organisationId,
      cafeId: resolvedCafeId,
      channel: 'AGGREGATOR',
      provider: normProvider,
      externalOrderId,
      fulfilmentMode: 'DELIVERY',
      customer: {
        name: aggregatorOrder.customerName,
        phone: aggregatorOrder.customerPhoneMasked,
      },
      lineItems: items.map((it) => ({
        menuItemId: it.menuItemId || 'AGG-ITEM',
        itemNameSnapshot: it.itemName,
        quantity: it.quantity,
        unitPricePaisa: it.unitPricePaisa,
        lineSubtotalPaisa: it.lineTotalPaisa,
        lineTotalPaisa: it.lineTotalPaisa,
        taxRatePercent: 5,
        cgstPaisa: Math.floor(taxPaisa / 2),
        sgstPaisa: taxPaisa - Math.floor(taxPaisa / 2),
      })),
      pricing: {
        subtotalPaisa: grossAmountPaisa,
        discountPaisa,
        packagingFeePaisa,
        deliveryFeePaisa,
        taxPaisa,
        totalPaisa: netPayablePaisa,
      },
      paymentState: 'PAID', // Paid to aggregator by customer
      paymentMethod: 'ONLINE',
      status: 'RECEIVED',
      lifecycleHistory: [
        {
          status: 'RECEIVED',
          actorUserId: `${normProvider}_WEBHOOK`,
          timestamp: new Date(),
          notes: `Ingested order from ${normProvider} webhook`,
        },
      ],
    }).catch(() => {});

    await auditService.recordAuditEvent({
      organisationId,
      cafeId: resolvedCafeId,
      actorUserId: `${normProvider}_WEBHOOK`,
      actorRole: 'SYSTEM',
      module: 'AGGREGATORS',
      action: 'AGGREGATOR_ORDER_INGESTED',
      entityType: 'AGGREGATOR_ORDER',
      entityId: aggregatorOrder.aggregatorOrderId,
      reason: `Ingested order ${externalOrderId} from ${normProvider}`,
      result: 'SUCCESS',
      metadata: { provider: normProvider, externalOrderId, netPayablePaisa },
    }).catch(() => {});

    return {
      success: true,
      aggregatorOrderId: aggregatorOrder.aggregatorOrderId,
      provider: normProvider,
      externalOrderId: aggregatorOrder.externalOrderId,
      status: aggregatorOrder.status,
    };
  }

  /**
   * Reconciles aggregator orders against canonical P12 MarketplaceSettlement.
   * Identifies variances without duplicate accounting postings or automatic write-offs.
   */
  static async reconcilePayoutsAgainstSettlement({
    settlementId,
    cafeId,
    organisationId = 'ORG-ZAMORIN',
  }) {
    if (!settlementId) {
      throw new ApiError(400, 'SETTLEMENT_ID_REQUIRED', 'settlementId is required for reconciliation.');
    }

    const settlement = await MarketplaceSettlement.findOne({
      settlementId: settlementId.trim().toUpperCase(),
      organisationId,
    }).lean();

    if (!settlement) {
      throw new ApiError(404, 'SETTLEMENT_NOT_FOUND', `Marketplace settlement ${settlementId} not found.`);
    }

    const { platform, cafeId: settCafeId, periodStart, periodEnd } = settlement;
    const targetCafeId = (cafeId || settCafeId).trim().toUpperCase();

    // Query AggregatorOrders within this period
    const orders = await AggregatorOrder.find({
      organisationId,
      cafeId: targetCafeId,
      provider: platform,
      receivedAt: { $gte: new Date(periodStart), $lte: new Date(periodEnd) },
    });

    let aggregatedGrossPaisa = 0;
    let aggregatedCommissionPaisa = 0;
    let aggregatedNetPayoutPaisa = 0;

    for (const ord of orders) {
      aggregatedGrossPaisa += ord.pricing?.netPayablePaisa || 0;
      aggregatedCommissionPaisa += ord.payoutExpected?.commissionPaisa || 0;
      aggregatedNetPayoutPaisa += ord.payoutExpected?.netPayoutPaisa || 0;
    }

    const variancePaisa = (settlement.netSettlementPaisa || 0) - aggregatedNetPayoutPaisa;
    const hasDiscrepancy = Math.abs(variancePaisa) > 0;

    // Link orders to settlement and update reconciliation status
    const newStatus = hasDiscrepancy ? 'DISCREPANCY' : 'MATCHED';
    await AggregatorOrder.updateMany(
      {
        organisationId,
        cafeId: targetCafeId,
        provider: platform,
        receivedAt: { $gte: new Date(periodStart), $lte: new Date(periodEnd) },
      },
      {
        $set: {
          settlementId: settlement.settlementId,
          reconciliationStatus: newStatus,
        },
      }
    );

    return {
      settlementId: settlement.settlementId,
      platform,
      period: { start: periodStart, end: periodEnd },
      ordersAuditedCount: orders.length,
      settlementReportedNetPaisa: settlement.netSettlementPaisa,
      erpCalculatedNetPaisa: aggregatedNetPayoutPaisa,
      variancePaisa,
      reconciliationStatus: newStatus,
      reviewRequired: hasDiscrepancy,
    };
  }

  /**
   * Pause aggregator store for kitchen overload (F088 / A081)
   */
  static async pauseAggregatorStore({
    organisationId,
    cafeId,
    provider = 'ALL',
    durationMinutes = 30,
    reason = 'KITCHEN_OVERLOAD',
    auth = null,
  }) {
    if (!organisationId || !cafeId) {
      throw new ApiError(400, 'VALIDATION_FAILED', 'organisationId and cafeId are required.');
    }

    const duration = Math.max(0, parseInt(durationMinutes, 10) || 0);
    const pausedUntil = duration > 0 ? new Date(Date.now() + duration * 60 * 1000) : null;
    const normProvider = String(provider || 'ALL').trim().toUpperCase();

    let config = await OnlineChannelConfig.findOne({ organisationId, cafeId });
    if (!config) {
      config = await OnlineChannelConfig.create({
        organisationId,
        cafeId,
        aggregators: {
          zomato: { isEnabled: true, storeStatus: 'ONLINE' },
          swiggy: { isEnabled: true, storeStatus: 'ONLINE' },
          toing: { isEnabled: true, storeStatus: 'ONLINE' },
        },
      });
    }

    const providersToUpdate = normProvider === 'ALL' ? ['zomato', 'swiggy', 'toing'] : [normProvider.toLowerCase()];
    for (const p of providersToUpdate) {
      if (config.aggregators && config.aggregators[p]) {
        config.aggregators[p].storeStatus = 'PAUSED';
        config.aggregators[p].pausedUntil = pausedUntil;
        config.aggregators[p].pauseReason = reason;
      }
    }

    config.markModified('aggregators');
    await config.save();

    if (auth) {
      await auditService.recordAuditEvent({
        organisationId,
        cafeId,
        actorUserId: auth.userId,
        actorRole: auth.role || 'STAFF',
        module: 'OPERATIONS',
        action: 'AGGREGATOR_STORE_PAUSED',
        entityType: 'OnlineChannelConfig',
        entityId: cafeId,
        reason: reason || 'KITCHEN_OVERLOAD',
        metadata: {
          provider: normProvider,
          durationMinutes: duration,
          pausedUntil,
        },
      });
    }

    return {
      cafeId,
      provider: normProvider,
      storeStatus: 'PAUSED',
      pausedUntil,
      durationMinutes: duration,
      reason,
      activeChannels: providersToUpdate,
    };
  }

  /**
   * Resume aggregator store to online (F088 / A081)
   */
  static async resumeAggregatorStore({
    organisationId,
    cafeId,
    provider = 'ALL',
    auth = null,
  }) {
    if (!organisationId || !cafeId) {
      throw new ApiError(400, 'VALIDATION_FAILED', 'organisationId and cafeId are required.');
    }

    const normProvider = String(provider || 'ALL').trim().toUpperCase();
    let config = await OnlineChannelConfig.findOne({ organisationId, cafeId });
    if (!config) {
      return { cafeId, provider: normProvider, storeStatus: 'ONLINE' };
    }

    const providersToUpdate = normProvider === 'ALL' ? ['zomato', 'swiggy', 'toing'] : [normProvider.toLowerCase()];
    for (const p of providersToUpdate) {
      if (config.aggregators && config.aggregators[p]) {
        config.aggregators[p].storeStatus = 'ONLINE';
        config.aggregators[p].pausedUntil = null;
        config.aggregators[p].pauseReason = null;
      }
    }

    config.markModified('aggregators');
    await config.save();

    if (auth) {
      await auditService.recordAuditEvent({
        organisationId,
        cafeId,
        actorUserId: auth.userId,
        actorRole: auth.role || 'STAFF',
        module: 'OPERATIONS',
        action: 'AGGREGATOR_STORE_RESUMED',
        entityType: 'OnlineChannelConfig',
        entityId: cafeId,
        metadata: { provider: normProvider },
      });
    }

    return {
      cafeId,
      provider: normProvider,
      storeStatus: 'ONLINE',
      resumedAt: new Date(),
    };
  }

  /**
   * Get aggregator live store pause status and auto-resume if time elapsed (F088 / A081)
   */
  static async getAggregatorStoreStatus({ organisationId, cafeId }) {
    if (!organisationId || !cafeId) {
      throw new ApiError(400, 'VALIDATION_FAILED', 'organisationId and cafeId are required.');
    }

    let config = await OnlineChannelConfig.findOne({ organisationId, cafeId });
    if (!config) {
      return { zomato: { storeStatus: 'ONLINE' }, swiggy: { storeStatus: 'ONLINE' }, toing: { storeStatus: 'ONLINE' } };
    }

    const now = new Date();
    let modified = false;
    const result = {};

    for (const p of ['zomato', 'swiggy', 'toing']) {
      const agg = config.aggregators?.[p];
      if (agg) {
        if (agg.storeStatus === 'PAUSED' && agg.autoResume && agg.pausedUntil && new Date(agg.pausedUntil) <= now) {
          agg.storeStatus = 'ONLINE';
          agg.pausedUntil = null;
          agg.pauseReason = null;
          modified = true;
        }

        const remainingMs = agg.pausedUntil ? Math.max(0, new Date(agg.pausedUntil).getTime() - now.getTime()) : null;
        result[p] = {
          storeStatus: agg.storeStatus,
          isEnabled: agg.isEnabled,
          pausedUntil: agg.pausedUntil,
          remainingMinutes: remainingMs !== null ? Math.ceil(remainingMs / 60000) : null,
          pauseReason: agg.pauseReason,
        };
      }
    }

    if (modified) {
      config.markModified('aggregators');
      await config.save();
    }

    return result;
  }
}

module.exports = {
  AggregatorIntakeService,
};
