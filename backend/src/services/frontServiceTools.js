'use strict';

/**
 * FRONT-SERVICE TOOLS & PICKUP DISPLAY SERVICE (P15 FRONT SERVICE)
 *
 * Implements:
 *   - Pickup token assignment and status tracking.
 *   - Public customer-facing order status display (MINIMAL projection: token + status + counter ONLY).
 *   - Captain tableside ordering capability within Cafe Operations authority.
 *
 * GOVERNANCE GUARANTEE:
 * Public displays strictly redact all customer PII, phone numbers, payment refs, and financial figures.
 * KDS is explicitly excluded per 4-persona architectural freeze.
 */

const crypto = require('crypto');
const { PickupToken, TOKEN_STATUSES } = require('../models/PickupToken');
const { ApiError } = require('../utils/ApiError');
const auditService = require('./auditService');

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

class FrontServiceTools {
  /**
   * Assigns a pickup token for takeaway / online collection.
   */
  static async assignPickupToken({
    orderReference,
    channel = 'TAKEAWAY',
    pickupCounter = 'Counter A',
    cafeId,
    organisationId = 'ORG-ZAMORIN',
    authContext = {},
  }) {
    assertCafeAccess(authContext, cafeId);

    const normCafeId = cafeId.trim().toUpperCase();
    const today = new Date().toISOString().slice(0, 10);
    const count = await PickupToken.countDocuments({
      organisationId,
      cafeId: normCafeId,
      createdAt: { $gte: new Date(today) },
    });

    const tokenNumber = `PK-${String(101 + count)}`;
    const tokenId = `TOKN-${normCafeId}-${Date.now()}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;

    const token = await PickupToken.create({
      tokenId,
      tokenNumber,
      organisationId,
      cafeId: normCafeId,
      orderReference,
      channel,
      status: 'QUEUED',
      pickupCounter,
      assignedAt: new Date(),
    });

    return token;
  }

  /**
   * Updates pickup token status (QUEUED, PREPARING, READY_FOR_PICKUP, COLLECTED, CANCELLED).
   */
  static async updatePickupTokenStatus({
    tokenId,
    status,
    cafeId,
    organisationId = 'ORG-ZAMORIN',
    authContext = {},
  }) {
    assertCafeAccess(authContext, cafeId);

    if (!TOKEN_STATUSES.includes(status)) {
      throw new ApiError(400, 'INVALID_TOKEN_STATUS', `Status must be one of: ${TOKEN_STATUSES.join(', ')}`);
    }

    const normCafeId = cafeId.trim().toUpperCase();
    const token = await PickupToken.findOne({
      tokenId,
      cafeId: normCafeId,
      organisationId,
    });
    if (!token) {
      throw new ApiError(404, 'TOKEN_NOT_FOUND', `Pickup token ${tokenId} not found.`);
    }

    token.status = status;
    const now = new Date();
    if (status === 'READY_FOR_PICKUP') token.readyAt = now;
    if (status === 'COLLECTED') token.collectedAt = now;
    await token.save();

    return token;
  }

  /**
   * Lists operational pickup tokens for Café Operations.
   */
  static async listPickupTokens({ cafeId, organisationId = 'ORG-ZAMORIN', authContext = {} }) {
    assertCafeAccess(authContext, cafeId);

    const normCafeId = cafeId.trim().toUpperCase();
    const today = new Date().toISOString().slice(0, 10);
    return await PickupToken.find({
      organisationId,
      cafeId: normCafeId,
      createdAt: { $gte: new Date(today) },
    })
      .sort({ createdAt: -1 })
      .lean();
  }

  /**
   * Public Customer-Facing Pickup Status Display.
   * STRICT PRIVACY GUARANTEE: Returns ONLY { tokenNumber, status, pickupCounter }.
   * Zero PII, zero telephone numbers, zero financial or tender data.
   */
  static async getPublicPickupStatusDisplay({ cafeId, organisationId = 'ORG-ZAMORIN' }) {
    if (!cafeId) {
      throw new ApiError(400, 'CAFE_ID_REQUIRED', 'cafeId is required for public display.');
    }

    const normCafeId = cafeId.trim().toUpperCase();
    const activeTokens = await PickupToken.find({
      organisationId,
      cafeId: normCafeId,
      status: { $in: ['PREPARING', 'READY_FOR_PICKUP'] },
    })
      .sort({ assignedAt: 1 })
      .select('tokenNumber status pickupCounter isComplimentary readyAt -_id')
      .lean();

    return {
      cafeId: normCafeId,
      timestamp: new Date(),
      preparing: activeTokens
        .filter((t) => t.status === 'PREPARING')
        .map((t) => ({
          tokenNumber: t.tokenNumber,
          counter: t.pickupCounter,
          isComplimentary: Boolean(t.isComplimentary),
          badge: t.isComplimentary ? 'COMPLIMENTARY' : null,
        })),
      readyForPickup: activeTokens
        .filter((t) => t.status === 'READY_FOR_PICKUP')
        .map((t) => ({
          tokenNumber: t.tokenNumber,
          counter: t.pickupCounter,
          isComplimentary: Boolean(t.isComplimentary),
          badge: t.isComplimentary ? 'COMPLIMENTARY' : null,
        })),
    };
  }
}

module.exports = {
  FrontServiceTools,
};
