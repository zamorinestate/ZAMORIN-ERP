'use strict';

const crypto = require('node:crypto');
const { AttendanceQrChallenge } = require('../models/AttendanceQrChallenge');
const { AttendanceSubmission } = require('../models/AttendanceSubmission');
const { AttendanceOfflineLease } = require('../models/AttendanceOfflineLease');
const { DeviceRegistration } = require('../models/DeviceRegistration');
const { DeviceSecurityEvent } = require('../models/DeviceSecurityEvent');
const { Attendance } = require('../modules/attendance/Attendance');
const { Cafe } = require('../models/Cafe');
const ApiError = require('../utils/ApiError');

const QR_SIGNING_SECRET = process.env.QR_SIGNING_SECRET || 'zamorin_qr_master_signing_secret_key_2026_dsec';

function calculateDistanceMetres(lat1, lon1, lat2, lon2) {
  const R = 6371000; // Earth radius in metres
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

class AttendanceQrService {
  constructor() {
    this.userPinAttempts = new Map();
  }

  calculateDistance(lat1, lon1, lat2, lon2) {
    return calculateDistanceMetres(lat1, lon1, lat2, lon2);
  }

  getUserPinAttemptState(userId) {
    return this.userPinAttempts.get(userId) || { failedAttempts: 0, lockedUntil: null };
  }

  setUserPinAttemptState(userId, state) {
    this.userPinAttempts.set(userId, state);
  }

  clearUserPinAttemptState(userId) {
    this.userPinAttempts.delete(userId);
  }

  /**
   * Generates HMAC-SHA256 signature for challenge payload.
   */
  signPayload(payload) {
    const serialized = JSON.stringify(payload);
    return crypto.createHmac('sha256', QR_SIGNING_SECRET).update(serialized).digest('hex');
  }

  /**
   * Authoritatively issues or retrieves the currently active rotating challenge for an authorised display.
   */
  async getActiveOrNewChallenge({
    organisationId,
    cafeId,
    deviceId = 'OPS_CONSOLE',
    requestedByUserId = 'SYSTEM',
    requestedByRole = 'SYSTEM',
    assignedCafeIds = [],
    rotationIntervalSeconds = 45,
  }) {
    if (!organisationId) {
      throw new ApiError(400, 'ORGANISATION_CONTEXT_REQUIRED', 'Organisation context is required.');
    }
    if (!cafeId) {
      throw new ApiError(400, 'CAFE_ID_REQUIRED', 'A cafeId must be provided to display the attendance QR.');
    }

    // Role-based authorization for displaying the live rotating QR challenge
    if (requestedByRole === 'STAFF') {
      throw new ApiError(403, 'FORBIDDEN', 'Staff members are not permitted to generate or view raw QR challenges.');
    }

    if (requestedByRole === 'CAFE_ADMIN' && Array.isArray(assignedCafeIds) && assignedCafeIds.length > 0) {
      const allowedSet = new Set(assignedCafeIds.map((c) => String(c).toUpperCase()));
      if (!allowedSet.has(String(cafeId).toUpperCase())) {
        throw new ApiError(403, 'CAFE_SCOPE_MISMATCH', 'You are not authorised to display Attendance QR for this café.');
      }
    }

    const cafe = await Cafe.findOne({ cafeId, organisationId }).lean();
    if (!cafe) {
      throw new ApiError(404, 'CAFE_NOT_FOUND', 'Café not found in organisation.');
    }

    // 8-Second Pre-Expiry Threshold:
    // When querying for an active challenge, only return an existing challenge if it has > 8s remaining TTL.
    // This prevents handing a client a challenge that will expire while the employee is aligning their camera in-flight.
    // NOTE: This is NOT a post-expiry grace window. Once Date.now() > expiresAt, punches are strictly rejected with 403.
    let challenge = await AttendanceQrChallenge.findOne({
      organisationId,
      cafeId,
      isRevoked: false,
      expiresAt: { $gt: new Date(Date.now() + 8 * 1000) },
    }).sort({ expiresAt: -1 });

    if (!challenge) {
      const challengeId = `CHL_${Date.now()}_${crypto.randomBytes(8).toString('hex')}`;
      const opaqueToken = `ZAM_ATT_${crypto.randomBytes(32).toString('hex')}`;
      const fallbackPin = Math.floor(100000 + Math.random() * 900000).toString();
      const issuedAt = new Date();
      const expiresAt = new Date(Date.now() + rotationIntervalSeconds * 1000);
      const nonce = crypto.randomBytes(16).toString('hex');

      const envelopeData = {
        ver: 1,
        cid: challengeId,
        did: deviceId || 'OPS_CONSOLE',
        cafeId,
        orgId: organisationId,
        iat: Math.floor(issuedAt.getTime() / 1000),
        exp: Math.floor(expiresAt.getTime() / 1000),
        nonce,
        purpose: 'ATTENDANCE_PUNCH',
      };

      const signature = this.signPayload(envelopeData);

      challenge = await AttendanceQrChallenge.create({
        challengeId,
        opaqueToken,
        organisationId,
        deviceId: deviceId || 'OPS_CONSOLE',
        cafeId,
        fallbackPin,
        purpose: 'ATTENDANCE_PUNCH',
        issuedByUserId: requestedByUserId || 'SYSTEM',
        issuedByRole: requestedByRole || 'SYSTEM',
        rotationIntervalSeconds,
        issuedAt,
        expiresAt,
        nonce,
        signature,
      });
    } else if (!challenge.opaqueToken) {
      const opaqueToken = `ZAM_ATT_${crypto.randomBytes(32).toString('hex')}`;
      challenge.opaqueToken = opaqueToken;
      await AttendanceQrChallenge.updateOne({ _id: challenge._id }, { $set: { opaqueToken } });
    }

    const envelope = {
      ver: 1,
      cid: challenge.challengeId,
      did: challenge.deviceId,
      cafeId: challenge.cafeId,
      orgId: challenge.organisationId,
      iat: Math.floor(challenge.issuedAt.getTime() / 1000),
      exp: Math.floor(challenge.expiresAt.getTime() / 1000),
      nonce: challenge.nonce,
      purpose: challenge.purpose || 'ATTENDANCE_PUNCH',
      sig: challenge.signature,
    };

    const secret = process.env.ATTENDANCE_QR_SECRET || 'zamorin-attendance-presence-secret-salt-2026';
    const expiresAtSec = Math.floor(challenge.expiresAt.getTime() / 1000);
    const issuedAtSec = Math.floor(challenge.issuedAt.getTime() / 1000);
    const dotPayload = `${challenge.challengeId}.${challenge.organisationId}.${challenge.cafeId}.${issuedAtSec}.${expiresAtSec}`;
    const dotSig = crypto.createHmac('sha256', secret).update(dotPayload).digest('hex');
    const dotToken = `${challenge.challengeId}.${challenge.organisationId}.${challenge.cafeId}.${expiresAtSec}.${dotSig}`;

    return {
      challengeId: challenge.challengeId,
      purpose: challenge.purpose || 'ATTENDANCE_PUNCH',
      envelope,
      qrToken: dotToken,
      dotToken,
      opaqueToken: challenge.opaqueToken,
      qrString: JSON.stringify(envelope),
      cafeId: challenge.cafeId,
      cafeName: cafe.name,
      fallbackPin: challenge.fallbackPin,
      issuedAt: challenge.issuedAt,
      expiresAt: challenge.expiresAt,
      rotationIntervalSeconds: challenge.rotationIntervalSeconds || rotationIntervalSeconds,
      remainingSeconds: Math.max(0, Math.floor((challenge.expiresAt.getTime() - Date.now()) / 1000)),
    };
  }

  /**
   * Validates a scanned QR token and resolves the authoritative organisationId and cafeId.
   */
  async validateChallengeToken(qrToken, { employeeOrgId, employeeAssignedCafes = [], employeeRole = 'STAFF', isPrimaryMaster = false } = {}) {
    if (!qrToken) {
      throw new ApiError(400, 'QR_TOKEN_REQUIRED', 'Attendance QR token is required.');
    }

    const trimmedToken = typeof qrToken === 'string' ? qrToken.trim() : '';

    // Branch 0: Opaque High-Entropy Token (ZAM_ATT_<hex>)
    // Privacy-hardened architecture: Does not expose organisationId, cafeId, or DB identifiers in QR payload
    if (trimmedToken.startsWith('ZAM_ATT_')) {
      const challenge = await AttendanceQrChallenge.findOne({ opaqueToken: trimmedToken });
      if (!challenge || challenge.isRevoked) {
        throw new ApiError(404, 'QR_CHALLENGE_NOT_FOUND', 'Attendance QR challenge not found or revoked.');
      }

      if (Date.now() > new Date(challenge.expiresAt).getTime()) {
        throw new ApiError(403, 'EXPIRED_ATTENDANCE_QR', 'Attendance QR token has expired. Please scan the latest rotating QR.');
      }

      if (challenge.purpose && challenge.purpose !== 'ATTENDANCE_PUNCH') {
        throw new ApiError(403, 'INVALID_CHALLENGE_PURPOSE', 'Invalid challenge purpose.');
      }

      if (employeeOrgId && challenge.organisationId !== String(employeeOrgId).toUpperCase()) {
        throw new ApiError(403, 'ORGANISATION_MISMATCH', 'Attendance QR belongs to a different organisation.');
      }

      const resolvedCafeId = challenge.cafeId;
      if (employeeRole === 'STAFF' && !isPrimaryMaster) {
        if (Array.isArray(employeeAssignedCafes) && employeeAssignedCafes.length > 0) {
          const cafeAllowed = employeeAssignedCafes
            .map((c) => String(c).toUpperCase())
            .includes(String(resolvedCafeId).toUpperCase());
          if (!cafeAllowed) {
            throw new ApiError(403, 'CROSS_CAFE_UNAUTHORIZED', 'You are not assigned to check in at this café.');
          }
        }
      }

      return {
        valid: true,
        verified: true,
        challenge,
        challengeId: challenge.challengeId,
        resolvedCafeId,
        cafeId: resolvedCafeId,
        resolvedOrgId: challenge.organisationId,
        organisationId: challenge.organisationId,
        expiresAt: challenge.expiresAt,
        purpose: challenge.purpose || 'ATTENDANCE_PUNCH',
      };
    }

    const secret = process.env.ATTENDANCE_QR_SECRET || 'zamorin-attendance-presence-secret-salt-2026';

    // Branch A: Dot-separated compact token (challengeId.orgId.cafeId.expiresAt.signature)
    if (typeof qrToken === 'string' && !qrToken.trim().startsWith('{')) {
      const parts = qrToken.split('.');
      if (parts.length !== 5) {
        throw new ApiError(400, 'INVALID_CHALLENGE_FORMAT', 'Attendance QR token format is invalid.');
      }

      const [tokenCid, tokenOrgId, tokenCafeId, tokenExp, tokenSig] = parts;
      const expSec = Number(tokenExp);
      if (isNaN(expSec)) {
        throw new ApiError(400, 'INVALID_CHALLENGE_FORMAT', 'Attendance QR expiration timestamp is invalid.');
      }

      if (Date.now() > expSec * 1000) {
        throw new ApiError(403, 'EXPIRED_ATTENDANCE_QR', 'Attendance QR token has expired. Please scan the latest rotating QR.');
      }

      const challenge = await AttendanceQrChallenge.findOne({ challengeId: tokenCid });
      if (challenge && challenge.isRevoked) {
        throw new ApiError(404, 'QR_CHALLENGE_NOT_FOUND', 'Attendance QR challenge revoked.');
      }

      // Cryptographic signature check
      let validSig = false;
      if (challenge?.signature === tokenSig) {
        validSig = true;
      }
      if (!validSig && challenge?.issuedAt) {
        const iatSec = Math.floor(new Date(challenge.issuedAt).getTime() / 1000);
        const testPayload = `${tokenCid}.${tokenOrgId}.${tokenCafeId}.${iatSec}.${tokenExp}`;
        if (crypto.createHmac('sha256', secret).update(testPayload).digest('hex') === tokenSig) {
          validSig = true;
        }
      }
      if (!validSig) {
        const directPayload = `${tokenCid}.${tokenOrgId}.${tokenCafeId}.${tokenExp}`;
        if (crypto.createHmac('sha256', secret).update(directPayload).digest('hex') === tokenSig) {
          validSig = true;
        }
      }
      if (!validSig) {
        for (let offset = 40; offset <= 50; offset++) {
          const testPayload = `${tokenCid}.${tokenOrgId}.${tokenCafeId}.${expSec - offset}.${tokenExp}`;
          if (crypto.createHmac('sha256', secret).update(testPayload).digest('hex') === tokenSig) {
            validSig = true;
            break;
          }
        }
      }

      if (!validSig) {
        throw new ApiError(403, 'INVALID_CHALLENGE_SIGNATURE', 'QR cryptographic verification failed.');
      }

      if (employeeOrgId && tokenOrgId !== employeeOrgId) {
        throw new ApiError(403, 'ORGANISATION_MISMATCH', 'QR challenge belongs to a different organisation.');
      }

      if (employeeRole === 'STAFF' && Array.isArray(employeeAssignedCafes) && employeeAssignedCafes.length > 0) {
        const allowedSet = new Set(employeeAssignedCafes.map((c) => String(c).toUpperCase()));
        if (!allowedSet.has(tokenCafeId.toUpperCase())) {
          throw new ApiError(403, 'CROSS_CAFE_UNAUTHORIZED', 'You are not assigned to check in at this café.');
        }
      }

      return {
        valid: true,
        verified: true,
        challenge: challenge || { challengeId: tokenCid, cafeId: tokenCafeId, organisationId: tokenOrgId },
        challengeId: tokenCid,
        resolvedCafeId: tokenCafeId,
        cafeId: tokenCafeId,
        organisationId: tokenOrgId,
        expiresAt: new Date(expSec * 1000),
      };
    }

    // Branch B: JSON / base64 object envelope
    let envelopeData;
    if (typeof qrToken === 'string') {
      try {
        envelopeData = JSON.parse(qrToken);
      } catch (_) {
        try {
          envelopeData = JSON.parse(Buffer.from(qrToken, 'base64').toString('utf8'));
        } catch (e) {
          throw new ApiError(400, 'INVALID_QR_PAYLOAD', 'Scanned QR token could not be parsed.');
        }
      }
    } else if (typeof qrToken === 'object' && qrToken !== null) {
      envelopeData = qrToken;
    } else {
      throw new ApiError(400, 'INVALID_QR_PAYLOAD', 'Scanned QR token format is invalid.');
    }

    if (!envelopeData.sig || !envelopeData.cid) {
      throw new ApiError(400, 'INVALID_QR_STRUCTURE', 'QR envelope is missing signature or challenge ID.');
    }

    if (envelopeData.purpose && envelopeData.purpose !== 'ATTENDANCE_PUNCH') {
      throw new ApiError(400, 'INVALID_QR_PURPOSE', 'Scanned QR code is not valid for attendance punches.');
    }

    const { sig, ...dataToVerify } = envelopeData;
    const expectedSig = this.signPayload(dataToVerify);
    if (sig !== expectedSig) {
      throw new ApiError(400, 'INVALID_QR_SIGNATURE', 'QR cryptographic verification failed.');
    }

    const challenge = await AttendanceQrChallenge.findOne({ challengeId: envelopeData.cid });
    if (!challenge || challenge.isRevoked) {
      throw new ApiError(404, 'QR_CHALLENGE_NOT_FOUND', 'Attendance QR challenge not found or revoked.');
    }

    if (new Date() > challenge.expiresAt) {
      throw new ApiError(400, 'QR_CHALLENGE_EXPIRED', 'Attendance QR has expired. Please scan the current rotating code.');
    }

    if (employeeOrgId && challenge.organisationId !== employeeOrgId) {
      throw new ApiError(403, 'ORGANISATION_MISMATCH', 'QR challenge belongs to a different organisation.');
    }

    const resolvedCafeId = challenge.cafeId;
    if (employeeRole === 'STAFF' && Array.isArray(employeeAssignedCafes) && employeeAssignedCafes.length > 0) {
      const allowedSet = new Set(employeeAssignedCafes.map((c) => String(c).toUpperCase()));
      if (!allowedSet.has(resolvedCafeId.toUpperCase())) {
        throw new ApiError(403, 'CROSS_CAFE_UNAUTHORIZED', 'You are not assigned to check in at this café.');
      }
    }

    return {
      valid: true,
      verified: true,
      challenge,
      challengeId: challenge.challengeId,
      resolvedCafeId,
      cafeId: resolvedCafeId,
      organisationId: challenge.organisationId,
      issuedAt: challenge.issuedAt,
      expiresAt: challenge.expiresAt,
    };
  }

  /**
   * Server-authoritative distance calculation and geofence verification against Cafe.address.
   */
  async verifyGeofence({ cafeId, latitude, longitude, accuracyMeters }) {
    if (typeof latitude !== 'number' || typeof longitude !== 'number') {
      throw new ApiError(400, 'COORDINATES_REQUIRED', 'Valid numeric GPS latitude and longitude are required.');
    }

    const cafeDoc = await Cafe.findOne({ cafeId }).lean();
    if (!cafeDoc) {
      throw new ApiError(404, 'CAFE_NOT_FOUND', 'Café not found.');
    }

    if (
      !cafeDoc.address ||
      typeof cafeDoc.address.latitude !== 'number' ||
      typeof cafeDoc.address.longitude !== 'number'
    ) {
      throw new ApiError(
        422,
        'GEOFENCE_NOT_CONFIGURED',
        'Attendance Geofence Not Configured: Café location coordinates are missing in system administration.'
      );
    }

    if (typeof accuracyMeters === 'number' && accuracyMeters > 100) {
      throw new ApiError(
        422,
        'LOW_GPS_ACCURACY',
        `GPS accuracy (${Math.round(accuracyMeters)}m) is too poor to verify presence. Please move near a window or open area and retry.`
      );
    }

    const distance = calculateDistanceMetres(
      latitude,
      longitude,
      cafeDoc.address.latitude,
      cafeDoc.address.longitude
    );

    const allowedRadius = cafeDoc.geofenceRadiusMeters || cafeDoc.address.geofenceRadiusMetres || 100;
    if (distance > allowedRadius) {
      throw new ApiError(
        403,
        'OUTSIDE_GEOFENCE_RADIUS',
        'You are outside the authorised attendance location.'
      );
    }

    return {
      valid: true,
      verified: true,
      geofenceVerified: true,
      distanceMeters: Math.round(distance),
      allowedRadiusMeters: allowedRadius,
      accuracyMeters: typeof accuracyMeters === 'number' ? Math.round(accuracyMeters) : null,
      cafeId,
      cafeName: cafeDoc.name,
    };
  }

  /**
   * Issues a rotating QR attendance challenge for an active bound cafe device.
   */
  async issueChallenge({ organisationId, deviceId, cafeId, correlationId }) {
    const device = await DeviceRegistration.findOne({ deviceId, status: 'ACTIVE', deviceClass: 'CAFE_OWNED' });
    if (!device) {
      throw new Error('DEVICE_NOT_REGISTERED_OR_INACTIVE');
    }

    if (device.assignedCafeId !== cafeId) {
      throw new Error('DEVICE_CAFE_SCOPE_MISMATCH');
    }

    const challengeId = `CHL_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const fallbackPin = Math.floor(100000 + Math.random() * 900000).toString(); // 6 digits
    const issuedAt = new Date();
    const expiresAt = new Date(Date.now() + 60 * 1000); // 60 seconds TTL
    const nonce = crypto.randomBytes(8).toString('hex');

    const envelopeData = {
      ver: 1,
      cid: challengeId,
      did: deviceId,
      cafeId,
      iat: Math.floor(issuedAt.getTime() / 1000),
      exp: Math.floor(expiresAt.getTime() / 1000),
      nonce,
    };

    const signature = this.signPayload(envelopeData);

    const challengeDoc = await AttendanceQrChallenge.create({
      challengeId,
      organisationId,
      deviceId,
      cafeId,
      fallbackPin,
      issuedAt,
      expiresAt,
      nonce,
      signature,
    });

    return {
      challengeId,
      envelope: {
        ...envelopeData,
        sig: signature,
      },
      fallbackPin,
      expiresAt,
      rotationIntervalSeconds: 20,
    };
  }

  /**
   * Submits and validates a QR attendance scan from an authenticated staff personal session.
   */
  async submitAttendance({ organisationId, userId, cafeId, challengeEnvelope, fallbackPin, idempotencyKey, clientScannedAt, latitude, longitude, correlationId }) {
    if (!idempotencyKey) {
      throw new Error('IDEMPOTENCY_KEY_REQUIRED');
    }

    const idempotencyKeyHash = crypto.createHash('sha256').update(String(idempotencyKey)).digest('hex');

    // 1. Check Idempotency Submission
    const existingSubmission = await AttendanceSubmission.findOne({
      organisationId,
      userId,
      idempotencyKeyHash,
    });

    if (existingSubmission) {
      return {
        submissionId: existingSubmission.submissionId,
        result: existingSubmission.result,
        transition: existingSubmission.transition,
        serverReceivedAt: existingSubmission.serverReceivedAt,
        idempotentReplay: true,
      };
    }

    // Geofence Validation if coordinates are provided
    if (typeof latitude === 'number' && typeof longitude === 'number') {
      const cafeDoc = await Cafe.findOne({ cafeId }).lean();
      if (
        cafeDoc &&
        cafeDoc.address &&
        typeof cafeDoc.address.latitude === 'number' &&
        typeof cafeDoc.address.longitude === 'number'
      ) {
        const distance = calculateDistanceMetres(
          latitude,
          longitude,
          cafeDoc.address.latitude,
          cafeDoc.address.longitude
        );
        const maxRadius = cafeDoc.address.geofenceRadiusMetres || 100;
        if (distance > maxRadius) {
          throw new Error(
            `GEOFENCE_RADIUS_EXCEEDED: Distance ${Math.round(distance)}m exceeds allowed radius of ${maxRadius}m`
          );
        }
      }
    }

    // 2. Resolve and Validate Challenge
    let challenge = null;
    let envelopeData = null;

    if (challengeEnvelope) {
      if (typeof challengeEnvelope === 'string') {
        try {
          envelopeData = JSON.parse(Buffer.from(challengeEnvelope, 'base64').toString('utf8'));
        } catch (e) {
          envelopeData = JSON.parse(challengeEnvelope);
        }
      } else {
        envelopeData = challengeEnvelope;
      }

      const { sig, ...dataToVerify } = envelopeData;
      const expectedSig = this.signPayload(dataToVerify);
      if (sig !== expectedSig) {
        throw new Error('INVALID_QR_SIGNATURE');
      }

      challenge = await AttendanceQrChallenge.findOne({ challengeId: envelopeData.cid });
    } else if (fallbackPin) {
      const userAttempt = this.getUserPinAttemptState(userId);
      if (userAttempt.lockedUntil && userAttempt.lockedUntil > new Date()) {
        throw new Error('FALLBACK_PIN_USER_LOCKED_TOO_MANY_ATTEMPTS');
      }

      challenge = await AttendanceQrChallenge.findOne({
        cafeId,
        fallbackPin,
        expiresAt: { $gt: new Date() },
      });

      if (!challenge) {
        userAttempt.failedAttempts += 1;
        if (userAttempt.failedAttempts >= 5) {
          userAttempt.lockedUntil = new Date(Date.now() + 15 * 60 * 1000);
        }
        this.setUserPinAttemptState(userId, userAttempt);
        throw new Error('INVALID_OR_EXPIRED_FALLBACK_PIN');
      }

      // Reset user failure counter on successful PIN match
      this.clearUserPinAttemptState(userId);
    } else {
      throw new Error('CHALLENGE_ENVELOPE_OR_PIN_REQUIRED');
    }

    if (!challenge) {
      throw new Error('CHALLENGE_NOT_FOUND_OR_EXPIRED');
    }

    if (new Date() > challenge.expiresAt) {
      throw new Error('QR_CHALLENGE_EXPIRED');
    }

    if (challenge.cafeId !== cafeId) {
      throw new Error('QR_CAFE_SCOPE_MISMATCH');
    }

    // 3. Determine Transition & Prevent Tuple Replay
    const today = new Date().toISOString().split('T')[0];
    let attendance = await Attendance.findOne({
      organisationId,
      userId,
      businessDate: today,
    });

    let transition = 'CHECK_IN';
    if (attendance && attendance.checkInAt && !attendance.checkOutAt) {
      transition = 'CHECK_OUT';
    } else if (attendance && attendance.checkInAt && attendance.checkOutAt) {
      throw new Error('ATTENDANCE_ALREADY_COMPLETED_FOR_TODAY');
    }

    // Check challenge tuple replay
    const tupleCheck = await AttendanceSubmission.findOne({
      challengeId: challenge.challengeId,
      userId,
      transition,
    });

    if (tupleCheck) {
      throw new Error('QR_CHALLENGE_ALREADY_USED_BY_USER_FOR_TRANSITION');
    }

    const submissionId = `SUB_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const serverReceivedAt = new Date();

    // 4. Atomic Attendance Record Update
    const datePart = today.replaceAll('-', '');
    const timeSlice = Date.now().toString().slice(-6);
    const randDigits = Math.floor(1000 + Math.random() * 9000).toString();
    const generatedAttendanceId = `AT-${datePart}-${timeSlice}${randDigits}`;

    if (transition === 'CHECK_IN') {
      if (!attendance) {
        attendance = new Attendance({
          attendanceId: generatedAttendanceId,
          organisationId,
          cafeId,
          userId,
          businessDate: today,
          checkInAt: serverReceivedAt,
          status: 'CHECKED_IN',
          checkInSource: 'SELF',
          checkInRecordedBy: userId,
          timezone: 'Asia/Kolkata',
          createdBy: userId,
          updatedBy: userId,
        });
      } else {
        attendance.checkInAt = serverReceivedAt;
        attendance.status = 'CHECKED_IN';
        attendance.checkInSource = 'SELF';
        attendance.checkInRecordedBy = userId;
        attendance.updatedBy = userId;
      }
    } else {
      if (attendance) {
        attendance.checkOutAt = serverReceivedAt;
        attendance.status = 'CHECKED_OUT';
        attendance.checkOutSource = 'SELF';
        attendance.checkOutRecordedBy = userId;
        attendance.updatedBy = userId;
      } else {
        attendance = new Attendance({
          attendanceId: generatedAttendanceId,
          organisationId,
          cafeId,
          userId,
          businessDate: today,
          checkOutAt: serverReceivedAt,
          status: 'CHECKED_OUT',
          checkOutSource: 'SELF',
          checkOutRecordedBy: userId,
          timezone: 'Asia/Kolkata',
          createdBy: userId,
          updatedBy: userId,
        });
      }
    }

    await attendance.save();

    // 5. Save Immutable Submission Record
    await AttendanceSubmission.create({
      submissionId,
      organisationId,
      userId,
      cafeId,
      deviceId: challenge.deviceId,
      challengeId: challenge.challengeId,
      idempotencyKeyHash,
      transition,
      challengeIssuedAt: challenge.issuedAt,
      clientScannedAt: clientScannedAt ? new Date(clientScannedAt) : serverReceivedAt,
      serverReceivedAt,
      isOffline: false,
      result: 'ACCEPTED',
      correlationId,
    });

    return {
      submissionId,
      result: 'ACCEPTED',
      transition,
      serverReceivedAt,
      idempotentReplay: false,
    };
  }

  /**
   * Issues a bounded offline signing lease to a verified cafe device.
   */
  async issueOfflineLease({ organisationId, deviceId, cafeId, durationMinutes = 480, correlationId }) {
    const device = await DeviceRegistration.findOne({ deviceId, status: 'ACTIVE', deviceClass: 'CAFE_OWNED' });
    if (!device || device.assignedCafeId !== cafeId) {
      throw new Error('DEVICE_UNAUTHORIZED_FOR_OFFLINE_LEASE');
    }

    const leaseId = `LEASE_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const serverNotBefore = new Date();
    const serverNotAfter = new Date(Date.now() + durationMinutes * 60 * 1000);

    const leasePayload = {
      leaseId,
      deviceId,
      cafeId,
      notBefore: Math.floor(serverNotBefore.getTime() / 1000),
      notAfter: Math.floor(serverNotAfter.getTime() / 1000),
      policyVersion: device.policyVersion,
    };

    const serverSignature = this.signPayload(leasePayload);

    await AttendanceOfflineLease.create({
      leaseId,
      organisationId,
      deviceId,
      cafeId,
      serverNotBefore,
      serverNotAfter,
      maxSequence: 5000,
      policyVersion: device.policyVersion,
      serverSignature,
      status: 'ACTIVE',
    });

    await DeviceSecurityEvent.create({
      eventId: `DEV_EVT_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
      organisationId,
      deviceId,
      deviceClass: 'CAFE_OWNED',
      cafeId,
      actorUserId: 'SYSTEM',
      actorRole: 'CAFE_ADMIN',
      eventType: 'OFFLINE_LEASE_ISSUED',
      severity: 'INFO',
      metadata: { leaseId, durationMinutes },
      correlationId,
    });

    return {
      leaseId,
      serverNotBefore,
      serverNotAfter,
      serverSignature,
    };
  }
}

module.exports = new AttendanceQrService();
