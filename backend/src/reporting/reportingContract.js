'use strict';

/**
 * ZAMORIN CAFÉ ERP — REPORTING FOUNDATION
 * Module: reportingContract.js
 * 
 * Canonical Reporting Request & Response Contracts:
 * - Deterministic server-side request query validation.
 * - Standardized corporate reporting response envelope.
 * - Machine-readable provenance ("Explain This Number" engine).
 * - Enterprise data lineage mapper: Model -> Metric -> Report -> Visual -> Export.
 */

const { resolveReportPeriod, resolveComparisonPeriod, validateDateRange } = require('./reportingTime');
const { resolveReportScope } = require('./reportingScope');
const { validateGroupBy } = require('./dimensionRegistry');
const { MetricRegistry } = require('./metricRegistry');
const { ReportRegistry } = require('./reportRegistry');
const { resolveDataQuality } = require('./reportingDataQuality');

/**
 * Parses and validates an incoming HTTP reporting request.
 * @param {object} req - Express request
 * @returns {object} Validated request parameters and resolved scope
 */
function parseReportRequest(req, explicitReportId = null) {
  const query = req?.query || {};
  const reportId = explicitReportId || query.reportId || req?.params?.reportId || null;

  // 0. Enforce Report Authorization if reportId specified
  let reportDefinition = null;
  if (reportId) {
    reportDefinition = ReportRegistry.assertReportAccess(reportId, req.auth);
  }

  // 1. Resolve Scope (evaluates staff self-service if reportDefinition provided)
  const scope = resolveReportScope(req, query, reportDefinition);

  // 2. Resolve Period
  const periodName = query.period || 'MTD';
  const customRange = {
    dateFrom: query.dateFrom || query.from || query.startDate,
    dateTo: query.dateTo || query.to || query.endDate,
  };

  const period = resolveReportPeriod(periodName, customRange);

  // 3. Resolve Comparison Period if requested
  const compareParam = query.compare || query.comparison;
  const comparison = compareParam ? resolveComparisonPeriod(period, compareParam) : null;

  // 4. Validate Dimensions (groupBy)
  const groupByValidation = validateGroupBy(query.groupBy);
  if (!groupByValidation.valid) {
    const err = new Error(`Unsupported dimension(s) in groupBy: ${groupByValidation.invalid.join(', ')}`);
    err.statusCode = 400;
    err.code = 'UNSUPPORTED_DIMENSION';
    throw err;
  }

  // 5. Validate Metrics if explicitly requested
  let requestedMetrics = [];
  if (query.metrics) {
    const metricValidation = MetricRegistry.validateMetrics(query.metrics);
    if (!metricValidation.valid) {
      const err = new Error(`Unsupported metric(s) requested: ${metricValidation.invalid.join(', ')}`);
      err.statusCode = 400;
      err.code = 'UNSUPPORTED_METRIC';
      throw err;
    }
    requestedMetrics = metricValidation.metrics;
  }

  return {
    reportId,
    reportDefinition,
    scope,
    period,
    comparison,
    groupBy: groupByValidation.dimensions,
    metrics: requestedMetrics,
  };
}

/**
 * Generates calculation provenance metadata for an array of metric IDs.
 * Powers the "Explain This Number" feature.
 * @param {string[]} metricIds
 * @param {object} [context={}] Optional period quality context (e.g. partialRefundCount, legacyInsufficientBillsCount)
 * @returns {object} Dictionary keyed by metricId with calculation provenance
 */
function buildProvenance(metricIds = [], context = {}) {
  const provenance = {};
  for (const id of metricIds) {
    const m = MetricRegistry.getMetric(id);
    if (!m) continue;
    const entry = {
      metricId: m.metricId,
      displayName: m.displayName,
      formulaVersion: m.formulaVersion,
      calculationType: m.calculationType,
      actuality: m.actuality,
      ownerDomain: m.ownerDomain,
      classification: m.classification,
      trustStatus: m.trustStatus,
      sourceModels: m.sourceModels,
      includedStatuses: m.includedStatuses,
      excludedStatuses: m.excludedStatuses,
      timeBasis: m.timeBasis,
      availability: m.availability,
    };

    // Propagate partial refund quality to period-level NET_SALES and NET_TAX provenance
    if ((m.metricId === 'NET_SALES' || m.metricId === 'NET_TAX') && context.partialRefundCount > 0) {
      entry.availability = 'PARTIAL_SOURCE';
      entry.partialRefundCount = context.partialRefundCount;
      entry.affectedBillCount = context.affectedBillCount || context.partialRefundCount;
      entry.warningCode = m.metricId === 'NET_SALES' ? 'PARTIAL_REFUND_PRE_TAX_UNKNOWN' : 'PARTIAL_REFUND_TAX_ALLOCATION_UNKNOWN';
    }

    // Propagate legacy bill missing fields to GROSS_SALES provenance
    if (m.metricId === 'GROSS_SALES' && context.legacyInsufficientBillsCount > 0) {
      entry.availability = 'PARTIAL_SOURCE';
      entry.affectedBillCount = context.legacyInsufficientBillsCount;
      entry.warningCode = 'LEGACY_BILL_INSUFFICIENT_GROSS_SALES_FIELDS';
    }

    provenance[m.metricId] = entry;
  }
  return provenance;
}

/**
 * Builds the canonical data lineage graph for a given report.
 * Maps Model -> Metric -> Report -> Visual -> Export
 * @param {string} reportId
 * @returns {object|null}
 */
function getLineageMap(reportId) {
  const report = ReportRegistry.getReport(reportId);
  if (!report) return null;

  const nodeMap = {
    reportId: report.reportId,
    reportTitle: report.title,
    category: report.category,
    sourceModels: [],
    metrics: [],
    visuals: report.supportedVisuals || [],
    supportedExports: report.supportedExports || [],
  };

  for (const mId of report.sourceMetrics || []) {
    const metric = MetricRegistry.getMetric(mId);
    if (metric) {
      nodeMap.metrics.push({
        metricId: metric.metricId,
        displayName: metric.displayName,
        formulaVersion: metric.formulaVersion,
        actuality: metric.actuality,
        sourceModels: metric.sourceModels,
      });
      for (const sm of metric.sourceModels || []) {
        if (!nodeMap.sourceModels.includes(sm)) {
          nodeMap.sourceModels.push(sm);
        }
      }
    }
  }

  return nodeMap;
}

/**
 * Assembles the standard canonical corporate reporting response envelope.
 * @param {object} params
 * @param {object} params.req - Express request
 * @param {string} params.reportId - Canonical report identifier
 * @param {object} [params.metricsData={}] - Computed KPI metric values
 * @param {Array|object} [params.rawData=[]] - Tabular or grouped dataset
 * @param {object} [params.dataQuality={}] - Data quality flags
 * @param {string[]} [params.warnings=[]] - Operational or calculation warnings
 * @param {object} [params.additionalData={}] - Extra report-specific payload
 * @returns {object} Structured API response body
 */
function buildReportEnvelope({
  req,
  reportId,
  metricsData = {},
  rawData = [],
  dataQuality = {},
  warnings = [],
  additionalData = {},
}) {
  const report = ReportRegistry.getReport(reportId);
  const title = report?.title || reportId;
  const involvedMetrics = report?.sourceMetrics || Object.keys(metricsData);
  const provenance = buildProvenance(involvedMetrics, dataQuality);

  const parsed = req?._parsedReportRequest || null;
  const scope = parsed?.scope || resolveReportScope(req);
  const period = parsed?.period || resolveReportPeriod('MTD');
  const comparison = parsed?.comparison || null;

  const qualityStatus = resolveDataQuality({
    hasData: (Array.isArray(rawData) ? rawData.length > 0 : Boolean(rawData)) || Object.keys(metricsData).length > 0,
    missingSources: dataQuality.missingSources || [],
    isStale: dataQuality.isStale || false,
    hasOpenRegisters: dataQuality.hasOpenRegisters || false,
    hasPartialRefundsWithoutPreTax: dataQuality.hasPartialRefundsWithoutPreTax || false,
    partialRefundCount: dataQuality.partialRefundCount || 0,
    affectedBillCount: dataQuality.affectedBillCount || 0,
    legacyInsufficientBillsCount: dataQuality.legacyInsufficientBillsCount || 0,
    warnings: [...(dataQuality.warnings || []), ...warnings],
  });

  return {
    success: true,
    data: {
      reportId,
      title,
      category: report?.category || 'CUSTOM',
      classification: report?.classification || 'INTERNAL',
      trustLevel: report?.trustLevel || 'OPERATIONAL',
      generatedAt: new Date().toISOString(),
      timezone: 'Asia/Kolkata',
      scope: {
        organisationId: scope.organisationId,
        cafeScope: scope.cafeScope,
        isOrgWide: scope.isOrgWide,
        role: scope.role,
      },
      period: {
        periodId: period.periodId,
        dateFrom: period.dateFrom,
        dateTo: period.dateTo,
        label: period.label,
        comparison: comparison ? {
          type: comparison.comparisonType,
          dateFrom: comparison.dateFrom,
          dateTo: comparison.dateTo,
          label: comparison.label,
        } : null,
      },
      dataQuality: qualityStatus,
      provenance,
      metrics: metricsData,
      data: rawData,
      warnings,
      ...additionalData,
    },
    correlationId: req?.correlationId || null,
  };
}

module.exports = {
  parseReportRequest,
  buildProvenance,
  getLineageMap,
  buildReportEnvelope,
};
