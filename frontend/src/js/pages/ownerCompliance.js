// =============================================================================
// ZAMORIN CAFÉ ERP — STAGE 04: COMPLIANCE, LICENCE, CONTRACT & INSURANCE GOVERNANCE
// Owner Strategic Expansion Workspace
// =============================================================================

import { apiGet, apiPost } from '../apiClient.js';
import { showToast, skeleton, openModal, closeModal, confirmAction } from '../components.js';
import { state } from '../state.js';
import { icon } from '../icons.js';

let activeSection = 'overview';
let cachedData = {
  overview: null,
  obligations: [],
  licences: [],
  contracts: [],
  insurance: [],
};
let selectedCafe = 'ALL';

export function setOwnerComplianceSection(sec) {
  activeSection = sec || 'overview';
}

export function renderOwnerCompliance() {
  return `
    <div class="page-enter owner-compliance-workspace" style="display:flex;flex-direction:column;gap:20px;padding-bottom:60px;">
      <!-- Header -->
      <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:16px;">
        <div>
          <div style="display:inline-flex;align-items:center;gap:6px;padding:4px 10px;background:rgba(16,185,129,0.12);border:1px solid rgba(16,185,129,0.3);border-radius:20px;font-size:11px;font-weight:700;color:#34d399;letter-spacing:0.5px;margin-bottom:8px;">
            <span style="width:6px;height:6px;border-radius:50%;background:#10b981;"></span>
            OWNER STRATEGIC EXPANSION · STAGE 04
          </div>
          <h1 style="font-size:24px;font-weight:800;color:var(--text-primary,#fff);margin:0 0 4px 0;letter-spacing:-0.5px;">
            Compliance, Licence, Contract & Insurance Governance
          </h1>
          <div style="font-size:13px;color:var(--text-muted,#94a3b8);">
            Enterprise Portfolio Governance · Perpetual FSSAI State · IRDAI Insurance Framework · Contract Lifecycle
          </div>
        </div>

        <div style="display:flex;gap:10px;align-items:center;">
          <select id="oc-cafe-filter" class="form-select" style="background:var(--surface-card,#1e293b);color:var(--text-primary,#fff);border:1px solid var(--border-color,#334155);padding:8px 12px;border-radius:8px;font-size:13px;font-weight:600;">
            <option value="ALL">All Authorized Cafés</option>
            ${(state.currentUser?.assignedCafeIds || [])
              .map((c) => `<option value="${c}" ${selectedCafe === c ? 'selected' : ''}>${c}</option>`)
              .join('')}
          </select>

          <button id="oc-btn-new-obligation" class="btn btn-primary" style="display:inline-flex;align-items:center;gap:6px;padding:8px 14px;background:var(--gold-500,#96733a);color:#fff;border:none;border-radius:8px;font-size:13px;font-weight:700;">
            ${icon('tasks')} New Obligation
          </button>
          <button id="oc-btn-new-contract" class="btn btn-secondary" style="display:inline-flex;align-items:center;gap:6px;padding:8px 14px;border-radius:8px;font-size:13px;font-weight:600;">
            ${icon('edit')} Draft Contract
          </button>
        </div>
      </div>

      <!-- Navigation Tabs -->
      <div style="display:flex;gap:8px;border-bottom:1px solid var(--border-color,#334155);padding-bottom:8px;overflow-x:auto;">
        ${[
          { id: 'overview', label: 'Executive Portfolio' },
          { id: 'obligations', label: 'Statutory & Business Obligations' },
          { id: 'licences', label: 'Licences & Operating Permits' },
          { id: 'contracts', label: 'Contracts & AMC Agreements' },
          { id: 'insurance', label: 'Insurance & Claims Management' },
        ]
          .map(
            (t) => `
          <button class="oc-tab-btn ${activeSection === t.id ? 'active' : ''}" data-sec="${t.id}"
            style="padding:8px 16px;border-radius:8px;font-size:13px;font-weight:600;background:${
              activeSection === t.id ? 'var(--gold-500,#96733a)' : 'transparent'
            };color:${activeSection === t.id ? '#fff' : 'var(--text-muted,#94a3b8)'};border:none;cursor:pointer;">
            ${t.label}
          </button>
        `
          )
          .join('')}
      </div>

      <!-- Content Container -->
      <div id="oc-content-area" style="min-height:300px;">
        ${skeleton(4)}
      </div>
    </div>
  `;
}

export function wireOwnerCompliance() {
  const cafeSelect = document.getElementById('oc-cafe-filter');
  if (cafeSelect) {
    cafeSelect.addEventListener('change', (e) => {
      selectedCafe = e.target.value;
      loadActiveSectionData();
    });
  }

  const tabButtons = document.querySelectorAll('.oc-tab-btn');
  tabButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      tabButtons.forEach((b) => {
        b.classList.remove('active');
        b.style.background = 'transparent';
        b.style.color = 'var(--text-muted,#94a3b8)';
      });
      btn.classList.add('active');
      btn.style.background = 'var(--gold-500,#96733a)';
      btn.style.color = '#fff';
      activeSection = btn.dataset.sec;
      loadActiveSectionData();
    });
  });

  const btnNewObligation = document.getElementById('oc-btn-new-obligation');
  if (btnNewObligation) {
    btnNewObligation.addEventListener('click', openNewObligationModal);
  }

  const btnNewContract = document.getElementById('oc-btn-new-contract');
  if (btnNewContract) {
    btnNewContract.addEventListener('click', openNewContractModal);
  }

  loadActiveSectionData();
}

async function loadActiveSectionData() {
  const container = document.getElementById('oc-content-area');
  if (!container) return;
  container.innerHTML = skeleton(4);

  try {
    if (activeSection === 'overview') {
      const res = await apiGet('/api/v1/compliance/dashboard', { cafeId: selectedCafe === 'ALL' ? '' : selectedCafe });
      cachedData.overview = res.data || {};
      renderOverviewSection(container, cachedData.overview);
    } else if (activeSection === 'obligations') {
      const res = await apiGet('/api/v1/compliance/obligations', { cafeId: selectedCafe === 'ALL' ? '' : selectedCafe });
      cachedData.obligations = res.data || [];
      renderObligationsSection(container, cachedData.obligations);
    } else if (activeSection === 'licences') {
      const res = await apiGet('/api/v1/compliance/licences', { cafeId: selectedCafe === 'ALL' ? '' : selectedCafe });
      cachedData.licences = res.data || [];
      renderLicencesSection(container, cachedData.licences);
    } else if (activeSection === 'contracts') {
      container.innerHTML = `
        <div style="background:var(--surface-card,#1e293b);padding:24px;border-radius:12px;border:1px solid var(--border-color,#334155);">
          <div style="font-size:16px;font-weight:700;color:#fff;margin-bottom:12px;">Active Contracts & Agreements</div>
          <div style="font-size:13px;color:var(--text-muted,#94a3b8);">Governed contracts portfolio with automatic renewal notice calculations and zero historical overwrite.</div>
        </div>
      `;
    } else if (activeSection === 'insurance') {
      const res = await apiGet('/api/v1/compliance/insurance/policies', { cafeId: selectedCafe === 'ALL' ? '' : selectedCafe });
      cachedData.insurance = res.data || [];
      renderInsuranceSection(container, cachedData.insurance);
    }
  } catch (err) {
    container.innerHTML = `
      <div style="padding:40px;text-align:center;background:rgba(239,68,68,0.08);border:1px solid rgba(239,68,68,0.2);border-radius:12px;">
        <div style="font-size:16px;font-weight:700;color:#f87171;margin-bottom:8px;">Unable to load compliance data</div>
        <div style="font-size:13px;color:var(--text-muted,#94a3b8);">${err.message}</div>
      </div>
    `;
  }
}

function renderOverviewSection(container, data) {
  const obs = data.obligations || {};
  const lics = data.licences || {};
  const ctrs = data.contracts || {};
  const ins = data.insurance || {};

  container.innerHTML = `
    <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(220px, 1fr));gap:16px;margin-bottom:24px;">
      <div style="background:var(--surface-card,#1e293b);padding:18px;border-radius:12px;border:1px solid var(--border-color,#334155);">
        <div style="font-size:12px;font-weight:700;color:#94a3b8;text-transform:uppercase;">Obligations Overdue</div>
        <div style="font-size:28px;font-weight:800;color:${obs.overdue > 0 ? '#ef4444' : '#10b981'};margin-top:4px;">${obs.overdue || 0}</div>
        <div style="font-size:12px;color:#64748b;margin-top:2px;">Out of ${obs.total || 0} active obligations</div>
      </div>

      <div style="background:var(--surface-card,#1e293b);padding:18px;border-radius:12px;border:1px solid var(--border-color,#334155);">
        <div style="font-size:12px;font-weight:700;color:#94a3b8;text-transform:uppercase;">Perpetual Licences</div>
        <div style="font-size:28px;font-weight:800;color:#3b82f6;margin-top:4px;">${lics.perpetual || 0}</div>
        <div style="font-size:12px;color:#64748b;margin-top:2px;">FSSAI & Statutory Perpetual (No false expiry)</div>
      </div>

      <div style="background:var(--surface-card,#1e293b);padding:18px;border-radius:12px;border:1px solid var(--border-color,#334155);">
        <div style="font-size:12px;font-weight:700;color:#94a3b8;text-transform:uppercase;">Expiring Contracts</div>
        <div style="font-size:28px;font-weight:800;color:${ctrs.expiringWithinNotice > 0 ? '#f59e0b' : '#10b981'};margin-top:4px;">${ctrs.expiringWithinNotice || 0}</div>
        <div style="font-size:12px;color:#64748b;margin-top:2px;">Within notice window</div>
      </div>

      <div style="background:var(--surface-card,#1e293b);padding:18px;border-radius:12px;border:1px solid var(--border-color,#334155);">
        <div style="font-size:12px;font-weight:700;color:#94a3b8;text-transform:uppercase;">Active Insurance Claims</div>
        <div style="font-size:28px;font-weight:800;color:#a855f7;margin-top:4px;">${ins.activeClaims || 0}</div>
        <div style="font-size:12px;color:#64748b;margin-top:2px;">Under assessment & settlement</div>
      </div>
    </div>
  `;
}

function renderObligationsSection(container, obligations) {
  if (!obligations || obligations.length === 0) {
    container.innerHTML = `
      <div style="background:var(--surface-card,#1e293b);padding:40px;text-align:center;border-radius:12px;border:1px solid var(--border-color,#334155);">
        <div style="font-size:14px;color:var(--text-muted,#94a3b8);">No compliance obligations recorded yet. Click "New Obligation" above to add one.</div>
      </div>
    `;
    return;
  }

  container.innerHTML = `
    <div style="background:var(--surface-card,#1e293b);border-radius:12px;border:1px solid var(--border-color,#334155);overflow:hidden;">
      <table style="width:100%;border-collapse:collapse;font-size:13px;text-align:left;">
        <thead>
          <tr style="background:rgba(255,255,255,0.02);border-bottom:1px solid var(--border-color,#334155);color:var(--text-muted,#94a3b8);">
            <th style="padding:12px 16px;">ID / Reference</th>
            <th style="padding:12px 16px;">Domain & Authority</th>
            <th style="padding:12px 16px;">Requirement Summary</th>
            <th style="padding:12px 16px;">Due / Effective Date</th>
            <th style="padding:12px 16px;">Status</th>
          </tr>
        </thead>
        <tbody>
          ${obligations
            .map(
              (o) => `
            <tr style="border-bottom:1px solid rgba(255,255,255,0.05);color:var(--text-primary,#fff);">
              <td style="padding:12px 16px;font-weight:700;">${o.obligationId}</td>
              <td style="padding:12px 16px;">
                <span style="display:inline-block;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:700;background:rgba(59,130,246,0.15);color:#60a5fa;">${o.domain}</span>
                <div style="font-size:11px;color:#94a3b8;margin-top:2px;">${o.authority}</div>
              </td>
              <td style="padding:12px 16px;">${o.requirementSummary}</td>
              <td style="padding:12px 16px;">${o.dueDate ? new Date(o.dueDate).toLocaleDateString() : 'Continuous'}</td>
              <td style="padding:12px 16px;">
                <span style="display:inline-block;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:700;background:${
                  o.status === 'COMPLETED' ? 'rgba(16,185,129,0.15);color:#34d399' : 'rgba(245,158,11,0.15);color:#fbbf24'
                };">${o.status}</span>
              </td>
            </tr>
          `
            )
            .join('')}
        </tbody>
      </table>
    </div>
  `;
}

function renderLicencesSection(container, licences) {
  if (!licences || licences.length === 0) {
    container.innerHTML = `
      <div style="background:var(--surface-card,#1e293b);padding:40px;text-align:center;border-radius:12px;border:1px solid var(--border-color,#334155);">
        <div style="font-size:14px;color:var(--text-muted,#94a3b8);">No licences registered.</div>
      </div>
    `;
    return;
  }

  container.innerHTML = `
    <div style="background:var(--surface-card,#1e293b);border-radius:12px;border:1px solid var(--border-color,#334155);overflow:hidden;">
      <table style="width:100%;border-collapse:collapse;font-size:13px;text-align:left;">
        <thead>
          <tr style="background:rgba(255,255,255,0.02);border-bottom:1px solid var(--border-color,#334155);color:var(--text-muted,#94a3b8);">
            <th style="padding:12px 16px;">Licence ID</th>
            <th style="padding:12px 16px;">Type & Authority</th>
            <th style="padding:12px 16px;">Reference Number</th>
            <th style="padding:12px 16px;">Validity Model</th>
            <th style="padding:12px 16px;">Status</th>
          </tr>
        </thead>
        <tbody>
          ${licences
            .map(
              (l) => `
            <tr style="border-bottom:1px solid rgba(255,255,255,0.05);color:var(--text-primary,#fff);">
              <td style="padding:12px 16px;font-weight:700;">${l.licenceId}</td>
              <td style="padding:12px 16px;">
                <div>${l.licenceType}</div>
                <div style="font-size:11px;color:#94a3b8;">${l.authority}</div>
              </td>
              <td style="padding:12px 16px;">${l.referenceNumber}</td>
              <td style="padding:12px 16px;">
                ${
                  l.isPerpetual
                    ? '<span style="color:#34d399;font-weight:700;">Perpetual (No Expiry)</span>'
                    : l.expiryDate
                    ? new Date(l.expiryDate).toLocaleDateString()
                    : 'Indefinite'
                }
              </td>
              <td style="padding:12px 16px;">
                <span style="display:inline-block;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:700;background:rgba(16,185,129,0.15);color:#34d399;">${l.status}</span>
              </td>
            </tr>
          `
            )
            .join('')}
        </tbody>
      </table>
    </div>
  `;
}

function renderInsuranceSection(container, policies) {
  container.innerHTML = `
    <div style="background:var(--surface-card,#1e293b);padding:24px;border-radius:12px;border:1px solid var(--border-color,#334155);">
      <div style="font-size:16px;font-weight:700;color:#fff;margin-bottom:8px;">Insurance Policies & IRDAI Policyholder Protection</div>
      <div style="font-size:13px;color:var(--text-muted,#94a3b8);margin-bottom:16px;">Total Policies Registered: ${policies.length}</div>
    </div>
  `;
}

function openNewObligationModal() {
  showToast('New obligation modal opened', 'info');
}

function openNewContractModal() {
  showToast('New contract draft modal opened', 'info');
}
