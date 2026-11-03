'use strict';

/**
 * PROFILE PHOTO — SETTINGS SELF-SERVICE CERTIFICATION
 *
 * Covers the profile photo upload / replace / remove endpoints added to
 * /api/v1/settings/profile/photo, including magic-byte validation, self-only
 * access, storage cleanup and the profile contract returned to the UI.
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const { createApp } = require('../src/server');
const { User } = require('../src/models/User');
const { Session } = require('../src/models/Session');
const authService = require('../src/services/authService');
const { documentStorageAdapter } = require('../src/services/documentStorageAdapter');
const { validateProfilePhoto } = require('../src/services/profilePhotoService');

const JPEG_BYTES = Buffer.concat([
  Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
  Buffer.from('profile-photo-test-jpeg-payload'),
]);
const PNG_BYTES = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from('profile-photo-test-png-payload'),
]);

function expectApiError(fn, code) {
  assert.throws(fn, (err) => {
    assert.equal(err.code, code);
    return true;
  });
}

describe('Profile photo upload / remove (Settings SCR-023)', () => {
  let mongoServer;
  let server;
  let port;
  let user;
  let accessToken;

  const orgId = 'ORG-ZAMORIN-PHOTO';
  const storedKeys = new Set();

  before(async () => {
    process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || 'test_jwt_access_secret_32_characters_long_min!';
    process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'test_jwt_refresh_secret_32_characters_long_min!';

    mongoServer = await MongoMemoryServer.create();
    await mongoose.connect(mongoServer.getUri());

    const app = createApp({ allowedOrigins: ['*'], production: false });
    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = server.address().port;

    const passwordHash = await authService.hashPassword('PhotoPass12345!Secure', { minLength: 15 });
    user = await User.create({
      userId: 'ST-9001',
      organisationId: orgId,
      email: 'photo.owner@zamorincafe.com',
      name: 'Photo Owner',
      fullName: 'Photo Owner',
      role: 'STAFF',
      accountStatus: 'ACTIVE',
      assignedCafeIds: ['ZC-CAF-01'],
      primaryCafeId: 'ZC-CAF-01',
      passwordHash,
      sessionVersion: 1,
      permissionsVersion: 1,
      createdBy: 'SYSTEM',
    });

    const session = await authService.createSession({
      user,
      device: { deviceId: 'DEV-PHOTO-01', deviceName: 'Photo Test Client' },
      createdBy: user.userId,
    });
    accessToken = session.accessToken;
  });

  after(async () => {
    for (const storageKey of storedKeys) {
      await documentStorageAdapter.delete({ storageKey }).catch(() => {});
    }
    await new Promise((resolve) => server.close(resolve));
    await mongoose.disconnect();
    if (mongoServer) await mongoServer.stop();
  });

  function authHeaders(extra = {}) {
    return {
      Authorization: `Bearer ${accessToken}`,
      'x-device-id': 'DEV-PHOTO-01',
      ...extra,
    };
  }

  async function uploadPhoto({ buffer = JPEG_BYTES, mimeType = 'image/jpeg', field = 'photo', token = accessToken } = {}) {
    const form = new FormData();
    form.append(field, new Blob([buffer], { type: mimeType }), 'profile.jpg');
    return fetch(`http://127.0.0.1:${port}/api/v1/settings/profile/photo`, {
      method: 'POST',
      headers: token ? authHeaders() : { 'x-device-id': 'DEV-PHOTO-01' },
      body: form,
    });
  }

  it('rejects non-image content and MIME spoofing before storage', () => {
    expectApiError(
      () => validateProfilePhoto(Buffer.from('this is definitely not an image'), 'image/jpeg'),
      'PROFILE_PHOTO_INVALID_CONTENT'
    );
    expectApiError(
      () => validateProfilePhoto(JPEG_BYTES, 'image/png'),
      'PROFILE_PHOTO_CONTENT_MISMATCH'
    );
    expectApiError(
      () => validateProfilePhoto(JPEG_BYTES, 'image/svg+xml'),
      'PROFILE_PHOTO_TYPE_NOT_ALLOWED'
    );
    expectApiError(
      () => validateProfilePhoto(Buffer.alloc(2 * 1024 * 1024 + 1, 0xff), 'image/jpeg'),
      'PROFILE_PHOTO_TOO_LARGE'
    );
  });

  it('requires authentication for upload, read and remove', async () => {
    const upload = await uploadPhoto({ token: null });
    assert.equal(upload.status, 401);

    const read = await fetch(`http://127.0.0.1:${port}/api/v1/settings/profile/photo`);
    assert.equal(read.status, 401);

    const remove = await fetch(`http://127.0.0.1:${port}/api/v1/settings/profile/photo`, {
      method: 'DELETE',
      headers: { 'x-device-id': 'DEV-PHOTO-01' },
    });
    assert.equal(remove.status, 401);
  });

  it('uploads a photo, exposes it on the profile contract and streams it back', async () => {
    const response = await uploadPhoto();
    assert.equal(response.status, 201);
    const payload = await response.json();
    assert.equal(payload.success, true);
    assert.equal(payload.data.photoUrl, '/settings/profile/photo');
    assert.equal(payload.data.photoMimeType, 'image/jpeg');

    const stored = await User.findOne({ userId: user.userId }).lean();
    assert.ok(stored.photoAttachmentId, 'storage key must be persisted');
    assert.match(stored.photoAttachmentId, /\/profile_photo\//);
    assert.equal(stored.photoMimeType, 'image/jpeg');
    assert.equal(stored.photoSizeBytes, JPEG_BYTES.length);
    assert.ok(stored.photoUpdatedAt instanceof Date);
    storedKeys.add(stored.photoAttachmentId);
    assert.equal(await documentStorageAdapter.exists({ storageKey: stored.photoAttachmentId }), true);

    const profileResponse = await fetch(`http://127.0.0.1:${port}/api/v1/settings/profile`, {
      headers: authHeaders(),
    });
    assert.equal(profileResponse.status, 200);
    const profilePayload = await profileResponse.json();
    assert.equal(profilePayload.data.profileImageUrl, '/settings/profile/photo');
    assert.equal(profilePayload.data.photoMimeType, 'image/jpeg');

    const photoResponse = await fetch(`http://127.0.0.1:${port}/api/v1/settings/profile/photo`, {
      headers: authHeaders(),
    });
    assert.equal(photoResponse.status, 200);
    assert.equal(photoResponse.headers.get('content-type'), 'image/jpeg');
    assert.equal(photoResponse.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(photoResponse.headers.get('cache-control'), 'private, no-store');
    const bytes = Buffer.from(await photoResponse.arrayBuffer());
    assert.deepEqual(bytes, JPEG_BYTES);
  });

  it('replacing a photo stores the new object and deletes the previous one', async () => {
    const beforeReplace = await User.findOne({ userId: user.userId }).lean();
    const previousKey = beforeReplace.photoAttachmentId;

    const response = await uploadPhoto({ buffer: PNG_BYTES, mimeType: 'image/png' });
    assert.equal(response.status, 201);
    const payload = await response.json();
    assert.equal(payload.data.photoMimeType, 'image/png');

    const afterReplace = await User.findOne({ userId: user.userId }).lean();
    assert.notEqual(afterReplace.photoAttachmentId, previousKey);
    storedKeys.add(afterReplace.photoAttachmentId);
    assert.match(afterReplace.photoAttachmentId, /\.png$/);
    assert.equal(await documentStorageAdapter.exists({ storageKey: previousKey }), false);

    const photoResponse = await fetch(`http://127.0.0.1:${port}/api/v1/settings/profile/photo`, {
      headers: authHeaders(),
    });
    assert.equal(photoResponse.status, 200);
    assert.equal(photoResponse.headers.get('content-type'), 'image/png');
  });

  it('removes the photo, deletes the stored object and stays idempotent', async () => {
    const beforeRemove = await User.findOne({ userId: user.userId }).lean();
    const storageKey = beforeRemove.photoAttachmentId;
    assert.ok(storageKey);

    const response = await fetch(`http://127.0.0.1:${port}/api/v1/settings/profile/photo`, {
      method: 'DELETE',
      headers: authHeaders(),
    });
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.data.photoUrl, null);

    const afterRemove = await User.findOne({ userId: user.userId }).lean();
    assert.equal(afterRemove.photoAttachmentId, null);
    assert.equal(afterRemove.photoMimeType, null);
    assert.equal(afterRemove.photoSizeBytes, null);
    assert.equal(afterRemove.photoUpdatedAt, null);
    assert.equal(await documentStorageAdapter.exists({ storageKey }), false);

    const photoResponse = await fetch(`http://127.0.0.1:${port}/api/v1/settings/profile/photo`, {
      headers: authHeaders(),
    });
    assert.equal(photoResponse.status, 404);

    const secondRemove = await fetch(`http://127.0.0.1:${port}/api/v1/settings/profile/photo`, {
      method: 'DELETE',
      headers: authHeaders(),
    });
    assert.equal(secondRemove.status, 200);
  });

  it('rejects a payload sent under the wrong multipart field name', async () => {
    const response = await uploadPhoto({ field: 'file' });
    assert.equal(response.status, 400);
    const payload = await response.json();
    assert.equal(payload.error.code, 'PROFILE_PHOTO_FIELD_INVALID');
  });
});
