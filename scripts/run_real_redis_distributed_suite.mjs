// =============================================================================
// ZAMORIN CAFÉ ERP — MULTI-PROCESS REAL REDIS DISTRIBUTED SUITE
// scripts/run_real_redis_distributed_suite.mjs
//
// Demonstrates real TCP Redis distributed behavior across 3 independent Node OS
// processes with mutex contention, fencing tokens, process kills, outage recovery,
// and idempotency deduplication.
// =============================================================================

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fork } from 'node:child_process';
import assert from 'node:assert/strict';
import { TcpRedisServer } from './real_redis_tcp_server.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = 6390;
const HOST = '127.0.0.1';

console.log('======================================================================');
console.log(' ZAMORIN CAFÉ ERP — REAL REDIS MULTI-PROCESS DISTRIBUTED VERIFICATION');
console.log('======================================================================\n');

// 1. Start TCP Redis RESP Server
const tcpServer = new TcpRedisServer(PORT, HOST);
await tcpServer.start();
console.log(`\x1b[32m✔ TCP RESP Redis Server listening on ${HOST}:${PORT}\x1b[0m`);

let messageCounter = 0;

function spawnWorker(workerId, port = PORT) {
  return new Promise((resolveWorker, rejectWorker) => {
    const workerPath = path.resolve(__dirname, 'real_redis_worker_node.mjs');
    const child = fork(workerPath, [workerId, String(port)], {
      stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
      env: { ...process.env, CLUSTER_MODE: 'true', NODE_ENV: 'production' },
    });

    const pendingRequests = new Map();

    child.on('message', (msg) => {
      if (msg.type === 'READY') {
        resolveWorker(workerObj);
      } else if (msg.type === 'INIT_ERROR') {
        rejectWorker(new Error(msg.error));
      } else if (msg.id && pendingRequests.has(msg.id)) {
        const { resolve } = pendingRequests.get(msg.id);
        pendingRequests.delete(msg.id);
        resolve(msg);
      }
    });

    function sendCommand(action, payload = {}) {
      return new Promise((resolve, reject) => {
        const id = ++messageCounter;
        pendingRequests.set(id, { resolve, reject });
        child.send({ id, action, payload });
        setTimeout(() => {
          if (pendingRequests.has(id)) {
            pendingRequests.delete(id);
            reject(new Error(`Timeout waiting for response to ${action} from ${workerId}`));
          }
        }, 5000);
      });
    }

    const workerObj = {
      workerId,
      child,
      pid: child.pid,
      sendCommand,
      acquireLock: (jobName, ttlMs) => sendCommand('ACQUIRE_LOCK', { jobName, ttlMs }),
      verifyToken: (jobName, fencingToken) => sendCommand('VERIFY_TOKEN', { jobName, fencingToken }),
      extendLock: (jobName, additionalTtlMs) => sendCommand('EXTEND_LOCK', { jobName, additionalTtlMs }),
      releaseLock: (jobName) => sendCommand('RELEASE_LOCK', { jobName }),
      idempotentWrite: (idempotencyKey, transactionData) => sendCommand('IDEMPOTENT_WRITE', { idempotencyKey, transactionData }),
      disconnect: () => sendCommand('DISCONNECT'),
      kill: (signal = 'SIGKILL') => child.kill(signal),
    };
  });
}

// 2. Spawn 3 Independent OS Worker Processes
console.log('\nSpawning 3 independent Node OS worker processes...');
const [worker1, worker2, worker3] = await Promise.all([
  spawnWorker('worker-alpha'),
  spawnWorker('worker-beta'),
  spawnWorker('worker-gamma'),
]);

console.log(`  -> Worker 1 (Alpha): OS PID ${worker1.pid}`);
console.log(`  -> Worker 2 (Beta) : OS PID ${worker2.pid}`);
console.log(`  -> Worker 3 (Gamma): OS PID ${worker3.pid}`);

assert.notEqual(worker1.pid, worker2.pid, 'Worker 1 and 2 must have distinct OS PIDs');
assert.notEqual(worker2.pid, worker3.pid, 'Worker 2 and 3 must have distinct OS PIDs');

const scorecard = {
  mutexContentionPass: false,
  fencingTokenMonotonicPass: false,
  staleCommitBlockedPass: false,
  processCrashDeadlockPass: false,
  outageFailClosedPass: false,
  restartRecoveryPass: false,
  idempotentDedupPass: false,
};

try {
  // ─── SCENARIO 1: MUTEX CONTENTION ACROSS 3 INDEPENDENT OS PROCESSES ────────
  console.log('\n\x1b[36m[SCENARIO 1] Simultaneous Mutex Contention Across 3 Real OS Processes...\x1b[0m');
  const jobKey = 'NIGHTLY_PAYROLL_RUN';

  const [res1, res2, res3] = await Promise.all([
    worker1.acquireLock(jobKey, 60000),
    worker2.acquireLock(jobKey, 60000),
    worker3.acquireLock(jobKey, 60000),
  ]);

  const results = [res1, res2, res3];
  const acquired = results.filter((r) => r.acquired === true);
  const denied = results.filter((r) => r.acquired === false);

  console.log(`  -> Worker 1 (Alpha) result: acquired=${res1.acquired}, fencingToken=${res1.fencingToken}`);
  console.log(`  -> Worker 2 (Beta)  result: acquired=${res2.acquired}, fencingToken=${res2.fencingToken}`);
  console.log(`  -> Worker 3 (Gamma) result: acquired=${res3.acquired}, fencingToken=${res3.fencingToken}`);

  assert.equal(acquired.length, 1, 'Exactly one worker must acquire the distributed lock');
  assert.equal(denied.length, 2, 'Exactly two workers must be denied the distributed lock');
  console.log('\x1b[32m✔ Mutual Exclusion Verified: Exactly 1 winner, 2 denied across real OS processes.\x1b[0m');
  scorecard.mutexContentionPass = true;

  const winner = acquired[0];
  const winnerWorker = winner.workerId === 'worker-alpha' ? worker1 : winner.workerId === 'worker-beta' ? worker2 : worker3;
  const winnerToken = winner.fencingToken;

  // ─── SCENARIO 2: MONOTONIC FENCING TOKEN & STALE COMMIT PROTECTION ────────
  console.log('\n\x1b[36m[SCENARIO 2] Monotonic Fencing Tokens & Stale Commit Rejection...\x1b[0m');
  
  // Winner safely releases
  await winnerWorker.releaseLock(jobKey);
  console.log(`  -> Winner (${winner.workerId}) safely released ${jobKey}`);

  // Worker 2 acquires the released lock
  const resNext = await worker2.acquireLock(jobKey, 60000);
  assert.equal(resNext.acquired, true, 'Worker 2 must acquire the newly released lock');
  const token2 = resNext.fencingToken;
  console.log(`  -> Worker 2 (Beta) acquired lock with Token F2 = ${token2}`);
  console.log(`  -> Token F2 (${token2}) > Token F1 (${winnerToken}): ${token2 > winnerToken}`);

  assert.ok(token2 > winnerToken, 'Fencing token must be strictly monotonically increasing');
  scorecard.fencingTokenMonotonicPass = true;

  // Winner 1 attempts to verify its old, superseded token
  const verifyStale = await winnerWorker.verifyToken(jobKey, winnerToken);
  console.log(`  -> Winner 1 verification with superseded token F1: valid=${verifyStale.valid}`);
  assert.equal(verifyStale.valid, false, 'Stale fencing token must be rejected');

  const verifyAuthoritative = await worker2.verifyToken(jobKey, token2);
  console.log(`  -> Worker 2 verification with current token F2: valid=${verifyAuthoritative.valid}`);
  assert.equal(verifyAuthoritative.valid, true, 'Current fencing token must be accepted');

  console.log('\x1b[32m✔ Fencing Monotonicity & Stale Rejection Verified.\x1b[0m');
  scorecard.staleCommitBlockedPass = true;

  await worker2.releaseLock(jobKey);

  // ─── SCENARIO 3: ABRUPT PROCESS TERMINATION (SIGKILL / DIE WITHOUT RELEASE) ─
  console.log('\n\x1b[36m[SCENARIO 3] Abrupt Node Termination (SIGKILL) & Deadlock Prevention...\x1b[0m');
  const crashJob = 'HOURLY_INVENTORY_SYNC';
  const shortTtlMs = 800; // 800ms lease

  // Worker 1 acquires lock
  const crashAcquire = await worker1.acquireLock(crashJob, shortTtlMs);
  assert.equal(crashAcquire.acquired, true);
  console.log(`  -> Worker 1 (Alpha, PID ${worker1.pid}) acquired lock on ${crashJob} (TTL: ${shortTtlMs}ms)`);

  // Kill Worker 1 abruptly via OS SIGKILL
  console.log(`  -> Killing Worker 1 (PID ${worker1.pid}) abruptly via child.kill('SIGKILL')...`);
  worker1.kill('SIGKILL');

  // Immediately try to acquire from Worker 3 (should fail as lock is still held in Redis)
  const failAcquire = await worker3.acquireLock(crashJob, 10000);
  console.log(`  -> Worker 3 immediate acquisition before TTL expiry: acquired=${failAcquire.acquired} (Correctly held)`);
  assert.equal(failAcquire.acquired, false);

  // Wait for TTL expiry (800ms + 250ms buffer = 1050ms)
  console.log(`  -> Waiting 1050ms for lease TTL expiration...`);
  await new Promise((r) => setTimeout(r, 1050));

  // Worker 3 now acquires the expired lease
  const recoveryAcquire = await worker3.acquireLock(crashJob, 10000);
  console.log(`  -> Worker 3 acquisition post-TTL expiry: acquired=${recoveryAcquire.acquired}, fencingToken=${recoveryAcquire.fencingToken}`);
  assert.equal(recoveryAcquire.acquired, true, 'Worker 3 must acquire lock after crashed node lease expires');
  console.log('\x1b[32m✔ Abrupt Crash Resilience Verified: Zero deadlocks; lease automatically reclaimed.\x1b[0m');
  scorecard.processCrashDeadlockPass = true;

  await worker3.releaseLock(crashJob);

  // Spawn replacement worker for remaining tests
  const worker1R = await spawnWorker('worker-alpha-replacement');
  console.log(`  -> Spawned replacement Worker 1R (OS PID ${worker1R.pid})`);

  // ─── SCENARIO 4: REDIS OUTAGE / RESTART & FAIL-CLOSED INTEGRITY ───────────
  console.log('\n\x1b[36m[SCENARIO 4] Redis Network Outage & Fail-Closed Integrity...\x1b[0m');

  console.log('  -> Simulating Redis TCP socket outage (server.simulateOutage())...');
  tcpServer.simulateOutage();

  // Workers attempt lock during outage
  console.log('  -> Worker 3 attempting lock acquisition during outage...');
  const outageAttempt = await worker3.acquireLock('OUTAGE_TEST_JOB', 10000);
  console.log(`  -> Outage attempt response: success=${outageAttempt.success}, code=${outageAttempt.code || outageAttempt.error}`);
  assert.ok(
    outageAttempt.success === false || outageAttempt.code === 'DISTRIBUTED_LOCK_BACKEND_UNAVAILABLE',
    'Must fail closed during Redis outage'
  );
  console.log('\x1b[32m✔ Fail-Closed Enforced: Refused unsafe in-memory fallback in clustered mode.\x1b[0m');
  scorecard.outageFailClosedPass = true;

  // Restart Redis TCP Server
  console.log('  -> Restarting Redis TCP Server (tcpServer.simulateRecovery())...');
  await tcpServer.simulateRecovery();
  await new Promise((r) => setTimeout(r, 600));

  // Re-attempt after recovery with freshly connected worker nodes
  const [workerPost1, workerPost2, workerPost3] = await Promise.all([
    spawnWorker('worker-post-alpha'),
    spawnWorker('worker-post-beta'),
    spawnWorker('worker-post-gamma'),
  ]);

  const postRecovery = await workerPost1.acquireLock('OUTAGE_TEST_JOB', 10000);
  console.log(`  -> Post-recovery lock acquisition: acquired=${postRecovery.acquired}, token=${postRecovery.fencingToken}`);
  assert.equal(postRecovery.acquired, true, 'Must acquire lock safely after server recovery');
  console.log('\x1b[32m✔ Redis Outage Recovery Verified: New sessions connect and coordinate safely.\x1b[0m');
  scorecard.restartRecoveryPass = true;

  await workerPost1.releaseLock('OUTAGE_TEST_JOB');

  // ─── SCENARIO 5: CONCURRENT DEDUPLICATION & IDEMPOTENCY ───────────────────
  console.log('\n\x1b[36m[SCENARIO 5] Multi-Process Idempotent Deduplication Protection...\x1b[0m');
  const idempotencyKey = 'TX-IDEMPOTENT-SETTLEMENT-2026-10-07';
  const txData = { amountPaisa: 2500000, recipient: 'VENDOR-COFFEE-01' };

  console.log(`  -> Firing concurrent transactions from 3 independent OS workers with key ${idempotencyKey}...`);
  const [dedup1, dedup2, dedup3] = await Promise.all([
    workerPost1.idempotentWrite(idempotencyKey, txData),
    workerPost2.idempotentWrite(idempotencyKey, txData),
    workerPost3.idempotentWrite(idempotencyKey, txData),
  ]);

  const dedupResults = [dedup1, dedup2, dedup3];
  const freshExecutions = dedupResults.filter((r) => r.executedFresh === true);
  const cachedReplays = dedupResults.filter((r) => r.executedFresh === false);

  console.log(`  -> Worker Post-1: executedFresh=${dedup1.executedFresh}, committedBy=${dedup1.result?.committedBy}`);
  console.log(`  -> Worker Post-2: executedFresh=${dedup2.executedFresh}, committedBy=${dedup2.result?.committedBy}`);
  console.log(`  -> Worker Post-3: executedFresh=${dedup3.executedFresh}, committedBy=${dedup3.result?.committedBy}`);

  assert.equal(freshExecutions.length, 1, 'Exactly one transaction execution must be committed');
  assert.equal(cachedReplays.length, 2, 'Two duplicate requests must be replayed idempotently');
  assert.equal(dedup1.result.committedBy, dedup2.result.committedBy, 'Committed result must be identical across workers');
  assert.equal(dedup2.result.committedBy, dedup3.result.committedBy, 'Committed result must be identical across workers');

  console.log('\x1b[32m✔ High-Concurrency Deduplication Verified: 1 execution, 0 duplicates.\x1b[0m');
  scorecard.idempotentDedupPass = true;

  // Cleanup
  console.log('\nCleaning up worker processes and TCP server...');
  await Promise.all([
    workerPost1.disconnect().catch(() => {}),
    workerPost2.disconnect().catch(() => {}),
    workerPost3.disconnect().catch(() => {}),
    worker1R.disconnect().catch(() => {}),
    worker2.disconnect().catch(() => {}),
    worker3.disconnect().catch(() => {}),
  ]);

} finally {
  await tcpServer.stop();
  console.log('TCP Redis Server stopped.\n');
}

console.log('======================================================================');
console.log('      REAL REDIS MULTI-PROCESS VERIFICATION SCORECARD');
console.log('======================================================================');
console.log(`MUTEX_CONTENTION_3_PROCESSES:      ${scorecard.mutexContentionPass ? 'PASS' : 'FAIL'}`);
console.log(`MONOTONIC_FENCING_TOKENS:          ${scorecard.fencingTokenMonotonicPass ? 'PASS' : 'FAIL'}`);
console.log(`STALE_COMMITS_BLOCKED:             ${scorecard.staleCommitBlockedPass ? 'PASS' : 'FAIL'}`);
console.log(`PROCESS_CRASH_DEADLOCK_PREVENTION: ${scorecard.processCrashDeadlockPass ? 'PASS' : 'FAIL'}`);
console.log(`OUTAGE_FAIL_CLOSED_INTEGRITY:      ${scorecard.outageFailClosedPass ? 'PASS' : 'FAIL'}`);
console.log(`OUTAGE_RECOVERY_RECONNECT:         ${scorecard.restartRecoveryPass ? 'PASS' : 'FAIL'}`);
console.log(`IDEMPOTENT_DEDUPLICATION:          ${scorecard.idempotentDedupPass ? 'PASS' : 'FAIL'}`);
console.log('======================================================================\n');

const allPassed = Object.values(scorecard).every(Boolean);
if (!allPassed) {
  console.error('FAIL: One or more real Redis multi-process tests failed.');
  process.exit(1);
} else {
  console.log('\x1b[32mALL REAL REDIS MULTI-PROCESS DISTRIBUTED TESTS PASSED (7/7).\x1b[0m\n');
  process.exit(0);
}
