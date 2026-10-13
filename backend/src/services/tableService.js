'use strict';

/**
 * TABLE SERVICE (P15 CHANNELS, QR ORDERING & FRONT SERVICE)
 *
 * Implements authoritative dining table operations, session management,
 * and canonical POS bill settlement for table-side dining.
 */

const crypto = require('crypto');
const { DiningTable, TABLE_STATUSES } = require('../models/DiningTable');
const { TableSession, SESSION_STATUSES } = require('../models/TableSession');
const { Bill } = require('../models/Bill');
const { Cafe } = require('../models/Cafe');
const { allocateInvoiceNumber, calculateCustomerPayableRounding50P, roundToPaisa } = require('./gstTaxService');
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

class TableService {
  /**
   * Lists all tables for a café with real-time occupancy and active session state.
   */
  static async listTables({ cafeId, organisationId, authContext = {} }) {
    assertCafeAccess(authContext, cafeId);

    const tables = await DiningTable.find({
      organisationId,
      cafeId: cafeId.trim().toUpperCase(),
    })
      .sort({ sortOrder: 1, tableNumber: 1 })
      .lean();

    // Enrich with active session details if available
    const activeSessionIds = tables
      .map((t) => t.activeSessionId)
      .filter(Boolean);

    const activeSessions = await TableSession.find({
      organisationId,
      sessionId: { $in: activeSessionIds },
      status: 'ACTIVE',
    }).lean();

    const sessionMap = new Map();
    for (const s of activeSessions) {
      sessionMap.set(s.sessionId, s);
    }

    return tables.map((t) => {
      const sess = t.activeSessionId ? sessionMap.get(t.activeSessionId) : null;
      return {
        ...t,
        activeSession: sess
          ? {
              sessionId: sess.sessionId,
              covers: sess.covers,
              roundsCount: (sess.rounds || []).length,
              cumulativeTotalPaisa: sess.cumulativeTotalPaisa || 0,
              openedAt: sess.openedAt,
              customerName: sess.customerName,
            }
          : null,
      };
    });
  }

  /**
   * Creates a new dining table in a café.
   */
  static async createTable({
    tableNumber,
    section = 'Main Dining',
    seatingCapacity = 4,
    cafeId,
    organisationId,
    authContext = {},
  }) {
    assertCafeAccess(authContext, cafeId);

    if (!tableNumber) {
      throw new ApiError(400, 'TABLE_NUMBER_REQUIRED', 'Table number is required.');
    }

    const normTableNum = String(tableNumber).trim().toUpperCase();
    const normCafeId = String(cafeId).trim().toUpperCase();

    const existing = await DiningTable.findOne({
      organisationId,
      cafeId: normCafeId,
      tableNumber: normTableNum,
    });
    if (existing) {
      throw new ApiError(400, 'TABLE_ALREADY_EXISTS', `Table ${normTableNum} already exists in this café.`);
    }

    const tableId = `TBL-${normCafeId}-${normTableNum}`;

    const table = await DiningTable.create({
      tableId,
      tableNumber: normTableNum,
      organisationId,
      cafeId: normCafeId,
      section: String(section || 'Main Dining').trim(),
      seatingCapacity: Math.max(1, Number(seatingCapacity) || 4),
      status: 'AVAILABLE',
    });

    await auditService.recordAuditEvent({
      organisationId,
      cafeId: normCafeId,
      actorUserId: authContext.userId || 'SYSTEM',
      actorRole: authContext.role || 'CAFE_ADMIN',
      module: 'TABLES',
      action: 'TABLE_CREATED',
      entityType: 'DINING_TABLE',
      entityId: table.tableId,
      reason: `Created dining table ${normTableNum}`,
      result: 'SUCCESS',
    }).catch(() => {});

    return table;
  }

  /**
   * Updates dining table status (e.g. AVAILABLE, BLOCKED).
   */
  static async updateTableStatus({
    tableId,
    status,
    isServiceBlocked = false,
    cafeId,
    organisationId,
    authContext = {},
  }) {
    assertCafeAccess(authContext, cafeId);

    if (!TABLE_STATUSES.includes(status)) {
      throw new ApiError(400, 'INVALID_TABLE_STATUS', `Status must be one of: ${TABLE_STATUSES.join(', ')}`);
    }

    const table = await DiningTable.findOne({
      tableId,
      cafeId: cafeId.trim().toUpperCase(),
      organisationId,
    });
    if (!table) {
      throw new ApiError(404, 'TABLE_NOT_FOUND', `Table ${tableId} not found.`);
    }

    table.status = status;
    if (isServiceBlocked !== undefined) {
      table.isServiceBlocked = Boolean(isServiceBlocked);
    }
    await table.save();

    return table;
  }

  /**
   * Opens an active dining session at a table.
   */
  static async openTableSession({
    tableId,
    covers = 2,
    customerName = 'Guest',
    customerPhone = '',
    cafeId,
    organisationId,
    authContext = {},
  }) {
    assertCafeAccess(authContext, cafeId);

    const normCafeId = cafeId.trim().toUpperCase();
    const table = await DiningTable.findOne({
      tableId,
      cafeId: normCafeId,
      organisationId,
    });
    if (!table) {
      throw new ApiError(404, 'TABLE_NOT_FOUND', `Table ${tableId} not found.`);
    }

    if (table.isServiceBlocked) {
      throw new ApiError(403, 'TABLE_BLOCKED', 'Dining table is blocked for service.');
    }

    if (table.status === 'OCCUPIED' && table.activeSessionId) {
      const existing = await TableSession.findOne({
        sessionId: table.activeSessionId,
        status: 'ACTIVE',
      });
      if (existing) {
        return existing; // Idempotently return active session
      }
    }

    const sessionId = `TSESS-${Date.now()}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
    const session = await TableSession.create({
      sessionId,
      organisationId,
      cafeId: normCafeId,
      tableId: table.tableId,
      tableNumber: table.tableNumber,
      covers: Math.max(1, Number(covers) || 2),
      status: 'ACTIVE',
      customerName: String(customerName || 'Guest').trim(),
      customerPhone: String(customerPhone || '').trim(),
      openedAt: new Date(),
      openedByUserId: authContext.userId || 'STAFF',
      rounds: [],
      cumulativeTotalPaisa: 0,
    });

    table.activeSessionId = session.sessionId;
    table.status = 'OCCUPIED';
    await table.save();

    await auditService.recordAuditEvent({
      organisationId,
      cafeId: normCafeId,
      actorUserId: authContext.userId || 'STAFF',
      actorRole: authContext.role || 'CAFE_ADMIN',
      module: 'TABLES',
      action: 'TABLE_SESSION_OPENED',
      entityType: 'TABLE_SESSION',
      entityId: session.sessionId,
      reason: `Opened table session for Table ${table.tableNumber}`,
      result: 'SUCCESS',
    }).catch(() => {});

    return session;
  }

  /**
   * Closes a table session and consolidates all rounds into a canonical P09 POS Bill.
   * Releases table to AVAILABLE.
   */
  static async closeTableSessionAndBill({
    sessionId,
    paymentMethod = 'CASH',
    tenders = [],
    cashierUserId = 'CASHIER-01',
    cafeId,
    organisationId,
    authContext = {},
  }) {
    assertCafeAccess(authContext, cafeId);

    const normCafeId = cafeId.trim().toUpperCase();
    const session = await TableSession.findOne({
      sessionId,
      cafeId: normCafeId,
      organisationId,
    });
    if (!session) {
      throw new ApiError(404, 'SESSION_NOT_FOUND', `Table session ${sessionId} not found.`);
    }

    if (session.status === 'CLOSED' || session.status === 'BILLED') {
      if (session.currentBillId) {
        const existingBill = await Bill.findOne({ billId: session.currentBillId });
        return { session, bill: existingBill, alreadyClosed: true };
      }
    }

    // Consolidate all line items from all rounds
    const consolidatedLineItems = [];
    let subtotalPaisa = 0;
    let cgstPaisa = 0;
    let sgstPaisa = 0;

    for (const round of session.rounds || []) {
      for (const item of round.lineItems || []) {
        consolidatedLineItems.push({
          menuItemId: item.menuItemId,
          itemNameSnapshot: item.itemNameSnapshot,
          quantity: item.quantity,
          unitPricePaisa: item.unitPricePaisa,
          lineSubtotalPaisa: item.lineSubtotalPaisa,
          taxRatePercent: item.taxRatePercent || 5,
          taxClassification: 'GST_5',
          cgstPaisa: item.cgstPaisa || 0,
          sgstPaisa: item.sgstPaisa || 0,
          igstPaisa: 0,
          lineTotalPaisa: item.lineTotalPaisa,
          modifiers: item.modifiers || {},
          variantSnapshot: item.variantSnapshot || null,
          comboSnapshot: item.comboSnapshot || null,
          itemNotes: item.itemNotes || '',
        });
        subtotalPaisa += item.lineSubtotalPaisa;
        cgstPaisa += item.cgstPaisa || 0;
        sgstPaisa += item.sgstPaisa || 0;
      }
    }

    if (consolidatedLineItems.length === 0) {
      throw new ApiError(400, 'NO_ITEMS_IN_SESSION', 'Cannot bill a table session with 0 items ordered.');
    }

    const preRoundingTotalPaisa = subtotalPaisa + cgstPaisa + sgstPaisa;
    const { roundOffPaisa, finalPayablePaisa: totalPaisa } =
      calculateCustomerPayableRounding50P(preRoundingTotalPaisa);

    const businessDate = new Date().toISOString().slice(0, 10);
    const dateStamp = businessDate.replace(/-/g, '');
    const randSeq = Math.floor(1000 + Math.random() * 9000);
    const billId = `BILL-${dateStamp}-${randSeq}`;

    // Allocate invoice number
    let invoiceNumber = null;
    try {
      const alloc = await allocateInvoiceNumber(organisationId, normCafeId, businessDate);
      invoiceNumber = alloc && alloc.invoiceNumber ? alloc.invoiceNumber : (typeof alloc === 'string' ? alloc : `INV-${normCafeId}-${Date.now()}`);
    } catch (_) {
      invoiceNumber = `INV-${normCafeId}-${Date.now()}`;
    }

    const resolvedTenders = tenders && tenders.length > 0
      ? tenders
      : [
          {
            paymentMethod,
            amountPaisa: totalPaisa,
            status: 'COMPLETED',
            transactionTimestamp: new Date(),
          },
        ];

    const bill = await Bill.create({
      billId,
      invoiceNumber,
      organisationId,
      cafeId: normCafeId,
      businessDate,
      orderType: 'DINE_IN',
      serviceMode: 'DINE_IN',
      guestCovers: session.covers || 1,
      tableNumber: session.tableNumber,
      customerName: session.customerName || 'Guest',
      customerPhone: session.customerPhone || '',
      lineItems: consolidatedLineItems,
      subtotalPaisa,
      discountPaisa: 0,
      taxPaisa: cgstPaisa + sgstPaisa,
      cgstPaisa,
      sgstPaisa,
      igstPaisa: 0,
      preRoundingTotalPaisa,
      roundOffPaisa,
      totalPaisa,
      paidAmountPaisa: totalPaisa,
      dueAmountPaisa: 0,
      paymentStatus: 'PAID',
      paymentMethod,
      tenders: resolvedTenders,
      status: 'COMPLETED',
      cashierUserId: authContext.userId || cashierUserId,
    });

    session.status = 'CLOSED';
    session.closedAt = new Date();
    session.closedByUserId = authContext.userId || cashierUserId;
    session.currentBillId = bill.billId;
    await session.save();

    // Release table to AVAILABLE
    await DiningTable.updateOne(
      { tableId: session.tableId, cafeId: normCafeId, organisationId },
      { $set: { status: 'AVAILABLE', activeSessionId: null } }
    );

    await auditService.recordAuditEvent({
      organisationId,
      cafeId: normCafeId,
      actorUserId: authContext.userId || cashierUserId,
      actorRole: authContext.role || 'CAFE_ADMIN',
      module: 'TABLES',
      action: 'TABLE_SESSION_BILLED_AND_CLOSED',
      entityType: 'TABLE_SESSION',
      entityId: session.sessionId,
      reason: `Settled and billed Table ${session.tableNumber} with Bill ${bill.billId}`,
      result: 'SUCCESS',
      metadata: { billId: bill.billId, totalPaisa },
    }).catch(() => {});

    return {
      session,
      bill,
    };
  }

  /**
   * F027: Table Merging
   * Merges one or more source tables into a target table, consolidating
   * active sessions, order rounds, line items, and covers.
   */
  static async mergeTables({
    targetTableId,
    sourceTableIds = [],
    cafeId,
    organisationId = 'ORG-DEFAULT',
    authContext = {},
  }) {
    assertCafeAccess(authContext, cafeId);

    const normCafeId = cafeId.trim().toUpperCase();
    const cleanTargetId = String(targetTableId || '').trim().toUpperCase();
    const cleanSourceIds = (Array.isArray(sourceTableIds) ? sourceTableIds : [sourceTableIds])
      .map((id) => String(id || '').trim().toUpperCase())
      .filter((id) => id && id !== cleanTargetId);

    if (!cleanTargetId || cleanSourceIds.length === 0) {
      throw new ApiError(400, 'INVALID_MERGE_PARAMS', 'Target table and at least one distinct source table are required.');
    }

    const targetTable = await DiningTable.findOne({
      organisationId,
      cafeId: normCafeId,
      tableId: cleanTargetId,
    });
    if (!targetTable) {
      throw new ApiError(404, 'TARGET_TABLE_NOT_FOUND', `Target table ${cleanTargetId} not found.`);
    }

    const sourceTables = await DiningTable.find({
      organisationId,
      cafeId: normCafeId,
      tableId: { $in: cleanSourceIds },
    });
    if (sourceTables.length === 0) {
      throw new ApiError(404, 'SOURCE_TABLES_NOT_FOUND', 'None of the specified source tables were found.');
    }

    // Ensure target table has an active session
    let targetSession = null;
    if (targetTable.activeSessionId) {
      targetSession = await TableSession.findOne({
        sessionId: targetTable.activeSessionId,
        status: 'ACTIVE',
      });
    }

    if (!targetSession) {
      // Create session for target table if none exists
      const sessId = `TSESS-${Date.now()}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
      targetSession = await TableSession.create({
        sessionId: sessId,
        organisationId,
        cafeId: normCafeId,
        tableId: targetTable.tableId,
        tableNumber: targetTable.tableNumber,
        covers: targetTable.seatingCapacity || 2,
        status: 'ACTIVE',
        customerName: 'Consolidated Guests',
        customerPhone: '',
        openedAt: new Date(),
        openedByUserId: authContext.userId || 'STAFF',
        rounds: [],
        cumulativeTotalPaisa: 0,
      });
      targetTable.activeSessionId = targetSession.sessionId;
      targetTable.status = 'OCCUPIED';
    }

    const mergedSourceSessions = [];
    for (const sTable of sourceTables) {
      if (sTable.activeSessionId) {
        const sSession = await TableSession.findOne({
          sessionId: sTable.activeSessionId,
          status: 'ACTIVE',
        });

        if (sSession) {
          // Transfer rounds to target session
          if (Array.isArray(sSession.rounds) && sSession.rounds.length > 0) {
            targetSession.rounds.push(...sSession.rounds);
          }
          targetSession.covers = (targetSession.covers || 0) + (sSession.covers || 0);
          targetSession.cumulativeTotalPaisa = (targetSession.cumulativeTotalPaisa || 0) + (sSession.cumulativeTotalPaisa || 0);

          sSession.status = 'MERGED';
          sSession.metadata = {
            ...(sSession.metadata || {}),
            mergedIntoSessionId: targetSession.sessionId,
            mergedIntoTableId: targetTable.tableId,
            mergedAt: new Date(),
          };
          await sSession.save();
          mergedSourceSessions.push(sSession.sessionId);
        }
      }

      // Mark source table as available / merged
      sTable.status = 'AVAILABLE';
      sTable.activeSessionId = null;
      sTable.metadata = {
        ...(sTable.metadata || {}),
        mergedIntoTableId: targetTable.tableId,
        mergedAt: new Date(),
      };
      await sTable.save();
    }

    await targetSession.save();
    await targetTable.save();

    // A022: Shifted / Merged KOT Notification
    const shiftKot = {
      type: 'KOT_MERGE_NOTIFICATION',
      event: 'TABLE_MERGED',
      targetTableId: targetTable.tableId,
      targetTableNumber: targetTable.tableNumber,
      sourceTables: sourceTables.map((t) => ({ tableId: t.tableId, tableNumber: t.tableNumber })),
      mergedAt: new Date(),
      message: `TABLE MERGE (F027): Tables [${sourceTables.map(t => t.tableNumber).join(', ')}] merged into Table ${targetTable.tableNumber}. Dispatch all items to Table ${targetTable.tableNumber}.`,
    };

    await auditService.recordAuditEvent({
      organisationId,
      cafeId: normCafeId,
      actorUserId: authContext.userId || 'STAFF',
      actorRole: authContext.role || 'CAFE_ADMIN',
      module: 'TABLES',
      action: 'TABLES_MERGED',
      entityType: 'DINING_TABLE',
      entityId: targetTable.tableId,
      reason: `Merged tables [${cleanSourceIds.join(', ')}] into Table ${targetTable.tableNumber}`,
      result: 'SUCCESS',
      metadata: { sourceTableIds: cleanSourceIds, mergedSourceSessions },
    }).catch(() => {});

    return {
      success: true,
      targetTable,
      targetSession,
      sourceTables,
      shiftKot,
    };
  }

  /**
   * A022: Table Shift & Shifted KOT Dispatch
   * Relocates active session from fromTableId to toTableId and emits
   * a table shift notification to kitchen stations.
   */
  static async shiftTable({
    fromTableId,
    toTableId,
    reason = 'Guest requested relocation',
    cafeId,
    organisationId = 'ORG-DEFAULT',
    authContext = {},
  }) {
    assertCafeAccess(authContext, cafeId);

    const normCafeId = cafeId.trim().toUpperCase();
    const cleanFromId = String(fromTableId || '').trim().toUpperCase();
    const cleanToId = String(toTableId || '').trim().toUpperCase();

    if (!cleanFromId || !cleanToId || cleanFromId === cleanToId) {
      throw new ApiError(400, 'INVALID_SHIFT_PARAMS', 'Source table and destination table must be distinct.');
    }

    const fromTable = await DiningTable.findOne({
      organisationId,
      cafeId: normCafeId,
      tableId: cleanFromId,
    });
    if (!fromTable) {
      throw new ApiError(404, 'FROM_TABLE_NOT_FOUND', `Origin table ${cleanFromId} not found.`);
    }

    const toTable = await DiningTable.findOne({
      organisationId,
      cafeId: normCafeId,
      tableId: cleanToId,
    });
    if (!toTable) {
      throw new ApiError(404, 'TO_TABLE_NOT_FOUND', `Destination table ${cleanToId} not found.`);
    }

    if (!fromTable.activeSessionId) {
      throw new ApiError(400, 'ORIGIN_TABLE_NOT_OCCUPIED', `Origin table ${fromTable.tableNumber} does not have an active dining session.`);
    }

    if (toTable.status === 'OCCUPIED' && toTable.activeSessionId) {
      throw new ApiError(400, 'DESTINATION_TABLE_OCCUPIED', `Destination table ${toTable.tableNumber} is already occupied. Merge instead of shift.`);
    }

    const session = await TableSession.findOne({
      sessionId: fromTable.activeSessionId,
      status: 'ACTIVE',
    });
    if (!session) {
      throw new ApiError(404, 'SESSION_NOT_FOUND', `Active session for table ${fromTable.tableNumber} not found.`);
    }

    // Shift session to destination table
    const origTableNumber = session.tableNumber;
    session.tableId = toTable.tableId;
    session.tableNumber = toTable.tableNumber;
    session.metadata = {
      ...(session.metadata || {}),
      previousTableNumber: origTableNumber,
      shiftedAt: new Date(),
      shiftReason: reason,
    };
    await session.save();

    toTable.status = 'OCCUPIED';
    toTable.activeSessionId = session.sessionId;
    await toTable.save();

    fromTable.status = 'AVAILABLE';
    fromTable.activeSessionId = null;
    fromTable.metadata = {
      ...(fromTable.metadata || {}),
      shiftedToTableId: toTable.tableId,
      shiftedAt: new Date(),
    };
    await fromTable.save();

    // A022: Shifted KOT Notification
    const shiftKot = {
      type: 'KOT_SHIFT_NOTIFICATION',
      event: 'TABLE_SHIFTED',
      fromTableId: fromTable.tableId,
      fromTableNumber: origTableNumber,
      toTableId: toTable.tableId,
      toTableNumber: toTable.tableNumber,
      reason,
      sessionId: session.sessionId,
      shiftedAt: new Date(),
      message: `TABLE SHIFT (A022): Relocated from Table ${origTableNumber} to Table ${toTable.tableNumber}. Deliver pending and future orders to Table ${toTable.tableNumber}.`,
    };

    await auditService.recordAuditEvent({
      organisationId,
      cafeId: normCafeId,
      actorUserId: authContext.userId || 'STAFF',
      actorRole: authContext.role || 'CAFE_ADMIN',
      module: 'TABLES',
      action: 'TABLE_SHIFTED',
      entityType: 'DINING_TABLE',
      entityId: toTable.tableId,
      reason: `Shifted Table ${origTableNumber} -> Table ${toTable.tableNumber}: ${reason}`,
      result: 'SUCCESS',
      metadata: { fromTableId: cleanFromId, toTableId: cleanToId, sessionId: session.sessionId },
    }).catch(() => {});

    return {
      success: true,
      fromTable,
      toTable,
      session,
      shiftKot,
    };
  }
}

module.exports = {
  TableService,
};
