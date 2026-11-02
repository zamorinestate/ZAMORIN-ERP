import { askText } from "../utils/dialogs.js";
// =============================================================================
// ZAMORIN CAFÉ ERP — SCREEN: ORGANISATION IDENTITY MASTER
// Standard compliance: Sections 364–395 (EXPORT_ENGINE_COMPANY_IDENTITY_MASTER_STANDARD.md)
//
// Gated administrative page for viewing and versioning the canonical Company Identity.
// Default state: READ-ONLY — primary details displayed in a rich info panel.
// Edit requires: "Unlock to Edit" confirmation interstitial (Primary Master / Owner only).
// All changes create a new immutable version and are audit-logged.
// =============================================================================

import { showToast, confirmAction } from '../components.js';
import { apiGet, apiPost, apiPut, ApiClientError } from '../apiClient.js';
import { state } from '../state.js';
import { icon } from '../icons.js';
import { navigate } from '../router.js';

// ─── Module State ─────────────────────────────────────────────────────────────

let orgIdentityState = {
  data: null,
  history: [],
  isUnlocked: false,
  isLoading: true,
  isSaving: false,
  activeTab: 'overview', // 'overview' | 'statutory' | 'contact' | 'banking' | 'history'
  errors: {},
};

// ─── Render ───────────────────────────────────────────────────────────────────

export function renderOrgIdentity(subroute) {
  return `
    <div class="page-enter" id="org-identity-root" style="padding-bottom: 60px;">
      <!-- Page Header -->
      <div class="page-header" style="margin-bottom:0;">
        <div>
          <div class="page-header-eyebrow">Administration · Restricted</div>
          <h1 class="page-title" style="font-size:1.5rem;">Organisation Identity Master</h1>
          <p class="page-subtitle" style="margin-top:2px;">
            Canonical company profile, statutory registrations, and export branding baseline.
          </p>
        </div>
        <div id="oi-header-actions" style="display:flex;gap:8px;align-items:center;flex-shrink:0;">
          ${_renderHeaderActions()}
        </div>
      </div>

      <!-- Lock Banner -->
      <div id="oi-lock-banner" class="notice-banner notice-info" style="margin:16px 0 0 0;${orgIdentityState.isUnlocked ? 'display:none;' : ''}">
        ${icon('lock', 15)}
        <span><strong>Read-Only Mode.</strong> This record is locked. Use "Unlock to Edit" to make authorised modifications.</span>
      </div>
      <div id="oi-edit-banner" class="notice-banner notice-warning" style="margin:16px 0 0 0;${orgIdentityState.isUnlocked ? '' : 'display:none;'}">
        ${icon('alert', 15)}
        <span><strong>Edit Mode Active.</strong> You are editing a statutory identity record. Every change creates a new audited version.</span>
      </div>

      <!-- Sub-Navigation Tabs -->
      <div class="tab-nav" id="oi-tab-nav" style="margin-top:18px;">
        ${_renderTabNav()}
      </div>

      <!-- Content Area -->
      <div id="oi-content-area" style="margin-top:18px;">
        ${_renderLoadingState()}
      </div>
    </div>
  `;
}

function _renderHeaderActions() {
  const isPrimary = Boolean(state.user?.isPrimaryMaster);
  const isOwner = state.role === 'owner';
  const canEdit = isPrimary || isOwner;

  if (!canEdit) {
    return `<span class="badge-tag badge-neutral">${icon('lock', 12)} View Only</span>`;
  }

  if (orgIdentityState.isUnlocked) {
    return `
      <button id="oi-cancel-edit-btn" class="btn btn-sm btn-secondary">
        ${icon('close', 14)} Cancel Edit
      </button>
      <button id="oi-save-btn" class="btn btn-sm btn-primary" ${orgIdentityState.isSaving ? 'disabled' : ''}>
        ${orgIdentityState.isSaving ? '...' : icon('save', 14) + ' Save & Version'}
      </button>
    `;
  }

  return `
    <button id="oi-unlock-btn" class="btn btn-sm btn-secondary">
      ${icon('lock', 14)} Unlock to Edit
    </button>
  `;
}

function _renderTabNav() {
  const tabs = [
    { id: 'overview', label: 'Overview & Branding' },
    { id: 'statutory', label: 'Statutory & Tax' },
    { id: 'contact', label: 'Contact & Channels' },
    { id: 'banking', label: 'Banking Details' },
    { id: 'history', label: 'Version History' },
  ];
  return tabs.map((t) => `
    <button class="tab-btn${orgIdentityState.activeTab === t.id ? ' active' : ''}" data-oi-tab="${t.id}">
      ${t.label}
    </button>
  `).join('');
}

function _renderLoadingState() {
  return `
    <div style="display:flex;flex-direction:column;gap:12px;">
      <div class="skeleton-block" style="height:120px;border-radius:12px;"></div>
      <div class="skeleton-block" style="height:80px;border-radius:12px;"></div>
      <div class="skeleton-block" style="height:160px;border-radius:12px;"></div>
    </div>
  `;
}

function _renderContent() {
  const d = orgIdentityState.data;
  if (!d) return `<div class="empty-state-block">No organisation identity configured yet.</div>`;

  switch (orgIdentityState.activeTab) {
    case 'overview': return _renderOverviewTab(d);
    case 'statutory': return _renderStatutoryTab(d);
    case 'contact': return _renderContactTab(d);
    case 'banking': return _renderBankingTab(d);
    case 'history': return _renderHistoryTab();
    default: return _renderOverviewTab(d);
  }
}

// ─── Tab Content Renderers ────────────────────────────────────────────────────

function _renderOverviewTab(d) {
  const locked = !orgIdentityState.isUnlocked;
  return `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;">
      <!-- Logo Preview -->
      <div class="card" style="grid-column:1/-1;display:flex;align-items:center;gap:24px;padding:20px 24px;">
        <div style="width:120px;height:60px;display:flex;align-items:center;justify-content:center;background:var(--surface);border-radius:10px;border:1px solid var(--border-subtle);overflow:hidden;padding:8px;">
          ${d.logo?.primarySvg || '<span style="color:var(--text-muted);font-size:12px;">No logo</span>'}
        </div>
        <div style="flex:1;">
          <div style="font-size:1.1rem;font-weight:700;color:var(--text-primary);">${d.legalName || '—'}</div>
          <div style="font-size:0.85rem;color:var(--text-muted);margin-top:2px;">${d.brandName || '—'} · ${d.tagline || ''}</div>
          <div style="margin-top:6px;">
            <span class="badge-tag badge-accent">Version ${d.version || 1}</span>
            <span class="badge-tag badge-success" style="margin-left:4px;">${d.status || 'CURRENT'}</span>
          </div>
        </div>
        <div style="text-align:right;font-size:0.78rem;color:var(--text-muted);">
          <div>Created by: ${d.createdBy || '—'}</div>
          <div>Effective: ${d.effectiveFrom ? new Date(d.effectiveFrom).toLocaleDateString('en-IN') : '—'}</div>
        </div>
      </div>

      <!-- Legal Name -->
      <div class="card" style="padding:18px 20px;">
        <div class="form-label">Legal Business Name</div>
        ${locked
          ? `<div class="detail-value">${d.legalName || '—'}</div>`
          : `<input class="form-control" id="oi-f-legalName" value="${_esc(d.legalName)}" placeholder="Full registered legal name">`
        }
      </div>

      <!-- Brand Name -->
      <div class="card" style="padding:18px 20px;">
        <div class="form-label">Trading / Brand Name</div>
        ${locked
          ? `<div class="detail-value">${d.brandName || '—'}</div>`
          : `<input class="form-control" id="oi-f-brandName" value="${_esc(d.brandName)}" placeholder="Brand name as used publicly">`
        }
      </div>

      <!-- Tagline -->
      <div class="card" style="padding:18px 20px;grid-column:1/-1;">
        <div class="form-label">Brand Tagline</div>
        ${locked
          ? `<div class="detail-value">${d.tagline || '—'}</div>`
          : `<input class="form-control" id="oi-f-tagline" value="${_esc(d.tagline)}" placeholder="Tagline displayed on exports">`
        }
      </div>

      <!-- Registered Address -->
      <div class="card" style="padding:18px 20px;grid-column:1/-1;">
        <div class="form-label">Registered Office Address</div>
        ${locked
          ? `<div class="detail-value">${_formatAddress(d.registeredAddress)}</div>`
          : `
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
              <input class="form-control" id="oi-f-addr-line1" value="${_esc(d.registeredAddress?.line1)}" placeholder="Line 1 (Street / Building)">
              <input class="form-control" id="oi-f-addr-line2" value="${_esc(d.registeredAddress?.line2)}" placeholder="Line 2 (Area / Locality)">
              <input class="form-control" id="oi-f-addr-city" value="${_esc(d.registeredAddress?.city)}" placeholder="City">
              <input class="form-control" id="oi-f-addr-state" value="${_esc(d.registeredAddress?.state)}" placeholder="State">
              <input class="form-control" id="oi-f-addr-pincode" value="${_esc(d.registeredAddress?.pincode)}" placeholder="PIN Code" maxlength="6">
              <input class="form-control" id="oi-f-addr-country" value="${_esc(d.registeredAddress?.country || 'India')}" placeholder="Country">
            </div>
          `
        }
      </div>
    </div>
  `;
}

function _renderStatutoryTab(d) {
  const locked = !orgIdentityState.isUnlocked;
  const gstins = d.gstin || [];
  const licences = d.licences || [];

  return `
    <div style="display:flex;flex-direction:column;gap:16px;">

      <!-- PAN / CIN / Udyam -->
      <div class="card" style="padding:18px 20px;">
        <div class="form-section-title" style="margin-bottom:14px;">Corporate Registration Numbers</div>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;">
          <div>
            <div class="form-label">PAN</div>
            ${locked
              ? `<div class="detail-value">${d.pan || '—'}</div>`
              : `<input class="form-control" id="oi-f-pan" value="${_esc(d.pan)}" placeholder="AABCZ1234M" maxlength="10" style="text-transform:uppercase;">`
            }
          </div>
          <div>
            <div class="form-label">CIN</div>
            ${locked
              ? `<div class="detail-value">${d.cin || '—'}</div>`
              : `<input class="form-control" id="oi-f-cin" value="${_esc(d.cin)}" placeholder="CIN" maxlength="21">`
            }
          </div>
          <div>
            <div class="form-label">UDYAM Number</div>
            ${locked
              ? `<div class="detail-value">${d.udyamNumber || '—'}</div>`
              : `<input class="form-control" id="oi-f-udyam" value="${_esc(d.udyamNumber)}" placeholder="UDYAM-XX-00-0000000">`
            }
          </div>
        </div>
      </div>

      <!-- GSTINs -->
      <div class="card" style="padding:18px 20px;">
        <div class="form-section-title" style="margin-bottom:14px;">GST Registrations (Multi-State)</div>
        ${gstins.length === 0
          ? `<div style="color:var(--text-muted);font-size:0.85rem;">No GSTINs recorded.</div>`
          : gstins.map((g, i) => `
            <div style="display:grid;grid-template-columns:auto 1fr auto;gap:12px;align-items:center;margin-bottom:10px;padding:10px 12px;background:var(--surface);border-radius:8px;border:1px solid var(--border-subtle);">
              <span class="badge-tag ${g.isPrimary ? 'badge-success' : 'badge-neutral'}">${g.isPrimary ? 'Primary' : g.state}</span>
              <span style="font-family:monospace;font-size:0.92rem;color:var(--text-primary);">${g.number}</span>
              <span style="font-size:0.78rem;color:var(--text-muted);">${g.state}</span>
            </div>
          `).join('')
        }
      </div>

      <!-- Licences (FSSAI etc.) -->
      <div class="card" style="padding:18px 20px;">
        <div class="form-section-title" style="margin-bottom:14px;">Licences &amp; Registrations</div>
        ${licences.length === 0
          ? `<div style="color:var(--text-muted);font-size:0.85rem;">No licences recorded.</div>`
          : licences.map((l) => `
            <div style="display:grid;grid-template-columns:2fr 1fr 1fr 1fr;gap:12px;align-items:center;margin-bottom:10px;padding:10px 12px;background:var(--surface);border-radius:8px;border:1px solid var(--border-subtle);">
              <div>
                <div style="font-size:0.78rem;color:var(--text-muted);">Type</div>
                <div style="font-weight:600;color:var(--text-primary);font-size:0.88rem;">${l.type}</div>
              </div>
              <div>
                <div style="font-size:0.78rem;color:var(--text-muted);">Number</div>
                <div style="font-family:monospace;font-size:0.88rem;">${l.number}</div>
              </div>
              <div>
                <div style="font-size:0.78rem;color:var(--text-muted);">Valid From</div>
                <div style="font-size:0.85rem;">${l.validFrom ? new Date(l.validFrom).toLocaleDateString('en-IN') : '—'}</div>
              </div>
              <div>
                <div style="font-size:0.78rem;color:var(--text-muted);">Valid Till</div>
                <div style="font-size:0.85rem;${_isExpiringSoon(l.validTill) ? 'color:var(--color-warning);font-weight:600;' : ''}">
                  ${l.validTill ? new Date(l.validTill).toLocaleDateString('en-IN') : '—'}
                  ${_isExpiringSoon(l.validTill) ? ' ⚠️' : ''}
                </div>
              </div>
            </div>
          `).join('')
        }
      </div>

    </div>
  `;
}

function _renderContactTab(d) {
  const locked = !orgIdentityState.isUnlocked;
  const c = d.contact || {};
  return `
    <div class="card" style="padding:18px 20px;">
      <div class="form-section-title" style="margin-bottom:14px;">Contact Channels</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;">
        ${_contactRow('Primary Phone', 'oi-f-phone', c.phone, locked)}
        ${_contactRow('Support Phone', 'oi-f-supportPhone', c.supportPhone, locked)}
        ${_contactRow('Corporate Email', 'oi-f-email', c.email, locked)}
        ${_contactRow('Support Email', 'oi-f-supportEmail', c.supportEmail, locked)}
        ${_contactRow('Website', 'oi-f-website', c.website, locked)}
        ${_contactRow('WhatsApp', 'oi-f-whatsapp', c.whatsapp, locked)}
      </div>
    </div>
  `;
}

function _contactRow(label, id, value, locked) {
  return `
    <div>
      <div class="form-label">${label}</div>
      ${locked
        ? `<div class="detail-value">${value || '—'}</div>`
        : `<input class="form-control" id="${id}" value="${_esc(value)}" placeholder="${label}">`
      }
    </div>
  `;
}

function _renderBankingTab(d) {
  const locked = !orgIdentityState.isUnlocked;
  const b = d.banking || {};
  const sig = d.authorisedSignatory || {};

  return `
    <div style="display:flex;flex-direction:column;gap:16px;">
      <div class="notice-banner notice-warning" style="margin:0;">
        ${icon('alert', 14)}
        <span>Banking details are <strong>CONFIDENTIAL</strong> and only included in Tax Invoice export documents. Handle with care.</span>
      </div>
      <div class="card" style="padding:18px 20px;">
        <div class="form-section-title" style="margin-bottom:14px;">Bank Account Details</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;">
          ${_contactRow('Account Name', 'oi-f-bankAccName', b.accountName, locked)}
          ${_contactRow('Bank Name', 'oi-f-bankName', b.bankName, locked)}
          ${_contactRow('Account Number (masked)', 'oi-f-bankAccNum', b.accountNumberMasked, locked)}
          ${_contactRow('IFSC Code', 'oi-f-bankIfsc', b.ifsc, locked)}
        </div>
      </div>
      <div class="card" style="padding:18px 20px;">
        <div class="form-section-title" style="margin-bottom:14px;">Authorised Signatory</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;">
          ${_contactRow('Name', 'oi-f-sigName', sig.name, locked)}
          ${_contactRow('Designation', 'oi-f-sigDesig', sig.designation, locked)}
        </div>
      </div>
    </div>
  `;
}

function _renderHistoryTab() {
  const h = orgIdentityState.history;
  if (!h || h.length === 0) {
    return `<div class="empty-state-block">No version history available yet.</div>`;
  }
  return `
    <div class="card" style="padding:0;overflow:hidden;">
      <table class="data-table" style="margin:0;">
        <thead>
          <tr>
            <th>Version</th>
            <th>Status</th>
            <th>Changed By</th>
            <th>Change Reason</th>
            <th>Effective From</th>
          </tr>
        </thead>
        <tbody>
          ${h.map((v) => `
            <tr>
              <td><span class="badge-tag badge-accent">v${v.version}</span></td>
              <td><span class="badge-tag ${v.status === 'CURRENT' ? 'badge-success' : 'badge-neutral'}">${v.status}</span></td>
              <td>${v.createdBy || '—'}</td>
              <td style="max-width:320px;font-size:0.85rem;color:var(--text-muted);">${v.changeReason || '—'}</td>
              <td>${v.effectiveFrom ? new Date(v.effectiveFrom).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '—'}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

// ─── Wire ─────────────────────────────────────────────────────────────────────

export async function wireOrgIdentity(root, subroute) {
  orgIdentityState.isLoading = true;
  orgIdentityState.isUnlocked = false;
  orgIdentityState.activeTab = subroute || 'overview';

  try {
    const [identityRes, historyRes] = await Promise.all([
      apiGet('/settings/company-identity'),
      apiGet('/settings/company-identity/history'),
    ]);
    orgIdentityState.data = identityRes?.data || null;
    orgIdentityState.history = historyRes?.data || [];
  } catch (err) {
    if (!(err instanceof ApiClientError && err.status === 404)) {
      showToast('Failed to load Organisation Identity. Please retry.', 'error');
    }
    orgIdentityState.data = null;
    orgIdentityState.history = [];
  } finally {
    orgIdentityState.isLoading = false;
  }

  _hydrate(root);
}

function _hydrate(root) {
  const contentArea = root.querySelector('#oi-content-area');
  const headerActions = root.querySelector('#oi-header-actions');
  const lockBanner = root.querySelector('#oi-lock-banner');
  const editBanner = root.querySelector('#oi-edit-banner');
  const tabNav = root.querySelector('#oi-tab-nav');

  if (contentArea) contentArea.innerHTML = _renderContent();
  if (headerActions) headerActions.innerHTML = _renderHeaderActions();
  if (lockBanner) lockBanner.style.display = orgIdentityState.isUnlocked ? 'none' : '';
  if (editBanner) editBanner.style.display = orgIdentityState.isUnlocked ? '' : 'none';
  if (tabNav) tabNav.innerHTML = _renderTabNav();

  _wireEvents(root);
}

function _wireEvents(root) {
  // Tab navigation
  root.querySelectorAll('[data-oi-tab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      orgIdentityState.activeTab = btn.dataset.oiTab;
      _hydrate(root);
    });
  });

  // Unlock button
  const unlockBtn = root.querySelector('#oi-unlock-btn');
  if (unlockBtn) {
    unlockBtn.addEventListener('click', async () => {
      const confirmed = await confirmAction({
        title: 'Unlock Organisation Identity',
        message: 'You are about to unlock the canonical Organisation Identity record for editing. Every change creates a new immutable version and is permanently audit-logged. Do you confirm?',
        confirmLabel: 'Yes, Unlock',
        danger: false,
      });
      if (!confirmed) return;

      try {
        await apiPost('/settings/company-identity/unlock', {});
        orgIdentityState.isUnlocked = true;
        showToast('Organisation Identity unlocked for editing.', 'success');
        _hydrate(root);
      } catch (err) {
        showToast(err?.message || 'Failed to unlock. You may not have the required authority.', 'error');
      }
    });
  }

  // Cancel edit button
  const cancelBtn = root.querySelector('#oi-cancel-edit-btn');
  if (cancelBtn) {
    cancelBtn.addEventListener('click', () => {
      orgIdentityState.isUnlocked = false;
      _hydrate(root);
    });
  }

  // Save button
  const saveBtn = root.querySelector('#oi-save-btn');
  if (saveBtn) {
    saveBtn.addEventListener('click', async () => {
      const payload = _collectFormData(root);
      if (!payload) return;

      const confirmed = await confirmAction({
        title: 'Save & Create New Version',
        message: 'This will create a new immutable version of the Organisation Identity. The previous version will be superseded. This action is permanent and audit-logged.',
        confirmLabel: 'Confirm Save',
        danger: true,
      });
      if (!confirmed) return;

      const changeReason = await askText({ title: 'Reason for this change', label: 'Required for the audit trail (at least 5 characters)', validate: (v) => (v.length >= 5 ? '' : 'Enter at least 5 characters.') });
      if (!changeReason || changeReason.trim().length < 5) {
        showToast('A change reason (min 5 characters) is required for statutory audit.', 'warning');
        return;
      }

      orgIdentityState.isSaving = true;
      _hydrate(root);

      try {
        const res = await apiPut('/settings/company-identity', {
          updates: payload,
          changeReason: changeReason.trim(),
        });
        orgIdentityState.data = res?.data || orgIdentityState.data;
        orgIdentityState.isUnlocked = false;
        orgIdentityState.isSaving = false;
        // Refresh history
        try {
          const hRes = await apiGet('/settings/company-identity/history');
          orgIdentityState.history = hRes?.data || [];
        } catch (_) {}
        showToast(`Organisation Identity saved — Version ${res?.data?.version || ''}.`, 'success');
        _hydrate(root);
      } catch (err) {
        orgIdentityState.isSaving = false;
        showToast(err?.message || 'Failed to save Organisation Identity.', 'error');
        _hydrate(root);
      }
    });
  }
}

function _collectFormData(root) {
  const g = (id) => root.querySelector(`#${id}`)?.value?.trim() || '';

  const activeTab = orgIdentityState.activeTab;

  if (activeTab === 'overview') {
    return {
      legalName: g('oi-f-legalName'),
      brandName: g('oi-f-brandName'),
      tagline: g('oi-f-tagline'),
      registeredAddress: {
        line1: g('oi-f-addr-line1'),
        line2: g('oi-f-addr-line2'),
        city: g('oi-f-addr-city'),
        state: g('oi-f-addr-state'),
        pincode: g('oi-f-addr-pincode'),
        country: g('oi-f-addr-country') || 'India',
      },
    };
  }

  if (activeTab === 'statutory') {
    return {
      pan: g('oi-f-pan').toUpperCase(),
      cin: g('oi-f-cin'),
      udyamNumber: g('oi-f-udyam'),
    };
  }

  if (activeTab === 'contact') {
    return {
      contact: {
        phone: g('oi-f-phone'),
        supportPhone: g('oi-f-supportPhone'),
        email: g('oi-f-email'),
        supportEmail: g('oi-f-supportEmail'),
        website: g('oi-f-website'),
        whatsapp: g('oi-f-whatsapp'),
      },
    };
  }

  if (activeTab === 'banking') {
    return {
      banking: {
        accountName: g('oi-f-bankAccName'),
        bankName: g('oi-f-bankName'),
        accountNumberMasked: g('oi-f-bankAccNum'),
        ifsc: g('oi-f-bankIfsc'),
      },
      authorisedSignatory: {
        name: g('oi-f-sigName'),
        designation: g('oi-f-sigDesig'),
      },
    };
  }

  showToast('Nothing to save on this tab.', 'info');
  return null;
}

// ─── Utility Helpers ──────────────────────────────────────────────────────────

function _formatAddress(addr) {
  if (!addr) return '—';
  const parts = [addr.line1, addr.line2, addr.city, addr.state, addr.pincode, addr.country].filter(Boolean);
  return parts.join(', ') || '—';
}

function _isExpiringSoon(dateStr) {
  if (!dateStr) return false;
  const d = new Date(dateStr);
  const diffDays = (d - new Date()) / (1000 * 60 * 60 * 24);
  return diffDays > 0 && diffDays <= 90;
}

function _esc(str) {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
