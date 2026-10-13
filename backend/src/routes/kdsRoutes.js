'use strict';

/**
 * ============================================================================
 * ZAMORIN CAFÉ ERP — KITCHEN DISPLAY SYSTEM (KDS) ROUTES (R02-03)
 * ============================================================================
 * Mounted at: /api/v1/kds (registered in routes/index.js)
 */

const express = require('express');
const { authenticate } = require('../middleware/authenticate');
const { attachDeviceContext } = require('../middleware/deviceContext');
const {
  listTickets,
  getTicket,
  createTicket,
  bumpTicket,
  bumpItem,
  voidTicketItems,
  getMetrics,
  listStations,
  createStation,
  routeStationMenuItem,
  getAggregatedItems,
  releaseHeldTickets,
} = require('../controllers/kdsController');

const router = express.Router();

router.use(authenticate);
router.use(attachDeviceContext);

// Real-time Station Metrics & Overdue Count
router.get('/metrics', getMetrics);

// F272: Aggregated Item Batch View
router.get('/aggregated-items', getAggregatedItems);

// F036: Release Payment-Gated Held Kitchen Tickets
router.post('/release-held', releaseHeldTickets);

// Café Prep Stations & Menu Routing
router.get('/stations', listStations);
router.post('/stations', createStation);
router.post('/stations/routing', routeStationMenuItem);

// Ticket Listing & Creation
router.get('/tickets', listTickets);
router.post('/tickets', createTicket);

// Single Ticket Retrieval & State Bumping
router.get('/tickets/:ticketId', getTicket);
router.post('/tickets/:ticketId/bump', bumpTicket);
router.post('/tickets/:ticketId/items/:itemIndex/bump', bumpItem);

// POS Void Propagation
router.post('/void', voidTicketItems);

module.exports = router;
