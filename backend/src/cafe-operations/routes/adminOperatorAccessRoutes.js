'use strict';
const express = require('express');
const { getRepositories } = require('../repositories');
const pinService = require('../services/operatorPinService');
const { requireGovernanceRole } = require('../middleware/requireGovernanceRole');
const { ok, fail } = require('../utils/responses');

const router = express.Router();
const GOVERNANCE_ROLES = ['MASTER_PRIMARY', 'OWNER', 'CAFE_ADMIN'];

router.get('/', requireGovernanceRole(...GOVERNANCE_ROLES), async (req, res, next) => {
  try {
    const repos = getRepositories();
    return ok(res, { access: await repos.operatorAccess.listByCafe(req.query.cafeId) });
  } catch (err) { next(err); }
});

router.post('/', requireGovernanceRole(...GOVERNANCE_ROLES), async (req, res, next) => {
  try {
    const repos = getRepositories();
    const { employeeId, cafeId, validFrom, validUntil, assignmentReason } = req.body || {};
    if (!employeeId || !cafeId) return fail(res, 400, 'INVALID_INPUT', 'employeeId and cafeId are required.');
    const existing = await repos.operatorAccess.findActiveForEmployeeAndCafe(employeeId, cafeId);
    if (existing) return fail(res, 409, 'ACCESS_ALREADY_EXISTS', 'This employee already has active Operator Access for this cafe.');
    const record = await repos.operatorAccess.create({
      employeeId, cafeId, organisationId: req.cafeOpsCaller.organisationId, status: 'ACTIVE',
      validFrom: validFrom || null, validUntil: validUntil || null,
      assignedByEmployeeId: req.cafeOpsCaller.employeeId, assignmentReason,
    });
    return ok(res, { access: record });
  } catch (err) { next(err); }
});

router.post('/:accessId/revoke', requireGovernanceRole(...GOVERNANCE_ROLES), async (req, res, next) => {
  try {
    const repos = getRepositories();
    const record = await repos.operatorAccess.update(req.params.accessId, {
      status: 'REVOKED', revokedAt: new Date(), revokedByEmployeeId: req.cafeOpsCaller.employeeId, revocationReason: req.body && req.body.reason,
    });
    return ok(res, { access: record });
  } catch (err) { next(err); }
});

router.post('/:employeeId/pin', requireGovernanceRole(...GOVERNANCE_ROLES), async (req, res, next) => {
  try {
    let result, attempts = 0, lastErr;
    while (!result && attempts < 5) {
      try {
        result = await pinService.issueOrResetPin({
          employeeId: req.params.employeeId, organisationId: req.cafeOpsCaller.organisationId,
          actingEmployeeId: req.cafeOpsCaller.employeeId, pin: req.body && req.body.pin, isReset: !!(req.body && req.body.isReset),
        });
      } catch (e) {
        lastErr = e;
        if (e.code === 'PIN_COLLISION' && !(req.body && req.body.pin)) { attempts += 1; continue; }
        throw e;
      }
    }
    if (!result) throw lastErr;
    return ok(res, { pin: result.plainPin });
  } catch (err) {
    if (err.code === 'WEAK_PIN') return fail(res, 400, 'WEAK_PIN', 'That PIN is too easy to guess. Choose another.');
    if (err.code === 'PIN_COLLISION') return fail(res, 409, 'PIN_COLLISION', 'That PIN is already in use. Choose another.');
    next(err);
  }
});

module.exports = router;
