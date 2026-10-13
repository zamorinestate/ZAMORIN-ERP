'use strict';

/**
 * startDev.js
 *
 * Development-only startup script.
 * Spins up mongodb-memory-server, seeds the MASTER account,
 * then starts the Zamorin Cafe ERP backend on PORT 4000.
 *
 * Usage: node src/scripts/startDev.js
 */

require('dotenv').config();

process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || 'zamorin_dev_secret_access_key_min_32_characters';
process.env.MFA_ENCRYPTION_KEY = process.env.MFA_ENCRYPTION_KEY || '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
process.env.CAFE_ACCESS_HMAC_SECRET = process.env.CAFE_ACCESS_HMAC_SECRET || '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
process.env.PORT = process.env.PORT || '4000';

const { MongoMemoryServer } = require('mongodb-memory-server');

const {
  connectDatabase,
  disconnectDatabase,
} = require('../config/database');

const {
  seedMasterUser,
  seedPermissionRules,
  seedSystemCommunicationSettings,
} = require('./seedInitialData');

async function main() {
  let uri = process.env.MONGODB_URI;
  let mongod = null;

  // Try primary URI if provided, otherwise detect local or spin up in-memory Mongo
  let connected = false;
  if (uri && process.env.USE_IN_MEMORY_DB !== 'true') {
    try {
      console.log('[dev] Attempting connection to configured MONGODB_URI...');
      await connectDatabase({ uri, serverSelectionTimeoutMs: 2500 });
      connected = true;
      console.log('[dev] Connected to configured MongoDB cluster.');
    } catch (err) {
      console.warn(`[dev] Could not connect to configured MONGODB_URI: ${err.message}`);
      console.log('[dev] Falling back to local/in-memory MongoDB...');
    }
  }

  if (!connected) {
    const net = require('net');
    const isLocalMongo = await new Promise((resolve) => {
      const socket = new net.Socket();
      socket.setTimeout(800);
      socket.on('connect', () => { socket.destroy(); resolve(true); });
      socket.on('timeout', () => { socket.destroy(); resolve(false); });
      socket.on('error', () => { resolve(false); });
      socket.connect(27017, '127.0.0.1');
    });

    if (isLocalMongo) {
      uri = 'mongodb://127.0.0.1:27017/zamorin_cafe_erp';
      console.log(`[dev] Persistent local MongoDB detected at ${uri}`);
    } else {
      console.log('[dev] Starting in-memory MongoDB...');
      mongod = await MongoMemoryServer.create({
        instance: { dbName: 'zamorin_cafe_erp' },
      });
      uri = mongod.getUri();
      console.log(`[dev] In-memory MongoDB ready at ${uri}`);
    }

    // Override MONGODB_URI so the environment validator and subsequent connections accept it
    process.env.MONGODB_URI = uri;
    await connectDatabase({ uri });
  }

  const organisationId =
    process.env.INITIAL_ORGANISATION_ID || 'ZAMORIN';
  const masterName =
    process.env.INITIAL_MASTER_NAME || 'Zamorin Primary Master';
  const masterEmail =
    process.env.INITIAL_MASTER_EMAIL || 'pradeeshk331@gmail.com';
  const crypto = require('crypto');
  const masterPassword =
    process.env.INITIAL_MASTER_PASSWORD ||
    process.env.DEFAULT_ADMIN_PASSWORD ||
    crypto.randomBytes(24).toString('base64url');

  console.log('[dev] Seeding MASTER account and canonical role users...');

  const masterUser = await seedMasterUser({
    organisationId,
    masterName,
    masterEmail,
    masterPassword,
  });

  await seedPermissionRules({
    organisationId,
    masterUserId: masterUser.userId,
  });

  await seedSystemCommunicationSettings({
    organisationId,
    masterEmail,
  });

  console.log(
    `[dev] Seed complete — login: ${masterEmail} / ${masterPassword}`
  );

  await disconnectDatabase();

  // Now start the full Express server
  const { startServer, registerShutdownHandlers } =
    require('../server');

  const { server } = await startServer();

  registerShutdownHandlers(server);

  // Keep mongod alive for the server lifetime
  process.on('exit', async () => {
    if (mongod) await mongod.stop();
  });
}

main().catch((error) => {
  console.error('[dev] Startup failed:', error);
  process.exitCode = 1;
});
