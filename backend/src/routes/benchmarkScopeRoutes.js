'use strict';

/**
 * ============================================================================
 * ZAMORIN CAFÉ ERP — BENCHMARK SCOPE & INTEGRATION ROUTES (P21)
 * ============================================================================
 * Mounted at: /api/v1/integration-scope
 */

const express = require('express');
const { authenticate } = require('../middleware/authenticate');
const {
  listDecisions,
  getDecisionById,
  updateDecision,
  getStatistics,
  probeProvider,
  attemptKds,
} = require('../controllers/benchmarkScopeController');

const router = express.Router();

router.use(authenticate);

// 1. Statistics across all 485 benchmark records
router.get('/statistics', getStatistics);

// 2. Probe external provider adapter truthfully
router.post('/probe-provider', probeProvider);

// 3. KDS activation attempt (strictly rejected by architectural freeze)
router.post('/:recordId/activate-kds', attemptKds);

// 4. List benchmark scope decisions with filters
router.get('/', listDecisions);

// 5. Get individual benchmark scope decision
router.get('/:recordId', getDecisionById);

// 6. Update benchmark scope decision (Primary Master only, verified inside service)
router.put('/:recordId', updateDecision);

module.exports = router;
