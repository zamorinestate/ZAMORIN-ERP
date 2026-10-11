'use strict';

const ESC = 0x1B;
const GS = 0x1D;
const LF = 0x0A;

const ESC_POS_COMMANDS = {
  INIT: Buffer.from([ESC, 0x40]),
  ALIGN_LEFT: Buffer.from([ESC, 0x61, 0x00]),
  ALIGN_CENTER: Buffer.from([ESC, 0x61, 0x01]),
  ALIGN_RIGHT: Buffer.from([ESC, 0x61, 0x02]),
  BOLD_ON: Buffer.from([ESC, 0x45, 0x01]),
  BOLD_OFF: Buffer.from([ESC, 0x45, 0x00]),
  UNDERLINE_ON: Buffer.from([ESC, 0x2D, 0x01]),
  UNDERLINE_OFF: Buffer.from([ESC, 0x2D, 0x00]),
  INVERT_ON: Buffer.from([GS, 0x42, 0x01]),
  INVERT_OFF: Buffer.from([GS, 0x42, 0x00]),
  FONT_NORMAL: Buffer.from([GS, 0x21, 0x00]),
  FONT_2X_HEIGHT: Buffer.from([GS, 0x21, 0x01]),
  FONT_2X_WIDTH: Buffer.from([GS, 0x21, 0x10]),
  FONT_2X_BOTH: Buffer.from([GS, 0x21, 0x11]),
  CUT_PARTIAL: Buffer.from([GS, 0x56, 0x01]),
  CUT_FULL: Buffer.from([GS, 0x56, 0x00]),
  FEED_3_LINES: Buffer.from([ESC, 0x64, 0x03]),
  FEED_5_LINES: Buffer.from([ESC, 0x64, 0x05]),
};

class ReceiptPrinterAdapter {
  static sanitizeText(text) {
    if (text === null || text === undefined) return '';
    return String(text)
      .replace(/[\x00-\x09\x0B-\x1F\x7F]/g, '')
      .trim();
  }

  static formatTwoColumn(left, right, width = 48) {
    const cleanLeft = this.sanitizeText(left);
    const cleanRight = this.sanitizeText(right);
    const totalLength = cleanLeft.length + cleanRight.length;

    if (totalLength >= width) {
      const available = width - cleanRight.length - 1;
      const truncatedLeft = cleanLeft.slice(0, Math.max(0, available));
      return `${truncatedLeft} ${cleanRight}`;
    }

    const padding = ' '.repeat(width - totalLength);
    return `${cleanLeft}${padding}${cleanRight}`;
  }

  static buildQrCodeBuffer(text, moduleSize = 5) {
    const clean = this.sanitizeText(text);
    const dataBytes = Buffer.from(clean, 'utf8');
    const len = dataBytes.length + 3;
    const pL = len % 256;
    const pH = Math.floor(len / 256);

    return Buffer.concat([
      Buffer.from([GS, 0x28, 0x6B, 0x04, 0x00, 0x31, 0x41, 0x32, 0x00]),
      Buffer.from([GS, 0x28, 0x6B, 0x03, 0x00, 0x31, 0x43, Math.min(16, Math.max(1, moduleSize))]),
      Buffer.from([GS, 0x28, 0x6B, 0x03, 0x00, 0x31, 0x45, 0x31]),
      Buffer.from([GS, 0x28, 0x6B, pL, pH, 0x31, 0x50, 0x30]),
      dataBytes,
      Buffer.from([GS, 0x28, 0x6B, 0x03, 0x00, 0x31, 0x51, 0x30]),
      Buffer.from([LF]),
    ]);
  }

  /**
   * Compiles an ESC/POS Thermal Receipt for a finalized Bill.
   * Tracks reprint count without mutating financial state.
   */
  static compileReceipt(billData = {}, cafeInfo = {}, options = {}) {
    const width = options.paperWidth === 58 ? 32 : 48;
    const isReprint = Boolean(billData.isReprint);
    const reprintCount = Number(billData.reprintCount || 1);
    const chunks = [];

    chunks.push(ESC_POS_COMMANDS.INIT);
    chunks.push(ESC_POS_COMMANDS.ALIGN_CENTER);

    // Cafe Header
    chunks.push(ESC_POS_COMMANDS.BOLD_ON);
    chunks.push(ESC_POS_COMMANDS.FONT_2X_BOTH);
    chunks.push(Buffer.from(`${this.sanitizeText(cafeInfo.brandName || 'ZAMORIN CAFE')}\n`, 'utf8'));
    chunks.push(ESC_POS_COMMANDS.FONT_NORMAL);
    chunks.push(ESC_POS_COMMANDS.BOLD_OFF);

    if (cafeInfo.legalName) {
      chunks.push(Buffer.from(`${this.sanitizeText(cafeInfo.legalName)}\n`, 'utf8'));
    }
    if (cafeInfo.address) {
      chunks.push(Buffer.from(`${this.sanitizeText(cafeInfo.address)}\n`, 'utf8'));
    }
    if (cafeInfo.gstin) {
      chunks.push(Buffer.from(`GSTIN: ${this.sanitizeText(cafeInfo.gstin)}\n`, 'utf8'));
    }
    if (cafeInfo.fssai) {
      chunks.push(Buffer.from(`FSSAI: ${this.sanitizeText(cafeInfo.fssai)}\n`, 'utf8'));
    }

    // Reprint notice (Benchmark A022 / F038)
    if (isReprint) {
      chunks.push(Buffer.from('\n', 'utf8'));
      chunks.push(ESC_POS_COMMANDS.INVERT_ON);
      chunks.push(ESC_POS_COMMANDS.BOLD_ON);
      chunks.push(Buffer.from(` *** REPRINT #${reprintCount} *** \n`, 'utf8'));
      chunks.push(ESC_POS_COMMANDS.BOLD_OFF);
      chunks.push(ESC_POS_COMMANDS.INVERT_OFF);
    }

    chunks.push(Buffer.from('-'.repeat(width) + '\n', 'utf8'));
    chunks.push(ESC_POS_COMMANDS.ALIGN_LEFT);

    const billNumber = billData.billNumber || billData.orderNumber || 'ZC-BILL-001';
    const billDate = billData.date || new Date().toISOString().slice(0, 10);
    const billTime = billData.time || new Date().toLocaleTimeString();

    chunks.push(Buffer.from(this.formatTwoColumn(`Bill: ${billNumber}`, `Date: ${billDate}`, width) + '\n', 'utf8'));
    if (billData.tableNumber) {
      chunks.push(Buffer.from(this.formatTwoColumn(`Table: ${billData.tableNumber}`, `Time: ${billTime}`, width) + '\n', 'utf8'));
    } else {
      chunks.push(Buffer.from(`Time: ${billTime}\n`, 'utf8'));
    }

    chunks.push(Buffer.from('-'.repeat(width) + '\n', 'utf8'));
    chunks.push(Buffer.from(this.formatTwoColumn('Item Description', 'Qty   Amount', width) + '\n', 'utf8'));
    chunks.push(Buffer.from('-'.repeat(width) + '\n', 'utf8'));

    // Items
    const items = Array.isArray(billData.items) ? billData.items : [];
    for (const item of items) {
      const name = this.sanitizeText(item.name || item.itemName || 'Item');
      const qty = Number(item.quantity || item.qty || 1);
      const price = Number(item.price || item.rate || 0);
      const total = Number(item.total || qty * price);
      const rightCol = `${qty}x  ${total.toFixed(2)}`;
      chunks.push(Buffer.from(this.formatTwoColumn(name, rightCol, width) + '\n', 'utf8'));
    }

    chunks.push(Buffer.from('-'.repeat(width) + '\n', 'utf8'));

    // Totals
    const subtotal = Number(billData.subtotal || billData.subTotal || 0);
    const tax = Number(billData.tax || (billData.cgst || 0) + (billData.sgst || 0));
    const discount = Number(billData.discount || 0);
    const grandTotal = Number(billData.grandTotal || billData.total || subtotal + tax - discount);

    chunks.push(Buffer.from(this.formatTwoColumn('Sub Total:', subtotal.toFixed(2), width) + '\n', 'utf8'));
    if (discount > 0) {
      chunks.push(Buffer.from(this.formatTwoColumn('Discount:', `-${discount.toFixed(2)}`, width) + '\n', 'utf8'));
    }
    if (tax > 0) {
      chunks.push(Buffer.from(this.formatTwoColumn('GST / Taxes:', tax.toFixed(2), width) + '\n', 'utf8'));
    }

    chunks.push(Buffer.from('='.repeat(width) + '\n', 'utf8'));
    chunks.push(ESC_POS_COMMANDS.BOLD_ON);
    chunks.push(ESC_POS_COMMANDS.FONT_2X_HEIGHT);
    chunks.push(Buffer.from(this.formatTwoColumn('TOTAL:', `INR ${grandTotal.toFixed(2)}`, width) + '\n', 'utf8'));
    chunks.push(ESC_POS_COMMANDS.FONT_NORMAL);
    chunks.push(ESC_POS_COMMANDS.BOLD_OFF);
    chunks.push(Buffer.from('='.repeat(width) + '\n', 'utf8'));

    // Footer
    chunks.push(ESC_POS_COMMANDS.ALIGN_CENTER);
    chunks.push(Buffer.from('\nThank you for dining with Zamorin Cafe!\n', 'utf8'));
    chunks.push(Buffer.from('Crafted with Malabar Heritage\n', 'utf8'));

    // Cut & Feed
    chunks.push(ESC_POS_COMMANDS.FEED_3_LINES);
    chunks.push(ESC_POS_COMMANDS.CUT_PARTIAL);

    return Buffer.concat(chunks);
  }

  /**
   * Compiles a Separate Token Slip (Benchmark A027) using the bill printer.
   */
  static compileTokenSlip(tokenData = {}, cafeInfo = {}, options = {}) {
    const width = options.paperWidth === 58 ? 32 : 48;
    const chunks = [];

    chunks.push(ESC_POS_COMMANDS.INIT);
    chunks.push(ESC_POS_COMMANDS.ALIGN_CENTER);

    chunks.push(ESC_POS_COMMANDS.BOLD_ON);
    chunks.push(Buffer.from(`${this.sanitizeText(cafeInfo.brandName || 'ZAMORIN CAFE')}\n`, 'utf8'));
    chunks.push(Buffer.from('--- TOKEN SLIP ---\n', 'utf8'));
    chunks.push(ESC_POS_COMMANDS.FONT_2X_BOTH);
    chunks.push(Buffer.from(`TOKEN #${this.sanitizeText(tokenData.tokenNumber || 'T-01')}\n`, 'utf8'));
    chunks.push(ESC_POS_COMMANDS.FONT_NORMAL);
    chunks.push(ESC_POS_COMMANDS.BOLD_OFF);

    chunks.push(Buffer.from(`Bill: ${this.sanitizeText(tokenData.billNumber || 'N/A')}\n`, 'utf8'));
    chunks.push(Buffer.from(`Time: ${new Date().toLocaleTimeString()}\n`, 'utf8'));
    chunks.push(Buffer.from('-'.repeat(width) + '\n', 'utf8'));

    const items = Array.isArray(tokenData.items) ? tokenData.items : [];
    for (const item of items) {
      const name = this.sanitizeText(item.name || item.itemName || 'Item');
      const qty = Number(item.quantity || item.qty || 1);
      chunks.push(Buffer.from(this.formatTwoColumn(name, `x${qty}`, width) + '\n', 'utf8'));
    }

    chunks.push(Buffer.from('-'.repeat(width) + '\n', 'utf8'));
    chunks.push(Buffer.from('Please collect your order when token is announced.\n', 'utf8'));
    chunks.push(ESC_POS_COMMANDS.FEED_3_LINES);
    chunks.push(ESC_POS_COMMANDS.CUT_PARTIAL);

    return Buffer.concat(chunks);
  }

  /**
   * Compiles a Readiness Slip (Benchmark A025) routed to designated dispatch station.
   */
  static compileReadinessSlip(readinessData = {}, options = {}) {
    const width = options.paperWidth === 58 ? 32 : 48;
    const chunks = [];

    chunks.push(ESC_POS_COMMANDS.INIT);
    chunks.push(ESC_POS_COMMANDS.ALIGN_CENTER);
    chunks.push(ESC_POS_COMMANDS.BOLD_ON);
    chunks.push(ESC_POS_COMMANDS.FONT_2X_HEIGHT);
    chunks.push(Buffer.from(`FOOD READY · ${this.sanitizeText(readinessData.station || 'DISPATCH')}\n`, 'utf8'));
    chunks.push(ESC_POS_COMMANDS.FONT_NORMAL);
    chunks.push(ESC_POS_COMMANDS.BOLD_OFF);

    chunks.push(Buffer.from('-'.repeat(width) + '\n', 'utf8'));
    chunks.push(ESC_POS_COMMANDS.ALIGN_LEFT);
    chunks.push(Buffer.from(`Table: ${this.sanitizeText(readinessData.tableNumber || 'Takeaway')}\n`, 'utf8'));
    chunks.push(Buffer.from(`Order/Bill: ${this.sanitizeText(readinessData.orderId || readinessData.billNumber || 'ZC-001')}\n`, 'utf8'));
    chunks.push(Buffer.from(`Ready At: ${new Date().toLocaleTimeString()}\n`, 'utf8'));
    chunks.push(Buffer.from('-'.repeat(width) + '\n', 'utf8'));

    const items = Array.isArray(readinessData.items) ? readinessData.items : [];
    for (const item of items) {
      const name = this.sanitizeText(item.name || item.itemName || 'Item');
      const qty = Number(item.quantity || item.qty || 1);
      chunks.push(Buffer.from(` [READY] ${name} x${qty}\n`, 'utf8'));
    }

    chunks.push(Buffer.from('-'.repeat(width) + '\n', 'utf8'));
    chunks.push(ESC_POS_COMMANDS.FEED_3_LINES);
    chunks.push(ESC_POS_COMMANDS.CUT_PARTIAL);

    return Buffer.concat(chunks);
  }

  /**
   * Moved-Item Transfer KOT (Benchmark A022).
   */
  static compileShiftedItemTicket(shiftedData = {}, options = {}) {
    const width = options.paperWidth === 58 ? 32 : 48;
    const chunks = [];

    chunks.push(ESC_POS_COMMANDS.INIT);
    chunks.push(ESC_POS_COMMANDS.ALIGN_CENTER);
    chunks.push(ESC_POS_COMMANDS.INVERT_ON);
    chunks.push(ESC_POS_COMMANDS.BOLD_ON);
    chunks.push(Buffer.from(' *** ITEM SHIFTED / TABLE TRANSFER *** \n', 'utf8'));
    chunks.push(ESC_POS_COMMANDS.BOLD_OFF);
    chunks.push(ESC_POS_COMMANDS.INVERT_OFF);

    chunks.push(ESC_POS_COMMANDS.ALIGN_LEFT);
    chunks.push(Buffer.from(`From Table: ${this.sanitizeText(shiftedData.fromTable || 'T-1')} -> To Table: ${this.sanitizeText(shiftedData.toTable || 'T-2')}\n`, 'utf8'));
    chunks.push(Buffer.from(`Time: ${new Date().toLocaleTimeString()}\n`, 'utf8'));
    chunks.push(Buffer.from(`Shift Reason: ${this.sanitizeText(shiftedData.reason || 'Guest request')}\n`, 'utf8'));
    chunks.push(Buffer.from('-'.repeat(width) + '\n', 'utf8'));

    const items = Array.isArray(shiftedData.items) ? shiftedData.items : [];
    for (const item of items) {
      const name = this.sanitizeText(item.name || item.itemName || 'Item');
      const qty = Number(item.quantity || item.qty || 1);
      chunks.push(Buffer.from(` * [TRANSFERRED - DO NOT RE-COOK] ${name} x${qty}\n`, 'utf8'));
    }

    chunks.push(Buffer.from('-'.repeat(width) + '\n', 'utf8'));
    chunks.push(ESC_POS_COMMANDS.FEED_3_LINES);
    chunks.push(ESC_POS_COMMANDS.CUT_PARTIAL);

    return Buffer.concat(chunks);
  }
}

module.exports = {
  ReceiptPrinterAdapter,
  ESC_POS_COMMANDS,
};
