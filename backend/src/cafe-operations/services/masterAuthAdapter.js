'use strict';
/**
 * INTEGRATION SEAM — Master strong authentication.
 *
 * The master-access spec (Section 15) is explicit: Cafe Operations must call
 * the SAME canonical Master authentication system Zamorin already uses for
 * normal Master login — password verification, MFA, passkey where present —
 * never a second, weaker, parallel implementation built just for this
 * shared device. That real system isn't available in this environment, so
 * this file does NOT attempt to reimplement it. It defines the three calls
 * Cafe Operations actually needs and ships a REFERENCE implementation only,
 * clearly marked, so the module is runnable and testable end-to-end today.
 *
 * To integrate for real: call setMasterAuthAdapter() once at startup with an
 * object implementing identify/completeMfa/reauth against your real
 * /auth/login + MFA endpoints. Nothing in routes/ or
 * services/cafeOpsSessionService.js needs to change.
 *
 * Contract:
 *   identify({ identifier, password }) →
 *     { ok:false } |
 *     { ok:true, requiresMfa:true, mfaChallengeId } |
 *     { ok:true, requiresMfa:false, employeeId, organisationId, role }
 *       // role must be 'MASTER_PRIMARY' | 'MASTER_NORMAL'
 *   completeMfa({ mfaChallengeId, code }) →
 *     { ok:false } | { ok:true, employeeId, organisationId, role }
 *   reauth({ employeeId, password, mfaCode }) →   // for unlock / step-up on an ALREADY-KNOWN master
 *     { ok:false } | { ok:true, organisationId, role }
 */

let activeAdapter = null;
function setMasterAuthAdapter(adapter) { activeAdapter = adapter; }

let authService = null;
let mfaService = null;
try {
  authService = require('../../services/authService');
  mfaService = require('../../services/mfaService');
} catch (_) {}

const productionAdapter = {
  async identify({ identifier, password }) {
    if (!authService) return referenceAdapter.identify({ identifier, password });
    try {
      const authResult = await authService.authenticatePassword({ email: identifier, password });
      if (!authResult || !authResult.user) return { ok: false };
      const user = authResult.user;
      if (user.role !== 'MASTER' || !user.isPrimaryMaster) return { ok: false };
      const role = 'MASTER_PRIMARY';
      const employeeId = String(user.userId || user._id);
      const organisationId = String(user.organisationId || '');

      if (authResult.requiresMfa) {
        const mfaChallenge = mfaService ? mfaService.generateMfaToken({ user, purpose: 'mfa_challenge' }) : { token: 'mfa_' + Date.now() };
        return {
          ok: true,
          requiresMfa: true,
          mfaChallengeId: typeof mfaChallenge === 'string' ? mfaChallenge : mfaChallenge.token,
          employeeId,
          organisationId,
          role,
        };
      }
      return {
        ok: true,
        requiresMfa: false,
        employeeId,
        organisationId,
        role,
      };
    } catch (_) {
      return { ok: false };
    }
  },

  async completeMfa({ mfaChallengeId, code }) {
    if (!mfaService) return referenceAdapter.completeMfa({ mfaChallengeId, code });
    try {
      const decoded = mfaService.verifyMfaToken(mfaChallengeId, 'mfa_challenge');
      if (!decoded || !decoded.userId) return { ok: false };
      const User = require('mongoose').model('User');
      const user = await User.findOne({ userId: decoded.userId });
      if (!user || user.role !== 'MASTER' || !user.isPrimaryMaster) return { ok: false };
      const isValid = await mfaService.verifyTotpCode(user, code);
      if (!isValid) return { ok: false };
      return {
        ok: true,
        employeeId: String(user.userId || user._id),
        organisationId: String(user.organisationId || ''),
        role: 'MASTER_PRIMARY',
      };
    } catch (_) {
      return { ok: false };
    }
  },

  async reauth({ employeeId, password, mfaCode }) {
    if (!authService) return referenceAdapter.reauth({ employeeId, password, mfaCode });
    try {
      const User = require('mongoose').model('User');
      const user = await User.findOne({ $or: [{ userId: employeeId }, { _id: employeeId }] });
      if (!user || user.role !== 'MASTER' || !user.isPrimaryMaster) return { ok: false };
      const authResult = await authService.authenticatePassword({ email: user.email, password });
      if (!authResult || !authResult.user) return { ok: false };
      if (authResult.requiresMfa && mfaCode) {
        const isValid = await mfaService.verifyTotpCode(user, mfaCode);
        if (!isValid) return { ok: false };
      }
      return {
        ok: true,
        organisationId: String(user.organisationId || ''),
        role: 'MASTER_PRIMARY',
      };
    } catch (_) {
      return { ok: false };
    }
  },
};

function getMasterAuthAdapter() {
  if (activeAdapter) return activeAdapter;
  if (process.env.USE_PROD_MASTER_ADAPTER) {
    return productionAdapter;
  }
  return referenceAdapter;
}

// ---------------------------------------------------------------------
// REFERENCE / DEMO IMPLEMENTATION — NOT FOR PRODUCTION.
// Static "MFA code" instead of real TOTP; plaintext seeding for demo
// accounts only. Exists purely so this module can be exercised end-to-end
// without your real auth system attached.
// ---------------------------------------------------------------------
let bcrypt;
try {
  bcrypt = require('bcrypt');
} catch {
  bcrypt = require('bcryptjs');
}
const demoMastersByIdentifier = new Map();
const demoMastersByEmployeeId = new Map();
const pendingMfa = new Map();

const MASTER_SALT_ROUNDS = process.env.NODE_ENV === 'production' ? 10 : 4;

function _seedDemoMaster({ identifier, employeeId, organisationId, role, password, mfaCode }) {
  const rec = { identifier, employeeId, organisationId, role, passwordHash: bcrypt.hashSync(password, MASTER_SALT_ROUNDS), mfaCode: mfaCode || null };
  demoMastersByIdentifier.set(identifier, rec);
  demoMastersByEmployeeId.set(String(employeeId), rec);
}
function _resetDemoMasters() { demoMastersByIdentifier.clear(); demoMastersByEmployeeId.clear(); pendingMfa.clear(); }

const DUMMY_HASH = bcrypt.hashSync('__no_such_master_account__', MASTER_SALT_ROUNDS);

const referenceAdapter = {
  async identify({ identifier, password }) {
    const rec = demoMastersByIdentifier.get(identifier);
    if (!rec) { await bcrypt.compare(String(password || ''), DUMMY_HASH); return { ok: false }; }
    const ok = await bcrypt.compare(String(password || ''), rec.passwordHash);
    if (!ok) return { ok: false };
    if (rec.mfaCode) {
      const mfaChallengeId = 'mfa_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
      pendingMfa.set(mfaChallengeId, { identifier, expiresAt: Date.now() + 5 * 60000 });
      return { ok: true, requiresMfa: true, mfaChallengeId };
    }
    return { ok: true, requiresMfa: false, employeeId: rec.employeeId, organisationId: rec.organisationId, role: rec.role };
  },
  async completeMfa({ mfaChallengeId, code }) {
    const pending = pendingMfa.get(mfaChallengeId);
    if (!pending || Date.now() > pending.expiresAt) return { ok: false };
    const rec = demoMastersByIdentifier.get(pending.identifier);
    if (!rec || rec.mfaCode !== code) return { ok: false };
    pendingMfa.delete(mfaChallengeId);
    return { ok: true, employeeId: rec.employeeId, organisationId: rec.organisationId, role: rec.role };
  },
  async reauth({ employeeId, password, mfaCode }) {
    const rec = demoMastersByEmployeeId.get(String(employeeId));
    if (!rec) { await bcrypt.compare(String(password || ''), DUMMY_HASH); return { ok: false }; }
    const ok = await bcrypt.compare(String(password || ''), rec.passwordHash);
    if (!ok) return { ok: false };
    if (rec.mfaCode && rec.mfaCode !== mfaCode) return { ok: false };
    return { ok: true, organisationId: rec.organisationId, role: rec.role };
  },
};

module.exports = {
  setMasterAuthAdapter,
  getMasterAuthAdapter,
  productionAdapter,
  referenceAdapter,
  _seedDemoMaster,
  _resetDemoMasters,
};
