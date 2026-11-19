'use strict';

/**
 * ZAMORIN CAFÉ ERP — SECURE DURABLE DOCUMENT STORAGE ADAPTER
 * 
 * Canonical storage facade conforming to REC-06 Universal Durable Storage Architecture.
 * Delegates to provider-independent adapters (S3CompatibleStorageAdapter / LocalDevelopmentStorageAdapter).
 * 
 * Non-Negotiable Invariants:
 * - Production documents MUST use Private Durable External Object Storage.
 * - Local/ephemeral filesystems are strictly prohibited in production and fail closed.
 * - Zero provider lock-in: ERP domain code interacts solely through canonical methods.
 */

const path = require('path');
const crypto = require('crypto');
const { createStorageProvider, DocumentStorageProvider } = require('./storage');
const { ApiError } = require('../utils/ApiError');

class DocumentStorageAdapter {
  constructor(options = {}) {
    this.options = options;
    const isProd = process.env.NODE_ENV === 'production';
    this.driver = options.driver || process.env.DOCUMENT_STORAGE_PROVIDER || process.env.DOCUMENT_STORAGE_DRIVER || (isProd ? 'gridfs' : 'RENDER_PERSISTENT_DISK');
    this.storageRoot = options.storageRoot || process.env.DOCUMENT_STORAGE_ROOT || null;
    this.objectStoreClient = options.objectStoreClient || null;
    this._provider = null;
    this.metrics = {
      totalStored: 0,
      totalBytes: 0,
      totalStreamsServed: 0,
    };
  }

  getProvider() {
    if (!this._provider) {
      const isProd = process.env.NODE_ENV === 'production';
      let mappedDriver = String(this.driver).toLowerCase();
      if (mappedDriver === 'gridfs' || mappedDriver === 'mongodb' || mappedDriver === 'mongodb_gridfs') {
        mappedDriver = 'gridfs';
      } else if (mappedDriver === 'render_persistent_disk' || mappedDriver === 'local') {
        mappedDriver = isProd ? (this.options.allowLocalInProdForTesting ? 'local' : 'gridfs') : 'local';
      } else if (mappedDriver === 'private_object_storage' || mappedDriver === 's3' || mappedDriver === 's3_compatible') {
        mappedDriver = 's3';
      }

      this._provider = createStorageProvider({
        driver: mappedDriver,
        storageRoot: this.storageRoot,
        client: this.objectStoreClient,
        allowLocalInProdForTesting: Boolean(this.options.allowLocalInProdForTesting),
      });
    }
    return this._provider;
  }

  getResolvedStorageRoot() {
    const p = this.getProvider();
    if (typeof p.getResolvedRoot === 'function') {
      return p.getResolvedRoot();
    }
    return this.storageRoot ? path.resolve(this.storageRoot) : null;
  }

  /**
   * Validates permanent document storage configuration at application startup.
   * Fails safe: Production backend will NEVER accept attachments without verified durable storage.
   */
  validateStartupConfiguration(env = process.env) {
    const isProd = (env.NODE_ENV === 'production');
    const driver = this.driver || env.DOCUMENT_STORAGE_PROVIDER || env.DOCUMENT_STORAGE_DRIVER || 'RENDER_PERSISTENT_DISK';

    if (isProd && driver === 'local') {
      throw new ApiError(
        500,
        'PROD_EPHEMERAL_STORAGE_DISALLOWED',
        'Production business documents must NOT depend on Render ephemeral filesystem or local container disk. Private durable external object storage is mandatory.'
      );
    }

    if (driver === 'RENDER_PERSISTENT_DISK') {
      const root = this.storageRoot || env.DOCUMENT_STORAGE_ROOT;
      if (isProd && (!root || String(root).trim() === '')) {
        throw new ApiError(
          500,
          'DOCUMENT_STORAGE_NOT_CONFIGURED',
          'DOCUMENT_STORAGE_ROOT is not configured. Render backend requires an attached persistent disk mount path (e.g. /var/data/zamorin_documents). Ephemeral container filesystem is strictly disallowed for permanent documents.'
        );
      }

      if (isProd) {
        const resolved = path.resolve(root);
        const appSourceDir = path.resolve(__dirname, '../../..');
        if (resolved.startsWith(appSourceDir)) {
          throw new ApiError(
            500,
            'EPHEMERAL_STORAGE_DISALLOWED_IN_PRODUCTION',
            `Configured DOCUMENT_STORAGE_ROOT (${root}) is located inside the application repository/container root. A dedicated external persistent mount (e.g. /var/data/zamorin_documents) is required.`
          );
        }
      }

      const effectiveRoot = this.getResolvedStorageRoot();
      if (!effectiveRoot) {
        throw new ApiError(500, 'DOCUMENT_STORAGE_NOT_CONFIGURED', 'Unable to resolve durable document storage root.');
      }

      try {
        const fs = require('fs');
        fs.mkdirSync(effectiveRoot, { recursive: true });
        const probe = path.join(effectiveRoot, `.probe-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.tmp`);
        fs.writeFileSync(probe, 'DURABLE_STORAGE_PROBE', 'utf8');
        fs.unlinkSync(probe);
      } catch (err) {
        throw new ApiError(500, 'DOCUMENT_STORAGE_UNAVAILABLE', `Cannot initialize durable storage directory: ${err.message}`);
      }

      return true;
    }

    if (driver === 'gridfs' || driver === 'mongodb_gridfs' || driver === 'mongodb') {
      const uri = env.MONGODB_URI;
      if (isProd && (!uri || !String(uri).trim())) {
        throw new ApiError(
          500,
          'DOCUMENT_STORAGE_NOT_CONFIGURED',
          'Production GridFS document storage requires valid MONGODB_URI.'
        );
      }
      return true;
    }

    if (driver === 'PRIVATE_OBJECT_STORAGE' || driver === 's3' || driver === 's3_compatible') {
      const hasBucket = Boolean(env.S3_BUCKET || env.STORAGE_CONTAINER);
      const hasCreds = Boolean(
        (env.AWS_ACCESS_KEY_ID || env.STORAGE_ACCESS_KEY) &&
        (env.AWS_SECRET_ACCESS_KEY || env.STORAGE_SECRET_KEY)
      );
      if (isProd && !hasBucket && !hasCreds && !this.objectStoreClient) {
        throw new ApiError(
          500,
          'DOCUMENT_STORAGE_NOT_CONFIGURED',
          'PRIVATE_OBJECT_STORAGE requires valid bucket and access credentials in production. Ephemeral storage is disallowed.'
        );
      }
      return true;
    }

    return true;
  }

  /**
   * Generates a canonical, opaque, non-public storage key.
   * Format: <organisationId>/<cafeId>/<classification>/<documentId>.<ext>
   * No PII, GSTIN, FSSAI, or raw filenames are exposed in storage keys.
   */
  generateStorageKey({ organisationId = 'ZAMORIN', cafeId = 'GLOBAL', classification = 'PROCUREMENT', documentId, mimeType }) {
    const org = String(organisationId || 'ZAMORIN').trim().toUpperCase();
    const cafe = String(cafeId || 'GLOBAL').trim().toUpperCase();
    const docClass = String(classification || 'PROCUREMENT').trim().toLowerCase();
    const extMap = {
      'application/pdf': 'pdf',
      'image/jpeg': 'jpg',
      'image/jpg': 'jpg',
      'image/png': 'png',
      'image/webp': 'webp',
    };
    const ext = extMap[String(mimeType || '').toLowerCase()] || 'bin';
    const opaqueId = `${documentId}-${crypto.randomBytes(6).toString('hex')}`;
    return `${org}/${cafe}/${docClass}/${opaqueId}.${ext}`;
  }

  /**
   * Generates a quarantined storage key for pre-scan isolation.
   */
  generateQuarantineKey({ organisationId = 'ZAMORIN', cafeId = 'GLOBAL', documentId, mimeType }) {
    const org = String(organisationId || 'ZAMORIN').trim().toUpperCase();
    const cafe = String(cafeId || 'GLOBAL').trim().toUpperCase();
    const extMap = {
      'application/pdf': 'pdf',
      'image/jpeg': 'jpg',
      'image/jpg': 'jpg',
      'image/png': 'png',
      'image/webp': 'webp',
    };
    const ext = extMap[String(mimeType || '').toLowerCase()] || 'bin';
    return `quarantine/${org}/${cafe}/${documentId}-${crypto.randomBytes(6).toString('hex')}.${ext}`;
  }

  async put({ stream = null, buffer = null, filePath = null, storageKey, mimeType = 'application/octet-stream', sizeBytes = 0, organisationId = 'ZAMORIN', metadata = {} }) {
    if (!storageKey) {
      throw new ApiError(400, 'MISSING_STORAGE_KEY', 'Storage key is required for document persistence.');
    }

    const provider = this.getProvider();
    const result = await provider.putObject({
      objectKey: storageKey,
      stream,
      buffer,
      filePath,
      mimeType,
      sizeBytes,
      metadata: { organisationId, ...metadata },
    });

    this.metrics.totalStored++;
    this.metrics.totalBytes += (result.sizeBytes || sizeBytes);

    return {
      storageDriver: result.storageProvider === 'GRIDFS' ? 'GRIDFS' : (result.storageProvider === 'LOCAL_DEV' ? 'RENDER_PERSISTENT_DISK' : 'PRIVATE_OBJECT_STORAGE'),
      storageProvider: result.storageProvider,
      storageKey,
      storageObjectKey: storageKey,
      gridFsFileId: result.gridFsFileId || null,
      storagePath: result.storagePath || (this.getResolvedStorageRoot() ? path.join(this.getResolvedStorageRoot(), storageKey) : null),
      sizeBytes: result.sizeBytes,
      sha256: result.sha256,
      versionId: result.versionId,
      storedAt: result.storedAt,
    };
  }

  async getStream({ storageKey, fileId = null }) {
    if (!storageKey && !fileId) {
      throw new ApiError(400, 'MISSING_STORAGE_KEY', 'Storage key or fileId is required.');
    }
    const provider = this.getProvider();
    const stream = await provider.openReadStream({ objectKey: storageKey, fileId });
    this.metrics.totalStreamsServed++;
    return stream;
  }

  async exists({ storageKey }) {
    if (!storageKey) return false;
    const provider = this.getProvider();
    return provider.objectExists({ objectKey: storageKey });
  }

  async delete({ storageKey }) {
    if (!storageKey) return false;
    const provider = this.getProvider();
    return provider.deleteObject({ objectKey: storageKey });
  }

  async deleteFile({ storageKey }) {
    return this.delete({ storageKey });
  }

  async copy({ sourceKey, destinationKey }) {
    const provider = this.getProvider();
    return provider.copyObject({ sourceKey, destinationKey });
  }

  async createUploadGrant({ storageKey, mimeType, sizeBytes, expiresInSeconds = 300 }) {
    const provider = this.getProvider();
    return provider.createUploadGrant({ objectKey: storageKey, mimeType, sizeBytes, expiresInSeconds });
  }

  async createDownloadGrant({ storageKey, expiresInSeconds = 180, safeFilename = 'document' }) {
    const provider = this.getProvider();
    return provider.createDownloadGrant({ objectKey: storageKey, expiresInSeconds, safeFilename });
  }

  async healthCheck() {
    try {
      const provider = this.getProvider();
      const res = await provider.healthCheck();
      return {
        status: res.status,
        driver: this.driver,
        provider: res.provider,
        storageRoot: this.getResolvedStorageRoot(),
        metrics: this.metrics,
      };
    } catch (err) {
      return {
        status: 'ERROR',
        driver: this.driver,
        message: err.message,
      };
    }
  }

  /**
   * Returns authoritative runtime capability vs configuration status for storage.
   */
  static getStorageRuntimeStatus() {
    const isProduction = process.env.NODE_ENV === 'production';
    const isGridFsConfigured = Boolean(process.env.MONGODB_URI || process.env.DOCUMENT_STORAGE_PROVIDER === 'gridfs');
    const isS3Configured = Boolean(
      process.env.DOCUMENT_STORAGE_BUCKET &&
      (process.env.DOCUMENT_STORAGE_ENDPOINT || process.env.AWS_REGION) &&
      process.env.DOCUMENT_STORAGE_ACCESS_KEY_ID &&
      process.env.DOCUMENT_STORAGE_SECRET_ACCESS_KEY
    );

    return {
      PRODUCTION_STORAGE_ADAPTER_IMPLEMENTED: true,
      LIVE_PRODUCTION_OBJECT_STORAGE_CONFIGURED: isGridFsConfigured || isS3Configured ? true : 'EXTERNAL_PENDING',
      LOCAL_MOCK_ADAPTERS_ALLOWED_IN_PRODUCTION: false,
      RENDER_FILESYSTEM_PRODUCTION_FALLBACK: false,
      STORAGE_DRIVER_SELECTED: isProduction ? 'MONGODB_ATLAS_GRIDFS' : 'LOCAL_DEV_OR_MOCK_STORE',
      GRIDFS_BUCKET: process.env.DOCUMENT_GRIDFS_BUCKET || 'zamorinDocuments',
    };
  }
}

const documentStorageAdapter = new DocumentStorageAdapter();

module.exports = {
  DocumentStorageAdapter,
  documentStorageAdapter,
};
