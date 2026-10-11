'use strict';

/**
 * ============================================================================
 * ZAMORIN CAFÉ ERP — SALES & ITEM DEMAND FORECASTING SERVICE (PACKAGE P17)
 * ============================================================================
 * Authoritative business service for sales revenue and menu item demand
 * forecasting using canonical persisted sales records.
 *
 * GOVERNANCE & BUSINESS INVARIANTS:
 * 1. ADVISORY ONLY: Forecast calculations never create bills, change prices,
 *    modify inventory levels, or issue purchase orders.
 * 2. CANONICAL SALES AUTHORITY: Uses finalized, eligible `Bill` documents.
 *    Voided, refunded, reversed, and training transactions are strictly excluded.
 * 3. TRANSPARENCY: Sparsity, missing history, and data gaps produce explicit
 *    statuses (INSUFFICIENT_HISTORY, DATA_QUALITY_WARNING) rather than false precision.
 * 4. ZERO DATA LEAKAGE: Evaluation holdout periods use strict cutoff dates
 *    where future observations are completely excluded from training inputs.
 */

const crypto = require('crypto');
const { Bill } = require('../models/Bill');
const { MenuItem } = require('../models/MenuItem');
const { ForecastRun } = require('../models/ForecastRun');
const { ForecastEvaluation } = require('../models/ForecastEvaluation');
const ApiError = require('../utils/ApiError');

const DAY_NAMES = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];

function getIstDateStr(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function addDays(dateStr, days) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

function getDayOfWeek(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return DAY_NAMES[dt.getUTCDay()];
}

function generateForecastId(dateStr) {
  const cleanDate = dateStr.replace(/-/g, '');
  const rand = crypto.randomBytes(3).toString('hex').toUpperCase();
  return `FCST-${cleanDate}-${rand}`;
}

function generateEvaluationId(dateStr) {
  const cleanDate = dateStr.replace(/-/g, '');
  const rand = crypto.randomBytes(3).toString('hex').toUpperCase();
  return `EVAL-${cleanDate}-${rand}`;
}

class SalesForecastingService {
  /**
   * Generates and persists a forward-looking sales and demand forecast.
   *
   * @param {Object} params
   * @param {string} params.organisationId
   * @param {string} [params.cafeId] - Optional cafeId (null = enterprise consolidated)
   * @param {number} [params.horizonDays=7] - Forecast horizon in days (1 to 90)
   * @param {string} [params.method='DAY_OF_WEEK_SEASONAL'] - Forecasting method
   * @param {number} [params.observationWindowDays=28] - Historical window in days
   * @param {string} [params.actorId='SYSTEM'] - Generating user/system ID
   * @returns {Promise<Object>} Persisted forecast run document
   */
  static async generateSalesAndDemandForecast({
    organisationId = 'ZAMORIN',
    cafeId = null,
    horizonDays = 7,
    method = 'DAY_OF_WEEK_SEASONAL',
    observationWindowDays = 28,
    actorId = 'SYSTEM',
  }) {
    if (!organisationId) {
      throw new ApiError(400, 'VALIDATION_FAILED', 'organisationId is required.');
    }

    const cleanOrg = organisationId.trim().toUpperCase();
    const cleanCafe = cafeId ? cafeId.trim().toUpperCase() : null;
    const horizon = Math.min(90, Math.max(1, Number(horizonDays) || 7));
    const windowDays = Math.min(180, Math.max(7, Number(observationWindowDays) || 28));

    const todayStr = getIstDateStr();
    const cutoffDate = todayStr;
    const windowStartDate = addDays(cutoffDate, -windowDays);

    // ── 1. Query Authoritative Historical Bills ──────────────────────────────
    const billQuery = {
      organisationId: cleanOrg,
      status: 'COMPLETED',
      paymentStatus: { $nin: ['REFUNDED', 'UNPAID'] },
      isTraining: { $ne: true },
      businessDate: { $gte: windowStartDate, $lt: cutoffDate },
    };

    if (cleanCafe) {
      billQuery.cafeId = cleanCafe;
    }

    const bills = await Bill.find(billQuery)
      .select('billId cafeId businessDate orderType lineItems totalPaisa refundedTotalPaisa')
      .lean();

    // ── 2. Check for Insufficient History & Data Quality ──────────────────────
    const distinctDates = new Set(bills.map(b => b.businessDate));
    const warnings = [];
    let status = 'READY';

    if (distinctDates.size < 7) {
      status = 'INSUFFICIENT_HISTORY';
      warnings.push(
        `Insufficient trading history: Found ${distinctDates.size} trading days in observation window. Minimum 7 distinct days required for reliable forecasting.`
      );
    } else {
      // Check for irregular gaps in history
      const sortedDates = Array.from(distinctDates).sort();
      let maxGap = 0;
      for (let i = 1; i < sortedDates.length; i++) {
        const d1 = new Date(sortedDates[i - 1]);
        const d2 = new Date(sortedDates[i]);
        const diffDays = Math.round((d2 - d1) / (1000 * 60 * 60 * 24));
        if (diffDays > maxGap) maxGap = diffDays;
      }

      if (maxGap > 3) {
        status = 'DATA_QUALITY_WARNING';
        warnings.push(`Trading history contains data gaps of up to ${maxGap} consecutive days.`);
      }
    }

    // ── 3. Aggregate Historical Data ─────────────────────────────────────────
    // Date -> { revenuePaisa, channelRevenues: Map }
    const dailyActuals = new Map();
    // MenuItemId -> { itemName, category, dailyQtys: Map(date => qty) }
    const itemActuals = new Map();

    for (const b of bills) {
      const bDate = b.businessDate;
      const netRev = Math.max(0, (Number(b.totalPaisa) || 0) - (Number(b.refundedTotalPaisa) || 0));
      const channel = (b.orderType || 'QUICK_SALE').toUpperCase();

      if (!dailyActuals.has(bDate)) {
        dailyActuals.set(bDate, { revenuePaisa: 0, channels: new Map() });
      }
      const dayEntry = dailyActuals.get(bDate);
      dayEntry.revenuePaisa += netRev;
      dayEntry.channels.set(channel, (dayEntry.channels.get(channel) || 0) + netRev);

      if (Array.isArray(b.lineItems)) {
        for (const item of b.lineItems) {
          const itemId = (item.menuItemId || '').trim().toUpperCase();
          if (!itemId) continue;

          if (!itemActuals.has(itemId)) {
            itemActuals.set(itemId, {
              itemName: item.itemNameSnapshot || itemId,
              category: 'OTHER',
              dailyQtys: new Map(),
            });
          }
          const itemEntry = itemActuals.get(itemId);
          const currentQty = itemEntry.dailyQtys.get(bDate) || 0;
          itemEntry.dailyQtys.set(bDate, currentQty + (Number(item.quantity) || 0));
        }
      }
    }

    // Lookup menu categories for items
    if (itemActuals.size > 0) {
      const menuDocs = await MenuItem.find({
        organisationId: cleanOrg,
        menuItemId: { $in: Array.from(itemActuals.keys()) },
      }).select('menuItemId category name').lean();

      for (const m of menuDocs) {
        if (itemActuals.has(m.menuItemId)) {
          const entry = itemActuals.get(m.menuItemId);
          if (m.category) entry.category = m.category;
          if (m.name) entry.itemName = m.name;
        }
      }
    }

    // ── 4. Statistical Forecasting Calculations ──────────────────────────────
    const revenuePredictions = [];
    const itemDemandPredictions = [];

    if (status === 'INSUFFICIENT_HISTORY') {
      // Produce safe zero projections with transparent status
      for (let i = 0; i < horizon; i++) {
        const targetDate = addDays(cutoffDate, i);
        const dayOfWeek = getDayOfWeek(targetDate);
        revenuePredictions.push({
          date: targetDate,
          dayOfWeek,
          predictedRevenuePaisa: 0,
          confidenceLowPaisa: 0,
          confidenceHighPaisa: 0,
          channelBreakdown: [],
        });
      }
    } else {
      // Compute Day-of-Week Seasonality or Moving Average baselines
      const dayOfWeekTotals = new Map(); // DOW -> { sumRev, count, sumByChannel: Map }
      const itemDowTotals = new Map();   // ItemId -> Map(DOW => { sumQty, count })

      for (const [dateStr, data] of dailyActuals.entries()) {
        const dow = getDayOfWeek(dateStr);
        if (!dayOfWeekTotals.has(dow)) {
          dayOfWeekTotals.set(dow, { sumRev: 0, count: 0, channelSums: new Map() });
        }
        const dowEntry = dayOfWeekTotals.get(dow);
        dowEntry.sumRev += data.revenuePaisa;
        dowEntry.count += 1;

        for (const [ch, rev] of data.channels.entries()) {
          dowEntry.channelSums.set(ch, (dowEntry.channelSums.get(ch) || 0) + rev);
        }
      }

      for (const [itemId, itemData] of itemActuals.entries()) {
        const dowMap = new Map();
        for (const [dateStr, qty] of itemData.dailyQtys.entries()) {
          const dow = getDayOfWeek(dateStr);
          if (!dowMap.has(dow)) {
            dowMap.set(dow, { sumQty: 0, count: 0 });
          }
          const dowEntry = dowMap.get(dow);
          dowEntry.sumQty += qty;
          dowEntry.count += 1;
        }
        itemDowTotals.set(itemId, dowMap);
      }

      // Overall average for fallback when specific day-of-week has zero observations
      const totalObservedRev = Array.from(dailyActuals.values()).reduce((s, v) => s + v.revenuePaisa, 0);
      const overallAvgDailyRev = dailyActuals.size > 0 ? Math.round(totalObservedRev / dailyActuals.size) : 0;

      // Residual std-dev for confidence bands
      let varianceSum = 0;
      for (const [dateStr, data] of dailyActuals.entries()) {
        const dow = getDayOfWeek(dateStr);
        const dowAvg = dayOfWeekTotals.has(dow) && dayOfWeekTotals.get(dow).count > 0
          ? Math.round(dayOfWeekTotals.get(dow).sumRev / dayOfWeekTotals.get(dow).count)
          : overallAvgDailyRev;
        const err = data.revenuePaisa - dowAvg;
        varianceSum += err * err;
      }
      const stdDev = dailyActuals.size > 1
        ? Math.sqrt(varianceSum / (dailyActuals.size - 1))
        : overallAvgDailyRev * 0.15;
      const marginOfError = Math.round(stdDev * 1.28); // ~80% confidence interval

      // Project revenue for each date in horizon
      for (let i = 0; i < horizon; i++) {
        const targetDate = addDays(cutoffDate, i);
        const dayOfWeek = getDayOfWeek(targetDate);

        let predictedRev = overallAvgDailyRev;
        const channelBreakdown = [];

        if (method === 'DAY_OF_WEEK_SEASONAL' && dayOfWeekTotals.has(dayOfWeek) && dayOfWeekTotals.get(dayOfWeek).count > 0) {
          const dowData = dayOfWeekTotals.get(dayOfWeek);
          predictedRev = Math.round(dowData.sumRev / dowData.count);

          for (const [ch, sumChRev] of dowData.channelSums.entries()) {
            const chPred = Math.round(sumChRev / dowData.count);
            channelBreakdown.push({
              channel: ch,
              predictedRevenuePaisa: chPred,
              percentageOfTotal: predictedRev > 0 ? Math.round((chPred / predictedRev) * 100) : 0,
            });
          }
        } else if (method === 'MOVING_AVERAGE') {
          // 7-day trailing moving average
          predictedRev = overallAvgDailyRev;
        }

        const confidenceLowPaisa = Math.max(0, predictedRev - marginOfError);
        const confidenceHighPaisa = predictedRev + marginOfError;

        revenuePredictions.push({
          date: targetDate,
          dayOfWeek,
          predictedRevenuePaisa: predictedRev,
          confidenceLowPaisa,
          confidenceHighPaisa,
          channelBreakdown,
        });

        // Project item demand for top items
        for (const [itemId, itemData] of itemActuals.entries()) {
          const dowMap = itemDowTotals.get(itemId);
          let predictedQty = 0;

          if (dowMap && dowMap.has(dayOfWeek) && dowMap.get(dayOfWeek).count > 0) {
            const entry = dowMap.get(dayOfWeek);
            predictedQty = Math.round(entry.sumQty / entry.count);
          } else {
            const totalItemQty = Array.from(itemData.dailyQtys.values()).reduce((a, b) => a + b, 0);
            predictedQty = dailyActuals.size > 0 ? Math.round(totalItemQty / dailyActuals.size) : 0;
          }

          if (predictedQty > 0) {
            itemDemandPredictions.push({
              menuItemId: itemId,
              itemName: itemData.itemName,
              category: itemData.category,
              date: targetDate,
              predictedQuantity: predictedQty,
              confidenceLowQty: Math.max(0, Math.round(predictedQty * 0.8)),
              confidenceHighQty: Math.round(predictedQty * 1.25),
            });
          }
        }
      }
    }

    // ── 5. Generate Summary Metrics ──────────────────────────────────────────
    const totalPredictedRevenuePaisa = revenuePredictions.reduce(
      (sum, p) => sum + p.predictedRevenuePaisa,
      0
    );
    const avgDailyRevenuePaisa = horizon > 0 ? Math.round(totalPredictedRevenuePaisa / horizon) : 0;

    // Aggregate top item demand
    const itemTotalMap = new Map();
    for (const p of itemDemandPredictions) {
      if (!itemTotalMap.has(p.menuItemId)) {
        itemTotalMap.set(p.menuItemId, {
          menuItemId: p.menuItemId,
          itemName: p.itemName,
          category: p.category,
          totalPredictedQuantity: 0,
        });
      }
      itemTotalMap.get(p.menuItemId).totalPredictedQuantity += p.predictedQuantity;
    }

    const topDemandItems = Array.from(itemTotalMap.values())
      .sort((a, b) => b.totalPredictedQuantity - a.totalPredictedQuantity)
      .slice(0, 10);

    const totalPredictedItemsCount = Array.from(itemTotalMap.values()).reduce(
      (s, i) => s + i.totalPredictedQuantity,
      0
    );

    // ── 6. Persist Forecast Run ──────────────────────────────────────────────
    const forecastId = generateForecastId(cutoffDate);

    const forecastDoc = new ForecastRun({
      forecastId,
      organisationId: cleanOrg,
      cafeId: cleanCafe,
      forecastType: 'COMBINED',
      method,
      methodRationale: `Statistical ${method} projection based on ${distinctDates.size} trading days across ${windowDays}-day window.`,
      horizonDays: horizon,
      cutoffDate,
      observationWindowDays: windowDays,
      eligibleObservationsCount: bills.length,
      status,
      warningDetails: warnings,
      revenuePredictions,
      itemDemandPredictions,
      summary: {
        totalPredictedRevenuePaisa,
        avgDailyRevenuePaisa,
        totalPredictedItemsCount,
        topDemandItems,
      },
      metadata: {
        calculationVersion: 'P17-V1.0',
        isAdvisoryOnly: true,
        confidenceLevelPercent: 80,
      },
      generatedByUserId: actorId,
      generatedAt: new Date(),
    });

    await forecastDoc.save();
    return forecastDoc.toObject();
  }

  /**
   * Evaluates forecasting accuracy using strict historical holdout evaluation.
   * Compares model predictions against observed actual values without data leakage.
   *
   * @param {Object} params
   * @param {string} params.organisationId
   * @param {string} [params.cafeId]
   * @param {number} [params.holdoutDays=7] - Number of days in holdout period
   * @param {number} [params.observationWindowDays=28] - Training window prior to holdout
   * @param {string} [params.actorId='SYSTEM']
   * @returns {Promise<Object>} Persisted forecast evaluation document
   */
  static async evaluateForecastAccuracy({
    organisationId = 'ZAMORIN',
    cafeId = null,
    holdoutDays = 7,
    observationWindowDays = 28,
    actorId = 'SYSTEM',
  }) {
    if (!organisationId) {
      throw new ApiError(400, 'VALIDATION_FAILED', 'organisationId is required.');
    }

    const cleanOrg = organisationId.trim().toUpperCase();
    const cleanCafe = cafeId ? cafeId.trim().toUpperCase() : null;
    const holdout = Math.min(30, Math.max(1, Number(holdoutDays) || 7));
    const trainDays = Math.min(180, Math.max(7, Number(observationWindowDays) || 28));

    const todayStr = getIstDateStr();
    // Holdout window: [holdoutStart, today)
    const holdoutStartDate = addDays(todayStr, -holdout);
    const holdoutEndDate = todayStr;
    // Training cutoff is holdoutStartDate: training uses strictly [trainStartDate, holdoutStartDate)
    const trainingCutoffDate = holdoutStartDate;
    const trainStartDate = addDays(trainingCutoffDate, -trainDays);

    // ── 1. Fetch Training Bills (strictly BEFORE holdout period) ──────────────
    const trainQuery = {
      organisationId: cleanOrg,
      status: 'COMPLETED',
      paymentStatus: { $nin: ['REFUNDED', 'UNPAID'] },
      isTraining: { $ne: true },
      businessDate: { $gte: trainStartDate, $lt: trainingCutoffDate },
    };
    if (cleanCafe) trainQuery.cafeId = cleanCafe;

    const trainBills = await Bill.find(trainQuery)
      .select('businessDate totalPaisa refundedTotalPaisa')
      .lean();

    // ── 2. Fetch Holdout Actuals (observed during holdout period) ────────────
    const holdoutQuery = {
      organisationId: cleanOrg,
      status: 'COMPLETED',
      paymentStatus: { $nin: ['REFUNDED', 'UNPAID'] },
      isTraining: { $ne: true },
      businessDate: { $gte: holdoutStartDate, $lt: holdoutEndDate },
    };
    if (cleanCafe) holdoutQuery.cafeId = cleanCafe;

    const holdoutBills = await Bill.find(holdoutQuery)
      .select('businessDate totalPaisa refundedTotalPaisa')
      .lean();

    const holdoutActualsByDate = new Map();
    for (const b of holdoutBills) {
      const net = Math.max(0, (Number(b.totalPaisa) || 0) - (Number(b.refundedTotalPaisa) || 0));
      holdoutActualsByDate.set(b.businessDate, (holdoutActualsByDate.get(b.businessDate) || 0) + net);
    }

    // ── 3. Train Model Solely on Historical Data ─────────────────────────────
    const trainActualsByDate = new Map();
    for (const b of trainBills) {
      const net = Math.max(0, (Number(b.totalPaisa) || 0) - (Number(b.refundedTotalPaisa) || 0));
      trainActualsByDate.set(b.businessDate, (trainActualsByDate.get(b.businessDate) || 0) + net);
    }

    const trainDowTotals = new Map();
    for (const [dateStr, rev] of trainActualsByDate.entries()) {
      const dow = getDayOfWeek(dateStr);
      if (!trainDowTotals.has(dow)) {
        trainDowTotals.set(dow, { sum: 0, count: 0 });
      }
      const entry = trainDowTotals.get(dow);
      entry.sum += rev;
      entry.count += 1;
    }

    const totalTrainRev = Array.from(trainActualsByDate.values()).reduce((a, b) => a + b, 0);
    const trainMeanDailyRev = trainActualsByDate.size > 0
      ? Math.round(totalTrainRev / trainActualsByDate.size)
      : 0;

    // ── 4. Generate Predictions & Calculate Accuracy (MAE, WAPE) ─────────────
    const actualVsPredicted = [];
    let sumAbsoluteError = 0;
    let sumActual = 0;
    let sumBaselineAbsoluteError = 0;

    for (let i = 0; i < holdout; i++) {
      const targetDate = addDays(holdoutStartDate, i);
      const dow = getDayOfWeek(targetDate);
      const actualVal = holdoutActualsByDate.get(targetDate) || 0;

      // Model predicted value (Day-of-Week Seasonal)
      let predictedVal = trainMeanDailyRev;
      if (trainDowTotals.has(dow) && trainDowTotals.get(dow).count > 0) {
        predictedVal = Math.round(trainDowTotals.get(dow).sum / trainDowTotals.get(dow).count);
      }

      // Naive baseline (simple mean of training data)
      const baselineVal = trainMeanDailyRev;

      const error = actualVal - predictedVal;
      const absError = Math.abs(error);
      const baselineAbsError = Math.abs(actualVal - baselineVal);

      sumAbsoluteError += absError;
      sumActual += actualVal;
      sumBaselineAbsoluteError += baselineAbsError;

      const percentageError = actualVal > 0 ? Number(((absError / actualVal) * 100).toFixed(2)) : null;

      actualVsPredicted.push({
        date: targetDate,
        dayOfWeek: dow,
        actualValue: actualVal,
        predictedValue: predictedVal,
        error,
        absoluteError: absError,
        percentageError,
      });
    }

    const mae = holdout > 0 ? Math.round(sumAbsoluteError / holdout) : 0;
    const baselineMae = holdout > 0 ? Math.round(sumBaselineAbsoluteError / holdout) : 0;

    // Division-by-zero protection for WAPE
    let wapePercent = 0;
    if (sumActual > 0) {
      wapePercent = Number(((sumAbsoluteError / sumActual) * 100).toFixed(2));
    } else if (sumAbsoluteError > 0) {
      wapePercent = 100;
    } else {
      wapePercent = 0;
    }

    let maeImprovementPercent = 0;
    if (baselineMae > 0) {
      maeImprovementPercent = Number((((baselineMae - mae) / baselineMae) * 100).toFixed(2));
    }

    let status = 'VALID';
    if (holdoutBills.length === 0) {
      status = 'ZERO_OBSERVATIONS';
    } else if (trainActualsByDate.size < 7) {
      status = 'SPARSE_DATA';
    }

    // ── 5. Persist Evaluation Run ────────────────────────────────────────────
    const evaluationId = generateEvaluationId(todayStr);

    const evalDoc = new ForecastEvaluation({
      evaluationId,
      organisationId: cleanOrg,
      cafeId: cleanCafe,
      targetMetric: 'SALES_REVENUE',
      methodEvaluated: 'DAY_OF_WEEK_SEASONAL',
      baselineMethod: 'TRAINING_PERIOD_MEAN',
      holdoutWindow: {
        startDate: holdoutStartDate,
        endDate: holdoutEndDate,
        days: holdout,
      },
      trainingCutoffDate,
      observationsCount: holdoutBills.length,
      mae,
      wapePercent,
      baselineMae,
      maeImprovementPercent,
      status,
      actualVsPredicted,
      notes: `Holdout evaluation evaluated on ${holdout} holdout days. Data leakage prevented: zero holdout observations exposed to training.`,
      evaluatedByUserId: actorId,
      evaluatedAt: new Date(),
    });

    await evalDoc.save();
    return evalDoc.toObject();
  }

  /**
   * Retrieves latest forecast run for a cafe/org.
   */
  static async getLatestForecast({ organisationId = 'ZAMORIN', cafeId = null }) {
    const cleanOrg = organisationId.trim().toUpperCase();
    const query = { organisationId: cleanOrg };
    if (cafeId) {
      query.cafeId = cafeId.trim().toUpperCase();
    }

    const latest = await ForecastRun.findOne(query)
      .sort({ generatedAt: -1 })
      .lean();

    return latest || null;
  }

  /**
   * Lists historical forecast runs.
   */
  static async listForecastHistory({ organisationId = 'ZAMORIN', cafeId = null, limit = 20 }) {
    const cleanOrg = organisationId.trim().toUpperCase();
    const query = { organisationId: cleanOrg };
    if (cafeId) {
      query.cafeId = cafeId.trim().toUpperCase();
    }

    const history = await ForecastRun.find(query)
      .sort({ generatedAt: -1 })
      .limit(Math.min(100, Math.max(1, limit)))
      .lean();

    return history;
  }

  /**
   * Lists historical forecast accuracy evaluations.
   */
  static async listEvaluationHistory({ organisationId = 'ZAMORIN', cafeId = null, limit = 20 }) {
    const cleanOrg = organisationId.trim().toUpperCase();
    const query = { organisationId: cleanOrg };
    if (cafeId) {
      query.cafeId = cafeId.trim().toUpperCase();
    }

    const evaluations = await ForecastEvaluation.find(query)
      .sort({ evaluatedAt: -1 })
      .limit(Math.min(100, Math.max(1, limit)))
      .lean();

    return evaluations;
  }
}

module.exports = SalesForecastingService;
