'use strict';

/**
 * Enterprise Distributed Job Coordination & Mutual Exclusion Lock Service
 * 
 * Guarantees that scheduled cron jobs, payroll executions, retention cleanups,
 * and bulk notifications are executed by exactly one worker instance in a cluster.
 * 
 * Features:
 * - Distributed mutex lease locking (Redis or Mongo lock collection or Memory)
 * - Automatic TTL expiration to prevent deadlocks if a node terminates abruptly
 * - Monotonically increasing Fencing Tokens to protect against stale workers committing after lease expiry
 * - Lock extension (heartbeat) during long tasks
 * - Idempotency key tracking
 * - Atomic safe release (only release if owner matches)
 */

class JobCoordinationService {
  constructor(options = {}) {
    this.redisClient = options.redisClient || null;
    this.localLocks = new Map(); // key -> { owner, expiresAt, fencingToken }
    this.idempotencyLedger = new Map(); // key -> { result, timestamp, fencingToken }
    this.fencingCounter = 0;
    this.distributedAdapter = options.distributedAdapter || process.env.DISTRIBUTED_ADAPTER || (process.env.NODE_ENV === 'production' ? 'redis' : 'memory');
    this.isDistributed = options.isDistributed !== undefined ? options.isDistributed : (this.distributedAdapter === 'redis' || Boolean(this.redisClient));
    this.metrics = {
      locksAcquired: 0,
      locksDenied: 0,
      locksReleased: 0,
      locksExtended: 0,
      staleCommitsBlocked: 0,
      idempotentExecutionsSkipped: 0,
    };
  }

  isClusteredOrDistributed() {
    return (
      this.isDistributed ||
      this.distributedAdapter === 'redis' ||
      Boolean(this.redisClient) ||
      process.env.NODE_ENV === 'production' ||
      process.env.CLUSTER_MODE === 'true'
    );
  }

  setRedisClient(client) {
    this.redisClient = client;
    this.isDistributed = Boolean(client);
  }

  _generateFencingToken() {
    this.fencingCounter = (this.fencingCounter + 1) % 10000;
    return Date.now() * 10000 + this.fencingCounter;
  }

  /**
   * Attempts to acquire an exclusive lock for a job name.
   * In clustered or production mode, fails closed if Redis is unavailable.
   * @param {string} jobName - Unique job identifier.
   * @param {string} ownerId - Unique identifier of the requesting instance/worker.
   * @param {number} ttlMs - Lock lease duration in milliseconds (default: 60s).
   * @returns {Promise<{ acquired: boolean, fencingToken: number|null }>} 
   */
  async acquireLock(jobName, ownerId = `inst-${process.pid}`, ttlMs = 60000) {
    const lockKey = `lock:job:${jobName}`;
    const fencingKey = `lock:fencing:${jobName}`;
    const now = Date.now();
    const fencingToken = this._generateFencingToken();

    if (this.redisClient) {
      try {
        const payload = JSON.stringify({ ownerId, fencingToken, acquiredAt: now });
        const result = await this.redisClient.set(lockKey, payload, 'NX', 'PX', ttlMs);
        if (result === 'OK') {
          await this.redisClient.set(fencingKey, String(fencingToken));
          this.metrics.locksAcquired++;
          return { acquired: true, fencingToken };
        }
        this.metrics.locksDenied++;
        return { acquired: false, fencingToken: null };
      } catch (err) {
        console.warn(`[JobCoordination] Redis lock failed: ${err.message}`);
        if (this.isClusteredOrDistributed()) {
          this.metrics.locksDenied++;
          const lockErr = new Error(`DISTRIBUTED_LOCK_BACKEND_UNAVAILABLE: Redis lock backend failed (${err.message}). Fail-closed in clustered mode.`);
          lockErr.code = 'DISTRIBUTED_LOCK_BACKEND_UNAVAILABLE';
          throw lockErr;
        }
      }
    } else if (this.isClusteredOrDistributed()) {
      this.metrics.locksDenied++;
      const lockErr = new Error('DISTRIBUTED_LOCK_BACKEND_UNAVAILABLE: Redis client is not initialized in clustered mode. Fail-closed.');
      lockErr.code = 'DISTRIBUTED_LOCK_BACKEND_UNAVAILABLE';
      throw lockErr;
    }

    // Explicit single-node in-memory mode ONLY (e.g. DISTRIBUTED_ADAPTER=memory in non-production)
    const existing = this.localLocks.get(lockKey);
    if (existing && existing.expiresAt > now && existing.owner !== ownerId) {
      this.metrics.locksDenied++;
      return { acquired: false, fencingToken: null };
    }

    this.localLocks.set(lockKey, { owner: ownerId, expiresAt: now + ttlMs, fencingToken });
    this.metrics.locksAcquired++;
    return { acquired: true, fencingToken };
  }

  /**
   * Extends the lease duration for an actively held lock.
   */
  async extendLock(jobName, ownerId = `inst-${process.pid}`, additionalTtlMs = 60000) {
    const lockKey = `lock:job:${jobName}`;
    const now = Date.now();

    if (this.redisClient) {
      try {
        const lua = `
          local raw = redis.call("get", KEYS[1])
          if raw then
            local data = cjson.decode(raw)
            if data.ownerId == ARGV[1] then
              return redis.call("pexpire", KEYS[1], ARGV[2])
            end
          end
          return 0
        `;
        const res = await this.redisClient.eval(lua, 1, lockKey, ownerId, additionalTtlMs);
        if (res === 1) {
          this.metrics.locksExtended++;
          return true;
        }
        return false;
      } catch (err) {
        if (this.isClusteredOrDistributed()) {
          const lockErr = new Error(`DISTRIBUTED_LOCK_BACKEND_UNAVAILABLE: Redis lock extend failed (${err.message}). Fail-closed in clustered mode.`);
          lockErr.code = 'DISTRIBUTED_LOCK_BACKEND_UNAVAILABLE';
          throw lockErr;
        }
      }
    } else if (this.isClusteredOrDistributed()) {
      const lockErr = new Error('DISTRIBUTED_LOCK_BACKEND_UNAVAILABLE: Redis client is not initialized in clustered mode. Fail-closed.');
      lockErr.code = 'DISTRIBUTED_LOCK_BACKEND_UNAVAILABLE';
      throw lockErr;
    }

    const existing = this.localLocks.get(lockKey);
    if (existing && existing.owner === ownerId && existing.expiresAt > now) {
      existing.expiresAt = now + additionalTtlMs;
      this.metrics.locksExtended++;
      return true;
    }
    return false;
  }

  /**
   * Verifies if a fencing token is still authoritative (has not been superseded by a newer worker).
   */
  async verifyFencingToken(jobName, ownerId, fencingToken) {
    const lockKey = `lock:job:${jobName}`;
    const now = Date.now();

    if (this.redisClient) {
      try {
        const raw = await this.redisClient.get(lockKey);
        if (!raw) {
          this.metrics.staleCommitsBlocked++;
          return false;
        }
        const data = JSON.parse(raw);
        if (data.ownerId === ownerId && data.fencingToken === fencingToken) {
          return true;
        }
        this.metrics.staleCommitsBlocked++;
        return false;
      } catch (_) {
        if (this.isClusteredOrDistributed()) {
          this.metrics.staleCommitsBlocked++;
          return false;
        }
      }
    } else if (this.isClusteredOrDistributed()) {
      this.metrics.staleCommitsBlocked++;
      return false;
    }

    const existing = this.localLocks.get(lockKey);
    if (existing && existing.owner === ownerId && existing.fencingToken === fencingToken && existing.expiresAt > now) {
      return true;
    }
    this.metrics.staleCommitsBlocked++;
    return false;
  }

  /**
   * Releases an exclusive lock safely using owner verification.
   */
  async releaseLock(jobName, ownerId = `inst-${process.pid}`) {
    const lockKey = `lock:job:${jobName}`;

    if (this.redisClient) {
      try {
        const lua = `
          local raw = redis.call("get", KEYS[1])
          if raw then
            local data = cjson.decode(raw)
            if data.ownerId == ARGV[1] then
              return redis.call("del", KEYS[1])
            end
          end
          return 0
        `;
        await this.redisClient.eval(lua, 1, lockKey, ownerId);
        this.metrics.locksReleased++;
        return true;
      } catch (err) {
        if (this.isClusteredOrDistributed()) {
          const lockErr = new Error(`DISTRIBUTED_LOCK_BACKEND_UNAVAILABLE: Redis lock release failed (${err.message}). Fail-closed in clustered mode.`);
          lockErr.code = 'DISTRIBUTED_LOCK_BACKEND_UNAVAILABLE';
          throw lockErr;
        }
      }
    } else if (this.isClusteredOrDistributed()) {
      const lockErr = new Error('DISTRIBUTED_LOCK_BACKEND_UNAVAILABLE: Redis client is not initialized in clustered mode. Fail-closed.');
      lockErr.code = 'DISTRIBUTED_LOCK_BACKEND_UNAVAILABLE';
      throw lockErr;
    }

    const existing = this.localLocks.get(lockKey);
    if (existing && existing.owner === ownerId) {
      this.localLocks.delete(lockKey);
      this.metrics.locksReleased++;
      return true;
    }
    return false;
  }

  /**
   * Wraps a background job with distributed lock acquisition, fencing protection, and release.
   */
  async runExclusive(jobName, taskFn, { ttlMs = 60000, ownerId = `inst-${process.pid}` } = {}) {
    const lockRes = await this.acquireLock(jobName, ownerId, ttlMs);

    if (!lockRes || !lockRes.acquired) {
      return { executed: false, reason: 'LOCKED_BY_ANOTHER_INSTANCE', fencingToken: null };
    }

    const { fencingToken } = lockRes;
    try {
      // Pass fencing token and lease verification hook to taskFn
      const context = {
        fencingToken,
        verifyAuthority: () => this.verifyFencingToken(jobName, ownerId, fencingToken),
      };
      const result = await taskFn(context);
      return { executed: true, result, fencingToken };
    } finally {
      await this.releaseLock(jobName, ownerId).catch(() => {});
    }
  }

  /**
   * Idempotency execution check for high-value write actions.
   */
  async executeIdempotent(idempotencyKey, executeFn, ttlMs = 86400000) {
    if (!idempotencyKey) {
      return executeFn();
    }

    const key = `idempotency:${idempotencyKey}`;
    const now = Date.now();

    if (this.redisClient) {
      try {
        const raw = await this.redisClient.get(key);
        if (raw) {
          this.metrics.idempotentExecutionsSkipped++;
          return JSON.parse(raw);
        }
      } catch (_) {}
    }

    if (this.idempotencyLedger.has(key)) {
      const entry = this.idempotencyLedger.get(key);
      if (now - entry.timestamp < ttlMs) {
        this.metrics.idempotentExecutionsSkipped++;
        return entry.result;
      }
    }

    const result = await executeFn();
    this.idempotencyLedger.set(key, { result, timestamp: now });

    if (this.redisClient) {
      try {
        await this.redisClient.set(key, JSON.stringify(result), 'EX', Math.ceil(ttlMs / 1000));
      } catch (_) {}
    }

    return result;
  }

  getMetrics() {
    return {
      ...this.metrics,
      activeLocalLocksCount: this.localLocks.size,
      idempotencyEntriesCount: this.idempotencyLedger.size,
      isDistributed: Boolean(this.redisClient),
    };
  }

  reset() {
    this.localLocks.clear();
    this.idempotencyLedger.clear();
    this.metrics = {
      locksAcquired: 0,
      locksDenied: 0,
      locksReleased: 0,
      locksExtended: 0,
      staleCommitsBlocked: 0,
      idempotentExecutionsSkipped: 0,
    };
  }
}

const defaultJobCoordinator = new JobCoordinationService();

module.exports = {
  JobCoordinationService,
  defaultJobCoordinator,
};
