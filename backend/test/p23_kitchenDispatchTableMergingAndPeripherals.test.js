'use strict';

/**
 * PHASE P23 SUITE: Kitchen Dispatch, Table Merging & Peripheral Styling
 * Validates Petpooja Parity items:
 *   - F027: Table Merging
 *   - A022: Shifted KOT Notifications
 *   - A023: Unmapped Printer Alerts
 *   - A034: Barcode Bill Lookup
 *   - A031: Thermal Typography & ESC/POS Formatting
 */

const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const { TableService } = require('../src/services/tableService');
const PosOrderService = require('../src/services/posOrderService');
const hardwareBridgeService = require('../src/services/hardwareBridgeService');
const { DiningTable } = require('../src/models/DiningTable');
const { TableSession } = require('../src/models/TableSession');
const { Bill } = require('../src/models/Bill');
const { ApiError } = require('../src/utils/ApiError');

describe('Phase P23: Kitchen Dispatch, Table Merging & Peripheral Styling Suite', () => {
  const orgId = 'ORG-TEST';
  const cafeId = 'CAFE-ZC-01';
  const authContext = {
    userId: 'USR-OPERATOR',
    role: 'CAFE_ADMIN',
    organisationId: orgId,
    assignedCafeIds: [cafeId],
    primaryCafeId: cafeId,
  };

  test('1. F027: Table Merging consolidates sessions, covers, and order rounds', async () => {
    // Mock target table T01 and source table T02
    const targetTableId = 'TBL-01';
    const sourceTableId = 'TBL-02';

    const mockTargetTable = {
      tableId: targetTableId,
      tableNumber: 'Table 01',
      seatingCapacity: 4,
      status: 'OCCUPIED',
      activeSessionId: 'TSESS-01',
      save: async function () { return this; },
    };

    const mockSourceTable = {
      tableId: sourceTableId,
      tableNumber: 'Table 02',
      seatingCapacity: 2,
      status: 'OCCUPIED',
      activeSessionId: 'TSESS-02',
      save: async function () { return this; },
    };

    const mockTargetSession = {
      sessionId: 'TSESS-01',
      tableId: targetTableId,
      tableNumber: 'Table 01',
      covers: 3,
      cumulativeTotalPaisa: 50000,
      rounds: [
        { roundNumber: 1, lineItems: [{ menuItemId: 'MNU-01', quantity: 2, lineSubtotalPaisa: 50000 }] },
      ],
      save: async function () { return this; },
    };

    const mockSourceSession = {
      sessionId: 'TSESS-02',
      tableId: sourceTableId,
      tableNumber: 'Table 02',
      covers: 2,
      cumulativeTotalPaisa: 30000,
      rounds: [
        { roundNumber: 1, lineItems: [{ menuItemId: 'MNU-02', quantity: 1, lineSubtotalPaisa: 30000 }] },
      ],
      status: 'ACTIVE',
      save: async function () { return this; },
    };

    const origFindOne = DiningTable.findOne;
    const origFind = DiningTable.find;
    const origSessionFindOne = TableSession.findOne;

    DiningTable.findOne = async () => mockTargetTable;
    DiningTable.find = async () => [mockSourceTable];
    TableSession.findOne = async (q) => {
      if (q.sessionId === 'TSESS-01') return mockTargetSession;
      if (q.sessionId === 'TSESS-02') return mockSourceSession;
      return null;
    };

    try {
      const result = await TableService.mergeTables({
        targetTableId,
        sourceTableIds: [sourceTableId],
        cafeId,
        organisationId: orgId,
        authContext,
      });

      assert.equal(result.success, true);
      assert.equal(mockTargetSession.covers, 5, 'Covers must be summed (3 + 2 = 5)');
      assert.equal(mockTargetSession.cumulativeTotalPaisa, 80000, 'Total paisa must be consolidated (50000 + 30000 = 80000)');
      assert.equal(mockTargetSession.rounds.length, 2, 'Rounds must be concatenated');
      assert.equal(mockSourceSession.status, 'MERGED', 'Source session must be marked as MERGED');
      assert.equal(mockSourceTable.status, 'AVAILABLE', 'Source table must be marked as AVAILABLE');
      assert.equal(mockSourceTable.activeSessionId, null, 'Source table activeSessionId must be cleared');
      assert.ok(result.shiftKot, 'Must produce a merge/shift KOT notification');
      assert.equal(result.shiftKot.type, 'KOT_MERGE_NOTIFICATION');
    } finally {
      DiningTable.findOne = origFindOne;
      DiningTable.find = origFind;
      TableSession.findOne = origSessionFindOne;
    }
  });

  test('2. A022: Table Shift moves active session and emits Shifted KOT notification', async () => {
    const fromTableId = 'TBL-01';
    const toTableId = 'TBL-05';

    const mockFromTable = {
      tableId: fromTableId,
      tableNumber: 'Table 01',
      status: 'OCCUPIED',
      activeSessionId: 'TSESS-10',
      save: async function () { return this; },
    };

    const mockToTable = {
      tableId: toTableId,
      tableNumber: 'Table 05',
      status: 'AVAILABLE',
      activeSessionId: null,
      save: async function () { return this; },
    };

    const mockSession = {
      sessionId: 'TSESS-10',
      tableId: fromTableId,
      tableNumber: 'Table 01',
      status: 'ACTIVE',
      save: async function () { return this; },
    };

    const origFindOne = DiningTable.findOne;
    const origSessionFindOne = TableSession.findOne;

    DiningTable.findOne = async (q) => {
      if (q.tableId === fromTableId) return mockFromTable;
      if (q.tableId === toTableId) return mockToTable;
      return null;
    };
    TableSession.findOne = async () => mockSession;

    try {
      const result = await TableService.shiftTable({
        fromTableId,
        toTableId,
        reason: 'Guest shifted to outdoor patio',
        cafeId,
        organisationId: orgId,
        authContext,
      });

      assert.equal(result.success, true);
      assert.equal(mockSession.tableId, toTableId);
      assert.equal(mockSession.tableNumber, 'Table 05');
      assert.equal(mockToTable.status, 'OCCUPIED');
      assert.equal(mockToTable.activeSessionId, 'TSESS-10');
      assert.equal(mockFromTable.status, 'AVAILABLE');
      assert.equal(mockFromTable.activeSessionId, null);
      assert.equal(result.shiftKot.type, 'KOT_SHIFT_NOTIFICATION');
      assert.equal(result.shiftKot.fromTableNumber, 'Table 01');
      assert.equal(result.shiftKot.toTableNumber, 'Table 05');
    } finally {
      DiningTable.findOne = origFindOne;
      TableSession.findOne = origSessionFindOne;
    }
  });

  test('3. A022: Table Shift to occupied destination table is rejected', async () => {
    const fromTableId = 'TBL-01';
    const toTableId = 'TBL-05';

    const mockFromTable = {
      tableId: fromTableId,
      tableNumber: 'Table 01',
      status: 'OCCUPIED',
      activeSessionId: 'TSESS-10',
    };

    const mockToTable = {
      tableId: toTableId,
      tableNumber: 'Table 05',
      status: 'OCCUPIED',
      activeSessionId: 'TSESS-99',
    };

    const origFindOne = DiningTable.findOne;
    DiningTable.findOne = async (q) => {
      if (q.tableId === fromTableId) return mockFromTable;
      if (q.tableId === toTableId) return mockToTable;
      return null;
    };

    try {
      await assert.rejects(
        async () => {
          await TableService.shiftTable({
            fromTableId,
            toTableId,
            cafeId,
            organisationId: orgId,
            authContext,
          });
        },
        (err) => err instanceof ApiError && err.code === 'DESTINATION_TABLE_OCCUPIED'
      );
    } finally {
      DiningTable.findOne = origFindOne;
    }
  });

  test('4. A023: Unmapped Printer Alerts proactively route items to Expediter and log warning', () => {
    const items = [
      { name: 'Special Artisanal Mocktail', category: 'COFFEE', kitchenStation: 'BAR' },
      { name: 'Chef Custom Platter', category: 'EXOTIC_FOOD', kitchenStation: 'TANDOOR' }, // No Tandoor printer
    ];

    const terminals = [
      {
        terminalId: 'PRN-BAR-01',
        terminalName: 'Coffee Bar Thermal Printer',
        stationRouting: { stationType: 'BARISTA', itemCategories: ['COFFEE', 'TEA'] },
      },
      {
        terminalId: 'PRN-EXP-01',
        terminalName: 'Master Expediter Printer',
        isExpediter: true,
        stationRouting: { stationType: 'EXPEDITER', itemCategories: [] },
      },
    ];

    const routed = hardwareBridgeService.routeKotItems(items, terminals);

    // Mocktail should be on Bar printer
    assert.ok(routed['PRN-BAR-01']);
    assert.equal(routed['PRN-BAR-01'].items.length, 1);
    assert.equal(routed['PRN-BAR-01'].items[0].name, 'Special Artisanal Mocktail');

    // Exotic Food has no TANDOOR printer, so it must fall back to Expediter printer
    assert.ok(routed['PRN-EXP-01'], 'Unmapped item must be rerouted to Expediter terminal');
    assert.equal(routed['PRN-EXP-01'].items.some((i) => i.name === 'Chef Custom Platter'), true);

    // Must generate proactive unmapped printer warning
    assert.ok(Array.isArray(routed.unmappedPrinterWarnings));
    assert.equal(routed.unmappedPrinterWarnings.length, 1);
    assert.ok(routed.unmappedPrinterWarnings[0].message.includes('A023'));
    assert.equal(routed.unmappedPrinterWarnings[0].reroutedTerminalId, 'PRN-EXP-01');
  });

  test('5. A034: Barcode Bill Lookup retrieves bill and computes refundability', async () => {
    const mockBill = {
      billId: 'BILL-20261012-9876',
      invoiceNumber: 'INV-ZC-20261012-0042',
      cafeId: 'CAFE-ZC-01',
      totalPaisa: 42000,
      paidAmountPaisa: 42000,
      status: 'COMPLETED',
      reprints: [],
      metadata: { barcode: 'INV-ZC-20261012-0042' },
    };

    const origFindOne = Bill.findOne;
    Bill.findOne = () => ({
      lean: async () => mockBill,
    });

    try {
      // Direct invoice number lookup
      const res1 = await PosOrderService.lookupOrderByBarcode('INV-ZC-20261012-0042', cafeId);
      assert.equal(res1.bill.billId, 'BILL-20261012-9876');
      assert.equal(res1.isRefundable, true);
      assert.equal(res1.reprintCount, 0);

      // QR URL-encoded scan lookup
      const res2 = await PosOrderService.lookupOrderByBarcode('https://zamorin.cafe/qr/bills/BILL-20261012-9876?src=receipt', cafeId);
      assert.equal(res2.bill.billId, 'BILL-20261012-9876');
    } finally {
      Bill.findOne = origFindOne;
    }
  });

  test('6. A031: Thermal Typography engine builds valid ESC/POS Code128 barcodes and Shift banners', () => {
    // 1. Code128 barcode sequence
    const barcodeBuffer = hardwareBridgeService.buildEscPosBarcodeBuffer('INV-ZC-1001');
    assert.ok(Buffer.isBuffer(barcodeBuffer));
    // GS k 73 length data LF
    assert.equal(barcodeBuffer[0], 0x1d, 'Must start with GS (0x1D)');
    assert.equal(barcodeBuffer[1], 0x68, 'Must set barcode height');

    // 2. Table Shift KOT notification
    const shiftData = {
      fromTableNumber: 'Table 02',
      toTableNumber: 'Table 08',
      reason: 'AC too cold, guest moved indoors',
    };
    const shiftBuffer = hardwareBridgeService.compileKotShiftNotification(shiftData, { printerConfig: { paperWidth: 80 } });
    assert.ok(Buffer.isBuffer(shiftBuffer));
    const textContent = shiftBuffer.toString('utf8');
    assert.ok(textContent.includes('TABLE SHIFT (A022)'));
    assert.ok(textContent.includes('Table 02'));
    assert.ok(textContent.includes('Table 08'));
    assert.ok(textContent.includes('AC too cold'));
  });
});
