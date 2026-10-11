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
  // QR Codes
  generateTableQrHandler,
  revokeTableQrHandler,
  rotateTableQrHandler,
  // Reservations & Waitlist
  listReservationsHandler,
  createReservationHandler,
  updateReservationStatusHandler,
  addToWaitlistHandler,
  seatWaitlistHandler,
  updateWaitlistStatusHandler,
  // Channel Orders & Config
  listChannelOrdersHandler,
  updateOrderStatusHandler,
  getChannelConfigHandler,
  updateChannelConfigHandler,
  // Pickup Tokens
  listPickupTokensHandler,
  createPickupTokenHandler,
  updatePickupTokenStatusHandler,
  // Aggregator Payouts
  reconcileAggregatorPayoutsHandler,
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
} = require('../controllers/channelOperationsController');

const router = express.Router();

// ── Public Guest Endpoints (Unauthenticated) ──
router.get('/public/qr-menu/:token', publicGetGuestMenuHandler);
router.post('/public/qr-order/:token/round', publicSubmitOrderRoundHandler);
router.post('/public/verify/challenge', publicCreateChallengeHandler);
router.post('/public/verify/confirm', publicVerifyChallengeHandler);
router.get('/public/web-menu/:cafeId', publicGetWebMenuHandler);
router.post('/public/direct-order', publicSubmitDirectOrderHandler);
router.get('/public/order-status/:orderReference', publicGetOrderStatusHandler);
router.get('/public/pickup-display/:cafeId', publicGetPickupDisplayHandler);
router.post('/public/aggregators/:provider/webhook', publicAggregatorWebhookHandler);

// ── Authenticated Routes Below ──
router.use(authenticate);
router.use(attachDeviceContext);

// Tables
router.get('/tables', authorize('TABLES_READ', { allowedRoles: ['MASTER', 'OWNER', 'CAFE_ADMIN'] }), listTablesHandler);
router.post('/tables', authorize('TABLES_WRITE', { allowedRoles: ['MASTER', 'CAFE_ADMIN'] }), createTableHandler);
router.patch('/tables/:tableId/status', authorize('TABLES_WRITE', { allowedRoles: ['MASTER', 'CAFE_ADMIN'] }), updateTableStatusHandler);
router.post('/tables/session/open', authorize('TABLES_WRITE', { allowedRoles: ['MASTER', 'CAFE_ADMIN'] }), openTableSessionHandler);
router.post('/tables/session/close', authorize('TABLES_WRITE', { allowedRoles: ['MASTER', 'CAFE_ADMIN'] }), closeTableSessionHandler);

// QR Management
router.post('/qr/generate-table', authorize('QR_GENERATE', { allowedRoles: ['MASTER', 'CAFE_ADMIN'] }), generateTableQrHandler);
router.post('/qr/:qrId/revoke', authorize('QR_GENERATE', { allowedRoles: ['MASTER', 'CAFE_ADMIN'] }), revokeTableQrHandler);
router.post('/qr/:qrId/rotate', authorize('QR_GENERATE', { allowedRoles: ['MASTER', 'CAFE_ADMIN'] }), rotateTableQrHandler);

// Reservations & Host Desk
router.get('/reservations', authorize('RESERVATIONS_READ', { allowedRoles: ['MASTER', 'OWNER', 'CAFE_ADMIN'] }), listReservationsHandler);
router.post('/reservations', authorize('RESERVATIONS_WRITE', { allowedRoles: ['MASTER', 'CAFE_ADMIN'] }), createReservationHandler);
router.patch('/reservations/:reservationId/status', authorize('RESERVATIONS_WRITE', { allowedRoles: ['MASTER', 'CAFE_ADMIN'] }), updateReservationStatusHandler);
router.post('/waitlist', authorize('RESERVATIONS_WRITE', { allowedRoles: ['MASTER', 'CAFE_ADMIN'] }), addToWaitlistHandler);
router.post('/waitlist/seat', authorize('RESERVATIONS_WRITE', { allowedRoles: ['MASTER', 'CAFE_ADMIN'] }), seatWaitlistHandler);
router.patch('/waitlist/:waitlistId/status', authorize('RESERVATIONS_WRITE', { allowedRoles: ['MASTER', 'CAFE_ADMIN'] }), updateWaitlistStatusHandler);

// Live Channel Orders
router.get('/orders', authorize('ORDERS_READ', { allowedRoles: ['MASTER', 'OWNER', 'CAFE_ADMIN'] }), listChannelOrdersHandler);
router.patch('/orders/:orderId/status', authorize('ORDERS_WRITE', { allowedRoles: ['MASTER', 'CAFE_ADMIN'] }), updateOrderStatusHandler);

// Channel Config
router.get('/config', authorize('CONFIG_READ', { allowedRoles: ['MASTER', 'OWNER', 'CAFE_ADMIN'] }), getChannelConfigHandler);
router.patch('/config', authorize('CONFIG_WRITE', { allowedRoles: ['MASTER', 'CAFE_ADMIN'] }), updateChannelConfigHandler);

// Pickup Tokens
router.get('/pickup-tokens', authorize('TOKENS_READ', { allowedRoles: ['MASTER', 'OWNER', 'CAFE_ADMIN'] }), listPickupTokensHandler);
router.post('/pickup-tokens', authorize('TOKENS_WRITE', { allowedRoles: ['MASTER', 'CAFE_ADMIN'] }), createPickupTokenHandler);
router.patch('/pickup-tokens/:tokenId/status', authorize('TOKENS_WRITE', { allowedRoles: ['MASTER', 'CAFE_ADMIN'] }), updatePickupTokenStatusHandler);

// Aggregator Reconciliation
router.post('/aggregators/reconcile', authorize('FINANCE_RECONCILE', { allowedRoles: ['MASTER', 'CAFE_ADMIN'] }), reconcileAggregatorPayoutsHandler);

module.exports = router;
