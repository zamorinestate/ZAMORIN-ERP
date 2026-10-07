'use strict';

require('dotenv').config();
const mongoose = require('mongoose');

const { connectDatabase } = require('../config/database');

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('MONGODB_URI not found in environment');
    process.exit(1);
  }

  console.log('Connecting to database via connectDatabase...');
  await connectDatabase({ uri });
  console.log('Connected successfully.');

  const db = mongoose.connection.db;
  const usersCollection = db.collection('users');
  const sessionsCollection = db.collection('sessions');

  const normalMasters = await usersCollection.find({
    role: 'MASTER',
    isPrimaryMaster: { $ne: true },
  }).toArray();

  console.log(`Found ${normalMasters.length} normal master records.`);
  for (const u of normalMasters) {
    console.log({
      userId: u.userId,
      organisationId: u.organisationId,
      email: u.email,
      name: u.name,
      role: u.role,
      isPrimaryMaster: u.isPrimaryMaster,
      accountStatus: u.accountStatus,
      statusReason: u.statusReason,
      lastLoginAt: u.lastLoginAt,
      assignedCafeIds: u.assignedCafeIds,
      createdAt: u.createdAt,
    });

    const activeSessions = await sessionsCollection.countDocuments({
      userId: u.userId,
      organisationId: u.organisationId,
      status: 'ACTIVE',
    });
    console.log(`Active sessions for ${u.userId}: ${activeSessions}`);
  }

  const primaryMasters = await usersCollection.find({
    role: 'MASTER',
    isPrimaryMaster: true,
  }).toArray();
  console.log(`Found ${primaryMasters.length} Primary Master records:`);
  for (const pm of primaryMasters) {
    console.log({
      userId: pm.userId,
      organisationId: pm.organisationId,
      email: pm.email,
      name: pm.name,
      role: pm.role,
      isPrimaryMaster: pm.isPrimaryMaster,
      accountStatus: pm.accountStatus,
    });
  }

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error('Error during inventory:', err);
  process.exit(1);
});
