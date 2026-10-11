'use strict';

/**
 * TABLE RESERVATION & WAITLIST SERVICE (P15 CHANNELS & FRONT SERVICE)
 *
 * Implements guest reservations, host desk waitlists, table assignments,
 * concurrency protections, and conflict prevention.
 *
 * FINANCIAL INVARIANT:
 * Reservations and waitlist entries MUST NOT create sales revenue, paid bills,
 * or inventory movements.
 */

const crypto = require('crypto');
const { Reservation, RESERVATION_STATUSES } = require('../models/Reservation');
const { WaitlistEntry, WAITLIST_STATUSES } = require('../models/WaitlistEntry');
const { DiningTable } = require('../models/DiningTable');
const { TableSession } = require('../models/TableSession');
const { Cafe } = require('../models/Cafe');
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

class TableReservationService {
  /**
   * Creates a new table reservation with capacity and conflict validation.
   */
  static async createReservation({
    cafeId,
    guestName,
    guestPhone,
    guestEmail = '',
    partySize,
    bookingTime,
    durationMinutes = 90,
    sectionPreference = 'ANY',
    specialRequests = '',
    sourceChannel = 'PHONE',
    assignedTableId = null,
    organisationId,
    authContext = {},
  }) {
    assertCafeAccess(authContext, cafeId);

    if (!guestName || !guestPhone || !partySize || !bookingTime) {
      throw new ApiError(400, 'REQUIRED_FIELDS_MISSING', 'guestName, guestPhone, partySize, and bookingTime are required.');
    }

    const normCafeId = cafeId.trim().toUpperCase();
    const cleanPhone = String(guestPhone).replace(/[^0-9]/g, '');
    const bookingDate = new Date(bookingTime);
    if (isNaN(bookingDate.getTime())) {
      throw new ApiError(400, 'INVALID_BOOKING_TIME', 'Invalid booking date/time provided.');
    }

    const partyCount = Math.max(1, Math.floor(Number(partySize)));

    // Verify cafe exists
    const cafe = await Cafe.findOne({ cafeId: normCafeId, organisationId });
    if (!cafe) {
      throw new ApiError(404, 'CAFE_NOT_FOUND', `Café ${normCafeId} not found.`);
    }

    // Duplicate check: Same guest, same cafe, overlapping booking window (+/- 30 min)
    const windowStart = new Date(bookingDate.getTime() - 30 * 60 * 1000);
    const windowEnd = new Date(bookingDate.getTime() + 30 * 60 * 1000);
    const duplicate = await Reservation.findOne({
      organisationId,
      cafeId: normCafeId,
      guestPhone: cleanPhone,
      status: { $in: ['CONFIRMED', 'CHECKED_IN'] },
      bookingTime: { $gte: windowStart, $lte: windowEnd },
    });
    if (duplicate) {
      throw new ApiError(
        409,
        'DUPLICATE_BOOKING',
        `A confirmed reservation already exists for ${guestName} (${cleanPhone}) at ${bookingDate.toISOString()}.`
      );
    }

    // If specific table requested, check for conflicting assignment
    let tableNumber = null;
    if (assignedTableId) {
      const table = await DiningTable.findOne({
        tableId: assignedTableId,
        cafeId: normCafeId,
        organisationId,
      });
      if (!table) {
        throw new ApiError(404, 'TABLE_NOT_FOUND', `Assigned table ${assignedTableId} not found.`);
      }
      if (table.seatingCapacity < partyCount) {
        throw new ApiError(
          400,
          'INSUFFICIENT_TABLE_CAPACITY',
          `Table ${table.tableNumber} capacity (${table.seatingCapacity}) is smaller than party size (${partyCount}).`
        );
      }

      const tableConflict = await Reservation.findOne({
        organisationId,
        cafeId: normCafeId,
        assignedTableId,
        status: { $in: ['CONFIRMED', 'CHECKED_IN'] },
        bookingTime: {
          $gte: new Date(bookingDate.getTime() - durationMinutes * 60 * 1000),
          $lte: new Date(bookingDate.getTime() + durationMinutes * 60 * 1000),
        },
      });
      if (tableConflict) {
        throw new ApiError(
          409,
          'TABLE_CONFLICT',
          `Table ${table.tableNumber} is already reserved around ${bookingDate.toISOString()}.`
        );
      }
      tableNumber = table.tableNumber;
    }

    const reservationId = `RES-${normCafeId}-${Date.now()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
    const bookingReference = `BK-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;

    const reservation = await Reservation.create({
      reservationId,
      bookingReference,
      organisationId,
      cafeId: normCafeId,
      guestName: String(guestName).trim(),
      guestPhone: cleanPhone,
      guestEmail: String(guestEmail || '').trim(),
      partySize: partyCount,
      bookingTime: bookingDate,
      durationMinutes,
      sectionPreference,
      specialRequests: String(specialRequests || '').slice(0, 500),
      sourceChannel,
      status: 'CONFIRMED',
      assignedTableId,
      assignedTableNumber: tableNumber,
      history: [
        {
          action: 'CREATED',
          actorUserId: authContext.userId || 'STAFF',
          timestamp: new Date(),
          notes: `Reservation created via ${sourceChannel}`,
        },
      ],
    });

    await auditService.recordAuditEvent({
      organisationId,
      cafeId: normCafeId,
      actorUserId: authContext.userId || 'STAFF',
      actorRole: authContext.role || 'CAFE_ADMIN',
      module: 'RESERVATIONS',
      action: 'RESERVATION_CREATED',
      entityType: 'RESERVATION',
      entityId: reservation.reservationId,
      reason: `Booked for party of ${partyCount} on ${bookingDate.toISOString()}`,
      result: 'SUCCESS',
    }).catch(() => {});

    return reservation;
  }

  /**
   * Updates reservation status (CHECKED_IN, SEATED, COMPLETED, CANCELLED, NO_SHOW).
   */
  static async updateReservationStatus({
    reservationId,
    status,
    assignedTableId = null,
    cancellationReason = null,
    cafeId,
    organisationId,
    authContext = {},
  }) {
    assertCafeAccess(authContext, cafeId);

    if (!RESERVATION_STATUSES.includes(status)) {
      throw new ApiError(400, 'INVALID_STATUS', `Status must be one of: ${RESERVATION_STATUSES.join(', ')}`);
    }

    const normCafeId = cafeId.trim().toUpperCase();
    const reservation = await Reservation.findOne({
      reservationId,
      cafeId: normCafeId,
      organisationId,
    });
    if (!reservation) {
      throw new ApiError(404, 'RESERVATION_NOT_FOUND', `Reservation ${reservationId} not found.`);
    }

    // Disallow transitions on already closed reservations
    if (['COMPLETED', 'CANCELLED', 'NO_SHOW'].includes(reservation.status)) {
      throw new ApiError(
        400,
        'TERMINAL_STATUS',
        `Reservation is already ${reservation.status} and cannot be transitioned to ${status}.`
      );
    }

    const actor = authContext.userId || 'STAFF';
    const now = new Date();

    if (status === 'CHECKED_IN') {
      reservation.status = 'CHECKED_IN';
      reservation.checkedInAt = now;
      reservation.history.push({ action: 'CHECKED_IN', actorUserId: actor, timestamp: now });
    } else if (status === 'SEATED') {
      // Must have table assigned
      const tableToAssign = assignedTableId || reservation.assignedTableId;
      if (!tableToAssign) {
        throw new ApiError(400, 'TABLE_REQUIRED_TO_SEAT', 'A table must be assigned to seat the reservation party.');
      }

      const table = await DiningTable.findOne({
        tableId: tableToAssign,
        cafeId: normCafeId,
        organisationId,
      });
      if (!table) {
        throw new ApiError(404, 'TABLE_NOT_FOUND', `Dining table ${tableToAssign} not found.`);
      }
      if (table.isServiceBlocked) {
        throw new ApiError(403, 'TABLE_BLOCKED', `Table ${table.tableNumber} is blocked for service.`);
      }

      // Concurrency check: If table is already occupied by an active session, fail closed
      if (table.status === 'OCCUPIED') {
        throw new ApiError(409, 'TABLE_ALREADY_OCCUPIED', `Table ${table.tableNumber} is currently occupied.`);
      }

      reservation.status = 'SEATED';
      reservation.seatedAt = now;
      reservation.assignedTableId = table.tableId;
      reservation.assignedTableNumber = table.tableNumber;
      reservation.history.push({
        action: 'SEATED',
        actorUserId: actor,
        timestamp: now,
        notes: `Seated at Table ${table.tableNumber}`,
      });

      // Update table to OCCUPIED and open session
      const sessionId = `TSESS-${Date.now()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
      const session = await TableSession.create({
        sessionId,
        organisationId,
        cafeId: normCafeId,
        tableId: table.tableId,
        tableNumber: table.tableNumber,
        covers: reservation.partySize,
        status: 'ACTIVE',
        customerName: reservation.guestName,
        customerPhone: reservation.guestPhone,
        openedAt: now,
        openedByUserId: actor,
        rounds: [],
      });

      table.status = 'OCCUPIED';
      table.activeSessionId = session.sessionId;
      await table.save();
    } else if (status === 'COMPLETED') {
      reservation.status = 'COMPLETED';
      reservation.completedAt = now;
      reservation.history.push({ action: 'COMPLETED', actorUserId: actor, timestamp: now });
    } else if (status === 'CANCELLED') {
      reservation.status = 'CANCELLED';
      reservation.cancelledAt = now;
      reservation.cancellationReason = cancellationReason || 'Cancelled by guest or host';
      reservation.history.push({
        action: 'CANCELLED',
        actorUserId: actor,
        timestamp: now,
        notes: reservation.cancellationReason,
      });
    } else if (status === 'NO_SHOW') {
      reservation.status = 'NO_SHOW';
      reservation.cancelledAt = now;
      reservation.cancellationReason = 'Guest did not arrive';
      reservation.history.push({ action: 'NO_SHOW', actorUserId: actor, timestamp: now });
    }

    await reservation.save();

    await auditService.recordAuditEvent({
      organisationId,
      cafeId: normCafeId,
      actorUserId: actor,
      actorRole: authContext.role || 'CAFE_ADMIN',
      module: 'RESERVATIONS',
      action: `RESERVATION_${status}`,
      entityType: 'RESERVATION',
      entityId: reservation.reservationId,
      reason: `Updated reservation status to ${status}`,
      result: 'SUCCESS',
    }).catch(() => {});

    return reservation;
  }

  /**
   * Adds walk-in party to host desk waitlist queue.
   */
  static async addToWaitlist({
    guestName,
    guestPhone,
    partySize,
    sectionPreference = 'ANY',
    estimatedWaitMinutes = 15,
    notes = '',
    cafeId,
    organisationId,
    authContext = {},
  }) {
    assertCafeAccess(authContext, cafeId);

    if (!guestName || !guestPhone || !partySize) {
      throw new ApiError(400, 'REQUIRED_FIELDS_MISSING', 'guestName, guestPhone, and partySize are required.');
    }

    const normCafeId = cafeId.trim().toUpperCase();
    const cleanPhone = String(guestPhone).replace(/[^0-9]/g, '');
    const partyCount = Math.max(1, Math.floor(Number(partySize)));

    // Prevent duplicate active waitlist entry for same phone
    const existingWaiting = await WaitlistEntry.findOne({
      organisationId,
      cafeId: normCafeId,
      guestPhone: cleanPhone,
      status: { $in: ['WAITING', 'NOTIFIED'] },
    });
    if (existingWaiting) {
      return existingWaiting; // Idempotently return existing waitlist ticket
    }

    // Determine next sequential queue number for today
    const today = new Date().toISOString().slice(0, 10);
    const countToday = await WaitlistEntry.countDocuments({
      organisationId,
      cafeId: normCafeId,
      createdAt: { $gte: new Date(today) },
    });
    const queueNumber = `Q-${String(countToday + 1).padStart(2, '0')}`;
    const waitlistId = `WL-${normCafeId}-${Date.now()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;

    const entry = await WaitlistEntry.create({
      waitlistId,
      queueNumber,
      organisationId,
      cafeId: normCafeId,
      guestName: String(guestName).trim(),
      guestPhone: cleanPhone,
      partySize: partyCount,
      sectionPreference,
      estimatedWaitMinutes: Math.max(0, Number(estimatedWaitMinutes) || 15),
      notes: String(notes || '').slice(0, 300),
      status: 'WAITING',
      createdByUserId: authContext.userId || 'HOST',
    });

    return entry;
  }

  /**
   * Seats a waiting party from the waitlist into an available table.
   * Atomic check-and-set protects against concurrent double-seating.
   */
  static async seatWaitlistEntry({
    waitlistId,
    tableId,
    cafeId,
    organisationId,
    authContext = {},
  }) {
    assertCafeAccess(authContext, cafeId);

    if (!waitlistId || !tableId) {
      throw new ApiError(400, 'REQUIRED_FIELDS_MISSING', 'waitlistId and tableId are required.');
    }

    const normCafeId = cafeId.trim().toUpperCase();
    const entry = await WaitlistEntry.findOne({
      waitlistId,
      cafeId: normCafeId,
      organisationId,
    });
    if (!entry) {
      throw new ApiError(404, 'WAITLIST_ENTRY_NOT_FOUND', `Waitlist entry ${waitlistId} not found.`);
    }

    if (entry.status === 'SEATED') {
      throw new ApiError(409, 'ALREADY_SEATED', `Waitlist entry ${waitlistId} has already been seated.`);
    }
    if (['CANCELLED', 'NO_SHOW'].includes(entry.status)) {
      throw new ApiError(400, 'INVALID_WAITLIST_STATUS', `Cannot seat entry that is ${entry.status}.`);
    }

    const table = await DiningTable.findOne({
      tableId,
      cafeId: normCafeId,
      organisationId,
    });
    if (!table) {
      throw new ApiError(404, 'TABLE_NOT_FOUND', `Table ${tableId} not found.`);
    }
    if (table.status === 'OCCUPIED') {
      throw new ApiError(409, 'TABLE_ALREADY_OCCUPIED', `Table ${table.tableNumber} is currently occupied.`);
    }
    if (table.isServiceBlocked) {
      throw new ApiError(403, 'TABLE_BLOCKED', `Table ${table.tableNumber} is blocked for service.`);
    }

    const now = new Date();
    const actor = authContext.userId || 'HOST';

    entry.status = 'SEATED';
    entry.seatedAt = now;
    entry.seatedTableId = table.tableId;
    entry.seatedTableNumber = table.tableNumber;
    await entry.save();

    // Open active table session
    const sessionId = `TSESS-${Date.now()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
    const session = await TableSession.create({
      sessionId,
      organisationId,
      cafeId: normCafeId,
      tableId: table.tableId,
      tableNumber: table.tableNumber,
      covers: entry.partySize,
      status: 'ACTIVE',
      customerName: entry.guestName,
      customerPhone: entry.guestPhone,
      openedAt: now,
      openedByUserId: actor,
      rounds: [],
    });

    table.status = 'OCCUPIED';
    table.activeSessionId = session.sessionId;
    await table.save();

    return {
      waitlistEntry: entry,
      session,
      table,
    };
  }

  /**
   * Updates waitlist entry status (NOTIFIED, CANCELLED, NO_SHOW).
   */
  static async updateWaitlistStatus({
    waitlistId,
    status,
    cafeId,
    organisationId,
    authContext = {},
  }) {
    assertCafeAccess(authContext, cafeId);

    if (!WAITLIST_STATUSES.includes(status)) {
      throw new ApiError(400, 'INVALID_STATUS', `Status must be one of: ${WAITLIST_STATUSES.join(', ')}`);
    }

    const normCafeId = cafeId.trim().toUpperCase();
    const entry = await WaitlistEntry.findOne({
      waitlistId,
      cafeId: normCafeId,
      organisationId,
    });
    if (!entry) {
      throw new ApiError(404, 'WAITLIST_ENTRY_NOT_FOUND', `Waitlist entry ${waitlistId} not found.`);
    }

    entry.status = status;
    if (status === 'NOTIFIED') {
      entry.notifiedAt = new Date();
    } else if (['CANCELLED', 'NO_SHOW'].includes(status)) {
      entry.cancelledAt = new Date();
    }
    await entry.save();

    return entry;
  }

  /**
   * Retrieves operational Host Desk summary (active reservations, waitlist queue, table availability).
   */
  static async getHostDeskSummary({ cafeId, organisationId, authContext = {} }) {
    assertCafeAccess(authContext, cafeId);

    const normCafeId = cafeId.trim().toUpperCase();
    const today = new Date().toISOString().slice(0, 10);
    const startOfDay = new Date(`${today}T00:00:00.000Z`);
    const endOfDay = new Date(`${today}T23:59:59.999Z`);

    const reservations = await Reservation.find({
      organisationId,
      cafeId: normCafeId,
      bookingTime: { $gte: startOfDay, $lte: endOfDay },
    })
      .sort({ bookingTime: 1 })
      .lean();

    const waitlist = await WaitlistEntry.find({
      organisationId,
      cafeId: normCafeId,
      status: { $in: ['WAITING', 'NOTIFIED'] },
    })
      .sort({ arrivalTime: 1 })
      .lean();

    const tables = await DiningTable.find({
      organisationId,
      cafeId: normCafeId,
    })
      .sort({ sortOrder: 1, tableNumber: 1 })
      .lean();

    return {
      businessDate: today,
      reservationsSummary: {
        total: reservations.length,
        confirmed: reservations.filter((r) => r.status === 'CONFIRMED').length,
        checkedIn: reservations.filter((r) => r.status === 'CHECKED_IN').length,
        seated: reservations.filter((r) => r.status === 'SEATED').length,
        completed: reservations.filter((r) => r.status === 'COMPLETED').length,
        cancelled: reservations.filter((r) => r.status === 'CANCELLED' || r.status === 'NO_SHOW').length,
      },
      reservations,
      waitlistQueue: waitlist,
      tables,
    };
  }
}

module.exports = {
  TableReservationService,
};
