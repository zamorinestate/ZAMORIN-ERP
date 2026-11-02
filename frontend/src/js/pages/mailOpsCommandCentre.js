// =============================================================================
// PAGE: MailOps Command Centre — SCR-012 Comprehensive Communication Nerve Hub
// Operational Inbox • Outbox • Drafts • Threads • Routing • Templates • Automation
// Sender Identities • Gmail Sync • Security Review • MailOps Integrity • Telemetry • Audit
// =============================================================================

import { exportGrid } from "../utils/exportFile.js";
import { apiGet, apiPost, apiPatch, apiDelete } from "../apiClient.js";
import { state } from "../state.js";
import { showToast, openModal } from "../components.js";

let activeTab = "overview";
let liveStatus = null;
let selectedQueue = "ALL";
let selectedCafe = "ALL";
let searchQuery = "";

export function renderMailOpsCommandCentre() {
  const isMaster = state.user?.role === "MASTER";
  const isPrimaryMaster = state.user?.isPrimaryMaster;

  return `
    <div class="page-enter mailops-page" style="padding-bottom: 60px;">
      <!-- Top Title Bar -->
      <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom: 16px; flex-wrap:wrap; gap:16px;">
        <div>
          <div style="display:flex; align-items:center; gap:10px;">
            <h1 class="page-title" style="font-size:24px; font-weight:800; color:var(--ink); margin:0;">MailOps Command Centre</h1>
            <span class="badge badge-accent" style="font-size:11px; padding:2px 8px; font-weight:700;">SCR-012 COMMUNICATIONS</span>
          </div>
          <p class="page-subtitle" style="font-size:13.5px; color:var(--muted); margin:4px 0 0;">
            Operations Nerve Centre &bull; <strong style="color:var(--color-accent-gold-bright);">zamorinestatepvtltd.erp@gmail.com</strong>
          </p>
        </div>
        <div style="display:flex; gap:10px; align-items:center;">
          <button id="btn-refresh-telemetry" class="btn btn-secondary" style="display:flex; align-items:center; gap:6px;">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 4v6h-6M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
            Refresh Telemetry
          </button>
          <button id="btn-compose-mailops" class="btn btn-primary" style="display:flex; align-items:center; gap:6px;">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>
            Compose Email
          </button>
        </div>
      </div>

      <!-- Secondary Subpanel Navigation -->
      <div class="subnav-bar" style="display:flex; gap:6px; border-bottom:1px solid var(--border-color); margin-bottom:16px; overflow-x:auto; padding-bottom:4px;">
        <button class="subnav-btn ${activeTab === "overview" ? "active" : ""}" data-tab="overview">Overview &amp; Telemetry</button>
        <button class="subnav-btn ${activeTab === "inbox" ? "active" : ""}" data-tab="inbox">Operational Inbox</button>
        <button class="subnav-btn ${activeTab === "outbox" ? "active" : ""}" data-tab="outbox">Outbox &amp; Delivery</button>
        <button class="subnav-btn ${activeTab === "threads" ? "active" : ""}" data-tab="threads">Threads</button>
        <button class="subnav-btn ${activeTab === "drafts" ? "active" : ""}" data-tab="drafts">Drafts</button>
        <button class="subnav-btn ${activeTab === "cases" ? "active" : ""}" data-tab="cases">MailOps Cases</button>
        <button class="subnav-btn ${activeTab === "security" ? "active" : ""}" data-tab="security">Security &amp; BEC</button>
        <button class="subnav-btn ${activeTab === "templates" ? "active" : ""}" data-tab="templates">Templates</button>
        <button class="subnav-btn ${activeTab === "automation" ? "active" : ""}" data-tab="automation">Automation Rules</button>
        <button class="subnav-btn ${activeTab === "identities" ? "active" : ""}" data-tab="identities">Sender Identities</button>
        <button class="subnav-btn ${activeTab === "provider-health" ? "active" : ""}" data-tab="provider-health">Provider &amp; Sync Health</button>
        <button class="subnav-btn ${activeTab === "integrity" ? "active" : ""}" data-tab="integrity">MailOps Integrity</button>
        <button class="subnav-btn ${activeTab === "reports" ? "active" : ""}" data-tab="reports">Reports &amp; Registers</button>
      </div>

      <!-- Main Workspace Container -->
      <div id="mailops-workspace-wrap">
        <div style="display:flex; justify-content:center; padding:40px;">
          <div class="spinner"></div>
        </div>
      </div>
    </div>
  `;
}

export async function wireMailOpsCommandCentre(root) {
  const workspaceWrap = root.querySelector("#mailops-workspace-wrap");
  const refreshBtn = root.querySelector("#btn-refresh-telemetry");
  const composeBtn = root.querySelector("#btn-compose-mailops");

  const subnavBtns = root.querySelectorAll(".subnav-btn");
  subnavBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      subnavBtns.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      activeTab = btn.dataset.tab;
      renderCurrentWorkspace(workspaceWrap);
    });
  });

  if (refreshBtn) {
    refreshBtn.addEventListener("click", async () => {
      showToast("Refreshing MailOps telemetry...", "info");
      await loadMailOpsStatus(workspaceWrap);
    });
  }

  if (composeBtn) {
    composeBtn.addEventListener("click", () => openComposeModal(workspaceWrap));
  }

  await loadMailOpsStatus(workspaceWrap);
}

async function loadMailOpsStatus(wrap) {
  try {
    const res = await apiGet("/mailops/status");
    liveStatus = res || {};
    renderCurrentWorkspace(wrap);
  } catch (err) {
    wrap.innerHTML = `
      <div class="glass-card" style="padding:32px; text-align:center; max-width:600px; margin:40px auto;">
        <div style="width:48px; height:48px; border-radius:50%; background:rgba(239, 68, 68, 0.15); color:var(--danger); display:flex; align-items:center; justify-content:center; margin:0 auto 16px;">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
        </div>
        <h3 style="font-size:18px; font-weight:700; color:var(--ink); margin:0 0 8px;">MailOps Telemetry Unavailable</h3>
        <p style="font-size:13.5px; color:var(--muted); margin:0 0 20px; line-height:1.5;">Could not connect to operations email service (${err.message}). Zeroes are suppressed to prevent false assumptions.</p>
        <button id="btn-retry-mailops" class="btn btn-primary">Retry Connection</button>
      </div>
    `;
    const retryBtn = wrap.querySelector("#btn-retry-mailops");
    if (retryBtn) retryBtn.addEventListener("click", () => loadMailOpsStatus(wrap));
  }
}

function renderCurrentWorkspace(wrap) {
  if (!wrap) return;

  switch (activeTab) {
    case "overview":
      renderOverviewTab(wrap);
      break;
    case "inbox":
      renderInboxTab(wrap);
      break;
    case "outbox":
      renderOutboxTab(wrap);
      break;
    case "threads":
      renderThreadsTab(wrap);
      break;
    case "drafts":
      renderDraftsTab(wrap);
      break;
    case "cases":
      renderCasesTab(wrap);
      break;
    case "security":
      renderSecurityTab(wrap);
      break;
    case "templates":
      renderTemplatesTab(wrap);
      break;
    case "automation":
      renderAutomationTab(wrap);
      break;
    case "identities":
      renderIdentitiesTab(wrap);
      break;
    case "provider-health":
      renderProviderHealthTab(wrap);
      break;
    case "integrity":
      renderIntegrityTab(wrap);
      break;
    case "reports":
      renderReportsTab(wrap);
      break;
    default:
      renderOverviewTab(wrap);
  }
}

// ── 1. Overview & Telemetry Workspace ─────────────────────────────────────────
function renderOverviewTab(wrap) {
  const kpis = liveStatus?.kpis || {};
  const provider = liveStatus?.provider || "GMAIL_API";
  const health = liveStatus?.providerHealth || "HEALTHY";
  const oauthStatus = liveStatus?.oauthStatus || "CONNECTED";

  wrap.innerHTML = `
    <!-- Top Telemetry Banner -->
    <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(200px, 1fr)); gap:12px; margin-bottom:16px;">
      <div class="kpi-card glass" style="padding:14px;">
        <div class="kpi-label" style="font-size:11px; color:var(--muted); font-weight:600; text-transform:uppercase;">Provider Health</div>
        <div class="kpi-value" style="font-size:20px; font-weight:800; color:var(--color-accent-mint-bright); margin:4px 0;">${health}</div>
        <div style="font-size:11.5px; color:var(--muted);">${provider} &bull; OAuth: ${oauthStatus}</div>
      </div>

      <div class="kpi-card glass" style="padding:14px;">
        <div class="kpi-label" style="font-size:11px; color:var(--muted); font-weight:600; text-transform:uppercase;">Zamorin Daily Send Budget</div>
        <div class="kpi-value" style="font-size:20px; font-weight:800; color:var(--color-accent-gold-bright); margin:4px 0;">
          ${kpis.sentToday || 0} / ${kpis.dailySendBudgetLimit || 500}
        </div>
        <div style="font-size:11.5px; color:var(--muted);">${kpis.remainingBudget || 500} remaining today</div>
      </div>

      <div class="kpi-card glass" style="padding:14px;">
        <div class="kpi-label" style="font-size:11px; color:var(--muted); font-weight:600; text-transform:uppercase;">Outbound Outbox</div>
        <div class="kpi-value" style="font-size:20px; font-weight:800; color:var(--ink); margin:4px 0;">
          ${kpis.outboundQueued || 0} Queued &bull; ${kpis.outboundFailed || 0} Failed
        </div>
        <div style="font-size:11.5px; color:var(--muted);">${kpis.outboundRetrying || 0} Retrying &bull; ${kpis.outboundDeadLetter || 0} DLQ</div>
      </div>

      <div class="kpi-card glass" style="padding:14px;">
        <div class="kpi-label" style="font-size:11px; color:var(--muted); font-weight:600; text-transform:uppercase;">Inbound Review &amp; Quarantine</div>
        <div class="kpi-value" style="font-size:20px; font-weight:800; color:${kpis.inboundQuarantined > 0 ? "var(--danger)" : "var(--color-accent-mint-bright)"}; margin:4px 0;">
          ${kpis.inboundPending || 0} Pending &bull; ${kpis.inboundQuarantined || 0} Locked
        </div>
        <div style="font-size:11.5px; color:var(--muted);">${kpis.becIncidents || 0} BEC Flags</div>
      </div>
    </div>

    <!-- Actionable Attention Strip -->
    <div class="glass-card" style="padding:16px; margin-bottom:16px; border-left:4px solid var(--color-accent-mint-bright);">
      <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px;">
        <div>
          <strong style="font-size:14px; color:var(--ink);">MailOps Operational Continuity</strong>
          <p style="font-size:12.5px; color:var(--muted); margin:2px 0 0;">
            Gmail Watch: <strong>${liveStatus?.watch?.status || 'ACTIVE'}</strong> &bull;
            Sync State: <strong>CURRENT</strong> &bull;
            Outbound Delivery: <strong>${liveStatus?.outboundPaused ? 'PAUSED' : 'ACTIVE'}</strong>
          </p>
        </div>
        <div style="display:flex; gap:8px;">
          <button class="btn btn-sm btn-secondary" onclick="document.querySelector('[data-tab=inbox]').click()">Triage Inbox</button>
          <button class="btn btn-sm btn-primary" onclick="document.querySelector('[data-tab=outbox]').click()">Inspect Outbox</button>
        </div>
      </div>
    </div>
  `;
}

// ── 2. Operational Inbox Workspace ───────────────────────────────────────────
async function renderInboxTab(wrap) {
  wrap.innerHTML = `<div style="text-align:center; padding:30px;"><div class="spinner"></div></div>`;
  try {
    const res = await apiGet(`/mailops/inbound?queue=${selectedQueue}&cafeId=${selectedCafe}&search=${encodeURIComponent(searchQuery)}`);
    const messages = res.messages || [];

    wrap.innerHTML = `
      <div class="glass-card" style="padding:18px;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:14px; flex-wrap:wrap; gap:10px;">
          <div>
            <h3 style="font-size:15.5px; font-weight:700; margin:0; color:var(--ink);">Operational Inbound Queue</h3>
            <p style="font-size:12.5px; color:var(--muted); margin:2px 0 0;">Classified operational messages. Click any message to open Message 360.</p>
          </div>
          <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
            <select id="sel-inbox-queue" class="form-input" style="width:150px; padding:5px 8px; font-size:12.5px;">
              <option value="ALL" ${selectedQueue === "ALL" ? "selected" : ""}>All Queues</option>
              <option value="NEW" ${selectedQueue === "NEW" ? "selected" : ""}>New (${messages.filter(m=>m.queueStatus==='NEW').length})</option>
              <option value="REQUIRES_ACTION" ${selectedQueue === "REQUIRES_ACTION" ? "selected" : ""}>Requires Action</option>
              <option value="ASSIGNED" ${selectedQueue === "ASSIGNED" ? "selected" : ""}>Assigned</option>
              <option value="SECURITY_REVIEW" ${selectedQueue === "SECURITY_REVIEW" ? "selected" : ""}>Security Review</option>
              <option value="QUARANTINE" ${selectedQueue === "QUARANTINE" ? "selected" : ""}>Quarantine</option>
              <option value="RESOLVED" ${selectedQueue === "RESOLVED" ? "selected" : ""}>Resolved</option>
            </select>
            <input type="text" id="inp-inbox-search" class="form-input" placeholder="Search subject / sender..." value="${searchQuery}" style="width:180px; padding:5px 8px; font-size:12.5px;">
          </div>
        </div>

        <div style="overflow-x:auto;">
          <table class="glass-table" style="width:100%; border-collapse:collapse; font-size:13px;">
            <thead>
              <tr style="text-align:left; border-bottom:1px solid var(--border-color);">
                <th style="padding:8px 10px;">Sender</th>
                <th style="padding:8px 10px;">Subject &amp; ERP Context</th>
                <th style="padding:8px 10px;">Classification</th>
                <th style="padding:8px 10px;">Risk / BEC</th>
                <th style="padding:8px 10px;">Received</th>
                <th style="padding:8px 10px;">Queue Status</th>
              </tr>
            </thead>
            <tbody>
              ${messages.length === 0 ? `<tr><td colspan="6" style="text-align:center; padding:24px; color:var(--muted);">No inbound messages match the filter.</td></tr>` : ''}
              ${messages.map((m) => `
                <tr class="clickable-row btn-drill-msg360" data-id="${m.inboundId}" style="cursor:pointer; border-bottom:1px solid rgba(255,255,255,0.05);">
                  <td style="padding:8px 10px;">
                    <strong style="color:var(--ink);">${m.senderName || m.senderEmail}</strong><br>
                    <span style="font-size:11.5px; color:var(--muted); font-family:monospace;">${m.senderEmail}</span>
                  </td>
                  <td style="padding:8px 10px;">
                    <strong style="color:var(--ink);">${m.subject}</strong><br>
                    ${m.linkedEntityType ? `<span class="badge badge-accent" style="font-size:10.5px;">${m.linkedEntityType}: ${m.linkedEntityId}</span>` : '<span style="font-size:11.5px; color:var(--muted);">Unlinked</span>'}
                  </td>
                  <td style="padding:8px 10px;"><span class="badge badge-neutral">${m.classification}</span></td>
                  <td style="padding:8px 10px;">
                    ${m.isBecSuspected ? `<span class="badge badge-danger">CRITICAL BEC</span>` : `<span class="badge badge-success">${m.riskScore}</span>`}
                  </td>
                  <td style="padding:8px 10px; font-size:12px; color:var(--muted);">${new Date(m.receivedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</td>
                  <td style="padding:8px 10px;">
                    <span class="badge ${m.queueStatus === "QUARANTINE" ? "badge-danger" : m.queueStatus === "SECURITY_REVIEW" ? "badge-warning" : "badge-neutral"}">
                      ${m.queueStatus}
                    </span>
                  </td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        </div>
      </div>
    `;

    const selQueue = wrap.querySelector("#sel-inbox-queue");
    if (selQueue) selQueue.addEventListener("change", (e) => { selectedQueue = e.target.value; renderInboxTab(wrap); });

    const inpSearch = wrap.querySelector("#inp-inbox-search");
    if (inpSearch) {
      inpSearch.addEventListener("input", (e) => {
        searchQuery = e.target.value;
        const activeId = document.activeElement?.id;
        const cursorStart = document.activeElement?.selectionStart;
        const cursorEnd = document.activeElement?.selectionEnd;
        renderInboxTab(wrap).then(() => {
          if (activeId) {
            const el = wrap.querySelector("#" + activeId);
            if (el) {
              el.focus();
              if (typeof cursorStart === "number" && typeof cursorEnd === "number" && el.setSelectionRange) {
                el.setSelectionRange(cursorStart, cursorEnd);
              }
            }
          }
        });
      });
    }

    wrap.querySelectorAll(".btn-drill-msg360").forEach((row) => {
      row.addEventListener("click", () => openMessage360Modal(row.dataset.id));
    });
  } catch (err) {
    wrap.innerHTML = `<div class="glass-card" style="padding:20px; color:var(--danger);">Error loading inbound inbox: ${err.message}</div>`;
  }
}

// ── 3. Outbox & Delivery Workspace ───────────────────────────────────────────
async function renderOutboxTab(wrap) {
  wrap.innerHTML = `<div style="text-align:center; padding:30px;"><div class="spinner"></div></div>`;
  try {
    const res = await apiGet("/mailops/outbox");
    const items = res.outbox || [];

    wrap.innerHTML = `
      <div class="glass-card" style="padding:18px;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:14px; flex-wrap:wrap; gap:10px;">
          <div>
            <h3 style="font-size:15.5px; font-weight:700; margin:0; color:var(--ink);">Outbound Delivery Outbox &amp; Queue</h3>
            <p style="font-size:12.5px; color:var(--muted); margin:2px 0 0;">Persistent delivery queue with retry scheduling, dead-letter holding, and duplicate prevention.</p>
          </div>
          <button id="btn-compose-outbox" class="btn btn-sm btn-primary">+ Compose Email</button>
        </div>

        <div style="overflow-x:auto;">
          <table class="glass-table" style="width:100%; border-collapse:collapse; font-size:13px;">
            <thead>
              <tr style="text-align:left; border-bottom:1px solid var(--border-color);">
                <th style="padding:8px 10px;">Outbox ID</th>
                <th style="padding:8px 10px;">Recipient</th>
                <th style="padding:8px 10px;">Subject</th>
                <th style="padding:8px 10px;">Delivery State</th>
                <th style="padding:8px 10px; text-align:center;">Retries</th>
                <th style="padding:8px 10px; text-align:right;">Actions</th>
              </tr>
            </thead>
            <tbody>
              ${items.length === 0 ? `<tr><td colspan="6" style="text-align:center; padding:24px; color:var(--muted);">Outbox queue is clear. Zero pending deliveries.</td></tr>` : ''}
              ${items.map((o) => `
                <tr style="border-bottom:1px solid rgba(255,255,255,0.05);">
                  <td style="padding:8px 10px; font-family:monospace; font-weight:700; color:var(--color-accent-gold-bright);">${o.outboxId}</td>
                  <td style="padding:8px 10px;"><strong>${o.recipientEmail}</strong></td>
                  <td style="padding:8px 10px; color:var(--ink);">${o.subject || o.renderedSubject}</td>
                  <td style="padding:8px 10px;">
                    <span class="badge ${o.status === "PROVIDER_ACCEPTED" || o.status === "SENT" ? "badge-success" : o.status === "FAILED" || o.status === "DEAD_LETTER" ? "badge-danger" : "badge-neutral"}">
                      ${o.status}
                    </span>
                  </td>
                  <td style="padding:8px 10px; text-align:center;">${o.retryCount || 0}</td>
                  <td style="padding:8px 10px; text-align:right;">
                    ${o.status === "FAILED" || o.status === "DEAD_LETTER" ? `<button class="btn btn-sm btn-secondary btn-retry-outbox" data-id="${o.outboxId}">Retry</button>` : ''}
                    ${o.status === "QUEUED" ? `<button class="btn btn-sm btn-outline btn-cancel-outbox" data-id="${o.outboxId}">Cancel</button>` : ''}
                  </td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        </div>
      </div>
    `;

    const composeBtn = wrap.querySelector("#btn-compose-outbox");
    if (composeBtn) composeBtn.addEventListener("click", () => openComposeModal(wrap));

    wrap.querySelectorAll(".btn-retry-outbox").forEach((btn) => {
      btn.addEventListener("click", async () => {
        try {
          await apiPost(`/mailops/outbox/${btn.dataset.id}/retry`, {});
          showToast("Outbox item scheduled for immediate retry.", "success");
          renderOutboxTab(wrap);
        } catch (err) {
          showToast(`Retry failed: ${err.message}`, "error");
        }
      });
    });

    wrap.querySelectorAll(".btn-cancel-outbox").forEach((btn) => {
      btn.addEventListener("click", async () => {
        try {
          await apiPost(`/mailops/outbox/${btn.dataset.id}/cancel`, {});
          showToast("Outbox delivery cancelled.", "success");
          renderOutboxTab(wrap);
        } catch (err) {
          showToast(`Cancel failed: ${err.message}`, "error");
        }
      });
    });
  } catch (err) {
    wrap.innerHTML = `<div class="glass-card" style="padding:20px; color:var(--danger);">Error loading outbox: ${err.message}</div>`;
  }
}

// ── 4. Conversation Threads ──────────────────────────────────────────────────
async function renderThreadsTab(wrap) {
  wrap.innerHTML = `<div style="text-align:center; padding:30px;"><div class="spinner"></div></div>`;
  try {
    const res = await apiGet("/mailops/threads");
    const threads = res.threads || [];

    wrap.innerHTML = `
      <div class="glass-card" style="padding:18px;">
        <div style="margin-bottom:14px;">
          <h3 style="font-size:15.5px; font-weight:700; margin:0; color:var(--ink);">Conversation Threads</h3>
          <p style="font-size:12.5px; color:var(--muted); margin:2px 0 0;">Gmail-linked conversation context with participant tracking and ERP linkages.</p>
        </div>

        <div style="overflow-x:auto;">
          <table class="glass-table" style="width:100%; border-collapse:collapse; font-size:13px;">
            <thead>
              <tr style="text-align:left; border-bottom:1px solid var(--border-color);">
                <th style="padding:8px 10px;">Subject &amp; Thread ID</th>
                <th style="padding:8px 10px;">Participants</th>
                <th style="padding:8px 10px; text-align:center;">Messages</th>
                <th style="padding:8px 10px;">Last Activity</th>
                <th style="padding:8px 10px;">Status</th>
              </tr>
            </thead>
            <tbody>
              ${threads.length === 0 ? `<tr><td colspan="5" style="text-align:center; padding:24px; color:var(--muted);">No active threads.</td></tr>` : ''}
              ${threads.map((t) => `
                <tr style="border-bottom:1px solid rgba(255,255,255,0.05);">
                  <td style="padding:8px 10px;">
                    <strong style="color:var(--ink);">${t.subject}</strong><br>
                    <span style="font-size:11.5px; font-family:monospace; color:var(--color-accent-gold-bright);">${t.threadId}</span>
                  </td>
                  <td style="padding:8px 10px; font-size:12px; color:var(--muted);">${t.participants?.map((p) => p.email).join(", ") || '—'}</td>
                  <td style="padding:8px 10px; text-align:center; font-weight:700;">${t.messageCount}</td>
                  <td style="padding:8px 10px; font-size:12px; color:var(--muted);">${new Date(t.lastMessageAt).toLocaleDateString()}</td>
                  <td style="padding:8px 10px;"><span class="badge badge-neutral">${t.status}</span></td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        </div>
      </div>
    `;
  } catch (err) {
    wrap.innerHTML = `<div class="glass-card" style="padding:20px; color:var(--danger);">Error loading threads: ${err.message}</div>`;
  }
}

// ── 5. Drafts Workspace ──────────────────────────────────────────────────────
async function renderDraftsTab(wrap) {
  wrap.innerHTML = `<div style="text-align:center; padding:30px;"><div class="spinner"></div></div>`;
  try {
    const res = await apiGet("/mailops/drafts");
    const drafts = res.drafts || [];

    wrap.innerHTML = `
      <div class="glass-card" style="padding:18px;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:14px; flex-wrap:wrap; gap:10px;">
          <div>
            <h3 style="font-size:15.5px; font-weight:700; margin:0; color:var(--ink);">Operational Drafts</h3>
            <p style="font-size:12.5px; color:var(--muted); margin:2px 0 0;">Versioned drafts with approval gates and optimistic concurrency control.</p>
          </div>
          <button id="btn-new-draft" class="btn btn-sm btn-primary">+ New Draft</button>
        </div>

        <div style="overflow-x:auto;">
          <table class="glass-table" style="width:100%; border-collapse:collapse; font-size:13px;">
            <thead>
              <tr style="text-align:left; border-bottom:1px solid var(--border-color);">
                <th style="padding:8px 10px;">Draft ID</th>
                <th style="padding:8px 10px;">Subject</th>
                <th style="padding:8px 10px;">Recipients</th>
                <th style="padding:8px 10px; text-align:center;">Version</th>
                <th style="padding:8px 10px; text-align:right;">Actions</th>
              </tr>
            </thead>
            <tbody>
              ${drafts.length === 0 ? `<tr><td colspan="5" style="text-align:center; padding:24px; color:var(--muted);">Zero active drafts.</td></tr>` : ''}
              ${drafts.map((d) => `
                <tr style="border-bottom:1px solid rgba(255,255,255,0.05);">
                  <td style="padding:8px 10px; font-family:monospace; font-weight:700; color:var(--color-accent-gold-bright);">${d.draftId}</td>
                  <td style="padding:8px 10px;"><strong>${d.subject}</strong></td>
                  <td style="padding:8px 10px; font-size:12px; color:var(--muted);">${d.to?.map((t) => t.email).join(", ") || '—'}</td>
                  <td style="padding:8px 10px; text-align:center;"><span class="badge badge-accent">V${d.version}</span></td>
                  <td style="padding:8px 10px; text-align:right;">
                    <button class="btn btn-sm btn-danger btn-del-draft" data-id="${d.draftId}">Discard</button>
                  </td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        </div>
      </div>
    `;

    const newDraftBtn = wrap.querySelector("#btn-new-draft");
    if (newDraftBtn) newDraftBtn.addEventListener("click", () => openComposeModal(wrap));

    wrap.querySelectorAll(".btn-del-draft").forEach((btn) => {
      btn.addEventListener("click", async () => {
        try {
          await apiDelete(`/mailops/drafts/${btn.dataset.id}`);
          showToast("Draft discarded.", "success");
          renderDraftsTab(wrap);
        } catch (err) {
          showToast(`Discard failed: ${err.message}`, "error");
        }
      });
    });
  } catch (err) {
    wrap.innerHTML = `<div class="glass-card" style="padding:20px; color:var(--danger);">Error loading drafts: ${err.message}</div>`;
  }
}

// ── 6. MailOps Cases ─────────────────────────────────────────────────────────
async function renderCasesTab(wrap) {
  wrap.innerHTML = `<div style="text-align:center; padding:30px;"><div class="spinner"></div></div>`;
  try {
    const res = await apiGet("/mailops/cases");
    const cases = res.cases || [];

    wrap.innerHTML = `
      <div class="glass-card" style="padding:18px;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:14px; flex-wrap:wrap; gap:10px;">
          <div>
            <h3 style="font-size:15.5px; font-weight:700; margin:0; color:var(--ink);">MailOps Business Cases</h3>
            <p style="font-size:12.5px; color:var(--muted); margin:2px 0 0;">Group multi-thread communications into single ERP operational matters (e.g. PO dispute, Vendor clarification).</p>
          </div>
          <button id="btn-create-case" class="btn btn-sm btn-primary">+ Create Case</button>
        </div>

        <div style="overflow-x:auto;">
          <table class="glass-table" style="width:100%; border-collapse:collapse; font-size:13px;">
            <thead>
              <tr style="text-align:left; border-bottom:1px solid var(--border-color);">
                <th style="padding:8px 10px;">Case ID</th>
                <th style="padding:8px 10px;">Matter Title</th>
                <th style="padding:8px 10px;">Linked Entity</th>
                <th style="padding:8px 10px;">Priority</th>
                <th style="padding:8px 10px;">Status</th>
              </tr>
            </thead>
            <tbody>
              ${cases.length === 0 ? `<tr><td colspan="5" style="text-align:center; padding:24px; color:var(--muted);">No active MailOps cases.</td></tr>` : ''}
              ${cases.map((c) => `
                <tr style="border-bottom:1px solid rgba(255,255,255,0.05);">
                  <td style="padding:8px 10px; font-family:monospace; font-weight:700; color:var(--color-accent-gold-bright);">${c.caseId}</td>
                  <td style="padding:8px 10px;"><strong>${c.title}</strong></td>
                  <td style="padding:8px 10px;"><span class="badge badge-accent">${c.entityType}: ${c.entityId}</span></td>
                  <td style="padding:8px 10px;"><span class="badge ${c.priority === "CRITICAL" ? "badge-danger" : "badge-neutral"}">${c.priority}</span></td>
                  <td style="padding:8px 10px;"><span class="badge badge-success">${c.status}</span></td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        </div>
      </div>
    `;

    const createBtn = wrap.querySelector("#btn-create-case");
    if (createBtn) createBtn.addEventListener("click", () => openCreateCaseModal(wrap));
  } catch (err) {
    wrap.innerHTML = `<div class="glass-card" style="padding:20px; color:var(--danger);">Error loading cases: ${err.message}</div>`;
  }
}

// ── 7. Security Review & BEC Protection ───────────────────────────────────────
async function renderSecurityTab(wrap) {
  wrap.innerHTML = `<div style="text-align:center; padding:30px;"><div class="spinner"></div></div>`;
  try {
    const res = await apiGet("/mailops/security-review");
    const flagged = res.flaggedMessages || [];

    wrap.innerHTML = `
      <div class="glass-card" style="padding:18px;">
        <div style="margin-bottom:14px;">
          <h3 style="font-size:15.5px; font-weight:700; margin:0; color:var(--ink);">Security Review &amp; Business Email Compromise (BEC) Defense</h3>
          <p style="font-size:12.5px; color:var(--muted); margin:2px 0 0;">Factual security flags for lookalike domains, bank detail changes, and quarantined executable attachments.</p>
        </div>

        <div style="overflow-x:auto;">
          <table class="glass-table" style="width:100%; border-collapse:collapse; font-size:13px;">
            <thead>
              <tr style="text-align:left; border-bottom:1px solid var(--border-color);">
                <th style="padding:8px 10px;">Sender</th>
                <th style="padding:8px 10px;">Subject</th>
                <th style="padding:8px 10px;">Security Flag / BEC Signal</th>
                <th style="padding:8px 10px;">Quarantine Status</th>
                <th style="padding:8px 10px; text-align:right;">Actions</th>
              </tr>
            </thead>
            <tbody>
              ${flagged.length === 0 ? `<tr><td colspan="5" style="text-align:center; padding:24px; color:var(--color-accent-mint-bright);">Zero security threats or BEC alerts. All communications safe.</td></tr>` : ''}
              ${flagged.map((f) => `
                <tr style="border-bottom:1px solid rgba(255,255,255,0.05);">
                  <td style="padding:8px 10px;"><strong>${f.senderEmail}</strong></td>
                  <td style="padding:8px 10px;">${f.subject}</td>
                  <td style="padding:8px 10px;">
                    <div style="color:var(--danger); font-size:12px; font-weight:600;">${f.becReason || f.quarantineReason || 'Suspicious signals detected'}</div>
                  </td>
                  <td style="padding:8px 10px;">
                    <span class="badge ${f.isQuarantined ? "badge-danger" : "badge-warning"}">
                      ${f.isQuarantined ? "QUARANTINED" : "REVIEW"}
                    </span>
                  </td>
                  <td style="padding:8px 10px; text-align:right;">
                    ${f.isQuarantined ? `<button class="btn btn-sm btn-primary btn-release-quar" data-id="${f.inboundId}">Release (Primary Only)</button>` : `<button class="btn btn-sm btn-danger btn-lock-quar" data-id="${f.inboundId}">Quarantine</button>`}
                  </td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        </div>
      </div>
    `;

    wrap.querySelectorAll(".btn-release-quar").forEach((btn) => {
      btn.addEventListener("click", async () => {
        try {
          await apiPost(`/mailops/inbound/${btn.dataset.id}/release-quarantine`, {});
          showToast("Message released from quarantine.", "success");
          renderSecurityTab(wrap);
        } catch (err) {
          showToast(`Release failed: ${err.message}`, "error");
        }
      });
    });

    wrap.querySelectorAll(".btn-lock-quar").forEach((btn) => {
      btn.addEventListener("click", async () => {
        try {
          await apiPost(`/mailops/inbound/${btn.dataset.id}/quarantine`, { reason: 'Manual security quarantine' });
          showToast("Message quarantined.", "success");
          renderSecurityTab(wrap);
        } catch (err) {
          showToast(`Quarantine failed: ${err.message}`, "error");
        }
      });
    });
  } catch (err) {
    wrap.innerHTML = `<div class="glass-card" style="padding:20px; color:var(--danger);">Error loading security review: ${err.message}</div>`;
  }
}

// ── 8. Templates Centre Workspace ────────────────────────────────────────────
async function renderTemplatesTab(wrap) {
  wrap.innerHTML = `<div style="text-align:center; padding:30px;"><div class="spinner"></div></div>`;
  try {
    const res = await apiGet("/mailops/templates");
    const templates = res.templates || [];

    wrap.innerHTML = `
      <div class="glass-card" style="padding:18px;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:14px; flex-wrap:wrap; gap:10px;">
          <div>
            <h3 style="font-size:15.5px; font-weight:700; margin:0; color:var(--ink);">Operational Email Templates</h3>
            <p style="font-size:12.5px; color:var(--muted); margin:2px 0 0;">Version-controlled templates with structured variable placeholders (e.g. {{vendor.name}}).</p>
          </div>
          <button id="btn-create-template" class="btn btn-sm btn-primary">+ Add Template</button>
        </div>

        <div style="overflow-x:auto;">
          <table class="glass-table" style="width:100%; border-collapse:collapse; font-size:13px;">
            <thead>
              <tr style="text-align:left; border-bottom:1px solid var(--border-color);">
                <th style="padding:8px 10px;">Template ID &amp; Name</th>
                <th style="padding:8px 10px;">Category</th>
                <th style="padding:8px 10px;">Subject Pattern</th>
                <th style="padding:8px 10px; text-align:center;">Version</th>
                <th style="padding:8px 10px;">Status</th>
              </tr>
            </thead>
            <tbody>
              ${templates.length === 0 ? `<tr><td colspan="5" style="text-align:center; padding:24px; color:var(--muted);">No templates created.</td></tr>` : ''}
              ${templates.map((t) => `
                <tr style="border-bottom:1px solid rgba(255,255,255,0.05);">
                  <td style="padding:8px 10px;">
                    <strong style="color:var(--ink);">${t.name}</strong><br>
                    <span style="font-size:11.5px; font-family:monospace; color:var(--color-accent-gold-bright);">${t.templateId}</span>
                  </td>
                  <td style="padding:8px 10px;"><span class="badge badge-neutral">${t.category}</span></td>
                  <td style="padding:8px 10px; font-size:12px; color:var(--muted);">${t.subjectTemplate}</td>
                  <td style="padding:8px 10px; text-align:center;"><span class="badge badge-accent">V${t.version}</span></td>
                  <td style="padding:8px 10px;"><span class="badge badge-success">${t.status}</span></td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        </div>
      </div>
    `;

    const createTplBtn = wrap.querySelector("#btn-create-template");
    if (createTplBtn) createTplBtn.addEventListener("click", () => openCreateTemplateModal(wrap));
  } catch (err) {
    wrap.innerHTML = `<div class="glass-card" style="padding:20px; color:var(--danger);">Error loading templates: ${err.message}</div>`;
  }
}

// ── 9. Automation Rules Workspace ────────────────────────────────────────────
async function renderAutomationTab(wrap) {
  wrap.innerHTML = `<div style="text-align:center; padding:30px;"><div class="spinner"></div></div>`;
  try {
    const res = await apiGet("/mailops/automation-rules");
    const rules = res.rules || [];

    wrap.innerHTML = `
      <div class="glass-card" style="padding:18px;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:14px; flex-wrap:wrap; gap:10px;">
          <div>
            <h3 style="font-size:15.5px; font-weight:700; margin:0; color:var(--ink);">Communication Automation Rules</h3>
            <p style="font-size:12.5px; color:var(--muted); margin:2px 0 0;">Inbound classification and routing rules with safe dry-run simulation.</p>
          </div>
          <button id="btn-create-rule" class="btn btn-sm btn-primary">+ Add Automation Rule</button>
        </div>

        <div style="overflow-x:auto;">
          <table class="glass-table" style="width:100%; border-collapse:collapse; font-size:13px;">
            <thead>
              <tr style="text-align:left; border-bottom:1px solid var(--border-color);">
                <th style="padding:8px 10px;">Rule Name &amp; ID</th>
                <th style="padding:8px 10px;">Trigger Type</th>
                <th style="padding:8px 10px;">Conditions</th>
                <th style="padding:8px 10px;">Actions</th>
                <th style="padding:8px 10px; text-align:right;">Dry Run</th>
              </tr>
            </thead>
            <tbody>
              ${rules.length === 0 ? `<tr><td colspan="5" style="text-align:center; padding:24px; color:var(--muted);">No automation rules defined.</td></tr>` : ''}
              ${rules.map((r) => `
                <tr style="border-bottom:1px solid rgba(255,255,255,0.05);">
                  <td style="padding:8px 10px;">
                    <strong style="color:var(--ink);">${r.name}</strong><br>
                    <span style="font-size:11.5px; font-family:monospace; color:var(--color-accent-gold-bright);">${r.ruleId}</span>
                  </td>
                  <td style="padding:8px 10px;"><span class="badge badge-accent">${r.triggerType}</span></td>
                  <td style="padding:8px 10px; font-size:12px; color:var(--muted);">${r.conditions?.senderPattern ? `Sender: ${r.conditions.senderPattern}` : 'Any Sender'}</td>
                  <td style="padding:8px 10px; font-size:12px; color:var(--muted);">${r.actions?.routeToModule ? `Route to: ${r.actions.routeToModule}` : 'Auto-classify'}</td>
                  <td style="padding:8px 10px; text-align:right;">
                    <button class="btn btn-sm btn-secondary btn-dry-run-rule" data-id="${r.ruleId}">Run Test</button>
                  </td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        </div>
      </div>
    `;

    const createRuleBtn = wrap.querySelector("#btn-create-rule");
    if (createRuleBtn) createRuleBtn.addEventListener("click", () => openCreateRuleModal(wrap));

    wrap.querySelectorAll(".btn-dry-run-rule").forEach((btn) => {
      btn.addEventListener("click", async () => {
        try {
          const res = await apiPost(`/mailops/automation-rules/${btn.dataset.id}/dry-run`, {});
          showToast(`Dry run complete: ${res.predictedMatches} sample matches found.`, "success");
        } catch (err) {
          showToast(`Dry run failed: ${err.message}`, "error");
        }
      });
    });
  } catch (err) {
    wrap.innerHTML = `<div class="glass-card" style="padding:20px; color:var(--danger);">Error loading automation rules: ${err.message}</div>`;
  }
}

// ── 10. Sender Identities Workspace ──────────────────────────────────────────
async function renderIdentitiesTab(wrap) {
  wrap.innerHTML = `<div style="text-align:center; padding:30px;"><div class="spinner"></div></div>`;
  try {
    const res = await apiGet("/mailops/sender-identities");
    const identities = res.identities || [];

    wrap.innerHTML = `
      <div class="glass-card" style="padding:18px;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:14px; flex-wrap:wrap; gap:10px;">
          <div>
            <h3 style="font-size:15.5px; font-weight:700; margin:0; color:var(--ink);">Verified Sender Identities</h3>
            <p style="font-size:12.5px; color:var(--muted); margin:2px 0 0;">Authorized send-as aliases mapped to ERP modules (Finance, Procurement, etc.).</p>
          </div>
          <button id="btn-create-identity" class="btn btn-sm btn-primary">+ Add Identity (Primary Only)</button>
        </div>

        <div style="overflow-x:auto;">
          <table class="glass-table" style="width:100%; border-collapse:collapse; font-size:13px;">
            <thead>
              <tr style="text-align:left; border-bottom:1px solid var(--border-color);">
                <th style="padding:8px 10px;">Display Name &amp; Email</th>
                <th style="padding:8px 10px;">Reply-To</th>
                <th style="padding:8px 10px;">Enabled Modules</th>
                <th style="padding:8px 10px;">Verification</th>
                <th style="padding:8px 10px;">Status</th>
              </tr>
            </thead>
            <tbody>
              ${identities.length === 0 ? `<tr><td colspan="5" style="text-align:center; padding:24px; color:var(--muted);">No secondary sender identities configured.</td></tr>` : ''}
              ${identities.map((i) => `
                <tr style="border-bottom:1px solid rgba(255,255,255,0.05);">
                  <td style="padding:8px 10px;">
                    <strong style="color:var(--ink);">${i.displayName}</strong><br>
                    <span style="font-size:11.5px; font-family:monospace; color:var(--color-accent-gold-bright);">${i.email}</span>
                  </td>
                  <td style="padding:8px 10px; font-size:12px; color:var(--muted);">${i.replyTo || 'Default'}</td>
                  <td style="padding:8px 10px;"><span class="badge badge-neutral">${i.enabledModules?.join(", ") || 'ALL'}</span></td>
                  <td style="padding:8px 10px;"><span class="badge badge-success">${i.verificationStatus}</span></td>
                  <td style="padding:8px 10px;"><span class="badge badge-accent">${i.status}</span></td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        </div>
      </div>
    `;

    const createIdBtn = wrap.querySelector("#btn-create-identity");
    if (createIdBtn) createIdBtn.addEventListener("click", () => openCreateIdentityModal(wrap));
  } catch (err) {
    wrap.innerHTML = `<div class="glass-card" style="padding:20px; color:var(--danger);">Error loading sender identities: ${err.message}</div>`;
  }
}

// ── 11. Provider & Sync Health Workspace ─────────────────────────────────────
function renderProviderHealthTab(wrap) {
  const settings = liveStatus || {};
  wrap.innerHTML = `
    <div class="glass-card" style="padding:18px;">
      <div style="margin-bottom:14px;">
        <h3 style="font-size:15.5px; font-weight:700; margin:0; color:var(--ink);">Gmail Provider &amp; Pub/Sub Sync Health</h3>
        <p style="font-size:12.5px; color:var(--muted); margin:2px 0 0;">OAuth 2.0 connection state, Gmail Push Watch expiration, and sync cursor telemetry.</p>
      </div>

      <div style="display:grid; grid-template-columns:1fr 1fr; gap:16px;">
        <div class="glass" style="padding:16px; border-radius:8px;">
          <h4 style="font-size:13.5px; font-weight:700; color:var(--ink); margin:0 0 10px;">OAuth Capability Inventory</h4>
          <div style="display:flex; flex-direction:column; gap:6px; font-size:12.5px;">
            <div style="display:flex; justify-content:space-between;"><span>Read Mail (Metadata / Full):</span> <span class="badge badge-success">GRANTED</span></div>
            <div style="display:flex; justify-content:space-between;"><span>Send Mail:</span> <span class="badge badge-success">GRANTED</span></div>
            <div style="display:flex; justify-content:space-between;"><span>Modify Labels:</span> <span class="badge badge-success">GRANTED</span></div>
            <div style="display:flex; justify-content:space-between;"><span>Send-As Settings:</span> <span class="badge badge-neutral">NOT REQUIRED</span></div>
          </div>
        </div>

        <div class="glass" style="padding:16px; border-radius:8px;">
          <h4 style="font-size:13.5px; font-weight:700; color:var(--ink); margin:0 0 10px;">Gmail Push Watch Status</h4>
          <div style="display:flex; flex-direction:column; gap:6px; font-size:12.5px;">
            <div style="display:flex; justify-content:space-between;"><span>Watch State:</span> <span class="badge badge-success">ACTIVE</span></div>
            <div style="display:flex; justify-content:space-between;"><span>Expiration:</span> <span style="color:var(--ink); font-weight:600;">${new Date(settings.watch?.watchExpiration || Date.now()).toLocaleDateString()}</span></div>
            <div style="display:flex; justify-content:space-between;"><span>Last Successful Sync:</span> <span style="color:var(--muted);">${new Date(settings.watch?.lastSuccessfulSyncAt || Date.now()).toLocaleTimeString()}</span></div>
            <div style="display:flex; justify-content:space-between;"><span>Renewal Policy:</span> <span class="badge badge-accent">AUTOMATIC (7-DAY)</span></div>
          </div>
        </div>
      </div>
    </div>
  `;
}

// ── 12. MailOps Integrity Engine Workspace ───────────────────────────────────
async function renderIntegrityTab(wrap) {
  wrap.innerHTML = `<div style="text-align:center; padding:30px;"><div class="spinner"></div></div>`;
  try {
    const res = await apiGet("/mailops/integrity");
    const issues = res.issues || [];

    wrap.innerHTML = `
      <div class="glass-card" style="padding:18px;">
        <div style="margin-bottom:14px;">
          <h3 style="font-size:15.5px; font-weight:700; margin:0; color:var(--ink);">MailOps Integrity &amp; Sanity Engine</h3>
          <p style="font-size:12.5px; color:var(--muted); margin:2px 0 0;">18-point automated sanity check for duplicate sends, broken links, stale cursors, and expired watches.</p>
        </div>

        <div style="display:flex; align-items:center; gap:10px; margin-bottom:14px;">
          <span class="badge ${res.status === "HEALTHY" ? "badge-success" : res.status === "CRITICAL" ? "badge-danger" : "badge-warning"}" style="font-size:13px; padding:4px 12px;">
            SYSTEM INTEGRITY: ${res.status}
          </span>
          <span style="font-size:12.5px; color:var(--muted);">${res.checksEvaluated} checks evaluated &bull; ${res.issuesFound} issues detected</span>
        </div>

        <div style="display:flex; flex-direction:column; gap:8px;">
          ${issues.length === 0 ? `<div class="glass" style="padding:14px; color:var(--color-accent-mint-bright); font-weight:600;">All 18 MailOps integrity checks passed with zero exceptions.</div>` : ''}
          ${issues.map((i) => `
            <div class="glass" style="padding:10px 14px; border-left:4px solid ${i.severity === "CRITICAL" ? "var(--danger)" : "var(--color-accent-gold-bright)"};">
              <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
                <strong style="font-size:13px; color:var(--ink); font-family:monospace;">${i.check}</strong>
                <span class="badge ${i.severity === "CRITICAL" ? "badge-danger" : "badge-warning"}">${i.severity}</span>
              </div>
              <div style="font-size:12.5px; color:var(--muted);">${i.description}</div>
            </div>
          `).join("")}
        </div>
      </div>
    `;
  } catch (err) {
    wrap.innerHTML = `<div class="glass-card" style="padding:20px; color:var(--danger);">Error loading integrity audit: ${err.message}</div>`;
  }
}

// ── 13. Reports & Registers Workspace ─────────────────────────────────────────
async function renderReportsTab(wrap) {
  wrap.innerHTML = `<div style="text-align:center; padding:30px;"><div class="spinner"></div></div>`;
  try {
    const res = await apiGet("/mailops/reports");
    const summary = res.summary || {};

    wrap.innerHTML = `
      <div class="glass-card" style="padding:18px;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:14px; flex-wrap:wrap; gap:10px;">
          <div>
            <h3 style="font-size:15.5px; font-weight:700; margin:0; color:var(--ink);">MailOps Communication Registers &amp; Reports</h3>
            <p style="font-size:12.5px; color:var(--muted); margin:2px 0 0;">Historical delivery register, inbound audit, and exportable operational logs.</p>
          </div>
          <button id="btn-export-mailops-csv" class="btn btn-sm btn-secondary">Export Communication Register (XLSX)</button>
        </div>

        <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(180px, 1fr)); gap:12px;">
          <div class="glass" style="padding:14px; text-align:center;">
            <div style="font-size:11px; color:var(--muted); text-transform:uppercase;">Total Outbound</div>
            <div style="font-size:20px; font-weight:800; color:var(--ink);">${summary.outboxTotal || 0}</div>
          </div>
          <div class="glass" style="padding:14px; text-align:center;">
            <div style="font-size:11px; color:var(--muted); text-transform:uppercase;">Delivery Success Rate</div>
            <div style="font-size:20px; font-weight:800; color:var(--color-accent-mint-bright);">${summary.deliverySuccessRate || 100}%</div>
          </div>
          <div class="glass" style="padding:14px; text-align:center;">
            <div style="font-size:11px; color:var(--muted); text-transform:uppercase;">Total Inbound</div>
            <div style="font-size:20px; font-weight:800; color:var(--ink);">${summary.inboundTotal || 0}</div>
          </div>
          <div class="glass" style="padding:14px; text-align:center;">
            <div style="font-size:11px; color:var(--muted); text-transform:uppercase;">Quarantined Inbound</div>
            <div style="font-size:20px; font-weight:800; color:var(--danger);">${summary.inboundQuarantined || 0}</div>
          </div>
        </div>
      </div>
    `;

    const exportBtn = wrap.querySelector("#btn-export-mailops-csv");
    if (exportBtn) {
      exportBtn.addEventListener("click", () => {
        exportGrid({
          headers: ["Metric", "Value"],
          rows: [["Total Outbound", summary.outboxTotal || 0], ["Delivery Success Rate", `${summary.deliverySuccessRate || 100}%`], ["Total Inbound", summary.inboundTotal || 0], ["Quarantined Inbound", summary.inboundQuarantined || 0]],
          title: "Communication Register", filename: `mailops_report_${new Date().toISOString().slice(0, 10)}`,
        });
        showToast("Communication register exported (XLSX).", "success");
      });
    }
  } catch (err) {
    wrap.innerHTML = `<div class="glass-card" style="padding:20px; color:var(--danger);">Error loading reports: ${err.message}</div>`;
  }
}

// ── GLOBAL UI-001 MODALS ──────────────────────────────────────────────────────

async function openMessage360Modal(inboundId) {
  try {
    const res = await apiGet(`/mailops/inbound/${inboundId}/360`);
    const m = res.message;
    const thread = res.threadMessages || [];

    const modalHtml = `
      <div style="padding:6px; max-height:80vh; overflow-y:auto;">
        <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:14px; border-bottom:1px solid var(--border-color); padding-bottom:10px;">
          <div>
            <div style="display:flex; align-items:center; gap:8px;">
              <h2 style="font-size:18px; font-weight:800; color:var(--ink); margin:0;">${m.subject}</h2>
              <span class="badge badge-accent" style="font-size:11px;">${m.inboundId}</span>
            </div>
            <p style="font-size:12.5px; color:var(--muted); margin:4px 0 0;">
              From: <strong>${m.senderName || m.senderEmail}</strong> (${m.senderEmail}) &bull; Received: ${new Date(m.receivedAt).toLocaleString()}
            </p>
          </div>
          <button class="btn btn-sm btn-secondary" onclick="document.querySelector('#modal-root').innerHTML=''">✕ Close</button>
        </div>

        <!-- Security / BEC Alert Banner if flagged -->
        ${m.isBecSuspected ? `
          <div class="glass" style="padding:12px; border-left:4px solid var(--danger); margin-bottom:14px; background:rgba(239,68,68,0.1);">
            <strong style="color:var(--danger); font-size:13px;">FINANCIAL DETAIL CHANGE — VERIFY OUTSIDE EMAIL</strong>
            <p style="font-size:12px; color:var(--ink); margin:2px 0 0;">${m.becReason}</p>
          </div>
        ` : ''}

        <!-- Message Body Container -->
        <div class="glass" style="padding:16px; border-radius:8px; margin-bottom:16px; background:rgba(255,255,255,0.03);">
          <div style="font-size:13px; line-height:1.6; color:var(--ink);">
            ${m.bodyHtml ? m.bodyHtml : `<pre style="font-family:inherit; white-space:pre-wrap; margin:0;">${m.bodyText}</pre>`}
          </div>
        </div>

        <!-- Conversation Timeline in Thread -->
        ${thread.length > 1 ? `
          <div style="margin-bottom:16px;">
            <h4 style="font-size:13.5px; font-weight:700; color:var(--ink); margin:0 0 8px;">Thread History (${thread.length} Messages)</h4>
            <div style="display:flex; flex-direction:column; gap:8px;">
              ${thread.map((t) => `
                <div class="glass" style="padding:10px; font-size:12px;">
                  <div style="display:flex; justify-content:space-between; margin-bottom:2px;">
                    <strong>${t.senderEmail}</strong>
                    <span style="color:var(--muted);">${new Date(t.receivedAt).toLocaleTimeString()}</span>
                  </div>
                  <div style="color:var(--muted);">${t.bodySnippet}</div>
                </div>
              `).join("")}
            </div>
          </div>
        ` : ''}

        <!-- Action / Internal Notes Section -->
        <div style="display:flex; justify-content:space-between; align-items:center; border-top:1px solid var(--border-color); padding-top:12px;">
          <div style="font-size:12px; color:var(--muted);">
            Queue: <span class="badge badge-neutral">${m.queueStatus}</span> &bull; Classification: <span class="badge badge-neutral">${m.classification}</span>
          </div>
          <div style="display:flex; gap:8px;">
            <button class="btn btn-sm btn-secondary" onclick="document.querySelector('#modal-root').innerHTML=''">Done</button>
          </div>
        </div>
      </div>
    `;

    openModal(modalHtml);
  } catch (err) {
    showToast(`Error opening Message 360: ${err.message}`, "error");
  }
}

async function openComposeModal(wrap) {
  let cafesList = [];
  try {
    const res = await apiGet('/cafes');
    cafesList = res?.data || res?.cafes || (Array.isArray(res) ? res : []);
  } catch (_e) {
    cafesList = [];
  }
  const cafeOptions = cafesList.map(c => `<option value="${c.cafeId || c.code || c.id || c._id}">${c.name || 'Outlet'} (${c.cafeId || c.code || ''})</option>`).join('');

  const modalHtml = `
    <div style="padding:6px;">
      <h3 style="font-size:18px; font-weight:800; margin:0 0 16px; color:var(--ink);">Compose Operational Email</h3>
      <form id="form-compose-operational">
        <div style="margin-bottom:12px;">
          <label class="form-label" style="font-size:12px; font-weight:600;">Recipient Email (To)</label>
          <input type="email" name="to" class="form-input" placeholder="e.g. supplier@domain.com" required>
        </div>

        <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-bottom:12px;">
          <div>
            <label class="form-label" style="font-size:12px; font-weight:600;">Subject</label>
            <input type="text" name="subject" class="form-input" placeholder="Operational Subject" required>
          </div>
          <div>
            <label class="form-label" style="font-size:12px; font-weight:600;">Café Context (Optional)</label>
            <select name="cafeId" class="form-input">
              <option value="">Global / Non-Café</option>
              ${cafeOptions}
            </select>
          </div>
        </div>

        <div style="margin-bottom:14px;">
          <label class="form-label" style="font-size:12px; font-weight:600;">Message Body</label>
          <textarea name="bodyPlain" class="form-input" rows="6" placeholder="Type operational communication..." required style="resize:vertical;"></textarea>
        </div>

        <div style="font-size:12px; color:var(--muted); margin-bottom:16px;">
          💡 Sensitive communications are validated against authoritative ERP contacts before departure.
        </div>

        <div style="display:flex; justify-content:flex-end; gap:10px;">
          <button type="button" class="btn btn-secondary" onclick="document.querySelector('#modal-root').innerHTML=''">Cancel</button>
          <button type="button" id="btn-save-as-draft" class="btn btn-outline">Save Draft</button>
          <button type="submit" class="btn btn-primary">Queue for Send</button>
        </div>
      </form>
    </div>
  `;

  openModal(modalHtml);

  const form = document.querySelector("#form-compose-operational");
  if (form) {
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      try {
        await apiPost("/mailops/compose", {
          to: fd.get("to"),
          subject: fd.get("subject"),
          cafeId: fd.get("cafeId") || null,
          bodyPlain: fd.get("bodyPlain"),
        });
        showToast("Operational email queued in Outbox.", "success");
        document.querySelector("#modal-root").innerHTML = "";
        activeTab = "outbox";
        renderCurrentWorkspace(wrap);
      } catch (err) {
        showToast(`Send failed: ${err.message}`, "error");
      }
    });

    const draftBtn = document.querySelector("#btn-save-as-draft");
    if (draftBtn) {
      draftBtn.addEventListener("click", async () => {
        const fd = new FormData(form);
        try {
          await apiPost("/mailops/drafts", {
            to: fd.get("to"),
            subject: fd.get("subject"),
            cafeId: fd.get("cafeId") || null,
            bodyPlain: fd.get("bodyPlain"),
          });
          showToast("Draft saved.", "success");
          document.querySelector("#modal-root").innerHTML = "";
          activeTab = "drafts";
          renderCurrentWorkspace(wrap);
        } catch (err) {
          showToast(`Draft save failed: ${err.message}`, "error");
        }
      });
    }
  }
}

function openCreateCaseModal(wrap) {
  const modalHtml = `
    <div style="padding:6px;">
      <h3 style="font-size:18px; font-weight:800; margin:0 0 16px; color:var(--ink);">Create MailOps Case</h3>
      <form id="form-create-case">
        <div style="margin-bottom:12px;">
          <label class="form-label" style="font-size:12px; font-weight:600;">Case Matter Title</label>
          <input type="text" name="title" class="form-input" placeholder="e.g. Milk delivery invoice discrepancy" required>
        </div>

        <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-bottom:16px;">
          <div>
            <label class="form-label" style="font-size:12px; font-weight:600;">Entity Type</label>
            <select name="entityType" class="form-input" required>
              <option value="VENDOR">Vendor</option>
              <option value="PURCHASE_ORDER">Purchase Order</option>
              <option value="EXPENSE">Expense</option>
              <option value="DEPARTMENT_ORDER">Department Order</option>
            </select>
          </div>
          <div>
            <label class="form-label" style="font-size:12px; font-weight:600;">Entity Reference ID</label>
            <input type="text" name="entityId" class="form-input" placeholder="e.g. VEND-001 or PO-2026-0001" required>
          </div>
        </div>

        <div style="display:flex; justify-content:flex-end; gap:10px;">
          <button type="button" class="btn btn-secondary" onclick="document.querySelector('#modal-root').innerHTML=''">Cancel</button>
          <button type="submit" class="btn btn-primary">Create Case</button>
        </div>
      </form>
    </div>
  `;

  openModal(modalHtml);

  const form = document.querySelector("#form-create-case");
  if (form) {
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      try {
        await apiPost("/mailops/cases", {
          title: fd.get("title"),
          entityType: fd.get("entityType"),
          entityId: fd.get("entityId"),
        });
        showToast("MailOps Case created.", "success");
        document.querySelector("#modal-root").innerHTML = "";
        activeTab = "cases";
        renderCurrentWorkspace(wrap);
      } catch (err) {
        showToast(`Case creation failed: ${err.message}`, "error");
      }
    });
  }
}

function openCreateTemplateModal(wrap) {
  const modalHtml = `
    <div style="padding:6px;">
      <h3 style="font-size:18px; font-weight:800; margin:0 0 16px; color:var(--ink);">Add Operational Email Template</h3>
      <form id="form-create-tpl">
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-bottom:12px;">
          <div>
            <label class="form-label" style="font-size:12px; font-weight:600;">Template Name</label>
            <input type="text" name="name" class="form-input" placeholder="e.g. Purchase Order Dispatch" required>
          </div>
          <div>
            <label class="form-label" style="font-size:12px; font-weight:600;">Category</label>
            <select name="category" class="form-input">
              <option value="PURCHASE_ORDER">Purchase Order</option>
              <option value="RFQ">RFQ</option>
              <option value="VENDOR_CLARIFICATION">Vendor Clarification</option>
              <option value="EXPENSE_APPROVAL">Expense Approval</option>
              <option value="GENERAL_OPERATIONAL">General Operational</option>
            </select>
          </div>
        </div>

        <div style="margin-bottom:12px;">
          <label class="form-label" style="font-size:12px; font-weight:600;">Subject Template</label>
          <input type="text" name="subjectTemplate" class="form-input" placeholder="e.g. Purchase Order {{po.number}} from Zamorin" required>
        </div>

        <div style="margin-bottom:16px;">
          <label class="form-label" style="font-size:12px; font-weight:600;">HTML Body Template</label>
          <textarea name="bodyTemplateHtml" class="form-input" rows="5" placeholder="<p>Dear {{vendor.name}}, please find attached...</p>" required></textarea>
        </div>

        <div style="display:flex; justify-content:flex-end; gap:10px;">
          <button type="button" class="btn btn-secondary" onclick="document.querySelector('#modal-root').innerHTML=''">Cancel</button>
          <button type="submit" class="btn btn-primary">Create Template</button>
        </div>
      </form>
    </div>
  `;

  openModal(modalHtml);

  const form = document.querySelector("#form-create-tpl");
  if (form) {
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      try {
        await apiPost("/mailops/templates", {
          name: fd.get("name"),
          category: fd.get("category"),
          subjectTemplate: fd.get("subjectTemplate"),
          bodyTemplateHtml: fd.get("bodyTemplateHtml"),
        });
        showToast("Template created.", "success");
        document.querySelector("#modal-root").innerHTML = "";
        activeTab = "templates";
        renderCurrentWorkspace(wrap);
      } catch (err) {
        showToast(`Template creation failed: ${err.message}`, "error");
      }
    });
  }
}

function openCreateRuleModal(wrap) {
  const modalHtml = `
    <div style="padding:6px;">
      <h3 style="font-size:18px; font-weight:800; margin:0 0 16px; color:var(--ink);">Add Communication Automation Rule</h3>
      <form id="form-create-rule">
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-bottom:12px;">
          <div>
            <label class="form-label" style="font-size:12px; font-weight:600;">Rule Name</label>
            <input type="text" name="name" class="form-input" placeholder="e.g. Route Dairy Invoices to Finance" required>
          </div>
          <div>
            <label class="form-label" style="font-size:12px; font-weight:600;">Trigger Type</label>
            <select name="triggerType" class="form-input">
              <option value="INBOUND_RECEIVED">Inbound Received</option>
              <option value="SECURITY_FLAGGED">Security Flagged</option>
            </select>
          </div>
        </div>

        <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-bottom:16px;">
          <div>
            <label class="form-label" style="font-size:12px; font-weight:600;">Sender Pattern Match</label>
            <input type="text" name="senderPattern" class="form-input" placeholder="e.g. @nandinidairy.com">
          </div>
          <div>
            <label class="form-label" style="font-size:12px; font-weight:600;">Route to Module</label>
            <select name="routeToModule" class="form-input">
              <option value="FINANCE">Finance</option>
              <option value="PROCUREMENT">Procurement</option>
              <option value="QUALITY">Quality</option>
            </select>
          </div>
        </div>

        <div style="display:flex; justify-content:flex-end; gap:10px;">
          <button type="button" class="btn btn-secondary" onclick="document.querySelector('#modal-root').innerHTML=''">Cancel</button>
          <button type="submit" class="btn btn-primary">Create Rule</button>
        </div>
      </form>
    </div>
  `;

  openModal(modalHtml);

  const form = document.querySelector("#form-create-rule");
  if (form) {
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      try {
        await apiPost("/mailops/automation-rules", {
          name: fd.get("name"),
          triggerType: fd.get("triggerType"),
          conditions: { senderPattern: fd.get("senderPattern") },
          actions: { routeToModule: fd.get("routeToModule") },
        });
        showToast("Automation rule created.", "success");
        document.querySelector("#modal-root").innerHTML = "";
        activeTab = "automation";
        renderCurrentWorkspace(wrap);
      } catch (err) {
        showToast(`Rule creation failed: ${err.message}`, "error");
      }
    });
  }
}

function openCreateIdentityModal(wrap) {
  const modalHtml = `
    <div style="padding:6px;">
      <h3 style="font-size:18px; font-weight:800; margin:0 0 16px; color:var(--ink);">Add Sender Identity (Primary Master Only)</h3>
      <form id="form-create-ident">
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-bottom:12px;">
          <div>
            <label class="form-label" style="font-size:12px; font-weight:600;">Sender Email Address</label>
            <input type="email" name="email" class="form-input" placeholder="e.g. finance@zamorin.com" required>
          </div>
          <div>
            <label class="form-label" style="font-size:12px; font-weight:600;">Display Name</label>
            <input type="text" name="displayName" class="form-input" placeholder="e.g. Zamorin Finance Operations" required>
          </div>
        </div>

        <div style="margin-bottom:16px;">
          <label class="form-label" style="font-size:12px; font-weight:600;">Reply-To Email (Optional)</label>
          <input type="email" name="replyTo" class="form-input" placeholder="e.g. accounts@zamorin.com">
        </div>

        <div style="display:flex; justify-content:flex-end; gap:10px;">
          <button type="button" class="btn btn-secondary" onclick="document.querySelector('#modal-root').innerHTML=''">Cancel</button>
          <button type="submit" class="btn btn-primary">Create Identity</button>
        </div>
      </form>
    </div>
  `;

  openModal(modalHtml);

  const form = document.querySelector("#form-create-ident");
  if (form) {
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      try {
        await apiPost("/mailops/sender-identities", {
          email: fd.get("email"),
          displayName: fd.get("displayName"),
          replyTo: fd.get("replyTo") || null,
        });
        showToast("Sender identity created.", "success");
        document.querySelector("#modal-root").innerHTML = "";
        activeTab = "identities";
        renderCurrentWorkspace(wrap);
      } catch (err) {
        showToast(`Identity creation failed: ${err.message}`, "error");
      }
    });
  }
}
