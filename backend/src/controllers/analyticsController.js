'use strict';

/**
 * EXECUTIVE ANALYTICS & BI CONTROLLER (STAGE 10 — PRIMARY MASTER PROGRAMME)
 *
 * Exposes authoritative endpoints:
 *  - GET /api/v1/analytics/summary/:cafeId
 *  - GET /api/v1/analytics/menu-engineering/:cafeId
 *  - GET /api/v1/analytics/hourly-heatmap/:cafeId
 *  - GET /api/v1/analytics/food-cost/:cafeId
 *  - GET /api/v1/analytics/consolidated/benchmarks
 *
 * Enforces strict multi-tenant RBAC data-scoping:
 *  - Non-management roles (STAFF, CASHIER, BARISTA, etc.): 403 Forbidden
 *  - CAFE_ADMIN: Strictly restricted to their assigned café (cross-café attempts throw 403 CROSS_CAFE_ACCESS_DENIED)
 *  - MASTER / OWNER: Multi-café and consolidated cross-chain benchmarking
 *  - Universal Export (PDF / Excel) integration via Stage 01 Central Export Engine
 */

const analyticsBiService = require('../services/analyticsBiService');
const { generatePdf, generateXlsx } = require('../utils/exportGenerators');
const { ApiError } = require('../utils/ApiError');
const { asyncHandler } = require('../utils/asyncHandler');

/**
 * Helper to validate role and café access
 */
function assertCafeAccess(auth, targetCafeId, allowConsolidated = false) {
  if (!auth) {
    throw new ApiError(401, 'UNAUTHENTICATED', 'Authentication required for analytics');
  }

  const role = String(auth.role || '').toUpperCase();
  const allowedRoles = ['MASTER', 'OWNER', 'CAFE_ADMIN', 'CHEF', 'FINANCE_MANAGER'];

  if (!allowedRoles.includes(role)) {
    throw new ApiError(403, 'ANALYTICS_FORBIDDEN', 'Analytics access denied for staff role');
  }

  if (role === 'MASTER' || role === 'OWNER') {
    return; // Full portfolio access
  }

  if (role === 'CAFE_ADMIN') {
    if (allowConsolidated) {
      throw new ApiError(403, 'CROSS_CAFE_ACCESS_DENIED', 'Cross-café benchmark analytics require Master or Owner privileges');
    }

    const assigned = auth.assignedCafeIds || (auth.primaryCafeId ? [auth.primaryCafeId] : []);
    if (targetCafeId && targetCafeId !== 'ALL') {
      if (!assigned.includes(targetCafeId) && auth.primaryCafeId !== targetCafeId) {
        throw new ApiError(403, 'CROSS_CAFE_ACCESS_DENIED', 'Café admin restricted to assigned café');
      }
    } else {
      // CAFE_ADMIN cannot query ALL or unscoped analytics
      throw new ApiError(403, 'CROSS_CAFE_ACCESS_DENIED', 'Café admin cannot query cross-café consolidated data');
    }
  }
}

/**
 * 1. Executive Dashboard Summary
 */
const getExecutiveSummary = asyncHandler(async (req, res) => {
  const auth = req.auth || req.user;
  const cafeId = req.params.cafeId || req.query.cafeId;
  assertCafeAccess(auth, cafeId);

  const organisationId = auth.organisationId;
  const { period, startDate, endDate, format } = req.query;

  const summary = await analyticsBiService.getExecutiveSummary({
    organisationId,
    cafeId,
    period,
    startDate,
    endDate,
  });

  const requestedFormat = String(format || 'JSON').toUpperCase();

  if (requestedFormat === 'PDF') {
    const kpiCards = [
      { label: 'Net Sales', value: `INR ${summary.kpis.totalNetSalesRupees}` },
      { label: 'Total Orders', value: String(summary.kpis.totalOrders) },
      { label: 'AOV', value: `INR ${summary.kpis.averageOrderValueRupees}` },
      { label: 'Gross Margin', value: `${summary.kpis.grossMarginPercent}%` },
    ];

    const columns = [
      { key: 'slNo', label: 'Sl No', width: 40 },
      { key: 'metric', label: 'Metric', width: 220 },
      { key: 'value', label: 'Value (INR / Count)', width: 180 },
    ];

    const rows = [
      { slNo: 1, metric: 'Gross Sales', value: (summary.kpis.totalGrossSalesPaisa / 100).toFixed(2) },
      { slNo: 2, metric: 'Discounts & Deductions', value: (summary.kpis.totalDiscountPaisa / 100).toFixed(2) },
      { slNo: 3, metric: 'Taxes Collected (GST)', value: (summary.kpis.totalTaxPaisa / 100).toFixed(2) },
      { slNo: 4, metric: 'Net Revenue', value: summary.kpis.totalNetSalesRupees },
      { slNo: 5, metric: 'Gross Profit', value: (summary.kpis.grossProfitPaisa / 100).toFixed(2) },
      { slNo: 6, metric: 'Cash Tendered', value: (summary.tenders.cashPaisa / 100).toFixed(2) },
      { slNo: 7, metric: 'UPI Tendered', value: (summary.tenders.upiPaisa / 100).toFixed(2) },
      { slNo: 8, metric: 'Card Tendered', value: (summary.tenders.cardPaisa / 100).toFixed(2) },
      { slNo: 9, metric: 'Total Guest Covers', value: String(summary.kpis.totalCovers) },
    ];

    const pdfRes = generatePdf({
      title: 'Executive Management Analytics Report',
      reportTitle: 'Executive Management Analytics Report',
      scope: cafeId || 'Consolidated Portfolio',
      period: summary.timeframe.periodLabel,
      reportCode: 'ZURF-EXEC-01',
      kpiCards,
      columns,
      rows,
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="Executive_Summary_${cafeId || 'ALL'}.pdf"`);
    return res.status(200).send(pdfRes.buffer);
  }

  if (requestedFormat === 'XLSX' || requestedFormat === 'EXCEL') {
    const columns = [
      { key: 'slNo', label: 'Sl No', width: 10 },
      { key: 'metric', label: 'Metric', width: 30 },
      { key: 'value', label: 'Value', width: 25 },
    ];

    const rows = [
      { slNo: 1, metric: 'Net Revenue (INR)', value: summary.kpis.totalNetSalesRupees },
      { slNo: 2, metric: 'Total Orders', value: summary.kpis.totalOrders },
      { slNo: 3, metric: 'Average Order Value (INR)', value: summary.kpis.averageOrderValueRupees },
      { slNo: 4, metric: 'Total Guest Covers', value: summary.kpis.totalCovers },
      { slNo: 5, metric: 'Gross Margin (%)', value: summary.kpis.grossMarginPercent },
    ];

    const xlsxRes = generateXlsx({
      sheetName: 'Executive Summary',
      reportTitle: 'Executive Management Analytics',
      scope: cafeId || 'Consolidated',
      period: summary.timeframe.periodLabel,
      columns,
      rows,
    });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="Executive_Summary_${cafeId || 'ALL'}.xlsx"`);
    return res.status(200).send(xlsxRes.buffer);
  }

  return res.status(200).json({
    success: true,
    data: summary,
  });
});

/**
 * 2. Menu Engineering & BCG Matrix
 */
const getMenuEngineering = asyncHandler(async (req, res) => {
  const auth = req.auth || req.user;
  const cafeId = req.params.cafeId || req.query.cafeId;
  assertCafeAccess(auth, cafeId);

  const organisationId = auth.organisationId;
  const { period, startDate, endDate, format } = req.query;

  const result = await analyticsBiService.getMenuEngineering({
    organisationId,
    cafeId,
    period,
    startDate,
    endDate,
  });

  const requestedFormat = String(format || 'JSON').toUpperCase();
  if (requestedFormat === 'PDF') {
    const columns = [
      { key: 'slNo', label: 'Sl No', width: 40 },
      { key: 'itemName', label: 'Item Name', width: 180 },
      { key: 'quantitySold', label: 'Qty Sold', width: 70 },
      { key: 'revenueRupees', label: 'Revenue (INR)', width: 110 },
      { key: 'classification', label: 'BCG Category', width: 110 },
    ];

    const pdfRes = generatePdf({
      title: 'Menu Engineering & BCG Matrix Analysis',
      reportTitle: 'Menu Engineering & BCG Matrix Analysis',
      scope: cafeId || 'All Cafes',
      period: period || 'Current Period',
      reportCode: 'ZURF-BCG-02',
      columns,
      rows: result.allRankedItems,
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="Menu_Engineering_${cafeId || 'ALL'}.pdf"`);
    return res.status(200).send(pdfRes.buffer);
  }

  return res.status(200).json({
    success: true,
    data: result,
  });
});

/**
 * 3. Hourly Sales Volume & Heatmap
 */
const getHourlyHeatmap = asyncHandler(async (req, res) => {
  const auth = req.auth || req.user;
  const cafeId = req.params.cafeId || req.query.cafeId;
  assertCafeAccess(auth, cafeId);

  const organisationId = auth.organisationId;
  const { period, startDate, endDate } = req.query;

  const result = await analyticsBiService.getHourlyHeatmap({
    organisationId,
    cafeId,
    period,
    startDate,
    endDate,
  });

  return res.status(200).json({
    success: true,
    data: result,
  });
});

/**
 * 4. Theoretical vs Actual Food Cost & Wastage
 */
const getFoodCostAndWastage = asyncHandler(async (req, res) => {
  const auth = req.auth || req.user;
  const cafeId = req.params.cafeId || req.query.cafeId;
  assertCafeAccess(auth, cafeId);

  const organisationId = auth.organisationId;
  const { period, startDate, endDate } = req.query;

  const result = await analyticsBiService.getFoodCostAndWastage({
    organisationId,
    cafeId,
    period,
    startDate,
    endDate,
  });

  return res.status(200).json({
    success: true,
    data: result,
  });
});

/**
 * 5. Consolidated Multi-Café Comparative Benchmarks
 */
const getConsolidatedBenchmarks = asyncHandler(async (req, res) => {
  const auth = req.auth || req.user;
  assertCafeAccess(auth, null, true); // True: check consolidated access (strictly Master/Owner)

  const organisationId = auth.organisationId;
  const { period } = req.query;

  const result = await analyticsBiService.getConsolidatedBenchmarks({
    organisationId,
    period,
  });

  return res.status(200).json({
    success: true,
    data: result,
  });
});

/**
 * 6. Compliance & Executive Action-Needed Summary (A090)
 */
const getActionNeeded = asyncHandler(async (req, res) => {
  const auth = req.auth || req.user;
  const cafeId = req.params.cafeId || req.query.cafeId;
  assertCafeAccess(auth, cafeId, false);

  const organisationId = auth.organisationId;
  const result = await analyticsBiService.getActionNeededSummary({
    organisationId,
    cafeId,
  });

  return res.status(200).json({
    success: true,
    data: result,
  });
});

module.exports = {
  getExecutiveSummary,
  getMenuEngineering,
  getHourlyHeatmap,
  getFoodCostAndWastage,
  getConsolidatedBenchmarks,
  getActionNeeded,
};
