'use strict';

/**
 * DIRECT ORDERING SERVICE (P15 CHANNELS & DIRECT ONLINE ORDERING)
 *
 * Implements guest-facing direct web ordering (Takeaway / Delivery):
 *   - Authoritative online menu with channel-specific availability and packaging fees.
 *   - Server-side pricing, minimum order thresholds, and immutable line item snapshots.
 *   - Idempotency and duplicate submission prevention.
 *   - Pickup token allocation and order status lifecycle.
 */

const crypto = require('crypto');
const { ChannelOrder, ORDER_STATUSES, PAYMENT_STATES } = require('../models/ChannelOrder');
const { PickupToken } = require('../models/PickupToken');
const { MenuItem } = require('../models/MenuItem');
const { OutletOffering } = require('../models/OutletOffering');
const { OnlineChannelConfig } = require('../models/OnlineChannelConfig');
const { Cafe } = require('../models/Cafe');
const { ApiError } = require('../utils/ApiError');
const auditService = require('./auditService');
const { calculateCustomerPayableRounding50P, roundToPaisa } = require('./gstTaxService');

function assertCafeAccess(authContext = {}, cafeId) {
  if (!authContext || !authContext.role || authContext.role === 'SYSTEM') return;
  if (authContext.role === 'MASTER' || authContext.role === 'OWNER') return;
  const normCafeId = typeof cafeId === 'string' ? cafeId.trim().toUpperCase() : '';
  if (!normCafeId) return;
  const assigned = Array.isArray(authContext.assignedCafeIds)
    ? authContext.assignedCafeIds.map((c) => String(c).trim().toUpperCase())
    : authContext.primaryCafeId ? [String(authContext.primaryCafeId).trim().toUpperCase()] : [];
  if (!assigned.includes(normCafeId)) {
    throw new ApiError(
      403,
      'CROSS_CAFE_RESOURCE_DENIED',
      'Cross-café access is denied. You are not authorized for the requested café.'
    );
  }
}

class DirectOrderingService {
  /**
   * Retrieves authoritative menu for direct web ordering.
   */
  static async getWebMenu({ cafeId, organisationId = 'ORG-ZAMORIN' }) {
    if (!cafeId) {
      throw new ApiError(400, 'CAFE_ID_REQUIRED', 'cafeId is required to load web menu.');
    }

    const normCafeId = cafeId.trim().toUpperCase();
    const cafe = await Cafe.findOne({ cafeId: normCafeId, organisationId }).lean();
    if (!cafe) {
      throw new ApiError(404, 'CAFE_NOT_FOUND', `Café ${normCafeId} not found.`);
    }

    const channelConfig = await OnlineChannelConfig.findOne({
      organisationId,
      cafeId: normCafeId,
    }).lean();

    const menuItems = await MenuItem.find({
      organisationId,
      status: 'ACTIVE',
    }).lean();

    const outletOfferings = await OutletOffering.find({
      organisationId,
      outletId: normCafeId,
    }).lean();

    const offeringsMap = new Map();
    for (const off of outletOfferings) offeringsMap.set(off.menuItemId, off);

    const now = new Date();
    const webCategories = {};

    for (const item of menuItems) {
      const offering = offeringsMap.get(item.menuItemId);
      if (offering && offering.isEnabled === false) continue;
      // Filter out items not allowed for takeaway or delivery
      if (offering && offering.channels && !offering.channels.takeaway && !offering.channels.delivery) {
        continue;
      }

      let isSoldOut = false;
      let soldOutReason = null;
      if (offering) {
        if (offering.isAvailable === false) {
          isSoldOut = true;
          soldOutReason = offering.soldOutReason || 'Sold out today';
        } else if (offering.soldOutUntil && new Date(offering.soldOutUntil) > now) {
          isSoldOut = true;
          soldOutReason = offering.soldOutReason || 'Temporarily unavailable';
        }
      }

      const effectivePricePaisa =
        offering && Number.isInteger(offering.localPricePaisaOverride) && offering.localPricePaisaOverride >= 0
          ? offering.localPricePaisaOverride
          : (Number.isInteger(item.sellingPricePaisa) ? item.sellingPricePaisa : 0);

      const category = item.category || 'OTHER';
      if (!webCategories[category]) webCategories[category] = [];

      webCategories[category].push({
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
        modifiers: item.applicableModifierGroupIds || [],
      });
    }

    return {
      cafe: {
        cafeId: cafe.cafeId,
        name: cafe.name,
        tagline: cafe.tagline || 'Speciality Coffee & Kitchens',
      },
      channelConfig: channelConfig ? channelConfig.directWeb : {
        isEnabled: true,
        minimumOrderPaisa: 0,
        packagingFeePaisa: 1500,
        deliveryFeePaisa: 4000,
      },
      categories: webCategories,
    };
  }

  /**
   * Submits a direct web order (Takeaway or Delivery).
   */
  static async submitDirectWebOrder({
    cafeId,
    fulfilmentMode = 'TAKEAWAY',
    customer = {},
    lineItems,
    paymentMethod = 'CASH',
    paymentReference = '',
    idempotencyKey = null,
    organisationId = 'ORG-ZAMORIN',
  }) {
    if (!cafeId) {
      throw new ApiError(400, 'CAFE_ID_REQUIRED', 'cafeId is required.');
    }
    if (!Array.isArray(lineItems) || lineItems.length === 0) {
      throw new ApiError(400, 'LINE_ITEMS_REQUIRED', 'At least one line item is required.');
    }
    if (!customer.name || !customer.phone) {
      throw new ApiError(400, 'CUSTOMER_INFO_REQUIRED', 'Customer name and phone number are required.');
    }

    const normCafeId = cafeId.trim().toUpperCase();

    // Check idempotency
    if (idempotencyKey) {
      const existing = await ChannelOrder.findOne({
        organisationId,
        cafeId: normCafeId,
        idempotencyKey,
      });
      if (existing) {
        return {
          duplicate: true,
          orderId: existing.orderId,
          orderNumber: existing.orderNumber,
          status: existing.status,
          totalPaisa: existing.pricing.totalPaisa,
          pickupTokenNumber: existing.pickupTokenNumber,
        };
      }
    }

    const channelConfig = await OnlineChannelConfig.findOne({
      organisationId,
      cafeId: normCafeId,
    }).lean();

    const packagingFeePaisa = channelConfig?.directWeb?.packagingFeePaisa || 1500;
    const deliveryFeePaisa = fulfilmentMode === 'DELIVERY'
      ? (channelConfig?.directWeb?.deliveryFeePaisa || 4000)
      : 0;
    const minOrderPaisa = channelConfig?.directWeb?.minimumOrderPaisa || 0;

    // Load authoritative menu items
    const menuItemIds = lineItems.map((li) => String(li.menuItemId || '').trim().toUpperCase());
    const dbMenuItems = await MenuItem.find({
      organisationId,
      menuItemId: { $in: menuItemIds },
      status: 'ACTIVE',
    }).lean();

    const dbOfferings = await OutletOffering.find({
      organisationId,
      outletId: normCafeId,
      menuItemId: { $in: menuItemIds },
    }).lean();

    const itemsMap = new Map();
    for (const it of dbMenuItems) itemsMap.set(it.menuItemId, it);
    const offeringsMap = new Map();
    for (const off of dbOfferings) offeringsMap.set(off.menuItemId, off);

    const verifiedLineItems = [];
    let subtotalPaisa = 0;
    let taxPaisa = 0;

    for (const clientItem of lineItems) {
      const mId = String(clientItem.menuItemId || '').trim().toUpperCase();
      const menuItem = itemsMap.get(mId);
      if (!menuItem) {
        throw new ApiError(400, 'ITEM_NOT_FOUND', `Item ${mId} is unavailable.`);
      }

      const offering = offeringsMap.get(mId);
      if (offering && offering.isEnabled === false) {
        throw new ApiError(400, 'ITEM_DISABLED', `Item "${menuItem.name}" is disabled.`);
      }
      if (offering && offering.isAvailable === false) {
        throw new ApiError(400, 'ITEM_SOLD_OUT', `Item "${menuItem.name}" is sold out.`);
      }

      const quantity = Math.max(1, Math.floor(Number(clientItem.quantity) || 1));
      let unitPricePaisa =
        offering && Number.isInteger(offering.localPricePaisaOverride) && offering.localPricePaisaOverride >= 0
          ? offering.localPricePaisaOverride
          : (Number.isInteger(menuItem.sellingPricePaisa) ? menuItem.sellingPricePaisa : 0);

      let variantSnapshot = null;
      if (clientItem.variantId && Array.isArray(menuItem.variants)) {
        const found = menuItem.variants.find((v) => v.variantId === clientItem.variantId);
        if (found) {
          unitPricePaisa = found.pricePaisa;
          variantSnapshot = { variantId: found.variantId, name: found.name, pricePaisa: found.pricePaisa };
        }
      }

      const lineSubtotalPaisa = unitPricePaisa * quantity;
      const taxRatePercent = menuItem.taxRatePercent || 5;
      const lineTaxPaisa = roundToPaisa(lineSubtotalPaisa * (taxRatePercent / 100));
      const cgstPaisa = Math.floor(lineTaxPaisa / 2);
      const sgstPaisa = lineTaxPaisa - cgstPaisa;
      const lineTotalPaisa = lineSubtotalPaisa + lineTaxPaisa;

      subtotalPaisa += lineSubtotalPaisa;
      taxPaisa += lineTaxPaisa;

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
        itemNotes: String(clientItem.itemNotes || '').slice(0, 300),
      });
    }

    if (minOrderPaisa > 0 && subtotalPaisa < minOrderPaisa) {
      throw new ApiError(
        400,
        'MINIMUM_ORDER_NOT_MET',
        `Minimum order amount is ₹${(minOrderPaisa / 100).toFixed(2)}. Current subtotal is ₹${(subtotalPaisa / 100).toFixed(2)}.`
      );
    }

    const preRoundingTotal = subtotalPaisa + packagingFeePaisa + deliveryFeePaisa + taxPaisa;
    const { roundOffPaisa, finalPayablePaisa: totalPaisa } = calculateCustomerPayableRounding50P(preRoundingTotal);

    const orderId = `ORD-WEB-${Date.now()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
    const orderNumber = `#WEB-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;

    // Allocate pickup token if takeaway
    let pickupTokenNumber = null;
    let pickupTokenId = null;
    if (fulfilmentMode === 'TAKEAWAY' || fulfilmentMode === 'SCHEDULED_PICKUP') {
      const count = await PickupToken.countDocuments({
        organisationId,
        cafeId: normCafeId,
        createdAt: { $gte: new Date(new Date().toISOString().slice(0, 10)) },
      });
      pickupTokenNumber = `PK-${String(101 + count)}`;
      pickupTokenId = `TOKN-${orderId}`;

      await PickupToken.create({
        tokenId: pickupTokenId,
        tokenNumber: pickupTokenNumber,
        organisationId,
        cafeId: normCafeId,
        orderReference: orderId,
        channel: 'DIRECT_WEB',
        status: 'QUEUED',
        pickupCounter: 'Express Pickup',
      });
    }

    const channelOrder = await ChannelOrder.create({
      orderId,
      orderNumber,
      organisationId,
      cafeId: normCafeId,
      channel: 'DIRECT_WEB',
      fulfilmentMode,
      customer: {
        name: String(customer.name).trim(),
        phone: String(customer.phone).replace(/[^0-9]/g, ''),
        email: String(customer.email || '').trim(),
        deliveryAddress: String(customer.deliveryAddress || '').trim(),
      },
      lineItems: verifiedLineItems,
      pricing: {
        subtotalPaisa,
        packagingFeePaisa,
        deliveryFeePaisa,
        taxPaisa,
        roundOffPaisa,
        totalPaisa,
      },
      paymentState: paymentMethod === 'ONLINE' ? 'PAID' : 'PENDING',
      paymentMethod,
      paymentReference,
      status: 'RECEIVED',
      pickupTokenNumber,
      pickupTokenId,
      idempotencyKey,
      lifecycleHistory: [
        {
          status: 'RECEIVED',
          actorUserId: 'GUEST_WEB',
          timestamp: new Date(),
          notes: `Direct web order placed for ${fulfilmentMode}`,
        },
      ],
    });

    return {
      success: true,
      orderId: channelOrder.orderId,
      orderNumber: channelOrder.orderNumber,
      fulfilmentMode,
      pickupTokenNumber,
      pricing: channelOrder.pricing,
      status: channelOrder.status,
      paymentState: channelOrder.paymentState,
    };
  }

  /**
   * Retrieves public order status without exposing PII.
   */
  static async getDirectOrderStatus({ orderReference }) {
    if (!orderReference) {
      throw new ApiError(400, 'ORDER_REFERENCE_REQUIRED', 'Order reference is required.');
    }

    const order = await ChannelOrder.findOne({
      $or: [{ orderId: orderReference }, { orderNumber: orderReference }],
    }).lean();

    if (!order) {
      throw new ApiError(404, 'ORDER_NOT_FOUND', 'Order not found.');
    }

    // Return sanitized public tracking representation (NO customer phone or payment refs)
    return {
      orderNumber: order.orderNumber,
      channel: order.channel,
      fulfilmentMode: order.fulfilmentMode,
      status: order.status,
      pickupTokenNumber: order.pickupTokenNumber,
      itemsCount: (order.lineItems || []).length,
      receivedAt: order.receivedAt,
      readyAt: order.readyAt,
    };
  }

  /**
   * Updates channel order lifecycle status (operational action for Cafe Operations).
   */
  static async updateOrderStatus({
    orderId,
    status,
    reason = null,
    cafeId,
    organisationId,
    authContext = {},
  }) {
    assertCafeAccess(authContext, cafeId);

    if (!ORDER_STATUSES.includes(status)) {
      throw new ApiError(400, 'INVALID_ORDER_STATUS', `Status must be one of: ${ORDER_STATUSES.join(', ')}`);
    }

    const normCafeId = cafeId.trim().toUpperCase();
    const order = await ChannelOrder.findOne({
      orderId,
      cafeId: normCafeId,
      organisationId,
    });
    if (!order) {
      throw new ApiError(404, 'ORDER_NOT_FOUND', `Order ${orderId} not found.`);
    }

    const actor = authContext.userId || 'STAFF';
    const now = new Date();

    order.status = status;
    if (status === 'ACCEPTED') order.acceptedAt = now;
    if (status === 'READY_FOR_PICKUP') order.readyAt = now;
    if (status === 'DISPATCHED') order.dispatchedAt = now;
    if (status === 'COMPLETED') order.completedAt = now;
    if (status === 'REJECTED') order.rejectionReason = reason || 'Rejected by kitchen';
    if (status === 'CANCELLED') order.cancellationReason = reason || 'Cancelled by staff';

    order.lifecycleHistory.push({
      status,
      actorUserId: actor,
      timestamp: now,
      notes: reason || `Order status updated to ${status}`,
    });

    await order.save();

    // If order has an associated pickup token, advance pickup token status
    if (order.pickupTokenId) {
      let tokenStatus = 'QUEUED';
      if (['ACCEPTED', 'PREPARING'].includes(status)) tokenStatus = 'PREPARING';
      if (status === 'READY_FOR_PICKUP') tokenStatus = 'READY_FOR_PICKUP';
      if (status === 'COMPLETED') tokenStatus = 'COLLECTED';
      if (['CANCELLED', 'REJECTED'].includes(status)) tokenStatus = 'CANCELLED';

      await PickupToken.updateOne(
        { tokenId: order.pickupTokenId },
        {
          $set: {
            status: tokenStatus,
            readyAt: status === 'READY_FOR_PICKUP' ? now : undefined,
            collectedAt: status === 'COMPLETED' ? now : undefined,
          },
        }
      );
    }

    return order;
  }
}

module.exports = {
  DirectOrderingService,
};
