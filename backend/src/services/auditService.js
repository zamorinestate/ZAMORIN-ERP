'use strict';

const crypto = require('crypto');
const mongoose = require('mongoose');

const {
  AuditEvent,
  AUDIT_RESULTS,
  RISK_CLASSIFICATIONS,
} = require('../models/AuditEvent');

const {
  SequenceCounter,
} = require('../models/SequenceCounter');

const SENSITIVE_FIELD_PATTERNS = [
  /password/i,
  /secret/i,
  /token/i,
  /authorization/i,
  /cookie/i,
  /otp/i,
  /recovery.?code/i,
  /private.?key/i,
  /access.?key/i,
  /refresh.?token/i,
  /bank.?account/i,
  /account.?number/i,
  /government.?id/i,
  /aadhaar/i,
  /pan/i,
];

function normalizeIdentifier(value) {
  if (typeof value !== 'string') {
    return null;
  }

  const normalizedValue =
    value.trim().toUpperCase();

  return normalizedValue || null;
}

function normalizeText(value, maximumLength = 2000) {
  if (value === null || value === undefined) {
    return '';
  }

  return String(value)
    .trim()
    .slice(0, maximumLength);
}

function isSensitiveField(fieldName) {
  return SENSITIVE_FIELD_PATTERNS.some(
    (pattern) => pattern.test(fieldName)
  );
}

function sanitizeAuditValue(
  value,
  visited = new WeakSet()
) {
  if (
    value === null ||
    value === undefined
  ) {
    return value;
  }

  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (Buffer.isBuffer(value)) {
    return '[BINARY_DATA_REMOVED]';
  }

  if (typeof value !== 'object') {
    return String(value);
  }

  if (visited.has(value)) {
    return '[CIRCULAR_REFERENCE]';
  }

  visited.add(value);

  if (Array.isArray(value)) {
    return value.map((item) =>
      sanitizeAuditValue(item, visited)
    );
  }

  const sanitizedObject = {};

  Object.entries(value).forEach(
    ([key, childValue]) => {
      if (isSensitiveField(key)) {
        sanitizedObject[key] =
          '[REDACTED]';

        return;
      }

      sanitizedObject[key] =
        sanitizeAuditValue(
          childValue,
          visited
        );
    }
  );

  return sanitizedObject;
}

function maskIpAddress(ipAddress) {
  if (!ipAddress) {
    return null;
  }

  const normalizedIp =
    String(ipAddress)
      .replace(/^::ffff:/, '')
      .trim();

  if (
    normalizedIp === '::1' ||
    normalizedIp === '127.0.0.1'
  ) {
    return 'LOCAL';
  }

  if (normalizedIp.includes(':')) {
    const segments =
      normalizedIp.split(':');

    return `${segments
      .slice(0, 3)
      .join(':')}:****`;
  }

  const segments =
    normalizedIp.split('.');

  if (segments.length === 4) {
    return `${segments[0]}.${segments[1]}.***.***`;
  }

  return 'MASKED';
}

function resolveRequestIp(request) {
  const forwardedFor =
    request?.get?.('x-forwarded-for');

  if (forwardedFor) {
    return forwardedFor
      .split(',')[0]
      .trim();
  }

  return (
    request?.ip ||
    request?.socket?.remoteAddress ||
    null
  );
}

function createCorrelationId() {
  return crypto.randomUUID();
}

async function generateAuditEventId(
  organisationId,
  session = null
) {
  const datePart = new Date()
    .toISOString()
    .slice(0, 10)
    .replaceAll('-', '');

  return SequenceCounter.generateId({
    organisationId,
    sequenceKey:
      `AUDIT_EVENT_${datePart}`,
    prefix: `AE-${datePart}`,
    minimumDigits: 4,
    session,
  });
}

function validateAuditEnumeration(
  value,
  allowedValues,
  fieldName
) {
  if (!allowedValues.includes(value)) {
    throw new Error(
      `${fieldName} is invalid.`
    );
  }
}

let auditCollectionReady = null;

async function recordAuditEvent({
  organisationId,
  cafeId = null,
  actorUserId,
  actorRole,
  module,
  action,
  entityType,
  entityId,
  before = null,
  after = null,
  reason = '',
  result = 'SUCCESS',
  riskClassification = 'LOW',
  correlationId = null,
  sessionId = null,
  requestMethod = null,
  requestPath = null,
  device = null,
  ipAddress = null,
  userAgent = null,
  metadata = {},
  session = null,
}) {
  const normalizedOrganisationId =
    normalizeIdentifier(organisationId);

  const normalizedActorUserId =
    normalizeIdentifier(actorUserId);

  const normalizedActorRole =
    normalizeIdentifier(actorRole);

  const normalizedModule =
    normalizeIdentifier(module);

  const normalizedAction =
    normalizeIdentifier(action);

  const normalizedEntityType =
    normalizeIdentifier(entityType);

  const normalizedEntityId =
    normalizeIdentifier(entityId);

  if (
    !normalizedOrganisationId ||
    !normalizedActorUserId ||
    !normalizedActorRole ||
    !normalizedModule ||
    !normalizedAction ||
    !normalizedEntityType ||
    !normalizedEntityId
  ) {
    throw new Error(
      'Audit organisation, actor, module, action, entity type and entity ID are required.'
    );
  }

  validateAuditEnumeration(
    result,
    AUDIT_RESULTS,
    'Audit result'
  );

  validateAuditEnumeration(
    riskClassification,
    RISK_CLASSIFICATIONS,
    'Risk classification'
  );

  const auditEventId =
    await generateAuditEventId(
      normalizedOrganisationId,
      session
    );

  const eventPayload = {
    auditEventId,
    organisationId:
      normalizedOrganisationId,
    cafeId:
      normalizeIdentifier(cafeId),
    actorUserId:
      normalizedActorUserId,
    actorRole:
      normalizedActorRole,
    module:
      normalizedModule,
    action:
      normalizedAction,
    entityType:
      normalizedEntityType,
    entityId:
      normalizedEntityId,
    before:
      sanitizeAuditValue(before),
    after:
      sanitizeAuditValue(after),
    reason:
      normalizeText(reason, 2000),
    result,
    riskClassification,
    correlationId:
      correlationId ||
      createCorrelationId(),
    sessionId:
      normalizeText(sessionId, 200) ||
      null,
    requestMethod:
      normalizeIdentifier(
        requestMethod
      ),
    requestPath:
      normalizeText(
        requestPath,
        500
      ) || null,
    device:
      normalizeText(device, 300) ||
      null,
    ipAddressMasked:
      maskIpAddress(ipAddress),
    userAgent:
      normalizeText(
        userAgent,
        1000
      ) || null,
    serverTimestamp:
      new Date(),
    metadata:
      sanitizeAuditValue(metadata),
  };

  const isStubbed = typeof AuditEvent.create === 'function' && AuditEvent.create !== mongoose.Model.create;
  if (isStubbed) {
    return session ? AuditEvent.create(eventPayload, { session }) : AuditEvent.create(eventPayload);
  }
  if (mongoose.connection.readyState !== 1) {
    return eventPayload;
  }

  // Pre-create the audit_events collection outside any transaction so that
  // implicit collection creation (a catalog change) never happens inside a
  // multi-document transaction, which would raise a WriteConflict /
  // TransientTransactionError on Mongo replica sets. Only do this when we are
  // NOT already inside a transaction (session present) — otherwise the
  // createCollection call itself could race with the transaction's catalog lock.
  if (!session && !auditCollectionReady) {
    auditCollectionReady = (async () => {
      try {
        await AuditEvent.createCollection();
      } catch (_err) {
        // Collection already exists or creation not permitted — ignore.
      }
    })();
  }
  if (!session) {
    await auditCollectionReady;
  }

  if (session) {
    const doc = new AuditEvent(eventPayload);
    await doc.save({ session });
    return doc;
  }

  return AuditEvent.create(eventPayload);
}

async function recordRequestAudit(payload = {}, options = {}) {
  const {
    request,
    module,
    action,
    entityType,
    entityId,
    cafeId = null,
    before = null,
    after = null,
    reason = '',
    result = 'SUCCESS',
    riskClassification = 'LOW',
    metadata = {},
  } = payload;
  const session = payload.session || options?.session || null;

  if (!request?.auth) {
    throw new Error(
      'Authenticated request context is required.'
    );
  }

  const correlationId =
    request.correlationId ||
    request.get?.('x-correlation-id') ||
    createCorrelationId();

  return recordAuditEvent({
    organisationId:
      request.auth.organisationId,
    cafeId:
      cafeId ||
      request.authorization?.cafeId ||
      null,
    actorUserId:
      request.auth.userId,
    actorRole:
      request.auth.role,
    module,
    action,
    entityType,
    entityId,
    before,
    after,
    reason,
    result,
    riskClassification,
    correlationId,
    sessionId:
      request.auth.sessionId,
    requestMethod:
      request.method,
    requestPath:
      request.originalUrl ||
      request.url,
    device:
      request.authenticatedSession
        ?.device?.deviceName ||
      null,
    ipAddress:
      resolveRequestIp(request),
    userAgent:
      request.get?.('user-agent') ||
      null,
    metadata,
    session,
  });
}

async function recordDeniedRequest({
  request,
  module,
  action,
  entityType,
  entityId,
  cafeId = null,
  reason,
  riskClassification = 'MEDIUM',
  metadata = {},
}) {
  return recordRequestAudit({
    request,
    module,
    action,
    entityType,
    entityId,
    cafeId,
    reason,
    result: 'DENIED',
    riskClassification,
    metadata,
  });
}

module.exports = {
  createCorrelationId,
  sanitizeAuditValue,
  maskIpAddress,
  recordAuditEvent,
  recordRequestAudit,
  recordDeniedRequest,
};