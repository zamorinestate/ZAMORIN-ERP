'use strict';

const VALID_NODE_ENVIRONMENTS = new Set([
  'development',
  'test',
  'staging',
  'production',
]);

const VALID_PRIVATE_STORAGE_DRIVERS = new Set([
  'local',
  'cloudinary',
]);

function requireConfiguredValue(name, value) {
  const normalized =
    typeof value === 'string'
      ? value.trim()
      : '';

  if (!normalized) {
    throw new Error(`${name} is required.`);
  }

  const placeholderMarkers = [
    '<db_user>',
    '<db_password>',
    '<cluster_host>',
    'YOUR_ATLAS_PASSWORD',
    'DB_USER',
    'DB_PASSWORD',
    'ATLAS_CLUSTER_HOST',
    'replace-with',
    'changeme',
    'change-me',
    'placeholder',
  ];

  if (
    placeholderMarkers.some((marker) =>
      normalized
        .toLowerCase()
        .includes(marker.toLowerCase())
    )
  ) {
    throw new Error(
      `${name} contains a placeholder value.`
    );
  }

  return normalized;
}

function parsePositiveInteger(
  name,
  value,
  fallback
) {
  const candidate =
    value === undefined || value === ''
      ? fallback
      : Number.parseInt(value, 10);

  if (
    !Number.isInteger(candidate) ||
    candidate < 1
  ) {
    throw new Error(
      `${name} must be a positive integer.`
    );
  }

  return candidate;
}

function parseNonNegativeInteger(
  name,
  value,
  fallback
) {
  const candidate =
    value === undefined || value === ''
      ? fallback
      : Number.parseInt(value, 10);

  if (
    !Number.isInteger(candidate) ||
    candidate < 0
  ) {
    throw new Error(
      `${name} must be a non-negative integer.`
    );
  }

  return candidate;
}

function parseAllowedOrigins(
  value,
  production
) {
  const origins = String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

  if (production && origins.length === 0) {
    throw new Error(
      'ALLOWED_ORIGINS is required in production.'
    );
  }

  if (origins.includes('*')) {
    throw new Error(
      'ALLOWED_ORIGINS must not contain a wildcard.'
    );
  }

  const normalized = origins.map(
    (origin) => {
      let parsed;

      try {
        parsed = new URL(origin);
      } catch {
        throw new Error(
          'ALLOWED_ORIGINS contains an invalid URL.'
        );
      }

      if (
        !['http:', 'https:'].includes(
          parsed.protocol
        )
      ) {
        throw new Error(
          'ALLOWED_ORIGINS supports only HTTP and HTTPS origins.'
        );
      }

      return parsed.origin;
    }
  );

  return [...new Set(normalized)];
}

function loadEnvironment(
  source = process.env
) {
  const rawEnv = String(
    source.NODE_ENV || (source.RENDER ? 'staging' : 'development')
  )
    .trim()
    .replace(/^['"]+|['"]+$/g, '')
    .trim()
    .toLowerCase();

  const nodeEnvironment = VALID_NODE_ENVIRONMENTS.has(rawEnv)
    ? rawEnv
    : (source.RENDER ? 'staging' : 'development');

  const production =
    nodeEnvironment === 'production';
  const staging =
    nodeEnvironment === 'staging';

  const privateStorageDriver = String(
    source.PRIVATE_STORAGE_DRIVER ||
      (source.CLOUDINARY_CLOUD_NAME ? 'cloudinary' : 'local')
  )
    .trim()
    .replace(/^['"]+|['"]+$/g, '')
    .trim()
    .toLowerCase();

  if (
    !VALID_PRIVATE_STORAGE_DRIVERS.has(
      privateStorageDriver
    )
  ) {
    throw new Error(
      'PRIVATE_STORAGE_DRIVER must be local or cloudinary.'
    );
  }

  const cloudinaryCloudName =
    privateStorageDriver === 'cloudinary'
      ? requireConfiguredValue(
          'CLOUDINARY_CLOUD_NAME',
          source.CLOUDINARY_CLOUD_NAME
        )
      : '';

  const cloudinaryApiKey =
    privateStorageDriver === 'cloudinary'
      ? requireConfiguredValue(
          'CLOUDINARY_API_KEY',
          source.CLOUDINARY_API_KEY
        )
      : '';

  const cloudinaryApiSecret =
    privateStorageDriver === 'cloudinary'
      ? requireConfiguredValue(
          'CLOUDINARY_API_SECRET',
          source.CLOUDINARY_API_SECRET
        )
      : '';

  const mongodbUri =
    requireConfiguredValue(
      'MONGODB_URI',
      source.MONGODB_URI
    );

  const jwtAccessSecret =
    requireConfiguredValue(
      'JWT_ACCESS_SECRET',
      source.JWT_ACCESS_SECRET
    );

  const mfaEncryptionKey =
    requireConfiguredValue(
      'MFA_ENCRYPTION_KEY',
      source.MFA_ENCRYPTION_KEY
    );

  if (jwtAccessSecret.length < 32) {
    throw new Error(
      'JWT_ACCESS_SECRET must contain at least 32 characters.'
    );
  }

  if (mfaEncryptionKey.length < 32) {
    throw new Error(
      'MFA_ENCRYPTION_KEY must contain at least 32 characters.'
    );
  }

  const rawMasterPassword = String(
    source.INITIAL_MASTER_PASSWORD || source.DEFAULT_ADMIN_PASSWORD || ''
  ).trim();

  if (production && !rawMasterPassword) {
    throw new Error(
      'INITIAL_MASTER_PASSWORD or DEFAULT_ADMIN_PASSWORD is required in production.'
    );
  }

  const insecurePasswords = [
    'pradeeshk@94309',
    'pk@nilavega_8427!cedar',
    'admin123',
    'changeme',
    'change-me',
    'placeholder',
  ];

  if (rawMasterPassword && insecurePasswords.some((bad) => rawMasterPassword.toLowerCase().includes(bad))) {
    throw new Error(
      'INITIAL_MASTER_PASSWORD contains an insecure or default password value.'
    );
  }

  const distributedAdapter = String(
    source.DISTRIBUTED_ADAPTER || (production ? 'redis' : 'memory')
  ).trim().toLowerCase();

  if (!['redis', 'memory'].includes(distributedAdapter)) {
    throw new Error('DISTRIBUTED_ADAPTER must be either "redis" or "memory".');
  }

  if (production && distributedAdapter === 'memory' && source.ALLOW_IN_MEMORY_CLUSTER !== 'true') {
    throw new Error('DISTRIBUTED_ADAPTER=memory is not permitted in production cluster mode.');
  }

  const redisUrl = String(source.REDIS_URL || '').trim();
  const redisHost = String(source.REDIS_HOST || (distributedAdapter === 'redis' && !redisUrl ? '127.0.0.1' : '')).trim();
  const redisPort = source.REDIS_PORT
    ? parsePositiveInteger('REDIS_PORT', source.REDIS_PORT, 6379)
    : 6379;

  return Object.freeze({
    nodeEnvironment,
    production,
    staging,
    distributedAdapter,
    redisUrl,
    redisHost,
    redisPort,
    host:
      String(source.HOST || '0.0.0.0')
        .trim() || '0.0.0.0',
    port: parsePositiveInteger(
      'PORT',
      source.PORT,
      4000
    ),
    mongodbUri,
    mongodbServerSelectionTimeoutMs:
      parsePositiveInteger(
        'MONGODB_SERVER_SELECTION_TIMEOUT_MS',
        source.MONGODB_SERVER_SELECTION_TIMEOUT_MS,
        10000
      ),
    mongodbMaxPoolSize:
      parsePositiveInteger(
        'MONGODB_MAX_POOL_SIZE',
        source.MONGODB_MAX_POOL_SIZE,
        100
      ),
    mongodbMinPoolSize:
      parseNonNegativeInteger(
        'MONGODB_MIN_POOL_SIZE',
        source.MONGODB_MIN_POOL_SIZE,
        10
      ),
    allowedOrigins: parseAllowedOrigins(
      source.ALLOWED_ORIGINS,
      production
    ),
    privateStorageDriver,
    cloudinaryCloudName,
    cloudinaryApiKey,
    cloudinaryApiSecret,
    jwtAccessSecret,
    mfaEncryptionKey,
    initialOrganisationId: String(source.INITIAL_ORGANISATION_ID || 'ZAMORIN').trim(),
    initialMasterName: String(source.INITIAL_MASTER_NAME || 'Zamorin Primary Master').trim(),
    initialMasterEmail: String(source.INITIAL_MASTER_EMAIL || 'pradeeshk331@gmail.com').trim(),
    initialMasterPassword: rawMasterPassword,
  });
}

module.exports = {
  loadEnvironment,
  parseAllowedOrigins,
};
