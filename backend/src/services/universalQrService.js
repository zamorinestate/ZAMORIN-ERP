'use strict';

const crypto = require('crypto');
const { UniversalQrRecord, QR_TYPES } = require('../models/UniversalQrRecord');
const { generateQrSvg } = require('../utils/qrCodeGen');
const { ApiError } = require('../utils/ApiError');
const auditService = require('./auditService');

const QR_SECRET = process.env.QR_HMAC_SECRET || 'zamorin-universal-qr-secret-key-2026';

class UniversalQrService {
  /**
   * Generates a cryptographic HMAC signature for tamper verification.
   */
  static generateSignature(opaqueToken, targetEntityId) {
    return crypto
      .createHmac('sha256', QR_SECRET)
      .update(`${opaqueToken}:${targetEntityId}`)
      .digest('hex');
  }

  /**
   * Creates and registers a new Universal QR code.
   */
  static async createQrRecord({
    qrType,
    targetEntityId,
    organisationId,
    cafeId = null,
    title = null,
    metadata = {},
    ttlMinutes = null,
    actorUserId = 'SYSTEM',
  }) {
    if (!QR_TYPES.includes(qrType)) {
      throw new ApiError(400, 'INVALID_QR_TYPE', `QR type must be one of: ${QR_TYPES.join(', ')}`);
    }
    if (!targetEntityId || !organisationId) {
      throw new ApiError(400, 'REQUIRED_FIELDS_MISSING', 'targetEntityId and organisationId are required.');
    }

    const opaqueToken = crypto.randomBytes(24).toString('base64url');
    const hmacSignature = this.generateSignature(opaqueToken, targetEntityId);
    const qrId = `QR-${qrType}-${crypto.randomBytes(8).toString('hex').toUpperCase()}`;

    // Construct canonical, secure URL or opaque string based on type
    let payload;
    switch (qrType) {
      case 'CAFE_LOGIN':
        payload = `https://zamorin.app/cafe/${encodeURIComponent(targetEntityId)}/login?t=${opaqueToken}`;
        break;
      case 'TABLE_ORDER':
        payload = `https://zamorin.app/order/${encodeURIComponent(cafeId || targetEntityId)}?table=${encodeURIComponent(metadata.tableNumber || '1')}&t=${opaqueToken}`;
        break;
      case 'EMPLOYEE_BADGE':
        payload = `ZAMORIN:EMP:${encodeURIComponent(targetEntityId)}:${opaqueToken}`;
        break;
      case 'ATTENDANCE_TOKEN':
        payload = `ZAMORIN:ATT:${encodeURIComponent(cafeId || 'HQ')}:${opaqueToken}`;
        break;
      case 'PAYMENT_UPI':
        payload = metadata.upiUri || `upi://pay?pa=ops@zamorin&pn=ZamorinCafe&am=${metadata.amount || '0'}&cu=INR&tn=${encodeURIComponent(targetEntityId)}`;
        break;
      case 'DOCUMENT_VERIFICATION':
        payload = `https://zamorin.app/verify/doc/${encodeURIComponent(targetEntityId)}?t=${opaqueToken}`;
        break;
      case 'INVENTORY_BATCH':
      default:
        payload = `ZAMORIN:BATCH:${encodeURIComponent(targetEntityId)}:${opaqueToken}`;
        break;
    }

    let expiresAt = null;
    if (ttlMinutes && Number.isInteger(ttlMinutes) && ttlMinutes > 0) {
      expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000);
    }

    const qrRecord = await UniversalQrRecord.create({
      qrId,
      qrType,
      organisationId,
      cafeId,
      targetEntityId,
      title: title || `Zamorin ${qrType} QR`,
      payload,
      opaqueToken,
      hmacSignature,
      status: 'ACTIVE',
      expiresAt,
      metadata,
      createdBy: actorUserId,
    });

    await auditService.recordAuditEvent({
      organisationId,
      cafeId: cafeId || 'GLOBAL',
      actorUserId,
      actorRole: 'SYSTEM',
      module: 'UNIVERSAL_QR',
      action: 'QR_CREATED',
      entityType: 'UNIVERSAL_QR',
      entityId: qrId,
      reason: `Created ${qrType} QR token for entity ${targetEntityId}`,
      result: 'SUCCESS',
      metadata: { qrType, targetEntityId, expiresAt },
    }).catch(() => {});

    return qrRecord;
  }

  /**
   * Verifies an incoming QR token, checking expiration, revocation, and signature.
   */
  static async verifyQrToken(opaqueToken, { qrType = null, cafeId = null } = {}) {
    if (!opaqueToken) {
      throw new ApiError(400, 'QR_TOKEN_REQUIRED', 'QR token is required for verification.');
    }

    const record = await UniversalQrRecord.findOne({ opaqueToken });
    if (!record) {
      throw new ApiError(404, 'QR_NOT_FOUND', 'QR token does not exist or has been removed.');
    }

    // Status validation
    if (record.status === 'REVOKED') {
      throw new ApiError(403, 'QR_REVOKED', `This QR code has been revoked. Reason: ${record.revocationReason || 'Security policy'}`);
    }
    if (record.status === 'SUSPENDED') {
      throw new ApiError(403, 'QR_SUSPENDED', 'This QR code is temporarily suspended.');
    }
    if (record.status === 'EXPIRED' || (record.expiresAt && new Date() > record.expiresAt)) {
      if (record.status !== 'EXPIRED') {
        record.status = 'EXPIRED';
        await record.save();
      }
      throw new ApiError(403, 'QR_EXPIRED', 'This QR code has expired.');
    }

    // Type and Cafe scoping checks if requested
    if (qrType && record.qrType !== qrType) {
      throw new ApiError(400, 'QR_TYPE_MISMATCH', `Expected QR type ${qrType} but got ${record.qrType}`);
    }
    if (cafeId && record.cafeId && record.cafeId !== cafeId) {
      throw new ApiError(403, 'QR_CAFE_MISMATCH', 'This QR code is not valid for this café location.');
    }

    // Cryptographic signature verification
    const expectedSig = this.generateSignature(record.opaqueToken, record.targetEntityId);
    if (!crypto.timingSafeEqual(Buffer.from(record.hmacSignature), Buffer.from(expectedSig))) {
      throw new ApiError(403, 'QR_TAMPERED', 'Cryptographic verification failed. QR token is invalid.');
    }

    // Increment scan metrics
    record.scanCount += 1;
    record.lastScannedAt = new Date();
    await record.save();

    return {
      valid: true,
      qrId: record.qrId,
      qrType: record.qrType,
      targetEntityId: record.targetEntityId,
      organisationId: record.organisationId,
      cafeId: record.cafeId,
      metadata: record.metadata,
      scanCount: record.scanCount,
      lastScannedAt: record.lastScannedAt,
    };
  }

  /**
   * Revokes a QR code permanently.
   */
  static async revokeQr(qrId, { reason = 'Revoked by administrator', actorUserId = 'SYSTEM' } = {}) {
    const record = await UniversalQrRecord.findOne({ qrId });
    if (!record) {
      throw new ApiError(404, 'QR_NOT_FOUND', 'QR record not found.');
    }

    record.status = 'REVOKED';
    record.revocationReason = reason;
    record.revokedAt = new Date();
    await record.save();

    await auditService.recordAuditEvent({
      organisationId: record.organisationId,
      cafeId: record.cafeId || 'GLOBAL',
      actorUserId,
      actorRole: 'ADMIN',
      module: 'UNIVERSAL_QR',
      action: 'QR_REVOKED',
      entityType: 'UNIVERSAL_QR',
      entityId: qrId,
      reason,
      result: 'SUCCESS',
    }).catch(() => {});

    return record;
  }

  /**
   * Regenerates a QR code, invalidating the old token and issuing a fresh active token.
   */
  static async regenerateQr(qrId, { actorUserId = 'SYSTEM', reason = 'Token rotated' } = {}) {
    const oldRecord = await this.revokeQr(qrId, { reason: `Regenerated: ${reason}`, actorUserId });

    // Issue fresh record with same parameters
    return await this.createQrRecord({
      qrType: oldRecord.qrType,
      targetEntityId: oldRecord.targetEntityId,
      organisationId: oldRecord.organisationId,
      cafeId: oldRecord.cafeId,
      title: oldRecord.title,
      metadata: oldRecord.metadata,
      actorUserId,
    });
  }

  static async rotateQr(qrId, options = {}) {
    return await this.regenerateQr(qrId, options);
  }

  /**
   * Generates SVG image markup for a QR record.
   */
  static renderQrSvg(payload, { size = 256, darkColor = '#16223F', lightColor = '#FFFFFF' } = {}) {
    return generateQrSvg(payload, { size, darkColor, lightColor });
  }

  /**
   * Revokes a QR code permanently (convenience alias).
   */
  static async revokeQrRecord(qrId, reason = 'Revoked by administrator', actorUserId = 'SYSTEM') {
    return this.revokeQr(qrId, { reason, actorUserId });
  }

  /**
   * Generates a printable A4 QR Card PDF using Zamorin Corporate Report Standard.
   */
  static renderPrintableQrCardPdf(qrRecord, branding = {}) {
    const { generatePdf } = require('../utils/exportGenerators');
    const legalName = branding.legalName || 'Zamorin Speciality Coffee & Kitchens Pvt. Ltd.';
    const brandName = branding.brandName || 'Zamorin Café';

    const kpiCards = [
      { label: 'QR Type', value: qrRecord.qrType.replace(/_/g, ' ') },
      { label: 'Target Entity', value: qrRecord.targetEntityId },
      { label: 'Status', value: qrRecord.status },
      { label: 'Scan Count', value: String(qrRecord.scanCount || 0) },
    ];

    const columns = [
      { key: 'attribute', label: 'Attribute' },
      { key: 'value', label: 'Value' }
    ];

    const rows = [
      { attribute: 'Official QR ID', value: qrRecord.qrId },
      { attribute: 'Associated Entity', value: qrRecord.targetEntityId },
      { attribute: 'Organisation', value: qrRecord.organisationId },
      { attribute: 'Café Assignment', value: qrRecord.cafeId || 'All Cafés (Global)' },
      { attribute: 'Encoded Payload URL', value: qrRecord.payload },
      { attribute: 'Issuance Date', value: new Date(qrRecord.createdAt).toISOString().slice(0, 10) },
      { attribute: 'Cryptographic HMAC', value: qrRecord.hmacSignature.slice(0, 16) + '...' },
    ];

    return generatePdf({
      reportTitle: `OFFICIAL PRINTABLE QR CARD — ${qrRecord.title}`,
      reportCode: `QR-CARD-${qrRecord.qrType}`,
      columns,
      rows,
      kpiCards,
      period: 'Active Operational Card',
      scope: qrRecord.cafeId || 'Global Establishment',
      branding: {
        legalName,
        brandName,
        gstin: branding.gstin,
      }
    });
  }

  /**
   * A038 / F260: Batch QR Download Filter by Area
   * Generates or fetches QR records batch filtered by dining area or service zone.
   */
  static async batchGenerateQrByArea({
    organisationId = 'ORG-ZAMORIN',
    cafeId,
    areaFilter = null,
    subOrderType = null,
  }) {
    const { UniversalQrRecord } = require('../models/UniversalQrRecord');
    const filter = {
      organisationId,
      status: 'ACTIVE',
    };
    if (cafeId && cafeId !== '*') {
      filter.cafeId = cafeId.toUpperCase();
    }
    if (areaFilter) {
      filter.$or = [
        { 'metadata.area': new RegExp(areaFilter, 'i') },
        { 'metadata.section': new RegExp(areaFilter, 'i') },
        { 'metadata.diningArea': new RegExp(areaFilter, 'i') },
      ];
    }
    if (subOrderType) {
      filter['metadata.subOrderType'] = subOrderType;
    }

    const records = await UniversalQrRecord.find(filter).lean();
    return {
      success: true,
      count: records.length,
      areaFilter: areaFilter || 'ALL',
      subOrderType: subOrderType || 'ALL',
      records: records.map((r) => ({
        qrId: r.qrId,
        targetType: r.targetType,
        targetEntityId: r.targetEntityId,
        area: r.metadata?.area || r.metadata?.diningArea || 'Default',
        section: r.metadata?.section || '',
        qrSvgUrl: `/api/v1/qr/${r.qrId}/svg`,
        cardPdfUrl: `/api/v1/qr/${r.qrId}/card.pdf`,
      })),
    };
  }
}

module.exports = {
  UniversalQrService,
};
