'use strict';

/**
 * CHANNELS, QR ORDERING & FRONT SERVICE ROUTES (P15)
 * Mounted at: /api/v1/channels (registered in routes/index.js)
 */

const express = require('express');
const { authenticate } = require('../middleware/authenticate');
const { authorize } = require('../middleware/authorize');
const { attachDeviceContext } = require('../middleware/deviceContext');
const {
  // Tables & Sessions
  listTablesHandler,
  createTableHandler,
  updateTableStatusHandler,
  openTableSessionHandler,
  closeTableSessionHandler,
  mergeTablesHandler,
  shiftTableHandler,
  // QR Codes
  generateTableQrHandler,
  revokeTableQrHandler,
  rotateTableQrHandler,
  // Reservations & Waitlist
  listReservationsHandler,
  createReservationHandler,
  updateReservationStatusHandler,
  recordAdvanceDepositHandler,
  addToWaitlistHandler,
  seatWaitlistHandler,
  updateWaitlistStatusHandler,
  notifyWaitlistGuestHandler,
  attachWaitlistPreOrderHandler,
  // Channel Orders & Config
  listChannelOrdersHandler,
  updateOrderStatusHandler,
  acceptChannelOrderFallbackHandler,
  rejectChannelOrderFallbackHandler,
  getChannelConfigHandler,
  updateChannelConfigHandler,
  // Pickup Tokens
  listPickupTokensHandler,
  createPickupTokenHandler,
  updatePickupTokenStatusHandler,
  // Aggregator Payouts & Store Pause Controls
  reconcileAggregatorPayoutsHandler,
  pauseAggregatorStoreHandler,
  resumeAggregatorStoreHandler,
  getAggregatorStoreStatusHandler,
  auditAggregatorStatementHandler,
  // Public Guest
  publicGetGuestMenuHandler,
  publicSubmitOrderRoundHandler,
  publicCreateChallengeHandler,
  publicVerifyChallengeHandler,
  publicGetWebMenuHandler,
  publicSubmitDirectOrderHandler,
  publicGetOrderStatusHandler,
  publicGetPickupDisplayHandler,
  publicAggregatorWebhookHandler,
  // Category 2 & 3
  publicPartnerDiningWebhookHandler,
  validatePartnerDiningDiscountHandler,
  publicWhatsAppWebhookGetHandler,
  publicWhatsAppWebhookPostHandler,
  estimate3plFareHandler,
  dispatch3plRiderHandler,
  track3plRiderHandler,
  public3plWebhookHandler,
  previewCrossBorderTaxHandler,
  signZatcaInvoiceHandler,
  // Benchmark Handlers
  calculateDeliveryFeeHandler,
  getBrandRankingHandler,
  updateBrandRankingHandler,
  whatsAppDispatchHandler,
  decideCookingInstructionsHandler,
  wirelessTableChimeHandler,
  getMenuBoardSlidesHandler,
  publicGrubtechWebhookHandler,
  verifyRiderHandoverHandler,
  // WhatsApp Receipt PDF Dispatch
  dispatchReceiptWhatsAppHandler,
  // Emergency Online Order Acceptance
  getEmergencyOnlineOrdersHandler,
  decideEmergencyOnlineOrderHandler,
} = require('../controllers/channelOperationsController');

const router = express.Router();

// ── Public Guest Endpoints (Unauthenticated) ──
router.post('/public/grubtech/webhook', publicGrubtechWebhookHandler);
router.get('/public/qr-menu/:token', publicGetGuestMenuHandler);
router.post('/public/qr-order/:token/round', publicSubmitOrderRoundHandler);
router.post('/public/verify/challenge', publicCreateChallengeHandler);
router.post('/public/verify/confirm', publicVerifyChallengeHandler);
router.get('/public/web-menu/:cafeId', publicGetWebMenuHandler);
router.post('/public/direct-order', publicSubmitDirectOrderHandler);
router.get('/public/order-status/:orderReference', publicGetOrderStatusHandler);
router.get('/public/pickup-display/:cafeId', publicGetPickupDisplayHandler);
router.post('/public/aggregators/:provider/webhook', publicAggregatorWebhookHandler);

// Dining Partners Webhooks (EazyDiner, Dineout, Dotpe) (A058, A059, F034)
router.post('/public/dining-partners/:portal/webhook', publicPartnerDiningWebhookHandler);
router.post('/public/dining-partners/webhook', publicPartnerDiningWebhookHandler);

// WhatsApp Cloud API Webhooks (F096, A077)
router.get('/public/whatsapp/webhook', publicWhatsAppWebhookGetHandler);
router.post('/public/whatsapp/webhook', publicWhatsAppWebhookPostHandler);

// 3PL Logistics Webhooks (Dunzo, Shadowfax, Porter) (F098, F099)
router.post('/public/3pl/:provider/webhook', public3plWebhookHandler);

// ── Authenticated Routes Below ──
router.use(authenticate);
router.use(attachDeviceContext);

// Tables
router.get('/tables', authorize('TABLES_READ', { allowedRoles: ['MASTER', 'OWNER', 'CAFE_ADMIN'] }), listTablesHandler);
router.post('/tables', authorize('TABLES_WRITE', { allowedRoles: ['MASTER', 'CAFE_ADMIN'] }), createTableHandler);
router.patch('/tables/:tableId/status', authorize('TABLES_WRITE', { allowedRoles: ['MASTER', 'CAFE_ADMIN'] }), updateTableStatusHandler);
router.post('/tables/session/open', authorize('TABLES_WRITE', { allowedRoles: ['MASTER', 'CAFE_ADMIN'] }), openTableSessionHandler);
router.post('/tables/session/close', authorize('TABLES_WRITE', { allowedRoles: ['MASTER', 'CAFE_ADMIN'] }), closeTableSessionHandler);
router.post('/tables/merge', authorize('TABLES_WRITE', { allowedRoles: ['MASTER', 'CAFE_ADMIN'] }), mergeTablesHandler);
router.post('/tables/shift', authorize('TABLES_WRITE', { allowedRoles: ['MASTER', 'CAFE_ADMIN'] }), shiftTableHandler);

// QR Management
router.post('/qr/generate-table', authorize('QR_GENERATE', { allowedRoles: ['MASTER', 'CAFE_ADMIN'] }), generateTableQrHandler);
router.post('/qr/:qrId/revoke', authorize('QR_GENERATE', { allowedRoles: ['MASTER', 'CAFE_ADMIN'] }), revokeTableQrHandler);
router.post('/qr/:qrId/rotate', authorize('QR_GENERATE', { allowedRoles: ['MASTER', 'CAFE_ADMIN'] }), rotateTableQrHandler);

// Reservations & Host Desk
router.get('/reservations', authorize('RESERVATIONS_READ', { allowedRoles: ['MASTER', 'OWNER', 'CAFE_ADMIN'] }), listReservationsHandler);
router.post('/reservations', authorize('RESERVATIONS_WRITE', { allowedRoles: ['MASTER', 'CAFE_ADMIN'] }), createReservationHandler);
router.patch('/reservations/:reservationId/status', authorize('RESERVATIONS_WRITE', { allowedRoles: ['MASTER', 'CAFE_ADMIN'] }), updateReservationStatusHandler);
router.post('/reservations/deposit', authorize('RESERVATIONS_WRITE', { allowedRoles: ['MASTER', 'CAFE_ADMIN'] }), recordAdvanceDepositHandler);
router.post('/waitlist', authorize('RESERVATIONS_WRITE', { allowedRoles: ['MASTER', 'CAFE_ADMIN'] }), addToWaitlistHandler);
router.post('/waitlist/seat', authorize('RESERVATIONS_WRITE', { allowedRoles: ['MASTER', 'CAFE_ADMIN'] }), seatWaitlistHandler);
router.patch('/waitlist/:waitlistId/status', authorize('RESERVATIONS_WRITE', { allowedRoles: ['MASTER', 'CAFE_ADMIN'] }), updateWaitlistStatusHandler);
router.post('/waitlist/:waitlistId/notify', authorize('RESERVATIONS_WRITE', { allowedRoles: ['MASTER', 'CAFE_ADMIN'] }), notifyWaitlistGuestHandler);
router.post('/waitlist/:waitlistId/pre-order', authorize('RESERVATIONS_WRITE', { allowedRoles: ['MASTER', 'CAFE_ADMIN'] }), attachWaitlistPreOrderHandler);

// Live Channel Orders
router.get('/orders', authorize('ORDERS_READ', { allowedRoles: ['MASTER', 'OWNER', 'CAFE_ADMIN'] }), listChannelOrdersHandler);
router.patch('/orders/:orderId/status', authorize('ORDERS_WRITE', { allowedRoles: ['MASTER', 'CAFE_ADMIN'] }), updateOrderStatusHandler);
router.post('/orders/:orderId/verify-rider-handover', authorize('ORDERS_WRITE', { allowedRoles: ['MASTER', 'CAFE_ADMIN', 'STAFF'] }), verifyRiderHandoverHandler);
// Emergency Terminal fallbacks: it lists live orders from /live-orders and posts
// /orders/:orderId/accept|reject when the primary emergency-decision route is unavailable.
router.get('/live-orders', authorize('ORDERS_READ', { allowedRoles: ['MASTER', 'OWNER', 'CAFE_ADMIN', 'STAFF'] }), listChannelOrdersHandler);
router.post('/orders/:orderId/accept', authorize('ORDERS_WRITE', { allowedRoles: ['MASTER', 'OWNER', 'CAFE_ADMIN', 'STAFF'] }), acceptChannelOrderFallbackHandler);
router.post('/orders/:orderId/reject', authorize('ORDERS_WRITE', { allowedRoles: ['MASTER', 'OWNER', 'CAFE_ADMIN', 'STAFF'] }), rejectChannelOrderFallbackHandler);

// Channel Config
router.get('/config', authorize('CONFIG_READ', { allowedRoles: ['MASTER', 'OWNER', 'CAFE_ADMIN'] }), getChannelConfigHandler);
router.patch('/config', authorize('CONFIG_WRITE', { allowedRoles: ['MASTER', 'CAFE_ADMIN'] }), updateChannelConfigHandler);

// Pickup Tokens
router.get('/pickup-tokens', authorize('TOKENS_READ', { allowedRoles: ['MASTER', 'OWNER', 'CAFE_ADMIN'] }), listPickupTokensHandler);
router.post('/pickup-tokens', authorize('TOKENS_WRITE', { allowedRoles: ['MASTER', 'CAFE_ADMIN'] }), createPickupTokenHandler);
router.patch('/pickup-tokens/:tokenId/status', authorize('TOKENS_WRITE', { allowedRoles: ['MASTER', 'CAFE_ADMIN'] }), updatePickupTokenStatusHandler);

// Aggregator Reconciliation & Store Pause Controls (F088 / A081 / F100-F106)
router.post('/aggregators/reconcile', authorize('FINANCE_RECONCILE', { allowedRoles: ['MASTER', 'OWNER', 'CAFE_ADMIN'] }), reconcileAggregatorPayoutsHandler);
router.post('/aggregators/pause', authorize('AGGREGATOR_WRITE', { allowedRoles: ['MASTER', 'OWNER', 'CAFE_ADMIN'] }), pauseAggregatorStoreHandler);
// POS A081 "kitchen snooze" + emergency terminal snooze post to /pause (all providers).
router.post('/pause', authorize('AGGREGATOR_WRITE', { allowedRoles: ['MASTER', 'OWNER', 'CAFE_ADMIN'] }), pauseAggregatorStoreHandler);
router.post('/aggregators/resume', authorize('AGGREGATOR_WRITE', { allowedRoles: ['MASTER', 'OWNER', 'CAFE_ADMIN'] }), resumeAggregatorStoreHandler);
router.get('/aggregators/status', authorize('AGGREGATOR_READ', { allowedRoles: ['MASTER', 'OWNER', 'CAFE_ADMIN', 'STAFF'] }), getAggregatorStoreStatusHandler);
router.post('/aggregators/statement-audit', authorize('FINANCE_RECONCILE', { allowedRoles: ['MASTER', 'OWNER', 'CAFE_ADMIN'] }), auditAggregatorStatementHandler);

// Category 2 & 3 Operations: Dining Partners, 3PL Dispatch, Cross-Border Statutory
router.post('/dining-partners/validate-discount', authorize('ORDERS_WRITE', { allowedRoles: ['MASTER', 'OWNER', 'CAFE_ADMIN', 'STAFF'] }), validatePartnerDiningDiscountHandler);
router.post('/3pl/estimate-fare', authorize('ORDERS_READ', { allowedRoles: ['MASTER', 'OWNER', 'CAFE_ADMIN', 'STAFF'] }), estimate3plFareHandler);
router.post('/3pl/dispatch', authorize('ORDERS_WRITE', { allowedRoles: ['MASTER', 'CAFE_ADMIN', 'STAFF'] }), dispatch3plRiderHandler);
router.get('/3pl/track/:trackingId', authorize('ORDERS_READ', { allowedRoles: ['MASTER', 'OWNER', 'CAFE_ADMIN', 'STAFF'] }), track3plRiderHandler);
router.post('/cross-border/tax-preview', authorize('ORDERS_READ', { allowedRoles: ['MASTER', 'OWNER', 'CAFE_ADMIN', 'STAFF'] }), previewCrossBorderTaxHandler);
router.post('/cross-border/zatca-sign', authorize('ORDERS_WRITE', { allowedRoles: ['MASTER', 'CAFE_ADMIN', 'STAFF'] }), signZatcaInvoiceHandler);

// Benchmark A037: Locality Distance Delivery Fee
router.post('/delivery-fee/calculate', authorize('ORDERS_READ', { allowedRoles: ['MASTER', 'OWNER', 'CAFE_ADMIN', 'STAFF'] }), calculateDeliveryFeeHandler);

// Benchmark A051: Multi-Brand Virtual Storefront Display Ranking
router.get('/brand-ranking', authorize('CONFIG_READ', { allowedRoles: ['MASTER', 'OWNER', 'CAFE_ADMIN', 'STAFF'] }), getBrandRankingHandler);
router.put('/brand-ranking', authorize('CONFIG_WRITE', { allowedRoles: ['MASTER', 'CAFE_ADMIN'] }), updateBrandRankingHandler);

// Benchmark A077: Self-Delivery Driver WhatsApp Dispatch
router.post('/orders/:orderId/whatsapp-dispatch', authorize('ORDERS_WRITE', { allowedRoles: ['MASTER', 'CAFE_ADMIN', 'STAFF'] }), whatsAppDispatchHandler);

// Benchmark A086: Zomato Cooking Instruction Acceptance Decider
router.post('/orders/:orderId/cooking-instructions-decide', authorize('ORDERS_WRITE', { allowedRoles: ['MASTER', 'CAFE_ADMIN', 'STAFF'] }), decideCookingInstructionsHandler);

// Benchmark F281–F286: Wireless Table Calling Device Receiver
router.post('/tables/wireless-chime', authorize('ORDERS_WRITE', { allowedRoles: ['MASTER', 'CAFE_ADMIN', 'STAFF'] }), wirelessTableChimeHandler);

// Benchmark F287–F291: Digital Menu Board Signage TV Studio
router.get('/menu-board/slides', getMenuBoardSlidesHandler);

// WhatsApp e-Receipt PDF Dispatch (Meta Graph API v20.0)
// POST /api/v1/channels/receipts/whatsapp-dispatch
router.post(
  '/receipts/whatsapp-dispatch',
  authorize('POS:OPERATE', { allowedRoles: ['MASTER', 'OWNER', 'CAFE_ADMIN', 'STAFF'] }),
  dispatchReceiptWhatsAppHandler
);

// A007 / F086 / F089: Emergency Online Order Acceptance App
router.get(
  '/emergency-orders',
  authorize('ORDERS_READ', { allowedRoles: ['MASTER', 'OWNER', 'CAFE_ADMIN', 'STAFF'] }),
  getEmergencyOnlineOrdersHandler
);
router.post(
  '/emergency-orders/:orderId/decision',
  authorize('ORDERS_WRITE', { allowedRoles: ['MASTER', 'OWNER', 'CAFE_ADMIN', 'STAFF'] }),
  decideEmergencyOnlineOrderHandler
);

module.exports = router;

