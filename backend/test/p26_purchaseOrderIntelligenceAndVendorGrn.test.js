'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { ThreeWayMatchService } = require('../src/services/threeWayMatchService');
const { ProcurementApprovalService } = require('../src/services/procurementApprovalService');
const SupplierPriceVarianceService = require('../src/services/supplierPriceVarianceService');
const { Vendor } = require('../src/models/Vendor');
const { GlobalInventoryItem } = require('../src/models/GlobalInventoryItem');
const { User } = require('../src/models/User');

test('Phase P26: Purchase Order Intelligence & Vendor GRN Audits Suite', async (t) => {
  const orgId = 'ORG-P26-TEST';
  const cafeId = 'ZC-CAFE-01';

  // ---------------------------------------------------------------------------
  // 1. F046-F055: Multi-Tier PO Approval Level Evaluation
  // ---------------------------------------------------------------------------
  await t.test('1. F046-F055: Multi-tier approval thresholds classify low, mid, and high-value orders', () => {
    // Low value: ₹15,000 (1500000 paise)
    const tier1 = ProcurementApprovalService.evaluateApprovalTier(1500000);
    assert.equal(tier1.tier, 'TIER_1_LOW');
    assert.ok(tier1.allowedRoles.includes('CAFE_ADMIN'));
    assert.ok(tier1.allowedRoles.includes('OWNER'));
    assert.ok(tier1.allowedRoles.includes('MASTER'));

    // Mid value: ₹45,000 (4500000 paise)
    const tier2 = ProcurementApprovalService.evaluateApprovalTier(4500000);
    assert.equal(tier2.tier, 'TIER_2_MID');
    assert.equal(tier2.requiresOwner, true);
    assert.ok(!tier2.allowedRoles.includes('CAFE_ADMIN'), 'Cafe Admin cannot approve mid-tier orders');
    assert.ok(tier2.allowedRoles.includes('OWNER'));
    assert.ok(tier2.allowedRoles.includes('MASTER'));

    // High value: ₹1,50,000 (15000000 paise)
    const tier3 = ProcurementApprovalService.evaluateApprovalTier(15000000);
    assert.equal(tier3.tier, 'TIER_3_HIGH');
    assert.equal(tier3.requiresMaster, true);
    assert.ok(!tier3.allowedRoles.includes('CAFE_ADMIN'));
    assert.ok(!tier3.allowedRoles.includes('OWNER'), 'Owner cannot approve enterprise-tier orders');
    assert.ok(tier3.allowedRoles.includes('MASTER'));
  });

  // ---------------------------------------------------------------------------
  // 2. F046-F055: Role Authority Assertions across Slabs
  // ---------------------------------------------------------------------------
  await t.test('2. F046-F055: Asserts purchasing authority enforces amount boundaries per role', async () => {
    const origUserFindOne = User.findOne;

    User.findOne = (query) => {
      let role = 'CAFE_ADMIN';
      if (query.userId === 'USR-OWNER') role = 'OWNER';
      if (query.userId === 'USR-MASTER') role = 'MASTER';
      return {
        lean: async () => ({
          userId: query.userId,
          organisationId: orgId,
          role,
          accountStatus: 'ACTIVE',
          primaryCafeId: cafeId,
          isPrimaryMaster: role === 'MASTER',
        }),
      };
    };

    // Cafe Admin with ₹15,000 PO -> allowed
    const adminLow = await ProcurementApprovalService.assertPurchasingAuthority(
      { userId: 'USR-ADMIN', organisationId: orgId },
      cafeId,
      'APPROVE',
      1500000
    );
    assert.equal(adminLow.authorized, true);

    // Cafe Admin with ₹45,000 PO -> rejected with APPROVAL_THRESHOLD_EXCEEDED
    await assert.rejects(
      async () => {
        await ProcurementApprovalService.assertPurchasingAuthority(
          { userId: 'USR-ADMIN', organisationId: orgId },
          cafeId,
          'APPROVE',
          4500000
        );
      },
      (err) => err.code === 'APPROVAL_THRESHOLD_EXCEEDED' || /exceeds Café Operations/i.test(err.message)
    );

    // Owner with ₹45,000 PO -> allowed
    const ownerMid = await ProcurementApprovalService.assertPurchasingAuthority(
      { userId: 'USR-OWNER', organisationId: orgId },
      cafeId,
      'APPROVE',
      4500000
    );
    assert.equal(ownerMid.authorized, true);
    assert.equal(ownerMid.isOwnerApproved, true);

    // Owner with ₹1,50,000 PO -> rejected (requires Master)
    await assert.rejects(
      async () => {
        await ProcurementApprovalService.assertPurchasingAuthority(
          { userId: 'USR-OWNER', organisationId: orgId },
          cafeId,
          'APPROVE',
          15000000
        );
      },
      (err) => err.code === 'FORBIDDEN_ROLE' || /requires Primary Master/i.test(err.message)
    );

    // Master with ₹1,50,000 PO -> allowed
    const masterHigh = await ProcurementApprovalService.assertPurchasingAuthority(
      { userId: 'USR-MASTER', organisationId: orgId },
      cafeId,
      'APPROVE',
      15000000
    );
    assert.equal(masterHigh.authorized, true);

    User.findOne = origUserFindOne;
  });

  // ---------------------------------------------------------------------------
  // 3. F147-F149: Landed Freight Cost Proportional Distribution
  // ---------------------------------------------------------------------------
  await t.test('3. F147-F149: Distributes additional freight and packaging costs across line items', () => {
    const lineItems = [
      { itemId: 'INV-COFFEE-01', orderedQuantityBase: 10, unitPricePaisa: 100000, totalLinePaisa: 1000000 }, // ₹10,000 (50% of value)
      { itemId: 'INV-TEA-01', orderedQuantityBase: 20, unitPricePaisa: 30000, totalLinePaisa: 600000 },      // ₹6,000 (30% of value)
      { itemId: 'INV-SUGAR-01', orderedQuantityBase: 80, unitPricePaisa: 5000, totalLinePaisa: 400000 },     // ₹4,000 (20% of value)
    ]; // Total Goods Value: ₹20,000 (2000000 paise)

    // Additional freight ₹1,200 (120000 paise) + Packaging ₹300 (30000 paise) = ₹1,500 (150000 paise)
    const result = ThreeWayMatchService.distributeLandedCost({
      lineItems,
      additionalCharges: {
        freightPaisa: 120000,
        packagingPaisa: 30000,
      },
      distributionMethod: 'VALUE',
    });

    assert.equal(result.totalAdditionalPaisa, 150000);
    assert.equal(result.lineItems.length, 3);

    // Line 1: 50% of 150000 = 75000 paise allocated
    const line1 = result.lineItems[0];
    assert.equal(line1.allocatedLandedPaisa, 75000);
    assert.equal(line1.landedTotalPaisa, 1075000); // 1000000 + 75000
    assert.equal(line1.landedUnitCostPaisa, 107500); // 1075000 / 10 = ₹1,075 per kg

    // Line 2: 30% of 150000 = 45000 paise allocated
    const line2 = result.lineItems[1];
    assert.equal(line2.allocatedLandedPaisa, 45000);
    assert.equal(line2.landedTotalPaisa, 645000);

    // Line 3: 20% of 150000 = 30000 paise allocated
    const line3 = result.lineItems[2];
    assert.equal(line3.allocatedLandedPaisa, 30000);
    assert.equal(line3.landedTotalPaisa, 430000);

    // Exact sum preservation
    const totalAllocated = result.lineItems.reduce((acc, l) => acc + l.allocatedLandedPaisa, 0);
    assert.equal(totalAllocated, 150000, 'Sum of allocated charges must equal total additional charges');
  });

  // ---------------------------------------------------------------------------
  // 4. A047-A052: Three-Way Matching with Configurable Quantity Tolerances
  // ---------------------------------------------------------------------------
  await t.test('4. A047-A052: Evaluates 3-way match applying quantity tolerance thresholds', () => {
    const purchaseOrder = {
      purchaseOrderId: 'PO-TEST-001',
      totalPaisa: 500000,
      lineItems: [
        { itemId: 'INV-COFFEE-01', orderedQuantityBase: 50, receivedQuantityBase: 50, unitPricePaisa: 10000, totalLinePaisa: 500000 },
      ],
    };
    const grn = {
      items: [{ itemId: 'INV-COFFEE-01', acceptedQty: 50 }],
    };

    // Sub-test A: Within 2% tolerance (51 kg invoiced vs 50 kg received -> 2% allowance is 51 kg)
    const invoiceWithinTolerance = {
      totalPaisa: 510000,
      lineItems: [
        { itemId: 'INV-COFFEE-01', quantity: 51, unitPricePaisa: 10000 },
      ],
    };

    const matchWithTolerance = ThreeWayMatchService.performMatch({
      purchaseOrder,
      grn,
      supplierInvoice: invoiceWithinTolerance,
      toleranceConfig: { qtyTolerancePercent: 2, rateTolerancePaisa: 100, totalTolerancePaisa: 20000 },
    });

    assert.equal(matchWithTolerance.isMatched, true, 'Invoice within 2% tolerance must match');
    assert.equal(matchWithTolerance.matchStatus, 'MATCHED');

    // Sub-test B: Exceeds 2% tolerance (53 kg invoiced vs 50 kg received -> 6% variance)
    const invoiceExceedingTolerance = {
      totalPaisa: 530000,
      lineItems: [
        { itemId: 'INV-COFFEE-01', quantity: 53, unitPricePaisa: 10000 },
      ],
    };

    const matchExceeded = ThreeWayMatchService.performMatch({
      purchaseOrder,
      grn,
      supplierInvoice: invoiceExceedingTolerance,
      toleranceConfig: { qtyTolerancePercent: 2, rateTolerancePaisa: 100, totalTolerancePaisa: 20000 },
    });

    assert.equal(matchExceeded.isMatched, false);
    assert.equal(matchExceeded.matchStatus, 'VARIANCE_FLAGGED');
    assert.ok(matchExceeded.discrepancies.length > 0);
    assert.ok(/exceeds received quantity/i.test(matchExceeded.discrepancies[0].issues[0]));
  });

  // ---------------------------------------------------------------------------
  // 5. F154-F155: Real-Time Supplier Price Variance & Spike Alerts
  // ---------------------------------------------------------------------------
  await t.test('5. F154-F155: Detects price spikes against vendor catalogue and past purchases', async () => {
    const origVendorFindOne = Vendor.findOne;
    const origItemFindOne = GlobalInventoryItem.findOne;

    Vendor.findOne = (query) => ({
      lean: async () => ({
        vendorId: query.vendorId,
        catalogue: [
          { itemId: 'INV-BEANS-01', unitPricePaisa: 80000 }, // ₹800 contracted
        ],
      }),
    });

    GlobalInventoryItem.findOne = () => ({
      lean: async () => null,
    });

    // Sub-test A: Proposed price ₹820 (2.5% increase) -> STABLE (<= 5%)
    const resStable = await SupplierPriceVarianceService.checkLineItemPriceVariance({
      itemId: 'INV-BEANS-01',
      proposedUnitPricePaisa: 82000,
      organisationId: orgId,
      vendorId: 'VEND-01',
    });
    assert.equal(resStable.severity, 'STABLE');
    assert.equal(resStable.isAlert, false);

    // Sub-test B: Proposed price ₹880 (10% increase) -> MATERIAL_INCREASE alert
    const resMaterial = await SupplierPriceVarianceService.checkLineItemPriceVariance({
      itemId: 'INV-BEANS-01',
      proposedUnitPricePaisa: 88000,
      organisationId: orgId,
      vendorId: 'VEND-01',
    });
    assert.equal(resMaterial.severity, 'MATERIAL_INCREASE');
    assert.equal(resMaterial.isAlert, true);
    assert.equal(resMaterial.variancePercent, 10.00);

    // Sub-test C: Proposed price ₹960 (20% increase) -> SEVERE_INCREASE alert
    const resSevere = await SupplierPriceVarianceService.checkLineItemPriceVariance({
      itemId: 'INV-BEANS-01',
      proposedUnitPricePaisa: 96000,
      organisationId: orgId,
      vendorId: 'VEND-01',
    });
    assert.equal(resSevere.severity, 'SEVERE_INCREASE');
    assert.equal(resSevere.isAlert, true);
    assert.equal(resSevere.variancePercent, 20.00);

    Vendor.findOne = origVendorFindOne;
    GlobalInventoryItem.findOne = origItemFindOne;
  });
});
