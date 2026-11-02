// =============================================================================
// ZAMORIN CAFE ERP — HIGH-PERFORMANCE AUTHENTICATED API CLIENT
// Features: Single-Flight Request Deduplication, SWR Client Cache,
// Automatic Mutation Invalidation, Stale Request Cancellation & Zero-Lag Transport.
// =============================================================================

import { state } from "./state.js";

const DEFAULT_API_BASE_URL =
  typeof globalThis.location !== "undefined" &&
  (globalThis.location.hostname === "localhost" || globalThis.location.hostname === "127.0.0.1")
    ? `http://${globalThis.location.hostname}:4000/api/v1`
    : "/api/v1";

function normalizeApiBaseUrl(value) {
  const candidate =
    typeof value === "string" && value.trim()
      ? value.trim()
      : DEFAULT_API_BASE_URL;

  return candidate.replace(/\/+$/, "");
}

export const API_BASE_URL = normalizeApiBaseUrl(
  globalThis.ZAMORIN_API_BASE_URL
);

const DEVICE_ID_STORAGE_KEY = "zamorin-device-id";
const ACCESS_TOKEN_STORAGE_KEY = "zamorin-access-token";
const SESSION_ID_STORAGE_KEY = "zamorin-session-id";
const REFRESH_TOKEN_STORAGE_KEY = "zamorin-refresh-token";

// Pure In-Memory Token Storage (Defense-in-depth: Tokens NEVER persist in localStorage)
let inMemoryAccessToken = null;
let inMemorySessionId = null;
let inMemoryCafeOpsDeviceToken = null;
let inMemoryCafeOpsSessionToken = null;

export function getAccessToken() {
  if (inMemoryAccessToken && typeof inMemoryAccessToken === "string" && inMemoryAccessToken.trim() && inMemoryAccessToken !== "undefined" && inMemoryAccessToken !== "null") {
    return inMemoryAccessToken.trim();
  }
  return null;
}

export function setAccessToken(token) {
  if (typeof token === "string" && token.trim() && token !== "undefined" && token !== "null") {
    inMemoryAccessToken = token.trim();
  } else {
    inMemoryAccessToken = null;
  }
  // Defensive Cleanup: Ensure no tokens remain in JavaScript-readable storage
  try {
    globalThis.sessionStorage?.removeItem(ACCESS_TOKEN_STORAGE_KEY);
    globalThis.localStorage?.removeItem(ACCESS_TOKEN_STORAGE_KEY);
  } catch {}
}

export function clearAccessToken() {
  inMemoryAccessToken = null;
  try {
    globalThis.sessionStorage?.removeItem(ACCESS_TOKEN_STORAGE_KEY);
    globalThis.localStorage?.removeItem(ACCESS_TOKEN_STORAGE_KEY);
  } catch {}
}

const CAFE_OPS_DEVICE_TOKEN_KEY = "zamorin-cafeops-device-token";
const CAFE_OPS_SESSION_TOKEN_KEY = "zamorin-cafeops-session-token";

export function getCafeOpsDeviceToken() {
  if (inMemoryCafeOpsDeviceToken && typeof inMemoryCafeOpsDeviceToken === "string" && inMemoryCafeOpsDeviceToken.trim()) {
    return inMemoryCafeOpsDeviceToken.trim();
  }
  try {
    const stored = globalThis.localStorage?.getItem(CAFE_OPS_DEVICE_TOKEN_KEY) || globalThis.sessionStorage?.getItem(CAFE_OPS_DEVICE_TOKEN_KEY);
    if (stored && typeof stored === "string" && stored.trim()) {
      inMemoryCafeOpsDeviceToken = stored.trim();
      return inMemoryCafeOpsDeviceToken;
    }
  } catch {}
  return null;
}

export function setCafeOpsDeviceToken(token) {
  if (typeof token === "string" && token.trim() && token !== "undefined" && token !== "null") {
    inMemoryCafeOpsDeviceToken = token.trim();
    try {
      globalThis.localStorage?.setItem(CAFE_OPS_DEVICE_TOKEN_KEY, inMemoryCafeOpsDeviceToken);
    } catch {}
  } else {
    inMemoryCafeOpsDeviceToken = null;
    try {
      globalThis.localStorage?.removeItem(CAFE_OPS_DEVICE_TOKEN_KEY);
      globalThis.sessionStorage?.removeItem(CAFE_OPS_DEVICE_TOKEN_KEY);
    } catch {}
  }
}

export function clearCafeOpsDeviceToken() {
  inMemoryCafeOpsDeviceToken = null;
  try {
    globalThis.localStorage?.removeItem(CAFE_OPS_DEVICE_TOKEN_KEY);
    globalThis.sessionStorage?.removeItem(CAFE_OPS_DEVICE_TOKEN_KEY);
  } catch {}
}

export function getCafeOpsSessionToken() {
  if (inMemoryCafeOpsSessionToken && typeof inMemoryCafeOpsSessionToken === "string" && inMemoryCafeOpsSessionToken.trim()) {
    return inMemoryCafeOpsSessionToken.trim();
  }
  try {
    const stored = globalThis.sessionStorage?.getItem(CAFE_OPS_SESSION_TOKEN_KEY);
    if (stored && typeof stored === "string" && stored.trim()) {
      inMemoryCafeOpsSessionToken = stored.trim();
      return inMemoryCafeOpsSessionToken;
    }
  } catch {}
  return null;
}

export function setCafeOpsSessionToken(token) {
  if (typeof token === "string" && token.trim() && token !== "undefined" && token !== "null") {
    inMemoryCafeOpsSessionToken = token.trim();
    try {
      globalThis.sessionStorage?.setItem(CAFE_OPS_SESSION_TOKEN_KEY, inMemoryCafeOpsSessionToken);
    } catch {}
  } else {
    inMemoryCafeOpsSessionToken = null;
    try {
      globalThis.sessionStorage?.removeItem(CAFE_OPS_SESSION_TOKEN_KEY);
    } catch {}
  }
}

export function clearCafeOpsSessionToken() {
  inMemoryCafeOpsSessionToken = null;
  try {
    globalThis.sessionStorage?.removeItem(CAFE_OPS_SESSION_TOKEN_KEY);
  } catch {}
}

export function getRefreshToken() {
  // Security Policy: Refresh tokens are transported via HttpOnly cookies; client-side JS persistence is strictly forbidden.
  return null;
}

export function setRefreshToken(_token) {
  // Security Policy: Refresh tokens are transported via HttpOnly cookies; client-side JS persistence is strictly forbidden.
  try {
    globalThis.localStorage?.removeItem(REFRESH_TOKEN_STORAGE_KEY);
    globalThis.sessionStorage?.removeItem(REFRESH_TOKEN_STORAGE_KEY);
  } catch {}
}

export function clearRefreshToken() {
  try {
    globalThis.localStorage?.removeItem(REFRESH_TOKEN_STORAGE_KEY);
    globalThis.sessionStorage?.removeItem(REFRESH_TOKEN_STORAGE_KEY);
  } catch {}
}

export function getSessionId() {
  if (inMemorySessionId && typeof inMemorySessionId === "string" && inMemorySessionId.trim() && inMemorySessionId !== "undefined" && inMemorySessionId !== "null") {
    return inMemorySessionId.trim();
  }
  return null;
}

export function setSessionId(id) {
  if (typeof id === "string" && id.trim() && id !== "undefined" && id !== "null") {
    inMemorySessionId = id.trim();
  } else {
    inMemorySessionId = null;
  }
  // Defensive Cleanup: Ensure session IDs do not linger in JavaScript-readable storage
  try {
    globalThis.sessionStorage?.removeItem(SESSION_ID_STORAGE_KEY);
    globalThis.localStorage?.removeItem(SESSION_ID_STORAGE_KEY);
  } catch {}
}

export function clearSessionId() {
  inMemorySessionId = null;
  try {
    globalThis.sessionStorage?.removeItem(SESSION_ID_STORAGE_KEY);
    globalThis.localStorage?.removeItem(SESSION_ID_STORAGE_KEY);
  } catch {}
}

export function clearAllAuthTokens() {
  inMemoryAccessToken = null;
  inMemorySessionId = null;
  inMemoryCafeOpsDeviceToken = null;
  inMemoryCafeOpsSessionToken = null;
  try {
    globalThis.localStorage?.removeItem(ACCESS_TOKEN_STORAGE_KEY);
    globalThis.sessionStorage?.removeItem(ACCESS_TOKEN_STORAGE_KEY);
    globalThis.localStorage?.removeItem(SESSION_ID_STORAGE_KEY);
    globalThis.sessionStorage?.removeItem(SESSION_ID_STORAGE_KEY);
    globalThis.localStorage?.removeItem(REFRESH_TOKEN_STORAGE_KEY);
    globalThis.sessionStorage?.removeItem(REFRESH_TOKEN_STORAGE_KEY);
    globalThis.sessionStorage?.removeItem(CAFE_OPS_SESSION_TOKEN_KEY);
  } catch {}
}

let stepUpAuthenticationHandler = null;
let singleFlightRefreshPromise = null;

// =============================================================================
// IN-FLIGHT GET DEDUPLICATION & CLIENT-SIDE READ CACHE
// =============================================================================
const MAX_CACHE_ENTRIES = 150;
const inFlightGetRequests = new Map();
const apiReadCache = new Map();

export const RequestScope = Object.freeze({
  ROUTE_OWNED: "ROUTE_OWNED",
  GLOBAL_APPLICATION: "GLOBAL_APPLICATION",
  USER_ACTION: "USER_ACTION",
  BACKGROUND_REVALIDATION: "BACKGROUND_REVALIDATION",
});

export const CachePolicy = Object.freeze({
  IMMUTABLE: "IMMUTABLE",           // 1 hour TTL (enum metadata, static schemas)
  SESSION_STATIC: "SESSION_STATIC", // 10 min TTL (cafes, user profile, role rules)
  SHORT_LIVED: "SHORT_LIVED",       // 30 sec TTL (entity lists, summaries)
  SWR: "SWR",                       // Stale-While-Revalidate (instant return + bg sync)
  SENSITIVE_NO_CACHE: "NO_CACHE",   // Never cache (Passbook balance, cash till, live mutations)
});

const DEFAULT_POLICY_MAP = [
  { prefix: "/passbook", policy: CachePolicy.SENSITIVE_NO_CACHE },
  { prefix: "/personal-ledger", policy: CachePolicy.SENSITIVE_NO_CACHE },
  { prefix: "/payroll/runs", policy: CachePolicy.SENSITIVE_NO_CACHE },
  { prefix: "/payroll/advances", policy: CachePolicy.SENSITIVE_NO_CACHE },
  { prefix: "/sales-cash", policy: CachePolicy.SENSITIVE_NO_CACHE },
  { prefix: "/pos", policy: CachePolicy.SENSITIVE_NO_CACHE },
  { prefix: "/finance/gl-journals", policy: CachePolicy.SENSITIVE_NO_CACHE },
  { prefix: "/cafe-operations/operator/sign-in", policy: CachePolicy.SENSITIVE_NO_CACHE },
  { prefix: "/cafe-device-state", policy: CachePolicy.SENSITIVE_NO_CACHE },
  { prefix: "/auth/refresh", policy: CachePolicy.SENSITIVE_NO_CACHE },
  { prefix: "/auth/step-up", policy: CachePolicy.SENSITIVE_NO_CACHE },
  { prefix: "/auth/login", policy: CachePolicy.SENSITIVE_NO_CACHE },
  { prefix: "/auth/me", policy: CachePolicy.SENSITIVE_NO_CACHE },
  { prefix: "/cafes", policy: CachePolicy.SESSION_STATIC },
  { prefix: "/reports/catalogue", policy: CachePolicy.SESSION_STATIC },
  { prefix: "/settings/system", policy: CachePolicy.SESSION_STATIC },
  { prefix: "/settings/diagnostics", policy: CachePolicy.SESSION_STATIC },
  { prefix: "/settings", policy: CachePolicy.SHORT_LIVED },
  { prefix: "/inventory", policy: CachePolicy.SHORT_LIVED },
  { prefix: "/procurement", policy: CachePolicy.SHORT_LIVED },
  { prefix: "/vendors", policy: CachePolicy.SHORT_LIVED },
  { prefix: "/customers", policy: CachePolicy.SHORT_LIVED },
  { prefix: "/employees", policy: CachePolicy.SHORT_LIVED },
  { prefix: "/bills", policy: CachePolicy.SHORT_LIVED },
  { prefix: "/expenses", policy: CachePolicy.SHORT_LIVED },
  { prefix: "/finance", policy: CachePolicy.SHORT_LIVED },
  { prefix: "/dashboard", policy: CachePolicy.SHORT_LIVED },
  { prefix: "/notifications", policy: CachePolicy.SHORT_LIVED },
  { prefix: "/tasks", policy: CachePolicy.SHORT_LIVED },
  { prefix: "/quality", policy: CachePolicy.SHORT_LIVED },
  { prefix: "/assets", policy: CachePolicy.SHORT_LIVED },
  { prefix: "/dept-orders", policy: CachePolicy.SHORT_LIVED },
  { prefix: "/menu", policy: CachePolicy.SHORT_LIVED },
  { prefix: "/revenue-share", policy: CachePolicy.SHORT_LIVED },
  { prefix: "/trash", policy: CachePolicy.SHORT_LIVED },
];

export function determineCachePolicy(path) {
  for (const rule of DEFAULT_POLICY_MAP) {
    if (path.startsWith(rule.prefix)) {
      return rule.policy;
    }
  }
  return CachePolicy.SHORT_LIVED;
}

export function getPolicyTTL(policy) {
  switch (policy) {
    case CachePolicy.IMMUTABLE:
      return 60 * 60 * 1000; // 1 hr
    case CachePolicy.SESSION_STATIC:
      return 10 * 60 * 1000; // 10 min
    case CachePolicy.SHORT_LIVED:
    case CachePolicy.SWR:
      return 30 * 1000; // 30 sec
    default:
      return 0;
  }
}

/**
 * Derives a complete security & tenant-scoped cache key.
 * Format: k:{orgId}::{userId}::{role}::{cafeId}::{deviceId}::{method}:{normalizedPath}
 */
export function generateCacheKey(path, options = {}) {
  const normalizedPath = normalizeApiPath(path);
  const orgId = options.organisationId || state?.auth?.user?.organisationId || state?.user?.organisationId || "ORG_DEFAULT";
  const userId = options.userId || state?.auth?.user?.userId || state?.user?.userId || "ANON";
  const role = options.role || state?.role || "GUEST";
  const cafeId = options.cafeId || state?.currentCafeId || (typeof localStorage !== "undefined" ? localStorage.getItem("zamorin_bound_cafe_id") : null) || "ALL";
  const deviceId = options.deviceId || getOrCreateDeviceId();
  const method = (options.method || "GET").toUpperCase();

  return `k:${orgId}::${userId}::${role}::${cafeId}::${deviceId}::${method}:${normalizedPath}`;
}

function setCacheEntry(key, data, ttl) {
  if (apiReadCache.size >= MAX_CACHE_ENTRIES) {
    // LRU eviction: delete oldest inserted key
    const oldestKey = apiReadCache.keys().next().value;
    if (oldestKey) {
      apiReadCache.delete(oldestKey);
    }
  }
  apiReadCache.set(key, {
    data,
    timestamp: Date.now(),
    ttl,
  });
}

export function clearApiCache(pathPrefix = null) {
  if (!pathPrefix) {
    apiReadCache.clear();
    return;
  }
  const norm = normalizeApiPath(pathPrefix);
  for (const key of apiReadCache.keys()) {
    const pathPart = key.split(/::(?:GET|POST|PUT|PATCH|DELETE):/)[1] || "";
    if (pathPart.startsWith(norm)) {
      apiReadCache.delete(key);
    }
  }
}

export function clearApiCacheAndInFlight() {
  apiReadCache.clear();
  inFlightGetRequests.clear();
  cancelPendingRouteReads();
}

export function invalidateRelatedCaches(mutationPath) {
  const norm = normalizeApiPath(mutationPath);
  if (norm.startsWith("/inventory")) {
    clearApiCache("/inventory");
    clearApiCache("/dashboard");
  } else if (norm.startsWith("/vendors") || norm.startsWith("/procurement")) {
    clearApiCache("/vendors");
    clearApiCache("/procurement");
    clearApiCache("/dashboard");
  } else if (norm.startsWith("/customers")) {
    clearApiCache("/customers");
    clearApiCache("/dashboard");
  } else if (norm.startsWith("/employees") || norm.startsWith("/payroll") || norm.startsWith("/attendance")) {
    clearApiCache("/employees");
    clearApiCache("/payroll");
    clearApiCache("/attendance");
    clearApiCache("/dashboard");
  } else if (norm.startsWith("/expenses") || norm.startsWith("/bills") || norm.startsWith("/finance")) {
    clearApiCache("/expenses");
    clearApiCache("/bills");
    clearApiCache("/finance");
    clearApiCache("/dashboard");
  } else if (norm.startsWith("/settings")) {
    clearApiCache("/settings");
  } else {
    // Evict direct path prefix
    clearApiCache(norm);
  }
}

// Active Route Abort Controller for Stale Navigation Cancellation
let activeRouteAbortController = null;

export function getRouteAbortSignal() {
  if (!activeRouteAbortController) {
    activeRouteAbortController = new AbortController();
  }
  return activeRouteAbortController.signal;
}

export function cancelPendingRouteReads() {
  if (activeRouteAbortController) {
    activeRouteAbortController.abort();
    activeRouteAbortController = new AbortController();
  }
}

export const SessionState = Object.freeze({
  INITIALISING: "INITIALISING",
  AUTHENTICATED: "AUTHENTICATED",
  REFRESHING: "REFRESHING",
  EXPIRED: "EXPIRED",
  SIGNED_OUT: "SIGNED_OUT",
  DEV_PREVIEW: "DEV_PREVIEW",
});

let currentSessionState = SessionState.AUTHENTICATED;
const sessionExpirationListeners = new Set();
let hasDispatchedSessionExpiryAlert = false;

export function getSessionState() {
  return currentSessionState;
}

export function addSessionExpirationListener(listener) {
  if (typeof listener === "function") {
    sessionExpirationListeners.add(listener);
  }
  return () => sessionExpirationListeners.delete(listener);
}

export function notifySessionExpired() {
  if (hasDispatchedSessionExpiryAlert) return;
  hasDispatchedSessionExpiryAlert = true;
  for (const listener of sessionExpirationListeners) {
    try {
      listener();
    } catch {}
  }
}

export function resetSessionExpiryAlert() {
  hasDispatchedSessionExpiryAlert = false;
}

export function setSessionState(newState) {
  if (Object.values(SessionState).includes(newState)) {
    currentSessionState = newState;
    if (newState === SessionState.AUTHENTICATED) {
      resetSessionExpiryAlert();
    } else if (newState === SessionState.EXPIRED || newState === SessionState.SIGNED_OUT) {
      notifySessionExpired();
    }
  }
}

export function setStepUpAuthenticationHandler(handler) {
  if (handler !== null && typeof handler !== "function") {
    throw new TypeError("Step-up authentication handler must be a function or null.");
  }
  stepUpAuthenticationHandler = handler;
}

let memoryCachedDeviceId = null;

export function getOrCreateDeviceId() {
  if (memoryCachedDeviceId) {
    return memoryCachedDeviceId;
  }
  try {
    const primary = globalThis.localStorage?.getItem(DEVICE_ID_STORAGE_KEY);
    if (primary && primary.trim()) {
      memoryCachedDeviceId = primary.trim();
      try { globalThis.localStorage?.setItem("zamorin_device_id", memoryCachedDeviceId); } catch {}
      return memoryCachedDeviceId;
    }
    const legacy = globalThis.localStorage?.getItem("zamorin_device_id");
    if (legacy && legacy.trim()) {
      memoryCachedDeviceId = legacy.trim();
      try { globalThis.localStorage?.setItem(DEVICE_ID_STORAGE_KEY, memoryCachedDeviceId); } catch {}
      return memoryCachedDeviceId;
    }
  } catch {}

  const cryptoApi = globalThis.crypto;
  let deviceId;

  if (typeof cryptoApi?.randomUUID === "function") {
    deviceId = cryptoApi.randomUUID();
  } else if (typeof cryptoApi?.getRandomValues === "function") {
    const bytes = new Uint8Array(16);
    cryptoApi.getRandomValues(bytes);
    deviceId = Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
  } else {
    deviceId = "dev-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
  }

  memoryCachedDeviceId = deviceId;
  try {
    globalThis.localStorage?.setItem(DEVICE_ID_STORAGE_KEY, deviceId);
    globalThis.localStorage?.setItem("zamorin_device_id", deviceId);
  } catch {}

  return deviceId;
}

export function getCanonicalDeviceId() {
  return getOrCreateDeviceId();
}

export function setCanonicalDeviceId(id) {
  if (typeof id === "string" && id.trim()) {
    const clean = id.trim();
    memoryCachedDeviceId = clean;
    try {
      globalThis.localStorage?.setItem(DEVICE_ID_STORAGE_KEY, clean);
      globalThis.localStorage?.setItem("zamorin_device_id", clean);
    } catch {}
  }
}

export const AUTH_REQUEST_TIMEOUT_MS = 60000;
export const DEFAULT_REQUEST_TIMEOUT_MS = 30000;

export class ApiClientError extends Error {
  constructor({
    status,
    code,
    message,
    userMessage = null,
    correlationId = null,
    data = null,
  }) {
    super(message);
    this.name = "ApiClientError";
    this.status = status;
    this.code = code;
    this.correlationId = correlationId;
    this.data = data;
    this.userMessage = userMessage || mapErrorToUserMessage(code, status, message);
  }

  get isAuthError() {
    return (
      this.status === 401 ||
      this.status === 403 ||
      this.code === "INVALID_CREDENTIALS" ||
      this.code === "AUTHENTICATION_REQUIRED" ||
      this.code === "AUTH_TOKEN_EXPIRED" ||
      this.code === "USER_UNAVAILABLE"
    );
  }

  get isNetworkError() {
    return this.status === 0 && (this.code === "NETWORK_UNAVAILABLE" || this.code === "FETCH_ERROR");
  }

  get isTimeoutError() {
    return this.status === 0 && (this.code === "REQUEST_TIMEOUT" || this.code === "TIMEOUT");
  }

  get isServerError() {
    return this.status >= 500 && this.status <= 599;
  }

  get errorCategory() {
    if (this.isAuthError) return "AUTH_ERROR";
    if (this.isTimeoutError) return "TIMEOUT";
    if (this.isNetworkError) return "NETWORK_ERROR";
    if (this.isServerError) return "SERVER_ERROR";
    return "CLIENT_ERROR";
  }
}

export function mapErrorToUserMessage(code, status, fallbackMessage) {
  const sanitizeFallback = (msg) => {
    if (!msg || typeof msg !== "string") return null;
    if (/MongoServerError|MongooseError|CastError|ValidationError|at\s+[\w\.]+\s+\(|\\Users\\|\/home\/|localhost|\.js:\d+/i.test(msg)) {
      return "The request could not be completed.";
    }
    return msg;
  };

  const safeFallback = sanitizeFallback(fallbackMessage);

  switch (code) {
    case "AUTH_TOKEN_EXPIRED":
    case "AUTH_TOKEN_INVALID":
    case "AUTH_TOKEN_NOT_ACTIVE":
    case "AUTH_SESSION_REVOKED":
    case "REFRESH_SESSION_REQUIRED":
    case "INVALID_OR_EXPIRED_SESSION":
    case "AUTHENTICATION_REQUIRED":
    case "AUTH_SESSION_INVALID":
    case "INVALID_CREDENTIALS":
      return "Your authenticated session could not be validated. Please sign in again.";
    case "ROLE_CHANGED":
      return "Your access role has changed. Please sign in again.";
    case "SECURITY_VERSION_CHANGED":
      return "Your security permissions have changed. Please sign in again.";
    case "USER_UNAVAILABLE":
      return "Your account is unavailable. Please contact an administrator.";
    case "STEP_UP_AUTHENTICATION_REQUIRED":
      return "Recent security verification is required for this action.";
    case "MFA_SETUP_REQUIRED":
      return "Multi-factor authentication setup is required for this account.";
    case "MFA_REQUIRED":
      return "Multi-factor authentication code is required.";
    case "PERMISSION_DENIED":
    case "FORBIDDEN":
    case "CAFE_ACCESS_DENIED":
      return "You do not have permission to perform this action.";
    case "NETWORK_UNAVAILABLE":
    case "FETCH_ERROR":
      return "The server could not be reached. Please check your network connection.";
    case "REQUEST_TIMEOUT":
    case "TIMEOUT":
      return "The server took too long to respond. Please check your connection and try again.";
    case "REQUEST_ABORTED":
      return "The request was cancelled.";
    case "INVALID_API_RESPONSE":
    case "API_CONTRACT_ERROR":
      return "The service returned an unexpected response. Please try again later.";
    case "DUPLICATE_KEY_CONFLICT":
    case "ATTENDANCE_ALREADY_EXISTS":
    case "USER_ALREADY_EXISTS":
    case "VENDOR_ALREADY_EXISTS":
    case "RECORD_CONFLICT":
      return safeFallback || "This record conflicts with existing data. Please refresh and try again.";
    case "EXPORT_FAILED":
      return "The export could not be generated. Please retry.";
    case "PAYLOAD_TOO_LARGE":
      return "The uploaded file or payload exceeds the allowed size limit.";
    case "VALIDATION_ERROR":
    case "INVALID_FORMAT":
      return safeFallback || "Please check your input values and try again.";
    case "RATE_LIMITED":
    case "TOO_MANY_REQUESTS":
      return "Too many requests. Please wait a moment before trying again.";
    default:
      if (status === 400) return safeFallback || "Please check your input values and try again.";
      if (status === 401) return "Your authenticated session could not be validated. Please sign in again.";
      if (status === 403) return "You do not have permission to perform this action.";
      if (status === 404) return "The requested record could not be found.";
      if (status === 408) return "The request timed out. Please check your connection and try again.";
      if (status === 409) return safeFallback || "This action conflicts with current records. Please refresh and try again.";
      if (status === 413) return "The payload exceeds the allowed size limit.";
      if (status === 422) return safeFallback || "The submitted data could not be processed. Please check the entered fields.";
      if (status === 429) return "Too many requests. Please wait a moment before trying again.";
      if (status === 502 || status === 503 || status === 504) return "The server is temporarily unreachable. Please try again in a few moments.";
      if (status >= 500) return "This service is temporarily unavailable. Please try again later.";
      return safeFallback || "The request could not be completed.";
  }
}

export function normalizeApiPath(path) {
  if (typeof path !== "string") {
    throw new TypeError("API paths must be strings.");
  }
  let clean = path.trim();
  if (!clean.startsWith("/")) clean = "/" + clean;

  if (clean.startsWith("/api/v1/")) {
    clean = clean.substring(7);
  } else if (clean === "/api/v1") {
    clean = "/";
  } else if (clean.startsWith("/api/")) {
    clean = clean.substring(4);
  }

  return clean;
}

async function readResponsePayload(response) {
  const contentType = response.headers.get("content-type") || "";

  if (response.status === 204) {
    return null;
  }

  const text = await response.text();
  if (!text) {
    return null;
  }

  if (contentType.includes("application/json") || contentType.includes("+json") || (text.startsWith("{") || text.startsWith("["))) {
    try {
      return JSON.parse(text);
    } catch {
      return {
        success: false,
        error: {
          code: "INVALID_API_RESPONSE",
          message: "The server returned an invalid JSON response.",
        },
      };
    }
  }

  if (contentType.includes("text/html") || text.startsWith("<!DOCTYPE") || text.startsWith("<html")) {
    return {
      success: false,
      error: {
        code: "INVALID_API_RESPONSE",
        message: `Endpoint returned HTML document (Status: ${response.status}).`,
      },
    };
  }

  return {
    success: response.ok,
    data: text,
  };
}

function createApiError(response, payload) {
  const code = payload?.error?.code || `HTTP_${response.status}`;
  const message = payload?.error?.message || "The request could not be completed.";

  return new ApiClientError({
    status: response.status,
    code,
    message,
    correlationId: payload?.correlationId || null,
    data: payload?.data || null,
  });
}

export async function performRequest(
  path,
  {
    method = "GET",
    signal,
    body,
    headers = {},
    timeoutMs,
  } = {}
) {
  const normalizedPath = normalizeApiPath(path);

  // Route-aware timeout: Auth, Recovery & Operator sign-in routes get 60s for Render cold starts
  const isAuthRoute =
    normalizedPath.startsWith("/auth/") ||
    normalizedPath.startsWith("/cafe-operations/operator/sign-in");
  const effectiveTimeoutMs =
    typeof timeoutMs === "number" && timeoutMs > 0
      ? timeoutMs
      : isAuthRoute
      ? AUTH_REQUEST_TIMEOUT_MS
      : DEFAULT_REQUEST_TIMEOUT_MS;

  // Setup internal timeout controller
  const timeoutCtrl = new AbortController();
  let timeoutId = null;
  let didTimeout = false;

  if (effectiveTimeoutMs > 0) {
    timeoutId = setTimeout(() => {
      didTimeout = true;
      timeoutCtrl.abort();
    }, effectiveTimeoutMs);
  }

  // Combine user signal and timeout signal
  const combinedHandler = () => {
    timeoutCtrl.abort();
  };
  if (signal) {
    if (signal.aborted) {
      timeoutCtrl.abort();
    } else {
      signal.addEventListener("abort", combinedHandler, { once: true });
    }
  }

  const token = getAccessToken();
  const cafeOpsDeviceToken = getCafeOpsDeviceToken();
  const cafeOpsSessionToken = getCafeOpsSessionToken();
  const requestHeaders = {
    Accept: "application/json, text/plain, */*",
    "x-device-id": getOrCreateDeviceId(),
  };

  if (token && typeof token === "string" && token.trim() && token !== "undefined" && token !== "null") {
    requestHeaders["Authorization"] = `Bearer ${token.trim()}`;
  }
  if (cafeOpsDeviceToken && typeof cafeOpsDeviceToken === "string" && cafeOpsDeviceToken.trim()) {
    requestHeaders["x-cafeops-device-token"] = cafeOpsDeviceToken.trim();
  }
  if (cafeOpsSessionToken && typeof cafeOpsSessionToken === "string" && cafeOpsSessionToken.trim()) {
    requestHeaders["x-cafeops-session-token"] = cafeOpsSessionToken.trim();
  }

  if (headers) {
    if (headers instanceof Headers) {
      for (const [k, v] of headers.entries()) {
        requestHeaders[k] = v;
      }
    } else if (typeof headers === "object") {
      for (const [k, v] of Object.entries(headers)) {
        if (v !== undefined && v !== null) {
          requestHeaders[k] = String(v);
        }
      }
    }
  }

  const isStringBody = typeof body === "string";
  let finalBody = body;
  if (!isStringBody && finalBody && typeof finalBody === "object" && !(finalBody instanceof FormData) && !(finalBody instanceof Blob)) {
    if (Object.keys(finalBody).length === 1 && finalBody.body && typeof finalBody.body === "object" && !(finalBody.body instanceof FormData) && !(finalBody.body instanceof Blob)) {
      finalBody = finalBody.body;
    }
  }

  const hasJsonBody = finalBody !== undefined && !(finalBody instanceof FormData) && !(finalBody instanceof Blob);
  const shouldStringify = !isStringBody && hasJsonBody;

  if (hasJsonBody) {
    requestHeaders["Content-Type"] = "application/json";
  }

  try {
    const res = await fetch(
      `${API_BASE_URL}${normalizedPath}`,
      {
        method,
        credentials: "include",
        cache: "no-store",
        headers: requestHeaders,
        body: shouldStringify
          ? JSON.stringify(finalBody)
          : finalBody,
        signal: timeoutCtrl.signal,
      }
    );
    return res;
  } catch (netErr) {
    if (didTimeout) {
      throw new ApiClientError({
        status: 0,
        code: "REQUEST_TIMEOUT",
        message: `The request timed out on the client after ${effectiveTimeoutMs}ms.`,
        userMessage: "The server took too long to respond. Please check your connection and try again.",
      });
    }
    if (signal?.aborted) {
      throw new ApiClientError({
        status: 0,
        code: "REQUEST_ABORTED",
        message: "The request was cancelled.",
        userMessage: "The request was cancelled.",
      });
    }
    throw new ApiClientError({
      status: 0,
      code: "NETWORK_UNAVAILABLE",
      message: netErr?.message || "Failed to fetch",
      userMessage: "The server could not be reached. Please check your connection.",
    });
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
    if (signal) signal.removeEventListener("abort", combinedHandler);
  }
}

export async function refreshAuthenticatedSession() {
  if (singleFlightRefreshPromise) {
    return singleFlightRefreshPromise;
  }

  singleFlightRefreshPromise = (async () => {
    try {
      setSessionState(SessionState.REFRESHING);
      const deviceId = getOrCreateDeviceId();

      const refreshHeaders = {
        "x-device-id": deviceId,
      };

      const response = await performRequest(
        "/auth/refresh",
        {
          method: "POST",
          headers: refreshHeaders,
        }
      );

      const payload = await readResponsePayload(response);

      if (!response.ok) {
        clearAllAuthTokens();
        setSessionState(SessionState.EXPIRED);
        throw createApiError(response, payload);
      }

      if (payload?.data?.accessToken) {
        setAccessToken(payload.data.accessToken);
      }
      if (payload?.data?.session?.sessionId) {
        setSessionId(payload.data.session.sessionId);
      }

      setSessionState(SessionState.AUTHENTICATED);
      return payload;
    } catch (err) {
      clearAllAuthTokens();
      setSessionState(SessionState.EXPIRED);
      throw err;
    } finally {
      singleFlightRefreshPromise = null;
    }
  })();

  return singleFlightRefreshPromise;
}

const NON_REFRESHABLE_AUTH_PATHS = new Set([
  "/auth/login",
  "/auth/refresh",
  "/auth/mfa/setup",
  "/auth/mfa/confirm",
  "/auth/mfa/verify",
  "/auth/password/change",
  "/auth/step-up",
  "/auth/passkeys/authenticate/options",
  "/auth/passkeys/authenticate/verify",
  "/auth/passkeys/register/options",
  "/auth/passkeys/register/verify",
  "/auth/app-pin/login",
  "/auth/password/reset-request",
  "/auth/password/reset-verify",
  "/auth/password/reset",
]);

export async function requestJson(
  method,
  path,
  {
    signal,
    body,
    headers = {},
    scope = RequestScope.ROUTE_OWNED,
    allowStepUpRetry = true,
    allowRefreshRetry = true,
    bypassCache = false,
    cachePolicy = null,
    timeoutMs,
  } = {}
) {
  const normalized = normalizeApiPath(path);
  const isGet = method.toUpperCase() === "GET";
  const policy = cachePolicy || determineCachePolicy(normalized);
  const cacheKey = generateCacheKey(path, { method });

  // Check Read Cache for GET
  if (isGet && !bypassCache && policy !== CachePolicy.SENSITIVE_NO_CACHE) {
    const cached = apiReadCache.get(cacheKey);
    const now = Date.now();
    if (cached && now - cached.timestamp < cached.ttl) {
      // SWR background refresh
      if (policy === CachePolicy.SWR || now - cached.timestamp > cached.ttl / 2) {
        queueMicrotask(() => {
          performRequest(path, { method: "GET", headers, timeoutMs }).then(async (res) => {
            if (res.ok) {
              const freshPayload = await readResponsePayload(res);
              setCacheEntry(cacheKey, freshPayload, getPolicyTTL(policy));
            }
          }).catch(() => {});
        });
      }
      return cached.data;
    }
  }

  // Single-Flight GET Request Deduplication
  if (isGet) {
    const activeFlight = inFlightGetRequests.get(cacheKey);
    if (activeFlight) {
      if (signal) {
        return new Promise((resolve, reject) => {
          const onAbort = () => {
            reject(new ApiClientError({
              status: 0,
              code: "REQUEST_ABORTED",
              message: "The request was cancelled.",
              userMessage: "The request was cancelled.",
            }));
          };
          if (signal.aborted) {
            return onAbort();
          }
          signal.addEventListener("abort", onAbort, { once: true });
          activeFlight.then(
            (val) => { signal.removeEventListener("abort", onAbort); resolve(val); },
            (err) => { signal.removeEventListener("abort", onAbort); reject(err); }
          );
        });
      }
      return activeFlight;
    }
  }

  const executionPromise = (async () => {
    let response = await performRequest(path, {
      method,
      signal: isGet ? undefined : signal, // Shared GET fetch is not aborted by single consumer
      body,
      headers,
      timeoutMs,
    });

    if (
      response.status === 401 &&
      allowRefreshRetry &&
      !normalized.startsWith("/auth/passkeys/") &&
      !normalized.startsWith("/auth/app-pin/") &&
      !NON_REFRESHABLE_AUTH_PATHS.has(normalized)
    ) {
      try {
        await refreshAuthenticatedSession();

        response = await performRequest(path, {
          method,
          signal: isGet ? undefined : signal,
          body,
        });
      } catch (refreshErr) {
        throw new ApiClientError({
          status: 401,
          code: "AUTH_SESSION_INVALID",
          message: "Authenticated session has expired.",
          userMessage: "Your authenticated session could not be validated. Please sign in again.",
        });
      }
    }

    const payload = await readResponsePayload(response);

    if (
      !response.ok &&
      response.status === 403 &&
      payload?.error?.code === "STEP_UP_AUTHENTICATION_REQUIRED" &&
      allowStepUpRetry &&
      normalized !== "/auth/step-up" &&
      typeof stepUpAuthenticationHandler === "function"
    ) {
      await stepUpAuthenticationHandler();

      return requestJson(method, path, {
        signal,
        body,
        scope,
        allowStepUpRetry: false,
        allowRefreshRetry,
      });
    }

    if (!response.ok) {
      if (response.status === 401) {
        const errCode = payload?.error?.code || '';
        if (errCode === 'SESSION_INVALID' || errCode === 'SESSION_EXPIRED' || errCode === 'GATEWAY_CONTEXT_EXPIRED' || normalized.startsWith('/cafe-ops/') || normalized.startsWith('/cafe-operations/')) {
          clearCafeOpsSessionToken();
        }
      }
      throw createApiError(response, payload);
    }

    // Invalidate relevant cache keys ONLY upon successful state mutation
    if (!isGet) {
      invalidateRelatedCaches(normalized);
    }

    // Cache successful GET responses according to policy
    if (isGet && policy !== CachePolicy.SENSITIVE_NO_CACHE) {
      setCacheEntry(cacheKey, payload, getPolicyTTL(policy));
    }

    return payload;
  })();

  if (isGet) {
    executionPromise.catch(() => {});
    inFlightGetRequests.set(cacheKey, executionPromise);
    // `finally()` returns a new promise that re-throws the original rejection.
    // Without a terminal catch that derived promise is unhandled and surfaces
    // as a window `unhandledrejection` (a pageerror) even when every caller
    // handles the request error. Clean up without leaking the rejection.
    executionPromise
      .then(
        () => inFlightGetRequests.delete(cacheKey),
        () => inFlightGetRequests.delete(cacheKey)
      );
  }

  if (signal) {
    return new Promise((resolve, reject) => {
      const onAbort = () => {
        reject(new ApiClientError({
          status: 0,
          code: "REQUEST_ABORTED",
          message: "The request was cancelled.",
          userMessage: "The request was cancelled.",
        }));
      };
      if (signal.aborted) {
        return onAbort();
      }
      signal.addEventListener("abort", onAbort, { once: true });
      executionPromise.then(
        (val) => { signal.removeEventListener("abort", onAbort); resolve(val); },
        (err) => { signal.removeEventListener("abort", onAbort); reject(err); }
      );
    });
  }

  return executionPromise;
}

export function apiGet(path, options = {}) {
  return requestJson("GET", path, options);
}

// Several call sites pass `{ body: {...} }` as the payload. Unwrap that single-key
// wrapper so the server receives the intended fields rather than a nested object.
function unwrapBodyWrapper(body) {
  if (
    body && typeof body === "object" && !Array.isArray(body) &&
    Object.keys(body).length === 1 && body.body && typeof body.body === "object" &&
    !(typeof FormData !== "undefined" && body instanceof FormData)
  ) {
    return body.body;
  }
  return body;
}

export function apiPost(path, body, options = {}) {
  return requestJson("POST", path, { ...options, body: unwrapBodyWrapper(body) });
}

export function apiPatch(path, body, options = {}) {
  return requestJson("PATCH", path, { ...options, body: unwrapBodyWrapper(body) });
}

export function apiPut(path, body, options = {}) {
  return requestJson("PUT", path, { ...options, body: unwrapBodyWrapper(body) });
}

export function apiDelete(path, options = {}) {
  return requestJson("DELETE", path, options);
}

export function apiJson(method, path, options = {}) {
  return requestJson(method, path, options);
}

export async function apiBlob(path, { signal, headers = {} } = {}) {
  const response = await performRequest(path, {
    method: "GET",
    signal,
    headers: {
      Accept: "application/pdf, application/vnd.openxmlformats-officedocument.spreadsheetml.sheet, application/octet-stream, */*",
      ...headers,
    },
  });

  if (!response.ok) {
    const payload = await readResponsePayload(response);
    throw createApiError(response, payload);
  }

  return await response.blob();
}

export async function downloadFile({
  url,
  filename = "zamorin_export.pdf",
  expectedMimeTypes = [],
  signal,
} = {}) {
  try {
    const blob = await apiBlob(url, { signal });

    if (expectedMimeTypes.length > 0 && blob.type) {
      const match = expectedMimeTypes.some((mime) => blob.type.includes(mime));
      if (!match && blob.type.includes("text/html")) {
        throw new ApiClientError({
          status: 500,
          code: "EXPORT_FAILED",
          message: "The export service returned an invalid document type.",
        });
      }
    }

    const objectUrl = globalThis.URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    setTimeout(() => {
      anchor.remove();
      globalThis.URL.revokeObjectURL(objectUrl);
    }, 1000);

    return true;
  } catch (err) {
    if (err instanceof ApiClientError) throw err;
    throw new ApiClientError({
      status: 500,
      code: "EXPORT_FAILED",
      message: err?.message || "File download failed.",
    });
  }
}

export async function apiUpload(path, formData, { signal, headers = {} } = {}) {
  if (!(formData instanceof FormData)) {
    throw new TypeError("apiUpload expects a FormData instance as body.");
  }

  const response = await performRequest(path, {
    method: "POST",
    signal,
    body: formData,
    headers: {
      ...headers,
    },
  });

  const payload = await readResponsePayload(response);

  if (!response.ok) {
    throw createApiError(response, payload);
  }

  return payload;
}

export const api = {
  get: apiGet,
  post: (path, body, options) => apiPost(path, body, options),
  put: (path, body, options) => apiPut(path, body, options),
  patch: (path, body, options) => apiPatch(path, body, options),
  delete: apiDelete,
};
