'use strict';

/**
 * RETAIL SCALE BARCODES, PREP LABELS & SHIFT CHECKLISTS (A105 / C02 / F178-F184 / F326-F333)
 *
 * Implements:
 *  1. Variable-weight & variable-price scale barcode parser (EAN-13 prefixes 20/21/22/23)
 *  2. Thermal prep sticky label compilation (ESC/POS & ZPL for packaging, batching & FSSAI)
 *  3. Stepwise Opening & Closing shift SOP checklist validation
 */

const { ApiError } = require('../utils/ApiError');
const auditService = require('./auditService');

const MANDATORY_OPENING_CHECKLIST = [
  'DRAWER_FLOAT_COUNTED',
  'COFFEE_MACHINE_CALIBRATED',
  'MILK_TEMPERATURE_CHECKED',
  'EQUIPMENT_POWERED_ON',
  'DISPLAY_CABINETS_STOCKED',
];

const MANDATORY_CLOSING_CHECKLIST = [
  'REGISTER_SETTLED_ZREPORT',
  'STEAM_WANDS_PURGED_CLEANED',
  'PERISHABLES_STORED_COVERED',
  'DRAWER_COUNT_VERIFIED',
  'POWER_EQUIPMENT_OFF',
];

class RetailScaleAndPrepLabelService {
  /**
   * Parse variable-weight / variable-price retail scale barcode (A105 / C02)
   * Formats:
   *  - 20xxxxxWWWWWC / 21xxxxxWWWWWC: Variable Weight (WWWWW = grams, e.g. 00450 -> 450g / 0.45kg)
   *  - 22xxxxxAAAAAC / 23xxxxxAAAAAC: Variable Price (AAAAA = Rupees or Paise)
   */
  static parseScaleBarcode(barcode) {
    if (!barcode || typeof barcode !== 'string') {
      return { isScaleBarcode: false, error: 'INVALID_BARCODE' };
    }

    const clean = barcode.trim();
    if (!/^\d{13}$/.test(clean)) {
      return { isScaleBarcode: false };
    }

    const prefix = clean.slice(0, 2);
    const itemPlu = clean.slice(2, 7);
    const dataPart = clean.slice(7, 12);
    const checkDigit = clean.slice(12, 13);

    // Variable-Weight Barcode (20 or 21)
    if (prefix === '20' || prefix === '21') {
      const weightGrams = parseInt(dataPart, 10);
      const weightKg = Number((weightGrams / 1000).toFixed(3));

      return {
        isScaleBarcode: true,
        barcodeType: 'VARIABLE_WEIGHT',
        prefix,
        itemPlu,
        itemCode: `PLU-${itemPlu}`,
        weightGrams,
        weightKg,
        checkDigit,
        rawBarcode: clean,
      };
    }

    // Variable-Price Barcode (22 or 23)
    if (prefix === '22' || prefix === '23') {
      const priceRupees = parseInt(dataPart, 10);
      const pricePaisa = priceRupees * 100;

      return {
        isScaleBarcode: true,
        barcodeType: 'VARIABLE_PRICE',
        prefix,
        itemPlu,
        itemCode: `PLU-${itemPlu}`,
        priceRupees,
        pricePaisa,
        checkDigit,
        rawBarcode: clean,
      };
    }

    return { isScaleBarcode: false };
  }

  /**
   * Generate Thermal Prep Sticky Label (ESC/POS & ZPL) (F178-F184)
   */
  static generatePrepStickyLabel({
    itemName,
    batchNumber,
    prepDate = new Date(),
    shelfLifeHours = 48,
    storageCondition = 'REFRIGERATED (2°C - 4°C)',
    allergens = [],
    netWeight = '',
    mrpPaisa = 0,
    fssaiLicenseNumber = '10020042000123',
    preparedBy = 'Bakery Team',
    barcode = null,
    dimensions = { widthMm: 50, heightMm: 35 },
  }) {
    if (!itemName) {
      throw new ApiError(400, 'VALIDATION_FAILED', 'itemName is required for prep label generation.');
    }

    const prep = prepDate instanceof Date ? prepDate : new Date(prepDate);
    const expiry = new Date(prep.getTime() + shelfLifeHours * 60 * 60 * 1000);

    const formattedPrepDate = prep.toISOString().slice(0, 16).replace('T', ' ');
    const formattedExpiryDate = expiry.toISOString().slice(0, 16).replace('T', ' ');
    const batch = batchNumber || `BATCH-${prep.toISOString().slice(0, 10).replace(/-/g, '')}`;

    const textLines = [
      '========================================',
      `  ZAMORIN CAFE & ARTISANAL ROASTERY    `,
      '========================================',
      `ITEM: ${itemName.toUpperCase()}`,
      `BATCH: ${batch}`,
      barcode ? `BARCODE: ${barcode}` : null,
      `PACKED: ${formattedPrepDate}`,
      `USE BY: ${formattedExpiryDate}`,
      `STORAGE: ${storageCondition}`,
      allergens.length > 0 ? `ALLERGENS: ${allergens.join(', ')}` : 'ALLERGENS: NIL',
      netWeight ? `NET WT: ${netWeight}` : null,
      mrpPaisa > 0 ? `MRP: ₹${(mrpPaisa / 100).toFixed(2)} (INCL. TAXES)` : null,
      `FSSAI LIC: ${fssaiLicenseNumber}`,
      `PREP BY: ${preparedBy}`,
      '========================================',
    ].filter(Boolean);

    const labelText = textLines.join('\n');

    // Build ZPL (Zebra Programming Language) string for direct thermal label printers with A043 Code128 barcode
    const zplString = [
      '^XA',
      '^CF0,30',
      '^FO50,40^FDZAMORIN CAFE^FS',
      '^CF0,24',
      `^FO50,80^FD${itemName.toUpperCase()}^FS`,
      `^FO50,110^FDBatch: ${batch}^FS`,
      `^FO50,135^FDPacked: ${formattedPrepDate}^FS`,
      `^FO50,160^FDUSE BY: ${formattedExpiryDate}^FS`,
      `^FO50,185^FD${storageCondition}^FS`,
      barcode ? `^FO50,215^BCN,50,Y,N,N^FD${barcode}^FS` : '',
      `^FO50,280^FDFSSAI: ${fssaiLicenseNumber}^FS`,
      '^XZ',
    ].filter(Boolean).join('\n');

    return {
      itemName,
      batchNumber: batch,
      barcode,
      dimensions,
      prepDate: formattedPrepDate,
      expiryDate: formattedExpiryDate,
      shelfLifeHours,
      storageCondition,
      allergens,
      netWeight,
      mrpFormatted: mrpPaisa > 0 ? `₹${(mrpPaisa / 100).toFixed(2)}` : null,
      fssaiLicenseNumber,
      labelText,
      zplString,
      isCompliantFssai: Boolean(fssaiLicenseNumber && formattedExpiryDate),
    };
  }

  /**
   * Validate & Submit Stepwise Shift SOP Checklist (F326-F333)
   */
  static async submitShiftChecklist({
    organisationId,
    cafeId,
    shiftType = 'OPENING',
    checklistItems = [],
    actorUserId,
    supervisorNotes = '',
    auth = null,
  }) {
    if (!organisationId || !cafeId) {
      throw new ApiError(400, 'VALIDATION_FAILED', 'organisationId and cafeId are required.');
    }

    const normType = String(shiftType).trim().toUpperCase();
    if (!['OPENING', 'CLOSING', 'MID_DAY'].includes(normType)) {
      throw new ApiError(400, 'INVALID_SHIFT_TYPE', `Invalid shift type ${shiftType}. Must be OPENING or CLOSING.`);
    }

    const mandatoryList = normType === 'OPENING' ? MANDATORY_OPENING_CHECKLIST : MANDATORY_CLOSING_CHECKLIST;
    const completedSet = new Set(
      checklistItems
        .filter((it) => it.completed === true || it.checked === true || it.status === 'PASS')
        .map((it) => String(it.code || it.itemKey || it.name).toUpperCase())
    );

    const missingMandatory = mandatoryList.filter((m) => !completedSet.has(m));
    if (missingMandatory.length > 0) {
      throw new ApiError(
        422,
        'CHECKLIST_INCOMPLETE',
        `Mandatory shift ${normType} SOP checks not completed: ${missingMandatory.join(', ')}.`
      );
    }

    const submissionId = `CHK-${normType.slice(0, 3)}-${Date.now().toString(36).toUpperCase()}`;
    const effectiveUserId = actorUserId || auth?.userId || 'STAFF';

    const checklistResult = {
      submissionId,
      organisationId,
      cafeId,
      shiftType: normType,
      status: 'VERIFIED_COMPLETED',
      totalItemsChecked: checklistItems.length,
      mandatoryCompletedCount: mandatoryList.length,
      actorUserId: effectiveUserId,
      supervisorNotes: supervisorNotes || '',
      completedAt: new Date().toISOString(),
    };

    if (auth) {
      await auditService.recordAuditEvent({
        organisationId,
        cafeId,
        userId: effectiveUserId,
        eventCategory: 'OPERATIONS',
        eventType: `SHIFT_${normType}_CHECKLIST_COMPLETED`,
        resourceType: 'ShiftChecklist',
        resourceId: submissionId,
        details: checklistResult,
      });
    }

    return checklistResult;
  }
}

module.exports = {
  RetailScaleAndPrepLabelService,
  MANDATORY_OPENING_CHECKLIST,
  MANDATORY_CLOSING_CHECKLIST,
};
