'use strict';

/**
 * ZAMORIN CAFÉ ERP — PREFLIGHT MIGRATION AUDIT (DEF-P1-01)
 * verifyAndMigrateCorrelationIndex.js
 *
 * Inspects existing database records for duplicate non-null correlationId values
 * before building the unique sparse compound index `org_cafe_correlation_unique`.
 * Does NOT rewrite or delete production records. Halts safely if duplicates exist.
 */

const mongoose = require('mongoose');
const { Bill } = require('../models/Bill');

async function verifyAndMigrateCorrelationIndex({ db = null } = {}) {
  const activeDb = db || mongoose.connection.db;
  if (!activeDb) {
    throw new Error('Database connection must be established before running preflight migration.');
  }

  const billsColl = activeDb.collection('bills');

  // Aggregation pipeline to detect duplicate non-null correlationId per organisationId + cafeId
  const duplicates = await billsColl
    .aggregate([
      {
        $match: {
          correlationId: { $ne: null, $exists: true, $nin: ['', null] },
        },
      },
      {
        $group: {
          _id: {
            organisationId: '$organisationId',
            cafeId: '$cafeId',
            correlationId: '$correlationId',
          },
          count: { $sum: 1 },
          billIds: { $push: '$billId' },
        },
      },
      {
        $match: {
          count: { $gt: 1 },
        },
      },
    ])
    .toArray();

  if (duplicates.length > 0) {
    const errorDetails = duplicates.map((d) => ({
      organisationId: d._id.organisationId,
      cafeId: d._id.cafeId,
      correlationId: d._id.correlationId,
      duplicateCount: d.count,
      billIds: d.billIds,
    }));

    const migrationErr = new Error(
      `PREFLIGHT_INDEX_ABORTED: Found ${duplicates.length} duplicate correlationId entries in bills collection. ` +
      `Manual deduplication required before applying unique constraint.`
    );
    migrationErr.code = 'DUPLICATE_CORRELATION_ID_DETECTED';
    migrationErr.details = errorDetails;
    console.error('[Preflight Migration Failed]', JSON.stringify(errorDetails, null, 2));
    throw migrationErr;
  }

  console.log('[Preflight Migration] No duplicate correlationId values detected. Building org_cafe_correlation_unique index...');

  // Safe to ensure index
  await billsColl.createIndex(
    { organisationId: 1, cafeId: 1, correlationId: 1 },
    {
      name: 'org_cafe_correlation_unique',
      unique: true,
      sparse: true,
      background: true,
    }
  );

  console.log('[Preflight Migration] Successfully created unique sparse index org_cafe_correlation_unique.');
  return { success: true, duplicatesFound: 0 };
}

module.exports = {
  verifyAndMigrateCorrelationIndex,
};
