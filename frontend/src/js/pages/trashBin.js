// =============================================================================
// PAGE: Trash Bin, Recovery & Data Disposition — SCR-024
//
// Enterprise Soft-Delete Recovery, Retention Governance, Preservation Holds,
// Disposition Review, Multi-Store Deletion Propagation & ZURF Certificates.
//
// LOCATION: Administration → Data Management → Trash Bin & Recovery
// PERMISSIONS: MASTER ONLY (Or explicitly authorized governance auditors)
// =============================================================================

import { apiGet, apiPost, apiDelete } from '../apiClient.js';
import { showToast, skeleton, confirmAction } from '../components.js';
import { debounce } from '../utils/debounce.js';

let _activeTab = 'active'; // active | expiring | holds | review | certificates | policies
let _searchQuery = '';
let _selectedModule = 'ALL';
let _selectedCafe = 'ALL';
let _kpis = { inTrash: 0, expiringSoon: 0, onHold: 0, pendingDisposition: 0, certificatesIssued: 0 };
let _emergencyPause = { isPaused: false, reason: '' };

function escHtml(v) {
  return String(v ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function formatDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function statusPill(status, isHoldActive) {
  if (isHoldActive) {
    return `<span class="pill pill-amber" style="font-size:10px; font-weight:700;">⚖️ ON HOLD</span>`;
  }
  switch (status) {
    case 'RECOVERABLE':
      return `<span class="pill pill-mint" style="font-size:10px;">Recoverable</span>`;
    case 'EXPIRING_SOON':
      return `<span class="pill pill-coral" style="font-size:10px;">Expiring Soon</span>`;
    case 'DISPOSITION_REVIEW':
      return `<span class="pill pill-amber" style="font-size:10px;">Review Queue</span>`;
    case 'DISPOSITION_APPROVED':
      return `<span class="pill pill-mint" style="font-size:10px;">Ready for Purge</span>`;
    case 'DISPOSED':
      return `<span class="pill pill-dark" style="font-size:10px;">Disposed</span>`;
    case 'RESTORED':
      return `<span class="pill pill-mint" style="font-size:10px;">Restored</span>`;
    default:
      return `<span class="pill pill-dark" style="font-size:10px;">${escHtml(status)}</span>`;
  }
}

export function renderTrashBin() {
  return `
    <div class="page-enter" style="padding-bottom:60px;">
      <!-- Page Header -->
      <div class="page-header" style="display:flex; justify-content:space-between; align-items:flex-start; flex-wrap:wrap; gap:16px; margin-bottom:24px;">
        <div>
          <div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap;">
            <h1 class="page-title" style="font-size:26px; font-weight:700; color:var(--ink); margin:0;">
              Trash Bin, Recovery &amp; Data Disposition
            </h1>
            <span class="badge" style="background:rgba(180,83,9,0.12); color:#b45309; font-weight:600; font-size:12px; padding:4px 10px; border-radius:12px;">SCR-028 TRASH</span>
          </div>
          <p class="page-subtitle" style="font-size:14px; color:var(--muted); margin:4px 0 0 0;">
            Administration → Data Management · Governed recovery, retention holds &amp; multi-store purge
          </p>
        </div>
        <div style="display:flex; gap:10px; align-items:center; flex-wrap:wrap;">
          <button class="btn btn-secondary" id="trash-refresh-btn" type="button" style="font-weight:600;">↻ Refresh Register</button>
          <button class="btn btn-ghost" id="trash-emergency-pause-btn" type="button" style="border-color:var(--color-accent-coral); color:var(--color-accent-coral); font-weight:600;">
            ${_emergencyPause.isPaused ? '▶ Resume Disposition' : '⏸ Pause Disposition'}
          </button>
        </div>
      </div>

      <!-- Emergency Pause Notice if active -->
      <div id="trash-emergency-banner" style="display:${_emergencyPause.isPaused ? 'block' : 'none'}; padding:12px 18px; margin-bottom:18px; background:rgba(255,100,80,0.12); border-left:4px solid var(--color-accent-coral); border-radius:6px;">
        <div style="color:var(--color-accent-coral); font-weight:700; font-size:13px;">⚠ Automated &amp; Manual Permanent Disposition is PAUSED</div>
        <div style="color:var(--muted); font-size:11.5px; margin-top:2px;">
          Circuit breaker active: ${_emergencyPause.reason || 'Manual hold in effect'}. Soft-deleted records remain safe in recoverable state.
        </div>
      </div>

      <!-- KPI Summary Cards -->
      <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap:12px; margin-bottom:22px;">
        <div class="card" style="padding:16px; background:var(--surface); border:1px solid var(--line); border-radius:10px;">
          <div style="color:var(--muted); font-size:10.5px; font-weight:700; letter-spacing:0.5px;">IN ACTIVE TRASH</div>
          <div style="color:var(--ink); font-size:24px; font-weight:800; font-family:var(--font-mono); margin-top:4px;" id="kpi-in-trash">${_kpis.inTrash}</div>
          <div style="color:var(--muted); font-size:11px; margin-top:2px;">Recoverable items</div>
        </div>
        <div class="card" style="padding:16px; background:var(--surface); border:1px solid var(--line); border-radius:10px;">
          <div style="color:var(--muted); font-size:10.5px; font-weight:700; letter-spacing:0.5px;">EXPIRING SOON (&lt;7d)</div>
          <div style="color:var(--color-accent-coral); font-size:24px; font-weight:800; font-family:var(--font-mono); margin-top:4px;" id="kpi-expiring">${_kpis.expiringSoon}</div>
          <div style="color:var(--muted); font-size:11px; margin-top:2px;">Retention completing</div>
        </div>
        <div class="card" style="padding:16px; background:var(--surface); border:1px solid var(--line); border-radius:10px;">
          <div style="color:var(--muted); font-size:10.5px; font-weight:700; letter-spacing:0.5px;">PRESERVATION HOLDS</div>
          <div style="color:var(--color-accent-amber); font-size:24px; font-weight:800; font-family:var(--font-mono); margin-top:4px;" id="kpi-holds">${_kpis.onHold}</div>
          <div style="color:var(--muted); font-size:11px; margin-top:2px;">Purge strictly blocked</div>
        </div>
        <div class="card" style="padding:16px; background:var(--surface); border:1px solid var(--line); border-radius:10px;">
          <div style="color:var(--muted); font-size:10.5px; font-weight:700; letter-spacing:0.5px;">DISPOSITION REVIEW</div>
          <div style="color:var(--ink); font-size:24px; font-weight:800; font-family:var(--font-mono); margin-top:4px;" id="kpi-review">${_kpis.pendingDisposition}</div>
          <div style="color:var(--muted); font-size:11px; margin-top:2px;">Maker-checker queue</div>
        </div>
        <div class="card" style="padding:16px; background:var(--surface); border:1px solid var(--line); border-radius:10px;">
          <div style="color:var(--muted); font-size:10.5px; font-weight:700; letter-spacing:0.5px;">PROOF CERTIFICATES</div>
          <div style="color:var(--color-accent-mint-bright); font-size:24px; font-weight:800; font-family:var(--font-mono); margin-top:4px;" id="kpi-certs">${_kpis.certificatesIssued}</div>
          <div style="color:var(--muted); font-size:11px; margin-top:2px;">ZURF verified purges</div>
        </div>
      </div>

      <!-- Navigation Tabs -->
      <div class="flex gap-sm" style="margin-bottom:18px; border-bottom:1px solid var(--line); padding-bottom:8px; overflow-x:auto;">
        ${[
          { id: 'active', label: 'Active Trash' },
          { id: 'expiring', label: 'Expiring Soon' },
          { id: 'holds', label: 'Preservation Holds' },
          { id: 'review', label: 'Disposition Review' },
          { id: 'certificates', label: 'Disposition Register & Certificates' },
          { id: 'policies', label: 'Retention Policies' },
        ].map(t => `
          <button class="btn btn-ghost btn-sm ${(_activeTab === t.id ? 'selected' : '')}" data-trash-tab="${t.id}" type="button" style="white-space:nowrap;">
            ${t.label}
          </button>
        `).join('')}
      </div>

      <!-- Search & Filters Bar -->
      <div class="card" style="padding:14px 18px; margin-bottom:18px; display:flex; gap:12px; align-items:center; flex-wrap:wrap; border-radius:10px; background:var(--surface); border:1px solid var(--line);">
        <div style="flex:1; min-width:200px; position:relative;">
          <input
            id="trash-search-input"
            class="input-field"
            type="text"
            value="${escHtml(_searchQuery)}"
            placeholder="Search deleted records by title, SKU, reference, or reason..."
            style="width:100%; padding:9px 12px 9px 34px; font-size:13px; background:var(--surface-sunken); color:var(--ink); border:1px solid var(--line); border-radius:6px;"
          />
          <span style="position:absolute; left:12px; top:50%; transform:translateY(-50%); font-size:14px; color:var(--muted);">🔍</span>
        </div>

        <select id="trash-module-filter" class="input-field" style="padding:9px 12px; font-size:13px; min-width:140px; background:var(--surface); color:var(--ink); border:1px solid var(--line); border-radius:6px;">
          <option value="ALL">All Modules</option>
          <option value="INVENTORY">Inventory</option>
          <option value="MENU">Menu Management</option>
          <option value="VENDOR">Vendors</option>
          <option value="CUSTOMERS">Customers</option>
          <option value="DEPARTMENT_ORDERS">Department Orders</option>
          <option value="ASSETS">Assets</option>
          <option value="QUALITY">Quality</option>
        </select>

        <select id="trash-cafe-filter" class="input-field" style="padding:9px 12px; font-size:13px; min-width:130px; background:var(--surface); color:var(--ink); border:1px solid var(--line); border-radius:6px;">
          <option value="ALL">All Cafés</option>
          <option value="GLOBAL">Global Catalogue</option>
        </select>
      </div>

      <!-- Main Content Area -->
      <div class="card" style="padding:20px; border-radius:10px; background:var(--surface); border:1px solid var(--line);" id="trash-main-container">
        ${skeleton('240px')}
      </div>

      <!-- Preflight / Details Drawer Container -->
      <div id="trash-modal-container"></div>
    </div>`;
}

export async function wireTrashBin(root) {
  // Tab Switching
  root.querySelectorAll('[data-trash-tab]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      _activeTab = e.currentTarget.dataset.trashTab;
      root.querySelectorAll('[data-trash-tab]').forEach((b) => b.classList.remove('selected'));
      e.currentTarget.classList.add('selected');
      _loadTabContent(root);
    });
  });

  // Search input
  const searchInput = root.querySelector('#trash-search-input');
  if (searchInput) {
    const handleTrashSearch = debounce((val) => {
      _searchQuery = val;
      _loadTabContent(root);
    }, 250);

    searchInput.addEventListener('input', (e) => {
      handleTrashSearch(e.target.value);
    });
  }

  // Filters
  root.querySelector('#trash-module-filter')?.addEventListener('change', (e) => {
    _selectedModule = e.target.value;
    _loadTabContent(root);
  });

  root.querySelector('#trash-cafe-filter')?.addEventListener('change', (e) => {
    _selectedCafe = e.target.value;
    _loadTabContent(root);
  });

  apiGet('/cafes').then((res) => {
    const cafes = res?.data?.cafes;
    const filter = root.querySelector('#trash-cafe-filter');
    if (filter && Array.isArray(cafes) && cafes.length > 0) {
      filter.innerHTML = `
        <option value="ALL">All Cafés</option>
        <option value="GLOBAL">Global Catalogue</option>
        ${cafes.map((c) => `<option value="${c.code || c.id || c._id}">${c.name} (${c.code || c.id || c._id})</option>`).join('')}
      `;
      filter.value = _selectedCafe || 'ALL';
    }
  }).catch(() => {});

  // Refresh button
  root.querySelector('#trash-refresh-btn')?.addEventListener('click', () => {
    _loadTabContent(root);
  });

  // Emergency Pause Toggle
  root.querySelector('#trash-emergency-pause-btn')?.addEventListener('click', async () => {
    const nextState = !_emergencyPause.isPaused;
    let reason = '';
    if (nextState) {
      reason = window.prompt('Enter reason for pausing permanent disposition globally:') || 'Manual emergency pause';
    }
    try {
      const res = await apiPost('/trash/emergency-pause', { pause: nextState, reason });
      _emergencyPause = { isPaused: nextState, reason };
      showToast(res?.message || 'Emergency pause state updated.', 'mint');
      wireTrashBin(root);
    } catch (err) {
      showToast(err?.message || 'Could not toggle emergency pause.', 'coral');
    }
  });

  // Initial tab load
  await _loadTabContent(root);
}

async function _loadTabContent(root) {
  const container = root.querySelector('#trash-main-container');
  if (!container) return;

  container.innerHTML = skeleton('200px');

  try {
    if (_activeTab === 'certificates') {
      await _renderCertificatesTab(root, container);
    } else if (_activeTab === 'policies') {
      await _renderPoliciesTab(root, container);
    } else {
      await _renderTrashListTab(root, container);
    }
  } catch (err) {
    container.innerHTML = `
      <div style="padding:24px; text-align:center;">
        <div style="font-size:24px; margin-bottom:8px;">⚠️</div>
        <div style="color:var(--ink); font-weight:600; font-size:14px;">Unable to load Trash records</div>
        <div style="color:var(--muted); font-size:12px; margin-top:4px;">
          ${escHtml(err?.message || 'Your authorised session could not be verified.')}
        </div>
        <button class="btn btn-ghost btn-sm" id="trash-retry-btn" type="button" style="margin-top:14px;">Try Again</button>
      </div>`;
    container.querySelector('#trash-retry-btn')?.addEventListener('click', () => _loadTabContent(root));
  }
}

// ── Tab: Active / Expiring / Holds / Review Trash Items ───────────────────────

const SAMPLE_TRASH_ITEMS = [];

async function _renderTrashListTab(root, container) {
  const params = new URLSearchParams();
  if (_selectedModule !== 'ALL') params.set('module', _selectedModule);
  if (_selectedCafe !== 'ALL') params.set('cafeId', _selectedCafe);
  if (_searchQuery.trim()) params.set('search', _searchQuery.trim());
  if (_activeTab === 'expiring') params.set('status', 'EXPIRING_SOON');
  if (_activeTab === 'holds') params.set('status', 'ON_HOLD');
  if (_activeTab === 'review') params.set('status', 'DISPOSITION_REVIEW');

  let data = {};
  let items = [];
  try {
    const res = await apiGet(`/trash?${params.toString()}`);
    data = res?.data || {};
    items = data.items || [];
  } catch (e) {
    items = [];
    data = {
      items: [],
      kpis: { inTrash: 0, expiringSoon: 0, onHold: 0, pendingDisposition: 0, certificatesIssued: 0 }
    };
  }

  // Update KPIs
  if (data.kpis) {
    _kpis = data.kpis;
    const elTrash = root.querySelector('#kpi-in-trash');
    const elExp = root.querySelector('#kpi-expiring');
    const elHolds = root.querySelector('#kpi-holds');
    const elRev = root.querySelector('#kpi-review');
    const elCerts = root.querySelector('#kpi-certs');
    if (elTrash) elTrash.textContent = _kpis.inTrash ?? 0;
    if (elExp) elExp.textContent = _kpis.expiringSoon ?? 0;
    if (elHolds) elHolds.textContent = _kpis.onHold ?? 0;
    if (elRev) elRev.textContent = _kpis.pendingDisposition ?? 0;
    if (elCerts) elCerts.textContent = _kpis.certificatesIssued ?? 0;
  }

  if (data.emergencyPause) {
    _emergencyPause = data.emergencyPause;
    const banner = root.querySelector('#trash-emergency-banner');
    if (banner) banner.style.display = _emergencyPause.isPaused ? 'block' : 'none';
  }

  if (!items.length) {
    container.innerHTML = `
      <div style="padding:36px; text-align:center;">
        <div style="font-size:28px; margin-bottom:8px;">🗑️</div>
        <div style="color:var(--ink); font-weight:600; font-size:14px;">No records found in this view</div>
        <div style="color:var(--muted); font-size:12px; margin-top:4px;">
          Soft-deleted items across eligible ERP modules will appear here with retention timers.
        </div>
      </div>`;
    return;
  }

  container.innerHTML = `
    <div style="overflow-x:auto;">
      <table class="glass-table" style="width:100%; border-collapse:collapse; font-size:12.5px;">
        <thead>
          <tr style="border-bottom:1px solid var(--line); text-align:left;">
            <th style="padding:10px 12px; color:var(--muted); font-weight:600; font-size:11px;">RECORD / TITLE</th>
            <th style="padding:10px 12px; color:var(--muted); font-weight:600; font-size:11px;">MODULE</th>
            <th style="padding:10px 12px; color:var(--muted); font-weight:600; font-size:11px;">CAFÉ</th>
            <th style="padding:10px 12px; color:var(--muted); font-weight:600; font-size:11px;">DELETED BY</th>
            <th style="padding:10px 12px; color:var(--muted); font-weight:600; font-size:11px;">DELETED DATE</th>
            <th style="padding:10px 12px; color:var(--muted); font-weight:600; font-size:11px;">RETENTION EXPIRY</th>
            <th style="padding:10px 12px; color:var(--muted); font-weight:600; font-size:11px;">STATUS</th>
            <th style="padding:10px 12px; color:var(--muted); font-weight:600; font-size:11px; text-align:right;">ACTIONS</th>
          </tr>
        </thead>
        <tbody>
          ${items.map((i) => `
            <tr style="border-top:1px solid var(--line);">
              <td style="padding:12px;">
                <div style="color:var(--ink); font-weight:600;">${escHtml(i.recordTitle)}</div>
                <div style="color:var(--muted); font-size:11px; margin-top:2px;">Ref: ${escHtml(i.recordReference || i.recordId)} · ID: ${escHtml(i.trashId)}</div>
              </td>
              <td style="padding:12px;"><span class="pill pill-dark" style="font-size:9.5px;">${escHtml(i.sourceModule || i.module)}</span></td>
              <td style="padding:12px;"><span style="color:var(--muted);">${escHtml(i.cafeId)}</span></td>
              <td style="padding:12px;">
                <div style="color:var(--ink);">${escHtml(i.deletedByName || i.deletedByUserId)}</div>
                <div style="color:var(--muted); font-size:10px;">${escHtml(i.deleteReason || '')}</div>
              </td>
              <td style="padding:12px; color:var(--muted);">${formatDate(i.deletedAt)}</td>
              <td style="padding:12px;">
                <div style="color:${i.daysRemaining <= 7 ? 'var(--color-accent-coral)' : 'var(--ink)'}; font-weight:${i.daysRemaining <= 7 ? '700' : '400'};">
                  ${formatDate(i.retentionExpiresAt || i.expiresAt)}
                </div>
                <div style="color:var(--muted); font-size:10px;">${i.daysRemaining} days left</div>
              </td>
              <td style="padding:12px;">${statusPill(i.lifecycleStatus || i.status, i.isHoldActive || i.hasHold)}</td>
              <td style="padding:12px; text-align:right;">
                <div style="display:flex; justify-content:flex-end; gap:6px;">
                  <button class="btn btn-ghost btn-sm" data-trash-action="details" data-trash-id="${escHtml(i.trashId)}" type="button" style="padding:4px 8px; font-size:11px;">Details</button>
                  ${i.lifecycleStatus !== 'RESTORED' && i.lifecycleStatus !== 'DISPOSED' ? `
                    <button class="btn btn-primary btn-sm" data-trash-action="restore-preview" data-trash-id="${escHtml(i.trashId)}" type="button" style="padding:4px 8px; font-size:11px;">Restore</button>
                  ` : ''}
                  ${!i.isHoldActive && i.lifecycleStatus !== 'DISPOSED' ? `
                    <button class="btn btn-ghost btn-sm" data-trash-action="hold" data-trash-id="${escHtml(i.trashId)}" type="button" style="padding:4px 8px; font-size:11px; border-color:var(--color-accent-amber); color:var(--color-accent-amber);">Hold</button>
                  ` : ''}
                  ${i.isHoldActive ? `
                    <button class="btn btn-ghost btn-sm" data-trash-action="release-hold" data-trash-id="${escHtml(i.trashId)}" data-hold-id="${escHtml(i.holds?.[0]?.holdId || '')}" type="button" style="padding:4px 8px; font-size:11px;">Release</button>
                  ` : ''}
                  ${i.lifecycleStatus === 'DISPOSITION_APPROVED' ? `
                    <button class="btn btn-ghost btn-sm" data-trash-action="purge" data-trash-id="${escHtml(i.trashId)}" type="button" style="padding:4px 8px; font-size:11px; border-color:var(--color-accent-coral); color:var(--color-accent-coral);">Purge</button>
                  ` : ''}
                </div>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>`;

  _wireRowActions(root);
}

function _wireRowActions(root) {
  // Details Modal
  root.querySelectorAll('[data-trash-action="details"]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const trashId = btn.dataset.trashId;
      try {
        const res = await apiGet(`/trash/${trashId}`);
        _showDetailsModal(root, res?.data);
      } catch (err) {
        showToast(err?.message || 'Could not fetch record details.', 'coral');
      }
    });
  });

  // Restore Preflight Preview & Execution
  root.querySelectorAll('[data-trash-action="restore-preview"]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const trashId = btn.dataset.trashId;
      try {
        const res = await apiGet(`/trash/${trashId}/preview-restore`);
        _showRestorePreflightModal(root, trashId, res?.data);
      } catch (err) {
        showToast(err?.message || 'Could not simulate restore preflight.', 'coral');
      }
    });
  });

  // Hold placement
  root.querySelectorAll('[data-trash-action="hold"]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const trashId = btn.dataset.trashId;
      const reason = window.prompt('Enter legal or audit justification to place preservation hold:');
      if (!reason?.trim()) return;

      try {
        const res = await apiPost(`/trash/${trashId}/holds`, { reason: reason.trim() });
        showToast(res?.message || 'Preservation hold placed.', 'mint');
        _loadTabContent(root);
      } catch (err) {
        showToast(err?.message || 'Could not place hold.', 'coral');
      }
    });
  });

  // Hold release
  root.querySelectorAll('[data-trash-action="release-hold"]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const trashId = btn.dataset.trashId;
      const holdId = btn.dataset.holdId;
      const reason = window.prompt('Enter reason for releasing preservation hold:');
      if (!reason?.trim()) return;

      try {
        await apiDelete(`/trash/${trashId}/holds/${holdId}`);
        showToast('Preservation hold released.', 'mint');
        _loadTabContent(root);
      } catch (err) {
        showToast(err?.message || 'Could not release hold.', 'coral');
      }
    });
  });

  // Purge execution
  root.querySelectorAll('[data-trash-action="purge"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const trashId = btn.dataset.trashId;
      confirmAction({
        title: 'PERMANENT DATA DISPOSITION',
        message: 'This will permanently destroy the business record across primary database, search index, and object storage. A ZURF compliance certificate will be issued. Proceed?',
        onConfirm: async () => {
          try {
            const res = await apiPost(`/trash/${trashId}/purge`);
            showToast(res?.message || 'Permanent disposition completed.', 'mint');
            _loadTabContent(root);
          } catch (err) {
            showToast(err?.message || 'Disposition purge failed.', 'coral');
          }
        },
      });
    });
  });
}

// ── Tab: Certificates & Proof of Deletion ────────────────────────────────────

async function _renderCertificatesTab(root, container) {
  let certs = [];
  try {
    const res = await apiGet('/trash/certificates');
    certs = res?.data?.certificates || [];
  } catch (e) {
    certs = [];
  }

  if (!certs.length) {
    container.innerHTML = `
      <div style="padding:36px; text-align:center;">
        <div style="font-size:28px; margin-bottom:8px;">📜</div>
        <div style="color:var(--ink); font-weight:600; font-size:14px;">No disposition certificates issued yet</div>
        <div style="color:var(--muted); font-size:12px; margin-top:4px;">
          Governed permanent purges produce immutable ZURF v1 compliance certificates recorded here.
        </div>
      </div>`;
    return;
  }

  container.innerHTML = `
    <div style="overflow-x:auto;">
      <table class="glass-table" style="width:100%; border-collapse:collapse; font-size:12.5px;">
        <thead>
          <tr style="border-bottom:1px solid var(--line); text-align:left;">
            <th style="padding:10px 12px; color:var(--muted); font-weight:600; font-size:11px;">CERTIFICATE ID</th>
            <th style="padding:10px 12px; color:var(--muted); font-weight:600; font-size:11px;">RECORD REFERENCE</th>
            <th style="padding:10px 12px; color:var(--muted); font-weight:600; font-size:11px;">SOURCE MODULE</th>
            <th style="padding:10px 12px; color:var(--muted); font-weight:600; font-size:11px;">EXECUTED BY</th>
            <th style="padding:10px 12px; color:var(--muted); font-weight:600; font-size:11px;">DISPOSITION DATE</th>
            <th style="padding:10px 12px; color:var(--muted); font-weight:600; font-size:11px; text-align:right;">ACTION</th>
          </tr>
        </thead>
        <tbody>
          ${certs.map((c) => `
            <tr style="border-top:1px solid var(--line);">
              <td style="padding:12px; color:var(--color-accent-mint-bright); font-weight:700;">${escHtml(c.certificateId)}</td>
              <td style="padding:12px; color:var(--ink); font-weight:600;">${escHtml(c.recordReference)}</td>
              <td style="padding:12px;"><span class="pill pill-dark" style="font-size:9.5px;">${escHtml(c.sourceModule)}</span></td>
              <td style="padding:12px; color:var(--muted);">${escHtml(c.executedByUserId)}</td>
              <td style="padding:12px; color:var(--muted);">${formatDate(c.executedAt)}</td>
              <td style="padding:12px; text-align:right;">
                <button class="btn btn-ghost btn-sm" data-cert-id="${escHtml(c.certificateId)}" type="button" style="padding:4px 8px; font-size:11px;">View ZURF Proof</button>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>`;

  container.querySelectorAll('[data-cert-id]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const certId = btn.dataset.certId;
      try {
        const certRes = await apiGet(`/trash/certificates/${certId}/pdf`);
        const html = certRes?.data?.html;
        if (html) {
          const win = window.open('', '_blank');
          win.document.write(html);
          win.document.close();
        }
      } catch (err) {
        showToast(err?.message || 'Could not render certificate PDF.', 'coral');
      }
    });
  });
}

// ── Tab: Retention Policies ──────────────────────────────────────────────────

async function _renderPoliciesTab(root, container) {
  let policies = [];
  try {
    const res = await apiGet('/trash/policies');
    policies = res?.data?.policies || [];
  } catch (e) {
    policies = [];
  }

  if (!policies.length) {
    container.innerHTML = `
      <div style="padding:36px; text-align:center;">
        <div style="font-size:28px; margin-bottom:8px;">⚖️</div>
        <div style="color:var(--ink); font-weight:600; font-size:14px;">No custom retention policies configured</div>
        <div style="color:var(--muted); font-size:12px; margin-top:4px;">
          Default statutory schedules apply across standard ERP records.
        </div>
      </div>`;
    return;
  }

  container.innerHTML = `
    <div style="margin-bottom:16px;">
      <div style="color:var(--ink); font-weight:600; font-size:14px;">Configured Data Retention Schedules</div>
      <div style="color:var(--muted); font-size:12px; margin-top:2px;">
        Statutory and operational retention schedules governing soft-delete lifetimes and disposition approval gates.
      </div>
    </div>
    <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap:14px;">
      ${policies.map((p) => `
        <div class="card" style="padding:16px; border-radius:8px; border-left:3px solid var(--color-accent-mint-bright); background:var(--surface);">
          <div style="color:var(--ink); font-weight:600; font-size:13.5px;">${escHtml(p.name)}</div>
          <div style="color:var(--muted); font-size:11px; margin-top:4px;">Entity: <strong>${escHtml(p.entityType)}</strong> · Classification: ${escHtml(p.dataClassification)}</div>
          <div style="margin-top:12px; display:flex; justify-content:space-between; align-items:center; border-top:1px solid var(--line); padding-top:10px;">
            <div style="color:var(--muted); font-size:11px;">Retention: <strong>${p.retentionDurationDays} days</strong></div>
            <span class="pill pill-${p.dispositionReviewRequired ? 'amber' : 'dark'}" style="font-size:9px;">
              ${p.dispositionReviewRequired ? 'Review Required' : 'Auto Eligible'}
            </span>
          </div>
        </div>
      `).join('')}
    </div>`;
}

// ── Modals: Record Details & Restore Preflight ────────────────────────────────

function _showDetailsModal(root, item) {
  const modalContainer = root.querySelector('#trash-modal-container');
  if (!modalContainer || !item) return;

  modalContainer.innerHTML = `
    <div class="modal-overlay active" style="position:fixed; inset:0; background:rgba(0,0,0,0.5); display:flex; align-items:center; justify-content:center; z-index:9999; padding:20px;">
      <div class="card" style="background:var(--surface); color:var(--ink); border:1px solid var(--line); max-width:620px; width:100%; border-radius:12px; padding:24px; max-height:85vh; overflow-y:auto; box-shadow:var(--shadow-lg);">
        <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:16px; border-bottom:1px solid var(--line); padding-bottom:12px;">
          <div>
            <div style="color:var(--ink); font-size:16px; font-weight:700;">${escHtml(item.recordTitle)}</div>
            <div style="color:var(--muted); font-size:12px; margin-top:2px;">Ref: ${escHtml(item.recordReference)} · ${escHtml(item.trashId)}</div>
          </div>
          <button class="btn btn-ghost btn-sm" id="trash-modal-close" type="button">✕</button>
        </div>

        <div style="display:grid; grid-template-columns: 1fr 1fr; gap:14px; margin-bottom:18px;">
          <div>
            <div style="color:var(--muted); font-size:10.5px; font-weight:700;">SOURCE MODULE</div>
            <div style="color:var(--ink); font-size:13px; margin-top:2px;">${escHtml(item.sourceModule)}</div>
          </div>
          <div>
            <div style="color:var(--muted); font-size:10.5px; font-weight:700;">CAFÉ SCOPE</div>
            <div style="color:var(--ink); font-size:13px; margin-top:2px;">${escHtml(item.cafeId)}</div>
          </div>
          <div>
            <div style="color:var(--muted); font-size:10.5px; font-weight:700;">DELETED BY</div>
            <div style="color:var(--ink); font-size:13px; margin-top:2px;">${escHtml(item.deletedByName || item.deletedByUserId)}</div>
          </div>
          <div>
            <div style="color:var(--muted); font-size:10.5px; font-weight:700;">DELETION REASON</div>
            <div style="color:var(--ink); font-size:13px; margin-top:2px;">${escHtml(item.deleteReason)}</div>
          </div>
          <div>
            <div style="color:var(--muted); font-size:10.5px; font-weight:700;">RETENTION EXPIRY</div>
            <div style="color:var(--ink); font-size:13px; margin-top:2px;">${formatDate(item.expiresAt)} (${item.daysRemaining}d left)</div>
          </div>
          <div>
            <div style="color:var(--muted); font-size:10.5px; font-weight:700;">HOLD STATUS</div>
            <div style="color:var(--ink); font-size:13px; margin-top:2px;">${item.isHoldActive ? 'Active Preservation Hold' : 'None'}</div>
          </div>
        </div>

        ${item.deleteNote ? `
          <div style="padding:12px; background:var(--surface-sunken); border:1px solid var(--line); border-radius:6px; margin-bottom:18px;">
            <div style="color:var(--muted); font-size:10.5px; font-weight:700;">DELETION NOTE</div>
            <div style="color:var(--ink); font-size:12.5px; margin-top:2px;">${escHtml(item.deleteNote)}</div>
          </div>
        ` : ''}

        <div style="display:flex; justify-content:flex-end; gap:8px;">
          <button class="btn btn-ghost btn-sm" id="trash-modal-close-btn" type="button">Close</button>
        </div>
      </div>
    </div>`;

  const close = () => (modalContainer.innerHTML = '');
  modalContainer.querySelector('#trash-modal-close')?.addEventListener('click', close);
  modalContainer.querySelector('#trash-modal-close-btn')?.addEventListener('click', close);
}

function _showRestorePreflightModal(root, trashId, sim) {
  const modalContainer = root.querySelector('#trash-modal-container');
  if (!modalContainer || !sim) return;

  modalContainer.innerHTML = `
    <div class="modal-overlay active" style="position:fixed; inset:0; background:rgba(0,0,0,0.5); display:flex; align-items:center; justify-content:center; z-index:9999; padding:20px;">
      <div class="card" style="background:var(--surface); color:var(--ink); border:1px solid var(--line); max-width:580px; width:100%; border-radius:12px; padding:24px; box-shadow:var(--shadow-lg);">
        <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:16px; border-bottom:1px solid var(--line); padding-bottom:12px;">
          <div>
            <div style="color:var(--ink); font-size:16px; font-weight:700;">Restore Preflight Simulation</div>
            <div style="color:var(--muted); font-size:12px; margin-top:2px;">${escHtml(sim.recordTitle)} (${escHtml(sim.recordReference)})</div>
          </div>
          <button class="btn btn-ghost btn-sm" id="trash-sim-close" type="button">✕</button>
        </div>

        <div style="padding:14px; background:var(--success-soft); border-left:3px solid var(--success); border-radius:6px; margin-bottom:16px;">
          <div style="color:var(--success); font-weight:700; font-size:12px;">PROPOSED RESTORE STATE</div>
          <div style="color:var(--ink); font-size:13px; margin-top:2px;">${escHtml(sim.proposedState)}</div>
          <div style="color:var(--muted); font-size:11px; margin-top:2px;">Source module safety rules prevent premature live reactivation.</div>
        </div>

        ${sim.conflicts?.length > 0 ? `
          <div style="padding:12px; background:rgba(255,100,80,0.1); border-left:3px solid var(--color-accent-coral); border-radius:6px; margin-bottom:16px;">
            <div style="color:var(--color-accent-coral); font-weight:700; font-size:12px;">UNIQUE CONFLICTS DETECTED</div>
            ${sim.conflicts.map(c => `<div style="color:#fff; font-size:12px; margin-top:2px;">• ${escHtml(c)}</div>`).join('')}
          </div>
        ` : ''}

        ${sim.warnings?.length > 0 ? `
          <div style="padding:12px; background:rgba(212,175,55,0.1); border-left:3px solid var(--color-accent-amber); border-radius:6px; margin-bottom:16px;">
            <div style="color:var(--color-accent-amber); font-weight:700; font-size:12px;">SAFETY WARNINGS</div>
            ${sim.warnings.map(w => `<div style="color:#fff; font-size:12px; margin-top:2px;">• ${escHtml(w)}</div>`).join('')}
          </div>
        ` : ''}

        <div style="display:flex; justify-content:flex-end; gap:8px; margin-top:20px;">
          <button class="btn btn-ghost btn-sm" id="trash-sim-cancel" type="button">Cancel</button>
          ${sim.canRestore ? `
            <button class="btn btn-primary btn-sm" id="trash-sim-confirm" type="button">Confirm Domain Restore</button>
          ` : `
            <button class="btn btn-ghost btn-sm" disabled type="button" style="opacity:0.5;">Restore Blocked</button>
          `}
        </div>
      </div>
    </div>`;

  const close = () => (modalContainer.innerHTML = '');
  modalContainer.querySelector('#trash-sim-close')?.addEventListener('click', close);
  modalContainer.querySelector('#trash-sim-cancel')?.addEventListener('click', close);

  modalContainer.querySelector('#trash-sim-confirm')?.addEventListener('click', async () => {
    try {
      const res = await apiPost('/trash/restore', { trashId });
      showToast(res?.message || 'Record restored successfully.', 'mint');
      close();
      _loadTabContent(root);
    } catch (err) {
      showToast(err?.message || 'Restore failed.', 'coral');
    }
  });
}
