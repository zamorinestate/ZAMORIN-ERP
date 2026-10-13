'use strict';

const { ApiError } = require('../utils/ApiError');

/**
 * Virtual Kitchen Display System (KDS) & Kitchen Pass Engine (Category 3)
 * Provides real-time digital ticket dispatch, station-specific routing,
 * elapsed-time alerts, and bump bar functionality.
 */
class KdsStationService {
  static STATIONS = ['ALL', 'BARISTA', 'HOT_KITCHEN', 'DESSERT_BAR', 'DISPATCH'];

  static activeChits = new Map();
  static bumpedHistory = [];

  /**
   * Dispatches a new kitchen order ticket into the digital KDS stream.
   */
  static pushOrderToKds({
    orderId,
    invoiceNumber,
    cafeId,
    tableNumber = null,
    orderType = 'DINE_IN',
    lineItems = [],
    items = [],
  }) {
    if (!orderId || !cafeId) {
      throw new ApiError(400, 'KDS_ORDER_REQUIRED', 'orderId and cafeId are required.');
    }

    const chitId = `KDS-${Date.now().toString().slice(-6)}-${Math.floor(Math.random() * 90 + 10)}`;
    const now = new Date();
    const rawItems = (items && items.length > 0) ? items : lineItems;

    const chit = {
      chitId,
      ticketId: chitId,
      orderId,
      invoiceNumber: invoiceNumber || orderId,
      cafeId: cafeId.toUpperCase(),
      tableNumber,
      orderType,
      items: rawItems.map((li) => {
        let station = 'HOT_KITCHEN';
        const cat = String(li.category || '').toUpperCase();
        if (cat.includes('BEVERAGE') || cat.includes('COFFEE') || cat.includes('TEA') || cat.includes('DRINK')) {
          station = 'BARISTA';
        } else if (cat.includes('DESSERT') || cat.includes('PASTRY')) {
          station = 'DESSERT_BAR';
        } else if (li.kitchenStation) {
          station = String(li.kitchenStation).toUpperCase();
        }

        return {
          orderItemId: li.orderItemId || li.itemId || `ITEM-${Math.floor(Math.random() * 1000)}`,
          itemId: li.menuItemId || li.itemId || li.orderItemId,
          name: li.itemNameSnapshot || li.name,
          quantity: li.quantity || 1,
          station,
          modifiers: li.modifiers || [],
          notes: li.itemNotes || li.notes || '',
          done: false,
          status: 'PENDING',
        };
      }),
      status: 'PREPARING',
      createdAt: now,
      elapsedSeconds: 0,
      urgency: 'NORMAL',
      urgencyColor: 'GREEN',
      priority: orderType === 'TAKEAWAY' ? 'HIGH' : 'NORMAL',
    };

    this.activeChits.set(chitId, chit);

    return chit;
  }

  static ingestOrderToKds(params) {
    return this.pushOrderToKds(params);
  }

  /**
   * Retrieves active KDS tickets filtered by outlet and station.
   */
  static getActiveTickets(cafeIdOrOpts, stationParam = 'ALL') {
    let cafeId = cafeIdOrOpts;
    let station = stationParam;
    if (typeof cafeIdOrOpts === 'object' && cafeIdOrOpts !== null) {
      cafeId = cafeIdOrOpts.cafeId;
      station = cafeIdOrOpts.station || 'ALL';
    }

    const normStation = String(station || 'ALL').toUpperCase();
    const now = Date.now();
    const result = [];

    for (const chit of this.activeChits.values()) {
      if (cafeId && chit.cafeId !== cafeId.toUpperCase()) continue;

      const elapsed = Math.floor((now - new Date(chit.createdAt).getTime()) / 1000);
      chit.elapsedSeconds = elapsed;
      chit.urgency = elapsed > 1200 ? 'OVERDUE' : elapsed > 600 ? 'WARNING' : 'NORMAL';
      chit.urgencyColor = chit.urgency === 'OVERDUE' ? 'RED' : chit.urgency === 'WARNING' ? 'YELLOW' : 'GREEN';

      if (normStation === 'ALL') {
        result.push(chit);
      } else {
        const stationItems = chit.items.filter((it) => it.station === normStation || it.station === 'ALL');
        if (stationItems.length > 0) {
          result.push({
            ...chit,
            items: stationItems,
          });
        }
      }
    }

    return result.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  }

  /**
   * Marks a specific item prepared within a KDS ticket.
   */
  static bumpItem({ ticketId, chitId, orderItemId, itemId }) {
    const id = ticketId || chitId;
    if (!id || !this.activeChits.has(id)) {
      throw new ApiError(404, 'KDS_TICKET_NOT_FOUND', `KDS ticket ${id} not found.`);
    }

    const chit = this.activeChits.get(id);
    const targetItemId = orderItemId || itemId;
    const item = chit.items.find((i) => i.orderItemId === targetItemId || i.itemId === targetItemId);
    if (item) {
      item.done = true;
      item.status = 'PREPARED';
    }

    return chit;
  }

  /**
   * Bumps (completes) an order ticket on the KDS station.
   */
  static bumpTicket(chitIdOrOpts, actorUserIdParam = 'CHEF') {
    let chitId = chitIdOrOpts;
    let actorUserId = actorUserIdParam;
    if (typeof chitIdOrOpts === 'object' && chitIdOrOpts !== null) {
      chitId = chitIdOrOpts.chitId || chitIdOrOpts.ticketId;
      actorUserId = chitIdOrOpts.actorUserId || 'CHEF';
    }

    if (!chitId || !this.activeChits.has(chitId)) {
      throw new ApiError(404, 'KDS_TICKET_NOT_FOUND', `KDS ticket ${chitId} not found.`);
    }

    const chit = this.activeChits.get(chitId);
    chit.status = 'COMPLETED';
    chit.bumpedAt = new Date().toISOString();
    chit.bumpedBy = actorUserId;

    this.activeChits.delete(chitId);
    this.bumpedHistory.unshift(chit);
    if (this.bumpedHistory.length > 50) this.bumpedHistory.pop();

    return chit;
  }

  /**
   * Recalls the most recently bumped ticket back to the active KDS queue.
   */
  static recallTicket(chitIdOrOpts = null) {
    let chitId = chitIdOrOpts;
    if (typeof chitIdOrOpts === 'object' && chitIdOrOpts !== null) {
      chitId = chitIdOrOpts.chitId || chitIdOrOpts.ticketId;
    }

    let target = null;
    if (chitId) {
      const idx = this.bumpedHistory.findIndex((c) => c.chitId === chitId || c.ticketId === chitId);
      if (idx !== -1) {
        target = this.bumpedHistory.splice(idx, 1)[0];
      }
    } else if (this.bumpedHistory.length > 0) {
      target = this.bumpedHistory.shift();
    }

    if (!target) {
      throw new ApiError(404, 'NO_BUMPED_TICKETS_TO_RECALL', 'No recently bumped ticket found to recall.');
    }

    target.status = 'PREPARING';
    target.recalledAt = new Date().toISOString();
    this.activeChits.set(target.chitId, target);

    return target;
  }
}


module.exports = { KdsStationService };
