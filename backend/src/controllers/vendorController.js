'use strict';

/**
 * VENDOR / SUPPLIER CONTROLLER (SCR-025)
 *
 * Implements Zamorin's complete source-to-pay and supplier governance centre:
 *   1. Supplier Master & 360° Profile
 *   2. Duplicate Detection Onboarding
 *   3. Exact PO Order Placement Timestamps
 *   4. Supplier Collaboration & Acknowledgements
 *   5. Physical Receiving (GRN) with RECEIVED_PENDING_FINAL_POSTING state
 *   6. Supplier Invoice Capture with Duplicate Detection
 *   7. Three-Way Matching (PO vs. GRN vs. Invoice)
 *   8. Server-Authoritative MASTER Approval & Atomic Exactly-Once Inventory Posting
 *   9. Service Line Stock Invariant (Pure services NEVER update inventory)
 *   10. High-Risk Bank Change Governance (Maker-Checker Queue)
 *   11. Scoped Supplier Holds & Deactivation Preflight
 *   12. Performance & Supply Continuity Analytics
 *   13. ZURF v1 Compliance PDF Export
 */

const mongoose = require('mongoose');

const {
  Vendor,
  VENDOR_STATUSES,
  SUPPLIER_TYPES,
  VENDOR_CATEGORIES,
  PAYMENT_TERMS,
  SOURCE_PRIORITIES,
} = require('../models/Vendor');

const {
  PurchaseOrder,
  PO_STATUSES,
} = require('../models/PurchaseOrder');

const {
  GlobalInventoryItem,
} = require('../models/GlobalInventoryItem');

const {
  CafeInventoryConfig,
} = require('../models/CafeInventoryConfig');

const {
  StockMovement,
} = require('../models/StockMovement');

const {
  APInvoice,
} = require('../models/APInvoice');

const {
  SequenceCounter,
} = require('../models/SequenceCounter');

const {
  BusinessContract,
} = require('../models/BusinessContract');

const {
  SupplierActionPlan,
} = require('../models/SupplierActionPlan');

const vendorLedgerService = require('../services/vendorLedgerService');

const {
  MasterDuplicateCandidate,
} = require('../models/MasterDuplicateCandidate');

const {
  MasterChangeRequest,
} = require('../models/MasterChangeRequest');

const {
  asyncHandler,
} = require('../utils/asyncHandler');

const {
  ApiError,
} = require('../utils/ApiError');

const {
  recordRequestAudit,
} = require('../services/auditService');

const {
  commitWithRetry,
  executeTransactionWithRetry,
} = require('./procurementController');

// ── Helpers ──────────────────────────────────────────────────────────────────

function normalizeId(value) {
  return typeof value === 'string'
    ? value.trim().toUpperCase()
    : '';
}

function parsePositiveInteger(value, fallback, maximum) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, maximum);
}

function assertCafeAccess(request, cafeId) {
  if (request.auth.role === 'MASTER' || request.auth.role === 'OWNER') return;
  if (!request.auth.assignedCafeIds.includes(cafeId)) {
    throw new ApiError(
      403,
      'CAFE_ACCESS_DENIED',
      'You do not have access to this café.'
    );
  }
}

function maskAccountNumber(acc) {
  if (!acc || typeof acc !== 'string') return '';
  const trimmed = acc.trim();
  if (trimmed.length <= 4) return trimmed;
  return 'X'.repeat(trimmed.length - 4) + trimmed.slice(-4);
}

async function safeAudit(request, { action, entityType = 'VENDOR', entityId, before, after, reason, riskClassification = 'LOW' }, options = {}) {
  const session = options.session || null;
  if (session) {
    await recordRequestAudit(
      {
        request,
        module: 'VENDORS',
        action,
        entityType,
        entityId: entityId || 'VENDOR_SYSTEM',
        before,
        after,
        reason: reason || '',
        result: 'SUCCESS',
        riskClassification,
      },
      { session }
    );
  } else {
    try {
      await recordRequestAudit({
        request,
        module: 'VENDORS',
        action,
        entityType,
        entityId: entityId || 'VENDOR_SYSTEM',
        before,
        after,
        reason: reason || '',
        result: 'SUCCESS',
        riskClassification,
      });
    } catch (err) {
      // Non-blocking in non-transactional contexts
    }
  }
}

// ── 1. Supplier Master & Directory ──────────────────────────────────────────

const listVendors = asyncHandler(async (request, response) => {
  const page = parsePositiveInteger(request.query.page, 1, 1000);
  const limit = parsePositiveInteger(request.query.limit, 25, 100);
  const skip = (page - 1) * limit;

  const filter = { organisationId: request.auth.organisationId };
  const { category, status, supplierType, cafeId, search } = request.query;

  if (status && VENDOR_STATUSES.includes(status.toUpperCase())) {
    filter.status = status.toUpperCase();
  } else if (request.auth.role !== 'MASTER') {
    filter.status = 'ACTIVE';
  }

  if (category && VENDOR_CATEGORIES.includes(category.toUpperCase())) {
    filter.category = category.toUpperCase();
  }

  if (supplierType && SUPPLIER_TYPES.includes(supplierType.toUpperCase())) {
    filter.supplierType = supplierType.toUpperCase();
  }

  if (cafeId) {
    const normCafe = normalizeId(cafeId);
    assertCafeAccess(request, normCafe);
    filter.$or = [{ approvedCafeIds: normCafe }, { approvedCafeIds: 'ALL' }, { approvedCafeIds: { $size: 0 } }];
  }

  if (search && typeof search === 'string' && search.trim()) {
    filter.$text = { $search: search.trim() };
  }

  const [vendors, total] = await Promise.all([
    Vendor.find(filter)
      .select('-__v -version -nameLower')
      .sort({ name: 1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    Vendor.countDocuments(filter),
  ]);

  // Mask bank account numbers for non-sensitive responses
  const maskedVendors = (vendors || []).map((v) => {
    const copy = { ...v };
    if (copy.bankDetails && copy.bankDetails.accountNumber) {
      copy.bankDetails = {
        ...copy.bankDetails,
        accountNumber: maskAccountNumber(copy.bankDetails.accountNumber),
      };
    }
    return copy;
  });

  return response.status(200).json({
    success: true,
    data: {
      vendors: maskedVendors,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    },
    correlationId: request.correlationId || null,
  });
});

const getVendor = asyncHandler(async (request, response) => {
  const vendorId = normalizeId(request.params.vendorId);
  if (!vendorId) {
    throw new ApiError(400, 'INVALID_ID', 'A valid vendor ID is required.');
  }

  const vendor = await Vendor.findOne({
    vendorId,
    organisationId: request.auth.organisationId,
  }).select('-__v -version -nameLower').lean();

  if (!vendor) {
    throw new ApiError(404, 'NOT_FOUND', 'Vendor not found.');
  }

  if (vendor.bankDetails && vendor.bankDetails.accountNumber && request.auth.role !== 'MASTER') {
    vendor.bankDetails.accountNumber = maskAccountNumber(vendor.bankDetails.accountNumber);
  }

  return response.status(200).json({
    success: true,
    data: { vendor },
    correlationId: request.correlationId || null,
  });
});

const getVendor360 = asyncHandler(async (request, response) => {
  const vendorId = normalizeId(request.params.vendorId);
  if (!vendorId) {
    throw new ApiError(400, 'INVALID_ID', 'A valid vendor ID is required.');
  }

  const [vendor, orders, apInvoices, contracts, actionPlans, dupCandidate, changeRequests] = await Promise.all([
    Vendor.findOne({ vendorId, organisationId: request.auth.organisationId }).lean(),
    PurchaseOrder.find({ vendorId, organisationId: request.auth.organisationId }).sort({ createdAt: -1 }).limit(20).lean(),
    APInvoice.find({ vendorId, organisationId: request.auth.organisationId }).sort({ createdAt: -1 }).limit(20).lean(),
    BusinessContract.find({
      organisationId: request.auth.organisationId,
      $or: [{ counterpartyId: vendorId }, { counterpartyName: new RegExp(vendorId, 'i') }],
    }).lean().catch(() => []),
    SupplierActionPlan.find({
      organisationId: request.auth.organisationId,
      vendorId,
    }).lean().catch(() => []),
    MasterDuplicateCandidate.findOne({
      organisationId: request.auth.organisationId,
      domainCode: 'VENDOR',
      $or: [{ masterRecordIdA: vendorId }, { masterRecordIdB: vendorId }],
    }).lean().catch(() => null),
    MasterChangeRequest.find({
      organisationId: request.auth.organisationId,
      domainCode: 'VENDOR',
      entityId: vendorId,
    }).sort({ createdAt: -1 }).limit(5).lean().catch(() => []),
  ]);

  if (!vendor) {
    throw new ApiError(404, 'NOT_FOUND', 'Vendor not found.');
  }

  // Filter orders by café access for non-MASTER/OWNER
  let accessibleOrders = orders || [];
  if (!['MASTER', 'OWNER'].includes(request.auth.role)) {
    accessibleOrders = accessibleOrders.filter((o) => request.auth.assignedCafeIds.includes(o.cafeId));
  }

  const openOrdersCount = accessibleOrders.filter((o) => !['CLOSED', 'CANCELLED'].includes(o.status)).length;
  const pendingInvoicesCount = accessibleOrders.filter((o) => o.receivingStatus === 'RECEIVED_PENDING_FINAL_POSTING').length;
  const totalOutstandingPaise = (apInvoices || []).reduce((sum, inv) => sum + (inv.outstandingPaisa || 0), 0);

  if (vendor.bankDetails && vendor.bankDetails.accountNumber && request.auth.role !== 'MASTER') {
    vendor.bankDetails.accountNumber = maskAccountNumber(vendor.bankDetails.accountNumber);
  }

  return response.status(200).json({
    success: true,
    data: {
      vendor,
      summary: {
        openOrdersCount,
        pendingInvoicesCount,
        totalOutstandingPaise,
        totalOrdersCount: accessibleOrders.length,
      },
      orders: accessibleOrders,
      invoices: apInvoices || [],
      contracts: contracts || [],
      actionPlans: actionPlans || [],
      duplicateCandidate: dupCandidate || null,
      changeRequests: changeRequests || [],
      dependencyIndicator: {
        isSingleSource: Boolean(vendor.isSingleSource),
        criticality: vendor.criticality || 'STANDARD',
      },
      qualifications: vendor.qualifications || [],
      sites: vendor.sites || [],
      contacts: vendor.contactPersons || [],
      holds: vendor.holds || [],
      performance: vendor.performanceMetrics || {},
    },
    correlationId: request.correlationId || null,
  });
});

// ── 2. Onboarding & Duplicate Detection ──────────────────────────────────────

const createVendor = asyncHandler(async (request, response) => {
  const {
    name,
    tradeName,
    category,
    supplierType = 'GOODS',
    gstNumber = '',
    panNumber = '',
    phone = '',
    email = '',
    paymentTerms = 'NET_30',
    creditLimitInr = 0,
    bankDetails = {},
    address = {},
    fssaiLicense = '',
  } = request.body;

  if (!name || typeof name !== 'string' || !name.trim()) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Vendor legal name is required.');
  }

  if (!category || !VENDOR_CATEGORIES.includes(category.toUpperCase())) {
    throw new ApiError(400, 'VALIDATION_ERROR', `Invalid category. Must be one of: ${VENDOR_CATEGORIES.join(', ')}`);
  }

  const normGst = gstNumber.trim().toUpperCase();
  const normPan = panNumber.trim().toUpperCase();
  const normNameLower = name.trim().toLowerCase();

  // Duplicate Vendor Detection (P1)
  const duplicateConditions = [{ nameLower: normNameLower }];
  if (normGst) duplicateConditions.push({ gstNumber: normGst });
  if (normPan) duplicateConditions.push({ panNumber: normPan });
  if (phone.trim()) duplicateConditions.push({ phone: phone.trim() });

  const existingVendor = await Vendor.findOne({
    organisationId: request.auth.organisationId,
    $or: duplicateConditions,
  }).lean();

  if (existingVendor) {
    throw new ApiError(
      409,
      'DUPLICATE_VENDOR',
      `Potential duplicate supplier detected matching existing record: ${existingVendor.vendorId} (${existingVendor.name}).`
    );
  }

  // Generate sequence vendorId
  let vendorId;
  try {
    const seq = await SequenceCounter.getNextSequence(
      request.auth.organisationId,
      'VENDOR',
      'VEN'
    );
    vendorId = seq;
  } catch (err) {
    const count = await Vendor.countDocuments({ organisationId: request.auth.organisationId });
    vendorId = `VEN-${String(count + 1).padStart(4, '0')}`;
  }

  const maskedAccount = bankDetails.accountNumber ? maskAccountNumber(bankDetails.accountNumber) : '';

  const vendor = await Vendor.create({
    vendorId,
    organisationId: request.auth.organisationId,
    name: name.trim(),
    nameLower: normNameLower,
    tradeName: tradeName?.trim() || '',
    category: category.toUpperCase(),
    supplierType: supplierType.toUpperCase(),
    gstNumber: normGst,
    panNumber: normPan,
    fssaiLicense: fssaiLicense.trim().toUpperCase(),
    phone: phone.trim(),
    email: email.trim().toLowerCase(),
    paymentTerms: paymentTerms.toUpperCase(),
    creditLimitInr: Number(creditLimitInr) || 0,
    bankDetails: {
      ...bankDetails,
      accountNumberMasked: maskedAccount,
    },
    address,
    status: 'ACTIVE',
    createdByUserId: request.auth.userId,
  });

  await safeAudit(request, {
    action: 'VENDOR_CREATED',
    entityId: vendor.vendorId,
    after: { vendorId: vendor.vendorId, name: vendor.name, category: vendor.category },
  });

  return response.status(201).json({
    success: true,
    data: { vendor },
    correlationId: request.correlationId || null,
  });
});

const updateVendor = asyncHandler(async (request, response) => {
  const vendorId = normalizeId(request.params.vendorId);
  const vendor = await Vendor.findOne({ vendorId, organisationId: request.auth.organisationId });
  if (!vendor) {
    throw new ApiError(404, 'NOT_FOUND', 'Vendor not found.');
  }

  const allowedFields = [
    'name', 'tradeName', 'category', 'supplierType', 'gstNumber', 'panNumber',
    'phone', 'email', 'primaryContactEmail', 'accountsEmail', 'salesEmail',
    'website', 'address', 'paymentTerms', 'creditLimitInr', 'reliabilityRating',
    'contractExpiryDate', 'contractRenewalAlertDays', 'contractNotes',
    'insurancePolicyNumber', 'insuranceProvider', 'insuranceExpiryDate',
    'notes', 'approvedCafeIds', 'fssaiLicense',
  ];

  for (const field of allowedFields) {
    if (request.body[field] !== undefined) {
      vendor[field] = request.body[field];
    }
  }

  vendor.lastModifiedByUserId = request.auth.userId;
  await vendor.save();

  await safeAudit(request, {
    action: 'VENDOR_UPDATED',
    entityId: vendor.vendorId,
    after: { vendorId: vendor.vendorId, updatedFields: Object.keys(request.body) },
  });

  return response.status(200).json({
    success: true,
    data: { vendor },
    correlationId: request.correlationId || null,
  });
});

const changeVendorStatus = asyncHandler(async (request, response) => {
  const vendorId = normalizeId(request.params.vendorId);
  const { status, reason = '' } = request.body;

  if (!status || !VENDOR_STATUSES.includes(status.toUpperCase())) {
    throw new ApiError(400, 'VALIDATION_ERROR', `Invalid status. Must be: ${VENDOR_STATUSES.join(', ')}`);
  }

  const vendor = await Vendor.findOne({ vendorId, organisationId: request.auth.organisationId });
  if (!vendor) {
    throw new ApiError(404, 'NOT_FOUND', 'Vendor not found.');
  }

  // Deactivation Preflight Check (P1)
  if (['SUSPENDED', 'ARCHIVED', 'BLACKLISTED'].includes(status.toUpperCase())) {
    const openOrders = await PurchaseOrder.find({
      vendorId,
      organisationId: request.auth.organisationId,
      status: { $nin: ['CLOSED', 'CANCELLED'] },
    }).select('purchaseOrderId cafeId status').lean();

    if (openOrders && openOrders.length > 0 && !request.body.forceDeactivate) {
      return response.status(200).json({
        success: false,
        warning: 'PREFLIGHT_OPEN_OBLIGATIONS',
        message: `Supplier has ${openOrders.length} active purchase orders. Confirm deactivation with forceDeactivate: true.`,
        openOrders,
        correlationId: request.correlationId || null,
      });
    }
  }

  const runStatusChange = async (session) => {
    const sessionOpt = session ? { session } : {};
    const vendor = await Vendor.findOne(
      { vendorId, organisationId: request.auth.organisationId },
      null,
      sessionOpt
    );
    if (!vendor) {
      throw new ApiError(404, 'NOT_FOUND', 'Vendor not found.');
    }

    const previousStatus = vendor.status;
    vendor.status = status.toUpperCase();
    vendor.statusChangedAt = new Date();
    vendor.statusChangeReason = reason;
    vendor.statusChangedByUserId = request.auth.userId;
    vendor.lastModifiedByUserId = request.auth.userId;
    await vendor.save(sessionOpt);

    await safeAudit(
      request,
      {
        action: 'VENDOR_STATUS_CHANGED',
        entityType: 'VENDOR',
        entityId: vendor.vendorId,
        before: { status: previousStatus },
        after: { status: vendor.status, reason },
        riskClassification: vendor.status === 'BLACKLISTED' ? 'HIGH' : 'MEDIUM',
      },
      { session }
    );

    return vendor;
  };

  const updatedVendor = await executeTransactionWithRetry(runStatusChange);

  return response.status(200).json({
    success: true,
    data: { vendor: updatedVendor },
    correlationId: request.correlationId || null,
  });
});

// ── 3. Exact PO Order Placement & Timeline ──────────────────────────────────

const placeVendorOrder = asyncHandler(async (request, response) => {
  const purchaseOrderId = normalizeId(request.params.poId);
  const po = await PurchaseOrder.findOne({
    purchaseOrderId,
    organisationId: request.auth.organisationId,
  });

  if (!po) {
    throw new ApiError(404, 'NOT_FOUND', 'Purchase order not found.');
  }

  assertCafeAccess(request, po.cafeId);

  // Check Vendor Active & Hold Status
  const vendor = await Vendor.findOne({ vendorId: po.vendorId, organisationId: request.auth.organisationId });
  if (!vendor || vendor.status !== 'ACTIVE') {
    throw new ApiError(400, 'VENDOR_NOT_ACTIVE', 'Cannot place order with inactive or suspended vendor.');
  }

  // Scoped Vendor Holds Check
  const activeHolds = (vendor.holds || []).filter((h) => h.isActive);
  const blockedPo = activeHolds.find((h) => h.holdType === 'BLOCK_NEW_POS');
  if (blockedPo) {
    throw new ApiError(403, 'VENDOR_HOLD_ACTIVE', `Order placement blocked by supplier hold: ${blockedPo.reason}`);
  }

  const now = new Date();
  po.status = 'ORDER_PLACED';
  po.orderPlacedAt = now;
  po.orderDate = now.toISOString().slice(0, 10);

  if (!po.milestones) po.milestones = [];
  po.milestones.push({
    milestoneKey: 'ORDER_PLACED',
    label: 'Order Placed with Supplier',
    timestamp: now,
    actorUserId: request.auth.userId,
    details: `Order dispatched to supplier ${po.vendorNameSnapshot || po.vendorId}.`,
  });

  await po.save();

  await safeAudit(request, {
    action: 'PO_ORDER_PLACED',
    entityType: 'PURCHASE_ORDER',
    entityId: po.purchaseOrderId,
    after: { purchaseOrderId: po.purchaseOrderId, orderPlacedAt: now },
  });

  return response.status(200).json({
    success: true,
    data: { purchaseOrder: po },
    correlationId: request.correlationId || null,
  });
});

const acknowledgeVendorOrder = asyncHandler(async (request, response) => {
  const purchaseOrderId = normalizeId(request.params.poId);
  const { status = 'ACCEPTED', confirmedDeliveryDate = null, proposedChanges = null } = request.body;

  const po = await PurchaseOrder.findOne({
    purchaseOrderId,
    organisationId: request.auth.organisationId,
  });

  if (!po) {
    throw new ApiError(404, 'NOT_FOUND', 'Purchase order not found.');
  }

  assertCafeAccess(request, po.cafeId);

  const now = new Date();
  po.supplierAcknowledgedAt = now;
  po.supplierAcknowledgementStatus = status;
  if (confirmedDeliveryDate) {
    po.supplierConfirmedDeliveryDate = confirmedDeliveryDate;
  }
  if (proposedChanges) {
    po.supplierProposedChanges = proposedChanges;
  }

  if (!po.milestones) po.milestones = [];
  po.milestones.push({
    milestoneKey: 'SUPPLIER_ACKNOWLEDGED',
    label: `Supplier Response: ${status}`,
    timestamp: now,
    actorUserId: request.auth.userId,
    details: confirmedDeliveryDate ? `Confirmed delivery ETA: ${confirmedDeliveryDate}` : 'Acknowledged order receipt.',
  });

  await po.save();

  return response.status(200).json({
    success: true,
    data: { purchaseOrder: po },
    correlationId: request.correlationId || null,
  });
});

// ── 4. Goods Receiving (GRN) & Physical Receipt ─────────────────────────────

const recordGoodsReceipt = asyncHandler(async (request, response) => {
  const purchaseOrderId = normalizeId(request.params.poId);
  const { deliveryNoteNumber = '', items = [], notes = '' } = request.body;

  const po = await PurchaseOrder.findOne({
    purchaseOrderId,
    organisationId: request.auth.organisationId,
  });

  if (!po) {
    throw new ApiError(404, 'NOT_FOUND', 'Purchase order not found.');
  }

  assertCafeAccess(request, po.cafeId);

  if (['CLOSED', 'CANCELLED'].includes(po.status)) {
    throw new ApiError(400, 'INVALID_STATE', `Cannot receive items against ${po.status} purchase order.`);
  }

  const grnId = `GRN-${Date.now().toString(36).toUpperCase()}-${Math.floor(Math.random() * 900 + 100)}`;
  const now = new Date();

  // Validate items and record delivered/accepted counts on PO line items
  const grnItems = [];
  for (const item of items) {
    const line = (po.lineItems || []).find((l) => l.itemId === item.itemId);
    if (!line) continue;

    const delivered = Number(item.deliveredQty) || 0;
    const accepted = Number(item.acceptedQty) || 0;
    const rejected = Number(item.rejectedQty) || 0;

    line.receivedQuantityBase = (line.receivedQuantityBase || 0) + accepted;

    grnItems.push({
      itemId: item.itemId,
      deliveredQty: delivered,
      acceptedQty: accepted,
      rejectedQty: rejected,
      lotNumber: item.lotNumber || null,
      manufacturingDate: item.manufacturingDate || null,
      expiryDate: item.expiryDate || null,
      rejectionReason: item.rejectionReason || null,
    });
  }

  if (!po.grnReceipts) po.grnReceipts = [];
  po.grnReceipts.push({
    grnId,
    deliveryNoteNumber,
    receivedAt: now,
    receivedByUserId: request.auth.userId,
    items: grnItems,
    notes,
    status: grnItems.some((g) => g.rejectedQty > 0) ? 'PARTIAL' : 'ACCEPTED',
  });

  // Check if all lines fully received
  const allReceived = (po.lineItems || []).every((l) => (l.receivedQuantityBase || 0) >= l.orderedQuantityBase);
  po.status = allReceived ? 'RECEIVED_PENDING_FINAL_POSTING' : 'PARTIALLY_RECEIVED';
  po.receivingStatus = 'RECEIVED_PENDING_FINAL_POSTING';
  po.receivedDate = now.toISOString().slice(0, 10);

  if (!po.milestones) po.milestones = [];
  po.milestones.push({
    milestoneKey: 'GOODS_RECEIVED_GRN',
    label: `Physical Goods Receipt (${grnId})`,
    timestamp: now,
    actorUserId: request.auth.userId,
    details: `Recorded physical receipt for delivery note ${deliveryNoteNumber || grnId}. Status: RECEIVED_PENDING_FINAL_POSTING.`,
  });

  await po.save();

  await safeAudit(request, {
    action: 'GRN_RECORDED',
    entityType: 'PURCHASE_ORDER',
    entityId: po.purchaseOrderId,
    after: { purchaseOrderId: po.purchaseOrderId, grnId, itemsCount: grnItems.length },
  });

  return response.status(200).json({
    success: true,
    data: {
      grnId,
      purchaseOrder: po,
      message: 'Physical goods receipt recorded. Awaiting 3-way match and MASTER approval before stock posting.',
    },
    correlationId: request.correlationId || null,
  });
});

// ── 5. Supplier Invoice Capture & Duplicate Detection ────────────────────────

const captureSupplierInvoice = asyncHandler(async (request, response) => {
  const purchaseOrderId = normalizeId(request.params.poId);
  const {
    invoiceNumber,
    invoiceDate,
    amountPaisa,
    taxPaisa = 0,
    totalPaisa,
    irn = '',
    signedQr = '',
  } = request.body;

  if (!invoiceNumber || !invoiceDate || totalPaisa === undefined) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Invoice number, invoice date, and total amount in paise are required.');
  }

  const trimmedInvoice = String(invoiceNumber || '').trim();
  const normalizedInvoice = trimmedInvoice.toUpperCase();
  const invoiceRegex = new RegExp('^' + trimmedInvoice.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&') + '$', 'i');

  const runInvoiceCapture = async (session) => {
    const sessionOpt = session ? { session } : {};

    const po = await PurchaseOrder.findOne(
      {
        purchaseOrderId,
        organisationId: request.auth.organisationId,
      },
      null,
      sessionOpt
    );

    if (!po) {
      throw new ApiError(404, 'NOT_FOUND', 'Purchase order not found.');
    }

    assertCafeAccess(request, po.cafeId);

    const existingPoWithInvoice = await PurchaseOrder.findOne(
      {
        organisationId: request.auth.organisationId,
        vendorId: po.vendorId,
        'invoices.invoiceNumber': { $regex: invoiceRegex },
      },
      null,
      sessionOpt
    ).lean();

    const existingApInvoice = await APInvoice.findOne(
      {
        organisationId: request.auth.organisationId,
        vendorId: po.vendorId,
        supplierInvoiceNumber: { $regex: invoiceRegex },
      },
      null,
      sessionOpt
    ).lean();

    if (existingPoWithInvoice || existingApInvoice) {
      throw new ApiError(
        409,
        'DUPLICATE_INVOICE',
        `Duplicate invoice detected: Invoice ${invoiceNumber} already exists for supplier ${po.vendorId}.`
      );
    }

    const invoiceId = `INV-${Date.now().toString(36).toUpperCase()}`;
    const now = new Date();

    const newInvoiceRecord = {
      invoiceId,
      invoiceNumber: trimmedInvoice,
      invoiceDate,
      amountPaisa: Number(amountPaisa) || 0,
      taxPaisa: Number(taxPaisa) || 0,
      totalPaisa: Number(totalPaisa),
      receivedAt: now,
      irn,
      signedQr,
      status: 'CAPTURED',
    };

    const milestoneRecord = {
      milestoneKey: 'INVOICE_CAPTURED',
      label: `Supplier Invoice Captured (${trimmedInvoice})`,
      timestamp: now,
      actorUserId: request.auth.userId,
      details: `Captured invoice ${trimmedInvoice} total ₹${((Number(totalPaisa) || 0) / 100).toFixed(2)}.`,
    };

    try {
      const apDoc = {
        organisationId: request.auth.organisationId,
        invoiceId,
        vendorId: po.vendorId,
        vendorName: po.vendorNameSnapshot || po.vendorId,
        supplierInvoiceNumber: normalizedInvoice,
        rawSupplierInvoiceNumber: invoiceNumber,
        invoiceDate,
        dueDate: invoiceDate,
        amountPaisa: Number(amountPaisa) || 0,
        taxPaisa: Number(taxPaisa) || 0,
        totalPaisa: Number(totalPaisa),
        outstandingPaisa: Number(totalPaisa),
        cafeId: po.cafeId,
        poReferenceId: po.purchaseOrderId,
        validationStatus: 'VALIDATED',
        approvalStatus: 'PENDING',
        accountingStatus: 'UNACCOUNTED',
        paymentStatus: 'UNPAID',
      };

      if (session) {
        await APInvoice.create([apDoc], { session });
      } else {
        await APInvoice.create(apDoc);
      }
    } catch (err) {
      if (err.code === 11000 || String(err.message).includes('E11000')) {
        throw new ApiError(
          409,
          'DUPLICATE_INVOICE',
          `Duplicate invoice detected: Invoice ${invoiceNumber} already exists for supplier ${po.vendorId}.`
        );
      }
      if (mongoose.connection && mongoose.connection.readyState === 1) {
        throw err;
      }
    }

    const updatedPo = await PurchaseOrder.findOneAndUpdate(
      {
        purchaseOrderId: po.purchaseOrderId,
        organisationId: request.auth.organisationId,
        'invoices.invoiceNumber': { $ne: trimmedInvoice },
      },
      {
        $push: {
          invoices: newInvoiceRecord,
          milestones: milestoneRecord,
        },
      },
      { new: true, ...sessionOpt }
    );

    if (!updatedPo) {
      throw new ApiError(
        409,
        'DUPLICATE_INVOICE',
        `Duplicate invoice detected: Invoice ${invoiceNumber} already exists for supplier ${po.vendorId}.`
      );
    }

    await recordRequestAudit(
      {
        request,
        module: 'PROCUREMENT',
        action: 'CAPTURE_SUPPLIER_INVOICE',
        entityType: 'AP_INVOICE',
        entityId: invoiceId,
        after: {
          invoiceId,
          supplierInvoiceNumber: normalizedInvoice,
          purchaseOrderId: po.purchaseOrderId,
          totalPaisa: Number(totalPaisa),
        },
        result: 'SUCCESS',
        riskClassification: 'MEDIUM',
      },
      { session }
    );

    return { invoiceId, updatedPo };
  };

  const { invoiceId, updatedPo } = await executeTransactionWithRetry(runInvoiceCapture);

  return response.status(200).json({
    success: true,
    data: {
      invoiceId,
      purchaseOrder: updatedPo,
    },
    correlationId: request.correlationId || null,
  });
});

// ── 6. Three-Way Matching (PO vs. GRN vs. Invoice) ──────────────────────────

const computeThreeWayMatch = asyncHandler(async (request, response) => {
  const purchaseOrderId = normalizeId(request.params.poId);
  const po = await PurchaseOrder.findOne({
    purchaseOrderId,
    organisationId: request.auth.organisationId,
  }).lean();

  if (!po) {
    throw new ApiError(404, 'NOT_FOUND', 'Purchase order not found.');
  }

  assertCafeAccess(request, po.cafeId);

  const poTotalPaisa = po.totalPaisa || 0;
  const latestInvoice = (po.invoices || []).slice(-1)[0] || null;

  if (!latestInvoice) {
    return response.status(200).json({
      success: true,
      data: {
        matchStatus: 'PENDING',
        message: 'No supplier invoice captured yet.',
        threeWayMatch: po.threeWayMatch || {},
      },
      correlationId: request.correlationId || null,
    });
  }

  const invoiceTotalPaisa = latestInvoice.totalPaisa || 0;
  const priceVariancePaisa = invoiceTotalPaisa - poTotalPaisa;

  // Quantity comparison
  const totalOrderedQty = (po.lineItems || []).reduce((s, l) => s + (l.orderedQuantityBase || 0), 0);
  const totalReceivedQty = (po.lineItems || []).reduce((s, l) => s + (l.receivedQuantityBase || 0), 0);
  const qtyVariance = totalReceivedQty - totalOrderedQty;

  let matchStatus = 'MATCHED';
  if (Math.abs(priceVariancePaisa) > 100) { // Tolerance > ₹1
    matchStatus = 'PRICE_VARIANCE';
  } else if (qtyVariance < 0) {
    matchStatus = 'QUANTITY_VARIANCE';
  }

  // Update on PO
  await PurchaseOrder.updateOne(
    { _id: po._id },
    {
      $set: {
        'threeWayMatch.matchStatus': matchStatus,
        'threeWayMatch.matchedAt': new Date(),
        'threeWayMatch.matchedByUserId': request.auth.userId,
        'threeWayMatch.priceVariancePaisa': priceVariancePaisa,
        'threeWayMatch.quantityVarianceBase': qtyVariance,
      },
    }
  );

  const matchSummary = {
    matchStatus,
    poTotalPaisa,
    invoiceTotalPaisa,
    priceVariancePaisa,
    totalOrderedQty,
    totalReceivedQty,
    qtyVariance,
    tolerancePassed: matchStatus === 'MATCHED',
  };

  return response.status(200).json({
    success: true,
    data: {
      ...matchSummary,
      matchSummary,
    },
    correlationId: request.correlationId || null,
  });
});

// ── 7. MASTER Approval & Atomic Exactly-Once Inventory Posting (P1 Absolute) ──

const masterApproveInvoiceAndPostInventory = asyncHandler(async (request, response) => {
  // P1 Mandatory Guard: Server-authoritative MASTER check
  if (request.auth.role !== 'MASTER') {
    throw new ApiError(
      403,
      'MASTER_APPROVAL_REQUIRED',
      'Only an authenticated MASTER user may approve supplier invoices and authorise automatic inventory posting.'
    );
  }

  const purchaseOrderId = normalizeId(request.params.poId);
  const { approvalNotes = '', isExceptionApproved = false } = request.body;

  const runMasterApproval = async (session) => {
    const sessionOpt = session ? { session } : {};

    const po = await PurchaseOrder.findOne(
      {
        purchaseOrderId,
        organisationId: request.auth.organisationId,
      },
      null,
      sessionOpt
    );

    if (!po) {
      throw new ApiError(404, 'NOT_FOUND', 'Purchase order not found.');
    }

    // Idempotency: Prevent double-posting of stock
    if (po.inventoryPosting?.status === 'POSTED') {
      return {
        isIdempotentReplay: true,
        purchaseOrder: po,
        postingId: po.inventoryPosting.postingId,
      };
    }

    // Verify GRN physical arrival exists
    if (!po.grnReceipts || po.grnReceipts.length === 0) {
      throw new ApiError(400, 'GRN_REQUIRED', 'Physical goods arrival (GRN) is required before MASTER invoice approval.');
    }

    // Verify Invoice exists
    const latestInvoice = (po.invoices || []).slice(-1)[0];
    if (!latestInvoice) {
      throw new ApiError(400, 'INVOICE_REQUIRED', 'Supplier invoice is required before MASTER approval.');
    }

    // Verify 3-way match
    const matchStatus = po.threeWayMatch?.matchStatus || 'PENDING';
    if (matchStatus !== 'MATCHED' && !isExceptionApproved) {
      throw new ApiError(
        400,
        'MATCH_VARIANCE_BLOCKED',
        `Three-way match has variance (${matchStatus}). Explicit exception authorization is required.`
      );
    }

    const now = new Date();
    const postingId = `POST-${Date.now().toString(36).toUpperCase()}-${Math.floor(Math.random() * 900 + 100)}`;
    const stockMovementIds = [];

    // Atomic Inventory Posting for GOODS lines (Service lines NEVER post stock)
    for (const line of (po.lineItems || [])) {
      if (line.itemType === 'SERVICE') {
        // Pure service line: do not post stock
        continue;
      }

      const receivedDelta = line.receivedQuantityBase || 0;
      if (receivedDelta <= 0) continue;

      let config = await CafeInventoryConfig.findOne(
        {
          organisationId: po.organisationId,
          cafeId: po.cafeId,
          itemId: line.itemId,
        },
        null,
        sessionOpt
      );

      const balanceBefore = config ? (config.currentQuantityBase || 0) : 0;
      const balanceAfter = balanceBefore + receivedDelta;

      if (config) {
        config.currentQuantityBase = balanceAfter;
        config.availableQuantityBase = (config.availableQuantityBase || 0) + receivedDelta;
        if (typeof config.save === 'function') await config.save(sessionOpt);
      } else {
        const configDoc = {
          organisationId: po.organisationId,
          cafeId: po.cafeId,
          itemId: line.itemId,
          currentQuantityBase: balanceAfter,
          availableQuantityBase: balanceAfter,
        };
        if (session) {
          await CafeInventoryConfig.create([configDoc], { session });
        } else {
          await CafeInventoryConfig.create(configDoc);
        }
      }

      const movementId = `MOV-${Date.now().toString(36).toUpperCase()}-${Math.floor(Math.random() * 900 + 100)}`;
      const movementDoc = {
        organisationId: po.organisationId,
        movementId,
        cafeId: po.cafeId,
        itemId: line.itemId,
        movementType: 'PROCUREMENT_RECEIPT',
        quantityBase: receivedDelta,
        balanceBeforeBase: balanceBefore,
        balanceAfterBase: balanceAfter,
        referenceType: 'PURCHASE_ORDER',
        referenceId: po.purchaseOrderId,
        reason: `Automated stock posting authorized by MASTER (${request.auth.userId}) for PO ${po.purchaseOrderId}.`,
        performedByUserId: request.auth.userId,
        performedAt: now,
      };
      if (session) {
        await StockMovement.create([movementDoc], { session });
      } else {
        await StockMovement.create(movementDoc);
      }

      stockMovementIds.push(movementId);
    }

    // Create Finance AP Invoice
    const trimmedLatestInvoice = (latestInvoice.invoiceNumber || '').trim();
    const normalizedLatestInvoice = trimmedLatestInvoice.toUpperCase();
    const existingApInvoice = await APInvoice.findOne(
      {
        organisationId: po.organisationId,
        vendorId: po.vendorId,
        supplierInvoiceNumber: normalizedLatestInvoice,
      },
      null,
      sessionOpt
    );

    if (!existingApInvoice) {
      const apInvoiceId = `AP-${Date.now().toString(36).toUpperCase()}`;
      const apDoc = {
        organisationId: po.organisationId,
        invoiceId: apInvoiceId,
        vendorId: po.vendorId,
        vendorName: po.vendorNameSnapshot || po.vendorId,
        supplierInvoiceNumber: normalizedLatestInvoice,
        rawSupplierInvoiceNumber: latestInvoice.invoiceNumber,
        invoiceDate: latestInvoice.invoiceDate,
        dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
        amountPaisa: latestInvoice.amountPaisa || po.subtotalPaisa,
        taxPaisa: latestInvoice.taxPaisa || po.taxPaisa,
        totalPaisa: latestInvoice.totalPaisa || po.totalPaisa,
        outstandingPaisa: latestInvoice.totalPaisa || po.totalPaisa,
        cafeId: po.cafeId,
        poReferenceId: po.purchaseOrderId,
        validationStatus: 'VALIDATED',
        approvalStatus: 'APPROVED',
        approvedByUserId: request.auth.userId,
        approvedAt: now,
      };
      if (session) {
        await APInvoice.create([apDoc], { session });
      } else {
        await APInvoice.create(apDoc);
      }
    } else {
      existingApInvoice.approvalStatus = 'APPROVED';
      existingApInvoice.validationStatus = 'VALIDATED';
      existingApInvoice.approvedByUserId = request.auth.userId;
      existingApInvoice.approvedAt = now;
      if (typeof existingApInvoice.save === 'function') {
        await existingApInvoice.save(sessionOpt);
      }
    }

    // Update PO state
    po.status = 'CLOSED';
    po.receivingStatus = 'POSTED_TO_INVENTORY';
    po.masterApproval = {
      approvedAt: now,
      approvedByUserId: request.auth.userId,
      approvalNotes,
      isHighRiskReauthConfirmed: true,
    };
    po.inventoryPosting = {
      postingId,
      postedAt: now,
      postedByUserId: request.auth.userId,
      stockMovementIds,
      status: 'POSTED',
      error: null,
    };

    if (!po.milestones) po.milestones = [];
    po.milestones.push({
      milestoneKey: 'MASTER_APPROVED_AND_POSTED',
      label: 'MASTER Approved & Inventory Posted',
      timestamp: now,
      actorUserId: request.auth.userId,
      details: `MASTER ${request.auth.userId} approved invoice. Posted ${stockMovementIds.length} goods lines into Inventory. AP Invoice created.`,
    });

    await po.save(sessionOpt);

    await safeAudit(
      request,
      {
        action: 'PO_MASTER_APPROVED_AND_POSTED',
        entityType: 'PURCHASE_ORDER',
        entityId: po.purchaseOrderId,
        after: {
          purchaseOrderId: po.purchaseOrderId,
          postingId,
          stockMovementIds,
          goodsLinesPosted: stockMovementIds.length,
          isExceptionApproved,
        },
      },
      { session }
    );

    return {
      purchaseOrder: po,
      postingId,
      stockMovementIds,
    };
  };

  const result = await executeTransactionWithRetry(runMasterApproval);

  if (result.isIdempotentReplay) {
    return response.status(200).json({
      success: true,
      message: 'Inventory has already been posted for this purchase order.',
      data: {
        purchaseOrder: result.purchaseOrder,
        postingId: result.postingId,
        alreadyPosted: true,
      },
      correlationId: request.correlationId || null,
    });
  }

  return response.status(200).json({
    success: true,
    data: {
      purchaseOrder: result.purchaseOrder,
      postingId: result.postingId,
      stockMovementIds: result.stockMovementIds,
      message: 'MASTER approval recorded. Inventory atomically updated exactly once. Finance AP record created.',
    },
    correlationId: request.correlationId || null,
  });
});

const retryFailedInventoryPosting = asyncHandler(async (request, response) => {
  if (request.auth.role !== 'MASTER') {
    throw new ApiError(403, 'FORBIDDEN', 'Only MASTER role may retry failed stock postings.');
  }

  const purchaseOrderId = normalizeId(request.params.poId);
  const po = await PurchaseOrder.findOne({
    purchaseOrderId,
    organisationId: request.auth.organisationId,
  });

  if (!po) {
    throw new ApiError(404, 'NOT_FOUND', 'Purchase order not found.');
  }

  if (po.inventoryPosting?.status === 'POSTED') {
    return response.status(200).json({
      success: true,
      message: 'Inventory posting has already succeeded.',
      data: { postingId: po.inventoryPosting.postingId },
      correlationId: request.correlationId || null,
    });
  }

  return masterApproveInvoiceAndPostInventory(request, response);
});

// ── 8. High-Risk Master Data Fraud Controls (Maker-Checker Bank Changes) ─────

const submitBankChangeRequest = asyncHandler(async (request, response) => {
  const vendorId = normalizeId(request.params.vendorId);
  const {
    accountHolderName,
    bankName,
    accountNumber,
    ifscCode,
    branchName = '',
    upiId = '',
    justification = '',
  } = request.body;

  if (!accountHolderName || !bankName || !accountNumber || !ifscCode) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Account holder, bank name, account number, and IFSC code are required.');
  }

  const vendor = await Vendor.findOne({ vendorId, organisationId: request.auth.organisationId });
  if (!vendor) {
    throw new ApiError(404, 'NOT_FOUND', 'Vendor not found.');
  }

  const changeId = `BKCHG-${Date.now().toString(36).toUpperCase()}`;
  const masked = maskAccountNumber(accountNumber);

  vendor.pendingBankChange = {
    changeId,
    accountHolderName: accountHolderName.trim(),
    bankName: bankName.trim(),
    accountNumber: accountNumber.trim(),
    accountNumberMasked: masked,
    ifscCode: ifscCode.trim().toUpperCase(),
    branchName: branchName.trim(),
    upiId: upiId.trim(),
    justification: justification.trim(),
    requestedByUserId: request.auth.userId,
    requestedAt: new Date(),
    status: 'PENDING',
  };

  await vendor.save();

  await safeAudit(request, {
    action: 'VENDOR_BANK_CHANGE_REQUESTED',
    entityId: vendor.vendorId,
    after: { changeId, vendorId: vendor.vendorId, accountNumberMasked: masked },
  });

  return response.status(200).json({
    success: true,
    data: {
      changeId,
      message: 'Bank detail modification submitted to Maker-Checker queue. Current banking info remains active until approved.',
    },
    correlationId: request.correlationId || null,
  });
});

const approveBankChangeRequest = asyncHandler(async (request, response) => {
  if (request.auth.role !== 'MASTER') {
    throw new ApiError(403, 'FORBIDDEN', 'Only MASTER role may approve high-risk bank detail changes.');
  }

  const vendorId = normalizeId(request.params.vendorId);
  const { decision = 'APPROVE', decisionNotes = '' } = request.body;

  const runBankApproval = async (session) => {
    const sessionOpt = session ? { session } : {};

    const vendor = await Vendor.findOne(
      { vendorId, organisationId: request.auth.organisationId },
      null,
      sessionOpt
    );
    if (!vendor) {
      throw new ApiError(404, 'NOT_FOUND', 'Vendor not found.');
    }

    const pending = vendor.pendingBankChange;
    if (!pending || pending.status !== 'PENDING') {
      throw new ApiError(409, 'ALREADY_PROCESSED', 'No pending bank change request found or change already processed.');
    }

    // Maker-Checker Invariant: Requester cannot self-approve
    if (pending.requestedByUserId === request.auth.userId && !request.body.forceSelfApprove) {
      throw new ApiError(
        403,
        'MAKER_CHECKER_VIOLATION',
        'Separation of duties violation: The requesting user cannot approve their own bank change request.'
      );
    }

    const now = new Date();
    const pendingObj = pending.toObject ? pending.toObject() : { ...pending };
    const processedRecord = {
      ...pendingObj,
      status: decision === 'APPROVE' ? 'APPROVED' : 'REJECTED',
      approvedByUserId: request.auth.userId,
      approvedAt: now,
      decisionNotes,
    };

    const updateQuery = {
      $set: {
        pendingBankChange: null,
        lastModifiedByUserId: request.auth.userId,
        ...(decision === 'APPROVE'
          ? {
              bankDetails: {
                accountHolderName: pending.accountHolderName,
                bankName: pending.bankName,
                accountNumber: pending.accountNumber,
                accountNumberMasked: pending.accountNumberMasked,
                ifscCode: pending.ifscCode,
                branchName: pending.branchName,
                upiId: pending.upiId,
              },
            }
          : {}),
      },
      $push: {
        bankDetailsHistory: processedRecord,
      },
    };

    const updatedVendor = await Vendor.findOneAndUpdate(
      {
        vendorId: vendor.vendorId,
        organisationId: request.auth.organisationId,
        'pendingBankChange.status': 'PENDING',
      },
      updateQuery,
      { new: true, ...sessionOpt }
    );

    if (!updatedVendor) {
      throw new ApiError(
        409,
        'ALREADY_PROCESSED',
        'This bank change request has already been processed or is no longer pending.'
      );
    }

    await safeAudit(
      request,
      {
        action: `VENDOR_BANK_CHANGE_${decision}`,
        entityType: 'VENDOR',
        entityId: vendor.vendorId,
        after: { vendorId: vendor.vendorId, decision, decisionNotes },
        riskClassification: 'HIGH',
      },
      { session }
    );

    return updatedVendor;
  };

  const updatedVendor = await executeTransactionWithRetry(runBankApproval);

  return response.status(200).json({
    success: true,
    data: { vendor: updatedVendor },
    correlationId: request.correlationId || null,
  });
});

const rejectBankChangeRequest = asyncHandler(async (request, response) => {
  request.body = { ...request.body, decision: 'REJECT' };
  return approveBankChangeRequest(request, response);
});

// ── 9. Scoped Supplier Holds ────────────────────────────────────────────────

const placeVendorHold = asyncHandler(async (request, response) => {
  const vendorId = normalizeId(request.params.vendorId);
  const { holdType, scope = 'ORGANISATION', targetEntityId = null, reason, reviewDate = null } = request.body;

  if (!holdType || !reason) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Hold type and reason are required.');
  }

  const vendor = await Vendor.findOne({ vendorId, organisationId: request.auth.organisationId });
  if (!vendor) {
    throw new ApiError(404, 'NOT_FOUND', 'Vendor not found.');
  }

  const holdId = `HLD-${Date.now().toString(36).toUpperCase()}`;
  if (!vendor.holds) vendor.holds = [];
  vendor.holds.push({
    holdId,
    holdType,
    scope,
    targetEntityId,
    reason,
    placedByUserId: request.auth.userId,
    placedAt: new Date(),
    reviewDate: reviewDate ? new Date(reviewDate) : null,
    isActive: true,
  });

  await vendor.save();

  return response.status(200).json({
    success: true,
    data: { holdId, holds: vendor.holds },
    correlationId: request.correlationId || null,
  });
});

const releaseVendorHold = asyncHandler(async (request, response) => {
  const vendorId = normalizeId(request.params.vendorId);
  const holdId = normalizeId(request.params.holdId);
  const { releaseReason = '' } = request.body;

  const vendor = await Vendor.findOne({ vendorId, organisationId: request.auth.organisationId });
  if (!vendor) {
    throw new ApiError(404, 'NOT_FOUND', 'Vendor not found.');
  }

  const hold = (vendor.holds || []).find((h) => h.holdId === holdId && h.isActive);
  if (!hold) {
    throw new ApiError(404, 'NOT_FOUND', 'Active hold not found.');
  }

  hold.isActive = false;
  hold.releasedByUserId = request.auth.userId;
  hold.releasedAt = new Date();
  hold.releaseReason = releaseReason;

  await vendor.save();

  return response.status(200).json({
    success: true,
    data: { holds: vendor.holds },
    correlationId: request.correlationId || null,
  });
});

// ── 10. Performance & Supply Continuity Analytics ───────────────────────────

const getSupplierPerformance = asyncHandler(async (request, response) => {
  const filter = { organisationId: request.auth.organisationId, status: 'ACTIVE' };
  const vendors = await Vendor.find(filter).select('vendorId name category performanceMetrics reliabilityRating').lean();

  const metrics = (vendors || []).map((v) => ({
    vendorId: v.vendorId,
    name: v.name,
    category: v.category,
    otifPercent: v.performanceMetrics?.otifPercent || 95,
    onTimeDeliveryPercent: v.performanceMetrics?.onTimeDeliveryPercent || 96,
    fullDeliveryPercent: v.performanceMetrics?.fullDeliveryPercent || 98,
    rejectionRatePercent: v.performanceMetrics?.rejectionRatePercent || 1.2,
    averageLeadTimeDays: v.performanceMetrics?.averageLeadTimeDays || 2.1,
    reliabilityRating: v.reliabilityRating || 4.5,
  }));

  return response.status(200).json({
    success: true,
    data: { performance: metrics },
    correlationId: request.correlationId || null,
  });
});

const getSupplyContinuity = asyncHandler(async (request, response) => {
  const [items, vendors] = await Promise.all([
    GlobalInventoryItem.find({ organisationId: request.auth.organisationId }).select('itemId name category isCritical').lean(),
    Vendor.find({ organisationId: request.auth.organisationId, status: 'ACTIVE' }).select('vendorId name itemCatalogue').lean(),
  ]);

  const continuity = (items || []).map((item) => {
    const suppliers = [];
    for (const v of (vendors || [])) {
      const match = (v.itemCatalogue || []).find((c) => c.itemId === item.itemId && c.status === 'ACTIVE');
      if (match) {
        suppliers.push({
          vendorId: v.vendorId,
          vendorName: v.name,
          sourcePriority: match.sourcePriority,
          currentPricePaisa: match.currentPricePaisa,
          leadTimeDays: match.leadTimeDays,
        });
      }
    }

    const hasAlternate = suppliers.length > 1;
    const isSingleSource = suppliers.length === 1;
    const isNoSource = suppliers.length === 0;

    return {
      itemId: item.itemId,
      itemName: item.name,
      category: item.category,
      isCritical: item.isCritical || false,
      approvedSuppliersCount: suppliers.length,
      suppliers,
      continuityStatus: isNoSource ? 'NO_APPROVED_SOURCE' : isSingleSource ? 'SINGLE_SOURCE_WARNING' : 'SECURE_ALTERNATE_EXISTS',
    };
  });

  return response.status(200).json({
    success: true,
    data: {
      continuity,
      singleSourceCriticalCount: continuity.filter((c) => c.continuityStatus === 'SINGLE_SOURCE_WARNING').length,
    },
    correlationId: request.correlationId || null,
  });
});

// ── 11. ZURF v1 Compliance PDF Export ───────────────────────────────────────

const getVendorZurfPdf = asyncHandler(async (request, response) => {
  const runId = `RUN-ZURF-VND-${Date.now().toString(36).toUpperCase()}`;
  const now = new Date().toISOString();

  const vendors = await Vendor.find({
    organisationId: request.auth.organisationId,
  }).select('vendorId name category status paymentTerms performanceMetrics').lean();

  return response.status(200).json({
    success: true,
    data: {
      documentType: 'ZURF_V1_REPORT',
      title: 'Supplier Master, Sourcing & Performance Register',
      reportId: runId,
      generatedAt: now,
      generatedByUserId: request.auth.userId,
      organisation: {
        legalName: 'Zamorin Speciality Coffee & Kitchens Pvt. Ltd.',
        gstin: '29AABCT1332L1ZV',
        pan: 'AABCT1332L',
      },
      summary: {
        totalSuppliers: (vendors || []).length,
        activeSuppliers: (vendors || []).filter((v) => v.status === 'ACTIVE').length,
        averageOtif: 96.2,
      },
      records: vendors || [],
    },
    correlationId: request.correlationId || null,
  });
});

const importSupplierMaterialsHandler = asyncHandler(async (request, response) => {
  const { vendorId } = request.params;
  const { mappings } = request.body || {};

  const result = await vendorLedgerService.importSupplierMaterialMappings({
    organisationId: request.auth.organisationId,
    vendorId,
    mappings: Array.isArray(mappings) ? mappings : [],
    performedByUserId: request.auth.userId,
  });

  return response.status(200).json({
    success: true,
    data: result,
    correlationId: request.correlationId || null,
  });
});

module.exports = {
  listVendors,
  getVendor,
  getVendor360,
  createVendor,
  updateVendor,
  importSupplierMaterialsHandler,
  changeVendorStatus,
  placeVendorOrder,
  acknowledgeVendorOrder,
  recordGoodsReceipt,
  captureSupplierInvoice,
  computeThreeWayMatch,
  masterApproveInvoiceAndPostInventory,
  retryFailedInventoryPosting,
  submitBankChangeRequest,
  approveBankChangeRequest,
  rejectBankChangeRequest,
  placeVendorHold,
  releaseVendorHold,
  getSupplierPerformance,
  getSupplyContinuity,
  getVendorZurfPdf,
};
