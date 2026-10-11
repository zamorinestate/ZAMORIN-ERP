// =============================================================================
// ZAMORIN CAFÉ ERP — FORECASTS, PREDICTIVE INSIGHTS & ASSISTED ANALYSIS (PACKAGE P17)
// =============================================================================
// Real, executable forecasting workspace utilizing persisted sales records,
// forward-looking stockout risk estimation, supplier price variance tracking,
// holdout accuracy evaluations, and controlled assisted business analysis.
// =============================================================================

import { apiGet, apiPost } from '../apiClient.js';
import { showToast, skeleton } from '../components.js';
import { state } from '../state.js';
import { icon } from '../icons.js';

let activeTab = 'sales-forecast';
let selectedCafe = 'ALL';
let selectedHorizon = 7;
let selectedMethod = 'DAY_OF_WEEK_SEASONAL';

let cachedForecast = null;
let cachedStockoutRisk = null;
let cachedPriceVariance = null;
let cachedEvaluation = null;
let cachedAnalysisAnswer = null;
let isLoading = false;

export function setForecastsActiveTab(tab) {
  activeTab = tab || 'sales-forecast';
}

function formatPaisa(paisa) {
  if (paisa === null || paisa === undefined || isNaN(paisa)) return '₹0.00';
  return '₹' + (Number(paisa) / 100).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function renderForecastsInsights() {
  const isOwner = state.currentUser?.role === 'owner';
  const isCafeAdmin = state.currentUser?.role === 'cafe_admin';
  const assignedCafes = state.currentUser?.assignedCafeIds || ['KOZHIKODE_BEACH', 'WAYANAD'];

  return `
    <div class="page-enter forecasts-insights-workspace" style="display:flex;flex-direction:column;gap:20px;padding-bottom:60px;">
      <!-- Header -->
      <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:16px;">
        <div>
          <div style="display:inline-flex;align-items:center;gap:6px;padding:4px 10px;background:rgba(217,119,6,0.12);border:1px solid rgba(217,119,6,0.3);border-radius:20px;font-size:11px;font-weight:700;color:#f59e0b;letter-spacing:0.5px;margin-bottom:8px;">
            <span style="width:6px;height:6px;border-radius:50%;background:#f59e0b;"></span>
            PREDICTIVE INTELLIGENCE & ASSISTED ANALYSIS · PACKAGE P17
          </div>
          <h1 style="font-size:24px;font-weight:800;color:var(--text-primary,#fff);margin:0 0 4px 0;letter-spacing:-0.5px;">
            Forecasts & Operational Insights
          </h1>
          <div style="font-size:13px;color:var(--text-muted,#94a3b8);">
            Authoritative Sales & Demand Projections, Stockout Risk Alerts, Supplier Price Movement & Assisted Business Inquiries
          </div>
        </div>

        <!-- Controls -->
        <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;">
          <!-- Cafe Scope Filter -->
          ${
            isCafeAdmin
              ? `<div style="background:var(--surface-card,#1e293b);padding:8px 12px;border:1px solid var(--border-color,#334155);border-radius:8px;font-size:13px;font-weight:600;color:var(--text-primary,#fff);">
                  Outlet: <strong>${assignedCafes[0] || 'ASSIGNED CAFÉ'}</strong>
                </div>`
              : `<select id="fcst-cafe-filter" class="form-select" style="background:var(--surface-card,#1e293b);color:var(--text-primary,#fff);border:1px solid var(--border-color,#334155);padding:8px 12px;border-radius:8px;font-size:13px;font-weight:600;">
                  <option value="ALL" ${selectedCafe === 'ALL' ? 'selected' : ''}>Enterprise (All Outlets)</option>
                  ${assignedCafes
                    .map((c) => `<option value="${c}" ${selectedCafe === c ? 'selected' : ''}>${c}</option>`)
                    .join('')}
                </select>`
          }

          <!-- Horizon Selector -->
          <select id="fcst-horizon-select" class="form-select" style="background:var(--surface-card,#1e293b);color:var(--text-primary,#fff);border:1px solid var(--border-color,#334155);padding:8px 12px;border-radius:8px;font-size:13px;font-weight:600;">
            <option value="7" ${selectedHorizon === 7 ? 'selected' : ''}>Horizon: 7 Days</option>
            <option value="14" ${selectedHorizon === 14 ? 'selected' : ''}>Horizon: 14 Days</option>
            <option value="30" ${selectedHorizon === 30 ? 'selected' : ''}>Horizon: 30 Days</option>
          </select>

          <!-- Method Selector -->
          <select id="fcst-method-select" class="form-select" style="background:var(--surface-card,#1e293b);color:var(--text-primary,#fff);border:1px solid var(--border-color,#334155);padding:8px 12px;border-radius:8px;font-size:13px;font-weight:600;">
            <option value="DAY_OF_WEEK_SEASONAL" ${selectedMethod === 'DAY_OF_WEEK_SEASONAL' ? 'selected' : ''}>Day-of-Week Seasonal</option>
            <option value="MOVING_AVERAGE" ${selectedMethod === 'MOVING_AVERAGE' ? 'selected' : ''}>7-Day Moving Average</option>
          </select>

          <!-- Action Buttons -->
          ${
            isOwner
              ? `<span style="font-size:12px;color:#94a3b8;background:rgba(255,255,255,0.06);padding:8px 12px;border-radius:8px;border:1px solid rgba(255,255,255,0.1);">
                  ${icon('shield')} Owner: Read-Only Insight
                </span>`
              : `<button id="fcst-btn-generate" class="btn btn-primary" style="display:inline-flex;align-items:center;gap:6px;padding:8px 14px;background:var(--gold-500,#96733a);color:#fff;border:none;border-radius:8px;font-size:13px;font-weight:700;cursor:pointer;">
                  ${icon('refresh')} Generate Forecast
                </button>
                <button id="fcst-btn-evaluate" class="btn btn-secondary" style="display:inline-flex;align-items:center;gap:6px;padding:8px 14px;background:rgba(255,255,255,0.08);color:#fff;border:1px solid rgba(255,255,255,0.15);border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;">
                  ${icon('tasks')} Evaluate Accuracy
                </button>`
          }
        </div>
      </div>

      <!-- Navigation Tabs -->
      <div class="tab-bar" style="display:flex;gap:8px;border-bottom:1px solid var(--border-color,#334155);padding-bottom:4px;overflow-x:auto;">
        <button class="fcst-tab-btn ${activeTab === 'sales-forecast' ? 'active' : ''}" data-tab="sales-forecast" style="padding:8px 16px;border-radius:6px;font-size:13px;font-weight:700;background:${activeTab === 'sales-forecast' ? 'var(--gold-500,#96733a)' : 'transparent'};color:${activeTab === 'sales-forecast' ? '#fff' : 'var(--text-muted,#94a3b8)'};border:none;cursor:pointer;">
          Sales & Demand Forecast
        </button>
        <button class="fcst-tab-btn ${activeTab === 'stockout-risk' ? 'active' : ''}" data-tab="stockout-risk" style="padding:8px 16px;border-radius:6px;font-size:13px;font-weight:700;background:${activeTab === 'stockout-risk' ? 'var(--gold-500,#96733a)' : 'transparent'};color:${activeTab === 'stockout-risk' ? '#fff' : 'var(--text-muted,#94a3b8)'};border:none;cursor:pointer;">
          Stockout Risk Intelligence
        </button>
        <button class="fcst-tab-btn ${activeTab === 'price-variance' ? 'active' : ''}" data-tab="price-variance" style="padding:8px 16px;border-radius:6px;font-size:13px;font-weight:700;background:${activeTab === 'price-variance' ? 'var(--gold-500,#96733a)' : 'transparent'};color:${activeTab === 'price-variance' ? '#fff' : 'var(--text-muted,#94a3b8)'};border:none;cursor:pointer;">
          Supplier Price Variance
        </button>
        <button class="fcst-tab-btn ${activeTab === 'accuracy-eval' ? 'active' : ''}" data-tab="accuracy-eval" style="padding:8px 16px;border-radius:6px;font-size:13px;font-weight:700;background:${activeTab === 'accuracy-eval' ? 'var(--gold-500,#96733a)' : 'transparent'};color:${activeTab === 'accuracy-eval' ? '#fff' : 'var(--text-muted,#94a3b8)'};border:none;cursor:pointer;">
          Accuracy & Holdout Evaluation
        </button>
        <button class="fcst-tab-btn ${activeTab === 'assisted-analysis' ? 'active' : ''}" data-tab="assisted-analysis" style="padding:8px 16px;border-radius:6px;font-size:13px;font-weight:700;background:${activeTab === 'assisted-analysis' ? 'var(--gold-500,#96733a)' : 'transparent'};color:${activeTab === 'assisted-analysis' ? '#fff' : 'var(--text-muted,#94a3b8)'};border:none;cursor:pointer;">
          Assisted Business Inquiry
        </button>
      </div>

      <!-- Main Content Container -->
      <div id="fcst-content-area">
        ${renderActiveTabContent()}
      </div>
    </div>
  `;
}

function renderActiveTabContent() {
  if (isLoading) {
    return `
      <div style="padding:40px;text-align:center;color:var(--text-muted,#94a3b8);">
        <div class="spinner" style="margin:0 auto 16px auto;width:32px;height:32px;border:3px solid rgba(255,255,255,0.1);border-top-color:var(--gold-500,#96733a);border-radius:50%;animation:spin 1s linear infinite;"></div>
        <div>Loading predictive intelligence from authoritative database records...</div>
      </div>
    `;
  }

  switch (activeTab) {
    case 'sales-forecast':
      return renderSalesForecastTab();
    case 'stockout-risk':
      return renderStockoutRiskTab();
    case 'price-variance':
      return renderPriceVarianceTab();
    case 'accuracy-eval':
      return renderAccuracyEvalTab();
    case 'assisted-analysis':
      return renderAssistedAnalysisTab();
    default:
      return renderSalesForecastTab();
  }
}

function renderSalesForecastTab() {
  if (!cachedForecast) {
    return `
      <div style="background:var(--surface-card,#1e293b);border:1px solid var(--border-color,#334155);border-radius:12px;padding:32px;text-align:center;">
        <div style="font-size:36px;margin-bottom:12px;">📊</div>
        <h3 style="font-size:18px;font-weight:700;color:var(--text-primary,#fff);margin:0 0 8px 0;">No Active Forecast Found</h3>
        <p style="font-size:14px;color:var(--text-muted,#94a3b8);max-width:500px;margin:0 auto 20px auto;">
          Click "Generate Forecast" above to run statistical models using finalized commercial sales records.
        </p>
      </div>
    `;
  }

  const f = cachedForecast;
  const statusColors = {
    READY: '#10b981',
    INSUFFICIENT_HISTORY: '#ef4444',
    DATA_QUALITY_WARNING: '#f59e0b',
  };
  const statusColor = statusColors[f.status] || '#94a3b8';

  return `
    <div style="display:flex;flex-direction:column;gap:20px;">
      <!-- Warnings / Quality Banners -->
      ${
        f.status !== 'READY' && f.warningDetails && f.warningDetails.length > 0
          ? `<div style="background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.3);border-radius:10px;padding:14px 18px;display:flex;align-items:flex-start;gap:12px;">
              <span style="color:#ef4444;font-size:18px;">⚠️</span>
              <div>
                <strong style="color:#ef4444;font-size:14px;">Data Quality / Sparsity Notice (${f.status}):</strong>
                <ul style="margin:4px 0 0 0;padding-left:18px;font-size:13px;color:#fca5a5;">
                  ${f.warningDetails.map((w) => `<li>${w}</li>`).join('')}
                </ul>
              </div>
            </div>`
          : ''
      }

      <!-- Top KPI Cards -->
      <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(220px, 1fr));gap:16px;">
        <div style="background:var(--surface-card,#1e293b);border:1px solid var(--border-color,#334155);border-radius:12px;padding:18px;">
          <div style="font-size:12px;font-weight:600;color:var(--text-muted,#94a3b8);margin-bottom:6px;">TOTAL PREDICTED REVENUE</div>
          <div style="font-size:24px;font-weight:800;color:#10b981;">${formatPaisa(f.summary?.totalPredictedRevenuePaisa)}</div>
          <div style="font-size:11px;color:var(--text-muted,#94a3b8);margin-top:4px;">Across ${f.horizonDays} days (${f.method})</div>
        </div>

        <div style="background:var(--surface-card,#1e293b);border:1px solid var(--border-color,#334155);border-radius:12px;padding:18px;">
          <div style="font-size:12px;font-weight:600;color:var(--text-muted,#94a3b8);margin-bottom:6px;">AVERAGE DAILY EXPECTATION</div>
          <div style="font-size:24px;font-weight:800;color:#38bdf8;">${formatPaisa(f.summary?.avgDailyRevenuePaisa)}</div>
          <div style="font-size:11px;color:var(--text-muted,#94a3b8);margin-top:4px;">Expected daily trading run rate</div>
        </div>

        <div style="background:var(--surface-card,#1e293b);border:1px solid var(--border-color,#334155);border-radius:12px;padding:18px;">
          <div style="font-size:12px;font-weight:600;color:var(--text-muted,#94a3b8);margin-bottom:6px;">TOTAL PREDICTED ITEMS</div>
          <div style="font-size:24px;font-weight:800;color:#f59e0b;">${(f.summary?.totalPredictedItemsCount || 0).toLocaleString()} units</div>
          <div style="font-size:11px;color:var(--text-muted,#94a3b8);margin-top:4px;">Projected customer orders volume</div>
        </div>

        <div style="background:var(--surface-card,#1e293b);border:1px solid var(--border-color,#334155);border-radius:12px;padding:18px;">
          <div style="font-size:12px;font-weight:600;color:var(--text-muted,#94a3b8);margin-bottom:6px;">MODEL RUN & STATUS</div>
          <div style="display:flex;align-items:center;gap:8px;">
            <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${statusColor};"></span>
            <span style="font-size:18px;font-weight:800;color:var(--text-primary,#fff);">${f.status}</span>
          </div>
          <div style="font-size:11px;color:var(--text-muted,#94a3b8);margin-top:4px;">ID: ${f.forecastId} · Cutoff: ${f.cutoffDate}</div>
        </div>
      </div>

      <!-- Daily Revenue Projections Table -->
      <div style="background:var(--surface-card,#1e293b);border:1px solid var(--border-color,#334155);border-radius:12px;padding:20px;">
        <h3 style="font-size:16px;font-weight:700;color:var(--text-primary,#fff);margin:0 0 16px 0;">
          Daily Projected Revenue Breakdown (with ~80% Confidence Range)
        </h3>
        <div style="overflow-x:auto;">
          <table style="width:100%;border-collapse:collapse;font-size:13px;text-align:left;">
            <thead>
              <tr style="border-bottom:1px solid var(--border-color,#334155);color:var(--text-muted,#94a3b8);">
                <th style="padding:10px 12px;">DATE</th>
                <th style="padding:10px 12px;">DAY</th>
                <th style="padding:10px 12px;">PREDICTED REVENUE</th>
                <th style="padding:10px 12px;">CONFIDENCE RANGE (LOW – HIGH)</th>
                <th style="padding:10px 12px;">CHANNELS BREAKDOWN</th>
              </tr>
            </thead>
            <tbody>
              ${(f.revenuePredictions || [])
                .map(
                  (r) => `
                <tr style="border-bottom:1px solid rgba(255,255,255,0.05);color:var(--text-primary,#fff);">
                  <td style="padding:10px 12px;font-weight:600;">${r.date}</td>
                  <td style="padding:10px 12px;color:var(--text-muted,#94a3b8);">${r.dayOfWeek}</td>
                  <td style="padding:10px 12px;font-weight:700;color:#10b981;">${formatPaisa(r.predictedRevenuePaisa)}</td>
                  <td style="padding:10px 12px;color:var(--text-muted,#94a3b8);">
                    ${formatPaisa(r.confidenceLowPaisa)} – ${formatPaisa(r.confidenceHighPaisa)}
                  </td>
                  <td style="padding:10px 12px;">
                    ${(r.channelBreakdown || [])
                      .map((c) => `<span style="display:inline-block;background:rgba(255,255,255,0.08);padding:2px 6px;border-radius:4px;font-size:11px;margin-right:4px;">${c.channel}: ${formatPaisa(c.predictedRevenuePaisa)}</span>`)
                      .join('') || '<span style="color:#64748b;">All Channels</span>'}
                  </td>
                </tr>
              `
                )
                .join('')}
            </tbody>
          </table>
        </div>
      </div>

      <!-- Top Demand Items Table -->
      <div style="background:var(--surface-card,#1e293b);border:1px solid var(--border-color,#334155);border-radius:12px;padding:20px;">
        <h3 style="font-size:16px;font-weight:700;color:var(--text-primary,#fff);margin:0 0 16px 0;">
          Top Expected Demand Menu Items
        </h3>
        <div style="overflow-x:auto;">
          <table style="width:100%;border-collapse:collapse;font-size:13px;text-align:left;">
            <thead>
              <tr style="border-bottom:1px solid var(--border-color,#334155);color:var(--text-muted,#94a3b8);">
                <th style="padding:10px 12px;">ITEM ID</th>
                <th style="padding:10px 12px;">MENU ITEM</th>
                <th style="padding:10px 12px;">CATEGORY</th>
                <th style="padding:10px 12px;">PROJECTED DEMAND (UNITS)</th>
              </tr>
            </thead>
            <tbody>
              ${(f.summary?.topDemandItems || [])
                .map(
                  (item) => `
                <tr style="border-bottom:1px solid rgba(255,255,255,0.05);color:var(--text-primary,#fff);">
                  <td style="padding:10px 12px;font-family:monospace;color:#60a5fa;">${item.menuItemId}</td>
                  <td style="padding:10px 12px;font-weight:700;">${item.itemName}</td>
                  <td style="padding:10px 12px;color:var(--text-muted,#94a3b8);">${item.category}</td>
                  <td style="padding:10px 12px;font-weight:800;color:#f59e0b;">${item.totalPredictedQuantity} units</td>
                </tr>
              `
                )
                .join('')}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;
}

function renderStockoutRiskTab() {
  if (!cachedStockoutRisk) {
    return `
      <div style="background:var(--surface-card,#1e293b);border:1px solid var(--border-color,#334155);border-radius:12px;padding:32px;text-align:center;">
        <div style="font-size:36px;margin-bottom:12px;">📦</div>
        <h3 style="font-size:18px;font-weight:700;color:var(--text-primary,#fff);margin:0 0 8px 0;">No Stockout Evaluation Loaded</h3>
        <p style="font-size:14px;color:var(--text-muted,#94a3b8);max-width:500px;margin:0 auto 20px auto;">
          Click to load forward-looking stockout risk intelligence for the selected café.
        </p>
        <button id="fcst-btn-load-risk" class="btn btn-primary" style="padding:8px 16px;background:var(--gold-500,#96733a);color:#fff;border:none;border-radius:8px;font-weight:700;cursor:pointer;">
          Load Stockout Risks
        </button>
      </div>
    `;
  }

  const s = cachedStockoutRisk;
  const riskBadges = {
    CRITICAL: { bg: 'rgba(239,68,68,0.2)', text: '#ef4444', border: 'rgba(239,68,68,0.4)' },
    HIGH: { bg: 'rgba(245,158,11,0.2)', text: '#f59e0b', border: 'rgba(245,158,11,0.4)' },
    MEDIUM: { bg: 'rgba(234,179,8,0.2)', text: '#eab308', border: 'rgba(234,179,8,0.4)' },
    LOW: { bg: 'rgba(59,130,246,0.2)', text: '#60a5fa', border: 'rgba(59,130,246,0.4)' },
    NONE: { bg: 'rgba(16,185,129,0.2)', text: '#10b981', border: 'rgba(16,185,129,0.4)' },
  };

  return `
    <div style="display:flex;flex-direction:column;gap:20px;">
      <!-- KPI Counts -->
      <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(180px, 1fr));gap:14px;">
        <div style="background:var(--surface-card,#1e293b);border:1px solid rgba(239,68,68,0.4);border-radius:12px;padding:16px;">
          <div style="font-size:11px;font-weight:700;color:#ef4444;">CRITICAL RISKS (< Lead Time)</div>
          <div style="font-size:24px;font-weight:800;color:#ef4444;margin-top:4px;">${s.riskSummary?.criticalCount || 0}</div>
        </div>

        <div style="background:var(--surface-card,#1e293b);border:1px solid rgba(245,158,11,0.4);border-radius:12px;padding:16px;">
          <div style="font-size:11px;font-weight:700;color:#f59e0b;">HIGH RISKS (Near Lead Time)</div>
          <div style="font-size:24px;font-weight:800;color:#f59e0b;margin-top:4px;">${s.riskSummary?.highCount || 0}</div>
        </div>

        <div style="background:var(--surface-card,#1e293b);border:1px solid rgba(234,179,8,0.4);border-radius:12px;padding:16px;">
          <div style="font-size:11px;font-weight:700;color:#eab308;">MEDIUM RISKS</div>
          <div style="font-size:24px;font-weight:800;color:#eab308;margin-top:4px;">${s.riskSummary?.mediumCount || 0}</div>
        </div>

        <div style="background:var(--surface-card,#1e293b);border:1px solid rgba(16,185,129,0.4);border-radius:12px;padding:16px;">
          <div style="font-size:11px;font-weight:700;color:#10b981;">ADEQUATELY STOCKED</div>
          <div style="font-size:24px;font-weight:800;color:#10b981;margin-top:4px;">${s.riskSummary?.safeCount || 0}</div>
        </div>
      </div>

      <!-- Items at Risk Table -->
      <div style="background:var(--surface-card,#1e293b);border:1px solid var(--border-color,#334155);border-radius:12px;padding:20px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;flex-wrap:wrap;gap:8px;">
          <h3 style="font-size:16px;font-weight:700;color:var(--text-primary,#fff);margin:0;">
            Forward-Looking Stockout Risk Register (${s.horizonDays}-Day Horizon)
          </h3>
          <span style="font-size:12px;color:var(--text-muted,#94a3b8);">Café: ${s.cafeId}</span>
        </div>

        <div style="overflow-x:auto;">
          <table style="width:100%;border-collapse:collapse;font-size:13px;text-align:left;">
            <thead>
              <tr style="border-bottom:1px solid var(--border-color,#334155);color:var(--text-muted,#94a3b8);">
                <th style="padding:10px 12px;">RAW MATERIAL</th>
                <th style="padding:10px 12px;">USABLE STOCK</th>
                <th style="padding:10px 12px;">INBOUND SUPPLY</th>
                <th style="padding:10px 12px;">LEAD TIME</th>
                <th style="padding:10px 12px;">DAYS TO STOCKOUT</th>
                <th style="padding:10px 12px;">RISK LEVEL</th>
                <th style="padding:10px 12px;">CONTRIBUTING FACTORS</th>
                <th style="padding:10px 12px;">ACTION</th>
              </tr>
            </thead>
            <tbody>
              ${(s.itemsAtRisk || [])
                .map((item) => {
                  const b = riskBadges[item.riskLevel] || riskBadges.NONE;
                  return `
                  <tr style="border-bottom:1px solid rgba(255,255,255,0.05);color:var(--text-primary,#fff);">
                    <td style="padding:10px 12px;">
                      <div style="font-weight:700;">${item.itemName}</div>
                      <div style="font-size:11px;color:var(--text-muted,#94a3b8);">${item.itemId} · ${item.category}</div>
                    </td>
                    <td style="padding:10px 12px;font-weight:700;">
                      ${item.usableStock} ${item.baseUnit}
                      ${
                        item.quarantinedStock > 0 || item.expiredStock > 0
                          ? `<div style="font-size:10px;color:#fca5a5;">Blocked: ${item.quarantinedStock + item.expiredStock} ${item.baseUnit}</div>`
                          : ''
                      }
                    </td>
                    <td style="padding:10px 12px;color:#38bdf8;">
                      ${item.inboundStock > 0 ? `${item.inboundStock} ${item.baseUnit}` : '<span style="color:#64748b;">None</span>'}
                    </td>
                    <td style="padding:10px 12px;color:var(--text-muted,#94a3b8);">${item.leadTimeDays} days</td>
                    <td style="padding:10px 12px;font-weight:700;color:${item.daysUntilStockout <= item.leadTimeDays ? '#ef4444' : '#f59e0b'};">
                      ${item.daysUntilStockout !== null ? `${item.daysUntilStockout} days` : 'Safe'}
                    </td>
                    <td style="padding:10px 12px;">
                      <span style="background:${b.bg};color:${b.text};border:1px solid ${b.border};padding:3px 8px;border-radius:12px;font-size:11px;font-weight:700;">
                        ${item.riskLevel}
                      </span>
                    </td>
                    <td style="padding:10px 12px;font-size:12px;color:var(--text-muted,#94a3b8);max-width:260px;">
                      ${(item.contributingReasons || []).join('; ') || 'Normal burn rate buffer.'}
                    </td>
                    <td style="padding:10px 12px;">
                      <a href="#/procurement" style="color:var(--gold-500,#96733a);text-decoration:none;font-weight:600;font-size:12px;">
                        Replenishment Desk &rarr;
                      </a>
                    </td>
                  </tr>
                `;
                })
                .join('')}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;
}

function renderPriceVarianceTab() {
  if (!cachedPriceVariance) {
    return `
      <div style="background:var(--surface-card,#1e293b);border:1px solid var(--border-color,#334155);border-radius:12px;padding:32px;text-align:center;">
        <div style="font-size:36px;margin-bottom:12px;">🏷️</div>
        <h3 style="font-size:18px;font-weight:700;color:var(--text-primary,#fff);margin:0 0 8px 0;">No Price Variance Analysis Loaded</h3>
        <p style="font-size:14px;color:var(--text-muted,#94a3b8);max-width:500px;margin:0 auto 20px auto;">
          Click below to analyze recent purchase order unit rates against contracted vendor catalogue baselines.
        </p>
        <button id="fcst-btn-load-variance" class="btn btn-primary" style="padding:8px 16px;background:var(--gold-500,#96733a);color:#fff;border:none;border-radius:8px;font-weight:700;cursor:pointer;">
          Analyze Supplier Prices
        </button>
      </div>
    `;
  }

  const v = cachedPriceVariance;
  const severityBadges = {
    SEVERE_INCREASE: { bg: 'rgba(239,68,68,0.2)', text: '#ef4444', label: 'Severe Increase (>15%)' },
    MATERIAL_INCREASE: { bg: 'rgba(245,158,11,0.2)', text: '#f59e0b', label: 'Material Increase (>5%)' },
    STABLE: { bg: 'rgba(16,185,129,0.2)', text: '#10b981', label: 'Stable' },
    MATERIAL_DECREASE: { bg: 'rgba(59,130,246,0.2)', text: '#60a5fa', label: 'Favourable (< -5%)' },
    NO_CONTRACTED_BASELINE: { bg: 'rgba(148,163,184,0.2)', text: '#94a3b8', label: 'No Baseline' },
  };

  return `
    <div style="display:flex;flex-direction:column;gap:20px;">
      <!-- Summary Counts -->
      <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(200px, 1fr));gap:14px;">
        <div style="background:var(--surface-card,#1e293b);border:1px solid rgba(239,68,68,0.4);border-radius:12px;padding:16px;">
          <div style="font-size:11px;font-weight:700;color:#ef4444;">SEVERE PRICE INCREASES (>15%)</div>
          <div style="font-size:24px;font-weight:800;color:#ef4444;margin-top:4px;">${v.varianceSummary?.severeIncreaseCount || 0}</div>
        </div>

        <div style="background:var(--surface-card,#1e293b);border:1px solid rgba(245,158,11,0.4);border-radius:12px;padding:16px;">
          <div style="font-size:11px;font-weight:700;color:#f59e0b;">MATERIAL INCREASES (5–15%)</div>
          <div style="font-size:24px;font-weight:800;color:#f59e0b;margin-top:4px;">${v.varianceSummary?.materialIncreaseCount || 0}</div>
        </div>

        <div style="background:var(--surface-card,#1e293b);border:1px solid rgba(16,185,129,0.4);border-radius:12px;padding:16px;">
          <div style="font-size:11px;font-weight:700;color:#10b981;">STABLE LINES (&plusmn;5%)</div>
          <div style="font-size:24px;font-weight:800;color:#10b981;margin-top:4px;">${v.varianceSummary?.stableCount || 0}</div>
        </div>

        <div style="background:var(--surface-card,#1e293b);border:1px solid rgba(59,130,246,0.4);border-radius:12px;padding:16px;">
          <div style="font-size:11px;font-weight:700;color:#60a5fa;">FAVOURABLE SAVINGS</div>
          <div style="font-size:24px;font-weight:800;color:#60a5fa;margin-top:4px;">${v.varianceSummary?.materialDecreaseCount || 0}</div>
        </div>
      </div>

      <!-- Findings Table -->
      <div style="background:var(--surface-card,#1e293b);border:1px solid var(--border-color,#334155);border-radius:12px;padding:20px;">
        <h3 style="font-size:16px;font-weight:700;color:var(--text-primary,#fff);margin:0 0 16px 0;">
          Like-for-Like Purchase Order Unit Price Findings (${v.analysisWindowDays}-Day Window)
        </h3>
        <div style="overflow-x:auto;">
          <table style="width:100%;border-collapse:collapse;font-size:13px;text-align:left;">
            <thead>
              <tr style="border-bottom:1px solid var(--border-color,#334155);color:var(--text-muted,#94a3b8);">
                <th style="padding:10px 12px;">PO NUMBER</th>
                <th style="padding:10px 12px;">SUPPLIER</th>
                <th style="padding:10px 12px;">ITEM</th>
                <th style="padding:10px 12px;">PO BASE UNIT RATE</th>
                <th style="padding:10px 12px;">CONTRACTED BASELINE</th>
                <th style="padding:10px 12px;">VARIANCE (PAISA / %)</th>
                <th style="padding:10px 12px;">CLASSIFICATION</th>
              </tr>
            </thead>
            <tbody>
              ${(v.findings || [])
                .map((f) => {
                  const b = severityBadges[f.severity] || severityBadges.STABLE;
                  return `
                  <tr style="border-bottom:1px solid rgba(255,255,255,0.05);color:var(--text-primary,#fff);">
                    <td style="padding:10px 12px;font-family:monospace;color:#60a5fa;">${f.poNumber}</td>
                    <td style="padding:10px 12px;">${f.vendorName}</td>
                    <td style="padding:10px 12px;font-weight:600;">${f.itemName}</td>
                    <td style="padding:10px 12px;font-weight:700;">${formatPaisa(f.poBaseUnitPricePaisa)} / ${f.baseUnit}</td>
                    <td style="padding:10px 12px;color:var(--text-muted,#94a3b8);">
                      ${f.contractedBaseUnitPricePaisa ? `${formatPaisa(f.contractedBaseUnitPricePaisa)} / ${f.baseUnit}` : '<span style="color:#64748b;">No Contract</span>'}
                    </td>
                    <td style="padding:10px 12px;font-weight:700;color:${f.variancePercent > 0 ? '#ef4444' : f.variancePercent < 0 ? '#10b981' : '#94a3b8'};">
                      ${f.variancePercent !== null ? `${f.variancePercent > 0 ? '+' : ''}${f.variancePercent}% (${formatPaisa(f.variancePaisa)})` : 'N/A'}
                    </td>
                    <td style="padding:10px 12px;">
                      <span style="background:${b.bg};color:${b.text};padding:3px 8px;border-radius:12px;font-size:11px;font-weight:700;">
                        ${b.label}
                      </span>
                    </td>
                  </tr>
                `;
                })
                .join('')}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;
}

function renderAccuracyEvalTab() {
  if (!cachedEvaluation) {
    return `
      <div style="background:var(--surface-card,#1e293b);border:1px solid var(--border-color,#334155);border-radius:12px;padding:32px;text-align:center;">
        <div style="font-size:36px;margin-bottom:12px;">🎯</div>
        <h3 style="font-size:18px;font-weight:700;color:var(--text-primary,#fff);margin:0 0 8px 0;">No Holdout Accuracy Evaluation</h3>
        <p style="font-size:14px;color:var(--text-muted,#94a3b8);max-width:500px;margin:0 auto 20px auto;">
          Run historical holdout evaluation to compare model predictions against observed actuals without data leakage.
        </p>
        <button id="fcst-btn-run-eval" class="btn btn-primary" style="padding:8px 16px;background:var(--gold-500,#96733a);color:#fff;border:none;border-radius:8px;font-weight:700;cursor:pointer;">
          Run Holdout Evaluation
        </button>
      </div>
    `;
  }

  const e = cachedEvaluation;

  return `
    <div style="display:flex;flex-direction:column;gap:20px;">
      <!-- Evaluation KPIs -->
      <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(200px, 1fr));gap:14px;">
        <div style="background:var(--surface-card,#1e293b);border:1px solid var(--border-color,#334155);border-radius:12px;padding:16px;">
          <div style="font-size:11px;font-weight:700;color:var(--text-muted,#94a3b8);">MEAN ABSOLUTE ERROR (MAE)</div>
          <div style="font-size:24px;font-weight:800;color:#38bdf8;margin-top:4px;">${formatPaisa(e.mae)}</div>
          <div style="font-size:11px;color:var(--text-muted,#94a3b8);margin-top:4px;">Average prediction error per day</div>
        </div>

        <div style="background:var(--surface-card,#1e293b);border:1px solid var(--border-color,#334155);border-radius:12px;padding:16px;">
          <div style="font-size:11px;font-weight:700;color:var(--text-muted,#94a3b8);">WAPE (PERCENTAGE ERROR)</div>
          <div style="font-size:24px;font-weight:800;color:#f59e0b;margin-top:4px;">${e.wapePercent}%</div>
          <div style="font-size:11px;color:var(--text-muted,#94a3b8);margin-top:4px;">Weighted Absolute Percentage Error</div>
        </div>

        <div style="background:var(--surface-card,#1e293b);border:1px solid var(--border-color,#334155);border-radius:12px;padding:16px;">
          <div style="font-size:11px;font-weight:700;color:var(--text-muted,#94a3b8);">NAIVE BASELINE MAE</div>
          <div style="font-size:24px;font-weight:800;color:#94a3b8;margin-top:4px;">${formatPaisa(e.baselineMae)}</div>
          <div style="font-size:11px;color:var(--text-muted,#94a3b8);margin-top:4px;">Simple historical mean benchmark</div>
        </div>

        <div style="background:var(--surface-card,#1e293b);border:1px solid var(--border-color,#334155);border-radius:12px;padding:16px;">
          <div style="font-size:11px;font-weight:700;color:var(--text-muted,#94a3b8);">ACCURACY IMPROVEMENT</div>
          <div style="font-size:24px;font-weight:800;color:${e.maeImprovementPercent >= 0 ? '#10b981' : '#ef4444'};margin-top:4px;">
            ${e.maeImprovementPercent >= 0 ? '+' : ''}${e.maeImprovementPercent}%
          </div>
          <div style="font-size:11px;color:var(--text-muted,#94a3b8);margin-top:4px;">Model reduction in error vs baseline</div>
        </div>
      </div>

      <!-- Actual vs Predicted Table -->
      <div style="background:var(--surface-card,#1e293b);border:1px solid var(--border-color,#334155);border-radius:12px;padding:20px;">
        <h3 style="font-size:16px;font-weight:700;color:var(--text-primary,#fff);margin:0 0 16px 0;">
          Holdout Comparison: Observed Actuals vs Forecasted Predictions
        </h3>
        <div style="overflow-x:auto;">
          <table style="width:100%;border-collapse:collapse;font-size:13px;text-align:left;">
            <thead>
              <tr style="border-bottom:1px solid var(--border-color,#334155);color:var(--text-muted,#94a3b8);">
                <th style="padding:10px 12px;">DATE</th>
                <th style="padding:10px 12px;">DAY</th>
                <th style="padding:10px 12px;">OBSERVED ACTUAL</th>
                <th style="padding:10px 12px;">MODEL FORECAST</th>
                <th style="padding:10px 12px;">ABSOLUTE ERROR</th>
                <th style="padding:10px 12px;">ERROR %</th>
              </tr>
            </thead>
            <tbody>
              ${(e.actualVsPredicted || [])
                .map(
                  (row) => `
                <tr style="border-bottom:1px solid rgba(255,255,255,0.05);color:var(--text-primary,#fff);">
                  <td style="padding:10px 12px;font-weight:600;">${row.date}</td>
                  <td style="padding:10px 12px;color:var(--text-muted,#94a3b8);">${row.dayOfWeek}</td>
                  <td style="padding:10px 12px;font-weight:700;color:#10b981;">${formatPaisa(row.actualValue)}</td>
                  <td style="padding:10px 12px;font-weight:700;color:#38bdf8;">${formatPaisa(row.predictedValue)}</td>
                  <td style="padding:10px 12px;color:var(--text-muted,#94a3b8);">${formatPaisa(row.absoluteError)}</td>
                  <td style="padding:10px 12px;color:${(row.percentageError || 0) < 15 ? '#10b981' : '#f59e0b'};font-weight:600;">
                    ${row.percentageError !== null ? `${row.percentageError}%` : 'N/A'}
                  </td>
                </tr>
              `
                )
                .join('')}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;
}

function renderAssistedAnalysisTab() {
  const quickQuestions = [
    { key: 'SALES_TREND', label: 'Sales Performance Trend' },
    { key: 'TOP_DEMAND_ITEMS', label: 'Top Demand Items' },
    { key: 'STOCKOUT_ALERT', label: 'Critical Stockout Risks' },
    { key: 'PRICE_VOLATILITY', label: 'Supplier Price Movement' },
    { key: 'CAFE_COMPARISON', label: 'Multi-Outlet Benchmark' },
  ];

  return `
    <div style="display:flex;flex-direction:column;gap:20px;">
      <!-- Question Selector Panel -->
      <div style="background:var(--surface-card,#1e293b);border:1px solid var(--border-color,#334155);border-radius:12px;padding:20px;">
        <h3 style="font-size:16px;font-weight:700;color:var(--text-primary,#fff);margin:0 0 12px 0;">
          Controlled Business Question Catalogue
        </h3>
        <p style="font-size:13px;color:var(--text-muted,#94a3b8);margin:0 0 16px 0;">
          Select a verified analytical question. Queries execute against approved business metrics without arbitrary database access.
        </p>

        <div style="display:flex;gap:10px;flex-wrap:wrap;">
          ${quickQuestions
            .map(
              (q) => `
            <button class="fcst-btn-ask btn" data-key="${q.key}" style="padding:8px 14px;border-radius:8px;background:rgba(255,255,255,0.06);color:var(--text-primary,#fff);border:1px solid rgba(255,255,255,0.12);font-size:13px;font-weight:600;cursor:pointer;">
              ${icon('tasks')} ${q.label}
            </button>
          `
            )
            .join('')}
        </div>
      </div>

      <!-- Answer Card Container -->
      <div id="fcst-analysis-answer-container">
        ${renderAnalysisAnswerCard()}
      </div>
    </div>
  `;
}

function renderAnalysisAnswerCard() {
  if (!cachedAnalysisAnswer) {
    return `
      <div style="background:var(--surface-card,#1e293b);border:1px solid var(--border-color,#334155);border-radius:12px;padding:32px;text-align:center;color:var(--text-muted,#94a3b8);">
        Select an approved business question above to generate explainable insight.
      </div>
    `;
  }

  const ans = cachedAnalysisAnswer;

  return `
    <div style="background:var(--surface-card,#1e293b);border:1px solid var(--border-color,#334155);border-radius:12px;padding:24px;display:flex;flex-direction:column;gap:16px;">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:12px;">
        <div>
          <span style="display:inline-block;background:rgba(217,119,6,0.15);color:#f59e0b;padding:3px 8px;border-radius:6px;font-size:11px;font-weight:700;margin-bottom:6px;">
            ${ans.category || 'ANALYTICAL INQUIRY'}
          </span>
          <h2 style="font-size:20px;font-weight:800;color:var(--text-primary,#fff);margin:0;">
            ${ans.questionTitle || ans.questionKey}
          </h2>
        </div>

        <div style="display:flex;align-items:center;gap:8px;">
          <span style="font-size:11px;padding:4px 8px;border-radius:6px;background:${ans.aiStatus === 'CONFIGURED' ? 'rgba(16,185,129,0.15)' : 'rgba(148,163,184,0.15)'};color:${ans.aiStatus === 'CONFIGURED' ? '#10b981' : '#94a3b8'};border:1px solid rgba(255,255,255,0.1);">
            AI Adapter: ${ans.aiStatus}
          </span>
        </div>
      </div>

      <!-- Summary Answer -->
      <div style="background:rgba(255,255,255,0.03);border-left:4px solid var(--gold-500,#96733a);border-radius:4px;padding:14px 18px;">
        <div style="font-size:14px;font-weight:600;color:var(--text-primary,#fff);line-height:1.6;">
          ${ans.summaryExplanation}
        </div>
      </div>

      <!-- Contributing Factors -->
      ${
        ans.contributingFactors && ans.contributingFactors.length > 0
          ? `<div>
              <div style="font-size:12px;font-weight:700;color:var(--text-muted,#94a3b8);margin-bottom:8px;">CONTRIBUTING FACTUAL FACTORS:</div>
              <ul style="margin:0;padding-left:20px;font-size:13px;color:var(--text-primary,#fff);line-height:1.7;">
                ${ans.contributingFactors.map((f) => `<li>${f}</li>`).join('')}
              </ul>
            </div>`
          : ''
      }

      <!-- Metadata & Limitations -->
      <div style="display:flex;justify-content:space-between;align-items:center;border-top:1px solid rgba(255,255,255,0.08);padding-top:14px;flex-wrap:wrap;gap:8px;font-size:12px;color:var(--text-muted,#94a3b8);">
        <div>Period: <strong>${ans.reportingPeriod || 'N/A'}</strong> · Scope: <strong>${ans.cafeScope}</strong></div>
        ${
          ans.drillDownLink
            ? `<a href="#${ans.drillDownLink}" style="color:var(--gold-500,#96733a);text-decoration:none;font-weight:600;">
                Underlying Report &rarr;
              </a>`
            : ''
        }
      </div>
    </div>
  `;
}

export function wireForecastsInsights() {
  const container = document.querySelector('.forecasts-insights-workspace');
  if (!container) return;

  // Tab switching
  container.querySelectorAll('.fcst-tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      activeTab = btn.getAttribute('data-tab');
      renderTab();
    });
  });

  // Cafe Filter
  const cafeFilter = document.getElementById('fcst-cafe-filter');
  if (cafeFilter) {
    cafeFilter.addEventListener('change', (e) => {
      selectedCafe = e.target.value;
      refreshCurrentTabData();
    });
  }

  // Horizon Select
  const horizonSelect = document.getElementById('fcst-horizon-select');
  if (horizonSelect) {
    horizonSelect.addEventListener('change', (e) => {
      selectedHorizon = Number(e.target.value);
    });
  }

  // Method Select
  const methodSelect = document.getElementById('fcst-method-select');
  if (methodSelect) {
    methodSelect.addEventListener('change', (e) => {
      selectedMethod = e.target.value;
    });
  }

  // Generate Forecast button
  const btnGenerate = document.getElementById('fcst-btn-generate');
  if (btnGenerate) {
    btnGenerate.addEventListener('click', async () => {
      try {
        isLoading = true;
        renderTab();
        const payload = {
          cafeId: selectedCafe === 'ALL' ? null : selectedCafe,
          horizonDays: selectedHorizon,
          method: selectedMethod,
        };
        const res = await apiPost('/forecasts/generate', payload);
        cachedForecast = res.data;
        showToast('Forecast successfully generated from canonical sales records.', 'success');
      } catch (err) {
        showToast(err.message || 'Forecast generation failed.', 'error');
      } finally {
        isLoading = false;
        renderTab();
      }
    });
  }

  // Evaluate Accuracy button
  const btnEvaluate = document.getElementById('fcst-btn-evaluate');
  if (btnEvaluate) {
    btnEvaluate.addEventListener('click', async () => {
      try {
        isLoading = true;
        renderTab();
        const payload = {
          cafeId: selectedCafe === 'ALL' ? null : selectedCafe,
          holdoutDays: selectedHorizon,
        };
        const res = await apiPost('/forecasts/evaluate', payload);
        cachedEvaluation = res.data;
        activeTab = 'accuracy-eval';
        showToast('Holdout accuracy evaluation completed with zero data leakage.', 'success');
      } catch (err) {
        showToast(err.message || 'Evaluation failed.', 'error');
      } finally {
        isLoading = false;
        renderTab();
      }
    });
  }

  // Wire tab-specific buttons
  wireDynamicTabButtons();

  // Load initial data on mount
  refreshCurrentTabData();
}

function wireDynamicTabButtons() {
  const btnLoadRisk = document.getElementById('fcst-btn-load-risk');
  if (btnLoadRisk) {
    btnLoadRisk.addEventListener('click', loadStockoutRiskData);
  }

  const btnLoadVariance = document.getElementById('fcst-btn-load-variance');
  if (btnLoadVariance) {
    btnLoadVariance.addEventListener('click', loadPriceVarianceData);
  }

  const btnRunEval = document.getElementById('fcst-btn-run-eval');
  if (btnRunEval) {
    btnRunEval.addEventListener('click', () => {
      const btn = document.getElementById('fcst-btn-evaluate');
      if (btn) btn.click();
    });
  }

  // Quick Question Buttons
  document.querySelectorAll('.fcst-btn-ask').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const qKey = btn.getAttribute('data-key');
      try {
        const payload = {
          questionKey: qKey,
          cafeId: selectedCafe === 'ALL' ? null : selectedCafe,
        };
        const res = await apiPost('/forecasts/assisted-analysis/query', payload);
        cachedAnalysisAnswer = res.data;
        const answerContainer = document.getElementById('fcst-analysis-answer-container');
        if (answerContainer) {
          answerContainer.innerHTML = renderAnalysisAnswerCard();
        }
      } catch (err) {
        showToast(err.message || 'Inquiry query failed.', 'error');
      }
    });
  });
}

async function loadStockoutRiskData() {
  try {
    isLoading = true;
    renderTab();
    const cafeParam = selectedCafe === 'ALL' ? 'KOZHIKODE_BEACH' : selectedCafe;
    const res = await apiGet(`/forecasts/stockout-risk?cafeId=${cafeParam}&horizonDays=${selectedHorizon}`);
    cachedStockoutRisk = res.data;
  } catch (err) {
    showToast(err.message || 'Failed to load stockout risk.', 'error');
  } finally {
    isLoading = false;
    renderTab();
  }
}

async function loadPriceVarianceData() {
  try {
    isLoading = true;
    renderTab();
    const query = selectedCafe !== 'ALL' ? `?cafeId=${selectedCafe}&days=60` : '?days=60';
    const res = await apiGet(`/forecasts/supplier-price-variance${query}`);
    cachedPriceVariance = res.data;
  } catch (err) {
    showToast(err.message || 'Failed to analyze supplier prices.', 'error');
  } finally {
    isLoading = false;
    renderTab();
  }
}

async function refreshCurrentTabData() {
  if (activeTab === 'sales-forecast' && !cachedForecast) {
    try {
      const query = selectedCafe !== 'ALL' ? `?cafeId=${selectedCafe}` : '';
      const res = await apiGet(`/forecasts/latest${query}`);
      cachedForecast = res.data;
      renderTab();
    } catch (_) {}
  } else if (activeTab === 'stockout-risk' && !cachedStockoutRisk) {
    await loadStockoutRiskData();
  } else if (activeTab === 'price-variance' && !cachedPriceVariance) {
    await loadPriceVarianceData();
  }
}

function renderTab() {
  const contentArea = document.getElementById('fcst-content-area');
  if (contentArea) {
    contentArea.innerHTML = renderActiveTabContent();
    wireDynamicTabButtons();
  }
  // Update active tab buttons visual style
  document.querySelectorAll('.fcst-tab-btn').forEach((btn) => {
    const isAct = btn.getAttribute('data-tab') === activeTab;
    btn.style.background = isAct ? 'var(--gold-500,#96733a)' : 'transparent';
    btn.style.color = isAct ? '#fff' : 'var(--text-muted,#94a3b8)';
  });
}
