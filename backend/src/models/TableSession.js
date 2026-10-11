'use strict';

/**
 * TABLE SESSION — MONGOOSE MODEL (P15 CHANNELS & FRONT SERVICE)
 *
 * Implements authoritative dining table sessions for multi-round table ordering:
 *   - Aggregates multiple rounds submitted via QR guest ordering, Captain tableside POS, or Front Counter.
 *   - Preserves immutable line item snapshots, tax calculation, and modifiers per round.
 *   - Prevents duplicate financial ledgers: finalized sales consolidate into a canonical P09 Bill.
 */

const mongoose = require('mongoose');

const SESSION_STATUSES = ['ACTIVE', 'BILLED', 'CLOSED', 'CANCELLED'];

const tableOrderLineItemSchema = new mongoose.Schema(
  {
    menuItemId: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
    },
    itemNameSnapshot: {
      type: String,
      required: true,
      trim: true,
    },
    quantity: {
      type: Number,
      required: true,
      min: 1,
    },
    unitPricePaisa: {
      type: Number,
      required: true,
      min: 0,
    },
    lineSubtotalPaisa: {
      type: Number,
      required: true,
      min: 0,
    },
    taxRatePercent: {
      type: Number,
      default: 5,
      min: 0,
    },
    cgstPaisa: {
      type: Number,
      default: 0,
      min: 0,
    },
    sgstPaisa: {
      type: Number,
      default: 0,
      min: 0,
    },
    lineTotalPaisa: {
      type: Number,
      required: true,
      min: 0,
    },
    modifiers: {
      type: mongoose.Schema.Types.Mixed,
      default: () => ({}),
    },
    variantSnapshot: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    comboSnapshot: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    itemNotes: {
      type: String,
      trim: true,
      default: '',
    },
  },
  { _id: true }
);

const orderRoundSchema = new mongoose.Schema(
  {
    roundId: {
      type: String,
      required: true,
      trim: true,
    },
    roundNumber: {
      type: Number,
      required: true,
      min: 1,
    },
    channel: {
      type: String,
      enum: ['QR_ORDER', 'TABLE_CAPTAIN', 'POS', 'DIRECT_WEB'],
      default: 'QR_ORDER',
    },
    submittedAt: {
      type: Date,
      default: Date.now,
    },
    lineItems: {
      type: [tableOrderLineItemSchema],
      required: true,
    },
    roundSubtotalPaisa: {
      type: Number,
      required: true,
      min: 0,
    },
    roundTaxPaisa: {
      type: Number,
      required: true,
      min: 0,
    },
    roundTotalPaisa: {
      type: Number,
      required: true,
      min: 0,
    },
    status: {
      type: String,
      enum: ['RECEIVED', 'PREPARING', 'SERVED', 'CANCELLED'],
      default: 'RECEIVED',
    },
  },
  { _id: true }
);

const tableSessionSchema = new mongoose.Schema(
  {
    sessionId: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      uppercase: true,
      index: true,
    },
    organisationId: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
      index: true,
    },
    cafeId: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
      index: true,
    },
    tableId: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
      index: true,
    },
    tableNumber: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
    },
    covers: {
      type: Number,
      default: 1,
      min: 1,
    },
    status: {
      type: String,
      enum: SESSION_STATUSES,
      default: 'ACTIVE',
      index: true,
    },
    customerName: {
      type: String,
      trim: true,
      default: '',
    },
    customerPhone: {
      type: String,
      trim: true,
      default: '',
    },
    openedAt: {
      type: Date,
      default: Date.now,
    },
    closedAt: {
      type: Date,
      default: null,
    },
    openedByUserId: {
      type: String,
      trim: true,
      default: 'GUEST_QR',
    },
    closedByUserId: {
      type: String,
      trim: true,
      default: null,
    },
    rounds: {
      type: [orderRoundSchema],
      default: [],
    },
    currentBillId: {
      type: String,
      trim: true,
      default: null,
      index: true,
    },
    cumulativeTotalPaisa: {
      type: Number,
      default: 0,
      min: 0,
    },
  },
  {
    timestamps: true,
    collection: 'table_sessions',
  }
);

tableSessionSchema.index({ organisationId: 1, cafeId: 1, tableId: 1, status: 1 });
tableSessionSchema.index({ organisationId: 1, sessionId: 1 }, { unique: true });

const TableSession =
  mongoose.models.TableSession ||
  mongoose.model('TableSession', tableSessionSchema);

module.exports = {
  TableSession,
  SESSION_STATUSES,
};
