'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const mongoose = require('mongoose');

class ServerReadinessService {
  /**
   * Sanitizes sensitive credentials, passwords, tokens, and connection strings.
   * NEVER returns raw secrets in diagnostic payloads.
   */
  static redactSensitive(value) {
    if (!value || typeof value !== 'string') return '';
    return value
      .replace(/\/\/([^:]+):([^@]+)@/g, '//$1:***@')
      .replace(/(password|secret|token|key)=([^&;]+)/gi, '$1=***');
  }

  /**
   * Evaluates Node.js runtime and host environment.
   * Supported: Node.js >=22.12.0 <25.0.0, Windows (win32) / Linux.
   */
  static assessRuntime() {
    const version = process.version; // e.g. v24.13.0
    const [major, minor] = version.replace(/^v/, '').split('.').map(Number);
    const isSupportedNode = (major > 22 || (major === 22 && minor >= 12)) && major < 25;

    const mem = process.memoryUsage();

    return {
      nodeVersion: version,
      isSupportedVersion: isSupportedNode,
      minimumRequiredVersion: '>=22.12.0 <25.0.0',
      platform: process.platform, // e.g. win32
      arch: process.arch,
      processUptimeSeconds: Math.floor(process.uptime()),
      memory: {
        heapUsedMb: Math.round(mem.heapUsed / (1024 * 1024)),
        heapTotalMb: Math.round(mem.heapTotal / (1024 * 1024)),
        rssMb: Math.round(mem.rss / (1024 * 1024)),
      },
      status: isSupportedNode ? 'HEALTHY' : 'WARNING',
      remediation: isSupportedNode
        ? null
        : 'Update Node.js runtime to supported release (>=22.12.0 and <25.0.0).',
    };
  }

  /**
   * Evaluates MongoDB connectivity, readyState, and index initialization.
   */
  static async assessDatabase() {
    const isConnected = mongoose.connection && mongoose.connection.readyState === 1;
    let pingLatencyMs = null;
    let collectionsCount = 0;
    let error = null;

    if (isConnected) {
      try {
        const start = Date.now();
        await mongoose.connection.db.admin().ping();
        pingLatencyMs = Date.now() - start;
        const colls = await mongoose.connection.db.listCollections().toArray();
        collectionsCount = colls.length;
      } catch (err) {
        error = err.message;
      }
    }

    const status = isConnected && !error ? 'HEALTHY' : 'CRITICAL';

    return {
      readyState: mongoose.connection ? mongoose.connection.readyState : 0,
      connected: isConnected,
      pingLatencyMs,
      collectionsCount,
      databaseName: mongoose.connection?.name || 'unknown',
      status,
      error: error ? 'DB_PING_FAILED' : null,
      remediation:
        status === 'HEALTHY'
          ? null
          : 'Ensure MongoDB daemon is running and MONGODB_URI connection string is accessible.',
    };
  }

  /**
   * Evaluates persistent storage directory access and disk writability.
   */
  static assessStorage(storagePath = null) {
    const targetPath = storagePath || process.env.STORAGE_LOCAL_DIR || path.resolve(__dirname, '..', '..', 'storage');
    let isWritable = false;
    let error = null;

    try {
      if (!fs.existsSync(targetPath)) {
        fs.mkdirSync(targetPath, { recursive: true });
      }
      const testFile = path.join(targetPath, `.readiness_probe_${Date.now()}.tmp`);
      fs.writeFileSync(testFile, 'Zamorin Readiness Probe');
      fs.unlinkSync(testFile);
      isWritable = true;
    } catch (err) {
      error = err.message;
      isWritable = false;
    }

    const status = isWritable ? 'HEALTHY' : 'CRITICAL';

    return {
      storagePath: this.redactSensitive(targetPath),
      exists: fs.existsSync(targetPath),
      writable: isWritable,
      status,
      error: error ? 'STORAGE_NOT_WRITABLE' : null,
      remediation: isWritable
        ? null
        : 'Grant write permissions to ERP storage directory or configure valid STORAGE_LOCAL_DIR.',
    };
  }

  /**
   * Evaluates local ESC/POS hardware printer bridge daemon (port 9199).
   */
  static async probeHardwareBridge(port = 9199, timeoutMs = 800) {
    return new Promise((resolve) => {
      const req = http.get(
        {
          host: '127.0.0.1',
          port,
          path: '/health',
          timeout: timeoutMs,
        },
        (res) => {
          let body = '';
          res.on('data', (c) => (body += c));
          res.on('end', () => {
            try {
              const data = JSON.parse(body);
              resolve({
                status: 'ONLINE',
                port,
                service: data.service || 'Zamorin Local Printer Bridge',
                detectedPrinters: data.detectedPrinters || [],
                remediation: null,
              });
            } catch {
              resolve({
                status: 'DEGRADED',
                port,
                remediation: 'Local printer bridge responded with non-JSON output.',
              });
            }
          });
        }
      );

      req.on('timeout', () => {
        req.destroy();
        resolve({
          status: 'OFFLINE',
          port,
          remediation: 'Local printer bridge daemon is offline. Run: node scripts/zamorin_local_printer_bridge.mjs',
        });
      });

      req.on('error', () => {
        resolve({
          status: 'OFFLINE',
          port,
          remediation: 'Local printer bridge daemon is offline. Run: node scripts/zamorin_local_printer_bridge.mjs',
        });
      });
    });
  }

  /**
   * Evaluates distributed coordination (Redis vs In-Memory).
   */
  static assessDistributedCoordination() {
    const adapter = process.env.DISTRIBUTED_ADAPTER || 'in_memory';
    const isRedis = adapter.toLowerCase() === 'redis';

    return {
      adapter,
      status: isRedis ? 'DEGRADED' : 'IN_MEMORY_HEALTHY',
      isDistributed: isRedis,
      remediation: isRedis
        ? 'Redis adapter configured; ensure Redis server is reachable on REDIS_URL.'
        : 'Running in standalone in-memory coordination mode. Multi-instance scaling requires Redis.',
    };
  }

  /**
   * Comprehensive own-server readiness report with dependency scoring.
   */
  static async getFullReadinessReport() {
    const runtime = this.assessRuntime();
    const database = await this.assessDatabase();
    const storage = this.assessStorage();
    const hardwareBridge = await this.probeHardwareBridge();
    const distributed = this.assessDistributedCoordination();

    // Critical dependencies for taking financial POS traffic: Database + Storage
    const isReadyForTraffic = database.connected && storage.writable;

    const checks = [
      { name: 'Node Runtime', status: runtime.status, details: runtime.nodeVersion },
      { name: 'Database Connectivity', status: database.status, details: `Latency: ${database.pingLatencyMs}ms` },
      { name: 'Writable Storage', status: storage.status, details: storage.writable ? 'Writable' : 'Locked' },
      { name: 'Hardware Bridge', status: hardwareBridge.status, details: `Port: ${hardwareBridge.port}` },
      { name: 'Coordination Engine', status: distributed.status, details: distributed.adapter },
    ];

    const overallStatus = isReadyForTraffic
      ? hardwareBridge.status === 'ONLINE'
        ? 'FULLY_OPERATIONAL'
        : 'READY_NO_LOCAL_PRINTER'
      : 'DEGRADED_UNAVAILABLE';

    return {
      timestamp: new Date().toISOString(),
      readyForBusiness: isReadyForTraffic,
      overallStatus,
      checks,
      dependencies: {
        runtime,
        database,
        storage,
        hardwareBridge,
        distributed,
      },
      remediations: [
        runtime.remediation,
        database.remediation,
        storage.remediation,
        hardwareBridge.remediation,
        distributed.remediation,
      ].filter(Boolean),
    };
  }
}

module.exports = {
  ServerReadinessService,
};
