// =============================================================================
// ZAMORIN CAFÉ ERP — STAGE 06: SOP, TRAINING & COMPETENCY ACADEMY
// Owner Strategic Expansion Workspace
// =============================================================================

import { apiGet, apiPost, apiPatch } from '../apiClient.js';
import { showToast, skeleton, openModal, closeModal } from '../components.js';
import { state } from '../state.js';
import { icon } from '../icons.js';

let activeSection = 'overview';
let cachedData = {
  summary: null,
  sops: [],
  courses: [],
};

export function setOwnerAcademySection(sec) {
  activeSection = sec || 'overview';
}

export function renderOwnerAcademy() {
  return `
    <div class="page-enter owner-academy-workspace" style="display:flex;flex-direction:column;gap:20px;padding-bottom:60px;">
      <!-- Header -->
      <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:16px;">
        <div>
          <div style="display:inline-flex;align-items:center;gap:6px;padding:4px 10px;background:rgba(168,85,247,0.12);border:1px solid rgba(168,85,247,0.3);border-radius:20px;font-size:11px;font-weight:700;color:#c084fc;letter-spacing:0.5px;margin-bottom:8px;">
            <span style="width:6px;height:6px;border-radius:50%;background:#a855f7;"></span>
            OWNER STRATEGIC EXPANSION · STAGE 06
          </div>
          <h1 style="font-size:24px;font-weight:800;color:var(--text-primary,#fff);margin:0 0 4px 0;letter-spacing:-0.5px;">
            SOP, Training & Competency Academy
          </div>
          <div style="font-size:13px;color:var(--text-muted,#94a3b8);">
            Governed SOP Version Lifecycle · FoSTaC 2026 Procedure Integration · Competency vs Attendance Distinction
          </div>
        </div>

        <div style="display:flex;gap:10px;align-items:center;">
          <button id="oa-btn-new-sop" class="btn btn-primary" style="display:inline-flex;align-items:center;gap:6px;padding:8px 14px;background:var(--gold-500,#96733a);color:#fff;border:none;border-radius:8px;font-size:13px;font-weight:700;">
            ${icon('edit')} Create New SOP
          </button>
        </div>
      </div>

      <!-- Navigation Tabs -->
      <div style="display:flex;gap:8px;border-bottom:1px solid var(--border-color,#334155);padding-bottom:8px;overflow-x:auto;">
        <button class="tab-btn ${activeSection === 'overview' ? 'active' : ''}" data-section="overview" style="padding:8px 16px;border-radius:6px;border:none;background:${activeSection === 'overview' ? 'var(--gold-500,#96733a)' : 'transparent'};color:${activeSection === 'overview' ? '#fff' : 'var(--text-muted,#94a3b8)'};font-weight:700;font-size:13px;cursor:pointer;">
          Academy Overview
        </button>
        <button class="tab-btn ${activeSection === 'sops' ? 'active' : ''}" data-section="sops" style="padding:8px 16px;border-radius:6px;border:none;background:${activeSection === 'sops' ? 'var(--gold-500,#96733a)' : 'transparent'};color:${activeSection === 'sops' ? '#fff' : 'var(--text-muted,#94a3b8)'};font-weight:700;font-size:13px;cursor:pointer;">
          SOP Governance
        </button>
        <button class="tab-btn ${activeSection === 'courses' ? 'active' : ''}" data-section="courses" style="padding:8px 16px;border-radius:6px;border:none;background:${activeSection === 'courses' ? 'var(--gold-500,#96733a)' : 'transparent'};color:${activeSection === 'courses' ? '#fff' : 'var(--text-muted,#94a3b8)'};font-weight:700;font-size:13px;cursor:pointer;">
          Training & FoSTaC Integration
        </button>
        <button class="tab-btn ${activeSection === 'competency' ? 'active' : ''}" data-section="competency" style="padding:8px 16px;border-radius:6px;border:none;background:${activeSection === 'competency' ? 'var(--gold-500,#96733a)' : 'transparent'};color:${activeSection === 'competency' ? '#fff' : 'var(--text-muted,#94a3b8)'};font-weight:700;font-size:13px;cursor:pointer;">
          Competency Matrix
        </button>
      </div>

      <!-- Main Content Container -->
      <div id="oa-content-container">
        ${skeleton(4, 80)}
      </div>
    </div>
  `;
}

export function initOwnerAcademyEvents() {
  const tabs = document.querySelectorAll('.owner-academy-workspace .tab-btn');
  tabs.forEach((tab) => {
    tab.addEventListener('click', (e) => {
      const section = e.currentTarget.dataset.section;
      setOwnerAcademySection(section);
      tabs.forEach((t) => {
        const isCurrent = t.dataset.section === section;
        t.style.background = isCurrent ? 'var(--gold-500,#96733a)' : 'transparent';
        t.style.color = isCurrent ? '#fff' : 'var(--text-muted,#94a3b8)';
      });
      loadActiveSectionContent();
    });
  });

  const btnNewSop = document.getElementById('oa-btn-new-sop');
  if (btnNewSop) {
    btnNewSop.addEventListener('click', openCreateSopModal);
  }

  loadActiveSectionContent();
}

async function loadActiveSectionContent() {
  const container = document.getElementById('oa-content-container');
  if (!container) return;

  container.innerHTML = skeleton(3, 100);

  try {
    if (activeSection === 'overview') {
      const res = await apiGet('/api/v1/academy/overview');
      cachedData.summary = res?.data || res;
      renderOverviewSection(container);
    } else if (activeSection === 'sops') {
      const res = await apiGet('/api/v1/academy/sops');
      cachedData.sops = res?.data || res || [];
      renderSopsSection(container);
    } else if (activeSection === 'courses') {
      const res = await apiGet('/api/v1/academy/courses');
      cachedData.courses = res?.data || res || [];
      renderCoursesSection(container);
    } else if (activeSection === 'competency') {
      renderCompetencySection(container);
    }
  } catch (err) {
    container.innerHTML = `
      <div style="padding:30px;background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.3);border-radius:12px;text-align:center;color:#fca5a5;">
        <div style="font-weight:700;font-size:16px;margin-bottom:8px;">Failed to load Academy data</div>
        <div style="font-size:13px;margin-bottom:16px;">${err.message || 'Server error or access denied.'}</div>
        <button id="oa-btn-retry" class="btn btn-secondary" style="padding:6px 14px;border-radius:6px;">Retry</button>
      </div>
    `;
    const retryBtn = document.getElementById('oa-btn-retry');
    if (retryBtn) retryBtn.addEventListener('click', loadActiveSectionContent);
  }
}

function renderOverviewSection(container) {
  const data = cachedData.summary || {};

  container.innerHTML = `
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:16px;margin-bottom:24px;">
      <div style="background:var(--surface-card,#1e293b);padding:20px;border-radius:12px;border:1px solid var(--border-color,#334155);">
        <div style="font-size:12px;color:var(--text-muted,#94a3b8);font-weight:700;text-transform:uppercase;">Governed SOPs</div>
        <div style="font-size:26px;font-weight:800;color:#fff;margin-top:6px;">${data.totalSopsCount || 0}</div>
        <div style="font-size:12px;color:#38bdf8;margin-top:4px;">${data.effectiveSopsCount || 0} currently effective</div>
      </div>
      <div style="background:var(--surface-card,#1e293b);padding:20px;border-radius:12px;border:1px solid var(--border-color,#334155);">
        <div style="font-size:12px;color:var(--text-muted,#94a3b8);font-weight:700;text-transform:uppercase;">Acknowledgement Rate</div>
        <div style="font-size:26px;font-weight:800;color:${(data.acknowledgementRatePercent || 0) >= 90 ? '#34d399' : '#fbbf24'};margin-top:6px;">
          ${data.acknowledgementRatePercent || 0}%
        </div>
        <div style="font-size:12px;color:#94a3b8;margin-top:4px;">${data.totalAcknowledgementsTracked || 0} assignments tracked</div>
      </div>
      <div style="background:var(--surface-card,#1e293b);padding:20px;border-radius:12px;border:1px solid var(--border-color,#334155);">
        <div style="font-size:12px;color:var(--text-muted,#94a3b8);font-weight:700;text-transform:uppercase;">FoSTaC Certified Personnel</div>
        <div style="font-size:26px;font-weight:800;color:#a78bfa;margin-top:6px;">${data.fostacCertifiedCount || 0}</div>
        
      </div>
      <div style="background:var(--surface-card,#1e293b);padding:20px;border-radius:12px;border:1px solid var(--border-color,#334155);">
        <div style="font-size:12px;color:var(--text-muted,#94a3b8);font-weight:700;text-transform:uppercase;">Competent Personnel</div>
        <div style="font-size:26px;font-weight:800;color:#34d399;margin-top:6px;">${data.competentPersonnelCount || 0}</div>
        <div style="font-size:12px;color:${(data.needsRetrainingCount || 0) > 0 ? '#f87171' : '#94a3b8'};margin-top:4px;">
          ${data.needsRetrainingCount || 0} need retraining
        </div>
      </div>
    </div>
  `;
}

function renderSopsSection(container) {
  const sops = cachedData.sops || [];

  container.innerHTML = `
    <div style="background:var(--surface-card,#1e293b);padding:20px;border-radius:12px;border:1px solid var(--border-color,#334155);">
      <h3 style="font-size:15px;font-weight:700;color:#fff;margin:0 0 16px 0;">Standard Operating Procedures Registry</h3>
      ${
        sops.length === 0
          ? `<div style="color:var(--text-muted,#94a3b8);font-size:13px;">No SOPs registered yet. Click "Create New SOP" to start.</div>`
          : sops
              .map(
                (s) => `
        <div style="display:flex;justify-content:space-between;align-items:center;padding:12px 0;border-bottom:1px solid rgba(255,255,255,0.06);flex-wrap:wrap;gap:10px;">
          <div>
            <div style="display:flex;align-items:center;gap:8px;">
              <span style="font-weight:800;color:#fff;font-size:14px;">${s.title}</span>
              <span style="padding:2px 6px;border-radius:4px;font-size:11px;font-weight:700;background:rgba(255,255,255,0.1);color:#cbd5e1;">
                v${s.version}
              </span>
            </div>
            <div style="font-size:12px;color:var(--text-muted,#94a3b8);margin-top:4px;">
              ID: ${s.sopId} · Domain: <strong>${s.domain}</strong> · Change: ${s.changeSummary || 'Initial version'}
            </div>
          </div>
          <div style="display:flex;align-items:center;gap:10px;">
            <span style="padding:3px 8px;border-radius:12px;font-size:11px;font-weight:700;background:${
              s.status === 'EFFECTIVE'
                ? 'rgba(16,185,129,0.15);color:#34d399;'
                : s.status === 'APPROVED'
                ? 'rgba(56,189,248,0.15);color:#38bdf8;'
                : 'rgba(251,191,36,0.15);color:#fbbf24;'
            }">
              ${s.status}
            </span>
          </div>
        </div>
      `
              )
              .join('')
      }
    </div>
  `;
}

function renderCoursesSection(container) {
  const courses = cachedData.courses || [];

  container.innerHTML = `
    <div style="background:var(--surface-card,#1e293b);padding:20px;border-radius:12px;border:1px solid var(--border-color,#334155);">
      <h3 style="font-size:15px;font-weight:700;color:#fff;margin:0 0 16px 0;">Training Modules & Certification Courses</h3>
      ${
        courses.length === 0
          ? `<div style="color:var(--text-muted,#94a3b8);font-size:13px;">No training courses configured yet.</div>`
          : courses
              .map(
                (c) => `
        <div style="display:flex;justify-content:space-between;align-items:center;padding:12px 0;border-bottom:1px solid rgba(255,255,255,0.06);flex-wrap:wrap;gap:10px;">
          <div>
            <div style="font-weight:700;color:#fff;font-size:14px;">${c.title}</div>
            <div style="font-size:12px;color:#94a3b8;margin-top:4px;">
              Course ID: ${c.courseId} · Duration: ${c.durationMinutes} mins · Pass Threshold: ${c.passThresholdPercent}%
            </div>
            ${
              c.isFostacLinked
                ? `<div style="font-size:11px;color:#a78bfa;margin-top:4px;">Official FoSTaC Procedure: 5 August 2026</div>`
                : ''
            }
          </div>
        </div>
      `
              )
              .join('')
      }
    </div>
  `;
}

function renderCompetencySection(container) {
  container.innerHTML = `
    <div style="background:var(--surface-card,#1e293b);padding:20px;border-radius:12px;border:1px solid var(--border-color,#334155);">
      <h3 style="font-size:15px;font-weight:700;color:#fff;margin:0 0 8px 0;">Competency & Assessment Matrix</h3>
      <div style="font-size:13px;color:#94a3b8;line-height:1.5;">
        Demonstrated proficiency requires formal assessment and supervisor/practical evidence.<br>
        <strong>Core Principle:</strong> Attendance alone is strictly recorded as <code style="color:#fbbf24;">ATTENDED</code> and does not constitute competency certification.
      </div>
    </div>
  `;
}

function openCreateSopModal() {
  const content = `
    <div style="display:flex;flex-direction:column;gap:14px;">
      <div>
        <label style="font-size:12px;font-weight:700;color:#fff;">SOP ID *</label>
        <input id="oa-modal-sop-id" type="text" class="form-control" placeholder="e.g. SOP-FOOD-001" style="width:100%;padding:8px;background:rgba(0,0,0,0.3);color:#fff;border:1px solid #475569;border-radius:6px;">
      </div>
      <div>
        <label style="font-size:12px;font-weight:700;color:#fff;">Title *</label>
        <input id="oa-modal-title" type="text" class="form-control" placeholder="Standard procedure title" style="width:100%;padding:8px;background:rgba(0,0,0,0.3);color:#fff;border:1px solid #475569;border-radius:6px;">
      </div>
      <div>
        <label style="font-size:12px;font-weight:700;color:#fff;">Domain *</label>
        <select id="oa-modal-domain" class="form-select" style="width:100%;padding:8px;background:rgba(0,0,0,0.3);color:#fff;border:1px solid #475569;border-radius:6px;">
          <option value="FOOD_SAFETY">Food Safety</option>
          <option value="POS_BILLING">POS & Billing</option>
          <option value="CASH_HANDLING">Cash Handling</option>
          <option value="HYGIENE_CLEANING">Hygiene & Cleaning</option>
          <option value="PROCUREMENT_RECEIVING">Procurement & Receiving</option>
          <option value="INVENTORY_COUNTING">Inventory Counting</option>
          <option value="PEOPLE_HR">People & HR</option>
          <option value="CYBERSECURITY_PRIVACY">Cybersecurity & Privacy</option>
          <option value="EMERGENCY_DISASTER">Emergency & Disaster</option>
        </select>
      </div>
      <div>
        <label style="font-size:12px;font-weight:700;color:#fff;">Procedure Content *</label>
        <textarea id="oa-modal-content" rows="4" class="form-control" placeholder="Detailed procedure steps and standards" style="width:100%;padding:8px;background:rgba(0,0,0,0.3);color:#fff;border:1px solid #475569;border-radius:6px;"></textarea>
      </div>
    </div>
  `;

  openModal({
    title: 'Create Standard Operating Procedure Draft',
    content,
    confirmText: 'Save Draft SOP',
    onConfirm: async () => {
      const sopId = document.getElementById('oa-modal-sop-id')?.value.trim();
      const title = document.getElementById('oa-modal-title')?.value.trim();
      const domain = document.getElementById('oa-modal-domain')?.value;
      const contentText = document.getElementById('oa-modal-content')?.value.trim();

      if (!sopId || !title || !contentText) {
        showToast('All required fields must be filled', 'error');
        return false;
      }

      try {
        await apiPost('/api/v1/academy/sops', {
          sopId,
          title,
          domain,
          content: contentText,
        });
        showToast('SOP Draft created successfully', 'success');
        closeModal();
        loadActiveSectionContent();
      } catch (err) {
        showToast(err.message || 'Failed to create SOP', 'error');
        return false;
      }
    },
  });
}
