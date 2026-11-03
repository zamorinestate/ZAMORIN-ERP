'use strict';

/**
 * Settings Routes — SCR-023
 * Mounted at /api/v1/settings (registered in routes/index.js)
 *
 * All routes are authenticated. All self-service operations resolve the
 * acting user exclusively from req.user (set by authenticate middleware).
 * No userId is accepted from the request body or params for self-operations.
 */

const express = require('express');
const multer = require('multer');
const { authenticate } = require('../middleware/authenticate');
const { ApiError } = require('../utils/ApiError');
const {
  MAX_PROFILE_PHOTO_BYTES,
  ALLOWED_MIME_TYPES,
} = require('../services/profilePhotoService');

const {
  getSettingsOverview,
  getMyProfile,
  updateMyProfile,
  uploadMyProfilePhoto,
  removeMyProfilePhoto,
  getMyProfilePhoto,
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
  disconnectGoogleBusinessProfile,
  syncGoogleReviews,
  replyGoogleReview,
  updateGoogleBusinessMetrics,
} = require('../controllers/settingsController');

const router = express.Router();

// Profile photo uploads are held in memory (max 2 MB) and handed straight to
// the canonical document storage adapter — nothing is written to ephemeral disk.
const profilePhotoUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_PROFILE_PHOTO_BYTES,
    files: 1,
  },
  fileFilter: (req, file, cb) => {
    const mime = String(file.mimetype || '').trim().toLowerCase().replace('image/jpg', 'image/jpeg');
    if (!ALLOWED_MIME_TYPES.includes(mime)) {
      return cb(new ApiError(400, 'PROFILE_PHOTO_TYPE_NOT_ALLOWED', 'Only JPG, PNG or WebP profile photos are accepted.'));
    }
    return cb(null, true);
  },
}).single('photo');

function acceptProfilePhoto(req, res, next) {
  profilePhotoUpload(req, res, (err) => {
    if (!err) return next();
    if (err instanceof ApiError) return next(err);
    if (err.code === 'LIMIT_FILE_SIZE') {
      return next(new ApiError(413, 'PROFILE_PHOTO_TOO_LARGE', 'Profile photos must be 2 MB or smaller.'));
    }
    if (err.code === 'LIMIT_UNEXPECTED_FILE') {
      return next(new ApiError(400, 'PROFILE_PHOTO_FIELD_INVALID', 'Upload the image using the "photo" form field.'));
    }
    if (err.code === 'LIMIT_FILE_COUNT') {
      return next(new ApiError(400, 'PROFILE_PHOTO_TOO_MANY_FILES', 'Upload exactly one profile photo.'));
    }
    return next(err);
  });
}

// All settings endpoints require an authenticated session.
router.use(authenticate);

// ── Overview ─────────────────────────────────────────────────────────────────
router.get('/overview', getSettingsOverview);

// ── Profile & Identity ────────────────────────────────────────────────────────
router.get('/profile', getMyProfile);
router.patch('/profile', updateMyProfile);
router.get('/profile/photo', getMyProfilePhoto);
router.post('/profile/photo', acceptProfilePhoto, uploadMyProfilePhoto);
router.delete('/profile/photo', removeMyProfilePhoto);
router.post('/profile/change-request', submitProfileChangeRequest);
router.get('/profile/change-requests', listMyProfileChangeRequests);

// ── My Access & Permissions ───────────────────────────────────────────────────
router.get('/access', getMyAccess);
router.post('/access/request', submitAccessRequest);
router.get('/access/requests', listMyAccessRequests);

// ── Preferences (Appearance, Language, Accessibility, Workspace, Notifications)
router.get('/preferences', getMyPreferences);
router.patch('/preferences/appearance', updateAppearancePreferences);
router.patch('/preferences/language', updateLanguagePreference);
router.patch('/preferences/accessibility', updateAccessibilityPreferences);
router.patch('/preferences/workspace', updateWorkspacePreferences);
router.patch('/preferences/notifications', updateNotificationPreferences);
router.post('/preferences/reset', resetMyPreferences);

// ── Language Catalogue ────────────────────────────────────────────────────────
router.get('/languages', getLanguageCatalogue);

// ── Security & Sign-In ────────────────────────────────────────────────────────
router.get('/security', getSecurityOverview);
router.patch('/security', updateSecurityPolicy);
router.put('/security', updateSecurityPolicy);

// ── Devices & Sessions ────────────────────────────────────────────────────────
router.get('/sessions', getMySessions);
router.delete('/sessions/:sessionId', revokeMySession);
router.post('/sessions/revoke-others', revokeOtherSessions);
router.post('/sessions/revoke-all', revokeAllSessions);

// ── Delegation & Coverage (P2) ────────────────────────────────────────────────
router.get('/delegations', listMyDelegations);
router.post('/delegations', createDelegation);
router.delete('/delegations/:delegationId', revokeDelegation);

// ── Privacy & Data ────────────────────────────────────────────────────────────
router.post('/privacy/requests', submitPrivacyRequest);
// Frontend Settings page submits { requestType, details } to /privacy/request (singular).
// Map details → reason so the canonical submit flow handles it — no duplicated logic.
router.post('/privacy/request', (req, res, next) => {
  if (req.body && !req.body.reason && req.body.details) {
    req.body = { ...req.body, reason: req.body.details };
  }
  return submitPrivacyRequest(req, res, next);
});
router.get('/privacy/requests', listMyPrivacyRequests);
router.get('/privacy/notice', getPrivacyNotice);

// ── Help & Support ────────────────────────────────────────────────────────────
router.get('/diagnostics', getDiagnostics);
router.post('/support/tickets', submitSupportTicket);
router.get('/support/tickets', listMySupportTickets);
router.post('/support/tickets/:caseId/reply', addEmployeeSupportTicketReply);

// Management Support Queue (Master, Owner, Cafe Admin)
router.get('/support/manage/tickets', listManageSupportTickets);
router.get('/support/manage/tickets/:caseId', getManageSupportTicket);
router.patch('/support/manage/tickets/:caseId', updateManageSupportTicket);
router.post('/support/manage/tickets/:caseId/reply', addSupportTicketReply);

// ── Organisation Identity (Restricted) ────────────────────────────────────────
const {
  getCompanyIdentity,
  unlockCompanyIdentity,
  updateCompanyIdentity,
  getCompanyIdentityHistory,
} = require('../controllers/companyIdentityController');

router.get('/company-identity', getCompanyIdentity);
router.post('/company-identity/unlock', unlockCompanyIdentity);
router.put('/company-identity', updateCompanyIdentity);
router.get('/company-identity/history', getCompanyIdentityHistory);

// ── Application Updates & Version Control (Role-Targeted) ────────────────────
const updateRoutes = require('./updateRoutes');
router.use('/updates', updateRoutes);

// ── Google Business Profile Dashboard (A005 & A006) ─────────────────────────
router.get('/google-business/summary', getGoogleBusinessSummary);
router.post('/google-business/connect', connectGoogleBusinessProfile);
router.post('/google-business/disconnect', disconnectGoogleBusinessProfile);
router.post('/google-business/sync-reviews', syncGoogleReviews);
router.post('/google-business/reviews/:reviewId/reply', replyGoogleReview);
router.post('/google-business/metrics', updateGoogleBusinessMetrics);

// ── Legacy redirect aliases ───────────────────────────────────────────────────
// My Profile was previously navigated to directly; now lives in Settings.
router.get('/my-profile', (req, res) => res.redirect(301, '/api/v1/settings/profile'));

module.exports = router;
