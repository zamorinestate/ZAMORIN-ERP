// =============================================================================
// ZAMORIN CAFE ERP — ENTRY POINT
//
// DIRECT DASHBOARD ENTRY & ZERO-COLLATERAL-CHANGE PROGRAMME
// -----------------------------------------------------------------------------
// In development & local preview mode:
//   1. On boot, loads the canonical MASTER (Primary Master) role context.
//   2. Seamlessly synchronizes with any active session from /api/v1/auth/me.
//   3. Shows a top banner indicating active role with instant view switching.
//   4. Directly mounts and renders the Command Centre Dashboard.
//
// PRODUCTION SECURITY:
//   1. DEV PREVIEW personas are NEVER used on public/production origins.
//   2. Production requires a valid authenticated /api/v1/auth/me session.
//   3. Unauthenticated production users are sent to the real login screen.
//   4. Development step-up auto-approval is restricted to localhost only.
// =============================================================================

import { state, setState } from "./state.js";
import { NAVIGATION, ROLES, isRouteAllowed } from "./navigation.js";
import { renderShell, navigate } from "./router.js";
import {
  apiGet,
  apiPost,
  getAccessToken,
  getOrCreateDeviceId,
  setStepUpAuthenticationHandler,
  setAccessToken,
  clearAllAuthTokens,
  addSessionExpirationListener,
  setSessionState,
  SessionState,
} from "./apiClient.js";
import { registerServiceWorker } from "./updateManager.js";
import { initLanguage } from "./i18n.js";
import {
  renderLoginPage2,
  wireLoginPage2,
  renderPasswordResetRequest2,
  wirePasswordResetRequest2,
  renderPasswordResetVerify2,
  wirePasswordResetVerify2,
  renderPasswordResetFinal2,
  wirePasswordResetFinal2,
  renderMfaChallenge2,
  wireMfaChallenge2,
  renderRegisterPage2,
  wireRegisterPage2,
  showGlassAlert,
  abortActivePasskeyRequests,
} from "./pages/login2.js?v=3.5.0";
import { mountPublicCafeGateway } from "./pages/cafeGatewayPage.js";
import "./responsiveAuditor.js";

// =============================================================================
// DEVELOPMENT PREVIEW USERS
// =============================================================================
//
// These fixtures are strictly development/local-preview identities.
//
// IMPORTANT:
// They must NEVER be used as an authentication fallback on public,
// staging, preview-deployment, or production origins.
// =============================================================================

export const DEV_PREVIEW_USERS = Object.freeze({
  master: Object.freeze({
    _id: "MU-0001",
    id: "MU-0001",
    name: "Zamorin Primary Master",
    email: "pradeeshk331@gmail.com",
    role: "MASTER",
    organisationId: "ZAMORIN",
    status: "ACTIVE",
    isPrimaryMaster: true,
    isDevPreview: true,
  }),

  owner: Object.freeze({
    _id: "OU-0001",
    id: "OU-0001",
    name: "Zamorin Owner",
    email: "owner@example.com",
    role: "OWNER",
    organisationId: "ZAMORIN",
    status: "ACTIVE",
    isDevPreview: true,
  }),

  cafe_admin: Object.freeze({
    _id: "AU-0001",
    id: "AU-0001",
    name: "Cafe Admin (Ops)",
    email: "admin@example.com",
    role: "CAFE_ADMIN",
    primaryCafeId: "",
    primaryCafeName: "",
    assignedCafeIds: [],
    organisationId: "ZAMORIN",
    status: "ACTIVE",
    isDevPreview: true,
  }),

  staff: Object.freeze({
    _id: "SU-0001",
    id: "SU-0001",
    name: "Normal Employee / Staff",
    email: "staff@example.com",
    role: "STAFF",
    primaryCafeId: "",
    assignedCafeIds: [],
    organisationId: "ZAMORIN",
    status: "ACTIVE",
    isDevPreview: true,
  }),

  vendor: Object.freeze({
    _id: "VU-0001",
    id: "VU-0001",
    name: "Demo Supplier Co.",
    email: "vendor@example.com",
    role: "VENDOR",
    vendorId: "VENDOR-DEMO-001",
    organisationId: "ZAMORIN",
    status: "ACTIVE",
    isDevPreview: true,
  }),
});

// =============================================================================
// DEVELOPMENT ROLE RESOLUTION
// =============================================================================

export function getRequestedDevRole() {
  if (typeof window === "undefined") {
    return "master";
  }

  const params = new URLSearchParams(window.location.search);

  const requested = (
    params.get("role") ||
    params.get("devRole") ||
    localStorage.getItem("zamorin-dev-role") ||
    "master"
  ).toLowerCase();

  const authority = (params.get("authority") || "").toLowerCase();

  if (
    requested === "staff" ||
    requested === "employee" ||
    requested === "normal-employee"
  ) {
    return "staff";
  }

  if (requested === "owner") {
    return "owner";
  }

  if (
    requested === "admin" ||
    requested === "cafe_admin" ||
    requested === "cafe-admin"
  ) {
    return "cafe_admin";
  }

  if (
    requested === "master_normal" ||
    (requested === "master" && authority === "normal")
  ) {
    // Normal Master is permanently retired
    return null;
  }

  if (requested === "vendor" || requested === "supplier") {
    return "vendor";
  }

  return "master";
}

// =============================================================================
// ENVIRONMENT SECURITY
// =============================================================================

export function isLocalDevelopmentOrigin() {
  if (typeof window === "undefined") {
    return true;
  }

  const hostname = window.location.hostname;

  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "0.0.0.0"
  );
}

export function isDirectDashboardAllowed() {
  if (typeof window === "undefined") {
    return true;
  }

  return isLocalDevelopmentOrigin();
}

export function renderProductionFailClosedScreen() {
  if (typeof document === "undefined") {
    return;
  }

  const appEl = document.getElementById("app");

  if (!appEl) {
    return;
  }

  appEl.innerHTML = `
    <div
      style="
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        min-height: 100vh;
        font-family: sans-serif;
        background: #0b0f19;
        color: #f8fafc;
        text-align: center;
        padding: 24px;
      "
    >
      <h1 style="color: #ef4444; margin-bottom: 12px;">
        Production Security Guard
      </h1>

      <p
        style="
          color: #94a3b8;
          max-width: 480px;
          line-height: 1.5;
        "
      >
        Fail-closed: Direct dashboard bypass is strictly forbidden in
        production environments. Please authenticate with valid credentials.
      </p>
    </div>
  `;
}

// =============================================================================
// AUTHENTICATION HELPERS
// =============================================================================

export async function handleLoginSubmit({
  organisationId,
  email,
  password,
}) {
  const result = await apiPost("/auth/login", {
    organisationId,
    email,
    password,
    identifier: email,
  });

  if (result?.data?.accessToken) {
    setAccessToken(result.data.accessToken);
  }

  return result;
}

export async function handlePasswordResetRequest({
  organisationId,
  email,
}) {
  const result = await apiPost("/auth/password/forgot", {
    organisationId,
    email,
  });

  return result;
}

export async function handlePasswordResetVerify({
  organisationId,
  email,
  code,
}) {
  const result = await apiPost("/auth/password/reset/verify", {
    organisationId,
    email,
    code,
  });

  const challengeId = result?.data?.challengeId;
  const resetToken = result?.data?.resetToken;

  if (!challengeId || !resetToken) {
    throw new Error(
      "Password reset credentials missing in response."
    );
  }

  return {
    challengeId,
    resetToken,
  };
}

export async function handlePasswordResetFinal({
  organisationId,
  challengeId,
  resetToken,
  newPassword,
}) {
  const result = await apiPost("/auth/password/reset", {
    organisationId,
    challengeId,
    resetToken,
    newPassword,
  });

  return result;
}

export function getSafeInternalRedirect(target) {
  if (!target || typeof target !== "string") return null;
  const trimmed = target.trim();
  // Disallow protocol-relative URLs (//example.com, \example.com)
  if (trimmed.startsWith("//") || trimmed.startsWith("\\\\") || trimmed.startsWith("/\\")) return null;
  // Disallow absolute URI schemes (http:, https:, javascript:, data:, etc.)
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed)) return null;
  // Disallow control characters
  if (/[\r\n\0]/.test(trimmed)) return null;

  // Safe internal hash route: e.g. "#pos", "#settings", "#vendors", "pos", "settings"
  if (trimmed.startsWith("#")) {
    const rawRoute = trimmed.slice(1).replace(/^\/+/, "");
    return rawRoute || null;
  }
  // Safe relative internal pathname: e.g. "/pos", "/vendors", "/settings"
  if (trimmed.startsWith("/")) {
    const rawRoute = trimmed.slice(1);
    return rawRoute || null;
  }
  // Simple internal route key: e.g. "pos", "vendors"
  if (/^[a-zA-Z0-9_\-\/]+$/.test(trimmed)) {
    return trimmed;
  }
  return null;
}

function resolveAuthenticatedRole(user) {
  const rawRole = String(user?.role || "").toUpperCase();

  if (rawRole === "PRIMARY_MASTER" || rawRole === "MASTER") {
    return {
      role: "master",
      isPrimaryMaster: rawRole === "PRIMARY_MASTER" || Boolean(user?.isPrimaryMaster),
    };
  }

  if (rawRole === "OWNER") {
    return {
      role: "owner",
      isPrimaryMaster: false,
    };
  }

  if (rawRole === "CAFE_ADMIN" || rawRole === "ADMIN") {
    return {
      role: "cafe_admin",
      isPrimaryMaster: false,
    };
  }

  if (rawRole === "STAFF" || rawRole === "EMPLOYEE") {
    return {
      role: "staff",
      isPrimaryMaster: false,
    };
  }

  if (rawRole === "VENDOR") {
    return {
      role: "vendor",
      isPrimaryMaster: false,
    };
  }

  // Fail closed to the least-privileged application navigation context.
  return {
    role: "staff",
    isPrimaryMaster: false,
  };
}

// =============================================================================
// AUTHENTICATION SCREEN
// =============================================================================

// =============================================================================
// BACKEND HEALTH WARM-UP (NON-BLOCKING & ASYNCHRONOUS)
// =============================================================================
let warmupTriggered = false;

export function triggerBackendWarmup() {
  if (warmupTriggered) return;
  warmupTriggered = true;

  try {
    const apiBase = window.ZAMORIN_API_BASE_URL || "/api/v1";
    // Non-blocking fetch with ZERO credentials to wake up Render backend during cold starts
    fetch(`${apiBase}/health`, {
      method: "GET",
      cache: "no-store",
      credentials: "omit",
    }).catch(() => {
      // Non-blocking: warm-up failure does not affect the UI or user typing
    });
  } catch {}
}

export function mountAuthScreen(screen = "login", params = {}) {
  if (typeof document === "undefined") return;
  abortActivePasskeyRequests();

  const appEl = document.getElementById("app");
  if (!appEl) return;

  // Authentication screens must never display the development banner.
  document.getElementById("zamorin-dev-preview-banner")?.remove();

  appEl.className = "auth-screen";
  delete appEl.dataset.shellRole;

  if (screen === "login") {
    // Non-blocking wake-up call to backend
    triggerBackendWarmup();

    const activeCafe = params.cafeContext || null;
    appEl.innerHTML = renderLoginPage2({ ...params, cafeContext: activeCafe });
    wireLoginPage2(appEl, {
      onSubmit: async ({ organisationId, email, password, rememberDevice, targetCafeId }) => {
        await handleCompleteLoginFlow({ organisationId, email, password, rememberDevice, targetCafeId });
      },
      onForgotPassword: ({ organisationId, email }) => {
        mountAuthScreen("forgot", { organisationId, email });
      },
      onRegister: () => {
        mountAuthScreen("register");
      },
      onCafeOps: () => {
        window.location.href = "/cafe-operations/cafe-operations.html";
      },
      onPasskeySuccess: (user) => {
        handleAuthenticatedUserSession(user);
      }
    });
  } else if (screen === "mfa") {
    const handleMfaSubmit = async ({ code }) => {
      try {
        const isSetup = Boolean(params.mfaSetupRequired);
        const endpoint = isSetup ? "/auth/mfa/confirm" : "/auth/mfa/verify";
        const challengeToken = params.mfaChallengeToken || params.tempToken || "";
        const rememberDevice = Boolean(params.rememberDevice);
        const payload = isSetup
          ? { mfaSetupToken: challengeToken, code, rememberDevice }
          : { mfaChallengeToken: challengeToken, code, rememberDevice };

        const res = await apiPost(endpoint, payload, { timeoutMs: 60000 });

        const accessToken = res?.data?.accessToken || res?.data?.token;
        if (accessToken) {
          setAccessToken(accessToken);
        }
        const user = res?.data?.user;
        if (user) {
          handleAuthenticatedUserSession(user);
          return;
        }
        window.location.hash = "#dashboard";
        await boot();
      } catch (err) {
        if (
          err?.code === "MFA_TOKEN_EXPIRED" ||
          err?.code === "INVALID_OR_EXPIRED_SESSION" ||
          err?.code === "AUTH_TOKEN_EXPIRED" ||
          (err?.message && (err.message.includes("expired") || err.message.includes("Expired")) && (err.message.includes("token") || err.message.includes("challenge")))
        ) {
          mountAuthScreen("login", {
            notice: "Your verification session has expired. Please sign in again.",
          });
          return;
        }
        throw new Error(err.userMessage || err.message || "Invalid or expired MFA verification code.");
      }
    };

    appEl.innerHTML = renderMfaChallenge2(params);
    wireMfaChallenge2(appEl, {
      onSubmit: handleMfaSubmit,
      onBack: () => mountAuthScreen("login"),
    });
  } else if (screen === "forgot") {
    appEl.innerHTML = renderPasswordResetRequest2(params);
    wirePasswordResetRequest2(appEl, {
      onSubmit: async ({ organisationId, email }) => {
        const res = await handlePasswordResetRequest({ organisationId, email });
        mountAuthScreen("verify", { organisationId, email, challengeId: res?.data?.challengeId });
      },
      onBack: () => mountAuthScreen("login")
    });
  } else if (screen === "verify") {
    appEl.innerHTML = renderPasswordResetVerify2(params);
    wirePasswordResetVerify2(appEl, {
      onSubmit: async ({ code }) => {
        const res = await handlePasswordResetVerify({
          organisationId: params.organisationId,
          email: params.email,
          challengeId: params.challengeId,
          code
        });
        mountAuthScreen("reset", {
          organisationId: params.organisationId,
          resetToken: res.resetToken,
          challengeId: res.challengeId
        });
      },
      onResend: async () => {
        const res = await handlePasswordResetRequest({
          organisationId: params.organisationId || "ZAMORIN",
          email: params.email,
        });
        if (res?.data?.challengeId) {
          params.challengeId = res.data.challengeId;
        }
      },
      onBack: () => mountAuthScreen("forgot")
    });
  } else if (screen === "reset") {
    appEl.innerHTML = renderPasswordResetFinal2(params);
    wirePasswordResetFinal2(appEl, {
      onSubmit: async ({ newPassword }) => {
        await handlePasswordResetFinal({
          organisationId: params.organisationId,
          challengeId: params.challengeId,
          resetToken: params.resetToken,
          newPassword
        });
        mountAuthScreen("login", { notice: "Password updated successfully. Please sign in with your new password." });
      },
      onCancel: () => mountAuthScreen("login")
    });
  } else if (screen === "register") {
    appEl.innerHTML = renderRegisterPage2(params);
    wireRegisterPage2(appEl, {
      onLogin: () => mountAuthScreen("login")
    });
  }
}

async function handleCompleteLoginFlow({ organisationId, email, password, rememberDevice = false, targetCafeId = null }) {
  try {
    const loginPayload = {
      organisationId,
      email,
      password,
      rememberDevice: Boolean(rememberDevice),
      identifier: email,
      device: {
        deviceId: getOrCreateDeviceId(),
        deviceName: "Browser Client",
        deviceType: "DESKTOP",
      },
    };
    if (targetCafeId) {
      loginPayload.targetCafeId = String(targetCafeId).trim().toUpperCase();
    }

    const res = await apiPost(
      "/auth/login",
      loginPayload,
      { timeoutMs: 60000 }
    );

    // Check if MFA is required (200/202 responses with challenge tokens)
    const isMfa = Boolean(
      res?.data?.mfaRequired ||
      res?.data?.requiresMfa ||
      res?.data?.mfaChallengeToken ||
      res?.data?.mfaSetupToken ||
      res?.status === 202 ||
      (res?.data?.challengeId && !res?.data?.accessToken)
    );

    if (isMfa) {
      const mfaChallengeToken = res?.data?.mfaChallengeToken || res?.data?.mfaSetupToken || res?.data?.tempToken || res?.data?.token || "";
      const isSetup = Boolean(res?.data?.mfaSetupRequired || res?.data?.mfaSetupToken);
      mountAuthScreen("mfa", {
        organisationId,
        email,
        challengeId: res?.data?.challengeId || res?.data?.userId || "",
        tempToken: mfaChallengeToken,
        mfaChallengeToken,
        mfaSetupRequired: isSetup,
        rememberDevice: Boolean(rememberDevice || res?.data?.rememberDevice),
      });
      return { mfaRequired: true };
    }

    const accessToken = res?.data?.accessToken || res?.data?.token;
    if (accessToken) {
      setAccessToken(accessToken);
    }
    const user = res?.data?.user;
    if (user) {
      handleAuthenticatedUserSession(user);
      return { success: true, user };
    }
    if (typeof window !== "undefined") {
      if (window.history && window.history.replaceState) {
        window.history.replaceState(null, "", "/#dashboard");
      } else {
        window.location.hash = "#dashboard";
      }
    }
    boot();
    return { success: true };
  } catch (err) {
    // Intercept MFA continuation responses (403 with MFA_REQUIRED / MFA_SETUP_REQUIRED)
    // MFA_REQUIRED is a continuation state, NOT an authentication failure or failed attempt.
    if (
      err?.code === "MFA_REQUIRED" ||
      err?.code === "MFA_SETUP_REQUIRED" ||
      err?.data?.mfaChallengeToken ||
      err?.data?.mfaSetupToken ||
      err?.data?.requiresMfa ||
      err?.data?.mfaRequired
    ) {
      const mfaChallengeToken = err?.data?.mfaChallengeToken || err?.data?.mfaSetupToken || err?.data?.tempToken || "";
      const isSetup = err?.code === "MFA_SETUP_REQUIRED" || Boolean(err?.data?.mfaSetupRequired);
      mountAuthScreen("mfa", {
        organisationId,
        email,
        challengeId: err?.data?.challengeId || err?.data?.userId || "",
        tempToken: mfaChallengeToken,
        mfaChallengeToken,
        mfaSetupRequired: isSetup,
        rememberDevice: Boolean(rememberDevice || err?.data?.rememberDevice),
      });
      return { mfaRequired: true };
    }

    throw err;
  }
}

function handleAuthenticatedUserSession(user) {
  abortActivePasskeyRequests();
  const { role, isPrimaryMaster } = resolveAuthenticatedRole(user);
  const landingRoute = (role === "staff") ? "staff-home" : "dashboard";

  let targetRoute = landingRoute;
  if (typeof window !== "undefined") {
    const searchParams = new URLSearchParams(window.location.search);
    const candidate = searchParams.get("returnTo") || searchParams.get("redirect") || searchParams.get("next");
    const safeTarget = getSafeInternalRedirect(candidate);
    if (safeTarget && isRouteAllowed(role, safeTarget, isPrimaryMaster)) {
      targetRoute = safeTarget;
    }
  }

  // Clear any residual dev/preview role overrides so the authenticated employee profile is strictly authoritative
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.removeItem("zamorin-dev-role");
      localStorage.setItem("zamorin_user", JSON.stringify(user));
    }
  } catch {}

  setSessionState(SessionState.AUTHENTICATED);

  setState({
    auth: { authenticated: true, user, loading: false },
    user,
    role,
    isPrimaryMaster,
    route: targetRoute,
  });

  if (typeof window !== "undefined") {
    if (window.history && window.history.replaceState) {
      // Transition browser out of /login into root single-page route
      window.history.replaceState(null, "", `/#${targetRoute}`);
    } else {
      window.location.hash = `#${targetRoute}`;
    }
  }

  renderShell();
  registerServiceWorker().catch(() => {});
}

function renderDevPreviewBanner() {
  document.getElementById("zamorin-dev-preview-banner")?.remove();
}

// =============================================================================
// LOADING SCREEN
// =============================================================================

function renderLoadingScreen() {
  const appEl =
    document.getElementById("app");

  if (!appEl) {
    return;
  }

  appEl.innerHTML = `
    <div
      style="
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        min-height: 100vh;
        font-family: sans-serif;
        background: #0b0f19;
        color: #f8fafc;
      "
    >
      <div
        style="
          width: 44px;
          height: 44px;
          border: 3px solid rgba(255,255,255,0.1);
          border-top-color: #d4a359;
          border-radius: 50%;
          animation: spin 0.8s linear infinite;
        "
      ></div>

      <p
        style="
          margin-top: 16px;
          color: #94a3b8;
          font-size: 14px;
          font-weight: 500;
        "
      >
        Loading Zamorin Café ERP...
      </p>

      <style>
        @keyframes spin {
          to {
            transform: rotate(360deg);
          }
        }
      </style>
    </div>
  `;
}

// =============================================================================
// STEP-UP AUTHENTICATION
// =============================================================================
//
// The historical development environment automatically approved step-up
// authentication.
//
// SECURITY REQUIREMENT:
// Never install that auto-approver on Vercel, staging, production,
// or another remote/public host.
//
// Production therefore retains apiClient.js's normal step-up behaviour.
// =============================================================================

if (isDirectDashboardAllowed()) {
  setStepUpAuthenticationHandler(
    async () => Promise.resolve()
  );
}

// =============================================================================
// AUTHENTICATED SESSION BOOT
// =============================================================================

function applyAuthenticatedUser(
  user,
  requestedRoute = ""
) {
  abortActivePasskeyRequests();
  const {
    role,
    isPrimaryMaster,
  } = resolveAuthenticatedRole(user);

  const roleNavigation =
    NAVIGATION[role] ||
    NAVIGATION.staff;

  const defaultRoute =
    roleNavigation?.items?.[0]?.route ||
    (
      role === "staff"
        ? "staff-home"
        : role === "vendor"
          ? "vendor-orders"
          : "dashboard"
    );

  const initialRoute =
    requestedRoute &&
    isRouteAllowed(
      role,
      requestedRoute,
      isPrimaryMaster
    )
      ? requestedRoute
      : defaultRoute;

  setState({
    auth: {
      authenticated: true,
      loading: false,
      user,
      authentication: null,
      error: null,
    },

    user,
    isPrimaryMaster,
    role,
    route: initialRoute,
  });

  try {
    if (typeof localStorage !== "undefined" && user) {
      localStorage.setItem("zamorin_user", JSON.stringify(user));
    }
  } catch {}

  return {
    role,
    isPrimaryMaster,
    initialRoute,
  };
}

// =============================================================================
// APPLICATION BOOT (FAST-PATH ZERO-LATENCY)
// =============================================================================

async function boot() {
  initLanguage();

  document.documentElement.setAttribute(
    "data-theme",
    state.settings.theme || "paper"
  );

  document.documentElement.setAttribute(
    "data-font-size",
    state.settings.fontSize || "normal"
  );

  // Permanently ensure no dev preview banner exists
  document.getElementById("zamorin-dev-preview-banner")?.remove();

  const urlHash =
    typeof window !== "undefined" && window.location.hash
      ? window.location.hash.replace(/^#/, "")
      : "";

  const params =
    typeof window !== "undefined"
      ? new URLSearchParams(window.location.search)
      : null;

  // Direct Café Access QR / Link / PIN Gateway Routing (P0-02, P0-02B, REC-03)
  const pathname = typeof window !== "undefined" ? window.location.pathname : "";
  const isCShortPath = pathname.startsWith("/c/") || urlHash.startsWith("c/");
  const isQrPath = isCShortPath || pathname.startsWith("/cafe-access/qr/") || urlHash.startsWith("cafe-access/qr/");
  const isLinkPath = pathname.startsWith("/cafe-access/link/") || urlHash.startsWith("cafe-access/link/");
  const isGatewayPath = pathname === "/cafe-gateway" || urlHash === "cafe-gateway";

  if (isQrPath || isLinkPath || isGatewayPath) {
    let token = null;
    if (pathname.startsWith("/c/")) token = pathname.slice("/c/".length);
    else if (urlHash.startsWith("c/")) token = urlHash.slice("c/".length);
    else if (pathname.startsWith("/cafe-access/qr/")) token = pathname.slice("/cafe-access/qr/".length);
    else if (urlHash.startsWith("cafe-access/qr/")) token = urlHash.slice("cafe-access/qr/".length);
    else if (pathname.startsWith("/cafe-access/link/")) token = pathname.slice("/cafe-access/link/".length);
    else if (urlHash.startsWith("cafe-access/link/")) token = urlHash.slice("cafe-access/link/".length);

    const method = isQrPath ? "QR" : isLinkPath ? "LINK" : null;

    mountPublicCafeGateway(document.getElementById("app"), { method, token });
    return;
  }

  // Direct Auth Screen Routing (0ms instant mount)
  // Handle /login2 alias -> redirect to canonical /login
  if (pathname === "/login2" || urlHash === "login2") {
    if (typeof window !== "undefined" && window.history && window.history.replaceState) {
      window.history.replaceState(null, "", "/login");
    }
  }

  // If already authenticated in memory, mount the app shell immediately
  if (state.auth?.authenticated && state.user) {
    if (pathname === "/login" || pathname === "/login2") {
      if (typeof window !== "undefined" && window.history && window.history.replaceState) {
        window.history.replaceState(null, "", `/#${state.route || "dashboard"}`);
      }
    }
    renderShell();
    registerServiceWorker().catch(() => {});
    return;
  }

  const isExplicitAppHash = Boolean(
    urlHash &&
    !["login", "login2", "forgot", "mfa", "register", "cafe-gateway"].includes(urlHash) &&
    !urlHash.startsWith("cafe-access/") &&
    !urlHash.startsWith("c/")
  );

  const isLoginRoute = !isExplicitAppHash && (
    urlHash === "login" ||
    urlHash === "login2" ||
    pathname === "/login" ||
    pathname === "/login2" ||
    params?.get("auth") === "login"
  );

  if (isLoginRoute) {
    mountAuthScreen("login");
    return;
  }
  if (urlHash === "forgot") {
    mountAuthScreen("forgot");
    return;
  }
  if (urlHash === "mfa") {
    mountAuthScreen("mfa");
    return;
  }

  // Active Authenticated Session Check (Authoritative Backend Session Validation via HttpOnly Cookies & In-Memory Bearer)
  try {
    const payload = await apiGet("/auth/me");
    if (payload?.data?.user) {
      applyAuthenticatedUser(payload.data.user, urlHash);
      if (pathname === "/login" || pathname === "/login2") {
        if (typeof window !== "undefined" && window.history && window.history.replaceState) {
          window.history.replaceState(null, "", `/#${urlHash || state.route || "dashboard"}`);
        }
      }
      renderShell();
      registerServiceWorker().catch(() => {});
      return;
    }
  } catch (_err) {
    clearAllAuthTokens();
  }

  // Local development / automated testing persona resolution
  if (isDirectDashboardAllowed() && (params?.get("role") || params?.get("devRole") || localStorage.getItem("zamorin-dev-role"))) {
    const devKey = getRequestedDevRole();
    if (!devKey || !DEV_PREVIEW_USERS[devKey]) {
      clearAllAuthTokens();
      setState({
        auth: {
          authenticated: false,
          loading: false,
          user: null,
          authentication: null,
          error: "The Normal Master persona has been permanently retired.",
        },
        user: null,
        isPrimaryMaster: false,
      });
      mountAuthScreen("login");
      return;
    }
    const devUser = DEV_PREVIEW_USERS[devKey];
    const canonicalRole = devKey;
    const isPrimary = Boolean(devUser?.isPrimaryMaster);
    const roleNavigation = NAVIGATION[canonicalRole] || NAVIGATION.master;
    const defaultRoute = roleNavigation?.items?.[0]?.route || (canonicalRole === "staff" ? "staff-home" : "dashboard");
    const initialRoute = urlHash ? (isRouteAllowed(canonicalRole, urlHash, isPrimary) ? urlHash : defaultRoute) : defaultRoute;

    setState({
      auth: {
        authenticated: true,
        loading: false,
        user: devUser,
        authentication: null,
        error: null,
      },
      user: devUser,
      isPrimaryMaster: isPrimary,
      role: canonicalRole,
      route: initialRoute,
    });

    renderShell();
    registerServiceWorker().catch(() => {});
    return;
  }

  // Unauthenticated: Mount login screen immediately with ZERO latency!
  clearAllAuthTokens();
  setState({
    auth: {
      authenticated: false,
      loading: false,
      user: null,
      authentication: null,
      error: null,
    },
    user: null,
    isPrimaryMaster: false,
  });

  mountAuthScreen("login");
  registerServiceWorker().catch(() => {});
}

// =============================================================================
// HASH ROUTING
// =============================================================================

if (typeof window !== "undefined") {
  window.addEventListener("hashchange", () => {
    abortActivePasskeyRequests();
    const rawHash = window.location.hash.replace(/^#/, "");
    if (rawHash === "login" || rawHash === "login2") {
      if (rawHash === "login2" && typeof window !== "undefined" && window.history && window.history.replaceState) {
        window.history.replaceState(null, "", "/login");
      }
      mountAuthScreen("login");
    } else if (rawHash === "forgot") {
      mountAuthScreen("forgot");
    } else if (rawHash === "mfa") {
      mountAuthScreen("mfa");
    } else if (rawHash === "cafe-gateway" || rawHash.startsWith("cafe-access/") || rawHash.startsWith("c/")) {
      const isCShort = rawHash.startsWith("c/");
      const isQr = isCShort || rawHash.startsWith("cafe-access/qr/");
      const isLink = rawHash.startsWith("cafe-access/link/");
      const token = isCShort ? rawHash.slice("c/".length) : isQr ? rawHash.slice("cafe-access/qr/".length) : isLink ? rawHash.slice("cafe-access/link/".length) : null;
      const method = isQr ? "QR" : isLink ? "LINK" : null;
      mountPublicCafeGateway(document.getElementById("app"), { method, token });
    } else if (rawHash && state.route !== rawHash) {
      navigate(rawHash);
    }
  });
}

// =============================================================================
// APPLICATION START
// =============================================================================

// Session expiry automatic routing to canonical Login 2.0
if (typeof window !== "undefined") {
  addSessionExpirationListener(() => {
    clearAllAuthTokens();
    setState({
      auth: { authenticated: false, loading: false, user: null, authentication: null, error: null },
      user: null,
      isPrimaryMaster: false,
      route: "login",
    });
    mountAuthScreen("login", { notice: "Your session has expired. Please sign in again." });
  });
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
}

