'use strict';

const mongoose = require('mongoose');

const SESSION_STATUSES = [
  'ACTIVE',
  'REVOKED',
  'EXPIRED',
  'COMPROMISED',
];

const REVOCATION_REASONS = [
  'USER_LOGOUT',
  'LOGOUT_ALL',
  'PASSWORD_CHANGED',
  'PASSWORD_RESET',
  'ROLE_CHANGED',
  'CAFE_ASSIGNMENT_CHANGED',
  'PERMISSION_CHANGED',
  'ACCOUNT_LOCKED',
  'ACCOUNT_SUSPENDED',
  'ADMIN_REVOKED',
  'SECURITY_RISK',
  'TOKEN_REUSE_DETECTED',
  'SESSION_EXPIRED',
  'ROLE_RETIRED_NORMAL_MASTER',
  'OTHER',
];

const sessionSchema = new mongoose.Schema(
  {
    sessionId: {
      type: String,
      required: true,
      unique: true,
      immutable: true,
      trim: true,
      uppercase: true,
      match: /^SS-\d{8}-\d{4,}$/,
    },

    organisationId: {
      type: String,
      required: true,
      immutable: true,
      trim: true,
      uppercase: true,
      index: true,
    },

    userId: {
      type: String,
      required: true,
      immutable: true,
      trim: true,
      uppercase: true,
      index: true,
    },

    roleSnapshot: {
      type: String,
      required: true,
      immutable: true,
      enum: ['MASTER', 'OWNER', 'CAFE_ADMIN', 'STAFF'],
      index: true,
    },

    assignedCafeIdsSnapshot: [
      {
        type: String,
        trim: true,
        uppercase: true,
      },
    ],

    tokenFamilyId: {
      type: String,
      required: true,
      immutable: true,
      trim: true,
      maxlength: 200,
      index: true,
    },

    accessTokenHash: {
      type: String,
      required: true,
      select: false,
      maxlength: 500,
    },

    refreshTokenHash: {
      type: String,
      required: true,
      select: false,
      maxlength: 500,
    },

    previousRefreshTokenHashes: {
      type: [String],
      select: false,
      default: [],
    },

    sessionVersion: {
      type: Number,
      required: true,
      min: 0,
      default: 0,
    },

    userSessionVersionSnapshot: {
      type: Number,
      required: true,
      min: 0,
      default: 0,
    },

    permissionsVersionSnapshot: {
      type: Number,
      required: true,
      min: 0,
      default: 0,
    },

    status: {
      type: String,
      required: true,
      enum: SESSION_STATUSES,
      default: 'ACTIVE',
      index: true,
    },

    mfaVerified: {
      type: Boolean,
      default: false,
    },

    mfaVerifiedAt: {
      type: Date,
      default: null,
    },

    stepUpVerifiedAt: {
      type: Date,
      default: null,
    },

    device: {
      deviceId: {
        type: String,
        required: true,
        immutable: true,
        trim: true,
        maxlength: 250,
      },

      deviceName: {
        type: String,
        trim: true,
        maxlength: 200,
        default: 'Unknown device',
      },

      deviceType: {
        type: String,
        enum: [
          'DESKTOP',
          'LAPTOP',
          'TABLET',
          'MOBILE',
          'PWA',
          'OTHER',
        ],
        default: 'OTHER',
      },

      operatingSystem: {
        type: String,
        trim: true,
        maxlength: 200,
        default: '',
      },

      browser: {
        type: String,
        trim: true,
        maxlength: 200,
        default: '',
      },

      userAgent: {
        type: String,
        trim: true,
        maxlength: 1000,
        default: '',
      },

      pushSubscriptionId: {
        type: String,
        trim: true,
        maxlength: 500,
        default: null,
      },
    },

    network: {
      ipAddressMasked: {
        type: String,
        trim: true,
        maxlength: 100,
        default: null,
      },

      country: {
        type: String,
        trim: true,
        maxlength: 100,
        default: null,
      },

      region: {
        type: String,
        trim: true,
        maxlength: 150,
        default: null,
      },

      city: {
        type: String,
        trim: true,
        maxlength: 150,
        default: null,
      },
    },

    issuedAt: {
      type: Date,
      required: true,
      immutable: true,
      default: Date.now,
    },

    lastActivityAt: {
      type: Date,
      required: true,
      default: Date.now,
      index: true,
    },

    accessTokenExpiresAt: {
      type: Date,
      required: true,
    },

    refreshTokenExpiresAt: {
      type: Date,
      required: true,
    },

    absoluteExpiresAt: {
      type: Date,
      required: true,
      index: true,
    },

    idleTimeoutMinutes: {
      type: Number,
      required: true,
      min: 1,
      max: 1440,
      default: 30,
    },

    revokedAt: {
      type: Date,
      default: null,
    },

    revokedBy: {
      type: String,
      trim: true,
      uppercase: true,
      default: null,
    },

    revocationReason: {
      type: String,
      enum: REVOCATION_REASONS,
      default: null,
    },

    revocationDetails: {
      type: String,
      trim: true,
      maxlength: 1000,
      default: '',
    },

    replacedBySessionId: {
      type: String,
      trim: true,
      uppercase: true,
      default: null,
    },

    lastCorrelationId: {
      type: String,
      trim: true,
      maxlength: 150,
      default: null,
    },

    createdBy: {
      type: String,
      required: true,
      immutable: true,
      trim: true,
      uppercase: true,
    },
  },
  {
    timestamps: true,
    optimisticConcurrency: true,
    versionKey: 'version',
    collection: 'sessions',
  }
);

sessionSchema.index(
  {
    organisationId: 1,
    userId: 1,
    status: 1,
    lastActivityAt: -1,
  },
  {
    name: 'user_active_sessions',
  }
);

sessionSchema.index(
  {
    organisationId: 1,
    tokenFamilyId: 1,
    status: 1,
  },
  {
    name: 'token_family_status',
  }
);

sessionSchema.index(
  {
    organisationId: 1,
    userId: 1,
    'device.deviceId': 1,
    status: 1,
  },
  {
    name: 'user_device_status',
  }
);

sessionSchema.index(
  {
    absoluteExpiresAt: 1,
  },
  {
    expireAfterSeconds: 0,
    name: 'expired_session_cleanup',
  }
);

sessionSchema.pre('validate', function normalizeSessionFields() {
  if (this.sessionId) {
    this.sessionId = this.sessionId.trim().toUpperCase();
  }

  if (this.organisationId) {
    this.organisationId =
      this.organisationId.trim().toUpperCase();
  }

  if (this.userId) {
    this.userId = this.userId.trim().toUpperCase();
  }

  if (this.revokedBy) {
    this.revokedBy = this.revokedBy.trim().toUpperCase();
  }

  if (this.replacedBySessionId) {
    this.replacedBySessionId =
      this.replacedBySessionId.trim().toUpperCase();
  }

  if (Array.isArray(this.assignedCafeIdsSnapshot)) {
    this.assignedCafeIdsSnapshot = [
      ...new Set(
        this.assignedCafeIdsSnapshot
          .filter(Boolean)
          .map((cafeId) => cafeId.trim().toUpperCase())
      ),
    ];
  }

  if (
    this.accessTokenExpiresAt &&
    this.refreshTokenExpiresAt &&
    this.accessTokenExpiresAt >= this.refreshTokenExpiresAt
  ) {
    this.invalidate(
      'accessTokenExpiresAt',
      'Access token must expire before the refresh token.'
    );
  }

  if (
    this.refreshTokenExpiresAt &&
    this.absoluteExpiresAt &&
    this.refreshTokenExpiresAt > this.absoluteExpiresAt
  ) {
    this.invalidate(
      'refreshTokenExpiresAt',
      'Refresh token cannot outlive the absolute session expiry.'
    );
  }
});

sessionSchema.methods.isActive = function isActive() {
  if (this.status !== 'ACTIVE') {
    return false;
  }

  const now = new Date();

  if (this.absoluteExpiresAt <= now) {
    return false;
  }

  const idleExpiry = new Date(
    this.lastActivityAt.getTime() +
      this.idleTimeoutMinutes * 60 * 1000
  );

  return idleExpiry > now;
};

sessionSchema.methods.touchActivity =
  async function touchActivity(correlationId = null) {
    if (!this.isActive()) {
      throw new Error('The session is not active.');
    }

    this.lastActivityAt = new Date();

    if (correlationId) {
      this.lastCorrelationId = correlationId;
    }

    return this.save();
  };

sessionSchema.methods.markMfaVerified =
  async function markMfaVerified() {
    if (!this.isActive()) {
      throw new Error('The session is not active.');
    }

    this.mfaVerified = true;
    this.mfaVerifiedAt = new Date();

    return this.save();
  };

sessionSchema.methods.markStepUpVerified =
  async function markStepUpVerified() {
    if (!this.isActive()) {
      throw new Error('The session is not active.');
    }

    this.stepUpVerifiedAt = new Date();

    return this.save();
  };

sessionSchema.methods.revoke = async function revoke({
  revokedBy,
  reason,
  details = '',
  replacementSessionId = null,
}) {
  if (!revokedBy || !reason) {
    throw new Error(
      'Session revocation requires revokedBy and reason.'
    );
  }

  if (!REVOCATION_REASONS.includes(reason)) {
    throw new Error('Invalid session revocation reason.');
  }

  if (this.status === 'REVOKED') {
    return this;
  }

  this.status = 'REVOKED';
  this.revokedAt = new Date();
  this.revokedBy = revokedBy.trim().toUpperCase();
  this.revocationReason = reason;
  this.revocationDetails = details.trim();

  if (replacementSessionId) {
    this.replacedBySessionId =
      replacementSessionId.trim().toUpperCase();
  }

  this.accessTokenHash = 'REVOKED';
  this.refreshTokenHash = 'REVOKED';
  this.previousRefreshTokenHashes = [];

  return this.save();
};

sessionSchema.methods.markCompromised =
  async function markCompromised({
    revokedBy,
    details = '',
  }) {
    this.status = 'COMPROMISED';
    this.revokedAt = new Date();
    this.revokedBy = revokedBy.trim().toUpperCase();
    this.revocationReason = 'TOKEN_REUSE_DETECTED';
    this.revocationDetails = details.trim();
    this.accessTokenHash = 'COMPROMISED';
    this.refreshTokenHash = 'COMPROMISED';
    this.previousRefreshTokenHashes = [];

    return this.save();
  };

sessionSchema.methods.toJSON = function safeSessionJSON() {
  const session = this.toObject();

  delete session.accessTokenHash;
  delete session.refreshTokenHash;
  delete session.previousRefreshTokenHashes;

  return session;
};

const Session =
  mongoose.models.Session ||
  mongoose.model('Session', sessionSchema);

module.exports = {
  Session,
  SESSION_STATUSES,
  REVOCATION_REASONS,
};