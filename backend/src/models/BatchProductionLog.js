'use strict';

const mongoose = require('mongoose');

const BATCH_PRODUCTION_STATUSES = ['IN_PROGRESS', 'COMPLETED', 'DISCARDED'];

const consumedIngredientSchema = new mongoose.Schema(
  {
    itemId: { type: String, required: true, uppercase: true, trim: true },
    ingredientName: { type: String, required: true },
    quantityRequired: { type: Number, required: true },
    quantityConsumed: { type: Number, required: true },
    uom: { type: String, default: 'UNIT' },
    costPaisa: { type: Number, default: 0 },
  },
  { _id: false }
);

const batchProductionLogSchema = new mongoose.Schema(
  {
    organisationId: {
      type: String,
      required: true,
      immutable: true,
      uppercase: true,
      trim: true,
      index: true,
    },
    cafeId: {
      type: String,
      required: true,
      uppercase: true,
      trim: true,
      index: true,
    },
    batchNumber: {
      type: String,
      required: true,
      unique: true,
      uppercase: true,
      trim: true,
      index: true,
    },
    recipeId: {
      type: String,
      required: true,
      uppercase: true,
      trim: true,
      index: true,
    },
    recipeName: {
      type: String,
      default: '',
    },
    outputItemId: {
      type: String,
      required: true,
      uppercase: true,
      trim: true,
      index: true,
    },
    outputLotId: {
      type: String,
      default: null,
      trim: true,
    },
    plannedYield: {
      type: Number,
      required: true,
      min: 0.0001,
    },
    actualYield: {
      type: Number,
      required: true,
      min: 0.0001,
    },
    yieldUom: {
      type: String,
      required: true,
      default: 'PORTION',
    },
    yieldEfficiencyPercent: {
      type: Number,
      required: true,
      default: 100,
    },
    shrinkagePercent: {
      type: Number,
      default: 0,
    },
    totalMaterialCostPaisa: {
      type: Number,
      required: true,
      default: 0,
    },
    unitCostPaisa: {
      type: Number,
      required: true,
      default: 0,
    },
    consumedIngredients: {
      type: [consumedIngredientSchema],
      default: [],
    },
    status: {
      type: String,
      enum: BATCH_PRODUCTION_STATUSES,
      default: 'COMPLETED',
      index: true,
    },
    notes: {
      type: String,
      default: '',
    },
    producedByUserId: {
      type: String,
      required: true,
      uppercase: true,
      trim: true,
    },
    expiryDate: {
      type: String,
      default: null,
    },
  },
  {
    timestamps: true,
    collection: 'batch_production_logs',
  }
);

batchProductionLogSchema.index({ organisationId: 1, cafeId: 1, createdAt: -1 });

const BatchProductionLog =
  mongoose.models.BatchProductionLog ||
  mongoose.model('BatchProductionLog', batchProductionLogSchema);

module.exports = {
  BatchProductionLog,
  BATCH_PRODUCTION_STATUSES,
};
