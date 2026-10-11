'use strict';

/**
 * ============================================================================
 * ZAMORIN CAFÉ ERP — FORECAST & INSIGHTS CONTROLLER (PACKAGE P17)
 * ============================================================================
 * Controller for Sales & Demand Forecasting, Holdout Evaluation, Forward-Looking
 * Stockout Risks, Supplier Price Variance Analysis, and Assisted Inquiries.
 *
 * CRITICAL ACCESS & GOVERNANCE INVARIANTS:
 * 1. PRIMARY MASTER: Unrestricted enterprise oversight across all cafes and organisations.
 * 2. OWNER: Read-only analytical insight. Mutation operations (generate, evaluate) fail 403.
 * 3. CAFÉ OPERATIONS: Scoped strictly to assigned café records. Cross-café requests fail 403.
 * 4. STAFF & VENDOR: Denied analytical access (403).
 * 5. RETIRED NORMAL MASTER: Permanently fails closed with 403 ROLE_RETIRED.
 */

const SalesForecastingService = require('../services/salesForecastingService');
const StockoutRiskService = require('../services/stockoutRiskService');
const SupplierPriceVarianceService = require('../services/supplierPriceVarianceService');
const BusinessExplanationService = require('../services/businessExplanationService');

function resolveCafeScope(request, requestedCafeId) {
  const user = request.auth || request.user;
  const role = (user?.role || '').toUpperCase();

  if (role === 'MASTER' && user?.isPrimaryMaster) {
    return requestedCafeId || null; // Enterprise or requested
  }

  if (role === 'OWNER') {
    return requestedCafeId || null; // Read-only enterprise or requested
  }

  if (role === 'CAFE_ADMIN') {
    const assignedCafes = user?.assignedCafeIds || (user?.cafeId ? [user.cafeId] : []);
    const cleanAssigned = assignedCafes.map(c => c.toUpperCase());

    if (requestedCafeId) {
      const cleanRequested = requestedCafeId.trim().toUpperCase();
      if (!cleanAssigned.includes(cleanRequested)) {
        return false; // Forbidden cross-cafe access
      }
      return cleanRequested;
    }
    return cleanAssigned[0] || user?.cafeId || null;
  }

  return false;
}

class ForecastController {
  /**
   * Generates a new forward-looking sales & demand forecast.
   * POST /api/v1/forecasts/generate
   */
  static async generateForecast(request, response, next) {
    try {
      const user = request.auth || request.user;
      if (user?.role === 'OWNER') {
        return response.status(403).json({
          error: {
            code: 'OWNER_READ_ONLY',
            message: 'Owner persona has read-only executive governance. Operational forecast generation is restricted to Primary Master and Cafe Operations.',
          },
        });
      }

      const body = request.body || {};
      const cafeId = resolveCafeScope(request, body.cafeId);
      if (cafeId === false) {
        return response.status(403).json({
          error: {
            code: 'CAFE_ACCESS_DENIED',
            message: 'You are not authorized to generate forecasts for another café.',
          },
        });
      }

      const organisationId = user?.organisationId || body.organisationId || 'ZAMORIN';
      const horizonDays = body.horizonDays ? Number(body.horizonDays) : 7;
      const method = body.method || 'DAY_OF_WEEK_SEASONAL';
      const observationWindowDays = body.observationWindowDays ? Number(body.observationWindowDays) : 28;

      const result = await SalesForecastingService.generateSalesAndDemandForecast({
        organisationId,
        cafeId,
        horizonDays,
        method,
        observationWindowDays,
        actorId: user?.userId || 'SYSTEM',
      });

      return response.status(201).json({
        success: true,
        data: result,
      });
    } catch (err) {
      return next(err);
    }
  }

  /**
   * Retrieves the latest forecast run for a cafe/org.
   * GET /api/v1/forecasts/latest
   */
  static async getLatestForecast(request, response, next) {
    try {
      const user = request.auth || request.user;
      const requestedCafeId = request.query.cafeId;
      const cafeId = resolveCafeScope(request, requestedCafeId);
      if (cafeId === false) {
        return response.status(403).json({
          error: {
            code: 'CAFE_ACCESS_DENIED',
            message: 'You are not authorized to access forecasts for another café.',
          },
        });
      }

      const organisationId = user?.organisationId || request.query.organisationId || 'ZAMORIN';
      const latest = await SalesForecastingService.getLatestForecast({
        organisationId,
        cafeId,
      });

      return response.status(200).json({
        success: true,
        data: latest,
      });
    } catch (err) {
      return next(err);
    }
  }

  /**
   * Lists historical forecast runs.
   * GET /api/v1/forecasts/history
   */
  static async getForecastHistory(request, response, next) {
    try {
      const user = request.auth || request.user;
      const requestedCafeId = request.query.cafeId;
      const cafeId = resolveCafeScope(request, requestedCafeId);
      if (cafeId === false) {
        return response.status(403).json({
          error: {
            code: 'CAFE_ACCESS_DENIED',
            message: 'You are not authorized to access forecast history for another café.',
          },
        });
      }

      const organisationId = user?.organisationId || request.query.organisationId || 'ZAMORIN';
      const limit = Number(request.query.limit) || 20;

      const history = await SalesForecastingService.listForecastHistory({
        organisationId,
        cafeId,
        limit,
      });

      return response.status(200).json({
        success: true,
        data: history,
      });
    } catch (err) {
      return next(err);
    }
  }

  /**
   * Runs a holdout evaluation of forecast accuracy without data leakage.
   * POST /api/v1/forecasts/evaluate
   */
  static async evaluateForecast(request, response, next) {
    try {
      const user = request.auth || request.user;
      if (user?.role === 'OWNER') {
        return response.status(403).json({
          error: {
            code: 'OWNER_READ_ONLY',
            message: 'Owner persona has read-only executive governance. Evaluation runs are restricted.',
          },
        });
      }

      const body = request.body || {};
      const cafeId = resolveCafeScope(request, body.cafeId);
      if (cafeId === false) {
        return response.status(403).json({
          error: {
            code: 'CAFE_ACCESS_DENIED',
            message: 'You are not authorized to run accuracy evaluations for another café.',
          },
        });
      }

      const organisationId = user?.organisationId || body.organisationId || 'ZAMORIN';
      const holdoutDays = body.holdoutDays ? Number(body.holdoutDays) : 7;
      const observationWindowDays = body.observationWindowDays ? Number(body.observationWindowDays) : 28;

      const result = await SalesForecastingService.evaluateForecastAccuracy({
        organisationId,
        cafeId,
        holdoutDays,
        observationWindowDays,
        actorId: user?.userId || 'SYSTEM',
      });

      return response.status(201).json({
        success: true,
        data: result,
      });
    } catch (err) {
      return next(err);
    }
  }

  /**
   * Lists past forecast evaluations.
   * GET /api/v1/forecasts/evaluations
   */
  static async getEvaluationHistory(request, response, next) {
    try {
      const user = request.auth || request.user;
      const requestedCafeId = request.query.cafeId;
      const cafeId = resolveCafeScope(request, requestedCafeId);
      if (cafeId === false) {
        return response.status(403).json({
          error: {
            code: 'CAFE_ACCESS_DENIED',
            message: 'You are not authorized to view evaluations for another café.',
          },
        });
      }

      const organisationId = user?.organisationId || request.query.organisationId || 'ZAMORIN';
      const limit = Number(request.query.limit) || 20;

      const history = await SalesForecastingService.listEvaluationHistory({
        organisationId,
        cafeId,
        limit,
      });

      return response.status(200).json({
        success: true,
        data: history,
      });
    } catch (err) {
      return next(err);
    }
  }

  /**
   * Retrieves forward-looking stockout risk intelligence for a cafe.
   * GET /api/v1/forecasts/stockout-risk
   */
  static async getStockoutRisk(request, response, next) {
    try {
      const user = request.auth || request.user;
      const requestedCafeId = request.query.cafeId || 'KOZHIKODE_BEACH';
      const cafeId = resolveCafeScope(request, requestedCafeId);
      if (cafeId === false || !cafeId) {
        return response.status(403).json({
          error: {
            code: 'CAFE_ACCESS_DENIED',
            message: 'You are not authorized to access stockout risk for this café.',
          },
        });
      }

      const organisationId = user?.organisationId || request.query.organisationId || 'ZAMORIN';
      const horizonDays = Number(request.query.horizonDays) || 14;
      const category = request.query.category || null;

      const risk = await StockoutRiskService.evaluateStockoutRisk({
        organisationId,
        cafeId,
        horizonDays,
        category,
      });

      return response.status(200).json({
        success: true,
        data: risk,
      });
    } catch (err) {
      return next(err);
    }
  }

  /**
   * Retrieves supplier price variance findings over recent purchases.
   * GET /api/v1/forecasts/supplier-price-variance
   */
  static async getSupplierPriceVariance(request, response, next) {
    try {
      const user = request.auth || request.user;
      const requestedCafeId = request.query.cafeId;
      const cafeId = resolveCafeScope(request, requestedCafeId);
      if (cafeId === false) {
        return response.status(403).json({
          error: {
            code: 'CAFE_ACCESS_DENIED',
            message: 'You are not authorized to view supplier price variance for another café.',
          },
        });
      }

      const organisationId = user?.organisationId || request.query.organisationId || 'ZAMORIN';
      const days = Number(request.query.days) || 60;
      const vendorId = request.query.vendorId || null;
      const itemId = request.query.itemId || null;

      const variances = await SupplierPriceVarianceService.analyzePriceVariances({
        organisationId,
        cafeId,
        days,
        vendorId,
        itemId,
      });

      return response.status(200).json({
        success: true,
        data: variances,
      });
    } catch (err) {
      return next(err);
    }
  }

  /**
   * Retrieves the catalog of approved business inquiry questions.
   * GET /api/v1/forecasts/assisted-analysis/catalog
   */
  static getSupportedQuestions(request, response) {
    const catalog = BusinessExplanationService.getSupportedCatalog();
    return response.status(200).json({
      success: true,
      data: catalog,
    });
  }

  /**
   * Executes a controlled business analysis inquiry.
   * POST /api/v1/forecasts/assisted-analysis/query
   */
  static async askBusinessAnalysis(request, response, next) {
    try {
      const user = request.auth || request.user;
      const body = request.body || {};
      const requestedCafeId = body.cafeId;
      const cafeId = resolveCafeScope(request, requestedCafeId);
      if (cafeId === false) {
        return response.status(403).json({
          error: {
            code: 'CAFE_ACCESS_DENIED',
            message: 'You are not authorized to query business analysis for another café.',
          },
        });
      }

      const organisationId = user?.organisationId || body.organisationId || 'ZAMORIN';
      const questionKey = body.questionKey;

      const answer = await BusinessExplanationService.queryBusinessAnalysis({
        questionKey,
        organisationId,
        cafeId,
        options: body.options || {},
      });

      return response.status(200).json({
        success: true,
        data: answer,
      });
    } catch (err) {
      return next(err);
    }
  }
}

module.exports = ForecastController;
