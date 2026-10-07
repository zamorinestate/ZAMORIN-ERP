'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const { HardwareTerminal } = require('../src/models/HardwareTerminal');
const { AuditEvent } = require('../src/models/AuditEvent');
const { User } = require('../src/models/User');
const hardwareBridgeService = require('../src/services/hardwareBridgeService');

test('STAGE 05 — Hardware Bridge + Device Integration Complete Suite', async (t) => {
  let mongoServer;
  const passwordHash = '$2b$10$abcdefghijklmnopqrstuu';

  const authMaster = {
    userId: 'MU-0001',
    role: 'MASTER',
    organisationId: 'ORG-ZAMORIN',
  };

  const authAdmin = {
    userId: 'AD-0001',
    role: 'CAFE_ADMIN',
    organisationId: 'ORG-ZAMORIN',
    primaryCafeId: 'ZC-0001',
  };

  const authStaff = {
    userId: 'ST-0001',
    role: 'STAFF',
    organisationId: 'ORG-ZAMORIN',
    primaryCafeId: 'ZC-0001',
  };

  t.before(async () => {
    mongoServer = await MongoMemoryServer.create();
    await mongoose.connect(mongoServer.getUri());

    await User.create({
      userId: authMaster.userId,
      organisationId: authMaster.organisationId,
      name: 'Primary Master Admin',
      email: 'master@zamorin.test',
      role: 'MASTER',
      isPrimaryMaster: true,
      primaryMasterDesignatedAt: new Date(),
      primaryMasterDesignatedBy: 'SYSTEM_BOOTSTRAP',
      primaryMasterDesignationReason: 'Initial setup of Primary Master administrator account',
      createdBy: 'SYSTEM',
      accountStatus: 'ACTIVE',
      passwordHash,
    });

    await User.create({
      userId: authAdmin.userId,
      organisationId: authAdmin.organisationId,
      name: 'Cafe Operations Admin',
      email: 'admin.zc0001@zamorin.test',
      role: 'CAFE_ADMIN',
      primaryCafeId: 'ZC-0001',
      createdBy: 'SYSTEM',
      accountStatus: 'ACTIVE',
      passwordHash,
    });

    await User.create({
      userId: authStaff.userId,
      organisationId: authStaff.organisationId,
      name: 'Counter Cashier Staff',
      email: 'cashier.zc0001@zamorin.test',
      role: 'STAFF',
      primaryCafeId: 'ZC-0001',
      createdBy: 'SYSTEM',
      accountStatus: 'ACTIVE',
      passwordHash,
    });
  });

  t.after(async () => {
    await mongoose.disconnect();
    if (mongoServer) {
      await mongoServer.stop();
    }
  });

  await t.test('05.1 & 05.5: ESC/POS Binary Byte-Buffer Compilation Primitives & Command Injection Protection', async () => {
    const { ESC_POS_COMMANDS, sanitizeEscPosText, buildDrawerKickBuffer, formatTwoColumn } = hardwareBridgeService;

    // Verify ESC/POS command markers
    assert.equal(ESC_POS_COMMANDS.INIT[0], 0x1B);
    assert.equal(ESC_POS_COMMANDS.INIT[1], 0x40);
    assert.equal(ESC_POS_COMMANDS.CUT_PARTIAL[0], 0x1D);
    assert.equal(ESC_POS_COMMANDS.CUT_PARTIAL[1], 0x56);
    assert.equal(ESC_POS_COMMANDS.CUT_PARTIAL[2], 0x01);

    // Verify Cash Drawer Kick pulse command
    const kickPin2 = buildDrawerKickBuffer(2);
    assert.deepEqual([...kickPin2], [0x1B, 0x70, 0x00, 0x19, 0xFA]);
    const kickPin5 = buildDrawerKickBuffer(5);
    assert.deepEqual([...kickPin5], [0x1B, 0x70, 0x01, 0x19, 0xFA]);

    // Command injection sanitization: strip rogue ASCII control characters
    const dirtyText = 'Malabar Spice Coffee\x1B\x70\x00\x19\xFA\x00\x07Hacked';
    const cleanText = sanitizeEscPosText(dirtyText);
    assert.equal(cleanText.includes('\x1B'), false, 'ESC character must be stripped');
    assert.equal(cleanText.includes('\x00'), false, 'NULL byte must be stripped');
    assert.equal(cleanText.includes('\x07'), false, 'BELL byte must be stripped');
    assert.ok(cleanText.includes('Malabar Spice Coffee'));

    // Two-column alignment formatting for 80mm (48 chars) and 58mm (32 chars)
    const line80 = formatTwoColumn('Item Name', '₹150.00', 48);
    assert.equal(line80.length, 48, 'Line must be exactly 48 chars wide on 80mm');
    assert.ok(line80.startsWith('Item Name'));
    assert.ok(line80.endsWith('₹150.00'));

    const line58 = formatTwoColumn('Cappuccino', '₹180.00', 32);
    assert.equal(line58.length, 32, 'Line must be exactly 32 chars wide on 58mm');
    assert.ok(line58.startsWith('Cappuccino'));
    assert.ok(line58.endsWith('₹180.00'));
  });

  await t.test('05.5: Diagnostic Test Receipt Compilation with Typography and QR Test', async () => {
    const terminal = {
      terminalId: 'TERM-ZC0001-POS1',
      terminalName: 'Front Counter Station 1',
      deviceType: 'POS_COUNTER',
      printerConfig: {
        paperWidth: 80,
        connectionType: 'NETWORK',
        cutType: 'PARTIAL',
      },
      drawerConfig: {
        enabled: true,
        pin: 2,
      },
    };

    const cafeInfo = {
      brandName: 'ZAMORIN CAFE',
      legalName: 'Zamorin Hospitality Private Limited',
      gstin: '32ABCDE1234F1Z5',
    };

    const buffer = hardwareBridgeService.compileDiagnosticTestReceipt(terminal, cafeInfo);
    assert.ok(Buffer.isBuffer(buffer), 'Must produce a Node.js Buffer');
    assert.ok(buffer.length > 200, 'Diagnostic receipt buffer must contain meaningful ESC/POS bytecode');

    // Verify initial reset command ESC @
    assert.equal(buffer[0], 0x1B);
    assert.equal(buffer[1], 0x40);

    // Verify string contains text in buffer
    const bufferString = buffer.toString('utf8');
    assert.ok(bufferString.includes('ZAMORIN CAFE'));
    assert.ok(bufferString.includes('DIAGNOSTIC TEST RECEIPT'));
    assert.ok(bufferString.includes('TERM-ZC0001-POS1'));
    assert.ok(bufferString.includes('HARDWARE READINESS VERIFIED'));
  });

  await t.test('05.5: Thermal Sales Receipt Compilation with Stage 02 QR and Tax Breakdown', async () => {
    const terminal = {
      terminalId: 'TERM-ZC0001-POS1',
      printerConfig: {
        paperWidth: 80,
        cutType: 'PARTIAL',
      },
      drawerConfig: {
        enabled: true,
        pin: 2,
      },
    };

    const cafeInfo = {
      brandName: 'ZAMORIN CAFE',
      legalName: 'Zamorin Hospitality Private Limited',
      address: '12 Beach Road, Calicut, Kerala 673001',
      phone: '+91 495 2765432',
      gstin: '32ABCDE1234F1Z5',
      fssai: '11322001000123',
    };

    const orderData = {
      billNumber: 'ZC-2026-0042',
      orderId: 'ORD-98765',
      date: '2026-09-13',
      time: '14:30:00',
      orderType: 'DINE_IN',
      tableNumber: 'Table 4',
      cashierName: 'Anjali',
      paymentMethod: 'CASH',
      items: [
        { name: 'Malabar Filter Coffee', quantity: 2, price: 120, total: 240 },
        { name: 'Ghee Podi Idli (4 pcs)', quantity: 1, price: 160, total: 160, notes: 'Extra podi' },
      ],
      subtotal: 400,
      discount: 20,
      cgst: 9.50,
      sgst: 9.50,
      grandTotal: 399,
      upiQrString: 'upi://pay?pa=ops@zamorin&pn=ZamorinCafe&am=399.00&cu=INR&tn=ZC-2026-0042',
    };

    const receiptBuffer = hardwareBridgeService.compileThermalReceipt(orderData, terminal, cafeInfo);
    assert.ok(Buffer.isBuffer(receiptBuffer));
    assert.ok(receiptBuffer.length > 300);

    const receiptString = receiptBuffer.toString('utf8');
    assert.ok(receiptString.includes('ZC-2026-0042'));
    assert.ok(receiptString.includes('Malabar Filter Coffee'));
    assert.ok(receiptString.includes('Ghee Podi Idli'));
    assert.ok(receiptString.includes('399.00'));
    assert.ok(receiptString.includes('Table 4'));

    // Test Reprint Stamp
    const reprintOrder = { ...orderData, isReprint: true, reprintCount: 2 };
    const reprintBuffer = hardwareBridgeService.compileThermalReceipt(reprintOrder, terminal, cafeInfo);
    assert.ok(reprintBuffer.toString('utf8').includes('*** REPRINT #2 ***'));

    // Test Void Cancelled Stamp
    const voidOrder = { ...orderData, isVoid: true };
    const voidBuffer = hardwareBridgeService.compileThermalReceipt(voidOrder, terminal, cafeInfo);
    assert.ok(voidBuffer.toString('utf8').includes('*** VOID - CANCELLED BILL ***'));
  });

  await t.test('05.5: Kitchen Order Ticket (KOT) Multi-Station Routing Engine', async () => {
    const baristaTerminal = {
      terminalId: 'TERM-KITCHEN-BARISTA',
      terminalName: 'Beverage Bar Barista Station',
      deviceType: 'KITCHEN_STATION',
      stationRouting: {
        stationType: 'BARISTA',
        itemCategories: ['COFFEE', 'BEVERAGE', 'TEA'],
      },
      printerConfig: { paperWidth: 80 },
    };

    const hotKitchenTerminal = {
      terminalId: 'TERM-KITCHEN-HOT',
      terminalName: 'Main Hot Kitchen Station',
      deviceType: 'KITCHEN_STATION',
      stationRouting: {
        stationType: 'HOT_KITCHEN',
        itemCategories: ['FOOD', 'HOT', 'SNACK'],
      },
      printerConfig: { paperWidth: 80 },
    };

    const orderItems = [
      { name: 'Monsoon Malabar Cold Brew', category: 'COFFEE', quantity: 2, notes: 'Less ice' },
      { name: 'Cardamom Chai', category: 'TEA', quantity: 1 },
      { name: 'Erachi Fry Croissant', category: 'FOOD', quantity: 1, notes: 'Extra crispy' },
      { name: 'Kozhikode Biryani Bowl', category: 'HOT', quantity: 1 },
    ];

    const routed = hardwareBridgeService.routeKotItems(orderItems, [baristaTerminal, hotKitchenTerminal]);

    // Verify Barista terminal received exactly the 2 beverage items
    assert.ok(routed['TERM-KITCHEN-BARISTA']);
    assert.equal(routed['TERM-KITCHEN-BARISTA'].items.length, 2);
    assert.equal(routed['TERM-KITCHEN-BARISTA'].items[0].name, 'Monsoon Malabar Cold Brew');
    assert.equal(routed['TERM-KITCHEN-BARISTA'].items[1].name, 'Cardamom Chai');

    // Verify Hot Kitchen terminal received exactly the 2 food items
    assert.ok(routed['TERM-KITCHEN-HOT']);
    assert.equal(routed['TERM-KITCHEN-HOT'].items.length, 2);
    assert.equal(routed['TERM-KITCHEN-HOT'].items[0].name, 'Erachi Fry Croissant');
    assert.equal(routed['TERM-KITCHEN-HOT'].items[1].name, 'Kozhikode Biryani Bowl');

    // Verify KOT ticket byte compilation
    const kotData = {
      kotNumber: 'KOT-1042',
      tableNumber: 'Table 7',
      orderType: 'DINE_IN',
      serverName: 'Rahul',
      stationName: 'BEVERAGE BAR',
      items: routed['TERM-KITCHEN-BARISTA'].items,
      isAddition: true,
    };

    const kotBuffer = hardwareBridgeService.compileKotTicket(kotData, baristaTerminal);
    assert.ok(Buffer.isBuffer(kotBuffer));
    const kotText = kotBuffer.toString('utf8');
    assert.ok(kotText.includes('KITCHEN ORDER TICKET'));
    assert.ok(kotText.includes('STATION: BEVERAGE BAR'));
    assert.ok(kotText.includes('Table 7'));
    assert.ok(kotText.includes('Monsoon Malabar Cold Brew'));
    assert.ok(kotText.includes('RUNNING ORDER ADDITION'));
  });

  await t.test('05.6: Cash Drawer Kick Pulse Trigger and Security Audit Logging', async () => {
    // Register terminal with cash drawer enabled
    const terminal = await hardwareBridgeService.registerOrUpdateTerminal(
      {
        terminalId: 'TERM-ZC0001-CASHIER',
        cafeId: 'ZC-0001',
        terminalName: 'Cashier Terminal 1',
        drawerConfig: {
          enabled: true,
          pin: 2,
        },
      },
      authAdmin
    );

    // Issue drawer kick
    const kickResult = await hardwareBridgeService.issueDrawerKick(
      terminal.terminalId,
      authStaff,
      {
        reason: 'Customer cash sale change tender',
        transactionId: 'TXN-2026-999',
      }
    );

    assert.equal(kickResult.success, true);
    assert.equal(kickResult.terminalId, terminal.terminalId);
    assert.equal(kickResult.pin, 2);
    assert.ok(Buffer.isBuffer(kickResult.kickBuffer));

    // Verify immutable audit log recorded in terminal
    const refreshedTerminal = await HardwareTerminal.findOne({ terminalId: terminal.terminalId });
    assert.ok(refreshedTerminal.auditEvents.length >= 1);
    const audit = refreshedTerminal.auditEvents[refreshedTerminal.auditEvents.length - 1];
    assert.equal(audit.event, 'DRAWER_KICK_TRIGGERED');
    assert.equal(audit.actorUserId, authStaff.userId);
    assert.equal(audit.transactionId, 'TXN-2026-999');
    assert.equal(audit.reason, 'Customer cash sale change tender');

    // Test rejection when drawer is disabled
    const disabledTerminal = await hardwareBridgeService.registerOrUpdateTerminal(
      {
        terminalId: 'TERM-ZC0001-KIOSK',
        cafeId: 'ZC-0001',
        terminalName: 'Customer Self-Ordering Kiosk',
        drawerConfig: { enabled: false },
      },
      authAdmin
    );

    await assert.rejects(
      async () => {
        await hardwareBridgeService.issueDrawerKick(disabledTerminal.terminalId, authStaff, {
          reason: 'Unauthorized test kick',
        });
      },
      (err) => {
        assert.equal(err.statusCode, 400);
        assert.equal(err.code, 'DRAWER_DISABLED');
        return true;
      }
    );
  });

  await t.test('05.5 & 05.9: Browser Fallback HTML Receipt Preview Generation', async () => {
    const orderData = {
      billNumber: 'ZC-FB-001',
      date: '2026-09-13',
      time: '14:45:00',
      tableNumber: 'Table 2',
      items: [
        { name: 'Cold Pressed Cane Juice', quantity: 1, price: 90, total: 90 },
      ],
      subtotal: 90,
      grandTotal: 90,
    };

    const cafeInfo = {
      brandName: 'ZAMORIN CAFE',
      legalName: 'Zamorin Hospitality Private Limited',
      gstin: '32ABCDE1234F1Z5',
    };

    const html = hardwareBridgeService.generateFallbackHtmlReceipt(orderData, cafeInfo);
    assert.ok(typeof html === 'string');
    assert.ok(html.includes('<!DOCTYPE html>'));
    assert.ok(html.includes('ZAMORIN CAFE'));
    assert.ok(html.includes('ZC-FB-001'));
    assert.ok(html.includes('Cold Pressed Cane Juice'));
    assert.ok(html.includes('window.print()'));
  });

  await t.test('05.8: Hardware Terminal Registration and Health Monitoring', async () => {
    const terminalData = {
      terminalId: 'TERM-ZC0001-KDS1',
      cafeId: 'ZC-0001',
      terminalName: 'Kitchen Display Screen 1',
      deviceType: 'KDS',
      printerConfig: {
        enabled: false,
      },
      stationRouting: {
        stationType: 'HOT_KITCHEN',
      },
    };

    const terminal = await hardwareBridgeService.registerOrUpdateTerminal(terminalData, authAdmin);
    assert.equal(terminal.terminalId, 'TERM-ZC0001-KDS1');
    assert.equal(terminal.deviceType, 'KDS');

    // Fetch terminals for cafe
    const terminals = await hardwareBridgeService.getTerminalsForCafe('ZC-0001', authMaster.organisationId);
    assert.ok(terminals.length >= 2);

    // Health check
    const health = await hardwareBridgeService.checkTerminalHealth('TERM-ZC0001-KDS1', authMaster.organisationId);
    assert.equal(health.terminalId, 'TERM-ZC0001-KDS1');
    assert.equal(health.status.online, true);
    assert.ok(health.status.lastHeartbeat);
  });
});
