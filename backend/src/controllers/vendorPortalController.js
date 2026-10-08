'use strict';

/**
 * VENDOR PORTAL CONTROLLER — READ-ONLY EXTERNAL VENDOR WORKSPACE
 *
 * Implements the 5th persona window:
 * - Scoped exclusively to the authenticated vendor (req.auth.vendorId).
 * - Enforces strict read-only boundary: zero mutation of business records.
 * - Only approved, issued POs are visible (internal drafts strictly hidden).
 * - Internal margin notes, internal approver details, and cross-vendor data are masked.
 */

const { Vendor } = require('../models/Vendor');
const { PurchaseOrder } = require('../models/PurchaseOrder');
const { VendorLedgerEntry } = require('../models/VendorLedgerEntry');
const ApiError = require('../utils/ApiError');

const ISSUED_PO_STATUSES = [
  'APPROVED',
  'ORDER_PLACED',
  'ORDERED',
  'ACKNOWLEDGED',
  'DISPATCHED',
  'PARTIALLY_RECEIVED',
  'VERIFIED_PENDING_MASTER_APPROVAL',
  'RECEIVED_PENDING_FINAL_POSTING',
  'RECEIVED',
  'CLOSED',
];

function maskSensitiveText(text, visibleEndChars = 4) {
  if (!text || typeof text !== 'string') return '';
  const trimmed = text.trim();
  if (trimmed.length <= visibleEndChars) return trimmed;
  const maskedLength = trimmed.length - visibleEndChars;
  return '*'.repeat(maskedLength) + trimmed.slice(-visibleEndChars);
}

function assertVendorIdentity(req) {
  if (!req.auth || req.auth.role !== 'VENDOR' || !req.auth.vendorId) {
    throw new ApiError(403, 'VENDOR_ACCESS_REQUIRED', 'This endpoint requires authenticated Vendor credentials.');
  }
}

/**
 * GET /api/v1/vendor-portal/profile
 * Returns authenticated vendor's business profile and contact channels.
 */
async function getVendorProfile(req, res, next) {
  try {
    assertVendorIdentity(req);
    const vendor = await Vendor.findOne({
      vendorId: req.auth.vendorId,
      organisationId: req.auth.organisationId,
    }).lean();

    if (!vendor) {
      throw new ApiError(404, 'VENDOR_NOT_FOUND', 'Vendor business profile could not be found.');
    }

    const sanitized = {
      vendorId: vendor.vendorId,
      legalBusinessName: vendor.legalBusinessName || vendor.name,
      tradeName: vendor.tradeName || vendor.legalBusinessName,
      vendorCategory: vendor.vendorCategory,
      supplierType: vendor.supplierType,
      status: vendor.status,
      gstin: vendor.gstin || '',
      panMasked: maskSensitiveText(vendor.pan, 4),
      fssaiLicenseNumber: vendor.fssaiLicenseNumber || '',
      paymentTerms: vendor.paymentTerms,
      registeredOfficeAddress: vendor.registeredOfficeAddress || null,
      primaryContact: vendor.primaryContact || null,
      bankDetails: {
        bankName: vendor.bankDetails?.bankName || '',
        accountHolderName: vendor.bankDetails?.accountHolderName || '',
        accountNumberMasked: vendor.bankDetails?.accountNumberMasked || maskSensitiveText(vendor.bankDetails?.accountNumber, 4),
        ifscCode: vendor.bankDetails?.ifscCode || '',
        branchName: vendor.bankDetails?.branchName || '',
      },
      supportContact: {
        role: 'Café Operations Support',
        phone: '+91 94470 12345',
        email: 'procurement@zamorin.test',
        helpNotice: 'To update banking, contact, or company details, please contact Café Operations via authenticated email.',
      },
    };

    return res.status(200).json({ data: sanitized });
  } catch (err) {
    return next(err);
  }
}

/**
 * GET /api/v1/vendor-portal/dashboard
 * Returns executive metrics for issued orders and pending deliveries.
 */
async function getVendorDashboard(req, res, next) {
  try {
    assertVendorIdentity(req);
    const vendorId = req.auth.vendorId;
    const orgId = req.auth.organisationId;

    const issuedOrders = await PurchaseOrder.find({
      vendorId,
      organisationId: orgId,
      status: { $in: ISSUED_PO_STATUSES },
    }).lean();

    const totalIssuedOrdersCount = issuedOrders.length;
    const pendingDeliveries = issuedOrders.filter((o) =>
      ['APPROVED', 'ORDER_PLACED', 'ORDERED', 'ACKNOWLEDGED', 'DISPATCHED', 'PARTIALLY_RECEIVED'].includes(o.status)
    );
    const completedOrders = issuedOrders.filter((o) => ['RECEIVED', 'CLOSED'].includes(o.status));
    const totalIssuedValuePaisa = issuedOrders.reduce((sum, o) => sum + (o.totalPaisa || 0), 0);
    const pendingDeliveryValuePaisa = pendingDeliveries.reduce((sum, o) => sum + (o.totalPaisa || 0), 0);

    const latestOrder = issuedOrders.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0] || null;

    return res.status(200).json({
      data: {
        totalIssuedOrdersCount,
        pendingDeliveriesCount: pendingDeliveries.length,
        completedOrdersCount: completedOrders.length,
        totalIssuedValuePaisa,
        pendingDeliveryValuePaisa,
        lastOrderDate: latestOrder ? latestOrder.createdAt : null,
        recentOrders: issuedOrders.slice(0, 5).map((o) => ({
          purchaseOrderId: o.purchaseOrderId,
          cafeId: o.cafeId,
          orderDate: o.orderDate || o.createdAt,
          expectedDeliveryDate: o.expectedDeliveryDate,
          totalPaisa: o.totalPaisa,
          status: o.status,
          itemCount: Array.isArray(o.lineItems) ? o.lineItems.length : 0,
        })),
        readOnlyNotice: 'All data displayed in this portal is official, read-only enterprise business records.',
      },
    });
  } catch (err) {
    return next(err);
  }
}

/**
 * GET /api/v1/vendor-portal/orders
 * Returns list of issued purchase orders for this vendor.
 */
async function getIssuedOrders(req, res, next) {
  try {
    assertVendorIdentity(req);
    const vendorId = req.auth.vendorId;
    const orgId = req.auth.organisationId;

    const { status, cafeId, search, page = 1, limit = 50 } = req.query;

    const query = {
      vendorId,
      organisationId: orgId,
      status: { $in: ISSUED_PO_STATUSES },
    };

    if (status && status !== 'ALL') {
      if (ISSUED_PO_STATUSES.includes(status.toUpperCase())) {
        query.status = status.toUpperCase();
      }
    }

    if (cafeId && cafeId !== 'ALL') {
      query.cafeId = String(cafeId).trim().toUpperCase();
    }

    if (search) {
      query.purchaseOrderId = { $regex: String(search).trim(), $options: 'i' };
    }

    const skip = (Math.max(1, Number(page)) - 1) * Math.min(100, Math.max(1, Number(limit)));
    const totalCount = await PurchaseOrder.countDocuments(query);
    const orders = await PurchaseOrder.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(Math.min(100, Math.max(1, Number(limit))))
      .lean();

    const sanitizedOrders = orders.map((o) => ({
      purchaseOrderId: o.purchaseOrderId,
      cafeId: o.cafeId,
      status: o.status,
      currentRevision: o.currentRevision || 1,
      vendorResponseStatus: o.vendorResponseStatus || 'AWAITING_RESPONSE',
      fulfillmentStatus: o.fulfillmentStatus || 'PENDING_RECEIPT',
      orderDate: o.orderDate || o.createdAt,
      expectedDeliveryDate: o.expectedDeliveryDate || null,
      totalPaisa: o.totalPaisa,
      taxPaisa: o.taxPaisa || 0,
      subtotalPaisa: o.subtotalPaisa || o.totalPaisa,
      itemCount: Array.isArray(o.lineItems) ? o.lineItems.length : 0,
      hasDeliveryReceipts: Array.isArray(o.grnReceipts) && o.grnReceipts.length > 0,
    }));

    return res.status(200).json({
      data: sanitizedOrders,
      pagination: {
        total: totalCount,
        page: Number(page),
        limit: Number(limit),
        pages: Math.ceil(totalCount / Number(limit)) || 1,
      },
    });
  } catch (err) {
    return next(err);
  }
}

/**
 * GET /api/v1/vendor-portal/orders/:purchaseOrderId
 * Returns full detailed view of an issued purchase order for this vendor.
 */
async function getOrderDetail(req, res, next) {
  try {
    assertVendorIdentity(req);
    const { purchaseOrderId } = req.params;
    const vendorId = req.auth.vendorId;
    const orgId = req.auth.organisationId;

    const order = await PurchaseOrder.findOne({
      purchaseOrderId: String(purchaseOrderId).trim().toUpperCase(),
      organisationId: orgId,
    }).lean();

    if (!order) {
      throw new ApiError(404, 'ORDER_NOT_FOUND', 'Purchase order could not be found.');
    }

    // Strict vendor boundary check: Vendor A cannot view Vendor B's order
    if (order.vendorId !== vendorId) {
      throw new ApiError(403, 'ACCESS_DENIED', 'You do not have permission to view purchase orders for another vendor.');
    }

    // Strict status check: Vendor cannot view internal drafts
    if (!ISSUED_PO_STATUSES.includes(order.status)) {
      throw new ApiError(404, 'ORDER_NOT_ISSUED', 'This purchase order has not been released or issued to the vendor.');
    }

    // Sanitize line items — remove internal margins, cost codes, internal notes
    const sanitizedLineItems = (order.lineItems || []).map((li) => {
      const qty = li.orderedQuantityBase !== undefined ? li.orderedQuantityBase : (li.quantityOrdered || 0);
      const total = li.totalLinePaisa !== undefined ? li.totalLinePaisa : (li.lineTotalPaisa || 0);
      return {
        itemId: li.itemId,
        itemName: li.itemNameSnapshot || li.itemId,
        itemType: li.itemType || 'GOODS',
        supplierItemCode: li.supplierItemCode || '',
        packSize: li.packSize || '1 UNIT',
        baseUnit: li.baseUnit || 'units',
        quantityOrdered: qty,
        orderedQuantityBase: qty,
        quantityReceived: li.receivedQuantityBase || li.quantityReceived || 0,
        unitPricePaisa: li.unitPricePaisa,
        gstPercent: li.gstPercent || 5,
        lineTotalPaisa: total,
        totalLinePaisa: total,
        fulfillmentStatus: li.fulfillmentStatus || 'PENDING_RECEIPT',
      };
    });

    const sanitizedOrder = {
      purchaseOrderId: order.purchaseOrderId,
      cafeId: order.cafeId,
      status: order.status,
      currentRevision: order.currentRevision || 1,
      activeApprovedRevision: order.activeApprovedRevision || order.currentRevision || 1,
      vendorResponseStatus: order.vendorResponseStatus || 'AWAITING_RESPONSE',
      fulfillmentStatus: order.fulfillmentStatus || 'PENDING_RECEIPT',
      orderDate: order.orderDate || order.createdAt,
      expectedDeliveryDate: order.expectedDeliveryDate,
      subtotalPaisa: order.subtotalPaisa || order.totalPaisa,
      taxPaisa: order.taxPaisa || 0,
      totalPaisa: order.totalPaisa,
      paymentTerms: order.paymentTerms || 'NET_30',
      shippingAddress: order.shippingAddress || order.deliveryAddress || `Zamorin Café - Outlet ${order.cafeId}`,
      billingAddress: order.billingAddress || 'Zamorin Estate Pvt Ltd',
      lineItems: sanitizedLineItems,
      deliveries: (order.grnReceipts || []).map((g) => ({
        grnId: g.grnId,
        receivedAt: g.receivedAt,
        receivedItemsCount: Array.isArray(g.receivedLines) ? g.receivedLines.length : 0,
      })),
      clarificationNotice: 'Questions regarding quantities or schedules? Please contact Café Operations directly.',
    };

    return res.status(200).json({ data: sanitizedOrder });
  } catch (err) {
    return next(err);
  }
}

/**
 * GET /api/v1/vendor-portal/orders/:purchaseOrderId/pdf
 * Generates an official, printable Purchase Order document for the vendor.
 */
async function downloadOrderPdf(req, res, next) {
  try {
    assertVendorIdentity(req);
    const { purchaseOrderId } = req.params;
    const vendorId = req.auth.vendorId;
    const orgId = req.auth.organisationId;

    const order = await PurchaseOrder.findOne({
      purchaseOrderId: String(purchaseOrderId).trim().toUpperCase(),
      organisationId: orgId,
    }).lean();

    if (!order || order.vendorId !== vendorId || !ISSUED_PO_STATUSES.includes(order.status)) {
      throw new ApiError(404, 'ORDER_NOT_FOUND', 'Official purchase order document is not available.');
    }

    const vendor = await Vendor.findOne({ vendorId, organisationId: orgId }).lean();

    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Purchase Order ${order.purchaseOrderId}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; padding: 32px; color: #1e293b; }
    .header { display: flex; justify-content: space-between; border-bottom: 2px solid #0f172a; padding-bottom: 16px; margin-bottom: 24px; }
    .title { font-size: 24px; font-weight: 800; color: #0f172a; }
    .meta { font-size: 13px; color: #64748b; line-height: 1.5; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; margin-bottom: 24px; }
    .box { border: 1px solid #e2e8f0; border-radius: 6px; padding: 14px; font-size: 13px; }
    .box h4 { margin: 0 0 8px 0; font-size: 12px; text-transform: uppercase; color: #64748b; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 24px; font-size: 13px; }
    th { background: #f8fafc; border: 1px solid #e2e8f0; padding: 8px 12px; text-align: left; font-weight: 700; }
    td { border: 1px solid #e2e8f0; padding: 8px 12px; }
    .total-row td { font-weight: 700; background: #f8fafc; }
    .footer { font-size: 11px; color: #94a3b8; text-align: center; border-top: 1px solid #e2e8f0; padding-top: 16px; }
  </style>
</head>
<body>
  <div class="header">
    <div>
      <div class="title">ZAMORIN CAFÉ ERP</div>
      <div class="meta">Official Enterprise Purchase Order</div>
    </div>
    <div style="text-align: right;">
      <div style="font-size: 18px; font-weight: 700;">PO: ${order.purchaseOrderId}</div>
      <div class="meta">Date: ${new Date(order.orderDate || order.createdAt).toLocaleDateString()}</div>
      <div class="meta">Status: ${order.status}</div>
    </div>
  </div>

  <div class="grid">
    <div class="box">
      <h4>Vendor / Supplier</h4>
      <strong>${vendor?.legalBusinessName || vendor?.name || order.vendorId}</strong><br>
      Vendor Code: ${order.vendorId}<br>
      GSTIN: ${vendor?.gstin || 'Not registered'}
    </div>
    <div class="box">
      <h4>Delivery Destination</h4>
      <strong>Zamorin Café — Outlet ${order.cafeId}</strong><br>
      Expected Arrival: ${order.expectedDeliveryDate ? new Date(order.expectedDeliveryDate).toLocaleDateString() : 'Immediate'}<br>
      Terms: ${order.paymentTerms || 'NET_30'}
    </div>
  </div>

  <table>
    <thead>
      <tr>
        <th>#</th>
        <th>Item Description</th>
        <th>Pack Size</th>
        <th style="text-align:right;">Qty</th>
        <th style="text-align:right;">Unit Rate</th>
        <th style="text-align:right;">GST%</th>
        <th style="text-align:right;">Total (₹)</th>
      </tr>
    </thead>
    <tbody>
      ${(order.lineItems || []).map((li, idx) => {
        const qty = li.orderedQuantityBase !== undefined ? li.orderedQuantityBase : (li.quantityOrdered || 0);
        const total = li.totalLinePaisa !== undefined ? li.totalLinePaisa : (li.lineTotalPaisa || 0);
        return `
        <tr>
          <td>${idx + 1}</td>
          <td><strong>${li.itemNameSnapshot || li.itemId}</strong></td>
          <td>${li.packSize || '1 UNIT'}</td>
          <td style="text-align:right;">${qty}</td>
          <td style="text-align:right;">₹${((li.unitPricePaisa || 0) / 100).toFixed(2)}</td>
          <td style="text-align:right;">${li.gstPercent || 5}%</td>
          <td style="text-align:right;">₹${((total || 0) / 100).toFixed(2)}</td>
        </tr>`;
      }).join('')}
      <tr class="total-row">
        <td colspan="6" style="text-align:right;">Subtotal:</td>
        <td style="text-align:right;">₹${(((order.subtotalPaisa || order.totalPaisa) || 0) / 100).toFixed(2)}</td>
      </tr>
      <tr class="total-row">
        <td colspan="6" style="text-align:right;">Tax:</td>
        <td style="text-align:right;">₹${((order.taxPaisa || 0) / 100).toFixed(2)}</td>
      </tr>
      <tr class="total-row" style="font-size: 15px;">
        <td colspan="6" style="text-align:right;">Grand Total:</td>
        <td style="text-align:right;">₹${((order.totalPaisa || 0) / 100).toFixed(2)}</td>
      </tr>
    </tbody>
  </table>

  <div class="footer">
    This document was officially released by Zamorin Estate ERP for vendor fulfillment. System-generated record.
  </div>
</body>
</html>`;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Content-Disposition', `inline; filename="PO_${order.purchaseOrderId}.html"`);
    return res.status(200).send(html);
  } catch (err) {
    return next(err);
  }
}

/**
 * GET /api/v1/vendor-portal/deliveries
 * Returns delivery receipts for this vendor.
 */
async function getVendorDeliveries(req, res, next) {
  try {
    assertVendorIdentity(req);
    const vendorId = req.auth.vendorId;
    const orgId = req.auth.organisationId;

    const ordersWithGrn = await PurchaseOrder.find({
      vendorId,
      organisationId: orgId,
      'grnReceipts.0': { $exists: true },
    }).lean();

    const deliveries = [];
    for (const order of ordersWithGrn) {
      for (const grn of (order.grnReceipts || [])) {
        deliveries.push({
          grnId: grn.grnId,
          purchaseOrderId: order.purchaseOrderId,
          cafeId: order.cafeId,
          receivedAt: grn.receivedAt,
          status: 'VERIFIED_PHYSICAL_RECEIPT',
          itemCount: Array.isArray(grn.receivedLines) ? grn.receivedLines.length : 0,
        });
      }
    }

    deliveries.sort((a, b) => new Date(b.receivedAt) - new Date(a.receivedAt));

    return res.status(200).json({ data: deliveries });
  } catch (err) {
    return next(err);
  }
}

/**
 * GET /api/v1/vendor-portal/statements
 * Returns accounts payable ledger statements for this vendor.
 */
async function getVendorStatements(req, res, next) {
  try {
    assertVendorIdentity(req);
    const vendorId = req.auth.vendorId;
    const orgId = req.auth.organisationId;

    const entries = await VendorLedgerEntry.find({
      vendorId,
      organisationId: orgId,
    })
      .sort({ entryTimestamp: -1, createdAt: -1 })
      .limit(100)
      .lean();

    return res.status(200).json({
      data: entries.map((e) => ({
        entryId: e.ledgerEntryId || e.entryId,
        entryDate: e.entryDate || (e.entryTimestamp ? new Date(e.entryTimestamp).toISOString().slice(0, 10) : null),
        entryType: e.entryType || e.transactionType,
        documentReference: e.referenceId || e.purchaseOrderId || e.documentReference,
        creditPaisa: e.creditPaisa || 0,
        debitPaisa: e.debitPaisa || 0,
        runningBalancePaisa: e.runningBalancePaisa,
        status: e.status || (e.isReversed ? 'REVERSED' : 'SETTLED'),
      })),
      readOnlyNotice: 'Financial ledger records are maintained by Enterprise Accounts Payable.',
    });
  } catch (err) {
    return next(err);
  }
}

/**
 * Write action blocker: Ensures every mutation attempt returns 403 VENDOR_READ_ONLY.
 */
function blockVendorMutation(req, res, next) {
  return res.status(403).json({
    error: {
      code: 'VENDOR_READ_ONLY',
      message: 'The Vendor portal is strictly read-only for business records. All mutation actions are disabled.',
    },
  });
}

module.exports = {
  getVendorProfile,
  getVendorDashboard,
  getIssuedOrders,
  getOrderDetail,
  downloadOrderPdf,
  getVendorDeliveries,
  getVendorStatements,
  blockVendorMutation,
};
