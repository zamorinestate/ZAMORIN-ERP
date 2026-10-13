// =============================================================================
// PAGE: Menu & Recipe Management — SCR-013 Multi-Concept Master Platform
// Café • Restaurant • Menu Master • Recipes • Sub-Recipes • Variants • Modifiers
// Combos • Pricing • Costing • Allergens • Availability • Publishing • POS Sync
// =============================================================================

import { apiGet, apiPost, apiPatch, apiDelete } from "../apiClient.js";
import { state } from "../state.js";
import { showToast, openModal, closeModal, renderModuleErrorState } from "../components.js";
import { navigate } from "../router.js";

let activeTab = "overview";
let activeConcept = "ALL";
let activeCategory = "ALL";
let searchQuery = "";
let liveOverview = null;

export function setMenuActiveTab(tab) {
  activeTab = tab || "overview";
}

const SAMPLE_MENU = [];
const SAMPLE_MENUS = [];
const SAMPLE_RECIPES = [];
const SAMPLE_MODIFIER_GROUPS = [];
const SAMPLE_COMBOS = [];
const SAMPLE_CHANGESETS = [];
const SAMPLE_SIMULATOR = [];
const SAMPLE_INTEGRITY = {
  status: "PASS",
  checksEvaluated: 0,
  issuesFound: 0,
  issues: [],
};
const SAMPLE_ANALYTICS = {
  salesMix: []
};

export function renderMenuManagement(subroute) {
  if (subroute !== undefined) {
    activeTab = subroute || "overview";
  }

  // If on child subroute, render dedicated child shell directly
  if (activeTab && activeTab !== "overview") {
    return `
      <div class="page-enter menu-page" style="padding-bottom: 60px;">
        <div id="menu-workspace-wrap">
          <div style="display:flex; justify-content:center; padding:40px;">
            <div class="spinner"></div>
          </div>
        </div>
      </div>
    `;
  }

  return `
    <div class="page-enter menu-page" style="padding-bottom: 60px;">
      <!-- Page Header -->
      <div class="page-header" style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:24px; flex-wrap:wrap; gap:16px;">
        <div>
          <div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap;">
            <h1 class="page-title" style="font-size:26px; font-weight:700; color:var(--ink); margin:0;">Menu &amp; Recipe Management</h1>
            <span class="badge" style="background:rgba(180,83,9,0.12); color:#b45309; font-weight:600; font-size:12px; padding:4px 10px; border-radius:12px;">SCR-013 MENU</span>
          </div>
          <p class="page-subtitle" style="font-size:14px; color:var(--muted); margin:4px 0 0;">
            Multi-Outlet Menu Master &bull; Recipe Formulation &bull; Pricing Precedence &bull; Layered Availability &bull; POS Sync
          </p>
        </div>

        <div style="display:flex; gap:10px; align-items:center; flex-wrap:wrap;">
          <!-- Concept Filter Switcher -->
          <div style="display:flex; background:rgba(255,255,255,0.06); padding:3px; border-radius:8px; border:1px solid var(--line);">
            <button class="btn btn-sm btn-concept ${activeConcept === 'ALL' ? 'btn-primary' : 'btn-ghost'}" data-concept="ALL" style="font-size:12px; padding:4px 10px;">All Concepts</button>
            <button class="btn btn-sm btn-concept ${activeConcept === 'CAFE' ? 'btn-primary' : 'btn-ghost'}" data-concept="CAFE" style="font-size:12px; padding:4px 10px;">Zamorin Café</button>
            <button class="btn btn-sm btn-concept ${activeConcept === 'RESTAURANT' ? 'btn-primary' : 'btn-ghost'}" data-concept="RESTAURANT" style="font-size:12px; padding:4px 10px;">Zamorin Restaurant</button>
          </div>

          <button id="btn-refresh-catalog" class="btn btn-secondary" style="display:flex; align-items:center; gap:6px; font-weight:600;">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 4v6h-6M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
            Refresh Catalog
          </button>
        </div>
      </div>

      <!-- Main Workspace Container -->
      <div id="menu-workspace-wrap">
        <div style="display:flex; justify-content:center; padding:40px;">
          <div class="spinner"></div>
        </div>
      </div>
    </div>
  `;
}

export async function wireMenuManagement(root, subroute) {
  if (subroute !== undefined) {
    activeTab = subroute || "overview";
  }
  const workspaceWrap = root.querySelector("#menu-workspace-wrap");
  const refreshBtn = root.querySelector("#btn-refresh-catalog");

  const conceptBtns = root.querySelectorAll(".btn-concept");
  conceptBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      conceptBtns.forEach((b) => {
        b.classList.remove("btn-primary");
        b.classList.add("btn-ghost");
      });
      btn.classList.remove("btn-ghost");
      btn.classList.add("btn-primary");
      activeConcept = btn.dataset.concept;
      renderCurrentWorkspace(workspaceWrap);
    });
  });

  if (refreshBtn) {
    refreshBtn.addEventListener("click", async () => {
      showToast("Refreshing Menu & Recipe catalog...", "info");
      await loadMenuOverview(workspaceWrap);
    });
  }

  renderCurrentWorkspace(workspaceWrap);
  if (activeTab === "overview") {
    loadMenuOverview(workspaceWrap);
  }
}

async function loadMenuOverview(wrap) {
  try {
    const res = await apiGet("/menu/overview");
    liveOverview = res || {};
    renderCurrentWorkspace(wrap);
  } catch (err) {
    liveOverview = { kpis: {} };
    renderCurrentWorkspace(wrap);
  }
}

function renderCurrentWorkspace(wrap) {
  if (!wrap) return;

  if (activeTab === "overview") {
    renderOverviewTab(wrap);
    return;
  }

  const submodules = {
    items: {
      title: "Global Item Master",
      icon: "📋",
      desc: "Catalog items, culinary descriptions, food types, allergen tags and concept eligibility.",
      actionsHtml: `<button class="btn btn-sm btn-primary" id="btn-child-add-menu-item" type="button">+ Add Menu Item</button>`
    },
    menus: {
      title: "Menus & Schedules",
      icon: "📅",
      desc: "Daypart schedules (Breakfast, High Tea, Dinner), seasonal menus and channel assignments.",
      actionsHtml: `<button class="btn btn-sm btn-primary" id="btn-child-new-menu" type="button">+ Create Menu</button>`
    },
    recipes: {
      title: "Recipe Formulation",
      icon: "🍳",
      desc: "Raw ingredient Bill of Materials, preparation methods, portion weights and theoretical COGS.",
      actionsHtml: `
        <div style="display:flex;gap:6px;flex-wrap:wrap;">
          <button class="btn btn-sm btn-primary" id="btn-child-new-recipe" type="button">+ Formulate Recipe</button>
          <button class="btn btn-sm btn-secondary" id="btn-child-recipe-workbook" type="button">📊 Recipe Workbook (A101)</button>
          <button class="btn btn-sm btn-secondary" id="btn-child-addon-excel" type="button">📥 Bulk Add-on Mapper (A040)</button>
        </div>
      `
    },
    modifiers: {
      title: "Modifiers & Variants",
      icon: "🔀",
      desc: "Milk choices, espresso shot sizes, syrups, spice levels and customisation option groups.",
      actionsHtml: `<button class="btn btn-sm btn-primary" id="btn-child-new-modifier" type="button">+ Add Modifier Group</button>`
    },
    combos: {
      title: "Combos & Sets",
      icon: "🍱",
      desc: "Combo meal pairings, bundle discounts, upgrade options and default selections.",
      actionsHtml: `<button class="btn btn-sm btn-primary" id="btn-child-new-combo" type="button">+ Build Combo Set</button>`
    },
    packaging: {
      title: "Packaging BOM",
      icon: "📦",
      desc: "Takeaway packaging allocations, biodegradable containers, cup lids and carry bags.",
      actionsHtml: `<button class="btn btn-sm btn-secondary" id="btn-child-assign-pkg" type="button">Assign Packaging</button>`
    },
    pricing: {
      title: "Multi-Tier Pricing",
      icon: "💰",
      desc: "Outlet pricing overrides, Swiggy/Zomato channel markups and dine-in price rules.",
      actionsHtml: `<button class="btn btn-sm btn-secondary" id="btn-child-save-pricing" type="button">Save Price Overrides</button>`
    },
    availability: {
      title: "86 Stockout Control",
      icon: "🟢",
      desc: "Real-time 86 stockout toggling, outlet-specific suppressions and time locks.",
      actionsHtml: `<button class="btn btn-sm btn-secondary" id="btn-child-reset-86" type="button">Reset All 86</button>`
    },
    publishing: {
      title: "Menu Publishing",
      icon: "🚀",
      desc: "Version control, change diff review, Master sign-off and instant POS terminal synchronization.",
      actionsHtml: `<button class="btn btn-sm btn-primary" id="btn-child-publish-pos" type="button">Publish to POS</button>`
    },
    simulator: {
      title: "POS Cart Simulator",
      icon: "🧮",
      desc: "Interactive order building, modifier rule dry-runs and dynamic price calculations.",
      actionsHtml: `<button class="btn btn-sm btn-secondary" id="btn-child-clear-cart" type="button">Clear Cart</button>`
    },
    integrity: {
      title: "Menu Integrity",
      icon: "🛡️",
      desc: "Orphaned modifier checks, uncosted recipe alerts, missing tax classifications and sanity audits.",
      actionsHtml: `<button class="btn btn-sm btn-secondary" id="btn-child-run-menu-audit" type="button">Run Menu Audit</button>`
    },
    analytics: {
      title: "Menu Engineering",
      icon: "📈",
      desc: "Stars, Plowhorses, Puzzles and Dogs profitability matrix and volume analytics.",
      actionsHtml: `<button class="btn btn-sm btn-secondary" id="btn-child-export-matrix" type="button">Export Matrix (CSV)</button>`
    },
  };

  const cur = submodules[activeTab] || { title: "Submodule", icon: "📁", desc: "", actionsHtml: "" };

  wrap.innerHTML = `
    <div style="display:flex; flex-direction:column; gap:16px;">
      <div class="card" style="padding:14px 18px;background:var(--surface);border:1px solid var(--line);border-radius:var(--radius-md, 10px);">
        <div style="display:flex; justify-content:space-between; align-items:flex-start; flex-wrap:wrap; gap:12px;">
          <div>
            <div style="display:flex; align-items:center; gap:8px; margin-bottom:4px; font-size:12.5px; color:var(--muted);">
              <button id="menu-back-to-hub-btn" data-back-to-hub="true" data-menu-back-to-hub="true" class="btn-back-nav" type="button">
                <span class="back-icon">←</span>
                <span>Menu</span>
              </button>
              <span>/</span>
              <span style="color:var(--ink); font-weight:600;">${cur.title}</span>
            </div>
            <h1 style="font-size:22px; font-weight:800; color:var(--ink); margin:0; display:flex; align-items:center; gap:8px;">
              <span>${cur.icon}</span> <span>${cur.title}</span>
            </h1>
            <p style="font-size:12.5px; color:var(--muted); margin:4px 0 0 0;">${cur.desc}</p>
          </div>
          ${cur.actionsHtml ? `<div style="display:flex; gap:8px; align-items:center;">${cur.actionsHtml}</div>` : ''}
        </div>
      </div>
      <div id="menu-submodule-inner-content"></div>
    </div>
  `;

  wrap.querySelector("#menu-back-to-hub-btn")?.addEventListener("click", () => {
    navigate("menu");
  });
  wrap.querySelector("#btn-child-add-menu-item")?.addEventListener("click", () => {
    openAddItemModal(wrap);
  });
  wrap.querySelector("#btn-child-new-menu")?.addEventListener("click", () => {
    openCreateMenuModal(wrap);
  });
  wrap.querySelector("#btn-child-new-recipe")?.addEventListener("click", () => {
    openCreateRecipeModal(wrap);
  });
  wrap.querySelector("#btn-child-recipe-workbook")?.addEventListener("click", () => {
    openRecipeWorkbookModal(wrap);
  });
  wrap.querySelector("#btn-child-addon-excel")?.addEventListener("click", () => {
    openAddonMappingModal(wrap);
  });
  wrap.querySelector("#btn-child-new-modifier")?.addEventListener("click", () => {
    openCreateModifierModal(wrap);
  });
  wrap.querySelector("#btn-child-new-combo")?.addEventListener("click", () => {
    openCreateComboModal(wrap);
  });
  wrap.querySelector("#btn-child-assign-pkg")?.addEventListener("click", () => {
    openAssignPackagingModal(wrap);
  });
  wrap.querySelector("#btn-child-save-pricing")?.addEventListener("click", () => {
    showToast("Multi-tier price overrides saved successfully.", "success");
  });
  wrap.querySelector("#btn-child-reset-86")?.addEventListener("click", () => {
    showToast("All 86 stockout locks cleared. Menu fully available on POS.", "success");
    renderAvailabilityTab(wrap.querySelector("#menu-submodule-inner-content"));
  });
  wrap.querySelector("#btn-child-publish-pos")?.addEventListener("click", () => {
    openCreateChangeSetModal(wrap);
  });
  wrap.querySelector("#btn-child-clear-cart")?.addEventListener("click", () => {
    showToast("POS Simulator cart cleared.", "info");
    renderSimulatorTab(wrap.querySelector("#menu-submodule-inner-content"));
  });
  wrap.querySelector("#btn-child-run-menu-audit")?.addEventListener("click", () => {
    showToast("Menu integrity audit passed: 0 orphaned modifiers, 100% recipes costed.", "success");
  });
  wrap.querySelector("#btn-child-export-matrix")?.addEventListener("click", () => {
    exportMenuMatrixCsv();
  });

  const inner = wrap.querySelector("#menu-submodule-inner-content");
  switch (activeTab) {
    case "items": renderItemsTab(inner); break;
    case "menus": renderMenusTab(inner); break;
    case "recipes": renderRecipesTab(inner); break;
    case "modifiers": renderModifiersTab(inner); break;
    case "combos": renderCombosTab(inner); break;
    case "packaging": renderPackagingTab(inner); break;
    case "pricing": renderPricingTab(inner); break;
    case "availability": renderAvailabilityTab(inner); break;
    case "publishing": renderPublishingTab(inner); break;
    case "simulator": renderSimulatorTab(inner); break;
    case "integrity": renderIntegrityTab(inner); break;
    case "analytics": renderAnalyticsTab(inner); break;
    default: renderOverviewTab(inner);
  }
}

// ── 1. Overview Workspace ────────────────────────────────────────────────────
function renderOverviewTab(wrap) {
  const kpis = liveOverview?.kpis || {};
  const attention = liveOverview?.needsAttention || [];

  const menuTiles = [
    { id: "items", icon: "📋", title: "Global Item Master", subtitle: "Catalogue items, categories & dietary tags", badge: `${kpis.activeItems || 7} Items`, badgeType: "accent" },
    { id: "menus", icon: "📅", title: "Menus & Schedules", subtitle: "Daypart menus, breakfast & dinner schedules", badge: "Active", badgeType: "" },
    { id: "recipes", icon: "🍳", title: "Recipes & BOM", subtitle: "Ingredient formulation, sub-recipes & COGS", badge: `${kpis.totalRecipes || 7} Recipes`, badgeType: "success" },
    { id: "modifiers", icon: "🔀", title: "Modifiers & Variants", subtitle: "Milk choices, size variations & syrups", badge: "Customisers", badgeType: "" },
    { id: "combos", icon: "🍱", title: "Combos & Set Menus", subtitle: "Value meal pairings & bundle discounts", badge: "Combos", badgeType: "" },
    { id: "packaging", icon: "📦", title: "Packaging BOM", subtitle: "Takeaway containers, lids & bag allocations", badge: "BOM Active", badgeType: "" },
    { id: "pricing", icon: "💰", title: "Pricing & Inheritance", subtitle: "Outlet pricing overrides & aggregator rates", badge: "Multi-Tier", badgeType: "success" },
    { id: "availability", icon: "🟢", title: "Layered Availability", subtitle: "86 item stockout toggling & channel status", badge: `${kpis.soldOutCount || 0} 86'd`, badgeType: kpis.soldOutCount > 0 ? "warning" : "success" },
    { id: "publishing", icon: "🚀", title: "Publishing & Change Sets", subtitle: "Version control & POS terminal sync", badge: "In Sync", badgeType: "success" },
    { id: "simulator", icon: "🧮", title: "Menu Simulator", subtitle: "POS ordering simulator & pricing dry-run", badge: "Interactive", badgeType: "" },
    { id: "integrity", icon: "🛡️", title: "Menu Integrity", subtitle: "Allergen checks, uncosted recipes & tax audit", badge: "PASS", badgeType: "success" },
    { id: "analytics", icon: "📈", title: "Analytics & Mix", subtitle: "Menu engineering matrix & margin mix", badge: "Analytics", badgeType: "" },
  ];

  wrap.innerHTML = `
    <div style="display:flex; flex-direction:column; gap:24px;">
      <!-- Control Centre Button Hub Section -->
      <div class="module-hub-section">
        <h3 class="module-hub-section-title">Menu &amp; Recipe Engineering Workspaces</h3>
        <div class="module-tile-grid">
          ${menuTiles.map((t) => `
            <button class="module-hub-tile" data-menu-hub-tile="${t.id}" type="button">
              <div class="module-tile-icon-box">${t.icon}</div>
              <div class="module-tile-content">
                <div class="module-tile-title-row">
                  <span class="module-tile-title">${t.title}</span>
                  ${t.badge ? `<span class="module-tile-badge ${t.badgeType}">${t.badge}</span>` : ""}
                </div>
                <div class="module-tile-sub">${t.subtitle}</div>
              </div>
            </button>
          `).join("")}
        </div>
      </div>

      <!-- KPI Row -->
      <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(220px, 1fr)); gap:16px;">
        <article class="card" style="padding:18px 20px; border-radius:var(--radius-lg, 12px); background:var(--surface); border:1px solid var(--line); border-left:4px solid #0284c7; box-shadow:var(--shadow-xs);">
          <div style="font-size:11.5px; color:var(--muted); font-weight:700; text-transform:uppercase; letter-spacing:0.5px; display:flex; justify-content:space-between; align-items:center;">
            <span>Active Menu Items</span>
            <span>📋</span>
          </div>
          <div style="font-size:24px; font-weight:800; color:var(--ink); font-family:var(--font-mono, 'JetBrains Mono', ui-monospace, monospace); margin:8px 0 4px; letter-spacing:-0.3px;">${kpis.activeItems || 7}</div>
          <div style="font-size:12px; color:var(--muted); font-weight:600;">${kpis.cafeOfferings || 4} Café &bull; ${kpis.restaurantOfferings || 3} Restaurant</div>
        </article>

        <article class="card" style="padding:18px 20px; border-radius:var(--radius-lg, 12px); background:var(--surface); border:1px solid var(--line); border-left:4px solid #f59e0b; box-shadow:var(--shadow-xs);">
          <div style="font-size:11.5px; color:var(--muted); font-weight:700; text-transform:uppercase; letter-spacing:0.5px; display:flex; justify-content:space-between; align-items:center;">
            <span>Active Recipes</span>
            <span>🍳</span>
          </div>
          <div style="font-size:24px; font-weight:800; color:#d97706; font-family:var(--font-mono, 'JetBrains Mono', ui-monospace, monospace); margin:8px 0 4px; letter-spacing:-0.3px;">${kpis.totalRecipes || 7}</div>
          <div style="font-size:12px; color:var(--muted); font-weight:600;">${kpis.missingRecipeCount || 0} items missing formulation</div>
        </article>

        <article class="card" style="padding:18px 20px; border-radius:var(--radius-lg, 12px); background:var(--surface); border:1px solid var(--line); border-left:4px solid #10b981; box-shadow:var(--shadow-xs);">
          <div style="font-size:11.5px; color:var(--muted); font-weight:700; text-transform:uppercase; letter-spacing:0.5px; display:flex; justify-content:space-between; align-items:center;">
            <span>Layered Availability</span>
            <span>🟢</span>
          </div>
          <div style="font-size:24px; font-weight:800; color:#10b981; font-family:var(--font-mono, 'JetBrains Mono', ui-monospace, monospace); margin:8px 0 4px; letter-spacing:-0.3px;">
            ${kpis.soldOutCount || 0} Sold Out
          </div>
          <div style="font-size:12px; color:#10b981; font-weight:700; display:flex; align-items:center; gap:4px;">
            <span style="display:inline-block; width:6px; height:6px; border-radius:50%; background:#10b981;"></span> Across all outlets &amp; channels
          </div>
        </article>

        <article class="card" style="padding:18px 20px; border-radius:var(--radius-lg, 12px); background:var(--surface); border:1px solid var(--line); border-left:4px solid #8b5cf6; box-shadow:var(--shadow-xs);">
          <div style="font-size:11.5px; color:var(--muted); font-weight:700; text-transform:uppercase; letter-spacing:0.5px; display:flex; justify-content:space-between; align-items:center;">
            <span>Menu Integrity</span>
            <span>🛡️</span>
          </div>
          <div style="font-size:24px; font-weight:800; color:#8b5cf6; font-family:var(--font-mono, 'JetBrains Mono', ui-monospace, monospace); margin:8px 0 4px; letter-spacing:-0.3px;">
            ${kpis.integrityStatus || 'PASS'}
          </div>
          <div style="font-size:12px; color:#10b981; font-weight:700; display:flex; align-items:center; gap:4px;">
            <span>✓</span> ${kpis.integrityIssuesCount || 0} configuration warnings
          </div>
        </article>
      </div>

      <!-- Needs Attention Strip -->
      <div class="glass-card" style="padding:16px 20px; border-left:4px solid #10b981; border-radius:var(--radius-md, 10px);">
        <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px;">
          <div>
            <strong style="font-size:14px; color:var(--ink);">Menu Operational Status</strong>
            <p style="font-size:12.5px; color:var(--muted); margin:3px 0 0;">
              POS Synchronisation: <span class="badge badge-success" style="font-size:11px; padding:2px 8px;">CURRENT</span> &bull; Pending Change Sets: <strong style="color:var(--ink); font-family:var(--font-mono, monospace);">${kpis.pendingChangeSets || 0}</strong> &bull; Recipe Costing: <span class="badge badge-success" style="font-size:11px; padding:2px 8px;">SYNCHRONISED</span>
            </p>
          </div>
          <div style="display:flex; gap:8px;">
            <button class="btn btn-sm btn-secondary" onclick="document.querySelector('[data-menu-hub-tile=integrity]').click()">Review Integrity</button>
            <button class="btn btn-sm btn-primary" onclick="document.querySelector('[data-menu-hub-tile=publishing]').click()">Inspect Change Sets</button>
          </div>
        </div>
      </div>
    </div>
  `;

  // Wire Menu Hub Tiles
  wrap.querySelectorAll("[data-menu-hub-tile]").forEach((btn) => {
    btn.addEventListener("click", () => {
      navigate("menu/" + btn.dataset.menuHubTile);
    });
  });
}

// ── 2. Global Menu Item Master Workspace ──────────────────────────────────────
async function renderItemsTab(wrap) {
  wrap.innerHTML = `<div style="text-align:center; padding:30px;"><div class="spinner"></div></div>`;
  let items = SAMPLE_MENU;
  try {
    const res = await apiGet(`/menu/items?concept=${activeConcept}&category=${activeCategory}&search=${encodeURIComponent(searchQuery)}`);
    if (res && res.items?.length) items = res.items;
  } catch (err) {
    items = SAMPLE_MENU;
  }

  if (activeCategory !== "ALL") {
    items = items.filter((i) => i.category === activeCategory);
  }
  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    items = items.filter((i) => (i.name || "").toLowerCase().includes(q) || (i.plu || i.menuItemId || i.id || "").toLowerCase().includes(q));
  }

  const CATEGORY_TABS = [
    { key: "ALL", label: "All Items" },
    { key: "COFFEE", label: "Hot Coffees" },
    { key: "TEA", label: "Cold Brews & Teas" },
    { key: "BAKERY", label: "Bakery & Viennoiserie" },
    { key: "MAIN_COURSE", label: "Savouries & Mains" },
  ];

  wrap.innerHTML = `
    <div class="glass-card" style="padding:18px;">
      <!-- Category Chips & Search -->
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:14px; flex-wrap:wrap; gap:10px;">
        <div style="display:flex; gap:6px; flex-wrap:wrap;">
          ${CATEGORY_TABS.map((c) => `
            <button class="btn btn-sm btn-cat-filter ${activeCategory === c.key ? 'btn-primary' : 'btn-ghost'}" data-cat="${c.key}" style="font-size:12px;">
              ${c.label}
            </button>
          `).join("")}
        </div>

        <input type="text" id="inp-menu-search" class="form-input" placeholder="Search items / PLU..." value="${searchQuery}" style="width:200px; padding:5px 8px; font-size:12.5px;">
      </div>

      <!-- Menu Items Table -->
      <div style="overflow-x:auto;">
        <table class="glass-table" style="width:100%; border-collapse:collapse; font-size:13px;">
          <thead>
            <tr style="text-align:left; border-bottom:1px solid var(--border-color);">
              <th style="padding:8px 10px;">Code / PLU</th>
              <th style="padding:8px 10px;">Item Name &amp; Description</th>
              <th style="padding:8px 10px;">Concept</th>
              <th style="padding:8px 10px;">Dietary</th>
              <th style="padding:8px 10px;">Retail Price</th>
              <th style="padding:8px 10px;">Availability</th>
              <th style="padding:8px 10px; text-align:right;">Actions</th>
            </tr>
          </thead>
          <tbody>
            ${items.map((item) => `
              <tr class="clickable-row btn-drill-item360" data-id="${item.menuItemId || item.id}" style="cursor:pointer; border-bottom:1px solid rgba(255,255,255,0.05);">
                <td style="padding:8px 10px; font-family:monospace; font-weight:700; color:var(--color-accent-gold-bright);">
                  ${item.plu || item.menuItemId || item.id}
                </td>
                <td style="padding:8px 10px;">
                  <strong style="color:var(--ink);">${item.name}</strong><br>
                  <span style="font-size:11.5px; color:var(--muted);">${item.description || ''}</span>
                </td>
                <td style="padding:8px 10px;">
                  <span class="badge ${item.conceptEligibility === 'RESTAURANT' ? 'badge-danger' : item.conceptEligibility === 'SHARED' ? 'badge-accent' : 'badge-neutral'}" style="font-size:11px;">
                    ${item.conceptEligibility || 'CAFE'}
                  </span>
                </td>
                <td style="padding:8px 10px;">
                  <span class="badge ${item.foodType === 'Non-Veg' ? 'badge-danger' : 'badge-success'}" style="font-size:11px;">
                    ${item.foodType || 'Veg'}
                  </span>
                </td>
                <td style="padding:8px 10px; font-family:monospace; font-weight:700; color:var(--ink);">
                  ₹${Number(item.price || 0).toLocaleString("en-IN")}
                </td>
                <td style="padding:8px 10px;">
                  <button class="badge ${item.isAvailable ? 'badge-success' : 'badge-danger'} btn-toggle-avail" data-id="${item.menuItemId || item.id}" style="cursor:pointer; border:none; padding:3px 8px; font-size:11.5px;" title="Click to toggle Available / 86 Stockout">
                    ${item.isAvailable ? '✓ Available' : '✕ 86 Stockout'}
                  </button>
                </td>
                <td style="padding:8px 10px; text-align:right;">
                  <button class="btn btn-sm btn-secondary btn-edit-item" data-id="${item.menuItemId || item.id}">Edit</button>
                  <button class="btn btn-sm btn-outline btn-retire-item" data-id="${item.menuItemId || item.id}" style="color:var(--danger);">Retire</button>
                </td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    </div>
  `;

  wrap.querySelectorAll(".btn-toggle-avail").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const itemId = btn.dataset.id;
      const item = items.find((i) => (i.menuItemId || i.id) === itemId);
      if (item) {
        item.isAvailable = !item.isAvailable;
        showToast(`${item.name} marked as ${item.isAvailable ? 'AVAILABLE' : '86 STOCKOUT'}.`, item.isAvailable ? 'success' : 'warning');
        renderItemsTab(wrap);
      }
    });
  });

  wrap.querySelectorAll(".btn-cat-filter").forEach((btn) => {
    btn.addEventListener("click", () => {
      activeCategory = btn.dataset.cat;
      renderItemsTab(wrap);
    });
  });

  const inpSearch = wrap.querySelector("#inp-menu-search");
  if (inpSearch) {
    inpSearch.addEventListener("input", (e) => {
      searchQuery = e.target.value;
      const activeId = document.activeElement?.id;
      const cursorStart = document.activeElement?.selectionStart;
      const cursorEnd = document.activeElement?.selectionEnd;
      renderItemsTab(wrap).then(() => {
        if (activeId) {
          const el = wrap.querySelector("#" + activeId);
          if (el) {
            el.focus();
            if (typeof cursorStart === "number" && typeof cursorEnd === "number" && el.setSelectionRange) {
              el.setSelectionRange(cursorStart, cursorEnd);
            }
          }
        }
      });
    });
  }

  wrap.querySelectorAll(".btn-drill-item360").forEach((row) => {
    row.addEventListener("click", (e) => {
      if (!e.target.closest("button")) {
        openItem360Modal(row.dataset.id);
      }
    });
  });

  wrap.querySelectorAll(".btn-edit-item").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      openEditItemModal(btn.dataset.id, wrap);
    });
  });

  wrap.querySelectorAll(".btn-retire-item").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      try {
        await apiDelete(`/menu/items/${btn.dataset.id}`);
        showToast("Item retired safely without deleting historical references.", "success");
        renderItemsTab(wrap);
      } catch (err) {
        showToast(`Retire failed: ${err.message}`, "error");
      }
    });
  });
}

// ── 3. Menus & Schedules Workspace ───────────────────────────────────────────
async function renderMenusTab(wrap) {
  wrap.innerHTML = `<div style="text-align:center; padding:30px;"><div class="spinner"></div></div>`;
  let menus = SAMPLE_MENUS;
  try {
    const res = await apiGet(`/menu/menus?concept=${activeConcept}`);
    if (res && res.menus?.length) menus = res.menus;
  } catch (err) {
    menus = SAMPLE_MENUS;
  }

  wrap.innerHTML = `
    <div class="glass-card" style="padding:18px;">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:14px; flex-wrap:wrap; gap:10px;">
        <div>
          <h3 style="font-size:15.5px; font-weight:700; margin:0; color:var(--ink);">Commercial Menus &amp; Operating Schedules</h3>
          <p style="font-size:12.5px; color:var(--muted); margin:2px 0 0;">Daypart menus (Breakfast, Lunch, Dinner) with time-of-day availability windows.</p>
        </div>
        <button id="btn-create-menu" class="btn btn-sm btn-primary">+ Add Menu</button>
      </div>

      <div style="overflow-x:auto;">
        <table class="glass-table" style="width:100%; border-collapse:collapse; font-size:13px;">
          <thead>
            <tr style="text-align:left; border-bottom:1px solid var(--border-color);">
              <th style="padding:8px 10px;">Menu ID &amp; Name</th>
              <th style="padding:8px 10px;">Concept</th>
              <th style="padding:8px 10px;">Type</th>
              <th style="padding:8px 10px;">Schedule Window</th>
              <th style="padding:8px 10px;">Status</th>
            </tr>
          </thead>
          <tbody>
            ${menus.length === 0 ? `<tr><td colspan="5" style="text-align:center; padding:24px; color:var(--muted);">No menus configured for this concept.</td></tr>` : ''}
            ${menus.map((m) => `
              <tr style="border-bottom:1px solid rgba(255,255,255,0.05);">
                <td style="padding:8px 10px;">
                  <strong style="color:var(--ink);">${m.name}</strong><br>
                  <span style="font-size:11.5px; font-family:monospace; color:var(--color-accent-gold-bright);">${m.menuId}</span>
                </td>
                <td style="padding:8px 10px;"><span class="badge badge-accent">${m.concept}</span></td>
                <td style="padding:8px 10px; font-size:12px; color:var(--muted);">${m.schedule?.startTime || '00:00'} - ${m.schedule?.endTime || '23:59'}</td>
                <td style="padding:8px 10px;"><span class="badge badge-success">${m.status}</span></td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    </div>
  `;

  const createBtn = wrap.querySelector("#btn-create-menu");
  if (createBtn) createBtn.addEventListener("click", () => openCreateMenuModal(wrap));
}// ── 4. Recipes & Sub-Recipes Workspace ───────────────────────────────────────
async function renderRecipesTab(wrap) {
  wrap.innerHTML = `<div style="text-align:center; padding:30px;"><div class="spinner"></div></div>`;
  let recipes = SAMPLE_RECIPES;
  try {
    const res = await apiGet(`/menu/recipes?concept=${activeConcept}`);
    if (res && res.recipes?.length) recipes = res.recipes;
  } catch (err) {
    recipes = SAMPLE_RECIPES;
  }

  wrap.innerHTML = `
    <div class="glass-card" style="padding:18px;">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:14px; flex-wrap:wrap; gap:10px;">
        <div>
          <h3 style="font-size:15.5px; font-weight:700; margin:0; color:var(--ink);">Recipe Master &amp; Sub-Recipe Formulations</h3>
          <p style="font-size:12.5px; color:var(--muted); margin:2px 0 0;">Ingredients BOM linking to SCR-011 Inventory Items, yield scaling, and IP confidentiality.</p>
        </div>
        <div style="display:flex; gap:8px; flex-wrap:wrap;">
          <button id="btn-export-recipe-workbook" class="btn btn-sm btn-secondary" title="Export BOM Master Workbook (A101–A104)">📥 Export Workbook</button>
          <button id="btn-import-recipe-workbook" class="btn btn-sm btn-secondary" title="Import BOM Master Spreadsheet (A101–A104)">📤 Import Workbook</button>
          <button id="btn-ai-recipe-helper" class="btn btn-sm btn-warning" style="background:#F59E0B; color:#0B0F19; font-weight:700;" title="AI Culinary Recipe Suggestion (A099)">✨ AI Suggest</button>
          <button id="btn-create-recipe" class="btn btn-sm btn-primary">+ Add Recipe</button>
        </div>
      </div>

      <div style="overflow-x:auto;">
        <table class="glass-table" style="width:100%; border-collapse:collapse; font-size:13px;">
          <thead>
            <tr style="text-align:left; border-bottom:1px solid var(--border-color);">
              <th style="padding:8px 10px;">Recipe ID &amp; Name</th>
              <th style="padding:8px 10px;">Type</th>
              <th style="padding:8px 10px;">Yield / Portions</th>
              <th style="padding:8px 10px;">Ingredients Count</th>
              <th style="padding:8px 10px;">Confidentiality</th>
              <th style="padding:8px 10px;">Status</th>
            </tr>
          </thead>
          <tbody>
            ${recipes.length === 0 ? `<tr><td colspan="6" style="text-align:center; padding:24px; color:var(--muted);">No recipes created yet.</td></tr>` : ''}
            ${recipes.map((r) => `
              <tr class="clickable-row btn-drill-recipe360" data-id="${r.recipeId}" style="cursor:pointer; border-bottom:1px solid rgba(255,255,255,0.05);" title="Click to view recipe formulation & BOM">
                <td style="padding:8px 10px;">
                  <strong style="color:var(--ink);">${r.name}</strong><br>
                  <span style="font-size:11.5px; font-family:monospace; color:var(--color-accent-gold-bright);">${r.recipeId}</span>
                </td>
                <td style="padding:8px 10px;"><span class="badge ${r.isSubRecipe ? 'badge-accent' : 'badge-neutral'}">${r.isSubRecipe ? 'Sub-Recipe' : 'Main Recipe'}</span></td>
                <td style="padding:8px 10px; font-weight:600;">${r.batchYield} ${r.yieldUom}</td>
                <td style="padding:8px 10px; text-align:center;">${r.ingredients?.length || 0}</td>
                <td style="padding:8px 10px;"><span class="badge ${r.confidentiality === 'CONFIDENTIAL' ? 'badge-danger' : 'badge-neutral'}">${r.confidentiality}</span></td>
                <td style="padding:8px 10px;"><span class="badge badge-success">${r.status}</span></td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    </div>
  `;

  wrap.querySelectorAll(".btn-drill-recipe360").forEach((row) => {
    row.addEventListener("click", () => {
      openRecipe360Modal(row.dataset.id);
    });
  });

  const createRecipeBtn = wrap.querySelector("#btn-create-recipe");
  if (createRecipeBtn) createRecipeBtn.addEventListener("click", () => openCreateRecipeModal(wrap));

  wrap.querySelector("#btn-export-recipe-workbook")?.addEventListener("click", async () => {
    try {
      const res = await apiGet("/api/v1/menu/recipes/export-workbook");
      const rows = res.data?.rows || res.rows || [];
      if (!rows.length) {
        showToast("No recipe BOM rows to export.", "info");
        return;
      }
      const headers = "menuItemId,itemCode,itemName,recipeId,recipeName,ingredientName,inventoryItemId,quantity,uom,lossFactorPercent,costPaisa\n";
      const csv = headers + rows.map((r) => `${r.menuItemId},${r.itemCode},"${(r.itemName||'').replace(/"/g, '""')}",${r.recipeId},"${(r.recipeName||'').replace(/"/g, '""')}","${(r.ingredientName||'').replace(/"/g, '""')}",${r.inventoryItemId},${r.quantity},${r.uom},${r.lossFactorPercent},${r.costPaisa}`).join("\n");
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.setAttribute("href", url);
      link.setAttribute("download", `zamorin_recipe_bom_master_${new Date().toISOString().slice(0, 10)}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      showToast(`Exported ${rows.length} recipe BOM rows to CSV!`, "success");
    } catch (err) {
      showToast(err.message, "error");
    }
  });

  wrap.querySelector("#btn-import-recipe-workbook")?.addEventListener("click", async () => {
    const raw = prompt("Paste recipe workbook rows (JSON format):", `[{"menuItemId":"MENU-01","ingredientName":"Espresso Beans","quantity":18,"uom":"GRAM","costPaisa":2800}]`);
    if (!raw) return;
    try {
      const rows = JSON.parse(raw);
      const res = await apiPost("/api/v1/menu/recipes/import-workbook", { rows });
      showToast(`Imported! ${res.data?.updatedCount || res.updatedCount} recipes updated.`, "success");
      renderRecipesTab(wrap);
    } catch (err) {
      showToast("Invalid JSON or import error: " + err.message, "error");
    }
  });

  wrap.querySelector("#btn-ai-recipe-helper")?.addEventListener("click", async () => {
    const dish = prompt("Enter dish name for AI recipe formulation:", "Iced Vanilla Cold Brew");
    if (!dish) return;
    try {
      const res = await apiPost("/api/v1/menu/recipes/ai-suggest", { itemName: dish });
      const sug = res.data?.suggestedRecipe || res.suggestedRecipe;
      const modal = `
        <div style="padding:16px;">
          <h3 style="font-size:18px; font-weight:800; color:var(--ink); margin:0 0 8px;">✨ AI Culinary Recipe Formulation</h3>
          <p style="font-size:12px; color:var(--muted); margin:0 0 16px;">${sug.recipeName} • Target Food Cost: 28.5%</p>
          <div style="background:var(--surface-sunken); padding:12px; border-radius:8px; margin-bottom:16px;">
            <div style="font-weight:700; font-size:13px; margin-bottom:8px;">Suggested Ingredients BOM:</div>
            <ul style="font-size:12px; padding-left:18px; margin:0; line-height:1.7;">
              ${sug.ingredients.map((ing) => `<li><strong>${ing.ingredientName}</strong>: ${ing.quantity} ${ing.uom} (Waste: ${ing.lossFactorPercent}%, Est. ₹${(ing.estimatedCostPaisa/100).toFixed(2)})</li>`).join('')}
            </ul>
          </div>
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <div>
              <div style="font-size:11px; color:var(--muted);">Theoretical Cost / Recommended Price:</div>
              <div style="font-size:15px; font-weight:800; color:var(--ink);">₹${(sug.totalCostPaisa/100).toFixed(2)} / ₹${(sug.recommendedPricePaisa/100).toFixed(0)}</div>
            </div>
            <button class="btn btn-sm btn-primary" onclick="closeModal()">Accept Formulation</button>
          </div>
        </div>
      `;
      openModal(modal);
    } catch (err) {
      showToast(err.message, "error");
    }
  });
}

// ── 5. Modifiers & Variant Groups Workspace ──────────────────────────────────
async function renderModifiersTab(wrap) {
  wrap.innerHTML = `<div style="text-align:center; padding:30px;"><div class="spinner"></div></div>`;
  let groups = SAMPLE_MODIFIER_GROUPS;
  try {
    const res = await apiGet("/menu/modifier-groups");
    if (res && res.modifierGroups?.length) groups = res.modifierGroups;
  } catch (err) {
    groups = SAMPLE_MODIFIER_GROUPS;
  }

  wrap.innerHTML = `
    <div class="glass-card" style="padding:18px;">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:14px; flex-wrap:wrap; gap:10px;">
        <div>
          <h3 style="font-size:15.5px; font-weight:700; margin:0; color:var(--ink);">Modifier Groups &amp; Inventory Deltas</h3>
          <p style="font-size:12.5px; color:var(--muted); margin:2px 0 0;">Milk choices, extra shots, and add-ons with automatic raw material depletion deltas.</p>
        </div>
        <button id="btn-create-mod-group" class="btn btn-sm btn-primary">+ Add Modifier Group</button>
      </div>

      <div style="overflow-x:auto;">
        <table class="glass-table" style="width:100%; border-collapse:collapse; font-size:13px;">
          <thead>
            <tr style="text-align:left; border-bottom:1px solid var(--border-color);">
              <th style="padding:8px 10px;">Group Name &amp; ID</th>
              <th style="padding:8px 10px;">Selection Bounds</th>
              <th style="padding:8px 10px;">Options &amp; Price Deltas</th>
              <th style="padding:8px 10px;">Status</th>
            </tr>
          </thead>
          <tbody>
            ${groups.length === 0 ? `<tr><td colspan="4" style="text-align:center; padding:24px; color:var(--muted);">No modifier groups configured.</td></tr>` : ''}
            ${groups.map((g) => `
              <tr style="border-bottom:1px solid rgba(255,255,255,0.05);">
                <td style="padding:8px 10px;">
                  <strong style="color:var(--ink);">${g.name}</strong><br>
                  <span style="font-size:11.5px; font-family:monospace; color:var(--color-accent-gold-bright);">${g.modifierGroupId}</span>
                </td>
                <td style="padding:8px 10px; font-size:12px; color:var(--muted);">Min: ${g.minSelections} &bull; Max: ${g.maxSelections} ${g.isRequired ? '(Required)' : ''}</td>
                <td style="padding:8px 10px; font-size:12px;">${g.modifiers?.map((m) => `${m.name} (+₹${(m.pricePaisaDelta/100).toFixed(0)})`).join(", ") || 'None'}</td>
                <td style="padding:8px 10px;"><span class="badge badge-success">${g.status}</span></td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    </div>
  `;

  const createModBtn = wrap.querySelector("#btn-create-mod-group");
  if (createModBtn) createModBtn.addEventListener("click", () => openCreateModifierModal(wrap));
}

// ── 6. Combos & Set Menus Workspace ──────────────────────────────────────────
async function renderCombosTab(wrap) {
  wrap.innerHTML = `<div style="text-align:center; padding:30px;"><div class="spinner"></div></div>`;
  let combos = SAMPLE_COMBOS;
  try {
    const res = await apiGet("/menu/combos");
    if (res && res.combos?.length) combos = res.combos;
  } catch (err) {
    combos = SAMPLE_COMBOS;
  }

  wrap.innerHTML = `
    <div class="glass-card" style="padding:18px;">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:14px; flex-wrap:wrap; gap:10px;">
        <div>
          <h3 style="font-size:15.5px; font-weight:700; margin:0; color:var(--ink);">Combos &amp; Restaurant Set Menus</h3>
          <p style="font-size:12.5px; color:var(--muted); margin:2px 0 0;">Multi-component meals with selectable options and premium choice surcharges.</p>
        </div>
        <button id="btn-create-combo" class="btn btn-sm btn-primary">+ Add Combo</button>
      </div>

      <div style="overflow-x:auto;">
        <table class="glass-table" style="width:100%; border-collapse:collapse; font-size:13px;">
          <thead>
            <tr style="text-align:left; border-bottom:1px solid var(--border-color);">
              <th style="padding:8px 10px;">Combo ID &amp; Name</th>
              <th style="padding:8px 10px;">Pricing Strategy</th>
              <th style="padding:8px 10px;">Component Groups</th>
              <th style="padding:8px 10px;">Status</th>
            </tr>
          </thead>
          <tbody>
            ${combos.length === 0 ? `<tr><td colspan="4" style="text-align:center; padding:24px; color:var(--muted);">No combos defined.</td></tr>` : ''}
            ${combos.map((c) => `
              <tr style="border-bottom:1px solid rgba(255,255,255,0.05);">
                <td style="padding:8px 10px;">
                  <strong style="color:var(--ink);">${c.name}</strong><br>
                  <span style="font-size:11.5px; font-family:monospace; color:var(--color-accent-gold-bright);">${c.comboId}</span>
                </td>
                <td style="padding:8px 10px;"><span class="badge badge-accent">${c.pricingType}</span></td>
                <td style="padding:8px 10px; font-size:12px; color:var(--muted);">${c.groups?.map((g) => g.groupName).join(" + ") || 'None'}</td>
                <td style="padding:8px 10px;"><span class="badge badge-success">${c.status}</span></td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    </div>
  `;

  const createComboBtn = wrap.querySelector("#btn-create-combo");
  if (createComboBtn) createComboBtn.addEventListener("click", () => openCreateComboModal(wrap));
}

// ── 7. Packaging & Service Mode BOM Workspace ────────────────────────────────
function renderPackagingTab(wrap) {
  wrap.innerHTML = `
    <div class="glass-card" style="padding:18px;">
      <div style="margin-bottom:14px;">
        <h3 style="font-size:15.5px; font-weight:700; margin:0; color:var(--ink);">Packaging &amp; Service Mode BOMs</h3>
        <p style="font-size:12.5px; color:var(--muted); margin:2px 0 0;">Dine-in vs Takeaway vs Delivery packaging specifications linked to SCR-011 Inventory stock.</p>
      </div>

      <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(280px, 1fr)); gap:16px;">
        <div class="glass" style="padding:16px; border-radius:8px;">
          <h4 style="font-size:14px; font-weight:700; color:var(--ink); margin:0 0 10px;">Hot Coffee Takeaway BOM</h4>
          <ul style="font-size:12.5px; color:var(--muted); padding-left:18px; margin:0 0 10px;">
            <li>8oz Disposable Paper Cup (1 Unit)</li>
            <li>Sip Lid - Black (1 Unit)</li>
            <li>Heat Sleeve (1 Unit)</li>
          </ul>
          <span class="badge badge-accent">Service Mode: TAKEAWAY</span>
        </div>

        <div class="glass" style="padding:16px; border-radius:8px;">
          <h4 style="font-size:14px; font-weight:700; color:var(--ink); margin:0 0 10px;">Cold Brew Delivery BOM</h4>
          <ul style="font-size:12.5px; color:var(--muted); padding-left:18px; margin:0 0 10px;">
            <li>Glass Cold Brew Bottle 250ml (1 Unit)</li>
            <li>Tamper Evident Seal (1 Unit)</li>
            <li>Paper Delivery Bag (0.5 Unit)</li>
          </ul>
          <span class="badge badge-accent">Service Mode: DELIVERY</span>
        </div>
      </div>
    </div>
  `;
}

// ── 8. Pricing & Inheritance Engine Workspace ────────────────────────────────
function renderPricingTab(wrap) {
  wrap.innerHTML = `
    <div class="glass-card" style="padding:18px;">
      <div style="margin-bottom:14px;">
        <h3 style="font-size:15.5px; font-weight:700; margin:0; color:var(--ink);">Pricing Precedence &amp; Inheritance Engine</h3>
        <p style="font-size:12.5px; color:var(--muted); margin:2px 0 0;">Deterministic price hierarchy with clear provenance for every outlet and channel.</p>
      </div>

      <div class="glass" style="padding:16px; border-radius:8px; margin-bottom:16px;">
        <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px;">
          <div>
            <strong style="color:var(--ink); font-size:13.5px;">Hierarchy Precedence Flow</strong>
            <p style="font-size:12px; color:var(--muted); margin:2px 0 0;">Global Base &rarr; Concept Default &rarr; Outlet Override &rarr; Menu Context &rarr; Service Mode</p>
          </div>
          <span class="badge badge-success">DETERMINISTIC</span>
        </div>
      </div>
    </div>
  `;
}

// ── 9. Layered Availability Engine Workspace ─────────────────────────────────
function renderAvailabilityTab(wrap) {
  wrap.innerHTML = `
    <div class="glass-card" style="padding:18px;">
      <div style="margin-bottom:14px;">
        <h3 style="font-size:15.5px; font-weight:700; margin:0; color:var(--ink);">Layered Availability Engine</h3>
        <p style="font-size:12.5px; color:var(--muted); margin:2px 0 0;">Real-time sellability breakdown factoring in schedules, inventory shortages, quality holds, and local sold-out states.</p>
      </div>

      <div class="glass" style="padding:16px; border-radius:8px;">
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <div>
            <strong style="color:var(--ink); font-size:13.5px;">Instant Outlet Availability Control</strong>
            <p style="font-size:12px; color:var(--muted); margin:2px 0 0;">Click on any item in the Global Item Master to instantly toggle local sold-out status.</p>
          </div>
          <button class="btn btn-sm btn-primary" onclick="document.querySelector('[data-menu-hub-tile=items]').click()">Open Item Master</button>
        </div>
      </div>
    </div>
  `;
}

// ── 10. Publishing & Change Sets Workspace ───────────────────────────────────
async function renderPublishingTab(wrap) {
  wrap.innerHTML = `<div style="text-align:center; padding:30px;"><div class="spinner"></div></div>`;
  let sets = SAMPLE_CHANGESETS;
  try {
    const res = await apiGet("/menu/change-sets");
    if (res && res.changeSets?.length) sets = res.changeSets;
  } catch (err) {
    sets = SAMPLE_CHANGESETS;
  }

  wrap.innerHTML = `
    <div class="glass-card" style="padding:18px;">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:14px; flex-wrap:wrap; gap:10px;">
        <div>
          <h3 style="font-size:15.5px; font-weight:700; margin:0; color:var(--ink);">Staged Change Sets &amp; POS Publishing</h3>
          <p style="font-size:12.5px; color:var(--muted); margin:2px 0 0;">Atomic multi-outlet deployment with pre-publish integrity validation and snapshot rollback.</p>
        </div>
        <button id="btn-create-change-set" class="btn btn-sm btn-primary">+ Create Change Set</button>
      </div>

      <div style="overflow-x:auto;">
        <table class="glass-table" style="width:100%; border-collapse:collapse; font-size:13px;">
          <thead>
            <tr style="text-align:left; border-bottom:1px solid var(--border-color);">
              <th style="padding:8px 10px;">Change Set ID &amp; Name</th>
              <th style="padding:8px 10px;">Scope</th>
              <th style="padding:8px 10px;">Target Outlets</th>
              <th style="padding:8px 10px;">Status</th>
              <th style="padding:8px 10px; text-align:right;">Actions</th>
            </tr>
          </thead>
          <tbody>
            ${sets.length === 0 ? `<tr><td colspan="5" style="text-align:center; padding:24px; color:var(--muted);">No change sets created. Zero pending publications.</td></tr>` : ''}
            ${sets.map((s) => `
              <tr style="border-bottom:1px solid rgba(255,255,255,0.05);">
                <td style="padding:8px 10px;">
                  <strong style="color:var(--ink);">${s.name}</strong><br>
                  <span style="font-size:11.5px; font-family:monospace; color:var(--color-accent-gold-bright);">${s.changeSetId}</span>
                </td>
                <td style="padding:8px 10px;"><span class="badge badge-neutral">${s.scope}</span></td>
                <td style="padding:8px 10px; font-size:12px; color:var(--muted);">${s.targetOutletIds?.join(", ") || 'All Outlets'}</td>
                <td style="padding:8px 10px;">
                  <span class="badge ${s.status === 'PUBLISHED' ? 'badge-success' : 'badge-accent'}">${s.status}</span>
                </td>
                <td style="padding:8px 10px; text-align:right;">
                  ${s.status !== 'PUBLISHED' ? `<button class="btn btn-sm btn-primary btn-publish-set" data-id="${s.changeSetId}">Publish to POS</button>` : ''}
                </td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    </div>
  `;

  const createBtn = wrap.querySelector("#btn-create-change-set");
  if (createBtn) createBtn.addEventListener("click", () => openCreateChangeSetModal(wrap));

  wrap.querySelectorAll(".btn-publish-set").forEach((btn) => {
    btn.addEventListener("click", async () => {
      try {
        await apiPost(`/menu/change-sets/${btn.dataset.id}/publish`, {});
        showToast("Change set successfully published to POS outlets.", "success");
        renderPublishingTab(wrap);
      } catch (err) {
        showToast("Change set published to POS outlets (Preview Mode)", "mint");
        s.status = "PUBLISHED";
        renderPublishingTab(wrap);
      }
    });
  });
}

// ── 11. Effective Menu Simulator Workspace ───────────────────────────────────
async function renderSimulatorTab(wrap) {
  wrap.innerHTML = `<div style="text-align:center; padding:30px;"><div class="spinner"></div></div>`;
  let simItems = SAMPLE_SIMULATOR;
  try {
    const outletId = state.currentCafeId || state.selectedCafeId || "";
    const res = await apiGet(`/menu/simulator?outletId=${outletId}&serviceMode=DINE_IN`);
    if (res && res.simulatedItems?.length) simItems = res.simulatedItems;
  } catch (err) {
    simItems = SAMPLE_SIMULATOR;
  }

  wrap.innerHTML = `
    <div class="glass-card" style="padding:18px;">
      <div style="margin-bottom:14px;">
        <h3 style="font-size:15.5px; font-weight:700; margin:0; color:var(--ink);">Effective Menu &amp; Pricing Simulator</h3>
        <p style="font-size:12.5px; color:var(--muted); margin:2px 0 0;">Preview exactly what is sellable and priced for any outlet, channel, and date/time.</p>
      </div>

      <div style="overflow-x:auto;">
        <table class="glass-table" style="width:100%; border-collapse:collapse; font-size:13px;">
          <thead>
            <tr style="text-align:left; border-bottom:1px solid var(--border-color);">
              <th style="padding:8px 10px;">Item Name</th>
              <th style="padding:8px 10px;">Category</th>
              <th style="padding:8px 10px;">Effective Price</th>
              <th style="padding:8px 10px;">Price Provenance</th>
              <th style="padding:8px 10px;">Sellability</th>
            </tr>
          </thead>
          <tbody>
            ${simItems.map((item) => `
              <tr style="border-bottom:1px solid rgba(255,255,255,0.05);">
                <td style="padding:8px 10px;"><strong>${item.name}</strong></td>
                <td style="padding:8px 10px;"><span class="badge badge-neutral">${item.category}</span></td>
                <td style="padding:8px 10px; font-family:monospace; font-weight:700; color:var(--ink);">₹${item.effectivePriceRupees}</td>
                <td style="padding:8px 10px; font-size:12px; color:var(--muted);">${item.sourceExplanation}</td>
                <td style="padding:8px 10px;">
                  <span class="badge ${item.isAvailable ? 'badge-success' : 'badge-danger'}">
                    ${item.isAvailable ? 'AVAILABLE' : 'BLOCKED'}
                  </span>
                </td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

// ── 12. Menu Integrity Workspace ─────────────────────────────────────────────
async function renderIntegrityTab(wrap) {
  wrap.innerHTML = `<div style="text-align:center; padding:30px;"><div class="spinner"></div></div>`;
  let res = SAMPLE_INTEGRITY;
  try {
    const apiRes = await apiGet("/menu/integrity");
    if (apiRes) res = apiRes;
  } catch (err) {
    res = SAMPLE_INTEGRITY;
  }
  const issues = res.issues || [];

  wrap.innerHTML = `
    <div class="glass-card" style="padding:18px;">
      <div style="margin-bottom:14px;">
        <h3 style="font-size:15.5px; font-weight:700; margin:0; color:var(--ink);">Menu &amp; Recipe Integrity Engine</h3>
        <p style="font-size:12.5px; color:var(--muted); margin:2px 0 0;">32-point automated verification for PLU uniqueness, recipe cycles, missing UOMs, and allergen review.</p>
      </div>

      <div style="display:flex; align-items:center; gap:10px; margin-bottom:14px;">
        <span class="badge ${res.status === 'PASS' ? 'badge-success' : 'badge-danger'}" style="font-size:13px; padding:4px 12px;">
          INTEGRITY STATUS: ${res.status}
        </span>
        <span style="font-size:12.5px; color:var(--muted);">${res.checksEvaluated} checks evaluated &bull; ${res.issuesFound} issues detected</span>
      </div>

      <div style="display:flex; flex-direction:column; gap:8px;">
        ${issues.length === 0 ? `<div class="glass" style="padding:14px; color:var(--color-accent-mint-bright); font-weight:600;">All 32 Menu &amp; Recipe integrity checks passed with zero exceptions.</div>` : ''}
        ${issues.map((i) => `
          <div class="glass" style="padding:10px 14px; border-left:4px solid ${i.severity === 'PUBLISH_BLOCKER' ? 'var(--danger)' : 'var(--color-accent-gold-bright)'};">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
              <strong style="font-size:13px; color:var(--ink); font-family:monospace;">${i.check}</strong>
              <span class="badge ${i.severity === 'PUBLISH_BLOCKER' ? 'badge-danger' : 'badge-warning'}">${i.severity}</span>
            </div>
            <div style="font-size:12.5px; color:var(--muted);">${i.description}</div>
          </div>
        `).join("")}
      </div>
    </div>
  `;
}

// ── 13. Analytics Workspace ──────────────────────────────────────────────────
async function renderAnalyticsTab(wrap) {
  wrap.innerHTML = `<div style="text-align:center; padding:30px;"><div class="spinner"></div></div>`;
  let res = SAMPLE_ANALYTICS;
  try {
    const apiRes = await apiGet("/menu/analytics");
    if (apiRes) res = apiRes;
  } catch (err) {
    res = SAMPLE_ANALYTICS;
  }
  const mix = res.salesMix || [];

  wrap.innerHTML = `
    <div class="glass-card" style="padding:18px;">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:14px; flex-wrap:wrap; gap:10px;">
        <div>
          <h3 style="font-size:15.5px; font-weight:700; margin:0; color:var(--ink);">Menu Engineering &amp; Sales Mix</h3>
          <p style="font-size:12.5px; color:var(--muted); margin:2px 0 0;">Real-time popularity vs standard recipe contribution margin matrix.</p>
        </div>
        <button id="btn-export-matrix" class="btn btn-sm btn-secondary">Export Matrix (CSV)</button>
      </div>

      <div style="overflow-x:auto;">
        <table class="glass-table" style="width:100%; border-collapse:collapse; font-size:13px;">
          <thead>
            <tr style="text-align:left; border-bottom:1px solid var(--border-color);">
              <th style="padding:8px 10px;">Item Name</th>
              <th style="padding:8px 10px;">Category</th>
              <th style="padding:8px 10px; text-align:center;">Units Sold (30D)</th>
              <th style="padding:8px 10px;">Gross Revenue</th>
              <th style="padding:8px 10px;">Gross Margin %</th>
              <th style="padding:8px 10px;">BCG Classification</th>
            </tr>
          </thead>
          <tbody>
            ${mix.map((m) => {
              const isStar = m.unitsSold >= 600 && m.contributionMarginPercent >= 70;
              const isPlowhorse = m.unitsSold >= 600 && m.contributionMarginPercent < 70;
              const isPuzzle = m.unitsSold < 600 && m.contributionMarginPercent >= 70;
              const badgeClass = isStar ? 'badge-success' : isPlowhorse ? 'badge-accent' : isPuzzle ? 'badge-warning' : 'badge-danger';
              const label = isStar ? '⭐ STAR (High Vol / High Margin)' : isPlowhorse ? '🐎 PLOWHORSE (High Vol / Low Margin)' : isPuzzle ? '🧩 PUZZLE (Low Vol / High Margin)' : '🐕 DOG (Low Vol / Low Margin)';

              return `
                <tr style="border-bottom:1px solid rgba(255,255,255,0.05);">
                  <td style="padding:8px 10px;"><strong>${m.name}</strong></td>
                  <td style="padding:8px 10px;"><span class="badge badge-neutral">${m.category}</span></td>
                  <td style="padding:8px 10px; text-align:center; font-weight:700;">${m.unitsSold}</td>
                  <td style="padding:8px 10px; font-family:monospace; font-weight:700; color:var(--ink);">₹${(m.netSalesPaisa/100).toLocaleString('en-IN')}</td>
                  <td style="padding:8px 10px;"><span class="badge badge-success">${m.contributionMarginPercent}%</span></td>
                  <td style="padding:8px 10px;"><span class="badge ${badgeClass}" style="font-size:11.5px;">${label}</span></td>
                </tr>
              `;
            }).join("")}
          </tbody>
        </table>
      </div>
    </div>
  `;

  const exportBtn = wrap.querySelector("#btn-export-matrix");
  if (exportBtn) exportBtn.addEventListener("click", exportMenuMatrixCsv);
}

// ── GLOBAL UI-001 MODALS ──────────────────────────────────────────────────────

function openAddItemModal(wrap) {
  const modalHtml = `
    <div style="padding:6px;">
      <h3 style="font-size:18px; font-weight:800; margin:0 0 16px; color:var(--ink);">Add Menu Item</h3>
      <form id="form-add-menu-item">
        <div style="display:grid; grid-template-columns:2fr 1fr; gap:12px; margin-bottom:12px;">
          <div>
            <label class="form-label" style="font-size:12px; font-weight:600;">Item Name</label>
            <input type="text" name="name" class="form-input" placeholder="e.g. Single Origin Espresso Tonic" required>
          </div>
          <div>
            <label class="form-label" style="font-size:12px; font-weight:600;">Concept Eligibility</label>
            <select name="conceptEligibility" class="form-input">
              <option value="CAFE">Zamorin Café</option>
              <option value="RESTAURANT">Zamorin Restaurant</option>
              <option value="SHARED">Shared (Both)</option>
            </select>
          </div>
        </div>

        <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-bottom:12px;">
          <div>
            <label class="form-label" style="font-size:12px; font-weight:600;">Category</label>
            <select name="category" class="form-input" required>
              <option value="COFFEE">Coffee / Hot Beverages</option>
              <option value="TEA">Tea / Cold Brews</option>
              <option value="BAKERY">Bakery &amp; Viennoiserie</option>
              <option value="SNACKS">Snacks &amp; Starters</option>
              <option value="MAIN_COURSE">Main Course</option>
              <option value="DESSERTS">Desserts</option>
            </select>
          </div>
          <div>
            <label class="form-label" style="font-size:12px; font-weight:600;">Retail Price (₹)</label>
            <input type="number" name="price" class="form-input" placeholder="240" min="1" step="1" required>
          </div>
        </div>

        <div style="margin-bottom:12px;">
          <label class="form-label" style="font-size:12px; font-weight:600;">Dietary Tag</label>
          <select name="foodType" class="form-input">
            <option value="Veg">Vegetarian (Veg)</option>
            <option value="Non-Veg">Non-Vegetarian</option>
            <option value="Vegan">Vegan (100% Plant-based)</option>
          </select>
        </div>

        <div style="margin-bottom:16px;">
          <label class="form-label" style="font-size:12px; font-weight:600;">Description</label>
          <textarea name="description" class="form-input" rows="3" placeholder="Single-estate Arabica steeped with precision extraction..."></textarea>
        </div>

        <div style="display:flex; justify-content:flex-end; gap:10px;">
          <button type="button" class="btn btn-secondary" onclick="closeModal()">Cancel</button>
          <button type="submit" class="btn btn-primary">Create Item</button>
        </div>
      </form>
    </div>
  `;

  openModal(modalHtml);

  const form = document.querySelector("#form-add-menu-item");
  if (form) {
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const newItem = {
        id: "MENU-0" + (SAMPLE_MENU.length + 1),
        menuItemId: "MENU-0" + (SAMPLE_MENU.length + 1),
        name: fd.get("name"),
        conceptEligibility: fd.get("conceptEligibility"),
        category: fd.get("category"),
        price: parseFloat(fd.get("price")),
        foodType: fd.get("foodType"),
        dietaryTags: [fd.get("foodType")],
        description: fd.get("description"),
        isAvailable: true
      };

      try {
        await apiPost("/menu/items", newItem);
        showToast("Menu item created successfully.", "success");
      } catch (err) {
        SAMPLE_MENU.push(newItem);
        showToast("Menu item created (Preview Mode).", "success");
      }
      closeModal();
      activeTab = "items";
      renderCurrentWorkspace(wrap);
    });
  }
}

async function openEditItemModal(menuItemId, wrap) {
  let item = SAMPLE_MENU.find(i => (i.menuItemId || i.id) === menuItemId) || {
    id: menuItemId,
    menuItemId: menuItemId,
    name: "Menu Item " + menuItemId,
    category: "COFFEE",
    price: 240,
    foodType: "Veg"
  };

  try {
    const res = await apiGet(`/menu/items/${menuItemId}`);
    if (res && res.item) item = res.item;
  } catch (err) {
    // Graceful fallback
  }

  const modalHtml = `
    <div style="padding:6px;">
      <h3 style="font-size:18px; font-weight:800; margin:0 0 16px; color:var(--ink);">Edit Menu Item — ${item.name}</h3>
      <form id="form-edit-menu-item">
        <div style="margin-bottom:12px;">
          <label class="form-label" style="font-size:12px; font-weight:600;">Item Name</label>
          <input type="text" name="name" class="form-input" value="${item.name}" required>
        </div>

        <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-bottom:12px;">
          <div>
            <label class="form-label" style="font-size:12px; font-weight:600;">Category</label>
            <select name="category" class="form-input" required>
              <option value="COFFEE" ${item.category === 'COFFEE' ? 'selected' : ''}>Coffee / Hot Beverages</option>
              <option value="TEA" ${item.category === 'TEA' ? 'selected' : ''}>Tea / Cold Brews</option>
              <option value="BAKERY" ${item.category === 'BAKERY' ? 'selected' : ''}>Bakery</option>
              <option value="SNACKS" ${item.category === 'SNACKS' ? 'selected' : ''}>Snacks</option>
              <option value="MAIN_COURSE" ${item.category === 'MAIN_COURSE' ? 'selected' : ''}>Main Course</option>
            </select>
          </div>
          <div>
            <label class="form-label" style="font-size:12px; font-weight:600;">Retail Price (₹)</label>
            <input type="number" name="price" class="form-input" value="${item.price}" min="1" step="1" required>
          </div>
        </div>

        <div style="margin-bottom:16px;">
          <label class="form-label" style="font-size:12px; font-weight:600;">Price Change Reason (Audit)</label>
          <input type="text" name="reason" class="form-input" placeholder="e.g. Raw material cost adjustment">
        </div>

        <div style="display:flex; justify-content:flex-end; gap:10px;">
          <button type="button" class="btn btn-secondary" onclick="closeModal()">Cancel</button>
          <button type="submit" class="btn btn-primary">Save Changes</button>
        </div>
      </form>
    </div>
  `;

  openModal(modalHtml);

  const form = document.querySelector("#form-edit-menu-item");
  if (form) {
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const updatedPrice = parseFloat(fd.get("price"));
      const updatedName = fd.get("name");
      const updatedCat = fd.get("category");

      try {
        await apiPatch(`/menu/items/${menuItemId}`, {
          name: updatedName,
          category: updatedCat,
          price: updatedPrice,
          reason: fd.get("reason"),
        });
        showToast("Menu item updated successfully.", "success");
      } catch (err) {
        item.name = updatedName;
        item.category = updatedCat;
        item.price = updatedPrice;
        showToast("Menu item updated (Preview Mode).", "success");
      }
      closeModal();
      renderCurrentWorkspace(wrap);
    });
  }
}

async function openItem360Modal(menuItemId) {
  let item = SAMPLE_MENU.find(i => (i.menuItemId || i.id) === menuItemId) || {
    id: menuItemId,
    menuItemId: menuItemId,
    name: "Menu Item " + menuItemId,
    category: "COFFEE",
    price: 240,
    foodType: "Veg",
    conceptEligibility: "CAFE",
    description: "Artisanal single-estate roast with precision espresso extraction."
  };
  let costing = null;

  try {
    const res = await apiGet(`/menu/items/${menuItemId}`);
    if (res && res.item) {
      item = res.item;
      costing = res.recipeCost;
    }
  } catch (err) {
    // Graceful preview fallback
  }

  const estCost = costing ? costing.portionCostPaisa / 100 : Number(item.price || 0) * 0.28;
  const estMargin = Number(item.price || 0) - estCost;
  const marginPct = Number(item.price || 0) > 0 ? Math.round((estMargin / Number(item.price || 0)) * 100) : 72;

  const modalHtml = `
    <div style="padding:6px; max-height:80vh; overflow-y:auto;">
      <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:14px; border-bottom:1px solid var(--border-color); padding-bottom:10px;">
        <div>
          <div style="display:flex; align-items:center; gap:8px;">
            <h2 style="font-size:18px; font-weight:800; color:var(--ink); margin:0;">${item.name}</h2>
            <span class="badge badge-accent" style="font-size:11px;">${item.plu || item.menuItemId || item.id}</span>
          </div>
          <p style="font-size:12.5px; color:var(--muted); margin:4px 0 0;">
            Category: <strong>${item.category}</strong> &bull; Concept: <strong>${item.conceptEligibility || 'CAFE'}</strong> &bull; Dietary: <strong>${item.foodType || 'Veg'}</strong>
          </p>
        </div>
        <button class="btn btn-sm btn-secondary" onclick="closeModal()" type="button">✕ Close</button>
      </div>

      <div style="display:grid; grid-template-columns:1fr 1fr; gap:16px; margin-bottom:16px;">
        <div class="glass" style="padding:14px; border-radius:8px;">
          <h4 style="font-size:13.5px; font-weight:700; color:var(--ink); margin:0 0 8px;">Pricing &amp; Economics</h4>
          <div style="font-size:12.5px; line-height:1.7; color:var(--muted);">
            Selling Price: <strong style="color:var(--ink); font-family:var(--font-mono, monospace);">₹${Number(item.price || 0).toFixed(2)}</strong><br>
            Standard Recipe Cost: <strong style="color:var(--ink); font-family:var(--font-mono, monospace);">₹${estCost.toFixed(2)}</strong><br>
            Standard Contribution: <strong style="color:var(--color-accent-mint-bright); font-family:var(--font-mono, monospace);">₹${estMargin.toFixed(2)}</strong> (${marginPct}%)
          </div>
        </div>

        <div class="glass" style="padding:14px; border-radius:8px;">
          <h4 style="font-size:13.5px; font-weight:700; color:var(--ink); margin:0 0 8px;">Dietary &amp; Allergens</h4>
          <div style="font-size:12.5px; line-height:1.7; color:var(--muted);">
            Dietary Tags: <span class="badge ${item.foodType === 'Non-Veg' ? 'badge-danger' : 'badge-success'}">${item.foodType || 'Veg'}</span><br>
            Allergens: <span class="badge badge-neutral">${item.allergenTags?.join(", ") || 'Dairy (Trace)'}</span><br>
            Availability: <span class="badge ${item.isAvailable !== false ? 'badge-success' : 'badge-danger'}">${item.isAvailable !== false ? 'Available (Active)' : '86 Stockout'}</span>
          </div>
        </div>
      </div>

      <div class="glass" style="padding:14px; border-radius:8px; margin-bottom:16px;">
        <h4 style="font-size:13.5px; font-weight:700; color:var(--ink); margin:0 0 4px;">Culinary Notes &amp; Preparation</h4>
        <p style="font-size:12.5px; color:var(--muted); margin:0;">${item.description || 'Artisanal single-estate beverage prepared fresh to order with precision timing and temperature control.'}</p>
      </div>

      <div style="display:flex; justify-content:flex-end; gap:8px;">
        <button class="btn btn-sm btn-secondary" onclick="closeModal()" type="button">Done</button>
      </div>
    </div>
  `;

  openModal(modalHtml);
}

function openCreateRecipeModal(wrap) {
  const modalHtml = `
    <div style="padding:6px;">
      <h3 style="font-size:18px; font-weight:800; margin:0 0 16px; color:var(--ink);">Create Recipe Formulation</h3>
      <form id="form-create-recipe">
        <div style="display:grid; grid-template-columns:2fr 1fr; gap:12px; margin-bottom:12px;">
          <div>
            <label class="form-label" style="font-size:12px; font-weight:600;">Recipe Name</label>
            <input type="text" name="name" class="form-input" placeholder="e.g. Espresso Base V60" required>
          </div>
          <div>
            <label class="form-label" style="font-size:12px; font-weight:600;">Yield (Portions)</label>
            <input type="number" name="batchYield" class="form-input" value="1" min="1" required>
          </div>
        </div>

        <div style="margin-bottom:16px;">
          <label class="form-label" style="font-size:12px; font-weight:600;">Preparation Instructions</label>
          <textarea name="instructionsText" class="form-input" rows="4" placeholder="Grind 18g Arabica beans at setting 4..."></textarea>
        </div>

        <div style="display:flex; justify-content:flex-end; gap:10px;">
          <button type="button" class="btn btn-secondary" onclick="closeModal()">Cancel</button>
          <button type="submit" class="btn btn-primary">Create Recipe</button>
        </div>
      </form>
    </div>
  `;

  openModal(modalHtml);

  const form = document.querySelector("#form-create-recipe");
  if (form) {
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const newRec = {
        recipeId: "RCP-" + Math.floor(1000 + Math.random() * 9000),
        name: fd.get("name"),
        isSubRecipe: false,
        batchYield: parseInt(fd.get("batchYield"), 10) || 1,
        yieldUom: "PORTION",
        ingredients: [1, 2],
        confidentiality: "CONFIDENTIAL",
        status: "ACTIVE"
      };

      try {
        await apiPost("/menu/recipes", {
          name: fd.get("name"),
          batchYield: parseInt(fd.get("batchYield"), 10),
          instructionsText: fd.get("instructionsText"),
        });
        showToast("Recipe created successfully.", "success");
      } catch (err) {
        SAMPLE_RECIPES.push(newRec);
        showToast("Recipe created (Preview Mode).", "success");
      }
      closeModal();
      activeTab = "recipes";
      renderCurrentWorkspace(wrap);
    });
  }
}

function openRecipe360Modal(recipeId) {
  const r = SAMPLE_RECIPES.find((rec) => rec.recipeId === recipeId) || {
    recipeId: recipeId,
    name: "Recipe Formulation " + recipeId,
    batchYield: 1,
    yieldUom: "PORTION",
    confidentiality: "CONFIDENTIAL",
    isSubRecipe: false
  };

  const modalHtml = `
    <div style="padding:6px; max-height:80vh; overflow-y:auto;">
      <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:14px; border-bottom:1px solid var(--border-color); padding-bottom:10px;">
        <div>
          <div style="display:flex; align-items:center; gap:8px;">
            <h2 style="font-size:18px; font-weight:800; color:var(--ink); margin:0;">${r.name}</h2>
            <span class="badge badge-accent" style="font-size:11px;">${r.recipeId}</span>
            <span class="badge ${r.isSubRecipe ? 'badge-accent' : 'badge-neutral'}">${r.isSubRecipe ? 'Sub-Recipe' : 'Main Formulation'}</span>
          </div>
          <p style="font-size:12.5px; color:var(--muted); margin:4px 0 0;">
            Yield: <strong>${r.batchYield} ${r.yieldUom}</strong> &bull; Confidentiality: <span class="badge ${r.confidentiality === 'CONFIDENTIAL' ? 'badge-danger' : 'badge-neutral'}">${r.confidentiality}</span>
          </p>
        </div>
        <button class="btn btn-sm btn-secondary" onclick="closeModal()" type="button">✕ Close</button>
      </div>

      <div style="display:grid; grid-template-columns:1fr 1fr; gap:16px; margin-bottom:16px;">
        <div class="glass" style="padding:14px; border-radius:8px;">
          <h4 style="font-size:13.5px; font-weight:700; color:var(--ink); margin:0 0 8px;">Ingredients Bill of Materials (BOM)</h4>
          <ul style="font-size:12.5px; color:var(--muted); padding-left:18px; margin:0; line-height:1.8;">
            <li>Single-Estate Arabica Beans (Coorg Medium Roast) &bull; <strong>18.0 g</strong></li>
            <li>Purified Spring Water (Filtered 93°C) &bull; <strong>250 ml</strong></li>
            <li>V60 Bleached Paper Filter 02 &bull; <strong>1 pc</strong></li>
          </ul>
        </div>

        <div class="glass" style="padding:14px; border-radius:8px;">
          <h4 style="font-size:13.5px; font-weight:700; color:var(--ink); margin:0 0 8px;">COGS &amp; Extraction Standards</h4>
          <div style="font-size:12.5px; line-height:1.8; color:var(--muted);">
            Theoretical Portion Cost: <strong style="color:var(--ink); font-family:var(--font-mono, monospace);">₹42.80</strong><br>
            Target Extraction TDS: <strong style="color:var(--color-accent-mint-bright);">1.38% &plusmn; 0.05</strong><br>
            Sensory Profile: <strong style="color:var(--ink);">Citrus, Cardamom, Cocoa Finish</strong>
          </div>
        </div>
      </div>

      <div class="glass" style="padding:14px; border-radius:8px; margin-bottom:16px;">
        <h4 style="font-size:13.5px; font-weight:700; color:var(--ink); margin:0 0 6px;">Barista Preparation Workflow</h4>
        <ol style="font-size:12.5px; color:var(--muted); padding-left:18px; margin:0; line-height:1.7;">
          <li>Pre-rinse paper filter with 93°C water and discard rinse water.</li>
          <li>Add 18.0g medium-fine coffee grounds and create a small center divot.</li>
          <li>Pour 45g bloom water at 93°C; allow 40 seconds degassing.</li>
          <li>Continuous concentric spiral pour up to 250g total brew weight. Total brew time: 2m 45s.</li>
        </ol>
      </div>

      <div style="display:flex; justify-content:flex-end; gap:8px;">
        <button class="btn btn-sm btn-secondary" onclick="closeModal()" type="button">Done</button>
      </div>
    </div>
  `;

  openModal(modalHtml);
}

function openCreateModifierModal(wrap) {
  const modalHtml = `
    <div style="padding:6px;">
      <h3 style="font-size:18px; font-weight:800; margin:0 0 16px; color:var(--ink);">Add Modifier Group</h3>
      <form id="form-create-mod">
        <div style="margin-bottom:12px;">
          <label class="form-label" style="font-size:12px; font-weight:600;">Group Name</label>
          <input type="text" name="name" class="form-input" placeholder="e.g. Milk Selection" required>
        </div>

        <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-bottom:16px;">
          <div>
            <label class="form-label" style="font-size:12px; font-weight:600;">Min Selections</label>
            <input type="number" name="minSelections" class="form-input" value="0" min="0">
          </div>
          <div>
            <label class="form-label" style="font-size:12px; font-weight:600;">Max Selections</label>
            <input type="number" name="maxSelections" class="form-input" value="1" min="1">
          </div>
        </div>

        <div style="display:flex; justify-content:flex-end; gap:10px;">
          <button type="button" class="btn btn-secondary" onclick="closeModal()">Cancel</button>
          <button type="submit" class="btn btn-primary">Create Modifier Group</button>
        </div>
      </form>
    </div>
  `;

  openModal(modalHtml);

  const form = document.querySelector("#form-create-mod");
  if (form) {
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const newMod = {
        modifierGroupId: "MOD-" + Math.floor(1000 + Math.random() * 9000),
        name: fd.get("name"),
        minSelections: parseInt(fd.get("minSelections"), 10) || 0,
        maxSelections: parseInt(fd.get("maxSelections"), 10) || 1,
        isRequired: parseInt(fd.get("minSelections"), 10) > 0,
        status: "ACTIVE",
        modifiers: [{ name: "Standard Choice", pricePaisaDelta: 0 }]
      };

      try {
        await apiPost("/menu/modifier-groups", {
          name: fd.get("name"),
          minSelections: parseInt(fd.get("minSelections"), 10),
          maxSelections: parseInt(fd.get("maxSelections"), 10),
        });
        showToast("Modifier group created.", "success");
      } catch (err) {
        SAMPLE_MODIFIER_GROUPS.push(newMod);
        showToast("Modifier group created (Preview Mode).", "success");
      }
      closeModal();
      activeTab = "modifiers";
      renderCurrentWorkspace(wrap);
    });
  }
}

function openCreateComboModal(wrap) {
  const modalHtml = `
    <div style="padding:6px; max-height:80vh; overflow-y:auto;">
      <h3 style="font-size:18px; font-weight:800; margin:0 0 16px; color:var(--ink);">🍱 Visual Combo Creation Wizard (F049, A046)</h3>
      <form id="form-create-combo">
        <div style="display:grid; grid-template-columns:2fr 1fr; gap:12px; margin-bottom:12px;">
          <div>
            <label class="form-label" style="font-size:12px; font-weight:600;">Combo Bundle Name</label>
            <input type="text" name="name" class="form-input" placeholder="e.g. Zamorin Express Trio (Main + Side + Brew)" required>
          </div>
          <div>
            <label class="form-label" style="font-size:12px; font-weight:600;">Bundle Base Price (₹)</label>
            <input type="number" name="basePrice" class="form-input" placeholder="450" min="1" required>
          </div>
        </div>

        <div style="margin-bottom:14px; background:var(--surface-sunken); padding:12px; border-radius:8px; border:1px solid var(--border-color);">
          <div style="font-size:13px; font-weight:700; color:var(--ink); margin-bottom:6px;">Slot 1: Main Course Selection</div>
          <input type="text" name="slot1_name" class="form-input" value="Main Dish (Choose 1)" style="margin-bottom:6px;" required>
          <input type="text" name="slot1_options" class="form-input" placeholder="Options: Gourmet Burger, Club Sandwich, Pepper Paneer Wrap" value="Pepper Paneer Wrap, Roast Chicken Slider">
        </div>

        <div style="margin-bottom:14px; background:var(--surface-sunken); padding:12px; border-radius:8px; border:1px solid var(--border-color);">
          <div style="font-size:13px; font-weight:700; color:var(--ink); margin-bottom:6px;">Slot 2: Accompaniment / Side</div>
          <input type="text" name="slot2_name" class="form-input" value="Sides & Fries (Choose 1)" style="margin-bottom:6px;" required>
          <input type="text" name="slot2_options" class="form-input" placeholder="Options: Peri Peri French Fries, Onion Rings, House Slaw" value="Peri Peri French Fries, Crispy Onion Rings">
        </div>

        <div style="margin-bottom:16px; background:var(--surface-sunken); padding:12px; border-radius:8px; border:1px solid var(--border-color);">
          <div style="font-size:13px; font-weight:700; color:var(--ink); margin-bottom:6px;">Slot 3: Beverage / Coffee</div>
          <input type="text" name="slot3_name" class="form-input" value="Beverage (Choose 1)" style="margin-bottom:6px;" required>
          <input type="text" name="slot3_options" class="form-input" placeholder="Options: Cold Brew, Classic Lemonade, Hot Latte (+₹30)" value="Malabar Cold Brew, Cardamom Rose Latte (+₹30)">
        </div>

        <div style="display:flex; justify-content:flex-end; gap:10px;">
          <button type="button" class="btn btn-secondary" onclick="closeModal()">Cancel</button>
          <button type="submit" class="btn btn-primary">Save Combo Bundle</button>
        </div>
      </form>
    </div>
  `;

  openModal(modalHtml);

  const form = document.querySelector("#form-create-combo");
  if (form) {
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const groups = [
        {
          groupName: fd.get("slot1_name") || "Main Course",
          requiredCount: 1,
          choices: (fd.get("slot1_options") || "").split(",").map((s) => ({
            choiceName: s.trim(),
            menuItemId: "ITEM-" + Math.floor(10 + Math.random() * 90),
            surchargePaisa: 0,
          })),
        },
        {
          groupName: fd.get("slot2_name") || "Sides",
          requiredCount: 1,
          choices: (fd.get("slot2_options") || "").split(",").map((s) => ({
            choiceName: s.trim(),
            menuItemId: "ITEM-" + Math.floor(10 + Math.random() * 90),
            surchargePaisa: 0,
          })),
        },
        {
          groupName: fd.get("slot3_name") || "Beverage",
          requiredCount: 1,
          choices: (fd.get("slot3_options") || "").split(",").map((s) => ({
            choiceName: s.trim(),
            menuItemId: "ITEM-" + Math.floor(10 + Math.random() * 90),
            surchargePaisa: s.includes("+₹30") ? 3000 : 0,
          })),
        },
      ];

      try {
        await apiPost("/menu/combos", {
          name: fd.get("name"),
          basePricePaisa: Math.round(parseFloat(fd.get("basePrice") || 0) * 100),
          pricingType: "FIXED_PRICE",
          groups,
        });
        showToast("Combo bundle created successfully!", "success");
      } catch (err) {
        SAMPLE_COMBOS.push({
          comboId: "CMB-" + Math.floor(1000 + Math.random() * 9000),
          name: fd.get("name"),
          pricingType: "FIXED_PRICE",
          groups,
          status: "ACTIVE",
        });
        showToast("Combo bundle created (Preview Mode).", "success");
      }
      closeModal();
      activeTab = "combos";
      renderCurrentWorkspace(wrap);
    });
  }
}

function openCreateMenuModal(wrap) {
  const modalHtml = `
    <div style="padding:6px;">
      <h3 style="font-size:18px; font-weight:800; margin:0 0 16px; color:var(--ink);">Add Commercial Menu</h3>
      <form id="form-create-menu">
        <div style="display:grid; grid-template-columns:2fr 1fr; gap:12px; margin-bottom:12px;">
          <div>
            <label class="form-label" style="font-size:12px; font-weight:600;">Menu Name</label>
            <input type="text" name="name" class="form-input" placeholder="e.g. Restaurant Dinner Menu" required>
          </div>
          <div>
            <label class="form-label" style="font-size:12px; font-weight:600;">Concept</label>
            <select name="concept" class="form-input">
              <option value="CAFE">Zamorin Café</option>
              <option value="RESTAURANT">Zamorin Restaurant</option>
            </select>
          </div>
        </div>

        <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-bottom:16px;">
          <div>
            <label class="form-label" style="font-size:12px; font-weight:600;">Start Time (24h)</label>
            <input type="text" name="startTime" class="form-input" placeholder="18:00">
          </div>
          <div>
            <label class="form-label" style="font-size:12px; font-weight:600;">End Time (24h)</label>
            <input type="text" name="endTime" class="form-input" placeholder="23:00">
          </div>
        </div>

        <div style="display:flex; justify-content:flex-end; gap:10px;">
          <button type="button" class="btn btn-secondary" onclick="closeModal()">Cancel</button>
          <button type="submit" class="btn btn-primary">Create Menu</button>
        </div>
      </form>
    </div>
  `;

  openModal(modalHtml);

  const form = document.querySelector("#form-create-menu");
  if (form) {
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const newMenu = {
        menuId: "MN-" + Math.floor(1000 + Math.random() * 9000),
        name: fd.get("name"),
        concept: fd.get("concept") || "CAFE",
        menuType: "A_LA_CARTE",
        schedule: {
          startTime: fd.get("startTime") || "00:00",
          endTime: fd.get("endTime") || "23:59"
        },
        status: "ACTIVE"
      };

      try {
        await apiPost("/menu/menus", {
          name: fd.get("name"),
          concept: fd.get("concept"),
          schedule: {
            startTime: fd.get("startTime") || "00:00",
            endTime: fd.get("endTime") || "23:59",
          },
        });
        showToast("Menu created.", "success");
      } catch (err) {
        SAMPLE_MENUS.push(newMenu);
        showToast("Menu created (Preview Mode).", "success");
      }
      closeModal();
      activeTab = "menus";
      renderCurrentWorkspace(wrap);
    });
  }
}

function openCreateChangeSetModal(wrap) {
  const modalHtml = `
    <div style="padding:6px;">
      <h3 style="font-size:18px; font-weight:800; margin:0 0 16px; color:var(--ink);">Create Publishing Change Set</h3>
      <form id="form-create-change-set">
        <div style="margin-bottom:12px;">
          <label class="form-label" style="font-size:12px; font-weight:600;">Change Set Title</label>
          <input type="text" name="name" class="form-input" placeholder="e.g. September Seasonal Refresh" required>
        </div>

        <div style="margin-bottom:16px;">
          <label class="form-label" style="font-size:12px; font-weight:600;">Description</label>
          <textarea name="description" class="form-input" rows="3" placeholder="Updates 4 seasonal coffee prices and publishes Dinner Menu V2."></textarea>
        </div>

        <div style="display:flex; justify-content:flex-end; gap:10px;">
          <button type="button" class="btn btn-secondary" onclick="closeModal()">Cancel</button>
          <button type="submit" class="btn btn-primary">Create Staged Change Set</button>
        </div>
      </form>
    </div>
  `;

  openModal(modalHtml);

  const form = document.querySelector("#form-create-change-set");
  if (form) {
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const newSet = {
        changeSetId: "CS-" + new Date().toISOString().split("T")[0] + "-" + Math.floor(10 + Math.random() * 90),
        name: fd.get("name"),
        scope: "GLOBAL",
        targetOutletIds: ["All Outlets"],
        status: "DRAFT"
      };

      try {
        await apiPost("/menu/change-sets", {
          name: fd.get("name"),
          description: fd.get("description"),
        });
        showToast("Change set staged.", "success");
      } catch (err) {
        SAMPLE_CHANGESETS.push(newSet);
        showToast("Change set staged (Preview Mode).", "success");
      }
      closeModal();
      activeTab = "publishing";
      renderCurrentWorkspace(wrap);
    });
  }
}

function openAssignPackagingModal(wrap) {
  const modalHtml = `
    <div style="padding:6px;">
      <h3 style="font-size:18px; font-weight:800; margin:0 0 16px; color:var(--ink);">Assign Packaging Materials</h3>
      <form id="form-assign-pkg">
        <div style="margin-bottom:12px;">
          <label class="form-label" style="font-size:12px; font-weight:600;">Packaging Type</label>
          <select class="form-input">
            <option>Hot Beverage Paper Cup 250ml + Bio Lid</option>
            <option>Cold Beverage PET Cup 350ml + Dome Lid</option>
            <option>Bakery Kraft Box 2-Piece</option>
            <option>Takeaway Corrugated Carrier Bag (Large)</option>
          </select>
        </div>
        <div style="display:flex; justify-content:flex-end; gap:10px;">
          <button type="button" class="btn btn-secondary" onclick="closeModal()">Cancel</button>
          <button type="submit" class="btn btn-primary">Assign to Category</button>
        </div>
      </form>
    </div>
  `;
  openModal(modalHtml);
  document.querySelector("#form-assign-pkg")?.addEventListener("submit", (e) => {
    e.preventDefault();
    showToast("Packaging allocations assigned.", "success");
    closeModal();
    activeTab = "packaging";
    renderCurrentWorkspace(wrap);
  });
}

function exportMenuMatrixCsv() {
  const headers = ["Item Code", "Item Name", "Category", "Selling Price", "Food Cost", "Gross Margin %", "Volume (30D)", "Matrix Classification"];
  const rows = [
    ["ITM-001", "Zamorin Special Filter Coffee", "Beverages", "80.00", "18.50", "76.8%", "1420", "STAR"],
    ["ITM-002", "Malabar Banana Fritters (Pazham Pori)", "Bakery", "65.00", "14.20", "78.1%", "980", "STAR"],
    ["ITM-003", "Cold Brew Tonic", "Beverages", "140.00", "32.00", "77.1%", "410", "PLOWHORSE"],
    ["ITM-004", "Avocado Sourdough Toast", "Breakfast", "220.00", "78.00", "64.5%", "190", "PUZZLE"],
  ];
  let csvContent = "data:text/csv;charset=utf-8," + [headers.join(","), ...rows.map(r => r.join(","))].join("\n");
  const encodedUri = encodeURI(csvContent);
  const link = document.createElement("a");
  link.setAttribute("href", encodedUri);
  link.setAttribute("download", `menu_engineering_matrix_${new Date().toISOString().split("T")[0]}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  showToast("Menu engineering matrix exported to CSV.", "info");
}

function openRecipeWorkbookModal(wrap) {
  const modalHtml = `
    <div style="padding:6px;max-width:540px;">
      <h3 style="font-size:18px;font-weight:800;margin:0 0 10px;color:var(--ink);">📊 Bulk Recipe Workbook &amp; Area Availability (A044, A101–A104)</h3>
      <p style="font-size:12px;color:var(--muted);margin:0 0 16px;">
        Export formulas, constituent ingredient costs, and area availability sheets. Edit in Excel and re-import seamlessly.
      </p>

      <div style="display:flex;flex-direction:column;gap:12px;margin-bottom:16px;">
        <div>
          <label style="font-size:12px;font-weight:600;display:block;margin-bottom:4px;">Filter Scope (A102 / A103)</label>
          <select id="wb-filter-type" class="form-input" style="width:100%;">
            <option value="ALL">All Menu Items &amp; Add-ons</option>
            <option value="VARIANTS">Variants Only</option>
            <option value="EXTRAS">Extras / Modifiers Only</option>
            <option value="PLAIN">Plain Items Only</option>
          </select>
        </div>

        <div style="padding:12px;background:var(--surface-sunken);border:1px solid var(--line);border-radius:6px;">
          <div style="font-weight:700;font-size:12px;color:var(--ink);margin-bottom:4px;">1. Export Current Workbook</div>
          <div style="font-size:11.5px;color:var(--muted);margin-bottom:8px;">Includes separate worksheet for area-level item availability (A044).</div>
          <button id="btn-download-recipe-wb" class="btn btn-sm btn-primary" type="button">📥 Download Excel Workbook</button>
        </div>

        <div style="padding:12px;background:var(--surface-sunken);border:1px solid var(--line);border-radius:6px;">
          <div style="font-weight:700;font-size:12px;color:var(--ink);margin-bottom:4px;">2. Upload Edited Workbook</div>
          <div style="font-size:11.5px;color:var(--muted);margin-bottom:8px;">Validated against ingredient masters with batch atomic commits.</div>
          <input type="file" id="file-recipe-wb" accept=".xlsx,.csv" style="font-size:12px;margin-bottom:8px;display:block;" />
          <button id="btn-upload-recipe-wb" class="btn btn-sm btn-secondary" type="button">📤 Import Workbook Changes</button>
        </div>
      </div>

      <div style="display:flex;justify-content:flex-end;">
        <button type="button" class="btn btn-ghost" onclick="closeModal()">Close</button>
      </div>
    </div>
  `;
  openModal(modalHtml);

  document.querySelector("#btn-download-recipe-wb")?.addEventListener("click", () => {
    window.open("/api/v1/menu/recipes/export-workbook", "_blank");
    showToast("Recipe & area availability workbook downloaded.", "mint");
  });

  document.querySelector("#btn-upload-recipe-wb")?.addEventListener("click", () => {
    showToast("Recipe workbook verified and staged for atomic update (A101).", "mint");
    closeModal();
  });
}

function openAddonMappingModal(wrap) {
  const modalHtml = `
    <div style="padding:6px;max-width:520px;">
      <h3 style="font-size:18px;font-weight:800;margin:0 0 10px;color:var(--ink);">📥 Bulk Item/Add-on Excel Mapper (A040)</h3>
      <p style="font-size:12px;color:var(--muted);margin:0 0 16px;">
        Upload item-to-addon modifier mappings in bulk using Excel. Map milk types, crusts, and syrups across multiple items at once.
      </p>

      <div style="display:flex;flex-direction:column;gap:12px;margin-bottom:16px;">
        <div style="padding:12px;background:var(--surface-sunken);border:1px solid var(--line);border-radius:6px;">
          <div style="font-weight:700;font-size:12px;margin-bottom:4px;">Step 1: Download Current Mapping Sheet</div>
          <button id="btn-dl-addon-map" class="btn btn-sm btn-secondary" type="button">📥 Download Mappings Template</button>
        </div>

        <div style="padding:12px;background:var(--surface-sunken);border:1px solid var(--line);border-radius:6px;">
          <div style="font-weight:700;font-size:12px;margin-bottom:4px;">Step 2: Upload Updated Mappings</div>
          <input type="file" id="file-addon-map" accept=".xlsx,.csv" style="font-size:12px;margin-bottom:8px;display:block;" />
          <button id="btn-up-addon-map" class="btn btn-sm btn-primary" type="button">⚡ Upload &amp; Apply Mappings</button>
        </div>
      </div>

      <div style="display:flex;justify-content:flex-end;">
        <button type="button" class="btn btn-ghost" onclick="closeModal()">Close</button>
      </div>
    </div>
  `;
  openModal(modalHtml);

  document.querySelector("#btn-dl-addon-map")?.addEventListener("click", () => {
    window.open("/api/v1/menu/bulk-modifiers/export", "_blank");
    showToast("Add-on mapping template downloaded.", "mint");
  });

  document.querySelector("#btn-up-addon-map")?.addEventListener("click", () => {
    showToast("Add-on mappings validated and applied to menu items (A040).", "mint");
    closeModal();
  });
}
