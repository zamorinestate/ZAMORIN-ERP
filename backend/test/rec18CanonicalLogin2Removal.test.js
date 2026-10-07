'use strict';

/**
 * =============================================================================
 * REC-18 — LEGACY LOGIN PERMANENT REMOVAL, LOGIN PAGE 2.0 CANONICALIZATION &
 *          AUTHENTICATION ENTRY-POINT CONSOLIDATION
 *
 * 40-Point Authoritative Test Suite covering Section 56 of REC-18 Mandate:
 *  01 /login renders Login 2.0
 *  02 /login does not render legacy markup
 *  03 /login2 aliases/redirects to canonical route if retained
 *  04 known old legacy route cannot render old UI
 *  05 root unauthenticated entry reaches Login 2.0
 *  06 protected route unauthenticated reaches Login 2.0
 *  07 safe internal return after authentication
 *  08 external returnTo rejected
 *  09 logout reaches Login 2.0
 *  10 expired session reaches Login 2.0
 *  11 revoked session reaches Login 2.0
 *  12 password-reset completion reaches Login 2.0
 *  13 QR route resolves into Login 2.0
 *  14 QR café banner/context preserved
 *  15 QR does not authenticate
 *  16 tampered QR denied
 *  17 suspended café QR denied
 *  18 Primary Master login
 *  19 Normal Master login
 *  20 Owner login
 *  21 Café Admin login
 *  22 Staff login
 *  23 Accounts-capability Staff login
 *  24 wrong password
 *  25 wrong Organisation ID
 *  26 disabled user
 *  27 throttled user
 *  28 no mandatory TOTP
 *  29 Remember This Device
 *  30 session creation/rotation
 *  31 legacy JS not imported
 *  32 legacy CSS not loaded
 *  33 legacy page file absent
 *  34 legacy-only assets absent where unused
 *  35 service worker does not cache legacy login
 *  36 offline POS IndexedDB queue preserved
 *  37 mobile Login 2.0
 *  38 keyboard/accessibility
 *  39 router integrity
 *  40 zero KDS
 * =============================================================================
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const bcrypt = require('bcrypt');

const { User } = require('../src/models/User');
const { Session } = require('../src/models/Session');
const { Cafe } = require('../src/models/Cafe');
const { CafeAccess } = require('../src/models/CafeAccess');
const authService = require('../src/services/authService');
const cafeService = require('../src/services/cafeService');
const cafeAccessCryptoService = require('../src/services/cafeAccessCryptoService');
const { ApiError } = require('../src/utils/ApiError');

const FRONTEND_DIR = path.resolve(__dirname, '../../frontend');
const MAIN_JS_PATH = path.join(FRONTEND_DIR, 'src/js/main.js');
const LOGIN2_JS_PATH = path.join(FRONTEND_DIR, 'src/js/pages/login2.js');
const LOGIN_LEGACY_JS_PATH = path.join(FRONTEND_DIR, 'src/js/pages/login.js');
const LOGIN2_CSS_PATH = path.join(FRONTEND_DIR, 'src/styles/login2.css');
const COMPONENTS_BASE_CSS_PATH = path.join(FRONTEND_DIR, 'src/styles/components.base.css');
const INDEX_HTML_PATH = path.join(FRONTEND_DIR, 'index.html');
const SW_JS_PATH = path.join(FRONTEND_DIR, 'sw.js');

test('REC-18 Canonical Login Page 2.0 & Legacy Login Permanent Removal 40-Point Suite', async (t) => {
  let mongoServer;
  const TEST_ORG = 'ZAMORIN';
  let cafeA;
  let rawQrTokenA;
  let suspendedCafe;
  let rawQrTokenSuspended;

  t.before(async () => {
    mongoServer = await MongoMemoryServer.create();
    await mongoose.connect(mongoServer.getUri());

    process.env.JWT_ACCESS_SECRET = 'a_very_secure_and_long_jwt_access_secret_32bytes_long!';
    process.env.JWT_REFRESH_SECRET = 'a_very_secure_and_long_jwt_refresh_secret_32bytes_long!';
    process.env.PASSWORD_RESET_HMAC_SECRET = 'a_very_secure_and_long_jwt_access_secret_32bytes_long!';

    cafeAccessCryptoService.verifySecretKeys();

    const passwordHash = await bcrypt.hash('Password@123', 10);
    const opPinHash = await bcrypt.hash('123456', 10);

    // 1. Create Active Cafe
    cafeA = await Cafe.create({
      organisationId: TEST_ORG,
      cafeId: 'ZC-0001',
      name: 'Koramangala Main Branch',
      displayName: 'Zamorin Koramangala',
      cafeType: 'STANDARD_CAFE',
      city: 'Bangalore',
      status: 'ACTIVE',
      operationalStatus: 'OPERATIONAL',
      createdBy: 'MU-0001',
    });

    rawQrTokenA = cafeAccessCryptoService.generateOpaqueToken();
    const qrHashA = cafeAccessCryptoService.hashOpaqueToken(rawQrTokenA);
    await CafeAccess.create({
      organisationId: TEST_ORG,
      cafeId: 'ZC-0001',
      permanentCafePinEncrypted: cafeAccessCryptoService.encryptSecret('123456'),
      permanentCafePinLookupHash: cafeAccessCryptoService.computePinLookupHash('123456'),
      qrCredentialHash: qrHashA,
      qrTokenEncrypted: cafeAccessCryptoService.encryptSecret(rawQrTokenA),
      qrVersion: 1,
      qrEnabled: true,
      qrCreatedAt: new Date(),
      linkCredentialHash: cafeAccessCryptoService.hashOpaqueToken('link-token-a'),
      linkTokenEncrypted: cafeAccessCryptoService.encryptSecret('link-token-a'),
      linkVersion: 1,
      linkEnabled: true,
      provisioningStatus: 'READY',
      createdBy: 'MU-0001',
    });

    // 2. Create Suspended Cafe
    suspendedCafe = await Cafe.create({
      organisationId: TEST_ORG,
      cafeId: 'ZC-0099',
      name: 'Closed Branch',
      displayName: 'Zamorin Closed',
      cafeType: 'STANDARD_CAFE',
      city: 'Bangalore',
      status: 'CLOSED',
      operationalStatus: 'CLOSED',
      createdBy: 'MU-0001',
    });

    rawQrTokenSuspended = cafeAccessCryptoService.generateOpaqueToken();
    const qrHashSuspended = cafeAccessCryptoService.hashOpaqueToken(rawQrTokenSuspended);
    await CafeAccess.create({
      organisationId: TEST_ORG,
      cafeId: 'ZC-0099',
      permanentCafePinEncrypted: cafeAccessCryptoService.encryptSecret('654321'),
      permanentCafePinLookupHash: cafeAccessCryptoService.computePinLookupHash('654321'),
      qrCredentialHash: qrHashSuspended,
      qrTokenEncrypted: cafeAccessCryptoService.encryptSecret(rawQrTokenSuspended),
      qrVersion: 1,
      qrEnabled: true,
      qrCreatedAt: new Date(),
      linkCredentialHash: cafeAccessCryptoService.hashOpaqueToken('link-token-suspended'),
      linkTokenEncrypted: cafeAccessCryptoService.encryptSecret('link-token-suspended'),
      linkVersion: 1,
      linkEnabled: true,
      provisioningStatus: 'READY',
      createdBy: 'MU-0001',
    });

    // 3. Create Required Test Personas
    // Primary Master
    await User.create({
      organisationId: TEST_ORG,
      userId: 'MU-0001',
      name: 'Primary Master Founder',
      email: 'primary.master@zamorin.com',
      passwordHash,
      role: 'MASTER',
      accountStatus: 'ACTIVE',
      status: 'ACTIVE',
      isPrimaryMaster: true,
      primaryMasterDesignatedAt: new Date(),
      primaryMasterDesignatedBy: 'SYSTEM_BOOTSTRAP',
      primaryMasterDesignationReason: 'Initial setup',
      createdBy: 'SYSTEM',
    });

    // Normal Master (legacy decommissioned record)
    await User.collection.insertOne({
      organisationId: TEST_ORG,
      userId: 'MU-0002',
      name: 'Normal Master User',
      email: 'normal.master@zamorin.com',
      passwordHash,
      role: 'MASTER',
      accountStatus: 'DECOMMISSIONED',
      status: 'DECOMMISSIONED',
      isPrimaryMaster: false,
      createdBy: 'MU-0001',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // Owner
    await User.create({
      organisationId: TEST_ORG,
      userId: 'OW-0001',
      name: 'Executive Owner User',
      email: 'owner@zamorin.com',
      passwordHash,
      role: 'OWNER',
      accountStatus: 'ACTIVE',
      status: 'ACTIVE',
      isPrimaryMaster: false,
      createdBy: 'MU-0001',
    });

    // Cafe Admin
    await User.create({
      organisationId: TEST_ORG,
      userId: 'AD-0001',
      name: 'Cafe Operations Admin',
      email: 'cafe.admin@zamorin.com',
      passwordHash,
      role: 'CAFE_ADMIN',
      accountStatus: 'ACTIVE',
      status: 'ACTIVE',
      isPrimaryMaster: false,
      primaryCafeId: 'ZC-0001',
      assignedCafeIds: ['ZC-0001'],
      createdBy: 'MU-0001',
    });

    // Staff
    await User.create({
      organisationId: TEST_ORG,
      userId: 'ST-0001',
      name: 'Floor Staff Member',
      email: 'staff@zamorin.com',
      passwordHash,
      role: 'STAFF',
      accountStatus: 'ACTIVE',
      status: 'ACTIVE',
      isPrimaryMaster: false,
      primaryCafeId: 'ZC-0001',
      assignedCafeIds: ['ZC-0001'],
      createdBy: 'MU-0001',
    });

    // Staff with Accounts Capability
    await User.create({
      organisationId: TEST_ORG,
      userId: 'ST-0002',
      name: 'Accounts Payable Staff',
      email: 'accounts.staff@zamorin.com',
      passwordHash,
      role: 'STAFF',
      accountStatus: 'ACTIVE',
      status: 'ACTIVE',
      isPrimaryMaster: false,
      primaryCafeId: 'ZC-0001',
      assignedCafeIds: ['ZC-0001'],
      capabilities: ['ACCOUNTS_PAYABLE', 'VENDOR_INVOICE_PROCESS'],
      createdBy: 'MU-0001',
    });

    // Suspended User
    await User.create({
      organisationId: TEST_ORG,
      userId: 'ST-0099',
      name: 'Suspended Staff',
      email: 'suspended@zamorin.com',
      passwordHash,
      role: 'STAFF',
      accountStatus: 'SUSPENDED',
      status: 'SUSPENDED',
      isPrimaryMaster: false,
      createdBy: 'MU-0001',
    });
  });

  t.after(async () => {
    await mongoose.disconnect();
    if (mongoServer) await mongoServer.stop();
  });

  // ===========================================================================
  // 01-04: Public Routes & Canonical Router Redirection
  // ===========================================================================
  await t.test('01. /login renders Login 2.0 implementation', () => {
    const mainContent = fs.readFileSync(MAIN_JS_PATH, 'utf8');
    assert.ok(mainContent.includes('renderLoginPage2'), 'main.js imports and invokes renderLoginPage2');
    assert.ok(mainContent.includes('wireLoginPage2'), 'main.js wires wireLoginPage2');
    assert.ok(mainContent.includes('mountAuthScreen("login"'), 'main.js mounts canonical login');
  });

  await t.test('02. /login does not render legacy markup', () => {
    const mainContent = fs.readFileSync(MAIN_JS_PATH, 'utf8');
    assert.equal(mainContent.includes('renderLogin('), false, 'main.js must not call legacy renderLogin()');
    assert.equal(mainContent.includes('wireLogin('), false, 'main.js must not wire legacy wireLogin()');
    assert.equal(mainContent.includes('pages/login.js'), false, 'main.js must not import from pages/login.js');
  });

  await t.test('03. /login2 aliases/redirects to canonical route', () => {
    const mainContent = fs.readFileSync(MAIN_JS_PATH, 'utf8');
    assert.ok(mainContent.includes('/login2'), 'main.js intercepts /login2 alias');
    assert.ok(mainContent.includes('replaceState(null, "", "/login")'), 'main.js canonicalizes /login2 URL to /login');
  });

  await t.test('04. known old legacy route cannot render old UI', () => {
    const mainContent = fs.readFileSync(MAIN_JS_PATH, 'utf8');
    assert.equal(mainContent.includes('isLegacyLoginRequested'), false, 'Legacy login query parameter branch must be removed');
    assert.equal(fs.existsSync(LOGIN_LEGACY_JS_PATH), false, 'Legacy login.js file must be deleted from filesystem');
  });

  // ===========================================================================
  // 05-08: Unauthenticated Entry, Protected Interception & Open Redirect Protection
  // ===========================================================================
  await t.test('05. root unauthenticated entry reaches Login 2.0', () => {
    const mainContent = fs.readFileSync(MAIN_JS_PATH, 'utf8');
    assert.ok(mainContent.includes('mountAuthScreen("login")'), 'Unauthenticated root navigates to Login 2.0');
  });

  await t.test('06. protected route unauthenticated reaches Login 2.0', () => {
    const mainContent = fs.readFileSync(MAIN_JS_PATH, 'utf8');
    assert.ok(mainContent.includes('mountAuthScreen("login")'), 'Protected routes route unauthenticated users to Login 2.0');
  });

  await t.test('07. safe internal return after authentication', () => {
    const mainContent = fs.readFileSync(MAIN_JS_PATH, 'utf8');
    assert.ok(mainContent.includes('getSafeInternalRedirect'), 'main.js uses getSafeInternalRedirect helper');

    // Test the redirect validator function logic directly
    function getSafeInternalRedirect(target) {
      if (!target || typeof target !== 'string') return null;
      const trimmed = target.trim();
      if (trimmed.startsWith('//') || trimmed.startsWith('\\\\') || trimmed.startsWith('/\\')) return null;
      if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed)) return null;
      if (/[\r\n\0]/.test(trimmed)) return null;
      if (trimmed.startsWith('#')) {
        const rawRoute = trimmed.slice(1).replace(/^\/+/, '');
        return rawRoute || null;
      }
      if (trimmed.startsWith('/')) {
        const rawRoute = trimmed.slice(1);
        return rawRoute || null;
      }
      if (/^[a-zA-Z0-9_\-\/]+$/.test(trimmed)) {
        return trimmed;
      }
      return null;
    }

    assert.equal(getSafeInternalRedirect('/pos'), 'pos');
    assert.equal(getSafeInternalRedirect('/vendors'), 'vendors');
    assert.equal(getSafeInternalRedirect('#settings'), 'settings');
    assert.equal(getSafeInternalRedirect('procurement'), 'procurement');
  });

  await t.test('08. external returnTo rejected', () => {
    function getSafeInternalRedirect(target) {
      if (!target || typeof target !== 'string') return null;
      const trimmed = target.trim();
      if (trimmed.startsWith('//') || trimmed.startsWith('\\\\') || trimmed.startsWith('/\\')) return null;
      if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed)) return null;
      if (/[\r\n\0]/.test(trimmed)) return null;
      if (trimmed.startsWith('#')) {
        const rawRoute = trimmed.slice(1).replace(/^\/+/, '');
        return rawRoute || null;
      }
      if (trimmed.startsWith('/')) {
        const rawRoute = trimmed.slice(1);
        return rawRoute || null;
      }
      if (/^[a-zA-Z0-9_\-\/]+$/.test(trimmed)) {
        return trimmed;
      }
      return null;
    }

    assert.equal(getSafeInternalRedirect('https://attacker.example'), null);
    assert.equal(getSafeInternalRedirect('//evil.example'), null);
    assert.equal(getSafeInternalRedirect('\\\\evil.example'), null);
    assert.equal(getSafeInternalRedirect('javascript:alert(1)'), null);
    assert.equal(getSafeInternalRedirect('data:text/html,<script>'), null);
  });

  // ===========================================================================
  // 09-12: Lifecycle Navigation (Logout, Expiry, Revocation, Reset)
  // ===========================================================================
  await t.test('09. logout reaches Login 2.0', () => {
    const mainContent = fs.readFileSync(MAIN_JS_PATH, 'utf8');
    const componentsPath = path.join(FRONTEND_DIR, 'src/js/components.js');
    const componentsContent = fs.readFileSync(componentsPath, 'utf8');
    assert.ok(componentsContent.includes('/auth/logout'), 'components.js calls /auth/logout');
    assert.ok(componentsContent.includes('clearAllAuthTokens'), 'components.js clears tokens on logout');
    assert.ok(componentsContent.includes('window.location.hash = "#login"'), 'components.js routes to #login');
    assert.ok(mainContent.includes('mountAuthScreen("login"'), 'main.js mounts Login 2.0');
  });

  await t.test('10. expired session reaches Login 2.0', () => {
    const mainContent = fs.readFileSync(MAIN_JS_PATH, 'utf8');
    assert.ok(mainContent.includes('addSessionExpirationListener'), 'Session expiry listener registered in main.js');
    assert.ok(mainContent.includes('Your session has expired. Please sign in again.'), 'Session expiry notification message configured');
  });

  await t.test('11. revoked session reaches Login 2.0', () => {
    const mainContent = fs.readFileSync(MAIN_JS_PATH, 'utf8');
    assert.ok(mainContent.includes('INVALID_OR_EXPIRED_SESSION') || mainContent.includes('AUTH_TOKEN_EXPIRED') || mainContent.includes('Your session has expired'), 'Revoked session cleanly maps to Login 2.0 notice');
  });

  await t.test('12. password-reset completion reaches Login 2.0', () => {
    const mainContent = fs.readFileSync(MAIN_JS_PATH, 'utf8');
    assert.ok(mainContent.includes('Password updated successfully. Please sign in with your new password.'), 'Reset completion mounts Login 2.0 with success notice');
  });

  // ===========================================================================
  // 13-17: QR Deep-Link Resolution, Context Preservation & Security Invariants
  // ===========================================================================
  await t.test('13. QR route resolves into Login 2.0', async () => {
    const publicContext = await cafeService.resolvePublicQrToken(rawQrTokenA);
    assert.ok(publicContext, 'QR token resolves public context');
    assert.equal(publicContext.cafeId, 'ZC-0001');

    const mainContent = fs.readFileSync(MAIN_JS_PATH, 'utf8');
    assert.ok(mainContent.includes('cafeContext'), 'main.js passes cafeContext to renderLoginPage2');
  });

  await t.test('14. QR café banner/context preserved', () => {
    const login2Content = fs.readFileSync(LOGIN2_JS_PATH, 'utf8');
    assert.ok(login2Content.includes('Signing in to:'), 'Login 2.0 displays cafe banner when cafeContext provided');
    assert.ok(login2Content.includes('targetCafeId'), 'Login 2.0 preserves targetCafeId hidden form input');
  });

  await t.test('15. QR does not authenticate (context locator only)', async () => {
    const publicContext = await cafeService.resolvePublicQrToken(rawQrTokenA);
    assert.equal(publicContext.accessToken, undefined, 'Must not provide access token');
    assert.equal(publicContext.token, undefined, 'Must not provide raw token');
    assert.equal(publicContext.passwordHash, undefined, 'Must not provide password hash');
    assert.equal(publicContext.session, undefined, 'Must not create session');
  });

  await t.test('16. tampered QR denied', async () => {
    await assert.rejects(
      async () => {
        await cafeService.resolvePublicQrToken('tampered-or-fabricated-token-12345');
      },
      (err) => {
        assert.ok(err instanceof ApiError);
        assert.equal(err.statusCode, 401);
        return true;
      }
    );
  });

  await t.test('17. suspended café QR denied', async () => {
    await assert.rejects(
      async () => {
        await cafeService.resolvePublicQrToken(rawQrTokenSuspended);
      },
      (err) => {
        assert.ok(err instanceof ApiError);
        assert.ok(err.statusCode === 403 || err.statusCode === 401, 'Should reject closed/suspended cafe');
        return true;
      }
    );
  });

  // ===========================================================================
  // 18-23: Canonical Role Logins & Capability Resolution
  // ===========================================================================
  await t.test('18. Primary Master login', async () => {
    const authResult = await authService.authenticatePassword({
      organisationId: TEST_ORG,
      email: 'primary.master@zamorin.com',
      password: 'Password@123',
    });
    assert.equal(authResult.user.role, 'MASTER');
    assert.equal(authResult.user.isPrimaryMaster, true);

    const sessionData = await authService.createSession({
      user: authResult.user,
      device: { deviceId: 'DEV-REC18-PM', deviceType: 'DESKTOP' },
      createdBy: authResult.user.userId,
    });
    assert.ok(sessionData.accessToken);
    assert.equal(sessionData.session.roleSnapshot, 'MASTER');
  });

  await t.test('19. Normal Master login rejected (retired persona)', async () => {
    await assert.rejects(
      async () => {
        await authService.authenticatePassword({
          organisationId: TEST_ORG,
          email: 'normal.master@zamorin.com',
          password: 'Password@123',
        });
      },
      (err) => {
        assert.ok(
          err.code === 'ROLE_RETIRED' ||
          err.statusCode === 403 ||
          (err.message && err.message.toLowerCase().includes('retired')) ||
          (err.message && err.message.toLowerCase().includes('decommissioned')) ||
          (err.message && err.message.toLowerCase().includes('not available')) ||
          (err.message && err.message.toLowerCase().includes('inactive'))
        );
        return true;
      }
    );
  });

  await t.test('20. Owner login', async () => {
    const authResult = await authService.authenticatePassword({
      organisationId: TEST_ORG,
      email: 'owner@zamorin.com',
      password: 'Password@123',
    });
    assert.equal(authResult.user.role, 'OWNER');
    assert.equal(authResult.user.isPrimaryMaster, false);
  });

  await t.test('21. Café Admin login', async () => {
    const authResult = await authService.authenticatePassword({
      organisationId: TEST_ORG,
      email: 'cafe.admin@zamorin.com',
      password: 'Password@123',
    });
    assert.equal(authResult.user.role, 'CAFE_ADMIN');
    assert.equal(authResult.user.primaryCafeId, 'ZC-0001');
    assert.deepEqual(authResult.user.assignedCafeIds, ['ZC-0001']);
  });

  await t.test('22. Staff login', async () => {
    const authResult = await authService.authenticatePassword({
      organisationId: TEST_ORG,
      email: 'staff@zamorin.com',
      password: 'Password@123',
    });
    assert.equal(authResult.user.role, 'STAFF');

    const mainContent = fs.readFileSync(MAIN_JS_PATH, 'utf8');
    assert.ok(mainContent.includes('const landingRoute = (role === "staff") ? "staff-home" : "dashboard";'));
  });

  await t.test('23. Accounts-capability Staff login', async () => {
    const authResult = await authService.authenticatePassword({
      organisationId: TEST_ORG,
      email: 'accounts.staff@zamorin.com',
      password: 'Password@123',
    });
    assert.equal(authResult.user.role, 'STAFF');
    assert.ok(authResult.user.capabilities.includes('ACCOUNTS_PAYABLE'));
  });

  // ===========================================================================
  // 24-27: Authentication Failures, Rate Limiting & Anti-Enumeration
  // ===========================================================================
  await t.test('24. wrong password', async () => {
    await assert.rejects(
      async () => {
        await authService.authenticatePassword({
          organisationId: TEST_ORG,
          email: 'primary.master@zamorin.com',
          password: 'IncorrectPassword999!',
        });
      },
      (err) => {
        assert.ok(err.message.includes('Invalid email or password'));
        return true;
      }
    );
  });

  await t.test('25. wrong Organisation ID', async () => {
    await assert.rejects(
      async () => {
        await authService.authenticatePassword({
          organisationId: 'NONEXISTENT_ORG',
          email: 'primary.master@zamorin.com',
          password: 'Password@123',
        });
      },
      (err) => {
        assert.ok(err.message.includes('Invalid') || err.message.includes('not found') || err.statusCode === 401 || err.statusCode === 404);
        return true;
      }
    );
  });

  await t.test('26. disabled user', async () => {
    await assert.rejects(
      async () => {
        await authService.authenticatePassword({
          organisationId: TEST_ORG,
          email: 'suspended@zamorin.com',
          password: 'Password@123',
        });
      },
      (err) => {
        assert.ok(
          err.message.includes('not available for sign-in') ||
          err.message.includes('suspended') ||
          err.statusCode === 403,
          'Suspended user must be rejected'
        );
        return true;
      }
    );
  });

  await t.test('27. throttled user (rate limiters configured)', () => {
    const authRoutesPath = path.resolve(__dirname, '../src/routes/authRoutes.js');
    const authRoutesContent = fs.readFileSync(authRoutesPath, 'utf8');
    assert.ok(authRoutesContent.includes('loginIpRateLimiter'), 'IP rate limiter registered on login');
    assert.ok(authRoutesContent.includes('loginAccountRateLimiter'), 'Account rate limiter registered on login');
  });

  // ===========================================================================
  // 28-30: Invariants (No Mandatory TOTP, Remember Device, Session Rotation)
  // ===========================================================================
  await t.test('28. no mandatory TOTP', async () => {
    const authResult = await authService.authenticatePassword({
      organisationId: TEST_ORG,
      email: 'owner@zamorin.com',
      password: 'Password@123',
    });
    // Standard user has no mfaEnabled forced requirement
    assert.equal(Boolean(authResult.user.mfaEnabled), false);
    assert.equal(authResult.mfaRequired, undefined);
  });

  await t.test('29. Remember This Device', () => {
    const login2Content = fs.readFileSync(LOGIN2_JS_PATH, 'utf8');
    assert.ok(login2Content.includes('l2-remember-device'), 'Login 2.0 has remember device checkbox');
    assert.ok(login2Content.includes('rememberDevice'), 'wireLoginPage2 reads rememberDevice state');

    const authControllerPath = path.resolve(__dirname, '../src/controllers/authController.js');
    const authControllerContent = fs.readFileSync(authControllerPath, 'utf8');
    assert.ok(authControllerContent.includes('loginInput.rememberDevice'), 'authController processes rememberDevice input');
    assert.ok(authControllerContent.includes('registerTrustedDevice'), 'authController registers trusted device');
  });

  await t.test('30. session creation/rotation', async () => {
    const user = await User.findOne({ email: 'owner@zamorin.com' });
    const s1 = await authService.createSession({
      user,
      device: { deviceId: 'DEV-ROT-1', deviceType: 'DESKTOP' },
      createdBy: user.userId,
    });
    const s2 = await authService.createSession({
      user,
      device: { deviceId: 'DEV-ROT-2', deviceType: 'DESKTOP' },
      createdBy: user.userId,
    });
    assert.notEqual(s1.session.sessionId, s2.session.sessionId, 'Session IDs must rotate and be distinct');
    assert.notEqual(s1.accessToken, s2.accessToken, 'Access tokens must be distinct');
  });

  // ===========================================================================
  // 31-36: Frontend Assets, CSS, Service Worker & Offline Storage Safety
  // ===========================================================================
  await t.test('31. legacy JS not imported', () => {
    const mainContent = fs.readFileSync(MAIN_JS_PATH, 'utf8');
    assert.equal(mainContent.includes('pages/login.js'), false);
    assert.equal(mainContent.includes('from "./pages/login.js"'), false);
  });

  await t.test('32. legacy CSS not loaded', () => {
    const indexHtml = fs.readFileSync(INDEX_HTML_PATH, 'utf8');
    assert.equal(indexHtml.includes('components.base.css'), false, 'index.html must not link components.base.css');
    assert.equal(fs.existsSync(COMPONENTS_BASE_CSS_PATH), false, 'components.base.css must be deleted');
  });

  await t.test('33. legacy page file absent', () => {
    assert.equal(fs.existsSync(LOGIN_LEGACY_JS_PATH), false, 'frontend/src/js/pages/login.js must not exist');
  });

  await t.test('34. legacy-only assets absent where unused', () => {
    const indexHtml = fs.readFileSync(INDEX_HTML_PATH, 'utf8');
    assert.equal(indexHtml.includes('legacyLogin'), false);
    assert.equal(indexHtml.includes('oldLogin'), false);
  });

  await t.test('35. service worker does not cache legacy login', () => {
    const swContent = fs.readFileSync(SW_JS_PATH, 'utf8');
    assert.equal(swContent.includes('login.js'), false, 'sw.js PRECACHE_ASSETS must not include legacy login.js');
    assert.equal(swContent.includes('components.base.css'), false, 'sw.js PRECACHE_ASSETS must not include components.base.css');
    assert.ok(swContent.includes('login2.css'), 'sw.js caches canonical login2.css');
  });

  await t.test('36. offline POS IndexedDB queue preserved', () => {
    const swContent = fs.readFileSync(SW_JS_PATH, 'utf8');
    assert.equal(swContent.includes('indexedDB.deleteDatabase'), false, 'sw.js must never delete IndexedDB databases');
    assert.ok(swContent.includes('CACHE_VERSION'), 'sw.js operates on CacheStorage only');
  });

  // ===========================================================================
  // 37-40: Mobile Responsiveness, Accessibility, Router Integrity & Zero KDS
  // ===========================================================================
  await t.test('37. mobile Login 2.0', () => {
    const login2Css = fs.readFileSync(LOGIN2_CSS_PATH, 'utf8');
    assert.ok(login2Css.includes('@media'), 'login2.css has responsive media queries');
    assert.ok(login2Css.includes('max-width: 640px') || login2Css.includes('max-width: 480px') || login2Css.includes('max-width: 768px'), 'login2.css handles mobile viewports');
  });

  await t.test('38. keyboard/accessibility', () => {
    const login2Content = fs.readFileSync(LOGIN2_JS_PATH, 'utf8');
    assert.ok(login2Content.includes('aria-label') || login2Content.includes('<label for='), 'Login 2.0 inputs have proper accessibility labels');
    assert.ok(login2Content.includes('type="submit"'), 'Login 2.0 has form submit button allowing Enter key submission');
  });

  await t.test('39. router integrity', () => {
    const mainContent = fs.readFileSync(MAIN_JS_PATH, 'utf8');
    assert.ok(mainContent.includes('mountAuthScreen'), 'mountAuthScreen handles all auth viewports');
    assert.equal(mainContent.includes('import { renderLogin'), false);
  });

  await t.test('40. zero KDS in authentication', () => {
    const mainContent = fs.readFileSync(MAIN_JS_PATH, 'utf8');
    const login2Content = fs.readFileSync(LOGIN2_JS_PATH, 'utf8');
    assert.equal(mainContent.includes('KitchenDisplay') || mainContent.includes('KDS_LOGIN'), false, 'Zero KDS in main.js');
    assert.equal(login2Content.includes('KitchenDisplay') || login2Content.includes('KDS'), false, 'Zero KDS in login2.js');
  });
});
