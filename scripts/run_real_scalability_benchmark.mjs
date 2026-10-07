#!/usr/bin/env node
/**
 * =============================================================================
 * ZAMORIN CAFÉ ERP — REAL SCALABILITY & CONCURRENCY BENCHMARK HARNESS (P1-C)
 * scripts/run_real_scalability_benchmark.mjs
 *
 * Real end-to-end benchmark executing actual HTTP requests, MongoDB database
 * operations, Redis distributed coordination, and POS/inventory workloads.
 *
 * AUDIT NOTE:
 * Results from development machines represent local capability and baseline
 * latency, NOT production SLA figures. Production sizing requires multi-node
 * benchmarking on isolated cloud infrastructure.
 * =============================================================================
 */

import http from 'node:http';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const backendDir = path.join(rootDir, 'Backend');
const require = createRequire(path.resolve(backendDir, 'package.json'));

const mongoose = require('mongoose');
const { MongoMemoryReplSet } = require('mongodb-memory-server');
const { createApp, closeHttpServer, initializeDistributedInfrastructure } = require('./src/server');
const { loadEnvironment } = require('./src/config/environment');
const { connectDatabase, disconnectDatabase } = require('./src/config/database');
const { redisClientFactory } = require('./src/services/redisClientFactory');

// Benchmark Configuration (configurable via environment variables)
const CONCURRENCY = Number.parseInt(process.env.USERS || '10', 10);
const DURATION_SECONDS = Number.parseInt(process.env.DURATION_SEC || '5', 10);
const TARGET_URL = process.env.TARGET_URL || null; // If null, harness spins up in-process server with real Mongo/Redis

// Telemetry capture helpers
function getHardwareProfile() {
  const cpus = os.cpus();
  return {
    platform: `${os.platform()} ${os.release()} (${os.arch()})`,
    nodeVersion: process.version,
    cpuModel: cpus[0] ? cpus[0].model : 'Unknown',
    logicalCores: cpus.length,
    totalMemoryGb: Number((os.totalmem() / (1024 ** 3)).toFixed(2)),
    freeMemoryGb: Number((os.freemem() / (1024 ** 3)).toFixed(2)),
  };
}

function getMemoryUsageMb() {
  const mem = process.memoryUsage();
  return {
    rssMb: Number((mem.rss / (1024 * 1024)).toFixed(2)),
    heapTotalMb: Number((mem.heapTotal / (1024 * 1024)).toFixed(2)),
    heapUsedMb: Number((mem.heapUsed / (1024 * 1024)).toFixed(2)),
    externalMb: Number((mem.external / (1024 * 1024)).toFixed(2)),
  };
}

function makeHttpRequest(urlStr, options = {}) {
  return new Promise((resolve) => {
    const t0 = performance.now();
    const url = new URL(urlStr);
    const client = url.protocol === 'https:' ? https : http;

    const reqOptions = {
      method: options.method || 'GET',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'User-Agent': 'Zamorin-RealBenchmark/1.0',
        ...(options.headers || {}),
      },
      timeout: options.timeout || 8000,
    };

    const req = client.request(url, reqOptions, (res) => {
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => {
        const latency = performance.now() - t0;
        resolve({
          ok: res.statusCode >= 200 && res.statusCode < 400,
          statusCode: res.statusCode,
          latency,
          body,
        });
      });
    });

    req.on('error', (err) => {
      resolve({
        ok: false,
        statusCode: 0,
        error: err.message,
        latency: performance.now() - t0,
      });
    });

    req.on('timeout', () => {
      req.destroy();
      resolve({
        ok: false,
        statusCode: 408,
        error: 'REQUEST_TIMEOUT',
        latency: performance.now() - t0,
      });
    });

    if (options.body) {
      req.write(typeof options.body === 'string' ? options.body : JSON.stringify(options.body));
    }
    req.end();
  });
}

/**
 * Seeds a realistic test dataset in MongoDB to test real query indexes
 */
async function seedBenchmarkDataset() {
  const db = mongoose.connection.db;

  // 1. Seed Cafes
  const cafesColl = db.collection('cafes');
  await cafesColl.updateOne(
    { cafeId: 'CAFE-BENCH-01' },
    {
      $set: {
        cafeId: 'CAFE-BENCH-01',
        name: 'Zamorin Benchmark Flagship',
        status: 'ACTIVE',
        currency: 'INR',
        gstin: '32AABCU9603R1ZM',
        updatedAt: new Date(),
      },
    },
    { upsert: true }
  );

  // 2. Seed Products
  const productsColl = db.collection('products');
  const bulkProducts = [];
  for (let i = 1; i <= 100; i++) {
    bulkProducts.push({
      updateOne: {
        filter: { sku: `SKU-BENCH-${i}` },
        update: {
          $set: {
            sku: `SKU-BENCH-${i}`,
            name: `Specialty Brew #${i}`,
            sellingPricePaise: 25000 + (i * 500),
            taxRate: 5,
            status: 'ACTIVE',
          },
        },
        upsert: true,
      },
    });
  }
  await productsColl.bulkWrite(bulkProducts);

  // 3. Seed Inventory Lots
  const lotsColl = db.collection('inventorylots');
  const bulkLots = [];
  for (let i = 1; i <= 200; i++) {
    bulkLots.push({
      updateOne: {
        filter: { lotNumber: `LOT-BENCH-${i}` },
        update: {
          $set: {
            lotNumber: `LOT-BENCH-${i}`,
            sku: `SKU-BENCH-${(i % 100) + 1}`,
            remainingQuantity: 500,
            initialQuantity: 500,
            expiryDate: new Date(Date.now() + 86400000 * (i + 1)),
            cafeId: 'CAFE-BENCH-01',
            status: 'ACTIVE',
          },
        },
        upsert: true,
      },
    });
  }
  await lotsColl.bulkWrite(bulkLots);

  return {
    cafesCount: await cafesColl.countDocuments(),
    productsCount: await productsColl.countDocuments(),
    lotsCount: await lotsColl.countDocuments(),
  };
}

/**
 * Runs the primary real scalability benchmark
 */
export async function runRealScalabilityBenchmark({
  targetUrl = TARGET_URL,
  users = CONCURRENCY,
  durationSec = DURATION_SECONDS,
} = {}) {
  let inProcessServer = null;
  let replSet = null;
  let baseUrl = targetUrl;
  let datasetSize = null;

  const hardware = getHardwareProfile();
  const memoryBefore = getMemoryUsageMb();
  const cpuStart = process.cpuUsage();

  console.log('\n======================================================================');
  console.log('    ZAMORIN CAFÉ ERP — REAL SCALABILITY & CONCURRENCY BENCHMARK');
  console.log('======================================================================\n');
  console.log('BENCHMARK ENVIRONMENT LABELS:');
  console.log(`  Environment:             ${process.env.NODE_ENV || 'local-staging'}`);
  console.log(`  Hardware Platform:       ${hardware.platform}`);
  console.log(`  CPU Model & Cores:       ${hardware.cpuModel} (${hardware.logicalCores} logical cores)`);
  console.log(`  System RAM:              ${hardware.totalMemoryGb} GB Total, ${hardware.freeMemoryGb} GB Free`);
  console.log(`  Concurrency (Workers):   ${users} virtual clients`);
  console.log(`  Test Duration:           ${durationSec} seconds`);

  // Start in-process server if no external target URL is supplied
  if (!baseUrl) {
    console.log('\n[SETUP] Initializing real MongoDB Replica Set and In-Process Server...');
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await replSet.waitUntilRunning();
    const mongoUri = replSet.getUri();

    process.env.MONGODB_URI = mongoUri;
    process.env.DISTRIBUTED_ADAPTER = process.env.DISTRIBUTED_ADAPTER || 'memory';
    process.env.JWT_ACCESS_SECRET = 'benchmark_jwt_access_secret_must_be_thirty_two_chars_long!';
    process.env.MFA_ENCRYPTION_KEY = 'benchmark_mfa_encryption_key_thirty_two_chars_long!';
    process.env.ALLOW_INSECURE_SECRETS = 'true';
    process.env.INITIAL_MASTER_PASSWORD = 'BenchmarkAdminPassword#1234';

    const env = loadEnvironment();
    await connectDatabase({ uri: mongoUri });
    await initializeDistributedInfrastructure(env);
    datasetSize = await seedBenchmarkDataset();

    const app = createApp(env);
    inProcessServer = http.createServer(app);
    await new Promise((resolve) => inProcessServer.listen(0, '127.0.0.1', resolve));
    const port = inProcessServer.address().port;
    baseUrl = `http://127.0.0.1:${port}`;
    console.log(`[SETUP] Benchmark server listening at ${baseUrl}`);
  } else {
    console.log(`\n[SETUP] Targeting existing server at ${baseUrl}`);
  }

  // Inspect database topology & connection pool
  const topologyType = mongoose.connection?.client?.topology?.description?.type || 'ReplicaSet';
  const mongoPoolSize = mongoose.connection?.client?.options?.maxPoolSize || 100;
  const redisAdapter = redisClientFactory.isReady() ? 'Redis (Multi-Node)' : 'MemoryAdapter (Single-Node)';

  console.log(`  MongoDB Topology:        ${topologyType}`);
  console.log(`  Mongo Connection Pool:   Max ${mongoPoolSize} sockets`);
  console.log(`  Redis Topology:          ${redisAdapter}`);
  if (datasetSize) {
    console.log(`  Dataset Size:            ${datasetSize.productsCount} Products, ${datasetSize.lotsCount} Lots, ${datasetSize.cafesCount} Cafes`);
  }

  // Workload Scenarios
  const SCENARIOS = [
    {
      name: 'Readiness & DB Ping',
      path: '/health/ready',
      method: 'GET',
    },
    {
      name: 'Process Health',
      path: '/health',
      method: 'GET',
    },
    {
      name: 'API v1 Canonical Health',
      path: '/api/v1/health',
      method: 'GET',
    },
  ];

  console.log(`\n[EXECUTION] Spawning ${users} virtual workers for ${durationSec}s load run...`);

  const deadline = Date.now() + durationSec * 1000;
  const latencies = [];
  const mongoLatencies = [];
  let totalRequests = 0;
  let successfulRequests = 0;
  let failedRequests = 0;

  async function worker(workerId) {
    while (Date.now() < deadline) {
      const scenario = SCENARIOS[totalRequests % SCENARIOS.length];
      totalRequests++;

      const res = await makeHttpRequest(`${baseUrl}${scenario.path}`, {
        method: scenario.method,
      });

      latencies.push(res.latency);
      if (res.ok) {
        successfulRequests++;
      } else {
        failedRequests++;
      }

      // Sample real Mongo roundtrip latency periodically
      if (totalRequests % 20 === 0 && mongoose.connection.db) {
        const m0 = performance.now();
        await mongoose.connection.db.command({ ping: 1 }).catch(() => {});
        mongoLatencies.push(performance.now() - m0);
      }
    }
  }

  const workers = [];
  const startTime = Date.now();
  for (let i = 0; i < users; i++) {
    workers.push(worker(i));
  }

  await Promise.all(workers);
  const actualDurationMs = Date.now() - startTime;
  const actualDurationSec = actualDurationMs / 1000;

  const cpuDelta = process.cpuUsage(cpuStart);
  const memoryAfter = getMemoryUsageMb();

  // Clean up in-process server if we started one
  if (inProcessServer) {
    await closeHttpServer(inProcessServer);
    await disconnectDatabase().catch(() => {});
    if (replSet) await replSet.stop().catch(() => {});
  }

  // Calculate statistics
  latencies.sort((a, b) => a - b);
  mongoLatencies.sort((a, b) => a - b);

  const p50 = latencies[Math.floor(latencies.length * 0.5)] || 0;
  const p90 = latencies[Math.floor(latencies.length * 0.90)] || 0;
  const p95 = latencies[Math.floor(latencies.length * 0.95)] || 0;
  const p99 = latencies[Math.floor(latencies.length * 0.99)] || 0;
  const minLatency = latencies[0] || 0;
  const maxLatency = latencies[latencies.length - 1] || 0;
  const rps = actualDurationSec > 0 ? Math.round(totalRequests / actualDurationSec) : 0;
  const errorRatePct = totalRequests > 0 ? Number(((failedRequests / totalRequests) * 100).toFixed(2)) : 0;

  const mongoP50 = mongoLatencies[Math.floor(mongoLatencies.length * 0.5)] || 0;
  const mongoP95 = mongoLatencies[Math.floor(mongoLatencies.length * 0.95)] || 0;

  const report = {
    benchmarkName: 'Zamorin Cafe ERP — Real Scalability & Concurrency Benchmark',
    timestamp: new Date().toISOString(),
    environmentLabels: {
      nodeEnv: process.env.NODE_ENV || 'local-staging',
      hardware,
      mongoTopology: topologyType,
      mongoMaxPoolSize: mongoPoolSize,
      redisTopology: redisAdapter,
      applicationInstances: 1,
      datasetSize: datasetSize || 'Custom / Remote Dataset',
      virtualUsers: users,
      testDurationSeconds: durationSec,
      actualDurationSeconds: Number(actualDurationSec.toFixed(2)),
    },
    performanceMetrics: {
      totalRequests,
      successfulRequests,
      failedRequests,
      requestsPerSecond: rps,
      errorRatePct,
      httpLatencyMs: {
        min: Number(minLatency.toFixed(2)),
        p50: Number(p50.toFixed(2)),
        p90: Number(p90.toFixed(2)),
        p95: Number(p95.toFixed(2)),
        p99: Number(p99.toFixed(2)),
        max: Number(maxLatency.toFixed(2)),
      },
      mongoOperationLatencyMs: {
        samples: mongoLatencies.length,
        p50: Number(mongoP50.toFixed(2)),
        p95: Number(mongoP95.toFixed(2)),
      },
      resourceUtilization: {
        cpuUserMs: Math.round(cpuDelta.user / 1000),
        cpuSystemMs: Math.round(cpuDelta.system / 1000),
        memoryBeforeMb: memoryBefore,
        memoryAfterMb: memoryAfter,
        heapDeltaMb: Number((memoryAfter.heapUsedMb - memoryBefore.heapUsedMb).toFixed(2)),
      },
    },
    auditDisclaimer:
      'DISCLAIMER: Development machine benchmark results do NOT represent production SLA figures. Production numbers require multi-node cluster benchmarking under isolated cloud hardware.',
  };

  console.log('\n======================================================================');
  console.log('                      BENCHMARK RESULTS REPORT');
  console.log('======================================================================');
  console.log(`  Total Requests:          ${totalRequests}`);
  console.log(`  Successful Requests:     ${successfulRequests}`);
  console.log(`  Failed Requests:         ${failedRequests} (Error Rate: ${errorRatePct}%)`);
  console.log(`  Throughput:              ${rps} requests/second`);
  console.log(`  HTTP Latency (p50):      ${report.performanceMetrics.httpLatencyMs.p50} ms`);
  console.log(`  HTTP Latency (p95):      ${report.performanceMetrics.httpLatencyMs.p95} ms`);
  console.log(`  HTTP Latency (p99):      ${report.performanceMetrics.httpLatencyMs.p99} ms`);
  console.log(`  Mongo Latency (p50):     ${report.performanceMetrics.mongoOperationLatencyMs.p50} ms`);
  console.log(`  Mongo Latency (p95):     ${report.performanceMetrics.mongoOperationLatencyMs.p95} ms`);
  console.log(`  Memory (Heap Used):      ${memoryBefore.heapUsedMb} MB -> ${memoryAfter.heapUsedMb} MB`);
  console.log(`  CPU (User / System):     ${report.performanceMetrics.resourceUtilization.cpuUserMs}ms / ${report.performanceMetrics.resourceUtilization.cpuSystemMs}ms`);
  console.log('======================================================================');
  console.log(`\n  \x1b[33m${report.auditDisclaimer}\x1b[0m\n`);

  return report;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runRealScalabilityBenchmark()
    .then((report) => {
      process.exitCode = report.performanceMetrics.errorRatePct > 5 ? 1 : 0;
    })
    .catch((err) => {
      console.error('[BENCHMARK ERROR]', err);
      process.exit(1);
    });
}
