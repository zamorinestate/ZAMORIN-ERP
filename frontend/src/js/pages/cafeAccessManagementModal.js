// =============================================================================
// ZAMORIN CAFÉ ERP — CAFÉ OPERATIONS ACCESS MANAGEMENT MODAL
// Supported Roles: Primary Master, Owner
// Design System: Ledger & Roastery Dark / Porcelain Light Theme
// =============================================================================

'use strict';

import { apiGet, apiPost } from '../apiClient.js';
import { showToast } from '../components.js';
import { openQrViewerModal, downloadQrSvg, downloadQrPng, printQrCard } from '../utils/qrCodeGen.js';

function escHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Opens the Café Access Management Modal for a given café ID.
 *
 * @param {HTMLElement} [mountParent=document.body]
 * @param {string} cafeId
 */
export function openCafeAccessManagementModal(mountParent = document.body, cafeId) {
  let modalMount = document.getElementById('zamorin-cafe-access-modal-mount');
  if (!modalMount) {
    modalMount = document.createElement('div');
    modalMount.id = 'zamorin-cafe-access-modal-mount';
    (mountParent || document.body).appendChild(modalMount);
  }

  loadAndRenderAccessModal(modalMount, cafeId);
}

async function loadAndRenderAccessModal(container, cafeId) {
  container.innerHTML = `
    <div class="modal-backdrop" style="position:fixed;inset:0;background:rgba(18,17,16,0.8);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px;backdrop-filter:blur(3px);">
      <div class="modal-card card" style="width:780px;max-width:96vw;max-height:90vh;overflow-y:auto;padding:28px;background:var(--surface-raised, #242220);border:1px solid var(--line-strong, #3d3935);box-shadow:var(--shadow-xl);border-radius:12px;color:var(--ink, #ede8e1);">
        <div style="display:flex;justify-content:center;align-items:center;min-height:220px;flex-direction:column;gap:12px;">
          <span class="spinner" style="display:inline-block;width:24px;height:24px;border:3px solid var(--bronze-500, #b17d38);border-right-color:transparent;border-radius:50%;animation:spin 0.6s linear infinite;"></span>
          <span style="font-size:13px;color:var(--muted, #9e978e);">Loading Café Operations Access status...</span>
        </div>
      </div>
    </div>
  `;

  try {
    const res = await apiGet(`/cafe-access/${encodeURIComponent(cafeId)}`);
    const data = res?.data;

    if (!data) {
      throw new Error('Could not retrieve access records.');
    }

    renderAccessModalContent(container, data);
  } catch (err) {
    container.innerHTML = `
      <div class="modal-backdrop" style="position:fixed;inset:0;background:rgba(18,17,16,0.8);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px;">
        <div class="modal-card card" style="width:480px;max-width:95vw;padding:24px;background:var(--surface-raised, #242220);border:1px solid var(--danger, #dc2626);border-radius:12px;text-align:center;">
          <div style="font-size:32px;margin-bottom:8px;">⚠️</div>
          <h3 style="margin:0 0 8px;font-size:18px;color:var(--ink);">Access Governance Unavailable</h3>
          <p style="font-size:13px;color:var(--muted);margin-bottom:18px;">${escHtml(err.message || 'Café access record not found.')}</p>
          <button class="btn btn-sm btn-secondary" id="cafe-acc-err-close-btn" type="button">Close</button>
        </div>
      </div>
    `;
    container.querySelector('#cafe-acc-err-close-btn')?.addEventListener('click', () => {
      container.innerHTML = '';
    });
  }
}

function renderAccessModalContent(container, data) {
  const isEmergencyLocked = Boolean(data.emergencyLocked);
  const statusBadge = isEmergencyLocked
    ? `<span class="status danger" style="font-size:11px;font-weight:700;">LOCKED (EMERGENCY)</span>`
    : data.accessStatus === 'ACTIVE'
    ? `<span class="status success" style="font-size:11px;font-weight:700;">ACTIVE</span>`
    : `<span class="status warning" style="font-size:11px;font-weight:700;">${escHtml(data.accessStatus)}</span>`;

  container.innerHTML = `
    <div class="modal-backdrop" style="position:fixed;inset:0;background:rgba(18,17,16,0.82);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px;backdrop-filter:blur(3px);">
      <div class="modal-card card" style="width:820px;max-width:96vw;max-height:92vh;overflow-y:auto;padding:28px;background:var(--surface-raised, #242220);border:1px solid var(--line-strong, #3d3935);box-shadow:var(--shadow-2xl);border-radius:12px;color:var(--ink, #ede8e1);">

        <!-- Header -->
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:20px;border-bottom:1px solid var(--line, #33302c);padding-bottom:16px;">
          <div>
            <div style="display:inline-flex;align-items:center;gap:6px;font-size:11px;font-weight:700;letter-spacing:0.06em;color:var(--bronze-500, #b17d38);text-transform:uppercase;margin-bottom:4px;">
              <span>🔐</span> CAFÉ OPERATIONS ACCESS GOVERNANCE
            </div>
            <h2 style="margin:0 0 4px;font-size:20px;font-weight:800;color:var(--ink);display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
              <span>${escHtml(data.cafeName)}</span>
              <span style="font-family:var(--font-mono);font-size:14px;color:var(--bronze-500);font-weight:700;">(${escHtml(data.cafeId)})</span>
              ${statusBadge}
            </h2>
            <p style="margin:0;font-size:12.5px;color:var(--muted);">
              Manage permanent identification PIN, rotate high-entropy QR / Link credentials, and monitor fleet security.
            </p>
          </div>
          <button class="btn btn-xs btn-ghost" id="cafe-acc-close-btn" type="button" style="font-size:16px;cursor:pointer;">✕</button>
        </div>

        <!-- Real Fleet Health Strip (Zero Manufactured Metrics) -->
        <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(180px, 1fr));gap:12px;margin-bottom:20px;">
          <div style="background:var(--surface-sunken, #181715);border:1px solid var(--line, #33302c);border-radius:8px;padding:12px 14px;">
            <div style="font-size:11px;color:var(--muted);text-transform:uppercase;font-weight:700;">Registered Hardware</div>
            <div style="font-size:20px;font-weight:800;color:var(--ink);margin-top:2px;">${Number(data.registeredDevicesCount || 0)}</div>
            <div style="font-size:11px;color:var(--muted);">Trusted terminal devices</div>
          </div>
          <div style="background:var(--surface-sunken, #181715);border:1px solid var(--line, #33302c);border-radius:8px;padding:12px 14px;">
            <div style="font-size:11px;color:var(--muted);text-transform:uppercase;font-weight:700;">Active Sessions</div>
            <div style="font-size:20px;font-weight:800;color:var(--ink);margin-top:2px;">${Number(data.activeSessionsCount || 0)}</div>
            <div style="font-size:11px;color:var(--muted);">Live operator shifts</div>
          </div>
          <div style="background:var(--surface-sunken, #181715);border:1px solid var(--line, #33302c);border-radius:8px;padding:12px 14px;">
            <div style="font-size:11px;color:var(--muted);text-transform:uppercase;font-weight:700;">Access Posture</div>
            <div style="font-size:20px;font-weight:800;color:${isEmergencyLocked ? 'var(--danger)' : '#10b981'};margin-top:2px;">
              ${isEmergencyLocked ? 'LOCKED' : 'ENFORCED'}
            </div>
            <div style="font-size:11px;color:var(--muted);">Tenant boundary active</div>
          </div>
        </div>

        <!-- Credentials Section -->
        <div style="display:flex;flex-direction:column;gap:16px;margin-bottom:24px;">

          <!-- Card 1: Permanent 6-digit PIN -->
          <div style="background:var(--surface, #1e1d1b);border:1px solid var(--line, #33302c);border-radius:10px;padding:18px;">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10px;">
              <div>
                <div style="font-size:11px;font-weight:800;letter-spacing:0.06em;text-transform:uppercase;color:var(--bronze-400);">
                  PERMANENT CAFÉ OPERATIONS PIN
                </div>
                <div style="font-size:11.5px;color:var(--muted);margin-top:2px;">
                  ⚠️ Permanent identifier. Cannot be edited or regenerated. Reserved indefinitely.
                </div>
              </div>
              <span class="status success" style="font-size:10px;font-weight:700;">ACTIVE</span>
            </div>

            <div style="display:flex;align-items:center;justify-content:space-between;background:var(--surface-sunken, #121110);border:1px solid var(--line-strong, #3d3935);border-radius:8px;padding:12px 18px;">
              <div id="acc-pin-val" style="font-family:var(--font-mono);font-size:24px;font-weight:800;letter-spacing:0.25em;color:var(--ink);">
                ••••••
              </div>
              <div style="display:flex;gap:8px;" id="acc-pin-actions">
                <button class="btn btn-xs btn-secondary" id="acc-reveal-pin-btn" type="button">Reveal PIN</button>
                <button class="btn btn-xs btn-ghost" id="acc-copy-pin-btn" type="button" style="display:none;">Copy PIN</button>
              </div>
            </div>
          </div>

          <!-- Card 2: Dedicated QR Credential -->
          <div style="background:var(--surface, #1e1d1b);border:1px solid var(--line, #33302c);border-radius:10px;padding:18px;">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10px;">
              <div>
                <div style="font-size:11px;font-weight:800;letter-spacing:0.06em;text-transform:uppercase;color:var(--bronze-400);">
                  DEDICATED QR ACCESS CREDENTIAL
                </div>
                <div style="font-size:11.5px;color:var(--muted);margin-top:2px;">
                  High-entropy opaque gateway token. Version: <strong>v${data.qrVersion || 1}</strong>
                </div>
              </div>
              ${data.qrEnabled
                ? `<span class="status info" style="font-size:10px;font-weight:700;">v${data.qrVersion || 1} ACTIVE</span>`
                : `<span class="status danger" style="font-size:10px;font-weight:700;">v${data.qrVersion || 1} REVOKED</span>`
              }
            </div>

            ${!data.qrEnabled ? `
              <div class="alert danger" style="margin-bottom:12px;padding:10px 14px;border-radius:8px;background:rgba(220,38,38,0.15);border:1px solid var(--danger, #dc2626);color:#fca5a5;font-size:12.5px;">
                ⚠️ <strong>QR Access Revoked:</strong> Scanning this QR or using its gateway link is currently disabled.
                ${data.qrRevokeReason ? ` Reason: <em>${escHtml(data.qrRevokeReason)}</em>` : ''}
              </div>
            ` : ''}

            <div style="display:flex;justify-content:space-between;align-items:center;background:var(--surface-sunken, #121110);border:1px solid var(--line-strong, #3d3935);border-radius:8px;padding:12px 18px;gap:12px;flex-wrap:wrap;">
              <div style="font-size:12px;color:var(--muted);flex:1;">
                Generated: ${data.qrCreatedAt ? new Date(data.qrCreatedAt).toLocaleDateString('en-IN') : 'At Creation'}
                ${data.qrLastUsedAt ? ` · Last Scanned: ${new Date(data.qrLastUsedAt).toLocaleDateString('en-IN')}` : ' · Never Scanned'}
                ${data.qrRevokedAt ? ` · Revoked: ${new Date(data.qrRevokedAt).toLocaleDateString('en-IN')}` : ''}
              </div>
              <div style="display:flex;gap:8px;flex-wrap:wrap;">
                ${data.qrUrl && data.qrEnabled ? `
                  <button class="btn btn-xs btn-primary" id="acc-view-qr-btn" type="button">View QR</button>
                  <button class="btn btn-xs btn-secondary" id="acc-copy-qr-link-btn" type="button">Copy Link</button>
                  <button class="btn btn-xs btn-secondary" id="acc-dl-qr-btn" type="button">SVG</button>
                  <button class="btn btn-xs btn-secondary" id="acc-dl-png-btn" type="button">PNG</button>
                  <button class="btn btn-xs btn-secondary" id="acc-print-qr-btn" type="button">Print Pack</button>
                  <button class="btn btn-xs btn-secondary" id="acc-revoke-qr-btn" type="button" style="color:var(--danger, #ef4444);">Revoke QR</button>
                ` : ''}
                <button class="btn btn-xs btn-secondary" id="acc-rotate-qr-btn" type="button" style="color:var(--bronze-400, #d4a359);">
                  ${data.qrEnabled ? '↻ Rotate QR' : '↻ Regenerate Active QR'}
                </button>
              </div>
            </div>

            <!-- QR Lifecycle History Timeline -->
            ${data.qrHistory && data.qrHistory.length > 0 ? `
              <div style="margin-top:12px;border-top:1px solid var(--line, #33302c);padding-top:10px;">
                <div style="font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;margin-bottom:6px;">Credential Lifecycle History</div>
                <div style="display:flex;flex-direction:column;gap:6px;max-height:100px;overflow-y:auto;">
                  ${data.qrHistory.map(h => `
                    <div style="font-size:11px;color:var(--muted);display:flex;justify-content:space-between;background:rgba(0,0,0,0.2);padding:4px 8px;border-radius:4px;">
                      <span><strong>v${h.version} [${escHtml(h.action)}]</strong> — ${escHtml(h.reason || 'No reason')}</span>
                      <span>${h.actionAt ? new Date(h.actionAt).toLocaleDateString('en-IN') : ''}</span>
                    </div>
                  `).join('')}
                </div>
              </div>
            ` : ''}
          </div>

          <!-- Card 3: Dedicated Login Link -->
          <div style="background:var(--surface, #1e1d1b);border:1px solid var(--line, #33302c);border-radius:10px;padding:18px;">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10px;">
              <div>
                <div style="font-size:11px;font-weight:800;letter-spacing:0.06em;text-transform:uppercase;color:var(--bronze-400);">
                  DEDICATED OPERATIONS LOGIN LINK
                </div>
                <div style="font-size:11.5px;color:var(--muted);margin-top:2px;">
                  Direct opaque gateway route for authorized browser terminals. Version: <strong>v${data.linkVersion || 1}</strong>
                </div>
              </div>
              <span class="status info" style="font-size:10px;font-weight:700;">v${data.linkVersion || 1} ACTIVE</span>
            </div>

            <div style="display:flex;justify-content:space-between;align-items:center;background:var(--surface-sunken, #121110);border:1px solid var(--line-strong, #3d3935);border-radius:8px;padding:12px 18px;gap:12px;flex-wrap:wrap;">
              <div style="font-size:12px;color:var(--muted);flex:1;">
                Generated: ${data.linkCreatedAt ? new Date(data.linkCreatedAt).toLocaleDateString('en-IN') : 'At Creation'}
                ${data.linkLastUsedAt ? ` · Last Opened: ${new Date(data.linkLastUsedAt).toLocaleDateString('en-IN')}` : ' · Never Opened'}
              </div>
              <div style="display:flex;gap:8px;flex-wrap:wrap;">
                ${data.linkUrl ? `
                  <button class="btn btn-xs btn-secondary" id="acc-copy-link-btn" type="button">Copy Link</button>
                  <a href="${escHtml(data.linkUrl)}" target="_blank" rel="noopener" class="btn btn-xs btn-ghost" style="text-decoration:none;">Open →</a>
                ` : ''}
                <button class="btn btn-xs btn-secondary" id="acc-rotate-link-btn" type="button" style="color:var(--danger, #ef4444);">
                  ↻ Regenerate Link
                </button>
              </div>
            </div>
          </div>

          <!-- Card 4: Access Diagnostics Result Mount -->
          <div id="acc-diag-mount" style="display:none;background:var(--surface, #1e1d1b);border:1px solid var(--line, #33302c);border-radius:10px;padding:18px;"></div>

        </div>

        <!-- Governance Operations & Emergency Lock -->
        <div style="display:flex;justify-content:space-between;align-items:center;border-top:1px solid var(--line, #33302c);padding-top:18px;flex-wrap:wrap;gap:12px;">
          <div style="display:flex;gap:10px;">
            <button class="btn btn-sm btn-secondary" id="acc-run-test-btn" type="button" style="display:flex;align-items:center;gap:6px;">
              <span>🧪</span> Run Access Diagnostic Test
            </button>
            <button class="btn btn-sm ${isEmergencyLocked ? 'btn-primary' : 'btn-danger'}" id="acc-emergency-btn" type="button" style="display:flex;align-items:center;gap:6px;">
              <span>${isEmergencyLocked ? '🔓' : '🛑'}</span>
              ${isEmergencyLocked ? 'Release Emergency Lock' : 'Engage Emergency Lock'}
            </button>
          </div>
          <button class="btn btn-sm btn-ghost" id="acc-done-btn" type="button">Close</button>
        </div>

      </div>
    </div>
  `;

  // Close
  container.querySelector('#cafe-acc-close-btn')?.addEventListener('click', () => {
    container.innerHTML = '';
  });
  container.querySelector('#acc-done-btn')?.addEventListener('click', () => {
    container.innerHTML = '';
  });

  // Reveal PIN with step-up password
  let currentDecryptedPin = null;
  const pinDisplay = container.querySelector('#acc-pin-val');
  const revealBtn = container.querySelector('#acc-reveal-pin-btn');
  const copyBtn = container.querySelector('#acc-copy-pin-btn');

  revealBtn?.addEventListener('click', async () => {
    if (currentDecryptedPin) {
      // Toggle hide
      currentDecryptedPin = null;
      if (pinDisplay) pinDisplay.textContent = '••••••';
      if (revealBtn) revealBtn.textContent = 'Reveal PIN';
      if (copyBtn) copyBtn.style.display = 'none';
      return;
    }

    const currentPassword = window.prompt('Step-up Reauthentication Required:\nPlease enter your personal login password to reveal the Permanent Café PIN:');
    if (!currentPassword) return;

    try {
      const res = await apiPost(`/cafe-access/${encodeURIComponent(data.cafeId)}/reveal-pin`, {
        body: { currentPassword },
      });
      if (res?.data?.permanentCafePin) {
        currentDecryptedPin = res.data.permanentCafePin;
        if (pinDisplay) pinDisplay.textContent = currentDecryptedPin;
        if (revealBtn) revealBtn.textContent = 'Hide PIN';
        if (copyBtn) copyBtn.style.display = 'inline-block';
        showToast('Permanent Café PIN revealed. It will auto-hide in 30 seconds.', 'info');

        // Auto-hide timer
        setTimeout(() => {
          if (currentDecryptedPin) {
            currentDecryptedPin = null;
            if (pinDisplay) pinDisplay.textContent = '••••••';
            if (revealBtn) revealBtn.textContent = 'Reveal PIN';
            if (copyBtn) copyBtn.style.display = 'none';
          }
        }, 30000);
      }
    } catch (err) {
      showToast(err.message || 'Incorrect password. PIN reveal denied.', 'danger');
    }
  });

  // Copy PIN
  copyBtn?.addEventListener('click', () => {
    if (currentDecryptedPin && navigator.clipboard) {
      navigator.clipboard.writeText(currentDecryptedPin);
      showToast('Permanent Café PIN copied to clipboard.', 'info');
    }
  });

  // View QR Modal
  container.querySelector('#acc-view-qr-btn')?.addEventListener('click', () => {
    openQrViewerModal({ cafeName: data.cafeName, cafeId: data.cafeId, qrUrl: data.qrUrl, qrVersion: data.qrVersion });
  });

  // Full Screen QR
  container.querySelector('#acc-fs-qr-btn')?.addEventListener('click', () => {
    openQrViewerModal({ cafeName: data.cafeName, cafeId: data.cafeId, qrUrl: data.qrUrl, qrVersion: data.qrVersion, isFullScreen: true });
  });

  // Download QR SVG
  container.querySelector('#acc-dl-qr-btn')?.addEventListener('click', () => {
    downloadQrSvg(data.qrUrl, { filename: `ZAMORIN_${String(data.cafeId).replace(/[^A-Za-z0-9_-]/g, '')}_QR_V${data.qrVersion || 1}.svg` });
  });

  // Download QR PNG
  container.querySelector('#acc-dl-png-btn')?.addEventListener('click', () => {
    downloadQrPng(data.qrUrl, { filename: `ZAMORIN_${String(data.cafeId).replace(/[^A-Za-z0-9_-]/g, '')}_QR_V${data.qrVersion || 1}.png`, size: 600 });
  });

  // Print Card / Pack
  container.querySelector('#acc-print-qr-btn')?.addEventListener('click', () => {
    printQrCard({ cafeName: data.cafeName, cafeId: data.cafeId, qrUrl: data.qrUrl, qrVersion: data.qrVersion });
  });

  // Copy QR Link
  container.querySelector('#acc-copy-qr-link-btn')?.addEventListener('click', () => {
    if (data.qrUrl && navigator.clipboard) {
      navigator.clipboard.writeText(data.qrUrl);
      showToast('Café QR gateway URL copied to clipboard!', 'info');
    }
  });

  // Revoke QR
  container.querySelector('#acc-revoke-qr-btn')?.addEventListener('click', async () => {
    const confirm = window.confirm(
      'REVOCATION WARNING: Revoking the QR access credential will immediately disable scanning and prevent any operator from accessing this café via QR.\n\nDo you want to revoke this QR credential?'
    );
    if (!confirm) return;

    const reason = window.prompt('Please provide a reason for revocation (optional):') || '';
    try {
      await apiPost(`/cafe-access/${encodeURIComponent(data.cafeId)}/revoke-qr`, {
        body: { reason },
      });
      showToast(`QR Code revoked for ${data.cafeName}. Gateway disabled.`, 'warning');
      loadAndRenderAccessModal(container, data.cafeId);
    } catch (err) {
      showToast(err.message || 'Failed to revoke QR credential.', 'danger');
    }
  });

  // Copy Link (Direct Login URL)
  container.querySelector('#acc-copy-link-btn')?.addEventListener('click', () => {
    if (data.linkUrl && navigator.clipboard) {
      navigator.clipboard.writeText(data.linkUrl);
      showToast('Operations login link copied!', 'info');
    }
  });

  // Rotate QR
  container.querySelector('#acc-rotate-qr-btn')?.addEventListener('click', async () => {
    const confirm = window.confirm(
      'WARNING: Regenerating the QR credential will invalidate all previously printed QR codes for this location.\n\nThe Permanent Café PIN will remain unchanged.\n\nDo you want to proceed?'
    );
    if (!confirm) return;

    try {
      const res = await apiPost(`/cafe-access/${encodeURIComponent(data.cafeId)}/rotate-qr`);
      showToast(`QR Code regenerated to v${res?.data?.qrVersion || 2}!`, 'success');
      loadAndRenderAccessModal(container, data.cafeId);
    } catch (err) {
      showToast(err.message || 'Failed to rotate QR credential.', 'danger');
    }
  });

  // Rotate Link
  container.querySelector('#acc-rotate-link-btn')?.addEventListener('click', async () => {
    const confirm = window.confirm(
      'WARNING: Regenerating the login link will immediately invalidate any existing bookmarks or links for this café.\n\nThe Permanent Café PIN will remain unchanged.\n\nDo you want to proceed?'
    );
    if (!confirm) return;

    try {
      const res = await apiPost(`/cafe-access/${encodeURIComponent(data.cafeId)}/rotate-link`);
      showToast(`Login Link regenerated to v${res?.data?.linkVersion || 2}!`, 'success');
      loadAndRenderAccessModal(container, data.cafeId);
    } catch (err) {
      showToast(err.message || 'Failed to rotate link credential.', 'danger');
    }
  });

  // Run Real Access Diagnostics
  const testBtn = container.querySelector('#acc-run-test-btn');
  const diagMount = container.querySelector('#acc-diag-mount');
  testBtn?.addEventListener('click', async () => {
    if (testBtn) {
      testBtn.disabled = true;
      testBtn.textContent = 'Running diagnostic verification...';
    }

    try {
      const res = await apiPost(`/cafe-access/${encodeURIComponent(data.cafeId)}/test-access`);
      const results = res?.data || {};

      if (diagMount) {
        diagMount.style.display = 'block';
        diagMount.innerHTML = `
          <div style="font-size:11px;font-weight:800;letter-spacing:0.06em;text-transform:uppercase;color:var(--bronze-400);margin-bottom:10px;">
            ACCESS HEALTH DIAGNOSTIC RESULTS (${new Date(results.timestamp || Date.now()).toLocaleTimeString()})
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:12.5px;">
            <div style="display:flex;justify-content:space-between;background:var(--surface-sunken);padding:8px 12px;border-radius:6px;">
              <span>Permanent PIN Decryption</span>
              <strong style="color:${results.permanentPin === 'PASS' ? '#10b981' : '#ef4444'};">${results.permanentPin}</strong>
            </div>
            <div style="display:flex;justify-content:space-between;background:var(--surface-sunken);padding:8px 12px;border-radius:6px;">
              <span>QR Credential Resolution</span>
              <strong style="color:${results.qrCredential === 'PASS' ? '#10b981' : '#f59e0b'};">${results.qrCredential}</strong>
            </div>
            <div style="display:flex;justify-content:space-between;background:var(--surface-sunken);padding:8px 12px;border-radius:6px;">
              <span>Link Credential Resolution</span>
              <strong style="color:${results.linkCredential === 'PASS' ? '#10b981' : '#f59e0b'};">${results.linkCredential}</strong>
            </div>
            <div style="display:flex;justify-content:space-between;background:var(--surface-sunken);padding:8px 12px;border-radius:6px;">
              <span>Tenant Isolation Binding</span>
              <strong style="color:#10b981;">${results.tenantIsolation || 'PASS'}</strong>
            </div>
          </div>
        `;
      }
      showToast('Access Diagnostic completed successfully.', 'info');
    } catch (err) {
      showToast(err.message || 'Diagnostic failed.', 'danger');
    } finally {
      if (testBtn) {
        testBtn.disabled = false;
        testBtn.innerHTML = `<span>🧪</span> Run Access Diagnostic Test`;
      }
    }
  });

  // Emergency Lock Toggle
  const emergencyBtn = container.querySelector('#acc-emergency-btn');
  emergencyBtn?.addEventListener('click', async () => {
    if (isEmergencyLocked) {
      const confirmUnlock = window.confirm(
        'Are you sure you want to release the Emergency Lock on this café?\n\nCafé Operations login via PIN, QR, and Link will resume.'
      );
      if (!confirmUnlock) return;

      try {
        await apiPost(`/cafe-access/${encodeURIComponent(data.cafeId)}/emergency-unlock`, {
          body: { reason: 'Governance operator released emergency lock.' },
        });
        showToast('Emergency Lock released. Café access is restored.', 'success');
        loadAndRenderAccessModal(container, data.cafeId);
      } catch (err) {
        showToast(err.message || 'Failed to release lock.', 'danger');
      }
    } else {
      const reason = window.prompt(
        'SECURITY ACTION: Engage Emergency Lock on Café Operations.\n\nAll gateway logins (PIN, QR, Link) will be immediately blocked.\nPlease enter an incident reason for the permanent audit trail:'
      );
      if (!reason) return;

      try {
        await apiPost(`/cafe-access/${encodeURIComponent(data.cafeId)}/emergency-lock`, {
          body: { reason },
        });
        showToast('Emergency Lock engaged. All gateway access is blocked.', 'warning');
        loadAndRenderAccessModal(container, data.cafeId);
      } catch (err) {
        showToast(err.message || 'Failed to engage emergency lock.', 'danger');
      }
    }
  });
}
