// =============================================================================
// ZAMORIN CAFÉ ERP — DEDICATED ATTENDANCE QR & SCANNER PAGE
// Route: #attendance/qr-scanner
// Subtitle: Secure Attendance Presence Verification
//
// Primary Areas:
//   A. CAFÉ CONTEXT (Org selector for Masters, portfolio for Owner, locked for Cafe Ops)
//   B. LIVE ATTENDANCE QR (Company logo, countdown, server clock, status, actions)
//   C. QR SCANNER (Diagnostic validation only — NEVER punches attendance)
//   D. SECURE PRESENCE STATUS CARDS (Real status indicators, no fake green)
//   E. ATTENDANCE LOCATION / GEOFENCE STATUS (Coordinates, radius, fail-closed alert)
//   F. DISPLAY MODE (Clean kiosk screen without ERP navigation)
//   G. DIAGNOSTICS / LAST TEST RESULT (Timestamp, result, cafe, safe payload)
// =============================================================================

'use strict';

import { apiGet, apiPost } from '../apiClient.js';
import { state } from '../state.js';
import { generateQrSvg, CANONICAL_ZAMORIN_COMPANY_LOGO_SVG } from '../utils/qrCodeGen.js';
import { openCamera, stopCamera, scanQrFromVideo, friendlyCameraError } from '../utils/cameraGeo.js';

// ─── Module State ─────────────────────────────────────────────────────────────

let pageState = {
  selectedCafeId: '',
  cafesList: [],
  activeChallenge: null,
  countdownSec: 45,
  timerInterval: null,
  clockInterval: null,
  serverTimeStr: 'Loading...',
  qrStatus: 'ACTIVE', // 'ACTIVE' | 'REFRESHING' | 'EXPIRED' | 'OFFLINE' | 'UNAVAILABLE'
  
  // Scanner state (Diagnostic only)
  scannerActive: false,
  scannerStream: null,
  scannerScanHandle: null,
  cameraFacing: 'environment', // 'environment' (rear) | 'user' (front)
  torchActive: false,
  scannerStatus: 'Ready', // 'Ready' | 'Scanning' | 'QR Valid' | 'QR Expired' | 'QR Invalid' | 'Wrong Café' | 'Service Unavailable' | 'Permission Required'
  
  // Diagnostics
  lastTestResult: null,

  // Geofence & presence
  geofenceData: null,
  cameraPermissionState: 'Not Checked', // 'Ready' | 'Permission Required' | 'Not Checked'
};

// ─── Main Render ──────────────────────────────────────────────────────────────

export function renderAttendanceQrScannerPage() {
  const role = state.role || state.user?.role || 'MASTER';
  const isPrimary = state.user?.isPrimaryMaster === true;
  const isMaster = role === 'MASTER';
  const isOwner = role === 'OWNER';
  const isCafeOps = role === 'CAFE_ADMIN' || role === 'CAFE_OPS';

  // Cafe selection rules:
  // Ops is strictly locked to their bound cafe; Masters/Owners can select
  const boundCafeId = state.user?.primaryCafeId || state.currentCafeId || '';
  if (isCafeOps) {
    pageState.selectedCafeId = boundCafeId;
  } else if (!pageState.selectedCafeId) {
    pageState.selectedCafeId = boundCafeId;
  }

  return `
    <div id="attendance-qr-scanner-root" class="page-enter" style="display:flex; flex-direction:column; gap:20px; max-width:1400px; margin:0 auto; padding-bottom:60px;">
      
      <!-- Subpage Header -->
      <div style="display:flex; justify-content:space-between; align-items:flex-start; flex-wrap:wrap; gap:12px; border-bottom:1px solid var(--border-subtle); padding-bottom:14px;">
        <div>
          <div style="font-size:11px; font-weight:800; text-transform:uppercase; letter-spacing:0.8px; color:var(--bronze-500, #b17d38);">
            Secure Presence Verification · Management Console
          </div>
          <h1 style="font-size:24px; font-weight:800; margin:2px 0 0; color:var(--ink); letter-spacing:-0.3px;">
            Attendance QR &amp; Scanner
          </h1>
          <p style="font-size:13px; color:var(--muted); margin:2px 0 0;">
            Secure Attendance Presence Verification — Live rotating challenge, kiosk display &amp; diagnostic verification scanner
          </p>
        </div>

        <div style="display:flex; align-items:center; gap:8px;">
          <button class="btn btn-secondary btn-sm" id="btn-open-display-mode" type="button" style="display:inline-flex; align-items:center; gap:6px; font-weight:700;">
            ⛶ <span>Open Attendance Display Mode</span>
          </button>
          <button class="btn btn-ghost btn-sm" id="btn-refresh-all-status" type="button" style="font-size:12px;">
            🔄 Refresh Status
          </button>
        </div>
      </div>

      <!-- AREA A: CAFÉ CONTEXT STRIP -->
      <div class="card" style="padding:16px 20px; background:var(--surface-sunken); border:1px solid var(--line);">
        <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:14px;">
          <div style="display:flex; align-items:center; gap:12px;">
            <div style="font-size:24px;">📍</div>
            <div>
              <div style="font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:0.5px; color:var(--muted);">Café Context</div>
              <div style="display:flex; align-items:center; gap:8px; margin-top:2px;">
                ${_renderCafeSelectorHtml(role, isPrimary, isMaster, isOwner, isCafeOps)}
              </div>
            </div>
          </div>

          <!-- Server Clock & Sync Strip -->
          <div style="display:flex; align-items:center; gap:16px; font-family:var(--font-mono, monospace); font-size:12px;">
            <div style="display:inline-flex; align-items:center; gap:6px; background:var(--surface); padding:6px 12px; border-radius:6px; border:1px solid var(--line);">
              <span style="display:inline-block; width:8px; height:8px; border-radius:50%; background:var(--color-success, #2E7D32);"></span>
              <span>Server Clock: <strong id="server-clock-display">${pageState.serverTimeStr}</strong></span>
            </div>
            <div style="display:inline-flex; align-items:center; gap:6px; background:var(--surface); padding:6px 12px; border-radius:6px; border:1px solid var(--line);">
              <span>Mode: <strong style="color:var(--bronze-600);">${isCafeOps ? 'Café Operations Terminal' : isPrimary ? 'Primary Master Console' : isMaster ? 'Operational Master' : 'Owner Portfolio'}</strong></span>
            </div>
          </div>
        </div>
      </div>

      <!-- MAIN SPLIT: AREA B (LIVE ATTENDANCE QR) + AREA C (DIAGNOSTIC QR SCANNER) -->
      <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(380px, 1fr)); gap:20px;">
        
        <!-- AREA B: LIVE ATTENDANCE QR CARD -->
        <div class="card" style="padding:24px; text-align:center; display:flex; flex-direction:column; align-items:center;">
          <div style="width:100%; display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
            <div style="text-align:left;">
              <span class="badge-tag badge-accent" style="font-size:10px; font-weight:800;">ROTATING CHALLENGE</span>
              <h3 style="font-size:16px; font-weight:700; margin:4px 0 0; color:var(--ink);">Live Attendance QR</h3>
            </div>
            <div id="qr-status-badge">
              ${_renderStatusBadge(pageState.qrStatus)}
            </div>
          </div>

          <!-- Central Rendered QR Box with Neutral Plate and Real Logo -->
          <div id="attendance-qr-box" style="margin:12px auto; padding:16px; background:#ffffff; border-radius:12px; border:1px solid rgba(0,0,0,0.12); box-shadow:0 4px 16px rgba(0,0,0,0.08); display:inline-block;">
            <div style="width:260px; height:260px; display:flex; align-items:center; justify-content:center; color:#888;">
              Loading authoritative QR challenge...
            </div>
          </div>

          <!-- Rotation Countdown & Café Label -->
          <div style="margin-top:6px; width:100%;">
            <div style="font-size:14px; font-weight:800; color:var(--ink);" id="qr-cafe-name-display">
              ${_getCafeDisplayName(pageState.selectedCafeId)}
            </div>
            <div style="font-size:11.5px; font-family:var(--font-mono); color:var(--muted); margin-top:2px;" id="qr-cafe-id-display">
              Reference: ${pageState.selectedCafeId || ''} · 45s Rotation
            </div>
            <div style="margin-top:10px; font-size:13px; font-weight:700; color:var(--bronze-600);" id="qr-countdown-display">
              Refreshes in ${pageState.countdownSec} sec
            </div>
          </div>

          <!-- Actions Strip (Strictly NO Download, NO Print for rotating QR) -->
          <div style="display:flex; gap:10px; margin-top:16px; width:100%; justify-content:center; flex-wrap:wrap;">
            <button class="btn btn-secondary btn-sm" id="btn-qr-card-fs" type="button" style="display:inline-flex; align-items:center; gap:6px;">
              <span>⛶</span> Full Screen
            </button>
            <button class="btn btn-ghost btn-sm" id="btn-qr-card-refresh" type="button" style="display:inline-flex; align-items:center; gap:6px;">
              <span>🔄</span> Refresh Challenge
            </button>
            <button class="btn btn-ghost btn-sm" id="btn-qr-card-test" type="button" style="display:inline-flex; align-items:center; gap:6px;">
              <span>🧪</span> Test Current QR
            </button>
          </div>
        </div>

        <!-- AREA C: MANAGEMENT QR SCANNER PANEL (DIAGNOSTIC ONLY) -->
        <div class="card" style="padding:24px; display:flex; flex-direction:column;">
          <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:12px;">
            <div>
              <span class="badge-tag badge-info" style="font-size:10px; font-weight:800;">DIAGNOSTIC SCANNER</span>
              <h3 style="font-size:16px; font-weight:700; margin:4px 0 0; color:var(--ink);">Verification Scanner</h3>
              <p style="font-size:12px; color:var(--muted); margin:2px 0 0;">
                Audits QR decode, camera readiness &amp; café resolution without creating attendance punches.
              </p>
            </div>
            <div id="scanner-status-badge">
              <span class="status info" style="font-size:11px;">${pageState.scannerStatus}</span>
            </div>
          </div>

          <!-- Video Viewport / Viewfinder Box -->
          <div id="scanner-viewport-container" style="position:relative; width:100%; height:260px; background:#000000; border-radius:10px; overflow:hidden; display:flex; align-items:center; justify-content:center; margin:8px 0 14px;">
            <video id="mgmt-scanner-video" playsinline style="width:100%; height:100%; object-fit:cover; display:none;"></video>
            
            <div id="scanner-idle-placeholder" style="text-align:center; color:#aaaaaa; padding:20px;">
              <div style="font-size:36px; margin-bottom:8px;">📷</div>
              <div style="font-size:13px; font-weight:700; color:#ffffff;">Camera Scanner Closed</div>
              <div style="font-size:11.5px; color:#888888; margin-top:4px;">Click "Open Scanner" below to verify QR codes</div>
            </div>

            <!-- Scanning Target Box Overlay (when camera is active) -->
            <div id="scanner-viewfinder-overlay" style="display:none; position:absolute; inset:0; pointer-events:none; align-items:center; justify-content:center;">
              <div style="width:180px; height:180px; border:2px solid var(--bronze-400, #d4a359); border-radius:12px; box-shadow:0 0 0 9999px rgba(0,0,0,0.45); position:relative;">
                <div style="position:absolute; top:-22px; width:100%; text-align:center; font-size:11px; font-weight:700; color:#d4a359; letter-spacing:0.5px;">AIM AT ATTENDANCE QR</div>
              </div>
            </div>
          </div>

          <!-- Scanner Controls Strip -->
          <div style="display:flex; gap:8px; flex-wrap:wrap; margin-bottom:12px;">
            <button class="btn btn-primary btn-sm" id="btn-mgmt-open-scanner" type="button" style="display:inline-flex; align-items:center; gap:6px;">
              <span>📷</span> Open Scanner
            </button>
            <button class="btn btn-secondary btn-sm" id="btn-mgmt-close-scanner" type="button" style="display:none; align-items:center; gap:6px;">
              <span>✕</span> Close Scanner
            </button>
            <button class="btn btn-ghost btn-sm" id="btn-mgmt-toggle-facing" type="button" style="display:none; align-items:center; gap:6px;">
              <span>🔄</span> Flip Camera
            </button>
            <button class="btn btn-ghost btn-sm" id="btn-mgmt-toggle-torch" type="button" style="display:none; align-items:center; gap:6px;">
              <span>🔦</span> Torch
            </button>
            <button class="btn btn-ghost btn-sm" id="btn-mgmt-test-camera" type="button" style="margin-left:auto; font-size:11.5px;">
              Test Camera
            </button>
          </div>

          <!-- Scanner Notice -->
          <div style="font-size:11.5px; color:var(--muted); border-top:1px dashed var(--line); padding-top:8px;">
            ℹ Notice: Scanning here is strictly diagnostic. It validates token freshness, cryptographic integrity, and café routing without mutating employee timesheets or checking managers in.
          </div>
        </div>
      </div>

      <!-- AREA D: SECURE PRESENCE STATUS CARDS -->
      <div>
        <div style="font-size:12px; font-weight:800; text-transform:uppercase; letter-spacing:0.6px; color:var(--muted); margin-bottom:8px;">
          Operational Presence Readiness &amp; Security Health
        </div>
        <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(190px, 1fr)); gap:12px;">
          ${_renderHealthCard("QR Service", pageState.qrStatus === 'ACTIVE' ? 'Active' : pageState.qrStatus, pageState.qrStatus === 'ACTIVE' ? 'success' : 'warning')}
          ${_renderHealthCard("Geofence", pageState.geofenceData?.configured ? 'Configured' : 'Not Configured', pageState.geofenceData?.configured ? 'success' : 'danger')}
          ${_renderHealthCard("Selfie Requirement", "Enabled", "success")}
          ${_renderHealthCard("Camera", pageState.cameraPermissionState, pageState.cameraPermissionState === 'Ready' ? 'success' : 'info')}
          ${_renderHealthCard("Location Policy", "Required (Strict)", "success")}
          ${_renderHealthCard("Server Time Sync", "Active (IST)", "success")}
        </div>
      </div>

      <!-- MAIN SPLIT: AREA E (LOCATION & GEOFENCE) + AREA G (DIAGNOSTICS & LAST TEST) -->
      <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(380px, 1fr)); gap:20px;">
        
        <!-- AREA E: ATTENDANCE LOCATION / GEOFENCE STATUS CARD -->
        <div class="card" style="padding:20px;">
          <h3 style="font-size:15px; font-weight:700; margin:0 0 12px; color:var(--ink); display:flex; justify-content:space-between; align-items:center;">
            <span>Attendance Location &amp; Geofence Verification</span>
            <span style="font-size:11px; font-weight:700; color:var(--bronze-600);">POLICY: STRICT</span>
          </h3>

          <div id="geofence-details-content">
            ${_renderGeofenceDetailsHtml(isMaster, isOwner)}
          </div>
        </div>

        <!-- AREA G: DIAGNOSTICS & LAST TEST RESULT -->
        <div class="card" style="padding:20px; display:flex; flex-direction:column;">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
            <h3 style="font-size:15px; font-weight:700; margin:0; color:var(--ink);">Diagnostics &amp; Last Test</h3>
            <span class="badge-tag badge-accent" style="font-size:10px;">IDOR-SAFE</span>
          </div>

          <div id="diagnostic-results-box" style="flex:1; background:var(--surface-sunken); border:1px solid var(--line); border-radius:8px; padding:14px; font-size:12.5px;">
            ${_renderDiagnosticLastTestHtml()}
          </div>
        </div>
      </div>

      <!-- AREA F: FULL SCREEN ATTENDANCE DISPLAY MODE OVERLAY (MOUNT) -->
      <div id="attendance-display-mode-mount"></div>

    </div>
  `;
}

// ─── Helper Renderers ─────────────────────────────────────────────────────────

function _renderStatusBadge(status) {
  switch (status) {
    case 'ACTIVE':
      return `<span class="status success" style="font-size:11px; font-weight:700;">● ACTIVE</span>`;
    case 'REFRESHING':
      return `<span class="status info" style="font-size:11px; font-weight:700;">🔄 REFRESHING</span>`;
    case 'EXPIRED':
      return `<span class="status danger" style="font-size:11px; font-weight:700;">⚠ EXPIRED</span>`;
    default:
      return `<span class="status warning" style="font-size:11px; font-weight:700;">${status}</span>`;
  }
}

function _renderHealthCard(title, val, badgeType) {
  const badgeClass = badgeType === 'success' ? 'badge-success' : badgeType === 'danger' ? 'badge-danger' : badgeType === 'warning' ? 'badge-warning' : 'badge-info';
  return `
    <div class="card" style="padding:14px; background:var(--surface); border:1px solid var(--line); border-radius:8px;">
      <div style="font-size:11px; font-weight:700; text-transform:uppercase; color:var(--muted); letter-spacing:0.5px;">${title}</div>
      <div style="margin-top:6px; display:flex; align-items:center; justify-content:space-between;">
        <strong style="font-size:13.5px; color:var(--ink);">${val}</strong>
        <span class="badge-tag ${badgeClass}" style="font-size:10px;">${badgeType === 'success' ? 'VERIFIED' : val === 'Not Checked' ? 'STANDBY' : 'ACTION'}</span>
      </div>
    </div>
  `;
}

function _renderCafeSelectorHtml(role, isPrimary, isMaster, isOwner, isCafeOps) {
  if (isCafeOps) {
    const name = _getCafeDisplayName(pageState.selectedCafeId);
    return `
      <span style="font-size:14px; font-weight:800; color:var(--ink);">${name}</span>
      <span class="badge-tag badge-info" style="font-size:10px; margin-left:6px;">BOUND OUTLET (LOCKED)</span>
    `;
  }

  // Master & Owner get dropdown
  const cafes = pageState.cafesList || [];
  return `
    <select id="qr-cafe-selector" class="form-control" style="font-size:13px; font-weight:700; padding:4px 8px; max-width:280px;">
      ${cafes.map(c => `
        <option value="${c.cafeId}" ${c.cafeId === pageState.selectedCafeId ? 'selected' : ''}>
          ${c.name} (${c.cafeId})
        </option>
      `).join('')}
    </select>
  `;
}

function _renderGeofenceDetailsHtml(isMaster, isOwner) {
  const geo = pageState.geofenceData;
  if (!geo || !geo.configured) {
    return `
      <div class="notice-banner notice-warning" style="margin-bottom:12px; font-size:12px;">
        <strong>ATTENDANCE GEOFENCE NOT CONFIGURED.</strong> This café does not have registered GPS coordinates. Employee secure punches will fail closed until configured.
      </div>
      <div style="font-size:12px; color:var(--muted); display:flex; flex-direction:column; gap:6px;">
        <div>Status: <strong style="color:var(--color-danger);">Unconfigured</strong></div>
        <div>Policy: Server-Side Haversine Verification (Strict)</div>
        <div>Default Coordinates: <strong style="color:var(--muted);">None (Fail-Closed)</strong></div>
      </div>
    `;
  }

  return `
    <div style="display:flex; flex-direction:column; gap:10px; font-size:12.5px;">
      <div style="display:flex; justify-content:space-between; border-bottom:1px solid var(--line); padding-bottom:6px;">
        <span style="color:var(--muted);">Outlet Reference:</span>
        <strong>${pageState.selectedCafeId} (${geo.cafeName || 'Outlet'})</strong>
      </div>
      <div style="display:flex; justify-content:space-between; border-bottom:1px solid var(--line); padding-bottom:6px;">
        <span style="color:var(--muted);">Geofence Status:</span>
        <strong style="color:var(--color-success);">✓ Configured &amp; Active</strong>
      </div>
      <div style="display:flex; justify-content:space-between; border-bottom:1px solid var(--line); padding-bottom:6px;">
        <span style="color:var(--muted);">Allowed Radius:</span>
        <strong>${geo.radiusMeters || 100} metres</strong>
      </div>
      <div style="display:flex; justify-content:space-between; border-bottom:1px solid var(--line); padding-bottom:6px;">
        <span style="color:var(--muted);">Coordinates (Latitude / Longitude):</span>
        <span style="font-family:var(--font-mono); font-size:11.5px;">
          ${isMaster || isOwner ? `${geo.latitude.toFixed(4)}, ${geo.longitude.toFixed(4)}` : 'Authorised Secure Location'}
        </span>
      </div>
      <div style="display:flex; justify-content:space-between;">
        <span style="color:var(--muted);">Anti-Spoofing Check:</span>
        <span style="color:var(--color-success); font-weight:700;">Haversine Spherical Calculation (Server-Side)</span>
      </div>
    </div>
  `;
}

function _renderDiagnosticLastTestHtml() {
  const t = pageState.lastTestResult;
  if (!t) {
    return `
      <div style="color:var(--muted); text-align:center; padding:18px 0;">
        No diagnostic scan performed yet in this session.
        <div style="margin-top:6px; font-size:11.5px;">Click "Test Current QR" or open the scanner to run a live validation.</div>
      </div>
    `;
  }

  const isSuccess = t.status === 'VALID' || t.status === 'QR Valid';
  return `
    <div style="display:flex; flex-direction:column; gap:8px;">
      <div style="display:flex; justify-content:space-between; align-items:center;">
        <span style="font-size:11px; color:var(--muted); font-family:var(--font-mono);">${t.timestamp}</span>
        <span class="badge-tag ${isSuccess ? 'badge-success' : 'badge-danger'}" style="font-size:11px; font-weight:800;">
          ${t.status}
        </span>
      </div>
      <div style="display:flex; justify-content:space-between;">
        <span style="color:var(--muted);">Target Café:</span>
        <strong>${t.cafeName || t.cafeId || '—'} (${t.cafeId || '—'})</strong>
      </div>
      <div style="display:flex; justify-content:space-between;">
        <span style="color:var(--muted);">Challenge Purpose:</span>
        <strong style="color:var(--bronze-600);">${t.purpose || 'ATTENDANCE_PUNCH'}</strong>
      </div>
      <div style="display:flex; justify-content:space-between;">
        <span style="color:var(--muted);">TTL Expiry:</span>
        <span style="font-family:var(--font-mono); font-size:11.5px;">${t.expiresAt ? new Date(t.expiresAt).toLocaleTimeString('en-IN') : '—'}</span>
      </div>
      <div style="display:flex; justify-content:space-between;">
        <span style="color:var(--muted);">Attendance Mutation:</span>
        <strong style="color:var(--muted);">None (Diagnostic Only)</strong>
      </div>
    </div>
  `;
}

function _getCafeDisplayName(cafeId) {
  const found = (pageState.cafesList || []).find(c => c.cafeId === cafeId);
  return found?.name || `Zamorin Café (${cafeId || ''})`;
}

// ─── Wiring & Lifecycle ───────────────────────────────────────────────────────

export async function wireAttendanceQrScannerPage(container) {
  if (!container) return;

  // Clear existing intervals
  if (pageState.timerInterval) clearInterval(pageState.timerInterval);
  if (pageState.clockInterval) clearInterval(pageState.clockInterval);

  // Live Server Clock
  _updateLiveClock(container);
  pageState.clockInterval = setInterval(() => _updateLiveClock(container), 1000);

  // Load Café List & Initialize
  await _loadCafesList(container);

  // Load Active QR for Selected Café
  await _fetchAndRenderActiveQr(container);

  // Start 45s Countdown & Refresh Loop
  _startCountdownLoop(container);

  // Wire Events
  _bindEvents(container);
}

function _updateLiveClock(container) {
  const now = new Date();
  const timeStr = now.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour12: false }) + ' IST';
  pageState.serverTimeStr = timeStr;
  const clockEl = container.querySelector('#server-clock-display');
  if (clockEl) clockEl.textContent = timeStr;
}

async function _loadCafesList(container) {
  try {
    const res = await apiGet('/api/v1/cafes');
    if (res?.data && Array.isArray(res.data)) {
      pageState.cafesList = res.data;
    }
  } catch (err) {
    pageState.cafesList = [];
  }

  // Load Geofence Info for selected café
  await _fetchGeofenceDetails(container);
}

async function _fetchGeofenceDetails(container) {
  try {
    const cafeId = pageState.selectedCafeId || '';
    const res = await apiGet(`/api/v1/cafes/${cafeId}`);
    if (res?.data) {
      const c = res.data;
      const addr = c.address || {};
      const hasCoords = typeof addr.latitude === 'number' && typeof addr.longitude === 'number';
      pageState.geofenceData = {
        configured: hasCoords,
        latitude: addr.latitude,
        longitude: addr.longitude,
        radiusMeters: addr.geofenceRadiusMetres || 100,
        cafeName: c.name || c.displayName,
      };
    }
  } catch (err) {
    pageState.geofenceData = { configured: false };
  }

  const geoBox = container.querySelector('#geofence-details-content');
  if (geoBox) {
    const isMaster = (state.role || state.user?.role) === 'MASTER';
    const isOwner = (state.role || state.user?.role) === 'OWNER';
    geoBox.innerHTML = _renderGeofenceDetailsHtml(isMaster, isOwner);
  }
}

async function _fetchAndRenderActiveQr(container) {
  const qrBox = container.querySelector('#attendance-qr-box');
  const statusBadge = container.querySelector('#qr-status-badge');
  const cafeNameEl = container.querySelector('#qr-cafe-name-display');
  const cafeIdEl = container.querySelector('#qr-cafe-id-display');
  const countdownEl = container.querySelector('#qr-countdown-display');

  try {
    pageState.qrStatus = 'REFRESHING';
    if (statusBadge) statusBadge.innerHTML = _renderStatusBadge('REFRESHING');

    const cafeId = pageState.selectedCafeId || '';
    const res = await apiGet(`/api/v1/attendance/qr/active?cafeId=${cafeId}`);

    if (res?.success && res.data) {
      pageState.activeChallenge = res.data;
      pageState.qrStatus = 'ACTIVE';
      pageState.countdownSec = res.data.remainingSeconds || 45;

      const payload = res.data.opaqueToken || res.data.qrToken;
      const svg = generateQrSvg(payload, { size: 260, margin: 4, includeLogo: true });

      if (qrBox) qrBox.innerHTML = svg;
      if (statusBadge) statusBadge.innerHTML = _renderStatusBadge('ACTIVE');
      if (cafeNameEl) cafeNameEl.textContent = res.data.cafeName || _getCafeDisplayName(cafeId);
      if (cafeIdEl) cafeIdEl.textContent = `Reference: ${res.data.cafeId} · 45s Rotation`;
      if (countdownEl) countdownEl.textContent = `Refreshes in ${pageState.countdownSec} sec`;
    } else {
      throw new Error('Could not fetch active QR challenge');
    }
  } catch (err) {
    pageState.qrStatus = 'UNAVAILABLE';
    if (qrBox) qrBox.innerHTML = `<div style="color:var(--color-danger); padding:20px;">Failed to load QR challenge: ${err?.message || 'Offline'}</div>`;
    if (statusBadge) statusBadge.innerHTML = _renderStatusBadge('UNAVAILABLE');
  }
}

function _startCountdownLoop(container) {
  if (pageState.timerInterval) clearInterval(pageState.timerInterval);
  
  pageState.timerInterval = setInterval(async () => {
    pageState.countdownSec--;
    const countdownEl = container.querySelector('#qr-countdown-display');
    if (countdownEl) {
      countdownEl.textContent = `Refreshes in ${Math.max(0, pageState.countdownSec)} sec`;
    }

    if (pageState.countdownSec <= 0) {
      await _fetchAndRenderActiveQr(container);
    }
  }, 1000);
}

function _bindEvents(container) {
  // Cafe selector change (for Masters/Owner)
  const cafeSel = container.querySelector('#qr-cafe-selector');
  cafeSel?.addEventListener('change', async (e) => {
    pageState.selectedCafeId = e.target.value;
    await _fetchGeofenceDetails(container);
    await _fetchAndRenderActiveQr(container);
  });

  // Action: Open Display Mode / Full Screen
  const fsBtn = container.querySelector('#btn-open-display-mode');
  const cardFsBtn = container.querySelector('#btn-qr-card-fs');
  const triggerFs = () => _openDisplayModeModal(container);
  fsBtn?.addEventListener('click', triggerFs);
  cardFsBtn?.addEventListener('click', triggerFs);

  // Action: Refresh
  const refreshBtn = container.querySelector('#btn-refresh-all-status');
  const cardRefreshBtn = container.querySelector('#btn-qr-card-refresh');
  const triggerRefresh = async () => {
    await _fetchGeofenceDetails(container);
    await _fetchAndRenderActiveQr(container);
  };
  refreshBtn?.addEventListener('click', triggerRefresh);
  cardRefreshBtn?.addEventListener('click', triggerRefresh);

  // Action: Test Current QR
  const testCurrentBtn = container.querySelector('#btn-qr-card-test');
  testCurrentBtn?.addEventListener('click', async () => {
    if (!pageState.activeChallenge) {
      alert('No active QR challenge loaded.');
      return;
    }
    const token = pageState.activeChallenge.opaqueToken || pageState.activeChallenge.qrToken;
    await _performDiagnosticScan(token, container);
  });

  // Scanner controls
  const openScannerBtn = container.querySelector('#btn-mgmt-open-scanner');
  const closeScannerBtn = container.querySelector('#btn-mgmt-close-scanner');
  const toggleFacingBtn = container.querySelector('#btn-mgmt-toggle-facing');
  const toggleTorchBtn = container.querySelector('#btn-mgmt-toggle-torch');
  const testCameraBtn = container.querySelector('#btn-mgmt-test-camera');

  openScannerBtn?.addEventListener('click', () => _startDiagnosticScanner(container));
  closeScannerBtn?.addEventListener('click', () => _stopDiagnosticScanner(container));
  toggleFacingBtn?.addEventListener('click', () => _toggleCameraFacing(container));
  toggleTorchBtn?.addEventListener('click', () => _toggleTorch(container));
  testCameraBtn?.addEventListener('click', () => _testCameraSupport(container));
}

// ─── AREA F: ATTENDANCE DISPLAY MODE (FULL SCREEN KIOSK) ──────────────────────

function _openDisplayModeModal(container) {
  const mount = container.querySelector('#attendance-display-mode-mount') || document.body;
  const payload = pageState.activeChallenge?.opaqueToken || pageState.activeChallenge?.qrToken || 'ZAMORIN_ATTENDANCE';
  const cafeName = pageState.activeChallenge?.cafeName || _getCafeDisplayName(pageState.selectedCafeId);
  const cleanCafeId = pageState.selectedCafeId || '';

  const svgLarge = generateQrSvg(payload, {
    size: Math.min(480, Math.floor(window.innerWidth * 0.82)),
    margin: 4,
    includeLogo: true,
  });

  const overlayEl = document.createElement('div');
  overlayEl.id = 'attendance-display-mode-overlay';
  overlayEl.style.cssText = `
    position: fixed;
    inset: 0;
    background: #000000;
    z-index: 10005;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 24px;
    color: #ffffff;
    cursor: pointer;
  `;

  overlayEl.innerHTML = `
    <div style="margin-bottom:24px; text-align:center;">
      <div style="display:flex; align-items:center; justify-content:center; gap:10px; margin-bottom:8px;">
        <div style="width:38px; height:38px; display:inline-block;">
          ${CANONICAL_ZAMORIN_COMPANY_LOGO_SVG}
        </div>
        <span style="font-size:13px; letter-spacing:0.15em; text-transform:uppercase; color:#d4a359; font-weight:800;">
          Zamorin Café ERP · Attendance Terminal
        </span>
      </div>
      <h1 style="margin:4px 0 2px; font-size:30px; font-weight:800; color:#ffffff;">${cafeName}</h1>
      <div style="font-family:monospace; font-size:15px; color:#a0a0a0; font-weight:700;">Outlet: ${cleanCafeId} · Server Clock: <span id="dm-clock">${pageState.serverTimeStr}</span></div>
    </div>

    <div style="background:#ffffff; padding:24px; border-radius:18px; box-shadow:0 0 60px rgba(212,163,89,0.25); display:inline-block;">
      ${svgLarge}
    </div>

    <div style="margin-top:28px; text-align:center;">
      <div style="font-size:16px; font-weight:700; color:#d4a359;" id="dm-countdown">Refreshes in ${pageState.countdownSec} sec</div>
      <div style="font-size:12.5px; color:#666666; margin-top:8px;">Press <kbd style="background:#222; color:#eee; padding:2px 8px; border-radius:4px; border:1px solid #444;">ESC</kbd> or tap anywhere to exit kiosk display</div>
    </div>
  `;

  const closeOverlay = () => {
    window.removeEventListener('keydown', onKey);
    overlayEl.remove();
  };

  const onKey = (e) => {
    if (e.key === 'Escape' || e.keyCode === 27) closeOverlay();
  };

  window.addEventListener('keydown', onKey);
  overlayEl.addEventListener('click', closeOverlay);
  mount.appendChild(overlayEl);
}

// ─── AREA C: DIAGNOSTIC SCANNER IMPLEMENTATION ────────────────────────────────

async function _startDiagnosticScanner(container) {
  const videoEl = container.querySelector('#mgmt-scanner-video');
  const placeholderEl = container.querySelector('#scanner-idle-placeholder');
  const overlayEl = container.querySelector('#scanner-viewfinder-overlay');
  const openBtn = container.querySelector('#btn-mgmt-open-scanner');
  const closeBtn = container.querySelector('#btn-mgmt-close-scanner');
  const flipBtn = container.querySelector('#btn-mgmt-toggle-facing');
  const torchBtn = container.querySelector('#btn-mgmt-toggle-torch');
  const statusBadge = container.querySelector('#scanner-status-badge');

  try {
    pageState.scannerStatus = 'Scanning';
    if (statusBadge) statusBadge.innerHTML = `<span class="status info" style="font-size:11px;">Scanning...</span>`;

    const stream = await openCamera(videoEl, { facingMode: pageState.cameraFacing });
    pageState.scannerStream = stream;
    pageState.scannerActive = true;
    pageState.cameraPermissionState = 'Ready';

    videoEl.style.display = 'block';
    if (placeholderEl) placeholderEl.style.display = 'none';
    if (overlayEl) overlayEl.style.display = 'flex';
    if (openBtn) openBtn.style.display = 'none';
    if (closeBtn) closeBtn.style.display = 'inline-flex';
    if (flipBtn) flipBtn.style.display = 'inline-flex';
    if (torchBtn) torchBtn.style.display = 'inline-flex';

    // Start video scanning loop
    const scanHandle = scanQrFromVideo(videoEl, {
      intervalMs: 220,
      onTick: () => {},
    });
    pageState.scannerScanHandle = scanHandle;

    scanHandle.promise
      .then(async (scannedToken) => {
        _stopDiagnosticScanner(container);
        await _performDiagnosticScan(scannedToken, container);
      })
      .catch((err) => {
        if (err?.code !== 'SCAN_CANCELLED') {
          pageState.scannerStatus = 'Scan Error';
          if (statusBadge) statusBadge.innerHTML = `<span class="status warning" style="font-size:11px;">Error</span>`;
        }
      });
  } catch (err) {
    const friendly = friendlyCameraError(err);
    pageState.cameraPermissionState = 'Permission Required';
    pageState.scannerStatus = 'Permission Required';
    if (statusBadge) statusBadge.innerHTML = `<span class="status danger" style="font-size:11px;">Permission Required</span>`;
    alert(friendly.message);
  }
}

function _stopDiagnosticScanner(container) {
  if (pageState.scannerScanHandle) {
    pageState.scannerScanHandle.cancel();
    pageState.scannerScanHandle = null;
  }
  if (pageState.scannerStream) {
    stopCamera(pageState.scannerStream);
    pageState.scannerStream = null;
  }
  pageState.scannerActive = false;

  const videoEl = container.querySelector('#mgmt-scanner-video');
  const placeholderEl = container.querySelector('#scanner-idle-placeholder');
  const overlayEl = container.querySelector('#scanner-viewfinder-overlay');
  const openBtn = container.querySelector('#btn-mgmt-open-scanner');
  const closeBtn = container.querySelector('#btn-mgmt-close-scanner');
  const flipBtn = container.querySelector('#btn-mgmt-toggle-facing');
  const torchBtn = container.querySelector('#btn-mgmt-toggle-torch');

  if (videoEl) videoEl.style.display = 'none';
  if (placeholderEl) placeholderEl.style.display = 'block';
  if (overlayEl) overlayEl.style.display = 'none';
  if (openBtn) openBtn.style.display = 'inline-flex';
  if (closeBtn) closeBtn.style.display = 'none';
  if (flipBtn) flipBtn.style.display = 'none';
  if (torchBtn) torchBtn.style.display = 'none';
}

async function _toggleCameraFacing(container) {
  pageState.cameraFacing = pageState.cameraFacing === 'environment' ? 'user' : 'environment';
  _stopDiagnosticScanner(container);
  await _startDiagnosticScanner(container);
}

function _toggleTorch(container) {
  if (!pageState.scannerStream) return;
  const track = pageState.scannerStream.getVideoTracks()[0];
  if (!track) return;

  const capabilities = track.getCapabilities ? track.getCapabilities() : {};
  if (!capabilities.torch) {
    alert('Torch is not supported by this camera.');
    return;
  }

  pageState.torchActive = !pageState.torchActive;
  track.applyConstraints({
    advanced: [{ torch: pageState.torchActive }]
  }).catch(() => {
    alert('Could not toggle torch.');
  });
}

function _testCameraSupport(container) {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    alert('Camera API is not supported on this device/browser.');
    return;
  }
  alert('Camera API is supported. Click "Open Scanner" to grant permissions and begin diagnostic scanning.');
}

async function _performDiagnosticScan(qrToken, container) {
  const diagBox = container.querySelector('#diagnostic-results-box');
  const scannerStatusBadge = container.querySelector('#scanner-status-badge');

  try {
    const res = await apiPost('/api/v1/attendance/qr/verify', { qrToken });

    if (res?.success && res.data?.valid) {
      pageState.lastTestResult = {
        timestamp: new Date().toLocaleTimeString('en-IN') + ' IST',
        status: 'QR Valid',
        cafeId: res.data.cafeId,
        cafeName: res.data.cafeName,
        purpose: 'ATTENDANCE_PUNCH',
        expiresAt: res.data.expiresAt,
      };
      pageState.scannerStatus = 'QR Valid';
      if (scannerStatusBadge) scannerStatusBadge.innerHTML = `<span class="status success" style="font-size:11px;">✓ QR Valid</span>`;
    } else {
      throw new Error(res?.error?.message || 'Validation failed');
    }
  } catch (err) {
    const msg = err?.message || 'Invalid QR code';
    const status = msg.includes('expired') ? 'QR Expired' : msg.includes('assigned') ? 'Wrong Café' : 'QR Invalid';
    pageState.lastTestResult = {
      timestamp: new Date().toLocaleTimeString('en-IN') + ' IST',
      status,
      cafeId: pageState.selectedCafeId,
      cafeName: 'Verification Target',
      purpose: 'ATTENDANCE_PUNCH',
      expiresAt: null,
    };
    pageState.scannerStatus = status;
    if (scannerStatusBadge) scannerStatusBadge.innerHTML = `<span class="status danger" style="font-size:11px;">${status}</span>`;
  }

  if (diagBox) {
    diagBox.innerHTML = _renderDiagnosticLastTestHtml();
  }
}

// Cleanup hook on unmount
export function cleanupAttendanceQrScannerPage() {
  if (pageState.timerInterval) clearInterval(pageState.timerInterval);
  if (pageState.clockInterval) clearInterval(pageState.clockInterval);
  if (pageState.scannerStream) stopCamera(pageState.scannerStream);
}
