// =============================================================================
// ZAMORIN CAFÉ ERP — STAGE 11: CUSTOMER COMPLAINTS & SERVICE RECOVERY CENTRE
// Owner Strategic Expansion Workspace
// =============================================================================

import { apiGet, apiPost, apiPatch } from '../apiClient.js';
import { showToast, skeleton, openModal, closeModal } from '../components.js';
import { state } from '../state.js';
import { icon } from '../icons.js';

let activeSection = 'overview';
let cachedComplaints = [];
let cachedMetrics = null;

export function setOwnerComplaintsSection(sec) {
  activeSection = sec || 'overview';
}

export function renderOwnerComplaints() {
  return `
    <div class="page-enter owner-complaints-workspace" style="display:flex;flex-direction:column;gap:20px;padding-bottom:60px;">
      <!-- Header -->
      <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:16px;">
        <div>
          <div style="display:inline-flex;align-items:center;gap:6px;padding:4px 10px;background:rgba(239,68,68,0.12);border:1px solid rgba(239,68,68,0.3);border-radius:20px;font-size:11px;font-weight:700;color:#f87171;letter-spacing:0.5px;margin-bottom:8px;">
            <span style="width:6px;height:6px;border-radius:50%;background:#ef4444;"></span>
            OWNER STRATEGIC EXPANSION · STAGE 11
          </div>
          <h1 style="font-size:24px;font-weight:800;color:var(--text-primary,#fff);margin:0 0 4px 0;letter-spacing:-0.5px;">
            Customer Complaints & Service Recovery Centre
          </h1>
          <div style="font-size:13px;color:var(--text-muted,#94a3b8);">
            Multi-Channel Intake · Food-Safety Escalation · Canonical Refund Linkage · DPDP Contact Masking
          </div>
        </div>

        <div style="display:flex;gap:10px;align-items:center;">
          <button id="oc-btn-new" class="btn btn-primary" style="display:inline-flex;align-items:center;gap:6px;padding:8px 14px;background:var(--gold-500,#96733a);color:#fff;border:none;border-radius:8px;font-size:13px;font-weight:700;cursor:pointer;">
            ${icon('plus')} Log New Complaint
          </button>
        </div>
      </div>

      <!-- Navigation Tabs -->
      <div style="display:flex;gap:8px;border-bottom:1px solid var(--border-color,#334155);padding-bottom:8px;overflow-x:auto;">
        <button class="tab-btn ${activeSection === 'overview' ? 'active' : ''}" data-section="overview" style="padding:8px 16px;border-radius:6px;border:none;background:${activeSection === 'overview' ? 'var(--gold-500,#96733a)' : 'transparent'};color:${activeSection === 'overview' ? '#fff' : 'var(--text-muted,#94a3b8)'};font-weight:700;font-size:13px;cursor:pointer;">
          Complaints Overview & KPIs
        </button>
        <button class="tab-btn ${activeSection === 'active' ? 'active' : ''}" data-section="active" style="padding:8px 16px;border-radius:6px;border:none;background:${activeSection === 'active' ? 'var(--gold-500,#96733a)' : 'transparent'};color:${activeSection === 'active' ? '#fff' : 'var(--text-muted,#94a3b8)'};font-weight:700;font-size:13px;cursor:pointer;">
          Active Complaints Queue
        </button>
        <button class="tab-btn ${activeSection === 'safety' ? 'active' : ''}" data-section="safety" style="padding:8px 16px;border-radius:6px;border:none;background:${activeSection === 'safety' ? 'var(--gold-500,#96733a)' : 'transparent'};color:${activeSection === 'safety' ? '#fff' : 'var(--text-muted,#94a3b8)'};font-weight:700;font-size:13px;cursor:pointer;">
          Food-Safety & CAPA Escalations
        </button>
      </div>

      <!-- Content Area -->
      <div id="oc-content-area">
        ${skeleton(4, 80)}
      </div>
    </div>
  `;
}

export async function initOwnerComplaints() {
  const container = document.getElementById('oc-content-area');
  if (!container) return;

  // Bind Tabs
  document.querySelectorAll('.owner-complaints-workspace .tab-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      const sec = e.currentTarget.dataset.section;
      setOwnerComplaintsSection(sec);
      document.querySelectorAll('.owner-complaints-workspace .tab-btn').forEach((b) => {
        b.style.background = 'transparent';
        b.style.color = 'var(--text-muted,#94a3b8)';
      });
      e.currentTarget.style.background = 'var(--gold-500,#96733a)';
      e.currentTarget.style.color = '#fff';
      renderSection();
    });
  });

  const btnNew = document.getElementById('oc-btn-new');
  if (btnNew) {
    btnNew.addEventListener('click', openNewComplaintModal);
  }

  window.__complaintsLoadError = "";
  await loadData();
  renderSection();
  if (window.__complaintsLoadError) {
    document.getElementById('oc-content-area')?.insertAdjacentHTML('afterbegin', `<div role="alert" style="margin-bottom:12px;padding:10px 12px;border:1px solid var(--err);border-radius:8px;color:var(--err);font-size:13px;">This page could not load its data (${String(window.__complaintsLoadError).replace(/[<>&]/g, '')}). The figures below are not real.</div>`);
  }
}

async function loadData() {
  try {
    const [metricsRes, complaintsRes] = await Promise.all([
      apiGet('/complaints/dashboard'),
      apiGet('/complaints')
    ]);
    if (metricsRes && metricsRes.success) cachedMetrics = metricsRes.data;
    if (complaintsRes && complaintsRes.success) cachedComplaints = complaintsRes.data;
  } catch (err) {
    console.warn('Complaints load notice:', err.message);
    window.__complaintsLoadError = err.message || 'This data could not be loaded.';
  }
}

function renderSection() {
  const container = document.getElementById('oc-content-area');
  if (!container) return;

  if (activeSection === 'overview') {
    renderOverview(container);
  } else if (activeSection === 'active') {
    renderActiveQueue(container);
  } else if (activeSection === 'safety') {
    renderSafetyEscalations(container);
  }
}

function renderOverview(container) {
  const m = cachedMetrics || {
    totalComplaints: 0,
    authoritativeBillDenominator: 0,
    complaintRatePerThousandBills: null,
    totalRefundedAmount: 0,
    foodSafetyEscalatedCount: 0
  };

  container.innerHTML = `
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:16px;">
      <div style="background:var(--surface-color,#1e293b);padding:16px;border-radius:8px;border:1px solid var(--border-color,#334155);">
        <div style="font-size:12px;color:var(--text-muted,#94a3b8);font-weight:700;">TOTAL COMPLAINTS</div>
        <div style="font-size:24px;font-weight:800;color:#fff;margin-top:6px;">${m.totalComplaints}</div>
      </div>
      <div style="background:var(--surface-color,#1e293b);padding:16px;border-radius:8px;border:1px solid var(--border-color,#334155);">
        <div style="font-size:12px;color:var(--text-muted,#94a3b8);font-weight:700;">COMPLAINTS / 1,000 BILLS</div>
        <div style="font-size:24px;font-weight:800;color:#fb923c;margin-top:6px;">
          ${m.complaintRatePerThousandBills !== null ? m.complaintRatePerThousandBills : 'UNAVAILABLE (0 BILLS)'}
        </div>
      </div>
      <div style="background:var(--surface-color,#1e293b);padding:16px;border-radius:8px;border:1px solid var(--border-color,#334155);">
        <div style="font-size:12px;color:var(--text-muted,#94a3b8);font-weight:700;">SERVICE RECOVERY REFUNDS</div>
        <div style="font-size:24px;font-weight:800;color:#38bdf8;margin-top:6px;">₹${m.totalRefundedAmount}</div>
      </div>
      <div style="background:var(--surface-color,#1e293b);padding:16px;border-radius:8px;border:1px solid var(--border-color,#334155);">
        <div style="font-size:12px;color:var(--text-muted,#94a3b8);font-weight:700;">FOOD SAFETY ESCALATIONS</div>
        <div style="font-size:24px;font-weight:800;color:#f87171;margin-top:6px;">${m.foodSafetyEscalatedCount}</div>
      </div>
    </div>

    <div style="background:var(--surface-color,#1e293b);padding:20px;border-radius:8px;border:1px solid var(--border-color,#334155);margin-top:20px;">
      <h3 style="font-size:16px;font-weight:700;color:#fff;margin:0 0 12px 0;">Authoritative Governance & Privacy Baseline</h3>
      <p style="font-size:13px;color:var(--text-muted,#94a3b8);margin:0 0 8px 0;">
        • All customer contacts are masked under DPDP Stage 08 controls. Full PII is restricted to authorized managers.
      </p>
      <p style="font-size:13px;color:var(--text-muted,#94a3b8);margin:0 0 8px 0;">
        • Refunds reference canonical Bill transactions directly. Zero parallel financial ledger is created.
      </p>
      <p style="font-size:13px;color:var(--text-muted,#94a3b8);margin:0;">
        • Unsubstantiated customer satisfaction (CSAT/NPS) scores are suppressed unless backed by certified survey instruments.
      </p>
    </div>
  `;
}

function renderActiveQueue(container) {
  if (!cachedComplaints || cachedComplaints.length === 0) {
    container.innerHTML = `
      <div style="background:var(--surface-color,#1e293b);padding:40px;text-align:center;border-radius:8px;border:1px solid var(--border-color,#334155);color:var(--text-muted,#94a3b8);">
        No active complaints in queue.
      </div>
    `;
    return;
  }

  container.innerHTML = `
    <div style="background:var(--surface-color,#1e293b);border-radius:8px;border:1px solid var(--border-color,#334155);overflow-x:auto;">
      <table style="width:100%;border-collapse:collapse;font-size:13px;text-align:left;">
        <thead>
          <tr style="border-bottom:1px solid var(--border-color,#334155);color:var(--text-muted,#94a3b8);">
            <th style="padding:12px 16px;">ID</th>
            <th style="padding:12px 16px;">Category</th>
            <th style="padding:12px 16px;">Severity</th>
            <th style="padding:12px 16px;">Customer</th>
            <th style="padding:12px 16px;">Status</th>
            <th style="padding:12px 16px;">Description</th>
          </tr>
        </thead>
        <tbody>
          ${cachedComplaints.map(c => `
            <tr style="border-bottom:1px solid rgba(255,255,255,0.05);color:#fff;">
              <td style="padding:12px 16px;font-weight:700;">${c.complaintId}</td>
              <td style="padding:12px 16px;">${c.complaintCategory}</td>
              <td style="padding:12px 16px;">
                <span style="padding:2px 8px;border-radius:4px;font-size:11px;font-weight:700;background:${c.severity === 'CRITICAL' ? 'rgba(239,68,68,0.2)' : 'rgba(56,189,248,0.2)'};color:${c.severity === 'CRITICAL' ? '#f87171' : '#38bdf8'};">
                  ${c.severity}
                </span>
              </td>
              <td style="padding:12px 16px;">${c.customerDetails?.customerName || 'Walk-in'}</td>
              <td style="padding:12px 16px;">
                <span style="font-weight:700;color:#fb923c;">${c.status}</span>
              </td>
              <td style="padding:12px 16px;max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
                ${c.description}
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function renderSafetyEscalations(container) {
  const safetyList = cachedComplaints.filter(c => c.foodSafetyLink?.isFoodSafetyEscalated || c.complaintCategory === 'FOOD_SAFETY_ALLERGEN');
  container.innerHTML = `
    <div style="background:var(--surface-color,#1e293b);padding:20px;border-radius:8px;border:1px solid var(--border-color,#334155);">
      <h3 style="font-size:16px;font-weight:700;color:#f87171;margin:0 0 12px 0;">Canonical Food-Safety Escalations (Stage 01 Linkage)</h3>
      <p style="font-size:13px;color:var(--text-muted,#94a3b8);margin:0 0 16px 0;">
        Any complaint alleging contamination, illness, or allergen exposure is linked to Stage 01 Food Safety Incidents and Stage 02 CAPA records without data duplication.
      </p>
      ${safetyList.length === 0 ? `
        <div style="color:var(--text-muted,#94a3b8);text-align:center;padding:20px 0;">No active food-safety escalated complaints.</div>
      ` : `
        <div style="display:flex;flex-direction:column;gap:10px;">
          ${safetyList.map(s => `
            <div style="padding:12px;background:rgba(0,0,0,0.2);border-radius:6px;border:1px solid rgba(239,68,68,0.3);">
              <div style="font-weight:700;color:#f87171;">${s.complaintId} · ${s.severity} SEVERITY</div>
              <div style="font-size:12px;color:#fff;margin-top:4px;">${s.description}</div>
              <div style="font-size:11px;color:var(--text-muted,#94a3b8);margin-top:4px;">
                Linked Incident: ${s.foodSafetyLink?.incidentId || 'Pending Stage 01 Log'} · CAPA: ${s.foodSafetyLink?.capaId || 'Candidate'}
              </div>
            </div>
          `).join('')}
        </div>
      `}
    </div>
  `;
}

function openNewComplaintModal() {
  openModal('Log Customer Complaint', `
    <form id="form-new-complaint" style="display:flex;flex-direction:column;gap:14px;">
      <div>
        <label style="display:block;font-size:12px;font-weight:700;margin-bottom:4px;">Channel *</label>
        <select id="cmp-channel" style="width:100%;padding:8px;border-radius:6px;border:1px solid var(--border-color,#334155);background:var(--surface-color,#1e293b);color:#fff;">
          <option value="CAFE_IN_PERSON">Café / In-Person</option>
          <option value="PHONE">Phone</option>
          <option value="EMAIL">Email</option>
          <option value="WEB">Web Form</option>
          <option value="DELIVERY_PLATFORM">Delivery Platform (Swiggy/Zomato)</option>
        </select>
      </div>
      <div>
        <label style="display:block;font-size:12px;font-weight:700;margin-bottom:4px;">Category *</label>
        <select id="cmp-cat" style="width:100%;padding:8px;border-radius:6px;border:1px solid var(--border-color,#334155);background:var(--surface-color,#1e293b);color:#fff;">
          <option value="FOOD_QUALITY">Food Quality</option>
          <option value="HYGIENE_CLEANLINESS">Hygiene & Cleanliness</option>
          <option value="SERVICE_SPEED_ATTITUDE">Service / Staff</option>
          <option value="BILLING_PRICING">Billing / Pricing</option>
          <option value="FOOD_SAFETY_ALLERGEN">Food Safety / Allergen Allegation</option>
          <option value="OTHER">Other</option>
        </select>
      </div>
      <div>
        <label style="display:block;font-size:12px;font-weight:700;margin-bottom:4px;">Severity *</label>
        <select id="cmp-sev" style="width:100%;padding:8px;border-radius:6px;border:1px solid var(--border-color,#334155);background:var(--surface-color,#1e293b);color:#fff;">
          <option value="LOW">Low</option>
          <option value="MEDIUM" selected>Medium</option>
          <option value="HIGH">High</option>
          <option value="CRITICAL">Critical (Food Safety / Legal Allegation)</option>
        </select>
      </div>
      <div>
        <label style="display:block;font-size:12px;font-weight:700;margin-bottom:4px;">Description *</label>
        <textarea id="cmp-desc" rows="3" placeholder="Accurate factual details of customer issue" required style="width:100%;padding:8px;border-radius:6px;border:1px solid var(--border-color,#334155);background:var(--surface-color,#1e293b);color:#fff;"></textarea>
      </div>
      <div style="display:flex;justify-content:flex-end;gap:10px;margin-top:10px;">
        <button type="button" id="cmp-cancel" class="btn btn-secondary" style="padding:8px 14px;background:transparent;border:1px solid var(--border-color,#334155);color:var(--text-muted,#94a3b8);border-radius:6px;">Cancel</button>
        <button type="submit" class="btn btn-primary" style="padding:8px 14px;background:var(--gold-500,#96733a);color:#fff;border:none;border-radius:6px;font-weight:700;">Submit Complaint</button>
      </div>
    </form>
  `);

  document.getElementById('cmp-cancel')?.addEventListener('click', closeModal);
  document.getElementById('form-new-complaint')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const payload = {
      cafeId:
        state.currentCafeId ||
        state.user?.primaryCafeId ||
        state.user?.assignedCafeIds?.[0] ||
        "",
      channel: document.getElementById('cmp-channel').value,
      complaintCategory: document.getElementById('cmp-cat').value,
      severity: document.getElementById('cmp-sev').value,
      description: document.getElementById('cmp-desc').value.trim(),
    };
    try {
      const res = await apiPost('/complaints', payload);
      if (res && res.success) {
        showToast('Complaint logged successfully', 'success');
        closeModal();
        await loadData();
        renderSection();
      } else {
        showToast(res.error || 'Failed to log complaint', 'error');
      }
    } catch (err) {
      showToast(err.message || 'API request failed', 'error');
    }
  });
}

export {
  initOwnerComplaints as initOwnerComplaintsEvents,
  initOwnerComplaints as wireOwnerComplaints,
};
