'use strict';

/**
 * ============================================================================
 * ZAMORIN CAFÉ ERP — KITCHEN DISPLAY SYSTEM (KDS) CONTROLLER
 * ============================================================================
 * REST API controller for line cook station routing, ticket bumping,
 * void handling, and real-time station display metrics.
 */

const KdsService = require('../services/kdsService');
const { asyncHandler } = require('../utils/asyncHandler');
const { ApiError } = require('../utils/ApiError');
const { resolveEffectiveCafeScope, assertResourceCafeOwnership } = require('../utils/cafeScope');
const { recordRequestAudit } = require('../services/auditService');

/**
 * Lists active or historical KDS tickets for a given café and station
 */
const listTickets = asyncHandler(async (request, response) => {
  const { organisationId } = request.auth;
  const cafeId = resolveEffectiveCafeScope(request);
  const { prepStation, status, priority, limit } = request.query;

  const tickets = await KdsService.listTickets({
    organisationId,
    cafeId,
    prepStation,
    status: status ? (status.includes(',') ? status.split(',') : status) : undefined,
    priority,
    limit: limit ? Number(limit) : 50,
  });

  return response.status(200).json({
    success: true,
    tickets,
    count: tickets.length,
  });
});

/**
 * Gets a specific ticket by ticket ID
 */
const getTicket = asyncHandler(async (request, response) => {
  const { organisationId } = request.auth;
  const cafeId = resolveEffectiveCafeScope(request);
  const { ticketId } = request.params;

  const ticket = await KdsService.getTicketById({
    organisationId,
    cafeId,
    ticketId,
  });

  return response.status(200).json({
    success: true,
    ticket,
  });
});

/**
 * Creates/routes new KDS tickets from an order
 */
const createTicket = asyncHandler(async (request, response) => {
  const { organisationId, userId } = request.auth;
  const cafeId = resolveEffectiveCafeScope(request);
  const {
    billId,
    posOrderId,
    orderNumber,
    tableNumber,
    diningOption,
    priority,
    items,
    specialInstructions,
    targetPrepTimeMinutes,
    splitByStation,
  } = request.body || {};

  if (!items || !Array.isArray(items) || items.length === 0) {
    throw new ApiError(400, 'VALIDATION_FAILED', 'Items array is required to create KDS ticket.');
  }

  const tickets = await KdsService.createTicketsFromOrder({
    organisationId,
    cafeId,
    billId,
    posOrderId,
    orderNumber,
    tableNumber,
    diningOption,
    priority,
    items,
    specialInstructions,
    targetPrepTimeMinutes,
    splitByStation: splitByStation !== false,
  });

  await recordRequestAudit(request, {
    action: 'KDS_TICKETS_CREATED',
    entityType: 'KdsTicket',
    entityId: tickets.map((t) => t.ticketId).join(','),
    cafeId,
    metadata: {
      ticketCount: tickets.length,
      billId,
      orderNumber,
    },
  });

  return response.status(201).json({
    success: true,
    message: `Created ${tickets.length} KDS tickets.`,
    tickets,
  });
});

/**
 * Bumps a ticket to its next stage or a target status
 */
const bumpTicket = asyncHandler(async (request, response) => {
  const { organisationId, userId } = request.auth;
  const cafeId = resolveEffectiveCafeScope(request);
  const { ticketId } = request.params;
  const { targetStatus } = request.body || {};

  const ticket = await KdsService.bumpTicket({
    organisationId,
    cafeId,
    ticketId,
    targetStatus,
    userId,
  });

  await recordRequestAudit(request, {
    action: 'KDS_TICKET_BUMPED',
    entityType: 'KdsTicket',
    entityId: ticket.ticketId,
    cafeId,
    metadata: {
      newStatus: ticket.status,
      prepStation: ticket.prepStation,
    },
  });

  return response.status(200).json({
    success: true,
    message: `Ticket ${ticket.ticketId} updated to ${ticket.status}.`,
    ticket,
  });
});

/**
 * Bumps a single item on a ticket
 */
const bumpItem = asyncHandler(async (request, response) => {
  const { organisationId, userId } = request.auth;
  const cafeId = resolveEffectiveCafeScope(request);
  const { ticketId, itemIndex } = request.params;
  const { itemStatus } = request.body || {};

  const ticket = await KdsService.bumpItem({
    organisationId,
    cafeId,
    ticketId,
    itemIndex: Number(itemIndex),
    itemStatus: itemStatus || 'COMPLETED',
    userId,
  });

  return response.status(200).json({
    success: true,
    message: `Ticket ${ticket.ticketId} item ${itemIndex} updated.`,
    ticket,
  });
});

/**
 * Voids items across station tickets for a bill
 */
const voidTicketItems = asyncHandler(async (request, response) => {
  const { organisationId, userId } = request.auth;
  const cafeId = resolveEffectiveCafeScope(request);
  const { billId, itemIds, voidReason } = request.body || {};

  if (!billId) {
    throw new ApiError(400, 'VALIDATION_FAILED', 'billId is required for voiding KDS items.');
  }

  const updatedTickets = await KdsService.voidBillItems({
    organisationId,
    cafeId,
    billId,
    itemIds: itemIds || [],
    voidReason: voidReason || 'Voided at POS',
    userId,
  });

  await recordRequestAudit(request, {
    action: 'KDS_ITEMS_VOIDED',
    entityType: 'KdsTicket',
    entityId: billId,
    cafeId,
    metadata: {
      affectedTicketsCount: updatedTickets.length,
      voidReason,
    },
  });

  return response.status(200).json({
    success: true,
    message: `Voided items on ${updatedTickets.length} KDS tickets.`,
    tickets: updatedTickets,
  });
});

/**
 * Returns real-time metrics for KDS display headers
 */
const getMetrics = asyncHandler(async (request, response) => {
  const { organisationId } = request.auth;
  const cafeId = resolveEffectiveCafeScope(request);

  const metrics = await KdsService.getStationMetrics({
    organisationId,
    cafeId,
  });

  return response.status(200).json({
    success: true,
    metrics,
  });
});

/**
 * Lists configured prep stations for the active café
 */
const listStations = asyncHandler(async (request, response) => {
  const { organisationId } = request.auth;
  const cafeId = resolveEffectiveCafeScope(request);

  const stations = await KdsService.listCafeStations({
    organisationId,
    cafeId,
  });

  return response.status(200).json({
    success: true,
    stations,
    count: stations.length,
  });
});

/**
 * Creates a new café-specific prep station
 */
const createStation = asyncHandler(async (request, response) => {
  const { organisationId, userId } = request.auth;
  const cafeId = resolveEffectiveCafeScope(request);

  const station = await KdsService.createPrepStation({
    organisationId,
    cafeId,
    ...request.body,
  });

  await recordRequestAudit(request, {
    action: 'KDS_STATION_CREATE',
    resourceType: 'KDS_PREP_STATION',
    resourceId: station.prepStationId,
    cafeId,
    details: { code: station.code, name: station.name },
  });

  return response.status(201).json({
    success: true,
    station,
  });
});

/**
 * Configures menu item routing to café prep stations
 */
const routeStationMenuItem = asyncHandler(async (request, response) => {
  const { organisationId, userId } = request.auth;
  const cafeId = resolveEffectiveCafeScope(request);
  const { menuItemId, stationCodes } = request.body;

  const result = await KdsService.routeMenuItemToStations({
    organisationId,
    cafeId,
    menuItemId,
    stationCodes,
  });

  await recordRequestAudit(request, {
    action: 'KDS_STATION_ROUTE_CONFIG',
    resourceType: 'KDS_PREP_STATION',
    resourceId: menuItemId,
    cafeId,
    details: { menuItemId, stationCodes },
  });

  return response.status(200).json(result);
});

/**
 * F272: Aggregated Item Batch View for line cook bulk prep
 */
const getAggregatedItems = asyncHandler(async (request, response) => {
  const { organisationId } = request.auth;
  const cafeId = resolveEffectiveCafeScope(request);
  const { prepStation } = request.query;

  const result = await KdsService.getAggregatedItemBatchView({
    organisationId,
    cafeId,
    prepStation,
  });

  return response.status(200).json({
    success: true,
    data: result,
  });
});

/**
 * F036: Release payment-gated held tickets
 */
const releaseHeldTickets = asyncHandler(async (request, response) => {
  const { organisationId } = request.auth;
  const cafeId = resolveEffectiveCafeScope(request);
  const { billId } = request.body || {};

  const result = await KdsService.releaseHeldTicketsForBill({
    organisationId,
    cafeId,
    billId,
  });

  return response.status(200).json(result);
});

module.exports = {
  listTickets,
  getTicket,
  createTicket,
  bumpTicket,
  bumpItem,
  voidTicketItems,
  getMetrics,
  listStations,
  createStation,
  routeStationMenuItem,
  getAggregatedItems,
  releaseHeldTickets,
};
