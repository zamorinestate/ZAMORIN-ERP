// =============================================================================
// ZAMORIN CAFÉ ERP — OWNER BUDGET, FORECAST, SCENARIO & INVESTMENT PLANNING
// Stage 03 Strategic Expansion Workspace
// =============================================================================

import { apiGet, apiPost } from '../apiClient.js';
import { showToast, skeleton, openModal, closeModal, confirmAction } from '../components.js';
import { state } from '../state.js';
import { icon } from '../icons.js';

let activeSection = 'overview';
let cachedData = {
  overview: null,
  budgets: [],
  variance: null,
  forecasts: [],
  scenarios: [],
  capex: [],
  feasibility: [],
};
let selectedCafe = 'ALL';

export function setOwnerPlanningSection(sec) {
  activeSection = sec || 'overview';
}

export function renderOwnerPlanning() {
  return `
    <div class="page-enter owner-planning-workspace" style="display:flex;flex-direction:column;gap:20px;padding-bottom:60px;">
      <!-- Header -->
      <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:16px;">
        <div>
          <div style="display:inline-flex;align-items:center;gap:6px;padding:4px 10px;background:rgba(59,130,246,0.12);border:1px solid rgba(59,130,246,0.3);border-radius:20px;font-size:11px;font-weight:700;color:#60a5fa;letter-spacing:0.5px;margin-bottom:8px;">
            <span style="width:6px;height:6px;border-radius:50%;background:#3b82f6;"></span>
            OWNER STRATEGIC EXPANSION · STAGE 03
          </div>
          <h1 style="font-size:24px;font-weight:800;color:var(--text-primary,#fff);margin:0 0 4px 0;letter-spacing:-0.5px;">
            Budget, Forecast, Scenario & Investment Planning
          </h1>
          <div style="font-size:13px;color:var(--text-muted,#94a3b8);">
            Strict Semantic Separation: ACTUAL (Ledger) vs BUDGET (Targets) vs FORECAST (Forward Expectations) vs SCENARIO (Sandbox)
          </div>
        </div>

        <div style="display:flex;gap:10px;align-items:center;">
          <!-- Cafe Scope Filter -->
          <select id="op-cafe-filter" class="form-select" style="background:var(--surface-card,#1e293b);color:var(--text-primary,#fff);border:1px solid var(--border-color,#334155);padding:8px 12px;border-radius:8px;font-size:13px;font-weight:600;">
            <option value="ALL">All Authorized Cafés</option>
            ${(state.currentUser?.assignedCafeIds || [])
              .map((c) => `<option value="${c}" ${selectedCafe === c ? 'selected' : ''}>${c}</option>`)
              .join('')}
          </select>

          <!-- Action Buttons -->
          <button id="op-btn-new-budget" class="btn btn-primary" style="display:inline-flex;align-items:center;gap:6px;padding:8px 14px;background:var(--gold-500,#96733a);color:#fff;border:none;border-radius:8px;font-size:13px;font-weight:700;">
            ${icon('finance')} New Budget Version
          </button>
          <button id="op-btn-new-capex" class="btn btn-secondary" style="display:inline-flex;align-items:center;gap:6px;padding:8px 14px;border-radius:8px;font-size:13px;font-weight:600;">
            ${icon('tasks')} Submit CAPEX
          </button>
        </div>
      </div>

      <!-- Navigation Tabs -->
      <div style="display:flex;gap:8px;border-bottom:1px solid var(--border-color,#334155);overflow-x:auto;padding-bottom:8px;" class="custom-scrollbar">
        ${[
          { id: 'overview', label: 'Executive Planning KPIs', icon: 'home' },
          { id: 'budgets', label: 'Budget vs Actuals', icon: 'finance' },
          { id: 'forecasts', label: 'Deterministic Forecasts', icon: 'reports' },
          { id: 'scenarios', label: 'What-If Sandbox', icon: 'settings' },
          { id: 'capex', label: 'CAPEX Investments', icon: 'tasks' },
          { id: 'feasibility', label: 'Outlet Feasibility', icon: 'performance' },
        ]
          .map(
            (t) => `
            <button class="op-tab-btn ${activeSection === t.id ? 'active' : ''}" data-tab="${t.id}"
              style="display:inline-flex;align-items:center;gap:8px;padding:8px 16px;border-radius:8px;font-size:13px;font-weight:700;white-space:nowrap;border:none;cursor:pointer;background:${activeSection === t.id ? 'var(--gold-500, #96733a)' : 'transparent'};color:${activeSection === t.id ? '#fff' : 'var(--text-muted,#94a3b8)'};">
              ${icon(t.icon)} ${t.label}
            </button>
          `
          )
          .join('')}
      </div>

      <!-- Main Content Container -->
      <div id="op-main-content">
        ${skeleton('400px')}
      </div>
    </div>
  `;
}

export function wireOwnerPlanning() {
  const container = document.getElementById('op-main-content');
  if (!container) return;

  // Cafe filter change
  const cafeFilter = document.getElementById('op-cafe-filter');
  if (cafeFilter) {
    cafeFilter.addEventListener('change', (e) => {
      selectedCafe = e.target.value;
      loadActiveSection();
    });
  }

  // Tab buttons
  document.querySelectorAll('.op-tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      activeSection = btn.dataset.tab;
      document.querySelectorAll('.op-tab-btn').forEach((b) => {
        const isActive = b.dataset.tab === activeSection;
        b.style.background = isActive ? 'var(--gold-500, #96733a)' : 'transparent';
        b.style.color = isActive ? '#fff' : 'var(--text-muted,#94a3b8)';
      });
      loadActiveSection();
    });
  });

  // Action buttons
  const btnNewBudget = document.getElementById('op-btn-new-budget');
  if (btnNewBudget) {
    btnNewBudget.addEventListener('click', openCreateBudgetModal);
  }

  const btnNewCapex = document.getElementById('op-btn-new-capex');
  if (btnNewCapex) {
    btnNewCapex.addEventListener('click', openCreateCapexModal);
  }

  loadActiveSection();
}

async function loadActiveSection() {
  const container = document.getElementById('op-main-content');
  if (!container) return;
  container.innerHTML = skeleton('350px');

  try {
    const cafeParam = selectedCafe !== 'ALL' ? `?cafeId=${selectedCafe}` : '';

    if (activeSection === 'overview') {
      const res = await apiGet(`/planning/dashboard${cafeParam}`);
      cachedData.overview = res?.data || null;
      renderOverviewTab(container);
    } else if (activeSection === 'budgets') {
      const [bRes, vRes] = await Promise.all([
        apiGet(`/planning/budgets${cafeParam}`),
        apiGet(`/planning/budgets/compare-actual${cafeParam}`),
      ]);
      cachedData.budgets = bRes?.data || [];
      cachedData.variance = vRes?.data || null;
      renderBudgetsTab(container);
    } else if (activeSection === 'forecasts') {
      const res = await apiGet(`/planning/forecasts${cafeParam}`);
      cachedData.forecasts = res?.data || [];
      renderForecastsTab(container);
    } else if (activeSection === 'scenarios') {
      const res = await apiGet(`/planning/scenarios${cafeParam}`);
      cachedData.scenarios = res?.data || [];
      renderScenariosTab(container);
    } else if (activeSection === 'capex') {
      const res = await apiGet(`/planning/capex${cafeParam}`);
      cachedData.capex = res?.data || [];
      renderCapexTab(container);
    } else if (activeSection === 'feasibility') {
      const res = await apiGet(`/planning/feasibility`);
      cachedData.feasibility = res?.data || [];
      renderFeasibilityTab(container);
    }
  } catch (err) {
    container.innerHTML = `
      <div style="padding:40px;text-align:center;background:var(--surface-card,#1e293b);border-radius:12px;border:1px solid var(--border-color,#334155);">
        <div style="font-size:18px;font-weight:700;color:#f87171;margin-bottom:8px;">Failed to load planning data</div>
        <div style="font-size:13px;color:var(--text-muted,#94a3b8);">${err.message || 'Server error'}</div>
        <div style="margin-top:16px;">
          <button class="btn btn-secondary" onclick="window.location.reload();">Retry</button>
        </div>
      </div>
    `;
  }
}

// -----------------------------------------------------------------------------
// TAB 1: EXECUTIVE PLANNING OVERVIEW
// -----------------------------------------------------------------------------
function renderOverviewTab(container) {
  const d = cachedData.overview;
  if (!d) {
    container.innerHTML = `<div style="padding:20px;text-align:center;">No planning data available</div>`;
    return;
  }

  container.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:20px;">
      <!-- KPI Cards -->
      <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(220px, 1fr));gap:14px;">
        <div style="background:var(--surface-card,#1e293b);padding:16px;border-radius:10px;border:1px solid var(--border-color,#334155);">
          <div style="font-size:11px;font-weight:700;color:var(--text-muted,#94a3b8);text-transform:uppercase;">Approved Annual Budget</div>
          <div style="font-size:24px;font-weight:800;color:#fff;margin-top:4px;">
            ${d.hasApprovedBudget ? `₹${((d.totalPlannedBudgetPaisa || 0) / 10000000).toFixed(2)} Cr` : 'Not Approved'}
          </div>
          <div style="font-size:10px;color:var(--text-muted,#94a3b8);margin-top:2px;">FY 2026-27 Target</div>
        </div>

        <div style="background:var(--surface-card,#1e293b);padding:16px;border-radius:10px;border:1px solid var(--border-color,#334155);">
          <div style="font-size:11px;font-weight:700;color:#10b981;text-transform:uppercase;">Rolling Forecast Versions</div>
          <div style="font-size:24px;font-weight:800;color:#10b981;margin-top:4px;">${d.forecastCount || 0}</div>
          <div style="font-size:10px;color:var(--text-muted,#94a3b8);margin-top:2px;">Deterministic models</div>
        </div>

        <div style="background:var(--surface-card,#1e293b);padding:16px;border-radius:10px;border:1px solid var(--border-color,#334155);">
          <div style="font-size:11px;font-weight:700;color:#60a5fa;text-transform:uppercase;">What-If Sandboxes</div>
          <div style="font-size:24px;font-weight:800;color:#3b82f6;margin-top:4px;">${d.scenarioCount || 0}</div>
          <div style="font-size:10px;color:var(--text-muted,#94a3b8);margin-top:2px;">Active sensitivity models</div>
        </div>

        <div style="background:var(--surface-card,#1e293b);padding:16px;border-radius:10px;border:1px solid var(--border-color,#334155);">
          <div style="font-size:11px;font-weight:700;color:#f59e0b;text-transform:uppercase;">Approved CAPEX Pipeline</div>
          <div style="font-size:24px;font-weight:800;color:#fbbf24;margin-top:4px;">
            ₹${((d.approvedCapexTotalPaisa || 0) / 100000).toFixed(1)} L
          </div>
          <div style="font-size:10px;color:#f87171;margin-top:2px;">${d.pendingCapexCount || 0} pending dual approval</div>
        </div>
      </div>

      <!-- Semantic Separation Notice Banner -->
      <div style="padding:14px 18px;background:rgba(59,130,246,0.08);border:1px solid rgba(59,130,246,0.25);border-radius:8px;display:flex;gap:12px;align-items:center;">
        <div style="color:#60a5fa;">${icon('info')}</div>
        <div style="font-size:12px;color:var(--text-muted,#94a3b8);line-height:1.5;">
          <strong style="color:#fff;">Governed Financial Definitions:</strong>
          <strong>ACTUAL</strong> reflects immutable, posted ledger history from canonical POS, procurement, and payroll systems.
          <strong>BUDGET</strong> represents formal approved targets.
          <strong>FORECAST</strong> updates forward expectations based on deterministic actual run-rates.
          <strong>SCENARIO</strong> is a sandbox model that strictly never affects real accounting transactions.
        </div>
      </div>
    </div>
  `;
}

// -----------------------------------------------------------------------------
// TAB 2: BUDGET VS ACTUALS
// -----------------------------------------------------------------------------
function renderBudgetsTab(container) {
  const comp = cachedData.variance?.comparison || [];
  const budgets = cachedData.budgets || [];

  container.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:20px;">
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;">
        <div>
          <h2 style="font-size:16px;font-weight:700;color:#fff;margin:0;">Budget vs Actual Ledger Variance (FY 2026-27)</h2>
          <div style="font-size:12px;color:var(--text-muted,#94a3b8);margin-top:2px;">Zero Denominator Protected · Real-Time Posted Actuals</div>
        </div>
        <button id="op-btn-add-budget-inner" class="btn btn-primary btn-sm" style="background:var(--gold-500,#96733a);color:#fff;border:none;border-radius:6px;font-weight:700;">
          + New Version
        </button>
      </div>

      <!-- Comparison Table -->
      <div style="background:var(--surface-card,#1e293b);border-radius:12px;border:1px solid var(--border-color,#334155);overflow-x:auto;">
        <table style="width:100%;border-collapse:collapse;font-size:13px;text-align:left;">
          <thead>
            <tr style="border-bottom:1px solid var(--border-color,#334155);color:var(--text-muted,#94a3b8);font-size:11px;text-transform:uppercase;">
              <th style="padding:12px 16px;">Category</th>
              <th style="padding:12px 16px;">Approved Budget</th>
              <th style="padding:12px 16px;">Actual Ledger</th>
              <th style="padding:12px 16px;">Variance (Absolute)</th>
              <th style="padding:12px 16px;">Variance (%)</th>
              <th style="padding:12px 16px;">Disposition</th>
            </tr>
          </thead>
          <tbody>
            ${comp
              .map((c) => {
                const isFav = c.status === 'FAVORABLE';
                return `
                <tr style="border-bottom:1px solid rgba(255,255,255,0.05);">
                  <td style="padding:12px 16px;font-weight:700;color:#fff;">${c.category}</td>
                  <td style="padding:12px 16px;color:var(--text-muted,#94a3b8);">₹${(c.budgetPaisa / 100).toLocaleString('en-IN')}</td>
                  <td style="padding:12px 16px;font-weight:700;color:#fff;">₹${(c.actualPaisa / 100).toLocaleString('en-IN')}</td>
                  <td style="padding:12px 16px;font-weight:600;color:${isFav ? '#10b981' : '#f87171'};">
                    ${c.variancePaisa >= 0 ? '+' : ''}₹${(c.variancePaisa / 100).toLocaleString('en-IN')}
                  </td>
                  <td style="padding:12px 16px;font-weight:700;color:${isFav ? '#10b981' : '#f87171'};">
                    ${c.variancePercentage !== null ? `${c.variancePercentage >= 0 ? '+' : ''}${c.variancePercentage}%` : '—'}
                  </td>
                  <td style="padding:12px 16px;">
                    <span style="font-size:11px;padding:2px 8px;border-radius:12px;font-weight:700;background:${isFav ? 'rgba(16,185,129,0.15)' : 'rgba(239,68,68,0.15)'};color:${isFav ? '#10b981' : '#f87171'};">
                      ${c.status}
                    </span>
                  </td>
                </tr>
              `;
              })
              .join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;

  document.getElementById('op-btn-add-budget-inner')?.addEventListener('click', openCreateBudgetModal);
}

// -----------------------------------------------------------------------------
// TAB 3: DETERMINISTIC FORECASTS
// -----------------------------------------------------------------------------
function renderForecastsTab(container) {
  const forecasts = cachedData.forecasts || [];

  container.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:16px;">
      <div style="display:flex;justify-content:space-between;align-items:center;">
        <div>
          <h2 style="font-size:16px;font-weight:700;color:#fff;margin:0;">Deterministic Forecast Engine (${forecasts.length} versions)</h2>
          <div style="font-size:12px;color:var(--text-muted,#94a3b8);margin-top:2px;">Complete formula lineage drill-down. Zero opaque predictive claims.</div>
        </div>
        <button id="op-btn-gen-forecast" class="btn btn-primary btn-sm" style="background:#3b82f6;color:#fff;border:none;border-radius:6px;font-weight:700;">
          + Generate Forecast Version
        </button>
      </div>

      ${forecasts.length === 0
        ? `
        <div style="padding:40px;text-align:center;background:var(--surface-card,#1e293b);border-radius:12px;border:1px solid var(--border-color,#334155);">
          <div style="font-size:15px;font-weight:700;color:var(--text-muted,#94a3b8);">No forecasts generated yet</div>
          <div style="font-size:12px;color:var(--text-muted,#64748b);margin-top:4px;">Generate forward projections based on verified 90-day actual run-rates.</div>
        </div>
      `
        : `
        <div style="display:flex;flex-direction:column;gap:12px;">
          ${forecasts
            .map((f) => `
            <div style="background:var(--surface-card,#1e293b);padding:18px;border-radius:12px;border:1px solid var(--border-color,#334155);">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
                <div>
                  <span style="font-size:14px;font-weight:700;color:#fff;">${f.forecastId} (v${f.version}) — ${f.fiscalYear}</span>
                  <span style="font-size:11px;color:var(--text-muted,#94a3b8);margin-left:8px;">Horizon: ${f.forecastHorizonMonths} Months</span>
                </div>
                <div style="font-size:14px;font-weight:800;color:#10b981;">Total: ₹${((f.totalForecastedPaisa || 0) / 100).toLocaleString('en-IN')}</div>
              </div>

              <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(280px, 1fr));gap:10px;">
                ${(f.lines || [])
                  .map(
                    (l) => `
                  <div style="padding:10px;background:rgba(255,255,255,0.02);border-radius:6px;border:1px solid rgba(255,255,255,0.05);">
                    <div style="display:flex;justify-content:space-between;font-weight:700;font-size:12px;color:#fff;">
                      <span>${l.category}</span>
                      <span>₹${(l.forecastedAmountPaisa / 100).toLocaleString('en-IN')}</span>
                    </div>
                    <div style="font-size:11px;color:#60a5fa;margin-top:4px;">Formula: ${l.calculationFormula}</div>
                    <div style="font-size:10px;color:var(--text-muted,#94a3b8);margin-top:2px;">${l.notes}</div>
                  </div>
                `
                  )
                  .join('')}
              </div>
            </div>
          `)
            .join('')}
        </div>
      `}
    </div>
  `;

  document.getElementById('op-btn-gen-forecast')?.addEventListener('click', openGenerateForecastModal);
}

// -----------------------------------------------------------------------------
// TAB 4: WHAT-IF SCENARIO SANDBOX
// -----------------------------------------------------------------------------
function renderScenariosTab(container) {
  const scenarios = cachedData.scenarios || [];

  container.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:16px;">
      <div style="display:flex;justify-content:space-between;align-items:center;">
        <div>
          <h2 style="font-size:16px;font-weight:700;color:#fff;margin:0;">What-If Scenario Sandbox (${scenarios.length})</h2>
          <div style="font-size:12px;color:var(--text-muted,#94a3b8);margin-top:2px;">Sandbox modeling strictly isolated from accounting ledger.</div>
        </div>
        <button id="op-btn-run-scenario" class="btn btn-primary btn-sm" style="background:#10b981;color:#fff;border:none;border-radius:6px;font-weight:700;">
          + Simulate New Scenario
        </button>
      </div>

      ${scenarios.length === 0
        ? `
        <div style="padding:40px;text-align:center;background:var(--surface-card,#1e293b);border-radius:12px;border:1px solid var(--border-color,#334155);">
          <div style="font-size:15px;font-weight:700;color:var(--text-muted,#94a3b8);">No scenarios simulated yet</div>
          <div style="font-size:12px;color:var(--text-muted,#64748b);margin-top:4px;">Model revenue sensitivity, wage increases, or rent adjustments safely in the sandbox.</div>
        </div>
      `
        : `
        <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(320px, 1fr));gap:14px;">
          ${scenarios
            .map((s) => `
            <div style="background:var(--surface-card,#1e293b);padding:18px;border-radius:12px;border:1px solid var(--border-color,#334155);display:flex;flex-direction:column;gap:12px;">
              <div style="display:flex;justify-content:space-between;align-items:center;">
                <span style="font-weight:700;font-size:14px;color:#fff;">${s.name}</span>
                <span style="font-size:10px;padding:2px 8px;border-radius:12px;font-weight:700;background:#334155;color:#fff;">${s.scenarioType}</span>
              </div>
              <div style="font-size:12px;color:var(--text-muted,#94a3b8);">${s.description || 'Custom assumption model.'}</div>

              <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:11px;background:rgba(255,255,255,0.02);padding:10px;border-radius:6px;">
                <div>Rev Change: <strong>${s.assumptions?.revenueChangePct}%</strong></div>
                <div>Food Cost Change: <strong>${s.assumptions?.foodCostChangePct}%</strong></div>
                <div>Wage Change: <strong>${s.assumptions?.wageChangePct}%</strong></div>
                <div>Rent Change: <strong>₹${(s.assumptions?.rentChangePaisa || 0) / 100}</strong></div>
              </div>

              <div style="border-top:1px solid var(--border-color,#334155);padding-top:10px;display:flex;flex-direction:column;gap:4px;font-size:12px;">
                <div style="display:flex;justify-content:space-between;">
                  <span style="color:var(--text-muted,#94a3b8);">Projected Gross Contribution:</span>
                  <span style="font-weight:700;color:#10b981;">₹${((s.projectedOutputs?.grossContributionPaisa || 0) / 100).toLocaleString('en-IN')}</span>
                </div>
                <div style="display:flex;justify-content:space-between;">
                  <span style="color:var(--text-muted,#94a3b8);">Operating Profit:</span>
                  <span style="font-weight:700;color:${(s.projectedOutputs?.operatingProfitPaisa || 0) >= 0 ? '#10b981' : '#f87171'};">
                    ₹${((s.projectedOutputs?.operatingProfitPaisa || 0) / 100).toLocaleString('en-IN')}
                  </span>
                </div>
                <div style="display:flex;justify-content:space-between;">
                  <span style="color:var(--text-muted,#94a3b8);">Break-Even Revenue:</span>
                  <span style="font-weight:700;color:#60a5fa;">₹${((s.projectedOutputs?.breakEvenRevenuePaisa || 0) / 100).toLocaleString('en-IN')}</span>
                </div>
              </div>
            </div>
          `)
            .join('')}
        </div>
      `}
    </div>
  `;

  document.getElementById('op-btn-run-scenario')?.addEventListener('click', openRunScenarioModal);
}

// -----------------------------------------------------------------------------
// TAB 5: CAPEX INVESTMENTS
// -----------------------------------------------------------------------------
function renderCapexTab(container) {
  const capex = cachedData.capex || [];

  container.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:16px;">
      <div style="display:flex;justify-content:space-between;align-items:center;">
        <h2 style="font-size:16px;font-weight:700;color:#fff;margin:0;">Capital Expenditure (CAPEX) Pipeline (${capex.length})</h2>
        <button id="op-btn-add-capex-inner" class="btn btn-primary btn-sm" style="background:var(--gold-500,#96733a);color:#fff;border:none;border-radius:6px;font-weight:700;">
          + New Request
        </button>
      </div>

      ${capex.length === 0
        ? `
        <div style="padding:40px;text-align:center;background:var(--surface-card,#1e293b);border-radius:12px;border:1px solid var(--border-color,#334155);">
          <div style="font-size:15px;font-weight:700;color:var(--text-muted,#94a3b8);">No CAPEX requests recorded</div>
          <div style="font-size:12px;color:var(--text-muted,#64748b);margin-top:4px;">Manage asset acquisition, quotations, and dual-approval governance.</div>
        </div>
      `
        : `
        <div style="background:var(--surface-card,#1e293b);border-radius:12px;border:1px solid var(--border-color,#334155);overflow-x:auto;">
          <table style="width:100%;border-collapse:collapse;font-size:13px;text-align:left;">
            <thead>
              <tr style="border-bottom:1px solid var(--border-color,#334155);color:var(--text-muted,#94a3b8);font-size:11px;text-transform:uppercase;">
                <th style="padding:12px 16px;">Request ID & Title</th>
                <th style="padding:12px 16px;">Category</th>
                <th style="padding:12px 16px;">Est. Cost</th>
                <th style="padding:12px 16px;">Quotations</th>
                <th style="padding:12px 16px;">Status</th>
                <th style="padding:12px 16px;">Actions</th>
              </tr>
            </thead>
            <tbody>
              ${capex
                .map((c) => `
                <tr style="border-bottom:1px solid rgba(255,255,255,0.05);">
                  <td style="padding:12px 16px;">
                    <div style="font-weight:700;color:#fff;">${c.requestId}</div>
                    <div style="font-size:12px;color:var(--text-muted,#94a3b8);">${c.title}</div>
                  </td>
                  <td style="padding:12px 16px;color:var(--text-muted,#94a3b8);">${c.category}</td>
                  <td style="padding:12px 16px;font-weight:700;color:#fff;">₹${((c.estimatedCostPaisa || 0) / 100).toLocaleString('en-IN')}</td>
                  <td style="padding:12px 16px;color:var(--text-muted,#94a3b8);">${c.quotations?.length || 0} received</td>
                  <td style="padding:12px 16px;">
                    <span style="font-size:11px;padding:2px 8px;border-radius:12px;font-weight:700;background:#334155;color:#fff;">
                      ${c.status}
                    </span>
                  </td>
                  <td style="padding:12px 16px;">
                    ${c.status === 'REQUESTED' || c.status === 'QUOTATIONS_RECEIVED'
                      ? `<button class="btn btn-primary btn-sm op-btn-approve-capex" data-id="${c.requestId}" style="padding:4px 8px;font-size:11px;background:#10b981;border:none;color:#fff;font-weight:700;">Approve</button>`
                      : '—'}
                  </td>
                </tr>
              `)
                .join('')}
            </tbody>
          </table>
        </div>
      `}
    </div>
  `;

  document.getElementById('op-btn-add-capex-inner')?.addEventListener('click', openCreateCapexModal);
  document.querySelectorAll('.op-btn-approve-capex').forEach((btn) => {
    btn.addEventListener('click', () => {
      approveCapex(btn.dataset.id);
    });
  });
}

// -----------------------------------------------------------------------------
// TAB 6: OUTLET FEASIBILITY
// -----------------------------------------------------------------------------
function renderFeasibilityTab(container) {
  const studies = cachedData.feasibility || [];

  container.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:16px;">
      <div style="display:flex;justify-content:space-between;align-items:center;">
        <div>
          <h2 style="font-size:16px;font-weight:700;color:#fff;margin:0;">New Outlet Expansion Feasibility (${studies.length})</h2>
          <div style="font-size:12px;color:var(--text-muted,#94a3b8);margin-top:2px;">
            Bills/Day × ABV × Days = Monthly Revenue · Transparent Payback Horizon
          </div>
        </div>
        <button id="op-btn-add-fsb" class="btn btn-primary btn-sm" style="background:#8b5cf6;color:#fff;border:none;border-radius:6px;font-weight:700;">
          + New Feasibility Study
        </button>
      </div>

      ${studies.length === 0
        ? `
        <div style="padding:40px;text-align:center;background:var(--surface-card,#1e293b);border-radius:12px;border:1px solid var(--border-color,#334155);">
          <div style="font-size:15px;font-weight:700;color:var(--text-muted,#94a3b8);">No feasibility studies on file</div>
          <div style="font-size:12px;color:var(--text-muted,#64748b);margin-top:4px;">Evaluate footfalls, average ticket size, rent, and capital payback periods.</div>
        </div>
      `
        : `
        <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(320px, 1fr));gap:14px;">
          ${studies
            .map((f) => `
            <div style="background:var(--surface-card,#1e293b);padding:18px;border-radius:12px;border:1px solid var(--border-color,#334155);display:flex;flex-direction:column;gap:12px;">
              <div>
                <div style="font-weight:700;font-size:15px;color:#fff;">${f.outletName}</div>
                <div style="font-size:12px;color:var(--text-muted,#94a3b8);margin-top:2px;">Location: ${f.proposedLocation}</div>
              </div>

              <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:11px;background:rgba(255,255,255,0.02);padding:10px;border-radius:6px;">
                <div>Expected Bills/Day: <strong>${f.expectedBillsPerDay}</strong></div>
                <div>Avg Bill Value: <strong>₹${(f.averageBillValuePaisa || 0) / 100}</strong></div>
                <div>Monthly Rent: <strong>₹${((f.monthlyRentPaisa || 0) / 100).toLocaleString('en-IN')}</strong></div>
                <div>Initial CAPEX: <strong>₹${((f.initialCapexPaisa || 0) / 100000).toFixed(1)} L</strong></div>
              </div>

              <div style="border-top:1px solid var(--border-color,#334155);padding-top:10px;display:flex;flex-direction:column;gap:4px;font-size:12px;">
                <div style="display:flex;justify-content:space-between;">
                  <span style="color:var(--text-muted,#94a3b8);">Projected Monthly Net:</span>
                  <span style="font-weight:700;color:${(f.calculatedMetrics?.monthlyNetProfitPaisa || 0) >= 0 ? '#10b981' : '#f87171'};">
                    ₹${((f.calculatedMetrics?.monthlyNetProfitPaisa || 0) / 100).toLocaleString('en-IN')}/mo
                  </span>
                </div>
                <div style="display:flex;justify-content:space-between;">
                  <span style="color:var(--text-muted,#94a3b8);">Break-Even Footfall:</span>
                  <span style="font-weight:700;color:#60a5fa;">${f.calculatedMetrics?.breakEvenBillsPerDay || 0} bills/day</span>
                </div>
                <div style="display:flex;justify-content:space-between;">
                  <span style="color:var(--text-muted,#94a3b8);">Capital Payback:</span>
                  <span style="font-weight:700;color:#fbbf24;">
                    ${f.calculatedMetrics?.paybackMonths !== null ? `${f.calculatedMetrics?.paybackMonths} Months` : f.calculatedMetrics?.paybackStatus}
                  </span>
                </div>
              </div>
            </div>
          `)
            .join('')}
        </div>
      `}
    </div>
  `;

  document.getElementById('op-btn-add-fsb')?.addEventListener('click', openCalculateFeasibilityModal);
}

// -----------------------------------------------------------------------------
// MODALS
// -----------------------------------------------------------------------------

function openCreateBudgetModal() {
  const content = `
    <div style="display:flex;flex-direction:column;gap:14px;">
      <div>
        <label class="form-label" style="font-size:12px;font-weight:700;color:var(--text-muted,#94a3b8);">Fiscal Year *</label>
        <input id="m-bdg-fy" type="text" class="form-control" value="FY2026-27" style="width:100%;padding:8px;border-radius:6px;background:#1e293b;color:#fff;border:1px solid #334155;" />
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
        <div>
          <label class="form-label" style="font-size:12px;font-weight:700;color:var(--text-muted,#94a3b8);">Sales Target (₹) *</label>
          <input id="m-bdg-sales" type="number" value="5000000" class="form-control" style="width:100%;padding:8px;border-radius:6px;background:#1e293b;color:#fff;border:1px solid #334155;" />
        </div>
        <div>
          <label class="form-label" style="font-size:12px;font-weight:700;color:var(--text-muted,#94a3b8);">Payroll Budget (₹) *</label>
          <input id="m-bdg-payroll" type="number" value="1200000" class="form-control" style="width:100%;padding:8px;border-radius:6px;background:#1e293b;color:#fff;border:1px solid #334155;" />
        </div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
        <div>
          <label class="form-label" style="font-size:12px;font-weight:700;color:var(--text-muted,#94a3b8);">Operating Expenses (₹)</label>
          <input id="m-bdg-opex" type="number" value="800000" class="form-control" style="width:100%;padding:8px;border-radius:6px;background:#1e293b;color:#fff;border:1px solid #334155;" />
        </div>
        <div>
          <label class="form-label" style="font-size:12px;font-weight:700;color:var(--text-muted,#94a3b8);">Procurement / COGS (₹)</label>
          <input id="m-bdg-proc" type="number" value="1600000" class="form-control" style="width:100%;padding:8px;border-radius:6px;background:#1e293b;color:#fff;border:1px solid #334155;" />
        </div>
      </div>

      <button id="m-btn-save-bdg" class="btn btn-primary" style="margin-top:10px;padding:10px;border-radius:6px;font-weight:700;background:var(--gold-500,#96733a);color:#fff;border:none;">
        Create Budget Plan
      </button>
    </div>
  `;

  openModal('Create Annual Budget Plan', content);

  document.getElementById('m-btn-save-bdg')?.addEventListener('click', async () => {
    const fiscalYear = document.getElementById('m-bdg-fy')?.value;
    const sales = Number(document.getElementById('m-bdg-sales')?.value || 0);
    const payroll = Number(document.getElementById('m-bdg-payroll')?.value || 0);
    const opex = Number(document.getElementById('m-bdg-opex')?.value || 0);
    const proc = Number(document.getElementById('m-bdg-proc')?.value || 0);

    try {
      await apiPost('/planning/budgets', {
        fiscalYear,
        lines: [
          { category: 'SALES', plannedAmountPaisa: sales * 100 },
          { category: 'PAYROLL', plannedAmountPaisa: payroll * 100 },
          { category: 'OPERATING_EXPENSES', plannedAmountPaisa: opex * 100 },
          { category: 'PROCUREMENT', plannedAmountPaisa: proc * 100 },
        ],
      });
      showToast('Budget created successfully', 'success');
      closeModal();
      loadActiveSection();
    } catch (err) {
      showToast(err.message || 'Failed to create budget', 'error');
    }
  });
}

function openGenerateForecastModal() {
  const content = `
    <div style="display:flex;flex-direction:column;gap:14px;">
      <div>
        <label class="form-label" style="font-size:12px;font-weight:700;color:var(--text-muted,#94a3b8);">Fiscal Year</label>
        <input id="m-fcst-fy" type="text" class="form-control" value="FY2026-27" style="width:100%;padding:8px;border-radius:6px;background:#1e293b;color:#fff;border:1px solid #334155;" />
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
        <div>
          <label class="form-label" style="font-size:12px;font-weight:700;color:var(--text-muted,#94a3b8);">Revenue Growth (%)</label>
          <input id="m-fcst-growth" type="number" value="6" class="form-control" style="width:100%;padding:8px;border-radius:6px;background:#1e293b;color:#fff;border:1px solid #334155;" />
        </div>
        <div>
          <label class="form-label" style="font-size:12px;font-weight:700;color:var(--text-muted,#94a3b8);">Inflation Assumption (%)</label>
          <input id="m-fcst-inflation" type="number" value="4" class="form-control" style="width:100%;padding:8px;border-radius:6px;background:#1e293b;color:#fff;border:1px solid #334155;" />
        </div>
      </div>

      <button id="m-btn-run-fcst" class="btn btn-primary" style="margin-top:10px;padding:10px;border-radius:6px;font-weight:700;background:#3b82f6;color:#fff;border:none;">
        Compute Deterministic Forecast
      </button>
    </div>
  `;

  openModal('Generate Rolling Forecast', content);

  document.getElementById('m-btn-run-fcst')?.addEventListener('click', async () => {
    const fiscalYear = document.getElementById('m-fcst-fy')?.value;
    const growthPct = Number(document.getElementById('m-fcst-growth')?.value || 5);
    const inflationPct = Number(document.getElementById('m-fcst-inflation')?.value || 3);

    try {
      await apiPost('/planning/forecasts/generate', {
        fiscalYear,
        growthPct,
        inflationPct,
      });
      showToast('Forecast generated', 'success');
      closeModal();
      loadActiveSection();
    } catch (err) {
      showToast(err.message || 'Failed to generate forecast', 'error');
    }
  });
}

function openRunScenarioModal() {
  const content = `
    <div style="display:flex;flex-direction:column;gap:14px;">
      <div>
        <label class="form-label" style="font-size:12px;font-weight:700;color:var(--text-muted,#94a3b8);">Scenario Name *</label>
        <input id="m-scn-name" type="text" class="form-control" placeholder="e.g. 10% Food Cost Spike Scenario" style="width:100%;padding:8px;border-radius:6px;background:#1e293b;color:#fff;border:1px solid #334155;" />
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
        <div>
          <label class="form-label" style="font-size:12px;font-weight:700;color:var(--text-muted,#94a3b8);">Revenue Change (%)</label>
          <input id="m-scn-rev" type="number" value="-5" class="form-control" style="width:100%;padding:8px;border-radius:6px;background:#1e293b;color:#fff;border:1px solid #334155;" />
        </div>
        <div>
          <label class="form-label" style="font-size:12px;font-weight:700;color:var(--text-muted,#94a3b8);">Food Cost Change (%)</label>
          <input id="m-scn-food" type="number" value="10" class="form-control" style="width:100%;padding:8px;border-radius:6px;background:#1e293b;color:#fff;border:1px solid #334155;" />
        </div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
        <div>
          <label class="form-label" style="font-size:12px;font-weight:700;color:var(--text-muted,#94a3b8);">Wage Change (%)</label>
          <input id="m-scn-wage" type="number" value="5" class="form-control" style="width:100%;padding:8px;border-radius:6px;background:#1e293b;color:#fff;border:1px solid #334155;" />
        </div>
        <div>
          <label class="form-label" style="font-size:12px;font-weight:700;color:var(--text-muted,#94a3b8);">Rent Increase (₹)</label>
          <input id="m-scn-rent" type="number" value="25000" class="form-control" style="width:100%;padding:8px;border-radius:6px;background:#1e293b;color:#fff;border:1px solid #334155;" />
        </div>
      </div>

      <button id="m-btn-run-scn" class="btn btn-primary" style="margin-top:10px;padding:10px;border-radius:6px;font-weight:700;background:#10b981;color:#fff;border:none;">
        Simulate Sandbox
      </button>
    </div>
  `;

  openModal('Run What-If Sandbox Simulation', content);

  document.getElementById('m-btn-run-scn')?.addEventListener('click', async () => {
    const name = document.getElementById('m-scn-name')?.value;
    const rev = Number(document.getElementById('m-scn-rev')?.value || 0);
    const food = Number(document.getElementById('m-scn-food')?.value || 0);
    const wage = Number(document.getElementById('m-scn-wage')?.value || 0);
    const rent = Number(document.getElementById('m-scn-rent')?.value || 0);

    if (!name) {
      showToast('Scenario name is required', 'error');
      return;
    }

    try {
      await apiPost('/planning/scenarios/run', {
        name,
        assumptions: {
          revenueChangePct: rev,
          foodCostChangePct: food,
          wageChangePct: wage,
          rentChangePaisa: rent * 100,
        },
      });
      showToast('Scenario simulated', 'success');
      closeModal();
      loadActiveSection();
    } catch (err) {
      showToast(err.message || 'Failed to simulate scenario', 'error');
    }
  });
}

function openCreateCapexModal() {
  const content = `
    <div style="display:flex;flex-direction:column;gap:14px;">
      <div>
        <label class="form-label" style="font-size:12px;font-weight:700;color:var(--text-muted,#94a3b8);">Asset / Project Title *</label>
        <input id="m-cpx-title" type="text" class="form-control" placeholder="e.g. Commercial Espresso Machine Replacement" style="width:100%;padding:8px;border-radius:6px;background:#1e293b;color:#fff;border:1px solid #334155;" />
      </div>

      <div>
        <label class="form-label" style="font-size:12px;font-weight:700;color:var(--text-muted,#94a3b8);">Category *</label>
        <select id="m-cpx-cat" class="form-select" style="width:100%;padding:8px;border-radius:6px;background:#1e293b;color:#fff;border:1px solid #334155;">
          <option value="KITCHEN_EQUIPMENT">Kitchen Equipment</option>
          <option value="HVAC_REFRIGERATION">HVAC & Refrigeration</option>
          <option value="IT_POS_HARDWARE">IT & POS Hardware</option>
          <option value="FURNITURE_FITOUT">Furniture & Fitout</option>
          <option value="FACILITY_IMPROVEMENT">Facility Improvement</option>
        </select>
      </div>

      <div>
        <label class="form-label" style="font-size:12px;font-weight:700;color:var(--text-muted,#94a3b8);">Estimated Cost (₹) *</label>
        <input id="m-cpx-cost" type="number" value="350000" class="form-control" style="width:100%;padding:8px;border-radius:6px;background:#1e293b;color:#fff;border:1px solid #334155;" />
      </div>

      <div>
        <label class="form-label" style="font-size:12px;font-weight:700;color:var(--text-muted,#94a3b8);">Business Purpose & Justification *</label>
        <textarea id="m-cpx-purpose" class="form-control" rows="2" style="width:100%;padding:8px;border-radius:6px;background:#1e293b;color:#fff;border:1px solid #334155;"></textarea>
      </div>

      <button id="m-btn-save-cpx" class="btn btn-primary" style="margin-top:10px;padding:10px;border-radius:6px;font-weight:700;background:var(--gold-500,#96733a);color:#fff;border:none;">
        Submit CAPEX Request
      </button>
    </div>
  `;

  openModal('Submit Capital Expenditure Request', content);

  document.getElementById('m-btn-save-cpx')?.addEventListener('click', async () => {
    const title = document.getElementById('m-cpx-title')?.value;
    const category = document.getElementById('m-cpx-cat')?.value;
    const cost = Number(document.getElementById('m-cpx-cost')?.value || 0);
    const purpose = document.getElementById('m-cpx-purpose')?.value;

    if (!title || !purpose || cost <= 0) {
      showToast('Title, purpose, and valid cost are required', 'error');
      return;
    }

    try {
      await apiPost('/planning/capex', {
        cafeId: selectedCafe !== 'ALL' ? selectedCafe : '',
        title,
        category,
        estimatedCostPaisa: cost * 100,
        purpose,
        expectedBenefits: 'Improves coffee extraction speed and reliability',
      });
      showToast('CAPEX submitted', 'success');
      closeModal();
      loadActiveSection();
    } catch (err) {
      showToast(err.message || 'Failed to submit CAPEX', 'error');
    }
  });
}

async function approveCapex(requestId) {
  confirmAction('Approve this Capital Expenditure request for purchase order issuance?', async () => {
    try {
      await apiPost(`/planning/capex/${requestId}/approve`, {
        approvalNotes: 'Approved during Executive Governance Review',
      });
      showToast('CAPEX approved', 'success');
      loadActiveSection();
    } catch (err) {
      showToast(err.message || 'Approval failed', 'error');
    }
  });
}

function openCalculateFeasibilityModal() {
  const content = `
    <div style="display:flex;flex-direction:column;gap:14px;">
      <div>
        <label class="form-label" style="font-size:12px;font-weight:700;color:var(--text-muted,#94a3b8);">Proposed Outlet Name *</label>
        <input id="m-fsb-name" type="text" class="form-control" placeholder="e.g. Zamorin Cyber Hub Outlet" style="width:100%;padding:8px;border-radius:6px;background:#1e293b;color:#fff;border:1px solid #334155;" />
      </div>

      <div>
        <label class="form-label" style="font-size:12px;font-weight:700;color:var(--text-muted,#94a3b8);">Location Description *</label>
        <input id="m-fsb-loc" type="text" class="form-control" placeholder="e.g. Ground Floor, Building 14" style="width:100%;padding:8px;border-radius:6px;background:#1e293b;color:#fff;border:1px solid #334155;" />
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
        <div>
          <label class="form-label" style="font-size:12px;font-weight:700;color:var(--text-muted,#94a3b8);">Expected Bills / Day *</label>
          <input id="m-fsb-bills" type="number" value="250" class="form-control" style="width:100%;padding:8px;border-radius:6px;background:#1e293b;color:#fff;border:1px solid #334155;" />
        </div>
        <div>
          <label class="form-label" style="font-size:12px;font-weight:700;color:var(--text-muted,#94a3b8);">Avg Bill Value (₹) *</label>
          <input id="m-fsb-abv" type="number" value="380" class="form-control" style="width:100%;padding:8px;border-radius:6px;background:#1e293b;color:#fff;border:1px solid #334155;" />
        </div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
        <div>
          <label class="form-label" style="font-size:12px;font-weight:700;color:var(--text-muted,#94a3b8);">Monthly Rent (₹) *</label>
          <input id="m-fsb-rent" type="number" value="220000" class="form-control" style="width:100%;padding:8px;border-radius:6px;background:#1e293b;color:#fff;border:1px solid #334155;" />
        </div>
        <div>
          <label class="form-label" style="font-size:12px;font-weight:700;color:var(--text-muted,#94a3b8);">Initial CAPEX (₹) *</label>
          <input id="m-fsb-capex" type="number" value="4500000" class="form-control" style="width:100%;padding:8px;border-radius:6px;background:#1e293b;color:#fff;border:1px solid #334155;" />
        </div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
        <div>
          <label class="form-label" style="font-size:12px;font-weight:700;color:var(--text-muted,#94a3b8);">Monthly Payroll (₹) *</label>
          <input id="m-fsb-pay" type="number" value="320000" class="form-control" style="width:100%;padding:8px;border-radius:6px;background:#1e293b;color:#fff;border:1px solid #334155;" />
        </div>
        <div>
          <label class="form-label" style="font-size:12px;font-weight:700;color:var(--text-muted,#94a3b8);">Food Cost Target (%)</label>
          <input id="m-fsb-food" type="number" value="32" class="form-control" style="width:100%;padding:8px;border-radius:6px;background:#1e293b;color:#fff;border:1px solid #334155;" />
        </div>
      </div>

      <button id="m-btn-run-fsb" class="btn btn-primary" style="margin-top:10px;padding:10px;border-radius:6px;font-weight:700;background:#8b5cf6;color:#fff;border:none;">
        Compute Outlet Feasibility
      </button>
    </div>
  `;

  openModal('New Outlet Feasibility Study', content);

  document.getElementById('m-btn-run-fsb')?.addEventListener('click', async () => {
    const name = document.getElementById('m-fsb-name')?.value;
    const loc = document.getElementById('m-fsb-loc')?.value;
    const bills = Number(document.getElementById('m-fsb-bills')?.value || 0);
    const abv = Number(document.getElementById('m-fsb-abv')?.value || 0);
    const rent = Number(document.getElementById('m-fsb-rent')?.value || 0);
    const capex = Number(document.getElementById('m-fsb-capex')?.value || 0);
    const pay = Number(document.getElementById('m-fsb-pay')?.value || 0);
    const food = Number(document.getElementById('m-fsb-food')?.value || 32);

    if (!name || !loc || bills <= 0 || abv <= 0) {
      showToast('Name, location, bills/day, and ABV are required', 'error');
      return;
    }

    try {
      await apiPost('/planning/feasibility', {
        outletName: name,
        proposedLocation: loc,
        expectedBillsPerDay: bills,
        averageBillValuePaisa: abv * 100,
        monthlyRentPaisa: rent * 100,
        initialCapexPaisa: capex * 100,
        monthlyPayrollPaisa: pay * 100,
        foodCostPercentage: food,
      });
      showToast('Feasibility study computed', 'success');
      closeModal();
      loadActiveSection();
    } catch (err) {
      showToast(err.message || 'Failed to compute study', 'error');
    }
  });
}
