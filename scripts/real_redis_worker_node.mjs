// =============================================================================
// ZAMORIN CAFÉ ERP — MULTI-PROCESS REDIS WORKER NODE
// scripts/real_redis_worker_node.mjs
//
// Standalone child process running with distinct OS PID, connected to real
// Redis TCP socket via the official 'redis' package.
// =============================================================================

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const backendDir = path.join(rootDir, 'Backend');
const require = createRequire(path.resolve(backendDir, 'package.json'));

const redis = require('redis');
const { JobCoordinationService } = require('./src/services/jobCoordinationService');

const workerId = process.argv[2] || `worker-${process.pid}`;
const redisPort = parseInt(process.argv[3] || '6390', 10);
const redisUrl = `redis://127.0.0.1:${redisPort}`;

// Set clustered environment to enforce fail-closed behavior
process.env.CLUSTER_MODE = 'true';
process.env.NODE_ENV = 'production';
process.env.DISTRIBUTED_ADAPTER = 'redis';

let redisClient = null;
let coordinator = null;

async function init() {
  try {
    redisClient = redis.createClient({
      url: redisUrl,
      RESP: 2,
      disableOfflineQueue: true,
      socket: {
        connectTimeout: 2000,
        reconnectStrategy: (retries) => 50,
      },
    });

    redisClient.on('error', (err) => {
      // Catch connection errors during outage
    });

    await redisClient.connect();

    coordinator = new JobCoordinationService({
      redisClient,
      isDistributed: true,
      distributedAdapter: 'redis',
    });

    if (process.send) {
      process.send({
        type: 'READY',
        workerId,
        pid: process.pid,
      });
    }
  } catch (err) {
    console.error(`[Worker ${workerId} Init Error]:`, err);
    if (process.send) {
      process.send({
        type: 'INIT_ERROR',
        workerId,
        pid: process.pid,
        error: err.message,
      });
    }
    process.exit(1);
  }
}

process.on('message', async (msg) => {
  if (!msg || !msg.action) return;

  const { id, action, payload = {} } = msg;

  try {
    switch (action) {
      case 'ACQUIRE_LOCK': {
        const { jobName, ttlMs = 60000 } = payload;
        const res = await coordinator.acquireLock(jobName, workerId, ttlMs);
        process.send({ id, success: true, ...res, workerId, pid: process.pid });
        break;
      }

      case 'VERIFY_TOKEN': {
        const { jobName, fencingToken } = payload;
        const valid = await coordinator.verifyFencingToken(jobName, workerId, fencingToken);
        process.send({ id, success: true, valid, workerId, pid: process.pid });
        break;
      }

      case 'EXTEND_LOCK': {
        const { jobName, additionalTtlMs = 60000 } = payload;
        const extended = await coordinator.extendLock(jobName, workerId, additionalTtlMs);
        process.send({ id, success: true, extended, workerId, pid: process.pid });
        break;
      }

      case 'RELEASE_LOCK': {
        const { jobName } = payload;
        const released = await coordinator.releaseLock(jobName, workerId);
        process.send({ id, success: true, released, workerId, pid: process.pid });
        break;
      }

      case 'IDEMPOTENT_WRITE': {
        const { idempotencyKey, transactionData } = payload;
        let executedFresh = false;
        const result = await coordinator.executeIdempotent(idempotencyKey, async () => {
          executedFresh = true;
          return {
            status: 'COMMITTED',
            committedBy: workerId,
            pid: process.pid,
            timestamp: Date.now(),
            data: transactionData,
          };
        });
        process.send({ id, success: true, result, executedFresh, workerId, pid: process.pid });
        break;
      }

      case 'PING': {
        process.send({ id, success: true, pong: true, workerId, pid: process.pid });
        break;
      }

      case 'DISCONNECT': {
        if (redisClient) {
          await redisClient.disconnect().catch(() => {});
        }
        process.send({ id, success: true, disconnected: true });
        process.exit(0);
        break;
      }

      default:
        process.send({ id, success: false, error: `Unknown action ${action}` });
    }
  } catch (err) {
    process.send({
      id,
      success: false,
      error: err.message,
      code: err.code || 'UNKNOWN_ERROR',
      workerId,
      pid: process.pid,
    });
  }
});

init();
