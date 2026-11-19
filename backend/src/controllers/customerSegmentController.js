'use strict';

const { CustomerSegment } = require('../models/CustomerSegment');
const { ApiError } = require('../utils/ApiError');
const { asyncHandler } = require('../utils/asyncHandler');
const SequenceCounter = require('../models/SequenceCounter');

async function listSegments(req, res) {
  const organisationId = req.auth.organisationId;
  const cafeId = req.query.cafeId ? String(req.query.cafeId).trim().toUpperCase() : null;
  const filter = { organisationId, status: 'ACTIVE' };
  if (cafeId && cafeId !== 'ALL') filter.cafeId = cafeId;

  const segments = await CustomerSegment.find(filter).sort({ createdAt: -1 }).lean();
  res.json({ success: true, data: { segments } });
}

async function createSegment(req, res) {
  const organisationId = req.auth.organisationId;
  const { name, description, cafeId, rules } = req.body || {};
  const trimmedName = String(name || '').trim();
  if (!trimmedName) {
    throw new ApiError(400, 'SEGMENT_NAME_REQUIRED', 'Segment name is required.');
  }

  const resolvedCafeId = cafeId ? String(cafeId).trim().toUpperCase() : (req.auth.primaryCafeId || null);
  const existing = await CustomerSegment.findOne({ organisationId, cafeId: resolvedCafeId, name: trimmedName, status: 'ACTIVE' });
  if (existing) {
    throw new ApiError(409, 'SEGMENT_NAME_EXISTS', 'A segment with that name already exists for this café.');
  }

  let segmentId;
  try {
    segmentId = await SequenceCounter.generateId({
      organisationId,
      sequenceKey: 'CUSTOMER_SEGMENT',
      prefix: 'SEG',
      minimumDigits: 6,
    });
  } catch (err) {
    segmentId = `SEG-${Date.now()}`;
  }

  const segment = await CustomerSegment.create({
    segmentId,
    organisationId,
    cafeId: resolvedCafeId,
    name: trimmedName,
    description: String(description || '').trim().slice(0, 500),
    rules: {
      minVisitsPerMonth: Number(rules?.minVisitsPerMonth || rules?.minVisits || 0) || 0,
      minSpendPaisa: Number(rules?.minSpendPaisa || (rules?.minSpend ? Math.round(Number(rules.minSpend) * 100) : 0)) || 0,
      maxDaysSinceLastVisit: Number(rules?.maxDaysSinceLastVisit || 0) || 0,
    },
    createdBy: req.auth.userId,
  });

  res.status(201).json({
    success: true,
    message: 'Customer segment created.',
    data: { segment: segment.toObject() },
  });
}

async function deleteSegment(req, res) {
  const organisationId = req.auth.organisationId;
  const segmentId = String(req.params.segmentId || '').trim().toUpperCase();
  const segment = await CustomerSegment.findOne({ segmentId, organisationId });
  if (!segment) {
    throw new ApiError(404, 'SEGMENT_NOT_FOUND', 'Customer segment not found.');
  }
  segment.status = 'ARCHIVED';
  await segment.save();
  res.json({ success: true, message: 'Customer segment archived.' });
}

module.exports = {
  listSegments: asyncHandler(listSegments),
  createSegment: asyncHandler(createSegment),
  deleteSegment: asyncHandler(deleteSegment),
};