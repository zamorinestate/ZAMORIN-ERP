'use strict';

/**
 * ============================================================================
 * ZAMORIN CAFÉ ERP — BENCHMARK SCOPE & INTEGRATION CONTROLLER
 * ============================================================================
 * Package P21: External Services and Benchmark Scope Decisions
 */

const { benchmarkScopeDecisionService } = require('../services/benchmarkScopeDecisionService');
const { asyncHandler } = require('../utils/asyncHandler');
const { ApiError } = require('../utils/ApiError');

/**
 * Lists benchmark scope decisions with filters.
 */
const listDecisions = asyncHandler(async (req, res) => {
  const {
    disposition,
    verificationState,
    category,
    functionalPackage,
    search,
    limit,
    skip,
  } = req.query;

  const organisationId = req.auth?.organisationId || req.user?.organisationId;
  if (!organisationId) {
    throw new ApiError(400, 'ORGANISATION_CONTEXT_REQUIRED', 'Organisation context is required.');
  }
  const cafeId = req.auth?.cafeId || req.auth?.primaryCafeId || null;

  const records = await benchmarkScopeDecisionService.listScopeDecisions({
    organisationId,
    cafeId,
    disposition,
    verificationState,
    category,
    functionalPackage,
    search,
    limit: limit ? Number(limit) : 500,
    skip: skip ? Number(skip) : 0,
    actor: req.auth || req.user || {},
  });

  res.json({
    success: true,
    count: records.length,
    data: records,
  });
});

/**
 * Retrieves a single benchmark scope decision.
 */
const getDecisionById = asyncHandler(async (req, res) => {
  const { recordId } = req.params;
  const organisationId = req.auth?.organisationId || req.user?.organisationId;
  if (!organisationId) {
    throw new ApiError(400, 'ORGANISATION_CONTEXT_REQUIRED', 'Organisation context is required.');
  }

  const record = await benchmarkScopeDecisionService.getScopeDecision(recordId, {
    organisationId,
    actor: req.auth || req.user || {},
  });

  res.json({
    success: true,
    data: record,
  });
});

/**
 * Updates a benchmark scope decision. Primary Master only.
 */
const updateDecision = asyncHandler(async (req, res) => {
  const { recordId } = req.params;
  const updatePayload = req.body || {};

  const record = await benchmarkScopeDecisionService.updateScopeDecision(
    recordId,
    updatePayload,
    req.auth || req.user || {}
  );

  res.json({
    success: true,
    message: `Benchmark scope decision for ${recordId} updated successfully.`,
    data: record,
  });
});

/**
 * Computes coverage statistics across all 485 benchmark records.
 */
const getStatistics = asyncHandler(async (req, res) => {
  const organisationId = req.auth?.organisationId || req.user?.organisationId;
  if (!organisationId) {
    throw new ApiError(400, 'ORGANISATION_CONTEXT_REQUIRED', 'Organisation context is required.');
  }

  const stats = await benchmarkScopeDecisionService.getScopeStatistics(organisationId);

  res.json({
    success: true,
    data: stats,
  });
});

/**
 * Probes an external provider adapter truthfully.
 */
const probeProvider = asyncHandler(async (req, res) => {
  const { providerKey } = req.body;

  if (!providerKey) {
    throw new ApiError(400, 'PROVIDER_KEY_REQUIRED', 'providerKey is required in request body.');
  }

  const result = await benchmarkScopeDecisionService.probeProviderIntegration(
    providerKey,
    req.auth || req.user || {}
  );

  res.json({
    success: true,
    data: result,
  });
});

/**
 * Attempts KDS activation; strictly rejected under the Four-Persona architectural freeze.
 */
const attemptKds = asyncHandler(async (req, res) => {
  const { recordId } = req.params;

  await benchmarkScopeDecisionService.attemptKdsActivation(
    recordId,
    req.auth || req.user || {}
  );

  // Unreachable due to exception throw, but structured for correctness
  res.json({ success: false });
});

module.exports = {
  listDecisions,
  getDecisionById,
  updateDecision,
  getStatistics,
  probeProvider,
  attemptKds,
};
