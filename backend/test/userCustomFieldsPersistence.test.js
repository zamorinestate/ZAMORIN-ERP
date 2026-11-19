'use strict';

/**
 * USER CUSTOM FIELD VALUES — MONGO PERSISTENCE TESTS  (Capability 26)
 *
 * Exercises `resolveCustomFieldValues` against real CustomFieldDefinition
 * records and verifies Map persistence on the User document.
 */

const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { describe, it, before, after } = require('node:test');

const { User } = require('../src/models/User');
const {
  CustomFieldDefinition,
} = require('../src/models/CustomFieldDefinition');
const {
  resolveCustomFieldValues,
} = require('../src/services/customFieldValueService');

const ORG = 'ORG_CF_PERSIST';

let mongoServer = null;

before(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());

  await CustomFieldDefinition.create([
    {
      organisationId: ORG,
      key: 'uniform_size',
      label: 'Uniform Size',
      fieldType: 'TEXT',
      createdByUserId: 'MU-0001',
    },
    {
      organisationId: ORG,
      key: 'locker_number',
      label: 'Locker Number',
      fieldType: 'NUMBER',
      createdByUserId: 'MU-0001',
    },
    {
      organisationId: ORG,
      key: 'blood_group',
      label: 'Blood Group',
      fieldType: 'SELECT',
      allowedValues: ['A+', 'B+', 'O+'],
      createdByUserId: 'MU-0001',
    },
    {
      organisationId: ORG,
      key: 'badge_id',
      label: 'Badge ID',
      fieldType: 'TEXT',
      isRequired: true,
      createdByUserId: 'MU-0001',
    },
    {
      organisationId: ORG,
      key: 'retired_field',
      label: 'Retired Field',
      fieldType: 'TEXT',
      status: 'ARCHIVED',
      createdByUserId: 'MU-0001',
    },
  ]);
});

after(async () => {
  await mongoose.disconnect();
  if (mongoServer) await mongoServer.stop();
});

async function makeUser(overrides = {}) {
  return User.create({
    userId: overrides.userId || 'ST-0001',
    organisationId: ORG,
    name: 'Custom Field Staff',
    email: `${(overrides.userId || 'ST-0001').toLowerCase()}@example.com`,
    role: 'STAFF',
    accountStatus: 'ACTIVE',
    assignedCafeIds: [],
    sessionVersion: 1,
    permissionsVersion: 1,
    passwordHash: 'hash',
    createdBy: 'SYSTEM',
    customFields: overrides.customFields || new Map(),
  });
}

describe('Custom field values — Mongo persistence', () => {
  it('persists normalised values, removes cleared keys and keeps untouched ones', async () => {
    const user = await makeUser({
      userId: 'ST-0001',
      customFields: new Map([
        ['uniform_size', 'M'],
        ['locker_number', 7],
      ]),
    });

    const { updates, removedKeys } = await resolveCustomFieldValues({
      organisationId: ORG,
      values: {
        uniform_size: null,
        locker_number: '12',
        blood_group: 'b+',
      },
    });

    for (const [key, value] of updates) user.customFields.set(key, value);
    for (const key of removedKeys) user.customFields.delete(key);

    await user.save();

    const reloaded = await User.findById(user._id);
    assert.equal(reloaded.customFields.has('uniform_size'), false);
    assert.equal(reloaded.customFields.get('locker_number'), 12);
    assert.equal(reloaded.customFields.get('blood_group'), 'B+');
  });

  it('rejects a key that only exists as an archived definition', async () => {
    await assert.rejects(
      resolveCustomFieldValues({
        organisationId: ORG,
        values: { retired_field: 'x' },
      }),
      (err) => err.code === 'CUSTOM_FIELD_NOT_DEFINED'
    );
  });

  it('rejects an undefined key', async () => {
    await assert.rejects(
      resolveCustomFieldValues({
        organisationId: ORG,
        values: { never_defined: 'x' },
      }),
      (err) => err.code === 'CUSTOM_FIELD_NOT_DEFINED'
    );
  });

  it('rejects clearing a required definition', async () => {
    await assert.rejects(
      resolveCustomFieldValues({
        organisationId: ORG,
        values: { badge_id: '' },
      }),
      (err) => err.code === 'CUSTOM_FIELD_VALUE_REQUIRED'
    );
  });

  it('scopes definitions to the organisation', async () => {
    await assert.rejects(
      resolveCustomFieldValues({
        organisationId: 'ORG_OTHER',
        values: { uniform_size: 'L' },
      }),
      (err) => err.code === 'CUSTOM_FIELD_NOT_DEFINED'
    );
  });
});
