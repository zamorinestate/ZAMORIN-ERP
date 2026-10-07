'use strict';
const express = require('express');
const { getRepositories } = require('../repositories');
const deviceService = require('../services/deviceService');
const enrollmentService = require('../services/deviceEnrollmentService');
const { requireGovernanceRole } = require('../middleware/requireGovernanceRole');
const { ok, fail } = require('../utils/responses');

const router = express.Router();
const GOVERNANCE_ROLES = ['MASTER_PRIMARY', 'OWNER', 'CAFE_ADMIN'];
const DEVICE_GOVERNING_ROLES = ['MASTER_PRIMARY', 'OWNER'];

router.get('/', requireGovernanceRole(...GOVERNANCE_ROLES), async (req, res, next) => {
  try {
    const repos = getRepositories();
    const devices = req.query.cafeId ? await repos.devices.findByCafe(req.query.cafeId) : await repos.devices.listAll();
    return ok(res, { devices: devices.map(publicDevice) });
  } catch (err) { next(err); }
});

router.post('/enrollment-tokens', requireGovernanceRole(...DEVICE_GOVERNING_ROLES), async (req, res, next) => {
  try {
    const { cafeId, cafeDisplayName, intendedDisplayName } = req.body || {};
    if (!cafeId) return fail(res, 400, 'INVALID_INPUT', 'cafeId is required.');
    const { record, codePlain } = await enrollmentService.createEnrollmentToken({
      organisationId: req.cafeOpsCaller.organisationId, cafeId, cafeDisplayName, intendedDisplayName, createdByEmployeeId: req.cafeOpsCaller.employeeId,
    });
    return ok(res, { enrollmentCode: codePlain, expiresAt: record.expiresAt });
  } catch (err) { next(err); }
});

for (const [path, status] of [['revoke', 'REVOKED'], ['mark-lost', 'LOST'], ['retire', 'RETIRED']]) {
  router.post(`/:deviceId/${path}`, requireGovernanceRole(...DEVICE_GOVERNING_ROLES), async (req, res, next) => {
    try {
      const device = await deviceService.transitionLifecycle(req.params.deviceId, status, {
        actorEmployeeId: req.cafeOpsCaller.employeeId, reason: req.body && req.body.reason,
      });
      return ok(res, { device: publicDevice(device) });
    } catch (err) { next(err); }
  });
}

router.post('/:deviceId/replace', requireGovernanceRole(...DEVICE_GOVERNING_ROLES), async (req, res, next) => {
  try {
    const oldDevice = await deviceService.transitionLifecycle(req.params.deviceId, 'REPLACED', {
      actorEmployeeId: req.cafeOpsCaller.employeeId, reason: req.body && req.body.reason,
    });
    const { record, codePlain } = await enrollmentService.createEnrollmentToken({
      organisationId: req.cafeOpsCaller.organisationId, cafeId: oldDevice.cafeId, cafeDisplayName: oldDevice.cafeDisplayName,
      intendedDisplayName: (req.body && req.body.intendedDisplayName) || oldDevice.displayName,
      createdByEmployeeId: req.cafeOpsCaller.employeeId,
    });
    return ok(res, { replacementEnrollmentCode: codePlain, expiresAt: record.expiresAt });
  } catch (err) { next(err); }
});

router.post('/:deviceId/reassign-cafe', requireGovernanceRole(...DEVICE_GOVERNING_ROLES), async (req, res, next) => {
  try {
    const { newCafeId, newCafeDisplayName, reason } = req.body || {};
    if (!newCafeId) return fail(res, 400, 'INVALID_INPUT', 'newCafeId is required.');
    const device = await deviceService.reassignCafe(req.params.deviceId, newCafeId, { actorEmployeeId: req.cafeOpsCaller.employeeId, reason, newCafeDisplayName });
    return ok(res, { device: publicDevice(device) });
  } catch (err) {
    if (err.code === 'DEVICE_NOT_FOUND') return fail(res, 404, 'DEVICE_NOT_FOUND', 'Device not found.');
    next(err);
  }
});

function publicDevice(d) {
  return {
    id: d.id, deviceCode: d.deviceCode, displayName: d.displayName, cafeId: d.cafeId, cafeName: d.cafeDisplayName || null,
    platform: d.platform, appVersion: d.appVersion, lifecycleStatus: d.lifecycleStatus,
    lastSeenAt: d.lastSeenAt, lastSyncAt: d.lastSyncAt, enrolledAt: d.enrolledAt,
  };
}

module.exports = router;
