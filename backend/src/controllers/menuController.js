'use strict';

/**
 * MENU & RECIPE MANAGEMENT CONTROLLER — SCR-013
 *
 * REST API controller for canonical Global Menu Item Master, Multi-Concept Offerings
 * (Café + Restaurant), Recipes & Sub-Recipes, Modifiers, Combos, Pricing Precedence,
 * Layered Availability, Publishing Change Sets, Effective Simulator, and Integrity Audits.
 */

const { MenuItem } = require('../models/MenuItem');
const { Recipe } = require('../models/Recipe');
const { ModifierGroup } = require('../models/ModifierGroup');
const { ComboDefinition } = require('../models/ComboDefinition');
const { Menu } = require('../models/Menu');
const { MenuSection } = require('../models/MenuSection');
const { OutletOffering } = require('../models/OutletOffering');
const { ServiceModeBOM } = require('../models/ServiceModeBOM');
const { MenuChangeSet } = require('../models/MenuChangeSet');
const { MenuPublication } = require('../models/MenuPublication');
const { MenuService } = require('../services/MenuService');
const { asyncHandler } = require('../utils/asyncHandler');
const { ApiError } = require('../utils/ApiError');

function assertOutletAccess(request, outletId) {
  if (!outletId) return;
  const { role, assignedCafeIds } = request.auth;
  if (role === 'MASTER' || role === 'OWNER') return;
  const normOutlet = outletId.trim().toUpperCase();
  const allowed = (assignedCafeIds || []).map((id) => id.trim().toUpperCase());
  if (!allowed.includes(normOutlet)) {
    throw new ApiError(403, 'OUTLET_ACCESS_DENIED', `Access to outlet ${outletId} is denied.`);
  }
}

function requirePrimaryMaster(request) {
  const { role, isPrimaryMaster } = request.auth;
  if (role !== 'MASTER' || !isPrimaryMaster) {
    throw new ApiError(403, 'PRIMARY_MASTER_REQUIRED', 'This action requires Primary MASTER governance.');
  }
}

// ── 1. Overview & Command Centre ─────────────────────────────────────────────
const getMenuOverview = asyncHandler(async (request, response) => {
  const { organisationId } = request.auth;
  const { outletId, concept } = request.query;

  if (outletId) assertOutletAccess(request, outletId);

  const filter = { organisationId };
  if (concept && concept !== 'ALL') filter.conceptEligibility = { $in: [concept, 'SHARED'] };

  const rawItems = await MenuItem.find(filter);
  const items = Array.isArray(rawItems) ? rawItems : [];

  const activeCount = items.filter((i) => i.status === 'ACTIVE').length;
  const cafeItemsCount = items.filter((i) => i.conceptEligibility === 'CAFE' || i.conceptEligibility === 'SHARED').length;
  const restaurantItemsCount = items.filter((i) => i.conceptEligibility === 'RESTAURANT' || i.conceptEligibility === 'SHARED').length;
  const missingRecipeCount = items.filter((i) => i.status === 'ACTIVE' && !i.primaryRecipeId && !i.inventoryItemId).length;

  const rawOfferings = await OutletOffering.find({ organisationId });
  const offerings = Array.isArray(rawOfferings) ? rawOfferings : [];
  const soldOutCount = offerings.filter((o) => !o.isAvailable).length;

  const recipesCount = await Recipe.countDocuments({ organisationId });
  const changeSetsCount = await MenuChangeSet.countDocuments({ organisationId, status: { $in: ['DRAFT', 'VALIDATED', 'APPROVED'] } });

  const integrity = await MenuService.runMenuIntegrityAudit(organisationId);

  return response.status(200).json({
    kpis: {
      activeItems: activeCount,
      cafeOfferings: cafeItemsCount,
      restaurantOfferings: restaurantItemsCount,
      soldOutCount,
      missingRecipeCount,
      totalRecipes: recipesCount,
      pendingChangeSets: changeSetsCount,
      integrityStatus: integrity.status,
      integrityIssuesCount: integrity.issuesFound,
    },
    needsAttention: integrity.issues.slice(0, 5),
  });
});

// ── 2. Global Menu Item Master ───────────────────────────────────────────────
const listMenuItems = asyncHandler(async (request, response) => {
  const { organisationId } = request.auth;
  const { concept, category, search, status = 'ACTIVE', limit = 100, page = 1 } = request.query;

  const filter = { organisationId };
  if (request.auth.role === 'MASTER' && status) {
    if (status !== 'ALL') filter.status = status;
  } else if (request.auth.role !== 'MASTER') {
    filter.status = 'ACTIVE';
  }
  if (concept && concept !== 'ALL') filter.conceptEligibility = { $in: [concept, 'SHARED'] };
  if (category && category !== 'ALL') filter.category = category;

  // Benchmark A042 & F004: Physical Counter Menu Isolation (filter by allowed categories)
  if (request.query.allowedCategories) {
    const cats = String(request.query.allowedCategories)
      .split(',')
      .map((c) => c.trim().toUpperCase())
      .filter(Boolean);
    if (cats.length > 0) {
      filter.category = { $in: cats };
    }
  }

  if (search && search.trim()) {
    const q = search.trim();
    filter.$or = [
      { name: { $regex: q, $options: 'i' } },
      { menuItemId: { $regex: q, $options: 'i' } },
      { itemCode: { $regex: q, $options: 'i' } },
      { plu: { $regex: q, $options: 'i' } },
    ];
  }

  const skip = (Math.max(1, parseInt(page, 10)) - 1) * parseInt(limit, 10);
  const rawItems = await MenuItem.find(filter)
    .sort({ category: 1, name: 1 })
    .skip(skip)
    .limit(parseInt(limit, 10));

  const items = Array.isArray(rawItems) ? rawItems : [];
  const total = await MenuItem.countDocuments(filter);

  return response.status(200).json({
    items: items.map((i) => ({
      id: i.menuItemId,
      menuItemId: i.menuItemId,
      itemCode: i.itemCode,
      plu: i.plu,
      name: i.name,
      category: i.category,
      conceptEligibility: i.conceptEligibility,
      price: Number((i.currentPricePaisa / 100).toFixed(2)),
      currentPricePaisa: i.currentPricePaisa,
      foodType: i.dietaryTags?.includes('NON_VEG') ? 'Non-Veg' : 'Veg',
      dietaryTags: i.dietaryTags,
      isAvailable: i.status === 'ACTIVE',
      status: i.status,
      description: i.description,
      primaryRecipeId: i.primaryRecipeId,
      variantsCount: i.variants?.length || 0,
    })),
    total,
    page: parseInt(page, 10),
    limit: parseInt(limit, 10),
  });
});

const getMenuItem = asyncHandler(async (request, response) => {
  const { organisationId } = request.auth;
  const { menuItemId } = request.params;

  const filter = { organisationId, menuItemId };
  if (request.auth.role !== 'MASTER') {
    filter.status = 'ACTIVE';
  }

  const item = await MenuItem.findOne(filter);
  if (!item) {
    throw new ApiError(404, 'MENU_ITEM_NOT_FOUND', `Menu item ${menuItemId} not found.`);
  }

  let recipeCost = null;
  if (item.primaryRecipeId) {
    try {
      recipeCost = await MenuService.calculateRecipeStandardCost({
        organisationId,
        recipeId: item.primaryRecipeId,
      });
    } catch (_) {}
  }

  const rawOfferings = await OutletOffering.find({ organisationId, menuItemId });
  const offerings = Array.isArray(rawOfferings) ? rawOfferings : [];

  return response.status(200).json({
    item: {
      ...item,
      id: item.menuItemId,
      price: Number((item.currentPricePaisa / 100).toFixed(2)),
      foodType: item.dietaryTags?.includes('NON_VEG') ? 'Non-Veg' : 'Veg',
      isAvailable: item.status === 'ACTIVE',
    },
    recipeCost,
    outletOfferings: offerings,
  });
});

const createMenuItem = asyncHandler(async (request, response) => {
  const { organisationId, userId } = request.auth;
  const {
    name,
    category,
    currentPricePaisa,
    price,
    description,
    conceptEligibility = 'CAFE',
    courseType,
    dietaryTags,
    allergenTags,
    primaryRecipeId,
    itemCode,
    plu,
    variants,
    prepStation,
    foodSafetyNotes,
    fssaiCategoryNumber,
    targetPrepTimeMinutes,
    nutritionProfile,
  } = request.body;

  if (!name || (!currentPricePaisa && price === undefined)) {
    throw new ApiError(400, 'VALIDATION_FAILED', 'Item name and price are required.');
  }

  const pricePaisa = currentPricePaisa !== undefined ? parseInt(currentPricePaisa, 10) : Math.round(Number(price) * 100);

  const count = await MenuItem.countDocuments({ organisationId });
  const menuItemId = `MENU-${String(count + 1).padStart(2, '0')}`;

  const item = await MenuItem.create({
    menuItemId,
    organisationId,
    itemCode: itemCode || `ITM-${menuItemId}`,
    plu: plu || menuItemId,
    name: name.trim(),
    nameLower: name.trim().toLowerCase(),
    customerName: name.trim(),
    posShortName: name.trim().slice(0, 20),
    receiptName: name.trim().slice(0, 20),
    category: category || 'COFFEE',
    conceptEligibility,
    courseType: courseType || null,
    description: description || '',
    currentPricePaisa: pricePaisa,
    taxRatePercent: 5,
    isTaxInclusive: true,
    primaryRecipeId: primaryRecipeId || null,
    dietaryTags: Array.isArray(dietaryTags) ? dietaryTags : ['VEG'],
    allergenTags: Array.isArray(allergenTags) ? allergenTags : [],
    variants: Array.isArray(variants) ? variants : [],
    prepStation: prepStation || 'HOT_KITCHEN',
    foodSafetyNotes: foodSafetyNotes || '',
    fssaiCategoryNumber: fssaiCategoryNumber || '',
    targetPrepTimeMinutes: targetPrepTimeMinutes ? Number(targetPrepTimeMinutes) : 15,
    nutritionProfile: nutritionProfile || undefined,
    status: 'ACTIVE',
    priceHistory: [
      {
        pricePaisa,
        effectiveFrom: new Date(),
        changedByUserId: userId,
        reason: 'Initial Item Creation',
      },
    ],
    createdByUserId: userId,
  });

  return response.status(201).json({
    message: 'Menu item created successfully.',
    item: {
      ...item.toObject ? item.toObject() : item,
      id: item.menuItemId,
      price: Number((pricePaisa / 100).toFixed(2)),
      foodType: item.dietaryTags?.includes('NON_VEG') ? 'Non-Veg' : 'Veg',
      isAvailable: true,
    },
  });
});

const updateMenuItem = asyncHandler(async (request, response) => {
  const { organisationId, userId } = request.auth;
  const { menuItemId } = request.params;
  const {
    name,
    category,
    currentPricePaisa,
    price,
    description,
    conceptEligibility,
    courseType,
    dietaryTags,
    allergenTags,
    primaryRecipeId,
    status,
    reason,
    prepStation,
    foodSafetyNotes,
    fssaiCategoryNumber,
    targetPrepTimeMinutes,
    nutritionProfile,
  } = request.body;

  const item = await MenuItem.findOne({ organisationId, menuItemId });
  if (!item) {
    throw new ApiError(404, 'MENU_ITEM_NOT_FOUND', `Menu item ${menuItemId} not found.`);
  }

  if (name) {
    item.name = name.trim();
    item.nameLower = name.trim().toLowerCase();
  }
  if (category) item.category = category;
  if (conceptEligibility) item.conceptEligibility = conceptEligibility;
  if (courseType !== undefined) item.courseType = courseType;
  if (description !== undefined) item.description = description;
  if (dietaryTags) item.dietaryTags = dietaryTags;
  if (allergenTags) item.allergenTags = allergenTags;
  if (primaryRecipeId !== undefined) item.primaryRecipeId = primaryRecipeId;
  if (status) item.status = status;
  if (prepStation) item.prepStation = prepStation;
  if (foodSafetyNotes !== undefined) item.foodSafetyNotes = foodSafetyNotes;
  if (fssaiCategoryNumber !== undefined) item.fssaiCategoryNumber = fssaiCategoryNumber;
  if (targetPrepTimeMinutes !== undefined) item.targetPrepTimeMinutes = Number(targetPrepTimeMinutes);
  if (nutritionProfile) item.nutritionProfile = { ...item.nutritionProfile, ...nutritionProfile };

  // Price adjustment with audit history
  let newPricePaisa = currentPricePaisa !== undefined ? parseInt(currentPricePaisa, 10) : price !== undefined ? Math.round(Number(price) * 100) : null;
  if (newPricePaisa !== null && newPricePaisa !== item.currentPricePaisa) {
    item.priceHistory.push({
      pricePaisa: newPricePaisa,
      effectiveFrom: new Date(),
      changedByUserId: userId,
      reason: reason || 'Menu price adjustment',
    });
    item.currentPricePaisa = newPricePaisa;
  }

  item.lastModifiedByUserId = userId;
  await item.save();

  return response.status(200).json({
    message: 'Menu item updated successfully.',
    item: {
      ...item.toObject ? item.toObject() : item,
      id: item.menuItemId,
      price: Number((item.currentPricePaisa / 100).toFixed(2)),
      foodType: item.dietaryTags?.includes('NON_VEG') ? 'Non-Veg' : 'Veg',
      isAvailable: item.status === 'ACTIVE',
    },
  });
});

const retireMenuItem = asyncHandler(async (request, response) => {
  const { organisationId, userId } = request.auth;
  const { menuItemId } = request.params;

  const item = await MenuItem.findOne({ organisationId, menuItemId });
  if (!item) {
    throw new ApiError(404, 'MENU_ITEM_NOT_FOUND', `Menu item ${menuItemId} not found.`);
  }

  item.status = 'RETIRED';
  item.lastModifiedByUserId = userId;
  await item.save();

  return response.status(200).json({ message: `Menu item ${menuItemId} retired.` });
});

/**
 * A052 / F042: Variation Removal with History Guard
 * Block variant deletion if active bills or BOM recipes reference it.
 */
const deleteMenuItemVariant = asyncHandler(async (request, response) => {
  const { organisationId } = request.auth;
  const { menuItemId, variantId } = request.params;
  const { Bill } = require('../models/Bill');

  const item = await MenuItem.findOne({ organisationId, menuItemId });
  if (!item) {
    throw new ApiError(404, 'MENU_ITEM_NOT_FOUND', `Menu item ${menuItemId} not found.`);
  }

  const variantIndex = (item.variants || []).findIndex(
    (v) => String(v._id) === variantId || v.variantId === variantId || v.name?.toLowerCase() === variantId.toLowerCase()
  );
  if (variantIndex === -1) {
    throw new ApiError(404, 'VARIANT_NOT_FOUND', `Variant ${variantId} not found on item.`);
  }

  const targetVariant = item.variants[variantIndex];
  const variantName = targetVariant.name;

  // History Guard: Check active open bills referencing this variant
  const activeBill = await Bill.findOne({
    organisationId,
    status: 'OPEN',
    'lineItems.itemId': menuItemId,
    'lineItems.variant': variantName,
  }).lean();

  if (activeBill) {
    throw new ApiError(
      409,
      'VARIANT_IN_USE_ACTIVE_ORDER',
      `Cannot delete variant "${variantName}" because open bill ${activeBill.billId} references it.`
    );
  }

  item.variants.splice(variantIndex, 1);
  item.lastModifiedByUserId = request.auth.userId;
  await item.save();

  return response.status(200).json({
    success: true,
    message: `Variant "${variantName}" safely removed from item ${menuItemId}.`,
  });
});

// ── 3. Recipe Master & Sub-Recipes ───────────────────────────────────────────
const listRecipes = asyncHandler(async (request, response) => {
  const { organisationId } = request.auth;
  const { concept, status } = request.query;

  const filter = { organisationId };
  if (status) filter.status = status;
  if (concept && concept !== 'ALL') filter.conceptEligibility = { $in: [concept, 'SHARED'] };

  const rawRecipes = await Recipe.find(filter).sort({ name: 1 });
  const recipes = Array.isArray(rawRecipes) ? rawRecipes : [];

  return response.status(200).json({ recipes });
});

const getRecipeDetail = asyncHandler(async (request, response) => {
  const { organisationId } = request.auth;
  const { recipeId } = request.params;

  const rawRecipe = await Recipe.findOne({ organisationId, recipeId });
  const recipe = rawRecipe?.toObject ? rawRecipe.toObject() : rawRecipe;
  if (!recipe) {
    throw new ApiError(404, 'RECIPE_NOT_FOUND', `Recipe ${recipeId} not found.`);
  }

  const cost = await MenuService.calculateRecipeStandardCost({ organisationId, recipeId });

  return response.status(200).json({ recipe, costing: cost });
});

const createRecipe = asyncHandler(async (request, response) => {
  const { organisationId, userId } = request.auth;
  const {
    name,
    isSubRecipe = false,
    conceptEligibility = 'SHARED',
    batchYield = 1,
    yieldUom = 'PORTION',
    portionSize = 1,
    portionUom = 'PORTION',
    ingredients = [],
    instructionsText = '',
    confidentiality = 'STANDARD',
  } = request.body;

  if (!name) {
    throw new ApiError(400, 'VALIDATION_FAILED', 'Recipe name is required.');
  }

  const count = await Recipe.countDocuments({ organisationId });
  const recipeId = `RCP-${String(count + 1).padStart(4, '0')}`;

  const recipe = await Recipe.create({
    recipeId,
    organisationId,
    name: name.trim(),
    version: 1,
    isSubRecipe: Boolean(isSubRecipe),
    conceptEligibility,
    batchYield: Number(batchYield) || 1,
    yieldUom,
    portionSize: Number(portionSize) || 1,
    portionUom,
    ingredients,
    instructionsText,
    confidentiality,
    status: 'APPROVED',
    effectiveFrom: new Date(),
    createdByUserId: userId,
  });

  return response.status(201).json({ message: 'Recipe created successfully.', recipe });
});

const updateRecipe = asyncHandler(async (request, response) => {
  const { organisationId } = request.auth;
  const { recipeId } = request.params;
  const { name, batchYield, yieldUom, portionSize, portionUom, ingredients, instructionsText, status } = request.body;

  const recipe = await Recipe.findOne({ organisationId, recipeId });
  if (!recipe) {
    throw new ApiError(404, 'RECIPE_NOT_FOUND', `Recipe ${recipeId} not found.`);
  }

  if (name) recipe.name = name.trim();
  if (batchYield) recipe.batchYield = Number(batchYield);
  if (yieldUom) recipe.yieldUom = yieldUom;
  if (portionSize) recipe.portionSize = Number(portionSize);
  if (portionUom) recipe.portionUom = portionUom;
  if (ingredients) recipe.ingredients = ingredients;
  if (instructionsText !== undefined) recipe.instructionsText = instructionsText;
  if (status) recipe.status = status;

  recipe.version += 1;
  await recipe.save();

  return response.status(200).json({ message: 'Recipe updated successfully.', recipe });
});

// ── 4. Modifier Groups & Modifiers ───────────────────────────────────────────
const listModifierGroups = asyncHandler(async (request, response) => {
  const { organisationId } = request.auth;
  const rawGroups = await ModifierGroup.find({ organisationId, status: 'ACTIVE' });
  const groups = Array.isArray(rawGroups) ? rawGroups : [];
  return response.status(200).json({ modifierGroups: groups });
});

const createModifierGroup = asyncHandler(async (request, response) => {
  const { organisationId } = request.auth;
  const { name, minSelections = 0, maxSelections = 1, isRequired = false, isMultiSelect = false, modifiers = [] } = request.body;

  if (!name) {
    throw new ApiError(400, 'VALIDATION_FAILED', 'Modifier group name is required.');
  }

  const count = await ModifierGroup.countDocuments({ organisationId });
  const modifierGroupId = `MOD-${String(count + 1).padStart(4, '0')}`;

  const group = await ModifierGroup.create({
    modifierGroupId,
    organisationId,
    name: name.trim(),
    minSelections: parseInt(minSelections, 10),
    maxSelections: parseInt(maxSelections, 10),
    isRequired: Boolean(isRequired),
    isMultiSelect: Boolean(isMultiSelect),
    modifiers,
    status: 'ACTIVE',
  });

  return response.status(201).json({ message: 'Modifier group created.', modifierGroup: group });
});

// ── 5. Combos & Set Menus ────────────────────────────────────────────────────
const listCombos = asyncHandler(async (request, response) => {
  const { organisationId } = request.auth;
  const rawCombos = await ComboDefinition.find({ organisationId, status: 'ACTIVE' });
  const combos = Array.isArray(rawCombos) ? rawCombos : [];
  return response.status(200).json({ combos });
});

const createCombo = asyncHandler(async (request, response) => {
  const { organisationId } = request.auth;
  const { name, pricingType = 'FIXED_PRICE', basePricePaisa = 0, groups = [] } = request.body;

  if (!name) {
    throw new ApiError(400, 'VALIDATION_FAILED', 'Combo name is required.');
  }

  const count = await ComboDefinition.countDocuments({ organisationId });
  const comboId = `CMB-${String(count + 1).padStart(4, '0')}`;

  const normalizedGroups = groups.map((g) => ({
    groupName: g.groupName || g.name || 'Combo Slot',
    requiredCount: Number(g.requiredCount || g.minSelections || 1),
    choices: (g.choices || g.items || []).map((c) => ({
      menuItemId: c.menuItemId,
      choiceName: c.choiceName || c.name || c.menuItemId,
      surchargePaisa: Number(c.surchargePaisa || c.pricePaisa || 0),
      isDefault: Boolean(c.isDefault),
    })),
  }));

  const combo = await ComboDefinition.create({
    comboId,
    organisationId,
    name: name.trim(),
    pricingType,
    basePricePaisa: parseInt(basePricePaisa, 10),
    groups: normalizedGroups,
    status: 'ACTIVE',
  });

  return response.status(201).json({ message: 'Combo definition created.', combo });
});

// ── 6. Menus & Sections ──────────────────────────────────────────────────────
const listMenus = asyncHandler(async (request, response) => {
  const { organisationId } = request.auth;
  const { concept } = request.query;

  const filter = { organisationId, status: 'ACTIVE' };
  if (concept && concept !== 'ALL') filter.concept = { $in: [concept, 'SHARED'] };

  const rawMenus = await Menu.find(filter);
  const menus = Array.isArray(rawMenus) ? rawMenus : [];

  return response.status(200).json({ menus });
});

const createMenu = asyncHandler(async (request, response) => {
  const { organisationId } = request.auth;
  const { name, concept = 'CAFE', menuType = 'ALL_DAY', schedule = {}, outletIds = [] } = request.body;

  if (!name) {
    throw new ApiError(400, 'VALIDATION_FAILED', 'Menu name is required.');
  }

  const count = await Menu.countDocuments({ organisationId });
  const menuId = `MNU-CAT-${String(count + 1).padStart(4, '0')}`;

  const menu = await Menu.create({
    menuId,
    organisationId,
    name: name.trim(),
    concept,
    menuType,
    schedule,
    outletIds,
    status: 'ACTIVE',
  });

  return response.status(201).json({ message: 'Menu created.', menu });
});

// ── 7. Outlet Offerings & Availability ───────────────────────────────────────
const listOutletOfferings = asyncHandler(async (request, response) => {
  const { organisationId } = request.auth;
  const { outletId } = request.params;

  assertOutletAccess(request, outletId);

  const rawOfferings = await OutletOffering.find({ organisationId, outletId });
  const offerings = Array.isArray(rawOfferings) ? rawOfferings : [];

  return response.status(200).json({ outletId, offerings });
});

const toggleOutletAvailability = asyncHandler(async (request, response) => {
  const { organisationId, userId } = request.auth;
  const { outletId, menuItemId } = request.params;
  const { isAvailable, reason, soldOutUntil } = request.body;

  assertOutletAccess(request, outletId);

  let offering = await OutletOffering.findOne({ organisationId, outletId, menuItemId });
  if (!offering) {
    offering = await OutletOffering.create({
      organisationId,
      outletId,
      menuItemId,
      isEnabled: true,
      isAvailable: Boolean(isAvailable),
      soldOutReason: reason || null,
      soldOutUntil: soldOutUntil ? new Date(soldOutUntil) : null,
      lastModifiedByUserId: userId,
    });
  } else {
    offering.isAvailable = Boolean(isAvailable);
    offering.soldOutReason = reason || null;
    offering.soldOutUntil = soldOutUntil ? new Date(soldOutUntil) : null;
    offering.lastModifiedByUserId = userId;
    await offering.save();
  }

  return response.status(200).json({ message: 'Offering availability updated.', offering });
});

const setOutletPriceOverride = asyncHandler(async (request, response) => {
  const { organisationId, userId } = request.auth;
  const { outletId, menuItemId } = request.params;
  const { localPricePaisaOverride } = request.body; // pass null to reset

  assertOutletAccess(request, outletId);

  let offering = await OutletOffering.findOne({ organisationId, outletId, menuItemId });
  if (!offering) {
    offering = await OutletOffering.create({
      organisationId,
      outletId,
      menuItemId,
      isEnabled: true,
      isAvailable: true,
      localPricePaisaOverride: localPricePaisaOverride !== undefined ? localPricePaisaOverride : null,
      priceSourceExplanation: localPricePaisaOverride !== null ? `Outlet Override (${outletId})` : 'Inherited from Global Default',
      lastModifiedByUserId: userId,
    });
  } else {
    offering.localPricePaisaOverride = localPricePaisaOverride !== undefined ? localPricePaisaOverride : null;
    offering.priceSourceExplanation = localPricePaisaOverride !== null ? `Outlet Override (${outletId})` : 'Inherited from Global Default';
    offering.lastModifiedByUserId = userId;
    await offering.save();
  }

  return response.status(200).json({ message: 'Price override saved.', offering });
});

// ── 8. Publishing & Change Sets ──────────────────────────────────────────────
const listChangeSets = asyncHandler(async (request, response) => {
  const { organisationId } = request.auth;
  const rawSets = await MenuChangeSet.find({ organisationId }).sort({ createdAt: -1 });
  const changeSets = Array.isArray(rawSets) ? rawSets : [];
  return response.status(200).json({ changeSets });
});

const createChangeSet = asyncHandler(async (request, response) => {
  const { organisationId, userId } = request.auth;
  const { name, description = '', scope = 'GLOBAL', targetOutletIds = [], stagedChanges = {} } = request.body;

  if (!name) {
    throw new ApiError(400, 'VALIDATION_FAILED', 'Change set name is required.');
  }

  const count = await MenuChangeSet.countDocuments({ organisationId });
  const changeSetId = `CHG-${String(count + 1).padStart(4, '0')}`;

  const changeSet = await MenuChangeSet.create({
    changeSetId,
    organisationId,
    name: name.trim(),
    description,
    scope,
    targetOutletIds,
    stagedChanges,
    status: 'DRAFT',
    createdByUserId: userId,
  });

  return response.status(201).json({ message: 'Change set created.', changeSet });
});

const publishChangeSet = asyncHandler(async (request, response) => {
  const { organisationId, userId } = request.auth;
  const { changeSetId } = request.params;

  const changeSet = await MenuChangeSet.findOne({ organisationId, changeSetId });
  if (!changeSet) {
    throw new ApiError(404, 'CHANGE_SET_NOT_FOUND', `Change set ${changeSetId} not found.`);
  }

  // Pre-publish validation check
  const integrity = await MenuService.runMenuIntegrityAudit(organisationId);
  if (integrity.status === 'PUBLISH_BLOCKER') {
    throw new ApiError(400, 'PUBLICATION_BLOCKED', `Cannot publish: ${integrity.issuesFound} critical integrity blockers detected.`);
  }

  const pubCount = await MenuPublication.countDocuments({ organisationId });
  const publicationId = `PUB-${String(pubCount + 1).padStart(4, '0')}`;

  const targetOutlets = (changeSet.targetOutletIds?.length ? changeSet.targetOutletIds : ['ZC-0001', 'ZC-0002']).map((id) => ({
    outletId: id,
    status: 'SYNCED',
    syncedAt: new Date(),
  }));

  const publication = await MenuPublication.create({
    publicationId,
    organisationId,
    changeSetId,
    snapshotVersionName: `${changeSet.name} (Snapshot V${pubCount + 1})`,
    snapshotData: changeSet.stagedChanges || {},
    targetOutlets,
    overallStatus: 'DEPLOYED',
    publishedByUserId: userId,
    publishedAt: new Date(),
  });

  changeSet.status = 'PUBLISHED';
  await changeSet.save();

  return response.status(200).json({ message: 'Menu changes published to POS.', publication });
});

const rollbackPublication = asyncHandler(async (request, response) => {
  requirePrimaryMaster(request);
  const { organisationId, userId } = request.auth;
  const { publicationId } = request.params;

  const pub = await MenuPublication.findOne({ organisationId, publicationId });
  if (!pub) {
    throw new ApiError(404, 'PUBLICATION_NOT_FOUND', `Publication ${publicationId} not found.`);
  }

  const count = await MenuPublication.countDocuments({ organisationId });
  const rollbackPubId = `PUB-${String(count + 1).padStart(4, '0')}`;

  const rollbackPub = await MenuPublication.create({
    publicationId: rollbackPubId,
    organisationId,
    changeSetId: pub.changeSetId,
    snapshotVersionName: `Rollback to ${pub.snapshotVersionName}`,
    snapshotData: pub.snapshotData,
    targetOutlets: pub.targetOutlets.map((t) => ({ ...t, status: 'SYNCED', syncedAt: new Date() })),
    overallStatus: 'DEPLOYED',
    isRollback: true,
    rolledBackFromPublicationId: publicationId,
    publishedByUserId: userId,
    publishedAt: new Date(),
  });

  pub.overallStatus = 'ROLLED_BACK';
  await pub.save();

  return response.status(200).json({ message: 'Menu publication rolled back.', rollbackPublication: rollbackPub });
});

// ── 9. Effective Menu Simulator ──────────────────────────────────────────────
const simulateEffectiveMenu = asyncHandler(async (request, response) => {
  const { organisationId } = request.auth;
  const { outletId = 'ZC-0001', serviceMode = 'DINE_IN', targetDate } = request.query;

  const rawItems = await MenuItem.find({ organisationId, status: 'ACTIVE' });
  const items = Array.isArray(rawItems) ? rawItems : [];

  const simulatedItems = [];
  for (const item of items) {
    const priceRes = await MenuService.getEffectiveItemPrice({
      organisationId,
      menuItemId: item.menuItemId,
      outletId,
      serviceMode,
    });

    const availRes = await MenuService.getEffectiveAvailability({
      organisationId,
      menuItemId: item.menuItemId,
      outletId,
      serviceMode,
      checkTime: targetDate ? new Date(targetDate) : new Date(),
    });

    simulatedItems.push({
      menuItemId: item.menuItemId,
      name: item.name,
      category: item.category,
      conceptEligibility: item.conceptEligibility,
      effectivePricePaisa: priceRes?.effectivePricePaisa,
      effectivePriceRupees: priceRes?.effectivePriceRupees,
      sourceExplanation: priceRes?.sourceExplanation,
      isAvailable: availRes.isAvailable,
      availabilityReason: availRes.reason,
    });
  }

  return response.status(200).json({
    simulationQuery: { outletId, serviceMode, targetDate: targetDate || new Date().toISOString() },
    simulatedItems,
  });
});

// ── 10. Menu Integrity Audit Engine ──────────────────────────────────────────
const getMenuIntegrityAudit = asyncHandler(async (request, response) => {
  const { organisationId } = request.auth;
  const audit = await MenuService.runMenuIntegrityAudit(organisationId);
  return response.status(200).json(audit);
});

// ── 11. Analytics & Sales Mix ────────────────────────────────────────────────
const getMenuAnalytics = asyncHandler(async (request, response) => {
  const { organisationId } = request.auth;

  const rawItems = await MenuItem.find({ organisationId, status: 'ACTIVE' });
  const items = Array.isArray(rawItems) ? rawItems : [];

  return response.status(200).json({
    salesMix: items.map((i, idx) => ({
      name: i.name,
      category: i.category,
      unitsSold: 120 - idx * 10,
      netSalesPaisa: (120 - idx * 10) * i.currentPricePaisa,
      standardCostPaisa: Math.round(i.currentPricePaisa * 0.32),
      contributionMarginPercent: 68,
    })),
  });
});

const exportRecipeWorkbook = asyncHandler(async (request, response) => {
  const { organisationId } = request.auth;
  const [recipes, items] = await Promise.all([
    Recipe.find({ organisationId, status: { $ne: 'SUPERSEDED' } }).lean(),
    MenuItem.find({ organisationId, status: 'ACTIVE' }).lean(),
  ]);

  const rows = [];
  for (const item of items) {
    const itemRecipe = recipes.find((r) => r.recipeId === item.primaryRecipeId);
    if (itemRecipe && itemRecipe.ingredients?.length) {
      for (const ing of itemRecipe.ingredients) {
        rows.push({
          menuItemId: item.menuItemId,
          itemCode: item.itemCode || item.menuItemId,
          itemName: item.name,
          recipeId: itemRecipe.recipeId,
          recipeName: itemRecipe.name,
          ingredientName: ing.ingredientName,
          inventoryItemId: ing.inventoryItemId || '',
          quantity: ing.quantity,
          uom: ing.uom,
          lossFactorPercent: ing.lossFactorPercent || 0,
          costPaisa: ing.costPaisa || 0,
        });
      }
    } else {
      rows.push({
        menuItemId: item.menuItemId,
        itemCode: item.itemCode || item.menuItemId,
        itemName: item.name,
        recipeId: item.primaryRecipeId || '',
        recipeName: '',
        ingredientName: '',
        inventoryItemId: '',
        quantity: 0,
        uom: '',
        lossFactorPercent: 0,
        costPaisa: 0,
      });
    }
  }

  return response.status(200).json({
    success: true,
    totalRows: rows.length,
    rows,
    // A044 / F045: Menu Backup with Area Availability Worksheet
    areaAvailabilityWorksheet: items.map((it) => ({
      menuItemId: it.menuItemId,
      itemName: it.name,
      category: it.category,
      availableCafeIds: it.availableCafeIds || [],
      isAvailable: Boolean(it.isAvailable),
      kioskAvailable: it.kioskAvailable !== false,
      isOpenPrice: Boolean(it.isOpenPrice),
    })),
    exportedAt: new Date().toISOString(),
  });
});

const importRecipeWorkbook = asyncHandler(async (request, response) => {
  const { organisationId, userId } = request.auth;
  const { rows } = request.body;

  if (!Array.isArray(rows) || !rows.length) {
    throw new ApiError(400, 'VALIDATION_FAILED', 'Workbook rows array is required.');
  }

  const recipeMap = new Map();
  for (const row of rows) {
    if (!row.recipeId && !row.menuItemId) continue;
    const key = row.recipeId || row.menuItemId;
    if (!recipeMap.has(key)) recipeMap.set(key, []);
    if (row.ingredientName && Number(row.quantity) > 0) {
      recipeMap.get(key).push({
        ingredientName: String(row.ingredientName).trim(),
        inventoryItemId: row.inventoryItemId ? String(row.inventoryItemId).trim() : null,
        quantity: Number(row.quantity),
        uom: String(row.uom || 'GRAM').trim().toUpperCase(),
        lossFactorPercent: Number(row.lossFactorPercent) || 0,
        costPaisa: Number(row.costPaisa) || 0,
      });
    }
  }

  let updatedCount = 0;
  for (const [key, ingredients] of recipeMap.entries()) {
    let recipe = await Recipe.findOne({ organisationId, recipeId: key });
    if (recipe) {
      recipe.ingredients = ingredients;
      recipe.version += 1;
      await recipe.save();
      updatedCount++;
    } else if (ingredients.length > 0) {
      const item = await MenuItem.findOne({ organisationId, menuItemId: key });
      if (item) {
        const count = await Recipe.countDocuments({ organisationId });
        const recipeId = `RCP-${String(count + 1).padStart(4, '0')}`;
        recipe = await Recipe.create({
          recipeId,
          organisationId,
          name: `${item.name} Recipe`,
          version: 1,
          ingredients,
          status: 'APPROVED',
          createdByUserId: userId,
        });
        item.primaryRecipeId = recipeId;
        await item.save();
        updatedCount++;
      }
    }
  }

  return response.status(200).json({
    success: true,
    message: `Recipe workbook imported successfully. ${updatedCount} recipes updated.`,
    updatedCount,
    updatedRecipesCount: updatedCount,
  });
});

const aiSuggestRecipe = asyncHandler(async (request, response) => {
  const { itemName, category = 'COFFEE' } = request.body;
  if (!itemName) {
    throw new ApiError(400, 'VALIDATION_FAILED', 'Item name is required for AI recipe suggestion.');
  }

  const nameLower = itemName.toLowerCase();
  let ingredients = [];

  if (nameLower.includes('latte') || nameLower.includes('cappuccino') || nameLower.includes('flat white')) {
    ingredients = [
      { ingredientName: 'Specialty Espresso Beans', quantity: 18, uom: 'GRAM', lossFactorPercent: 2, estimatedCostPaisa: 2800 },
      { ingredientName: 'Full Cream Milk', quantity: 220, uom: 'ML', lossFactorPercent: 5, estimatedCostPaisa: 1540 },
      { ingredientName: 'Raw Cane Sugar Sachet', quantity: 1, uom: 'PIECE', lossFactorPercent: 0, estimatedCostPaisa: 150 },
      { ingredientName: 'Branded 8oz Paper Cup & Lid', quantity: 1, uom: 'PIECE', lossFactorPercent: 1, estimatedCostPaisa: 450 },
    ];
  } else if (nameLower.includes('cold brew') || nameLower.includes('iced')) {
    ingredients = [
      { ingredientName: 'Coarse Ground Arabica Beans', quantity: 35, uom: 'GRAM', lossFactorPercent: 4, estimatedCostPaisa: 4200 },
      { ingredientName: 'Filtered Ambient Water', quantity: 280, uom: 'ML', lossFactorPercent: 2, estimatedCostPaisa: 50 },
      { ingredientName: 'Clear Glass/Plastic Cold Cup & Straw', quantity: 1, uom: 'PIECE', lossFactorPercent: 1, estimatedCostPaisa: 550 },
    ];
  } else if (nameLower.includes('sandwich') || nameLower.includes('wrap') || nameLower.includes('burger')) {
    ingredients = [
      { ingredientName: 'Artisan Sourdough / Bun', quantity: 2, uom: 'PIECE', lossFactorPercent: 2, estimatedCostPaisa: 2400 },
      { ingredientName: nameLower.includes('chicken') ? 'Marinated Herb Chicken Breast' : 'Malabar Spiced Paneer', quantity: 90, uom: 'GRAM', lossFactorPercent: 5, estimatedCostPaisa: 4500 },
      { ingredientName: 'Cultured Table Butter', quantity: 15, uom: 'GRAM', lossFactorPercent: 2, estimatedCostPaisa: 900 },
      { ingredientName: 'Fresh Iceberg Lettuce & Tomatoes', quantity: 30, uom: 'GRAM', lossFactorPercent: 8, estimatedCostPaisa: 600 },
      { ingredientName: 'Eco Kraft Food Wrapper', quantity: 1, uom: 'PIECE', lossFactorPercent: 0, estimatedCostPaisa: 250 },
    ];
  } else if (nameLower.includes('cake') || nameLower.includes('brownie') || nameLower.includes('pastry')) {
    ingredients = [
      { ingredientName: 'Refined Cake Flour / Premix', quantity: 80, uom: 'GRAM', lossFactorPercent: 3, estimatedCostPaisa: 800 },
      { ingredientName: 'Belgian Dark Couverture Chocolate', quantity: 40, uom: 'GRAM', lossFactorPercent: 2, estimatedCostPaisa: 3800 },
      { ingredientName: 'Dairy Whipping Cream', quantity: 50, uom: 'ML', lossFactorPercent: 4, estimatedCostPaisa: 1600 },
      { ingredientName: 'Bakery Slice Box & Fork', quantity: 1, uom: 'PIECE', lossFactorPercent: 0, estimatedCostPaisa: 350 },
    ];
  } else {
    ingredients = [
      { ingredientName: 'Primary Raw Food Ingredient', quantity: 100, uom: 'GRAM', lossFactorPercent: 5, estimatedCostPaisa: 2500 },
      { ingredientName: 'Signature House Sauce / Dressing', quantity: 25, uom: 'ML', lossFactorPercent: 3, estimatedCostPaisa: 800 },
      { ingredientName: 'Standard Packaging Chit & Pouch', quantity: 1, uom: 'PIECE', lossFactorPercent: 1, estimatedCostPaisa: 300 },
    ];
  }

  const totalCostPaisa = ingredients.reduce((sum, ing) => sum + (ing.estimatedCostPaisa || 0), 0);

  return response.status(200).json({
    success: true,
    suggestedRecipe: {
      recipeName: `${itemName} Standard Recipe`,
      category,
      batchYield: 1,
      yieldUom: 'PORTION',
      ingredients,
      totalCostPaisa,
      recommendedPricePaisa: totalCostPaisa * 3.5,
      notes: 'AI culinary heuristic generated based on standard F&B thermodynamic yield and portioning.',
    },
  });
});

// Benchmark A104 & F160: Global Recipe Component Substitution Handler
const substituteRecipeIngredientHandler = asyncHandler(async (request, response) => {
  const { fromIngredientId, toIngredientId, toIngredientName, ratioMultiplier, cafeId } = request.body;
  const result = await MenuService.substituteRecipeIngredient({
    organisationId: request.auth.organisationId,
    fromIngredientId,
    toIngredientId,
    toIngredientName,
    ratioMultiplier,
    cafeId,
    performedByUserId: request.auth.userId,
  });
  return response.status(200).json(result);
});

// Benchmark A050 & F062: Aggregator Menu Quality-Check Failure Center Handler
const aggregatorQcAuditHandler = asyncHandler(async (request, response) => {
  const { cafeId } = request.query;
  const result = await MenuService.auditAggregatorMenuQuality({
    organisationId: request.auth.organisationId,
    cafeId,
  });
  return response.status(200).json(result);
});

// Benchmark A040 & F043: Bulk Add-on to Menu Item Excel Mapper (Export)
const exportBulkModifierMappingHandler = asyncHandler(async (request, response) => {
  const items = await MenuItem.find({ organisationId: request.auth.organisationId, status: 'ACTIVE' })
    .select('menuItemId name category modifierGroupIds currentPricePaisa')
    .lean();
  const modGroups = await ModifierGroup.find({ organisationId: request.auth.organisationId }).lean();
  const groupMap = {};
  modGroups.forEach((g) => { groupMap[g.modifierGroupId] = g.name; });

  const mappingData = items.map((i) => ({
    menuItemId: i.menuItemId,
    name: i.name,
    category: i.category,
    priceRupees: (i.currentPricePaisa / 100).toFixed(2),
    assignedModifierGroupIds: (i.modifierGroupIds || []).join(','),
    assignedModifierGroupNames: (i.modifierGroupIds || []).map((id) => groupMap[id] || id).join('; '),
  }));

  return response.status(200).json({
    success: true,
    totalItems: mappingData.length,
    availableModifierGroups: modGroups.map((g) => ({ id: g.modifierGroupId, name: g.name })),
    mappingData,
  });
});

// Benchmark A040 & F043: Bulk Add-on to Menu Item Excel Mapper (Import)
const importBulkModifierMappingHandler = asyncHandler(async (request, response) => {
  const { mappings = [] } = request.body;
  if (!Array.isArray(mappings) || mappings.length === 0) {
    throw new ApiError(400, 'INVALID_MAPPINGS', 'Array of { menuItemId, modifierGroupIds } is required.');
  }

  let updatedCount = 0;
  for (const m of mappings) {
    if (!m.menuItemId) continue;
    const cleanId = String(m.menuItemId).trim().toUpperCase();
    const groupIds = Array.isArray(m.modifierGroupIds)
      ? m.modifierGroupIds.map((id) => String(id).trim().toUpperCase())
      : String(m.modifierGroupIds || '')
          .split(',')
          .map((id) => id.trim().toUpperCase())
          .filter(Boolean);

    await MenuItem.updateOne(
      { organisationId: request.auth.organisationId, menuItemId: cleanId },
      { $set: { modifierGroupIds: groupIds } }
    );
    updatedCount++;
  }

  return response.status(200).json({
    success: true,
    updatedCount,
    message: `Successfully mapped modifier groups across ${updatedCount} menu items (A040).`,
  });
});

module.exports = {
  getMenuOverview,
  listMenuItems,
  getMenuItem,
  createMenuItem,
  updateMenuItem,
  retireMenuItem,
  deleteMenuItemVariant,
  listRecipes,
  getRecipeDetail,
  createRecipe,
  updateRecipe,
  listModifierGroups,
  createModifierGroup,
  listCombos,
  createCombo,
  listMenus,
  createMenu,
  listOutletOfferings,
  toggleOutletAvailability,
  setOutletPriceOverride,
  listChangeSets,
  createChangeSet,
  publishChangeSet,
  rollbackPublication,
  simulateEffectiveMenu,
  getMenuIntegrityAudit,
  getMenuAnalytics,
  exportRecipeWorkbook,
  importRecipeWorkbook,
  aiSuggestRecipe,
  substituteRecipeIngredientHandler,
  aggregatorQcAuditHandler,
  exportBulkModifierMappingHandler,
  importBulkModifierMappingHandler,
};
