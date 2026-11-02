// =============================================================================
// ZAMORIN CAFÉ ERP — OWNER RISK, INTERNAL AUDIT & FRAUD CONTROL CENTRE
// Stage 02 Strategic Expansion Workspace
// =============================================================================

import { apiGet, apiPost } from '../apiClient.js';
import { showToast, skeleton, openModal, closeModal, confirmAction } from '../components.js';
import { state } from '../state.js';
import { icon } from '../icons.js';

let activeSection = 'overview';
let cachedData = {
  overview: null,
  risks: [],
  controls: [],
  audits: [],
  observations: [],
  anomalies: [],
};
let selectedCafe = 'ALL';

export function setOwnerRiskAuditSection(sec) {
  activeSection = sec || 'overview';
}

export function renderOwnerRiskAudit() {
  return `
    <div class="page-enter owner-risk-audit-workspace" style="display:flex;flex-direction:column;gap:20px;padding-bottom:60px;">
      <!-- Header -->
      <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:16px;">
        <div>
          <div style="display:inline-flex;align-items:center;gap:6px;padding:4px 10px;background:rgba(239,68,68,0.12);border:1px solid rgba(239,68,68,0.3);border-radius:20px;font-size:11px;font-weight:700;color:#f87171;letter-spacing:0.5px;margin-bottom:8px;">
            <span style="width:6px;height:6px;border-radius:50%;background:#ef4444;"></span>
            OWNER STRATEGIC EXPANSION · STAGE 02
          </div>
          <h1 style="font-size:24px;font-weight:800;color:var(--text-primary,#fff);margin:0 0 4px 0;letter-spacing:-0.5px;">
            Owner Risk, Internal Audit & Fraud Control Centre
          </h1>
          <div style="font-size:13px;color:var(--text-muted,#94a3b8);">
            Enterprise Risk Register · 5x5 Heat Map · Control Library · Governed Audit Findings · Non-Accusatory Anomaly Review
          </div>
        </div>

        <div style="display:flex;gap:10px;align-items:center;">
          <!-- Cafe Scope Filter -->
          <select id="ora-cafe-filter" class="form-select" style="background:var(--surface-card,#1e293b);color:var(--text-primary,#fff);border:1px solid var(--border-color,#334155);padding:8px 12px;border-radius:8px;font-size:13px;font-weight:600;">
            <option value="ALL">All Authorized Cafés</option>
            ${(state.currentUser?.assignedCafeIds || [])
              .map((c) => `<option value="${c}" ${selectedCafe === c ? 'selected' : ''}>${c}</option>`)
              .join('')}
          </select>

          <!-- Action Buttons -->
          <button id="ora-btn-new-risk" class="btn btn-primary" style="display:inline-flex;align-items:center;gap:6px;padding:8px 14px;background:var(--gold-500,#96733a);color:#fff;border:none;border-radius:8px;font-size:13px;font-weight:700;">
            ${icon('shield')} Register Risk
          </button>
          <button id="ora-btn-new-finding" class="btn btn-secondary" style="display:inline-flex;align-items:center;gap:6px;padding:8px 14px;border-radius:8px;font-size:13px;font-weight:600;">
            ${icon('alert')} Log Audit Finding
          </button>
        </div>
      </div>

      <!-- Navigation Tabs -->
      <div style="display:flex;gap:8px;border-bottom:1px solid var(--border-color,#334155);overflow-x:auto;padding-bottom:8px;" class="custom-scrollbar">
        ${[
          { id: 'overview', label: 'Executive Heat Map', icon: 'home' },
          { id: 'risks', label: 'Enterprise Risks', icon: 'shield' },
          { id: 'controls', label: 'Control Library', icon: 'quality' },
          { id: 'audits', label: 'Internal Audit Plans', icon: 'tasks' },
          { id: 'observations', label: 'Observations & Findings', icon: 'alert' },
          { id: 'anomalies', label: 'Anomaly Review (Safe)', icon: 'settings' },
        ]
          .map(
            (t) => `
            <button class="ora-tab-btn ${activeSection === t.id ? 'active' : ''}" data-tab="${t.id}"
              style="display:inline-flex;align-items:center;gap:8px;padding:8px 16px;border-radius:8px;font-size:13px;font-weight:700;white-space:nowrap;border:none;cursor:pointer;background:${activeSection === t.id ? 'var(--gold-500, #96733a)' : 'transparent'};color:${activeSection === t.id ? '#fff' : 'var(--text-muted,#94a3b8)'};">
              ${icon(t.icon)} ${t.label}
            </button>
          `
          )
          .join('')}
      </div>

      <!-- Main Content Container -->
      <div id="ora-main-content">
        ${skeleton('400px')}
      </div>
    </div>
  `;
}

export function wireOwnerRiskAudit() {
  const container = document.getElementById('ora-main-content');
  if (!container) return;

  // Cafe filter change
  const cafeFilter = document.getElementById('ora-cafe-filter');
  if (cafeFilter) {
    cafeFilter.addEventListener('change', (e) => {
      selectedCafe = e.target.value;
      loadActiveSection();
    });
  }

  // Tab buttons
  document.querySelectorAll('.ora-tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      activeSection = btn.dataset.tab;
      document.querySelectorAll('.ora-tab-btn').forEach((b) => {
        const isActive = b.dataset.tab === activeSection;
        b.style.background = isActive ? 'var(--gold-500, #96733a)' : 'transparent';
        b.style.color = isActive ? '#fff' : 'var(--text-muted,#94a3b8)';
      });
      loadActiveSection();
    });
  });

  // Action buttons
  const btnNewRisk = document.getElementById('ora-btn-new-risk');
  if (btnNewRisk) {
    btnNewRisk.addEventListener('click', openRegisterRiskModal);
  }

  const btnNewFinding = document.getElementById('ora-btn-new-finding');
  if (btnNewFinding) {
    btnNewFinding.addEventListener('click', openLogFindingModal);
  }

  loadActiveSection();
}

async function loadActiveSection() {
  const container = document.getElementById('ora-main-content');
  if (!container) return;
  container.innerHTML = skeleton('350px');

  try {
    const cafeParam = selectedCafe !== 'ALL' ? `?cafeId=${selectedCafe}` : '';

    if (activeSection === 'overview') {
      const res = await apiGet(`/risk-audit/dashboard${cafeParam}`);
      cachedData.overview = res?.data || null;
      renderOverviewTab(container);
    } else if (activeSection === 'risks') {
      const res = await apiGet(`/risk-audit/risks${cafeParam}`);
      cachedData.risks = res?.data || [];
      renderRisksTab(container);
    } else if (activeSection === 'controls') {
      const res = await apiGet(`/risk-audit/controls${cafeParam}`);
      cachedData.controls = res?.data || [];
      renderControlsTab(container);
    } else if (activeSection === 'audits') {
      renderAuditsTab(container);
    } else if (activeSection === 'observations') {
      const res = await apiGet(`/risk-audit/observations${cafeParam}`);
      cachedData.observations = res?.data || [];
      renderObservationsTab(container);
    } else if (activeSection === 'anomalies') {
      const res = await apiGet(`/risk-audit/anomalies${cafeParam}`);
      cachedData.anomalies = res?.data || [];
      renderAnomaliesTab(container);
    }
  } catch (err) {
    container.innerHTML = `
      <div style="padding:40px;text-align:center;background:var(--surface-card,#1e293b);border-radius:12px;border:1px solid var(--border-color,#334155);">
        <div style="font-size:18px;font-weight:700;color:#f87171;margin-bottom:8px;">Failed to load risk & audit data</div>
        <div style="font-size:13px;color:var(--text-muted,#94a3b8);">${err.message || 'Server error'}</div>
        <div style="margin-top:16px;">
          <button class="btn btn-secondary" onclick="window.location.reload();">Retry</button>
        </div>
      </div>
    `;
  }
}

// -----------------------------------------------------------------------------
// TAB 1: EXECUTIVE OVERVIEW & 5x5 HEAT MAP
// -----------------------------------------------------------------------------
function renderOverviewTab(container) {
  const d = cachedData.overview;
  if (!d) {
    container.innerHTML = `<div style="padding:20px;text-align:center;">No data available</div>`;
    return;
  }

  // Build 5x5 Heat Map Grid
  // Rows: Likelihood (5 down to 1)
  // Cols: Impact (1 across to 5)
  let heatMapHtml = '';
  for (let l = 5; l >= 1; l--) {
    let cellsHtml = '';
    for (let i = 1; i <= 5; i++) {
      const cell = d.heatMap?.find((c) => c.likelihood === l && c.impact === i) || { count: 0, score: l * i };
      let bg = 'rgba(16, 185, 129, 0.15)';
      let textColor = '#10b981';
      if (cell.score >= 15) {
        bg = 'rgba(239, 68, 68, 0.25)';
        textColor = '#f87171';
      } else if (cell.score >= 10) {
        bg = 'rgba(245, 158, 11, 0.25)';
        textColor = '#fbbf24';
      } else if (cell.score >= 5) {
        bg = 'rgba(59, 130, 246, 0.2)';
        textColor = '#60a5fa';
      }

      cellsHtml += `
        <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:45px;background:${bg};border-radius:6px;font-weight:700;color:${textColor};font-size:13px;border:1px solid rgba(255,255,255,0.05);">
          <span>${cell.count > 0 ? cell.count : '—'}</span>
          <span style="font-size:9px;opacity:0.7;">${l}x${i}</span>
        </div>
      `;
    }
    heatMapHtml += `
      <div style="display:grid;grid-template-columns:50px repeat(5, 1fr);gap:6px;margin-bottom:6px;align-items:center;">
        <div style="font-size:11px;font-weight:700;color:var(--text-muted,#94a3b8);text-align:right;padding-right:8px;">L${l}</div>
        ${cellsHtml}
      </div>
    `;
  }

  container.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:20px;">
      <!-- KPI Cards -->
      <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(200px, 1fr));gap:14px;">
        <div style="background:var(--surface-card,#1e293b);padding:16px;border-radius:10px;border:1px solid var(--border-color,#334155);">
          <div style="font-size:11px;font-weight:700;color:var(--text-muted,#94a3b8);text-transform:uppercase;">Total Risks</div>
          <div style="font-size:24px;font-weight:800;color:#fff;margin-top:4px;">${d.totalRisks || 0}</div>
        </div>
        <div style="background:var(--surface-card,#1e293b);padding:16px;border-radius:10px;border:1px solid var(--border-color,#334155);">
          <div style="font-size:11px;font-weight:700;color:#f87171;text-transform:uppercase;">Critical Residual Risks</div>
          <div style="font-size:24px;font-weight:800;color:#ef4444;margin-top:4px;">${d.criticalRisks || 0}</div>
        </div>
        <div style="background:var(--surface-card,#1e293b);padding:16px;border-radius:10px;border:1px solid var(--border-color,#334155);">
          <div style="font-size:11px;font-weight:700;color:var(--text-muted,#94a3b8);text-transform:uppercase;">Controls Library</div>
          <div style="font-size:24px;font-weight:800;color:#10b981;margin-top:4px;">${d.totalControls || 0}</div>
          <div style="font-size:10px;color:var(--text-muted,#94a3b8);margin-top:2px;">${d.controlEffectiveness?.EFFECTIVE || 0} fully effective</div>
        </div>
        <div style="background:var(--surface-card,#1e293b);padding:16px;border-radius:10px;border:1px solid var(--border-color,#334155);">
          <div style="font-size:11px;font-weight:700;color:var(--text-muted,#94a3b8);text-transform:uppercase;">Open Audit Findings</div>
          <div style="font-size:24px;font-weight:800;color:#f59e0b;margin-top:4px;">${d.totalOpenFindings || 0}</div>
          <div style="font-size:10px;color:#f87171;margin-top:2px;">${d.overdueFindings || 0} overdue</div>
        </div>
        <div style="background:var(--surface-card,#1e293b);padding:16px;border-radius:10px;border:1px solid var(--border-color,#334155);">
          <div style="font-size:11px;font-weight:700;color:var(--text-muted,#94a3b8);text-transform:uppercase;">Active Anomaly Indicators</div>
          <div style="font-size:24px;font-weight:800;color:#818cf8;margin-top:4px;">${d.activeAnomaliesCount || 0}</div>
          <div style="font-size:10px;color:var(--text-muted,#94a3b8);margin-top:2px;">Human review queue</div>
        </div>
      </div>

      <!-- Main Layout: Heat Map on left, Highlights on right -->
      <div style="display:grid;grid-template-columns:1.2fr 1fr;gap:20px;align-items:start;">
        <!-- Heat Map -->
        <div style="background:var(--surface-card,#1e293b);padding:20px;border-radius:12px;border:1px solid var(--border-color,#334155);">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
            <h3 style="font-size:15px;font-weight:700;color:#fff;margin:0;">5x5 Residual Risk Heat Map</h3>
            <span style="font-size:11px;color:var(--text-muted,#94a3b8);">Configured Matrix Methodology</span>
          </div>

          <div style="margin-bottom:12px;">
            ${heatMapHtml}
            <div style="display:grid;grid-template-columns:50px repeat(5, 1fr);gap:6px;text-align:center;font-size:11px;font-weight:700;color:var(--text-muted,#94a3b8);margin-top:4px;">
              <div></div>
              <div>I1</div><div>I2</div><div>I3</div><div>I4</div><div>I5</div>
            </div>
          </div>

          <div style="display:flex;justify-content:center;gap:14px;font-size:11px;color:var(--text-muted,#94a3b8);margin-top:14px;border-top:1px solid var(--border-color,#334155);padding-top:10px;">
            <span style="display:inline-flex;align-items:center;gap:4px;"><span style="width:10px;height:10px;border-radius:2px;background:#10b981;"></span> Low (1-4)</span>
            <span style="display:inline-flex;align-items:center;gap:4px;"><span style="width:10px;height:10px;border-radius:2px;background:#3b82f6;"></span> Medium (5-9)</span>
            <span style="display:inline-flex;align-items:center;gap:4px;"><span style="width:10px;height:10px;border-radius:2px;background:#f59e0b;"></span> High (10-14)</span>
            <span style="display:inline-flex;align-items:center;gap:4px;"><span style="width:10px;height:10px;border-radius:2px;background:#ef4444;"></span> Critical (15-25)</span>
          </div>
        </div>

        <!-- Recent Critical Risks & Anomalies -->
        <div style="display:flex;flex-direction:column;gap:16px;">
          <!-- Critical Risks -->
          <div style="background:var(--surface-card,#1e293b);padding:18px;border-radius:12px;border:1px solid var(--border-color,#334155);">
            <h3 style="font-size:14px;font-weight:700;color:#fff;margin:0 0 12px 0;">Top Critical Risks</h3>
            ${(d.recentCriticalRisks || []).length === 0
              ? `<div style="font-size:12px;color:var(--text-muted,#94a3b8);">No critical residual risks registered.</div>`
              : (d.recentCriticalRisks || [])
                  .map(
                    (r) => `
                <div style="padding:10px;background:rgba(239,68,68,0.08);border-left:3px solid #ef4444;border-radius:4px;margin-bottom:8px;">
                  <div style="display:flex;justify-content:space-between;align-items:center;">
                    <span style="font-weight:700;font-size:12px;color:#fff;">${r.riskId}: ${r.title}</span>
                    <span style="font-size:11px;font-weight:700;color:#f87171;">Score ${r.residualRisk?.score}</span>
                  </div>
                  <div style="font-size:11px;color:var(--text-muted,#94a3b8);margin-top:4px;">Domain: ${r.riskDomain} · Treatment: ${r.treatment}</div>
                </div>
              `
                  )
                  .join('')}
          </div>

          <!-- Active Anomalies -->
          <div style="background:var(--surface-card,#1e293b);padding:18px;border-radius:12px;border:1px solid var(--border-color,#334155);">
            <h3 style="font-size:14px;font-weight:700;color:#fff;margin:0 0 12px 0;">Pending Anomaly Investigations</h3>
            ${(d.recentAnomalies || []).length === 0
              ? `<div style="font-size:12px;color:var(--text-muted,#94a3b8);">No open anomaly indicators.</div>`
              : (d.recentAnomalies || [])
                  .map(
                    (a) => `
                <div style="padding:10px;background:rgba(59,130,246,0.08);border-left:3px solid #3b82f6;border-radius:4px;margin-bottom:8px;">
                  <div style="display:flex;justify-content:space-between;align-items:center;">
                    <span style="font-weight:700;font-size:12px;color:#fff;">${a.caseId}: ${a.title}</span>
                    <span style="font-size:10px;padding:2px 6px;border-radius:4px;background:#334155;color:#94a3b8;">${a.anomalyType}</span>
                  </div>
                  <div style="font-size:11px;color:var(--text-muted,#94a3b8);margin-top:4px;">Value: ₹${a.monetaryValue || 0} · Detected: ${new Date(a.detectedAt).toLocaleDateString()}</div>
                </div>
              `
                  )
                  .join('')}
          </div>
        </div>
      </div>
    </div>
  `;
}

// -----------------------------------------------------------------------------
// TAB 2: ENTERPRISE RISK REGISTER
// -----------------------------------------------------------------------------
function renderRisksTab(container) {
  const risks = cachedData.risks || [];

  container.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:16px;">
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;">
        <h2 style="font-size:16px;font-weight:700;color:#fff;margin:0;">Enterprise Risk Register (${risks.length})</h2>
        <button id="ora-btn-add-risk-inner" class="btn btn-primary btn-sm" style="background:var(--gold-500,#96733a);color:#fff;border:none;border-radius:6px;font-weight:700;">
          + New Risk
        </button>
      </div>

      ${risks.length === 0
        ? `
        <div style="padding:40px;text-align:center;background:var(--surface-card,#1e293b);border-radius:12px;border:1px solid var(--border-color,#334155);">
          <div style="font-size:15px;font-weight:700;color:var(--text-muted,#94a3b8);">No risks registered yet</div>
          <div style="font-size:12px;color:var(--text-muted,#64748b);margin-top:4px;">Capture enterprise risks across Financial, Food Safety, Operational, or Statutory domains.</div>
        </div>
      `
        : `
        <div style="background:var(--surface-card,#1e293b);border-radius:12px;border:1px solid var(--border-color,#334155);overflow-x:auto;">
          <table style="width:100%;border-collapse:collapse;font-size:13px;text-align:left;">
            <thead>
              <tr style="border-bottom:1px solid var(--border-color,#334155);color:var(--text-muted,#94a3b8);font-size:11px;text-transform:uppercase;">
                <th style="padding:12px 16px;">Risk ID & Title</th>
                <th style="padding:12px 16px;">Domain</th>
                <th style="padding:12px 16px;">Inherent Score</th>
                <th style="padding:12px 16px;">Residual Score</th>
                <th style="padding:12px 16px;">Treatment</th>
                <th style="padding:12px 16px;">Status</th>
                <th style="padding:12px 16px;">Next Review</th>
              </tr>
            </thead>
            <tbody>
              ${risks
                .map((r) => {
                  let badgeBg = '#10b981';
                  if (r.residualRisk?.rating === 'CRITICAL') badgeBg = '#ef4444';
                  else if (r.residualRisk?.rating === 'HIGH') badgeBg = '#f59e0b';
                  else if (r.residualRisk?.rating === 'MEDIUM') badgeBg = '#3b82f6';

                  return `
                  <tr style="border-bottom:1px solid rgba(255,255,255,0.05);">
                    <td style="padding:12px 16px;">
                      <div style="font-weight:700;color:#fff;">${r.riskId}</div>
                      <div style="font-size:12px;color:var(--text-muted,#94a3b8);">${r.title}</div>
                    </td>
                    <td style="padding:12px 16px;color:var(--text-muted,#94a3b8);">${r.riskDomain}</td>
                    <td style="padding:12px 16px;">
                      <span style="font-weight:700;color:var(--text-muted,#94a3b8);">${r.inherentRisk?.score || 0} (${r.inherentRisk?.rating || 'LOW'})</span>
                    </td>
                    <td style="padding:12px 16px;">
                      <span style="display:inline-block;padding:2px 8px;border-radius:12px;font-size:11px;font-weight:700;background:${badgeBg};color:#fff;">
                        ${r.residualRisk?.score || 0} · ${r.residualRisk?.rating || 'LOW'}
                      </span>
                    </td>
                    <td style="padding:12px 16px;font-weight:600;color:#fff;">${r.treatment}</td>
                    <td style="padding:12px 16px;">
                      <span style="font-size:11px;padding:2px 6px;border-radius:4px;background:#334155;color:#94a3b8;">${r.status}</span>
                    </td>
                    <td style="padding:12px 16px;color:var(--text-muted,#94a3b8);font-size:12px;">
                      ${r.nextReviewDate ? new Date(r.nextReviewDate).toLocaleDateString() : '—'}
                    </td>
                  </tr>
                `;
                })
                .join('')}
            </tbody>
          </table>
        </div>
      `}
    </div>
  `;

  const btnAdd = document.getElementById('ora-btn-add-risk-inner');
  if (btnAdd) btnAdd.addEventListener('click', openRegisterRiskModal);
}

// -----------------------------------------------------------------------------
// TAB 3: CONTROL LIBRARY
// -----------------------------------------------------------------------------
function renderControlsTab(container) {
  const controls = cachedData.controls || [];

  container.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:16px;">
      <div style="display:flex;justify-content:space-between;align-items:center;">
        <h2 style="font-size:16px;font-weight:700;color:#fff;margin:0;">Control Library Items (${controls.length})</h2>
      </div>

      ${controls.length === 0
        ? `
        <div style="padding:40px;text-align:center;background:var(--surface-card,#1e293b);border-radius:12px;border:1px solid var(--border-color,#334155);">
          <div style="font-size:15px;font-weight:700;color:var(--text-muted,#94a3b8);">No controls configured in library</div>
          <div style="font-size:12px;color:var(--text-muted,#64748b);margin-top:4px;">Controls provide preventive, detective, and corrective operational assurance.</div>
        </div>
      `
        : `
        <div style="background:var(--surface-card,#1e293b);border-radius:12px;border:1px solid var(--border-color,#334155);overflow-x:auto;">
          <table style="width:100%;border-collapse:collapse;font-size:13px;text-align:left;">
            <thead>
              <tr style="border-bottom:1px solid var(--border-color,#334155);color:var(--text-muted,#94a3b8);font-size:11px;text-transform:uppercase;">
                <th style="padding:12px 16px;">Control ID & Title</th>
                <th style="padding:12px 16px;">Domain</th>
                <th style="padding:12px 16px;">Type</th>
                <th style="padding:12px 16px;">Frequency</th>
                <th style="padding:12px 16px;">Effectiveness</th>
                <th style="padding:12px 16px;">Last Tested</th>
              </tr>
            </thead>
            <tbody>
              ${controls
                .map((c) => {
                  let effColor = '#94a3b8';
                  if (c.effectiveness === 'EFFECTIVE') effColor = '#10b981';
                  else if (c.effectiveness === 'PARTIALLY_EFFECTIVE') effColor = '#f59e0b';
                  else if (c.effectiveness === 'INEFFECTIVE') effColor = '#ef4444';

                  return `
                  <tr style="border-bottom:1px solid rgba(255,255,255,0.05);">
                    <td style="padding:12px 16px;">
                      <div style="font-weight:700;color:#fff;">${c.controlId}</div>
                      <div style="font-size:12px;color:var(--text-muted,#94a3b8);">${c.title}</div>
                    </td>
                    <td style="padding:12px 16px;color:var(--text-muted,#94a3b8);">${c.controlDomain}</td>
                    <td style="padding:12px 16px;font-weight:600;color:#fff;">${c.controlType}</td>
                    <td style="padding:12px 16px;color:var(--text-muted,#94a3b8);">${c.frequency}</td>
                    <td style="padding:12px 16px;">
                      <span style="font-weight:700;color:${effColor};">${c.effectiveness}</span>
                    </td>
                    <td style="padding:12px 16px;color:var(--text-muted,#94a3b8);font-size:12px;">
                      ${c.lastTestedDate ? new Date(c.lastTestedDate).toLocaleDateString() : 'Never tested'}
                    </td>
                  </tr>
                `;
                })
                .join('')}
            </tbody>
          </table>
        </div>
      `}
    </div>
  `;
}

// -----------------------------------------------------------------------------
// TAB 4: INTERNAL AUDIT PLANS
// -----------------------------------------------------------------------------
function renderAuditsTab(container) {
  container.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:16px;">
      <h2 style="font-size:16px;font-weight:700;color:#fff;margin:0;">Internal Audit Plans & Work Programmes</h2>
      <div style="padding:40px;text-align:center;background:var(--surface-card,#1e293b);border-radius:12px;border:1px solid var(--border-color,#334155);">
        <div style="font-size:15px;font-weight:700;color:var(--text-muted,#94a3b8);">Audit Governance Programme Active</div>
        <div style="font-size:12px;color:var(--text-muted,#64748b);margin-top:4px;">Execute planned audit procedures across operational and statutory compliance domains.</div>
      </div>
    </div>
  `;
}

// -----------------------------------------------------------------------------
// TAB 5: AUDIT OBSERVATIONS & FINDINGS
// -----------------------------------------------------------------------------
function renderObservationsTab(container) {
  const obs = cachedData.observations || [];

  container.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:16px;">
      <div style="display:flex;justify-content:space-between;align-items:center;">
        <h2 style="font-size:16px;font-weight:700;color:#fff;margin:0;">Audit Observations & Findings (${obs.length})</h2>
        <button id="ora-btn-add-finding-inner" class="btn btn-primary btn-sm" style="background:#ef4444;color:#fff;border:none;border-radius:6px;font-weight:700;">
          + Log Finding
        </button>
      </div>

      ${obs.length === 0
        ? `
        <div style="padding:40px;text-align:center;background:var(--surface-card,#1e293b);border-radius:12px;border:1px solid var(--border-color,#334155);">
          <div style="font-size:15px;font-weight:700;color:var(--text-muted,#94a3b8);">No audit findings registered</div>
          <div style="font-size:12px;color:var(--text-muted,#64748b);margin-top:4px;">Observations track condition, criteria, root cause, and remediation lifecycle.</div>
        </div>
      `
        : `
        <div style="background:var(--surface-card,#1e293b);border-radius:12px;border:1px solid var(--border-color,#334155);overflow-x:auto;">
          <table style="width:100%;border-collapse:collapse;font-size:13px;text-align:left;">
            <thead>
              <tr style="border-bottom:1px solid var(--border-color,#334155);color:var(--text-muted,#94a3b8);font-size:11px;text-transform:uppercase;">
                <th style="padding:12px 16px;">Finding ID & Title</th>
                <th style="padding:12px 16px;">Audit Ref</th>
                <th style="padding:12px 16px;">Severity</th>
                <th style="padding:12px 16px;">Lifecycle Status</th>
                <th style="padding:12px 16px;">Owner</th>
                <th style="padding:12px 16px;">Target Closure</th>
              </tr>
            </thead>
            <tbody>
              ${obs
                .map((o) => `
                <tr style="border-bottom:1px solid rgba(255,255,255,0.05);">
                  <td style="padding:12px 16px;">
                    <div style="font-weight:700;color:#fff;">${o.findingId}</div>
                    <div style="font-size:12px;color:var(--text-muted,#94a3b8);">${o.title}</div>
                  </td>
                  <td style="padding:12px 16px;color:var(--text-muted,#94a3b8);">${o.auditId}</td>
                  <td style="padding:12px 16px;">
                    <span style="font-weight:700;color:${o.severity === 'CRITICAL' ? '#ef4444' : o.severity === 'HIGH' ? '#f59e0b' : '#3b82f6'};">${o.severity}</span>
                  </td>
                  <td style="padding:12px 16px;">
                    <span style="padding:2px 8px;border-radius:12px;font-size:11px;font-weight:700;background:${o.status === 'CLOSED' ? '#10b981' : '#334155'};color:#fff;">
                      ${o.status}
                    </span>
                  </td>
                  <td style="padding:12px 16px;color:var(--text-muted,#94a3b8);">${o.responsibleOwner || 'Unassigned'}</td>
                  <td style="padding:12px 16px;font-size:12px;color:var(--text-muted,#94a3b8);">
                    ${o.targetClosureDate ? new Date(o.targetClosureDate).toLocaleDateString() : '—'}
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

  const btnAdd = document.getElementById('ora-btn-add-finding-inner');
  if (btnAdd) btnAdd.addEventListener('click', openLogFindingModal);
}

// -----------------------------------------------------------------------------
// TAB 6: OPERATIONAL ANOMALY REVIEW (SAFE / NON-ACCUSATORY)
// -----------------------------------------------------------------------------
function renderAnomaliesTab(container) {
  const anomalies = cachedData.anomalies || [];

  container.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:16px;">
      <div style="display:flex;justify-content:space-between;align-items:center;">
        <div>
          <h2 style="font-size:16px;font-weight:700;color:#fff;margin:0;">Operational Anomaly Review Queue (${anomalies.length})</h2>
          <div style="font-size:12px;color:var(--text-muted,#94a3b8);margin-top:2px;">
            Absolute Policy Rule: System surfaces factual pattern indicators. Disciplinary actions or accusations are strictly human-governed.
          </div>
        </div>
      </div>

      ${anomalies.length === 0
        ? `
        <div style="padding:40px;text-align:center;background:var(--surface-card,#1e293b);border-radius:12px;border:1px solid var(--border-color,#334155);">
          <div style="font-size:15px;font-weight:700;color:var(--text-muted,#94a3b8);">No anomaly cases detected</div>
          <div style="font-size:12px;color:var(--text-muted,#64748b);margin-top:4px;">Continuous detectors check refunds, voids, discounts, and vendor variances.</div>
        </div>
      `
        : `
        <div style="background:var(--surface-card,#1e293b);border-radius:12px;border:1px solid var(--border-color,#334155);overflow-x:auto;">
          <table style="width:100%;border-collapse:collapse;font-size:13px;text-align:left;">
            <thead>
              <tr style="border-bottom:1px solid var(--border-color,#334155);color:var(--text-muted,#94a3b8);font-size:11px;text-transform:uppercase;">
                <th style="padding:12px 16px;">Case ID & Title</th>
                <th style="padding:12px 16px;">Type</th>
                <th style="padding:12px 16px;">Monetary Value</th>
                <th style="padding:12px 16px;">Detected</th>
                <th style="padding:12px 16px;">Review Status</th>
                <th style="padding:12px 16px;">Actions</th>
              </tr>
            </thead>
            <tbody>
              ${anomalies
                .map((a) => `
                <tr style="border-bottom:1px solid rgba(255,255,255,0.05);">
                  <td style="padding:12px 16px;">
                    <div style="font-weight:700;color:#fff;">${a.caseId}</div>
                    <div style="font-size:12px;color:var(--text-muted,#94a3b8);">${a.title}</div>
                  </td>
                  <td style="padding:12px 16px;color:var(--text-muted,#94a3b8);">${a.anomalyType}</td>
                  <td style="padding:12px 16px;font-weight:700;color:#fff;">₹${a.monetaryValue || 0}</td>
                  <td style="padding:12px 16px;font-size:12px;color:var(--text-muted,#94a3b8);">${new Date(a.detectedAt).toLocaleDateString()}</td>
                  <td style="padding:12px 16px;">
                    <span style="font-size:11px;padding:2px 8px;border-radius:12px;font-weight:700;background:#334155;color:#fff;">${a.reviewStatus}</span>
                  </td>
                  <td style="padding:12px 16px;">
                    <button class="btn btn-secondary btn-sm ora-btn-review-anomaly" data-id="${a.caseId}" style="padding:4px 8px;font-size:11px;font-weight:600;">
                      Review Case
                    </button>
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

  document.querySelectorAll('.ora-btn-review-anomaly').forEach((btn) => {
    btn.addEventListener('click', () => {
      openReviewAnomalyModal(btn.dataset.id);
    });
  });
}

// -----------------------------------------------------------------------------
// MODALS
// -----------------------------------------------------------------------------

function openRegisterRiskModal() {
  const content = `
    <div style="display:flex;flex-direction:column;gap:14px;">
      <div>
        <label class="form-label" style="font-size:12px;font-weight:700;color:var(--text-muted,#94a3b8);">Risk Domain *</label>
        <select id="m-risk-domain" class="form-select" style="width:100%;padding:8px;border-radius:6px;background:#1e293b;color:#fff;border:1px solid #334155;">
          <option value="FINANCIAL">Financial</option>
          <option value="CASH_TREASURY">Cash & Treasury</option>
          <option value="PROCUREMENT_SUPPLY">Procurement & Supply</option>
          <option value="PAYROLL_WORKFORCE">Payroll & Workforce</option>
          <option value="FOOD_SAFETY_HYGIENE">Food Safety & Hygiene</option>
          <option value="PEOPLE_OPERATIONS">People Operations</option>
          <option value="STATUTORY_COMPLIANCE">Statutory Compliance</option>
          <option value="OPERATIONAL_EXCELLENCE">Operational Excellence</option>
        </select>
      </div>

      <div>
        <label class="form-label" style="font-size:12px;font-weight:700;color:var(--text-muted,#94a3b8);">Title *</label>
        <input id="m-risk-title" type="text" class="form-control" placeholder="e.g. Supplier Cold-Chain Failure Risk" style="width:100%;padding:8px;border-radius:6px;background:#1e293b;color:#fff;border:1px solid #334155;" />
      </div>

      <div>
        <label class="form-label" style="font-size:12px;font-weight:700;color:var(--text-muted,#94a3b8);">Description</label>
        <textarea id="m-risk-desc" class="form-control" rows="2" style="width:100%;padding:8px;border-radius:6px;background:#1e293b;color:#fff;border:1px solid #334155;"></textarea>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
        <div>
          <label class="form-label" style="font-size:12px;font-weight:700;color:var(--text-muted,#94a3b8);">Inherent Likelihood (1-5)</label>
          <input id="m-risk-in-l" type="number" min="1" max="5" value="3" class="form-control" style="width:100%;padding:8px;border-radius:6px;background:#1e293b;color:#fff;border:1px solid #334155;" />
        </div>
        <div>
          <label class="form-label" style="font-size:12px;font-weight:700;color:var(--text-muted,#94a3b8);">Inherent Impact (1-5)</label>
          <input id="m-risk-in-i" type="number" min="1" max="5" value="4" class="form-control" style="width:100%;padding:8px;border-radius:6px;background:#1e293b;color:#fff;border:1px solid #334155;" />
        </div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
        <div>
          <label class="form-label" style="font-size:12px;font-weight:700;color:var(--text-muted,#94a3b8);">Residual Likelihood (1-5)</label>
          <input id="m-risk-res-l" type="number" min="1" max="5" value="2" class="form-control" style="width:100%;padding:8px;border-radius:6px;background:#1e293b;color:#fff;border:1px solid #334155;" />
        </div>
        <div>
          <label class="form-label" style="font-size:12px;font-weight:700;color:var(--text-muted,#94a3b8);">Residual Impact (1-5)</label>
          <input id="m-risk-res-i" type="number" min="1" max="5" value="3" class="form-control" style="width:100%;padding:8px;border-radius:6px;background:#1e293b;color:#fff;border:1px solid #334155;" />
        </div>
      </div>

      <div>
        <label class="form-label" style="font-size:12px;font-weight:700;color:var(--text-muted,#94a3b8);">Treatment Strategy</label>
        <select id="m-risk-treatment" class="form-select" style="width:100%;padding:8px;border-radius:6px;background:#1e293b;color:#fff;border:1px solid #334155;">
          <option value="MITIGATE">MITIGATE</option>
          <option value="ACCEPT">ACCEPT</option>
          <option value="AVOID">AVOID</option>
          <option value="TRANSFER">TRANSFER</option>
          <option value="MONITOR">MONITOR</option>
        </select>
      </div>

      <div>
        <label class="form-label" style="font-size:12px;font-weight:700;color:var(--text-muted,#94a3b8);">Treatment Plan</label>
        <textarea id="m-risk-plan" class="form-control" rows="2" placeholder="Document mitigation controls and procedures..." style="width:100%;padding:8px;border-radius:6px;background:#1e293b;color:#fff;border:1px solid #334155;"></textarea>
      </div>

      <button id="m-btn-save-risk" class="btn btn-primary" style="margin-top:10px;padding:10px;border-radius:6px;font-weight:700;background:var(--gold-500,#96733a);color:#fff;border:none;">
        Save Risk Record
      </button>
    </div>
  `;

  openModal('Register Enterprise Risk', content);

  document.getElementById('m-btn-save-risk')?.addEventListener('click', async () => {
    const domain = document.getElementById('m-risk-domain')?.value;
    const title = document.getElementById('m-risk-title')?.value;
    const description = document.getElementById('m-risk-desc')?.value;
    const inL = document.getElementById('m-risk-in-l')?.value;
    const inI = document.getElementById('m-risk-in-i')?.value;
    const resL = document.getElementById('m-risk-res-l')?.value;
    const resI = document.getElementById('m-risk-res-i')?.value;
    const treatment = document.getElementById('m-risk-treatment')?.value;
    const plan = document.getElementById('m-risk-plan')?.value;

    if (!title) {
      showToast('Title is required', 'error');
      return;
    }

    try {
      await apiPost('/risk-audit/risks', {
        riskDomain: domain,
        title,
        description,
        inherentLikelihood: Number(inL),
        inherentImpact: Number(inI),
        residualLikelihood: Number(resL),
        residualImpact: Number(resI),
        treatment,
        treatmentPlan: plan,
      });
      showToast('Risk registered successfully', 'success');
      closeModal();
      loadActiveSection();
    } catch (err) {
      showToast(err.message || 'Failed to register risk', 'error');
    }
  });
}

function openLogFindingModal() {
  const content = `
    <div style="display:flex;flex-direction:column;gap:14px;">
      <div>
        <label class="form-label" style="font-size:12px;font-weight:700;color:var(--text-muted,#94a3b8);">Audit Reference ID *</label>
        <input id="m-fnd-audit-id" type="text" class="form-control" value="AUD-0001" style="width:100%;padding:8px;border-radius:6px;background:#1e293b;color:#fff;border:1px solid #334155;" />
      </div>

      <div>
        <label class="form-label" style="font-size:12px;font-weight:700;color:var(--text-muted,#94a3b8);">Finding Title *</label>
        <input id="m-fnd-title" type="text" class="form-control" placeholder="e.g. Unverified Manual Ledger Adjustments" style="width:100%;padding:8px;border-radius:6px;background:#1e293b;color:#fff;border:1px solid #334155;" />
      </div>

      <div>
        <label class="form-label" style="font-size:12px;font-weight:700;color:var(--text-muted,#94a3b8);">Condition (Fact Observed) *</label>
        <textarea id="m-fnd-condition" class="form-control" rows="2" style="width:100%;padding:8px;border-radius:6px;background:#1e293b;color:#fff;border:1px solid #334155;"></textarea>
      </div>

      <div>
        <label class="form-label" style="font-size:12px;font-weight:700;color:var(--text-muted,#94a3b8);">Criteria (Standard / Policy)</label>
        <input id="m-fnd-criteria" type="text" class="form-control" placeholder="e.g. Finance Policy Sec 4.2" style="width:100%;padding:8px;border-radius:6px;background:#1e293b;color:#fff;border:1px solid #334155;" />
      </div>

      <div>
        <label class="form-label" style="font-size:12px;font-weight:700;color:var(--text-muted,#94a3b8);">Severity</label>
        <select id="m-fnd-severity" class="form-select" style="width:100%;padding:8px;border-radius:6px;background:#1e293b;color:#fff;border:1px solid #334155;">
          <option value="CRITICAL">CRITICAL</option>
          <option value="HIGH">HIGH</option>
          <option value="MEDIUM" selected>MEDIUM</option>
          <option value="LOW">LOW</option>
        </select>
      </div>

      <button id="m-btn-save-fnd" class="btn btn-primary" style="margin-top:10px;padding:10px;border-radius:6px;font-weight:700;background:#ef4444;color:#fff;border:none;">
        Log Finding
      </button>
    </div>
  `;

  openModal('Log Audit Observation', content);

  document.getElementById('m-btn-save-fnd')?.addEventListener('click', async () => {
    const auditId = document.getElementById('m-fnd-audit-id')?.value;
    const title = document.getElementById('m-fnd-title')?.value;
    const conditionFact = document.getElementById('m-fnd-condition')?.value;
    const criteriaPolicy = document.getElementById('m-fnd-criteria')?.value;
    const severity = document.getElementById('m-fnd-severity')?.value;

    if (!title || !conditionFact) {
      showToast('Title and Condition are required', 'error');
      return;
    }

    try {
      await apiPost('/risk-audit/observations', {
        auditId,
        title,
        conditionFact,
        criteriaPolicy,
        severity,
      });
      showToast('Finding logged successfully', 'success');
      closeModal();
      loadActiveSection();
    } catch (err) {
      showToast(err.message || 'Failed to log finding', 'error');
    }
  });
}

function openReviewAnomalyModal(caseId) {
  const anomaly = cachedData.anomalies?.find((a) => a.caseId === caseId);
  if (!anomaly) return;

  const content = `
    <div style="display:flex;flex-direction:column;gap:14px;">
      <div style="padding:10px;background:rgba(239,68,68,0.08);border-radius:6px;">
        <div style="font-size:13px;font-weight:700;color:#fff;">${anomaly.caseId}: ${anomaly.title}</div>
        <div style="font-size:12px;color:var(--text-muted,#94a3b8);margin-top:4px;">${anomaly.description || 'No detailed description.'}</div>
        <div style="font-size:11px;color:var(--text-muted,#94a3b8);margin-top:4px;">Monetary Value: ₹${anomaly.monetaryValue || 0}</div>
      </div>

      <div>
        <label class="form-label" style="font-size:12px;font-weight:700;color:var(--text-muted,#94a3b8);">Review Disposition *</label>
        <select id="m-ano-disp" class="form-select" style="width:100%;padding:8px;border-radius:6px;background:#1e293b;color:#fff;border:1px solid #334155;">
          <option value="EXPLAINED_BENIGN">Explained / Legitimate Business Action</option>
          <option value="DUPLICATE_FALSE_POSITIVE">False Positive / Duplicate Indicator</option>
          <option value="DATA_QUALITY_ISSUE">Data Quality / Formatting Issue</option>
          <option value="CONFIRMED_ISSUE">Confirmed Operational Issue (Escalate)</option>
          <option value="REQUIRES_FURTHER_EVIDENCE">Requires Further Evidence</option>
        </select>
      </div>

      <div>
        <label class="form-label" style="font-size:12px;font-weight:700;color:var(--text-muted,#94a3b8);">Review Notes *</label>
        <textarea id="m-ano-notes" class="form-control" rows="2" placeholder="Record human investigation notes and rationale..." style="width:100%;padding:8px;border-radius:6px;background:#1e293b;color:#fff;border:1px solid #334155;"></textarea>
      </div>

      <button id="m-btn-save-ano" class="btn btn-primary" style="margin-top:10px;padding:10px;border-radius:6px;font-weight:700;background:var(--gold-500,#96733a);color:#fff;border:none;">
        Submit Review Disposition
      </button>
    </div>
  `;

  openModal('Human Review of Anomaly Indicator', content);

  document.getElementById('m-btn-save-ano')?.addEventListener('click', async () => {
    const disposition = document.getElementById('m-ano-disp')?.value;
    const reviewNotes = document.getElementById('m-ano-notes')?.value;

    if (!reviewNotes) {
      showToast('Review notes are mandatory', 'error');
      return;
    }

    try {
      await apiPost(`/risk-audit/anomalies/${caseId}/review`, {
        disposition,
        reviewNotes,
      });
      showToast('Anomaly disposition recorded', 'success');
      closeModal();
      loadActiveSection();
    } catch (err) {
      showToast(err.message || 'Failed to record review', 'error');
    }
  });
}
