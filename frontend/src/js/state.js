// =============================================================================
// ZAMORIN CAFE ERP — APP STATE
// A deliberately tiny store: current role, current route, session, settings.
// =============================================================================

import { ROLES } from "./navigation.js";

const listeners = new Set();

export const state = {
  auth: {
    authenticated: false,
    loading: true,
    user: null,
    error: null,
  },
  session: {
    state: "AUTHENTICATED", // INITIALISING | AUTHENTICATED | REFRESHING | EXPIRED | SIGNED_OUT | DEV_PREVIEW
    deviceId: null,
    isOnline: typeof navigator !== "undefined" ? navigator.onLine : true,
    lastSync: Date.now(),
  },
  role: null, // Derived from backend authenticated identity (/auth/me)
  originalRole: null,
  activeWorkspace: null,
  supervisedEmployeeId: null,
  isTrainingMode: false,
  route: "dashboard",
  attendance: {
    status: "not_checked_in", // not_checked_in | checked_in | checked_out
    checkInAt: null,
    checkOutAt: null,
  },
  settings: {
    theme: (typeof localStorage !== "undefined" && (localStorage.getItem("zamorin-theme") || localStorage.getItem("zm-theme"))) || "azure",
    fontSize: (typeof localStorage !== "undefined" && localStorage.getItem("zamorin-font-size")) || "standard",
    language: "en",
    notifications: {
      roster: true,
      leave: true,
      payslip: false,
    },
  },
};

export function setState(patch) {
  Object.assign(state, patch);
  listeners.forEach((fn) => fn(state));
}

export function setSettings(patch) {
  Object.assign(state.settings, patch);
  listeners.forEach((fn) => fn(state));
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
