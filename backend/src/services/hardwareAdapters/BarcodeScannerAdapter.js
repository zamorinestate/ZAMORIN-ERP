'use strict';

const { RetailScaleAndPrepLabelService } = require('../retailScaleAndPrepLabelService');

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

    // Check retail scale variable barcode first (A105, C02)
    const scaleInfo = RetailScaleAndPrepLabelService.parseScaleBarcode(clean);

    // Determine payload type
    let scanType = 'UNKNOWN';
    if (scaleInfo.isScaleBarcode) {
      scanType = scaleInfo.barcodeType; // VARIABLE_WEIGHT or VARIABLE_PRICE
    } else if (/^\d{13}$/.test(clean)) {
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
      scaleData: scaleInfo.isScaleBarcode ? scaleInfo : null,
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
    const scaleData = parsed.scaleData;

    const matchedItem = menuItems.find((item) => {
      const sku = (item.sku || item.itemCode || item.code || '').toUpperCase();
      const barcode = (item.barcode || '').toUpperCase();
      const itemId = (item.itemId || item._id || '').toString().toUpperCase();
      const plu = (item.plu || item.itemPlu || '').toString().toUpperCase();

      if (scaleData?.itemPlu) {
        return (
          plu === scaleData.itemPlu ||
          sku === scaleData.itemPlu ||
          barcode === scaleData.itemPlu ||
          sku.includes(scaleData.itemPlu)
        );
      }

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

    const basePrice = Number(matchedItem.price || matchedItem.rate || 0);
    let quantity = 1;
    let linePrice = basePrice;

    if (scaleData?.barcodeType === 'VARIABLE_WEIGHT') {
      quantity = scaleData.weightKg;
      linePrice = Math.round(basePrice * scaleData.weightKg);
    } else if (scaleData?.barcodeType === 'VARIABLE_PRICE') {
      linePrice = scaleData.priceRupees;
    }

    return {
      success: true,
      scannedCode: parsed.rawCode,
      scanType: parsed.scanType,
      scaleData: scaleData || null,
      item: {
        itemId: matchedItem.itemId || matchedItem._id,
        name: matchedItem.name,
        price: basePrice,
        linePrice,
        quantity,
        taxRate: Number(matchedItem.taxRate || matchedItem.gstRate || 0),
        category: matchedItem.category || 'GENERAL',
        uom: scaleData?.barcodeType === 'VARIABLE_WEIGHT' ? 'KG' : matchedItem.uom || 'UNIT',
      },
      validatedAt: new Date().toISOString(),
    };
  }
}

module.exports = {
  BarcodeScannerAdapter,
};
