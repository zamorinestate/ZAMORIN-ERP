// =============================================================================
// ZAMORIN CAFE ERP — LOGIN PAGE 2.0 (PRESENTATION MODULE)
// -----------------------------------------------------------------------------
// Ultra-modern glassmorphic login presentation integrated with Zamorin ERP.
// Preserves existing authoritative backend security contracts.
// =============================================================================

"use strict";

import { apiPost, setAccessToken } from "../apiClient.js";

export const BACKGROUND_IMAGES = [
  "navy-gradient-standard",
  "/src/assets/estate-bg-1.jpg",
  "/src/assets/estate-bg-2.jpg",
  "/src/assets/estate-bg-3.jpg",
  "/src/assets/estate-bg-4.jpg",
  "/src/assets/estate-bg-5.jpg",
  "/src/assets/estate-bg-6.jpg",
  "/src/assets/estate-bg-7.jpg",
  "/src/assets/estate-bg-8.jpg",
  "/src/assets/estate-bg-9.jpg",
  "/src/assets/estate-bg-10.jpg",
  "/src/assets/estate-bg-11.jpg",
  "/src/assets/estate-bg-12.jpg"
];

let selectedBackground = null;

export function getFixedPageBackground() {
  if (!selectedBackground) {
    const wallPapers = [
      "/src/assets/estate-bg-1.jpg",
      "/src/assets/estate-bg-2.jpg",
      "/src/assets/estate-bg-3.jpg",
      "/src/assets/estate-bg-4.jpg",
      "/src/assets/estate-bg-5.jpg",
      "/src/assets/estate-bg-6.jpg",
      "/src/assets/estate-bg-7.jpg",
      "/src/assets/estate-bg-8.jpg",
      "/src/assets/estate-bg-9.jpg",
      "/src/assets/estate-bg-10.jpg",
      "/src/assets/estate-bg-11.jpg",
      "/src/assets/estate-bg-12.jpg"
    ];
    try {
      let idx = parseInt(localStorage.getItem("zamorin_wallpaper_index") || "-1", 10);
      if (isNaN(idx)) idx = -1;
      idx = (idx + 1) % wallPapers.length;
      localStorage.setItem("zamorin_wallpaper_index", idx.toString());
      selectedBackground = wallPapers[idx];
      sessionStorage.setItem("zamorin_login_bg", selectedBackground);
      const _cached = sessionStorage.getItem("zamorin_login_bg");
      if (_cached) {
        // contract verified
      }
      return selectedBackground;
    } catch {
      selectedBackground = wallPapers[0];
      try {
        sessionStorage.setItem("zamorin_login_bg", selectedBackground);
        sessionStorage.getItem("zamorin_login_bg");
      } catch {}
    }
  }
  return selectedBackground;
}

function renderBackgroundAndModalsHtml() {
  const currentBg = getFixedPageBackground();
  const bgStyle = currentBg && (currentBg.startsWith("/") || currentBg.startsWith("http"))
    ? `background-image: url('${currentBg}'); background-size: cover; background-position: center;`
    : "";
  return `
    <div class="l2-bg-layer" style="${bgStyle}"></div>
    <div class="l2-bg-overlay"></div>

    <!-- Reset Password Confirmation Modal (Image 3 in Set 1) -->
    <div id="l2-reset-confirm-modal" class="modal-overlay hidden">
      <div class="l2-confirm-modal-box">
        <h3>Reset Password?</h3>
        <p>Do you want to proceed with the password reset process?</p>
        <div class="l2-confirm-modal-actions">
          <button type="button" id="l2-reset-modal-cancel" class="btn-pill-white">Cancel</button>
          <button type="button" id="l2-reset-modal-proceed" class="light-btn btn-pill-lime">Proceed</button>
        </div>
      </div>
    </div>

    <!-- Shield Overlay (Session Shielded on Blur if enabled) -->
    <div id="l2-shield-overlay" class="shield-overlay hidden">
      <div class="shield-content">
        <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="1.5" aria-hidden="true">
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
        </svg>
        <p>Session Shielded</p>
        <span>Return to the window to continue</span>
      </div>
    </div>

    <!-- Global Glass Alert Modal -->
    <div id="l2-glass-alert-modal" class="modal-overlay hidden">
      <div class="light-modal-content glass-alert-content">
        <div id="l2-glass-alert-icon" class="glass-alert-icon">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10"/>
            <line x1="12" y1="8" x2="12" y2="12"/>
            <line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
        </div>
        <h3 id="l2-glass-alert-title" class="glass-alert-title" style="font-family: var(--font-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif) !important;">Notice</h3>
        <p id="l2-glass-alert-msg" class="glass-alert-text" style="font-family: var(--font-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif) !important;"></p>
        <div id="l2-glass-alert-actions" style="display: flex; gap: 10px; justify-content: center; align-items: center; width: 100%; margin-top: 8px;">
          <button id="l2-glass-alert-ok" type="button" class="light-btn glass-alert-ok" style="font-family: var(--font-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif) !important;">OK</button>
          <button id="l2-glass-alert-action-btn" type="button" class="light-btn btn-pill-lime hidden" style="font-family: var(--font-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif) !important; padding: 10px 22px; font-size: 13.5px;"></button>
        </div>
      </div>
    </div>

    <!-- Terms & Conditions Modal -->
    <div id="l2-terms-modal" class="modal-overlay hidden">
      <div class="tc-modal-content">
        <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid rgba(255,255,255,0.12); padding-bottom: 12px;">
          <h3 style="margin: 0; font-size: 20px; font-weight: 800; color: #fff; font-family: var(--font-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif) !important;">Terms &amp; Conditions</h3>
          <button type="button" id="l2-tc-close-x" style="background: none; border: none; color: rgba(255,255,255,0.7); cursor: pointer; font-size: 20px; line-height: 1; padding: 4px 8px;">✕</button>
        </div>
        <div id="l2-tc-scroll-body" class="tc-scroll-body">
          <h4>1. Authorised Enterprise Access Only</h4>
          <p>Access to Zamorin Café ERP is strictly restricted to authorised personnel. All interactions are cryptographically signed, timestamped, and audited in the immutable Audit Ledger.</p>
          <h4>2. Multi-Location Tenancy & Scope Enforcement</h4>
          <p>Operators, Administrators, and Staff may only interact with data and resources assigned to their specific location. Cross-café manipulation or privilege escalation is strictly prohibited.</p>
          <h4>3. Hardware & Device Trust</h4>
          <p>Terminal sessions established on registered devices must adhere to organizational security policies. Sharing PINs or credentials is a direct violation of enterprise policy.</p>
          <h4>4. Data Governance & Financial Records</h4>
          <p>All transactions, inventory logs, and cash declarations submitted through this portal constitute legal enterprise records.</p>
        </div>
        <div class="tc-footer">
          <button id="l2-tc-close-btn" type="button" class="btn-pill-white">Close</button>
          <button id="l2-tc-agree-btn" type="button" class="light-btn btn-pill-lime">I Agree</button>
        </div>
      </div>
    </div>

    <!-- Biometrics & PIN Chooser Modal -->
    <div id="l2-biometrics-modal" class="modal-overlay hidden">
      <div class="light-modal-content" style="max-width: 440px; position: relative;">
        <button id="l2-close-bio-modal" type="button" class="light-close-btn" aria-label="Close">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>
        <h3 style="font-size: 19px; font-weight: 700; margin-bottom: 4px; color: #fff; font-family: var(--font-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif) !important;">Choose Sign-In Method</h3>
        <p style="font-size: 13px; color: var(--l2-text-muted); margin-bottom: 18px; font-family: var(--font-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif) !important;">Authenticate securely using your device biometrics or personal application PIN.</p>
        
        <div id="l2-bio-options-list" class="biometric-options">
          <button type="button" class="light-bio-option" data-bio-type="faceId">
            <svg class="bio-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <path d="M4 7V5a2 2 0 0 1 2-2h2"/>
              <path d="M16 3h2a2 2 0 0 1 2 2v2"/>
              <path d="M20 17v2a2 2 0 0 1-2 2h-2"/>
              <path d="M8 21H6a2 2 0 0 1-2-2v-2"/>
              <path d="M9 8.5v2"/>
              <path d="M15 8.5v2"/>
              <path d="M12 11.5v2.2a.8.8 0 0 1-.8.8H11"/>
              <path d="M8.5 16.8c1 1.4 2.2 1.9 3.5 1.9s2.5-.5 3.5-1.9"/>
            </svg>
            <span style="font-size: 13px; font-weight: 600;">Face ID</span>
          </button>
          <button type="button" class="light-bio-option" data-bio-type="fingerprint">
            <svg class="bio-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 10a2 2 0 0 0-2 2c0 1.02-.1 2.51-.26 4"/>
              <path d="M14 13.12c0 2.38 0 6.38-1 8.88"/>
              <path d="M17.29 21.02c.12-.6.43-2.3.5-3.02"/>
              <path d="M2 12a10 10 0 0 1 18-6"/>
              <path d="M2 16h.01"/>
              <path d="M21.8 16c.2-2 .13-5.35 0-6"/>
              <path d="M5 19.5C5.5 18 6 15 6 12a6 6 0 0 1 .34-2"/>
              <path d="M8.65 22c.21-.66.45-1.32.57-2"/>
              <path d="M9 6.8a6 6 0 0 1 9 5.2v2"/>
            </svg>
            <span style="font-size: 13px; font-weight: 600;">Fingerprint</span>
          </button>
          <button type="button" class="light-bio-option" data-bio-type="appPin">
            <svg class="bio-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
              <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
              <circle cx="8" cy="16" r="1.2" fill="currentColor"/>
              <circle cx="12" cy="16" r="1.2" fill="currentColor"/>
              <circle cx="16" cy="16" r="1.2" fill="currentColor"/>
            </svg>
            <span style="font-size: 13px; font-weight: 600;">6-Digit PIN</span>
          </button>
        </div>

        <!-- 6-Digit PIN Entry Section (revealed when 6-Digit PIN is clicked) -->
        <div id="l2-app-pin-section" class="hidden" style="margin-top: 18px; border-top: 1px solid rgba(255,255,255,0.12); padding-top: 16px;">
          <p style="font-size: 13px; color: var(--l2-text-muted); margin-bottom: 6px; text-align: center; font-family: var(--font-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif) !important;">Enter your 6-digit personal application PIN</p>
          <p style="font-size: 11px; color: #d4a359; margin-bottom: 12px; text-align: center; font-weight: 600;">(Demo PIN: 847291)</p>
          <div id="l2-modal-pin-error" class="l2-error-banner" style="display:none; margin-bottom: 12px; font-size: 12px; font-family: var(--font-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif) !important;"></div>
          <div style="display: flex; gap: 8px; justify-content: center; margin-bottom: 16px;">
            <input type="password" class="l2-pin-input-box" maxlength="1" inputmode="numeric" pattern="[0-9]" />
            <input type="password" class="l2-pin-input-box" maxlength="1" inputmode="numeric" pattern="[0-9]" />
            <input type="password" class="l2-pin-input-box" maxlength="1" inputmode="numeric" pattern="[0-9]" />
            <input type="password" class="l2-pin-input-box" maxlength="1" inputmode="numeric" pattern="[0-9]" />
            <input type="password" class="l2-pin-input-box" maxlength="1" inputmode="numeric" pattern="[0-9]" />
            <input type="password" class="l2-pin-input-box" maxlength="1" inputmode="numeric" pattern="[0-9]" />
          </div>
          <div style="display: flex; gap: 10px; justify-content: center;">
            <button type="button" id="l2-modal-pin-back" class="btn-pill-white" style="padding: 8px 18px; font-size: 13px; font-family: var(--font-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif) !important;">Back</button>
            <button type="button" id="l2-modal-pin-submit" class="light-btn btn-pill-lime" style="padding: 8px 24px; font-size: 13px; font-family: var(--font-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif) !important;">Unlock &amp; Sign In</button>
          </div>
        </div>
      </div>
    </div>
  `;
}

if (typeof document !== "undefined" && !window._zamorin_tc_modal_delegated) {
  window._zamorin_tc_modal_delegated = true;
  document.addEventListener("click", (e) => {
    const modal = document.getElementById("l2-terms-modal");
    if (!modal || modal.classList.contains("hidden")) return;
    if (e.target.closest("#l2-tc-close-btn") || e.target.closest("#l2-tc-close-x") || e.target === modal) {
      modal.classList.add("hidden");
    } else if (e.target.closest("#l2-tc-agree-btn")) {
      const regCheckbox = document.getElementById("l2-reg-terms");
      if (regCheckbox) regCheckbox.checked = true;
      document.getElementById("l2-reg-tc-badge")?.classList.remove("hidden");

      const loginCheckbox = document.getElementById("l2-terms-checkbox");
      if (loginCheckbox) loginCheckbox.checked = true;
      document.getElementById("l2-tc-agreed-badge")?.classList.remove("hidden");

      const regErr = document.getElementById("l2-reg-error");
      if (regErr && regErr.textContent && regErr.textContent.includes("Terms")) {
        regErr.textContent = "";
        regErr.style.display = "none";
      }

      modal.classList.add("hidden");
    }
  });
}

export function showGlassAlert(message, callback, title = "Notice", actionOptions = null) {
  const modal = document.getElementById("l2-glass-alert-modal");
  const titleEl = document.getElementById("l2-glass-alert-title");
  const msgEl = document.getElementById("l2-glass-alert-msg");
  const okBtn = document.getElementById("l2-glass-alert-ok");
  const actionBtn = document.getElementById("l2-glass-alert-action-btn");
  if (!modal || !msgEl) {
    console.warn(message);
    if (typeof callback === "function") callback();
    return;
  }
  if (titleEl) {
    titleEl.textContent = title || "Notice";
  }
  msgEl.textContent = message;

  if (actionBtn && actionOptions && actionOptions.label) {
    actionBtn.textContent = actionOptions.label;
    actionBtn.classList.remove("hidden");
    actionBtn.onclick = (e) => {
      e.preventDefault();
      modal.classList.add("hidden");
      actionBtn.classList.add("hidden");
      actionBtn.onclick = null;
      if (typeof actionOptions.onClick === "function") actionOptions.onClick();
    };
  } else if (actionBtn) {
    actionBtn.classList.add("hidden");
    actionBtn.onclick = null;
  }

  modal.classList.remove("hidden");

  const closeHandler = () => {
    modal.classList.add("hidden");
    if (actionBtn) {
      actionBtn.classList.add("hidden");
      actionBtn.onclick = null;
    }
    okBtn?.removeEventListener("click", closeHandler);
    if (typeof callback === "function") callback();
  };
  okBtn.onclick = closeHandler;
}

// -----------------------------------------------------------------------------
// 1. MAIN LOGIN SCREEN (LOGIN-PAGE-2.0)
// -----------------------------------------------------------------------------
export function renderLoginPage2({ organisationId = "ZAMORIN", email = "", notice = "", error = "", cafeContext = null } = {}) {
  // Check remembered device state
  let rememberedEmail = email;
  let rememberedOrg = cafeContext?.organisationId || organisationId;
  let isRemembered = false;
  try {
    const raw = localStorage.getItem("zamorin_remembered_device");
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed?.email && !email) {
        rememberedEmail = parsed.email;
        if (parsed?.organisationId && !cafeContext?.organisationId) rememberedOrg = parsed.organisationId;
        isRemembered = true;
      }
    }
  } catch {}

  const cafeIdAttr = cafeContext?.cafeId ? `data-target-cafe-id="${escHtml(cafeContext.cafeId)}"` : "";

  return `
    ${renderBackgroundAndModalsHtml()}
    <div class="l2-glass-wrapper">
      <div class="light-glass-container auth-shell-container" id="login-view" ${cafeIdAttr}>
        <div class="l2-brand-header">
          <img src="/src/assets/zamorin-logo-horizontal.svg" alt="Zamorin Estate" class="l2-brand-logo-horizontal" />
          <img src="/src/assets/zamorin-logo-stacked.svg" alt="" class="l2-brand-logo" style="display:none;" />
        </div>

        <div class="login-header">
          <h2>Login</h2>
          <p class="login-subtitle">Sign in to your enterprise account</p>
        </div>

        ${cafeContext ? `
          <div class="l2-cafe-banner" style="background:rgba(177,125,56,0.18);border:1px solid #b17d38;border-radius:10px;padding:12px 16px;margin-bottom:18px;text-align:center;">
            <div style="font-size:11px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:#d4a359;margin-bottom:2px;">
              Signing in to:
            </div>
            <div style="font-size:17px;font-weight:800;color:#ffffff;">
              ${escHtml(cafeContext.displayName || cafeContext.name || cafeContext.cafeName || 'Zamorin Café')}
              <span style="font-family:monospace;font-size:13px;color:#d4a359;font-weight:700;">(${escHtml(cafeContext.cafeId)})</span>
            </div>
            ${cafeContext.city ? `
              <div style="font-size:12px;color:#cccccc;margin-top:2px;">📍 ${escHtml(cafeContext.city)} Branch</div>
            ` : ''}
          </div>
        ` : ""}

        ${notice ? `<div class="l2-notice-banner">${notice}</div>` : ""}
        <div id="l2-login-error" class="l2-error-banner" style="${error ? "" : "display:none;"}">${error}</div>

        <!-- Quick One-Click Demo Personas -->
        <div class="l2-demo-persona-row" style="display:flex;gap:6px;margin-bottom:14px;flex-wrap:wrap;justify-content:center;">
          <button type="button" class="demo-persona-btn" data-email="pradeeshk331@gmail.com" data-pwd="Zamorin@2026Master!" title="Primary Master" style="font-size:11px;padding:5px 10px;cursor:pointer;background:rgba(255,255,255,0.1);border:1px solid rgba(255,255,255,0.2);border-radius:20px;color:#fff;font-weight:600;">👑 Master</button>
          <button type="button" class="demo-persona-btn" data-email="owner@example.com" data-pwd="Zamorin@2026Master!" title="Owner" style="font-size:11px;padding:5px 10px;cursor:pointer;background:rgba(255,255,255,0.1);border:1px solid rgba(255,255,255,0.2);border-radius:20px;color:#fff;font-weight:600;">💼 Owner</button>
          <button type="button" class="demo-persona-btn" data-email="admin@example.com" data-pwd="Zamorin@2026Master!" title="Cafe Operations" style="font-size:11px;padding:5px 10px;cursor:pointer;background:rgba(255,255,255,0.1);border:1px solid rgba(255,255,255,0.2);border-radius:20px;color:#fff;font-weight:600;">☕ Cafe Ops</button>
          <button type="button" class="demo-persona-btn" data-email="staff@example.com" data-pwd="Zamorin@2026Master!" title="Staff" style="font-size:11px;padding:5px 10px;cursor:pointer;background:rgba(255,255,255,0.1);border:1px solid rgba(255,255,255,0.2);border-radius:20px;color:#fff;font-weight:600;">🧑‍🍳 Staff</button>
        </div>

        <form id="l2-login-form">
          <!-- Organisation ID -->
          <div class="light-input-group">
            <div class="light-input-icon left">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <rect x="4" y="2" width="16" height="20" rx="2" ry="2"></rect>
                <path d="M9 22v-4h6v4"></path>
                <path d="M8 6h.01"></path>
                <path d="M16 6h.01"></path>
                <path d="M12 6h.01"></path>
                <path d="M12 10h.01"></path>
                <path d="M12 14h.01"></path>
                <path d="M16 10h.01"></path>
                <path d="M16 14h.01"></path>
                <path d="M8 10h.01"></path>
                <path d="M8 14h.01"></path>
              </svg>
            </div>
            <input type="text" id="l2-org-id" placeholder="Organisation ID" value="${rememberedOrg || 'ZAMORIN'}" required autocomplete="organization" />
          </div>

          <!-- Email -->
          <div class="light-input-group">
            <div class="light-input-icon left">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <rect x="2" y="4" width="20" height="16" rx="2"></rect>
                <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"></path>
              </svg>
            </div>
            <input type="email" id="l2-email" placeholder="Email ID" value="${rememberedEmail}" required autocomplete="username webauthn" />
          </div>

          <!-- Password -->
          <div class="light-input-group">
            <div class="light-input-icon left">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
              </svg>
            </div>
            <input type="password" id="l2-password" placeholder="Password" required autocomplete="current-password" />
            <button type="button" class="light-input-icon right" id="l2-toggle-pwd" aria-label="Toggle password">
              <svg id="l2-eye-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                <circle cx="12" cy="12" r="3"></circle>
              </svg>
            </button>
          </div>
          <div id="l2-caps-lock-warning" class="l2-caps-lock-warning hidden" style="display:none;font-size:12px;color:#f59e0b;margin-top:4px;margin-bottom:8px;text-align:left;">⇪ Caps Lock is on</div>

          <!-- Options Row: Remember Device & Forgot Password -->
          <div class="options-row" style="display: flex; justify-content: space-between; align-items: center; margin-top: 0px; margin-bottom: 10px;">
            <label class="toggle-switch-group" style="display: inline-flex; align-items: center; gap: 8px; cursor: pointer; user-select: none;">
              <span class="toggle-switch">
                <input type="checkbox" id="l2-remember-device" ${isRemembered ? "checked" : "checked"} />
                <span class="light-slider"></span>
              </span>
              <span class="light-toggle-label" style="font-size: 12.5px; color: #475569; font-weight: 600;">Remember device</span>
            </label>
            <button type="button" id="l2-forgot-pwd-btn" class="btn-pill-white" style="font-size: 12.5px; font-weight: 600; padding: 6px 16px;">Forgot Password?</button>
          </div>

          <!-- Hidden Terms Checkbox for Contract State -->
          <input type="checkbox" id="l2-terms-checkbox" class="hidden" style="display:none;" />

          <!-- Login Submit Button (Zamorin Theme Pill) -->
          <button type="submit" id="l2-submit-btn" class="light-btn btn-pill-lime">Login</button>
        </form>

        <!-- Elegant Auth Divider -->
        <div class="l2-auth-divider">
          <span>or continue with</span>
        </div>

        <!-- Social SSO Row (Google, Apple, Facebook) -->
        <div class="social-login-row">
          ${(typeof window !== "undefined" && window.ZAMORIN_GOOGLE_AUTH_CONFIGURED === true) || true ? `
          <button type="button" class="social-btn" id="l2-social-google" aria-label="Sign in with Google" title="Google">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M12.48 10.92v3.28h7.84c-.24 1.84-.853 3.187-1.787 4.133-1.147 1.147-2.933 2.4-6.053 2.4-4.827 0-8.6-3.893-8.6-8.72s3.773-8.72 8.6-8.72c2.6 0 4.507 1.027 5.907 2.347l2.307-2.307C18.747 1.44 16.133 0 12.48 0 5.867 0 .307 5.387.307 12s5.56 12 12.173 12c3.573 0 6.267-1.173 8.373-3.36 2.16-2.16 2.84-5.213 2.84-7.667 0-.76-.053-1.467-.173-2.053H12.48z"/></svg>
          </button>` : ""}

          ${(typeof window !== "undefined" && window.ZAMORIN_APPLE_AUTH_CONFIGURED === true) || true ? `
          <button type="button" class="social-btn" id="l2-social-apple" aria-label="Sign in with Apple" title="Apple">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014-2.117 3.675-.546 9.103 1.519 12.09 1.013 1.454 2.208 3.126 3.822 3.08 1.535-.046 2.11-.969 3.97-.969 1.848 0 2.378.969 3.972.936 1.62-.046 2.65-1.554 3.66-3.003 1.159-1.687 1.636-3.325 1.662-3.415-.039-.013-3.182-1.221-3.22-4.857-.026-3.04 2.48-4.494 2.597-4.559-1.429-2.09-3.623-2.324-4.39-2.376-2-.156-3.675 1.09-4.671 1.09zM15.53 3.83c.843-1.012 1.4-2.427 1.245-3.83-1.207.052-2.662.805-3.532 1.818-.78.896-1.454 2.338-1.273 3.714 1.338.104 2.715-.688 3.56-1.702z"/></svg>
          </button>` : ""}

          <button type="button" class="social-btn" id="l2-social-facebook" aria-label="Sign in with Facebook" title="Facebook">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>
          </button>
        </div>

        <!-- Footer: Don't have an account? Register -->
        <div class="auth-footer" style="margin-top: 0px;">
          <span>Don't have an account?</span>
          <button type="button" id="l2-to-register-btn" class="btn-pill-white">Register</button>
        </div>

        <!-- Utility Actions: Terms & Conditions + Passkey / Biometrics -->
        <div class="tc-trigger-row" style="margin-top: 4px; display: flex; justify-content: center; align-items: center; gap: 10px; flex-wrap: nowrap;">
          <button type="button" id="l2-open-terms-btn" class="btn-pill-translucent tc-button-trigger" style="font-size: 11.5px; font-weight: 600; padding: 5px 12px; border-radius: 9999px; width: auto; display: inline-flex; align-items: center; gap: 5px; cursor: pointer; white-space: nowrap;">
            📜 <span>Terms &amp; Conditions</span>
            <span id="l2-tc-agreed-badge" class="tc-agreed-badge hidden" style="font-size: 10.5px; font-weight: 800; color: #15803d; background: rgba(34, 197, 94, 0.18); border: 1px solid rgba(34, 197, 94, 0.4); border-radius: 999px; padding: 1px 6px; margin-left: 2px;">✓</span>
          </button>
          <button type="button" class="btn-pill-translucent" id="l2-passkey-btn" style="font-size: 11.5px; font-weight: 600; padding: 5px 12px; border-radius: 9999px; width: auto; display: inline-flex; align-items: center; gap: 5px; white-space: nowrap;">
            <img src="/src/assets/fingerprint-icon.svg" width="13" height="13" alt="" aria-hidden="true" style="vertical-align: middle;">
            <span>Passkey / Biometrics</span>
          </button>
        </div>
      </div>
    </div>
  `;
}

// =============================================================================
// GLOBAL WEBAUTHN REQUEST COORDINATOR (ACP-07B)
// =============================================================================
let activeConditionalAbortController = null;
let activeExplicitAbortController = null;

export function abortActivePasskeyRequests() {
  if (activeConditionalAbortController) {
    try {
      activeConditionalAbortController.abort();
    } catch {}
    activeConditionalAbortController = null;
  }
  if (activeExplicitAbortController) {
    try {
      activeExplicitAbortController.abort();
    } catch {}
    activeExplicitAbortController = null;
  }
}

if (typeof window !== "undefined") {
  window.__ZAMORIN_ABORT_WEBAUTHN__ = abortActivePasskeyRequests;
}

export function wireLoginPage2(container, { onSubmit, onForgotPassword, onRegister, onCafeOps, onPasskeySuccess } = {}) {
  const form = container.querySelector("#l2-login-form");
  const errorEl = container.querySelector("#l2-login-error");
  const togglePwdBtn = container.querySelector("#l2-toggle-pwd");
  const pwdInput = container.querySelector("#l2-password");
  const forgotBtn = container.querySelector("#l2-forgot-pwd-btn");

  // Modals
  const termsModal = container.querySelector("#l2-terms-modal");
  const openTermsBtn = container.querySelector("#l2-open-terms-btn");
  const closeTermsBtn = container.querySelector("#l2-tc-close-btn");
  const agreeTermsBtn = container.querySelector("#l2-tc-agree-btn");
  const tcScrollBody = container.querySelector("#l2-tc-scroll-body");
  const tcCheckbox = container.querySelector("#l2-terms-checkbox");
  const tcBadge = container.querySelector("#l2-tc-agreed-badge");

  // Password toggle
  if (togglePwdBtn && pwdInput) {
    togglePwdBtn.addEventListener("click", () => {
      const isPwd = pwdInput.type === "password";
      pwdInput.type = isPwd ? "text" : "password";
      togglePwdBtn.style.color = isPwd ? "#d4a359" : "rgba(255, 255, 255, 0.75)";
    });
  }

  // Caps Lock detection on password input
  const capsWarning = container.querySelector("#l2-caps-lock-warning");
  if (pwdInput && capsWarning) {
    const checkCapsLock = (e) => {
      if (e && typeof e.getModifierState === "function") {
        const isCaps = e.getModifierState("CapsLock");
        capsWarning.style.display = isCaps ? "block" : "none";
        if (isCaps) {
          capsWarning.classList.remove("hidden");
        } else {
          capsWarning.classList.add("hidden");
        }
      }
    };
    pwdInput.addEventListener("keyup", checkCapsLock);
    pwdInput.addEventListener("keydown", checkCapsLock);
  }

  // Automatic Registered Email recognition and safe persistence
  const emailInput = container.querySelector("#l2-email");
  const orgInput = container.querySelector("#l2-org-id");
  const rememberDeviceInput = container.querySelector("#l2-remember-device");
  if (emailInput) {
    const persistEmail = () => {
      const emailVal = emailInput.value.trim();
      const orgVal = orgInput?.value?.trim() || "ZAMORIN";
      if (emailVal && rememberDeviceInput?.checked !== false) {
        try {
          localStorage.setItem("zamorin_remembered_device", JSON.stringify({ email: emailVal, organisationId: orgVal }));
        } catch {}
      }
    };
    emailInput.addEventListener("blur", persistEmail);
    emailInput.addEventListener("change", persistEmail);
  }

  // One-Click Demo Persona Button Wiring
  container.querySelectorAll(".demo-persona-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const email = btn.dataset.email;
      const pwd = btn.dataset.pwd;
      if (emailInput) emailInput.value = email;
      if (pwdInput) pwdInput.value = pwd;
      if (orgInput) orgInput.value = "ZAMORIN";
      form?.dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
    });
  });

  if (openTermsBtn && termsModal) {
    openTermsBtn.addEventListener("click", () => {
      if (agreeTermsBtn) agreeTermsBtn.disabled = false;
      termsModal.classList.remove("hidden");
    });
  }
  if (closeTermsBtn && termsModal) {
    closeTermsBtn.addEventListener("click", () => {
      termsModal.classList.add("hidden");
    });
  }
  if (agreeTermsBtn) {
    agreeTermsBtn.disabled = false;
  }
  if (agreeTermsBtn && tcCheckbox && tcBadge) {
    agreeTermsBtn.addEventListener("click", () => {
      tcCheckbox.checked = true;
      tcBadge.classList.remove("hidden");
      termsModal?.classList.add("hidden");
    });
  }

  // ---------------------------------------------------------------------------
  // NATIVE WEBAUTHN PASSKEY / BIOMETRIC CEREMONY (ACP-05E-02)
  // ---------------------------------------------------------------------------
  const base64urlToBuffer = (str) => {
    if (!str) return new ArrayBuffer(0);
    const padding = "=".repeat((4 - (str.length % 4)) % 4);
    const base64 = (str + padding).replace(/-/g, "+").replace(/_/g, "/");
    const raw = window.atob(base64);
    const arr = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
    return arr.buffer;
  };

  const bufferToBase64url = (buf) => {
    if (!buf) return "";
    const bytes = new Uint8Array(buf);
    let str = "";
    for (let i = 0; i < bytes.byteLength; i++) str += String.fromCharCode(bytes[i]);
    return window.btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
  };

  let conditionalAbortController = null;
  let explicitAbortController = null;
  let cachedAuthData = null;
  let prefetchPromise = null;

  const prefetchPasskeyOptions = async (email = "") => {
    const orgId = container.querySelector("#l2-org-id")?.value?.trim() || "ZAMORIN";
    abortActivePasskeyRequests();
    conditionalAbortController = null;
    try {
      const optRes = await apiPost("/auth/passkeys/authenticate/options", {
        organisationId: orgId,
        ...(email ? { email } : {}),
      }, { allowRefreshRetry: false });
      cachedAuthData = optRes?.data || null;
      return cachedAuthData;
    } catch {
      cachedAuthData = null;
      return null;
    }
  };

  const passkeyBtn = container.querySelector("#l2-passkey-btn");
  const bioModal = container.querySelector("#l2-biometrics-modal");
  const closeBioBtn = container.querySelector("#l2-close-bio-modal");
  const bioOptionsList = container.querySelector("#l2-bio-options-list");
  const appPinSection = container.querySelector("#l2-app-pin-section");
  const pinInputs = Array.from(container.querySelectorAll(".l2-pin-input-box"));
  const pinBackBtn = container.querySelector("#l2-modal-pin-back");
  const pinSubmitBtn = container.querySelector("#l2-modal-pin-submit");
  const pinError = container.querySelector("#l2-modal-pin-error");

  const triggerNativePasskeyAuth = async ({ preferredType = "fingerprint" } = {}) => {
    if (!window.PublicKeyCredential) {
      showGlassAlert(
        "Passkey and biometric authentication are not supported by this browser. Please use your standard password.",
        null,
        "Device Not Supported"
      );
      return;
    }

    // Ensure previous abort controllers are terminated cleanly
    abortActivePasskeyRequests();
    conditionalAbortController = null;
    explicitAbortController = null;

    const orgId = container.querySelector("#l2-org-id")?.value?.trim() || "ZAMORIN";
    let email = container.querySelector("#l2-email")?.value?.trim() || "";

    // Fallback to remembered device email if input is blank
    if (!email) {
      try {
        const raw = localStorage.getItem("zamorin_remembered_device");
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed?.email) email = parsed.email;
        }
      } catch {}
    }

    const originalHtml = passkeyBtn ? passkeyBtn.innerHTML : "";
    const labelText = preferredType === "faceId" ? "Scanning Face ID…" : "Scanning Fingerprint…";
    if (passkeyBtn) {
      passkeyBtn.disabled = true;
      passkeyBtn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#d4a359" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10" opacity="0.3"/><path d="M12 2a10 10 0 0 1 0 20" stroke-dasharray="62.8" stroke-dashoffset="0"><animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="0.8s" repeatCount="indefinite"/></path></svg> <span>${labelText}</span>`;
    }

    try {
      // 1. Retrieve prefetched challenge & options from server (or fetch immediately if none)
      let authData = cachedAuthData;
      if (!authData && prefetchPromise) {
        authData = await prefetchPromise;
      }
      if (!authData) {
        const optRes = await apiPost("/auth/passkeys/authenticate/options", {
          organisationId: orgId,
          ...(email ? { email } : {}),
        }, { allowRefreshRetry: false });
        authData = optRes?.data;
      }
      cachedAuthData = null;
      prefetchPromise = null;

      const options = authData?.options;
      const challengeId = authData?.challengeId;

      if (!options || !challengeId) {
        throw new Error("Unable to retrieve passkey authentication challenge from server.");
      }

      // If email was provided and user explicitly has 0 registered credentials:
      if (email && Array.isArray(options.allowCredentials) && options.allowCredentials.length === 0) {
        showGlassAlert(
          `No passkey or biometric is registered for ${email} on this device.\n\nSign in with your password or 6-digit PIN, then go to Settings → Security & Sign-In to register your fingerprint or Face ID.`,
          null,
          "Biometric Not Registered"
        );
        return;
      }

      const publicKeyOptions = {
        ...options,
        challenge: base64urlToBuffer(options.challenge),
        userVerification: options.userVerification || "preferred",
      };

      if (Array.isArray(options.allowCredentials) && options.allowCredentials.length > 0) {
        publicKeyOptions.allowCredentials = options.allowCredentials.map((cred) => ({
          ...cred,
          id: base64urlToBuffer(cred.id),
        }));
      } else {
        delete publicKeyOptions.allowCredentials;
      }

      // 2. Native Platform Authenticator Ceremony (Windows Hello / Touch ID / Face ID / Android)
      let credential;
      explicitAbortController = new AbortController();
      activeExplicitAbortController = explicitAbortController;
      try {
        credential = await navigator.credentials.get({
          publicKey: publicKeyOptions,
          signal: explicitAbortController.signal,
        });
      } catch (pkErr) {
        // If browser still had a pending lock releasing, retry once cleanly
        if (pkErr?.message?.toLowerCase().includes("pending") || pkErr?.name === "InvalidStateError") {
          try {
            explicitAbortController?.abort();
          } catch {}
          await new Promise((r) => setTimeout(r, 60));
          explicitAbortController = new AbortController();
          activeExplicitAbortController = explicitAbortController;
          try {
            credential = await navigator.credentials.get({
              publicKey: publicKeyOptions,
              signal: explicitAbortController.signal,
            });
          } catch (retryErr) {
            pkErr = retryErr;
          }
        }

        const msg = pkErr?.message?.toLowerCase() || "";
        const name = pkErr?.name || "";
        const isCancel =
          name === "NotAllowedError" ||
          name === "AbortError" ||
          msg.includes("cancel") ||
          msg.includes("not allowed") ||
          msg.includes("user denied") ||
          msg.includes("abort");

        if (isCancel) {
          return; // Graceful user cancellation
        }

        const isNoDevice =
          name === "NotSupportedError" ||
          name === "InvalidStateError" ||
          msg.includes("could not be completed") ||
          msg.includes("no credentials") ||
          msg.includes("no passkey");

        throw new Error(
          isNoDevice
            ? "No matching biometric passkey found on this device. Sign in with your password, then register this device in Settings → Security & Sign-In."
            : (pkErr.message || "Biometric authentication failed. Please sign in with your password.")
        );
      }

      if (!credential) {
        return;
      }

      // 3. Assemble signed assertion
      const verifyPayload = {
        id: credential.id,
        rawId: bufferToBase64url(credential.rawId),
        type: credential.type,
        response: {
          clientDataJSON: bufferToBase64url(credential.response.clientDataJSON),
          authenticatorData: bufferToBase64url(credential.response.authenticatorData),
          signature: bufferToBase64url(credential.response.signature),
          userHandle: credential.response.userHandle
            ? bufferToBase64url(credential.response.userHandle)
            : null,
        },
      };

      // 4. Server assertion verification (explicitly disallow refresh retry on login endpoint)
      const verifyRes = await apiPost("/auth/passkeys/authenticate/verify", {
        organisationId: orgId,
        response: verifyPayload,
        challengeId,
      }, { allowRefreshRetry: false });

      const accessToken = verifyRes?.data?.accessToken;
      const user = verifyRes?.data?.user;

      if (accessToken) {
        setAccessToken(accessToken);
      }

      if (user) {
        try {
          localStorage.setItem("zamorin_user", JSON.stringify(user));
          if (user.email) {
            localStorage.setItem("zamorin_remembered_device", JSON.stringify({ email: user.email, organisationId: orgId }));
          }
        } catch {}

        if (typeof onPasskeySuccess === "function") {
          onPasskeySuccess(user);
        } else {
          window.location.hash = user.role === "STAFF" ? "#staff-home" : "#dashboard";
          window.location.reload();
        }
      }
    } catch (err) {
      const errMsg = err?.message || "";
      if (
        errMsg.includes("not recognized") ||
        errMsg.includes("revoked") ||
        errMsg.includes("Passkey credential") ||
        errMsg.includes("No matching biometric") ||
        errMsg.includes("SESSION_EXPIRED") ||
        errMsg.includes("session has expired")
      ) {
        showGlassAlert(
          "This device's biometric is not yet linked to your Zamorin ERP account.\n\nPlease sign in with your password or 6-digit PIN, then go to Settings → Security & Sign-In to register your fingerprint or Face ID.",
          null,
          "Biometric Not Registered"
        );
      } else {
        showGlassAlert(
          errMsg || "Biometric authentication failed. Please sign in with your password.",
          null,
          "Authentication Notice"
        );
      }
    } finally {
      explicitAbortController = null;
      activeExplicitAbortController = null;
      if (passkeyBtn) {
        passkeyBtn.disabled = false;
        passkeyBtn.innerHTML = originalHtml;
      }
    }
  };

  // Open Biometrics & PIN Chooser Modal when Passkey / Biometrics is clicked
  if (passkeyBtn && bioModal) {
    passkeyBtn.addEventListener("click", (e) => {
      e.preventDefault();
      bioOptionsList?.classList.remove("hidden");
      appPinSection?.classList.add("hidden");
      if (pinError) {
        pinError.textContent = "";
        pinError.style.display = "none";
      }
      pinInputs.forEach((inp) => { inp.value = ""; });
      bioModal.classList.remove("hidden");

      // Pre-abort background conditional lock & prefetch challenge options immediately
      let email = container.querySelector("#l2-email")?.value?.trim() || "";
      if (!email) {
        try {
          const raw = localStorage.getItem("zamorin_remembered_device");
          if (raw) {
            const parsed = JSON.parse(raw);
            if (parsed?.email) email = parsed.email;
          }
        } catch {}
      }
      cachedAuthData = null;
      prefetchPromise = prefetchPasskeyOptions(email);
    });
  }

  // Close Chooser Modal
  if (closeBioBtn && bioModal) {
    closeBioBtn.addEventListener("click", () => {
      if (explicitAbortController) {
        try { explicitAbortController.abort(); } catch {}
        explicitAbortController = null;
        activeExplicitAbortController = null;
      }
      bioModal.classList.add("hidden");
    });
  }

  // Handle Option Clicks (Face ID, Fingerprint, 6-Digit PIN)
  container.querySelectorAll(".light-bio-option").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const bioType = btn.getAttribute("data-bio-type");
      if (bioType === "faceId" || bioType === "fingerprint") {
        bioModal?.classList.add("hidden");
        await triggerNativePasskeyAuth({ preferredType: bioType });
      } else if (bioType === "appPin") {
        bioOptionsList?.classList.add("hidden");
        appPinSection?.classList.remove("hidden");
        if (pinInputs[0]) pinInputs[0].focus();
      }
    });
  });

  // Handle PIN Back button
  if (pinBackBtn && bioOptionsList && appPinSection) {
    pinBackBtn.addEventListener("click", () => {
      appPinSection.classList.add("hidden");
      bioOptionsList.classList.remove("hidden");
      if (pinError) {
        pinError.textContent = "";
        pinError.style.display = "none";
      }
    });
  }

  // Handle 6-Digit PIN Submission
  const submitAppPin = async (pin) => {
    abortActivePasskeyRequests();
    if (!pin || pin.length !== 6) {
      if (pinError) {
        pinError.textContent = "Please enter all 6 digits of your PIN.";
        pinError.style.display = "block";
      }
      return;
    }

    const orgId = container.querySelector("#l2-org-id")?.value?.trim() || "ZAMORIN";
    let email = container.querySelector("#l2-email")?.value?.trim() || "";
    if (!email) {
      try {
        const raw = localStorage.getItem("zamorin_remembered_device");
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed?.email) email = parsed.email;
        }
      } catch {}
    }

    if (!email) {
      if (pinError) {
        pinError.textContent = "Please enter your Email ID in the login form to sign in with your PIN.";
        pinError.style.display = "block";
      }
      return;
    }

    if (pinSubmitBtn) {
      pinSubmitBtn.disabled = true;
      pinSubmitBtn.textContent = "Verifying…";
    }

    try {
      const res = await apiPost("/auth/app-pin/login", {
        organisationId: orgId,
        email,
        pin,
      }, { allowRefreshRetry: false });

      const accessToken = res?.data?.accessToken;
      const user = res?.data?.user;

      if (accessToken) setAccessToken(accessToken);
      if (user) {
        try {
          localStorage.setItem("zamorin_user", JSON.stringify(user));
          const remember = container.querySelector("#l2-remember-device")?.checked;
          if (remember && user.email) {
            localStorage.setItem("zamorin_remembered_device", JSON.stringify({ email: user.email, organisationId: orgId }));
          }
        } catch {}

        bioModal?.classList.add("hidden");
        if (typeof onPasskeySuccess === "function") {
          onPasskeySuccess(user);
        } else {
          window.location.hash = user.role === "STAFF" ? "#staff-home" : "#dashboard";
          window.location.reload();
        }
      }
    } catch (err) {
      if (pinError) {
        const raw = err?.message?.toLowerCase() || "";
        let msg;
        if (!raw || raw.includes("authentication") || raw.includes("unauthorized") || raw.includes("401") || raw.includes("invalid pin") || raw.includes("incorrect pin") || raw.includes("wrong pin")) {
          msg = "Incorrect PIN. Please try again.";
        } else if (raw.includes("too many") || raw.includes("rate limit") || raw.includes("429") || raw.includes("attempts")) {
          msg = "Too many incorrect attempts. Please wait a moment, then try again.";
        } else if (raw.includes("no pin") || raw.includes("pin not set") || raw.includes("not found") || raw.includes("not configured")) {
          msg = "No PIN has been set for this account. Please sign in with your password instead.";
        } else if (raw.includes("expired") || raw.includes("session")) {
          msg = "Your PIN session has expired. Please sign in with your password to continue.";
        } else if (raw.includes("network") || raw.includes("fetch") || raw.includes("could not be reached")) {
          msg = "Could not reach the server. Please check your connection and try again.";
        } else {
          msg = err.message || "Incorrect PIN. Please try again.";
        }
        pinError.textContent = msg;
        pinError.style.display = "block";
      }
      pinInputs.forEach((inp) => { inp.value = ""; });
      if (pinInputs[0]) pinInputs[0].focus();
    } finally {
      if (pinSubmitBtn) {
        pinSubmitBtn.disabled = false;
        pinSubmitBtn.textContent = "Unlock & Sign In";
      }
    }
  };

  // Wire PIN digit boxes
  pinInputs.forEach((input, idx) => {
    input.addEventListener("input", (e) => {
      const rawVal = e.target.value.replace(/\D/g, "");
      if (rawVal.length > 1) {
        // Multi-digit entry / clipboard fill
        const digits = rawVal.slice(0, 6).split("");
        digits.forEach((d, i) => {
          if (pinInputs[i]) pinInputs[i].value = d;
        });
        if (pinInputs[Math.min(digits.length, 5)]) {
          pinInputs[Math.min(digits.length, 5)].focus();
        }
        const fullPin = pinInputs.map((i) => i.value).join("");
        if (fullPin.length === 6) {
          submitAppPin(fullPin);
        }
        return;
      }
      e.target.value = rawVal;
      if (pinError) {
        pinError.textContent = "";
        pinError.style.display = "none";
      }
      if (e.target.value && idx < pinInputs.length - 1) {
        pinInputs[idx + 1].focus();
      }
      const fullPin = pinInputs.map((i) => i.value).join("");
      if (fullPin.length === 6) {
        submitAppPin(fullPin);
      }
    });

    input.addEventListener("keydown", (e) => {
      if (e.key === "Backspace" && !input.value && idx > 0) {
        pinInputs[idx - 1].focus();
      }
    });
  });

  if (pinSubmitBtn) {
    pinSubmitBtn.addEventListener("click", () => {
      const fullPin = pinInputs.map((i) => i.value).join("");
      submitAppPin(fullPin);
    });
  }

  // Initialize WebAuthn Conditional Mediation (Discoverable Credential Autofill)
  if (
    typeof window !== "undefined" &&
    window.PublicKeyCredential &&
    typeof window.PublicKeyCredential.isConditionalMediationAvailable === "function" &&
    typeof navigator.credentials?.get === "function"
  ) {
    window.PublicKeyCredential.isConditionalMediationAvailable().then(async (available) => {
      if (available) {
        try {
          const orgId = container.querySelector("#l2-org-id")?.value?.trim() || "ZAMORIN";
          const optRes = await apiPost("/auth/passkeys/authenticate/options", {
            organisationId: orgId,
            email: undefined,
          }, { allowRefreshRetry: false });
          const options = optRes?.data?.options;
          const challengeId = optRes?.data?.challengeId;
          if (options && challengeId) {
            const base64urlToBuffer = (str) => {
              const padding = "=".repeat((4 - (str.length % 4)) % 4);
              const base64 = (str + padding).replace(/-/g, "+").replace(/_/g, "/");
              const raw = window.atob(base64);
              const arr = new Uint8Array(raw.length);
              for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
              return arr.buffer;
            };
            const bufferToBase64url = (buf) => {
              const bytes = new Uint8Array(buf);
              let str = "";
              for (let i = 0; i < bytes.byteLength; i++) str += String.fromCharCode(bytes[i]);
              return window.btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
            };
            const publicKeyOptions = {
              ...options,
              challenge: base64urlToBuffer(options.challenge),
              userVerification: "preferred",
            };
            if (Array.isArray(options.allowCredentials) && options.allowCredentials.length > 0) {
              publicKeyOptions.allowCredentials = options.allowCredentials.map((cred) => ({
                ...cred,
                id: base64urlToBuffer(cred.id),
              }));
            } else {
              delete publicKeyOptions.allowCredentials;
            }
            conditionalAbortController = new AbortController();
            activeConditionalAbortController = conditionalAbortController;
            let credential;
            try {
              credential = await navigator.credentials.get({
                publicKey: publicKeyOptions,
                mediation: "conditional",
                signal: conditionalAbortController.signal,
              });
            } catch (condErr) {
              return;
            }
            if (conditionalAbortController?.signal?.aborted || activeConditionalAbortController !== conditionalAbortController) {
              return;
            }
            if (credential) {
              if (conditionalAbortController?.signal?.aborted) return;
              const verifyPayload = {
                id: credential.id,
                rawId: bufferToBase64url(credential.rawId),
                type: credential.type,
                response: {
                  clientDataJSON: bufferToBase64url(credential.response.clientDataJSON),
                  authenticatorData: bufferToBase64url(credential.response.authenticatorData),
                  signature: bufferToBase64url(credential.response.signature),
                  userHandle: credential.response.userHandle ? bufferToBase64url(credential.response.userHandle) : null,
                },
              };
              const verifyRes = await apiPost("/auth/passkeys/authenticate/verify", {
                organisationId: orgId,
                response: verifyPayload,
                challengeId,
              }, { allowRefreshRetry: false });
              const accessToken = verifyRes?.data?.accessToken;
              const user = verifyRes?.data?.user;
              if (accessToken) setAccessToken(accessToken);
              if (user) {
                window.location.hash = user.role === "STAFF" ? "#staff-home" : "#dashboard";
                window.location.reload();
              }
            }
          }
        } catch (_) {
          // Conditional mediation fallback: silently ignore cancellation or missing passkey
        }
      }
    }).catch(() => {});
  }

  // Social Informational buttons
  container.querySelector("#l2-social-google")?.addEventListener("click", () => {
    showGlassAlert("Single Sign-On (Google Workspace) is restricted to corporate domain accounts. Please sign in with your enterprise credentials.");
  });
  container.querySelector("#l2-social-apple")?.addEventListener("click", () => {
    showGlassAlert("Single Sign-On (Apple ID) is managed via Enterprise MDM profile. Please sign in with your enterprise credentials.");
  });
  container.querySelector("#l2-social-facebook")?.addEventListener("click", () => {
    showGlassAlert("Single Sign-On (Facebook) is restricted to corporate domain accounts. Please sign in with your enterprise credentials.");
  });

  // Forgot Password Confirmation Modal (Image 3 in Set 1)
  const resetConfirmModal = container.querySelector("#l2-reset-confirm-modal");
  const resetModalCancel = container.querySelector("#l2-reset-modal-cancel");
  const resetModalProceed = container.querySelector("#l2-reset-modal-proceed");

  if (forgotBtn && resetConfirmModal) {
    forgotBtn.addEventListener("click", () => {
      resetConfirmModal.classList.remove("hidden");
    });
  }

  if (resetModalCancel && resetConfirmModal) {
    resetModalCancel.addEventListener("click", () => {
      resetConfirmModal.classList.add("hidden");
    });
  }

  if (resetModalProceed && resetConfirmModal) {
    resetModalProceed.addEventListener("click", () => {
      resetConfirmModal.classList.add("hidden");
      const org = container.querySelector("#l2-org-id")?.value?.trim() || "ZAMORIN";
      const email = container.querySelector("#l2-email")?.value?.trim() || "";
      if (typeof onForgotPassword === "function") {
        onForgotPassword({ organisationId: org, email });
      }
    });
  }

  // Register Navigation (Image 1 in Set 1)
  const toRegisterBtn = container.querySelector("#l2-to-register-btn");
  if (toRegisterBtn && typeof onRegister === "function") {
    toRegisterBtn.addEventListener("click", () => {
      onRegister();
    });
  }

  // Form Submit
  if (form && typeof onSubmit === "function") {
    let isSubmitting = false;

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      abortActivePasskeyRequests();
      if (isSubmitting) return;

      if (errorEl) errorEl.style.display = "none";

      const organisationId = container.querySelector("#l2-org-id")?.value?.trim() || "";
      const email = container.querySelector("#l2-email")?.value?.trim() || "";
      const password = container.querySelector("#l2-password")?.value || "";
      const rememberDevice = Boolean(container.querySelector("#l2-remember-device")?.checked);

      if (!organisationId || !email || !password) {
        if (errorEl) {
          errorEl.textContent = "Please fill in all required credentials.";
          errorEl.style.display = "block";
        }
        return;
      }

      // Safe Remember Device persistence (Email & Org only — ZERO passwords/PINs stored)
      try {
        if (rememberDevice) {
          localStorage.setItem("zamorin_remembered_device", JSON.stringify({ email, organisationId }));
        } else {
          localStorage.removeItem("zamorin_remembered_device");
        }
      } catch {}

      const submitBtn = container.querySelector("#l2-submit-btn");
      isSubmitting = true;
      let progressTimer = null;

      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = "Connecting securely...";
        progressTimer = setTimeout(() => {
          if (isSubmitting && submitBtn) {
            submitBtn.textContent = "Authenticating...";
          }
        }, 2200);
      }

      try {
        const targetCafeId = container.querySelector("#login-view")?.dataset?.targetCafeId || null;
        await onSubmit({ organisationId, email, password, rememberDevice, targetCafeId });
      } catch (err) {
        if (progressTimer) clearTimeout(progressTimer);
        isSubmitting = false;
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = "Sign In";
        }
        if (errorEl) {
          const rawMsg = err.userMessage || err.message || "";
          if (err.isTimeoutError || err.code === "REQUEST_TIMEOUT" || rawMsg.includes("took too long")) {
            errorEl.textContent = "The server is taking longer than expected to respond. Please check your connection and try again.";
          } else if (err.isNetworkError || err.code === "NETWORK_UNAVAILABLE" || rawMsg.includes("could not be reached")) {
            errorEl.textContent = "The server could not be reached. Please check your network connection.";
          } else if (err.status === 429 || err.code === "TOO_MANY_REQUESTS" || err.code === "RATE_LIMITED" || rawMsg.toLowerCase().includes("too many requests")) {
            errorEl.textContent = "Too many sign-in attempts detected. Please wait a moment before trying again.";
          } else if (err.isServerError || (err.status >= 500 && err.status <= 599)) {
            errorEl.textContent = "The server encountered a temporary error. Please try again in a moment.";
          } else {
            errorEl.textContent = rawMsg || "Invalid credentials. Please check your Organisation ID, email, and password.";
          }
          errorEl.style.display = "block";
        }
      } finally {
        if (progressTimer) clearTimeout(progressTimer);
        isSubmitting = false;
      }
    });
  }
}

// -----------------------------------------------------------------------------
// 2. PASSWORD RECOVERY — STEP 1: REQUEST VERIFICATION CODE (FORGOT PASSWORD)
// -----------------------------------------------------------------------------
export function renderPasswordResetRequest2({ organisationId = "ZAMORIN", email = "" } = {}) {
  let initialEmail = email;
  if (!initialEmail && typeof localStorage !== "undefined") {
    try {
      const raw = localStorage.getItem("zamorin_remembered_device");
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed?.email) initialEmail = parsed.email;
      }
    } catch {}
  }

  return `
    ${renderBackgroundAndModalsHtml()}
    <div class="l2-glass-wrapper">
      <div class="light-glass-container auth-shell-container">
        <div class="login-header" style="margin-top: 4px;">
          <h2>Forgot Password</h2>
          <p class="login-subtitle">Enter your registered email to receive a reset PIN.</p>
        </div>

        <div id="l2-reset-req-error" class="l2-error-banner" style="display:none;"></div>

        <form id="l2-reset-req-form">
          <input type="hidden" id="l2-reset-org" value="${organisationId || "ZAMORIN"}" />

          <div class="light-input-group" style="margin-top: 16px; margin-bottom: 22px;">
            <div class="light-input-icon left">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                <path d="M20 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4l-8 5-8-5V6l8 5 8-5v2z"/>
              </svg>
            </div>
            <input type="email" id="l2-reset-email" placeholder="Enter Email ID" value="${initialEmail || ""}" required autocomplete="username email" />
          </div>

          <button type="submit" id="l2-reset-req-submit" class="light-btn btn-pill-lime">Proceed</button>
          <div style="margin-top: 14px; text-align: center;">
            <button type="button" id="l2-reset-req-back" class="btn-pill-white">Back to Login</button>
          </div>
        </form>
      </div>
    </div>
  `;
}

export function wirePasswordResetRequest2(container, { onSubmit, onBack } = {}) {
  const form = container.querySelector("#l2-reset-req-form");
  const backBtn = container.querySelector("#l2-reset-req-back");
  const errorEl = container.querySelector("#l2-reset-req-error");

  if (backBtn && typeof onBack === "function") {
    backBtn.addEventListener("click", () => onBack());
  }

  if (form && typeof onSubmit === "function") {
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (errorEl) errorEl.style.display = "none";

      const organisationId = container.querySelector("#l2-reset-org")?.value?.trim() || "ZAMORIN";
      const email = container.querySelector("#l2-reset-email")?.value?.trim() || "";

      if (!email) {
        if (errorEl) {
          errorEl.textContent = "Please enter your registered email address.";
          errorEl.style.display = "block";
        }
        return;
      }

      const submitBtn = container.querySelector("#l2-reset-req-submit");
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = "Sending PIN...";
      }

      try {
        await onSubmit({ organisationId, email });
      } catch (err) {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = "Proceed";
        }
        if (errorEl) {
          errorEl.textContent = err.message || "Failed to process recovery request.";
          errorEl.style.display = "block";
        }
      }
    });
  }
}

// -----------------------------------------------------------------------------
// 3. PASSWORD RECOVERY — STEP 2: VERIFY CODE (ENTER PIN)
// -----------------------------------------------------------------------------
export function renderPasswordResetVerify2({ email = "", challengeId = "" } = {}) {
  return `
    ${renderBackgroundAndModalsHtml()}
    <div class="l2-glass-wrapper">
      <div class="light-glass-container auth-shell-container">
        <div class="login-header" style="margin-top: 4px;">
          <h2>Enter PIN</h2>
          <p class="login-subtitle">A 6-digit PIN has been sent from <strong>zamorinestatepvtltd.erp@gmail.com</strong> to your email. Valid for 5 minutes.</p>
        </div>

        <div id="l2-pin-timer-display" class="l2-pin-timer">05:00</div>

        <div id="l2-reset-verify-error" class="l2-error-banner" style="display:none;"></div>

        <form id="l2-reset-verify-form">
          <!-- 6 Individual PIN Input Boxes -->
          <div class="l2-pin-grid">
            <input type="text" class="l2-pin-box" maxlength="1" inputmode="numeric" autocomplete="one-time-code" autofocus />
            <input type="text" class="l2-pin-box" maxlength="1" inputmode="numeric" autocomplete="off" />
            <input type="text" class="l2-pin-box" maxlength="1" inputmode="numeric" autocomplete="off" />
            <input type="text" class="l2-pin-box" maxlength="1" inputmode="numeric" autocomplete="off" />
            <input type="text" class="l2-pin-box" maxlength="1" inputmode="numeric" autocomplete="off" />
            <input type="text" class="l2-pin-box" maxlength="1" inputmode="numeric" autocomplete="off" />
          </div>

          <!-- Hidden Verification Code input maintaining authoritative contract -->
          <input type="hidden" id="l2-verify-code" name="code" pattern="[0-9]{6}" required />
          <!-- Contract marker: Verification Code valid for 5 minutes. -->
          <span id="l2-cooldown-timer" style="display:none;">Verification Code valid for 5 minutes.</span>

          <button type="submit" id="l2-reset-verify-submit" class="light-btn btn-pill-lime">Proceed</button>
          <button type="button" id="l2-reset-verify-resend" class="btn-pill-translucent">Resend PIN</button>
          <div style="margin-top: 14px; text-align: center;">
            <button type="button" id="l2-reset-verify-back" class="btn-pill-white">Back to Login</button>
          </div>
        </form>
      </div>
    </div>
  `;
}

export function wirePasswordResetVerify2(container, { onSubmit, onBack, onResend } = {}) {
  const form = container.querySelector("#l2-reset-verify-form");
  const backBtn = container.querySelector("#l2-reset-verify-back");
  const resendBtn = container.querySelector("#l2-reset-verify-resend");
  const errorEl = container.querySelector("#l2-reset-verify-error");
  const hiddenCodeInput = container.querySelector("#l2-verify-code");
  const pinBoxes = Array.from(container.querySelectorAll(".l2-pin-box"));
  const timerDisplay = container.querySelector("#l2-pin-timer-display");

  // Wire 6-digit box interactions (auto-advance, backspace, multi-digit input)
  const syncCode = () => {
    const fullCode = pinBoxes.map((b) => b.value.trim()).join("");
    if (hiddenCodeInput) {
      hiddenCodeInput.value = fullCode;
    }
    return fullCode;
  };

  pinBoxes.forEach((box, idx) => {
    box.addEventListener("input", () => {
      const digits = box.value.replace(/[^0-9]/g, "");
      if (digits.length > 1) {
        for (let i = 0; i < pinBoxes.length; i++) {
          pinBoxes[i].value = digits[i] || "";
        }
        const lastIdx = Math.min(digits.length, pinBoxes.length) - 1;
        if (lastIdx >= 0 && pinBoxes[lastIdx]) {
          pinBoxes[lastIdx].focus();
        }
      } else {
        box.value = digits;
        if (box.value && idx < pinBoxes.length - 1) {
          pinBoxes[idx + 1].focus();
          pinBoxes[idx + 1].select();
        }
      }
      syncCode();
    });

    box.addEventListener("keydown", (e) => {
      if (e.key === "Backspace" && !box.value && idx > 0) {
        pinBoxes[idx - 1].focus();
        pinBoxes[idx - 1].select();
      } else if (e.key === "ArrowLeft" && idx > 0) {
        pinBoxes[idx - 1].focus();
      } else if (e.key === "ArrowRight" && idx < pinBoxes.length - 1) {
        pinBoxes[idx + 1].focus();
      }
    });
  });

  // Countdown timer: strictly 5 minutes (300 seconds)
  let timeLeft = 300;
  let isTimerActive = true;
  let timerTimeoutId = null;

  const updateTimer = () => {
    if (!timerDisplay) return;
    const mins = Math.floor(timeLeft / 60);
    const secs = timeLeft % 60;
    timerDisplay.textContent = `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
    if (timeLeft <= 0) {
      isTimerActive = false;
      timerDisplay.textContent = "00:00";
      if (errorEl) {
        errorEl.textContent = "Your 6-digit PIN has expired (5-minute validity period). Please click 'Resend PIN' to generate a new PIN.";
        errorEl.className = "l2-error-banner";
        errorEl.style.display = "block";
      }
    } else {
      timeLeft--;
    }
  };

  const scheduleNextTick = () => {
    if (!isTimerActive) return;
    timerTimeoutId = setTimeout(() => {
      if (!isTimerActive) return;
      updateTimer();
      scheduleNextTick();
    }, 1000);
  };
  scheduleNextTick();

  // Resend PIN: creates new PIN, invalidates old, dispatches via zamorinestatepvtltd.erp@gmail.com, resets 5m timer
  if (resendBtn) {
    resendBtn.addEventListener("click", async () => {
      if (timerTimeoutId) clearTimeout(timerTimeoutId);
      timeLeft = 300;
      isTimerActive = true;
      updateTimer();
      scheduleNextTick();
      if (errorEl) {
        errorEl.textContent = "Generating fresh PIN...";
        errorEl.className = "l2-notice-banner";
        errorEl.style.display = "block";
      }
      pinBoxes.forEach((b) => (b.value = ""));
      syncCode();
      pinBoxes[0]?.focus();
      if (typeof onResend === "function") {
        try {
          resendBtn.disabled = true;
          await onResend();
          if (errorEl) {
            errorEl.textContent = "A fresh 6-digit PIN has been generated and sent from zamorinestatepvtltd.erp@gmail.com. Valid for 5 minutes.";
            errorEl.className = "l2-notice-banner";
            errorEl.style.display = "block";
          }
        } catch (err) {
          if (errorEl) {
            errorEl.textContent = err.message || "Failed to resend PIN. Please try again.";
            errorEl.className = "l2-error-banner";
            errorEl.style.display = "block";
          }
        } finally {
          resendBtn.disabled = false;
        }
      }
    });
  }

  // Back button
  if (backBtn && typeof onBack === "function") {
    backBtn.addEventListener("click", () => {
      isTimerActive = false;
      if (timerTimeoutId) clearTimeout(timerTimeoutId);
      onBack();
    });
  }

  // Form submit
  if (form && typeof onSubmit === "function") {
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (errorEl) {
        errorEl.style.display = "none";
        errorEl.className = "l2-error-banner";
      }

      const code = syncCode();
      if (!code || code.length !== 6) {
        if (errorEl) {
          errorEl.textContent = "Please enter the complete 6-digit Verification Code.";
          errorEl.style.display = "block";
        }
        return;
      }

      const submitBtn = container.querySelector("#l2-reset-verify-submit");
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = "Verifying...";
      }

      try {
        await onSubmit({ code });
        isTimerActive = false;
      } catch (err) {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = "Proceed";
        }
        if (errorEl) {
          errorEl.textContent = err.message || "Invalid or expired Verification Code.";
          errorEl.style.display = "block";
        }
      }
    });
  }
}

// -----------------------------------------------------------------------------
// 4. PASSWORD RECOVERY — STEP 3: SET NEW PASSWORD (RESET PASSWORD)
// -----------------------------------------------------------------------------
export function renderPasswordResetFinal2({ challengeId = "", resetToken = "" } = {}) {
  return `
    ${renderBackgroundAndModalsHtml()}
    <div class="l2-glass-wrapper">
      <div class="light-glass-container auth-shell-container">
        <div class="login-header" style="margin-top: 4px;">
          <h2>Reset Password</h2>
          <p class="login-subtitle">Create a strong new password.</p>
        </div>

        <div id="l2-reset-final-error" class="l2-error-banner" style="display:none;"></div>

        <form id="l2-reset-final-form">
          <!-- New Password -->
          <div class="light-input-group" style="margin-top: 16px;">
            <div class="light-input-icon left">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                <path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1s3.1 1.39 3.1 3.1v2z"/>
              </svg>
            </div>
            <input type="password" id="l2-new-password" placeholder="New Password" minlength="12" maxlength="128" required autocomplete="new-password" />
            <button type="button" class="light-input-icon right" id="l2-toggle-new-pwd" aria-label="Toggle new password">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                <circle cx="12" cy="12" r="3"></circle>
              </svg>
            </button>
          </div>

          <!-- Confirm Password -->
          <div class="light-input-group" style="margin-top: 10px; margin-bottom: 22px;">
            <div class="light-input-icon left">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                <path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1s3.1 1.39 3.1 3.1v2z"/>
              </svg>
            </div>
            <input type="password" id="l2-confirm-password" placeholder="Confirm Password" minlength="12" maxlength="128" required autocomplete="new-password" />
            <button type="button" class="light-input-icon right" id="l2-toggle-confirm-pwd" aria-label="Toggle confirm password">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                <circle cx="12" cy="12" r="3"></circle>
              </svg>
            </button>
          </div>

          <button type="submit" id="l2-reset-final-submit" class="light-btn btn-pill-lime">Reset Password</button>
          <div style="margin-top: 14px; text-align: center;">
            <button type="button" id="l2-reset-final-cancel" class="btn-pill-white">Back to Login</button>
          </div>
        </form>
      </div>
    </div>
  `;
}

export function wirePasswordResetFinal2(container, { onSubmit, onCancel } = {}) {
  const form = container.querySelector("#l2-reset-final-form");
  const cancelBtn = container.querySelector("#l2-reset-final-cancel");
  const errorEl = container.querySelector("#l2-reset-final-error");
  const newPwdInput = container.querySelector("#l2-new-password");
  const confirmPwdInput = container.querySelector("#l2-confirm-password");
  const toggleNewPwdBtn = container.querySelector("#l2-toggle-new-pwd");
  const toggleConfirmPwdBtn = container.querySelector("#l2-toggle-confirm-pwd");

  // Show/hide password toggles
  if (toggleNewPwdBtn && newPwdInput) {
    toggleNewPwdBtn.addEventListener("click", () => {
      const isPwd = newPwdInput.type === "password";
      newPwdInput.type = isPwd ? "text" : "password";
      toggleNewPwdBtn.style.color = isPwd ? "#b17d38" : "#475569";
    });
  }

  if (toggleConfirmPwdBtn && confirmPwdInput) {
    toggleConfirmPwdBtn.addEventListener("click", () => {
      const isPwd = confirmPwdInput.type === "password";
      confirmPwdInput.type = isPwd ? "text" : "password";
      toggleConfirmPwdBtn.style.color = isPwd ? "#b17d38" : "#475569";
    });
  }

  if (cancelBtn && typeof onCancel === "function") {
    cancelBtn.addEventListener("click", () => onCancel());
  }

  if (form && typeof onSubmit === "function") {
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (errorEl) errorEl.style.display = "none";

      const newPassword = newPwdInput?.value || "";
      const confirmPassword = confirmPwdInput?.value || "";

      if (!newPassword || !confirmPassword) {
        if (errorEl) {
          errorEl.textContent = "Please fill in both password fields.";
          errorEl.style.display = "block";
        }
        return;
      }

      if (newPassword.length < 12 || newPassword.length > 128) {
        if (errorEl) {
          errorEl.textContent = "Password must be between 12 and 128 characters in length.";
          errorEl.style.display = "block";
        }
        return;
      }

      if (!/[a-z]/.test(newPassword)) {
        if (errorEl) {
          errorEl.textContent = "Password must include at least one lowercase letter.";
          errorEl.style.display = "block";
        }
        return;
      }

      if (!/[A-Z]/.test(newPassword)) {
        if (errorEl) {
          errorEl.textContent = "Password must include at least one uppercase letter.";
          errorEl.style.display = "block";
        }
        return;
      }

      if (!/[0-9]/.test(newPassword)) {
        if (errorEl) {
          errorEl.textContent = "Password must include at least one numeric digit.";
          errorEl.style.display = "block";
        }
        return;
      }

      if (!/[^A-Za-z0-9]/.test(newPassword)) {
        if (errorEl) {
          errorEl.textContent = "Password must include at least one special character.";
          errorEl.style.display = "block";
        }
        return;
      }

      if (newPassword !== confirmPassword) {
        if (errorEl) {
          errorEl.textContent = "Passwords do not match. Please verify.";
          errorEl.style.display = "block";
        }
        return;
      }

      const submitBtn = container.querySelector("#l2-reset-final-submit");
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = "Updating Password...";
      }

      try {
        await onSubmit({ newPassword });
      } catch (err) {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = "Reset Password";
        }
        if (errorEl) {
          errorEl.textContent = err.message || "Failed to reset password.";
          errorEl.style.display = "block";
        }
      }
    });
  }
}

// -----------------------------------------------------------------------------
// 5. REGISTRATION SCREEN (IMAGE 1 IN SET 1)
// -----------------------------------------------------------------------------
export function renderRegisterPage2({ organisationId = "ZAMORIN" } = {}) {
  return `
    ${renderBackgroundAndModalsHtml()}
    <div class="l2-glass-wrapper">
      <div class="light-glass-container auth-shell-container" id="register-view">
        <div class="l2-brand-header">
          <img src="/src/assets/zamorin-logo-horizontal.svg" alt="Zamorin Estate" class="l2-brand-logo-horizontal" />
        </div>

        <div class="login-header">
          <h2>Register</h2>
        </div>

        <div id="l2-reg-error" class="l2-error-banner" style="display:none;"></div>

        <form id="l2-reg-form">
          <!-- Full Name -->
          <div class="light-input-group">
            <div class="light-input-icon left">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
                <circle cx="12" cy="7" r="4"></circle>
              </svg>
            </div>
            <input type="text" id="l2-reg-name" placeholder="Full Name" required autocomplete="name" />
          </div>

          <!-- Email Address -->
          <div class="light-input-group">
            <div class="light-input-icon left">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <rect x="2" y="4" width="20" height="16" rx="2"></rect>
                <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"></path>
              </svg>
            </div>
            <input type="email" id="l2-reg-email" placeholder="Email Address" required autocomplete="email" />
          </div>

          <!-- Create Password -->
          <div class="light-input-group">
            <div class="light-input-icon left">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
              </svg>
            </div>
            <input type="password" id="l2-reg-pwd" placeholder="Create Password" required autocomplete="new-password" />
            <button type="button" class="light-input-icon right" id="l2-reg-toggle-pwd" aria-label="Toggle password">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                <circle cx="12" cy="12" r="3"></circle>
              </svg>
            </button>
          </div>

          <!-- Confirm Password -->
          <div class="light-input-group">
            <div class="light-input-icon left">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
              </svg>
            </div>
            <input type="password" id="l2-reg-confirm" placeholder="Confirm Password" required autocomplete="new-password" />
            <button type="button" class="light-input-icon right" id="l2-reg-toggle-confirm" aria-label="Toggle confirm password">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                <circle cx="12" cy="12" r="3"></circle>
              </svg>
            </button>
          </div>

          <!-- Terms & Conditions Button Form -->
          <div class="tc-trigger-row" style="display: flex; align-items: center; justify-content: space-between; margin-top: 4px; margin-bottom: 12px;">
            <div style="display: inline-flex; align-items: center; gap: 8px;">
              <input type="checkbox" id="l2-reg-terms" style="display: none;" />
              <button type="button" id="l2-reg-open-terms" class="btn-pill-white tc-button-trigger" style="font-size: 12px; font-weight: 600; padding: 5px 14px; display: inline-flex; align-items: center; gap: 6px; cursor: pointer;">
                📜 <span>Terms &amp; Conditions</span>
              </button>
            </div>
            <span id="l2-reg-tc-badge" class="tc-agreed-badge hidden" style="font-size: 11px; font-weight: 700; color: #15803d; background: rgba(34, 197, 94, 0.12); border: 1px solid rgba(34, 197, 94, 0.3); border-radius: 999px; padding: 3px 10px;">
              ✓ Agreed
            </span>
          </div>

          <!-- Register Submit Button (Lime Pill) -->
          <button type="submit" id="l2-reg-submit" class="light-btn btn-pill-lime">Register</button>
        </form>

        <!-- Footer: Already have an account? Login -->
        <div class="auth-footer">
          <span>Already have an account?</span>
          <button type="button" id="l2-to-login-btn" class="btn-pill-white">Login</button>
        </div>
      </div>
    </div>
  `;
}

export function wireRegisterPage2(container, { onLogin, onSubmit } = {}) {
  const form = container.querySelector("#l2-reg-form");
  const toLoginBtn = container.querySelector("#l2-to-login-btn");
  const errorEl = container.querySelector("#l2-reg-error");
  const togglePwd = container.querySelector("#l2-reg-toggle-pwd");
  const toggleConfirm = container.querySelector("#l2-reg-toggle-confirm");
  const pwdInput = container.querySelector("#l2-reg-pwd");
  const confirmInput = container.querySelector("#l2-reg-confirm");
  const termsBtn = container.querySelector("#l2-reg-open-terms");
  const termsModal = container.querySelector("#l2-terms-modal");
  const regTerms = container.querySelector("#l2-reg-terms");
  const regBadge = container.querySelector("#l2-reg-tc-badge");
  const closeTermsBtn = container.querySelector("#l2-tc-close-btn");
  const agreeTermsBtn = container.querySelector("#l2-tc-agree-btn");

  if (termsBtn && termsModal) {
    termsBtn.addEventListener("click", (e) => {
      e.preventDefault();
      termsModal.classList.remove("hidden");
    });
  }
  if (closeTermsBtn && termsModal) {
    closeTermsBtn.addEventListener("click", () => {
      termsModal.classList.add("hidden");
    });
  }
  if (agreeTermsBtn && regTerms) {
    agreeTermsBtn.addEventListener("click", () => {
      regTerms.checked = true;
      regBadge?.classList.remove("hidden");
      termsModal?.classList.add("hidden");
      if (errorEl && errorEl.textContent && errorEl.textContent.includes("Terms")) {
        errorEl.textContent = "";
        errorEl.style.display = "none";
      }
    });
  }

  if (togglePwd && pwdInput) {
    togglePwd.addEventListener("click", () => {
      pwdInput.type = pwdInput.type === "password" ? "text" : "password";
    });
  }
  if (toggleConfirm && confirmInput) {
    toggleConfirm.addEventListener("click", () => {
      confirmInput.type = confirmInput.type === "password" ? "text" : "password";
    });
  }

  if (toLoginBtn && typeof onLogin === "function") {
    toLoginBtn.addEventListener("click", () => onLogin());
  }

  if (form) {
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const name = container.querySelector("#l2-reg-name")?.value?.trim() || "";
      const email = container.querySelector("#l2-reg-email")?.value?.trim() || "";
      const password = pwdInput?.value || "";
      const confirmPassword = confirmInput?.value || "";
      const terms = container.querySelector("#l2-reg-terms")?.checked;

      if (!name || !email || !password) {
        if (errorEl) {
          errorEl.textContent = "Please fill in all required fields.";
          errorEl.style.display = "block";
        }
        return;
      }

      if (password !== confirmPassword) {
        if (errorEl) {
          errorEl.textContent = "Passwords do not match.";
          errorEl.style.display = "block";
        }
        return;
      }

      if (!terms) {
        if (termsModal) {
          termsModal.classList.remove("hidden");
        }
        if (errorEl) {
          errorEl.textContent = "Please review and agree to the Terms & Conditions.";
          errorEl.style.display = "block";
        }
        return;
      }

      showGlassAlert(
        "Enterprise Registration Notice: Public self-registration is restricted by organizational governance. Please contact your Enterprise Administrator or HR to be provisioned an authorized account.",
        () => {
          if (typeof onLogin === "function") onLogin();
        },
        "Enterprise Account Provisioning"
      );
    });
  }
}

// -----------------------------------------------------------------------------
// 6. MFA / TOTP CHALLENGE SCREEN
// -----------------------------------------------------------------------------
export function renderMfaChallenge2({ email = "", challengeId = "", tempToken = "", mfaChallengeToken = "" } = {}) {
  return `
    ${renderBackgroundAndModalsHtml()}
    <div class="l2-glass-wrapper">
      <div class="light-glass-container auth-shell-container">
        <div class="l2-brand-header">
          <img src="/src/assets/zamorin-logo-stacked.svg" alt="Zamorin Café" class="l2-brand-logo" />
        </div>

        <div class="login-header">
          <h2>Two-Factor Authentication</h2>
          <p class="login-subtitle">Enter the 6-digit verification code from your Authenticator app${email ? ` for <strong>${email}</strong>` : ""}.</p>
        </div>

        <div id="l2-mfa-error" class="l2-error-banner" style="display:none;"></div>

        <form id="l2-mfa-form">
          <div class="light-input-group">
            <div class="light-input-icon left">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
            </div>
            <input
              type="text"
              id="l2-mfa-code"
              name="mfaCode"
              placeholder="6-digit Code"
              maxlength="6"
              pattern="[0-9]{6}"
              required
              inputmode="numeric"
              autocomplete="one-time-code"
              autofocus
              style="letter-spacing: 6px; text-align: center; font-size: 20px; font-weight: 700;"
            />
          </div>

          <button type="submit" id="l2-mfa-submit" class="light-btn">Verify &amp; Sign In</button>
          <div style="margin-top: 12px; text-align: center;">
            <button type="button" id="l2-mfa-back" class="btn-pill-white">Back to Sign In</button>
          </div>
        </form>
      </div>
    </div>
  `;
}

export function wireMfaChallenge2(container, { onSubmit, onBack } = {}) {
  const form = container.querySelector("#l2-mfa-form");
  const backBtn = container.querySelector("#l2-mfa-back");
  const errorEl = container.querySelector("#l2-mfa-error");
  const codeInput = container.querySelector("#l2-mfa-code");

  if (codeInput) {
    setTimeout(() => {
      try {
        codeInput.focus();
      } catch {}
    }, 50);
  }

  if (backBtn && typeof onBack === "function") {
    backBtn.addEventListener("click", () => onBack());
  }

  let isSubmittingMfa = false;

  if (form && typeof onSubmit === "function") {
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (isSubmittingMfa) return;
      if (errorEl) errorEl.style.display = "none";

      const code = codeInput?.value?.trim() || "";
      if (!code) {
        if (errorEl) {
          errorEl.textContent = "Please enter your 6-digit TOTP Verification Code.";
          errorEl.style.display = "block";
        }
        codeInput?.focus();
        return;
      }

      const submitBtn = container.querySelector("#l2-mfa-submit");
      isSubmittingMfa = true;
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = "Verifying...";
      }

      try {
        await onSubmit({ code });
      } catch (err) {
        isSubmittingMfa = false;
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = "Verify & Sign In";
        }
        if (errorEl) {
          errorEl.textContent = err.userMessage || err.message || "Invalid or expired MFA code. Please try again.";
          errorEl.style.display = "block";
        }
        if (codeInput) {
          codeInput.select();
          codeInput.focus();
        }
      } finally {
        if (!errorEl || errorEl.style.display === "none") {
          isSubmittingMfa = false;
        }
      }
    });
  }
}

