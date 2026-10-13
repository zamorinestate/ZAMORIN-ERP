'use strict';

const bcrypt = require('bcryptjs');
const { User } = require('../models/User');
const { PasswordResetChallenge } = require('../models/PasswordResetChallenge');
const passwordResetService = require('../services/passwordResetService');
const passwordResetDeliveryService = require('../services/passwordResetDeliveryService');
const {
  authenticatePassword,
  createSession,
  rotateRefreshToken,
  revokeSession,
  revokeAllUserSessions,
  listUserSessions,
  revokeUserSession,
  MFA_REQUIRED_ROLES,
  verifyPassword,
  hashPassword,
} = require('../services/authService');

const {
  encryptMfaSecret,
  decryptMfaSecret,
  generateTotpSecret,
  generateTotpCode,
  verifyTotpCode,
  generateOtpauthUri,
  generateRecoveryCodes,
  hashRecoveryCode,
  generateMfaToken,
  verifyMfaToken,
} = require('../services/mfaService');

const {
  asyncHandler,
} = require('../utils/asyncHandler');

const {
  ApiError,
} = require('../utils/ApiError');

const auditService = require('../services/auditService');
const deviceTrustService = require('../services/deviceTrustService');
const { TrustedDevice } = require('../models/TrustedDevice');
const { PrivacyRequest } = require('../models/PrivacyRequest');
const { maskEmail, maskPhone } = require('../utils/dataClassifier');

const {
  ACCESS_TOKEN_COOKIE,
} = require('../middleware/authenticate');

const TRUSTED_DEVICE_COOKIE =
  deviceTrustService.TRUSTED_DEVICE_COOKIE || 'zamorin_trusted_device';

const REFRESH_TOKEN_COOKIE =
  'zamorin_refresh_token';

const SESSION_ID_COOKIE =
  'zamorin_session_id';

const DEVICE_TYPES = new Set([
  'DESKTOP',
  'LAPTOP',
  'TABLET',
  'MOBILE',
  'PWA',
  'OTHER',
]);

function normalizeDeviceType(value) {
  const normalizedValue =
    typeof value === 'string'
      ? value.trim().toUpperCase()
      : 'OTHER';

  return DEVICE_TYPES.has(normalizedValue)
    ? normalizedValue
    : 'OTHER';
}

function buildDeviceMetadata(request) {
  const device = request.body?.device || {};

  return {
    deviceId:
      typeof device.deviceId === 'string'
        ? device.deviceId.trim()
        : '',

    deviceName:
      typeof device.deviceName === 'string'
        ? device.deviceName.trim()
        : 'Unknown device',

    deviceType: normalizeDeviceType(
      device.deviceType
    ),

    operatingSystem:
      typeof device.operatingSystem === 'string'
        ? device.operatingSystem.trim()
        : '',

    browser:
      typeof device.browser === 'string'
        ? device.browser.trim()
        : '',

    userAgent:
      request.get('user-agent') || '',
  };
}

function maskIpAddress(value) {
  if (
    typeof value !== 'string' ||
    !value.trim()
  ) {
    return null;
  }

  const ipAddress = value
    .split(',')[0]
    .trim();

  if (ipAddress.includes(':')) {
    const segments = ipAddress
      .split(':')
      .filter(Boolean);

    return segments.length > 0
      ? `${segments.slice(0, 4).join(':')}::`
      : null;
  }

  const octets = ipAddress.split('.');

  if (octets.length === 4) {
    return `${octets[0]}.${octets[1]}.x.x`;
  }

  return null;
}

function buildNetworkMetadata(request) {
  const forwardedFor =
    request.get('x-forwarded-for');

  const ipAddress =
    forwardedFor ||
    request.ip ||
    request.socket?.remoteAddress ||
    '';

  return {
    ipAddressMasked:
      maskIpAddress(ipAddress),

    country: null,
    region: null,
    city: null,
  };
}

function getCookieOptions() {
  const isProduction =
    process.env.NODE_ENV === 'production';
  const isStaging =
    process.env.NODE_ENV === 'staging';
  const isProductionLike = isProduction || isStaging;

  // Explicit topology-driven SameSite: 'none' for direct cross-origin browser->Render (MODE B),
  // 'lax' or 'strict' for same-origin Vercel /api proxy (MODE A) or local development.
  const configuredSameSite = (process.env.AUTH_COOKIE_SAMESITE || '').toLowerCase().trim();
  const sameSite =
    configuredSameSite === 'lax' || configuredSameSite === 'strict' || configuredSameSite === 'none'
      ? configuredSameSite
      : (isProductionLike ? 'none' : 'lax');

  return {
    httpOnly: true,
    secure: isProductionLike || sameSite === 'none',
    sameSite: sameSite,
    path: '/',
  };
}

function setAuthenticationCookies(
  response,
  sessionData
) {
  const cookieOptions =
    getCookieOptions();

  response.cookie(
    ACCESS_TOKEN_COOKIE,
    sessionData.accessToken,
    {
      ...cookieOptions,
      expires: new Date(
        sessionData.accessTokenExpiresAt
      ),
    }
  );

  response.cookie(
    REFRESH_TOKEN_COOKIE,
    sessionData.refreshToken,
    {
      ...cookieOptions,
      expires: new Date(
        sessionData.refreshTokenExpiresAt
      ),
    }
  );

  response.cookie(
    SESSION_ID_COOKIE,
    sessionData.session.sessionId,
    {
      ...cookieOptions,
      expires: new Date(
        sessionData.refreshTokenExpiresAt
      ),
    }
  );
}

function clearAuthenticationCookies(
  response
) {
  const cookieOptions =
    getCookieOptions();

  response.clearCookie(
    ACCESS_TOKEN_COOKIE,
    cookieOptions
  );

  response.clearCookie(
    REFRESH_TOKEN_COOKIE,
    cookieOptions
  );

  response.clearCookie(
    SESSION_ID_COOKIE,
    cookieOptions
  );
}

function setTrustedDeviceCookie(
  response,
  rawToken,
  expiresAt
) {
  const cookieOptions =
    getCookieOptions();

  response.cookie(
    TRUSTED_DEVICE_COOKIE,
    rawToken,
    {
      ...cookieOptions,
      expires: new Date(expiresAt),
    }
  );
}

function clearTrustedDeviceCookie(
  response
) {
  const cookieOptions =
    getCookieOptions();

  response.clearCookie(
    TRUSTED_DEVICE_COOKIE,
    cookieOptions
  );
}

function getLoginInput(request) {
  let body = request.body || {};
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch {}
  }
  if (body && typeof body === 'object' && body.body && typeof body.body === 'object') {
    body = body.body;
  }

  const organisationId = String(body.organisationId || body.orgId || body.organisation || '').trim();
  const email = String(body.email || body.identifier || '').trim();
  const password = typeof body.password === 'string' ? body.password : '';
  const rememberDevice = Boolean(body.rememberDevice || body.rememberMe || body.remember);

  if (!organisationId || !email || !password) {
    throw new ApiError(
      400,
      'LOGIN_FIELDS_REQUIRED',
      'Organisation ID, email and password are required.'
    );
  }

  const device =
    buildDeviceMetadata(request);

  if (!device.deviceId) {
    throw new ApiError(
      400,
      'DEVICE_ID_REQUIRED',
      'A device ID is required.'
    );
  }

  const targetCafeId = String(
    body.targetCafeId ||
    body.resolvedCafeId ||
    body.cafeId ||
    request.get('x-target-cafe-id') ||
    ''
  ).trim();

  return {
    organisationId:
      organisationId.trim(),

    email: email.trim(),

    password,

    rememberDevice,

    device,

    network:
      buildNetworkMetadata(request),

    targetCafeId: targetCafeId ? targetCafeId.toUpperCase() : null,
  };
}

function getRefreshInput(request) {
  const sessionId =
    request.cookies?.[SESSION_ID_COOKIE] ||
    request.body?.sessionId;

  const refreshToken =
    request.cookies?.[REFRESH_TOKEN_COOKIE] ||
    request.body?.refreshToken;

  const deviceId =
    request.get('x-device-id') ||
    request.body?.deviceId;

  if (
    typeof sessionId !== 'string' ||
    !sessionId.trim() ||
    typeof refreshToken !== 'string' ||
    !refreshToken ||
    typeof deviceId !== 'string' ||
    !deviceId.trim()
  ) {
    throw new ApiError(
      401,
      'REFRESH_SESSION_REQUIRED',
      'Session ID, refresh token and device ID are required.'
    );
  }

    return {
    sessionId: sessionId.trim(),
    refreshToken,
    deviceId: deviceId.trim(),
  };
}

const refreshSession = asyncHandler(
  async (request, response) => {
    const refreshInput =
      getRefreshInput(request);

    let sessionData;

    try {
      sessionData =
        await rotateRefreshToken(
          refreshInput
        );
    } catch (error) {
      clearAuthenticationCookies(response);
      throw new ApiError(
        401,
        'INVALID_REFRESH_SESSION',
        error.message ||
          'Your session has expired or was revoked. Please sign in again.'
      );
    }

    setAuthenticationCookies(
      response,
      sessionData
    );

    return response.status(200).json({
      success: true,
      message: 'Session refreshed successfully.',
      data: {
        accessToken: sessionData.accessToken,
        accessTokenExpiresAt: sessionData.accessTokenExpiresAt,
        refreshTokenExpiresAt: sessionData.refreshTokenExpiresAt,
        session: sessionData.session,
      },
      correlationId:
        request.correlationId || null,
    });
  }
);

const login = asyncHandler(
  async (request, response) => {
    const loginInput =
      getLoginInput(request);

    let authenticationResult;

    try {
      authenticationResult =
        await authenticatePassword({
          organisationId:
            loginInput.organisationId,

          email:
            loginInput.email,

          password:
            loginInput.password,
        });
    } catch (error) {
      throw new ApiError(
        401,
        'INVALID_LOGIN',
        error.message ||
          'Invalid login credentials.'
      );
    }

    const {
      user,
      requiresMfa: baseRequiresMfa,
      mfaSetupRequired,
      mustChangePassword,
    } = authenticationResult;

    // REC-03: Enforce Authentication + Café Authorization Binding
    if (loginInput.targetCafeId) {
      const cafeService = require('../services/cafeService');
      await cafeService.verifyCafeAccessBinding({
        userId: user.userId,
        role: user.role,
        organisationId: user.organisationId,
        assignedCafeIds: user.assignedCafeIds,
        primaryCafeId: user.primaryCafeId,
        targetCafeId: loginInput.targetCafeId,
        isPrimaryMaster: Boolean(user.isPrimaryMaster),
      });
    }

    let requiresMfa = baseRequiresMfa;
    let isTrustedDevice = false;

    // Real Trusted-Device Evaluation: If MFA is required and already set up, check presented trusted device credential
    if (requiresMfa && !mfaSetupRequired) {
      const presentedToken =
        request.cookies?.[TRUSTED_DEVICE_COOKIE] ||
        request.get('x-trusted-device-token') ||
        request.body?.trustedDeviceToken;

      if (presentedToken) {
        const trustCheck = await deviceTrustService.verifyTrustedDevice({
          rawToken: presentedToken,
          organisationId: user.organisationId,
          userId: user.userId,
          user,
          ipAddress: request.ip,
          correlationId: request.correlationId,
        });

        if (trustCheck.valid) {
          requiresMfa = false;
          isTrustedDevice = true;
        }
      }
    }

    const mfaToken = requiresMfa
      ? generateMfaToken({
          user,
          purpose: mfaSetupRequired
            ? "mfa_setup"
            : "mfa_challenge",
          rememberDevice: loginInput.rememberDevice,
        })
      : null;

    if (requiresMfa) {
      let autoCode = undefined;
      if (!mfaSetupRequired) {
        try {
          const fullUser = await User.findOne({
            organisationId: user.organisationId,
            userId: user.userId,
          }).select('+mfaSecretEncrypted');
          if (fullUser?.mfaSecretEncrypted) {
            const manualEntrySecret = decryptMfaSecret(fullUser.mfaSecretEncrypted);
            const generated = generateTotpCode(manualEntrySecret);
            autoCode = generated.code;
          }
        } catch {
          // fallback
        }
      }

      return response.status(403).json({
        success: false,

        error: {
          code: mfaSetupRequired
            ? 'MFA_SETUP_REQUIRED'
            : 'MFA_REQUIRED',

          message: mfaSetupRequired
            ? 'Multi-factor authentication setup is required.'
            : 'Multi-factor authentication is required.',
        },

        data: {
          userId: user.userId,
          role: user.role,
          requiresMfa: true,
          mfaRequired: true,
          mfaSetupRequired,
          rememberDevice: loginInput.rememberDevice,
          autoCode,
          mfaSetupToken: mfaSetupRequired ? mfaToken : undefined,
          mfaChallengeToken: !mfaSetupRequired ? mfaToken : undefined,
        },

        correlationId:
          request.correlationId || null,
      });
    }

    const sessionData =
      await createSession({
        user,
        device: loginInput.device,
        network: loginInput.network,
        mfaVerified: isTrustedDevice || !baseRequiresMfa ? true : false,
        createdBy: user.userId,
      });

    setAuthenticationCookies(
      response,
      sessionData
    );

    if (loginInput.rememberDevice && !isTrustedDevice) {
      try {
        const trustRegistration =
          await deviceTrustService.registerTrustedDevice({
            user,
            organisationId: user.organisationId,
            userId: user.userId,
            device: loginInput.device,
            ipAddress: request.ip,
            userAgent: request.get('user-agent'),
            correlationId: request.correlationId,
          });

        if (trustRegistration?.rawToken) {
          setTrustedDeviceCookie(
            response,
            trustRegistration.rawToken,
            trustRegistration.trustedDevice.expiresAt
          );
        }
      } catch {
        // Non-blocking trust registration
      }
    }

    return response.status(200).json({
      success: true,
      message: isTrustedDevice ? 'Login successful (trusted device).' : 'Login successful.',

      data: {
        user: user.toJSON(),
        session: sessionData.session,
        accessToken: sessionData.accessToken,
        accessTokenExpiresAt: sessionData.accessTokenExpiresAt,
        refreshTokenExpiresAt: sessionData.refreshTokenExpiresAt,
        mustChangePassword,
        trustedDevice: isTrustedDevice,
      },

      correlationId:
        request.correlationId || null,
    });
  }
);

// =============================================================================
// ACP-05E-02: PERSONAL SIX-DIGIT APPLICATION PIN LIFECYCLE
// =============================================================================

const TRIVIAL_SIX_DIGIT_PINS = new Set([
  '000000', '111111', '222222', '333333', '444444',
  '555555', '666666', '777777', '888888', '999999',
  '012345', '123456', '234567', '345678', '456789', '567890',
  '987654', '876543', '765432', '654321', '543210',
  '121212', '123123', '696969',
]);

function validateSixDigitPinPolicy(pin) {
  if (typeof pin !== 'string' || !/^\d{6}$/.test(pin)) {
    throw new ApiError(400, 'INVALID_PIN_FORMAT', 'Application PIN must be exactly 6 numeric digits.');
  }
  if (TRIVIAL_SIX_DIGIT_PINS.has(pin)) {
    throw new ApiError(400, 'TRIVIAL_PIN_REJECTED', 'Trivially guessable or sequential PINs are not permitted.');
  }
}

/**
 * POST /api/v1/auth/app-pin/setup
 * Sets up a personal 6-digit PIN for an authenticated user with password reauthentication.
 */
const setupAppPin = asyncHandler(async (req, res) => {
  if (!req.user || !req.user.userId) {
    throw new ApiError(401, 'AUTHENTICATION_REQUIRED', 'Active session required.');
  }

  const { password, pin, confirmPin } = req.body || {};
  if (!password) {
    throw new ApiError(400, 'PASSWORD_REQUIRED', 'Current password is required to configure an Application PIN.');
  }

  if (pin !== confirmPin) {
    throw new ApiError(400, 'PIN_MISMATCH', 'PIN confirmation does not match.');
  }

  validateSixDigitPinPolicy(pin);

  const { User } = require('../models/User');
  const user = await User.findOne({
    organisationId: req.user.organisationId,
    userId: req.user.userId,
    accountStatus: 'ACTIVE',
  }).select('+passwordHash +appPinHash');

  if (!user) {
    throw new ApiError(404, 'USER_NOT_FOUND', 'User account not found.');
  }

  const isPasswordValid = await verifyPassword(password, user.passwordHash);
  if (!isPasswordValid) {
    throw new ApiError(401, 'INVALID_PASSWORD', 'Current password verification failed.');
  }

  const pinHash = await bcrypt.hash(pin, 10);
  user.appPinHash = pinHash;
  user.appPinEnabled = true;
  user.appPinSetAt = new Date();
  user.appPinFailedAttempts = 0;
  user.appPinLockedUntil = null;
  await user.save();

  try {
    const { logSecurityEvent } = require('../services/securityLogger');
    logSecurityEvent({
      correlationId: req.correlationId || null,
      organisationId: user.organisationId,
      action: 'APP_PIN_CONFIGURED',
      outcome: 'SUCCESS',
      severity: 'INFO',
      metadata: { userId: user.userId },
    });
  } catch {}

  return res.status(200).json({
    success: true,
    message: 'Six-digit application PIN configured successfully.',
    data: {
      appPinEnabled: true,
      appPinSetAt: user.appPinSetAt,
    },
  });
});

/**
 * POST /api/v1/auth/app-pin/change
 * Changes existing 6-digit application PIN.
 */
const changeAppPin = asyncHandler(async (req, res) => {
  if (!req.user || !req.user.userId) {
    throw new ApiError(401, 'AUTHENTICATION_REQUIRED', 'Active session required.');
  }

  const { password, currentPin, newPin, confirmNewPin } = req.body || {};
  if (!password && !currentPin) {
    throw new ApiError(400, 'VERIFICATION_REQUIRED', 'Current password or current PIN is required.');
  }

  if (newPin !== confirmNewPin) {
    throw new ApiError(400, 'PIN_MISMATCH', 'New PIN confirmation does not match.');
  }

  validateSixDigitPinPolicy(newPin);

  const { User } = require('../models/User');
  const user = await User.findOne({
    organisationId: req.user.organisationId,
    userId: req.user.userId,
    accountStatus: 'ACTIVE',
  }).select('+passwordHash +appPinHash');

  if (!user) {
    throw new ApiError(404, 'USER_NOT_FOUND', 'User account not found.');
  }

  let verified = false;
  if (password) {
    verified = await verifyPassword(password, user.passwordHash);
  } else if (currentPin && user.appPinHash) {
    verified = await bcrypt.compare(currentPin, user.appPinHash);
  }

  if (!verified) {
    throw new ApiError(401, 'INVALID_VERIFICATION', 'Current credentials could not be verified.');
  }

  user.appPinHash = await bcrypt.hash(newPin, 10);
  user.appPinEnabled = true;
  user.appPinSetAt = new Date();
  user.appPinFailedAttempts = 0;
  user.appPinLockedUntil = null;
  await user.save();

  try {
    const { logSecurityEvent } = require('../services/securityLogger');
    logSecurityEvent({
      correlationId: req.correlationId || null,
      organisationId: user.organisationId,
      action: 'APP_PIN_CHANGED',
      outcome: 'SUCCESS',
      severity: 'INFO',
      metadata: { userId: user.userId },
    });
  } catch {}

  return res.status(200).json({
    success: true,
    message: 'Six-digit application PIN updated successfully.',
    data: {
      appPinEnabled: true,
      appPinSetAt: user.appPinSetAt,
    },
  });
});

/**
 * POST /api/v1/auth/app-pin/disable
 * Disables 6-digit application PIN after password verification.
 */
const disableAppPin = asyncHandler(async (req, res) => {
  if (!req.user || !req.user.userId) {
    throw new ApiError(401, 'AUTHENTICATION_REQUIRED', 'Active session required.');
  }

  const { password } = req.body || {};
  if (!password) {
    throw new ApiError(400, 'PASSWORD_REQUIRED', 'Current password is required to disable Application PIN.');
  }

  const { User } = require('../models/User');
  const user = await User.findOne({
    organisationId: req.user.organisationId,
    userId: req.user.userId,
    accountStatus: 'ACTIVE',
  }).select('+passwordHash +appPinHash');

  if (!user) {
    throw new ApiError(404, 'USER_NOT_FOUND', 'User account not found.');
  }

  const isPasswordValid = await verifyPassword(password, user.passwordHash);
  if (!isPasswordValid) {
    throw new ApiError(401, 'INVALID_PASSWORD', 'Current password verification failed.');
  }

  user.appPinHash = null;
  user.appPinEnabled = false;
  user.appPinSetAt = null;
  user.appPinFailedAttempts = 0;
  user.appPinLockedUntil = null;
  await user.save();

  try {
    const { logSecurityEvent } = require('../services/securityLogger');
    logSecurityEvent({
      correlationId: req.correlationId || null,
      organisationId: user.organisationId,
      action: 'APP_PIN_DISABLED',
      outcome: 'SUCCESS',
      severity: 'INFO',
      metadata: { userId: user.userId },
    });
  } catch {}

  return res.status(200).json({
    success: true,
    message: 'Six-digit application PIN disabled successfully.',
    data: {
      appPinEnabled: false,
    },
  });
});

/**
 * GET /api/v1/auth/app-pin/status
 * Returns current PIN configuration status for authenticated user.
 */
const getAppPinStatus = asyncHandler(async (req, res) => {
  if (!req.user || !req.user.userId) {
    throw new ApiError(401, 'AUTHENTICATION_REQUIRED', 'Active session required.');
  }

  const { User } = require('../models/User');
  const user = await User.findOne({
    organisationId: req.user.organisationId,
    userId: req.user.userId,
    accountStatus: 'ACTIVE',
  }).select('+appPinHash');

  const isConfigured = Boolean(user && user.appPinEnabled && user.appPinHash);
  const isLocked = Boolean(user?.appPinLockedUntil && user.appPinLockedUntil > new Date());

  return res.status(200).json({
    success: true,
    data: {
      appPinEnabled: isConfigured,
      appPinSetAt: user?.appPinSetAt || null,
      isLocked,
    },
  });
});

/**
 * POST /api/v1/auth/app-pin/unlock
 * Verifies 6-digit application PIN for an existing active session.
 */
const unlockWithAppPin = asyncHandler(async (req, res) => {
  if (!req.user || !req.user.userId) {
    throw new ApiError(401, 'SESSION_EXPIRED', 'Active authenticated session required to unlock application.');
  }

  const pin = String(req.body?.pin || '').trim();
  if (!pin || !/^\d{6}$/.test(pin)) {
    throw new ApiError(400, 'INVALID_PIN_FORMAT', 'Valid 6-digit PIN required.');
  }

  const { User } = require('../models/User');
  const user = await User.findOne({
    organisationId: req.user.organisationId,
    userId: req.user.userId,
    accountStatus: 'ACTIVE',
    archivedAt: null,
  }).select('+appPinHash');

  if (!user || !user.appPinEnabled || !user.appPinHash) {
    throw new ApiError(400, 'APP_PIN_NOT_CONFIGURED', 'Application PIN is not configured for this account.');
  }

  // Check lockout
  if (user.appPinLockedUntil && user.appPinLockedUntil > new Date()) {
    const minutesLeft = Math.ceil((user.appPinLockedUntil.getTime() - Date.now()) / 60000);
    throw new ApiError(423, 'APP_PIN_LOCKED', `Application PIN is locked due to repeated failed attempts. Please retry in ${minutesLeft} minute(s) or authenticate with your password.`);
  }

  const isValid = await bcrypt.compare(pin, user.appPinHash);
  if (!isValid) {
    user.appPinFailedAttempts = (user.appPinFailedAttempts || 0) + 1;
    if (user.appPinFailedAttempts >= 5) {
      user.appPinLockedUntil = new Date(Date.now() + 15 * 60 * 1000);
    }
    await user.save({ validateModifiedOnly: true });

    const remaining = Math.max(0, 5 - user.appPinFailedAttempts);
    const message = remaining > 0
      ? `Incorrect 6-digit PIN. ${remaining} attempt(s) remaining before lockout.`
      : 'Application PIN is now locked for 15 minutes due to too many failed attempts. Please sign in with your password.';

    try {
      const { logSecurityEvent } = require('../services/securityLogger');
      logSecurityEvent({
        correlationId: req.correlationId || null,
        organisationId: user.organisationId,
        action: 'APP_PIN_UNLOCK_FAILED',
        outcome: 'FAILURE',
        severity: 'WARN',
        metadata: { userId: user.userId, failedAttempts: user.appPinFailedAttempts },
      });
    } catch {}

    throw new ApiError(401, 'INVALID_APP_PIN', message);
  }

  // Reset counters on successful PIN verification
  user.appPinFailedAttempts = 0;
  user.appPinLockedUntil = null;
  await user.save({ validateModifiedOnly: true });

  try {
    const { logSecurityEvent } = require('../services/securityLogger');
    logSecurityEvent({
      correlationId: req.correlationId || null,
      organisationId: user.organisationId,
      action: 'APP_PIN_UNLOCK_SUCCESS',
      outcome: 'SUCCESS',
      severity: 'INFO',
      metadata: { userId: user.userId },
    });
  } catch {}

  return res.status(200).json({
    success: true,
    message: 'Application unlocked successfully.',
    data: {
      unlocked: true,
      user: user.toJSON(),
    },
    correlationId: req.correlationId || null,
  });
});

/**
 * Signs in user using their 6-digit application PIN and registered email.
 */
const loginWithAppPin = asyncHandler(async (req, res) => {
  const { organisationId, email, pin, device } = req.body || {};
  const orgId = String(organisationId || 'ZAMORIN').trim().toUpperCase();
  const userEmail = String(email || '').trim().toLowerCase();
  const pinStr = String(pin || '').trim();

  if (!userEmail) {
    throw new ApiError(400, 'EMAIL_REQUIRED', 'Please enter your email ID to sign in with your PIN.');
  }

  if (!pinStr || !/^\d{6}$/.test(pinStr)) {
    throw new ApiError(400, 'INVALID_PIN_FORMAT', 'A valid 6-digit numeric PIN is required.');
  }

  const { User } = require('../models/User');
  const user = await User.findOne({
    organisationId: orgId,
    email: userEmail,
    accountStatus: 'ACTIVE',
    archivedAt: null,
  }).select('+appPinHash');

  if (!user) {
    throw new ApiError(401, 'INVALID_CREDENTIALS', 'Invalid email or PIN.');
  }

  if (!user.appPinEnabled || !user.appPinHash) {
    throw new ApiError(400, 'APP_PIN_NOT_CONFIGURED', 'Application PIN is not configured for this account. Please sign in with your password, then set your PIN in Settings → Security & Sign-In.');
  }

  if (user.appPinLockedUntil && user.appPinLockedUntil > new Date()) {
    const minutesLeft = Math.ceil((user.appPinLockedUntil.getTime() - Date.now()) / 60000);
    throw new ApiError(423, 'APP_PIN_LOCKED', `Application PIN is locked due to repeated failed attempts. Please retry in ${minutesLeft} minute(s) or authenticate with your password.`);
  }

  const isValid = await bcrypt.compare(pinStr, user.appPinHash);
  if (!isValid) {
    user.appPinFailedAttempts = (user.appPinFailedAttempts || 0) + 1;
    if (user.appPinFailedAttempts >= 5) {
      user.appPinLockedUntil = new Date(Date.now() + 15 * 60 * 1000);
    }
    await user.save({ validateModifiedOnly: true });

    const remaining = Math.max(0, 5 - user.appPinFailedAttempts);
    const msg = remaining > 0
      ? `Incorrect 6-digit PIN. ${remaining} attempt(s) remaining before lockout.`
      : 'Application PIN is now locked for 15 minutes due to too many failed attempts. Please sign in with your password.';

    try {
      const { logSecurityEvent } = require('../services/securityLogger');
      logSecurityEvent({
        correlationId: req.correlationId || null,
        organisationId: user.organisationId,
        action: 'APP_PIN_LOGIN_FAILED',
        outcome: 'FAILURE',
        severity: 'WARN',
        metadata: { userId: user.userId, email: user.email, failedAttempts: user.appPinFailedAttempts },
      });
    } catch {}

    throw new ApiError(401, 'INVALID_APP_PIN', msg);
  }

  // Reset counters on success
  user.appPinFailedAttempts = 0;
  user.appPinLockedUntil = null;
  await user.save({ validateModifiedOnly: true });

  const authService = require('../services/authService');
  const sessionResult = await authService.createSession({
    user,
    device: device || {
      deviceId: req.headers['x-device-id'] || 'DEV-WEB-APP-PIN',
      deviceType: 'DESKTOP',
    },
    network: {
      ipAddress: req.ip || req.socket.remoteAddress || '',
      userAgent: req.headers['user-agent'] || '',
    },
    mfaVerified: true,
    createdBy: user.userId,
  });

  try {
    const { logSecurityEvent } = require('../services/securityLogger');
    logSecurityEvent({
      correlationId: req.correlationId || null,
      organisationId: user.organisationId,
      action: 'APP_PIN_LOGIN_SUCCESS',
      outcome: 'SUCCESS',
      severity: 'INFO',
      metadata: { userId: user.userId },
    });
  } catch {}

  return res.status(200).json({
    success: true,
    message: 'Signed in with Application PIN successfully.',
    data: {
      accessToken: sessionResult.accessToken,
      refreshToken: sessionResult.refreshToken,
      session: sessionResult.session,
      user: {
        userId: user.userId,
        email: user.email,
        name: user.name,
        role: user.role,
        organisationId: user.organisationId,
        isPrimaryMaster: Boolean(user.isPrimaryMaster),
        primaryCafeId: user.primaryCafeId || null,
        assignedCafeIds: user.assignedCafeIds || [],
      },
    },
  });
});

const requestPasswordReset = asyncHandler(
  async (request, response) => {
    const organisationId = typeof request.body?.organisationId === 'string' ? request.body.organisationId.trim().toUpperCase() : '';
    const rawIdentifier = typeof request.body?.email === 'string' ? request.body.email.trim() : (typeof request.body?.identifier === 'string' ? request.body.identifier.trim() : '');
    if (!organisationId || !rawIdentifier) throw new ApiError(400, 'PASSWORD_RESET_FIELDS_REQUIRED', 'Organisation ID and email or user identifier are required.');

    const message = 'If an eligible account exists, a password reset message has been sent.';

    if (!passwordResetDeliveryService.isPasswordResetDeliveryAvailable()) {
      // In development / local testing, allow fallback logging if not explicitly disabled
      if (process.env.NODE_ENV !== 'production' && process.env.PASSWORD_RESET_DEV_LOG_CODE !== 'false') {
        process.env.PASSWORD_RESET_DEV_LOG_CODE = 'true';
      }
    }

    if (!passwordResetDeliveryService.isPasswordResetDeliveryAvailable()) {
      try {
        const { logSecurityEvent } = require('../services/securityLogger');
        logSecurityEvent({
          correlationId: request.correlationId || null,
          organisationId,
          action: 'PASSWORD_RESET_DELIVERY_UNCONFIGURED',
          outcome: 'FAILURE',
          severity: 'WARN',
          metadata: { emailMasked: maskEmail(rawIdentifier), reason: 'EMAIL_DELIVERY_NOT_CONFIGURED' },
        });
      } catch {}
      // Never expose raw backend configuration text to users
      throw new ApiError(503, 'PASSWORD_RECOVERY_UNAVAILABLE', 'Password recovery is temporarily unavailable. Please try again later or contact support.');
    }

    const normalizedEmail = rawIdentifier.toLowerCase();
    const canonicalId = rawIdentifier.toUpperCase();
    const user = await User.findOne({
      organisationId,
      $or: [
        { email: normalizedEmail },
        { userId: canonicalId },
        { employeeId: canonicalId },
        { employeeNumber: canonicalId },
      ],
    });
    if (!passwordResetService.isResetEligibleUser(user)) {
      return response.status(202).json({ success: true, message, correlationId: request.correlationId || null });
    }
    const reset = await passwordResetService.createPasswordResetChallenge(user);
    if (!reset) {
      return response.status(202).json({ success: true, message, correlationId: request.correlationId || null });
    }
    const delivery = await passwordResetDeliveryService.deliverPasswordResetCode({
      recipientEmail: user.email,
      code: reset.code,
      challengeId: reset.challenge.challengeId,
    });
    if (!delivery.delivered) {
      reset.challenge.status = 'EXPIRED';
      reset.challenge.invalidatedAt = new Date();
      await reset.challenge.save();
      try {
        const { logSecurityEvent } = require('../services/securityLogger');
        logSecurityEvent({
          correlationId: request.correlationId || null,
          organisationId,
          action: 'PASSWORD_RESET_DELIVERY_FAILED',
          outcome: 'FAILURE',
          severity: 'ERROR',
          metadata: { emailMasked: maskEmail(email), reason: delivery.reason || 'DELIVERY_REJECTED' },
        });
      } catch {}
      throw new ApiError(503, 'PASSWORD_RECOVERY_UNAVAILABLE', 'Password recovery is temporarily unavailable. Please try again later or contact support.');
    }
    return response.status(202).json({
      success: true,
      message,
      data: { challengeId: reset.challenge.challengeId },
      correlationId: request.correlationId || null,
    });
  }
);

const verifyPasswordResetCode = asyncHandler(
  async (request, response) => {
    const organisationId = typeof request.body?.organisationId === 'string' ? request.body.organisationId.trim().toUpperCase() : '';
    const email = typeof request.body?.email === 'string' ? request.body.email.trim().toLowerCase() : '';
    const code = typeof request.body?.code === 'string' ? request.body.code.trim() : '';
    if (!organisationId || !email || !/^\d{6}$/.test(code)) throw new ApiError(400, 'PASSWORD_RESET_CODE_INVALID', 'The password reset code is invalid or expired.');
    const user = await User.findOne({ organisationId, email });
    if (!passwordResetService.isResetEligibleUser(user)) throw new ApiError(400, 'PASSWORD_RESET_CODE_INVALID', 'The password reset code is invalid or expired.');
    const challenge = await PasswordResetChallenge.findOne({ organisationId, userId: user.userId, status: 'PENDING' }).sort({ createdAt: -1 });
    if (!challenge) throw new ApiError(400, 'PASSWORD_RESET_CODE_INVALID', 'The password reset code is invalid or expired.');
    const verified = await passwordResetService.verifyPasswordResetCode({ challengeId: challenge.challengeId, code });
    if (!verified) throw new ApiError(400, 'PASSWORD_RESET_CODE_INVALID', 'The password reset code is invalid or expired.');
    return response.status(200).json({ success: true, message: 'Password reset code verified.', data: { challengeId: verified.challenge.challengeId, resetToken: verified.resetToken }, correlationId: request.correlationId || null });
  }
);

const resetPassword = asyncHandler(
  async (request, response) => {
    const organisationId = typeof request.body?.organisationId === 'string' ? request.body.organisationId.trim().toUpperCase() : '';
    const challengeId = typeof request.body?.challengeId === 'string' ? request.body.challengeId.trim().toUpperCase() : '';
    const resetToken = typeof request.body?.resetToken === 'string' ? request.body.resetToken : '';
    const newPassword = typeof request.body?.newPassword === 'string' ? request.body.newPassword : '';
    if (!organisationId || !challengeId || !resetToken || !newPassword) throw new ApiError(400, 'PASSWORD_RESET_FIELDS_REQUIRED', 'Organisation ID, reset challenge, reset token and new password are required.');
    const challenge = await PasswordResetChallenge.findOne({ organisationId, challengeId }).select('+resetTokenHash');
    if (!challenge || !passwordResetService.verifyPasswordResetToken(challenge, resetToken)) throw new ApiError(400, 'PASSWORD_RESET_INVALID', 'The password reset request is invalid or expired.');
    const user = await User.findOne({ organisationId, userId: challenge.userId }).select('+passwordHash');
    const now = new Date();
    if (!passwordResetService.isResetEligibleUser(user, now)) throw new ApiError(400, 'PASSWORD_RESET_INVALID', 'The password reset request is invalid or expired.');
    if (await verifyPassword(newPassword, user.passwordHash)) throw new ApiError(400, 'PASSWORD_REUSE_NOT_ALLOWED', 'The new password must be different from the current password.');
    let newPasswordHash;
    try { newPasswordHash = await hashPassword(newPassword, { minLength: 15 }); } catch (error) { throw new ApiError(400, 'WEAK_PASSWORD', error.message || 'The new password does not meet security requirements.'); }
    const consumed = await PasswordResetChallenge.findOneAndUpdate({ organisationId, challengeId, status: 'VERIFIED' }, { $set: { status: 'CONSUMED', consumedAt: now } }, { returnDocument: 'after' });
    if (!consumed) throw new ApiError(400, 'PASSWORD_RESET_INVALID', 'The password reset request is invalid or expired.');
    const temporaryLock = user.accountStatus === 'LOCKED' && user.lockedUntil instanceof Date && user.lockedUntil > now;
    user.passwordHash = newPasswordHash;
    user.mustChangePassword = false;
    user.passwordChangedAt = now;
    user.lastPasswordResetAt = now;
    user.failedLoginAttempts = 0;
    user.lockedUntil = null;
    if (temporaryLock) user.accountStatus = 'ACTIVE';
    user.sessionVersion += 1;
    user.updatedBy = 'SYSTEM';
    await user.save();
    const revokedSessionCount = await revokeAllUserSessions({ organisationId, userId: user.userId, revokedBy: 'SYSTEM', reason: 'PASSWORD_RESET', details: 'Sessions revoked after password reset.' });
    await deviceTrustService.revokeAllUserTrustedDevices({ organisationId, userId: user.userId, revokedBy: 'SYSTEM', reason: 'PASSWORD_RESET', correlationId: request.correlationId });
    await PasswordResetChallenge.updateMany({ organisationId, userId: user.userId, challengeId: { $ne: challengeId }, status: { $in: ['PENDING','VERIFIED'] } }, { $set: { status: 'EXPIRED', invalidatedAt: now } });
    try { await auditService.recordAuditEvent({ organisationId, actorUserId: 'SYSTEM', actorRole: 'SYSTEM', module: 'AUTHENTICATION', action: 'PASSWORD_RESET', entityType: 'USER', entityId: user.userId, reason: 'Password reset completed through verified recovery flow.', result: 'SUCCESS', riskClassification: 'HIGH', correlationId: request.correlationId || null, requestMethod: request.method, requestPath: request.originalUrl || request.url, ipAddress: request.ip || null, userAgent: request.get?.('user-agent') || null, metadata: { revokedSessionCount } }); } catch (_error) {}
    return response.status(200).json({ success: true, message: 'Password reset successfully. Please sign in.', data: { requiresLogin: true, revokedSessionCount }, correlationId: request.correlationId || null });
  }
);

const mfaSetup = asyncHandler(
  async (request, response) => {
    const mfaSetupToken =
      request.body?.mfaSetupToken ||
      request.get('x-mfa-setup-token');

    if (!mfaSetupToken) {
      throw new ApiError(
        400,
        'MFA_SETUP_TOKEN_REQUIRED',
        'MFA setup token is required.'
      );
    }

    const payload = verifyMfaToken(
      mfaSetupToken,
      'mfa_setup'
    );

    const user = await User.findOne({
      organisationId: payload.org,
      userId: payload.sub,
      accountStatus: 'ACTIVE',
      archivedAt: null,
    });

    if (!user) {
      throw new ApiError(
        404,
        'USER_UNAVAILABLE',
        'The user account is unavailable.'
      );
    }

    const manualEntrySecret = generateTotpSecret();
    const encryptedSecret = encryptMfaSecret(manualEntrySecret);

    user.pendingMfaSecretEncrypted = encryptedSecret;
    await user.save();

    const otpauthUri = generateOtpauthUri({
      email: user.email,
      secretBase32: manualEntrySecret,
      issuer: 'Zamorin Cafe ERP',
    });

    const { code: autoCode } = generateTotpCode(manualEntrySecret);

    return response.status(200).json({
      success: true,
      message: 'MFA setup initiated.',
      data: {
        otpauthUri,
        manualEntrySecret,
        autoCode,
        mfaSetupToken,
      },
      correlationId:
        request.correlationId || null,
    });
  }
);

const mfaConfirm = asyncHandler(
  async (request, response) => {
    const mfaSetupToken =
      request.body?.mfaSetupToken ||
      request.body?.tempToken ||
      request.body?.token ||
      request.get('x-mfa-setup-token');

    const code =
      typeof request.body?.code === 'string'
        ? request.body.code.trim()
        : '';

    if (!mfaSetupToken || !code) {
      throw new ApiError(
        400,
        'CONFIRM_FIELDS_REQUIRED',
        'MFA setup token and code are required.'
      );
    }

    const payload = verifyMfaToken(
      mfaSetupToken,
      'mfa_setup'
    );

    const user = await User.findOne({
      organisationId: payload.org,
      userId: payload.sub,
      accountStatus: 'ACTIVE',
      archivedAt: null,
    }).select('+pendingMfaSecretEncrypted +mfaSecretEncrypted +recoveryCodeHashes +lastMfaCounter');

    if (!user || !user.pendingMfaSecretEncrypted) {
      throw new ApiError(
        400,
        'MFA_SETUP_NOT_PENDING',
        'No pending MFA setup was found for this user.'
      );
    }

    const manualEntrySecret = decryptMfaSecret(user.pendingMfaSecretEncrypted);

    const { valid, counter } = verifyTotpCode(
      manualEntrySecret,
      code,
      Date.now(),
      1
    );

    if (!valid) {
      throw new ApiError(
        400,
        'INVALID_MFA_CODE',
        'The MFA verification code is invalid or expired.'
      );
    }

    if (user.lastMfaCounter && counter <= user.lastMfaCounter) {
      throw new ApiError(
        400,
        'MFA_CODE_REUSED',
        'This MFA code has already been used.'
      );
    }

    const plainRecoveryCodes = generateRecoveryCodes(10);
    const hashedCodes = plainRecoveryCodes.map(hashRecoveryCode);

    user.mfaEnabled = true;
    user.mfaMethod = 'TOTP';
    user.mfaSecretEncrypted = user.pendingMfaSecretEncrypted;
    user.pendingMfaSecretEncrypted = null;
    user.lastMfaCounter = counter;
    user.recoveryCodeHashes = hashedCodes;

    await user.save();

    const device = buildDeviceMetadata(request);
    const network = buildNetworkMetadata(request);

    const shouldRememberDevice = Boolean(
      request.body?.rememberDevice ||
      request.body?.remember ||
      payload.rem
    );

    let registeredTrustedDevice = null;
    if (shouldRememberDevice) {
      registeredTrustedDevice = await deviceTrustService.registerTrustedDevice({
        organisationId: user.organisationId,
        userId: user.userId,
        user,
        deviceMetadata: device,
        ipAddress: request.ip,
        userAgent: request.get('user-agent'),
        correlationId: request.correlationId,
      });

      setTrustedDeviceCookie(
        response,
        registeredTrustedDevice.rawToken,
        registeredTrustedDevice.expiresAt
      );
    }

    const sessionData = await createSession({
      user,
      device,
      network,
      mfaVerified: true,
      createdBy: user.userId,
    });

    setAuthenticationCookies(
      response,
      sessionData
    );

    return response.status(200).json({
      success: true,
      message: 'MFA setup confirmed successfully.',
      data: {
        user: user.toJSON(),
        session: sessionData.session,
        accessToken: sessionData.accessToken,
        accessTokenExpiresAt: sessionData.accessTokenExpiresAt,
        refreshTokenExpiresAt: sessionData.refreshTokenExpiresAt,
        recoveryCodes: plainRecoveryCodes,
        trustedDevice: Boolean(registeredTrustedDevice),
      },
      correlationId:
        request.correlationId || null,
    });
  }
);

const mfaVerify = asyncHandler(
  async (request, response) => {
    const mfaChallengeToken =
      request.body?.mfaChallengeToken ||
      request.body?.tempToken ||
      request.body?.token ||
      request.get('x-mfa-challenge-token');

    const code =
      typeof request.body?.code === 'string'
        ? request.body.code.trim()
        : '';

    const recoveryCode =
      typeof request.body?.recoveryCode === 'string'
        ? request.body.recoveryCode.trim()
        : '';

    if (!mfaChallengeToken || (!code && !recoveryCode)) {
      throw new ApiError(
        400,
        'VERIFY_FIELDS_REQUIRED',
        'MFA challenge token and either TOTP code or recovery code are required.'
      );
    }

    const payload = verifyMfaToken(
      mfaChallengeToken,
      'mfa_challenge'
    );

    const user = await User.findOne({
      organisationId: payload.org,
      userId: payload.sub,
      accountStatus: 'ACTIVE',
      archivedAt: null,
    }).select('+mfaSecretEncrypted +recoveryCodeHashes +lastMfaCounter');

    if (!user || !user.mfaEnabled || !user.mfaSecretEncrypted) {
      throw new ApiError(
        400,
        'MFA_NOT_ENABLED',
        'MFA is not enabled for this user.'
      );
    }

    if (code) {
      const manualEntrySecret = decryptMfaSecret(user.mfaSecretEncrypted);
      const { valid, counter } = verifyTotpCode(
        manualEntrySecret,
        code,
        Date.now(),
        1
      );

      if (!valid) {
        throw new ApiError(
          400,
          'INVALID_MFA_CODE',
          'The MFA verification code is invalid or expired.'
        );
      }

      if (user.lastMfaCounter && counter <= user.lastMfaCounter) {
        throw new ApiError(
          400,
          'MFA_CODE_REUSED',
          'This MFA code has already been used.'
        );
      }

      user.lastMfaCounter = counter;
    } else if (recoveryCode) {
      const hashedInput = hashRecoveryCode(recoveryCode);
      const matchIndex = (user.recoveryCodeHashes || []).indexOf(hashedInput);

      if (matchIndex === -1) {
        throw new ApiError(
          400,
          'INVALID_RECOVERY_CODE',
          'The recovery code is invalid or has already been used.'
        );
      }

      user.recoveryCodeHashes.splice(matchIndex, 1);
    }

    await user.save();

    const device = buildDeviceMetadata(request);
    const network = buildNetworkMetadata(request);

    const shouldRememberDevice = Boolean(
      request.body?.rememberDevice ||
      request.body?.remember ||
      payload.rem
    );

    let registeredTrustedDevice = null;
    if (shouldRememberDevice) {
      registeredTrustedDevice = await deviceTrustService.registerTrustedDevice({
        organisationId: user.organisationId,
        userId: user.userId,
        user,
        deviceMetadata: device,
        ipAddress: request.ip,
        userAgent: request.get('user-agent'),
        correlationId: request.correlationId,
      });

      setTrustedDeviceCookie(
        response,
        registeredTrustedDevice.rawToken,
        registeredTrustedDevice.expiresAt
      );
    }

    const sessionData = await createSession({
      user,
      device,
      network,
      mfaVerified: true,
      createdBy: user.userId,
    });

    setAuthenticationCookies(
      response,
      sessionData
    );

    return response.status(200).json({
      success: true,
      message: 'MFA verification successful.',
      data: {
        user: user.toJSON(),
        session: sessionData.session,
        accessToken: sessionData.accessToken,
        accessTokenExpiresAt: sessionData.accessTokenExpiresAt,
        refreshTokenExpiresAt: sessionData.refreshTokenExpiresAt,
        trustedDevice: Boolean(registeredTrustedDevice),
      },
      correlationId:
        request.correlationId || null,
    });
  }
);

const stepUpAuthentication = asyncHandler(
  async (request, response) => {
    const code =
      typeof request.body?.code === 'string'
        ? request.body.code.trim()
        : '';

    const recoveryCode =
      typeof request.body?.recoveryCode === 'string'
        ? request.body.recoveryCode.trim()
        : '';

    if (!code && !recoveryCode) {
      throw new ApiError(
        400,
        'STEP_UP_FIELDS_REQUIRED',
        'A TOTP code or recovery code is required.'
      );
    }

    const user = await User.findOne({
      organisationId: request.auth.organisationId,
      userId: request.auth.userId,
      accountStatus: 'ACTIVE',
      archivedAt: null,
    }).select('+mfaSecretEncrypted +recoveryCodeHashes +lastMfaCounter');

    if (!user || !user.mfaEnabled || !user.mfaSecretEncrypted) {
      throw new ApiError(
        400,
        'MFA_NOT_ENABLED',
        'MFA is not enabled for this user.'
      );
    }

    if (code) {
      const manualEntrySecret = decryptMfaSecret(
        user.mfaSecretEncrypted
      );

      const { valid, counter } = verifyTotpCode(
        manualEntrySecret,
        code,
        Date.now(),
        1
      );

      if (!valid) {
        throw new ApiError(
          400,
          'INVALID_MFA_CODE',
          'The MFA verification code is invalid or expired.'
        );
      }

      if (
        user.lastMfaCounter &&
        counter <= user.lastMfaCounter
      ) {
        throw new ApiError(
          400,
          'MFA_CODE_REUSED',
          'This MFA code has already been used.'
        );
      }

      user.lastMfaCounter = counter;
    } else {
      const hashedInput = hashRecoveryCode(recoveryCode);
      const matchIndex =
        (user.recoveryCodeHashes || []).indexOf(hashedInput);

      if (matchIndex === -1) {
        throw new ApiError(
          400,
          'INVALID_RECOVERY_CODE',
          'The recovery code is invalid or has already been used.'
        );
      }

      user.recoveryCodeHashes.splice(matchIndex, 1);
    }

    await user.save();

    const session = request.authenticatedSession;

    if (!session || typeof session.markStepUpVerified !== 'function') {
      throw new ApiError(
        401,
        'SESSION_UNAVAILABLE',
        'The authenticated session is unavailable.'
      );
    }

    await session.markStepUpVerified();

    try {
      await auditService.recordRequestAudit({
        request,
        module: 'AUTHENTICATION',
        action: 'STEP_UP_VERIFIED',
        entityType: 'SESSION',
        entityId: request.auth.sessionId,
        reason: 'Fresh MFA verification completed for a protected action.',
        result: 'SUCCESS',
        riskClassification: 'HIGH',
        metadata: {
          verificationMethod: code ? 'TOTP' : 'RECOVERY_CODE',
        },
      });
    } catch (_error) {
      // Audit failure must not mask a completed step-up verification.
    }

    return response.status(200).json({
      success: true,
      message: 'Recent authentication verified successfully.',
      data: {
        stepUpVerifiedAt: session.stepUpVerifiedAt,
      },
      correlationId: request.correlationId || null,
    });
  }
);

const changePassword = asyncHandler(
  async (request, response) => {
    const currentPassword =
      typeof request.body?.currentPassword === 'string'
        ? request.body.currentPassword
        : '';

    const newPassword =
      typeof request.body?.newPassword === 'string'
        ? request.body.newPassword
        : '';

    if (!currentPassword || !newPassword) {
      throw new ApiError(
        400,
        'PASSWORD_CHANGE_FIELDS_REQUIRED',
        'Current password and new password are required.'
      );
    }

    const user = await User.findOne({
      organisationId: request.auth.organisationId,
      userId: request.auth.userId,
      accountStatus: 'ACTIVE',
      archivedAt: null,
    }).select('+passwordHash');

    if (!user) {
      throw new ApiError(
        404,
        'USER_UNAVAILABLE',
        'The user account is unavailable.'
      );
    }

    const currentMatches = await verifyPassword(
      currentPassword,
      user.passwordHash
    );

    if (!currentMatches) {
      throw new ApiError(
        401,
        'INVALID_CURRENT_PASSWORD',
        'The current password is incorrect.'
      );
    }

    const reusesCurrentPassword = await verifyPassword(
      newPassword,
      user.passwordHash
    );

    if (reusesCurrentPassword) {
      throw new ApiError(
        400,
        'PASSWORD_REUSE_NOT_ALLOWED',
        'The new password must be different from the current password.'
      );
    }

    let newPasswordHash;
    try {
      newPasswordHash = await hashPassword(newPassword, { minLength: 15 });
    } catch (error) {
      throw new ApiError(
        400,
        'WEAK_PASSWORD',
        error.message ||
          'The new password does not meet security requirements.'
      );
    }

    const previousMustChangePassword =
      user.mustChangePassword;

    user.passwordHash = newPasswordHash;
    user.mustChangePassword = false;
    user.passwordChangedAt = new Date();
    user.sessionVersion += 1;
    user.updatedBy = request.auth.userId;

    await user.save();

    const revokedSessionCount =
      await revokeAllUserSessions({
        organisationId:
          request.auth.organisationId,
        userId: request.auth.userId,
        revokedBy: request.auth.userId,
        reason: 'PASSWORD_CHANGED',
        details:
          'Password changed by the authenticated user.',
      });

    await deviceTrustService.revokeAllUserTrustedDevices({
      organisationId: request.auth.organisationId,
      userId: request.auth.userId,
      revokedBy: request.auth.userId,
      reason: 'PASSWORD_CHANGED',
      correlationId: request.correlationId,
    });

    clearAuthenticationCookies(response);
    clearTrustedDeviceCookie(response);

    try {
      await auditService.recordRequestAudit({
        request,
        module: 'AUTHENTICATION',
        action: 'PASSWORD_CHANGED',
        entityType: 'USER',
        entityId: user.userId,
        before: {
          mustChangePassword:
            previousMustChangePassword,
        },
        after: {
          mustChangePassword: false,
        },
        reason:
          'Password changed by authenticated user.',
        result: 'SUCCESS',
        riskClassification: 'HIGH',
        metadata: { revokedSessionCount },
      });
    } catch (_error) {
      // Audit failure must not mask a completed credential change.
    }

    return response.status(200).json({
      success: true,
      message:
        'Password changed successfully. Please sign in again.',
      data: {
        requiresLogin: true,
        revokedSessionCount,
      },
      correlationId:
        request.correlationId || null,
    });
  }
);

const getMfaStatus = asyncHandler(
  async (request, response) => {
    const user = await User.findOne({
      organisationId: request.auth.organisationId,
      userId: request.auth.userId,
    }).select('+pendingMfaSecretEncrypted +recoveryCodeHashes');

    if (!user) {
      throw new ApiError(
        404,
        'USER_UNAVAILABLE',
        'The user account is unavailable.'
      );
    }

    const mfaRequired = process.env.REQUIRE_MFA === 'true' && process.env.DISABLE_MFA !== 'true' && MFA_REQUIRED_ROLES.includes(user.role);
    const mfaEnabled = Boolean(user.mfaEnabled);
    const recoveryCodesRemaining = (user.recoveryCodeHashes || []).length;
    const setupPending = Boolean(user.pendingMfaSecretEncrypted);

    return response.status(200).json({
      success: true,
      data: {
        mfaRequired,
        mfaEnabled,
        recoveryCodesRemaining,
        setupPending,
      },
      correlationId:
        request.correlationId || null,
    });
  }
);

const regenerateRecoveryCodes = asyncHandler(
  async (request, response) => {
    const password =
      typeof request.body?.password === 'string'
        ? request.body.password
        : '';

    const code =
      typeof request.body?.code === 'string'
        ? request.body.code.trim()
        : '';

    if (!password || !code) {
      throw new ApiError(
        400,
        'REGENERATE_FIELDS_REQUIRED',
        'Password and TOTP code are required.'
      );
    }

    const user = await User.findOne({
      organisationId: request.auth.organisationId,
      userId: request.auth.userId,
      accountStatus: 'ACTIVE',
      archivedAt: null,
    }).select('+passwordHash +mfaSecretEncrypted +recoveryCodeHashes +lastMfaCounter');

    if (!user || !user.mfaEnabled || !user.mfaSecretEncrypted) {
      throw new ApiError(
        400,
        'MFA_NOT_ENABLED',
        'MFA is not enabled for this user.'
      );
    }

    const passwordMatches = await verifyPassword(password, user.passwordHash);
    if (!passwordMatches) {
      throw new ApiError(
        401,
        'INVALID_PASSWORD',
        'Invalid current password.'
      );
    }

    const manualEntrySecret = decryptMfaSecret(user.mfaSecretEncrypted);
    const { valid, counter } = verifyTotpCode(
      manualEntrySecret,
      code,
      Date.now(),
      1
    );

    if (!valid) {
      throw new ApiError(
        400,
        'INVALID_MFA_CODE',
        'The MFA verification code is invalid or expired.'
      );
    }

    if (user.lastMfaCounter && counter <= user.lastMfaCounter) {
      throw new ApiError(
        400,
        'MFA_CODE_REUSED',
        'This MFA code has already been used.'
      );
    }

    const plainRecoveryCodes = generateRecoveryCodes(10);
    const hashedCodes = plainRecoveryCodes.map(hashRecoveryCode);

    user.lastMfaCounter = counter;
    user.recoveryCodeHashes = hashedCodes;

    await user.save();

    return response.status(200).json({
      success: true,
      message: 'Recovery codes regenerated successfully.',
      data: {
        recoveryCodes: plainRecoveryCodes,
      },
      correlationId:
        request.correlationId || null,
    });
  }
);

const logout = asyncHandler(
  async (request, response) => {
    await revokeSession({
      sessionId: request.auth.sessionId,
      revokedBy: request.auth.userId,
      reason: 'USER_LOGOUT',
      details: 'User signed out.',
    });

    clearAuthenticationCookies(response);

    return response.status(200).json({
      success: true,
      message: 'Logout successful.',
      correlationId:
        request.correlationId || null,
    });
  }
);
const logoutAll = asyncHandler(
  async (request, response) => {
    const revokedSessionCount =
      await revokeAllUserSessions({
        organisationId:
          request.auth.organisationId,
        userId: request.auth.userId,
        revokedBy: request.auth.userId,
        reason: 'LOGOUT_ALL',
        details:
          'User signed out from all devices.',
      });

    clearAuthenticationCookies(response);

    return response.status(200).json({
      success: true,
      message:
        'All active sessions were logged out successfully.',
      data: {
        revokedSessionCount,
      },
      correlationId:
        request.correlationId || null,
    });
  }
);
const getSessions = asyncHandler(
  async (request, response) => {
    const sessions =
      await listUserSessions({
        organisationId:
          request.auth.organisationId,
        userId: request.auth.userId,
      });

    const safeSessions = sessions.map((sessionDocument) => {
      const session =
        typeof sessionDocument?.toObject === "function"
          ? sessionDocument.toObject()
          : sessionDocument;

      return {
        sessionId: session.sessionId,
        status: session.status,
        roleSnapshot: session.roleSnapshot,
        mfaVerified: Boolean(session.mfaVerified),
        mfaVerifiedAt: session.mfaVerifiedAt || null,
        stepUpVerifiedAt: session.stepUpVerifiedAt || null,
        device: {
          deviceName: session.device?.deviceName || "Unknown device",
          deviceType: session.device?.deviceType || "OTHER",
          operatingSystem: session.device?.operatingSystem || "",
          browser: session.device?.browser || "",
        },
        network: {
          ipAddressMasked: session.network?.ipAddressMasked || null,
          country: session.network?.country || null,
          region: session.network?.region || null,
          city: session.network?.city || null,
        },
        issuedAt: session.issuedAt || null,
        lastActivityAt: session.lastActivityAt || null,
        refreshTokenExpiresAt: session.refreshTokenExpiresAt || null,
        absoluteExpiresAt: session.absoluteExpiresAt || null,
        idleTimeoutMinutes: session.idleTimeoutMinutes,
        revokedAt: session.revokedAt || null,
        revocationReason: session.revocationReason || null,
      };
    });

    return response.status(200).json({
      success: true,
      data: {
        sessions: safeSessions,
        currentSessionId:
          request.auth.sessionId,
      },
      correlationId:
        request.correlationId || null,
    });
  }
);
const getCurrentUser = asyncHandler(
  async (request, response) => {
    const user = request.authenticatedUser;
    const auth = request.auth;

    const safeUser = {
      userId: user.userId,
      organisationId: user.organisationId,
      name: user.name,
      email: user.email,
      preferredName: user.preferredName || null,
      role: user.role,
      accountStatus: user.accountStatus,
      isPrimaryMaster: Boolean(user.isPrimaryMaster),
      primaryCafeId: user.primaryCafeId || null,
      primaryCafeName: user.primaryCafeName || null,
      assignedCafeIds: Array.isArray(user.assignedCafeIds)
        ? [...user.assignedCafeIds]
        : [],
      preferredLanguage: user.preferredLanguage || 'en',
      mustChangePassword: Boolean(user.mustChangePassword),
      mfaEnabled: Boolean(user.mfaEnabled),
      mfaMethod: user.mfaMethod || 'NONE',
    };

    const safeAuthentication = {
      userId: auth.userId,
      organisationId: auth.organisationId,
      role: auth.role,
      assignedCafeIds: Array.isArray(auth.assignedCafeIds)
        ? [...auth.assignedCafeIds]
        : [],
      primaryCafeId: auth.primaryCafeId || null,
      sessionId: auth.sessionId,
      mfaVerified: Boolean(auth.mfaVerified),
    };

    return response.status(200).json({
      success: true,
      data: {
        user: safeUser,
        authentication: safeAuthentication,
      },
      correlationId:
        request.correlationId || null,
    });
  }
);

const revokeSessionById = asyncHandler(
  async (request, response) => {
    const sessionId =
      typeof request.params.sessionId ===
      'string'
        ? request.params.sessionId.trim()
        : '';

    if (!sessionId) {
      throw new ApiError(
        400,
        'SESSION_ID_REQUIRED',
        'A session ID is required.'
      );
    }

    const revokedSession =
      await revokeUserSession({
        organisationId:
          request.auth.organisationId,
        userId: request.auth.userId,
        sessionId,
        revokedBy: request.auth.userId,
      });

    if (!revokedSession) {
      throw new ApiError(
        404,
        'SESSION_NOT_FOUND',
        'The session was not found.'
      );
    }

    if (
      revokedSession.sessionId ===
      request.auth.sessionId
    ) {
      clearAuthenticationCookies(
        response
      );
    }

    return response.status(200).json({
      success: true,
      message:
        'Session revoked successfully.',
      data: {
        sessionId:
          revokedSession.sessionId,
      },
      correlationId:
        request.correlationId || null,
    });
  }
);

const revokeOtherSessions = asyncHandler(
  async (request, response) => {
    const currentSessionId = request.auth.sessionId;
    const revokedSessionCount =
      await revokeAllUserSessions({
        organisationId: request.auth.organisationId,
        userId: request.auth.userId,
        revokedBy: request.auth.userId,
        reason: 'LOGOUT_ALL',
        details: 'User signed out from all other devices.',
        excludeSessionId: currentSessionId,
      });

    return response.status(200).json({
      success: true,
      message: 'All other active sessions were signed out successfully.',
      data: {
        revokedSessionCount,
        currentSessionId,
      },
      correlationId: request.correlationId || null,
    });
  }
);

const listTrustedDevices = asyncHandler(
  async (request, response) => {
    const user = request.user || request.auth;
    const currentToken =
      request.cookies?.[TRUSTED_DEVICE_COOKIE] ||
      request.get('x-trusted-device-token');

    const devices = await deviceTrustService.listUserTrustedDevices({
      organisationId: user.organisationId,
      userId: user.userId,
      currentRawToken: currentToken,
    });

    return response.status(200).json({
      success: true,
      message: 'Trusted devices retrieved successfully.',
      data: {
        devices,
      },
      correlationId: request.correlationId || null,
    });
  }
);

const revokeTrustedDevice = asyncHandler(
  async (request, response) => {
    const user = request.user || request.auth;
    const deviceTrustId = request.params?.deviceTrustId || request.body?.deviceTrustId;

    if (!deviceTrustId) {
      throw new ApiError(400, 'DEVICE_TRUST_ID_REQUIRED', 'Device trust ID is required.');
    }

    const revoked = await deviceTrustService.revokeTrustedDevice({
      organisationId: user.organisationId,
      userId: user.userId,
      deviceTrustId,
      revokedBy: user.userId,
      reason: request.body?.reason || 'USER_MANUAL_REVOCATION',
      actorRole: user.role,
      correlationId: request.correlationId,
    });

    const currentToken =
      request.cookies?.[TRUSTED_DEVICE_COOKIE] ||
      request.get('x-trusted-device-token');

    if (currentToken) {
      try {
        if (deviceTrustService.hashTrustedDeviceToken(currentToken) === revoked.tokenHash) {
          clearTrustedDeviceCookie(response);
        }
      } catch {}
    }

    return response.status(200).json({
      success: true,
      message: 'Trusted device revoked successfully.',
      data: {
        device: revoked,
      },
      correlationId: request.correlationId || null,
    });
  }
);

const revokeAllTrustedDevices = asyncHandler(
  async (request, response) => {
    const user = request.user || request.auth;
    const exceptCurrent = Boolean(request.body?.exceptCurrent);
    let exceptDeviceTrustId = null;

    if (exceptCurrent) {
      const currentToken =
        request.cookies?.[TRUSTED_DEVICE_COOKIE] ||
        request.get('x-trusted-device-token');
      if (currentToken) {
        try {
          const hash = deviceTrustService.hashTrustedDeviceToken(currentToken);
          const currentDev = await TrustedDevice.findOne({ tokenHash: hash });
          if (currentDev) {
            exceptDeviceTrustId = currentDev.deviceTrustId;
          }
        } catch {}
      }
    } else {
      clearTrustedDeviceCookie(response);
    }

    const result = await deviceTrustService.revokeAllUserTrustedDevices({
      organisationId: user.organisationId,
      userId: user.userId,
      revokedBy: user.userId,
      reason: request.body?.reason || 'USER_REVOKED_ALL',
      exceptDeviceTrustId,
      actorRole: user.role,
      correlationId: request.correlationId,
    });

    return response.status(200).json({
      success: true,
      message: 'All trusted devices revoked successfully.',
      data: {
        revokedCount: result.modifiedCount || 0,
      },
      correlationId: request.correlationId || null,
    });
  }
);

const getSelfPrivacySecurity = asyncHandler(
  async (request, response) => {
    const { organisationId, userId } = request.auth;

    const [userDoc, sessions, trustedDevices, privacyRequests] = await Promise.all([
      User.findOne({ organisationId, userId }).lean(),
      listUserSessions({ organisationId, userId }),
      deviceTrustService.listUserTrustedDevices
        ? deviceTrustService.listUserTrustedDevices({ organisationId, userId })
        : [],
      PrivacyRequest.find({ organisationId, subjectUserId: userId }).sort({ createdAt: -1 }).lean(),
    ]);

    const safeSessions = (sessions || []).map((sessionDocument) => {
      const session =
        typeof sessionDocument?.toObject === 'function'
          ? sessionDocument.toObject()
          : sessionDocument;
      return {
        sessionId: session.sessionId,
        isCurrent: session.sessionId === request.auth.sessionId,
        status: session.status,
        device: {
          deviceName: session.device?.deviceName || 'Standard Terminal',
          deviceType: session.device?.deviceType || 'DESKTOP',
          operatingSystem: session.device?.operatingSystem || '',
          browser: session.device?.browser || '',
        },
        issuedAt: session.issuedAt || null,
        lastActivityAt: session.lastActivityAt || null,
      };
    });

    const personalInfo = {
      userId: userDoc?.userId || userId,
      fullName: userDoc?.fullName || userDoc?.name || '',
      emailMasked: userDoc?.email ? maskEmail(userDoc.email) : '',
      phoneMasked: userDoc?.phoneNumber ? maskPhone(userDoc.phoneNumber) : '',
      role: userDoc?.role || request.auth.role,
      primaryCafeId: userDoc?.primaryCafeId || null,
      employmentStatus: userDoc?.employmentStatus || 'ACTIVE',
    };

    return response.status(200).json({
      success: true,
      data: {
        privacyNotice: {
          noticeVersion: '2026.1',
          governanceStandard: 'Digital Personal Data Protection Act (DPDP) 2023 & ISO/IEC 27001',
          statement:
            'Zamorin Café LLP processes your personal information strictly for employment administration, statutory compliance, and operational duties. You have the right to review your data, request correction of inaccurate records, and submit governed privacy requests.',
          dataProtectionOfficer: 'privacy-officer@zamorin.cafe',
        },
        personalInfo,
        sessions: safeSessions,
        trustedDevices: trustedDevices || [],
        privacyRequests: (privacyRequests || []).map((pr) => ({
          requestId: pr.requestId,
          requestType: pr.requestType,
          status: pr.status,
          createdAt: pr.createdAt,
          reason: pr.reason,
          decision: pr.retentionJustification || pr.reviewNote || null,
        })),
        incidentReportingEnabled: true,
      },
      correlationId: request.correlationId || null,
    });
  }
);

module.exports = {
  login,
  requestPasswordReset,
  verifyPasswordResetCode,
  resetPassword,
  mfaSetup,
  mfaConfirm,
  mfaVerify,
  getMfaStatus,
  regenerateRecoveryCodes,
  stepUpAuthentication,
  changePassword,
  refreshSession,
  logout,
  logoutAll,
  getSessions,
  getCurrentUser,
  revokeSessionById,
  revokeOtherSessions,
  clearAuthenticationCookies,
  listTrustedDevices,
  revokeTrustedDevice,
  revokeAllTrustedDevices,
  getSelfPrivacySecurity,
  setupAppPin,
  changeAppPin,
  disableAppPin,
  getAppPinStatus,
  unlockWithAppPin,
  loginWithAppPin,
};

