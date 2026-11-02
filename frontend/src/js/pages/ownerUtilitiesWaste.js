// =============================================================================
// ZAMORIN CAFÉ ERP — STAGE 14: UTILITIES, WASTE & ENERGY MANAGEMENT CENTRE
// Owner Strategic Expansion Workspace
// =============================================================================

import { apiGet, apiPost } from '../apiClient.js';
import { showToast, skeleton, openModal, closeModal } from '../components.js';
import { icon } from '../icons.js';
import { state } from '../state.js';

let activeSection = 'overview';
let cachedDashboard = null;
let cachedSwm = null;

export function setOwnerUtilitiesWasteSection(sec) {
  activeSection = sec || 'overview';
}

export function renderOwnerUtilitiesWaste() {
  return `
    <div class="page-enter owner-utilities-waste-workspace" style="display:flex;flex-direction:column;gap:20px;padding-bottom:60px;">
      <!-- Header -->
      <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:16px;">
        <div>
          <div style="display:inline-flex;align-items:center;gap:6px;padding:4px 10px;background:rgba(34,197,94,0.12);border:1px solid rgba(34,197,94,0.3);border-radius:20px;font-size:11px;font-weight:700;color:#4ade80;letter-spacing:0.5px;margin-bottom:8px;">
            <span style="width:6px;height:6px;border-radius:50%;background:#22c55e;"></span>
            OWNER STRATEGIC EXPANSION · STAGE 14
          </div>
          <h1 style="font-size:24px;font-weight:800;color:var(--text-primary,#fff);margin:0 0 4px 0;letter-spacing:-0.5px;">
            Utilities, Waste & Energy Management Centre
          </h1>
          <div style="font-size:13px;color:var(--text-muted,#94a3b8);">
            Meter Governance · SWM Rules 2026 Applicability · RUCO 25% TPC Limit · Zero Double Counting
          </div>
        </div>

        <div style="display:flex;gap:10px;align-items:center;">
          <button id="ouw-btn-uco" class="btn btn-secondary" style="display:inline-flex;align-items:center;gap:6px;padding:8px 14px;background:rgba(34,197,94,0.2);color:#86efac;border:1px solid rgba(34,197,94,0.4);border-radius:8px;font-size:13px;font-weight:700;cursor:pointer;">
            ${icon('flame')} Log Used Cooking Oil (RUCO)
          </button>
          <button id="ouw-btn-reading" class="btn btn-primary" style="display:inline-flex;align-items:center;gap:6px;padding:8px 14px;background:var(--gold-500,#96733a);color:#fff;border:none;border-radius:8px;font-size:13px;font-weight:700;cursor:pointer;">
            ${icon('plus')} Record Meter Reading
          </button>
        </div>
      </div>

      <!-- Navigation Tabs -->
      <div style="display:flex;gap:8px;border-bottom:1px solid var(--border-color,#334155);padding-bottom:8px;overflow-x:auto;">
        <button class="tab-btn ${activeSection === 'overview' ? 'active' : ''}" data-section="overview" style="padding:8px 16px;border-radius:6px;border:none;background:${activeSection === 'overview' ? 'var(--gold-500,#96733a)' : 'transparent'};color:${activeSection === 'overview' ? '#fff' : 'var(--text-muted,#94a3b8)'};font-weight:700;font-size:13px;cursor:pointer;">
          Consumption & KPIs
        </button>
        <button class="tab-btn ${activeSection === 'swm' ? 'active' : ''}" data-section="swm" style="padding:8px 16px;border-radius:6px;border:none;background:${activeSection === 'swm' ? 'var(--gold-500,#96733a)' : 'transparent'};color:${activeSection === 'swm' ? '#fff' : 'var(--text-muted,#94a3b8)'};font-weight:700;font-size:13px;cursor:pointer;">
          Solid Waste 2026 Applicability
        </button>
      </div>

      <!-- Content Area -->
      <div id="ouw-content-area">
        ${skeleton(4, 80)}
      </div>
    </div>
  `;
}

export async function initOwnerUtilitiesWaste() {
  const container = document.getElementById('ouw-content-area');
  if (!container) return;

  // Bind Tabs
  document.querySelectorAll('.owner-utilities-waste-workspace .tab-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      const sec = e.currentTarget.dataset.section;
      setOwnerUtilitiesWasteSection(sec);
      document.querySelectorAll('.owner-utilities-waste-workspace .tab-btn').forEach((b) => {
        b.style.background = 'transparent';
        b.style.color = 'var(--text-muted,#94a3b8)';
      });
      e.currentTarget.style.background = 'var(--gold-500,#96733a)';
      e.currentTarget.style.color = '#fff';
      renderSection();
    });
  });

  const btnUco = document.getElementById('ouw-btn-uco');
  if (btnUco) btnUco.addEventListener('click', openUcoModal);

  const btnReading = document.getElementById('ouw-btn-reading');
  if (btnReading) btnReading.addEventListener('click', openReadingModal);

  await loadData();
  renderSection();
}

function resolveCafeId() {
  return (
    state.currentCafeId ||
    state.user?.primaryCafeId ||
    state.user?.assignedCafeIds?.[0] ||
    ""
  );
}

async function loadData() {
  try {
    const cafeId = resolveCafeId();
    // The per-café SWM evaluation is scoped by authorize()'s café-access check.
    // Without a real assigned café the request would 403 — skip it instead of
    // inventing a café id and showing a false error.
    const requests = [apiGet('/utilities-waste/dashboard')];
    if (cafeId) {
      requests.push(apiGet(`/utilities-waste/swm-2026/${encodeURIComponent(cafeId)}`));
    }
    const [dashRes, swmRes] = await Promise.all(requests);
    if (dashRes && dashRes.success) cachedDashboard = dashRes.data;
    if (swmRes && swmRes.success) cachedSwm = swmRes.data;
  } catch (err) {
    console.warn('Utilities waste load notice:', err.message);
  }
}

function renderSection() {
  const container = document.getElementById('ouw-content-area');
  if (!container) return;

  if (activeSection === 'overview') {
    renderOverview(container);
  } else if (activeSection === 'swm') {
    renderSwm(container);
  }
}

function renderOverview(container) {
  const d = cachedDashboard || {
    totalElectricityKwh: 0,
    totalWaterLitres: 0,
    normalizedKpis: { electricityKwhPerThousandSales: null, electricityKwhPerBill: null, waterLitresPerHundredBills: null }
  };

  container.innerHTML = `
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:16px;">
      <div style="background:var(--surface-color,#1e293b);padding:16px;border-radius:8px;border:1px solid var(--border-color,#334155);">
        <div style="font-size:12px;color:var(--text-muted,#94a3b8);font-weight:700;">TOTAL ELECTRICITY</div>
        <div style="font-size:24px;font-weight:800;color:#fff;margin-top:6px;">${d.totalElectricityKwh} kWh</div>
      </div>
      <div style="background:var(--surface-color,#1e293b);padding:16px;border-radius:8px;border:1px solid var(--border-color,#334155);">
        <div style="font-size:12px;color:var(--text-muted,#94a3b8);font-weight:700;">ELECTRICITY / ₹1,000 SALES</div>
        <div style="font-size:24px;font-weight:800;color:#fb923c;margin-top:6px;">
          ${d.normalizedKpis.electricityKwhPerThousandSales !== null ? `${d.normalizedKpis.electricityKwhPerThousandSales} kWh` : 'UNAVAILABLE'}
        </div>
      </div>
      <div style="background:var(--surface-color,#1e293b);padding:16px;border-radius:8px;border:1px solid var(--border-color,#334155);">
        <div style="font-size:12px;color:var(--text-muted,#94a3b8);font-weight:700;">TOTAL WATER</div>
        <div style="font-size:24px;font-weight:800;color:#38bdf8;margin-top:6px;">${d.totalWaterLitres} L</div>
      </div>
      <div style="background:var(--surface-color,#1e293b);padding:16px;border-radius:8px;border:1px solid var(--border-color,#334155);">
        <div style="font-size:12px;color:var(--text-muted,#94a3b8);font-weight:700;">WATER / 100 BILLS</div>
        <div style="font-size:24px;font-weight:800;color:#4ade80;margin-top:6px;">
          ${d.normalizedKpis.waterLitresPerHundredBills !== null ? `${d.normalizedKpis.waterLitresPerHundredBills} L` : 'UNAVAILABLE'}
        </div>
      </div>
    </div>

    <div style="background:var(--surface-color,#1e293b);padding:20px;border-radius:8px;border:1px solid var(--border-color,#334155);margin-top:20px;">
      <h3 style="font-size:16px;font-weight:700;color:#fff;margin:0 0 12px 0;">FSSAI RUCO 25% TPC Governance</h3>
      <p style="font-size:13px;color:var(--text-muted,#94a3b8);margin:0 0 8px 0;">
        • Cooking oil exceeding 25% Total Polar Compounds (TPC) is permanently prohibited from food preparation.
      </p>
      <p style="font-size:13px;color:var(--text-muted,#94a3b8);margin:0 0 8px 0;">
        • Discarded used cooking oil cannot re-enter food inventory and must be handed to authorized collectors with verified evidence.
      </p>
      <p style="font-size:13px;color:var(--text-muted,#94a3b8);margin:0;">
        • Unsupported sustainability claims (net-zero, green café, carbon neutral) are suppressed.
      </p>
    </div>
  `;
}

function renderSwm(container) {
  const swm = cachedSwm || {
    isBulkWasteGenerator: false,
    bulkWasteClassificationRationale: 'Evaluated under MoEFCC Solid Waste Management Rules 2026.'
  };

  container.innerHTML = `
    <div style="background:var(--surface-color,#1e293b);padding:20px;border-radius:8px;border:1px solid var(--border-color,#334155);">
      <h3 style="font-size:16px;font-weight:700;color:#fff;margin:0 0 12px 0;">
        MoEFCC Solid Waste Management Rules, 2026 (S.O. 388(E))
      </h3>
      <div style="padding:12px;background:rgba(0,0,0,0.2);border-radius:6px;border:1px solid var(--border-color,#334155);margin-bottom:16px;">
        <div style="font-weight:700;color:${swm.isBulkWasteGenerator ? '#f87171' : '#4ade80'};">
          ${swm.isBulkWasteGenerator ? 'BULK WASTE GENERATOR (BWG) CLASSIFIED' : 'COMMERCIAL ESTABLISHMENT (NOT BULK WASTE GENERATOR)'}
        </div>
        <div style="font-size:13px;color:var(--text-muted,#94a3b8);margin-top:6px;">
          ${swm.bulkWasteClassificationRationale}
        </div>
      </div>
      <div style="font-size:13px;color:var(--text-muted,#94a3b8);line-height:1.6;">
        Under current statutory baseline S.O. 388(E) dated 27 January 2026, cafés generating less than 100 kg/day are NOT classified as Bulk Waste Generators. Standard source segregation (biodegradable, recyclable, hazardous, sanitary) applies without artificial BWG mandates.
      </div>
    </div>
  `;
}

function openUcoModal() {
  openModal('Log Used Cooking Oil (RUCO)', `
    <form id="form-new-uco" style="display:flex;flex-direction:column;gap:14px;">
      <div>
        <label style="display:block;font-size:12px;font-weight:700;margin-bottom:4px;">Quantity (Litres) *</label>
        <input type="number" id="uco-qty" value="15" required style="width:100%;padding:8px;border-radius:6px;border:1px solid var(--border-color,#334155);background:var(--surface-color,#1e293b);color:#fff;" />
      </div>
      <div>
        <label style="display:block;font-size:12px;font-weight:700;margin-bottom:4px;">Total Polar Compounds (TPC %) *</label>
        <input type="number" step="0.1" id="uco-tpc" value="26.5" required style="width:100%;padding:8px;border-radius:6px;border:1px solid var(--border-color,#334155);background:var(--surface-color,#1e293b);color:#fff;" />
      </div>
      <div>
        <label style="display:block;font-size:12px;font-weight:700;margin-bottom:4px;">Authorized Collector Name</label>
        <input type="text" id="uco-col" placeholder="e.g. EcoBio Collectors Pvt Ltd" required style="width:100%;padding:8px;border-radius:6px;border:1px solid var(--border-color,#334155);background:var(--surface-color,#1e293b);color:#fff;" />
      </div>
      <div style="display:flex;justify-content:flex-end;gap:10px;margin-top:10px;">
        <button type="button" id="uco-cancel" class="btn btn-secondary" style="padding:8px 14px;background:transparent;border:1px solid var(--border-color,#334155);color:var(--text-muted,#94a3b8);border-radius:6px;">Cancel</button>
        <button type="submit" class="btn btn-primary" style="padding:8px 14px;background:var(--gold-500,#96733a);color:#fff;border:none;border-radius:6px;font-weight:700;">Record UCO</button>
      </div>
    </form>
  `);

  document.getElementById('uco-cancel')?.addEventListener('click', closeModal);
  document.getElementById('form-new-uco')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const payload = {
      cafeId: resolveCafeId(),
      quantityLiters: Number(document.getElementById('uco-qty').value),
      totalPolarCompoundsPercent: Number(document.getElementById('uco-tpc').value),
      collectorName: document.getElementById('uco-col').value.trim()
    };
    try {
      const res = await apiPost('/utilities-waste/used-cooking-oil', payload);
      if (res && res.success) {
        showToast(res.data.tpcSafetyAlert, 'success');
        closeModal();
        await loadData();
        renderSection();
      } else {
        showToast(res.error || 'Failed to record UCO', 'error');
      }
    } catch (err) {
      showToast(err.message || 'API error', 'error');
    }
  });
}

function openReadingModal() {
  openModal('Record Meter Reading', `
    <form id="form-new-reading" style="display:flex;flex-direction:column;gap:14px;">
      <div>
        <label style="display:block;font-size:12px;font-weight:700;margin-bottom:4px;">Meter ID *</label>
        <input type="text" id="rdg-mtr" placeholder="e.g. MTR-ELEC-01" required style="width:100%;padding:8px;border-radius:6px;border:1px solid var(--border-color,#334155);background:var(--surface-color,#1e293b);color:#fff;" />
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
        <div>
          <label style="display:block;font-size:12px;font-weight:700;margin-bottom:4px;">Start Reading *</label>
          <input type="number" id="rdg-start" value="1000" required style="width:100%;padding:8px;border-radius:6px;border:1px solid var(--border-color,#334155);background:var(--surface-color,#1e293b);color:#fff;" />
        </div>
        <div>
          <label style="display:block;font-size:12px;font-weight:700;margin-bottom:4px;">End Reading *</label>
          <input type="number" id="rdg-end" value="1250" required style="width:100%;padding:8px;border-radius:6px;border:1px solid var(--border-color,#334155);background:var(--surface-color,#1e293b);color:#fff;" />
        </div>
      </div>
      <div style="display:flex;justify-content:flex-end;gap:10px;margin-top:10px;">
        <button type="button" id="rdg-cancel" class="btn btn-secondary" style="padding:8px 14px;background:transparent;border:1px solid var(--border-color,#334155);color:var(--text-muted,#94a3b8);border-radius:6px;">Cancel</button>
        <button type="submit" class="btn btn-primary" style="padding:8px 14px;background:var(--gold-500,#96733a);color:#fff;border:none;border-radius:6px;font-weight:700;">Submit Reading</button>
      </div>
    </form>
  `);

  document.getElementById('rdg-cancel')?.addEventListener('click', closeModal);
  document.getElementById('form-new-reading')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const payload = {
      meterId: document.getElementById('rdg-mtr').value.trim(),
      startReading: Number(document.getElementById('rdg-start').value),
      endReading: Number(document.getElementById('rdg-end').value),
      periodStart: new Date(Date.now() - 24 * 3600000).toISOString(),
      periodEnd: new Date().toISOString()
    };
    try {
      const res = await apiPost('/utilities-waste/readings', payload);
      if (res && res.success) {
        showToast('Meter reading recorded', 'success');
        closeModal();
        await loadData();
        renderSection();
      } else {
        showToast(res.error || 'Failed to record reading', 'error');
      }
    } catch (err) {
      showToast(err.message || 'API error', 'error');
    }
  });
}

export {
  initOwnerUtilitiesWaste as initOwnerUtilitiesWasteEvents,
  initOwnerUtilitiesWaste as wireOwnerUtilitiesWaste,
};
