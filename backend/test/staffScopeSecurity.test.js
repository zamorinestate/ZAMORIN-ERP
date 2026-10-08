'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function authorizationLines(file) {
  const filePath = fs.existsSync(file) ? file : path.resolve(__dirname, '..', file.replace(/^backend\//, ''));
  return fs
    .readFileSync(filePath, 'utf8')
    .split(/\r?\n/)
    .filter((line) => line.includes("authorize('"));
}

test('Staff Scope Security — STAFF is strictly restricted to self-service', async (t) => {
  await t.test('STAFF is excluded from Inventory Stock Movement route authorization', () => {
    const inventoryLines = authorizationLines('backend/src/routes/inventoryRoutes.js');
    assert.ok(inventoryLines.length > 0, 'Expected inventory authorization routes');
    
    // Movement routes and global item creation should never include STAFF
    for (const line of inventoryLines) {
      if (line.includes('INVENTORY_STOCK_MOVEMENT') || line.includes('INVENTORY_MANAGE') || line.includes('INVENTORY_ITEM_CREATE')) {
        assert.equal(line.includes("'STAFF'"), false, `Staff must not be authorized on: ${line.trim()}`);
      }
    }
  });

  await t.test('STAFF is excluded from POS Billing route authorization', () => {
    const billLines = authorizationLines('backend/src/routes/billRoutes.js');
    assert.ok(billLines.length > 0, 'Expected Bill authorization routes');
    for (const line of billLines) {
      assert.equal(line.includes("'STAFF'"), false, `Staff must not be authorized on: ${line.trim()}`);
    }
  });

  await t.test('STAFF is excluded from Vendor management route authorization', () => {
    const vendorLines = authorizationLines('backend/src/routes/vendorRoutes.js');
    assert.ok(vendorLines.length > 0, 'Expected Vendor authorization routes');
    for (const line of vendorLines) {
      assert.equal(line.includes("'STAFF'"), false, `Staff must not be authorized on: ${line.trim()}`);
    }
  });

  await t.test('STAFF is excluded from Procurement route authorization', () => {
    const procurementLines = authorizationLines('backend/src/routes/procurementRoutes.js');
    assert.ok(procurementLines.length > 0, 'Expected Procurement authorization routes');
    for (const line of procurementLines) {
      assert.equal(line.includes("'STAFF'"), false, `Staff must not be authorized on: ${line.trim()}`);
    }
  });

  await t.test('STAFF and legacy CASHIER are excluded from Statutory GST & Till Reconciliation in financeRoutes.js', () => {
    const financeLines = authorizationLines('backend/src/routes/financeRoutes.js');
    assert.ok(financeLines.length > 0, 'Expected Finance authorization routes');
    for (const line of financeLines) {
      assert.equal(line.includes("'STAFF'"), false, `Staff must not be authorized on: ${line.trim()}`);
      assert.equal(line.includes("'CASHIER'"), false, `Legacy Cashier must not be authorized on: ${line.trim()}`);
    }
  });

  await t.test('STAFF is excluded from Owner Governance routes (complaints, loyalty, utilities)', () => {
    const complaintsLines = authorizationLines('backend/src/routes/ownerComplaintsRoutes.js');
    for (const line of complaintsLines) {
      assert.equal(line.includes("'STAFF'"), false, `Staff must not be authorized on: ${line.trim()}`);
    }
    const loyaltyLines = authorizationLines('backend/src/routes/ownerCustomerLoyaltyRoutes.js');
    for (const line of loyaltyLines) {
      assert.equal(line.includes("'STAFF'"), false, `Staff must not be authorized on: ${line.trim()}`);
    }
    const utilitiesLines = authorizationLines('backend/src/routes/ownerUtilitiesWasteRoutes.js');
    for (const line of utilitiesLines) {
      assert.equal(line.includes("'STAFF'"), false, `Staff must not be authorized on: ${line.trim()}`);
    }
  });
});
