#!/usr/bin/env node
/**
 * Zamorin Café ERP — Safe Environment & Startup Configuration Validator
 *
 * Validates operational and security environment variables without ever
 * echoing secrets, credentials, or raw connection strings to the console.
 */

import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ENVIRONMENT_SPECS = [
  {
    key: 'NODE_ENV',
    required: false,
    default: 'development',
    validate: (val) => ['development', 'production', 'test'].includes(val),
    isSecret: false,
  },
  {
    key: 'PORT',
    required: false,
    default: '4000',
    validate: (val) => Number.isInteger(Number(val)) && Number(val) > 0 && Number(val) < 65536,
    isSecret: false,
  },
  {
    key: 'MONGODB_URI',
    required: true,
    validate: (val) => typeof val === 'string' && (val.startsWith('mongodb://') || val.startsWith('mongodb+srv://')),
    isSecret: true,
  },
  {
    key: 'JWT_ACCESS_SECRET',
    required: true,
    validate: (val) => typeof val === 'string' && val.trim().length >= 16,
    isSecret: true,
  },
  {
    key: 'MFA_ENCRYPTION_KEY',
    required: false,
    validate: (val) => typeof val === 'string' && val.trim().length >= 32,
    isSecret: true,
  },
  {
    key: 'ALLOWED_ORIGINS',
    required: false,
    validate: (val) => typeof val === 'string',
    isSecret: false,
  },
  {
    key: 'SESSION_ABSOLUTE_TTL_DAYS',
    required: false,
    validate: (val) => !Number.isNaN(Number(val)) && Number(val) > 0,
    isSecret: false,
  },
  {
    key: 'SESSION_IDLE_TIMEOUT_MINUTES',
    required: false,
    validate: (val) => !Number.isNaN(Number(val)) && Number(val) > 0,
    isSecret: false,
  },
  {
    key: 'STEP_UP_AUTH_MAX_AGE_MINUTES',
    required: false,
    validate: (val) => !Number.isNaN(Number(val)) && Number(val) > 0,
    isSecret: false,
  },
];

export function validateEnvironment(env = process.env, { targetEnv } = {}) {
  const resolvedTarget = targetEnv || env.NODE_ENV || 'development';
  const isProd = resolvedTarget === 'production';
  const results = [];
  let allValid = true;

  for (const spec of ENVIRONMENT_SPECS) {
    const rawVal = env[spec.key];
    const isPresent = rawVal !== undefined && rawVal !== null && String(rawVal).trim() !== '';

    let status = 'MISSING';
    let details = '';

    if (isPresent) {
      const isValid = spec.validate ? spec.validate(rawVal) : true;
      if (isValid) {
        status = 'PRESENT';
      } else {
        status = 'INVALID';
        details = 'Value does not conform to expected format or strength constraints';
        allValid = false;
      }
    } else {
      if (spec.required && isProd) {
        status = 'MISSING';
        details = 'Required environment variable is not defined';
        allValid = false;
      } else if (spec.required) {
        status = 'MISSING_DEV';
        details = 'Required in production; dev mode injects a fallback (see backend/src/scripts/startDev.js)';
      } else {
        status = 'OPTIONAL_DEFAULT';
        details = spec.default ? `Defaults to '${spec.default}'` : 'Optional';
      }
    }

    results.push({
      key: spec.key,
      status,
      required: spec.required,
      isSecret: spec.isSecret,
      details,
    });
  }

  return {
    timestamp: new Date().toISOString(),
    valid: allValid,
    totalChecked: results.length,
    variables: results,
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const envIndex = process.argv.indexOf('--target-env');
  const targetEnv = envIndex !== -1 ? process.argv[envIndex + 1] : (process.env.NODE_ENV || 'development');
  const result = validateEnvironment(process.env, { targetEnv });
  const isProd = targetEnv === 'production';
  console.log(`[ENV_VALIDATION] Checking runtime configuration safety (target: ${targetEnv}):\n`);

  for (const item of result.variables) {
    const paddedKey = item.key.padEnd(32, ' ');
    const statusColor = item.status === 'PRESENT' ? 'OK' : item.status === 'OPTIONAL_DEFAULT' ? 'DEFAULT' : item.status === 'MISSING_DEV' ? 'DEV' : 'FAILED';
    console.log(`  ${paddedKey} [${statusColor}] -> ${item.status}${item.details ? ` (${item.details})` : ''}`);
  }

  console.log(`\nOverall Configuration Status: ${result.valid ? 'PASS' : 'WARNING_OR_FAIL'}`);
  console.log(`(Secrets, tokens, and raw database strings remain completely unprinted)`);
  if (isProd && !result.valid) process.exit(1);
}
