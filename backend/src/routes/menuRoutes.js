'use strict';

/**
 * MENU & RECIPE MANAGEMENT ROUTES — SCR-013
 * Mounted at: /api/v1/menu (registered in routes/index.js)
 */

const express = require('express');
const { authenticate } = require('../middleware/authenticate');
const { authorize } = require('../middleware/authorize');

const {
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
} = require('../controllers/menuController');

const router = express.Router();

router.use(authenticate);

// 1. Overview & Command Centre
router.get(
  '/overview',
  authorize('MENU_READ', { allowedRoles: ['MASTER', 'OWNER', 'CAFE_ADMIN'] }),
  getMenuOverview
);

// 2. Global Menu Item Master
router.get(
  '/items',
  authorize('MENU_READ', { allowedRoles: ['MASTER', 'OWNER', 'CAFE_ADMIN'] }),
  listMenuItems
);

router.get(
  '/items/:menuItemId',
  authorize('MENU_READ', { allowedRoles: ['MASTER', 'OWNER', 'CAFE_ADMIN'] }),
  getMenuItem
);

router.post(
  '/items',
  authorize('MENU_WRITE', { allowedRoles: ['MASTER'] }),
  createMenuItem
);

router.patch(
  '/items/:menuItemId',
  authorize('MENU_WRITE', { allowedRoles: ['MASTER'] }),
  updateMenuItem
);

router.delete(
  '/items/:menuItemId',
  authorize('MENU_WRITE', { allowedRoles: ['MASTER'] }),
  retireMenuItem
);

// A052 / F042: Variation Removal with History Guard
router.delete(
  '/items/:menuItemId/variants/:variantId',
  authorize('MENU_WRITE', { allowedRoles: ['MASTER'] }),
  deleteMenuItemVariant
);

// 3. Recipes & Sub-Recipes
router.get(
  '/recipes',
  authorize('MENU_READ', { allowedRoles: ['MASTER', 'OWNER', 'CAFE_ADMIN'] }),
  listRecipes
);

router.get(
  '/recipes/export-workbook',
  authorize('MENU_READ', { allowedRoles: ['MASTER', 'OWNER', 'CAFE_ADMIN'] }),
  exportRecipeWorkbook
);

router.post(
  '/recipes/import-workbook',
  authorize('MENU_WRITE', { allowedRoles: ['MASTER'] }),
  importRecipeWorkbook
);

router.post(
  '/recipes/ai-suggest',
  authorize('MENU_READ', { allowedRoles: ['MASTER', 'OWNER', 'CAFE_ADMIN'] }),
  aiSuggestRecipe
);

router.get(
  '/recipes/:recipeId',
  authorize('MENU_READ', { allowedRoles: ['MASTER', 'OWNER', 'CAFE_ADMIN'] }),
  getRecipeDetail
);

router.post(
  '/recipes',
  authorize('MENU_WRITE', { allowedRoles: ['MASTER'] }),
  createRecipe
);

router.patch(
  '/recipes/:recipeId',
  authorize('MENU_WRITE', { allowedRoles: ['MASTER'] }),
  updateRecipe
);

// 4. Modifiers & Variant Groups
router.get(
  '/modifier-groups',
  authorize('MENU_READ', { allowedRoles: ['MASTER', 'OWNER', 'CAFE_ADMIN'] }),
  listModifierGroups
);

router.get(
  '/modifiers',
  authorize('MENU_READ', { allowedRoles: ['MASTER', 'OWNER', 'CAFE_ADMIN'] }),
  listModifierGroups
);

router.post(
  '/modifier-groups',
  authorize('MENU_WRITE', { allowedRoles: ['MASTER'] }),
  createModifierGroup
);

router.post(
  '/modifiers',
  authorize('MENU_WRITE', { allowedRoles: ['MASTER'] }),
  createModifierGroup
);

// 5. Combos & Set Menus
router.get(
  '/combos',
  authorize('MENU_READ', { allowedRoles: ['MASTER', 'OWNER', 'CAFE_ADMIN'] }),
  listCombos
);

router.post(
  '/combos',
  authorize('MENU_WRITE', { allowedRoles: ['MASTER'] }),
  createCombo
);

// 6. Menus & Schedules
router.get(
  '/menus',
  authorize('MENU_READ', { allowedRoles: ['MASTER', 'OWNER', 'CAFE_ADMIN'] }),
  listMenus
);

router.post(
  '/menus',
  authorize('MENU_WRITE', { allowedRoles: ['MASTER'] }),
  createMenu
);

// 7. Outlet Offerings & Layered Availability
router.get(
  '/outlets/:outletId/offerings',
  authorize('MENU_READ', { allowedRoles: ['MASTER', 'OWNER', 'CAFE_ADMIN'] }),
  listOutletOfferings
);

router.post(
  '/outlets/:outletId/offerings/:menuItemId/availability',
  authorize('MENU_WRITE', { allowedRoles: ['MASTER', 'CAFE_ADMIN'] }),
  toggleOutletAvailability
);

router.post(
  '/outlets/:outletId/offerings/:menuItemId/price',
  authorize('MENU_WRITE', { allowedRoles: ['MASTER'] }),
  setOutletPriceOverride
);

// 8. Publishing & Change Sets
router.get(
  '/change-sets',
  authorize('MENU_READ', { allowedRoles: ['MASTER', 'OWNER'] }),
  listChangeSets
);

router.get(
  '/changesets',
  authorize('MENU_READ', { allowedRoles: ['MASTER', 'OWNER'] }),
  listChangeSets
);

router.post(
  '/change-sets',
  authorize('MENU_WRITE', { allowedRoles: ['MASTER'] }),
  createChangeSet
);

router.post(
  '/changesets',
  authorize('MENU_WRITE', { allowedRoles: ['MASTER'] }),
  createChangeSet
);

router.post(
  '/change-sets/:changeSetId/publish',
  authorize('MENU_WRITE', { allowedRoles: ['MASTER'] }),
  publishChangeSet
);

router.post(
  '/changesets/:changeSetId/publish',
  authorize('MENU_WRITE', { allowedRoles: ['MASTER'] }),
  publishChangeSet
);

router.post(
  '/publications/:publicationId/rollback',
  authorize('MENU_WRITE', { allowedRoles: ['MASTER'], requirePrimaryMaster: true }),
  rollbackPublication
);

// 9. Simulator
router.get(
  '/simulator',
  authorize('MENU_READ', { allowedRoles: ['MASTER', 'OWNER', 'CAFE_ADMIN'] }),
  simulateEffectiveMenu
);

// 10. Integrity & Analytics
router.get(
  '/integrity',
  authorize('MENU_READ', { allowedRoles: ['MASTER', 'OWNER'] }),
  getMenuIntegrityAudit
);

router.get(
  '/analytics',
  authorize('MENU_READ', { allowedRoles: ['MASTER', 'OWNER'] }),
  getMenuAnalytics
);

// Benchmark A104: Global Recipe Component Substitution Wizard
router.post(
  '/recipes/substitute-ingredient',
  authorize('MENU_WRITE', { allowedRoles: ['MASTER', 'CAFE_ADMIN'] }),
  substituteRecipeIngredientHandler
);

// Benchmark A050: Aggregator Menu Quality-Check Failure Center
router.get(
  '/aggregator-qc-audit',
  authorize('MENU_READ', { allowedRoles: ['MASTER', 'OWNER', 'CAFE_ADMIN'] }),
  aggregatorQcAuditHandler
);

// Benchmark A040: Bulk Add-on to Menu Item Excel Mapper (Export & Import)
router.get(
  '/bulk-modifiers/export',
  authorize('MENU_READ', { allowedRoles: ['MASTER', 'OWNER', 'CAFE_ADMIN'] }),
  exportBulkModifierMappingHandler
);

router.post(
  '/bulk-modifiers/import',
  authorize('MENU_WRITE', { allowedRoles: ['MASTER', 'CAFE_ADMIN'] }),
  importBulkModifierMappingHandler
);

router.post(
  '/addon-mapping/bulk-import',
  authorize('MENU_WRITE', { allowedRoles: ['MASTER', 'CAFE_ADMIN'] }),
  importBulkModifierMappingHandler
);

module.exports = router;
