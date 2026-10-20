'use strict';

/**
 * ============================================================================
 * ZAMORIN CAFÉ ERP — UNIVERSAL STARTUP CONFIGURATION VALIDATOR
 * ============================================================================
 * Enforces production startup safety invariants.
 *
 * Validated against the RAW process environment (process.env), not the
 * normalised frozen config object — the spec keys are env-var names.
 *
 * Invariants:
 * 1. Validates all mandatory operational and security environment variables.
 * 2. Never logs or prints secret material during validation.
 * 3. Reports status strictly as PRESENT, MISSING, INVALID, or UNSAFE.
 * 4. Fails closed: In production (NODE_ENV === 'production'), if any mandatory
 *    or security variable is missing/invalid, server startup is aborted.
 *
 * Vocabulary is reconciled with services/documentStorageAdapter.js, the storage
 * authority: the canonical production provider is `gridfs` (MongoDB Atlas GridFS),
 * configured via DOCUMENT_STORAGE_PROVIDER (DOCUMENT_STORAGE_DRIVER is accepted
 * as an alias). Prods that simply omit the key inherit the adapter's gridfs
 * default and must keep booting — only a present-but-invalid value blocks.
 */

const path = require('path');
const ApiError = require('../utils/ApiError');

const PRODUCTION_MANDATORY_SPECS = [
  {
    key: 'NODE_ENV',
    requiredInProduction: true,
    description: 'Runtime environment profile',
    isSecret: false,
    validate: (val) => ['production', 'development', 'test', 'staging'].includes(val),
  },
  {
    key: 'PORT',
    requiredInProduction: false,
    default: '4000',
    description: 'HTTP listening port',
    isSecret: false,
    validate: (val) => Number.isInteger(Number(val)) && Number(val) > 0 && Number(val) < 65536,
  },
  {
    key: 'MONGODB_URI',
    requiredInProduction: true,
    description: 'MongoDB Atlas primary replica-set connection string',
    isSecret: true,
    validate: (val) => typeof val === 'string' && (val.startsWith('mongodb://') || val.startsWith('mongodb+srv://')),
  },
  {
    key: 'JWT_ACCESS_SECRET',
    requiredInProduction: true,
    description: 'HMAC-SHA256 secret for access tokens (min 32 chars in prod)',
    isSecret: true,
    validate: (val, isProd) => typeof val === 'string' && val.trim().length >= (isProd ? 32 : 16) && !val.includes('placeholder'),
  },
  {
    key: 'MFA_ENCRYPTION_KEY',
    requiredInProduction: true,
    description: 'AES-256-GCM symmetric key for MFA secrets (64-char hex)',
    isSecret: true,
    validate: (val, isProd) => {
      if (!isProd) return typeof val === 'string' && val.trim().length >= 32;
      return typeof val === 'string' && /^[0-9a-fA-F]{64}$/.test(val.trim());
    },
  },
  {
    key: 'DOCUMENT_STORAGE_PROVIDER',
    altKeys: ['DOCUMENT_STORAGE_DRIVER'],
    requiredInProduction: false,
    // Not strictly required: the document storage adapter falls back to `gridfs`
    // in production when the key is absent (its canonical default). But when the
    // key IS set, the value must belong to the adapter's accepted vocabulary.
    mustBeValidInProduction: true,
    description: 'Durable document storage provider (canonical: gridfs; also mongodb, render_persistent_disk, private_object_storage)',
    isSecret: false,
    validate: (val) =>
      ['GRIDFS', 'MONGODB', 'MONGODB_GRIDFS', 'RENDER_PERSISTENT_DISK', 'PRIVATE_OBJECT_STORAGE']
        .includes(String(val).trim().toUpperCase()),
  },
  {
    key: 'DOCUMENT_STORAGE_ROOT',
    requiredInProduction: false,
    mustBeValidInProduction: true,
    description: 'Persistent disk mount path (required only when DOCUMENT_STORAGE_PROVIDER=RENDER_PERSISTENT_DISK)',
    isSecret: false,
    validate: (val, isProd) => {
      if (!isProd) return true;
      if (!val || typeof val !== 'string' || val.trim() === '') return false;
      const resolved = path.resolve(val);
      const appSourceDir = path.resolve(__dirname, '../../..');
      // Ephemeral storage inside container application source is strictly forbidden
      return !resolved.startsWith(appSourceDir);
    },
  },
  {
    key: 'ALLOWED_ORIGINS',
    requiredInProduction: true,
    description: 'Authorized frontend CORS origins list (https required; http allowed for localhost/127.0.0.1 only)',
    isSecret: false,
    validate: (val, isProd) => {
      if (!isProd) return true;
      if (!val || typeof val !== 'string') return false;
      if (val.includes('*')) return false;
      const origins = val.split(',').map((o) => o.trim()).filter(Boolean);
      if (origins.length === 0) return false;
      return origins.every((origin) => {
        let url;
        try {
          url = new URL(origin);
        } catch (_) {
          return false;
        }
        if (url.protocol === 'https:') return true;
        // Local deployments (e.g. the production-mode Docker stack) legitimately
        // serve over http on loopback only.
        return url.protocol === 'http:'
          && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
      });
    },
  },
  {
    key: 'REDIS_URL',
    requiredInProduction: false,
    description: 'Redis connection URL for distributed rate limiting, locks and job coordination (production boot requires it)',
    isSecret: true,
    validate: (val) => typeof val === 'string' && /^rediss?:\/\/.+/.test(val.trim()),
  },
  {
    key: 'SESSION_ABSOLUTE_TTL_DAYS',
    requiredInProduction: false,
    default: '7',
    description: 'Absolute session expiry threshold (days)',
    isSecret: false,
    validate: (val) => !Number.isNaN(Number(val)) && Number(val) > 0,
  },
  {
    key: 'SESSION_IDLE_TIMEOUT_MINUTES',
    requiredInProduction: false,
    default: '30',
    description: 'Idle session timeout window (minutes)',
    isSecret: false,
    validate: (val) => !Number.isNaN(Number(val)) && Number(val) > 0,
  },
];

function validateStartupConfiguration(env = process.env, { failClosed = true } = {}) {
  const isProduction = env.NODE_ENV === 'production';
  const report = [];
  const blockingIssues = [];

  for (const spec of PRODUCTION_MANDATORY_SPECS) {
    // Resolve the value across the primary key and its aliases (e.g.
    // DOCUMENT_STORAGE_PROVIDER falls back to DOCUMENT_STORAGE_DRIVER).
    let raw;
    for (const key of [spec.key, ...(spec.altKeys || [])]) {
      const candidate = env[key];
      if (candidate !== undefined && candidate !== null && String(candidate).trim() !== '') {
        raw = candidate;
        break;
      }
    }
    const isPresent = raw !== undefined && raw !== null && String(raw).trim() !== '';

    let status = 'MISSING';
    let detail = '';

    if (isPresent) {
      const isValid = spec.validate ? spec.validate(raw, isProduction, env) : true;
      if (isValid) {
        status = 'PRESENT';
      } else {
        status = 'INVALID';
        detail = `Variable ${spec.key} violates security/format constraints`;
        if ((spec.requiredInProduction || spec.mustBeValidInProduction) && isProduction) {
          blockingIssues.push(`${spec.key}: ${detail}`);
        }
      }
    } else {
      if (spec.requiredInProduction && isProduction) {
        status = 'MISSING';
        detail = `Mandatory variable ${spec.key} is missing`;
        blockingIssues.push(`${spec.key}: ${detail}`);
      } else {
        status = 'OPTIONAL_DEFAULT';
        detail = `Using default: ${spec.default || 'none'}`;
      }
    }

    report.push({
      key: spec.key,
      description: spec.description,
      status,
      isSecret: spec.isSecret,
      detail: spec.isSecret && isPresent ? 'Configured (Value Redacted)' : detail,
    });
  }

  const isSafe = blockingIssues.length === 0;

  if (!isSafe && failClosed && isProduction) {
    const errMessage = `PRODUCTION_STARTUP_CONFIG_ERROR: ${blockingIssues.join('; ')}`;
    throw new ApiError(500, 'STARTUP_CONFIGURATION_FAILED', errMessage);
  }

  return {
    isProduction,
    isSafe,
    blockingIssues,
    report,
    timestamp: new Date().toISOString(),
  };
}

module.exports = {
  PRODUCTION_MANDATORY_SPECS,
  validateStartupConfiguration,
};
