// =============================================================================
// ZAMORIN CAFÉ ERP — PORTFOLIO GOVERNANCE & DECISION FOLLOW-THROUGH (P18)
// =============================================================================
// Comprehensive executive oversight workspace providing:
//  - Reconciled Budgets vs Authoritative Actuals (Bills, AP Invoices, Payroll)
//  - Traceable Decision Follow-Through Pipeline linked to actionable Tasks
//  - CAPEX commitments & approval lifecycle with Separation of Duties
//  - Enterprise Risk mitigations & review date compliance
//  - Non-mutating Strategic Scenario sandbox modeling
//  - Cross-Café Training compliance oversight without employee PII leakage
// =============================================================================

import { apiGet, apiPost } from '../apiClient.js';
import { showToast, skeleton } from '../components.js';
import { state } from '../state.js';
import { icon } from '../icons.js';

let activeTab = 'decisions';
let selectedCafe = 'ALL';
let cachedOverview = null;
let cachedScenarioResult = null;
let isLoading = false;

function formatPaisa(paisa) {
  if (paisa === null || paisa === undefined || isNaN(paisa)) return '₹0.00';
  return '₹' + (Number(paisa) / 100).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function setPortfolioGovernanceTab(tab) {
  activeTab = tab || 'decisions';
}

export function renderPortfolioGovernance() {
  const isOwner = state.currentUser?.role === 'owner';
  const isMaster = state.currentUser?.role === 'master' || state.currentUser?.role === 'primary_master';

  return `
    <div class="page-enter portfolio-governance-workspace" style="display:flex;flex-direction:column;gap:20px;padding-bottom:60px;">
      <!-- Header -->
      <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:16px;">
        <div>
          <div style="display:inline-flex;align-items:center;gap:6px;padding:4px 10px;background:rgba(16,185,129,0.12);border:1px solid rgba(16,185,129,0.3);border-radius:20px;font-size:11px;font-weight:700;color:#10b981;letter-spacing:0.5px;margin-bottom:8px;">
            <span style="width:6px;height:6px;border-radius:50%;background:#10b981;"></span>
            GOVERNANCE, PORTFOLIO & DECISION FOLLOW-THROUGH · PACKAGE P18
          </div>
          <h1 style="font-size:24px;font-weight:800;color:var(--text-primary,#fff);margin:0 0 4px 0;letter-spacing:-0.5px;">
            Portfolio Governance & Decision Follow-Through
          </h1>
          <div style="font-size:13px;color:var(--text-muted,#94a3b8);">
            Authoritative Reconciled Budgets, CAPEX Commitments, Risk Controls, Training Compliance & Closed-Loop Decision Actions
          </div>
        </div>

        <!-- Controls -->
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
          <select id="p18-cafe-selector" class="form-select" style="min-width:180px;background:var(--bg-surface,#1e293b);border:1px solid var(--border-color,#334155);color:var(--text-primary,#fff);border-radius:8px;padding:8px 12px;font-size:13px;">
            <option value="ALL" ${selectedCafe === 'ALL' ? 'selected' : ''}>All Estate Outlets</option>
            <option value="ZC-0001" ${selectedCafe === 'ZC-0001' ? 'selected' : ''}>Kozhikode Beach (ZC-0001)</option>
            <option value="ZC-0002" ${selectedCafe === 'ZC-0002' ? 'selected' : ''}>Wayanad Heritage (ZC-0002)</option>
          </select>

          <button id="p18-refresh-btn" class="btn btn-secondary" style="display:inline-flex;align-items:center;gap:6px;background:var(--bg-surface,#1e293b);border:1px solid var(--border-color,#334155);color:var(--text-primary,#fff);border-radius:8px;padding:8px 14px;font-size:13px;font-weight:600;cursor:pointer;">
            ${icon('refresh', 14)}
            <span>Refresh Overview</span>
          </button>

          ${!isOwner ? `
            <button id="p18-propose-decision-btn" class="btn btn-primary" style="display:inline-flex;align-items:center;gap:6px;background:#3b82f6;border:none;color:#fff;border-radius:8px;padding:8px 14px;font-size:13px;font-weight:600;cursor:pointer;">
              ${icon('plus', 14)}
              <span>Propose Decision</span>
            </button>
          ` : `
            <div style="padding:6px 12px;background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.3);border-radius:6px;font-size:11px;color:#ef4444;font-weight:600;">
              Owner: Strategic Read-Only Boundary
            </div>
          `}
        </div>
      </div>

      <!-- Executive Rollup Deck (5 KPI Cards) -->
      <div id="p18-kpi-deck" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:14px;">
        ${renderKpiCards()}
      </div>

      <!-- Navigation Tabs -->
      <div style="display:flex;border-bottom:1px solid var(--border-color,#334155);gap:20px;overflow-x:auto;">
        <button class="p18-tab-btn" data-tab="decisions" style="padding:10px 4px;background:none;border:none;border-bottom:2px solid ${activeTab === 'decisions' ? '#3b82f6' : 'transparent'};color:${activeTab === 'decisions' ? '#3b82f6' : 'var(--text-muted,#94a3b8)'};font-size:14px;font-weight:600;cursor:pointer;">
          Decision Pipeline (${cachedOverview?.decisionPipeline?.totalDecisions || 0})
        </button>
        <button class="p18-tab-btn" data-tab="budget-actuals" style="padding:10px 4px;background:none;border:none;border-bottom:2px solid ${activeTab === 'budget-actuals' ? '#3b82f6' : 'transparent'};color:${activeTab === 'budget-actuals' ? '#3b82f6' : 'var(--text-muted,#94a3b8)'};font-size:14px;font-weight:600;cursor:pointer;">
          Budgets vs Actuals
        </button>
        <button class="p18-tab-btn" data-tab="capex" style="padding:10px 4px;background:none;border:none;border-bottom:2px solid ${activeTab === 'capex' ? '#3b82f6' : 'transparent'};color:${activeTab === 'capex' ? '#3b82f6' : 'var(--text-muted,#94a3b8)'};font-size:14px;font-weight:600;cursor:pointer;">
          CAPEX Commitments
        </button>
        <button class="p18-tab-btn" data-tab="scenarios" style="padding:10px 4px;background:none;border:none;border-bottom:2px solid ${activeTab === 'scenarios' ? '#3b82f6' : 'transparent'};color:${activeTab === 'scenarios' ? '#3b82f6' : 'var(--text-muted,#94a3b8)'};font-size:14px;font-weight:600;cursor:pointer;">
          Strategic Scenarios
        </button>
        <button class="p18-tab-btn" data-tab="risk-training" style="padding:10px 4px;background:none;border:none;border-bottom:2px solid ${activeTab === 'risk-training' ? '#3b82f6' : 'transparent'};color:${activeTab === 'risk-training' ? '#3b82f6' : 'var(--text-muted,#94a3b8)'};font-size:14px;font-weight:600;cursor:pointer;">
          Risk & Training Controls
        </button>
      </div>

      <!-- Active Tab Container -->
      <div id="p18-tab-content">
        ${renderActiveTabContent()}
      </div>

      <!-- Propose Decision Modal Placeholder -->
      <div id="p18-modal-container"></div>
    </div>
  `;
}

function renderKpiCards() {
  const o = cachedOverview;
  if (!o) {
    return Array(5).fill(0).map(() => `
      <div style="background:var(--bg-surface,#1e293b);border:1px solid var(--border-color,#334155);border-radius:10px;padding:16px;">
        <div style="height:14px;width:60%;background:rgba(255,255,255,0.06);border-radius:4px;margin-bottom:12px;"></div>
        <div style="height:24px;width:80%;background:rgba(255,255,255,0.08);border-radius:4px;"></div>
      </div>
    `).join('');
  }

  const bVar = o.budgetVariance?.overallVariancePct || 0;
  const isFav = bVar >= 0;

  return `
    <div style="background:var(--bg-surface,#1e293b);border:1px solid var(--border-color,#334155);border-radius:10px;padding:16px;">
      <div style="font-size:12px;font-weight:600;color:var(--text-muted,#94a3b8);text-transform:uppercase;margin-bottom:6px;">Reconciled Actuals</div>
      <div style="font-size:20px;font-weight:800;color:var(--text-primary,#fff);margin-bottom:4px;">${formatPaisa(o.budgetVariance?.totalActualPaisa)}</div>
      <div style="font-size:12px;color:${isFav ? '#10b981' : '#f59e0b'};font-weight:600;">
        ${isFav ? '+' : ''}${bVar}% vs Planned Target
      </div>
    </div>

    <div style="background:var(--bg-surface,#1e293b);border:1px solid var(--border-color,#334155);border-radius:10px;padding:16px;">
      <div style="font-size:12px;font-weight:600;color:var(--text-muted,#94a3b8);text-transform:uppercase;margin-bottom:6px;">Approved CAPEX</div>
      <div style="font-size:20px;font-weight:800;color:#3b82f6;margin-bottom:4px;">${formatPaisa(o.capexLifecycle?.approvedPaisa)}</div>
      <div style="font-size:12px;color:var(--text-muted,#94a3b8);">
        ${o.capexLifecycle?.byStatus?.APPROVED || 0} approved · ${o.capexLifecycle?.byStatus?.CAPITALIZED_ASSET || 0} capitalized
      </div>
    </div>

    <div style="background:var(--bg-surface,#1e293b);border:1px solid var(--border-color,#334155);border-radius:10px;padding:16px;">
      <div style="font-size:12px;font-weight:600;color:var(--text-muted,#94a3b8);text-transform:uppercase;margin-bottom:6px;">Decisions Pipeline</div>
      <div style="font-size:20px;font-weight:800;color:#10b981;margin-bottom:4px;">${o.decisionPipeline?.totalDecisions || 0} Active</div>
      <div style="font-size:12px;color:var(--text-muted,#94a3b8);">
        ${o.decisionPipeline?.byStatus?.APPROVED || 0} in progress · ${o.decisionPipeline?.byStatus?.VERIFIED_COMPLETED || 0} verified
      </div>
    </div>

    <div style="background:var(--bg-surface,#1e293b);border:1px solid var(--border-color,#334155);border-radius:10px;padding:16px;">
      <div style="font-size:12px;font-weight:600;color:var(--text-muted,#94a3b8);text-transform:uppercase;margin-bottom:6px;">Enterprise Risks</div>
      <div style="font-size:20px;font-weight:800;color:${(o.enterpriseRisk?.criticalCount || 0) > 0 ? '#ef4444' : '#10b981'};margin-bottom:4px;">
        ${o.enterpriseRisk?.activeRisks || 0} Active
      </div>
      <div style="font-size:12px;color:var(--text-muted,#94a3b8);">
        ${o.enterpriseRisk?.criticalCount || 0} critical · ${o.enterpriseRisk?.mitigatedRisks || 0} mitigated
      </div>
    </div>

    <div style="background:var(--bg-surface,#1e293b);border:1px solid var(--border-color,#334155);border-radius:10px;padding:16px;">
      <div style="font-size:12px;font-weight:600;color:var(--text-muted,#94a3b8);text-transform:uppercase;margin-bottom:6px;">Training Compliance</div>
      <div style="font-size:20px;font-weight:800;color:#8b5cf6;margin-bottom:4px;">${o.trainingCompliance?.complianceRatePct || 100}%</div>
      <div style="font-size:12px;color:var(--text-muted,#94a3b8);">
        ${o.trainingCompliance?.overdueCount || 0} overdue (PII isolated)
      </div>
    </div>
  `;
}

function renderActiveTabContent() {
  if (activeTab === 'decisions') return renderDecisionsTab();
  if (activeTab === 'budget-actuals') return renderBudgetActualsTab();
  if (activeTab === 'capex') return renderCapexTab();
  if (activeTab === 'scenarios') return renderScenariosTab();
  if (activeTab === 'risk-training') return renderRiskTrainingTab();
  return '';
}

function renderDecisionsTab() {
  const o = cachedOverview;
  const decisions = o?.decisionPipeline?.recentDecisions || [];

  return `
    <div style="display:flex;flex-direction:column;gap:16px;">
      <div style="display:flex;justify-content:space-between;align-items:center;">
        <h3 style="font-size:16px;font-weight:700;color:var(--text-primary,#fff);margin:0;">
          Closed-Loop Governance Decisions & Action Tasks
        </h3>
        <span style="font-size:12px;color:var(--text-muted,#94a3b8);">
          Enforces Separation of Duties: Proposer cannot approve · Assignee cannot verify self
        </span>
      </div>

      <div style="background:var(--bg-surface,#1e293b);border:1px solid var(--border-color,#334155);border-radius:10px;overflow:hidden;">
        <table style="width:100%;border-collapse:collapse;font-size:13px;text-align:left;">
          <thead>
            <tr style="background:rgba(255,255,255,0.03);border-bottom:1px solid var(--border-color,#334155);color:var(--text-muted,#94a3b8);">
              <th style="padding:12px 16px;">Decision ID</th>
              <th style="padding:12px 16px;">Title & Scope</th>
              <th style="padding:12px 16px;">Accountable Lead</th>
              <th style="padding:12px 16px;">Review Due</th>
              <th style="padding:12px 16px;">Status</th>
              <th style="padding:12px 16px;">Linked Task</th>
              <th style="padding:12px 16px;text-align:right;">Actions</th>
            </tr>
          </thead>
          <tbody>
            ${decisions.length === 0 ? `
              <tr>
                <td colspan="7" style="padding:30px;text-align:center;color:var(--text-muted,#94a3b8);">
                  No governance decisions drafted. Click "Propose Decision" to initiate.
                </td>
              </tr>
            ` : decisions.map((d) => `
              <tr style="border-bottom:1px solid rgba(255,255,255,0.05);">
                <td style="padding:12px 16px;font-weight:700;color:#3b82f6;">${d.decisionId}</td>
                <td style="padding:12px 16px;color:var(--text-primary,#fff);font-weight:600;">
                  ${d.title}
                  ${d.financialImpactEstimateRupees ? `<span style="font-size:11px;color:#10b981;margin-left:6px;">(₹${Number(d.financialImpactEstimateRupees).toLocaleString('en-IN')})</span>` : ''}
                </td>
                <td style="padding:12px 16px;color:var(--text-muted,#94a3b8);">${d.responsiblePersonUserId || 'Executive'}</td>
                <td style="padding:12px 16px;color:var(--text-muted,#94a3b8);">${d.plannedReviewDate ? new Date(d.plannedReviewDate).toLocaleDateString() : '—'}</td>
                <td style="padding:12px 16px;">
                  <span style="display:inline-block;padding:3px 8px;border-radius:12px;font-size:11px;font-weight:700;${getStatusStyle(d.status)}">
                    ${d.status}
                  </span>
                </td>
                <td style="padding:12px 16px;color:${d.linkedTaskId ? '#10b981' : 'var(--text-muted,#94a3b8)'};">
                  ${d.linkedTaskId ? `Task: ${d.linkedTaskId}` : 'Not spawned'}
                </td>
                <td style="padding:12px 16px;text-align:right;">
                  <div style="display:inline-flex;gap:6px;">
                    ${d.status === 'PROPOSED' ? `
                      <button class="btn btn-sm p18-action-btn" data-action="submit" data-id="${d.decisionId}" style="padding:4px 8px;font-size:11px;background:#3b82f6;color:#fff;border:none;border-radius:4px;cursor:pointer;">Submit</button>
                    ` : ''}
                    ${d.status === 'SUBMITTED' ? `
                      <button class="btn btn-sm p18-action-btn" data-action="approve" data-id="${d.decisionId}" style="padding:4px 8px;font-size:11px;background:#10b981;color:#fff;border:none;border-radius:4px;cursor:pointer;">Approve</button>
                    ` : ''}
                    ${d.status === 'APPROVED' ? `
                      <button class="btn btn-sm p18-action-btn" data-action="progress" data-id="${d.decisionId}" style="padding:4px 8px;font-size:11px;background:#f59e0b;color:#fff;border:none;border-radius:4px;cursor:pointer;">Progress</button>
                    ` : ''}
                    ${d.status === 'ACTION_IN_PROGRESS' || d.status === 'IMPLEMENTING' ? `
                      <button class="btn btn-sm p18-action-btn" data-action="verify" data-id="${d.decisionId}" style="padding:4px 8px;font-size:11px;background:#8b5cf6;color:#fff;border:none;border-radius:4px;cursor:pointer;">Verify & Close</button>
                    ` : ''}
                    ${d.status === 'VERIFIED_COMPLETED' ? `
                      <span style="font-size:11px;color:#10b981;font-weight:700;">✓ Closed</span>
                    ` : ''}
                  </div>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function getStatusStyle(status) {
  switch (status) {
    case 'PROPOSED': return 'background:rgba(148,163,184,0.12);color:#94a3b8;border:1px solid rgba(148,163,184,0.3);';
    case 'SUBMITTED': return 'background:rgba(59,130,246,0.12);color:#3b82f6;border:1px solid rgba(59,130,246,0.3);';
    case 'APPROVED': return 'background:rgba(16,185,129,0.12);color:#10b981;border:1px solid rgba(16,185,129,0.3);';
    case 'ACTION_IN_PROGRESS':
    case 'IMPLEMENTING': return 'background:rgba(245,158,11,0.12);color:#f59e0b;border:1px solid rgba(245,158,11,0.3);';
    case 'VERIFIED_COMPLETED':
    case 'REVIEW_COMPLETED': return 'background:rgba(139,92,246,0.12);color:#8b5cf6;border:1px solid rgba(139,92,246,0.3);';
    default: return 'background:rgba(255,255,255,0.05);color:#fff;';
  }
}

function renderBudgetActualsTab() {
  const o = cachedOverview;
  const bv = o?.budgetVariance;
  const lines = bv?.lines || [];

  return `
    <div style="display:flex;flex-direction:column;gap:16px;">
      <div style="display:flex;justify-content:space-between;align-items:center;">
        <div>
          <h3 style="font-size:16px;font-weight:700;color:var(--text-primary,#fff);margin:0;">
            Reconciled Budgets vs Authoritative Financial Actuals
          </h3>
          <div style="font-size:12px;color:var(--text-muted,#94a3b8);">
            Sales reconciled from completed Bills · Procurement from approved AP Invoices · All calculations in integer minor units
          </div>
        </div>
        <div style="font-size:13px;font-weight:700;color:#3b82f6;">
          Fiscal Year: ${bv?.fiscalYear || 'FY2026-27'} (${bv?.budgetId || 'BASE'})
        </div>
      </div>

      <div style="background:var(--bg-surface,#1e293b);border:1px solid var(--border-color,#334155);border-radius:10px;overflow:hidden;">
        <table style="width:100%;border-collapse:collapse;font-size:13px;text-align:left;">
          <thead>
            <tr style="background:rgba(255,255,255,0.03);border-bottom:1px solid var(--border-color,#334155);color:var(--text-muted,#94a3b8);">
              <th style="padding:12px 16px;">Category</th>
              <th style="padding:12px 16px;">Planned Target</th>
              <th style="padding:12px 16px;">Authoritative Actual</th>
              <th style="padding:12px 16px;">Variance (₹)</th>
              <th style="padding:12px 16px;">Variance (%)</th>
              <th style="padding:12px 16px;text-align:right;">Control Status</th>
            </tr>
          </thead>
          <tbody>
            ${lines.map((l) => `
              <tr style="border-bottom:1px solid rgba(255,255,255,0.05);">
                <td style="padding:12px 16px;font-weight:700;color:var(--text-primary,#fff);">${l.category}</td>
                <td style="padding:12px 16px;color:var(--text-muted,#94a3b8);">${formatPaisa(l.plannedAmountPaisa)}</td>
                <td style="padding:12px 16px;font-weight:600;color:var(--text-primary,#fff);">${formatPaisa(l.actualAmountPaisa)}</td>
                <td style="padding:12px 16px;font-weight:600;color:${l.variancePaisa >= 0 ? '#10b981' : '#f59e0b'};">
                  ${formatPaisa(l.variancePaisa)}
                </td>
                <td style="padding:12px 16px;color:${l.variancePct >= 0 ? '#10b981' : '#f59e0b'};">
                  ${l.variancePct > 0 ? '+' : ''}${l.variancePct}%
                </td>
                <td style="padding:12px 16px;text-align:right;">
                  <span style="display:inline-block;padding:3px 8px;border-radius:12px;font-size:11px;font-weight:700;background:rgba(16,185,129,0.12);color:#10b981;">
                    ${l.status}
                  </span>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function renderCapexTab() {
  const o = cachedOverview;
  const capex = o?.capexLifecycle;

  return `
    <div style="display:flex;flex-direction:column;gap:16px;">
      <div style="display:flex;justify-content:space-between;align-items:center;">
        <h3 style="font-size:16px;font-weight:700;color:var(--text-primary,#fff);margin:0;">
          Capital Expenditure (CAPEX) Lifecycle & Approvals
        </h3>
        <span style="font-size:12px;color:var(--text-muted,#94a3b8);">
          Approval automatically creates execution Task without bypassing purchase order controls
        </span>
      </div>

      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px;">
        <div style="background:var(--bg-surface,#1e293b);border:1px solid var(--border-color,#334155);border-radius:8px;padding:14px;">
          <div style="font-size:11px;color:var(--text-muted,#94a3b8);text-transform:uppercase;">Total Requested</div>
          <div style="font-size:18px;font-weight:800;color:var(--text-primary,#fff);margin-top:4px;">${formatPaisa(capex?.requestedPaisa)}</div>
        </div>
        <div style="background:var(--bg-surface,#1e293b);border:1px solid var(--border-color,#334155);border-radius:8px;padding:14px;">
          <div style="font-size:11px;color:var(--text-muted,#94a3b8);text-transform:uppercase;">Approved Budget</div>
          <div style="font-size:18px;font-weight:800;color:#3b82f6;margin-top:4px;">${formatPaisa(capex?.approvedPaisa)}</div>
        </div>
        <div style="background:var(--bg-surface,#1e293b);border:1px solid var(--border-color,#334155);border-radius:8px;padding:14px;">
          <div style="font-size:11px;color:var(--text-muted,#94a3b8);text-transform:uppercase;">Capitalized Assets</div>
          <div style="font-size:18px;font-weight:800;color:#10b981;margin-top:4px;">${formatPaisa(capex?.capitalizedPaisa)}</div>
        </div>
      </div>
    </div>
  `;
}

function renderScenariosTab() {
  const res = cachedScenarioResult;

  return `
    <div style="display:flex;flex-direction:column;gap:16px;">
      <div style="display:flex;justify-content:space-between;align-items:center;">
        <div>
          <h3 style="font-size:16px;font-weight:700;color:var(--text-primary,#fff);margin:0;">
            Non-Mutating Strategic Scenario Sandbox
          </h3>
          <div style="font-size:12px;color:var(--text-muted,#94a3b8);">
            Simulate operational sensitivity. Invariant: 0 bills, 0 purchase orders, 0 ledgers mutated.
          </div>
        </div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;">
        <!-- Parameters Form -->
        <div style="background:var(--bg-surface,#1e293b);border:1px solid var(--border-color,#334155);border-radius:10px;padding:16px;display:flex;flex-direction:column;gap:12px;">
          <h4 style="font-size:14px;font-weight:700;color:var(--text-primary,#fff);margin:0;">Simulation Assumptions</h4>

          <div>
            <label style="font-size:12px;color:var(--text-muted,#94a3b8);display:block;margin-bottom:4px;">Scenario Title</label>
            <input id="p18-scn-name" type="text" class="form-control" value="Q4 Festive Expansion +15%" style="width:100%;padding:8px 10px;background:rgba(0,0,0,0.2);border:1px solid var(--border-color,#334155);color:#fff;border-radius:6px;font-size:13px;" />
          </div>

          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
            <div>
              <label style="font-size:12px;color:var(--text-muted,#94a3b8);display:block;margin-bottom:4px;">Revenue Growth (%)</label>
              <input id="p18-scn-rev" type="number" class="form-control" value="15" style="width:100%;padding:8px 10px;background:rgba(0,0,0,0.2);border:1px solid var(--border-color,#334155);color:#fff;border-radius:6px;font-size:13px;" />
            </div>
            <div>
              <label style="font-size:12px;color:var(--text-muted,#94a3b8);display:block;margin-bottom:4px;">Supplier Cost Change (%)</label>
              <input id="p18-scn-cost" type="number" class="form-control" value="5" style="width:100%;padding:8px 10px;background:rgba(0,0,0,0.2);border:1px solid var(--border-color,#334155);color:#fff;border-radius:6px;font-size:13px;" />
            </div>
          </div>

          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
            <div>
              <label style="font-size:12px;color:var(--text-muted,#94a3b8);display:block;margin-bottom:4px;">Wage Adjustment (%)</label>
              <input id="p18-scn-wage" type="number" class="form-control" value="8" style="width:100%;padding:8px 10px;background:rgba(0,0,0,0.2);border:1px solid var(--border-color,#334155);color:#fff;border-radius:6px;font-size:13px;" />
            </div>
            <div>
              <label style="font-size:12px;color:var(--text-muted,#94a3b8);display:block;margin-bottom:4px;">Utility Fluctuation (%)</label>
              <input id="p18-scn-util" type="number" class="form-control" value="4" style="width:100%;padding:8px 10px;background:rgba(0,0,0,0.2);border:1px solid var(--border-color,#334155);color:#fff;border-radius:6px;font-size:13px;" />
            </div>
          </div>

          <button id="p18-run-scenario-btn" class="btn btn-primary" style="margin-top:6px;padding:10px;background:#3b82f6;border:none;color:#fff;border-radius:6px;font-weight:700;font-size:13px;cursor:pointer;">
            Run Strategic Simulation
          </button>
        </div>

        <!-- Projected Outputs -->
        <div style="background:var(--bg-surface,#1e293b);border:1px solid var(--border-color,#334155);border-radius:10px;padding:16px;">
          <h4 style="font-size:14px;font-weight:700;color:var(--text-primary,#fff);margin:0 0 12px 0;">Projected Scenario Impact</h4>
          ${!res ? `
            <div style="padding:40px;text-align:center;color:var(--text-muted,#94a3b8);font-size:13px;">
              Adjust parameters and click "Run Strategic Simulation" to calculate outputs.
            </div>
          ` : `
            <div style="display:flex;flex-direction:column;gap:10px;">
              <div style="display:flex;justify-content:space-between;border-bottom:1px solid rgba(255,255,255,0.05);padding-bottom:8px;">
                <span style="color:var(--text-muted,#94a3b8);font-size:13px;">Projected Revenue</span>
                <span style="font-weight:700;color:#10b981;font-size:14px;">${formatPaisa(res.projectedOutputs?.revenuePaisa)}</span>
              </div>
              <div style="display:flex;justify-content:space-between;border-bottom:1px solid rgba(255,255,255,0.05);padding-bottom:8px;">
                <span style="color:var(--text-muted,#94a3b8);font-size:13px;">Projected Total Costs</span>
                <span style="font-weight:700;color:#ef4444;font-size:14px;">${formatPaisa(res.projectedOutputs?.totalCostPaisa)}</span>
              </div>
              <div style="display:flex;justify-content:space-between;border-bottom:1px solid rgba(255,255,255,0.05);padding-bottom:8px;">
                <span style="color:var(--text-muted,#94a3b8);font-size:13px;">Operating Contribution</span>
                <span style="font-weight:700;color:#3b82f6;font-size:14px;">${formatPaisa(res.projectedOutputs?.operatingContributionPaisa)}</span>
              </div>
              <div style="display:flex;justify-content:space-between;border-bottom:1px solid rgba(255,255,255,0.05);padding-bottom:8px;">
                <span style="color:var(--text-muted,#94a3b8);font-size:13px;">Break-Even Target</span>
                <span style="font-weight:700;color:var(--text-primary,#fff);font-size:14px;">${formatPaisa(res.projectedOutputs?.breakEvenRevenuePaisa)}</span>
              </div>
              <div style="padding:10px;background:rgba(16,185,129,0.1);border:1px solid rgba(16,185,129,0.3);border-radius:6px;font-size:12px;color:#10b981;font-weight:600;margin-top:6px;">
                Status: ${res.projectedOutputs?.breakEvenStatus} · 0 operational ledgers altered
              </div>
            </div>
          `}
        </div>
      </div>
    </div>
  `;
}

function renderRiskTrainingTab() {
  const o = cachedOverview;
  const risk = o?.enterpriseRisk;
  const tr = o?.trainingCompliance;

  return `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;">
      <!-- Risk Oversight -->
      <div style="background:var(--bg-surface,#1e293b);border:1px solid var(--border-color,#334155);border-radius:10px;padding:16px;">
        <h4 style="font-size:15px;font-weight:700;color:var(--text-primary,#fff);margin:0 0 10px 0;">Enterprise Risk Mitigations</h4>
        <div style="display:flex;flex-direction:column;gap:10px;">
          <div style="display:flex;justify-content:space-between;font-size:13px;">
            <span style="color:var(--text-muted,#94a3b8);">Active Risks</span>
            <span style="font-weight:700;color:#f59e0b;">${risk?.activeRisks || 0}</span>
          </div>
          <div style="display:flex;justify-content:space-between;font-size:13px;">
            <span style="color:var(--text-muted,#94a3b8);">Under Formal Review</span>
            <span style="font-weight:700;color:#3b82f6;">${risk?.underReviewRisks || 0}</span>
          </div>
          <div style="display:flex;justify-content:space-between;font-size:13px;">
            <span style="color:var(--text-muted,#94a3b8);">Mitigated & Closed</span>
            <span style="font-weight:700;color:#10b981;">${risk?.mitigatedRisks || 0}</span>
          </div>
          <div style="display:flex;justify-content:space-between;font-size:13px;">
            <span style="color:var(--text-muted,#94a3b8);">Critical Priority</span>
            <span style="font-weight:700;color:#ef4444;">${risk?.criticalCount || 0}</span>
          </div>
        </div>
      </div>

      <!-- Training Compliance -->
      <div style="background:var(--bg-surface,#1e293b);border:1px solid var(--border-color,#334155);border-radius:10px;padding:16px;">
        <h4 style="font-size:15px;font-weight:700;color:var(--text-primary,#fff);margin:0 0 10px 0;">Cross-Café Training Oversight</h4>
        <div style="display:flex;flex-direction:column;gap:10px;">
          <div style="display:flex;justify-content:space-between;font-size:13px;">
            <span style="color:var(--text-muted,#94a3b8);">Total Assignments</span>
            <span style="font-weight:700;color:var(--text-primary,#fff);">${tr?.totalAssignments || 0}</span>
          </div>
          <div style="display:flex;justify-content:space-between;font-size:13px;">
            <span style="color:var(--text-muted,#94a3b8);">Certified & Completed</span>
            <span style="font-weight:700;color:#10b981;">${tr?.completedCount || 0}</span>
          </div>
          <div style="display:flex;justify-content:space-between;font-size:13px;">
            <span style="color:var(--text-muted,#94a3b8);">Overdue Assignments</span>
            <span style="font-weight:700;color:#ef4444;">${tr?.overdueCount || 0}</span>
          </div>
          <div style="display:flex;justify-content:space-between;font-size:13px;">
            <span style="color:var(--text-muted,#94a3b8);">Estate Compliance Rate</span>
            <span style="font-weight:700;color:#8b5cf6;">${tr?.complianceRatePct || 100}%</span>
          </div>
          <div style="font-size:11px;color:var(--text-muted,#94a3b8);padding-top:8px;border-top:1px solid rgba(255,255,255,0.05);">
            ${tr?.auditNote || 'PII isolated from governance view.'}
          </div>
        </div>
      </div>
    </div>
  `;
}

export function initPortfolioGovernance() {
  const container = document.querySelector('.portfolio-governance-workspace');
  if (!container) return;

  // Refresh data
  async function loadData() {
    try {
      const res = await apiGet(`/api/v1/portfolio-governance/overview?cafeId=${selectedCafe}`);
      if (res?.success && res?.data) {
        cachedOverview = res.data;
        updateView();
      }
    } catch (err) {
      showToast(err.message || 'Failed to fetch portfolio governance overview', 'error');
    }
  }

  function updateView() {
    const kpiDeck = document.getElementById('p18-kpi-deck');
    if (kpiDeck) kpiDeck.innerHTML = renderKpiCards();

    const tabContent = document.getElementById('p18-tab-content');
    if (tabContent) tabContent.innerHTML = renderActiveTabContent();

    attachTabEvents();
  }

  function attachTabEvents() {
    // Tab switching
    container.querySelectorAll('.p18-tab-btn').forEach((btn) => {
      btn.onclick = () => {
        activeTab = btn.dataset.tab;
        container.querySelectorAll('.p18-tab-btn').forEach((b) => {
          b.style.borderBottom = b.dataset.tab === activeTab ? '2px solid #3b82f6' : 'transparent';
          b.style.color = b.dataset.tab === activeTab ? '#3b82f6' : 'var(--text-muted,#94a3b8)';
        });
        const tabContent = document.getElementById('p18-tab-content');
        if (tabContent) tabContent.innerHTML = renderActiveTabContent();
        attachTabEvents();
      };
    });

    // Run scenario button
    const runBtn = document.getElementById('p18-run-scenario-btn');
    if (runBtn) {
      runBtn.onclick = async () => {
        try {
          runBtn.disabled = true;
          runBtn.textContent = 'Simulating...';
          const name = document.getElementById('p18-scn-name')?.value;
          const rev = document.getElementById('p18-scn-rev')?.value;
          const cost = document.getElementById('p18-scn-cost')?.value;
          const wage = document.getElementById('p18-scn-wage')?.value;
          const util = document.getElementById('p18-scn-util')?.value;

          const res = await apiPost('/api/v1/portfolio-governance/scenarios/run', {
            name,
            cafeId: selectedCafe,
            assumptions: {
              revenueChangePct: Number(rev),
              supplierCostChangePct: Number(cost),
              wageChangePct: Number(wage),
              utilityChangePct: Number(util),
            },
          });

          if (res?.success && res?.data?.scenario) {
            cachedScenarioResult = res.data.scenario;
            showToast('Strategic scenario projected successfully (non-mutating)', 'success');
            const tabContent = document.getElementById('p18-tab-content');
            if (tabContent) tabContent.innerHTML = renderActiveTabContent();
            attachTabEvents();
          }
        } catch (err) {
          showToast(err.message || 'Simulation failed', 'error');
        } finally {
          runBtn.disabled = false;
          runBtn.textContent = 'Run Strategic Simulation';
        }
      };
    }

    // Action buttons in decision table
    container.querySelectorAll('.p18-action-btn').forEach((btn) => {
      btn.onclick = async () => {
        const action = btn.dataset.action;
        const id = btn.dataset.id;
        try {
          if (action === 'submit') {
            await apiPost(`/api/v1/portfolio-governance/decisions/${id}/submit`, {});
            showToast(`Decision ${id} submitted for review`, 'success');
          } else if (action === 'approve') {
            await apiPost(`/api/v1/portfolio-governance/decisions/${id}/approve`, {
              approvalNotes: 'Approved via Governance Workspace',
            });
            showToast(`Decision ${id} approved & follow-through task created`, 'success');
          } else if (action === 'progress') {
            await apiPost(`/api/v1/portfolio-governance/decisions/${id}/progress`, {
              notes: 'Implementation action in progress',
            });
            showToast(`Decision ${id} marked in progress`, 'success');
          } else if (action === 'verify') {
            await apiPost(`/api/v1/portfolio-governance/decisions/${id}/verify`, {
              outcomeNotes: 'Verified independently by enterprise governance authority.',
            });
            showToast(`Decision ${id} verified and closed`, 'success');
          }
          await loadData();
        } catch (err) {
          showToast(err.message || `Action ${action} failed`, 'error');
        }
      };
    });
  }

  // Cafe selector
  const cafeSel = document.getElementById('p18-cafe-selector');
  if (cafeSel) {
    cafeSel.onchange = (e) => {
      selectedCafe = e.target.value;
      loadData();
    };
  }

  // Refresh button
  const refreshBtn = document.getElementById('p18-refresh-btn');
  if (refreshBtn) {
    refreshBtn.onclick = () => loadData();
  }

  // Initial load
  loadData();
}
