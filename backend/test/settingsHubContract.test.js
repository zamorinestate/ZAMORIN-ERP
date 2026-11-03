// =============================================================================
// TEST: SCR-023 Settings, Account & Preferences Hub Integration Test Suite
// =============================================================================

const test = require('node:test');
const assert = require('node:assert/strict');

const settingsController = require('../src/controllers/settingsController.js');

test('SCR-023: Settings Controller exposes all mandatory endpoints', () => {
  assert.equal(typeof settingsController.getSettingsOverview, 'function');
  assert.equal(typeof settingsController.getMyProfile, 'function');
  assert.equal(typeof settingsController.updateMyProfile, 'function');
  assert.equal(typeof settingsController.uploadMyProfilePhoto, 'function');
  assert.equal(typeof settingsController.removeMyProfilePhoto, 'function');
  assert.equal(typeof settingsController.getMyProfilePhoto, 'function');
  assert.equal(typeof settingsController.submitProfileChangeRequest, 'function');
  assert.equal(typeof settingsController.listMyProfileChangeRequests, 'function');
  assert.equal(typeof settingsController.getMyAccess, 'function');
  assert.equal(typeof settingsController.submitAccessRequest, 'function');
  assert.equal(typeof settingsController.listMyAccessRequests, 'function');
  assert.equal(typeof settingsController.getMySessions, 'function');
  assert.equal(typeof settingsController.revokeMySession, 'function');
  assert.equal(typeof settingsController.revokeOtherSessions, 'function');
  assert.equal(typeof settingsController.getMyPreferences, 'function');
  assert.equal(typeof settingsController.updateNotificationPreferences, 'function');
  assert.equal(typeof settingsController.updateLanguagePreference, 'function');
  assert.equal(typeof settingsController.updateAppearancePreferences, 'function');
  assert.equal(typeof settingsController.updateAccessibilityPreferences, 'function');
  assert.equal(typeof settingsController.updateWorkspacePreferences, 'function');
  assert.equal(typeof settingsController.submitPrivacyRequest, 'function');
  assert.equal(typeof settingsController.listMyDelegations, 'function');
  assert.equal(typeof settingsController.createDelegation, 'function');
  assert.equal(typeof settingsController.revokeDelegation, 'function');
  assert.equal(typeof settingsController.getDiagnostics, 'function');
});

test('SCR-023: Diagnostics endpoint returns safe metadata without leaking secrets', async () => {
  const req = {
    user: {
      userId: 'USR-TEST-001',
      role: 'STAFF',
      organisationId: 'ORG-ZAMORIN',
    },
  };
  let sentJson = null;
  const res = {
    json(payload) {
      sentJson = payload;
      return this;
    },
  };

  await settingsController.getDiagnostics(req, res);
  assert.equal(sentJson.success, true);
  assert.ok(sentJson.data.appVersion);
  assert.ok(sentJson.data.serverTime);
  assert.equal(sentJson.data.userId, 'USR-TEST-001');
  assert.equal(sentJson.data.role, 'STAFF');
  // Ensure no secrets or sensitive keys leaked
  assert.equal(sentJson.data.jwtSecret, undefined);
  assert.equal(sentJson.data.dbUri, undefined);
  assert.equal(sentJson.data.token, undefined);
  assert.equal(sentJson.data.passwordHash, undefined);
});
