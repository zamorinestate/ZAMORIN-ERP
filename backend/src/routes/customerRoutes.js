'use strict';

/**
 * CUSTOMER & LOYALTY ROUTES (P14 CUSTOMERS, LOYALTY, FEEDBACK & CAMPAIGNS)
 * Mounted at: /api/v1/customers (registered in routes/index.js)
 */

const express = require('express');
const { authenticate } = require('../middleware/authenticate');
const { authorize } = require('../middleware/authorize');
const { attachDeviceContext } = require('../middleware/deviceContext');
const {
  getCustomersOverview,
  listCustomers,
  getCustomer,
  createCustomer,
  adjustCustomerPoints,
  mergeCustomers,
  getRewardCatalogue,
  createReward,
  listCustomerFeedback,
  createFeedback,
  getProgrammeStatus,
  publishProgrammeVersion,
  getIntegrityStatus,
  updateCustomerConsentHandler,
  redeemPointsHandler,
  topUpCustomerWalletHandler,
  redeemCustomerWalletHandler,
  getCustomerWalletHandler,
  issueGiftCardHandler,
  redeemGiftCardHandler,
  getGiftCardHandler,
  listCampaigns,
  createCampaign,
  previewCampaignHandler,
  dispatchCampaignHandler,
  cancelCampaignHandler,
  getDuplicateCandidates,
  deleteCustomer,
  requestCustomerOtpHandler,
  verifyCustomerOtpHandler,
  expirePromotionalBalancesHandler,
  expirePointsHandler,
} = require('../controllers/customerController');

const router = express.Router();

router.use(authenticate);
router.use(attachDeviceContext);

// Overview & Catalogs
router.get('/overview', authorize('CUSTOMERS_READ', { allowedRoles: ['MASTER', 'OWNER', 'CAFE_ADMIN'] }), getCustomersOverview);
router.get('/rewards/catalogue', authorize('CUSTOMERS_READ', { allowedRoles: ['MASTER', 'OWNER', 'CAFE_ADMIN'] }), getRewardCatalogue);
router.post('/rewards', authorize('CUSTOMERS_WRITE', { allowedRoles: ['MASTER', 'CAFE_ADMIN'] }), createReward);
router.get('/programme/current', authorize('CUSTOMERS_READ', { allowedRoles: ['MASTER', 'OWNER', 'CAFE_ADMIN'] }), getProgrammeStatus);
router.post('/programme/publish', authorize('CUSTOMERS_WRITE', { allowedRoles: ['MASTER', 'CAFE_ADMIN'] }), publishProgrammeVersion);
router.get('/integrity/status', authorize('CUSTOMERS_READ', { allowedRoles: ['MASTER', 'OWNER', 'CAFE_ADMIN'] }), getIntegrityStatus);
router.get('/audit/integrity', authorize('CUSTOMERS_READ', { allowedRoles: ['MASTER', 'OWNER', 'CAFE_ADMIN'] }), getIntegrityStatus);
router.get('/feedback', authorize('CUSTOMERS_READ', { allowedRoles: ['MASTER', 'OWNER', 'CAFE_ADMIN'] }), listCustomerFeedback);
router.post('/feedback', authorize('CUSTOMERS_WRITE', { allowedRoles: ['MASTER', 'CAFE_ADMIN'] }), createFeedback);

// Duplicate review candidates
router.get('/duplicates/candidates', authorize('CUSTOMERS_READ', { allowedRoles: ['MASTER', 'OWNER', 'CAFE_ADMIN'] }), getDuplicateCandidates);

// Gift cards
router.post('/gift-cards/issue', authorize('CUSTOMERS_WRITE', { allowedRoles: ['MASTER', 'CAFE_ADMIN'] }), issueGiftCardHandler);
router.post('/gift-cards/redeem', authorize('CUSTOMERS_WRITE', { allowedRoles: ['MASTER', 'CAFE_ADMIN'] }), redeemGiftCardHandler);
router.get('/gift-cards/:giftCardId', authorize('CUSTOMERS_READ', { allowedRoles: ['MASTER', 'OWNER', 'CAFE_ADMIN'] }), getGiftCardHandler);

// Campaigns
router.get('/campaigns', authorize('CUSTOMERS_READ', { allowedRoles: ['MASTER', 'OWNER', 'CAFE_ADMIN'] }), listCampaigns);
router.post('/campaigns', authorize('CUSTOMERS_WRITE', { allowedRoles: ['MASTER', 'CAFE_ADMIN'] }), createCampaign);
router.post('/campaigns/:campaignId/preview', authorize('CUSTOMERS_READ', { allowedRoles: ['MASTER', 'OWNER', 'CAFE_ADMIN'] }), previewCampaignHandler);
router.post('/campaigns/:campaignId/dispatch', authorize('CUSTOMERS_WRITE', { allowedRoles: ['MASTER', 'CAFE_ADMIN'] }), dispatchCampaignHandler);
router.post('/campaigns/:campaignId/cancel', authorize('CUSTOMERS_WRITE', { allowedRoles: ['MASTER', 'CAFE_ADMIN'] }), cancelCampaignHandler);

// Customer Directory CRUD & Actions
router.get('/', authorize('CUSTOMERS_READ', { allowedRoles: ['MASTER', 'OWNER', 'CAFE_ADMIN'] }), listCustomers);
router.post('/', authorize('CUSTOMERS_WRITE', { allowedRoles: ['MASTER', 'CAFE_ADMIN'] }), createCustomer);
router.post('/merge', authorize('CUSTOMERS_WRITE', { allowedRoles: ['MASTER', 'CAFE_ADMIN'] }), mergeCustomers);

// Customer-specific routes
router.get('/:customerId', authorize('CUSTOMERS_READ', { allowedRoles: ['MASTER', 'OWNER', 'CAFE_ADMIN'] }), getCustomer);
router.delete('/:customerId', authorize('CUSTOMERS_WRITE', { allowedRoles: ['MASTER', 'CAFE_ADMIN'] }), deleteCustomer);
router.post('/:customerId/consent', authorize('CUSTOMERS_WRITE', { allowedRoles: ['MASTER', 'CAFE_ADMIN'] }), updateCustomerConsentHandler);
router.patch('/:customerId/consent', authorize('CUSTOMERS_WRITE', { allowedRoles: ['MASTER', 'CAFE_ADMIN'] }), updateCustomerConsentHandler);
router.post('/:customerId/loyalty/adjust', authorize('CUSTOMERS_WRITE', { allowedRoles: ['MASTER', 'CAFE_ADMIN'] }), adjustCustomerPoints);
router.post('/:customerId/points/adjust', authorize('CUSTOMERS_WRITE', { allowedRoles: ['MASTER', 'CAFE_ADMIN'] }), adjustCustomerPoints);
router.post('/:customerId/points/redeem', authorize('CUSTOMERS_WRITE', { allowedRoles: ['MASTER', 'CAFE_ADMIN'] }), redeemPointsHandler);
router.post('/:customerId/loyalty/redeem', authorize('CUSTOMERS_WRITE', { allowedRoles: ['MASTER', 'CAFE_ADMIN'] }), redeemPointsHandler);
router.post('/:customerId/otp/request', authorize('CUSTOMERS_READ', { allowedRoles: ['MASTER', 'OWNER', 'CAFE_ADMIN'] }), requestCustomerOtpHandler);
router.post('/:customerId/otp/verify', authorize('CUSTOMERS_READ', { allowedRoles: ['MASTER', 'OWNER', 'CAFE_ADMIN'] }), verifyCustomerOtpHandler);

// F066: Customer OTP Challenge Endpoints
router.post('/otp/request', authorize('CUSTOMERS_READ', { allowedRoles: ['MASTER', 'OWNER', 'CAFE_ADMIN'] }), requestCustomerOtpHandler);
router.post('/otp/verify', authorize('CUSTOMERS_READ', { allowedRoles: ['MASTER', 'OWNER', 'CAFE_ADMIN'] }), verifyCustomerOtpHandler);

// F068: Balance & Points Expiration Endpoints
router.post('/wallet/expire', authorize('CUSTOMERS_WRITE', { allowedRoles: ['MASTER', 'CAFE_ADMIN'] }), expirePromotionalBalancesHandler);
router.post('/points/expire', authorize('CUSTOMERS_WRITE', { allowedRoles: ['MASTER', 'CAFE_ADMIN'] }), expirePointsHandler);

// Customer Wallet
router.get('/:customerId/wallet', authorize('CUSTOMERS_READ', { allowedRoles: ['MASTER', 'OWNER', 'CAFE_ADMIN'] }), getCustomerWalletHandler);
router.post('/:customerId/wallet/topup', authorize('CUSTOMERS_WRITE', { allowedRoles: ['MASTER', 'CAFE_ADMIN'] }), topUpCustomerWalletHandler);
router.post('/:customerId/wallet/redeem', authorize('CUSTOMERS_WRITE', { allowedRoles: ['MASTER', 'CAFE_ADMIN'] }), redeemCustomerWalletHandler);

module.exports = router;
