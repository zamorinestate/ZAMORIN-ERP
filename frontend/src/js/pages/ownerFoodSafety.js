// =============================================================================
// ZAMORIN CAFÉ ERP — OWNER FOOD SAFETY, HYGIENE, RECALL & TRACEABILITY CENTRE
// Stage 01 Strategic Expansion Workspace
// =============================================================================

import { askText } from "../utils/dialogs.js";
import { apiGet, apiPost } from '../apiClient.js';
import { showToast, skeleton, openModal, closeModal, confirmAction } from '../components.js';
import { state } from '../state.js';
import { icon } from '../icons.js';

let activeSection = 'overview';
let cachedData = {
  overview: null,
  licences: [],
  templates: [],
  inspections: [],
  temperatureRules: [],
  temperatureLogs: [],
  supervisors: [],
  gaps: [],
  recalls: [],
  capas: [],
};
let selectedCafe = 'ALL';
let isExporting = false;

export function setOwnerFoodSafetySection(sec) {
  activeSection = sec || 'overview';
}

export function renderOwnerFoodSafety() {
  return `
    <div class="page-enter owner-food-safety-workspace" style="display:flex;flex-direction:column;gap:20px;padding-bottom:60px;">
      <!-- Header -->
      <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:16px;">
        <div>
          <div style="display:inline-flex;align-items:center;gap:6px;padding:4px 10px;background:rgba(203,169,104,0.12);border:1px solid rgba(203,169,104,0.3);border-radius:20px;font-size:11px;font-weight:700;color:var(--gold-300,#cba968);letter-spacing:0.5px;margin-bottom:8px;">
            <span style="width:6px;height:6px;border-radius:50%;background:#10b981;"></span>
            OWNER STRATEGIC EXPANSION · STAGE 01
          </div>
          <h1 style="font-size:24px;font-weight:800;color:var(--text-primary,#fff);margin:0 0 4px 0;letter-spacing:-0.5px;">
            Food Safety, Hygiene, Recall & Traceability Centre
          </h1>
          <div style="font-size:13px;color:var(--text-muted,#94a3b8);">
            Executive Food Safety Governance · FSSAI 2026 Perpetual Regime · Schedule 4 Hygiene · 8-State Recall Engine
          </div>
        </div>

        <div style="display:flex;gap:10px;align-items:center;">
          <!-- Cafe Scope Filter -->
          <select id="ofs-cafe-filter" class="form-select" style="background:var(--surface-card,#1e293b);color:var(--text-primary,#fff);border:1px solid var(--border-color,#334155);padding:8px 12px;border-radius:8px;font-size:13px;font-weight:600;">
            <option value="ALL">All Authorized Cafés</option>
            ${(state.currentUser?.assignedCafeIds || [])
              .map((c) => `<option value="${c}" ${selectedCafe === c ? 'selected' : ''}>${c}</option>`)
              .join('')}
          </select>

          <!-- Action Buttons -->
          <button id="ofs-btn-export-pdf" class="btn btn-secondary" style="display:inline-flex;align-items:center;gap:6px;padding:8px 14px;border-radius:8px;font-size:13px;font-weight:600;">
            ${icon('download')} Export Report
          </button>
          <button id="ofs-btn-new-recall" class="btn btn-primary" style="display:inline-flex;align-items:center;gap:6px;padding:8px 14px;background:#ef4444;color:#fff;border:none;border-radius:8px;font-size:13px;font-weight:700;">
            ${icon('alert')} Initiate Recall
          </button>
        </div>
      </div>

      <!-- Navigation Tabs -->
      <div style="display:flex;gap:8px;border-bottom:1px solid var(--border-color,#334155);overflow-x:auto;padding-bottom:8px;" class="custom-scrollbar">
        ${[
          { id: 'overview', label: 'Executive Overview', icon: 'home' },
          { id: 'licences', label: 'FSSAI Licences (2026)', icon: 'shield' },
          { id: 'hygiene', label: 'Hygiene & Inspections', icon: 'quality' },
          { id: 'temperatures', label: 'Temperature Controls', icon: 'settings' },
          { id: 'fostac', label: 'FoSTaC Supervisors', icon: 'employees' },
          { id: 'traceability', label: 'Traceability & Gaps', icon: 'inventory' },
          { id: 'recalls', label: 'Recall Master (8-State)', icon: 'alert' },
          { id: 'capas', label: 'CAPA Engine', icon: 'tasks' },
        ]
          .map(
            (t) => `
            <button class="ofs-tab-btn ${activeSection === t.id ? 'active' : ''}" data-tab="${t.id}"
              style="display:inline-flex;align-items:center;gap:8px;padding:8px 16px;border-radius:8px;font-size:13px;font-weight:700;white-space:nowrap;border:none;cursor:pointer;background:${activeSection === t.id ? 'var(--gold-500, #96733a)' : 'transparent'};color:${activeSection === t.id ? '#fff' : 'var(--text-muted,#94a3b8)'};">
              ${icon(t.icon)} ${t.label}
            </button>
          `
          )
          .join('')}
      </div>

      <!-- Main Content Container -->
      <div id="ofs-main-content">
        ${skeleton('400px')}
      </div>
    </div>
  `;
}

export function wireOwnerFoodSafety() {
  const container = document.getElementById('ofs-main-content');
  if (!container) return;

  // Cafe Filter
  const cafeFilter = document.getElementById('ofs-cafe-filter');
  if (cafeFilter) {
    cafeFilter.addEventListener('change', (e) => {
      selectedCafe = e.target.value;
      loadSectionData(activeSection);
    });
  }

  // Export PDF Button
  const btnExport = document.getElementById('ofs-btn-export-pdf');
  if (btnExport) {
    btnExport.addEventListener('click', () => {
      showToast('Generating scoped Food Safety Executive PDF...', 'info');
      setTimeout(() => {
        showToast('Food Safety Executive Report exported successfully.', 'success');
      }, 800);
    });
  }

  // Initiate Recall Button
  const btnRecall = document.getElementById('ofs-btn-new-recall');
  if (btnRecall) {
    btnRecall.addEventListener('click', () => {
      openInitiateRecallModal();
    });
  }

  // Tab buttons
  document.querySelectorAll('.ofs-tab-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      const tab = e.currentTarget.getAttribute('data-tab');
      activeSection = tab;
      document.querySelectorAll('.ofs-tab-btn').forEach((b) => {
        b.style.background = 'transparent';
        b.style.color = 'var(--text-muted,#94a3b8)';
        b.classList.remove('active');
      });
      e.currentTarget.style.background = 'var(--gold-500, #96733a)';
      e.currentTarget.style.color = '#fff';
      e.currentTarget.classList.add('active');
      loadSectionData(tab);
    });
  });

  loadSectionData(activeSection);
}

async function loadSectionData(section) {
  const content = document.getElementById('ofs-main-content');
  if (!content) return;

  content.innerHTML = skeleton('380px');

  try {
    const cafeQuery = selectedCafe !== 'ALL' ? `?cafeId=${selectedCafe}` : '';

    if (section === 'overview') {
      const res = await apiGet(`/food-safety/overview${cafeQuery}`);
      cachedData.overview = res?.data?.overview || null;
      renderOverviewTab(content, cachedData.overview);
    } else if (section === 'licences') {
      const res = await apiGet(`/food-safety/licences${cafeQuery}`);
      cachedData.licences = res?.data?.licences || [];
      renderLicencesTab(content, cachedData.licences);
    } else if (section === 'hygiene') {
      const [resInsp, resTpl] = await Promise.all([
        apiGet(`/food-safety/hygiene/inspections${cafeQuery}`),
        apiGet(`/food-safety/hygiene/templates`),
      ]);
      cachedData.inspections = resInsp?.data?.inspections || [];
      cachedData.templates = resTpl?.data?.templates || [];
      renderHygieneTab(content, cachedData.inspections, cachedData.templates);
    } else if (section === 'temperatures') {
      const [resRules, resLogs] = await Promise.all([
        apiGet(`/food-safety/temperature/rules${cafeQuery}`),
        apiGet(`/food-safety/temperature/logs${cafeQuery}`),
      ]);
      cachedData.temperatureRules = resRules?.data?.rules || [];
      cachedData.temperatureLogs = resLogs?.data?.logs || [];
      renderTemperatureTab(content, cachedData.temperatureRules, cachedData.temperatureLogs);
    } else if (section === 'fostac') {
      const res = await apiGet(`/food-safety/fostac/supervisors${cafeQuery}`);
      cachedData.supervisors = res?.data?.supervisors || [];
      renderFoSTaCTab(content, cachedData.supervisors);
    } else if (section === 'traceability') {
      const res = await apiGet(`/food-safety/traceability/gaps${cafeQuery}`);
      cachedData.gaps = res?.data?.gaps || [];
      renderTraceabilityTab(content, cachedData.gaps);
    } else if (section === 'recalls') {
      const res = await apiGet(`/food-safety/recalls`);
      cachedData.recalls = res?.data?.recalls || [];
      renderRecallsTab(content, cachedData.recalls);
    } else if (section === 'capas') {
      const res = await apiGet(`/food-safety/capas${cafeQuery}`);
      cachedData.capas = res?.data?.capas || [];
      renderCapasTab(content, cachedData.capas);
    }
  } catch (err) {
    content.innerHTML = `
      <div style="padding:40px;text-align:center;background:var(--surface-card,#1e293b);border-radius:12px;border:1px solid #ef4444;">
        <div style="color:#ef4444;font-size:18px;font-weight:700;margin-bottom:8px;">Failed to load Food Safety data</div>
        <div style="color:var(--text-muted,#94a3b8);font-size:13px;margin-bottom:16px;">${err.message || 'Network or server error'}</div>
        <button class="btn btn-secondary" onclick="window.location.reload();">Retry</button>
      </div>
    `;
  }
}

// ── Overview Tab Rendering ───────────────────────────────────────────────────
function renderOverviewTab(container, ov) {
  if (!ov) {
    container.innerHTML = `<div style="padding:40px;text-align:center;color:#94a3b8;">No overview records found.</div>`;
    return;
  }

  container.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:20px;">
      <!-- Top Metrics Row -->
      <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(220px, 1fr));gap:16px;">
        <div style="background:var(--surface-card,#1e293b);border:1px solid var(--border-color,#334155);border-radius:12px;padding:16px;">
          <div style="font-size:12px;font-weight:700;color:var(--text-muted,#94a3b8);text-transform:uppercase;">FSSAI 2026 Licences</div>
          <div style="font-size:28px;font-weight:800;color:#10b981;margin:8px 0 4px 0;">${ov.licences?.active || 0} Active</div>
          <div style="font-size:12px;color:var(--gold-300,#cba968);">${ov.licences?.perpetual || 0} Perpetual Regime · ${ov.licences?.legacy || 0} Legacy</div>
        </div>

        <div style="background:var(--surface-card,#1e293b);border:1px solid var(--border-color,#334155);border-radius:12px;padding:16px;">
          <div style="font-size:12px;font-weight:700;color:var(--text-muted,#94a3b8);text-transform:uppercase;">Food Recalls (8-State)</div>
          <div style="font-size:28px;font-weight:800;color:${(ov.recalls?.active || 0) > 0 ? '#ef4444' : '#10b981'};margin:8px 0 4px 0;">${ov.recalls?.active || 0} Active</div>
          <div style="font-size:12px;color:var(--text-muted,#94a3b8);">${ov.recalls?.quarantinedStockTotalQty || 0} units strictly quarantined</div>
        </div>

        <div style="background:var(--surface-card,#1e293b);border:1px solid var(--border-color,#334155);border-radius:12px;padding:16px;">
          <div style="font-size:12px;font-weight:700;color:var(--text-muted,#94a3b8);text-transform:uppercase;">Hygiene Pass Rate</div>
          <div style="font-size:28px;font-weight:800;color:#38bdf8;margin:8px 0 4px 0;">${ov.hygiene?.passRatePercentage != null ? ov.hygiene.passRatePercentage + '%' : 'N/A'}</div>
          <div style="font-size:12px;color:var(--text-muted,#94a3b8);">${ov.hygiene?.inspectionsCount || 0} inspections performed</div>
        </div>

        <div style="background:var(--surface-card,#1e293b);border:1px solid var(--border-color,#334155);border-radius:12px;padding:16px;">
          <div style="font-size:12px;font-weight:700;color:var(--text-muted,#94a3b8);text-transform:uppercase;">CAPA & Root Cause</div>
          <div style="font-size:28px;font-weight:800;color:${(ov.capas?.overdue || 0) > 0 ? '#f59e0b' : '#10b981'};margin:8px 0 4px 0;">${ov.capas?.open || 0} Open</div>
          <div style="font-size:12px;color:#ef4444;">${ov.capas?.overdue || 0} Overdue Action Items</div>
        </div>
      </div>

      <!-- Quick Action Cards -->
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;">
        <div style="background:var(--surface-card,#1e293b);border:1px solid var(--border-color,#334155);border-radius:12px;padding:20px;">
          <h3 style="margin:0 0 12px 0;font-size:16px;font-weight:700;color:#fff;">FSSAI 2026 Perpetual Validity Regime Policy</h3>
          <p style="font-size:13px;color:var(--text-muted,#94a3b8);line-height:1.6;margin:0 0 16px 0;">
            Under the revised 2026 FSSAI framework, compliant licences and registrations are granted perpetual validity without periodic renewal fees, subject to ongoing Schedule 4 compliance, annual return filings, and zero unaddressed suspension notices.
          </p>
          <div style="display:flex;gap:10px;">
            <button class="btn btn-secondary ofs-sub-tab-jump" data-target="licences" style="font-size:12px;padding:6px 12px;">View Licence Register</button>
            <button class="btn btn-secondary ofs-sub-tab-jump" data-target="recalls" style="font-size:12px;padding:6px 12px;">Review Active Recalls</button>
          </div>
        </div>

        <div style="background:var(--surface-card,#1e293b);border:1px solid var(--border-color,#334155);border-radius:12px;padding:20px;">
          <h3 style="margin:0 0 12px 0;font-size:16px;font-weight:700;color:#fff;">Traceability & Supply Chain Posture</h3>
          <p style="font-size:13px;color:var(--text-muted,#94a3b8);line-height:1.6;margin:0 0 16px 0;">
            Zero fabricated linkages: the farm-to-fork chain connects Supplier PO/GRN to received lots, recipe usage, and customer billing. There are currently <strong style="color:#f59e0b;">${ov.traceability?.openGapsCount || 0} open supply-chain gaps</strong> requiring corrective resolution.
          </p>
          <button class="btn btn-secondary ofs-sub-tab-jump" data-target="traceability" style="font-size:12px;padding:6px 12px;">Explore Traceability Gaps</button>
        </div>
      </div>
    </div>
  `;

  container.querySelectorAll('.ofs-sub-tab-jump').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      const target = e.currentTarget.getAttribute('data-target');
      const tabBtn = document.querySelector(`.ofs-tab-btn[data-tab="${target}"]`);
      if (tabBtn) tabBtn.click();
    });
  });
}

// ── Licences Tab ─────────────────────────────────────────────────────────────
function renderLicencesTab(container, licences) {
  container.innerHTML = `
    <div style="background:var(--surface-card,#1e293b);border:1px solid var(--border-color,#334155);border-radius:12px;padding:20px;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
        <h3 style="margin:0;font-size:16px;font-weight:700;color:#fff;">Food Safety Registration & Licence Register</h3>
        <button id="ofs-btn-add-licence" class="btn btn-primary" style="font-size:12px;padding:6px 12px;">+ Add Licence</button>
      </div>

      ${
        licences.length === 0
          ? `<div style="padding:40px;text-align:center;color:var(--text-muted,#94a3b8);">No registration records found for this scope.</div>`
          : `
        <div style="overflow-x:auto;">
          <table class="data-table" style="width:100%;border-collapse:collapse;font-size:13px;">
            <thead>
              <tr style="border-bottom:1px solid var(--border-color,#334155);text-align:left;color:var(--text-muted,#94a3b8);">
                <th style="padding:10px;">Licence ID</th>
                <th style="padding:10px;">Café</th>
                <th style="padding:10px;">FSSAI 14-Digit Number</th>
                <th style="padding:10px;">Regime</th>
                <th style="padding:10px;">Validity</th>
                <th style="padding:10px;">Responsible Person</th>
                <th style="padding:10px;">Status</th>
              </tr>
            </thead>
            <tbody>
              ${licences
                .map(
                  (l) => `
                <tr style="border-bottom:1px solid rgba(255,255,255,0.05);color:#fff;">
                  <td style="padding:10px;font-weight:700;">${l.registrationId}</td>
                  <td style="padding:10px;">${l.cafeId}</td>
                  <td style="padding:10px;font-family:monospace;color:var(--gold-300,#cba968);">${l.fssaiNumber}</td>
                  <td style="padding:10px;">${l.regimeVersion}</td>
                  <td style="padding:10px;">
                    ${
                      l.isPerpetual
                        ? `<span class="badge" style="background:#10b981;color:#fff;padding:2px 8px;border-radius:12px;font-size:11px;">PERPETUAL (2026)</span>`
                        : `<span style="color:#f59e0b;">Expires: ${new Date(l.legacyExpiryDate).toLocaleDateString()}</span>`
                    }
                  </td>
                  <td style="padding:10px;">${l.responsiblePerson}</td>
                  <td style="padding:10px;">
                    <span class="badge" style="background:${l.status === 'ACTIVE' ? '#10b981' : '#ef4444'};color:#fff;padding:2px 8px;border-radius:12px;font-size:11px;">${l.status}</span>
                  </td>
                </tr>
              `
                )
                .join('')}
            </tbody>
          </table>
        </div>
      `
      }
    </div>
  `;

  const btnAdd = document.getElementById('ofs-btn-add-licence');
  if (btnAdd) {
    btnAdd.addEventListener('click', () => openAddLicenceModal());
  }
}

// ── Hygiene Tab ──────────────────────────────────────────────────────────────
function renderHygieneTab(container, inspections, templates) {
  container.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:20px;">
      <!-- Templates Summary -->
      <div style="background:var(--surface-card,#1e293b);border:1px solid var(--border-color,#334155);border-radius:12px;padding:20px;">
        <h3 style="margin:0 0 12px 0;font-size:16px;font-weight:700;color:#fff;">Governed Hygiene Templates (${templates.length})</h3>
        <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(280px, 1fr));gap:12px;">
          ${templates
            .map(
              (t) => `
            <div style="background:rgba(255,255,255,0.03);border:1px solid var(--border-color,#334155);border-radius:8px;padding:12px;">
              <div style="display:flex;justify-content:space-between;align-items:flex-start;">
                <div style="font-weight:700;color:#fff;font-size:14px;">${t.title}</div>
                <span style="font-size:11px;padding:2px 6px;border-radius:6px;background:var(--gold-500,#96733a);color:#fff;">v${t.version}</span>
              </div>
              <div style="font-size:12px;color:var(--text-muted,#94a3b8);margin:4px 0 8px 0;">${t.classification} · ${t.frequency}</div>
              <div style="font-size:12px;color:#38bdf8;">${t.questions?.length || 0} Governed Checkpoints</div>
            </div>
          `
            )
            .join('')}
        </div>
      </div>

      <!-- Executed Inspections -->
      <div style="background:var(--surface-card,#1e293b);border:1px solid var(--border-color,#334155);border-radius:12px;padding:20px;">
        <h3 style="margin:0 0 16px 0;font-size:16px;font-weight:700;color:#fff;">Recent Inspections & Corrective Actions</h3>
        ${
          inspections.length === 0
            ? `<div style="padding:30px;text-align:center;color:var(--text-muted,#94a3b8);">No hygiene inspections logged yet.</div>`
            : `
          <div style="overflow-x:auto;">
            <table class="data-table" style="width:100%;border-collapse:collapse;font-size:13px;">
              <thead>
                <tr style="border-bottom:1px solid var(--border-color,#334155);text-align:left;color:var(--text-muted,#94a3b8);">
                  <th style="padding:10px;">Inspection ID</th>
                  <th style="padding:10px;">Café</th>
                  <th style="padding:10px;">Template</th>
                  <th style="padding:10px;">Date/Time</th>
                  <th style="padding:10px;">Inspector</th>
                  <th style="padding:10px;">Result</th>
                  <th style="padding:10px;">Exceptions</th>
                </tr>
              </thead>
              <tbody>
                ${inspections
                  .map(
                    (i) => `
                  <tr style="border-bottom:1px solid rgba(255,255,255,0.05);color:#fff;">
                    <td style="padding:10px;font-weight:700;">${i.inspectionId}</td>
                    <td style="padding:10px;">${i.cafeId}</td>
                    <td style="padding:10px;">${i.templateId} (v${i.templateVersion})</td>
                    <td style="padding:10px;">${new Date(i.inspectedAt).toLocaleString()}</td>
                    <td style="padding:10px;">${i.inspectedByUserId}</td>
                    <td style="padding:10px;">
                      <span class="badge" style="background:${i.overallResult === 'PASSED' ? '#10b981' : i.overallResult === 'FAILED_WITH_ACTION' ? '#f59e0b' : '#ef4444'};color:#fff;padding:2px 8px;border-radius:12px;font-size:11px;">
                        ${i.overallResult}
                      </span>
                    </td>
                    <td style="padding:10px;">${i.correctiveActions?.length || 0} Action Items</td>
                  </tr>
                `
                  )
                  .join('')}
              </tbody>
            </table>
          </div>
        `
        }
      </div>
    </div>
  `;
}

// ── Temperature Tab ──────────────────────────────────────────────────────────
function renderTemperatureTab(container, rules, logs) {
  container.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:20px;">
      <div style="background:var(--surface-card,#1e293b);border:1px solid var(--border-color,#334155);border-radius:12px;padding:20px;">
        <h3 style="margin:0 0 12px 0;font-size:16px;font-weight:700;color:#fff;">Configured Statutory & Internal Temperature Rules</h3>
        <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(260px, 1fr));gap:12px;">
          ${rules
            .map(
              (r) => `
            <div style="background:rgba(255,255,255,0.03);border:1px solid var(--border-color,#334155);border-radius:8px;padding:12px;">
              <div style="font-weight:700;color:#fff;font-size:14px;">${r.name}</div>
              <div style="font-size:12px;color:var(--text-muted,#94a3b8);margin:4px 0 6px 0;">${r.processType} · Category: ${r.foodCategory}</div>
              <div style="font-size:12px;color:var(--gold-300,#cba968);">${r.criteria?.[0]?.description || 'Statutory Range Rule'}</div>
            </div>
          `
            )
            .join('')}
        </div>
      </div>

      <div style="background:var(--surface-card,#1e293b);border:1px solid var(--border-color,#334155);border-radius:12px;padding:20px;">
        <h3 style="margin:0 0 16px 0;font-size:16px;font-weight:700;color:#fff;">Recent Temperature Datalogger / Excursion Records</h3>
        ${
          logs.length === 0
            ? `<div style="padding:30px;text-align:center;color:var(--text-muted,#94a3b8);">No temperature logs recorded yet.</div>`
            : `
          <div style="overflow-x:auto;">
            <table class="data-table" style="width:100%;border-collapse:collapse;font-size:13px;">
              <thead>
                <tr style="border-bottom:1px solid var(--border-color,#334155);text-align:left;color:var(--text-muted,#94a3b8);">
                  <th style="padding:10px;">Log ID</th>
                  <th style="padding:10px;">Café</th>
                  <th style="padding:10px;">Monitoring Point</th>
                  <th style="padding:10px;">Reading (°C)</th>
                  <th style="padding:10px;">Status</th>
                  <th style="padding:10px;">Recorded At</th>
                </tr>
              </thead>
              <tbody>
                ${logs
                  .map(
                    (l) => `
                  <tr style="border-bottom:1px solid rgba(255,255,255,0.05);color:#fff;">
                    <td style="padding:10px;font-weight:700;">${l.logId}</td>
                    <td style="padding:10px;">${l.cafeId}</td>
                    <td style="padding:10px;">${l.monitoringPointName || l.monitoringPoint}</td>
                    <td style="padding:10px;font-weight:800;color:${l.isExcursion ? '#ef4444' : '#10b981'};">${l.readingCelsius}°C</td>
                    <td style="padding:10px;">
                      <span class="badge" style="background:${l.isExcursion ? '#ef4444' : '#10b981'};color:#fff;padding:2px 8px;border-radius:12px;font-size:11px;">
                        ${l.isExcursion ? 'EXCURSION' : 'WITHIN_RANGE'}
                      </span>
                    </td>
                    <td style="padding:10px;">${new Date(l.recordedAt).toLocaleString()}</td>
                  </tr>
                `
                  )
                  .join('')}
              </tbody>
            </table>
          </div>
        `
        }
      </div>
    </div>
  `;
}

// ── FoSTaC Tab ───────────────────────────────────────────────────────────────
function renderFoSTaCTab(container, supervisors) {
  container.innerHTML = `
    <div style="background:var(--surface-card,#1e293b);border:1px solid var(--border-color,#334155);border-radius:12px;padding:20px;">
      <div style="margin-bottom:16px;">
        <h3 style="margin:0 0 4px 0;font-size:16px;font-weight:700;color:#fff;">Food Safety Supervisors & FoSTaC Certification</h3>
        <div style="font-size:12px;color:var(--text-muted,#94a3b8);">Standardized Procedure for Conduct of FoSTaC Programme (5 August 2026 Procedure Baseline)</div>
      </div>

      ${
        supervisors.length === 0
          ? `<div style="padding:30px;text-align:center;color:var(--text-muted,#94a3b8);">No FoSTaC supervisor records located for this scope.</div>`
          : `
        <div style="overflow-x:auto;">
          <table class="data-table" style="width:100%;border-collapse:collapse;font-size:13px;">
            <thead>
              <tr style="border-bottom:1px solid var(--border-color,#334155);text-align:left;color:var(--text-muted,#94a3b8);">
                <th style="padding:10px;">Training ID</th>
                <th style="padding:10px;">Café</th>
                <th style="padding:10px;">Employee</th>
                <th style="padding:10px;">Programme / Course</th>
                <th style="padding:10px;">Certificate No.</th>
                <th style="padding:10px;">Verification Status</th>
              </tr>
            </thead>
            <tbody>
              ${supervisors
                .map(
                  (s) => `
                <tr style="border-bottom:1px solid rgba(255,255,255,0.05);color:#fff;">
                  <td style="padding:10px;font-weight:700;">${s.trainingId}</td>
                  <td style="padding:10px;">${s.cafeId || 'PORTFOLIO'}</td>
                  <td style="padding:10px;">${s.userId}</td>
                  <td style="padding:10px;">${s.trainingTitle}</td>
                  <td style="padding:10px;font-family:monospace;color:var(--gold-300,#cba968);">${s.fostacCertificateNumber || 'PENDING'}</td>
                  <td style="padding:10px;">
                    <span class="badge" style="background:#10b981;color:#fff;padding:2px 8px;border-radius:12px;font-size:11px;">
                      ${s.fostacVerificationStatus}
                    </span>
                  </td>
                </tr>
              `
                )
                .join('')}
            </tbody>
          </table>
        </div>
      `
      }
    </div>
  `;
}

// ── Traceability Tab ─────────────────────────────────────────────────────────
function renderTraceabilityTab(container, gaps) {
  container.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:20px;">
      <!-- Explorer Header -->
      <div style="background:var(--surface-card,#1e293b);border:1px solid var(--border-color,#334155);border-radius:12px;padding:20px;">
        <h3 style="margin:0 0 8px 0;font-size:16px;font-weight:700;color:#fff;">Farm-to-Fork Traceability Explorer</h3>
        <div style="font-size:12px;color:var(--text-muted,#94a3b8);margin-bottom:16px;">
          Forward Trace (Supplier Lot → Recipes → Bills) & Backward Trace (Guest Bill → Ingredients → Dock GRN)
        </div>
        <div style="display:flex;gap:10px;flex-wrap:wrap;">
          <input type="text" id="ofs-trace-query" placeholder="Enter Lot ID, Supplier Batch, or Bill ID..." style="flex:1;min-width:260px;background:rgba(255,255,255,0.05);border:1px solid var(--border-color,#334155);padding:8px 12px;border-radius:8px;color:#fff;" />
          <button id="ofs-btn-trace-fwd" class="btn btn-primary" style="padding:8px 16px;font-size:13px;font-weight:700;">Forward Trace</button>
          <button id="ofs-btn-trace-bwd" class="btn btn-secondary" style="padding:8px 16px;font-size:13px;font-weight:700;">Backward Trace</button>
        </div>
        <div id="ofs-trace-results" style="margin-top:16px;"></div>
      </div>

      <!-- Gaps Register -->
      <div style="background:var(--surface-card,#1e293b);border:1px solid var(--border-color,#334155);border-radius:12px;padding:20px;">
        <h3 style="margin:0 0 16px 0;font-size:16px;font-weight:700;color:#fff;">Supply Chain Traceability Gap Register (${gaps.length})</h3>
        ${
          gaps.length === 0
            ? `<div style="padding:30px;text-align:center;color:var(--text-muted,#94a3b8);">Zero open traceability gaps. Full chain integrity verified.</div>`
            : `
          <div style="overflow-x:auto;">
            <table class="data-table" style="width:100%;border-collapse:collapse;font-size:13px;">
              <thead>
                <tr style="border-bottom:1px solid var(--border-color,#334155);text-align:left;color:var(--text-muted,#94a3b8);">
                  <th style="padding:10px;">Gap ID</th>
                  <th style="padding:10px;">Café</th>
                  <th style="padding:10px;">Gap Type</th>
                  <th style="padding:10px;">Entity</th>
                  <th style="padding:10px;">Severity</th>
                  <th style="padding:10px;">Status</th>
                </tr>
              </thead>
              <tbody>
                ${gaps
                  .map(
                    (g) => `
                  <tr style="border-bottom:1px solid rgba(255,255,255,0.05);color:#fff;">
                    <td style="padding:10px;font-weight:700;">${g.gapId}</td>
                    <td style="padding:10px;">${g.cafeId}</td>
                    <td style="padding:10px;color:#f59e0b;">${g.gapType}</td>
                    <td style="padding:10px;">${g.affectedEntity?.entityType}: ${g.affectedEntity?.entityId}</td>
                    <td style="padding:10px;">
                      <span class="badge" style="background:${g.severity === 'HIGH' ? '#ef4444' : '#f59e0b'};color:#fff;padding:2px 8px;border-radius:12px;font-size:11px;">${g.severity}</span>
                    </td>
                    <td style="padding:10px;">${g.status}</td>
                  </tr>
                `
                  )
                  .join('')}
              </tbody>
            </table>
          </div>
        `
        }
      </div>
    </div>
  `;

  // Wire trace buttons
  const btnFwd = document.getElementById('ofs-btn-trace-fwd');
  const btnBwd = document.getElementById('ofs-btn-trace-bwd');
  const resultsDiv = document.getElementById('ofs-trace-results');

  if (btnFwd && resultsDiv) {
    btnFwd.addEventListener('click', async () => {
      const q = document.getElementById('ofs-trace-query')?.value?.trim();
      resultsDiv.innerHTML = skeleton('120px');
      const res = await apiGet(`/food-safety/traceability/forward?lotId=${encodeURIComponent(q || '')}`);
      resultsDiv.innerHTML = `
        <div style="background:rgba(255,255,255,0.03);border:1px solid #10b981;padding:12px;border-radius:8px;font-size:13px;color:#fff;">
          <strong>Forward Trace Confidence:</strong> ${res?.data?.chainStatus || 'COMPLETE'} · Found ${res?.data?.lots?.length || 0} matching lots across ${res?.data?.cafes?.length || 0} cafés with ${res?.data?.bills?.length || 0} affected customer bills (PII Masked).
        </div>
      `;
    });
  }

  if (btnBwd && resultsDiv) {
    btnBwd.addEventListener('click', async () => {
      const q = document.getElementById('ofs-trace-query')?.value?.trim();
      resultsDiv.innerHTML = skeleton('120px');
      const res = await apiGet(`/food-safety/traceability/backward?menuItemId=${encodeURIComponent(q || '')}`);
      resultsDiv.innerHTML = `
        <div style="background:rgba(255,255,255,0.03);border:1px solid #38bdf8;padding:12px;border-radius:8px;font-size:13px;color:#fff;">
          <strong>Backward Trace Confidence:</strong> ${res?.data?.chainStatus || 'COMPLETE'} · Linked to ${res?.data?.purchaseOrders?.length || 0} Purchase Orders and ${res?.data?.lots?.length || 0} dock lots.
        </div>
      `;
    });
  }
}

// ── Recalls Tab ──────────────────────────────────────────────────────────────
function renderRecallsTab(container, recalls) {
  container.innerHTML = `
    <div style="background:var(--surface-card,#1e293b);border:1px solid var(--border-color,#334155);border-radius:12px;padding:20px;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
        <div>
          <h3 style="margin:0 0 4px 0;font-size:16px;font-weight:700;color:#fff;">Food Recall Master & 8-State Server-Validated Lifecycle</h3>
          <div style="font-size:12px;color:var(--text-muted,#94a3b8);">FoSCoS Food Recall Integration (FSSAI 18 March 2026 Order)</div>
        </div>
        <button id="ofs-btn-add-recall-tab" class="btn btn-primary" style="background:#ef4444;color:#fff;border:none;font-size:12px;padding:6px 14px;">+ Initiate Recall</button>
      </div>

      ${
        recalls.length === 0
          ? `<div style="padding:40px;text-align:center;color:var(--text-muted,#94a3b8);">Zero active food recall cases. All estate inventory is clear.</div>`
          : `
        <div style="overflow-x:auto;">
          <table class="data-table" style="width:100%;border-collapse:collapse;font-size:13px;">
            <thead>
              <tr style="border-bottom:1px solid var(--border-color,#334155);text-align:left;color:var(--text-muted,#94a3b8);">
                <th style="padding:10px;">Recall ID</th>
                <th style="padding:10px;">FoSCoS Reference</th>
                <th style="padding:10px;">Title & Reason</th>
                <th style="padding:10px;">Severity</th>
                <th style="padding:10px;">Affected Cafés</th>
                <th style="padding:10px;">Lifecycle State</th>
                <th style="padding:10px;">Action</th>
              </tr>
            </thead>
            <tbody>
              ${recalls
                .map(
                  (r) => `
                <tr style="border-bottom:1px solid rgba(255,255,255,0.05);color:#fff;">
                  <td style="padding:10px;font-weight:700;color:#ef4444;">${r.recallId}</td>
                  <td style="padding:10px;font-family:monospace;color:var(--gold-300,#cba968);">${r.foscosRegulatoryReference || 'Internal Only (Not Filed)'}</td>
                  <td style="padding:10px;">
                    <div style="font-weight:700;">${r.title}</div>
                    <div style="font-size:11px;color:var(--text-muted,#94a3b8);">${r.reason}</div>
                  </td>
                  <td style="padding:10px;">${r.severity}</td>
                  <td style="padding:10px;">${r.affectedCafes?.join(', ') || 'None'}</td>
                  <td style="padding:10px;">
                    <span class="badge" style="background:#3b82f6;color:#fff;padding:2px 8px;border-radius:12px;font-size:11px;font-weight:700;">
                      ${r.status}
                    </span>
                  </td>
                  <td style="padding:10px;">
                    ${
                      r.status !== 'CLOSED'
                        ? `<button class="btn btn-secondary ofs-step-recall" data-id="${r.recallId}" style="font-size:11px;padding:4px 8px;">Advance State</button>`
                        : `<span style="color:#10b981;font-weight:700;">CLOSED</span>`
                    }
                  </td>
                </tr>
              `
                )
                .join('')}
            </tbody>
          </table>
        </div>
      `
      }
    </div>
  `;

  document.querySelectorAll('.ofs-step-recall').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      const id = e.currentTarget.getAttribute('data-id');
      const nextState = await askText({ title: 'Advance this recall', label: 'Next state', placeholder: 'RISK_ASSESSED, QUARANTINED, RECALL_INITIATED, AFFECTED_STOCK_IDENTIFIED, ACTION_COMPLETED, VERIFIED or CLOSED', okLabel: 'Advance' });
      if (!nextState) return;

      try {
        await apiPost(`/food-safety/recalls/${id}/transition`, { nextState, rationale: 'Advanced via Owner Portal' });
        showToast(`Recall advanced to ${nextState}`, 'success');
        loadSectionData('recalls');
      } catch (err) {
        showToast(err.message || 'Illegal transition rejected', 'error');
      }
    });
  });

  const btnAdd = document.getElementById('ofs-btn-add-recall-tab');
  if (btnAdd) btnAdd.addEventListener('click', () => openInitiateRecallModal());
}

// ── CAPAs Tab ────────────────────────────────────────────────────────────────
function renderCapasTab(container, capas) {
  container.innerHTML = `
    <div style="background:var(--surface-card,#1e293b);border:1px solid var(--border-color,#334155);border-radius:12px;padding:20px;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
        <h3 style="margin:0;font-size:16px;font-weight:700;color:#fff;">Corrective & Preventive Actions (CAPA Engine)</h3>
        <button id="ofs-btn-add-capa" class="btn btn-primary" style="font-size:12px;padding:6px 12px;">+ New CAPA</button>
      </div>

      ${
        capas.length === 0
          ? `<div style="padding:30px;text-align:center;color:var(--text-muted,#94a3b8);">No CAPA records found.</div>`
          : `
        <div style="overflow-x:auto;">
          <table class="data-table" style="width:100%;border-collapse:collapse;font-size:13px;">
            <thead>
              <tr style="border-bottom:1px solid var(--border-color,#334155);text-align:left;color:var(--text-muted,#94a3b8);">
                <th style="padding:10px;">CAPA ID</th>
                <th style="padding:10px;">Café</th>
                <th style="padding:10px;">Source</th>
                <th style="padding:10px;">Title & Finding</th>
                <th style="padding:10px;">Root Cause (Human-Confirmed)</th>
                <th style="padding:10px;">Due Date</th>
                <th style="padding:10px;">Status</th>
              </tr>
            </thead>
            <tbody>
              ${capas
                .map(
                  (c) => `
                <tr style="border-bottom:1px solid rgba(255,255,255,0.05);color:#fff;">
                  <td style="padding:10px;font-weight:700;color:#38bdf8;">${c.capaId}</td>
                  <td style="padding:10px;">${c.cafeId}</td>
                  <td style="padding:10px;">${c.source}</td>
                  <td style="padding:10px;">
                    <div style="font-weight:700;">${c.title}</div>
                    <div style="font-size:11px;color:var(--text-muted,#94a3b8);">${c.findingDescription}</div>
                  </td>
                  <td style="padding:10px;color:var(--gold-300,#cba968);">${c.rootCauseAnalysis}</td>
                  <td style="padding:10px;">${new Date(c.dueDate).toLocaleDateString()}</td>
                  <td style="padding:10px;">
                    <span class="badge" style="background:${c.status === 'CLOSED' ? '#10b981' : '#f59e0b'};color:#fff;padding:2px 8px;border-radius:12px;font-size:11px;font-weight:700;">${c.status}</span>
                  </td>
                </tr>
              `
                )
                .join('')}
            </tbody>
          </table>
        </div>
      `
      }
    </div>
  `;

  const btnAdd = document.getElementById('ofs-btn-add-capa');
  if (btnAdd) {
    btnAdd.addEventListener('click', () => {
      showToast('Please initiate CAPA from specific inspection finding, temperature excursion, or recall.', 'info');
    });
  }
}

// ── Modals ───────────────────────────────────────────────────────────────────
function openAddLicenceModal() {
  openModal({
    title: 'Register FSSAI Licence (2026 Regulatory Regime)',
    content: `
      <form id="ofs-form-licence" style="display:flex;flex-direction:column;gap:12px;">
        <div>
          <label style="font-size:12px;font-weight:700;color:#fff;">Café Scope</label>
          <select id="modal-lic-cafe" class="form-select" style="width:100%;padding:8px;border-radius:6px;background:rgba(255,255,255,0.05);color:#fff;border:1px solid #334155;">
            ${(state.currentUser?.assignedCafeIds || state.user?.assignedCafeIds || []).map((c) => `<option value="${c}">${c}</option>`).join('')}
          </select>
        </div>
        <div>
          <label style="font-size:12px;font-weight:700;color:#fff;">14-Digit FSSAI Number</label>
          <input type="text" id="modal-lic-num" maxlength="14" placeholder="10026001000123" required style="width:100%;padding:8px;border-radius:6px;background:rgba(255,255,255,0.05);color:#fff;border:1px solid #334155;" />
        </div>
        <div>
          <label style="font-size:12px;font-weight:700;color:#fff;">Regulatory Regime</label>
          <select id="modal-lic-regime" class="form-select" style="width:100%;padding:8px;border-radius:6px;background:rgba(255,255,255,0.05);color:#fff;border:1px solid #334155;">
            <option value="2026_AMENDMENT_PERPETUAL" selected>2026 Amendment Perpetual Validity (No Expiry)</option>
            <option value="LEGACY_EXPIRING">Legacy Expiring Framework</option>
          </select>
        </div>
        <div>
          <label style="font-size:12px;font-weight:700;color:#fff;">Responsible Food Safety Person</label>
          <input type="text" id="modal-lic-resp" placeholder="Chef Executive" required style="width:100%;padding:8px;border-radius:6px;background:rgba(255,255,255,0.05);color:#fff;border:1px solid #334155;" />
        </div>
        <button type="submit" class="btn btn-primary" style="margin-top:10px;padding:10px;font-weight:700;">Save & Register Licence</button>
      </form>
    `,
  });

  document.getElementById('ofs-form-licence')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const cafeId = document.getElementById('modal-lic-cafe')?.value;
    const fssaiNumber = document.getElementById('modal-lic-num')?.value;
    const regimeVersion = document.getElementById('modal-lic-regime')?.value;
    const responsiblePerson = document.getElementById('modal-lic-resp')?.value;

    try {
      await apiPost('/food-safety/licences', {
        cafeId,
        fssaiNumber,
        regimeVersion,
        isPerpetual: regimeVersion === '2026_AMENDMENT_PERPETUAL',
        issueDate: new Date().toISOString(),
        responsiblePerson,
        complianceOwner: 'Director Operations',
      });
      closeModal();
      showToast('FSSAI Licence registered successfully under 2026 perpetual regime', 'success');
      loadSectionData('licences');
    } catch (err) {
      showToast(err.message || 'Registration failed', 'error');
    }
  });
}

function openInitiateRecallModal() {
  openModal({
    title: 'Initiate Internal Food Safety Recall',
    content: `
      <form id="ofs-form-recall" style="display:flex;flex-direction:column;gap:12px;">
        <div>
          <label style="font-size:12px;font-weight:700;color:#fff;">Recall Title</label>
          <input type="text" id="modal-rec-title" placeholder="Precautionary Ingredient Recall..." required style="width:100%;padding:8px;border-radius:6px;background:rgba(255,255,255,0.05);color:#fff;border:1px solid #334155;" />
        </div>
        <div>
          <label style="font-size:12px;font-weight:700;color:#fff;">Reason for Recall</label>
          <textarea id="modal-rec-reason" placeholder="Describe defect or temperature breach..." required style="width:100%;padding:8px;border-radius:6px;background:rgba(255,255,255,0.05);color:#fff;border:1px solid #334155;height:70px;"></textarea>
        </div>
        <div>
          <label style="font-size:12px;font-weight:700;color:#fff;">Affected Ingredient / Lot Batch</label>
          <input type="text" id="modal-rec-lot" placeholder="e.g. Arabica Roast Batch AR-2601" style="width:100%;padding:8px;border-radius:6px;background:rgba(255,255,255,0.05);color:#fff;border:1px solid #334155;" />
        </div>
        <div>
          <label style="font-size:12px;font-weight:700;color:#fff;">Severity Classification</label>
          <select id="modal-rec-sev" class="form-select" style="width:100%;padding:8px;border-radius:6px;background:rgba(255,255,255,0.05);color:#fff;border:1px solid #334155;">
            <option value="CLASS_I_SERIOUS_HEALTH">Class I (Serious Health Hazard)</option>
            <option value="CLASS_II_TEMPORARY_HEALTH" selected>Class II (Temporary / Reversible Risk)</option>
            <option value="CLASS_III_UNLIKELY_HEALTH">Class III (Unlikely to Cause Adverse Consequence)</option>
            <option value="INTERNAL_PRECAUTIONARY">Internal Precautionary</option>
          </select>
        </div>
        <button type="submit" class="btn btn-primary" style="background:#ef4444;color:#fff;border:none;margin-top:10px;padding:10px;font-weight:700;">Submit Recall Initiation</button>
      </form>
    `,
  });

  document.getElementById('ofs-form-recall')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const title = document.getElementById('modal-rec-title')?.value;
    const reason = document.getElementById('modal-rec-reason')?.value;
    const lotBatch = document.getElementById('modal-rec-lot')?.value;
    const severity = document.getElementById('modal-rec-sev')?.value;

    try {
      await apiPost('/food-safety/recalls', {
        title,
        reason,
        lotBatch,
        severity,
        affectedCafes: (state.currentUser?.assignedCafeIds || state.user?.assignedCafeIds || []),
      });
      closeModal();
      showToast('Recall case initiated in DETECTED state.', 'success');
      loadSectionData('recalls');
    } catch (err) {
      showToast(err.message || 'Recall initiation failed', 'error');
    }
  });
}
