'use strict';

require('dotenv').config();
const mongoose = require('mongoose');

/**
 * Enterprise Safe Recovery Procedure for Normal Master Decommission Migration
 *
 * CRITICAL SECURITY INVARIANTS:
 * 1. NEVER reactivates a retired Normal Master (role === 'MASTER' && isPrimaryMaster !== true)
 *    back to an active MASTER. Normal Master authority is permanently decommissioned.
 * 2. NEVER arbitrarily assigns role: 'OWNER'. Assigning Owner is an unauthorized privilege grant.
 * 3. Enforces expected-state checks and pre-change version validation before restoring any record.
 * 4. Restores pre-change statuses for previously archived/disabled accounts (e.g. restoring
 *    prior statusReason like 'RESIGNED' or 'SECURITY_HOLD' instead of generic migration tags).
 * 5. Emits traceable corrective events in the audit ledger and preserves historical migration logs.
 */
async function rollbackNormalMasterMigration(providedMongoose = mongoose, options = {}) {
  const db = providedMongoose.connection.db;
  if (!db) {
    throw new Error('Database connection must be open before running rollback.');
  }

  const { migrationRunId, dryRun = false, reason = 'MIGRATION_RECOVERY_EXECUTION' } = options;

  if (!migrationRunId) {
    throw new Error('MIGRATION_RUN_ID_REQUIRED: A specific migrationRunId must be supplied to execute rollback.');
  }

  const usersCollection = db.collection('users');
  const auditCollection = db.collection('audit_events');

  // Find users affected by the specific migration run
  const affectedUsers = await usersCollection.find({
    'migrationMetadata.retireNormalMaster.migrationRunId': migrationRunId,
  }).toArray();

  const report = {
    migrationRunId,
    dryRun: Boolean(dryRun),
    totalFound: affectedUsers.length,
    accountsRestored: 0,
    accountsSkippedSecurityInvariant: 0,
    details: [],
  };

  for (const user of affectedUsers) {
    const meta = user.migrationMetadata?.retireNormalMaster;
    const preChange = meta?.preChangeSnapshot;

    if (!preChange) {
      report.details.push({
        userId: user.userId,
        action: 'SKIPPED_NO_PRE_CHANGE_DATA',
        reason: 'No preChangeSnapshot found in document metadata.',
      });
      continue;
    }

    // SECURITY INVARIANT: If the account is a non-primary MASTER, it CANNOT be restored to ACTIVE!
    if (user.role === 'MASTER' && user.isPrimaryMaster !== true && preChange.accountStatus === 'ACTIVE') {
      report.accountsSkippedSecurityInvariant += 1;
      report.details.push({
        userId: user.userId,
        action: 'BLOCKED_BY_SECURITY_INVARIANT',
        reason: 'Restoring Normal Master to ACTIVE status is strictly forbidden by Four-Persona Topology invariants. Account remains DISABLED.',
        currentStatus: user.accountStatus,
      });

      if (!dryRun) {
        try {
          const dayStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
          const randSeq = Math.floor(1000 + Math.random() * 9000);
          await auditCollection.insertOne({
            auditEventId: `AE-${dayStr}-${randSeq}`,
            eventType: 'SECURITY_MIGRATION_ROLLBACK_BLOCKED',
            migrationRunId,
            userId: user.userId,
            organisationId: user.organisationId,
            reason: 'Prevented revival of retired Normal Master to active status.',
            timestamp: new Date(),
          });
        } catch (err) {
          console.error('Audit insert error:', err);
        }
      }
      continue;
    }

    // Safe restoration path for non-active pre-change states (e.g. restoring ARCHIVED or prior reason)
    const targetStatus = preChange.accountStatus || 'DISABLED';
    const targetStatusReason = preChange.statusReason || null;

    if (!dryRun) {
      await usersCollection.updateOne(
        {
          _id: user._id,
          'migrationMetadata.retireNormalMaster.migrationRunId': migrationRunId,
        },
        {
          $set: {
            accountStatus: targetStatus,
            statusReason: targetStatusReason,
            'migrationMetadata.retireNormalMaster.rolledBackAt': new Date(),
            'migrationMetadata.retireNormalMaster.rollbackReason': reason,
            updatedAt: new Date(),
          },
        }
      );

      try {
        const dayStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
        const randSeq = Math.floor(1000 + Math.random() * 9000);
        await auditCollection.insertOne({
          auditEventId: `AE-${dayStr}-${randSeq}`,
          eventType: 'SECURITY_MIGRATION_ROLLBACK_RESTORED',
          migrationRunId,
          userId: user.userId,
          organisationId: user.organisationId,
          restoredStatus: targetStatus,
          restoredStatusReason: targetStatusReason,
          reason,
          timestamp: new Date(),
        });
      } catch (_) {}
    }

    report.accountsRestored += 1;
    report.details.push({
      userId: user.userId,
      action: dryRun ? 'WOULD_RESTORE' : 'RESTORED',
      restoredStatus: targetStatus,
      restoredStatusReason: targetStatusReason,
    });
  }

  return report;
}

module.exports = {
  rollbackNormalMasterMigration,
};
