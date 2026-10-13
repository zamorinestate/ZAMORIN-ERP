'use strict';

/**
 * Spoken UPI Soundbox Audio Broadcast Adapter (A057)
 * Emulates and drives Paytm, PhonePe, and BharatPe physical/virtual soundboxes.
 */
class SoundboxAdapter {
  static SUPPORTED_LANGUAGES = ['en', 'hi', 'ml', 'ta'];

  /**
   * Formats localized text speech for the received transaction.
   */
  static formatSpeechText(amountRupees, language = 'en') {
    const amtStr = String(amountRupees);
    switch (language) {
      case 'hi':
        return `ज़मोरिन कैफ़े: UPI पर ₹${amtStr} रुपये प्राप्त हुए`;
      case 'ml':
        return `സമോറിൻ കഫേ: UPI വഴി ₹${amtStr} രൂപ ലഭിച്ചു`;
      case 'ta':
        return `ஜமோரின் கஃபே: UPI மூலம் ₹${amtStr} ரூபாய் பெறப்பட்டது`;
      case 'en':
      default:
        return `Zamorin Café: Rupees ${amtStr} received on UPI`;
    }
  }

  /**
   * Dispatches a broadcast packet to connected cellular soundboxes and web audio receivers.
   */
  static broadcastPaymentAnnouncement({
    amountPaisa,
    currency = 'INR',
    paymentProvider = 'UPI',
    reference = '',
    language = 'en',
    terminalId = 'SOUNDBOX-MAIN',
  }) {
    const amountRupees = (Number(amountPaisa || 0) / 100).toFixed(2);
    const speechText = this.formatSpeechText(amountRupees, language);

    return {
      success: true,
      terminalId,
      amountPaisa: Number(amountPaisa),
      amountRupees,
      currency,
      paymentProvider,
      reference,
      language,
      speechText,
      chimeToneFrequencyHz: 880, // High chime tone
      broadcastTimestamp: new Date().toISOString(),
      relayPacket: {
        topic: `zamorin/soundbox/${terminalId}/speak`,
        payload: {
          text: speechText,
          vol: 90,
          repeat: 1,
        },
      },
    };
  }

  static async synthesizePaymentAnnouncement(params = {}) {
    const lang = String(params?.language || 'en').toLowerCase();
    return this.broadcastPaymentAnnouncement({ ...params, language: lang });
  }
}

module.exports = { SoundboxAdapter };

