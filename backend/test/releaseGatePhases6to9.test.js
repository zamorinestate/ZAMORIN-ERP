'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryReplSet } = require('mongodb-memory-server');

const { DistributedRateLimiter, SECURITY_CRITICAL_SCOPES } = require('../src/services/distributedRateLimiter');
const { JobCoordinationService } = require('../src/services/jobCoordinationService');
const { RedisAdapterService } = require('../src/services/redisAdapterService');
const { Bill } = require('../src/models/Bill');
const { CashTransaction } = require('../src/models/CashTransaction');
const { IdempotencyRecord } = require('../src/models/IdempotencyRecord');
const { InventoryLot } = require('../src/models/InventoryLot');
const { PosOrderService } = require('../src/services/posOrderService');

/**
 * High-fidelity in-process Shared Redis Mock
 * Implements atomic Redis semantics for string ops, sorted sets, expiry, and Lua scripts.
 */
class SharedRedisMock {
  constructor() {
    this.store = new Map();
    this.ttls = new Map();
    this.connected = true;
  }

  _checkConnected() {
    if (!this.connected) {
      const err = new Error('connect ECONNREFUSED 127.0.0.1:6379');
      err.code = 'ECONNREFUSED';
      throw err;
    }
  }

  _isExpired(key) {
    const exp = this.ttls.get(key);
    if (exp && Date.now() > exp) {
      this.store.delete(key);
      this.ttls.delete(key);
      return true;
    }
    return false;
  }

  async ping() {
    this._checkConnected();
    return 'PONG';
  }

  async get(key) {
    this._checkConnected();
    if (this._isExpired(key)) return null;
    return this.store.has(key) ? this.store.get(key) : null;
  }

  async set(key, val, ...args) {
    this._checkConnected();
    let ttlMs = null;
    let nx = false;

    for (let i = 0; i < args.length; i++) {
      const arg = String(args[i]).toUpperCase();
      if (arg === 'EX') {
        ttlMs = Number(args[i + 1]) * 1000;
        i++;
      } else if (arg === 'PX') {
        ttlMs = Number(args[i + 1]);
        i++;
      } else if (arg === 'NX') {
        nx = true;
      }
    }

    if (nx && this.store.has(key) && !this._isExpired(key)) {
      return null;
    }

    this.store.set(key, String(val));
    if (ttlMs) {
      this.ttls.set(key, Date.now() + ttlMs);
    } else {
      this.ttls.delete(key);
    }
    return 'OK';
  }

  async del(key) {
    this._checkConnected();
    const deleted = this.store.delete(key);
    this.ttls.delete(key);
    return deleted ? 1 : 0;
  }

  async incr(key) {
    this._checkConnected();
    const val = (Number(this.store.get(key)) || 0) + 1;
    this.store.set(key, String(val));
    return val;
  }

  async eval(script, numKeys, key, ...args) {
    this._checkConnected();
    // 1. Sliding window rate limiter Lua script simulation
    if (script.includes('SLIDING_WINDOW_LIMITER') || script.includes('ZREMRANGEBYSCORE')) {
      const now = Number(args[0]);
      const windowMs = Number(args[1]);
      const maxRequests = Number(args[2]);
      const clearBefore = now - windowMs;

      let list = this.store.get(key) ? JSON.parse(this.store.get(key)) : [];
      list = list.filter((item) => item.score > clearBefore);

      if (list.length < maxRequests) {
        list.push({ score: now, member: `${now}-${Math.random()}` });
        this.store.set(key, JSON.stringify(list));
        this.ttls.set(key, now + windowMs);
        return [1, maxRequests - list.length, Math.floor(windowMs / 1000)];
      } else {
        const oldest = list[0];
        const resetMs = oldest ? Math.max(0, Math.floor((oldest.score + windowMs - now) / 1000)) : 0;
        return [0, 0, resetMs];
      }
    }

    // 2. Safe lock release Lua script simulation
    if (script.includes('SAFE_LOCK_RELEASE') || script.includes('redis.call("del", KEYS[1])')) {
      const ownerId = args[0];
      const current = this.store.get(key);
      if (!current) return 0;
      let matches = false;
      try {
        const parsed = JSON.parse(current);
        matches = parsed.ownerId === ownerId;
      } catch (_) {
        matches = current === ownerId;
      }
      if (matches) {
        this.store.delete(key);
        this.ttls.delete(key);
        return 1;
      }
      return 0;
    }

    // 3. Safe lock extend Lua script simulation
    if (script.includes('SAFE_LOCK_EXTEND') || script.includes('pexpire')) {
      const ownerId = args[0];
      const additionalTtlMs = Number(args[1]);
      const current = this.store.get(key);
      if (!current) return 0;
      let matches = false;
      try {
        const parsed = JSON.parse(current);
        matches = parsed.ownerId === ownerId;
      } catch (_) {
        matches = current === ownerId;
      }
      if (matches) {
        this.ttls.set(key, Date.now() + additionalTtlMs);
        return 1;
      }
      return 0;
    }

    return 0;
  }
}

test('RELEASE GATE: Phases 6 to 9 Multi-Node, Failure Injection & Partition Resilience', async (t) => {
  let replSet;

  t.before(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await replSet.waitUntilRunning();
    await mongoose.connect(replSet.getUri());

    await Bill.createCollection();
    await CashTransaction.createCollection();
    await IdempotencyRecord.createCollection();
    await InventoryLot.createCollection();
    await Bill.syncIndexes();
    await IdempotencyRecord.syncIndexes();
  });

  t.after(async () => {
    await mongoose.disconnect();
    if (replSet) await replSet.stop();
  });

  // ══════════════════════════════════════════════════════════════════════════
  // PHASE 6: MULTI-NODE REDIS VERIFICATION
  // ══════════════════════════════════════════════════════════════════════════
  await t.test('Phase 6.1: Distributed Rate Limiting Across 3 Nodes (Zero Counter Leaks)', async () => {
    const sharedRedis = new SharedRedisMock();

    // 3 distinct application node instances connected to the shared Redis
    const nodeA = new DistributedRateLimiter({ redisClient: sharedRedis, isDistributed: true });
    const nodeB = new DistributedRateLimiter({ redisClient: sharedRedis, isDistributed: true });
    const nodeC = new DistributedRateLimiter({ redisClient: sharedRedis, isDistributed: true });

    const keyParams = { organisationId: 'ORG-ZAM', cafeId: 'CAFE-01', ip: '192.168.1.50', scope: 'AUTH' };
    const maxAttempts = 5;
    const windowMs = 60000;
    const lockoutMs = 60000;

    // Simulate 4 failed attempts distributed across different nodes:
    // Attempt 1 on Node A
    await nodeA.recordFailure(keyParams, { maxAttempts, windowMs, lockoutMs });
    // Attempt 2 on Node B
    await nodeB.recordFailure(keyParams, { maxAttempts, windowMs, lockoutMs });
    // Attempt 3 on Node C
    await nodeC.recordFailure(keyParams, { maxAttempts, windowMs, lockoutMs });
    // Attempt 4 on Node A
    await nodeA.recordFailure(keyParams, { maxAttempts, windowMs, lockoutMs });

    // Under local memory, each node would only see 1-2 failures.
    // Under distributed Redis, all 3 nodes must see 4 total failures!
    const checkA = await nodeA.isLocked(keyParams, { maxAttempts, windowMs, lockoutMs });
    const checkB = await nodeB.isLocked(keyParams, { maxAttempts, windowMs, lockoutMs });
    const checkC = await nodeC.isLocked(keyParams, { maxAttempts, windowMs, lockoutMs });

    assert.equal(checkA.failures, 4, 'Node A must see global failures = 4');
    assert.equal(checkB.failures, 4, 'Node B must see global failures = 4');
    assert.equal(checkC.failures, 4, 'Node C must see global failures = 4');
    assert.equal(checkA.locked, false, 'Not locked yet at 4 attempts');

    // Attempt 5 on Node B -> Must trigger global lock
    const res5 = await nodeB.recordFailure(keyParams, { maxAttempts, windowMs, lockoutMs });
    assert.equal(res5.locked, true, 'Attempt 5 must trigger lockout');

    // Node C must immediately observe the lockout despite not handling attempt 5!
    const checkCPost = await nodeC.isLocked(keyParams, { maxAttempts, windowMs, lockoutMs });
    assert.equal(checkCPost.locked, true, 'Node C must enforce lockout set by Node B');
    assert.equal(checkCPost.failures, 5);
  });

  await t.test('Phase 6.2: Distributed Job Mutex & Fencing Across 3 Node Processes', async () => {
    const sharedRedis = new SharedRedisMock();

    const nodeA = new JobCoordinationService({ redisClient: sharedRedis });
    const nodeB = new JobCoordinationService({ redisClient: sharedRedis });
    const nodeC = new JobCoordinationService({ redisClient: sharedRedis });

    const jobName = 'MONTHLY_PAYROLL_RUN';

    // Node A acquires lock
    const lockA = await nodeA.acquireLock(jobName, 'node-A-worker', 5000);
    assert.equal(lockA.acquired, true, 'Node A must successfully acquire lock');
    assert.ok(lockA.fencingToken > 0, 'Fencing token must be generated');

    // Node B attempts to acquire same job concurrently -> Must be DENIED
    const lockB = await nodeB.acquireLock(jobName, 'node-B-worker', 5000);
    assert.equal(lockB.acquired, false, 'Node B must be denied lock while Node A holds it');
    assert.equal(lockB.fencingToken, null);

    // Node C attempts to acquire same job concurrently -> Must be DENIED
    const lockC = await nodeC.acquireLock(jobName, 'node-C-worker', 5000);
    assert.equal(lockC.acquired, false, 'Node C must be denied lock while Node A holds it');

    // Verify Fencing Token: Node A is authoritative
    const authA = await nodeA.verifyFencingToken(jobName, 'node-A-worker', lockA.fencingToken);
    assert.equal(authA, true, 'Node A token must be valid');

    // Node B attempts to impersonate or commit with invalid token
    const authB = await nodeB.verifyFencingToken(jobName, 'node-B-worker', 99999);
    assert.equal(authB, false, 'Node B invalid token must be blocked');

    // Node B attempts to release Node A lock -> Must FAIL (Safe Lua release)
    await nodeB.releaseLock(jobName, 'node-B-worker');
    const lockStillHeld = await nodeA.verifyFencingToken(jobName, 'node-A-worker', lockA.fencingToken);
    assert.equal(lockStillHeld, true, 'Node A lock must NOT be deleted by Node B');

    // Node A cleanly releases lock
    await nodeA.releaseLock(jobName, 'node-A-worker');

    // Now Node C can acquire lock
    const lockC2 = await nodeC.acquireLock(jobName, 'node-C-worker', 5000);
    assert.equal(lockC2.acquired, true, 'Node C can acquire lock after Node A releases');
    assert.ok(lockC2.fencingToken > lockA.fencingToken, 'New fencing token must be greater than previous');
  });

  // ══════════════════════════════════════════════════════════════════════════
  // PHASE 7: DISTRIBUTED FAILURE & OUTAGE TESTING
  // ══════════════════════════════════════════════════════════════════════════
  await t.test('Phase 7.1: Redis Outage Behavior — Security Scopes FAIL CLOSED', async () => {
    const sharedRedis = new SharedRedisMock();
    const limiter = new DistributedRateLimiter({
      redisClient: sharedRedis,
      isDistributed: true,
      securityFailurePolicy: 'FAIL_CLOSED',
    });

    // Simulate Redis sudden connection failure (crash / network partition)
    sharedRedis.connected = false;

    // Security scope (LOGIN, AUTH, PIN) MUST FAIL CLOSED
    const securityKey = { organisationId: 'ORG-ZAM', cafeId: 'CAFE-01', scope: 'LOGIN' };
    const secResult = await limiter.isLocked(securityKey);

    assert.equal(secResult.locked, true, 'Security scopes MUST fail closed when Redis drops');
    assert.equal(secResult.reason, 'DISTRIBUTED_SECURITY_LIMITER_UNAVAILABLE');

    // Non-security general traffic degrades to local bounded map to prevent total cafe paralysis
    const generalKey = { organisationId: 'ORG-ZAM', cafeId: 'CAFE-01', scope: 'MENU_BROWSE' };
    const genResult = await limiter.isLocked(generalKey);
    assert.equal(genResult.locked, false, 'General read traffic degrades locally to maintain cafe uptime');
  });

  await t.test('Phase 7.2: Remediation Verification — JobCoordination Fails Closed on Redis Outage (No Split-Brain Local Lock)', async () => {
    const sharedRedis = new SharedRedisMock();
    const nodeA = new JobCoordinationService({ redisClient: sharedRedis });
    const nodeB = new JobCoordinationService({ redisClient: sharedRedis });

    // Simulate Redis crash
    sharedRedis.connected = false;

    // In remediated implementation, both Node A and Node B FAIL CLOSED and reject lock acquisition
    await assert.rejects(
      async () => nodeA.acquireLock('CRON_DAILY_AUDIT', 'node-A'),
      (err) => err.code === 'DISTRIBUTED_LOCK_BACKEND_UNAVAILABLE',
      'Node A must throw DISTRIBUTED_LOCK_BACKEND_UNAVAILABLE on Redis failure'
    );
    await assert.rejects(
      async () => nodeB.acquireLock('CRON_DAILY_AUDIT', 'node-B'),
      (err) => err.code === 'DISTRIBUTED_LOCK_BACKEND_UNAVAILABLE',
      'Node B must throw DISTRIBUTED_LOCK_BACKEND_UNAVAILABLE on Redis failure'
    );
  });

  // ══════════════════════════════════════════════════════════════════════════
  // PHASE 8: APPLICATION NODE FAILURE & PARTIAL WRITE SIMULATION
  // ══════════════════════════════════════════════════════════════════════════
  await t.test('Phase 8: Process Crash Mid-Transaction Aborts All Changes Without Leaks', async () => {
    const orgId = 'ORG-ZAM';
    const cafeId = 'CAFE-01';

    // Seed inventory lot
    await InventoryLot.create({
      organisationId: orgId,
      lotId: 'LOT-CRASH-TEST',
      itemId: 'ITM-MILK-CRASH',
      cafeId,
      status: 'AVAILABLE',
      initialQuantity: 100,
      quantityBase: 100,
      remainingQuantity: 100,
      expiryDate: '2026-12-31',
    });

    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        await InventoryLot.updateOne(
          { lotId: 'LOT-CRASH-TEST' },
          { $inc: { quantityBase: -10, remainingQuantity: -10 } },
          { session }
        );

        await Bill.create([{
          billId: 'BILL-20261005-0001',
          invoiceNumber: 'INV-CRASH-01',
          organisationId: orgId,
          cafeId,
          businessDate: '2026-10-05',
          cashierUserId: 'CASHIER-CRASH',
          subtotalPaisa: 50000,
          totalPaisa: 50000,
          paymentStatus: 'PAID',
          status: 'COMPLETED',
          lineItems: [{
            menuItemId: 'ITM-MILK-CRASH',
            itemNameSnapshot: 'Milk Shake',
            quantity: 1,
            unitPricePaisa: 50000,
            lineSubtotalPaisa: 50000,
            lineTotalPaisa: 50000,
          }],
        }], { session });

        // Simulate SIGKILL / OOM / Process unhandled abort right before commit
        throw new Error('SIMULATED_SIGKILL_PROCESS_ABORT');
      });
    } catch (err) {
      assert.equal(err.message, 'SIMULATED_SIGKILL_PROCESS_ABORT');
    } finally {
      await session.endSession();
    }

    // Verify ZERO partial writes survived the abort
    const bill = await Bill.findOne({ billId: 'BILL-20261005-0001' });
    assert.equal(bill, null, 'No bill must survive process abort');

    const lot = await InventoryLot.findOne({ lotId: 'LOT-CRASH-TEST' });
    assert.equal(lot.quantityBase, 100, 'Inventory quantityBase must remain exactly 100');
    assert.equal(lot.remainingQuantity, 100, 'Inventory remainingQuantity must remain exactly 100');
  });

  // ══════════════════════════════════════════════════════════════════════════
  // PHASE 9: NETWORK RESPONSE LOSS & SAFE IDEMPOTENT RETRY
  // ══════════════════════════════════════════════════════════════════════════
  await t.test('Phase 9: Network Drops HTTP Response After Commit — Retry Replays Without Duplication', async () => {
    const orgId = 'ORG-ZAM';
    const cafeId = 'CAFE-01';
    const saleAttemptId = 'ATTEMPT-NET-DROP-999';

    const auth = { organisationId: orgId, role: 'CASHIER', userId: 'CASHIER-01' };
    const payload = {
      cafeId,
      saleAttemptId,
      paymentMethod: 'CASH',
      isImmediateCompletion: true,
      lineItems: [
        { menuItemId: 'ITM-COFFEE-01', itemNameSnapshot: 'Coffee', quantity: 1, unitPricePaisa: 15000, itemTotalPaisa: 15000 },
      ],
    };

    // Client sends Request 1 -> Server commits transaction to database!
    const firstAttempt = await PosOrderService.processOrder(payload, auth, 'SAVE_AND_PRINT', {
      saleAttemptId,
      requireAtomicInventory: false,
    });
    assert.ok(firstAttempt && firstAttempt.bill, 'Initial transaction must commit successfully');
    const originalBillId = firstAttempt.bill.billId;

    // Simulate Network Partition: HTTP 200 response was dropped on the wire.
    // Client times out after 5 seconds and transparently RETRIES with identical payload and saleAttemptId:
    const secondAttempt = await PosOrderService.processOrder(payload, auth, 'SAVE_AND_PRINT', {
      saleAttemptId,
      requireAtomicInventory: false,
    });

    // Invariant: Second attempt must NOT create a duplicate bill, but return the existing committed bill
    assert.equal(secondAttempt.bill.billId, originalBillId, 'Retry must return the same committed bill');
    assert.equal(secondAttempt.isIdempotentReplay, true, 'Must indicate idempotency replayed');

    // Database verification: Exactly 1 bill in database
    const billCount = await Bill.countDocuments({ organisationId: orgId, saleAttemptId });
    assert.equal(billCount, 1, 'Database must contain strictly 1 bill');
  });
});
