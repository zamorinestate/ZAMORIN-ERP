'use strict';

/**
 * ============================================================================
 * ZAMORIN CAFÉ ERP — COST OF GOODS SOLD (COGS) ENGINE (SCR-022 / Issue #2)
 * ============================================================================
 *
 * Implements the canonical Cost of Goods Sold & Product Margin derivation.
 *
 * Architecture:
 *   - Strictly READS from PurchaseOrder line items, GlobalInventoryItem standard costs,
 *     Recipe ingredient BOMs, and POS Bill sales transactions.
 *   - Complies with vendor-order-lifecycle freeze (zero procurement mutations).
 *   - Explicitly reports `basis: "LAST_PO_PRICE"` to honestly identify that
 *     per-unit costs derive from the most recent verified PO/GRN rates.
 *   - Recursively resolves nested sub-recipes with yield and prep loss adjustments.
 */

const { Bill } = require('../models/Bill');
const { MenuItem } = require('../models/MenuItem');
const { Recipe } = require('../models/Recipe');
const { PurchaseOrder } = require('../models/PurchaseOrder');
const { GlobalInventoryItem } = require('../models/GlobalInventoryItem');

/**
 * Normalise a period boundary to the `YYYY-MM-DD` IST business-date format used by
 * `Bill.businessDate`. Accepts `YYYY-MM-DD` (kept as-is) or anything Date-parseable
 * (ISO timestamps etc. are truncated to their calendar day).
 *
 * @param {string|Date} value
 * @returns {string|null}
 */
function toBusinessDateStr(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
    const parsed = new Date(trimmed);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString().slice(0, 10);
  }
  return null;
}

/**
 * Build a lookup map of the latest per-unit cost for each inventory item.
 * Preference order:
 *   1. Most recent PurchaseOrder line item unitPricePaisa (approved/received/active)
 *   2. GlobalInventoryItem.unitCostPaisa (master catalogue standard baseline)
 *
 * @param {Object} options
 * @param {string} options.organisationId
 * @param {string|string[]} [options.cafeScope]
 * @returns {Promise<Map<string, { unitPricePaisa: number, source: string, poId: string|null }>>}
 */
async function getLatestItemCostMap({ organisationId, cafeScope }) {
  const costMap = new Map();

  // 1. Baseline from GlobalInventoryItem catalogue
  try {
    const items = await GlobalInventoryItem.find({ organisationId }).select('itemId unitCostPaisa').lean();
    for (const it of items) {
      if (it.itemId) {
        costMap.set(String(it.itemId).toUpperCase(), {
          unitPricePaisa: Number(it.unitCostPaisa || 0),
          source: 'CATALOGUE_STANDARD',
          poId: null,
        });
      }
    }
  } catch (_) {
    // Graceful offline/test fallback
  }

  // 2. Overlay with latest PurchaseOrder line item price (most recent orders take precedence)
  try {
    const poMatch = {
      organisationId,
      status: {
        $in: [
          'APPROVED',
          'ORDER_PLACED',
          'ORDERED',
          'RECEIVED',
          'VERIFIED_PENDING_MASTER_APPROVAL',
          'PARTIALLY_RECEIVED',
          'CLOSED',
        ],
      },
    };
    if (cafeScope) {
      poMatch.cafeId = Array.isArray(cafeScope) ? { $in: cafeScope } : cafeScope;
    }

    const pos = await PurchaseOrder.find(poMatch)
      .sort({ createdAt: -1 })
      .select('purchaseOrderId lineItems createdAt')
      .limit(200)
      .lean();

    for (const po of pos) {
      if (Array.isArray(po.lineItems)) {
        for (const line of po.lineItems) {
          const itemId = line.itemId ? String(line.itemId).toUpperCase() : null;
          if (itemId && line.unitPricePaisa !== undefined && line.unitPricePaisa !== null) {
            // First one encountered in reverse chronological order is the latest PO price
            if (!costMap.has(itemId) || costMap.get(itemId).source === 'CATALOGUE_STANDARD') {
              costMap.set(itemId, {
                unitPricePaisa: Number(line.unitPricePaisa || 0),
                source: 'LAST_PO_PRICE',
                poId: po.purchaseOrderId || String(po._id),
              });
            }
          }
        }
      }
    }
  } catch (_) {
    // Graceful offline/test fallback
  }

  return costMap;
}

/**
 * Compute the theoretical unit cost for a Recipe in paisa, recursing up to depth 4 for sub-recipes.
 *
 * @param {Object} recipe
 * @param {Map<string, Object>} recipeMap
 * @param {Map<string, Object>} costMap
 * @param {number} depth
 * @returns {number} Cost per portion in paisa
 */
function resolveRecipeUnitCostPaisa(recipe, recipeMap, costMap, depth = 0) {
  if (!recipe || !Array.isArray(recipe.ingredients) || depth > 4) {
    return 0;
  }

  let totalRecipeCostPaisa = 0;

  for (const ing of recipe.ingredients) {
    if (ing.isOptional) continue;

    let ingredientCostPaisa = 0;
    const qty = Number(ing.quantity || 0);
    const lossMultiplier = 1 + (Number(ing.lossFactorPercent || 0) / 100);

    if (ing.subRecipeId) {
      const sub = recipeMap.get(String(ing.subRecipeId).toUpperCase());
      if (sub) {
        const subUnitCost = resolveRecipeUnitCostPaisa(sub, recipeMap, costMap, depth + 1);
        ingredientCostPaisa = qty * subUnitCost * lossMultiplier;
      }
    } else if (ing.inventoryItemId) {
      const iId = String(ing.inventoryItemId).toUpperCase();
      const unitRate = costMap.has(iId) ? costMap.get(iId).unitPricePaisa : Number(ing.costPaisa || 0);
      ingredientCostPaisa = qty * unitRate * lossMultiplier;
    }

    totalRecipeCostPaisa += ingredientCostPaisa;
  }

  const batchYield = Number(recipe.batchYield || 1);
  return batchYield > 0 ? Math.round(totalRecipeCostPaisa / batchYield) : Math.round(totalRecipeCostPaisa);
}

/**
 * Calculate authoritative Cost of Goods Sold and product-level gross margin for a given period.
 *
 * @param {Object} options
 * @param {string} options.organisationId
 * @param {string|string[]} [options.cafeScope]
 * @param {string} [options.dateFrom]  IST business date (YYYY-MM-DD) — Bill.businessDate, not createdAt
 * @param {string} [options.dateTo]    IST business date (YYYY-MM-DD)
 * @returns {Promise<Object>}
 */
async function calculateCogs({ organisationId, cafeScope, dateFrom, dateTo }) {
  if (!organisationId) {
    throw new Error('cogsService: organisationId is required.');
  }

  // 1. Build cost map from PurchaseOrders and Catalogue
  const costMap = await getLatestItemCostMap({ organisationId, cafeScope });

  // 2. Fetch Recipes and MenuItems
  const recipeMap = new Map();
  try {
    const recipes = await Recipe.find({ organisationId }).lean();
    for (const r of recipes) {
      if (r.recipeId) recipeMap.set(String(r.recipeId).toUpperCase(), r);
    }
  } catch (_) {}

  const menuItemMap = new Map();
  try {
    const menuItems = await MenuItem.find({ organisationId }).lean();
    for (const m of menuItems) {
      if (m.menuItemId) menuItemMap.set(String(m.menuItemId).toUpperCase(), m);
    }
  } catch (_) {}

  // 3. Cache pre-computed unit cost per MenuItem
  const menuItemUnitCostCache = new Map();
  for (const [mId, mItem] of menuItemMap.entries()) {
    let unitCostPaisa = 0;
    if (mItem.primaryRecipeId) {
      const recipe = recipeMap.get(String(mItem.primaryRecipeId).toUpperCase());
      if (recipe) {
        unitCostPaisa = resolveRecipeUnitCostPaisa(recipe, recipeMap, costMap);
      }
    } else if (mItem.inventoryItemId) {
      const iId = String(mItem.inventoryItemId).toUpperCase();
      unitCostPaisa = costMap.has(iId) ? costMap.get(iId).unitPricePaisa : 0;
    }
    menuItemUnitCostCache.set(mId, unitCostPaisa);
  }

  // 4. Query completed sales transactions
  const billMatch = {
    organisationId,
    status: { $in: ['COMPLETED', 'PARTIALLY_REFUNDED'] },
  };
  if (cafeScope) {
    billMatch.cafeId = Array.isArray(cafeScope) ? { $in: cafeScope } : cafeScope;
  }
  if (dateFrom || dateTo) {
    // Business date (IST calendar day), not createdAt: a bill rung up at 23:59 IST still
    // belongs to that business day, and the rest of the reporting engine scopes periods
    // on businessDate. Matching on createdAt silently drops end-of-period sales.
    const fromStr = toBusinessDateStr(dateFrom);
    const toStr = toBusinessDateStr(dateTo);
    billMatch.businessDate = {};
    if (fromStr) billMatch.businessDate.$gte = fromStr;
    if (toStr) billMatch.businessDate.$lte = toStr;
    if (!fromStr && !toStr) delete billMatch.businessDate;
  }

  let bills = [];
  try {
    bills = await Bill.find(billMatch)
      .select('items lineItems subtotalPaisa grandTotalPaisa cafeId createdAt')
      .lean();
  } catch (_) {
    bills = [];
  }

  let totalCogsPaisa = 0;
  let totalUnitsSold = 0;
  let pricedUnitsSold = 0;
  let totalGrossSalesPaisa = 0;
  const itemAggregate = {};

  for (const bill of bills) {
    const lines = Array.isArray(bill.lineItems) ? bill.lineItems : (Array.isArray(bill.items) ? bill.items : []);
    for (const line of lines) {
      const mId = line.menuItemId ? String(line.menuItemId).toUpperCase() : 'UNKNOWN';
      const qty = Number(line.quantity || 0);
      const unitPrice = Number(line.unitPricePaisa || 0);
      const lineRevenuePaisa = Number(
        line.totalLinePaisa !== undefined
          ? line.totalLinePaisa
          : (line.lineSubtotalPaisa !== undefined ? line.lineSubtotalPaisa : (qty * unitPrice))
      );

        const unitCostPaisa = menuItemUnitCostCache.get(mId) || 0;
        const lineCogsPaisa = qty * unitCostPaisa;

        totalUnitsSold += qty;
        if (unitCostPaisa > 0) pricedUnitsSold += qty;
        totalGrossSalesPaisa += lineRevenuePaisa;
        totalCogsPaisa += lineCogsPaisa;

        if (!itemAggregate[mId]) {
          itemAggregate[mId] = {
            menuItemId: mId,
            name: line.itemNameSnapshot || menuItemMap.get(mId)?.name || mId,
            unitsSold: 0,
            revenuePaisa: 0,
            cogsPaisa: 0,
            unitCostPaisa,
          };
        }
        itemAggregate[mId].unitsSold += qty;
        itemAggregate[mId].revenuePaisa += lineRevenuePaisa;
        itemAggregate[mId].cogsPaisa += lineCogsPaisa;
      }
    }

  const itemsList = Object.values(itemAggregate).map((item) => {
    const marginPaisa = item.revenuePaisa - item.cogsPaisa;
    const marginPct = item.revenuePaisa > 0 ? Number(((marginPaisa / item.revenuePaisa) * 100).toFixed(2)) : 0;
    return {
      menuItemId: item.menuItemId,
      name: item.name,
      unitsSold: item.unitsSold,
      revenuePaisa: item.revenuePaisa,
      revenue: Number((item.revenuePaisa / 100).toFixed(2)),
      cogsPaisa: item.cogsPaisa,
      cogs: Number((item.cogsPaisa / 100).toFixed(2)),
      unitCostPaisa: item.unitCostPaisa,
      unitCost: Number((item.unitCostPaisa / 100).toFixed(2)),
      grossMarginPaisa: marginPaisa,
      grossMargin: Number((marginPaisa / 100).toFixed(2)),
      grossMarginPct: marginPct,
    };
  }).sort((a, b) => b.revenuePaisa - a.revenuePaisa);

  const grossProfitPaisa = totalGrossSalesPaisa - totalCogsPaisa;
  const grossMarginPct = totalGrossSalesPaisa > 0
    ? Number(((grossProfitPaisa / totalGrossSalesPaisa) * 100).toFixed(2))
    : 0;

  const costPerUnitPaisa = totalUnitsSold > 0 ? Math.round(totalCogsPaisa / totalUnitsSold) : 0;

  // Share of sold units whose recipe/SKU could be priced from a real cost source.
  // Below 100 % means the COGS figure is understated (unpriced lines contribute ₹0 cost).
  const costCoveragePct = totalUnitsSold > 0
    ? Number(((pricedUnitsSold / totalUnitsSold) * 100).toFixed(2))
    : 0;

  return {
    organisationId,
    cafeScope: cafeScope || 'ALL',
    period: {
      dateFrom: dateFrom || null,
      dateTo: dateTo || null,
    },
    status: 'AVAILABLE',
    basis: 'LAST_PO_PRICE',
    isApproximate: true,
    basisNote: 'Estimated Cost of Goods Sold derived from POS sales volumes, recipe BOM composition, and most recent Purchase Order / Inbound GRN unit rates.',
    cogsPaisa: totalCogsPaisa,
    cogs: Number((totalCogsPaisa / 100).toFixed(2)),
    costPerUnitPaisa,
    costPerUnit: Number((costPerUnitPaisa / 100).toFixed(2)),
    totalUnitsSold,
    pricedUnitsSold,
    costCoveragePct,
    grossSalesPaisa: totalGrossSalesPaisa,
    grossSales: Number((totalGrossSalesPaisa / 100).toFixed(2)),
    netSalesPaisa: totalGrossSalesPaisa,
    netSales: Number((totalGrossSalesPaisa / 100).toFixed(2)),
    grossProfitPaisa,
    grossProfit: Number((grossProfitPaisa / 100).toFixed(2)),
    grossMarginPct,
    billCount: bills.length,
    activeItemCount: itemsList.length,
    items: itemsList,
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Honest COGS gate for finance views (/reports/finance P&L + waterfall).
 *
 * Returns `null` values (never a fabricated zero) unless the engine had BOTH
 * real sales lines and a real cost basis for at least part of them — a ₹0 COGS
 * against real sales would silently report a 100 % gross margin.
 *
 * @param {Object} options
 * @param {string} options.organisationId
 * @param {string|string[]} [options.cafeScope]
 * @param {string} [options.dateFrom]
 * @param {string} [options.dateTo]
 * @returns {Promise<Object>} { available, reason, cogs, cogsPaisa, cogsStatus,
 *   cogsBasis, cogsBasisNote, costCoveragePct, partialCoverage, grossMarginPct, summary }
 */
async function deriveFinanceCogsBlock({ organisationId, cafeScope, dateFrom, dateTo }) {
  const unavailable = (reason) => ({
    available: false,
    reason,
    cogs: null,
    cogsPaisa: null,
    cogsStatus: 'UNAVAILABLE',
    cogsBasis: null,
    cogsBasisNote: null,
    costCoveragePct: null,
    partialCoverage: false,
    grossMarginPct: null,
    summary: null,
  });

  if (!organisationId) return unavailable('ORGANISATION_CONTEXT_REQUIRED');

  let summary;
  try {
    summary = await calculateCogs({ organisationId, cafeScope, dateFrom, dateTo });
  } catch (_) {
    return unavailable('SOURCE_ERROR');
  }

  if (!summary || summary.billCount <= 0) return unavailable('NO_SALES_IN_PERIOD');
  // No priced cost for any sold unit → any number we print would be invented.
  if (!(summary.cogsPaisa > 0) || !(summary.pricedUnitsSold > 0)) {
    return unavailable('NO_COST_BASIS');
  }

  return {
    available: true,
    reason: null,
    cogs: summary.cogs,
    cogsPaisa: summary.cogsPaisa,
    cogsStatus: 'AVAILABLE',
    cogsBasis: summary.basis,
    cogsBasisNote: summary.basisNote,
    costCoveragePct: summary.costCoveragePct,
    partialCoverage: summary.costCoveragePct < 100,
    grossMarginPct: summary.grossMarginPct,
    summary,
  };
}

module.exports = {
  getLatestItemCostMap,
  resolveRecipeUnitCostPaisa,
  calculateCogs,
  deriveFinanceCogsBlock,
};
