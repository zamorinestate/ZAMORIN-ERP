'use strict';

/**
 * ============================================================================
 * ZAMORIN CAFÉ ERP — PROCUREMENT DISPATCH SERVICE & WORKER (P07)
 * ============================================================================
 *
 * Implements:
 * 1. Vendor PO document generation (standard binary PDF 1.4, strictly isolated from internal notes/stock)
 * 2. Pluggable outbound provider adapters (Email, Console/Test, Channel setup required)
 * 3. Durable background worker with atomic claiming and cancellation pre-checks
 * 4. Safe UNKNOWN outcome reconciliation (never blindly resend on network ambiguity)
 * 5. Strict separation between Transport Status and Vendor Commercial Response
 */

const crypto = require('crypto');
const { ProcurementDispatchJob } = require('../models/ProcurementDispatchJob');
const { PurchaseOrder } = require('../models/PurchaseOrder');
const { ConsoleTestEmailProvider } = require('./ConsoleTestEmailProvider');
const { GmailEmailProvider } = require('./GmailEmailProvider');
const { generatePdf } = require('../utils/exportGenerators');
const { recordRequestAudit } = require('./auditService');
const { ApiError } = require('../utils/ApiError');

function computeSha256(bufferOrString) {
  return crypto.createHash('sha256').update(bufferOrString).digest('hex');
}

class ProcurementDispatchService {
  constructor() {
    this.testProvider = new ConsoleTestEmailProvider();
    this.gmailProvider = new GmailEmailProvider();
    this.activeProvider = process.env.NODE_ENV === 'test' ? this.testProvider : null;
  }

  setProvider(provider) {
    this.activeProvider = provider;
  }

  getProvider() {
    if (this.activeProvider) return this.activeProvider;
    // Check if Gmail or SMTP credentials are configured in environment
    if (process.env.GMAIL_SERVICE_ACCOUNT_EMAIL || process.env.GMAIL_CLIENT_ID) {
      return this.gmailProvider;
    }
    return null; // Signals CHANNEL_SETUP_REQUIRED
  }

  /**
   * Generates authoritative Vendor-facing Purchase Order PDF 1.4 document.
   * Strictly omits internal margins, stock levels, confidence scores, and employee notes.
   */
  static generateVendorPoPdf(order, revision = null) {
    const rev = revision || order.revisions?.find((r) => r.revisionNumber === order.currentRevision) || {
      lineItems: order.lineItems,
      subtotalPaisa: order.subtotalPaisa,
      taxPaisa: order.taxPaisa,
      totalPaisa: order.totalPaisa,
      revisionNumber: order.currentRevision || 1,
      vendorNameSnapshot: order.vendorNameSnapshot,
      deliveryAddress: order.deliveryAddress,
      terms: order.terms,
    };

    const columns = [
      { key: 'itemCode', label: 'Item Code', width: 80 },
      { key: 'name', label: 'Description', width: 180 },
      { key: 'packSize', label: 'Pack Size', width: 80 },
      { key: 'qty', label: 'Quantity', width: 60 },
      { key: 'rate', label: 'Rate (INR)', width: 80 },
      { key: 'total', label: 'Total (INR)', width: 90 },
    ];

    const rows = (rev.lineItems || []).map((li) => {
      const unitPriceRupees = (li.unitPricePaisa / 100).toFixed(2);
      const totalLineRupees = (li.totalLinePaisa / 100).toFixed(2);
      return {
        itemCode: li.supplierItemCode || li.itemId,
        name: li.itemNameSnapshot || li.itemId,
        packSize: li.packSize || '1 UNIT',
        qty: `${li.orderedQuantityBase} ${li.baseUnit || 'units'}`,
        rate: `₹${unitPriceRupees}`,
        total: `₹${totalLineRupees}`,
      };
    });

    const kpiCards = [
      {
        title: 'PO Subtotal',
        value: `₹${((rev.subtotalPaisa || 0) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`,
      },
      {
        title: 'Tax (GST)',
        value: `₹${((rev.taxPaisa || 0) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`,
      },
      {
        title: 'Total Order Value',
        value: `₹${((rev.totalPaisa || 0) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`,
      },
    ];

    const pdfResult = generatePdf({
      reportTitle: `PURCHASE ORDER — ${order.purchaseOrderId} (Rev ${rev.revisionNumber})`,
      reportCode: 'ZAMORIN-PO-OFFICIAL',
      qrCodeData: `https://zamorin.local/procurement/verify?po=${order.purchaseOrderId}&rev=${rev.revisionNumber}`,
      scope: `Café: ${order.cafeId} | Vendor: ${order.vendorNameSnapshot || order.vendorId}`,
      period: `Order Date: ${order.orderDate || new Date().toISOString().slice(0, 10)}`,
      columns,
      rows,
      kpiCards,
      cafeId: order.cafeId,
      sensitivityLevel: 'OFFICIAL_COMMERCIAL_ORDER',
      runId: `${order.purchaseOrderId}-R${rev.revisionNumber}`,
    });

    const documentHash = computeSha256(pdfResult.buffer);

    return {
      buffer: pdfResult.buffer,
      filename: `Purchase_Order_${order.purchaseOrderId}_Rev${rev.revisionNumber}.pdf`,
      mimeType: 'application/pdf',
      documentHash,
    };
  }

  /**
   * Dispatches a single purchase order dispatch job through the appropriate provider adapter.
   */
  async dispatchPurchaseOrder({ dispatchJob, order, revision, provider = null }) {
    const activeProv = provider || this.getProvider();

    // If no provider is configured, fail safe to CHANNEL_SETUP_REQUIRED
    if (!activeProv) {
      return {
        status: 'CHANNEL_SETUP_REQUIRED',
        providerMessageId: null,
        errorMessage: 'Outbound email provider is unconfigured. Real credentials required for transmission.',
      };
    }

    // Generate Vendor PO PDF matching exact approved revision
    const pdf = ProcurementDispatchService.generateVendorPoPdf(order, revision);

    const emailOptions = {
      to: dispatchJob.recipientEmail,
      subject: `Official Purchase Order: ${order.purchaseOrderId} (Rev ${dispatchJob.revisionNumber}) — Zamorin Café`,
      text: `Dear ${dispatchJob.recipientName || 'Supplier'},\n\nPlease find attached Purchase Order ${order.purchaseOrderId} (Revision ${dispatchJob.revisionNumber}) for Zamorin Café (${order.cafeId}).\nTotal order value: ₹${((order.totalPaisa || 0) / 100).toFixed(2)}.\n\nPlease acknowledge receipt and confirm delivery schedule.\n\nZamorin Café Procurement`,
      html: `<p>Dear <strong>${dispatchJob.recipientName || 'Supplier'}</strong>,</p><p>Please find attached Purchase Order <strong>${order.purchaseOrderId}</strong> (Revision ${dispatchJob.revisionNumber}) for Zamorin Café (<strong>${order.cafeId}</strong>).</p><p>Total order value: <strong>₹${((order.totalPaisa || 0) / 100).toFixed(2)}</strong>.</p><p>Please acknowledge receipt and confirm expected delivery schedule.</p><p>Zamorin Café Operations</p>`,
      attachments: [
        {
          filename: pdf.filename,
          content: pdf.buffer.toString('base64'),
          contentType: pdf.mimeType,
        },
      ],
    };

    try {
      const sendResult = await activeProv.sendEmail(emailOptions);
      return {
        status: 'ACCEPTED_BY_PROVIDER',
        providerMessageId: sendResult.providerMessageId || `MSG-${Date.now()}`,
        documentHash: pdf.documentHash,
        rawResponse: sendResult,
      };
    } catch (err) {
      const errCode = err.code || err.message;

      // Classify timeout / network interruption as UNKNOWN to prevent duplicate sending
      if (
        errCode === 'ETIMEDOUT' ||
        errCode === 'ECONNRESET' ||
        errCode === 'ESOCKETTIMEDOUT' ||
        String(err.message).toLowerCase().includes('timeout') ||
        String(err.message).toLowerCase().includes('unknown')
      ) {
        return {
          status: 'UNKNOWN',
          providerMessageId: null,
          errorMessage: `Network timeout / ambiguous transport outcome: ${err.message}`,
        };
      }

      return {
        status: 'FAILED',
        providerMessageId: null,
        errorMessage: err.message,
      };
    }
  }

  /**
   * Claims and processes eligible queued dispatch jobs in the background.
   */
  async runDispatchWorker({
    limit = 10,
    workerId = `WORKER-${process.pid}-${Date.now().toString(36)}`,
    provider = null,
    leaseDurationMs = 60000,
  } = {}) {
    const now = new Date();
    const outcomes = [];

    // 0. Recover any expired SENDING jobs to UNKNOWN (uncertain transmissions) to prevent duplicate resending
    const expiredSendingJobs = await ProcurementDispatchJob.find({
      status: 'SENDING',
      lockExpiresAt: { $lt: now },
    });

    for (const expJob of expiredSendingJobs) {
      const recovered = await ProcurementDispatchJob.findOneAndUpdate(
        {
          _id: expJob._id,
          status: 'SENDING',
          lockExpiresAt: { $lt: now },
        },
        {
          $set: {
            status: 'UNKNOWN',
            lockExpiresAt: null,
            reconciliationNotes: `Worker lease expired while in SENDING status. Marked UNKNOWN to prevent blind duplicate sending; reconcile with provider.`,
          },
        },
        { new: true }
      );

      if (recovered) {
        await PurchaseOrder.updateOne(
          { purchaseOrderId: recovered.purchaseOrderId },
          { $set: { dispatchStatus: 'UNKNOWN' } }
        );
        outcomes.push({
          jobId: recovered.dispatchJobId,
          status: 'UNKNOWN',
          reason: 'RECOVERED_UNCERTAIN_SENDING',
        });
      }
    }

    // 1. Query eligible jobs: newly QUEUED jobs and CLAIMED jobs whose lease expired
    const queuedJobs = await ProcurementDispatchJob.find({ status: 'QUEUED' })
      .sort({ createdAt: 1 })
      .limit(limit);

    const expiredClaimedJobs = await ProcurementDispatchJob.find({
      status: 'CLAIMED',
      lockExpiresAt: { $lt: now },
    }).limit(limit);

    const eligibleJobs = [...queuedJobs, ...expiredClaimedJobs].slice(0, limit);

    for (const job of eligibleJobs) {
      const startTime = Date.now();

      // 1. Atomic claim of the job to prevent parallel worker execution (guards against lost claim race)
      const claimedJob = await ProcurementDispatchJob.findOneAndUpdate(
        {
          _id: job._id,
          status: job.status,
        },
        {
          $set: {
            status: 'CLAIMED',
            claimedByWorkerId: workerId,
            claimedAt: new Date(),
            lockExpiresAt: new Date(Date.now() + leaseDurationMs),
            fencingToken: (job.fencingToken || 0) + 1,
          },
        },
        { new: true }
      );

      if (!claimedJob) {
        // Lost claim race to another worker
        continue;
      }

      // 2. Pre-Send Revocation & Invalidation Safety Check
      // Immediately reload the authoritative Purchase Order from MongoDB
      const order = await PurchaseOrder.findOne({
        purchaseOrderId: claimedJob.purchaseOrderId,
      });

      if (!order) {
        claimedJob.status = 'FAILED';
        claimedJob.reconciliationNotes = 'Purchase order record no longer exists.';
        await claimedJob.save();
        outcomes.push({ jobId: claimedJob.dispatchJobId, status: 'FAILED', reason: 'PO_NOT_FOUND' });
        continue;
      }

      // Check: Was PO cancelled or was this exact revision superseded before worker executed?
      if (order.status === 'CANCELLED') {
        claimedJob.status = 'CANCELLED';
        claimedJob.reconciliationNotes = 'Order was cancelled before transmission.';
        await claimedJob.save();
        order.dispatchStatus = 'CANCELLED';
        await order.save();
        outcomes.push({ jobId: claimedJob.dispatchJobId, status: 'CANCELLED', reason: 'ORDER_CANCELLED' });
        continue;
      }

      if (order.activeApprovedRevision !== claimedJob.revisionNumber) {
        // Approval was revoked or order was edited! DO NOT DISPATCH!
        claimedJob.status = 'CANCELLED';
        claimedJob.reconciliationNotes = `Revision ${claimedJob.revisionNumber} is no longer authorized (active approved revision is ${order.activeApprovedRevision}). Dispatch suppressed.`;
        await claimedJob.save();
        outcomes.push({ jobId: claimedJob.dispatchJobId, status: 'CANCELLED', reason: 'REVISION_SUPERSEDED' });
        continue;
      }

      // 3. Mark SENDING under this worker's lease
      const sendingJob = await ProcurementDispatchJob.findOneAndUpdate(
        {
          _id: claimedJob._id,
          claimedByWorkerId: workerId,
          status: 'CLAIMED',
        },
        {
          $set: {
            status: 'SENDING',
            lockExpiresAt: new Date(Date.now() + leaseDurationMs),
          },
        },
        { new: true }
      );

      if (!sendingJob) {
        // Worker lease expired or was preempted before sending
        continue;
      }

      // 4. Execute external provider transmission
      const dispatchResult = await this.dispatchPurchaseOrder({
        dispatchJob: claimedJob,
        order,
        revision: order.revisions?.find((r) => r.revisionNumber === claimedJob.revisionNumber),
        provider,
      });

      const durationMs = Date.now() - startTime;

      // 5. Guarded persist of dispatch outcome
      // CRITICAL: Expired or zombie workers cannot overwrite newer outcomes!
      const persistResult = await ProcurementDispatchJob.findOneAndUpdate(
        {
          _id: claimedJob._id,
          claimedByWorkerId: workerId,
          status: 'SENDING',
        },
        {
          $set: {
            status: dispatchResult.status,
            providerMessageId: dispatchResult.providerMessageId || claimedJob.providerMessageId,
            documentHash: dispatchResult.documentHash || claimedJob.documentHash,
            lockExpiresAt: null,
          },
          $push: {
            attempts: {
              attemptNumber: (claimedJob.attempts?.length || 0) + 1,
              attemptedAt: new Date(),
              workerId,
              provider: claimedJob.provider || 'EMAIL',
              outcome: dispatchResult.status,
              providerReferenceId: dispatchResult.providerMessageId || null,
              errorMessage: dispatchResult.errorMessage || null,
              durationMs,
            },
          },
        },
        { new: true }
      );

      if (!persistResult) {
        // Lease was lost, expired, or job was already recovered/superseded.
        // Expired worker must NOT overwrite newer outcomes or PO state!
        outcomes.push({
          jobId: claimedJob.dispatchJobId,
          status: 'LEASE_LOST',
          reason: 'EXPIRED_WORKER_WRITE_SUPPRESSED',
        });
        continue;
      }

      // 6. Update PO transport status atomically without overwriting concurrent cancellation/amendment
      const currentPo = await PurchaseOrder.findOne({ purchaseOrderId: claimedJob.purchaseOrderId });
      if (currentPo) {
        currentPo.dispatchStatus = dispatchResult.status;

        // If PO was cancelled concurrently while sending, preserve CANCELLED status!
        if (currentPo.status === 'CANCELLED') {
          await currentPo.save();
          await ProcurementDispatchJob.findOneAndUpdate(
            { _id: claimedJob._id },
            { $set: { reconciliationNotes: 'External message sent, but order was concurrently cancelled.' } }
          );
        } else if (currentPo.status === 'APPROVED' && currentPo.activeApprovedRevision === claimedJob.revisionNumber) {
          if (dispatchResult.status === 'ACCEPTED_BY_PROVIDER') {
            currentPo.status = 'ORDERED';
            currentPo.orderPlacedAt = new Date();
          }
          await currentPo.save();
        } else {
          // PO was amended or transitioned out of APPROVED: do NOT overwrite with ORDERED
          await currentPo.save();
        }
      }

      outcomes.push({
        jobId: claimedJob.dispatchJobId,
        status: dispatchResult.status,
        providerMessageId: dispatchResult.providerMessageId,
      });
    }

    return outcomes;
  }

  /**
   * Reconciles an ambiguous UNKNOWN dispatch status safely without duplicate sends.
   */
  static async reconcileUnknownDispatch({
    dispatchJobId,
    confirmedOutcome, // 'ACCEPTED_BY_PROVIDER' or 'FAILED'
    providerReferenceId = null,
    notes = '',
    auth,
    request = null,
  }) {
    const job = await ProcurementDispatchJob.findOne({ dispatchJobId });
    if (!job) {
      throw new ApiError(404, 'NOT_FOUND', `Dispatch job ${dispatchJobId} not found.`);
    }

    if (job.status !== 'UNKNOWN') {
      throw new ApiError(409, 'INVALID_STATE', `Only dispatch jobs in UNKNOWN status can be reconciled (current: ${job.status}).`);
    }

    const normOutcome = String(confirmedOutcome).trim().toUpperCase();
    if (!['ACCEPTED_BY_PROVIDER', 'FAILED'].includes(normOutcome)) {
      throw new ApiError(400, 'INVALID_OUTCOME', 'confirmedOutcome must be ACCEPTED_BY_PROVIDER or FAILED.');
    }

    job.status = normOutcome;
    job.reconciledAt = new Date();
    job.reconciledByUserId = auth?.userId || 'SYSTEM';
    job.reconciliationNotes = String(notes).trim();
    if (providerReferenceId) job.providerMessageId = String(providerReferenceId).trim();

    await job.save();

    const order = await PurchaseOrder.findOne({ purchaseOrderId: job.purchaseOrderId });
    if (order) {
      order.dispatchStatus = normOutcome;
      if (normOutcome === 'ACCEPTED_BY_PROVIDER' && order.status !== 'CANCELLED') {
        order.status = 'ORDERED';
        order.orderPlacedAt = new Date();
      }
      await order.save();
    }

    if (request) {
      await recordRequestAudit({
        request,
        module: 'PROCUREMENT',
        action: 'DISPATCH_UNKNOWN_RECONCILED',
        entityType: 'PROCUREMENT_DISPATCH_JOB',
        entityId: dispatchJobId,
        before: { status: 'UNKNOWN' },
        after: { status: normOutcome, notes },
        result: 'SUCCESS',
        riskClassification: 'LOW',
      });
    }

    return job;
  }
}

const defaultDispatchService = new ProcurementDispatchService();

module.exports = {
  ProcurementDispatchService,
  defaultDispatchService,
};
