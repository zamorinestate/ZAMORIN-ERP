'use strict';

const mongoose = require('mongoose');
const { ApiError } = require('./ApiError');

/**
 * Commit a transaction with retry on UnknownTransactionCommitResult.
 * Per MongoDB transaction specification:
 * - If commitTransaction() throws UnknownTransactionCommitResult (or transient network drop during commit),
 *   the driver/application must retry commitTransaction() on the SAME active session.
 * - Under NO circumstance should the business operation be re-executed, as that would duplicate writes.
 * - TransientTransactionError during statement execution is distinct and must be retried from the beginning.
 */
async function commitWithRetry(session, maxAttempts = 3) {
  if (!session || typeof session.commitTransaction !== 'function') return;
  let attempts = 0;
  while (attempts < maxAttempts) {
    try {
      await session.commitTransaction();
      return;
    } catch (error) {
      attempts++;
      const isUnknownCommit =
        (typeof error.hasErrorLabel === 'function' && error.hasErrorLabel('UnknownTransactionCommitResult')) ||
        error.code === 50 ||
        error.code === 91 ||
        (error.message && error.message.includes('UnknownTransactionCommitResult'));
      if (isUnknownCommit) {
        if (attempts < maxAttempts) {
          continue;
        }
        const uncertaintyErr = new ApiError(
          500,
          'TRANSACTION_COMMIT_OUTCOME_UNKNOWN',
          'Transaction commit outcome is unknown after retry attempts. The operation may have committed or aborted; verify durable state before replaying.'
        );
        uncertaintyErr.isUnknownCommitOutcome = true;
        uncertaintyErr.originalError = error;
        throw uncertaintyErr;
      }
      throw error;
    }
  }
}

let _deploymentSupportsTransactions = null;

function checkTopologySupportsTransactions() {
  if (_deploymentSupportsTransactions !== null) return _deploymentSupportsTransactions;
  try {
    const topology = mongoose.connection?.client?.topology;
    const type = topology?.description?.type;
    if (type === 'Single') {
      _deploymentSupportsTransactions = false;
      return false;
    }
  } catch (_) {}
  return true;
}

/**
 * Canonical whole-transaction retry helper.
 * Enforces:
 * 1. Whole transaction retry on TransientTransactionError with fresh session & re-reading fresh DB state.
 * 2. On commit: calls commitWithRetry(session) to handle UnknownTransactionCommitResult on the same session.
 * 3. Never reruns the transaction business body for commit uncertainty.
 * 4. Never converts an unresolved commit outcome into a normal business abort or conflict.
 */
async function executeTransactionWithRetry(operationFn, options = {}) {
  const maxTransientRetries = options.maxTransientRetries || 5;
  const maxCommitRetries = options.maxCommitRetries || 3;
  const canTransact = options.canTransact !== undefined
    ? options.canTransact
    : (mongoose.connection && mongoose.connection.readyState === 1 && typeof mongoose.connection.startSession === 'function' && checkTopologySupportsTransactions());

  if (!canTransact) {
    return await operationFn(null);
  }

  let transientAttempts = 0;
  let lastTransientError = null;

  while (transientAttempts < maxTransientRetries) {
    transientAttempts++;
    let session = null;
    try {
      session = await mongoose.connection.startSession();
      session.startTransaction();

      const result = await operationFn(session);

      await commitWithRetry(session, maxCommitRetries);

      await session.endSession();
      session = null;

      return result;
    } catch (err) {
      if (session) {
        const isUnknownCommit = err.code === 'TRANSACTION_COMMIT_OUTCOME_UNKNOWN' || err.isUnknownCommitOutcome;
        if (!isUnknownCommit) {
          try { await session.abortTransaction(); } catch (_) {}
        }
        try { await session.endSession(); } catch (_) {}
        session = null;
      }

      if (err.message && (err.message.includes('Transaction numbers are only allowed on a replica set member or mongos') || err.message.includes('does not support retryable writes'))) {
        return await operationFn(null);
      }

      const isTransient =
        (typeof err.hasErrorLabel === 'function' && err.hasErrorLabel('TransientTransactionError')) ||
        (Array.isArray(err.errorLabels) && err.errorLabels.includes('TransientTransactionError')) ||
        (err.errorLabelSet && err.errorLabelSet.has && err.errorLabelSet.has('TransientTransactionError')) ||
        (Array.isArray(err.errorResponse?.errorLabels) && err.errorResponse.errorLabels.includes('TransientTransactionError')) ||
        err.code === 112 ||
        err.code === 24 ||
        String(err.codeName || '') === 'LockTimeout' ||
        String(err.message).includes('WriteConflict') ||
        String(err.message).includes('Unable to acquire IX lock');

      if (isTransient && transientAttempts < maxTransientRetries) {
        lastTransientError = err;
        await new Promise((resolve) => setTimeout(resolve, 20 * transientAttempts));
        continue;
      }

      throw err;
    }
  }

  if (lastTransientError) {
    throw lastTransientError;
  }
}

module.exports = {
  commitWithRetry,
  executeTransactionWithRetry,
};
