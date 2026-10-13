'use strict';

/**
 * ============================================================================
 * ZAMORIN CAFÉ ERP — OWNER RISK & AUDIT CONTROLLER (STAGE 02)
 * ============================================================================
 */

const OwnerRiskAuditService = require('../services/ownerRiskAuditService');
const { AntiFraudGovernanceService } = require('../services/antiFraudGovernanceService');

class OwnerRiskAuditController {
  static getTenantContext(req) {
    const user = req.auth || req.user || req.authenticatedUser;
    const organisationId = user?.organisationId || req.headers?.['x-organisation-id'];
    const cafeId = req.query?.cafeId || req.body?.cafeId || user?.cafeId || user?.primaryCafeId || null;
    const actorId = user?.userId || user?.email || 'UNKNOWN_ACTOR';
    const actorRole = user?.role || 'OWNER';

    if (!organisationId) {
      const err = new Error('Tenant identification missing: organisationId is required');
      err.statusCode = 401;
      throw err;
    }

    return { organisationId, cafeId, actorId, actorRole };
  }

  // Dashboard
  static async getDashboard(req, res, next) {
    try {
      const { organisationId, cafeId } = OwnerRiskAuditController.getTenantContext(req);
      const data = await OwnerRiskAuditService.getRiskAuditDashboard({ organisationId, cafeId });
      return res.status(200).json({ success: true, data });
    } catch (err) {
      return next(err);
    }
  }

  // Risk Register
  static async createRisk(req, res, next) {
    try {
      const { organisationId, cafeId, actorId, actorRole } =
        OwnerRiskAuditController.getTenantContext(req);
      const risk = await OwnerRiskAuditService.createRisk({
        organisationId,
        cafeId,
        ...req.body,
        actorId,
        actorRole,
      });
      return res.status(201).json({ success: true, data: risk });
    } catch (err) {
      return next(err);
    }
  }

  static async updateRisk(req, res, next) {
    try {
      const { organisationId, cafeId, actorId, actorRole } =
        OwnerRiskAuditController.getTenantContext(req);
      const { riskId } = req.params;
      const risk = await OwnerRiskAuditService.updateRisk({
        riskId,
        organisationId,
        cafeId,
        updates: req.body.updates || req.body,
        reason: req.body.reason,
        actorId,
        actorRole,
      });
      return res.status(200).json({ success: true, data: risk });
    } catch (err) {
      return next(err);
    }
  }

  static async listRisks(req, res, next) {
    try {
      const { organisationId, cafeId } = OwnerRiskAuditController.getTenantContext(req);
      const { domain, status, rating, search } = req.query;
      const data = await OwnerRiskAuditService.listRisks({
        organisationId,
        cafeId,
        domain,
        status,
        rating,
        search,
      });
      return res.status(200).json({ success: true, count: data.length, data });
    } catch (err) {
      return next(err);
    }
  }

  // Control Library
  static async createControl(req, res, next) {
    try {
      const { organisationId, cafeId, actorId, actorRole } =
        OwnerRiskAuditController.getTenantContext(req);
      const control = await OwnerRiskAuditService.createControl({
        organisationId,
        cafeId,
        ...req.body,
        actorId,
        actorRole,
      });
      return res.status(201).json({ success: true, data: control });
    } catch (err) {
      return next(err);
    }
  }

  static async assessControl(req, res, next) {
    try {
      const { organisationId, actorId, actorRole } = OwnerRiskAuditController.getTenantContext(req);
      const { controlId } = req.params;
      const control = await OwnerRiskAuditService.assessControlEffectiveness({
        controlId,
        organisationId,
        effectiveness: req.body.effectiveness,
        deficiencyDescription: req.body.deficiencyDescription,
        notes: req.body.notes,
        actorId,
        actorRole,
      });
      return res.status(200).json({ success: true, data: control });
    } catch (err) {
      return next(err);
    }
  }

  static async listControls(req, res, next) {
    try {
      const { organisationId, cafeId } = OwnerRiskAuditController.getTenantContext(req);
      const { domain, effectiveness } = req.query;
      const data = await OwnerRiskAuditService.listControls({
        organisationId,
        cafeId,
        domain,
        effectiveness,
      });
      return res.status(200).json({ success: true, count: data.length, data });
    } catch (err) {
      return next(err);
    }
  }

  // Audit Plans
  static async createAuditPlan(req, res, next) {
    try {
      const { organisationId, actorId, actorRole } = OwnerRiskAuditController.getTenantContext(req);
      const plan = await OwnerRiskAuditService.createAuditPlan({
        organisationId,
        ...req.body,
        actorId,
        actorRole,
      });
      return res.status(201).json({ success: true, data: plan });
    } catch (err) {
      return next(err);
    }
  }

  static async executeProcedure(req, res, next) {
    try {
      const { organisationId, actorId, actorRole } = OwnerRiskAuditController.getTenantContext(req);
      const { auditId, procedureId } = req.params;
      const result = await OwnerRiskAuditService.updateProcedureResult({
        auditId,
        procedureId,
        organisationId,
        ...req.body,
        actorId,
        actorRole,
      });
      return res.status(200).json({ success: true, data: result });
    } catch (err) {
      return next(err);
    }
  }

  // Findings
  static async createObservation(req, res, next) {
    try {
      const { organisationId, cafeId, actorId, actorRole } =
        OwnerRiskAuditController.getTenantContext(req);
      const obs = await OwnerRiskAuditService.createObservation({
        organisationId,
        cafeId,
        ...req.body,
        actorId,
        actorRole,
      });
      return res.status(201).json({ success: true, data: obs });
    } catch (err) {
      return next(err);
    }
  }

  static async transitionObservation(req, res, next) {
    try {
      const { organisationId, actorId, actorRole } = OwnerRiskAuditController.getTenantContext(req);
      const { findingId } = req.params;
      const { toState, reason, managementResponse, actionPlan, verificationEvidence } = req.body;
      const obs = await OwnerRiskAuditService.transitionObservationStatus({
        findingId,
        organisationId,
        toState,
        reason,
        managementResponse,
        actionPlan,
        verificationEvidence,
        actorId,
        actorRole,
      });
      return res.status(200).json({ success: true, data: obs });
    } catch (err) {
      return next(err);
    }
  }

  static async listObservations(req, res, next) {
    try {
      const { organisationId, cafeId } = OwnerRiskAuditController.getTenantContext(req);
      const { auditId, status, severity } = req.query;
      const data = await OwnerRiskAuditService.listObservations({
        organisationId,
        cafeId,
        auditId,
        status,
        severity,
      });
      return res.status(200).json({ success: true, count: data.length, data });
    } catch (err) {
      return next(err);
    }
  }

  // Anomalies
  static async recordAnomaly(req, res, next) {
    try {
      const { organisationId, cafeId, actorId } = OwnerRiskAuditController.getTenantContext(req);
      const anomaly = await OwnerRiskAuditService.recordAnomalyCase({
        organisationId,
        cafeId,
        ...req.body,
        actorId,
      });
      return res.status(201).json({ success: true, data: anomaly });
    } catch (err) {
      return next(err);
    }
  }

  static async reviewAnomaly(req, res, next) {
    try {
      const { organisationId, actorId, actorRole } = OwnerRiskAuditController.getTenantContext(req);
      const { caseId } = req.params;
      const { disposition, reviewNotes, actionTaken } = req.body;
      const anomaly = await OwnerRiskAuditService.reviewAnomalyCase({
        caseId,
        organisationId,
        disposition,
        reviewNotes,
        actionTaken,
        actorId,
        actorRole,
      });
      return res.status(200).json({ success: true, data: anomaly });
    } catch (err) {
      return next(err);
    }
  }

  static async listAnomalies(req, res, next) {
    try {
      const { organisationId, cafeId } = OwnerRiskAuditController.getTenantContext(req);
      const { type, status, severity } = req.query;
      const data = await OwnerRiskAuditService.listAnomalies({
        organisationId,
        cafeId,
        type,
        status,
        severity,
      });
      return res.status(200).json({ success: true, count: data.length, data });
    } catch (err) {
      return next(err);
    }
  }

  static async getRiskMethodology(req, res, next) {
    try {
      const { organisationId } = OwnerRiskAuditController.getTenantContext(req);
      const methodology = OwnerRiskAuditService.getOrganisationRiskMethodology(organisationId);
      return res.status(200).json({ success: true, data: methodology });
    } catch (err) {
      return next(err);
    }
  }

  static async updateRiskMethodology(req, res, next) {
    try {
      const { organisationId } = OwnerRiskAuditController.getTenantContext(req);
      const updated = OwnerRiskAuditService.setOrganisationRiskMethodology(organisationId, req.body);
      return res.status(200).json({ success: true, data: updated });
    } catch (err) {
      return next(err);
    }
  }

  static async createRiskCandidate(req, res, next) {
    try {
      const { organisationId, cafeId, actorId } = OwnerRiskAuditController.getTenantContext(req);
      const candidate = await OwnerRiskAuditService.createRiskCandidateFromIncident({
        organisationId,
        cafeId,
        ...req.body,
        actorId,
      });
      return res.status(201).json({ success: true, data: candidate });
    } catch (err) {
      return next(err);
    }
  }

  static async confirmRiskCandidate(req, res, next) {
    try {
      const { organisationId, actorId } = OwnerRiskAuditController.getTenantContext(req);
      const { riskId } = req.params;
      const confirmed = await OwnerRiskAuditService.confirmRiskCandidate({
        riskId,
        organisationId,
        ...req.body,
        actorId,
      });
      return res.status(200).json({ success: true, data: confirmed });
    } catch (err) {
      return next(err);
    }
  }

  static async getAnomalyRules(req, res, next) {
    try {
      const { organisationId } = OwnerRiskAuditController.getTenantContext(req);
      const rules = OwnerRiskAuditService.getAnomalyRuleCatalogue(organisationId);
      return res.status(200).json({ success: true, count: rules.length, data: rules });
    } catch (err) {
      return next(err);
    }
  }

  // ── Anti-Fraud Governance & Cashier Anomaly Controls (F207 / A083 / F350) ──

  static async recordBillReprint(req, res, next) {
    try {
      const { organisationId, cafeId, actorId } = OwnerRiskAuditController.getTenantContext(req);
      const { billId, reason } = req.body || {};
      const result = await AntiFraudGovernanceService.recordBillReprint({
        organisationId,
        cafeId: req.body?.cafeId || cafeId,
        billId,
        actorUserId: actorId,
        reason,
        auth: req.auth,
      });
      return res.status(200).json({ success: true, data: result });
    } catch (err) {
      return next(err);
    }
  }

  static async evaluateCashierShift(req, res, next) {
    try {
      const { organisationId, cafeId } = OwnerRiskAuditController.getTenantContext(req);
      const { registerSessionId } = req.body || {};
      const result = await AntiFraudGovernanceService.evaluateCashierShiftAnomalies({
        organisationId,
        cafeId: req.body?.cafeId || cafeId,
        registerSessionId,
        auth: req.auth,
      });
      return res.status(200).json({ success: true, data: result });
    } catch (err) {
      return next(err);
    }
  }

  static async recordRolePermissionAudit(req, res, next) {
    try {
      const { organisationId, actorId, actorRole } = OwnerRiskAuditController.getTenantContext(req);
      const { targetUserId, targetRole, action, previousState, newState, changeJustification } = req.body || {};
      const result = await AntiFraudGovernanceService.recordRolePermissionChange({
        organisationId,
        actorUserId: actorId,
        actorRole,
        targetUserId,
        targetRole,
        action,
        previousState,
        newState,
        changeJustification,
        auth: req.auth,
      });
      return res.status(200).json({ success: true, data: result });
    } catch (err) {
      return next(err);
    }
  }
}

module.exports = OwnerRiskAuditController;
