'use strict';

/**
 * UserPreference — server-side roaming account preference store.
 *
 * Persists personal UX preferences across authenticated devices so that
 * theme / language / density / accessibility preferences survive logout,
 * device changes and cache clears.
 *
 * DOES NOT store:
 *   - security configuration        → auth service / Session
 *   - employment / payroll data     → Employee / Payslip models
 *   - permission or role settings   → RolePermission / User
 *   - notification subscription     → handled inline (extend as needed)
 *   - organisation policy           → SystemCommunicationSettings
 *
 * Preference Precedence (resolved server-side):
 *   Organisation Policy > Role Policy > User Preference > Device Default
 */

const mongoose = require('mongoose');

// ── Locale / Language constants ────────────────────────────────────────────────
const SUPPORTED_LOCALES = [
  'en-IN',   // English (Default)
  'as-IN',   // Assamese
  'bn-IN',   // Bengali / Bangla
  'brx-IN',  // Bodo
  'doi-IN',  // Dogri
  'gu-IN',   // Gujarati
  'hi-IN',   // Hindi
  'kn-IN',   // Kannada
  'ks-IN',   // Kashmiri
  'kok-IN',  // Konkani
  'mai-IN',  // Maithili
  'ml-IN',   // Malayalam
  'mni-IN',  // Manipuri
  'mr-IN',   // Marathi
  'ne-IN',   // Nepali
  'or-IN',   // Odia
  'pa-IN',   // Punjabi
  'sa-IN',   // Sanskrit
  'sat-IN',  // Santali
  'sd-IN',   // Sindhi
  'ta-IN',   // Tamil
  'te-IN',   // Telugu
  'ur-IN',   // Urdu
];

const THEMES = ['paper', 'pearl', 'midnight', 'noir'];
const FONT_SIZES = ['small', 'standard', 'large', 'extra-large'];
const DENSITIES = ['comfortable', 'standard', 'compact'];
const TIME_FORMATS = ['12h', '24h'];
const DEFAULT_PAGE_OPTIONS = ['dashboard', 'pos', 'reports', 'employment'];

// ── Notification category matrix ──────────────────────────────────────────────
const NOTIFICATION_CATEGORIES = [
  'SECURITY',
  'PAYROLL',
  'ATTENDANCE',
  'FINANCE',
  'INVENTORY',
  'PROCUREMENT',
  'QUALITY',
  'REPORTS',
  'APPROVALS',
  'SYSTEM',
];

const NOTIFICATION_CHANNELS = ['IN_APP', 'PUSH', 'EMAIL', 'SMS'];

// ── Policy-locked notifications: cannot be disabled by any user ────────────────
const POLICY_REQUIRED_NOTIFICATIONS = new Set([
  'SECURITY:IN_APP',
  'SECURITY:EMAIL',
  'SYSTEM:IN_APP',
]);

const notificationPreferenceSchema = new mongoose.Schema(
  {
    category: {
      type: String,
      required: true,
      enum: NOTIFICATION_CATEGORIES,
    },
    channel: {
      type: String,
      required: true,
      enum: NOTIFICATION_CHANNELS,
    },
    enabled: {
      type: Boolean,
      default: true,
    },
    // Whether this channel × category combination is locked by policy
    policyLocked: {
      type: Boolean,
      default: false,
    },
  },
  { _id: false }
);

const accessibilityPrefsSchema = new mongoose.Schema(
  {
    reducedMotion: { type: Boolean, default: false },
    highContrast: { type: Boolean, default: false },
    enhancedFocus: { type: Boolean, default: false },
    increasedSpacing: { type: Boolean, default: false },
    underlineLinks: { type: Boolean, default: false },
    preferDataTables: { type: Boolean, default: false },
  },
  { _id: false }
);

const workspacePrefsSchema = new mongoose.Schema(
  {
    defaultLandingPage: {
      type: String,
      enum: DEFAULT_PAGE_OPTIONS,
      default: 'dashboard',
    },
    defaultCafeId: {
      type: String,
      trim: true,
      default: null,
    },
    rememberLastFilters: { type: Boolean, default: false },
    tablePageSize: {
      type: Number,
      enum: [25, 50, 100],
      default: 25,
    },
    defaultReportRange: {
      type: String,
      enum: ['today', 'month', 'current_fy'],
      default: 'today',
    },
    defaultExportFormat: {
      type: String,
      enum: ['PDF', 'XLSX'],
      default: 'PDF',
    },
    sidebarDefaultState: {
      type: String,
      enum: ['expanded', 'collapsed', 'remember'],
      default: 'remember',
    },
    pinnedModuleIds: {
      type: [String],
      default: [],
    },
  },
  { _id: false }
);

const userPreferenceSchema = new mongoose.Schema(
  {
    userId: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      uppercase: true,
      index: true,
    },

    organisationId: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
      index: true,
    },

    // ── Appearance ────────────────────────────────────────────────────────────
    theme: {
      type: String,
      enum: THEMES,
      default: 'paper',
    },

    fontSize: {
      type: String,
      enum: FONT_SIZES,
      default: 'standard',
    },

    density: {
      type: String,
      enum: DENSITIES,
      default: 'standard',
    },

    // ── Language & Region ─────────────────────────────────────────────────────
    locale: {
      type: String,
      enum: SUPPORTED_LOCALES,
      default: 'en-IN',
    },

    timeFormat: {
      type: String,
      enum: TIME_FORMATS,
      default: '12h',
    },

    // ── Accessibility ─────────────────────────────────────────────────────────
    accessibility: {
      type: accessibilityPrefsSchema,
      default: () => ({}),
    },

    // ── Notifications matrix ─────────────────────────────────────────────────
    notifications: {
      type: [notificationPreferenceSchema],
      default: [],
    },

    // ── Workspace ─────────────────────────────────────────────────────────────
    workspace: {
      type: workspacePrefsSchema,
      default: () => ({}),
    },

    // ── Schema version for migration safety ───────────────────────────────────
    schemaVersion: {
      type: Number,
      default: 1,
    },

    updatedAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: { createdAt: 'createdAt', updatedAt: 'updatedAt' },
    collection: 'user_preferences',
  }
);

userPreferenceSchema.statics.findOrCreateForUser = async function (userId, organisationId) {
  let pref = await this.findOne({ userId });
  if (!pref) {
    pref = await this.create({ userId, organisationId });
  }
  return pref;
};

userPreferenceSchema.statics.isNotificationPolicyLocked = function (category, channel) {
  return POLICY_REQUIRED_NOTIFICATIONS.has(`${category}:${channel}`);
};

const UserPreference = mongoose.model('UserPreference', userPreferenceSchema);

module.exports = {
  UserPreference,
  SUPPORTED_LOCALES,
  THEMES,
  FONT_SIZES,
  DENSITIES,
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_CHANNELS,
  POLICY_REQUIRED_NOTIFICATIONS,
};
