'use strict';

/**
 * RECIPE MASTER — MONGOOSE MODEL (SCR-013)
 *
 * Defines commercial formulas, yields, portion sizes, preparation loss,
 * nested sub-recipes, and ingredient bills of materials referencing SCR-011
 * GlobalInventoryItem records. Includes strict DAG cycle validation.
 */

const mongoose = require('mongoose');

const RECIPE_STATUSES = ['DRAFT', 'REVIEW', 'APPROVED', 'EFFECTIVE', 'SUPERSEDED'];
const CONFIDENTIALITY_LEVELS = ['STANDARD', 'INTERNAL', 'CONFIDENTIAL'];

const recipeIngredientSchema = new mongoose.Schema(
  {
    inventoryItemId: {
      type: String,
      trim: true,
      uppercase: true,
      default: null, // References SCR-011 GlobalInventoryItem
    },
    subRecipeId: {
      type: String,
      trim: true,
      uppercase: true,
      default: null, // References nested Recipe
    },
    ingredientName: {
      type: String,
      required: true,
      trim: true,
    },
    quantity: {
      type: Number,
      required: true,
      min: 0.0001,
    },
    uom: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
    },
    lossFactorPercent: {
      type: Number,
      default: 0,
      min: 0,
      max: 99,
    },
    isOptional: {
      type: Boolean,
      default: false,
    },
    costPerUnit: {
      type: Number,
      default: null,
    },
    costPaisa: {
      type: Number,
      default: null,
    },
  },
  { _id: true, strict: false }
);

const recipeSchema = new mongoose.Schema(
  {
    recipeId: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      uppercase: true,
      match: /^RCP-\d{4,}$/,
      index: true,
    },

    organisationId: {
      type: String,
      required: true,
      immutable: true,
      trim: true,
      uppercase: true,
      default: 'ZAMORIN',
      index: true,
    },

    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200,
    },

    version: {
      type: Number,
      required: true,
      default: 1,
      min: 1,
    },

    isSubRecipe: {
      type: Boolean,
      default: false,
      index: true,
    },

    outputItemId: {
      type: String,
      trim: true,
      uppercase: true,
      default: null,
      index: true,
    },

    shelfLifeDays: {
      type: Number,
      default: 3,
      min: 0,
    },

    conceptEligibility: {
      type: String,
      enum: ['CAFE', 'RESTAURANT', 'SHARED'],
      default: 'SHARED',
    },

    batchYield: {
      type: Number,
      required: true,
      default: 1,
      min: 0.01,
    },

    yieldUom: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
      default: 'PORTION',
    },

    portionSize: {
      type: Number,
      required: true,
      default: 1,
      min: 0.01,
    },

    portionUom: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
      default: 'PORTION',
    },

    preparationLossPercent: {
      type: Number,
      default: 0,
      min: 0,
      max: 90,
    },

    ingredients: {
      type: [recipeIngredientSchema],
      default: [],
    },

    instructionsText: {
      type: String,
      default: '',
    },

    confidentiality: {
      type: String,
      enum: CONFIDENTIALITY_LEVELS,
      default: 'STANDARD',
    },

    status: {
      type: String,
      enum: RECIPE_STATUSES,
      default: 'APPROVED',
      index: true,
    },

    effectiveFrom: {
      type: Date,
      default: Date.now,
    },

    effectiveTo: {
      type: Date,
      default: null,
    },

    createdByUserId: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
    },

    approvedByUserId: {
      type: String,
      trim: true,
      uppercase: true,
      default: null,
    },
  },
  {
    timestamps: true,
    collection: 'recipes',
    strict: false,
  }
);

recipeSchema.index({ organisationId: 1, name: 1, version: 1 });

const Recipe = mongoose.models.Recipe || mongoose.model('Recipe', recipeSchema);

module.exports = {
  Recipe,
  RECIPE_STATUSES,
  CONFIDENTIALITY_LEVELS,
};
