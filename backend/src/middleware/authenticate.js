'use strict';

const { User } = require('../models/User');
const authService = require('../services/authService');

const ACCESS_TOKEN_COOKIE =
  'zamorin_access_token';

function extractAccessToken(request) {
  const authorizationHeader =
    request.get('authorization');

  if (authorizationHeader) {
    const [scheme, token] =
      authorizationHeader.split(' ');

    if (
      scheme?.toLowerCase() === 'bearer' &&
      token
    ) {
      return token.trim();
    }
  }

  if (
    request.cookies &&
    request.cookies[ACCESS_TOKEN_COOKIE]
  ) {
    return request.cookies[
      ACCESS_TOKEN_COOKIE
    ];
  }

  return null;
}

function sendAuthenticationError(
  response,
  code,
  message
) {
  return response.status(401).json({
    error: {
      code,
      message,
    },
  });
}

async function authenticate(
  request,
  response,
  next
) {
  try {
    if (request.auth) {
      return next();
    }

    const accessToken =
      extractAccessToken(request);

    if (!accessToken) {
      return sendAuthenticationError(
        response,
        'AUTHENTICATION_REQUIRED',
        'Authentication is required.'
      );
    }

    const {
      payload,
      session,
    } = await authService.verifyAccessToken(accessToken);

    const user = await User.findOne({
      organisationId: payload.org,
      userId: payload.sub,
      accountStatus: 'ACTIVE',
      archivedAt: null,
    });

    if (!user) {
      return sendAuthenticationError(
        response,
        'USER_UNAVAILABLE',
        'The authenticated user is unavailable.'
      );
    }

    // Normal Master Decommission Invariant:
    if (user.role === 'MASTER' && !user.isPrimaryMaster) {
      return response.status(403).json({
        error: {
          code: 'ROLE_RETIRED',
          message: 'The Normal Master role has been permanently retired. Please contact your Primary Master administrator.',
        },
      });
    }

    if (
      user.role !== payload.role ||
      session.roleSnapshot !== user.role
    ) {
      return sendAuthenticationError(
        response,
        'ROLE_CHANGED',
        'Your access role has changed. Sign in again.'
      );
    }

    if (
      user.sessionVersion !== payload.usv ||
      user.permissionsVersion !== payload.pv
    ) {
      return sendAuthenticationError(
        response,
        'SECURITY_VERSION_CHANGED',
        'Your security permissions changed. Sign in again.'
      );
    }

    const assignedCafeIds = [
      ...new Set(
        (user.assignedCafeIds || [])
          .filter(Boolean)
          .map((cafeId) =>
            cafeId.trim().toUpperCase()
          )
      ),
    ];

    request.auth = {
      userId: user.userId,
      email: user.email,
      name: user.name || user.email,
      organisationId: user.organisationId,
      role: user.role,
      isPrimaryMaster: Boolean(user.isPrimaryMaster),
      vendorId: user.vendorId || null,
      assignedCafeIds,
      primaryCafeId:
        user.primaryCafeId || null,
      sessionId: session.sessionId,
      capabilities: Array.isArray(user.capabilities)
        ? user.capabilities.map((c) => String(c).trim().toUpperCase()).filter(Boolean)
        : [],
      mfaVerified:
        Boolean(session.mfaVerified),
      mfaVerifiedAt:
        session.mfaVerifiedAt || null,
      stepUpVerifiedAt:
        session.stepUpVerifiedAt || null,
      sessionVersion:
        session.sessionVersion,
      permissionsVersion:
        user.permissionsVersion,
    };

    request.user = request.auth;
    request.authenticatedUser = user;
    request.authenticatedSession = session;

    return next();
  } catch (error) {
    if (error?.name === 'TokenExpiredError') {
      return sendAuthenticationError(
        response,
        'AUTH_TOKEN_EXPIRED',
        'Your access token has expired.'
      );
    }

    if (error?.name === 'JsonWebTokenError') {
      return sendAuthenticationError(
        response,
        'AUTH_TOKEN_INVALID',
        'The access token is invalid.'
      );
    }

    if (error?.name === 'NotBeforeError') {
      return sendAuthenticationError(
        response,
        'AUTH_TOKEN_NOT_ACTIVE',
        'The access token is not yet active.'
      );
    }

    if (
      typeof error?.message === 'string' &&
      (error.message.toLowerCase().includes('revoked') ||
        error.message.toLowerCase().includes('expired'))
    ) {
      return sendAuthenticationError(
        response,
        'AUTH_SESSION_REVOKED',
        'Your session has expired or was revoked.'
      );
    }

    return sendAuthenticationError(
      response,
      'INVALID_OR_EXPIRED_SESSION',
      'Your session is invalid or expired.'
    );
  }
}




function requireMfa(
  request,
  response,
  next
) {
  if (!request.auth) {
    return sendAuthenticationError(
      response,
      'AUTHENTICATION_REQUIRED',
      'Authentication is required.'
    );
  }

  if (!request.auth.mfaVerified) {
    return response.status(403).json({
      error: {
        code: 'MFA_REQUIRED',
        message:
          'Multi-factor authentication is required.',
      },
    });
  }

  return next();
}

function requireStepUpAuthentication(
  request,
  response,
  next
) {
  if (!request.auth) {
    return sendAuthenticationError(
      response,
      'AUTHENTICATION_REQUIRED',
      'Authentication is required.'
    );
  }

  const maximumAgeMinutes =
    Number.parseInt(
      process.env
        .STEP_UP_AUTH_MAX_AGE_MINUTES ||
        '10',
      10
    );

  const verifiedAt =
    request.auth.stepUpVerifiedAt;

  if (!verifiedAt) {
    return response.status(403).json({
      error: {
        code:
          'STEP_UP_AUTHENTICATION_REQUIRED',
        message:
          'Recent authentication is required for this action.',
      },
    });
  }

  const verifiedAtDate =
    new Date(verifiedAt);

  const expiresAt =
    verifiedAtDate.getTime() +
    maximumAgeMinutes * 60 * 1000;

  if (
    Number.isNaN(
      verifiedAtDate.getTime()
    ) ||
    expiresAt <= Date.now()
  ) {
    return response.status(403).json({
      error: {
        code:
          'STEP_UP_AUTHENTICATION_EXPIRED',
        message:
          'Recent authentication has expired.',
      },
    });
  }

  return next();
}

module.exports = {
  ACCESS_TOKEN_COOKIE,
  extractAccessToken,
  authenticate,
  requireMfa,
  requireStepUpAuthentication,
};