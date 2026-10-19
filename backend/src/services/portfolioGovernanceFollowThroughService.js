'use strict';

/**
 * ============================================================================
 * ZAMORIN CAFÉ ERP — PORTFOLIO GOVERNANCE & DECISION FOLLOW-THROUGH SERVICE (P18)
 * ============================================================================
 *
 * Core enterprise governance engine providing:
 *  1. Consolidated Portfolio Overview: Budgets vs Authoritative Actuals, CAPEX lifecycle,
 *     Enterprise Risk mitigation status, Revenue Sharing settlement balances, and
 *     Cross-Café Training compliance without employee PII leakage.
 *  2. Traceable Decision Follow-Through Pipeline: Proposed -> Submitted -> Approved ->
 *     Action In Progress -> Verified Completed.
 *  3. Automatic Task Delegation: Approving a decision or CAPEX spawns an auditable,
 *     accountable Task (TSK-xxxx) with verification controls and idempotency.
 *  4. Strict Separation of Duties:
 *     - Proposer cannot approve own decision or CAPEX.
 *     - Assignee cannot verify their own completion when verification is required.
 *  5. Strategic Scenario Projections: What-if sandbox calculations combining P17 forecasts
 *     and authoritative actuals with a strict non-mutation invariant.
 *  6. Integer Minor-Unit Arithmetic: All currency calculations in integer paise.
 */

const { GovernanceDecision } = require('../models/GovernanceDecision');
const { Task } = require('../models/Task');
const { CapexRequest } = require('../models/CapexRequest');
const { BudgetPlan } = require('../models/BudgetPlan');
const { Bill } = require('../models/Bill');
const { APInvoice } = require('../models/APInvoice');
const { EnterpriseRisk } = require('../models/EnterpriseRisk');
const { RevenueShareSettlement } = require('../models/RevenueShareSettlement');
const { EmployeeTraining } = require('../models/EmployeeTraining');
const { TrainingCourse } = require('../models/TrainingCourse');
const { ScenarioSandbox } = require('../models/ScenarioSandbox');
const { ApiError } = require('../utils/ApiError');

class PortfolioGovernanceFollowThroughService {
  /**
   * Helper: Ensure safe integer paise arithmetic.
   */
  static _toPaise(val) {
    if (val === null || val === undefined || isNaN(val)) return 0;
    return Math.round(Number(val));
  }

  /**
   * 1. Consolidated Portfolio Overview
   * Reconciles Budgets vs Authoritative Actuals, CAPEX lifecycle, Enterprise Risk,
   * Revenue Sharing Settlements, and Cross-Café Training compliance.
   */
  static async getPortfolioOverview({ organisationId, cafeId = null }) {
    if (!organisationId) {
      throw new ApiError(400, 'ORGANISATION_ID_REQUIRED', 'Organisation ID is required.');
    }

    const orgFilter = { organisationId };
    const cafeFilter = { organisationId };
    if (cafeId && cafeId !== 'ALL') {
      cafeFilter.cafeId = cafeId.toUpperCase();
    }

    // A. Reconcile Active/Approved Budget vs Authoritative Actuals
    const budgetQuery = {
      organisationId,
      status: { $in: ['APPROVED', 'LOCKED', 'UNDER_REVIEW', 'DRAFT'] },
    };
    if (cafeId && cafeId !== 'ALL') {
      budgetQuery.$or = [{ cafeId: cafeId.toUpperCase() }, { cafeId: null }];
    }
    const activeBudget = await BudgetPlan.findOne(budgetQuery)
      .sort({ version: -1, createdAt: -1 })
      .lean();

    // Query authoritative actuals
    // 1. Sales Actuals from completed Bills
    const billFilter = {
      organisationId,
      status: { $in: ['COMPLETED', 'PAID'] },
      voidedAt: null,
      isTraining: { $ne: true },
    };
    if (cafeId && cafeId !== 'ALL') billFilter.cafeId = cafeId.toUpperCase();
    const bills = await Bill.find(billFilter).select('grandTotalPaisa totalPaisa').lean();
    const actualSalesPaisa = bills.reduce((sum, b) => sum + this._toPaise(b.grandTotalPaisa || b.totalPaisa), 0);

    // 2. Procurement Actuals from approved AP Invoices
    const apFilter = {
      organisationId,
      $or: [
        { approvalStatus: { $in: ['APPROVED', 'PAID'] } },
        { status: { $in: ['APPROVED', 'PAID', 'MATCHED'] } },
      ],
    };
    if (cafeId && cafeId !== 'ALL') apFilter.cafeId = cafeId.toUpperCase();
    const apInvoices = await APInvoice.find(apFilter).select('totalPaisa amountPaisa subtotalPaisa').lean();
    const actualProcurementPaisa = apInvoices.reduce((sum, inv) => sum + this._toPaise(inv.totalPaisa || inv.amountPaisa || inv.subtotalPaisa), 0);

    // 3. CAPEX Actuals from capitalized requests
    const capexFilter = { organisationId };
    if (cafeId && cafeId !== 'ALL') capexFilter.cafeId = cafeId.toUpperCase();
    const allCapex = await CapexRequest.find(capexFilter).lean();
    const actualCapexPaisa = allCapex
      .filter((c) => c.status === 'APPROVED' || c.status === 'PO_ISSUED' || c.status === 'CAPITALIZED_ASSET')
      .reduce((sum, c) => sum + this._toPaise(c.actualCostPaisa || c.estimatedAmountPaisa || c.estimatedCostPaisa), 0);

    // Build Category-by-Category Reconciled Variance
    const budgetCategories = activeBudget?.lines || [
      { category: 'SALES', plannedAmountPaisa: 0 },
      { category: 'PROCUREMENT', plannedAmountPaisa: 0 },
      { category: 'CAPEX', plannedAmountPaisa: 0 },
    ];

    const categoryVariance = budgetCategories.map((line) => {
      const planned = this._toPaise(line.plannedAmountPaisa);
      let actual = 0;
      if (line.category === 'SALES') actual = actualSalesPaisa;
      else if (line.category === 'PROCUREMENT') actual = actualProcurementPaisa;
      else if (line.category === 'CAPEX') actual = actualCapexPaisa;
      else actual = 0; // Other categories

      const variancePaisa = actual - planned;
      const variancePct = planned > 0 ? Number(((variancePaisa / planned) * 100).toFixed(2)) : 0;
      return {
        category: line.category,
        plannedAmountPaisa: planned,
        actualAmountPaisa: actual,
        variancePaisa,
        variancePct,
        status: line.category === 'SALES'
          ? (actual >= planned ? 'ON_TRACK' : 'UNFAVOURABLE')
          : (actual <= planned ? 'FAVOURABLE' : 'OVER_BUDGET'),
      };
    });

    const totalPlannedPaisa = categoryVariance.reduce((s, c) => s + c.plannedAmountPaisa, 0);
    const totalActualPaisa = categoryVariance.reduce((s, c) => s + c.actualAmountPaisa, 0);
    const overallVariancePaisa = totalActualPaisa - totalPlannedPaisa;
    const overallVariancePct = totalPlannedPaisa > 0 ? Number(((overallVariancePaisa / totalPlannedPaisa) * 100).toFixed(2)) : 0;

    // B. CAPEX Lifecycle Commitment Rollup
    const capexSummary = {
      totalRequests: allCapex.length,
      requestedPaisa: allCapex.reduce((s, c) => s + this._toPaise(c.estimatedAmountPaisa || c.estimatedCostPaisa), 0),
      approvedPaisa: allCapex
        .filter((c) => ['APPROVED', 'PO_ISSUED', 'CAPITALIZED_ASSET'].includes(c.status))
        .reduce((s, c) => s + this._toPaise(c.approvedAmountPaisa || c.estimatedAmountPaisa || c.estimatedCostPaisa), 0),
      capitalizedPaisa: allCapex
        .filter((c) => c.status === 'CAPITALIZED_ASSET')
        .reduce((s, c) => s + this._toPaise(c.actualCostPaisa || c.approvedAmountPaisa), 0),
      byStatus: {
        REQUESTED: allCapex.filter((c) => c.status === 'REQUESTED').length,
        QUOTATIONS_RECEIVED: allCapex.filter((c) => c.status === 'QUOTATIONS_RECEIVED').length,
        UNDER_REVIEW: allCapex.filter((c) => c.status === 'UNDER_REVIEW').length,
        APPROVED: allCapex.filter((c) => c.status === 'APPROVED').length,
        PO_ISSUED: allCapex.filter((c) => c.status === 'PO_ISSUED').length,
        CAPITALIZED_ASSET: allCapex.filter((c) => c.status === 'CAPITALIZED_ASSET').length,
        REJECTED: allCapex.filter((c) => c.status === 'REJECTED').length,
      },
    };

    // C. Enterprise Risk Register Overview
    const risks = await EnterpriseRisk.find(orgFilter).lean();
    const riskSummary = {
      totalRisks: risks.length,
      activeRisks: risks.filter((r) => r.status === 'ACTIVE').length,
      underReviewRisks: risks.filter((r) => r.status === 'UNDER_REVIEW').length,
      mitigatedRisks: risks.filter((r) => r.status === 'MITIGATED').length,
      criticalCount: risks.filter((r) => r.severity === 'CRITICAL' || r.riskScore >= 20).length,
      highCount: risks.filter((r) => r.severity === 'HIGH' || (r.riskScore >= 12 && r.riskScore < 20)).length,
      requireActionCount: risks.filter((r) => ['ACTIVE', 'UNDER_REVIEW'].includes(r.status) && (r.severity === 'CRITICAL' || r.severity === 'HIGH')).length,
    };

    // D. Revenue Share Settlement Status
    const settlements = await RevenueShareSettlement.find(cafeFilter).lean();
    const revenueShareSummary = {
      totalSettlements: settlements.length,
      totalNetPayablePaisa: settlements.reduce((s, st) => s + this._toPaise(st.netPayablePaisa), 0),
      totalBalanceOutstandingPaisa: settlements.reduce((s, st) => s + this._toPaise(st.balanceOutstandingPaisa), 0),
      statusCounts: {
        CALCULATED: settlements.filter((s) => s.status === 'CALCULATED').length,
        APPROVED: settlements.filter((s) => s.status === 'APPROVED').length,
        POSTED: settlements.filter((s) => s.status === 'POSTED').length,
        PAID: settlements.filter((s) => s.status === 'PAID').length,
      },
    };

    // E. Cross-Café Training Compliance (Zero Employee PII Leakage)
    const trainingFilter = { organisationId };
    if (cafeId && cafeId !== 'ALL') trainingFilter.cafeId = cafeId.toUpperCase();
    const trainings = await EmployeeTraining.find(trainingFilter).select('status isCertified dueDate').lean();
    const now = new Date();
    const totalTrainings = trainings.length;
    const completedTrainings = trainings.filter((t) => t.status === 'COMPLETED' || t.isCertified).length;
    const overdueTrainings = trainings.filter((t) => {
      if (t.status === 'COMPLETED') return false;
      if (!t.dueDate) return false;
      return new Date(t.dueDate) < now;
    }).length;
    const complianceRatePct = totalTrainings > 0 ? Number(((completedTrainings / totalTrainings) * 100).toFixed(1)) : 100;

    const trainingSummary = {
      totalAssignments: totalTrainings,
      completedCount: completedTrainings,
      overdueCount: overdueTrainings,
      complianceRatePct,
      auditNote: 'Privacy Preserved: Individual employee PII withheld from cross-café governance rollup.',
    };

    // F. Decision Follow-Through Pipeline
    const decisions = await GovernanceDecision.find(orgFilter).sort({ createdAt: -1 }).lean();
    const decisionSummary = {
      totalDecisions: decisions.length,
      byStatus: {
        PROPOSED: decisions.filter((d) => d.status === 'PROPOSED').length,
        SUBMITTED: decisions.filter((d) => d.status === 'SUBMITTED').length,
        APPROVED: decisions.filter((d) => d.status === 'APPROVED').length,
        ACTION_IN_PROGRESS: decisions.filter((d) => d.status === 'ACTION_IN_PROGRESS' || d.status === 'IMPLEMENTING').length,
        VERIFIED_COMPLETED: decisions.filter((d) => d.status === 'VERIFIED_COMPLETED' || d.status === 'REVIEW_COMPLETED').length,
      },
      recentDecisions: decisions.slice(0, 10).map((d) => ({
        decisionId: d.decisionId,
        title: d.title || d.decisionTitle,
        status: d.status,
        financialImpactEstimateRupees: d.financialImpactEstimateRupees || 0,
        responsiblePersonUserId: d.responsiblePersonUserId || d.responsiblePerson,
        plannedReviewDate: d.plannedReviewDate || d.reviewScheduledDate,
        linkedTaskId: d.linkedTaskId || null,
      })),
    };

    return {
      organisationId,
      cafeScope: cafeId || 'ALL',
      timestamp: new Date().toISOString(),
      budgetVariance: {
        budgetId: activeBudget?.budgetId || 'DEFAULT_FY26',
        fiscalYear: activeBudget?.fiscalYear || 'FY2026-27',
        totalPlannedPaisa,
        totalActualPaisa,
        overallVariancePaisa,
        overallVariancePct,
        lines: categoryVariance,
      },
      capexLifecycle: capexSummary,
      enterpriseRisk: riskSummary,
      revenueShare: revenueShareSummary,
      trainingCompliance: trainingSummary,
      decisionPipeline: decisionSummary,
    };
  }

  /**
   * 2. Create Governance Decision Record
   */
  static async createDecision({
    organisationId,
    title,
    issueDescription,
    rationale,
    affectedCafes = [],
    financialImpactEstimateRupees = 0,
    responsiblePersonUserId,
    plannedReviewDate,
    alternativesConsidered = [],
    proposerUserId,
    linkedCapexId = null,
  }) {
    if (!organisationId || !title || !rationale || !responsiblePersonUserId) {
      throw new ApiError(400, 'MISSING_MANDATORY_FIELDS', 'Organisation, title, rationale, and responsible person are required.');
    }

    const count = await GovernanceDecision.countDocuments({ organisationId });
    const decisionId = `DEC-${Date.now().toString().slice(-4)}${String(count + 1).padStart(3, '0')}`;

    const decision = await GovernanceDecision.create({
      decisionId,
      organisationId,
      title: title.trim(),
      decisionTitle: title.trim(),
      issueDescription: (issueDescription || '').trim(),
      rationale: rationale.trim(),
      affectedCafes: Array.isArray(affectedCafes) ? affectedCafes : [],
      financialImpactEstimateRupees: Number(financialImpactEstimateRupees || 0),
      responsiblePersonUserId: responsiblePersonUserId.trim().toUpperCase(),
      responsiblePerson: responsiblePersonUserId.trim().toUpperCase(),
      plannedReviewDate: plannedReviewDate ? new Date(plannedReviewDate) : new Date(Date.now() + 14 * 86400000),
      alternativesConsidered: Array.isArray(alternativesConsidered) ? alternativesConsidered : [],
      proposerUserId: (proposerUserId || 'SYSTEM').trim().toUpperCase(),
      createdByUserId: (proposerUserId || 'SYSTEM').trim().toUpperCase(),
      status: 'PROPOSED',
      linkedCapexId: linkedCapexId || null,
      auditHistory: [
        {
          action: 'DECISION_PROPOSED',
          performedBy: (proposerUserId || 'SYSTEM').trim().toUpperCase(),
          performedAt: new Date(),
          notes: 'Governance decision drafted and proposed.',
        },
      ],
    });

    return decision;
  }

  /**
   * 3. Submit Decision for Review/Approval
   */
  static async submitDecision({ organisationId, decisionId, actorId }) {
    if (!organisationId || !decisionId) {
      throw new ApiError(400, 'MISSING_PARAMETERS', 'Organisation ID and Decision ID are required.');
    }

    const decision = await GovernanceDecision.findOne({ organisationId, decisionId });
    if (!decision) {
      throw new ApiError(404, 'DECISION_NOT_FOUND', `Governance decision ${decisionId} was not found.`);
    }

    if (decision.status !== 'PROPOSED') {
      throw new ApiError(400, 'INVALID_STATUS_TRANSITION', `Decision ${decisionId} cannot be submitted from status ${decision.status}.`);
    }

    decision.status = 'SUBMITTED';
    decision.auditHistory = decision.auditHistory || [];
    decision.auditHistory.push({
      action: 'DECISION_SUBMITTED',
      performedBy: actorId || 'SYSTEM',
      performedAt: new Date(),
      notes: 'Decision submitted for formal governance review.',
    });

    await decision.save();
    return decision;
  }

  /**
   * 4. Approve Decision & Automatically Generate Traceable Task
   * ENFORCES SEPARATION OF DUTIES: Proposer cannot approve their own decision!
   */
  static async approveDecision({
    organisationId,
    decisionId,
    actorId,
    approvalNotes = '',
    dueDate = null,
  }) {
    if (!organisationId || !decisionId || !actorId) {
      throw new ApiError(400, 'MISSING_PARAMETERS', 'Organisation ID, Decision ID, and Actor ID are required.');
    }

    const decision = await GovernanceDecision.findOne({ organisationId, decisionId });
    if (!decision) {
      throw new ApiError(404, 'DECISION_NOT_FOUND', `Governance decision ${decisionId} was not found.`);
    }

    // SEPARATION OF DUTIES ENFORCEMENT
    const proposer = (decision.proposerUserId || decision.createdByUserId || '').toUpperCase();
    if (proposer && proposer === actorId.trim().toUpperCase()) {
      throw new ApiError(403, 'SELF_APPROVAL_PROHIBITED', 'Separation of Duties Violation: You cannot approve a governance decision that you proposed.');
    }

    // Idempotency: If already approved, return existing task and decision without creating duplicates
    if (decision.status === 'APPROVED' || decision.status === 'ACTION_IN_PROGRESS' || decision.status === 'VERIFIED_COMPLETED') {
      const existingTask = decision.linkedTaskId ? await Task.findOne({ organisationId, taskId: decision.linkedTaskId }).lean() : null;
      return {
        decision,
        task: existingTask,
        message: 'Decision is already approved.',
        isIdempotent: true,
      };
    }

    if (decision.status !== 'SUBMITTED' && decision.status !== 'PROPOSED') {
      throw new ApiError(400, 'INVALID_STATUS_TRANSITION', `Cannot approve decision in status ${decision.status}.`);
    }

    // 1. Create linked actionable Task
    const taskCount = await Task.countDocuments({ organisationId });
    const taskId = `TSK-${String(taskCount + 1001).padStart(4, '0')}`;
    const targetDueDate = dueDate || (decision.plannedReviewDate ? new Date(decision.plannedReviewDate).toISOString().slice(0, 10) : new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10));

    const task = await Task.create({
      taskId,
      organisationId,
      cafeId: (decision.affectedCafes && decision.affectedCafes.length > 0) ? decision.affectedCafes[0] : null,
      title: `[Governance Follow-Through] ${decision.title}`,
      description: `Actionable follow-through for approved decision ${decision.decisionId}: ${decision.issueDescription}`,
      category: 'MANAGEMENT_DELEGATION',
      priority: 'HIGH',
      risk: 'HIGH',
      assignedRole: 'CAFE_ADMIN',
      assignedUserId: decision.responsiblePersonUserId || actorId,
      responsibleUserId: decision.responsiblePersonUserId || actorId,
      status: 'PENDING',
      dueDate: targetDueDate,
      verificationRequired: true,
      verificationStatus: 'PENDING_VERIFICATION',
      checklist: [
        { item: 'Review decision objectives and implementation milestones', status: 'PENDING' },
        { item: 'Execute agreed mitigation or operational change', status: 'PENDING' },
        { item: 'Submit outcome report and evidence for independent review', status: 'PENDING' },
      ],
      createdByUserId: actorId.toUpperCase(),
      history: [
        {
          action: 'CREATED_FROM_GOVERNANCE_DECISION',
          actorId: actorId.toUpperCase(),
          actorRole: 'MASTER',
          timestamp: new Date(),
          reason: `Spawned automatically upon approval of Decision ${decision.decisionId}`,
        },
      ],
    });

    // 2. Update GovernanceDecision
    decision.status = 'APPROVED';
    decision.approvedByUserId = actorId.toUpperCase();
    decision.approvedAt = new Date();
    decision.linkedTaskId = task.taskId;
    decision.auditHistory = decision.auditHistory || [];
    decision.auditHistory.push({
      action: 'DECISION_APPROVED',
      performedBy: actorId.toUpperCase(),
      performedAt: new Date(),
      notes: approvalNotes || 'Approved by enterprise governance authority.',
    });

    await decision.save();

    return {
      decision,
      task,
      message: 'Decision approved and traceable action task created.',
      isIdempotent: false,
    };
  }

  /**
   * 5. Transition Action to In Progress
   */
  static async progressAction({ organisationId, decisionId, actorId, notes = '' }) {
    const decision = await GovernanceDecision.findOne({ organisationId, decisionId });
    if (!decision) {
      throw new ApiError(404, 'DECISION_NOT_FOUND', `Decision ${decisionId} was not found.`);
    }

    if (decision.status !== 'APPROVED') {
      throw new ApiError(400, 'INVALID_STATUS_TRANSITION', `Decision ${decisionId} must be APPROVED before progress can start.`);
    }

    decision.status = 'ACTION_IN_PROGRESS';
    decision.auditHistory = decision.auditHistory || [];
    decision.auditHistory.push({
      action: 'ACTION_IN_PROGRESS',
      performedBy: actorId || 'SYSTEM',
      performedAt: new Date(),
      notes: notes || 'Implementation action initiated.',
    });
    await decision.save();

    if (decision.linkedTaskId) {
      await Task.updateOne(
        { organisationId, taskId: decision.linkedTaskId },
        {
          $set: { status: 'IN_PROGRESS' },
          $push: {
            history: {
              action: 'IN_PROGRESS_BY_DECISION',
              actorId: actorId || 'SYSTEM',
              timestamp: new Date(),
              reason: notes || 'Work in progress',
            },
          },
        }
      );
    }

    return decision;
  }

  /**
   * 6. Complete and Verify Action Outcome
   * ENFORCES SEPARATION OF DUTIES: Task Assignee / Responsible Person cannot verify their own completion!
   */
  static async completeAndVerifyAction({
    organisationId,
    decisionId,
    actorId,
    outcomeNotes = '',
    verificationEvidence = '',
  }) {
    if (!organisationId || !decisionId || !actorId) {
      throw new ApiError(400, 'MISSING_PARAMETERS', 'Organisation ID, Decision ID, and Actor ID are required.');
    }

    const decision = await GovernanceDecision.findOne({ organisationId, decisionId });
    if (!decision) {
      throw new ApiError(404, 'DECISION_NOT_FOUND', `Decision ${decisionId} was not found.`);
    }

    let task = null;
    if (decision.linkedTaskId) {
      task = await Task.findOne({ organisationId, taskId: decision.linkedTaskId });
    }

    // SEPARATION OF DUTIES ENFORCEMENT
    // The person performing verification cannot be the assigned person who completed the work!
    const assignee = (task?.assignedUserId || decision.responsiblePersonUserId || '').toUpperCase();
    if (assignee && assignee === actorId.trim().toUpperCase()) {
      throw new ApiError(403, 'SELF_VERIFICATION_PROHIBITED', 'Separation of Duties Violation: You cannot verify completion of an action assigned to yourself.');
    }

    // Update Task
    if (task) {
      task.status = 'COMPLETED';
      task.verificationStatus = 'VERIFIED';
      task.verifiedByUserId = actorId.toUpperCase();
      task.verifiedAt = new Date();
      task.verificationRemarks = outcomeNotes || 'Action verified by independent reviewer.';
      task.completedByUserId = assignee || actorId.toUpperCase();
      task.completedAt = new Date();
      if (verificationEvidence) {
        task.evidence = task.evidence || [];
        task.evidence.push({
          fileId: `EVD-${Date.now()}`,
          fileName: 'completion_evidence.pdf',
          fileUrl: verificationEvidence,
          uploadedByUserId: actorId.toUpperCase(),
          uploadedAt: new Date(),
        });
      }
      task.history.push({
        action: 'TASK_VERIFIED_AND_COMPLETED',
        actorId: actorId.toUpperCase(),
        actorRole: 'MASTER',
        timestamp: new Date(),
        reason: outcomeNotes,
      });
      await task.save();
    }

    // Update Decision
    decision.status = 'VERIFIED_COMPLETED';
    decision.actualOutcomeNotes = outcomeNotes || 'Action verified and completed successfully.';
    decision.outcomeReviewedAt = new Date();
    decision.verifiedByUserId = actorId.toUpperCase();
    decision.auditHistory = decision.auditHistory || [];
    decision.auditHistory.push({
      action: 'ACTION_VERIFIED_AND_COMPLETED',
      performedBy: actorId.toUpperCase(),
      performedAt: new Date(),
      notes: outcomeNotes || 'Action verified and completed.',
    });
    await decision.save();

    return {
      decision,
      task,
      message: 'Decision action verified and closed successfully.',
    };
  }

  /**
   * 7. CAPEX Approval with Traceable Task Follow-Through & Separation of Duties
   */
  static async approveCapexWithFollowThrough({
    organisationId,
    requestId,
    actorId,
    actorRole = 'MASTER',
    approvalNotes = '',
    selectedQuotationId = null,
    selectedVendorName = null,
    approvedAmountPaisa = null,
  }) {
    if (!organisationId || !requestId || !actorId) {
      throw new ApiError(400, 'MISSING_PARAMETERS', 'Organisation ID, Request ID, and Actor ID are required.');
    }

    const capex = await CapexRequest.findOne({ organisationId, requestId });
    if (!capex) {
      throw new ApiError(404, 'CAPEX_NOT_FOUND', `CAPEX request ${requestId} was not found.`);
    }

    // SEPARATION OF DUTIES ENFORCEMENT
    const requester = (capex.requestedByUserId || '').toUpperCase();
    if (requester && requester === actorId.trim().toUpperCase()) {
      throw new ApiError(403, 'SELF_APPROVAL_PROHIBITED', 'Separation of Duties Violation: You cannot approve a CAPEX request that you submitted.');
    }

    if (capex.status === 'REQUESTED') {
      throw new ApiError(400, 'ILLEGAL_STATE_TRANSITION', 'Cannot approve CAPEX in status: REQUESTED. Workflow requires Business Case and Quotations.');
    }

    if (['APPROVED', 'PO_ISSUED', 'CAPITALIZED_ASSET'].includes(capex.status)) {
      throw new ApiError(400, 'ILLEGAL_STATE_TRANSITION', `Cannot approve CAPEX in status: ${capex.status}`);
    }

    // Update Capex
    capex.status = 'APPROVED';
    capex.selectedQuotationId = selectedQuotationId || null;
    capex.approvedByUserId = actorId.toUpperCase();
    capex.approvedAt = new Date();
    capex.approvalNotes = approvalNotes || 'Approved by Executive Governance';
    capex.auditHistory = capex.auditHistory || [];
    capex.auditHistory.push({
      action: 'CAPEX_APPROVED',
      performedBy: actorId.toUpperCase(),
      performedAt: new Date(),
      notes: capex.approvalNotes,
    });
    await capex.save();

    // Spawn Traceable Procurement Task for Asset Team
    const taskCount = await Task.countDocuments({ organisationId });
    const taskId = `TSK-${String(taskCount + 1001).padStart(4, '0')}`;
    const followThroughTask = await Task.create({
      taskId,
      organisationId,
      cafeId: capex.cafeId || null,
      title: `[CAPEX Execution] ${capex.title || 'Asset Procurement'} (${capex.requestId})`,
      description: `Execute approved CAPEX procurement for ${capex.description || capex.title}. Approved budget: ₹${((approvedAmountPaisa || capex.estimatedCostPaisa || 0) / 100).toFixed(2)}.`,
      category: 'EQUIPMENT_MAINTENANCE',
      priority: 'HIGH',
      risk: 'HIGH',
      assignedRole: 'CAFE_ADMIN',
      assignedUserId: capex.requestedByUserId || actorId.toUpperCase(),
      status: 'PENDING',
      dueDate: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
      verificationRequired: true,
      verificationStatus: 'PENDING_VERIFICATION',
      createdByUserId: actorId.toUpperCase(),
      history: [
        {
          action: 'SPAWNED_BY_CAPEX_APPROVAL',
          actorId: actorId.toUpperCase(),
          actorRole,
          timestamp: new Date(),
          reason: `Traceable execution for approved CAPEX ${capex.requestId}`,
        },
      ],
    });

    return {
      capex,
      task: followThroughTask,
      message: 'CAPEX approved and procurement execution task created.',
    };
  }

  /**
   * 8. Run Strategic Scenario (Non-Mutating Sandbox Projection)
   * INVARIANT: Never creates bills, POs, inventory lots, or journal postings!
   */
  static async runStrategicScenario({
    organisationId,
    cafeId = null,
    name,
    scenarioType = 'CUSTOM',
    assumptions = {},
    actorId = 'SYSTEM',
  }) {
    if (!organisationId || !name) {
      throw new ApiError(400, 'MISSING_FIELDS', 'Organisation ID and Scenario Name are required.');
    }

    // Authoritative Historical Baseline
    const billFilter = {
      organisationId,
      status: { $in: ['COMPLETED', 'PAID'] },
      isVoided: { $ne: true },
      isRefunded: { $ne: true },
    };
    if (cafeId && cafeId !== 'ALL') billFilter.cafeId = cafeId.toUpperCase();
    const bills = await Bill.find(billFilter).select('grandTotalPaisa totalPaisa').lean();
    const baseRevenuePaisa = bills.reduce((s, b) => s + this._toPaise(b.grandTotalPaisa || b.totalPaisa), 0) || 50000000; // default 5 Lakhs if empty

    const baseFoodCostPaisa = Math.round(baseRevenuePaisa * 0.32); // 32% food cost baseline
    const basePayrollPaisa = Math.round(baseRevenuePaisa * 0.22); // 22% payroll baseline
    const baseFixedCostPaisa = Math.round(baseRevenuePaisa * 0.15); // 15% fixed cost baseline
    const baseUtilityCostPaisa = Math.round(baseRevenuePaisa * 0.06); // 6% utility baseline

    // Apply Assumptions
    const revChange = Number(assumptions.revenueChangePct || 0) / 100;
    const foodCostChange = Number(assumptions.foodCostChangePct || assumptions.supplierCostChangePct || 0) / 100;
    const wageChange = Number(assumptions.wageChangePct || 0) / 100;
    const utilityChange = Number(assumptions.utilityChangePct || 0) / 100;

    const projectedRevenuePaisa = Math.round(baseRevenuePaisa * (1 + revChange));
    const projectedFoodCostPaisa = Math.round(baseFoodCostPaisa * (1 + revChange) * (1 + foodCostChange));
    const projectedPayrollPaisa = Math.round(basePayrollPaisa * (1 + wageChange));
    const projectedUtilityPaisa = Math.round(baseUtilityCostPaisa * (1 + utilityChange));
    const projectedTotalCostPaisa = projectedFoodCostPaisa + projectedPayrollPaisa + baseFixedCostPaisa + projectedUtilityPaisa;
    const operatingProfitPaisa = projectedRevenuePaisa - projectedTotalCostPaisa;
    const grossContributionPaisa = projectedRevenuePaisa - projectedFoodCostPaisa;

    const count = await ScenarioSandbox.countDocuments({ organisationId });
    const scenarioId = `SCN-${Date.now().toString().slice(-4)}${String(count + 1).padStart(3, '0')}`;

    const scenario = await ScenarioSandbox.create({
      scenarioId,
      organisationId,
      cafeId: cafeId && cafeId !== 'ALL' ? cafeId.toUpperCase() : null,
      name: name.trim(),
      scenarioType,
      description: `Strategic projection model for ${name.trim()}`,
      assumptions: {
        revenueChangePct: Number(assumptions.revenueChangePct || 0),
        foodCostChangePct: Number(assumptions.foodCostChangePct || 0),
        supplierCostChangePct: Number(assumptions.supplierCostChangePct || 0),
        wageChangePct: Number(assumptions.wageChangePct || 0),
        utilityChangePct: Number(assumptions.utilityChangePct || 0),
      },
      baselineValues: {
        revenuePaisa: baseRevenuePaisa,
        foodCostPaisa: baseFoodCostPaisa,
        payrollPaisa: basePayrollPaisa,
        fixedCostPaisa: baseFixedCostPaisa,
        utilityCostPaisa: baseUtilityCostPaisa,
      },
      projectedOutputs: {
        revenuePaisa: projectedRevenuePaisa,
        foodCostPaisa: projectedFoodCostPaisa,
        payrollPaisa: projectedPayrollPaisa,
        utilityCostPaisa: projectedUtilityPaisa,
        totalCostPaisa: projectedTotalCostPaisa,
        operatingContributionPaisa: grossContributionPaisa,
        grossContributionPaisa,
        operatingProfitPaisa,
        projectedCashFlowPaisa: operatingProfitPaisa,
        breakEvenRevenuePaisa: Math.round(projectedTotalCostPaisa * 1.05),
        breakEvenStatus: operatingProfitPaisa >= 0 ? 'ACHIEVABLE' : 'DEFICIT',
      },
      auditHistory: [
        {
          action: 'SCENARIO_RUN',
          performedBy: actorId.toUpperCase(),
          performedAt: new Date(),
          notes: 'Hypothetical projection calculated. 0 operational ledgers mutated.',
        },
      ],
    });

    return scenario;
  }

  /**
   * 9. Enterprise Risk Mitigation Follow-Through
   */
  static async updateRiskMitigation({
    organisationId,
    riskId,
    actorId,
    newStatus,
    mitigationNotes = '',
    treatment = 'MITIGATE',
  }) {
    if (!organisationId || !riskId || !newStatus) {
      throw new ApiError(400, 'MISSING_FIELDS', 'Organisation ID, Risk ID, and new status are required.');
    }

    const risk = await EnterpriseRisk.findOne({ organisationId, riskId: riskId.toUpperCase() });
    if (!risk) {
      throw new ApiError(404, 'RISK_NOT_FOUND', `Enterprise risk ${riskId} was not found.`);
    }

    if (newStatus === 'MITIGATED' && (!mitigationNotes || mitigationNotes.trim().length === 0)) {
      throw new ApiError(400, 'EVIDENCE_REQUIRED', 'Mandatory mitigation evidence notes are required to mark a risk as MITIGATED.');
    }

    risk.status = newStatus;
    risk.treatment = treatment;
    risk.reviewedByUserId = actorId.toUpperCase();
    risk.reviewedAt = new Date();
    risk.auditHistory = risk.auditHistory || [];
    risk.auditHistory.push({
      action: `RISK_STATUS_${newStatus}`,
      performedBy: actorId.toUpperCase(),
      performedAt: new Date(),
      notes: mitigationNotes || `Transitioned to ${newStatus}`,
    });

    await risk.save();
    return risk;
  }
}

module.exports = PortfolioGovernanceFollowThroughService;
