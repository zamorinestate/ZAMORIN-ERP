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
process.env.INITIAL_ORGANISATION_ID = process.env.INITIAL_ORGANISATION_ID || 'ZAMORIN';
process.env.INITIAL_MASTER_NAME = process.env.INITIAL_MASTER_NAME || 'Zamorin Primary Master';
process.env.INITIAL_MASTER_EMAIL = process.env.INITIAL_MASTER_EMAIL || 'pradeeshk331@gmail.com';
process.env.INITIAL_MASTER_PASSWORD = process.env.INITIAL_MASTER_PASSWORD || 'Zamorin@2026Master!';
process.env.INITIAL_DEMO_PASSWORD = process.env.INITIAL_DEMO_PASSWORD || 'Zamorin@2026Master!';
process.env.INITIAL_OPERATOR_PIN_1 = process.env.INITIAL_OPERATOR_PIN_1 || '847291';
process.env.INITIAL_OPERATOR_PIN_2 = process.env.INITIAL_OPERATOR_PIN_2 || '847291';
process.env.SEED_MINIMAL = 'false';
process.env.SEED_DEMO_DATA = 'true';
process.env.DISABLE_MFA = 'true';

const { MongoMemoryServer } = require('mongodb-memory-server');

const {
  connectDatabase,
  disconnectDatabase,
} = require('../config/database');

const { runSeed } = require('./seedInitialData');
const { seedPassbookData } = require('./seedPassbookData');
const { User } = require('../models/User');
const bcrypt = require('bcrypt');

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

  console.log('[dev] Seeding complete enterprise dataset (cafes, menus, inventory, finance, workforce)...');
  await runSeed();

  try {
    await seedPassbookData();
  } catch (passErr) {
    console.warn('[dev] Passbook seed note:', passErr.message);
  }

  // Ensure connection is active before updating users
  await connectDatabase({ uri });

  // Ensure all users have 6-digit PIN and password configured
  const pin = '847291';
  const pinHash = await bcrypt.hash(pin, 10);
  const defaultPwdHash = await bcrypt.hash('Zamorin@2026Master!', 10);

  await User.updateMany(
    { organisationId: 'ZAMORIN' },
    {
      $set: {
        appPinEnabled: true,
        appPinHash: pinHash,
        operatorPinHash: pinHash,
        accountStatus: 'ACTIVE',
      }
    }
  );



  console.log('================================================================================');
  console.log('                  ZAMORIN CAFE ERP — DEV READY ACCOUNTS                         ');
  console.log('================================================================================');
  console.log(' 👑 Primary Master:  pradeeshk331@gmail.com / master@zamorin.cafe');
  console.log(' 💼 Owner:           owner@example.com');
  console.log(' ☕ Cafe Ops/Admin:  admin@example.com / rahul.ops@zamorin.cafe');
  console.log(' 🧑‍🍳 Staff:           staff@example.com');
  console.log(' 🔑 Dev Password:    Zamorin@2026Master! (or admin123)');
  console.log(' 🔢 6-Digit App PIN: 847291');
  console.log('================================================================================');

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
