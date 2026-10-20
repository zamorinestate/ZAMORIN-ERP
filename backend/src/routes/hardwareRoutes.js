'use strict';

const express = require('express');
const { authenticate } = require('../middleware/authenticate');
const { authorize } = require('../middleware/authorize');
const { requireHardwareBridgeDevice } = require('../middleware/deviceAuthorization');
const {
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
} = require('../controllers/hardwareController');

const router = express.Router();

router.use(authenticate);

// 1. Terminals listing per café
router.get(
  '/terminals/:cafeId',
  authorize('CAFE:READ', { allowedRoles: ['MASTER', 'OWNER', 'CAFE_ADMIN', 'STAFF'] }),
  getCafeTerminals
);

// 2. Terminal registration & configuration
router.post(
  '/terminals',
  authorize('CAFE:WRITE', { allowedRoles: ['MASTER', 'CAFE_ADMIN'] }),
  saveTerminalConfig
);

// 3. Diagnostic test print ticket
router.post(
  '/test-print',
  authorize('CAFE:WRITE', { allowedRoles: ['MASTER', 'CAFE_ADMIN'] }),
  issueDiagnosticTestPrint
);

// 4. Cash drawer kick pulse (Authorized sale or test)
router.post(
  '/drawer/kick',
  authorize('POS:OPERATE', { allowedRoles: ['MASTER', 'CAFE_ADMIN', 'STAFF'] }),
  triggerDrawerKick
);

// 5. KOT multi-station routing
router.post(
  '/kot/route',
  authorize('POS:OPERATE', { allowedRoles: ['MASTER', 'CAFE_ADMIN', 'STAFF'] }),
  routeKotTickets
);

// 6. Terminal status and health check
router.get(
  '/terminals/:terminalId/health',
  authorize('CAFE:READ', { allowedRoles: ['MASTER', 'OWNER', 'CAFE_ADMIN', 'STAFF'] }),
  getTerminalHealth
);

// 7. Browser fallback HTML receipt preview
router.post(
  '/receipt/preview-html',
  authorize('POS:OPERATE', { allowedRoles: ['MASTER', 'OWNER', 'CAFE_ADMIN', 'STAFF'] }),
  renderHtmlReceiptFallback
);

// ── Unified P20 Peripheral Devices Endpoints ─────────────────────────────────

// 8. Peripheral devices listing per café
router.get(
  '/devices/:cafeId',
  authorize('CAFE:READ', { allowedRoles: ['MASTER', 'OWNER', 'CAFE_ADMIN', 'STAFF'] }),
  listCafeDevices
);

// 9. Peripheral device registration & configuration
router.post(
  '/devices',
  authorize('CAFE:WRITE', { allowedRoles: ['MASTER', 'CAFE_ADMIN'] }),
  registerOrUpdateDevice
);

// 10. Run diagnostic on hardware device
router.post(
  '/devices/:deviceId/diagnostic',
  authorize('CAFE:WRITE', { allowedRoles: ['MASTER', 'CAFE_ADMIN', 'STAFF'] }),
  runDeviceDiagnostic
);

// 11. Check unassigned printers alert (Benchmark A023)
router.get(
  '/unassigned-printers/:cafeId',
  authorize('CAFE:READ', { allowedRoles: ['MASTER', 'OWNER', 'CAFE_ADMIN', 'STAFF'] }),
  checkUnassignedPrinters
);

// 12. Moved-item reprint KOT (Benchmark A022)
router.post(
  '/shifted-item',
  authorize('POS:OPERATE', { allowedRoles: ['MASTER', 'CAFE_ADMIN', 'STAFF'] }),
  generateShiftedItemKot
);

// 13. Separate token slip (Benchmark A027)
router.post(
  '/token-slip',
  authorize('POS:OPERATE', { allowedRoles: ['MASTER', 'CAFE_ADMIN', 'STAFF'] }),
  generateTokenSlip
);

// 14. Readiness slip routing (Benchmark A025)
router.post(
  '/readiness-slip',
  authorize('POS:OPERATE', { allowedRoles: ['MASTER', 'CAFE_ADMIN', 'STAFF'] }),
  generateReadinessSlip
);

// 15. Weighing scale stream parse
router.post(
  '/scale/parse',
  authorize('POS:OPERATE', { allowedRoles: ['MASTER', 'CAFE_ADMIN', 'STAFF'] }),
  parseScaleReading
);

// 16. Barcode & QR scan validation
router.post(
  '/scan/validate',
  authorize('POS:OPERATE', { allowedRoles: ['MASTER', 'CAFE_ADMIN', 'STAFF'] }),
  validateBarcodeScan
);

// 17. Thermal Prep Sticky Label Generator (F178-F184)
router.post(
  '/prep-label',
  authorize('POS:OPERATE', { allowedRoles: ['MASTER', 'OWNER', 'CAFE_ADMIN', 'STAFF'] }),
  generatePrepStickyLabel
);

// 18. Shift Opening & Closing SOP Checklist (F326-F333)
router.post(
  '/shift-checklist',
  authorize('POS:OPERATE', { allowedRoles: ['MASTER', 'OWNER', 'CAFE_ADMIN', 'STAFF'] }),
  submitShiftChecklist
);

// 19. Biometric Fingerprint (F015, A010)
router.post(
  '/biometric/enroll',
  authorize('USER:ADMIN', { allowedRoles: ['MASTER', 'OWNER', 'CAFE_ADMIN'] }),
  enrollBiometricFingerprint
);
router.post(
  '/biometric/verify',
  authorize('POS:OPERATE', { allowedRoles: ['MASTER', 'OWNER', 'CAFE_ADMIN', 'STAFF'] }),
  verifyBiometricFingerprint
);
// Device diagnostics screen: scanner connection test (same persona as caller-id test).
router.post(
  '/biometric/device-test',
  authorize('POS:OPERATE', { allowedRoles: ['MASTER', 'CAFE_ADMIN', 'STAFF'] }),
  testBiometricDevice
);

// 20. EDC Card Terminal Push-to-Pay (F070, A054-A056)
router.post(
  '/edc/push-sale',
  authorize('POS:OPERATE', { allowedRoles: ['MASTER', 'CAFE_ADMIN', 'STAFF'] }),
  pushEdcSale
);
router.get(
  '/edc/status/:transactionRef',
  authorize('POS:OPERATE', { allowedRoles: ['MASTER', 'CAFE_ADMIN', 'STAFF'] }),
  getEdcStatus
);
router.post(
  '/edc/cancel/:transactionRef',
  authorize('POS:OPERATE', { allowedRoles: ['MASTER', 'CAFE_ADMIN', 'STAFF'] }),
  cancelEdcSale
);

// 21. Spoken UPI Soundbox Broadcast (A057)
router.post(
  '/soundbox/broadcast',
  authorize('POS:OPERATE', { allowedRoles: ['MASTER', 'CAFE_ADMIN', 'STAFF'] }),
  broadcastSoundboxPayment
);

// 22. Caller ID USB Modem Delivery Pop-Up (F097)
router.post(
  '/caller-id/simulate-call',
  authorize('POS:OPERATE', { allowedRoles: ['MASTER', 'CAFE_ADMIN', 'STAFF'] }),
  handleCallerIdEvent
);
// Frontend device diagnostics posts the same payload to /caller-id/incoming.
router.post(
  '/caller-id/incoming',
  authorize('POS:OPERATE', { allowedRoles: ['MASTER', 'CAFE_ADMIN', 'STAFF'] }),
  handleCallerIdEvent
);

// 23. Virtual KDS & Kitchen Pass (Category 3)
router.get(
  '/kds/tickets/:cafeId',
  authorize('POS:OPERATE', { allowedRoles: ['MASTER', 'OWNER', 'CAFE_ADMIN', 'STAFF'] }),
  getVirtualKdsTickets
);
router.post(
  '/kds/bump/:chitId',
  authorize('POS:OPERATE', { allowedRoles: ['MASTER', 'CAFE_ADMIN', 'STAFF'] }),
  bumpVirtualKdsTicket
);
router.post(
  '/kds/recall',
  authorize('POS:OPERATE', { allowedRoles: ['MASTER', 'CAFE_ADMIN', 'STAFF'] }),
  recallVirtualKdsTicket
);

// 24. Raw ESC/POS Network Socket Print (TCP 9100)
router.post(
  '/bridge/network-print',
  authorize('POS:OPERATE', { allowedRoles: ['MASTER', 'CAFE_ADMIN', 'STAFF'] }),
  requireHardwareBridgeDevice,
  dispatchNetworkPrint
);

// 25. RF 433 MHz Wireless Table Calling Chime Decoder (USB Dongle)
router.post(
  '/bridge/rf-chime/decode',
  authorize('POS:OPERATE', { allowedRoles: ['MASTER', 'CAFE_ADMIN', 'STAFF'] }),
  requireHardwareBridgeDevice,
  decodeRfChime
);

// 26. ZKTeco / eSSL Biometric Time Clock Punch Sync (TCP 4370)
router.post(
  '/bridge/biometric-clock/sync',
  authorize('ATTENDANCE:WRITE', { allowedRoles: ['MASTER', 'CAFE_ADMIN'] }),
  requireHardwareBridgeDevice,
  syncBiometricClock
);

// 27. RS-232 Serial Weighing Scale Stream Reader (COM ports)
router.post(
  '/bridge/scale/serial-stream',
  authorize('POS:OPERATE', { allowedRoles: ['MASTER', 'CAFE_ADMIN', 'STAFF'] }),
  requireHardwareBridgeDevice,
  streamSerialScale
);

// 28. A019: KOT-Number Lookup
router.get(
  '/kot/by-number/:kotNumber',
  authorize('POS:OPERATE', { allowedRoles: ['MASTER', 'OWNER', 'CAFE_ADMIN', 'STAFF'] }),
  lookupKotByNumber
);

module.exports = router;

