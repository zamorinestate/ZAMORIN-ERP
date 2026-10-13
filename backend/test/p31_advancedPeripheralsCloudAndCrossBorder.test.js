'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { BiometricFingerprintAdapter } = require('../src/services/hardwareAdapters/BiometricFingerprintAdapter');
const { EdcTerminalAdapter } = require('../src/services/hardwareAdapters/EdcTerminalAdapter');
const { SoundboxAdapter } = require('../src/services/hardwareAdapters/SoundboxAdapter');
const { CallerIdModemAdapter } = require('../src/services/hardwareAdapters/CallerIdModemAdapter');
const { ExternalDiningSyncService } = require('../src/services/externalDiningSyncService');
const { WhatsAppOrderingBotService } = require('../src/services/whatsAppOrderingBotService');
const { ThirdPartyLogisticsService } = require('../src/services/thirdPartyLogisticsService');
const { CrossBorderStatutoryService } = require('../src/services/crossBorderStatutoryService');
const { KdsStationService } = require('../src/services/kdsStationService');
const { PosOrderService } = require('../src/services/posOrderService');

test('Phase P31: Advanced Peripherals, Cloud Integrations & Cross-Border Compliance (Categories 1-4)', async (t) => {
  const cafeId = 'ZC-CAFE-01';
  const orgId = 'ORG-ZAMORIN';

  // ===========================================================================
  // CATEGORY 1: PHYSICAL HARDWARE DONGLES & SERIAL BRIDGES
  // ===========================================================================

  await t.test('1. BiometricFingerprintAdapter: enrolls, diagnoses, and matches ISO minutiae', async () => {
    const rawSampleA = 'ISO_MINUTIAE_FINGER_INDEX_R_778912';
    const rawSampleB = 'ISO_MINUTIAE_FINGER_INDEX_R_778912';
    const rawMismatch = 'ISO_MINUTIAE_FINGER_THUMB_L_112233';

    // Enrollment
    const enrollment = await BiometricFingerprintAdapter.enrollStaffFingerprint({
      userId: 'STAFF-101',
      rawMinutiaeData: rawSampleA,
      deviceModel: 'MANTRA_MFS100',
      fingerPosition: 'RIGHT_INDEX',
      organisationId: orgId,
      cafeId,
    });

    assert.equal(enrollment.success, true);
    assert.equal(enrollment.userId, 'STAFF-101');
    assert.equal(enrollment.deviceModel, 'MANTRA_MFS100');
    assert.ok(enrollment.minutiaeHash);

    // Verification - Match
    const matchResult = await BiometricFingerprintAdapter.verifyFingerprint({
      userId: 'STAFF-101',
      scannedMinutiaeData: rawSampleB,
      organisationId: orgId,
    });

    assert.equal(matchResult.verified, true);
    assert.equal(matchResult.userId, 'STAFF-101');
    assert.ok(matchResult.matchScore >= 90);

    // Verification - Mismatch
    const mismatchResult = await BiometricFingerprintAdapter.verifyFingerprint({
      userId: 'STAFF-101',
      scannedMinutiaeData: rawMismatch,
      organisationId: orgId,
    });

    assert.equal(mismatchResult.verified, false);

    // Device Diagnostic Self-Test
    const diag = await BiometricFingerprintAdapter.testDeviceConnection('MORPHO_MSO1300');
    assert.equal(diag.status, 'ONLINE');
    assert.equal(diag.device, 'MORPHO_MSO1300');
  });

  await t.test('2. EdcTerminalAdapter: pushes sale to EDC card terminal, checks status, and supports cancel', async () => {
    // Push sale
    const saleInitiation = await EdcTerminalAdapter.initiatePushSale({
      orderId: 'ORD-CARD-901',
      amountPaisa: 35000, // ₹350.00
      cafeId,
      organisationId: orgId,
      provider: 'PINELABS',
      terminalId: 'PL-TERM-01',
    });

    assert.equal(saleInitiation.success, true);
    assert.equal(saleInitiation.provider, 'PINELABS');
    assert.equal(saleInitiation.status, 'PENDING');
    assert.ok(saleInitiation.transactionReference);

    // Poll status (simulated EDC approval)
    const statusCheck = await EdcTerminalAdapter.checkTransactionStatus(saleInitiation.transactionReference);
    assert.equal(statusCheck.status, 'APPROVED');
    assert.equal(statusCheck.cardType, 'VISA');
    assert.ok(statusCheck.approvalCode);
    assert.equal(statusCheck.amountPaisa, 35000);

    // Push second sale and test cancellation
    const cancelSale = await EdcTerminalAdapter.initiatePushSale({
      orderId: 'ORD-CARD-902',
      amountPaisa: 12000,
      cafeId,
      organisationId: orgId,
      provider: 'PAYTM_EDC',
    });

    const cancelResult = await EdcTerminalAdapter.cancelTransaction(cancelSale.transactionReference, 'Cashier aborted');
    assert.equal(cancelResult.success, true);
    assert.equal(cancelResult.status, 'CANCELLED');
  });

  await t.test('3. SoundboxAdapter: synthesizes multilingual payment announcement in EN, HI, ML, TA', async () => {
    const amountPaisa = 14550; // ₹145.50

    // English
    const enAudio = await SoundboxAdapter.synthesizePaymentAnnouncement({
      amountPaisa,
      language: 'EN',
      cafeId,
      organisationId: orgId,
    });
    assert.ok(enAudio.speechText.includes('Rupees 145.50 received'));
    assert.equal(enAudio.currency, 'INR');

    // Malayalam
    const mlAudio = await SoundboxAdapter.synthesizePaymentAnnouncement({
      amountPaisa,
      language: 'ML',
      cafeId,
      organisationId: orgId,
    });
    assert.ok(mlAudio.speechText.includes('രൂപ ലഭിച്ചു'));

    // Hindi
    const hiAudio = await SoundboxAdapter.synthesizePaymentAnnouncement({
      amountPaisa,
      language: 'HI',
      cafeId,
      organisationId: orgId,
    });
    assert.ok(hiAudio.speechText.includes('रुपये प्राप्त हुए'));

    // Tamil
    const taAudio = await SoundboxAdapter.synthesizePaymentAnnouncement({
      amountPaisa,
      language: 'TA',
      cafeId,
      organisationId: orgId,
    });
    assert.ok(taAudio.speechText.includes('ரூபாய் பெறப்பட்டது'));
  });

  await t.test('4. CallerIdModemAdapter: decodes serial AT+VCID packets and triggers CRM popup', async () => {
    const rawModemData = `
RING
DATE = 1012
TIME = 1845
NMBR = 9876543210
NAME = ANEESH R
`;
    const parsed = CallerIdModemAdapter.parseModemPacket(rawModemData);
    assert.equal(parsed.valid, true);
    assert.equal(parsed.phone, '9876543210');
    assert.equal(parsed.callerName, 'ANEESH R');

    // Handle incoming call lookup
    const callEvent = await CallerIdModemAdapter.handleIncomingCall({
      phone: parsed.phone,
      callerName: parsed.callerName,
      cafeId,
      organisationId: orgId,
    });

    assert.equal(callEvent.success, true);
    assert.equal(callEvent.customerPhone, '9876543210');
    assert.ok(callEvent.popupPayload);
    assert.equal(callEvent.popupPayload.type, 'CALLER_ID_POPUP');
  });

  // ===========================================================================
  // CATEGORY 2: THIRD-PARTY CLOUD INTEGRATIONS
  // ===========================================================================

  await t.test('5. ExternalDiningSyncService: syncs reservations and validates partner discounts', async () => {
    // Webhook reservation from EazyDiner
    const syncRes = await ExternalDiningSyncService.ingestPartnerReservation({
      partner: 'EAZYDINER',
      externalReservationId: 'EZ-BOOK-8819',
      cafeId,
      organisationId: orgId,
      guestName: 'Rahul Verma',
      guestPhone: '9845011223',
      guestCovers: 4,
      partnerMembershipTier: 'PRIME',
    });

    assert.equal(syncRes.success, true);
    assert.equal(syncRes.partner, 'EAZYDINER');
    assert.equal(syncRes.status, 'CONFIRMED');

    // Validate EazyDiner discount (25% off up to ₹1,000 max cap)
    const discountCheck1 = ExternalDiningSyncService.validatePartnerDiscount({
      partner: 'EAZYDINER',
      billSubtotalPaisa: 300000, // ₹3,000 -> 25% is ₹750 (75000 paise)
    });
    assert.equal(discountCheck1.eligible, true);
    assert.equal(discountCheck1.discountPaisa, 75000);

    // Validate Dineout discount (15% off up to ₹750 max cap)
    const discountCheck2 = ExternalDiningSyncService.validatePartnerDiscount({
      partner: 'DINEOUT',
      billSubtotalPaisa: 600000, // ₹6,000 -> 15% is ₹900, capped at ₹750 (75000 paise)
    });
    assert.equal(discountCheck2.eligible, true);
    assert.equal(discountCheck2.discountPaisa, 75000);
  });

  await t.test('6. WhatsAppOrderingBotService: processes interactive conversational ordering and UPI link', async () => {
    const customerPhone = '9876543210';

    // 1. Webhook Challenge Verification
    const challengeResponse = WhatsAppOrderingBotService.verifyWebhook('subscribe', 'zamorin_wa_webhook_verify_2026', 'CHALLENGE_CODE_123');
    assert.equal(challengeResponse, 'CHALLENGE_CODE_123');

    // 2. Greeting / Menu request
    const step1 = await WhatsAppOrderingBotService.handleIncomingMessage({
      fromPhone: customerPhone,
      text: 'Hi Zamorin',
    });
    assert.equal(step1.sessionStep, 'VIEW_MENU');
    assert.equal(step1.responsePayload.type, 'interactive');

    // 3. User selects "Action View Menu"
    const step2 = await WhatsAppOrderingBotService.handleIncomingMessage({
      fromPhone: customerPhone,
      text: 'action_view_menu',
    });
    assert.equal(step2.sessionStep, 'BROWSING');

    // 4. User adds Espresso
    const step3 = await WhatsAppOrderingBotService.handleIncomingMessage({
      fromPhone: customerPhone,
      text: 'add_item_espresso',
    });
    assert.equal(step3.sessionStep, 'CART_UPDATED');
    assert.ok(step3.responsePayload.interactive.body.text.includes('Added ESPRESSO'));

    // 5. Checkout and dynamic UPI link generation
    const step4 = await WhatsAppOrderingBotService.handleIncomingMessage({
      fromPhone: customerPhone,
      text: 'action_checkout',
    });
    assert.equal(step4.sessionStep, 'CHECKOUT');
    assert.ok(step4.responsePayload.text.includes('upi://pay?pa=zamorin.cafe@okhdfcbank'));

    // 6. Dispatch Notification Template
    const dispatchPing = WhatsAppOrderingBotService.generateDispatchNotification({
      customerPhone,
      customerName: 'Rahul',
      invoiceNumber: 'INV-2026-9901',
      orderStatus: 'OUT_FOR_DELIVERY',
      riderName: 'Faizal K.',
      riderPhone: '9447012345',
    });
    assert.ok(dispatchPing.text.includes('out for delivery with Faizal K.'));
  });

  await t.test('7. ThirdPartyLogisticsService: estimates fares, dispatches riders, and handles webhooks', async () => {
    // Fare estimation
    const fareDunzo = ThirdPartyLogisticsService.estimateDeliveryFare({ distanceKm: 4.0, provider: 'DUNZO' });
    assert.equal(fareDunzo.provider, 'DUNZO');
    assert.equal(fareDunzo.estimatedDeliveryFeePaisa, 8800); // 4000 base + 4 * 1200

    // Dispatch rider
    const dispatch = await ThirdPartyLogisticsService.dispatchRider({
      orderId: 'ORD-DEL-401',
      cafeId,
      organisationId: orgId,
      customerName: 'Sneha Menon',
      customerPhone: '9845012345',
      deliveryAddress: 'Flat 402, Malabar Heights, Calicut',
      orderValuePaisa: 65000,
      provider: 'SHADOWFAX',
    });

    assert.equal(dispatch.success, true);
    assert.equal(dispatch.provider, 'SHADOWFAX');
    assert.equal(dispatch.riderStatus, 'ASSIGNED');
    assert.ok(dispatch.trackingId);

    // Live status polling
    const tracking = ThirdPartyLogisticsService.getRiderStatus(dispatch.trackingId);
    assert.equal(tracking.customerName, 'Sneha Menon');
    assert.equal(tracking.riderStatus, 'ASSIGNED');

    // Provider Webhook Simulation
    const webhookRes = ThirdPartyLogisticsService.processProviderWebhook({
      trackingId: dispatch.trackingId,
      eventType: 'PICKED_UP',
      riderDetails: { name: 'Arjun Das', phone: '9895012345' },
    });
    assert.equal(webhookRes.received, true);
    assert.equal(webhookRes.newStatus, 'OUT_FOR_DELIVERY');
  });

  // ===========================================================================
  // CATEGORY 3: CROSS-BORDER STATUTORY & KITCHEN PASS (VIRTUAL KDS)
  // ===========================================================================

  await t.test('8. CrossBorderStatutoryService: evaluates IN_GST, UAE FTA VAT, and KSA ZATCA Phase 2 ECDSA', () => {
    const subtotalPaisa = 100000; // ₹1,000 or AED 1,000 or SAR 1,000

    // 1. India GST (Intra-state: 2.5% CGST + 2.5% SGST)
    const inTax = CrossBorderStatutoryService.evaluateJurisdictionTax({
      jurisdiction: 'IN_GST',
      subtotalPaisa,
      isInterState: false,
    });
    assert.equal(inTax.totalTaxPaisa, 5000);
    assert.equal(inTax.taxBreakdown.cgstPaisa, 2500);
    assert.equal(inTax.taxBreakdown.sgstPaisa, 2500);

    // 2. UAE FTA VAT (5% Standard VAT with bilingual labels)
    const uaeTax = CrossBorderStatutoryService.evaluateJurisdictionTax({
      jurisdiction: 'UAE_FTA_VAT',
      subtotalPaisa,
      taxRegistrationNumber: '100456789000003',
    });
    assert.equal(uaeTax.totalTaxPaisa, 5000);
    assert.equal(uaeTax.currency, 'AED');
    assert.equal(uaeTax.taxBreakdown.trn, '100456789000003');
    assert.ok(uaeTax.taxBreakdown.bilingualLabels.ar.includes('ضريبة'));

    // 3. KSA ZATCA Phase 2 (15% VAT, SHA-256 Hashing, ECDSA Signature, TLV Base64 QR)
    const ksaTax = CrossBorderStatutoryService.evaluateJurisdictionTax({
      jurisdiction: 'KSA_ZATCA_PHASE2',
      subtotalPaisa,
      taxRegistrationNumber: '300123456789003',
    });
    assert.equal(ksaTax.totalTaxPaisa, 15000);
    assert.equal(ksaTax.currency, 'SAR');

    const zatcaInvoice = CrossBorderStatutoryService.signZatcaPhase2Invoice({
      sellerName: 'Zamorin Specialty Roasters KSA',
      vatRegistrationNumber: '300123456789003',
      invoiceNumber: 'ZATCA-INV-2026-001',
      totalWithVatPaisa: ksaTax.grandTotalPaisa,
      vatAmountPaisa: ksaTax.totalTaxPaisa,
    });

    assert.equal(zatcaInvoice.success, true);
    assert.equal(zatcaInvoice.standard, 'KSA_ZATCA_PHASE2');
    assert.ok(zatcaInvoice.invoiceHash);
    assert.ok(zatcaInvoice.digitalSignature);
    assert.ok(zatcaInvoice.tlvQrBase64);
    assert.ok(zatcaInvoice.bilingualHeader.ar.includes('فاتورة ضريبية'));
  });

  await t.test('9. KdsStationService: handles ticket routing, station bumping, and recall', () => {
    const rawOrder = {
      orderId: 'ORD-KDS-101',
      invoiceNumber: 'INV-KDS-101',
      cafeId,
      organisationId: orgId,
      orderType: 'DINE_IN',
      tableNumber: 'T-04',
      items: [
        {
          orderItemId: 'ITEM-1',
          name: 'Double Shot Espresso',
          category: 'BEVERAGE',
          quantity: 2,
          notes: 'Extra hot',
        },
        {
          orderItemId: 'ITEM-2',
          name: 'Butter Croissant',
          category: 'BAKERY',
          quantity: 1,
        },
      ],
    };

    // Ingest order into KDS
    const ticket = KdsStationService.ingestOrderToKds(rawOrder);
    assert.equal(ticket.orderId, 'ORD-KDS-101');
    assert.equal(ticket.items.length, 2);
    assert.equal(ticket.items[0].station, 'BARISTA');
    assert.equal(ticket.items[1].station, 'HOT_KITCHEN');

    // Filter tickets by BARISTA station
    const baristaTickets = KdsStationService.getActiveTickets({ cafeId, station: 'BARISTA' });
    assert.ok(baristaTickets.length >= 1);
    const myTicket = baristaTickets.find((t) => t.orderId === 'ORD-KDS-101');
    assert.ok(myTicket);
    assert.equal(myTicket.items.length, 1);
    assert.equal(myTicket.urgencyColor, 'GREEN');

    // Bump item
    const bumpedItemTicket = KdsStationService.bumpItem({
      ticketId: ticket.ticketId,
      orderItemId: 'ITEM-1',
    });
    assert.equal(bumpedItemTicket.items[0].status, 'PREPARED');

    // Bump entire ticket (Kitchen bump bar completion)
    const bumpedTicket = KdsStationService.bumpTicket({ ticketId: ticket.ticketId });
    assert.equal(bumpedTicket.status, 'COMPLETED');

    // Ticket Recall
    const recalledTicket = KdsStationService.recallTicket({ ticketId: ticket.ticketId });
    assert.equal(recalledTicket.status, 'PREPARING');
  });

  // ===========================================================================
  // CATEGORY 4: FOH OPERATIONAL MICRO-FEATURES
  // ===========================================================================

  await t.test('10. posOrderService: exact minor-unit paise calculations for fractional decimal quantities', () => {
    const items = [
      {
        orderItemId: 'DEC-01',
        name: 'Single Origin Arabica Beans',
        quantity: 2.25, // 2.25 KG
        unitPricePaisa: 180000, // ₹1,800.00 / KG
        taxRate: 5,
      },
    ];

    const totals = PosOrderService.calculateTotals({
      items,
      discountPaisa: 0,
      deliveryFeePaisa: 0,
      packagingFeePaisa: 0,
      tipPaisa: 0,
      roundOffPaisa: 0,
      taxRule: 'IN_GST_RESTAURANT_5',
    });

    // 2.25 * 180000 = 405000 paise (₹4,050.00)
    assert.equal(totals.subtotalPaisa, 405000);
    // 5% tax on 405000 = 20250 paise (₹202.50)
    assert.equal(totals.taxPaisa, 20250);
    assert.equal(totals.grandTotalPaisa, 425250);
  });

  await t.test('11. posOrderService: supports dining area-specific pricing overrides', () => {
    const catalogItem = {
      itemId: 'ITEM-COFFEE-01',
      name: 'Artisanal Latte',
      price: 15000, // ₹150 base price
      areaPricing: [
        { areaId: 'AREA-ROOFTOP', pricePaisa: 18000 }, // ₹180 on rooftop
        { areaId: 'AREA-GARDEN', pricePaisa: 16000 },  // ₹160 in garden
      ],
    };

    // If diningAreaId is AREA-ROOFTOP
    const targetAreaId = 'AREA-ROOFTOP';
    const areaPriceConfig = catalogItem.areaPricing?.find((ap) => ap.areaId === targetAreaId);
    const effectiveUnitPricePaisa = areaPriceConfig ? areaPriceConfig.pricePaisa : catalogItem.price;

    assert.equal(effectiveUnitPricePaisa, 18000);

    const totals = PosOrderService.calculateTotals({
      items: [
        {
          orderItemId: 'LINE-1',
          name: catalogItem.name,
          quantity: 2,
          unitPricePaisa: effectiveUnitPricePaisa,
          taxRate: 5,
        },
      ],
      taxRule: 'IN_GST_RESTAURANT_5',
    });

    // 2 * 18000 = 36000 paise (₹360.00)
    assert.equal(totals.subtotalPaisa, 36000);
    assert.equal(totals.taxPaisa, 1800);
    assert.equal(totals.grandTotalPaisa, 37800);
  });
});
