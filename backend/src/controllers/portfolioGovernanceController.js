'use strict';

/**
 * ============================================================================
 * ZAMORIN CAFÉ ERP — PORTFOLIO GOVERNANCE CONTROLLER (P18)
 * ============================================================================
 */

const PortfolioGovernanceFollowThroughService = require('../services/portfolioGovernanceFollowThroughService');
const { ApiError } = require('../utils/ApiError');
const { asyncHandler } = require('../utils/asyncHandler');

// Helper to assert persona access and role invariants
function assertGovernanceAccess(req, allowOwnerReadOnly = false) {
  const { role, isPrimaryMaster, cafeId } = req.auth || {};

  // 1. Retired Normal Master permanently fails closed
  if (role === 'MASTER' && !isPrimaryMaster) {
    throw new ApiError(403, 'ROLE_RETIRED', 'Normal Master role is permanently decommissioned.');
  }

  // 2. Staff and Vendor fail closed
  if (role === 'STAFF' || role === 'VENDOR') {
    throw new ApiError(403, 'FORBIDDEN', 'Insufficient permissions for governance and portfolio operations.');
  }

  // 3. Owner Read-Only Invariant: Mutations strictly prohibited
  if (role === 'OWNER' && !allowOwnerReadOnly) {
    throw new ApiError(403, 'OWNER_READ_ONLY', 'Owner persona is strictly read-only for governance mutations.');
  }

  // 4. Cafe Operations is strictly scoped to assigned cafe
  if (role === 'CAFE_ADMIN') {
    const requestedCafe = (req.query?.cafeId || req.body?.cafeId || '').toUpperCase();
    if (requestedCafe && requestedCafe !== 'ALL' && requestedCafe !== (cafeId || '').toUpperCase()) {
      throw new ApiError(403, 'CAFE_ACCESS_DENIED', 'Café Operations is strictly prohibited from accessing cross-café data.');
    }
  }
}

class PortfolioGovernanceController {
  /**
   * GET /api/v1/portfolio-governance/overview
   */
  static getOverview = asyncHandler(async (req, res) => {
    assertGovernanceAccess(req, true); // Owner permitted read-only

    const { organisationId, role, cafeId: userCafeId } = req.auth;
    let targetCafeId = req.query.cafeId;

    // Enforce cafe scoping for CAFE_ADMIN
    if (role === 'CAFE_ADMIN') {
      targetCafeId = userCafeId;
    }

    const data = await PortfolioGovernanceFollowThroughService.getPortfolioOverview({
      organisationId,
      cafeId: targetCafeId,
    });

    return res.status(200).json({
      success: true,
      data,
    });
  });

  /**
   * POST /api/v1/portfolio-governance/decisions
   */
  static createDecision = asyncHandler(async (req, res) => {
    assertGovernanceAccess(req, false); // Mutation: Owner denied

    const { organisationId, userId, role, cafeId } = req.auth;
    const body = req.body || {};

    // If CAFE_ADMIN, ensure affectedCafes is scoped
    if (role === 'CAFE_ADMIN') {
      body.affectedCafes = [cafeId];
    }

    const decision = await PortfolioGovernanceFollowThroughService.createDecision({
      organisationId,
      title: body.title,
      issueDescription: body.issueDescription,
      rationale: body.rationale,
      affectedCafes: body.affectedCafes,
      financialImpactEstimateRupees: body.financialImpactEstimateRupees,
      responsiblePersonUserId: body.responsiblePersonUserId,
      plannedReviewDate: body.plannedReviewDate,
      alternativesConsidered: body.alternativesConsidered,
      proposerUserId: userId,
      linkedCapexId: body.linkedCapexId,
    });

    return res.status(201).json({
      success: true,
      message: 'Governance decision drafted and proposed.',
      data: { decision },
    });
  });

  /**
   * POST /api/v1/portfolio-governance/decisions/:id/submit
   */
  static submitDecision = asyncHandler(async (req, res) => {
    assertGovernanceAccess(req, false); // Mutation: Owner denied

    const { organisationId, userId } = req.auth;
    const { id } = req.params;

    const decision = await PortfolioGovernanceFollowThroughService.submitDecision({
      organisationId,
      decisionId: id,
      actorId: userId,
    });

    return res.status(200).json({
      success: true,
      message: 'Decision submitted for review.',
      data: { decision },
    });
  });

  /**
   * POST /api/v1/portfolio-governance/decisions/:id/approve
   */
  static approveDecision = asyncHandler(async (req, res) => {
    assertGovernanceAccess(req, false); // Mutation: Owner denied

    const { organisationId, userId, role, isPrimaryMaster } = req.auth;
    const { id } = req.params;
    const { approvalNotes, dueDate } = req.body || {};

    // Only Primary Master can approve enterprise governance decisions
    if (role !== 'MASTER' || !isPrimaryMaster) {
      throw new ApiError(403, 'PRIMARY_MASTER_REQUIRED', 'Only Primary Master holds authority to approve enterprise governance decisions.');
    }

    const result = await PortfolioGovernanceFollowThroughService.approveDecision({
      organisationId,
      decisionId: id,
      actorId: userId,
      approvalNotes,
      dueDate,
    });

    return res.status(200).json({
      success: true,
      message: result.message,
      data: result,
    });
  });

  /**
   * POST /api/v1/portfolio-governance/decisions/:id/progress
   */
  static progressAction = asyncHandler(async (req, res) => {
    assertGovernanceAccess(req, false);

    const { organisationId, userId } = req.auth;
    const { id } = req.params;
    const { notes } = req.body || {};

    const decision = await PortfolioGovernanceFollowThroughService.progressAction({
      organisationId,
      decisionId: id,
      actorId: userId,
      notes,
    });

    return res.status(200).json({
      success: true,
      message: 'Decision action marked as in progress.',
      data: { decision },
    });
  });

  /**
   * POST /api/v1/portfolio-governance/decisions/:id/verify
   */
  static completeAndVerifyAction = asyncHandler(async (req, res) => {
    assertGovernanceAccess(req, false);

    const { organisationId, userId, role, isPrimaryMaster } = req.auth;
    const { id } = req.params;
    const { outcomeNotes, verificationEvidence } = req.body || {};

    // Only Primary Master can formally verify and close enterprise governance decisions
    if (role !== 'MASTER' || !isPrimaryMaster) {
      throw new ApiError(403, 'PRIMARY_MASTER_REQUIRED', 'Only Primary Master can verify and close governance action outcomes.');
    }

    const result = await PortfolioGovernanceFollowThroughService.completeAndVerifyAction({
      organisationId,
      decisionId: id,
      actorId: userId,
      outcomeNotes,
      verificationEvidence,
    });

    return res.status(200).json({
      success: true,
      message: result.message,
      data: result,
    });
  });

  /**
   * POST /api/v1/portfolio-governance/capex/:id/approve
   */
  static approveCapex = asyncHandler(async (req, res) => {
    assertGovernanceAccess(req, false);

    const { organisationId, userId, role, isPrimaryMaster } = req.auth;
    const { id } = req.params;
    const { approvalNotes, selectedQuotationId, selectedVendorName, approvedAmountPaisa } = req.body || {};

    if (role !== 'MASTER' || !isPrimaryMaster) {
      throw new ApiError(403, 'PRIMARY_MASTER_REQUIRED', 'Only Primary Master holds authority to approve CAPEX expenditure.');
    }

    const result = await PortfolioGovernanceFollowThroughService.approveCapexWithFollowThrough({
      organisationId,
      requestId: id,
      actorId: userId,
      actorRole: role,
      approvalNotes,
      selectedQuotationId,
      selectedVendorName,
      approvedAmountPaisa,
    });

    return res.status(200).json({
      success: true,
      message: result.message,
      data: result,
    });
  });

  /**
   * POST /api/v1/portfolio-governance/scenarios/run
   */
  static runScenario = asyncHandler(async (req, res) => {
    // Both Primary Master and Owner can execute non-mutating scenario projections
    assertGovernanceAccess(req, true);

    const { organisationId, userId, role, cafeId: userCafeId } = req.auth;
    const { name, scenarioType, assumptions, cafeId } = req.body || {};

    let targetCafe = cafeId;
    if (role === 'CAFE_ADMIN') targetCafe = userCafeId;

    const scenario = await PortfolioGovernanceFollowThroughService.runStrategicScenario({
      organisationId,
      cafeId: targetCafe,
      name: name || 'What-If Strategic Scenario',
      scenarioType: scenarioType || 'CUSTOM',
      assumptions: assumptions || {},
      actorId: userId,
    });

    return res.status(201).json({
      success: true,
      message: 'Strategic scenario projected successfully (non-mutating).',
      data: { scenario },
    });
  });

  /**
   * POST /api/v1/portfolio-governance/risks/:id/mitigate
   */
  static updateRiskMitigation = asyncHandler(async (req, res) => {
    assertGovernanceAccess(req, false);

    const { organisationId, userId, role, isPrimaryMaster } = req.auth;
    const { id } = req.params;
    const { newStatus, mitigationNotes, treatment } = req.body || {};

    if (role !== 'MASTER' || !isPrimaryMaster) {
      throw new ApiError(403, 'PRIMARY_MASTER_REQUIRED', 'Only Primary Master holds authority to update enterprise risk treatments.');
    }

    const risk = await PortfolioGovernanceFollowThroughService.updateRiskMitigation({
      organisationId,
      riskId: id,
      actorId: userId,
      newStatus,
      mitigationNotes,
      treatment,
    });

    return res.status(200).json({
      success: true,
      message: 'Risk mitigation status updated successfully.',
      data: { risk },
    });
  });
}

module.exports = PortfolioGovernanceController;
