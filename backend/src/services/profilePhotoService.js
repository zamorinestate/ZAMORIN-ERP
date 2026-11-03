'use strict';

/**
 * PROFILE PHOTO SERVICE — Settings / My Profile (SCR-023)
 *
 * Self-service profile photo upload and removal backed by the canonical
 * document storage adapter (GridFS in production, local dev store elsewhere).
 *
 * Invariants:
 * - Self-service only: callers pass the authenticated user document.
 * - The stored object key is opaque (organisation/profile_photo/<userId>-<random>),
 *   never a public URL and never derived from the uploaded filename.
 * - Only JPEG, PNG and WebP payloads that pass magic-byte verification are
 *   accepted (defence against MIME spoofing / SVG script injection).
 * - Replacing or removing a photo deletes the previous stored object.
 */

const { User } = require('../models/User');
const { documentStorageAdapter } = require('./documentStorageAdapter');
const auditService = require('./auditService');
const ApiError = require('../utils/ApiError');

const MAX_PROFILE_PHOTO_BYTES = 2 * 1024 * 1024; // 2 MB (matches the Settings UI copy)
const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

function normalizeMimeType(value) {
  const mime = String(value || '').trim().toLowerCase();
  if (mime === 'image/jpg') return 'image/jpeg';
  return mime;
}

function detectImageMimeType(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return null;

  const isJpeg = buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  if (isJpeg) return 'image/jpeg';

  const isPng =
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a;
  if (isPng) return 'image/png';

  const isWebp =
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP';
  if (isWebp) return 'image/webp';

  return null;
}

/**
 * Validates an uploaded photo payload and normalises its MIME type.
 * Returns the verified MIME type, or throws a truthful ApiError.
 */
function validateProfilePhoto(buffer, declaredMimeType) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new ApiError(400, 'PROFILE_PHOTO_EMPTY', 'The uploaded profile photo is empty.');
  }

  if (buffer.length > MAX_PROFILE_PHOTO_BYTES) {
    throw new ApiError(
      413,
      'PROFILE_PHOTO_TOO_LARGE',
      'Profile photos must be 2 MB or smaller.'
    );
  }

  const declared = normalizeMimeType(declaredMimeType);
  if (!ALLOWED_MIME_TYPES.includes(declared)) {
    throw new ApiError(
      400,
      'PROFILE_PHOTO_TYPE_NOT_ALLOWED',
      'Only JPG, PNG or WebP profile photos are accepted.'
    );
  }

  const detected = detectImageMimeType(buffer);
  if (!detected) {
    throw new ApiError(
      400,
      'PROFILE_PHOTO_INVALID_CONTENT',
      'The uploaded file is not a valid JPG, PNG or WebP image.'
    );
  }

  if (detected !== declared) {
    throw new ApiError(
      400,
      'PROFILE_PHOTO_CONTENT_MISMATCH',
      'The uploaded image content does not match its declared file type.'
    );
  }

  return detected;
}

function isProfilePhotoKey(storageKey) {
  return Boolean(storageKey) && String(storageKey).toLowerCase().includes('/profile_photo/');
}

function toPhotoDescriptor(user) {
  return {
    photoUrl: user.photoAttachmentId ? '/settings/profile/photo' : null,
    photoMimeType: user.photoMimeType || null,
    photoSizeBytes: user.photoSizeBytes || null,
    photoUpdatedAt: user.photoUpdatedAt || null,
  };
}

/**
 * Stores a new profile photo for the authenticated user and removes the
 * previous one (if any).
 */
async function saveProfilePhoto({ user, buffer, mimeType, originalFilename, actorRole }) {
  if (!user || !user.userId || !user.organisationId) {
    throw new ApiError(401, 'AUTHENTICATION_REQUIRED', 'An authenticated user is required.');
  }

  const verifiedMimeType = validateProfilePhoto(buffer, mimeType);
  const previousKey = user.photoAttachmentId;

  const storageKey = documentStorageAdapter.generateStorageKey({
    organisationId: user.organisationId,
    cafeId: 'PROFILE',
    classification: 'profile_photo',
    documentId: user.userId,
    mimeType: verifiedMimeType,
  });

  let stored;
  try {
    stored = await documentStorageAdapter.put({
      buffer,
      storageKey,
      mimeType: verifiedMimeType,
      sizeBytes: buffer.length,
      organisationId: user.organisationId,
      metadata: {
        userId: user.userId,
        classification: 'PROFILE_PHOTO',
        originalFilename: String(originalFilename || '').slice(0, 200) || null,
      },
    });
  } catch (err) {
    if (err instanceof ApiError) throw err;
    throw new ApiError(
      503,
      'PROFILE_PHOTO_STORAGE_UNAVAILABLE',
      'The photo storage service is unavailable. The photo was not changed.'
    );
  }

  const updatedAt = new Date();
  const updated = await User.findOneAndUpdate(
    { userId: user.userId, organisationId: user.organisationId },
    {
      $set: {
        photoAttachmentId: stored.storageKey,
        photoMimeType: verifiedMimeType,
        photoSizeBytes: stored.sizeBytes || buffer.length,
        photoUpdatedAt: updatedAt,
      },
    },
    { new: true }
  );

  if (!updated) {
    // The account disappeared mid-request; do not leave an orphan object behind.
    await documentStorageAdapter.delete({ storageKey: stored.storageKey }).catch(() => {});
    throw new ApiError(404, 'USER_NOT_FOUND', 'Account not found.');
  }

  if (isProfilePhotoKey(previousKey) && previousKey !== stored.storageKey) {
    await documentStorageAdapter.delete({ storageKey: previousKey }).catch(() => {});
  }

  await auditService
    .recordAuditEvent({
      organisationId: user.organisationId,
      actorUserId: user.userId,
      actorRole: actorRole || user.role,
      module: 'SETTINGS',
      action: 'PROFILE_PHOTO_UPLOAD',
      entityType: 'USER',
      entityId: user.userId,
      metadata: {
        mimeType: verifiedMimeType,
        sizeBytes: buffer.length,
        replacedExistingPhoto: Boolean(previousKey),
      },
    })
    .catch(() => {});

  return toPhotoDescriptor(updated);
}

/**
 * Removes the authenticated user's profile photo and its stored object.
 * Idempotent: removing when no photo exists succeeds without changes.
 */
async function removeProfilePhoto({ user, actorRole }) {
  if (!user || !user.userId || !user.organisationId) {
    throw new ApiError(401, 'AUTHENTICATION_REQUIRED', 'An authenticated user is required.');
  }

  const previousKey = user.photoAttachmentId;

  const updated = await User.findOneAndUpdate(
    { userId: user.userId, organisationId: user.organisationId },
    {
      $set: {
        photoAttachmentId: null,
        photoMimeType: null,
        photoSizeBytes: null,
        photoUpdatedAt: null,
      },
    },
    { new: true }
  );

  if (!updated) {
    throw new ApiError(404, 'USER_NOT_FOUND', 'Account not found.');
  }

  if (isProfilePhotoKey(previousKey)) {
    await documentStorageAdapter.delete({ storageKey: previousKey }).catch(() => {});
  }

  if (previousKey) {
    await auditService
      .recordAuditEvent({
        organisationId: user.organisationId,
        actorUserId: user.userId,
        actorRole: actorRole || user.role,
        module: 'SETTINGS',
        action: 'PROFILE_PHOTO_REMOVE',
        entityType: 'USER',
        entityId: user.userId,
        metadata: { hadPhoto: true },
      })
      .catch(() => {});
  }

  return toPhotoDescriptor(updated);
}

module.exports = {
  MAX_PROFILE_PHOTO_BYTES,
  ALLOWED_MIME_TYPES,
  validateProfilePhoto,
  detectImageMimeType,
  saveProfilePhoto,
  removeProfilePhoto,
  toPhotoDescriptor,
};
