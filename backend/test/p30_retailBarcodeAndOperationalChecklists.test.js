'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  RetailScaleAndPrepLabelService,
  MANDATORY_OPENING_CHECKLIST,
  MANDATORY_CLOSING_CHECKLIST,
} = require('../src/services/retailScaleAndPrepLabelService');
const { BarcodeScannerAdapter } = require('../src/services/hardwareAdapters/BarcodeScannerAdapter');
const auditService = require('../src/services/auditService');

test('Phase P30: Retail Scale Barcodes, Label Studio & Stepwise Checklists Suite', async (t) => {
  const orgId = 'ORG-P30-TEST';
  const cafeId = 'ZC-CAFE-01';

  // ---------------------------------------------------------------------------
  // 1. Variable-Weight & Variable-Price Scale Barcode Parsing (A105 / C02)
  // ---------------------------------------------------------------------------
  await t.test('1. parseScaleBarcode parses variable-weight (20/21) and variable-price (22/23) barcodes', () => {
    // 20 + 00105 (PLU) + 00450 (450g) + 8 (check digit)
    const weightBarcode = '2000105004508';
    const weightResult = RetailScaleAndPrepLabelService.parseScaleBarcode(weightBarcode);

    assert.equal(weightResult.isScaleBarcode, true);
    assert.equal(weightResult.barcodeType, 'VARIABLE_WEIGHT');
    assert.equal(weightResult.itemPlu, '00105');
    assert.equal(weightResult.weightGrams, 450);
    assert.equal(weightResult.weightKg, 0.45);

    // 22 + 00210 (PLU) + 01250 (₹1,250) + 4 (check digit)
    const priceBarcode = '2200210012504';
    const priceResult = RetailScaleAndPrepLabelService.parseScaleBarcode(priceBarcode);

    assert.equal(priceResult.isScaleBarcode, true);
    assert.equal(priceResult.barcodeType, 'VARIABLE_PRICE');
    assert.equal(priceResult.itemPlu, '00210');
    assert.equal(priceResult.priceRupees, 1250);
    assert.equal(priceResult.pricePaisa, 125000);

    // Non-scale EAN-13 (Standard CPG product)
    const standardEan = '8901030383749';
    const standardResult = RetailScaleAndPrepLabelService.parseScaleBarcode(standardEan);
    assert.equal(standardResult.isScaleBarcode, false);
  });

  // ---------------------------------------------------------------------------
  // 2. BarcodeScannerAdapter Integration with Scale Barcodes
  // ---------------------------------------------------------------------------
  await t.test('2. BarcodeScannerAdapter dynamically computes weighed line price on scan', () => {
    const mockMenuItems = [
      {
        itemId: 'ITEM-ROAST-BEANS',
        name: 'Single Origin Arabica Beans',
        plu: '00105',
        price: 180000, // ₹1,800 per KG (180000 paise)
        taxRate: 5,
        category: 'COFFEE_BEANS',
        uom: 'KG',
      },
    ];

    // Scanned: 450 grams of beans (0.45 kg @ ₹1,800/kg -> ₹810)
    const scannedScaleBarcode = '2000105004508';
    const scanResult = BarcodeScannerAdapter.validateItemScan(scannedScaleBarcode, mockMenuItems, cafeId);

    assert.equal(scanResult.success, true);
    assert.equal(scanResult.scanType, 'VARIABLE_WEIGHT');
    assert.ok(scanResult.scaleData);
    assert.equal(scanResult.scaleData.weightKg, 0.45);

    // Item details
    assert.equal(scanResult.item.name, 'Single Origin Arabica Beans');
    assert.equal(scanResult.item.quantity, 0.45);
    assert.equal(scanResult.item.price, 180000);
    assert.equal(scanResult.item.linePrice, 81000); // ₹810 (81000 paise)
    assert.equal(scanResult.item.uom, 'KG');
  });

  // ---------------------------------------------------------------------------
  // 3. Thermal Prep Sticky Label Compilation (F178-F184)
  // ---------------------------------------------------------------------------
  await t.test('3. generatePrepStickyLabel compiles FSSAI-compliant label text and ZPL output', () => {
    const prepDate = new Date('2026-10-12T08:00:00Z');
    const labelData = RetailScaleAndPrepLabelService.generatePrepStickyLabel({
      itemName: 'Artisanal Sourdough Batard',
      batchNumber: 'BATCH-20261012-01',
      prepDate,
      shelfLifeHours: 36,
      storageCondition: 'AMBIENT (COOL DRY PLACE)',
      allergens: ['WHEAT', 'GLUTEN'],
      netWeight: '500g',
      mrpPaisa: 28000, // ₹280.00
      fssaiLicenseNumber: '10020042000123',
      preparedBy: 'Head Baker Arjun',
    });

    assert.ok(labelData.labelText.includes('ARTISANAL SOURDOUGH BATARD'));
    assert.ok(labelData.labelText.includes('BATCH-20261012-01'));
    assert.ok(labelData.labelText.includes('ALLERGENS: WHEAT, GLUTEN'));
    assert.ok(labelData.labelText.includes('FSSAI LIC: 10020042000123'));
    assert.ok(labelData.labelText.includes('MRP: ₹280.00'));
    assert.equal(labelData.isCompliantFssai, true);

    // Verify ZPL output
    assert.ok(labelData.zplString.startsWith('^XA'));
    assert.ok(labelData.zplString.endsWith('^XZ'));
    assert.ok(labelData.zplString.includes('ARTISANAL SOURDOUGH BATARD'));
  });

  // ---------------------------------------------------------------------------
  // 4. Stepwise Shift SOP Checklist Enforcement (F326-F333)
  // ---------------------------------------------------------------------------
  await t.test('4. submitShiftChecklist rejects incomplete checklist and verifies full submission', async () => {
    const origAudit = auditService.recordAuditEvent;
    auditService.recordAuditEvent = async () => ({ success: true });

    try {
      // Incomplete Opening Checklist (missing MILK_TEMPERATURE_CHECKED and DISPLAY_CABINETS_STOCKED)
      const incompleteItems = [
        { code: 'DRAWER_FLOAT_COUNTED', completed: true },
        { code: 'COFFEE_MACHINE_CALIBRATED', completed: true },
        { code: 'EQUIPMENT_POWERED_ON', completed: true },
      ];

      await assert.rejects(
        async () => {
          await RetailScaleAndPrepLabelService.submitShiftChecklist({
            organisationId: orgId,
            cafeId,
            shiftType: 'OPENING',
            checklistItems: incompleteItems,
            actorUserId: 'USR-BARISTA-1',
          });
        },
        (err) => {
          assert.equal(err.code, 'CHECKLIST_INCOMPLETE');
          assert.ok(err.message.includes('MILK_TEMPERATURE_CHECKED'));
          return true;
        }
      );

      // Complete Opening Checklist
      const completeItems = MANDATORY_OPENING_CHECKLIST.map((code) => ({
        code,
        completed: true,
      }));

      const res = await RetailScaleAndPrepLabelService.submitShiftChecklist({
        organisationId: orgId,
        cafeId,
        shiftType: 'OPENING',
        checklistItems: completeItems,
        actorUserId: 'USR-BARISTA-1',
        supervisorNotes: 'All machines calibrated at 9.2 bars pressure',
        auth: { userId: 'USR-BARISTA-1', role: 'STAFF' },
      });

      assert.equal(res.status, 'VERIFIED_COMPLETED');
      assert.equal(res.mandatoryCompletedCount, 5);
      assert.ok(res.submissionId.startsWith('CHK-OPE-'));
      assert.equal(res.supervisorNotes, 'All machines calibrated at 9.2 bars pressure');
    } finally {
      auditService.recordAuditEvent = origAudit;
    }
  });
});
