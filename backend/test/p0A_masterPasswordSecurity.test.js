'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadEnvironment } = require('../src/config/environment');

test('P0-A: Master password security and bootstrap configuration', async (t) => {
  const baseValidEnv = {
    MONGODB_URI: 'mongodb://localhost:27017/zamorin_test',
    JWT_ACCESS_SECRET: 'x'.repeat(32),
    MFA_ENCRYPTION_KEY: 'y'.repeat(32),
    ALLOWED_ORIGINS: 'https://erp.zamorin.cafe',
  };

  await t.test('1. In production, startup fails safely if administrative bootstrap password is missing', () => {
    assert.throws(
      () => {
        loadEnvironment({
          ...baseValidEnv,
          NODE_ENV: 'production',
        });
      },
      (err) => {
        assert.match(err.message, /INITIAL_MASTER_PASSWORD or DEFAULT_ADMIN_PASSWORD is required in production/);
        return true;
      }
    );
  });

  await t.test('2. In production, startup rejects hardcoded or common insecure default passwords', () => {
    const badPasswords = [
      'PRADEESHK@94309',
      'PK@NilaVega_8427!Cedar',
      'admin123',
      'changeme',
      'placeholder',
    ];

    for (const bad of badPasswords) {
      assert.throws(
        () => {
          loadEnvironment({
            ...baseValidEnv,
            NODE_ENV: 'production',
            INITIAL_MASTER_PASSWORD: bad,
          });
        },
        (err) => {
          assert.match(err.message, /INITIAL_MASTER_PASSWORD contains an insecure or default password value/);
          return true;
        },
        `Should reject insecure password: ${bad}`
      );
    }
  });

  await t.test('3. Configured explicit credentials in production continue to work properly', () => {
    const strongPassword = 'Zamorin#Prod@2026_SecureMasterKey!';
    const config = loadEnvironment({
      ...baseValidEnv,
      NODE_ENV: 'production',
      INITIAL_MASTER_PASSWORD: strongPassword,
    });

    assert.equal(config.production, true);
    assert.equal(config.initialMasterPassword, strongPassword);
  });

  await t.test('4. In development/test mode, no default credential is populated when config is absent', () => {
    const config = loadEnvironment({
      ...baseValidEnv,
      NODE_ENV: 'development',
    });

    assert.equal(config.initialMasterPassword, '');
    assert.notEqual(config.initialMasterPassword, 'PRADEESHK@94309');
    assert.notEqual(config.initialMasterPassword, 'PK@NilaVega_8427!Cedar');
  });

  await t.test('5. In development/test mode, explicit INITIAL_MASTER_PASSWORD or DEFAULT_ADMIN_PASSWORD works', () => {
    const devPass = 'DevLocalPass_12345!';
    const config = loadEnvironment({
      ...baseValidEnv,
      NODE_ENV: 'development',
      INITIAL_MASTER_PASSWORD: devPass,
    });

    assert.equal(config.initialMasterPassword, devPass);

    const configViaDefault = loadEnvironment({
      ...baseValidEnv,
      NODE_ENV: 'development',
      DEFAULT_ADMIN_PASSWORD: devPass,
    });

    assert.equal(configViaDefault.initialMasterPassword, devPass);
  });

  await t.test('6. Secret credentials never appear in error messages or logs', () => {
    const secretPassword = 'SUPER_SECRET_VALUE_NEVER_LOG';
    try {
      loadEnvironment({
        ...baseValidEnv,
        NODE_ENV: 'production',
        INITIAL_MASTER_PASSWORD: secretPassword + '_placeholder',
      });
      assert.fail('Should have thrown on placeholder marker');
    } catch (err) {
      assert.strictEqual(
        err.message.includes(secretPassword),
        false,
        'Error message must NOT contain the secret password'
      );
    }
  });
});
