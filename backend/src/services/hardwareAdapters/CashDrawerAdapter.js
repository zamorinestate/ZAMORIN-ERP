'use strict';

const ESC = 0x1B;

class CashDrawerAdapter {
  /**
   * Builds an ESC/POS drawer kick pulse buffer.
   * Pin 2: ESC p 0 25 250 (50ms on, 500ms off)
   * Pin 5: ESC p 1 25 250
   */
  static buildKickBuffer(pin = 2) {
    const pinByte = pin === 5 ? 0x01 : 0x00;
    return Buffer.from([ESC, 0x70, pinByte, 0x19, 0xFA]);
  }

  /**
   * Generates a cash drawer trigger event payload.
   * Invariant: Does NOT create a cash receipt, settlement, or ledger entry.
   */
  static triggerKick(terminalOrDevice = {}, actor = {}, options = {}) {
    const pin = terminalOrDevice.configuration?.drawerPin || terminalOrDevice.drawerConfig?.pin || 2;
    const kickBuffer = this.buildKickBuffer(pin);

    return {
      success: true,
      deviceId: terminalOrDevice.deviceId || terminalOrDevice.terminalId || 'DEFAULT_DRAWER',
      pin,
      kickBuffer,
      base64Pulse: kickBuffer.toString('base64'),
      triggeredAt: new Date().toISOString(),
      actorUserId: actor.userId || actor.id || 'SYSTEM',
      reason: options.reason || 'Authorized Cash Drawer Pulse',
      transactionId: options.transactionId || null,
      financialMutation: false,
    };
  }
}

module.exports = {
  CashDrawerAdapter,
};
