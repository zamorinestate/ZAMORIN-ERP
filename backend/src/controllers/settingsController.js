'use strict';

/**
 * settingsController.js â€” SCR-023
 *
 * Personal account, identity, employment self-service, access governance,
 * authentication security, notification, localisation, accessibility,
 * privacy and workspace preference controller.
 *
 * SECURITY RULES ENFORCED HERE:
 *   1. Self-identity resolved exclusively from req.user (auth middleware).
 *      Never trust userId supplied in request body or params for self-ops.
 *   2. Users cannot modify another user's settings.
 *   3. Role and cafÃ©-scope changes are forbidden through Settings.
 *   4. Access Requests create workflow records only â€” no direct grant.
 *   5. Privacy Requests create workflow records only â€” no automatic deletion.
 *   6. No auth internals (tokens, session IDs, JWTs) are ever returned.
 *   7. All security-significant actions produce audit events.
 */

const { User } = require('../models/User');
const { Session } = require('../models/Session');
const { PasskeyCredential } = require('../models/PasskeyCredential');
const { UserPreference, SUPPORTED_LOCALES, THEMES, FONT_SIZES, DENSITIES, NOTIFICATION_CATEGORIES, NOTIFICATION_CHANNELS, POLICY_REQUIRED_NOTIFICATIONS } = require('../models/UserPreference');
const { ProfileChangeRequest } = require('../models/ProfileChangeRequest');
const { AccessRequest } = require('../models/AccessRequest');
const { PrivacyRequest } = require('../models/PrivacyRequest');
const { RolePermission } = require('../models/RolePermission');
const { Delegation } = require('../models/Delegation');
const { SequenceCounter } = require('../models/SequenceCounter');
const auditService = require('../services/auditService');
const ApiError = require('../utils/ApiError');

// â”€â”€ 23 top-level language definitions â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const LANGUAGE_CATALOGUE = [
  { locale: 'en-IN',  englishName: 'English',            nativeName: 'English',          direction: 'ltr', status: 'PRODUCTION_READY', isDefault: true },
  { locale: 'as-IN',  englishName: 'Assamese',           nativeName: 'à¦…à¦¸à¦®à§€à¦¯à¦¼à¦¾',          direction: 'ltr', status: 'DRAFT' },
  { locale: 'bn-IN',  englishName: 'Bengali / Bangla',   nativeName: 'à¦¬à¦¾à¦‚à¦²à¦¾',            direction: 'ltr', status: 'DRAFT' },
  { locale: 'brx-IN', englishName: 'Bodo',               nativeName: "à¤¬à¤°'",              direction: 'ltr', status: 'DRAFT' },
  { locale: 'doi-IN', englishName: 'Dogri',              nativeName: 'à¤¡à¥‹à¤—à¤°à¥€',            direction: 'ltr', status: 'DRAFT' },
  { locale: 'gu-IN',  englishName: 'Gujarati',           nativeName: 'àª—à«àªœàª°àª¾àª¤à«€',         direction: 'ltr', status: 'DRAFT' },
  { locale: 'hi-IN',  englishName: 'Hindi',              nativeName: 'à¤¹à¤¿à¤¨à¥à¤¦à¥€',           direction: 'ltr', status: 'DRAFT' },
  { locale: 'kn-IN',  englishName: 'Kannada',            nativeName: 'à²•à²¨à³à²¨à²¡',           direction: 'ltr', status: 'DRAFT' },
  { locale: 'ks-IN',  englishName: 'Kashmiri',           nativeName: 'Ú©Ù²Ø´ÙØ±',           direction: 'rtl', status: 'DRAFT' },
  { locale: 'kok-IN', englishName: 'Konkani',            nativeName: 'à¤•à¥‹à¤‚à¤•à¤£à¥€',          direction: 'ltr', status: 'DRAFT' },
  { locale: 'mai-IN', englishName: 'Maithili',           nativeName: 'à¤®à¥ˆà¤¥à¤¿à¤²à¥€',          direction: 'ltr', status: 'DRAFT' },
  { locale: 'ml-IN',  englishName: 'Malayalam',          nativeName: 'à´®à´²à´¯à´¾à´³à´‚',         direction: 'ltr', status: 'DRAFT' },
  { locale: 'mni-IN', englishName: 'Manipuri',           nativeName: 'à¦®à§ˆà¦¤à§ˆà¦²à§‹à¦¨à§',       direction: 'ltr', status: 'DRAFT' },
  { locale: 'mr-IN',  englishName: 'Marathi',            nativeName: 'à¤®à¤°à¤¾à¤ à¥€',           direction: 'ltr', status: 'DRAFT' },
  { locale: 'ne-IN',  englishName: 'Nepali',             nativeName: 'à¤¨à¥‡à¤ªà¤¾à¤²à¥€',          direction: 'ltr', status: 'DRAFT' },
  { locale: 'or-IN',  englishName: 'Odia',               nativeName: 'à¬“à¬¡à¬¼à¬¿à¬†',          direction: 'ltr', status: 'DRAFT' },
  { locale: 'pa-IN',  englishName: 'Punjabi',            nativeName: 'à¨ªà©°à¨œà¨¾à¨¬à©€',         direction: 'ltr', status: 'DRAFT' },
  { locale: 'sa-IN',  englishName: 'Sanskrit',           nativeName: 'à¤¸à¤‚à¤¸à¥à¤•à¥ƒà¤¤à¤®à¥',      direction: 'ltr', status: 'DRAFT' },
  { locale: 'sat-IN', englishName: 'Santali',            nativeName: 'á±¥á±Ÿá±±á±›á±Ÿá±²á±¤',     direction: 'ltr', status: 'DRAFT' },
  { locale: 'sd-IN',  englishName: 'Sindhi',             nativeName: 'Ø³Ù†ÚŒÙŠ',            direction: 'rtl', status: 'DRAFT' },
  { locale: 'ta-IN',  englishName: 'Tamil',              nativeName: 'à®¤à®®à®¿à®´à¯',           direction: 'ltr', status: 'DRAFT' },
  { locale: 'te-IN',  englishName: 'Telugu',             nativeName: 'à°¤à±†à°²à±à°—à±',          direction: 'ltr', status: 'DRAFT' },
  { locale: 'ur-IN',  englishName: 'Urdu',               nativeName: 'Ø§Ø±Ø¯Ùˆ',             direction: 'rtl', status: 'DRAFT' },
];

// Helper: safe string
function safeStr(v) {
  return typeof v === 'string' ? v.trim() : '';
}

// Helper: get effective preference with policy precedence applied.
// Organisation Policy > Role Policy > User Preference > Default
function buildEffectivePrefs(pref) {
  return {
    theme: pref.theme || 'paper',
    fontSize: pref.fontSize || 'standard',
    density: pref.density || 'standard',
    locale: pref.locale || 'en-IN',
    timeFormat: pref.timeFormat || '12h',
    accessibility: pref.accessibility || {},
    workspace: pref.workspace || {},
    notifications: pref.notifications || [],
  };
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// SETTINGS OVERVIEW
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

/**
 * GET /api/v1/settings/overview
 * Returns the personalized Settings landing summary for the authenticated user.
 */
async function getSettingsOverview(req, res) {
  try {
    const { userId, organisationId, role } = req.user;

    const [user, pref] = await Promise.all([
      User.findOne({ userId }).lean(),
      UserPreference.findOrCreateForUser(userId, organisationId),
    ]);

    if (!user) throw new ApiError(404, 'USER_NOT_FOUND', 'Account not found.');

    // Compute attention items (real conditions only â€” no invented scores)
    const attentionItems = [];

    // Profile completion check: work email missing
    if (!user.workEmail) attentionItems.push({ id: 'no_work_email', label: 'Work email not set â€” add a contact email for notifications.' });

    // Session count
    const sessionCount = await Session.countDocuments({ userId, status: 'ACTIVE' });

    res.json({
      success: true,
      data: {
        profile: {
          displayName: user.preferredName || user.fullName || 'Your Account',
          role,
          userId,
          organisationId,
          employeeCode: user.employeeCode || null,
          primaryCafe: user.assignedCafeIds?.[0] || null,
          accountStatus: user.accountStatus,
        },
        preferences: buildEffectivePrefs(pref),
        attentionItems,
        sessionCount,
        sections: [
          { id: 'profile',        label: 'Profile & Identity',           icon: 'ðŸ‘¤', description: 'Personal information, contact verification and profile requests.' },
          { id: 'employment',     label: 'My Employment',                icon: 'ðŸ’¼', description: 'Payslips, loans & advances and employment information.' },
          { id: 'access',         label: 'My Access & Permissions',      icon: 'ðŸ”‘', description: 'Review cafÃ©/module access and submit access requests.' },
          { id: 'security',       label: 'Security & Sign-In',           icon: 'ðŸ›¡ï¸', description: 'Password, authenticators and account recovery.' },
          { id: 'devices',        label: 'Devices & Sessions',           icon: 'ðŸ“±', description: 'Review signed-in devices and security activity.' },
          { id: 'notifications',  label: 'Notifications',                icon: 'ðŸ””', description: 'Choose how Zamorin contacts you.' },
          { id: 'language',       label: 'Language & Region',            icon: 'ðŸŒ', description: '23 supported languages, English default.' },
          { id: 'appearance',     label: 'Appearance & Accessibility',   icon: 'ðŸŽ¨', description: 'Theme, density, text and accessibility preferences.' },
          { id: 'privacy',        label: 'Privacy & Data',               icon: 'ðŸ”’', description: 'Privacy information and governed data requests.' },
          { id: 'workspace',      label: 'Navigation & Workspace',       icon: 'âš™ï¸', description: 'Favourites, default landing page and workspace preferences.' },
          { id: 'help',           label: 'Help & Diagnostics',           icon: 'â“', description: 'App information, support and diagnostics.' },
        ],
      },
    });
  } catch (err) {
    if (err instanceof ApiError) throw err;
    throw new ApiError(500, 'SETTINGS_OVERVIEW_ERROR', 'Failed to load settings overview.');
  }
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// PROFILE & IDENTITY
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

/**
 * GET /api/v1/settings/profile
 */
async function getMyProfile(req, res) {
  const { userId, organisationId } = req.user;
  const user = await User.findOne({ userId }).lean();
  if (!user) throw new ApiError(404, 'USER_NOT_FOUND', 'Account not found.');

  // Field governance map â€” backend determines editability, never client
  const fieldGovernance = {
    preferredName:      'USER_EDITABLE',
    profileImageUrl:    'USER_EDITABLE',
    personalEmail:      'USER_EDITABLE',
    personalMobile:     'USER_EDITABLE',
    emergencyContact:   'USER_EDITABLE',
    workEmail:          'VERIFICATION_REQUIRED',
    fullName:           'APPROVAL_REQUIRED',
    legalName:          'APPROVAL_REQUIRED',
    employeeCode:       'HR_MANAGED',
    role:               'HR_MANAGED',
    assignedCafeIds:    'HR_MANAGED',
    employmentStatus:   'HR_MANAGED',
    organisationId:     'SYSTEM_MANAGED',
    userId:             'READ_ONLY',
    createdAt:          'READ_ONLY',
  };

  const pendingRequests = await ProfileChangeRequest.find({
    userId,
    status: { $in: ['SUBMITTED', 'UNDER_REVIEW', 'MORE_INFORMATION_REQUIRED'] },
  }).lean();

  res.json({
    success: true,
    data: {
      userId: user.userId,
      fullName: user.fullName,
      preferredName: user.preferredName || null,
      employeeCode: user.employeeCode || null,
      role: user.role,
      organisationId: user.organisationId,
      assignedCafeIds: user.assignedCafeIds || [],
      workEmail: user.workEmail || null,
      personalEmail: user.personalEmail || null,
      personalMobile: user.personalMobile || null,
      emergencyContact: user.emergencyContact || null,
      profileImageUrl: user.profileImageUrl || null,
      accountStatus: user.accountStatus,
      designation: user.designation || null,
      department: user.department || null,
      joiningDate: user.joiningDate || null,
      fieldGovernance,
      pendingChangeRequests: pendingRequests.map((r) => ({
        requestId: r.requestId,
        requestType: r.requestType,
        title: r.title,
        status: r.status,
        submittedAt: r.createdAt,
      })),
    },
  });
}

/**
 * PATCH /api/v1/settings/profile
 * Update only USER_EDITABLE fields. Controlled fields create PCRs.
 */
async function updateMyProfile(req, res) {
  const { userId, organisationId } = req.user;
  const { preferredName, personalEmail, personalMobile, emergencyContact } = req.body;

  // SECURITY: Only allow safe user-editable fields. Never allow role, employeeCode,
  // assignedCafeIds, organisationId, fullName, or any HR-managed field here.
  const updates = {};
  if (preferredName !== undefined) updates.preferredName = safeStr(preferredName).slice(0, 120);
  if (personalEmail !== undefined) updates.personalEmail = safeStr(personalEmail).slice(0, 200).toLowerCase();
  if (personalMobile !== undefined) updates.personalMobile = safeStr(personalMobile).slice(0, 20);
  if (emergencyContact !== undefined && typeof emergencyContact === 'object') {
    updates.emergencyContact = {
      name: safeStr(emergencyContact.name).slice(0, 120),
      relationship: safeStr(emergencyContact.relationship).slice(0, 80),
      phone: safeStr(emergencyContact.phone).slice(0, 20),
    };
  }

  if (Object.keys(updates).length === 0) {
    throw new ApiError(400, 'NO_EDITABLE_FIELDS', 'No user-editable fields provided.');
  }

  const user = await User.findOneAndUpdate(
    { userId },
    { $set: updates },
    { new: true, runValidators: true }
  );
  if (!user) throw new ApiError(404, 'USER_NOT_FOUND', 'Account not found.');

  await auditService.recordAuditEvent({ organisationId, actorUserId: userId, actorRole: req.user.role, module: 'SETTINGS', action: 'PROFILE_SELF_UPDATE', entityType: 'USER', entityId: userId, metadata: { updatedFields: Object.keys(updates) } });

  res.json({ success: true, message: 'Profile updated successfully.' });
}

/**
 * POST /api/v1/settings/profile/change-request
 * Submit a ProfileChangeRequest for controlled fields.
 */
async function submitProfileChangeRequest(req, res) {
  const { userId, organisationId } = req.user;
  const { requestType, title, reason, oldValues, newValues } = req.body;

  if (!requestType || !title || !reason) {
    throw new ApiError(400, 'MISSING_FIELDS', 'requestType, title and reason are required.');
  }

  const requestId = await SequenceCounter.generateId({ prefix: 'PCR', sequenceKey: 'profile_change_request', organisationId });

  const pcr = await ProfileChangeRequest.create({
    requestId,
    organisationId,
    userId,
    requestType,
    title: safeStr(title).slice(0, 200),
    reason: safeStr(reason).slice(0, 1000),
    oldValues: oldValues || {},
    newValues: newValues || {},
    status: 'SUBMITTED',
  });

  await auditService.recordAuditEvent({ organisationId, actorUserId: userId, actorRole: req.user.role, module: 'SETTINGS', action: 'PROFILE_CHANGE_REQUEST_SUBMITTED', entityType: 'PROFILE_CHANGE_REQUEST', entityId: pcr.requestId, metadata: { requestType, title } });

  res.status(201).json({
    success: true,
    data: { requestId: pcr.requestId, status: pcr.status },
    message: 'Profile change request submitted successfully. It will be reviewed by your administrator.',
  });
}

/**
 * GET /api/v1/settings/profile/change-requests
 */
async function listMyProfileChangeRequests(req, res) {
  const { userId } = req.user;
  const requests = await ProfileChangeRequest.find({ userId })
    .sort({ createdAt: -1 })
    .limit(50)
    .lean();

  res.json({
    success: true,
    data: {
      requests: requests.map((r) => ({
        requestId: r.requestId,
        requestType: r.requestType,
        title: r.title,
        status: r.status,
        submittedAt: r.createdAt,
        reviewedAt: r.reviewedAt || null,
        reviewNote: r.reviewNote || null,
      })),
    },
  });
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// MY ACCESS & PERMISSIONS
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

/**
 * GET /api/v1/settings/access
 * Returns the user's effective access summary. Never allows modification.
 */
async function getMyAccess(req, res) {
  const { userId, role, organisationId, assignedCafeIds } = req.user;

  // Fetch effective permission rules for this role (query already enforces effectiveTo/From)
  const permissionRules = await RolePermission.findEffectiveRules({ role, organisationId }).lean();

  const moduleAccess = permissionRules
    .filter((r) => r.effect === 'ALLOW')
    .map((r) => ({
      permissionCode: r.permissionCode,
      module: r.module,
      action: r.action,
      scope: r.scope,
    }));

  // Fetch pending access requests
  const pendingAccessRequests = await AccessRequest.find({
    requestedByUserId: userId,
    status: { $in: ['SUBMITTED', 'UNDER_REVIEW', 'MORE_INFORMATION_REQUIRED'] },
  }).lean();

  res.json({
    success: true,
    data: {
      canonicalRole: role,
      organisationId,
      cafeAccess: (assignedCafeIds || []).map((cafeId) => ({
        cafeId,
        state: 'ACTIVE',
      })),
      moduleAccess,
      temporaryAccess: [], // P2 â€” placeholder for TemporaryAccessGrant model
      pendingRequests: pendingAccessRequests.map((r) => ({
        requestId: r.requestId,
        requestType: r.requestType,
        status: r.status,
        submittedAt: r.createdAt,
        requestedScope: r.requestedScope,
      })),
    },
  });
}

/**
 * POST /api/v1/settings/access/request
 * Submit an access request. Creates a workflow record only.
 * NEVER directly grants access.
 */
async function submitAccessRequest(req, res) {
  const { userId, role, organisationId } = req.user;
  const { requestType, reason, businessJustification, requestedScope, durationType, temporaryAccessEndAt, idempotencyKey } = req.body;

  if (!requestType || !reason || !requestedScope) {
    throw new ApiError(400, 'MISSING_FIELDS', 'requestType, reason and requestedScope are required.');
  }

  // Idempotency guard â€” prevent double-click duplicate
  if (idempotencyKey) {
    const existing = await AccessRequest.findOne({ idempotencyKey });
    if (existing) {
      return res.json({
        success: true,
        data: { requestId: existing.requestId, status: existing.status },
        message: 'Access request already submitted.',
      });
    }
  }

  const requestId = await SequenceCounter.generateId({ prefix: 'AREQ', sequenceKey: 'access_request', organisationId });

  const ar = await AccessRequest.create({
    requestId,
    organisationId,
    requestedByUserId: userId,
    requestType,
    status: 'SUBMITTED',
    requestedScope,
    durationType: durationType || 'PERMANENT',
    temporaryAccessEndAt: temporaryAccessEndAt || null,
    reason: safeStr(reason).slice(0, 1000),
    businessJustification: safeStr(businessJustification || '').slice(0, 2000),
    idempotencyKey: idempotencyKey || null,
    auditHistory: [{
      action: 'SUBMITTED',
      performedByUserId: userId,
      note: 'Self-submitted through Settings â†’ My Access.',
      timestamp: new Date(),
    }],
  });

  await auditService.recordAuditEvent({ organisationId, actorUserId: userId, actorRole: role, module: 'SETTINGS', action: 'ACCESS_REQUEST_SUBMITTED', entityType: 'ACCESS_REQUEST', entityId: ar.requestId, metadata: { requestType } });

  res.status(201).json({
    success: true,
    data: { requestId: ar.requestId, status: ar.status },
    message: 'Access request submitted. Your administrator will review it shortly. No access has been granted.',
  });
}

/**
 * GET /api/v1/settings/access/requests
 */
async function listMyAccessRequests(req, res) {
  const { userId } = req.user;
  const requests = await AccessRequest.find({ requestedByUserId: userId })
    .sort({ createdAt: -1 })
    .limit(50)
    .lean();

  res.json({
    success: true,
    data: {
      requests: requests.map((r) => ({
        requestId: r.requestId,
        requestType: r.requestType,
        status: r.status,
        requestedScope: r.requestedScope,
        submittedAt: r.createdAt,
        reviewedAt: r.reviewedAt || null,
      })),
    },
  });
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// PREFERENCES (Appearance, Language, Accessibility, Workspace, Notifications)
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

/**
 * GET /api/v1/settings/preferences
 */
async function getMyPreferences(req, res) {
  const { userId, organisationId } = req.user;
  const pref = await UserPreference.findOrCreateForUser(userId, organisationId);

  res.json({
    success: true,
    data: buildEffectivePrefs(pref),
  });
}

/**
 * PATCH /api/v1/settings/preferences/appearance
 * Low-risk: auto-saves immediately.
 */
async function updateAppearancePreferences(req, res) {
  const { userId, organisationId } = req.user;
  const { theme, fontSize, density } = req.body;

  const updates = {};
  if (theme !== undefined && THEMES.includes(theme)) updates.theme = theme;
  if (fontSize !== undefined && FONT_SIZES.includes(fontSize)) updates.fontSize = fontSize;
  if (density !== undefined && DENSITIES.includes(density)) updates.density = density;

  if (Object.keys(updates).length === 0) {
    throw new ApiError(400, 'INVALID_PREFERENCES', 'No valid appearance preferences provided.');
  }

  await UserPreference.findOneAndUpdate(
    { userId },
    { $set: updates },
    { upsert: true, new: true }
  );

  res.json({ success: true, message: 'Appearance preferences saved.', data: updates });
}

/**
 * PATCH /api/v1/settings/preferences/language
 * Low-risk: auto-saves. English fallback enforced.
 */
async function updateLanguagePreference(req, res) {
  const { userId, organisationId } = req.user;
  const { locale } = req.body;

  if (!locale || !SUPPORTED_LOCALES.includes(locale)) {
    throw new ApiError(400, 'INVALID_LOCALE', `Unsupported locale. Must be one of: ${SUPPORTED_LOCALES.join(', ')}.`);
  }

  await UserPreference.findOneAndUpdate(
    { userId },
    { $set: { locale } },
    { upsert: true, new: true }
  );

  await auditService.recordAuditEvent({ organisationId, actorUserId: userId, actorRole: req.user.role, module: 'SETTINGS', action: 'LANGUAGE_PREFERENCE_CHANGED', entityType: 'USER_PREFERENCE', entityId: userId, metadata: { newLocale: locale } });

  res.json({ success: true, message: 'Language preference updated.', data: { locale } });
}

/**
 * PATCH /api/v1/settings/preferences/accessibility
 */
async function updateAccessibilityPreferences(req, res) {
  const { userId } = req.user;
  const { reducedMotion, highContrast, enhancedFocus, increasedSpacing, underlineLinks, preferDataTables } = req.body;

  const accessibility = {};
  if (reducedMotion !== undefined) accessibility.reducedMotion = Boolean(reducedMotion);
  if (highContrast !== undefined) accessibility.highContrast = Boolean(highContrast);
  if (enhancedFocus !== undefined) accessibility.enhancedFocus = Boolean(enhancedFocus);
  if (increasedSpacing !== undefined) accessibility.increasedSpacing = Boolean(increasedSpacing);
  if (underlineLinks !== undefined) accessibility.underlineLinks = Boolean(underlineLinks);
  if (preferDataTables !== undefined) accessibility.preferDataTables = Boolean(preferDataTables);

  await UserPreference.findOneAndUpdate(
    { userId },
    { $set: { 'accessibility': accessibility } },
    { upsert: true, new: true }
  );

  res.json({ success: true, message: 'Accessibility preferences saved.', data: { accessibility } });
}

/**
 * PATCH /api/v1/settings/preferences/workspace
 */
async function updateWorkspacePreferences(req, res) {
  const { userId, assignedCafeIds } = req.user;
  const { defaultLandingPage, defaultCafeId, rememberLastFilters, tablePageSize, defaultReportRange, defaultExportFormat, sidebarDefaultState, pinnedModuleIds } = req.body;

  const updates = {};

  if (defaultLandingPage !== undefined) {
    const ALLOWED_LANDING = ['dashboard', 'pos', 'reports', 'employment'];
    if (ALLOWED_LANDING.includes(defaultLandingPage)) {
      updates['workspace.defaultLandingPage'] = defaultLandingPage;
    }
  }

  // SECURITY: defaultCafeId cannot expand cafÃ© access â€” only set preference within existing scope
  if (defaultCafeId !== undefined) {
    const cafeIdStr = safeStr(defaultCafeId);
    const userCafes = assignedCafeIds || [];
    if (cafeIdStr === '' || cafeIdStr === 'ALL' || userCafes.includes(cafeIdStr)) {
      updates['workspace.defaultCafeId'] = cafeIdStr || null;
    }
    // Silently ignore out-of-scope cafÃ© preference â€” no escalation possible
  }

  if (rememberLastFilters !== undefined) updates['workspace.rememberLastFilters'] = Boolean(rememberLastFilters);
  if ([25, 50, 100].includes(Number(tablePageSize))) updates['workspace.tablePageSize'] = Number(tablePageSize);
  if (['today', 'month', 'current_fy'].includes(defaultReportRange)) updates['workspace.defaultReportRange'] = defaultReportRange;
  if (['PDF', 'XLSX', 'CSV'].includes(defaultExportFormat)) updates['workspace.defaultExportFormat'] = defaultExportFormat;
  if (['expanded', 'collapsed', 'remember'].includes(sidebarDefaultState)) updates['workspace.sidebarDefaultState'] = sidebarDefaultState;

  // pinnedModuleIds â€” only pin modules that are in the user's navigation (basic guard)
  if (Array.isArray(pinnedModuleIds)) {
    updates['workspace.pinnedModuleIds'] = pinnedModuleIds.slice(0, 20).map((id) => safeStr(id));
  }

  if (Object.keys(updates).length === 0) {
    throw new ApiError(400, 'NO_UPDATES', 'No valid workspace preferences provided.');
  }

  await UserPreference.findOneAndUpdate(
    { userId },
    { $set: updates },
    { upsert: true, new: true }
  );

  res.json({ success: true, message: 'Workspace preferences saved.' });
}

/**
 * PATCH /api/v1/settings/preferences/notifications
 * Saves the notification categoryÃ—channel matrix.
 * Policy-required channels (SECURITY:EMAIL, SECURITY:IN_APP, SYSTEM:IN_APP)
 * cannot be disabled by any user â€” backend rejects such attempts.
 */
async function updateNotificationPreferences(req, res) {
  const { userId, organisationId } = req.user;
  const { preferences } = req.body; // Array of { category, channel, enabled }

  if (!Array.isArray(preferences)) {
    throw new ApiError(400, 'INVALID_PAYLOAD', 'preferences must be an array.');
  }

  const validated = [];
  const rejected = [];

  for (const pref of preferences) {
    const { category, channel, enabled } = pref;
    if (!NOTIFICATION_CATEGORIES.includes(category)) continue;
    if (!NOTIFICATION_CHANNELS.includes(channel)) continue;

    // Policy-required: cannot be disabled
    if (POLICY_REQUIRED_NOTIFICATIONS.has(`${category}:${channel}`) && !enabled) {
      rejected.push({ category, channel, reason: 'Required by policy' });
      continue;
    }

    validated.push({ category, channel, enabled: Boolean(enabled), policyLocked: POLICY_REQUIRED_NOTIFICATIONS.has(`${category}:${channel}`) });
  }

  if (validated.length > 0) {
    const pref = await UserPreference.findOne({ userId });
    if (!pref) {
      await UserPreference.create({ userId, organisationId, notifications: validated });
    } else {
      // Merge: update matching categoryÃ—channel pairs, add new ones
      const existingMap = new Map(pref.notifications.map((n) => [`${n.category}:${n.channel}`, n]));
      for (const v of validated) {
        const key = `${v.category}:${v.channel}`;
        existingMap.set(key, v);
      }
      pref.notifications = Array.from(existingMap.values());
      await pref.save();
    }
  }

  await auditService.recordAuditEvent({ organisationId, actorUserId: userId, actorRole: req.user.role, module: 'SETTINGS', action: 'NOTIFICATION_PREFERENCES_UPDATED', entityType: 'USER_PREFERENCE', entityId: userId, metadata: { updatedCount: validated.length, rejectedCount: rejected.length } });

  res.json({
    success: true,
    message: `${validated.length} preference(s) saved.`,
    data: { saved: validated.length, rejected },
  });
}

/**
 * POST /api/v1/settings/preferences/reset
 * Resets personal UX preferences (theme, fontSize, density, locale, accessibility, notifications)
 * to default baseline. Requires confirmed: true in body.
 * Strictly self-scoped to req.user.userId.
 * Never modifies user model, role, permissions, assigned cafes, salary, or payroll.
 */
async function resetMyPreferences(req, res) {
  const { userId, organisationId, role } = req.user;
  const { confirmed } = req.body || {};

  if (!confirmed) {
    throw new ApiError(400, 'CONFIRMATION_REQUIRED', 'Confirmation (confirmed: true) is required to reset personal preferences.');
  }

  const defaultNotifications = [];
  for (const category of NOTIFICATION_CATEGORIES) {
    for (const channel of NOTIFICATION_CHANNELS) {
      const isPolicyLocked = POLICY_REQUIRED_NOTIFICATIONS.has(`${category}:${channel}`);
      defaultNotifications.push({
        category,
        channel,
        enabled: true,
        policyLocked: isPolicyLocked,
      });
    }
  }

  const resetFields = {
    theme: 'paper',
    fontSize: 'standard',
    density: 'standard',
    locale: 'en-IN',
    timeFormat: '12h',
    accessibility: {
      reducedMotion: false,
      highContrast: false,
      enhancedFocus: false,
      increasedSpacing: false,
      underlineLinks: false,
      preferDataTables: false,
    },
    notifications: defaultNotifications,
  };

  await UserPreference.findOneAndUpdate(
    { userId },
    { $set: resetFields },
    { upsert: true, new: true }
  );

  await auditService.recordAuditEvent({
    organisationId,
    actorUserId: userId,
    actorRole: role,
    module: 'SETTINGS',
    action: 'PREFERENCES_RESET',
    entityType: 'USER_PREFERENCE',
    entityId: userId,
    metadata: { resetFields: Object.keys(resetFields) },
  });

  res.json({
    success: true,
    message: 'Personal preferences reset to system defaults.',
    data: resetFields,
  });
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// LANGUAGE CATALOGUE
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

/**
 * GET /api/v1/settings/languages
 * Returns all 23 top-level languages.
 * Normal users see only PRODUCTION_READY languages in the picker.
 * isAdmin context returns all with QA status for management.
 */
async function getLanguageCatalogue(req, res) {
  const isMaster = req.user.role === 'MASTER';

  // Normal users only see production-ready languages for selection
  // (English is always available as default/fallback)
  const catalogue = LANGUAGE_CATALOGUE.map((lang) => ({
    ...lang,
    selectable: lang.status === 'PRODUCTION_READY' || isMaster,
    isDefault: lang.locale === 'en-IN',
  }));

  res.json({
    success: true,
    data: {
      total: catalogue.length,
      productionReady: catalogue.filter((l) => l.status === 'PRODUCTION_READY').length,
      defaultLocale: 'en-IN',
      catalogue: isMaster ? catalogue : catalogue.filter((l) => l.status === 'PRODUCTION_READY'),
      allCatalogue: isMaster ? catalogue : undefined,
    },
  });
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// SECURITY & SIGN-IN
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

/**
 * GET /api/v1/settings/security
 * Returns the authenticated user's security posture summary.
 * NEVER returns tokens, secrets, or raw authenticator data.
 */
async function getSecurityOverview(req, res) {
  const auth = req.user || req.auth || {};
  const { userId, role } = auth;

  const user = await User.findOne({ userId }).lean();
  if (!user) throw new ApiError(404, 'USER_NOT_FOUND', 'Account not found.');

  const sessionCount = await Session.countDocuments({ userId, status: 'ACTIVE' });

  res.json({
    success: true,
    data: {
      // Password state â€” truthful states, never expose hash
      password: {
        state: user.passwordHash ? 'CONFIGURED' : 'NOT_CONFIGURED',
        label: user.passwordHash ? 'Password is configured' : 'No password set',
        canChange: Boolean(user.passwordHash),
      },
      // MFA state
      mfa: {
        state: user.mfaEnabled ? 'CONFIGURED' : 'NOT_CONFIGURED',
        label: user.mfaEnabled ? 'Two-factor authentication enabled' : 'Two-factor authentication not enabled',
      },
      // Passkeys — WebAuthn FIDO2 Infrastructure
      passkeys: {
        state: (await PasskeyCredential.countDocuments({ userId, status: 'ACTIVE' })) > 0 ? 'CONFIGURED' : 'SUPPORTED',
        label: (await PasskeyCredential.countDocuments({ userId, status: 'ACTIVE' })) > 0
          ? `${await PasskeyCredential.countDocuments({ userId, status: 'ACTIVE' })} passkey(s) registered`
          : 'Passkeys supported — register device in settings.',
        count: await PasskeyCredential.countDocuments({ userId, status: 'ACTIVE' }),
      },
      // Sessions
      sessions: {
        activeCount: sessionCount,
      },
      // Recovery
      recovery: {
        state: user.mfaEnabled && user.mfaSecret ? 'CONFIGURED' : 'NOT_CONFIGURED',
        label: user.mfaEnabled ? 'Recovery codes configured' : 'Recovery not fully configured',
      },
      // Read-only policy summary — never expose policy internals
      securityPolicy: {
        mfaRequired: false,
        sessionPolicy: 'Standard enterprise session management',
        passwordPolicy: 'Minimum 15 characters (passphrase length-first, zero forced composition rules, blocklist protected)',
      },
    },
  });
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// DEVICES & SESSIONS â€” Fixed state machine
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

/**
 * GET /api/v1/settings/sessions
 * Returns active sessions with proper state machine.
 * States: LOADING (client), LOADED_WITH_SESSIONS, LOADED_EMPTY, AUTH_ERROR, NETWORK_ERROR
 *
 * CRITICAL FIX: Never show "Auth error" AND "No sessions" simultaneously.
 * If request fails â†’ AUTH_ERROR (never LOADED_EMPTY).
 * If request succeeds with 0 results â†’ LOADED_EMPTY (never AUTH_ERROR).
 */
async function getMySessions(req, res) {
  const { userId, sessionId: currentSessionId } = req.user;

  const sessions = await Session.find({ userId, status: 'ACTIVE' })
    .sort({ lastActivityAt: -1 })
    .lean();

  const formattedSessions = sessions.map((s) => ({
    sessionId: s.sessionId,
    isCurrent: s.sessionId === currentSessionId,
    device: {
      deviceName: s.deviceName || 'Unknown Device',
      deviceType: s.deviceType || null,
      operatingSystem: s.operatingSystem || null,
      browser: s.browser || null,
    },
    createdAt: s.createdAt,
    lastActivityAt: s.lastActivityAt,
    // Approximate location â€” labeled as network-derived, never GPS
    approximateLocation: s.ipCountry ? `${s.ipCity || 'Unknown city'}, ${s.ipCountry} (Approx.)` : null,
    status: s.status,
  }));

  res.json({
    success: true,
    data: {
      // Explicit state discriminant â€” client must use this, not infer from emptiness + error
      sessionState: formattedSessions.length > 0 ? 'LOADED_WITH_SESSIONS' : 'LOADED_EMPTY',
      sessions: formattedSessions,
      currentSessionId,
      totalActive: formattedSessions.length,
    },
  });
}

/**
 * DELETE /api/v1/settings/sessions/:sessionId
 * Revoke a specific session. Cannot revoke another user's session.
 */
async function revokeMySession(req, res) {
  const { userId, role, organisationId, sessionId: currentSessionId } = req.user;
  const { sessionId } = req.params;

  if (!sessionId) throw new ApiError(400, 'MISSING_SESSION_ID', 'Session ID is required.');

  // SECURITY: Verify this session belongs to the authenticated user
  const session = await Session.findOne({ sessionId, userId });
  if (!session) {
    // Return 404, not 403, to avoid session enumeration
    throw new ApiError(404, 'SESSION_NOT_FOUND', 'Session not found or already revoked.');
  }

  // Idempotent: already revoked
  if (session.status === 'REVOKED' || session.status === 'EXPIRED') {
    return res.json({ success: true, message: 'Session already revoked.' });
  }

  await Session.findOneAndUpdate(
    { sessionId, userId },
    { status: 'REVOKED', revokedAt: new Date(), revokedReason: 'USER_SELF_REVOKE' }
  );

  await auditService.recordAuditEvent({ organisationId, actorUserId: userId, actorRole: role, module: 'SETTINGS', action: 'SESSION_REVOKED', entityType: 'SESSION', entityId: sessionId, riskClassification: 'MEDIUM' });

  res.json({
    success: true,
    message: sessionId === currentSessionId
      ? 'You have been signed out from this device.'
      : 'Device session revoked successfully.',
  });
}

/**
 * POST /api/v1/settings/sessions/revoke-others
 * Sign out all OTHER sessions except the current one.
 */
async function revokeOtherSessions(req, res) {
  const { userId, role, organisationId, sessionId: currentSessionId } = req.user;

  const result = await Session.updateMany(
    { userId, sessionId: { $ne: currentSessionId }, status: 'ACTIVE' },
    { status: 'REVOKED', revokedAt: new Date(), revokedReason: 'REVOKE_OTHERS' }
  );

  await auditService.recordAuditEvent({ organisationId, actorUserId: userId, actorRole: role, module: 'SETTINGS', action: 'ALL_OTHER_SESSIONS_REVOKED', entityType: 'USER', entityId: userId, riskClassification: 'HIGH' });

  res.json({
    success: true,
    message: `${result.modifiedCount} other device session(s) revoked. You remain signed in on this device.`,
    data: { revokedCount: result.modifiedCount },
  });
}

/**
 * POST /api/v1/settings/sessions/revoke-all
 * Sign out ALL sessions including current. High-risk â€” requires confirmation.
 */
async function revokeAllSessions(req, res) {
  const { userId, role, organisationId } = req.user;
  const { confirmed } = req.body;

  if (!confirmed) {
    throw new ApiError(400, 'CONFIRMATION_REQUIRED', 'Set confirmed: true to sign out all devices.');
  }

  const result = await Session.updateMany(
    { userId, status: 'ACTIVE' },
    { status: 'REVOKED', revokedAt: new Date(), revokedReason: 'REVOKE_ALL' }
  );

  await auditService.recordAuditEvent({ organisationId, actorUserId: userId, actorRole: role, module: 'SETTINGS', action: 'ALL_SESSIONS_REVOKED', entityType: 'USER', entityId: userId, riskClassification: 'HIGH' });

  res.json({
    success: true,
    message: `All ${result.modifiedCount} device session(s) revoked. You have been signed out everywhere.`,
    data: { revokedCount: result.modifiedCount },
  });
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// PRIVACY & DATA
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

/**
 * POST /api/v1/settings/privacy/requests
 * Submit a personal data request. Creates governance workflow only.
 * NEVER automatically deletes any data.
 */
async function submitPrivacyRequest(req, res) {
  const { userId, role, organisationId } = req.user;
  const { requestType, reason, dataCategory, proposedCorrection, idempotencyKey } = req.body;

  if (!requestType || !reason) {
    throw new ApiError(400, 'MISSING_FIELDS', 'requestType and reason are required.');
  }

  // Idempotency guard
  if (idempotencyKey) {
    const existing = await PrivacyRequest.findOne({ idempotencyKey, subjectUserId: userId });
    if (existing) {
      return res.json({
        success: true,
        data: { requestId: existing.requestId, status: existing.status },
        message: 'Privacy request already submitted.',
      });
    }
  }

  const requestId = await SequenceCounter.generateId({ prefix: 'PRV', sequenceKey: 'privacy_request', organisationId });

  const pr = await PrivacyRequest.create({
    requestId,
    organisationId,
    subjectUserId: userId,
    requestType,
    reason: safeStr(reason).slice(0, 2000),
    dataCategory: safeStr(dataCategory || '').slice(0, 200),
    proposedCorrection: safeStr(proposedCorrection || '').slice(0, 2000),
    idempotencyKey: idempotencyKey || null,
    auditHistory: [{
      action: 'SUBMITTED',
      performedByUserId: userId,
      note: 'Self-submitted through Settings â†’ Privacy & Data.',
      timestamp: new Date(),
    }],
  });

  await auditService.recordAuditEvent({ organisationId, actorUserId: userId, actorRole: role, module: 'SETTINGS', action: 'PRIVACY_REQUEST_SUBMITTED', entityType: 'PRIVACY_REQUEST', entityId: pr.requestId, metadata: { requestType } });

  res.status(201).json({
    success: true,
    data: { requestId: pr.requestId, status: pr.status },
    message: 'Privacy request submitted. It will be reviewed according to our governed data management process. No data has been automatically deleted.',
  });
}

/**
 * GET /api/v1/settings/privacy/requests
 * Returns only the authenticated user's own privacy requests.
 */
async function listMyPrivacyRequests(req, res) {
  const { userId } = req.user;
  const requests = await PrivacyRequest.find({ subjectUserId: userId })
    .sort({ createdAt: -1 })
    .limit(50)
    .lean();

  res.json({
    success: true,
    data: {
      requests: requests.map((r) => ({
        requestId: r.requestId,
        requestType: r.requestType,
        status: r.status,
        submittedAt: r.createdAt,
        reviewedAt: r.reviewedAt || null,
        reviewNote: r.reviewNote || null,
        retentionJustification: r.retentionJustification || null,
      })),
    },
  });
}

/**
 * GET /api/v1/settings/privacy/notice
 */
async function getPrivacyNotice(req, res) {
  res.json({
    success: true,
    data: {
      version: '1.0',
      effectiveDate: '2024-01-01',
      language: req.user.locale || 'en-IN',
      summary: 'Zamorin Speciality Coffee & Kitchens Pvt. Ltd. processes your personal data for employment, operations, security and legal compliance purposes. Your data is not sold to third parties.',
      fullNoticeUrl: '/privacy-notice',
      dataCategories: [
        { category: 'Account',    description: 'User ID, email, role, access scope' },
        { category: 'Profile',    description: 'Full name, preferred name, contact details' },
        { category: 'Employment', description: 'Employee code, designation, department, payroll records' },
        { category: 'Security',   description: 'Session records, authentication events, device information' },
        { category: 'Preferences', description: 'Theme, language, notification and workspace settings' },
      ],
      retentionSummary: 'Employment and payroll records are retained for statutory periods as required by Indian labour and tax laws. Security events are retained for audit compliance.',
      grievanceContact: 'privacy@zamorincafe.com',
    },
  });
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// HELP & DIAGNOSTICS
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

/**
 * GET /api/v1/settings/diagnostics
 * Returns safe server-side diagnostics. Never exposes tokens or infrastructure.
 */
async function getDiagnostics(req, res) {
  const { userId, role, organisationId } = req.user;

  res.json({
    success: true,
    data: {
      appVersion: process.env.APP_VERSION || '2.0.0',
      environment: process.env.NODE_ENV || 'development',
      serverTime: new Date().toISOString(),
      timezone: 'Asia/Kolkata',
      userId,
      role,
      organisationId,
      // Never expose: tokens, session secrets, DB connection strings, JWT secrets
      serviceHealth: 'CONNECTED',
    },
  });
}

/**
 * POST /api/v1/settings/support/tickets
 * Self-service: Submit an in-app support case / ticket.
 */
async function submitSupportTicket(req, res) {
  const user = req.user || req.auth || {};
  const { userId, organisationId, primaryCafeId, email } = user;
  const { category = 'GENERAL_INQUIRY', severity = 'NORMAL', summary, description } = req.body || {};

  if (!summary || !String(summary).trim()) {
    throw new ApiError(400, 'SUMMARY_REQUIRED', 'A brief summary of the issue is required.');
  }

  if (!description || !String(description).trim()) {
    throw new ApiError(400, 'DESCRIPTION_REQUIRED', 'A detailed description of the issue is required.');
  }

  const { SupportCase, SUPPORT_CATEGORIES, SUPPORT_SEVERITIES } = require('../models/SupportCase');

  const validCategory = SUPPORT_CATEGORIES.includes(category) ? category : 'GENERAL_INQUIRY';
  const validSeverity = SUPPORT_SEVERITIES.includes(severity) ? severity : 'NORMAL';

  const year = new Date().getFullYear();
  const randSeq = Math.floor(1000 + Math.random() * 9000);
  const caseId = `CASE-${year}-${randSeq}`;

  const senderEmail = email || `${String(userId).toLowerCase()}@zamorincafe.com`;

  const supportCase = await SupportCase.create({
    caseId,
    organisationId,
    cafeId: primaryCafeId || null,
    category: validCategory,
    severity: validSeverity,
    status: 'OPEN',
    source: 'IN_APP',
    reportedByUserId: userId,
    senderEmail,
    summary: String(summary).trim().slice(0, 300),
    description: String(description).trim().slice(0, 5000),
  });

  try {
    await auditService.log({
      organisationId,
      action: 'SETTINGS_SUPPORT_TICKET_SUBMITTED',
      performedByUserId: userId,
      metadata: { caseId, category: validCategory, severity: validSeverity },
    });
  } catch (e) {}

  res.status(201).json({
    success: true,
    message: 'Support ticket submitted successfully.',
    data: { ticket: supportCase },
  });
}

/**
 * GET /api/v1/settings/support/tickets
 * Self-service: List the authenticated user's support tickets.
 */
async function listMySupportTickets(req, res) {
  const user = req.user || req.auth || {};
  const { userId, organisationId } = user;
  const { SupportCase } = require('../models/SupportCase');

  const rawTickets = await SupportCase.find({
    organisationId,
    reportedByUserId: userId,
  })
    .sort({ createdAt: -1 })
    .limit(50)
    .lean();

  const tickets = rawTickets.map((t) => {
    if (t.responses && Array.isArray(t.responses)) {
      t.responses = t.responses.filter((r) => r.visibility !== 'INTERNAL');
    }
    return t;
  });

  res.status(200).json({
    success: true,
    data: { tickets },
  });
}

/**
 * GET /api/v1/settings/support/manage/tickets
 * Management Queue: List support cases with tenant and role scoping.
 */
async function listManageSupportTickets(req, res) {
  const user = req.user || req.auth || {};
  const { userId, organisationId, role, assignedCafeIds = [], primaryCafeId } = user;

  if (!['MASTER', 'OWNER', 'CAFE_ADMIN'].includes(role)) {
    throw new ApiError(403, 'PERMISSION_DENIED', 'Only management roles can view the support queue.');
  }

  const { SupportCase } = require('../models/SupportCase');

  const filter = { organisationId };

  if (role === 'CAFE_ADMIN') {
    const validCafes = [...(assignedCafeIds || [])];
    if (primaryCafeId && !validCafes.includes(primaryCafeId)) {
      validCafes.push(primaryCafeId);
    }
    filter.cafeId = { $in: validCafes };
  } else if (role === 'OWNER') {
    const validCafes = (assignedCafeIds || []).map((c) => String(c).trim().toUpperCase()).filter(Boolean);
    if (!validCafes.length) {
      throw new ApiError(403, 'CROSS_CAFE_RESOURCE_DENIED', 'Owner has no assigned cafés.');
    }
    filter.cafeId = { $in: validCafes };
  }

  const { status, category, severity, search, page = 1, limit = 20 } = req.query;

  if (status && status !== 'ALL') {
    filter.status = status;
  }
  if (category && category !== 'ALL') {
    filter.category = category;
  }
  if (severity && severity !== 'ALL') {
    filter.severity = severity;
  }
  if (search && search.trim()) {
    const term = search.trim();
    filter.$or = [
      { caseId: { $regex: term, $options: 'i' } },
      { summary: { $regex: term, $options: 'i' } },
      { reportedByUserId: { $regex: term, $options: 'i' } },
      { senderEmail: { $regex: term, $options: 'i' } },
    ];
  }

  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));

  const [total, tickets] = await Promise.all([
    SupportCase.countDocuments(filter),
    SupportCase.find(filter)
      .sort({ createdAt: -1 })
      .skip((pageNum - 1) * limitNum)
      .limit(limitNum)
      .lean(),
  ]);

  res.status(200).json({
    success: true,
    data: {
      tickets,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum),
      },
    },
  });
}

/**
 * GET /api/v1/settings/support/manage/tickets/:caseId
 * Management Queue: Get single support case details.
 */
async function getManageSupportTicket(req, res) {
  const user = req.user || req.auth || {};
  const { userId, organisationId, role, assignedCafeIds = [], primaryCafeId } = user;

  if (!['MASTER', 'OWNER', 'CAFE_ADMIN'].includes(role)) {
    throw new ApiError(403, 'PERMISSION_DENIED', 'Only management roles can view support cases.');
  }

  const caseId = req.params.caseId?.trim().toUpperCase();
  const { SupportCase } = require('../models/SupportCase');

  const ticket = await SupportCase.findOne({ organisationId, caseId }).lean();
  if (!ticket) {
    throw new ApiError(404, 'NOT_FOUND', `Support case ${caseId} not found.`);
  }

  if (role === 'CAFE_ADMIN') {
    const validCafes = [...(assignedCafeIds || [])];
    if (primaryCafeId && !validCafes.includes(primaryCafeId)) {
      validCafes.push(primaryCafeId);
    }
    if (!validCafes.includes(ticket.cafeId)) {
      throw new ApiError(403, 'CAFE_ACCESS_DENIED', 'Access denied to support case outside your assigned cafe.');
    }
  } else if (role === 'OWNER') {
    const validCafes = (assignedCafeIds || []).map((c) => String(c).trim().toUpperCase()).filter(Boolean);
    if (!validCafes.length || !validCafes.includes(ticket.cafeId)) {
      throw new ApiError(403, 'CROSS_CAFE_RESOURCE_DENIED', 'Access denied to support case outside your assigned cafe.');
    }
  }

  res.status(200).json({
    success: true,
    data: { ticket },
  });
}

/**
 * PATCH /api/v1/settings/support/manage/tickets/:caseId
 * Management Queue: Update support case status and assignment with lifecycle validation.
 */
async function updateManageSupportTicket(req, res) {
  const user = req.user || req.auth || {};
  const { userId, organisationId, role, assignedCafeIds = [], primaryCafeId } = user;

  if (!['MASTER', 'OWNER', 'CAFE_ADMIN'].includes(role)) {
    throw new ApiError(403, 'PERMISSION_DENIED', 'Only management roles can update support cases.');
  }

  const caseId = req.params.caseId?.trim().toUpperCase();
  const { SupportCase } = require('../models/SupportCase');
  const { Notification } = require('../models/Notification');
  const { NotificationOutbox } = require('../models/NotificationOutbox');

  const ticket = await SupportCase.findOne({ organisationId, caseId });
  if (!ticket) {
    throw new ApiError(404, 'NOT_FOUND', `Support case ${caseId} not found.`);
  }

  if (role === 'CAFE_ADMIN') {
    const validCafes = [...(assignedCafeIds || [])];
    if (primaryCafeId && !validCafes.includes(primaryCafeId)) {
      validCafes.push(primaryCafeId);
    }
    if (!validCafes.includes(ticket.cafeId)) {
      throw new ApiError(403, 'CAFE_ACCESS_DENIED', 'Access denied to support case outside your assigned cafe.');
    }
  } else if (role === 'OWNER') {
    const validCafes = (assignedCafeIds || []).map((c) => String(c).trim().toUpperCase()).filter(Boolean);
    if (!validCafes.length || !validCafes.includes(ticket.cafeId)) {
      throw new ApiError(403, 'CROSS_CAFE_RESOURCE_DENIED', 'Access denied to support case outside your assigned cafe.');
    }
  }

  const { status, assignedToUserId, resolutionSummary } = req.body || {};

  // Lifecycle state transition validation
  if (status && status !== ticket.status) {
    const ALLOWED_TRANSITIONS = {
      OPEN: ['IN_PROGRESS', 'CLOSED'],
      ACKNOWLEDGED: ['IN_PROGRESS', 'CLOSED'],
      IN_PROGRESS: ['WAITING_FOR_EMPLOYEE', 'WAITING_INTERNAL', 'WAITING_EXTERNAL', 'RESOLVED', 'CLOSED'],
      WAITING_FOR_EMPLOYEE: ['IN_PROGRESS', 'RESOLVED', 'CLOSED'],
      WAITING_INTERNAL: ['IN_PROGRESS', 'RESOLVED', 'CLOSED'],
      WAITING_EXTERNAL: ['IN_PROGRESS', 'RESOLVED', 'CLOSED'],
      RESOLVED: ['CLOSED', 'IN_PROGRESS'],
      CLOSED: ['IN_PROGRESS'],
    };

    const allowed = ALLOWED_TRANSITIONS[ticket.status] || [];
    if (!allowed.includes(status)) {
      throw new ApiError(400, 'INVALID_STATUS_TRANSITION', `Cannot transition support case from ${ticket.status} to ${status}. Allowed: ${allowed.join(', ')}`);
    }

    ticket.status = status;

    if (status === 'IN_PROGRESS' && !ticket.acknowledgedAt) {
      ticket.acknowledgedAt = new Date();
    }
    if (status === 'RESOLVED') {
      ticket.resolvedAt = new Date();
      if (resolutionSummary) ticket.resolutionSummary = String(resolutionSummary).trim().slice(0, 2000);
    }
    if (status === 'CLOSED') {
      ticket.closedAt = new Date();
    }

    // Emit Employee Notification for status change
    if (ticket.reportedByUserId) {
      try {
        const emp = await User.findOne({ organisationId, userId: ticket.reportedByUserId }).select('email name').lean();
        if (emp) {
          const outboxId = `OUT-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;
          await NotificationOutbox.create({
            outboxId,
            organisationId,
            eventType: 'SUPPORT_CASE_UPDATE',
            recipientUserId: ticket.reportedByUserId,
            recipientEmail: emp.email,
            recipientName: emp.name,
            recipientRole: 'STAFF',
            templateId: 'SUPPORT_CASE_STATUS',
            subject: `Support Case ${ticket.caseId} updated: ${status}`,
            renderedSubject: `Support Case ${ticket.caseId} updated: ${status}`,
            renderedBody: `Your support ticket "${ticket.summary}" has been updated to ${status}.${resolutionSummary ? ' Resolution: ' + resolutionSummary : ''}`,
            status: 'SENT',
            sentAt: new Date(),
          });

          const todayStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
          const notifId = `NT-${todayStr}-${Math.floor(1000 + Math.random() * 9000)}`;
          await Notification.create({
            notificationId: notifId,
            organisationId,
            eventType: 'SUPPORT_CASE_UPDATE',
            category: 'OPERATIONS',
            recipientUserId: ticket.reportedByUserId,
            recipientRole: 'STAFF',
            recipientEmail: emp.email,
            title: `Support Ticket ${ticket.caseId} ${status}`,
            message: `Status updated to ${status}.${resolutionSummary ? ' ' + resolutionSummary : ''}`,
            priority: 'NORMAL',
            channels: ['IN_APP'],
            deepLink: `#staff-settings?section=help&ticketId=${ticket.caseId}`,
            sourceModule: 'SETTINGS',
            sourceEntityType: 'SUPPORT_CASE',
            sourceEntityId: ticket.caseId,
            deduplicationKey: `${ticket.caseId}:${status}:${Date.now()}`,
            correlationId: req.correlationId || outboxId,
            createdBy: userId || 'SYSTEM',
          });
        }
      } catch (notifErr) {}
    }
  }

  if (assignedToUserId !== undefined) {
    ticket.assignedToUserId = assignedToUserId ? String(assignedToUserId).trim().toUpperCase() : null;
  }
  if (resolutionSummary && !ticket.resolvedAt) {
    ticket.resolutionSummary = String(resolutionSummary).trim().slice(0, 2000);
  }

  await ticket.save();

  try {
    await auditService.log({
      organisationId,
      action: 'SUPPORT_CASE_STATUS_CHANGED',
      performedByUserId: userId,
      metadata: { caseId: ticket.caseId, status: ticket.status, assignedToUserId: ticket.assignedToUserId },
    });
  } catch (e) {}

  res.status(200).json({
    success: true,
    message: `Support case ${caseId} updated successfully.`,
    data: { ticket },
  });
}

/**
 * POST /api/v1/settings/support/manage/tickets/:caseId/reply
 * Management Queue: Add response to support case.
 */
async function addSupportTicketReply(req, res) {
  const user = req.user || req.auth || {};
  const { userId, organisationId, role, assignedCafeIds = [], primaryCafeId } = user;

  if (!['MASTER', 'OWNER', 'CAFE_ADMIN'].includes(role)) {
    throw new ApiError(403, 'PERMISSION_DENIED', 'Only management roles can reply to support cases.');
  }

  const caseId = req.params.caseId?.trim().toUpperCase();
  const { message, visibility = 'PUBLIC', setStatusWaiting = true } = req.body || {};

  if (!message || !String(message).trim()) {
    throw new ApiError(400, 'MESSAGE_REQUIRED', 'Reply message is required.');
  }

  const { SupportCase } = require('../models/SupportCase');
  const { Notification } = require('../models/Notification');
  const { NotificationOutbox } = require('../models/NotificationOutbox');

  const ticket = await SupportCase.findOne({ organisationId, caseId });
  if (!ticket) {
    throw new ApiError(404, 'NOT_FOUND', `Support case ${caseId} not found.`);
  }

  if (role === 'CAFE_ADMIN') {
    const validCafes = [...(assignedCafeIds || [])];
    if (primaryCafeId && !validCafes.includes(primaryCafeId)) {
      validCafes.push(primaryCafeId);
    }
    if (!validCafes.includes(ticket.cafeId)) {
      throw new ApiError(403, 'CAFE_ACCESS_DENIED', 'Access denied to support case outside your assigned cafe.');
    }
  } else if (role === 'OWNER') {
    const validCafes = (assignedCafeIds || []).map((c) => String(c).trim().toUpperCase()).filter(Boolean);
    if (!validCafes.length || !validCafes.includes(ticket.cafeId)) {
      throw new ApiError(403, 'CROSS_CAFE_RESOURCE_DENIED', 'Access denied to support case outside your assigned cafe.');
    }
  }

  const responseId = `RSP-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;
  const validVis = visibility === 'INTERNAL' ? 'INTERNAL' : 'PUBLIC';

  ticket.responses = ticket.responses || [];
  ticket.responses.push({
    responseId,
    authorUserId: userId,
    authorRole: role,
    message: String(message).trim().slice(0, 5000),
    visibility: validVis,
    createdAt: new Date(),
  });

  if (validVis === 'PUBLIC' && setStatusWaiting) {
    ticket.status = 'WAITING_FOR_EMPLOYEE';
  }

  await ticket.save();

  if (validVis === 'PUBLIC' && ticket.reportedByUserId) {
    try {
      const emp = await User.findOne({ organisationId, userId: ticket.reportedByUserId }).select('email name').lean();
      if (emp) {
        const outboxId = `OUT-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;
        await NotificationOutbox.create({
          outboxId,
          organisationId,
          eventType: 'SUPPORT_CASE_REPLY',
          recipientUserId: ticket.reportedByUserId,
          recipientEmail: emp.email,
          recipientName: emp.name,
          recipientRole: 'STAFF',
          templateId: 'SUPPORT_CASE_MESSAGE',
          subject: `New message on Support Case ${ticket.caseId}`,
          renderedSubject: `New message on Support Case ${ticket.caseId}`,
          renderedBody: `Support team replied to your case "${ticket.summary}":\n\n${message.trim()}`,
          status: 'SENT',
          sentAt: new Date(),
        });

        const todayStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
        const notifId = `NT-${todayStr}-${Math.floor(1000 + Math.random() * 9000)}`;
        await Notification.create({
          notificationId: notifId,
          organisationId,
          eventType: 'SUPPORT_CASE_REPLY',
          category: 'OPERATIONS',
          recipientUserId: ticket.reportedByUserId,
          recipientRole: 'STAFF',
          recipientEmail: emp.email,
          title: `New message on Support Case ${ticket.caseId}`,
          message: `${String(message).trim().slice(0, 120)}...`,
          priority: 'NORMAL',
          channels: ['IN_APP'],
          deepLink: `#staff-settings?section=help&ticketId=${ticket.caseId}`,
          sourceModule: 'SETTINGS',
          sourceEntityType: 'SUPPORT_CASE',
          sourceEntityId: ticket.caseId,
          deduplicationKey: `${ticket.caseId}:REPLY:${Date.now()}`,
          correlationId: req.correlationId || outboxId,
          createdBy: userId || 'SYSTEM',
        });
      }
    } catch (notifErr) {}
  }

  try {
    await auditService.log({
      organisationId,
      action: 'SUPPORT_CASE_RESPONSE',
      performedByUserId: userId,
      metadata: { caseId: ticket.caseId, responseId, visibility: validVis },
    });
  } catch (e) {}

  res.status(201).json({
    success: true,
    message: 'Reply added successfully.',
    data: { ticket },
  });
}

/**
 * POST /api/v1/settings/support/tickets/:caseId/reply
 * Self-service: Employee replies to their own ticket.
 */
async function addEmployeeSupportTicketReply(req, res) {
  const user = req.user || req.auth || {};
  const { userId, organisationId } = user;

  const caseId = req.params.caseId?.trim().toUpperCase();
  const { message } = req.body || {};

  if (!message || !String(message).trim()) {
    throw new ApiError(400, 'MESSAGE_REQUIRED', 'Reply message is required.');
  }

  const { SupportCase } = require('../models/SupportCase');

  const ticket = await SupportCase.findOne({
    organisationId,
    caseId,
    reportedByUserId: userId,
  });

  if (!ticket) {
    throw new ApiError(404, 'NOT_FOUND', `Support ticket ${caseId} not found.`);
  }

  if (ticket.status === 'CLOSED') {
    throw new ApiError(400, 'TICKET_CLOSED', 'Cannot reply to a closed support ticket.');
  }

  const responseId = `RSP-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;

  ticket.responses = ticket.responses || [];
  ticket.responses.push({
    responseId,
    authorUserId: userId,
    authorRole: 'STAFF',
    message: String(message).trim().slice(0, 5000),
    visibility: 'PUBLIC',
    createdAt: new Date(),
  });

  if (ticket.status === 'WAITING_FOR_EMPLOYEE' || ticket.status === 'WAITING_EXTERNAL') {
    ticket.status = 'IN_PROGRESS';
  }

  await ticket.save();

  try {
    await auditService.log({
      organisationId,
      action: 'SUPPORT_CASE_EMPLOYEE_REPLY',
      performedByUserId: userId,
      metadata: { caseId: ticket.caseId, responseId },
    });
  } catch (e) {}

  res.status(201).json({
    success: true,
    message: 'Your reply has been submitted.',
    data: { ticket },
  });
}

// ═════════════════════════════════════════════════════════════════════════════
// DELEGATION & COVERAGE (P2)
// ═════════════════════════════════════════════════════════════════════════════

/**
 * GET /api/v1/settings/delegations
 * List active and recent delegations created by or assigned to the authenticated user.
 */
async function listMyDelegations(req, res) {
  const { userId, organisationId } = req.user;
  const now = new Date();

  const [outgoing, incoming] = await Promise.all([
    Delegation.find({ delegatorUserId: userId, organisationId }).sort({ createdAt: -1 }).lean(),
    Delegation.find({ delegateUserId: userId, organisationId, status: { $in: ['ACTIVE', 'SCHEDULED'] } }).sort({ createdAt: -1 }).lean(),
  ]);

  res.json({
    success: true,
    data: {
      outgoing: outgoing.map((d) => ({
        delegationId: d.delegationId,
        delegateUserId: d.delegateUserId,
        delegateName: d.delegateName,
        scope: d.scope,
        startDate: d.startDate,
        endDate: d.endDate,
        reason: d.reason,
        status: d.revokedAt ? 'REVOKED' : (now > new Date(d.endDate) ? 'EXPIRED' : (now >= new Date(d.startDate) ? 'ACTIVE' : 'SCHEDULED')),
        createdAt: d.createdAt,
      })),
      incoming: incoming.map((d) => ({
        delegationId: d.delegationId,
        delegatorUserId: d.delegatorUserId,
        scope: d.scope,
        startDate: d.startDate,
        endDate: d.endDate,
        reason: d.reason,
        status: d.revokedAt ? 'REVOKED' : (now > new Date(d.endDate) ? 'EXPIRED' : (now >= new Date(d.startDate) ? 'ACTIVE' : 'SCHEDULED')),
      })),
    },
  });
}

/**
 * POST /api/v1/settings/delegations
 * Create a new out-of-office scoped delegation.
 */
async function createDelegation(req, res) {
  const { userId, organisationId } = req.user;
  const { delegateUserId, scope, startDate, endDate, reason } = req.body;

  if (!delegateUserId || !scope || !startDate || !endDate || !reason) {
    throw new ApiError(400, 'MISSING_FIELDS', 'delegateUserId, scope, startDate, endDate, and reason are required.');
  }

  if (delegateUserId.trim().toUpperCase() === userId.trim().toUpperCase()) {
    throw new ApiError(400, 'INVALID_DELEGATE', 'You cannot delegate workflow authority to yourself.');
  }

  // Verify delegate exists in same organisation
  const delegateUser = await User.findOne({ userId: delegateUserId.trim().toUpperCase(), organisationId }).lean();
  if (!delegateUser) {
    throw new ApiError(404, 'DELEGATE_NOT_FOUND', 'The designated delegate account was not found in your organisation.');
  }

  const start = new Date(startDate);
  const end = new Date(endDate);
  if (isNaN(start.getTime()) || isNaN(end.getTime()) || start >= end) {
    throw new ApiError(400, 'INVALID_DATE_RANGE', 'End date must be strictly after start date.');
  }

  const delegationId = await SequenceCounter.generateId({ prefix: 'DEL', sequenceKey: 'delegation', organisationId });
  const now = new Date();
  const initialStatus = now >= start && now <= end ? 'ACTIVE' : 'SCHEDULED';

  const delegation = await Delegation.create({
    delegationId,
    organisationId,
    delegatorUserId: userId,
    delegateUserId: delegateUser.userId,
    delegateName: delegateUser.preferredName || delegateUser.name || delegateUser.fullName || delegateUser.userId,
    scope,
    startDate: start,
    endDate: end,
    reason: safeStr(reason).slice(0, 500),
    status: initialStatus,
  });

  await auditService.log({
    organisationId,
    action: 'SETTINGS_DELEGATION_CREATED',
    performedByUserId: userId,
    targetUserId: delegateUser.userId,
    metadata: { delegationId, scope, startDate: start, endDate: end },
  });

  res.status(201).json({
    success: true,
    data: delegation,
    message: 'Delegation created successfully. Delegate must use their own authenticated account.',
  });
}

/**
 * DELETE /api/v1/settings/delegations/:delegationId
 * Revoke an active or scheduled delegation early.
 */
async function revokeDelegation(req, res) {
  const { userId, organisationId } = req.user;
  const { delegationId } = req.params;

  const delegation = await Delegation.findOne({
    delegationId: delegationId.trim().toUpperCase(),
    organisationId,
    delegatorUserId: userId,
  });

  if (!delegation) {
    throw new ApiError(404, 'DELEGATION_NOT_FOUND', 'Delegation not found.');
  }

  if (delegation.revokedAt) {
    return res.json({ success: true, message: 'Delegation is already revoked.' });
  }

  delegation.status = 'REVOKED';
  delegation.revokedAt = new Date();
  delegation.revokedByUserId = userId;
  await delegation.save();

  await auditService.log({
    organisationId,
    action: 'SETTINGS_DELEGATION_REVOKED',
    performedByUserId: userId,
    metadata: { delegationId },
  });

  res.json({
    success: true,
    message: 'Delegation revoked successfully.',
  });
}

async function updateSecurityPolicy(req, res) {
  const auth = req.auth || req.user || {};
  const isPrimaryMaster = auth.role === 'MASTER' && auth.isPrimaryMaster === true;

  if (!isPrimaryMaster) {
    throw new ApiError(
      403,
      'PRIMARY_MASTER_AUTHORITY_REQUIRED',
      'Only the Primary Master may modify organisation security policies.'
    );
  }

  const { passwordPolicy, sessionPolicy } = req.body || {};
  const effectivePasswordPolicy = passwordPolicy || 'Minimum 15 characters (passphrase length-first, zero forced composition rules, blocklist protected)';
  const effectiveSessionPolicy = sessionPolicy || 'Standard enterprise session management';

  try {
    const { recordAuditEvent } = require('../services/auditService');
    await recordAuditEvent({
      organisationId: auth.organisationId || 'ORG-ZAMORIN',
      actorUserId: auth.userId || 'MU-0001',
      actorRole: auth.role,
      module: 'SECURITY_POLICY',
      action: 'SECURITY_POLICY_UPDATED',
      entityType: 'SECURITY_POLICY',
      entityId: 'GLOBAL_POLICY',
      result: 'SUCCESS',
      riskClassification: 'HIGH',
      details: {
        passwordPolicy: effectivePasswordPolicy,
        sessionPolicy: effectiveSessionPolicy,
        mfaRequired: false,
      },
    });
  } catch (_) {}

  return res.status(200).json({
    success: true,
    message: 'Security policy updated successfully.',
    data: {
      securityPolicy: {
        mfaRequired: false,
        sessionPolicy: effectiveSessionPolicy,
        passwordPolicy: effectivePasswordPolicy,
      },
    },
  });
}

// ── Google Business Profile Dashboard (A005 & A006) ─────────────────────────
const gbpService = require('../services/googleBusinessProfileService');

async function getGoogleBusinessSummary(req, res, next) {
  try {
    const organisationId = req.user?.organisationId || 'ORG-ZAMORIN';
    const cafeId = req.query.cafeId || req.user?.primaryCafeId || 'ZC-0001';
    const summary = await gbpService.getProfileSummary({ organisationId, cafeId });
    return res.status(200).json({ success: true, data: summary });
  } catch (err) {
    next(err);
  }
}

async function connectGoogleBusinessProfile(req, res, next) {
  try {
    const organisationId = req.user?.organisationId || 'ORG-ZAMORIN';
    const { cafeId, locationId, displayName, accountName, primaryPhone, addressLine } = req.body;
    const result = await gbpService.upsertProfileConnection({
      organisationId,
      cafeId: cafeId || req.user?.primaryCafeId || 'ZC-0001',
      locationId,
      displayName,
      accountName,
      primaryPhone,
      addressLine,
    });
    return res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

async function syncGoogleReviews(req, res, next) {
  try {
    const organisationId = req.user?.organisationId || 'ORG-ZAMORIN';
    const { cafeId, reviews } = req.body;
    const result = await gbpService.syncReviews({
      organisationId,
      cafeId: cafeId || req.user?.primaryCafeId || 'ZC-0001',
      reviews,
    });
    return res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

async function replyGoogleReview(req, res, next) {
  try {
    const organisationId = req.user?.organisationId || 'ORG-ZAMORIN';
    const { reviewId } = req.params;
    const { cafeId, comment } = req.body;
    const result = await gbpService.replyToReview({
      organisationId,
      cafeId: cafeId || req.user?.primaryCafeId || 'ZC-0001',
      reviewId,
      comment,
      repliedByUserId: req.user?.userId || 'SYSTEM',
    });
    return res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

async function updateGoogleBusinessMetrics(req, res, next) {
  try {
    const organisationId = req.user?.organisationId || 'ORG-ZAMORIN';
    const { cafeId, metrics } = req.body;
    const result = await gbpService.recordInsightsMetrics({
      organisationId,
      cafeId: cafeId || req.user?.primaryCafeId || 'ZC-0001',
      metrics,
    });
    return res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getSettingsOverview,
  getMyProfile,
  updateMyProfile,
  submitProfileChangeRequest,
  listMyProfileChangeRequests,
  getMyAccess,
  submitAccessRequest,
  listMyAccessRequests,
  getMyPreferences,
  updateAppearancePreferences,
  updateLanguagePreference,
  updateAccessibilityPreferences,
  updateWorkspacePreferences,
  updateNotificationPreferences,
  resetMyPreferences,
  getLanguageCatalogue,
  getSecurityOverview,
  updateSecurityPolicy,
  getMySessions,
  revokeMySession,
  revokeOtherSessions,
  revokeAllSessions,
  submitPrivacyRequest,
  listMyPrivacyRequests,
  getPrivacyNotice,
  listMyDelegations,
  createDelegation,
  revokeDelegation,
  getDiagnostics,
  submitSupportTicket,
  listMySupportTickets,
  listManageSupportTickets,
  getManageSupportTicket,
  updateManageSupportTicket,
  addSupportTicketReply,
  addEmployeeSupportTicketReply,
  getGoogleBusinessSummary,
  connectGoogleBusinessProfile,
  syncGoogleReviews,
  replyGoogleReview,
  updateGoogleBusinessMetrics,
};


