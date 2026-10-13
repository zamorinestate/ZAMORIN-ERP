'use strict';

/**
 * GLOBAL INVENTORY ITEM — MONGOOSE MODEL
 *
 * Architecture:
 *   GlobalInventoryItem (organisation-wide catalogue)
 *     ↓ propagates to
 *   CafeInventoryConfig  (per-café availability, reorder levels, local vendor)
 *     ↓ balance tracked in
 *   CafeInventoryConfig.currentQuantityBase (atomic $inc operations)
 *     ↓ every change recorded in
 *   StockMovement (immutable ledger)
 */

const mongoose = require('mongoose');

const ITEM_STATUSES = [
  'DRAFT',
  'ACTIVE',
  'INACTIVE',
  'DISCONTINUED',
  'SUPERSEDED',
];

const ITEM_CATEGORIES = [
  'COFFEE_BEANS',
  'DAIRY_FRESH',
  'SYRUPS_FLAVOURS',
  'PACKAGING_CONSUMABLES',
  'BAKERY_FOOD_INPUTS',
  'CLEANING_SUPPLIES',
  'OTHER_CONTROLLED_MATERIALS',
  'BEVERAGE',
  'FOOD',
  'PACKAGING',
  'CLEANING',
  'EQUIPMENT',
  'STATIONERY',
  'PERISHABLE',
  'NON_PERISHABLE',
  'OTHER',
];

const unitConversionSchema = new mongoose.Schema(
  {
    fromUnit: {
      type: String,
      trim: true,
      lowercase: true,
      default: '',
    },
    toUnit: {
      type: String,
      trim: true,
      lowercase: true,
      default: '',
    },
    displayUnit: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      maxlength: 30,
    },
    factor: {
      type: Number,
      required: true,
      min: 0.000001,
    },
    version: {
      type: Number,
      default: 1,
      min: 1,
    },
    effectiveFrom: {
      type: Date,
      default: Date.now,
    },
    effectiveTo: {
      type: Date,
      default: null,
    },
    isDefaultDisplay: {
      type: Boolean,
      default: false,
    },
  },
  { _id: false }
);

const globalInventoryItemSchema = new mongoose.Schema(
  {
    organisationId: {
      type: String,
      required: true,
      immutable: true,
      trim: true,
      uppercase: true,
      index: true,
    },
    itemId: {
      type: String,
      required: true,
      immutable: true,
      trim: true,
      uppercase: true,
      index: true,
    },
    sku: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
      maxlength: 50,
    },
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 150,
    },
    nameLower: {
      type: String,
      trim: true,
      lowercase: true,
      index: true,
    },
    shortName: {
      type: String,
      trim: true,
      maxlength: 50,
      default: '',
    },
    description: {
      type: String,
      trim: true,
      maxlength: 500,
      default: '',
    },
    category: {
      type: String,
      required: true,
      enum: ITEM_CATEGORIES,
      index: true,
    },
    baseUnit: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      maxlength: 20,
    },
    stockUnit: {
      type: String,
      trim: true,
      lowercase: true,
      default: '',
    },
    purchaseUnit: {
      type: String,
      trim: true,
      lowercase: true,
      default: '',
    },
    packSize: {
      type: Number,
      default: 1,
      min: 0.001,
    },
    barcode: {
      type: String,
      trim: true,
      default: null,
      index: true,
    },
    criticality: {
      type: String,
      enum: ['CRITICAL', 'STANDARD', 'LOW'],
      default: 'STANDARD',
      index: true,
    },
    trackingMethod: {
      type: String,
      enum: ['FIFO', 'FEFO', 'STANDARD'],
      default: 'FEFO',
    },
    lotControl: {
      type: Boolean,
      default: true,
    },
    expiryControl: {
      type: Boolean,
      default: true,
    },
    shelfLifeDays: {
      type: Number,
      default: 30,
      min: 0,
    },
    minShelfLifeOnReceiptDays: {
      type: Number,
      default: 7,
      min: 0,
    },
    isWholeUnitOnly: {
      type: Boolean,
      default: false,
      index: true,
    },
    department: {
      type: String,
      enum: ['BAKERY', 'COFFEE_BAR', 'KITCHEN', 'STORE', 'PACKAGING', 'GENERAL'],
      default: 'GENERAL',
      index: true,
    },
    unitCostPaisa: {
      type: Number,
      default: 0,
      min: 0,
    },
    approvedSubstituteItemIds: {
      type: [String],
      default: [],
    },
    status: {
      type: String,
      required: true,
      enum: ITEM_STATUSES,
      default: 'ACTIVE',
      index: true,
    },
    conversions: {
      type: [unitConversionSchema],
      default: [],
    },
    storageConstraints: {
      temperatureZone: {
        type: String,
        enum: ['AMBIENT', 'CHILLED', 'FROZEN', 'COOL_DRY', 'GENERAL'],
        default: 'AMBIENT',
      },
      minTemperatureCelsius: { type: Number, default: null },
      maxTemperatureCelsius: { type: Number, default: null },
      maxHumidityPercent: { type: Number, default: null },
      handlingNotes: { type: String, trim: true, default: '' },
    },
    primaryVendorId: {
      type: String,
      trim: true,
      uppercase: true,
      default: null,
      index: true,
    },
    approvedVendorIds: {
      type: [String],
      default: [],
    },
    createdByUserId: {
      type: String,
      required: true,
      immutable: true,
      trim: true,
    },
    updatedByUserId: {
      type: String,
      trim: true,
      default: null,
    },
  },
  {
    timestamps: true,
    optimisticConcurrency: true,
  }
);

globalInventoryItemSchema.pre('validate', function (next) {
  if (this.name) {
    this.nameLower = this.name.trim().toLowerCase();
  }
  if (typeof next === 'function') next();
});

globalInventoryItemSchema.index(
  { organisationId: 1, itemId: 1 },
  { unique: true }
);

globalInventoryItemSchema.index(
  { organisationId: 1, sku: 1 },
  { unique: true }
);

globalInventoryItemSchema.index(
  { organisationId: 1, category: 1, status: 1 }
);

globalInventoryItemSchema.index(
  { organisationId: 1, primaryVendorId: 1 }
);

const GlobalInventoryItem =
  mongoose.models.GlobalInventoryItem ||
  mongoose.model('GlobalInventoryItem', globalInventoryItemSchema);

module.exports = {
  GlobalInventoryItem,
  ITEM_STATUSES,
  ITEM_CATEGORIES,
};
