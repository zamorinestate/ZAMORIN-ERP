'use strict';

/**
 * ============================================================================
 * ZAMORIN CAFÉ ERP — PROCUREMENT APPROVAL & REVISION SERVICE (P07)
 * ============================================================================
 *
 * Implements:
 * 1. P06 Replenishment Recommendation conversion to server-authoritative PO drafts
 * 2. Immutable PO revision management (edits create new revision, invalidate past approvals)
 * 3. Dynamic authority boundary checking (Café Operations scoped thresholds, Primary Master exceptions, Owner/Staff denied)
 * 4. Atomic approval + dispatch outbox queueing using executeTransactionWithRetry
 * 5. Commercial and stock revalidation before purchasing commitment
 * 6. Alternative supplier evaluation using P05 approved vendor mappings
 * 7. Vendor response tracking strictly isolated from physical inventory & financial postings
 */

const crypto = require('crypto');
const { PurchaseOrder, PO_STATUSES } = require('../models/PurchaseOrder');
const { ProcurementDispatchJob } = require('../models/ProcurementDispatchJob');
const { ReplenishmentRecommendation } = require('../models/ReplenishmentRecommendation');
const { GlobalInventoryItem } = require('../models/GlobalInventoryItem');
const { CafeInventoryConfig } = require('../models/CafeInventoryConfig');
const { Vendor } = require('../models/Vendor');
const { Cafe } = require('../models/Cafe');
const { User } = require('../models/User');
const { ApprovalPolicyService } = require('./approvalPolicyService');
const { validateItemDataQuality } = require('./dataFoundationService');
const { executeTransactionWithRetry } = require('../utils/transactionHelper');
const { recordRequestAudit } = require('./auditService');
const { ApiError } = require('../utils/ApiError');

function normalizeId(val) {
  return typeof val === 'string' ? val.trim().toUpperCase() : '';
}


function computePurchasingSnapshot(order, targetRevisionNumber = null) {
  const revNum = targetRevisionNumber || order.currentRevision || 1;
  const rev = (order.revisions || []).find((r) => r.revisionNumber === revNum);
  const lineItems = (rev ? rev.lineItems : order.lineItems) || [];

  const lines = lineItems.map((li) => ({
    itemId: String(li.itemId || '').trim().toUpperCase(),
    orderedQuantityBase: Number(li.orderedQuantityBase || 0),
    baseUnit: String(li.baseUnit || '').trim().toLowerCase(),
    packSize: String(li.packSize || '').trim(),
    unitPricePaisa: Number(li.unitPricePaisa || 0),
    totalLinePaisa: Number(li.totalLinePaisa || 0),
  })).sort((a, b) => a.itemId.localeCompare(b.itemId));

  const recipientEmail = String(
    (rev && (rev.vendorContactEmail || rev.recipientEmail)) ||
    order.vendorContactEmail ||
    order.recipientEmail ||
    ''
  ).trim().toLowerCase();

  return {
    purchaseOrderId: String(order.purchaseOrderId || '').trim().toUpperCase(),
    revisionNumber: revNum,
    cafeId: String(order.cafeId || '').trim().toUpperCase(),
    vendorId: String(order.vendorId || '').trim().toUpperCase(),
    deliveryAddress: String((rev && rev.deliveryAddress) || order.deliveryAddress || '').trim(),
    recipientEmail,
    subtotalPaisa: Number((rev && rev.subtotalPaisa) !== undefined ? rev.subtotalPaisa : order.subtotalPaisa || 0),
    taxPaisa: Number((rev && rev.taxPaisa) !== undefined ? rev.taxPaisa : order.taxPaisa || 0),
    totalPaisa: Number((rev && rev.totalPaisa) !== undefined ? rev.totalPaisa : order.totalPaisa || 0),
    lines,
  };
}

function computePurchasingFingerprint(order, targetRevisionNumber = null) {
  return computeFingerprint(computePurchasingSnapshot(order, targetRevisionNumber));
}

function computeFingerprint(payload) {
  return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

class ProcurementApprovalService {
  /**
   * Asserts user account and role authority at the mutation boundary.
   */
  static async assertPurchasingAuthority(auth, cafeId, action = 'APPROVE') {
    if (!auth || !auth.userId) {
      throw new ApiError(401, 'UNAUTHORIZED', 'Authentication is required.');
    }

    // Reload active user state from MongoDB to prevent stale tokens/permissions
    const user = await User.findOne({
      userId: normalizeId(auth.userId),
      organisationId: normalizeId(auth.organisationId),
    }).lean();

    if (!user || user.accountStatus !== 'ACTIVE') {
      throw new ApiError(403, 'ACCOUNT_INACTIVE', 'User account is inactive, suspended, or not found.');
    }

    const role = normalizeId(user.role);

    // Rule: Staff is completely excluded from procurement mutations
    if (role === 'STAFF') {
      throw new ApiError(403, 'FORBIDDEN_ROLE', 'Staff members are strictly excluded from purchasing operations.');
    }

    // Rule: Owner is strategic/read-only by default; purchasing mutation authority is prohibited
    if (role === 'OWNER') {
      throw new ApiError(403, 'FORBIDDEN_ROLE', 'Owner persona is strategic/read-only for procurement mutations. Purchasing authority belongs to Café Operations or Primary Master.');
    }

    // Rule: Primary Master has org-wide exception and approval authority
    if (role === 'MASTER') {
      return { authorized: true, isPrimaryMaster: Boolean(user.isPrimaryMaster || user.role === 'MASTER'), user };
    }

    // Rule: Café Operations must belong to the explicitly selected café
    if (role === 'CAFE_ADMIN') {
      const cleanTargetCafe = normalizeId(cafeId);
      const primaryCafe = normalizeId(user.primaryCafeId);
      const assignedCafes = Array.isArray(user.assignedCafeIds)
        ? user.assignedCafeIds.map(normalizeId)
        : [];

      const hasCafeAccess = primaryCafe === cleanTargetCafe || assignedCafes.includes(cleanTargetCafe);
      if (!hasCafeAccess) {
        throw new ApiError(403, 'CROSS_CAFE_ACCESS_DENIED', `User ${user.userId} does not have purchasing authority for café ${cleanTargetCafe}.`);
      }

      return { authorized: true, isPrimaryMaster: false, user };
    }

    throw new ApiError(403, 'FORBIDDEN_ROLE', `Role ${role} is not permitted to perform purchasing operations.`);
  }

  /**
   * Converts valid P06 replenishment recommendations into server-authoritative PO drafts.
   */
  static async createDraftFromRecommendations({
    organisationId,
    cafeId,
    recommendationIds,
    auth,
    request = null,
  }) {
    const cleanOrg = normalizeId(organisationId);
    const cleanCafe = normalizeId(cafeId);

    if (!cleanOrg || !cleanCafe) {
      throw new ApiError(400, 'VALIDATION_FAILED', 'organisationId and cafeId are required.');
    }

    if (!Array.isArray(recommendationIds) || recommendationIds.length === 0) {
      throw new ApiError(400, 'VALIDATION_FAILED', 'At least one recommendationId is required.');
    }

    await this.assertPurchasingAuthority(auth, cleanCafe, 'CREATE_DRAFT');

    // 1. Reload recommendations fresh from MongoDB
    const cleanRecIds = recommendationIds.map((id) => String(id).trim().toUpperCase());
    const recommendations = await ReplenishmentRecommendation.find({
      organisationId: cleanOrg,
      cafeId: cleanCafe,
      recommendationId: { $in: cleanRecIds },
      status: 'ACTIVE_REVIEW',
      isActiveNeed: true,
    });

    if (recommendations.length === 0) {
      throw new ApiError(404, 'RECOMMENDATIONS_NOT_FOUND', 'No active, reviewable recommendations found matching the provided IDs.');
    }

    // 2. Fetch Café Master data (for delivery address)
    const cafeDoc = await Cafe.findOne({ organisationId: cleanOrg, cafeId: cleanCafe }).lean();
    const deliveryAddress = cafeDoc?.address
      ? typeof cafeDoc.address === 'string'
        ? cafeDoc.address
        : `${cafeDoc.address.street || ''}, ${cafeDoc.address.city || ''}, ${cafeDoc.address.postalCode || ''}`.trim()
      : `Zamorin Café ${cleanCafe}`;

    // 3. Group recommendations by Vendor
    const vendorGroups = new Map(); // vendorId -> [rec]
    for (const rec of recommendations) {
      const vendorId = normalizeId(rec.supplierCandidate?.vendorId);
      if (!vendorId) {
        throw new ApiError(400, 'MISSING_VENDOR_MAPPING', `Recommendation ${rec.recommendationId} for item ${rec.itemId} does not have a mapped approved vendor.`);
      }

      // Revalidate Item Data Quality
      const dqResult = await validateItemDataQuality({
        organisationId: cleanOrg,
        cafeId: cleanCafe,
        itemId: rec.itemId,
      });

      if (!dqResult.isAutomaticPurchasingEligible) {
        throw new ApiError(400, 'DATA_QUALITY_INVALID', `Item ${rec.itemId} is no longer eligible for purchasing: ${dqResult.errors.join(', ')}`);
      }

      if (!vendorGroups.has(vendorId)) {
        vendorGroups.set(vendorId, []);
      }
      vendorGroups.get(vendorId).push(rec);
    }

    const createdOrders = [];

    // 4. Create authoritative PO draft for each Vendor group
    for (const [vendorId, recList] of vendorGroups.entries()) {
      const vendorDoc = await Vendor.findOne({
        organisationId: cleanOrg,
        vendorId,
        status: 'ACTIVE',
      }).lean();

      if (!vendorDoc) {
        throw new ApiError(400, 'VENDOR_INACTIVE_OR_NOT_FOUND', `Vendor ${vendorId} is not active or approved.`);
      }

      const datePart = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      const randHex = crypto.randomBytes(3).toString('hex').toUpperCase();
      const purchaseOrderId = `PO-${datePart}-${cleanCafe}-${randHex}`;

      const lineItems = [];
      let subtotalPaisa = 0;

      for (const rec of recList) {
        const itemDoc = await GlobalInventoryItem.findOne({
          organisationId: cleanOrg,
          itemId: rec.itemId,
          status: 'ACTIVE',
        }).lean();

        if (!itemDoc) {
          throw new ApiError(400, 'ITEM_INACTIVE', `Item ${rec.itemId} is no longer active.`);
        }

        const qtyBase = Number(rec.calculation?.suggestedBaseQuantity || 0);
        const uomFactor = Number(rec.calculation?.conversionFactor || 1);
        const contractedPricePaisa = Number(rec.supplierCandidate?.contractedPricePaisa || 0);
        const purchaseQty = Number(rec.calculation?.suggestedPurchaseQuantity || (qtyBase / uomFactor));
        const totalLinePaisa = Math.round(purchaseQty * contractedPricePaisa);

        subtotalPaisa += totalLinePaisa;

        lineItems.push({
          itemId: rec.itemId,
          itemNameSnapshot: itemDoc.name || rec.itemSnapshot?.name || rec.itemId,
          itemType: 'GOODS',
          supplierItemCode: rec.supplierCandidate?.supplierItemCode || '',
          packSize: `${uomFactor} ${rec.itemSnapshot?.baseUnit || 'unit'}`,
          uomConversionFactor: uomFactor,
          baseUnit: rec.itemSnapshot?.baseUnit || itemDoc.baseUnit || 'unit',
          orderedQuantityBase: qtyBase,
          receivedQuantityBase: 0,
          acceptedReceivedQty: 0,
          rejectedQty: 0,
          outstandingQty: qtyBase,
          fulfillmentStatus: 'ORDERED',
          unitPricePaisa: contractedPricePaisa,
          totalLinePaisa,
          lineNotes: `Generated from recommendation ${rec.recommendationId}`,
        });
      }

      // GST / Tax derivation
      const taxPaisa = Math.round(subtotalPaisa * 0.05); // Standard 5% GST on café supplies
      const totalPaisa = subtotalPaisa + taxPaisa;

      const initialRevision = {
        revisionNumber: 1,
        status: 'DRAFT',
        createdAt: new Date(),
        createdByUserId: auth.userId,
        changeReason: 'Initial revision derived from P06 replenishment recommendations',
        lineItems,
        subtotalPaisa,
        taxPaisa,
        discountPaisa: 0,
        totalPaisa,
        vendorId,
        vendorNameSnapshot: vendorDoc.name || '',
        vendorContactEmail: vendorDoc.contactEmail || vendorDoc.email || '',
        expectedDeliveryDate: null,
        deliveryAddress,
        terms: vendorDoc.paymentTerms || 'Standard Payment Terms',
        notes: `Converted from ${recList.length} replenishment recommendations.`,
        approval: null,
        dispatchJobId: null,
        documentHash: null,
      };

      const runDraftCreation = async (session) => {
        const sessionOpt = session ? { session } : {};

        // Create PO
        const order = new PurchaseOrder({
          purchaseOrderId,
          organisationId: cleanOrg,
          cafeId: cleanCafe,
          vendorId,
          vendorNameSnapshot: vendorDoc.name || '',
          lineItems,
          subtotalPaisa,
          taxPaisa,
          totalPaisa,
          status: 'DRAFT',
          currentRevision: 1,
          activeApprovedRevision: null,
          revisions: [initialRevision],
          sourceRecommendationIds: recList.map((r) => r.recommendationId),
          dispatchStatus: 'NOT_QUEUED',
          vendorResponseStatus: 'AWAITING_RESPONSE',
          createdByUserId: auth.userId,
        });

        await order.save(sessionOpt);

        // Update recommendations to CONVERTED
        for (const rec of recList) {
          rec.status = 'CONVERTED';
          rec.isActiveNeed = false;
          rec.activeNeedKey = null;
          rec.convertedPurchaseOrderId = purchaseOrderId;
          rec.convertedRevisionNumber = 1;
          await rec.save(sessionOpt);
        }

        if (request) {
          await recordRequestAudit(
            {
              request,
              module: 'PROCUREMENT',
              action: 'RECOMMENDATION_CONVERTED_TO_DRAFT',
              entityType: 'PURCHASE_ORDER',
              entityId: purchaseOrderId,
              before: null,
              after: {
                purchaseOrderId,
                vendorId,
                totalPaisa,
                recommendationCount: recList.length,
              },
              result: 'SUCCESS',
              riskClassification: 'LOW',
            },
            sessionOpt
          );
        }

        return order;
      };

      const order = await executeTransactionWithRetry(runDraftCreation);
      createdOrders.push(order);
    }

    return createdOrders;
  }

  /**
   * Revalidates stock and commercial requirements immediately before approval.
   */
  static async revalidatePurchasingRequirements(order) {
    const cleanOrg = order.organisationId;
    const cleanCafe = order.cafeId;

    for (const line of order.lineItems) {
      const config = await CafeInventoryConfig.findOne({
        organisationId: cleanOrg,
        cafeId: cleanCafe,
        itemId: line.itemId,
      }).lean();

      if (!config) continue;

      // Re-check: has stock already risen to meet or exceed max/par stock?
      const currentUsable = Number(config.currentQuantityBase || 0);
      const reorderPoint = Number(config.minQuantityBase || 0);

      if (config.maxQuantityBase > 0 && currentUsable >= config.maxQuantityBase) {
        throw new ApiError(
          409,
          'PURCHASE_REQUIREMENT_CHANGED',
          `Item ${line.itemId} usable stock has increased to ${currentUsable} ${line.baseUnit}, reaching or exceeding maximum limit (${config.maxQuantityBase} ${line.baseUnit}). The purchasing need has changed. Review updated requirements before approving.`
        );
      }
    }

    // Verify vendor remains active
    const vendor = await Vendor.findOne({
      organisationId: cleanOrg,
      vendorId: order.vendorId,
      status: 'ACTIVE',
    }).lean();

    if (!vendor) {
      throw new ApiError(409, 'VENDOR_ELIGIBILITY_INVALID', `Vendor ${order.vendorId} is not active or approved.`);
    }

    return true;
  }

  /**
   * Edits order fields and creates a new immutable revision if material terms change.
   */
  static async editOrderRevision({
    purchaseOrderId,
    lineItems,
    expectedDeliveryDate,
    notes,
    reason,
    auth,
    request = null,
  }) {
    const cleanPoId = normalizeId(purchaseOrderId);
    const order = await PurchaseOrder.findOne({ purchaseOrderId: cleanPoId });

    if (!order) {
      throw new ApiError(404, 'NOT_FOUND', `Purchase order ${cleanPoId} not found.`);
    }

    await this.assertPurchasingAuthority(auth, order.cafeId, 'EDIT');

    if (['CLOSED', 'CANCELLED'].includes(order.status)) {
      throw new ApiError(409, 'INVALID_STATUS', `Cannot edit order in ${order.status} status.`);
    }

    const wasApproved = order.status === 'APPROVED' || order.activeApprovedRevision !== null;
    const previousRevisionNumber = order.currentRevision;

    // Process line item updates if provided
    let updatedLineItems = order.lineItems;
    let subtotalPaisa = order.subtotalPaisa;

    if (Array.isArray(lineItems) && lineItems.length > 0) {
      updatedLineItems = [];
      subtotalPaisa = 0;

      for (const li of lineItems) {
        const item = await GlobalInventoryItem.findOne({
          organisationId: order.organisationId,
          itemId: normalizeId(li.itemId),
          status: 'ACTIVE',
        }).lean();

        if (!item) {
          throw new ApiError(400, 'ITEM_NOT_FOUND', `Active item ${li.itemId} not found.`);
        }

        const qty = Number(li.orderedQuantityBase);
        if (!Number.isFinite(qty) || qty <= 0) {
          throw new ApiError(400, 'INVALID_QUANTITY', `Quantity for item ${li.itemId} must be positive.`);
        }

        // Keep authoritative unit price
        const existingLine = order.lineItems.find((l) => l.itemId === normalizeId(li.itemId));
        const unitPricePaisa = existingLine ? existingLine.unitPricePaisa : (item.unitCostPaisa || 0);
        const totalLinePaisa = Math.round(qty * unitPricePaisa);

        subtotalPaisa += totalLinePaisa;

        updatedLineItems.push({
          itemId: item.itemId,
          itemNameSnapshot: item.name,
          itemType: 'GOODS',
          supplierItemCode: existingLine?.supplierItemCode || '',
          packSize: existingLine?.packSize || '1 UNIT',
          uomConversionFactor: existingLine?.uomConversionFactor || 1,
          baseUnit: item.baseUnit,
          orderedQuantityBase: qty,
          receivedQuantityBase: 0,
          acceptedReceivedQty: 0,
          rejectedQty: 0,
          outstandingQty: qty,
          fulfillmentStatus: 'ORDERED',
          unitPricePaisa,
          totalLinePaisa,
          lineNotes: String(li.lineNotes || '').trim(),
        });
      }
    }

    const taxPaisa = Math.round(subtotalPaisa * 0.05);
    const totalPaisa = subtotalPaisa + taxPaisa;

    const runEditTransaction = async (session) => {
      const sessionOpt = session ? { session } : {};

      if (wasApproved) {
        // Material change after approval: create new revision and revoke previous approval authority
        const nextRevNumber = previousRevisionNumber + 1;
        order.currentRevision = nextRevNumber;
        order.activeApprovedRevision = null;
        order.status = 'SUBMITTED';
        order.needsReapproval = true;
        order.dispatchStatus = 'NOT_QUEUED';

        // Cancel previous queued dispatch job if it was not yet claimed/sent
        await ProcurementDispatchJob.updateMany(
          {
            purchaseOrderId: cleanPoId,
            revisionNumber: previousRevisionNumber,
            status: { $in: ['QUEUED', 'CLAIMED'] },
          },
          {
            $set: {
              status: 'CANCELLED',
              reconciliationNotes: `Superseded by Revision ${nextRevNumber} created by ${auth.userId}`,
            },
          },
          sessionOpt
        );

        // Mark previous revision as SUPERSEDED in history
        const prevRev = order.revisions.find((r) => r.revisionNumber === previousRevisionNumber);
        if (prevRev) {
          prevRev.status = 'SUPERSEDED';
        }

        // Add new revision snapshot
        order.revisions.push({
          revisionNumber: nextRevNumber,
          status: 'SUBMITTED',
          createdAt: new Date(),
          createdByUserId: auth.userId,
          changeReason: String(reason || 'Material modifications requiring re-approval').trim(),
          lineItems: updatedLineItems,
          subtotalPaisa,
          taxPaisa,
          discountPaisa: 0,
          totalPaisa,
          vendorId: order.vendorId,
          vendorNameSnapshot: order.vendorNameSnapshot,
          expectedDeliveryDate: expectedDeliveryDate || order.expectedDeliveryDate,
          notes: notes !== undefined ? String(notes).trim() : order.notes,
          approval: null,
          dispatchJobId: null,
          documentHash: null,
        });
      } else {
        // Edit before approval: update current revision in-place
        const currRev = order.revisions.find((r) => r.revisionNumber === order.currentRevision);
        if (currRev) {
          currRev.lineItems = updatedLineItems;
          currRev.subtotalPaisa = subtotalPaisa;
          currRev.taxPaisa = taxPaisa;
          currRev.totalPaisa = totalPaisa;
          if (expectedDeliveryDate) currRev.expectedDeliveryDate = expectedDeliveryDate;
          if (notes !== undefined) currRev.notes = String(notes).trim();
          currRev.changeReason = String(reason || currRev.changeReason).trim();
        }
      }

      order.lineItems = updatedLineItems;
      order.subtotalPaisa = subtotalPaisa;
      order.taxPaisa = taxPaisa;
      order.totalPaisa = totalPaisa;
      if (expectedDeliveryDate) order.expectedDeliveryDate = expectedDeliveryDate;
      if (notes !== undefined) order.notes = String(notes).trim();
      order.lastModifiedByUserId = auth.userId;

      await order.save(sessionOpt);

      if (request) {
        await recordRequestAudit(
          {
            request,
            module: 'PROCUREMENT',
            action: wasApproved ? 'PURCHASE_ORDER_REVISION_PROMOTED' : 'PURCHASE_ORDER_EDITED',
            entityType: 'PURCHASE_ORDER',
            entityId: cleanPoId,
            before: { revision: previousRevisionNumber, wasApproved },
            after: { revision: order.currentRevision, status: order.status, totalPaisa },
            result: 'SUCCESS',
            riskClassification: wasApproved ? 'MEDIUM' : 'LOW',
          },
          sessionOpt
        );
      }

      return order;
    };

    return await executeTransactionWithRetry(runEditTransaction);
  }

  /**
   * Approves the exact PO revision and atomically queues a durable dispatch outbox job.
   */
  static async approveAndQueueDispatch({
    purchaseOrderId,
    revisionNumber,
    notes = '',
    idempotencyKey = null,
    expectedSnapshotFingerprint = null,
    expectedVersion = null,
    auth,
    request = null,
  }) {
    const cleanPoId = normalizeId(purchaseOrderId);
    const targetRevNum = Number(revisionNumber);

    if (!cleanPoId || !Number.isInteger(targetRevNum) || targetRevNum < 1) {
      throw new ApiError(400, 'VALIDATION_FAILED', 'purchaseOrderId and positive integer revisionNumber are required.');
    }

    const order = await PurchaseOrder.findOne({ purchaseOrderId: cleanPoId });
    if (!order) {
      throw new ApiError(404, 'NOT_FOUND', `Purchase order ${cleanPoId} not found.`);
    }

    const authResult = await this.assertPurchasingAuthority(auth, order.cafeId, 'APPROVE');

    // Idempotency: If this exact revision was already approved, return existing authoritative commitment
    if (order.status === 'APPROVED' && order.activeApprovedRevision === targetRevNum) {
      const existingJob = await ProcurementDispatchJob.findOne({
        purchaseOrderId: cleanPoId,
        revisionNumber: targetRevNum,
      });

      return {
        alreadyApproved: true,
        order,
        dispatchJob: existingJob,
        message: `Revision ${targetRevNum} is already approved and queued for dispatch.`,
      };
    }


    // Atomically compare expected reviewed content fingerprint or version snapshot
    const currentFingerprint = computePurchasingFingerprint(order, targetRevNum);
    if (expectedSnapshotFingerprint && expectedSnapshotFingerprint !== currentFingerprint) {
      throw new ApiError(
        409,
        'PURCHASING_SNAPSHOT_STALE',
        'Purchasing details were modified after review screen loaded. Please refresh and review updated quantities, rates, or suppliers before approving.'
      );
    }
    if (expectedVersion !== null && expectedVersion !== undefined && order.currentRevision !== Number(expectedVersion)) {
      throw new ApiError(
        409,
        'PURCHASING_VERSION_CONFLICT',
        `Order version conflict. Expected version ${expectedVersion} but found ${order.currentRevision}.`
      );
    }

    // Revision check: cannot approve an outdated revision
    if (order.currentRevision !== targetRevNum) {
      throw new ApiError(
        409,
        'REVISION_SUPERSEDED',
        `Cannot approve Revision ${targetRevNum}. The purchase order is currently on Revision ${order.currentRevision}.`
      );
    }

    // Policy Threshold Check for Café Admin
    const userRole = normalizeId(authResult.user.role);
    if (userRole === 'CAFE_ADMIN') {
      const limit = await ApprovalPolicyService.getEffectiveLimit({
        organisationId: order.organisationId,
        cafeId: order.cafeId,
        workflowType: 'PURCHASE_ORDER',
        role: 'CAFE_ADMIN',
      });

      if (limit !== null && order.totalPaisa > limit) {
        // Order exceeds normal Café Operations authority: escalate to Primary Master
        order.status = 'ESCALATED_PENDING_MASTER';
        order.approvalNotes = `Escalated to Primary Master: order amount ₹${(order.totalPaisa / 100).toLocaleString('en-IN')} exceeds threshold (₹${(limit / 100).toLocaleString('en-IN')}).`;
        await order.save();

        if (request) {
          await recordRequestAudit({
            request,
            module: 'PROCUREMENT',
            action: 'PURCHASE_ORDER_ESCALATED',
            entityType: 'PURCHASE_ORDER',
            entityId: cleanPoId,
            before: { status: 'SUBMITTED' },
            after: { status: 'ESCALATED_PENDING_MASTER', totalPaisa: order.totalPaisa },
            result: 'SUCCESS',
            riskClassification: 'HIGH',
          });
        }

        throw new ApiError(
          403,
          'APPROVAL_THRESHOLD_EXCEEDED',
          `Order total ₹${(order.totalPaisa / 100).toLocaleString('en-IN')} exceeds Café Operations financial authority limit of ₹${(limit / 100).toLocaleString('en-IN')}. Order has been escalated to Primary Master.`
        );
      }
    }

    // Revalidate underlying stock and vendor before commitment
    await this.revalidatePurchasingRequirements(order);

    // Fetch vendor email for dispatch
    const vendor = await Vendor.findOne({
      organisationId: order.organisationId,
      vendorId: order.vendorId,
    }).lean();

    const recipientEmail = vendor?.contactEmail || vendor?.email || `${order.vendorId.toLowerCase()}@vendor.zamorin.local`;

    const effectiveIdempotencyKey =
      idempotencyKey ||
      request?.headers?.['idempotency-key'] ||
      `DISPATCH-${cleanPoId}-R${targetRevNum}`;

    const dispatchJobId = `DISPATCH-${cleanPoId}-R${targetRevNum}-${Date.now()}`;

    // Atomically approve PO revision and create durable dispatch job
    const runAtomicApproval = async (session) => {
      const sessionOpt = session ? { session } : {};

      // Atomically compare expected reviewed content fingerprint or version snapshot inside transaction write
      const freshOrder = await PurchaseOrder.findOne({ purchaseOrderId: cleanPoId }, null, sessionOpt);
      const targetDoc = freshOrder || order;
      const currentFingerprint = computePurchasingFingerprint(targetDoc, targetRevNum);
      if (expectedSnapshotFingerprint && expectedSnapshotFingerprint !== currentFingerprint) {
        throw new ApiError(
          409,
          'PURCHASING_SNAPSHOT_STALE',
          'Purchasing details were modified after review screen loaded. Please refresh and review updated quantities, rates, or suppliers before approving.'
        );
      }
      if (expectedVersion !== null && expectedVersion !== undefined && targetDoc.currentRevision !== Number(expectedVersion)) {
        throw new ApiError(
          409,
          'PURCHASING_VERSION_CONFLICT',
          `Order version conflict. Expected version ${expectedVersion} but found ${targetDoc.currentRevision}.`
        );
      }

      // Find target revision in array
      const rev = order.revisions.find((r) => r.revisionNumber === targetRevNum);
      if (!rev) {
        throw new ApiError(500, 'REVISION_CORRUPTED', `Revision record ${targetRevNum} missing from PO.`);
      }

      const decisionFingerprint = computeFingerprint({
        purchaseOrderId: cleanPoId,
        revisionNumber: targetRevNum,
        totalPaisa: order.totalPaisa,
        lineCount: order.lineItems.length,
        vendorId: order.vendorId,
        approvedBy: auth.userId,
      });

      rev.status = 'APPROVED';
      rev.dispatchJobId = dispatchJobId;
      rev.approval = {
        approvedAt: new Date(),
        approvedByUserId: auth.userId,
        approvedByRole: userRole,
        approvalPolicyId: 'STANDARD_PO_POLICY',
        approvalPolicyVersion: '2026.1',
        purchasingCapability: 'PURCHASE_ORDER_APPROVE',
        isEscalatedApproval: userRole === 'MASTER',
        notes: String(notes || '').trim(),
        decisionFingerprint,
      };

      order.status = 'APPROVED';
      order.activeApprovedRevision = targetRevNum;
      order.approvedByUserId = auth.userId;
      order.approvedAt = new Date();
      order.approvalNotes = String(notes || '').trim();
      order.dispatchStatus = 'QUEUED';
      order.lastModifiedByUserId = auth.userId;

      await order.save(sessionOpt);

      // Create durable Dispatch Job in outbox
      const dispatchJob = new ProcurementDispatchJob({
        dispatchJobId,
        organisationId: order.organisationId,
        cafeId: order.cafeId,
        purchaseOrderId: cleanPoId,
        revisionNumber: targetRevNum,
        vendorId: order.vendorId,
        recipientEmail,
        recipientName: vendor?.name || order.vendorNameSnapshot,
        status: 'QUEUED',
        idempotencyKey: effectiveIdempotencyKey,
        provider: 'EMAIL',
        attempts: [],
        payloadSnapshot: {
          purchaseOrderId: cleanPoId,
          revisionNumber: targetRevNum,
          orderDate: order.orderDate || new Date().toISOString().slice(0, 10),
          cafeId: order.cafeId,
          deliveryAddress: rev.deliveryAddress || order.deliveryAddress,
          vendorId: order.vendorId,
          vendorName: vendor?.name || order.vendorNameSnapshot,
          totalPaisa: order.totalPaisa,
          subtotalPaisa: order.subtotalPaisa,
          taxPaisa: order.taxPaisa,
          lineItems: rev.lineItems.map((li) => ({
            itemId: li.itemId,
            name: li.itemNameSnapshot,
            orderedQuantityBase: li.orderedQuantityBase,
            baseUnit: li.baseUnit,
            packSize: li.packSize,
            unitPricePaisa: li.unitPricePaisa,
            totalLinePaisa: li.totalLinePaisa,
          })),
        },
      });

      await dispatchJob.save(sessionOpt);

      if (request) {
        await recordRequestAudit(
          {
            request,
            module: 'PROCUREMENT',
            action: 'PURCHASE_ORDER_APPROVED_AND_QUEUED',
            entityType: 'PURCHASE_ORDER',
            entityId: cleanPoId,
            before: { status: 'SUBMITTED', activeApprovedRevision: null },
            after: {
              status: 'APPROVED',
              activeApprovedRevision: targetRevNum,
              dispatchJobId,
            },
            result: 'SUCCESS',
            riskClassification: 'MEDIUM',
          },
          sessionOpt
        );
      }

      return { order, dispatchJob };
    };

    return await executeTransactionWithRetry(runAtomicApproval);
  }

  /**
   * Cancels a Purchase Order cleanly and coordinates with any queued or claimed dispatch jobs.
   */
  static async cancelPurchaseOrder({
    purchaseOrderId,
    reason,
    auth,
    request = null,
  }) {
    const cleanPoId = normalizeId(purchaseOrderId);
    const order = await PurchaseOrder.findOne({ purchaseOrderId: cleanPoId });

    if (!order) {
      throw new ApiError(404, 'NOT_FOUND', `Purchase order ${cleanPoId} not found.`);
    }

    await this.assertPurchasingAuthority(auth, order.cafeId, 'CANCEL');

    if (['RECEIVED', 'CLOSED', 'CANCELLED'].includes(order.status)) {
      throw new ApiError(409, 'INVALID_STATUS', `Cannot cancel purchase order in ${order.status} status.`);
    }

    const wasApproved = order.status === 'APPROVED' || order.activeApprovedRevision !== null;
    const reasonText = String(reason || 'Cancelled by authorized user').trim();

    const runCancelTransaction = async (session) => {
      const sessionOpt = session ? { session } : {};

      order.status = 'CANCELLED';
      order.cancelledByUserId = auth.userId;
      order.cancelledAt = new Date();
      order.cancellationReason = reasonText;
      order.lastModifiedByUserId = auth.userId;

      // Atomically cancel any queued or claimed dispatch jobs
      await ProcurementDispatchJob.updateMany(
        {
          purchaseOrderId: cleanPoId,
          status: { $in: ['QUEUED', 'CLAIMED'] },
        },
        {
          $set: {
            status: 'CANCELLED',
            reconciliationNotes: `Order cancelled by ${auth.userId}: ${reasonText}`,
          },
        },
        sessionOpt
      );

      if (['QUEUED', 'CLAIMED', 'NOT_QUEUED'].includes(order.dispatchStatus)) {
        order.dispatchStatus = 'CANCELLED';
      }

      await order.save(sessionOpt);

      if (request) {
        await recordRequestAudit(
          {
            request,
            module: 'PROCUREMENT',
            action: 'PURCHASE_ORDER_CANCELLED',
            entityType: 'PURCHASE_ORDER',
            entityId: cleanPoId,
            before: { wasApproved, revision: order.currentRevision },
            after: { status: 'CANCELLED', reason: reasonText },
            result: 'SUCCESS',
            riskClassification: 'MEDIUM',
          },
          sessionOpt
        );
      }

      return order;
    };

    return await executeTransactionWithRetry(runCancelTransaction);
  }

  /**
   * Reevaluates alternative approved suppliers for a recommendation.
   */
  static async requestSupplierAlternative({
    recommendationId,
    reason,
    auth,
    request = null,
  }) {
    const cleanRecId = normalizeId(recommendationId);
    const rec = await ReplenishmentRecommendation.findOne({ recommendationId: cleanRecId });

    if (!rec) {
      throw new ApiError(404, 'NOT_FOUND', `Recommendation ${cleanRecId} not found.`);
    }

    await this.assertPurchasingAuthority(auth, rec.cafeId, 'REQUEST_ALTERNATIVE');

    // Fetch café inventory config to find approved suppliers
    const config = await CafeInventoryConfig.findOne({
      organisationId: rec.organisationId,
      cafeId: rec.cafeId,
      itemId: rec.itemId,
    }).lean();

    const currentVendorId = normalizeId(rec.supplierCandidate?.vendorId);
    const approvedList = Array.isArray(config?.approvedSuppliers) ? config.approvedSuppliers : [];

    // Filter for another active approved supplier
    const candidateMapping = approvedList.find(
      (s) => normalizeId(s.vendorId) !== currentVendorId && s.isActive !== false
    );

    if (!candidateMapping) {
      // Record exception: no alternative approved vendor exists
      rec.actionableExceptions.push({
        code: 'NO_ALTERNATIVE_APPROVED_SUPPLIER',
        severity: 'BLOCKER',
        message: `Alternative supplier requested (${reason}), but no other approved supplier is configured for ${rec.itemId} at ${rec.cafeId}.`,
        correctiveAction: 'Primary Master must approve and map a qualified vendor in P05 Master Data.',
      });
      rec.status = 'BLOCKED_CONSTRAINT';
      await rec.save();

      throw new ApiError(
        400,
        'NO_ALTERNATIVE_SUPPLIER_AVAILABLE',
        `No alternative approved supplier is mapped for item ${rec.itemId}. Cannot automatically substitute.`
      );
    }

    const vendorDoc = await Vendor.findOne({
      organisationId: rec.organisationId,
      vendorId: candidateMapping.vendorId,
      status: 'ACTIVE',
    }).lean();

    if (!vendorDoc) {
      throw new ApiError(400, 'ALTERNATIVE_VENDOR_INACTIVE', `Alternative supplier ${candidateMapping.vendorId} is not active.`);
    }

    // Apply alternative supplier mapping
    const uom = candidateMapping.uom || rec.itemSnapshot?.baseUnit || 'unit';
    const contractedPricePaisa = Number(candidateMapping.contractedPricePaisa || candidateMapping.pricePaisa || 0);
    const conversionFactor = Number(candidateMapping.uomConversionFactor || 1);
    const moq = Number(candidateMapping.moq || 1);
    const orderMultiple = Number(candidateMapping.orderMultiple || 1);

    const rawNeedBase = rec.calculation?.rawNeedBase || 0;
    const purchaseQtyRaw = rawNeedBase / conversionFactor;
    let roundedPurchaseQty = Math.ceil(purchaseQtyRaw / orderMultiple) * orderMultiple;
    if (roundedPurchaseQty < moq) roundedPurchaseQty = moq;

    rec.supplierCandidate = {
      vendorId: candidateMapping.vendorId,
      vendorName: vendorDoc.name || candidateMapping.vendorId,
      supplierItemCode: candidateMapping.supplierItemCode || '',
      uom,
      contractedPricePaisa,
      leadTimeDays: candidateMapping.leadTimeDays || 2,
      deliveryDays: candidateMapping.deliveryDays || [],
      moq,
      orderMultiple,
      feasibilityNotes: `Switched to alternative approved supplier on request: ${reason}`,
    };

    rec.calculation.conversionFactor = conversionFactor;
    rec.calculation.suggestedPurchaseQuantity = roundedPurchaseQty;
    rec.calculation.suggestedBaseQuantity = roundedPurchaseQty * conversionFactor;
    rec.calculation.estimatedCostPaisa = roundedPurchaseQty * contractedPricePaisa;

    if (!rec.revisionHistory) rec.revisionHistory = [];
    rec.revisionHistory.push({
      revisedAt: new Date(),
      reason: `Alternative supplier requested: ${reason}. Switched from ${currentVendorId} to ${candidateMapping.vendorId}.`,
      previousQuantities: {
        rawNeedBase,
        suggestedBaseQuantity: rec.calculation.suggestedBaseQuantity,
        suggestedPurchaseQuantity: roundedPurchaseQty,
      },
      fingerprint: rec.calculation.calculationFingerprint,
      evaluatorActor: auth.userId,
    });

    await rec.save();

    if (request) {
      await recordRequestAudit({
        request,
        module: 'PROCUREMENT',
        action: 'SUPPLIER_ALTERNATIVE_APPLIED',
        entityType: 'REPLENISHMENT_RECOMMENDATION',
        entityId: cleanRecId,
        before: { vendorId: currentVendorId },
        after: { vendorId: candidateMapping.vendorId, reason },
        result: 'SUCCESS',
        riskClassification: 'LOW',
      });
    }

    return rec;
  }

  /**
   * Records an authenticated vendor response (ACKNOWLEDGED, PARTIALLY_CONFIRMED, REJECTED).
   * STRICT INVARIANT: ZERO inventory movement, ZERO lot creation, ZERO GL liabilities.
   */
  static async recordVendorAcknowledgement({
    purchaseOrderId,
    status,
    notes = '',
    channel = 'EMAIL',
    confirmedLines = [],
    auth,
    request = null,
  }) {
    const cleanPoId = normalizeId(purchaseOrderId);
    const normStatus = normalizeId(status);

    const validResponses = ['ACKNOWLEDGED', 'PARTIALLY_CONFIRMED', 'REJECTED', 'NO_RESPONSE'];
    if (!validResponses.includes(normStatus)) {
      throw new ApiError(400, 'INVALID_STATUS', `Vendor response status must be one of: ${validResponses.join(', ')}`);
    }

    const order = await PurchaseOrder.findOne({ purchaseOrderId: cleanPoId });
    if (!order) {
      throw new ApiError(404, 'NOT_FOUND', `Purchase order ${cleanPoId} not found.`);
    }

    await this.assertPurchasingAuthority(auth, order.cafeId, 'RECORD_VENDOR_RESPONSE');

    order.vendorResponseStatus = normStatus;
    order.vendorResponseDetails = {
      respondedAt: new Date(),
      recordedByUserId: auth.userId,
      channel: String(channel).trim().toUpperCase(),
      notes: String(notes).trim(),
      confirmedLines: Array.isArray(confirmedLines)
        ? confirmedLines.map((cl) => ({
            itemId: normalizeId(cl.itemId),
            confirmedQuantityBase: Number(cl.confirmedQuantityBase || 0),
            unavailableQuantityBase: Number(cl.unavailableQuantityBase || 0),
          }))
        : [],
    };

    if (normStatus === 'ACKNOWLEDGED') {
      order.supplierAcknowledgedAt = new Date();
      order.supplierAcknowledgementStatus = 'ACCEPTED';
    } else if (normStatus === 'PARTIALLY_CONFIRMED') {
      order.supplierAcknowledgedAt = new Date();
      order.supplierAcknowledgementStatus = 'ACCEPTED_WITH_CHANGES';

      // Update line-level confirmation details without altering original ordered quantities
      for (const cl of confirmedLines) {
        const line = order.lineItems.find((l) => l.itemId === normalizeId(cl.itemId));
        if (line) {
          line.vendorConfirmationDetails = {
            confirmedSupplyQty: Number(cl.confirmedQuantityBase || 0),
            cannotSupplyQty: Number(cl.unavailableQuantityBase || 0),
            confirmedAt: new Date(),
            confirmedByUserId: auth.userId,
          };
          if (cl.confirmedQuantityBase < line.orderedQuantityBase) {
            line.fulfillmentStatus = 'PARTIALLY_CONFIRMED';
          }
        }
      }
    } else if (normStatus === 'REJECTED') {
      order.supplierAcknowledgementStatus = 'CANNOT_SUPPLY';
    }

    await order.save();

    if (request) {
      await recordRequestAudit({
        request,
        module: 'PROCUREMENT',
        action: 'VENDOR_RESPONSE_RECORDED',
        entityType: 'PURCHASE_ORDER',
        entityId: cleanPoId,
        before: { vendorResponseStatus: 'AWAITING_RESPONSE' },
        after: { vendorResponseStatus: normStatus, channel },
        result: 'SUCCESS',
        riskClassification: 'LOW',
      });
    }

    return order;
  }
}

ProcurementApprovalService.computePurchasingSnapshot = computePurchasingSnapshot;
ProcurementApprovalService.computePurchasingFingerprint = computePurchasingFingerprint;

module.exports = {
  ProcurementApprovalService,
  computePurchasingSnapshot,
  computePurchasingFingerprint,
  computeFingerprint,
};
