'use strict';
const express = require('express');
const { getRepositories } = require('../repositories');
const sessionService = require('../services/cafeOpsSessionService');
const auditService = require('../services/auditService');
const { requireGovernanceRole } = require('../middleware/requireGovernanceRole');
const { ok, fail } = require('../utils/responses');
const { SECURITY_EVENT_TYPE, SESSION_END_REASON } = require('../utils/constants');

const router = express.Router();
const GOVERNANCE_ROLES = ['MASTER_PRIMARY', 'OWNER', 'CAFE_ADMIN'];

router.get('/', requireGovernanceRole(...GOVERNANCE_ROLES), async (req, res, next) => {
  try {
    const repos = getRepositories();
    const list = await repos.sessions.listByCafe(req.query.cafeId, { status: req.query.status });
    return ok(res, { sessions: list.map(publicSession) });
  } catch (err) { next(err); }
});

router.get('/current', requireGovernanceRole(...GOVERNANCE_ROLES), async (req, res, next) => {
  try {
    const repos = getRepositories();
    const devices = await repos.devices.findByCafe(req.query.cafeId);
    const current = [];
    for (const d of devices) {
      const s = await repos.sessions.findActiveByDevice(d.id);
      if (s) current.push({ device: d.displayName, deviceId: d.id, ...publicSession(s) });
    }
    return ok(res, { current });
  } catch (err) { next(err); }
});

router.post('/:sessionId/end', requireGovernanceRole(...GOVERNANCE_ROLES), async (req, res, next) => {
  try {
    const repos = getRepositories();
    const session = await repos.sessions.findById(req.params.sessionId);
    if (!session) return fail(res, 404, 'SESSION_NOT_FOUND', 'Session not found.');
    await sessionService.endSession({ sessionId: session.id, reason: SESSION_END_REASON.REMOTE_REVOKED });
    await auditService.record({
      eventType: SECURITY_EVENT_TYPE.SESSION_ENDED_REMOTELY, deviceId: session.deviceId, employeeId: session.actorEmployeeId,
      sessionId: session.id, sessionType: session.sessionType, metadata: { endedByEmployeeId: req.cafeOpsCaller.employeeId },
    });
    return ok(res, {});
  } catch (err) { next(err); }
});

function publicSession(s) {
  return {
    id: s.id, sessionCode: s.sessionCode, sessionType: s.sessionType, actorRole: s.actorRole,
    employeeId: s.actorEmployeeId, cafeId: s.effectiveCafeId, deviceId: s.deviceId,
    status: s.status, startedAt: s.startedAt, endedAt: s.endedAt || null, endReason: s.endReason || null,
    lastActivityAt: s.lastActivityAt, authMethod: s.authMethod, authenticationStrength: s.authenticationStrength,
  };
}

module.exports = router;
