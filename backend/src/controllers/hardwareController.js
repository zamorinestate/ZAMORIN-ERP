'use strict';

const { asyncHandler } = require('../utils/asyncHandler');
const { ApiError } = require('../utils/ApiError');
const hardwareBridgeService = require('../services/hardwareBridgeService');
const { HardwareTerminal } = require('../models/HardwareTerminal');
const { RetailScaleAndPrepLabelService } = require('../services/retailScaleAndPrepLabelService');
const { BiometricFingerprintAdapter } = require('../services/hardwareAdapters/BiometricFingerprintAdapter');
const { EdcTerminalAdapter } = require('../services/hardwareAdapters/EdcTerminalAdapter');
const { SoundboxAdapter } = require('../services/hardwareAdapters/SoundboxAdapter');
const { CallerIdModemAdapter } = require('../services/hardwareAdapters/CallerIdModemAdapter');
const { KdsStationService } = require('../services/kdsStationService');

/**
 * Retrieve all registered hardware terminals for a café.
 */
const getCafeTerminals = asyncHandler(async (req, res) => {
  const { cafeId } = req.params;
  const { organisationId } = req.auth;

  const terminals = await hardwareBridgeService.getTerminalsForCafe(cafeId, organisationId);
  return res.status(200).json({
    success: true,
    data: { terminals },
  });
});

/**
 * Register or update hardware terminal configuration.
 */
const saveTerminalConfig = asyncHandler(async (req, res) => {
  const terminal = await hardwareBridgeService.registerOrUpdateTerminal(req.body, req.auth);
  return res.status(200).json({
    success: true,
    message: `Terminal ${terminal.terminalId} configuration saved.`,
    data: { terminal },
  });
});

/**
 * Issue a diagnostic test print ticket for a target terminal.
 */
const issueDiagnosticTestPrint = asyncHandler(async (req, res) => {
  const { terminalId, format = 'binary' } = req.body;
  const { organisationId } = req.auth;

  if (!terminalId) {
    throw new ApiError(400, 'TERMINAL_ID_REQUIRED', 'terminalId is required.');
  }

  const terminal = await HardwareTerminal.findOne({
    terminalId: terminalId.trim().toUpperCase(),
    organisationId: organisationId.trim().toUpperCase(),
  });

  if (!terminal) {
    throw new ApiError(404, 'TERMINAL_NOT_FOUND', `Terminal ${terminalId} not found.`);
  }

  const cafe = await Cafe.findOne({ cafeId: terminal.cafeId, organisationId }).lean();
  const cafeInfo = {
    brandName: cafe?.identity?.brandName || 'ZAMORIN CAFE',
    legalName: cafe?.identity?.registeredBusinessName || 'Zamorin Hospitality Private Limited',
    gstin: cafe?.taxAndCommercial?.gstin || null,
  };

  const rawBuffer = hardwareBridgeService.compileDiagnosticTestReceipt(terminal, cafeInfo);

  if (format === 'binary') {
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="diagnostic_test_${terminal.terminalId}.bin"`);
    res.setHeader('X-ESC-POS-Bytes', rawBuffer.length);
    return res.status(200).send(rawBuffer);
  }

  return res.status(200).json({
    success: true,
    terminalId: terminal.terminalId,
    bytesLength: rawBuffer.length,
    base64Payload: rawBuffer.toString('base64'),
  });
});

/**
 * Trigger an authorized cash drawer kick on a terminal.
 */
const triggerDrawerKick = asyncHandler(async (req, res) => {
  const { terminalId, reason = 'Manual Cash Drawer Test / Audit', transactionId = null } = req.body;
  if (!terminalId) {
    throw new ApiError(400, 'TERMINAL_ID_REQUIRED', 'terminalId is required.');
  }

  const result = await hardwareBridgeService.issueDrawerKick(terminalId, req.auth, {
    reason,
    transactionId,
  });

  return res.status(200).json({
    success: true,
    message: 'Cash drawer kick pulse emitted.',
    data: {
      terminalId: result.terminalId,
      pin: result.pin,
      triggeredAt: result.triggeredAt,
      base64Pulse: result.kickBuffer.toString('base64'),
    },
  });
});

/**
 * Route order items to multi-station kitchen terminals and compile KOT binary buffers.
 */
const routeKotTickets = asyncHandler(async (req, res) => {
  const { cafeId, kotData = {} } = req.body;
  const { organisationId } = req.auth;

  if (!cafeId) {
    throw new ApiError(400, 'CAFE_ID_REQUIRED', 'cafeId is required for KOT routing.');
  }

  const terminals = await HardwareTerminal.find({
    organisationId: organisationId.trim().toUpperCase(),
    cafeId: cafeId.trim().toUpperCase(),
    deviceType: { $in: ['KDS', 'KITCHEN_STATION', 'POS_COUNTER'] },
  });

  const routedStations = hardwareBridgeService.routeKotItems(kotData.items || [], terminals);
  const dispatched = {};

  for (const [termId, stationInfo] of Object.entries(routedStations)) {
    const stationKotData = {
      ...kotData,
      stationName: stationInfo.terminal.stationRouting?.stationType || 'KITCHEN',
      items: stationInfo.items,
    };
    const buffer = hardwareBridgeService.compileKotTicket(stationKotData, stationInfo.terminal);
    dispatched[termId] = {
      stationType: stationInfo.terminal.stationRouting?.stationType || 'ALL',
      terminalName: stationInfo.terminal.terminalName,
      itemsCount: stationInfo.items.length,
      bytesLength: buffer.length,
      base64Payload: buffer.toString('base64'),
    };
  }

  return res.status(200).json({
    success: true,
    cafeId,
    totalStations: Object.keys(dispatched).length,
    stations: dispatched,
    unmappedPrinterWarnings: routedStations.unmappedPrinterWarnings || [],
  });
});

/**
 * Get hardware terminal health & status.
 */
const getTerminalHealth = asyncHandler(async (req, res) => {
  const { terminalId } = req.params;
  const health = await hardwareBridgeService.checkTerminalHealth(terminalId, req.auth.organisationId);
  return res.status(200).json({
    success: true,
    data: health,
  });
});

/**
 * Render standard HTML receipt preview for browser window.print() fallback.
 */
const renderHtmlReceiptFallback = asyncHandler(async (req, res) => {
  const { orderData = {}, cafeId, paperWidth } = req.body;
  const { organisationId } = req.auth;

  let cafeInfo = {};
  if (cafeId) {
    const cafe = await Cafe.findOne({ cafeId: cafeId.trim().toUpperCase(), organisationId }).lean();
    if (cafe) {
      cafeInfo = {
        brandName: cafe.identity?.brandName,
        legalName: cafe.identity?.registeredBusinessName,
        address: cafe.identity?.storeAddress?.streetAddress,
        phone: cafe.identity?.primaryPhone,
        gstin: cafe.taxAndCommercial?.gstin,
        fssai: cafe.complianceAndLicences?.fssaiLicenceNumber,
      };
    }
  }

  const width = paperWidth || orderData.paperWidth || 80;
  const html = hardwareBridgeService.generateFallbackHtmlReceipt(orderData, cafeInfo, width);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  return res.status(200).send(html);
});

// ── Unified P20 Peripheral Hardware Management Controllers ──────────────────

const { hardwareManagementService } = require('../services/hardwareManagementService');
const { BarcodeScannerAdapter } = require('../services/hardwareAdapters/BarcodeScannerAdapter');
const { WeighingScaleAdapter } = require('../services/hardwareAdapters/WeighingScaleAdapter');
const { ReceiptPrinterAdapter } = require('../services/hardwareAdapters/ReceiptPrinterAdapter');

/**
 * List all registered hardware devices for a café.
 */
const listCafeDevices = asyncHandler(async (req, res) => {
  const { cafeId } = req.params;
  const devices = await hardwareManagementService.getDevicesForCafe(cafeId, req.auth.organisationId, req.auth);
  return res.status(200).json({
    success: true,
    data: { devices, total: devices.length },
  });
});

/**
 * Register or update a peripheral hardware device.
 */
const registerOrUpdateDevice = asyncHandler(async (req, res) => {
  const device = await hardwareManagementService.registerOrUpdateDevice(req.body, req.auth);
  return res.status(200).json({
    success: true,
    message: `Hardware device ${device.deviceId} saved successfully.`,
    data: { device },
  });
});

/**
 * Run diagnostic self-test on a hardware device.
 */
const runDeviceDiagnostic = asyncHandler(async (req, res) => {
  const { deviceId } = req.params;
  const result = await hardwareManagementService.runDeviceDiagnostic(deviceId, req.auth, req.body);
  return res.status(200).json({
    success: true,
    message: `Diagnostic run completed for ${deviceId}.`,
    data: result,
  });
});

/**
 * Check unassigned station printers alert (Benchmark A023).
 */
const checkUnassignedPrinters = asyncHandler(async (req, res) => {
  const { cafeId } = req.params;
  const alertInfo = await hardwareManagementService.checkUnassignedPrinterAlerts(cafeId, req.auth.organisationId);
  return res.status(200).json({
    success: true,
    data: alertInfo,
  });
});

/**
 * Generate Moved-Item Transfer KOT ticket buffer (Benchmark A022).
 */
const generateShiftedItemKot = asyncHandler(async (req, res) => {
  const { shiftedData = {}, paperWidth = 80 } = req.body;
  const buffer = ReceiptPrinterAdapter.compileShiftedItemTicket(shiftedData, { paperWidth });
  return res.status(200).json({
    success: true,
    bytesLength: buffer.length,
    base64Payload: buffer.toString('base64'),
    financialMutation: false,
  });
});

/**
 * Generate Separate Token Slip ticket buffer (Benchmark A027).
 */
const generateTokenSlip = asyncHandler(async (req, res) => {
  const { tokenData = {}, cafeInfo = {}, paperWidth = 80 } = req.body;
  const buffer = ReceiptPrinterAdapter.compileTokenSlip(tokenData, cafeInfo, { paperWidth });
  return res.status(200).json({
    success: true,
    bytesLength: buffer.length,
    base64Payload: buffer.toString('base64'),
    financialMutation: false,
  });
});

/**
 * Generate Food Readiness Slip ticket buffer (Benchmark A025).
 */
const generateReadinessSlip = asyncHandler(async (req, res) => {
  const { readinessData = {}, paperWidth = 80 } = req.body;
  const buffer = ReceiptPrinterAdapter.compileReadinessSlip(readinessData, { paperWidth });
  return res.status(200).json({
    success: true,
    bytesLength: buffer.length,
    base64Payload: buffer.toString('base64'),
    financialMutation: false,
  });
});

/**
 * Parse weighing scale payload according to configured protocol.
 */
const parseScaleReading = asyncHandler(async (req, res) => {
  const { rawPayload, protocol = 'TOLEDO', unit = 'KG', maxWeight = 30 } = req.body;
  const result = WeighingScaleAdapter.parseScalePayload(rawPayload, { protocol, unit, maxWeight });
  return res.status(result.success ? 200 : 400).json(result);
});

/**
 * Validate barcode or QR scan against menu catalog.
 */
const validateBarcodeScan = asyncHandler(async (req, res) => {
  const { code, menuItems = [] } = req.body;
  const result = BarcodeScannerAdapter.validateItemScan(code, menuItems, req.auth.cafeId);
  return res.status(result.success ? 200 : 400).json(result);
});

/**
 * Generate thermal prep sticky label for packaging / batches (F178-F184)
 */
const generatePrepStickyLabel = asyncHandler(async (req, res) => {
  const result = RetailScaleAndPrepLabelService.generatePrepStickyLabel(req.body);
  return res.status(200).json({ success: true, data: result });
});

/**
 * Validate and record shift opening / closing checklist (F326-F333)
 */
const submitShiftChecklist = asyncHandler(async (req, res) => {
  const { shiftType, checklistItems, supervisorNotes, cafeId } = req.body;
  const targetCafeId = cafeId || req.auth.primaryCafeId || req.auth.cafeId || 'ZC-0001';
  const result = await RetailScaleAndPrepLabelService.submitShiftChecklist({
    organisationId: req.auth.organisationId,
    cafeId: targetCafeId,
    shiftType,
    checklistItems,
    actorUserId: req.auth.userId,
    supervisorNotes,
    auth: req.auth,
  });
  return res.status(200).json({ success: true, data: result });
});

/**
 * Biometric Fingerprint Enrollment (F015, A010)
 */
const enrollBiometricFingerprint = asyncHandler(async (req, res) => {
  const { userId, sampleBase64, deviceModel } = req.body;
  const result = await BiometricFingerprintAdapter.enrollFingerprint({
    userId,
    organisationId: req.auth.organisationId,
    cafeId: req.auth.cafeId || 'ZC-0001',
    sampleBase64,
    deviceModel,
    enrolledByUserId: req.auth.userId,
  });
  return res.status(200).json({ success: true, data: result });
});

/**
 * Biometric Fingerprint Verification (F015, A010)
 */
const verifyBiometricFingerprint = asyncHandler(async (req, res) => {
  const { enrolledTemplateHash, probeSampleBase64, userId, qualityScore } = req.body;
  const result = BiometricFingerprintAdapter.verifyFingerprint({
    enrolledTemplateHash,
    probeSampleBase64,
    userId: userId || req.auth.userId,
    organisationId: req.auth.organisationId,
    qualityScore,
  });
  return res.status(200).json({ success: true, data: result });
});

/**
 * Biometric scanner connection test — device diagnostics screen.
 * Frontend posts /hardware/biometric/device-test { model } and reads
 * data.status ('ONLINE'/'OFFLINE') and data.driverStatus ('ACTIVE').
 */
const testBiometricDevice = asyncHandler(async (req, res) => {
  const { model, deviceModel } = req.body || {};
  const result = await BiometricFingerprintAdapter.testDeviceConnection(
    model || deviceModel || 'SIMULATED_SCANNER'
  );
  return res.status(200).json({ success: true, data: result });
});

/**
 * Push Sale to EDC Card Terminal (F070, A054-A056)
 */
const pushEdcSale = asyncHandler(async (req, res) => {
  const { terminalId, amountPaisa, invoiceNumber, provider, merchantId } = req.body;
  const result = await EdcTerminalAdapter.pushSaleToEdc({
    terminalId,
    amountPaisa,
    invoiceNumber,
    provider,
    merchantId,
  });
  return res.status(200).json({ success: true, data: result });
});

/**
 * Poll Status of EDC Card Terminal (F070, A054-A056)
 */
const getEdcStatus = asyncHandler(async (req, res) => {
  const { transactionRef } = req.params;
  const result = EdcTerminalAdapter.getEdcStatus(transactionRef);
  return res.status(200).json({ success: true, data: result });
});

/**
 * Cancel Sale on EDC Card Terminal (F070, A054-A056)
 */
const cancelEdcSale = asyncHandler(async (req, res) => {
  const { transactionRef } = req.params;
  const result = EdcTerminalAdapter.cancelEdcSale(transactionRef);
  return res.status(200).json({ success: true, data: result });
});

/**
 * Broadcast Spoken UPI Soundbox Payment (A057)
 */
const broadcastSoundboxPayment = asyncHandler(async (req, res) => {
  const { amountPaisa, paymentProvider, reference, language, terminalId } = req.body;
  const result = SoundboxAdapter.broadcastPaymentAnnouncement({
    amountPaisa,
    paymentProvider,
    reference,
    language: language || 'en',
    terminalId: terminalId || 'SOUNDBOX-MAIN',
  });
  return res.status(200).json({ success: true, data: result });
});

/**
 * Handle Caller ID Modem Incoming Call (F097)
 */
const handleCallerIdEvent = asyncHandler(async (req, res) => {
  const { phoneNumber, rawCallerName } = req.body;
  const result = await CallerIdModemAdapter.handleIncomingCall({
    phoneNumber,
    rawCallerName,
    organisationId: req.auth.organisationId,
    cafeId: req.auth.cafeId,
  });
  return res.status(200).json({ success: true, data: result });
});

/**
 * Retrieve Virtual KDS Tickets (Category 3)
 */
const getVirtualKdsTickets = asyncHandler(async (req, res) => {
  const cafeId = req.params.cafeId || req.auth.cafeId || req.auth.primaryCafeId;
  const station = req.query.station || 'ALL';
  const result = KdsStationService.getActiveTickets(cafeId, station);
  return res.status(200).json({ success: true, data: result });
});

/**
 * Bump / Complete Virtual KDS Ticket (Category 3)
 */
const bumpVirtualKdsTicket = asyncHandler(async (req, res) => {
  const { chitId } = req.params;
  const result = KdsStationService.bumpTicket(chitId, req.auth.userId);
  return res.status(200).json({ success: true, data: result });
});

/**
 * Recall Bumped Virtual KDS Ticket (Category 3)
 */
const recallVirtualKdsTicket = asyncHandler(async (req, res) => {
  const chitId = req.query.chitId || null;
  const result = KdsStationService.recallTicket(chitId);
  return res.status(200).json({ success: true, data: result });
});

// ── Hardware Bridge Extension Controllers ─────────────────────────────────────

/**
 * Dispatch raw ESC/POS byte stream to a network (TCP 9100) thermal printer.
 * Body: { printerIp, printerPort?, base64Payload }
 */
const dispatchNetworkPrint = asyncHandler(async (req, res) => {
  const { printerIp, printerPort = 9100, base64Payload } = req.body;
  if (!printerIp || !base64Payload) {
    throw new ApiError(400, 'MISSING_PARAMS', 'printerIp and base64Payload are required.');
  }
  const buffer = Buffer.from(base64Payload, 'base64');
  const result = await hardwareBridgeService.dispatchRawEscPosToNetworkPrinter({
    printerIp,
    printerPort: Number(printerPort),
    rawBuffer: buffer,
  });
  return res.status(200).json({ success: true, data: result });
});

/**
 * Decode incoming RF 433 MHz wireless table-calling chime hex frame.
 * Body: { rawFrameHex }
 */
const decodeRfChime = asyncHandler(async (req, res) => {
  const { rawFrameHex } = req.body;
  if (!rawFrameHex) {
    throw new ApiError(400, 'MISSING_PARAMS', 'rawFrameHex is required.');
  }
  const result = hardwareBridgeService.decodeRfTableChimeFrame(rawFrameHex);
  return res.status(200).json({ success: true, data: result });
});

/**
 * Sync attendance punches from ZKTeco / eSSL biometric time clock via TCP 4370.
 * Body: { host?, port?, timeoutMs?, cafeId?, organisationId? }
 */
const syncBiometricClock = asyncHandler(async (req, res) => {
  const {
    host = '192.168.1.201',
    port = 4370,
    timeoutMs = 3000,
    cafeId,
    organisationId,
  } = req.body;
  const result = await hardwareBridgeService.syncZkTecoBiometricPunches({
    host,
    port: Number(port),
    timeoutMs: Number(timeoutMs),
    cafeId: cafeId || req.auth.cafeId || 'ZC-0001',
    organisationId: organisationId || req.auth.organisationId,
  });
  return res.status(200).json({ success: true, data: result });
});

/**
 * Read / stream from RS-232 serial weighing scale (e.g. COM1, /dev/ttyUSB0).
 * Body: { port?, baudRate?, protocol?, simulatedPayload? }
 */
const streamSerialScale = asyncHandler(async (req, res) => {
  const { port = 'COM1', baudRate = 9600, protocol = 'TOLEDO', simulatedPayload } = req.body;
  const result = await WeighingScaleAdapter.readSerialScaleStream({
    port,
    baudRate: Number(baudRate),
    protocol,
    simulatedPayload: simulatedPayload || null,
  });
  return res.status(result.success ? 200 : 400).json(result);
});

/**
 * A019: KOT-Number Lookup
 * Search by KOT ticket number or ticketId to retrieve kitchen ticket details.
 */
const lookupKotByNumber = asyncHandler(async (req, res) => {
  const { kotNumber } = req.params;
  const orgId = req.auth?.organisationId || 'ORG-ZAMORIN';
  const cafeId = req.query.cafeId || req.auth?.cafeId;
  const { KdsTicket } = require('../models/KdsTicket');

  const query = {
    organisationId: orgId,
    $or: [
      { kotNumber: String(kotNumber).trim() },
      { ticketId: String(kotNumber).trim().toUpperCase() },
      { orderNumber: String(kotNumber).trim() },
    ],
  };
  if (cafeId && cafeId !== '*') {
    query.cafeId = cafeId.toUpperCase();
  }

  const ticket = await KdsTicket.findOne(query).lean();
  if (!ticket) {
    return res.status(404).json({ success: false, message: `KOT #${kotNumber} not found.` });
  }

  return res.status(200).json({ success: true, data: ticket });
});

module.exports = {
  getCafeTerminals,
  saveTerminalConfig,
  issueDiagnosticTestPrint,
  triggerDrawerKick,
  routeKotTickets,
  getTerminalHealth,
  renderHtmlReceiptFallback,
  listCafeDevices,
  registerOrUpdateDevice,
  runDeviceDiagnostic,
  checkUnassignedPrinters,
  generateShiftedItemKot,
  generateTokenSlip,
  generateReadinessSlip,
  parseScaleReading,
  validateBarcodeScan,
  generatePrepStickyLabel,
  submitShiftChecklist,
  enrollBiometricFingerprint,
  verifyBiometricFingerprint,
  testBiometricDevice,
  pushEdcSale,
  getEdcStatus,
  cancelEdcSale,
  broadcastSoundboxPayment,
  handleCallerIdEvent,
  getVirtualKdsTickets,
  bumpVirtualKdsTicket,
  recallVirtualKdsTicket,
  // Hardware Bridge Extensions
  dispatchNetworkPrint,
  decodeRfChime,
  syncBiometricClock,
  streamSerialScale,
  lookupKotByNumber,
};

