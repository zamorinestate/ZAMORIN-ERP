'use strict';

const mongoose = require('mongoose');
const fs = require('fs');
const { ProcurementDispatchService } = require('../../src/services/procurementDispatchService');
const { PurchaseOrder } = require('../../src/models/PurchaseOrder');
const { ProcurementDispatchJob } = require('../../src/models/ProcurementDispatchJob');

class FileBackedControlledProvider {
  constructor(historyFile, { delayMs = 0 } = {}) {
    this.historyFile = historyFile;
    this.delayMs = delayMs;
  }

  async sendEmail(options) {
    if (this.delayMs > 0) {
      await new Promise((r) => setTimeout(r, this.delayMs));
    }
    const attempt = {
      attemptId: `ATT-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      to: options.to,
      subject: options.subject,
      workerPid: process.pid,
      timestamp: new Date().toISOString(),
    };
    let history = [];
    if (fs.existsSync(this.historyFile)) {
      try {
        history = JSON.parse(fs.readFileSync(this.historyFile, 'utf8'));
      } catch (_) {}
    }
    history.push(attempt);
    fs.writeFileSync(this.historyFile, JSON.stringify(history, null, 2));

    return {
      delivered: true,
      providerMessageId: attempt.attemptId,
    };
  }

  getAttemptHistory() {
    if (!fs.existsSync(this.historyFile)) return [];
    try {
      return JSON.parse(fs.readFileSync(this.historyFile, 'utf8'));
    } catch (_) {
      return [];
    }
  }

  clearHistory() {
    try {
      if (fs.existsSync(this.historyFile)) {
        fs.unlinkSync(this.historyFile);
      }
    } catch (_) {}
  }
}

async function main() {
  const [mongoUri, historyFile, mode, workerId, targetJobId] = process.argv.slice(2);
  if (!mongoUri) return;

  await mongoose.connect(mongoUri);

  const provider = new FileBackedControlledProvider(historyFile);
  const dispatchService = new ProcurementDispatchService();
  const claimFilter = targetJobId ? { dispatchJobId: targetJobId, status: 'QUEUED' } : { status: 'QUEUED' };

  if (mode === 'TERMINATE_AFTER_CLAIM') {
    // Mode A: Worker claims job in DB, notifies parent, and exits before sending
    const now = new Date();
    const job = await ProcurementDispatchJob.findOneAndUpdate(
      claimFilter,
      {
        $set: {
          status: 'CLAIMED',
          claimedByWorkerId: workerId || `CHILD-${process.pid}`,
          claimedAt: now,
          lockExpiresAt: new Date(Date.now() + 1500), // 1.5-second lease
          fencingToken: 1,
        },
      },
      { new: true }
    );

    if (process.send) {
      process.send({ type: 'CLAIMED', jobId: job ? job.dispatchJobId : null });
    }

    // Immediately terminate worker process before sending
    await mongoose.disconnect();
    process.exit(0);
  } else if (mode === 'TERMINATE_AFTER_PROVIDER_ACCEPT_BEFORE_PERSIST') {
    // Mode B: Worker claims job, sets SENDING, sends email via provider, but terminates BEFORE persisting to DB
    const now = new Date();
    const job = await ProcurementDispatchJob.findOneAndUpdate(
      claimFilter,
      {
        $set: {
          status: 'CLAIMED',
          claimedByWorkerId: workerId || `CHILD-${process.pid}`,
          claimedAt: now,
          lockExpiresAt: new Date(Date.now() + 1500), // 1.5-second lease
          fencingToken: 1,
        },
      },
      { new: true }
    );

    if (!job) {
      await mongoose.disconnect();
      process.exit(1);
    }

    // Mark SENDING in database
    await ProcurementDispatchJob.updateOne(
      { _id: job._id },
      { $set: { status: 'SENDING' } }
    );

    const order = await PurchaseOrder.findOne({ purchaseOrderId: job.purchaseOrderId });

    // Send email via provider (provider records attempt in history file!)
    await dispatchService.dispatchPurchaseOrder({
      dispatchJob: job,
      order,
      revision: order.revisions?.[0],
      provider,
    });

    if (process.send) {
      process.send({ type: 'PROVIDER_ACCEPTED', jobId: job.dispatchJobId });
    }

    // CRITICAL: Terminate worker process right here WITHOUT updating ProcurementDispatchJob or PurchaseOrder!
    await mongoose.disconnect();
    process.exit(1);
  } else {
    // Normal execution
    const outcomes = await dispatchService.runDispatchWorker({
      workerId: workerId || `CHILD-${process.pid}`,
      provider,
      leaseDurationMs: 5000,
    });
    if (process.send) {
      process.send({ type: 'DONE', outcomes });
    }
    await mongoose.disconnect();
    process.exit(0);
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error('[WorkerProcess Error]', err);
    process.exit(1);
  });
}

module.exports = { FileBackedControlledProvider };
