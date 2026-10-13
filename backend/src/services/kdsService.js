'use strict';

/**
 * ============================================================================
 * ZAMORIN CAFÉ ERP — KITCHEN DISPLAY SYSTEM (KDS) SERVICE
 * ============================================================================
 * Manages order routing, prep station distribution, state progression,
 * void handling, and real-time line-cook / expediter metrics.
 */

const { KdsTicket, PREP_STATIONS, KDS_STATUSES } = require('../models/KdsTicket');
const { KdsPrepStation, DEFAULT_STATION_FIXTURES } = require('../models/KdsPrepStation');

class KdsService {
  /**
   * Generates a unique KDS ticket ID: KDS-YYMMDD-XXXX
   */
  static generateTicketId() {
    const now = new Date();
    const datePart = now.toISOString().slice(2, 10).replace(/-/g, '');
    const randPart = Math.random().toString(36).substring(2, 6).toUpperCase();
    return `KDS-${datePart}-${randPart}`;
  }

  /**
   * Seeds default station fixtures for a café if no stations exist yet
   */
  static async seedDefaultStationsForCafe({ organisationId, cafeId }) {
    const cleanOrg = organisationId.trim().toUpperCase();
    const cleanCafe = cafeId.trim().toUpperCase();
    const created = [];
    for (const fixture of DEFAULT_STATION_FIXTURES) {
      const stationId = `STN-${cleanCafe}-${fixture.code}`;
      const doc = await KdsPrepStation.findOneAndUpdate(
        { organisationId: cleanOrg, cafeId: cleanCafe, code: fixture.code },
        {
          $setOnInsert: {
            prepStationId: stationId,
            organisationId: cleanOrg,
            cafeId: cleanCafe,
            name: fixture.name,
            code: fixture.code,
            description: fixture.description,
            sequence: fixture.sequence,
            active: true,
            isExpediter: fixture.isExpediter,
            displayOrder: fixture.displayOrder,
            assignedMenuItemIds: [],
            assignedCategories: [],
          },
        },
        { upsert: true, new: true, lean: true }
      );
      created.push(doc);
    }
    return created;
  }

  /**
   * Lists active prep stations configured for a given café (strictly isolated)
   */
  static async listCafeStations({ organisationId, cafeId }) {
    if (!organisationId || !cafeId) {
      throw new Error('OrganisationId and CafeId are required to list prep stations.');
    }
    const cleanOrg = organisationId.trim().toUpperCase();
    const cleanCafe = cafeId.trim().toUpperCase();

    let stations = await KdsPrepStation.find({
      organisationId: cleanOrg,
      cafeId: cleanCafe,
      active: true,
    })
      .sort({ displayOrder: 1, sequence: 1 })
      .lean();

    if (!stations || stations.length === 0) {
      stations = await this.seedDefaultStationsForCafe({ organisationId: cleanOrg, cafeId: cleanCafe });
    }

    return stations;
  }

  /**
   * Creates a new café-specific prep station
   */
  static async createPrepStation({
    organisationId,
    cafeId,
    name,
    code,
    description = '',
    sequence = 1,
    isExpediter = false,
    displayOrder = 0,
    assignedMenuItemIds = [],
    assignedCategories = [],
  }) {
    if (!organisationId || !cafeId || !name || !code) {
      throw new Error('organisationId, cafeId, name, and code are required to create a prep station.');
    }
    const cleanOrg = organisationId.trim().toUpperCase();
    const cleanCafe = cafeId.trim().toUpperCase();
    const cleanCode = code.trim().toUpperCase();

    const existing = await KdsPrepStation.findOne({
      organisationId: cleanOrg,
      cafeId: cleanCafe,
      code: cleanCode,
    });
    if (existing) {
      throw new Error(`Prep station code ${cleanCode} already exists for café ${cleanCafe}.`);
    }

    const prepStationId = `STN-${cleanCafe}-${cleanCode}`;
    const station = await KdsPrepStation.create({
      prepStationId,
      organisationId: cleanOrg,
      cafeId: cleanCafe,
      name: name.trim(),
      code: cleanCode,
      description: (description || '').trim(),
      sequence: Number(sequence) || 1,
      active: true,
      isExpediter: Boolean(isExpediter),
      displayOrder: Number(displayOrder) || 0,
      assignedMenuItemIds: Array.isArray(assignedMenuItemIds)
        ? assignedMenuItemIds.map((s) => String(s).trim().toUpperCase())
        : [],
      assignedCategories: Array.isArray(assignedCategories)
        ? assignedCategories.map((s) => String(s).trim().toUpperCase())
        : [],
    });

    return station;
  }

  /**
   * Persists menu-item-to-station routing for a specific café
   */
  static async routeMenuItemToStations({
    organisationId,
    cafeId,
    menuItemId,
    stationCodes = [],
  }) {
    if (!organisationId || !cafeId || !menuItemId) {
      throw new Error('organisationId, cafeId, and menuItemId are required for station routing.');
    }
    const cleanOrg = organisationId.trim().toUpperCase();
    const cleanCafe = cafeId.trim().toUpperCase();
    const cleanItem = menuItemId.trim().toUpperCase();
    const cleanCodes = stationCodes.map((c) => String(c).trim().toUpperCase());

    // Remove item from all stations in this cafe first
    await KdsPrepStation.updateMany(
      { organisationId: cleanOrg, cafeId: cleanCafe },
      { $pull: { assignedMenuItemIds: cleanItem } }
    );

    // Assign to specified stations in this cafe
    if (cleanCodes.length > 0) {
      await KdsPrepStation.updateMany(
        { organisationId: cleanOrg, cafeId: cleanCafe, code: { $in: cleanCodes } },
        { $addToSet: { assignedMenuItemIds: cleanItem } }
      );
    }

    return {
      success: true,
      menuItemId: cleanItem,
      stationCodes: cleanCodes,
      cafeId: cleanCafe,
    };
  }

  /**
   * Resolves prep stations for an order item based on cafe-configured stations and routing
   */
  static resolveItemPrepStations(item, cafeStations = []) {
    const rawItemId = (item.itemId || item._id || item.menuItemId || '').toString().trim().toUpperCase();
    const rawCat = (item.category || '').toString().trim().toUpperCase();
    const itemExplicitStation = (item.prepStation || '').toString().trim().toUpperCase();

    const matchedStations = [];

    for (const station of cafeStations) {
      const assignedItems = Array.isArray(station.assignedMenuItemIds) ? station.assignedMenuItemIds : [];
      const assignedCats = Array.isArray(station.assignedCategories) ? station.assignedCategories : [];

      if (rawItemId && assignedItems.includes(rawItemId)) {
        matchedStations.push(station.code);
        continue;
      }
      if (rawCat && assignedCats.includes(rawCat)) {
        matchedStations.push(station.code);
        continue;
      }
      if (itemExplicitStation && station.code === itemExplicitStation) {
        matchedStations.push(station.code);
        continue;
      }
    }

    if (matchedStations.length > 0) {
      return [...new Set(matchedStations)];
    }

    if (itemExplicitStation) {
      return [itemExplicitStation];
    }

    const inferred = this.inferPrepStation(item);
    return [inferred];
  }

  /**
   * Determines prep station for a given item based on category/station metadata fallback
   */
  static inferPrepStation(item) {
    if (item.prepStation) {
      return item.prepStation.toUpperCase();
    }
    const cat = (item.category || item.name || '').toUpperCase();
    if (cat.includes('COFFEE') || cat.includes('TEA') || cat.includes('BEVERAGE') || cat.includes('JUICE') || cat.includes('DRINK')) {
      return 'BEVERAGE_BAR';
    }
    if (cat.includes('PASTRY') || cat.includes('BAKERY') || cat.includes('SANDWICH') || cat.includes('CROISSANT') || cat.includes('CAKE')) {
      return 'BAKERY_COLD';
    }
    if (cat.includes('DESSERT') || cat.includes('ICE CREAM') || cat.includes('SUNDAE')) {
      return 'DESSERT';
    }
    return 'HOT_KITCHEN';
  }

  /**
   * Creates KDS tickets from a placed POS bill/order, routing to appropriate stations
   */
  static async createTicketsFromOrder({
    organisationId,
    cafeId,
    billId = '',
    posOrderId = '',
    orderNumber = '',
    tableNumber = '',
    diningOption = 'DINE_IN',
    priority = 'NORMAL',
    items = [],
    specialInstructions = '',
    targetPrepTimeMinutes = 15,
    splitByStation = true,
    paymentStatus = null,
    paymentGatedKitchenDispatch = false,
  }) {
    if (!organisationId || !cafeId) {
      throw new Error('OrganisationId and CafeId are strictly required for KDS ticket routing.');
    }
    if (!Array.isArray(items) || items.length === 0) {
      throw new Error('Cannot create KDS ticket with empty items list.');
    }

    const cleanOrg = organisationId.trim().toUpperCase();
    const cleanCafe = cafeId.trim().toUpperCase();

    // F036: Payment-Gated Kitchen Dispatch check
    let initialStatus = 'RECEIVED';
    if (paymentGatedKitchenDispatch && paymentStatus && paymentStatus !== 'PAID') {
      initialStatus = 'HELD_AWAITING_PAYMENT';
    }

    // Fetch café's configured prep stations
    const cafeStations = await this.listCafeStations({ organisationId: cleanOrg, cafeId: cleanCafe });

    const createdTickets = [];
    const stationMap = new Map();
    const allNormalizedItems = [];

    for (const it of items) {
      const assignedStations = this.resolveItemPrepStations(it, cafeStations);
      const baseItem = {
        itemId: it.itemId || it._id || `ITEM-${Math.random().toString(36).substring(2, 7).toUpperCase()}`,
        name: it.name || it.itemName || 'Unnamed Item',
        quantity: Math.max(1, Number(it.quantity) || 1),
        variant: it.variant || it.portion || '',
        customizations: Array.isArray(it.customizations) ? it.customizations : (it.customizations ? [it.customizations] : []),
        itemNotes: it.notes || it.itemNotes || '',
        allergens: Array.isArray(it.allergens) ? it.allergens : [],
        status: 'PENDING',
      };
      allNormalizedItems.push({ ...baseItem, prepStation: assignedStations[0] || 'HOT_KITCHEN' });

      for (const st of assignedStations) {
        if (!stationMap.has(st)) {
          stationMap.set(st, []);
        }
        stationMap.get(st).push({ ...baseItem, prepStation: st });
      }
    }

    if (splitByStation) {
      for (const [station, stationItems] of stationMap.entries()) {
        const ticketId = this.generateTicketId();
        const ticket = await KdsTicket.create({
          ticketId,
          organisationId: cleanOrg,
          cafeId: cleanCafe,
          billId,
          posOrderId,
          orderNumber,
          tableNumber,
          diningOption,
          prepStation: station,
          status: initialStatus,
          priority,
          targetPrepTimeMinutes,
          items: stationItems,
          specialInstructions,
          receivedAt: new Date(),
        });
        createdTickets.push(ticket);
      }

      // If items spread across multiple stations, create an EXPEDITER master ticket
      if (stationMap.size > 1) {
        const expediterTicket = await KdsTicket.create({
          ticketId: this.generateTicketId(),
          organisationId: cleanOrg,
          cafeId: cleanCafe,
          billId,
          posOrderId,
          orderNumber,
          tableNumber,
          diningOption,
          prepStation: 'EXPEDITER',
          status: initialStatus,
          priority,
          targetPrepTimeMinutes,
          items: allNormalizedItems,
          specialInstructions: `Expediter Aggregate - ${specialInstructions}`.trim(),
          receivedAt: new Date(),
        });
        createdTickets.push(expediterTicket);
      }
    } else {
      // Single unified ticket for all stations
      const ticketId = this.generateTicketId();
      const ticket = await KdsTicket.create({
        ticketId,
        organisationId: cleanOrg,
        cafeId: cleanCafe,
        billId,
        posOrderId,
        orderNumber,
        tableNumber,
        diningOption,
        prepStation: 'ALL',
        status: initialStatus,
        priority,
        targetPrepTimeMinutes,
        items: allNormalizedItems,
        specialInstructions,
        receivedAt: new Date(),
      });
      createdTickets.push(ticket);
    }

    return createdTickets;
  }

  /**
   * Retrieves active KDS tickets for a given cafe and prep station
   */
  static async listTickets({
    organisationId,
    cafeId,
    prepStation,
    status,
    priority,
    limit = 50,
  }) {
    const cleanOrg = organisationId.trim().toUpperCase();
    const cleanCafe = cafeId.trim().toUpperCase();

    const filter = {
      organisationId: cleanOrg,
      cafeId: cleanCafe,
    };

    if (prepStation && prepStation.toUpperCase() !== 'ALL') {
      filter.prepStation = prepStation.toUpperCase();
    }

    if (status) {
      if (Array.isArray(status)) {
        filter.status = { $in: status.map((s) => s.toUpperCase()) };
      } else {
        filter.status = status.toUpperCase();
      }
    } else {
      // By default show active pipeline
      filter.status = { $in: ['RECEIVED', 'PREPARING', 'READY'] };
    }

    if (priority) {
      filter.priority = priority.toUpperCase();
    }

    const tickets = await KdsTicket.find(filter)
      .sort({ priority: -1, receivedAt: 1 })
      .limit(Number(limit) || 50)
      .lean();

    const now = Date.now();
    return tickets.map((t) => {
      const recTime = t.receivedAt ? new Date(t.receivedAt).getTime() : new Date(t.createdAt).getTime();
      const ageSeconds = Math.max(0, Math.floor((now - recTime) / 1000));
      const targetSec = (t.targetPrepTimeMinutes || 15) * 60;
      return {
        ...t,
        ticketAgeSeconds: ageSeconds,
        isOverdue: ageSeconds > targetSec,
      };
    });
  }

  /**
   * Gets single ticket by ticketId
   */
  static async getTicketById({ organisationId, cafeId, ticketId }) {
    const cleanOrg = organisationId.trim().toUpperCase();
    const cleanCafe = cafeId.trim().toUpperCase();
    const cleanTicket = ticketId.trim().toUpperCase();

    const ticket = await KdsTicket.findOne({
      organisationId: cleanOrg,
      cafeId: cleanCafe,
      ticketId: cleanTicket,
    });

    if (!ticket) {
      throw new Error(`KDS ticket ${cleanTicket} not found for this café.`);
    }

    return ticket;
  }

  /**
   * State progression bumper: moves ticket through workflow stages
   */
  static async bumpTicket({
    organisationId,
    cafeId,
    ticketId,
    targetStatus,
    userId = '',
  }) {
    const ticket = await this.getTicketById({ organisationId, cafeId, ticketId });
    const now = new Date();

    let nextStatus = targetStatus ? targetStatus.toUpperCase() : null;

    if (!nextStatus) {
      // Default linear progression
      if (ticket.status === 'RECEIVED') nextStatus = 'PREPARING';
      else if (ticket.status === 'PREPARING') nextStatus = 'READY';
      else if (ticket.status === 'READY') nextStatus = 'COLLECTED';
      else nextStatus = ticket.status;
    }

    if (!KDS_STATUSES.includes(nextStatus)) {
      throw new Error(`Invalid KDS target status: ${nextStatus}`);
    }

    ticket.status = nextStatus;
    ticket.bumpedByUserId = userId;

    if (nextStatus === 'PREPARING' && !ticket.startedAt) {
      ticket.startedAt = now;
      ticket.items.forEach((item) => {
        if (item.status === 'PENDING') item.status = 'PREPARING';
      });
    } else if (nextStatus === 'READY') {
      ticket.completedAt = now;
      ticket.items.forEach((item) => {
        if (item.status !== 'CANCELLED' && item.status !== 'VOIDED') {
          item.status = 'COMPLETED';
          item.completedAt = now;
        }
      });
    } else if (nextStatus === 'COLLECTED') {
      ticket.collectedAt = now;
    } else if (nextStatus === 'CANCELLED') {
      ticket.cancelledAt = now;
      ticket.items.forEach((item) => {
        item.status = 'CANCELLED';
      });
    } else if (nextStatus === 'VOIDED') {
      ticket.voidedAt = now;
      ticket.items.forEach((item) => {
        item.status = 'VOIDED';
        item.isVoided = true;
      });
    }

    await ticket.save();
    return ticket;
  }

  /**
   * Bumps status of a single item on a ticket
   */
  static async bumpItem({
    organisationId,
    cafeId,
    ticketId,
    itemIndex,
    itemStatus = 'COMPLETED',
    userId = '',
  }) {
    const ticket = await this.getTicketById({ organisationId, cafeId, ticketId });
    const idx = Number(itemIndex);

    if (isNaN(idx) || idx < 0 || idx >= ticket.items.length) {
      throw new Error(`Item index ${itemIndex} is out of bounds for ticket ${ticketId}.`);
    }

    const item = ticket.items[idx];
    item.status = itemStatus.toUpperCase();
    if (item.status === 'COMPLETED') {
      item.completedAt = new Date();
    }

    // Check if all active items are now completed
    const allCompleted = ticket.items.every(
      (it) => it.status === 'COMPLETED' || it.status === 'CANCELLED' || it.status === 'VOIDED'
    );

    if (allCompleted && ticket.status !== 'READY' && ticket.status !== 'COLLECTED') {
      ticket.status = 'READY';
      ticket.completedAt = new Date();
    } else if (ticket.status === 'RECEIVED' && item.status === 'PREPARING') {
      ticket.status = 'PREPARING';
      ticket.startedAt = new Date();
    }

    ticket.bumpedByUserId = userId;
    await ticket.save();
    return ticket;
  }

  /**
   * Propagates POS item void across all station tickets for a bill
   */
  static async voidBillItems({
    organisationId,
    cafeId,
    billId,
    itemIds = [],
    voidReason = 'Voided from POS',
    userId = '',
  }) {
    const cleanOrg = organisationId.trim().toUpperCase();
    const cleanCafe = cafeId.trim().toUpperCase();

    const tickets = await KdsTicket.find({
      organisationId: cleanOrg,
      cafeId: cleanCafe,
      billId,
      status: { $nin: ['COLLECTED', 'CANCELLED', 'VOIDED'] },
    });

    const updatedTickets = [];

    for (const ticket of tickets) {
      let modified = false;
      for (const item of ticket.items) {
        if (itemIds.length === 0 || itemIds.includes(item.itemId)) {
          item.isVoided = true;
          item.voidReason = voidReason;
          item.status = 'VOIDED';
          modified = true;
        }
      }

      if (modified) {
        // If all items in this ticket are voided, mark the whole ticket voided
        const allVoided = ticket.items.every((it) => it.isVoided);
        if (allVoided) {
          ticket.status = 'VOIDED';
          ticket.voidedAt = new Date();
        }
        ticket.bumpedByUserId = userId;
        await ticket.save();
        updatedTickets.push(ticket);
      }
    }

    return updatedTickets;
  }

  /**
   * Returns station operational metrics: counts, overdue tickets, avg prep time
   */
  static async getStationMetrics({ organisationId, cafeId }) {
    const cleanOrg = organisationId.trim().toUpperCase();
    const cleanCafe = cafeId.trim().toUpperCase();

    const activeTickets = await KdsTicket.find({
      organisationId: cleanOrg,
      cafeId: cleanCafe,
      status: { $in: ['RECEIVED', 'PREPARING', 'READY'] },
    }).lean();

    const now = Date.now();
    const metrics = {
      totalActive: activeTickets.length,
      receivedCount: 0,
      preparingCount: 0,
      readyCount: 0,
      overdueCount: 0,
      rushCount: 0,
      stationBreakdown: {},
    };

    PREP_STATIONS.forEach((st) => {
      metrics.stationBreakdown[st] = { active: 0, overdue: 0, avgAgeSeconds: 0 };
    });

    const stationAgeSums = {};

    for (const t of activeTickets) {
      if (t.status === 'RECEIVED') metrics.receivedCount++;
      if (t.status === 'PREPARING') metrics.preparingCount++;
      if (t.status === 'READY') metrics.readyCount++;
      if (t.priority === 'RUSH' || t.priority === 'VIP') metrics.rushCount++;

      const recTime = t.receivedAt ? new Date(t.receivedAt).getTime() : new Date(t.createdAt).getTime();
      const ageSeconds = Math.max(0, Math.floor((now - recTime) / 1000));
      const targetSec = (t.targetPrepTimeMinutes || 15) * 60;

      if (ageSeconds > targetSec) {
        metrics.overdueCount++;
      }

      const st = t.prepStation || 'HOT_KITCHEN';
      if (!metrics.stationBreakdown[st]) {
        metrics.stationBreakdown[st] = { active: 0, overdue: 0, avgAgeSeconds: 0 };
      }
      metrics.stationBreakdown[st].active++;
      if (ageSeconds > targetSec) {
        metrics.stationBreakdown[st].overdue++;
      }
      stationAgeSums[st] = (stationAgeSums[st] || 0) + ageSeconds;
    }

    // Calculate averages per station
    for (const [st, sum] of Object.entries(stationAgeSums)) {
      const cnt = metrics.stationBreakdown[st].active;
      metrics.stationBreakdown[st].avgAgeSeconds = cnt > 0 ? Math.round(sum / cnt) : 0;
    }

    return metrics;
  }

  /**
   * F036: Release Payment-Gated Held Kitchen Tickets
   */
  static async releaseHeldTicketsForBill({ organisationId, cafeId, billId }) {
    if (!billId) {
      throw new Error('billId is required to release held tickets.');
    }
    const cleanOrg = organisationId.trim().toUpperCase();
    const cleanCafe = cafeId.trim().toUpperCase();

    const result = await KdsTicket.updateMany(
      {
        organisationId: cleanOrg,
        cafeId: cleanCafe,
        billId,
        status: 'HELD_AWAITING_PAYMENT',
      },
      {
        $set: { status: 'RECEIVED', receivedAt: new Date() },
      }
    );

    return {
      success: true,
      billId,
      releasedCount: result.modifiedCount || 0,
    };
  }

  /**
   * F272: KDS Aggregated Item Batch View
   * Groups pending items across active tickets for batch line cooking.
   */
  static async getAggregatedItemBatchView({ organisationId, cafeId, prepStation = null }) {
    const cleanOrg = organisationId.trim().toUpperCase();
    const cleanCafe = cafeId.trim().toUpperCase();
    const query = {
      organisationId: cleanOrg,
      cafeId: cleanCafe,
      status: { $in: ['RECEIVED', 'PREPARING'] },
    };
    if (prepStation && prepStation !== 'ALL') {
      query.prepStation = prepStation.trim().toUpperCase();
    }
    const tickets = await KdsTicket.find(query);
    const itemMap = new Map();

    for (const t of tickets) {
      for (const it of t.items) {
        if (it.isVoided || it.status === 'COMPLETED') continue;
        const key = `${it.itemId}_${it.variant || ''}_${it.prepStation || t.prepStation}`;
        if (!itemMap.has(key)) {
          itemMap.set(key, {
            itemId: it.itemId,
            name: it.name,
            variant: it.variant || '',
            prepStation: it.prepStation || t.prepStation,
            totalPendingQuantity: 0,
            ticketIds: [],
          });
        }
        const agg = itemMap.get(key);
        agg.totalPendingQuantity += Number(it.quantity) || 1;
        if (!agg.ticketIds.includes(t.ticketId)) {
          agg.ticketIds.push(t.ticketId);
        }
      }
    }

    const items = Array.from(itemMap.values()).map((v) => ({
      ...v,
      ticketCount: v.ticketIds.length,
    }));

    return {
      cafeId: cleanCafe,
      prepStation: prepStation || 'ALL',
      activeTicketCount: tickets.length,
      aggregatedItems: items,
    };
  }
}

module.exports = KdsService;
