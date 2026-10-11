'use strict';

const TERMINAL_PAYMENT_STATES = [
  'UNCONFIGURED',
  'DISCONNECTED',
  'READY',
  'PAYMENT_INITIATED',
  'PENDING_CUSTOMER_ACTION',
  'AUTHORIZED',
  'CAPTURED',
  'REVERSED',
  'FAILED',
];

class PaymentTerminalAdapter {
  /**
   * Evaluates terminal integration readiness.
   */
  static assessTerminalStatus(deviceOrConfig = {}) {
    const provider = (deviceOrConfig.configuration?.paymentProvider || deviceOrConfig.paymentProvider || 'UNCONFIGURED').toUpperCase();
    const merchantId = deviceOrConfig.configuration?.merchantId || deviceOrConfig.merchantId;
    const terminalId = deviceOrConfig.configuration?.terminalIdentifier || deviceOrConfig.terminalIdentifier;

    if (provider === 'UNCONFIGURED' || !merchantId || !terminalId) {
      return {
        provider,
        status: 'UNCONFIGURED',
        ready: false,
        message: 'Payment terminal credentials (merchantId, terminalIdentifier) are not configured.',
      };
    }

    if (provider === 'MOCK') {
      return {
        provider: 'MOCK',
        status: 'READY',
        ready: true,
        isSimulated: true,
        message: 'Simulated payment terminal adapter active for automated test environments.',
      };
    }

    // For physical Pine Labs / Razorpay POS:
    // Requires live provider connectivity
    return {
      provider,
      status: 'BLOCKED',
      ready: false,
      message: `Physical terminal provider '${provider}' configured but external hardware integration is pending physical terminal handshake.`,
    };
  }

  static initTransaction(args) {
    return this.initiateTransaction(args);
  }

  /**
   * Initiates payment on terminal.
   * Invariant: Does NOT mark transaction as paid on initiation or terminal response.
   */
  static initiateTransaction({ amountPaise, orderId, deviceConfig = {} }) {
    const status = this.assessTerminalStatus(deviceConfig);
    if (!status.ready && !status.isSimulated) {
      return {
        success: false,
        error: 'TERMINAL_NOT_READY',
        status: status.status,
        message: status.message,
      };
    }

    if (!amountPaise || amountPaise <= 0) {
      return {
        success: false,
        error: 'INVALID_AMOUNT',
        message: 'Transaction amount in paise must be positive integer.',
      };
    }

    return {
      success: true,
      transactionRef: `TXN-POS-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      orderId,
      amountPaise,
      currency: 'INR',
      state: 'PENDING_CUSTOMER_ACTION',
      provider: status.provider,
      isSimulated: Boolean(status.isSimulated),
      paid: false, // Critical invariant: NEVER marked paid on initiation!
      initiatedAt: new Date().toISOString(),
    };
  }

  /**
   * Simulates/processes confirmation from provider callback.
   */
  static processTerminalCallback(txnPayload = {}, confirmationCode = '') {
    if (!txnPayload || !txnPayload.transactionRef) {
      return { success: false, error: 'INVALID_TRANSACTION_PAYLOAD' };
    }

    if (confirmationCode === 'SUCCESS_AUTH') {
      return {
        success: true,
        transactionRef: txnPayload.transactionRef,
        orderId: txnPayload.orderId,
        state: 'CAPTURED',
        paid: true,
        capturedAt: new Date().toISOString(),
      };
    }

    if (confirmationCode === 'USER_CANCELLED') {
      return {
        success: false,
        transactionRef: txnPayload.transactionRef,
        state: 'FAILED',
        error: 'PAYMENT_CANCELLED_BY_CUSTOMER',
        paid: false,
      };
    }

    return {
      success: false,
      transactionRef: txnPayload.transactionRef,
      state: 'FAILED',
      error: 'PAYMENT_AUTHORIZATION_FAILED',
      paid: false,
    };
  }
}

module.exports = {
  PaymentTerminalAdapter,
  TERMINAL_PAYMENT_STATES,
};
