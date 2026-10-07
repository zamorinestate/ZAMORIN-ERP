'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const { loadEnvironment } = require('../src/config/environment');
const {
  initializeDistributedInfrastructure,
  createApp,
} = require('../src/server');
const { redisClientFactory } = require('../src/services/redisClientFactory');
const { defaultLimiter } = require('../src/services/distributedRateLimiter');
const { defaultJobCoordinator } = require('../src/services/jobCoordinationService');

describe('P0-E: Distributed Infrastructure & Redis Initialization', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(async () => {
    process.env = { ...originalEnv };
    await redisClientFactory.close().catch(() => {});
  });

  it('1. Explicit development mode (DISTRIBUTED_ADAPTER=memory) configures in-memory adapters', async () => {
    const env = {
      nodeEnvironment: 'development',
      production: false,
      staging: false,
      distributedAdapter: 'memory',
    };

    const result = await initializeDistributedInfrastructure(env);

    assert.strictEqual(result.mode, 'memory');
    assert.strictEqual(result.ready, true);
    assert.strictEqual(redisClientFactory.status, 'IN_MEMORY');
    assert.strictEqual(defaultLimiter.isDistributed, false);
    assert.strictEqual(defaultLimiter.degraded, false);
  });

  it('2. Production rejects silent or explicit memory mode unless explicitly allowed', () => {
    // Attempting to run production with DISTRIBUTED_ADAPTER=memory must fail safe
    assert.throws(
      () => {
        loadEnvironment({
          NODE_ENV: 'production',
          MONGODB_URI: 'mongodb://localhost:27017/zamorin',
          JWT_ACCESS_SECRET: 'a'.repeat(32),
          MFA_ENCRYPTION_KEY: 'b'.repeat(32),
          INITIAL_MASTER_PASSWORD: 'ValidSecureMasterPassword_2026!#',
          DISTRIBUTED_ADAPTER: 'memory',
        });
      },
      (err) => {
        return (
          err instanceof Error &&
          /DISTRIBUTED_ADAPTER=memory is not permitted in production/i.test(err.message)
        );
      }
    );
  });

  it('3. Production defaults to DISTRIBUTED_ADAPTER=redis and parses Redis config', () => {
    const config = loadEnvironment({
      NODE_ENV: 'production',
      MONGODB_URI: 'mongodb://localhost:27017/zamorin',
      JWT_ACCESS_SECRET: 'a'.repeat(32),
      MFA_ENCRYPTION_KEY: 'b'.repeat(32),
      INITIAL_MASTER_PASSWORD: 'ValidSecureMasterPassword_2026!#',
      ALLOWED_ORIGINS: 'https://zamorin.cafe',
      REDIS_URL: 'redis://10.0.0.1:6379',
    });

    assert.strictEqual(config.distributedAdapter, 'redis');
    assert.strictEqual(config.redisUrl, 'redis://10.0.0.1:6379');
  });

  it('4. Production fails closed when Redis connection is unavailable in distributed mode', async () => {
    const originalInit = redisClientFactory.initializeClients.bind(redisClientFactory);
    redisClientFactory.initializeClients = async () => {
      throw new Error('connect ECONNREFUSED 127.0.0.1:6379');
    };

    try {
      const env = {
        nodeEnvironment: 'production',
        production: true,
        staging: false,
        distributedAdapter: 'redis',
        redisUrl: 'redis://127.0.0.1:6379',
      };

      let errorThrown = null;
      try {
        await initializeDistributedInfrastructure(env);
      } catch (err) {
        errorThrown = err;
      }

      assert.ok(errorThrown, 'Must throw error when Redis fails to connect in production');
      assert.strictEqual(errorThrown.code, 'REDIS_CLUSTER_INITIALIZATION_FAILED');
      assert.match(errorThrown.message, /Clustered production requires operational Redis/i);

      // Verify it did NOT silently pretend distributed coordination exists
      assert.notStrictEqual(redisClientFactory.status, 'READY');
    } finally {
      redisClientFactory.initializeClients = originalInit;
    }
  });

  it('5. Successfully connects mock Redis client and wires distributed services', async () => {
    // Mock redis client simulating successful connection
    const mockCommandClient = {
      connect: async () => {},
      quit: async () => {},
      on: () => {},
      ping: async () => 'PONG',
      get: async () => null,
      set: async () => 'OK',
      duplicate: () => ({
        connect: async () => {},
        quit: async () => {},
        on: () => {},
        subscribe: async () => {},
      }),
    };

    // Spy/mock initializeClients
    const originalInit = redisClientFactory.initializeClients.bind(redisClientFactory);
    redisClientFactory.initializeClients = async () => {
      redisClientFactory.commandClient = mockCommandClient;
      redisClientFactory.status = 'READY';
      return {
        initialized: true,
        mode: 'REDIS_CLUSTER',
        commandClient: mockCommandClient,
      };
    };

    try {
      const env = {
        nodeEnvironment: 'production',
        production: true,
        distributedAdapter: 'redis',
        redisUrl: 'redis://localhost:6379',
      };

      const result = await initializeDistributedInfrastructure(env);

      assert.strictEqual(result.mode, 'redis');
      assert.strictEqual(result.ready, true);
      assert.strictEqual(defaultLimiter.isDistributed, true);
      assert.strictEqual(defaultLimiter.redisClient, mockCommandClient);
      assert.strictEqual(defaultJobCoordinator.redisClient, mockCommandClient);
    } finally {
      redisClientFactory.initializeClients = originalInit;
    }
  });

  it('6. Readiness probe reflects distributed adapter health', async () => {
    const env = {
      nodeEnvironment: 'development',
      production: false,
      staging: false,
      distributedAdapter: 'memory',
      allowedOrigins: ['http://localhost:3000'],
    };

    const app = createApp(env);
    const http = require('http');
    const server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, resolve));
    const port = server.address().port;

    try {
      const res = await fetch(`http://127.0.0.1:${port}/health/ready`);
      const json = await res.json();

      assert.strictEqual(json.distributed.adapter, 'memory');
      assert.strictEqual(json.distributed.redis.status, 'IN_MEMORY');
      assert.strictEqual(json.distributed.redis.isConnected, true);
    } finally {
      server.close();
    }
  });
});
