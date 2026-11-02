// =============================================================================
// ZAMORIN CAFÉ ERP — STAGE 13: CUSTOMER & LOYALTY INTELLIGENCE CENTRE
// Owner Strategic Expansion Workspace
// =============================================================================

import { apiGet, apiPost } from '../apiClient.js';
import { showToast, skeleton, openModal, closeModal } from '../components.js';
import { icon } from '../icons.js';

let activeSection = 'analytics';
let cachedAnalytics = null;
let cachedCohorts = null;
let cachedLiability = null;

export function setOwnerCustomerLoyaltySection(sec) {
  activeSection = sec || 'analytics';
}

export function renderOwnerCustomerLoyalty() {
  return `
    <div class="page-enter owner-customer-loyalty-workspace" style="display:flex;flex-direction:column;gap:20px;padding-bottom:60px;">
      <!-- Header -->
      <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:16px;">
        <div>
          <div style="display:inline-flex;align-items:center;gap:6px;padding:4px 10px;background:rgba(168,85,247,0.12);border:1px solid rgba(168,85,247,0.3);border-radius:20px;font-size:11px;font-weight:700;color:#c084fc;letter-spacing:0.5px;margin-bottom:8px;">
            <span style="width:6px;height:6px;border-radius:50%;background:#a855f7;"></span>
            OWNER STRATEGIC EXPANSION · STAGE 13
          </div>
          <h1 style="font-size:24px;font-weight:800;color:var(--text-primary,#fff);margin:0 0 4px 0;letter-spacing:-0.5px;">
            Customer & Loyalty Intelligence Centre
          </h1>
          <div style="font-size:13px;color:var(--text-muted,#94a3b8);">
            Anonymous vs Verified Visits · Zero Intrusive Profiling · Idempotent Points Ledger · DPDP Masked Exports
          </div>
        </div>

        <div style="display:flex;gap:10px;align-items:center;">
          <button id="ocl-btn-export" class="btn btn-secondary" style="display:inline-flex;align-items:center;gap:6px;padding:8px 14px;background:rgba(168,85,247,0.2);color:#d8b4fe;border:1px solid rgba(168,85,247,0.4);border-radius:8px;font-size:13px;font-weight:700;cursor:pointer;">
            ${icon('download')} Governed Masked Export
          </button>
        </div>
      </div>

      <!-- Navigation Tabs -->
      <div style="display:flex;gap:8px;border-bottom:1px solid var(--border-color,#334155);padding-bottom:8px;overflow-x:auto;">
        <button class="tab-btn ${activeSection === 'analytics' ? 'active' : ''}" data-section="analytics" style="padding:8px 16px;border-radius:6px;border:none;background:${activeSection === 'analytics' ? 'var(--gold-500,#96733a)' : 'transparent'};color:${activeSection === 'analytics' ? '#fff' : 'var(--text-muted,#94a3b8)'};font-weight:700;font-size:13px;cursor:pointer;">
          Customer Retention Analytics
        </button>
        <button class="tab-btn ${activeSection === 'cohorts' ? 'active' : ''}" data-section="cohorts" style="padding:8px 16px;border-radius:6px;border:none;background:${activeSection === 'cohorts' ? 'var(--gold-500,#96733a)' : 'transparent'};color:${activeSection === 'cohorts' ? '#fff' : 'var(--text-muted,#94a3b8)'};font-weight:700;font-size:13px;cursor:pointer;">
          Cohort Distributions
        </button>
        <button class="tab-btn ${activeSection === 'loyalty' ? 'active' : ''}" data-section="loyalty" style="padding:8px 16px;border-radius:6px;border:none;background:${activeSection === 'loyalty' ? 'var(--gold-500,#96733a)' : 'transparent'};color:${activeSection === 'loyalty' ? '#fff' : 'var(--text-muted,#94a3b8)'};font-weight:700;font-size:13px;cursor:pointer;">
          Loyalty Programme Exposure & Ledger
        </button>
      </div>

      <!-- Content Area -->
      <div id="ocl-content-area">
        ${skeleton(4, 80)}
      </div>
    </div>
  `;
}

export async function initOwnerCustomerLoyalty() {
  const container = document.getElementById('ocl-content-area');
  if (!container) return;

  // Bind Tabs
  document.querySelectorAll('.owner-customer-loyalty-workspace .tab-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      const sec = e.currentTarget.dataset.section;
      setOwnerCustomerLoyaltySection(sec);
      document.querySelectorAll('.owner-customer-loyalty-workspace .tab-btn').forEach((b) => {
        b.style.background = 'transparent';
        b.style.color = 'var(--text-muted,#94a3b8)';
      });
      e.currentTarget.style.background = 'var(--gold-500,#96733a)';
      e.currentTarget.style.color = '#fff';
      renderSection();
    });
  });

  const btnExport = document.getElementById('ocl-btn-export');
  if (btnExport) {
    btnExport.addEventListener('click', runGovernedExport);
  }

  window.__loyaltyLoadError = "";
  await loadData();
  renderSection();
  if (window.__loyaltyLoadError) {
    document.getElementById('ocl-content-area')?.insertAdjacentHTML('afterbegin', `<div role="alert" style="margin-bottom:12px;padding:10px 12px;border:1px solid var(--err);border-radius:8px;color:var(--err);font-size:13px;">This page could not load its data (${String(window.__loyaltyLoadError).replace(/[<>&]/g, '')}). The figures below are not real.</div>`);
  }
}

async function loadData() {
  try {
    const [analyticsRes, cohortsRes, exposureRes] = await Promise.all([
      apiGet('/customer-loyalty/analytics'),
      apiGet('/customer-loyalty/cohorts'),
      apiGet('/customer-loyalty/loyalty/exposure')
    ]);
    if (analyticsRes && analyticsRes.success) cachedAnalytics = analyticsRes.data;
    if (cohortsRes && cohortsRes.success) cachedCohorts = cohortsRes.data;
    if (exposureRes && exposureRes.success) cachedLiability = exposureRes.data;
  } catch (err) {
    console.warn('Customer loyalty load notice:', err.message);
    window.__loyaltyLoadError = err.message || 'This data could not be loaded.';
  }
}

function renderSection() {
  const container = document.getElementById('ocl-content-area');
  if (!container) return;

  if (activeSection === 'analytics') {
    renderAnalytics(container);
  } else if (activeSection === 'cohorts') {
    renderCohorts(container);
  } else if (activeSection === 'loyalty') {
    renderLoyalty(container);
  }
}

function renderAnalytics(container) {
  const a = cachedAnalytics || {
    totalBillsProcessed: 0,
    anonymousBillsCount: 0,
    verifiedCustomerBillsCount: 0,
    repeatRatePercentage: 0,
    averageBillValue: 0
  };

  container.innerHTML = `
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:16px;">
      <div style="background:var(--surface-color,#1e293b);padding:16px;border-radius:8px;border:1px solid var(--border-color,#334155);">
        <div style="font-size:12px;color:var(--text-muted,#94a3b8);font-weight:700;">TOTAL BILLS</div>
        <div style="font-size:24px;font-weight:800;color:#fff;margin-top:6px;">${a.totalBillsProcessed}</div>
        <div style="font-size:11px;color:var(--text-muted,#94a3b8);margin-top:4px;">Anonymous: ${a.anonymousBillsCount} · Linked: ${a.verifiedCustomerBillsCount}</div>
      </div>
      <div style="background:var(--surface-color,#1e293b);padding:16px;border-radius:8px;border:1px solid var(--border-color,#334155);">
        <div style="font-size:12px;color:var(--text-muted,#94a3b8);font-weight:700;">REPEAT VISIT RATE</div>
        <div style="font-size:24px;font-weight:800;color:#c084fc;margin-top:6px;">${a.repeatRatePercentage}%</div>
      </div>
      <div style="background:var(--surface-color,#1e293b);padding:16px;border-radius:8px;border:1px solid var(--border-color,#334155);">
        <div style="font-size:12px;color:var(--text-muted,#94a3b8);font-weight:700;">AVG BILL VALUE (ABV)</div>
        <div style="font-size:24px;font-weight:800;color:#38bdf8;margin-top:6px;">₹${a.averageBillValue}</div>
      </div>
    </div>

    <div style="background:var(--surface-color,#1e293b);padding:20px;border-radius:8px;border:1px solid var(--border-color,#334155);margin-top:20px;">
      <h3 style="font-size:16px;font-weight:700;color:#fff;margin:0 0 12px 0;">Strict DPDP 2023 Non-Profiling Invariant</h3>
      <p style="font-size:13px;color:var(--text-muted,#94a3b8);margin:0 0 8px 0;">
        • Anonymous POS transactions remain anonymous; the ERP does NOT engage in invasive probabilistic identity stitching.
      </p>
      <p style="font-size:13px;color:var(--text-muted,#94a3b8);margin:0 0 8px 0;">
        • Zero sensitive trait inference: strictly prohibited from inferring religion, caste, health, or political views.
      </p>
      <p style="font-size:13px;color:var(--text-muted,#94a3b8);margin:0;">
        • Customer complaints data is strictly segregated and NEVER automatically converted into marketing lists.
      </p>
    </div>
  `;
}

function renderCohorts(container) {
  const dist = cachedCohorts?.distribution || { FIRST_VISIT: 0, REPEAT: 0, REGULAR: 0, LAPSED: 0, REACTIVATED: 0 };
  container.innerHTML = `
    <div style="background:var(--surface-color,#1e293b);padding:20px;border-radius:8px;border:1px solid var(--border-color,#334155);">
      <h3 style="font-size:16px;font-weight:700;color:#fff;margin:0 0 16px 0;">
        Transparent Business Cohorts (${cachedCohorts?.cohortRuleVersion || 'Standard V2026.1'})
      </h3>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;">
        <div style="padding:14px;background:rgba(0,0,0,0.2);border-radius:8px;border:1px solid var(--border-color,#334155);">
          <div style="font-size:12px;color:var(--text-muted,#94a3b8);font-weight:700;">FIRST VISIT</div>
          <div style="font-size:22px;font-weight:800;color:#fff;margin-top:4px;">${dist.FIRST_VISIT}</div>
        </div>
        <div style="padding:14px;background:rgba(0,0,0,0.2);border-radius:8px;border:1px solid var(--border-color,#334155);">
          <div style="font-size:12px;color:var(--text-muted,#94a3b8);font-weight:700;">REPEAT</div>
          <div style="font-size:22px;font-weight:800;color:#38bdf8;margin-top:4px;">${dist.REPEAT}</div>
        </div>
        <div style="padding:14px;background:rgba(0,0,0,0.2);border-radius:8px;border:1px solid var(--border-color,#334155);">
          <div style="font-size:12px;color:var(--text-muted,#94a3b8);font-weight:700;">REGULAR</div>
          <div style="font-size:22px;font-weight:800;color:#4ade80;margin-top:4px;">${dist.REGULAR}</div>
        </div>
        <div style="padding:14px;background:rgba(0,0,0,0.2);border-radius:8px;border:1px solid var(--border-color,#334155);">
          <div style="font-size:12px;color:var(--text-muted,#94a3b8);font-weight:700;">LAPSED (>90 DAYS)</div>
          <div style="font-size:22px;font-weight:800;color:#f87171;margin-top:4px;">${dist.LAPSED}</div>
        </div>
      </div>
    </div>
  `;
}

function renderLoyalty(container) {
  const l = cachedLiability || { totalOutstandingPoints: 0, estimatedExposureRupees: 0 };
  container.innerHTML = `
    <div style="background:var(--surface-color,#1e293b);padding:20px;border-radius:8px;border:1px solid var(--border-color,#334155);">
      <h3 style="font-size:16px;font-weight:700;color:#fff;margin:0 0 16px 0;">Loyalty Programme Exposure & Outstanding Value</h3>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;">
        <div style="padding:16px;background:rgba(0,0,0,0.2);border-radius:8px;border:1px solid var(--border-color,#334155);">
          <div style="font-size:12px;color:var(--text-muted,#94a3b8);font-weight:700;">OUTSTANDING POINTS</div>
          <div style="font-size:24px;font-weight:800;color:#c084fc;margin-top:4px;">${l.totalOutstandingPoints} pts</div>
        </div>
        <div style="padding:16px;background:rgba(0,0,0,0.2);border-radius:8px;border:1px solid var(--border-color,#334155);">
          <div style="font-size:12px;color:var(--text-muted,#94a3b8);font-weight:700;">ESTIMATED OUTSTANDING LOYALTY VALUE</div>
          <div style="font-size:24px;font-weight:800;color:#38bdf8;margin-top:4px;">₹${l.estimatedExposureRupees ?? 0}</div>
        </div>
      </div>
      <div style="font-size:12px;color:var(--text-muted,#94a3b8);margin-top:14px;">
        Programme exposure simulation only. Zero balance sheet recognition or GL journal posting.
      </div>
    </div>
  `;
}

async function runGovernedExport() {
  try {
    const res = await apiPost('/customer-loyalty/export', { purpose: 'EXECUTIVE_AUDIT', requestedByRole: 'OWNER' });
    if (res && res.success) {
      showToast(`Exported ${res.data.recordCount} masked customer records compliantly`, 'success');
    }
  } catch (err) {
    showToast(err.message || 'Export error', 'error');
  }
}

export {
  initOwnerCustomerLoyalty as initOwnerCustomerLoyaltyEvents,
  initOwnerCustomerLoyalty as wireOwnerCustomerLoyalty,
};
