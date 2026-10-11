/**
 * ============================================================================
 * ZAMORIN CAFÉ ERP — SYSTEM HEALTH & OPERATIONS DASHBOARD
 * ============================================================================
 * Administrative operational console restricted to Primary Master & Owner roles.
 * Provides real-time visibility into liveness, storage capacity, release state,
 * backup status, active alerts, kill switches, and maintenance mode.
 */

import { api } from '../apiClient.js';
import { state } from '../state.js';

export function renderSystemHealthPage() {
  const user = state.auth?.user || state.user || JSON.parse(localStorage.getItem('zamorin_user') || '{}');
  const role = String(user?.role || state.role || '').toUpperCase();
  const isPrimaryMaster = Boolean(user?.isPrimaryMaster || state.isPrimaryMaster || role === 'PRIMARY_MASTER');
  const isMasterOrOwner = role === 'MASTER' || role === 'PRIMARY_MASTER' || role === 'OWNER' || isPrimaryMaster;

  // Role Gate: Strictly Master (including Primary Master) and Owner only
  if (!isMasterOrOwner) {
    return `
      <div class="page-container" style="padding: 2.5rem; text-align: center;">
        <div class="card" style="max-width: 600px; margin: 3rem auto; padding: 2.5rem; border-left: 4px solid var(--danger-color, #dc2626);">
          <h2 style="color: var(--danger-color, #dc2626); margin-bottom: 1rem;">Access Restricted</h2>
          <p style="color: var(--text-muted, #6b7280); line-height: 1.6;">
            The System Health & Operational Control dashboard is restricted to authorized Primary Master and Owner governance roles.
          </p>
          <div style="margin-top: 2rem;">
            <a href="#dashboard" class="btn btn-primary">Return to Dashboard</a>
          </div>
        </div>
      </div>
    `;
  }

  return `
    <div class="page-container system-health-page" style="padding: 2rem; max-width: 1400px; margin: 0 auto;">
      <!-- Page Header -->
      <div class="page-header" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 2rem; border-bottom: 1px solid var(--border-color, #e5e7eb); padding-bottom: 1rem;">
        <div>
          <h1 style="font-size: 1.875rem; font-weight: 700; color: var(--text-main, #111827); margin: 0;">
            System Health & Operational Control
          </h1>
          <p style="color: var(--text-muted, #6b7280); margin: 0.25rem 0 0 0; font-size: 0.875rem;">
            Stage 10 Explicit Safe Post-Release Operations · Real-Time Telemetry · Storage & Backup Governance
          </p>
        </div>
        <div style="display: flex; gap: 0.75rem;">
          <button id="btn-refresh-health" class="btn btn-secondary" style="display: flex; align-items: center; gap: 0.5rem;">
            <span>🔄</span> Refresh Telemetry
          </button>
          <button id="btn-run-restore-drill" class="btn btn-primary" style="display: flex; align-items: center; gap: 0.5rem;">
            <span>🧪</span> Run Restore Drill
          </button>
        </div>
      </div>

      <!-- Quick Status Badges -->
      <div id="health-badges-container" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 1rem; margin-bottom: 2rem;">
        <div class="card" style="padding: 1.25rem; border-left: 4px solid var(--primary-color, #2563eb);">
          <div style="font-size: 0.75rem; font-weight: 600; color: var(--text-muted, #6b7280); text-transform: uppercase;">System State</div>
          <div id="badge-system-state" style="font-size: 1.25rem; font-weight: 700; color: var(--text-main, #111827); margin-top: 0.25rem;">Checking...</div>
        </div>
        <div class="card" style="padding: 1.25rem; border-left: 4px solid #10b981;">
          <div style="font-size: 0.75rem; font-weight: 600; color: var(--text-muted, #6b7280); text-transform: uppercase;">Persistent Storage</div>
          <div id="badge-storage-state" style="font-size: 1.25rem; font-weight: 700; color: var(--text-main, #111827); margin-top: 0.25rem;">Checking...</div>
        </div>
        <div class="card" style="padding: 1.25rem; border-left: 4px solid #f59e0b;">
          <div style="font-size: 0.75rem; font-weight: 600; color: var(--text-muted, #6b7280); text-transform: uppercase;">Active Alerts</div>
          <div id="badge-alert-count" style="font-size: 1.25rem; font-weight: 700; color: var(--text-main, #111827); margin-top: 0.25rem;">0</div>
        </div>
        <div class="card" style="padding: 1.25rem; border-left: 4px solid #8b5cf6;">
          <div style="font-size: 0.75rem; font-weight: 600; color: var(--text-muted, #6b7280); text-transform: uppercase;">Active Release</div>
          <div id="badge-release-commit" style="font-size: 1.1rem; font-weight: 700; color: var(--text-main, #111827); margin-top: 0.25rem; font-family: monospace;">Loading...</div>
        </div>
      </div>

      <!-- Main Operational Grid -->
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 2rem;">
        <!-- Left Column: Storage & Backup -->
        <div style="display: flex; flex-direction: column; gap: 2rem;">
          <!-- Storage Capacity Card -->
          <div class="card" style="padding: 1.5rem;">
            <h3 style="margin: 0 0 1rem 0; font-size: 1.125rem; font-weight: 600; display: flex; align-items: center; justify-content: space-between;">
              <span>💾 Render Persistent Document Disk</span>
              <span id="storage-band-badge" class="badge" style="background: #10b981; color: white; padding: 0.25rem 0.5rem; border-radius: 4px; font-size: 0.75rem;">NORMAL</span>
            </h3>
            <div style="margin-bottom: 1rem;">
              <div style="display: flex; justify-content: space-between; font-size: 0.875rem; margin-bottom: 0.25rem;">
                <span id="storage-usage-text">Usage: Calculating...</span>
                <span id="storage-utilization-pct">0%</span>
              </div>
              <div style="width: 100%; height: 8px; background: #e5e7eb; border-radius: 4px; overflow: hidden;">
                <div id="storage-progress-bar" style="width: 0%; height: 100%; background: #10b981; transition: width 0.3s ease;"></div>
              </div>
            </div>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; font-size: 0.875rem; color: var(--text-muted, #6b7280);">
              <div>Mount Path: <code id="storage-mount-path" style="color: var(--text-main, #111827);">/var/data/zamorin_documents</code></div>
              <div>Stored Binaries: <strong id="storage-file-count" style="color: var(--text-main, #111827);">0</strong></div>
            </div>
            <div style="margin-top: 1.25rem; display: flex; gap: 0.75rem;">
              <button id="btn-reconcile-storage" class="btn btn-secondary btn-sm" style="font-size: 0.875rem;">
                🔍 Reconcile Metadata & Files
              </button>
            </div>
          </div>

          <!-- Own-Server Readiness Diagnostics Card (P20 Benchmark F335-F338) -->
          <div class="card" style="padding: 1.5rem;">
            <h3 style="margin: 0 0 1rem 0; font-size: 1.125rem; font-weight: 600; display: flex; justify-content: space-between; align-items: center;">
              <span>🖥️ Own-Server Readiness Diagnostics</span>
              <span id="readiness-overall-badge" class="badge" style="background: #10b981; color: white; padding: 0.25rem 0.5rem; border-radius: 4px; font-size: 0.75rem;">CHECKING</span>
            </h3>
            <div id="readiness-checks-list" style="display: flex; flex-direction: column; gap: 0.75rem; font-size: 0.875rem;">
              <div style="color: var(--text-muted, #6b7280);">Loading dependency telemetry...</div>
            </div>
            <div id="readiness-remediations-container" style="margin-top: 1rem; display: none; padding: 0.75rem; background: #fffbeb; border-left: 3px solid #f59e0b; border-radius: 4px; font-size: 0.8rem; color: #92400e;">
              <strong>Actionable Remediation:</strong>
              <ul id="readiness-remediations-list" style="margin: 0.25rem 0 0 1.25rem; padding: 0;"></ul>
            </div>
          </div>

          <!-- Authoritative Backup & Restore Rehearsal Card (P20 Benchmark F339-F340) -->
          <div class="card" style="padding: 1.5rem;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem;">
              <h3 style="margin: 0; font-size: 1.125rem; font-weight: 600;">
                🛡️ Backup Archives &amp; Restore Rehearsal
              </h3>
              <button id="btn-create-backup" class="btn btn-primary btn-sm" style="font-size: 0.75rem;">
                + Create Manual Backup
              </button>
            </div>
            <div id="backup-archives-container" style="font-size: 0.875rem;">
              <div style="color: var(--text-muted, #6b7280);">Loading backup ledger...</div>
            </div>
            <div style="color: var(--text-muted, #6b7280); font-size: 0.8rem; margin-top: 1rem; border-top: 1px solid #e5e7eb; padding-top: 0.5rem;">
              Safeguard: Destructive restore against live production is blocked. Rehearsals execute into isolated test databases.
            </div>
          </div>
        </div>


        <!-- Right Column: Emergency Kill Switches & Maintenance Mode -->
        <div style="display: flex; flex-direction: column; gap: 2rem;">
          <!-- Maintenance Mode Control -->
          <div class="card" style="padding: 1.5rem;">
            <h3 style="margin: 0 0 1rem 0; font-size: 1.125rem; font-weight: 600;">
              🚧 Maintenance & Read-Only Governance
            </h3>
            <p style="font-size: 0.875rem; color: var(--text-muted, #6b7280); margin-bottom: 1.25rem;">
              Primary Master and Owner accounts retain authorized operational bypass during active maintenance.
            </p>
            <div style="display: flex; gap: 1rem; flex-wrap: wrap;">
              <button id="btn-toggle-maintenance" class="btn btn-secondary" style="font-size: 0.875rem;">
                Enable Maintenance Mode
              </button>
              <button id="btn-toggle-readonly" class="btn btn-secondary" style="font-size: 0.875rem;">
                Enable Read-Only Mode
              </button>
            </div>
            <div id="maintenance-active-info" style="margin-top: 1rem; font-size: 0.875rem; display: none; padding: 0.75rem; background: #fef3c7; border-radius: 4px; color: #92400e;">
              Active Maintenance Notice: <span id="maintenance-reason-text">None</span>
            </div>
          </div>

          <!-- Emergency Kill Switches -->
          <div class="card" style="padding: 1.5rem;">
            <h3 style="margin: 0 0 1rem 0; font-size: 1.125rem; font-weight: 600; color: var(--danger-color, #dc2626);">
              🛑 Emergency Kill Switches
            </h3>
            <div style="display: flex; flex-direction: column; gap: 0.75rem;">
              <div style="display: flex; justify-content: space-between; align-items: center; padding: 0.75rem; background: #f9fafb; border-radius: 6px;">
                <div>
                  <div style="font-weight: 600; font-size: 0.875rem;">Document Upload Ingress</div>
                  <div style="font-size: 0.75rem; color: var(--text-muted, #6b7280);">Suspends multipart upload attachment pipeline</div>
                </div>
                <button id="btn-kill-uploads" class="btn btn-danger btn-sm" style="font-size: 0.75rem;">
                  Suspend Uploads
                </button>
              </div>

              <div style="display: flex; justify-content: space-between; align-items: center; padding: 0.75rem; background: #f9fafb; border-radius: 6px;">
                <div>
                  <div style="font-weight: 600; font-size: 0.875rem;">Export Job Queue</div>
                  <div style="font-size: 0.75rem; color: var(--text-muted, #6b7280);">Suspends heavy background PDF / XLSX export generation</div>
                </div>
                <button id="btn-kill-exports" class="btn btn-danger btn-sm" style="font-size: 0.75rem;">
                  Suspend Exports
                </button>
              </div>

              <div style="display: flex; justify-content: space-between; align-items: center; padding: 0.75rem; background: #f9fafb; border-radius: 6px;">
                <div>
                  <div style="font-weight: 600; font-size: 0.875rem;">External Mail Synchronization</div>
                  <div style="font-size: 0.75rem; color: var(--text-muted, #6b7280);">Suspends Gmail / notification outbound dispatch</div>
                </div>
                <button id="btn-kill-mail" class="btn btn-danger btn-sm" style="font-size: 0.75rem;">
                  Suspend Sync
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Active Operational Alerts Table -->
      <div class="card" style="margin-top: 2rem; padding: 1.5rem;">
        <h3 style="margin: 0 0 1rem 0; font-size: 1.125rem; font-weight: 600;">
          🚨 Active Operational Alerts
        </h3>
        <div id="alerts-table-container">
          <p style="color: var(--text-muted, #6b7280); font-size: 0.875rem;">Loading active operational alerts...</p>
        </div>
      </div>
    </div>
  `;
}

export async function initSystemHealthPage() {
  const btnRefresh = document.getElementById('btn-refresh-health');
  const btnDrill = document.getElementById('btn-run-restore-drill');
  const btnReconcile = document.getElementById('btn-reconcile-storage');
  const btnToggleMaint = document.getElementById('btn-toggle-maintenance');
  const btnToggleReadOnly = document.getElementById('btn-toggle-readonly');
  const btnKillUploads = document.getElementById('btn-kill-uploads');

  async function loadData() {
    try {
      const res = await api.get('/system/overview');
      if (res && res.success && res.data) {
        updateUI(res.data);
      }
    } catch (err) {
      console.error('Failed to load system health telemetry:', err);
    }
  }

  function updateUI(data) {
    // Badges
    const badgeSystem = document.getElementById('badge-system-state');
    if (badgeSystem) badgeSystem.textContent = data.system?.environment ? `HEALTHY (${data.system.environment.toUpperCase()})` : 'HEALTHY';

    const badgeStorage = document.getElementById('badge-storage-state');
    if (badgeStorage) badgeStorage.textContent = data.storage?.health === 'OK' ? 'MOUNTED (OK)' : data.storage?.health || 'UNKNOWN';

    const badgeAlerts = document.getElementById('badge-alert-count');
    if (badgeAlerts) badgeAlerts.textContent = String(data.alerts?.activeCount || 0);

    const badgeRelease = document.getElementById('badge-release-commit');
    if (badgeRelease) badgeRelease.textContent = (data.release?.gitCommit || 'HEAD').slice(0, 8);

    // Storage
    const cap = data.storage?.capacity;
    if (cap) {
      const pct = cap.utilizationPercent || 0;
      const pctEl = document.getElementById('storage-utilization-pct');
      const textEl = document.getElementById('storage-usage-text');
      const barEl = document.getElementById('storage-progress-bar');
      const fileCountEl = document.getElementById('storage-file-count');
      const bandBadge = document.getElementById('storage-band-badge');

      if (pctEl) pctEl.textContent = `${pct}%`;
      if (textEl) textEl.textContent = `Used: ${(cap.usedBytes / (1024 * 1024)).toFixed(2)} MB / 10 GB`;
      if (barEl) {
        barEl.style.width = `${Math.min(100, pct)}%`;
        if (pct >= 85) barEl.style.background = '#dc2626';
        else if (pct >= 70) barEl.style.background = '#f59e0b';
        else barEl.style.background = '#10b981';
      }
      if (fileCountEl) fileCountEl.textContent = String(cap.fileCount || 0);
      if (bandBadge) {
        bandBadge.textContent = cap.alertLevel || 'NORMAL';
        if (cap.alertLevel === 'CRITICAL') bandBadge.style.background = '#dc2626';
        else if (cap.alertLevel === 'WARNING') bandBadge.style.background = '#f59e0b';
        else bandBadge.style.background = '#10b981';
      }
    }

    // Alerts Table
    const alertsContainer = document.getElementById('alerts-table-container');
    if (alertsContainer) {
      const alerts = data.alerts?.recent || [];
      if (alerts.length === 0) {
        alertsContainer.innerHTML = `<p style="color: #10b981; font-size: 0.875rem; font-weight: 500;">✓ Zero active operational alerts. All systems operating within normal parameters.</p>`;
      } else {
        let html = `
          <table class="table" style="width: 100%; border-collapse: collapse; font-size: 0.875rem;">
            <thead>
              <tr style="border-bottom: 2px solid #e5e7eb; text-align: left;">
                <th style="padding: 0.75rem;">Severity</th>
                <th style="padding: 0.75rem;">Category</th>
                <th style="padding: 0.75rem;">Title</th>
                <th style="padding: 0.75rem;">Occurrences</th>
                <th style="padding: 0.75rem;">Last Detected</th>
                <th style="padding: 0.75rem;">Action</th>
              </tr>
            </thead>
            <tbody>
        `;
        for (const a of alerts) {
          html += `
            <tr style="border-bottom: 1px solid #e5e7eb;">
              <td style="padding: 0.75rem;"><span class="badge" style="background: ${a.severity === 'SEV-1' ? '#dc2626' : '#f59e0b'}; color: white; padding: 0.2rem 0.4rem; border-radius: 4px; font-weight: 600;">${a.severity}</span></td>
              <td style="padding: 0.75rem;">${a.category}</td>
              <td style="padding: 0.75rem;"><strong>${a.title}</strong><div style="font-size: 0.75rem; color: #6b7280;">${a.description}</div></td>
              <td style="padding: 0.75rem;">${a.occurrenceCount}</td>
              <td style="padding: 0.75rem;">${new Date(a.lastDetected).toLocaleTimeString()}</td>
              <td style="padding: 0.75rem;">
                <button class="btn btn-secondary btn-sm" onclick="window.resolveAlertPrompt('${a.alertId}')">Resolve</button>
              </td>
            </tr>
          `;
        }
        html += `</tbody></table>`;
        alertsContainer.innerHTML = html;
      }
    }
  }

  // Bind actions
  if (btnRefresh) {
    btnRefresh.addEventListener('click', () => loadData());
  }

  if (btnDrill) {
    btnDrill.addEventListener('click', async () => {
      btnDrill.disabled = true;
      btnDrill.textContent = 'Running Drill...';
      try {
        const res = await api.post('/system/backup/drill', {});
        alert(`Restore Drill Complete!\nStatus: ${res.data.status}\nRTO: ${res.data.measuredRtoSeconds}s\nVerified Collections: ${res.data.verifiedCollections.length}`);
      } catch (err) {
        alert(`Drill Failed: ${err.message}`);
      } finally {
        btnDrill.disabled = false;
        btnDrill.textContent = '🧪 Run Restore Drill';
      }
    });
  }

  if (btnReconcile) {
    btnReconcile.addEventListener('click', async () => {
      btnReconcile.disabled = true;
      btnReconcile.textContent = 'Reconciling...';
      try {
        const res = await api.post('/system/reconcile-documents', {});
        alert(`Reconciliation Report:\nAudited Docs: ${res.data.documentsAudited}\nDisk Files: ${res.data.diskFilesScanned}\nOrphan Metadata: ${res.data.orphanMetadataCount}\nOrphan Binaries: ${res.data.orphanBinariesCount}\nChecksum Mismatches: ${res.data.checksumMismatchesCount}`);
      } catch (err) {
        alert(`Reconciliation Failed: ${err.message}`);
      } finally {
        btnReconcile.disabled = false;
        btnReconcile.textContent = '🔍 Reconcile Metadata & Files';
      }
    });
  }

  window.resolveAlertPrompt = async (alertId) => {
    const resolution = prompt('Enter resolution description for alert:', 'Condition cleared manually by administrator');
    if (!resolution) return;
    try {
      await api.post(`/system/alerts/${alertId}/resolve`, { resolution });
      loadData();
    } catch (err) {
      alert(`Failed to resolve alert: ${err.message}`);
    }
  };

  async function loadReadinessAndBackups() {
    // 1. Load Server Readiness Diagnostics
    try {
      const res = await api.get('/system/readiness');
      if (res && res.data) {
        updateReadinessUI(res.data);
      }
    } catch (err) {
      console.warn('Failed to load server readiness:', err.message);
    }

    // 2. Load Backup Ledger
    try {
      const res = await api.get('/system/backup/list');
      if (res && res.data) {
        updateBackupLedgerUI(res.data.backups || []);
      }
    } catch (err) {
      console.warn('Failed to load backups list:', err.message);
    }
  }

  function updateReadinessUI(data) {
    const overallBadge = document.getElementById('readiness-overall-badge');
    if (overallBadge) {
      overallBadge.textContent = data.overallStatus || (data.readyForBusiness ? 'READY' : 'DEGRADED');
      overallBadge.style.background = data.readyForBusiness ? '#10b981' : '#dc2626';
    }

    const checksList = document.getElementById('readiness-checks-list');
    if (checksList && data.checks) {
      checksList.innerHTML = data.checks
        .map(
          (c) => `
          <div style="display:flex; justify-content:space-between; align-items:center; padding:0.5rem 0; border-bottom:1px solid #f3f4f6;">
            <div>
              <strong>${c.name}</strong>
              <div style="font-size:0.75rem; color:#6b7280;">${c.details}</div>
            </div>
            <span class="badge" style="background:${c.status === 'HEALTHY' || c.status === 'ONLINE' || c.status === 'IN_MEMORY_HEALTHY' ? '#10b981' : c.status === 'WARNING' || c.status === 'DEGRADED' || c.status === 'READY_NO_LOCAL_PRINTER' ? '#f59e0b' : '#dc2626'}; color:white; padding:0.2rem 0.4rem; border-radius:4px; font-size:0.7rem;">
              ${c.status}
            </span>
          </div>
        `
        )
        .join('');
    }

    const remediationsContainer = document.getElementById('readiness-remediations-container');
    const remediationsList = document.getElementById('readiness-remediations-list');
    if (remediationsContainer && remediationsList) {
      const rems = data.remediations || [];
      if (rems.length > 0) {
        remediationsContainer.style.display = 'block';
        remediationsList.innerHTML = rems.map((r) => `<li>${r}</li>`).join('');
      } else {
        remediationsContainer.style.display = 'none';
      }
    }
  }

  function updateBackupLedgerUI(backups) {
    const container = document.getElementById('backup-archives-container');
    if (!container) return;

    if (!backups.length) {
      container.innerHTML = `<p style="color:#6b7280; font-size:0.875rem;">No persisted backup archives found. Click "+ Create Manual Backup" above to generate a verified snapshot.</p>`;
      return;
    }

    let html = `
      <table class="table" style="width:100%; border-collapse:collapse; font-size:0.8rem;">
        <thead>
          <tr style="border-bottom:1px solid #e5e7eb; text-align:left; color:#6b7280;">
            <th style="padding:0.4rem;">Backup ID</th>
            <th style="padding:0.4rem;">Scope</th>
            <th style="padding:0.4rem;">Size</th>
            <th style="padding:0.4rem;">Checksum</th>
            <th style="padding:0.4rem;">Status</th>
            <th style="padding:0.4rem; text-align:right;">Actions</th>
          </tr>
        </thead>
        <tbody>
    `;

    for (const b of backups) {
      const sizeKb = Math.round((b.sizeBytes || 0) / 1024);
      const shortSha = (b.sha256Checksum || '').slice(0, 10);
      const isVerified = b.status === 'VERIFIED';

      html += `
        <tr style="border-bottom:1px solid #f3f4f6;">
          <td style="padding:0.5rem; font-family:monospace; font-weight:600;">${b.backupId}</td>
          <td style="padding:0.5rem;">${b.scope}</td>
          <td style="padding:0.5rem;">${sizeKb} KB</td>
          <td style="padding:0.5rem; font-family:monospace; color:#6b7280;" title="${b.sha256Checksum}">${shortSha}...</td>
          <td style="padding:0.5rem;">
            <span class="badge" style="background:${isVerified ? '#10b981' : '#f59e0b'}; color:white; padding:0.15rem 0.35rem; border-radius:3px; font-size:0.7rem;">
              ${b.status}
            </span>
          </td>
          <td style="padding:0.5rem; text-align:right;">
            <button class="btn btn-secondary btn-sm" style="font-size:0.7rem; padding:0.2rem 0.4rem;" onclick="window.verifyBackupChecksum('${b.backupId}')">
              Verify
            </button>
            <button class="btn btn-primary btn-sm" style="font-size:0.7rem; padding:0.2rem 0.4rem; margin-left:4px;" onclick="window.runRestoreRehearsalPrompt('${b.backupId}')">
              Rehearsal
            </button>
          </td>
        </tr>
      `;
    }

    html += `</tbody></table>`;
    container.innerHTML = html;
  }

  // Create Manual Backup Handler
  const btnCreateBackup = document.getElementById('btn-create-backup');
  if (btnCreateBackup) {
    btnCreateBackup.addEventListener('click', async () => {
      btnCreateBackup.disabled = true;
      btnCreateBackup.textContent = 'Generating...';
      try {
        const res = await api.post('/system/backup/create', { scope: 'FULL_ENTERPRISE' });
        alert(`Backup Created Successfully!\nBackup ID: ${res.data?.backupId}\nCollections: ${res.data?.collectionsCount}\nDocuments: ${res.data?.totalDocuments}\nSHA-256: ${res.data?.sha256Checksum?.slice(0, 16)}...`);
        loadReadinessAndBackups();
      } catch (err) {
        alert(`Failed to create backup: ${err.message}`);
      } finally {
        btnCreateBackup.disabled = false;
        btnCreateBackup.textContent = '+ Create Manual Backup';
      }
    });
  }

  // Verify Backup Checksum Handler
  window.verifyBackupChecksum = async (backupId) => {
    try {
      const res = await api.post(`/system/backup/${backupId}/verify`, {});
      alert(`✅ Backup Integrity Verified!\nBackup ID: ${res.data?.backupId}\nStatus: VERIFIED\nSHA-256 Hash matches disk archive.\nTotal Documents: ${res.data?.totalDocuments}`);
      loadReadinessAndBackups();
    } catch (err) {
      alert(`Integrity Check Failed: ${err.message}`);
    }
  };

  // Run Restore Rehearsal Handler
  window.runRestoreRehearsalPrompt = async (backupId) => {
    const targetDbName = prompt(
      'Enter ISOLATED restore target database name:\n(Safeguard: Production databases are strictly prohibited)',
      'zamorin_isolated_rehearsal_target'
    );
    if (!targetDbName) return;

    const confirmation = prompt(
      'Type exactly CONFIRM_ISOLATED_RESTORE_TARGET to confirm non-destructive restore rehearsal:'
    );
    if (confirmation !== 'CONFIRM_ISOLATED_RESTORE_TARGET') {
      alert('Confirmation token does not match. Rehearsal cancelled.');
      return;
    }

    try {
      const res = await api.post(`/system/backup/${backupId}/rehearsal`, {
        targetDbName,
        targetConfirmation: 'CONFIRM_ISOLATED_RESTORE_TARGET',
        restoreVerificationMode: true,
      });
      alert(`🧪 Restore Rehearsal Completed!\nRehearsal ID: ${res.data?.rehearsalId}\nTarget DB: ${res.data?.targetDbName}\nStatus: ${res.data?.status}\nRestored Documents: ${res.data?.restoredDocuments}\nVerified Collections: ${res.data?.verifiedCollections?.length}\nDuration: ${res.data?.durationMs}ms\nZero production interference confirmed.`);
      loadReadinessAndBackups();
    } catch (err) {
      alert(`Restore Rehearsal Failed: ${err.message}`);
    }
  };

  // Initial load
  loadData();
  loadReadinessAndBackups();
}

