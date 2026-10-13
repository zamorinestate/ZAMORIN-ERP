'use strict';

const { Customer } = require('../../models/Customer');
const { ApiError } = require('../../utils/ApiError');

/**
 * Caller ID USB Modem Adapter & Delivery Pop-Up Handler (F097)
 * Intercepts analog PSTN line Caller ID via standard AT+VCID modem commands
 * and generates live pop-up dispatch records for cashier delivery order taking.
 */
class CallerIdModemAdapter {
  /**
   * Parses raw modem serial line output for Caller ID metadata.
   */
  static parseModemString(rawSerial) {
    if (!rawSerial || typeof rawSerial !== 'string') return null;

    const lines = rawSerial.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const result = { raw: rawSerial, phoneNumber: null, phone: null, callerName: null, timestamp: null, valid: false };

    for (const line of lines) {
      if (line.startsWith('NMBR =')) {
        result.phoneNumber = line.replace('NMBR =', '').trim();
        result.phone = result.phoneNumber;
      } else if (line.startsWith('NAME =')) {
        result.callerName = line.replace('NAME =', '').trim();
      } else if (line.startsWith('DATE =') || line.startsWith('TIME =')) {
        result.timestamp = new Date().toISOString();
      }
    }

    result.valid = Boolean(result.phoneNumber);
    return result.phoneNumber ? result : { valid: false, phone: null };
  }

  static parseModemPacket(rawSerial) {
    return this.parseModemString(rawSerial);
  }

  /**
   * Resolves incoming caller details against CRM customer records.
   */
  static async handleIncomingCall({
    phoneNumber,
    phone,
    callerName,
    rawCallerName = 'UNKNOWN',
    organisationId = 'ORG-ZAMORIN',
    cafeId = null,
  }) {
    const inputPhone = phoneNumber || phone;
    if (!inputPhone) {
      throw new ApiError(400, 'PHONE_NUMBER_REQUIRED', 'Phone number is required for Caller ID dispatch.');
    }

    const cleanPhone = String(inputPhone).replace(/[^0-9]/g, '').slice(-10);
    const resolvedName = callerName || rawCallerName || 'New Guest';

    let customer = null;
    try {
      if (Customer && Customer.findOne && Customer.db?.readyState === 1) {
        customer = await Customer.findOne({
          phone: cleanPhone,
          organisationId,
        }).lean();
      }
    } catch {
      // Offline fallback
    }


    const callRecord = {
      success: true,
      callId: `CALL-${Date.now()}-${Math.floor(Math.random() * 900 + 100)}`,
      phoneNumber: cleanPhone,
      customerPhone: cleanPhone,
      customerFound: Boolean(customer),
      customerName: customer?.name || resolvedName,
      customerId: customer?.customerId || null,
      savedAddresses: customer?.addresses || [],
      loyaltyTier: customer?.loyaltyTier || 'BRONZE',
      totalOrdersCount: customer?.metrics?.totalOrders || 0,
      timestamp: new Date().toISOString(),
      actionRecommended: customer ? 'LOAD_CUSTOMER_PROFILE' : 'CREATE_NEW_CUSTOMER',
      dispatchNotice: `📞 Incoming Phone Order from ${customer?.name || resolvedName || cleanPhone}`,
      popupPayload: {
        type: 'CALLER_ID_POPUP',
        phone: cleanPhone,
        customerName: customer?.name || resolvedName,
        customerFound: Boolean(customer),
      },
    };

    return callRecord;
  }

}

module.exports = { CallerIdModemAdapter };
