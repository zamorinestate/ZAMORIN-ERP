'use strict';

/**
 * ============================================================================
 * ZAMORIN CAFÉ ERP — SCHEDULED JOB REGISTRY & IDEMPOTENCY SERVICE
 * ============================================================================
 * Maintains an auditable register of all background/cron operations, tracks execution
 * latency, detects stale jobs, and enforces strict idempotency against duplicate execution.
 */

const crypto = require('crypto');
const ApiError = require('../utils/ApiError');

const REGISTERED_JOBS = [
  {
    jobId: 'JOB-DOCUMENT-STAGING-CLEANUP',
    name: 'Abandoned Staging File Cleanup',
    schedule: 'Every 6 hours (0 */6 * * *)',
    owner: 'Infrastructure Operations',
    staleThresholdMinutes: 480,
    critical: false,
  },
  {
    jobId: 'JOB-DOCUMENT-INTEGRITY-RECONCILIATION',
    name: 'Document Storage & Metadata Reconciler',
    schedule: 'Daily at 02:00 IST (30 20 * * *)',
    owner: 'Security & Compliance',
    staleThresholdMinutes: 1560,
    critical: true,
  },
  {
    jobId: 'JOB-NOTIFICATION-OUTBOX-DISPATCH',
    name: 'Email & Notification Outbox Dispatcher',
    schedule: 'Every 1 minute (* * * * *)',
    owner: 'Mail Operations Lead',
    staleThresholdMinutes: 10,
    critical: true,
  },
  {
    jobId: 'JOB-ATTENDANCE-AUTO-CHECKOUT',
    name: 'Midnight Attendance Rollover & Auto-Checkout',
    schedule: 'Daily at 04:00 IST (30 22 * * *)',
    owner: 'Workforce Operations',
    staleThresholdMinutes: 1560,
    critical: true,
  },
  {
    jobId: 'JOB-BACKUP-PRECONDITION-AUDIT',
    name: 'Continuous Backup & PITR Audit',
    schedule: 'Every 12 hours (0 */12 * * *)',
    owner: 'Database Operations',
    staleThresholdMinutes: 840,
    critical: true,
  },
  {
    jobId: 'JOB-ASSET-MAINTENANCE-SCHEDULER',
    name: 'Preventive Asset Maintenance Evaluator & Alert Dispatcher',
    schedule: 'Daily at 05:00 IST (30 23 * * *)',
    owner: 'Equipment & Asset Reliability Lead',
    staleThresholdMinutes: 1560,
    critical: true,
  },
  {
    jobId: 'JOB-REPLENISHMENT-SWEEP',
    name: 'Scheduled Multi-Café Replenishment Safety Sweep',
    schedule: 'Daily at 06:00 IST (30 0 * * *)',
    owner: 'Café Operations & Procurement Lead',
    staleThresholdMinutes: 1440,
    critical: false,
  },
  {
    jobId: 'JOB-PROCUREMENT-DISPATCH-WORKER',
    name: 'Durable Purchase Order Vendor Dispatch Worker',
    schedule: 'Every 1 minute (* * * * *)',
    owner: 'Procurement & Logistics Operations',
    staleThresholdMinutes: 10,
    critical: true,
  },
];

class ScheduledJobRegistry {
  constructor() {
    this.jobs = new Map();
    this.processedIdempotencyKeys = new Set();
    this.executionHistory = [];
    this.maxHistory = 100;

    for (const spec of REGISTERED_JOBS) {
      this.jobs.set(spec.jobId, {
        ...spec,
        lastSuccess: null,
        lastFailure: null,
        lastDurationMs: null,
        consecutiveFailures: 0,
        totalRuns: 0,
        status: 'IDLE',
      });
    }
  }

  /**
   * Asserts idempotency: returns true if key was not previously executed,
   * otherwise throws an IDEMPOTENT_OPERATION_EXISTS error.
   */
  assertIdempotency(idempotencyKey) {
    if (!idempotencyKey || typeof idempotencyKey !== 'string') {
      return true;
    }

    if (this.processedIdempotencyKeys.has(idempotencyKey)) {
      throw new ApiError(
        409,
        'IDEMPOTENCY_CONFLICT',
        `Operation with idempotency key '${idempotencyKey}' was already processed. Duplicate execution blocked.`
      );
    }

    this.processedIdempotencyKeys.add(idempotencyKey);
    // Keep memory bounded to 5000 recent keys
    if (this.processedIdempotencyKeys.size > 5000) {
      const first = this.processedIdempotencyKeys.values().next().value;
      this.processedIdempotencyKeys.delete(first);
    }

    return true;
  }

  /**
   * Records execution outcome of a registered scheduled job.
   */
  recordJobExecution(jobId, { success = true, durationMs = 0, error = null } = {}) {
    const job = this.jobs.get(jobId);
    if (!job) return null;

    const now = new Date();
    job.totalRuns += 1;
    job.lastDurationMs = durationMs;

    if (success) {
      job.lastSuccess = now;
      job.consecutiveFailures = 0;
      job.status = 'HEALTHY';
    } else {
      job.lastFailure = now;
      job.consecutiveFailures += 1;
      job.status = 'FAILING';
    }

    const record = {
      timestamp: now.toISOString(),
      jobId,
      success,
      durationMs,
      error: error ? String(error.message || error) : null,
    };

    this.executionHistory.push(record);
    if (this.executionHistory.length > this.maxHistory) {
      this.executionHistory.shift();
    }

    return job;
  }

  /**
   * Detects stale or failing scheduled jobs.
   */
  auditJobHealth() {
    const now = Date.now();
    const staleJobs = [];
    const failingJobs = [];

    for (const [jobId, job] of this.jobs.entries()) {
      if (job.consecutiveFailures > 0) {
        failingJobs.push({ jobId, consecutiveFailures: job.consecutiveFailures, lastFailure: job.lastFailure });
      }

      if (job.lastSuccess) {
        const elapsedMinutes = (now - new Date(job.lastSuccess).getTime()) / 60000;
        if (elapsedMinutes > job.staleThresholdMinutes) {
          staleJobs.push({ jobId, elapsedMinutes: Math.floor(elapsedMinutes), threshold: job.staleThresholdMinutes });
        }
      }
    }

    return {
      timestamp: new Date().toISOString(),
      totalJobs: this.jobs.size,
      healthyJobs: this.jobs.size - failingJobs.length - staleJobs.length,
      staleJobs,
      failingJobs,
      isAllHealthy: staleJobs.length === 0 && failingJobs.length === 0,
    };
  }

  /**
   * Returns list of all registered jobs and their status.
   */
  listJobs() {
    return Array.from(this.jobs.values());
  }
}

const scheduledJobRegistry = new ScheduledJobRegistry();

module.exports = {
  REGISTERED_JOBS,
  ScheduledJobRegistry,
  scheduledJobRegistry,
};
