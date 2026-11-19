'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const { createApp } = require('../src/server');
const { User } = require('../src/models/User');
const authService = require('../src/services/authService');

describe('Customer segment creation (SCR-023-lite)', () => {
  let mongoServer;
  let server;
  let port;
  let accessToken;

  before(async () => {
    process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || 'test_jwt_access_secret_32_characters_long_min!';
    process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'test_jwt_refresh_secret_32_characters_long_min!';

    mongoServer = await MongoMemoryServer.create();
    await mongoose.connect(mongoServer.getUri());

    const app = createApp({ allowedOrigins: ['*'], production: false });
    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = server.address().port;

    const orgId = 'ORG-ZAMORIN-SEG';
    const user = await User.create({
      userId: 'AD-9001',
      organisationId: orgId,
      email: 'cafe.admin@zamorincafe.com',
      name: 'Cafe Admin',
      fullName: 'Cafe Admin',
      role: 'CAFE_ADMIN',
      accountStatus: 'ACTIVE',
      assignedCafeIds: ['ZC-CAF-01'],
      primaryCafeId: 'ZC-CAF-01',
      passwordHash: await authService.hashPassword('SegPass12345!Secure', { minLength: 15 }),
      sessionVersion: 1,
      permissionsVersion: 1,
      createdBy: 'SYSTEM',
    });

    const session = await authService.createSession({
      user,
      device: { deviceId: 'DEV-SEG-01', deviceName: 'Seg Test Client' },
      createdBy: user.userId,
    });
    accessToken = session.accessToken;
  });

  after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await mongoose.disconnect();
    if (mongoServer) await mongoServer.stop();
  });

  function headers() {
    return { Authorization: `Bearer ${accessToken}`, 'x-device-id': 'DEV-SEG-01', 'Content-Type': 'application/json' };
  }

  it('requires authentication', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/v1/customers/segments`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'X' }) });
    assert.equal(res.status, 401);
  });

  it('creates a segment and lists it', async () => {
    const createRes = await fetch(`http://127.0.0.1:${port}/api/v1/customers/segments`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ name: 'Weekend Brunch', rules: { minVisitsPerMonth: 4, minSpend: 2500 } }),
    });
    assert.equal(createRes.status, 201);
    const createPayload = await createRes.json();
    assert.equal(createPayload.success, true);
    assert.ok(createPayload.data.segment.segmentId);

    const listRes = await fetch(`http://127.0.0.1:${port}/api/v1/customers/segments`, { headers: headers() });
    assert.equal(listRes.status, 200);
    const listPayload = await listRes.json();
    assert.ok(listPayload.data.segments.some((s) => s.name === 'Weekend Brunch'));

    // duplicate name rejected
    const dupRes = await fetch(`http://127.0.0.1:${port}/api/v1/customers/segments`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ name: 'Weekend Brunch' }),
    });
    assert.equal(dupRes.status, 409);

    // missing name rejected
    const emptyRes = await fetch(`http://127.0.0.1:${port}/api/v1/customers/segments`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ name: '' }),
    });
    assert.equal(emptyRes.status, 400);
  });
});