'use strict';

const { ApiError } = require('../utils/ApiError');

/**
 * Meta WhatsApp Business Cloud API Automated Conversational Ordering Engine (F096, A077)
 * Handles webhook state machines, interactive list messages, and automated dispatch pings.
 */
class WhatsAppOrderingBotService {
  static VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN || 'zamorin_wa_webhook_verify_2026';

  // In-memory customer bot conversational state: phone -> { step, cart, address }
  static customerSessions = new Map();

  /**
   * Verifies incoming webhook challenge from Meta Graph API.
   */
  static verifyWebhook(mode, token, challenge) {
    if (mode === 'subscribe' && token === this.VERIFY_TOKEN) {
      return challenge;
    }
    throw new ApiError(403, 'WEBHOOK_VERIFICATION_FAILED', 'Invalid verify token.');
  }

  /**
   * Processes an incoming WhatsApp customer message.
   */
  static async handleIncomingMessage({ fromPhone, messageType, text = '', interactive = null }) {
    if (!fromPhone) {
      throw new ApiError(400, 'FROM_PHONE_REQUIRED', 'Customer sender phone is required.');
    }

    const cleanPhone = String(fromPhone).replace(/[^0-9]/g, '').slice(-10);
    const session = this.customerSessions.get(cleanPhone) || { step: 'WELCOME', cart: [], address: null };

    let botResponse = null;
    const incomingText = (interactive?.button_reply?.id || interactive?.list_reply?.id || text).toLowerCase().trim();

    if (incomingText === 'action_view_menu' || incomingText === 'view_menu' || incomingText === 'browse_menu') {
      session.step = 'BROWSING';
      botResponse = {
        type: 'interactive',
        interactive: {
          type: 'list',
          header: { type: 'text', text: 'Zamorin House Specials' },
          body: { text: 'Select an artisanal beverage or pastry to add to your cart:' },
          action: {
            button: 'Choose Item',
            sections: [
              {
                title: 'Espresso & Coffee',
                rows: [
                  { id: 'ADD_ITEM_ESPRESSO', title: 'Zamorin House Espresso', description: '₹120.00 • Double shot roast' },
                  { id: 'ADD_ITEM_MALABAR_POUR', title: 'Malabar Pour-Over', description: '₹180.00 • Single origin medium roast' },
                ],
              },
              {
                title: 'Artisanal Pastries',
                rows: [
                  { id: 'ADD_ITEM_CROISSANT', title: 'Butter Croissant', description: '₹140.00 • Flaky golden French butter' },
                ],
              },
            ],
          },
        },
      };
    } else if (incomingText.includes('hi') || incomingText.includes('hello') || incomingText === 'menu') {
      session.step = 'VIEW_MENU';
      botResponse = {
        type: 'interactive',
        interactive: {
          type: 'button',
          body: { text: '☕ Welcome to Zamorin Café! Would you like to view our fresh artisanal menu or check an existing order?' },
          action: {
            buttons: [
              { type: 'reply', reply: { id: 'ACTION_VIEW_MENU', title: '📋 View Menu' } },
              { type: 'reply', reply: { id: 'ACTION_TRACK_ORDER', title: '🛵 Track Order' } },
            ],
          },
        },
      };
    } else if (incomingText.startsWith('add_item_')) {
      const itemCode = incomingText.replace('add_item_', '').toUpperCase();
      const unitPrice = itemCode.includes('ESPRESSO') ? 12000 : itemCode.includes('CROISSANT') ? 14000 : 18000;

      session.cart.push({ itemCode, quantity: 1, unitPricePaisa: unitPrice });
      session.step = 'CART_UPDATED';

      const cartTotalPaisa = session.cart.reduce((sum, it) => sum + it.unitPricePaisa * it.quantity, 0);

      botResponse = {
        type: 'interactive',
        interactive: {
          type: 'button',
          body: { text: `✅ Added ${itemCode} to your cart!\n\nCurrent Cart Total: ₹${(cartTotalPaisa / 100).toFixed(2)}\nReady to place your order?` },
          action: {
            buttons: [
              { type: 'reply', reply: { id: 'ACTION_CHECKOUT', title: '🛒 Checkout Now' } },
              { type: 'reply', reply: { id: 'ACTION_VIEW_MENU', title: '➕ Add More Items' } },
            ],
          },
        },
      };
    } else if (incomingText === 'action_checkout') {
      session.step = 'CHECKOUT';
      const cartTotalPaisa = session.cart.reduce((sum, it) => sum + it.unitPricePaisa * it.quantity, 0);
      const upiLink = `upi://pay?pa=zamorin.cafe@okhdfcbank&pn=ZamorinCafe&am=${(cartTotalPaisa / 100).toFixed(2)}&cu=INR`;

      botResponse = {
        type: 'text',
        text: `🧾 Order Summary:\nTotal Payable: ₹${(cartTotalPaisa / 100).toFixed(2)}\n\nClick below to pay via UPI and confirm your delivery:\n${upiLink}\n\nOur baristas will start brewing immediately upon payment confirmation!`,
      };
    } else {
      botResponse = {
        type: 'text',
        text: '👋 Thank you for messaging Zamorin Café! Reply with "Menu" to order fresh coffee or "Track" to check order status.',
      };
    }

    this.customerSessions.set(cleanPhone, session);

    return {
      success: true,
      fromPhone: cleanPhone,
      sessionStep: session.step,
      responsePayload: botResponse,
    };
  }

  /**
   * Generates dispatch notification template for outbound WhatsApp updates.
   */
  static generateDispatchNotification({
    customerPhone,
    customerName,
    invoiceNumber,
    orderStatus,
    riderName = 'Zamorin Express Runner',
    riderPhone = '9876543210',
  }) {
    let messageText = '';
    switch (orderStatus) {
      case 'PREPARING':
        messageText = `☕ Hi ${customerName}, your Zamorin Café order #${invoiceNumber} is being brewed right now!`;
        break;
      case 'OUT_FOR_DELIVERY':
        messageText = `🛵 Hi ${customerName}, your order #${invoiceNumber} is out for delivery with ${riderName} (Ph: ${riderPhone})!`;
        break;
      case 'DELIVERED':
        messageText = `🎉 Order #${invoiceNumber} delivered! Enjoy your coffee. Rate us: https://zamorin.cafe/feedback`;
        break;
      default:
        messageText = `Status update for order #${invoiceNumber}: ${orderStatus}`;
    }

    return {
      to: customerPhone,
      type: 'text',
      text: messageText,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Dispatches e-receipt PDF to customer via Meta WhatsApp Business Cloud API (Meta Graph v20.0).
   */
  static async dispatchReceiptPdfViaWhatsApp({
    toPhone,
    customerName = 'Guest',
    billId,
    pdfUrl = null,
    totalPaisa = 0,
    accessToken = process.env.WHATSAPP_CLOUD_ACCESS_TOKEN || null,
    phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID || null,
  }) {
    if (!toPhone) {
      throw new ApiError(400, 'PHONE_NUMBER_REQUIRED', 'Recipient phone number is required.');
    }
    const cleanPhone = String(toPhone).replace(/[^0-9]/g, '').slice(-10);
    const amountRupees = (Number(totalPaisa || 0) / 100).toFixed(2);
    const documentUrl = pdfUrl || `https://receipts.zamorin.cafe/pdf/${billId}`;

    const payload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: `91${cleanPhone}`,
      type: 'document',
      document: {
        link: documentUrl,
        filename: `Zamorin_Receipt_${billId}.pdf`,
        caption: `Thank you for dining with Zamorin Café, ${customerName}! Your invoice for ₹${amountRupees} is attached.`,
      },
    };

    if (accessToken && phoneNumberId) {
      try {
        const response = await fetch(`https://graph.facebook.com/v20.0/${phoneNumberId}/messages`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
        });
        const resJson = await response.json();
        return {
          success: response.ok,
          provider: 'META_GRAPH_V20',
          toPhone: cleanPhone,
          messageId: resJson.messages?.[0]?.id || null,
          payload,
        };
      } catch (err) {
        return {
          success: false,
          provider: 'META_GRAPH_V20',
          error: err.message,
          payload,
        };
      }
    }

    return {
      success: true,
      provider: 'WHATSAPP_SIMULATED_TRANSPORTER',
      toPhone: cleanPhone,
      messageId: `wamid.SIMULATED_${Date.now()}_${cleanPhone}`,
      billId,
      amountRupees,
      documentUrl,
      status: 'DISPATCHED_TO_META',
      timestamp: new Date().toISOString(),
      payload,
    };
  }
}

module.exports = { WhatsAppOrderingBotService };
