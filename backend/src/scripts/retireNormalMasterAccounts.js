'use strict';

require('dotenv').config();
const mongoose = require('mongoose');

/**
 * Migration: Retire all Normal Master accounts across the database.
 * Enforces the strict Four-Persona Topology invariant:
 * If role === 'MASTER', isPrimaryMaster MUST === true.
 *
 * Normal Masters (role === 'MASTER' && isPrimaryMaster !== true) are permanently
 * disabled with reason 'ROLE_RETIRED_NORMAL_MASTER', versions bumped, and sessions revoked.
 */
async function retireNormalMasterAccounts(providedMongoose = mongoose, options = {}) {
  const db = providedMongoose.connection.db;
  if (!db) {
    throw new Error('Database connection must be open before running migration.');
  }

  const dryRun = Boolean(options.dryRun);
  const migrationRunId = options.migrationRunId || `MIG-NM-RET-${Date.now()}`;

  const usersCollection = db.collection('users');
  const sessionsCollection = db.collection('sessions');
  const auditCollection = db.collection('audit_events');

  const legacyNormalMasters = await usersCollection.find({
    role: 'MASTER',
    isPrimaryMaster: { $ne: true },
  }).toArray();

  const report = {
    migrationRunId,
    dryRun,
    totalFound: legacyNormalMasters.length,
    accountsDisabled: 0,
    alreadyDisabled: 0,
    sessionsRevoked: 0,
    accounts: [],
  };

  for (const user of legacyNormalMasters) {
    const wasAlreadyDisabled = user.accountStatus === 'DISABLED' || user.accountStatus === 'ARCHIVED';
    if (wasAlreadyDisabled) {
      report.alreadyDisabled += 1;
    } else {
      report.accountsDisabled += 1;
    }

    const nextSessionVersion = (user.sessionVersion || 1) + 1;
    const nextPermissionsVersion = (user.permissionsVersion || 1) + 1;

    const preChangeSnapshot = {
      accountStatus: user.accountStatus,
      statusReason: user.statusReason || null,
      sessionVersion: user.sessionVersion || 1,
      permissionsVersion: user.permissionsVersion || 1,
      role: user.role,
      isPrimaryMaster: Boolean(user.isPrimaryMaster),
    };

    let revokedCount = 0;

    if (!dryRun) {
      const updateFields = {
        accountStatus: 'DISABLED',
        statusReason: 'ROLE_RETIRED_NORMAL_MASTER',
        sessionVersion: nextSessionVersion,
        permissionsVersion: nextPermissionsVersion,
        updatedAt: new Date(),
      };

      if (!user.migrationMetadata?.retireNormalMaster) {
        updateFields['migrationMetadata.retireNormalMaster'] = {
          migrationRunId,
          preChangeSnapshot,
          migratedAt: new Date(),
        };
      }

      await usersCollection.updateOne(
        { _id: user._id, role: 'MASTER', isPrimaryMaster: { $ne: true } },
        { $set: updateFields }
      );

      // Invalidate / revoke all active sessions for this retired account
      const sessionRevokeResult = await sessionsCollection.updateMany(
        {
          organisationId: user.organisationId,
          userId: user.userId,
          status: 'ACTIVE',
        },
        {
          $set: {
            status: 'REVOKED',
            revokedAt: new Date(),
            revokedBy: `SYSTEM_MIGRATION:${migrationRunId}`,
            revocationReason: 'ROLE_RETIRED_NORMAL_MASTER',
          },
        }
      );

      revokedCount = sessionRevokeResult.modifiedCount || 0;

      // Log traceable audit event
      try {
        const dayStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
        const randSeq = Math.floor(1000 + Math.random() * 9000);
        await auditCollection.insertOne({
          auditEventId: `AE-${dayStr}-${randSeq}`,
          eventType: 'SECURITY_MIGRATION_NORMAL_MASTER_RETIRED',
          migrationRunId,
          userId: user.userId,
          organisationId: user.organisationId,
          preChangeSnapshot,
          postChangeStatus: 'DISABLED',
          statusReason: 'ROLE_RETIRED_NORMAL_MASTER',
          sessionsRevoked: revokedCount,
          timestamp: new Date(),
        });
      } catch (_) {}
    } else {
      // In dryRun, estimate active sessions that would be revoked
      revokedCount = await sessionsCollection.countDocuments({
        organisationId: user.organisationId,
        userId: user.userId,
        status: 'ACTIVE',
      });
    }

    report.sessionsRevoked += revokedCount;

    report.accounts.push({
      userId: user.userId,
      organisationId: user.organisationId,
      email: user.email,
      name: user.name,
      previousStatus: user.accountStatus,
      newStatus: 'DISABLED',
      statusReason: 'ROLE_RETIRED_NORMAL_MASTER',
      activeSessionsRevoked: revokedCount,
      dryRun,
    });
  }

  return report;
}

async function runCli() {
  const { connectDatabase } = require('../config/database');
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('MONGODB_URI not configured in environment.');
    process.exit(1);
  }

  try {
    console.log('Connecting to database...');
    await connectDatabase({ uri });
    console.log('Running Normal Master Decommission Migration...');
    const result = await retireNormalMasterAccounts(mongoose);
    console.log('Migration Completed Successfully:');
    console.log(JSON.stringify(result, null, 2));
  } catch (err) {
    console.error('Migration failed:', err.message);
  } finally {
    await mongoose.disconnect();
  }
}

if (require.main === module) {
  runCli();
}

module.exports = {
  retireNormalMasterAccounts,
};
