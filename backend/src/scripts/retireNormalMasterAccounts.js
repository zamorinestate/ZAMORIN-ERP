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
async function retireNormalMasterAccounts(providedMongoose = mongoose) {
  const db = providedMongoose.connection.db;
  if (!db) {
    throw new Error('Database connection must be open before running migration.');
  }

  const usersCollection = db.collection('users');
  const sessionsCollection = db.collection('sessions');

  const legacyNormalMasters = await usersCollection.find({
    role: 'MASTER',
    isPrimaryMaster: { $ne: true },
  }).toArray();

  const report = {
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

    // Update user record to DISABLED with reason ROLE_RETIRED_NORMAL_MASTER
    await usersCollection.updateOne(
      { _id: user._id },
      {
        $set: {
          accountStatus: 'DISABLED',
          statusReason: 'ROLE_RETIRED_NORMAL_MASTER',
          sessionVersion: nextSessionVersion,
          permissionsVersion: nextPermissionsVersion,
          updatedAt: new Date(),
        },
      }
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
          revokedBy: 'SYSTEM_MIGRATION_ROLE_TOPOLOGY',
          revocationReason: 'ROLE_RETIRED_NORMAL_MASTER',
        },
      }
    );

    const revokedCount = sessionRevokeResult.modifiedCount || 0;
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
