'use strict';

const express = require('express');
const { authenticate } = require('../middleware/authenticate');
const { authorize } = require('../middleware/authorize');
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

module.exports = router;

