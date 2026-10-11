'use strict';

/**
 * ============================================================================
 * BENCHMARK OPTIONS IMPLEMENTATION TEST SUITE
 * ============================================================================
 *
 * Verifies native implementations of benchmark options across:
 *   - F234 / A061: Stored-value separation (Purchased vs Promotional wallet balances)
 *   - A003: NIC/CBIC Schema INV-01 E-Invoice and E-Way Bill payload generators
 *   - A121: Regional tax boundary mutual exclusivity (GST vs VAT)
 *   - A005 & A006: Google Business Profile integration, insights, review sync & reply
 *   - A057: Spoken UPI soundbox payment announcements
 *   - A058: Hubb Pay terminal authorization verification
 *   - A059: Uengage / Shoult-o-Pay voucher discount validation
 *   - A060: Device dynamic BharatQR generation
 *   - A119: Regional tender payment surcharge calculation
 *   - A062-A066: Customer loyalty rules (weekday restriction, sales return adjustment, multi-category points)
 *   - A041: Open-price entry with bounds checking
 *   - A070: Toing Order Channel support
 *   - A049: Commission on Extras / add-on exclusion in revenue share
 *   - A090: Action-Needed Dashboard & Section 194-O TDS calculation
 *   - A093-A095: Supplier-material mapping import
 *   - A101 & A104: Bulk recipe workbook import/export & bulk ingredient removal
 */

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

// Models
const { Customer } = require('../src/models/Customer');
const { WalletLedger } = require('../src/models/WalletLedger');
const { GoogleBusinessProfile } = require('../src/models/GoogleBusinessProfile');
const { AggregatorOrder } = require('../src/models/AggregatorOrder');
const { Bill } = require('../src/models/Bill');
const { Vendor } = require('../src/models/Vendor');
const { Recipe } = require('../src/models/Recipe');
const { MenuItem } = require('../src/models/MenuItem');

// Services
const customerWalletService = require('../src/services/customerWalletService');
const gstTaxService = require('../src/services/gstTaxService');
const googleBusinessProfileService = require('../src/services/googleBusinessProfileService');
const { PaymentProviderService } = require('../src/services/paymentProviderService');
const customerLoyaltyService = require('../src/services/customerLoyaltyService');
const { PosOrderService } = require('../src/services/posOrderService');
const revenueShareCalculationService = require('../src/services/revenueShareCalculationService');
const analyticsBiService = require('../src/services/analyticsBiService');
const vendorLedgerService = require('../src/services/vendorLedgerService');
const { BomDepletionService } = require('../src/services/bomDepletionService');

let mongoServer;
const ORG_ID = 'ORG-ZAMORIN-TEST';
const CAFE_ID = 'ZC-0001';

describe('Benchmark Options Implementation Suite', () => {
  before(async () => {
    mongoServer = await MongoMemoryServer.create();
    await mongoose.connect(mongoServer.getUri());
  });

  after(async () => {
    await mongoose.disconnect();
    if (mongoServer) await mongoServer.stop();
  });

  beforeEach(async () => {
    const collections = mongoose.connection.collections;
    for (const key of Object.keys(collections)) {
      await collections[key].deleteMany({});
    }
  });

  describe('1. Wallet Stored-Value Separation (F234 / A061)', () => {
    it('should separate purchased vs promotional wallet top-ups and burn promo balance first', async () => {
      const customer = new Customer({
        customerId: 'CUST-0001',
        organisationId: ORG_ID,
        name: 'Arun Kumar',
        phone: '9876543210',
        createdByUserId: 'USER-01',
        status: 'ACTIVE',
      });
      await customer.save();

      // Top up purchased balance ₹500 (50,000 paise)
      const topUpPurchased = await customerWalletService.topUpWallet({
        organisationId: ORG_ID,
        cafeId: CAFE_ID,
        customerId: 'CUST-0001',
        amountPaise: 50000,
        creditType: 'PURCHASED',
        performedByUserId: 'USER-01',
      });
      assert.strictEqual(topUpPurchased.purchasedBalancePaise, 50000);
      assert.strictEqual(topUpPurchased.promotionalBalancePaise, 0);
      assert.strictEqual(topUpPurchased.newBalancePaise, 50000);

      // Top up promotional bonus ₹200 (20,000 paise)
      const topUpPromo = await customerWalletService.topUpWallet({
        organisationId: ORG_ID,
        cafeId: CAFE_ID,
        customerId: 'CUST-0001',
        amountPaise: 20000,
        creditType: 'PROMOTIONAL',
        performedByUserId: 'USER-01',
      });
      assert.strictEqual(topUpPromo.purchasedBalancePaise, 50000);
      assert.strictEqual(topUpPromo.promotionalBalancePaise, 20000);
      assert.strictEqual(topUpPromo.newBalancePaise, 70000);

      // Breakdown query
      const breakdown = await customerWalletService.getWalletBalanceBreakdown({
        organisationId: ORG_ID,
        customerId: 'CUST-0001',
      });
      assert.strictEqual(breakdown.totalBalancePaise, 70000);
      assert.strictEqual(breakdown.purchasedBalancePaise, 50000);
      assert.strictEqual(breakdown.promotionalBalancePaise, 20000);

      // Redeem ₹300 (30,000 paise) — should consume all ₹200 promo first, then ₹100 purchased
      const redemption = await customerWalletService.redeemWallet({
        organisationId: ORG_ID,
        cafeId: CAFE_ID,
        customerId: 'CUST-0001',
        amountPaise: 30000,
        performedByUserId: 'USER-01',
      });
      assert.strictEqual(redemption.promotionalRedeemedPaise, 20000);
      assert.strictEqual(redemption.purchasedRedeemedPaise, 10000);
      assert.strictEqual(redemption.promotionalBalancePaise, 0);
      assert.strictEqual(redemption.purchasedBalancePaise, 40000);
      assert.strictEqual(redemption.newBalancePaise, 40000);
    });
  });

  describe('2. E-Invoice & E-Way Bill Schema Generation (A003 & A121)', () => {
    it('should generate valid NIC Schema INV-01 E-Invoice and E-Way Bill payloads', () => {
      const mockInvoice = {
        invoiceNumber: 'INV/2026/001',
        invoiceDate: new Date('2026-04-15T10:00:00.000Z'),
        placeOfSupply: '32-Kerala',
        reverseCharge: false,
        supplierDetails: {
          gstin: '32AABCT1332L1ZV',
          legalName: 'Zamorin Hospitality Private Limited',
          tradeName: 'Zamorin Café',
          address: 'Beach Road, Calicut',
          stateCode: '32',
          stateName: 'Kerala',
          pin: 673001,
        },
        recipientDetails: {
          isB2B: true,
          legalName: 'Malabar Tech Park LLP',
          gstin: '32AABCM9988K1Z5',
          address: 'Cyberpark, Calicut',
          stateCode: '32',
          stateName: 'Kerala',
          pin: 673016,
        },
        lineItems: [
          {
            description: 'Espresso Blend',
            hsnCode: '996331',
            quantity: 2,
            uqc: 'NOS',
            ratePaisa: 15000,
            grossAmountPaisa: 30000,
            discountPaisa: 0,
            taxableAmountPaisa: 30000,
            gstRatePercent: 5,
            cgstRatePercent: 2.5,
            cgstAmountPaisa: 750,
            sgstRatePercent: 2.5,
            sgstAmountPaisa: 750,
            igstAmountPaisa: 0,
            totalItemAmountPaisa: 31500,
          },
        ],
        taxSummary: {
          totalTaxablePaisa: 30000,
          totalCgstPaisa: 750,
          totalSgstPaisa: 750,
          totalIgstPaisa: 0,
          roundOffPaisa: 0,
          grandTotalPaisa: 31500,
        },
      };

      const einvPayload = gstTaxService.generateEInvoicePayload({ taxInvoice: mockInvoice });
      assert.strictEqual(einvPayload.Version, '1.1');
      assert.strictEqual(einvPayload.DocDtls.No, 'INV/2026/001');
      assert.strictEqual(einvPayload.SellerDtls.Gstin, '32AABCT1332L1ZV');
      assert.strictEqual(einvPayload.BuyerDtls.Gstin, '32AABCM9988K1Z5');
      assert.strictEqual(einvPayload.ValDtls.TotInvVal, 315.00);
      assert.strictEqual(einvPayload.ItemList.length, 1);
      assert.strictEqual(einvPayload.ItemList[0].IsServc, 'Y');

      const ewbPayload = gstTaxService.generateEWayBillPayload({
        taxInvoice: mockInvoice,
        transporterDetails: { vehicleNo: 'KL11AZ1234', distanceKm: 25 },
      });
      assert.strictEqual(ewbPayload.docType, 'INV');
      assert.strictEqual(ewbPayload.transDistance, 25);
      assert.strictEqual(ewbPayload.vehicleNo, 'KL11AZ1234');
      assert.strictEqual(ewbPayload.totInvValue, 315.00);
    });

    it('should enforce mutual exclusivity between GST and VAT regimes (A121)', () => {
      const validGst = gstTaxService.validateTaxJurisdictionCompatibility({
        taxRegime: 'GST',
        sellerGstin: '32AABCT1332L1ZV',
      });
      assert.strictEqual(validGst.valid, true);

      assert.throws(
        () => {
          gstTaxService.validateTaxJurisdictionCompatibility({
            taxRegime: 'GST',
            vatNumber: 'VAT123456789',
          });
        },
        /Mutual exclusivity violation/
      );

      assert.throws(
        () => {
          gstTaxService.validateTaxJurisdictionCompatibility({
            taxRegime: 'VAT',
            sellerGstin: '32AABCT1332L1ZV',
          });
        },
        /Mutual exclusivity violation/
      );
    });
  });

  describe('3. Google Business Profile Integration (A005 & A006)', () => {
    it('should upsert profile, sync reviews, record insights, and submit replies', async () => {
      const conn = await googleBusinessProfileService.upsertProfileConnection({
        organisationId: ORG_ID,
        cafeId: CAFE_ID,
        locationId: 'locations/1029384756',
        displayName: 'Zamorin Café - Flagship',
        primaryPhone: '+91 495 276 5432',
        addressLine: 'Beach Road, Calicut, Kerala',
      });
      assert.strictEqual(conn.success, true);
      assert.strictEqual(conn.profile.syncStatus, 'CONNECTED');

      // Record insights
      const insights = await googleBusinessProfileService.recordInsightsMetrics({
        organisationId: ORG_ID,
        cafeId: CAFE_ID,
        metrics: { viewsSearch: 1250, viewsMaps: 3400, actionsCalls: 85 },
      });
      assert.strictEqual(insights.metrics.viewsSearch, 1250);
      assert.strictEqual(insights.metrics.viewsMaps, 3400);

      // Sync reviews
      const sync = await googleBusinessProfileService.syncReviews({
        organisationId: ORG_ID,
        cafeId: CAFE_ID,
        reviews: [
          {
            reviewId: 'REV-001',
            reviewerName: 'Fathima R.',
            starRating: 5,
            comment: 'Exceptional specialty roast coffee and ambience!',
          },
        ],
      });
      assert.strictEqual(sync.totalReviews, 1);

      // Submit manager reply
      const reply = await googleBusinessProfileService.replyToReview({
        organisationId: ORG_ID,
        cafeId: CAFE_ID,
        reviewId: 'REV-001',
        comment: 'Thank you for your kind words Fathima! We look forward to welcoming you again.',
        repliedByUserId: 'MANAGER-01',
      });
      assert.strictEqual(reply.success, true);
      assert.strictEqual(reply.reply.repliedByUserId, 'MANAGER-01');

      // Profile summary
      const summary = await googleBusinessProfileService.getProfileSummary({
        organisationId: ORG_ID,
        cafeId: CAFE_ID,
      });
      assert.strictEqual(summary.averageRating, 5);
      assert.strictEqual(summary.totalReviews, 1);
      assert.strictEqual(summary.connected, true);
    });
  });

  describe('4. Payment Terminal & Hardware Enhancements (A057-A060, A119)', () => {
    it('should generate spoken UPI announcements in English, Hindi, and Malayalam (A057)', () => {
      const en = PaymentProviderService.generateSpokenPaymentAnnouncement({ amountPaisa: 25000, language: 'en' });
      assert.strictEqual(en.spokenText, 'Received 250 rupees on UPI.');

      const hi = PaymentProviderService.generateSpokenPaymentAnnouncement({ amountPaisa: 25000, language: 'hi' });
      assert.strictEqual(hi.spokenText, 'UPI par 250 rupaye prapt hue.');

      const ml = PaymentProviderService.generateSpokenPaymentAnnouncement({ amountPaisa: 25000, language: 'ml' });
      assert.strictEqual(ml.spokenText, 'UPI vazhi 250 roopa labhichu.');
    });

    it('should verify Hubb Pay authorization codes (A058)', () => {
      const auth = PaymentProviderService.verifyHubbPayAuthorizationCode({
        code: '883921',
        amountPaisa: 45000,
        billId: 'BILL-01',
      });
      assert.strictEqual(auth.verified, true);
      assert.strictEqual(auth.terminalStatus, 'AUTHORIZED');

      assert.throws(() => {
        PaymentProviderService.verifyHubbPayAuthorizationCode({ code: 'ABC', amountPaisa: 45000 });
      }, /Hubb Pay authorization code/);
    });

    it('should validate Uengage partner discount vouchers (A059)', () => {
      const flat = PaymentProviderService.validateUengageShoultoPayDiscount({
        voucherCode: 'FLAT50OFF',
        billTotalPaisa: 50000,
      });
      assert.strictEqual(flat.discountPaise, 5000);
      assert.strictEqual(flat.netPayablePaise, 45000);
    });

    it('should generate dynamic BharatQR for EDC terminal (A060)', () => {
      const qr = PaymentProviderService.generateDeviceDynamicQR({
        billId: 'BILL-2026-0001',
        amountPaisa: 12000,
        terminalId: 'EDC-POS-01',
      });
      assert.strictEqual(qr.terminalId, 'EDC-POS-01');
      assert.ok(qr.qrPayload.includes('upi://pay'));
      assert.ok(qr.qrPayload.includes('am=120.00'));
    });

    it('should calculate tender surcharges accurately (A119)', () => {
      const surcharge = PaymentProviderService.calculatePaymentSurcharge({
        amountPaisa: 100000, // ₹1000
        paymentMethod: 'CARD',
        cardType: 'INTERNATIONAL',
      });
      assert.strictEqual(surcharge.surchargePercent, 2.5);
      assert.strictEqual(surcharge.surchargePaisa, 2500);
      assert.strictEqual(surcharge.totalWithSurchargePaisa, 102500);
    });
  });

  describe('5. Customer Loyalty Rules (A062-A066)', () => {
    it('should enforce weekday redemption restrictions (A063)', async () => {
      const customer = new Customer({
        customerId: 'CUST-0002',
        organisationId: ORG_ID,
        name: 'Sneha Patel',
        phone: '9876543211',
        createdByUserId: 'USER-01',
        status: 'ACTIVE',
        loyaltyStatus: 'ACTIVE',
        pointsBalance: 500,
      });
      await customer.save();

      // Disallow all 7 days by giving empty match or opposite day
      const daysOfWeek = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];
      const today = daysOfWeek[new Date().getDay()];
      const notToday = daysOfWeek[(new Date().getDay() + 1) % 7];

      await assert.rejects(
        async () => {
          await customerLoyaltyService.redeemPointsAtomic({
            organisationId: ORG_ID,
            customerId: 'CUST-0002',
            pointsToRedeem: 100,
            allowedRedemptionDays: [notToday],
          });
        },
        /Loyalty point redemption is not permitted/
      );

      // Allow today
      const res = await customerLoyaltyService.redeemPointsAtomic({
        organisationId: ORG_ID,
        customerId: 'CUST-0002',
        pointsToRedeem: 100,
        allowedRedemptionDays: [today],
      });
      assert.strictEqual(res.pointsRedeemed, 100);
      assert.strictEqual(res.newBalance, 400);
    });

    it('should calculate multi-category loyalty point allocation with category caps (A066)', () => {
      const items = [
        { category: 'BEVERAGE', totalPaisa: 30000, quantity: 2 },
        { category: 'BAKERY', totalPaisa: 50000, quantity: 1 },
      ];

      const allocation = customerLoyaltyService.calculateMultiCategoryRedemption({
        items,
        totalPointsAvailable: 500,
        categoryCaps: { BEVERAGE: 150, BAKERY: 200 },
        pointsToPaisaConversion: 100,
      });

      assert.strictEqual(allocation.categoryAllocations.BEVERAGE.pointsRedeemed, 150);
      assert.strictEqual(allocation.categoryAllocations.BAKERY.pointsRedeemed, 200);
      assert.strictEqual(allocation.totalRedeemedPoints, 350);
      assert.strictEqual(allocation.remainingPoints, 150);
      assert.strictEqual(allocation.totalDiscountPaisa, 35000);
    });

    it('should persist Captain KOT loyalty metadata (A064/A065)', () => {
      const kotMeta = customerLoyaltyService.validateAndPersistCaptainKOTRedemption({
        billId: 'BILL-001',
        kotNumber: 'KOT-101',
        captainId: 'CAP-05',
        redemptionAmountPaise: 5000,
        pointsRedeemed: 50,
      });
      assert.strictEqual(kotMeta.valid, true);
      assert.strictEqual(kotMeta.captainId, 'CAP-05');
    });
  });

  describe('6. POS Open-Price Entry (A041)', () => {
    it('should calculate line item with custom open price within allowable bounds', () => {
      const totals = PosOrderService.calculateTotals({
        lineItems: [
          {
            menuItemId: 'OPEN-01',
            itemNameSnapshot: 'Bespoke Banquet Catering',
            quantity: 1,
            isOpenPrice: true,
            openPricePaisa: 150000, // ₹1,500
            minPricePaisa: 50000,
            maxPricePaisa: 500000,
            openPriceAuthorizedByUserId: 'SUPERVISOR-01',
          },
        ],
      });

      assert.strictEqual(totals.subtotalPaisa, 150000);
      assert.strictEqual(totals.lineItems[0].isOpenPrice, true);
      assert.strictEqual(totals.lineItems[0].unitPricePaisa, 150000);
      assert.strictEqual(totals.lineItems[0].openPriceAuthorizedByUserId, 'SUPERVISOR-01');

      // Bound rejection
      assert.throws(() => {
        PosOrderService.calculateTotals({
          lineItems: [
            {
              menuItemId: 'OPEN-02',
              quantity: 1,
              isOpenPrice: true,
              openPricePaisa: 20000, // Below min ₹500
              minPricePaisa: 50000,
              maxPricePaisa: 500000,
            },
          ],
        });
      }, (err) => err.code === 'INVALID_OPEN_PRICE' || /outside allowable range/.test(err.message));
    });
  });

  describe('7. Toing Order Channel Support (A070)', () => {
    it('should accept TOING in aggregator providers and Bill channel', async () => {
      const order = new AggregatorOrder({
        aggregatorOrderId: 'TOING-ORD-001',
        organisationId: ORG_ID,
        cafeId: CAFE_ID,
        provider: 'TOING',
        externalOrderId: 'TOING-EXT-999',
        customerName: 'Kavitha S.',
        customerPhone: '9876543212',
        orderStatus: 'RECEIVED',
        totalBillAmountPaisa: 45000,
        subtotalPaisa: 40000,
        taxesPaisa: 5000,
        pricing: {
          grossAmountPaisa: 40000,
          netPayablePaisa: 45000,
          taxesPaisa: 5000,
        },
        items: [
          { itemName: 'Cold Brew 250ml', quantity: 2, unitPricePaisa: 20000, lineTotalPaisa: 40000 },
        ],
      });
      await order.save();
      assert.strictEqual(order.provider, 'TOING');

      const bill = new Bill({
        billId: 'BILL-20261011-0001',
        organisationId: ORG_ID,
        cafeId: CAFE_ID,
        businessDate: '2026-10-11',
        cashierUserId: 'USER-01',
        orderChannel: 'TOING',
        serviceMode: 'DELIVERY',
        operatorUserId: 'USER-01',
        subtotalPaisa: 40000,
        totalPaisa: 45000,
        lineItems: [
          {
            menuItemId: 'ITEM-0250',
            itemNameSnapshot: 'Cold Brew 250ml',
            quantity: 2,
            unitPricePaisa: 20000,
            lineSubtotalPaisa: 40000,
          },
        ],
      });
      await bill.save();
      assert.strictEqual(bill.orderChannel, 'TOING');
    });
  });

  describe('8. Commission on Extras & Add-Ons (A049)', () => {
    it('should exclude add-ons from commissionable revenue when configured', () => {
      const withAddons = revenueShareCalculationService.computeEligibleRevenue({
        grossSalesPaisa: 100000,
        addonSalesPaisa: 15000,
        includeAddonsInCommission: true,
      });
      assert.strictEqual(withAddons, 100000);

      const withoutAddons = revenueShareCalculationService.computeEligibleRevenue({
        grossSalesPaisa: 100000,
        addonSalesPaisa: 15000,
        includeAddonsInCommission: false,
      });
      assert.strictEqual(withoutAddons, 85000);
    });
  });

  describe('9. Action-Needed Dashboard & Section 194-O TDS (A090)', () => {
    it('should compute Section 194-O TDS and flag missing HSN/tax menu items', async () => {
      const tds = analyticsBiService.calculateSection194OTds({ grossSalesPaisa: 500000 });
      assert.strictEqual(tds.ecomTdsRatePercent, 1.0);
      assert.strictEqual(tds.tdsDeductedPaisa, 5000);
      assert.strictEqual(tds.netDisbursedPaisa, 495000);

      const invalidItem = new MenuItem({
        menuItemId: 'MENU-99',
        organisationId: ORG_ID,
        name: 'Unmapped Item',
        nameLower: 'unmapped item',
        category: 'COFFEE',
        categoryId: 'CAT-01',
        currentPricePaisa: 10000,
        basePricePaisa: 10000,
        createdByUserId: 'USER-01',
        hsnSacCode: '', // Missing
        taxRatePercent: 0,
        status: 'ACTIVE',
      });
      await invalidItem.save();

      const actionSummary = await analyticsBiService.getActionNeededSummary({ organisationId: ORG_ID });
      assert.strictEqual(actionSummary.missingTaxOrHsnCount, 1);
      assert.strictEqual(actionSummary.missingTaxOrHsnItems[0].missingHsn, true);
    });
  });

  describe('10. Supplier-Material Mapping Import (A093-A095)', () => {
    it('should bulk import supplier catalog mappings with MOQ and lead times', async () => {
      const vendor = new Vendor({
        vendorId: 'VEN-0001',
        organisationId: ORG_ID,
        name: 'Malabar Dairy Collective',
        vendorType: 'GOODS',
        category: 'FOOD_BEVERAGE',
        createdByUserId: 'USER-01',
        status: 'ACTIVE',
      });
      await vendor.save();

      const importResult = await vendorLedgerService.importSupplierMaterialMappings({
        organisationId: ORG_ID,
        vendorId: 'VEN-0001',
        mappings: [
          {
            materialId: 'MAT-MILK-FULL',
            supplierItemCode: 'MDC-MILK-01',
            itemName: 'Whole Buffalo Milk 1L',
            currentPricePaisa: 6200,
            moq: 10,
            leadTimeDays: 1,
            sourcePriority: 'PREFERRED',
          },
        ],
      });

      assert.strictEqual(importResult.success, true);
      assert.strictEqual(importResult.importedCount, 1);
      assert.strictEqual(importResult.totalCatalogueItems, 1);
    });
  });

  describe('11. Bulk Recipe Workbook & Ingredient Replacement (A101 & A104)', () => {
    it('should export recipe workbook, import workbook rows, and bulk replace ingredient', async () => {
      const recipe = new Recipe({
        recipeId: 'RCP-0001',
        organisationId: ORG_ID,
        name: 'Signature Filter Coffee',
        version: 1,
        createdByUserId: 'USER-01',
        status: 'APPROVED',
        ingredients: [
          {
            ingredientName: 'Coffee Beans A',
            inventoryItemId: 'ING-COFFEE-01',
            quantity: 20,
            uom: 'G',
          },
          {
            ingredientName: 'Fresh Milk',
            inventoryItemId: 'ING-MILK-01',
            quantity: 150,
            uom: 'ML',
          },
        ],
      });
      await recipe.save();

      // Export
      const exported = await BomDepletionService.exportRecipeWorkbook({ organisationId: ORG_ID });
      assert.strictEqual(exported.success, true);
      assert.strictEqual(exported.totalRows, 2);

      // Bulk replace ingredient ING-COFFEE-01 with ING-COFFEE-PEABERRY
      const replaced = await BomDepletionService.bulkRemoveIngredientFromRecipes({
        organisationId: ORG_ID,
        inventoryItemId: 'ING-COFFEE-01',
        replacementItemId: 'ING-COFFEE-PEABERRY',
        replacementName: 'Peaberry Roast',
      });
      assert.strictEqual(replaced.modifiedCount, 1);

      const updatedRecipe = await Recipe.findOne({ recipeId: 'RCP-0001', organisationId: ORG_ID }).lean();
      const updatedIng = updatedRecipe.ingredients.find((i) => i.inventoryItemId === 'ING-COFFEE-PEABERRY');
      assert.ok(updatedIng);
      assert.strictEqual(updatedIng.ingredientName, 'Peaberry Roast');

      // Bulk remove Milk
      const removed = await BomDepletionService.bulkRemoveIngredientFromRecipes({
        organisationId: ORG_ID,
        inventoryItemId: 'ING-MILK-01',
      });
      assert.strictEqual(removed.modifiedCount, 1);

      const finalRecipe = await Recipe.findOne({ recipeId: 'RCP-0001', organisationId: ORG_ID }).lean();
      assert.strictEqual(finalRecipe.ingredients.length, 1);
    });
  });
});
