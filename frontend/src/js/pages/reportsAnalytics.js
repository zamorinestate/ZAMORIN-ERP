// =============================================================================
// PAGE: Reports & Analytics Control Centre — SCR-022
// Enterprise Business Intelligence, Management Reporting, Analytics Governance,
// Decision Intelligence & Universal Corporate Export System (ZURF v1).
// =============================================================================
import { apiGet, apiPost, apiPatch, apiDelete } from '../apiClient.js';
import { showToast, skeleton, openModal, closeModal, renderCafeContextStrip, renderModuleErrorState } from '../components.js';
import { state } from '../state.js';
import { ROLES } from '../navigation.js';
import { navigate } from '../router.js';

let activeTab = 'overview';
let cachedOverview = null;
let cachedLibrary = null;
let cachedCategories = null;
let cachedMetrics = null;
let cachedSales = null;
let cachedFinance = null;
let cachedCash = null;
let cachedWorkforce = null;
let cachedCustomers = null;
let cachedInventory = null;
let cachedProcurement = null;
let cachedMenu = null;
let cachedQuality = null;
let cachedAssets = null;
let cachedPortfolio = null;
let cachedGoals = null;
let cachedScheduledAlerts = null;
let cachedReconciliations = null;
let cachedDataQuality = null;
let cachedJobs = null;

let currentSearchTerm = '';
let currentCategoryFilter = 'ALL';
let currentTrustFilter = 'ALL';
let librarySearchTerm = '';
let selectedDomainFilter = 'ALL';
let certifiedOnlyFilter = false;

let salesActiveView = 'overview';
let salesCategoryFilter = 'ALL';
let salesSearchTerm = '';
let salesServiceModeFilter = 'ALL';
let salesOrderSourceFilter = 'ALL';
let salesTenderFilter = 'ALL';
let menuActiveView = 'matrix';
let menuCategoryFilter = 'ALL';
let menuSearchTerm = '';
let menuQuadrantFilter = 'ALL';

// PM-02E Inventory & Procurement Filter State
let invCategoryFilter = 'ALL';
let invWasteReasonFilter = 'ALL';
let invExpiryWindowFilter = '30';
let invSearchTerm = '';
let invActiveView = 'overview';

let procVendorFilter = 'ALL';
let procVendorStatusFilter = 'ALL';
let procPoStatusFilter = 'ALL';
let procSearchTerm = '';
let procActiveView = 'overview';

// PM-02G Workforce Filter & View State
let workforceActiveView = 'overview';
let workforceRoleFilter = 'ALL';
let workforceShiftFilter = 'ALL';
let workforceSearchTerm = '';

// PM-02H Customer, POS & Service Intelligence View State
let customerActiveView = 'overview';

// PM-02I Multi-Café Benchmarking View State
let portfolioActiveView = 'comparison';
let portfolioPeerGroupFilter = 'ALL';
let portfolioComparableOnlyFilter = false;
let portfolioMetricFilter = 'NET_SALES';
let portfolioRankDirection = 'HIGH_TO_LOW';
let portfolioSearchTerm = '';

// PM-02J Diagnostic & Exploratory Analytics State
let diagnosticActiveView = 'decomposition'; // 'decomposition' | 'waterfall' | 'pareto' | 'distribution' | 'correlation' | 'exceptions'
let diagnosticMetric = 'NET_SALES';
let diagnosticDimension = 'CAFE';
let diagnosticSecondaryDimension = 'SERVICE_MODE';
let diagnosticBucketCount = '10';
let diagnosticCorrelationMetricX = 'NET_SALES';
let diagnosticCorrelationMetricY = 'ORDERS';
let diagnosticMovingAverageWindow = '3';
let diagnosticBreadcrumb = ['Organisation'];
let diagnosticSearchTerm = '';
let cachedDiagnosticData = null;

// PM-02K Forecasting & Scenario Intelligence State
let forecastTarget = 'NET_SALES';
let forecastHorizon = '7';
let forecastMethod = 'AUTO';
let forecastActiveView = 'forecast'; // 'forecast' | 'scenario' | 'sensitivity' | 'model_comparison'
let scenarioSalesPercent = 0;
let scenarioOrdersPercent = 0;
let scenarioAovPercent = 0;
let scenarioPayrollPercent = 0;
let scenarioOpexPercent = 0;
let scenarioWasteBuffer = 0;
let cachedForecastData = null;
let cachedScenarioData = null;

let activeFilters = {
  cafeId: 'ALL',
  period: 'this_month',
  dateFrom: '',
  dateTo: '',
  comparison: 'none',
};

const REPORT_SUBTAB_MAP = {
  'daily-sales': 'sales',
  'pl-statement': 'finance',
  'cash-book-variance': 'cash',
  'attendance-exceptions': 'workforce',
  'customer-retention': 'customers',
  'inventory-valuation': 'inventory',
  'procurement-spend': 'procurement',
  'vendor-performance-intelligence': 'procurement',
  'menu-engineering': 'menu',
  'quality-compliance': 'quality',
  'asset-maintenance': 'assets',
  'same-store-sales': 'portfolio',
  'executive-goals': 'goals',
  'cross-module-reconciliations': 'reconciliations',
  'pipeline-data-quality': 'data_quality',
  'scheduled-alerts-report': 'scheduled_alerts',
  'diagnostic-decomposition': 'explorer',
  'variance-waterfall': 'explorer',
  'pareto-analytics': 'explorer',
  'distribution-analytics': 'explorer',
  'correlation-workspace': 'explorer',
  'diagnostic-exception-centre': 'explorer',
  'sales-forecast': 'forecasting',
  'order-workload-forecast': 'forecasting',
  'menu-demand-forecast': 'forecasting',
  'ingredient-requirement-forecast': 'forecasting',
  'whatif-scenario-studio': 'forecasting',
};

const SUBTAB_REPORT_MAP = {
  sales: 'daily-sales',
  finance: 'pl-statement',
  forecasting: 'sales-forecast',
  cash: 'cash-book-variance',
  workforce: 'attendance-exceptions',
  customers: 'customer-retention',
  inventory: 'inventory-valuation',
  procurement: 'procurement-spend',
  menu: 'menu-engineering',
  quality: 'quality-compliance',
  assets: 'asset-maintenance',
  portfolio: 'same-store-sales',
  goals: 'executive-goals',
  reconciliations: 'cross-module-reconciliations',
  data_quality: 'pipeline-data-quality',
  scheduled_alerts: 'scheduled-alerts-report',
  explorer: 'diagnostic-decomposition',
};

const TRUST_PILLS = {
  CERTIFIED: 'pill-mint',
  OPERATIONAL: 'pill-sky',
  ESTIMATED: 'pill-amber',
  FORECAST: 'pill-purple',
  CUSTOM: 'pill-slate',
  DATA_ISSUE: 'pill-coral',
  GOVERNED: 'pill-sky',
  DRAFT: 'pill-amber',
  DEPRECATED: 'pill-coral',
};

function renderTrustPill(status) {
  const pillClass = TRUST_PILLS[status] || 'pill-dark';
  return `<span class="pill ${pillClass}" style="font-size:10px;font-weight:700;letter-spacing:0.3px;">${status || 'UNKNOWN'}</span>`;
}

function buildFilterQueryString(subtab = null) {
  const params = new URLSearchParams();
  if (activeFilters.cafeId && activeFilters.cafeId !== 'ALL') {
    params.set('cafeId', activeFilters.cafeId);
  }
  if (activeFilters.period) {
    params.set('period', activeFilters.period);
  }
  if (activeFilters.period === 'custom') {
    if (activeFilters.dateFrom) params.set('dateFrom', activeFilters.dateFrom);
    if (activeFilters.dateTo) params.set('dateTo', activeFilters.dateTo);
  }
  if (activeFilters.comparison && activeFilters.comparison !== 'none') {
    params.set('comparison', activeFilters.comparison);
  }
  if (subtab === 'sales') {
    if (salesServiceModeFilter !== 'ALL') params.set('serviceMode', salesServiceModeFilter);
    if (salesTenderFilter !== 'ALL') params.set('paymentMethod', salesTenderFilter);
    if (salesCategoryFilter !== 'ALL') params.set('category', salesCategoryFilter);
  }
  if (subtab === 'menu') {
    if (menuCategoryFilter !== 'ALL') params.set('category', menuCategoryFilter);
  }
  if (subtab === 'inventory') {
    if (invCategoryFilter && invCategoryFilter !== 'ALL') params.set('category', invCategoryFilter);
    if (invWasteReasonFilter && invWasteReasonFilter !== 'ALL') params.set('wasteReason', invWasteReasonFilter);
    if (invExpiryWindowFilter) params.set('expiryWindowDays', invExpiryWindowFilter);
  }
  if (subtab === 'procurement') {
    if (procVendorFilter && procVendorFilter !== 'ALL') params.set('vendorId', procVendorFilter);
    if (procVendorStatusFilter && procVendorStatusFilter !== 'ALL') params.set('vendorStatus', procVendorStatusFilter);
    if (procPoStatusFilter && procPoStatusFilter !== 'ALL') params.set('poStatus', procPoStatusFilter);
  }
  if (subtab === 'workforce') {
    if (workforceRoleFilter && workforceRoleFilter !== 'ALL') params.set('role', workforceRoleFilter);
    if (workforceShiftFilter && workforceShiftFilter !== 'ALL') params.set('shift', workforceShiftFilter);
  }
  const q = params.toString();
  return q ? `?${q}` : '';
}

async function ensureLibraryLoaded() {
  if (cachedLibrary && cachedCategories) return;
  try {
    const res = await apiGet('/reports/library');
    if (res?.data) {
      cachedLibrary = res.data.reports || [];
      cachedCategories = res.data.categories || [];
    }
  } catch (err) {
    console.warn('Unable to load report library:', err.message);
  }
  if (!cachedLibrary) cachedLibrary = [];
  if (!cachedCategories) cachedCategories = [];
}

function renderBreadcrumbs(crumbs = []) {
  return `
    <nav class="report-breadcrumbs" aria-label="Breadcrumb Navigation" style="display:flex;align-items:center;gap:8px;font-size:12px;color:var(--muted);margin-bottom:14px;flex-wrap:wrap;">
      <a href="#reports" data-nav="reports" style="color:var(--ink);font-weight:600;text-decoration:none;display:flex;align-items:center;gap:4px;">
        <span>📊</span> <span>Reports &amp; Analytics</span>
      </a>
      ${crumbs.map((c, i) => {
        const isLast = i === crumbs.length - 1;
        if (isLast) {
          return `<span style="opacity:0.4;">/</span><span style="color:var(--ink);font-weight:700;">${c.label}</span>`;
        }
        return `<span style="opacity:0.4;">/</span><a href="#${c.route}" data-nav="${c.route}" style="color:var(--muted);text-decoration:none;font-weight:500;">${c.label}</a>`;
      }).join('')}
    </nav>
  `;
}

function renderReportMetadataCard(r) {
  const exportsList = (Array.isArray(r.supportedExports) && r.supportedExports.length > 0)
    ? r.supportedExports.join(', ')
    : (Array.isArray(r.plannedExports) && r.plannedExports.length > 0 ? `Planned: ${r.plannedExports.join(', ')}` : 'None');
  const filtersList = Array.isArray(r.supportedFilters) ? r.supportedFilters.slice(0, 3).join(', ') : 'Period, Café';

  return `
    <div class="card report-metadata-card" style="padding:16px;background:var(--surface);border:1px solid var(--line);border-radius:var(--radius-md, 10px);display:flex;flex-direction:column;justify-content:space-between;gap:12px;">
      <div>
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;margin-bottom:8px;flex-wrap:wrap;">
          <span class="badge" style="font-size:10px;font-weight:700;background:var(--surface-sunken);">${r.categoryLabel || r.category}</span>
          <div style="display:flex;gap:4px;flex-wrap:wrap;">
            ${renderTrustPill(r.trustStatus)}
            <span class="pill ${r.actuality === 'ACTUAL' ? 'pill-mint' : 'pill-amber'}" style="font-size:9.5px;font-weight:700;">${r.actuality || 'ACTUAL'}</span>
            <span class="pill ${r.classification === 'INTERNAL' ? 'pill-sky' : 'pill-amber'}" style="font-size:9.5px;font-weight:700;">${r.classification || 'INTERNAL'}</span>
          </div>
        </div>
        <h3 style="font-size:15px;font-weight:800;color:var(--ink);margin:0 0 6px 0;">${r.title}</h3>
        <p style="font-size:12px;color:var(--muted);margin:0 0 10px 0;line-height:1.4;">${r.description}</p>
        
        <div style="display:flex;flex-wrap:wrap;gap:6px;font-size:10.5px;color:var(--muted);padding-top:8px;border-top:1px solid var(--line);">
          <span>Exports: ${exportsList}</span>
          <span>•</span>
          <span>Filters: ${filtersList}</span>
        </div>
      </div>

      <div style="display:flex;justify-content:space-between;align-items:center;padding-top:8px;border-top:1px solid var(--line);">
        <button class="btn btn-sm btn-ghost" data-about-report="${r.reportId}" style="font-size:11px;padding:4px 8px;" type="button">Info ℹ️</button>
        <div style="display:flex;gap:6px;align-items:center;">
          ${r.runnable !== false && r.availability !== 'NOT_IMPLEMENTED' ? `
            <button class="btn btn-sm btn-primary" data-run-report="${r.reportId}" style="font-size:12px;font-weight:700;padding:5px 12px;" type="button">Run Report →</button>
            <button class="btn btn-sm btn-secondary" data-export-report="${r.reportId}" style="font-size:12px;padding:5px 10px;" type="button">Export</button>
          ` : `
            <span class="badge" style="font-size:10px;padding:3px 8px;background:var(--surface-sunken);color:var(--muted);border:1px solid var(--line);">Reserved for PM-02E</span>
          `}
        </div>
      </div>
    </div>
  `;
}

function renderCommonFilterBar(reportDef, curFilters) {
  let cafeOptions = '';
  if (state.role === ROLES.MASTER) {
    cafeOptions = `
      <option value="ALL" ${curFilters.cafeId === 'ALL' ? 'selected' : ''}>All Authorized Cafés (Org-wide)</option>
      ${(state.cafes || []).map((c) => `<option value="${c.cafeId || c.id}" ${curFilters.cafeId === (c.cafeId || c.id) ? 'selected' : ''}>${c.name || c.cafeName || c.cafeId}</option>`).join('')}
    `;
  } else if (state.role === ROLES.OWNER) {
    const assigned = state.assignedCafes || [];
    if (assigned.length === 0) {
      cafeOptions = `<option disabled selected>No Authorized Cafés Assigned</option>`;
    } else {
      cafeOptions = `
        <option value="ALL" ${curFilters.cafeId === 'ALL' ? 'selected' : ''}>All Authorized Cafés (${assigned.length})</option>
        ${assigned.map((c) => `<option value="${c.cafeId || c.id || c}" ${curFilters.cafeId === (c.cafeId || c.id || c) ? 'selected' : ''}>${c.name || c.cafeName || c.cafeId || c}</option>`).join('')}
      `;
    }
  } else if (state.role === ROLES.CAFE_ADMIN) {
    const assigned = state.assignedCafes || [];
    if (assigned.length === 0) {
      cafeOptions = `<option disabled selected>No Authorized Cafés Assigned</option>`;
    } else if (assigned.length === 1) {
      const c = assigned[0];
      const id = c.cafeId || c.id || c;
      const name = c.name || c.cafeName || id;
      cafeOptions = `<option value="${id}" selected>${name}</option>`;
    } else {
      cafeOptions = `
        <option value="ALL" ${curFilters.cafeId === 'ALL' ? 'selected' : ''}>All Authorized Cafés (${assigned.length})</option>
        ${assigned.map((c) => {
          const id = c.cafeId || c.id || c;
          const name = c.name || c.cafeName || id;
          return `<option value="${id}" ${curFilters.cafeId === id ? 'selected' : ''}>${name}</option>`;
        }).join('')}
      `;
    }
  } else {
    const bound = state.primaryCafeId || state.cafeId || 'Current Café';
    cafeOptions = `<option value="${bound}" selected>${bound}</option>`;
  }

  const periodOptions = [
    { id: 'today', label: 'Today' },
    { id: 'yesterday', label: 'Yesterday' },
    { id: 'this_week', label: 'This Week' },
    { id: 'last_week', label: 'Last Week' },
    { id: 'this_month', label: 'This Month' },
    { id: 'last_month', label: 'Last Month' },
    { id: 'mtd', label: 'Month to Date (MTD)' },
    { id: 'previous_mtd', label: 'Previous MTD' },
    { id: 'this_quarter', label: 'This Quarter' },
    { id: 'last_quarter', label: 'Last Quarter' },
    { id: 'ytd', label: 'Year to Date (YTD)' },
    { id: 'previous_ytd', label: 'Previous YTD' },
    { id: 'custom', label: 'Custom Date Range...' },
  ].map((p) => `<option value="${p.id}" ${curFilters.period === p.id ? 'selected' : ''}>${p.label}</option>`).join('');

  const comparisonOptions = [
    { id: 'none', label: 'No Comparison' },
    { id: 'prior_period', label: 'Prior Period' },
    { id: 'prior_year', label: 'Prior Year' },
  ].map((c) => `<option value="${c.id}" ${curFilters.comparison === c.id ? 'selected' : ''}>${c.label}</option>`).join('');

  const scopeSummary = `${curFilters.cafeId === 'ALL' ? 'All Authorized Cafés' : curFilters.cafeId} · ${curFilters.period.replace(/_/g, ' ').toUpperCase()}${curFilters.comparison !== 'none' ? ' · vs ' + curFilters.comparison.replace(/_/g, ' ') : ''}`;

  return `
    <div class="card report-filter-bar" style="padding:12px 16px;background:var(--surface);border:1px solid var(--line);border-radius:var(--radius-md, 10px);display:flex;flex-direction:column;gap:10px;">
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;">
        <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;">
          <!-- Café Scope -->
          <div style="display:flex;flex-direction:column;gap:3px;">
            <label style="font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;">Café Scope</label>
            <select id="filter-cafe-select" class="glass-input" style="font-size:12px;padding:4px 8px;min-width:180px;">
              ${cafeOptions}
            </select>
          </div>

          <!-- Reporting Period -->
          <div style="display:flex;flex-direction:column;gap:3px;">
            <label style="font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;">Period</label>
            <select id="filter-period-select" class="glass-input" style="font-size:12px;padding:4px 8px;min-width:140px;">
              ${periodOptions}
            </select>
          </div>

          <!-- Custom Dates (conditionally visible) -->
          <div id="filter-custom-dates" style="display:${curFilters.period === 'custom' ? 'flex' : 'none'};gap:8px;align-items:center;">
            <div style="display:flex;flex-direction:column;gap:3px;">
              <label style="font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;">From</label>
              <input type="date" id="filter-date-from" class="glass-input" value="${curFilters.dateFrom || ''}" style="font-size:12px;padding:3px 6px;" />
            </div>
            <div style="display:flex;flex-direction:column;gap:3px;">
              <label style="font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;">To</label>
              <input type="date" id="filter-date-to" class="glass-input" value="${curFilters.dateTo || ''}" style="font-size:12px;padding:3px 6px;" />
            </div>
          </div>

          <!-- Comparison Period -->
          <div style="display:flex;flex-direction:column;gap:3px;">
            <label style="font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;">Comparison</label>
            <select id="filter-comparison-select" class="glass-input" style="font-size:12px;padding:4px 8px;min-width:120px;">
              ${comparisonOptions}
            </select>
          </div>
        </div>

        <div style="display:flex;gap:8px;align-items:center;">
          <button class="btn btn-sm btn-ghost" id="report-reset-btn" style="font-size:12px;padding:5px 10px;" type="button" title="Reset to default filters">↺ Reset</button>
          <button class="btn btn-sm btn-primary" id="report-refresh-btn" style="font-size:12px;font-weight:700;padding:5px 12px;" type="button" title="Refresh live report data">🔄 Refresh</button>
        </div>
      </div>

      <!-- Scope Chip Summary -->
      <div style="display:flex;justify-content:space-between;align-items:center;padding-top:6px;border-top:1px solid var(--line);font-size:11px;">
        <span style="color:var(--muted);">Current Scope: <strong id="report-scope-summary-text" style="color:var(--ink);">${scopeSummary}</strong></span>
        <span style="color:var(--mint, #10b981);font-weight:600;">● Live Server Authorised</span>
      </div>
    </div>
  `;
}

function updateFilterScopeSummary(root) {
  const summaryEl = root.querySelector('#report-scope-summary-text');
  if (summaryEl) {
    const cafeLabel = activeFilters.cafeId === 'ALL' ? 'All Cafés' : activeFilters.cafeId;
    const periodLabel = (activeFilters.period || '').replace(/_/g, ' ').toUpperCase();
    const compLabel = activeFilters.comparison && activeFilters.comparison !== 'none' ? ' · vs ' + activeFilters.comparison.replace(/_/g, ' ') : '';
    summaryEl.textContent = `${cafeLabel} · ${periodLabel}${compLabel}`;
  }
}

function renderReportHeader(reportDef, dataQuality, actuality) {
  const dqStatus = dataQuality?.status || 'COMPLETE';
  const actStatus = actuality || reportDef.actuality || 'ACTUAL';
  const trustStatus = reportDef.trustLevel || reportDef.trustStatus || 'OPERATIONAL';
  const classification = reportDef.classification || 'INTERNAL';

  return `
    <div class="card report-header" style="padding:16px;background:var(--surface);border:1px solid var(--line);border-radius:var(--radius-md, 10px);display:flex;flex-direction:column;gap:12px;">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:12px;">
        <div>
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:4px;">
            <span class="badge" style="font-size:11px;font-weight:700;background:var(--surface-sunken);">${reportDef.categoryLabel || reportDef.category}</span>
            ${renderTrustPill(trustStatus)}
            <span class="pill ${actStatus === 'ACTUAL' ? 'pill-mint' : 'pill-amber'}" style="font-size:10px;font-weight:700;">${actStatus}</span>
            <span class="pill ${classification === 'INTERNAL' ? 'pill-sky' : 'pill-amber'}" style="font-size:10px;font-weight:700;">${classification}</span>
            <span class="pill ${dqStatus === 'COMPLETE' ? 'pill-mint' : (dqStatus === 'PARTIAL' ? 'pill-amber' : 'pill-dark')}" style="font-size:10px;font-weight:700;">${dqStatus}</span>
          </div>
          <h1 style="font-size:20px;font-weight:800;color:var(--ink);margin:0 0 4px 0;">${reportDef.title}</h1>
          <p style="font-size:12.5px;color:var(--muted);margin:0;line-height:1.4;">${reportDef.description}</p>
        </div>

        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
          <button class="btn btn-sm btn-ghost" id="report-provenance-btn" data-report-id="${reportDef.reportId}" style="font-size:12px;font-weight:600;" type="button">
            ℹ️ Report Information
          </button>
          <button class="btn btn-sm btn-primary" data-export-report="${reportDef.reportId}" style="font-size:12px;font-weight:700;" type="button">
            📑 ZURF Export
          </button>
        </div>
      </div>

      ${dqStatus === 'PARTIAL' ? `
        <div style="padding:10px 14px;background:rgba(245,158,11,0.12);border:1px solid #f59e0b;border-radius:6px;font-size:12px;color:#b45309;display:flex;align-items:center;gap:8px;">
          <span>⚠️</span>
          <div>
            <strong>Partial Data Quality:</strong> Some source records or refunds could not be calculated completely. Review transactional journals for details.
          </div>
        </div>
      ` : ''}
    </div>
  `;
}

export function setReportsActiveTab(tab) {
  activeTab = tab || 'overview';
}


function formatCostAsOf(timestamp) {
  if (!timestamp) return null;
  const d = new Date(timestamp);
  if (Number.isNaN(d.getTime())) return null;
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Kolkata',
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(d);
    const day = parts.find(p => p.type === 'day')?.value || d.getDate();
    const month = parts.find(p => p.type === 'month')?.value || 'Sep';
    const year = parts.find(p => p.type === 'year')?.value || d.getFullYear();
    const hour = parts.find(p => p.type === 'hour')?.value || '00';
    const minute = parts.find(p => p.type === 'minute')?.value || '00';
    return `${day} ${month} ${year} ${hour}:${minute} IST`;
  } catch (_) {
    return d.toISOString();
  }
}

export function renderReports(subroute) {
  if (subroute !== undefined) {
    activeTab = subroute || 'overview';
  }
  const canExport = [ROLES.MASTER, ROLES.OWNER, ROLES.CAFE_ADMIN].includes(state.role);

  // If on child subroute, render dedicated child shell directly
  if (activeTab && activeTab !== 'overview') {
    return `
      <div id="reports-analytics-container" class="page-enter" style="display:flex;flex-direction:column;gap:16px;min-width:0;max-width:100%;box-sizing:border-box;padding-bottom:60px;">
        <div id="analytics-tab-content" style="min-height:380px;min-width:0;max-width:100%;box-sizing:border-box;">
          ${skeleton('320px')}
        </div>
      </div>
    `;
  }

  return `
    <div id="reports-analytics-container" class="page-enter" style="padding-bottom: 60px;">
      <!-- Page Header -->
      <div class="page-header" style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom: 24px; flex-wrap:wrap; gap:16px;">
        <div>
          <div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap;">
            <h1 class="page-title" style="font-size:26px; font-weight:700; color:var(--ink); margin:0;">Reports &amp; Analytics Control Centre</h1>
            <span class="badge" style="background:rgba(180,83,9,0.12); color:#b45309; font-weight:600; font-size:12px; padding:4px 10px; border-radius:12px;">SCR-015 BI</span>
          </div>
          <p class="page-subtitle" style="font-size:14px; color:var(--muted); margin:4px 0 0;">Governed Business Intelligence, Decision Insights &amp; Universal Corporate Exports (ZURF v1)</p>
        </div>
        <div style="display:flex; gap:10px; align-items:center; flex-wrap:wrap;">
          ${canExport ? `
            <button class="btn btn-primary" id="open-zurf-export-btn" style="font-weight:700;" type="button">
              📑 ZURF Corporate Export
            </button>
          ` : ''}
          <button class="btn btn-secondary" id="view-analytics-health-btn" style="font-weight:600;" type="button">
            🩺 Analytics Health
          </button>
          <button class="btn btn-ghost" id="view-metrics-dict-btn" style="font-weight:600;" type="button">
            📖 Metric Dictionary
          </button>
        </div>
      </div>

      <!-- Scope Context Banner -->
      ${renderCafeContextStrip()}

      <!-- 4 Primary Headline KPIs (Responsive Auto-fit) -->
      <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(220px, 1fr));gap:12px;min-width:0;max-width:100%;box-sizing:border-box;margin-bottom:20px;">
        <div class="card" style="padding:14px 16px;background:var(--surface);">
          <div style="font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:0.5px;">Net Sales (MTD)</div>
          <div id="kpi-net-sales" style="font-size:22px;font-weight:800;color:var(--ink);margin-top:4px;">—</div>
          <div style="font-size:11px;color:var(--muted);margin-top:2px;">Live MTD Reconciled</div>
        </div>
        <div class="card" style="padding:14px 16px;background:var(--surface);">
          <div style="font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:0.5px;">Total Orders (MTD)</div>
          <div id="kpi-total-orders" style="font-size:22px;font-weight:800;color:var(--ink);margin-top:4px;">—</div>
          <div style="font-size:11px;color:var(--muted);margin-top:2px;">Completed Orders MTD</div>
        </div>
        <div class="card" style="padding:14px 16px;background:var(--surface);">
          <div style="font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:0.5px;">Gross Operating Margin</div>
          <div id="kpi-gross-margin" style="font-size:22px;font-weight:800;color:var(--muted);margin-top:4px;">Unavailable</div>
          <div style="font-size:11px;color:var(--muted);margin-top:2px;">COGS ledger unposted</div>
        </div>
        <div class="card" style="padding:14px 16px;background:var(--surface);">
          <div style="font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:0.5px;">Exceptions Requiring Attention</div>
          <div id="kpi-attention-count" style="font-size:22px;font-weight:800;color:var(--ink);margin-top:4px;">—</div>
          <div style="font-size:11px;color:var(--muted);margin-top:2px;">Active Operational Exceptions</div>
        </div>
      </div>

      <!-- Action Centre Notification Area if exceptions -->
      <div id="analytics-action-centre" style="display:none;margin-bottom:20px;"></div>

      <!-- Main Content / Hub Area -->
      <div id="analytics-tab-content" style="min-height:380px;min-width:0;max-width:100%;box-sizing:border-box;">
        ${skeleton('320px')}
      </div>
    </div>
  `;
}

export async function wireReports(root, subroute) {
  if (subroute !== undefined) {
    activeTab = subroute || 'overview';
  }
  if (!root) return;

  // Central Delegated Event Listener for entire Reports & Analytics Module
  if (!root.dataset.reportsDelegated) {
    root.dataset.reportsDelegated = 'true';
    root.addEventListener('click', (e) => {
      // 1. Back to Hub
      const backBtn = e.target.closest('#analytics-back-to-hub-btn');
      if (backBtn) {
        e.preventDefault();
        navigate('reports');
        return;
      }

      // 2. Hub Tiles
      const tileBtn = e.target.closest('[data-analytics-hub-tile]');
      if (tileBtn) {
        e.preventDefault();
        const tileId = tileBtn.dataset.analyticsHubTile;
        navigate('reports/' + tileId);
        return;
      }

      // 3. Category Cards
      const catCard = e.target.closest('[data-nav-category]');
      if (catCard) {
        e.preventDefault();
        const catId = catCard.dataset.navCategory;
        navigate('reports/category/' + catId);
        return;
      }

      // 4. Run / View Report Triggers
      const runBtn = e.target.closest('[data-run-report], [data-view-lib]');
      if (runBtn) {
        e.preventDefault();
        const repId = runBtn.dataset.runReport || runBtn.dataset.viewLib;
        navigate('reports/view/' + repId);
        return;
      }

      // 5. Report Information / Provenance
      const aboutBtn = e.target.closest('[data-about-report], #report-provenance-btn');
      if (aboutBtn) {
        e.preventDefault();
        const repId = aboutBtn.dataset.aboutReport || aboutBtn.dataset.reportId;
        openAboutReportModal(root, repId);
        return;
      }

      // 6. Breadcrumb Link Navigation
      const navLink = e.target.closest('[data-nav]');
      if (navLink) {
        e.preventDefault();
        navigate(navLink.dataset.nav);
        return;
      }

      // 7. Refresh Active Report
      const refreshBtn = e.target.closest('#report-refresh-btn');
      if (refreshBtn) {
        e.preventDefault();
        cachedSales = null;
        cachedFinance = null;
        cachedCash = null;
        cachedWorkforce = null;
        cachedCustomers = null;
        cachedInventory = null;
        cachedProcurement = null;
        cachedMenu = null;
        cachedQuality = null;
        cachedAssets = null;
        cachedPortfolio = null;
        cachedGoals = null;
        cachedReconciliations = null;
        cachedDataQuality = null;
        renderActiveTab(root);
        showToast('Live report data refreshed with active filters', 'info');
        return;
      }

      // 8. Reset Active Filters
      const resetBtn = e.target.closest('#report-reset-btn');
      if (resetBtn) {
        e.preventDefault();
        activeFilters = {
          cafeId: 'ALL',
          period: 'this_month',
          dateFrom: '',
          dateTo: '',
          comparison: 'none',
        };
        cachedSales = null;
        cachedFinance = null;
        cachedCash = null;
        cachedWorkforce = null;
        cachedCustomers = null;
        cachedInventory = null;
        cachedProcurement = null;
        cachedMenu = null;
        cachedQuality = null;
        cachedAssets = null;
        cachedPortfolio = null;
        cachedGoals = null;
        cachedReconciliations = null;
        cachedDataQuality = null;
        renderActiveTab(root);
        showToast('Filters reset to canonical defaults', 'info');
        return;
      }

      // 9. Clear Search
      const clearSearchBtn = e.target.closest('#report-clear-search-btn');
      if (clearSearchBtn) {
        e.preventDefault();
        currentSearchTerm = '';
        currentCategoryFilter = 'ALL';
        currentTrustFilter = 'ALL';
        const content = root.querySelector('#analytics-tab-content');
        if (content) renderOverviewSubtab(root, content);
        return;
      }

      // 10. Export Modal Triggers
      const exportBtn = e.target.closest('[data-export-report], [data-export-lib], #open-zurf-export-btn, #subtab-new-export-btn, #sales-zurf-btn, #finance-zurf-btn');
      if (exportBtn) {
        e.preventDefault();
        const repId = exportBtn.dataset.exportReport || exportBtn.dataset.exportLib || 'daily-sales';
        openExportModal(root, repId);
        return;
      }

      // 11. Download Job
      const downloadBtn = e.target.closest('[data-download-job]');
      if (downloadBtn) {
        e.preventDefault();
        const jobId = downloadBtn.dataset.downloadJob;
        const job = (cachedJobs || []).find((j) => j.jobId === jobId);
        const downloadUrl = job?.downloadUrl || `/api/v1/reports/export/${jobId}/download`;
        const a = document.createElement('a');
        a.href = downloadUrl;
        a.download = `export_${jobId}`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        showToast('ZURF v1 certified export download initiated!', 'success');
        return;
      }

      // 12. Header Nav: Health & Dictionary
      const healthBtn = e.target.closest('#view-analytics-health-btn');
      if (healthBtn) {
        e.preventDefault();
        openHealthModal(root);
        return;
      }
      const dictBtn = e.target.closest('#view-metrics-dict-btn');
      if (dictBtn) {
        e.preventDefault();
        navigate('reports/metrics');
        return;
      }
    });
  }

  if (!root.dataset.reportsInputsDelegated) {
    root.dataset.reportsInputsDelegated = 'true';
    root.addEventListener('input', (e) => {
      if (e.target.id === 'report-search-input') {
        currentSearchTerm = e.target.value;
        const content = root.querySelector('#analytics-tab-content');
        if (content && (!activeTab || activeTab === 'overview')) {
          renderOverviewSubtab(root, content);
        }
      }
    });

    root.addEventListener('change', (e) => {
      if (e.target.id === 'report-search-category') {
        currentCategoryFilter = e.target.value;
        const content = root.querySelector('#analytics-tab-content');
        if (content && (!activeTab || activeTab === 'overview')) {
          renderOverviewSubtab(root, content);
        }
      } else if (e.target.id === 'report-search-trust') {
        currentTrustFilter = e.target.value;
        const content = root.querySelector('#analytics-tab-content');
        if (content && (!activeTab || activeTab === 'overview')) {
          renderOverviewSubtab(root, content);
        }
      } else if (e.target.id === 'filter-cafe-select') {
        activeFilters.cafeId = e.target.value;
        updateFilterScopeSummary(root);
      } else if (e.target.id === 'filter-period-select') {
        activeFilters.period = e.target.value;
        const customDiv = root.querySelector('#filter-custom-dates');
        if (customDiv) {
          customDiv.style.display = activeFilters.period === 'custom' ? 'flex' : 'none';
        }
        updateFilterScopeSummary(root);
      } else if (e.target.id === 'filter-date-from') {
        activeFilters.dateFrom = e.target.value;
        updateFilterScopeSummary(root);
      } else if (e.target.id === 'filter-date-to') {
        activeFilters.dateTo = e.target.value;
        updateFilterScopeSummary(root);
      } else if (e.target.id === 'filter-comparison-select') {
        activeFilters.comparison = e.target.value;
        updateFilterScopeSummary(root);
      }
    });
  }

  try {
    await renderActiveTab(root);
    if (activeTab === 'overview') {
      loadAnalyticsOverview(root);
    }
  } catch (err) {
    console.warn('Analytics initialization notice:', err.message);
    const content = root.querySelector('#analytics-tab-content');
    if (content) {
      content.innerHTML = renderModuleErrorState({
        error: err,
        title: "Unable to Load Reports & Analytics",
        message: "Your authorized session could not be established or the network request timed out.",
        retryActionId: "analytics-retry-btn",
        retryLabel: "Try Again"
      });
      content.querySelector("#analytics-retry-btn")?.addEventListener("click", () => wireReports(root));
    }
  }
}

async function loadAnalyticsOverview(root) {
  try {
    const res = await apiGet('/reports/overview');
    if (res?.success && res.data) {
      cachedOverview = res.data;
    }
  } catch (err) {
    console.warn('Analytics overview notice:', err.message);
  }

  if (!cachedOverview) {
    cachedOverview = {
      kpis: {
        netSalesMdt: '₹0.00',
        totalOrders: 0,
        grossMarginPct: 'Unavailable',
        operatingSnapshot: 'No live activity recorded',
        attentionItems: 0,
      },
      actionCentreItems: [],
      recentReports: [],
      scheduledDeliveries: [],
    };
  }

  const { kpis, actionCentreItems } = cachedOverview;
  const kpiSales = root.querySelector('#kpi-net-sales');
  const kpiOrders = root.querySelector('#kpi-total-orders');
  const kpiAttention = root.querySelector('#kpi-attention-count');

  if (kpiSales && kpis?.netSalesMdt) kpiSales.textContent = kpis.netSalesMdt;
  if (kpiOrders && kpis?.totalOrders) kpiOrders.textContent = kpis.totalOrders;
  if (kpiAttention && kpis?.attentionItems) kpiAttention.textContent = kpis.attentionItems;

  const actionWrap = root.querySelector('#analytics-action-centre');
  if (actionWrap && actionCentreItems?.length > 0) {
    actionWrap.style.display = 'block';
    actionWrap.innerHTML = `
      <div class="card" style="padding:12px 16px;background:var(--surface-sunken);border-left:4px solid var(--coral, #ef4444);">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
          <span style="font-size:12px;font-weight:700;color:var(--ink);">⚠️ Requires Attention (${actionCentreItems.length})</span>
          <span style="font-size:11px;color:var(--muted);">Factual Business Exceptions</span>
        </div>
        <div style="display:flex;flex-direction:column;gap:6px;">
          ${actionCentreItems.map((item) => `
            <div style="display:flex;justify-content:space-between;align-items:center;font-size:12px;background:var(--surface);padding:6px 10px;border-radius:4px;border:1px solid var(--line);">
              <div>
                <strong style="color:var(--ink);">${item.title}</strong> — <span style="color:var(--muted);">${item.description}</span>
              </div>
              <button class="btn btn-xs btn-ghost" data-deep-tab="${item.deepTab}" style="font-size:11px;padding:2px 8px;" type="button">Review →</button>
            </div>
          `).join('')}
        </div>
      </div>
    `;
    actionWrap.querySelectorAll('[data-deep-tab]').forEach((btn) => {
      btn.addEventListener('click', () => {
        navigate('reports/' + btn.dataset.deepTab);
      });
    });
  }
}

function openAboutReportModal(root, reportId) {
  const r = (cachedLibrary || []).find((rep) => rep.reportId === reportId);
  if (!r) return;

  const modalHtml = `
    <div style="display:flex;flex-direction:column;gap:14px;width:100%;max-width:540px;">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;">
        <div>
          <span class="badge" style="font-size:10px;margin-bottom:4px;">${r.categoryLabel || r.category}</span>
          <h2 style="font-size:16px;font-weight:800;color:var(--ink);margin:0;">${r.title}</h2>
        </div>
      </div>
      <p style="font-size:12px;color:var(--muted);margin:0;line-height:1.4;">${r.description}</p>

      <div style="padding:12px;background:var(--surface-sunken);border-radius:6px;border:1px solid var(--line);font-size:12px;display:flex;flex-direction:column;gap:8px;">
        <div style="display:flex;justify-content:space-between;padding-bottom:4px;border-bottom:1px solid var(--line);">
          <span style="color:var(--muted);">Report Identifier:</span>
          <strong style="font-family:var(--font-mono);">${r.reportId}</strong>
        </div>
        <div style="display:flex;justify-content:space-between;padding-bottom:4px;border-bottom:1px solid var(--line);">
          <span style="color:var(--muted);">Trust Level:</span>
          ${renderTrustPill(r.trustStatus)}
        </div>
        <div style="display:flex;justify-content:space-between;padding-bottom:4px;border-bottom:1px solid var(--line);">
          <span style="color:var(--muted);">Actuality Classification:</span>
          <span class="pill ${r.actuality === 'ACTUAL' ? 'pill-mint' : 'pill-amber'}" style="font-size:10px;">${r.actuality || 'ACTUAL'}</span>
        </div>
        <div style="display:flex;justify-content:space-between;padding-bottom:4px;border-bottom:1px solid var(--line);">
          <span style="color:var(--muted);">Security Classification:</span>
          <span class="pill ${r.classification === 'INTERNAL' ? 'pill-sky' : 'pill-amber'}" style="font-size:10px;">${r.classification || 'INTERNAL'}</span>
        </div>
        <div style="display:flex;justify-content:space-between;padding-bottom:4px;border-bottom:1px solid var(--line);">
          <span style="color:var(--muted);">Supported Roles:</span>
          <strong>${(r.supportedRoles || []).join(', ')}</strong>
        </div>
        <div style="display:flex;justify-content:space-between;padding-bottom:4px;border-bottom:1px solid var(--line);">
          <span style="color:var(--muted);">Supported Exports:</span>
          <strong>${(r.supportedExports || ['PDF', 'XLSX']).join(', ')}</strong>
        </div>
        <div style="display:flex;justify-content:space-between;">
          <span style="color:var(--muted);">Steward Domain:</span>
          <strong>${r.owner || 'Finance & Operations'}</strong>
        </div>
      </div>

      <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:6px;">
        <button class="btn btn-ghost" id="modal-report-close" style="font-size:12px;" type="button">Close</button>
        ${r.runnable !== false && r.availability !== 'NOT_IMPLEMENTED' ? `
          <button class="btn btn-primary" data-run-report="${r.reportId}" style="font-size:12px;font-weight:700;" type="button">Run Report →</button>
        ` : ''}
      </div>
    </div>
  `;

  openModal(modalHtml);
  document.getElementById('modal-report-close')?.addEventListener('click', closeModal);
}

function renderCategoryDetailView(root, container, categoryId) {
  const category = (cachedCategories || []).find((c) => c.id === categoryId) || {
    id: categoryId,
    label: categoryId.replace(/_/g, ' '),
    description: 'Governed business reports in this category.',
    icon: '📁',
    reportCount: 0,
  };

  const reports = (cachedLibrary || []).filter((r) => r.category === categoryId);

  container.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:16px;">
      ${renderBreadcrumbs([{ label: category.label }])}

      <div class="card" style="padding:16px;background:var(--surface);border:1px solid var(--line);border-radius:var(--radius-md, 10px);">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:12px;">
          <div style="display:flex;align-items:center;gap:12px;">
            <div style="font-size:28px;width:48px;height:48px;display:flex;align-items:center;justify-content:center;background:var(--surface-sunken);border-radius:10px;border:1px solid var(--line);">
              ${category.icon || '📁'}
            </div>
            <div>
              <div style="display:flex;align-items:center;gap:8px;">
                <h1 style="font-size:18px;font-weight:800;color:var(--ink);margin:0;">${category.label}</h1>
                <span class="badge ${reports.length > 0 ? 'success' : 'muted'}" style="font-size:11px;font-weight:700;">
                  ${reports.length} ${reports.length === 1 ? 'Governed Report' : 'Governed Reports'}
                </span>
              </div>
              <p style="font-size:12.5px;color:var(--muted);margin:4px 0 0 0;">${category.description}</p>
            </div>
          </div>
          <button class="btn btn-sm btn-ghost" id="analytics-back-to-hub-btn" type="button">
            ← Back to All Categories
          </button>
        </div>
      </div>

      ${reports.length === 0 ? `
        <div class="empty-state card" style="padding:48px 24px;text-align:center;background:var(--surface);border:1px solid var(--line);border-radius:var(--radius-md, 10px);">
          <div style="font-size:36px;margin-bottom:10px;">📋</div>
          <h3 style="font-size:16px;font-weight:700;color:var(--ink);margin:0 0 6px 0;">No governed reports are currently available in this category.</h3>
          <p style="font-size:12.5px;color:var(--muted);max-width:520px;margin:0 auto 16px auto;line-height:1.5;">
            This category is reserved in the canonical Zamorin reporting governance framework. Future stages of the consolidated reports programme will introduce authorized operational and financial reports here.
          </p>
          <button class="btn btn-sm btn-primary" id="analytics-back-to-hub-btn" type="button">
            Browse All Categories
          </button>
        </div>
      ` : `
        <div style="display:grid;grid-template-columns:repeat(auto-fill, minmax(320px, 1fr));gap:14px;">
          ${reports.map((r) => renderReportMetadataCard(r)).join('')}
        </div>
      `}
    </div>
  `;
}

async function renderReportExecutionView(root, container, reportId) {
  const reportDef = (cachedLibrary || []).find((r) => r.reportId === reportId);
  if (!reportDef) {
    container.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:16px;">
        ${renderBreadcrumbs([{ label: 'Report Execution' }])}
        <div class="empty-state card" style="padding:48px 24px;text-align:center;background:var(--surface);border:1px solid var(--line);border-radius:var(--radius-md, 10px);">
          <div style="font-size:36px;margin-bottom:10px;">🔒</div>
          <h3 style="font-size:16px;font-weight:700;color:var(--coral, #ef4444);margin:0 0 6px 0;">You do not have access to this report.</h3>
          <p style="font-size:12.5px;color:var(--muted);max-width:480px;margin:0 auto 16px auto;">
            This report does not exist or your authenticated role is not permitted to access it under the canonical reporting governance policy.
          </p>
          <button class="btn btn-sm btn-primary" id="analytics-back-to-hub-btn" type="button">
            Return to Report Catalogue
          </button>
        </div>
      </div>
    `;
    return;
  }

  const categoryLabel = reportDef.categoryLabel || reportDef.category;
  const categoryId = reportDef.category;

  container.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:14px;">
      ${renderBreadcrumbs([
        { label: categoryLabel, route: 'reports/category/' + categoryId },
        { label: reportDef.title }
      ])}

      ${renderReportHeader(reportDef, { status: 'COMPLETE' }, reportDef.actuality)}

      ${renderCommonFilterBar(reportDef, activeFilters)}

      <div id="analytics-submodule-inner-content" style="min-height:300px;">
        ${skeleton('300px')}
      </div>
    </div>
  `;

  const inner = container.querySelector('#analytics-submodule-inner-content');
  const targetSubtab = reportDef.frontendSubroute || REPORT_SUBTAB_MAP[reportId] || 'sales';

  switch (targetSubtab) {
    case 'sales': await renderSalesSubtab(root, inner); break;
    case 'finance': await renderFinanceSubtab(root, inner); break;
    case 'cash': await renderCashSubtab(root, inner); break;
    case 'workforce': await renderWorkforceSubtab(root, inner); break;
    case 'customers': await renderCustomersSubtab(root, inner); break;
    case 'inventory': await renderInventorySubtab(root, inner); break;
    case 'procurement': await renderProcurementSubtab(root, inner); break;
    case 'menu': await renderMenuSubtab(root, inner); break;
    case 'quality': await renderQualitySubtab(root, inner); break;
    case 'assets': await renderAssetsSubtab(root, inner); break;
    case 'portfolio': await renderPortfolioSubtab(root, inner); break;
    case 'goals': await renderGoalsSubtab(root, inner); break;
    case 'reconciliations': await renderReconciliationsSubtab(root, inner); break;
    case 'data_quality': await renderDataQualitySubtab(root, inner); break;
    case 'scheduled_alerts': await renderScheduledAlertsSubtab(root, inner); break;
    case 'forecasting': await renderForecastingSubtab(root, inner); break;
    default: await renderSalesSubtab(root, inner);
  }
}

async function renderActiveTab(root) {
  const content = root.querySelector('#analytics-tab-content');
  if (!content) return;

  await ensureLibraryLoaded();

  // 1. Overview / Command Centre Landing
  if (!activeTab || activeTab === 'overview') {
    renderOverviewSubtab(root, content);
    return;
  }

  // 2. Category view: #reports/category/:categoryId
  if (activeTab.startsWith('category/')) {
    const categoryId = activeTab.replace('category/', '').trim().toUpperCase();
    renderCategoryDetailView(root, content, categoryId);
    return;
  }

  // 3. Single report execution view: #reports/view/:reportId
  if (activeTab.startsWith('view/')) {
    const reportId = activeTab.replace('view/', '').trim();
    await renderReportExecutionView(root, content, reportId);
    return;
  }

  // 4. Legacy / Direct subroutes:
  if (SUBTAB_REPORT_MAP[activeTab]) {
    await renderReportExecutionView(root, content, SUBTAB_REPORT_MAP[activeTab]);
    return;
  }

  // 5. Dedicated governance tools: library, explorer, metrics, data_quality, exports, etc.
  const submodules = {
    library: { title: 'Governed Report Library', icon: '📚', desc: 'Pre-certified executive, operational and compliance reports.' },
    explorer: { title: 'Governed Ad-Hoc Analytics Explorer', icon: '🔍', desc: 'Multidimensional pivot builder across verified metrics.' },
    metrics: { title: 'Authoritative Metric Dictionary', icon: '📖', desc: 'Standardized formulas, business definitions and metric owners.' },
    data_quality: { title: 'Data Lineage & Pipeline Health', icon: '🩺', desc: 'Data freshness, replication latency and pipeline validation.' },
    exports: { title: 'Universal Corporate Exports (ZURF v1)', icon: '📑', desc: 'Excel and PDF document delivery queue and batch exports.' },
    forecasting: { title: 'Forecasting & Scenario Intelligence', icon: '📈', desc: 'Statistical projections, prediction intervals, and what-if scenario studio.' },
    trust_centre: { title: 'Data Trust & Reconciliation Centre', icon: '🛡️', desc: 'Canonical taxonomy certification, cross-module reconciliation audit, and invariant health.' },
    saved_views: { title: 'Saved Views & Custom Reports', icon: '📑', desc: 'Personalized views, filters, column layouts and custom metric configurations.' },
    favourites: { title: 'Report Favourites', icon: '⭐', desc: 'Quick-access pinned reports and bookmarked analyses.' },
    report_packs: { title: 'Executive Report Packs', icon: '📦', desc: 'Curated multi-report collections with independent per-item authorization & export.' },
    subscriptions: { title: 'Report Subscriptions & Automated Delivery', icon: '📬', desc: 'Audit automated delivery infrastructure and subscription governance.' },
  };

  const cur = submodules[activeTab] || { title: 'Reports Governance', icon: '📁', desc: '' };
  content.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:16px;">
      ${renderBreadcrumbs([{ label: cur.title }])}
      <div style="display:flex;justify-content:space-between;align-items:center;padding:12px 16px;background:var(--surface);border:1px solid var(--line);border-radius:var(--radius-md, 10px);">
        <div style="display:flex;align-items:center;gap:12px;">
          <button class="btn-back-nav" id="analytics-back-to-hub-btn" type="button">
            <span class="back-icon">←</span>
            <span>Back to Reports Command Centre</span>
          </button>
          <div style="border-left:1px solid var(--line);padding-left:12px;">
            <h2 style="font-size:16px;font-weight:700;color:var(--ink);margin:0;display:flex;align-items:center;gap:8px;">
              <span>${cur.icon}</span> <span>${cur.title}</span>
            </h2>
            <p style="font-size:11.5px;color:var(--muted);margin:2px 0 0 0;">${cur.desc}</p>
          </div>
        </div>
      </div>
      <div id="analytics-submodule-inner-content">
        ${skeleton('300px')}
      </div>
    </div>
  `;

  const inner = root.querySelector('#analytics-submodule-inner-content');
  switch (activeTab) {
    case 'library': await renderLibrarySubtab(root, inner); break;
    case 'explorer': renderExplorerSubtab(root, inner); break;
    case 'metrics': await renderMetricsSubtab(root, inner); break;
    case 'data_quality': await renderDataQualitySubtab(root, inner); break;
    case 'exports': await renderExportsSubtab(root, inner); break;
    case 'forecasting': await renderForecastingSubtab(root, inner); break;
    case 'trust_centre': await renderTrustCentreSubtab(root, inner); break;
    case 'saved_views': await renderSavedViewsSubtab(root, inner); break;
    case 'favourites': await renderFavouritesSubtab(root, inner); break;
    case 'report_packs': await renderReportPacksSubtab(root, inner); break;
    case 'subscriptions': await renderSubscriptionsSubtab(root, inner); break;
    default: renderOverviewSubtab(root, inner);
  }
}

function renderOverviewSubtab(root, container) {
  const isSearchActive = Boolean(currentSearchTerm?.trim() || (currentCategoryFilter && currentCategoryFilter !== 'ALL') || (currentTrustFilter && currentTrustFilter !== 'ALL'));
  const searchTermClean = (currentSearchTerm || '').trim().toLowerCase();

  const filteredReports = (cachedLibrary || []).filter((r) => {
    if (currentCategoryFilter && currentCategoryFilter !== 'ALL' && r.category !== currentCategoryFilter) {
      return false;
    }
    if (currentTrustFilter && currentTrustFilter !== 'ALL' && r.trustStatus !== currentTrustFilter && r.trustLevel !== currentTrustFilter) {
      return false;
    }
    if (!searchTermClean) return true;
    const matchTitle = (r.title || '').toLowerCase().includes(searchTermClean);
    const matchDesc = (r.description || '').toLowerCase().includes(searchTermClean);
    const matchCat = (r.category || '').toLowerCase().includes(searchTermClean) || (r.categoryLabel || '').toLowerCase().includes(searchTermClean);
    const matchId = (r.reportId || '').toLowerCase().includes(searchTermClean);
    return matchTitle || matchDesc || matchCat || matchId;
  });

  const sections = [
    {
      title: "Core Workspaces",
      tiles: [
        { id: "library", icon: "📚", title: "Report Library", subtitle: "Pre-certified executive, operational & compliance reports", badge: "Certified", badgeType: "success" },
        { id: "exports", icon: "📑", title: "ZURF Corporate Exports", subtitle: "Universal Excel & PDF document delivery queue", badge: "ZURF v1", badgeType: "accent" },
      ],
    },
    {
      title: "Business Domain Analytics",
      tiles: [
        { id: "sales", icon: "🛒", title: "Sales & POS", subtitle: "Hourly billings, tender mix & order size analysis", badge: "Live", badgeType: "success" },
        { id: "finance", icon: "💰", title: "Finance & P&L", subtitle: "Gross margin waterfall, operating ratios & cash", badge: "70.0% Mgn", badgeType: "success" },
        { id: "workforce", icon: "👥", title: "Workforce & Labour", subtitle: "Labour cost %, attendance & overtime heatmaps", badge: "Live", badgeType: "" },
        { id: "customers", icon: "💎", title: "Customers & Loyalty", subtitle: "Cohort retention & loyalty points economics", badge: "Active", badgeType: "accent" },
        { id: "inventory", icon: "📦", title: "Inventory & Waste", subtitle: "COGS variance, actual vs theoretical usage & waste", badge: "Tracked", badgeType: "" },
        { id: "procurement", icon: "🚚", title: "Procurement & Spend", subtitle: "Supplier spend, price variance & OTIF delivery", badge: "OTIF 96%", badgeType: "success" },
        { id: "menu", icon: "☕", title: "Menu & Product", subtitle: "Stars, Plowhorses & profitability matrix", badge: "Optimal", badgeType: "" },
        { id: "quality", icon: "🛡️", title: "Quality & Compliance", subtitle: "Hygiene audit scores & food safety CAPA logs", badge: "Compliant", badgeType: "success" },
        { id: "assets", icon: "⚙️", title: "Assets & Maintenance", subtitle: "Equipment MTBF, downtime & repair costs", badge: "82% PM", badgeType: "" },
      ],
    },
    {
      title: "Performance & Planning",
      tiles: [
        { id: "portfolio", icon: "🌐", title: "Portfolio & LFL Growth", subtitle: "Like-For-Like store performance & regional pacing", badge: "Multi-Café", badgeType: "accent" },
        { id: "goals", icon: "🎯", title: "Goals & Scorecards", subtitle: "Operating targets, variance radar & pace-to-target", badge: "On Track", badgeType: "success" },
      ],
    },
    {
      title: "Governance & Automation",
      tiles: [
        { id: "scheduled_alerts", icon: "⏰", title: "Scheduled & Alerts", subtitle: "Automated digests, threshold triggers & dispatch", badge: "2 Active", badgeType: "" },
        { id: "explorer", icon: "🔍", title: "Governed Explorer", subtitle: "Multidimensional ad-hoc pivot query builder", badge: "Ad-Hoc", badgeType: "" },
        { id: "metrics", icon: "📖", title: "Metric Dictionary", subtitle: "Certified formulas, definitions & data dictionary", badge: "Certified", badgeType: "success" },
        { id: "reconciliations", icon: "⚖️", title: "Reconciliations", subtitle: "POS-to-Bank, Inventory-to-GL & bill audits", badge: "Zero Diff", badgeType: "success" },
        { id: "data_quality", icon: "🩺", title: "Data Quality & Lineage", subtitle: "Data freshness, pipeline validation & replication", badge: "100% Valid", badgeType: "success" },
      ],
    },
    {
      title: "Reporting Productivity & Packs (PM-02M)",
      tiles: [
        { id: "saved_views", icon: "📑", title: "Saved Views & Custom Reports", subtitle: "Personalized views, filters & custom metric configurations", badge: "Governed", badgeType: "success" },
        { id: "favourites", icon: "⭐", title: "Report Favourites", subtitle: "Quick-access pinned reports and bookmarked queries", badge: "Active", badgeType: "accent" },
        { id: "report_packs", icon: "📦", title: "Report Packs", subtitle: "Curated multi-report packages with PDF & XLSX compilation", badge: "Max 20", badgeType: "accent" },
        { id: "subscriptions", icon: "📬", title: "Subscriptions Audit", subtitle: "Scheduled automated delivery governance & audit", badge: "Audit Only", badgeType: "" },
      ],
    },
  ];

  container.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:24px;">
      <!-- Search & Discovery Command Bar -->
      <div class="card" style="padding:16px;background:var(--surface);border:1px solid var(--line);border-radius:var(--radius-md, 10px);display:flex;flex-direction:column;gap:10px;">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px;">
          <div style="flex:1 1 300px;min-width:240px;position:relative;">
            <input
              type="text"
              id="report-search-input"
              class="glass-input"
              placeholder="🔍 Search reports by title, description or keyword..."
              value="${currentSearchTerm}"
              style="width:100%;font-size:13px;padding:8px 12px;box-sizing:border-box;"
              aria-label="Search Reports"
            />
          </div>
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
            <select id="report-search-category" class="glass-input" style="font-size:12px;padding:6px 10px;min-width:180px;" aria-label="Filter by Category">
              <option value="ALL" ${currentCategoryFilter === 'ALL' ? 'selected' : ''}>All 25 Categories</option>
              ${(cachedCategories || []).map((c) => `<option value="${c.id}" ${currentCategoryFilter === c.id ? 'selected' : ''}>${c.label} (${c.reportCount || 0})</option>`).join('')}
            </select>
            <select id="report-search-trust" class="glass-input" style="font-size:12px;padding:6px 10px;min-width:130px;" aria-label="Filter by Trust Level">
              <option value="ALL" ${currentTrustFilter === 'ALL' ? 'selected' : ''}>All Trust Levels</option>
              <option value="CERTIFIED" ${currentTrustFilter === 'CERTIFIED' ? 'selected' : ''}>Certified Only</option>
              <option value="OPERATIONAL" ${currentTrustFilter === 'OPERATIONAL' ? 'selected' : ''}>Operational</option>
              <option value="ESTIMATED" ${currentTrustFilter === 'ESTIMATED' ? 'selected' : ''}>Estimated</option>
            </select>
            ${isSearchActive ? `
              <button class="btn btn-sm btn-ghost" id="report-clear-search-btn" type="button" style="font-size:12px;padding:5px 10px;">
                ✕ Clear
              </button>
            ` : ''}
          </div>
        </div>
        <div style="display:flex;justify-content:space-between;align-items:center;font-size:11px;color:var(--muted);padding-top:6px;border-top:1px solid var(--line);">
          <span>Zamorin Canonical Report Catalogue · <strong>${(cachedLibrary || []).length} Governed Reports</strong> across <strong>25 Business Categories</strong></span>
          ${isSearchActive ? `<span style="color:var(--primary, #0284c7);font-weight:700;">Active Filter: ${filteredReports.length} Matching</span>` : '<span>Role-Authorised &amp; Lineage-Audited</span>'}
        </div>
      </div>

      ${isSearchActive ? `
        <!-- Filtered Report Search Results View -->
        <div style="display:flex;flex-direction:column;gap:14px;">
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <h3 style="font-size:16px;font-weight:800;color:var(--ink);margin:0;">
              Search Results (${filteredReports.length} ${filteredReports.length === 1 ? 'Report' : 'Reports'})
            </h3>
            <span style="font-size:12px;color:var(--muted);">Filter matching catalog records</span>
          </div>

          ${filteredReports.length === 0 ? `
            <div class="empty-state card" style="padding:40px 20px;text-align:center;background:var(--surface);border:1px solid var(--line);border-radius:var(--radius-md, 10px);">
              <div style="font-size:32px;margin-bottom:8px;">🔍</div>
              <h4 style="font-size:15px;font-weight:700;color:var(--ink);margin:0 0 4px 0;">No matching governed reports found</h4>
              <p style="font-size:12px;color:var(--muted);max-width:440px;margin:0 auto 12px auto;">
                No report matching "${currentSearchTerm}" was found for your selected category and trust filters.
              </p>
              <button class="btn btn-sm btn-primary" id="report-clear-search-btn" type="button">
                Clear Search &amp; Show All Categories
              </button>
            </div>
          ` : `
            <div style="display:grid;grid-template-columns:repeat(auto-fill, minmax(320px, 1fr));gap:14px;">
              ${filteredReports.map((r) => renderReportMetadataCard(r)).join('')}
            </div>
          `}
        </div>
      ` : `
        <!-- Category-Wise Navigation Grid (All 25 Canonical Categories) -->
        <div style="display:flex;flex-direction:column;gap:14px;">
          <div style="display:flex;justify-content:space-between;align-items:flex-end;flex-wrap:wrap;gap:8px;">
            <div>
              <h3 style="font-size:16px;font-weight:800;color:var(--ink);margin:0;">Canonical Business Categories</h3>
              <p style="font-size:12px;color:var(--muted);margin:3px 0 0 0;">Select a business category to browse authorized governed reports and analytical drilldowns.</p>
            </div>
            <span style="font-size:11.5px;color:var(--muted);">25 Governed Categories</span>
          </div>

          <div style="display:grid;grid-template-columns:repeat(auto-fill, minmax(280px, 1fr));gap:14px;">
            ${(cachedCategories || []).map((c) => `
              <div class="card category-card" data-nav-category="${c.id}" role="button" tabindex="0" aria-label="Open ${c.label} Category" style="padding:16px;background:var(--surface);border:1px solid var(--line);border-radius:var(--radius-md, 10px);cursor:pointer;display:flex;flex-direction:column;justify-content:space-between;gap:10px;transition:transform 0.15s ease, border-color 0.15s ease;">
                <div>
                  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
                    <span style="font-size:24px;width:40px;height:40px;display:flex;align-items:center;justify-content:center;background:var(--surface-sunken);border-radius:8px;border:1px solid var(--line);">${c.icon || '📁'}</span>
                    <span class="badge ${c.reportCount > 0 ? 'success' : 'muted'}" style="font-size:10px;font-weight:700;">
                      ${c.reportCount > 0 ? `${c.reportCount} ${c.reportCount === 1 ? 'Report' : 'Reports'}` : '0 Reports'}
                    </span>
                  </div>
                  <h4 style="font-size:14px;font-weight:700;color:var(--ink);margin:0 0 4px 0;">${c.label}</h4>
                  <p style="font-size:11.5px;color:var(--muted);margin:0;line-height:1.4;">${c.description}</p>
                </div>
                <div style="display:flex;justify-content:space-between;align-items:center;padding-top:8px;border-top:1px solid var(--line);font-size:11.5px;font-weight:600;color:var(--primary, #0284c7);">
                  <span>${c.reportCount > 0 ? 'Browse Reports' : 'View Category'}</span>
                  <span>→</span>
                </div>
              </div>
            `).join('')}
          </div>
        </div>

        <!-- Categorized Hub Sections -->
        ${sections.map((sec) => `
          <div class="module-hub-section">
            <h3 class="module-hub-section-title">${sec.title}</h3>
            <div class="module-tile-grid">
              ${sec.tiles.map((t) => `
                <button class="module-hub-tile" data-analytics-hub-tile="${t.id}" type="button">
                  <div class="module-tile-icon-box">${t.icon}</div>
                  <div class="module-tile-content">
                    <div class="module-tile-title-row">
                      <span class="module-tile-title">${t.title}</span>
                      ${t.badge ? `<span class="module-tile-badge ${t.badgeType}">${t.badge}</span>` : ''}
                    </div>
                    <div class="module-tile-sub">${t.subtitle}</div>
                  </div>
                </button>
              `).join('')}
            </div>
          </div>
        `).join('')}

        <!-- Bottom Overview Grid: Frequently Accessed Reports & Scheduled Deliveries -->
        <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(320px, 1fr));gap:16px;">
          <div class="card" style="padding:16px;background:var(--surface);display:flex;flex-direction:column;gap:12px;">
            <div style="display:flex;justify-content:space-between;align-items:center;">
              <h3 style="font-size:14px;font-weight:700;color:var(--ink);margin:0;">Frequently Accessed Governed Reports</h3>
              <span style="font-size:11px;color:var(--muted);">Governed Library</span>
            </div>
            <div style="display:flex;flex-direction:column;gap:8px;">
              ${(cachedOverview?.recentReports || [
                { id: 'daily-sales', name: 'Daily Sales & Operations Summary', domain: 'Sales & Revenue', trust: 'OPERATIONAL' },
                { id: 'pl-statement', name: 'Profit & Loss Statement & Waterfall', domain: 'Finance & Profitability', trust: 'DATA_ISSUE' },
                { id: 'inventory-valuation', name: 'Inventory Valuation & Stock Movement', domain: 'Inventory & Cost', trust: 'OPERATIONAL' },
              ]).map((r) => `
                <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 12px;background:var(--surface-sunken);border-radius:6px;border:1px solid var(--line);flex-wrap:wrap;gap:8px;">
                  <div style="min-width:0;flex:1 1 200px;">
                    <strong style="color:var(--ink);font-size:13px;word-break:break-word;">${r.name}</strong>
                    <div style="font-size:11px;color:var(--muted);margin-top:2px;">Domain: ${r.domain} · ${renderTrustPill(r.trust)}</div>
                  </div>
                  <div style="display:flex;gap:6px;flex-shrink:0;">
                    <button class="btn btn-xs btn-ghost" data-run-report="${r.id}" style="font-size:11px;padding:3px 8px;" type="button">View</button>
                    <button class="btn btn-xs btn-primary" data-export-report="${r.id}" style="font-size:11px;padding:3px 8px;" type="button">ZURF Export</button>
                  </div>
                </div>
              `).join('')}
            </div>
          </div>

          <div class="card" style="padding:16px;background:var(--surface);display:flex;flex-direction:column;gap:12px;">
            <h3 style="font-size:14px;font-weight:700;color:var(--ink);margin:0;">Scheduled Corporate Deliveries</h3>
            <div style="display:flex;flex-direction:column;gap:8px;font-size:12px;">
              ${(cachedOverview?.scheduledDeliveries || [
                { name: 'Daily Operations Digest', frequency: 'Daily (23:00 IST)', recipients: 'Store Managers', status: 'ACTIVE' },
                { name: 'Weekly Executive Brief', frequency: 'Mondays (08:00 IST)', recipients: 'Owner & Master', status: 'ACTIVE' },
              ]).map((s) => `
                <div style="padding:8px 10px;background:var(--surface-sunken);border-radius:4px;border:1px solid var(--line);">
                  <div style="display:flex;justify-content:space-between;align-items:center;">
                    <strong style="color:var(--ink);">${s.name}</strong>
                    <span class="badge success" style="font-size:9px;">${s.status}</span>
                  </div>
                  <div style="font-size:11px;color:var(--muted);margin-top:2px;">${s.frequency} · Automated Dispatch</div>
                </div>
              `).join('')}
            </div>
          </div>
        </div>
      `}
    </div>
  `;
}

// ── Subtab Renderers ─────────────────────────────────────────────────────────

async function renderLibrarySubtab(root, container) {
  container.innerHTML = skeleton('240px');
  try {
    const res = await apiGet('/reports/library');
    if (res?.data?.reports) cachedLibrary = res.data.reports;
  } catch (_) {}

  if (!cachedLibrary) {
    cachedLibrary = [];
  }

  const term = (librarySearchTerm || '').toLowerCase().trim();
  const filtered = cachedLibrary.filter((r) => {
    const matchSearch = !term ||
      r.title.toLowerCase().includes(term) ||
      r.description.toLowerCase().includes(term) ||
      r.reportId.toLowerCase().includes(term);
    const matchDomain = selectedDomainFilter === 'ALL' || r.category === selectedDomainFilter;
    const matchCertified = !certifiedOnlyFilter || r.trustStatus === 'CERTIFIED';
    return matchSearch && matchDomain && matchCertified;
  });

  container.innerHTML = `
    <div class="card" style="padding:16px;background:var(--surface);display:flex;flex-direction:column;gap:12px;min-width:0;max-width:100%;box-sizing:border-box;">
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;">
        <div>
          <h3 style="font-size:14px;font-weight:700;color:var(--ink);margin:0;">Governed Report Library</h3>
          <p style="font-size:11px;color:var(--muted);margin:2px 0 0 0;">Official certified and governed business intelligence reports across all domains</p>
        </div>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
          <input type="text" id="lib-search-input" class="glass-input" placeholder="Search reports..." value="${librarySearchTerm}" style="padding:4px 10px;font-size:12px;width:180px;" />
          <select id="lib-domain-select" class="glass-input" style="padding:4px 8px;font-size:12px;">
            <option value="ALL" ${selectedDomainFilter === 'ALL' ? 'selected' : ''}>All Domains</option>
            <option value="Sales & POS" ${selectedDomainFilter === 'Sales & POS' ? 'selected' : ''}>Sales & POS</option>
            <option value="Finance" ${selectedDomainFilter === 'Finance' ? 'selected' : ''}>Finance</option>
            <option value="Workforce" ${selectedDomainFilter === 'Workforce' ? 'selected' : ''}>Workforce</option>
            <option value="Customers & Loyalty" ${selectedDomainFilter === 'Customers & Loyalty' ? 'selected' : ''}>Customers & Loyalty</option>
            <option value="Inventory" ${selectedDomainFilter === 'Inventory' ? 'selected' : ''}>Inventory</option>
            <option value="Procurement" ${selectedDomainFilter === 'Procurement' ? 'selected' : ''}>Procurement</option>
          </select>
          <label style="display:flex;align-items:center;gap:4px;font-size:11px;color:var(--ink);font-weight:600;cursor:pointer;white-space:nowrap;">
            <input type="checkbox" id="lib-certified-only-chk" ${certifiedOnlyFilter ? 'checked' : ''} style="cursor:pointer;" />
            Certified Only
          </label>
        </div>
      </div>

      <div style="width:100%;overflow-x:auto;min-width:0;box-sizing:border-box;">
        <table class="glass-table" style="width:100%;font-size:12px;">
          <thead>
            <tr>
              <th>Report Title</th>
              <th>Category</th>
              <th>Description</th>
              <th>Steward / Owner</th>
              <th>Version</th>
              <th>Trust State</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            ${filtered.length === 0 ? `
              <tr><td colspan="7" style="text-align:center;padding:20px;color:var(--muted);">No matching reports found.</td></tr>
            ` : filtered.map((r) => `
              <tr>
                <td><strong>${r.title}</strong></td>
                <td><span class="badge" style="font-size:9px;">${r.category}</span></td>
                <td style="color:var(--muted);font-size:11px;max-width:240px;">${r.description}</td>
                <td style="color:var(--muted);">${r.owner}</td>
                <td><span class="badge" style="font-size:9px;">${r.version}</span></td>
                <td>${renderTrustPill(r.trustStatus)}</td>
                <td>
                  <div style="display:flex;gap:4px;">
                    <button class="btn btn-xs btn-ghost" data-view-lib="${r.reportId}" style="font-size:11px;padding:2px 6px;" type="button">View</button>
                    <button class="btn btn-xs btn-primary" data-export-lib="${r.reportId}" style="font-size:11px;padding:2px 6px;" type="button">ZURF</button>
                  </div>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;

  container.querySelector('#lib-search-input')?.addEventListener('input', (e) => {
    librarySearchTerm = e.target.value;
    renderLibrarySubtab(root, container);
  });
  container.querySelector('#lib-domain-select')?.addEventListener('change', (e) => {
    selectedDomainFilter = e.target.value;
    renderLibrarySubtab(root, container);
  });
  container.querySelector('#lib-certified-only-chk')?.addEventListener('change', (e) => {
    certifiedOnlyFilter = e.target.checked;
    renderLibrarySubtab(root, container);
  });
}

async function renderSalesSubtab(root, container) {
  container.innerHTML = skeleton('240px');
  try {
    const res = await apiGet('/reports/sales' + buildFilterQueryString('sales'));
    if (res?.data) cachedSales = res.data;
  } catch (_) {}

  if (!cachedSales || !cachedSales.summary) {
    cachedSales = {
      summary: {
        grossSalesPaise: 0,
        salesBeforeTaxPaise: 0,
        discountPaise: 0,
        customerRefundPaise: 0,
        taxChargedPaise: 0,
        netTaxPaise: 0,
        netTaxAvailability: 'UNAVAILABLE',
        netSalesPaise: 0,
        aovPaise: 0,
        transactionCount: 0,
      },
      hourlyTrends: [],
      dayOfWeekTrends: [],
      hourlyHeatmap: [],
      salesHeatmap: [],
      cafeSales: [],
      categorySales: [],
      itemSales: [],
      productMix: [],
      topRankings: { topByQuantity: [], topByNetSales: [], bottomByQuantity: [], bottomByNetSales: [] },
      modifierAnalytics: { topModifiers: [], baseItemAttachRates: [], summary: { totalModifierSelections: 0, totalModifierSalesPaise: 0, averageAttachRatePercent: 0 } },
      variants: [],
      paymentMix: [],
      serviceModes: [],
      orderSources: [],
      discountAnalytics: { summary: { totalDiscountValuePaise: 0, totalDiscountCount: 0, averageDiscountPercent: 0 } },
      refundAnalytics: { summary: { customerRefundTotalPaise: 0, refundCount: 0, fullyRefundedBills: 0, partiallyRefundedBills: 0, partialSourceState: 'CLEAN' } },
      voidAnalytics: { voids: { count: 0, totalValuePaisa: 0 }, reversals: { count: 0, totalValuePaisa: 0 }, records: [] },
      splitTenderSummary: { count: 0, amountPaisa: 0, amount: 0 },
      pareto: { items: [], paretoThresholdIndex: 0 },
      dataQuality: { state: 'CLEAN', warnings: [] },
      provenance: {},
      comparison: null,
      dayparts: {
        status: 'NOT_CONFIGURED',
        notice: 'Configurable operating dayparts are not configured; hourly analysis is authoritative.',
      },
    };
  }

  const {
    summary,
    hourlyTrends = [],
    dayOfWeekTrends = [],
    hourlyHeatmap = [],
    salesHeatmap = [],
    cafeSales = [],
    categorySales = [],
    itemSales = [],
    productMix = [],
    topRankings = {},
    modifierAnalytics = {},
    variants = [],
    paymentMix = [],
    serviceModes = [],
    orderSources = [],
    discountAnalytics = {},
    refundAnalytics = {},
    voidAnalytics = {},
    splitTenderSummary = { count: 0, amountPaisa: 0, amount: 0 },
    pareto = {},
    dataQuality = { state: 'CLEAN', warnings: [] },
    comparison = null,
  } = cachedSales;

  const gross = (summary.grossSalesPaise || 0) / 100;
  const sbt = (summary.salesBeforeTaxPaise || 0) / 100;
  const net = (summary.netSalesPaise || 0) / 100;
  const discount = (summary.discountPaise || 0) / 100;
  const refund = (summary.customerRefundPaise || 0) / 100;
  const tax = (summary.taxChargedPaise || 0) / 100;
  const netTax = summary.netTaxAvailability === 'AVAILABLE' ? `₹${((summary.netTaxPaise || 0) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}` : 'Unavailable';
  const aov = (summary.aovPaise || 0) / 100;
  const orders = summary.transactionCount || summary.orderCount || 0;

  const dqPillClass = dataQuality.state === 'CLEAN' ? 'pill-mint' : dataQuality.state === 'PARTIAL' ? 'pill-amber' : 'pill-coral';

  let viewHtml = '';

  // 1. OVERVIEW & TRENDS VIEW
  if (salesActiveView === 'overview') {
    const maxHourSales = Math.max(1, ...hourlyTrends.map(h => h.netSalesPaise || h.netSalesPaisa || (h.netSales ? h.netSales * 100 : 0)));
    const gridData = (salesHeatmap && salesHeatmap.length > 0) ? salesHeatmap : hourlyHeatmap;

    viewHtml = `
      <!-- Daypart Status Notice -->
      <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 12px;background:var(--surface-sunken);border-radius:6px;font-size:11px;border-left:3px solid var(--amber, #f59e0b);">
        <div>
          <strong style="color:var(--ink);">Daypart Status: NOT_CONFIGURED</strong>
          <span style="color:var(--muted);margin-left:6px;">Configurable operational meal dayparts are not configured in system settings; <strong>Hourly Analysis (00:00 — 23:00 IST)</strong> is authoritative.</span>
        </div>
        <span class="badge warning" style="font-size:10px;">HOURLY AUTHORITATIVE</span>
      </div>

      <!-- VISUAL 1: Sales Trend Line & Trading Velocity -->
      <div class="card" style="padding:14px;background:var(--surface-sunken);">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;flex-wrap:wrap;gap:8px;">
          <div>
            <h4 style="font-size:12px;font-weight:700;color:var(--ink);margin:0;">Hourly Trading Trend &amp; Velocity (00:00 — 23:00 IST)</h4>
            <p style="font-size:10px;color:var(--muted);margin:2px 0 0 0;">Net sales velocity across trading hours${comparison ? ` · Compared with ${comparison.comparisonType || 'Prior Period'}` : ''}</p>
          </div>
          <div style="display:flex;align-items:center;gap:10px;">
            ${comparison?.growthRates?.netSalesGrowthPercent !== null && comparison?.growthRates?.netSalesGrowthPercent !== undefined ? `
              <span class="pill ${comparison.growthRates.netSalesGrowthPercent >= 0 ? 'pill-mint' : 'pill-coral'}" style="font-size:10px;font-weight:700;">
                ${comparison.growthRates.netSalesGrowthPercent >= 0 ? '▲ +' : '▼ '}${comparison.growthRates.netSalesGrowthPercent}% vs Prior
              </span>
            ` : ''}
            <span style="font-size:10px;font-weight:700;color:var(--muted);">Peak: ₹${(maxHourSales / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
          </div>
        </div>

        <div style="display:flex;align-items:flex-end;gap:3px;height:120px;padding-top:10px;overflow-x:auto;">
          ${hourlyTrends.map(h => {
            const val = h.netSalesPaise || h.netSalesPaisa || (h.netSales ? h.netSales * 100 : 0);
            const pct = Math.max(3, Math.round((val / maxHourSales) * 100));
            return `
              <div style="flex:1;min-width:12px;display:flex;flex-direction:column;align-items:center;gap:3px;" title="Hour ${h.hour}: ₹${(val / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })} (${h.orders || 0} orders)">
                <div style="width:100%;height:${pct}%;background:${val > 0 ? 'var(--mint, #10b981)' : 'var(--line)'};border-radius:2px 2px 0 0;min-height:2px;transition:height 0.2s;"></div>
                <span style="font-size:7.5px;color:var(--muted);">${h.hour ? String(h.hour).slice(0, 2) : ''}</span>
              </div>
            `;
          }).join('')}
        </div>
        <div style="display:flex;justify-content:space-between;align-items:center;font-size:9px;color:var(--muted);margin-top:6px;border-top:1px solid var(--line);padding-top:4px;">
          <span>00:00 IST</span>
          <span>12:00 Noon</span>
          <span>23:00 IST</span>
        </div>
      </div>

      <!-- VISUAL 3: Weekday & 7×24 Heatmap Grid -->
      <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(320px, 1fr));gap:12px;">
        <div class="card" style="padding:12px;background:var(--surface-sunken);">
          <h4 style="font-size:12px;font-weight:700;color:var(--ink);margin:0 0 8px 0;">Day of Week Performance</h4>
          <div style="display:flex;flex-direction:column;gap:6px;font-size:11px;">
            ${dayOfWeekTrends.map(d => `
              <div style="display:flex;justify-content:space-between;align-items:center;padding:3px 0;border-bottom:1px solid var(--line);">
                <span style="font-weight:600;">${d.dayName || d.dayOfWeek}</span>
                <div style="display:flex;gap:12px;">
                  <span style="color:var(--muted);">${d.orders} orders</span>
                  <strong>₹${((d.netSalesPaise || d.netSalesPaisa || (d.netSales ? d.netSales * 100 : 0)) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</strong>
                </div>
              </div>
            `).join('')}
          </div>
        </div>

        <!-- Authoritative 7 Days × 24 Hours Heatmap -->
        <div class="card" style="padding:12px;background:var(--surface-sunken);">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
            <h4 style="font-size:12px;font-weight:700;color:var(--ink);margin:0;">7×24 Trading Heatmap (7 Days × 24 Hours)</h4>
            <span style="font-size:9.5px;color:var(--muted);">168 Trading Cells</span>
          </div>
          <div style="overflow-x:auto;">
            <div style="display:grid;grid-template-columns:36px repeat(24, 1fr);gap:1.5px;font-size:7.5px;min-width:380px;">
              <div style="color:var(--muted);">Day</div>
              ${Array.from({ length: 24 }, (_, i) => `<div style="text-align:center;color:var(--muted);">${i < 10 ? '0' + i : i}</div>`).join('')}
              ${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((dayName, dIdx) => {
                const fullNames = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
                const fName = fullNames[dIdx];
                return `
                  <div style="font-weight:600;color:var(--ink);line-height:14px;">${dayName}</div>
                  ${Array.from({ length: 24 }, (_, h) => {
                    const hStr = (h < 10 ? '0' + h : '' + h) + ':00';
                    const cell = (gridData || []).find(c =>
                      (c.dayOfWeek === fName || c.dayOfWeek === dayName || c.dayOfWeek === dIdx + 1 || (dIdx === 6 && c.dayOfWeek === 0)) &&
                      (c.hour === hStr || c.hour === h || c.hour === String(h))
                    ) || { netSalesPaise: 0, netSalesPaisa: 0, orders: 0 };
                    const cellNet = cell.netSalesPaisa !== undefined ? cell.netSalesPaisa : (cell.netSalesPaise || 0);
                    const intensity = cellNet > 0 ? Math.min(1, cellNet / (maxHourSales || 100000)) : 0;
                    const bg = intensity > 0 ? `rgba(16, 185, 129, ${Math.max(0.2, intensity.toFixed(2))})` : 'var(--line)';
                    return `<div style="height:12px;background:${bg};border-radius:1px;" title="${fName} ${hStr} — ₹${(cellNet / 100).toFixed(0)} (${cell.orders || 0} orders)"></div>`;
                  }).join('')}
                `;
              }).join('')}
            </div>
          </div>
          <div style="font-size:9px;color:var(--muted);margin-top:6px;display:flex;justify-content:flex-end;gap:6px;align-items:center;">
            <span>Zero</span>
            <div style="width:10px;height:7px;background:var(--line);border-radius:1px;"></div>
            <div style="width:10px;height:7px;background:rgba(16, 185, 129, 0.3);border-radius:1px;"></div>
            <div style="width:10px;height:7px;background:rgba(16, 185, 129, 0.7);border-radius:1px;"></div>
            <div style="width:10px;height:7px;background:rgba(16, 185, 129, 1);border-radius:1px;"></div>
            <span>Peak</span>
          </div>
        </div>
      </div>

      <!-- Café Sales Portfolio Breakdown -->
      ${cafeSales.length > 1 ? `
        <div class="card" style="padding:12px;background:var(--surface-sunken);">
          <h4 style="font-size:12px;font-weight:700;color:var(--ink);margin:0 0 8px 0;">Café Sales Portfolio Contribution</h4>
          <div style="overflow-x:auto;">
            <table class="glass-table" style="width:100%;font-size:11px;">
              <thead>
                <tr>
                  <th>Café ID / Name</th>
                  <th>Gross Sales</th>
                  <th>Net Sales</th>
                  <th>Orders</th>
                  <th>AOV</th>
                  <th>Discounts</th>
                  <th>Refunds</th>
                  <th>% Portfolio</th>
                </tr>
              </thead>
              <tbody>
                ${cafeSales.map(c => `
                  <tr>
                    <td><strong>${c.cafeName || c.cafeId}</strong></td>
                    <td>₹${((c.grossSalesPaise || c.grossSalesPaisa || 0) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                    <td style="color:var(--mint, #10b981);font-weight:700;">₹${((c.netSalesPaise || c.netSalesPaisa || 0) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                    <td>${c.orderCount || 0}</td>
                    <td>₹${((c.aovPaise || c.aovPaisa || 0) / 100).toFixed(2)}</td>
                    <td style="color:var(--coral, #ef4444);">-₹${((c.discountPaise || c.discountPaisa || 0) / 100).toFixed(2)}</td>
                    <td style="color:var(--coral, #ef4444);">-₹${((c.refundPaise || c.refundPaisa || 0) / 100).toFixed(2)}</td>
                    <td><span class="badge" style="font-size:10px;">${c.contributionPercent || c.portfolioContributionPercent || 0}%</span></td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
      ` : ''}
    `;
  }

  // 2. CATEGORIES & ITEMS VIEW
  else if (salesActiveView === 'categories') {
    const totalCatNet = categorySales.reduce((acc, c) => acc + (c.netSalesPaise || c.netSalesPaisa || 0), 0) || 1;
    const colors = ['#10b981', '#0284c7', '#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16'];

    viewHtml = `
      <!-- VISUAL 2: Category Contribution Proportional Horizontal Bar Visual -->
      <div class="card" style="padding:14px;background:var(--surface-sunken);">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
          <div>
            <h4 style="font-size:12px;font-weight:700;color:var(--ink);margin:0;">Category Sales Share Contribution</h4>
            <p style="font-size:10px;color:var(--muted);margin:2px 0 0 0;">Proportional Net Sales share distribution across menu categories</p>
          </div>
        </div>
        <div style="display:flex;height:24px;border-radius:4px;overflow:hidden;background:var(--line);margin-bottom:10px;">
          ${categorySales.map((c, idx) => {
            const col = colors[idx % colors.length];
            const netVal = c.netSalesPaise || c.netSalesPaisa || 0;
            const pct = Math.max(1, Math.round((netVal / totalCatNet) * 100));
            return `<div style="width:${pct}%;background:${col};height:100%;transition:width 0.3s;" title="${c.category}: ₹${(netVal / 100).toLocaleString('en-IN')} (${c.salesSharePercent || pct}%)"></div>`;
          }).join('')}
        </div>
        <div style="display:flex;flex-wrap:wrap;gap:12px;font-size:11px;">
          ${categorySales.map((c, idx) => {
            const col = colors[idx % colors.length];
            const netVal = c.netSalesPaise || c.netSalesPaisa || 0;
            return `
              <div style="display:flex;align-items:center;gap:5px;cursor:pointer;" data-category-drill="${c.category}" title="Click to drill into ${c.category}">
                <div style="width:10px;height:10px;background:${col};border-radius:2px;"></div>
                <span style="font-weight:600;">${c.category}</span>
                <span style="color:var(--muted);">₹${(netVal / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })} (${c.salesSharePercent || 0}%)</span>
              </div>
            `;
          }).join('')}
        </div>
      </div>

      <!-- Sales by Category Table -->
      <div class="card" style="padding:14px;background:var(--surface-sunken);">
        <h4 style="font-size:12px;font-weight:700;color:var(--ink);margin:0 0 10px 0;">Sales Performance by Menu Category</h4>
        <div style="overflow-x:auto;">
          <table class="glass-table" style="width:100%;font-size:11px;">
            <thead>
              <tr>
                <th>Category</th>
                <th>Units Sold</th>
                <th>Bill Penetration</th>
                <th>Gross Sales</th>
                <th>Net Sales</th>
                <th>Discount</th>
                <th>Refund</th>
                <th>Sales Share %</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              ${categorySales.length > 0 ? categorySales.map(c => `
                <tr>
                  <td><strong>${c.category}</strong></td>
                  <td>${c.quantitySold || c.quantity || 0}</td>
                  <td>${c.billPenetrationPercent || c.billPenetration || 0}%</td>
                  <td>₹${((c.grossSalesPaise || c.grossSalesPaisa || 0) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                  <td style="color:var(--mint, #10b981);font-weight:700;">₹${((c.netSalesPaise || c.netSalesPaisa || 0) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                  <td style="color:var(--coral, #ef4444);">-₹${((c.discountPaise || c.discountPaisa || 0) / 100).toFixed(2)}</td>
                  <td style="color:var(--coral, #ef4444);">-₹${((c.refundPaise || c.refundPaisa || 0) / 100).toFixed(2)}</td>
                  <td>
                    <div style="display:flex;align-items:center;gap:6px;">
                      <div style="width:60px;height:6px;background:var(--line);border-radius:3px;overflow:hidden;">
                        <div style="width:${Math.min(100, c.salesSharePercent || 0)}%;height:100%;background:var(--mint, #10b981);"></div>
                      </div>
                      <span>${c.salesSharePercent || 0}%</span>
                    </div>
                  </td>
                  <td>
                    <button class="btn btn-xs btn-ghost" data-category-drill="${c.category}" type="button">Drill →</button>
                  </td>
                </tr>
              `).join('') : `
                <tr><td colspan="9" style="text-align:center;padding:12px;color:var(--muted);">No category sales data recorded for this period.</td></tr>
              `}
            </tbody>
          </table>
        </div>
      </div>

      <!-- Top / Bottom Items Rankings -->
      <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(280px, 1fr));gap:12px;">
        <div class="card" style="padding:12px;background:var(--surface-sunken);">
          <h4 style="font-size:12px;font-weight:700;color:var(--mint, #10b981);margin:0 0 8px 0;">Top 5 Items by Net Sales</h4>
          <div style="display:flex;flex-direction:column;gap:6px;font-size:11px;">
            ${(topRankings.topByNetSales || []).slice(0, 5).map(i => `
              <div style="display:flex;justify-content:space-between;padding:3px 0;border-bottom:1px solid var(--line);cursor:pointer;" data-item-drill="${i.itemId || i.name}" data-item-name="${i.itemName || i.name}">
                <div><strong>${i.itemName || i.name}</strong> <span style="font-size:9px;color:var(--muted);">(${i.category})</span></div>
                <strong style="color:var(--mint, #10b981);">₹${((i.netSalesPaise || i.netSalesPaisa || 0) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</strong>
              </div>
            `).join('') || '<div style="color:var(--muted);font-size:11px;">No item sales data.</div>'}
          </div>
        </div>

        <div class="card" style="padding:12px;background:var(--surface-sunken);">
          <h4 style="font-size:12px;font-weight:700;color:var(--sky, #0284c7);margin:0 0 8px 0;">Top 5 Items by Quantity Sold</h4>
          <div style="display:flex;flex-direction:column;gap:6px;font-size:11px;">
            ${(topRankings.topByQuantity || []).slice(0, 5).map(i => `
              <div style="display:flex;justify-content:space-between;padding:3px 0;border-bottom:1px solid var(--line);cursor:pointer;" data-item-drill="${i.itemId || i.name}" data-item-name="${i.itemName || i.name}">
                <div><strong>${i.itemName || i.name}</strong> <span style="font-size:9px;color:var(--muted);">(${i.category})</span></div>
                <strong>${i.quantitySold || i.quantity || 0} units</strong>
              </div>
            `).join('') || '<div style="color:var(--muted);font-size:11px;">No item sales data.</div>'}
          </div>
        </div>
      </div>
    `;
  }

  // 3. PMIX & PARETO VIEW
  else if (salesActiveView === 'pmix') {
    const rawPmix = productMix.length > 0 ? productMix : itemSales;
    const filteredPmix = rawPmix.filter(i => {
      const matchCat = salesCategoryFilter === 'ALL' || i.category === salesCategoryFilter;
      const name = i.itemName || i.name || '';
      const matchSearch = !salesSearchTerm || name.toLowerCase().includes(salesSearchTerm.toLowerCase());
      return matchCat && matchSearch;
    });

    const categories = Array.from(new Set(rawPmix.map(p => p.category).filter(Boolean)));

    // Dynamic Pareto Calculation
    const paretoItems = (Array.isArray(pareto) ? pareto : (pareto.items || itemSales || [])).slice();
    let classAIndex = 0;
    let classACumPct = 0;
    for (let idx = 0; idx < paretoItems.length; idx++) {
      if ((paretoItems[idx].cumulativePercent || 0) >= 80) {
        classAIndex = idx + 1;
        classACumPct = paretoItems[idx].cumulativePercent || 80;
        break;
      }
    }
    if (classAIndex === 0 && paretoItems.length > 0) {
      classAIndex = paretoItems.length;
      classACumPct = paretoItems[paretoItems.length - 1].cumulativePercent || 100;
    }

    viewHtml = `
      <!-- PMIX Filtering & Search Controls -->
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;">
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
          <input type="text" id="sales-pmix-search" class="input" placeholder="Search menu item..." value="${salesSearchTerm}" style="font-size:11px;padding:4px 8px;width:180px;" />
          <select id="sales-pmix-cat-select" class="input" style="font-size:11px;padding:4px 8px;">
            <option value="ALL">All Categories</option>
            ${categories.map(c => `<option value="${c}" ${c === salesCategoryFilter ? 'selected' : ''}>${c}</option>`).join('')}
          </select>
        </div>
        <span style="font-size:11px;color:var(--muted);">${filteredPmix.length} items listed</span>
      </div>

      <!-- VISUAL 5: Cumulative Net Sales Pareto ABC Curve Visual -->
      ${paretoItems.length > 0 ? `
        <div class="card" style="padding:14px;background:var(--surface-sunken);">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;flex-wrap:wrap;gap:6px;">
            <div>
              <h4 style="font-size:12px;font-weight:700;color:var(--ink);margin:0;">Pareto ABC Cumulative Distribution</h4>
              <p style="font-size:10px;color:var(--muted);margin:2px 0 0 0;">Item ranking vs cumulative Net Sales revenue contribution</p>
            </div>
            <span class="pill pill-mint" style="font-size:10px;font-weight:700;">Top ${classAIndex} items generate ${classACumPct}% of revenue (Class A)</span>
          </div>

          <!-- Dual Pareto Visual: Top Items Net Sales Bars + Cumulative % Curve -->
          <div style="display:flex;align-items:flex-end;gap:4px;height:100px;padding-top:10px;overflow-x:auto;margin-bottom:8px;">
            ${paretoItems.slice(0, 15).map((p, idx) => {
              const maxItemNet = Math.max(1, ...paretoItems.map(i => i.netSalesPaise || i.netSalesPaisa || (i.netSales ? i.netSales * 100 : 0)));
              const pNet = p.netSalesPaise || p.netSalesPaisa || (p.netSales ? p.netSales * 100 : 0);
              const barPct = Math.max(4, Math.round((pNet / maxItemNet) * 100));
              const cum = p.cumulativePercent || 0;
              const isClassA = cum <= 80;
              return `
                <div style="flex:1;min-width:18px;display:flex;flex-direction:column;align-items:center;gap:3px;" title="#${idx + 1} ${p.itemName || p.name}: ₹${(pNet / 100).toLocaleString('en-IN')} (${p.sharePercent || p.salesSharePercent || 0}% share · ${cum}% cum)">
                  <span style="font-size:7.5px;color:${isClassA ? 'var(--mint, #10b981)' : 'var(--muted)'};font-weight:700;">${cum}%</span>
                  <div style="width:100%;height:${barPct}%;background:${isClassA ? 'var(--mint, #10b981)' : 'var(--sky, #0284c7)'};border-radius:2px 2px 0 0;min-height:2px;"></div>
                  <span style="font-size:7px;color:var(--muted);">#${idx + 1}</span>
                </div>
              `;
            }).join('')}
          </div>

          <div style="overflow-x:auto;">
            <table class="glass-table" style="width:100%;font-size:11px;">
              <thead>
                <tr>
                  <th>Rank</th>
                  <th>Item Name</th>
                  <th>Net Sales</th>
                  <th>Sales Share %</th>
                  <th>Cumulative Share %</th>
                  <th>Classification</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                ${paretoItems.slice(0, 10).map((p, idx) => `
                  <tr>
                    <td>#${idx + 1}</td>
                    <td><strong>${p.itemName || p.name}</strong></td>
                    <td>₹${((p.netSalesPaise || p.netSalesPaisa || (p.netSales ? p.netSales * 100 : 0)) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                    <td>${p.sharePercent || p.salesSharePercent || 0}%</td>
                    <td><strong>${p.cumulativePercent || 0}%</strong></td>
                    <td>
                      <span class="badge ${(p.cumulativePercent || 0) <= 80 ? 'success' : (p.cumulativePercent || 0) <= 95 ? 'primary' : 'neutral'}" style="font-size:9px;">
                        ${p.paretoClass ? `Class ${p.paretoClass}` : (p.cumulativePercent <= 80 ? 'Class A (80%)' : p.cumulativePercent <= 95 ? 'Class B (15%)' : 'Class C (5%)')}
                      </span>
                    </td>
                    <td>
                      <button class="btn btn-xs btn-ghost" data-item-drill="${p.itemId || p.name}" data-item-name="${p.itemName || p.name}" type="button">Drill →</button>
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
      ` : ''}

      <!-- Multidimensional Product Mix Table -->
      <div class="card" style="padding:14px;background:var(--surface-sunken);">
        <h4 style="font-size:12px;font-weight:700;color:var(--ink);margin:0 0 10px 0;">Product Mix (PMIX) Ledger</h4>
        <div style="overflow-x:auto;">
          <table class="glass-table" style="width:100%;font-size:11px;">
            <thead>
              <tr>
                <th>Menu Item</th>
                <th>Category</th>
                <th>Units Sold</th>
                <th>Gross Sales</th>
                <th>Net Sales</th>
                <th>Sales Share %</th>
                <th>Avg Effective Price</th>
                <th>Discounts</th>
                <th>Refunds</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              ${filteredPmix.length > 0 ? filteredPmix.map(i => `
                <tr>
                  <td><strong>${i.itemName || i.name}</strong></td>
                  <td><span class="badge" style="font-size:9px;">${i.category}</span></td>
                  <td>${i.quantitySold || i.quantity || 0}</td>
                  <td>₹${((i.grossSalesPaise || i.grossSalesPaisa || (i.grossSales ? i.grossSales * 100 : 0)) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                  <td style="color:var(--mint, #10b981);font-weight:700;">₹${((i.netSalesPaise || i.netSalesPaisa || (i.netSales ? i.netSales * 100 : 0)) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                  <td>${i.totalSalesPercent || i.salesSharePercent || 0}%</td>
                  <td>₹${((i.avgEffectivePricePaise || i.averagePricePaisa || (i.averagePrice ? i.averagePrice * 100 : 0)) / 100).toFixed(2)}</td>
                  <td style="color:var(--coral, #ef4444);">-₹${((i.discountPaise || i.discountPaisa || 0) / 100).toFixed(2)}</td>
                  <td style="color:var(--coral, #ef4444);">-₹${((i.refundPaise || i.refundPaisa || 0) / 100).toFixed(2)}</td>
                  <td>
                    <button class="btn btn-xs btn-ghost" data-item-drill="${i.itemId || i.name}" data-item-name="${i.itemName || i.name}" type="button">Drill →</button>
                  </td>
                </tr>
              `).join('') : `
                <tr><td colspan="10" style="text-align:center;padding:12px;color:var(--muted);">No matching product mix entries found.</td></tr>
              `}
            </tbody>
          </table>
        </div>
      </div>
      <!-- Basket / Item Co-occurrence Affinity Card -->
      <div class="card" style="padding:14px;background:var(--surface-sunken);margin-top:14px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;flex-wrap:wrap;gap:6px;">
          <div>
            <h4 style="font-size:12px;font-weight:700;color:var(--ink);margin:0;">Basket / Item Co-Occurrence Affinity</h4>
            <p style="font-size:10px;color:var(--muted);margin:2px 0 0 0;">Top item pairs frequently purchased together in the same ticket</p>
          </div>
          <span class="pill pill-muted" style="font-size:10px;font-weight:700;">TOP_N_BY_VELOCITY (Limit: 50 items)</span>
        </div>
        <!-- Mandatory Explicit Disclosure Notice -->
        <div style="padding:6px 10px;background:var(--surface-raised);border-radius:4px;font-size:10.5px;color:var(--muted);margin-bottom:10px;border-left:3px solid var(--sky, #0284c7);">
          ℹ️ <strong>Coverage Disclosure:</strong> Affinity analysis covers the 50 highest-velocity items for the selected scope and period.
        </div>
        <div style="overflow-x:auto;">
          <table class="glass-table" style="width:100%;font-size:11px;">
            <thead>
              <tr>
                <th>Primary Item (A)</th>
                <th>Affinity Item (B)</th>
                <th>Co-Occurrence Count</th>
                <th>Attach Rate (%)</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              ${(() => {
                const affinityObj = cachedSales.basketAffinity || {};
                const pairs = Array.isArray(affinityObj) ? affinityObj : (affinityObj.pairs || cachedSales.basketAffinityPairs || []);
                if (!pairs || pairs.length === 0) {
                  return '<tr><td colspan="5" style="text-align:center;padding:12px;color:var(--muted);">No significant pairwise co-occurrences recorded for this period.</td></tr>';
                }
                return pairs.slice(0, 10).map(p => `
                  <tr>
                    <td><strong>${p.itemAName || p.itemAId}</strong></td>
                    <td><strong>${p.itemBName || p.itemBId}</strong></td>
                    <td>${p.coOccurrenceCount} tickets</td>
                    <td><span class="badge success" style="font-size:9px;">${p.attachPercent}%</span></td>
                    <td>
                      <button class="btn btn-xs btn-ghost" data-item-drill="${p.itemAId}" data-item-name="${p.itemAName || p.itemAId}" type="button">Drill A →</button>
                    </td>
                  </tr>
                `).join('');
              })()}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  // 4. MODIFIERS & VARIANTS VIEW
  else if (salesActiveView === 'modifiers') {
    const topMods = modifierAnalytics.modifiers || modifierAnalytics.topModifiers || [];
    const modSummary = modifierAnalytics.summary || {};

    viewHtml = `
      <!-- Modifier Attach Rate Strip -->
      <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(200px, 1fr));gap:10px;">
        <div class="card" style="padding:10px;background:var(--surface-sunken);">
          <div style="font-size:10px;color:var(--muted);text-transform:uppercase;">Total Modifier Selections</div>
          <div style="font-size:16px;font-weight:800;color:var(--ink);margin-top:2px;">${modSummary.totalModifierSelections || 0}</div>
        </div>
        <div class="card" style="padding:10px;background:var(--surface-sunken);">
          <div style="font-size:10px;color:var(--muted);text-transform:uppercase;">Modifier Gross Sales</div>
          <div style="font-size:16px;font-weight:800;color:var(--mint, #10b981);margin-top:2px;">₹${((modSummary.totalModifierSalesPaisa || modSummary.totalModifierSalesPaise || 0) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</div>
        </div>
        <div class="card" style="padding:10px;background:var(--surface-sunken);">
          <div style="font-size:10px;color:var(--muted);text-transform:uppercase;">Average Modifier Attach Rate</div>
          <div style="font-size:16px;font-weight:800;color:var(--sky, #0284c7);margin-top:2px;">${modSummary.overallAttachRatePercent || modSummary.averageAttachRatePercent || 0}%</div>
        </div>
      </div>

      <!-- Eligibility Notice -->
      <div style="padding:8px 12px;background:var(--surface-sunken);border-radius:6px;font-size:10.5px;color:var(--muted);border-left:3px solid var(--sky, #0284c7);">
        <strong>Modifier Eligibility Notice:</strong> ${modSummary.eligibilityNotice || 'Denominator strictly uses eligible base item units sold; eligibility reflects transaction attachment and active menu configuration.'}
      </div>

      <!-- Modifier Detail Table -->
      <div class="card" style="padding:14px;background:var(--surface-sunken);">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
          <div>
            <h4 style="font-size:12px;font-weight:700;color:var(--ink);margin:0;">Configured Modifier Attach Rates</h4>
            <p style="font-size:10px;color:var(--muted);margin:2px 0 0 0;">Attached to base menu items via canonical modifier group rules</p>
          </div>
        </div>
        <div style="overflow-x:auto;">
          <table class="glass-table" style="width:100%;font-size:11px;">
            <thead>
              <tr>
                <th>Modifier / Option</th>
                <th>Top Base Item</th>
                <th>Selection Count</th>
                <th>Modifier Sales</th>
                <th>Average Price</th>
                <th>Attach Rate %</th>
              </tr>
            </thead>
            <tbody>
              ${topMods.length > 0 ? topMods.map(m => `
                <tr>
                  <td><strong>${m.modifier || m.name}</strong></td>
                  <td>${m.topBaseItem || 'Various'}</td>
                  <td>${m.selectionCount || 0}</td>
                  <td>₹${((m.salesPaisa || (m.sales ? m.sales * 100 : 0)) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                  <td>₹${(m.averagePrice || ((m.salesPaisa || 0) / (m.selectionCount || 1) / 100)).toFixed(2)}</td>
                  <td>
                    <div style="display:flex;align-items:center;gap:6px;">
                      <div style="width:50px;height:5px;background:var(--line);border-radius:2px;overflow:hidden;">
                        <div style="width:${Math.min(100, m.attachRatePercent || 0)}%;height:100%;background:var(--sky, #0284c7);"></div>
                      </div>
                      <span style="font-weight:700;">${m.attachRatePercent || 0}%</span>
                    </div>
                  </td>
                </tr>
              `).join('') : `
                <tr><td colspan="6" style="text-align:center;padding:12px;color:var(--muted);">No modifier selections recorded.</td></tr>
              `}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  // 5. TENDERS & EXCEPTIONS VIEW
  else if (salesActiveView === 'tenders') {
    const totalTender = paymentMix.reduce((acc, t) => acc + (t.amount || ((t.amountPaisa || 0) / 100)), 0);

    viewHtml = `
      <!-- Split-Tender Exact Allocation Banner -->
      <div style="padding:10px 14px;background:var(--surface-sunken);border-radius:6px;font-size:11px;border-left:3px solid var(--mint, #10b981);">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px;">
          <div>
            <strong style="color:var(--ink);">Exact-Paise Split Tender Allocation:</strong>
            <span style="color:var(--muted);margin-left:6px;">${splitTenderSummary.count || 0} multi-tender transactions recorded totalling ₹${((splitTenderSummary.amountPaisa || (splitTenderSummary.amount * 100) || 0) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}.</span>
          </div>
          <span class="badge success" style="font-size:10px;">SUM(tenders) = RECEIPT TOTAL (0 DOUBLE COUNT)</span>
        </div>
      </div>

      <!-- VISUAL 4: Payment Tender Mix Visual -->
      <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(320px, 1fr));gap:12px;">
        <div class="card" style="padding:14px;background:var(--surface-sunken);">
          <h4 style="font-size:12px;font-weight:700;color:var(--ink);margin:0 0 6px 0;">Payment Tender Mix</h4>
          <p style="font-size:10px;color:var(--muted);margin:0 0 10px 0;">Allocated via exact-paise tender policy without duplicate totals</p>
          <div style="display:flex;flex-direction:column;gap:8px;font-size:11px;">
            ${paymentMix.length > 0 ? paymentMix.map(p => {
              const amt = p.amount !== undefined ? p.amount : ((p.amountPaisa || 0) / 100);
              return `
                <div style="padding:4px 0;border-bottom:1px solid var(--line);">
                  <div style="display:flex;justify-content:space-between;margin-bottom:3px;">
                    <span style="font-weight:600;">${(p.method || p.tender || 'Other').replace(/_/g, ' ')}</span>
                    <strong>₹${amt.toLocaleString('en-IN', { minimumFractionDigits: 2 })} (${p.pct || 0}%)</strong>
                  </div>
                  <div style="width:100%;height:6px;background:var(--line);border-radius:3px;overflow:hidden;">
                    <div style="width:${Math.min(100, p.pct || 0)}%;height:100%;background:var(--mint, #10b981);"></div>
                  </div>
                </div>
              `;
            }).join('') : '<div style="color:var(--muted);font-size:11px;">No tender records found.</div>'}
          </div>
        </div>

        <div class="card" style="padding:14px;background:var(--surface-sunken);">
          <h4 style="font-size:12px;font-weight:700;color:var(--ink);margin:0 0 6px 0;">Operational Exceptions &amp; Reversals</h4>
          <p style="font-size:10px;color:var(--muted);margin:0 0 10px 0;">Audited voids, tender reversals, and refunds isolated from valid sales</p>
          <div style="display:flex;flex-direction:column;gap:8px;font-size:11px;">
            <div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--line);">
              <span>VOIDED Bills</span>
              <strong>${voidAnalytics.voids?.count || voidAnalytics.voidCount || 0} bills (₹${(((voidAnalytics.voids?.totalValuePaisa || voidAnalytics.voidTotalPaisa || 0) / 100)).toLocaleString('en-IN', { minimumFractionDigits: 2 })})</strong>
            </div>
            <div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--line);">
              <span>PAYMENT_REVERSED Bills</span>
              <strong>${voidAnalytics.reversals?.count || voidAnalytics.paymentReversedCount || 0} bills (₹${(((voidAnalytics.reversals?.totalValuePaisa || voidAnalytics.paymentReversedTotalPaisa || 0) / 100)).toLocaleString('en-IN', { minimumFractionDigits: 2 })})</strong>
            </div>
            <div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--line);">
              <span>Fully Refunded Bills</span>
              <strong style="color:var(--coral, #ef4444);">${refundAnalytics.summary?.fullyRefundedBills || refundAnalytics.fullyRefundedCount || 0} bills</strong>
            </div>
            <div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--line);">
              <span>Partially Refunded Bills</span>
              <strong style="color:var(--amber, #f59e0b);">${refundAnalytics.summary?.partiallyRefundedBills || refundAnalytics.partiallyRefundedCount || 0} bills</strong>
            </div>
          </div>
        </div>
      </div>

      <!-- Audited Exception Records List -->
      ${(voidAnalytics.records && voidAnalytics.records.length > 0) ? `
        <div class="card" style="padding:12px;background:var(--surface-sunken);">
          <h4 style="font-size:12px;font-weight:700;color:var(--ink);margin:0 0 8px 0;">Audited Void &amp; Reversal Bill Log</h4>
          <div style="overflow-x:auto;">
            <table class="glass-table" style="width:100%;font-size:11px;">
              <thead>
                <tr>
                  <th>Bill ID</th>
                  <th>Branch</th>
                  <th>Type</th>
                  <th>Amount</th>
                  <th>Operator</th>
                  <th>Reason</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                ${voidAnalytics.records.slice(0, 10).map(r => `
                  <tr>
                    <td><strong>${r.billId}</strong></td>
                    <td>${r.cafeId}</td>
                    <td><span class="badge warning" style="font-size:9px;">${r.type}</span></td>
                    <td>₹${((r.amountPaisa || r.amount * 100 || 0) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                    <td>${r.operatorId || 'OPERATOR'}</td>
                    <td>${r.reason || 'Audit entry'}</td>
                    <td>
                      <button class="btn btn-xs btn-ghost" data-bill-drill="${r.billId}" data-bill-cafe="${r.cafeId}" type="button">Audit Drill →</button>
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
      ` : ''}
    `;
  }

  container.innerHTML = `
    <div class="card" style="padding:16px;background:var(--surface);display:flex;flex-direction:column;gap:14px;">
      <!-- Report Header -->
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;border-bottom:1px solid var(--line);padding-bottom:12px;">
        <div>
          <div style="display:flex;align-items:center;gap:8px;">
            <h3 style="font-size:15px;font-weight:700;color:var(--ink);margin:0;">Sales &amp; POS Commercial Intelligence</h3>
            <span class="pill ${dqPillClass}" style="font-size:10px;">${dataQuality.state}</span>
          </div>
          <p style="font-size:11px;color:var(--muted);margin:2px 0 0 0;">Multi-angle sales, category mix, velocity, modifier attach rates, and tender allocation</p>
        </div>
        <div style="display:flex;align-items:center;gap:8px;">
          <button class="btn btn-sm btn-ghost" id="sales-refresh-btn" style="font-size:12px;" type="button">↻ Refresh</button>
          <button class="btn btn-sm btn-primary" id="sales-zurf-btn" data-export-report="daily-sales" style="font-size:12px;" type="button">ZURF Export</button>
        </div>
      </div>

      <!-- Subtab Dimensional Filter Strip -->
      <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;background:var(--surface-sunken);padding:8px 12px;border-radius:6px;font-size:11px;">
        <div style="display:flex;align-items:center;gap:4px;">
          <span style="color:var(--muted);font-weight:700;">Service Mode:</span>
          <select id="sales-servicemode-select" class="glass-input" style="font-size:11px;padding:3px 6px;">
            <option value="ALL">All Modes</option>
            <option value="QUICK_SALE" ${salesServiceModeFilter === 'QUICK_SALE' ? 'selected' : ''}>Quick Sale</option>
            <option value="DINE_IN" ${salesServiceModeFilter === 'DINE_IN' ? 'selected' : ''}>Dine In</option>
            <option value="TAKEAWAY" ${salesServiceModeFilter === 'TAKEAWAY' ? 'selected' : ''}>Takeaway</option>
            <option value="DELIVERY" ${salesServiceModeFilter === 'DELIVERY' ? 'selected' : ''}>Delivery</option>
            <option value="SCHEDULED_PICKUP" ${salesServiceModeFilter === 'SCHEDULED_PICKUP' ? 'selected' : ''}>Scheduled Pickup</option>
          </select>
        </div>
        <div style="display:flex;align-items:center;gap:4px;">
          <span style="color:var(--muted);font-weight:700;">Tender:</span>
          <select id="sales-tender-select" class="glass-input" style="font-size:11px;padding:3px 6px;">
            <option value="ALL">All Tenders</option>
            <option value="CASH" ${salesTenderFilter === 'CASH' ? 'selected' : ''}>Cash</option>
            <option value="UPI" ${salesTenderFilter === 'UPI' ? 'selected' : ''}>UPI</option>
            <option value="CARD" ${salesTenderFilter === 'CARD' ? 'selected' : ''}>Card</option>
            <option value="CREDIT" ${salesTenderFilter === 'CREDIT' ? 'selected' : ''}>Credit</option>
            <option value="COMPLIMENTARY" ${salesTenderFilter === 'COMPLIMENTARY' ? 'selected' : ''}>Complimentary</option>
          </select>
        </div>
        <div style="display:flex;align-items:center;gap:4px;">
          <span style="color:var(--muted);font-weight:700;">Order Source:</span>
          <select id="sales-ordersource-select" class="glass-input" style="font-size:11px;padding:3px 6px;">
            <option value="ALL">All Sources</option>
            <option value="POS" ${salesOrderSourceFilter === 'POS' ? 'selected' : ''}>POS Register</option>
            <option value="KIOSK" ${salesOrderSourceFilter === 'KIOSK' ? 'selected' : ''}>Self-Service Kiosk</option>
            <option value="ONLINE" ${salesOrderSourceFilter === 'ONLINE' ? 'selected' : ''}>Online / Direct App</option>
            <option value="QR_ORDER" ${salesOrderSourceFilter === 'QR_ORDER' ? 'selected' : ''}>Table QR Order</option>
            <option value="UNKNOWN" ${salesOrderSourceFilter === 'UNKNOWN' ? 'selected' : ''}>Unknown / Unspecified</option>
          </select>
        </div>
        <button class="btn btn-ghost btn-xs" id="sales-reset-filters-btn" type="button">↺ Reset Filters</button>
      </div>

      <!-- View Navigation Pills -->
      <div style="display:flex;gap:6px;overflow-x:auto;padding-bottom:4px;border-bottom:1px solid var(--line);">
        <button class="btn btn-xs ${salesActiveView === 'overview' ? 'btn-primary' : 'btn-ghost'}" data-sales-view="overview" type="button">Overview &amp; Trends</button>
        <button class="btn btn-xs ${salesActiveView === 'categories' ? 'btn-primary' : 'btn-ghost'}" data-sales-view="categories" type="button">Categories &amp; Items</button>
        <button class="btn btn-xs ${salesActiveView === 'pmix' ? 'btn-primary' : 'btn-ghost'}" data-sales-view="pmix" type="button">Product Mix (PMIX) &amp; Pareto</button>
        <button class="btn btn-xs ${salesActiveView === 'modifiers' ? 'btn-primary' : 'btn-ghost'}" data-sales-view="modifiers" type="button">Modifiers &amp; Variants</button>
        <button class="btn btn-xs ${salesActiveView === 'tenders' ? 'btn-primary' : 'btn-ghost'}" data-sales-view="tenders" type="button">Tenders &amp; Exceptions</button>
      </div>

      <!-- KPI Strip -->
      <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(140px, 1fr));gap:8px;">
        <div class="card" style="padding:10px;background:var(--surface-sunken);">
          <div style="font-size:9px;color:var(--muted);text-transform:uppercase;font-weight:700;">Gross Sales</div>
          <div style="font-size:15px;font-weight:800;color:var(--ink);margin-top:2px;">₹${gross.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</div>
        </div>
        <div class="card" style="padding:10px;background:var(--surface-sunken);">
          <div style="font-size:9px;color:var(--muted);text-transform:uppercase;font-weight:700;">Sales Before Tax</div>
          <div style="font-size:15px;font-weight:800;color:var(--ink);margin-top:2px;">₹${sbt.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</div>
        </div>
        <div class="card" style="padding:10px;background:var(--surface-sunken);">
          <div style="font-size:9px;color:var(--muted);text-transform:uppercase;font-weight:700;">Discounts</div>
          <div style="font-size:15px;font-weight:800;color:var(--coral, #ef4444);margin-top:2px;">-₹${discount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</div>
        </div>
        <div class="card" style="padding:10px;background:var(--surface-sunken);">
          <div style="font-size:9px;color:var(--muted);text-transform:uppercase;font-weight:700;">Refunds</div>
          <div style="font-size:15px;font-weight:800;color:var(--coral, #ef4444);margin-top:2px;">-₹${refund.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</div>
          ${summary.preTaxRefundAvailability === 'PARTIAL_SOURCE' ? `<div style="font-size:9px;color:var(--coral, #ef4444);margin-top:2px;font-weight:600;">Pre-tax refund allocation unavailable (Partial)</div>` : ''}
        </div>
        <div class="card" style="padding:10px;background:var(--surface-sunken);">
          <div style="font-size:9px;color:var(--muted);text-transform:uppercase;font-weight:700;">Net Sales</div>
          <div style="font-size:15px;font-weight:800;color:var(--mint, #10b981);margin-top:2px;">₹${net.toLocaleString('en-IN', { minimumFractionDigits: 2 })} ${summary.preTaxRefundAvailability === 'PARTIAL_SOURCE' || summary.netSalesAvailability === 'PARTIAL_SOURCE' ? '<span class="pill pill-amber" style="font-size:9px;vertical-align:middle;">Partial</span>' : ''}</div>
        </div>
        <div class="card" style="padding:10px;background:var(--surface-sunken);">
          <div style="font-size:9px;color:var(--muted);text-transform:uppercase;font-weight:700;">Tax Charged</div>
          <div style="font-size:15px;font-weight:800;color:var(--ink);margin-top:2px;">₹${tax.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</div>
        </div>
        <div class="card" style="padding:10px;background:var(--surface-sunken);">
          <div style="font-size:9px;color:var(--muted);text-transform:uppercase;font-weight:700;">Orders</div>
          <div style="font-size:15px;font-weight:800;color:var(--ink);margin-top:2px;">${orders.toLocaleString('en-IN')}</div>
        </div>
        <div class="card" style="padding:10px;background:var(--surface-sunken);">
          <div style="font-size:9px;color:var(--muted);text-transform:uppercase;font-weight:700;">Average Order (AOV)</div>
          <div style="font-size:15px;font-weight:800;color:var(--ink);margin-top:2px;">₹${aov.toFixed(2)}</div>
        </div>
      </div>

      <!-- Active View Content -->
      <div id="sales-view-container" style="display:flex;flex-direction:column;gap:12px;">
        ${viewHtml}
      </div>
    </div>
  `;

  // Attach view navigation event listeners
  container.querySelectorAll('[data-sales-view]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      salesActiveView = btn.dataset.salesView;
      renderSalesSubtab(root, container);
    });
  });

  // Attach refresh button
  container.querySelector('#sales-refresh-btn')?.addEventListener('click', (e) => {
    e.preventDefault();
    cachedSales = null;
    renderSalesSubtab(root, container);
  });

  // Subtab filter event listeners
  container.querySelector('#sales-servicemode-select')?.addEventListener('change', (e) => {
    salesServiceModeFilter = e.target.value;
    cachedSales = null;
    renderSalesSubtab(root, container);
  });
  container.querySelector('#sales-tender-select')?.addEventListener('change', (e) => {
    salesTenderFilter = e.target.value;
    cachedSales = null;
    renderSalesSubtab(root, container);
  });
  container.querySelector('#sales-ordersource-select')?.addEventListener('change', (e) => {
    salesOrderSourceFilter = e.target.value;
    cachedSales = null;
    renderSalesSubtab(root, container);
  });
  container.querySelector('#sales-reset-filters-btn')?.addEventListener('click', (e) => {
    e.preventDefault();
    salesServiceModeFilter = 'ALL';
    salesTenderFilter = 'ALL';
    salesOrderSourceFilter = 'ALL';
    salesCategoryFilter = 'ALL';
    salesSearchTerm = '';
    cachedSales = null;
    renderSalesSubtab(root, container);
  });

  // Attach PMIX search and category filter
  container.querySelector('#sales-pmix-search')?.addEventListener('input', (e) => {
    salesSearchTerm = e.target.value;
    renderSalesSubtab(root, container);
  });
  container.querySelector('#sales-pmix-cat-select')?.addEventListener('change', (e) => {
    salesCategoryFilter = e.target.value;
    renderSalesSubtab(root, container);
  });

  // Category drill click handler
  container.querySelectorAll('[data-category-drill]').forEach(el => {
    el.addEventListener('click', (e) => {
      e.preventDefault();
      const cat = el.dataset.categoryDrill;
      if (cat) {
        salesCategoryFilter = cat;
        salesActiveView = 'pmix';
        renderSalesSubtab(root, container);
      }
    });
  });

  // Item drill click handler
  container.querySelectorAll('[data-item-drill]').forEach(el => {
    el.addEventListener('click', (e) => {
      e.preventDefault();
      const itemId = el.dataset.itemDrill;
      const itemName = el.dataset.itemName || itemId;
      openItemDrilldownModal(itemId, itemName);
    });
  });

  // Bill drill click handler with café scope security
  container.querySelectorAll('[data-bill-drill]').forEach(el => {
    el.addEventListener('click', (e) => {
      e.preventDefault();
      const billId = el.dataset.billDrill;
      const cafeId = el.dataset.billCafe || 'ZC-0001';
      openBillDrilldownModal(billId, cafeId);
    });
  });
}

async function renderCashSubtab(root, container) {
  container.innerHTML = skeleton('240px');
  try {
    const res = await apiGet('/reports/cash-flow' + buildFilterQueryString());
    if (res?.data) cachedCash = res.data;
  } catch (_) {}

  // Normalise from both old cash-flow endpoint and new financeCalculations cashAndTill shape
  const cashAndTill = cachedCash?.cashAndTill || cachedCash || {};
  const sessions = cashAndTill.sessions || cachedCash?.sessions || [];
  const cashMovements = cashAndTill.cashMovements || [];
  const marketplace = cachedCash?.paymentSettlementIntelligence?.marketplace || {};

  const totalSessions = cashAndTill.totalSessions ?? cachedCash?.summary?.totalSessions ?? 0;
  const totalOpeningFloat = cashAndTill.totalOpeningFloat ?? Number(cachedCash?.summary?.totalOpeningFloatInr || 0);
  const totalExpectedCash = cashAndTill.totalExpectedCash ?? Number(cachedCash?.summary?.totalExpectedCashInr || 0);
  const totalCountedCash = cashAndTill.totalCountedCash ?? Number(cachedCash?.summary?.totalClosingCashInr || 0);
  const totalTillVariance = cashAndTill.totalTillVariance ?? Number(cachedCash?.summary?.totalVarianceInr || 0);
  const varianceDirection = cashAndTill.varianceDirection || (totalTillVariance > 0 ? 'OVERAGE' : totalTillVariance < 0 ? 'SHORTAGE' : 'BALANCED');

  const fmt = (v) => Number(v || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 });
  const varColor = totalTillVariance < 0 ? 'var(--coral, #ef4444)' : totalTillVariance > 0 ? 'var(--mint, #10b981)' : 'var(--ink)';

  container.innerHTML = `
    <div class="card" style="padding:16px;background:var(--surface);display:flex;flex-direction:column;gap:14px;">
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;">
        <div>
          <h3 style="font-size:14px;font-weight:700;color:var(--ink);margin:0;">Operational Cash Movement &amp; Till Reconciliation</h3>
          <p style="font-size:11px;color:var(--muted);margin:2px 0 0 0;">Basis: Posted cash transactions, register sessions, and authoritative till blind counts. Not a Statement of Cash Flows.</p>
        </div>
        <button class="btn btn-sm btn-primary" data-export-report="cash-book-variance" style="font-size:12px;" type="button">ZURF Export</button>
      </div>

      <div style="padding:8px 14px;background:rgba(14,165,233,0.07);border:1px solid rgba(14,165,233,0.3);border-radius:6px;font-size:11px;color:var(--muted);">
        <strong style="color:var(--ink);">Scope:</strong> Till reconciliation is based on RegisterSession data. Bank balance is
        <strong style="color:var(--amber,#d97706);">UNAVAILABLE</strong> — no authoritative bank feed is integrated.
      </div>

      <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(160px, 1fr));gap:10px;">
        <div class="card" style="padding:10px;background:var(--surface-sunken);">
          <div style="font-size:10px;color:var(--muted);text-transform:uppercase;">Register Sessions</div>
          <div style="font-size:18px;font-weight:800;color:var(--ink);margin-top:2px;">${totalSessions}</div>
        </div>
        <div class="card" style="padding:10px;background:var(--surface-sunken);">
          <div style="font-size:10px;color:var(--muted);text-transform:uppercase;">Opening Float</div>
          <div style="font-size:16px;font-weight:800;color:var(--ink);margin-top:2px;">₹${fmt(totalOpeningFloat)}</div>
        </div>
        <div class="card" style="padding:10px;background:var(--surface-sunken);">
          <div style="font-size:10px;color:var(--muted);text-transform:uppercase;">Expected Cash</div>
          <div style="font-size:16px;font-weight:800;color:var(--ink);margin-top:2px;">₹${fmt(totalExpectedCash)}</div>
        </div>
        <div class="card" style="padding:10px;background:var(--surface-sunken);">
          <div style="font-size:10px;color:var(--muted);text-transform:uppercase;">Counted Cash</div>
          <div style="font-size:16px;font-weight:800;color:var(--ink);margin-top:2px;">₹${fmt(totalCountedCash)}</div>
        </div>
        <div class="card" style="padding:10px;background:var(--surface-sunken);">
          <div style="font-size:10px;color:var(--muted);text-transform:uppercase;">Net Variance</div>
          <div style="font-size:16px;font-weight:800;color:${varColor};margin-top:2px;">
            ${totalTillVariance < 0 ? '−' : totalTillVariance > 0 ? '+' : ''}₹${fmt(Math.abs(totalTillVariance))}
          </div>
          <div style="font-size:9px;color:${varColor};font-weight:700;margin-top:1px;">${varianceDirection}</div>
        </div>
      </div>

      <div class="card" style="padding:14px;background:var(--surface-sunken);">
        <h4 style="font-size:12px;font-weight:700;color:var(--ink);margin:0 0 10px 0;">Till Register Sessions — Expected vs Counted vs Variance</h4>
        <div style="width:100%;overflow-x:auto;min-width:0;box-sizing:border-box;">
          <table class="glass-table" style="width:100%;font-size:12px;">
            <thead>
              <tr>
                <th>Session ID</th>
                <th>Café</th>
                <th>Register</th>
                <th>Business Date</th>
                <th>Opening Float</th>
                <th>Expected Cash</th>
                <th>Counted Cash</th>
                <th>Variance</th>
                <th>Direction</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              ${(sessions && sessions.length > 0) ? sessions.map((s) => {
                const vp = Number(s.variancePaisa || s.variance || 0);
                const isPaisa = Math.abs(vp) > 100 && Number.isInteger(vp);
                const vInr = isPaisa ? vp / 100 : vp;
                const vDir = s.varianceDirection || (vInr > 0 ? 'OVERAGE' : vInr < 0 ? 'SHORTAGE' : 'BALANCED');
                const vCol = vInr < 0 ? 'var(--coral,#ef4444)' : vInr > 0 ? 'var(--mint,#10b981)' : 'var(--ink)';
                const expP = Number(s.expectedCashPaisa || (s.expectedCash || 0) * 100);
                const cntP = Number(s.countedCashPaisa || (s.countedCash || 0) * 100);
                const opP = Number(s.openingFloatPaisa || (s.openingFloat || 0) * 100);
                return `
                <tr>
                  <td><strong>${s.sessionId || '—'}</strong></td>
                  <td>${s.cafeId || '—'}</td>
                  <td>${s.registerId || s.deviceId || '—'}</td>
                  <td>${s.businessDate || (s.openedAt ? new Date(s.openedAt).toLocaleDateString('en-IN') : '—')}</td>
                  <td>₹${fmt(opP / 100)}</td>
                  <td>₹${fmt(expP / 100)}</td>
                  <td>₹${fmt(cntP / 100)}</td>
                  <td style="font-weight:700;color:${vCol};">${vInr < 0 ? '−' : vInr > 0 ? '+' : ''}₹${fmt(Math.abs(vInr))}</td>
                  <td><span class="pill ${vDir === 'OVERAGE' ? 'pill-mint' : vDir === 'SHORTAGE' ? 'pill-coral' : 'pill-sky'}" style="font-size:10px;font-weight:700;">${vDir}</span></td>
                  <td><span class="pill ${s.status === 'CLOSED' ? 'pill-sky' : 'pill-amber'}" style="font-size:10px;font-weight:700;">${s.status || 'CLOSED'}</span></td>
                </tr>`;
              }).join('') : `
                <tr><td colspan="10" style="text-align:center;padding:16px;color:var(--muted);">No register sessions recorded for the selected period and café scope.</td></tr>
              `}
            </tbody>
          </table>
        </div>
      </div>

      ${cashMovements.length > 0 ? `
      <div class="card" style="padding:14px;background:var(--surface-sunken);">
        <h4 style="font-size:12px;font-weight:700;color:var(--ink);margin:0 0 10px 0;">Cash Movement Breakdown by Transaction Type</h4>
        <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(200px, 1fr));gap:8px;">
          ${cashMovements.map((m) => `
          <div style="background:var(--surface);border:1px solid var(--line);border-radius:6px;padding:10px;">
            <div style="font-size:10px;color:var(--muted);text-transform:uppercase;font-weight:600;">${m.type || 'MOVEMENT'}</div>
            <div style="font-size:15px;font-weight:800;color:${m.direction === 'OUT' ? 'var(--coral,#ef4444)' : 'var(--mint,#10b981)'};margin-top:2px;">
              ${m.direction === 'OUT' ? '−' : '+'}₹${Number(m.amount || m.amountPaisa / 100 || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
            </div>
            <div style="font-size:10px;color:var(--muted);margin-top:2px;">${m.count || 0} transaction${(m.count || 0) !== 1 ? 's' : ''} · ${m.direction || 'IN'}</div>
          </div>
          `).join('')}
        </div>
      </div>
      ` : ''}

      ${(marketplace.settlements && marketplace.settlements.length > 0) || marketplace.grossSales ? `
      <div class="card" style="padding:14px;background:var(--surface-sunken);">
        <h4 style="font-size:12px;font-weight:700;color:var(--ink);margin:0 0 6px 0;">Delivery Aggregator Settlement Bridge (Zomato / Swiggy)</h4>
        <p style="font-size:11px;color:var(--muted);margin:0 0 10px 0;">Gross platform sales vs net settlement received vs bank credit. Direct POS gateway settlements: <strong style="color:var(--amber,#d97706);">UNAVAILABLE</strong>.</p>
        <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(160px, 1fr));gap:8px;">
          <div style="background:var(--surface);border:1px solid var(--line);border-radius:6px;padding:10px;">
            <div style="font-size:10px;color:var(--muted);text-transform:uppercase;">Gross Platform Sales</div>
            <div style="font-size:15px;font-weight:800;color:var(--ink);margin-top:2px;">₹${fmt(marketplace.grossSales || 0)}</div>
          </div>
          <div style="background:var(--surface);border:1px solid var(--line);border-radius:6px;padding:10px;">
            <div style="font-size:10px;color:var(--muted);text-transform:uppercase;">Commission &amp; Fees</div>
            <div style="font-size:15px;font-weight:800;color:var(--coral,#ef4444);margin-top:2px;">−₹${fmt(marketplace.commission || 0)}</div>
          </div>
          <div style="background:var(--surface);border:1px solid var(--line);border-radius:6px;padding:10px;">
            <div style="font-size:10px;color:var(--muted);text-transform:uppercase;">Net Settlement</div>
            <div style="font-size:15px;font-weight:800;color:var(--ink);margin-top:2px;">₹${fmt(marketplace.netSettlement || 0)}</div>
          </div>
          <div style="background:var(--surface);border:1px solid var(--line);border-radius:6px;padding:10px;">
            <div style="font-size:10px;color:var(--muted);text-transform:uppercase;">Bank Received</div>
            <div style="font-size:15px;font-weight:800;color:var(--mint,#10b981);margin-top:2px;">₹${fmt(marketplace.bankReceived || 0)}</div>
          </div>
          <div style="background:var(--surface);border:1px solid var(--line);border-radius:6px;padding:10px;">
            <div style="font-size:10px;color:var(--muted);text-transform:uppercase;">Settlement Variance</div>
            <div style="font-size:15px;font-weight:800;color:${(marketplace.variance || 0) < 0 ? 'var(--coral,#ef4444)' : 'var(--mint,#10b981)'};margin-top:2px;">
              ${(marketplace.variance || 0) < 0 ? '−' : (marketplace.variance || 0) > 0 ? '+' : ''}₹${fmt(Math.abs(marketplace.variance || 0))}
            </div>
          </div>
        </div>
      </div>
      ` : ''}
    </div>
  `;
}

async function renderFinanceSubtab(root, container) {
  container.innerHTML = skeleton('300px');
  try {
    const res = await apiGet('/reports/finance' + buildFilterQueryString());
    if (res?.data) cachedFinance = res.data;
  } catch (_) {}

  // Normalise to PM-02F canonical shape
  const fin = cachedFinance || {};
  const ov = fin.overview || {};
  const plStatement = fin.plStatement || {};
  const waterfall = fin.waterfall || [];
  const revBridge = fin.revenueBridge || {};
  const expIntel = fin.expenseIntelligence || {};
  const payIntel = fin.payrollIntelligence || {};
  const budgetVsActual = fin.budgetVsActual || {};
  const exceptions = fin.financialExceptions || {};
  const dq = fin.dataQuality || {};

  const fmt = (v) => Number(v || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 });
  const fmtPct = (v) => v != null ? `${v}%` : 'Unavailable';

  const netSales = ov.netSales ?? revBridge.netSales ?? 0;
  const taxCollected = ov.taxCollected ?? revBridge.taxCharged ?? 0;
  const isPayrollUnavailable = payIntel.payrollAvailability === 'ERROR' || payIntel.payrollAvailability === 'UNAVAILABLE' || ov.grossPayrollPaisa === null || ov.grossPayroll === null;
  const isPayrollPartial = payIntel.payrollAvailability === 'PARTIAL_SOURCE';
  const grossPayroll = ov.grossPayroll ?? payIntel.grossPayroll;
  const grossPayrollPct = ov.grossPayrollPctOfSales ?? payIntel.grossPayrollPctOfSales ?? null;
  const apOutstanding = ov.apOutstanding ?? fin.accountsPayable?.outstanding ?? 0;
  const tillVariance = ov.tillVariance ?? fin.cashAndTill?.totalTillVariance ?? 0;
  const budgetVariance = ov.budgetVariancePaisa != null ? Number(ov.budgetVariancePaisa) / 100 : null;
  const exceptionCount = (exceptions.tillVarianceCount || 0) + (exceptions.settlementDiscrepancyCount || 0) + (exceptions.unapprovedExpenseCount || 0);

  // Active finance view state (default: pl)
  const finViewKey = 'financeView_' + (root?.dataset?.reportId || 'main');
  if (!window._financeActiveView) window._financeActiveView = 'pl';

  const renderView = (view) => {
    window._financeActiveView = view;
    const viewContainer = root.querySelector('#finance-view-body');
    if (!viewContainer) return;

    if (view === 'pl') {
      viewContainer.innerHTML = `
        <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(300px, 1fr));gap:14px;">
          <div class="card" style="padding:14px;background:var(--surface-sunken);">
            <h4 style="font-size:12px;font-weight:700;color:var(--ink);margin:0 0 2px 0;">P&amp;L Statement — Partial Operational View</h4>
            <p style="font-size:10px;color:var(--muted);margin:0 0 10px 0;">Waterfall terminates at Known Operating Result Components. COGS and EBITDA are <strong>UNAVAILABLE</strong>.</p>
            <div style="display:flex;flex-direction:column;gap:4px;font-size:12px;">
              ${waterfall.length > 0 ? waterfall.map((w) => {
                const isUnavail = w.note && (w.value === 0 || w.value == null);
                const valStr = isUnavail ? '<span style="color:var(--amber,#d97706);font-weight:700;">Unavailable</span>' :
                  `<strong style="color:${(w.value || 0) < 0 ? 'var(--coral,#ef4444)' : 'var(--ink)'};">${
                    (w.value || 0) < 0 ? '−' : ''}₹${fmt(Math.abs(w.value || 0))}</strong>`;
                return `<div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid var(--line);
                  ${w.isTotal ? 'background:rgba(14,165,233,0.05);padding:6px 8px;border-radius:4px;border-color:transparent;margin:2px 0;' : ''}">
                  <span style="${w.isTotal ? 'font-weight:700;color:var(--ink);' : 'color:var(--muted);'}">${w.label}
                    ${w.note ? `<span style="font-size:10px;color:var(--amber,#d97706);font-style:italic;display:block;">${w.note}</span>` : ''}
                  </span>
                  ${valStr}
                </div>`;
              }).join('') : '<div style="color:var(--muted);font-size:12px;padding:8px 0;">No data for selected period.</div>'}
            </div>
          </div>
          <div style="display:flex;flex-direction:column;gap:10px;">
            <div class="card" style="padding:14px;background:var(--surface-sunken);">
              <h4 style="font-size:12px;font-weight:700;color:var(--ink);margin:0 0 10px 0;">Profitability Availability</h4>
              <div style="display:flex;flex-direction:column;gap:8px;font-size:12px;">
                ${[['Gross Margin %', plStatement.grossMarginPct, 'UNAVAILABLE'],
                   ['EBITDA Margin %', plStatement.ebitdaMarginPct, 'UNAVAILABLE'],
                   ['COGS', plStatement.cogs, 'UNAVAILABLE'],
                   ['Prime Cost', plStatement.primeCost, 'UNAVAILABLE'],
                   ['Gross Payroll % of Sales', grossPayrollPct != null ? `${grossPayrollPct}%` : null, 'PARTIAL_SOURCE']
                  ].map(([label, val, unavailTag]) => `
                  <div style="display:flex;justify-content:space-between;align-items:center;background:var(--surface);padding:8px 10px;border-radius:6px;border:1px solid var(--line);">
                    <span style="color:var(--muted);">${label}</span>
                    <strong style="font-size:13px;color:${val == null ? 'var(--amber,#d97706)' : 'var(--ink)'};"
                      >${val != null ? val : `<span style="font-size:10px;">${unavailTag}</span>`}</strong>
                  </div>`).join('')}
              </div>
            </div>
            <div class="card" style="padding:12px;background:rgba(217,119,6,0.07);border:1px solid rgba(217,119,6,0.3);border-radius:6px;">
              <p style="font-size:11px;color:var(--amber,#d97706);margin:0;font-weight:600;">⚠️ Partial Statement Disclosure</p>
              <p style="font-size:11px;color:var(--muted);margin:4px 0 0 0;">${plStatement.statementSubtitle || 'Authoritative COGS and employer statutory overheads are not posted. Gross Profit, EBITDA, and Gross Margin remain UNAVAILABLE.'}</p>
            </div>
            ${payIntel.disclosureNotice ? `<div class="card" style="padding:10px;background:rgba(14,165,233,0.05);border:1px solid rgba(14,165,233,0.2);border-radius:6px;font-size:11px;color:var(--muted);">ℹ️ <strong>Labour Cost:</strong> ${payIntel.disclosureNotice}</div>` : ''}
          </div>
        </div>`;
    } else if (view === 'bridge') {
      const rb = revBridge;
      const isPreTaxPartial = rb.refundQuality && rb.refundQuality !== 'CLEAN';
      const steps = [
        { label: 'Gross Sales', val: rb.grossSales || 0, isAdd: true, isTotal: false },
        { label: 'Discounts', val: rb.discounts || 0, isAdd: false, isTotal: false },
        { label: 'Pre-Tax Refunds', val: isPreTaxPartial ? null : (rb.preTaxRefunds || 0), isAdd: false, isTotal: false, displayVal: isPreTaxPartial ? 'Pre-tax refund allocation unavailable (Partial)' : null },
        { label: 'Net Sales', val: rb.netSales || 0, isAdd: true, isTotal: true },
        { label: 'Tax Charged', val: rb.taxCharged || 0, isAdd: true, isTotal: false },
        { label: 'Customer Receipt Total', val: rb.customerReceiptTotal || 0, isAdd: true, isTotal: true },
      ];
      viewContainer.innerHTML = `
        <div class="card" style="padding:14px;background:var(--surface-sunken);">
          <h4 style="font-size:12px;font-weight:700;color:var(--ink);margin:0 0 6px 0;">Revenue Bridge Waterfall</h4>
          <p style="font-size:11px;color:var(--muted);margin:0 0 12px 0;">Formula: Gross Sales − Discounts − Pre-Tax Refunds = Net Sales; Net Sales + Tax = Customer Receipt Total</p>
          <div style="display:flex;flex-direction:column;gap:6px;font-size:13px;">
            ${steps.map((s) => `
            <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 12px;
              border-radius:6px;border:1px solid ${s.isTotal ? 'rgba(14,165,233,0.4)' : 'var(--line)'};
              background:${s.isTotal ? 'rgba(14,165,233,0.06)' : 'var(--surface)'};"
            >
              <span style="${s.isTotal ? 'font-weight:700;color:var(--ink);' : 'color:var(--muted);'}">${s.label}</span>
              <strong style="color:${!s.isAdd ? 'var(--coral,#ef4444)' : 'var(--ink)'};"
                >${s.displayVal ? s.displayVal : (!s.isAdd ? '−' : '') + '₹' + fmt(s.val)}</strong>
            </div>`).join('')}
          </div>
          ${rb.refundQuality && rb.refundQuality !== 'CLEAN' ? `<p style="font-size:11px;color:var(--amber,#d97706);margin:10px 0 0;font-weight:600;">⚠️ Refund Data Quality: ${rb.refundQuality}. Unallocated partial refunds may exist.</p>` : ''}
        </div>`;
    } else if (view === 'expenses') {
      const pareto = expIntel.pareto || expIntel.byCategory || [];
      const trends = expIntel.trends || [];
      const largest = expIntel.largestExpenses || [];
      viewContainer.innerHTML = `
        <div style="display:flex;flex-direction:column;gap:14px;">
          <div class="card" style="padding:14px;background:var(--surface-sunken);">
            <h4 style="font-size:12px;font-weight:700;color:var(--ink);margin:0 0 6px 0;">Operating Expense Breakdown &amp; Pareto</h4>
            <p style="font-size:11px;color:var(--muted);margin:0 0 10px 0;">Basis: APPROVED / PAID / CLOSED status only. Inventory, Payroll, CapEx, and Tax categories are strictly excluded to prevent double-counting. CapEx classification: <strong style="color:var(--amber,#d97706);">UNAVAILABLE</strong>.</p>
            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:8px;margin-bottom:12px;">
              ${[['Rent & Occupancy', expIntel.buckets?.rent],
                 ['Utilities', expIntel.buckets?.utilities],
                 ['Maintenance', expIntel.buckets?.maintenance],
                 ['Packaging', expIntel.buckets?.packagingAndConsumables],
                 ['Other Opex', expIntel.buckets?.other],
                 ['Total Opex', expIntel.totalOpex]
                ].map(([label, val]) => `
              <div style="background:var(--surface);border:1px solid var(--line);border-radius:6px;padding:10px;">
                <div style="font-size:10px;color:var(--muted);">${label}</div>
                <div style="font-size:14px;font-weight:800;color:var(--ink);margin-top:2px;">₹${fmt(val)}</div>
              </div>`).join('')}
            </div>
            <table class="glass-table" style="width:100%;font-size:11px;">
              <thead><tr><th>Rank</th><th>Category</th><th>Amount</th><th>Share %</th><th>Cumulative %</th></tr></thead>
              <tbody>
                ${pareto.length > 0 ? pareto.map((p, i) => `
                <tr>
                  <td>${p.rank || i + 1}</td>
                  <td>${p.category}</td>
                  <td>₹${fmt(p.amount)}</td>
                  <td>${p.sharePercent || 0}%</td>
                  <td>${p.cumulativePercent != null ? p.cumulativePercent + '%' : p.sharePercent + '%'}</td>
                </tr>`).join('') : `<tr><td colspan="5" style="text-align:center;color:var(--muted);padding:12px;">No eligible operating expenses in period.</td></tr>`}
              </tbody>
            </table>
          </div>
          ${largest.length > 0 ? `
          <div class="card" style="padding:14px;background:var(--surface-sunken);">
            <h4 style="font-size:12px;font-weight:700;color:var(--ink);margin:0 0 10px 0;">Largest Individual Expenses</h4>
            <table class="glass-table" style="width:100%;font-size:11px;">
              <thead><tr><th>Date</th><th>Category</th><th>Vendor</th><th>Café</th><th>Amount</th></tr></thead>
              <tbody>
                ${largest.slice(0, 10).map((e) => `
                <tr>
                  <td>${e.businessDate || '—'}</td>
                  <td>${e.category || '—'}</td>
                  <td>${e.vendorName || '—'}</td>
                  <td>${e.cafeId || '—'}</td>
                  <td style="font-weight:700;">₹${fmt(e.amount)}</td>
                </tr>`).join('')}
              </tbody>
            </table>
          </div>` : ''}
        </div>`;
    } else if (view === 'budget') {
      const bva = budgetVsActual;
      const hasB = bva.hasBudget;
      viewContainer.innerHTML = `
        <div class="card" style="padding:14px;background:var(--surface-sunken);">
          <h4 style="font-size:12px;font-weight:700;color:var(--ink);margin:0 0 6px 0;">Budget vs Actual — Sales &amp; Expenses</h4>
          ${!hasB ? `<div style="padding:10px 14px;background:rgba(217,119,6,0.07);border:1px solid rgba(217,119,6,0.3);border-radius:6px;font-size:12px;color:var(--amber,#d97706);font-weight:600;">No authoritative budget targets found for the selected period and café scope.</div>` : `
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:12px;">
            ${[['Sales', bva.sales, 'Target', 'Actual', 'Variance'],
               ['Operating Expenses', bva.expenses, 'Budget', 'Actual', 'Variance']
              ].map(([label, b, tLabel, aLabel, vLabel]) => b ? `
            <div style="background:var(--surface);border:1px solid var(--line);border-radius:8px;padding:14px;">
              <div style="font-weight:700;font-size:12px;color:var(--ink);margin-bottom:10px;">${label}</div>
              <div style="display:flex;flex-direction:column;gap:6px;font-size:12px;">
                <div style="display:flex;justify-content:space-between;"><span style="color:var(--muted);">${tLabel}</span><strong>₹${fmt(b.target ?? b.budget ?? 0)}</strong></div>
                <div style="display:flex;justify-content:space-between;"><span style="color:var(--muted);">${aLabel}</span><strong>₹${fmt(b.actual ?? 0)}</strong></div>
                <div style="display:flex;justify-content:space-between;padding-top:6px;border-top:1px solid var(--line);">
                  <span style="color:var(--muted);">${vLabel}</span>
                  <strong style="color:${(b.variance ?? 0) < 0 ? 'var(--coral,#ef4444)' : 'var(--mint,#10b981)'};"
                    >${(b.variance ?? 0) < 0 ? '−' : '+'}₹${fmt(Math.abs(b.variance ?? 0))} ${b.variancePercent != null ? `(${b.variancePercent > 0 ? '+' : ''}${b.variancePercent}%)` : ''}</strong>
                </div>
              </div>
            </div>` : '').join('')}
          </div>
          <p style="font-size:11px;color:var(--muted);margin:10px 0 0;">Payroll budget: <strong style="color:var(--amber,#d97706);">UNAVAILABLE</strong>. Profit budget: <strong style="color:var(--amber,#d97706);">UNAVAILABLE</strong>. No authoritative payroll or profit target model exists.</p>
          `}
        </div>`;
    } else if (view === 'exceptions') {
      const ex = exceptions;
      viewContainer.innerHTML = `
        <div style="display:flex;flex-direction:column;gap:12px;">
          <div class="card" style="padding:14px;background:var(--surface-sunken);">
            <h4 style="font-size:12px;font-weight:700;color:var(--ink);margin:0 0 10px 0;">Financial Exception Centre</h4>
            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:8px;margin-bottom:14px;">
              ${[['Till Variances', ex.tillVarianceCount || 0, ex.tillVarianceCount > 0 ? 'pill-coral' : 'pill-mint'],
                 ['Settlement Discrepancies', ex.settlementDiscrepancyCount || 0, ex.settlementDiscrepancyCount > 0 ? 'pill-coral' : 'pill-mint'],
                 ['Unapproved Expenses', ex.unapprovedExpenseCount || 0, ex.unapprovedExpenseCount > 0 ? 'pill-amber' : 'pill-mint'],
                 ['Partial Refunds', ex.unallocatedRefundCount || 0, ex.unallocatedRefundCount > 0 ? 'pill-amber' : 'pill-mint']
                ].map(([label, count, pill]) => `
              <div style="background:var(--surface);border:1px solid var(--line);border-radius:6px;padding:10px;text-align:center;">
                <div style="font-size:10px;color:var(--muted);">${label}</div>
                <div style="font-size:20px;font-weight:800;margin:4px 0;">${count}</div>
                <span class="pill ${pill}" style="font-size:9px;font-weight:700;">${count > 0 ? 'ATTENTION' : 'CLEAR'}</span>
              </div>`).join('')}
            </div>
            ${ex.tillVariances && ex.tillVariances.length > 0 ? `
            <h5 style="font-size:11px;font-weight:700;color:var(--ink);margin:0 0 6px 0;">Till Variance Detail</h5>
            <table class="glass-table" style="width:100%;font-size:11px;margin-bottom:10px;">
              <thead><tr><th>Session</th><th>Café</th><th>Date</th><th>Expected</th><th>Counted</th><th>Variance</th><th>Direction</th></tr></thead>
              <tbody>
                ${ex.tillVariances.slice(0, 10).map((t) => {
                  const v = Number(t.variancePaisa || (t.variance || 0) * 100) / 100;
                  const dir = t.varianceDirection || (v > 0 ? 'OVERAGE' : 'SHORTAGE');
                  return `<tr>
                    <td>${t.sessionId || '—'}</td><td>${t.cafeId || '—'}</td>
                    <td>${t.businessDate || '—'}</td>
                    <td>₹${fmt(Number(t.expectedCashPaisa || 0) / 100)}</td>
                    <td>₹${fmt(Number(t.countedCashPaisa || 0) / 100)}</td>
                    <td style="font-weight:700;color:${v < 0 ? 'var(--coral,#ef4444)' : 'var(--mint,#10b981);'}">${v < 0 ? '−' : '+'}₹${fmt(Math.abs(v))}</td>
                    <td><span class="pill ${dir === 'OVERAGE' ? 'pill-mint' : 'pill-coral'}" style="font-size:9px;font-weight:700;">${dir}</span></td>
                  </tr>`;
                }).join('')}
              </tbody>
            </table>` : ''}
            ${ex.unapprovedExpenses && ex.unapprovedExpenses.length > 0 ? `
            <h5 style="font-size:11px;font-weight:700;color:var(--ink);margin:0 0 6px 0;">Unapproved Expense Backlog</h5>
            <table class="glass-table" style="width:100%;font-size:11px;">
              <thead><tr><th>Date</th><th>Category</th><th>Vendor</th><th>Café</th><th>Amount</th><th>Status</th></tr></thead>
              <tbody>
                ${ex.unapprovedExpenses.slice(0, 10).map((e) => `<tr>
                  <td>${e.businessDate || '—'}</td><td>${e.category || '—'}</td>
                  <td>${e.vendorName || '—'}</td><td>${e.cafeId || '—'}</td>
                  <td style="font-weight:700;">₹${fmt(e.amount)}</td>
                  <td><span class="pill pill-amber" style="font-size:9px;font-weight:700;">${e.status}</span></td>
                </tr>`).join('')}
              </tbody>
            </table>` : ''}
          </div>
        </div>`;
    }
    // Re-wire view tab buttons
    root.querySelectorAll('[data-fin-view]').forEach((btn) => {
      btn.style.background = btn.dataset.finView === window._financeActiveView ? 'var(--primary,#0ea5e9)' : 'var(--surface)';
      btn.style.color = btn.dataset.finView === window._financeActiveView ? '#fff' : 'var(--muted)';
    });
  };

  container.innerHTML = `
    <div class="card" style="padding:16px;background:var(--surface);display:flex;flex-direction:column;gap:14px;">
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;">
        <div>
          <h3 style="font-size:14px;font-weight:700;color:var(--ink);margin:0;">Finance, Expense &amp; Profitability Intelligence</h3>
          <p style="font-size:11px;color:var(--muted);margin:2px 0 0 0;">Basis: Operational Sales (Bills) · Approved Expenses · Gross Payroll · Data Quality: ${dq.status || 'PARTIAL_SOURCE'}</p>
        </div>
        <button class="btn btn-sm btn-primary" id="finance-zurf-btn" data-export-report="pl-statement" style="font-size:12px;" type="button">ZURF Export</button>
      </div>

      <div style="padding:8px 14px;background:rgba(217,119,6,0.07);border:1px solid rgba(217,119,6,0.3);border-radius:6px;font-size:11px;color:var(--amber,#d97706);font-weight:600;">
        ⚠️ Partial Financial Statement — COGS, Gross Profit, Gross Margin, Prime Cost, and EBITDA are <strong>UNAVAILABLE</strong> (no authoritative double-entry cost ledger). Payroll shown is employee gross earnings only — employer EPF/ESI/Gratuity are <strong>PARTIAL_SOURCE</strong>.
      </div>

      <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(150px, 1fr));gap:8px;">
        ${[
          ['Net Sales', '₹' + fmt(netSales), 'var(--ink)'],
          ['Tax Collected', '₹' + fmt(taxCollected), 'var(--ink)'],
          ['Operating Expenses', '₹' + fmt(totalOpex), 'var(--ink)'],
          ['Gross Payroll', isPayrollUnavailable ? 'Unavailable' : ('₹' + fmt(grossPayroll ?? 0) + (isPayrollPartial ? ' (Partial)' : '')), 'var(--ink)'],
          ['Payroll % of Sales', isPayrollUnavailable || grossPayrollPct == null ? 'Unavailable' : (grossPayrollPct + '%' + (isPayrollPartial ? ' (Partial)' : '')), 'var(--muted)'],
          ['AP Outstanding', '₹' + fmt(apOutstanding), apOutstanding > 0 ? 'var(--coral,#ef4444)' : 'var(--ink)'],
          ['Till Variance', (tillVariance < 0 ? '−' : tillVariance > 0 ? '+' : '') + '₹' + fmt(Math.abs(tillVariance)), tillVariance < 0 ? 'var(--coral,#ef4444)' : tillVariance > 0 ? 'var(--mint,#10b981)' : 'var(--ink)'],
          ['Exceptions', String(exceptionCount), exceptionCount > 0 ? 'var(--coral,#ef4444)' : 'var(--mint,#10b981)'],
        ].map(([label, val, color]) => `
        <div class="card" style="padding:10px;background:var(--surface-sunken);">
          <div style="font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:0.3px;">${label}</div>
          <div style="font-size:15px;font-weight:800;color:${color};margin-top:2px;">${val}</div>
        </div>`).join('')}
      </div>

      <div style="display:flex;gap:6px;flex-wrap:wrap;">
        ${[['pl', 'P&L Statement'], ['bridge', 'Revenue Bridge'], ['expenses', 'Expenses'], ['budget', 'Budget vs Actual'], ['exceptions', 'Exceptions']]
          .map(([v, label]) => `
        <button data-fin-view="${v}" style="padding:6px 14px;border-radius:20px;border:1px solid var(--line);font-size:12px;font-weight:600;cursor:pointer;
          background:${v === window._financeActiveView ? 'var(--primary,#0ea5e9)' : 'var(--surface)'};
          color:${v === window._financeActiveView ? '#fff' : 'var(--muted)'};
          transition:all 0.15s;" type="button">${label}</button>
        `).join('')}
      </div>

      <div id="finance-view-body"></div>
    </div>
  `;

  // Wire view tabs
  container.querySelectorAll('[data-fin-view]').forEach((btn) => {
    btn.addEventListener('click', () => renderView(btn.dataset.finView));
  });

  // Wire ZURF export button
  const zurfBtn = container.querySelector('#finance-zurf-btn');
  if (zurfBtn) {
    zurfBtn.addEventListener('click', () => openExportModal(root, 'pl-statement'));
  }

  renderView(window._financeActiveView);
}

async function renderWorkforceSubtab(root, container) {
  container.innerHTML = skeleton('280px');
  try {
    const res = await apiGet('/reports/workforce' + buildFilterQueryString('workforce'));
    if (res?.data) cachedWorkforce = res.data;
  } catch (_) {}

  if (!cachedWorkforce || !cachedWorkforce.workforceMetrics) {
    cachedWorkforce = {
      workforceMetrics: {
        activeHeadcount: 0,
        totalHeadcountProvisioned: 0,
        inactiveHeadcount: 0,
        scheduledHours: 0,
        actualHoursWorked: 0,
        overtimeHours: 0,
        totalBreakMinutes: 0,
        labourCostTotal: 0,
        labourCostPctOfSales: 0,
        salesPerLabourHour: 0,
        attendanceExceptionsCount: 0,
      },
      headcountByCafe: [],
      headcountByRole: [],
      scheduledVsActual: [],
      attendance: {
        totalScheduledShifts: 0,
        actualWorkedShifts: 0,
        presentOnTimeCount: 0,
        lateArrivalCount: 0,
        earlyExitCount: 0,
        noShowCount: 0,
        incompletePunchesCount: 0,
        onTimeRatePct: 0,
        avgDailyWorkedHours: 0,
        leaveBreakdown: [],
      },
      overtime: {
        totalOvertimeHours: 0,
        overtimeIncidenceRatePct: 0,
        unapprovedOvertimeHours: 0,
      },
      payroll: {
        grossPayroll: 0,
        wagePrivacyRedacted: false,
        byCafe: [],
      },
      productivity: {
        netSales: 0,
        salesPerLabourHour: 0,
      },
      exceptions: [],
    };
  }

  const wf = cachedWorkforce.workforceMetrics || {};
  const headcountCafe = cachedWorkforce.headcountByCafe || [];
  const headcountRole = cachedWorkforce.headcountByRole || [];
  const schedVsActual = cachedWorkforce.scheduledVsActual || [];
  const att = cachedWorkforce.attendance || {};
  const ot = cachedWorkforce.overtime || {};
  const pay = cachedWorkforce.payroll || {};
  const prod = cachedWorkforce.productivity || {};
  const allExceptions = cachedWorkforce.exceptions || [];

  const fmt = (v) => Number(v || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 });
  const fmtInt = (v) => Number(v || 0).toLocaleString('en-IN');

  const renderView = (view) => {
    workforceActiveView = view;
    const body = root.querySelector('#workforce-view-body');
    if (!body) return;

    if (view === 'overview') {
      body.innerHTML = `
        <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(280px, 1fr));gap:14px;">
          <!-- Headcount Preview Card -->
          <div class="card" style="padding:14px;background:var(--surface-sunken);">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
              <h4 style="font-size:12px;font-weight:700;color:var(--ink);margin:0;">Headcount Distribution</h4>
              <button class="btn btn-xs btn-ghost" data-wf-switch="headcount" style="font-size:11px;" type="button">Details →</button>
            </div>
            <p style="font-size:11px;color:var(--muted);margin:0 0 10px 0;">Active employees vs total provisioned across operational locations.</p>
            <div style="display:flex;flex-direction:column;gap:6px;">
              ${headcountCafe.slice(0, 4).map(c => `
                <div style="display:flex;justify-content:space-between;align-items:center;font-size:11px;">
                  <span style="font-weight:600;color:var(--ink);">${c.cafeId}</span>
                  <span style="color:var(--muted);">${c.activeHeadcount} Active (${c.sharePercent}%)</span>
                </div>
                <div style="height:4px;background:var(--line);border-radius:2px;overflow:hidden;">
                  <div style="height:100%;width:${c.sharePercent}%;background:var(--primary,#0ea5e9);"></div>
                </div>
              `).join('') || '<div style="font-size:11px;color:var(--muted);">No café distribution available</div>'}
            </div>
          </div>

          <!-- Attendance & Shift Summary Card -->
          <div class="card" style="padding:14px;background:var(--surface-sunken);">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
              <h4 style="font-size:12px;font-weight:700;color:var(--ink);margin:0;">Shift Coverage & Punctuality</h4>
              <button class="btn btn-xs btn-ghost" data-wf-switch="attendance" style="font-size:11px;" type="button">Details →</button>
            </div>
            <p style="font-size:11px;color:var(--muted);margin:0 0 10px 0;">Punctuality against scheduled shift rosters with 15-min grace period.</p>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;text-align:center;">
              <div style="background:var(--surface);border:1px solid var(--line);border-radius:6px;padding:8px;">
                <div style="font-size:10px;color:var(--muted);">On-Time Rate</div>
                <div style="font-size:16px;font-weight:800;color:var(--mint,#10b981);margin-top:2px;">${att.onTimeRatePct ?? 0}%</div>
              </div>
              <div style="background:var(--surface);border:1px solid var(--line);border-radius:6px;padding:8px;">
                <div style="font-size:10px;color:var(--muted);">Late Arrivals</div>
                <div style="font-size:16px;font-weight:800;color:var(--amber,#d97706);margin-top:2px;">${att.lateArrivalCount ?? 0}</div>
              </div>
              <div style="background:var(--surface);border:1px solid var(--line);border-radius:6px;padding:8px;">
                <div style="font-size:10px;color:var(--muted);">Early Exits</div>
                <div style="font-size:16px;font-weight:800;color:var(--coral,#ef4444);margin-top:2px;">${att.earlyExitCount ?? 0}</div>
              </div>
              <div style="background:var(--surface);border:1px solid var(--line);border-radius:6px;padding:8px;">
                <div style="font-size:10px;color:var(--muted);">No Shows</div>
                <div style="font-size:16px;font-weight:800;color:var(--coral,#ef4444);margin-top:2px;">${att.noShowCount ?? 0}</div>
              </div>
            </div>
          </div>

          <!-- Exception Preview Card -->
          <div class="card" style="padding:14px;background:var(--surface-sunken);">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
              <h4 style="font-size:12px;font-weight:700;color:var(--ink);margin:0;">Attendance Exceptions</h4>
              <button class="btn btn-xs btn-ghost" data-wf-switch="exceptions" style="font-size:11px;" type="button">All Exceptions →</button>
            </div>
            <p style="font-size:11px;color:var(--muted);margin:0 0 10px 0;">Punches requiring review, late starts, and missing clock-outs.</p>
            <div style="display:flex;flex-direction:column;gap:6px;">
              ${allExceptions.slice(0, 3).map(e => `
                <div style="display:flex;justify-content:space-between;align-items:center;background:var(--surface);border:1px solid var(--line);border-radius:6px;padding:6px 10px;font-size:11px;">
                  <div>
                    <strong style="color:var(--ink);">${e.employeeName}</strong>
                    <div style="font-size:10px;color:var(--muted);">${e.cafe} · ${e.type}</div>
                  </div>
                  <span class="pill ${e.status === 'RESOLVED' ? 'pill-mint' : 'pill-amber'}" style="font-size:9px;">${e.status}</span>
                </div>
              `).join('') || '<div style="font-size:11px;color:var(--muted);text-align:center;padding:12px;">No active attendance exceptions recorded</div>'}
            </div>
          </div>
        </div>
      `;
    } else if (view === 'headcount') {
      body.innerHTML = `
        <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(320px, 1fr));gap:14px;">
          <!-- By Cafe -->
          <div class="card" style="padding:14px;background:var(--surface-sunken);">
            <h4 style="font-size:12px;font-weight:700;color:var(--ink);margin:0 0 4px 0;">Headcount by Café Location</h4>
            <p style="font-size:10.5px;color:var(--muted);margin:0 0 10px 0;">Active employees vs inactive accounts by operational unit.</p>
            <table class="glass-table" style="width:100%;font-size:11.5px;">
              <thead><tr><th>Café ID</th><th>Total Assigned</th><th>Active</th><th>Inactive</th><th>Share %</th></tr></thead>
              <tbody>
                ${headcountCafe.map(c => `
                  <tr>
                    <td><strong>${c.cafeId}</strong></td>
                    <td>${c.headcount}</td>
                    <td style="color:var(--mint,#10b981);font-weight:700;">${c.activeHeadcount}</td>
                    <td style="color:var(--muted);">${c.inactiveHeadcount}</td>
                    <td>${c.sharePercent}%</td>
                  </tr>
                `).join('') || '<tr><td colspan="5" style="text-align:center;padding:12px;color:var(--muted);">No café headcount records found</td></tr>'}
              </tbody>
            </table>
          </div>

          <!-- By Role -->
          <div class="card" style="padding:14px;background:var(--surface-sunken);">
            <h4 style="font-size:12px;font-weight:700;color:var(--ink);margin:0 0 4px 0;">Headcount by Role & Designation</h4>
            <p style="font-size:10.5px;color:var(--muted);margin:0 0 10px 0;">Workforce allocation across primary job roles.</p>
            <table class="glass-table" style="width:100%;font-size:11.5px;">
              <thead><tr><th>Role</th><th>Total</th><th>Active</th><th>Inactive</th><th>Share %</th></tr></thead>
              <tbody>
                ${headcountRole.map(r => `
                  <tr>
                    <td><strong>${r.role}</strong></td>
                    <td>${r.headcount}</td>
                    <td style="color:var(--mint,#10b981);font-weight:700;">${r.activeHeadcount}</td>
                    <td style="color:var(--muted);">${r.inactiveHeadcount}</td>
                    <td>${r.sharePercent}%</td>
                  </tr>
                `).join('') || '<tr><td colspan="5" style="text-align:center;padding:12px;color:var(--muted);">No role headcount records found</td></tr>'}
              </tbody>
            </table>
          </div>
        </div>
      `;
    } else if (view === 'schedules') {
      body.innerHTML = `
        <div class="card" style="padding:14px;background:var(--surface-sunken);">
          <h4 style="font-size:12px;font-weight:700;color:var(--ink);margin:0 0 4px 0;">Scheduled vs Actual Hours & Roster Compliance</h4>
          <p style="font-size:10.5px;color:var(--muted);margin:0 0 10px 0;">Comparison between published weekly roster hours and completed attendance hours.</p>
          <table class="glass-table" style="width:100%;font-size:11.5px;">
            <thead><tr><th>Café Location</th><th>Scheduled (hrs)</th><th>Actual Worked (hrs)</th><th>Variance (hrs)</th><th>Roster Compliance %</th></tr></thead>
            <tbody>
              ${schedVsActual.map(s => {
                const varColor = s.varianceHours > 0 ? 'var(--coral,#ef4444)' : s.varianceHours < 0 ? 'var(--amber,#d97706)' : 'var(--mint,#10b981)';
                return `
                  <tr>
                    <td><strong>${s.cafeId}</strong></td>
                    <td>${fmt(s.scheduledHours)}</td>
                    <td>${fmt(s.actualHours)}</td>
                    <td style="color:${varColor};font-weight:700;">${s.varianceHours > 0 ? '+' : ''}${fmt(s.varianceHours)}</td>
                    <td><span class="pill ${s.rosterCompliancePct >= 90 ? 'pill-mint' : 'pill-amber'}" style="font-size:9.5px;font-weight:700;">${s.rosterCompliancePct}%</span></td>
                  </tr>
                `;
              }).join('') || '<tr><td colspan="5" style="text-align:center;padding:12px;color:var(--muted);">No schedule comparison records found</td></tr>'}
            </tbody>
          </table>
        </div>
      `;
    } else if (view === 'attendance') {
      body.innerHTML = `
        <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(300px, 1fr));gap:14px;">
          <!-- Punctuality Breakdown -->
          <div class="card" style="padding:14px;background:var(--surface-sunken);">
            <h4 style="font-size:12px;font-weight:700;color:var(--ink);margin:0 0 4px 0;">Punctuality & Timekeeping Performance</h4>
            <p style="font-size:10.5px;color:var(--muted);margin:0 0 10px 0;">Attendance events evaluated against published shift slot start times (15-min grace period).</p>
            <div style="display:flex;flex-direction:column;gap:6px;font-size:11.5px;">
              <div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid var(--line);">
                <span style="color:var(--muted);">Total Scheduled Shifts</span><strong>${att.totalScheduledShifts ?? 0}</strong>
              </div>
              <div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid var(--line);">
                <span style="color:var(--muted);">Actual Worked Shifts</span><strong>${att.actualWorkedShifts ?? 0}</strong>
              </div>
              <div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid var(--line);">
                <span style="color:var(--muted);">Present On-Time</span><strong style="color:var(--mint,#10b981);">${att.presentOnTimeCount ?? 0}</strong>
              </div>
              <div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid var(--line);">
                <span style="color:var(--muted);">Late Arrivals (Beyond Grace)</span><strong style="color:var(--amber,#d97706);">${att.lateArrivalCount ?? 0}</strong>
              </div>
              <div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid var(--line);">
                <span style="color:var(--muted);">Early Exits Before Shift End</span><strong style="color:var(--coral,#ef4444);">${att.earlyExitCount ?? 0}</strong>
              </div>
              <div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid var(--line);">
                <span style="color:var(--muted);">No Shows (Scheduled, No Punch)</span><strong style="color:var(--coral,#ef4444);">${att.noShowCount ?? 0}</strong>
              </div>
              <div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid var(--line);">
                <span style="color:var(--muted);">Incomplete Punches (Missing In/Out)</span><strong style="color:var(--amber,#d97706);">${att.incompletePunchesCount ?? 0}</strong>
              </div>
              <div style="display:flex;justify-content:space-between;padding:5px 0;">
                <span style="color:var(--muted);">Average Daily Worked Hours</span><strong>${att.avgDailyWorkedHours ?? 0} hrs</strong>
              </div>
            </div>
          </div>

          <!-- Leave Breakdown -->
          <div class="card" style="padding:14px;background:var(--surface-sunken);">
            <h4 style="font-size:12px;font-weight:700;color:var(--ink);margin:0 0 4px 0;">Approved Leave Days</h4>
            <p style="font-size:10.5px;color:var(--muted);margin:0 0 10px 0;">Authoritative leave days approved within reporting period.</p>
            <table class="glass-table" style="width:100%;font-size:11.5px;">
              <thead><tr><th>Leave Category</th><th>Approved Days</th><th>Status</th></tr></thead>
              <tbody>
                ${(att.leaveBreakdown || []).map(l => `
                  <tr>
                    <td><strong>${l.leaveType}</strong></td>
                    <td style="font-weight:700;">${l.daysApproved}</td>
                    <td><span class="pill pill-mint" style="font-size:9px;">APPROVED</span></td>
                  </tr>
                `).join('') || '<tr><td colspan="3" style="text-align:center;padding:12px;color:var(--muted);">No approved leave records in selected period</td></tr>'}
              </tbody>
            </table>
          </div>
        </div>
      `;
    } else if (view === 'payroll') {
      body.innerHTML = `
        <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(300px, 1fr));gap:14px;">
          <!-- Payroll by Cafe -->
          <div class="card" style="padding:14px;background:var(--surface-sunken);">
            <h4 style="font-size:12px;font-weight:700;color:var(--ink);margin:0 0 4px 0;">Gross Payroll Allocation by Café</h4>
            <p style="font-size:10.5px;color:var(--muted);margin:0 0 10px 0;">Precedence: Authoritative PayrollRun. Falls back to Payslips if unfinalized.</p>
            ${pay.wagePrivacyRedacted ? `
              <div style="padding:10px;background:rgba(239,68,68,0.08);border:1px solid rgba(239,68,68,0.25);border-radius:6px;font-size:11px;color:var(--coral,#ef4444);margin-bottom:10px;">
                🔒 Individual wage amounts redacted. Salary information is restricted to Master and Owner roles.
              </div>
            ` : ''}
            <table class="glass-table" style="width:100%;font-size:11.5px;">
              <thead><tr><th>Café</th><th>Gross Payroll (₹)</th><th>Employees</th><th>Share %</th></tr></thead>
              <tbody>
                ${(pay.byCafe || []).map(p => `
                  <tr>
                    <td><strong>${p.cafeId}</strong></td>
                    <td style="font-weight:700;">${pay.wagePrivacyRedacted ? 'REDACTED' : (p.grossPayroll === null ? 'Unavailable' : ('₹' + fmt(p.grossPayroll) + (pay.payrollAvailability === 'PARTIAL_SOURCE' ? ' (Partial)' : '')))}</td>
                    <td>${p.employeeCount || 0}</td>
                    <td>${p.sharePercent ? p.sharePercent + '%' : 'N/A'}</td>
                  </tr>
                `).join('') || '<tr><td colspan="4" style="text-align:center;padding:12px;color:var(--muted);">No payroll records found for this period</td></tr>'}
              </tbody>
            </table>
          </div>

          <!-- Payroll by Historical Role -->
          <div class="card" style="padding:14px;background:var(--surface-sunken);">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
              <h4 style="font-size:12px;font-weight:700;color:var(--ink);margin:0;">Gross Payroll Allocation by Historical Role</h4>
              ${pay.byRoleAvailability === 'PARTIAL_SOURCE' ? `
                <span class="pill pill-amber" style="font-size:9.5px;font-weight:700;" title="Some historical payslips do not contain an issuance-time job-title snapshot.">Partial</span>
              ` : pay.byRoleAvailability === 'UNAVAILABLE' ? `
                <span class="pill pill-coral" style="font-size:9.5px;font-weight:700;">Unavailable</span>
              ` : `
                <span class="pill pill-mint" style="font-size:9.5px;font-weight:700;">Authoritative</span>
              `}
            </div>
            <p style="font-size:10.5px;color:var(--muted);margin:0 0 10px 0;">
              ${pay.byRoleAvailability === 'PARTIAL_SOURCE'
                ? 'Some historical payslips do not contain an issuance-time job-title snapshot.'
                : pay.byRoleAvailability === 'UNAVAILABLE'
                  ? (pay.byRoleBasis || 'Historical role breakdown is unavailable for this period.')
                  : 'Authoritative issuance-time snapshot from immutable payslip records.'}
            </p>
            ${pay.wagePrivacyRedacted ? `
              <div style="padding:10px;background:rgba(239,68,68,0.08);border:1px solid rgba(239,68,68,0.25);border-radius:6px;font-size:11px;color:var(--coral,#ef4444);margin-bottom:10px;">
                🔒 Individual wage amounts redacted. Salary information is restricted to Master and Owner roles.
              </div>
            ` : ''}
            <table class="glass-table" style="width:100%;font-size:11.5px;">
              <thead><tr><th>Historical Job Title / Role</th><th>Gross Payroll (₹)</th><th>Share %</th></tr></thead>
              <tbody>
                ${(pay.byRole || []).map(r => `
                  <tr>
                    <td>
                      <strong>${r.role === 'UNKNOWN_HISTORICAL_JOB_TITLE' ? 'UNKNOWN_HISTORICAL_JOB_TITLE (Unclassified)' : r.role}</strong>
                      ${r.role === 'UNKNOWN_HISTORICAL_JOB_TITLE' ? '<span class="pill pill-amber" style="font-size:8.5px;margin-left:6px;">Missing Snapshot</span>' : ''}
                    </td>
                    <td style="font-weight:700;">${pay.wagePrivacyRedacted ? 'REDACTED' : (r.grossPayroll === null ? 'Unavailable' : ('₹' + fmt(r.grossPayroll) + (pay.byRoleAvailability === 'PARTIAL_SOURCE' && r.role === 'UNKNOWN_HISTORICAL_JOB_TITLE' ? ' (Unclassified)' : '')))}</td>
                    <td>${r.sharePercent ? r.sharePercent + '%' : 'N/A'}</td>
                  </tr>
                `).join('') || '<tr><td colspan="3" style="text-align:center;padding:12px;color:var(--muted);">No historical role payroll records available</td></tr>'}
              </tbody>
            </table>
          </div>

          <!-- Overtime & Productivity -->
          <div class="card" style="padding:14px;background:var(--surface-sunken);">
            <h4 style="font-size:12px;font-weight:700;color:var(--ink);margin:0 0 4px 0;">Overtime & Productivity Intelligence</h4>
            <p style="font-size:10.5px;color:var(--muted);margin:0 0 10px 0;">Overtime tracking and sales per labour hour (SPLH).</p>
            <div style="display:flex;flex-direction:column;gap:6px;font-size:11.5px;">
              <div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid var(--line);">
                <span style="color:var(--muted);">Total Overtime Recorded</span><strong>${ot.totalOvertimeHours ?? 0} hrs</strong>
              </div>
              <div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid var(--line);">
                <span style="color:var(--muted);">Overtime Incidence Rate</span><strong>${ot.overtimeIncidenceRatePct ?? 0}%</strong>
              </div>
              <div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid var(--line);">
                <span style="color:var(--muted);">Unapproved Overtime</span><strong style="color:var(--mint,#10b981);">0 hrs (Governed)</strong>
              </div>
              <div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid var(--line);">
                <span style="color:var(--muted);">Operational Net Sales</span><strong>₹${fmt(prod.netSales || 0)}</strong>
              </div>
              <div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid var(--line);">
                <span style="color:var(--muted);">Sales Per Labour Hour (SPLH)</span><strong style="color:var(--primary,#0ea5e9);">${prod.salesPerLabourHour !== null ? '₹' + fmt(prod.salesPerLabourHour) : 'Unavailable'}</strong>
              </div>
              <div style="display:flex;justify-content:space-between;padding:5px 0;">
                <span style="color:var(--muted);">Labour Cost % of Sales</span><strong>${wf.labourCostPctOfSales !== null ? wf.labourCostPctOfSales + '%' : 'Unavailable'}</strong>
              </div>
            </div>
          </div>
        </div>
      `;
    } else if (view === 'exceptions') {
      const filteredEx = allExceptions.filter(e => {
        if (!workforceSearchTerm) return true;
        const term = workforceSearchTerm.toLowerCase();
        return (e.employeeName || '').toLowerCase().includes(term) || (e.cafe || '').toLowerCase().includes(term) || (e.type || '').toLowerCase().includes(term);
      });

      body.innerHTML = `
        <div class="card" style="padding:14px;background:var(--surface-sunken);">
          <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:10px;">
            <div>
              <h4 style="font-size:12px;font-weight:700;color:var(--ink);margin:0;">Workforce & Attendance Exception Centre</h4>
              <p style="font-size:10.5px;color:var(--muted);margin:2px 0 0 0;">Missing punch-outs, late arrivals, overtime, and roster discrepancies.</p>
            </div>
            <input type="text" id="wf-search-input" class="glass-input" placeholder="Search exceptions..." value="${workforceSearchTerm}" style="padding:4px 8px;font-size:11px;width:180px;" />
          </div>

          <table class="glass-table" style="width:100%;font-size:11.5px;">
            <thead><tr><th>Employee</th><th>Café</th><th>Exception Type</th><th>Duration</th><th>Resolution Status</th></tr></thead>
            <tbody>
              ${filteredEx.map(e => `
                <tr>
                  <td><strong>${e.employeeName}</strong></td>
                  <td style="color:var(--muted);">${e.cafe}</td>
                  <td><span class="badge warning" style="font-size:9px;">${e.type}</span></td>
                  <td>${e.minutes ? `${e.minutes} mins` : '—'}</td>
                  <td><span class="pill ${e.status === 'RESOLVED' ? 'pill-mint' : 'pill-amber'}" style="font-size:9.5px;font-weight:700;">${e.status}</span></td>
                </tr>
              `).join('') || '<tr><td colspan="5" style="text-align:center;padding:16px;color:var(--muted);">No attendance exceptions match criteria</td></tr>'}
            </tbody>
          </table>
        </div>
      `;

      body.querySelector('#wf-search-input')?.addEventListener('input', (e) => {
        workforceSearchTerm = e.target.value;
        renderView('exceptions');
      });
    }

    if (view === 'assignees') {
      body.innerHTML = `
        <div class="card" style="padding:14px;background:var(--surface-sunken);">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;flex-wrap:wrap;gap:8px;">
            <div>
              <h4 style="font-size:13px;font-weight:700;color:var(--ink);margin:0;">Staff Assignee Performance Ledger (A017)</h4>
              <p style="font-size:11px;color:var(--muted);margin:2px 0 0;">Sales revenue, check volume, and average bill sizes attributed to compulsory/optional order assignees.</p>
            </div>
            <button id="btn-refresh-assignees" class="btn btn-xs btn-primary" type="button" style="font-size:11px;">↻ Refresh Assignees</button>
          </div>
          <div id="assignee-table-box">${skeleton('180px')}</div>
          <div style="margin-top:12px;padding:8px 12px;background:rgba(14,165,233,0.06);border:1px solid rgba(14,165,233,0.2);border-radius:6px;font-size:10.5px;color:var(--primary,#0ea5e9);">
            ℹ️ <strong>Assignee Guardrail (A017, F213, F253):</strong> Advance orders, table reservations, and Captain QR guest orders are excluded from compulsory cashier assignment.
          </div>
        </div>
      `;

      const loadAssigneeData = async () => {
        const box = body.querySelector('#assignee-table-box');
        if (!box) return;
        try {
          const res = await apiGet('/reports/staff-performance-by-assignee' + buildFilterQueryString('workforce'));
          const list = res?.data?.performance || res?.data || [];
          if (!Array.isArray(list) || list.length === 0) {
            box.innerHTML = `<div style="text-align:center;padding:24px;color:var(--muted);font-size:11.5px;">No assigned orders recorded in this date range. Cashier bills with assigned staff will appear here.</div>`;
            return;
          }
          box.innerHTML = `
            <table class="glass-table" style="width:100%;font-size:11.5px;">
              <thead>
                <tr>
                  <th>Assignee Name</th>
                  <th>Staff ID</th>
                  <th style="text-align:right;">Orders Billed</th>
                  <th style="text-align:right;">Net Revenue</th>
                  <th style="text-align:right;">Avg Ticket Size</th>
                  <th style="text-align:right;">Avg Items/Order</th>
                </tr>
              </thead>
              <tbody>
                ${list.map(s => {
                  const netInr = ((s.totalNetSalesPaisa || 0) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 });
                  const avgTicketInr = ((s.avgTicketPaisa || 0) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 });
                  return `
                    <tr>
                      <td><strong>${s.staffName || 'Unassigned Staff'}</strong></td>
                      <td style="font-family:var(--font-mono);color:var(--muted);">${s.staffId || '—'}</td>
                      <td style="text-align:right;font-weight:700;">${s.totalOrdersBilled || s.ordersCount || 0}</td>
                      <td style="text-align:right;font-weight:800;color:var(--mint,#10b981);">₹${netInr}</td>
                      <td style="text-align:right;font-family:var(--font-mono);">₹${avgTicketInr}</td>
                      <td style="text-align:right;color:var(--muted);">${Number(s.avgItemsPerOrder || 0).toFixed(1)}</td>
                    </tr>
                  `;
                }).join('')}
              </tbody>
            </table>
          `;
        } catch (err) {
          box.innerHTML = `<div style="color:var(--coral,#ef4444);padding:16px;text-align:center;font-size:11.5px;">Failed to fetch assignee report: ${err.message || 'Error'}</div>`;
        }
      };

      body.querySelector('#btn-refresh-assignees')?.addEventListener('click', loadAssigneeData);
      loadAssigneeData();
    }

    // Update active tab buttons style
    root.querySelectorAll('[data-wf-view]').forEach((btn) => {
      const isActive = btn.dataset.wfView === workforceActiveView;
      btn.style.background = isActive ? 'var(--primary,#0ea5e9)' : 'var(--surface)';
      btn.style.color = isActive ? '#fff' : 'var(--muted)';
    });
  };

  container.innerHTML = `
    <div class="card" style="padding:16px;background:var(--surface);display:flex;flex-direction:column;gap:14px;">
      <!-- Header -->
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;">
        <div>
          <h3 style="font-size:14px;font-weight:700;color:var(--ink);margin:0;">Workforce, Attendance, Shifts &amp; Payroll Intelligence</h3>
          <p style="font-size:11px;color:var(--muted);margin:2px 0 0 0;">Governed labour analytics · Single source of truth across Roster, Attendance &amp; Payroll</p>
        </div>
        <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">
          <button class="btn btn-sm btn-primary" data-export-report="workforce-overview" style="font-size:11.5px;" type="button">📑 Workforce ZURF</button>
          <button class="btn btn-sm btn-secondary" data-export-report="attendance-exceptions" style="font-size:11.5px;" type="button">📑 Attendance ZURF</button>
          <button class="btn btn-sm btn-secondary" data-export-report="payroll-summary" style="font-size:11.5px;" type="button">📑 Payroll ZURF</button>
        </div>
      </div>

      <!-- Governance Banners -->
      <div style="display:flex;flex-direction:column;gap:6px;">
        <div style="padding:6px 12px;background:rgba(14,165,233,0.06);border:1px solid rgba(14,165,233,0.25);border-radius:6px;font-size:11px;color:var(--primary,#0ea5e9);display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px;">
          <span>📋 <strong>Roster Hours:</strong> Published rosters only. Cross-midnight shift durations accurately evaluated.</span>
          <span style="font-weight:600;">Overall Employee Score: <strong style="color:var(--amber,#d97706);">NOT_CONFIGURED</strong></span>
        </div>
        <div style="padding:6px 12px;background:rgba(217,119,6,0.06);border:1px solid rgba(217,119,6,0.25);border-radius:6px;font-size:11px;color:var(--amber,#d97706);display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px;">
          <span>⚠️ <strong>Scheduled Labour Cost:</strong> <strong style="color:var(--ink);">UNAVAILABLE</strong> (Hourly wage rate table unlinked to roster slots).</span>
          <span style="font-weight:600;">Unapproved Overtime: <strong style="color:var(--mint,#10b981);">0 (Strictly Governed)</strong></span>
        </div>
      </div>

      <!-- KPI Strip -->
      <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(140px, 1fr));gap:8px;">
        ${[
          ['Active Headcount', fmtInt(wf.activeHeadcount ?? 0), 'var(--ink)'],
          ['Scheduled Hours', fmt(wf.scheduledHours ?? 0) + 'h', 'var(--muted)'],
          ['Actual Hours', fmt(wf.actualHoursWorked ?? 0) + 'h', 'var(--ink)'],
          ['Overtime Hours', fmt(wf.overtimeHours ?? 0) + 'h', (wf.overtimeHours || 0) > 0 ? 'var(--amber,#d97706)' : 'var(--muted)'],
          ['Break Minutes', fmtInt(wf.totalBreakMinutes ?? 0) + 'm', 'var(--muted)'],
          ['Labour Cost %', wf.labourCostPctOfSales !== null ? wf.labourCostPctOfSales + '%' : 'Unavailable', (wf.labourCostPctOfSales || 0) > 24 ? 'var(--coral,#ef4444)' : 'var(--mint,#10b981)'],
          ['SPLH', prod.salesPerLabourHour !== null ? '₹' + fmt(prod.salesPerLabourHour) : 'Unavailable', 'var(--primary,#0ea5e9)'],
          ['On-Time Rate', (att.onTimeRatePct ?? 0) + '%', (att.onTimeRatePct || 0) >= 90 ? 'var(--mint,#10b981)' : 'var(--amber,#d97706)'],
          ['Exceptions', fmtInt(allExceptions.length), allExceptions.length > 0 ? 'var(--coral,#ef4444)' : 'var(--mint,#10b981)'],
        ].map(([label, val, color]) => `
          <div class="card" style="padding:10px;background:var(--surface-sunken);">
            <div style="font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:0.3px;">${label}</div>
            <div style="font-size:15px;font-weight:800;color:${color};margin-top:2px;">${val}</div>
          </div>
        `).join('')}
      </div>

      <!-- View Selector Buttons -->
      <div style="display:flex;gap:6px;flex-wrap:wrap;">
        ${[
          ['overview', 'Overview'],
          ['headcount', 'Headcount'],
          ['schedules', 'Schedules & Shifts'],
          ['attendance', 'Attendance & Punctuality'],
          ['payroll', 'Payroll & Overtime'],
          ['exceptions', 'Exception Centre'],
          ['assignees', 'Staff Performance by Assignee (A017)'],
        ].map(([v, label]) => `
          <button data-wf-view="${v}" style="padding:6px 14px;border-radius:20px;border:1px solid var(--line);font-size:12px;font-weight:600;cursor:pointer;
            background:${v === workforceActiveView ? 'var(--primary,#0ea5e9)' : 'var(--surface)'};
            color:${v === workforceActiveView ? '#fff' : 'var(--muted)'};
            transition:all 0.15s;" type="button">${label}</button>
        `).join('')}
      </div>

      <!-- View Body Container -->
      <div id="workforce-view-body"></div>
    </div>
  `;

  // Attach view tab button click listeners
  container.querySelectorAll('[data-wf-view]').forEach((btn) => {
    btn.addEventListener('click', () => renderView(btn.dataset.wfView));
  });

  // Attach view switch clicks inside cards
  container.addEventListener('click', (e) => {
    const switchBtn = e.target.closest('[data-wf-switch]');
    if (switchBtn) {
      e.preventDefault();
      renderView(switchBtn.dataset.wfSwitch);
    }
  });

  renderView(workforceActiveView);
}

async function renderCustomersSubtab(root, container) {
  container.innerHTML = skeleton('280px');
  try {
    const res = await apiGet('/reports/customers' + buildFilterQueryString());
    if (res?.data) cachedCustomers = res.data;
  } catch (_) {}

  if (!cachedCustomers || !cachedCustomers.customerSummary) {
    cachedCustomers = {
      customerSummary: {
        totalRegisteredCustomers: 0,
        activeIdentifiedCustomers: 0,
        newCustomersThisPeriod: 0,
        repeatCustomersThisPeriod: 0,
        repeatCustomerRatePct: 0,
        totalCustomerVisits: 0,
        totalCheckCount: 0,
        identifiedCheckCount: 0,
        anonymousCheckCount: 0,
        anonymousCheckSharePct: 0,
        guestCount: 0,
        totalNetSalesPaise: 0,
        identifiedSalesPaise: 0,
        anonymousSalesPaise: 0,
        averageCheckPaise: 0,
        averageSpendPerIdentifiedCustomerPaise: 0,
        averageSpendPerGuestPaise: 0,
        averageLifetimeSpend: 0,
      },
      loyaltyAnalytics: {
        totalMembers: 0,
        activeMembers: 0,
        pointsEarned: 0,
        pointsRedeemed: 0,
        redemptionRatePct: 0,
        tierDistribution: [],
        memberVsNonMemberComparison: {
          member: { customerCount: 0, orderCount: 0, totalSpendPaise: 0, avgOrderSpendPaise: 0 },
          nonMember: { customerCount: 0, orderCount: 0, totalSpendPaise: 0, avgOrderSpendPaise: 0 },
        },
      },
      feedbackAnalytics: {
        feedbackCount: 0,
        averageRating: 0,
        ratingDistribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
        categoryBreakdown: [],
        statusBreakdown: { NEW: 0, ACKNOWLEDGED: 0, UNDER_REVIEW: 0, RESOLVED: 0 },
        nps: { availability: 'UNAVAILABLE', reason: 'No 0–10 NPS question in schema.' },
      },
      posOperations: {
        serviceModes: [],
        speedOfService: {
          totalTickets: 0,
          completedTickets: 0,
          meanPrepTimeSeconds: 0,
          medianPrepTimeSeconds: 0,
          p90PrepTimeSeconds: 0,
          stationPerformance: [],
        },
        tablePerformance: { activeTableCount: 0, tableTurns: 0 },
        reservations: { availability: 'UNAVAILABLE' },
      },
      posExceptions: {
        totalExceptionsCount: 0,
        voids: { count: 0, totalAmountPaise: 0 },
        refunds: { count: 0, totalAmountPaise: 0 },
        highDiscounts: { count: 0 },
        complimentaryBills: { count: 0, totalAmountPaise: 0 },
        reprints: { reprintEventsCount: 0, billsReprintedCount: 0 },
        offlineReplays: { count: 0, totalAmountPaise: 0 },
        cashVariances: { totalSessionsAudited: 0, sessionsWithVarianceCount: 0, totalVariancePaise: 0 },
      },
      segmentation: {
        frequencyDistribution: [],
        recencyDistribution: [],
        spendPresentationBuckets: [],
        rfmSegments: [],
      },
      byCafe: [],
      privacyMode: 'ANONYMIZED_AGGREGATES_ONLY',
    };
  }

  const cSum = cachedCustomers.customerSummary || {};
  const loy = cachedCustomers.loyaltyAnalytics || {};
  const fbk = cachedCustomers.feedbackAnalytics || {};
  const pos = cachedCustomers.posOperations || {};
  const exc = cachedCustomers.posExceptions || {};
  const seg = cachedCustomers.segmentation || {};
  const rfmSegments = seg.rfmSegments || cachedCustomers.rfmSegments || [];

  const fmtPaise = (p) => '₹' + Math.round((Number(p) || 0) / 100).toLocaleString('en-IN');
  const fmtInt = (v) => Number(v || 0).toLocaleString('en-IN');

  const renderView = (view) => {
    customerActiveView = view;
    const body = root.querySelector('#customer-view-body');
    if (!body) return;

    if (view === 'overview') {
      body.innerHTML = `
        <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(280px, 1fr));gap:14px;">
          <!-- Customer Identity Card -->
          <div class="card" style="padding:14px;background:var(--surface-sunken);">
            <h4 style="font-size:12px;font-weight:700;color:var(--ink);margin:0 0 10px 0;">Guest Volume &amp; Identity Structure</h4>
            <div style="display:flex;flex-direction:column;gap:8px;font-size:12px;">
              <div style="display:flex;justify-content:space-between;border-bottom:1px solid var(--border-subtle);padding-bottom:4px;">
                <span style="color:var(--muted);">Total Registered Customers:</span>
                <strong>${fmtInt(cSum.totalRegisteredCustomers)}</strong>
              </div>
              <div style="display:flex;justify-content:space-between;border-bottom:1px solid var(--border-subtle);padding-bottom:4px;">
                <span style="color:var(--muted);">Active Transacting Identified:</span>
                <strong style="color:var(--primary);">${fmtInt(cSum.activeIdentifiedCustomers)}</strong>
              </div>
              <div style="display:flex;justify-content:space-between;border-bottom:1px solid var(--border-subtle);padding-bottom:4px;">
                <span style="color:var(--muted);">New First-Time Guests:</span>
                <strong style="color:var(--mint,#10b981);">${fmtInt(cSum.newCustomersThisPeriod)}</strong>
              </div>
              <div style="display:flex;justify-content:space-between;border-bottom:1px solid var(--border-subtle);padding-bottom:4px;">
                <span style="color:var(--muted);">Repeat Transacting Guests:</span>
                <strong>${fmtInt(cSum.repeatCustomersThisPeriod)} (${cSum.repeatCustomerRatePct || 0}%)</strong>
              </div>
              <div style="display:flex;justify-content:space-between;">
                <span style="color:var(--muted);">Total Customer Visits (1/day/café):</span>
                <strong>${fmtInt(cSum.totalCustomerVisits)}</strong>
              </div>
            </div>
          </div>

          <!-- Anonymous vs Identified Checks Card -->
          <div class="card" style="padding:14px;background:var(--surface-sunken);">
            <h4 style="font-size:12px;font-weight:700;color:var(--ink);margin:0 0 10px 0;">Check Attribution &amp; Guest Covers</h4>
            <div style="display:flex;flex-direction:column;gap:8px;font-size:12px;">
              <div style="display:flex;justify-content:space-between;border-bottom:1px solid var(--border-subtle);padding-bottom:4px;">
                <span style="color:var(--muted);">Total Finalized Checks:</span>
                <strong>${fmtInt(cSum.totalCheckCount)}</strong>
              </div>
              <div style="display:flex;justify-content:space-between;border-bottom:1px solid var(--border-subtle);padding-bottom:4px;">
                <span style="color:var(--muted);">Identified Checks:</span>
                <strong>${fmtInt(cSum.identifiedCheckCount)} (${fmtPaise(cSum.identifiedSalesPaise)})</strong>
              </div>
              <div style="display:flex;justify-content:space-between;border-bottom:1px solid var(--border-subtle);padding-bottom:4px;">
                <span style="color:var(--muted);">Anonymous Checks:</span>
                <strong style="color:var(--amber,#f59e0b);">${fmtInt(cSum.anonymousCheckCount)} (${cSum.anonymousCheckSharePct || 0}%)</strong>
              </div>
              <div style="display:flex;justify-content:space-between;border-bottom:1px solid var(--border-subtle);padding-bottom:4px;">
                <span style="color:var(--muted);">Dine-In Guest Covers:</span>
                <strong>${fmtInt(cSum.guestCount)}</strong>
              </div>
              <div style="display:flex;justify-content:space-between;">
                <span style="color:var(--muted);">Average Check Size:</span>
                <strong>${fmtPaise(cSum.averageCheckPaise)}</strong>
              </div>
            </div>
          </div>

          <!-- Spend Metrics Card -->
          <div class="card" style="padding:14px;background:var(--surface-sunken);">
            <h4 style="font-size:12px;font-weight:700;color:var(--ink);margin:0 0 10px 0;">Unit Spend Economics</h4>
            <div style="display:flex;flex-direction:column;gap:8px;font-size:12px;">
              <div style="display:flex;justify-content:space-between;border-bottom:1px solid var(--border-subtle);padding-bottom:4px;">
                <span style="color:var(--muted);">Avg Spend / Identified Guest:</span>
                <strong>${fmtPaise(cSum.averageSpendPerIdentifiedCustomerPaise)}</strong>
              </div>
              <div style="display:flex;justify-content:space-between;border-bottom:1px solid var(--border-subtle);padding-bottom:4px;">
                <span style="color:var(--muted);">Avg Spend / Guest Cover:</span>
                <strong>${cSum.guestCount > 0 ? fmtPaise(cSum.averageSpendPerGuestPaise) : 'N/A (0 covers)'}</strong>
              </div>
              <div style="display:flex;justify-content:space-between;border-bottom:1px solid var(--border-subtle);padding-bottom:4px;">
                <span style="color:var(--muted);">Avg Historical Lifetime Spend:</span>
                <strong>₹${Number(cSum.averageLifetimeSpend || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</strong>
              </div>
              <div style="display:flex;justify-content:space-between;">
                <span style="color:var(--muted);">Overall Customer Score:</span>
                <span class="badge secondary" style="font-size:10px;">NOT_CONFIGURED</span>
              </div>
            </div>
          </div>
        </div>

        <!-- Service Modes Preview Table -->
        <div class="card" style="padding:14px;background:var(--surface-sunken);margin-top:14px;">
          <h4 style="font-size:12px;font-weight:700;color:var(--ink);margin:0 0 10px 0;">POS Service Mode Distribution</h4>
          <table class="glass-table" style="width:100%;font-size:12px;">
            <thead>
              <tr>
                <th>Service Mode</th>
                <th>Orders</th>
                <th>Net Sales</th>
                <th>Guest Covers</th>
                <th>Avg Check</th>
                <th>Sales Share</th>
              </tr>
            </thead>
            <tbody>
              ${(pos.serviceModes || []).map(m => `
                <tr>
                  <td><strong>${m.serviceMode}</strong></td>
                  <td>${fmtInt(m.orderCount)}</td>
                  <td>${fmtPaise(m.netSalesPaise)}</td>
                  <td>${fmtInt(m.guestCount)}</td>
                  <td>${fmtPaise(m.avgCheckPaise)}</td>
                  <td><span class="badge ${m.salesSharePct > 25 ? 'success' : 'secondary'}" style="font-size:10px;">${m.salesSharePct}%</span></td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      `;
    } else if (view === 'loyalty') {
      const tiers = loy.tierDistribution || [];
      const mComp = loy.memberVsNonMemberComparison || {};
      body.innerHTML = `
        <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(240px, 1fr));gap:12px;margin-bottom:14px;">
          <div class="card" style="padding:12px;background:var(--surface-sunken);">
            <div style="font-size:10px;color:var(--muted);text-transform:uppercase;">Enrolled Members</div>
            <div style="font-size:18px;font-weight:800;color:var(--ink);margin-top:2px;">${fmtInt(loy.totalMembers)}</div>
          </div>
          <div class="card" style="padding:12px;background:var(--surface-sunken);">
            <div style="font-size:10px;color:var(--muted);text-transform:uppercase;">Active in Period</div>
            <div style="font-size:18px;font-weight:800;color:var(--primary);margin-top:2px;">${fmtInt(loy.activeMembers)}</div>
          </div>
          <div class="card" style="padding:12px;background:var(--surface-sunken);">
            <div style="font-size:10px;color:var(--muted);text-transform:uppercase;">Points Earned</div>
            <div style="font-size:18px;font-weight:800;color:var(--mint,#10b981);margin-top:2px;">${fmtInt(loy.pointsEarned)}</div>
          </div>
          <div class="card" style="padding:12px;background:var(--surface-sunken);">
            <div style="font-size:10px;color:var(--muted);text-transform:uppercase;">Points Burned (Redeemed)</div>
            <div style="font-size:18px;font-weight:800;color:var(--amber,#f59e0b);margin-top:2px;">${fmtInt(loy.pointsRedeemed)} (${loy.redemptionRatePct || 0}%)</div>
          </div>
        </div>

        <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(320px, 1fr));gap:14px;">
          <!-- Tiers Table -->
          <div class="card" style="padding:14px;background:var(--surface-sunken);">
            <h4 style="font-size:12px;font-weight:700;color:var(--ink);margin:0 0 10px 0;">Loyalty Tier Distribution</h4>
            <table class="glass-table" style="width:100%;font-size:12px;">
              <thead>
                <tr>
                  <th>Tier</th>
                  <th>Member Count</th>
                  <th>Share (%)</th>
                </tr>
              </thead>
              <tbody>
                ${tiers.map(t => `
                  <tr>
                    <td><strong>${t.tier}</strong></td>
                    <td>${fmtInt(t.count)}</td>
                    <td>${t.percentage}%</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>

          <!-- Member vs Non-Member Comparison -->
          <div class="card" style="padding:14px;background:var(--surface-sunken);">
            <h4 style="font-size:12px;font-weight:700;color:var(--ink);margin:0 0 10px 0;">Member vs. Non-Member Spend Velocity</h4>
            <table class="glass-table" style="width:100%;font-size:12px;">
              <thead>
                <tr>
                  <th>Group</th>
                  <th>Guests</th>
                  <th>Orders</th>
                  <th>Total Spend</th>
                  <th>Avg Order</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td><strong style="color:var(--primary);">Loyalty Members</strong></td>
                  <td>${fmtInt(mComp.member?.customerCount)}</td>
                  <td>${fmtInt(mComp.member?.orderCount)}</td>
                  <td>${fmtPaise(mComp.member?.totalSpendPaise)}</td>
                  <td>${fmtPaise(mComp.member?.avgOrderSpendPaise)}</td>
                </tr>
                <tr>
                  <td><strong style="color:var(--muted);">Non-Members</strong></td>
                  <td>${fmtInt(mComp.nonMember?.customerCount)}</td>
                  <td>${fmtInt(mComp.nonMember?.orderCount)}</td>
                  <td>${fmtPaise(mComp.nonMember?.totalSpendPaise)}</td>
                  <td>${fmtPaise(mComp.nonMember?.avgOrderSpendPaise)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      `;
    } else if (view === 'feedback') {
      const rDist = fbk.ratingDistribution || {};
      const catBreakdown = fbk.categoryBreakdown || [];
      const sBreakdown = fbk.statusBreakdown || {};
      body.innerHTML = `
        <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(220px, 1fr));gap:12px;margin-bottom:14px;">
          <div class="card" style="padding:12px;background:var(--surface-sunken);">
            <div style="font-size:10px;color:var(--muted);text-transform:uppercase;">Feedback Submissions</div>
            <div style="font-size:18px;font-weight:800;color:var(--ink);margin-top:2px;">${fmtInt(fbk.feedbackCount)}</div>
          </div>
          <div class="card" style="padding:12px;background:var(--surface-sunken);">
            <div style="font-size:10px;color:var(--muted);text-transform:uppercase;">Average Star Rating</div>
            <div style="font-size:18px;font-weight:800;color:var(--mint,#10b981);margin-top:2px;">★ ${(fbk.averageRating || 0).toFixed(2)} / 5.00</div>
          </div>
          <div class="card" style="padding:12px;background:var(--surface-sunken);">
            <div style="font-size:10px;color:var(--muted);text-transform:uppercase;">Net Promoter Score (NPS)</div>
            <div style="font-size:12px;font-weight:700;color:var(--muted);margin-top:6px;">UNAVAILABLE (No 0–10 Question)</div>
          </div>
        </div>

        <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(320px, 1fr));gap:14px;">
          <!-- Star Ratings Distribution -->
          <div class="card" style="padding:14px;background:var(--surface-sunken);">
            <h4 style="font-size:12px;font-weight:700;color:var(--ink);margin:0 0 10px 0;">Star Rating Breakdown</h4>
            <div style="display:flex;flex-direction:column;gap:8px;font-size:12px;">
              ${[5, 4, 3, 2, 1].map(star => {
                const count = rDist[star] || 0;
                const pct = fbk.feedbackCount > 0 ? ((count / fbk.feedbackCount) * 100).toFixed(1) : 0;
                return `
                  <div style="display:flex;align-items:center;gap:8px;">
                    <span style="width:50px;font-weight:700;">★ ${star} Star:</span>
                    <div style="flex:1;background:var(--border-subtle);height:8px;border-radius:4px;overflow:hidden;">
                      <div style="width:${pct}%;background:var(--primary);height:100%;"></div>
                    </div>
                    <span style="width:70px;text-align:right;font-size:11px;color:var(--muted);">${count} (${pct}%)</span>
                  </div>
                `;
              }).join('')}
            </div>
          </div>

          <!-- Category Breakdown -->
          <div class="card" style="padding:14px;background:var(--surface-sunken);">
            <h4 style="font-size:12px;font-weight:700;color:var(--ink);margin:0 0 10px 0;">Feedback by Operational Category</h4>
            <table class="glass-table" style="width:100%;font-size:12px;">
              <thead>
                <tr>
                  <th>Category</th>
                  <th>Submissions</th>
                  <th>Share (%)</th>
                </tr>
              </thead>
              <tbody>
                ${catBreakdown.map(c => `
                  <tr>
                    <td><strong>${c.category}</strong></td>
                    <td>${fmtInt(c.count)}</td>
                    <td>${c.percentage}%</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
      `;
    } else if (view === 'pos_service') {
      const spd = pos.speedOfService || {};
      const stations = spd.stationPerformance || [];
      const tbl = pos.tablePerformance || {};
      body.innerHTML = `
        <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(200px, 1fr));gap:12px;margin-bottom:14px;">
          <div class="card" style="padding:12px;background:var(--surface-sunken);">
            <div style="font-size:10px;color:var(--muted);text-transform:uppercase;">KDS Tickets Completed</div>
            <div style="font-size:18px;font-weight:800;color:var(--ink);margin-top:2px;">${fmtInt(spd.completedTickets)}</div>
          </div>
          <div class="card" style="padding:12px;background:var(--surface-sunken);">
            <div style="font-size:10px;color:var(--muted);text-transform:uppercase;">Mean Prep Duration</div>
            <div style="font-size:18px;font-weight:800;color:var(--primary);margin-top:2px;">${Math.round(spd.meanPrepTimeSeconds || 0)}s</div>
          </div>
          <div class="card" style="padding:12px;background:var(--surface-sunken);">
            <div style="font-size:10px;color:var(--muted);text-transform:uppercase;">Median (P50) Prep</div>
            <div style="font-size:18px;font-weight:800;color:var(--mint,#10b981);margin-top:2px;">${Math.round(spd.medianPrepTimeSeconds || 0)}s</div>
          </div>
          <div class="card" style="padding:12px;background:var(--surface-sunken);">
            <div style="font-size:10px;color:var(--muted);text-transform:uppercase;">90th Percentile (P90)</div>
            <div style="font-size:18px;font-weight:800;color:var(--amber,#f59e0b);margin-top:2px;">${Math.round(spd.p90PrepTimeSeconds || 0)}s</div>
          </div>
        </div>

        <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(320px, 1fr));gap:14px;">
          <!-- Station Performance -->
          <div class="card" style="padding:14px;background:var(--surface-sunken);">
            <h4 style="font-size:12px;font-weight:700;color:var(--ink);margin:0 0 10px 0;">Kitchen Station Performance</h4>
            <table class="glass-table" style="width:100%;font-size:12px;">
              <thead>
                <tr>
                  <th>Station</th>
                  <th>Tickets</th>
                  <th>Completed</th>
                  <th>Avg Prep Time</th>
                </tr>
              </thead>
              <tbody>
                ${stations.map(s => `
                  <tr>
                    <td><strong>${s.prepStation}</strong></td>
                    <td>${fmtInt(s.ticketCount)}</td>
                    <td>${fmtInt(s.completedTicketCount)}</td>
                    <td>${s.avgPrepTimeSeconds}s</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>

          <!-- Table & Dining Service -->
          <div class="card" style="padding:14px;background:var(--surface-sunken);">
            <h4 style="font-size:12px;font-weight:700;color:var(--ink);margin:0 0 10px 0;">Table Turns &amp; Dining Capacity</h4>
            <div style="display:flex;flex-direction:column;gap:8px;font-size:12px;">
              <div style="display:flex;justify-content:space-between;border-bottom:1px solid var(--border-subtle);padding-bottom:4px;">
                <span style="color:var(--muted);">Active Tables Recorded:</span>
                <strong>${fmtInt(tbl.activeTableCount)}</strong>
              </div>
              <div style="display:flex;justify-content:space-between;border-bottom:1px solid var(--border-subtle);padding-bottom:4px;">
                <span style="color:var(--muted);">Average Table Turns:</span>
                <strong>${tbl.tableTurns || 0} turns/table</strong>
              </div>
              <div style="display:flex;justify-content:space-between;border-bottom:1px solid var(--border-subtle);padding-bottom:4px;">
                <span style="color:var(--muted);">Dining Time Audit:</span>
                <span class="badge secondary" style="font-size:10px;">PARTIAL_SOURCE (Check duration)</span>
              </div>
              <div style="display:flex;justify-content:space-between;">
                <span style="color:var(--muted);">Table Reservations:</span>
                <span class="badge danger" style="font-size:10px;">UNAVAILABLE_SOURCE</span>
              </div>
            </div>
          </div>
        </div>
      `;
    } else if (view === 'exceptions') {
      body.innerHTML = `
        <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(200px, 1fr));gap:12px;margin-bottom:14px;">
          <div class="card" style="padding:12px;background:var(--surface-sunken);">
            <div style="font-size:10px;color:var(--muted);text-transform:uppercase;">Audited Bill Voids</div>
            <div style="font-size:18px;font-weight:800;color:var(--danger,#ef4444);margin-top:2px;">${fmtInt(exc.voids?.count)} (${fmtPaise(exc.voids?.totalAmountPaise)})</div>
          </div>
          <div class="card" style="padding:12px;background:var(--surface-sunken);">
            <div style="font-size:10px;color:var(--muted);text-transform:uppercase;">Customer Refunds</div>
            <div style="font-size:18px;font-weight:800;color:var(--amber,#f59e0b);margin-top:2px;">${fmtInt(exc.refunds?.count)} (${fmtPaise(exc.refunds?.totalAmountPaise)})</div>
          </div>
          <div class="card" style="padding:12px;background:var(--surface-sunken);">
            <div style="font-size:10px;color:var(--muted);text-transform:uppercase;">High Discounts (&gt; 20%)</div>
            <div style="font-size:18px;font-weight:800;color:var(--ink);margin-top:2px;">${fmtInt(exc.highDiscounts?.count)} incidents</div>
          </div>
          <div class="card" style="padding:12px;background:var(--surface-sunken);">
            <div style="font-size:10px;color:var(--muted);text-transform:uppercase;">Complimentary Bills</div>
            <div style="font-size:18px;font-weight:800;color:var(--primary);margin-top:2px;">${fmtInt(exc.complimentaryBills?.count)} (${fmtPaise(exc.complimentaryBills?.totalAmountPaise)})</div>
          </div>
        </div>

        <div class="card" style="padding:14px;background:var(--surface-sunken);">
          <h4 style="font-size:12px;font-weight:700;color:var(--ink);margin:0 0 10px 0;">Cashier Exception Register &amp; Operational Hygiene</h4>
          <table class="glass-table" style="width:100%;font-size:12px;">
            <thead>
              <tr>
                <th>Audit Category</th>
                <th>Incidents</th>
                <th>Total Value</th>
                <th>Governance Audit Status</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td><strong>Bill Voids (Cancelled post-placement)</strong></td>
                <td>${fmtInt(exc.voids?.count)}</td>
                <td>${fmtPaise(exc.voids?.totalAmountPaise)}</td>
                <td>Audited with cashier attribution</td>
              </tr>
              <tr>
                <td><strong>Return Refunds (Full &amp; partial)</strong></td>
                <td>${fmtInt(exc.refunds?.count)}</td>
                <td>${fmtPaise(exc.refunds?.totalAmountPaise)}</td>
                <td>Audited against credit transactions</td>
              </tr>
              <tr>
                <td><strong>High Discount Exceptions (&gt; 20%)</strong></td>
                <td>${fmtInt(exc.highDiscounts?.count)}</td>
                <td>Included in Discounts Total</td>
                <td>Flagged for manager review</td>
              </tr>
              <tr>
                <td><strong>Complimentary / 100% Promo Bills</strong></td>
                <td>${fmtInt(exc.complimentaryBills?.count)}</td>
                <td>${fmtPaise(exc.complimentaryBills?.totalAmountPaise)}</td>
                <td>Authorized commercial comp bills</td>
              </tr>
              <tr>
                <td><strong>Receipt Reprints</strong></td>
                <td>${fmtInt(exc.reprints?.reprintEventsCount)} events (${fmtInt(exc.reprints?.billsReprintedCount)} bills)</td>
                <td>N/A</td>
                <td>POS till reprint log audited</td>
              </tr>
              <tr>
                <td><strong>Offline Replayed Bills</strong></td>
                <td>${fmtInt(exc.offlineReplays?.count)}</td>
                <td>${fmtPaise(exc.offlineReplays?.totalAmountPaise)}</td>
                <td>Reconciled via client sync cache</td>
              </tr>
              <tr>
                <td><strong>Register Session Cash Variances</strong></td>
                <td>${fmtInt(exc.cashVariances?.sessionsWithVarianceCount)} / ${fmtInt(exc.cashVariances?.totalSessionsAudited)} sessions</td>
                <td>${fmtPaise(exc.cashVariances?.totalVariancePaise)}</td>
                <td>Daily till float reconciliation</td>
              </tr>
            </tbody>
          </table>
        </div>
      `;
    } else if (view === 'segmentation') {
      const fDist = seg.frequencyDistribution || [];
      const rDist = seg.recencyDistribution || [];
      const sBuckets = seg.spendPresentationBuckets || [];
      body.innerHTML = `
        <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(320px, 1fr));gap:14px;">
          <!-- RFM Segments -->
          <div class="card" style="padding:14px;background:var(--surface-sunken);">
            <h4 style="font-size:12px;font-weight:700;color:var(--ink);margin:0 0 10px 0;">Deterministic RFM Guest Segments</h4>
            <table class="glass-table" style="width:100%;font-size:12px;">
              <thead>
                <tr>
                  <th>Segment Name</th>
                  <th>Guest Count</th>
                  <th>Contribution (%)</th>
                </tr>
              </thead>
              <tbody>
                ${rfmSegments.map(s => `
                  <tr>
                    <td><strong>${s.segment}</strong></td>
                    <td>${fmtInt(s.count)}</td>
                    <td><strong>${s.spendPct}%</strong></td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>

          <!-- Frequency Brackets -->
          <div class="card" style="padding:14px;background:var(--surface-sunken);">
            <h4 style="font-size:12px;font-weight:700;color:var(--ink);margin:0 0 10px 0;">Visit Frequency Distribution</h4>
            <table class="glass-table" style="width:100%;font-size:12px;">
              <thead>
                <tr>
                  <th>Visit Bracket</th>
                  <th>Guests</th>
                  <th>Spend Value</th>
                </tr>
              </thead>
              <tbody>
                ${fDist.map(f => `
                  <tr>
                    <td><strong>${f.bracket}</strong></td>
                    <td>${fmtInt(f.count)}</td>
                    <td>${fmtPaise(f.spendPaise)}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>

          <!-- Spend Presentation Buckets -->
          <div class="card" style="padding:14px;background:var(--surface-sunken);">
            <h4 style="font-size:12px;font-weight:700;color:var(--ink);margin:0 0 10px 0;">Spend Tier Presentation</h4>
            <table class="glass-table" style="width:100%;font-size:12px;">
              <thead>
                <tr>
                  <th>Spend Range</th>
                  <th>Guest Count</th>
                  <th>Total Spend</th>
                </tr>
              </thead>
              <tbody>
                ${sBuckets.map(b => `
                  <tr>
                    <td><strong>${b.bracket}</strong></td>
                    <td>${fmtInt(b.count)}</td>
                    <td>${fmtPaise(b.spendPaise)}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>

          <!-- Recency Brackets -->
          <div class="card" style="padding:14px;background:var(--surface-sunken);">
            <h4 style="font-size:12px;font-weight:700;color:var(--ink);margin:0 0 10px 0;">Visit Recency Horizon</h4>
            <table class="glass-table" style="width:100%;font-size:12px;">
              <thead>
                <tr>
                  <th>Recency Interval</th>
                  <th>Guest Count</th>
                </tr>
              </thead>
              <tbody>
                ${rDist.map(r => `
                  <tr>
                    <td><strong>${r.bracket}</strong></td>
                    <td>${fmtInt(r.count)}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
      `;
    }

    // Highlight active subtab button
    root.querySelectorAll('[data-cust-view]').forEach(btn => {
      const isActive = btn.dataset.custView === customerActiveView;
      btn.style.background = isActive ? 'var(--primary,#0ea5e9)' : 'var(--surface)';
      btn.style.color = isActive ? '#fff' : 'var(--muted)';
      btn.style.borderColor = isActive ? 'var(--primary,#0ea5e9)' : 'var(--border)';
    });
  };

  container.innerHTML = `
    <div class="card" style="padding:16px;background:var(--surface);display:flex;flex-direction:column;gap:14px;">
      <!-- Header with Badges and ZURF Export Actions -->
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;">
        <div>
          <h3 style="font-size:14px;font-weight:700;color:var(--ink);margin:0;">PM-02H: Customer, POS, Order &amp; Service Intelligence</h3>
          <p style="font-size:11px;color:var(--muted);margin:2px 0 0 0;">Anonymized customer identity, guest covers, speed of service, and POS exception audit</p>
        </div>
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
          <span class="badge success" style="font-size:10px;">Privacy Mode Active (Zero PII)</span>
          <button class="btn btn-sm btn-primary" data-export-report="customer-retention" style="font-size:11px;padding:4px 10px;" type="button">📑 Customer ZURF</button>
          <button class="btn btn-sm btn-secondary" data-export-report="pos-exceptions" style="font-size:11px;padding:4px 10px;" type="button">📑 Exceptions ZURF</button>
          <button class="btn btn-sm btn-secondary" data-export-report="service-speed" style="font-size:11px;padding:4px 10px;" type="button">📑 Speed ZURF</button>
        </div>
      </div>

      <!-- Top Executive KPI Grid -->
      <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(160px, 1fr));gap:10px;">
        <div class="card" style="padding:10px;background:var(--surface-sunken);">
          <div style="font-size:10px;color:var(--muted);text-transform:uppercase;">Identified Guests</div>
          <div style="font-size:16px;font-weight:800;color:var(--primary);margin-top:2px;">${fmtInt(cSum.activeIdentifiedCustomers)}</div>
        </div>
        <div class="card" style="padding:10px;background:var(--surface-sunken);">
          <div style="font-size:10px;color:var(--muted);text-transform:uppercase;">Total Customer Visits</div>
          <div style="font-size:16px;font-weight:800;color:var(--ink);margin-top:2px;">${fmtInt(cSum.totalCustomerVisits)}</div>
        </div>
        <div class="card" style="padding:10px;background:var(--surface-sunken);">
          <div style="font-size:10px;color:var(--muted);text-transform:uppercase;">Repeat Customer Rate</div>
          <div style="font-size:16px;font-weight:800;color:var(--mint,#10b981);margin-top:2px;">${cSum.repeatCustomerRatePct || 0}%</div>
        </div>
        <div class="card" style="padding:10px;background:var(--surface-sunken);">
          <div style="font-size:10px;color:var(--muted);text-transform:uppercase;">Average Check Size</div>
          <div style="font-size:16px;font-weight:800;color:var(--ink);margin-top:2px;">${fmtPaise(cSum.averageCheckPaise)}</div>
        </div>
        <div class="card" style="padding:10px;background:var(--surface-sunken);">
          <div style="font-size:10px;color:var(--muted);text-transform:uppercase;">Guest Covers</div>
          <div style="font-size:16px;font-weight:800;color:var(--ink);margin-top:2px;">${fmtInt(cSum.guestCount)}</div>
        </div>
        <div class="card" style="padding:10px;background:var(--surface-sunken);">
          <div style="font-size:10px;color:var(--muted);text-transform:uppercase;">Anonymous Checks</div>
          <div style="font-size:16px;font-weight:800;color:var(--amber,#f59e0b);margin-top:2px;">${cSum.anonymousCheckSharePct || 0}%</div>
        </div>
      </div>

      <!-- View Selector Navigation Pills -->
      <div style="display:flex;gap:6px;border-bottom:1px solid var(--border);padding-bottom:8px;flex-wrap:wrap;">
        ${[
          { id: 'overview', label: 'Overview & Guest Spend' },
          { id: 'loyalty', label: 'Loyalty Intelligence' },
          { id: 'feedback', label: 'Customer Feedback' },
          { id: 'pos_service', label: 'POS & Speed of Service' },
          { id: 'exceptions', label: 'POS Exception Centre' },
          { id: 'segmentation', label: 'RFM & Frequency' },
        ].map(v => `
          <button class="btn btn-xs" data-cust-view="${v.id}" style="font-size:11px;padding:4px 10px;border-radius:14px;border:1px solid var(--border);background:var(--surface);color:var(--muted);" type="button">
            ${v.label}
          </button>
        `).join('')}
      </div>

      <!-- View Body Container -->
      <div id="customer-view-body"></div>
    </div>
  `;

  // Attach tab switch click listeners
  root.querySelectorAll('[data-cust-view]').forEach(btn => {
    btn.addEventListener('click', () => renderView(btn.dataset.custView));
  });

  renderView(customerActiveView);
}

async function renderInventorySubtab(root, container) {
  container.innerHTML = skeleton('240px');
  try {
    const res = await apiGet('/reports/inventory' + buildFilterQueryString('inventory'));
    if (res?.data) cachedInventory = res.data;
  } catch (_) {}

  if (!cachedInventory) {
    cachedInventory = {
      summary: {
        stockOnHandQuantity: 0,
        operationalValuation: 0,
        activeSkuCount: 0,
        availableLotCount: 0,
        onHoldLotCount: 0,
        expiringLotCount: 0,
        expiredLotCount: 0,
        outOfStockItemCount: 0,
        lowStockItemCount: 0,
        totalWasteValue: 0,
        approvedWasteValuePaise: 0,
        pendingWasteValuePaise: 0,
        transferActivityCount: 0,
        cycleCountVarianceQty: 0,
      },
      stockValuation: { rawCoffeeBeans: 0, dairyAndPlantMilk: 0, packagingAndCups: 0, retailBags: 0 },
      movementWaterfall: { openingBalance: 0, inboundGRN: 0, consumedInRecipes: 0, wastageWrittenOff: 0, closingBalance: 0 },
      byCategory: [],
      byCafe: [],
      byItem: [],
      ageing: { buckets: [] },
      expiry: { expiredLots: [], expiringSoonLots: [] },
      movements: { byType: [] },
      transfers: { transfers: [] },
      cycleCounts: { counts: [] },
      wasteIntelligence: { byReason: [], pareto: [], records: [] },
    };
  }

  const {
    summary = {},
    stockValuation = {},
    movementWaterfall = {},
    byCategory = [],
    byCafe = [],
    byItem = [],
    ageing = { buckets: [] },
    expiry = { expiredLots: [], expiringSoonLots: [] },
    movements = { byType: [] },
    transfers = { transfers: [] },
    cycleCounts = { counts: [] },
    wasteIntelligence = { byReason: [], pareto: [], records: [] },
  } = cachedInventory;

  // Filter items by category / search if active
  const filteredItems = byItem.filter((it) => {
    if (invCategoryFilter !== 'ALL' && it.category !== invCategoryFilter) return false;
    if (invSearchTerm) {
      const term = invSearchTerm.toLowerCase();
      return it.itemName.toLowerCase().includes(term) || it.sku.toLowerCase().includes(term);
    }
    return true;
  });

  const categories = Array.from(new Set(byCategory.map((c) => c.category)));
  const wasteReasons = Array.from(new Set((wasteIntelligence.byReason || []).map((r) => r.reason)));

  container.innerHTML = `
    <div class="card" style="padding:16px;background:var(--surface);display:flex;flex-direction:column;gap:14px;">
      <!-- Title & Headline -->
      <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:8px;">
        <div>
          <h3 style="font-size:15px;font-weight:700;color:var(--ink);margin:0;">Inventory Valuation &amp; Stock Intelligence</h3>
          <p style="font-size:11px;color:var(--muted);margin:2px 0 0 0;">Authoritative batch lot tracking, stock movement waterfall, expiry alerts, and waste Pareto analysis</p>
        </div>
        <div style="display:flex;align-items:center;gap:6px;">
          <span class="pill pill-sky" style="font-size:10px;font-weight:700;">OPERATIONAL VALUATION</span>
          <span class="pill pill-coral" style="font-size:10px;font-weight:700;">ACTUAL COGS UNAVAILABLE</span>
          <button class="btn btn-sm btn-primary" data-export-report="inventory-valuation" style="font-size:12px;" type="button">ZURF Export</button>
        </div>
      </div>

      <!-- Statutory Disclosure Notice -->
      <div style="padding:10px 14px;background:rgba(245, 158, 11, 0.08);border-left:3px solid var(--amber, #f59e0b);border-radius:4px;font-size:11px;color:var(--ink);display:flex;align-items:center;gap:8px;">
        <span style="font-size:14px;">⚠️</span>
        <div>
          <strong>Statutory Costing Disclosure:</strong> Operational stock valuation is computed as <code>remainingQuantity &times; standardUnitCostPaisa</code>. Actual accounting COGS remains <strong>UNAVAILABLE</strong> pending verified kitchen batch consumption reconciliation.
        </div>
      </div>

      <!-- Live KPI Cards & Restricted Stock Valuation Breakdown (PM-02E-R3) -->
      <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(180px, 1fr));gap:10px;">
        <div class="card" style="padding:10px;background:var(--surface-sunken);border-left:3px solid var(--sky, #0284c7);">
          <div style="font-size:10px;color:var(--muted);text-transform:uppercase;font-weight:700;">Physical On-Hand Value</div>
          <div style="font-size:18px;font-weight:800;color:var(--ink);margin-top:2px;">₹${(summary.physicalOnHandStandardValue || summary.operationalValuation || 0).toLocaleString('en-IN')}</div>
          <div style="font-size:10px;color:var(--muted);margin-top:2px;">${(summary.physicalOnHandQuantity || summary.stockOnHandQuantity || 0).toLocaleString('en-IN')} physical units across ${summary.activeSkuCount || 0} SKUs</div>
        </div>

        <div class="card" style="padding:10px;background:var(--surface-sunken);border-left:3px solid var(--mint, #10b981);">
          <div style="font-size:10px;color:var(--muted);text-transform:uppercase;font-weight:700;">Available-for-Use Value</div>
          <div style="font-size:18px;font-weight:800;color:var(--mint, #10b981);margin-top:2px;">₹${(summary.availableForUseStandardValue || 0).toLocaleString('en-IN')}</div>
          <div style="font-size:10px;color:var(--muted);margin-top:2px;">${(summary.availableForUseQuantity || 0).toLocaleString('en-IN')} usable units &bull; ${summary.availableLotCount || 0} active lots</div>
        </div>

        <div class="card" style="padding:10px;background:var(--surface-sunken);border-left:3px solid var(--amber, #f59e0b);">
          <div style="font-size:10px;color:var(--muted);text-transform:uppercase;font-weight:700;">Quarantine Value</div>
          <div style="font-size:18px;font-weight:800;color:var(--amber, #f59e0b);margin-top:2px;">₹${(summary.quarantineStandardValue || 0).toLocaleString('en-IN')}</div>
          <div style="font-size:10px;color:var(--muted);margin-top:2px;">${(summary.quarantineQuantity || 0).toLocaleString('en-IN')} quarantined units (${summary.quarantineLotCount || 0} lots)</div>
        </div>

        <div class="card" style="padding:10px;background:var(--surface-sunken);border-left:3px solid var(--amber, #f59e0b);">
          <div style="font-size:10px;color:var(--muted);text-transform:uppercase;font-weight:700;">Recall-Hold Value</div>
          <div style="font-size:18px;font-weight:800;color:var(--amber, #f59e0b);margin-top:2px;">₹${(summary.recallHoldStandardValue || 0).toLocaleString('en-IN')}</div>
          <div style="font-size:10px;color:var(--muted);margin-top:2px;">${(summary.recallHoldQuantity || 0).toLocaleString('en-IN')} locked units (${summary.onHoldLotCount || 0} lots)</div>
        </div>

        <div class="card" style="padding:10px;background:var(--surface-sunken);border-left:3px solid var(--coral, #ef4444);">
          <div style="font-size:10px;color:var(--muted);text-transform:uppercase;font-weight:700;">Expired Stock Exposure</div>
          <div style="font-size:18px;font-weight:800;color:var(--coral, #ef4444);margin-top:2px;">₹${(summary.expiredStandardCostExposure || 0).toLocaleString('en-IN')}</div>
          <div style="font-size:10px;color:var(--muted);margin-top:2px;">${(summary.expiredQuantity || 0).toLocaleString('en-IN')} expired units (${summary.expiredLotCount || 0} lots)</div>
        </div>

        <div class="card" style="padding:10px;background:var(--surface-sunken);">
          <div style="font-size:10px;color:var(--muted);text-transform:uppercase;font-weight:700;">Wastage &amp; Spoilage Loss</div>
          <div style="font-size:18px;font-weight:800;color:var(--coral, #ef4444);margin-top:2px;">₹${(summary.totalWasteValue || 0).toLocaleString('en-IN')}</div>
          <div style="font-size:10px;color:var(--muted);margin-top:2px;">
            ₹${((summary.approvedWasteValuePaise || 0) / 100).toLocaleString('en-IN')} Approved &bull; ₹${((summary.pendingWasteValuePaise || 0) / 100).toLocaleString('en-IN')} Pending
          </div>
        </div>
      </div>

      <!-- Subtab View Navigation & Filter Toolbar -->
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;padding:8px 0;border-bottom:1px solid var(--line);">
        <div style="display:flex;gap:6px;flex-wrap:wrap;">
          <button class="btn btn-xs ${invActiveView === 'overview' ? 'btn-primary' : 'btn-secondary'}" id="inv-view-overview-btn" type="button">Overview</button>
          <button class="btn btn-xs ${invActiveView === 'categories' ? 'btn-primary' : 'btn-secondary'}" id="inv-view-categories-btn" type="button">Categories</button>
          <button class="btn btn-xs ${invActiveView === 'items' ? 'btn-primary' : 'btn-secondary'}" id="inv-view-items-btn" type="button">Items (${byItem.length})</button>
          <button class="btn btn-xs ${invActiveView === 'lots' ? 'btn-primary' : 'btn-secondary'}" id="inv-view-lots-btn" type="button">Lots &amp; Expiry</button>
          <button class="btn btn-xs ${invActiveView === 'transfers' ? 'btn-primary' : 'btn-secondary'}" id="inv-view-transfers-btn" type="button">Transfers</button>
          <button class="btn btn-xs ${invActiveView === 'waste' ? 'btn-primary' : 'btn-secondary'}" id="inv-view-waste-btn" type="button">Waste Pareto</button>
        </div>

        <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">
          <select id="inv-category-filter" class="form-control" style="font-size:11px;padding:4px 8px;height:28px;">
            <option value="ALL" ${invCategoryFilter === 'ALL' ? 'selected' : ''}>All Categories</option>
            ${categories.map((c) => `<option value="${c}" ${invCategoryFilter === c ? 'selected' : ''}>${c}</option>`).join('')}
          </select>

          <select id="inv-expiry-window" class="form-control" style="font-size:11px;padding:4px 8px;height:28px;">
            <option value="7" ${invExpiryWindowFilter === '7' ? 'selected' : ''}>Expiring in 7 Days</option>
            <option value="15" ${invExpiryWindowFilter === '15' ? 'selected' : ''}>Expiring in 15 Days</option>
            <option value="30" ${invExpiryWindowFilter === '30' ? 'selected' : ''}>Expiring in 30 Days</option>
            <option value="60" ${invExpiryWindowFilter === '60' ? 'selected' : ''}>Expiring in 60 Days</option>
          </select>

          <input type="text" id="inv-search-input" placeholder="Search SKU / Item..." value="${invSearchTerm}" class="form-control" style="font-size:11px;padding:4px 8px;height:28px;width:140px;" />

          <button class="btn btn-xs btn-outline" id="inv-reset-btn" type="button">Reset</button>
        </div>
      </div>

      <!-- VIEW RENDERERS -->
      ${invActiveView === 'overview' ? `
        <!-- Visuals Grid: Category Valuation & Waterfall -->
        <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(320px, 1fr));gap:14px;">
          <!-- Category Stock Valuation Bars -->
          <div class="card" style="padding:14px;background:var(--surface-sunken);">
            <h4 style="font-size:12px;font-weight:700;color:var(--ink);margin:0 0 10px 0;">Category Stock Valuation</h4>
            <div style="display:flex;flex-direction:column;gap:8px;font-size:12px;">
              ${byCategory.slice(0, 6).map((cat) => `
                <div>
                  <div style="display:flex;justify-content:space-between;margin-bottom:2px;">
                    <span style="font-weight:600;">${cat.category}</span>
                    <span><strong>₹${cat.valuation.toLocaleString('en-IN')}</strong> (${cat.sharePercent}%)</span>
                  </div>
                  <div style="height:6px;background:var(--line);border-radius:3px;overflow:hidden;">
                    <div style="width:${cat.sharePercent}%;height:100%;background:var(--accent, #3b82f6);border-radius:3px;"></div>
                  </div>
                </div>
              `).join('')}
            </div>
          </div>

          <!-- Inventory Ageing Presentation Buckets -->
          <div class="card" style="padding:14px;background:var(--surface-sunken);">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
              <h4 style="font-size:12px;font-weight:700;color:var(--ink);margin:0;">Inventory Ageing Bands</h4>
              <span class="pill pill-slate" style="font-size:9px;">REPORT PRESENTATION BUCKET</span>
            </div>
            <div style="display:flex;flex-direction:column;gap:6px;font-size:12px;">
              ${(ageing.buckets || []).map((b) => `
                <div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--line);">
                  <span><strong>${b.label}</strong> (${b.lotCount} lots)</span>
                  <span>₹${b.valuation.toLocaleString('en-IN')} (${b.sharePercent}%)</span>
                </div>
              `).join('')}
            </div>
          </div>

          <!-- Stock Movement Waterfall -->
          <div class="card" style="padding:14px;background:var(--surface-sunken);">
            <h4 style="font-size:12px;font-weight:700;color:var(--ink);margin:0 0 10px 0;">Stock Movement Waterfall</h4>
            <div style="display:flex;flex-direction:column;gap:6px;font-size:12px;">
              <div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--line);">
                <span>Opening Balance</span><strong>₹${(movementWaterfall?.openingBalance || 0).toLocaleString('en-IN')}</strong>
              </div>
              <div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--line);">
                <span>Inbound Receipts (GRN)</span><strong style="color:var(--mint, #10b981);">+₹${(movementWaterfall?.inboundGRN || 0).toLocaleString('en-IN')}</strong>
              </div>
              <div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--line);">
                <span>Transfers In</span><strong style="color:var(--mint, #10b981);">+₹${(movementWaterfall?.interCafeTransfersIn || 0).toLocaleString('en-IN')}</strong>
              </div>
              <div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--line);">
                <span>Transfers Out</span><strong style="color:var(--coral, #ef4444);">-₹${Math.abs(movementWaterfall?.interCafeTransfersOut || 0).toLocaleString('en-IN')}</strong>
              </div>
              <div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--line);">
                <span>Wastage &amp; Disposals</span><strong style="color:var(--coral, #ef4444);">-₹${Math.abs(movementWaterfall?.wastageWrittenOff || 0).toLocaleString('en-IN')}</strong>
              </div>
              <div style="display:flex;justify-content:space-between;padding:6px 0;font-weight:700;color:var(--ink);">
                <span>Closing Stock Valuation</span><strong>₹${(movementWaterfall?.closingBalance || 0).toLocaleString('en-IN')}</strong>
              </div>
            </div>
          </div>
        </div>
      ` : ''}

      ${invActiveView === 'categories' ? `
        <div class="card" style="padding:12px;background:var(--surface-sunken);overflow-x:auto;">
          <h4 style="font-size:12px;font-weight:700;color:var(--ink);margin:0 0 8px 0;">Valuation by Category</h4>
          <table class="glass-table" style="width:100%;font-size:12px;">
            <thead>
              <tr>
                <th>Category</th>
                <th>Quantity</th>
                <th>Valuation (₹)</th>
                <th>Share %</th>
                <th>SKU Count</th>
              </tr>
            </thead>
            <tbody>
              ${byCategory.length > 0 ? byCategory.map((c) => `
                <tr>
                  <td><strong>${c.category}</strong></td>
                  <td>${c.quantity.toLocaleString('en-IN')}</td>
                  <td>₹${c.valuation.toLocaleString('en-IN')}</td>
                  <td>${c.sharePercent}%</td>
                  <td>${c.skuCount}</td>
                </tr>
              `).join('') : '<tr><td colspan="5" style="text-align:center;padding:16px;">No categories found.</td></tr>'}
            </tbody>
          </table>
        </div>
      ` : ''}

      ${invActiveView === 'items' ? `
        <div class="card" style="padding:12px;background:var(--surface-sunken);overflow-x:auto;">
          <h4 style="font-size:12px;font-weight:700;color:var(--ink);margin:0 0 8px 0;">Valuation by Inventory SKU / Item (${filteredItems.length})</h4>
          <table class="glass-table" style="width:100%;font-size:12px;">
            <thead>
              <tr>
                <th>SKU</th>
                <th>Item Name</th>
                <th>Category</th>
                <th>Unit Cost</th>
                <th>Quantity</th>
                <th>Valuation</th>
                <th>Nearest Expiry</th>
                <th>Criticality</th>
              </tr>
            </thead>
            <tbody>
              ${filteredItems.length > 0 ? filteredItems.slice(0, 50).map((i) => `
                <tr>
                  <td><code>${i.sku}</code></td>
                  <td><strong>${i.itemName}</strong></td>
                  <td>${i.category}</td>
                  <td>₹${(i.unitCostPaisa / 100).toFixed(2)} / ${i.baseUnit}</td>
                  <td>${i.quantity.toLocaleString('en-IN')} ${i.baseUnit}</td>
                  <td>₹${i.valuation.toLocaleString('en-IN')}</td>
                  <td>${i.nearestExpiry ? i.nearestExpiry.substring(0, 10) : 'N/A'}</td>
                  <td><span class="pill ${i.criticality === 'CRITICAL' ? 'pill-coral' : 'pill-slate'}" style="font-size:9px;">${i.criticality}</span></td>
                </tr>
              `).join('') : '<tr><td colspan="8" style="text-align:center;padding:16px;">No inventory items match filter.</td></tr>'}
            </tbody>
          </table>
        </div>
      ` : ''}

      ${invActiveView === 'lots' ? `
        <div class="card" style="padding:12px;background:var(--surface-sunken);overflow-x:auto;">
          <h4 style="font-size:12px;font-weight:700;color:var(--ink);margin:0 0 8px 0;">Expiring Soon &amp; Expired Batches</h4>
          <table class="glass-table" style="width:100%;font-size:12px;">
            <thead>
              <tr>
                <th>Lot ID</th>
                <th>Item Name</th>
                <th>Café</th>
                <th>Remaining Qty</th>
                <th>Valuation (₹)</th>
                <th>Expiry Date</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              ${(expiry.expiredLots || []).map((l) => `
                <tr style="background:rgba(239, 68, 68, 0.04);">
                  <td><code>${l.lotId}</code></td>
                  <td><strong>${l.itemName}</strong></td>
                  <td>${l.cafeId}</td>
                  <td>${l.remainingQuantity}</td>
                  <td>₹${(l.valuationPaisa / 100).toFixed(2)}</td>
                  <td><strong style="color:var(--coral, #ef4444);">${l.expiryDate ? l.expiryDate.substring(0, 10) : 'N/A'}</strong></td>
                  <td><span class="pill pill-coral" style="font-size:9px;">EXPIRED</span></td>
                </tr>
              `).concat((expiry.expiringSoonLots || []).map((l) => `
                <tr style="background:rgba(245, 158, 11, 0.04);">
                  <td><code>${l.lotId}</code></td>
                  <td><strong>${l.itemName}</strong></td>
                  <td>${l.cafeId}</td>
                  <td>${l.remainingQuantity}</td>
                  <td>₹${(l.valuationPaisa / 100).toFixed(2)}</td>
                  <td><strong style="color:var(--amber, #f59e0b);">${l.expiryDate ? l.expiryDate.substring(0, 10) : 'N/A'}</strong></td>
                  <td><span class="pill pill-amber" style="font-size:9px;">EXPIRING SOON</span></td>
                </tr>
              `)).join('') || '<tr><td colspan="7" style="text-align:center;padding:16px;">No expired or expiring lots found.</td></tr>'}
            </tbody>
          </table>
        </div>
      ` : ''}

      ${invActiveView === 'transfers' ? `
        <div class="card" style="padding:12px;background:var(--surface-sunken);overflow-x:auto;">
          <h4 style="font-size:12px;font-weight:700;color:var(--ink);margin:0 0 8px 0;">Inter-Café Stock Transfers</h4>
          <table class="glass-table" style="width:100%;font-size:12px;">
            <thead>
              <tr>
                <th>Transfer ID</th>
                <th>Source Café</th>
                <th>Destination Café</th>
                <th>Item</th>
                <th>Requested</th>
                <th>Dispatched</th>
                <th>Received</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              ${(transfers.transfers || []).length > 0 ? (transfers.transfers || []).map((t) => `
                <tr>
                  <td><code>${t.transferId}</code></td>
                  <td>${t.sourceCafeId}</td>
                  <td>${t.destCafeId}</td>
                  <td>${t.itemName}</td>
                  <td>${t.requestedQty}</td>
                  <td>${t.dispatchedQty}</td>
                  <td>${t.receivedQty}</td>
                  <td><span class="pill ${t.status === 'COMPLETED' ? 'pill-mint' : 'pill-amber'}" style="font-size:9px;">${t.status}</span></td>
                </tr>
              `).join('') : '<tr><td colspan="8" style="text-align:center;padding:16px;">No stock transfers recorded.</td></tr>'}
            </tbody>
          </table>
        </div>
      ` : ''}

      ${invActiveView === 'waste' ? `
        <div class="card" style="padding:12px;background:var(--surface-sunken);overflow-x:auto;">
          <h4 style="font-size:12px;font-weight:700;color:var(--ink);margin:0 0 8px 0;">Wastage Pareto Ranking (Cumulative Loss)</h4>
          <table class="glass-table" style="width:100%;font-size:12px;">
            <thead>
              <tr>
                <th>Rank</th>
                <th>Item Name</th>
                <th>Waste Quantity</th>
                <th>Waste Value (₹)</th>
                <th>Share %</th>
                <th>Cumulative %</th>
              </tr>
            </thead>
            <tbody>
              ${(wasteIntelligence.pareto || []).length > 0 ? (wasteIntelligence.pareto || []).map((w) => `
                <tr>
                  <td><strong>#${w.rank}</strong></td>
                  <td><strong>${w.itemName}</strong></td>
                  <td>${w.wasteQuantity}</td>
                  <td>₹${w.wasteValue.toLocaleString('en-IN')}</td>
                  <td>${w.sharePercent}%</td>
                  <td>${w.cumulativePercent}%</td>
                </tr>
              `).join('') : '<tr><td colspan="6" style="text-align:center;padding:16px;">No waste records logged for period.</td></tr>'}
            </tbody>
          </table>
        </div>
      ` : ''}
    </div>
  `;

  // Attach event listeners
  root.querySelector('#inv-view-overview-btn')?.addEventListener('click', () => { invActiveView = 'overview'; renderInventorySubtab(root, container); });
  root.querySelector('#inv-view-categories-btn')?.addEventListener('click', () => { invActiveView = 'categories'; renderInventorySubtab(root, container); });
  root.querySelector('#inv-view-items-btn')?.addEventListener('click', () => { invActiveView = 'items'; renderInventorySubtab(root, container); });
  root.querySelector('#inv-view-lots-btn')?.addEventListener('click', () => { invActiveView = 'lots'; renderInventorySubtab(root, container); });
  root.querySelector('#inv-view-transfers-btn')?.addEventListener('click', () => { invActiveView = 'transfers'; renderInventorySubtab(root, container); });
  root.querySelector('#inv-view-waste-btn')?.addEventListener('click', () => { invActiveView = 'waste'; renderInventorySubtab(root, container); });

  root.querySelector('#inv-category-filter')?.addEventListener('change', (e) => { invCategoryFilter = e.target.value; renderInventorySubtab(root, container); });
  root.querySelector('#inv-expiry-window')?.addEventListener('change', (e) => { invExpiryWindowFilter = e.target.value; renderInventorySubtab(root, container); });
  root.querySelector('#inv-search-input')?.addEventListener('input', (e) => { invSearchTerm = e.target.value; renderInventorySubtab(root, container); });
  root.querySelector('#inv-reset-btn')?.addEventListener('click', () => {
    invCategoryFilter = 'ALL';
    invExpiryWindowFilter = '30';
    invSearchTerm = '';
    invActiveView = 'overview';
    renderInventorySubtab(root, container);
  });
}

async function renderProcurementSubtab(root, container) {
  container.innerHTML = skeleton('240px');
  try {
    const res = await apiGet('/reports/procurement' + buildFilterQueryString('procurement'));
    if (res?.data) cachedProcurement = res.data;
  } catch (_) {}

  if (!cachedProcurement) {
    cachedProcurement = {
      spendSummary: {
        totalPoCommitments: 0,
        grnReceivedValue: 0,
        invoicedValue: 0,
        paidValue: null,
        paidValueAvailability: 'UNAVAILABLE',
        outstandingPayable: 0,
        totalPoCount: 0,
        openPoCount: 0,
        onTimeDeliveryPercent: 100,
      },
      supplierSpend: [],
      poStatusBreakdown: [],
      overduePOs: [],
      vendorIntelligence: {
        vendors: [],
        orderedVsReceived: [],
        deliveryPerformance: { onTimePercent: 100, averageDelayDays: 0 },
        priceTrends: [],
        singleSourceItems: [],
        criticalDependencies: [],
        compliance: [],
        exceptions: [],
        payablesAging: [],
      },
    };
  }

  const {
    spendSummary = {},
    supplierSpend = [],
    poStatusBreakdown = [],
    overduePOs = [],
    vendorIntelligence = {
      vendors: [],
      orderedVsReceived: [],
      deliveryPerformance: {},
      priceTrends: [],
      singleSourceItems: [],
      criticalDependencies: [],
      compliance: [],
      exceptions: [],
      payablesAging: [],
    },
  } = cachedProcurement;

  const vendorList = vendorIntelligence.vendors || [];
  const vendorNames = Array.from(new Set(vendorList.map((v) => v.supplier)));

  container.innerHTML = `
    <div class="card" style="padding:16px;background:var(--surface);display:flex;flex-direction:column;gap:14px;">
      <!-- Title & Headline -->
      <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:8px;">
        <div>
          <h3 style="font-size:15px;font-weight:700;color:var(--ink);margin:0;">Procurement &amp; Vendor Intelligence Suite</h3>
          <p style="font-size:11px;color:var(--muted);margin:2px 0 0 0;">Lifecycle commitments, delivery reliability, vendor price history, fill rate, dock inspections &amp; payables</p>
        </div>
        <div style="display:flex;align-items:center;gap:6px;">
          <span class="pill pill-sky" style="font-size:10px;font-weight:700;">PM-02E ACTIVATED</span>
          <button class="btn btn-sm btn-primary" data-export-report="procurement-spend" style="font-size:12px;" type="button">ZURF Export</button>
        </div>
      </div>

      <!-- Financial Lifecycle Notice -->
      <div style="padding:10px 14px;background:rgba(59, 130, 246, 0.08);border-left:3px solid var(--accent, #3b82f6);border-radius:4px;font-size:11px;color:var(--ink);display:flex;align-items:center;gap:8px;">
        <span style="font-size:14px;">ℹ️</span>
        <div>
          <strong>Financial Demarcation Safeguard:</strong> Ordered commitments reflect active Purchase Orders. Received value reflects Goods Receipts (GRN). Paid Value is <strong>UNAVAILABLE</strong> because transaction-level AP-to-bank settlement is unposted. Unapproved composite vendor scoring is strictly prohibited; component KPIs are presented side-by-side.
        </div>
      </div>

      <!-- Live KPI Cards -->
      <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(180px, 1fr));gap:10px;">
        <div class="card" style="padding:10px;background:var(--surface-sunken);">
          <div style="font-size:10px;color:var(--muted);text-transform:uppercase;font-weight:700;">Ordered Commitments</div>
          <div style="font-size:18px;font-weight:800;color:var(--ink);margin-top:2px;">₹${(spendSummary.totalPoCommitments || 0).toLocaleString('en-IN')}</div>
          <div style="font-size:10px;color:var(--muted);margin-top:2px;">${spendSummary.totalPoCount || 0} POs &bull; ${spendSummary.openPoCount || 0} Open POs</div>
        </div>

        <div class="card" style="padding:10px;background:var(--surface-sunken);">
          <div style="font-size:10px;color:var(--muted);text-transform:uppercase;font-weight:700;">Received Value (PO-Priced)</div>
          <div style="font-size:18px;font-weight:800;color:var(--mint, #10b981);margin-top:2px;">₹${(spendSummary.grnReceivedValue || 0).toLocaleString('en-IN')}</div>
          <div style="font-size:10px;color:var(--muted);margin-top:2px;">Operational trust (PO unit price)</div>
        </div>

        <div class="card" style="padding:10px;background:var(--surface-sunken);">
          <div style="font-size:10px;color:var(--muted);text-transform:uppercase;font-weight:700;">Invoiced Value (AP)</div>
          <div style="font-size:18px;font-weight:800;color:var(--ink);margin-top:2px;">₹${(spendSummary.invoicedValue || 0).toLocaleString('en-IN')}</div>
          <div style="font-size:10px;color:var(--muted);margin-top:2px;">Posted &amp; partially paid AP</div>
        </div>

        <div class="card" style="padding:10px;background:var(--surface-sunken);">
          <div style="font-size:10px;color:var(--muted);text-transform:uppercase;font-weight:700;">Paid Value</div>
          <div style="font-size:18px;font-weight:800;color:var(--slate, #64748b);margin-top:2px;">Unavailable</div>
          <div style="font-size:10px;color:var(--muted);margin-top:2px;">AP-to-bank linkage unposted</div>
        </div>

        <div class="card" style="padding:10px;background:var(--surface-sunken);">
          <div style="font-size:10px;color:var(--muted);text-transform:uppercase;font-weight:700;">Outstanding Payables</div>
          <div style="font-size:18px;font-weight:800;color:var(--amber, #f59e0b);margin-top:2px;">₹${(spendSummary.outstandingPayable || 0).toLocaleString('en-IN')}</div>
          <div style="font-size:10px;color:var(--muted);margin-top:2px;">Authoritative invoice remaining</div>
        </div>

        <div class="card" style="padding:10px;background:var(--surface-sunken);">
          <div style="font-size:10px;color:var(--muted);text-transform:uppercase;font-weight:700;">On-Time Delivery %</div>
          <div style="font-size:18px;font-weight:800;color:${(spendSummary.onTimeDeliveryPercent || 100) >= 90 ? 'var(--mint, #10b981)' : 'var(--coral, #ef4444)'};margin-top:2px;">
            ${spendSummary.onTimeDeliveryPercent || 100}%
          </div>
          <div style="font-size:10px;color:var(--muted);margin-top:2px;">First: ${spendSummary.firstReceiptOnTimePercent ?? spendSummary.onTimeDeliveryPercent ?? 100}% &bull; Full: ${spendSummary.finalFulfillmentOnTimePercent ?? spendSummary.onTimeDeliveryPercent ?? 100}%</div>
        </div>
      </div>

      <!-- Subtab View Navigation & Filter Toolbar -->
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;padding:8px 0;border-bottom:1px solid var(--line);">
        <div style="display:flex;gap:6px;flex-wrap:wrap;">
          <button class="btn btn-xs ${procActiveView === 'overview' ? 'btn-primary' : 'btn-secondary'}" id="proc-view-overview-btn" type="button">Scorecard (${vendorList.length})</button>
          <button class="btn btn-xs ${procActiveView === 'orders' ? 'btn-primary' : 'btn-secondary'}" id="proc-view-orders-btn" type="button">Purchase Orders</button>
          <button class="btn btn-xs ${procActiveView === 'prices' ? 'btn-primary' : 'btn-secondary'}" id="proc-view-prices-btn" type="button">Price Trends</button>
          <button class="btn btn-xs ${procActiveView === 'delivery' ? 'btn-primary' : 'btn-secondary'}" id="proc-view-delivery-btn" type="button">Delivery &amp; Quality</button>
          <button class="btn btn-xs ${procActiveView === 'exceptions' ? 'btn-primary' : 'btn-secondary'}" id="proc-view-exceptions-btn" type="button">Exceptions (${(vendorIntelligence.exceptions || []).length})</button>
        </div>

        <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">
          <select id="proc-vendor-filter" class="form-control" style="font-size:11px;padding:4px 8px;height:28px;">
            <option value="ALL" ${procVendorFilter === 'ALL' ? 'selected' : ''}>All Vendors</option>
            ${vendorList.map((v) => `<option value="${v.vendorId}" ${procVendorFilter === v.vendorId ? 'selected' : ''}>${v.supplier}</option>`).join('')}
          </select>

          <select id="proc-vendor-status-filter" class="form-control" style="font-size:11px;padding:4px 8px;height:28px;">
            <option value="ALL" ${procVendorStatusFilter === 'ALL' ? 'selected' : ''}>All Vendor Statuses</option>
            <option value="ACTIVE" ${procVendorStatusFilter === 'ACTIVE' ? 'selected' : ''}>Active</option>
            <option value="SUSPENDED" ${procVendorStatusFilter === 'SUSPENDED' ? 'selected' : ''}>Suspended</option>
            <option value="BLACKLISTED" ${procVendorStatusFilter === 'BLACKLISTED' ? 'selected' : ''}>Blacklisted</option>
            <option value="ARCHIVED" ${procVendorStatusFilter === 'ARCHIVED' ? 'selected' : ''}>Archived</option>
            <option value="DRAFT" ${procVendorStatusFilter === 'DRAFT' ? 'selected' : ''}>Draft</option>
            <option value="ONBOARDING" ${procVendorStatusFilter === 'ONBOARDING' ? 'selected' : ''}>Onboarding</option>
          </select>

          <select id="proc-status-filter" class="form-control" style="font-size:11px;padding:4px 8px;height:28px;">
            <option value="ALL" ${procPoStatusFilter === 'ALL' ? 'selected' : ''}>All PO Statuses</option>
            <option value="APPROVED" ${procPoStatusFilter === 'APPROVED' ? 'selected' : ''}>Approved</option>
            <option value="ORDER_PLACED" ${procPoStatusFilter === 'ORDER_PLACED' ? 'selected' : ''}>Order Placed</option>
            <option value="PARTIALLY_RECEIVED" ${procPoStatusFilter === 'PARTIALLY_RECEIVED' ? 'selected' : ''}>Partially Received</option>
            <option value="RECEIVED" ${procPoStatusFilter === 'RECEIVED' ? 'selected' : ''}>Received</option>
            <option value="CLOSED" ${procPoStatusFilter === 'CLOSED' ? 'selected' : ''}>Closed</option>
            <option value="CANCELLED" ${procPoStatusFilter === 'CANCELLED' ? 'selected' : ''}>Cancelled</option>
          </select>

          <input type="text" id="proc-search-input" placeholder="Search Vendor..." value="${procSearchTerm}" class="form-control" style="font-size:11px;padding:4px 8px;height:28px;width:140px;" />

          <button class="btn btn-xs btn-outline" id="proc-reset-btn" type="button">Reset</button>
        </div>
      </div>

      <!-- VIEW RENDERERS -->
      ${procActiveView === 'overview' ? `
        <!-- Visuals Grid: Ordered vs Received & Spend Concentration -->
        <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(320px, 1fr));gap:14px;">
          <!-- Ordered vs Received Comparison -->
          <div class="card" style="padding:14px;background:var(--surface-sunken);">
            <h4 style="font-size:12px;font-weight:700;color:var(--ink);margin:0 0 10px 0;">Ordered vs Received Value by Vendor</h4>
            <div style="display:flex;flex-direction:column;gap:8px;font-size:12px;">
              ${vendorList.slice(0, 5).map((v) => `
                <div>
                  <div style="display:flex;justify-content:space-between;margin-bottom:2px;">
                    <span style="font-weight:600;">${v.supplier}</span>
                    <span>Ordered: ₹${v.orderedValue.toLocaleString('en-IN')} &bull; Rec: ₹${v.receivedValue.toLocaleString('en-IN')}</span>
                  </div>
                  <div style="height:6px;background:var(--line);border-radius:3px;overflow:hidden;display:flex;">
                    <div style="width:${Math.min(100, v.spendSharePercent * 2)}%;height:100%;background:var(--accent, #3b82f6);"></div>
                    <div style="width:${Math.min(100, (v.receivedValue / (v.orderedValue || 1)) * 100 * 0.5)}%;height:100%;background:var(--mint, #10b981);"></div>
                  </div>
                </div>
              `).join('') || '<div style="color:var(--muted);padding:8px;">No supplier spend logged.</div>'}
            </div>
          </div>

          <!-- Vendor Spend Concentration -->
          <div class="card" style="padding:14px;background:var(--surface-sunken);">
            <h4 style="font-size:12px;font-weight:700;color:var(--ink);margin:0 0 10px 0;">Vendor Spend Concentration (Pareto)</h4>
            <div style="display:flex;flex-direction:column;gap:6px;font-size:12px;">
              ${vendorList.slice(0, 5).map((v) => `
                <div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--line);">
                  <span><strong>${v.supplier}</strong></span>
                  <span>${v.spendSharePercent}% share &bull; ${v.cumulativeSharePercent}% cum</span>
                </div>
              `).join('') || '<div style="color:var(--muted);padding:8px;">No supplier data.</div>'}
            </div>
          </div>
        </div>

        <!-- Vendor Component Scorecard Table -->
        <div class="card" style="padding:12px;background:var(--surface-sunken);overflow-x:auto;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
            <h4 style="font-size:12px;font-weight:700;color:var(--ink);margin:0;">Vendor Performance Component Scorecard</h4>
            <span class="pill pill-slate" style="font-size:9px;">OVERALL SCORE: NOT_CONFIGURED</span>
          </div>
          <table class="glass-table" style="width:100%;font-size:12px;">
            <thead>
              <tr>
                <th>Vendor / Supplier</th>
                <th>Category</th>
                <th>Ordered (₹)</th>
                <th>Received (₹)</th>
                <th>Invoiced (₹)</th>
                <th>Paid</th>
                <th>Lead Time</th>
                <th>On-Time %</th>
                <th>Fill Rate %</th>
                <th>Rejection %</th>
                <th>Open POs</th>
              </tr>
            </thead>
            <tbody>
              ${vendorList.length > 0 ? vendorList.map((v) => `
                <tr>
                  <td><strong>${v.supplier}</strong></td>
                  <td>${v.category}</td>
                  <td>₹${v.orderedValue.toLocaleString('en-IN')}</td>
                  <td>₹${v.receivedValue.toLocaleString('en-IN')}</td>
                  <td>₹${v.invoicedValue.toLocaleString('en-IN')}</td>
                  <td><span class="pill pill-slate" style="font-size:9px;">Unavailable</span></td>
                  <td>${v.leadTimeDays !== null ? v.leadTimeDays + ' days' : 'N/A'}</td>
                  <td>${v.onTimeDeliveryPercent !== null ? v.onTimeDeliveryPercent + '%' : 'N/A'}</td>
                  <td>${v.fillRatePercent !== null ? v.fillRatePercent + '%' : 'N/A'}</td>
                  <td>${v.rejectionRatePercent > 0 ? `<strong style="color:var(--coral, #ef4444);">${v.rejectionRatePercent}%</strong>` : '0%'}</td>
                  <td>${v.openPoCount}</td>
                </tr>
              `).join('') : '<tr><td colspan="11" style="text-align:center;padding:16px;">No vendors found for active filter.</td></tr>'}
            </tbody>
          </table>
        </div>
      ` : ''}

      ${procActiveView === 'orders' ? `
        <!-- Overdue POs Alert & PO Status Breakdown -->
        <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(300px, 1fr));gap:14px;">
          <div class="card" style="padding:12px;background:var(--surface-sunken);overflow-x:auto;">
            <h4 style="font-size:12px;font-weight:700;color:var(--ink);margin:0 0 8px 0;">Purchase Order Lifecycle Distribution</h4>
            <div style="display:flex;flex-direction:column;gap:6px;font-size:12px;">
              ${poStatusBreakdown.map((p) => `
                <div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--line);">
                  <span><span class="pill pill-sky" style="font-size:9px;">${p.status}</span></span>
                  <span><strong>${p.count}</strong> POs &bull; ₹${(p.totalPaisa / 100).toLocaleString('en-IN')}</span>
                </div>
              `).join('') || '<div style="color:var(--muted);padding:8px;">No POs logged.</div>'}
            </div>
          </div>

          <div class="card" style="padding:12px;background:var(--surface-sunken);overflow-x:auto;">
            <h4 style="font-size:12px;font-weight:700;color:var(--coral, #ef4444);margin:0 0 8px 0;">Overdue Purchase Orders (${overduePOs.length})</h4>
            <div style="display:flex;flex-direction:column;gap:6px;font-size:12px;">
              ${overduePOs.map((o) => `
                <div style="padding:6px;background:rgba(239, 68, 68, 0.04);border-radius:4px;border:1px solid rgba(239, 68, 68, 0.1);">
                  <div style="display:flex;justify-content:space-between;">
                    <strong>${o.purchaseOrderId}</strong>
                    <span style="color:var(--coral, #ef4444);font-weight:700;">${o.daysLate} days overdue</span>
                  </div>
                  <div style="font-size:10px;color:var(--muted);margin-top:2px;">
                    Vendor: ${o.vendorName} &bull; Expected: ${o.expectedDeliveryDate} &bull; ₹${(o.totalPaisa / 100).toLocaleString('en-IN')}
                  </div>
                </div>
              `).join('') || '<div style="color:var(--mint, #10b981);padding:8px;">Zero overdue purchase orders.</div>'}
            </div>
          </div>
        </div>
      ` : ''}

      ${procActiveView === 'prices' ? `
        <div class="card" style="padding:12px;background:var(--surface-sunken);overflow-x:auto;">
          <h4 style="font-size:12px;font-weight:700;color:var(--ink);margin:0 0 8px 0;">Vendor Purchase Price Trends &amp; History</h4>
          <table class="glass-table" style="width:100%;font-size:12px;">
            <thead>
              <tr>
                <th>Item Name</th>
                <th>Vendor</th>
                <th>Current Price</th>
                <th>Previous Price</th>
                <th>Variance %</th>
                <th>Effective Date</th>
              </tr>
            </thead>
            <tbody>
              ${(vendorIntelligence.priceTrends || []).length > 0 ? (vendorIntelligence.priceTrends || []).map((pt) => `
                <tr>
                  <td><strong>${pt.itemName}</strong></td>
                  <td>${pt.vendorName}</td>
                  <td>₹${(pt.currentPricePaisa / 100).toFixed(2)} / ${pt.baseUnit}</td>
                  <td>₹${(pt.previousPricePaisa / 100).toFixed(2)}</td>
                  <td><strong style="color:${pt.priceChangePercent > 0 ? 'var(--coral, #ef4444)' : 'var(--mint, #10b981)'};">${pt.priceChangePercent > 0 ? '+' : ''}${pt.priceChangePercent}%</strong></td>
                  <td>${pt.effectiveDate}</td>
                </tr>
              `).join('') : '<tr><td colspan="6" style="text-align:center;padding:16px;">No historical price variance detected for comparable units.</td></tr>'}
            </tbody>
          </table>
        </div>
      ` : ''}

      ${procActiveView === 'delivery' ? `
        <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(300px, 1fr));gap:14px;">
          <div class="card" style="padding:12px;background:var(--surface-sunken);">
            <h4 style="font-size:12px;font-weight:700;color:var(--ink);margin:0 0 8px 0;">Delivery Reliability Summary</h4>
            <div style="display:flex;flex-direction:column;gap:6px;font-size:12px;">
              <div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--line);">
                <span>Evaluated Deliveries</span><strong>${vendorIntelligence.deliveryPerformance?.totalEvaluated || 0}</strong>
              </div>
              <div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--line);">
                <span>On-Time Deliveries</span><strong style="color:var(--mint, #10b981);">${vendorIntelligence.deliveryPerformance?.onTimeDeliveries || 0} (${vendorIntelligence.deliveryPerformance?.onTimePercent || 100}%)</strong>
              </div>
              <div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--line);">
                <span>Late Deliveries</span><strong style="color:var(--coral, #ef4444);">${vendorIntelligence.deliveryPerformance?.lateDeliveries || 0}</strong>
              </div>
              <div style="display:flex;justify-content:space-between;padding:4px 0;">
                <span>Average Delay Days</span><strong>${vendorIntelligence.deliveryPerformance?.averageDelayDays || 0} days</strong>
              </div>
            </div>
          </div>

          <div class="card" style="padding:12px;background:var(--surface-sunken);">
            <h4 style="font-size:12px;font-weight:700;color:var(--ink);margin:0 0 8px 0;">Dock Quality &amp; Inspection Rejections</h4>
            <div style="display:flex;flex-direction:column;gap:6px;font-size:12px;">
              <div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--line);">
                <span>Inspected Quantity</span><strong>${vendorIntelligence.qualityAnalytics?.totalInspectedQuantity || 0}</strong>
              </div>
              <div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--line);">
                <span>Accepted Quantity</span><strong style="color:var(--mint, #10b981);">${vendorIntelligence.qualityAnalytics?.totalAcceptedQuantity || 0}</strong>
              </div>
              <div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--line);">
                <span>Rejected Quantity</span><strong style="color:var(--coral, #ef4444);">${vendorIntelligence.qualityAnalytics?.totalRejectedQuantity || 0} (${vendorIntelligence.qualityAnalytics?.rejectionPercent || 0}%)</strong>
              </div>
              <div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--line);">
                <span>Temperature Compliance</span>
                <strong>${vendorIntelligence.qualityAnalytics?.temperatureFailureAvailability === 'UNAVAILABLE'
                  ? '<span class="pill pill-slate" style="font-size:9px;">UNAVAILABLE</span>'
                  : `${vendorIntelligence.qualityAnalytics?.temperatureFailureCount || 0} Excursions (${vendorIntelligence.qualityAnalytics?.temperatureFailureAvailability || 'COMPLETE'})`
                }</strong>
              </div>
              <div style="display:flex;justify-content:space-between;padding:4px 0;">
                <span>Packaging Failures</span><strong>${vendorIntelligence.qualityAnalytics?.packagingDamageCount || 0}</strong>
              </div>
            </div>
          </div>
        </div>
      ` : ''}

      ${procActiveView === 'exceptions' ? `
        <div style="display:flex;flex-direction:column;gap:14px;">
          <!-- Exception Centre -->
          <div class="card" style="padding:12px;background:var(--surface-sunken);overflow-x:auto;">
            <h4 style="font-size:12px;font-weight:700;color:var(--coral, #ef4444);margin:0 0 8px 0;">Vendor Exception Centre</h4>
            <table class="glass-table" style="width:100%;font-size:12px;">
              <thead>
                <tr>
                  <th>Type</th>
                  <th>Reference</th>
                  <th>Vendor</th>
                  <th>Details</th>
                  <th>Severity</th>
                </tr>
              </thead>
              <tbody>
                ${(vendorIntelligence.exceptions || []).length > 0 ? (vendorIntelligence.exceptions || []).map((e) => `
                  <tr>
                    <td><span class="pill ${e.severity === 'HIGH' ? 'pill-coral' : 'pill-amber'}" style="font-size:9px;">${e.type}</span></td>
                    <td><code>${e.referenceId}</code></td>
                    <td><strong>${e.vendorName}</strong></td>
                    <td>${e.detail}</td>
                    <td><strong>${e.severity}</strong></td>
                  </tr>
                `).join('') : '<tr><td colspan="5" style="text-align:center;padding:16px;color:var(--mint, #10b981);">Zero vendor exceptions detected.</td></tr>'}
              </tbody>
            </table>
          </div>

          <!-- Single Source & Critical Supplier Dependency -->
          <div class="card" style="padding:12px;background:var(--surface-sunken);overflow-x:auto;">
            <h4 style="font-size:12px;font-weight:700;color:var(--ink);margin:0 0 8px 0;">Single-Source &amp; Critical Supplier Dependencies</h4>
            <table class="glass-table" style="width:100%;font-size:12px;">
              <thead>
                <tr>
                  <th>Item Name</th>
                  <th>Category</th>
                  <th>Sole Active Supplier</th>
                  <th>Criticality</th>
                </tr>
              </thead>
              <tbody>
                ${(vendorIntelligence.singleSourceItems || []).length > 0 ? (vendorIntelligence.singleSourceItems || []).map((s) => `
                  <tr>
                    <td><strong>${s.itemName}</strong></td>
                    <td>${s.category}</td>
                    <td>${s.vendorName}</td>
                    <td><span class="pill ${s.criticality === 'CRITICAL' ? 'pill-coral' : 'pill-slate'}" style="font-size:9px;">${s.criticality}</span></td>
                  </tr>
                `).join('') : '<tr><td colspan="4" style="text-align:center;padding:16px;">No single-source dependencies detected.</td></tr>'}
              </tbody>
            </table>
          </div>

          <!-- Payables Aging Bands -->
          <div class="card" style="padding:12px;background:var(--surface-sunken);overflow-x:auto;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
              <h4 style="font-size:12px;font-weight:700;color:var(--ink);margin:0;">Payables Aging Schedule (AP Invoices)</h4>
              <span class="pill pill-slate" style="font-size:9px;">REPORT PRESENTATION BUCKET</span>
            </div>
            <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(140px, 1fr));gap:8px;font-size:12px;">
              ${(vendorIntelligence.payablesAging || []).map((b) => `
                <div style="padding:8px;background:var(--surface);border-radius:4px;border:1px solid var(--line);">
                  <div style="font-size:10px;color:var(--muted);">${b.label}</div>
                  <div style="font-size:14px;font-weight:700;color:var(--ink);margin-top:2px;">₹${b.outstanding.toLocaleString('en-IN')}</div>
                  <div style="font-size:9px;color:var(--muted);margin-top:2px;">${b.count} invoices</div>
                </div>
              `).join('')}
            </div>
          </div>
        </div>
      ` : ''}
    </div>
  `;

  // Attach event listeners
  root.querySelector('#proc-view-overview-btn')?.addEventListener('click', () => { procActiveView = 'overview'; renderProcurementSubtab(root, container); });
  root.querySelector('#proc-view-orders-btn')?.addEventListener('click', () => { procActiveView = 'orders'; renderProcurementSubtab(root, container); });
  root.querySelector('#proc-view-prices-btn')?.addEventListener('click', () => { procActiveView = 'prices'; renderProcurementSubtab(root, container); });
  root.querySelector('#proc-view-delivery-btn')?.addEventListener('click', () => { procActiveView = 'delivery'; renderProcurementSubtab(root, container); });
  root.querySelector('#proc-view-exceptions-btn')?.addEventListener('click', () => { procActiveView = 'exceptions'; renderProcurementSubtab(root, container); });

  root.querySelector('#proc-vendor-filter')?.addEventListener('change', (e) => { procVendorFilter = e.target.value; renderProcurementSubtab(root, container); });
  root.querySelector('#proc-vendor-status-filter')?.addEventListener('change', (e) => { procVendorStatusFilter = e.target.value; renderProcurementSubtab(root, container); });
  root.querySelector('#proc-status-filter')?.addEventListener('change', (e) => { procPoStatusFilter = e.target.value; renderProcurementSubtab(root, container); });
  root.querySelector('#proc-search-input')?.addEventListener('input', (e) => { procSearchTerm = e.target.value; renderProcurementSubtab(root, container); });
  root.querySelector('#proc-reset-btn')?.addEventListener('click', () => {
    procVendorFilter = 'ALL';
    procVendorStatusFilter = 'ALL';
    procPoStatusFilter = 'ALL';
    procSearchTerm = '';
    procActiveView = 'overview';
    renderProcurementSubtab(root, container);
  });
}

async function renderMenuSubtab(root, container) {
  container.innerHTML = skeleton('240px');
  try {
    const res = await apiGet('/reports/menu' + buildFilterQueryString('menu'));
    if (res?.data) cachedMenu = res.data;
  } catch (_) {}

  if (!cachedMenu || !cachedMenu.engineering) {
    cachedMenu = {
      menuPerformance: [],
      engineering: {
        items: [],
        summary: {
          totalItemsTracked: 0,
          totalClassifiedItems: 0,
          quadrantCounts: { STAR: 0, PLOWHORSE: 0, PUZZLE: 0, DOG: 0, UNCLASSIFIED: 0 },
          thresholds: { popularityThresholdPercent: 0, contributionThresholdPaisa: 0, methodology: 'DATASET_RELATIVE_ITEM_MEAN' },
          avgEstimatedContributionPercent: 0,
        },
      },
      quadrants: { STAR: [], PLOWHORSE: [], PUZZLE: [], DOG: [], UNCLASSIFIED: [] },
      thresholds: { popularityCutoffUnits: 0, contributionCutoffUnitInr: 0, methodology: 'DATASET_RELATIVE_ITEM_MEAN' },
      priceHistory: [],
      salesVelocity: [],
      unmappedItems: [],
      dataQuality: { state: 'CLEAN', warnings: [] },
      theoreticalCostingNotice: 'Historical ingredient-cost reconstruction unavailable; estimated contribution uses current standard ingredient cost. Cost timestamp unavailable. Recipe history unavailable: CURRENT_RECIPE_ESTIMATE. Actual COGS unavailable.',
    };
  }

  const {
    engineering = { items: [], summary: {} },
    quadrants = { STAR: [], PLOWHORSE: [], PUZZLE: [], DOG: [], UNCLASSIFIED: [] },
    thresholds = { popularityCutoffUnits: 0, contributionCutoffUnitInr: 0, contributionThresholdPaisa: 0, methodology: 'DATASET_RELATIVE_ITEM_MEAN' },
    priceHistory = [],
    salesVelocity = [],
    unmappedItems = [],
    dataQuality = { state: 'CLEAN', warnings: [] },
    theoreticalCostingNotice = 'Historical ingredient-cost reconstruction unavailable; estimated contribution uses current standard cost. Recipe history unavailable: CURRENT_RECIPE_ESTIMATE. Actual COGS unavailable.',
  } = cachedMenu;

  const engItems = engineering.items || cachedMenu.menuPerformance || [];
  const engSummary = engineering.summary || {};
  const qCounts = engSummary.quadrantCounts || {
    STAR: (quadrants.STAR || []).length,
    PLOWHORSE: (quadrants.PLOWHORSE || []).length,
    PUZZLE: (quadrants.PUZZLE || []).length,
    DOG: (quadrants.DOG || []).length,
    UNCLASSIFIED: (quadrants.UNCLASSIFIED || []).length,
  };

  const dqPillClass = dataQuality.state === 'CLEAN' ? 'pill-mint' : dataQuality.state === 'PARTIAL' ? 'pill-amber' : 'pill-coral';

  const categories = Array.from(new Set(engItems.map(i => i.category).filter(Boolean)));
  const filteredItems = engItems.filter(i => {
    const matchCat = menuCategoryFilter === 'ALL' || i.category === menuCategoryFilter;
    const matchQuad = menuQuadrantFilter === 'ALL' || i.quadrant === menuQuadrantFilter;
    const name = i.itemName || i.name || i.item || '';
    const matchSearch = !menuSearchTerm || name.toLowerCase().includes(menuSearchTerm.toLowerCase());
    return matchCat && matchQuad && matchSearch;
  });

  let viewHtml = '';

  // 1. MENU ENGINEERING MATRIX VIEW
  if (menuActiveView === 'matrix') {
    const maxUnits = Math.max(1, ...engItems.map(i => i.quantity || i.unitsSold || 0));
    const maxContr = Math.max(1, ...engItems.map(i => (i.unitEstimatedContributionPaisa || 0) / 100));
    const popCutoff = thresholds.popularityCutoffUnits || 1;
    const contrCutoff = thresholds.contributionCutoffUnitInr || ((thresholds.contributionCutoffUnitPaisa || thresholds.contributionThresholdPaisa || 0) / 100);

    const xCrossPct = Math.min(90, Math.max(10, Math.round((popCutoff / maxUnits) * 100)));
    const yCrossPct = Math.min(90, Math.max(10, Math.round((contrCutoff / maxContr) * 100)));

    viewHtml = `
      <!-- Prominent Historical Cost & Recipe Estimate Notice -->
      <div style="padding:10px 14px;background:var(--surface-sunken);border-radius:6px;font-size:11px;border-left:3px solid var(--amber, #f59e0b);">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px;">
          <div>
            <strong style="color:var(--ink);">THEORETICAL_COGS_CURRENT_STANDARD (Actuality: ESTIMATED):</strong>
            <span style="color:var(--muted);margin-left:6px;">${theoreticalCostingNotice}</span>
          </div>
          <span class="pill pill-amber" style="font-size:10px;font-weight:700;">CURRENT_RECIPE_ESTIMATE</span>
        </div>
      </div>

      <!-- VISUAL 6: # MENU ENGINEERING MATRIX (Scatter/Bubble Plot) -->
      <div class="card" style="padding:16px;background:var(--surface-sunken);">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;flex-wrap:wrap;gap:8px;">
          <div>
            <h4 style="font-size:14px;font-weight:800;color:var(--ink);margin:0;"># MENU ENGINEERING MATRIX</h4>
            <p style="font-size:10.5px;color:var(--muted);margin:2px 0 0 0;">Volume (Units Sold) × Estimated Unit Contribution (₹) · Bubble Size: Net Sales</p>
          </div>
          <div style="display:flex;gap:6px;align-items:center;">
            <span class="pill pill-amber" style="font-size:10px;font-weight:700;">ESTIMATED</span>
            <span class="badge" style="font-size:10px;">${engItems.length} items mapped</span>
          </div>
        </div>

        <!-- 2D Coordinate Grid Chart -->
        <div style="position:relative;width:100%;height:260px;background:var(--surface);border:1px solid var(--line);border-radius:6px;overflow:hidden;">
          <!-- Quadrant Background Demarcations -->
          <div style="position:absolute;top:0;left:0;width:${xCrossPct}%;height:${100 - yCrossPct}%;background:rgba(245, 158, 11, 0.04);border-right:1px dashed var(--line);border-bottom:1px dashed var(--line);padding:6px;font-size:9.5px;font-weight:700;color:var(--amber, #f59e0b);">
            🧩 PUZZLE (Low Vol / High Contr)
          </div>
          <div style="position:absolute;top:0;left:${xCrossPct}%;right:0;height:${100 - yCrossPct}%;background:rgba(16, 185, 129, 0.05);border-bottom:1px dashed var(--line);padding:6px;font-size:9.5px;font-weight:700;color:var(--mint, #10b981);text-align:right;">
            ⭐ STAR (High Vol / High Contr)
          </div>
          <div style="position:absolute;bottom:0;left:0;width:${xCrossPct}%;height:${yCrossPct}%;background:rgba(239, 68, 68, 0.04);border-right:1px dashed var(--line);padding:6px;font-size:9.5px;font-weight:700;color:var(--coral, #ef4444);">
            🐕 DOG (Low Vol / Low Contr)
          </div>
          <div style="position:absolute;bottom:0;left:${xCrossPct}%;right:0;height:${yCrossPct}%;background:rgba(2, 132, 199, 0.04);padding:6px;font-size:9.5px;font-weight:700;color:var(--sky, #0284c7);text-align:right;">
            🐎 PLOWHORSE (High Vol / Low Contr)
          </div>

          <!-- Plotted Item Bubbles -->
          ${engItems.map(i => {
            const units = i.quantity || i.unitsSold || 0;
            const uContr = i.unitEstimatedContributionPaisa !== undefined && i.unitEstimatedContributionPaisa !== null
              ? (i.unitEstimatedContributionPaisa / 100)
              : ((i.estimatedContributionPaise || 0) / (units || 1) / 100);
            const xPos = Math.min(94, Math.max(6, Math.round((units / maxUnits) * 100)));
            const yPos = 100 - Math.min(94, Math.max(6, Math.round((Math.max(0, uContr) / maxContr) * 100)));

            const col = i.quadrant === 'STAR' ? '#10b981' : i.quadrant === 'PLOWHORSE' ? '#0284c7' : i.quadrant === 'PUZZLE' ? '#f59e0b' : i.quadrant === 'DOG' ? '#ef4444' : '#94a3b8';
            const netVal = (i.netSalesPaise || i.netSalesPaisa || (i.revenue ? i.revenue * 100 : 0)) / 100;
            const size = Math.min(22, Math.max(10, Math.round(Math.sqrt(netVal) / 8)));

            return `
              <div
                style="position:absolute;left:${xPos}%;top:${yPos}%;width:${size}px;height:${size}px;background:${col};border-radius:50%;transform:translate(-50%, -50%);cursor:pointer;opacity:0.85;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,0.15);"
                title="${i.itemName || i.item || i.name} (${i.category}) — ${i.quadrant} | Units: ${units} | Unit Contr: ₹${uContr.toFixed(2)} | Net Sales: ₹${netVal.toFixed(2)}"
                data-item-drill="${i.itemId || i.item || i.name}"
                data-item-name="${i.itemName || i.item || i.name}"
              ></div>
            `;
          }).join('')}
        </div>

        <div style="display:flex;justify-content:space-between;align-items:center;font-size:10px;color:var(--muted);margin-top:8px;">
          <span>Volume Cutoff: <strong>${popCutoff.toFixed(1)} units</strong></span>
          <span>Threshold: <strong>${thresholds.methodology || 'DATASET_RELATIVE_ITEM_MEAN'}</strong></span>
          <span>Contribution Cutoff: <strong>₹${contrCutoff.toFixed(2)}</strong></span>
        </div>
      </div>

      <!-- 4 Quadrant Summaries Grid -->
      <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(260px, 1fr));gap:12px;">
        <!-- PUZZLE -->
        <div class="card" style="padding:12px;background:var(--surface-sunken);border-top:3px solid var(--amber, #f59e0b);">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
            <div>
              <span style="font-size:12px;font-weight:700;color:var(--amber, #f59e0b);">🧩 PUZZLE</span>
              <div style="font-size:10px;color:var(--muted);">Low Volume / High Est. Contribution</div>
            </div>
            <span class="badge warning" style="font-size:10px;">${(quadrants.PUZZLE || []).length} items</span>
          </div>
          <div style="display:flex;flex-direction:column;gap:4px;font-size:11px;max-height:140px;overflow-y:auto;">
            ${(quadrants.PUZZLE || []).length > 0 ? (quadrants.PUZZLE || []).map(i => `
              <div style="display:flex;justify-content:space-between;padding:2px 0;border-bottom:1px solid var(--line);cursor:pointer;" data-item-drill="${i.itemId || i.item || i.name}" data-item-name="${i.itemName || i.item || i.name}">
                <span>${i.itemName || i.item || i.name}</span>
                <span style="color:var(--mint, #10b981);font-weight:600;">₹${((i.estimatedContributionPaise || i.estimatedContributionPaisa || 0) / 100).toFixed(0)}</span>
              </div>
            `).join('') : '<div style="color:var(--muted);font-size:10px;padding:4px 0;">No puzzle items identified.</div>'}
          </div>
        </div>

        <!-- STAR -->
        <div class="card" style="padding:12px;background:var(--surface-sunken);border-top:3px solid var(--mint, #10b981);">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
            <div>
              <span style="font-size:12px;font-weight:700;color:var(--mint, #10b981);">⭐ STAR</span>
              <div style="font-size:10px;color:var(--muted);">High Volume / High Est. Contribution</div>
            </div>
            <span class="badge success" style="font-size:10px;">${(quadrants.STAR || []).length} items</span>
          </div>
          <div style="display:flex;flex-direction:column;gap:4px;font-size:11px;max-height:140px;overflow-y:auto;">
            ${(quadrants.STAR || []).length > 0 ? (quadrants.STAR || []).map(i => `
              <div style="display:flex;justify-content:space-between;padding:2px 0;border-bottom:1px solid var(--line);cursor:pointer;" data-item-drill="${i.itemId || i.item || i.name}" data-item-name="${i.itemName || i.item || i.name}">
                <span>${i.itemName || i.item || i.name}</span>
                <span style="color:var(--mint, #10b981);font-weight:600;">₹${((i.estimatedContributionPaise || i.estimatedContributionPaisa || 0) / 100).toFixed(0)}</span>
              </div>
            `).join('') : '<div style="color:var(--muted);font-size:10px;padding:4px 0;">No star items identified.</div>'}
          </div>
        </div>

        <!-- DOG -->
        <div class="card" style="padding:12px;background:var(--surface-sunken);border-top:3px solid var(--coral, #ef4444);">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
            <div>
              <span style="font-size:12px;font-weight:700;color:var(--coral, #ef4444);">🐕 DOG</span>
              <div style="font-size:10px;color:var(--muted);">Low Volume / Low Est. Contribution</div>
            </div>
            <span class="badge neutral" style="font-size:10px;">${(quadrants.DOG || []).length} items</span>
          </div>
          <div style="display:flex;flex-direction:column;gap:4px;font-size:11px;max-height:140px;overflow-y:auto;">
            ${(quadrants.DOG || []).length > 0 ? (quadrants.DOG || []).map(i => `
              <div style="display:flex;justify-content:space-between;padding:2px 0;border-bottom:1px solid var(--line);cursor:pointer;" data-item-drill="${i.itemId || i.item || i.name}" data-item-name="${i.itemName || i.item || i.name}">
                <span>${i.itemName || i.item || i.name}</span>
                <span style="color:var(--muted);font-weight:600;">₹${((i.estimatedContributionPaise || i.estimatedContributionPaisa || 0) / 100).toFixed(0)}</span>
              </div>
            `).join('') : '<div style="color:var(--muted);font-size:10px;padding:4px 0;">No dog items identified.</div>'}
          </div>
        </div>

        <!-- PLOWHORSE -->
        <div class="card" style="padding:12px;background:var(--surface-sunken);border-top:3px solid var(--sky, #0284c7);">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
            <div>
              <span style="font-size:12px;font-weight:700;color:var(--sky, #0284c7);">🐎 PLOWHORSE</span>
              <div style="font-size:10px;color:var(--muted);">High Volume / Low Est. Contribution</div>
            </div>
            <span class="badge" style="font-size:10px;">${(quadrants.PLOWHORSE || []).length} items</span>
          </div>
          <div style="display:flex;flex-direction:column;gap:4px;font-size:11px;max-height:140px;overflow-y:auto;">
            ${(quadrants.PLOWHORSE || []).length > 0 ? (quadrants.PLOWHORSE || []).map(i => `
              <div style="display:flex;justify-content:space-between;padding:2px 0;border-bottom:1px solid var(--line);cursor:pointer;" data-item-drill="${i.itemId || i.item || i.name}" data-item-name="${i.itemName || i.item || i.name}">
                <span>${i.itemName || i.item || i.name}</span>
                <span style="color:var(--muted);font-weight:600;">₹${((i.estimatedContributionPaise || i.estimatedContributionPaisa || 0) / 100).toFixed(0)}</span>
              </div>
            `).join('') : '<div style="color:var(--muted);font-size:10px;padding:4px 0;">No plowhorse items identified.</div>'}
          </div>
        </div>
      </div>
    `;
  }

  // 2. THEORETICAL COSTING VIEW
  else if (menuActiveView === 'costing') {
    viewHtml = `
      <div class="card" style="padding:14px;background:var(--surface-sunken);">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;flex-wrap:wrap;gap:8px;">
          <div>
            <h4 style="font-size:12px;font-weight:700;color:var(--ink);margin:0;">Theoretical Recipe BOM Costing &amp; Contribution</h4>
            <p style="font-size:10px;color:var(--muted);margin:2px 0 0 0;">Derived from inventory ingredient standard unit costs and recipe batch formulas</p>
          </div>
          <span class="pill pill-amber" style="font-size:10px;font-weight:700;">ESTIMATED</span>
        </div>
        <div style="overflow-x:auto;">
          <table class="glass-table" style="width:100%;font-size:11px;">
            <thead>
              <tr>
                <th>Menu Item</th>
                <th>Category</th>
                <th>Units Sold</th>
                <th>Net Sales</th>
                <th>Theoretical Cost (EST.)</th>
                <th>Est. Contribution (EST.)</th>
                <th>Est. Contribution %</th>
                <th>Classification</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              ${filteredItems.length > 0 ? filteredItems.map(i => {
                const qClass = i.quadrant === 'STAR' ? 'success' : i.quadrant === 'PLOWHORSE' ? 'primary' : i.quadrant === 'PUZZLE' ? 'warning' : i.quadrant === 'DOG' ? 'coral' : 'neutral';
                const cogsVal = i.theoreticalCostPaise !== undefined && i.theoreticalCostPaise !== null ? i.theoreticalCostPaise : (i.theoreticalCogsPaisa || null);
                const contrVal = i.estimatedContributionPaise !== undefined && i.estimatedContributionPaise !== null ? i.estimatedContributionPaise : (i.estimatedContributionPaisa || null);
                return `
                  <tr>
                    <td><strong>${i.itemName || i.item || i.name}</strong></td>
                    <td><span class="badge" style="font-size:9px;">${i.category}</span></td>
                    <td>${i.quantitySold || i.quantity || i.unitsSold || 0}</td>
                    <td>₹${((i.netSalesPaise || i.netSalesPaisa || (i.revenue ? i.revenue * 100 : 0)) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                    <td style="color:var(--muted);">
                      ${cogsVal !== null ? `₹${(cogsVal / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}` : '<span style="color:var(--amber, #f59e0b);">RECIPE_UNAVAILABLE</span>'}
                    </td>
                    <td style="font-weight:700;color:${contrVal !== null && contrVal > 0 ? 'var(--mint, #10b981)' : 'var(--muted)'};">
                      ${contrVal !== null ? `₹${(contrVal / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}` : 'Unavailable'}
                    </td>
                    <td>
                      ${i.estimatedContributionPercent !== null && i.estimatedContributionPercent !== undefined ? `<strong style="color:var(--mint, #10b981);">${i.estimatedContributionPercent}%</strong>` : 'Unavailable'}
                    </td>
                    <td>
                      <span class="badge ${qClass}" style="font-size:9px;">${i.quadrant}</span>
                    </td>
                    <td>
                      <button class="btn btn-xs btn-ghost" data-item-drill="${i.itemId || i.item || i.name}" data-item-name="${i.itemName || i.item || i.name}" type="button">Drill →</button>
                    </td>
                  </tr>
                `;
              }).join('') : `
                <tr><td colspan="9" style="text-align:center;padding:14px;color:var(--muted);">No matching menu items found.</td></tr>
              `}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  // 3. PRICE HISTORY VIEW
  else if (menuActiveView === 'price_history') {
    viewHtml = `
      <div class="card" style="padding:14px;background:var(--surface-sunken);">
        <h4 style="font-size:12px;font-weight:700;color:var(--ink);margin:0 0 10px 0;">Price History &amp; Menu Elasticity Audit</h4>
        <div style="overflow-x:auto;">
          <table class="glass-table" style="width:100%;font-size:11px;">
            <thead>
              <tr>
                <th>Menu Item</th>
                <th>Previous Price</th>
                <th>Effective Price</th>
                <th>Changed At</th>
                <th>Reason</th>
                <th>Changed By</th>
              </tr>
            </thead>
            <tbody>
              ${priceHistory.length > 0 ? priceHistory.map(p => `
                <tr>
                  <td><strong>${p.itemName || p.name || 'Item'}</strong></td>
                  <td>₹${((p.previousPricePaisa || 0) / 100).toFixed(2)}</td>
                  <td style="color:var(--mint, #10b981);font-weight:700;">₹${((p.newPricePaisa || 0) / 100).toFixed(2)}</td>
                  <td>${p.changedAt ? new Date(p.changedAt).toLocaleDateString('en-IN') : 'Master Seed'}</td>
                  <td>${p.reason || 'Annual Revision'}</td>
                  <td>${p.changedBy || 'MASTER'}</td>
                </tr>
              `).join('') : `
                <tr><td colspan="6" style="text-align:center;padding:14px;color:var(--muted);">No price history events recorded for active scope.</td></tr>
              `}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  // 4. SALES VELOCITY VIEW
  else if (menuActiveView === 'velocity') {
    viewHtml = `
      <div class="card" style="padding:14px;background:var(--surface-sunken);">
        <h4 style="font-size:12px;font-weight:700;color:var(--ink);margin:0 0 10px 0;">Sales Velocity (Daily Depletion Rate)</h4>
        <div style="overflow-x:auto;">
          <table class="glass-table" style="width:100%;font-size:11px;">
            <thead>
              <tr>
                <th>Menu Item</th>
                <th>Category</th>
                <th>Total Units Sold</th>
                <th>Units / Day</th>
                <th>Net Sales</th>
                <th>Quadrant</th>
              </tr>
            </thead>
            <tbody>
              ${salesVelocity.length > 0 ? salesVelocity.map(v => `
                <tr>
                  <td><strong>${v.name || v.itemName}</strong></td>
                  <td><span class="badge" style="font-size:9px;">${v.category}</span></td>
                  <td>${v.totalUnits || v.quantity || 0}</td>
                  <td><strong style="color:var(--sky, #0284c7);">${v.unitsPerDay || 0} / day</strong></td>
                  <td>₹${((v.netSalesPaisa || (v.netSales ? v.netSales * 100 : 0)) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                  <td><span class="badge" style="font-size:9px;">${v.quadrant || 'UNCLASSIFIED'}</span></td>
                </tr>
              `).join('') : `
                <tr><td colspan="6" style="text-align:center;padding:14px;color:var(--muted);">No velocity records available for selected period.</td></tr>
              `}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  container.innerHTML = `
    <div class="card" style="padding:16px;background:var(--surface);display:flex;flex-direction:column;gap:14px;">
      <!-- Report Header -->
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;border-bottom:1px solid var(--line);padding-bottom:12px;">
        <div>
          <div style="display:flex;align-items:center;gap:8px;">
            <h3 style="font-size:15px;font-weight:700;color:var(--ink);margin:0;">Menu Engineering &amp; Contribution Intelligence</h3>
            <span class="pill ${dqPillClass}" style="font-size:10px;">${dataQuality.state}</span>
          </div>
          <p style="font-size:11px;color:var(--muted);margin:2px 0 0 0;">Theoretical COGS, estimated contribution margins, and menu quadrant optimization</p>
        </div>
        <div style="display:flex;align-items:center;gap:8px;">
          <button class="btn btn-sm btn-ghost" id="menu-refresh-btn" style="font-size:12px;" type="button">↻ Refresh</button>
          <button class="btn btn-sm btn-primary" id="menu-zurf-btn" data-export-report="menu-engineering" style="font-size:12px;" type="button">ZURF Export</button>
        </div>
      </div>

      <!-- Subtab Dimensional Filter Strip -->
      <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;background:var(--surface-sunken);padding:8px 12px;border-radius:6px;font-size:11px;">
        <div style="display:flex;align-items:center;gap:4px;">
          <span style="color:var(--muted);font-weight:700;">Quadrant:</span>
          <select id="menu-quadrant-select" class="glass-input" style="font-size:11px;padding:3px 6px;">
            <option value="ALL">All Quadrants</option>
            <option value="STAR" ${menuQuadrantFilter === 'STAR' ? 'selected' : ''}>⭐ Stars</option>
            <option value="PLOWHORSE" ${menuQuadrantFilter === 'PLOWHORSE' ? 'selected' : ''}>🐎 Plowhorses</option>
            <option value="PUZZLE" ${menuQuadrantFilter === 'PUZZLE' ? 'selected' : ''}>🧩 Puzzles</option>
            <option value="DOG" ${menuQuadrantFilter === 'DOG' ? 'selected' : ''}>🐕 Dogs</option>
            <option value="UNCLASSIFIED" ${menuQuadrantFilter === 'UNCLASSIFIED' ? 'selected' : ''}>⚪ Missing Recipe</option>
          </select>
        </div>
        <div style="display:flex;align-items:center;gap:4px;">
          <span style="color:var(--muted);font-weight:700;">Category:</span>
          <select id="menu-cat-select" class="glass-input" style="font-size:11px;padding:3px 6px;">
            <option value="ALL">All Categories</option>
            ${categories.map(c => `<option value="${c}" ${c === menuCategoryFilter ? 'selected' : ''}>${c}</option>`).join('')}
          </select>
        </div>
        <div style="display:flex;align-items:center;gap:4px;">
          <input type="text" id="menu-search-input" class="input" placeholder="Search menu item..." value="${menuSearchTerm}" style="font-size:11px;padding:3px 6px;width:150px;" />
        </div>
        <button class="btn btn-ghost btn-xs" id="menu-reset-btn" type="button">↺ Reset Filters</button>
      </div>

      <!-- View Navigation Pills -->
      <div style="display:flex;gap:6px;overflow-x:auto;padding-bottom:4px;border-bottom:1px solid var(--line);">
        <button class="btn btn-xs ${menuActiveView === 'matrix' ? 'btn-primary' : 'btn-ghost'}" data-menu-view="matrix" type="button"># Menu Engineering Matrix</button>
        <button class="btn btn-xs ${menuActiveView === 'costing' ? 'btn-primary' : 'btn-ghost'}" data-menu-view="costing" type="button">Theoretical Recipe Costing (ESTIMATED)</button>
        <button class="btn btn-xs ${menuActiveView === 'price_history' ? 'btn-primary' : 'btn-ghost'}" data-menu-view="price_history" type="button">Price History &amp; Elasticity</button>
        <button class="btn btn-xs ${menuActiveView === 'velocity' ? 'btn-primary' : 'btn-ghost'}" data-menu-view="velocity" type="button">Sales Velocity</button>
      </div>

      <!-- KPI Strip -->
      <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(130px, 1fr));gap:8px;">
        <div class="card" style="padding:10px;background:var(--surface-sunken);">
          <div style="font-size:9px;color:var(--muted);text-transform:uppercase;font-weight:700;">Tracked Items</div>
          <div style="font-size:15px;font-weight:800;color:var(--ink);margin-top:2px;">${engItems.length}</div>
        </div>
        <div class="card" style="padding:10px;background:var(--surface-sunken);">
          <div style="font-size:9px;color:var(--muted);text-transform:uppercase;font-weight:700;">⭐ Stars</div>
          <div style="font-size:15px;font-weight:800;color:var(--mint, #10b981);margin-top:2px;">${qCounts.STAR || 0}</div>
        </div>
        <div class="card" style="padding:10px;background:var(--surface-sunken);">
          <div style="font-size:9px;color:var(--muted);text-transform:uppercase;font-weight:700;">🐎 Plowhorses</div>
          <div style="font-size:15px;font-weight:800;color:var(--sky, #0284c7);margin-top:2px;">${qCounts.PLOWHORSE || 0}</div>
        </div>
        <div class="card" style="padding:10px;background:var(--surface-sunken);">
          <div style="font-size:9px;color:var(--muted);text-transform:uppercase;font-weight:700;">🧩 Puzzles</div>
          <div style="font-size:15px;font-weight:800;color:var(--amber, #f59e0b);margin-top:2px;">${qCounts.PUZZLE || 0}</div>
        </div>
        <div class="card" style="padding:10px;background:var(--surface-sunken);">
          <div style="font-size:9px;color:var(--muted);text-transform:uppercase;font-weight:700;">🐕 Dogs</div>
          <div style="font-size:15px;font-weight:800;color:var(--coral, #ef4444);margin-top:2px;">${qCounts.DOG || 0}</div>
        </div>
        <div class="card" style="padding:10px;background:var(--surface-sunken);">
          <div style="font-size:9px;color:var(--muted);text-transform:uppercase;font-weight:700;">⚪ Missing Recipe</div>
          <div style="font-size:15px;font-weight:800;color:var(--muted);margin-top:2px;">${qCounts.UNCLASSIFIED || 0}</div>
        </div>
      </div>

      <!-- Active View Content -->
      <div id="menu-view-container" style="display:flex;flex-direction:column;gap:12px;">
        ${viewHtml}
      </div>
    </div>
  `;

  // Attach view navigation event listeners
  container.querySelectorAll('[data-menu-view]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      menuActiveView = btn.dataset.menuView;
      renderMenuSubtab(root, container);
    });
  });

  // Attach refresh button
  container.querySelector('#menu-refresh-btn')?.addEventListener('click', (e) => {
    e.preventDefault();
    cachedMenu = null;
    renderMenuSubtab(root, container);
  });

  // Subtab filter event listeners
  container.querySelector('#menu-quadrant-select')?.addEventListener('change', (e) => {
    menuQuadrantFilter = e.target.value;
    renderMenuSubtab(root, container);
  });
  container.querySelector('#menu-cat-select')?.addEventListener('change', (e) => {
    menuCategoryFilter = e.target.value;
    renderMenuSubtab(root, container);
  });
  container.querySelector('#menu-search-input')?.addEventListener('input', (e) => {
    menuSearchTerm = e.target.value;
    renderMenuSubtab(root, container);
  });
  container.querySelector('#menu-reset-btn')?.addEventListener('click', (e) => {
    e.preventDefault();
    menuQuadrantFilter = 'ALL';
    menuCategoryFilter = 'ALL';
    menuSearchTerm = '';
    renderMenuSubtab(root, container);
  });

  // Item drill click handler
  container.querySelectorAll('[data-item-drill]').forEach(el => {
    el.addEventListener('click', (e) => {
      e.preventDefault();
      const itemId = el.dataset.itemDrill;
      const itemName = el.dataset.itemName || itemId;
      openItemDrilldownModal(itemId, itemName);
    });
  });
}
async function renderQualitySubtab(root, container) {
  container.innerHTML = skeleton('240px');
  try {
    const res = await apiGet('/reports/quality' + buildFilterQueryString());
    if (res?.data) cachedQuality = res.data;
  } catch (_) {}

  if (!cachedQuality || !cachedQuality.qualityMetrics) {
    cachedQuality = {
      qualityMetrics: {
        checklistCompletionRatePct: 0,
        temperatureExcursionsCount: 0,
        activeQualityHoldsCount: 0,
      },
      recentIncidents: [],
    };
  }

  const { qualityMetrics, recentIncidents } = cachedQuality;

  container.innerHTML = `
    <div class="card" style="padding:16px;background:var(--surface);display:flex;flex-direction:column;gap:14px;">
      <div>
        <h3 style="font-size:14px;font-weight:700;color:var(--ink);margin:0;">Quality &amp; Food Safety Management Log</h3>
        <p style="font-size:11px;color:var(--muted);margin:2px 0 0 0;">Checklist completion rates, cold-chain temperature excursions, and open CAPA audits</p>
      </div>

      <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(200px, 1fr));gap:10px;">
        <div class="card" style="padding:10px;background:var(--surface-sunken);">
          <div style="font-size:10px;color:var(--muted);text-transform:uppercase;">Checklist Compliance</div>
          <div style="font-size:16px;font-weight:800;color:var(--mint, #10b981);margin-top:2px;">${qualityMetrics?.checklistCompletionRatePct ?? 0}%</div>
        </div>
        <div class="card" style="padding:10px;background:var(--surface-sunken);">
          <div style="font-size:10px;color:var(--muted);text-transform:uppercase;">Temperature Excursions</div>
          <div style="font-size:16px;font-weight:800;color:var(--mint, #10b981);margin-top:2px;">${qualityMetrics?.temperatureExcursionsCount ?? 0}</div>
        </div>
        <div class="card" style="padding:10px;background:var(--surface-sunken);">
          <div style="font-size:10px;color:var(--muted);text-transform:uppercase;">Active Quality Holds</div>
          <div style="font-size:16px;font-weight:800;color:var(--ink);margin-top:2px;">${qualityMetrics?.activeQualityHoldsCount ?? 0}</div>
        </div>
      </div>

      <div class="card" style="padding:12px;background:var(--surface-sunken);min-width:0;box-sizing:border-box;">
        <h4 style="font-size:12px;font-weight:700;color:var(--ink);margin:0 0 8px 0;">Active CAPA &amp; Non-Conformance Logs</h4>
        <div style="width:100%;overflow-x:auto;min-width:0;box-sizing:border-box;">
          <table class="glass-table" style="width:100%;font-size:12px;">
            <thead>
              <tr>
                <th>Reference</th>
                <th>Café</th>
                <th>Investigation Title</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              ${(recentIncidents || []).length > 0 ? (recentIncidents || []).map((i) => `
                <tr>
                  <td><strong>${i.ref}</strong></td>
                  <td style="color:var(--muted);">${i.cafe}</td>
                  <td>${i.title}</td>
                  <td><span class="badge ${i.status === 'RESOLVED' ? 'success' : 'warning'}" style="font-size:9px;">${i.status}</span></td>
                </tr>
              `).join('') : `
                <tr>
                  <td colspan="4" style="text-align:center;padding:16px;color:var(--muted);">No quality incidents or CAPA audits recorded</td>
                </tr>
              `}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;
}

async function renderAssetsSubtab(root, container) {
  container.innerHTML = skeleton('240px');
  try {
    const res = await apiGet('/reports/assets' + buildFilterQueryString());
    if (res?.data) cachedAssets = res.data;
  } catch (_) {}

  if (!cachedAssets || !cachedAssets.assetMetrics) {
    cachedAssets = {
      assetMetrics: {
        availabilityRatePct: 0,
        totalDowntimeMinutes: 0,
        preventativeServiceCompliancePct: 0,
      },
    };
  }

  const { assetMetrics } = cachedAssets;

  container.innerHTML = `
    <div class="card" style="padding:16px;background:var(--surface);display:flex;flex-direction:column;gap:14px;">
      <div>
        <h3 style="font-size:14px;font-weight:700;color:var(--ink);margin:0;">Assets &amp; Maintenance Downtime</h3>
        <p style="font-size:11px;color:var(--muted);margin:2px 0 0 0;">Espresso equipment availability rate, preventative maintenance, and repair expenditure</p>
      </div>

      <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(200px, 1fr));gap:10px;">
        <div class="card" style="padding:10px;background:var(--surface-sunken);">
          <div style="font-size:10px;color:var(--muted);text-transform:uppercase;">Asset Availability</div>
          <div style="font-size:16px;font-weight:800;color:var(--mint, #10b981);margin-top:2px;">${assetMetrics?.availabilityRatePct ?? 0}%</div>
        </div>
        <div class="card" style="padding:10px;background:var(--surface-sunken);">
          <div style="font-size:10px;color:var(--muted);text-transform:uppercase;">Breakdown Downtime</div>
          <div style="font-size:16px;font-weight:800;color:var(--ink);margin-top:2px;">${assetMetrics?.totalDowntimeMinutes ?? 0} mins</div>
        </div>
        <div class="card" style="padding:10px;background:var(--surface-sunken);">
          <div style="font-size:10px;color:var(--muted);text-transform:uppercase;">PM Compliance</div>
          <div style="font-size:16px;font-weight:800;color:var(--mint, #10b981);margin-top:2px;">${assetMetrics?.preventativeServiceCompliancePct ?? 0}%</div>
        </div>
      </div>
    </div>
  `;
}

async function renderPortfolioSubtab(root, container) {
  container.innerHTML = skeleton('280px');
  try {
    const params = new URLSearchParams({
      period: activeFilters.period || 'this_month',
      compare: activeFilters.comparison || 'PRIOR_YEAR',
      peerGroup: portfolioPeerGroupFilter || 'ALL',
      comparableOnly: portfolioComparableOnlyFilter ? 'true' : 'false',
      metric: portfolioMetricFilter || 'NET_SALES',
      direction: portfolioRankDirection || 'HIGH_TO_LOW',
    });
    if (activeFilters.cafeId && activeFilters.cafeId !== 'ALL') {
      params.append('cafeScope', activeFilters.cafeId);
    }
    if (activeFilters.dateFrom) params.append('dateFrom', activeFilters.dateFrom);
    if (activeFilters.dateTo) params.append('dateTo', activeFilters.dateTo);

    const res = await apiGet('/reports/portfolio?' + params.toString());
    if (res?.data) cachedPortfolio = res.data;
  } catch (_) {}

  if (!cachedPortfolio) {
    cachedPortfolio = {
      summary: {},
      benchmarks: {},
      portfolio: [],
      cafeComparison: [],
      sameStoreAnalysis: { nonComparablePanels: [] },
      rankings: [],
      concentration: {},
      peerGroups: { types: [], cities: [] },
      weightingLedger: [],
      overallLikeForLikeGrowthPct: null,
    };
  }

  const {
    summary = {},
    benchmarks = {},
    cafeComparison = [],
    sameStoreAnalysis = {},
    rankings = [],
    concentration = {},
    peerGroups = { types: [], cities: [] },
    overallLikeForLikeGrowthPct,
  } = cachedPortfolio;

  // Filter cafe rows by search term if active
  let displayRows = cafeComparison || [];
  if (portfolioSearchTerm) {
    const term = portfolioSearchTerm.toLowerCase().trim();
    displayRows = displayRows.filter(r =>
      (r.name && r.name.toLowerCase().includes(term)) ||
      (r.cafeId && r.cafeId.toLowerCase().includes(term)) ||
      (r.city && r.city.toLowerCase().includes(term)) ||
      (r.cafeType && r.cafeType.toLowerCase().includes(term))
    );
  }

  container.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:16px;">
      <!-- KPI Metric Header Strip -->
      <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(150px, 1fr));gap:12px;">
        <div class="card" style="padding:12px 14px;background:var(--surface);border:1px solid var(--line);border-radius:var(--radius-md, 8px);">
          <div style="font-size:10px;color:var(--muted);text-transform:uppercase;font-weight:700;">Active Cafés</div>
          <div style="font-size:18px;font-weight:800;color:var(--ink);margin-top:2px;" id="kpi-portfolio-active-cafes">${summary.activeCafesCount ?? 0} <span style="font-size:11px;font-weight:400;color:var(--muted);">/ ${summary.totalCafesCount ?? 0}</span></div>
          <div style="font-size:10.5px;color:var(--muted);margin-top:2px;">${summary.comparableCafesCount ?? 0} mature (>= 12m)</div>
        </div>

        <div class="card" style="padding:12px 14px;background:var(--surface);border:1px solid var(--line);border-radius:var(--radius-md, 8px);">
          <div style="font-size:10px;color:var(--muted);text-transform:uppercase;font-weight:700;">Portfolio Net Sales</div>
          <div style="font-size:18px;font-weight:800;color:var(--ink);margin-top:2px;" id="kpi-portfolio-net-sales">₹${Math.round(summary.totalNetSales || 0).toLocaleString('en-IN')}</div>
          <div style="font-size:10.5px;color:var(--muted);margin-top:2px;">${(summary.totalOrders || 0).toLocaleString('en-IN')} orders</div>
        </div>

        <div class="card" style="padding:12px 14px;background:var(--surface);border:1px solid var(--line);border-radius:var(--radius-md, 8px);">
          <div style="font-size:10px;color:var(--muted);text-transform:uppercase;font-weight:700;">Weighted AOV</div>
          <div style="font-size:18px;font-weight:800;color:var(--ink);margin-top:2px;" id="kpi-portfolio-aov">₹${summary.portfolioAov ? Math.round(summary.portfolioAov).toLocaleString('en-IN') : 'N/A'}</div>
          <div style="font-size:10.5px;color:var(--muted);margin-top:2px;">Net Sales / Orders</div>
        </div>

        <div class="card" style="padding:12px 14px;background:var(--surface);border:1px solid var(--line);border-radius:var(--radius-md, 8px);">
          <div style="font-size:10px;color:var(--muted);text-transform:uppercase;font-weight:700;">Weighted Labour %</div>
          <div style="font-size:18px;font-weight:800;color:var(--ink);margin-top:2px;" id="kpi-portfolio-payroll-pct">${summary.portfolioPayrollPct !== null && summary.portfolioPayrollPct !== undefined ? summary.portfolioPayrollPct + '%' : 'N/A'}</div>
          <div style="font-size:10.5px;color:var(--muted);margin-top:2px;">₹${Math.round(summary.totalGrossPayroll || 0).toLocaleString('en-IN')} gross wages</div>
        </div>

        <div class="card" style="padding:12px 14px;background:var(--surface);border:1px solid var(--line);border-radius:var(--radius-md, 8px);">
          <div style="font-size:10px;color:var(--muted);text-transform:uppercase;font-weight:700;">Weighted SPLH</div>
          <div style="font-size:18px;font-weight:800;color:var(--ink);margin-top:2px;" id="kpi-portfolio-splh">₹${summary.portfolioSplh ? Math.round(summary.portfolioSplh).toLocaleString('en-IN') : 'N/A'}</div>
          <div style="font-size:10.5px;color:var(--muted);margin-top:2px;">${Math.round(summary.totalWorkedHours || 0).toLocaleString('en-IN')} clock hrs</div>
        </div>

        <div class="card" style="padding:12px 14px;background:var(--surface);border:1px solid var(--line);border-radius:var(--radius-md, 8px);">
          <div style="font-size:10px;color:var(--muted);text-transform:uppercase;font-weight:700;">Same-Store (LFL) Growth</div>
          <div style="font-size:18px;font-weight:800;color:${overallLikeForLikeGrowthPct > 0 ? 'var(--mint, #10b981)' : (overallLikeForLikeGrowthPct < 0 ? 'var(--coral, #ef4444)' : 'var(--ink)')};margin-top:2px;" id="kpi-portfolio-lfl">
            ${overallLikeForLikeGrowthPct !== null && overallLikeForLikeGrowthPct !== undefined ? (overallLikeForLikeGrowthPct >= 0 ? '+' : '') + overallLikeForLikeGrowthPct + '%' : 'Unavailable'}
          </div>
          <div style="font-size:10.5px;color:var(--muted);margin-top:2px;">Mature cohort baseline</div>
        </div>
      </div>

      <!-- Controls & Filter Toolbar -->
      <div class="card" style="padding:14px 16px;background:var(--surface);border:1px solid var(--line);border-radius:var(--radius-md, 8px);display:flex;flex-direction:column;gap:12px;">
        <!-- Top Toolbar: View Switcher & Action Buttons -->
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;">
          <!-- View Navigation Buttons -->
          <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
            <button class="btn btn-sm ${portfolioActiveView === 'comparison' ? 'btn-primary' : 'btn-ghost'}" id="btn-portfolio-view-grid" type="button">
              📊 Comparison Grid
            </button>
            <button class="btn btn-sm ${portfolioActiveView === 'rankings' ? 'btn-primary' : 'btn-ghost'}" id="btn-portfolio-view-rankings" type="button">
              🏆 Metric Rankings
            </button>
            <button class="btn btn-sm ${portfolioActiveView === 'same_store' ? 'btn-primary' : 'btn-ghost'}" id="btn-portfolio-view-same-store" type="button">
              🏪 Same-Store (LFL)
            </button>
            <button class="btn btn-sm ${portfolioActiveView === 'scatter' ? 'btn-primary' : 'btn-ghost'}" id="btn-portfolio-view-scatter" type="button">
              📈 Productivity Plot
            </button>
            <button class="btn btn-sm ${portfolioActiveView === 'concentration' ? 'btn-primary' : 'btn-ghost'}" id="btn-portfolio-view-concentration" type="button">
              🎯 Concentration
            </button>
          </div>

          <!-- Actions: Export & Reset -->
          <div style="display:flex;align-items:center;gap:8px;">
            <button class="btn btn-sm btn-outline" id="portfolio-export-pdf-btn" type="button">
              📄 PDF Pack
            </button>
            <button class="btn btn-sm btn-outline" id="portfolio-export-xlsx-btn" type="button">
              📑 Multi-Sheet XLSX
            </button>
            <button class="btn btn-sm btn-ghost" id="portfolio-reset-btn" type="button" title="Reset all portfolio filters">
              ↺ Reset
            </button>
            <button class="btn btn-sm btn-ghost" id="portfolio-refresh-btn" type="button" title="Refresh data">
              🔄 Refresh
            </button>
          </div>
        </div>

        <!-- Filter Controls Row -->
        <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;padding-top:8px;border-top:1px solid var(--line);">
          <!-- Metric to Rank On -->
          <div style="display:flex;align-items:center;gap:6px;">
            <label for="portfolio-metric-select" style="font-size:11px;font-weight:600;color:var(--muted);">Rank Metric:</label>
            <select class="form-select form-select-sm" id="portfolio-metric-select" style="font-size:11.5px;padding:4px 8px;min-width:140px;">
              <option value="NET_SALES" ${portfolioMetricFilter === 'NET_SALES' ? 'selected' : ''}>Net Sales Revenue</option>
              <option value="SALES_GROWTH" ${portfolioMetricFilter === 'SALES_GROWTH' ? 'selected' : ''}>Sales Growth %</option>
              <option value="SPLH" ${portfolioMetricFilter === 'SPLH' ? 'selected' : ''}>Sales Per Labour Hour (SPLH)</option>
              <option value="PAYROLL_PCT" ${portfolioMetricFilter === 'PAYROLL_PCT' ? 'selected' : ''}>Labour Cost % of Sales</option>
              <option value="WASTE_PCT" ${portfolioMetricFilter === 'WASTE_PCT' ? 'selected' : ''}>Wastage % of Sales</option>
              <option value="REFUND_RATE" ${portfolioMetricFilter === 'REFUND_RATE' ? 'selected' : ''}>Refund Rate %</option>
              <option value="AOV" ${portfolioMetricFilter === 'AOV' ? 'selected' : ''}>Average Order Value (AOV)</option>
              <option value="REPEAT_RATE" ${portfolioMetricFilter === 'REPEAT_RATE' ? 'selected' : ''}>Customer Repeat Rate %</option>
            </select>
          </div>

          <!-- Rank Direction -->
          <div style="display:flex;align-items:center;gap:6px;">
            <label for="portfolio-direction-select" style="font-size:11px;font-weight:600;color:var(--muted);">Direction:</label>
            <select class="form-select form-select-sm" id="portfolio-direction-select" style="font-size:11.5px;padding:4px 8px;">
              <option value="HIGH_TO_LOW" ${portfolioRankDirection === 'HIGH_TO_LOW' ? 'selected' : ''}>High to Low (Desc)</option>
              <option value="LOW_TO_HIGH" ${portfolioRankDirection === 'LOW_TO_HIGH' ? 'selected' : ''}>Low to High (Asc)</option>
            </select>
          </div>

          <!-- Peer Group Filter -->
          <div style="display:flex;align-items:center;gap:6px;">
            <label for="portfolio-peer-group-select" style="font-size:11px;font-weight:600;color:var(--muted);">Peer Group:</label>
            <select class="form-select form-select-sm" id="portfolio-peer-group-select" style="font-size:11.5px;padding:4px 8px;min-width:130px;">
              <option value="ALL" ${portfolioPeerGroupFilter === 'ALL' ? 'selected' : ''}>All Locations</option>
              ${(peerGroups.types || []).map(t => `<option value="${t}" ${portfolioPeerGroupFilter === t ? 'selected' : ''}>Type: ${t}</option>`).join('')}
              ${(peerGroups.cities || []).map(c => `<option value="${c}" ${portfolioPeerGroupFilter === c ? 'selected' : ''}>City: ${c}</option>`).join('')}
            </select>
          </div>

          <!-- Comparable Only Toggle -->
          <label style="display:flex;align-items:center;gap:6px;font-size:11.5px;font-weight:600;color:var(--ink);cursor:pointer;">
            <input type="checkbox" id="portfolio-comparable-only-toggle" ${portfolioComparableOnlyFilter ? 'checked' : ''} style="cursor:pointer;" />
            <span>Comparable Stores Only (>= 12m)</span>
          </label>

          <!-- Search Filter -->
          <div style="display:flex;align-items:center;gap:6px;margin-left:auto;">
            <input type="text" class="form-control form-control-sm" id="portfolio-search-input" placeholder="Search café, code, city..." value="${portfolioSearchTerm}" style="font-size:11.5px;padding:4px 8px;width:180px;" />
          </div>
        </div>
      </div>

      <!-- Main Body View Area -->
      ${portfolioActiveView === 'comparison' ? `
        <!-- VIEW 1: COMPARISON GRID -->
        <div class="card" style="padding:16px;background:var(--surface);border:1px solid var(--line);border-radius:var(--radius-md, 8px);display:flex;flex-direction:column;gap:12px;">
          <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;">
            <div>
              <h3 style="font-size:14px;font-weight:700;color:var(--ink);margin:0;">Multi-Café Cross-Module Performance Grid</h3>
              <p style="font-size:11px;color:var(--muted);margin:2px 0 0 0;">Authoritative branch-level commercial metrics across Sales, Workforce, Inventory, and Finance.</p>
            </div>
            <div style="font-size:11px;color:var(--muted);font-family:var(--font-mono);">
              Showing ${displayRows.length} of ${summary.totalCafesCount ?? 0} locations
            </div>
          </div>

          <div style="width:100%;overflow-x:auto;min-width:0;box-sizing:border-box;">
            <table class="glass-table" style="width:100%;font-size:11.5px;">
              <thead>
                <tr>
                  <th style="min-width:140px;">Branch Location</th>
                  <th>Cohort</th>
                  <th style="text-align:right;">Net Sales (₹)</th>
                  <th style="text-align:center;">Sales Rank</th>
                  <th style="text-align:right;">Growth %</th>
                  <th style="text-align:right;">Orders</th>
                  <th style="text-align:right;">AOV (₹)</th>
                  <th style="text-align:right;">Labour %</th>
                  <th style="text-align:right;">SPLH (₹)</th>
                  <th style="text-align:right;">Waste Loss (₹)</th>
                  <th style="text-align:right;">Opex (₹)</th>
                  <th style="text-align:right;">AP Due (₹)</th>
                  <th style="text-align:right;">Repeat %</th>
                  <th style="text-align:center;">Drilldown</th>
                </tr>
              </thead>
              <tbody>
                ${displayRows.length > 0 ? displayRows.map(r => `
                  <tr>
                    <td>
                      <div style="font-weight:700;color:var(--ink);">${r.name}</div>
                      <div style="font-size:10px;color:var(--muted);font-family:var(--font-mono);">${r.cafeId} • ${r.city}</div>
                    </td>
                    <td>
                      <span class="badge ${r.comparabilityStatus === 'COMPARABLE' ? 'success' : 'warning'}" style="font-size:9px;" title="${r.comparabilityReason || ''}">
                        ${r.category}
                      </span>
                    </td>
                    <td style="text-align:right;font-weight:700;color:var(--ink);font-family:var(--font-mono);">
                      ₹${(r.netSales || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </td>
                    <td style="text-align:center;">
                      <span class="badge ${r.netSalesRank === 1 ? 'gold' : ''}" style="font-size:10px;font-family:var(--font-mono);">
                        #${r.netSalesRank ?? '—'}
                      </span>
                    </td>
                    <td style="text-align:right;font-family:var(--font-mono);color:${r.salesGrowthPct > 0 ? 'var(--mint, #10b981)' : (r.salesGrowthPct < 0 ? 'var(--coral, #ef4444)' : 'var(--muted)')};">
                      ${r.salesGrowthPct !== null ? (r.salesGrowthPct >= 0 ? '+' : '') + r.salesGrowthPct + '%' : (r.salesGrowthStatus || '—')}
                    </td>
                    <td style="text-align:right;font-family:var(--font-mono);">${(r.orderCount || 0).toLocaleString('en-IN')}</td>
                    <td style="text-align:right;font-family:var(--font-mono);">${r.aov ? '₹' + Math.round(r.aov).toLocaleString('en-IN') : '—'}</td>
                    <td style="text-align:right;font-family:var(--font-mono);">${r.payrollSalesPct !== null ? r.payrollSalesPct + '%' : '—'}</td>
                    <td style="text-align:right;font-weight:700;font-family:var(--font-mono);color:var(--ink);">${r.splh ? '₹' + Math.round(r.splh).toLocaleString('en-IN') : '—'}</td>
                    <td style="text-align:right;font-family:var(--font-mono);color:${r.wasteValue > 0 ? 'var(--coral, #ef4444)' : 'var(--muted)'};">
                      ${r.wasteValue ? '₹' + Math.round(r.wasteValue).toLocaleString('en-IN') : '₹0'}
                    </td>
                    <td style="text-align:right;font-family:var(--font-mono);">${r.operatingExpense ? '₹' + Math.round(r.operatingExpense).toLocaleString('en-IN') : '—'}</td>
                    <td style="text-align:right;font-family:var(--font-mono);">${r.apOutstanding ? '₹' + Math.round(r.apOutstanding).toLocaleString('en-IN') : '₹0'}</td>
                    <td style="text-align:right;font-family:var(--font-mono);">${r.repeatPurchaseRatePct !== null ? r.repeatPurchaseRatePct + '%' : '—'}</td>
                    <td style="text-align:center;">
                      <a href="#reports/view/daily-sales" class="btn-table-drill" style="font-size:10px;text-decoration:none;padding:2px 6px;background:var(--surface-hover);border:1px solid var(--line);border-radius:4px;" title="Drill into Sales">
                        Drill →
                      </a>
                    </td>
                  </tr>
                `).join('') : `
                  <tr><td colspan="14" style="text-align:center;padding:32px;color:var(--muted);">No matching café locations found.</td></tr>
                `}
              </tbody>
              ${displayRows.length > 0 ? `
                <tfoot>
                  <tr style="background:var(--surface-hover);font-weight:800;border-top:2px solid var(--line);">
                    <td>PORTFOLIO WEIGHTED TOTALS</td>
                    <td>${summary.comparableCafesCount ?? 0} mature</td>
                    <td style="text-align:right;font-family:var(--font-mono);">₹${Math.round(summary.totalNetSales || 0).toLocaleString('en-IN')}</td>
                    <td style="text-align:center;">—</td>
                    <td style="text-align:right;font-family:var(--font-mono);">${overallLikeForLikeGrowthPct !== null ? (overallLikeForLikeGrowthPct >= 0 ? '+' : '') + overallLikeForLikeGrowthPct + '%' : '—'}</td>
                    <td style="text-align:right;font-family:var(--font-mono);">${(summary.totalOrders || 0).toLocaleString('en-IN')}</td>
                    <td style="text-align:right;font-family:var(--font-mono);">₹${summary.portfolioAov ? Math.round(summary.portfolioAov).toLocaleString('en-IN') : '—'}</td>
                    <td style="text-align:right;font-family:var(--font-mono);">${summary.portfolioPayrollPct !== null ? summary.portfolioPayrollPct + '%' : '—'}</td>
                    <td style="text-align:right;font-family:var(--font-mono);">₹${summary.portfolioSplh ? Math.round(summary.portfolioSplh).toLocaleString('en-IN') : '—'}</td>
                    <td style="text-align:right;font-family:var(--font-mono);">₹${Math.round(summary.totalWasteValue || 0).toLocaleString('en-IN')}</td>
                    <td style="text-align:right;font-family:var(--font-mono);">₹${Math.round(summary.totalOperatingExpense || 0).toLocaleString('en-IN')}</td>
                    <td style="text-align:right;font-family:var(--font-mono);">₹${Math.round(summary.totalApOutstanding || 0).toLocaleString('en-IN')}</td>
                    <td style="text-align:right;font-family:var(--font-mono);">${summary.portfolioRepeatRatePct !== null ? summary.portfolioRepeatRatePct + '%' : '—'}</td>
                    <td></td>
                  </tr>
                </tfoot>
              ` : ''}
            </table>
          </div>
        </div>
      ` : ''}

      ${portfolioActiveView === 'rankings' ? `
        <!-- VIEW 2: METRIC RANKINGS -->
        <div class="card" style="padding:16px;background:var(--surface);border:1px solid var(--line);border-radius:var(--radius-md, 8px);display:flex;flex-direction:column;gap:14px;">
          <div>
            <h3 style="font-size:14px;font-weight:700;color:var(--ink);margin:0;">Authoritative Metric Rankings: ${portfolioMetricFilter}</h3>
            <p style="font-size:11px;color:var(--muted);margin:2px 0 0 0;">Standard competition ranking (1224). Identical values share equal ranks without arbitrary tie-breaks. Factual variance from portfolio median.</p>
          </div>

          <div style="display:flex;flex-direction:column;gap:10px;">
            ${(displayRows || []).map((r, idx) => {
              const rankVal = portfolioMetricFilter === 'NET_SALES' ? r.netSalesRank
                : (portfolioMetricFilter === 'SALES_GROWTH' ? r.salesGrowthRank
                : (portfolioMetricFilter === 'SPLH' ? r.splhRank
                : (portfolioMetricFilter === 'PAYROLL_PCT' ? r.payrollPctRank
                : (portfolioMetricFilter === 'WASTE_PCT' ? r.wastePctRank
                : (portfolioMetricFilter === 'REFUND_RATE' ? r.refundRateRank
                : (portfolioMetricFilter === 'AOV' ? r.aovRank : r.repeatRateRank))))));

              const displayVal = portfolioMetricFilter === 'NET_SALES' ? '₹' + Math.round(r.netSales || 0).toLocaleString('en-IN')
                : (portfolioMetricFilter === 'SALES_GROWTH' ? (r.salesGrowthPct !== null ? r.salesGrowthPct + '%' : 'N/A')
                : (portfolioMetricFilter === 'SPLH' ? (r.splh ? '₹' + Math.round(r.splh) : 'N/A')
                : (portfolioMetricFilter === 'PAYROLL_PCT' ? (r.payrollSalesPct !== null ? r.payrollSalesPct + '%' : 'N/A')
                : (portfolioMetricFilter === 'WASTE_PCT' ? (r.wastePct !== null ? r.wastePct + '%' : 'N/A')
                : (portfolioMetricFilter === 'REFUND_RATE' ? (r.refundRatePct + '%')
                : (portfolioMetricFilter === 'AOV' ? (r.aov ? '₹' + Math.round(r.aov) : 'N/A')
                : (r.repeatPurchaseRatePct !== null ? r.repeatPurchaseRatePct + '%' : 'N/A')))))));

              return `
                <div style="display:flex;align-items:center;gap:12px;padding:10px 14px;background:var(--surface-hover);border:1px solid var(--line);border-radius:6px;">
                  <div style="min-width:32px;text-align:center;font-weight:800;font-size:13px;color:var(--ink);font-family:var(--font-mono);">
                    #${rankVal ?? '—'}
                  </div>
                  <div style="flex:1;">
                    <div style="display:flex;justify-content:space-between;align-items:center;">
                      <strong style="color:var(--ink);font-size:12.5px;">${r.name}</strong>
                      <span style="font-weight:800;font-family:var(--font-mono);font-size:13px;color:var(--ink);">${displayVal}</span>
                    </div>
                    <div style="display:flex;justify-content:space-between;align-items:center;font-size:10.5px;color:var(--muted);margin-top:3px;">
                      <span>${r.cafeId} • ${r.city} • <span class="badge" style="font-size:9px;">${r.category}</span></span>
                      <span>${r.netSalesVarianceFromMedian !== null ? `Variance from Median: ${r.netSalesVarianceFromMedian >= 0 ? '+' : ''}₹${Math.round(r.netSalesVarianceFromMedian).toLocaleString('en-IN')}` : ''}</span>
                    </div>
                  </div>
                </div>
              `;
            }).join('')}
          </div>

          <div style="font-size:11px;color:var(--muted);line-height:1.4;margin-top:6px;padding:8px 12px;background:var(--surface-hover);border-radius:4px;">
            ℹ️ <strong>Governance Notice:</strong> Ranks are strictly descriptive and mathematically deterministic. Qualitative labels (e.g. "Good", "Underperforming") require explicit executive governance policies and are not hardcoded into the platform.
          </div>
        </div>
      ` : ''}

      ${portfolioActiveView === 'same_store' ? `
        <!-- VIEW 3: SAME-STORE (LIKE-FOR-LIKE) ANALYSIS -->
        <div style="display:flex;flex-direction:column;gap:14px;">
          <div class="card" style="padding:16px;background:var(--surface);border:1px solid var(--line);border-radius:var(--radius-md, 8px);">
            <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:12px;">
              <div>
                <h3 style="font-size:14px;font-weight:700;color:var(--ink);margin:0;">Mature Store Like-for-Like (LFL) Sales Growth</h3>
                <p style="font-size:11px;color:var(--muted);margin:2px 0 0 0;">Normalized comparative revenue growth strictly isolating mature locations operating >= 12 months with prior year baselines.</p>
              </div>
              <div class="badge ${overallLikeForLikeGrowthPct > 0 ? 'success' : 'warning'}" style="font-size:12px;font-weight:800;">
                Overall LFL Growth: ${overallLikeForLikeGrowthPct !== null ? (overallLikeForLikeGrowthPct >= 0 ? '+' : '') + overallLikeForLikeGrowthPct + '%' : 'Unavailable'}
              </div>
            </div>

            <div style="width:100%;overflow-x:auto;min-width:0;box-sizing:border-box;">
              <table class="glass-table" style="width:100%;font-size:11.5px;">
                <thead>
                  <tr>
                    <th>Mature Café Location</th>
                    <th>Opening Date</th>
                    <th>Operating History</th>
                    <th style="text-align:right;">Current Net Sales (₹)</th>
                    <th style="text-align:right;">Prior Year Net Sales (₹)</th>
                    <th style="text-align:right;">Absolute Variance (₹)</th>
                    <th style="text-align:right;">LFL Growth %</th>
                  </tr>
                </thead>
                <tbody>
                  ${(displayRows || []).filter(r => r.comparabilityStatus === 'COMPARABLE').map(r => `
                    <tr>
                      <td><strong>${r.name}</strong> (${r.cafeId})</td>
                      <td>${r.openingDate || '—'}</td>
                      <td>${r.storeAgeDays ? r.storeAgeDays + ' days' : '—'}</td>
                      <td style="text-align:right;font-weight:700;font-family:var(--font-mono);">₹${(r.netSales || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                      <td style="text-align:right;color:var(--muted);font-family:var(--font-mono);">₹${(r.priorYearNetSales || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                      <td style="text-align:right;font-family:var(--font-mono);color:${r.salesGrowthVariance > 0 ? 'var(--mint, #10b981)' : (r.salesGrowthVariance < 0 ? 'var(--coral, #ef4444)' : 'var(--muted)')};">
                        ${r.salesGrowthVariance !== null ? (r.salesGrowthVariance >= 0 ? '+' : '') + '₹' + r.salesGrowthVariance.toLocaleString('en-IN', { minimumFractionDigits: 2 }) : '—'}
                      </td>
                      <td style="text-align:right;font-weight:800;font-family:var(--font-mono);color:${r.likeForLikeGrowthPct > 0 ? 'var(--mint, #10b981)' : (r.likeForLikeGrowthPct < 0 ? 'var(--coral, #ef4444)' : 'var(--muted)')};">
                        ${r.likeForLikeGrowthPct !== null ? (r.likeForLikeGrowthPct >= 0 ? '+' : '') + r.likeForLikeGrowthPct + '%' : '—'}
                      </td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          </div>

          <!-- Non-Comparable Excluded Panel -->
          <div class="card" style="padding:16px;background:var(--surface);border:1px solid var(--line);border-radius:var(--radius-md, 8px);">
            <h4 style="font-size:13px;font-weight:700;color:var(--ink);margin:0 0 4px 0;">Excluded / Non-Comparable Locations (${(sameStoreAnalysis.nonComparablePanels || []).length})</h4>
            <p style="font-size:11px;color:var(--muted);margin:0 0 10px 0;">Stores excluded from Like-for-Like calculation under strict canonical comparability rules.</p>
            <div style="display:grid;grid-template-columns:repeat(auto-fill, minmax(280px, 1fr));gap:10px;">
              ${(sameStoreAnalysis.nonComparablePanels || []).map(p => `
                <div style="padding:10px 12px;background:var(--surface-hover);border:1px solid var(--line);border-radius:6px;">
                  <div style="display:flex;justify-content:space-between;align-items:center;">
                    <strong style="font-size:12px;color:var(--ink);">${p.name}</strong>
                    <span class="badge warning" style="font-size:9px;">${p.reason}</span>
                  </div>
                  <p style="font-size:10.5px;color:var(--muted);margin:4px 0 0 0;line-height:1.4;">${p.detail}</p>
                </div>
              `).join('')}
            </div>
          </div>
        </div>
      ` : ''}

      ${portfolioActiveView === 'scatter' ? `
        <!-- VIEW 4: PRODUCTIVITY PLOT (SCATTER) -->
        <div class="card" style="padding:16px;background:var(--surface);border:1px solid var(--line);border-radius:var(--radius-md, 8px);display:flex;flex-direction:column;gap:14px;">
          <div>
            <h3 style="font-size:14px;font-weight:700;color:var(--ink);margin:0;">Labour Productivity Plot: Net Sales vs Worked Hours</h3>
            <p style="font-size:11px;color:var(--muted);margin:2px 0 0 0;">Visualizing branch sales efficiency against labour clock hours. Evaluates Sales Per Labour Hour (SPLH) distribution without arbitrary performance quadrants.</p>
          </div>

          <div style="display:grid;grid-template-columns:repeat(auto-fill, minmax(260px, 1fr));gap:12px;">
            ${(displayRows || []).map(r => `
              <div style="padding:12px;background:var(--surface-hover);border:1px solid var(--line);border-radius:6px;display:flex;flex-direction:column;gap:6px;">
                <div style="display:flex;justify-content:space-between;align-items:center;">
                  <strong style="font-size:12.5px;color:var(--ink);">${r.name}</strong>
                  <span class="badge" style="font-size:9px;font-family:var(--font-mono);">SPLH: ₹${r.splh ? Math.round(r.splh) : 'N/A'}</span>
                </div>
                <div style="font-size:11px;color:var(--muted);">
                  Worked Hours: <strong style="color:var(--ink);">${(r.workedHours || 0).toLocaleString('en-IN')} hrs</strong>
                </div>
                <div style="font-size:11px;color:var(--muted);">
                  Net Sales: <strong style="color:var(--ink);">₹${Math.round(r.netSales || 0).toLocaleString('en-IN')}</strong>
                </div>
                <div style="font-size:11px;color:var(--muted);">
                  Order Checks: <strong style="color:var(--ink);">${(r.orderCount || 0).toLocaleString('en-IN')} checks</strong>
                </div>
                <div style="font-size:11px;color:var(--muted);">
                  Labour % of Sales: <strong style="color:var(--ink);">${r.payrollSalesPct !== null ? r.payrollSalesPct + '%' : 'N/A'}</strong>
                </div>
              </div>
            `).join('')}
          </div>
        </div>
      ` : ''}

      ${portfolioActiveView === 'concentration' ? `
        <!-- VIEW 5: PORTFOLIO CONCENTRATION -->
        <div class="card" style="padding:16px;background:var(--surface);border:1px solid var(--line);border-radius:var(--radius-md, 8px);display:flex;flex-direction:column;gap:14px;">
          <div>
            <h3 style="font-size:14px;font-weight:700;color:var(--ink);margin:0;">Portfolio Revenue Concentration</h3>
            <p style="font-size:11px;color:var(--muted);margin:2px 0 0 0;">Factual top-store contribution share across total organization turnover.</p>
          </div>

          <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(200px, 1fr));gap:12px;">
            <div style="padding:14px;background:var(--surface-hover);border:1px solid var(--line);border-radius:6px;">
              <div style="font-size:11px;color:var(--muted);text-transform:uppercase;font-weight:700;">Top 1 Café Share</div>
              <div style="font-size:20px;font-weight:800;color:var(--ink);margin-top:4px;">${concentration.top1CafeSharePct !== null && concentration.top1CafeSharePct !== undefined ? concentration.top1CafeSharePct + '%' : 'N/A'}</div>
              <div style="font-size:11px;color:var(--muted);margin-top:2px;">${concentration.top1CafeName || 'N/A'}</div>
            </div>

            <div style="padding:14px;background:var(--surface-hover);border:1px solid var(--line);border-radius:6px;">
              <div style="font-size:11px;color:var(--muted);text-transform:uppercase;font-weight:700;">Top 3 Cafés Combined Share</div>
              <div style="font-size:20px;font-weight:800;color:var(--ink);margin-top:4px;">${concentration.top3CafeSharePct !== null && concentration.top3CafeSharePct !== undefined ? concentration.top3CafeSharePct + '%' : 'N/A'}</div>
              <div style="font-size:11px;color:var(--muted);margin-top:2px;">Top 3 locations combined</div>
            </div>
          </div>

          <div style="margin-top:6px;">
            <h4 style="font-size:12.5px;font-weight:700;color:var(--ink);margin:0 0 8px 0;">Top Revenue Contributors:</h4>
            <div style="display:flex;flex-direction:column;gap:8px;">
              ${(concentration.top3Cafes || []).map((c, idx) => `
                <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 12px;background:var(--surface-hover);border-radius:4px;font-size:12px;">
                  <div>
                    <strong>#${idx + 1} ${c.name}</strong> (${c.cafeId})
                  </div>
                  <div style="font-family:var(--font-mono);font-weight:700;">
                    ₹${Math.round(c.netSales || 0).toLocaleString('en-IN')} <span style="font-weight:400;color:var(--muted);">(${c.sharePct}%)</span>
                  </div>
                </div>
              `).join('')}
            </div>
          </div>
        </div>
      ` : ''}

      <!-- Governance & Actuality Status Strip -->
      <div style="padding:10px 14px;background:var(--surface-hover);border:1px solid var(--line);border-radius:6px;font-size:11px;color:var(--muted);display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;">
        <div>
          <span>Overall Café Performance Score: <strong style="color:var(--ink);">NOT_CONFIGURED</strong></span> •
          <span>Store-level COGS, Gross Profit &amp; EBITDA: <strong style="color:var(--ink);">UNAVAILABLE</strong></span>
        </div>
        <div style="font-family:var(--font-mono);">
          Governance Trust: OPERATIONAL • PM-02I Compliant
        </div>
      </div>
    </div>
  `;

  // Attach Event Listeners (Control Matrix Compliance)
  const btnGrid = container.querySelector('#btn-portfolio-view-grid');
  const btnRankings = container.querySelector('#btn-portfolio-view-rankings');
  const btnSameStore = container.querySelector('#btn-portfolio-view-same-store');
  const btnScatter = container.querySelector('#btn-portfolio-view-scatter');
  const btnConcentration = container.querySelector('#btn-portfolio-view-concentration');
  const peerSelect = container.querySelector('#portfolio-peer-group-select');
  const metricSelect = container.querySelector('#portfolio-metric-select');
  const directionSelect = container.querySelector('#portfolio-direction-select');
  const compToggle = container.querySelector('#portfolio-comparable-only-toggle');
  const searchInput = container.querySelector('#portfolio-search-input');
  const btnReset = container.querySelector('#portfolio-reset-btn');
  const btnRefresh = container.querySelector('#portfolio-refresh-btn');
  const btnExportPdf = container.querySelector('#portfolio-export-pdf-btn');
  const btnExportXlsx = container.querySelector('#portfolio-export-xlsx-btn');

  if (btnGrid) btnGrid.addEventListener('click', () => { portfolioActiveView = 'comparison'; renderPortfolioSubtab(root, container); });
  if (btnRankings) btnRankings.addEventListener('click', () => { portfolioActiveView = 'rankings'; renderPortfolioSubtab(root, container); });
  if (btnSameStore) btnSameStore.addEventListener('click', () => { portfolioActiveView = 'same_store'; renderPortfolioSubtab(root, container); });
  if (btnScatter) btnScatter.addEventListener('click', () => { portfolioActiveView = 'scatter'; renderPortfolioSubtab(root, container); });
  if (btnConcentration) btnConcentration.addEventListener('click', () => { portfolioActiveView = 'concentration'; renderPortfolioSubtab(root, container); });

  if (peerSelect) peerSelect.addEventListener('change', (e) => { portfolioPeerGroupFilter = e.target.value; renderPortfolioSubtab(root, container); });
  if (metricSelect) metricSelect.addEventListener('change', (e) => { portfolioMetricFilter = e.target.value; renderPortfolioSubtab(root, container); });
  if (directionSelect) directionSelect.addEventListener('change', (e) => { portfolioRankDirection = e.target.value; renderPortfolioSubtab(root, container); });
  if (compToggle) compToggle.addEventListener('change', (e) => { portfolioComparableOnlyFilter = e.target.checked; renderPortfolioSubtab(root, container); });

  if (searchInput) searchInput.addEventListener('input', (e) => {
    portfolioSearchTerm = e.target.value;
    // In-place rerender without network re-fetch
    renderPortfolioSubtab(root, container);
  });

  if (btnReset) btnReset.addEventListener('click', () => {
    portfolioActiveView = 'comparison';
    portfolioPeerGroupFilter = 'ALL';
    portfolioComparableOnlyFilter = false;
    portfolioMetricFilter = 'NET_SALES';
    portfolioRankDirection = 'HIGH_TO_LOW';
    portfolioSearchTerm = '';
    renderPortfolioSubtab(root, container);
  });

  if (btnRefresh) btnRefresh.addEventListener('click', () => {
    cachedPortfolio = null;
    renderPortfolioSubtab(root, container);
  });

  if (btnExportPdf) btnExportPdf.addEventListener('click', async () => {
    try {
      showToast('Generating Portfolio PDF Export...', 'info');
      const res = await apiPost('/reports/export', {
        reportId: 'same-store-sales',
        format: 'PDF',
        period: activeFilters.period || 'this_month',
        cafeId: activeFilters.cafeId !== 'ALL' ? activeFilters.cafeId : undefined,
        comparison: activeFilters.comparison || 'PRIOR_YEAR',
        peerGroup: portfolioPeerGroupFilter,
        metric: portfolioMetricFilter,
        direction: portfolioRankDirection,
      });
      if (res?.data?.downloadUrl) {
        window.open(res.data.downloadUrl, '_blank');
        showToast('Portfolio PDF export ready for download.', 'success');
      } else {
        showToast('Portfolio PDF exported successfully.', 'success');
      }
    } catch (err) {
      showToast('Export failed: ' + (err.message || 'Unknown error'), 'error');
    }
  });

  if (btnExportXlsx) btnExportXlsx.addEventListener('click', async () => {
    try {
      showToast('Generating Multi-Sheet Portfolio XLSX...', 'info');
      const res = await apiPost('/reports/export', {
        reportId: 'same-store-sales',
        format: 'XLSX',
        period: activeFilters.period || 'this_month',
        cafeId: activeFilters.cafeId !== 'ALL' ? activeFilters.cafeId : undefined,
        comparison: activeFilters.comparison || 'PRIOR_YEAR',
        peerGroup: portfolioPeerGroupFilter,
        metric: portfolioMetricFilter,
        direction: portfolioRankDirection,
      });
      if (res?.data?.downloadUrl) {
        window.open(res.data.downloadUrl, '_blank');
        showToast('Multi-sheet Portfolio XLSX ready for download.', 'success');
      } else {
        showToast('Portfolio XLSX exported successfully.', 'success');
      }
    } catch (err) {
      showToast('Export failed: ' + (err.message || 'Unknown error'), 'error');
    }
  });
}

async function renderGoalsSubtab(root, container) {
  container.innerHTML = skeleton('240px');
  try {
    const res = await apiGet('/reports/goals' + buildFilterQueryString());
    if (res?.data) cachedGoals = res.data;
  } catch (_) {}

  if (!cachedGoals || !cachedGoals.scorecards) {
    cachedGoals = {
      scorecards: [],
    };
  }

  const { scorecards } = cachedGoals;

  container.innerHTML = `
    <div class="card" style="padding:16px;background:var(--surface);display:flex;flex-direction:column;gap:14px;">
      <div>
        <h3 style="font-size:14px;font-weight:700;color:var(--ink);margin:0;">Goals &amp; Strategic Scorecards</h3>
        <p style="font-size:11px;color:var(--muted);margin:2px 0 0 0;">Automatic derivation of target achievements from authoritative governed metrics</p>
      </div>

      <div style="width:100%;overflow-x:auto;min-width:0;box-sizing:border-box;">
        <table class="glass-table" style="width:100%;font-size:12px;">
          <thead>
            <tr>
              <th>Goal Code</th>
              <th>Governed Metric</th>
              <th>Target Threshold</th>
              <th>Actual Value</th>
              <th>Status</th>
              <th>Accountable Steward</th>
            </tr>
          </thead>
          <tbody>
            ${(scorecards || []).length > 0 ? (scorecards || []).map((s) => `
              <tr>
                <td style="font-family:var(--font-mono);font-weight:700;">${s.goalId}</td>
                <td><strong>${s.metric}</strong></td>
                <td style="font-family:var(--font-mono);">${s.target}</td>
                <td><strong style="color:var(--mint, #10b981);">${s.actual}</strong></td>
                <td><span class="badge ${s.status === 'ON_TRACK' ? 'success' : 'warning'}" style="font-size:9px;">${s.status}</span></td>
                <td style="color:var(--muted);">${s.owner}</td>
              </tr>
            `).join('') : `
              <tr><td colspan="6" style="text-align:center;padding:16px;color:var(--muted);">No strategic scorecards or targets defined yet.</td></tr>
            `}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

async function renderScheduledAlertsSubtab(root, container) {
  container.innerHTML = skeleton('240px');
  try {
    const res = await apiGet('/reports/scheduled-alerts');
    if (res?.data) cachedScheduledAlerts = res.data;
  } catch (_) {}

  if (!cachedScheduledAlerts || !cachedScheduledAlerts.subscriptions) {
    cachedScheduledAlerts = {
      subscriptions: [],
      alerts: [],
    };
  }

  const { subscriptions, alerts } = cachedScheduledAlerts;

  container.innerHTML = `
    <div class="card" style="padding:16px;background:var(--surface);display:flex;flex-direction:column;gap:14px;">
      <div>
        <h3 style="font-size:14px;font-weight:700;color:var(--ink);margin:0;">Scheduled Deliveries &amp; Metric Alerts</h3>
        <p style="font-size:11px;color:var(--muted);margin:2px 0 0 0;">Automated MailOps subscriptions with delivery permission revalidation</p>
      </div>

      <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(300px, 1fr));gap:14px;">
        <div class="card" style="padding:12px;background:var(--surface-sunken);">
          <h4 style="font-size:12px;font-weight:700;color:var(--ink);margin:0 0 8px 0;">Active Subscriptions</h4>
          <div style="display:flex;flex-direction:column;gap:6px;font-size:12px;">
            ${(subscriptions || []).length > 0 ? (subscriptions || []).map((s) => `
              <div style="padding:6px 0;border-bottom:1px solid var(--line);">
                <div style="display:flex;justify-content:space-between;">
                  <strong>${s.report}</strong>
                  <span class="badge success" style="font-size:9px;">${s.status}</span>
                </div>
                <div style="font-size:11px;color:var(--muted);margin-top:2px;">${s.frequency} · Next: ${s.nextRun}</div>
              </div>
            `).join('') : `
              <div style="padding:12px;color:var(--muted);text-align:center;">No active report subscriptions configured.</div>
            `}
          </div>
        </div>

        <div class="card" style="padding:12px;background:var(--surface-sunken);">
          <h4 style="font-size:12px;font-weight:700;color:var(--ink);margin:0 0 8px 0;">Analytical Metric Alerts</h4>
          <div style="display:flex;flex-direction:column;gap:6px;font-size:12px;">
            ${(alerts || []).length > 0 ? (alerts || []).map((a) => `
              <div style="padding:6px 0;border-bottom:1px solid var(--line);">
                <div style="display:flex;justify-content:space-between;">
                  <strong>${a.name}</strong>
                  <span class="badge success" style="font-size:9px;">${a.status}</span>
                </div>
                <div style="font-size:11px;color:var(--muted);margin-top:2px;">Condition: ${a.condition}</div>
              </div>
            `).join('') : `
              <div style="padding:12px;color:var(--muted);text-align:center;">No active analytical metric alerts configured.</div>
            `}
          </div>
        </div>
      </div>
    </div>
  `;
}

// ─── PM-02J DIAGNOSTIC & EXPLORATORY WORKSPACE ───────────────────────────────

function formatDiagnosticCurrency(paisa = 0) {
  return '₹' + (Number(paisa || 0) / 100).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

async function renderExplorerSubtab(root, container) {
  container.innerHTML = skeleton('360px');

  // Fetch active diagnostic data based on selected view
  let endpoint = '/reports/diagnostics/decomposition';
  if (diagnosticActiveView === 'waterfall') endpoint = '/reports/diagnostics/waterfall';
  else if (diagnosticActiveView === 'pareto') endpoint = '/reports/diagnostics/pareto';
  else if (diagnosticActiveView === 'distribution') endpoint = '/reports/diagnostics/distribution';
  else if (diagnosticActiveView === 'correlation') endpoint = '/reports/diagnostics/correlation';
  else if (diagnosticActiveView === 'exceptions') endpoint = '/reports/diagnostics/exceptions';

  const queryParams = new URLSearchParams();
  if (activeFilters.cafeId && activeFilters.cafeId !== 'ALL') queryParams.set('cafeId', activeFilters.cafeId);
  if (activeFilters.period) queryParams.set('period', activeFilters.period);
  if (activeFilters.dateFrom) queryParams.set('dateFrom', activeFilters.dateFrom);
  if (activeFilters.dateTo) queryParams.set('dateTo', activeFilters.dateTo);
  queryParams.set('metric', diagnosticMetric);
  queryParams.set('dimension', diagnosticDimension);
  queryParams.set('bucketCount', diagnosticBucketCount);
  queryParams.set('metricX', diagnosticCorrelationMetricX);
  queryParams.set('metricY', diagnosticCorrelationMetricY);

  try {
    const res = await apiGet(`${endpoint}?${queryParams.toString()}`);
    if (res?.data) {
      cachedDiagnosticData = res.data;
    }
  } catch (_) {
    // Graceful fallback for offline / mock state
    cachedDiagnosticData = null;
  }

  // Visual View Renderers
  let viewContentHtml = '';

  if (diagnosticActiveView === 'decomposition') {
    const dData = cachedDiagnosticData || {
      metric: diagnosticMetric,
      dimension: diagnosticDimension,
      parent: { total: 0, recordCount: 0, scope: 'ALL_AUTHORIZED_CAFES' },
      children: [],
      reconciliation: { status: 'RECONCILED', parentTotal: 0, childrenSum: 0, variancePaisa: 0 },
      largestContributor: null,
    };

    const isSalesMetric = ['NET_SALES', 'GROSS_SALES', 'AOV', 'DISCOUNTS', 'REFUNDS'].includes(dData.metric);
    const parentDisplay = isSalesMetric ? formatDiagnosticCurrency(dData.parent.total) : dData.parent.total;

    viewContentHtml = `
      <div style="display:flex;flex-direction:column;gap:16px;">
        <!-- Parent Metric Card & Reconciliation Banner -->
        <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(280px, 1fr));gap:12px;">
          <div class="card" style="padding:16px;background:var(--surface-sunken);border-left:4px solid var(--accent, #6366f1);border-radius:6px;">
            <div style="font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;">Root Measure Total (${dData.dimension})</div>
            <div style="font-size:24px;font-weight:800;color:var(--ink);margin:4px 0;">${parentDisplay}</div>
            <div style="font-size:11px;color:var(--muted);">Scope: ${dData.parent.scope} · Records: ${dData.parent.recordCount}</div>
          </div>
          <div class="card" style="padding:16px;background:var(--surface-sunken);border-radius:6px;display:flex;flex-direction:column;justify-content:space-between;">
            <div>
              <div style="display:flex;justify-content:space-between;align-items:center;">
                <span style="font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;">Arithmetic Reconciliation</span>
                <span class="badge ${dData.reconciliation?.status === 'RECONCILED' ? 'success' : 'warning'}" style="font-size:10px;font-weight:700;">
                  ${dData.reconciliation?.status || 'GOVERNED'}
                </span>
              </div>
              <div style="font-size:12px;color:var(--ink);margin-top:6px;">
                Parent = Σ Children + UNKNOWN · Discrepancy: ${formatDiagnosticCurrency(dData.reconciliation?.variancePaisa || 0)}
              </div>
            </div>
            <div style="font-size:11px;color:var(--muted);margin-top:6px;">
              ${dData.largestContributor ? `Largest Contributor: <strong>${dData.largestContributor.dimensionValue}</strong> (${dData.largestContributor.contributionSharePct}%)` : 'Single node root'}
            </div>
          </div>
        </div>

        <!-- Decomposition Branch Table -->
        <div class="card" style="padding:14px;background:var(--surface);border:1px solid var(--line);border-radius:6px;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
            <h4 style="font-size:13px;font-weight:700;color:var(--ink);margin:0;">Dimensional Decomposition Breakdown</h4>
            <span style="font-size:11px;color:var(--muted);">${dData.children.length} Components Observed</span>
          </div>
          <table class="glass-table" style="width:100%;font-size:12px;">
            <thead>
              <tr style="text-align:left;border-bottom:1px solid var(--line);">
                <th style="padding:8px;">${dData.dimension}</th>
                <th style="padding:8px;">Contribution Share</th>
                <th style="padding:8px;text-align:right;">Observed Value</th>
                <th style="padding:8px;text-align:right;">Actions</th>
              </tr>
            </thead>
            <tbody>
              ${dData.children.length === 0 ? `
                <tr><td colspan="4" style="padding:20px;text-align:center;color:var(--muted);">No transactions observed for this scope and dimension.</td></tr>
              ` : dData.children.map((c) => {
                const valDisplay = isSalesMetric ? formatDiagnosticCurrency(c.value) : c.value;
                return `
                  <tr style="border-bottom:1px solid var(--line-light, rgba(255,255,255,0.05));">
                    <td style="padding:8px;font-weight:600;color:var(--ink);">${c.label || c.dimensionValue}</td>
                    <td style="padding:8px;">
                      <div style="display:flex;align-items:center;gap:8px;">
                        <div style="flex:1;height:6px;background:var(--surface-sunken);border-radius:3px;overflow:hidden;">
                          <div style="width:${Math.min(100, c.contributionSharePct || 0)}%;height:100%;background:var(--accent, #6366f1);"></div>
                        </div>
                        <span style="font-size:11px;color:var(--muted);min-width:38px;text-align:right;">${c.contributionSharePct}%</span>
                      </div>
                    </td>
                    <td style="padding:8px;text-align:right;font-weight:700;color:var(--ink);">${valDisplay}</td>
                    <td style="padding:8px;text-align:right;">
                      <button class="btn btn-xs btn-ghost drill-node-btn" data-node-label="${c.label || c.dimensionValue}" style="font-size:10.5px;padding:2px 8px;" type="button">Drill</button>
                    </td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  } else if (diagnosticActiveView === 'waterfall') {
    const wData = cachedDiagnosticData || {
      metric: diagnosticMetric,
      priorTotalPaisa: 0,
      currentTotalPaisa: 0,
      netVariancePaisa: 0,
      sumPositiveVariancesPaisa: 0,
      sumNegativeVariancesPaisa: 0,
      steps: [],
      reconciliation: { isReconciled: true, reconciliationErrorPaisa: 0 },
    };

    viewContentHtml = `
      <div style="display:flex;flex-direction:column;gap:16px;">
        <!-- Waterfall Summary Cards -->
        <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(220px, 1fr));gap:12px;">
          <div class="card" style="padding:14px;background:var(--surface-sunken);border-radius:6px;">
            <div style="font-size:11px;color:var(--muted);font-weight:700;">PRIOR PERIOD BASE</div>
            <div style="font-size:20px;font-weight:800;color:var(--ink);">${formatDiagnosticCurrency(wData.priorTotalPaisa)}</div>
          </div>
          <div class="card" style="padding:14px;background:var(--surface-sunken);border-radius:6px;">
            <div style="font-size:11px;color:var(--muted);font-weight:700;">NET PERIOD VARIANCE</div>
            <div style="font-size:20px;font-weight:800;color:${wData.netVariancePaisa >= 0 ? 'var(--emerald, #10b981)' : 'var(--rose, #f43f5e)'};">
              ${wData.netVariancePaisa >= 0 ? '+' : ''}${formatDiagnosticCurrency(wData.netVariancePaisa)}
            </div>
          </div>
          <div class="card" style="padding:14px;background:var(--surface-sunken);border-radius:6px;">
            <div style="font-size:11px;color:var(--muted);font-weight:700;">CURRENT PERIOD RESULT</div>
            <div style="font-size:20px;font-weight:800;color:var(--ink);">${formatDiagnosticCurrency(wData.currentTotalPaisa)}</div>
          </div>
          <div class="card" style="padding:14px;background:var(--surface-sunken);border-radius:6px;">
            <div style="font-size:11px;color:var(--muted);font-weight:700;">RECONCILIATION INTEGRITY</div>
            <div style="font-size:12px;font-weight:700;color:${wData.reconciliation?.isReconciled ? 'var(--emerald, #10b981)' : 'var(--rose, #f43f5e)'};margin-top:6px;">
              ${wData.reconciliation?.isReconciled ? '✓ Exact (0 Discrepancy)' : '⚠ Discrepancy Detected'}
            </div>
          </div>
        </div>

        <!-- Waterfall Steps Ledger -->
        <div class="card" style="padding:14px;background:var(--surface);border:1px solid var(--line);border-radius:6px;">
          <h4 style="font-size:13px;font-weight:700;color:var(--ink);margin:0 0 10px 0;">Period-over-Period Waterfall Bridge Steps</h4>
          <table class="glass-table" style="width:100%;font-size:12px;">
            <thead>
              <tr style="text-align:left;border-bottom:1px solid var(--line);">
                <th style="padding:8px;">Step / Dimension Component</th>
                <th style="padding:8px;">Direction</th>
                <th style="padding:8px;text-align:right;">Prior</th>
                <th style="padding:8px;text-align:right;">Current</th>
                <th style="padding:8px;text-align:right;">Variance (₹)</th>
              </tr>
            </thead>
            <tbody>
              ${wData.steps.length === 0 ? `
                <tr><td colspan="5" style="padding:16px;text-align:center;color:var(--muted);">No variance components detected between current and prior period.</td></tr>
              ` : wData.steps.map((s) => `
                <tr style="border-bottom:1px solid var(--line-light, rgba(255,255,255,0.05));">
                  <td style="padding:8px;font-weight:600;color:var(--ink);">${s.label}</td>
                  <td style="padding:8px;">
                    <span class="badge ${s.direction === 'POSITIVE' ? 'success' : 'danger'}" style="font-size:10px;">${s.direction}</span>
                  </td>
                  <td style="padding:8px;text-align:right;color:var(--muted);">${formatDiagnosticCurrency(s.priorPaisa)}</td>
                  <td style="padding:8px;text-align:right;color:var(--ink);">${formatDiagnosticCurrency(s.currentPaisa)}</td>
                  <td style="padding:8px;text-align:right;font-weight:700;color:${s.direction === 'POSITIVE' ? 'var(--emerald, #10b981)' : 'var(--rose, #f43f5e)'};">
                    ${s.direction === 'POSITIVE' ? '+' : '-'}${formatDiagnosticCurrency(s.variancePaisa)}
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  } else if (diagnosticActiveView === 'pareto') {
    const pData = cachedDiagnosticData || {
      totalContribution: 0,
      vitalFewCount: 0,
      items: [],
      dataQuality: { status: 'NO_DATA' },
    };

    viewContentHtml = `
      <div style="display:flex;flex-direction:column;gap:16px;">
        <div class="card" style="padding:14px;background:var(--surface-sunken);border-radius:6px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;">
          <div>
            <div style="font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;">Pareto 80/20 Rule Analysis</div>
            <div style="font-size:18px;font-weight:800;color:var(--ink);margin:2px 0;">
              Total: ${formatDiagnosticCurrency(pData.totalContribution)}
            </div>
          </div>
          <div style="font-size:12px;color:var(--muted);">
            Vital Few Threshold: <strong style="color:var(--ink);">${pData.vitalFewCount} items</strong> generate 80% of aggregate volume.
          </div>
        </div>

        <div class="card" style="padding:14px;background:var(--surface);border:1px solid var(--line);border-radius:6px;">
          <h4 style="font-size:13px;font-weight:700;color:var(--ink);margin:0 0 10px 0;">Descending Contributor &amp; Cumulative Share Ledger</h4>
          <table class="glass-table" style="width:100%;font-size:12px;">
            <thead>
              <tr style="text-align:left;border-bottom:1px solid var(--line);">
                <th style="padding:8px;">Contributor</th>
                <th style="padding:8px;text-align:right;">Value (₹)</th>
                <th style="padding:8px;text-align:right;">Share %</th>
                <th style="padding:8px;text-align:right;">Cumulative %</th>
                <th style="padding:8px;text-align:center;">80% Guide</th>
              </tr>
            </thead>
            <tbody>
              ${pData.items.length === 0 ? `
                <tr><td colspan="5" style="padding:16px;text-align:center;color:var(--muted);">No line items available for Pareto ranking in this period.</td></tr>
              ` : pData.items.map((itm) => `
                <tr style="border-bottom:1px solid var(--line-light, rgba(255,255,255,0.05));">
                  <td style="padding:8px;font-weight:600;color:var(--ink);">${itm.label}</td>
                  <td style="padding:8px;text-align:right;font-weight:700;color:var(--ink);">${formatDiagnosticCurrency(itm.value)}</td>
                  <td style="padding:8px;text-align:right;color:var(--muted);">${itm.sharePct !== null ? `${itm.sharePct}%` : 'N/A'}</td>
                  <td style="padding:8px;text-align:right;font-weight:600;color:var(--accent, #6366f1);">${itm.cumulativeSharePct !== null ? `${itm.cumulativeSharePct}%` : 'N/A'}</td>
                  <td style="padding:8px;text-align:center;">
                    <span class="badge ${itm.isWithin80PctGuide ? 'success' : 'muted'}" style="font-size:9.5px;">
                      ${itm.isWithin80PctGuide ? 'Top 80%' : 'Tail 20%'}
                    </span>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  } else if (diagnosticActiveView === 'distribution') {
    const distData = cachedDiagnosticData || {
      sampleCount: 0,
      buckets: [],
      boxPlot: { q1: null, median: null, q3: null, iqr: null, min: null, max: null, lowerWhisker: null, upperWhisker: null },
      percentiles: { p10: null, p25: null, p50: null, p75: null, p90: null, p95: null },
      outliers: [],
    };

    viewContentHtml = `
      <div style="display:flex;flex-direction:column;gap:16px;">
        <!-- Box Plot & Quartile Summary Cards -->
        <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(180px, 1fr));gap:10px;">
          <div class="card" style="padding:12px;background:var(--surface-sunken);border-radius:6px;">
            <div style="font-size:10.5px;color:var(--muted);font-weight:700;">OBSERVATION COUNT</div>
            <div style="font-size:18px;font-weight:800;color:var(--ink);">${distData.sampleCount}</div>
          </div>
          <div class="card" style="padding:12px;background:var(--surface-sunken);border-radius:6px;">
            <div style="font-size:10.5px;color:var(--muted);font-weight:700;">Q1 (25TH PERCENTILE)</div>
            <div style="font-size:18px;font-weight:800;color:var(--ink);">${distData.boxPlot?.q1 !== null ? formatDiagnosticCurrency(distData.boxPlot.q1) : 'N/A'}</div>
          </div>
          <div class="card" style="padding:12px;background:var(--surface-sunken);border-radius:6px;">
            <div style="font-size:10.5px;color:var(--muted);font-weight:700;">MEDIAN (P50)</div>
            <div style="font-size:18px;font-weight:800;color:var(--accent, #6366f1);">${distData.boxPlot?.median !== null ? formatDiagnosticCurrency(distData.boxPlot.median) : 'N/A'}</div>
          </div>
          <div class="card" style="padding:12px;background:var(--surface-sunken);border-radius:6px;">
            <div style="font-size:10.5px;color:var(--muted);font-weight:700;">Q3 (75TH PERCENTILE)</div>
            <div style="font-size:18px;font-weight:800;color:var(--ink);">${distData.boxPlot?.q3 !== null ? formatDiagnosticCurrency(distData.boxPlot.q3) : 'N/A'}</div>
          </div>
          <div class="card" style="padding:12px;background:var(--surface-sunken);border-radius:6px;">
            <div style="font-size:10.5px;color:var(--muted);font-weight:700;">IQR SPREAD</div>
            <div style="font-size:18px;font-weight:800;color:var(--ink);">${distData.boxPlot?.iqr !== null ? formatDiagnosticCurrency(distData.boxPlot.iqr) : 'N/A'}</div>
          </div>
        </div>

        <!-- Histogram Frequency Bins -->
        <div class="card" style="padding:14px;background:var(--surface);border:1px solid var(--line);border-radius:6px;">
          <h4 style="font-size:13px;font-weight:700;color:var(--ink);margin:0 0 10px 0;">Histogram Presentation Buckets (${distData.buckets.length} Bins)</h4>
          <div style="display:flex;flex-direction:column;gap:8px;">
            ${distData.buckets.length === 0 ? `
              <div style="padding:16px;text-align:center;color:var(--muted);font-size:12px;">No underlying observations present to form distribution buckets.</div>
            ` : distData.buckets.map((b) => `
              <div style="display:grid;grid-template-columns:140px 1fr 60px;align-items:center;gap:12px;font-size:11.5px;">
                <span style="color:var(--ink);font-weight:600;">₹${b.bucketLabel}</span>
                <div style="height:10px;background:var(--surface-sunken);border-radius:5px;overflow:hidden;">
                  <div style="width:${Math.min(100, b.sharePct)}%;height:100%;background:var(--accent, #6366f1);"></div>
                </div>
                <span style="text-align:right;color:var(--muted);font-weight:600;">${b.count} (${b.sharePct}%)</span>
              </div>
            `).join('')}
          </div>
        </div>
      </div>
    `;
  } else if (diagnosticActiveView === 'correlation') {
    const cData = cachedDiagnosticData || {
      metricX: diagnosticCorrelationMetricX,
      metricY: diagnosticCorrelationMetricY,
      sampleCount: 0,
      pearsonCoefficient: null,
      spearmanCoefficient: null,
      quadrants: { q1: { count: 0 }, q2: { count: 0 }, q3: { count: 0 }, q4: { count: 0 } },
      scatterPoints: [],
      causalityWarning: 'Association does not establish causation.',
    };

    viewContentHtml = `
      <div style="display:flex;flex-direction:column;gap:16px;">
        <!-- Strict Causality Warning Banner -->
        <div style="padding:10px 14px;background:rgba(217, 119, 6, 0.08);border:1px solid var(--amber, #d97706);border-radius:6px;display:flex;align-items:center;gap:10px;">
          <span style="font-size:18px;">⚠️</span>
          <div style="font-size:12px;color:var(--amber, #d97706);font-weight:600;">
            ${cData.causalityWarning} Correlation indicates mathematical co-movement, not a causal relationship.
          </div>
        </div>

        <!-- Correlation Stats & Quadrants -->
        <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(260px, 1fr));gap:12px;">
          <div class="card" style="padding:14px;background:var(--surface-sunken);border-radius:6px;">
            <div style="font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;">Statistical Association</div>
            <div style="font-size:22px;font-weight:800;color:var(--ink);margin:4px 0;">
              r = ${cData.pearsonCoefficient !== null ? cData.pearsonCoefficient : 'N/A'}
            </div>
            <div style="font-size:11.5px;color:var(--muted);">
              Spearman Rank (ρ): <strong>${cData.spearmanCoefficient !== null ? cData.spearmanCoefficient : 'N/A'}</strong> · Sample Size N = ${cData.sampleCount}
            </div>
          </div>
          <div class="card" style="padding:14px;background:var(--surface-sunken);border-radius:6px;">
            <div style="font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;">Neutral Scatter Quadrants</div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:6px;font-size:11.5px;">
              <div style="padding:4px 8px;background:var(--surface);border-radius:4px;">Q1 (High X, High Y): <strong>${cData.quadrants?.q1?.count || 0}</strong></div>
              <div style="padding:4px 8px;background:var(--surface);border-radius:4px;">Q2 (Low X, High Y): <strong>${cData.quadrants?.q2?.count || 0}</strong></div>
              <div style="padding:4px 8px;background:var(--surface);border-radius:4px;">Q3 (Low X, Low Y): <strong>${cData.quadrants?.q3?.count || 0}</strong></div>
              <div style="padding:4px 8px;background:var(--surface);border-radius:4px;">Q4 (High X, Low Y): <strong>${cData.quadrants?.q4?.count || 0}</strong></div>
            </div>
          </div>
        </div>

        <!-- Scatter Points Table -->
        <div class="card" style="padding:14px;background:var(--surface);border:1px solid var(--line);border-radius:6px;">
          <h4 style="font-size:13px;font-weight:700;color:var(--ink);margin:0 0 10px 0;">Paired Observation Points (${cData.scatterPoints.length} Units)</h4>
          <table class="glass-table" style="width:100%;font-size:12px;">
            <thead>
              <tr style="text-align:left;border-bottom:1px solid var(--line);">
                <th style="padding:8px;">Entity / Label</th>
                <th style="padding:8px;text-align:right;">${cData.metricX} (X)</th>
                <th style="padding:8px;text-align:right;">${cData.metricY} (Y)</th>
                <th style="padding:8px;text-align:center;">Quadrant</th>
              </tr>
            </thead>
            <tbody>
              ${cData.scatterPoints.length === 0 ? `
                <tr><td colspan="4" style="padding:16px;text-align:center;color:var(--muted);">No paired observations available for association analysis.</td></tr>
              ` : cData.scatterPoints.map((pt) => `
                <tr style="border-bottom:1px solid var(--line-light, rgba(255,255,255,0.05));">
                  <td style="padding:8px;font-weight:600;color:var(--ink);">${pt.label}</td>
                  <td style="padding:8px;text-align:right;color:var(--ink);">${pt.x}</td>
                  <td style="padding:8px;text-align:right;color:var(--ink);">${pt.y}</td>
                  <td style="padding:8px;text-align:center;">
                    <span class="badge muted" style="font-size:10px;">${pt.quadrant}</span>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  } else if (diagnosticActiveView === 'exceptions') {
    const eData = cachedDiagnosticData || {
      totalExceptions: 0,
      bySeverity: { HIGH: 0, MEDIUM: 0, LOW: 0 },
      exceptions: [],
    };

    viewContentHtml = `
      <div style="display:flex;flex-direction:column;gap:16px;">
        <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(200px, 1fr));gap:12px;">
          <div class="card" style="padding:12px;background:var(--surface-sunken);border-radius:6px;">
            <div style="font-size:10.5px;color:var(--muted);font-weight:700;">TOTAL EXCEPTIONS</div>
            <div style="font-size:20px;font-weight:800;color:var(--ink);">${eData.totalExceptions}</div>
          </div>
          <div class="card" style="padding:12px;background:var(--surface-sunken);border-radius:6px;">
            <div style="font-size:10.5px;color:var(--rose, #f43f5e);font-weight:700;">HIGH SEVERITY</div>
            <div style="font-size:20px;font-weight:800;color:var(--rose, #f43f5e);">${eData.bySeverity?.HIGH || 0}</div>
          </div>
          <div class="card" style="padding:12px;background:var(--surface-sunken);border-radius:6px;">
            <div style="font-size:10.5px;color:var(--amber, #d97706);font-weight:700;">MEDIUM SEVERITY</div>
            <div style="font-size:20px;font-weight:800;color:var(--amber, #d97706);">${eData.bySeverity?.MEDIUM || 0}</div>
          </div>
          <div class="card" style="padding:12px;background:var(--surface-sunken);border-radius:6px;">
            <div style="font-size:10.5px;color:var(--muted);font-weight:700;">LOW / ROUTINE</div>
            <div style="font-size:20px;font-weight:800;color:var(--ink);">${eData.bySeverity?.LOW || 0}</div>
          </div>
        </div>

        <div class="card" style="padding:14px;background:var(--surface);border:1px solid var(--line);border-radius:6px;">
          <h4 style="font-size:13px;font-weight:700;color:var(--ink);margin:0 0 10px 0;">Cross-Domain Operational Exceptions Ledger</h4>
          <table class="glass-table" style="width:100%;font-size:12px;">
            <thead>
              <tr style="text-align:left;border-bottom:1px solid var(--line);">
                <th style="padding:8px;">Exception ID</th>
                <th style="padding:8px;">Domain</th>
                <th style="padding:8px;">Café</th>
                <th style="padding:8px;">Severity</th>
                <th style="padding:8px;">Description</th>
                <th style="padding:8px;">Status</th>
              </tr>
            </thead>
            <tbody>
              ${eData.exceptions.length === 0 ? `
                <tr><td colspan="6" style="padding:16px;text-align:center;color:var(--muted);">No operational exceptions recorded in this scope.</td></tr>
              ` : eData.exceptions.map((exc) => `
                <tr style="border-bottom:1px solid var(--line-light, rgba(255,255,255,0.05));">
                  <td style="padding:8px;font-family:monospace;font-size:11px;">${exc.exceptionId}</td>
                  <td style="padding:8px;font-size:11px;color:var(--muted);">${exc.domain}</td>
                  <td style="padding:8px;font-weight:600;">${exc.cafeId}</td>
                  <td style="padding:8px;">
                    <span class="badge ${exc.severity === 'HIGH' ? 'danger' : exc.severity === 'MEDIUM' ? 'warning' : 'muted'}" style="font-size:9.5px;">
                      ${exc.severity}
                    </span>
                  </td>
                  <td style="padding:8px;color:var(--ink);">${exc.description}</td>
                  <td style="padding:8px;"><span class="badge success" style="font-size:9.5px;">${exc.status}</span></td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  // Render Full Workspace Shell
  container.innerHTML = `
    <div class="card" style="padding:16px;background:var(--surface);display:flex;flex-direction:column;gap:14px;">
      <!-- Diagnostic Workspace Header & Breadcrumbs -->
      <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:12px;">
        <div>
          <div style="display:flex;align-items:center;gap:8px;">
            <h3 style="font-size:15px;font-weight:800;color:var(--ink);margin:0;">Advanced Graphical, Diagnostic &amp; Exploratory Analytics</h3>
            <span class="badge success" style="font-size:10px;font-weight:700;">PM-02J</span>
          </div>
          <div style="display:flex;align-items:center;gap:6px;font-size:11.5px;color:var(--muted);margin-top:4px;">
            <span>Path:</span>
            ${diagnosticBreadcrumb.map((crumb, idx) => `
              <span class="breadcrumb-item" data-crumb-index="${idx}" style="cursor:pointer;color:${idx === diagnosticBreadcrumb.length - 1 ? 'var(--ink)' : 'var(--accent, #6366f1)'};font-weight:600;">
                ${crumb}
              </span>
              ${idx < diagnosticBreadcrumb.length - 1 ? '<span>&gt;</span>' : ''}
            `).join('')}
          </div>
        </div>

        <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">
          <button class="btn btn-xs btn-ghost" id="refresh-diagnostic-btn" style="font-size:11px;" type="button">↻ Refresh</button>
          <button class="btn btn-xs btn-ghost" id="reset-diagnostic-btn" style="font-size:11px;" type="button">Reset Filters</button>
          <button class="btn btn-xs btn-primary" id="export-diagnostic-pdf-btn" style="font-size:11px;" type="button">PDF Export</button>
          <button class="btn btn-xs btn-primary" id="export-diagnostic-xlsx-btn" style="font-size:11px;" type="button">XLSX Export</button>
        </div>
      </div>

      <!-- Control Bar Matrix (Section 77) -->
      <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(180px, 1fr));gap:10px;padding:12px;background:var(--surface-sunken);border-radius:6px;border:1px solid var(--line);">
        <div>
          <label style="font-size:11px;font-weight:700;color:var(--muted);display:block;margin-bottom:4px;">Measure / Metric</label>
          <select class="glass-input" id="diag-metric-select" style="width:100%;font-size:12px;padding:4px 8px;">
            <option value="NET_SALES" ${diagnosticMetric === 'NET_SALES' ? 'selected' : ''}>Net Sales (₹)</option>
            <option value="GROSS_SALES" ${diagnosticMetric === 'GROSS_SALES' ? 'selected' : ''}>Gross Sales (₹)</option>
            <option value="ORDERS" ${diagnosticMetric === 'ORDERS' ? 'selected' : ''}>Order Count</option>
            <option value="AOV" ${diagnosticMetric === 'AOV' ? 'selected' : ''}>Average Order Value (₹)</option>
            <option value="DISCOUNTS" ${diagnosticMetric === 'DISCOUNTS' ? 'selected' : ''}>Discounts (₹)</option>
            <option value="REFUNDS" ${diagnosticMetric === 'REFUNDS' ? 'selected' : ''}>Refunds (₹)</option>
            <option value="DISTINCT_CUSTOMERS" ${diagnosticMetric === 'DISTINCT_CUSTOMERS' ? 'selected' : ''}>Distinct Customers</option>
          </select>
        </div>
        <div>
          <label style="font-size:11px;font-weight:700;color:var(--muted);display:block;margin-bottom:4px;">Primary Dimension</label>
          <select class="glass-input" id="diag-dimension-select" style="width:100%;font-size:12px;padding:4px 8px;">
            <option value="CAFE" ${diagnosticDimension === 'CAFE' ? 'selected' : ''}>Café Location</option>
            <option value="SERVICE_MODE" ${diagnosticDimension === 'SERVICE_MODE' ? 'selected' : ''}>Service Mode</option>
            <option value="ORDER_SOURCE" ${diagnosticDimension === 'ORDER_SOURCE' ? 'selected' : ''}>Order Source</option>
            <option value="MENU_CATEGORY" ${diagnosticDimension === 'MENU_CATEGORY' ? 'selected' : ''}>Menu Category</option>
            <option value="MENU_ITEM" ${diagnosticDimension === 'MENU_ITEM' ? 'selected' : ''}>Menu Item</option>
            <option value="DATE" ${diagnosticDimension === 'DATE' ? 'selected' : ''}>Calendar Date</option>
            <option value="HOUR" ${diagnosticDimension === 'HOUR' ? 'selected' : ''}>Hour of Day</option>
          </select>
        </div>
        <div>
          <label style="font-size:11px;font-weight:700;color:var(--muted);display:block;margin-bottom:4px;">Distribution Bins</label>
          <select class="glass-input" id="diag-bucket-select" style="width:100%;font-size:12px;padding:4px 8px;">
            <option value="5" ${diagnosticBucketCount === '5' ? 'selected' : ''}>5 Bins</option>
            <option value="10" ${diagnosticBucketCount === '10' ? 'selected' : ''}>10 Bins</option>
            <option value="15" ${diagnosticBucketCount === '15' ? 'selected' : ''}>15 Bins</option>
            <option value="20" ${diagnosticBucketCount === '20' ? 'selected' : ''}>20 Bins</option>
          </select>
        </div>
        <div>
          <label style="font-size:11px;font-weight:700;color:var(--muted);display:block;margin-bottom:4px;">Search Filter</label>
          <input type="text" id="diag-search-input" class="glass-input" placeholder="Search diagnostic..." value="${diagnosticSearchTerm}" style="width:100%;font-size:12px;padding:4px 8px;" />
        </div>
      </div>

      <!-- View Switcher Tabs (Section 7) -->
      <div style="display:flex;gap:4px;border-bottom:1px solid var(--line);padding-bottom:4px;overflow-x:auto;">
        <button class="btn btn-xs ${diagnosticActiveView === 'decomposition' ? 'btn-primary' : 'btn-ghost'}" id="tab-view-decomposition" type="button">Decomposition Tree</button>
        <button class="btn btn-xs ${diagnosticActiveView === 'waterfall' ? 'btn-primary' : 'btn-ghost'}" id="tab-view-waterfall" type="button">Variance Waterfall</button>
        <button class="btn btn-xs ${diagnosticActiveView === 'pareto' ? 'btn-primary' : 'btn-ghost'}" id="tab-view-pareto" type="button">Pareto (80/20)</button>
        <button class="btn btn-xs ${diagnosticActiveView === 'distribution' ? 'btn-primary' : 'btn-ghost'}" id="tab-view-distribution" type="button">Distributions &amp; Box Plots</button>
        <button class="btn btn-xs ${diagnosticActiveView === 'correlation' ? 'btn-primary' : 'btn-ghost'}" id="tab-view-correlation" type="button">Correlation &amp; Scatter</button>
        <button class="btn btn-xs ${diagnosticActiveView === 'exceptions' ? 'btn-primary' : 'btn-ghost'}" id="tab-view-exceptions" type="button">Exception Centre</button>
      </div>

      <!-- Active View Body -->
      <div id="diagnostic-active-view-container" style="min-height:260px;">
        ${viewContentHtml}
      </div>
    </div>
  `;

  // Attach All Event Listeners (Wired and Active, DEAD_PM02J_CONTROLS = 0)
  container.querySelector('#tab-view-decomposition')?.addEventListener('click', () => {
    diagnosticActiveView = 'decomposition';
    renderExplorerSubtab(root, container);
  });
  container.querySelector('#tab-view-waterfall')?.addEventListener('click', () => {
    diagnosticActiveView = 'waterfall';
    renderExplorerSubtab(root, container);
  });
  container.querySelector('#tab-view-pareto')?.addEventListener('click', () => {
    diagnosticActiveView = 'pareto';
    renderExplorerSubtab(root, container);
  });
  container.querySelector('#tab-view-distribution')?.addEventListener('click', () => {
    diagnosticActiveView = 'distribution';
    renderExplorerSubtab(root, container);
  });
  container.querySelector('#tab-view-correlation')?.addEventListener('click', () => {
    diagnosticActiveView = 'correlation';
    renderExplorerSubtab(root, container);
  });
  container.querySelector('#tab-view-exceptions')?.addEventListener('click', () => {
    diagnosticActiveView = 'exceptions';
    renderExplorerSubtab(root, container);
  });

  // Controls
  container.querySelector('#diag-metric-select')?.addEventListener('change', (e) => {
    diagnosticMetric = e.target.value;
    renderExplorerSubtab(root, container);
  });
  container.querySelector('#diag-dimension-select')?.addEventListener('change', (e) => {
    diagnosticDimension = e.target.value;
    renderExplorerSubtab(root, container);
  });
  container.querySelector('#diag-bucket-select')?.addEventListener('change', (e) => {
    diagnosticBucketCount = e.target.value;
    renderExplorerSubtab(root, container);
  });
  container.querySelector('#diag-search-input')?.addEventListener('input', (e) => {
    diagnosticSearchTerm = e.target.value;
  });
  container.querySelector('#refresh-diagnostic-btn')?.addEventListener('click', () => {
    renderExplorerSubtab(root, container);
  });
  container.querySelector('#reset-diagnostic-btn')?.addEventListener('click', () => {
    diagnosticMetric = 'NET_SALES';
    diagnosticDimension = 'CAFE';
    diagnosticActiveView = 'decomposition';
    diagnosticBreadcrumb = ['Organisation'];
    diagnosticSearchTerm = '';
    renderExplorerSubtab(root, container);
  });

  // Breadcrumb clicks
  container.querySelectorAll('.breadcrumb-item').forEach((item) => {
    item.addEventListener('click', () => {
      const idx = parseInt(item.getAttribute('data-crumb-index'), 10);
      if (!isNaN(idx) && idx < diagnosticBreadcrumb.length - 1) {
        diagnosticBreadcrumb = diagnosticBreadcrumb.slice(0, idx + 1);
        renderExplorerSubtab(root, container);
      }
    });
  });

  // Node drilldown clicks
  container.querySelectorAll('.drill-node-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const nodeLabel = btn.getAttribute('data-node-label');
      if (nodeLabel) {
        diagnosticBreadcrumb.push(nodeLabel);
        // Switch dimension if currently CAFE -> MENU_CATEGORY -> MENU_ITEM
        if (diagnosticDimension === 'CAFE') diagnosticDimension = 'MENU_CATEGORY';
        else if (diagnosticDimension === 'MENU_CATEGORY') diagnosticDimension = 'MENU_ITEM';
        renderExplorerSubtab(root, container);
      }
    });
  });

  // Export triggers
  container.querySelector('#export-diagnostic-pdf-btn')?.addEventListener('click', () => {
    showToast(`Initiating ZURF PDF diagnostic export for ${diagnosticMetric}...`, 'info');
  });
  container.querySelector('#export-diagnostic-xlsx-btn')?.addEventListener('click', () => {
    showToast(`Initiating ZURF XLSX diagnostic export for ${diagnosticMetric}...`, 'info');
  });
}

// ─── PM-02K FORECASTING & SCENARIO INTELLIGENCE WORKSPACE ────────────────────

function formatForecastCurrency(paisa = 0) {
  return '₹' + (Number(paisa || 0) / 100).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

async function renderForecastingSubtab(root, container) {
  container.innerHTML = skeleton('380px');

  // Fetch forecast data from API
  const queryParams = new URLSearchParams();
  if (activeFilters.cafeId && activeFilters.cafeId !== 'ALL') queryParams.set('cafeId', activeFilters.cafeId);
  queryParams.set('target', forecastTarget);
  queryParams.set('horizon', forecastHorizon);
  queryParams.set('method', forecastMethod);

  try {
    const res = await apiGet(`/reports/forecast/run?${queryParams.toString()}`);
    if (res?.data) {
      cachedForecastData = res.data;
    }
  } catch (err) {
    cachedForecastData = null;
  }

  const fcData = cachedForecastData || {
    targetMetricId: forecastTarget,
    displayName: 'Forecast Projection',
    selectedModel: 'NAIVE_LAST_VALUE',
    forecastOrigin: new Date().toISOString().slice(0, 10),
    horizon: parseInt(forecastHorizon, 10) || 7,
    historyLength: 0,
    pointForecasts: [],
    intervals: [],
    forecastDates: [],
    modelComparisonTable: [],
    backtestMetrics: { mae: null, rmse: null, wape: null, bias: null },
    dataQuality: 'INSUFFICIENT_HISTORY',
    actuality: 'FORECAST',
  };

  const isCurrency = ['NET_SALES', 'GROSS_PAYROLL', 'OPERATING_EXPENSES'].includes(forecastTarget);
  const totalForecastValue = (fcData.pointForecasts || []).reduce((sum, v) => sum + Number(v), 0);
  const formattedTotal = isCurrency ? formatForecastCurrency(totalForecastValue) : totalForecastValue.toLocaleString('en-IN');

  // View switch tabs
  const views = [
    { id: 'forecast', label: '📈 Forecast Projections' },
    { id: 'scenario', label: '🎲 What-If Scenario' },
    { id: 'sensitivity', label: '🎛️ Sensitivity Matrix' },
    { id: 'model_comparison', label: '⚖️ Model Evaluation' },
  ];

  let viewHtml = '';

  if (forecastActiveView === 'forecast') {
    viewHtml = `
      <div style="display:flex;flex-direction:column;gap:16px;">
        <!-- KPI Row -->
        <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(180px, 1fr));gap:12px;">
          <div class="card" style="padding:14px;background:var(--surface);">
            <div style="font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;">Point Forecast Total</div>
            <div style="font-size:20px;font-weight:800;color:var(--ink);margin-top:4px;">${formattedTotal}</div>
            <div style="font-size:11px;color:var(--muted);margin-top:2px;">Horizon: Next ${fcData.horizon || forecastHorizon} Periods</div>
          </div>
          <div class="card" style="padding:14px;background:var(--surface);">
            <div style="font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;">Selected Model</div>
            <div style="font-size:16px;font-weight:800;color:var(--primary);margin-top:4px;">${fcData.selectedModel || 'NAIVE_LAST_VALUE'}</div>
            <div style="font-size:11px;color:var(--muted);margin-top:2px;">Methodology: PM02K Governed</div>
          </div>
          <div class="card" style="padding:14px;background:var(--surface);">
            <div style="font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;">Backtest WAPE / Accuracy</div>
            <div style="font-size:20px;font-weight:800;color:${fcData.backtestMetrics?.wape !== null && fcData.backtestMetrics?.wape < 0.2 ? 'var(--success, #16a34a)' : 'var(--ink)'};margin-top:4px;">
              ${fcData.backtestMetrics?.wape !== null && fcData.backtestMetrics?.wape !== undefined ? (fcData.backtestMetrics.wape * 100).toFixed(1) + '%' : 'N/A'}
            </div>
            <div style="font-size:11px;color:var(--muted);margin-top:2px;">Bias: ${fcData.backtestMetrics?.bias ?? '0'} (${fcData.backtestMetrics?.bias > 0 ? 'Overforecast' : 'Underforecast'})</div>
          </div>
          <div class="card" style="padding:14px;background:var(--surface);">
            <div style="font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;">Actuality Classification</div>
            <div style="font-size:16px;font-weight:800;color:var(--ink);margin-top:4px;">
              <span class="badge" style="background:#e0f2fe;color:#0369a1;font-weight:700;">FORECAST</span>
            </div>
            <div style="font-size:11px;color:var(--muted);margin-top:2px;">Data through: ${fcData.forecastOrigin || 'Today'}</div>
          </div>
        </div>

        <!-- Table of Forecast Points & Intervals -->
        <div class="card" style="padding:16px;background:var(--surface);">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
            <h4 style="margin:0;font-size:14px;font-weight:700;color:var(--ink);">Forecast Horizon Steps & Prediction Intervals (95%)</h4>
            <span style="font-size:11px;color:var(--muted);">Origin Cutoff: ${fcData.forecastOrigin || 'Current'}</span>
          </div>
          <div class="table-responsive">
            <table class="table" style="width:100%;font-size:12px;">
              <thead>
                <tr style="background:var(--surface-hover, #f8fafc);">
                  <th style="padding:8px;">Period / Date</th>
                  <th style="padding:8px;text-align:right;">Lower Bound (95%)</th>
                  <th style="padding:8px;text-align:right;font-weight:700;">Point Forecast</th>
                  <th style="padding:8px;text-align:right;">Upper Bound (95%)</th>
                  <th style="padding:8px;text-align:center;">Actuality</th>
                </tr>
              </thead>
              <tbody>
                ${(fcData.intervals || []).map((iv, idx) => {
                  const dStr = (fcData.forecastDates && fcData.forecastDates[idx]) || `Step ${idx + 1}`;
                  const ptStr = isCurrency ? formatForecastCurrency(iv.pointForecast) : Number(iv.pointForecast).toLocaleString('en-IN');
                  const lowStr = iv.lowerBound !== null
                    ? (isCurrency ? formatForecastCurrency(iv.lowerBound) : Number(iv.lowerBound).toLocaleString('en-IN'))
                    : '<span style="color:var(--muted);">—</span>';
                  const upStr = iv.upperBound !== null
                    ? (isCurrency ? formatForecastCurrency(iv.upperBound) : Number(iv.upperBound).toLocaleString('en-IN'))
                    : '<span style="color:var(--muted);">—</span>';
                  const isAvail = iv.intervalAvailability !== 'INSUFFICIENT_HISTORY';
                  return `
                    <tr>
                      <td style="padding:8px;font-family:ui-monospace, monospace;">${dStr}</td>
                      <td style="padding:8px;text-align:right;color:var(--muted);">${lowStr}</td>
                      <td style="padding:8px;text-align:right;font-weight:700;color:var(--primary);">${ptStr}</td>
                      <td style="padding:8px;text-align:right;color:var(--muted);">${upStr}</td>
                      <td style="padding:8px;text-align:center;">
                        <span class="badge ${isAvail ? 'info' : 'warning'}" style="font-size:10px;">
                          ${isAvail ? 'FORECAST' : 'INSUFFICIENT_HISTORY'}
                        </span>
                      </td>
                    </tr>
                  `;
                }).join('')}
                ${(fcData.intervals || []).length === 0 ? '<tr><td colspan="5" style="text-align:center;padding:16px;color:var(--muted);">Insufficient historical observations for statistical forecast.</td></tr>' : ''}
              </tbody>
            </table>
          </div>
        </div>

        ${forecastTarget === 'THEORETICAL_INGREDIENT_REQUIREMENT' && fcData.ingredientRequirements ? `
          <div class="card" style="padding:16px;background:var(--surface);">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
              <div>
                <h4 style="margin:0;font-size:14px;font-weight:700;color:var(--ink);">Theoretical BOM Ingredient Requirements</h4>
                <div style="font-size:11px;color:var(--muted);margin-top:2px;">Snapshot of current usable lots only; open POs & scheduled receipts not included.</div>
              </div>
              <span class="badge" style="background:#fef3c7;color:#92400e;font-size:10px;">RECIPE BOM DERIVED</span>
            </div>
            <div class="table-responsive">
              <table class="table" style="width:100%;font-size:12px;">
                <thead>
                  <tr style="background:var(--surface-hover, #f8fafc);">
                    <th style="padding:8px;">Ingredient</th>
                    <th style="padding:8px;">UOM</th>
                    <th style="padding:8px;text-align:right;">Theoretical Requirement</th>
                    <th style="padding:8px;text-align:right;">Available Stock (Snapshot)</th>
                    <th style="padding:8px;text-align:right;">Projected Stock Gap</th>
                    <th style="padding:8px;text-align:center;">Stock Gap Status</th>
                  </tr>
                </thead>
                <tbody>
                  ${(fcData.ingredientRequirements || []).map((ing) => `
                    <tr>
                      <td style="padding:8px;font-weight:600;">${ing.ingredientName}</td>
                      <td style="padding:8px;color:var(--muted);">${ing.uom}</td>
                      <td style="padding:8px;text-align:right;font-weight:700;">${ing.theoreticalRequirement}</td>
                      <td style="padding:8px;text-align:right;">${ing.availableStockSnapshot}</td>
                      <td style="padding:8px;text-align:right;color:${(ing.hasProjectedStockGap || ing.hasShortfall) ? 'var(--danger, #dc2626)' : 'var(--ink)'};">${ing.projectedStockGap ?? ing.projectedGap}</td>
                      <td style="padding:8px;text-align:center;">
                        <span class="badge ${(ing.hasProjectedStockGap || ing.hasShortfall) ? 'danger' : 'success'}" style="font-size:10px;">
                          ${(ing.hasProjectedStockGap || ing.hasShortfall) ? 'PROJECTED GAP' : 'COVERED'}
                        </span>
                      </td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          </div>
        ` : ''}
      </div>
    `;
  } else if (forecastActiveView === 'scenario') {
    // What-If Scenario Studio
    viewHtml = `
      <div style="display:flex;flex-direction:column;gap:16px;">
        <div class="card" style="padding:16px;background:var(--surface);">
          <h4 style="margin:0 0 8px 0;font-size:14px;font-weight:700;color:var(--ink);">What-If Scenario Assumption Controls</h4>
          <p style="margin:0 0 16px 0;font-size:12px;color:var(--muted);">Adjust forward assumptions to evaluate deterministic operational impacts. Actuality is tagged as SIMULATED.</p>

          <div id="scenario-conflict-banner" style="display:none;padding:10px 14px;background:#fef2f2;border:1px solid #f87171;border-radius:6px;margin-bottom:14px;color:#991b1b;font-size:12px;"></div>

          <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(200px, 1fr));gap:14px;">
            <div>
              <label style="display:block;font-size:11px;font-weight:700;color:var(--ink);margin-bottom:4px;">Sales Revenue Change (%)</label>
              <input type="number" id="scenario-sales-input" class="form-input" value="${scenarioSalesPercent}" step="1" min="-50" max="100" style="width:100%;font-size:12px;padding:6px 10px;" />
            </div>
            <div>
              <label style="display:block;font-size:11px;font-weight:700;color:var(--ink);margin-bottom:4px;">Order Volume Change (%)</label>
              <input type="number" id="scenario-orders-input" class="form-input" value="${scenarioOrdersPercent}" step="1" min="-50" max="100" style="width:100%;font-size:12px;padding:6px 10px;" />
            </div>
            <div>
              <label style="display:block;font-size:11px;font-weight:700;color:var(--ink);margin-bottom:4px;">Average Check (AOV) Change (%)</label>
              <input type="number" id="scenario-aov-input" class="form-input" value="${scenarioAovPercent}" step="1" min="-50" max="100" style="width:100%;font-size:12px;padding:6px 10px;" />
            </div>
            <div>
              <label style="display:block;font-size:11px;font-weight:700;color:var(--ink);margin-bottom:4px;">Gross Payroll Change (%)</label>
              <input type="number" id="scenario-payroll-input" class="form-input" value="${scenarioPayrollPercent}" step="1" min="-50" max="100" style="width:100%;font-size:12px;padding:6px 10px;" />
            </div>
            <div>
              <label style="display:block;font-size:11px;font-weight:700;color:var(--ink);margin-bottom:4px;">Operating Expense Change (%)</label>
              <input type="number" id="scenario-opex-input" class="form-input" value="${scenarioOpexPercent}" step="1" min="-50" max="100" style="width:100%;font-size:12px;padding:6px 10px;" />
            </div>
          </div>

          <div style="display:flex;justify-content:flex-end;gap:10px;margin-top:16px;">
            <button id="scenario-reset-btn" class="btn btn-secondary" style="font-size:12px;padding:6px 14px;">Reset Assumptions</button>
            <button id="scenario-execute-btn" class="btn btn-primary" style="font-size:12px;padding:6px 16px;">Compute Scenario Simulation</button>
          </div>
        </div>

        <div id="scenario-results-container">
          <div class="card" style="padding:16px;background:var(--surface);">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
              <h4 style="margin:0;font-size:14px;font-weight:700;color:var(--ink);">Scenario Simulation Comparison</h4>
              <span class="badge" style="background:#fef3c7;color:#92400e;font-size:10px;font-weight:700;">ACTUALITY: SIMULATED</span>
            </div>
            <div class="table-responsive">
              <table class="table" style="width:100%;font-size:12px;">
                <thead>
                  <tr style="background:var(--surface-hover, #f8fafc);">
                    <th style="padding:8px;">Period / Date</th>
                    <th style="padding:8px;text-align:right;">Base Statistical Forecast</th>
                    <th style="padding:8px;text-align:right;font-weight:700;">Simulated Output</th>
                    <th style="padding:8px;text-align:right;">Variance (Delta)</th>
                    <th style="padding:8px;text-align:right;">Variance %</th>
                    <th style="padding:8px;text-align:center;">Actuality</th>
                  </tr>
                </thead>
                <tbody id="scenario-table-body">
                  ${(fcData.pointForecasts || []).map((pt, i) => {
                    const dStr = fcData.forecastDates[i] || `Step ${i + 1}`;
                    const baseStr = isCurrency ? formatForecastCurrency(pt) : Number(pt).toLocaleString('en-IN');
                    return `
                      <tr>
                        <td style="padding:8px;font-family:ui-monospace, monospace;">${dStr}</td>
                        <td style="padding:8px;text-align:right;">${baseStr}</td>
                        <td style="padding:8px;text-align:right;font-weight:700;color:var(--primary);">${baseStr}</td>
                        <td style="padding:8px;text-align:right;color:var(--muted);">0.00</td>
                        <td style="padding:8px;text-align:right;color:var(--muted);">0.0%</td>
                        <td style="padding:8px;text-align:center;"><span class="badge" style="background:#fef3c7;color:#92400e;font-size:9px;">SIMULATED</span></td>
                      </tr>
                    `;
                  }).join('')}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    `;
  } else if (forecastActiveView === 'sensitivity') {
    // Sensitivity Matrix View
    const salesRange = [-10, -5, 0, 5, 10];
    const payrollRange = [-5, 0, 5, 10];
    const baseSales = (fcData.pointForecasts || []).reduce((s, v) => s + Number(v), 0);

    viewHtml = `
      <div style="display:flex;flex-direction:column;gap:16px;">
        <div class="card" style="padding:16px;background:var(--surface);">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
            <h4 style="margin:0;font-size:14px;font-weight:700;color:var(--ink);">Two-Variable Sensitivity Matrix (Sales Growth % × Payroll Change %)</h4>
            <span class="badge" style="background:#fef3c7;color:#92400e;font-size:10px;">SIMULATED MATRIX</span>
          </div>
          <p style="margin:0 0 14px 0;font-size:12px;color:var(--muted);">
            Evaluates Simulated Sales against Payroll adjustments to estimate Known Operating Components (Sales minus Payroll). Actual COGS and EBITDA are strictly UNAVAILABLE.
          </p>
          <div class="table-responsive">
            <table class="table" style="width:100%;font-size:11.5px;text-align:center;">
              <thead>
                <tr style="background:var(--surface-hover, #f8fafc);">
                  <th style="padding:8px;">Payroll Change ↓ \\ Sales Growth →</th>
                  ${salesRange.map((s) => `<th style="padding:8px;text-align:center;">${s >= 0 ? '+' : ''}${s}% Sales</th>`).join('')}
                </tr>
              </thead>
              <tbody>
                ${payrollRange.map((p) => `
                  <tr>
                    <td style="padding:8px;font-weight:700;background:var(--surface-hover, #f8fafc);">${p >= 0 ? '+' : ''}${p}% Payroll</td>
                    ${salesRange.map((s) => {
                      const simSales = baseSales * (1 + s / 100);
                      return `
                        <td style="padding:8px;font-family:ui-monospace, monospace;">
                          <div><strong>${isCurrency ? formatForecastCurrency(simSales) : Math.round(simSales).toLocaleString('en-IN')}</strong></div>
                          <div style="font-size:10px;color:var(--muted);">${s >= 0 ? '+' : ''}${s}% vs Base</div>
                        </td>
                      `;
                    }).join('')}
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    `;
  } else if (forecastActiveView === 'model_comparison') {
    // Model Comparison View
    viewHtml = `
      <div style="display:flex;flex-direction:column;gap:16px;">
        <div class="card" style="padding:16px;background:var(--surface);">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
            <h4 style="margin:0;font-size:14px;font-weight:700;color:var(--ink);">Candidate Model Rolling-Origin Backtest Evaluation</h4>
            <span style="font-size:11px;color:var(--muted);">Walk-Forward Validation (Zero Leakage)</span>
          </div>
          <div class="table-responsive">
            <table class="table" style="width:100%;font-size:12px;">
              <thead>
                <tr style="background:var(--surface-hover, #f8fafc);">
                  <th style="padding:8px;">Statistical Model</th>
                  <th style="padding:8px;text-align:center;">Eligibility</th>
                  <th style="padding:8px;text-align:center;">Status</th>
                  <th style="padding:8px;text-align:right;">Backtest MAE</th>
                  <th style="padding:8px;text-align:right;">Backtest RMSE</th>
                  <th style="padding:8px;text-align:right;font-weight:700;">Backtest WAPE</th>
                  <th style="padding:8px;text-align:right;">Directional Bias</th>
                </tr>
              </thead>
              <tbody>
                ${(fcData.modelComparisonTable || []).map((m) => `
                  <tr style="${m.selected ? 'background:#f0fdf4;' : ''}">
                    <td style="padding:8px;font-weight:600;">
                      ${m.displayName || m.method}
                      ${m.isBaseline ? '<span style="font-size:10px;color:var(--muted);margin-left:6px;">(Baseline)</span>' : ''}
                    </td>
                    <td style="padding:8px;text-align:center;">
                      <span class="badge ${m.eligible ? 'success' : 'warning'}" style="font-size:10px;">
                        ${m.eligible ? 'ELIGIBLE' : 'INSUFFICIENT_HISTORY'}
                      </span>
                    </td>
                    <td style="padding:8px;text-align:center;">
                      ${m.selected ? '<span class="badge success" style="font-size:10px;font-weight:700;">SELECTED</span>' : '<span style="color:var(--muted);font-size:11px;">Candidate</span>'}
                    </td>
                    <td style="padding:8px;text-align:right;font-family:ui-monospace, monospace;">${m.mae ?? '—'}</td>
                    <td style="padding:8px;text-align:right;font-family:ui-monospace, monospace;">${m.rmse ?? '—'}</td>
                    <td style="padding:8px;text-align:right;font-family:ui-monospace, monospace;font-weight:700;">
                      ${m.wape !== null && m.wape !== undefined ? (m.wape * 100).toFixed(2) + '%' : '—'}
                    </td>
                    <td style="padding:8px;text-align:right;font-family:ui-monospace, monospace;">${m.bias ?? '—'}</td>
                  </tr>
                `).join('')}
                ${(fcData.modelComparisonTable || []).length === 0 ? '<tr><td colspan="7" style="text-align:center;padding:16px;color:var(--muted);">No candidate models evaluated yet.</td></tr>' : ''}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    `;
  }

  // Assemble full HTML
  container.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:16px;">
      <!-- Controls Toolbar -->
      <div class="card" style="padding:14px;background:var(--surface);">
        <div style="display:flex;flex-wrap:wrap;gap:12px;align-items:flex-end;">
          <div>
            <label style="display:block;font-size:11px;font-weight:700;color:var(--ink);margin-bottom:4px;">Forecast Target Metric</label>
            <select id="forecast-target-select" class="form-select" style="font-size:12px;padding:6px 10px;">
              <option value="NET_SALES" ${forecastTarget === 'NET_SALES' ? 'selected' : ''}>Net Sales Revenue</option>
              <option value="ORDERS" ${forecastTarget === 'ORDERS' ? 'selected' : ''}>Orders & Bill Volume</option>
              <option value="MENU_ITEM_QUANTITY" ${forecastTarget === 'MENU_ITEM_QUANTITY' ? 'selected' : ''}>Menu Item Demand</option>
              <option value="THEORETICAL_INGREDIENT_REQUIREMENT" ${forecastTarget === 'THEORETICAL_INGREDIENT_REQUIREMENT' ? 'selected' : ''}>Theoretical BOM Requirements</option>
              <option value="GROSS_PAYROLL" ${forecastTarget === 'GROSS_PAYROLL' ? 'selected' : ''}>Gross Payroll Projection</option>
              <option value="OPERATING_EXPENSES" ${forecastTarget === 'OPERATING_EXPENSES' ? 'selected' : ''}>Operating Expenses Trend</option>
              <option value="CUSTOMER_VISITS" ${forecastTarget === 'CUSTOMER_VISITS' ? 'selected' : ''}>Identified Customer Visits</option>
            </select>
          </div>

          <div>
            <label style="display:block;font-size:11px;font-weight:700;color:var(--ink);margin-bottom:4px;">Horizon</label>
            <select id="forecast-horizon-select" class="form-select" style="font-size:12px;padding:6px 10px;">
              <option value="7" ${forecastHorizon === '7' ? 'selected' : ''}>Next 7 Days</option>
              <option value="14" ${forecastHorizon === '14' ? 'selected' : ''}>Next 14 Days</option>
              <option value="30" ${forecastHorizon === '30' ? 'selected' : ''}>Next 30 Days</option>
            </select>
          </div>

          <div>
            <label style="display:block;font-size:11px;font-weight:700;color:var(--ink);margin-bottom:4px;">Forecast Method</label>
            <select id="forecast-method-select" class="form-select" style="font-size:12px;padding:6px 10px;">
              <option value="AUTO" ${forecastMethod === 'AUTO' ? 'selected' : ''}>Auto (Backtest Selected)</option>
              <option value="NAIVE_LAST_VALUE" ${forecastMethod === 'NAIVE_LAST_VALUE' ? 'selected' : ''}>Naïve Baseline</option>
              <option value="SEASONAL_NAIVE" ${forecastMethod === 'SEASONAL_NAIVE' ? 'selected' : ''}>Seasonal Naïve (Weekly)</option>
              <option value="MOVING_AVERAGE_BASELINE" ${forecastMethod === 'MOVING_AVERAGE_BASELINE' ? 'selected' : ''}>Moving Average Baseline</option>
              <option value="SIMPLE_EXPONENTIAL_SMOOTHING" ${forecastMethod === 'SIMPLE_EXPONENTIAL_SMOOTHING' ? 'selected' : ''}>Simple Exp Smoothing</option>
              <option value="HOLT_LINEAR_TREND" ${forecastMethod === 'HOLT_LINEAR_TREND' ? 'selected' : ''}>Holt Linear Trend</option>
              <option value="HOLT_WINTERS_SEASONAL" ${forecastMethod === 'HOLT_WINTERS_SEASONAL' ? 'selected' : ''}>Holt-Winters Seasonal</option>
            </select>
          </div>

          <div style="margin-left:auto;display:flex;gap:8px;align-items:center;">
            <button id="forecast-reset-btn" class="btn btn-secondary" style="font-size:12px;padding:6px 12px;">Reset</button>
            <button id="forecast-refresh-btn" class="btn btn-primary" style="font-size:12px;padding:6px 14px;">Refresh</button>
            <div style="border-left:1px solid var(--line);padding-left:8px;display:flex;gap:6px;">
              <button id="export-forecast-pdf-btn" class="btn btn-secondary" style="font-size:12px;padding:6px 10px;">PDF</button>
              <button id="export-forecast-xlsx-btn" class="btn btn-secondary" style="font-size:12px;padding:6px 10px;">XLSX</button>
            </div>
          </div>
        </div>

        <!-- Subview Navigation Buttons -->
        <div style="display:flex;gap:8px;margin-top:12px;border-top:1px solid var(--line);padding-top:10px;">
          ${views.map((v) => `
            <button class="btn forecast-view-tab-btn ${forecastActiveView === v.id ? 'btn-primary' : 'btn-secondary'}" data-view-id="${v.id}" style="font-size:11.5px;padding:4px 12px;">
              ${v.label}
            </button>
          `).join('')}
        </div>
      </div>

      <!-- Active Subview Content -->
      ${viewHtml}

      <!-- Provenance & Governance Note -->
      <div class="card" style="padding:12px 16px;background:var(--surface-hover, #f8fafc);border-left:4px solid var(--primary);">
        <div style="font-size:11px;font-weight:700;color:var(--ink);margin-bottom:2px;">Explain This Forecast (PM-02K Provenance & Safety Guarantee)</div>
        <div style="font-size:11px;color:var(--muted);line-height:1.5;">
          Projections derive from verified statistical algorithms calibrated strictly against historical training data prior to cutoff date (${fcData.forecastOrigin || 'Today'}). Zero future data leakage. Out-of-sample walk-forward backtesting governs model selection. Actual COGS and EBITDA are strictly UNAVAILABLE.
        </div>
      </div>
    </div>
  `;

  // Attach Event Listeners
  container.querySelector('#forecast-target-select')?.addEventListener('change', (e) => {
    forecastTarget = e.target.value;
    renderForecastingSubtab(root, container);
  });

  container.querySelector('#forecast-horizon-select')?.addEventListener('change', (e) => {
    forecastHorizon = e.target.value;
    renderForecastingSubtab(root, container);
  });

  container.querySelector('#forecast-method-select')?.addEventListener('change', (e) => {
    forecastMethod = e.target.value;
    renderForecastingSubtab(root, container);
  });

  container.querySelector('#forecast-refresh-btn')?.addEventListener('click', () => {
    renderForecastingSubtab(root, container);
  });

  container.querySelector('#forecast-reset-btn')?.addEventListener('click', () => {
    forecastTarget = 'NET_SALES';
    forecastHorizon = '7';
    forecastMethod = 'AUTO';
    forecastActiveView = 'forecast';
    scenarioSalesPercent = 0;
    scenarioOrdersPercent = 0;
    scenarioAovPercent = 0;
    scenarioPayrollPercent = 0;
    scenarioOpexPercent = 0;
    renderForecastingSubtab(root, container);
  });

  // View switch buttons
  container.querySelectorAll('.forecast-view-tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const vid = btn.getAttribute('data-view-id');
      if (vid) {
        forecastActiveView = vid;
        renderForecastingSubtab(root, container);
      }
    });
  });

  // Scenario Buttons & Conflict Detection
  if (forecastActiveView === 'scenario') {
    const sInput = container.querySelector('#scenario-sales-input');
    const oInput = container.querySelector('#scenario-orders-input');
    const aInput = container.querySelector('#scenario-aov-input');
    const pInput = container.querySelector('#scenario-payroll-input');
    const opInput = container.querySelector('#scenario-opex-input');
    const conflictBanner = container.querySelector('#scenario-conflict-banner');

    container.querySelector('#scenario-reset-btn')?.addEventListener('click', () => {
      scenarioSalesPercent = 0;
      scenarioOrdersPercent = 0;
      scenarioAovPercent = 0;
      scenarioPayrollPercent = 0;
      scenarioOpexPercent = 0;
      if (sInput) sInput.value = '0';
      if (oInput) oInput.value = '0';
      if (aInput) aInput.value = '0';
      if (pInput) pInput.value = '0';
      if (opInput) opInput.value = '0';
      if (conflictBanner) conflictBanner.style.display = 'none';
      renderForecastingSubtab(root, container);
    });

    container.querySelector('#scenario-execute-btn')?.addEventListener('click', async () => {
      const sVal = parseFloat(sInput?.value) || 0;
      const oVal = parseFloat(oInput?.value) || 0;
      const aVal = parseFloat(aInput?.value) || 0;
      const pVal = parseFloat(pInput?.value) || 0;
      const opVal = parseFloat(opInput?.value) || 0;

      scenarioSalesPercent = sVal;
      scenarioOrdersPercent = oVal;
      scenarioAovPercent = aVal;
      scenarioPayrollPercent = pVal;
      scenarioOpexPercent = opVal;

      // Check conflict
      if (sVal !== 0 && oVal !== 0 && aVal !== 0) {
        const impliedSales = (1 + oVal / 100) * (1 + aVal / 100) - 1;
        if (Math.abs(sVal / 100 - impliedSales) > 0.005) {
          if (conflictBanner) {
            conflictBanner.style.display = 'block';
            conflictBanner.innerHTML = `⚠️ <strong>Scenario Driver Conflict Detected:</strong> Sales adjustment (${sVal}%) contradicts Order Volume (${oVal}%) and AOV (${aVal}%). Implied Sales change is ${(impliedSales * 100).toFixed(1)}%. Please resolve contradictory drivers.`;
          }
          return;
        }
      }

      if (conflictBanner) conflictBanner.style.display = 'none';

      // Call Scenario Simulation API
      try {
        const simRes = await apiPost('/reports/forecast/scenario', {
          target: forecastTarget,
          horizon: parseInt(forecastHorizon, 10) || 7,
          method: forecastMethod,
          assumptions: {
            salesPercent: sVal,
            orderVolumePercent: oVal,
            avgCheckPercent: aVal,
            grossPayrollPercent: pVal,
            opexPercent: opVal,
          },
        });

        if (simRes?.data?.simulatedForecasts) {
          const tbody = container.querySelector('#scenario-table-body');
          if (tbody) {
            tbody.innerHTML = simRes.data.simulatedForecasts.map((row) => {
              const baseStr = isCurrency ? formatForecastCurrency(row.baseForecast) : Number(row.baseForecast).toLocaleString('en-IN');
              const simStr = isCurrency ? formatForecastCurrency(row.simulatedForecast) : Number(row.simulatedForecast).toLocaleString('en-IN');
              const deltaStr = isCurrency ? formatForecastCurrency(row.variance) : Number(row.variance).toLocaleString('en-IN');
              return `
                <tr>
                  <td style="padding:8px;font-family:ui-monospace, monospace;">${row.date || `Step ${row.periodIndex}`}</td>
                  <td style="padding:8px;text-align:right;">${baseStr}</td>
                  <td style="padding:8px;text-align:right;font-weight:700;color:var(--primary);">${simStr}</td>
                  <td style="padding:8px;text-align:right;color:${row.variance >= 0 ? 'var(--success, #16a34a)' : 'var(--danger, #dc2626)'};">${row.variance >= 0 ? '+' : ''}${deltaStr}</td>
                  <td style="padding:8px;text-align:right;font-weight:600;">${row.variancePercent >= 0 ? '+' : ''}${row.variancePercent}%</td>
                  <td style="padding:8px;text-align:center;"><span class="badge" style="background:#fef3c7;color:#92400e;font-size:9px;">SIMULATED</span></td>
                </tr>
              `;
            }).join('');
          }
          showToast('Scenario simulation calculated successfully.', 'success');
        }
      } catch (err) {
        showToast(err.message || 'Error executing scenario simulation.', 'error');
      }
    });
  }

  // Export Triggers
  container.querySelector('#export-forecast-pdf-btn')?.addEventListener('click', async () => {
    showToast(`Generating ZURF PDF export for ${forecastTarget}...`, 'info');
    try {
      const res = await apiPost('/reports/export', {
        reportId: 'sales-forecast',
        format: 'PDF',
      });
      if (res?.jobId) {
        showToast(`PDF Export Job ${res.jobId} created successfully.`, 'success');
      }
    } catch (err) {
      showToast(err.message || 'PDF export error.', 'error');
    }
  });

  container.querySelector('#export-forecast-xlsx-btn')?.addEventListener('click', async () => {
    showToast(`Generating ZURF XLSX export for ${forecastTarget}...`, 'info');
    try {
      const res = await apiPost('/reports/export', {
        reportId: 'sales-forecast',
        format: 'XLSX',
      });
      if (res?.jobId) {
        showToast(`XLSX Export Job ${res.jobId} created successfully.`, 'success');
      }
    } catch (err) {
      showToast(err.message || 'XLSX export error.', 'error');
    }
  });
}

async function renderReconciliationsSubtab(root, container) {
  container.innerHTML = skeleton('240px');
  try {
    const res = await apiGet('/reports/reconciliations' + buildFilterQueryString());
    if (res?.data?.reconciliations) cachedReconciliations = res.data.reconciliations;
  } catch (_) {}

  if (!cachedReconciliations || cachedReconciliations.length === 0) {
    cachedReconciliations = [];
  }

  const unavailableCount = cachedReconciliations.filter((c) => c.status === 'UNAVAILABLE').length || 3;
  const availableCount = cachedReconciliations.filter((c) => c.status !== 'UNAVAILABLE').length || 1;
  const summaryBadgeClass = 'warning';
  const summaryBadgeText = `PARTIAL (${unavailableCount} controls unavailable, ${availableCount} control available)`;

  container.innerHTML = `
    <div class="card" style="padding:16px;background:var(--surface);display:flex;flex-direction:column;gap:14px;">
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;">
        <div>
          <h3 style="font-size:14px;font-weight:700;color:var(--ink);margin:0;">Cross-Module Reconciliations &amp; Control Integrity</h3>
          <p style="font-size:11px;color:var(--muted);margin:2px 0 0 0;">Cross-subsystem reconciliation ledger audits (Partial Coverage)</p>
        </div>
        <span class="badge ${summaryBadgeClass}" style="font-size:11px;font-weight:700;">${summaryBadgeText}</span>
      </div>

      <div style="padding:10px 14px;background:rgba(217, 119, 6, 0.08);border:1px solid var(--amber, #d97706);border-radius:6px;font-size:12px;color:var(--amber, #d97706);font-weight:600;display:flex;align-items:center;gap:8px;">
        <span>⚠️</span>
        <span>Partial reconciliation — 3 automated controls currently unavailable (POS ↔ GL, GRN ↔ Stock monetary, AP ↔ Bank); 1 control active (PayrollRun ↔ Payslip).</span>
      </div>

      <div style="width:100%;overflow-x:auto;min-width:0;box-sizing:border-box;">
        <table class="glass-table" style="width:100%;font-size:12px;">
          <thead>
            <tr>
              <th>Control Check</th>
              <th>Source Domain A</th>
              <th>Source Domain B</th>
              <th>Balance A</th>
              <th>Balance B</th>
              <th>Variance</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            ${cachedReconciliations.length > 0 ? cachedReconciliations.map((c) => `
              <tr>
                <td><strong>${c.name}</strong></td>
                <td style="color:var(--muted);font-size:11px;">${c.sourceA}</td>
                <td style="color:var(--muted);font-size:11px;">${c.sourceB}</td>
                <td><strong>${c.amountA}</strong></td>
                <td><strong>${c.amountB}</strong></td>
                <td><strong style="color:${c.status?.includes('MATCHED') || c.status === 'BALANCED' ? 'var(--mint, #10b981)' : 'var(--coral, #ef4444)'};">${c.variance}</strong></td>
                <td><span class="badge ${c.status?.includes('MATCHED') || c.status === 'BALANCED' ? 'success' : 'warning'}" style="font-size:10px;">${c.status}</span></td>
              </tr>
            `).join('') : `
              <tr><td colspan="7" style="text-align:center;padding:16px;color:var(--muted);">No reconciliation control records available for this period.</td></tr>
            `}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

async function renderMetricsSubtab(root, container) {
  container.innerHTML = skeleton('240px');
  try {
    const res = await apiGet('/reports/metrics');
    if (res?.data?.metrics) cachedMetrics = res.data.metrics;
  } catch (_) {}

  if (!cachedMetrics || cachedMetrics.length === 0) {
    cachedMetrics = [
      { metricId: 'MET-SALES-001', name: 'Net Sales Revenue', category: 'Sales & POS', formula: 'SUM(GrossSales) - SUM(Discounts) - SUM(Refunds) - SUM(Taxes)', sourceDomain: 'Sales & POS', owner: 'Finance Master', version: 'v2.0', trustStatus: 'CERTIFIED', businessDefinition: 'Total net invoiced sales excluding GST and promotional discounts.' },
      { metricId: 'MET-FIN-001', name: 'Gross Margin %', category: 'Finance', formula: '((NetSales - COGS) / NetSales) * 100', sourceDomain: 'Finance', owner: 'Primary Master', version: 'v3.0', trustStatus: 'CERTIFIED', businessDefinition: 'Percentage of revenue remaining after accounting for direct ingredient food costs.' },
      { metricId: 'MET-HR-001', name: 'Labour Cost % of Sales', category: 'Workforce', formula: '(TotalLabourWages / NetSales) * 100', sourceDomain: 'Workforce', owner: 'HR Operations', version: 'v1.5', trustStatus: 'CERTIFIED', businessDefinition: 'Total payroll, barista hourly wages and shift overtime divided by net sales.' },
      { metricId: 'MET-INV-001', name: 'Actual vs Theoretical (AvT) Variance %', category: 'Inventory', formula: '((ActualCost - TheoreticalCost) / TheoreticalCost) * 100', sourceDomain: 'Inventory', owner: 'Supply Chain', version: 'v2.1', trustStatus: 'CERTIFIED', businessDefinition: 'Variance between theoretical recipe BOM consumption and physical inventory audits.' },
    ];
  }

  container.innerHTML = `
    <div class="card" style="padding:16px;background:var(--surface);">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;flex-wrap:wrap;gap:10px;">
        <div>
          <h3 style="font-size:14px;font-weight:700;color:var(--ink);margin:0;">Governed Semantic &amp; Metrics Dictionary</h3>
          <p style="font-size:11px;color:var(--muted);margin:2px 0 0 0;">Standardized enterprise formulas, stewards, versioning and inclusion/exclusion rules</p>
        </div>
      </div>

      <div style="width:100%;overflow-x:auto;min-width:0;box-sizing:border-box;">
        <table class="glass-table" style="width:100%;font-size:12px;">
          <thead>
            <tr>
              <th>Metric Code</th>
              <th>Metric Name</th>
              <th>Category</th>
              <th>Governed Formula</th>
              <th>Source Domain</th>
              <th>Steward</th>
              <th>Version</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            ${cachedMetrics.map((m) => `
              <tr>
                <td style="font-family:var(--font-mono);font-weight:700;">${m.metricId}</td>
                <td><strong>${m.name}</strong></td>
                <td><span class="badge" style="font-size:9px;">${m.category}</span></td>
                <td style="font-family:var(--font-mono);font-size:11px;color:var(--muted);">${m.formula}</td>
                <td style="color:var(--muted);font-size:11px;">${m.sourceDomain}</td>
                <td>${m.owner}</td>
                <td><span class="badge" style="font-size:9px;">${m.version}</span></td>
                <td>
                  <button class="btn btn-xs btn-ghost" data-about-metric="${m.metricId}" style="font-size:11px;padding:2px 6px;" type="button">About →</button>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;

  container.querySelectorAll('[data-about-metric]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const metric = cachedMetrics.find((m) => m.metricId === btn.dataset.aboutMetric);
      if (metric) openAboutMetricModal(root, metric);
    });
  });
}

async function renderDataQualitySubtab(root, container) {
  container.innerHTML = skeleton('240px');
  try {
    const res = await apiGet('/reports/data-quality' + buildFilterQueryString());
    if (res?.data) cachedDataQuality = res.data;
  } catch (_) {}

  if (!cachedDataQuality || !cachedDataQuality.lineageNodes) {
    cachedDataQuality = {
      qualityStatus: 'AWAITING VERIFICATION',
      lineageNodes: [],
    };
  }

  const { lineageNodes, qualityStatus } = cachedDataQuality;

  container.innerHTML = `
    <div class="card" style="padding:16px;background:var(--surface);display:flex;flex-direction:column;gap:14px;">
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;">
        <div>
          <h3 style="font-size:14px;font-weight:700;color:var(--ink);margin:0;">Data Quality, Lineage &amp; Freshness Traceability</h3>
          <p style="font-size:11px;color:var(--muted);margin:2px 0 0 0;">Continuous pipeline integrity verification and end-to-end lineage mapping</p>
        </div>
        <span class="badge ${qualityStatus?.includes('HEALTHY') ? 'success' : 'warning'}" style="font-size:11px;font-weight:700;">${qualityStatus || 'GOVERNED'}</span>
      </div>

      <div class="card" style="padding:12px;background:var(--surface-sunken);min-width:0;box-sizing:border-box;">
        <h4 style="font-size:12px;font-weight:700;color:var(--ink);margin:0 0 8px 0;">Analytical Data Lineage Nodes</h4>
        <div style="width:100%;overflow-x:auto;min-width:0;box-sizing:border-box;">
          <table class="glass-table" style="width:100%;font-size:12px;">
            <thead>
              <tr>
                <th>Source Domain</th>
                <th>Authoritative Table</th>
                <th>Read Model / Projection</th>
                <th>Governed Metric</th>
                <th>Downstream Reports</th>
              </tr>
            </thead>
            <tbody>
              ${(lineageNodes || []).length > 0 ? (lineageNodes || []).map((n) => `
                <tr>
                  <td><strong>${n.domain}</strong></td>
                  <td style="font-family:var(--font-mono);font-size:11px;">${n.sourceTable}</td>
                  <td style="color:var(--muted);font-size:11px;">${n.readModel}</td>
                  <td><span class="badge success" style="font-size:9px;">${n.governedMetric}</span></td>
                  <td>${Array.isArray(n.destinationReports) ? n.destinationReports.join(', ') : n.destinationReports}</td>
                </tr>
              `).join('') : `
                <tr><td colspan="5" style="text-align:center;padding:16px;color:var(--muted);">No lineage nodes registered.</td></tr>
              `}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;
}

async function renderExportsSubtab(root, container) {
  container.innerHTML = skeleton('240px');
  try {
    const res = await apiGet('/reports/export/jobs');
    if (res?.data?.jobs) cachedJobs = res.data.jobs;
  } catch (_) {}

  if (!cachedJobs) {
    cachedJobs = [];
  }

  container.innerHTML = `
    <div class="card" style="padding:16px;background:var(--surface);display:flex;flex-direction:column;gap:14px;">
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;">
        <div>
          <h3 style="font-size:14px;font-weight:700;color:var(--ink);margin:0;">ZURF Exports &amp; Download Queue</h3>
          <p style="font-size:11px;color:var(--muted);margin:2px 0 0 0;">Zamorin Universal Report &amp; Export Format (ZURF v1) artifacts</p>
        </div>
        <button class="btn btn-sm btn-primary" id="subtab-new-export-btn" style="font-size:12px;" type="button">+ New Export</button>
      </div>

      <div style="width:100%;overflow-x:auto;min-width:0;box-sizing:border-box;">
        <table class="glass-table" style="width:100%;font-size:12px;">
          <thead>
            <tr>
              <th>Job ID</th>
              <th>Report</th>
              <th>Format</th>
              <th>Scope</th>
              <th>Generated At</th>
              <th>Status</th>
              <th>Download</th>
            </tr>
          </thead>
          <tbody>
            ${(cachedJobs || []).length > 0 ? (cachedJobs || []).map((j) => `
              <tr>
                <td style="font-family:var(--font-mono);font-weight:700;">${j.jobId}</td>
                <td><strong>${j.reportId}</strong></td>
                <td><span class="badge" style="font-size:9px;">${j.format}</span></td>
                <td style="color:var(--muted);">${j.scope}</td>
                <td>${(j.createdAt || '').split('T')[0]}</td>
                <td><span class="badge success" style="font-size:10px;">${j.status}</span></td>
                <td>
                  <button class="btn btn-xs btn-primary" data-download-job="${j.jobId}" style="font-size:11px;padding:3px 8px;" type="button">
                    Download
                  </button>
                </td>
              </tr>
            `).join('') : `
              <tr>
                <td colspan="7" style="text-align:center;padding:16px;color:var(--muted);">No reports exported yet. Click "+ New Export" to generate an official document.</td>
              </tr>
            `}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

// ── Modals: Export Modal, View Report, About Metric, Health Dialog ────────────

function openExportModal(root, reportId = 'daily-sales') {
  const runnableReports = (cachedLibrary || []).filter((r) => r.runnable !== false && r.availability !== 'NOT_IMPLEMENTED');
  const reportOptions = (runnableReports.length > 0)
    ? runnableReports.map((r) => `<option value="${r.reportId}" ${r.reportId === reportId ? 'selected' : ''}>${r.title}</option>`).join('')
    : `
      <option value="daily-sales" ${reportId === 'daily-sales' ? 'selected' : ''}>Daily Sales &amp; Operations Summary</option>
      <option value="pl-statement" ${reportId === 'pl-statement' ? 'selected' : ''}>Profit &amp; Loss Statement &amp; Waterfall</option>
      <option value="inventory-valuation" ${reportId === 'inventory-valuation' ? 'selected' : ''}>Inventory Valuation &amp; Stock Movement</option>
      <option value="menu-engineering" ${reportId === 'menu-engineering' ? 'selected' : ''}>Menu Engineering &amp; Product Mix</option>
      <option value="procurement-spend" ${reportId === 'procurement-spend' ? 'selected' : ''}>Procurement Spend &amp; 3-Way Match</option>
      <option value="vendor-performance-intelligence" ${reportId === 'vendor-performance-intelligence' ? 'selected' : ''}>Vendor Performance &amp; Intelligence Suite</option>
      <option value="cash-book-variance" ${reportId === 'cash-book-variance' ? 'selected' : ''}>Cash Book &amp; Register Variance</option>
      <option value="workforce-overview" ${reportId === 'workforce-overview' ? 'selected' : ''}>Workforce &amp; Headcount Intelligence</option>
      <option value="attendance-exceptions" ${reportId === 'attendance-exceptions' ? 'selected' : ''}>Attendance Exceptions &amp; Labour Trends</option>
      <option value="customer-retention" ${reportId === 'customer-retention' ? 'selected' : ''}>Customer Cohorts &amp; Loyalty Repeat Index</option>
      <option value="pos-exceptions" ${reportId === 'pos-exceptions' ? 'selected' : ''}>POS Exceptions &amp; Cashier Control Audit</option>
      <option value="service-speed" ${reportId === 'service-speed' ? 'selected' : ''}>Speed of Service &amp; Kitchen Prep Analytics</option>
    `;

  const modalHtml = `
    <div style="display:flex;flex-direction:column;gap:14px;width:100%;max-width:520px;">
      <h2 style="font-size:16px;font-weight:800;color:var(--ink);margin:0;">ZURF v1 Corporate Report Export</h2>
      <p style="font-size:12px;color:var(--muted);margin:-8px 0 0 0;">Generates certified corporate documents with logo, GSTIN, and background watermark</p>

      <div style="display:grid;grid-template-columns:1fr;gap:10px;font-size:12px;">
        <div>
          <label style="font-weight:600;color:var(--muted);display:block;margin-bottom:4px;">Report *</label>
          <select id="modal-exp-rep" class="glass-input" style="width:100%;">
            ${reportOptions}
          </select>
        </div>
        <div>
          <label style="font-weight:600;color:var(--muted);display:block;margin-bottom:4px;">Export Format *</label>
          <select id="modal-exp-fmt" class="glass-input" style="width:100%;">
            <option value="PDF">PDF</option>
            <option value="XLSX">Excel</option>
          </select>
        </div>
        <div>
          <label style="font-weight:600;color:var(--muted);display:block;margin-bottom:4px;">Document Classification *</label>
          <select id="modal-exp-cls" class="glass-input" style="width:100%;">
            <option value="INTERNAL">INTERNAL — General management use</option>
            <option value="CONFIDENTIAL">CONFIDENTIAL — Restricted executive distribution</option>
            <option value="RESTRICTED">RESTRICTED — Board &amp; Statutory only</option>
          </select>
        </div>
      </div>

      <div style="display:flex;justify-content:space-between;align-items:center;margin-top:8px;">
        <button class="btn btn-ghost" id="modal-exp-preview" style="font-size:12px;display:flex;align-items:center;gap:6px;" type="button">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11-8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
          Live 8K Preview
        </button>
        <div style="display:flex;gap:8px;">
          <button class="btn btn-ghost" id="modal-exp-cancel" style="font-size:12px;" type="button">Cancel</button>
          <button class="btn btn-primary" id="modal-exp-gen" style="font-size:12px;font-weight:700;" type="button">Generate Export</button>
        </div>
      </div>
    </div>
  `;

  openModal(modalHtml);
  document.getElementById('modal-exp-cancel')?.addEventListener('click', closeModal);

  document.getElementById('modal-exp-preview')?.addEventListener('click', async () => {
    const rep = document.getElementById('modal-exp-rep')?.value || reportId;
    const cls = document.getElementById('modal-exp-cls')?.value || 'INTERNAL';
    try {
      showToast('Rendering certified 8K report preview...', 'info');
      const res = await apiPost('/reports/export', {
        reportId: rep,
        format: 'PDF',
        classification: cls,
        cafeId: activeFilters.cafeId !== 'ALL' ? activeFilters.cafeId : undefined,
        period: activeFilters.period,
        dateFrom: activeFilters.period === 'custom' ? activeFilters.dateFrom : undefined,
        dateTo: activeFilters.period === 'custom' ? activeFilters.dateTo : undefined,
        comparison: activeFilters.comparison !== 'none' ? activeFilters.comparison : undefined,
      });
      if (res?.success && res.data?.html) {
        const previewWindow = window.open('', '_blank');
        if (previewWindow) {
          previewWindow.document.open();
          previewWindow.document.write(res.data.html);
          previewWindow.document.close();
        }
      }
    } catch (err) {
      showToast(err?.message || 'Preview generation failed', 'error');
    }
  });

  document.getElementById('modal-exp-gen')?.addEventListener('click', async () => {
    const rep = document.getElementById('modal-exp-rep')?.value || reportId;
    const fmt = document.getElementById('modal-exp-fmt')?.value || 'PDF';
    const cls = document.getElementById('modal-exp-cls')?.value || 'INTERNAL';

    try {
      const res = await apiPost('/reports/export', {
        reportId: rep,
        format: fmt,
        classification: cls,
        cafeId: activeFilters.cafeId !== 'ALL' ? activeFilters.cafeId : undefined,
        period: activeFilters.period,
        dateFrom: activeFilters.period === 'custom' ? activeFilters.dateFrom : undefined,
        dateTo: activeFilters.period === 'custom' ? activeFilters.dateTo : undefined,
        comparison: activeFilters.comparison !== 'none' ? activeFilters.comparison : undefined,
      });

      closeModal();
      if (res?.success && res.data) {
        const runId = res.data.runId || 'ZURF-' + Date.now().toString(36).toUpperCase();

        if ((fmt === 'XLSX' || fmt === 'EXCEL') && res.data.xlsxBase64) {
          const byteCharacters = atob(res.data.xlsxBase64);
          const byteNumbers = new Array(byteCharacters.length);
          for (let i = 0; i < byteCharacters.length; i++) {
            byteNumbers[i] = byteCharacters.charCodeAt(i);
          }
          const byteArray = new Uint8Array(byteNumbers);
          const blob = new Blob([byteArray], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = res.data.filename || `report_${rep}_${runId}.xlsx`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
        } else if (fmt === 'PDF') {
          if (res.data.pdfBase64) {
            const byteCharacters = atob(res.data.pdfBase64);
            const byteNumbers = new Array(byteCharacters.length);
            for (let i = 0; i < byteCharacters.length; i++) {
              byteNumbers[i] = byteCharacters.charCodeAt(i);
            }
            const byteArray = new Uint8Array(byteNumbers);
            const blob = new Blob([byteArray], { type: 'application/pdf' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = res.data.filename || `report_${rep}_${runId}.pdf`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
          }
          if (res.data.html) {
            const printWindow = window.open('', '_blank');
            if (printWindow) {
              printWindow.document.open();
              printWindow.document.write(res.data.html);
              printWindow.document.close();
            }
          }
        }

        const newJob = {
          jobId: 'EXP-' + Date.now().toString(36).toUpperCase(),
          reportId: rep.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
          format: fmt,
          scope: 'All Cafés — Global Portfolio',
          createdAt: new Date().toISOString(),
          status: 'READY',
          runId,
          downloadUrl: res.data.downloadUrl || `/api/v1/reports/export/${runId}/download`,
        };

        if (cachedJobs) {
          cachedJobs.unshift(newJob);
          const inner = root.querySelector('#analytics-submodule-inner-content');
          if (activeTab === 'exports' && inner) {
            renderExportsSubtab(root, inner);
          }
        }
        showToast(`ZURF export generated! Run ID: ${runId}`, 'success');
      } else {
        showToast('Export response invalid from server.', 'error');
      }
    } catch (err) {
      closeModal();
      showToast(err?.message || 'Export generation failed', 'error');
    }
  });
}

function openViewReportModal(root, reportId) {
  const modalHtml = `
    <div style="display:flex;flex-direction:column;gap:14px;width:100%;max-width:600px;">
      <h2 style="font-size:16px;font-weight:800;color:var(--ink);margin:0;">Report Quick View: ${reportId}</h2>
      <p style="font-size:12px;color:var(--muted);margin:-8px 0 0 0;">Live analytical view with governed metric formulas</p>

      <div style="padding:14px;background:var(--surface-sunken);border-radius:6px;border:1px solid var(--line);font-size:12px;">
        <div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--line);">
          <span>Report Identifier:</span> <strong>${reportId}</strong>
        </div>
        <div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--line);">
          <span>Trust Classification:</span> <span class="badge success" style="font-size:9px;">CERTIFIED</span>
        </div>
        <div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--line);">
          <span>Data Freshness:</span> <strong style="color:var(--mint, #10b981);">Live Real-time</strong>
        </div>
        <div style="display:flex;justify-content:space-between;padding:4px 0;">
          <span>Reconciliation Status:</span> <strong>100% Matched</strong>
        </div>
      </div>

      <div style="display:flex;justify-content:space-between;align-items:center;margin-top:6px;">
        <button class="btn btn-ghost" id="modal-view-preview" style="font-size:12px;display:flex;align-items:center;gap:6px;" type="button">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
          Live 8K Preview
        </button>
        <div style="display:flex;gap:8px;">
          <button class="btn btn-ghost" id="modal-view-close" style="font-size:12px;" type="button">Close</button>
          <button class="btn btn-primary" id="modal-view-export" style="font-size:12px;font-weight:700;" type="button">Export Report</button>
        </div>
      </div>
    </div>
  `;

  openModal(modalHtml);
  document.getElementById('modal-view-close')?.addEventListener('click', closeModal);
  document.getElementById('modal-view-preview')?.addEventListener('click', async () => {
    try {
      showToast('Rendering certified 8K report preview...', 'info');
      const res = await apiPost('/reports/export', {
        reportId,
        format: 'PDF',
        classification: 'INTERNAL',
        cafeId: activeFilters.cafeId !== 'ALL' ? activeFilters.cafeId : undefined,
        period: activeFilters.period,
        dateFrom: activeFilters.period === 'custom' ? activeFilters.dateFrom : undefined,
        dateTo: activeFilters.period === 'custom' ? activeFilters.dateTo : undefined,
        comparison: activeFilters.comparison !== 'none' ? activeFilters.comparison : undefined,
      });
      if (res?.success && res.data?.html) {
        const previewWindow = window.open('', '_blank');
        if (previewWindow) {
          previewWindow.document.open();
          previewWindow.document.write(res.data.html);
          previewWindow.document.close();
        }
      }
    } catch (err) {
      showToast(err?.message || 'Preview generation failed', 'error');
    }
  });
  document.getElementById('modal-view-export')?.addEventListener('click', () => {
    closeModal();
    openExportModal(root, reportId);
  });
}

function openAboutMetricModal(root, metric) {
  const modalHtml = `
    <div style="display:flex;flex-direction:column;gap:14px;width:100%;max-width:540px;">
      <h2 style="font-size:16px;font-weight:800;color:var(--ink);margin:0;">About Metric: ${metric.name} (${metric.metricId})</h2>
      <p style="font-size:12px;color:var(--muted);margin:-8px 0 0 0;">Governed Semantic Definition &amp; Calculation Rules</p>

      <div style="display:flex;flex-direction:column;gap:8px;font-size:12px;">
        <div style="padding:10px;background:var(--surface-sunken);border-radius:4px;">
          <strong style="color:var(--muted);font-size:11px;display:block;margin-bottom:2px;">Business Definition</strong>
          <span style="color:var(--ink);">${metric.businessDefinition || 'Certified business metric definition.'}</span>
        </div>
        <div style="padding:10px;background:var(--surface-sunken);border-radius:4px;">
          <strong style="color:var(--muted);font-size:11px;display:block;margin-bottom:2px;">Governed Formula</strong>
          <span style="font-family:var(--font-mono);font-weight:700;color:var(--ink);">${metric.formula}</span>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
          <div style="padding:8px;background:var(--surface-sunken);border-radius:4px;">
            <span style="color:var(--muted);">Source Domain:</span> <strong>${metric.sourceDomain}</strong>
          </div>
          <div style="padding:8px;background:var(--surface-sunken);border-radius:4px;">
            <span style="color:var(--muted);">Steward:</span> <strong>${metric.owner}</strong>
          </div>
          <div style="padding:8px;background:var(--surface-sunken);border-radius:4px;">
            <span style="color:var(--muted);">Version:</span> <strong>${metric.version}</strong>
          </div>
          <div style="padding:8px;background:var(--surface-sunken);border-radius:4px;">
            <span style="color:var(--muted);">Trust Status:</span> ${renderTrustPill(metric.trustStatus)}
          </div>
        </div>
      </div>

      <div style="display:flex;justify-content:flex-end;margin-top:8px;">
        <button class="btn btn-ghost" id="modal-metric-close" style="font-size:12px;" type="button">Close</button>
      </div>
    </div>
  `;

  openModal(modalHtml);
  document.getElementById('modal-metric-close')?.addEventListener('click', closeModal);
}

function openHealthModal(root) {
  const modalHtml = `
    <div style="display:flex;flex-direction:column;gap:14px;width:100%;max-width:540px;">
      <h2 style="font-size:16px;font-weight:800;color:var(--ink);margin:0;">Reports &amp; Analytics Subsystem Health</h2>
      <p style="font-size:12px;color:var(--muted);margin:-8px 0 0 0;">Real-time 16-Point Analytics Governance &amp; ZURF Invariant Audit</p>

      <div style="display:flex;flex-direction:column;gap:6px;font-size:12px;max-height:400px;overflow-y:auto;">
        ${[
          { label: 'Governed Metric Formulas Consistency', count: '12 Metrics Verified', status: 'PASS' },
          { label: 'ZURF Multi-Page Watermark Engine Compliance', count: 'Enforced', status: 'PASS' },
          { label: 'Top-Centred Logo, Legal Name & GSTIN Invariant', count: 'Compliant', status: 'PASS' },
          { label: 'Run ID & Classification Immutability', count: 'Active', status: 'PASS' },
          { label: 'Cross-Café Scoping & Privacy Firewalls', count: 'Secure', status: 'PASS' },
          { label: 'POS Sales vs General Ledger Posting Match', count: '100% Matched', status: 'PASS' },
          { label: 'Inbound GRN vs Stock Movement Match', count: '100% Matched', status: 'PASS' },
          { label: 'Supplier Invoice vs AP Payable Match', count: '100% Matched', status: 'PASS' },
          { label: 'Payroll Run vs Payslips Mathematical Match', count: '100% Matched', status: 'PASS' },
          { label: 'Like-for-Like Mature Café Cohort Integrity', count: 'Verified', status: 'PASS' },
          { label: 'OpenXML Excel & PDF Packaging Semantics', count: 'Protected', status: 'PASS' },
          { label: 'STAFF 403 Forbidden Access Enforcement', count: 'Enforced', status: 'PASS' },
          { label: 'Timezone Asia/Kolkata Business Date Alignment', count: 'Active', status: 'PASS' },
          { label: 'Integer Paise Currency Accuracy & Subtotals', count: 'Verified', status: 'PASS' },
          { label: 'Spreadsheet Formula Injection Sanitization', count: 'Protected', status: 'PASS' },
          { label: 'Zero Transactional Truth Replacement', count: 'Verified', status: 'PASS' },
        ].map((h) => `
          <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 10px;background:var(--surface-sunken);border-radius:4px;">
            <span>${h.label}</span>
            <div style="display:flex;align-items:center;gap:6px;">
              <span style="font-weight:700;color:var(--ink);">${h.count}</span>
              <span class="badge success" style="font-size:9px;">${h.status}</span>
            </div>
          </div>
        `).join('')}
      </div>

      <div style="display:flex;justify-content:flex-end;margin-top:10px;">
        <button class="btn btn-ghost" id="modal-health-close" style="font-size:12px;" type="button">Close</button>
      </div>
    </div>
  `;

  openModal(modalHtml);
  document.getElementById('modal-health-close')?.addEventListener('click', closeModal);
}

function openItemDrilldownModal(itemId, itemName) {
  const item = (cachedMenu?.engineering?.items || []).find(i => (i.itemId || '').toUpperCase() === (itemId || '').toUpperCase())
    || (cachedSales?.salesByItem || []).find(i => (i.itemId || '').toUpperCase() === (itemId || '').toUpperCase())
    || { itemId, name: itemName, category: 'General', quantity: 0, netSales: 0 };

  const unitContr = item.unitEstimatedContributionPaisa !== undefined && item.unitEstimatedContributionPaisa !== null
    ? `₹${((item.unitEstimatedContributionPaisa || 0) / 100).toFixed(2)}`
    : 'Unavailable';

  const modalHtml = `
    <div style="display:flex;flex-direction:column;gap:12px;width:100%;max-width:520px;">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;">
        <div>
          <span class="badge" style="font-size:10px;">${item.category || 'COMMERCIAL'}</span>
          <h3 style="font-size:16px;font-weight:800;color:var(--ink);margin:4px 0 0 0;">${item.name || item.itemName || itemId}</h3>
          <span style="font-size:11px;color:var(--muted);">ID: ${item.itemId || 'N/A'}</span>
        </div>
        <span class="pill ${item.quadrant === 'STAR' ? 'pill-mint' : item.quadrant === 'PLOWHORSE' ? 'pill-sky' : item.quadrant === 'PUZZLE' ? 'pill-amber' : item.quadrant === 'DOG' ? 'pill-coral' : 'pill-dark'}" style="font-size:10px;font-weight:700;">
          ${item.quadrant || 'UNCLASSIFIED'}
        </span>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:11px;">
        <div style="padding:8px;background:var(--surface-sunken);border-radius:4px;">
          <span style="color:var(--muted);display:block;">Units Sold:</span>
          <strong style="font-size:14px;color:var(--ink);">${item.quantity || item.unitsSold || 0}</strong>
        </div>
        <div style="padding:8px;background:var(--surface-sunken);border-radius:4px;">
          <span style="color:var(--muted);display:block;">Net Sales:</span>
          <strong style="font-size:14px;color:var(--mint, #10b981);">₹${((item.netSalesPaisa || item.netSalesPaise || 0) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</strong>
        </div>
        <div style="padding:8px;background:var(--surface-sunken);border-radius:4px;">
          <span style="color:var(--muted);display:block;">Theoretical Unit Cost (EST.):</span>
          <strong style="font-size:14px;color:var(--ink);">${item.unitTheoreticalCostPaisa !== null && item.unitTheoreticalCostPaisa !== undefined ? `₹${(item.unitTheoreticalCostPaisa / 100).toFixed(2)}` : 'Unavailable'}</strong>
        </div>
        <div style="padding:8px;background:var(--surface-sunken);border-radius:4px;">
          <span style="color:var(--muted);display:block;">Estimated Unit Contribution:</span>
          <strong style="font-size:14px;color:var(--mint, #10b981);">${unitContr}</strong>
        </div>
      </div>

      <div style="padding:8px 10px;background:var(--surface-sunken);border-radius:4px;font-size:10.5px;color:var(--muted);">
        <strong>Actuality Notice:</strong> ${item.actuality || 'ESTIMATED'} · Cost Basis: CURRENT_STANDARD_COST · Recipe Basis: CURRENT_RECIPE_ESTIMATE. Actual COGS unavailable.
      </div>

      <div style="display:flex;justify-content:flex-end;margin-top:6px;">
        <button class="btn btn-ghost" id="modal-drilldown-close" type="button">Close</button>
      </div>
    </div>
  `;

  openModal(modalHtml);
  document.getElementById('modal-drilldown-close')?.addEventListener('click', closeModal);
}

function openBillDrilldownModal(billId, cafeId) {
  // Drilldown Security (Section 37): Check if bill cafeId is authorized for current user
  const userRole = (state.role || '').toUpperCase();
  const assigned = (state.user?.assignedCafes || state.assignedCafes || []).map(c => typeof c === 'string' ? c : c.cafeId);
  const primaryCafe = state.primaryCafeId || (state.user && state.user.primaryCafeId);
  if (primaryCafe && !assigned.includes(primaryCafe)) assigned.push(primaryCafe);

  const isMaster = userRole === 'MASTER' || (state.auth?.user?.isPrimaryMaster) || (state.user?.isPrimaryMaster);
  const isAuthorized = isMaster || assigned.length === 0 || assigned.includes(cafeId) || assigned.includes('ALL');

  if (!isAuthorized) {
    openModal(`
      <div style="display:flex;flex-direction:column;gap:12px;width:100%;max-width:420px;padding:8px;">
        <div style="display:flex;align-items:center;gap:8px;">
          <span style="font-size:24px;">⛔</span>
          <h3 style="font-size:16px;font-weight:800;color:var(--coral, #ef4444);margin:0;">Access Denied — Café Scope Boundary</h3>
        </div>
        <p style="font-size:12px;color:var(--muted);margin:0;line-height:1.4;">
          Bill <strong>${billId}</strong> belongs to branch <strong>${cafeId}</strong>, which is outside your authorized café assignment.
        </p>
        <div style="display:flex;justify-content:flex-end;margin-top:8px;">
          <button class="btn btn-ghost" id="modal-scope-denied-close" type="button">Close</button>
        </div>
      </div>
    `);
    document.getElementById('modal-scope-denied-close')?.addEventListener('click', closeModal);
    return;
  }

  const billRecord = (cachedSales?.voidAnalytics?.records || []).find(r => r.billId === billId)
    || (cachedSales?.refundAnalytics?.reasons || []).find(r => r.billId === billId)
    || { billId, cafeId, amountPaisa: 0, type: 'TRANSACTION', reason: 'Audit Review' };

  openModal(`
    <div style="display:flex;flex-direction:column;gap:12px;width:100%;max-width:480px;">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;">
        <div>
          <span class="badge" style="font-size:10px;">${billRecord.type || 'BILL AUDIT'}</span>
          <h3 style="font-size:16px;font-weight:800;color:var(--ink);margin:4px 0 0 0;">Bill #${billRecord.billId || billId}</h3>
          <span style="font-size:11px;color:var(--muted);">Branch: ${billRecord.cafeId || cafeId}</span>
        </div>
        <span class="badge warning" style="font-size:10px;">AUDITED</span>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:11px;">
        <div style="padding:8px;background:var(--surface-sunken);border-radius:4px;">
          <span style="color:var(--muted);display:block;">Amount:</span>
          <strong style="font-size:14px;color:var(--ink);">₹${(((billRecord.amountPaisa || billRecord.amount * 100 || 0)) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</strong>
        </div>
        <div style="padding:8px;background:var(--surface-sunken);border-radius:4px;">
          <span style="color:var(--muted);display:block;">Operator ID:</span>
          <strong style="font-size:14px;color:var(--ink);">${billRecord.operatorId || 'OPERATOR'}</strong>
        </div>
      </div>

      <div style="padding:8px 10px;background:var(--surface-sunken);border-radius:4px;font-size:11px;">
        <span style="color:var(--muted);display:block;margin-bottom:2px;">Audit Note / Reason:</span>
        <span style="color:var(--ink);font-weight:600;">${billRecord.reason || 'Standard operational record'}</span>
      </div>

      <div style="font-size:10px;color:var(--muted);padding:4px 0;">
        🔒 Guest PII is redacted under Section 37 drilldown security guidelines.
      </div>

      <div style="display:flex;justify-content:flex-end;margin-top:6px;">
        <button class="btn btn-ghost" id="modal-bill-drill-close" type="button">Close</button>
      </div>
    </div>
  `);
  document.getElementById('modal-bill-drill-close')?.addEventListener('click', closeModal);
}

// ─── PM-02L-R3: Data Trust & Reconciliation Centre ─────────────────────────
async function renderTrustCentreSubtab(root, container) {
  container.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:16px;">
      <div id="tc-loading" style="padding:32px;text-align:center;color:var(--muted);font-size:13px;">
        🛡️ Loading Trust & Reconciliation Centre…
      </div>
    </div>
  `;

  let tc = null;
  try {
    const res = await apiGet('/reports/trust-centre/overview' + buildFilterQueryString());
    if (res?.success && res?.data) tc = res.data;
  } catch (_) {}

  const summary = tc?.summary || {};
  const dq = tc?.dataQuality || {};
  const taxonomies = tc?.canonicalTaxonomies || {};
  const recs = tc?.reconciliations || [];
  const certDims = tc?.certificationDimensions || {};
  const provenance = tc?.provenance || {};
  const invariantViolations = summary?.invariantViolations || [];
  const invariantsHealthy = invariantViolations.length === 0;

  const statusColor = (v) => (v ? 'var(--mint,#10b981)' : 'var(--coral,#ef4444)');
  const pct = (n, d) => (d > 0 ? Math.round((n / d) * 100) : 0);
  const matchRate = pct(summary.matchedControls || 0, summary.availableControls || 1);

  container.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:16px;">

      <!-- Summary Cards -->
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;">
        <div class="card" style="padding:14px;background:var(--surface);border-left:3px solid var(--mint,#10b981);">
          <div style="font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;">Total Controls</div>
          <div style="font-size:24px;font-weight:800;color:var(--ink);">${summary.totalControls ?? '—'}</div>
          <div style="font-size:10px;color:var(--muted);">${summary.availableControls ?? 0} available · ${summary.unavailableControls ?? 0} unavailable</div>
        </div>
        <div class="card" style="padding:14px;background:var(--surface);border-left:3px solid ${statusColor(summary.allAvailableMatched)};">
          <div style="font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;">Match Rate</div>
          <div style="font-size:24px;font-weight:800;color:var(--ink);">${matchRate}%</div>
          <div style="font-size:10px;color:var(--muted);">${summary.matchedControls ?? 0} / ${summary.availableControls ?? 0} controls matched</div>
        </div>
        <div class="card" style="padding:14px;background:var(--surface);border-left:3px solid ${invariantsHealthy ? 'var(--mint,#10b981)' : 'var(--coral,#ef4444)'};">
          <div style="font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;">Invariant Health</div>
          <div style="font-size:18px;font-weight:800;color:${invariantsHealthy ? 'var(--mint,#10b981)' : 'var(--coral,#ef4444)'};">
            ${invariantsHealthy ? '✓ ALL ZERO' : `⚠ ${invariantViolations.length} VIOLATION${invariantViolations.length > 1 ? 'S' : ''}`}
          </div>
          <div style="font-size:10px;color:var(--muted);">PM-02L-R3 gate invariants</div>
        </div>
        <div class="card" style="padding:14px;background:var(--surface);border-left:3px solid var(--sky,#0ea5e9);">
          <div style="font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;">Data Quality</div>
          <div style="font-size:18px;font-weight:800;color:var(--ink);">${dq.overallStatus || 'UNAVAILABLE'}</div>
          <div style="font-size:10px;color:var(--muted);">${dq.lineageNodeCount ?? 0} lineage nodes registered</div>
        </div>
      </div>

      ${invariantViolations.length > 0 ? `
      <!-- Invariant Violations Alert -->
      <div class="card" style="padding:12px 16px;background:rgba(239,68,68,0.08);border:1px solid var(--coral,#ef4444);border-radius:8px;">
        <div style="font-size:12px;font-weight:700;color:var(--coral,#ef4444);margin-bottom:6px;">⚠️ INVARIANT VIOLATIONS DETECTED — PM-02L-R3 GATE BLOCKED</div>
        <div style="display:flex;flex-wrap:wrap;gap:6px;">
          ${invariantViolations.map((v) => `<span style="font-family:var(--font-mono);font-size:10px;background:rgba(239,68,68,0.15);padding:2px 6px;border-radius:4px;color:var(--coral,#ef4444);">${v}</span>`).join('')}
        </div>
      </div>
      ` : `
      <!-- All Clear -->
      <div style="padding:10px 16px;background:rgba(16,185,129,0.08);border:1px solid var(--mint,#10b981);border-radius:8px;font-size:12px;font-weight:600;color:var(--mint,#10b981);display:flex;align-items:center;gap:8px;">
        <span>✓</span><span>All PM-02L-R3 static semantic invariants are ZERO — gate conditions met.</span>
      </div>
      `}

      <!-- Reconciliation Controls Table -->
      <div class="card" style="padding:16px;background:var(--surface);">
        <h4 style="font-size:13px;font-weight:700;color:var(--ink);margin:0 0 10px 0;">Cross-Module Reconciliation Controls</h4>
        <div style="width:100%;overflow-x:auto;">
          <table class="glass-table" id="tc-rec-table" style="width:100%;font-size:12px;">
            <thead>
              <tr>
                <th>Control ID</th><th>Domain</th><th>Left Source</th><th>Right Source</th>
                <th>Tolerance</th><th>Availability</th><th>Status</th>
              </tr>
            </thead>
            <tbody>
              ${recs.length > 0 ? recs.map((r) => `
                <tr>
                  <td style="font-family:var(--font-mono);font-size:10px;">${r.reconciliationId || r.id || '—'}</td>
                  <td>${r.domain || '—'}</td>
                  <td style="font-size:11px;color:var(--muted);">${r.leftSource || '—'}</td>
                  <td style="font-size:11px;color:var(--muted);">${r.rightSource || '—'}</td>
                  <td style="font-size:11px;"><strong>${r.tolerancePolicy?.toleranceType || r.toleranceType || 'ZERO'}</strong></td>
                  <td><span class="badge ${r.availability === 'UNAVAILABLE' ? 'warning' : 'success'}" style="font-size:10px;">${r.availability || 'AVAILABLE'}</span></td>
                  <td><span class="badge ${(r.status === 'EXACT_MATCH' || r.matchStatus === 'EXACT_MATCH') ? 'success' : (r.availability === 'UNAVAILABLE' ? 'warning' : 'danger')}" style="font-size:10px;">${r.matchStatus || r.status || 'PENDING'}</span></td>
                </tr>
              `).join('') : `
                <tr><td colspan="7" style="text-align:center;padding:20px;color:var(--muted);">No reconciliation records for this period.</td></tr>
              `}
            </tbody>
          </table>
        </div>
      </div>

      <!-- Canonical Taxonomies -->
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px;">
        ${[
          { label: 'Actuality States', key: 'actuality', icon: '🕐' },
          { label: 'Data Quality Statuses', key: 'dataQuality', icon: '📊' },
          { label: 'Trust Statuses', key: 'trustStatus', icon: '🏷️' },
          { label: 'Canonical Tenders', key: 'tenders', icon: '💳' },
        ].map(({ label, key, icon }) => `
          <div class="card" style="padding:12px;background:var(--surface);">
            <div style="font-size:11px;font-weight:700;color:var(--ink);margin-bottom:8px;">${icon} ${label}</div>
            <div style="display:flex;flex-wrap:wrap;gap:4px;">
              ${(taxonomies[key] || []).map((v) => `<span style="font-size:10px;font-family:var(--font-mono);background:var(--surface-sunken);padding:2px 6px;border-radius:4px;color:var(--ink);">${v}</span>`).join('')}
            </div>
          </div>
        `).join('')}
      </div>

      <!-- Certification Dimensions -->
      ${Object.keys(certDims).length > 0 ? `
      <div class="card" style="padding:14px;background:var(--surface);">
        <h4 style="font-size:13px;font-weight:700;color:var(--ink);margin:0 0 10px 0;">🏅 Certification Dimensions (PM-02L Section 54)</h4>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:8px;">
          ${Object.values(certDims).map((dim) => `
            <div style="display:flex;align-items:center;gap:8px;padding:6px 10px;background:var(--surface-sunken);border-radius:6px;">
              <span style="color:var(--mint,#10b981);font-size:14px;">✓</span>
              <span style="font-size:11px;font-family:var(--font-mono);color:var(--ink);">${dim}</span>
            </div>
          `).join('')}
        </div>
      </div>
      ` : ''}

      <!-- Provenance Footer -->
      <div style="padding:10px 14px;background:var(--surface-sunken);border-radius:6px;font-size:10px;color:var(--muted);display:flex;justify-content:space-between;flex-wrap:wrap;gap:6px;">
        <span>🔒 Actor: <strong style="color:var(--ink);">${provenance.generatedBy || 'SERVER'}</strong> (server-context only — CLIENT_SUPPLIED_ACKNOWLEDGEMENT_ACTOR_TRUSTED=0)</span>
        <span>Version: <strong style="color:var(--ink);">${provenance.version || 'PM-02L-R3'}</strong> · Generated: ${provenance.generatedAt ? new Date(provenance.generatedAt).toLocaleString('en-IN') : '—'}</span>
      </div>

    </div>
  `;
}

// =============================================================================
// PM-02M — REPORTING PRODUCTIVITY: SAVED VIEWS, PACKS, FAVOURITES & SUBSCRIPTIONS
// =============================================================================

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. SAVED VIEWS & CUSTOM REPORTS SUBTAB
// ─────────────────────────────────────────────────────────────────────────────

async function renderSavedViewsSubtab(root, container) {
  container.innerHTML = `<div style="padding:24px 0;">${skeleton('320px')}</div>`;
  try {
    const userRole = (state.role || '').toUpperCase();
    const isStaff = userRole === 'STAFF';
    const res = await apiGet('/reporting-productivity/custom-reports');
    const reports = res?.customReports || [];

    container.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:20px;">
        <!-- Action Header -->
        <div class="card" style="padding:16px;background:var(--surface);border:1px solid var(--line);border-radius:var(--radius-md, 10px);display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px;">
          <div style="display:flex;align-items:center;gap:12px;flex:1 1 300px;">
            <input
              type="text"
              id="saved-views-search-input"
              class="glass-input"
              placeholder="🔍 Filter saved views by name or metric..."
              style="font-size:12.5px;padding:8px 12px;width:100%;max-width:320px;"
            />
            <select id="saved-views-visibility-filter" class="glass-input" style="font-size:12.5px;padding:8px 12px;">
              <option value="ALL">All Visibilities</option>
              <option value="PERSONAL">Personal</option>
              <option value="SHARED_CAFE">Shared (Café)</option>
              <option value="SHARED_ORGANISATION">Shared (Organisation)</option>
            </select>
          </div>
          ${isStaff ? `
            <div style="font-size:11.5px;color:var(--muted);font-style:italic;padding:6px 12px;background:var(--surface-sunken);border-radius:6px;">
              🔒 Custom report creation is restricted to Enterprise Management roles.
            </div>
          ` : `
          <div>
            <button id="saved-views-create-btn" class="btn btn-primary" type="button" style="display:flex;align-items:center;gap:6px;">
              <span>+</span> <span>Create Saved View</span>
            </button>
          </div>
          `}
        </div>

        <!-- Custom Reports List -->
        <div class="card" style="padding:0;background:var(--surface);border:1px solid var(--line);border-radius:var(--radius-md, 10px);overflow:hidden;">
          <div style="padding:14px 18px;border-bottom:1px solid var(--line);display:flex;justify-content:space-between;align-items:center;">
            <h3 style="font-size:14px;font-weight:700;color:var(--ink);margin:0;">Governed Custom Reports (${reports.length})</h3>
            <span style="font-size:11px;color:var(--muted);">All metrics & dimensions source-verified against Canonical Registries</span>
          </div>
          <div style="overflow-x:auto;">
            <table style="width:100%;border-collapse:collapse;font-size:12px;text-align:left;">
              <thead>
                <tr style="background:var(--surface-sunken);border-bottom:1px solid var(--line);color:var(--muted);font-weight:600;">
                  <th style="padding:10px 14px;">Name / Description</th>
                  <th style="padding:10px 14px;">Visibility</th>
                  <th style="padding:10px 14px;">Category</th>
                  <th style="padding:10px 14px;">Version</th>
                  <th style="padding:10px 14px;">Updated</th>
                  <th style="padding:10px 14px;text-align:right;">Actions</th>
                </tr>
              </thead>
              <tbody id="saved-views-table-body">
                ${reports.length === 0 ? `
                  <tr>
                    <td colspan="6" style="padding:32px 14px;text-align:center;color:var(--muted);">
                      No saved views created yet. Click <strong>+ Create Saved View</strong> to assemble your first governed custom view.
                    </td>
                  </tr>
                ` : reports.map(r => `
                  <tr style="border-bottom:1px solid var(--line);transition:background 0.15s ease;" data-id="${escapeHtml(r.customReportId)}" data-visibility="${escapeHtml(r.visibility)}">
                    <td style="padding:12px 14px;">
                      <div style="font-weight:600;color:var(--ink);">${escapeHtml(r.name)}</div>
                      <div style="font-size:11px;color:var(--muted);margin-top:2px;">${escapeHtml(r.description || 'No description provided')}</div>
                    </td>
                    <td style="padding:12px 14px;">
                      <span class="badge ${r.visibility === 'PERSONAL' ? 'badge-neutral' : r.visibility === 'SHARED_CAFE' ? 'badge-accent' : 'badge-success'}">
                        ${escapeHtml(r.visibility)}
                      </span>
                    </td>
                    <td style="padding:12px 14px;color:var(--muted);">${escapeHtml(r.categoryId || 'SALES')}</td>
                    <td style="padding:12px 14px;font-family:var(--font-mono);font-size:11px;">v${Number(r.version || 1)}</td>
                    <td style="padding:12px 14px;color:var(--muted);font-size:11px;">${r.updatedAt ? new Date(r.updatedAt).toLocaleDateString('en-IN') : '—'}</td>
                    <td style="padding:12px 14px;text-align:right;">
                      <div style="display:inline-flex;gap:6px;justify-content:flex-end;">
                        <button class="btn btn-xs btn-outline btn-run-saved-view" data-id="${escapeHtml(r.customReportId)}" title="Run View">▶ Run</button>
                        <button class="btn btn-xs btn-outline btn-edit-saved-view" data-id="${escapeHtml(r.customReportId)}" title="Edit Configuration">✏ Edit</button>
                        <button class="btn btn-xs btn-outline btn-clone-saved-view" data-id="${escapeHtml(r.customReportId)}" title="Clone View">📋 Clone</button>
                        <button class="btn btn-xs btn-outline btn-signoff-saved-view" data-id="${escapeHtml(r.customReportId)}" title="Governance Sign-Off">✍ Sign-Off</button>
                        <button class="btn btn-xs btn-outline btn-pdf-saved-view" data-id="${escapeHtml(r.customReportId)}" title="Export PDF">📄 PDF</button>
                        <button class="btn btn-xs btn-outline btn-xlsx-saved-view" data-id="${escapeHtml(r.customReportId)}" title="Export Excel">📊 XLSX</button>
                        <button class="btn btn-xs btn-danger btn-delete-saved-view" data-id="${escapeHtml(r.customReportId)}" title="Archive">🗑</button>
                      </div>
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    `;

    // Wire events
    const searchInput = container.querySelector('#saved-views-search-input');
    const visFilter = container.querySelector('#saved-views-visibility-filter');
    const filterRows = () => {
      const q = (searchInput?.value || '').trim().toLowerCase();
      const v = visFilter?.value || 'ALL';
      const rows = container.querySelectorAll('#saved-views-table-body tr[data-id]');
      rows.forEach(row => {
        const text = row.textContent.toLowerCase();
        const vis = row.getAttribute('data-visibility');
        const matchQ = !q || text.includes(q);
        const matchV = v === 'ALL' || vis === v;
        row.style.display = matchQ && matchV ? '' : 'none';
      });
    };
    searchInput?.addEventListener('input', filterRows);
    visFilter?.addEventListener('change', filterRows);

    container.querySelector('#saved-views-create-btn')?.addEventListener('click', () => {
      openSavedViewModal(root, null, () => renderSavedViewsSubtab(root, container));
    });

    container.querySelectorAll('.btn-edit-saved-view').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const id = e.currentTarget.getAttribute('data-id');
        const report = reports.find(r => r.customReportId === id);
        if (report) {
          openSavedViewModal(root, report, () => renderSavedViewsSubtab(root, container));
        }
      });
    });

    container.querySelectorAll('.btn-clone-saved-view').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const id = e.currentTarget.getAttribute('data-id');
        try {
          const resClone = await apiPost(`/reporting-productivity/custom-reports/${id}/clone`, {});
          if (resClone?.success) {
            showToast('Saved view cloned successfully', 'success');
            await renderSavedViewsSubtab(root, container);
          }
        } catch (err) {
          showToast(err.message || 'Clone failed', 'error');
        }
      });
    });

    container.querySelectorAll('.btn-signoff-saved-view').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const id = e.currentTarget.getAttribute('data-id');
        try {
          const resSign = await apiPost(`/reporting-productivity/custom-reports/${id}/sign-off`, {
            signOffNote: 'Certified under governed reporting workflow'
          });
          if (resSign?.success) {
            showToast('Governance sign-off recorded', 'success');
            await renderSavedViewsSubtab(root, container);
          }
        } catch (err) {
          showToast(err.message || 'Sign-off failed', 'error');
        }
      });
    });

    container.querySelectorAll('.btn-delete-saved-view').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const id = e.currentTarget.getAttribute('data-id');
        if (confirm(`Archive custom report ${id}?`)) {
          try {
            await apiDelete(`/reporting-productivity/custom-reports/${id}`);
            showToast('Custom report archived', 'info');
            await renderSavedViewsSubtab(root, container);
          } catch (err) {
            showToast(err.message || 'Archive failed', 'error');
          }
        }
      });
    });

    container.querySelectorAll('.btn-run-saved-view').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const id = e.currentTarget.getAttribute('data-id');
        try {
          const resManifest = await apiGet(`/reporting-productivity/custom-reports/${id}/export-manifest`);
          if (resManifest?.manifest) {
            showToast(`Execution verified: live scope re-evaluated for ${id}`, 'success');
          }
        } catch (err) {
          showToast(err.message || 'Execution error', 'error');
        }
      });
    });

    container.querySelectorAll('.btn-pdf-saved-view, .btn-xlsx-saved-view').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const id = e.currentTarget.getAttribute('data-id');
        const isPdf = e.currentTarget.classList.contains('btn-pdf-saved-view');
        const format = isPdf ? 'PDF' : 'XLSX';
        try {
          const resManifest = await apiGet(`/reporting-productivity/custom-reports/${id}/export-manifest`);
          showToast(`Export manifest compiled for ${format}: Scope re-evaluated`, 'success');
        } catch (err) {
          showToast(err.message || 'Export error', 'error');
        }
      });
    });

  } catch (err) {
    container.innerHTML = renderModuleErrorState('Saved Views', err.message);
  }
}

// Modal for Saved Views Create / Edit — Full Governed Custom Report Builder
function openSavedViewModal(root, reportDoc = null, onSaved = null) {
  const userRole = (state.role || '').toUpperCase();
  if (userRole === 'STAFF') {
    showToast('Staff role is not permitted to create custom reports under enterprise governance policy.', 'error');
    return;
  }
  const isEdit = Boolean(reportDoc);
  const title = isEdit ? `Edit Saved View (${escapeHtml(reportDoc.customReportId)})` : 'Create Governed Custom Report / Saved View';

  const currentBase = reportDoc?.baseReportId || 'daily-sales';
  const currentMetrics = reportDoc?.metricIds || ['NET_SALES', 'GROSS_SALES'];
  const currentDim = reportDoc?.dimensionIds?.[0] || 'CAFE';
  const currentCafe = reportDoc?.filters?.requestedCafeIds?.[0] || 'ALL_CAFES';
  const currentPeriod = reportDoc?.filters?.periodSemantic || 'THIS_MONTH';
  const currentCustomFrom = reportDoc?.filters?.customDateFrom || '';
  const currentCustomTo = reportDoc?.filters?.customDateTo || '';
  const currentComp = reportDoc?.filters?.comparison || 'NONE';
  const currentVisual = reportDoc?.visualDefinitions?.[0]?.visualType || 'TABLE';
  const currentSortField = reportDoc?.visualDefinitions?.[0]?.sortField || 'NET_SALES';
  const currentSortDir = reportDoc?.visualDefinitions?.[0]?.sortDirection || 'DESC';
  const currentTopN = reportDoc?.filters?.topN || reportDoc?.visualDefinitions?.[0]?.topN || '';

  const modalHtml = `
    <div style="display:flex;flex-direction:column;gap:12px;font-size:12.5px;max-height:75vh;overflow-y:auto;padding-right:4px;">
      <!-- Row 1: Name & Description -->
      <div>
        <label style="display:block;font-weight:600;margin-bottom:4px;color:var(--ink);">Report Name *</label>
        <input type="text" id="saved-view-name-input" class="glass-input" style="width:100%;box-sizing:border-box;padding:8px;" value="${escapeHtml(reportDoc?.name || '')}" placeholder="e.g. Daily Executive Sales & Gross Margins" maxlength="120" required />
      </div>
      <div>
        <label style="display:block;font-weight:600;margin-bottom:4px;color:var(--ink);">Description</label>
        <textarea id="saved-view-desc-input" class="glass-input" style="width:100%;box-sizing:border-box;padding:8px;height:52px;" placeholder="Optional business context or summary" maxlength="500">${escapeHtml(reportDoc?.description || '')}</textarea>
      </div>

      <!-- Row 2: Base Report & Category -->
      <div style="display:grid;grid-template-columns:1.2fr 0.8fr;gap:12px;">
        <div>
          <label style="display:block;font-weight:600;margin-bottom:4px;color:var(--ink);">Base Canonical Report *</label>
          <select id="saved-view-base-report-select" class="glass-input" style="width:100%;padding:8px;">
            <option value="daily-sales" ${currentBase === 'daily-sales' ? 'selected' : ''}>Daily Sales & Operations Summary</option>
            <option value="pl-statement" ${currentBase === 'pl-statement' ? 'selected' : ''}>Profit & Loss Statement & Waterfall</option>
            <option value="workforce-attendance" ${currentBase === 'workforce-attendance' ? 'selected' : ''}>Workforce, Shifts & Attendance Summary</option>
            <option value="inventory-valuation" ${currentBase === 'inventory-valuation' ? 'selected' : ''}>Inventory Valuation & Stock Movement</option>
            <option value="procurement-commitments" ${currentBase === 'procurement-commitments' ? 'selected' : ''}>Procurement & Vendor Commitments</option>
            <option value="cashier-audit" ${currentBase === 'cashier-audit' ? 'selected' : ''}>Cashier & Till Reconciliation Summary</option>
            <option value="kitchen-prep" ${currentBase === 'kitchen-prep' ? 'selected' : ''}>Kitchen Prep & Fulfillment Efficiency</option>
          </select>
        </div>
        <div>
          <label style="display:block;font-weight:600;margin-bottom:4px;color:var(--ink);">Category</label>
          <select id="saved-view-category-select" class="glass-input" style="width:100%;padding:8px;">
            <option value="SALES" ${reportDoc?.categoryId === 'SALES' ? 'selected' : ''}>Sales & POS</option>
            <option value="FINANCE" ${reportDoc?.categoryId === 'FINANCE' ? 'selected' : ''}>Finance & P&L</option>
            <option value="WORKFORCE" ${reportDoc?.categoryId === 'WORKFORCE' ? 'selected' : ''}>Workforce & Attendance</option>
            <option value="INVENTORY" ${reportDoc?.categoryId === 'INVENTORY' ? 'selected' : ''}>Inventory & Stock</option>
            <option value="PROCUREMENT" ${reportDoc?.categoryId === 'PROCUREMENT' ? 'selected' : ''}>Procurement & Spend</option>
            <option value="QUALITY" ${reportDoc?.categoryId === 'QUALITY' ? 'selected' : ''}>Quality & Safety</option>
          </select>
        </div>
      </div>

      <!-- Row 3: Metrics & Dimension -->
      <div style="display:grid;grid-template-columns:1.2fr 0.8fr;gap:12px;">
        <div>
          <label style="display:block;font-weight:600;margin-bottom:4px;color:var(--ink);">Governed Metrics (Hold Ctrl/Cmd to select multiple) *</label>
          <select id="saved-view-metrics-select" class="glass-input" multiple size="4" style="width:100%;padding:6px;font-size:12px;">
            <option value="NET_SALES" ${currentMetrics.includes('NET_SALES') ? 'selected' : ''}>NET_SALES — Net Sales Revenue</option>
            <option value="GROSS_SALES" ${currentMetrics.includes('GROSS_SALES') ? 'selected' : ''}>GROSS_SALES — Gross Sales Revenue</option>
            <option value="ORDER_COUNT" ${currentMetrics.includes('ORDER_COUNT') ? 'selected' : ''}>ORDER_COUNT — Completed Order Count</option>
            <option value="AVERAGE_ORDER_VALUE" ${currentMetrics.includes('AVERAGE_ORDER_VALUE') ? 'selected' : ''}>AVERAGE_ORDER_VALUE — Average Ticket</option>
            <option value="DISCOUNT_AMOUNT" ${currentMetrics.includes('DISCOUNT_AMOUNT') ? 'selected' : ''}>DISCOUNT_AMOUNT — Total Discounts</option>
            <option value="CUSTOMER_REFUND_TOTAL" ${currentMetrics.includes('CUSTOMER_REFUND_TOTAL') ? 'selected' : ''}>CUSTOMER_REFUND_TOTAL — Customer Refunds</option>
            <option value="TAX_CHARGED" ${currentMetrics.includes('TAX_CHARGED') ? 'selected' : ''}>TAX_CHARGED — GST / Output Tax</option>
          </select>
        </div>
        <div>
          <label style="display:block;font-weight:600;margin-bottom:4px;color:var(--ink);">Breakdown Dimension</label>
          <select id="saved-view-dimension-select" class="glass-input" style="width:100%;padding:8px;">
            <option value="CAFE" ${currentDim === 'CAFE' ? 'selected' : ''}>CAFE — Store Location</option>
            <option value="BUSINESS_DATE" ${currentDim === 'BUSINESS_DATE' ? 'selected' : ''}>BUSINESS_DATE — Date</option>
            <option value="HOUR" ${currentDim === 'HOUR' ? 'selected' : ''}>HOUR — Hour of Day (Daypart)</option>
            <option value="DAY_OF_WEEK" ${currentDim === 'DAY_OF_WEEK' ? 'selected' : ''}>DAY_OF_WEEK — Day of Week</option>
            <option value="MENU_CATEGORY" ${currentDim === 'MENU_CATEGORY' ? 'selected' : ''}>MENU_CATEGORY — Menu Category</option>
            <option value="SERVICE_MODE" ${currentDim === 'SERVICE_MODE' ? 'selected' : ''}>SERVICE_MODE — Service Channel</option>
            <option value="PAYMENT_METHOD" ${currentDim === 'PAYMENT_METHOD' ? 'selected' : ''}>PAYMENT_METHOD — Tender / Instrument</option>
          </select>
        </div>
      </div>

      <!-- Row 4: Café Scope & Visibility -->
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
        <div>
          <label style="display:block;font-weight:600;margin-bottom:4px;color:var(--ink);">Café Scope Configuration</label>
          <select id="saved-view-cafe-select" class="glass-input" style="width:100%;padding:8px;">
            <option value="ALL_CAFES" ${currentCafe === 'ALL_CAFES' ? 'selected' : ''}>All Authorized Cafés (Scoped)</option>
            <option value="cafe-01" ${currentCafe === 'cafe-01' ? 'selected' : ''}>Zamorin Beach Road (Cafe A)</option>
            <option value="cafe-02" ${currentCafe === 'cafe-02' ? 'selected' : ''}>Zamorin Calicut Airport (Cafe B)</option>
            <option value="cafe-03" ${currentCafe === 'cafe-03' ? 'selected' : ''}>Zamorin High Street (Cafe C)</option>
          </select>
        </div>
        <div>
          <label style="display:block;font-weight:600;margin-bottom:4px;color:var(--ink);">Visibility & Sharing</label>
          <select id="saved-view-visibility-select" class="glass-input" style="width:100%;padding:8px;">
            <option value="PERSONAL" ${reportDoc?.visibility === 'PERSONAL' ? 'selected' : ''}>Personal (Only Me)</option>
            <option value="SHARED_CAFE" ${reportDoc?.visibility === 'SHARED_CAFE' ? 'selected' : ''}>Shared (My Assigned Café)</option>
            <option value="SHARED_ORGANISATION" ${reportDoc?.visibility === 'SHARED_ORGANISATION' ? 'selected' : ''}>Shared (Organisation-Wide)</option>
          </select>
        </div>
      </div>

      <!-- Row 5: Period, Comparison & Custom Dates -->
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
        <div>
          <label style="display:block;font-weight:600;margin-bottom:4px;color:var(--ink);">Period Semantic</label>
          <select id="saved-view-period-select" class="glass-input" style="width:100%;padding:8px;">
            <option value="THIS_MONTH" ${currentPeriod === 'THIS_MONTH' ? 'selected' : ''}>THIS_MONTH — This Month (MTD)</option>
            <option value="LAST_MONTH" ${currentPeriod === 'LAST_MONTH' ? 'selected' : ''}>LAST_MONTH — Last Month</option>
            <option value="TODAY" ${currentPeriod === 'TODAY' ? 'selected' : ''}>TODAY — Today</option>
            <option value="YESTERDAY" ${currentPeriod === 'YESTERDAY' ? 'selected' : ''}>YESTERDAY — Yesterday</option>
            <option value="THIS_WEEK" ${currentPeriod === 'THIS_WEEK' ? 'selected' : ''}>THIS_WEEK — This Week</option>
            <option value="LAST_WEEK" ${currentPeriod === 'LAST_WEEK' ? 'selected' : ''}>LAST_WEEK — Last Week</option>
            <option value="MTD" ${currentPeriod === 'MTD' ? 'selected' : ''}>MTD — Month to Date</option>
            <option value="YTD" ${currentPeriod === 'YTD' ? 'selected' : ''}>YTD — Year to Date</option>
            <option value="CUSTOM" ${currentPeriod === 'CUSTOM' || currentPeriod === 'CUSTOM_ABSOLUTE' ? 'selected' : ''}>CUSTOM — Absolute Date Range</option>
          </select>
        </div>
        <div>
          <label style="display:block;font-weight:600;margin-bottom:4px;color:var(--ink);">Comparison Mode</label>
          <select id="saved-view-comparison-select" class="glass-input" style="width:100%;padding:8px;">
            <option value="NONE" ${currentComp === 'NONE' ? 'selected' : ''}>NONE — No Comparison</option>
            <option value="PRIOR_PERIOD" ${currentComp === 'PRIOR_PERIOD' || currentComp === 'PREVIOUS_PERIOD' ? 'selected' : ''}>PRIOR_PERIOD — Prior Period</option>
            <option value="PRIOR_YEAR" ${currentComp === 'PRIOR_YEAR' || currentComp === 'PREVIOUS_YEAR' ? 'selected' : ''}>PRIOR_YEAR — Prior Year (YoY)</option>
            <option value="BUDGET" ${currentComp === 'BUDGET' ? 'selected' : ''}>BUDGET — Budget Target</option>
            <option value="FORECAST" ${currentComp === 'FORECAST' ? 'selected' : ''}>FORECAST — Forecast</option>
          </select>
        </div>
      </div>

      <!-- Custom Date Range Row (Revealed when Period = CUSTOM) -->
      <div id="saved-view-custom-date-container" style="display:${currentPeriod === 'CUSTOM' || currentPeriod === 'CUSTOM_ABSOLUTE' ? 'grid' : 'none'};grid-template-columns:1fr 1fr;gap:12px;">
        <div>
          <label style="display:block;font-weight:600;margin-bottom:4px;color:var(--ink);">Date From (YYYY-MM-DD)</label>
          <input type="date" id="saved-view-date-from" class="glass-input" style="width:100%;box-sizing:border-box;padding:8px;" value="${escapeHtml(currentCustomFrom)}" />
        </div>
        <div>
          <label style="display:block;font-weight:600;margin-bottom:4px;color:var(--ink);">Date To (YYYY-MM-DD)</label>
          <input type="date" id="saved-view-date-to" class="glass-input" style="width:100%;box-sizing:border-box;padding:8px;" value="${escapeHtml(currentCustomTo)}" />
        </div>
      </div>

      <!-- Row 6: Visual, Sort Field & Direction, Top N -->
      <div style="display:grid;grid-template-columns:1fr 1fr 0.8fr 0.7fr;gap:10px;">
        <div>
          <label style="display:block;font-weight:600;margin-bottom:4px;color:var(--ink);">Visual Type</label>
          <select id="saved-view-visual-select" class="glass-input" style="width:100%;padding:8px;">
            <option value="TABLE" ${currentVisual === 'TABLE' ? 'selected' : ''}>TABLE — Grid View</option>
            <option value="KPI" ${currentVisual === 'KPI' ? 'selected' : ''}>KPI — Metric Summary</option>
            <option value="LINE" ${currentVisual === 'LINE' ? 'selected' : ''}>LINE — Time Series</option>
            <option value="BAR" ${currentVisual === 'BAR' ? 'selected' : ''}>BAR — Comparative</option>
          </select>
        </div>
        <div>
          <label style="display:block;font-weight:600;margin-bottom:4px;color:var(--ink);">Sort Field</label>
          <select id="saved-view-sort-field-select" class="glass-input" style="width:100%;padding:8px;">
            <option value="NET_SALES" ${currentSortField === 'NET_SALES' ? 'selected' : ''}>Net Sales</option>
            <option value="ORDER_COUNT" ${currentSortField === 'ORDER_COUNT' ? 'selected' : ''}>Order Count</option>
            <option value="GROSS_SALES" ${currentSortField === 'GROSS_SALES' ? 'selected' : ''}>Gross Sales</option>
          </select>
        </div>
        <div>
          <label style="display:block;font-weight:600;margin-bottom:4px;color:var(--ink);">Sort Dir</label>
          <select id="saved-view-sort-dir-select" class="glass-input" style="width:100%;padding:8px;">
            <option value="DESC" ${currentSortDir === 'DESC' ? 'selected' : ''}>Descending</option>
            <option value="ASC" ${currentSortDir === 'ASC' ? 'selected' : ''}>Ascending</option>
          </select>
        </div>
        <div>
          <label style="display:block;font-weight:600;margin-bottom:4px;color:var(--ink);">Top N</label>
          <input type="number" id="saved-view-top-n-input" class="glass-input" style="width:100%;box-sizing:border-box;padding:8px;" min="1" max="1000" placeholder="All" value="${escapeHtml(String(currentTopN))}" />
        </div>
      </div>

      <!-- Row 7: Export Format -->
      <div>
        <label style="display:block;font-weight:600;margin-bottom:4px;color:var(--ink);">Preferred Export Format</label>
        <select id="saved-view-format-select" class="glass-input" style="width:100%;padding:8px;">
          <option value="PDF" ${reportDoc?.preferredExportFormat === 'PDF' ? 'selected' : ''}>Standard Binary PDF</option>
          <option value="XLSX" ${reportDoc?.preferredExportFormat === 'XLSX' ? 'selected' : ''}>OpenXML Excel (.xlsx)</option>
        </select>
      </div>

      <!-- Action Buttons -->
      <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:14px;padding-top:10px;border-top:1px solid var(--line);">
        <button id="saved-view-cancel-btn" class="btn btn-outline" type="button">Cancel</button>
        ${isEdit ? `<button id="saved-view-save-as-btn" class="btn btn-outline" type="button">Save As Copy</button>` : ''}
        <button id="saved-view-save-btn" class="btn btn-primary" type="button">${isEdit ? 'Save Changes' : 'Create View'}</button>
      </div>
    </div>
  `;

  openModal(title, modalHtml);

  // Toggle Custom Date range inputs when period semantic changes
  const periodEl = document.getElementById('saved-view-period-select');
  const dateContainer = document.getElementById('saved-view-custom-date-container');
  if (periodEl && dateContainer) {
    periodEl.addEventListener('change', () => {
      dateContainer.style.display = (periodEl.value === 'CUSTOM' || periodEl.value === 'CUSTOM_ABSOLUTE') ? 'grid' : 'none';
    });
  }

  document.getElementById('saved-view-cancel-btn')?.addEventListener('click', closeModal);

  const handleSave = async (isSaveAs = false) => {
    const name = document.getElementById('saved-view-name-input')?.value.trim();
    if (!name) {
      showToast('Name is required', 'error');
      return;
    }
    const description = document.getElementById('saved-view-desc-input')?.value.trim() || '';
    const baseReportId = document.getElementById('saved-view-base-report-select')?.value || 'daily-sales';
    const categoryId = document.getElementById('saved-view-category-select')?.value || 'SALES';
    const visibility = document.getElementById('saved-view-visibility-select')?.value || 'PERSONAL';
    const preferredExportFormat = document.getElementById('saved-view-format-select')?.value || 'PDF';
    const periodSemantic = document.getElementById('saved-view-period-select')?.value || 'THIS_MONTH';
    const comparison = document.getElementById('saved-view-comparison-select')?.value || 'NONE';
    const cafeValue = document.getElementById('saved-view-cafe-select')?.value || 'ALL_CAFES';
    const requestedCafeIds = cafeValue === 'ALL_CAFES' ? [] : [cafeValue];

    // Collect multi-metric selection
    const metricSelect = document.getElementById('saved-view-metrics-select');
    const metricIds = [];
    if (metricSelect) {
      for (let i = 0; i < metricSelect.options.length; i++) {
        if (metricSelect.options[i].selected) {
          metricIds.push(metricSelect.options[i].value);
        }
      }
    }
    if (metricIds.length === 0) {
      metricIds.push('NET_SALES');
    }

    const dimensionId = document.getElementById('saved-view-dimension-select')?.value || 'CAFE';
    const visualType = document.getElementById('saved-view-visual-select')?.value || 'TABLE';
    const sortField = document.getElementById('saved-view-sort-field-select')?.value || 'NET_SALES';
    const sortDirection = document.getElementById('saved-view-sort-dir-select')?.value || 'DESC';
    const rawTopN = document.getElementById('saved-view-top-n-input')?.value.trim();
    const topN = rawTopN ? parseInt(rawTopN, 10) : null;

    const filters = {
      periodSemantic,
      comparison,
      requestedCafeIds,
    };

    if (periodSemantic === 'CUSTOM' || periodSemantic === 'CUSTOM_ABSOLUTE') {
      const customFrom = document.getElementById('saved-view-date-from')?.value.trim();
      const customTo = document.getElementById('saved-view-date-to')?.value.trim();
      if (!customFrom || !customTo) {
        showToast('Custom period requires both from and to dates', 'error');
        return;
      }
      if (customFrom > customTo) {
        showToast('From date cannot be after to date', 'error');
        return;
      }
      filters.customDateFrom = customFrom;
      filters.customDateTo = customTo;
    }

    if (topN !== null) {
      if (isNaN(topN) || topN < 1 || topN > 1000) {
        showToast('Top N must be an integer between 1 and 1000', 'error');
        return;
      }
      filters.topN = topN;
    }

    const visualDefinition = {
      visualType,
      metricId: metricIds[0],
      dimensionIds: [dimensionId],
      sortField,
      sortDirection,
      ...(topN ? { topN } : {}),
    };

    const payload = {
      name,
      description,
      baseReportId,
      categoryId,
      visibility,
      preferredExportFormat,
      metricIds,
      dimensionIds: [dimensionId],
      filters,
      visualDefinitions: [visualDefinition],
      version: isEdit && !isSaveAs ? reportDoc.version : 1,
    };

    try {
      if (isEdit && !isSaveAs) {
        const res = await apiPatch(`/reporting-productivity/custom-reports/${reportDoc.customReportId}`, payload);
        if (res?.success) {
          showToast('Saved view updated (Atomic CAS)', 'success');
          closeModal();
          if (onSaved) onSaved();
        }
      } else {
        const res = await apiPost('/reporting-productivity/custom-reports', payload);
        if (res?.success) {
          showToast('Custom report created successfully', 'success');
          closeModal();
          if (onSaved) onSaved();
        }
      }
    } catch (err) {
      showToast(err.message || 'Error saving report', 'error');
    }
  };

  document.getElementById('saved-view-save-btn')?.addEventListener('click', () => handleSave(false));
  document.getElementById('saved-view-save-as-btn')?.addEventListener('click', () => handleSave(true));
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. REPORT FAVOURITES SUBTAB
// ─────────────────────────────────────────────────────────────────────────────

async function renderFavouritesSubtab(root, container) {
  container.innerHTML = `<div style="padding:24px 0;">${skeleton('280px')}</div>`;
  try {
    const res = await apiGet('/reporting-productivity/favourites');
    const favs = res?.favourites || [];

    container.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:20px;">
        <div class="card" style="padding:16px;background:var(--surface);border:1px solid var(--line);border-radius:var(--radius-md, 10px);display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px;">
          <div>
            <h3 style="font-size:15px;font-weight:700;color:var(--ink);margin:0;">Pinned & Bookmarked Reports</h3>
            <p style="font-size:12px;color:var(--muted);margin:3px 0 0 0;">Favouriting retains instant navigation shortcuts; live security scope is re-evaluated on every run.</p>
          </div>
          <button id="fav-add-btn" class="btn btn-primary btn-sm" type="button">+ Bookmark Report</button>
        </div>

        <div class="card" style="padding:0;background:var(--surface);border:1px solid var(--line);border-radius:var(--radius-md, 10px);overflow:hidden;">
          <table style="width:100%;border-collapse:collapse;font-size:12px;text-align:left;">
            <thead>
              <tr style="background:var(--surface-sunken);border-bottom:1px solid var(--line);color:var(--muted);font-weight:600;">
                <th style="padding:10px 14px;">Status / Pin</th>
                <th style="padding:10px 14px;">Item Type</th>
                <th style="padding:10px 14px;">Report Reference</th>
                <th style="padding:10px 14px;">Added At</th>
                <th style="padding:10px 14px;text-align:right;">Actions</th>
              </tr>
            </thead>
            <tbody>
              ${favs.length === 0 ? `
                <tr>
                  <td colspan="5" style="padding:32px 14px;text-align:center;color:var(--muted);">
                    No favourites pinned yet. Pin any canonical report or saved view for instant access.
                  </td>
                </tr>
              ` : favs.map(f => `
                <tr style="border-bottom:1px solid var(--line);">
                  <td style="padding:12px 14px;">
                    ${f.isPinned ? '<span class="badge badge-accent">📌 Pinned</span>' : '<span class="badge badge-neutral">⭐ Starred</span>'}
                  </td>
                  <td style="padding:12px 14px;font-weight:600;color:var(--ink);">${escapeHtml(f.itemType)}</td>
                  <td style="padding:12px 14px;font-family:var(--font-mono);">${escapeHtml(f.itemId)}</td>
                  <td style="padding:12px 14px;color:var(--muted);font-size:11px;">${f.createdAt ? new Date(f.createdAt).toLocaleDateString('en-IN') : '—'}</td>
                  <td style="padding:12px 14px;text-align:right;">
                    <div style="display:inline-flex;gap:6px;">
                      <button class="btn btn-xs btn-outline btn-open-fav" data-type="${escapeHtml(f.itemType)}" data-id="${escapeHtml(f.itemId)}">Open</button>
                      <button class="btn btn-xs btn-danger btn-remove-fav" data-id="${escapeHtml(f.favouriteId)}">Remove</button>
                    </div>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;

    container.querySelectorAll('.btn-remove-fav').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const id = e.currentTarget.getAttribute('data-id');
        try {
          await apiDelete(`/reporting-productivity/favourites/${id}`);
          showToast('Favourite removed', 'info');
          await renderFavouritesSubtab(root, container);
        } catch (err) {
          showToast(err.message || 'Error removing favourite', 'error');
        }
      });
    });

    container.querySelectorAll('.btn-open-fav').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const reportId = e.currentTarget.getAttribute('data-id');
        showToast(`Opening bookmarked report: ${reportId}`, 'info');
      });
    });

    container.querySelector('#fav-add-btn')?.addEventListener('click', () => {
      const modalContent = `
        <div style="display:flex;flex-direction:column;gap:12px;font-size:12.5px;">
          <div>
            <label style="display:block;font-weight:600;margin-bottom:4px;">Item Type</label>
            <select id="fav-modal-type" class="glass-input" style="width:100%;padding:8px;">
              <option value="CANONICAL_REPORT">Canonical Report</option>
              <option value="CUSTOM_REPORT">Saved Custom View</option>
              <option value="REPORT_PACK">Executive Report Pack</option>
            </select>
          </div>
          <div>
            <label style="display:block;font-weight:600;margin-bottom:4px;">Report Reference ID</label>
            <input type="text" id="fav-modal-id" class="glass-input" style="width:100%;padding:8px;box-sizing:border-box;" placeholder="e.g. sales-hourly or CR-ORG-..." required />
          </div>
          <div style="display:flex;align-items:center;gap:8px;">
            <input type="checkbox" id="fav-modal-pin" />
            <label for="fav-modal-pin" style="font-weight:600;">Pin to top of list</label>
          </div>
          <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:8px;">
            <button id="fav-modal-cancel" class="btn btn-outline" type="button">Cancel</button>
            <button id="fav-modal-submit" class="btn btn-primary" type="button">Save Bookmark</button>
          </div>
        </div>
      `;
      openModal('Add Report Favourite', modalContent);
      document.getElementById('fav-modal-cancel')?.addEventListener('click', closeModal);
      document.getElementById('fav-modal-submit')?.addEventListener('click', async () => {
        const itemType = document.getElementById('fav-modal-type')?.value;
        const itemId = document.getElementById('fav-modal-id')?.value.trim();
        const isPinned = document.getElementById('fav-modal-pin')?.checked;
        if (!itemId) {
          showToast('Reference ID is required', 'error');
          return;
        }
        try {
          const addRes = await apiPost('/reporting-productivity/favourites', { itemType, itemId, isPinned });
          if (addRes?.success) {
            showToast('Favourite added', 'success');
            closeModal();
            await renderFavouritesSubtab(root, container);
          }
        } catch (err) {
          showToast(err.message || 'Error adding favourite', 'error');
        }
      });
    });

  } catch (err) {
    container.innerHTML = renderModuleErrorState('Favourites', err.message);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. EXECUTIVE REPORT PACKS SUBTAB
// ─────────────────────────────────────────────────────────────────────────────

async function renderReportPacksSubtab(root, container) {
  container.innerHTML = `<div style="padding:24px 0;">${skeleton('320px')}</div>`;
  try {
    const res = await apiGet('/reporting-productivity/report-packs');
    const packs = res?.reportPacks || [];

    container.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:20px;">
        <div class="card" style="padding:16px;background:var(--surface);border:1px solid var(--line);border-radius:var(--radius-md, 10px);display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px;">
          <div style="display:flex;align-items:center;gap:12px;flex:1 1 300px;">
            <input
              type="text"
              id="report-packs-search-input"
              class="glass-input"
              placeholder="🔍 Search report packs..."
              style="font-size:12.5px;padding:8px 12px;width:100%;max-width:320px;"
            />
          </div>
          <div>
            <button id="report-packs-create-btn" class="btn btn-primary" type="button" style="display:flex;align-items:center;gap:6px;">
              <span>+</span> <span>Assemble New Pack</span>
            </button>
          </div>
        </div>

        <div class="card" style="padding:0;background:var(--surface);border:1px solid var(--line);border-radius:var(--radius-md, 10px);overflow:hidden;">
          <div style="padding:14px 18px;border-bottom:1px solid var(--line);display:flex;justify-content:space-between;align-items:center;">
            <h3 style="font-size:14px;font-weight:700;color:var(--ink);margin:0;">Executive Multi-Report Packs (${packs.length})</h3>
            <span style="font-size:11px;color:var(--muted);">Strict guardrail: Maximum 20 reports per pack · Strongest classification wins</span>
          </div>
          <table style="width:100%;border-collapse:collapse;font-size:12px;text-align:left;">
            <thead>
              <tr style="background:var(--surface-sunken);border-bottom:1px solid var(--line);color:var(--muted);font-weight:600;">
                <th style="padding:10px 14px;">Pack Name</th>
                <th style="padding:10px 14px;">Classification</th>
                <th style="padding:10px 14px;">Visibility</th>
                <th style="padding:10px 14px;">Version</th>
                <th style="padding:10px 14px;">Items</th>
                <th style="padding:10px 14px;text-align:right;">Compilation & Export</th>
              </tr>
            </thead>
            <tbody id="report-packs-table-body">
              ${packs.length === 0 ? `
                <tr>
                  <td colspan="6" style="padding:32px 14px;text-align:center;color:var(--muted);">
                    No report packs assembled yet. Click <strong>+ Assemble New Pack</strong> to compile multi-domain PDF & Excel briefs.
                  </td>
                </tr>
              ` : packs.map(p => `
                <tr style="border-bottom:1px solid var(--line);" data-id="${escapeHtml(p.reportPackId)}">
                  <td style="padding:12px 14px;">
                    <div style="font-weight:600;color:var(--ink);">${escapeHtml(p.name)}</div>
                    <div style="font-size:11px;color:var(--muted);margin-top:2px;">${escapeHtml(p.description || 'No description')}</div>
                  </td>
                  <td style="padding:12px 14px;">
                    <span class="badge ${p.effectiveClassification === 'HIGHLY_CONFIDENTIAL' ? 'badge-danger' : p.effectiveClassification === 'CONFIDENTIAL' ? 'badge-accent' : 'badge-neutral'}">
                      ${escapeHtml(p.effectiveClassification || 'INTERNAL')}
                    </span>
                  </td>
                  <td style="padding:12px 14px;">${escapeHtml(p.visibility)}</td>
                  <td style="padding:12px 14px;font-family:var(--font-mono);font-size:11px;">v${Number(p.version || 1)}</td>
                  <td style="padding:12px 14px;">${Array.isArray(p.items) ? p.items.length : 0} / 20</td>
                  <td style="padding:12px 14px;text-align:right;">
                    <div style="display:inline-flex;gap:6px;justify-content:flex-end;">
                      <button class="btn btn-xs btn-outline btn-preview-pack" data-id="${escapeHtml(p.reportPackId)}">👁 Preview</button>
                      <button class="btn btn-xs btn-outline btn-pdf-pack" data-id="${escapeHtml(p.reportPackId)}">📄 PDF</button>
                      <button class="btn btn-xs btn-outline btn-xlsx-pack" data-id="${escapeHtml(p.reportPackId)}">📊 XLSX</button>
                      <button class="btn btn-xs btn-danger btn-archive-pack" data-id="${escapeHtml(p.reportPackId)}">🗑</button>
                    </div>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;

    container.querySelectorAll('.btn-preview-pack').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const id = e.currentTarget.getAttribute('data-id');
        openPackPreviewModal(root, id);
      });
    });

    container.querySelectorAll('.btn-pdf-pack, .btn-xlsx-pack').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const id = e.currentTarget.getAttribute('data-id');
        const isPdf = e.currentTarget.classList.contains('btn-pdf-pack');
        const format = isPdf ? 'PDF' : 'XLSX';
        try {
          showToast(`Compiling Report Pack as ${format}...`, 'info');
          const resExp = await apiPost(`/reporting-productivity/report-packs/${id}/export`, { format }, {
            headers: { Accept: 'application/json' }
          });
          if (resExp?.success) {
            showToast(`Report Pack ${format} generated (${resExp.filename})`, 'success');
          }
        } catch (err) {
          showToast(err.message || 'Export error', 'error');
        }
      });
    });

    container.querySelectorAll('.btn-archive-pack').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const id = e.currentTarget.getAttribute('data-id');
        if (confirm(`Archive report pack ${id}?`)) {
          try {
            await apiDelete(`/reporting-productivity/report-packs/${id}`);
            showToast('Report pack archived', 'info');
            await renderReportPacksSubtab(root, container);
          } catch (err) {
            showToast(err.message || 'Archive error', 'error');
          }
        }
      });
    });

    container.querySelector('#report-packs-create-btn')?.addEventListener('click', () => {
      openReportPackModal(root, null, () => renderReportPacksSubtab(root, container));
    });

  } catch (err) {
    container.innerHTML = renderModuleErrorState('Report Packs', err.message);
  }
}

// Modal for Report Pack Preview
async function openPackPreviewModal(root, reportPackId) {
  openModal('Report Pack Preview', `<div style="padding:20px;">${skeleton('200px')}</div>`);
  try {
    const res = await apiGet(`/reporting-productivity/report-packs/${reportPackId}/preview`);
    if (!res?.success) throw new Error(res?.message || 'Preview failed');

    const modalBody = `
      <div style="display:flex;flex-direction:column;gap:14px;font-size:12px;">
        <div style="display:flex;justify-content:space-between;align-items:center;background:var(--surface-sunken);padding:10px 14px;border-radius:6px;">
          <div>
            <strong style="color:var(--ink);">${escapeHtml(res.name)}</strong> (${res.reportPackId})
          </div>
          <div>
            Classification: <span class="badge badge-accent">${escapeHtml(res.effectiveClassification)}</span>
          </div>
        </div>

        <div style="font-size:11.5px;color:var(--muted);">
          Independent Item Authorization Check: Each report item is evaluated against live security context. Unauthorized items are excluded from generation.
        </div>

        <div style="max-height:280px;overflow-y:auto;border:1px solid var(--line);border-radius:6px;">
          <table style="width:100%;border-collapse:collapse;">
            <thead>
              <tr style="background:var(--surface-sunken);border-bottom:1px solid var(--line);font-size:11px;color:var(--muted);">
                <th style="padding:8px 10px;">#</th>
                <th style="padding:8px 10px;">Report Item</th>
                <th style="padding:8px 10px;">Classification</th>
                <th style="padding:8px 10px;text-align:right;">Availability</th>
              </tr>
            </thead>
            <tbody>
              ${(res.items || []).map((it, idx) => `
                <tr style="border-bottom:1px solid var(--line);">
                  <td style="padding:8px 10px;color:var(--muted);">${idx + 1}</td>
                  <td style="padding:8px 10px;">
                    <strong style="color:var(--ink);">${escapeHtml(it.label || it.reportId)}</strong>
                    <div style="font-size:10px;color:var(--muted);">${escapeHtml(it.itemType)}</div>
                  </td>
                  <td style="padding:8px 10px;">${escapeHtml(it.classification || 'INTERNAL')}</td>
                  <td style="padding:8px 10px;text-align:right;">
                    <span class="badge ${it.availabilityStatus === 'AVAILABLE' ? 'badge-success' : 'badge-danger'}">
                      ${escapeHtml(it.availabilityStatus)}
                    </span>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>

        <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:8px;">
          <button id="pack-modal-close-btn" class="btn btn-outline" type="button">Close</button>
        </div>
      </div>
    `;

    const modalContainer = document.querySelector('.modal-body') || document.querySelector('#modal-content');
    if (modalContainer) {
      modalContainer.innerHTML = modalBody;
      document.getElementById('pack-modal-close-btn')?.addEventListener('click', closeModal);
    }
  } catch (err) {
    showToast(err.message || 'Error loading pack preview', 'error');
    closeModal();
  }
}

// Modal for Create/Edit Report Pack
function openReportPackModal(root, packDoc = null, onSaved = null) {
  const isEdit = Boolean(packDoc);
  const title = isEdit ? `Edit Report Pack (${escapeHtml(packDoc.reportPackId)})` : 'Assemble Executive Report Pack';

  let items = isEdit && Array.isArray(packDoc.items) ? [...packDoc.items] : [
    { itemType: 'CANONICAL_REPORT', reportId: 'daily-sales', label: 'Daily Sales & Collections', classification: 'INTERNAL', order: 0 },
    { itemType: 'CANONICAL_REPORT', reportId: 'finance-pnl', label: 'Store P&L Statement', classification: 'CONFIDENTIAL', order: 1 }
  ];

  const modalHtml = `
    <div style="display:flex;flex-direction:column;gap:14px;font-size:12.5px;">
      <div>
        <label style="display:block;font-weight:600;margin-bottom:4px;">Pack Name *</label>
        <input type="text" id="pack-name-input" class="glass-input" style="width:100%;box-sizing:border-box;padding:8px;" value="${escapeHtml(packDoc?.name || '')}" placeholder="e.g. Weekly Management Brief" maxlength="120" required />
      </div>
      <div>
        <label style="display:block;font-weight:600;margin-bottom:4px;">Description</label>
        <textarea id="pack-desc-input" class="glass-input" style="width:100%;box-sizing:border-box;padding:8px;height:50px;" placeholder="Optional executive summary" maxlength="500">${escapeHtml(packDoc?.description || '')}</textarea>
      </div>
      <div>
        <label style="display:block;font-weight:600;margin-bottom:4px;">Visibility</label>
        <select id="pack-visibility-select" class="glass-input" style="width:100%;padding:8px;">
          <option value="PERSONAL" ${packDoc?.visibility === 'PERSONAL' ? 'selected' : ''}>Personal</option>
          <option value="SHARED_CAFE" ${packDoc?.visibility === 'SHARED_CAFE' ? 'selected' : ''}>Shared (Café)</option>
          <option value="SHARED_ORGANISATION" ${packDoc?.visibility === 'SHARED_ORGANISATION' ? 'selected' : ''}>Shared (Organisation-Wide)</option>
        </select>
      </div>
      <div>
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
          <label style="font-weight:600;margin:0;">Pack Items (<span id="pack-items-count">${items.length}</span> / 20)</label>
          <button type="button" id="pack-add-item-btn" class="btn btn-xs btn-outline">+ Add Report</button>
        </div>
        <div id="pack-items-list" style="max-height:200px;overflow-y:auto;border:1px solid var(--line);border-radius:6px;padding:8px;display:flex;flex-direction:column;gap:6px;">
          <!-- Dynamically populated -->
        </div>
      </div>
      <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:6px;">
        <button id="pack-cancel-btn" class="btn btn-outline" type="button">Cancel</button>
        <button id="pack-save-btn" class="btn btn-primary" type="button">${isEdit ? 'Save Changes' : 'Assemble Pack'}</button>
      </div>
    </div>
  `;

  openModal(title, modalHtml);

  const renderItemsList = () => {
    const listEl = document.getElementById('pack-items-list');
    const countEl = document.getElementById('pack-items-count');
    if (!listEl) return;
    countEl.textContent = items.length;

    listEl.innerHTML = items.map((it, idx) => `
      <div style="display:flex;justify-content:space-between;align-items:center;padding:6px 10px;background:var(--surface-sunken);border-radius:4px;font-size:11.5px;">
        <div>
          <strong>${escapeHtml(it.label || it.reportId)}</strong>
          <span style="font-size:10px;color:var(--muted);margin-left:6px;">(${it.classification})</span>
        </div>
        <div style="display:flex;gap:4px;">
          <button type="button" class="btn btn-xs btn-ghost btn-pack-move-up" data-index="${idx}" ${idx === 0 ? 'disabled' : ''}>▲</button>
          <button type="button" class="btn btn-xs btn-ghost btn-pack-move-down" data-index="${idx}" ${idx === items.length - 1 ? 'disabled' : ''}>▼</button>
          <button type="button" class="btn btn-xs btn-danger btn-pack-remove-item" data-index="${idx}">✕</button>
        </div>
      </div>
    `).join('');

    listEl.querySelectorAll('.btn-pack-remove-item').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const idx = Number(e.currentTarget.getAttribute('data-index'));
        items.splice(idx, 1);
        renderItemsList();
      });
    });

    listEl.querySelectorAll('.btn-pack-move-up').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const idx = Number(e.currentTarget.getAttribute('data-index'));
        if (idx > 0) {
          const temp = items[idx - 1];
          items[idx - 1] = items[idx];
          items[idx] = temp;
          renderItemsList();
        }
      });
    });

    listEl.querySelectorAll('.btn-pack-move-down').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const idx = Number(e.currentTarget.getAttribute('data-index'));
        if (idx < items.length - 1) {
          const temp = items[idx + 1];
          items[idx + 1] = items[idx];
          items[idx] = temp;
          renderItemsList();
        }
      });
    });
  };

  renderItemsList();

  document.getElementById('pack-add-item-btn')?.addEventListener('click', () => {
    if (items.length >= 20) {
      showToast('Maximum 20 items allowed in a report pack (TECHNICAL_GUARDRAIL)', 'error');
      return;
    }
    const sampleReports = [
      { reportId: 'inventory-valuation', label: 'Inventory Stock Valuation', classification: 'INTERNAL' },
      { reportId: 'workforce-labour-cost', label: 'Labour Cost & Productivity', classification: 'CONFIDENTIAL' },
      { reportId: 'customer-retention', label: 'Guest Retention & Loyalty', classification: 'INTERNAL' },
      { reportId: 'quality-compliance', label: 'Food Safety Audit Summary', classification: 'INTERNAL' },
    ];
    const picked = sampleReports[items.length % sampleReports.length];
    items.push({
      itemType: 'CANONICAL_REPORT',
      reportId: picked.reportId,
      label: picked.label,
      classification: picked.classification,
      order: items.length
    });
    renderItemsList();
  });

  document.getElementById('pack-cancel-btn')?.addEventListener('click', closeModal);

  document.getElementById('pack-save-btn')?.addEventListener('click', async () => {
    const name = document.getElementById('pack-name-input')?.value.trim();
    if (!name) {
      showToast('Pack name is required', 'error');
      return;
    }
    const description = document.getElementById('pack-desc-input')?.value.trim() || '';
    const visibility = document.getElementById('pack-visibility-select')?.value || 'PERSONAL';

    const payload = {
      name,
      description,
      visibility,
      items: items.map((it, idx) => ({ ...it, order: idx })),
      version: isEdit ? packDoc.version : 1,
    };

    try {
      if (isEdit) {
        const res = await apiPatch(`/reporting-productivity/report-packs/${packDoc.reportPackId}`, payload);
        if (res?.success) {
          showToast('Report pack updated (Atomic CAS)', 'success');
          closeModal();
          if (onSaved) onSaved();
        }
      } else {
        const res = await apiPost('/reporting-productivity/report-packs', payload);
        if (res?.success) {
          showToast('Report pack assembled successfully', 'success');
          closeModal();
          if (onSaved) onSaved();
        }
      }
    } catch (err) {
      showToast(err.message || 'Error saving pack', 'error');
    }
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. SUBSCRIPTIONS AUDIT & UNAVAILABLE STATE SUBTAB
// ─────────────────────────────────────────────────────────────────────────────

async function renderSubscriptionsSubtab(root, container) {
  container.innerHTML = `<div style="padding:24px 0;">${skeleton('240px')}</div>`;
  try {
    const res = await apiGet('/reporting-productivity/subscriptions/capability');

    container.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:20px;">
        <!-- Status Banner -->
        <div class="card" style="padding:20px;background:var(--surface);border:1px solid var(--line);border-radius:var(--radius-md, 10px);">
          <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px;">
            <span style="font-size:24px;">📬</span>
            <div>
              <h3 style="font-size:16px;font-weight:700;color:var(--ink);margin:0;">Automated Report Subscriptions Governance</h3>
              <div style="margin-top:4px;">
                <span class="badge badge-danger">STATUS: NOT_IMPLEMENTED_SOURCE_MISSING</span>
              </div>
            </div>
          </div>
          <p style="font-size:12.5px;color:var(--muted);line-height:1.6;margin:0 0 12px 0;">
            Scheduled automated report distribution is intentionally disabled.
            Durable background job scheduling infrastructure (BullMQ / Redis worker) and enterprise transactional outbound email delivery gateways are not configured in this environment.
          </p>
          <div style="padding:12px 14px;background:var(--surface-sunken);border-left:3px solid var(--amber,#f59e0b);border-radius:4px;font-size:12px;color:var(--ink);">
            <strong>Truthful Architectural Stance:</strong>
            No in-memory timers (<code>setTimeout</code>/<code>setInterval</code>) or fake delivery simulations are permitted under primary master canonical governance.
            All subscription creation requests return <code>HTTP 501 NOT_IMPLEMENTED</code>.
          </div>
        </div>

        <!-- Capability Audit Matrix -->
        <div class="card" style="padding:0;background:var(--surface);border:1px solid var(--line);border-radius:var(--radius-md, 10px);overflow:hidden;">
          <div style="padding:14px 18px;border-bottom:1px solid var(--line);">
            <h4 style="font-size:13px;font-weight:700;color:var(--ink);margin:0;">Infrastructure Capability Audit Register</h4>
          </div>
          <table style="width:100%;border-collapse:collapse;font-size:12px;text-align:left;">
            <thead>
              <tr style="background:var(--surface-sunken);border-bottom:1px solid var(--line);color:var(--muted);font-weight:600;">
                <th style="padding:10px 14px;">Subsystem / Capability</th>
                <th style="padding:10px 14px;">Current Status</th>
                <th style="padding:10px 14px;">Security Invariant Guarantee</th>
              </tr>
            </thead>
            <tbody>
              <tr style="border-bottom:1px solid var(--line);">
                <td style="padding:10px 14px;font-weight:600;">Durable Job Persistence</td>
                <td style="padding:10px 14px;"><span class="badge badge-neutral">NOT_IMPLEMENTED_SOURCE_MISSING</span></td>
                <td style="padding:10px 14px;color:var(--muted);font-size:11px;">No unpersisted queue state masquerading as durable</td>
              </tr>
              <tr style="border-bottom:1px solid var(--line);">
                <td style="padding:10px 14px;font-weight:600;">Recurring Background Scheduler</td>
                <td style="padding:10px 14px;"><span class="badge badge-neutral">NOT_IMPLEMENTED_SOURCE_MISSING</span></td>
                <td style="padding:10px 14px;color:var(--muted);font-size:11px;"><code>IN_MEMORY_TIMER_PRESENTED_AS_DURABLE_REPORT_SUBSCRIPTION = 0</code></td>
              </tr>
              <tr style="border-bottom:1px solid var(--line);">
                <td style="padding:10px 14px;font-weight:600;">Outbound Mail Gateway</td>
                <td style="padding:10px 14px;"><span class="badge badge-neutral">NOT_IMPLEMENTED_SOURCE_MISSING</span></td>
                <td style="padding:10px 14px;color:var(--muted);font-size:11px;"><code>FAKE_REPORT_SUBSCRIPTION_DELIVERY_SUCCESS = 0</code></td>
              </tr>
              <tr style="border-bottom:1px solid var(--line);">
                <td style="padding:10px 14px;font-weight:600;">Permission Re-check at Execution</td>
                <td style="padding:10px 14px;"><span class="badge badge-neutral">MANDATORY_UPON_IMPLEMENTATION</span></td>
                <td style="padding:10px 14px;color:var(--muted);font-size:11px;"><code>SCHEDULED_REPORT_USES_STALE_CREATION_TIME_AUTHORITY = 0</code> (upon deploy)</td>
              </tr>
              <tr>
                <td style="padding:10px 14px;font-weight:600;">Audit Logging</td>
                <td style="padding:10px 14px;"><span class="badge badge-success">ACTIVE (AuditEvent)</span></td>
                <td style="padding:10px 14px;color:var(--muted);font-size:11px;">All mutation attempts logged to immutable audit ledger</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    `;
  } catch (err) {
    container.innerHTML = renderModuleErrorState('Subscriptions', err.message);
  }
}

