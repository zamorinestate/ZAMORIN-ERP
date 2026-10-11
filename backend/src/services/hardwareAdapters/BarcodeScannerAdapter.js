'use strict';

class BarcodeScannerAdapter {
  /**
   * Sanitizes and parses raw scanner input.
   */
  static parseScanInput(rawInput) {
    if (typeof rawInput !== 'string') {
      return { success: false, error: 'INVALID_SCAN_INPUT', message: 'Barcode scan input must be a string.' };
    }

    const clean = rawInput.replace(/[\r\n\x00-\x1F\x7F]/g, '').trim();
    if (!clean) {
      return { success: false, error: 'EMPTY_SCAN_DATA', message: 'Scanner payload is empty.' };
    }

    // Determine payload type
    let scanType = 'UNKNOWN';
    if (/^\d{13}$/.test(clean)) {
      scanType = 'EAN13';
    } else if (/^\d{12}$/.test(clean)) {
      scanType = 'UPCA';
    } else if (/^EMP-[A-Z0-9]+$/i.test(clean)) {
      scanType = 'EMPLOYEE_BADGE';
    } else if (/^ZC-BILL-[A-Z0-9-]+$/i.test(clean) || /^BILL-[A-Z0-9-]+$/i.test(clean)) {
      scanType = 'BILL_BARCODE';
    } else if (/^ZC-[A-Z0-9-]+$/i.test(clean) || /^SKU-[A-Z0-9-]+$/i.test(clean)) {
      scanType = 'ITEM_SKU';
    } else {
      scanType = 'GENERIC_BARCODE';
    }

    return {
      success: true,
      rawCode: clean,
      scanType,
      scannedAt: new Date().toISOString(),
    };
  }

  /**
   * Resolves and validates a scanned code against the active menu items catalogue.
   * Enforces item availability, pricing invariants, and cafe scoping.
   */
  static validateItemScan(scannedCode, menuItems = [], cafeId = null) {
    const parsed = this.parseScanInput(scannedCode);
    if (!parsed.success) {
      return parsed;
    }

    const code = parsed.rawCode.toUpperCase();
    const matchedItem = menuItems.find((item) => {
      const sku = (item.sku || item.itemCode || item.code || '').toUpperCase();
      const barcode = (item.barcode || '').toUpperCase();
      const itemId = (item.itemId || item._id || '').toString().toUpperCase();
      return sku === code || barcode === code || itemId === code;
    });

    if (!matchedItem) {
      return {
        success: false,
        error: 'ITEM_NOT_FOUND',
        message: `Scanned code '${parsed.rawCode}' does not match any active item in catalogue.`,
        scannedCode: parsed.rawCode,
      };
    }

    // Check availability (sold-out or disabled)
    if (matchedItem.soldOut === true || matchedItem.isSoldOut === true || matchedItem.available === false) {
      return {
        success: false,
        error: 'ITEM_UNAVAILABLE',
        message: `Item '${matchedItem.name}' is currently marked sold out.`,
        item: {
          itemId: matchedItem.itemId || matchedItem._id,
          name: matchedItem.name,
          soldOut: true,
        },
      };
    }

    if (matchedItem.isActive === false || matchedItem.status === 'INACTIVE') {
      return {
        success: false,
        error: 'ITEM_INACTIVE',
        message: `Item '${matchedItem.name}' is currently inactive in the catalogue.`,
        item: {
          itemId: matchedItem.itemId || matchedItem._id,
          name: matchedItem.name,
          active: false,
        },
      };
    }

    return {
      success: true,
      scannedCode: parsed.rawCode,
      scanType: parsed.scanType,
      item: {
        itemId: matchedItem.itemId || matchedItem._id,
        name: matchedItem.name,
        price: Number(matchedItem.price || matchedItem.rate || 0),
        taxRate: Number(matchedItem.taxRate || matchedItem.gstRate || 0),
        category: matchedItem.category || 'GENERAL',
        uom: matchedItem.uom || 'UNIT',
      },
      validatedAt: new Date().toISOString(),
    };
  }
}

module.exports = {
  BarcodeScannerAdapter,
};
